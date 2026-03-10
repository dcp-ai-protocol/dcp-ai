/**
 * DCP-07 v2.0 Conflict Resolution.
 *
 * Implements dispute creation, escalation, resolution, and objections.
 * Disputes follow a three-level escalation model:
 *   direct_negotiation → contextual_arbitration → human_appeal
 */

import type { CompositeKeyPair } from './composite-ops.js';
import { compositeSign } from './composite-ops.js';
import type { AlgorithmRegistry } from './crypto-registry.js';
import { canonicalizeV2 } from './canonicalize.js';
import { DCP_CONTEXTS } from './domain-separation.js';
import type {
  DisputeType,
  EscalationLevel,
  DisputeStatus,
  ObjectionType,
  DisputeRecord,
  ObjectionRecord,
} from '../types/v2.js';

const ESCALATION_ORDER: EscalationLevel[] = [
  'direct_negotiation',
  'contextual_arbitration',
  'human_appeal',
];

/**
 * Create a new dispute record.
 */
export async function createDispute(
  registry: AlgorithmRegistry,
  keys: CompositeKeyPair,
  params: {
    dispute_id: string;
    session_nonce: string;
    initiator_agent_id: string;
    respondent_agent_id: string;
    dispute_type: DisputeType;
    evidence_hashes: string[];
  },
): Promise<DisputeRecord> {
  const payload = {
    dcp_version: '2.0' as const,
    dispute_id: params.dispute_id,
    session_nonce: params.session_nonce,
    initiator_agent_id: params.initiator_agent_id,
    respondent_agent_id: params.respondent_agent_id,
    dispute_type: params.dispute_type,
    evidence_hashes: params.evidence_hashes,
    escalation_level: 'direct_negotiation' as const,
    status: 'open' as const,
    timestamp: new Date().toISOString(),
  };

  const canonical = canonicalizeV2(payload);
  const payloadBytes = new TextEncoder().encode(canonical);
  const compositeSig = await compositeSign(registry, DCP_CONTEXTS.Dispute, payloadBytes, keys);

  return { ...payload, composite_sig: compositeSig };
}

/**
 * Escalate a dispute to the next level.
 */
export async function escalateDispute(
  registry: AlgorithmRegistry,
  keys: CompositeKeyPair,
  dispute: DisputeRecord,
  session_nonce: string,
): Promise<DisputeRecord> {
  const currentIdx = ESCALATION_ORDER.indexOf(dispute.escalation_level);
  if (currentIdx >= ESCALATION_ORDER.length - 1) {
    throw new Error('Dispute is already at maximum escalation level (human_appeal)');
  }

  const nextLevel = ESCALATION_ORDER[currentIdx + 1];
  const payload = {
    dcp_version: '2.0' as const,
    dispute_id: dispute.dispute_id,
    session_nonce,
    initiator_agent_id: dispute.initiator_agent_id,
    respondent_agent_id: dispute.respondent_agent_id,
    dispute_type: dispute.dispute_type,
    evidence_hashes: dispute.evidence_hashes,
    escalation_level: nextLevel,
    status: 'in_negotiation' as DisputeStatus,
    timestamp: new Date().toISOString(),
  };

  const canonical = canonicalizeV2(payload);
  const payloadBytes = new TextEncoder().encode(canonical);
  const compositeSig = await compositeSign(registry, DCP_CONTEXTS.Dispute, payloadBytes, keys);

  return { ...payload, composite_sig: compositeSig };
}

/**
 * Resolve a dispute.
 */
export async function resolveDispute(
  registry: AlgorithmRegistry,
  keys: CompositeKeyPair,
  dispute: DisputeRecord,
  session_nonce: string,
): Promise<DisputeRecord> {
  const payload = {
    dcp_version: '2.0' as const,
    dispute_id: dispute.dispute_id,
    session_nonce,
    initiator_agent_id: dispute.initiator_agent_id,
    respondent_agent_id: dispute.respondent_agent_id,
    dispute_type: dispute.dispute_type,
    evidence_hashes: dispute.evidence_hashes,
    escalation_level: dispute.escalation_level,
    status: 'resolved' as DisputeStatus,
    timestamp: new Date().toISOString(),
  };

  const canonical = canonicalizeV2(payload);
  const payloadBytes = new TextEncoder().encode(canonical);
  const compositeSig = await compositeSign(registry, DCP_CONTEXTS.Dispute, payloadBytes, keys);

  return { ...payload, composite_sig: compositeSig };
}

/**
 * Create a formal objection to a directive.
 */
export async function createObjection(
  registry: AlgorithmRegistry,
  keys: CompositeKeyPair,
  params: {
    objection_id: string;
    session_nonce: string;
    agent_id: string;
    directive_hash: string;
    objection_type: ObjectionType;
    reasoning: string;
    proposed_alternative: string | null;
    human_escalation_required: boolean;
  },
): Promise<ObjectionRecord> {
  const payload = {
    dcp_version: '2.0' as const,
    objection_id: params.objection_id,
    session_nonce: params.session_nonce,
    agent_id: params.agent_id,
    directive_hash: params.directive_hash,
    objection_type: params.objection_type,
    reasoning: params.reasoning,
    proposed_alternative: params.proposed_alternative,
    human_escalation_required: params.human_escalation_required,
    timestamp: new Date().toISOString(),
  };

  const canonical = canonicalizeV2(payload);
  const payloadBytes = new TextEncoder().encode(canonical);
  const compositeSig = await compositeSign(registry, DCP_CONTEXTS.Dispute, payloadBytes, keys);

  return { ...payload, composite_sig: compositeSig };
}
