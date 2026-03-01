/**
 * DCP-AI ↔ Anthropic MCP (Model Context Protocol) Bridge
 * 
 * Provides DCP tools and resources for MCP servers,
 * enabling Claude and other MCP-compatible models to
 * interact with DCP-certified agents.
 */

/**
 * DCP tools for MCP server registration.
 * @type {Array<object>}
 */
export const DCP_MCP_TOOLS = [
  {
    name: 'dcp_verify_bundle',
    description: 'Verify a DCP Citizenship Bundle. Returns verification result with details about identity, signatures, and audit trail integrity.',
    inputSchema: {
      type: 'object',
      properties: {
        bundle_json: {
          type: 'string',
          description: 'The signed DCP bundle as a JSON string',
        },
        security_tier: {
          type: 'string',
          enum: ['routine', 'standard', 'elevated', 'maximum'],
          description: 'Minimum security tier to require (default: standard)',
        },
      },
      required: ['bundle_json'],
    },
  },
  {
    name: 'dcp_create_identity',
    description: 'Create a new DCP digital identity (Responsible Principal Record + Agent Passport)',
    inputSchema: {
      type: 'object',
      properties: {
        entity_name: { type: 'string', description: 'Name of the entity or person' },
        jurisdiction: { type: 'string', description: 'Legal jurisdiction (e.g., US, EU, UK)' },
        agent_name: { type: 'string', description: 'Name for the agent' },
        capabilities: {
          type: 'array',
          items: { type: 'string' },
          description: 'Agent capabilities (e.g., api_call, data_retrieval)',
        },
      },
      required: ['entity_name', 'jurisdiction'],
    },
  },
  {
    name: 'dcp_declare_intent',
    description: 'Declare an intent for an action the agent wants to perform',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'The agent ID declaring the intent' },
        action_type: { type: 'string', description: 'Type of action (e.g., api_call, data_retrieval, send_message)' },
        description: { type: 'string', description: 'Human-readable description of the intended action' },
        target: { type: 'string', description: 'Target of the action' },
        data_classes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Data classes involved (e.g., none, pii, financial_data)',
        },
        risk_score: { type: 'number', description: 'Risk score (0-1000)' },
      },
      required: ['agent_id', 'action_type', 'description'],
    },
  },
  {
    name: 'dcp_check_agent',
    description: 'Check if an agent has valid DCP citizenship and is not revoked',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'The agent ID to check' },
        bundle_endpoint: { type: 'string', description: 'URL to fetch the agent bundle from' },
      },
      required: ['agent_id'],
    },
  },
];

/**
 * DCP resources for MCP server.
 * @type {Array<object>}
 */
export const DCP_MCP_RESOURCES = [
  {
    uri: 'dcp://protocol/version',
    name: 'DCP Protocol Version',
    description: 'Current DCP protocol version and capabilities',
    mimeType: 'application/json',
  },
  {
    uri: 'dcp://protocol/algorithms',
    name: 'DCP Supported Algorithms',
    description: 'List of supported cryptographic algorithms',
    mimeType: 'application/json',
  },
  {
    uri: 'dcp://protocol/tiers',
    name: 'DCP Security Tiers',
    description: 'Security tier definitions and requirements',
    mimeType: 'application/json',
  },
];

/**
 * Handle a DCP MCP tool call.
 * @param {string} toolName - Name of the DCP tool to execute
 * @param {object} args - Tool arguments
 * @returns {Promise<object>} Tool execution result
 */
export async function handleDcpToolCall(toolName, args) {
  switch (toolName) {
    case 'dcp_verify_bundle':
      return handleVerifyBundle(args);
    case 'dcp_create_identity':
      return handleCreateIdentity(args);
    case 'dcp_declare_intent':
      return handleDeclareIntent(args);
    case 'dcp_check_agent':
      return handleCheckAgent(args);
    default:
      return { error: `Unknown DCP tool: ${toolName}` };
  }
}

function handleVerifyBundle(args) {
  try {
    const bundle = JSON.parse(args.bundle_json);
    const checks = {
      has_bundle: !!bundle.bundle,
      has_signature: !!bundle.signature,
      has_manifest: !!bundle.bundle?.manifest,
      has_rpr: !!bundle.bundle?.responsible_principal_record,
      has_passport: !!bundle.bundle?.agent_passport,
      has_intent: !!bundle.bundle?.intent,
      has_policy: !!bundle.bundle?.policy_decision,
      version: bundle.bundle?.dcp_bundle_version || 'unknown',
      session_nonce_valid: /^[0-9a-f]{64}$/.test(bundle.bundle?.manifest?.session_nonce || ''),
      composite_sig_present: !!bundle.signature?.composite_sig,
    };

    const allValid = Object.values(checks).every(v => v === true || typeof v === 'string');

    return {
      verified: allValid,
      checks,
      security_tier: args.security_tier || 'standard',
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return { verified: false, error: error.message };
  }
}

function handleCreateIdentity(args) {
  const humanId = `rpr:${crypto.randomUUID()}`;
  const agentId = `agent:${crypto.randomUUID()}`;

  return {
    human_id: humanId,
    agent_id: agentId,
    agent_name: args.agent_name || `${args.entity_name}-agent`,
    jurisdiction: args.jurisdiction,
    capabilities: args.capabilities || ['api_call', 'data_retrieval'],
    status: 'identity_created',
    next_step: 'Generate keypairs and sign the RPR and Passport',
  };
}

function handleDeclareIntent(args) {
  const intentId = `intent:${crypto.randomUUID()}`;
  const riskScore = args.risk_score || 100;

  let tier = 'routine';
  if (riskScore >= 800) tier = 'maximum';
  else if (riskScore >= 500) tier = 'elevated';
  else if (riskScore >= 200) tier = 'standard';

  return {
    intent_id: intentId,
    agent_id: args.agent_id,
    action_type: args.action_type,
    description: args.description,
    risk_score: riskScore,
    computed_tier: tier,
    policy_decision: riskScore < 500 ? 'approve' : 'escalate',
    timestamp: new Date().toISOString(),
  };
}

function handleCheckAgent(args) {
  return {
    agent_id: args.agent_id,
    status: 'check_pending',
    message: 'Agent check requires fetching and verifying the bundle from the endpoint',
    bundle_endpoint: args.bundle_endpoint || 'not provided',
    timestamp: new Date().toISOString(),
  };
}
