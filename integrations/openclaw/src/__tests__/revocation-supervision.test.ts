/**
 * Supervision of the strict-v1 revocationSource in dcp_verify_bundle
 * (docs/reviews/admission-source-supervision-plan.md, step 2): the same results with and without
 * supervise.revocation, the deadline and a capacity shared with the trust source, atomic
 * reconfiguration (no replacement while either source is in flight), tool parameters that cannot
 * configure it, a Node process with nothing else pending, a supervisor made by @dcp-ai/express's
 * copy of the helper, and this package's denyListRevocationSource.
 *
 *   DCP_NEGATIVE_CONTROL=1 npx vitest run src/__tests__/revocation-supervision.test.ts   # must fail once
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { configureVerifier, createSourceSupervisor, denyListRevocationSource, executeVerifyBundle, type RevocationSource, type SourceSupervisor } from '../index.js';
import { supervise } from '../tools/source-supervisor.js';

// @dcp-ai/express's copy of the helper, loaded at run time: it lies outside this package's rootDir.
const EXPRESS_COPY = fileURLToPath(new URL('../../../express/src/source-supervisor.ts', import.meta.url));
const { createSourceSupervisor: createFromExpressCopy } = (await import(EXPRESS_COPY)) as typeof import('../tools/source-supervisor.js');

const VECTORS = JSON.parse(readFileSync(new URL('../../../../tests/interop/v2/admission_vectors.json', import.meta.url), 'utf8'));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const bundle = (name: string) => clone(VECTORS.signed_bundles[name]);
const vectorRevocation = (name: string) => clone(VECTORS.cases.find((c: any) => c.name === name).revocation);
const NOW = Date.parse(VECTORS.cases.find((c: any) => c.name === 'A_known_principal_strict').now); // every 13_* case's clock too
const STRICT = VECTORS.profiles.strict;
const TRUSTED = VECTORS.trust_sets.principal;
const NEGATIVE_CONTROL = process.env.DCP_NEGATIVE_CONTROL === '1';
const PACKAGE = fileURLToPath(new URL('../../', import.meta.url));
const CLEAR = () => vectorRevocation('A_known_principal_strict');
const TRUST_UNAVAILABLE = 'The trusted principals are unavailable (TRUST_SOURCE_FAILED)';
const UNAVAILABLE = {
  verified: true,
  admitted: false,
  profile: 'strict-v1',
  profile_compliance: 'non_compliant',
  codes: ['REVOCATION_UNAVAILABLE'],
  errors: ['no revocation status could be obtained'],
};
const invalid = () => Object.assign(new Error('unreadable'), { code: 'REVOCATION_INVALID' });

function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (check: () => boolean) => {
  for (let i = 0; i < 400 && !check(); i++) await sleep(5);
  expect(check()).toBe(true);
};

// Released after every test, also a failed one, so the reset may replace every supervisor.
const held: Array<{ resolve: (v: unknown) => void }> = [];
const used: SourceSupervisor[] = [];
afterEach(async () => {
  held.splice(0).forEach((d) => d.resolve(null));
  for (const s of used.splice(0)) await until(() => s.stats().inFlight === 0);
  configureVerifier();
});
const hold = () => {
  const d = deferred();
  held.push(d);
  return d;
};
const supervisor = (options: Parameters<typeof createSourceSupervisor>[0]) => {
  const s = createSourceSupervisor(options);
  used.push(s);
  return s;
};
/** strict-v1 with a static trust set; its revocation supervised by `s` when given. */
const configure = (revocationSource: RevocationSource, s?: SourceSupervisor, revocationTimeoutMs = 100, over: Record<string, unknown> = {}) =>
  configureVerifier({
    trustedPrincipals: TRUSTED,
    profile: STRICT,
    revocationSource,
    revocationTimeoutMs,
    clock: () => NOW,
    ...(s ? { sourceSupervisor: s, supervise: { revocation: true } } : {}),
    ...over,
  });
const run = async (params: Record<string, unknown> = {}) => (await executeVerifyBundle({ signed_bundle: bundle('base'), ...params } as any)) as any;

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

