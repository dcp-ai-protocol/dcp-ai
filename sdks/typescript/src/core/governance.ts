/**
 * DCP v2.0 Governance Key Ceremony (Phase 3).
 *
 * Governance keys are M-of-N multi-party keys used to sign algorithm
 * advisories and protocol-level decisions. The ceremony generates the
 * governance key set, distributes key material, and produces the initial
 * governance configuration published at:
 *
 *   https://dcp-ai.org/.well-known/governance-keys.json
 *
 * Security properties:
 *   - No single party can sign an advisory alone
 *   - Each governance signer holds both Ed25519 + ML-DSA-65 keys
 *   - Composite-bound signatures required on all governance actions
 *   - Key material generated locally by each participant (keys never
 *     leave the signer's device / HSM)
 */

import { createHash, randomBytes } from 'crypto';
import type { KeyEntry } from './crypto-provider.js';
import { deriveKid } from './crypto-provider.js';
import type { CompositeSignature, SignatureEntry } from './composite-sig.js';
import type { AlgorithmAdvisory, GovernanceKeySet } from '../types/v2.js';
import { canonicalizeV2 } from './canonicalize.js';
import { domainSeparatedMessage } from './domain-separation.js';
import type { AlgorithmRegistry } from './crypto-registry.js';

const GOVERNANCE_CONTEXT = 'DCP-AI.v2.Governance';
const ADVISORY_SIGN_CONTEXT = 'DCP-AI.v2.AlgorithmAdvisory';

export interface GovernanceParticipant {
  participant_id: string;
  display_name: string;
  ed25519_kid: string;
  ed25519_public_key_b64: string;
  mldsa65_kid: string;
  mldsa65_public_key_b64: string;
}

export interface GovernanceCeremonyOutput {
  governance_key_set: GovernanceKeySet;
  participants: GovernanceParticipant[];
  ceremony_hash: string;
  created_at: string;
}

export interface GovernanceAdvisorySignRequest {
  advisory: AlgorithmAdvisory;
  signer_id: string;
  ed25519_secret_b64: string;
  mldsa65_secret_b64: string;
}

export interface GovernanceAdvisorySignature {
  party_id: string;
  ed25519_kid: string;
  mldsa65_kid: string;
  composite_sig: CompositeSignature;
}

/**
 * Generate a governance participant's key material.
 *
 * In production, this runs on each participant's secure workstation
 * or HSM. The private keys never leave the participant's device.
 */
export async function generateGovernanceParticipant(
  registry: AlgorithmRegistry,
  participantId: string,
  displayName: string,
): Promise<{
  participant: GovernanceParticipant;
  secrets: { ed25519_secret_b64: string; mldsa65_secret_b64: string };
}> {
  const ed25519 = registry.getSigner('ed25519');
  const mlDsa65 = registry.getSigner('ml-dsa-65');

  const edKp = await ed25519.generateKeypair();
  const pqKp = await mlDsa65.generateKeypair();

  return {
    participant: {
      participant_id: participantId,
      display_name: displayName,
      ed25519_kid: edKp.kid,
      ed25519_public_key_b64: edKp.publicKeyB64,
      mldsa65_kid: pqKp.kid,
      mldsa65_public_key_b64: pqKp.publicKeyB64,
    },
    secrets: {
      ed25519_secret_b64: edKp.secretKeyB64,
      mldsa65_secret_b64: pqKp.secretKeyB64,
    },
  };
}

/**
 * Execute the governance key ceremony.
 *
 * Takes a list of participants (each having already generated their keys)
 * and produces the governance key set configuration.
 */
export function executeGovernanceCeremony(
  governanceId: string,
  threshold: number,
  participants: GovernanceParticipant[],
  description: string,
): GovernanceCeremonyOutput {
  if (participants.length < threshold) {
    throw new Error(
      `Governance ceremony: need at least ${threshold} participants, got ${participants.length}`,
    );
  }

  if (threshold < 2) {
    throw new Error('Governance ceremony: threshold must be >= 2');
  }

  const keys: KeyEntry[] = [];
  for (const p of participants) {
    keys.push({
      kid: p.ed25519_kid,
      alg: 'ed25519',
      public_key_b64: p.ed25519_public_key_b64,
      created_at: new Date().toISOString(),
      expires_at: null,
      status: 'active',
    });
    keys.push({
      kid: p.mldsa65_kid,
      alg: 'ml-dsa-65',
      public_key_b64: p.mldsa65_public_key_b64,
      created_at: new Date().toISOString(),
      expires_at: null,
      status: 'active',
    });
  }

  const governanceKeySet: GovernanceKeySet = {
    governance_id: governanceId,
    keys,
    threshold,
    created_at: new Date().toISOString(),
    description,
  };

  const ceremonyPayload = canonicalizeV2({
    governance_id: governanceId,
    threshold,
    participant_ids: participants.map((p) => p.participant_id).sort(),
    key_count: keys.length,
  });

  const ceremonyHash =
    'sha256:' + createHash('sha256').update(ceremonyPayload).digest('hex');

  return {
    governance_key_set: governanceKeySet,
    participants,
    ceremony_hash: ceremonyHash,
    created_at: new Date().toISOString(),
  };
}

