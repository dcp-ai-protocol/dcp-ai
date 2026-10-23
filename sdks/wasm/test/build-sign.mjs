// buildBundle and signBundle from the built package, in Node, so the wasm32
// code paths run: the signature's created_at comes from the JavaScript clock.
// Needs `npm run build:wasm` and `npm run build:ts` first.
import { readFileSync } from 'node:fs';
import { initDcp } from '../dist/index.js';

const dcp = await initDcp({ module_or_path: readFileSync(new URL('../pkg/dcp_ai_bg.wasm', import.meta.url)) });
const human = dcp.generateHybridKeypair();
const agent = dcp.generateHybridKeypair();
const nonce = dcp.generateSessionNonce();
const entries = (k) => [k.classical, k.pq].map((x) => ({ kid: x.kid, alg: x.alg, public_key_b64: x.public_key_b64, status: 'active' }));
const sign = (context, payload, k) =>
  dcp.signPayload(context, { ...payload, session_nonce: nonce }, k.classical.secret_key_b64, k.classical.kid, k.pq.secret_key_b64, k.pq.kid);
const [humanId, agentId] = ['human:build-sign', 'agent:build-sign'];
const artifacts = {
  rpr: sign('DCP-AI.v2.ResponsiblePrincipal', { human_id: humanId, binding_keys: entries(human) }, human),
  passport: sign(
    'DCP-AI.v2.AgentPassport',
    { agent_id: agentId, keys: entries(agent), principal_binding_reference: humanId, status: 'active' },
    agent,
  ),
  intent: sign('DCP-AI.v2.Intent', { intent_id: 'intent-1', agent_id: agentId, human_id: humanId }, agent),
  policy: sign('DCP-AI.v2.PolicyDecision', { intent_id: 'intent-1', risk_score: 200, decision: 'approve' }, agent),
};
// The audit entry names the intent, by id and payload hash, the agent and the principal,
// and records the policy decision (V2-14).
const audit = {
  audit_id: 'audit-1', session_nonce: nonce, prev_hash: 'GENESIS',
  intent_id: 'intent-1', intent_hash: artifacts.intent.payload_hash, agent_id: agentId, human_id: humanId,
  policy_decision: 'approved',
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
