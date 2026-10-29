/**
 * Gate 7, dcp-jcs-v1 side (docs/proposals/canonicalization-candidate/README.md §9): a defect of each unit class,
 * injected at byte level into a dcp-jcs-v1 bundle, keeps today's verdict. The public fixture
 * tests/interop/candidate/gate7-v1-negatives.json has 38 cases over the frozen phase 3 bases (18 mutations on
 * B-v1 and on B-absent, and 2 controls) with a reasoned expectation for each of 10 configurations; this file runs
 * the two TypeScript ones (76 checks) and, apart, the 3 envelope boundary cases (no equivalence claimed).
 *
 * For each case the experimental verifier (§17, bare, ["dcp-jcs-v1"]) and today's route of this SDK, written out
 * here (the real decoder, then verifySignedBundleV2; never the adapter object or the router), get the same bytes,
 * clock and policy. Their results must be deeply equal on every declared field, and both must match the committed
 * expectation. A verifier exception on either side is never parity and never a rejection. The verifiers the
 * experimental route really entered are observed through its internal test probe, not read from its result.
 */
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import { AlgorithmRegistry } from '../core/crypto-registry.js';
import { experimentalHistoricalAdapters } from '../core/experimental-candidate-router.js';
import type { ExperimentalHistoricalAdapter } from '../core/experimental-candidate-router.js';
import { createExperimentalCandidateVerifierForTests } from '../core/experimental-candidate-verify.js';
import type { ExperimentalCandidateVerifyResult } from '../core/experimental-candidate-verify.js';
import { DEFAULT_VERIFIER_POLICY, verifySignedBundleV2 } from '../core/verify-v2.js';
import type { VerifyV2Result } from '../core/verify-v2.js';
import { Ed25519Provider } from '../providers/ed25519.js';
import { MlDsa65Provider } from '../providers/ml-dsa-65.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../../..');
const F = JSON.parse(readFileSync(resolve(ROOT, 'tests/interop/candidate/gate7-v1-negatives.json'), 'utf8'));
const P3 = JSON.parse(readFileSync(resolve(ROOT, 'tests/interop/candidate/phase3-signed-vectors.json'), 'utf8'));

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const MUTATIONS = Array.from({ length: 18 }, (_, i) => `M${String(i + 1).padStart(2, '0')}`);
const APPROVED = ['V1', 'AB'].flatMap((t) => ['C00', ...MUTATIONS].map((s) => `G7-${t}-${s}`));
const CONFIGS = ['ts.textDecoderJsonParse', 'ts.bufferUtf8JsonParse'] as const;
type Config = (typeof CONFIGS)[number];
const ADAPTER: Record<Config, ExperimentalHistoricalAdapter> = {
  'ts.textDecoderJsonParse': experimentalHistoricalAdapters.textDecoderJsonParse,
  'ts.bufferUtf8JsonParse': experimentalHistoricalAdapters.bufferUtf8JsonParse,
};
// Today's decoders, written out as a current caller writes them.
const TODAY_DECODE: Record<Config, (b: Uint8Array) => unknown> = {
  'ts.textDecoderJsonParse': (b) => JSON.parse(new TextDecoder().decode(b)),
  'ts.bufferUtf8JsonParse': (b) => JSON.parse(Buffer.from(b).toString('utf8')),
};
// The declared fields of VerifyV2Result: equality between the routes is deep equality over exactly these.
const DECLARED_TOP = ['verified', 'errors', 'warnings', 'details'];
const DECLARED_DETAILS = [
  'session_nonce', 'session_expires_at', 'intended_verifier', 'manifest_valid', 'signature_valid', 'policy_satisfied',
  'hash_chain_valid', 'pq_checkpoints_valid', 'verification_mode', 'resolved_tier', 'advisory_rejected_algs', 'signer_keys',
];

const registry = new AlgorithmRegistry();
registry.registerSigner(new Ed25519Provider());
registry.registerSigner(new MlDsa65Provider());
const NOW: number = F.now_ms;
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

