#!/usr/bin/env node
/**
 * Writes tests/interop/v2/effective_policy_vectors.json, a new file. It reads committed files and rewrites none: the
 * test keys of interop_vectors.json#test_keys and the default_verifier_policy of bundle_vectors.json. It adds the signed
 * bundles that the effective-policy catalog (contract dcp-ai-conformance-external/5) needs and the existing corpora lack:
 * valid positives at the elevated and maximum tiers under each requested mode, the risk_score boundaries, the explicit
 * and declared security_tier floors, and passport risk_tier overrides of the base policy that differ from its default.
 *
 * Expectations are written by hand from spec/DCP-AI-v2.0.md § 14.2 (tier) and § 14.3 / spec/VERIFICATION.md V2-9
 * (effective mode: the policy mode for the passport risk_tier, an override replacing default_mode, then raised to the
 * tier's floor; pq_only stays pq_only). The generator checks them against the independent handwritten rules below and
 * stops on any difference; it never calls an SDK tier or mode helper. It calls verifySignedBundleV2 of the TypeScript
 * SDK only to check each verdict before writing, and reads no other field of its result.
 *
 * Keys: the committed public test keys of tests/interop/v2/interop_vectors.json#test_keys (TEST-ONLY, publicly known by
 * design), for the principal and the agent. Timestamps, nonces and contents are fixed; Ed25519 signatures are
 * deterministic, ML-DSA-65 signatures are hedged, so regeneration is not byte-identical. The committed file is the
 * artifact.
 *
 * Run: (cd sdks/typescript && npm run build) && node tests/interop/v2/generate-effective-policy-vectors.mjs
 */
import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  AlgorithmRegistry, BundleBuilderV2, DCP_CONTEXTS, Ed25519Provider, MlDsa65Provider, auditEventsMerkleRoot, classicalOnlySign,
  compositeSign, preparePayload, signBundleV2, signBundleV2ClassicalOnly, verifySignedBundleV2,
} from '../../../sdks/typescript/dist/index.js';
import { canon, schema } from '../../../tools/conformance/schema-boundary.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
// --out <file> writes elsewhere (for regeneration checks); the committed file is the default.
const OUTPUT = process.argv[2] === '--out' && process.argv[3] ? resolve(process.argv[3]) : resolve(HERE, 'effective_policy_vectors.json');
const VERIFICATION_TIME = '2026-10-22T00:00:00Z';
const B = JSON.parse(readFileSync(resolve(HERE, 'bundle_vectors.json'), 'utf8'));
const BASE_POLICY = B.default_verifier_policy;
const TEST_KEYS = JSON.parse(readFileSync(resolve(HERE, 'interop_vectors.json'), 'utf8')).test_keys;
const INTENT_SCHEMA = JSON.parse(readFileSync(resolve(ROOT, 'schemas/v2/intent.schema.json'), 'utf8'));
const hashOf = (obj) => `sha256:${createHash('sha256').update(canon(obj), 'utf8').digest('hex')}`;
const clone = (v) => JSON.parse(JSON.stringify(v));
const fail = (msg) => { throw new Error(msg); };

// ── Independent handwritten rules (spec/DCP-AI-v2.0.md § 14.2, § 14.3; spec/VERIFICATION.md V2-9) ──
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
// The policy mode is the override for the passport risk_tier when the policy has one, else default_mode (an override
// replaces the default, and may be lower); then the tier floor raises it. Not max(default, override, tier).
const policyModeOf = (policy, riskTier) => (riskTier && Object.hasOwn(policy.risk_overrides ?? {}, riskTier) ? policy.risk_overrides[riskTier] : policy.default_mode);
const effectiveModeOf = (policyMode, tier) => policyMode === 'pq_only' ? 'pq_only'
  : STRICTNESS[Math.max(STRICTNESS.indexOf(policyMode), STRICTNESS.indexOf(TIER_MODE[tier]))];
const modePolicy = (mode) => ({ ...clone(BASE_POLICY), default_mode: mode, risk_overrides: { low: mode, medium: mode, high: mode } });

