/**
 * Multi-party authorization under the opt-in mpa-v1 profile (spec/profiles/multi-party): the shared vectors in
 * tests/interop/v2/multi_party_vectors.json through the public API, and what the vectors cannot express.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AdmissionConfigError,
  AlgorithmRegistry,
  Ed25519Provider,
  MPA_V1,
  MPA_V1_MAX_AUTHORIZATIONS,
  MlDsa65Provider,
  MultiPartyConfigError,
  buildMultiPartyAuthorization,
  checkMultiPartyAuthorizationStructure,
  createMultiPartyPolicyStore,
  createMultiPartyRequest,
  createPartyAuthorization,
  createPrincipalTrustStore,
  evaluateMultiPartyAuthorization,
} from '../index.js';
import type { CompositeKeyPair, MultiPartyEvaluation } from '../index.js';

const V = JSON.parse(readFileSync(new URL('../../../../tests/interop/v2/multi_party_vectors.json', import.meta.url), 'utf8'));
const registry = new AlgorithmRegistry();
registry.registerSigner(new Ed25519Provider());
registry.registerSigner(new MlDsa65Provider());
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const byName = (name: string) => V.cases.find((c: { name: string }) => c.name === name);
const codes = (r: MultiPartyEvaluation) => [...new Set(r.errors.map((e) => e.code))].sort();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const evaluate = (c: any, reg = registry, record: unknown = clone(V.records[c.record])) =>
  evaluateMultiPartyAuthorization(record, reg, {
    policy: V.policy_sets[c.policy_set],
    trust: V.trust_sets[c.trust_set],
    expected: c.expected,
    now: c.now_ms,
  });

/** A registry whose providers count the signatures they are asked to verify. */
function countingRegistry() {
  let verifications = 0;
  const counting = new AlgorithmRegistry();
  for (const provider of [new Ed25519Provider(), new MlDsa65Provider()]) {
    const verify = provider.verify.bind(provider);
    provider.verify = async (message: Uint8Array, signature: Uint8Array, publicKeyB64: string) => {
      verifications += 1;
      return verify(message, signature, publicKeyB64);
    };
    counting.registerSigner(provider);
  }
  return { counting, verifications: () => verifications };
}

