/**
 * Source supervision of the trustedPrincipals function (docs/reviews/admission-source-supervision-plan.md,
 * step 1) through a real Express app: deadlines on a monotonic clock, capacity per supervisor
 * object held until a source really settles, close(), the observer, configuration, and a
 * supervisor made by @dcp-ai/openclaw's copy of the helper.
 *
 *   DCP_NEGATIVE_CONTROL=1 npx vitest run src/__tests__/source-supervision.test.ts   # must fail once
 */
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { createSourceSupervisor, dcpVerify, type DCPVerifyOptions, type SourceEvent, type SourceSupervisor } from '../index.js';
import { saturatingIncrement, supervise } from '../source-supervisor.js';

// @dcp-ai/openclaw's copy of the helper, loaded at run time: it lies outside this package's rootDir.
const OPENCLAW_COPY = fileURLToPath(new URL('../../../openclaw/src/tools/source-supervisor.ts', import.meta.url));
const { createSourceSupervisor: createFromOpenClawCopy } = (await import(OPENCLAW_COPY)) as typeof import('../source-supervisor.js');

const VECTORS = JSON.parse(readFileSync(new URL('../../../../tests/interop/v2/admission_vectors.json', import.meta.url), 'utf8'));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const bundle = (name: string) => clone(VECTORS.signed_bundles[name]);
const NOW = Date.parse(VECTORS.cases.find((c: any) => c.name === 'A_known_principal_strict').now);
const STRICT = VECTORS.profiles.strict;
const TRUSTED = VECTORS.trust_sets.principal;
const EMPTY = VECTORS.trust_sets.empty;
const NEGATIVE_CONTROL = process.env.DCP_NEGATIVE_CONTROL === '1';
const UNAVAILABLE = 'The principal trust set is unavailable (TRUST_SOURCE_FAILED)';

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
  for (let i = 0; i < 200 && !check(); i++) await sleep(5);
  expect(check()).toBe(true);
};

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

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
  const server = createServer(a);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (init: { token?: string; headers?: Record<string, string>; body?: Record<string, unknown> } = {}) => {
    const started = performance.now();
    const r = await fetch(`${url}/p`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${init.token ?? 'token-a'}`, ...init.headers },
      body: JSON.stringify({ signed_bundle: bundle('base'), ...init.body }),
    });
    return { status: r.status, body: (await r.json()) as any, ms: performance.now() - started };
  };
  return { post, reached };
}

const supervised = (supervisor: SourceSupervisor, trustedPrincipals: DCPVerifyOptions['trustedPrincipals'], trustTimeoutMs = 100): DCPVerifyOptions => ({
  trustedPrincipals,
  sourceSupervisor: supervisor,
  supervise: { trustTimeoutMs },
});

describe('a supervised trustedPrincipals function', () => {
  it('answers in time: admitted as before, with a signal that is not aborted', async () => {
    const contexts: any[] = [];
    const s = createSourceSupervisor({ maxInFlight: 2 });
    const { post, reached } = await app(supervised(s, (context) => (contexts.push(context), TRUSTED)));
    const r = await post();
    expect(r.status).toBe(NEGATIVE_CONTROL ? 503 : 200); // the negative control inverts this expectation
    expect(reached).toHaveLength(1);
    expect(Object.keys(contexts[0]).sort()).toEqual(['signal', 'tenant']);
    expect(contexts[0].tenant).toBe('tenant-a');
    expect(contexts[0].signal.aborted).toBe(false);
    expect(s.stats()).toMatchObject({ inFlight: 0, tenants: 0, timeouts: 0, saturated: 0 });
  });

  it('without supervision the function gets { tenant } as before, with no signal', async () => {
    const contexts: any[] = [];
    const { post } = await app({ trustedPrincipals: (context) => (contexts.push(context), TRUSTED) });
    expect((await post()).status).toBe(200);
    expect(Object.keys(contexts[0])).toEqual(['tenant']);
  });

  it('pending and ignoring its signal: 503 at the deadline, with the body of a failing source, and nothing else runs', async () => {
    const pending = deferred();
    const contexts: any[] = [];
    const revocationSource = vi.fn(async () => null);
    const s = createSourceSupervisor({ maxInFlight: 2 });
    const { post, reached } = await app({
      ...supervised(s, (context) => (contexts.push(context), pending.promise as any)),
      profile: STRICT,
      revocationSource,
    });
    const r = await post();
    const failing = await (await app({ trustedPrincipals: () => { throw new Error('down'); }, profile: STRICT, revocationSource })).post();
    expect(r.status).toBe(503);
    expect(r.body).toEqual(failing.body);
    expect(r.body).toMatchObject({ admitted: false, codes: [], errors: [UNAVAILABLE] });
    expect(r.ms).toBeGreaterThanOrEqual(95);
    expect(r.ms).toBeLessThan(100 + 250);
    expect(contexts[0].signal.aborted).toBe(true);
    expect(reached).toHaveLength(0);
    expect(revocationSource).not.toHaveBeenCalled();
    // The slot stays taken until the source really settles.
    expect(s.stats()).toMatchObject({ inFlight: 1, tenants: 1, timeouts: 1 });
    pending.resolve(TRUSTED);
    await until(() => s.stats().inFlight === 0);
    expect(s.stats()).toMatchObject({ tenants: 0, lateResults: 1 });
  });

  it('a late trust set is never used; the next request asks the source again (withdrawal, then restoration)', async () => {
    const answers: Array<() => unknown> = [
      () => sleep(200).then(() => TRUSTED), // late: must not be used
      () => EMPTY, // the principal is withdrawn
      () => TRUSTED, // and restored
    ];
    const s = createSourceSupervisor({ maxInFlight: 2 });
    const { post, reached } = await app(supervised(s, () => answers.shift()!() as any));
    expect((await post()).status).toBe(503);
    await until(() => s.stats().lateResults === 1);
    const withdrawn = await post();
    expect(withdrawn.status).toBe(403);
    expect(withdrawn.body.codes).toEqual(['TRUST_PRINCIPAL_UNKNOWN']);
    expect((await post()).status).toBe(200);
    expect(reached).toHaveLength(1);
  });

  it('a late rejection is consumed: no unhandledRejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const s = createSourceSupervisor({ maxInFlight: 2 });
      const { post } = await app(supervised(s, () => sleep(150).then(() => { throw new Error('late'); })));
      expect((await post()).status).toBe(503);
      await until(() => s.stats().lateErrors === 1);
      await sleep(20);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('a value returned after the deadline while the event loop is busy is refused, timer or not', async () => {
    const s = createSourceSupervisor({ maxInFlight: 2 });
    const { post } = await app(supervised(s, () => {
      const end = performance.now() + 150;
      while (performance.now() < end); // blocks the loop past the 50 ms deadline, then answers
      return TRUSTED;
    }, 50));
    const r = await post();
    expect(r.status).toBe(503);
    expect(s.stats()).toMatchObject({ timeouts: 1, lateResults: 1, inFlight: 0 });
  });

  // The response time of request N+1 includes HTTP and the bundle's verification, so it is not
  // asserted here: OpenClaw's fake-clock test shows the supervisor answers saturated with no wait.
  it('capacity: request N+1 is refused without calling the source, and slots free only when the sources really settle', async () => {
    const pending = [deferred(), deferred()];
    let calls = 0;
    const s = createSourceSupervisor({ maxInFlight: 2 });
    const { post } = await app(supervised(s, () => (calls < 2 ? pending[calls++].promise : (calls++, TRUSTED)) as any));
    const timedOut = await Promise.all([post(), post()]);
    expect(timedOut.map((r) => r.status)).toEqual([503, 503]);
    expect(s.stats()).toMatchObject({ inFlight: 2, timeouts: 2 });
    const refused = await post(); // both responses are sent, but both sources still run
    expect(refused.status).toBe(503);
    expect(refused.body.errors).toEqual([UNAVAILABLE]);
    expect(calls).toBe(2);
    expect(s.stats()).toMatchObject({ inFlight: 2, timeouts: 2, saturated: 1 });
    pending.forEach((p) => p.resolve(TRUSTED));
    await until(() => s.stats().inFlight === 0);
    expect(s.stats().tenants).toBe(0);
    expect((await post()).status).toBe(200);
  });

  it('with maxInFlightPerTenant one tenant cannot take another tenant\'s slots', async () => {
    const started = deferred();
    const release = deferred();
    const s = createSourceSupervisor({ maxInFlight: 3, maxInFlightPerTenant: 1 });
    const { post } = await app(supervised(s, ({ tenant }) => {
      if (tenant !== 'tenant-a') return TRUSTED;
      started.resolve(undefined);
      return release.promise.then(() => TRUSTED) as any;
    }, 2000));
    const first = post({ token: 'token-a' });
    await started.promise;
    const secondA = await post({ token: 'token-a' });
    const b = await post({ token: 'token-b' });
    expect(secondA.status).toBe(503);
    expect(b.status).toBe(200);
    release.resolve(undefined);
    expect((await first).status).toBe(200);
    expect(s.stats()).toMatchObject({ inFlight: 0, tenants: 0, saturated: 1 });
  });

  it('without maxInFlightPerTenant one tenant can take the whole capacity', async () => {
    const release = deferred();
    const s = createSourceSupervisor({ maxInFlight: 2 });
    const { post } = await app(supervised(s, ({ tenant }) => (tenant === 'tenant-a' ? release.promise.then(() => TRUSTED) : TRUSTED) as any, 2000));
    const a = [post({ token: 'token-a' }), post({ token: 'token-a' })];
    await until(() => s.stats().inFlight === 2);
    expect((await post({ token: 'token-b' })).status).toBe(503);
    release.resolve(undefined);
    expect((await Promise.all(a)).map((r) => r.status)).toEqual([200, 200]);
  });

  it('close(): pending requests are answered at once, new ones refused, signals aborted, slots kept until settled', async () => {
    const pending = deferred();
    const contexts: any[] = [];
    let calls = 0;
    const s = createSourceSupervisor({ maxInFlight: 2 });
    const { post } = await app(supervised(s, (context) => (calls++, contexts.push(context), pending.promise as any), 5000));
    const request = post();
    await until(() => calls === 1);
    const closing = s.close({ drainMs: 50 });
    const r = await request;
    expect(r.status).toBe(503);
    expect(r.ms).toBeLessThan(1000);
    expect(contexts[0].signal.aborted).toBe(true);
    expect(await closing).toEqual({ inFlight: 1 }); // the drain ran out: no reset
    expect((await post()).status).toBe(503);
    expect(calls).toBe(1);
    expect(s.stats()).toMatchObject({ open: false, inFlight: 1, closed: 2 });
    pending.resolve(TRUSTED);
    await until(() => s.stats().inFlight === 0);
    expect(await s.close()).toEqual({ inFlight: 0 });
  });

  it('close() returns as soon as the last invocation settles, before the drain runs out', async () => {
    const s = createSourceSupervisor({ maxInFlight: 1 });
    const { post } = await app(supervised(s, ({ signal }) => new Promise((resolve) => signal!.addEventListener('abort', () => resolve(TRUSTED))) as any, 5000));
    const request = post();
    await until(() => s.stats().inFlight === 1);
    const started = performance.now();
    expect(await s.close({ drainMs: 2000 })).toEqual({ inFlight: 0 });
    expect(performance.now() - started).toBeLessThan(500);
    expect((await request).status).toBe(503);
  });

  it('request fields cannot configure supervision: the operator\'s deadline applies', async () => {
    const pending = deferred();
    const s = createSourceSupervisor({ maxInFlight: 2 });
    const { post } = await app(supervised(s, () => pending.promise as any));
    const r = await post({
      headers: { 'x-dcp-supervise': '{"trustTimeoutMs":60000}' },
      body: { supervise: { trustTimeoutMs: 60000 }, sourceSupervisor: { maxInFlight: 99 }, trustTimeoutMs: 60000 },
    });
    expect(r.status).toBe(503);
    expect(r.ms).toBeLessThan(100 + 250);
    pending.resolve(TRUSTED);
    await until(() => s.stats().inFlight === 0);
  });

  it('a supervisor made by @dcp-ai/openclaw\'s copy of the helper works here and shares one capacity', async () => {
    const s = createFromOpenClawCopy({ maxInFlight: 1 });
    const held = deferred();
    const occupied = supervise(s, 'trust', 'elsewhere', 5000, () => held.promise);
    expect(s.stats().inFlight).toBe(1);
    const { post } = await app(supervised(s, () => TRUSTED));
    expect((await post()).status).toBe(503);
    expect(s.stats().saturated).toBe(1);
    held.resolve(TRUSTED);
    expect((await occupied).status).toBe('ok');
    expect((await post()).status).toBe(200);
  });
});

describe('the observer', () => {
  /** n saturated invocations in one synchronous burst, while one slot is held. */
  const saturate = async (s: SourceSupervisor, n: number) => {
    const held = deferred();
    const occupied = supervise(s, 'trust', 't', 5000, () => held.promise);
    const refused = Array.from({ length: n }, () => supervise(s, 'trust', 't', 5000, () => TRUSTED));
    expect((await Promise.all(refused)).every((o) => o.status === 'saturated')).toBe(true);
    held.resolve(TRUSTED);
    await occupied;
  };

  it('gets events with a fixed reason and a count, never a tenant; one call at a time, the rest counted as dropped', async () => {
    const events: SourceEvent[] = [];
    const s = createSourceSupervisor({ maxInFlight: 1, onSourceEvent: (e) => void events.push(e) });
    await saturate(s, 100); // a burst inside one task: only the first is queued
    await sleep(5);
    expect(events).toHaveLength(1);
    expect(Object.keys(events[0]).sort()).toEqual(['inFlight', 'reason', 'source']);
    expect(events[0]).toEqual({ source: 'trust', reason: 'saturated', inFlight: 1 });
    expect(s.stats()).toMatchObject({ saturated: 100, droppedEvents: 99 });
  });

  it('a pending promise keeps the observer busy: later events are dropped, not queued', async () => {
    let calls = 0;
    const s = createSourceSupervisor({ maxInFlight: 1, onSourceEvent: () => (calls++, new Promise(() => {})) });
    await saturate(s, 1);
    await sleep(5);
    await saturate(s, 3);
    await sleep(5);
    expect(calls).toBe(1);
    expect(s.stats().droppedEvents).toBe(3);
  });

  it('a thenable that calls its resolver again later frees only its own delivery, never a later one', async () => {
    let resolveFirst: (() => void) | undefined;
    let calls = 0;
    const s = createSourceSupervisor({
      maxInFlight: 1,
      onSourceEvent: () => {
        calls++;
        if (calls === 1) return { then(resolve: () => void) { resolveFirst = resolve; } };
        return new Promise(() => {}); // the second delivery stays pending
      },
    });
    await saturate(s, 1);
    await sleep(5);
    resolveFirst!(); // the first delivery is done
    await sleep(5);
    await saturate(s, 1); // delivered: the second observer call, pending
    await sleep(5);
    resolveFirst!(); // the old resolver again: must not free the second delivery
    await sleep(5);
    await saturate(s, 1); // dropped
    await sleep(5);
    expect(calls).toBe(2);
    expect(s.stats().droppedEvents).toBe(1);
  });

  it('a thenable resolved with a pending promise keeps the observer busy', async () => {
    let calls = 0;
    const s = createSourceSupervisor({
      maxInFlight: 1,
      onSourceEvent: () => (calls++, { then(resolve: (v: unknown) => void) { resolve(new Promise(() => {})); } }),
    });
    await saturate(s, 1);
    await sleep(5);
    await saturate(s, 2);
    await sleep(5);
    expect(calls).toBe(1);
    expect(s.stats().droppedEvents).toBe(2);
  });

  it('counters stop at Number.MAX_SAFE_INTEGER instead of losing precision', () => {
    expect(saturatingIncrement(0)).toBe(1);
    expect(saturatingIncrement(Number.MAX_SAFE_INTEGER - 1)).toBe(Number.MAX_SAFE_INTEGER);
    expect(saturatingIncrement(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(Number.isSafeInteger(saturatingIncrement(Number.MAX_SAFE_INTEGER))).toBe(true);
  });

  it('an observer that throws, rejects or returns a hostile thenable changes nothing and leaves no unhandledRejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const observers: Array<() => unknown> = [
        () => { throw new Error('observer'); },
        async () => { throw new Error('async observer'); },
        () => ({ get then() { throw new Error('then getter'); } }),
        () => ({ then() { throw new Error('then'); } }),
        () => ({ then(_ok: () => void, fail: () => void) { fail(); fail(); } }),
      ];
      for (const onSourceEvent of observers) {
        let calls = 0;
        const s = createSourceSupervisor({ maxInFlight: 1, onSourceEvent: () => (calls++, onSourceEvent()) });
        await saturate(s, 1);
        await sleep(5);
        await saturate(s, 1); // delivered: the observer is free again
        await sleep(5);
        expect(calls).toBe(2);
        expect(s.stats().droppedEvents).toBe(0);
      }
      await sleep(20);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});

describe('configuration', () => {
  const s = createSourceSupervisor({ maxInFlight: 1 });
  const fn = () => TRUSTED;

  it.each<[string, unknown, string]>([
    ['a supervisor without supervise', { trustedPrincipals: fn, sourceSupervisor: s }, 'CONFIG_PROFILE_CONTRADICTION'],
    ['supervise without a supervisor', { trustedPrincipals: fn, supervise: { trustTimeoutMs: 100 } }, 'CONFIG_PROFILE_CONTRADICTION'],
    ['a static trust set', { trustedPrincipals: TRUSTED, sourceSupervisor: s, supervise: { trustTimeoutMs: 100 } }, 'CONFIG_PROFILE_CONTRADICTION'],
    ['no trustedPrincipals', { sourceSupervisor: s, supervise: { trustTimeoutMs: 100 } }, 'CONFIG_PROFILE_CONTRADICTION'],
    ['revocation supervision without a revocationSource', { trustedPrincipals: fn, sourceSupervisor: s, supervise: { trustTimeoutMs: 100, revocation: true } }, 'CONFIG_PROFILE_CONTRADICTION'],
    ['an unknown supervise field', { trustedPrincipals: fn, sourceSupervisor: s, supervise: { trustTimeoutMs: 100, queue: 10 } }, 'CONFIG_UNKNOWN_FIELD'],
    ['a look-alike supervisor', { trustedPrincipals: fn, sourceSupervisor: { stats: () => ({}), close: async () => ({}) }, supervise: { trustTimeoutMs: 100 } }, 'CONFIG_INVALID_VALUE'],
    ...[0, -1, 1.5, 2_147_483_648, Number.NaN, '100'].map((t): [string, unknown, string] => [`trustTimeoutMs ${String(t)}`, { trustedPrincipals: fn, sourceSupervisor: s, supervise: { trustTimeoutMs: t } }, 'CONFIG_INVALID_VALUE']),
  ])('refuses %s when the middleware is created', (_name, options, code) => {
    expect(() => dcpVerify(options as DCPVerifyOptions)).toThrow(expect.objectContaining({ code }));
  });

  it('accepts trustTimeoutMs from 1 to 2147483647 and revocation: false', () => {
    for (const trustTimeoutMs of [1, 2_147_483_647]) {
      expect(() => dcpVerify({ trustedPrincipals: fn, sourceSupervisor: s, supervise: { trustTimeoutMs, revocation: false } })).not.toThrow();
    }
  });

  it.each([
    [{ maxInFlight: 0 }], [{ maxInFlight: 1.5 }], [{ maxInFlight: 2 ** 53 }], [{ maxInFlight: '2' }], [{ maxInFlight: Number.NaN }], [{}],
    [{ maxInFlight: 1, maxInFlightPerTenant: 0 }], [{ maxInFlight: 1, onSourceEvent: 'log' }], [{ maxInFlight: 1, queue: 5 }], [null],
  ])('createSourceSupervisor refuses %j', (options) => {
    expect(() => createSourceSupervisor(options as any)).toThrow(TypeError);
  });

  it.each([[{ drainMs: -1 }], [{ drainMs: 1.5 }], [{ drainMs: 2_147_483_648 }], [{ drainMs: '10' }], [null]])('close refuses %j', async (options) => {
    await expect(createSourceSupervisor({ maxInFlight: 1 }).close(options as any)).rejects.toThrow(TypeError);
  });
});
