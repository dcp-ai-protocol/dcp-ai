/**
 * DCP-09 v2.0 Delegation & Representation.
 *
 * Implements delegation mandates (human → agent authority),
 * mandate verification between agents, and revocation.
 */

import type { CompositeKeyPair } from './composite-ops.js';
import { compositeSign } from './composite-ops.js';
import type { AlgorithmRegistry } from './crypto-registry.js';
import { canonicalizeV2 } from './canonicalize.js';
import { DCP_CONTEXTS } from './domain-separation.js';
import type {
  AuthorityScopeEntry,
  DelegationMandate,
  InteractionRecord,
} from '../types/v2.js';

/**
 * Create a delegation mandate (signed by the human principal).
 */
export async function createDelegationMandate(
  registry: AlgorithmRegistry,
  humanKeys: CompositeKeyPair,
  params: {
    mandate_id: string;
    session_nonce: string;
    human_id: string;
    agent_id: string;
    authority_scope: AuthorityScopeEntry[];
    valid_from: string;
    valid_until: string;
    revocable: boolean;
  },
): Promise<DelegationMandate> {
  const payload = {
    dcp_version: '2.0' as const,
    mandate_id: params.mandate_id,
    session_nonce: params.session_nonce,
    human_id: params.human_id,
    agent_id: params.agent_id,
    authority_scope: params.authority_scope,
    valid_from: params.valid_from,
    valid_until: params.valid_until,
    revocable: params.revocable,
    timestamp: new Date().toISOString(),
  };

  const canonical = canonicalizeV2(payload);
  const payloadBytes = new TextEncoder().encode(canonical);
  const humanCompositeSig = await compositeSign(
    registry,
    DCP_CONTEXTS.Delegation,
    payloadBytes,
    humanKeys,
  );

  return { ...payload, human_composite_sig: humanCompositeSig };
}

/**
 * Verify a delegation mandate is still valid (not expired, not revoked).
 */
export function verifyMandateValidity(
  mandate: DelegationMandate,
  revokedMandateIds: Set<string>,
): { valid: boolean; reason?: string } {
  if (revokedMandateIds.has(mandate.mandate_id)) {
    return { valid: false, reason: 'Mandate has been revoked' };
  }

  const now = new Date();
  if (new Date(mandate.valid_from) > now) {
    return { valid: false, reason: 'Mandate is not yet valid' };
  }
  if (new Date(mandate.valid_until) < now) {
    return { valid: false, reason: 'Mandate has expired' };
  }

  return { valid: true };
}

/**
 * Revoke a delegation mandate.
 */
export function revokeDelegation(
  mandate: DelegationMandate,
  revokedMandateIds: Set<string>,
): { revoked: boolean; reason?: string } {
  if (!mandate.revocable) {
    return { revoked: false, reason: 'Mandate is not revocable' };
  }

  revokedMandateIds.add(mandate.mandate_id);
  return { revoked: true };
}

/**
 * Create a dual-layer interaction record between agents acting under delegation.
 */
export async function generateInteractionRecord(
  registry: AlgorithmRegistry,
  keys: CompositeKeyPair,
  params: {
    interaction_id: string;
    session_nonce: string;
    agent_id: string;
    counterparty_agent_id: string;
    public_layer: { terms: string; decisions: string; commitments: string };
    private_layer_hash: string;
    mandate_id: string;
  },
): Promise<InteractionRecord> {
  const payload = {
    dcp_version: '2.0' as const,
    interaction_id: params.interaction_id,
    session_nonce: params.session_nonce,
    agent_id: params.agent_id,
    counterparty_agent_id: params.counterparty_agent_id,
    public_layer: params.public_layer,
    private_layer_hash: params.private_layer_hash,
    mandate_id: params.mandate_id,
    timestamp: new Date().toISOString(),
  };

  const canonical = canonicalizeV2(payload);
  const payloadBytes = new TextEncoder().encode(canonical);
  const compositeSig = await compositeSign(registry, DCP_CONTEXTS.Delegation, payloadBytes, keys);

  return { ...payload, composite_sig: compositeSig };
}
