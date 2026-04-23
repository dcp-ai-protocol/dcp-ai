import { describe, it, expect, beforeEach } from 'vitest';
import register, {
  getSession,
  isIdentityReady,
  clearSession,
  listSessions,
  executeIdentitySetup,
  executeVerifyBundle,
  executeLogAction,
  executeGetAuditTrail,
  executeDeclareIntent,
} from '../index.js';

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

describe('OpenClaw plugin registration', () => {
  it('registers all 11 tools via the plugin API', () => {
    const tools = new Map<string, any>();
    const mockApi = {
      registerTool: (tool: any) => tools.set(tool.name, tool),
    };
    register(mockApi);

    expect(tools.size).toBe(11);
    const expectedNames = [
      'dcp_identity_setup',
      'dcp_declare_intent',
      'dcp_verify_bundle',
      'dcp_log_action',
      'dcp_get_audit_trail',
      'dcp_commission_agent',
      'dcp_report_vitality',
      'dcp_decommission_agent',
      'dcp_create_testament',
      'dcp_create_mandate',
      'dcp_sign_bundle',
    ];
    for (const name of expectedNames) {
      expect(tools.has(name)).toBe(true);
      const tool = tools.get(name)!;
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeDefined();
      expect(typeof tool.execute).toBe('function');
    }
  });
});

// ---------------------------------------------------------------------------
// Session state management
// ---------------------------------------------------------------------------

describe('session state management', () => {
  const SESSION_ID = 'test-session-state';

  beforeEach(() => {
    clearSession(SESSION_ID);
  });

  it('getSession creates a new session on first access', () => {
    const session = getSession(SESSION_ID);
    expect(session.dcpVersion).toBe('2.0');
    expect(session.keypair).toBeNull();
    expect(session.compositeKeys).toBeNull();
    expect(session.auditEntriesV2).toEqual([]);
  });

  it('getSession returns the same session on subsequent calls', () => {
    const s1 = getSession(SESSION_ID);
    const s2 = getSession(SESSION_ID);
    expect(s1).toBe(s2);
  });

  it('isIdentityReady returns false before setup', () => {
    expect(isIdentityReady(SESSION_ID)).toBe(false);
  });

  it('isIdentityReady returns false for nonexistent session', () => {
    expect(isIdentityReady('nonexistent')).toBe(false);
  });

  it('clearSession removes the session', () => {
    getSession(SESSION_ID);
    expect(listSessions()).toContain(SESSION_ID);
    clearSession(SESSION_ID);
    expect(isIdentityReady(SESSION_ID)).toBe(false);
  });

  it('listSessions returns active session IDs', () => {
    getSession('s1');
    getSession('s2');
    const sessions = listSessions();
    expect(sessions).toContain('s1');
    expect(sessions).toContain('s2');
    clearSession('s1');
    clearSession('s2');
  });
});

// ---------------------------------------------------------------------------
// Identity setup (full crypto)
// ---------------------------------------------------------------------------

