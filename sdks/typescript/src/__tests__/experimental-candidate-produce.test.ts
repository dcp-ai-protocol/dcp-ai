/**
 * EXPERIMENTAL candidate dcp-jcs-v2, phase 4 (TypeScript): the producers. Positives are verified by
 * the phase 3 bytes verifier, and today's object API still refuses their profile. Every rejection of
 * the contract (domain, commitments, chain, session, signer, depth, usage) happens with zero calls to
 * the real signers, counted by wrapping the real providers (each call still signs). Host values: getters
 * and toJSON never invoked, holes, prototypes, BigInt, floats, copies before the first await, and nothing
 * replaced by null.
 */
import { describe, expect, it } from 'vitest';

import { canonicalizeV2 } from '../core/canonicalize.js';
import { compositeSign, compositeVerify } from '../core/composite-ops.js';
import type { CompositeKeyPair } from '../core/composite-ops.js';
import { AlgorithmRegistry } from '../core/crypto-registry.js';
import { DCP_CONTEXTS } from '../core/domain-separation.js';
import { sha256Hex } from '../core/dual-hash.js';
import { experimentalCandidateIngress } from '../core/experimental-candidate-ingress.js';
import { experimentalHistoricalAdapters } from '../core/experimental-candidate-router.js';
import {
  ExperimentalCandidateProduceError,
  experimentalCandidateSignBundle,
  experimentalCandidateSignPayload,
} from '../core/experimental-candidate-produce.js';
import type {
  ExperimentalCandidateBundleOptions,
  ExperimentalCandidateBundleParts,
  ExperimentalCandidateInput,
  ExperimentalCandidateKeys,
} from '../core/experimental-candidate-produce.js';
import { createExperimentalCandidateVerifier } from '../core/experimental-candidate-verify.js';
import { preparePayload } from '../core/signed-payload.js';
import { generateSessionNonce } from '../core/session-nonce.js';
import { verifySignedBundleV2 } from '../core/verify-v2.js';
import * as sdk from '../index.js';
import { Ed25519Provider } from '../providers/ed25519.js';
import { MlDsa65Provider } from '../providers/ml-dsa-65.js';

const NOW = { now: Date.parse('2026-10-25T00:00:00Z') };
const TIMEOUT_MS = 30_000;
const ed25519 = new Ed25519Provider();
const mlDsa65 = new MlDsa65Provider();

/** The real providers, wrapped only to count their sign calls. */
const signs = { n: 0 };
function counting<T extends object>(provider: T): T {
  const p = Object.create(provider);
  p.sign = (...args: unknown[]) => {
    signs.n++;
    return (provider as unknown as { sign: (...a: unknown[]) => unknown }).sign(...args);
  };
  return p;
}
const registry = new AlgorithmRegistry();
registry.registerSigner(counting(ed25519));
registry.registerSigner(counting(mlDsa65));
const verifyRegistry = new AlgorithmRegistry();
verifyRegistry.registerSigner(ed25519);
verifyRegistry.registerSigner(mlDsa65);

async function keyPair(): Promise<CompositeKeyPair> {
  const c = await ed25519.generateKeypair();
  const p = await mlDsa65.generateKeypair();
  return {
    classical: { kid: c.kid, alg: 'ed25519', secretKeyB64: c.secretKeyB64, publicKeyB64: c.publicKeyB64 },
    pq: { kid: p.kid, alg: 'ml-dsa-65', secretKeyB64: p.secretKeyB64, publicKeyB64: p.publicKeyB64 },
  };
}
const principal = await keyPair();
const agent = await keyPair();
const classicalOnly = (k: CompositeKeyPair): ExperimentalCandidateKeys => ({ classical: k.classical });

const sha256Of = (v: unknown) => `sha256:${sha256Hex(Buffer.from(canonicalizeV2(v), 'utf8'))}`;
const utf8 = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

/** Rejects with the error; fails if it resolves. */
async function failure(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (e) {
    return e;
  }
  throw new Error('expected a rejection');
}
/** A contract rejection with this class (and part), and no signer call while producing it. */
async function rejected(run: () => Promise<unknown>, cls: string, part?: string) {
  signs.n = 0;
  const e = await failure(run);
  expect(e, String(e)).toBeInstanceOf(ExperimentalCandidateProduceError);
  expect((e as ExperimentalCandidateProduceError).class).toBe(cls);
  if (part !== undefined) expect((e as ExperimentalCandidateProduceError).part).toBe(part);
  expect(signs.n, 'signer calls').toBe(0);
  return e as ExperimentalCandidateProduceError;
}

type Scenario = {
  parts: ExperimentalCandidateBundleParts;
  signer: { signerType: string; signerId: string; keys: ExperimentalCandidateKeys };
  options: ExperimentalCandidateBundleOptions;
  payloads: Record<string, Record<string, unknown>>;
  entries: Record<string, unknown>[];
};

/**
 * Payloads as the phase 3 generator writes them; the four artifacts signed with
 * experimentalCandidateSignPayload, the audit entries and options ready for signBundle.
 */