describe('dcp_verify_bundle with a supervised revocationSource', () => {
  it('answers in time: admitted as before, with a signal that is not aborted', async () => {
    const { t, source } = watched(async () => CLEAR());
    const s = supervisor({ maxInFlight: 1 });
    configure(source, s);
    // The negative control inverts this expectation.
    expect(await run()).toMatchObject({ verified: true, admitted: !NEGATIVE_CONTROL, action_authorized: false });
    expect(Object.keys(t.contexts[0]).sort()).toEqual(['signal', 'tenant']);
    expect(t.contexts[0].signal.aborted).toBe(false);
    expect(s.stats()).toMatchObject({ inFlight: 0, timeouts: 0 });
  });

  const answers: Array<[string, () => unknown, string[]]> = [
    ['not revoked', async () => CLEAR(), []],
    ['agent revoked', async () => vectorRevocation('13_agent_revoked'), ['REVOCATION_REVOKED']],
    ['stale', async () => vectorRevocation('13_stale_by_1_ms'), ['REVOCATION_STALE']],
    ['an unreadable snapshot', async () => vectorRevocation('13_extra_field'), ['REVOCATION_INVALID']],
    ['null', async () => null, ['REVOCATION_UNAVAILABLE']],
    ['a rejection', async () => { throw new Error('down'); }, ['REVOCATION_UNAVAILABLE']],
    ['a REVOCATION_INVALID rejection', async () => { throw invalid(); }, ['REVOCATION_INVALID']],
    ['a synchronous throw', () => { throw new Error('down'); }, ['REVOCATION_UNAVAILABLE']],
    ['a synchronous REVOCATION_INVALID throw', () => { throw invalid(); }, ['REVOCATION_INVALID']],
  ];
  it.each(answers)('%s: the same result with and without supervision, and with both sources supervised', async (_name, answer, codes) => {
    configure(answer as RevocationSource);
    const legacy = await run();
    configure(answer as RevocationSource, supervisor({ maxInFlight: 1 }));
    const revocationOnly = await run();
    configure(answer as RevocationSource, supervisor({ maxInFlight: 1 }), 100, { trustedPrincipals: async () => TRUSTED, supervise: { trustTimeoutMs: 2000, revocation: true } });
    const both = await run();
    expect(legacy.codes).toEqual(codes);
    expect(revocationOnly).toEqual(legacy);
    expect(both).toEqual(legacy);
  });

  it('is not asked for a bundle that is not verified', async () => {
    const { t, source } = watched(async () => CLEAR());
    configure(source, supervisor({ maxInFlight: 1 }));
    expect((await run({ signed_bundle: bundle('other_intended_verifier') })).codes).toEqual(['PROFILE_AUDIENCE_MISMATCH', 'VERIFICATION_FAILED']);
    expect(t.calls).toBe(0);
  });

  it('pending and ignoring its signal: REVOCATION_UNAVAILABLE at the deadline, the slot kept until it settles', async () => {
    const pending = hold();
    const { t, source } = watched(() => pending.promise);
    const s = supervisor({ maxInFlight: 2 });
    configure(source, s, 100);
    expect(await run()).toMatchObject(UNAVAILABLE);
    expect(t.aborted! - t.called!).toBeGreaterThanOrEqual(98);
    expect(t.aborted! - t.called!).toBeLessThan(100 + 250);
    expect(s.stats()).toMatchObject({ inFlight: 1, timeouts: 1 });
    pending.resolve(CLEAR());
    await until(() => s.stats().inFlight === 0);
    expect(s.stats().lateResults).toBe(1);
    expect((await run()).admitted).toBe(true); // a later call asks the source again
    expect(t.calls).toBe(2);
  });

  it('trust and revocation sources share one capacity: a held slot refuses revocation without calling it', async () => {
    const s = supervisor({ maxInFlight: 1 });
    const occupy = hold();
    const occupied = supervise(s, 'trust', 'elsewhere', 5000, () => occupy.promise);
    const { t, source } = watched(async () => CLEAR());
    configure(source, s);
    expect(await run()).toMatchObject(UNAVAILABLE);
    expect(t.calls).toBe(0);
    expect(s.stats().saturated).toBe(1);
    occupy.resolve(TRUSTED);
    await occupied;
    expect((await run()).admitted).toBe(true);
  });

  it('close(): a pending revocation is answered at once, its signal aborted, new calls refused without the source', async () => {
    const pending = hold();
    const { t, source } = watched(() => pending.promise);
    const s = supervisor({ maxInFlight: 2 });
    configure(source, s, 5000);
    const started = run();
    await until(() => t.calls === 1);
    expect(await s.close({ drainMs: 20 })).toEqual({ inFlight: 1 });
    expect(await started).toMatchObject(UNAVAILABLE);
    expect(t.contexts[0].signal.aborted).toBe(true);
    expect(await run()).toMatchObject(UNAVAILABLE);
    expect(t.calls).toBe(1);
    pending.resolve(CLEAR());
    await until(() => s.stats().inFlight === 0);
  });

  it('tool parameters cannot configure supervision', async () => {
    const pending = hold();
    const { t, source } = watched(() => pending.promise);
    configure(source, supervisor({ maxInFlight: 2 }), 100);
    const result = await run({ supervise: { revocation: false }, revocationTimeoutMs: 60000, sourceSupervisor: { maxInFlight: 99 } });
    expect(result.codes).toEqual(['REVOCATION_UNAVAILABLE']);
    expect(t.aborted! - t.called!).toBeLessThan(100 + 250);
  });

  it('a supervisor made by @dcp-ai/express\'s copy of the helper supervises revocation here and shares one capacity', async () => {
    const s = createFromExpressCopy({ maxInFlight: 1 });
    used.push(s);
    const occupy = hold();
    const occupied = supervise(s, 'revocation', 'elsewhere', 5000, () => occupy.promise);
    configure(async () => CLEAR(), s);
    expect((await run()).codes).toEqual(['REVOCATION_UNAVAILABLE']);
    occupy.resolve(null);
    await occupied;
    expect((await run()).admitted).toBe(true);
  });
});

