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
  AdmissionConfigError,
  computeSecurityTier,
  verifySignedBundle,
  type IntentV2,
  type PrincipalTrust,
  type ProfileCompliance,
  type StrictV1Profile,
  type StrictV1ProfileConfig,
  type VerificationResult,
  type SignedBundle,
  type VerificationMode,
  type VerifierPolicy,
} from '@dcp-ai/sdk';
import {
  RISK_TIERS,
  admissionFailure,
  admit,
  checkPolicyFields,
  detectVersion,
  isObject,
  resolveAdmission,
  resolveVerifierPolicy,
  stricterMode,
  v1Refusal,
  verifyV2,
  type AdmissionSetup,
  type RevocationSource,
  type SecurityTier,
  type TrustSource,
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
        ], { description: 'Raises the verification mode of every risk tier to at least this one. pq_only combined with another mode requires both signatures (hybrid_required).' }),
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
let admission: AdmissionSetup | undefined;
let clock: () => number = Date.now;

/** The operator's configuration of dcp_verify_bundle. */
export interface VerifierConfiguration {
  /** Fields over the SDK's DEFAULT_VERIFIER_POLICY; the tool parameter can only tighten them. */
  verifierPolicy?: VerifierPolicyOptions;
  /**
   * The principals the operator trusts and their keys (schemas/v2/principal_trust_set.schema.json),
   * or a function returning them. With it, the result says whether the bundle is admitted (V2,
   * signed for a trusted principal with its trusted keys: spec/profiles/admission), and names the
   * agent and principal only then; `verified` keeps its meaning, the verifier's verdict.
   */
  trustedPrincipals?: TrustSource;
  /**
   * The strict-v1 profile (schemas/v2/admission_profile.schema.json). Requires trustedPrincipals
   * and revocationSource, and replaces verifierPolicy; the tool parameter cannot change it.
   */
  profile?: StrictV1ProfileConfig | StrictV1Profile;
  /** The profile's revocation source, e.g. denyListRevocationSource({ url }). */
  revocationSource?: RevocationSource;
  /** Milliseconds the revocation source may take. Default 5000. */
  revocationTimeoutMs?: number;
  /** The clock, in milliseconds since the epoch. For tests; default Date.now. */
  clock?: () => number;
}

const CONFIG_KEYS = ['verifierPolicy', 'trustedPrincipals', 'profile', 'revocationSource', 'revocationTimeoutMs', 'clock'];

/**
 * Configures dcp_verify_bundle: the verifier policy (`verifierPolicy` fields over the SDK's
 * DEFAULT_VERIFIER_POLICY, a default_mode without risk_overrides applying to every risk tier) and,
 * optionally, trusted principals and the strict-v1 profile. Throws on an unknown option, a value of
 * the wrong type or a contradiction (AdmissionConfigError), leaving the previous configuration in
 * place. Called with no options, it restores the default. The tool's verifier_policy parameter can
 * only make the policy stricter, and is refused under the profile.
 */
export function configureVerifier(options: VerifierConfiguration = {}): void {
  if (!isObject(options)) throw new TypeError('configureVerifier options must be an object');
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined && !CONFIG_KEYS.includes(key)) throw new Error(`Unknown configureVerifier option: ${key}`);
  }
  if (options.clock !== undefined && typeof options.clock !== 'function') throw new TypeError('clock must be a function');
  if (options.profile !== undefined && options.verifierPolicy !== undefined) {
    throw new AdmissionConfigError('CONFIG_PROFILE_CONTRADICTION', 'strict-v1 sets the verifier policy (profile.verifier_policy may tighten it); do not pass verifierPolicy');
  }
  const policy = resolveVerifierPolicy(options.verifierPolicy);
  const setup = resolveAdmission(options);
  operatorPolicy = policy;
  admission = setup;
  clock = options.clock ?? Date.now;
}

/**
 * The mode that requires every signature either mode requires. pq_only requires the PQ signature
 * only, and classical_only and the hybrid modes require the classical one, so pq_only with any
 * other mode needs both: hybrid_required. A model choosing pq_only must not drop the classical
 * signature the operator requires.
 */