async function scenario(o: {
  classical?: boolean;
  target?: Record<string, unknown>;
  intent?: Record<string, unknown>;
  passport?: Record<string, unknown>;
  policy?: Record<string, unknown>;
  entries?: number;
  as?: 'value' | 'bytes';
} = {}): Promise<Scenario> {
  const nonce = generateSessionNonce();
  const pk = o.classical ? classicalOnly(principal) : principal;
  const ak = o.classical ? classicalOnly(agent) : agent;
  const keyEntries = (k: ExperimentalCandidateKeys) =>
    [k.classical, ...(k.pq ? [k.pq] : [])].map((x) => ({
      kid: x.kid, alg: x.alg, public_key_b64: x.publicKeyB64, created_at: '2026-10-21T00:00:00Z', expires_at: null, status: 'active',
    }));
  const rpr = {
    dcp_version: '2.0', human_id: 'human:candidate-principal', session_nonce: nonce, legal_name: 'Candidate Principal',
    entity_type: 'natural_person', jurisdiction: 'US-CA', liability_mode: 'owner_responsible', override_rights: true,
    issued_at: '2026-10-21T00:00:00Z', expires_at: null, contact: null, binding_keys: keyEntries(pk),
  };
  const passport = {
    dcp_version: '2.0', agent_id: 'agent:candidate-bot', session_nonce: nonce,
    keys: keyEntries(ak).map((k) => ({ ...k, expires_at: '2099-12-31T18:59:59-05:00' })),
    principal_binding_reference: rpr.human_id, capabilities: ['browse', 'api_call'], risk_tier: 'medium',
    created_at: '2026-10-21T00:00:00Z', status: 'active', ...o.passport,
  };
  const base = {
    dcp_version: '2.0', intent_id: 'intent:candidate-001', session_nonce: nonce, agent_id: passport.agent_id,
    human_id: rpr.human_id, timestamp: '2026-10-21T12:00:00Z', action_type: 'send_email',
    target: { channel: 'email', to: 'bob@example.com', domain: 'example.com' }, data_classes: ['contact_info'],
    estimated_impact: 'medium', requires_consent: false, ...o.intent,
  };
  const intent = { ...base, target: { ...(base.target as object), ...o.target } };
  const policy = {
    dcp_version: '2.0', intent_id: intent.intent_id, session_nonce: nonce, decision: 'approve', risk_score: 450,
    reasons: ['Known recipient domain'], required_confirmation: null, applied_policy_hash: sha256Of({ policy: 'default' }),
    timestamp: '2026-10-21T12:00:01Z', ...o.policy,
  };
  const entries: Record<string, unknown>[] = [];
  for (let i = 0; i < (o.entries ?? 2); i++) {
    entries.push({
      dcp_version: '2.0', audit_id: `audit:candidate-00${i + 1}`, session_nonce: nonce,
      prev_hash: i === 0 ? 'GENESIS' : sha256Of(entries[i - 1]), hash_alg: 'sha256',
      timestamp: `2026-10-21T12:0${i + 1}:00Z`, agent_id: passport.agent_id, human_id: rpr.human_id,
      intent_id: intent.intent_id, intent_hash: sha256Of(intent), policy_decision: 'approved', outcome: 'email_sent',
      evidence: { tool: 'smtp', result_ref: null, evidence_hash: null }, pq_checkpoint_ref: null,
    });
  }
  const as = o.as ?? 'value';
  const artifact = async (context: string, payload: unknown, k: ExperimentalCandidateKeys): Promise<ExperimentalCandidateInput> => {
    const r = await experimentalCandidateSignPayload(registry, context, { value: payload }, k);
    return as === 'bytes' ? { bytes: r.bytes } : { value: r.signedPayload };
  };
  return {
    parts: {
      rpr: await artifact(DCP_CONTEXTS.ResponsiblePrincipal, rpr, pk),
      passport: await artifact(DCP_CONTEXTS.AgentPassport, passport, ak),
      intent: await artifact(DCP_CONTEXTS.Intent, intent, ak),
      policyDecision: await artifact(DCP_CONTEXTS.PolicyDecision, policy, ak),
      auditEntries: entries.map((e) => (as === 'bytes' ? { bytes: utf8(JSON.stringify(e)) } : { value: e })),
    },
    signer: { signerType: 'human', signerId: rpr.human_id, keys: pk },
    options: { sessionNonce: nonce, sessionIssuedAt: '2026-10-21T00:00:00Z', sessionExpiresAt: '2099-12-31T23:59:59+05:00', createdAt: '2026-10-21T12:05:00Z' },
    payloads: { rpr, passport, intent, policy },
    entries,
  };
}

const verifier = createExperimentalCandidateVerifier({
  transport: 'bare',
  acceptedProfiles: ['dcp-jcs-v2'],
  historical: experimentalHistoricalAdapters.bufferUtf8JsonParse,
});

/** Produced, verified by the phase 3 candidate path, and refused by today's object API. */
async function produceAndVerify(s: Scenario) {
  const out = await experimentalCandidateSignBundle(registry, s.parts, s.signer, s.options);
  const r = await verifier.verify(out.bytes, verifyRegistry, undefined, NOW);
  expect(r.entered).toBe('dcp-jcs-v2');
  expect(r.verification?.errors, 'verification errors').toEqual([]);
  expect(r.verification?.verified).toBe(true);
  const today = await verifySignedBundleV2(JSON.parse(text(out.bytes)), verifyRegistry, undefined, NOW);
  expect(today.verified).toBe(false);
  expect(today.errors).toContain('Unknown canonicalization_profile: dcp-jcs-v2');
  return { ...out, unit: JSON.parse(text(out.bytes)) };
}

