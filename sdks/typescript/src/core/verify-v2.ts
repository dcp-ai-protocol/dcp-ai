/**
 * DCP v2.0 Signed Bundle Verification.
 *
 * Implements the full V2 verification pipeline:
 *   1. Schema detection (V1 vs V2 routing)
 *   2. Session nonce consistency
 *   3. Manifest integrity (recompute artifact hashes)
 *   4. Composite signature verification (bound hybrid)
 *   5. Verifier-authoritative policy enforcement
 *   6. Audit hash chain validation
 *   7. PQ checkpoint chain validation
 *   8. Key validity checks
 *   9. Advisory-driven algorithm rejection (Phase 3)
 *  10. pq_only mode with classical fallback disable (Phase 3)
 */

import type {
  SignedBundleV2,
  VerifierPolicy,
  VerificationMode,
  RiskTier,
  AgentPassportV2,
  AuditEventV2,
  PQCheckpoint,
  KeyEntry,
} from '../types/v2.js';
import { canonicalizeV2 } from './canonicalize.js';
import { sha256Hex } from './dual-hash.js';
import { compositeVerify } from './composite-ops.js';
import type { CompositeVerifyResult } from './composite-ops.js';
import { AlgorithmRegistry } from './crypto-registry.js';
import { DCP_CONTEXTS } from './domain-separation.js';
import { verifySessionBinding, isSessionExpired } from './session-nonce.js';
import { verifyPayloadHash } from './signed-payload.js';

export interface VerifyV2Result {
  verified: boolean;
  errors: string[];
  warnings: string[];
  details?: {
    session_nonce?: string;
    session_expires_at?: string;
    intended_verifier?: string;
    manifest_valid?: boolean;
    signature_valid?: boolean;
    policy_satisfied?: boolean;
    hash_chain_valid?: boolean;
    pq_checkpoints_valid?: boolean;
    verification_mode?: VerificationMode;
    advisory_rejected_algs?: string[];
  };
}

export const DEFAULT_VERIFIER_POLICY: VerifierPolicy = {
  default_mode: 'hybrid_preferred',
  risk_overrides: {
    low: 'classical_only',
    medium: 'hybrid_preferred',
    high: 'hybrid_required',
  },
  min_classical: 1,
  min_pq: 1,
  accepted_classical_algs: ['ed25519'],
  accepted_pq_algs: ['ml-dsa-65', 'slh-dsa-192f'],
  accepted_hash_algs: ['sha256', 'sha384'],
  require_session_binding: true,
  require_composite_binding: true,
  max_key_age_days: 365,
  allow_v1_bundles: true,
  allow_classical_fallback_disable: false,
  warn_classical_only_deprecated: false,
  advisory_rejected_algs: [],
};

/**
 * Phase 3 PQ-only policy preset. Classical signatures are accepted but
 * not required; the verifier trusts PQ alone.
 */
export const PQ_ONLY_VERIFIER_POLICY: VerifierPolicy = {
  default_mode: 'pq_only',
  risk_overrides: {
    low: 'pq_only',
    medium: 'pq_only',
    high: 'pq_only',
  },
  min_classical: 0,
  min_pq: 1,
  accepted_classical_algs: ['ed25519'],
  accepted_pq_algs: ['ml-dsa-65', 'slh-dsa-192f'],
  accepted_hash_algs: ['sha256', 'sha384'],
  require_session_binding: true,
  require_composite_binding: false,
  max_key_age_days: 365,
  allow_v1_bundles: false,
  allow_classical_fallback_disable: true,
  warn_classical_only_deprecated: true,
  advisory_rejected_algs: [],
};

function payloadHashHex(payload: unknown): string {
  const canonical = canonicalizeV2(payload);
  return sha256Hex(Buffer.from(canonical, 'utf8'));
}

function auditMerkleRootHex(entries: AuditEventV2[]): string {
  let leaves = entries.map((e) => {
    const canonical = canonicalizeV2(e);
    return sha256Hex(Buffer.from(canonical, 'utf8'));
  });

  while (leaves.length > 1) {
    if (leaves.length % 2 === 1) leaves.push(leaves[leaves.length - 1]);
    const next: string[] = [];
    for (let i = 0; i < leaves.length; i += 2) {
      next.push(
        sha256Hex(
          Buffer.concat([
            Buffer.from(leaves[i], 'hex'),
            Buffer.from(leaves[i + 1], 'hex'),
          ]),
        ),
      );
    }
    leaves = next;
  }

  return leaves[0];
}