// ── Signing (TEST-ONLY keys) ──
const registry = new AlgorithmRegistry();
registry.registerSigner(new Ed25519Provider());
registry.registerSigner(new MlDsa65Provider());
const k = (t) => ({ kid: t.kid, alg: t.alg, secretKeyB64: t.secret_key_b64, publicKeyB64: t.public_key_b64 });
const KEYS = { classical: k(TEST_KEYS.ed25519), pq: k(TEST_KEYS.ml_dsa_65) };
const keyEntries = () => [KEYS.classical, KEYS.pq].map((x) => ({
  kid: x.kid, alg: x.alg, public_key_b64: x.publicKeyB64, created_at: '2026-10-21T00:00:00Z', expires_at: null, status: 'active',
}));

// One bundle per spec. hybrid: every signature pq_over_classical and a PQ checkpoint over the trail; otherwise every
// signature classical_only and no checkpoint.
async function build(name, spec) {
  const hybrid = spec.hybrid !== false;
  const sign = async (payload, context) => {
    const { canonicalBytes, payloadHash } = preparePayload(payload);
    const composite_sig = hybrid ? await compositeSign(registry, context, canonicalBytes, KEYS) : await classicalOnlySign(registry, context, canonicalBytes, KEYS.classical);
    return { payload, payload_hash: payloadHash, composite_sig };
  };
  const nonce = createHash('sha256').update(`dcp-ai effective_policy ${name} session`).digest('hex');
  const rpr = {
    dcp_version: '2.0', human_id: 'human:effective-principal', session_nonce: nonce, legal_name: 'Effective Policy Principal',
    entity_type: 'natural_person', jurisdiction: 'US-CA', liability_mode: 'owner_responsible', override_rights: true,
    issued_at: '2026-10-21T00:00:00Z', expires_at: null, contact: null, binding_keys: keyEntries(),
  };
  const passport = {
    dcp_version: '2.0', agent_id: 'agent:effective-bot', session_nonce: nonce, keys: keyEntries(),
    principal_binding_reference: rpr.human_id, capabilities: ['browse'], risk_tier: spec.passport_risk_tier,
    created_at: '2026-10-21T00:00:00Z', status: 'active',
  };
  const intent = {
    dcp_version: '2.0', intent_id: `intent:${name}`, session_nonce: nonce, agent_id: passport.agent_id, human_id: rpr.human_id,
    timestamp: '2026-10-21T12:00:00Z', action_type: 'browse', target: { channel: 'web' },
    data_classes: ['none'], estimated_impact: 'low', requires_consent: false, ...spec.intent,
  };
  const policyDecision = {
    dcp_version: '2.0', intent_id: intent.intent_id, session_nonce: nonce, decision: 'approve', risk_score: spec.risk_score,
    reasons: ['Conformance fixture'], required_confirmation: null, applied_policy_hash: hashOf({ policy: 'default' }),
    timestamp: '2026-10-21T12:00:01Z', ...spec.decision,
  };
  const audit1 = {
    dcp_version: '2.0', audit_id: `audit:${name}-001`, session_nonce: nonce, prev_hash: 'GENESIS', hash_alg: 'sha256',
    timestamp: '2026-10-21T12:01:00Z', agent_id: passport.agent_id, human_id: rpr.human_id, intent_id: intent.intent_id,
    intent_hash: hashOf(intent), policy_decision: 'approved', outcome: 'done',
    evidence: { tool: 'browser', result_ref: `page:${name}-001`, evidence_hash: hashOf({ page: `${name}-001` }) }, pq_checkpoint_ref: null,
  };
  const audit2 = {
    ...clone(audit1), audit_id: `audit:${name}-002`, prev_hash: hashOf(audit1), timestamp: '2026-10-21T12:02:00Z',
    evidence: { tool: 'browser', result_ref: `page:${name}-002`, evidence_hash: hashOf({ page: `${name}-002` }) },
  };
  const bundle = new BundleBuilderV2(nonce)
    .responsiblePrincipalRecord(await sign(rpr, DCP_CONTEXTS.ResponsiblePrincipal))
    .agentPassport(await sign(passport, DCP_CONTEXTS.AgentPassport))
    .intent(await sign(intent, DCP_CONTEXTS.Intent))
    .policyDecision(await sign(policyDecision, DCP_CONTEXTS.PolicyDecision))
    .addAuditEntries([audit1, audit2])
    .build();
  Object.assign(bundle.manifest, { session_issued_at: '2026-10-21T00:00:00Z', session_expires_at: '2099-12-31T23:59:59Z' });
  let signed;
  if (hybrid) {
    const checkpoint = {
      checkpoint_id: `ckpt-${name}`, session_nonce: nonce,
      event_range: { from_audit_id: audit1.audit_id, to_audit_id: audit2.audit_id, count: 2 },
      merkle_root: `sha256:${auditEventsMerkleRoot(bundle.audit_entries)}`,
    };
    bundle.pq_checkpoints = [{ ...checkpoint, composite_sig: await compositeSign(registry, DCP_CONTEXTS.AuditEvent, preparePayload(checkpoint).canonicalBytes, KEYS) }];
    bundle.manifest.pq_checkpoints = [checkpoint.checkpoint_id];
    signed = await signBundleV2(bundle, { registry, signerType: 'human', signerId: rpr.human_id, keys: KEYS });
  } else {
    signed = await signBundleV2ClassicalOnly(bundle, { registry, signerType: 'human', signerId: rpr.human_id, key: KEYS.classical });
  }
  signed.signature.created_at = '2026-10-21T12:03:00Z'; // outside the signed manifest; fixed
  return signed;
}

