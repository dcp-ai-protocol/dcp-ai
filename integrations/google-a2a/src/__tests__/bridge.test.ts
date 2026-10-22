import { describe, it, expect } from 'vitest';
import { passportToAgentCard, agentCardToPassport, wrapA2ATaskWithAudit, a2aTaskToIntent } from '../index.js';

// Ported from sdks/typescript/src/__tests__/integrations.test.ts, which imported the old index.js.
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

describe('passportToAgentCard (bare passport)', () => {
  it('creates an A2A Agent Card with skills tagged dcp', () => {
    const card = passportToAgentCard(samplePassport, 'https://example.com/a2a');
    expect(card.name).toBe('Test Agent');
    expect(card.url).toBe('https://example.com/a2a');
    expect(card.version).toBe('1.0');
    expect(card.skills).toHaveLength(2);
    expect(card.skills![0].id).toBe('data_retrieval');
    expect(card.metadata!.dcp_agent_id).toBe('agent:test-001');
    expect(card.metadata!.dcp_version).toBe('2.0');
    for (const skill of card.skills!) {
      expect(skill.tags).toContain('dcp');
      expect(skill.name).toBeTruthy();
    }
  });
});

describe('agentCardToPassport (skeleton)', () => {
  it('round-trips agent_id, capabilities and status', () => {
    const passport = agentCardToPassport(passportToAgentCard(samplePassport, 'https://example.com/a2a'));
    expect(passport.dcp_version).toBe('2.0');
    expect(passport.agent_id).toBe('agent:test-001');
    expect([...passport.capabilities].sort()).toEqual([...samplePassport.capabilities].sort());
    expect(passport.status).toBe('active');
  });
});

describe('tasks', () => {
  it('wraps a task with DCP audit metadata', () => {
    const task = { id: 'task-42', status: { state: 'completed' } };
    const wrapped = wrapA2ATaskWithAudit(task, 'agent:a', 'intent:i');
    expect(wrapped.dcp_audit).toMatchObject({ event_type: 'a2a_task_execution', agent_id: 'agent:a', intent_id: 'intent:i', task_id: 'task-42', task_status: 'completed' });
    expect(wrapped.a2a_task).toBe(task);
  });

  it('creates a DCP Intent from an A2A task', () => {
    const intent = a2aTaskToIntent({ id: 'task-99', message: { parts: [{ text: 'Analyze data' }] } }, 'agent:b');
    expect(intent).toMatchObject({ dcp_version: '2.0', schema: 'intent_v2', agent_id: 'agent:b', action_type: 'task_delegate', description: 'Analyze data' });
    expect(intent.intent_id).toMatch(/^intent:a2a-/);
  });
});
