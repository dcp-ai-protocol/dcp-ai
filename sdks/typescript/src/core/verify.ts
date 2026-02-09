/**
 * Full DCP signed bundle verification.
 * Checks schema, signature, bundle_hash, merkle_root, intent_hash chain, and prev_hash chain.
 */
import { createHash } from 'crypto';
import type { SignedBundle, VerificationResult } from '../types/index.js';
import { canonicalize, verifyObject } from './crypto.js';
import { validateSchema, validateBundle } from './schema.js';
import { merkleRootForAuditEntries, hashObject, intentHash } from './merkle.js';

/**
 * Verify a Signed Bundle: schema + signature + bundle_hash + merkle_root + hash chains.
 * @param signedBundle - The signed bundle to verify
 * @param publicKeyB64 - Optional Ed25519 public key; falls back to signer.public_key_b64
 */
export function verifySignedBundle(
  signedBundle: SignedBundle,
  publicKeyB64?: string,
): VerificationResult {
  const errors: string[] = [];

  if (!signedBundle?.bundle || !signedBundle?.signature?.sig_b64) {
    return { verified: false, errors: ['Invalid signed bundle format.'] };
  }

  const publicKey =
    publicKeyB64 || signedBundle.signature?.signer?.public_key_b64;
  if (!publicKey) {
    return {
      verified: false,
      errors: [
        'Missing public key (provide publicKeyB64 or bundle must include signer.public_key_b64).',
      ],
    };
  }

  // 1) Schema: signed_bundle
  const schemaResult = validateSchema('signed_bundle', signedBundle);
  if (!schemaResult.valid) {
    schemaResult.errors?.forEach((e) => errors.push(`signed_bundle: ${e}`));
    return { verified: false, errors };
  }

  // 2) Schema: inner bundle
  const bundleResult = validateBundle(signedBundle.bundle);
  if (!bundleResult.valid) {
    bundleResult.errors?.forEach((e) => errors.push(e));
    return { verified: false, errors };
  }

  // 3) Signature
  if (
    !verifyObject(signedBundle.bundle, signedBundle.signature.sig_b64, publicKey)
  ) {
    errors.push('SIGNATURE INVALID');
    return { verified: false, errors };
  }

  // 4) bundle_hash
  if (
    typeof signedBundle.signature.bundle_hash === 'string' &&
    signedBundle.signature.bundle_hash.startsWith('sha256:')
  ) {
    const expectedHex = createHash('sha256')
      .update(canonicalize(signedBundle.bundle), 'utf8')
      .digest('hex');
    const got = signedBundle.signature.bundle_hash.slice('sha256:'.length);
    if (got !== expectedHex) {
      errors.push('BUNDLE HASH MISMATCH');
      return { verified: false, errors };
    }
  }

  // 5) merkle_root
  if (
    typeof signedBundle.signature.merkle_root === 'string' &&
    signedBundle.signature.merkle_root.startsWith('sha256:')
  ) {
    const expectedMerkle = Array.isArray(signedBundle.bundle.audit_entries)
      ? merkleRootForAuditEntries(signedBundle.bundle.audit_entries)
      : null;
    const gotMerkle = signedBundle.signature.merkle_root.slice('sha256:'.length);
    if (!expectedMerkle || gotMerkle !== expectedMerkle) {
      errors.push('MERKLE ROOT MISMATCH');
      return { verified: false, errors };
    }
  }

  // 6) intent_hash and prev_hash chain
  const bundle = signedBundle.bundle;
  const expectedIntentHash = intentHash(bundle.intent);
  let prevHashExpected = 'GENESIS';
  for (let i = 0; i < bundle.audit_entries.length; i++) {
    const entry = bundle.audit_entries[i];
    if (entry.intent_hash !== expectedIntentHash) {
      errors.push(
        `intent_hash (entry ${i}): expected ${expectedIntentHash}, got ${entry.intent_hash}`,
      );
      return { verified: false, errors };
    }
    if (entry.prev_hash !== prevHashExpected) {
      errors.push(
        `prev_hash chain (entry ${i}): expected ${prevHashExpected}, got ${entry.prev_hash}`,
      );
      return { verified: false, errors };
    }
    prevHashExpected = hashObject(entry);
  }

  return { verified: true };
}
