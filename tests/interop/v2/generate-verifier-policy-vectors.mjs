#!/usr/bin/env node
/**
 * Writes tests/interop/v2/verifier_policy_vectors.json, a new file. It reads committed files and rewrites none: the
 * test keys of interop_vectors.json#test_keys, the default_verifier_policy and committed bundles of bundle_vectors.json,
 * and the action_type and data_classes enums of schemas/v2/intent.schema.json. It binds spec/VERIFICATION.md V2-7,
 * V2-9, V2-10 and V2-12 to verdicts under an exact policy and instant per case. Every negative names a positive control
 * that must pass in the same run, of one of two kinds:
 *   - a single-change twin, for the PQ-invalid and list cases: the same bundle under the same requested mode, with one
 *     PQ signature replaced (PQ-invalid) or under a policy with one restriction added (lists);
 *   - a per-mode control, for the tier cases: the committed classical-only routine bundle under the same requested
 *     mode. Those cases reuse committed bundles signed separately from it, so they are not single-change twins.
 *
 * - routine_hybrid (generated here, the only new signed bundle): every signature pq_over_classical, a PQ checkpoint over
 *   the trail, and a routine tier (browse, low impact, data_classes none, risk_score 0, passport risk_tier low), so
 *   that a requested classical_only mode is also the effective one. The committed standard bundles cannot give that:
 *   their tier raises a requested classical_only to hybrid_preferred.
 * - standard_hybrid: bundle_vectors.json#must_accept_bundles/pq_checkpoint_over_the_trail, referenced by sha256.
 * - PQ present and invalid (V2-7, V2-8, V2-12): the first byte of one PQ signature flipped, in the bundle signature,
 *   the passport or the checkpoint; the classical signature and everything else are unchanged. Checked here without
 *   any SDK: the original PQ signature verifies, the flipped one does not, the classical one still does.
 * - V2-10 lists: accepted_classical_algs, accepted_pq_algs and advisory_rejected_algs that exclude the algorithm
 *   routine_hybrid uses. The classical exclusions under pq_only are left out of this suite pending an interpretation
 *   (question Q1), with no expectation.
 * - V2-9: committed classical-only bundles whose tier is elevated or maximum, under a requested classical_only or
 *   hybrid_preferred mode that alone would accept them, each with the per-mode control above.
 *
 * Keys: the committed public test keys of tests/interop/v2/interop_vectors.json#test_keys (TEST-ONLY, publicly known
 * by design), used by the principal and by the agent. Timestamps, nonce and contents are fixed; Ed25519 signatures are
 * deterministic, ML-DSA-65 signatures are hedged with fresh entropy, so a new run writes different PQ signature bytes
 * and nothing else. The committed file is the artifact; regeneration is not byte-identical.
 *
 * Before writing, routine_hybrid goes through validateV2Bundle and through verifySignedBundleV2 under each requested
 * mode, and every committed reference through its recorded sha256; any other result stops the generator.
 *
 * Run: (cd sdks/typescript && npm run build) && node tests/interop/v2/generate-verifier-policy-vectors.mjs
 */
import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import nacl from 'tweetnacl';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import {
  AlgorithmRegistry, BundleBuilderV2, DCP_CONTEXTS, Ed25519Provider, MlDsa65Provider, auditEventsMerkleRoot, compositeSign,
  preparePayload, signBundleV2, verifySignedBundleV2,
} from '../../../sdks/typescript/dist/index.js';
import { canon, schema } from '../../../tools/conformance/schema-boundary.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const OUTPUT = resolve(HERE, 'verifier_policy_vectors.json');
const VERIFICATION_TIME = '2026-10-22T00:00:00Z';
const B = JSON.parse(readFileSync(resolve(HERE, 'bundle_vectors.json'), 'utf8'));
const POLICY = B.default_verifier_policy;
const TEST_KEYS = JSON.parse(readFileSync(resolve(HERE, 'interop_vectors.json'), 'utf8')).test_keys;
const INTENT_SCHEMA = JSON.parse(readFileSync(resolve(ROOT, 'schemas/v2/intent.schema.json'), 'utf8'));
const hashOf = (obj) => `sha256:${createHash('sha256').update(canon(obj), 'utf8').digest('hex')}`;
const digest = (obj) => createHash('sha256').update(JSON.stringify(obj), 'utf8').digest('hex');
const clone = (v) => JSON.parse(JSON.stringify(v));
const at = (obj, path) => path.reduce((n, k) => n[k], obj);
const set = (obj, path, value) => { at(obj, path.slice(0, -1))[path.at(-1)] = value; return obj; };

