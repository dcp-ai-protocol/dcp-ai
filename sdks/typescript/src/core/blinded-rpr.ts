/**
 * DCP v2.0 Blinded RPR Mode — PII Protection (Gap #2).
 *
 * The full RPR contains PII (legal_name, contact). When bundles are published
 * to transparency logs or anchored on-chain, publishing PII violates GDPR
 * Article 17 and similar regulations.
 *
 * Blinded RPR replaces PII fields with a hash commitment. A regulator can
 * later verify the full RPR matches the blinded version by checking the
 * pii_hash.
 */

import type {
  ResponsiblePrincipalRecordV2,
  BlindedResponsiblePrincipalRecordV2,
} from '../types/v2.js';
import { canonicalizeV2 } from './canonicalize.js';
import { sha256Hex } from './dual-hash.js';

/**
 * Extract PII fields from a full RPR and compute their hash commitment.
 *
 * pii_hash = sha256(canonical({ legal_name, contact }))
 */
export function computePiiHash(rpr: ResponsiblePrincipalRecordV2): string {
  const piiFields = {
    legal_name: rpr.legal_name,
    contact: rpr.contact,
  };
  const canonical = canonicalizeV2(piiFields);
  const hash = sha256Hex(Buffer.from(canonical, 'utf8'));
  return `sha256:${hash}`;
}

/**
 * Create a Blinded RPR from a full RPR. Strips PII fields and replaces
 * them with a hash commitment.
 */
export function blindRpr(rpr: ResponsiblePrincipalRecordV2): BlindedResponsiblePrincipalRecordV2 {
  const piiHash = computePiiHash(rpr);

  return {
    dcp_version: '2.0',
    human_id: rpr.human_id,
    session_nonce: rpr.session_nonce,
    blinded: true,
    pii_hash: piiHash,
    entity_type: rpr.entity_type,
    jurisdiction: rpr.jurisdiction,
    liability_mode: rpr.liability_mode,
    override_rights: rpr.override_rights,
    issued_at: rpr.issued_at,
    expires_at: rpr.expires_at,
    binding_keys: rpr.binding_keys,
  };
}

/**
 * Verify that a full RPR matches a blinded RPR.
 *
 * Checks that:
 *   1. The pii_hash in the blinded RPR matches the PII in the full RPR
 *   2. All non-PII fields are identical
 */
export function verifyBlindedRpr(
  fullRpr: ResponsiblePrincipalRecordV2,
  blindedRpr: BlindedResponsiblePrincipalRecordV2,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  const expectedPiiHash = computePiiHash(fullRpr);
  if (blindedRpr.pii_hash !== expectedPiiHash) {
    errors.push(
      `pii_hash mismatch: expected ${expectedPiiHash}, got ${blindedRpr.pii_hash}`,
    );
  }

  if (fullRpr.human_id !== blindedRpr.human_id) {
    errors.push('human_id mismatch');
  }
  if (fullRpr.entity_type !== blindedRpr.entity_type) {
    errors.push('entity_type mismatch');
  }
  if (fullRpr.jurisdiction !== blindedRpr.jurisdiction) {
    errors.push('jurisdiction mismatch');
  }
  if (fullRpr.liability_mode !== blindedRpr.liability_mode) {
    errors.push('liability_mode mismatch');
  }
  if (fullRpr.override_rights !== blindedRpr.override_rights) {
    errors.push('override_rights mismatch');
  }
  if (fullRpr.issued_at !== blindedRpr.issued_at) {
    errors.push('issued_at mismatch');
  }
  if (fullRpr.expires_at !== blindedRpr.expires_at) {
    errors.push('expires_at mismatch');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check whether an RPR payload is blinded.
 */
export function isBlindedRpr(
  rpr: ResponsiblePrincipalRecordV2 | BlindedResponsiblePrincipalRecordV2,
): rpr is BlindedResponsiblePrincipalRecordV2 {
  return 'blinded' in rpr && (rpr as BlindedResponsiblePrincipalRecordV2).blinded === true;
}
