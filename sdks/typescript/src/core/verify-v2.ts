/**
 * DCP v2.0 Signed Bundle Verification.
 *
 * Implements the full V2 verification pipeline:
 *   1. Schema detection (V1 vs V2 routing)
 *   2. Session nonce consistency
 *   3. Manifest integrity (recompute artifact hashes)
 *   4. Composite signature verification (bound hybrid): manifest + each artifact
 *   5. Verifier-authoritative policy enforcement, raised by the security tier (spec §14.3)
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
  IntentV2,
  PolicyDecisionV2,
  SecurityTier,
  AuditEventV2,
  PQCheckpoint,
  KeyEntry,
} from '../types/v2.js';
import { canonicalizeV2 } from './canonicalize.js';
import { sha256Hex } from './dual-hash.js';
import { compositeVerify } from './composite-ops.js';
import type { CompositeVerifyResult } from './composite-ops.js';
import type { CompositeSignature } from './composite-sig.js';
import { AlgorithmRegistry } from './crypto-registry.js';
import { DCP_CONTEXTS } from './domain-separation.js';
import type { DcpContext } from './domain-separation.js';
import { verifySessionBinding, parseRfc3339 } from './session-nonce.js';
import { verifyPayloadHash } from './signed-payload.js';
import { computeSecurityTier, effectiveVerificationMode } from './security-tier.js';

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
    resolved_tier?: SecurityTier;
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

const VERIFICATION_MODES: readonly unknown[] = [
  'classical_only',
  'hybrid_preferred',
  'hybrid_required',
  'pq_only',
];

/**
 * The policy's mode for a risk tier: only the policy's own overrides count,
 * and a value that is not a VerificationMode resolves to undefined.
 */
function resolveMode(policy: VerifierPolicy, riskTier?: RiskTier): VerificationMode | undefined {
  const mode =
    riskTier && Object.hasOwn(policy.risk_overrides, riskTier)
      ? policy.risk_overrides[riskTier]
      : policy.default_mode;
  return VERIFICATION_MODES.includes(mode) ? mode : undefined;
}

// The algorithms each composite signature slot may hold.
const CLASSICAL_ALGS: readonly string[] = ['ed25519'];
const PQ_ALGS: readonly string[] = ['ml-dsa-65', 'slh-dsa-192f'];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function findKeyByKid(keys: KeyEntry[], kid: string): KeyEntry | undefined {
  return keys.find((k) => k.kid === kid);
}

interface SigCheck {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Steps V2-6, V2-7 and V2-10 for one composite signature over `payload`,
 * with signer keys looked up by kid in `keys`. A PQ signature that is present
 * (pq_over_classical) must verify in every mode; only an absent one
 * (classical_only) may be tolerated, and only by hybrid_preferred and
 * classical_only.
 */
async function checkCompositeSig(
  registry: AlgorithmRegistry,
  policy: VerifierPolicy,
  mode: VerificationMode,
  context: DcpContext,
  payload: unknown,
  sig: CompositeSignature,
  keys: KeyEntry[],
  keysLabel: string,
): Promise<SigCheck> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fail = (error: string): SigCheck => ({ valid: false, errors: [...errors, error], warnings });
  const rejectedAlgs = policy.advisory_rejected_algs || [];

  if (!isObject(sig) || !isObject(sig.classical)) {
    return fail('Missing composite signature');
  }
  // In every mode: Ed25519 cannot stand in for the PQ signature, nor ML-DSA for the classical one.
  if (!CLASSICAL_ALGS.includes(sig.classical.alg)) {
    return fail(`Classical slot holds ${sig.classical.alg}, which is not a classical algorithm`);
  }
  if (sig.pq && !PQ_ALGS.includes(sig.pq.alg)) {
    return fail(`PQ slot holds ${sig.pq.alg}, which is not a PQ algorithm`);
  }

  if (mode !== 'pq_only') {
    if (!policy.accepted_classical_algs.includes(sig.classical.alg)) {
      errors.push(`Classical algorithm ${sig.classical.alg} not accepted by verifier policy`);
    }
    if (rejectedAlgs.includes(sig.classical.alg)) {
      errors.push(`Classical algorithm ${sig.classical.alg} rejected by active advisory`);
    }
  }
  if (sig.pq && !policy.accepted_pq_algs.includes(sig.pq.alg)) {
    errors.push(`PQ algorithm ${sig.pq.alg} not accepted by verifier policy`);
  }
  if (sig.pq && rejectedAlgs.includes(sig.pq.alg)) {
    errors.push(`PQ algorithm ${sig.pq.alg} rejected by active advisory`);
  }
  if (policy.require_composite_binding && sig.binding !== 'pq_over_classical' && mode === 'hybrid_required') {
    errors.push('Verifier policy requires composite binding (pq_over_classical)');
  }
  if (policy.warn_classical_only_deprecated && sig.binding === 'classical_only') {
    warnings.push('DEPRECATION: classical-only signatures are deprecated. Migrate to hybrid or pq_only.');
  }