const nest = (n: number, leaf: unknown): unknown => (n === 0 ? leaf : [nest(n - 1, leaf)]);

describe('signPayload', () => {
  it('signs the exact value under a DCP context, without a profile; its bytes go back through the ingress', async () => {
    signs.n = 0;
    const payload = { a: 1, b: 'x', c: [true, null] };
    const r = await experimentalCandidateSignPayload(registry, DCP_CONTEXTS.Intent, { value: payload }, agent);
    expect(signs.n).toBe(2); // the classical and the PQ component, really signed
    expect(r.signedPayload.payload_hash).toBe(preparePayload(payload).payloadHash);
    expect(Object.keys(r.signedPayload).sort()).toEqual(['composite_sig', 'payload', 'payload_hash']);
    expect(text(r.bytes)).not.toContain('canonicalization_profile');
    const sig = r.signedPayload.composite_sig as never;
    const v = await compositeVerify(verifyRegistry, DCP_CONTEXTS.Intent, preparePayload(payload).canonicalBytes, sig, agent.classical.publicKeyB64, agent.pq.publicKeyB64);
    expect(v.valid).toBe(true);
    const again = experimentalCandidateIngress(r.bytes);
    expect(again.status === 'accept' && text(again.canonical) === text(r.bytes)).toBe(true);
  }, TIMEOUT_MS);

  it('classical-only keys sign once, with a classical_only binding', async () => {
    signs.n = 0;
    const r = await experimentalCandidateSignPayload(registry, DCP_CONTEXTS.Intent, { value: { a: 1 } }, classicalOnly(agent));
    expect(signs.n).toBe(1);
    expect((r.signedPayload.composite_sig as Record<string, unknown>).binding).toBe('classical_only');
  });

  it('from bytes: the exact value of the literal, 1 followed by 800 decimal zeros is 1', async () => {
    const r = await experimentalCandidateSignPayload(registry, DCP_CONTEXTS.Intent, { bytes: utf8(`{"exact_one":1.${'0'.repeat(800)}}`) }, agent);
    expect((r.signedPayload.payload as Record<string, unknown>).exact_one).toBe(1);
    expect(text(r.bytes)).toContain('"payload":{"exact_one":1}');
  });

  it('the artifact fits in 64 levels: a payload 63 deep is signed, 64 is refused', async () => {
    const ok = await experimentalCandidateSignPayload(registry, DCP_CONTEXTS.Intent, { value: { d: nest(62, 0) } }, classicalOnly(agent));
    expect(experimentalCandidateIngress(ok.bytes).status).toBe('accept');
    const e = await rejected(() => experimentalCandidateSignPayload(registry, DCP_CONTEXTS.Intent, { value: { d: nest(63, 0) } }, agent), 'DEPTH_EXCEEDED', 'payload');
    expect(e.path).toBe(`/d${'/0'.repeat(62)}`);
    await rejected(() => experimentalCandidateSignPayload(registry, DCP_CONTEXTS.Intent, { bytes: utf8(JSON.stringify({ d: nest(63, 0) })) }, agent), 'DEPTH_EXCEEDED', 'payload');
  }, TIMEOUT_MS);

  it('the payload is an object; context, input shape and keys are checked as usage', async () => {
    await rejected(() => experimentalCandidateSignPayload(registry, DCP_CONTEXTS.Intent, { value: [1] }, agent), 'TYPE_UNSUPPORTED', 'payload');
    await rejected(() => experimentalCandidateSignPayload(registry, DCP_CONTEXTS.Intent, { value: null }, agent), 'TYPE_UNSUPPORTED', 'payload');
    for (const run of [
      () => experimentalCandidateSignPayload(registry, 'DCP-AI.v2.Unknown', { value: {} }, agent),
      () => experimentalCandidateSignPayload(registry, DCP_CONTEXTS.Intent, { value: {}, bytes: utf8('{}') } as never, agent),
      () => experimentalCandidateSignPayload(registry, DCP_CONTEXTS.Intent, { bytes: '{}' } as never, agent),
      () => experimentalCandidateSignPayload(registry, DCP_CONTEXTS.Intent, { value: {} }, { classical: { ...agent.classical, kid: 7 } } as never),
    ]) {
      signs.n = 0;
      expect(await failure(run)).toBeInstanceOf(TypeError);
      expect(signs.n).toBe(0);
    }
  });
});

