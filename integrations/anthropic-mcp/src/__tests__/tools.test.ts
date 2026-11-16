import { describe, it, expect } from 'vitest';
import { DCP_MCP_TOOLS, DCP_MCP_RESOURCES, handleDcpToolCall } from '../index.js';

// Ported from sdks/typescript/src/__tests__/integrations.test.ts, which imported the old index.js.
describe('DCP_MCP_TOOLS', () => {
  it('exports 11 tools with required schema fields', () => {
    expect(DCP_MCP_TOOLS).toHaveLength(11);
    for (const tool of DCP_MCP_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toBeDefined();
    }
  });

  it('includes the expected tool names', () => {
    const names = DCP_MCP_TOOLS.map((t) => t.name);
    for (const n of ['dcp_verify_bundle', 'dcp_create_identity', 'dcp_declare_intent', 'dcp_check_agent']) expect(names).toContain(n);
  });
});

describe('DCP_MCP_RESOURCES', () => {
  it('exports 4 resources with URI and mimeType', () => {
    expect(DCP_MCP_RESOURCES).toHaveLength(4);
    for (const res of DCP_MCP_RESOURCES) {
      expect(res.uri).toMatch(/^dcp:\/\//);
      expect(res.mimeType).toBe('application/json');
      expect(res.name).toBeTruthy();
    }
  });
});

describe('handleDcpToolCall', () => {
  it('dcp_verify_bundle fails closed on invalid JSON and on JSON that is not a signed bundle', async () => {
    for (const bundle_json of ['not-json', '{}', '"str"', '[]', 'null', JSON.stringify({ bundle: { dcp_bundle_version: '2.0' }, signature: {} }), JSON.stringify({ bundle: { audit_entries: {} }, signature: {} })]) {
      const result = (await handleDcpToolCall('dcp_verify_bundle', { bundle_json })) as { verified: boolean; errors: string[] };
      expect(result.verified, bundle_json).toBe(false);
      expect(result.errors.length, bundle_json).toBeGreaterThan(0);
    }
  });

  it('dcp_verify_bundle rejects a structurally complete bundle with bogus signatures', async () => {
    const bundle = {
      bundle: {
        dcp_bundle_version: '2.0',
        manifest: { session_nonce: 'a'.repeat(64) },
        responsible_principal_record: { payload: {}, payload_hash: 'x', composite_sig: {} },
        agent_passport: { payload: {}, payload_hash: 'x', composite_sig: {} },
        intent: { payload: {}, payload_hash: 'x', composite_sig: {} },
        policy_decision: { payload: {}, payload_hash: 'x', composite_sig: {} },
        audit_entries: [],
      },
      signature: { composite_sig: { classical: 'abc' } },
    };
    const result = (await handleDcpToolCall('dcp_verify_bundle', { bundle_json: JSON.stringify(bundle) })) as { verified: boolean; timestamp: string };
    expect(result.verified).toBe(false);
    expect(result.timestamp).toBeTruthy();
  });

  it('creates an identity draft with unique IDs and a default agent_name', async () => {
    const a = await handleDcpToolCall('dcp_create_identity', { entity_name: 'Alice', jurisdiction: 'US' });
    const b = await handleDcpToolCall('dcp_create_identity', { entity_name: 'Alice', jurisdiction: 'US' });
    expect(a.human_id).toMatch(/^rpr:/);
    expect(a.agent_id).toMatch(/^agent:/);
    expect(a.human_id).not.toBe(b.human_id);
    expect(a.status).toBe('identity_created');
    expect(a.agent_name).toBe('Alice-agent');
  });

  it('declares an intent draft and computes the tier from risk_score', async () => {
    const low = await handleDcpToolCall('dcp_declare_intent', { agent_id: 'agent:1', action_type: 'browse', description: 'Browse web', risk_score: 50 });
    expect(low.computed_tier).toBe('routine');
    expect(low.policy_decision).toBe('approve');
    const high = await handleDcpToolCall('dcp_declare_intent', { agent_id: 'agent:2', action_type: 'payment', description: 'Send payment', risk_score: 900 });
    expect(high.computed_tier).toBe('maximum');
    expect(high.policy_decision).toBe('escalate');
  });

  it('checks agent status and rejects unknown tools', async () => {
    const check = await handleDcpToolCall('dcp_check_agent', { agent_id: 'agent:test' });
    expect(check.agent_id).toBe('agent:test');
    expect(check.status).toBe('check_pending');
    expect((await handleDcpToolCall('nonexistent_tool', {})).error).toMatch(/Unknown DCP tool/);
  });
});
