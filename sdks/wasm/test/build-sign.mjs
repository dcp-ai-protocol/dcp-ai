// buildBundle and signBundle from the built package, in Node, so the wasm32
// code paths run: the signature's created_at comes from the JavaScript clock.
// Needs `npm run build:wasm` and `npm run build:ts` first.
import { readFileSync } from 'node:fs';
import { initDcp } from '../dist/index.js';

const dcp = await initDcp({ module_or_path: readFileSync(new URL('../pkg/dcp_ai_bg.wasm', import.meta.url)) });
const human = dcp.generateHybridKeypair();
const agent = dcp.generateHybridKeypair();
const nonce = dcp.generateSessionNonce();
const entries = (k) => [k.classical, k.pq].map((x) => ({
  kid: x.kid, alg: x.alg, public_key_b64: x.public_key_b64, status: 'active', created_at: '2026-10-21T00:00:00Z', expires_at: null,
}));
const sign = (context, payload, k) =>
  dcp.signPayload(context, { ...payload, session_nonce: nonce }, k.classical.secret_key_b64, k.classical.kid, k.pq.secret_key_b64, k.pq.kid);
const [humanId, agentId] = ['human:build-sign', 'agent:build-sign'];
// Every member V2-2 requires (spec/VERIFICATION.md V2-2).
const artifacts = {
  rpr: sign('DCP-AI.v2.ResponsiblePrincipal', {
    dcp_version: '2.0', human_id: humanId, binding_keys: entries(human), legal_name: 'Build Sign Principal',
    entity_type: 'natural_person', jurisdiction: 'US-CA', liability_mode: 'owner_responsible', override_rights: true,
    issued_at: '2026-10-21T00:00:00Z', expires_at: null,
  }, human),
  passport: sign(
    'DCP-AI.v2.AgentPassport',
    {
      dcp_version: '2.0', agent_id: agentId, keys: entries(agent), principal_binding_reference: humanId, status: 'active',
      capabilities: ['api_call'], risk_tier: 'medium', created_at: '2026-10-21T00:00:00Z',
    },
    agent,
  ),
  intent: sign('DCP-AI.v2.Intent', {
    dcp_version: '2.0', intent_id: 'intent-1', agent_id: agentId, human_id: humanId, timestamp: '2026-10-21T12:00:00Z',
    action_type: 'api_call', target: { channel: 'api' }, data_classes: [], estimated_impact: 'low', requires_consent: false,
  }, agent),
  policy: sign('DCP-AI.v2.PolicyDecision', {
    dcp_version: '2.0', intent_id: 'intent-1', risk_score: 200, decision: 'approve', reasons: ['test'],
    required_confirmation: null, applied_policy_hash: `sha256:${'0'.repeat(64)}`, timestamp: '2026-10-21T12:00:01Z',
  }, agent),
};
// The audit entry names the intent, by id and payload hash, the agent and the principal,
// and records the policy decision (V2-14).
const audit = {
  dcp_version: '2.0', audit_id: 'audit-1', session_nonce: nonce, prev_hash: 'GENESIS', hash_alg: 'sha256',
  timestamp: '2026-10-21T12:01:00Z', intent_id: 'intent-1', intent_hash: artifacts.intent.payload_hash, agent_id: agentId,
  human_id: humanId, policy_decision: 'approved', outcome: 'done', evidence: {}, pq_checkpoint_ref: null,
};
const signBundle = (bundle) =>
  dcp.signBundle(bundle, human.classical.secret_key_b64, human.classical.kid, human.pq.secret_key_b64, human.pq.kid);

const failures = [];
const check = (name, ok, detail) => { if (!ok) failures.push(`${name}: ${JSON.stringify(detail)}`); };

for (const [name, auditEntries] of [['one entry', [audit]], ['empty trail', []]]) {
  // No sessionNonce: buildBundle takes the RPR's.
  const signed = signBundle(dcp.buildBundle({ ...artifacts, auditEntries }));
  const { created_at, signer } = signed.signature;
  check(`${name}: created_at is an RFC 3339 instant`, new Date(created_at).toISOString() === created_at, created_at);
  check(`${name}: signer.id is the RPR's human_id`, signer.id === 'human:build-sign' && signer.type === 'human', signer);
  check(`${name}: manifest nonce`, signed.bundle.manifest.session_nonce === nonce, signed.bundle.manifest);
  const result = dcp.verifyBundle(signed);
  check(`${name}: verifyBundle`, result.verified, result.errors);
  check(`${name}: no session_issued_at without an expiry`, !('session_issued_at' in signed.bundle.manifest), signed.bundle.manifest);
}

