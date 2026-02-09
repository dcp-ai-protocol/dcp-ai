/**
 * dcp_verify_bundle — Verify a DCP SignedBundle.
 *
 * Checks schema validation, Ed25519 signature, bundle hash, merkle root,
 * intent_hash chain, and prev_hash chain per the DCP verification spec.
 */
import { Type, type Static } from '@sinclair/typebox';
import { verifySignedBundle, type SignedBundle, type VerificationResult } from '@dcp-ai/sdk';

// ── Parameter Schema ──

export const VerifyBundleParams = Type.Object({
  signed_bundle: Type.Any({
    description:
      'The complete DCP SignedBundle object (JSON) to verify. Must contain "bundle" and "signature" fields.',
  }),
  public_key: Type.Optional(
    Type.String({
      description:
        'Ed25519 public key (base64). If omitted, the key from the bundle signer is used.',
    }),
  ),
});

export type VerifyBundleInput = Static<typeof VerifyBundleParams>;

// ── Execution ──

export interface VerifyBundleResult {
  verified: boolean;
  errors: string[];
  message: string;
  agent_id?: string;
  human_id?: string;
}

export async function executeVerifyBundle(
  params: VerifyBundleInput,
): Promise<VerifyBundleResult> {
  const signedBundle = params.signed_bundle as SignedBundle;

  if (!signedBundle?.bundle || !signedBundle?.signature) {
    return {
      verified: false,
      errors: ['Invalid input: signed_bundle must have "bundle" and "signature" fields.'],
      message: 'Verification failed: malformed signed bundle.',
    };
  }

  const result: VerificationResult = verifySignedBundle(
    signedBundle,
    params.public_key,
  );

  if (result.verified) {
    const agentId = signedBundle.bundle.agent_passport?.agent_id ?? 'unknown';
    const humanId = signedBundle.bundle.human_binding_record?.human_id ?? 'unknown';
    return {
      verified: true,
      errors: [],
      message: `Bundle verified successfully. Agent ${agentId} bound to ${humanId}.`,
      agent_id: agentId,
      human_id: humanId,
    };
  }

  return {
    verified: false,
    errors: result.errors ?? ['Unknown verification failure'],
    message: `Verification failed: ${(result.errors ?? []).join('; ')}`,
  };
}
