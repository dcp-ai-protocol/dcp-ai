/**
 * DCP-AI v2.0 Conformance Tests
 *
 * 1. V1 bundles verify through the V2-era verifier
 * 2. Golden canonical vectors match across all SDKs
 * 3. Dual-hash chain (SHA-256 + SHA3-256) produces expected results
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { canonicalize, verifyObject } from '../core/crypto.js';
import { canonicalizeV2, assertNoFloats } from '../core/canonicalize.js';
import { verifySignedBundle } from '../core/verify.js';
import { hashObject, merkleRootFromHexLeaves, intentHash } from '../core/merkle.js';
import {
  sha256Hex,
  sha3_256Hex,
  dualHash,
  dualHashCanonical,
  dualMerkleRoot,
} from '../core/dual-hash.js';

const VECTORS_PATH = resolve(
  __dirname,
  '../../../../tests/conformance/v2/golden_vectors.json',
);
const SIGNED_BUNDLE_PATH = resolve(
  __dirname,
  '../../../../tests/conformance/examples/citizenship_bundle.signed.json',
);

const vectors = JSON.parse(readFileSync(VECTORS_PATH, 'utf8'));
const signedBundle = JSON.parse(readFileSync(SIGNED_BUNDLE_PATH, 'utf8'));

// ---------------------------------------------------------------------------
// 1. V1 Bundle Verification Through V2 Verifier
// ---------------------------------------------------------------------------

describe('V1 Bundle Verification (backward compatibility)', () => {
  it('verifies the V1 signed bundle with embedded public key', () => {
    const result = verifySignedBundle(signedBundle);
    expect(result.verified).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it('verifies the V1 signed bundle with explicit public key', () => {
    const pk = vectors.v1_bundle_verification.public_key_b64;
    const result = verifySignedBundle(signedBundle, pk);
    expect(result.verified).toBe(true);
  });

  it('rejects a V1 bundle with wrong public key', () => {
    const result = verifySignedBundle(signedBundle, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    expect(result.verified).toBe(false);
  });

  it('rejects a V1 bundle with tampered audit entry', () => {
    const tampered = JSON.parse(JSON.stringify(signedBundle));
    tampered.bundle.audit_entries[0].outcome = 'tampered_outcome';
    const result = verifySignedBundle(tampered);
    expect(result.verified).toBe(false);
  });

  it('rejects a V1 bundle with tampered intent', () => {
    const tampered = JSON.parse(JSON.stringify(signedBundle));
    tampered.bundle.intent.action_type = 'execute_code';
    const result = verifySignedBundle(tampered);
    expect(result.verified).toBe(false);
  });

  it('computes the correct bundle_hash', () => {
    const expected = vectors.v1_bundle_verification.expected_bundle_hash;
    const canon = canonicalize(signedBundle.bundle);
    const computed = 'sha256:' + sha256Hex(canon);
    expect(computed).toBe(expected);
  });

  it('computes the correct merkle_root', () => {
    const expected = vectors.v1_bundle_verification.expected_merkle_root;
    const leaves = signedBundle.bundle.audit_entries.map(
      (e: unknown) => hashObject(e),
    );
    const root = merkleRootFromHexLeaves(leaves);
    expect('sha256:' + root).toBe(expected);
  });

  it('computes the correct intent_hash', () => {
    const expected = vectors.v1_bundle_verification.intent_hash;
    const computed = intentHash(signedBundle.bundle.intent);
    expect(computed).toBe(expected);
  });

  it('validates the full prev_hash chain', () => {
    const expectedChain: string[] = vectors.v1_bundle_verification.prev_hash_chain;
    const entries = signedBundle.bundle.audit_entries;
    let prevHash = 'GENESIS';
    expect(prevHash).toBe(expectedChain[0]);

    for (let i = 0; i < entries.length; i++) {
      expect(entries[i].prev_hash).toBe(prevHash);
      prevHash = hashObject(entries[i]);
      expect(prevHash).toBe(expectedChain[i + 1]);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Golden Canonical Vectors
// ---------------------------------------------------------------------------

describe('Golden Canonical Vectors', () => {
  describe('V1 canonicalization', () => {
    const cases = vectors.canonicalization;

    it('simple sorted keys', () => {
      expect(canonicalize(cases.simple_sorted_keys.input)).toBe(
        cases.simple_sorted_keys.expected_canonical,
      );
    });

    it('nested objects', () => {
      expect(canonicalize(cases.nested_objects.input)).toBe(
        cases.nested_objects.expected_canonical,
      );
    });

    it('mixed types', () => {
      expect(canonicalize(cases.mixed_types.input)).toBe(
        cases.mixed_types.expected_canonical,
      );
    });

    it('with null', () => {
      expect(canonicalize(cases.with_null.input)).toBe(
        cases.with_null.expected_canonical,
      );
    });

    it('unicode', () => {
      expect(canonicalize(cases.unicode.input)).toBe(
        cases.unicode.expected_canonical,
      );
    });
  });

  describe('V2 canonicalization (float prohibition)', () => {
    const cases = vectors.v2_canonicalization;

    it('integer-only payload', () => {
      expect(canonicalizeV2(cases.integer_only.input)).toBe(
        cases.integer_only.expected_canonical,
      );
    });

    it('rejects floating-point values', () => {
      expect(() => canonicalizeV2({ score: 0.5 })).toThrow();
    });

    it('rejects nested floating-point values', () => {
      expect(() =>
        canonicalizeV2({ outer: { inner: 3.14 } }),
      ).toThrow();
    });

    it('assertNoFloats passes for integers', () => {
      expect(() => assertNoFloats({ a: 1, b: [2, 3] })).not.toThrow();
    });

    it('assertNoFloats rejects floats', () => {
      expect(() => assertNoFloats({ a: 1.5 })).toThrow();
    });
  });

  describe('SHA-256 hash vectors', () => {
    const hv = vectors.hash_vectors;

    it('sha256("hello")', () => {
      expect(sha256Hex('hello')).toBe(hv.sha256_hello.expected_hex);
    });

    it('sha256("")', () => {
      expect(sha256Hex('')).toBe(hv.sha256_empty.expected_hex);
    });
  });

  describe('SHA3-256 hash vectors', () => {
    const hv = vectors.hash_vectors;

    it('sha3_256("hello")', () => {
      expect(sha3_256Hex('hello')).toBe(hv.sha3_256_hello.expected_hex);
    });

    it('sha3_256("")', () => {
      expect(sha3_256Hex('')).toBe(hv.sha3_256_empty.expected_hex);
    });
  });

  describe('Object hashing (SHA-256 of canonical JSON)', () => {
    it('audit entry hashes match golden vectors', () => {
      const expectedHashes: string[] =
        vectors.v1_bundle_verification.audit_entry_hashes;
      const entries = signedBundle.bundle.audit_entries;
      for (let i = 0; i < entries.length; i++) {
        expect(hashObject(entries[i])).toBe(expectedHashes[i]);
      }
    });

    it('intent hash matches golden vector', () => {
      const expected =
        vectors.dual_hash_vectors.intent_canonical.sha256;
      expect(hashObject(signedBundle.bundle.intent)).toBe(expected);
    });
  });

  describe('Merkle root', () => {
    it('merkle root from audit entry hashes', () => {
      const leaves: string[] = vectors.v1_bundle_verification.audit_entry_hashes;
      const expected = vectors.dual_hash_vectors.dual_merkle_roots.sha256;
      expect(merkleRootFromHexLeaves(leaves)).toBe(expected);
    });

    it('merkle root of empty leaves returns null', () => {
      expect(merkleRootFromHexLeaves([])).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Dual-Hash Chain Tests
// ---------------------------------------------------------------------------

describe('Dual-Hash Chain (SHA-256 + SHA3-256)', () => {
  const dv = vectors.dual_hash_vectors;

  describe('raw dual hash', () => {
    it('produces correct SHA-256 and SHA3-256 for raw bytes', () => {
      const input = dv.raw_dual_hash.input_utf8;
      const result = dualHash(input);
      expect(result.sha256).toBe(dv.raw_dual_hash.sha256);
      expect(result.sha3_256).toBe(dv.raw_dual_hash.sha3_256);
    });

    it('SHA-256 and SHA3-256 are always different for same input', () => {
      const result = dualHash('test data');
      expect(result.sha256).not.toBe(result.sha3_256);
    });
  });

  describe('dual hash of canonical JSON', () => {
    it('intent canonical dual hash matches golden vector', () => {
      const canonJson = dv.intent_canonical.canonical_json;
      const result = dualHashCanonical(canonJson);
      expect(result.sha256).toBe(dv.intent_canonical.sha256);
      expect(result.sha3_256).toBe(dv.intent_canonical.sha3_256);
    });

    it('audit entry dual hashes match golden vectors', () => {
      const entries = signedBundle.bundle.audit_entries;
      const expectedDual: Array<{ sha256: string; sha3_256: string }> =
        dv.audit_entry_dual_hashes;

      for (let i = 0; i < entries.length; i++) {
        const canon = canonicalize(entries[i]);
        const result = dualHashCanonical(canon);
        expect(result.sha256).toBe(expectedDual[i].sha256);
        expect(result.sha3_256).toBe(expectedDual[i].sha3_256);
      }
    });
  });

  describe('dual Merkle root', () => {
    it('produces correct dual Merkle roots from audit entry dual hashes', () => {
      const leaves = dv.audit_entry_dual_hashes;
      const result = dualMerkleRoot(leaves);
      expect(result).not.toBeNull();
      expect(result!.sha256).toBe(dv.dual_merkle_roots.sha256);
      expect(result!.sha3_256).toBe(dv.dual_merkle_roots.sha3_256);
    });

    it('SHA-256 Merkle root matches V1 merkle_root (backward compatibility)', () => {
      const leaves = dv.audit_entry_dual_hashes;
      const result = dualMerkleRoot(leaves);
      const v1Root =
        vectors.v1_bundle_verification.expected_merkle_root.slice('sha256:'.length);
      expect(result!.sha256).toBe(v1Root);
    });

    it('dual Merkle root of empty leaves returns null', () => {
      expect(dualMerkleRoot([])).toBeNull();
    });
  });

  describe('dual-hash chain integrity', () => {
    it('simulates a dual-hash audit chain and verifies both chains', () => {
      const entries = signedBundle.bundle.audit_entries;
      let prevSha256 = 'GENESIS';
      let prevSha3 = 'GENESIS';

      for (const entry of entries) {
        const canon = canonicalize(entry);
        const dual = dualHashCanonical(canon);

        expect(entry.prev_hash).toBe(prevSha256);

        prevSha256 = dual.sha256;
        prevSha3 = dual.sha3_256;
      }

      expect(prevSha256).toBe(
        vectors.v1_bundle_verification.prev_hash_chain[entries.length],
      );
      expect(prevSha3).toBe(
        dv.audit_entry_dual_hashes[entries.length - 1].sha3_256,
      );
    });
  });
});
