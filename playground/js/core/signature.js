// playground/js/core/signature.js — Composite signature builder (classical + PQ simulated)

import { signDetached } from './crypto.js';
import { canonicalize, sha256 } from './hash.js';
import { b64encode } from './utils.js';

/**
 * Build a v2 composite signature { classical, pq, binding }.
 * PQ part is simulated (HMAC placeholder) unless pqKeypair provided.
 */
export async function buildCompositeSig(payload, context, keypair) {
  const sigBytes = signDetached(payload, context, keypair.secretKey);
  const classical = {
    alg: 'ed25519',
    kid: keypair.kid,
    sig_b64: b64encode(sigBytes),
  };

  // Simulated ML-DSA-65 PQ signature
  const pqSig = await sha256('pq-sim:' + canonicalize(payload));
  const pq = {
    alg: 'ml-dsa-65-sim',
    kid: keypair.kid,
    sig_b64: btoa(pqSig),
  };

  return { classical, pq, binding: 'pq_over_classical' };
}

/**
 * Build classical-only composite signature.
 */
export function buildClassicalSig(payload, context, keypair) {
  const sigBytes = signDetached(payload, context, keypair.secretKey);
  return {
    classical: {
      alg: 'ed25519',
      kid: keypair.kid,
      sig_b64: b64encode(sigBytes),
    },
    pq: null,
    binding: 'classical_only',
  };
}

/**
 * Create signed payload wrapper (for bundle builder backward compat).
 */
export function signPayload(payload, context, keypair) {
  const sigBytes = signDetached(payload, context, keypair.secretKey);
  return {
    payload,
    signatures: [
      {
        kid: keypair.kid,
        alg: 'ed25519',
        sig_b64: b64encode(sigBytes),
        context,
      },
    ],
  };
}
