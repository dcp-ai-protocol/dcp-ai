/**
 * Cross-SDK verification of vectors produced by the Python SDK: the `python`
 * section of tests/interop/v2/cross_sdk_vectors.json, written by
 * sdks/python/tests/generate_cross_sdk_vectors.py. The `typescript` section
 * (generate-cross-sdk-vectors.ts) is verified by the Python SDK.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { Ed25519Provider } from '../providers/ed25519.js';
import { MlDsa65Provider } from '../providers/ml-dsa-65.js';
import { MlKem768Provider } from '../providers/ml-kem-768.js';
import { SlhDsa192fProvider } from '../providers/slh-dsa-192f.js';
import { AlgorithmRegistry } from '../core/crypto-registry.js';
import { canonicalizeV2 } from '../core/canonicalize.js';
import { deriveKid } from '../core/crypto-provider.js';
import { verifySignedBundleV2, DEFAULT_VERIFIER_POLICY } from '../core/verify-v2.js';
import { BundleBuilderV2 } from '../bundle/builder-v2.js';
import type { SignedBundleV2 } from '../types/v2.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VECTORS_PATH = resolve(__dirname, '../../../../tests/interop/v2/cross_sdk_vectors.json');

let py: any;
let registry: AlgorithmRegistry;

beforeAll(() => {
  py = JSON.parse(readFileSync(VECTORS_PATH, 'utf-8')).python;
  registry = new AlgorithmRegistry();
  registry.registerSigner(new Ed25519Provider());
  registry.registerSigner(new MlDsa65Provider());
});

describe('Cross-SDK: vectors produced by the Python SDK', () => {
  it('SLH-DSA-192f signature verifies (FIPS 205, empty context)', async () => {
    const v = py.slh_dsa_192f;
    const msg = new Uint8Array(Buffer.from(v.message_hex, 'hex'));
    const sig = new Uint8Array(Buffer.from(v.sig_b64, 'base64'));
    const slh = new SlhDsa192fProvider();
    expect(deriveKid('slh-dsa-192f', new Uint8Array(Buffer.from(v.public_key_b64, 'base64')))).toBe(
      v.kid,
    );
    expect(await slh.verify(msg, sig, v.public_key_b64)).toBe(true);
    expect(await slh.verify(new Uint8Array([...msg, 0x78]), sig, v.public_key_b64)).toBe(false);
  });

  it('ML-KEM-768 ciphertext decapsulates to the Python shared secret', async () => {
    const v = py.ml_kem_768;
    const sharedSecret = await new MlKem768Provider().decapsulate(
      v.ciphertext_b64,
      v.secret_key_b64,
    );
    expect(Buffer.from(sharedSecret).toString('hex')).toBe(v.shared_secret_hex);
  });

  it('signed V2 bundle verifies under the default policy (hybrid_required for risk_tier high)', async () => {
    const result = await verifySignedBundleV2(
      py.signed_bundle_v2 as SignedBundleV2,
      registry,
      DEFAULT_VERIFIER_POLICY,
    );
    expect(result.errors).toEqual([]);
    expect(result.verified).toBe(true);
    expect(result.details?.verification_mode).toBe('hybrid_required');
  });

  it('BundleBuilderV2 recomputes the Python manifest byte for byte', () => {
    const b = (py.signed_bundle_v2 as SignedBundleV2).bundle;
    const rebuilt = new BundleBuilderV2(b.manifest.session_nonce)
      .responsiblePrincipalRecord(b.responsible_principal_record)
      .agentPassport(b.agent_passport)
      .intent(b.intent)
      .policyDecision(b.policy_decision)
      .addAuditEntries(b.audit_entries)
      .enableDualHash()
      .build();
    expect(canonicalizeV2(rebuilt.manifest)).toBe(canonicalizeV2(b.manifest));
  });
});