describe('executeIdentitySetup', () => {
  const SESSION_ID = 'test-identity-setup';

  beforeEach(() => {
    clearSession(SESSION_ID);
  });

  it('creates a V2 identity with dual keypairs', async () => {
    const result = await executeIdentitySetup({
      session_id: SESSION_ID,
      owner_name: 'Alice Test',
      entity_type: 'natural_person',
      jurisdiction: 'US',
    });

    expect(result.agent_id).toMatch(/^agent:/);
    expect(result.human_id).toMatch(/^rpr:/);
    expect(result.session_nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(result.classical_kid).toBeTruthy();
    expect(result.pq_kid).toBeTruthy();
    expect(result.capabilities).toContain('browse');
    expect(result.capabilities).toContain('api_call');
    expect(result.risk_tier).toBe('medium');
    expect(result.emergency_revocation_token).toBeTruthy();
    expect(isIdentityReady(SESSION_ID)).toBe(true);
  });

  it('stores signed passport and RPR in session', async () => {
    await executeIdentitySetup({
      session_id: SESSION_ID,
      owner_name: 'Bob',
      jurisdiction: 'EU',
    });

    const session = getSession(SESSION_ID);
    expect(session.signedPassport).not.toBeNull();
    expect(session.signedPassport!.payload).toBeDefined();
    expect(session.signedPassport!.composite_sig).toBeDefined();
    expect(session.signedRpr).not.toBeNull();
    expect(session.signedRpr!.payload).toBeDefined();
    expect(session.compositeKeys).not.toBeNull();
    expect(session.compositeKeys!.classical.alg).toBe('ed25519');
    expect(session.compositeKeys!.pq.alg).toBe('ml-dsa-65');
  });

  it('uses custom capabilities and risk_tier', async () => {
    const result = await executeIdentitySetup({
      session_id: SESSION_ID,
      owner_name: 'Charlie',
      jurisdiction: 'MX',
      capabilities: ['email', 'payments'],
      risk_tier: 'high',
    });

    expect(result.capabilities).toContain('email');
    expect(result.capabilities).toContain('payments');
    expect(result.risk_tier).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// Declare intent
// ---------------------------------------------------------------------------

describe('executeDeclareIntent', () => {
  const SESSION_ID = 'test-declare-intent';

  beforeEach(async () => {
    clearSession(SESSION_ID);
    await executeIdentitySetup({
      session_id: SESSION_ID,
      owner_name: 'Test User',
      jurisdiction: 'US',
    });
  });

  it('throws if identity not set up', async () => {
    const freshSession = 'no-identity';
    clearSession(freshSession);
    await expect(
      executeDeclareIntent({
        session_id: freshSession,
        action_type: 'browse',
        target_channel: 'web',
        estimated_impact: 'low',
      }),
    ).rejects.toThrow('identity not set up');
  });

  it('approves a low-risk intent', async () => {
    const result = await executeDeclareIntent({
      session_id: SESSION_ID,
      action_type: 'browse',
      target_channel: 'web',
      estimated_impact: 'low',
    });

    expect(result.intent_id).toMatch(/^intent:/);
    expect(result.decision).toBe('approve');
    expect(result.risk_score).toBeLessThan(500);
    expect(result.requires_human_confirmation).toBe(false);
  });

  it('escalates a high-risk intent with sensitive data', async () => {
    const result = await executeDeclareIntent({
      session_id: SESSION_ID,
      action_type: 'initiate_payment',
      target_channel: 'payments',
      estimated_impact: 'high',
      data_classes: ['financial_data'],
    });

    expect(result.risk_score).toBeGreaterThanOrEqual(500);
    expect(['escalate', 'block']).toContain(result.decision);
    expect(result.requires_human_confirmation).toBe(true);
  });

  it('stores signed intent and policy in session', async () => {
    const result = await executeDeclareIntent({
      session_id: SESSION_ID,
      action_type: 'api_call',
      target_channel: 'api',
      estimated_impact: 'low',
    });

    const session = getSession(SESSION_ID);
    expect(session.intentsV2.has(result.intent_id)).toBe(true);
    expect(session.signedIntents.has(result.intent_id)).toBe(true);
    expect(session.signedPolicies.has(result.intent_id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Verify bundle
// ---------------------------------------------------------------------------

describe('executeVerifyBundle', () => {
  it('rejects malformed input', async () => {
    const result = await executeVerifyBundle({ signed_bundle: {} });
    expect(result.verified).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects V2 bundle with missing manifest', async () => {
    const result = await executeVerifyBundle({
      signed_bundle: {
        bundle: {
          dcp_bundle_version: '2.0',
        },
        signature: {
          composite_sig: { classical: 'x', pq: 'y', binding: 'pq_over_classical' },
        },
      },
    });
    expect(result.verified).toBe(false);
    expect(result.dcp_version).toBe('2.0');
    expect(result.errors.some(e => e.includes('manifest'))).toBe(true);
  });

  it('verifies a structurally valid V2 bundle', async () => {
    const nonce = 'a'.repeat(64);
    const result = await executeVerifyBundle({
      signed_bundle: {
        bundle: {
          dcp_bundle_version: '2.0',
          manifest: {
            session_nonce: nonce,
            rpr_hash: 'sha256:a',
            passport_hash: 'sha256:b',
            intent_hash: 'sha256:c',
            policy_hash: 'sha256:d',
            audit_merkle_root: 'sha256:e',
          },
          responsible_principal_record: {
            payload: { human_id: 'rpr:x', session_nonce: nonce },
            composite_sig: { classical: 's' },
          },
          agent_passport: {
            payload: { agent_id: 'agent:y', session_nonce: nonce },
            composite_sig: { classical: 's' },
          },
          intent: {
            payload: { session_nonce: nonce },
            composite_sig: { classical: 's' },
          },
          policy_decision: {
            payload: { session_nonce: nonce },
            composite_sig: { classical: 's' },
          },
          audit_entries: [],
        },
        signature: {
          composite_sig: {
            classical: 'sig',
            pq: 'pq-sig',
            binding: 'pq_over_classical',
          },
        },
      },
    });
    expect(result.verified).toBe(true);
    expect(result.dcp_version).toBe('2.0');
    expect(result.agent_id).toBe('agent:y');
    expect(result.session_nonce).toBe(nonce);
  });
});

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

describe('audit trail (log + get)', () => {
  const SESSION_ID = 'test-audit-trail';
  let intentId: string;

  beforeEach(async () => {
    clearSession(SESSION_ID);
    await executeIdentitySetup({
      session_id: SESSION_ID,
      owner_name: 'Audit Test',
      jurisdiction: 'US',
    });
    const intent = await executeDeclareIntent({
      session_id: SESSION_ID,
      action_type: 'api_call',
      target_channel: 'api',
      estimated_impact: 'low',
    });
    intentId = intent.intent_id;
  });

  it('logs an action and returns chain info', async () => {
    const result = await executeLogAction({
      session_id: SESSION_ID,
      intent_id: intentId,
      outcome: 'data_retrieved',
      evidence_tool: 'http_client',
    });

    expect(result.audit_id).toMatch(/^audit:/);
    expect(result.intent_hash).toMatch(/^sha256:/);
    expect(result.prev_hash).toBe('GENESIS');
    expect(result.chain_length).toBe(1);
  });

  it('maintains hash chain across multiple actions', async () => {
    const r1 = await executeLogAction({
      session_id: SESSION_ID,
      intent_id: intentId,
      outcome: 'step_1',
    });
    const r2 = await executeLogAction({
      session_id: SESSION_ID,
      intent_id: intentId,
      outcome: 'step_2',
    });

    expect(r1.prev_hash).toBe('GENESIS');
    expect(r2.prev_hash).not.toBe('GENESIS');
    expect(r2.prev_hash).toMatch(/^sha256:/);
    expect(r2.chain_length).toBe(2);
  });

  it('throws when intent not found', async () => {
    await expect(
      executeLogAction({
        session_id: SESSION_ID,
        intent_id: 'intent:nonexistent',
        outcome: 'test',
      }),
    ).rejects.toThrow('not found');
  });

  it('retrieves audit trail', async () => {
    await executeLogAction({
      session_id: SESSION_ID,
      intent_id: intentId,
      outcome: 'action_done',
    });

    const trail = await executeGetAuditTrail({ session_id: SESSION_ID });
    expect(trail.total).toBe(1);
    expect(trail.entries).toHaveLength(1);
    expect(trail.entries[0].outcome).toBe('action_done');
    expect(trail.agent_id).toBeTruthy();
    expect(trail.human_id).toBeTruthy();
  });

  it('respects limit parameter', async () => {
    await executeLogAction({
      session_id: SESSION_ID,
      intent_id: intentId,
      outcome: 'a',
    });
    await executeLogAction({
      session_id: SESSION_ID,
      intent_id: intentId,
      outcome: 'b',
    });
    await executeLogAction({
      session_id: SESSION_ID,
      intent_id: intentId,
      outcome: 'c',
    });

    const trail = await executeGetAuditTrail({
      session_id: SESSION_ID,
      limit: 2,
    });
    expect(trail.total).toBe(3);
    expect(trail.entries).toHaveLength(2);
    expect(trail.entries[0].outcome).toBe('b');
    expect(trail.entries[1].outcome).toBe('c');
  });
});