// ── Bundles: the tier and its source are written by hand ──
const BUNDLES = {
  elevated_payment_hybrid: { tier: 'elevated', source_of_tier: 'intent.action_type initiate_payment (§ 14.2)', spec: { passport_risk_tier: 'low', intent: { action_type: 'initiate_payment' }, risk_score: 0 } },
  maximum_risk_800_hybrid: { tier: 'maximum', source_of_tier: 'policy_decision.risk_score 800, the lowest maximum score (§ 14.2); policy_decision.resolved_tier says routine, which § 14.2 does not read', spec: { passport_risk_tier: 'low', risk_score: 800, decision: { resolved_tier: 'routine' } } },
  standard_risk_200_hybrid: { tier: 'standard', source_of_tier: 'policy_decision.risk_score 200, the lowest standard score (§ 14.2)', spec: { passport_risk_tier: 'low', risk_score: 200 } },
  elevated_risk_500_hybrid: { tier: 'elevated', source_of_tier: 'policy_decision.risk_score 500, the lowest elevated score (§ 14.2)', spec: { passport_risk_tier: 'low', risk_score: 500 } },
  elevated_risk_799_hybrid: { tier: 'elevated', source_of_tier: 'policy_decision.risk_score 799, the highest elevated score (§ 14.2)', spec: { passport_risk_tier: 'low', risk_score: 799 } },
  routine_declared_maximum_hybrid: { tier: 'maximum', source_of_tier: 'intent.security_tier maximum over a routine computation: an explicit tier only raises (§ 14.2)', spec: { passport_risk_tier: 'low', intent: { security_tier: 'maximum' }, risk_score: 0 } },
  payment_declaring_routine_hybrid: { tier: 'elevated', source_of_tier: 'intent.action_type initiate_payment; its security_tier routine does not lower it (§ 14.2)', spec: { passport_risk_tier: 'low', intent: { action_type: 'initiate_payment', security_tier: 'routine' }, risk_score: 0 } },
  passport_low_routine_hybrid: { tier: 'routine', source_of_tier: 'routine intent (browse, low impact, data_classes none, risk_score 0); passport risk_tier low', spec: { passport_risk_tier: 'low', risk_score: 0 } },
  passport_high_routine_hybrid: { tier: 'routine', source_of_tier: 'routine intent; passport risk_tier high', spec: { passport_risk_tier: 'high', risk_score: 0 } },
  passport_low_standard_hybrid: { tier: 'standard', source_of_tier: 'intent.estimated_impact medium (§ 14.2); passport risk_tier low', spec: { passport_risk_tier: 'low', intent: { estimated_impact: 'medium' }, risk_score: 0 } },
  classical_only_passport_high_routine: { tier: 'routine', source_of_tier: 'routine intent; passport risk_tier high; every signature classical_only', spec: { passport_risk_tier: 'high', risk_score: 0, hybrid: false } },
};

