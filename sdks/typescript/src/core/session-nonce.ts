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
  // An unknown tier name gets the elevated duration, never a longer one.
  const known = tier && (Object.hasOwn(DEFAULT_SESSION_DURATIONS, tier) ? tier : 'elevated');
  const duration = durationSeconds ?? (known ? DEFAULT_SESSION_DURATIONS[known] : 14400);
  return new Date(Date.now() + duration * 1000).toISOString();
}

const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * Milliseconds since the Unix epoch of an RFC 3339 timestamp with a `Z` or
 * `±hh:mm` offset, or undefined for anything else: a date without a time, a
 * time without an offset, an impossible date or time (which `Date.parse` would
 * roll over or accept), or a non-string. Digits beyond milliseconds are dropped.
 */
export function parseRfc3339(value: unknown): number | undefined {
  const m = typeof value === 'string' ? RFC3339.exec(value) : null;
  if (!m) return undefined;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  const [offsetHours, offsetMinutes] = [Number(m[9] ?? 0), Number(m[10] ?? 0)];
  const lastDay = new Date(0);
  lastDay.setUTCFullYear(year, month, 0);
  if (
    month < 1 || month > 12 || day < 1 || day > lastDay.getUTCDate() ||
    hour > 23 || minute > 59 || second > 59 || offsetHours > 23 || offsetMinutes > 59
  ) {
    return undefined;
  }
  const t = new Date(0);
  t.setUTCFullYear(year, month - 1, day);
  t.setUTCHours(hour, minute, second, Number((m[7] ?? '').slice(0, 3).padEnd(3, '0')));
  const offset = (m[8] === '-' ? -1 : 1) * (offsetHours * 60 + offsetMinutes);
  return t.getTime() - offset * 60_000;
}

/**
 * Check whether a session_expires_at timestamp has passed. A value that is not
 * an RFC 3339 timestamp counts as expired, so a malformed expiry fails closed.
 */
export function isSessionExpired(expiresAt: string): boolean {
  const expires = parseRfc3339(expiresAt);
  return expires === undefined || expires < Date.now();
}