function resolveMode(policy: VerifierPolicy, riskTier?: RiskTier): VerificationMode {
  if (riskTier && policy.risk_overrides[riskTier]) {
    return policy.risk_overrides[riskTier];
  }
  return policy.default_mode;
}

function findKeyByKid(keys: KeyEntry[], kid: string): KeyEntry | undefined {
  return keys.find((k) => k.kid === kid);
}

/**
 * Full V2 signed bundle verification.
 *
 * The verifier_policy parameter controls what signatures are required.
 * This is verifier-authoritative: the bundle/agent has no say in the policy.
 */
export async function verifySignedBundleV2(
  signedBundle: SignedBundleV2,
  registry: AlgorithmRegistry,
  policy: VerifierPolicy = DEFAULT_VERIFIER_POLICY,
): Promise<VerifyV2Result> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const details: VerifyV2Result['details'] = {};

  const { bundle, signature } = signedBundle;

  // ── 1. Basic structure check ──

  if (bundle.dcp_bundle_version !== '2.0') {
    errors.push(`Unsupported bundle version: ${bundle.dcp_bundle_version}`);
    return { verified: false, errors, warnings, details };
  }

  // ── 2. Payload hash verification for all signed artifacts ──

  const payloadChecks = [
    { name: 'responsible_principal_record', sp: bundle.responsible_principal_record },
    { name: 'agent_passport', sp: bundle.agent_passport },
    { name: 'intent', sp: bundle.intent },
    { name: 'policy_decision', sp: bundle.policy_decision },
  ];

  for (const { name, sp } of payloadChecks) {
    if (!verifyPayloadHash(sp)) {
      errors.push(`${name}: payload_hash mismatch`);
    }
  }

  if (errors.length > 0) {
    return { verified: false, errors, warnings, details };
  }

  // ── 3. Session nonce consistency ──

  if (policy.require_session_binding) {
    const artifacts: Array<{ session_nonce?: string }> = [
      bundle.responsible_principal_record.payload as { session_nonce?: string },
      bundle.agent_passport.payload,
      bundle.intent.payload,
      bundle.policy_decision.payload,
      ...bundle.audit_entries,
    ];

    if (bundle.pq_checkpoints) {
      artifacts.push(...bundle.pq_checkpoints);
    }

    const sessionResult = verifySessionBinding(artifacts);
    if (!sessionResult.valid) {
      errors.push(`Session binding failed: ${sessionResult.error}`);
      return { verified: false, errors, warnings, details };
    }

    if (sessionResult.nonce !== bundle.manifest.session_nonce) {
      errors.push('Session nonce in manifest does not match artifacts');
      return { verified: false, errors, warnings, details };
    }

    details.session_nonce = sessionResult.nonce;
  }

  // ── 3a. Session expiration check ──

  if (bundle.manifest.session_expires_at) {
    details.session_expires_at = bundle.manifest.session_expires_at;
    if (isSessionExpired(bundle.manifest.session_expires_at)) {
      errors.push(`Session expired at ${bundle.manifest.session_expires_at}`);
      return { verified: false, errors, warnings, details };
    }
  } else if (policy.require_session_expiry) {
    errors.push('Policy requires session_expires_at but manifest does not include it');
    return { verified: false, errors, warnings, details };
  }

  if (policy.max_session_duration_seconds && policy.max_session_duration_seconds > 0 && bundle.manifest.session_expires_at) {
    const created = signature.created_at ? new Date(signature.created_at).getTime() : Date.now();
    const expires = new Date(bundle.manifest.session_expires_at).getTime();
    const durationSec = (expires - created) / 1000;
    if (durationSec > policy.max_session_duration_seconds) {
      errors.push(
        `Session duration ${durationSec}s exceeds policy max of ${policy.max_session_duration_seconds}s`,
      );
    }
  }

  // ── 3b. Audience binding check ──

  if (bundle.manifest.intended_verifier) {
    details.intended_verifier = bundle.manifest.intended_verifier;
  }

  if (policy.require_audience_binding) {
    if (!bundle.manifest.intended_verifier) {
      errors.push('Policy requires audience binding but manifest does not include intended_verifier');
      return { verified: false, errors, warnings, details };
    }
    if (policy.verifier_id && bundle.manifest.intended_verifier !== policy.verifier_id) {
      errors.push(
        `Bundle intended for verifier '${bundle.manifest.intended_verifier}', not '${policy.verifier_id}'`,
      );
      return { verified: false, errors, warnings, details };
    }
  }

  // ── 4. Manifest integrity ──

  const expectedRprHash = `sha256:${payloadHashHex(bundle.responsible_principal_record.payload)}`;
  const expectedPassportHash = `sha256:${payloadHashHex(bundle.agent_passport.payload)}`;
  const expectedIntentHash = `sha256:${payloadHashHex(bundle.intent.payload)}`;
  const expectedPolicyHash = `sha256:${payloadHashHex(bundle.policy_decision.payload)}`;

  if (bundle.manifest.rpr_hash !== expectedRprHash) {
    errors.push(`Manifest rpr_hash mismatch: expected ${expectedRprHash}`);
  }
  if (bundle.manifest.passport_hash !== expectedPassportHash) {
    errors.push(`Manifest passport_hash mismatch: expected ${expectedPassportHash}`);
  }
  if (bundle.manifest.intent_hash !== expectedIntentHash) {
    errors.push(`Manifest intent_hash mismatch: expected ${expectedIntentHash}`);
  }
  if (bundle.manifest.policy_hash !== expectedPolicyHash) {
    errors.push(`Manifest policy_hash mismatch: expected ${expectedPolicyHash}`);
  }

  if (bundle.audit_entries.length > 0) {
    const expectedMerkleRoot = `sha256:${auditMerkleRootHex(bundle.audit_entries)}`;
    if (bundle.manifest.audit_merkle_root !== expectedMerkleRoot) {
      errors.push(`Manifest audit_merkle_root mismatch`);
    }
  }

  if (bundle.manifest.audit_count !== bundle.audit_entries.length) {
    errors.push(
      `Manifest audit_count=${bundle.manifest.audit_count} but bundle has ${bundle.audit_entries.length} entries`,
    );
  }

  details.manifest_valid = errors.length === 0;
  if (!details.manifest_valid) {
    return { verified: false, errors, warnings, details };
  }

  // ── 5. Resolve verifier policy mode ──

  const passport = bundle.agent_passport.payload as AgentPassportV2;
  const riskTier = passport.risk_tier;
  const mode = resolveMode(policy, riskTier);
  details.verification_mode = mode;

  // ── 5a. Advisory-driven algorithm rejection (Phase 3) ──

  const rejectedAlgs = policy.advisory_rejected_algs || [];
  if (rejectedAlgs.length > 0) {
    details.advisory_rejected_algs = rejectedAlgs;
  }

  // ── 6. Validate algorithms against policy ──

  const bundleSig = signature.composite_sig;

  if (mode !== 'pq_only') {
    if (!policy.accepted_classical_algs.includes(bundleSig.classical.alg)) {
      errors.push(`Classical algorithm ${bundleSig.classical.alg} not accepted by verifier policy`);
    }
    if (rejectedAlgs.includes(bundleSig.classical.alg)) {
      errors.push(`Classical algorithm ${bundleSig.classical.alg} rejected by active advisory`);
    }
  }

  if (bundleSig.pq && !policy.accepted_pq_algs.includes(bundleSig.pq.alg)) {
    errors.push(`PQ algorithm ${bundleSig.pq.alg} not accepted by verifier policy`);
  }

  if (bundleSig.pq && rejectedAlgs.includes(bundleSig.pq.alg)) {
    errors.push(`PQ algorithm ${bundleSig.pq.alg} rejected by active advisory`);
  }

  if (policy.require_composite_binding && bundleSig.binding !== 'pq_over_classical') {
    if (mode === 'hybrid_required') {
      errors.push('Verifier policy requires composite binding (pq_over_classical)');
    }
  }

  // Phase 3: deprecation warning for classical-only bundles
  if (policy.warn_classical_only_deprecated && bundleSig.binding === 'classical_only') {
    warnings.push('DEPRECATION: classical-only bundles are deprecated. Migrate to hybrid or pq_only.');
  }

  // ── 7. Composite signature verification over manifest ──

  const manifestCanonical = canonicalizeV2(bundle.manifest);
  const manifestBytes = new TextEncoder().encode(manifestCanonical);

  const allKeys = passport.keys;
  const rprPayload = bundle.responsible_principal_record.payload as { binding_keys?: KeyEntry[] };
  const rprKeys = rprPayload.binding_keys || [];

  // In pq_only mode, classical key is optional
  let signerKey: KeyEntry | undefined;
  if (mode === 'pq_only' && bundleSig.binding === 'classical_only') {
    errors.push('pq_only mode requires PQ signature, but bundle has classical_only binding');
    return { verified: false, errors, warnings, details };
  }

  signerKey = findKeyByKid(allKeys, bundleSig.classical.kid) ||
    findKeyByKid(rprKeys, bundleSig.classical.kid);

  if (!signerKey && mode !== 'pq_only') {
    errors.push(`Classical signer key kid=${bundleSig.classical.kid} not found in passport or RPR`);
    return { verified: false, errors, warnings, details };
  }

  let pqKey: KeyEntry | undefined;
  if (bundleSig.pq) {
    pqKey = findKeyByKid(allKeys, bundleSig.pq.kid) || findKeyByKid(rprKeys, bundleSig.pq.kid);
    if (!pqKey) {
      errors.push(`PQ signer key kid=${bundleSig.pq.kid} not found in passport or RPR`);
      return { verified: false, errors, warnings, details };
    }
  }

  if (mode === 'pq_only' && !pqKey) {
    errors.push('pq_only mode requires PQ key, but no PQ key found');
    return { verified: false, errors, warnings, details };
  }

  let sigResult: CompositeVerifyResult;
  try {
    sigResult = await compositeVerify(
      registry,
      DCP_CONTEXTS.Bundle,
      manifestBytes,
      bundleSig,
      signerKey?.public_key_b64 || '',
      pqKey?.public_key_b64,
    );
  } catch (err) {
    errors.push(`Signature verification error: ${(err as Error).message}`);
    return { verified: false, errors, warnings, details };
  }

  details.signature_valid = sigResult.valid;

  // ── 8. Enforce policy mode ──

  switch (mode) {
    case 'hybrid_required':
      if (!sigResult.classical_valid) errors.push('Classical signature invalid (hybrid_required)');
      if (!sigResult.pq_valid) errors.push('PQ signature invalid or missing (hybrid_required)');
      break;

    case 'hybrid_preferred':
      if (!sigResult.classical_valid) errors.push('Classical signature invalid');
      if (!sigResult.pq_valid) {
        warnings.push('PQ signature missing or invalid (hybrid_preferred: accepted with warning)');
      }
      break;

    case 'classical_only':
      if (!sigResult.classical_valid) errors.push('Classical signature invalid (classical_only)');
      if (policy.warn_classical_only_deprecated) {
        warnings.push('DEPRECATION: classical_only mode is deprecated in Phase 3');
      }
      break;

    case 'pq_only':
      if (!sigResult.pq_valid) errors.push('PQ signature invalid or missing (pq_only)');
      if (sigResult.classical_valid) {
        // Classical is accepted but not required — informational
      } else if (!policy.allow_classical_fallback_disable) {
        warnings.push('Classical signature not verified in pq_only mode (fallback not disabled)');
      }
      break;
  }

  details.policy_satisfied = errors.length === 0;
  if (!details.policy_satisfied) {
    return { verified: false, errors, warnings, details };
  }

  // ── 9. Audit hash chain validation (prev_hash) ──

  let prevHashExpected = 'GENESIS';
  for (let i = 0; i < bundle.audit_entries.length; i++) {
    const entry = bundle.audit_entries[i];
    if (entry.prev_hash !== prevHashExpected) {
      errors.push(
        `prev_hash chain break at entry[${i}]: expected ${prevHashExpected}, got ${entry.prev_hash}`,
      );
      break;
    }
    const canonical = canonicalizeV2(entry);
    prevHashExpected = `sha256:${sha256Hex(Buffer.from(canonical, 'utf8'))}`;
  }

  details.hash_chain_valid = errors.length === 0;

  // ── 10. Key validity checks ──

  const now = new Date();
  for (const key of allKeys) {
    if (key.status === 'revoked') {
      errors.push(`Key ${key.kid} is revoked`);
    }
    if (key.expires_at && new Date(key.expires_at) < now) {
      errors.push(`Key ${key.kid} has expired`);
    }
    if (policy.max_key_age_days > 0) {
      const createdAt = new Date(key.created_at);
      const ageDays = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays > policy.max_key_age_days) {
        warnings.push(`Key ${key.kid} exceeds max age of ${policy.max_key_age_days} days`);
      }
    }
  }

  const verified = errors.length === 0;
  return { verified, errors, warnings, details };
}