// ── Cases: 17, every expectation written by hand ──
const CASES = [];
const add = (name, bundle, policyKind, requested, effective, verified, basis, controls) => CASES.push({ name, bundle, policy_kind: policyKind, requested_mode: requested, expect: { verified, effective: { verification_mode: effective, resolved_tier: BUNDLES[bundle].tier } }, basis, ...(controls ? { controls } : {}) });
for (const b of ['elevated_payment_hybrid', 'maximum_risk_800_hybrid']) {
  for (const m of MODES) {
    const eff = m === 'pq_only' ? 'pq_only' : 'hybrid_required';
    add(`${b}.${m}.positive`, b, 'requested_mode', m, eff, true,
      m === 'pq_only' ? `Tier ${BUNDLES[b].tier}; a pq_only policy stays pq_only (§ 14.3); every signature verifies.`
        : `Tier ${BUNDLES[b].tier} sets the floor hybrid_required${m === 'hybrid_required' ? ', equal to the requested mode' : `, which raises the requested ${m}`} (V2-9); every signature verifies.`);
  }
}
for (const [b, eff] of [['standard_risk_200_hybrid', 'hybrid_preferred'], ['elevated_risk_500_hybrid', 'hybrid_required'], ['elevated_risk_799_hybrid', 'hybrid_required'], ['routine_declared_maximum_hybrid', 'hybrid_required'], ['payment_declaring_routine_hybrid', 'hybrid_required']]) {
  add(`${b}.classical_only.positive`, b, 'requested_mode', 'classical_only', eff, true, `${BUNDLES[b].source_of_tier}: tier ${BUNDLES[b].tier}, whose floor ${eff} raises the requested classical_only (V2-9).`);
}
add('passport_low_routine_hybrid.base_policy.positive', 'passport_low_routine_hybrid', 'base_policy', 'classical_only', 'classical_only', true,
  'Base policy: the low override (classical_only) replaces default_mode (hybrid_preferred), and the routine floor keeps it (V2-9).');
add('passport_high_routine_hybrid.base_policy.positive', 'passport_high_routine_hybrid', 'base_policy', 'hybrid_required', 'hybrid_required', true,
  'Base policy: the high override (hybrid_required) replaces default_mode (hybrid_preferred); the routine floor does not lower it (V2-9).');
add('passport_low_standard_hybrid.base_policy.positive', 'passport_low_standard_hybrid', 'base_policy', 'classical_only', 'hybrid_preferred', true,
  'Base policy: the low override (classical_only) replaces default_mode, then the standard floor raises it to hybrid_preferred (V2-9).');
add('classical_only_passport_high_routine.base_policy.rejected', 'classical_only_passport_high_routine', 'base_policy', 'hybrid_required', 'hybrid_required', false,
  'Base policy: the high override sets hybrid_required, which rejects a bundle whose signatures are classical_only (V2-9, V2-10); under a requested classical_only it verifies.',
  ['passport_high_routine_hybrid.base_policy.positive']);
if (CASES.length !== 17) fail(`expected 17 cases, built ${CASES.length}`);

