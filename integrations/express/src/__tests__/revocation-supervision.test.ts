/**
 * Supervision of the strict-v1 revocationSource (docs/reviews/admission-source-supervision-plan.md,
 * step 2) through a real Express app: the same responses with and without supervise.revocation,
 * deadlines on a monotonic clock, one capacity shared with the trust source and held until a source
 * really settles, close(), telemetry, configuration, and denyListRevocationSource under the
 * supervisor's signal. Deadlines are measured from the source's call to its signal's abort, never
 * through the bundle's verification.
 *
 *   DCP_NEGATIVE_CONTROL=1 npx vitest run src/__tests__/revocation-supervision.test.ts   # must fail once
 */
import { readFileSync } from 'node:fs';
import { getEventListeners } from 'node:events';
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { createSourceSupervisor, dcpVerify, denyListRevocationSource, type DCPVerifyOptions, type RevocationSource, type SourceEvent, type SourceSupervisor } from '../index.js';
import { supervise } from '../source-supervisor.js';

// @dcp-ai/openclaw's copy of the helper, loaded at run time: it lies outside this package's rootDir.
const OPENCLAW_COPY = fileURLToPath(new URL('../../../openclaw/src/tools/source-supervisor.ts', import.meta.url));
const { createSourceSupervisor: createFromOpenClawCopy } = (await import(OPENCLAW_COPY)) as typeof import('../source-supervisor.js');

const VECTORS = JSON.parse(readFileSync(new URL('../../../../tests/interop/v2/admission_vectors.json', import.meta.url), 'utf8'));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const bundle = (name: string) => clone(VECTORS.signed_bundles[name]);
const vectorRevocation = (name: string) => clone(VECTORS.cases.find((c: any) => c.name === name).revocation);
const NOW = Date.parse(VECTORS.cases.find((c: any) => c.name === 'A_known_principal_strict').now); // every 13_* case's clock too
const STRICT = VECTORS.profiles.strict;
const TRUSTED = VECTORS.trust_sets.principal;
const NEGATIVE_CONTROL = process.env.DCP_NEGATIVE_CONTROL === '1';
const CLEAR = () => vectorRevocation('A_known_principal_strict');
const SUBJECTS = { agent_ids: [], kids: [] } as any;
const invalid = () => Object.assign(new Error('unreadable'), { code: 'REVOCATION_INVALID' });

function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (check: () => boolean) => {
  for (let i = 0; i < 400 && !check(); i++) await sleep(5);
  expect(check()).toBe(true);
};

// Released after every test, also a failed one: no source or server outlives it.
const servers: Server[] = [];
const held: Array<ReturnType<typeof deferred>> = [];
const hold = () => {
  const d = deferred();
  held.push(d);
  return d;
};
afterEach(async () => {
  held.splice(0).forEach((d) => d.resolve(null));
  await Promise.all(
    servers.splice(0).map((s) => {
      s.closeAllConnections();
      return new Promise((r) => s.close(r));
    }),
  );
});

