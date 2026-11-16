// TypeScript agent for tools/interop-matrix (protocol in ../../README.md).
// Imports the LOCAL SDK build: run `npm install && npm run build` in sdks/typescript first.
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import {
  AdmissionConfigError,
  AlgorithmRegistry,
  BundleBuilderV2,
  DCP_CONTEXTS,
  DEFAULT_VERIFIER_POLICY,
  Ed25519Provider,
  MlDsa65Provider,
  admitSignedBundleV2,
  canonicalizeV2,
  compositeSign,
  computeSecurityTier,
  createPrincipalTrustStore,
  generateSessionNonce,
  preparePayload,
  resolveStrictV1Profile,
  sha256Hex,
  signBundleV2,
  verifySignedBundleV2,
} from '../../../../sdks/typescript/dist/index.js';

const registry = new AlgorithmRegistry();
registry.registerSigner(new Ed25519Provider());
registry.registerSigner(new MlDsa65Provider());

const now = () => new Date().toISOString();
const sha256 = (text) => `sha256:${sha256Hex(new TextEncoder().encode(text))}`;
let state = null;
// Operator configuration per tenant for the admission scenario: { trust, profile }.
const tenants = new Map();

async function keyPair() {
  const c = await registry.getSigner('ed25519').generateKeypair();
  const p = await registry.getSigner('ml-dsa-65').generateKeypair();
  return {
    classical: { kid: c.kid, alg: 'ed25519', secretKeyB64: c.secretKeyB64, publicKeyB64: c.publicKeyB64 },
    pq: { kid: p.kid, alg: 'ml-dsa-65', secretKeyB64: p.secretKeyB64, publicKeyB64: p.publicKeyB64 },
  };
}
const publicKeys = (keys) => [keys.classical, keys.pq].map((k) => ({ kid: k.kid, alg: k.alg, public_key_b64: k.publicKeyB64 }));
const entries = (keys, at) =>
  [keys.classical, keys.pq].map((k) => ({ kid: k.kid, alg: k.alg, public_key_b64: k.publicKeyB64, created_at: at, expires_at: null, status: 'active' }));

async function signed(payload, context, keys) {
  const { canonicalBytes, payloadHash } = preparePayload(payload);
  return { payload, payload_hash: payloadHash, composite_sig: await compositeSign(registry, context, canonicalBytes, keys) };
}

