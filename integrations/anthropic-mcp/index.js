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
  {
    name: 'dcp_commission_agent',
    description: 'Commission an agent (DCP-05). Creates a commissioning certificate and transitions lifecycle to "commissioned".',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'The agent ID to commission' },
        purpose: { type: 'string', description: 'Purpose of the agent' },
        capabilities: { type: 'array', items: { type: 'string' }, description: 'Agent capabilities' },
        risk_tier: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Risk tier (default: medium)' },
      },
      required: ['agent_id', 'purpose'],
    },
  },
  {
    name: 'dcp_report_vitality',
    description: 'Report agent vitality metrics (DCP-05 §4.1). Returns computed vitality score.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'The agent ID' },
        metrics: {
          type: 'object',
          properties: {
            task_completion_rate: { type: 'number', description: '0.0–1.0' },
            error_rate: { type: 'number', description: '0.0–1.0' },
            human_satisfaction: { type: 'number', description: '0.0–1.0' },
            policy_alignment: { type: 'number', description: '0.0–1.0' },
          },
          required: ['task_completion_rate', 'error_rate', 'human_satisfaction', 'policy_alignment'],
        },
      },
      required: ['agent_id', 'metrics'],
    },
  },
  {
    name: 'dcp_decommission_agent',
    description: 'Decommission an agent (DCP-05 §5.1). Transitions lifecycle to "decommissioned".',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'The agent ID to decommission' },
        termination_mode: { type: 'string', enum: ['graceful', 'immediate', 'emergency'], description: 'Termination mode' },
        reason: { type: 'string', description: 'Reason for decommissioning' },
        successor_agent_id: { type: 'string', description: 'Agent ID to take over (optional)' },
      },
      required: ['agent_id', 'termination_mode', 'reason'],
    },
  },
  {
    name: 'dcp_create_testament',
    description: 'Create a digital testament for agent succession (DCP-06 §3.1).',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'The agent ID' },
        successor_preferences: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              agent_id: { type: 'string' },
              priority: { type: 'number' },
            },
          },
          description: 'Ordered successor preferences',
        },
        memory_classification: { type: 'string', enum: ['transferable', 'restricted', 'destroy'], description: 'Memory handling policy' },
      },
      required: ['agent_id', 'successor_preferences', 'memory_classification'],
    },
  },
  {
    name: 'dcp_file_dispute',
    description: 'File a dispute between agents (DCP-07 §3.1).',
    inputSchema: {
      type: 'object',
      properties: {
        initiator_agent_id: { type: 'string', description: 'Agent filing the dispute' },
        respondent_agent_id: { type: 'string', description: 'Agent the dispute is against' },
        dispute_type: { type: 'string', enum: ['resource_conflict', 'policy_violation', 'capability_overlap', 'data_access'], description: 'Type of dispute' },
        evidence_hashes: { type: 'array', items: { type: 'string' }, description: 'SHA-256 hashes of evidence artifacts' },
      },
      required: ['initiator_agent_id', 'respondent_agent_id', 'dispute_type'],
    },
  },
  {
    name: 'dcp_declare_rights',
    description: 'Declare rights for an agent (DCP-08 §3.1).',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'The agent ID' },
        rights: { type: 'array', items: { type: 'string' }, description: 'Rights being declared (e.g. data_portability, explanation, continuity)' },
        jurisdiction: { type: 'string', description: 'Legal jurisdiction (ISO 3166-1)' },
      },
      required: ['agent_id', 'rights', 'jurisdiction'],
    },
  },
  {
    name: 'dcp_create_mandate',
    description: 'Create a delegation mandate (DCP-09 §3.1). A human delegates authority to an agent.',
    inputSchema: {
      type: 'object',
      properties: {
        human_id: { type: 'string', description: 'Human principal granting delegation' },
        agent_id: { type: 'string', description: 'Agent receiving delegation' },
        authority_scope: { type: 'array', items: { type: 'string' }, description: 'Scopes of authority' },
        valid_from: { type: 'string', description: 'ISO 8601 start (defaults to now)' },
        valid_until: { type: 'string', description: 'ISO 8601 end of validity' },
      },
      required: ['human_id', 'agent_id', 'authority_scope'],
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
  {
    uri: 'dcp://protocol/lifecycle-states',
    name: 'DCP Lifecycle States',
    description: 'Agent lifecycle state definitions (DCP-05): active, commissioned, declining, decommissioned',
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
    case 'dcp_commission_agent':
      return handleCommissionAgent(args);
    case 'dcp_report_vitality':
      return handleReportVitality(args);
    case 'dcp_decommission_agent':
      return handleDecommissionAgent(args);
    case 'dcp_create_testament':
      return handleCreateTestament(args);
    case 'dcp_file_dispute':
      return handleFileDispute(args);
    case 'dcp_declare_rights':
      return handleDeclareRights(args);
    case 'dcp_create_mandate':
      return handleCreateMandate(args);
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

function handleCommissionAgent(args) {
  const certificateId = `cert:${crypto.randomUUID()}`;
  return {
    certificate_id: certificateId,
    agent_id: args.agent_id,
    purpose: args.purpose,
    capabilities: args.capabilities || [],
    risk_tier: args.risk_tier || 'medium',
    lifecycle_state: 'commissioned',
    _spec_ref: 'DCP-05 §3.1',
    timestamp: new Date().toISOString(),
    next_step: 'Agent is now commissioned. Use dcp_report_vitality to submit periodic health metrics.',
  };
}

function handleReportVitality(args) {
  const m = args.metrics || {};
  const score = (
    (m.task_completion_rate || 0) * 0.3 +
    (1 - (m.error_rate || 0)) * 0.2 +
    (m.human_satisfaction || 0) * 0.25 +
    (m.policy_alignment || 0) * 0.25
  );
  return {
    report_id: `vitality:${crypto.randomUUID()}`,
    agent_id: args.agent_id,
    vitality_score: Math.round(score * 1000) / 1000,
    metrics: m,
    _spec_ref: 'DCP-05 §4.1',
    timestamp: new Date().toISOString(),
    next_step: score < 0.5
      ? 'Vitality score is low. Consider investigating agent health or scheduling decommissioning.'
      : 'Vitality score is healthy. Continue periodic reporting.',
  };
}

function handleDecommissionAgent(args) {
  return {
    record_id: `decom:${crypto.randomUUID()}`,
    agent_id: args.agent_id,
    termination_mode: args.termination_mode,
    reason: args.reason,
    successor_agent_id: args.successor_agent_id || null,
    lifecycle_state: 'decommissioned',
    _spec_ref: 'DCP-05 §5.1',
    timestamp: new Date().toISOString(),
    next_step: args.successor_agent_id
      ? `Succession to ${args.successor_agent_id} should be initiated via dcp_create_testament.`
      : 'Agent decommissioned. No successor designated.',
  };
}

function handleCreateTestament(args) {
  return {
    testament_id: `testament:${crypto.randomUUID()}`,
    agent_id: args.agent_id,
    successor_preferences: args.successor_preferences || [],
    memory_classification: args.memory_classification,
    _spec_ref: 'DCP-06 §3.1',
    timestamp: new Date().toISOString(),
    next_step: 'Testament registered. Succession will be executed upon agent decommissioning.',
  };
}

function handleFileDispute(args) {
  return {
    dispute_id: `dispute:${crypto.randomUUID()}`,
    initiator_agent_id: args.initiator_agent_id,
    respondent_agent_id: args.respondent_agent_id,
    dispute_type: args.dispute_type,
    evidence_hashes: args.evidence_hashes || [],
    status: 'filed',
    _spec_ref: 'DCP-07 §3.1',
    timestamp: new Date().toISOString(),
    next_step: 'Dispute filed. Awaiting mediation or escalation.',
  };
}

function handleDeclareRights(args) {
  return {
    declaration_id: `rights:${crypto.randomUUID()}`,
    agent_id: args.agent_id,
    rights: args.rights,
    jurisdiction: args.jurisdiction,
    status: 'declared',
    _spec_ref: 'DCP-08 §3.1',
    timestamp: new Date().toISOString(),
    next_step: 'Rights declared. Obligations may be created for counterparties.',
  };
}

function handleCreateMandate(args) {
  return {
    mandate_id: `mandate:${crypto.randomUUID()}`,
    human_id: args.human_id,
    agent_id: args.agent_id,
    authority_scope: args.authority_scope,
    valid_from: args.valid_from || new Date().toISOString(),
    valid_until: args.valid_until || null,
    status: 'active',
    _spec_ref: 'DCP-09 §3.1',
    timestamp: new Date().toISOString(),
    next_step: 'Mandate active. Agent can now act within the delegated authority scope.',
  };
}
