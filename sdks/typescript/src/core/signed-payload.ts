/**
 * DCP v2.0 SignedPayload envelope.
 *
 * The artifact (payload) never contains signature data. Signatures live in a
 * sibling field. Canonicalization is always over `payload` — no field
 * stripping needed.
 */

import type { CompositeSignature } from './composite-sig.js';
import { canonicalizeV2 } from './canonicalize.js';
import { sha256Hex } from './dual-hash.js';

export interface SignedPayload<T = unknown> {
  payload: T;
  payload_hash: string;
  composite_sig: CompositeSignature;
}

/**
 * Compute the canonical bytes and hash for a payload.
 * Returns { canonicalBytes, payloadHash } where payloadHash is "sha256:<hex>".
 */
export function preparePayload(payload: unknown): {
  canonicalBytes: Uint8Array;
  payloadHash: string;
} {
  const canonical = canonicalizeV2(payload);
  const bytes = new TextEncoder().encode(canonical);
  const hash = sha256Hex(bytes);
  return {
    canonicalBytes: bytes,
    payloadHash: `sha256:${hash}`,
  };
}

/**
 * Verify that a SignedPayload's payload_hash matches the actual payload.
 */
export function verifyPayloadHash(signed: SignedPayload): boolean {
  const { payloadHash } = preparePayload(signed.payload);
  return signed.payload_hash === payloadHash;
}
