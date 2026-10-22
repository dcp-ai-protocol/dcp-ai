/**
 * verifySignedBundleV2 must return a verdict for a structurally malformed
 * signed bundle instead of throwing, as the Python, Go and Rust verifiers do
 * (spec/VERIFICATION.md V2-3: a payload that cannot be canonicalized fails
 * verification; V2-3 and V2-5: a bundle without a manifest or a signature is
 * rejected). Every case here was found by tools/difffuzz.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { Ed25519Provider } from '../providers/ed25519.js';
import { MlDsa65Provider } from '../providers/ml-dsa-65.js';
import { AlgorithmRegistry } from '../core/crypto-registry.js';
import { verifySignedBundleV2 } from '../core/verify-v2.js';
import type { SignedBundleV2 } from '../types/v2.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const registry = new AlgorithmRegistry();
registry.registerSigner(new Ed25519Provider());
registry.registerSigner(new MlDsa65Provider());

const VECTORS = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../tests/interop/v2/bundle_vectors.json'), 'utf-8'),
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mutate = (edit: (sb: any) => void): SignedBundleV2 => {
  const sb = JSON.parse(JSON.stringify(VECTORS.signed_bundle));
  edit(sb);
  return sb as SignedBundleV2;
};

const CASES: Array<[string, SignedBundleV2]> = [
  ['bundle missing', mutate((sb) => delete sb.bundle)],
  ['bundle null', mutate((sb) => (sb.bundle = null))],
  ['bundle a string', mutate((sb) => (sb.bundle = '2.0'))],
  ['signature missing', mutate((sb) => delete sb.signature)],
  ['signature null', mutate((sb) => (sb.signature = null))],
  ['manifest missing', mutate((sb) => delete sb.bundle.manifest)],
  ['manifest a string', mutate((sb) => (sb.bundle.manifest = 'manifest'))],
  ['audit_entries missing', mutate((sb) => delete sb.bundle.audit_entries)],
  ['audit_entries null', mutate((sb) => (sb.bundle.audit_entries = null))],
  ['audit_entries an object', mutate((sb) => (sb.bundle.audit_entries = {}))],
  ['audit entry null', mutate((sb) => (sb.bundle.audit_entries[0] = null))],
  ['risk_score 0.5', mutate((sb) => (sb.bundle.policy_decision.payload.risk_score = 0.5))],
  [
    'risk_score Infinity',
    mutate((sb) => (sb.bundle.policy_decision.payload.risk_score = Infinity)),
  ],
  ['audit_count 3.5', mutate((sb) => (sb.bundle.manifest.audit_count = 3.5))],
  [
    'key expires_at 0.1',
    mutate((sb) => (sb.bundle.agent_passport.payload.keys[0].expires_at = 0.1)),
  ],
  ['audit entry hash 1e-3', mutate((sb) => (sb.bundle.audit_entries[0].prev_hash = 1e-3))],
];

describe('verifySignedBundleV2 on malformed input', () => {
  it.each(CASES)('rejects "%s" without throwing', async (_name, signedBundle) => {
    const result = await verifySignedBundleV2(signedBundle, registry);
    expect(result.verified).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects a non-object signed bundle', async () => {
    for (const input of [null, undefined, 'bundle', 42, []]) {
      const result = await verifySignedBundleV2(input as unknown as SignedBundleV2, registry);
      expect(result.verified).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
});