describe('multi-party vectors', () => {
  it('has the cases', () => {
    expect(V.profile).toBe(MPA_V1);
    expect(V.max_authorizations).toBe(MPA_V1_MAX_AUTHORIZATIONS);
    expect(V.cases.length).toBeGreaterThanOrEqual(62);
    expect(V.config_cases.length).toBeGreaterThanOrEqual(21);
  });

  for (const c of V.cases) {
    it(`${c.group}: ${c.name} (${c.rule})`, async () => {
      const r = await evaluate(c);
      expect({
        authorized: r.authorized,
        structure: r.structure,
        verification: r.verification,
        parties_counted: r.parties_counted,
        required_parties: r.required_parties,
        codes: codes(r),
      }).toEqual(c.expect);
      expect(r.profile).toBe('mpa-v1');
      expect(r.policy_set_version).toBe(V.policy_sets[c.policy_set].policy_set_version);
      expect(r.trust_set_version).toBe(V.trust_sets[c.trust_set].trust_set_version);
      const rec = V.records[c.record];
      if (c.expect.structure === 'valid') {
        const req = rec.operation_payload.request;
        expect([r.operation, r.target, r.request_id, r.expires_at]).toEqual([rec.operation, req.target, req.request_id, req.expires_at]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(r.parties.map((p) => [p.party_id, p.role])).toEqual(rec.authorizations.map((a: any) => [a.party_id, a.role]));
        expect(r.parties.every((p) => (c.expect.verification === 'not_evaluated' ? p.verified === null : typeof p.verified === 'boolean'))).toBe(true);
        if (c.expect.parties_counted !== null) expect(r.parties.filter((p) => p.verified).length).toBe(c.expect.parties_counted);
      } else {
        expect([r.operation, r.target, r.request_id, r.expires_at, r.parties]).toEqual([null, null, null, null, []]);
      }
      for (const e of r.errors) expect(e.message.length).toBeLessThanOrEqual(300);
    });
  }

  for (const c of V.config_cases) {
    it(c.expect_code ? `refuses the policy set ${c.name} with ${c.expect_code}` : `loads the policy set ${c.name}`, () => {
      let error: unknown;
      try {
        createMultiPartyPolicyStore(clone(c.policy_set));
      } catch (e) {
        error = e;
      }
      if (c.expect_code === null) return expect(error).toBeUndefined();
      expect(error).toBeInstanceOf(MultiPartyConfigError);
      expect((error as MultiPartyConfigError).code).toBe(c.expect_code);
    });
  }

  for (const c of V.trust_config_cases) {
    it(`a trust set with ${c.name} is refused with ${c.expect_code}, by the loader and by the evaluation`, async () => {
      const refused = (e: unknown) => {
        expect(e).toBeInstanceOf(AdmissionConfigError);
        expect((e as AdmissionConfigError).code).toBe(c.expect_code);
      };
      let error: unknown;
      try {
        createPrincipalTrustStore(clone(c.trust_set));
      } catch (e) {
        error = e;
      }
      refused(error);
      const base = byName('two_of_three');
      await evaluateMultiPartyAuthorization(clone(V.records[base.record]), registry, {
        policy: V.policy_sets.base,
        trust: clone(c.trust_set),
        expected: base.expected,
        now: base.now_ms,
      }).then(() => expect.unreachable('a trust set that does not load must not be evaluated'), refused);
    });
  }
});

describe('multi-party authorization: what the vectors cannot express', () => {
  it('verifies no signature of a request it refuses earlier, and two per party otherwise', async () => {
    for (const name of ['seventeen_authorizations', 'without_request', 'another_audience', 'expired', 'target_the_operator_does_not_have', 'same_party_twice', 'self_assigned_role', 'sixteen_authorizations']) {
      const { counting, verifications } = countingRegistry();
      expect((await evaluate(byName(name), counting)).authorized).toBe(false);
      expect(verifications(), name).toBe(0);
    }
    const { counting, verifications } = countingRegistry();
    expect((await evaluate(byName('two_of_three'), counting)).authorized).toBe(true);
    expect(verifications()).toBe(4);
  });

  it('keeps no state: the same request is authorized every time it is evaluated', async () => {
    const c = byName('two_of_three');
    const results = await Promise.all([evaluate(c), evaluate(c), evaluate(c)]);
    expect(results.map((r) => r.authorized)).toEqual([true, true, true]);
    expect((await evaluate(c)).authorized).toBe(true);
  });

  it('accepts loaded stores as well as their JSON, with the same result', async () => {
    const c = byName('two_of_three');
    const r = await evaluateMultiPartyAuthorization(clone(V.records[c.record]), registry, {
      policy: createMultiPartyPolicyStore(V.policy_sets.base),
      trust: createPrincipalTrustStore(V.trust_sets.base),
      expected: c.expected,
      now: c.now_ms,
    });
    expect(r).toEqual(await evaluate(c));
  });

  it('gives a result, not an exception, for a record that is not an object', async () => {
    const c = byName('two_of_three');
    for (const record of [null, undefined, [], 'record', 7, true]) {
      const r = await evaluateMultiPartyAuthorization(record, registry, { policy: V.policy_sets.base, trust: V.trust_sets.base, expected: c.expected, now: c.now_ms });
      expect([r.authorized, r.structure, codes(r)]).toEqual([false, 'invalid', ['MPA_SCHEMA_INVALID']]);
    }
  });

  it('does not take a role from the record', async () => {
    const promoted = clone(V.records[byName('required_role_missing').record]);
    promoted.authorizations[0].role = 'owner'; // unsigned change of role: the signature no longer covers it
    const r = await evaluate(byName('required_role_missing'), registry, promoted);
    expect(r.authorized).toBe(false);
    expect(codes(r)).toEqual(['MPA_ROLE_MISMATCH']);
  });

  it('refuses a registry that cannot verify one of the algorithms', async () => {
    const classicalOnly = new AlgorithmRegistry();
    classicalOnly.registerSigner(new Ed25519Provider());
    const r = await evaluate(byName('two_of_three'), classicalOnly);
    expect([r.authorized, r.verification, codes(r)]).toEqual([false, 'failed', ['MPA_SIGNATURE_INVALID']]);
  });

  it('throws on what the executor states wrongly, instead of deciding', async () => {
    const c = byName('two_of_three');
    for (const expected of [
      undefined,
      { ...c.expected, operation: 'delete_everything' },
      { ...c.expected, target: '' },
      { ...c.expected, parameters: 'none' },
      { ...c.expected, parameters: { ratio: 0.5 } },
      { ...c.expected, extra: 1 },
    ]) {
      await expect(
        evaluateMultiPartyAuthorization(clone(V.records[c.record]), registry, {
          policy: V.policy_sets.base,
          trust: V.trust_sets.base,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          expected: expected as any,
          now: c.now_ms,
        }),
      ).rejects.toBeInstanceOf(MultiPartyConfigError);
    }
  });

  it('a policy store cannot be changed after it is loaded', () => {
    const store = createMultiPartyPolicyStore(clone(V.policy_sets.base));
    expect(createMultiPartyPolicyStore(store)).toBe(store);
    expect(Object.isFrozen(store)).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => ((store as any).audience = 'verifier:other')).toThrow();
  });
});

