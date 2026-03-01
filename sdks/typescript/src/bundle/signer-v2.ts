/**
 * DCP v2.0 Bundle Signer — composite-signs the manifest.
 *
 * The bundle-level signature covers `canonical(manifest)` only, not the
 * entire bundle. This keeps the signed payload compact (~300 bytes) regardless
 * of bundle size.
 */

import type {
  CitizenshipBundleV2,
  SignedBundleV2,
  BundleSignatureV2,
  SignerType,
} from '../types/v2.js';
import type { CompositeKeyPair } from '../core/composite-ops.js';
import { compositeSign, classicalOnlySign } from '../core/composite-ops.js';
import type { CompositeKeyInfo } from '../core/composite-ops.js';
import { AlgorithmRegistry } from '../core/crypto-registry.js';
import { DCP_CONTEXTS } from '../core/domain-separation.js';
import { canonicalizeV2 } from '../core/canonicalize.js';
import { sha256Hex } from '../core/dual-hash.js';

export interface SignBundleV2Options {
  registry: AlgorithmRegistry;
  signerType: SignerType;
  signerId: string;
  keys: CompositeKeyPair;
  dualHash?: boolean;
  sessionExpiresAt?: string;
  intendedVerifier?: string;
}

export interface SignBundleV2ClassicalOnlyOptions {
  registry: AlgorithmRegistry;
  signerType: SignerType;
  signerId: string;
  key: CompositeKeyInfo;
}

/**
 * Sign a V2 bundle with a composite (hybrid) signature over the manifest.
 */
export async function signBundleV2(
  bundle: CitizenshipBundleV2,
  options: SignBundleV2Options,
): Promise<SignedBundleV2> {
  const { registry, signerType, signerId, keys, dualHash = false, sessionExpiresAt, intendedVerifier } = options;

  if (sessionExpiresAt) {
    bundle.manifest.session_expires_at = sessionExpiresAt;
  }
  if (intendedVerifier) {
    bundle.manifest.intended_verifier = intendedVerifier;
  }

  const manifestCanonical = canonicalizeV2(bundle.manifest);
  const manifestBytes = new TextEncoder().encode(manifestCanonical);
  const manifestHash = `sha256:${sha256Hex(manifestBytes)}`;

  const compositeSig = await compositeSign(
    registry,
    DCP_CONTEXTS.Bundle,
    manifestBytes,
    keys,
  );

  const signature: BundleSignatureV2 = {
    hash_alg: dualHash ? 'sha256+sha3-256' : 'sha256',
    created_at: new Date().toISOString(),
    signer: {
      type: signerType,
      id: signerId,
      kids: [keys.classical.kid, keys.pq.kid],
    },
    manifest_hash: manifestHash,
    composite_sig: compositeSig,
  };

  return { bundle, signature };
}

/**
 * Sign a V2 bundle with a classical-only composite signature (transition mode).
 */
export async function signBundleV2ClassicalOnly(
  bundle: CitizenshipBundleV2,
  options: SignBundleV2ClassicalOnlyOptions,
): Promise<SignedBundleV2> {
  const { registry, signerType, signerId, key } = options;

  const manifestCanonical = canonicalizeV2(bundle.manifest);
  const manifestBytes = new TextEncoder().encode(manifestCanonical);
  const manifestHash = `sha256:${sha256Hex(manifestBytes)}`;

  const compositeSig = await classicalOnlySign(
    registry,
    DCP_CONTEXTS.Bundle,
    manifestBytes,
    key,
  );

  const signature: BundleSignatureV2 = {
    hash_alg: 'sha256',
    created_at: new Date().toISOString(),
    signer: {
      type: signerType,
      id: signerId,
      kids: [key.kid],
    },
    manifest_hash: manifestHash,
    composite_sig: compositeSig,
  };

  return { bundle, signature };
}