/**
 * Sign an algorithm advisory as a governance participant.
 *
 * The advisory payload (excluding composite_sig) is signed with a composite
 * signature (Ed25519 + ML-DSA-65) under the AlgorithmAdvisory context.
 */
export async function signAdvisoryAsGovernance(
  registry: AlgorithmRegistry,
  request: GovernanceAdvisorySignRequest,
  participant: GovernanceParticipant,
): Promise<GovernanceAdvisorySignature> {
  const advisoryPayload = canonicalizeV2({
    advisory_id: request.advisory.advisory_id,
    severity: request.advisory.severity,
    affected_algorithms: request.advisory.affected_algorithms,
    action: request.advisory.action,
    replacement_algorithms: request.advisory.replacement_algorithms,
    effective_date: request.advisory.effective_date,
    grace_period_days: request.advisory.grace_period_days,
    description: request.advisory.description,
    issued_at: request.advisory.issued_at,
    issuer: request.advisory.issuer,
  });

  const payloadBytes = new TextEncoder().encode(advisoryPayload);
  const dsm = domainSeparatedMessage(ADVISORY_SIGN_CONTEXT, payloadBytes);

  const ed25519Provider = registry.getSigner('ed25519');
  const mlDsaProvider = registry.getSigner('ml-dsa-65');

  const classicalSig = await ed25519Provider.sign(dsm, request.ed25519_secret_b64);

  const compositeMessage = new Uint8Array(dsm.length + classicalSig.length);
  compositeMessage.set(dsm);
  compositeMessage.set(classicalSig, dsm.length);
  const pqSig = await mlDsaProvider.sign(compositeMessage, request.mldsa65_secret_b64);

  return {
    party_id: request.signer_id,
    ed25519_kid: participant.ed25519_kid,
    mldsa65_kid: participant.mldsa65_kid,
    composite_sig: {
      classical: {
        alg: 'ed25519',
        kid: participant.ed25519_kid,
        sig_b64: Buffer.from(classicalSig).toString('base64'),
      },
      pq: {
        alg: 'ml-dsa-65',
        kid: participant.mldsa65_kid,
        sig_b64: Buffer.from(pqSig).toString('base64'),
      },
      binding: 'pq_over_classical',
    },
  };
}

/**
 * Aggregate governance signatures and check if threshold is met.
 */
export function aggregateGovernanceSignatures(
  signatures: GovernanceAdvisorySignature[],
  threshold: number,
): {
  thresholdMet: boolean;
  signatureCount: number;
  signers: string[];
} {
  const uniqueSigners = new Set(signatures.map((s) => s.party_id));
  return {
    thresholdMet: uniqueSigners.size >= threshold,
    signatureCount: uniqueSigners.size,
    signers: [...uniqueSigners],
  };
}

/**
 * Publish the governance key set as a well-known JSON document.
 *
 * In production, this is served at:
 *   https://dcp-ai.org/.well-known/governance-keys.json
 */
export function formatGovernanceKeysDocument(
  ceremony: GovernanceCeremonyOutput,
): Record<string, unknown> {
  return {
    governance_id: ceremony.governance_key_set.governance_id,
    threshold: ceremony.governance_key_set.threshold,
    participants: ceremony.participants.map((p) => ({
      participant_id: p.participant_id,
      display_name: p.display_name,
      keys: [
        { kid: p.ed25519_kid, alg: 'ed25519', public_key_b64: p.ed25519_public_key_b64 },
        { kid: p.mldsa65_kid, alg: 'ml-dsa-65', public_key_b64: p.mldsa65_public_key_b64 },
      ],
    })),
    ceremony_hash: ceremony.ceremony_hash,
    created_at: ceremony.created_at,
    spec_version: '2.0',
  };
}
