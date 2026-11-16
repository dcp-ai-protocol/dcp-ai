/**
 * DCP-AI ↔ A2A (Agent-to-Agent) protocol bridge.
 *
 * Bridges DCP Agent Passports and A2A Agent Cards. A signed passport travels inside the
 * card's `capabilities.extensions` (see passport.ts), so an A2A consumer can verify the
 * agent's DCP identity offline before delegating a task.
 */
import crypto from 'crypto';
import { attachPassportToAgentCard, agentCardPassport, isSignedPassport, type AgentCard, type SignedPassport } from './passport.js';

export {
  attachPassportToAgentCard,
  agentCardPassport,
  verifyAgentCardPassport,
  isSignedPassport,
  DCP_PASSPORT_EXTENSION_URI,
  type AgentCard,
  type AgentExtension,
  type SignedPassport,
  type VerifyAgentCardPassportOptions,
  type AgentCardPassportResult,
} from './passport.js';

type Dict = Record<string, any>;

/**
 * Convert a DCP Agent Passport to an A2A Agent Card. Given the signed passport
 * (`SignedPayload<AgentPassportV2>`), the card also carries it in the DCP passport
 * extension, where `verifyAgentCardPassport` finds it.
 * @param passport - DCP Agent Passport, signed or bare
 * @param a2aEndpoint - URL endpoint for the A2A agent
 */
export function passportToAgentCard(passport: SignedPassport | Dict, a2aEndpoint: string): AgentCard {
  if (isSignedPassport(passport)) {
    return attachPassportToAgentCard(passportToAgentCard(passport.payload as Dict, a2aEndpoint), passport);
  }
  return {
    name: passport.agent_name,
    description: `DCP-certified agent: ${passport.agent_id}`,
    url: a2aEndpoint,
    provider: {
      organization: passport.jurisdiction || 'DCP-AI Network',
      url: 'https://dcp-ai.org',
    },
    version: '1.0',
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    authentication: {
      schemes: ['dcp-bundle'],
      credentials: null,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: (passport.capabilities || []).map((cap: string) => ({
      id: cap,
      name: cap.replace(/_/g, ' '),
      description: `DCP capability: ${cap}`,
      tags: ['dcp', cap],
    })),
    metadata: {
      dcp_agent_id: passport.agent_id,
      dcp_version: passport.dcp_version || '2.0',
      dcp_security_tier: 'standard',
      dcp_owner_rpr_hash: passport.owner_rpr_hash ?? passport.principal_binding_reference ?? null,
      dcp_lifecycle_state: passport.status || 'active',
      dcp_mandate_id: passport.mandate_id || null,
    },
  };
}

/**
 * Convert an A2A Agent Card to a DCP Agent Passport. A card with the DCP passport extension
 * yields that passport's payload as signed (verify it first with `verifyAgentCardPassport`);
 * any other card yields a skeleton that still needs keys and a signature.
 * @param card - A2A Agent Card
 */
export function agentCardToPassport(card: AgentCard): Dict {
  const signed = agentCardPassport(card);
  if (signed) return signed.payload;
  return {
    dcp_version: '2.0',
    schema: 'agent_passport_v2',
    agent_id: card.metadata?.dcp_agent_id || `agent:a2a-${card.name?.toLowerCase().replace(/\s+/g, '-')}`,
    agent_name: card.name || 'a2a-imported-agent',
    model: 'google-a2a',
    capabilities: (card.skills || []).map((s) => s.id),
    owner_rpr_hash: card.metadata?.dcp_owner_rpr_hash || '',
    keys: [],
    created_at: new Date().toISOString(),
    status: card.metadata?.dcp_lifecycle_state || 'active',
    liability_mode: 'delegated',
    jurisdiction: card.provider?.organization || 'unknown',
  };
}

/**
 * Wrap a Google A2A Task message with DCP audit entry.
 * @param task - Google A2A Task
 * @param agentId - DCP agent ID
 * @param intentId - DCP intent ID
 * @returns Task wrapped with DCP audit metadata
 */
export function wrapA2ATaskWithAudit(task: Dict, agentId: string, intentId: string) {
  return {
    dcp_audit: {
      event_type: 'a2a_task_execution',
      agent_id: agentId,
      intent_id: intentId,
      task_id: task.id,
      task_status: task.status?.state || 'unknown',
      timestamp: new Date().toISOString(),
    },
    a2a_task: task,
  };
}

/**
 * Create a DCP Intent from a Google A2A Task request.
 * @param task - Google A2A Task
 * @param agentId - DCP agent ID
 * @returns DCP Intent
 */
export function a2aTaskToIntent(task: Dict, agentId: string) {
  return {
    dcp_version: '2.0',
    schema: 'intent_v2',
    intent_id: `intent:a2a-${task.id || crypto.randomUUID()}`,
    agent_id: agentId,
    action_type: 'task_delegate',
    description: task.message?.parts?.[0]?.text || 'A2A task execution',
    target: {
      type: 'a2a_task',
      identifier: task.id || 'unknown',
    },
    data_classes: ['none'],
    risk_score: 200,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Inject a DCP delegation mandate into an A2A handshake (DCP-09 §3.1).
 * @param handshake - A2A handshake message
 * @param mandate - DCP DelegationMandate
 * @returns Handshake with mandate_id and mandate_hash
 */
export function addMandateToA2AHandshake(handshake: Dict, mandate: Dict) {
  return {
    ...handshake,
    dcp_mandate: {
      mandate_id: mandate.mandate_id,
      mandate_hash: mandate.mandate_hash || null,
      authority_scope: mandate.authority_scope || [],
      valid_until: mandate.valid_until || null,
      _spec_ref: 'DCP-09 §3.1',
    },
  };
}

/**
 * Create an A2A lifecycle notification message (DCP-05).
 * @param agentId - DCP agent ID
 * @param event - Lifecycle event type (commissioned, declining, decommissioned)
 * @param details - Additional event details
 * @returns A2A notification message
 */
export function createLifecycleNotification(agentId: string, event: string, details: Dict = {}) {
  return {
    type: 'dcp_lifecycle_notification',
    agent_id: agentId,
    event,
    details,
    _spec_ref: 'DCP-05',
    timestamp: new Date().toISOString(),
  };
}