// The edit grammar of the fixture (independent of the Python checker, which must agree on every hash).
function applyEdits(base: Uint8Array, edits: Json[]): Uint8Array {
  let out = Buffer.from(base);
  for (const e of edits) {
    if ('prefix' in e) out = Buffer.concat([Buffer.from(e.prefix, 'utf8'), out]);
    else if ('prefix_hex' in e) out = Buffer.concat([Buffer.from(e.prefix_hex, 'hex'), out]);
    else if ('append' in e) out = Buffer.concat([out, Buffer.from(e.append, 'utf8')]);
    else if ('append_hex' in e) out = Buffer.concat([out, Buffer.from(e.append_hex, 'hex')]);
    else if ('drop_last' in e) out = out.subarray(0, out.length - e.drop_last);
    else if ('replace_once' in e) {
      const find = Buffer.from(e.replace_once, 'utf8');
      const at = out.indexOf(find);
      if (at < 0 || out.indexOf(find, at + 1) >= 0) throw new Error(`anchor not unique: ${e.replace_once}`);
      const w = 'with_hex' in e ? Buffer.from(e.with_hex, 'hex') : Buffer.from(e.with, 'utf8');
      out = Buffer.concat([out.subarray(0, at), w, out.subarray(at + find.length)]);
    } else throw new Error(`unknown edit ${JSON.stringify(e)}`);
  }
  return new Uint8Array(out);
}
const baseBytes = (name: string) => new Uint8Array(Buffer.from(P3.bases[name].input_json, 'utf8'));
const caseBytes = (c: Json) => (c.mutation === null ? baseBytes(c.base) : applyEdits(baseBytes(c.base), F.mutations[c.mutation].edits));

// ── The two routes, each classified into exactly one outcome ──

type Today =
  | { outcome: 'verified_result'; result: VerifyV2Result }
  | { outcome: 'host_decode_error'; kind: string }
  | { outcome: 'verifier_error'; message: string };
type Experimental =
  | { outcome: 'returned'; value: ExperimentalCandidateVerifyResult; calls: number; entries: string[] }
  | { outcome: 'verifier_error'; message: string };

async function today(cfg: Config, bytes: Uint8Array, now = NOW): Promise<Today> {
  let value: unknown;
  try {
    value = TODAY_DECODE[cfg](bytes);
  } catch (e) {
    if (e instanceof SyntaxError || e instanceof RangeError) return { outcome: 'host_decode_error', kind: e.name };
    throw e; // infrastructure: fails the run
  }
  try {
    return { outcome: 'verified_result', result: await verifySignedBundleV2(value as Json, registry, DEFAULT_VERIFIER_POLICY, { now }) };
  } catch (e) {
    return { outcome: 'verifier_error', message: String((e as Error)?.message ?? e) };
  }
}

async function experimental(cfg: Config, bytes: Uint8Array, transport: 'bare' | 'envelope' = 'bare', now = NOW): Promise<Experimental> {
  const real = ADAPTER[cfg];
  let calls = 0;
  const counted: ExperimentalHistoricalAdapter = { name: real.name, decode: (u) => (calls++, real.decode(u)) };
  const entries: string[] = [];
  const verifier = createExperimentalCandidateVerifierForTests(
    { transport, acceptedProfiles: ['dcp-jcs-v1'], historical: counted },
    { enter: (profile) => entries.push(profile) },
  );
  try {
    return { outcome: 'returned', value: await verifier.verify(bytes, registry, DEFAULT_VERIFIER_POLICY, { now }), calls, entries };
  } catch (e) {
    return { outcome: 'verifier_error', message: String((e as Error)?.message ?? e) };
  }
}

// ── The judgement: pure, so the self-tests can feed it fakes ──

function routeShape(route: Json, transport: boolean): Json {
  if (route.outcome === 'v1_path') {
    return {
      outcome: 'v1_path',
      profile_source: route.profileSource,
      warning_classes: route.warnings.map((w: Json) => w.class),
      historical: 'decoded' in route.historical ? 'decoded' : 'failed',
    };
  }
  if (route.outcome === 'reject') return transport ? { outcome: 'reject', class: route.class, detail: route.detail } : { outcome: 'reject', class: route.class, offset: route.offset };
  return { outcome: route.outcome };
}

function undeclared(r: Json): string[] {
  const out = Object.keys(r).filter((k) => !DECLARED_TOP.includes(k));
  if (r.details !== undefined) out.push(...Object.keys(r.details).filter((k) => !DECLARED_DETAILS.includes(k)).map((k) => `details.${k}`));
  return out;
}