// ── Build, then check every expectation against the handwritten rules and every verdict through the TS SDK ──
const bundles = {};
for (const [name, b] of Object.entries(BUNDLES)) {
  const signed = await build(name, b.spec);
  if (!schema(signed).valid) fail(`${name} is not schema-valid`);
  const t = tierOf(signed.bundle.intent.payload, signed.bundle.policy_decision.payload);
  if (t !== b.tier) fail(`${name}: handwritten tier ${b.tier}, rules give ${t}`);
  bundles[name] = { tier: b.tier, source_of_tier: b.source_of_tier, passport_risk_tier: b.spec.passport_risk_tier, binding: b.spec.hybrid === false ? 'classical_only' : 'pq_over_classical', signed_bundle: signed };
}
for (const c of CASES) {
  c.policy = c.policy_kind === 'base_policy' ? clone(BASE_POLICY) : modePolicy(c.requested_mode);
  c.verification_time = VERIFICATION_TIME;
  const pm = policyModeOf(c.policy, bundles[c.bundle].passport_risk_tier);
  if (pm !== c.requested_mode) fail(`${c.name}: policy mode ${pm}, written ${c.requested_mode}`);
  const eff = effectiveModeOf(pm, bundles[c.bundle].tier);
  if (eff !== c.expect.effective.verification_mode) fail(`${c.name}: handwritten mode ${c.expect.effective.verification_mode}, rules give ${eff}`);
  const r = await verifySignedBundleV2(bundles[c.bundle].signed_bundle, registry, c.policy, { now: Date.parse(VERIFICATION_TIME) });
  if (r.verified !== c.expect.verified) fail(`${c.name}: verified ${r.verified}, expected ${c.expect.verified}: ${JSON.stringify(r.errors)}`);
}
// The negative is rejected for its mode: under a requested classical_only the same bundle verifies.
{
  const r = await verifySignedBundleV2(bundles.classical_only_passport_high_routine.signed_bundle, registry, modePolicy('classical_only'), { now: Date.parse(VERIFICATION_TIME) });
  if (r.verified !== true) fail(`classical_only_passport_high_routine does not verify under classical_only: ${JSON.stringify(r.errors)}`);
}

const corpus = {
  _description: 'Effective-policy vectors for the opt-in catalog of contract dcp-ai-conformance-external/5. Each case gives the exact policy and verification_time, the bundle (by name in bundles) and the expected verdict, verification mode and security tier. A /5 run judges the verdict and the mode and tier the implementation reports from its own verification, never a value recomputed by the kit. A negative counts only if its controls passed in the same run.',
  _generator: 'tests/interop/v2/generate-effective-policy-vectors.mjs',
  _keys: 'Every bundle is signed with the committed TEST-ONLY keys of tests/interop/v2/interop_vectors.json#test_keys (principal and agent).',
  _randomness: 'Construction, timestamps, nonces and Ed25519 signatures are deterministic; ML-DSA-65 signatures are hedged, so regeneration is not byte-identical. The committed file is the artifact.',
  verification_time: VERIFICATION_TIME,
  base_policy: BASE_POLICY,
  requested_mode_policy: 'base_policy with default_mode and risk_overrides.low, .medium and .high all set to the requested mode; the policy mode is the requested mode whatever the passport risk_tier.',
  derivation: {
    tier: 'spec/DCP-AI-v2.0.md § 14.2 over intent.payload (action_type, estimated_impact, data_classes, security_tier) and policy_decision.payload.risk_score; security_tier only raises; policy_decision.resolved_tier is informational and not read.',
    effective_mode: 'spec/VERIFICATION.md V2-9 and spec/DCP-AI-v2.0.md § 14.3: the policy mode is risk_overrides[passport risk_tier] when present, otherwise default_mode (an override replaces the default and may be lower); the effective mode is the stricter of that mode and the tier floor (routine classical_only, standard hybrid_preferred, elevated and maximum hybrid_required); a pq_only policy stays pq_only.',
  },
  bundles,
  cases: CASES.map(({ policy_kind: _k, ...c }) => c),
};
writeFileSync(OUTPUT, JSON.stringify(corpus, null, 2) + '\n');
console.log(`wrote ${OUTPUT}: ${CASES.length} cases, ${Object.keys(bundles).length} bundles`);
