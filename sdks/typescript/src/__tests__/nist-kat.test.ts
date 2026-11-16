/**
 * NIST KAT (Known Answer Test) Compliance Tests
 *
 * Ed25519: Property-based compliance + deterministic signing verification.
 * ML-DSA-65: FIPS 204 property-based compliance (size, round-trip, rejection).
 * ML-DSA-65: independent verification vectors (NIST ACVP tc39 + Wycheproof), empty context.
 *
 * Phase 1 gate: no SDK ships V2 without passing all KAT tests.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { Ed25519Provider } from '../providers/ed25519.js';
import { MlDsa65Provider } from '../providers/ml-dsa-65.js';
import { deriveKid } from '../core/crypto-provider.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadKat(name: string): any {
  const p = resolve(__dirname, `../../../../tests/nist-kat/${name}/vectors.json`);
  return JSON.parse(readFileSync(p, 'utf-8'));
}

// ---------------------------------------------------------------------------
// Ed25519 Provider KAT
// ---------------------------------------------------------------------------

describe('Ed25519 Provider KAT', () => {
  const ed25519 = new Ed25519Provider();

  it('algorithm identifier is ed25519', () => {
    expect(ed25519.alg).toBe('ed25519');
  });

  it('key size is 32 bytes', () => {
    expect(ed25519.keySize).toBe(32);
  });

  it('signature size is 64 bytes', () => {
    expect(ed25519.sigSize).toBe(64);
  });

  it('claims constant-time', () => {
    expect(ed25519.isConstantTime).toBe(true);
  });

  it('generated public key is 32 bytes', async () => {
    const kp = await ed25519.generateKeypair();
    const pkBytes = Buffer.from(kp.publicKeyB64, 'base64');
    expect(pkBytes.length).toBe(32);
  });

  it('generated kid has 32 hex chars', async () => {
    const kp = await ed25519.generateKeypair();
    expect(kp.kid).toHaveLength(32);
    expect(kp.kid).toMatch(/^[0-9a-f]{32}$/);
  });

  it('kid is deterministic from public key', async () => {
    const kp = await ed25519.generateKeypair();
    const pkBytes = new Uint8Array(Buffer.from(kp.publicKeyB64, 'base64'));
    expect(deriveKid('ed25519', pkBytes)).toBe(kp.kid);
  });

  it('kid differs for different keys', async () => {
    const kp1 = await ed25519.generateKeypair();
    const kp2 = await ed25519.generateKeypair();
    expect(kp1.kid).not.toBe(kp2.kid);
  });

  it('sign produces 64-byte signature', async () => {
    const kp = await ed25519.generateKeypair();
    const msg = new TextEncoder().encode('KAT sign size test');
    const sig = await ed25519.sign(msg, kp.secretKeyB64);
    expect(sig).toHaveLength(64);
  });

  it('sign + verify round-trip succeeds', async () => {
    const kp = await ed25519.generateKeypair();
    const msg = new TextEncoder().encode('KAT round-trip test');
    const sig = await ed25519.sign(msg, kp.secretKeyB64);
    expect(await ed25519.verify(msg, sig, kp.publicKeyB64)).toBe(true);
  });

  it('signing is deterministic (same key + message = same signature)', async () => {
    const kp = await ed25519.generateKeypair();
    const msg = new TextEncoder().encode('deterministic signing');
    const sig1 = await ed25519.sign(msg, kp.secretKeyB64);
    const sig2 = await ed25519.sign(msg, kp.secretKeyB64);
    expect(Buffer.from(sig1).toString('hex')).toBe(Buffer.from(sig2).toString('hex'));
  });

  it('wrong key rejection', async () => {
    const kp1 = await ed25519.generateKeypair();
    const kp2 = await ed25519.generateKeypair();
    const msg = new TextEncoder().encode('KAT wrong key');
    const sig = await ed25519.sign(msg, kp1.secretKeyB64);
    expect(await ed25519.verify(msg, sig, kp2.publicKeyB64)).toBe(false);
  });

  it('wrong message rejection', async () => {
    const kp = await ed25519.generateKeypair();
    const sig = await ed25519.sign(new TextEncoder().encode('message A'), kp.secretKeyB64);
    expect(
      await ed25519.verify(new TextEncoder().encode('message B'), sig, kp.publicKeyB64),
    ).toBe(false);
  });

  it('tampered signature rejection', async () => {
    const kp = await ed25519.generateKeypair();
    const msg = new TextEncoder().encode('tamper test');
    const sig = await ed25519.sign(msg, kp.secretKeyB64);
    const tampered = new Uint8Array(sig);
    tampered[0] ^= 0xff;
    expect(await ed25519.verify(msg, tampered, kp.publicKeyB64)).toBe(false);
  });

  it('empty message sign + verify', async () => {
    const kp = await ed25519.generateKeypair();
    const msg = new Uint8Array(0);
    const sig = await ed25519.sign(msg, kp.secretKeyB64);
    expect(sig).toHaveLength(64);
    expect(await ed25519.verify(msg, sig, kp.publicKeyB64)).toBe(true);
  });

  it('large message sign + verify', async () => {
    const kp = await ed25519.generateKeypair();
    const msg = new Uint8Array(10000);
    for (let i = 0; i < msg.length; i++) msg[i] = i & 0xff;
    const sig = await ed25519.sign(msg, kp.secretKeyB64);
    expect(await ed25519.verify(msg, sig, kp.publicKeyB64)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ML-DSA-65 FIPS 204 Property-Based KAT
// ---------------------------------------------------------------------------

describe('ML-DSA-65 NIST KAT (FIPS 204 properties)', () => {
  const mlDsa65 = new MlDsa65Provider();
  const katConfig = loadKat('ml-dsa-65');

  it('algorithm identifier is ml-dsa-65', () => {
    expect(mlDsa65.alg).toBe('ml-dsa-65');
  });

  it('declared key size matches FIPS 204 (1952 B)', () => {
    expect(mlDsa65.keySize).toBe(katConfig.properties.public_key_size);
  });

  it('declared sig size matches FIPS 204 (3309 B)', () => {
    expect(mlDsa65.sigSize).toBe(katConfig.properties.signature_size);
  });

  it('claims constant-time', () => {
    expect(mlDsa65.isConstantTime).toBe(true);
  });

  it('generated public key is 1952 bytes', async () => {
    const kp = await mlDsa65.generateKeypair();
    const pkBytes = Buffer.from(kp.publicKeyB64, 'base64');
    expect(pkBytes.length).toBe(1952);
  });

  it('generated kid has 32 hex chars', async () => {
    const kp = await mlDsa65.generateKeypair();
    expect(kp.kid).toHaveLength(32);
    expect(kp.kid).toMatch(/^[0-9a-f]{32}$/);
  });

  it('kid is deterministic from public key', async () => {
    const kp = await mlDsa65.generateKeypair();
    const pkBytes = new Uint8Array(Buffer.from(kp.publicKeyB64, 'base64'));
    expect(deriveKid('ml-dsa-65', pkBytes)).toBe(kp.kid);
  });

  it('sign + verify round-trip', async () => {
    const kp = await mlDsa65.generateKeypair();
    const msg = new TextEncoder().encode('ML-DSA-65 KAT round-trip');
    const sig = await mlDsa65.sign(msg, kp.secretKeyB64);
    expect(sig.length).toBeGreaterThan(0);
    expect(await mlDsa65.verify(msg, sig, kp.publicKeyB64)).toBe(true);
  });

  it('wrong key rejection', async () => {
    const kp1 = await mlDsa65.generateKeypair();
    const kp2 = await mlDsa65.generateKeypair();
    const msg = new TextEncoder().encode('wrong key');
    const sig = await mlDsa65.sign(msg, kp1.secretKeyB64);
    expect(await mlDsa65.verify(msg, sig, kp2.publicKeyB64)).toBe(false);
  });

  it('wrong message rejection', async () => {
    const kp = await mlDsa65.generateKeypair();
    const sig = await mlDsa65.sign(new TextEncoder().encode('A'), kp.secretKeyB64);
    expect(await mlDsa65.verify(new TextEncoder().encode('B'), sig, kp.publicKeyB64)).toBe(
      false,
    );
  });

  it('tampered signature rejection', async () => {
    const kp = await mlDsa65.generateKeypair();
    const msg = new TextEncoder().encode('tamper test');
    const sig = await mlDsa65.sign(msg, kp.secretKeyB64);
    const tampered = new Uint8Array(sig);
    tampered[0] ^= 0xff;
    expect(await mlDsa65.verify(msg, tampered, kp.publicKeyB64)).toBe(false);
  });

  it('cross-SDK: interop vector PQ signature verifies', async () => {
    const interopPath = resolve(
      __dirname,
      '../../../../tests/interop/v2/interop_vectors.json',
    );
    const V = JSON.parse(readFileSync(interopPath, 'utf-8'));
    const entry = V.composite_signatures.passport_composite;
    const canonical = V.canonicalization[entry.payload_key].expected_canonical;
    const payloadBytes = new TextEncoder().encode(canonical);

    const { domainSeparatedMessage } = await import('../core/domain-separation.js');
    const dsm = domainSeparatedMessage(entry.context, payloadBytes);
    const classicalSigBytes = Buffer.from(
      entry.composite_sig.classical.sig_b64,
      'base64',
    );
    const compositeMessage = new Uint8Array(dsm.length + classicalSigBytes.length);
    compositeMessage.set(dsm, 0);
    compositeMessage.set(new Uint8Array(classicalSigBytes), dsm.length);
    const pqSigBytes = new Uint8Array(Buffer.from(entry.composite_sig.pq.sig_b64, 'base64'));
    const pqPkB64 = V.test_keys.ml_dsa_65.public_key_b64;
    const valid = await mlDsa65.verify(compositeMessage, pqSigBytes, pqPkB64);
    expect(valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ML-DSA-65 independent verification vectors (NIST ACVP tc39 + Wycheproof)
// ---------------------------------------------------------------------------
// The provider verifies with the empty FIPS 204 context, so only cases whose
// context is empty go through it; the others are checked as excluded. Values
// are copied verbatim from the pinned sources (tests/nist-kat/README.md).

const ML_DSA_65_DIR = resolve(__dirname, '../../../../tests/nist-kat/ml-dsa-65');
const ML_DSA_65_WYCHEPROOF = resolve(ML_DSA_65_DIR, 'wycheproof_mldsa_65_verify_test.json');
const ML_DSA_65_NIST_TG3 = resolve(ML_DSA_65_DIR, 'acvp_sigver_tg3.json');
const ML_DSA_65_VECTOR_PROVIDER = new MlDsa65Provider();

interface MlDsa65VectorCase {
  source: 'wycheproof' | 'nist';
  id: number;
  pk: string;
  msg: string;
  sig: string;
  valid: boolean;
}

describe('ML-DSA-65 independent verification vectors (empty context)', () => {
  const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  const wyBytes = readFileSync(ML_DSA_65_WYCHEPROOF);
  const nistBytes = readFileSync(ML_DSA_65_NIST_TG3);
  const wy = JSON.parse(wyBytes.toString('utf-8'));
  const nist = JSON.parse(nistBytes.toString('utf-8'));
  const cases: MlDsa65VectorCase[] = [];
  const excludedWycheproof: number[] = [];
  const excludedNist: number[] = [];
  for (const g of wy.testGroups) {
    for (const t of g.tests) {
      if (t.ctx) {
        excludedWycheproof.push(t.tcId);
        continue;
      }
      const valid = t.result === 'valid';
      const pk = g.publicKey;
      cases.push({ source: 'wycheproof', id: t.tcId, pk, msg: t.msg, sig: t.sig, valid });
    }
  }
  for (const t of nist.testGroup.tests) {
    if (t.context) {
      excludedNist.push(t.tcId);
      continue;
    }
    const valid = t.testPassed === true;
    cases.push({ source: 'nist', id: t.tcId, pk: t.pk, msg: t.message, sig: t.signature, valid });
  }

  it('corpus integrity: pinned bytes, counts and exclusions', () => {
    expect(sha256(wyBytes)).toBe('1ca235f61928421a173a171780beb00264ae9155dc33c52a11e1766cc7979034');
    expect(sha256(nistBytes)).toBe('bacf4ad8e55db0594d8bf2878ca3bd3cb80cfa680aaf05ca8e1788d896f63eb8');
    expect([wy.algorithm, wy.numberOfTests]).toEqual(['ML-DSA-65', 210]);
    const g = nist.testGroup;
    expect([g.tgId, g.parameterSet, g.signatureInterface, g.preHash, g.tests.length]).toEqual([
      3,
      'ML-DSA-65',
      'external',
      'pure',
      15,
    ]);
    expect(cases.length).toBe(204);
    expect(cases.filter((c) => c.valid).length).toBe(77);
    expect(excludedWycheproof).toEqual([3, 4, 5, 153, 154, 155, 156]);
    expect(excludedNist).toEqual([31, 32, 33, 34, 35, 36, 37, 38, 40, 41, 42, 43, 44, 45]);
    expect(cases.filter((c) => c.source === 'nist').map((c) => c.id)).toEqual([39]);
  });

  it('the provider under test is the SDK MlDsa65Provider', () => {
    expect(ML_DSA_65_VECTOR_PROVIDER).toBeInstanceOf(MlDsa65Provider);
    expect(Object.getPrototypeOf(ML_DSA_65_VECTOR_PROVIDER)).toBe(MlDsa65Provider.prototype);
    expect(Object.prototype.hasOwnProperty.call(ML_DSA_65_VECTOR_PROVIDER, 'verify')).toBe(false);
  });

  it('verdicts of the provider on the 204 cases', async () => {
    const mismatches: string[] = [];
    let executed = 0;
    for (const c of cases) {
      // No catch: the TypeScript provider returns a boolean, and any error fails the test.
      const observed = await ML_DSA_65_VECTOR_PROVIDER.verify(
        Buffer.from(c.msg, 'hex'),
        Buffer.from(c.sig, 'hex'),
        Buffer.from(c.pk, 'hex').toString('base64'),
      );
      executed++;
      if (observed !== c.valid) mismatches.push(`${c.source} ${c.id}: ${c.valid} -> ${observed}`);
    }
    expect(mismatches).toEqual([]);
    expect(executed).toBe(204);
  });
});
