/**
 * Integration tests for the 4 pure-JS DCP integrations:
 *   - anthropic-mcp
 *   - google-a2a
 *   - autogen
 *   - w3c-did
 */
import { describe, it, expect } from 'vitest';
import { resolve } from 'path';

const INTEGRATIONS_ROOT = resolve(__dirname, '../../../../integrations');

// ---------------------------------------------------------------------------
// Anthropic MCP
// ---------------------------------------------------------------------------

describe('Anthropic MCP Integration', async () => {
  const mcp = await import(resolve(INTEGRATIONS_ROOT, 'anthropic-mcp/index.js'));

  describe('DCP_MCP_TOOLS', () => {
    it('exports 4 tools with required schema fields', () => {
      expect(mcp.DCP_MCP_TOOLS).toHaveLength(4);
      for (const tool of mcp.DCP_MCP_TOOLS) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.inputSchema.properties).toBeDefined();
      }
    });

    it('includes the expected tool names', () => {
      const names = mcp.DCP_MCP_TOOLS.map((t: any) => t.name);
      expect(names).toContain('dcp_verify_bundle');
      expect(names).toContain('dcp_create_identity');
      expect(names).toContain('dcp_declare_intent');
      expect(names).toContain('dcp_check_agent');
    });
  });

  describe('DCP_MCP_RESOURCES', () => {
    it('exports 3 resources with URI and mimeType', () => {
      expect(mcp.DCP_MCP_RESOURCES).toHaveLength(3);
      for (const res of mcp.DCP_MCP_RESOURCES) {
        expect(res.uri).toMatch(/^dcp:\/\//);
        expect(res.mimeType).toBe('application/json');
        expect(res.name).toBeTruthy();
      }
    });
  });

  describe('handleDcpToolCall', () => {
    it('verifies a valid bundle JSON', async () => {
      const bundle = {
        bundle: {
          dcp_bundle_version: '2.0',
          manifest: { session_nonce: 'a'.repeat(64) },
          responsible_principal_record: {},
          agent_passport: {},
          intent: {},
          policy_decision: {},
        },
        signature: { composite_sig: { classical: 'abc' } },
      };
      const result = await mcp.handleDcpToolCall('dcp_verify_bundle', {
        bundle_json: JSON.stringify(bundle),
      });
      expect(result.verified).toBe(true);
      expect(result.checks).toBeDefined();
      expect(result.timestamp).toBeTruthy();
    });

    it('returns verified=false for invalid JSON', async () => {
      const result = await mcp.handleDcpToolCall('dcp_verify_bundle', {
        bundle_json: 'not-json',
      });
      expect(result.verified).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('creates an identity with unique IDs', async () => {
      const result1 = await mcp.handleDcpToolCall('dcp_create_identity', {
        entity_name: 'Alice',
        jurisdiction: 'US',
      });
      const result2 = await mcp.handleDcpToolCall('dcp_create_identity', {
        entity_name: 'Alice',
        jurisdiction: 'US',
      });
      expect(result1.human_id).toMatch(/^rpr:/);
      expect(result1.agent_id).toMatch(/^agent:/);
      expect(result1.human_id).not.toBe(result2.human_id);
      expect(result1.agent_id).not.toBe(result2.agent_id);
      expect(result1.status).toBe('identity_created');
    });

    it('uses entity_name for default agent_name', async () => {
      const result = await mcp.handleDcpToolCall('dcp_create_identity', {
        entity_name: 'Bob',
        jurisdiction: 'EU',
      });
      expect(result.agent_name).toBe('Bob-agent');
    });

    it('declares intent and computes tier from risk_score', async () => {
      const low = await mcp.handleDcpToolCall('dcp_declare_intent', {
        agent_id: 'agent:1',
        action_type: 'browse',
        description: 'Browse web',
        risk_score: 50,
      });
      expect(low.computed_tier).toBe('routine');
      expect(low.policy_decision).toBe('approve');

      const high = await mcp.handleDcpToolCall('dcp_declare_intent', {
        agent_id: 'agent:2',
        action_type: 'payment',
        description: 'Send payment',
        risk_score: 900,
      });
      expect(high.computed_tier).toBe('maximum');
      expect(high.policy_decision).toBe('escalate');
    });

    it('checks agent status', async () => {
      const result = await mcp.handleDcpToolCall('dcp_check_agent', {
        agent_id: 'agent:test',
      });
      expect(result.agent_id).toBe('agent:test');
      expect(result.status).toBe('check_pending');
      expect(result.timestamp).toBeTruthy();
    });

    it('returns error for unknown tool', async () => {
      const result = await mcp.handleDcpToolCall('nonexistent_tool', {});
      expect(result.error).toMatch(/Unknown DCP tool/);
    });
  });
});

// ---------------------------------------------------------------------------
// Google A2A
// ---------------------------------------------------------------------------

describe('Google A2A Integration', async () => {
  const a2a = await import(resolve(INTEGRATIONS_ROOT, 'google-a2a/index.js'));

  const samplePassport = {
    agent_id: 'agent:test-001',
    agent_name: 'Test Agent',
    dcp_version: '2.0',
    capabilities: ['data_retrieval', 'api_call'],
    owner_rpr_hash: 'sha256:abc123',
    jurisdiction: 'US',
    status: 'active',
    liability_mode: 'delegated',
    model: 'gpt-4',
    created_at: '2026-01-01T00:00:00Z',
    keys: [],
  };

  describe('passportToAgentCard', () => {
    it('creates a valid A2A Agent Card', () => {
      const card = a2a.passportToAgentCard(samplePassport, 'https://example.com/a2a');
      expect(card.name).toBe('Test Agent');
      expect(card.url).toBe('https://example.com/a2a');
      expect(card.version).toBe('1.0');
      expect(card.skills).toHaveLength(2);
      expect(card.skills[0].id).toBe('data_retrieval');
      expect(card.metadata.dcp_agent_id).toBe('agent:test-001');
      expect(card.metadata.dcp_version).toBe('2.0');
    });

    it('maps capabilities to skills with tags', () => {
      const card = a2a.passportToAgentCard(samplePassport, 'https://x.com');
      for (const skill of card.skills) {
        expect(skill.tags).toContain('dcp');
        expect(skill.name).toBeTruthy();
      }
    });
  });

  describe('agentCardToPassport', () => {
    it('converts an Agent Card back to a passport skeleton', () => {
      const card = a2a.passportToAgentCard(samplePassport, 'https://example.com/a2a');
      const passport = a2a.agentCardToPassport(card);
      expect(passport.dcp_version).toBe('2.0');
      expect(passport.agent_id).toBe('agent:test-001');
      expect(passport.capabilities).toContain('data_retrieval');
      expect(passport.capabilities).toContain('api_call');
      expect(passport.status).toBe('active');
    });
  });

  describe('round-trip passport -> agentCard -> passport', () => {
    it('preserves agent_id and capabilities', () => {
      const card = a2a.passportToAgentCard(samplePassport, 'https://x.com');
      const roundTripped = a2a.agentCardToPassport(card);
      expect(roundTripped.agent_id).toBe(samplePassport.agent_id);
      expect(roundTripped.capabilities.sort()).toEqual(samplePassport.capabilities.sort());
    });
  });

  describe('wrapA2ATaskWithAudit', () => {
    it('wraps a task with DCP audit metadata', () => {
      const task = { id: 'task-42', status: { state: 'completed' } };
      const wrapped = a2a.wrapA2ATaskWithAudit(task, 'agent:a', 'intent:i');
      expect(wrapped.dcp_audit.event_type).toBe('a2a_task_execution');
      expect(wrapped.dcp_audit.agent_id).toBe('agent:a');
      expect(wrapped.dcp_audit.intent_id).toBe('intent:i');
      expect(wrapped.dcp_audit.task_id).toBe('task-42');
      expect(wrapped.dcp_audit.task_status).toBe('completed');
      expect(wrapped.a2a_task).toBe(task);
    });
  });

  describe('a2aTaskToIntent', () => {
    it('creates a DCP Intent from an A2A task', () => {
      const task = {
        id: 'task-99',
        message: { parts: [{ text: 'Analyze data' }] },
      };
      const intent = a2a.a2aTaskToIntent(task, 'agent:b');
      expect(intent.dcp_version).toBe('2.0');
      expect(intent.schema).toBe('intent_v2');
      expect(intent.agent_id).toBe('agent:b');
      expect(intent.action_type).toBe('task_delegate');
      expect(intent.description).toBe('Analyze data');
      expect(intent.intent_id).toMatch(/^intent:a2a-/);
    });
  });
});

// ---------------------------------------------------------------------------
// AutoGen
// ---------------------------------------------------------------------------

describe('AutoGen Integration', async () => {
  const autogen = await import(resolve(INTEGRATIONS_ROOT, 'autogen/index.js'));

  describe('createDcpAutoGenAgent', () => {
    it('creates a DCP-aware agent config', () => {
      const config = autogen.createDcpAutoGenAgent({
        name: 'Research Assistant',
        system_message: 'You are a researcher.',
      });
      expect(config.name).toBe('Research Assistant');
      expect(config.dcp.agent_id).toBe('agent:autogen-research-assistant');
      expect(config.dcp.capabilities).toContain('conversation');
      expect(config.dcp.security_tier).toBe('standard');
      expect(config.dcp.audit_enabled).toBe(true);
    });

    it('uses provided agent_id when given', () => {
      const config = autogen.createDcpAutoGenAgent({
        name: 'Bot',
        agent_id: 'agent:custom-id',
      });
      expect(config.dcp.agent_id).toBe('agent:custom-id');
    });
  });

  describe('auditAutoGenMessage', () => {
    it('computes effective tier as max of sender and recipient', () => {
      const sender = autogen.createDcpAutoGenAgent({
        name: 'S',
        security_tier: 'routine',
      });
      const recipient = autogen.createDcpAutoGenAgent({
        name: 'R',
        security_tier: 'elevated',
      });
      const message = { role: 'assistant', content: 'Hello' };
      const audit = autogen.auditAutoGenMessage(message, sender, recipient);
      expect(audit.security_tier).toBe('elevated');
      expect(audit.event_type).toBe('autogen_message');
      expect(audit.sender_agent_id).toBe(sender.dcp.agent_id);
      expect(audit.recipient_agent_id).toBe(recipient.dcp.agent_id);
    });

    it('uses standard as default when both are standard', () => {
      const a = autogen.createDcpAutoGenAgent({ name: 'A' });
      const b = autogen.createDcpAutoGenAgent({ name: 'B' });
      const audit = autogen.auditAutoGenMessage({ role: 'user' }, a, b);
      expect(audit.security_tier).toBe('standard');
    });
  });

  describe('createDcpGroupChat', () => {
    it('generates shared session nonce for all agents', () => {
      const agents = [
        autogen.createDcpAutoGenAgent({ name: 'A1' }),
        autogen.createDcpAutoGenAgent({ name: 'A2' }),
        autogen.createDcpAutoGenAgent({ name: 'A3' }),
      ];
      const chat = autogen.createDcpGroupChat(agents);
      expect(chat.dcp_session.session_nonce).toMatch(/^[0-9a-f]{64}$/);
      for (const agent of chat.agents) {
        expect(agent.dcp.session_nonce).toBe(chat.dcp_session.session_nonce);
      }
      expect(chat.dcp_session.max_rounds).toBe(10);
    });

    it('accepts custom config options', () => {
      const agents = [autogen.createDcpAutoGenAgent({ name: 'X' })];
      const chat = autogen.createDcpGroupChat(agents, {
        security_tier: 'maximum',
        max_rounds: 5,
      });
      expect(chat.dcp_session.security_tier).toBe('maximum');
      expect(chat.dcp_session.max_rounds).toBe(5);
    });
  });

  describe('autoGenFunctionToIntent', () => {
    it('creates an Intent for a function call', () => {
      const agent = autogen.createDcpAutoGenAgent({ name: 'Fn' });
      const intent = autogen.autoGenFunctionToIntent(
        { name: 'search_web' },
        agent,
      );
      expect(intent.dcp_version).toBe('2.0');
      expect(intent.schema).toBe('intent_v2');
      expect(intent.action_type).toBe('function_call');
      expect(intent.description).toContain('search_web');
      expect(intent.agent_id).toBe(agent.dcp.agent_id);
      expect(intent.intent_id).toMatch(/^intent:autogen-/);
    });
  });
});

// ---------------------------------------------------------------------------
// W3C DID/VC
// ---------------------------------------------------------------------------

describe('W3C DID/VC Integration', async () => {
  const w3c = await import(resolve(INTEGRATIONS_ROOT, 'w3c-did/index.js'));

  const sampleRPR = {
    human_id: 'rpr:alice-123',
    entity_type: 'natural_person',
    entity_name: 'Alice',
    jurisdiction: 'US',
    binding_method: 'kyc',
    binding_timestamp: '2026-01-01T00:00:00Z',
    keys: [
      {
        kid: 'key-0',
        alg: 'ed25519',
        public_key_b64: 'dGVzdC1wdWJsaWMta2V5',
        created_at: '2026-01-01T00:00:00Z',
        expires_at: null,
        status: 'active',
      },
    ],
    blinded: false,
  };

  const samplePassport = {
    agent_id: 'agent:bot-1',
    agent_name: 'Test Bot',
    model: 'gpt-4',
    capabilities: ['api_call', 'browse'],
    jurisdiction: 'EU',
    liability_mode: 'delegated',
    owner_rpr_hash: 'sha256:xyz',
    status: 'active',
    created_at: '2026-01-15T00:00:00Z',
  };

  describe('rprToDIDDocument', () => {
    it('creates a valid DID Document', () => {
      const doc = w3c.rprToDIDDocument(sampleRPR);
      expect(doc['@context']).toContain('https://www.w3.org/ns/did/v1');
      expect(doc.id).toBe('did:dcp:alice-123');
      expect(doc.controller).toBe('did:dcp:alice-123');
      expect(doc.verificationMethod).toHaveLength(1);
      expect(doc.verificationMethod[0].type).toBe('Ed25519VerificationKey2020');
      expect(doc.authentication).toHaveLength(1);
      expect(doc.assertionMethod).toHaveLength(1);
    });
  });

  describe('didDocumentToRPR', () => {
    it('converts a DID Document back to RPR skeleton', () => {
      const doc = w3c.rprToDIDDocument(sampleRPR);
      const rpr = w3c.didDocumentToRPR(doc);
      expect(rpr.dcp_version).toBe('2.0');
      expect(rpr.human_id).toBe('rpr:alice-123');
      expect(rpr.schema).toBe('responsible_principal_record_v2');
      expect(rpr.keys).toHaveLength(1);
      expect(rpr.keys[0].alg).toBe('ed25519');
    });
  });

  describe('round-trip RPR -> DID -> RPR', () => {
    it('preserves human_id and key algorithm', () => {
      const doc = w3c.rprToDIDDocument(sampleRPR);
      const roundTripped = w3c.didDocumentToRPR(doc);
      expect(roundTripped.human_id).toBe(sampleRPR.human_id);
      expect(roundTripped.keys[0].alg).toBe(sampleRPR.keys[0].alg);
    });
  });

  describe('passportToVC', () => {
    it('creates a Verifiable Credential', () => {
      const vc = w3c.passportToVC(samplePassport, 'did:dcp:alice-123');
      expect(vc['@context']).toContain('https://www.w3.org/2018/credentials/v1');
      expect(vc.type).toContain('VerifiableCredential');
      expect(vc.type).toContain('DCPAgentPassport');
      expect(vc.issuer).toBe('did:dcp:alice-123');
      expect(vc.credentialSubject.name).toBe('Test Bot');
      expect(vc.credentialSubject.capabilities).toContain('api_call');
    });
  });

  describe('vcToPassport', () => {
    it('converts a VC back to a passport skeleton', () => {
      const vc = w3c.passportToVC(samplePassport, 'did:dcp:alice-123');
      const passport = w3c.vcToPassport(vc);
      expect(passport.dcp_version).toBe('2.0');
      expect(passport.agent_name).toBe('Test Bot');
      expect(passport.capabilities).toContain('api_call');
      expect(passport.agent_id).toBe('agent:bot-1');
    });
  });

  describe('bundleToVP', () => {
    it('creates a Verifiable Presentation wrapping a bundle', () => {
      const signedBundle = {
        bundle: {
          dcp_bundle_version: '2.0',
          intent: { payload: { security_tier: 'elevated' } },
        },
        signature: { manifest_hash: 'sha256:test' },
      };
      const vp = w3c.bundleToVP(signedBundle, 'did:dcp:alice-123');
      expect(vp['@context']).toContain('https://www.w3.org/2018/credentials/v1');
      expect(vp.type).toContain('VerifiablePresentation');
      expect(vp.type).toContain('DCPBundlePresentation');
      expect(vp.holder).toBe('did:dcp:alice-123');
      expect(vp.dcpBundle).toBe(signedBundle);
      expect(vp.verifiableCredential[0].credentialSubject.securityTier).toBe('elevated');
    });
  });
});
