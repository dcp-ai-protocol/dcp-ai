/**
 * V2-2 in the TypeScript SDK: the internal schema interpreter (core/schema-v2.ts) over the shared corpus of
 * tests/interop/v2/schema_validation/, and the gate in front of verifySignedBundleV2, admission and the experimental
 * candidate route, with the deeper checks the historical rows used to reach kept covered (regression_map.json).
 */
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import ajvFormats from 'ajv-formats/dist/formats.js';
import { describe, expect, it } from 'vitest';

import { admitSignedBundleV2 } from '../core/admission.js';
import type { CryptoProvider } from '../core/crypto-provider.js';
import { AlgorithmRegistry } from '../core/crypto-registry.js';
import { experimentalHistoricalAdapters } from '../core/experimental-candidate-router.js';
import { createExperimentalCandidateVerifier } from '../core/experimental-candidate-verify.js';
import { SCHEMA_V2_IR, SCHEMA_V2_IR_SHA256 } from '../core/schema-v2.generated.js';
import {
  SCHEMA_ERRORS_CAP,
  isSchemaDateTime,
  matchProgram,
  schemaDiagnostics,
  validateSignedBundleV2Schema,
} from '../core/schema-v2.js';
import { computeSecurityTier } from '../core/security-tier.js';
import { DEFAULT_VERIFIER_POLICY, resolveMode, verifySignedBundleV2, verifySignedBundleV2WithProfile } from '../core/verify-v2.js';
import { Ed25519Provider } from '../providers/ed25519.js';
import { MlDsa65Provider } from '../providers/ml-dsa-65.js';
import type { IntentV2, SignedBundleV2, VerifierPolicy } from '../types/v2.js';
import { REGRESSION_MAP } from './schema-regression-map.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '../../../..');
const json = (rel: string) => JSON.parse(readFileSync(resolve(REPO, rel), 'utf8'));
const S = json('tests/interop/v2/schema_validation/schema_cases.json');
const W = json('tests/interop/v2/schema_validation/wiring_cases.json');
const D = json('tests/interop/v2/schema_validation/date_time_cases.json');
const DEEP = json('tests/interop/v2/schema_validation/deep_negatives.json');
const B = json('tests/interop/v2/bundle_vectors.json');
const V = json('tests/interop/v2/secondary_sha3_vectors.json');
const A = json('tests/interop/v2/admission_vectors.json');
const P3 = json('tests/interop/candidate/phase3-signed-vectors.json');
const upstreamDateTime = (ajvFormats as unknown as { fullFormats: Record<string, { validate: (s: string) => boolean }> }).fullFormats['date-time'].validate;
const NOW = { now: Date.parse(W.verification_time) };
const TIMEOUT_MS = 120_000;
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const deepFreeze = <T>(v: T): T => { if (v && typeof v === 'object') { Object.values(v).forEach(deepFreeze); Object.freeze(v); } return v; };
const v1 = (doc: unknown) => validateSignedBundleV2Schema(doc, 'dcp-jcs-v1');
const attributed = (r: { errors: { instance: string; keyword: string }[] }, a: { instance: string; keyword: string }) => r.errors.some((e) => e.instance === a.instance && e.keyword === a.keyword);

/** A registry whose providers count their verify calls, to show where a rejection happens. */
function counting(): { registry: AlgorithmRegistry; calls: { n: number } } {
  const calls = { n: 0 };
  const registry = new AlgorithmRegistry();
  for (const p of [new Ed25519Provider(), new MlDsa65Provider()] as CryptoProvider[]) {
    registry.registerSigner(new Proxy(p, {
      get(target, key) {
        const v = Reflect.get(target, key, target);
        if (key === 'verify') return (...args: unknown[]) => { calls.n += 1; return (v as (...a: unknown[]) => unknown).apply(target, args); };
        return typeof v === 'function' ? v.bind(target) : v;
      },
    }));
  }
  return { registry, calls };
}