describe('signBundle: verified by the phase 3 verifier, refused by today\'s object API', () => {
  it('hybrid, from values', async () => {
    const { unit } = await produceAndVerify(await scenario());
    expect(unit.bundle.manifest.canonicalization_profile).toBe('dcp-jcs-v2');
    expect(unit.signature.created_at).toBe('2026-10-21T12:05:00Z');
    expect(unit.signature.hash_alg).toBe('sha256');
    expect('audit_merkle_root_secondary' in unit.bundle.manifest).toBe(false);
  }, TIMEOUT_MS);

  it('hybrid, from bytes received: the artifacts and entries as they were sent', async () => {
    const s = await scenario({ as: 'bytes' });
    const { unit } = await produceAndVerify(s);
    expect(unit.bundle.intent).toEqual(JSON.parse(text((s.parts.intent as { bytes: Uint8Array }).bytes)));
  }, TIMEOUT_MS);

  it('an artifact signed by today\'s API over an in-domain payload is used as it is', async () => {
    const s = await scenario();
    const { canonicalBytes, payloadHash } = preparePayload(s.payloads.intent);
    const v1 = { payload: s.payloads.intent, payload_hash: payloadHash, composite_sig: await compositeSign(registry, DCP_CONTEXTS.Intent, canonicalBytes, agent) };
    s.parts.intent = { value: v1 };
    const { unit } = await produceAndVerify(s);
    expect(unit.bundle.intent).toEqual(JSON.parse(JSON.stringify(v1)));
  }, TIMEOUT_MS);

  it('classical-only, low risk and a routine intent, under the default policy', async () => {
    const s = await scenario({
      classical: true,
      passport: { risk_tier: 'low' },
      policy: { risk_score: 0 },
      intent: { action_type: 'browse', target: { channel: 'web' }, data_classes: ['none'], estimated_impact: 'low' },
    });
    const { unit } = await produceAndVerify(s);
    expect(unit.signature.composite_sig.binding).toBe('classical_only');
    expect(unit.signature.signer.kids).toEqual([principal.classical.kid]);
  }, TIMEOUT_MS);

  it('dualHash adds the SHA3 root and signs with sha256+sha3-256', async () => {
    const s = await scenario();
    s.options = { ...s.options, dualHash: true };
    const { unit } = await produceAndVerify(s);
    expect(unit.bundle.manifest.audit_merkle_root_secondary).toMatch(/^sha3-256:[0-9a-f]{64}$/);
    expect(unit.signature.hash_alg).toBe('sha256+sha3-256');
  }, TIMEOUT_MS);

  it('a PQ checkpoint signed by the agent is carried and listed', async () => {
    const s = await scenario();
    const root = JSON.parse(text((await experimentalCandidateSignBundle(registry, s.parts, s.signer, s.options)).bytes)).bundle.manifest.audit_merkle_root;
    const checkpoint = {
      checkpoint_id: 'ckpt-candidate-001', session_nonce: s.options.sessionNonce,
      event_range: { from_audit_id: s.entries[0].audit_id, to_audit_id: s.entries[1].audit_id, count: 2 }, merkle_root: root,
    };
    const composite_sig = await compositeSign(registry, DCP_CONTEXTS.AuditEvent, preparePayload(checkpoint).canonicalBytes, agent);
    s.parts.pqCheckpoints = [{ value: { ...checkpoint, composite_sig } }];
    const { unit } = await produceAndVerify(s);
    expect(unit.bundle.manifest.pq_checkpoints).toEqual(['ckpt-candidate-001']);
  }, TIMEOUT_MS);

  it('an empty audit trail: audit_count 0 and the root of 64 zeros (also the SHA3 one)', async () => {
    const s = await scenario({ entries: 0 });
    s.options = { ...s.options, dualHash: true };
    const { unit } = await produceAndVerify(s);
    expect(unit.bundle.audit_entries).toEqual([]);
    expect(unit.bundle.manifest.audit_count).toBe(0);
    expect(unit.bundle.manifest.audit_merkle_root).toBe(`sha256:${'0'.repeat(64)}`);
    expect(unit.bundle.manifest.audit_merkle_root_secondary).toBe(`sha3-256:${'0'.repeat(64)}`);
  }, TIMEOUT_MS);

  it('members it does not know are kept: in a payload, an entry, a checkpoint, an artifact and a composite_sig', async () => {
    const s = await scenario({ target: { x_payload_ext: { kept: 1 } } });
    s.entries[1] = { ...s.entries[1], x_entry_ext: 'kept' };
    s.parts.auditEntries = s.entries.map((e) => ({ value: e }));
    const intent = (s.parts.intent as { value: Record<string, any> }).value;
    s.parts.intent = { value: { ...intent, x_artifact_ext: 'unsigned', composite_sig: { ...intent.composite_sig, x_sig_ext: 'unsigned' } } };
    const root = JSON.parse(text((await experimentalCandidateSignBundle(registry, s.parts, s.signer, s.options)).bytes)).bundle.manifest.audit_merkle_root;
    const checkpoint = {
      checkpoint_id: 'ckpt-1', session_nonce: s.options.sessionNonce, x_checkpoint_ext: [1, 2],
      event_range: { from_audit_id: s.entries[0].audit_id, to_audit_id: s.entries[1].audit_id, count: 2 }, merkle_root: root,
    };
    const composite_sig = await compositeSign(registry, DCP_CONTEXTS.AuditEvent, preparePayload(checkpoint).canonicalBytes, agent);
    s.parts.pqCheckpoints = [{ value: { ...checkpoint, composite_sig } }];
    const { unit } = await produceAndVerify(s);
    expect(unit.bundle.intent.payload.target.x_payload_ext).toEqual({ kept: 1 });
    expect(unit.bundle.audit_entries[1].x_entry_ext).toBe('kept');
    expect(unit.bundle.pq_checkpoints[0].x_checkpoint_ext).toEqual([1, 2]);
    expect(unit.bundle.intent.x_artifact_ext).toBe('unsigned');
    expect(unit.bundle.intent.composite_sig.x_sig_ext).toBe('unsigned');
  }, TIMEOUT_MS);

  it('the boundaries of §9: ±(2^53-1), keys outside the BMP, U+FEFF, U+FFFD, U+2028 and U+0000, own keys like __proto__', async () => {
    const e000 = String.fromCodePoint(0xe000);
    const smile = String.fromCodePoint(0x1f600);
    const target: Record<string, unknown> = {
      limits: { max: 9007199254740991, min: -9007199254740991 },
      keys: { [e000]: 1, [smile]: 2 },
      strings: [String.fromCodePoint(0xfeff) + 'start', String.fromCodePoint(0xfffd), String.fromCodePoint(0x2028), String.fromCodePoint(0)],
      constructor: 'data',
      toJSON: 'data',
    };
    Object.defineProperty(target, '__proto__', { value: 'data', enumerable: true, writable: true, configurable: true });
    const { unit, bytes } = await produceAndVerify(await scenario({ target }));
    const t = unit.bundle.intent.payload.target;
    expect(t.limits).toEqual({ max: 9007199254740991, min: -9007199254740991 });
    expect(Object.keys(t.keys)).toEqual([e000, smile]); // code point order
    expect(Object.getOwnPropertyDescriptor(t, '__proto__')?.value).toBe('data');
    expect(t.toJSON).toBe('data');
    expect(text(bytes).indexOf(`"${e000}"`)).toBeLessThan(text(bytes).indexOf(`"${smile}"`));
  }, TIMEOUT_MS);

  it('the final unit, its signature included, fits in 64 levels: a payload 61 deep in the bundle, not 62', async () => {
    // payload (1) + target (2) + n arrays: the payload is n + 2 deep, at levels 4 to n + 5 of the unit.
    await produceAndVerify(await scenario({ target: { d: nest(59, 'deep') } })); // payload 61, unit 64
    const s = await scenario({ target: { d: nest(60, 'deep') } }); // payload 62, unit 65
    const e = await rejected(() => experimentalCandidateSignBundle(registry, s.parts, s.signer, s.options), 'DEPTH_EXCEEDED', 'unit');
    expect(e.path?.startsWith('/bundle/intent/payload/target/d')).toBe(true);
  }, TIMEOUT_MS);
});

