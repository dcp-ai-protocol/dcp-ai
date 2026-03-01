/**
 * DCP v2.0 Emergency Revocation (Gap #13).
 *
 * Pre-registered revocation token allows revoking all agent keys without
 * requiring a private key signature. The human stores the secret offline;
 * revealing the pre-image proves authorization.
 *
 * Token lifecycle:
 *   1. At identity creation: secret = random(32), token = sha256(secret)
 *   2. Token is stored in AgentPassportV2.emergency_revocation_token
 *   3. Secret is stored offline by the human
 *   4. On emergency: human reveals secret, gateway verifies sha256(secret) == token
 */

import { randomBytes, createHash } from 'crypto';
import type { EmergencyRevocation } from '../types/v2.js';

export interface EmergencyRevocationTokenPair {
  /** The secret to store offline (64 hex chars). */
  revocation_secret: string;
  /** The commitment to embed in the passport: "sha256:<hex>". */
  emergency_revocation_token: string;
}

/**
 * Generate a revocation secret and its commitment token.
 * The secret MUST be stored offline; the token goes in the passport.
 */
export function generateEmergencyRevocationToken(): EmergencyRevocationTokenPair {
  const secretBytes = randomBytes(32);
  const secret = secretBytes.toString('hex');
  const hash = createHash('sha256').update(secretBytes).digest('hex');
  return {
    revocation_secret: secret,
    emergency_revocation_token: `sha256:${hash}`,
  };
}

/**
 * Verify that a revocation secret matches the commitment token in a passport.
 *
 * @param revocationSecret - The 64-char hex pre-image
 * @param commitmentToken - The "sha256:<hex>" token from the passport
 * @returns true if sha256(secret) matches the commitment
 */
export function verifyEmergencyRevocationSecret(
  revocationSecret: string,
  commitmentToken: string,
): boolean {
  if (!commitmentToken.startsWith('sha256:')) return false;
  const expectedHex = commitmentToken.slice('sha256:'.length);
  const secretBytes = Buffer.from(revocationSecret, 'hex');
  if (secretBytes.length !== 32) return false;
  const actualHex = createHash('sha256').update(secretBytes).digest('hex');
  return actualHex === expectedHex;
}

/**
 * Build an EmergencyRevocation request object.
 */
export function buildEmergencyRevocation(params: {
  agentId: string;
  humanId: string;
  revocationSecret: string;
}): EmergencyRevocation {
  return {
    type: 'emergency_revocation',
    agent_id: params.agentId,
    human_id: params.humanId,
    revocation_secret: params.revocationSecret,
    timestamp: new Date().toISOString(),
    reason: 'key_compromise_emergency',
  };
}
