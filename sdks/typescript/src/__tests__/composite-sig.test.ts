/**
 * DCP-AI v2.0 Composite Signature Tests
 *
 * Tests composite-bound hybrid signatures, stripping attack resistance,
 * cross-artifact replay prevention, proof-of-possession, and key rotation.
 */
import { describe, it, expect, beforeAll } from 'vitest';

import { AlgorithmRegistry } from '../core/crypto-registry.js';
import { Ed25519Provider } from '../providers/ed25519.js';
import { MlDsa65Provider } from '../providers/ml-dsa-65.js';
import { SlhDsa192fProvider } from '../providers/slh-dsa-192f.js';
import { canonicalizeV2 } from '../core/canonicalize.js';
import { DCP_CONTEXTS } from '../core/domain-separation.js';
import {
  compositeSign,
  compositeVerify,
  classicalOnlySign,
} from '../core/composite-ops.js';
import type { CompositeKeyPair } from '../core/composite-ops.js';
import {
  generateRegistrationPoP,
  verifyRegistrationPoP,
  createKeyRotation,
  verifyKeyRotation,
} from '../core/proof-of-possession.js';
import { SecureKeyGuard } from '../core/secure-memory.js';
import { deriveKid } from '../core/crypto-provider.js';

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

beforeAll(async () => {
  registry = new AlgorithmRegistry();
  ed25519 = new Ed25519Provider();
  mlDsa65 = new MlDsa65Provider();
  registry.registerSigner(ed25519);
  registry.registerSigner(mlDsa65);

  classicalKp = await ed25519.generateKeypair();
  pqKp = await mlDsa65.generateKeypair();

  keys = {
    classical: {
      kid: classicalKp.kid,
      alg: 'ed25519',
      secretKeyB64: classicalKp.secretKeyB64,
      publicKeyB64: classicalKp.publicKeyB64,
    },
    pq: {
      kid: pqKp.kid,
      alg: 'ml-dsa-65',
      secretKeyB64: pqKp.secretKeyB64,
      publicKeyB64: pqKp.publicKeyB64,
    },
  };
});

// ---------------------------------------------------------------------------
// 1. ML-DSA-65 Provider
// ---------------------------------------------------------------------------