describe('signBundle: rejections of the contract, before any signer', () => {
  it('a commitment is checked, never recomputed: a changed payload, or no payload_hash', async () => {
    const s = await scenario();
    const intent = (s.parts.intent as { value: Record<string, any> }).value;
    s.parts.intent = { value: { ...intent, payload: { ...intent.payload, action_type: 'send_fax' } } };
    expect((await rejected(() => experimentalCandidateSignBundle(registry, s.parts, s.signer, s.options), 'COMMITMENT_MISMATCH', 'intent')).path).toBe('/payload_hash');
    const { payload_hash: _dropped, ...without } = intent;
    s.parts.intent = { value: without };
    await rejected(() => experimentalCandidateSignBundle(registry, s.parts, s.signer, s.options), 'COMMITMENT_MISMATCH', 'intent');
  }, TIMEOUT_MS);

  it('the chain is checked, never inferred: it starts at GENESIS and links', async () => {
    const s = await scenario();
    const first = { ...s.entries[0], prev_hash: sha256Of({ earlier: 'v1 evidence' }) };
    s.parts.auditEntries = [{ value: first }, { value: s.entries[1] }];
    expect((await rejected(() => experimentalCandidateSignBundle(registry, s.parts, s.signer, s.options), 'CHAIN_NOT_GENESIS', 'auditEntries')).path).toBe('/0/prev_hash');
    s.parts.auditEntries = [{ value: s.entries[0] }, { value: { ...s.entries[1], prev_hash: `sha256:${'0'.repeat(64)}` } }];
    expect((await rejected(() => experimentalCandidateSignBundle(registry, s.parts, s.signer, s.options), 'CHAIN_BREAK', 'auditEntries')).path).toBe('/1/prev_hash');
  }, TIMEOUT_MS);

  it('the session: nonces, dates, and the start never stamped from the clock', async () => {
    const s = await scenario();
    const other = generateSessionNonce();
    const signBundle = (parts: ExperimentalCandidateBundleParts, options: ExperimentalCandidateBundleOptions) =>
      () => experimentalCandidateSignBundle(registry, parts, s.signer, options);
    await rejected(signBundle(s.parts, { ...s.options, sessionNonce: other }), 'SESSION_INVALID', 'parts');
    await rejected(signBundle({ ...s.parts, auditEntries: [{ value: s.entries[0] }, { value: { ...s.entries[1], session_nonce: other } }] }, s.options), 'SESSION_INVALID');
    await rejected(signBundle(s.parts, { ...s.options, sessionNonce: 'not-a-nonce' }), 'SESSION_INVALID', 'options');
    await rejected(signBundle(s.parts, { ...s.options, sessionIssuedAt: 'yesterday' }), 'SESSION_INVALID', 'options');
    await rejected(signBundle(s.parts, { ...s.options, sessionIssuedAt: '2100-01-01T00:00:00Z' }), 'SESSION_INVALID', 'options');
    const { sessionIssuedAt: _absent, ...noStart } = s.options;
    await rejected(signBundle(s.parts, noStart), 'SESSION_ISSUED_AT_REQUIRED', 'options');
  }, TIMEOUT_MS);

  it('the signer is the RPR human_id', async () => {
    const s = await scenario();
    await rejected(() => experimentalCandidateSignBundle(registry, s.parts, { ...s.signer, signerId: 'human:someone-else' }, s.options), 'SIGNER_MISMATCH', 'signer');
  }, TIMEOUT_MS);

  it('the domain of received bytes, by class, with the part, the path and the byte offset', async () => {
    const s = await scenario();
    const entry = JSON.stringify(s.entries[1]);
    const cases: Array<[Uint8Array, string, number | null]> = [
      [new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(entry)]), 'BOM', 0],
      [utf8(entry.slice(0, -1)), 'SYNTAX', entry.length - 1],
      [utf8(entry.replace('"outcome":"email_sent"', '"outcome":"email_sent","outcome":"email_sent"')), 'DUPLICATE_KEY', null],
      [utf8(entry.replace('"hash_alg":"sha256"', '"hash_alg":"sha256","n":1.5')), 'NUMBER_NOT_INTEGER', null],
      [utf8(entry.replace('"hash_alg":"sha256"', '"hash_alg":"sha256","n":9007199254740992')), 'NUMBER_OUT_OF_RANGE', null],
      [utf8(entry.replace('email_sent', 'email' + '\\' + 'ud800sent')), 'SURROGATE_UNPAIRED', null],
      [new Uint8Array([...utf8(entry.slice(0, 20)), 0xff, ...utf8(entry.slice(20))]), 'UTF8_INVALID', 20],
    ];
    for (const [bytes, cls, offset] of cases) {
      const e = await rejected(() => experimentalCandidateSignBundle(registry, { ...s.parts, auditEntries: [{ value: s.entries[0] }, { bytes }] }, s.signer, s.options), cls, 'auditEntries');
      expect(e.path).toBe('/1');
      if (offset !== null) expect(e.offset).toBe(offset);
    }
  }, TIMEOUT_MS);
});

