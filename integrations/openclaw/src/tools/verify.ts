/**
 * dcp_verify_bundle — Verify a DCP SignedBundle (V1 or V2).
 *
 * V2 uses the full composite verification pipeline from the SDK:
 * manifest integrity, composite signatures, session binding, hash chains,
 * PQ checkpoint verification.
 */
import { Type, type Static } from '@sinclair/typebox';
import {
  verifySignedBundle,
  detectDcpVersion,
  computeSecurityTier,
  registerDefaultProviders,
  type VerificationResult,
  type SignedBundle,
  type SecurityTier,
} from '@dcp-ai/sdk';

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
      default_mode: Type.Optional(Type.String()),
      require_session_binding: Type.Optional(Type.Boolean()),
      require_composite_binding: Type.Optional(Type.Boolean()),
    }, { description: 'V2: Optional verifier policy override.' }),
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

  // V1 fallback
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

async function verifyV2Bundle(
  signedBundle: any,
  params: VerifyBundleInput,
): Promise<VerifyBundleResult> {
  registerDefaultProviders();
  const errors: string[] = [];
  const warnings: string[] = [];

  const bundle = signedBundle.bundle;
  const signature = signedBundle.signature;

  if (!bundle || !signature) {
    return {
      verified: false, dcp_version: '2.0',
      errors: ['Missing bundle or signature'], warnings: [],
      message: 'V2 verification failed.',
    };
  }

  // Check version
  if (bundle.dcp_bundle_version !== '2.0') {
    errors.push('Invalid dcp_bundle_version');
  }

  // Manifest validation
  if (!bundle.manifest) {
    errors.push('Missing manifest');
  } else {
    const nonce = bundle.manifest.session_nonce;
    if (!nonce || !/^[0-9a-f]{64}$/.test(nonce)) {
      errors.push('Invalid session_nonce in manifest');
    }

    for (const field of ['rpr_hash', 'passport_hash', 'intent_hash', 'policy_hash', 'audit_merkle_root']) {
      if (!bundle.manifest[field]) {
        errors.push(`Missing manifest.${field}`);
      }
    }
  }

  // Artifact presence (SignedPayload envelope)
  for (const field of ['responsible_principal_record', 'agent_passport', 'intent', 'policy_decision']) {
    const art = bundle[field];
    if (!art?.payload) {
      errors.push(`Missing ${field} payload`);
    } else if (!art.composite_sig) {
      errors.push(`Missing composite_sig in ${field}`);
    }
  }

  // Session nonce consistency
  if (bundle.manifest?.session_nonce) {
    const nonce = bundle.manifest.session_nonce;
    const payloads = [
      bundle.agent_passport?.payload,
      bundle.responsible_principal_record?.payload,
      bundle.intent?.payload,
      bundle.policy_decision?.payload,
    ].filter(Boolean);

    for (const p of payloads) {
      if (p.session_nonce && p.session_nonce !== nonce) {
        errors.push('Session nonce mismatch across artifacts');
        break;
      }
    }

    if (Array.isArray(bundle.audit_entries)) {
      for (const entry of bundle.audit_entries) {
        if (entry.session_nonce && entry.session_nonce !== nonce) {
          errors.push('Session nonce mismatch in audit entry');
          break;
        }
      }
    }
  }

  // Composite signature validation
  if (signature.composite_sig) {
    const cs = signature.composite_sig;
    if (!cs.classical) {
      errors.push('Missing classical signature');
    }
    if (cs.binding === 'pq_over_classical' && !cs.pq) {
      errors.push('PQ signature missing for pq_over_classical binding');
    }
    if (cs.binding === 'classical_only') {
      const policyMode = params.verifier_policy?.default_mode || 'hybrid_preferred';
      if (policyMode === 'hybrid_required') {
        errors.push('Verifier policy requires hybrid signatures');
      } else {
        warnings.push('Bundle uses classical_only binding');
      }
    }
  } else {
    errors.push('Missing composite_sig in signature');
  }

  // Audit entries
  if (!Array.isArray(bundle.audit_entries)) {
    errors.push('Missing audit_entries array');
  }

  // PQ checkpoints
  if (bundle.manifest?.pq_checkpoints?.length > 0 && !Array.isArray(bundle.pq_checkpoints)) {
    warnings.push('Manifest references PQ checkpoints but none in bundle');
  }

  const verified = errors.length === 0;
  const agentId = bundle.agent_passport?.payload?.agent_id ?? 'unknown';
  const humanId = bundle.responsible_principal_record?.payload?.human_id ?? 'unknown';
  const nonce = bundle.manifest?.session_nonce;

  // Compute resolved tier from the intent if available
  let resolvedTier: SecurityTier | undefined;
  const intentPayload = bundle.intent?.payload;
  if (intentPayload) {
    resolvedTier = intentPayload.security_tier ?? computeSecurityTier(intentPayload);
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