async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** An Express app whose tenant comes from the operator's own authentication (a bearer token). */
async function app(options: DCPVerifyOptions) {
  const a = express();
  a.use(rateLimit({ windowMs: 60_000, limit: 10_000 }));
  a.use(express.json({ limit: '5mb' }));
  const tenants: Record<string, string> = { 'token-a': 'tenant-a', 'token-b': 'tenant-b' };
  a.use((req: any, _res, next) => {
    req.auth = { tenant: tenants[String(req.headers.authorization ?? '').replace('Bearer ', '')] ?? 'anonymous' };
    next();
  });
  const reached: unknown[] = [];
  a.post('/p', dcpVerify({ clock: () => NOW, tenant: (req: any) => req.auth.tenant, ...options }), (req: any, res) => {
    reached.push(req.dcpAgent);
    res.json({ ok: true });
  });
  const url = await listen(createServer(a));
  const post = async (init: { token?: string; bundle?: string; headers?: Record<string, string>; body?: Record<string, unknown> } = {}) => {
    const r = await fetch(`${url}/p`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${init.token ?? 'token-a'}`, ...init.headers },
      body: JSON.stringify({ signed_bundle: bundle(init.bundle ?? 'base'), ...init.body }),
    });
    return { status: r.status, body: (await r.json()) as any };
  };
  return { post, reached };
}

/** strict-v1 with a static trust set and `revocationSource`, its revocation supervised by `supervisor`. */
const strict = (revocationSource: RevocationSource, supervisor?: SourceSupervisor, revocationTimeoutMs = 100): DCPVerifyOptions => ({
  trustedPrincipals: TRUSTED,
  profile: STRICT,
  revocationSource,
  revocationTimeoutMs,
  ...(supervisor ? { sourceSupervisor: supervisor, supervise: { revocation: true } } : {}),
});

/** A source that records when it was called and when its signal aborted, and waits for `answer`. */
function watched(answer: () => Promise<unknown>) {
  const t: { calls: number; called?: number; aborted?: number; contexts: any[] } = { calls: 0, contexts: [] };
  const source = ((_subjects: unknown, context: any) => {
    t.calls++;
    t.called = performance.now();
    t.contexts.push(context);
    context.signal?.addEventListener('abort', () => (t.aborted = performance.now()));
    return answer();
  }) as RevocationSource;
  return { t, source };
}

const UNAVAILABLE_BODY = {
  verified: true,
  admitted: false,
  principal_trust: 'trusted',
  profile: 'strict-v1',
  profile_compliance: 'non_compliant',
  codes: ['REVOCATION_UNAVAILABLE'],
  errors: ['no revocation status could be obtained'],
};

describe('a supervised revocationSource', () => {
  it('answers in time: admitted as before, with a signal that is not aborted', async () => {
    const { t, source } = watched(async () => CLEAR());
    const s = createSourceSupervisor({ maxInFlight: 2 });
    const { post, reached } = await app(strict(source, s));
    const r = await post();
    expect(r.status).toBe(NEGATIVE_CONTROL ? 403 : 200); // the negative control inverts this expectation
    expect(reached).toHaveLength(1);
    expect(Object.keys(t.contexts[0]).sort()).toEqual(['signal', 'tenant']);
    expect(t.contexts[0].tenant).toBe('tenant-a');
    expect(t.contexts[0].signal.aborted).toBe(false);
    expect(s.stats()).toMatchObject({ inFlight: 0, tenants: 0, timeouts: 0, saturated: 0 });
  });

  it('without supervise.revocation it gets { tenant } as before, also when the trust source is supervised', async () => {
    const { t, source } = watched(async () => CLEAR());
    const s = createSourceSupervisor({ maxInFlight: 2 });
    const { post } = await app({ ...strict(source), trustedPrincipals: () => TRUSTED, sourceSupervisor: s, supervise: { trustTimeoutMs: 1000 } });
    expect((await post()).status).toBe(200);
    expect(Object.keys(t.contexts[0])).toEqual(['tenant']);
  });

  const answers: Array<[string, (subjects: any) => unknown, number, string[] | undefined]> = [
    ['not revoked', async () => CLEAR(), 200, undefined],
    ['agent revoked', async () => vectorRevocation('13_agent_revoked'), 403, ['REVOCATION_REVOKED']],
    ['agent key revoked', async () => vectorRevocation('13_agent_key_revoked'), 403, ['REVOCATION_REVOKED']],
    ['stale', async () => vectorRevocation('13_stale_by_1_ms'), 403, ['REVOCATION_STALE']],
    ['status unknown', async () => vectorRevocation('13_status_unknown'), 403, ['REVOCATION_UNKNOWN']],
    ['an unreadable snapshot', async () => vectorRevocation('13_extra_field'), 403, ['REVOCATION_INVALID']],
    ['null', async () => null, 403, ['REVOCATION_UNAVAILABLE']],
    ['undefined', async () => undefined, 403, ['REVOCATION_UNAVAILABLE']],
    ['a rejection', async () => { throw new Error('down'); }, 403, ['REVOCATION_UNAVAILABLE']],
    ['a REVOCATION_INVALID rejection', async () => { throw invalid(); }, 403, ['REVOCATION_INVALID']],
    ['a synchronous throw', () => { throw new Error('down'); }, 403, ['REVOCATION_UNAVAILABLE']],
    ['a synchronous REVOCATION_INVALID throw', () => { throw invalid(); }, 403, ['REVOCATION_INVALID']],
    ['a synchronous snapshot', () => CLEAR(), 200, undefined],
  ];
  it.each(answers)('%s: the same response with and without supervision, and with both sources supervised', async (_name, answer, status, codes) => {
    const legacy = await (await app(strict(answer as RevocationSource))).post();
    const revocationOnly = await (await app(strict(answer as RevocationSource, createSourceSupervisor({ maxInFlight: 2 })))).post();
    const both = await (await app({
      ...strict(answer as RevocationSource),
      trustedPrincipals: async () => TRUSTED,
      sourceSupervisor: createSourceSupervisor({ maxInFlight: 2 }),
      supervise: { trustTimeoutMs: 2000, revocation: true },
    })).post();
    expect(legacy.status).toBe(status);
    expect(legacy.body.codes).toEqual(codes);
    expect(revocationOnly).toEqual(legacy);
    expect(both).toEqual(legacy);
  });

  it('is not asked for a bundle that is not verified', async () => {
    const { t, source } = watched(async () => CLEAR());
    const s = createSourceSupervisor({ maxInFlight: 1 });
    const { post } = await app(strict(source, s));
    expect((await post({ bundle: 'other_intended_verifier' })).body.codes).toEqual(['PROFILE_AUDIENCE_MISMATCH', 'VERIFICATION_FAILED']);
    expect((await post({ bundle: 'pq_signature_invalid' })).body.codes).toEqual(['VERIFICATION_FAILED']);
    expect(t.calls).toBe(0);
    expect(s.stats()).toMatchObject({ inFlight: 0, timeouts: 0, saturated: 0 });
  });

  it('pending and ignoring its signal: REVOCATION_UNAVAILABLE at the deadline, the slot kept until it settles', async () => {
    const pending = hold();
    const { t, source } = watched(() => pending.promise);
    const s = createSourceSupervisor({ maxInFlight: 2 });
    const { post, reached } = await app(strict(source, s, 100));
    const r = await post();
    expect(r).toEqual({ status: 403, body: UNAVAILABLE_BODY });
    expect(t.aborted! - t.called!).toBeGreaterThanOrEqual(98);
    expect(t.aborted! - t.called!).toBeLessThan(100 + 250);
    expect(reached).toHaveLength(0);
    expect(s.stats()).toMatchObject({ inFlight: 1, tenants: 1, timeouts: 1 });
    pending.resolve(CLEAR()); // a late not_revoked: counted, never used
    await until(() => s.stats().inFlight === 0);
    expect(s.stats()).toMatchObject({ tenants: 0, lateResults: 1 });
  });

  it('a late snapshot is never used, nor kept for the next request or a cached verdict', async () => {
    const answers: Array<() => unknown> = [
      () => sleep(200).then(CLEAR), // late: must not be used
      () => vectorRevocation('13_agent_revoked'),
      () => CLEAR(),
    ];
    let calls = 0;
    const s = createSourceSupervisor({ maxInFlight: 2 });
    const { post, reached } = await app({ ...strict(() => (calls++, answers.shift()!()) as any, s, 100), cacheTtlSeconds: 60 });
    expect((await post()).body.codes).toEqual(['REVOCATION_UNAVAILABLE']);
    await until(() => s.stats().lateResults === 1);
    expect((await post()).body.codes).toEqual(['REVOCATION_REVOKED']);
    expect((await post()).status).toBe(200);
    expect(calls).toBe(3);
    expect(reached).toHaveLength(1);
  });

  it('a late REVOCATION_INVALID error is a timeout, not REVOCATION_INVALID, and leaves no unhandledRejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const s = createSourceSupervisor({ maxInFlight: 2 });
      const { post } = await app(strict(() => sleep(200).then(() => { throw invalid(); }), s, 100));
      expect(await post()).toEqual({ status: 403, body: UNAVAILABLE_BODY });
      await until(() => s.stats().lateErrors === 1);
      await sleep(20);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('a snapshot returned after the deadline while the event loop is busy is refused, timer or not', async () => {
    const s = createSourceSupervisor({ maxInFlight: 2 });
    const { post } = await app(strict(() => {
      const end = performance.now() + 150;
      while (performance.now() < end); // blocks the loop past the 50 ms deadline, then answers
      return CLEAR();
    }, s, 50));
    expect(await post()).toEqual({ status: 403, body: UNAVAILABLE_BODY });
    expect(s.stats()).toMatchObject({ timeouts: 1, lateResults: 1, inFlight: 0 });
  });

  it('capacity: request N+1 gets REVOCATION_UNAVAILABLE without calling the source; slots free only when sources settle', async () => {
    const pending = hold();
    let calls = 0;
    const s = createSourceSupervisor({ maxInFlight: 1 });
    const { post } = await app(strict(() => (calls++ === 0 ? pending.promise : CLEAR()) as any, s, 100));
    expect((await post()).body.codes).toEqual(['REVOCATION_UNAVAILABLE']); // timed out, still running
    const refused = await post();
    expect(refused).toEqual({ status: 403, body: UNAVAILABLE_BODY });
    expect(calls).toBe(1);
    expect(s.stats()).toMatchObject({ inFlight: 1, timeouts: 1, saturated: 1 });
    pending.resolve(CLEAR());
    await until(() => s.stats().inFlight === 0);
    expect((await post()).status).toBe(200);
  });

  it('trust and revocation sources share one capacity, both ways', async () => {
    const s = createSourceSupervisor({ maxInFlight: 1 });
    // A revocation source that timed out and still runs holds the slot: a supervised trust source is refused.
    const revocationHeld = hold();
    const trustCalls = vi.fn(() => TRUSTED);
    const both = await app({ ...strict(() => revocationHeld.promise as any), trustedPrincipals: trustCalls, sourceSupervisor: s, supervise: { trustTimeoutMs: 100, revocation: true } });
    expect((await both.post()).body.codes).toEqual(['REVOCATION_UNAVAILABLE']);
    expect(trustCalls).toHaveBeenCalledTimes(1);
    const trustRefused = await both.post();
    expect(trustRefused.status).toBe(503);
    expect(trustCalls).toHaveBeenCalledTimes(1);
    revocationHeld.resolve(CLEAR());
    await until(() => s.stats().inFlight === 0);
    // A trust source still running holds it: another middleware's revocation is refused, not called.
    const trustHeld = hold();
    const trustOnly = await app({ trustedPrincipals: () => trustHeld.promise as any, sourceSupervisor: s, supervise: { trustTimeoutMs: 100 } });
    expect((await trustOnly.post()).status).toBe(503);
    const { t, source } = watched(async () => CLEAR());
    expect(await (await app(strict(source, s))).post()).toEqual({ status: 403, body: UNAVAILABLE_BODY });
    expect(t.calls).toBe(0);
    expect(s.stats()).toMatchObject({ inFlight: 1, saturated: 2 });
    trustHeld.resolve(TRUSTED);
    await until(() => s.stats().inFlight === 0);
  });

  it('with maxInFlightPerTenant one tenant cannot take another tenant\'s revocation slots', async () => {
    const started = deferred();
    const release = hold();
    const s = createSourceSupervisor({ maxInFlight: 3, maxInFlightPerTenant: 1 });
    const { post } = await app(strict((_subjects, { tenant }) => {
      if (tenant !== 'tenant-a') return CLEAR();
      started.resolve(undefined);
      return release.promise.then(CLEAR) as any;
    }, s, 2000));
    const first = post({ token: 'token-a' });
    await started.promise;
    expect((await post({ token: 'token-a' })).body.codes).toEqual(['REVOCATION_UNAVAILABLE']);
    expect((await post({ token: 'token-b' })).status).toBe(200);
    release.resolve(undefined);
    expect((await first).status).toBe(200);
    expect(s.stats()).toMatchObject({ inFlight: 0, tenants: 0, saturated: 1 });
  });

  it('close(): a pending revocation is answered at once, signals aborted, new requests refused without the source, slots kept', async () => {
    const pending = hold();
    const { t, source } = watched(() => pending.promise);
    const s = createSourceSupervisor({ maxInFlight: 2 });
    const { post } = await app(strict(source, s, 5000));
    const request = post();
    await until(() => t.calls === 1);
    const closing = s.close({ drainMs: 50 });
    expect(await request).toEqual({ status: 403, body: UNAVAILABLE_BODY });
    expect(t.contexts[0].signal.aborted).toBe(true);
    expect(await closing).toEqual({ inFlight: 1 }); // the drain ran out: no reset
    expect(await post()).toEqual({ status: 403, body: UNAVAILABLE_BODY });
    expect(t.calls).toBe(1);
    expect(s.stats()).toMatchObject({ open: false, inFlight: 1, closed: 2 });
    pending.resolve(CLEAR());
    await until(() => s.stats().inFlight === 0);
    expect(await s.close()).toEqual({ inFlight: 0 });
  });

  it('request fields cannot configure supervision: the operator\'s deadline applies', async () => {
    const pending = hold();
    const { t, source } = watched(() => pending.promise);
    const { post } = await app(strict(source, createSourceSupervisor({ maxInFlight: 2 }), 100));
    const r = await post({
      headers: { 'x-dcp-supervise': '{"revocation":false}', 'x-revocation-timeout-ms': '60000' },
      body: { supervise: { revocation: false }, revocationTimeoutMs: 60000, sourceSupervisor: { maxInFlight: 99 } },
    });
    expect(r).toEqual({ status: 403, body: UNAVAILABLE_BODY });
    expect(t.aborted! - t.called!).toBeLessThan(100 + 250);
  });

  it('telemetry: events say source revocation, with a fixed reason and a count, never a tenant', async () => {
    const events: SourceEvent[] = [];
    const pending = hold();
    const s = createSourceSupervisor({ maxInFlight: 1, onSourceEvent: (e) => void events.push(e) });
    const { post } = await app(strict(() => pending.promise as any, s, 50));
    await post();
    await until(() => events.length === 1);
    expect(events[0]).toEqual({ source: 'revocation', reason: 'timeout', inFlight: 1 });
    pending.resolve(CLEAR());
    await until(() => events.length === 2);
    expect(events[1]).toEqual({ source: 'revocation', reason: 'late_result', inFlight: 0 });
    expect(JSON.stringify(events)).not.toContain('tenant-a');
  });

  it('a supervisor made by @dcp-ai/openclaw\'s copy of the helper supervises revocation here and shares one capacity', async () => {
    const s = createFromOpenClawCopy({ maxInFlight: 1 });
    const occupy = hold();
    const occupied = supervise(s, 'revocation', 'elsewhere', 5000, () => occupy.promise);
    const { t, source } = watched(async () => CLEAR());
    const { post } = await app(strict(source, s));
    expect((await post()).body.codes).toEqual(['REVOCATION_UNAVAILABLE']);
    expect(t.calls).toBe(0);
    occupy.resolve(null);
    expect((await occupied).status).toBe('ok');
    expect((await post()).status).toBe(200);
  });
});

describe('denyListRevocationSource', () => {
  /**
   * A deny-list server that never finishes its answer (no headers, or a 200 whose body stops
   * halfway), and whether each request's connection has closed.
   */
  async function hungServer({ partialBody = false } = {}) {
    const requests: Array<{ closed: boolean }> = [];
    const url = await listen(createServer((req, res) => {
      const entry = { closed: false };
      requests.push(entry);
      req.socket.on('close', () => (entry.closed = true));
      if (partialBody) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.write('{"checked_at":');
      }
    }));
    return { url: `${url}/.well-known/dcp-revocations.json`, requests };
  }

  it('under supervision the deadline aborts its fetch: the server sees the connection close and the slot frees', async () => {
    const server = await hungServer();
    const s = createSourceSupervisor({ maxInFlight: 1 });
    const { post } = await app(strict(denyListRevocationSource({ url: server.url, timeoutMs: 60_000 }), s, 200));
    expect(await post()).toEqual({ status: 403, body: UNAVAILABLE_BODY });
    expect(server.requests).toHaveLength(1);
    await until(() => server.requests[0].closed);
    await until(() => s.stats().inFlight === 0);
    expect(s.stats()).toMatchObject({ timeouts: 1, lateErrors: 1 });
  });

  it('under supervision the deadline also aborts a 200 whose body stops halfway, while it is being read', async () => {
    const server = await hungServer({ partialBody: true });
    const s = createSourceSupervisor({ maxInFlight: 1 });
    const { post } = await app(strict(denyListRevocationSource({ url: server.url, timeoutMs: 60_000 }), s, 200));
    expect(await post()).toEqual({ status: 403, body: UNAVAILABLE_BODY });
    expect(server.requests).toHaveLength(1);
    await until(() => server.requests[0].closed);
    await until(() => s.stats().inFlight === 0);
    expect(s.stats()).toMatchObject({ timeouts: 1, lateErrors: 1 });
  });

  it('without supervision its own timeoutMs still aborts the fetch', async () => {
    const server = await hungServer();
    const { post } = await app(strict(denyListRevocationSource({ url: server.url, timeoutMs: 100 }), undefined, 5000));
    expect(await post()).toEqual({ status: 403, body: UNAVAILABLE_BODY });
    await until(() => server.requests[0]?.closed === true);
  });

  it('called directly, a timeoutMs AbortSignal.timeout refuses is REVOCATION_UNAVAILABLE, as before, without a request', async () => {
    const server = await hungServer();
    for (const timeoutMs of [1.5, 4_294_967_296]) {
      const source = denyListRevocationSource({ url: server.url, timeoutMs });
      await expect(source(SUBJECTS, { tenant: '' })).rejects.toMatchObject({ code: 'REVOCATION_UNAVAILABLE' });
      await expect(source(SUBJECTS, { tenant: '', signal: new AbortController().signal })).rejects.toMatchObject({ code: 'REVOCATION_UNAVAILABLE' });
    }
    expect(server.requests).toHaveLength(0);
  });

  it('an already aborted signal is REVOCATION_UNAVAILABLE without a request', async () => {
    const server = await hungServer();
    const controller = new AbortController();
    controller.abort();
    const source = denyListRevocationSource({ url: server.url, timeoutMs: 60_000 });
    await expect(source(SUBJECTS, { tenant: '', signal: controller.signal })).rejects.toMatchObject({ code: 'REVOCATION_UNAVAILABLE' });
    await sleep(20);
    expect(server.requests).toHaveLength(0);
  });

  it('removes the listener it adds to the caller\'s signal when it settles', async () => {
    const url = await listen(createServer((_req, res) => res.writeHead(404).end()));
    const controller = new AbortController();
    const source = denyListRevocationSource({ url: `${url}/list.json`, timeoutMs: 5000 });
    await expect(source(SUBJECTS, { tenant: '', signal: controller.signal })).rejects.toMatchObject({ code: 'REVOCATION_UNAVAILABLE' });
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });
});

describe('configuration', () => {
  const s = createSourceSupervisor({ maxInFlight: 1 });
  const source: RevocationSource = async () => CLEAR();
  const fn = () => TRUSTED;
  const withProfile = (over: Record<string, unknown>) => ({ trustedPrincipals: TRUSTED, profile: STRICT, revocationSource: source, sourceSupervisor: s, ...over });

  it.each<[string, unknown, string]>([
    ['revocation "yes"', withProfile({ supervise: { revocation: 'yes' } }), 'CONFIG_INVALID_VALUE'],
    ['revocation null', withProfile({ supervise: { revocation: null } }), 'CONFIG_INVALID_VALUE'],
    ['revocation 1', withProfile({ supervise: { revocation: 1 } }), 'CONFIG_INVALID_VALUE'],
    ['supervise {}', withProfile({ supervise: {} }), 'CONFIG_INVALID_VALUE'],
    ['revocation false and no trustTimeoutMs', withProfile({ supervise: { revocation: false } }), 'CONFIG_INVALID_VALUE'],
    ['revocation without a revocationSource', { trustedPrincipals: fn, sourceSupervisor: s, supervise: { revocation: true } }, 'CONFIG_PROFILE_CONTRADICTION'],
    ['revocation with a static trust set and no profile', { trustedPrincipals: TRUSTED, sourceSupervisor: s, supervise: { revocation: true } }, 'CONFIG_PROFILE_CONTRADICTION'],
    ['trustTimeoutMs with a static trust set', withProfile({ supervise: { trustTimeoutMs: 100, revocation: true } }), 'CONFIG_PROFILE_CONTRADICTION'],
    ['trustTimeoutMs 0 with revocation', withProfile({ trustedPrincipals: fn, supervise: { trustTimeoutMs: 0, revocation: true } }), 'CONFIG_INVALID_VALUE'],
    ['revocation without a supervisor', withProfile({ sourceSupervisor: undefined, supervise: { revocation: true } }), 'CONFIG_PROFILE_CONTRADICTION'],
    ...[0, -1, 1.5, 2_147_483_648, Number.NaN].map((t): [string, unknown, string] => [`revocationTimeoutMs ${t} with revocation`, withProfile({ revocationTimeoutMs: t, supervise: { revocation: true } }), 'CONFIG_INVALID_VALUE']),
  ])('refuses %s when the middleware is created', (_name, options, code) => {
    expect(() => dcpVerify(options as DCPVerifyOptions)).toThrow(expect.objectContaining({ code }));
  });

  it('accepts revocation alone with a static or a function trust source, both, and the timer range', () => {
    for (const options of [
      withProfile({ supervise: { revocation: true } }),
      withProfile({ trustedPrincipals: fn, supervise: { revocation: true } }),
      withProfile({ trustedPrincipals: fn, supervise: { trustTimeoutMs: 100, revocation: true } }),
      withProfile({ revocationTimeoutMs: 1, supervise: { revocation: true } }),
      withProfile({ revocationTimeoutMs: 2_147_483_647, supervise: { revocation: true } }),
    ]) {
      expect(() => dcpVerify(options as DCPVerifyOptions)).not.toThrow();
    }
  });

  it('without supervise.revocation, revocationTimeoutMs keeps its own rule: 1.5 is accepted as before', () => {
    expect(() => dcpVerify(withProfile({ sourceSupervisor: undefined, revocationTimeoutMs: 1.5 }) as DCPVerifyOptions)).not.toThrow();
    expect(() => dcpVerify(withProfile({ trustedPrincipals: fn, revocationTimeoutMs: 1.5, supervise: { trustTimeoutMs: 100 } }) as DCPVerifyOptions)).not.toThrow();
  });
});