/** The JSON text of a schema case: its mutation on a copy of the instance, or its raw replacement. */
function caseText(c: Json): string {
  if (c.raw_replace) {
    const text = JSON.stringify(S.instance);
    expect(text.split(c.raw_replace[0]).length, c.id).toBe(2);
    return text.replace(c.raw_replace[0], c.raw_replace[1]);
  }
  if (!c.mutation) return JSON.stringify(S.instance);
  const d = clone(S.instance);
  const { op, path, value, count } = c.mutation;
  const parent = () => path.slice(0, -1).reduce((n: Json, t: string | number) => n[t], d);
  if (op === 'set') { if (path.length === 0) return JSON.stringify(value); parent()[path.at(-1)] = value; }
  else if (op === 'delete') delete parent()[path.at(-1)];
  else if (op === 'many') for (let i = 0; i < count; i++) d[`x_unknown_${String(i).padStart(2, '0')}`] = i;
  return JSON.stringify(d);
}
const wiringDoc = (c: Json): SignedBundleV2 => (c.signed_bundle_text ? JSON.parse(c.signed_bundle_text) : clone(c.signed_bundle));

describe('the generated IR', () => {
  it('is the staged IR of tools/schema-ir, with its sha256', () => {
    expect(SCHEMA_V2_IR).toBe(readFileSync(resolve(REPO, 'tools/schema-ir/staging/ir.json'), 'utf8').trimEnd());
    expect(createHash('sha256').update(SCHEMA_V2_IR, 'utf8').digest('hex')).toBe(SCHEMA_V2_IR_SHA256);
    const ir = JSON.parse(SCHEMA_V2_IR);
    expect(ir.format).toBe('dcp-ai.v2-schema-ir/1');
    expect(ir.sources).toHaveLength(11);
    for (const s of ir.sources) expect(createHash('sha256').update(readFileSync(resolve(REPO, s.file))).digest('hex'), s.file).toBe(s.sha256);
  });
});