function shapeProblems(r: Json, name: string): string[] {
  const s = F.verification_shapes[name];
  const p: string[] = [];
  if (r.verified !== s.verified) p.push(`verified ${r.verified}, expected ${s.verified}`);
  if (!Array.isArray(r.errors) || r.errors.length !== s.error_count) p.push(`${r.errors?.length} errors, expected ${s.error_count}: ${JSON.stringify(r.errors)}`);
  for (const sub of s.errors_contain) if (!r.errors?.some((e: string) => e.includes(sub))) p.push(`no error contains ${JSON.stringify(sub)}: ${JSON.stringify(r.errors)}`);
  if (JSON.stringify(r.warnings ?? null) !== JSON.stringify(s.warnings)) p.push(`warnings ${JSON.stringify(r.warnings)}, expected ${JSON.stringify(s.warnings)}`);
  for (const [k, v] of Object.entries(s.fields)) if ((r.details?.[k] ?? null) !== v) p.push(`${k} ${JSON.stringify(r.details?.[k])}, expected ${JSON.stringify(v)}`);
  return p;
}

function judge(exp: Json, t: Today | null, x: Experimental, transport = false): string[] {
  const p: string[] = [];
  if (x.outcome === 'verifier_error') return [`experimental verifier_error: ${x.message}`];
  if (t?.outcome === 'verifier_error') return [`today verifier_error: ${t.message}`];
  const { route, entered, verification } = x.value;
  const got = routeShape(route, transport);
  if (JSON.stringify(got) !== JSON.stringify(exp.route)) p.push(`route ${JSON.stringify(got)}, expected ${JSON.stringify(exp.route)}`);
  if (x.calls !== exp.adapter_calls) p.push(`adapter calls ${x.calls}, expected ${exp.adapter_calls}`);
  if (entered !== exp.entered) p.push(`entered ${entered}, expected ${exp.entered}`);
  // The entries the probe observed: exactly none, or exactly one dcp-jcs-v1 entry; never the candidate, never two.
  const wanted = exp.entered === 'none' ? [] : ['dcp-jcs-v1'];
  if (JSON.stringify(x.entries) !== JSON.stringify(wanted)) p.push(`verifier entries ${JSON.stringify(x.entries)}, expected ${JSON.stringify(wanted)}`);
  if (JSON.stringify(x.entries) !== JSON.stringify(entered === 'none' ? [] : [entered])) p.push(`verifier entries ${JSON.stringify(x.entries)} contradict entered ${entered}`);
  if (exp.verification === null) {
    if (verification !== null) p.push('a verification where none was expected');
  } else if (verification === null) p.push(`no verification, expected ${exp.verification}`);
  else {
    p.push(...undeclared(verification).map((k) => `experimental result has undeclared field ${k}`));
    p.push(...shapeProblems(verification, exp.verification).map((m) => `experimental: ${m}`));
  }
  if (t === null) return p; // boundary: no today, no equivalence
  if (t.outcome !== exp.today.outcome) p.push(`today ${t.outcome}, expected ${exp.today.outcome}`);
  else if (t.outcome === 'host_decode_error') {
    if (t.kind !== exp.today.kind) p.push(`today decoder error ${t.kind}, expected ${exp.today.kind}`);
    if (entered !== 'none') p.push('today refused the bytes but the experimental route entered a verifier');
  } else if (t.outcome === 'verified_result') {
    p.push(...undeclared(t.result).map((k) => `today result has undeclared field ${k}`));
    if (exp.verification !== null) p.push(...shapeProblems(t.result, exp.verification).map((m) => `today: ${m}`));
    if (verification === null) p.push('today verified a result but the experimental route entered no verifier');
    else if (JSON.stringify(t.result) !== JSON.stringify(verification)) {
      p.push(`the routes differ: today ${JSON.stringify(t.result).slice(0, 300)} / experimental ${JSON.stringify(verification).slice(0, 300)}`);
    }
  }
  return p;
}

// ── Running the fixture ──

type Outcome = { id: string; cfg: Config; problems: string[] };

async function runCase(c: Json, cfg: Config): Promise<{ problems: string[]; t: Today; x: Experimental }> {
  const bytes = caseBytes(c);
  const before = sha(bytes);
  const t = await today(cfg, bytes);
  const afterToday = sha(bytes);
  const x = await experimental(cfg, bytes);
  const problems = judge(c.expected[cfg], t, x);
  if (afterToday !== before || sha(bytes) !== before) problems.push('the input buffer was changed');
  return { problems, t, x };
}