  if (mode === 'pq_only' && sig.binding === 'classical_only') {
    return fail('pq_only mode requires PQ signature, but binding is classical_only');
  }

  // In pq_only mode, the classical key is optional
  const signerKey = findKeyByKid(keys, sig.classical.kid);
  if (!signerKey && mode !== 'pq_only') {
    return fail(`Classical signer key kid=${sig.classical.kid} not found in ${keysLabel}`);
  }
  if (signerKey && signerKey.alg !== sig.classical.alg) {
    return fail(`Classical signer key kid=${sig.classical.kid} is ${signerKey.alg}, not ${sig.classical.alg}`);
  }
  const pqKey = sig.pq ? findKeyByKid(keys, sig.pq.kid) : undefined;
  if (sig.pq && !pqKey) {
    return fail(`PQ signer key kid=${sig.pq.kid} not found in ${keysLabel}`);
  }
  if (sig.pq && pqKey && pqKey.alg !== sig.pq.alg) {
    return fail(`PQ signer key kid=${sig.pq.kid} is ${pqKey.alg}, not ${sig.pq.alg}`);
  }
  if (mode === 'pq_only' && !pqKey) {
    return fail('pq_only mode requires PQ key, but no PQ key found');
  }

  let result: CompositeVerifyResult;
  try {
    const payloadBytes = new TextEncoder().encode(canonicalizeV2(payload));
    result = await compositeVerify(
      registry,
      context,
      payloadBytes,
      sig,
      signerKey?.public_key_b64 || '',
      pqKey?.public_key_b64,
    );
  } catch (err) {
    return fail(`Signature verification error: ${(err as Error).message}`);
  }

  switch (mode) {
    case 'hybrid_required':
      if (!result.classical_valid) errors.push('Classical signature invalid (hybrid_required)');
      if (!result.pq_valid) errors.push('PQ signature invalid or missing (hybrid_required)');
      break;

    case 'hybrid_preferred':
    case 'classical_only':
      if (!result.classical_valid) errors.push(`Classical signature invalid (${mode})`);
      if (sig.binding === 'pq_over_classical' && !result.pq_valid) {
        errors.push(`PQ signature invalid (${mode})`);
      } else if (mode === 'hybrid_preferred' && !result.pq_valid) {
        warnings.push('PQ signature missing (hybrid_preferred: accepted with warning)');
      }
      break;

    case 'pq_only':
      if (!result.pq_valid) errors.push('PQ signature invalid or missing (pq_only)');
      if (!result.classical_valid && !policy.allow_classical_fallback_disable) {
        warnings.push('Classical signature not verified in pq_only mode (fallback not disabled)');
      }
      break;

    default:
      errors.push('Unknown verification mode');
  }

