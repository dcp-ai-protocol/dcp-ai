/**
 * dcp_verify_bundle — Verify a DCP SignedBundle (V1 or V2).
 *
 * A V2 bundle is verified only if `verifySignedBundleV2` from the SDK accepts
 * it: artifact payload hashes and manifest integrity, session binding and
 * expiry, the bundle's composite signature over the manifest, the verifier
 * policy mode, the audit hash chain and key validity.
 */
import { Type, type Static } from '@sinclair/typebox';
import {
  AlgorithmRegistry,
  DEFAULT_VERIFIER_POLICY,
  Ed25519Provider,
  MlDsa65Provider,
  SlhDsa192fProvider,
  verifySignedBundle,
  verifySignedBundleV2,
  detectDcpVersion,
  type VerificationResult,
  type SignedBundle,
  type SignedBundleV2,
  type SecurityTier,
  type VerificationMode,
  type VerifierPolicy,
} from '@dcp-ai/sdk';
import { resolveIntentTier } from './intent.js';

// ── Parameter Schema ──

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
        ], { description: 'Verification mode for every risk tier.' }),
      ),
      require_session_binding: Type.Optional(Type.Boolean()),
      require_composite_binding: Type.Optional(Type.Boolean()),
    }, { description: 'V2: verifier policy fields set over the SDK default policy.' }),
  ),
});

export type VerifyBundleInput = Static<typeof VerifyBundleParams>;

// ── Execution ──

export interface VerifyBundleResult {
  verified: boolean;
  dcp_version: '1.0' | '2.0' | 'unknown';
  errors: string[];
  warnings: string[];
  message: string;
  agent_id?: string;
  human_id?: string;
  session_nonce?: string;
  resolved_tier?: SecurityTier;
}

const VERIFICATION_MODES: readonly string[] = ['classical_only', 'hybrid_preferred', 'hybrid_required', 'pq_only'];
const SIGNED_ARTIFACTS = ['responsible_principal_record', 'agent_passport', 'intent', 'policy_decision'] as const;

// Built once: the providers the V2 verifier needs (Ed25519, ML-DSA-65, SLH-DSA-192f).
const registry = new AlgorithmRegistry();
for (const provider of [new Ed25519Provider(), new MlDsa65Provider(), new SlhDsa192fProvider()]) {
  registry.registerSigner(provider);
}