describe('host values: the exact domain, checked and copied', () => {
  const sign = (value: unknown) => experimentalCandidateSignPayload(registry, DCP_CONTEXTS.Intent, { value }, agent);
  const payloadOf = async (value: unknown) => (await sign(value)).signedPayload.payload as Record<string, unknown>;

  it('numbers: finite, integral and safe; floats and BigInt normalized to the integer', async () => {
    expect(await payloadOf({ a: 1.0, b: -0, c: 5n, d: 9007199254740991n })).toEqual({ a: 1, b: 0, c: 5, d: 9007199254740991 });
    expect(Object.is((await payloadOf({ b: -0 })).b, 0)).toBe(true);
    for (const [value, cls] of [
      [NaN, 'NUMBER_NOT_FINITE'], [Infinity, 'NUMBER_NOT_FINITE'], [-Infinity, 'NUMBER_NOT_FINITE'], [0.5, 'NUMBER_NOT_INTEGER'],
      [2 ** 53, 'NUMBER_OUT_OF_RANGE'], [1e21, 'NUMBER_OUT_OF_RANGE'], [2n ** 53n, 'NUMBER_OUT_OF_RANGE'], [-(2n ** 63n), 'NUMBER_OUT_OF_RANGE'],
    ] as const) {
      expect((await rejected(() => sign({ n: value }), cls, 'payload')).path).toBe('/n');
    }
  }, TIMEOUT_MS);

  // Gate 2 (§4.1 of the phase 4 contract): each R and T cell of TypeScript, by corpus ID, as the value of
  // the corpus document. R: the exact value (a BigInt where a number cannot hold it); T: the number a
  // parser would give, whose class may change. n-huge-exponent has no R cell: its 5000-digit exponent cannot be
  // materialized as a BigInt (N); its T cell uses 1e99999, a shorter literal that a parser also turns into
  // Infinity. The 9 parser IDs (P) are documented, not tested.
  it('gate 2: the host-value cells of the corpus IDs', async () => {
    const cells: [id: string, cell: 'R' | 'T', value: unknown, cls: string][] = [
      ['n-two53', 'R', 2 ** 53, 'NUMBER_OUT_OF_RANGE'],
      ['n-1e20', 'R', 1e20, 'NUMBER_OUT_OF_RANGE'],
      ['n-1e21', 'R', 1e21, 'NUMBER_OUT_OF_RANGE'],
      ['n-fraction', 'R', 0.5, 'NUMBER_NOT_INTEGER'],
      ['n-two53-plus-one', 'R', 2n ** 53n + 1n, 'NUMBER_OUT_OF_RANGE'],
      ['n-two53-plus-one', 'T', Number('9007199254740993'), 'NUMBER_OUT_OF_RANGE'],
      ['n-neg-two53-plus-one', 'R', -(2n ** 53n + 1n), 'NUMBER_OUT_OF_RANGE'],
      ['n-neg-two53-plus-one', 'T', Number('-9007199254740993'), 'NUMBER_OUT_OF_RANGE'],
      ['n-int64-max', 'R', 2n ** 63n - 1n, 'NUMBER_OUT_OF_RANGE'],
      ['n-int64-max', 'T', Number('9223372036854775807'), 'NUMBER_OUT_OF_RANGE'],
      ['n-sci-over', 'R', 9007199254740993n, 'NUMBER_OUT_OF_RANGE'],
      ['n-sci-over', 'T', Number('9.007199254740993e15'), 'NUMBER_OUT_OF_RANGE'],
      ['n-overflow', 'R', 10n ** 400n, 'NUMBER_OUT_OF_RANGE'],
      ['n-overflow', 'T', Number('1e400'), 'NUMBER_NOT_FINITE'],
      ['n-huge-exponent', 'T', Number('1e99999'), 'NUMBER_NOT_FINITE'],
      ['n-nan', 'T', NaN, 'NUMBER_NOT_FINITE'],
      ['n-negative-infinity', 'T', -Infinity, 'NUMBER_NOT_FINITE'],
    ];
    for (const [id, cell, value, cls] of cells) {
      expect((await rejected(() => sign({ n: value }), cls, 'payload')).path, `${id} ${cell}`).toBe('/n');
    }
    for (const levels of [65, 129]) await rejected(() => sign(nest(levels, 1)), 'DEPTH_EXCEEDED', 'payload');
  }, TIMEOUT_MS);

  it('strings and keys without lone surrogates', async () => {
    const lone = String.fromCharCode(0xd800);
    expect((await rejected(() => sign({ s: `a${lone}` }), 'SURROGATE_UNPAIRED')).path).toBe('/s');
    expect((await rejected(() => sign({ [`k${lone}`]: 1 }), 'SURROGATE_UNPAIRED')).path).toBe(`/k${lone}`);
  });

  it('getters and toJSON are never invoked; accessors, methods, symbols and non-enumerable members are refused', async () => {
    let invoked = 0;
    const getter = Object.defineProperty({}, 'g', { get: () => (invoked++, 1), enumerable: true });
    const method = { toJSON: () => (invoked++, {}) };
    const hidden = Object.defineProperty({ a: 1 }, 'h', { value: 1, enumerable: false });
    for (const [value, path] of [
      [getter, '/g'], [method, '/toJSON'], [hidden, '/h'], [{ [Symbol('s')]: 1 }, ''], [{ u: undefined }, '/u'], [{ f: () => 1 }, '/f'],
    ] as const) {
      expect((await rejected(() => sign(value), 'TYPE_UNSUPPORTED', 'payload')).path).toBe(path);
    }
    expect(invoked).toBe(0);
    expect(await payloadOf({ toJSON: 'data' })).toEqual({ toJSON: 'data' });
  });

  it('arrays without holes or extra members; plain or null-prototype objects only', async () => {
    const extra = Object.assign([1, 2], { extra: true });
    class Thing { a = 1; }
    for (const value of [[1, , 3], extra, new Date(0), new Map(), new Thing(), new Uint8Array(2)]) {
      await rejected(() => sign({ v: value }), 'TYPE_UNSUPPORTED', 'payload');
    }
    const bare = Object.assign(Object.create(null), { a: 1 });
    expect(await payloadOf({ v: bare })).toEqual({ v: { a: 1 } });
    const parsed = JSON.parse('{"__proto__":{"x":1}}');
    const kept = await payloadOf(parsed);
    expect(Object.getOwnPropertyDescriptor(kept, '__proto__')?.value).toEqual({ x: 1 });
  });

  it('a cycle is caught by the depth limit; an inspection that throws is a usage error, not a rejection', async () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    await rejected(() => sign(cycle), 'DEPTH_EXCEEDED', 'payload');
    const trap = new Proxy({}, { ownKeys: () => { throw new RangeError('trap'); } });
    signs.n = 0;
    const e = await failure(() => sign({ p: trap }));
    expect(e).toBeInstanceOf(TypeError);
    expect(e).not.toBeInstanceOf(ExperimentalCandidateProduceError);
    expect(signs.n).toBe(0);
  });

  it('nothing becomes null: invalid values are refused, absent options leave no member, and null is not absent', async () => {
    for (const value of [{ n: NaN }, { u: undefined }, { a: [1, , 2] }, { f: () => 1 }]) {
      await rejected(() => sign(value), (value as { n?: number }).n !== undefined ? 'NUMBER_NOT_FINITE' : 'TYPE_UNSUPPORTED');
    }
    const s = await scenario();
    const { sessionIssuedAt: _i, sessionExpiresAt: _e, createdAt: _c, ...bare } = s.options;
    const { unit } = await produceAndVerify({ ...s, options: bare });
    for (const member of ['session_issued_at', 'session_expires_at', 'intended_verifier', 'audit_merkle_root_secondary', 'pq_checkpoints']) {
      expect(member in unit.bundle.manifest, member).toBe(false);
    }
    expect(typeof unit.signature.created_at).toBe('string'); // the clock, outside every signature
    for (const options of [{ ...s.options, dualHash: null }, { ...s.options, createdAt: null }, { ...s.options, createdAt: 'not a date' }]) {
      signs.n = 0;
      expect(await failure(() => experimentalCandidateSignBundle(registry, s.parts, s.signer, options as never))).toBeInstanceOf(TypeError);
      expect(signs.n).toBe(0);
    }
  }, TIMEOUT_MS);

  it('inputs, options and key labels are copied before the first await', async () => {
    const s = await scenario();
    const reference = await produceAndVerify(s);
    const intentValue = (s.parts.intent as { value: Record<string, any> }).value;
    const entry = s.entries[1] as Record<string, any>;
    const options = { ...s.options };
    const keys = { classical: { ...principal.classical }, pq: { ...principal.pq } };
    const pending = experimentalCandidateSignBundle(registry, s.parts, { ...s.signer, keys }, options);
    intentValue.payload.action_type = 'changed';
    entry.outcome = 'changed';
    options.sessionNonce = generateSessionNonce();
    options.createdAt = '2030-01-01T00:00:00Z';
    keys.classical.kid = 'changed';
    const out = await pending;
    const unit = JSON.parse(text(out.bytes));
    expect(unit.bundle.manifest).toEqual(reference.unit.bundle.manifest);
    expect(unit.bundle.audit_entries).toEqual(reference.unit.bundle.audit_entries);
    expect(unit.signature.created_at).toBe(reference.unit.signature.created_at);
    expect(unit.signature.signer.kids[0]).toBe(principal.classical.kid);
    const r = await verifier.verify(out.bytes, verifyRegistry, undefined, NOW);
    expect(r.verification?.verified).toBe(true);
  }, TIMEOUT_MS);
});