function requireBoth(a: VerificationMode, b: VerificationMode): VerificationMode {
  if (a === b) return a;
  if (a === 'pq_only' || b === 'pq_only') return 'hybrid_required';
  return stricterMode(a, b);
}

/** The operator policy made stricter, never weaker, by the tool's verifier_policy parameter. */
function tightenPolicy(base: VerifierPolicy, param: unknown): VerifierPolicy {
  const fields = checkPolicyFields(param, 'verifier_policy', PARAM_POLICY_FIELDS);
  const policy: VerifierPolicy = { ...base, risk_overrides: { ...base.risk_overrides } };
  if (fields.default_mode) {
    policy.default_mode = requireBoth(policy.default_mode, fields.default_mode);
    for (const tier of RISK_TIERS) policy.risk_overrides[tier] = requireBoth(policy.risk_overrides[tier], fields.default_mode);
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
  /** With trusted principals configured (spec/profiles/admission § 5.2): */
  admitted?: boolean;
  principal_trust?: PrincipalTrust;
  profile?: 'strict-v1' | null;
  profile_compliance?: ProfileCompliance;
  /** Always false: admitting the evidence does not authorize an action. */
  action_authorized?: false;
  /** The decision the bundle records (approve, escalate, block). */
  recorded_decision?: string | null;
  trust_set_version?: string | null;
  codes?: string[];
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

  if (admission) return admitBundle(admission, signedBundle, params.verifier_policy);

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

/**
 * dcp_verify_bundle with trusted principals: the result says whether the bundle is admitted
 * (spec/profiles/admission § 5) and names the agent only then; `verified` stays the verifier's
 * verdict. Under the profile its policy applies and the tool parameter is refused; otherwise the
 * parameter can only tighten the operator policy.
 */
async function admitBundle(setup: AdmissionSetup, signedBundle: Record<string, any>, param: unknown): Promise<VerifyBundleResult> {
  const version = detectVersion(signedBundle);
  const dcpVersion = version ?? 'unknown';
  const refused = { admitted: false, action_authorized: false as const };
  let policy: VerifierPolicy;
  if (setup.profile) {
    if (param !== undefined) {
      return failure(dcpVersion, ['verifier_policy cannot change the operator\'s strict-v1 profile'], { ...refused, profile: 'strict-v1' });
    }
    policy = setup.profile.policy as VerifierPolicy;
  } else {
    try {
      policy = tightenPolicy(operatorPolicy, param);
    } catch (err) {
      return failure(dcpVersion, [err instanceof Error ? err.message : String(err)], refused);
    }
  }

  const now = clock();
  const verdict = version === '2.0' ? await verifyV2(signedBundle, policy, now) : undefined;
  const result = await admit(setup, signedBundle, verdict?.verification, { tenant: '', now });
  const fields = {
    admitted: result.admitted,
    principal_trust: result.principal_trust,
    profile: result.profile,
    profile_compliance: result.profile_compliance,
    action_authorized: false as const,
    recorded_decision: result.recorded_decision,
    trust_set_version: result.trust_set_version,
    codes: [...new Set(result.errors.map((e) => e.code))].sort(),
    resolved_tier: verdict?.securityTier,
    verification_mode: verdict?.verificationMode,
  };
  if (!result.admitted) {
    const body = admissionFailure(result);
    return {
      verified: result.verified,
      dcp_version: dcpVersion,
      errors: body.errors,
      warnings: result.verification.warnings,
      message: `NOT ADMITTED (${body.codes.join(', ')}): ${body.errors.join('; ')}`,
      ...fields,
    };
  }
  const bundle = signedBundle.bundle;
  const agentId = bundle.agent_passport.payload.agent_id;
  const humanId = bundle.responsible_principal_record.payload.human_id;
  return {
    verified: true,
    dcp_version: '2.0',
    errors: [],
    warnings: result.verification.warnings,
    message:
      `V2 bundle admitted: principal ${humanId} trusted${result.profile ? ', strict-v1 met' : ''}. Agent ${agentId}. ` +
      `It records the decision ${String(result.recorded_decision)}; this is evidence, not an authorization to act.`,
    agent_id: agentId,
    human_id: humanId,
    session_nonce: bundle.manifest.session_nonce,
    ...fields,
  };
}
