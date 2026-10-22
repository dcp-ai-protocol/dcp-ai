/**
 * Integration tests for the pure-JS DCP integrations:
 *   - autogen
 *   - w3c-did
 * anthropic-mcp and google-a2a are TypeScript packages with their own vitest suites
 * (integrations/anthropic-mcp, integrations/google-a2a).
 */
import { describe, it, expect } from 'vitest';
import { resolve } from 'path';

const INTEGRATIONS_ROOT = resolve(__dirname, '../../../../integrations');

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