// spec/DCP-AI-v2.0.md § 14.2 and § 14.3, spec/VERIFICATION.md V2-9.
const MODES = ['classical_only', 'hybrid_preferred', 'hybrid_required', 'pq_only'];
const TIERS = ['routine', 'standard', 'elevated', 'maximum'];
const ACTION_TYPES = INTENT_SCHEMA.properties.action_type.enum;
const DATA_CLASSES = INTENT_SCHEMA.properties.data_classes.items.enum;
function tierOf(intent, decision) {
  const s = decision?.risk_score;
  const known = decision == null || (Number.isInteger(s) && s >= 0 && s <= 1000);
  const score = decision != null && known ? s : 0;
  const dc = intent.data_classes;
  const has = (list) => Array.isArray(dc) && dc.some((d) => list.includes(d));
  const unknown = !known || !ACTION_TYPES.includes(intent.action_type) || !['low', 'medium', 'high'].includes(intent.estimated_impact) ||
    !Array.isArray(dc) || dc.some((d) => !DATA_CLASSES.includes(d));
  let tier = score >= 800 || has(['credentials', 'children_data']) ? 'maximum'
    : score >= 500 || has(['pii', 'financial_data', 'health_data']) || intent.action_type === 'initiate_payment' || intent.estimated_impact === 'high' || unknown ? 'elevated'
      : score >= 200 || intent.estimated_impact === 'medium' ? 'standard' : 'routine';
  const explicit = intent.security_tier;
  if (explicit !== undefined && explicit !== null) {
    const e = TIERS.includes(explicit) ? explicit : 'elevated';
    if (TIERS.indexOf(e) > TIERS.indexOf(tier)) tier = e;
  }
  return tier;
}
const STRICTNESS = ['classical_only', 'hybrid_preferred', 'hybrid_required'];
const TIER_MODE = { routine: 'classical_only', standard: 'hybrid_preferred', elevated: 'hybrid_required', maximum: 'hybrid_required' };
const effectiveMode = (policyMode, tier) => policyMode === 'pq_only' ? 'pq_only'
  : STRICTNESS[Math.max(STRICTNESS.indexOf(policyMode), STRICTNESS.indexOf(TIER_MODE[tier]))];
// The requested mode: default_mode and every risk_overrides entry, so it is the policy mode whatever the passport risk_tier.
const modePolicy = (mode) => ({ ...clone(POLICY), default_mode: mode, risk_overrides: { low: mode, medium: mode, high: mode } });

const registry = new AlgorithmRegistry();
registry.registerSigner(new Ed25519Provider());
registry.registerSigner(new MlDsa65Provider());
const k = (t) => ({ kid: t.kid, alg: t.alg, secretKeyB64: t.secret_key_b64, publicKeyB64: t.public_key_b64 });
const KEYS = { classical: k(TEST_KEYS.ed25519), pq: k(TEST_KEYS.ml_dsa_65) };
const keyEntries = () => [KEYS.classical, KEYS.pq].map((x) => ({
  kid: x.kid, alg: x.alg, public_key_b64: x.publicKeyB64, created_at: '2026-10-21T00:00:00Z', expires_at: null, status: 'active',
}));
async function sign(payload, context) {
  const { canonicalBytes, payloadHash } = preparePayload(payload);
  return { payload, payload_hash: payloadHash, composite_sig: await compositeSign(registry, context, canonicalBytes, KEYS) };
}

