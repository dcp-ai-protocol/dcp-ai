/**
 * Delegated admission (MP-02 F1): the shared vectors of tests/interop/v2/delegated_admission_vectors.json
 * through the public API, and what the vectors cannot express: the internal floor against the public
 * verifier, the snapshot of the inputs, JSON-only evidence, loaded and raw configuration, and the verifier
 * policy against its schema.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AdmissionConfigError,
  AlgorithmRegistry,
  DEFAULT_VERIFIER_POLICY,
  Ed25519Provider,
  MlDsa65Provider,
  SlhDsa192fProvider,
  admitDelegatedBundleV2,
  admitSignedBundleV2,
  createPrincipalTrustStore,
  resolveStrictV1Profile,
  verifySignedBundleV2,
  type DelegatedOperator,
} from '../index.js';
import { PQ_ONLY_VERIFIER_POLICY, verifySignedBundleV2WithProfile } from '../core/verify-v2.js';
import {
  MANDATE_FIELDS,
  MANDATE_REQUIRED,
  POLICY_FIELDS,
  POLICY_REQUIRED,
  SCOPE_FIELDS,
  SCOPE_REQUIRED,
  SUB_DELEGATION_FIELDS,
} from '../core/delegated-admission.js';
import type { SignedBundleV2, VerifierPolicy } from '../types/v2.js';

const V = JSON.parse(readFileSync(new URL('../../../../tests/interop/v2/delegated_admission_vectors.json', import.meta.url), 'utf8'));
const POLICY_SCHEMA = JSON.parse(readFileSync(new URL('../../../../schemas/v2/verifier_policy.schema.json', import.meta.url), 'utf8'));
const MANDATE_SCHEMA = JSON.parse(readFileSync(new URL('../../../../schemas/v2/delegation_mandate.schema.json', import.meta.url), 'utf8'));
const NOW = Date.parse(V.now);

function newRegistry(ed25519 = new Ed25519Provider()): AlgorithmRegistry {
  const registry = new AlgorithmRegistry();
  registry.registerSigner(ed25519);
  registry.registerSigner(new MlDsa65Provider());
  registry.registerSigner(new SlhDsa192fProvider());
  return registry;
}
const registry = newRegistry();
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

type Case = (typeof V.cases)[number];
const operatorOf = (c: Case): DelegatedOperator => ({
  trust: clone(V.trust_sets[c.trust]),
  ...(c.profile ? { profile: clone(V.profiles[c.profile]) } : {}),
  ...(c.policy ? { policy: clone(V.policies[c.policy]) } : {}),
  ...(c.max_revocation_age_seconds !== null ? { maxRevocationAgeSeconds: c.max_revocation_age_seconds } : {}),
  revocation: c.revocation ? clone(V.revocations[c.revocation]) : null,
  mandateRevocation: c.mandate_revocation ? clone(V.mandate_revocations[c.mandate_revocation]) : null,
  now: NOW,
});
const evidenceOf = (c: Case) => ({
  signedBundle: clone(V.signed_bundles[c.leaf]),
  mandateChain: c.chain.map((n: string) => clone(V.mandates[n])),
  delegatorBundles: c.delegators.map((n: string) => clone(V.signed_bundles[n])),
});
const caseNamed = (name: string): Case => V.cases.find((c: Case) => c.name === name);
const codes = (r: { errors: Array<{ code: string }> }) => [...new Set(r.errors.map((e) => e.code))].sort();

describe('delegated admission vectors', () => {
  it('covers every group of the design (§ 7) but ACK', () => {
    expect([...new Set(V.cases.map((c: Case) => c.group))].sort()).toEqual(['ALG', 'DELEG', 'PISO', 'POS', 'PRIN', 'REV', 'ROT', 'SIG', 'TIME']);
  });

  for (const c of V.cases) {
    it(`${c.group} ${c.name} (${c.rule})`, async () => {
      const result = await admitDelegatedBundleV2(evidenceOf(c), registry, operatorOf(c));
      expect(result.admitted).toBe(c.expected.admitted);
      expect(result.delegation_verified).toBe(c.expected.delegation_verified);
      expect(codes(result)).toEqual([...c.expected.codes].sort());
      expect(result.activation).toBe('not_evaluated');
      expect(result.delegation_active).toBe(false);
      expect(result.action_authorized).toBe(false);
      if (c.expected.security_tier !== undefined) expect(result.security_tier).toBe(c.expected.security_tier);
      if (c.expected.verification_mode !== undefined) expect(result.verification_mode).toBe(c.expected.verification_mode);
      if (c.expected.effective_floor !== undefined) expect(result.chain?.effective_floor ?? null).toBe(c.expected.effective_floor);
      if (c.control_public_admitted !== undefined) {
        const pub = await admitSignedBundleV2(clone(V.signed_bundles[c.leaf]), registry, {
          policy: clone(V.policies[c.policy]),
          trust: clone(V.trust_sets[c.trust]),
          now: NOW,
        });
        expect(pub.admitted).toBe(c.control_public_admitted);
      }
    });
  }

  for (const c of V.config_cases) {
    it(`configuration ${c.name}`, async () => {
      const o = c.operator;
      const operator = {
        ...(o.trust ? { trust: clone(V.trust_sets[o.trust]) } : {}),
        ...(o.profile ? { profile: clone(V.profiles[o.profile]) } : {}),
        ...(o.policy ? { policy: clone(V.policies[o.policy]) } : {}),
        ...(o.max_revocation_age_seconds !== undefined ? { maxRevocationAgeSeconds: o.max_revocation_age_seconds } : {}),
        revocation: clone(V.revocations.all_not_revoked),
        mandateRevocation: clone(V.mandate_revocations.all_not_revoked),
        now: NOW,
      } as DelegatedOperator;
      const call = admitDelegatedBundleV2({ signedBundle: clone(V.signed_bundles.orch), mandateChain: [clone(V.mandates.root)] }, registry, operator);
      await expect(call).rejects.toBeInstanceOf(AdmissionConfigError);
      await expect(call).rejects.toMatchObject({ code: c.expected_code });
    });
  }

  it('leaves its inputs unchanged', async () => {
    const c = caseNamed('depth_two');
    const evidence = evidenceOf(c);
    const operator = operatorOf(c);
    const before = clone({ evidence, operator });
    await admitDelegatedBundleV2(evidence, registry, operator);
    expect({ evidence, operator }).toEqual(before);
  });
});

describe('the floor reaches the verification (design 1.4)', () => {
  const weak = V.policies.weak_classical as VerifierPolicy;
  const classicalOnly = V.signed_bundles.orch_classical_only as SignedBundleV2;

  it('the internal step with an elevated floor rejects what the public verifier accepts under the same policy', async () => {
    const pub = await verifySignedBundleV2(clone(classicalOnly), registry, clone(weak), { now: NOW });
    expect(pub.verified).toBe(true);
    expect(pub.details?.verification_mode).toBe('classical_only');
    const floored = await verifySignedBundleV2WithProfile(clone(classicalOnly), registry, clone(weak), { now: NOW }, 'dcp-jcs-v1', 'elevated');
    expect(floored.verified).toBe(false);
    expect(floored.details?.verification_mode).toBe('hybrid_required');
    expect(floored.details?.resolved_tier).toBe('elevated');
  });

  it('with no floor, the internal step gives the public result for every fixture', async () => {
    for (const [name, bundle] of Object.entries(V.signed_bundles)) {
      for (const policy of [DEFAULT_VERIFIER_POLICY, weak, PQ_ONLY_VERIFIER_POLICY]) {
        const pub = await verifySignedBundleV2(clone(bundle) as SignedBundleV2, registry, clone(policy), { now: NOW });
        const internal = await verifySignedBundleV2WithProfile(clone(bundle) as SignedBundleV2, registry, clone(policy), { now: NOW }, 'dcp-jcs-v1', null);
        expect(JSON.stringify(internal), name).toBe(JSON.stringify(pub));
      }
    }
  });
});

describe('snapshot (design 1.3 step 0)', () => {
  it('ignores changes the caller makes after the snapshot, at the first signature verification', async () => {
    const c = caseNamed('principal_orchestrator_subagent');
    const baseline = await admitDelegatedBundleV2(evidenceOf(c), registry, operatorOf(c));
    expect(baseline.admitted).toBe(true);

    const evidence = evidenceOf(c);
    const operator = operatorOf(c) as DelegatedOperator & Record<string, any>;
    const real = new Ed25519Provider();
    let mutated = 0;
    const tampering = Object.create(real) as Ed25519Provider;
    tampering.verify = async (message, signature, key) => {
      if (mutated++ === 0) {
        (evidence.mandateChain[1] as Record<string, unknown>).agent_id = 'agent:intruder';
        (evidence.signedBundle as Record<string, unknown>).bundle = null;
        evidence.delegatorBundles.length = 0;
        (operator.trust as unknown as Record<string, unknown>).principals = [];
        (operator.profile as unknown as Record<string, unknown>).verifier_id = 'verifier:other';
        (operator.revocation as Record<string, any>).agents['agent:acme-subagent'] = 'revoked';
        (operator.mandateRevocation as Record<string, any>).mandates['mandate:acme-sub'] = 'revoked';
      }
      return real.verify(message, signature, key);
    };
    const result = await admitDelegatedBundleV2(evidence, newRegistry(tampering), operator);
    expect(mutated).toBeGreaterThan(0);
    expect(result.admitted).toBe(true);
    expect(codes(result)).toEqual([]);
    expect(result.inputs).toEqual(baseline.inputs);
  });

  it('uses loaded configuration as it is and loads raw configuration', async () => {
    const c = caseNamed('principal_orchestrator_subagent');
    const loaded = {
      ...operatorOf(c),
      trust: createPrincipalTrustStore(clone(V.trust_sets[c.trust])),
      profile: resolveStrictV1Profile(clone(V.profiles[c.profile])),
    };
    const fromLoaded = await admitDelegatedBundleV2(evidenceOf(c), registry, loaded);
    const fromRaw = await admitDelegatedBundleV2(evidenceOf(c), registry, operatorOf(c));
    expect(fromLoaded.admitted).toBe(true);
    expect(codes(fromLoaded)).toEqual(codes(fromRaw));
  });
});

describe('evidence is JSON data only (design 1.3 step 0)', () => {
  const c = caseNamed('root_only');
  const run = (evidence: unknown) => admitDelegatedBundleV2(evidence as never, registry, operatorOf(c));
  const nullPrototype = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(nullPrototype);
    if (v && typeof v === 'object') return Object.assign(Object.create(null), Object.fromEntries(Object.entries(v).map(([k, x]) => [k, nullPrototype(x)])));
    return v;
  };

  it('accepts null-prototype objects', async () => {
    const e = evidenceOf(c);
    const result = await run({ signedBundle: nullPrototype(e.signedBundle), mandateChain: nullPrototype(e.mandateChain) });
    expect(result.admitted).toBe(true);
  });

  const invalid: Array<[string, (e: ReturnType<typeof evidenceOf>) => unknown]> = [
    ['a Map', (e) => ({ ...e, signedBundle: new Map(Object.entries(e.signedBundle)) })],
    ['a Date', (e) => ({ ...e, mandateChain: [{ ...e.mandateChain[0], timestamp: new Date() }] })],
    ['a class instance', (e) => ({ ...e, mandateChain: [Object.assign(new (class Mandate {})(), e.mandateChain[0])] })],
    ['undefined', (e) => ({ ...e, mandateChain: [{ ...e.mandateChain[0], revocable: undefined }] })],
    ['a function', (e) => ({ ...e, signedBundle: { ...e.signedBundle, extra: () => 1 } })],
    ['a symbol key', (e) => ({ ...e, signedBundle: { ...e.signedBundle, [Symbol('s')]: 1 } })],
    ['a non-enumerable member', (e) => ({ ...e, signedBundle: Object.defineProperty({ ...e.signedBundle }, 'hidden', { value: 1, enumerable: false }) })],
    ['a sparse array', (e) => ({ ...e, mandateChain: [e.mandateChain[0], , ] })],
    ['an array with an extra member', (e) => ({ ...e, mandateChain: Object.assign([...e.mandateChain], { extra: 1 }) })],
    ['a cycle', (e) => {
      const m = { ...e.mandateChain[0] } as Record<string, unknown>;
      m.self = m;
      return { ...e, mandateChain: [m] };
    }],
    ['a non-finite number', (e) => ({ ...e, mandateChain: [{ ...e.mandateChain[0], delegation_depth: Number.NaN }] })],
  ];
  for (const [what, make] of invalid) {
    it(`rejects ${what} as DELEGATION_INPUT_INVALID`, async () => {
      const result = await run(make(evidenceOf(c)));
      expect(result.admitted).toBe(false);
      expect(codes(result)).toEqual(['DELEGATION_INPUT_INVALID']);
    });
  }

  it('rejects accessor properties without calling them, in the evidence and in its container', async () => {
    let calls = 0;
    const e = evidenceOf(c);
    const inMandate = { ...e, mandateChain: [Object.defineProperty({ ...e.mandateChain[0] }, 'agent_id', { get: () => (calls++, 'agent:x'), enumerable: true })] };
    const inContainer = Object.defineProperty({ mandateChain: e.mandateChain }, 'signedBundle', { get: () => (calls++, e.signedBundle), enumerable: true });
    for (const evidence of [inMandate, inContainer]) {
      const result = await run(evidence);
      expect(codes(result)).toEqual(['DELEGATION_INPUT_INVALID']);
    }
    expect(calls).toBe(0);
  });
});

describe('verifier policy without a profile (schemas/v2/verifier_policy.schema.json)', () => {
  it('has the members, types and bounds of the schema', () => {
    const props = POLICY_SCHEMA.properties as Record<string, Record<string, unknown>>;
    expect(POLICY_SCHEMA.additionalProperties).toBe(false);
    expect(Object.keys(POLICY_FIELDS).sort()).toEqual(Object.keys(props).sort());
    expect([...POLICY_REQUIRED].sort()).toEqual([...POLICY_SCHEMA.required].sort());
    const modes = props.default_mode.enum;
    for (const [name, rule] of Object.entries(POLICY_FIELDS)) {
      const s = props[name];
      switch (rule.type) {
        case 'mode':
          expect(s).toMatchObject({ type: 'string', enum: modes });
          break;
        case 'risk_overrides':
          expect(s.additionalProperties).toBe(false);
          expect(s.required).toEqual(['low', 'medium', 'high']);
          for (const tier of ['low', 'medium', 'high']) expect((s.properties as Record<string, unknown>)[tier]).toEqual({ type: 'string', enum: modes });
          break;
        case 'string_array':
          expect(s.type).toBe('array');
          expect(s.items).toEqual({ type: 'string' });
          expect(s.minItems).toBe(rule.minItems);
          break;
        default:
          expect(s.type).toBe(rule.type);
          expect(s.minimum).toBe(rule.minimum);
      }
    }
  });

  const c = caseNamed('no_floor_weak_policy');
  const withPolicy = (policy: unknown) =>
    admitDelegatedBundleV2(evidenceOf(c), registry, { ...operatorOf(c), policy: policy as VerifierPolicy });

  it('accepts the SDK presets', async () => {
    for (const preset of [DEFAULT_VERIFIER_POLICY, PQ_ONLY_VERIFIER_POLICY, V.policies.weak_classical]) {
      await expect(withPolicy(clone(preset))).resolves.toBeDefined();
    }
  });

  const malformed: Array<[string, Record<string, unknown>, string]> = [
    ['require_session_binding 0 (independent review R2)', { require_session_binding: 0 }, 'CONFIG_INVALID_VALUE'],
    ['an unknown member (independent review R2)', { unknown_setting: true }, 'CONFIG_UNKNOWN_FIELD'],
    ['max_key_age_days "365" (independent review R2)', { max_key_age_days: '365' }, 'CONFIG_INVALID_VALUE'],
    ['an unknown mode', { default_mode: 'hybrid' }, 'CONFIG_INVALID_VALUE'],
    ['a risk tier missing', { risk_overrides: { low: 'classical_only', medium: 'classical_only' } }, 'CONFIG_INVALID_VALUE'],
    ['an unknown risk tier', { risk_overrides: { low: 'classical_only', medium: 'classical_only', high: 'classical_only', extreme: 'pq_only' } }, 'CONFIG_UNKNOWN_FIELD'],
    ['a negative minimum', { min_pq: -1 }, 'CONFIG_INVALID_VALUE'],
    ['an empty classical list', { accepted_classical_algs: [] }, 'CONFIG_INVALID_VALUE'],
    ['a list with a non-string', { accepted_pq_algs: ['ml-dsa-65', 1] }, 'CONFIG_INVALID_VALUE'],
    ['max_key_age_days 0', { max_key_age_days: 0 }, 'CONFIG_INVALID_VALUE'],
    ['a fractional integer', { max_session_duration_seconds: 1.5 }, 'CONFIG_INVALID_VALUE'],
  ];
  for (const [what, change, code] of malformed) {
    it(`refuses ${what} with ${code}`, async () => {
      const call = withPolicy({ ...clone(V.policies.weak_classical), ...change });
      await expect(call).rejects.toBeInstanceOf(AdmissionConfigError);
      await expect(call).rejects.toMatchObject({ code });
    });
  }

  // The policy contract (R4): no control the verifiers do not apply.
  const pq = caseNamed('pq_only_stays_with_routine_floor');
  const contractAccepted: Array<[string, Case, Record<string, unknown>]> = [
    ['weak_classical with reversed hashes', c, { ...clone(V.policies.weak_classical), accepted_hash_algs: ['sha384', 'sha256'] }],
    ['DEFAULT with reversed hashes', c, { ...clone(DEFAULT_VERIFIER_POLICY), accepted_hash_algs: ['sha384', 'sha256'] }],
    ['the PQ_ONLY preset with reversed hashes', pq, { ...clone(PQ_ONLY_VERIFIER_POLICY), accepted_hash_algs: ['sha384', 'sha256'] }],
    ['max_session_duration_seconds 0', c, { ...clone(V.policies.weak_classical), max_session_duration_seconds: 0 }],
    ['max_session_duration_seconds 2147483647', c, { ...clone(V.policies.weak_classical), max_session_duration_seconds: 2147483647 }],
  ];
  for (const [what, k, policy] of contractAccepted) {
    it(`admits ${what}`, async () => {
      const result = await admitDelegatedBundleV2(evidenceOf(k), registry, { ...operatorOf(k), policy: policy as unknown as VerifierPolicy });
      expect(result.admitted).toBe(true);
    });
  }

  const contractRefused: Array<[string, Record<string, unknown>]> = [
    ['min_pq 2 (R4)', { min_pq: 2 }],
    ['min_classical 2 (R4)', { min_classical: 2 }],
    ['accepted_hash_algs sha384 (R4)', { accepted_hash_algs: ['sha384'] }],
    ['max_key_age_days 1 (R4)', { max_key_age_days: 1 }],
    ['max_key_age_days 364', { max_key_age_days: 364 }],
    ['min_pq 0', { min_pq: 0 }],
    ['min_classical 0 outside pq_only', { min_classical: 0 }],
    ['require_composite_binding false outside pq_only', { require_composite_binding: false }],
    ['require_session_binding false', { require_session_binding: false }],
    ['accepted_hash_algs sha256 twice', { accepted_hash_algs: ['sha256', 'sha256'] }],
    ['accepted_hash_algs with a third', { accepted_hash_algs: ['sha256', 'sha384', 'sha512'] }],
    ['max_session_duration_seconds 2147483648', { max_session_duration_seconds: 2147483648 }],
    ['max_session_duration_seconds -1', { max_session_duration_seconds: -1 }],
    ['max_session_duration_seconds true', { max_session_duration_seconds: true }],
    ['max_session_duration_seconds 1.5', { max_session_duration_seconds: 1.5 }],
  ];
  for (const [what, change] of contractRefused) {
    it(`refuses ${what} with CONFIG_INVALID_VALUE`, async () => {
      await expect(withPolicy({ ...clone(V.policies.weak_classical), ...change })).rejects.toMatchObject({ code: 'CONFIG_INVALID_VALUE' });
    });
  }

  it('refuses require_composite_binding false when one mode is not pq_only', async () => {
    const policy = { ...clone(PQ_ONLY_VERIFIER_POLICY), risk_overrides: { low: 'pq_only', medium: 'pq_only', high: 'hybrid_required' } };
    await expect(admitDelegatedBundleV2(evidenceOf(pq), registry, { ...operatorOf(pq), policy: policy as VerifierPolicy })).rejects.toMatchObject({
      code: 'CONFIG_INVALID_VALUE',
    });
  });

  it('refuses a required member missing', async () => {
    const { allow_v1_bundles: _, ...policy } = clone(V.policies.weak_classical);
    await expect(withPolicy(policy)).rejects.toMatchObject({ code: 'CONFIG_INVALID_VALUE' });
  });
});

describe('mandate preflight against schemas/v2/delegation_mandate.schema.json', () => {
  it('has the members of the schema, closed where it is closed and open where it is open', () => {
    expect(MANDATE_SCHEMA.additionalProperties).toBe(false);
    expect([...MANDATE_FIELDS].sort()).toEqual(Object.keys(MANDATE_SCHEMA.properties).sort());
    expect([...MANDATE_REQUIRED].sort()).toEqual([...MANDATE_SCHEMA.required].sort());
    const item = MANDATE_SCHEMA.properties.authority_scope.items;
    expect(MANDATE_SCHEMA.properties.authority_scope.minItems).toBe(1);
    expect(item.additionalProperties).toBe(false);
    expect([...SCOPE_FIELDS].sort()).toEqual(Object.keys(item.properties).sort());
    expect([...SCOPE_REQUIRED].sort()).toEqual([...item.required].sort());
    expect(item.properties.domain).toEqual({ type: 'string', minLength: 1 });
    for (const list of ['actions_permitted', 'data_classes']) {
      expect(item.properties[list]).toEqual({ type: 'array', items: { type: 'string', minLength: 1 } });
    }
    // limits is open: no additionalProperties, no members, so the preflight checks only that it is an object.
    expect(item.properties.limits).toEqual({ type: 'object' });
    const sd = MANDATE_SCHEMA.properties.sub_delegation;
    expect(sd.additionalProperties).toBe(false);
    expect([...SUB_DELEGATION_FIELDS].sort()).toEqual(Object.keys(sd.properties).sort());
    expect([...sd.required].sort()).toEqual([...SUB_DELEGATION_FIELDS].sort());
    expect(MANDATE_SCHEMA.properties.minimum_security_tier.enum).toEqual(['routine', 'standard', 'elevated', 'maximum']);
  });

  const depth1 = caseNamed('principal_orchestrator_subagent');
  const run = (edit: (chain: Array<Record<string, unknown>>) => void) => {
    const e = evidenceOf(depth1);
    edit(e.mandateChain as Array<Record<string, unknown>>);
    return admitDelegatedBundleV2(e, registry, operatorOf(depth1));
  };
  const oneOf: Array<[string, (chain: Array<Record<string, unknown>>) => void, string]> = [
    ['a root with parent_mandate_id', (c) => { c[0].parent_mandate_id = 'mandate:parent'; }, 'a root mandate has no parent_mandate_id'],
    ['a root with delegation_depth 1', (c) => { c[0].delegation_depth = 1; }, 'a root mandate has delegation_depth 0'],
    ['a sub-mandate without delegation_depth', (c) => { delete c[1].delegation_depth; }, 'missing delegation_depth'],
    ['a sub-mandate without parent_mandate_id', (c) => { delete c[1].parent_mandate_id; }, 'missing parent_mandate_id'],
    ['a scope entry without actions_permitted', (c) => { delete (c[1].authority_scope as Array<Record<string, unknown>>)[0].actions_permitted; }, 'is missing actions_permitted'],
    ['limits that is not an object', (c) => { (c[1].authority_scope as Array<Record<string, unknown>>)[0].limits = []; }, 'limits must be an object'],
    ['an unknown tier', (c) => { c[0].minimum_security_tier = 'critical'; }, 'minimum_security_tier is not'],
  ];
  for (const [what, edit, message] of oneOf) {
    it(`rejects ${what} in the preflight`, async () => {
      const result = await run(edit);
      expect(codes(result)).toEqual(['DELEGATION_CHAIN_INVALID']);
      expect(result.errors.some((e) => e.message.includes(message))).toBe(true);
    });
  }
});
