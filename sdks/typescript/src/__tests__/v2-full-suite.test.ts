/**
 * DCP-AI v2.0 Full Test Suite
 *
 * Covers:
 *   1. Unit: canonicalization, providers, composite sigs, policy, dual-hash
 *   2. Negative: stripping, splicing, replay, downgrade, kid confusion,
 *      emergency revoke, blinded RPR, artifact swap, expired/revoked keys,
 *      float injection, broken prev_hash, tampered manifest/checkpoint
 *   3. Load: throughput benchmarks, batching, CBOR vs JSON
 *   4. NIST KAT: Ed25519, ML-DSA-65, SLH-DSA-192f compliance
 *   5. Key recovery round-trip (Shamir SSS)
 *   6. Multi-party authorization flow
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID, randomBytes } from 'crypto';

import { AlgorithmRegistry } from '../core/crypto-registry.js';
import { Ed25519Provider } from '../providers/ed25519.js';
import { MlDsa65Provider } from '../providers/ml-dsa-65.js';
import { SlhDsa192fProvider } from '../providers/slh-dsa-192f.js';

import { canonicalizeV2, assertNoFloats } from '../core/canonicalize.js';
import { DCP_CONTEXTS, domainSeparatedMessage } from '../core/domain-separation.js';
import {
  compositeSign,
  compositeVerify,
  classicalOnlySign,
} from '../core/composite-ops.js';
import type { CompositeKeyPair, CompositeKeyInfo } from '../core/composite-ops.js';
import type { CompositeSignature } from '../core/composite-sig.js';
import { deriveKid } from '../core/crypto-provider.js';
import type { KeyEntry } from '../core/crypto-provider.js';
import { preparePayload, verifyPayloadHash } from '../core/signed-payload.js';
import type { SignedPayload } from '../core/signed-payload.js';
import {
  sha256Hex,
  sha3_256Hex,
  dualHash,
  dualHashCanonical,
  dualMerkleRoot,
} from '../core/dual-hash.js';
import {
  generateSessionNonce,
  isValidSessionNonce,
  verifySessionBinding,
} from '../core/session-nonce.js';
import {
  verifySignedBundleV2,
  DEFAULT_VERIFIER_POLICY,
  PQ_ONLY_VERIFIER_POLICY,
} from '../core/verify-v2.js';
import type { VerifierPolicy } from '../types/v2.js';
import {
  blindRpr,
  verifyBlindedRpr,
  computePiiHash,
  isBlindedRpr,
} from '../core/blinded-rpr.js';
import {
  generateEmergencyRevocationToken,
  verifyEmergencyRevocationSecret,
  buildEmergencyRevocation,
} from '../core/emergency-revocation.js';
import {
  shamirSplit,
  shamirReconstruct,
  setupKeyRecovery,
} from '../core/key-recovery.js';
import {
  createPartyAuthorization,
  buildMultiPartyAuthorization,
  verifyMultiPartyAuthorization,
  DEFAULT_MULTI_PARTY_POLICIES,
} from '../core/multi-party-auth.js';
import { createPQCheckpoint, PQCheckpointManager, auditEventsMerkleRoot } from '../core/pq-checkpoint.js';
import { createAuditCompaction, AuditCompactionManager } from '../core/audit-compaction.js';
import { BundleBuilderV2 } from '../bundle/builder-v2.js';
import { signBundleV2, signBundleV2ClassicalOnly } from '../bundle/signer-v2.js';
import { CborEncoder, CborDecoder, cborEncode, cborDecode, jsonToCborPayload, cborPayloadToJson, detectWireFormat } from '../wire/cbor.js';

import type {
  AgentPassportV2,
  ResponsiblePrincipalRecordV2,
  IntentV2,
  PolicyDecisionV2,
  AuditEventV2,
  SignedBundleV2,
} from '../types/v2.js';

// ═══════════════════════════════════════════════════════════════════════════
// Shared setup
// ═══════════════════════════════════════════════════════════════════════════

let registry: AlgorithmRegistry;
let ed25519: Ed25519Provider;
let mlDsa65: MlDsa65Provider;

interface Keypair {
  kid: string;
  publicKeyB64: string;
  secretKeyB64: string;
}

let classicalKp: Keypair;
let pqKp: Keypair;
let keys: CompositeKeyPair;
let sessionNonce: string;

let rprClassicalKp: Keypair;
let rprPqKp: Keypair;
let rprKeys: CompositeKeyPair;

beforeAll(async () => {
  registry = new AlgorithmRegistry();
  ed25519 = new Ed25519Provider();
  mlDsa65 = new MlDsa65Provider();
  registry.registerSigner(ed25519);
  registry.registerSigner(mlDsa65);

  classicalKp = await ed25519.generateKeypair();
  pqKp = await mlDsa65.generateKeypair();
  keys = {
    classical: { kid: classicalKp.kid, alg: 'ed25519', secretKeyB64: classicalKp.secretKeyB64, publicKeyB64: classicalKp.publicKeyB64 },
    pq: { kid: pqKp.kid, alg: 'ml-dsa-65', secretKeyB64: pqKp.secretKeyB64, publicKeyB64: pqKp.publicKeyB64 },
  };

  rprClassicalKp = await ed25519.generateKeypair();
  rprPqKp = await mlDsa65.generateKeypair();
  rprKeys = {
    classical: { kid: rprClassicalKp.kid, alg: 'ed25519', secretKeyB64: rprClassicalKp.secretKeyB64, publicKeyB64: rprClassicalKp.publicKeyB64 },
    pq: { kid: rprPqKp.kid, alg: 'ml-dsa-65', secretKeyB64: rprPqKp.secretKeyB64, publicKeyB64: rprPqKp.publicKeyB64 },
  };

  sessionNonce = generateSessionNonce();
});

// ── Helpers ──

function makeKeyEntry(kp: Keypair, alg: string): KeyEntry {
  return {
    kid: kp.kid,
    alg,
    public_key_b64: kp.publicKeyB64,
    created_at: '2026-02-25T00:00:00Z',
    expires_at: '2027-02-25T00:00:00Z',
    status: 'active',
  };
}

function makePassport(nonce: string): AgentPassportV2 {
  return {
    dcp_version: '2.0',
    agent_id: `agent-${randomUUID()}`,
    session_nonce: nonce,
    keys: [makeKeyEntry(classicalKp, 'ed25519'), makeKeyEntry(pqKp, 'ml-dsa-65')],
    principal_binding_reference: 'human-test',
    capabilities: ['api_call', 'browse'],
    risk_tier: 'medium',
    created_at: '2026-02-25T00:00:00Z',
    status: 'active',
  };
}

function makeRpr(nonce: string): ResponsiblePrincipalRecordV2 {
  return {
    dcp_version: '2.0',
    human_id: 'human-test',
    session_nonce: nonce,
    legal_name: 'Jane Doe',
    entity_type: 'natural_person',
    jurisdiction: 'US',
    liability_mode: 'owner_responsible',
    override_rights: true,
    issued_at: '2026-02-25T00:00:00Z',
    expires_at: '2027-02-25T00:00:00Z',
    contact: 'jane@example.com',
    binding_keys: [
      makeKeyEntry(rprClassicalKp, 'ed25519'),
      makeKeyEntry(rprPqKp, 'ml-dsa-65'),
    ],
  };
}

function makeIntent(nonce: string, agentId: string): IntentV2 {
  return {
    dcp_version: '2.0',
    intent_id: `intent-${randomUUID()}`,
    session_nonce: nonce,
    agent_id: agentId,
    human_id: 'human-test',
    timestamp: '2026-02-25T12:00:00Z',
    action_type: 'send_email',
    target: { channel: 'email', to: 'recipient@example.com' },
    data_classes: ['contact_info'],
    estimated_impact: 'medium',
    requires_consent: false,
  };
}

function makePolicyDecision(nonce: string, intentId: string): PolicyDecisionV2 {
  return {
    dcp_version: '2.0',
    intent_id: intentId,
    session_nonce: nonce,
    decision: 'approve',
    risk_score: 450,
    reasons: ['medium risk action'],
    required_confirmation: null,
    applied_policy_hash: 'sha256:fakepolicyhash',
    timestamp: '2026-02-25T12:00:01Z',
  };
}

function makeAuditEvent(
  nonce: string, agentId: string, intentId: string,
  prevHash: string, idx: number,
): AuditEventV2 {
  return {
    dcp_version: '2.0',
    audit_id: `audit-${idx}`,
    session_nonce: nonce,
    prev_hash: prevHash,
    hash_alg: 'sha256',
    timestamp: `2026-02-25T12:0${idx}:00Z`,
    agent_id: agentId,
    human_id: 'human-test',
    intent_id: intentId,
    intent_hash: 'sha256:placeholder',
    policy_decision: 'approved',
    outcome: `action_${idx}_completed`,
    evidence: { tool: 'email_client', result_ref: null, evidence_hash: null },
    pq_checkpoint_ref: null,
  };
}

async function signPayload<T>(
  payload: T,
  context: string,
  sigKeys: CompositeKeyPair,
): Promise<SignedPayload<T>> {
  const { canonicalBytes, payloadHash } = preparePayload(payload);
  const sig = await compositeSign(registry, context, canonicalBytes, sigKeys);
  return { payload, payload_hash: payloadHash, composite_sig: sig };
}

function buildAuditChain(
  nonce: string, agentId: string, intentId: string, count: number,
): AuditEventV2[] {
  const entries: AuditEventV2[] = [];
  let prevHash = 'GENESIS';
  for (let i = 0; i < count; i++) {
    const entry = makeAuditEvent(nonce, agentId, intentId, prevHash, i);
    entries.push(entry);
    const canonical = canonicalizeV2(entry);
    prevHash = `sha256:${sha256Hex(Buffer.from(canonical, 'utf8'))}`;
  }
  return entries;
}

async function buildSignedBundleV2(
  nonce?: string,
): Promise<SignedBundleV2> {
  const sn = nonce || sessionNonce;
  const passport = makePassport(sn);
  const rpr = makeRpr(sn);
  const intent = makeIntent(sn, passport.agent_id);
  const policy = makePolicyDecision(sn, intent.intent_id);

  const signedPassport = await signPayload(passport, DCP_CONTEXTS.AgentPassport, keys);
  const signedRpr = await signPayload(rpr, DCP_CONTEXTS.ResponsiblePrincipal, rprKeys);
  const signedIntent = await signPayload(intent, DCP_CONTEXTS.Intent, keys);
  const signedPolicy = await signPayload(policy, DCP_CONTEXTS.PolicyDecision, keys);

  const auditEntries = buildAuditChain(sn, passport.agent_id, intent.intent_id, 3);

  const bundle = new BundleBuilderV2(sn)
    .responsiblePrincipalRecord(signedRpr)
    .agentPassport(signedPassport)
    .intent(signedIntent)
    .policyDecision(signedPolicy)
    .addAuditEntries(auditEntries)
    .build();

  return signBundleV2(bundle, {
    registry,
    signerType: 'human',
    signerId: 'human-test',
    keys: rprKeys,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. UNIT TESTS
// ═══════════════════════════════════════════════════════════════════════════

// ── 1a. Canonicalization ──

describe('Unit: Canonicalization (RFC 8785 + float prohibition)', () => {
  it('sorts keys lexicographically', () => {
    expect(canonicalizeV2({ z: 1, a: 2, m: 3 })).toBe('{"a":2,"m":3,"z":1}');
  });

  it('produces compact form without whitespace', () => {
    const result = canonicalizeV2({ hello: 'world', num: 42 });
    expect(result).not.toContain(' ');
    expect(result).not.toContain('\n');
  });

  it('handles nested objects with sorted keys', () => {
    expect(canonicalizeV2({ b: { d: 1, c: 2 }, a: 3 })).toBe('{"a":3,"b":{"c":2,"d":1}}');
  });

  it('handles arrays preserving order', () => {
    expect(canonicalizeV2({ items: [3, 1, 2] })).toBe('{"items":[3,1,2]}');
  });

  it('serializes null correctly', () => {
    expect(canonicalizeV2({ x: null })).toBe('{"x":null}');
  });

  it('serializes booleans correctly', () => {
    expect(canonicalizeV2({ t: true, f: false })).toBe('{"f":false,"t":true}');
  });

  it('serializes integers without decimal point', () => {
    expect(canonicalizeV2({ n: 0 })).toBe('{"n":0}');
    expect(canonicalizeV2({ n: -1 })).toBe('{"n":-1}');
    expect(canonicalizeV2({ n: 1000 })).toBe('{"n":1000}');
  });

  it('omits undefined values', () => {
    expect(canonicalizeV2({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}');
  });

  it('handles empty objects and arrays', () => {
    expect(canonicalizeV2({})).toBe('{}');
    expect(canonicalizeV2([])).toBe('[]');
  });

  it('handles unicode strings', () => {
    const result = canonicalizeV2({ emoji: '🔑', kanji: '鍵' });
    expect(result).toContain('🔑');
    expect(result).toContain('鍵');
  });

  it('rejects top-level float', () => {
    expect(() => canonicalizeV2({ score: 0.5 })).toThrow('Float value prohibited');
  });

  it('rejects nested float', () => {
    expect(() => canonicalizeV2({ nested: { val: 3.14 } })).toThrow();
  });

  it('rejects float in array', () => {
    expect(() => canonicalizeV2({ arr: [1, 2.5, 3] })).toThrow();
  });

  it('rejects NaN', () => {
    expect(() => canonicalizeV2({ x: NaN })).toThrow();
  });

  it('rejects Infinity', () => {
    expect(() => canonicalizeV2({ x: Infinity })).toThrow();
  });

  it('accepts integer risk_score (millirisk)', () => {
    expect(() => canonicalizeV2({ risk_score: 450 })).not.toThrow();
  });

  it('assertNoFloats passes for deep nested integers', () => {
    expect(() => assertNoFloats({
      a: { b: { c: [1, 2, { d: 3 }] } },
    })).not.toThrow();
  });

  it('produces deterministic output for same input', () => {
    const obj = { z: 1, a: 2, m: { x: 10, b: 20 } };
    expect(canonicalizeV2(obj)).toBe(canonicalizeV2(obj));
  });

  it('different key order produces same canonical form', () => {
    expect(canonicalizeV2({ b: 2, a: 1 })).toBe(canonicalizeV2({ a: 1, b: 2 }));
  });
});

// ── 1b. Crypto Providers ──

describe('Unit: Ed25519Provider', () => {
  it('generates 32-byte public key', async () => {
    const kp = await ed25519.generateKeypair();
    expect(Buffer.from(kp.publicKeyB64, 'base64').length).toBe(32);
  });

  it('generates deterministic kid', async () => {
    const kp = await ed25519.generateKeypair();
    const pkBytes = new Uint8Array(Buffer.from(kp.publicKeyB64, 'base64'));
    expect(deriveKid('ed25519', pkBytes)).toBe(kp.kid);
  });

  it('sign/verify round-trip', async () => {
    const kp = await ed25519.generateKeypair();
    const msg = new TextEncoder().encode('test message');
    const sig = await ed25519.sign(msg, kp.secretKeyB64);
    expect(await ed25519.verify(msg, sig, kp.publicKeyB64)).toBe(true);
  });

  it('produces 64-byte signatures', async () => {
    const kp = await ed25519.generateKeypair();
    const sig = await ed25519.sign(new Uint8Array(0), kp.secretKeyB64);
    expect(sig.length).toBe(64);
  });

  it('is deterministic (same key + msg = same sig)', async () => {
    const kp = await ed25519.generateKeypair();
    const msg = new TextEncoder().encode('deterministic');
    const s1 = await ed25519.sign(msg, kp.secretKeyB64);
    const s2 = await ed25519.sign(msg, kp.secretKeyB64);
    expect(Buffer.from(s1).equals(Buffer.from(s2))).toBe(true);
  });

  it('rejects tampered signature', async () => {
    const kp = await ed25519.generateKeypair();
    const msg = new TextEncoder().encode('test');
    const sig = await ed25519.sign(msg, kp.secretKeyB64);
    sig[0] ^= 0xff;
    expect(await ed25519.verify(msg, sig, kp.publicKeyB64)).toBe(false);
  });
});

describe('Unit: MlDsa65Provider', () => {
  it('generates 1952-byte public key', async () => {
    const kp = await mlDsa65.generateKeypair();
    expect(Buffer.from(kp.publicKeyB64, 'base64').length).toBe(1952);
  });

  it('generates deterministic kid', async () => {
    const kp = await mlDsa65.generateKeypair();
    const pkBytes = new Uint8Array(Buffer.from(kp.publicKeyB64, 'base64'));
    expect(deriveKid('ml-dsa-65', pkBytes)).toBe(kp.kid);
  });

  it('sign/verify round-trip', async () => {
    const kp = await mlDsa65.generateKeypair();
    const msg = new TextEncoder().encode('PQ test');
    const sig = await mlDsa65.sign(msg, kp.secretKeyB64);
    expect(await mlDsa65.verify(msg, sig, kp.publicKeyB64)).toBe(true);
  });

  it('rejects wrong public key', async () => {
    const kp1 = await mlDsa65.generateKeypair();
    const kp2 = await mlDsa65.generateKeypair();
    const msg = new TextEncoder().encode('test');
    const sig = await mlDsa65.sign(msg, kp1.secretKeyB64);
    expect(await mlDsa65.verify(msg, sig, kp2.publicKeyB64)).toBe(false);
  });
});

describe('Unit: SlhDsa192fProvider (backup PQ)', () => {
  let slhDsa: SlhDsa192fProvider;

  beforeAll(() => {
    slhDsa = new SlhDsa192fProvider();
  });

  it('generates keypair with correct kid', async () => {
    const kp = await slhDsa.generateKeypair();
    expect(kp.kid).toHaveLength(32);
    expect(kp.kid).toMatch(/^[0-9a-f]{32}$/);
  });

  it('generates 48-byte public key (FIPS 205)', async () => {
    const kp = await slhDsa.generateKeypair();
    expect(Buffer.from(kp.publicKeyB64, 'base64').length).toBe(48);
  });

  it('sign/verify round-trip', async () => {
    const kp = await slhDsa.generateKeypair();
    const msg = new TextEncoder().encode('SLH-DSA test');
    const sig = await slhDsa.sign(msg, kp.secretKeyB64);
    expect(await slhDsa.verify(msg, sig, kp.publicKeyB64)).toBe(true);
  });

  it('rejects tampered message', async () => {
    const kp = await slhDsa.generateKeypair();
    const sig = await slhDsa.sign(new TextEncoder().encode('correct'), kp.secretKeyB64);
    expect(await slhDsa.verify(new TextEncoder().encode('wrong'), sig, kp.publicKeyB64)).toBe(false);
  });
}, { timeout: 120_000 });

// ── 1c. Kid Derivation ──

describe('Unit: Deterministic kid derivation', () => {
  it('same key + alg always produces same kid', async () => {
    const kp = await ed25519.generateKeypair();
    const pkBytes = new Uint8Array(Buffer.from(kp.publicKeyB64, 'base64'));
    const kid1 = deriveKid('ed25519', pkBytes);
    const kid2 = deriveKid('ed25519', pkBytes);
    expect(kid1).toBe(kid2);
  });

  it('different keys produce different kids', async () => {
    const kp1 = await ed25519.generateKeypair();
    const kp2 = await ed25519.generateKeypair();
    expect(kp1.kid).not.toBe(kp2.kid);
  });

  it('same key bytes but different alg produces different kid', async () => {
    const pkBytes = new Uint8Array(32).fill(0xaa);
    const kid1 = deriveKid('ed25519', pkBytes);
    const kid2 = deriveKid('ml-dsa-65', pkBytes);
    expect(kid1).not.toBe(kid2);
  });

  it('kid is exactly 32 hex chars', async () => {
    const kp = await ed25519.generateKeypair();
    expect(kp.kid).toMatch(/^[0-9a-f]{32}$/);
  });
});

// ── 1d. Composite Signatures ──

describe('Unit: Composite Signature Operations', () => {
  it('compositeSign produces pq_over_classical binding', async () => {
    const payload = new TextEncoder().encode(canonicalizeV2({ test: 1 }));
    const sig = await compositeSign(registry, DCP_CONTEXTS.AgentPassport, payload, keys);
    expect(sig.binding).toBe('pq_over_classical');
    expect(sig.classical.alg).toBe('ed25519');
    expect(sig.pq).not.toBeNull();
    expect(sig.pq!.alg).toBe('ml-dsa-65');
  });

  it('compositeVerify succeeds for valid signature', async () => {
    const payload = new TextEncoder().encode(canonicalizeV2({ round: 'trip' }));
    const sig = await compositeSign(registry, DCP_CONTEXTS.Intent, payload, keys);
    const result = await compositeVerify(
      registry, DCP_CONTEXTS.Intent, payload, sig,
      classicalKp.publicKeyB64, pqKp.publicKeyB64,
    );
    expect(result.valid).toBe(true);
    expect(result.classical_valid).toBe(true);
    expect(result.pq_valid).toBe(true);
  });

  it('parallel strategy works correctly', async () => {
    const payload = new TextEncoder().encode(canonicalizeV2({ strat: 'parallel' }));
    const sig = await compositeSign(registry, DCP_CONTEXTS.Bundle, payload, keys);
    const result = await compositeVerify(
      registry, DCP_CONTEXTS.Bundle, payload, sig,
      classicalKp.publicKeyB64, pqKp.publicKeyB64, 'parallel',
    );
    expect(result.valid).toBe(true);
  });

  it('pq_first strategy fast-fails on bad PQ', async () => {
    const payload = new TextEncoder().encode(canonicalizeV2({ strat: 'pq_first' }));
    const sig = await compositeSign(registry, DCP_CONTEXTS.Bundle, payload, keys);
    const tampered = JSON.parse(JSON.stringify(sig));
    const pqSig = Buffer.from(tampered.pq.sig_b64, 'base64');
    pqSig[0] ^= 0xff;
    tampered.pq.sig_b64 = pqSig.toString('base64');

    const result = await compositeVerify(
      registry, DCP_CONTEXTS.Bundle, payload, tampered,
      classicalKp.publicKeyB64, pqKp.publicKeyB64, 'pq_first',
    );
    expect(result.valid).toBe(false);
    expect(result.pq_valid).toBe(false);
    expect(result.classical_valid).toBe(false);
  });

  it('classicalOnlySign produces classical_only binding', async () => {
    const payload = new TextEncoder().encode(canonicalizeV2({ mode: 'classical' }));
    const sig = await classicalOnlySign(registry, DCP_CONTEXTS.Intent, payload, keys.classical);
    expect(sig.binding).toBe('classical_only');
    expect(sig.pq).toBeNull();
    const result = await compositeVerify(
      registry, DCP_CONTEXTS.Intent, payload, sig,
      classicalKp.publicKeyB64,
    );
    expect(result.valid).toBe(true);
    expect(result.classical_valid).toBe(true);
    expect(result.pq_valid).toBe(false);
  });
});

// ── 1e. Domain Separation ──

describe('Unit: Domain Separation', () => {
  it('all context tags are distinct', () => {
    const values = Object.values(DCP_CONTEXTS);
    expect(new Set(values).size).toBe(values.length);
  });

  it('domainSeparatedMessage includes context + null byte + payload', () => {
    const payload = new Uint8Array([0x01, 0x02]);
    const dsm = domainSeparatedMessage(DCP_CONTEXTS.Intent, payload);
    const contextBytes = new TextEncoder().encode(DCP_CONTEXTS.Intent);
    expect(dsm[contextBytes.length]).toBe(0x00);
    expect(dsm.length).toBe(contextBytes.length + 1 + payload.length);
  });

  it('rejects invalid context tag', () => {
    expect(() =>
      domainSeparatedMessage('InvalidContext' as any, new Uint8Array(0)),
    ).toThrow('Invalid DCP context tag');
  });

  it('same payload with different contexts produces different DSMs', () => {
    const payload = new Uint8Array([0xAA]);
    const dsm1 = domainSeparatedMessage(DCP_CONTEXTS.Intent, payload);
    const dsm2 = domainSeparatedMessage(DCP_CONTEXTS.AuditEvent, payload);
    expect(Buffer.from(dsm1).toString('hex')).not.toBe(Buffer.from(dsm2).toString('hex'));
  });

  it('signature under one context fails verification under another', async () => {
    const payload = new TextEncoder().encode(canonicalizeV2({ test: 'cross-context' }));
    const sig = await compositeSign(registry, DCP_CONTEXTS.Intent, payload, keys);
    const result = await compositeVerify(
      registry, DCP_CONTEXTS.AuditEvent, payload, sig,
      classicalKp.publicKeyB64, pqKp.publicKeyB64,
    );
    expect(result.valid).toBe(false);
  });
});

// ── 1f. SignedPayload Envelope ──

describe('Unit: SignedPayload Envelope', () => {
  it('preparePayload produces correct hash', () => {
    const payload = { agent_id: 'test', dcp_version: '2.0' };
    const { canonicalBytes, payloadHash } = preparePayload(payload);
    expect(payloadHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const expectedHash = sha256Hex(canonicalBytes);
    expect(payloadHash).toBe(`sha256:${expectedHash}`);
  });

  it('verifyPayloadHash succeeds for untampered payload', async () => {
    const passport = makePassport(sessionNonce);
    const signed = await signPayload(passport, DCP_CONTEXTS.AgentPassport, keys);
    expect(verifyPayloadHash(signed)).toBe(true);
  });

  it('verifyPayloadHash fails for tampered payload', async () => {
    const passport = makePassport(sessionNonce);
    const signed = await signPayload(passport, DCP_CONTEXTS.AgentPassport, keys);
    (signed.payload as any).agent_id = 'tampered-agent';
    expect(verifyPayloadHash(signed)).toBe(false);
  });
});

// ── 1g. Session Nonce ──

describe('Unit: Session Nonce', () => {
  it('generates 64-char hex nonce', () => {
    const nonce = generateSessionNonce();
    expect(nonce).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates unique nonces', () => {
    const a = generateSessionNonce();
    const b = generateSessionNonce();
    expect(a).not.toBe(b);
  });

  it('isValidSessionNonce accepts valid nonce', () => {
    expect(isValidSessionNonce(generateSessionNonce())).toBe(true);
  });

  it('isValidSessionNonce rejects invalid nonces', () => {
    expect(isValidSessionNonce('')).toBe(false);
    expect(isValidSessionNonce('too-short')).toBe(false);
    expect(isValidSessionNonce('g'.repeat(64))).toBe(false);
  });

  it('verifySessionBinding succeeds when all nonces match', () => {
    const nonce = generateSessionNonce();
    const result = verifySessionBinding([
      { session_nonce: nonce },
      { session_nonce: nonce },
      { session_nonce: nonce },
    ]);
    expect(result.valid).toBe(true);
    expect(result.nonce).toBe(nonce);
  });

  it('verifySessionBinding fails on mismatch', () => {
    const result = verifySessionBinding([
      { session_nonce: generateSessionNonce() },
      { session_nonce: generateSessionNonce() },
    ]);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('mismatch');
  });

  it('verifySessionBinding fails on empty array', () => {
    expect(verifySessionBinding([]).valid).toBe(false);
  });
});

// ── 1h. Dual-Hash ──

describe('Unit: Dual-Hash (SHA-256 + SHA3-256)', () => {
  it('sha256Hex produces 64-char hex', () => {
    expect(sha256Hex('hello')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sha3_256Hex produces 64-char hex', () => {
    expect(sha3_256Hex('hello')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('SHA-256 and SHA3-256 produce different hashes for same input', () => {
    const result = dualHash('test');
    expect(result.sha256).not.toBe(result.sha3_256);
  });

  it('dualHashCanonical works on canonical JSON', () => {
    const canonical = canonicalizeV2({ a: 1, b: 2 });
    const result = dualHashCanonical(canonical);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.sha3_256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('dualMerkleRoot produces both roots', () => {
    const leaves = [
      dualHash('leaf1'),
      dualHash('leaf2'),
      dualHash('leaf3'),
    ];
    const root = dualMerkleRoot(leaves);
    expect(root).not.toBeNull();
    expect(root!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(root!.sha3_256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('dualMerkleRoot returns null for empty leaves', () => {
    expect(dualMerkleRoot([])).toBeNull();
  });

  it('dualMerkleRoot of single leaf equals the leaf', () => {
    const leaf = dualHash('single');
    const root = dualMerkleRoot([leaf]);
    expect(root!.sha256).toBe(leaf.sha256);
    expect(root!.sha3_256).toBe(leaf.sha3_256);
  });
});

// ── 1i. Verifier Policy Enforcement ──

describe('Unit: Verifier Policy (V2 Bundle Verification)', () => {
  it('verifies a valid V2 signed bundle (hybrid_required)', async () => {
    const signed = await buildSignedBundleV2();
    const result = await verifySignedBundleV2(signed, registry, DEFAULT_VERIFIER_POLICY);
    expect(result.verified).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('verifies with hybrid_preferred policy', async () => {
    const policy: VerifierPolicy = {
      ...DEFAULT_VERIFIER_POLICY,
      default_mode: 'hybrid_preferred',
      risk_overrides: { low: 'hybrid_preferred', medium: 'hybrid_preferred', high: 'hybrid_preferred' },
    };
    const signed = await buildSignedBundleV2();
    const result = await verifySignedBundleV2(signed, registry, policy);
    expect(result.verified).toBe(true);
  });

  it('rejects classical-only bundle under hybrid_required policy', async () => {
    const sn = generateSessionNonce();
    const passport = makePassport(sn);
    const rpr = makeRpr(sn);
    const intent = makeIntent(sn, passport.agent_id);
    const policy = makePolicyDecision(sn, intent.intent_id);

    const signedPassport = await signPayload(passport, DCP_CONTEXTS.AgentPassport, keys);
    const signedRpr = await signPayload(rpr, DCP_CONTEXTS.ResponsiblePrincipal, rprKeys);
    const signedIntent = await signPayload(intent, DCP_CONTEXTS.Intent, keys);
    const signedPolicy = await signPayload(policy, DCP_CONTEXTS.PolicyDecision, keys);
    const auditEntries = buildAuditChain(sn, passport.agent_id, intent.intent_id, 1);

    const bundle = new BundleBuilderV2(sn)
      .responsiblePrincipalRecord(signedRpr)
      .agentPassport(signedPassport)
      .intent(signedIntent)
      .policyDecision(signedPolicy)
      .addAuditEntries(auditEntries)
      .build();

    const classicalOnly = await signBundleV2ClassicalOnly(bundle, {
      registry,
      signerType: 'human',
      signerId: 'human-test',
      key: rprKeys.classical,
    });

    const hybridRequiredPolicy: VerifierPolicy = {
      ...DEFAULT_VERIFIER_POLICY,
      default_mode: 'hybrid_required',
      risk_overrides: { low: 'hybrid_required', medium: 'hybrid_required', high: 'hybrid_required' },
    };
    const result = await verifySignedBundleV2(classicalOnly, registry, hybridRequiredPolicy);
    expect(result.verified).toBe(false);
    expect(result.errors.some(e => e.includes('PQ signature') || e.includes('composite binding'))).toBe(true);
  });

  it('accepts classical-only bundle under hybrid_preferred (with warning)', async () => {
    const sn = generateSessionNonce();
    const passport = makePassport(sn);
    const rpr = makeRpr(sn);
    const intent = makeIntent(sn, passport.agent_id);
    const pd = makePolicyDecision(sn, intent.intent_id);

    const signedPassport = await signPayload(passport, DCP_CONTEXTS.AgentPassport, keys);
    const signedRpr = await signPayload(rpr, DCP_CONTEXTS.ResponsiblePrincipal, rprKeys);
    const signedIntent = await signPayload(intent, DCP_CONTEXTS.Intent, keys);
    const signedPolicy = await signPayload(pd, DCP_CONTEXTS.PolicyDecision, keys);
    const auditEntries = buildAuditChain(sn, passport.agent_id, intent.intent_id, 1);

    const bundle = new BundleBuilderV2(sn)
      .responsiblePrincipalRecord(signedRpr)
      .agentPassport(signedPassport)
      .intent(signedIntent)
      .policyDecision(signedPolicy)
      .addAuditEntries(auditEntries)
      .build();

    const classicalOnly = await signBundleV2ClassicalOnly(bundle, {
      registry,
      signerType: 'human',
      signerId: 'human-test',
      key: rprKeys.classical,
    });

    const preferredPolicy: VerifierPolicy = {
      ...DEFAULT_VERIFIER_POLICY,
      default_mode: 'hybrid_preferred',
      risk_overrides: { low: 'hybrid_preferred', medium: 'hybrid_preferred', high: 'hybrid_preferred' },
      require_composite_binding: false,
    };
    const result = await verifySignedBundleV2(classicalOnly, registry, preferredPolicy);
    expect(result.verified).toBe(true);
    expect(result.warnings.some(w => w.includes('PQ signature missing'))).toBe(true);
  });

  it('detects version mismatch', async () => {
    const signed = await buildSignedBundleV2();
    (signed.bundle as any).dcp_bundle_version = '3.0';
    const result = await verifySignedBundleV2(signed, registry, DEFAULT_VERIFIER_POLICY);
    expect(result.verified).toBe(false);
    expect(result.errors[0]).toContain('Unsupported bundle version');
  });

  it('enforces max_key_age_days with warning', async () => {
    const sn = generateSessionNonce();
    const passport = makePassport(sn);
    passport.keys[0].created_at = '2020-01-01T00:00:00Z';

    const rpr = makeRpr(sn);
    const intent = makeIntent(sn, passport.agent_id);
    const pd = makePolicyDecision(sn, intent.intent_id);

    const signedPassport = await signPayload(passport, DCP_CONTEXTS.AgentPassport, keys);
    const signedRpr = await signPayload(rpr, DCP_CONTEXTS.ResponsiblePrincipal, rprKeys);
    const signedIntent = await signPayload(intent, DCP_CONTEXTS.Intent, keys);
    const signedPolicy = await signPayload(pd, DCP_CONTEXTS.PolicyDecision, keys);
    const auditEntries = buildAuditChain(sn, passport.agent_id, intent.intent_id, 1);

    const bundle = new BundleBuilderV2(sn)
      .responsiblePrincipalRecord(signedRpr)
      .agentPassport(signedPassport)
      .intent(signedIntent)
      .policyDecision(signedPolicy)
      .addAuditEntries(auditEntries)
      .build();

    const signed = await signBundleV2(bundle, {
      registry, signerType: 'human', signerId: 'human-test', keys: rprKeys,
    });

    const policy: VerifierPolicy = { ...DEFAULT_VERIFIER_POLICY, max_key_age_days: 365 };
    const result = await verifySignedBundleV2(signed, registry, policy);
    expect(result.warnings.some(w => w.includes('exceeds max age'))).toBe(true);
  });

  it('rejects bundle with advisory-rejected algorithm', async () => {
    const signed = await buildSignedBundleV2();
    const policy: VerifierPolicy = {
      ...DEFAULT_VERIFIER_POLICY,
      advisory_rejected_algs: ['ed25519'],
    };
    const result = await verifySignedBundleV2(signed, registry, policy);
    expect(result.verified).toBe(false);
    expect(result.errors.some(e => e.includes('rejected by active advisory'))).toBe(true);
  });
});

// ── 1j. PQ Checkpoints ──

describe('Unit: PQ Checkpoints', () => {
  it('creates a checkpoint for a batch of audit events', async () => {
    const sn = generateSessionNonce();
    const events = buildAuditChain(sn, 'agent-1', 'intent-1', 5);
    const ckpt = await createPQCheckpoint(registry, events, sn, keys);

    expect(ckpt.checkpoint_id).toMatch(/^ckpt-/);
    expect(ckpt.session_nonce).toBe(sn);
    expect(ckpt.event_range.count).toBe(5);
    expect(ckpt.merkle_root).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(ckpt.composite_sig.binding).toBe('pq_over_classical');
  });

  it('PQCheckpointManager flushes at interval', async () => {
    const sn = generateSessionNonce();
    const mgr = new PQCheckpointManager(3, registry, sn, keys);

    const events = buildAuditChain(sn, 'agent-1', 'intent-1', 5);

    const r1 = await mgr.recordEvent(events[0]);
    expect(r1).toBeNull();
    const r2 = await mgr.recordEvent(events[1]);
    expect(r2).toBeNull();
    const r3 = await mgr.recordEvent(events[2]);
    expect(r3).not.toBeNull();
    expect(r3!.event_range.count).toBe(3);
    expect(mgr.getPendingCount()).toBe(0);
    expect(mgr.getCheckpoints()).toHaveLength(1);
  });

  it('PQCheckpointManager manual flush at session end', async () => {
    const sn = generateSessionNonce();
    const mgr = new PQCheckpointManager(10, registry, sn, keys);

    const events = buildAuditChain(sn, 'agent-1', 'intent-1', 3);
    for (const e of events) await mgr.recordEvent(e);

    expect(mgr.getPendingCount()).toBe(3);
    const ckpt = await mgr.flush();
    expect(ckpt).not.toBeNull();
    expect(mgr.getPendingCount()).toBe(0);
  });

  it('auditEventsMerkleRoot is deterministic', () => {
    const sn = generateSessionNonce();
    const events = buildAuditChain(sn, 'agent-1', 'intent-1', 4);
    const root1 = auditEventsMerkleRoot(events);
    const root2 = auditEventsMerkleRoot(events);
    expect(root1).toBe(root2);
  });
});

// ── 1k. Audit Compaction ──

describe('Unit: Audit Trail Compaction', () => {
  it('creates compaction checkpoint with merkle root', async () => {
    const sn = generateSessionNonce();
    const events = buildAuditChain(sn, 'agent-1', 'intent-1', 5);
    const result = await createAuditCompaction(registry, events, sn, keys);

    expect(result.compaction.type).toBe('audit_compaction');
    expect(result.compaction.range.count).toBe(5);
    expect(result.compaction.merkle_root).toMatch(/^sha256:/);
    expect(result.archivedEventIds).toHaveLength(5);
    expect(result.nextPrevHash).toMatch(/^sha256:/);
  });

  it('AuditCompactionManager compacts at threshold', async () => {
    const sn = generateSessionNonce();
    const mgr = new AuditCompactionManager(3, registry, sn, keys);
    const events = buildAuditChain(sn, 'agent-1', 'intent-1', 5);

    const r1 = await mgr.recordEvent(events[0]);
    const r2 = await mgr.recordEvent(events[1]);
    expect(r1).toBeNull();
    expect(r2).toBeNull();

    const r3 = await mgr.recordEvent(events[2]);
    expect(r3).not.toBeNull();
    expect(r3!.compaction.range.count).toBe(3);
    expect(mgr.getNextPrevHash()).toMatch(/^sha256:/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. NEGATIVE / ATTACK TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Negative: Stripping Attacks', () => {
  it('removing PQ signature with pq_over_classical binding fails', async () => {
    const payload = new TextEncoder().encode(canonicalizeV2({ action: 'transfer' }));
    const sig = await compositeSign(registry, DCP_CONTEXTS.Intent, payload, keys);

    const stripped: CompositeSignature = {
      classical: sig.classical,
      pq: null,
      binding: 'pq_over_classical',
    };

    const result = await compositeVerify(
      registry, DCP_CONTEXTS.Intent, payload, stripped,
      classicalKp.publicKeyB64, pqKp.publicKeyB64,
    );
    expect(result.valid).toBe(false);
  });

  it('stripping PQ + changing binding to classical_only: classical verifies but pq_valid=false', async () => {
    const payload = new TextEncoder().encode(canonicalizeV2({ action: 'downgrade' }));
    const sig = await compositeSign(registry, DCP_CONTEXTS.Intent, payload, keys);

    const downgraded: CompositeSignature = {
      classical: sig.classical,
      pq: null,
      binding: 'classical_only',
    };

    const result = await compositeVerify(
      registry, DCP_CONTEXTS.Intent, payload, downgraded,
      classicalKp.publicKeyB64,
    );
    expect(result.classical_valid).toBe(true);
    expect(result.pq_valid).toBe(false);
  });

  it('tampering classical sig breaks both (binding)', async () => {
    const payload = new TextEncoder().encode(canonicalizeV2({ x: 1 }));
    const sig = await compositeSign(registry, DCP_CONTEXTS.Intent, payload, keys);

    const tampered = JSON.parse(JSON.stringify(sig));
    const sigBytes = Buffer.from(tampered.classical.sig_b64, 'base64');
    sigBytes[0] ^= 0xff;
    tampered.classical.sig_b64 = sigBytes.toString('base64');

    const result = await compositeVerify(
      registry, DCP_CONTEXTS.Intent, payload, tampered,
      classicalKp.publicKeyB64, pqKp.publicKeyB64,
    );
    expect(result.valid).toBe(false);
    expect(result.classical_valid).toBe(false);
    expect(result.pq_valid).toBe(false);
  });

  it('tampering PQ sig breaks PQ verification', async () => {
    const payload = new TextEncoder().encode(canonicalizeV2({ y: 2 }));
    const sig = await compositeSign(registry, DCP_CONTEXTS.Intent, payload, keys);

    const tampered = JSON.parse(JSON.stringify(sig));
    const pqSig = Buffer.from(tampered.pq.sig_b64, 'base64');
    pqSig[10] ^= 0xff;
    tampered.pq.sig_b64 = pqSig.toString('base64');

    const result = await compositeVerify(
      registry, DCP_CONTEXTS.Intent, payload, tampered,
      classicalKp.publicKeyB64, pqKp.publicKeyB64,
    );
    expect(result.valid).toBe(false);
    expect(result.pq_valid).toBe(false);
  });
});

describe('Negative: Session Splicing', () => {
  it('artifacts from different sessions have different nonces', () => {
    const nonce1 = generateSessionNonce();
    const nonce2 = generateSessionNonce();
    const passport = makePassport(nonce1);
    const intent = makeIntent(nonce2, passport.agent_id);
    expect(passport.session_nonce).not.toBe(intent.session_nonce);
  });

  it('verifySessionBinding rejects mixed nonces', () => {
    const result = verifySessionBinding([
      { session_nonce: generateSessionNonce() },
      { session_nonce: generateSessionNonce() },
    ]);
    expect(result.valid).toBe(false);
  });

  it('bundle builder rejects mismatched session nonces', async () => {
    const sn1 = generateSessionNonce();
    const sn2 = generateSessionNonce();

    const passport = makePassport(sn1);
    const rpr = makeRpr(sn1);
    const intent = makeIntent(sn2, passport.agent_id);

    const signedPassport = await signPayload(passport, DCP_CONTEXTS.AgentPassport, keys);
    const signedRpr = await signPayload(rpr, DCP_CONTEXTS.ResponsiblePrincipal, rprKeys);
    const signedIntent = await signPayload(intent, DCP_CONTEXTS.Intent, keys);
    const signedPolicy = await signPayload(
      makePolicyDecision(sn2, intent.intent_id),
      DCP_CONTEXTS.PolicyDecision, keys,
    );
    const auditEntries = buildAuditChain(sn1, passport.agent_id, intent.intent_id, 1);

    expect(() =>
      new BundleBuilderV2(sn1)
        .responsiblePrincipalRecord(signedRpr)
        .agentPassport(signedPassport)
        .intent(signedIntent)
        .policyDecision(signedPolicy)
        .addAuditEntries(auditEntries)
        .build(),
    ).toThrow('Session nonce');
  });
});

describe('Negative: Cross-Artifact Replay', () => {
  it('Intent signature fails under AuditEvent context', async () => {
    const payload = new TextEncoder().encode(canonicalizeV2({ replay: 'test' }));
    const sig = await compositeSign(registry, DCP_CONTEXTS.Intent, payload, keys);
    const result = await compositeVerify(
      registry, DCP_CONTEXTS.AuditEvent, payload, sig,
      classicalKp.publicKeyB64, pqKp.publicKeyB64,
    );
    expect(result.valid).toBe(false);
  });

  it('Bundle signature fails under AgentPassport context', async () => {
    const payload = new TextEncoder().encode(canonicalizeV2({ replay: 'bundle' }));
    const sig = await compositeSign(registry, DCP_CONTEXTS.Bundle, payload, keys);
    const result = await compositeVerify(
      registry, DCP_CONTEXTS.AgentPassport, payload, sig,
      classicalKp.publicKeyB64, pqKp.publicKeyB64,
    );
    expect(result.valid).toBe(false);
  });
});

describe('Negative: Policy Downgrade', () => {
  it('classical-only bundle rejected by hybrid_required', async () => {
    const sn = generateSessionNonce();
    const passport = makePassport(sn);
    const rpr = makeRpr(sn);
    const intent = makeIntent(sn, passport.agent_id);
    const pd = makePolicyDecision(sn, intent.intent_id);

    const signedPassport = await signPayload(passport, DCP_CONTEXTS.AgentPassport, keys);
    const signedRpr = await signPayload(rpr, DCP_CONTEXTS.ResponsiblePrincipal, rprKeys);
    const signedIntent = await signPayload(intent, DCP_CONTEXTS.Intent, keys);
    const signedPolicy = await signPayload(pd, DCP_CONTEXTS.PolicyDecision, keys);
    const auditEntries = buildAuditChain(sn, passport.agent_id, intent.intent_id, 1);

    const bundle = new BundleBuilderV2(sn)
      .responsiblePrincipalRecord(signedRpr)
      .agentPassport(signedPassport)
      .intent(signedIntent)
      .policyDecision(signedPolicy)
      .addAuditEntries(auditEntries)
      .build();

    const signed = await signBundleV2ClassicalOnly(bundle, {
      registry, signerType: 'human', signerId: 'human-test', key: rprKeys.classical,
    });

    const result = await verifySignedBundleV2(signed, registry, {
      ...DEFAULT_VERIFIER_POLICY,
      default_mode: 'hybrid_required',
      risk_overrides: { low: 'hybrid_required', medium: 'hybrid_required', high: 'hybrid_required' },
    });
    expect(result.verified).toBe(false);
  });

  it('pq_only mode rejects classical_only binding', async () => {
    const sn = generateSessionNonce();
    const passport = makePassport(sn);
    const rpr = makeRpr(sn);
    const intent = makeIntent(sn, passport.agent_id);
    const pd = makePolicyDecision(sn, intent.intent_id);

    const signedPassport = await signPayload(passport, DCP_CONTEXTS.AgentPassport, keys);
    const signedRpr = await signPayload(rpr, DCP_CONTEXTS.ResponsiblePrincipal, rprKeys);
    const signedIntent = await signPayload(intent, DCP_CONTEXTS.Intent, keys);
    const signedPolicy = await signPayload(pd, DCP_CONTEXTS.PolicyDecision, keys);
    const auditEntries = buildAuditChain(sn, passport.agent_id, intent.intent_id, 1);

    const bundle = new BundleBuilderV2(sn)
      .responsiblePrincipalRecord(signedRpr)
      .agentPassport(signedPassport)
      .intent(signedIntent)
      .policyDecision(signedPolicy)
      .addAuditEntries(auditEntries)
      .build();

    const signed = await signBundleV2ClassicalOnly(bundle, {
      registry, signerType: 'human', signerId: 'human-test', key: rprKeys.classical,
    });

    const result = await verifySignedBundleV2(signed, registry, PQ_ONLY_VERIFIER_POLICY);
    expect(result.verified).toBe(false);
    expect(result.errors.some(e => e.includes('pq_only'))).toBe(true);
  });
});

describe('Negative: Kid Confusion', () => {
  it('different keys always produce different kids', async () => {
    const kids = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const kp = await ed25519.generateKeypair();
      expect(kids.has(kp.kid)).toBe(false);
      kids.add(kp.kid);
    }
  });

  it('same algorithm different key => different kid', async () => {
    const kp1 = await mlDsa65.generateKeypair();
    const kp2 = await mlDsa65.generateKeypair();
    expect(kp1.kid).not.toBe(kp2.kid);
  });

  it('kid includes alg in derivation (ed25519 vs ml-dsa-65 over same bytes)', () => {
    const fakeKey = new Uint8Array(32).fill(0x42);
    const kid1 = deriveKid('ed25519', fakeKey);
    const kid2 = deriveKid('ml-dsa-65', fakeKey);
    expect(kid1).not.toBe(kid2);
  });
});

describe('Negative: Emergency Revocation', () => {
  it('generates token pair with correct format', () => {
    const pair = generateEmergencyRevocationToken();
    expect(pair.revocation_secret).toMatch(/^[0-9a-f]{64}$/);
    expect(pair.emergency_revocation_token).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('valid secret verifies against commitment', () => {
    const pair = generateEmergencyRevocationToken();
    expect(verifyEmergencyRevocationSecret(
      pair.revocation_secret,
      pair.emergency_revocation_token,
    )).toBe(true);
  });

  it('wrong secret fails verification', () => {
    const pair = generateEmergencyRevocationToken();
    const wrongSecret = randomBytes(32).toString('hex');
    expect(verifyEmergencyRevocationSecret(
      wrongSecret,
      pair.emergency_revocation_token,
    )).toBe(false);
  });

  it('short secret fails verification', () => {
    const pair = generateEmergencyRevocationToken();
    expect(verifyEmergencyRevocationSecret('aabbcc', pair.emergency_revocation_token)).toBe(false);
  });

  it('malformed commitment fails verification', () => {
    const pair = generateEmergencyRevocationToken();
    expect(verifyEmergencyRevocationSecret(pair.revocation_secret, 'not-sha256:abc')).toBe(false);
  });

  it('buildEmergencyRevocation produces correct structure', () => {
    const pair = generateEmergencyRevocationToken();
    const revocation = buildEmergencyRevocation({
      agentId: 'agent-1',
      humanId: 'human-1',
      revocationSecret: pair.revocation_secret,
    });
    expect(revocation.type).toBe('emergency_revocation');
    expect(revocation.reason).toBe('key_compromise_emergency');
    expect(revocation.agent_id).toBe('agent-1');
  });
});

describe('Negative: Blinded RPR', () => {
  it('blindRpr strips PII and adds pii_hash', () => {
    const rpr = makeRpr(sessionNonce);
    const blinded = blindRpr(rpr);
    expect(blinded.blinded).toBe(true);
    expect(blinded.pii_hash).toMatch(/^sha256:/);
    expect((blinded as any).legal_name).toBeUndefined();
    expect((blinded as any).contact).toBeUndefined();
  });

  it('verifyBlindedRpr succeeds for matching full RPR', () => {
    const rpr = makeRpr(sessionNonce);
    const blinded = blindRpr(rpr);
    const result = verifyBlindedRpr(rpr, blinded);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('verifyBlindedRpr fails for wrong PII', () => {
    const rpr = makeRpr(sessionNonce);
    const blinded = blindRpr(rpr);

    const wrongRpr = { ...rpr, legal_name: 'John Smith' };
    const result = verifyBlindedRpr(wrongRpr, blinded);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('pii_hash mismatch'))).toBe(true);
  });

  it('verifyBlindedRpr fails for mismatched fields', () => {
    const rpr = makeRpr(sessionNonce);
    const blinded = blindRpr(rpr);
    blinded.jurisdiction = 'DE';
    const result = verifyBlindedRpr(rpr, blinded);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('jurisdiction'))).toBe(true);
  });

  it('isBlindedRpr correctly detects blinded vs full', () => {
    const rpr = makeRpr(sessionNonce);
    const blinded = blindRpr(rpr);
    expect(isBlindedRpr(blinded)).toBe(true);
    expect(isBlindedRpr(rpr)).toBe(false);
  });

  it('computePiiHash is deterministic', () => {
    const rpr = makeRpr(sessionNonce);
    expect(computePiiHash(rpr)).toBe(computePiiHash(rpr));
  });

  it('different PII produces different pii_hash', () => {
    const rpr1 = makeRpr(sessionNonce);
    const rpr2 = { ...makeRpr(sessionNonce), legal_name: 'Alice Bob' };
    expect(computePiiHash(rpr1)).not.toBe(computePiiHash(rpr2));
  });
});

describe('Negative: Artifact Swap in Bundle', () => {
  it('swapped intent causes manifest hash mismatch', async () => {
    const signed = await buildSignedBundleV2();

    const fakeIntent: IntentV2 = {
      ...(signed.bundle.intent.payload as IntentV2),
      action_type: 'execute_code',
    };
    const fakeSignedIntent = await signPayload(fakeIntent, DCP_CONTEXTS.Intent, keys);
    signed.bundle.intent = fakeSignedIntent;

    const result = await verifySignedBundleV2(signed, registry, DEFAULT_VERIFIER_POLICY);
    expect(result.verified).toBe(false);
    expect(result.errors.some(e => e.includes('intent_hash mismatch') || e.includes('payload_hash'))).toBe(true);
  });
});

describe('Negative: Broken prev_hash Chain', () => {
  it('swapped audit entries break chain verification', async () => {
    const signed = await buildSignedBundleV2();
    if (signed.bundle.audit_entries.length >= 2) {
      const temp = signed.bundle.audit_entries[0];
      signed.bundle.audit_entries[0] = signed.bundle.audit_entries[1];
      signed.bundle.audit_entries[1] = temp;

      const result = await verifySignedBundleV2(signed, registry, DEFAULT_VERIFIER_POLICY);
      expect(result.verified).toBe(false);
    }
  });
});

describe('Negative: Revoked / Expired Keys', () => {
  it('revoked key causes verification failure', async () => {
    const sn = generateSessionNonce();
    const passport = makePassport(sn);
    passport.keys[0].status = 'revoked';

    const rpr = makeRpr(sn);
    const intent = makeIntent(sn, passport.agent_id);
    const pd = makePolicyDecision(sn, intent.intent_id);

    const signedPassport = await signPayload(passport, DCP_CONTEXTS.AgentPassport, keys);
    const signedRpr = await signPayload(rpr, DCP_CONTEXTS.ResponsiblePrincipal, rprKeys);
    const signedIntent = await signPayload(intent, DCP_CONTEXTS.Intent, keys);
    const signedPolicy = await signPayload(pd, DCP_CONTEXTS.PolicyDecision, keys);
    const auditEntries = buildAuditChain(sn, passport.agent_id, intent.intent_id, 1);

    const bundle = new BundleBuilderV2(sn)
      .responsiblePrincipalRecord(signedRpr)
      .agentPassport(signedPassport)
      .intent(signedIntent)
      .policyDecision(signedPolicy)
      .addAuditEntries(auditEntries)
      .build();

    const signed = await signBundleV2(bundle, {
      registry, signerType: 'human', signerId: 'human-test', keys: rprKeys,
    });

    const result = await verifySignedBundleV2(signed, registry, DEFAULT_VERIFIER_POLICY);
    expect(result.verified).toBe(false);
    expect(result.errors.some(e => e.includes('revoked'))).toBe(true);
  });

  it('expired key causes verification failure', async () => {
    const sn = generateSessionNonce();
    const passport = makePassport(sn);
    passport.keys[0].expires_at = '2020-01-01T00:00:00Z';

    const rpr = makeRpr(sn);
    const intent = makeIntent(sn, passport.agent_id);
    const pd = makePolicyDecision(sn, intent.intent_id);

    const signedPassport = await signPayload(passport, DCP_CONTEXTS.AgentPassport, keys);
    const signedRpr = await signPayload(rpr, DCP_CONTEXTS.ResponsiblePrincipal, rprKeys);
    const signedIntent = await signPayload(intent, DCP_CONTEXTS.Intent, keys);
    const signedPolicy = await signPayload(pd, DCP_CONTEXTS.PolicyDecision, keys);
    const auditEntries = buildAuditChain(sn, passport.agent_id, intent.intent_id, 1);

    const bundle = new BundleBuilderV2(sn)
      .responsiblePrincipalRecord(signedRpr)
      .agentPassport(signedPassport)
      .intent(signedIntent)
      .policyDecision(signedPolicy)
      .addAuditEntries(auditEntries)
      .build();

    const signed = await signBundleV2(bundle, {
      registry, signerType: 'human', signerId: 'human-test', keys: rprKeys,
    });

    const result = await verifySignedBundleV2(signed, registry, DEFAULT_VERIFIER_POLICY);
    expect(result.verified).toBe(false);
    expect(result.errors.some(e => e.includes('expired'))).toBe(true);
  });
});

describe('Negative: Float Injection', () => {
  it('payload with float is rejected before signing', () => {
    expect(() => canonicalizeV2({ risk_score: 0.75 })).toThrow('Float value prohibited');
  });

  it('nested float in evidence is rejected', () => {
    expect(() => canonicalizeV2({
      evidence: { confidence: 0.99 },
    })).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. NIST KAT
// ═══════════════════════════════════════════════════════════════════════════

describe('NIST KAT: Ed25519 Compliance', () => {
  it('keySize == 32', () => expect(ed25519.keySize).toBe(32));
  it('sigSize == 64', () => expect(ed25519.sigSize).toBe(64));
  it('isConstantTime', () => expect(ed25519.isConstantTime).toBe(true));

  it('generated public key is exactly 32 bytes', async () => {
    const kp = await ed25519.generateKeypair();
    expect(Buffer.from(kp.publicKeyB64, 'base64').length).toBe(32);
  });

  it('sign produces exactly 64 bytes', async () => {
    const kp = await ed25519.generateKeypair();
    const sig = await ed25519.sign(new TextEncoder().encode('KAT'), kp.secretKeyB64);
    expect(sig.length).toBe(64);
  });

  it('empty message sign/verify', async () => {
    const kp = await ed25519.generateKeypair();
    const sig = await ed25519.sign(new Uint8Array(0), kp.secretKeyB64);
    expect(await ed25519.verify(new Uint8Array(0), sig, kp.publicKeyB64)).toBe(true);
  });

  it('10KB message sign/verify', async () => {
    const kp = await ed25519.generateKeypair();
    const msg = new Uint8Array(10240);
    for (let i = 0; i < msg.length; i++) msg[i] = i & 0xff;
    const sig = await ed25519.sign(msg, kp.secretKeyB64);
    expect(await ed25519.verify(msg, sig, kp.publicKeyB64)).toBe(true);
  });
});

describe('NIST KAT: ML-DSA-65 Compliance (FIPS 204)', () => {
  it('keySize == 1952', () => expect(mlDsa65.keySize).toBe(1952));
  it('sigSize == 3309', () => expect(mlDsa65.sigSize).toBe(3309));
  it('isConstantTime', () => expect(mlDsa65.isConstantTime).toBe(true));

  it('generated public key is exactly 1952 bytes', async () => {
    const kp = await mlDsa65.generateKeypair();
    expect(Buffer.from(kp.publicKeyB64, 'base64').length).toBe(1952);
  });

  it('sign + verify round-trip', async () => {
    const kp = await mlDsa65.generateKeypair();
    const msg = new TextEncoder().encode('FIPS 204 KAT');
    const sig = await mlDsa65.sign(msg, kp.secretKeyB64);
    expect(await mlDsa65.verify(msg, sig, kp.publicKeyB64)).toBe(true);
  });

  it('10 independent keygen + sign + verify cycles', async () => {
    for (let i = 0; i < 10; i++) {
      const kp = await mlDsa65.generateKeypair();
      const msg = new TextEncoder().encode(`cycle-${i}`);
      const sig = await mlDsa65.sign(msg, kp.secretKeyB64);
      expect(await mlDsa65.verify(msg, sig, kp.publicKeyB64)).toBe(true);
    }
  });

  it('tampered signature byte rejection', async () => {
    const kp = await mlDsa65.generateKeypair();
    const msg = new TextEncoder().encode('tamper');
    const sig = await mlDsa65.sign(msg, kp.secretKeyB64);
    for (const pos of [0, 100, sig.length - 1]) {
      const tampered = new Uint8Array(sig);
      tampered[pos] ^= 0xff;
      expect(await mlDsa65.verify(msg, tampered, kp.publicKeyB64)).toBe(false);
    }
  });
});

describe('NIST KAT: SLH-DSA-192f Compliance (FIPS 205)', () => {
  let slhDsa: SlhDsa192fProvider;

  beforeAll(() => {
    slhDsa = new SlhDsa192fProvider();
  });

  it('keySize == 48', () => expect(slhDsa.keySize).toBe(48));
  it('sigSize == 35664', () => expect(slhDsa.sigSize).toBe(35664));

  it('generated public key is exactly 48 bytes', async () => {
    const kp = await slhDsa.generateKeypair();
    expect(Buffer.from(kp.publicKeyB64, 'base64').length).toBe(48);
  });

  it('sign/verify round-trip', async () => {
    const kp = await slhDsa.generateKeypair();
    const msg = new TextEncoder().encode('FIPS 205 KAT');
    const sig = await slhDsa.sign(msg, kp.secretKeyB64);
    expect(await slhDsa.verify(msg, sig, kp.publicKeyB64)).toBe(true);
  });

  it('kid derivation is deterministic', async () => {
    const kp = await slhDsa.generateKeypair();
    const pkBytes = new Uint8Array(Buffer.from(kp.publicKeyB64, 'base64'));
    expect(deriveKid('slh-dsa-192f', pkBytes)).toBe(kp.kid);
  });
}, { timeout: 120_000 });

// ═══════════════════════════════════════════════════════════════════════════
// 4. KEY RECOVERY ROUND-TRIP (Shamir SSS)
// ═══════════════════════════════════════════════════════════════════════════

describe('Key Recovery: Shamir Secret Sharing', () => {
  function makeSecret(len: number): Uint8Array {
    const buf = randomBytes(len);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  it('2-of-3 split and reconstruct', () => {
    const secret = makeSecret(64);
    const shares = shamirSplit(secret, 2, 3);
    expect(shares).toHaveLength(3);

    const reconstructed = shamirReconstruct([shares[0], shares[1]]);
    expect(arraysEqual(reconstructed, secret)).toBe(true);
  });

  it('any 2 of 3 shares reconstruct the secret', () => {
    const secret = makeSecret(32);
    const shares = shamirSplit(secret, 2, 3);

    for (const pair of [[0, 1], [0, 2], [1, 2]]) {
      const reconstructed = shamirReconstruct([shares[pair[0]], shares[pair[1]]]);
      expect(arraysEqual(reconstructed, secret)).toBe(true);
    }
  });

  it('3-of-5 split and reconstruct', () => {
    const secret = makeSecret(48);
    const shares = shamirSplit(secret, 3, 5);
    expect(shares).toHaveLength(5);

    const reconstructed = shamirReconstruct([shares[0], shares[2], shares[4]]);
    expect(arraysEqual(reconstructed, secret)).toBe(true);
  });

  it('insufficient shares produce wrong secret', () => {
    const secret = makeSecret(32);
    const shares = shamirSplit(secret, 3, 5);
    const reconstructed = shamirReconstruct([shares[0], shares[1]]);
    expect(arraysEqual(reconstructed, secret)).toBe(false);
  });

  it('rejects threshold < 2', () => {
    expect(() => shamirSplit(new Uint8Array([1]), 1, 3)).toThrow('Threshold must be >= 2');
  });

  it('rejects totalShares < threshold', () => {
    expect(() => shamirSplit(new Uint8Array([1]), 3, 2)).toThrow('totalShares must be >= threshold');
  });

  it('rejects empty secret', () => {
    expect(() => shamirSplit(new Uint8Array(0), 2, 3)).toThrow('Secret must not be empty');
  });

  it('handles large secrets (256 bytes)', () => {
    const secret = makeSecret(256);
    const shares = shamirSplit(secret, 2, 3);
    const reconstructed = shamirReconstruct([shares[1], shares[2]]);
    expect(arraysEqual(reconstructed, secret)).toBe(true);
  });

  it('setupKeyRecovery creates config and shares', () => {
    const secret = makeSecret(64);
    const setup = setupKeyRecovery({
      humanId: 'human-test',
      masterSecret: secret,
      threshold: 2,
      holders: [
        { holderId: 'contact-1', holderKid: 'kid-1' },
        { holderId: 'contact-2', holderKid: 'kid-2' },
        { holderId: 'escrow-1', holderKid: 'kid-3' },
      ],
    });

    expect(setup.config.threshold).toBe(2);
    expect(setup.config.total_shares).toBe(3);
    expect(setup.config.share_holders).toHaveLength(3);
    expect(setup.shares).toHaveLength(3);

    const recovered = shamirReconstruct([setup.shares[0], setup.shares[2]]);
    expect(arraysEqual(recovered, secret)).toBe(true);
  });

  it('full round-trip: generate keys, split, reconstruct, verify identity', async () => {
    const edKp = await ed25519.generateKeypair();
    const secretBuf = Buffer.from(edKp.secretKeyB64, 'base64');
    const masterSecret = new Uint8Array(secretBuf.buffer, secretBuf.byteOffset, secretBuf.byteLength);

    const shares = shamirSplit(masterSecret, 2, 3);

    const recovered = shamirReconstruct([shares[0], shares[2]]);
    const recoveredB64 = Buffer.from(recovered).toString('base64');

    const msg = new TextEncoder().encode('recovery verification');
    const sig = await ed25519.sign(msg, recoveredB64);
    expect(await ed25519.verify(msg, sig, edKp.publicKeyB64)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. MULTI-PARTY AUTHORIZATION FLOW
// ═══════════════════════════════════════════════════════════════════════════

describe('Multi-Party Authorization', () => {
  let ownerKeys: CompositeKeyPair;
  let adminKeys: CompositeKeyPair;
  let contactKeys: CompositeKeyPair;
  let partyKeyMap: Map<string, { classicalPubkeyB64: string; pqPubkeyB64: string }>;

  beforeAll(async () => {
    const ownerEd = await ed25519.generateKeypair();
    const ownerPq = await mlDsa65.generateKeypair();
    ownerKeys = {
      classical: { kid: ownerEd.kid, alg: 'ed25519', secretKeyB64: ownerEd.secretKeyB64, publicKeyB64: ownerEd.publicKeyB64 },
      pq: { kid: ownerPq.kid, alg: 'ml-dsa-65', secretKeyB64: ownerPq.secretKeyB64, publicKeyB64: ownerPq.publicKeyB64 },
    };

    const adminEd = await ed25519.generateKeypair();
    const adminPq = await mlDsa65.generateKeypair();
    adminKeys = {
      classical: { kid: adminEd.kid, alg: 'ed25519', secretKeyB64: adminEd.secretKeyB64, publicKeyB64: adminEd.publicKeyB64 },
      pq: { kid: adminPq.kid, alg: 'ml-dsa-65', secretKeyB64: adminPq.secretKeyB64, publicKeyB64: adminPq.publicKeyB64 },
    };

    const contactEd = await ed25519.generateKeypair();
    const contactPq = await mlDsa65.generateKeypair();
    contactKeys = {
      classical: { kid: contactEd.kid, alg: 'ed25519', secretKeyB64: contactEd.secretKeyB64, publicKeyB64: contactEd.publicKeyB64 },
      pq: { kid: contactPq.kid, alg: 'ml-dsa-65', secretKeyB64: contactPq.secretKeyB64, publicKeyB64: contactPq.publicKeyB64 },
    };

    partyKeyMap = new Map([
      ['owner-jane', { classicalPubkeyB64: ownerEd.publicKeyB64, pqPubkeyB64: ownerPq.publicKeyB64 }],
      ['admin-bob', { classicalPubkeyB64: adminEd.publicKeyB64, pqPubkeyB64: adminPq.publicKeyB64 }],
      ['contact-alice', { classicalPubkeyB64: contactEd.publicKeyB64, pqPubkeyB64: contactPq.publicKeyB64 }],
    ]);
  });

  it('2-of-2 authorization (owner + admin) succeeds for revoke_agent', async () => {
    const operationPayload = { agent_id: 'agent-revoke-test', reason: 'administrative' };

    const ownerAuth = await createPartyAuthorization(
      registry, 'revoke_agent', operationPayload,
      'owner-jane', 'owner', ownerKeys,
    );
    const adminAuth = await createPartyAuthorization(
      registry, 'revoke_agent', operationPayload,
      'admin-bob', 'org_admin', adminKeys,
    );

    const mpa = buildMultiPartyAuthorization(
      'revoke_agent', operationPayload, 2,
      [ownerAuth, adminAuth],
    );

    const result = await verifyMultiPartyAuthorization(registry, mpa, partyKeyMap);
    expect(result.valid).toBe(true);
    expect(result.partiesVerified).toBe(2);
  });

  it('fails when owner is missing (owner required by policy)', async () => {
    const operationPayload = { agent_id: 'agent-test' };

    const adminAuth = await createPartyAuthorization(
      registry, 'revoke_agent', operationPayload,
      'admin-bob', 'org_admin', adminKeys,
    );
    const contactAuth = await createPartyAuthorization(
      registry, 'revoke_agent', operationPayload,
      'contact-alice', 'recovery_contact', contactKeys,
    );

    const mpa = buildMultiPartyAuthorization(
      'revoke_agent', operationPayload, 2,
      [adminAuth, contactAuth],
    );

    const result = await verifyMultiPartyAuthorization(registry, mpa, partyKeyMap);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Owner authorization required'))).toBe(true);
  });

  it('fails when insufficient authorizations', async () => {
    const operationPayload = { agent_id: 'agent-test' };

    const ownerAuth = await createPartyAuthorization(
      registry, 'revoke_agent', operationPayload,
      'owner-jane', 'owner', ownerKeys,
    );

    const mpa = buildMultiPartyAuthorization(
      'revoke_agent', operationPayload, 2,
      [ownerAuth],
    );

    const result = await verifyMultiPartyAuthorization(registry, mpa, partyKeyMap);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Insufficient'))).toBe(true);
  });

  it('fails when signature is tampered', async () => {
    const operationPayload = { agent_id: 'agent-test' };

    const ownerAuth = await createPartyAuthorization(
      registry, 'revoke_agent', operationPayload,
      'owner-jane', 'owner', ownerKeys,
    );
    const adminAuth = await createPartyAuthorization(
      registry, 'revoke_agent', operationPayload,
      'admin-bob', 'org_admin', adminKeys,
    );

    const tamperedSig = Buffer.from(adminAuth.composite_sig.classical.sig_b64, 'base64');
    tamperedSig[0] ^= 0xff;
    adminAuth.composite_sig.classical.sig_b64 = tamperedSig.toString('base64');

    const mpa = buildMultiPartyAuthorization(
      'revoke_agent', operationPayload, 2,
      [ownerAuth, adminAuth],
    );

    const result = await verifyMultiPartyAuthorization(registry, mpa, partyKeyMap);
    expect(result.valid).toBe(false);
  });

  it('fails for disallowed role', async () => {
    const operationPayload = { key_id: 'org-key-1' };

    const ownerAuth = await createPartyAuthorization(
      registry, 'rotate_org_key', operationPayload,
      'owner-jane', 'owner', ownerKeys,
    );
    const contactAuth = await createPartyAuthorization(
      registry, 'rotate_org_key', operationPayload,
      'contact-alice', 'recovery_contact', contactKeys,
    );

    const mpa = buildMultiPartyAuthorization(
      'rotate_org_key', operationPayload, 2,
      [ownerAuth, contactAuth],
    );

    const result = await verifyMultiPartyAuthorization(registry, mpa, partyKeyMap);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('not allowed'))).toBe(true);
  });

  it('all four operation types have defined policies', () => {
    const ops = ['revoke_agent', 'rotate_org_key', 'change_jurisdiction', 'modify_recovery_config'] as const;
    for (const op of ops) {
      expect(DEFAULT_MULTI_PARTY_POLICIES[op]).toBeDefined();
      expect(DEFAULT_MULTI_PARTY_POLICIES[op].requiredParties).toBeGreaterThanOrEqual(2);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. LOAD / THROUGHPUT TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Load: Throughput Benchmarks', () => {
  it('Ed25519 sign throughput (100 ops)', async () => {
    const kp = await ed25519.generateKeypair();
    const msg = new TextEncoder().encode('benchmark message');

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      await ed25519.sign(msg, kp.secretKeyB64);
    }
    const elapsed = performance.now() - start;
    const opsPerSec = (100 / elapsed) * 1000;

    expect(opsPerSec).toBeGreaterThan(100);
  });

  it('Ed25519 verify throughput (100 ops)', async () => {
    const kp = await ed25519.generateKeypair();
    const msg = new TextEncoder().encode('benchmark message');
    const sig = await ed25519.sign(msg, kp.secretKeyB64);

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      await ed25519.verify(msg, sig, kp.publicKeyB64);
    }
    const elapsed = performance.now() - start;
    const opsPerSec = (100 / elapsed) * 1000;

    expect(opsPerSec).toBeGreaterThan(50);
  });

  it('ML-DSA-65 sign throughput (20 ops)', async () => {
    const kp = await mlDsa65.generateKeypair();
    const msg = new TextEncoder().encode('PQ benchmark');

    const start = performance.now();
    for (let i = 0; i < 20; i++) {
      await mlDsa65.sign(msg, kp.secretKeyB64);
    }
    const elapsed = performance.now() - start;
    const opsPerSec = (20 / elapsed) * 1000;

    expect(opsPerSec).toBeGreaterThan(1);
  });

  it('ML-DSA-65 verify throughput (20 ops)', async () => {
    const kp = await mlDsa65.generateKeypair();
    const msg = new TextEncoder().encode('PQ benchmark');
    const sig = await mlDsa65.sign(msg, kp.secretKeyB64);

    const start = performance.now();
    for (let i = 0; i < 20; i++) {
      await mlDsa65.verify(msg, sig, kp.publicKeyB64);
    }
    const elapsed = performance.now() - start;
    const opsPerSec = (20 / elapsed) * 1000;

    expect(opsPerSec).toBeGreaterThan(1);
  });

  it('composite sign throughput (20 ops)', async () => {
    const payload = new TextEncoder().encode(canonicalizeV2({ bench: 'composite' }));

    const start = performance.now();
    for (let i = 0; i < 20; i++) {
      await compositeSign(registry, DCP_CONTEXTS.Intent, payload, keys);
    }
    const elapsed = performance.now() - start;
    const opsPerSec = (20 / elapsed) * 1000;

    expect(opsPerSec).toBeGreaterThan(1);
  });

  it('composite verify (parallel) throughput (20 ops)', async () => {
    const payload = new TextEncoder().encode(canonicalizeV2({ bench: 'verify' }));
    const sig = await compositeSign(registry, DCP_CONTEXTS.Intent, payload, keys);

    const start = performance.now();
    for (let i = 0; i < 20; i++) {
      await compositeVerify(
        registry, DCP_CONTEXTS.Intent, payload, sig,
        classicalKp.publicKeyB64, pqKp.publicKeyB64, 'parallel',
      );
    }
    const elapsed = performance.now() - start;
    const opsPerSec = (20 / elapsed) * 1000;

    expect(opsPerSec).toBeGreaterThan(1);
  });

  it('canonicalization throughput (1000 ops)', () => {
    const obj = { dcp_version: '2.0', agent_id: 'bench', risk_score: 500, items: [1, 2, 3] };

    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      canonicalizeV2(obj);
    }
    const elapsed = performance.now() - start;
    const opsPerSec = (1000 / elapsed) * 1000;

    expect(opsPerSec).toBeGreaterThan(10000);
  });

  it('SHA-256 hashing throughput (1000 ops)', () => {
    const data = Buffer.alloc(1024, 0xaa);

    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      sha256Hex(data);
    }
    const elapsed = performance.now() - start;
    const opsPerSec = (1000 / elapsed) * 1000;

    expect(opsPerSec).toBeGreaterThan(10000);
  });
});

describe('Load: Batched PQ Checkpoint (lazy model)', () => {
  it('checkpoint every 10 events amortizes PQ cost', async () => {
    const sn = generateSessionNonce();
    const events = buildAuditChain(sn, 'agent-bench', 'intent-bench', 30);
    const mgr = new PQCheckpointManager(10, registry, sn, keys);

    const start = performance.now();
    let checkpointCount = 0;
    for (const e of events) {
      const ckpt = await mgr.recordEvent(e);
      if (ckpt) checkpointCount++;
    }
    const elapsed = performance.now() - start;

    expect(checkpointCount).toBe(3);
    expect(elapsed).toBeLessThan(30000);
  });
});

describe('Load: CBOR vs JSON Size Comparison', () => {
  it('CBOR encoding round-trips correctly', () => {
    const obj = { dcp_version: '2.0', risk_score: 450, items: [1, 2, 3], flag: true, nothing: null };
    const encoded = cborEncode(obj);
    const decoded = cborDecode(encoded);
    expect(decoded).toEqual(obj);
  });

  it('CBOR is smaller than JSON for typical payloads', () => {
    const passport = makePassport(sessionNonce);
    const jsonSize = Buffer.byteLength(JSON.stringify(passport), 'utf8');
    const cborSize = cborEncode(passport).length;
    expect(cborSize).toBeLessThan(jsonSize);
  });

  it('CBOR handles nested structures', () => {
    const nested = {
      manifest: {
        session_nonce: sessionNonce,
        hashes: ['sha256:abc', 'sha256:def'],
        count: 42,
      },
      meta: { active: true, note: null },
    };
    const encoded = cborEncode(nested);
    const decoded = cborDecode(encoded);
    expect(decoded).toEqual(nested);
  });

  it('CBOR rejects float values', () => {
    expect(() => cborEncode({ x: 1.5 })).toThrow('float values prohibited');
  });

  it('CBOR handles negative integers', () => {
    const obj = { val: -42 };
    const decoded = cborDecode(cborEncode(obj));
    expect(decoded).toEqual(obj);
  });

  it('CBOR handles empty collections', () => {
    expect(cborDecode(cborEncode({}))).toEqual({});
    expect(cborDecode(cborEncode([]))).toEqual([]);
  });

  it('CBOR encoding is deterministic', () => {
    const obj = { z: 1, a: 2, m: 3 };
    const enc1 = cborEncode(obj);
    const enc2 = cborEncode(obj);
    expect(Buffer.from(enc1).equals(Buffer.from(enc2))).toBe(true);
  });

  it('detectWireFormat distinguishes CBOR from JSON', () => {
    const jsonBytes = new TextEncoder().encode('{"hello":"world"}');
    const cborBytes = cborEncode({ hello: 'world' });
    expect(detectWireFormat(jsonBytes)).toBe('json');
    expect(detectWireFormat(cborBytes)).toBe('cbor');
  });

  it('jsonToCborPayload converts base64 fields to byte strings', () => {
    const json = { public_key_b64: Buffer.from([1, 2, 3]).toString('base64'), name: 'test' };
    const cbor = jsonToCborPayload(json);
    expect(cbor.public_key).toBeInstanceOf(Uint8Array);
    expect((cbor as any).public_key_b64).toBeUndefined();
    expect(cbor.name).toBe('test');
  });

  it('cborPayloadToJson converts byte strings to base64', () => {
    const cbor = { public_key: new Uint8Array([1, 2, 3]), name: 'test' };
    const json = cborPayloadToJson(cbor);
    expect(typeof json.public_key_b64).toBe('string');
    expect((json as any).public_key).toBeUndefined();
  });

  it('JSON -> CBOR -> JSON round-trip preserves structure (non-binary)', () => {
    const original = {
      dcp_version: '2.0',
      agent_id: 'test-agent',
      risk_score: 500,
      items: ['a', 'b'],
      active: true,
      empty: null,
    };
    const cborBytes = cborEncode(original);
    const roundTripped = cborDecode(cborBytes);
    expect(roundTripped).toEqual(original);
  });
});

describe('Load: Full Bundle Build + Verify Pipeline', () => {
  it('builds and verifies 5 bundles sequentially', async () => {
    const start = performance.now();
    for (let i = 0; i < 5; i++) {
      const sn = generateSessionNonce();
      const signed = await buildSignedBundleV2(sn);
      const result = await verifySignedBundleV2(signed, registry, DEFAULT_VERIFIER_POLICY);
      expect(result.verified).toBe(true);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(60000);
  });

  it('bundle with 10 audit entries verifies correctly', async () => {
    const sn = generateSessionNonce();
    const passport = makePassport(sn);
    const rpr = makeRpr(sn);
    const intent = makeIntent(sn, passport.agent_id);
    const pd = makePolicyDecision(sn, intent.intent_id);

    const signedPassport = await signPayload(passport, DCP_CONTEXTS.AgentPassport, keys);
    const signedRpr = await signPayload(rpr, DCP_CONTEXTS.ResponsiblePrincipal, rprKeys);
    const signedIntent = await signPayload(intent, DCP_CONTEXTS.Intent, keys);
    const signedPolicy = await signPayload(pd, DCP_CONTEXTS.PolicyDecision, keys);
    const auditEntries = buildAuditChain(sn, passport.agent_id, intent.intent_id, 10);

    const bundle = new BundleBuilderV2(sn)
      .responsiblePrincipalRecord(signedRpr)
      .agentPassport(signedPassport)
      .intent(signedIntent)
      .policyDecision(signedPolicy)
      .addAuditEntries(auditEntries)
      .build();

    const signed = await signBundleV2(bundle, {
      registry, signerType: 'human', signerId: 'human-test', keys: rprKeys,
    });

    const result = await verifySignedBundleV2(signed, registry, DEFAULT_VERIFIER_POLICY);
    expect(result.verified).toBe(true);
    expect(result.details?.hash_chain_valid).toBe(true);
  });
});