describe('the internal interpreter over the shared schema corpus', () => {
  it('gives the 468 schema cases and the maximal instance their expected verdict and attribution, writing nothing', () => {
    expect(S.cases).toHaveLength(468);
    expect(v1(deepFreeze(clone(S.instance)))).toEqual({ valid: true, errors: [], truncated: false });
    for (const c of S.cases) {
      const doc = deepFreeze(JSON.parse(caseText(c)));
      const before = JSON.stringify(doc);
      const r = v1(doc);
      expect(r.valid, `${c.id}: ${JSON.stringify(r.errors.slice(0, 3))}`).toBe(c.expect.schema.valid);
      if (c.expect.schema.attribution) expect(attributed(r, c.expect.schema.attribution), `${c.id}: ${JSON.stringify(r.errors.slice(0, 4))}`).toBe(true);
      expect(JSON.stringify(doc), c.id).toBe(before);
    }
  });

  it('closes each payload by its artifact schema (the envelope alone leaves payload open), and keeps open objects open', () => {
    const d = clone(S.instance);
    d.bundle.intent.payload.x_unknown = 1;
    expect(v1(d).errors.map((e) => `${e.instance} ${e.keyword}`)).toEqual(['/bundle/intent/payload additionalProperties']);
    const open = clone(S.instance);
    open.bundle.x = { deep: [1, [2, { three: null }]] };
    open.bundle.intent.payload.target.x = 'open';
    open.bundle.policy_decision.payload.required_confirmation = { type: 'human_approve', x: 'open' };
    open.bundle.audit_entries[0].evidence.x = 'open';
    expect(v1(open).valid).toBe(true);
  });

  it('types, null and absence: integer is finite and fraction-free, a boolean never; required null differs from absent', () => {
    const at = (f: (d: Json) => void) => { const d = clone(S.instance); f(d); return v1(d); };
    expect(at((d) => { d.bundle.manifest.audit_count = 3.0; }).valid).toBe(true);
    for (const bad of [3.5, true, '3', NaN, Infinity, BigInt(3), null]) expect(at((d) => { d.bundle.manifest.audit_count = bad; }).valid, String(bad)).toBe(false);
    expect(at((d) => { d.bundle.responsible_principal_record.payload.expires_at = null; }).valid).toBe(true);
    expect(at((d) => { delete d.bundle.responsible_principal_record.payload.expires_at; }).errors.map((e) => `${e.keyword} ${e.member}`)).toEqual(['required expires_at']);
    expect(at((d) => { d.bundle.responsible_principal_record.payload.legal_name = null; }).valid).toBe(false);
  });

  it('oneOf: exactly one branch, reported once at its instance', () => {
    const at = (v: unknown) => { const d = clone(S.instance); d.signature.composite_sig.pq = v; return v1(d); };
    expect(at(null).valid).toBe(true);
    expect(at({ ...S.instance.signature.composite_sig.pq }).valid).toBe(true);
    for (const v of [{}, false, 'x', { ...S.instance.signature.composite_sig.pq, x: 1 }]) expect(at(v).errors.map((e) => `${e.instance} ${e.keyword}`), JSON.stringify(v)).toEqual(['/signature/composite_sig/pq oneOf']);
  });

  it('host values: own enumerable keys, undefined as absent or null, a hole as a type error, open members not visited', () => {
    const at = (f: (d: Json) => void) => { const d = clone(S.instance); f(d); return v1(d); };
    expect(at((d) => { d.bundle.manifest.x = undefined; }).valid).toBe(true);
    expect(at((d) => { d.bundle.responsible_principal_record.payload.contact = undefined; }).valid).toBe(true);
    expect(at((d) => { d.bundle.responsible_principal_record.payload.legal_name = undefined; }).errors.map((e) => e.keyword)).toEqual(['required']);
    expect(at((d) => { d.signature.signer.kids = [d.signature.signer.kids[0], undefined]; }).errors.map((e) => `${e.instance} ${e.keyword}`)).toEqual(['/signature/signer/kids/1 type']);
    // eslint-disable-next-line no-sparse-arrays
    expect(at((d) => { d.signature.signer.kids = [d.signature.signer.kids[0], , d.signature.signer.kids[0]]; }).errors.map((e) => `${e.instance} ${e.keyword}`)).toEqual(['/signature/signer/kids/1 type']);
    expect(at((d) => { d.bundle.x = { a: NaN, f: () => 1, b: BigInt(1) }; }).valid).toBe(true);
    expect(at((d) => { d.bundle.manifest = Object.assign(Object.create(null), d.bundle.manifest); }).valid).toBe(true);
    expect(at((d) => { d.bundle.manifest = Object.assign(Object.create({ x_inherited: 1 }), d.bundle.manifest); }).valid).toBe(true);
    expect(at((d) => { d.bundle.manifest[Symbol('s')] = 1; }).valid).toBe(true);
    expect(at((d) => { Object.defineProperty(d.bundle.manifest, 'x_hidden', { value: 1, enumerable: false }); }).valid).toBe(true);
  });

  it('lengths are code points: an astral character counts one', () => {
    const at = (v: string) => { const d = clone(S.instance); d.bundle.responsible_principal_record.payload.jurisdiction = v; return v1(d).valid; };
    expect(at('\u{1F600}\u{1F600}')).toBe(true);
    expect(at('\u{1F600}')).toBe(false);
    expect(at('\ud800\ud800')).toBe(true);
  });

  it('each pattern program answers as its anchored ECMAScript source', () => {
    const ir = JSON.parse(SCHEMA_V2_IR);
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
    const alphabet = ['0', '9', 'a', 'f', 'g', 'A', 'G', ':', '=', '+', '/', ' ', '\n', '\r', ' ', '١', '\u{1F600}', 's', 'h', 'E', 'N'];
    for (const p of ir.patterns) {
      const re = new RegExp(p.source);
      const samples = ['', 'GENESIS', 'GENESIS\n', 'AAAA==', 'AAAA===', `sha256:${'a'.repeat(64)}`, `sha256:${'a'.repeat(64)}\n`, `sha3-256:${'0'.repeat(64)}`, 'a'.repeat(32), 'a'.repeat(64), `${'a'.repeat(64)}\n`];
      for (let n = 0; n < 2000; n++) { let s = ''; const len = Math.floor(rnd() * 72); for (let i = 0; i < len; i++) s += alphabet[Math.floor(rnd() * alphabet.length)]; samples.push(s); }
      for (const s of samples) expect(matchProgram(p, s), `${p.source} on ${JSON.stringify(s)}`).toBe(re.test(s));
    }
  });

  it('date-time is ajv-formats 3.0.1: the shared cases and every BMP scalar as the separator, against the upstream function', () => {
    for (const c of D.cases) {
      expect(upstreamDateTime(c.value), JSON.stringify(c.value)).toBe(c.accepted);
      expect(isSchemaDateTime(c.value), JSON.stringify(c.value)).toBe(c.accepted);
    }
    const accepted: string[] = [];
    for (let c = 0; c <= 0xffff; c++) {
      if (c >= 0xd800 && c <= 0xdfff) continue;
      const v = `2000-01-01${String.fromCharCode(c)}00:00:00Z`;
      expect(isSchemaDateTime(v), `U+${c.toString(16)}`).toBe(upstreamDateTime(v));
      if (isSchemaDateTime(v)) accepted.push(`U+${c.toString(16).toUpperCase().padStart(4, '0')}`);
    }
    expect(accepted).toEqual(D.separator_scalars);
  });

  it('the error budget: at most 16 errors and a marker, the verdict unchanged; diagnostics escape, bound and never echo', () => {
    const many = (n: number) => { const d = clone(S.instance); for (let i = 0; i < n; i++) d[`x_${i}`] = i; return d; };
    expect([v1(many(16)).errors.length, v1(many(16)).truncated, v1(many(16)).valid]).toEqual([16, false, false]);
    const r = v1(many(17));
    expect([r.errors.length, r.truncated, r.valid]).toEqual([SCHEMA_ERRORS_CAP, true, false]);
    expect(schemaDiagnostics(r).at(-1)).toBe('schema: further errors not listed');
    const d = clone(S.instance);
    d['x'.repeat(1 << 20)] = 'v'.repeat(1 << 20);
    d['~/'.repeat(100)] = 1;
    d.bundle.manifest.intended_verifier = 'w'.repeat(5000);
    const lines = schemaDiagnostics(v1(d));
    expect(lines.join('\n')).not.toMatch(/vvvv|wwww/);
    for (const l of lines) expect(Array.from(l).length, l.slice(0, 80)).toBeLessThan(200);
    expect(lines.some((l) => l.startsWith('schema: / additionalProperties ~0~1') && l.endsWith('…[cut]'))).toBe(true);
  });

  it('the dcp-jcs-v2 overlay changes one const: each profile refused under the other, absence left to the profile check', () => {
    const at = (p: string | undefined, profile: 'dcp-jcs-v1' | 'dcp-jcs-v2') => {
      const d = clone(S.instance);
      if (p === undefined) delete d.bundle.manifest.canonicalization_profile; else d.bundle.manifest.canonicalization_profile = p;
      return validateSignedBundleV2Schema(d, profile).errors.map((e) => `${e.instance} ${e.keyword}`);
    };
    expect(at('dcp-jcs-v1', 'dcp-jcs-v1')).toEqual([]);
    expect(at('dcp-jcs-v2', 'dcp-jcs-v2')).toEqual([]);
    expect(at('dcp-jcs-v2', 'dcp-jcs-v1')).toEqual(['/bundle/manifest/canonicalization_profile const']);
    expect(at('dcp-jcs-v1', 'dcp-jcs-v2')).toEqual(['/bundle/manifest/canonicalization_profile const']);
    expect(at(undefined, 'dcp-jcs-v2')).toEqual([]);
  });
});