describe('multi-party authorization: signing', () => {
  const ed25519 = new Ed25519Provider();
  const mlDsa65 = new MlDsa65Provider();
  async function party(id: string) {
    const [c, p] = [await ed25519.generateKeypair(), await mlDsa65.generateKeypair()];
    const keys: CompositeKeyPair = {
      classical: { kid: c.kid, alg: 'ed25519', secretKeyB64: c.secretKeyB64, publicKeyB64: c.publicKeyB64 },
      pq: { kid: p.kid, alg: 'ml-dsa-65', secretKeyB64: p.secretKeyB64, publicKeyB64: p.publicKeyB64 },
    };
    const trusted = {
      human_id: id,
      keys: [
        { kid: c.kid, alg: 'ed25519', public_key_b64: c.publicKeyB64, status: 'active' },
        { kid: p.kid, alg: 'ml-dsa-65', public_key_b64: p.publicKeyB64, status: 'active' },
      ],
    };
    return { id, keys, trusted };
  }

  it('what the SDK signs, the SDK authorizes under the operator policy', async () => {
    const [owner, admin] = [await party('human:owner'), await party('human:admin')];
    const now = Date.parse('2026-11-18T12:00:00Z');
    const payload = createMultiPartyRequest({
      target: 'agent:signed-here',
      audience: 'verifier:here',
      parameters: { reason: 'administrative' },
      issuedAt: now,
      validitySeconds: 600,
    });
    expect(payload.request).toMatchObject({ profile: 'mpa-v1', target: 'agent:signed-here', audience: 'verifier:here', issued_at: '2026-11-18T12:00:00.000Z', expires_at: '2026-11-18T12:10:00.000Z' });
    expect(payload.request.request_id).toMatch(/^mpa:[0-9a-f]{32}$/);
    expect(createMultiPartyRequest({ target: 'a', audience: 'b', validitySeconds: 1 }).request.request_id).not.toBe(payload.request.request_id);

    const record = buildMultiPartyAuthorization('revoke_agent', payload, [
      await createPartyAuthorization(registry, 'revoke_agent', payload, owner.id, 'owner', owner.keys),
      await createPartyAuthorization(registry, 'revoke_agent', payload, admin.id, 'org_admin', admin.keys),
    ]);
    expect(record.required_parties).toBe(2);
    const options = {
      policy: {
        policy_set_version: 'here.1',
        profile: 'mpa-v1',
        audience: 'verifier:here',
        max_validity_seconds: 600,
        subjects: [{
          target: 'agent:signed-here',
          parties: [{ party_id: owner.id, role: 'owner' }, { party_id: admin.id, role: 'org_admin' }],
          operations: { revoke_agent: { required_parties: 2, allowed_roles: ['owner', 'org_admin'], required_roles: ['owner'] } },
        }],
      },
      trust: { trust_set_version: 'here.1', principals: [owner.trusted, admin.trusted] },
      expected: { operation: 'revoke_agent' as const, target: 'agent:signed-here', parameters: { reason: 'administrative' } },
      now: now + 1000,
    };
    const r = await evaluateMultiPartyAuthorization(clone(record), registry, options);
    expect(r.errors).toEqual([]);
    expect([r.authorized, r.parties_counted, r.request_id]).toEqual([true, 2, payload.request.request_id]);
    // The structure of the same record says nothing about who signed.
    expect(checkMultiPartyAuthorizationStructure(record).valid).toBe(true);
  });

  it('refuses to build a request the profile would not accept', () => {
    const base = { target: 'agent:x', audience: 'verifier:y', validitySeconds: 60 };
    for (const input of [
      { ...base, target: '' },
      { ...base, audience: 'a'.repeat(257) },
      { ...base, validitySeconds: 0 },
      { ...base, validitySeconds: 86_401 },
      { ...base, validitySeconds: 1.5 },
      { ...base, requestId: '' },
      { ...base, parameters: { ratio: 0.5 } },
    ]) {
      let error: unknown;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        createMultiPartyRequest(input as any);
      } catch (e) {
        error = e;
      }
      expect(error, JSON.stringify(input)).toBeInstanceOf(MultiPartyConfigError);
      expect((error as MultiPartyConfigError).code, JSON.stringify(input)).toBe('CONFIG_INVALID_VALUE');
    }
  });
});

