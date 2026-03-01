/**
 * DCP-AI ↔ Microsoft AutoGen Bridge
 * 
 * Enables AutoGen agents to carry DCP digital citizenship,
 * providing identity, audit trails, and post-quantum security
 * for multi-agent conversations.
 */

/**
 * Create a DCP-aware AutoGen agent configuration.
 * @param {object} config - Agent configuration
 * @param {string} config.name - Agent name
 * @param {string} [config.system_message] - System message for the agent
 * @param {string} [config.agent_id] - DCP agent ID (auto-generated if omitted)
 * @param {string[]} [config.capabilities] - DCP capabilities
 * @param {string} [config.security_tier] - Security tier
 * @param {string} [config.jurisdiction] - Legal jurisdiction
 * @param {object} [config.llm_config] - LLM configuration for AutoGen
 * @returns {object} DCP-aware AutoGen agent configuration
 */
export function createDcpAutoGenAgent(config) {
  return {
    name: config.name,
    system_message: config.system_message || '',
    dcp: {
      agent_id: config.agent_id || `agent:autogen-${config.name.toLowerCase().replace(/\s+/g, '-')}`,
      capabilities: config.capabilities || ['conversation', 'task_delegate'],
      security_tier: config.security_tier || 'standard',
      jurisdiction: config.jurisdiction || 'US',
      audit_enabled: true,
    },
    llm_config: config.llm_config,
  };
}

/**
 * Wrap an AutoGen message with DCP audit entry.
 * @param {object} message - AutoGen message
 * @param {object} senderConfig - Sender's DCP-aware AutoGen config
 * @param {object} recipientConfig - Recipient's DCP-aware AutoGen config
 * @returns {object} DCP audit entry for the message
 */
export function auditAutoGenMessage(message, senderConfig, recipientConfig) {
  const effectiveTier = numberToTier(Math.max(
    tierToNumber(senderConfig.dcp.security_tier),
    tierToNumber(recipientConfig.dcp.security_tier),
  ));

  return {
    event_type: 'autogen_message',
    sender_agent_id: senderConfig.dcp.agent_id,
    recipient_agent_id: recipientConfig.dcp.agent_id,
    message_type: message.role || 'unknown',
    content_hash: null,
    timestamp: new Date().toISOString(),
    security_tier: effectiveTier,
  };
}

function tierToNumber(tier) {
  const map = { routine: 0, standard: 1, elevated: 2, maximum: 3 };
  return map[tier] ?? 1;
}

function numberToTier(n) {
  const map = ['routine', 'standard', 'elevated', 'maximum'];
  return map[n] ?? 'standard';
}

/**
 * Create a DCP GroupChat configuration for AutoGen.
 * @param {Array<object>} agents - Array of DCP-aware AutoGen agent configs
 * @param {object} [config] - GroupChat options
 * @param {string} [config.security_tier] - Session security tier
 * @param {number} [config.max_rounds] - Maximum conversation rounds
 * @returns {object} DCP GroupChat configuration
 */
export function createDcpGroupChat(agents, config = {}) {
  const sessionNonce = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  return {
    agents: agents.map(a => ({
      ...a,
      dcp: {
        ...a.dcp,
        session_nonce: sessionNonce,
      },
    })),
    dcp_session: {
      session_nonce: sessionNonce,
      created_at: new Date().toISOString(),
      security_tier: config.security_tier || 'standard',
      max_rounds: config.max_rounds || 10,
      audit_entries: [],
    },
  };
}

/**
 * Create a DCP Intent for an AutoGen function call.
 * @param {object} functionCall - AutoGen function call descriptor
 * @param {string} functionCall.name - Function name
 * @param {object} agentConfig - DCP-aware AutoGen agent config
 * @returns {object} DCP Intent
 */
export function autoGenFunctionToIntent(functionCall, agentConfig) {
  return {
    dcp_version: '2.0',
    schema: 'intent_v2',
    intent_id: `intent:autogen-${crypto.randomUUID()}`,
    agent_id: agentConfig.dcp.agent_id,
    action_type: 'function_call',
    description: `AutoGen function call: ${functionCall.name}`,
    target: {
      type: 'function',
      identifier: functionCall.name,
    },
    data_classes: ['none'],
    risk_score: 100,
    security_tier: agentConfig.dcp.security_tier,
    timestamp: new Date().toISOString(),
  };
}
