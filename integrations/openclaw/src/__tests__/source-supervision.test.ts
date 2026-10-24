/**
 * Source supervision of the trustedPrincipals function in dcp_verify_bundle
 * (docs/reviews/admission-source-supervision-plan.md, step 1): the deadline and capacity, atomic
 * reconfiguration with a supervisor that has invocations in flight, tool parameters that cannot
 * configure it, a Node process with nothing else pending, and a supervisor made by
 * @dcp-ai/express's copy of the helper.
 *
 *   DCP_NEGATIVE_CONTROL=1 npx vitest run src/__tests__/source-supervision.test.ts   # must fail once
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureVerifier, createSourceSupervisor, executeVerifyBundle, type SourceSupervisor } from '../index.js';
import { supervise } from '../tools/source-supervisor.js';

// @dcp-ai/express's copy of the helper, loaded at run time: it lies outside this package's rootDir.
const EXPRESS_COPY = fileURLToPath(new URL('../../../express/src/source-supervisor.ts', import.meta.url));
const { createSourceSupervisor: createFromExpressCopy } = (await import(EXPRESS_COPY)) as typeof import('../tools/source-supervisor.js');

const VECTORS = JSON.parse(readFileSync(new URL('../../../../tests/interop/v2/admission_vectors.json', import.meta.url), 'utf8'));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const bundle = (name: string) => clone(VECTORS.signed_bundles[name]);
const NOW = Date.parse(VECTORS.cases.find((c: any) => c.name === 'A_known_principal_strict').now);
const STRICT = VECTORS.profiles.strict;
const TRUSTED = VECTORS.trust_sets.principal;
const EMPTY = VECTORS.trust_sets.empty;
const NEGATIVE_CONTROL = process.env.DCP_NEGATIVE_CONTROL === '1';
const UNAVAILABLE = 'The trusted principals are unavailable (TRUST_SOURCE_FAILED)';
const PACKAGE = fileURLToPath(new URL('../../', import.meta.url));

function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await sleep(5);
  expect(check()).toBe(true);
};

// Every test leaves its supervisors without invocations in flight, so the reset may replace them.
const held: Array<{ resolve: (v: unknown) => void }> = [];
const used: SourceSupervisor[] = [];
afterEach(async () => {
  held.splice(0).forEach((d) => d.resolve(TRUSTED));
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
const configure = (s: SourceSupervisor, trustedPrincipals: (context: any) => unknown, trustTimeoutMs = 100, over: Record<string, unknown> = {}) =>
  configureVerifier({ trustedPrincipals: trustedPrincipals as any, sourceSupervisor: s, supervise: { trustTimeoutMs }, clock: () => NOW, ...over });
const run = async (params: Record<string, unknown> = {}) => {
  const started = performance.now();
  const result = await executeVerifyBundle({ signed_bundle: bundle('base'), ...params } as any);
  return { result, ms: performance.now() - started };
};

describe('dcp_verify_bundle with a supervised trustedPrincipals function', () => {
  it('answers in time: admitted as before, with a signal that is not aborted', async () => {
    const contexts: any[] = [];
    configure(supervisor({ maxInFlight: 1 }), (context) => (contexts.push(context), TRUSTED));
    const { result } = await run();
    // The negative control inverts this expectation.
    expect(result).toMatchObject({ verified: true, admitted: !NEGATIVE_CONTROL, action_authorized: false });
    expect(Object.keys(contexts[0]).sort()).toEqual(['signal', 'tenant']);
    expect(contexts[0].signal.aborted).toBe(false);
  });

  it('pending: refused at the deadline with the result of a failing source; the profile\'s revocation is not asked', async () => {
    const pending = hold();
    let revocations = 0;
    const revocationSource = async () => (revocations++, null);
    configureVerifier({ trustedPrincipals: () => { throw new Error('down'); }, profile: STRICT, revocationSource, clock: () => NOW });
    const failing = (await run()).result;
    configure(supervisor({ maxInFlight: 1 }), () => pending.promise, 100, { profile: STRICT, revocationSource });
    const { result, ms } = await run();
    expect(result).toEqual(failing);
    expect(result).toMatchObject({ admitted: false, codes: [], errors: [UNAVAILABLE], action_authorized: false });
    expect(ms).toBeGreaterThanOrEqual(95);
    expect(ms).toBeLessThan(100 + 250);
    expect(revocations).toBe(0);
  });

  it('a late trust set is never used; the next invocation asks again (withdrawal, then restoration)', async () => {
    const answers: Array<() => unknown> = [() => sleep(200).then(() => TRUSTED), () => EMPTY, () => TRUSTED];
    const s = supervisor({ maxInFlight: 1 });
    configure(s, () => answers.shift()!());
    expect((await run()).result.admitted).toBe(false);
    await until(() => s.stats().lateResults === 1);
    expect((await run()).result).toMatchObject({ admitted: false, codes: ['TRUST_PRINCIPAL_UNKNOWN'] });
    expect((await run()).result.admitted).toBe(true);
  });

  // The time of invocation N+1 includes the bundle's verification, so it is not asserted here; the
  // fake-clock test below shows the supervisor answers saturated with no wait.
  it('capacity: invocation N+1 is refused without calling the source while the timed-out source still runs', async () => {
    const pending = hold();
    let calls = 0;
    const s = supervisor({ maxInFlight: 1 });
    configure(s, () => (calls++ === 0 ? pending.promise : TRUSTED));
    expect((await run()).result.errors).toEqual([UNAVAILABLE]);
    const refused = await run(); // the first source has not settled: its slot is still taken
    expect(refused.result.errors).toEqual([UNAVAILABLE]);
    expect(calls).toBe(1);
    expect(s.stats()).toMatchObject({ inFlight: 1, timeouts: 1, saturated: 1 });
    pending.resolve(TRUSTED);
    await until(() => s.stats().inFlight === 0);
    expect((await run()).result.admitted).toBe(true);
  });

  it('tool parameters cannot configure supervision', async () => {
    const pending = hold();
    let calls = 0;
    const s = supervisor({ maxInFlight: 1 });
    configure(s, () => (calls++, pending.promise));
    const { result, ms } = await run({ supervise: { trustTimeoutMs: 60000 }, sourceSupervisor: { maxInFlight: 99 }, trustTimeoutMs: 60000 });
    expect(result.errors).toEqual([UNAVAILABLE]);
    expect(ms).toBeLessThan(100 + 250);
    const policy = await run({ verifier_policy: { trustTimeoutMs: 60000 } });
    expect(policy.result.verified).toBe(false);
    expect(policy.result.errors.join(' ')).toMatch(/trustTimeoutMs/);
    expect(calls).toBe(1);
  });
});

describe('configureVerifier with a source supervisor', () => {
  it('keeps the same supervisor with a new trust set, profile or deadline; its counters and the old deadline stay', async () => {
    const pending = hold();
    const s = supervisor({ maxInFlight: 2 });
    configure(s, () => pending.promise, 300);
    const old = run();
    await until(() => s.stats().inFlight === 1);
    configure(s, () => TRUSTED, 5000, { profile: STRICT, revocationSource: async (subjects: any) => ({
      checked_at: new Date(NOW - 30_000).toISOString(),
      agents: Object.fromEntries(subjects.agent_ids.map((id: string) => [id, 'not_revoked'])),
      keys: Object.fromEntries(subjects.kids.map((kid: string) => [kid, 'not_revoked'])),
    }) });
    expect(s.stats().inFlight).toBe(1);
    const { ms } = await old; // decided by the deadline it started with, not the new one
    expect(ms).toBeLessThan(300 + 250);
    expect((await run()).result).toMatchObject({ admitted: true, profile: 'strict-v1' });
  });

  it('refuses to replace or remove a supervisor with invocations in flight, even after close(); the old configuration stays', async () => {
    const pending = hold();
    const s = supervisor({ maxInFlight: 1 });
    configure(s, () => pending.promise);
    await run();
    expect(s.stats().inFlight).toBe(1);
    const other = supervisor({ maxInFlight: 5 });
    const attempts = [
      () => configure(other, () => TRUSTED),
      () => configureVerifier({ trustedPrincipals: () => TRUSTED, clock: () => NOW }),
      () => configureVerifier(),
    ];
    for (const attempt of attempts) expect(attempt).toThrow(expect.objectContaining({ code: 'CONFIG_PROFILE_CONTRADICTION' }));
    expect(await s.close({ drainMs: 10 })).toEqual({ inFlight: 1 });
    for (const attempt of attempts) expect(attempt).toThrow(expect.objectContaining({ code: 'CONFIG_PROFILE_CONTRADICTION' }));
    // Still configured with the closed supervisor: refused, and the trust function is not called.
    expect((await run()).result.errors).toEqual([UNAVAILABLE]);
    pending.resolve(TRUSTED);
    await until(() => s.stats().inFlight === 0);
    expect(() => configure(other, () => TRUSTED)).not.toThrow();
    expect((await run()).result.admitted).toBe(true);
  });

  it('refuses another or no supervisor right after a call starts, before its trust source runs', async () => {
    const pending = hold();
    const a = supervisor({ maxInFlight: 1 });
    configure(a, () => pending.promise, 200);
    const started = run(); // not awaited: the call is still verifying the bundle
    expect(a.stats().inFlight).toBe(0); // its trust source has not started yet
    const b = supervisor({ maxInFlight: 1 });
    const refusals = [
      () => configure(b, () => TRUSTED),
      () => configureVerifier({ trustedPrincipals: () => TRUSTED, clock: () => NOW }),
      () => configureVerifier(),
    ];
    for (const refusal of refusals) expect(refusal).toThrow(expect.objectContaining({ code: 'CONFIG_PROFILE_CONTRADICTION' }));
    expect(() => configure(a, () => pending.promise, 200)).not.toThrow(); // the same object may stay
    const { result } = await started;
    expect(result.errors).toEqual([UNAVAILABLE]);
    expect(a.stats().inFlight).toBe(1); // the call answered; its source still runs under a
    expect(refusals[0]).toThrow(expect.objectContaining({ code: 'CONFIG_PROFILE_CONTRADICTION' }));
    pending.resolve(TRUSTED);
    await until(() => a.stats().inFlight === 0);
    expect(() => configure(b, () => TRUSTED)).not.toThrow();
    expect((await run()).result.admitted).toBe(true);
  });

  it('a call that is admitted, refused by its source, or meets a closed supervisor stops holding the supervisor', async () => {
    const a = supervisor({ maxInFlight: 1 });
    const b = supervisor({ maxInFlight: 1 });
    configure(a, () => TRUSTED);
    expect((await run()).result.admitted).toBe(true);
    expect(() => configure(b, () => { throw new Error('down'); })).not.toThrow();
    expect((await run()).result.errors).toEqual([UNAVAILABLE]);
    expect(() => configure(a, () => TRUSTED)).not.toThrow();
    const started = run();
    await a.close();
    expect((await started).result.errors).toEqual([UNAVAILABLE]); // its source never started
    expect(a.stats()).toMatchObject({ inFlight: 0, closed: 1 });
    expect(() => configure(b, () => TRUSTED)).not.toThrow();
    expect((await run()).result.admitted).toBe(true);
  });

  it('an invalid configuration changes nothing', async () => {
    const s = supervisor({ maxInFlight: 1 });
    configure(s, () => TRUSTED);
    for (const bad of [
      () => configure(s, () => TRUSTED, 0),
      () => configureVerifier({ trustedPrincipals: () => TRUSTED, sourceSupervisor: s, supervise: { trustTimeoutMs: 100, revocation: true } as any }),
      () => configureVerifier({ trustedPrincipals: TRUSTED, sourceSupervisor: s, supervise: { trustTimeoutMs: 100 } }),
    ]) {
      expect(bad).toThrow();
    }
    expect((await run()).result.admitted).toBe(true);
  });

  it('a supervisor made by @dcp-ai/express\'s copy of the helper works here and shares one capacity', async () => {
    const s = createFromExpressCopy({ maxInFlight: 1 });
    used.push(s);
    const occupy = hold();
    const occupied = supervise(s, 'trust', 'elsewhere', 5000, () => occupy.promise);
    configure(s, () => TRUSTED);
    expect((await run()).result.errors).toEqual([UNAVAILABLE]);
    expect(s.stats().saturated).toBe(1);
    occupy.resolve(TRUSTED);
    await occupied;
    expect((await run()).result.admitted).toBe(true);
  });
});

describe('the supervisor on a fake clock', () => {
  it('answers invocation N+1 saturated in microtasks: no timer advanced or added, no queue, no extra source call', async () => {
    vi.useFakeTimers();
    try {
      const s = createSourceSupervisor({ maxInFlight: 1 });
      const first = deferred();
      let calls = 0;
      const holding = supervise(s, 'trust', 't', 1000, () => (calls++, first.promise));
      expect(vi.getTimerCount()).toBe(1); // the first invocation's own deadline
      let outcome: unknown;
      void supervise(s, 'trust', 't', 1000, () => (calls++, TRUSTED)).then((o) => {
        outcome = o;
      });
      expect(vi.getTimerCount()).toBe(1); // nothing scheduled for the second
      await Promise.resolve();
      await Promise.resolve(); // microtasks only: no timer has run
      expect(outcome).toEqual({ status: 'saturated' });
      expect(calls).toBe(1);
      expect(s.stats()).toMatchObject({ inFlight: 1, tenants: 1, saturated: 1, timeouts: 0 });
      first.resolve(TRUSTED);
      expect(await holding).toEqual({ status: 'ok', value: TRUSTED });
      expect(vi.getTimerCount()).toBe(0); // its deadline timer was cleared
      expect(s.stats()).toMatchObject({ inFlight: 0, tenants: 0, saturated: 1, timeouts: 0, lateResults: 0 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a Node process with nothing else pending', () => {
  it('stays alive until the deadline answers, then exits', () => {
    expect(existsSync(new URL('../../dist/index.js', import.meta.url))).toBe(true); // npm run build first
    const script = `
      import { readFileSync } from 'node:fs';
      import { configureVerifier, createSourceSupervisor, executeVerifyBundle } from './dist/index.js';
      const v = JSON.parse(readFileSync('../../tests/interop/v2/admission_vectors.json', 'utf8'));
      const now = Date.parse(v.cases.find((c) => c.name === 'A_known_principal_strict').now);
      configureVerifier({
        trustedPrincipals: () => new Promise(() => {}), // never settles, holds no handle
        sourceSupervisor: createSourceSupervisor({ maxInFlight: 1 }),
        supervise: { trustTimeoutMs: 300 },
        clock: () => now,
      });
      const started = performance.now();
      const result = await executeVerifyBundle({ signed_bundle: v.signed_bundles.base });
      console.log(JSON.stringify({ ms: performance.now() - started, admitted: result.admitted, errors: result.errors }));
    `;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: PACKAGE, encoding: 'utf8', timeout: 10_000 });
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(0);
    const out = JSON.parse(child.stdout.trim());
    expect(out).toMatchObject({ admitted: false, errors: [UNAVAILABLE] });
    expect(out.ms).toBeGreaterThanOrEqual(295);
    expect(out.ms).toBeLessThan(300 + 1000);
  });
});