function gate(results: Outcome[]): Outcome[] {
  // A failed or missing control invalidates every case of its base, in the same configuration.
  return results.map((r) => {
    if (r.id.endsWith('C00')) return r;
    const id = `${r.id.slice(0, 6)}C00`;
    const control = results.find((o) => o.cfg === r.cfg && o.id === id);
    if (!control) return { ...r, problems: [`control_missing: ${id}`, ...r.problems] };
    if (control.problems.length === 0) return r;
    return { ...r, problems: [`control_failed: ${control.id}`, ...r.problems] };
  });
}

describe('gate 7, dcp-jcs-v1 side: fixture', () => {
  it('carries exactly the 38 approved case IDs and the 10 configurations', () => {
    expect(F.schema).toBe('dcp-ai.candidate.gate7-v1/1');
    expect(F.cases.map((c: Json) => c.id).sort()).toEqual([...APPROVED].sort());
    expect(new Set(F.cases.map((c: Json) => c.id)).size).toBe(38);
    expect(F.configurations).toHaveLength(10);
    expect(F.configurations).toEqual(expect.arrayContaining([...CONFIGS]));
    for (const c of F.cases) expect(Object.keys(c.expected)).toEqual(F.configurations);
    expect(F.boundary.cases.map((c: Json) => c.id)).toEqual(['G7E-1', 'G7E-2', 'G7E-3']);
  });

  it('rebuilds every input from the frozen bases with the hashes the fixture records', () => {
    expect(F.now_ms).toBe(P3.now_ms);
    for (const b of ['B-v1', 'B-absent']) expect(sha(baseBytes(b))).toBe(F.bases[b].input_sha256);
    for (const c of F.cases) expect(sha(caseBytes(c)), c.id).toBe(c.input_sha256);
    for (const c of F.boundary.cases) expect(sha(applyEdits(baseBytes(c.base), c.edits)), c.id).toBe(c.input_sha256);
  });
});

describe('gate 7, dcp-jcs-v1 side: 38 cases x 2 TypeScript configurations', () => {
  it('each route equals today on identical bytes, clock and policy, and both equal the expectation', async () => {
    const results: Outcome[] = [];
    for (const cfg of CONFIGS) {
      for (const c of F.cases) results.push({ id: c.id, cfg, problems: (await runCase(c, cfg)).problems });
    }
    expect(results).toHaveLength(76); // completeness: zero executed checks can never pass
    const failures = gate(results).filter((r) => r.problems.length > 0);
    expect(failures.map((f) => `${f.cfg} ${f.id}: ${f.problems.join(' | ')}`)).toEqual([]);
  }, 120_000);
});

describe('gate 7: envelope boundary (separate; no equivalence with any server)', () => {
  it('G7E-1 verifies with the bare control\'s declared fields; G7E-2 and G7E-3 enter no verifier', async () => {
    const control = F.cases.find((c: Json) => c.id === 'G7-V1-C00');
    let checks = 0;
    for (const cfg of CONFIGS) {
      const bare = await experimental(cfg, caseBytes(control));
      for (const c of F.boundary.cases) {
        const x = await experimental(cfg, applyEdits(baseBytes(c.base), c.edits), 'envelope');
        const problems = judge(c.expected[cfg], null, x, true);
        if (c.id === 'G7E-1' && x.outcome === 'returned' && bare.outcome === 'returned') {
          expect(JSON.stringify(x.value.verification), `${cfg} G7E-1`).toBe(JSON.stringify(bare.value.verification));
        }
        expect(problems, `${cfg} ${c.id}`).toEqual([]);
        checks++;
      }
    }
    expect(checks).toBe(6);
  }, 60_000);
});

