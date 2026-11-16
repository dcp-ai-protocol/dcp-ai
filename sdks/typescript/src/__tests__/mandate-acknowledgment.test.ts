/**
 * Mandate acknowledgment (MP-02 F4): tests/interop/v2/mandate_acknowledgment_vectors.json through the public API,
 * and what the vectors cannot express: the composition equal to admitDelegatedBundleV2, the snapshot against a
 * provider that changes the caller's inputs, the creation contract, the new context kept out of DCP_CONTEXTS, and
 * the record tables against their schemas.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as sdk from '../index.js';
import {
  AlgorithmRegistry,
  DCP_CONTEXTS,
  Ed25519Provider,
  MANDATE_ACKNOWLEDGMENT_CONTEXT,
  MANDATE_ACKNOWLEDGMENT_FORMAT,
  MlDsa65Provider,
  SlhDsa192fProvider,
  admitDelegatedBundleV2,
  createMandateAcknowledgment,
  domainSeparatedMessage,
  evaluateDelegationActivationV2,
  experimentalCandidateIngress,
  type DelegatedOperator,
} from '../index.js';
import { canonicalizeV2 } from '../core/canonicalize.js';
import { compositeSign, compositeVerify, type CompositeKeyPair } from '../core/composite-ops.js';
import {
  ACK_FIELDS,
  RULE_ACTIONS,
  RULE_FIELDS,
  RULE_OPERATORS,
  THRESHOLD_FIELDS,
  acknowledgmentFormError,
  chainHashes,
  mandateHash,
  thresholdHash,
} from '../core/mandate-acknowledgment.js';

const read = (path: string) => JSON.parse(readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8'));
const V = read('tests/interop/v2/mandate_acknowledgment_vectors.json');
const ACK_SCHEMA = read('schemas/v2/mandate_acknowledgment.schema.json');
const THRESHOLD_SCHEMA = read('schemas/v2/awareness_threshold.schema.json');
const NOW = Date.parse(V.now);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
type Rec = Record<string, unknown>;

function newRegistry(ed25519 = new Ed25519Provider()): AlgorithmRegistry {
  const registry = new AlgorithmRegistry();
  registry.registerSigner(ed25519);
  registry.registerSigner(new MlDsa65Provider());
  registry.registerSigner(new SlhDsa192fProvider());
  return registry;
}
const registry = newRegistry();

type Case = (typeof V.cases)[number];
const operatorOf = (c: Case): DelegatedOperator => ({
  trust: clone(V.trust_sets[c.trust]),
  ...(c.profile ? { profile: clone(V.profiles[c.profile]) } : {}),
  ...(c.policy ? { policy: clone(V.policies[c.policy]) } : {}),
  ...(c.max_revocation_age_seconds !== null ? { maxRevocationAgeSeconds: c.max_revocation_age_seconds } : {}),
  revocation: clone(V.revocations[c.revocation]),
  mandateRevocation: clone(V.mandate_revocations[c.mandate_revocation]),
  now: NOW,
});
const containerOf = (v: unknown, from: Record<string, unknown>) => (Array.isArray(v) ? v.map((n: string) => clone(from[n])) : clone((v as { not_an_array: unknown }).not_an_array));
const evidenceOf = (c: Case) => ({
  signedBundle: clone(V.signed_bundles[c.leaf]),
  mandateChain: c.chain.map((n: string) => clone(V.mandates[n])),
  delegatorBundles: c.delegators.map((n: string) => clone(V.signed_bundles[n])),
  acknowledgments: containerOf(c.acknowledgments, V.acknowledgments) as unknown[],
  awarenessThresholds: containerOf(c.awareness_thresholds, V.awareness_thresholds) as unknown[],
});
const caseNamed = (name: string): Case => V.cases.find((c: Case) => c.name === name);
const outcome = (r: Awaited<ReturnType<typeof evaluateDelegationActivationV2>>) => ({
  composition_admitted: r.composition.admitted,
  activation: r.activation,
  delegation_active: r.delegation_active,
  codes: r.errors.map((e) => e.code),
  verified: r.acknowledgments.map((a) => a.verified),
});

describe('mandate acknowledgment vectors', () => {
  it('covers every group of design § 11', () => {
    expect([...new Set(V.cases.map((c: Case) => c.group))].sort()).toEqual(['BIND', 'CARD', 'DOM', 'FORM', 'MULTI', 'NOACT', 'POS', 'PREC', 'REV', 'SIG', 'TIME']);
  });

  for (const c of V.cases) {
    it(`${c.group} ${c.name} (${c.rule})`, async () => {
      const evidence = evidenceOf(c);
      const operator = operatorOf(c);
      const r = await evaluateDelegationActivationV2(evidence, registry, operator);
      expect(outcome(r)).toEqual(c.expected);
      expect(r.action_authorized).toBe(false);
      expect(r.composition.action_authorized).toBe(false);
      expect(r.composition.activation).toBe('not_evaluated');
      const f2 = await admitDelegatedBundleV2(
        { signedBundle: evidence.signedBundle, mandateChain: evidence.mandateChain, delegatorBundles: evidence.delegatorBundles },
        registry,
        operatorOf(c),
      );
      expect(r.composition).toEqual(f2);
      expect(r.inputs).toEqual({
        now: NOW,
        acknowledgments: Array.isArray(c.acknowledgments) ? c.acknowledgments.length : null,
        awareness_thresholds: Array.isArray(c.awareness_thresholds) ? c.awareness_thresholds.length : null,
      });
    });
  }

  for (const tc of V.text_cases) {
    it(`text ${tc.name}: a lone surrogate parsed into the host value`, async () => {
      const base = caseNamed(tc.base_case);
      const evidence = evidenceOf(base);
      const value = JSON.parse(tc.text);
      (tc.replace.container === 'acknowledgments' ? evidence.acknowledgments : evidence.awarenessThresholds)[tc.replace.index] = value;
      const r = await evaluateDelegationActivationV2(evidence, registry, operatorOf(base));
      expect(r.errors.map((e) => e.code)).toEqual(tc.expected_codes);
      expect(r.delegation_active).toBe(false);
    });
  }

  it("Go's bytes case: the exact value is the host value 1, and both expectations are explicit (Go chooses by its real parse)", () => {
    for (const g of V.go_bytes_cases) {
      expect(g.go_text.length).toBeGreaterThan(5000);
      const canonical = canonicalizeV2(V.awareness_thresholds.thr_root_one);
      expect(g.expected_canonical_of).toBe('awareness_thresholds.thr_root_one');
      expect(g.expected_canonical_sha256).toBe(createHash('sha256').update(canonical).digest('hex'));
      expect(V.awareness_thresholds.thr_root_one.threshold_rules[0].value).toBe(g.expected_exact_value);
      const scanned = experimentalCandidateIngress(new TextEncoder().encode(g.go_text));
      expect(scanned.status).toBe('accept');
      if (scanned.status !== 'accept') return;
      expect(Buffer.from(scanned.canonical).toString('utf8')).toBe(canonical);
      const base = caseNamed(g.base_case).expected;
      expect(g.expectations.parser_matches_canonical).toMatchObject({ activation: base.activation, delegation_active: base.delegation_active, codes: base.codes });
      expect(g.expectations.parser_differs_or_fails).toMatchObject({ activation: 'evaluated', delegation_active: false, codes: ['ACK_PARSER_MISMATCH'] });
      expect(g).not.toHaveProperty('expected_go');
    }
  });

  it('reads 4242.0 as the integral value 4242', () => {
    const raw = readFileSync(new URL('../../../../tests/interop/v2/mandate_acknowledgment_vectors.json', import.meta.url), 'utf8');
    expect(raw.split('"value": 4242.0,').length).toBe(2);
    expect(V.awareness_thresholds.thr_root_float.threshold_rules[0].value).toBe(4242);
  });

  it('writes no secret key', () => {
    const raw = readFileSync(new URL('../../../../tests/interop/v2/mandate_acknowledgment_vectors.json', import.meta.url), 'utf8');
    expect(raw).not.toMatch(/secret/i);
  });
});

describe('the evaluation', () => {
  const c = caseNamed('depth_two_any_order');

  it('leaves its inputs unchanged', async () => {
    const evidence = evidenceOf(c);
    const operator = operatorOf(c);
    const before = clone({ evidence, operator });
    const r = await evaluateDelegationActivationV2(evidence, registry, operator);
    expect(r.delegation_active).toBe(true);
    expect({ evidence, operator }).toEqual(before);
  });

  it('a provider that changes the caller\'s inputs during verification changes nothing (snapshot before the first await)', async () => {
    const evidence = evidenceOf(c);
    const operator = operatorOf(c) as DelegatedOperator & Record<string, any>;
    const real = new Ed25519Provider();
    let calls = 0;
    const tampering = Object.create(real) as Ed25519Provider;
    tampering.verify = async (message, signature, key) => {
      if (calls++ === 0) {
        (evidence.acknowledgments as Rec[]).length = 0;
        (evidence.awarenessThresholds as Rec[])[0].threshold_rules = [];
        (evidence.mandateChain as Rec[])[0].agent_id = 'agent:intruder';
        (operator.revocation as Record<string, any>).keys = {};
        operator.now = NOW + 10 * 365 * 86_400_000;
      }
      return real.verify(message, signature, key);
    };
    const r = await evaluateDelegationActivationV2(evidence, newRegistry(tampering), operator);
    expect(calls).toBeGreaterThan(0);
    expect(outcome(r)).toEqual(c.expected);
  });

  // A valid classical component with an altered PQ component, on the threshold and on the acknowledgment, under every
  // policy of the corpus, pq_only included: both components are required (design § 5).
  const flipPq = (record: Rec) => {
    const sig = record.composite_sig as { pq: { sig_b64: string } };
    const bytes = Buffer.from(sig.pq.sig_b64, 'base64');
    bytes[200] ^= 1;
    sig.pq.sig_b64 = bytes.toString('base64');
  };
  for (const policy of ['profile strict', 'pq_only', 'weak_classical']) {
    for (const [target, code] of [['awarenessThresholds', 'ACK_THRESHOLD_SIGNATURE_INVALID'], ['acknowledgments', 'ACK_SIGNATURE_INVALID']] as const) {
      it(`${target}: an altered PQ component with a valid classical one is rejected under ${policy}`, async () => {
        const base = caseNamed('root_only');
        const c = policy === 'profile strict' ? base : { ...base, profile: null, policy, max_revocation_age_seconds: 300 };
        const evidence = evidenceOf(c);
        flipPq((evidence[target] as Rec[])[0]);
        const r = await evaluateDelegationActivationV2(evidence, registry, operatorOf(c));
        expect(r.composition.admitted).toBe(true);
        expect(r.errors.map((e) => e.code)).toEqual([code]);
        expect(r.delegation_active).toBe(false);
      });
    }
  }

  it('is not part of the package API beyond the selected exports', () => {
    for (const name of ['evaluateDelegationActivationV2', 'createMandateAcknowledgment', 'MANDATE_ACKNOWLEDGMENT_CONTEXT', 'MANDATE_ACKNOWLEDGMENT_FORMAT']) {
      expect(name in sdk).toBe(true);
    }
    for (const name of ['acknowledgmentFormError', 'thresholdFormError', 'mandateHash', 'chainHashes', 'thresholdHash', 'takeDelegatedSnapshot', 'composeDelegated', 'signerKey', 'ACK_FIELDS']) {
      expect(name in sdk).toBe(false);
    }
  });
});

describe('the new context (design § 9)', () => {
  it('produces the vector of the corpus', () => {
    const d = V.domain_separation;
    expect(d.context).toBe(MANDATE_ACKNOWLEDGMENT_CONTEXT);
    const dsm = domainSeparatedMessage(MANDATE_ACKNOWLEDGMENT_CONTEXT, new TextEncoder().encode(d.payload_canonical));
    expect(Buffer.from(dsm).toString('hex')).toBe(d.dsm_hex);
  });

  it('stays out of DCP_CONTEXTS, which keeps its 19 entries', () => {
    expect(Object.keys(DCP_CONTEXTS).length).toBe(19);
    expect(Object.values(DCP_CONTEXTS)).not.toContain(MANDATE_ACKNOWLEDGMENT_CONTEXT);
  });
});

describe('the record tables against their schemas', () => {
  it('mandate_acknowledgment: closed, every member required, the format constant', () => {
    expect(ACK_SCHEMA.additionalProperties).toBe(false);
    expect(Object.keys(ACK_SCHEMA.properties).sort()).toEqual([...ACK_FIELDS].sort());
    expect([...ACK_SCHEMA.required].sort()).toEqual([...ACK_FIELDS].sort());
    expect(ACK_SCHEMA.properties.acknowledgment_format.const).toBe(MANDATE_ACKNOWLEDGMENT_FORMAT);
  });

  it('awareness_threshold: the members, the rule members and their enumerations', () => {
    expect(THRESHOLD_SCHEMA.additionalProperties).toBe(false);
    expect(Object.keys(THRESHOLD_SCHEMA.properties).sort()).toEqual([...THRESHOLD_FIELDS].sort());
    expect([...THRESHOLD_SCHEMA.required].sort()).toEqual([...THRESHOLD_FIELDS].sort());
    const rule = THRESHOLD_SCHEMA.properties.threshold_rules.items;
    expect(Object.keys(rule.properties).sort()).toEqual([...RULE_FIELDS].sort());
    expect([...rule.required].sort()).toEqual([...RULE_FIELDS].sort());
    expect(rule.properties.operator.enum).toEqual(RULE_OPERATORS);
    expect(rule.properties.action_if_triggered.enum).toEqual(RULE_ACTIONS);
  });
});

describe('createMandateAcknowledgment (design § 3.2)', () => {
  const ed = new Ed25519Provider();
  const ml = new MlDsa65Provider();
  const fresh = async (): Promise<CompositeKeyPair> => {
    const c = await ed.generateKeypair();
    const p = await ml.generateKeypair();
    return {
      classical: { kid: c.kid, alg: 'ed25519', secretKeyB64: c.secretKeyB64, publicKeyB64: c.publicKeyB64 },
      pq: { kid: p.kid, alg: 'ml-dsa-65', secretKeyB64: p.secretKeyB64, publicKeyB64: p.publicKeyB64 },
    };
  };
  const chain = () => [clone(V.mandates.root), clone(V.mandates.sub)];
  const thresholdFor = async (keys: CompositeKeyPair, over: Rec = {}): Promise<Rec> => {
    const sub = V.mandates.sub;
    const payload = {
      dcp_version: '2.0', threshold_id: 'threshold:creation', session_nonce: sub.session_nonce, agent_id: sub.agent_id, human_id: sub.human_id,
      threshold_rules: [{ dimension: 'spend', operator: 'gt', value: 100, action_if_triggered: 'notify' }], timestamp: '2026-11-02T01:00:00.000Z', ...over,
    };
    return { ...payload, composite_sig: await compositeSign(registry, 'DCP-AI.v2.Awareness', new TextEncoder().encode(canonicalizeV2(payload)), keys) };
  };
  /** A registry whose Ed25519 provider counts signatures. */
  const counting = () => {
    const real = new Ed25519Provider();
    const spy = Object.create(real) as Ed25519Provider & { signs: number };
    spy.signs = 0;
    spy.sign = async (message, secret) => {
      spy.signs++;
      return real.sign(message, secret);
    };
    return { spy, registry: newRegistry(spy) };
  };

  it('computes the hashes and copies the ids from its inputs, and signs under the new context', async () => {
    const keys = await fresh();
    const u = await thresholdFor(keys);
    const a = await createMandateAcknowledgment(registry, keys, { mandateChain: chain(), awarenessThreshold: u, acknowledgmentId: 'ack:creation', acknowledgedAt: '2026-11-02T02:00:00Z' });
    expect(acknowledgmentFormError(a)).toBeUndefined();
    expect(a).toMatchObject({
      dcp_version: '2.0',
      acknowledgment_format: MANDATE_ACKNOWLEDGMENT_FORMAT,
      acknowledgment_id: 'ack:creation',
      mandate_id: V.mandates.sub.mandate_id,
      mandate_hash: mandateHash(V.mandates.sub),
      chain_hash: chainHashes([V.mandates.root, V.mandates.sub])[1],
      session_nonce: V.mandates.sub.session_nonce,
      human_id: V.mandates.sub.human_id,
      agent_id: V.mandates.sub.agent_id,
      awareness_threshold_id: 'threshold:creation',
      awareness_threshold_hash: thresholdHash(u),
      acknowledged_at: '2026-11-02T02:00:00Z',
    });
    const { composite_sig: sig, ...payload } = a;
    const v = await compositeVerify(registry, MANDATE_ACKNOWLEDGMENT_CONTEXT, new TextEncoder().encode(canonicalizeV2(payload)), sig, keys.classical.publicKeyB64, keys.pq.publicKeyB64);
    expect(v).toEqual({ valid: true, classical_valid: true, pq_valid: true });
  });

  it('copies its parameters and keys, secrets included, before the first await, and modifies no input', async () => {
    const keys = await fresh();
    const other = await fresh();
    const u = await thresholdFor(keys);
    const params = { mandateChain: chain(), awarenessThreshold: u, acknowledgmentId: 'ack:creation', acknowledgedAt: '2026-11-02T02:00:00Z' };
    const before = clone({ params, keys });
    const pending = createMandateAcknowledgment(registry, keys, params);
    expect({ params, keys }).toEqual(before);
    keys.classical.secretKeyB64 = other.classical.secretKeyB64;
    keys.pq.secretKeyB64 = other.pq.secretKeyB64;
    params.acknowledgmentId = 'ack:changed';
    (params.mandateChain as Rec[]).length = 0;
    const a = await pending;
    expect(a.acknowledgment_id).toBe('ack:creation');
    const { composite_sig: sig, ...payload } = a;
    const v = await compositeVerify(registry, MANDATE_ACKNOWLEDGMENT_CONTEXT, new TextEncoder().encode(canonicalizeV2(payload)), sig, before.keys.classical.publicKeyB64, before.keys.pq.publicKeyB64);
    expect(v.valid).toBe(true);
  });

  it('takes no digest from the caller', async () => {
    const keys = await fresh();
    const u = await thresholdFor(keys);
    const call = createMandateAcknowledgment(registry, keys, { mandateChain: chain(), awarenessThreshold: u, acknowledgmentId: 'ack:creation', mandateHash: 'sha256:00' } as never);
    await expect(call).rejects.toBeInstanceOf(TypeError);
  });

  const rejections: Array<[string, (k: CompositeKeyPair) => Promise<[unknown, CompositeKeyPair]>]> = [
    ['a mandate_id that is not Unicode scalar values (independent review: the acknowledgment would fail its own form)', async (k) => {
      const c = chain();
      c[1].mandate_id = 'mandate:lone-\ud800';
      return [{ mandateChain: c, awarenessThreshold: await thresholdFor(k), acknowledgmentId: 'ack:creation', acknowledgedAt: '2026-11-02T02:00:00Z' }, k];
    }],
    ['a pq kid that is not the derived kid (independent review: a malformed signature slot)', async (k) => {
      const bad = clone(k);
      bad.pq.kid = 'x';
      return [{ mandateChain: chain(), awarenessThreshold: await thresholdFor(k), acknowledgmentId: 'ack:creation', acknowledgedAt: '2026-11-02T02:00:00Z' }, bad];
    }],
    ['a classical kid of another key', async (k) => {
      const bad = clone(k);
      bad.classical.kid = k.pq.kid;
      return [{ mandateChain: chain(), awarenessThreshold: await thresholdFor(k), acknowledgmentId: 'ack:creation', acknowledgedAt: '2026-11-02T02:00:00Z' }, bad];
    }],
    ['a threshold of another agent', async (k) => [{ mandateChain: chain(), awarenessThreshold: await thresholdFor(k, { agent_id: V.mandates.root.agent_id }), acknowledgmentId: 'ack:creation', acknowledgedAt: '2026-11-02T02:00:00Z' }, k]],
    ['a threshold of another session', async (k) => [{ mandateChain: chain(), awarenessThreshold: await thresholdFor(k, { session_nonce: V.mandates.root.session_nonce }), acknowledgmentId: 'ack:creation', acknowledgedAt: '2026-11-02T02:00:00Z' }, k]],
    ['an instant before the mandate', async (k) => [{ mandateChain: chain(), awarenessThreshold: await thresholdFor(k, { timestamp: '2026-11-01T00:00:00Z' }), acknowledgmentId: 'ack:creation', acknowledgedAt: '2026-11-01T23:59:59.999Z' }, k]],
    ['an instant before the threshold', async (k) => [{ mandateChain: chain(), awarenessThreshold: await thresholdFor(k), acknowledgmentId: 'ack:creation', acknowledgedAt: '2026-11-02T00:30:00Z' }, k]],
    ['an instant after valid_until', async (k) => [{ mandateChain: chain(), awarenessThreshold: await thresholdFor(k), acknowledgmentId: 'ack:creation', acknowledgedAt: '2027-11-01T00:00:00.001Z' }, k]],
    ['a threshold value outside +-(2^53 - 1)', async (k) => {
      const u = await thresholdFor(k);
      (u.threshold_rules as Rec[])[0].value = 9007199254740992;
      return [{ mandateChain: chain(), awarenessThreshold: u, acknowledgmentId: 'ack:creation', acknowledgedAt: '2026-11-02T02:00:00Z' }, k];
    }],
    ['an identifier of five astral code points', async (k) => [{ mandateChain: chain(), awarenessThreshold: await thresholdFor(k), acknowledgmentId: '😀😀😀😀😀', acknowledgedAt: '2026-11-02T02:00:00Z' }, k]],
    ['a chain whose sub-mandate does not name its parent', async (k) => [{ mandateChain: [clone(V.mandates.root_future), clone(V.mandates.sub)], awarenessThreshold: await thresholdFor(k), acknowledgmentId: 'ack:creation', acknowledgedAt: '2026-11-02T02:00:00Z' }, k]],
  ];
  for (const [name, make] of rejections) {
    it(`rejects ${name}, without signing`, async () => {
      const keys = await fresh();
      const [params, useKeys] = await make(keys);
      const { spy, registry: r } = counting();
      const call = createMandateAcknowledgment(r, useKeys, params as never);
      await expect(call).rejects.toThrow(/createMandateAcknowledgment/);
      expect(spy.signs).toBe(0);
      await call.catch((e: Error) => {
        expect(e.message).not.toContain(keys.classical.secretKeyB64);
        expect(e.message).not.toContain(keys.pq.secretKeyB64);
      });
    });
  }
});
