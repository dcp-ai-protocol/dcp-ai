/**
 * dcp_verify_bundle — Verify a DCP SignedBundle (V1 or V2).
 *
 * A V2 bundle is verified only if `verifySignedBundleV2` from the SDK accepts
 * it. The verifier
 * policy is the operator's (configureVerifier, or the SDK's
 * DEFAULT_VERIFIER_POLICY); the tool's verifier_policy parameter, which the
 * calling model controls, can only make it stricter.
 */
import { Type, type Static } from '@sinclair/typebox';
import {
  computeSecurityTier,
  verifySignedBundle,
  type IntentV2,
  type VerificationResult,
  type SignedBundle,
  type VerificationMode,
  type VerifierPolicy,
} from '@dcp-ai/sdk';
import {
  RISK_TIERS,
  checkPolicyFields,
  detectVersion,
  isObject,
  resolveVerifierPolicy,
  stricterMode,
  v1Refusal,
  verifyV2,
  type SecurityTier,
  type VerifierPolicyOptions,
} from './dcp-verify.js';

// ── Parameter Schema ──

const PARAM_POLICY_FIELDS = ['default_mode', 'require_session_binding', 'require_composite_binding', 'allow_v1_bundles'];

export const VerifyBundleParams = Type.Object({
  signed_bundle: Type.Any({
    description:
      'The complete DCP SignedBundle object (JSON). V1 or V2 auto-detected.',
  }),
  public_key: Type.Optional(
    Type.String({
      description:
        'Ed25519 public key (base64). Required for V1. V2 resolves keys from the bundle.',
    }),
  ),
  verifier_policy: Type.Optional(
    Type.Object({
      default_mode: Type.Optional(
        Type.Union([
          Type.Literal('classical_only'),
          Type.Literal('hybrid_preferred'),
          Type.Literal('hybrid_required'),
          Type.Literal('pq_only'),
        ], { description: 'Raises the verification mode of every risk tier to at least this one.' }),
      ),
      require_session_binding: Type.Optional(Type.Boolean({ description: 'true requires session binding; false changes nothing.' })),
      require_composite_binding: Type.Optional(Type.Boolean({ description: 'true requires composite binding; false changes nothing.' })),
      allow_v1_bundles: Type.Optional(Type.Boolean({ description: 'false refuses V1 bundles; true changes nothing.' })),
    }, { description: 'Makes the operator\'s verifier policy stricter for this call. It cannot make it weaker.' }),
  ),
});

export type VerifyBundleInput = Static<typeof VerifyBundleParams>;

// ── Operator policy ──

let operatorPolicy: VerifierPolicy = resolveVerifierPolicy(undefined);

/**
 * Sets the verifier policy of dcp_verify_bundle: `verifierPolicy` fields over the SDK's
 * DEFAULT_VERIFIER_POLICY (a default_mode without risk_overrides applies to every risk tier).
 * Throws on an unknown field or a value of the wrong type. Called with no policy, it restores the
 * default. The tool's verifier_policy parameter can only make this policy stricter.
 */
export function configureVerifier(options: { verifierPolicy?: VerifierPolicyOptions } = {}): void {
  operatorPolicy = resolveVerifierPolicy(options.verifierPolicy);
}

/** The operator policy made stricter, never weaker, by the tool's verifier_policy parameter. */
function tightenPolicy(base: VerifierPolicy, param: unknown): VerifierPolicy {
  const fields = checkPolicyFields(param, 'verifier_policy', PARAM_POLICY_FIELDS);
  const policy: VerifierPolicy = { ...base, risk_overrides: { ...base.risk_overrides } };
  if (fields.default_mode) {
    policy.default_mode = stricterMode(policy.default_mode, fields.default_mode);
    for (const tier of RISK_TIERS) policy.risk_overrides[tier] = stricterMode(policy.risk_overrides[tier], fields.default_mode);
  }
  if (fields.require_session_binding) policy.require_session_binding = true;
  if (fields.require_composite_binding) policy.require_composite_binding = true;
  if (fields.allow_v1_bundles === false) policy.allow_v1_bundles = false;
  return policy;
}

// ── Execution ──

