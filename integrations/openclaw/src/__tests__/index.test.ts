import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  AlgorithmRegistry,
  DCP_CONTEXTS,
  Ed25519Provider,
  MlDsa65Provider,
  compositeSign,
  preparePayload,
  verifySignedBundle,
} from '@dcp-ai/sdk';
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
  configureVerifier,
} from '../index.js';

// The real SDK, with the V1 verifier wrapped so a test can check it is not called.
vi.mock('@dcp-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dcp-ai/sdk')>();
  return { ...actual, verifySignedBundle: vi.fn(actual.verifySignedBundle) };
});

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
    expect((session.signedRpr!.payload as { pii_salt?: string }).pii_salt).toMatch(
      /^[0-9a-f]{64}$/,
    );
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
  // Cross-SDK vectors: every verifier must accept `signed_bundle` under `default_verifier_policy`.
  const VECTORS = JSON.parse(
    readFileSync(new URL('../../../../tests/interop/v2/bundle_vectors.json', import.meta.url), 'utf8'),
  );
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  const honest = () => clone(VECTORS.signed_bundle);
  const flipFirstByte = (b64: string) => {
    const bytes = Buffer.from(b64, 'base64');
    bytes[0] ^= 0x01;
    return bytes.toString('base64');
  };

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

  it('verifies the honest interop bundle', async () => {
    const signed = honest();
    const result = await executeVerifyBundle({ signed_bundle: signed });
    expect(result.errors).toEqual([]);
    expect(result.verified).toBe(true);
    expect(result.dcp_version).toBe('2.0');
    expect(result.agent_id).toBe('agent:interop-bot');
    expect(result.human_id).toBe('human:interop-principal');
    expect(result.session_nonce).toBe(signed.bundle.manifest.session_nonce);
  });

  it('verifies a bundle signed by dcp_sign_bundle', async () => {
    const SESSION_ID = 'test-verify-round-trip';
    clearSession(SESSION_ID);
    const tools = new Map<string, any>();
    register({ registerTool: (tool: any) => tools.set(tool.name, tool) });
    await executeIdentitySetup({ session_id: SESSION_ID, owner_name: 'Round Trip', jurisdiction: 'US' });
    const intent = await executeDeclareIntent({
      session_id: SESSION_ID,
      action_type: 'api_call',
      target_channel: 'api',
      estimated_impact: 'low',
    });
    await executeLogAction({ session_id: SESSION_ID, intent_id: intent.intent_id, outcome: 'done' });
    const { signed_bundle } = await tools.get('dcp_sign_bundle').execute('call-1', { session_id: SESSION_ID });

    const result = await executeVerifyBundle({ signed_bundle });
    expect(result.errors).toEqual([]);
    expect(result.verified).toBe(true);

    signed_bundle.bundle.intent.payload.action_type = 'initiate_payment';
    expect((await executeVerifyBundle({ signed_bundle })).verified).toBe(false);
  });

  it('rejects a structurally valid but unsigned V2 bundle', async () => {
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
    expect(result.verified).toBe(false);
    expect(result.dcp_version).toBe('2.0');
  });

  it('rejects the bundle with a corrupted classical bundle signature', async () => {
    const forged = honest();
    forged.signature.composite_sig.classical.sig_b64 = flipFirstByte(forged.signature.composite_sig.classical.sig_b64);
    const result = await executeVerifyBundle({ signed_bundle: forged });
    expect(result.verified).toBe(false);
    expect(result.errors.join(' ')).toMatch(/signature/i);
  });

  it('rejects the bundle with a corrupted PQ bundle signature under the default policy', async () => {
    const forged = honest();
    forged.signature.composite_sig.pq.sig_b64 = flipFirstByte(forged.signature.composite_sig.pq.sig_b64);
    const result = await executeVerifyBundle({ signed_bundle: forged });
    expect(result.verified).toBe(false);
  });

  it('rejects the bundle with a changed intent payload and the original signatures', async () => {
    const forged = honest();
    forged.bundle.intent.payload.action_type = 'initiate_payment';
    const result = await executeVerifyBundle({ signed_bundle: forged });
    expect(result.verified).toBe(false);
    expect(result.errors.join(' ')).toMatch(/intent/);
  });

  it('rejects a different bundle carrying the honest bundle signature', async () => {
    const other = clone(VECTORS.must_accept_bundles[0].signed_bundle);
    other.signature.composite_sig = honest().signature.composite_sig;
    const result = await executeVerifyBundle({ signed_bundle: other });
    expect(result.verified).toBe(false);
  });

  it('applies verifier_policy.default_mode to every risk tier', async () => {
    const classicalOnly = () => clone(VECTORS.classical_only_routine_bundle.signed_bundle);
    expect((await executeVerifyBundle({ signed_bundle: classicalOnly() })).verified).toBe(true);
    const result = await executeVerifyBundle({
      signed_bundle: classicalOnly(),
      verifier_policy: { default_mode: 'hybrid_required' },
    });
    expect(result.verified).toBe(false);
  });

  it('rejects an unknown verification mode', async () => {
    const result = await executeVerifyBundle({
      signed_bundle: honest(),
      verifier_policy: { default_mode: 'none' as any },
    });
    expect(result.verified).toBe(false);
    expect(result.errors.join(' ')).toMatch(/default_mode/);
  });

  describe('V1 bundles', () => {
    // A V1 signed bundle (Ed25519 only) from the conformance examples.
    const v1Bundle = () =>
      JSON.parse(
        readFileSync(new URL('../../../../tests/conformance/examples/citizenship_bundle.signed.json', import.meta.url), 'utf8'),
      );

    it('verifies a V1 bundle when every risk tier allows a classical signature', async () => {
      const result = await executeVerifyBundle({
        signed_bundle: v1Bundle(),
        verifier_policy: { default_mode: 'hybrid_preferred' },
      });
      expect(result.errors).toEqual([]);
      expect(result.verified).toBe(true);
      expect(result.dcp_version).toBe('1.0');
    });

    it('verifies the V1 conformance bundle under the default policy', async () => {
      // risk_tier medium (hybrid_preferred), a send_email intent with risk_score 0.21 (standard tier).
      const result = await executeVerifyBundle({ signed_bundle: v1Bundle() });
      expect(result.errors).toEqual([]);
      expect(result.verified).toBe(true);
    });

    it('refuses a V1 payment intent under the default policy without trying the V1 verifier', async () => {
      const payment = v1Bundle();
      payment.bundle.intent.action_type = 'initiate_payment';
      vi.mocked(verifySignedBundle).mockClear();
      const result = await executeVerifyBundle({ signed_bundle: payment });
      expect(result.verified).toBe(false);
      expect(result.errors.join(' ')).toMatch(/V1 bundles are not accepted here.*elevated/);
      expect(verifySignedBundle).not.toHaveBeenCalled();
    });

    it('refuses V1 when verifier_policy sets allow_v1_bundles to false', async () => {
      const result = await executeVerifyBundle({ signed_bundle: v1Bundle(), verifier_policy: { allow_v1_bundles: false } });
      expect(result.verified).toBe(false);
      expect(result.errors.join(' ')).toMatch(/allow_v1_bundles/);
    });

    it('rejects a V1 bundle when verifier_policy requires hybrid signatures', async () => {
      const result = await executeVerifyBundle({
        signed_bundle: v1Bundle(),
        verifier_policy: { default_mode: 'hybrid_required' },
      });
      expect(result.verified).toBe(false);
    });

    it('rejects a bundle whose version it cannot detect instead of trying the V1 verifier', async () => {
      const unknown = v1Bundle();
      delete unknown.bundle.responsible_principal_record.dcp_version;
      vi.mocked(verifySignedBundle).mockClear();
      const result = await executeVerifyBundle({
        signed_bundle: unknown,
        verifier_policy: { default_mode: 'hybrid_preferred' },
      });
      expect(result.verified).toBe(false);
      expect(result.errors.join(' ')).toMatch(/version/i);
      expect(verifySignedBundle).not.toHaveBeenCalled();
    });
  });

  it('does not let the intent lower its own security tier', async () => {
    const nonce = 'b'.repeat(64);
    const result = await executeVerifyBundle({
      signed_bundle: {
        bundle: {
          dcp_bundle_version: '2.0',
          manifest: { session_nonce: nonce },
          intent: {
            payload: {
              session_nonce: nonce,
              action_type: 'browse',
              data_classes: ['pii'],
              estimated_impact: 'low',
              security_tier: 'routine',
            },
          },
          policy_decision: { payload: { session_nonce: nonce, risk_score: 0 } },
        },
        signature: { composite_sig: { classical: 'sig', binding: 'classical_only' } },
      },
    });
    expect(result.resolved_tier).toBe('elevated');
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

// ---------------------------------------------------------------------------
// Shared interop vectors (tests/interop/v2/bundle_vectors.json)
// ---------------------------------------------------------------------------

describe('dcp_verify_bundle on the shared bundle vectors', () => {
  const VECTORS = JSON.parse(
    readFileSync(new URL('../../../../tests/interop/v2/bundle_vectors.json', import.meta.url), 'utf8'),
  );
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  const mutated = (signed: any, mutations: { path: (string | number)[]; value: unknown }[]) => {
    const out = clone(signed);
    for (const { path, value } of mutations) {
      let node = out;
      for (const key of path.slice(0, -1)) node = node[key];
      node[path[path.length - 1]] = value;
    }
    return out;
  };
  // Each case runs under the operator policy default_verifier_policy with the case's
  // verifier_policy_overrides (the tool parameter could only tighten it).
  const operatorPolicy = (overrides: unknown) => ({ ...VECTORS.default_verifier_policy, ...(overrides as object) });
  afterEach(() => configureVerifier());

  const accept = [
    ['signed_bundle', VECTORS.signed_bundle, undefined],
    ...VECTORS.must_accept_bundles.map((c: any) => [c.name, c.signed_bundle, c.verifier_policy_overrides]),
  ];
  for (const [name, signed, overrides] of accept) {
    it(`accepts ${name}`, async () => {
      configureVerifier({ verifierPolicy: operatorPolicy(overrides) });
      const result = await executeVerifyBundle({ signed_bundle: clone(signed) });
      expect(result.errors).toEqual([]);
      expect(result.verified).toBe(true);
    });
  }

  const reject = [
    ...VECTORS.must_reject.map((c: any) => [c.name, mutated(VECTORS.signed_bundle, c.mutations), c.error_contains, c.spec_step, undefined]),
    ...VECTORS.must_reject_bundles.map((c: any) => [c.name, c.signed_bundle, c.error_contains, c.spec_step, c.verifier_policy_overrides]),
  ];
  for (const [name, signed, errorContains, step, overrides] of reject) {
    it(`rejects ${name} (${step})`, async () => {
      configureVerifier({ verifierPolicy: operatorPolicy(overrides) });
      const result = await executeVerifyBundle({ signed_bundle: clone(signed) });
      expect(result.verified).toBe(false);
      expect(result.agent_id).toBeUndefined();
      expect(result.human_id).toBeUndefined();
      expect(result.errors.join(' ').toLowerCase()).toContain(errorContains.toLowerCase());
    });
  }

  for (const [mode, expected] of Object.entries(VECTORS.classical_only_routine_bundle.verified_by_mode)) {
    it(`gives the classical-only routine control its verdict under ${mode}`, async () => {
      const result = await executeVerifyBundle({
        signed_bundle: clone(VECTORS.classical_only_routine_bundle.signed_bundle),
        verifier_policy: { default_mode: mode as any },
      });
      expect(result.verified).toBe(expected);
    });
  }
});

// ---------------------------------------------------------------------------
// The operator sets the policy; the calling model can only tighten it
// ---------------------------------------------------------------------------

describe('verifier policy: operator configuration and tool parameter', () => {
  const VECTORS = JSON.parse(
    readFileSync(new URL('../../../../tests/interop/v2/bundle_vectors.json', import.meta.url), 'utf8'),
  );
  const classicalOnly = () => JSON.parse(JSON.stringify(VECTORS.classical_only_routine_bundle.signed_bundle));
  const nonceSplice = () =>
    JSON.parse(JSON.stringify(VECTORS.must_reject_bundles.find((c: any) => c.name === 'intent_session_nonce_differs').signed_bundle));

  afterEach(() => configureVerifier());

  it('the parameter cannot lower the operator mode', async () => {
    configureVerifier({ verifierPolicy: { default_mode: 'hybrid_required' } });
    const result = await executeVerifyBundle({ signed_bundle: classicalOnly(), verifier_policy: { default_mode: 'classical_only' } });
    expect(result.verified).toBe(false);
    expect(result.verification_mode).toBe('hybrid_required');
  });

  // pq_only requires the PQ signature only, so it is not stricter than a hybrid mode: switching
  // to it would let a forged PQ signature through without the classical one the operator requires.
  it.each([
    ['hybrid_required', 'pq_only', 'hybrid_required'],
    ['hybrid_preferred', 'pq_only', 'hybrid_required'],
    ['classical_only', 'pq_only', 'hybrid_required'],
    ['pq_only', 'pq_only', 'pq_only'],
    ['pq_only', 'hybrid_preferred', 'hybrid_required'],
    ['pq_only', 'classical_only', 'hybrid_required'],
    ['classical_only', 'hybrid_preferred', 'hybrid_preferred'],
    ['hybrid_preferred', 'classical_only', 'hybrid_preferred'],
    ['pq_only', 'hybrid_required', 'hybrid_required'],
  ])('operator %s with the parameter %s verifies in %s', async (operator, param, expected) => {
    configureVerifier({ verifierPolicy: { default_mode: operator as any } });
    const result = await executeVerifyBundle({
      signed_bundle: JSON.parse(JSON.stringify(VECTORS.signed_bundle)),
      verifier_policy: { default_mode: param as any },
    });
    expect(result.verification_mode).toBe(expected);
  });

  // A bundle whose classical signatures are made with someone else's Ed25519 key under the
  // owner's kid, each with a valid ML-DSA signature over it: only pq_only accepts it.
  async function forgedClassicalBundle() {
    const SESSION_ID = 'test-forged-classical';
    clearSession(SESSION_ID);
    const tools = new Map<string, any>();
    register({ registerTool: (tool: any) => tools.set(tool.name, tool) });
    await executeIdentitySetup({ session_id: SESSION_ID, owner_name: 'Forged Classical', jurisdiction: 'US' });
    const intent = await executeDeclareIntent({ session_id: SESSION_ID, action_type: 'api_call', target_channel: 'api', estimated_impact: 'low' });
    await executeLogAction({ session_id: SESSION_ID, intent_id: intent.intent_id, outcome: 'done' });
    const { signed_bundle } = await tools.get('dcp_sign_bundle').execute('call-1', { session_id: SESSION_ID });

    const registry = new AlgorithmRegistry();
    registry.registerSigner(new Ed25519Provider());
    registry.registerSigner(new MlDsa65Provider());
    const owner = (getSession(SESSION_ID) as any).compositeKeys;
    const someoneElse = await new Ed25519Provider().generateKeypair();
    const keys = { classical: { ...owner.classical, secretKeyB64: someoneElse.secretKeyB64 }, pq: owner.pq };
    const resign = async (payload: unknown, context: any) => compositeSign(registry, context, preparePayload(payload).canonicalBytes, keys);
    const b = signed_bundle.bundle;
    const artifacts: Array<[string, any]> = [
      ['responsible_principal_record', DCP_CONTEXTS.ResponsiblePrincipal],
      ['agent_passport', DCP_CONTEXTS.AgentPassport],
      ['intent', DCP_CONTEXTS.Intent],
      ['policy_decision', DCP_CONTEXTS.PolicyDecision],
    ];
    for (const [name, context] of artifacts) b[name].composite_sig = await resign(b[name].payload, context);
    signed_bundle.signature.composite_sig = await resign(b.manifest, DCP_CONTEXTS.Bundle);
    clearSession(SESSION_ID);
    return signed_bundle;
  }

  it('the parameter pq_only does not accept a forged classical signature the operator requires', async () => {
    const forged = await forgedClassicalBundle();
    const run = (param?: any) => executeVerifyBundle({ signed_bundle: JSON.parse(JSON.stringify(forged)), verifier_policy: param });

    configureVerifier({ verifierPolicy: { default_mode: 'pq_only' } });
    expect((await run()).verified).toBe(true); // the PQ signatures are valid: pq_only, the operator's choice, accepts it

    for (const operator of ['classical_only', 'hybrid_preferred', 'hybrid_required'] as const) {
      configureVerifier({ verifierPolicy: { default_mode: operator } });
      expect((await run()).verified).toBe(false);
      const withParam = await run({ default_mode: 'pq_only' });
      expect(withParam.verified).toBe(false);
      expect(withParam.verification_mode).toBe('hybrid_required');
    }
  });

  it('the parameter can raise the mode', async () => {
    const result = await executeVerifyBundle({ signed_bundle: classicalOnly(), verifier_policy: { default_mode: 'hybrid_required' } });
    expect(result.verified).toBe(false);
    expect(result.verification_mode).toBe('hybrid_required');
  });

  it('the parameter cannot turn session binding off', async () => {
    const result = await executeVerifyBundle({ signed_bundle: nonceSplice(), verifier_policy: { require_session_binding: false } });
    expect(result.verified).toBe(false);
    expect(result.errors.join(' ')).toMatch(/nonce/i);
  });

  it('the parameter cannot allow V1 bundles the operator refuses', async () => {
    configureVerifier({ verifierPolicy: { allow_v1_bundles: false } });
    const v1 = JSON.parse(readFileSync(new URL('../../../../tests/conformance/examples/citizenship_bundle.signed.json', import.meta.url), 'utf8'));
    const result = await executeVerifyBundle({ signed_bundle: v1, verifier_policy: { allow_v1_bundles: true } });
    expect(result.verified).toBe(false);
  });

  it('an unknown parameter field is an error', async () => {
    const result = await executeVerifyBundle({ signed_bundle: classicalOnly(), verifier_policy: { risk_overrides: { high: 'classical_only' } } as any });
    expect(result.verified).toBe(false);
    expect(result.errors.join(' ')).toMatch(/Unknown verifier_policy field: risk_overrides/);
  });

  it('a verified result echoes the verification mode; a rejected one names no agent', async () => {
    const ok = await executeVerifyBundle({ signed_bundle: JSON.parse(JSON.stringify(VECTORS.signed_bundle)) });
    expect(ok.verified).toBe(true);
    expect(ok.verification_mode).toBe('hybrid_preferred');
    expect(ok.agent_id).toBe('agent:interop-bot');

    const forged = JSON.parse(JSON.stringify(VECTORS.signed_bundle));
    forged.bundle.agent_passport.payload.agent_id = 'agent:someone-else';
    const bad = await executeVerifyBundle({ signed_bundle: forged });
    expect(bad.verified).toBe(false);
    expect(bad.agent_id).toBeUndefined();
    expect(bad.human_id).toBeUndefined();
    expect(bad.session_nonce).toBeUndefined();
    expect(bad.message).not.toContain('agent:someone-else');
  });

  it('register takes the operator policy and refuses an invalid one', async () => {
    const tools = new Map<string, any>();
    register({ registerTool: (tool: any) => tools.set(tool.name, tool) }, { verifierPolicy: { default_mode: 'hybrid_required' } });
    const result = await tools.get('dcp_verify_bundle').execute('call-1', { signed_bundle: classicalOnly() });
    expect(result.verified).toBe(false);
    expect(() => register({ registerTool: () => {} }, { verifierPolicy: { defaultMode: 'classical_only' } as any })).toThrow(/defaultMode/);
  });

  it('keeps dcp-verify.ts identical to the Express copy', () => {
    const here = readFileSync(new URL('../tools/dcp-verify.ts', import.meta.url), 'utf8');
    const express = readFileSync(new URL('../../../express/src/dcp-verify.ts', import.meta.url), 'utf8');
    expect(here).toBe(express);
  });
});
