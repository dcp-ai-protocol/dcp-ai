/**
 * DCP v2.0 Session Nonce — anti-splicing defense.
 *
 * A 256-bit random nonce generated once per session and embedded in every
 * artifact. At verification time, the verifier checks that all artifacts
 * in a bundle share the same nonce.
 */

import { randomBytes } from 'crypto';

const SESSION_NONCE_BYTES = 32;
const SESSION_NONCE_HEX_LEN = 64;
const SESSION_NONCE_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Generate a cryptographically random 256-bit session nonce (64 hex chars).
 */
export function generateSessionNonce(): string {
  return randomBytes(SESSION_NONCE_BYTES).toString('hex');
}

/**
 * Validate that a string is a well-formed session nonce.
 */
export function isValidSessionNonce(nonce: string): boolean {
  return (
    typeof nonce === 'string' &&
    nonce.length === SESSION_NONCE_HEX_LEN &&
    SESSION_NONCE_PATTERN.test(nonce)
  );
}

/**
 * Verify that all artifacts in a set share the same session_nonce.
 * Returns { valid, nonce } on success or { valid: false, error } on failure.
 */
export function verifySessionBinding(
  artifacts: Array<{ session_nonce?: string }>,
): { valid: boolean; nonce?: string; error?: string } {
  if (artifacts.length === 0) {
    return { valid: false, error: 'No artifacts to verify' };
  }

  const first = artifacts[0].session_nonce;
  if (!first || !isValidSessionNonce(first)) {
    return { valid: false, error: `Invalid session_nonce in artifact[0]: ${first}` };
  }

  for (let i = 1; i < artifacts.length; i++) {
    const nonce = artifacts[i].session_nonce;
    if (nonce !== first) {
      return {
        valid: false,
        error: `Session nonce mismatch: artifact[0]=${first}, artifact[${i}]=${nonce}`,
      };
    }
  }

  return { valid: true, nonce: first };
}

const DEFAULT_SESSION_DURATIONS: Record<string, number> = {
  routine: 86400,
  standard: 14400,
  elevated: 3600,
  maximum: 900,
};

/**
 * Generate an ISO 8601 session expiry timestamp.
 * @param durationSeconds - how long the session is valid (default: 4 hours)
 */
export function generateSessionExpiry(durationSeconds?: number, tier?: string): string {
  const duration = durationSeconds ?? (tier ? DEFAULT_SESSION_DURATIONS[tier] ?? 14400 : 14400);
  return new Date(Date.now() + duration * 1000).toISOString();
}

/**
 * Check whether a session_expires_at timestamp has passed.
 */
export function isSessionExpired(expiresAt: string): boolean {
  return new Date(expiresAt) < new Date();
}