describe('the gate in front of verifySignedBundleV2 (wiring_cases.json)', () => {
  it('verifies the 13 positive controls and rejects the 44 negatives with V2-2 alone, before any provider runs', async () => {
    expect(W.cases).toHaveLength(57);
    let positives = 0;
    for (const c of W.cases) {
      const { registry, calls } = counting();
      const doc = deepFreeze(wiringDoc(c));
      const r = await verifySignedBundleV2(doc, registry, W.verifier_policy as VerifierPolicy, NOW);
      if (c.expect.verified) {
        positives += 1;
        expect(r.errors, c.name).toEqual([]);
        expect(r.verified, c.name).toBe(true);
        expect(calls.n, c.name).toBeGreaterThan(0);
      } else {
        expect(r.verified, c.name).toBe(false);
        expect(r.errors.every((e) => e.startsWith('schema: ')), `${c.name}: ${JSON.stringify(r.errors)}`).toBe(true);
        // The target: its instance and keyword (an unknown or missing member's name follows after a space).
        const target = `schema: ${c.target.instance || '/'} ${c.target.keyword}`;
        expect(r.errors.some((e) => e === target || e.startsWith(`${target} `)), `${c.name}: ${target} in ${JSON.stringify(r.errors)}`).toBe(true);
        expect(r.details, c.name).toEqual({});
        expect(r.warnings, c.name).toEqual([]);
        expect(calls.n, `${c.name}: no provider may run`).toBe(0);
      }
    }
    expect(positives).toBe(13);
  }, TIMEOUT_MS);

  it('C4: a null session time is refused by the schema (acceptance change), the temporal helper is not reached', async () => {
    for (const name of ['c4_session_expires_at_null', 'c4_session_issued_at_null']) {
      const c = W.cases.find((x: Json) => x.name === name);
      const r = await verifySignedBundleV2(wiringDoc(c), counting().registry, W.verifier_policy as VerifierPolicy, NOW);
      expect(r.errors).toEqual([`schema: ${c.target.instance} type`]);
    }
  }, TIMEOUT_MS);

  it('the clock contract is kept: a non-finite now still throws before V2-2', async () => {
    await expect(verifySignedBundleV2(null as never, counting().registry, undefined, { now: Number.NaN })).rejects.toBeInstanceOf(TypeError);
  });
});

