/**
 * Multi-party authorization under the opt-in mpa-v1 profile (spec/profiles/multi-party): the shared vectors in
 * tests/interop/v2/multi_party_vectors.json through the public API, and what the vectors cannot express.
 */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
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

  it('decides on the record it was given: what the caller changes while signatures are verified is not read', async () => {
    const c = byName('signed_another_request'); // alice signs this request; bob, another one
    const record = clone(V.records[c.record]);
    const pending = evaluate(c, registry, record); // runs up to the first signature it verifies
    record.authorizations[1] = clone(record.authorizations[0]); // alice again, where bob was checked as a party
    const r = await pending;
    expect([r.authorized, r.verification, r.parties_counted, codes(r)]).toEqual([false, 'failed', 1, ['MPA_SIGNATURE_INVALID']]);
    expect(r.parties.map((p) => [p.party_id, p.verified])).toEqual([['human:alice', true], ['human:bob', false]]);
  });

  it('keeps nothing of the caller to read again: a record that is more than its members is not a record', async () => {
    const c = byName('two_of_three');
    // An object with an own symbol, an instance or one with a prototype of its own is not what JSON.parse makes. It is
    // not copied member by member, so it is not judged at all: its accessors could answer one thing to a check and
    // another to the next, and the caller could change it while the signatures are verified.
    const kinds: Array<[string, (members: object) => object]> = [
      ['with an own symbol', (members) => Object.assign(members, { [Symbol('any')]: true })],
      ['an instance', (members) => Object.assign(new (class Authorization {})(), members)],
      ['with a prototype of its own', (members) => Object.assign(Object.create({ inherited: true }), members)],
    ];
    const invalid = (r: MultiPartyEvaluation) => [r.authorized, r.structure, r.verification, codes(r)];
    for (const [what, make] of kinds) {
      // The record itself, with an accessor that shows the signed parameters only once the comparison is over...
      let reads = 0;
      const good = clone(V.records[c.record]);
      const { operation_payload: signed, ...rest } = good;
      const record = make(rest);
      Object.defineProperty(record, 'operation_payload', {
        enumerable: true,
        get: () => ((reads += 1) <= 3 ? { request: signed.request, parameters: { reason: 'administrative' } } : signed),
      });
      const stated = { ...c, expected: { ...c.expected, parameters: { reason: 'administrative' } } };
      expect(invalid(await evaluate(stated, registry, record)), what).toEqual([false, 'invalid', 'not_evaluated', ['MPA_SCHEMA_INVALID']]);
      expect(reads, what).toBe(0);
      // ...changed by the caller while the evaluation waits...
      const changed = make(clone(V.records[c.record])) as { authorizations: unknown[] };
      const pending = evaluate(c, registry, changed);
      changed.authorizations.length = 0;
      expect(invalid(await pending), what).toEqual([false, 'invalid', 'not_evaluated', ['MPA_SCHEMA_INVALID']]);
      // ...and one of its authorizations: the second entry would be the owner to the party checks and the administrator,
      // who did sign, to the signature check.
      const entries = clone(V.records[c.record]);
      entries.authorizations[1] = make(entries.authorizations[1]);
      expect(invalid(await evaluate(c, registry, entries)), what).toEqual([false, 'invalid', 'not_evaluated', ['MPA_SCHEMA_INVALID']]);
    }
    // A plain object with an accessor is read once, and what it gave then is what is judged.
    let reads = 0;
    const { operation_payload: signed, ...rest } = clone(V.records[c.record]);
    const plain = Object.defineProperty(rest, 'operation_payload', { enumerable: true, get: () => ((reads += 1), signed) });
    const r = await evaluate(c, registry, plain);
    expect([r.authorized, codes(r), reads]).toEqual([true, [], 1]);
  });

  it('takes JSON read in another realm as the JSON it is', async () => {
    const c = byName('two_of_three');
    const foreign = (value: unknown) => runInNewContext('JSON.parse(text)', { text: JSON.stringify(value) });
    const record = foreign(V.records[c.record]);
    expect(Object.getPrototypeOf(record)).not.toBe(Object.prototype);
    const r = await evaluate({ ...c, expected: foreign(c.expected) }, registry, record);
    expect([r.authorized, codes(r)]).toEqual([true, []]);
    const built = createMultiPartyRequest({ target: 'agent:x', audience: 'verifier:y', validitySeconds: 60, parameters: foreign({ limits: [1, { daily: 2 }] }) });
    expect(built.parameters).toEqual({ limits: [1, { daily: 2 }] });
  });

  it('what is signed is what was compared with what the executor expects', async () => {
    const c = byName('two_of_three');
    const record = clone(V.records[c.record]);
    const signed = record.operation_payload.parameters;
    record.operation_payload.parameters = { reason: 'administrative' }; // what the executor is about to do; no one signed it
    const pending = evaluate({ ...c, expected: { ...c.expected, parameters: { reason: 'administrative' } } }, registry, record);
    record.operation_payload.parameters = signed; // back to what the parties signed, once the parameters were compared
    const r = await pending;
    expect([r.authorized, r.parties_counted, codes(r)]).toEqual([false, 0, ['MPA_SIGNATURE_INVALID']]);
  });

  it('a record nested too deeply to copy is refused as before', async () => {
    const c = byName('two_of_three');
    const record = clone(V.records[c.record]);
    let deep: Record<string, unknown> = (record.operation_payload.parameters = {});
    for (let i = 0; i < 100_000; i += 1) deep = deep.deeper = {};
    const r = await evaluate(c, registry, record);
    expect([r.authorized, r.structure, codes(r)]).toEqual([false, 'invalid', ['MPA_NOT_REPRESENTABLE']]);
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

  it('gives a result, not an exception, for a record with a hole among its authorizations', async () => {
    const c = byName('two_of_three');
    const record = clone(V.records[c.record]);
    record.authorizations.length += 1; // a third entry that is not there
    const r = await evaluate(c, registry, record);
    expect([r.authorized, r.structure, codes(r)]).toEqual([false, 'invalid', ['MPA_SCHEMA_INVALID']]);
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

  it('with no clock given, the system clock decides', async () => {
    const [owner, admin] = [await party('human:owner'), await party('human:admin')];
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
      expected: { operation: 'revoke_agent' as const, target: 'agent:signed-here', parameters: {} },
    };
    const evaluated = async (issuedAt?: number) => {
      const request = { target: 'agent:signed-here', audience: 'verifier:here', validitySeconds: 60 };
      const payload = createMultiPartyRequest(issuedAt === undefined ? request : { ...request, issuedAt });
      const record = buildMultiPartyAuthorization('revoke_agent', payload, [
        await createPartyAuthorization(registry, 'revoke_agent', payload, owner.id, 'owner', owner.keys),
        await createPartyAuthorization(registry, 'revoke_agent', payload, admin.id, 'org_admin', admin.keys),
      ]);
      return evaluateMultiPartyAuthorization(clone(record), registry, options);
    };
    // Issued by the builder's clock and read by the evaluator's: in force.
    const fresh = await evaluated();
    expect([fresh.authorized, codes(fresh)]).toEqual([true, []]);
    // Issued an hour ago for a minute: over.
    const stale = await evaluated(Date.now() - 3_600_000);
    expect([stale.authorized, codes(stale)]).toEqual([false, ['MPA_EXPIRED']]);
  });

  /** Two parties, the operator's files for them, and what one evaluation of `parameters` gives. */
  async function setting() {
    const [owner, admin] = [await party('human:owner'), await party('human:admin')];
    const now = Date.parse('2026-11-18T12:00:00Z');
    const request = { target: 'agent:signed-here', audience: 'verifier:here', issuedAt: now, validitySeconds: 600 };
    const options = (parameters: unknown) => ({
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expected: { operation: 'revoke_agent' as const, target: 'agent:signed-here', parameters: parameters as any },
      now: now + 1000,
    });
    /** A record whose two parties signed `payload`, whatever it holds: the signer signs what it is given. */
    const signedOver = async (payload: Parameters<typeof createPartyAuthorization>[2]) => buildMultiPartyAuthorization('revoke_agent', payload, [
      await createPartyAuthorization(registry, 'revoke_agent', payload, owner.id, 'owner', owner.keys),
      await createPartyAuthorization(registry, 'revoke_agent', payload, admin.id, 'org_admin', admin.keys),
    ]);
    const configCode = async (run: () => unknown) => {
      try {
        await run();
      } catch (e) {
        return e instanceof MultiPartyConfigError ? e.code : `another error: ${String(e)}`;
      }
      return 'no error';
    };
    return { request, options, signedOver, configCode };
  }

  it('takes the integers a binary64 holds exactly, from -(2^53 - 1) to 2^53 - 1, and no other number', async () => {
    const { request, options, signedOver, configCode } = await setting();
    const MAX = Number.MAX_SAFE_INTEGER;

    // The largest integers of the profile are built, signed, stated and authorized.
    const largest = { ceiling: MAX, floor: -MAX };
    const atTheLimit = createMultiPartyRequest({ ...request, parameters: largest });
    const within = await evaluateMultiPartyAuthorization(clone(await signedOver(atTheLimit)), registry, options(largest));
    expect([within.authorized, codes(within)]).toEqual([true, []]);

    for (const parameters of [{ amount: MAX + 1 }, { amount: -MAX - 1 }, { amount: 1e21 }, { limits: [1, { amount: MAX + 1 }] }]) {
      const what = JSON.stringify(parameters);
      // One more is not a request the SDK builds...
      expect(await configCode(() => createMultiPartyRequest({ ...request, parameters })), what).toBe('CONFIG_INVALID_VALUE');
      // ...nor parameters an executor can state...
      const record = clone(await signedOver(atTheLimit));
      expect(await configCode(() => evaluateMultiPartyAuthorization(record, registry, options(parameters))), what).toBe('CONFIG_INVALID_VALUE');
      // ...and a record that holds one decides nothing, whoever signed it: 2^53 and 2^53 + 1 are one number to
      // whoever reads JSON numbers as binary64, so a signature over one would stand for the other.
      const over = await signedOver({ request: atTheLimit.request, parameters });
      const refused = await evaluateMultiPartyAuthorization(clone(over), registry, options(largest));
      expect([refused.authorized, refused.structure, refused.verification, codes(refused)], what).toEqual([false, 'invalid', 'not_evaluated', ['MPA_NOT_REPRESENTABLE']]);
    }
  });

  it('compares JSON data only: a Set, a Map, a Date or an instance is not a value of parameters', async () => {
    const { request, options, signedOver, configCode } = await setting();
    const plain = createMultiPartyRequest({ ...request, parameters: { scopes: {} } });
    class Limit {
      daily = 10;
    }
    const notJson: Array<[string, Record<string, unknown>]> = [
      ['a Set', { scopes: new Set(['read', 'write', 'admin']) }],
      ['a Map', { scopes: new Map([['daily', 1_000_000]]) }],
      ['a Date', { scopes: new Date(0) }],
      ['a RegExp', { scopes: /.*/ }],
      ['an instance', { scopes: new Limit() }],
      ['an array with a hole', { scopes: [1, , 3] }], // eslint-disable-line no-sparse-arrays
      ['undefined in an array', { scopes: [undefined] }],
      ['an undefined member', { scopes: {}, more: undefined }],
      ['a BigInt', { scopes: 10n }],
      ['a function', { scopes: () => 1 }],
      ['a symbol', { scopes: Symbol('all') }],
      ['a member under a symbol', { scopes: { [Symbol('all')]: true } }],
    ];
    for (const [what, parameters] of notJson) {
      // Not a request the SDK builds...
      expect(await configCode(() => createMultiPartyRequest({ ...request, parameters })), what).toBe('CONFIG_INVALID_VALUE');
      // ...and not parameters an executor can state: canonicalized, most of these are {}, what the parties signed here.
      const record = clone(await signedOver(plain));
      expect(await configCode(() => evaluateMultiPartyAuthorization(record, registry, options(parameters))), what).toBe('CONFIG_INVALID_VALUE');
      // A record that holds one, never sent as JSON, is not representable either: the structure phase refuses it
      // before any signature is read.
      const inProcess = { ...(await signedOver(plain)), operation_payload: { request: plain.request, parameters } };
      const refused = await evaluateMultiPartyAuthorization(inProcess, registry, options({ scopes: {} }));
      expect([refused.authorized, refused.structure, codes(refused)], what).toEqual([false, 'invalid', ['MPA_NOT_REPRESENTABLE']]);
    }
    // The control: the same record with plain data is authorized.
    const control = await evaluateMultiPartyAuthorization(clone(await signedOver(plain)), registry, options({ scopes: {} }));
    expect([control.authorized, codes(control)]).toEqual([true, []]);
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
