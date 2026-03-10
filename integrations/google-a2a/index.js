/**
 * DCP-AI ↔ Google A2A Protocol Bridge
 * 
 * Bridges between DCP Agent Passports and Google A2A Agent Cards,
 * allowing DCP-certified agents to participate in Google A2A networks
 * with post-quantum security.
 */

/**
 * Convert a DCP Agent Passport to a Google A2A Agent Card.
 * @param {object} passport - DCP Agent Passport
 * @param {string} a2aEndpoint - URL endpoint for the A2A agent
 * @returns {object} Google A2A Agent Card
 */
export function passportToAgentCard(passport, a2aEndpoint) {
  return {
    name: passport.agent_name,
    description: `DCP-certified agent: ${passport.agent_id}`,
    url: a2aEndpoint,
    provider: {
      organization: passport.jurisdiction || 'DCP-AI Network',
      url: 'https://dcp-ai.dev',
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
    skills: (passport.capabilities || []).map(cap => ({
      id: cap,
      name: cap.replace(/_/g, ' '),
      description: `DCP capability: ${cap}`,
      tags: ['dcp', cap],
    })),
    metadata: {
      dcp_agent_id: passport.agent_id,
      dcp_version: passport.dcp_version || '2.0',
      dcp_security_tier: 'standard',
      dcp_owner_rpr_hash: passport.owner_rpr_hash,
      dcp_lifecycle_state: passport.status || 'active',
      dcp_mandate_id: passport.mandate_id || null,
    },
  };
}

/**
 * Convert a Google A2A Agent Card to a DCP Agent Passport skeleton.
 * @param {object} card - Google A2A Agent Card
 * @returns {object} DCP Agent Passport skeleton
 */
export function agentCardToPassport(card) {
  return {
    dcp_version: '2.0',
    schema: 'agent_passport_v2',
    agent_id: card.metadata?.dcp_agent_id || `agent:a2a-${card.name?.toLowerCase().replace(/\s+/g, '-')}`,
    agent_name: card.name || 'a2a-imported-agent',
    model: 'google-a2a',
    capabilities: (card.skills || []).map(s => s.id),
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
 * @param {object} task - Google A2A Task
 * @param {string} agentId - DCP agent ID
 * @param {string} intentId - DCP intent ID
 * @returns {object} Task wrapped with DCP audit metadata
 */
export function wrapA2ATaskWithAudit(task, agentId, intentId) {
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
 * @param {object} task - Google A2A Task
 * @param {string} agentId - DCP agent ID
 * @returns {object} DCP Intent
 */
export function a2aTaskToIntent(task, agentId) {
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
 * @param {object} handshake - A2A handshake message
 * @param {object} mandate - DCP DelegationMandate
 * @returns {object} Handshake with mandate_id and mandate_hash
 */
export function addMandateToA2AHandshake(handshake, mandate) {
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
 * @param {string} agentId - DCP agent ID
 * @param {string} event - Lifecycle event type (commissioned, declining, decommissioned)
 * @param {object} details - Additional event details
 * @returns {object} A2A notification message
 */
export function createLifecycleNotification(agentId, event, details = {}) {
  return {
    type: 'dcp_lifecycle_notification',
    agent_id: agentId,
    event,
    details,
    _spec_ref: 'DCP-05',
    timestamp: new Date().toISOString(),
  };
}