describe('admission and the experimental candidate route reach the same gate', () => {
  it('combined admission: the strict positive is admitted; the same bundle with an unknown root member is not, and no provider runs', async () => {
    const c = A.cases.find((x: Json) => x.name === 'A_known_principal_strict');
    const options = { profile: A.profiles[c.profile], trust: A.trust_sets[c.trust], revocation: c.revocation, now: Date.parse(c.now) };
    const ok = await admitSignedBundleV2(clone(A.signed_bundles[c.bundle]), counting().registry, options);
    expect([ok.verified, ok.admitted]).toEqual([true, true]);
    const bad = clone(A.signed_bundles[c.bundle]);
    bad.x_ext = 1;
    const { registry, calls } = counting();
    const r = await admitSignedBundleV2(bad, registry, options);
    expect([r.verified, r.admitted]).toEqual([false, false]);
    expect(r.verification.errors).toEqual(['schema: / additionalProperties x_ext']);
    expect(calls.n).toBe(0);
  }, TIMEOUT_MS);

  it('candidate: the selected dcp-jcs-v2 positive verifies; its schema negative is refused before any provider; the default path refuses the candidate', async () => {
    const policy = P3.verifier_policies.default as VerifierPolicy;
    const now = { now: P3.now_ms };
    const verifier = createExperimentalCandidateVerifier({ transport: 'bare', acceptedProfiles: ['dcp-jcs-v2'], historical: experimentalHistoricalAdapters.bufferUtf8JsonParse });
    const text = P3.bases['B-v2'].input_json as string;
    const ok = await verifier.verify(new TextEncoder().encode(text), counting().registry, policy, now);
    expect([ok.entered, ok.verification?.verified]).toEqual(['dcp-jcs-v2', true]);
    const { registry, calls } = counting();
    const bad = await verifier.verify(new TextEncoder().encode(`{"x_ext":1,${text.trimStart().slice(1)}`), registry, policy, now);
    expect(bad.entered).toBe('dcp-jcs-v2');
    expect(bad.verification?.errors).toEqual(['schema: / additionalProperties x_ext']);
    expect(calls.n).toBe(0);
    const today = await verifySignedBundleV2(JSON.parse(text), counting().registry, policy, now);
    expect(today.errors).toEqual(['schema: /bundle/manifest/canonicalization_profile const']);
  }, TIMEOUT_MS);

  it('profile confusion: a dcp-jcs-v1 bundle is refused by a dcp-jcs-v2-only selection and takes the v1 route when v1 is accepted; absence under the candidate profile fails the profile check', async () => {
    const base = W.cases[0];
    const bytes = new TextEncoder().encode(JSON.stringify(base.signed_bundle));
    const route = async (acceptedProfiles: string[]) => {
      const verifier = createExperimentalCandidateVerifier({ transport: 'bare', acceptedProfiles, historical: experimentalHistoricalAdapters.bufferUtf8JsonParse });
      const r = await verifier.verify(bytes, counting().registry, W.verifier_policy as VerifierPolicy, NOW);
      return [r.route.outcome, (r.route as Json).class ?? null, r.entered, r.verification?.verified ?? null];
    };
    expect(await route(['dcp-jcs-v2'])).toEqual(['reject', 'PROFILE_NOT_ACCEPTED', 'none', null]);
    expect(await route(['dcp-jcs-v1'])).toEqual(['v1_path', null, 'dcp-jcs-v1', true]);
    const absent = clone(base.signed_bundle);
    delete absent.bundle.manifest.canonicalization_profile;
    const x = await verifySignedBundleV2WithProfile(absent, counting().registry, W.verifier_policy as VerifierPolicy, NOW, 'dcp-jcs-v2');
    expect(x.verified).toBe(false);
    expect(x.errors).toContain('Unknown canonicalization_profile: undefined');
  }, TIMEOUT_MS);
});

