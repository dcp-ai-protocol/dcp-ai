/**
 * Admission (spec/profiles/admission): the shared vectors in tests/interop/v2/admission_vectors.json,
 * through the public API, and what the vectors cannot express.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AdmissionConfigError,
  AlgorithmRegistry,
  DEFAULT_VERIFIER_POLICY,
  Ed25519Provider,
  MlDsa65Provider,
  admitSignedBundleV2,
  createPrincipalTrustStore,
  evaluateAdmissionV2,
  resolveStrictV1Profile,
  revocationSubjects,
  verifySignedBundleV2,
} from '../index.js';

const VECTORS = JSON.parse(readFileSync(new URL('../../../../tests/interop/v2/admission_vectors.json', import.meta.url), 'utf8'));
const registry = new AlgorithmRegistry();
registry.registerSigner(new Ed25519Provider());
registry.registerSigner(new MlDsa65Provider());
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('admission vectors', () => {
  for (const c of VECTORS.cases) {
    it(`${c.name} (${c.rule})`, async () => {
      const result = await admitSignedBundleV2(clone(VECTORS.signed_bundles[c.bundle]), registry, {
        profile: c.profile ? VECTORS.profiles[c.profile] : undefined,
        trust: c.trust ? VECTORS.trust_sets[c.trust] : undefined,
        revocation: c.revocation,
        now: Date.parse(c.now),
      });
      expect({
        verified: result.verified,
        principal_trust: result.principal_trust,
        profile_compliance: result.profile_compliance,
        admitted: result.admitted,
        recorded_decision: result.recorded_decision,
        action_authorized: result.action_authorized,
        codes: [...new Set(result.errors.map((e) => e.code))].sort(),
      }).toEqual(c.expected);
      expect(result.profile).toBe(c.profile ? 'strict-v1' : null);
      expect(result.trust_set_version).toBe(c.trust ? VECTORS.trust_sets[c.trust].trust_set_version : null);
    });
  }

  for (const c of VECTORS.config_cases) {
    it(`refuses ${c.kind} ${c.name} with ${c.expected_code}`, () => {
      const load = c.kind === 'trust_set' ? createPrincipalTrustStore : resolveStrictV1Profile;
      let error: unknown;
      try {
        load(clone(c.config));
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(AdmissionConfigError);
      expect((error as AdmissionConfigError).code).toBe(c.expected_code);
    });
  }

  for (const c of VECTORS.accepted_profiles) {
    it(`loads ${c.name}`, () => {
      const profile = resolveStrictV1Profile(clone(c.config));
      expect(profile.maxSessionDurationSeconds).toBe(c.expected_max_session_duration_seconds);
      expect(profile.maxRevocationAgeSeconds).toBe(c.expected_max_revocation_age_seconds);
      expect(profile.policy.max_session_duration_seconds).toBe(c.expected_max_session_duration_seconds);
    });
  }
});

describe('admission API', () => {
  const base = () => clone(VECTORS.signed_bundles.base);
  const caseA = VECTORS.cases.find((c: any) => c.name === 'A_known_principal_strict');
  const now = Date.parse(caseA.now);

  it('the verifier reports the key of each signature component it verified', async () => {
    const result = await verifySignedBundleV2(base(), registry, DEFAULT_VERIFIER_POLICY, { now });
    expect(result.verified).toBe(true);
    const keys = result.details!.signer_keys!;
    const rpr = base().bundle.responsible_principal_record.payload.binding_keys;
    for (const signature of ['bundle', 'responsible_principal_record']) {
      expect(keys.filter((k) => k.signature === signature).map((k) => [k.component, k.kid, k.verified])).toEqual([
        ['classical', rpr[0].kid, true],
        ['pq', rpr[1].kid, true],
      ]);
    }
    expect(new Set(keys.map((k) => k.signature))).toEqual(new Set(['bundle', 'responsible_principal_record', 'agent_passport', 'intent', 'policy_decision']));
  });

  it('without now, verification uses the system clock as before', async () => {
    // The base bundle's session runs from 10:00 to 10:05 on 2 November 2026: outside it, on the
    // system clock, it does not verify; at the vector's now it does.
    expect((await verifySignedBundleV2(base(), registry, DEFAULT_VERIFIER_POLICY, { now })).verified).toBe(true);
    const wallClock = await verifySignedBundleV2(base(), registry, DEFAULT_VERIFIER_POLICY);
    const t = Date.now();
    expect(wallClock.verified).toBe(t >= Date.parse('2026-11-02T09:59:30Z') && t <= Date.parse('2026-11-02T10:05:00Z'));
  });

  it('revocation subjects are the agent and every verified signer kid, sorted', async () => {
    const verification = await verifySignedBundleV2(base(), registry, DEFAULT_VERIFIER_POLICY, { now });
    const subjects = revocationSubjects(base(), verification);
    expect(subjects.agent_ids).toEqual(['agent:acme-bot']);
    expect(subjects.kids).toEqual([...new Set(verification.details!.signer_keys!.map((k) => k.kid))].sort());
    expect(subjects.kids).toHaveLength(4);
  });

  it('a profile is frozen: its policy cannot be weakened after loading', () => {
    const profile = resolveStrictV1Profile(VECTORS.profiles.strict);
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.policy)).toBe(true);
    expect(() => {
      (profile.policy as any).allow_v1_bundles = true;
    }).toThrow();
    expect(profile.policy).toMatchObject({
      default_mode: 'hybrid_required',
      risk_overrides: { low: 'hybrid_required', medium: 'hybrid_required', high: 'hybrid_required' },
      allow_v1_bundles: false,
      require_session_binding: true,
      require_session_expiry: true,
      require_audience_binding: true,
      verifier_id: VECTORS.verifier_id,
      max_session_duration_seconds: 300,
    });
  });

  it('a profile without a trust set, or with a caller policy, is a configuration error', async () => {
    const verification = await verifySignedBundleV2(base(), registry, DEFAULT_VERIFIER_POLICY, { now });
    expect(() => evaluateAdmissionV2({ signedBundle: base(), verification, profile: VECTORS.profiles.strict, now })).toThrow(
      expect.objectContaining({ code: 'CONFIG_PROFILE_CONTRADICTION' }),
    );
    await expect(
      admitSignedBundleV2(base(), registry, { profile: VECTORS.profiles.strict, trust: VECTORS.trust_sets.principal, policy: DEFAULT_VERIFIER_POLICY, now }),
    ).rejects.toMatchObject({ code: 'CONFIG_PROFILE_CONTRADICTION' });
  });

  it('a verification under a permissive policy is not compliant with the profile', async () => {
    // The caller passed the result of a classical_only verification: the profile notices.
    const permissive = { ...DEFAULT_VERIFIER_POLICY, default_mode: 'classical_only' as const, risk_overrides: { low: 'classical_only' as const, medium: 'classical_only' as const, high: 'classical_only' as const } };
    const verification = await verifySignedBundleV2(base(), registry, permissive, { now });
    const result = evaluateAdmissionV2({
      signedBundle: base(),
      verification,
      profile: VECTORS.profiles.strict,
      trust: VECTORS.trust_sets.principal,
      revocation: caseA.revocation,
      now,
    });
    expect(result.admitted).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('PROFILE_HYBRID_REQUIRED');
  });

  it('action_authorized is false even for an admitted approve decision', async () => {
    const result = await admitSignedBundleV2(base(), registry, {
      profile: VECTORS.profiles.strict,
      trust: VECTORS.trust_sets.principal,
      revocation: caseA.revocation,
      now,
    });
    expect(result.admitted).toBe(true);
    expect(result.recorded_decision).toBe('approve');
    expect(result.action_authorized).toBe(false);
  });

  it('error messages are bounded and carry no key material', async () => {
    const huge = base();
    huge.bundle.responsible_principal_record.payload.human_id = 'x'.repeat(100_000);
    const result = await admitSignedBundleV2(huge, registry, { trust: VECTORS.trust_sets.principal, now });
    for (const e of result.errors) expect(e.message.length).toBeLessThanOrEqual(501);
    const set = VECTORS.trust_sets.principal;
    const text = JSON.stringify(result.errors);
    for (const key of set.principals[0].keys) expect(text).not.toContain(key.public_key_b64);
  });
});