export async function executeVerifyBundle(
  params: VerifyBundleInput,
): Promise<VerifyBundleResult> {
  const signedBundle = params.signed_bundle;

  if (!signedBundle?.bundle && !signedBundle?.signature) {
    return {
      verified: false,
      dcp_version: 'unknown',
      errors: ['Invalid input: signed_bundle must have "bundle" and "signature" fields.'],
      warnings: [],
      message: 'Verification failed: malformed signed bundle.',
    };
  }

  const version = detectDcpVersion(signedBundle as Record<string, unknown>);

  if (version === '2.0') {
    return verifyV2Bundle(signedBundle, params);
  }

  if (version !== '1.0') {
    const error =
      'Unrecognized DCP bundle version: expected bundle.dcp_bundle_version "2.0" or bundle.responsible_principal_record.dcp_version "1.0"';
    return { verified: false, dcp_version: 'unknown', errors: [error], warnings: [], message: `Verification failed: ${error}` };
  }

  // V1: one Ed25519 signature, accepted only when the policy does not require a PQ one.
  const policy = resolvePolicy(params.verifier_policy);
  const refusal = typeof policy === 'string' ? policy : v1PolicyRefusal(policy);
  if (refusal) {
    return { verified: false, dcp_version: '1.0', errors: [refusal], warnings: [], message: `V1 verification failed: ${refusal}` };
  }

  const result: VerificationResult = verifySignedBundle(
    signedBundle as SignedBundle,
    params.public_key,
  );

  if (result.verified) {
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

  return {
    verified: false,
    dcp_version: '1.0',
    errors: result.errors ?? ['Unknown verification failure'],
    warnings: [],
    message: `V1 verification failed: ${(result.errors ?? []).join('; ')}`,
  };
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `verifier_policy` over the SDK's DEFAULT_VERIFIER_POLICY. A default_mode applies to every
 * risk tier (the default policy's risk_overrides would otherwise shadow it).
 */
function resolvePolicy(configured: VerifyBundleInput['verifier_policy']): VerifierPolicy | string {
  const policy: VerifierPolicy = { ...DEFAULT_VERIFIER_POLICY, risk_overrides: { ...DEFAULT_VERIFIER_POLICY.risk_overrides } };
  if (configured?.default_mode !== undefined) {
    const mode = configured.default_mode as VerificationMode;
    if (!VERIFICATION_MODES.includes(mode)) return `Unknown verification mode in verifier_policy: ${String(mode)}`;
    policy.default_mode = mode;
    policy.risk_overrides = { low: mode, medium: mode, high: mode };
  }
  if (configured?.require_session_binding !== undefined) {
    policy.require_session_binding = configured.require_session_binding;
  }
  if (configured?.require_composite_binding !== undefined) {
    policy.require_composite_binding = configured.require_composite_binding;
  }
  return policy;
}

/**
 * Why a V1 bundle (one Ed25519 signature, no post-quantum one) is refused under this policy, or
 * null. A V1 passport's risk tier is self-declared, so V1 is refused as soon as any tier requires
 * a post-quantum signature; the SDK's default policy does for the high tier.
 */
function v1PolicyRefusal(policy: VerifierPolicy): string | null {
  if (!policy.allow_v1_bundles) return 'V1 bundles are not accepted: verifier policy allow_v1_bundles is false';
  const modes = [policy.default_mode, ...Object.values(policy.risk_overrides)];
  const strict = modes.find((mode) => mode === 'hybrid_required' || mode === 'pq_only');
  if (strict) {
    return `V1 bundles are not accepted: the verifier policy requires ${strict} for a risk tier, and a V1 bundle has no post-quantum signature`;
  }
  return null;
}

/**
 * Shape checks that give clearer errors than the SDK's, and keep the published @dcp-ai/sdk
 * 2.1.x from throwing on a malformed bundle. Never a verdict on their own.
 */
function v2ShapeErrors(bundle: any, signature: any): string[] {
  if (!isObject(bundle) || !isObject(signature)) return ['Missing bundle or signature'];

  const errors: string[] = [];
  if (!isObject(bundle.manifest)) {
    errors.push('Missing manifest');
  } else if (typeof bundle.manifest.session_nonce !== 'string' || !/^[0-9a-f]{64}$/.test(bundle.manifest.session_nonce)) {
    errors.push('Invalid session_nonce in manifest');
  }
  for (const field of SIGNED_ARTIFACTS) {
    const art = bundle[field];
    if (!isObject(art) || !isObject(art.payload)) {
      errors.push(`Missing ${field} payload`);
    } else if (!isObject(art.composite_sig)) {
      errors.push(`Missing composite_sig in ${field}`);
    }
  }
  if (isObject(bundle.agent_passport?.payload) && !Array.isArray(bundle.agent_passport.payload.keys)) {
    errors.push('Missing agent_passport keys');
  }
  if (!Array.isArray(bundle.audit_entries)) errors.push('Missing audit_entries array');
  if (bundle.pq_checkpoints !== undefined && !Array.isArray(bundle.pq_checkpoints)) {
    errors.push('Invalid pq_checkpoints');
  }
  if (!isObject(signature.composite_sig) || !isObject(signature.composite_sig.classical)) {
    errors.push('Missing composite_sig in signature');
  }
  return errors;
}

async function runV2Verifier(signedBundle: any, policy: VerifierPolicy): Promise<{ errors: string[]; warnings: string[] }> {
  let result: Awaited<ReturnType<typeof verifySignedBundleV2>>;
  try {
    result = await verifySignedBundleV2(signedBundle as SignedBundleV2, registry, policy);
  } catch (err) {
    // @dcp-ai/sdk 2.1.x throws on some malformed bundles instead of failing closed.
    return { errors: [`V2 verification error: ${err instanceof Error ? err.message : String(err)}`], warnings: [] };
  }
  const errors = [...result.errors];
  // VERIFICATION.md V2-7: a PQ signature that is present must verify in every mode. @dcp-ai/sdk
  // 2.1.x accepts an invalid one under hybrid_preferred with a warning, but reports it in
  // details.signature_valid. pq_only does not require the classical signature.
  if (result.verified && result.details?.signature_valid !== true && result.details?.verification_mode !== 'pq_only') {
    errors.push('Bundle composite signature does not verify (a PQ signature that is present must verify)');
  }
  return { errors, warnings: result.warnings };
}

async function verifyV2Bundle(
  signedBundle: any,
  params: VerifyBundleInput,
): Promise<VerifyBundleResult> {
  const bundle = signedBundle.bundle;
  const signature = signedBundle.signature;

  const policy = resolvePolicy(params.verifier_policy);
  const shapeErrors = v2ShapeErrors(bundle, signature);
  let errors: string[];
  let warnings: string[] = [];
  if (typeof policy === 'string') errors = [policy];
  else if (shapeErrors.length > 0) errors = shapeErrors;
  else ({ errors, warnings } = await runV2Verifier(signedBundle, policy));

  const verified = errors.length === 0;
  const agentId = bundle?.agent_passport?.payload?.agent_id ?? 'unknown';
  const humanId = bundle?.responsible_principal_record?.payload?.human_id ?? 'unknown';
  const nonce = bundle?.manifest?.session_nonce;

  // Compute resolved tier from the intent if available
  let resolvedTier: SecurityTier | undefined;
  const intentPayload = bundle?.intent?.payload;
  if (isObject(intentPayload)) {
    resolvedTier = resolveIntentTier(intentPayload as any, bundle.policy_decision?.payload);
  }

  return {
    verified,
    dcp_version: '2.0',
    errors,
    warnings,
    message: verified
      ? `V2 bundle verified (tier: ${resolvedTier ?? 'unknown'}). Agent ${agentId} bound to ${humanId}. Session: ${nonce?.slice(0, 16)}...`
      : `V2 verification failed: ${errors.join('; ')}`,
    agent_id: agentId,
    human_id: humanId,
    session_nonce: nonce,
    resolved_tier: resolvedTier,
  };
}