async function buildRoutine() {
  const nonce = createHash('sha256').update('dcp-ai verifier_policy routine session').digest('hex');
  const rpr = {
    dcp_version: '2.0', human_id: 'human:policy-principal', session_nonce: nonce, legal_name: 'Policy Principal',
    entity_type: 'natural_person', jurisdiction: 'US-CA', liability_mode: 'owner_responsible', override_rights: true,
    issued_at: '2026-10-21T00:00:00Z', expires_at: null, contact: null, binding_keys: keyEntries(),
  };
  const passport = {
    dcp_version: '2.0', agent_id: 'agent:policy-bot', session_nonce: nonce, keys: keyEntries(),
    principal_binding_reference: rpr.human_id, capabilities: ['browse'], risk_tier: 'low',
    created_at: '2026-10-21T00:00:00Z', status: 'active',
  };
  const intent = {
    dcp_version: '2.0', intent_id: 'intent:policy-001', session_nonce: nonce, agent_id: passport.agent_id, human_id: rpr.human_id,
    timestamp: '2026-10-21T12:00:00Z', action_type: 'browse', target: { channel: 'web' },
    data_classes: ['none'], estimated_impact: 'low', requires_consent: false,
  };
  const policyDecision = {
    dcp_version: '2.0', intent_id: intent.intent_id, session_nonce: nonce, decision: 'approve', risk_score: 0,
    reasons: ['Read-only browsing'], required_confirmation: null, applied_policy_hash: hashOf({ policy: 'default' }), timestamp: '2026-10-21T12:00:01Z',
  };
  const audit1 = {
    dcp_version: '2.0', audit_id: 'audit:policy-001', session_nonce: nonce, prev_hash: 'GENESIS', hash_alg: 'sha256',
    timestamp: '2026-10-21T12:01:00Z', agent_id: passport.agent_id, human_id: rpr.human_id, intent_id: intent.intent_id,
    intent_hash: hashOf(intent), policy_decision: 'approved', outcome: 'page_read',
    evidence: { tool: 'browser', result_ref: 'page:policy-001', evidence_hash: hashOf({ page: 'policy-001' }) }, pq_checkpoint_ref: null,
  };
  const audit2 = {
    ...clone(audit1), audit_id: 'audit:policy-002', prev_hash: hashOf(audit1), timestamp: '2026-10-21T12:02:00Z',
    evidence: { tool: 'browser', result_ref: 'page:policy-002', evidence_hash: hashOf({ page: 'policy-002' }) },
  };
  const bundle = new BundleBuilderV2(nonce)
    .responsiblePrincipalRecord(await sign(rpr, DCP_CONTEXTS.ResponsiblePrincipal))
    .agentPassport(await sign(passport, DCP_CONTEXTS.AgentPassport))
    .intent(await sign(intent, DCP_CONTEXTS.Intent))
    .policyDecision(await sign(policyDecision, DCP_CONTEXTS.PolicyDecision))
    .addAuditEntries([audit1, audit2])
    .build();
  const checkpoint = {
    checkpoint_id: 'ckpt-policy-001', session_nonce: nonce,
    event_range: { from_audit_id: audit1.audit_id, to_audit_id: audit2.audit_id, count: 2 },
    merkle_root: `sha256:${auditEventsMerkleRoot(bundle.audit_entries)}`,
  };
  bundle.pq_checkpoints = [{ ...checkpoint, composite_sig: await compositeSign(registry, DCP_CONTEXTS.AuditEvent, preparePayload(checkpoint).canonicalBytes, KEYS) }];
  Object.assign(bundle.manifest, { pq_checkpoints: [checkpoint.checkpoint_id], session_issued_at: '2026-10-21T00:00:00Z', session_expires_at: '2099-12-31T23:59:59Z' });
  const signed = await signBundleV2(bundle, { registry, signerType: 'human', signerId: rpr.human_id, keys: KEYS });
  signed.signature.created_at = '2026-10-21T12:03:00Z'; // outside the signed manifest; fixed
  return signed;
}