describe('reconfiguration', () => {
  it('refuses another or no supervisor while a revocation source is in flight, also after close(); the same object may switch sources', async () => {
    const pending = hold();
    const s = supervisor({ maxInFlight: 2 });
    configure(() => pending.promise as any, s, 100);
    expect((await run()).codes).toEqual(['REVOCATION_UNAVAILABLE']);
    expect(s.stats().inFlight).toBe(1);
    const other = supervisor({ maxInFlight: 5 });
    const attempts = [
      () => configure(async () => CLEAR(), other),
      () => configureVerifier({ trustedPrincipals: async () => TRUSTED, sourceSupervisor: other, supervise: { trustTimeoutMs: 100 }, clock: () => NOW }),
      () => configure(async () => CLEAR()),
      () => configureVerifier(),
    ];
    for (const attempt of attempts) expect(attempt).toThrow(expect.objectContaining({ code: 'CONFIG_PROFILE_CONTRADICTION' }));
    expect(await s.close({ drainMs: 10 })).toEqual({ inFlight: 1 });
    for (const attempt of attempts) expect(attempt).toThrow(expect.objectContaining({ code: 'CONFIG_PROFILE_CONTRADICTION' }));
    // Still configured with the closed supervisor: refused without calling a source.
    expect((await run()).codes).toEqual(['REVOCATION_UNAVAILABLE']);
    pending.resolve(CLEAR());
    await until(() => s.stats().inFlight === 0);
    expect(() => configure(async () => CLEAR(), other)).not.toThrow();
    expect((await run()).admitted).toBe(true);
  });

  it('a supervisor supervising only the trust source cannot be replaced by one supervising revocation while it is in flight', async () => {
    const pending = hold();
    const a = supervisor({ maxInFlight: 1 });
    configureVerifier({ trustedPrincipals: () => pending.promise as any, profile: STRICT, revocationSource: async () => CLEAR(), sourceSupervisor: a, supervise: { trustTimeoutMs: 100 }, clock: () => NOW });
    expect((await run()).errors).toEqual([TRUST_UNAVAILABLE]);
    const b = supervisor({ maxInFlight: 1 });
    expect(() => configure(async () => CLEAR(), b)).toThrow(expect.objectContaining({ code: 'CONFIG_PROFILE_CONTRADICTION' }));
    expect(() => configure(async () => CLEAR(), a)).not.toThrow(); // the same object, now for revocation
    expect((await run()).codes).toEqual(['REVOCATION_UNAVAILABLE']); // its one slot is still taken
    pending.resolve(TRUSTED);
    await until(() => a.stats().inFlight === 0);
    expect((await run()).admitted).toBe(true);
    expect(() => configure(async () => CLEAR(), b)).not.toThrow();
  });

  it('refuses another supervisor right after a call starts, before its revocation source runs', async () => {
    const pending = hold();
    const a = supervisor({ maxInFlight: 1 });
    configure(() => pending.promise as any, a, 200);
    const started = run(); // not awaited: the call is still verifying the bundle
    expect(a.stats().inFlight).toBe(0);
    const b = supervisor({ maxInFlight: 1 });
    expect(() => configure(async () => CLEAR(), b)).toThrow(expect.objectContaining({ code: 'CONFIG_PROFILE_CONTRADICTION' }));
    expect((await started).codes).toEqual(['REVOCATION_UNAVAILABLE']);
    pending.resolve(CLEAR());
    await until(() => a.stats().inFlight === 0);
    expect(() => configure(async () => CLEAR(), b)).not.toThrow();
  });

  it('an invalid configuration changes nothing: the supervised revocation stays', async () => {
    const { t, source } = watched(async () => CLEAR());
    const s = supervisor({ maxInFlight: 1 });
    configure(source, s);
    for (const bad of [
      () => configure(source, s, 1.5),
      () => configure(source, s, 100, { supervise: { revocation: 'yes' } }),
      () => configure(source, s, 100, { supervise: {} }),
      () => configureVerifier({ trustedPrincipals: async () => TRUSTED, sourceSupervisor: s, supervise: { revocation: true }, clock: () => NOW }),
      () => configure(source, s, 100, { supervise: { trustTimeoutMs: 100, revocation: true } }), // static trust set
    ]) {
      expect(bad).toThrow();
    }
    expect((await run()).admitted).toBe(true);
    expect(Object.keys(t.contexts[0]).sort()).toEqual(['signal', 'tenant']);
  });
});