// A session that expires gets its signed start from the JavaScript clock, which a
// maximum session duration is measured from (V2-4).
{
  const { default_verifier_policy: defaults } = JSON.parse(
    readFileSync(new URL('../../../tests/interop/v2/bundle_vectors.json', import.meta.url), 'utf8'),
  );
  const bundle = dcp.buildBundle({ ...artifacts, auditEntries: [audit] });
  bundle.manifest.session_expires_at = new Date(Date.now() + 3_600_000).toISOString();
  const before = Date.now();
  const signed = signBundle(bundle);
  const issued = Date.parse(signed.bundle.manifest.session_issued_at);
  check('session_issued_at is the signing time', issued >= before && issued <= Date.now(), signed.bundle.manifest);
  const within = dcp.verifyBundle(signed, { ...defaults, max_session_duration_seconds: 7200 });
  check('within the maximum session duration', within.verified, within.errors);
  const over = dcp.verifyBundle(signed, { ...defaults, max_session_duration_seconds: 60 });
  check('over the maximum session duration', !over.verified && over.errors.some((e) => e.includes('Session duration')), over.errors);

  // The policy's demands on the signed manifest: an expiry, and an audience checked against verifier_id.
  const audience = (verifier_id) => ({ ...defaults, require_audience_binding: true, verifier_id });
  const errorsOf = (s, policy) => dcp.verifyBundle(s, policy).errors;
  check('require_session_expiry with an expiry', dcp.verifyBundle(signed, { ...defaults, require_session_expiry: true }).verified, errorsOf(signed, { ...defaults, require_session_expiry: true }));
  const noExpiry = signBundle(dcp.buildBundle({ ...artifacts, auditEntries: [audit] }));
  const expiryErrors = errorsOf(noExpiry, { ...defaults, require_session_expiry: true });
  check('require_session_expiry without one', expiryErrors.includes('Policy requires session_expires_at but manifest does not include it'), expiryErrors);
  const noAudience = errorsOf(signed, audience('verifier:a'));
  check('require_audience_binding without intended_verifier', noAudience.includes('Policy requires audience binding but manifest does not include intended_verifier'), noAudience);
  const bound = dcp.buildBundle({ ...artifacts, auditEntries: [audit] });
  bound.manifest.intended_verifier = 'verifier:a';
  const boundSigned = signBundle(bound);
  check('intended for this verifier', dcp.verifyBundle(boundSigned, audience('verifier:a')).verified, errorsOf(boundSigned, audience('verifier:a')));
  const other = errorsOf(boundSigned, audience('verifier:b'));
  check('intended for another verifier', other.includes("Bundle intended for verifier 'verifier:a', not 'verifier:b'"), other);
}

const rejects = (name, fn, needle) => {
  try { fn(); failures.push(`${name}: not rejected`); } catch (e) { check(name, String(e.message).includes(needle), e.message); }
};
rejects('foreign nonce', () => dcp.buildBundle({ ...artifacts, auditEntries: [audit], sessionNonce: 'cd'.repeat(32) }), 'Session nonce mismatch');
rejects('stale payload_hash', () => dcp.buildBundle({ ...artifacts, rpr: { ...artifacts.rpr, payload: { ...artifacts.rpr.payload, human_id: 'human:other' } }, auditEntries: [audit] }), 'payload_hash does not match');
rejects('short secret key', () => dcp.signBundle(dcp.buildBundle({ ...artifacts, auditEntries: [audit] }), 'AAAA', human.classical.kid, human.pq.secret_key_b64, human.pq.kid), 'invalid secret key length');

if (failures.length) {
  console.error(`buildBundle/signBundle: ${failures.length} failure(s)\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('buildBundle/signBundle: all checks passed');