// The three PQ signatures under test, with the message and key list each is checked against (V2-7, V2-8, V2-12).
const LOCATIONS = {
  bundle: { spec_step: 'V2-7', path: ['signature', 'composite_sig'], context: 'DCP-AI.v2.Bundle', text: (s) => canon(s.bundle.manifest), keys: (s) => s.bundle.responsible_principal_record.payload.binding_keys },
  passport: { spec_step: 'V2-8', path: ['bundle', 'agent_passport', 'composite_sig'], context: 'DCP-AI.v2.AgentPassport', text: (s) => canon(s.bundle.agent_passport.payload), keys: (s) => s.bundle.agent_passport.payload.keys },
  checkpoint: { spec_step: 'V2-12', path: ['bundle', 'pq_checkpoints', 0, 'composite_sig'], context: 'DCP-AI.v2.AuditEvent', text: (s) => { const { composite_sig: _c, ...body } = s.bundle.pq_checkpoints[0]; return canon(body); }, keys: (s) => s.bundle.agent_passport.payload.keys },
};
const flipFirstByte = (sigB64) => { const b = Buffer.from(sigB64, 'base64'); b[0] ^= 0xff; return b.toString('base64'); };
function componentsValid(signed, loc, pqB64) {
  const L = LOCATIONS[loc];
  const cs = at(signed, L.path);
  const msg = Buffer.concat([Buffer.from(L.context, 'utf8'), Buffer.from([0]), Buffer.from(L.text(signed), 'utf8')]);
  const key = (kid) => Buffer.from(L.keys(signed).find((e) => e.kid === kid).public_key_b64, 'base64');
  const csig = Buffer.from(cs.classical.sig_b64, 'base64');
  return {
    classical: nacl.sign.detached.verify(msg, csig, key(cs.classical.kid)),
    pq: ml_dsa65.verify(Buffer.from(pqB64 ?? cs.pq.sig_b64, 'base64'), Buffer.concat([msg, csig]), key(cs.pq.kid)),
  };
}
function pqInvalid(signed) {
  return Object.fromEntries(Object.entries(LOCATIONS).map(([loc, L]) => {
    const path = [...L.path, 'pq', 'sig_b64'];
    const value = flipFirstByte(at(signed, path));
    const before = componentsValid(signed, loc);
    const after = componentsValid(signed, loc, value);
    if (!(before.classical && before.pq && after.classical && !after.pq)) throw new Error(`${loc}: not a single invalid PQ signature (${JSON.stringify({ before, after })})`);
    return [loc, { path, value }];
  }));
}

const fail = (msg) => { throw new Error(msg); };
const tierRecord = (signed) => ({ tier: tierOf(signed.bundle.intent.payload, signed.bundle.policy_decision.payload), passport_risk_tier: signed.bundle.agent_passport.payload.risk_tier });
const committed = (pointer, signed) => ({ source: `tests/interop/v2/bundle_vectors.json#${pointer}`, sha256: digest(signed), ...tierRecord(signed) });

const routine = await buildRoutine();
if (!schema(routine).valid) fail('routine_hybrid is not schema-valid');
for (const mode of MODES) {
  const r = await verifySignedBundleV2(routine, registry, modePolicy(mode), { now: Date.parse(VERIFICATION_TIME) });
  if (r.verified !== true) fail(`routine_hybrid does not verify under ${mode}: ${JSON.stringify(r.errors)}`);
}
const standard = B.must_accept_bundles.find((c) => c.name === 'pq_checkpoint_over_the_trail')?.signed_bundle ?? fail('pq_checkpoint_over_the_trail missing');
const classicalRoutine = B.classical_only_routine_bundle.signed_bundle;
const bundles = {
  routine_hybrid: { source: 'generated by this file', ...tierRecord(routine), signed_bundle: routine, pq_invalid: pqInvalid(routine) },
  standard_hybrid: { ...committed('must_accept_bundles/pq_checkpoint_over_the_trail', standard), pq_invalid: pqInvalid(standard) },
  classical_only_routine: committed('classical_only_routine_bundle', classicalRoutine),
};
if (bundles.routine_hybrid.tier !== 'routine' || bundles.standard_hybrid.tier !== 'standard' || bundles.classical_only_routine.tier !== 'routine') fail('unexpected positive tier');
// V2-9: committed classical-only bundles whose own tier, not the policy, demands hybrid_required.
const raised = B.must_reject_bundles.filter((c) => ['V2-9', 'V2-10'].includes(c.spec_step) && c.signed_bundle.signature.composite_sig.binding === 'classical_only');
for (const c of raised) {
  bundles[c.name] = committed(`must_reject_bundles/${c.name}`, c.signed_bundle);
  if (TIER_MODE[bundles[c.name].tier] !== 'hybrid_required') fail(`${c.name}: tier ${bundles[c.name].tier} does not demand hybrid_required`);
}

