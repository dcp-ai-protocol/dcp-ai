/**
 * Sign and wrap a Citizenship Bundle into a Signed Bundle.
 */
import { createHash } from 'crypto';
import type {
  CitizenshipBundle,
  SignedBundle,
  SignerType,
} from '../types/index.js';
import { canonicalize, signObject, publicKeyFromSecret } from '../core/crypto.js';
import { merkleRootForAuditEntries } from '../core/merkle.js';

export interface SignOptions {
  /** Ed25519 secret key (base64). */
  secretKeyB64: string;
  /** Signer type: 'human' or 'organization'. */
  signerType?: SignerType;
  /** Signer identifier (e.g. DID). */
  signerId?: string;
}

/**
 * Sign a Citizenship Bundle and produce a Signed Bundle.
 */
export function signBundle(
  bundle: CitizenshipBundle,
  options: SignOptions,
): SignedBundle {
  const { secretKeyB64, signerType = 'human', signerId } = options;

  const publicKeyB64 = publicKeyFromSecret(secretKeyB64);

  // Deterministic bundle hash
  const bundleHashHex = createHash('sha256')
    .update(canonicalize(bundle), 'utf8')
    .digest('hex');

  // Merkle root for audit entries
  const merkleHex = Array.isArray(bundle.audit_entries)
    ? merkleRootForAuditEntries(bundle.audit_entries)
    : null;

  // Ed25519 detached signature
  const sigB64 = signObject(bundle, secretKeyB64);

  return {
    bundle,
    signature: {
      alg: 'ed25519',
      created_at: new Date().toISOString(),
      signer: {
        type: signerType,
        id: signerId || bundle.human_binding_record?.human_id || 'unknown',
        public_key_b64: publicKeyB64,
      },
      bundle_hash: `sha256:${bundleHashHex}`,
      merkle_root: merkleHex ? `sha256:${merkleHex}` : null,
      sig_b64: sigB64,
    },
  };
}