describe('denyListRevocationSource (this package\'s copy)', () => {
  it.each([['headers that never come', false], ['a 200 whose body stops halfway', true]])(
    'under supervision the deadline aborts its fetch on %s: the server sees the connection close and the slot frees',
    async (_name, partialBody) => {
      const requests: Array<{ closed: boolean }> = [];
      const server = createServer((req, res) => {
        const entry = { closed: false };
        requests.push(entry);
        req.socket.on('close', () => (entry.closed = true));
        if (partialBody) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.write('{"checked_at":');
        }
      });
      try {
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
        const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/.well-known/dcp-revocations.json`;
        const s = supervisor({ maxInFlight: 1 });
        configure(denyListRevocationSource({ url, timeoutMs: 60_000 }), s, 200);
        expect(await run()).toMatchObject(UNAVAILABLE);
        expect(requests).toHaveLength(1);
        await until(() => requests[0].closed);
        await until(() => s.stats().inFlight === 0);
        expect(s.stats()).toMatchObject({ timeouts: 1, lateErrors: 1 });
      } finally {
        server.closeAllConnections();
        await new Promise((r) => server.close(r));
      }
    },
  );

  it('called directly, a timeoutMs AbortSignal.timeout refuses is REVOCATION_UNAVAILABLE, as before', async () => {
    for (const timeoutMs of [1.5, 4_294_967_296]) {
      const source = denyListRevocationSource({ url: 'https://127.0.0.1/unused', timeoutMs });
      await expect(source({ agent_ids: [], kids: [] } as any, { tenant: '' })).rejects.toMatchObject({ code: 'REVOCATION_UNAVAILABLE' });
    }
  });
});

describe('a Node process with nothing else pending', () => {
  it('stays alive until the revocation deadline answers, then exits', () => {
    expect(existsSync(new URL('../../dist/index.js', import.meta.url))).toBe(true); // npm run build first
    const script = `
      import { readFileSync } from 'node:fs';
      import { configureVerifier, createSourceSupervisor, executeVerifyBundle } from './dist/index.js';
      const v = JSON.parse(readFileSync('../../tests/interop/v2/admission_vectors.json', 'utf8'));
      const now = Date.parse(v.cases.find((c) => c.name === 'A_known_principal_strict').now);
      configureVerifier({
        trustedPrincipals: v.trust_sets.principal,
        profile: v.profiles.strict,
        revocationSource: () => new Promise(() => {}), // never settles, holds no handle
        revocationTimeoutMs: 300,
        sourceSupervisor: createSourceSupervisor({ maxInFlight: 1 }),
        supervise: { revocation: true },
        clock: () => now,
      });
      const result = await executeVerifyBundle({ signed_bundle: v.signed_bundles.base });
      console.log(JSON.stringify({ admitted: result.admitted, codes: result.codes }));
    `;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: PACKAGE, encoding: 'utf8', timeout: 10_000 });
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(0);
    expect(JSON.parse(child.stdout.trim())).toEqual({ admitted: false, codes: ['REVOCATION_UNAVAILABLE'] });
  });
});