const RESTRICTIONS = [
  { name: 'classical_alg_not_accepted', component: 'classical', overrides: { accepted_classical_algs: ['ml-dsa-65'] } },
  { name: 'classical_alg_advisory_rejected', component: 'classical', overrides: { advisory_rejected_algs: ['ed25519'] } },
  { name: 'pq_alg_not_accepted', component: 'pq', overrides: { accepted_pq_algs: ['slh-dsa-192f'] } },
  { name: 'pq_alg_advisory_rejected', component: 'pq', overrides: { advisory_rejected_algs: ['ml-dsa-65'] } },
];
const cases = [];
const omitted = [];
const add = (name, bundle, mode, extra) => {
  const { overrides = {}, ...rest } = extra;
  cases.push({ name, bundle, requested_mode: mode, tier: bundles[bundle].tier, effective_mode: effectiveMode(mode, bundles[bundle].tier),
    policy_overrides: overrides, policy: { ...modePolicy(mode), ...clone(overrides) }, verification_time: VERIFICATION_TIME, ...rest });
};
for (const b of ['routine_hybrid', 'standard_hybrid']) {
  for (const mode of MODES) {
    const control = `${b}.${mode}.positive`;
    add(control, b, mode, { spec_step: 'V2-7, V2-10, V2-12', expect: { verified: true },
      basis: b === 'routine_hybrid' ? 'Every signature pq_over_classical and valid, both algorithms in the accepted lists, none under advisory: no step rejects it in any mode (DCP-AI-v2.0.md § 7.1).'
        : 'bundle_vectors.json _description: every must_accept_bundles entry MUST verify in every mode.' });
    for (const loc of Object.keys(LOCATIONS)) {
      add(`${b}.${mode}.pq_invalid_${loc}`, b, mode, { mutation: `pq_invalid.${loc}`, spec_step: LOCATIONS[loc].spec_step, expect: { verified: false }, controls: [control],
        basis: loc === 'checkpoint' ? 'V2-12 (3): the checkpoint PQ signature MUST be present and valid, in every mode including pq_only.'
          : `${LOCATIONS[loc].spec_step}: a PQ signature that is present MUST verify in every mode (V2-7; DCP-AI-v2.0.md § 7.1).` });
    }
  }
}
for (const mode of MODES) {
  for (const r of RESTRICTIONS) {
    const name = `routine_hybrid.${mode}.${r.name}`;
    if (r.component === 'classical' && mode === 'pq_only') {
      omitted.push({ name, bundle: 'routine_hybrid', requested_mode: mode, effective_mode: 'pq_only', policy_overrides: r.overrides, question: 'Q1' });
      continue;
    }
    add(name, 'routine_hybrid', mode, { overrides: r.overrides, spec_step: 'V2-10', expect: { verified: false }, controls: [`routine_hybrid.${mode}.positive`],
      basis: r.component === 'classical'
        ? 'V2-10: reject if the bundle uses an algorithm not in accepted_classical_algs or blocked by advisory_rejected_algs; every signature carries ed25519 and the effective mode requires the classical signature.'
        : 'V2-10: reject if the bundle uses an algorithm not in accepted_pq_algs or blocked by advisory_rejected_algs; every signature carries ml-dsa-65, and a present PQ signature is processed in every mode (V2-7; DCP-AI-v2.0.md § 7.1).' });
  }
}
for (const mode of ['classical_only', 'hybrid_preferred']) {
  const control = `classical_only_routine.${mode}.positive`;
  add(control, 'classical_only_routine', mode, { spec_step: 'V2-9', expect: { verified: true }, basis: `bundle_vectors.json classical_only_routine_bundle.verified_by_mode.${mode} = true.` });
  for (const c of raised) {
    add(`${c.name}.${mode}`, c.name, mode, { spec_step: 'V2-9', expect: { verified: false }, controls: [control],
      basis: `Tier ${bundles[c.name].tier} raises the requested ${mode} to hybrid_required, which rejects a classical_only binding (V2-9, V2-10); bundle_vectors.json _description: every must_reject_bundles entry is rejected whatever the mode.` });
  }
}
for (const c of cases) if (c.expect.verified === false && c.requested_mode !== c.effective_mode && c.spec_step !== 'V2-9' && c.bundle !== 'standard_hybrid') fail(`${c.name}: unexpected mode raise`);