const commands = {
  async identity({ owner_name, jurisdiction }) {
    const [human, agent] = [await keyPair(), await keyPair()];
    const at = now();
    const nonce = generateSessionNonce();
    const humanId = `rpr:${randomUUID()}`;
    const agentId = `agent:${randomUUID()}`;
    const rpr = {
      dcp_version: '2.0', human_id: humanId, session_nonce: nonce, legal_name: owner_name, entity_type: 'natural_person',
      jurisdiction, liability_mode: 'owner_responsible', override_rights: true, issued_at: at, expires_at: null, contact: null,
      binding_keys: entries(human, at),
    };
    const passport = {
      dcp_version: '2.0', agent_id: agentId, session_nonce: nonce, keys: entries(agent, at), principal_binding_reference: humanId,
      capabilities: ['api_call', 'payments'], risk_tier: 'medium', created_at: at, status: 'active',
    };
    state = {
      human, agent, nonce, humanId, agentId, intents: new Map(),
      rpr: await signed(rpr, DCP_CONTEXTS.ResponsiblePrincipal, human),
      passport: await signed(passport, DCP_CONTEXTS.AgentPassport, agent),
    };
    return { agent_id: agentId, human_id: humanId, session_nonce: nonce, principal_keys: publicKeys(human), agent_keys: publicKeys(agent) };
  },

  async intent({ action_type, channel, data_classes, estimated_impact, risk_score, applied_policy_hash }) {
    if (!state) throw new Error('no identity');
    const at = now();
    const draft = {
      dcp_version: '2.0', intent_id: `intent:${randomUUID()}`, session_nonce: state.nonce, agent_id: state.agentId,
      human_id: state.humanId, timestamp: at, action_type, target: { channel, to: null }, data_classes, estimated_impact,
      requires_consent: estimated_impact === 'high',
    };
    const tier = computeSecurityTier(draft, { risk_score });
    const intent = { ...draft, security_tier: tier };
    const decision = risk_score < 500 ? 'approve' : risk_score < 800 ? 'escalate' : 'block';
    const policy = {
      dcp_version: '2.0', intent_id: intent.intent_id, session_nonce: state.nonce, decision, risk_score,
      reasons: [`interop-matrix: risk_score ${risk_score}`],
      required_confirmation: decision === 'approve' ? null : { type: 'human_approve', fields: ['action_type'] },
      applied_policy_hash, timestamp: at, resolved_tier: tier,
    };
    state.intents.set(intent.intent_id, {
      intent: await signed(intent, DCP_CONTEXTS.Intent, state.agent),
      policy: await signed(policy, DCP_CONTEXTS.PolicyDecision, state.agent),
      trail: [],
    });
    return { intent_id: intent.intent_id, decision, security_tier: tier };
  },

  async act({ intent_id, outcome, tool, result_ref }) {
    const it = state?.intents.get(intent_id);
    if (!it) throw new Error(`unknown intent ${intent_id}`);
    const prev = it.trail.at(-1);
    const decision = it.policy.payload.decision;
    it.trail.push({
      dcp_version: '2.0', audit_id: `audit:${randomUUID()}`, session_nonce: state.nonce,
      prev_hash: prev ? sha256(canonicalizeV2(prev)) : 'GENESIS', hash_alg: 'sha256', timestamp: now(),
      agent_id: state.agentId, human_id: state.humanId, intent_id, intent_hash: sha256(canonicalizeV2(it.intent.payload)),
      policy_decision: { approve: 'approved', escalate: 'escalated', block: 'blocked' }[decision], outcome,
      evidence: { tool, result_ref, evidence_hash: sha256(result_ref) }, pq_checkpoint_ref: null,
    });
    return { audit_id: it.trail.at(-1).audit_id, count: it.trail.length };
  },

  async bundle({ intent_id, session_issued_at, session_expires_at, intended_verifier }) {
    const it = state?.intents.get(intent_id);
    if (!it) throw new Error(`unknown intent ${intent_id}`);
    const bundle = new BundleBuilderV2(state.nonce)
      .responsiblePrincipalRecord(state.rpr)
      .agentPassport(state.passport)
      .intent(it.intent)
      .policyDecision(it.policy)
      .addAuditEntries(it.trail)
      .build();
    if (session_issued_at) bundle.manifest.session_issued_at = session_issued_at;
    const signed_bundle = await signBundleV2(bundle, {
      registry, signerType: 'human', signerId: state.humanId, keys: state.human,
      sessionExpiresAt: session_expires_at, intendedVerifier: intended_verifier,
    });
    return { signed_bundle };
  },

  async verify({ signed_bundle, mode }) {
    const policy = mode
      ? { ...DEFAULT_VERIFIER_POLICY, default_mode: mode, risk_overrides: { low: mode, medium: mode, high: mode } }
      : DEFAULT_VERIFIER_POLICY;
    const r = await verifySignedBundleV2(signed_bundle, registry, policy);
    return { valid: r.verified === true, errors: r.errors };
  },

  // A new principal key pair and an RPR (same human_id) signed with it; later bundles use it.
  async rotate_principal() {
    if (!state) throw new Error('no identity');
    const human = await keyPair();
    const at = now();
    const rpr = { ...state.rpr.payload, issued_at: at, binding_keys: entries(human, at) };
    state.rpr = await signed(rpr, DCP_CONTEXTS.ResponsiblePrincipal, human);
    state.human = human;
    return { human_id: state.humanId, principal_keys: publicKeys(human) };
  },

  async configure({ tenant, trust_set, profile }) {
    try {
      tenants.set(tenant, { trust: createPrincipalTrustStore(trust_set), profile: resolveStrictV1Profile(profile) });
    } catch (e) {
      if (e instanceof AdmissionConfigError) return { config_error: e.code };
      throw e;
    }
    return {};
  },

  async admit({ tenant, signed_bundle, revocation, now_ms }) {
    const t = tenants.get(tenant);
    if (!t) throw new Error(`unknown tenant ${tenant}`);
    const { verification, ...result } = await admitSignedBundleV2(signed_bundle, registry, {
      profile: t.profile, trust: t.trust, revocation, now: now_ms,
    });
    return { ...result, verification_errors: verification.errors };
  },

  async shutdown() {
    setImmediate(() => process.exit(0));
    return {};
  },
};

for await (const line of createInterface({ input: process.stdin })) {
  if (line.trim() === '') continue;
  let id = null;
  try {
    const req = JSON.parse(line);
    id = req.id;
    const handler = Object.hasOwn(commands, req.cmd) ? commands[req.cmd] : null;
    if (!handler) throw new Error(`unknown command ${req.cmd}`);
    process.stdout.write(JSON.stringify({ id, ok: true, result: await handler(req.args ?? {}) }) + '\n');
  } catch (e) {
    process.stdout.write(JSON.stringify({ id, ok: false, error: e instanceof Error ? e.message : String(e) }) + '\n');
  }
}