describe('the boundaries of the inputs themselves', () => {
  const signBytes = (bytes: unknown) =>
    experimentalCandidateSignPayload(registry, DCP_CONTEXTS.Intent, { bytes } as never, agent);

  it('bytes are read through the intrinsic accessors: no slice, iterator, length or subarray of the input runs', async () => {
    let calls = 0;
    class SubstitutingBytes extends Uint8Array {
      override slice(): Uint8Array<ArrayBuffer> {
        calls++;
        return new Uint8Array(utf8('{"n":1}'));
      }
      override subarray(): Uint8Array<ArrayBuffer> {
        calls++;
        return new Uint8Array(utf8('{"n":1}'));
      }
      override [Symbol.iterator](): IterableIterator<number> {
        calls++;
        return utf8('{"n":1}')[Symbol.iterator]();
      }
    }
    const lying = new SubstitutingBytes(utf8('{"n":1.5}'));
    Object.defineProperty(lying, 'length', { get: () => (calls++, 7) });
    expect((await rejected(() => signBytes(lying), 'NUMBER_NOT_INTEGER', 'payload')).offset).toBe(5);
    const buffer = Buffer.from('{"n":1.5}');
    Object.defineProperty(buffer, 'slice', { value: () => (calls++, Buffer.from('{"n":1}')) });
    await rejected(() => signBytes(buffer), 'NUMBER_NOT_INTEGER', 'payload');
    expect(calls).toBe(0);
    const valid = new SubstitutingBytes(utf8('{"n":2}'));
    expect((await signBytes(valid)).signedPayload.payload).toEqual({ n: 2 });
    expect((await signBytes(Buffer.from('{"n":3}'))).signedPayload.payload).toEqual({ n: 3 });
    expect(calls).toBe(0);
    signs.n = 0;
    for (const bad of [new Uint16Array(2), [123, 125], '{}', new DataView(new ArrayBuffer(2))]) {
      expect(await failure(() => signBytes(bad))).toBeInstanceOf(TypeError);
    }
    expect(signs.n).toBe(0);
  }, TIMEOUT_MS);

  it('the bytes/value discriminant counts a member present as undefined', async () => {
    await rejected(() => experimentalCandidateSignPayload(registry, DCP_CONTEXTS.Intent, { value: undefined }, agent), 'TYPE_UNSUPPORTED', 'payload');
    signs.n = 0;
    const both = { bytes: utf8('{"n":1}'), value: undefined };
    expect(await failure(() => experimentalCandidateSignPayload(registry, DCP_CONTEXTS.Intent, both as never, agent))).toBeInstanceOf(TypeError);
    expect(signs.n).toBe(0);
  });

  it('the arrays of the parts are closed: a hole, an extra member or a symbol is a usage error', async () => {
    const s = await scenario();
    const extra = Object.assign([...s.parts.auditEntries], { extra: { value: {} } });
    const symbol = Object.assign([...s.parts.auditEntries], { [Symbol('s')]: 1 });
    const hole = [s.parts.auditEntries[0], , s.parts.auditEntries[1]];
    for (const auditEntries of [extra, symbol, hole]) {
      signs.n = 0;
      expect(await failure(() => experimentalCandidateSignBundle(registry, { ...s.parts, auditEntries } as never, s.signer, s.options))).toBeInstanceOf(TypeError);
      expect(signs.n).toBe(0);
    }
    signs.n = 0;
    const checkpoints = Object.assign([], { extra: 1 });
    expect(await failure(() => experimentalCandidateSignBundle(registry, { ...s.parts, pqCheckpoints: checkpoints } as never, s.signer, s.options))).toBeInstanceOf(TypeError);
    expect(signs.n).toBe(0);
  }, TIMEOUT_MS);
});

describe('package entry point', () => {
  it('exports the producers and the error class', () => {
    const entry = sdk as Record<string, unknown>;
    for (const name of ['experimentalCandidateSignPayload', 'experimentalCandidateSignBundle', 'ExperimentalCandidateProduceError']) {
      expect(typeof entry[name], name).toBe('function');
    }
  });
});