describe('the deeper checks of the historical rows stay covered (regression_map.json)', () => {
  it('accounts for the 43 bundle_vectors rows and the 13 secondary SHA3 rows, each with a coverage that exists', () => {
    const rows = REGRESSION_MAP.rows;
    expect(rows.filter((r) => r.fixture.endsWith('bundle_vectors.json'))).toHaveLength(43);
    expect(rows.filter((r) => r.fixture.endsWith('secondary_sha3_vectors.json'))).toHaveLength(13);
    const docOf = (fixture: string, name: string): Json => {
      if (fixture.endsWith('secondary_sha3_vectors.json')) {
        const c = V.cases.find((x: Json) => x.name === name);
        return { bundle: { dcp_bundle_version: '2.0', manifest: c.manifest, ...V.base.artifacts, audit_entries: c.audit_entries }, signature: c.signature };
      }
      const b = B.must_reject_bundles.find((x: Json) => x.name === name);
      if (b) return b.signed_bundle;
      const m = B.must_reject.find((x: Json) => x.name === name);
      const d = clone(B.signed_bundle);
      for (const { path, value } of m.mutations) path.slice(0, -1).reduce((n: Json, k: string) => n[k], d)[path.at(-1)] = value;
      return d;
    };
    for (const r of rows) {
      expect(v1(docOf(r.fixture, r.name)).valid, r.name).toBe(false);
      const cov = r.deep_coverage as Json;
      for (const c of [cov, cov.also].filter((x: Json) => x?.kind === 'schema_valid_rows')) {
        for (const n of c.rows) expect(v1(docOf(c.fixture, n)).valid, `${r.name} -> ${n}`).toBe(true);
      }
      if (cov.kind === 'deep_negatives') for (const n of cov.cases) expect(DEEP.cases.some((d: Json) => d.name === n), `${r.name} -> ${n}`).toBe(true);
      expect(['schema_valid_rows', 'deep_negatives', 'helper', 'structural']).toContain(cov.kind);
    }
  });

  it('the schema-valid deep negatives reach the temporal parsers and the canonicalizer, past V2-2', async () => {
    for (const c of DEEP.cases) {
      const doc = c.signed_bundle;
      expect(v1(doc).valid, c.name).toBe(true);
      const r = await verifySignedBundleV2(doc, counting().registry, DEEP.verifier_policy as VerifierPolicy, { now: Date.parse(DEEP.verification_time) });
      expect(r.verified, c.name).toBe(false);
      expect(r.errors.some((e) => e.startsWith('schema:')), c.name).toBe(false);
      expect(r.errors.join('\n').toLowerCase(), c.name).toContain(c.error_contains_by_sdk.ts.toLowerCase());
    }
  }, TIMEOUT_MS);

  it('the tier and mode lookups keep their prototype-name guards (the helpers V2-2 now shields)', () => {
    const policy: VerifierPolicy = { ...DEFAULT_VERIFIER_POLICY, default_mode: 'hybrid_required', risk_overrides: { low: 'classical_only', medium: 'hybrid_preferred', high: 'hybrid_required' } };
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(resolveMode(policy, name as never), name).toBe('hybrid_required');
    }
    const intent = B.signed_bundle.bundle.intent.payload as IntentV2;
    const unknown = computeSecurityTier({ ...intent, action_type: 'zz-unknown' } as never, { risk_score: 0 });
    for (const field of ['action_type', 'estimated_impact', 'security_tier']) {
      for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
        const tier = computeSecurityTier({ ...intent, [field]: name } as never, { risk_score: 0 });
        expect(['routine', 'standard', 'elevated', 'maximum'], `${field}=${name}`).toContain(tier);
        if (field !== 'security_tier') expect(tier, `${field}=${name}`).toBe(unknown);
      }
    }
  });
});
