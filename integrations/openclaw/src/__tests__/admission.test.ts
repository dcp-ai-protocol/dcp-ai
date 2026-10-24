/**
 * dcp_verify_bundle with trusted principals and the strict-v1 profile (spec/profiles/admission),
 * through the registered tool and executeVerifyBundle.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import register, { configureVerifier, executeVerifyBundle } from '../index.js';

const VECTORS = JSON.parse(readFileSync(new URL('../../../../tests/interop/v2/admission_vectors.json', import.meta.url), 'utf8'));
const V1_BUNDLE = JSON.parse(readFileSync(new URL('../../../../tests/conformance/examples/citizenship_bundle.signed.json', import.meta.url), 'utf8'));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const bundle = (name: string) => clone(VECTORS.signed_bundles[name]);
const NOW = Date.parse(VECTORS.cases.find((c: any) => c.name === 'A_known_principal_strict').now);
const STRICT = VECTORS.profiles.strict;
const TRUSTED = VECTORS.trust_sets.principal;

const fresh = vi.fn(async (subjects: { agent_ids: string[]; kids: string[] }) => ({
  checked_at: new Date(NOW - 30_000).toISOString(),
  agents: Object.fromEntries(subjects.agent_ids.map((id) => [id, 'not_revoked' as const])),
  keys: Object.fromEntries(subjects.kids.map((kid) => [kid, 'not_revoked' as const])),
}));
const strict = (over: Record<string, unknown> = {}) =>
  configureVerifier({ profile: STRICT, trustedPrincipals: TRUSTED, revocationSource: fresh, clock: () => NOW, ...over });

afterEach(() => {
  configureVerifier();
  fresh.mockClear();
});

describe('dcp_verify_bundle under strict-v1', () => {
  it('admits a bundle from a trusted principal and says it is evidence, not an authorization', async () => {
    strict();
    const result = await executeVerifyBundle({ signed_bundle: bundle('base') });
    expect(result).toMatchObject({
      verified: true,
      admitted: true,
      principal_trust: 'trusted',
      profile: 'strict-v1',
      profile_compliance: 'compliant',
      action_authorized: false,
      recorded_decision: 'approve',
      trust_set_version: TRUSTED.trust_set_version,
      codes: [],
      agent_id: 'agent:acme-bot',
      human_id: 'human:acme-ops',
      verification_mode: 'hybrid_required',
    });
    expect(result.message).toMatch(/evidence, not an authorization/);
  });

  it('a recorded block decision is admitted evidence with action_authorized false', async () => {
    strict();
    const result = await executeVerifyBundle({ signed_bundle: bundle('blocked') });
    expect(result).toMatchObject({ admitted: true, recorded_decision: 'block', action_authorized: false });
  });

  it('an unknown principal stays verified but is not admitted, and names no agent', async () => {
    strict();
    const result = await executeVerifyBundle({ signed_bundle: bundle('unknown_principal') });
    expect(result).toMatchObject({ verified: true, admitted: false, principal_trust: 'untrusted', codes: ['TRUST_PRINCIPAL_UNKNOWN'] });
    expect(result.agent_id).toBeUndefined();
    expect(result.human_id).toBeUndefined();
    expect(result.message).toMatch(/^NOT ADMITTED/);
  });

  it.each([
    ['attacker_claims_known_human_id', 'TRUST_KEY_NOT_ANCHORED'],
    ['pq_key_substituted', 'TRUST_KEY_NOT_ANCHORED'],
    ['other_intended_verifier', 'PROFILE_AUDIENCE_MISMATCH'],
    ['session_301_s', 'PROFILE_SESSION_TOO_LONG'],
    ['classical_only', 'PROFILE_HYBRID_REQUIRED'],
  ])('refuses %s with %s', async (name, code) => {
    strict();
    const result = await executeVerifyBundle({ signed_bundle: bundle(name) });
    expect(result.admitted).toBe(false);
    expect(result.codes).toContain(code);
  });

  it('refuses a V1 bundle', async () => {
    strict();
    const result = await executeVerifyBundle({ signed_bundle: clone(V1_BUNDLE) });
    expect(result).toMatchObject({ verified: false, admitted: false, codes: ['PROFILE_V2_REQUIRED'] });
  });

  it('the model cannot pass a verifier_policy, even a stricter one', async () => {
    strict();
    for (const param of [{ default_mode: 'pq_only' }, { default_mode: 'hybrid_required' }, { allow_v1_bundles: false }]) {
      const result = await executeVerifyBundle({ signed_bundle: bundle('base'), verifier_policy: param as any });
      expect(result.admitted).toBe(false);
      expect(result.errors.join(' ')).toMatch(/cannot change the operator's strict-v1 profile/);
    }
  });

  it('parameters the tool does not define change nothing: no trust set, audience or profile from the model', async () => {
    strict();
    const result = await executeVerifyBundle({
      signed_bundle: bundle('unknown_principal'),
      trusted_principals: { trust_set_version: 'x', principals: [] },
      profile: null,
      verifier_id: 'verifier:someone-else',
      revocation: { checked_at: new Date(NOW).toISOString(), agents: {}, keys: {} },
    } as any);
    expect(result.codes).toEqual(['TRUST_PRINCIPAL_UNKNOWN']);
  });

  it('a revocation source that fails refuses the bundle; one that answers revoked too', async () => {
    strict({ revocationSource: async () => { throw new Error('down'); } });
    expect((await executeVerifyBundle({ signed_bundle: bundle('base') })).codes).toEqual(['REVOCATION_UNAVAILABLE']);
    strict({ revocationSource: async (s: any) => ({ ...(await fresh(s)), agents: { 'agent:acme-bot': 'revoked' } }) });
    expect((await executeVerifyBundle({ signed_bundle: bundle('base') })).codes).toEqual(['REVOCATION_REVOKED']);
  });

  it('re-reads the trust set on every call: a principal removed later is refused', async () => {
    let trust: unknown = TRUSTED;
    strict({ trustedPrincipals: () => trust as any });
    expect((await executeVerifyBundle({ signed_bundle: bundle('base') })).admitted).toBe(true);
    trust = VECTORS.trust_sets.empty;
    expect((await executeVerifyBundle({ signed_bundle: bundle('base') })).codes).toEqual(['TRUST_PRINCIPAL_UNKNOWN']);
  });

  it('works through the registered tool', async () => {
    const tools = new Map<string, any>();
    register({ registerTool: (tool: any) => tools.set(tool.name, tool) }, { profile: STRICT, trustedPrincipals: TRUSTED, revocationSource: fresh, clock: () => NOW });
    const result = await tools.get('dcp_verify_bundle').execute('call-1', { signed_bundle: bundle('base') });
    const text = JSON.stringify(result);
    expect(text).toMatch(/"admitted":true/);
  });
});

describe('dcp_verify_bundle with trusted principals only', () => {
  it('admits a trusted principal under the operator policy and refuses an unknown one', async () => {
    configureVerifier({ trustedPrincipals: TRUSTED, clock: () => NOW });
    expect(await executeVerifyBundle({ signed_bundle: bundle('base') })).toMatchObject({ admitted: true, profile: null, profile_compliance: 'not_evaluated' });
    expect((await executeVerifyBundle({ signed_bundle: bundle('unknown_principal') })).codes).toEqual(['TRUST_PRINCIPAL_UNKNOWN']);
  });

  it('the parameter still only tightens the policy', async () => {
    configureVerifier({ trustedPrincipals: TRUSTED, verifierPolicy: { default_mode: 'hybrid_required' }, clock: () => NOW });
    const result = await executeVerifyBundle({ signed_bundle: bundle('base'), verifier_policy: { default_mode: 'pq_only' } });
    expect(result).toMatchObject({ admitted: true, verification_mode: 'hybrid_required' });
  });
});

describe('configureVerifier', () => {
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return (e as { code?: string }).code ?? (e as Error).message;
    }
    return 'accepted';
  };

  it.each([
    ['a profile with verifierPolicy', { profile: STRICT, trustedPrincipals: TRUSTED, revocationSource: fresh, verifierPolicy: {} }, 'CONFIG_PROFILE_CONTRADICTION'],
    ['a profile without trusted principals', { profile: STRICT, revocationSource: fresh }, 'CONFIG_PROFILE_CONTRADICTION'],
    ['a profile without a revocation source', { profile: STRICT, trustedPrincipals: TRUSTED }, 'CONFIG_PROFILE_CONTRADICTION'],
    ['a weakened profile', { profile: { ...STRICT, verifier_policy: { require_audience_binding: false } }, trustedPrincipals: TRUSTED, revocationSource: fresh }, 'CONFIG_PROFILE_CONTRADICTION'],
    ['a trust set with a duplicate key', { trustedPrincipals: VECTORS.config_cases.find((c: any) => c.name === '7_identical_key_twice').config }, 'CONFIG_TRUST_DUPLICATE'],
  ])('refuses %s and keeps the previous configuration', async (_label, options, expected) => {
    strict();
    expect(code(() => configureVerifier(options as any))).toBe(expected);
    expect((await executeVerifyBundle({ signed_bundle: bundle('base') })).admitted).toBe(true);
  });

  it('refuses an unknown option', () => {
    expect(code(() => configureVerifier({ trustedPrincipalz: TRUSTED } as any))).toMatch(/Unknown configureVerifier option/);
  });
});