const corpus = {
  _description: 'Verifier policy vectors (spec/VERIFICATION.md V2-7, V2-9, V2-10, V2-12). Each case gives the exact policy and verification_time, the bundle (by name in bundles; pq_invalid.<location> replaces one PQ signature) and the verdict; a negative counts only if its controls verified in the same run. requested_mode is the mode of the policy; tier and effective_mode are derived from the signed intent and policy decision as spec/DCP-AI-v2.0.md § 14.2 and § 14.3 define them, for the reader: a contract /2 run judges the verdict only, never a resolved tier or mode. Cases left out of this suite pending an interpretation are in omitted, with their question, and have no expectation; questions also records coverage not built here.',
  _generator: 'tests/interop/v2/generate-verifier-policy-vectors.mjs',
  _keys: 'routine_hybrid is signed with the committed TEST-ONLY keys of tests/interop/v2/interop_vectors.json#test_keys (principal and agent); the other bundles are committed in bundle_vectors.json and bound here by the sha256 of their JSON.stringify text.',
  _randomness: 'Construction, timestamps, nonce and Ed25519 signatures are deterministic; ML-DSA-65 signatures are hedged, so regeneration is not byte-identical. The committed file is the artifact.',
  verification_time: VERIFICATION_TIME,
  base_policy: POLICY,
  requested_mode_policy: 'base_policy with default_mode and risk_overrides.low, .medium and .high all set to the requested mode, then policy_overrides; the policy mode is the requested mode whatever the passport risk_tier.',
  derivation: {
    tier: 'spec/DCP-AI-v2.0.md § 14.2 over intent.payload (action_type, estimated_impact, data_classes, security_tier) and policy_decision.payload.risk_score; unknown or missing values fail closed to elevated; security_tier only raises.',
    effective_mode: 'spec/VERIFICATION.md V2-9: the stricter of the policy mode and the tier mode (routine classical_only, standard hybrid_preferred, elevated and maximum hybrid_required; classical_only < hybrid_preferred < hybrid_required); a pq_only policy stays pq_only.',
  },
  bundles,
  cases,
  omitted,
  questions: [
    { id: 'Q1', kind: 'pending interpretation (scope omitted from this suite)',
      question: 'Under an effective pq_only mode, does a policy whose accepted_classical_algs excludes ed25519, or whose advisory_rejected_algs lists ed25519, reject a bundle whose signatures all carry a valid ed25519 component? Left out of this suite until it is interpreted; the clauses below are not shown to conflict: a classical signature that is not required and an algorithm that must be accepted can both hold.',
      clauses: ['spec/VERIFICATION.md V2-10: "Check accepted_classical_algs and accepted_pq_algs — reject if bundle uses an algorithm not in these lists"; "Check advisory_rejected_algs — reject if bundle uses an algorithm blocked by an active advisory".',
        'spec/DCP-AI-v2.0.md § 7.1: pq_only, Classical Required No; § 7.3: classical signatures are accepted but not required, min_classical is 0.'] },
    { id: 'Q2', kind: 'future coverage (not built here)',
      question: 'Under pq_only, the verdict for a present but invalid classical component of the bundle signature or of an artifact signature. For a checkpoint, V2-12 (3) states the pq_only requirement explicitly: the PQ signature.',
      clauses: ['spec/DCP-AI-v2.0.md § 7.1: pq_only, Classical Required No; § 7.3: classical signatures are accepted but not required.', 'spec/VERIFICATION.md V2-12 (3): "Both the classical and the PQ signature MUST be present and valid (in pq_only mode, the PQ one)".'] },
    { id: 'Q3', kind: 'future coverage (not built here)',
      question: 'A classical_only bundle that carries no PQ signature, under a policy whose accepted_pq_algs or advisory_rejected_algs excludes a PQ algorithm.',
      clauses: ['spec/VERIFICATION.md V2-10: "reject if bundle uses an algorithm not in these lists"; "reject if bundle uses an algorithm blocked by an active advisory".'] },
  ],
};
writeFileSync(OUTPUT, JSON.stringify(corpus, null, 2) + '\n');
console.log(`wrote ${OUTPUT}: ${cases.length} cases, ${omitted.length} omitted, ${Object.keys(bundles).length} bundles`);