describe('gate 7: the judgement can fail (sensitivity and self-similarity)', () => {
  const control = F.cases.find((c: Json) => c.id === 'G7-V1-C00');
  const m10 = F.cases.find((c: Json) => c.id === 'G7-V1-M10');
  const cfg: Config = 'ts.textDecoderJsonParse';

  it('reports the experimental route at a time outside the bundle window', async () => {
    const bytes = caseBytes(control);
    const t = await today(cfg, bytes);
    const late = await experimental(cfg, bytes, 'bare', Date.parse('2100-01-02T00:00:00Z'));
    expect(judge(control.expected[cfg], t, late).some((m) => m.startsWith('the routes differ'))).toBe(true);
  });

  it('reports one changed error entry', async () => {
    const { t, x } = await runCase(m10, cfg);
    expect(judge(m10.expected[cfg], t, x)).toEqual([]);
    if (x.outcome !== 'returned' || x.value.verification === null) throw new Error('M10 must enter a verifier');
    const altered = { ...x, value: { ...x.value, verification: { ...x.value.verification, errors: ['intent: payload_hash mismatch (altered)'] } } } as Experimental;
    expect(judge(m10.expected[cfg], t, altered).some((m) => m.startsWith('the routes differ'))).toBe(true);
  });

  it('reports a verifier exception on either side, even when both throw', () => {
    const exp = control.expected[cfg];
    const boom = { outcome: 'verifier_error', message: 'provider exploded' } as const;
    expect(judge(exp, boom, boom)).toEqual(['experimental verifier_error: provider exploded']);
  });

  it('reports a second verifier entry, a candidate entry, and an entry under entered: none', async () => {
    const { t, x } = await runCase(control, cfg);
    if (x.outcome !== 'returned') throw new Error('the control must return');
    expect(x.entries).toEqual(['dcp-jcs-v1']);
    const exp = control.expected[cfg];
    for (const entries of [['dcp-jcs-v1', 'dcp-jcs-v1'], ['dcp-jcs-v2'], []]) {
      expect(judge(exp, t, { ...x, entries }).some((m) => m.startsWith('verifier entries')), JSON.stringify(entries)).toBe(true);
    }
    const g7e2 = F.boundary.cases.find((c: Json) => c.id === 'G7E-2');
    const rejected = await experimental(cfg, applyEdits(baseBytes(g7e2.base), g7e2.edits), 'envelope');
    if (rejected.outcome !== 'returned') throw new Error('G7E-2 must return');
    expect(rejected.entries).toEqual([]);
    expect(judge(g7e2.expected[cfg], null, { ...rejected, entries: ['dcp-jcs-v1'] }, true).some((m) => m.startsWith('verifier entries'))).toBe(true);
  });

  it('never passes a case whose control is missing', () => {
    const out = gate([{ id: 'G7-V1-M01', cfg, problems: [] }]);
    expect(out[0].problems).toEqual(['control_missing: G7-V1-C00']);
  });

  async function fakeRun(make: (c: Json) => { t: Today; x: Experimental }): Promise<Outcome[]> {
    return gate(F.cases.map((c: Json) => ({ id: c.id, cfg, problems: judge(c.expected[cfg], make(c).t, make(c).x) })));
  }

  it('fails a fake in which both routes reject everything', async () => {
    const out = await fakeRun(() => ({
      t: { outcome: 'host_decode_error', kind: 'SyntaxError' },
      x: { outcome: 'returned', calls: 1, entries: [], value: { route: { outcome: 'reject', class: 'SYNTAX', offset: 0 }, entered: 'none', verification: null } as Json },
    }));
    expect(out.filter((o) => o.problems.length === 0)).toEqual([]);
    expect(out.filter((o) => o.problems[0]?.startsWith('control_failed'))).toHaveLength(36);
  });

  it('fails a fake in which both routes accept everything', async () => {
    const { t } = await runCase(control, cfg);
    if (t.outcome !== 'verified_result') throw new Error('the control must verify today');
    const ok = t.result;
    const out = await fakeRun((c) => ({
      t: { outcome: 'verified_result', result: ok },
      x: {
        outcome: 'returned',
        calls: 1,
        entries: ['dcp-jcs-v1'],
        value: { route: { outcome: 'v1_path', profileSource: 'field', warnings: [], historical: { adapter: 'x', decoded: null } }, entered: 'dcp-jcs-v1', verification: ok } as Json,
      },
    }));
    const negatives = F.cases.filter((c: Json) => c.expected[cfg].verification !== 'ts.ok').map((c: Json) => c.id);
    expect(negatives.length).toBeGreaterThan(10);
    for (const id of negatives) expect(out.find((o) => o.id === id)!.problems.length, id).toBeGreaterThan(0);
  });
});