  return { valid: result.valid, errors, warnings };
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
    if (!isObject(sp) || !isObject(sp.payload)) {
      errors.push(`${name}: not a SignedPayload object`);
    } else if (!verifyPayloadHash(sp)) {
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
  // Absent or null never expires; anything else must be an RFC 3339 timestamp
  // still in the future.

  const sessionExpiresAt: unknown = bundle.manifest.session_expires_at;
  let sessionExpires: number | undefined;
  if (sessionExpiresAt !== undefined && sessionExpiresAt !== null) {
    details.session_expires_at = String(sessionExpiresAt);
    sessionExpires = parseRfc3339(sessionExpiresAt);
    if (sessionExpires === undefined) {
      errors.push(`Invalid session_expires_at: ${String(sessionExpiresAt)}`);
      return { verified: false, errors, warnings, details };
    }
    if (sessionExpires < Date.now()) {
      errors.push(`Session expired at ${String(sessionExpiresAt)}`);
      return { verified: false, errors, warnings, details };
    }
  } else if (policy.require_session_expiry) {
    errors.push('Policy requires session_expires_at but manifest does not include it');
    return { verified: false, errors, warnings, details };
  }

  if (policy.max_session_duration_seconds && policy.max_session_duration_seconds > 0 && sessionExpires !== undefined) {
    const created = signature.created_at ? new Date(signature.created_at).getTime() : Date.now();
    const durationSec = (sessionExpires - created) / 1000;
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

  // Canonicalization profile: per spec/CANONICALIZATION_PROFILE.md § 4,
  // a missing field defaults to 'dcp-jcs-v1' (the only profile defined
  // today). An unknown value is rejected; a future profile (dcp-jcs-v2)
  // will register its own canonicalizer here.
  const profile = bundle.manifest.canonicalization_profile;
  if (profile !== undefined && profile !== 'dcp-jcs-v1') {
    errors.push(`Unknown canonicalization_profile: ${profile}`);
  }

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

  // An empty audit trail has the root 64 zeros (VERIFICATION.md V2-3).
  const expectedMerkleRoot = `sha256:${
    bundle.audit_entries.length > 0 ? auditMerkleRootHex(bundle.audit_entries) : '0'.repeat(64)
  }`;
  if (bundle.manifest.audit_merkle_root !== expectedMerkleRoot) {
    errors.push(`Manifest audit_merkle_root mismatch`);
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

  // ── 5. Resolve the verification mode ──
  // The stricter of the policy mode and the security tier's mode (spec §14.3):
  // the agent's own risk_tier and intent can raise the mode, never lower it.

  const passport = bundle.agent_passport.payload as AgentPassportV2;
  const policyMode = resolveMode(policy, passport.risk_tier);
  if (!policyMode) {
    errors.push('Unknown verification mode in verifier policy');
    return { verified: false, errors, warnings, details };
  }
  const tier = computeSecurityTier(
    bundle.intent.payload as IntentV2,
    bundle.policy_decision.payload as PolicyDecisionV2,
  );
  const mode = effectiveVerificationMode(policyMode, tier);
  details.resolved_tier = tier;
  details.verification_mode = mode;

  // ── 5a. Advisory-driven algorithm rejection (Phase 3) ──

  const rejectedAlgs = policy.advisory_rejected_algs || [];
  if (rejectedAlgs.length > 0) {
    details.advisory_rejected_algs = rejectedAlgs;
  }

  if (mode === 'classical_only' && policy.warn_classical_only_deprecated) {
    warnings.push('DEPRECATION: classical_only mode is deprecated in Phase 3');
  }

  // ── 6. Bundle composite signature over the manifest (V2-6, V2-7, V2-10) ──

  const allKeys = passport.keys;
  const rprPayload = bundle.responsible_principal_record.payload as { binding_keys?: KeyEntry[] };
  const rprKeys = rprPayload.binding_keys || [];

  const bundleCheck = await checkCompositeSig(
    registry, policy, mode, DCP_CONTEXTS.Bundle, bundle.manifest, signature.composite_sig,
    [...allKeys, ...rprKeys], 'passport or RPR',
  );
  errors.push(...bundleCheck.errors.map((e) => `bundle: ${e}`));
  warnings.push(...bundleCheck.warnings.map((w) => `bundle: ${w}`));
  details.signature_valid = bundleCheck.valid;

  // ── 7. Per-artifact composite signatures (V2-8) ──
  // The principal signs the RPR with its binding_keys; the agent signs the
  // rest with its passport keys.

  const artifacts = [
    ['responsible_principal_record', DCP_CONTEXTS.ResponsiblePrincipal, rprKeys, 'RPR binding_keys'],
    ['agent_passport', DCP_CONTEXTS.AgentPassport, allKeys, 'passport keys'],
    ['intent', DCP_CONTEXTS.Intent, allKeys, 'passport keys'],
    ['policy_decision', DCP_CONTEXTS.PolicyDecision, allKeys, 'passport keys'],
  ] as const;

  for (const [name, context, keys, keysLabel] of artifacts) {
    const sp = bundle[name];
    const check = await checkCompositeSig(
      registry, policy, mode, context, sp.payload, sp.composite_sig, keys, keysLabel,
    );
    errors.push(...check.errors.map((e) => `${name}: ${e}`));
    warnings.push(...check.warnings.map((w) => `${name}: ${w}`));
  }

  details.policy_satisfied = errors.length === 0;
  if (!details.policy_satisfied) {
    return { verified: false, errors, warnings, details };
  }

  // ── 8. Audit hash chain validation (prev_hash) ──

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

  // ── 9. Key validity checks ──
  // Every key that can sign: the passport keys and the RPR binding_keys (V2-13).

  const now = new Date();
  for (const key of [...allKeys, ...rprKeys]) {
    if (key.status === 'revoked' || key.status === 'expired') {
      errors.push(`Key ${key.kid} is ${key.status}`);
    }
    if (key.expires_at !== undefined && key.expires_at !== null) {
      const expires = parseRfc3339(key.expires_at);
      if (expires === undefined) {
        errors.push(`Key ${key.kid} has an invalid expires_at: ${String(key.expires_at)}`);
      } else if (expires < now.getTime()) {
        errors.push(`Key ${key.kid} has expired`);
      }
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