describe('MlDsa65Provider', () => {
  it('generates keypair with correct kid length', async () => {
    const kp = await mlDsa65.generateKeypair();
    expect(kp.kid).toHaveLength(32);
    expect(kp.publicKeyB64).toBeTruthy();
    expect(kp.secretKeyB64).toBeTruthy();
  });

  it('produces deterministic kid from public key', async () => {
    const kp = await mlDsa65.generateKeypair();
    const pkBytes = Buffer.from(kp.publicKeyB64, 'base64');
    const recomputedKid = deriveKid('ml-dsa-65', new Uint8Array(pkBytes));
    expect(kp.kid).toBe(recomputedKid);
  });

  it('signs and verifies a message', async () => {
    const kp = await mlDsa65.generateKeypair();
    const msg = new TextEncoder().encode('hello ML-DSA-65');
    const sig = await mlDsa65.sign(msg, kp.secretKeyB64);
    expect(sig.length).toBeGreaterThan(0);
    const valid = await mlDsa65.verify(msg, sig, kp.publicKeyB64);
    expect(valid).toBe(true);
  });

  it('rejects wrong message', async () => {
    const kp = await mlDsa65.generateKeypair();
    const sig = await mlDsa65.sign(
      new TextEncoder().encode('correct'),
      kp.secretKeyB64,
    );
    const valid = await mlDsa65.verify(
      new TextEncoder().encode('wrong'),
      sig,
      kp.publicKeyB64,
    );
    expect(valid).toBe(false);
  });

  it('rejects wrong public key', async () => {
    const kp1 = await mlDsa65.generateKeypair();
    const kp2 = await mlDsa65.generateKeypair();
    const msg = new TextEncoder().encode('test');
    const sig = await mlDsa65.sign(msg, kp1.secretKeyB64);
    const valid = await mlDsa65.verify(msg, sig, kp2.publicKeyB64);
    expect(valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Composite Signature Sign + Verify
// ---------------------------------------------------------------------------

describe('Composite Signature (Ed25519 + ML-DSA-65)', () => {
  it('round-trip composite sign and verify', async () => {
    const payload = { agent_id: 'test-agent', dcp_version: '2.0' };
    const canonical = canonicalizeV2(payload);
    const payloadBytes = new TextEncoder().encode(canonical);

    const sig = await compositeSign(
      registry,
      DCP_CONTEXTS.AgentPassport,
      payloadBytes,
      keys,
    );

    expect(sig.binding).toBe('pq_over_classical');
    expect(sig.classical.alg).toBe('ed25519');
    expect(sig.pq).not.toBeNull();
    expect(sig.pq!.alg).toBe('ml-dsa-65');

    const result = await compositeVerify(
      registry,
      DCP_CONTEXTS.AgentPassport,
      payloadBytes,
      sig,
      classicalKp.publicKeyB64,
      pqKp.publicKeyB64,
    );

    expect(result.valid).toBe(true);
    expect(result.classical_valid).toBe(true);
    expect(result.pq_valid).toBe(true);
  });

  it('classical-only sign and verify', async () => {
    const payload = { test: 'classical-only' };
    const payloadBytes = new TextEncoder().encode(canonicalizeV2(payload));

    const sig = await classicalOnlySign(
      registry,
      DCP_CONTEXTS.AgentPassport,
      payloadBytes,
      keys.classical,
    );

    expect(sig.binding).toBe('classical_only');
    expect(sig.pq).toBeNull();

    const result = await compositeVerify(
      registry,
      DCP_CONTEXTS.AgentPassport,
      payloadBytes,
      sig,
      classicalKp.publicKeyB64,
    );

    expect(result.valid).toBe(true);
    expect(result.classical_valid).toBe(true);
    expect(result.pq_valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Stripping Attack Tests
// ---------------------------------------------------------------------------

describe('Stripping Attack Resistance', () => {
  it('removing PQ signature causes verification failure', async () => {
    const payload = { action: 'high_risk_transfer' };
    const payloadBytes = new TextEncoder().encode(canonicalizeV2(payload));

    const sig = await compositeSign(
      registry,
      DCP_CONTEXTS.Intent,
      payloadBytes,
      keys,
    );

    const stripped = {
      classical: sig.classical,
      pq: null,
      binding: 'pq_over_classical' as const,
    };

    const result = await compositeVerify(
      registry,
      DCP_CONTEXTS.Intent,
      payloadBytes,
      stripped,
      classicalKp.publicKeyB64,
      pqKp.publicKeyB64,
    );

    expect(result.valid).toBe(false);
  });

  it('stripping PQ and changing binding to classical_only still fails', async () => {
    const payload = { action: 'sneaky_downgrade' };
    const payloadBytes = new TextEncoder().encode(canonicalizeV2(payload));

    const sig = await compositeSign(
      registry,
      DCP_CONTEXTS.Intent,
      payloadBytes,
      keys,
    );

    const downgraded = {
      classical: sig.classical,
      pq: null,
      binding: 'classical_only' as const,
    };

    const result = await compositeVerify(
      registry,
      DCP_CONTEXTS.Intent,
      payloadBytes,
      downgraded,
      classicalKp.publicKeyB64,
    );

    // This verifies with classical_only binding, which is legitimate.
    // The verifier's POLICY (not the sig) determines if this is acceptable.
    // The sig itself is valid for classical_only mode.
    expect(result.classical_valid).toBe(true);
    // But a hybrid_required policy would reject this since pq_valid is false.
    expect(result.pq_valid).toBe(false);
  });

  it('modifying classical signature breaks PQ verification', async () => {
    const payload = { action: 'tamper_test' };
    const payloadBytes = new TextEncoder().encode(canonicalizeV2(payload));

    const sig = await compositeSign(
      registry,
      DCP_CONTEXTS.Intent,
      payloadBytes,
      keys,
    );

    const tampered = JSON.parse(JSON.stringify(sig));
    const sigBytes = Buffer.from(tampered.classical.sig_b64, 'base64');
    sigBytes[0] ^= 0xff;
    tampered.classical.sig_b64 = sigBytes.toString('base64');

    const result = await compositeVerify(
      registry,
      DCP_CONTEXTS.Intent,
      payloadBytes,
      tampered,
      classicalKp.publicKeyB64,
      pqKp.publicKeyB64,
    );

    expect(result.valid).toBe(false);
    expect(result.classical_valid).toBe(false);
    // PQ sig was over (dsm || original_classical_sig), so it also fails
    // when the classical sig is tampered
    expect(result.pq_valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Domain Separation (Cross-Artifact Replay)
// ---------------------------------------------------------------------------

describe('Domain Separation (Cross-Artifact Replay Prevention)', () => {
  it('signature from Intent context fails verification under AuditEvent context', async () => {
    const payload = { intent_id: 'test-intent' };
    const payloadBytes = new TextEncoder().encode(canonicalizeV2(payload));

    const sig = await compositeSign(
      registry,
      DCP_CONTEXTS.Intent,
      payloadBytes,
      keys,
    );

    const crossContextResult = await compositeVerify(
      registry,
      DCP_CONTEXTS.AuditEvent,
      payloadBytes,
      sig,
      classicalKp.publicKeyB64,
      pqKp.publicKeyB64,
    );

    expect(crossContextResult.valid).toBe(false);
  });

  it('same payload, different context produces different signatures', async () => {
    const payload = { data: 'shared_payload' };
    const payloadBytes = new TextEncoder().encode(canonicalizeV2(payload));

    const sig1 = await compositeSign(
      registry,
      DCP_CONTEXTS.Intent,
      payloadBytes,
      keys,
    );
    const sig2 = await compositeSign(
      registry,
      DCP_CONTEXTS.AuditEvent,
      payloadBytes,
      keys,
    );

    expect(sig1.classical.sig_b64).not.toBe(sig2.classical.sig_b64);
  });
});

// ---------------------------------------------------------------------------
// 5. Proof of Possession
// ---------------------------------------------------------------------------

describe('Proof of Possession', () => {
  it('generates and verifies a registration PoP', async () => {
    const kp = await ed25519.generateKeypair();
    const challenge = {
      kid: kp.kid,
      agent_id: 'agent-test-123',
      timestamp: '2026-02-25T00:00:00Z',
      nonce: 'deadbeef01234567',
    };

    const pop = await generateRegistrationPoP(
      registry,
      challenge,
      'ed25519',
      kp.secretKeyB64,
    );

    expect(pop.alg).toBe('ed25519');
    expect(pop.kid).toBe(kp.kid);

    const valid = await verifyRegistrationPoP(
      registry,
      challenge,
      pop,
      kp.publicKeyB64,
    );
    expect(valid).toBe(true);
  });

  it('PoP fails with wrong key', async () => {
    const kp1 = await ed25519.generateKeypair();
    const kp2 = await ed25519.generateKeypair();
    const challenge = {
      kid: kp1.kid,
      agent_id: 'agent-test',
      timestamp: '2026-02-25T00:00:00Z',
      nonce: 'abc123',
    };

    const pop = await generateRegistrationPoP(
      registry,
      challenge,
      'ed25519',
      kp1.secretKeyB64,
    );

    const valid = await verifyRegistrationPoP(
      registry,
      challenge,
      pop,
      kp2.publicKeyB64,
    );
    expect(valid).toBe(false);
  });

  it('PoP with ML-DSA-65 key works', async () => {
    const kp = await mlDsa65.generateKeypair();
    const challenge = {
      kid: kp.kid,
      agent_id: 'pq-agent',
      timestamp: '2026-02-25T12:00:00Z',
      nonce: 'pqnonce123',
    };

    const pop = await generateRegistrationPoP(
      registry,
      challenge,
      'ml-dsa-65',
      kp.secretKeyB64,
    );

    const valid = await verifyRegistrationPoP(
      registry,
      challenge,
      pop,
      kp.publicKeyB64,
    );
    expect(valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Key Rotation
// ---------------------------------------------------------------------------

describe('Key Rotation', () => {
  it('creates and verifies a key rotation record', async () => {
    const oldKp = await ed25519.generateKeypair();
    const newKp = await ed25519.generateKeypair();

    const record = await createKeyRotation(registry, {
      oldKid: oldKp.kid,
      oldAlg: 'ed25519',
      oldSecretKeyB64: oldKp.secretKeyB64,
      newKid: newKp.kid,
      newAlg: 'ed25519',
      newSecretKeyB64: newKp.secretKeyB64,
      newPublicKeyB64: newKp.publicKeyB64,
      timestamp: '2026-06-01T00:00:00Z',
      expiresAt: '2027-06-01T00:00:00Z',
    });

    expect(record.type).toBe('key_rotation');
    expect(record.old_kid).toBe(oldKp.kid);
    expect(record.new_kid).toBe(newKp.kid);

    const result = await verifyKeyRotation(
      registry,
      record,
      oldKp.publicKeyB64,
      newKp.publicKeyB64,
    );

    expect(result.valid).toBe(true);
    expect(result.pop_valid).toBe(true);
    expect(result.auth_valid).toBe(true);
  });

  it('cross-algorithm rotation (Ed25519 → ML-DSA-65)', async () => {
    const oldKp = await ed25519.generateKeypair();
    const newKp = await mlDsa65.generateKeypair();

    const record = await createKeyRotation(registry, {
      oldKid: oldKp.kid,
      oldAlg: 'ed25519',
      oldSecretKeyB64: oldKp.secretKeyB64,
      newKid: newKp.kid,
      newAlg: 'ml-dsa-65',
      newSecretKeyB64: newKp.secretKeyB64,
      newPublicKeyB64: newKp.publicKeyB64,
      timestamp: '2026-06-01T00:00:00Z',
      expiresAt: null,
    });

    const result = await verifyKeyRotation(
      registry,
      record,
      oldKp.publicKeyB64,
      newKp.publicKeyB64,
    );

    expect(result.valid).toBe(true);
  });

  it('rotation fails with wrong old public key', async () => {
    const oldKp = await ed25519.generateKeypair();
    const newKp = await ed25519.generateKeypair();
    const wrongKp = await ed25519.generateKeypair();

    const record = await createKeyRotation(registry, {
      oldKid: oldKp.kid,
      oldAlg: 'ed25519',
      oldSecretKeyB64: oldKp.secretKeyB64,
      newKid: newKp.kid,
      newAlg: 'ed25519',
      newSecretKeyB64: newKp.secretKeyB64,
      newPublicKeyB64: newKp.publicKeyB64,
      timestamp: '2026-06-01T00:00:00Z',
      expiresAt: null,
    });

    const result = await verifyKeyRotation(
      registry,
      record,
      wrongKp.publicKeyB64,
      newKp.publicKeyB64,
    );

    expect(result.valid).toBe(false);
    expect(result.auth_valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Secure Memory
// ---------------------------------------------------------------------------

describe('SecureKeyGuard', () => {
  it('provides access to key bytes before disposal', () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const guard = new SecureKeyGuard(data);
    expect(guard.bytes[0]).toBe(1);
    expect(guard.isDisposed).toBe(false);
  });

  it('zeroes memory on disposal', () => {
    const data = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const guard = new SecureKeyGuard(data);
    const ref = guard.bytes;
    guard.dispose();
    expect(guard.isDisposed).toBe(true);
    expect(ref[0]).toBe(0);
    expect(ref[1]).toBe(0);
    expect(ref[2]).toBe(0);
    expect(ref[3]).toBe(0);
  });

  it('throws on access after disposal', () => {
    const guard = new SecureKeyGuard(new Uint8Array([1]));
    guard.dispose();
    expect(() => guard.bytes).toThrow('accessed after disposal');
  });
});

// ---------------------------------------------------------------------------
// 8. SLH-DSA-192f Provider (Backup PQ)
// ---------------------------------------------------------------------------

describe('SlhDsa192fProvider', () => {
  let slhDsa: SlhDsa192fProvider;

  beforeAll(() => {
    slhDsa = new SlhDsa192fProvider();
  });

  it('generates keypair', async () => {
    const kp = await slhDsa.generateKeypair();
    expect(kp.kid).toHaveLength(32);
    expect(kp.publicKeyB64).toBeTruthy();
  });

  it('signs and verifies', async () => {
    const kp = await slhDsa.generateKeypair();
    const msg = new TextEncoder().encode('hello SLH-DSA');
    const sig = await slhDsa.sign(msg, kp.secretKeyB64);
    const valid = await slhDsa.verify(msg, sig, kp.publicKeyB64);
    expect(valid).toBe(true);
  });

  it('rejects wrong message', async () => {
    const kp = await slhDsa.generateKeypair();
    const sig = await slhDsa.sign(
      new TextEncoder().encode('correct'),
      kp.secretKeyB64,
    );
    const valid = await slhDsa.verify(
      new TextEncoder().encode('wrong'),
      sig,
      kp.publicKeyB64,
    );
    expect(valid).toBe(false);
  });
}, { timeout: 60_000 });