describe('multi-party authorization: the structural check is not an authorization', () => {
  const entry = (party_id: string, role: string) => ({ party_id, role, composite_sig: { classical: { alg: 'ed25519', kid: '0'.repeat(32), sig_b64: 'AAAAAAAAAAA=' }, pq: null, binding: 'classical_only' } });
  const record = (...authorizations: unknown[]) => ({ type: 'multi_party_authorization', operation: 'revoke_agent', operation_payload: {}, required_parties: 2, authorizations });

  it('accepts a well-formed record signed by no one', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = checkMultiPartyAuthorizationStructure(record(entry('anyone', 'owner'), entry('anyone', 'owner')) as any);
    expect(r).toEqual({ valid: true, errors: [] });
  });

  it('reports the shape problems the other SDKs report', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const check = (r: unknown, policy?: any) => checkMultiPartyAuthorizationStructure(r as any, policy).errors;
    expect(check(record(entry('a', 'owner')))).toEqual(['Insufficient authorizations: 1 < 2']);
    expect(check(record(entry('a', 'org_admin'), entry('b', 'org_admin')))).toEqual(['Owner authorization required but not present']);
    expect(check({ ...record(entry('a', 'owner'), entry('b', 'recovery_contact')), operation: 'rotate_org_key' })).toEqual(['Role recovery_contact not allowed for operation rotate_org_key']);
    expect(check(record(entry('a', 'owner'), { party_id: 'b', role: 'org_admin' }))).toEqual(['Missing composite_sig for party b']);
    expect(check(record(entry('a', 'org_admin'), entry('b', 'org_admin')), { requiredParties: 2, allowedRoles: ['org_admin'], requireOwner: false })).toEqual([]);
    expect(check({ ...record(entry('a', 'owner'), entry('b', 'owner')), operation: 'delete_everything' })).toEqual(['No policy defined for operation: delete_everything']);
  });
});