export interface VerifyBundleResult {
  verified: boolean;
  dcp_version: '1.0' | '2.0' | 'unknown';
  errors: string[];
  warnings: string[];
  message: string;
  /** Only for a verified bundle. */
  agent_id?: string;
  /** Only for a verified bundle. */
  human_id?: string;
  /** Only for a verified bundle. */
  session_nonce?: string;
  resolved_tier?: SecurityTier;
  /** V2: the verification mode the bundle was checked in (the stricter of the policy and its security tier). */
  verification_mode?: VerificationMode;
}

function failure(dcpVersion: VerifyBundleResult['dcp_version'], errors: string[], extra: Partial<VerifyBundleResult> = {}): VerifyBundleResult {
  const label = dcpVersion === 'unknown' ? 'Verification' : `V${dcpVersion.slice(0, 1)} verification`;
  return { verified: false, dcp_version: dcpVersion, errors, warnings: [], message: `${label} failed: ${errors.join('; ')}`, ...extra };
}

export async function executeVerifyBundle(
  params: VerifyBundleInput,
): Promise<VerifyBundleResult> {
  const signedBundle = params.signed_bundle;

  if (!isObject(signedBundle) || (!signedBundle.bundle && !signedBundle.signature)) {
    return failure('unknown', ['Invalid input: signed_bundle must have "bundle" and "signature" fields.']);
  }

  let policy: VerifierPolicy;
  try {
    policy = tightenPolicy(operatorPolicy, params.verifier_policy);
  } catch (err) {
    return failure('unknown', [err instanceof Error ? err.message : String(err)]);
  }

  const version = detectVersion(signedBundle);
  if (version === '2.0') return verifyV2Bundle(signedBundle, policy);
  if (version !== '1.0') {
    return failure('unknown', [
      'Unrecognized DCP bundle version: expected bundle.dcp_bundle_version "2.0" or bundle.responsible_principal_record.dcp_version "1.0"',
    ]);
  }

  const refusal = v1Refusal(policy, false, signedBundle.bundle);
  if (refusal) return failure('1.0', [refusal]);

  let result: VerificationResult;
  try {
    result = verifySignedBundle(signedBundle as SignedBundle, params.public_key);
  } catch (err) {
    return failure('1.0', [`V1 verification error: ${err instanceof Error ? err.message : String(err)}`]);
  }
  if (!result.verified) return failure('1.0', result.errors ?? ['Unknown verification failure']);

  const agentId = signedBundle.bundle?.agent_passport?.agent_id ?? 'unknown';
  const humanId = signedBundle.bundle?.responsible_principal_record?.human_id ?? 'unknown';
  return {
    verified: true,
    dcp_version: '1.0',
    errors: [],
    warnings: [],
    message: `V1 bundle verified. Agent ${agentId} bound to ${humanId}.`,
    agent_id: agentId,
    human_id: humanId,
  };
}

async function verifyV2Bundle(signedBundle: Record<string, any>, policy: VerifierPolicy): Promise<VerifyBundleResult> {
  const bundle = signedBundle.bundle;
  const verdict = await verifyV2(signedBundle, policy);

  // The security tier of the intent, reported even for a bundle that does not verify.
  const intentPayload = bundle?.intent?.payload;
  // A policy decision that is not an object has no valid risk_score: the tier fails closed.
  const policyPayload = isObject(bundle?.policy_decision?.payload) ? bundle.policy_decision.payload : {};
  const resolvedTier =
    verdict.securityTier ??
    (isObject(intentPayload) ? computeSecurityTier(intentPayload as unknown as IntentV2, policyPayload as { risk_score: number }) : undefined);
  const context = { resolved_tier: resolvedTier, verification_mode: verdict.verificationMode };

  if (!verdict.verified) return { ...failure('2.0', verdict.errors, context), warnings: verdict.warnings };

  const agentId = bundle.agent_passport.payload.agent_id ?? 'unknown';
  const humanId = bundle.responsible_principal_record.payload.human_id ?? 'unknown';
  const nonce = bundle.manifest.session_nonce;
  return {
    verified: true,
    dcp_version: '2.0',
    errors: [],
    warnings: verdict.warnings,
    message: `V2 bundle verified (tier: ${resolvedTier}, mode: ${verdict.verificationMode}). Agent ${agentId} bound to ${humanId}. Session: ${nonce.slice(0, 16)}...`,
    agent_id: agentId,
    human_id: humanId,
    session_nonce: nonce,
    ...context,
  };
}
