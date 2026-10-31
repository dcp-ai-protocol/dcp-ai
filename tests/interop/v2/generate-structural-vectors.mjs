#!/usr/bin/env node
/**
 * Writes tests/interop/v2/structural_vectors.json, a new file. It reads committed files and rewrites none: the test keys
 * of interop_vectors.json#test_keys and the default_verifier_policy of bundle_vectors.json. It holds one signed V2
 * bundle (the base) and cases that each break one structural rule of spec/VERIFICATION.md (V2-3, V2-4, V2-5, V2-6,
 * V2-12), built from the base by changing only what the rule names and re-signing only what that change invalidates:
 *
 * - sig_b64 representation (V2-5): the classical sig_b64 of the RPR, the passport, the policy decision or the checkpoint
 *   gets non-zero trailing bits. The decoded bytes are unchanged, so every signature stays valid; only the encoding
 *   is non-canonical (Ed25519: 64 bytes, 4 trailing bits; an ML-DSA-65 signature, 3309 bytes, has none, so this
 *   mechanism does not apply to it; other byte-preserving forms are not covered here).
 * - checkpoints (V2-12): without its PQ component; with an invalid classical component and a PQ component signed again
 *   over those classical bytes; an event_range running backwards over real trail positions; an event_range naming an
 *   audit_id absent from the trail. The checkpoint body and its signature are redone; the manifest lists only its id.
 * - manifest (V2-3, V2-4): audit_count off with the right root, passport_hash or policy_hash off, session_issued_at
 *   after session_expires_at; the manifest is signed again, so the bundle signature is valid.
 * - bundle signature (V2-6): an invalid classical component with the PQ component signed again over those bytes, so
 *   V2-7 is not what fails.
 * - a fraction in intent.payload.target (open) (V2-3, dcp-jcs-v1): it has no dcp-jcs-v1 form, so no hash or signature
 *   can commit to it; the base hashes and signatures are kept and are stale by construction.
 *
 * The trail has three entries whose audit_ids are in neither numeric nor lexical order, and the base checkpoint covers
 * positions 1 and 2, so a verifier must locate a range by trail position.
 *
 * Keys: the committed public test keys of tests/interop/v2/interop_vectors.json#test_keys (TEST-ONLY, publicly known
 * by design), used by the principal and by the agent. Construction, timestamps, nonce and Ed25519 signatures are
 * deterministic; ML-DSA-65 signatures are hedged, so a new run writes different PQ signature bytes. The committed file
 * is the artifact; regeneration is not byte-identical.
 *
 * Before writing, every bundle goes through validateV2Bundle and the SDK-free checks of
 * tools/conformance/structural-checks.js, which must give exactly the declared failures (the violations the case is
 * built to carry, not an exhaustive list of its defects), and the two positives through
 * verifySignedBundleV2 at the corpus instant; any other result stops the generator. Negatives are never run through an
 * SDK here: their expectation comes from the rule they cite.
 *
 * Run: (cd sdks/typescript && npm run build) && node tests/interop/v2/generate-structural-vectors.mjs
 */
import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  AlgorithmRegistry, BundleBuilderV2, DCP_CONTEXTS, Ed25519Provider, MlDsa65Provider, compositeSign, preparePayload,
  signBundleV2, verifySignedBundleV2,
} from '../../../sdks/typescript/dist/index.js';
import { canon, schema } from '../../../tools/conformance/schema-boundary.js';
import { canonicalB64, checkpointText, components, merkleRoot, structure } from '../../../tools/conformance/structural-checks.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(HERE, 'structural_vectors.json');
const VERIFICATION_TIME = '2026-10-22T00:00:00Z';
const POLICY = JSON.parse(readFileSync(resolve(HERE, 'bundle_vectors.json'), 'utf8')).default_verifier_policy;
const TEST_KEYS = JSON.parse(readFileSync(resolve(HERE, 'interop_vectors.json'), 'utf8')).test_keys;
const hashOf = (obj) => `sha256:${createHash('sha256').update(canon(obj), 'utf8').digest('hex')}`;
const clone = (v) => JSON.parse(JSON.stringify(v));
const at = (obj, path) => path.reduce((n, k) => n[k], obj);
const fail = (msg) => { throw new Error(msg); };

const registry = new AlgorithmRegistry();
registry.registerSigner(new Ed25519Provider());
registry.registerSigner(new MlDsa65Provider());
const k = (t) => ({ kid: t.kid, alg: t.alg, secretKeyB64: t.secret_key_b64, publicKeyB64: t.public_key_b64 });
const KEYS = { classical: k(TEST_KEYS.ed25519), pq: k(TEST_KEYS.ml_dsa_65) };
const keyEntries = () => [KEYS.classical, KEYS.pq].map((x) => ({
  kid: x.kid, alg: x.alg, public_key_b64: x.publicKeyB64, created_at: '2026-10-21T00:00:00Z', expires_at: null, status: 'active',
}));
const dsm = (context, text) => Buffer.concat([Buffer.from(context, 'utf8'), Buffer.from([0]), Buffer.from(text, 'utf8')]);
const compositeOver = (context, text) => compositeSign(registry, context, new Uint8Array(Buffer.from(text, 'utf8')), KEYS);
async function sign(payload, context) {
  const { canonicalBytes, payloadHash } = preparePayload(payload);
  return { payload, payload_hash: payloadHash, composite_sig: await compositeSign(registry, context, canonicalBytes, KEYS) };
}
/** The classical component made invalid (first byte flipped), then the PQ component signed again over those bytes. */
async function classicalInvalid(context, text, cs) {
  const bad = Buffer.from(cs.classical.sig_b64, 'base64');
  bad[0] ^= 0xff;
  const pq = await registry.getSigner(KEYS.pq.alg).sign(new Uint8Array(Buffer.concat([dsm(context, text), bad])), KEYS.pq.secretKeyB64);
  return { ...cs, classical: { ...cs.classical, sig_b64: bad.toString('base64') }, pq: { ...cs.pq, sig_b64: Buffer.from(pq).toString('base64') } };
}
/** The same bytes with non-zero trailing bits: a padded Ed25519 signature ends in one character carrying 4 unused bits. */
function trailingBits(sigB64) {
  if (!sigB64.endsWith('==')) fail('expected a padded signature');
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const i = sigB64.length - 3;
  const v = A.indexOf(sigB64[i]);
  if (v & 0x0f) fail('trailing bits already set');
  const out = sigB64.slice(0, i) + A[v | 0x05] + sigB64.slice(i + 1);
  if (!Buffer.from(out, 'base64').equals(Buffer.from(sigB64, 'base64')) || canonicalB64(out)) fail('not a byte-preserving non-canonical form');
  return out;
}

const NONCE = createHash('sha256').update('dcp-ai structural session').digest('hex');
const AUDIT_IDS = ['audit:structural-k7', 'audit:structural-b2', 'audit:structural-m4']; // neither numeric nor lexical order
const CHECKPOINT = { from: 1, to: 2 }; // trail positions the base checkpoint covers

async function buildBase() {
  const rpr = {
    dcp_version: '2.0', human_id: 'human:structural-principal', session_nonce: NONCE, legal_name: 'Structural Principal',
    entity_type: 'natural_person', jurisdiction: 'US-CA', liability_mode: 'owner_responsible', override_rights: true,
    issued_at: '2026-10-21T00:00:00Z', expires_at: null, contact: null, binding_keys: keyEntries(),
  };
  const passport = {
    dcp_version: '2.0', agent_id: 'agent:structural-bot', session_nonce: NONCE, keys: keyEntries(),
    principal_binding_reference: rpr.human_id, capabilities: ['browse', 'api_call'], risk_tier: 'medium',
    created_at: '2026-10-21T00:00:00Z', status: 'active',
  };
  const intent = {
    dcp_version: '2.0', intent_id: 'intent:structural-001', session_nonce: NONCE, agent_id: passport.agent_id, human_id: rpr.human_id,
    timestamp: '2026-10-21T12:00:00Z', action_type: 'send_email', target: { channel: 'email', to: 'bob@example.com', domain: 'example.com' },
    data_classes: ['contact_info'], estimated_impact: 'medium', requires_consent: false,
  };
  const policyDecision = {
    dcp_version: '2.0', intent_id: intent.intent_id, session_nonce: NONCE, decision: 'approve', risk_score: 450,
    reasons: ['Known recipient domain'], required_confirmation: null, applied_policy_hash: hashOf({ policy: 'default' }), timestamp: '2026-10-21T12:00:01Z',
  };
  const trail = [];
  AUDIT_IDS.forEach((id, i) => trail.push({
    dcp_version: '2.0', audit_id: id, session_nonce: NONCE, prev_hash: i === 0 ? 'GENESIS' : hashOf(trail[i - 1]), hash_alg: 'sha256',
    timestamp: `2026-10-21T12:0${i + 1}:00Z`, agent_id: passport.agent_id, human_id: rpr.human_id, intent_id: intent.intent_id,
    intent_hash: hashOf(intent), policy_decision: 'approved', outcome: 'email_sent',
    evidence: { tool: 'smtp', result_ref: `msg:structural-${i + 1}`, evidence_hash: hashOf({ message: `structural-${i + 1}` }) }, pq_checkpoint_ref: null,
  }));
  const bundle = new BundleBuilderV2(NONCE)
    .responsiblePrincipalRecord(await sign(rpr, DCP_CONTEXTS.ResponsiblePrincipal))
    .agentPassport(await sign(passport, DCP_CONTEXTS.AgentPassport))
    .intent(await sign(intent, DCP_CONTEXTS.Intent))
    .policyDecision(await sign(policyDecision, DCP_CONTEXTS.PolicyDecision))
    .addAuditEntries(trail)
    .build();
  const body = {
    checkpoint_id: 'ckpt-structural-001', session_nonce: NONCE,
    event_range: { from_audit_id: AUDIT_IDS[CHECKPOINT.from], to_audit_id: AUDIT_IDS[CHECKPOINT.to], count: CHECKPOINT.to - CHECKPOINT.from + 1 },
    merkle_root: merkleRoot(trail.slice(CHECKPOINT.from, CHECKPOINT.to + 1)),
  };
  bundle.pq_checkpoints = [{ ...body, composite_sig: await compositeOver(DCP_CONTEXTS.AuditEvent, canon(body)) }];
  Object.assign(bundle.manifest, { pq_checkpoints: [body.checkpoint_id], session_issued_at: '2026-10-21T00:00:00Z', session_expires_at: '2099-12-31T23:59:59Z' });
  const signed = await signBundleV2(bundle, { registry, signerType: 'human', signerId: rpr.human_id, keys: KEYS });
  signed.signature.created_at = '2026-10-21T12:03:00Z'; // outside the signed manifest; fixed
  return signed;
}

/** The base with the manifest patched and signed again: manifest_hash and the bundle composite signature redone. */
async function resignManifest(base, patch) {
  const s = clone(base);
  Object.assign(s.bundle.manifest, patch);
  const text = canon(s.bundle.manifest);
  s.signature.manifest_hash = `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
  s.signature.composite_sig = await compositeOver(DCP_CONTEXTS.Bundle, text);
  return s;
}
/** The base with the checkpoint body patched and its composite signature redone (`sig` adjusts it afterwards). */
async function resignCheckpoint(base, patch, sig = async (cs) => cs) {
  const s = clone(base);
  const { composite_sig: _old, ...body } = s.bundle.pq_checkpoints[0];
  Object.assign(body, patch);
  const text = canon(body);
  s.bundle.pq_checkpoints[0] = { ...body, composite_sig: await sig(await compositeOver(DCP_CONTEXTS.AuditEvent, text), text) };
  return s;
}
const setPath = (base, path, value) => { const s = clone(base); at(s, path.slice(0, -1))[path.at(-1)] = value; return s; };

const base = await buildBase();
const ART = { responsible_principal_record: 'rpr', agent_passport: 'passport', policy_decision: 'policy_decision' };
const CP = ['bundle', 'pq_checkpoints', 0];
const SESSION_NEGATIVE = { session_issued_at: '2026-10-22T00:00:20Z', session_expires_at: '2026-10-22T00:00:10Z' };
const SESSION_TWIN = { session_issued_at: '2026-10-22T00:00:05Z', session_expires_at: '2026-10-22T00:00:10Z' };
const resigned = (what) => `re-signed: ${what}`;
const representation = 'byte-preserving: the decoded signature bytes are unchanged, nothing re-signed';

const cases = [];
for (const [name, label] of Object.entries(ART)) {
  const path = ['bundle', name, 'composite_sig', 'classical', 'sig_b64'];
  cases.push({ name: `${label}_classical_sig_b64_trailing_bits`, spec_step: 'V2-5', construction: representation, changed_paths: [path],
    signed_bundle: setPath(base, path, trailingBits(at(base, path))), expect_failures: [`${name}: classical sig_b64 not canonical`],
    rule: 'V2-5: every sig_b64, in the bundle signature, the artifacts’ and the checkpoints’, MUST be canonical base64 (padded, zero trailing bits).' });
}
{
  const path = [...CP, 'composite_sig', 'classical', 'sig_b64'];
  cases.push({ name: 'checkpoint_classical_sig_b64_trailing_bits', spec_step: 'V2-5', construction: representation, changed_paths: [path],
    signed_bundle: setPath(base, path, trailingBits(at(base, path))), expect_failures: ['checkpoint ckpt-structural-001: classical sig_b64 not canonical'],
    rule: 'V2-5: every sig_b64, in the bundle signature, the artifacts’ and the checkpoints’, MUST be canonical base64 (padded, zero trailing bits).' });
}
cases.push({ name: 'checkpoint_without_pq', spec_step: 'V2-12', construction: resigned('checkpoint composite signature, classical component only (binding classical_only, pq null)'),
  changed_paths: [[...CP, 'composite_sig']],
  signed_bundle: await resignCheckpoint(base, {}, async (cs) => ({ ...cs, binding: 'classical_only', pq: null })),
  expect_failures: ['checkpoint ckpt-structural-001: pq signature absent'],
  rule: 'V2-12 (3): both the classical and the PQ signature MUST be present and valid (in pq_only mode, the PQ one); this holds in every mode, including the hybrid_preferred mode of this corpus, which would accept an artifact without PQ.' });
cases.push({ name: 'checkpoint_classical_invalid_pq_resigned', spec_step: 'V2-12', construction: resigned('checkpoint classical component invalid (first byte flipped), PQ component signed again over those classical bytes'),
  changed_paths: [[...CP, 'composite_sig']],
  signed_bundle: await resignCheckpoint(base, {}, (cs, text) => classicalInvalid(DCP_CONTEXTS.AuditEvent, text, cs)),
  expect_failures: ['checkpoint ckpt-structural-001: classical signature'],
  rule: 'V2-12 (3): both the classical and the PQ signature MUST be present and valid; the effective mode here (hybrid_preferred) requires the classical one. Under pq_only, V2-12 (3) requires only the PQ one, so no pq_only verdict is claimed.' });
cases.push({ name: 'checkpoint_range_backwards', spec_step: 'V2-12', construction: resigned('checkpoint body (from_audit_id and to_audit_id swapped) and its composite signature'),
  changed_paths: [[...CP, 'event_range'], [...CP, 'composite_sig']],
  signed_bundle: await resignCheckpoint(base, { event_range: { from_audit_id: AUDIT_IDS[CHECKPOINT.to], to_audit_id: AUDIT_IDS[CHECKPOINT.from], count: 2 } }),
  expect_failures: ['checkpoint ckpt-structural-001: event_range is not a forward run of the trail'],
  rule: 'V2-12 (2): event_range names a contiguous run of audit_entries, from the entry whose audit_id is from_audit_id to the one whose audit_id is to_audit_id, with count entries. Here from_audit_id is at trail position 2 and to_audit_id at position 1: no run goes from the first to the second. count (2) and merkle_root (over positions 1 and 2, in trail order) are what a verifier that ignored the direction would compute.' });
cases.push({ name: 'checkpoint_from_audit_id_absent', spec_step: 'V2-12', construction: resigned('checkpoint body (from_audit_id replaced by an id the trail does not hold) and its composite signature'),
  changed_paths: [[...CP, 'event_range', 'from_audit_id'], [...CP, 'composite_sig']],
  signed_bundle: await resignCheckpoint(base, { event_range: { from_audit_id: 'audit:structural-x9', to_audit_id: AUDIT_IDS[CHECKPOINT.to], count: 2 } }),
  expect_failures: ['checkpoint ckpt-structural-001: event_range names an audit_id absent from the trail'],
  rule: 'V2-12 (2): the range starts at the entry whose audit_id is from_audit_id; no entry has it. count and merkle_root are those of the base range (positions 1 and 2).' });
cases.push({ name: 'manifest_audit_count_off_root_right', spec_step: 'V2-3', construction: resigned('manifest (audit_count 3 → 4), manifest_hash and bundle composite signature'),
  changed_paths: [['bundle', 'manifest', 'audit_count'], ['signature', 'manifest_hash'], ['signature', 'composite_sig']],
  signed_bundle: await resignManifest(base, { audit_count: 4 }), expect_failures: ['manifest.audit_count'],
  rule: 'V2-3: audit_count MUST equal the number of audit_entries; audit_merkle_root is the right root of the three entries. 4 exceeds the trail, so a verifier that took the first audit_count entries would still compute the right root.' });
cases.push({ name: 'manifest_passport_hash_off', spec_step: 'V2-3', construction: resigned('manifest (passport_hash of another object), manifest_hash and bundle composite signature'),
  changed_paths: [['bundle', 'manifest', 'passport_hash'], ['signature', 'manifest_hash'], ['signature', 'composite_sig']],
  signed_bundle: await resignManifest(base, { passport_hash: hashOf({ other: 'passport' }) }), expect_failures: ['manifest.passport_hash'],
  rule: 'V2-3: recompute each artifact hash from the canonical payload and verify it matches the manifest value and the artifact payload_hash; the passport payload_hash is right, the manifest value is not.' });
cases.push({ name: 'manifest_policy_hash_off', spec_step: 'V2-3', construction: resigned('manifest (policy_hash of another object), manifest_hash and bundle composite signature'),
  changed_paths: [['bundle', 'manifest', 'policy_hash'], ['signature', 'manifest_hash'], ['signature', 'composite_sig']],
  signed_bundle: await resignManifest(base, { policy_hash: hashOf({ other: 'policy' }) }), expect_failures: ['manifest.policy_hash'],
  rule: 'V2-3: as for passport_hash, with the policy decision.' });
cases.push({ name: 'intent_payload_fraction', spec_step: 'V2-3', construction: 'one member set after signing; nothing can be re-signed (no dcp-jcs-v1 form exists)',
  changed_paths: [['bundle', 'intent', 'payload', 'target', 'ratio']],
  signed_bundle: setPath(base, ['bundle', 'intent', 'payload', 'target', 'ratio'], 0.5), expect_failures: ['structure: not an integer: 0.5'],
  rule: 'V2-3: a payload that cannot be canonicalized fails verification; dcp-jcs-v1 (spec/CANONICALIZATION_PROFILE.md) accepts integers only, so 0.5 has no canonical form. intent.target is open, so the payload stays schema-valid.' });
cases.push({ name: 'session_issued_after_expires', spec_step: 'V2-4', construction: resigned('manifest (session_issued_at 20 s and session_expires_at 10 s after the verification time), manifest_hash and bundle composite signature'),
  changed_paths: [['bundle', 'manifest', 'session_issued_at'], ['bundle', 'manifest', 'session_expires_at'], ['signature', 'manifest_hash'], ['signature', 'composite_sig']],
  signed_bundle: await resignManifest(base, SESSION_NEGATIVE), expect_failures: ['session: issued after it expires'],
  twin: 'session_issued_before_expires',
  rule: 'V2-4: reject the bundle when session_issued_at is after session_expires_at. At the corpus instant the session has not expired and session_issued_at is within the 30 s skew V2-4 allows, so only the order is wrong.' });
cases.push({ name: 'bundle_classical_invalid_pq_resigned', spec_step: 'V2-6', construction: 'bundle classical component invalid (first byte flipped), PQ component signed again over those classical bytes; the manifest is unchanged',
  changed_paths: [['signature', 'composite_sig']],
  signed_bundle: await (async () => { const s = clone(base); s.signature.composite_sig = await classicalInvalid(DCP_CONTEXTS.Bundle, canon(s.bundle.manifest), s.signature.composite_sig); return s; })(),
  expect_failures: ['bundle: classical signature'],
  rule: 'V2-6: verify the classical signature over DCP-AI.v2.Bundle || 0x00 || canonical(manifest) with the RPR binding key; the PQ signature over those classical bytes is valid, so V2-7 does not fail. The effective mode here (hybrid_preferred) requires the classical signature; pq_only is not claimed.' });
const positives = [
  { name: 'session_issued_before_expires', spec_step: 'V2-4', construction: resigned('manifest (session_issued_at 5 s and session_expires_at 10 s after the verification time), manifest_hash and bundle composite signature'),
    changed_paths: [['bundle', 'manifest', 'session_issued_at'], ['bundle', 'manifest', 'session_expires_at'], ['signature', 'manifest_hash'], ['signature', 'composite_sig']],
    signed_bundle: await resignManifest(base, SESSION_TWIN), expect_failures: [],
    rule: 'V2-4: the twin of session_issued_after_expires: not expired, issued within the 30 s skew, and issued before it expires.' },
];

// Every bundle: schema-valid, and the SDK-free checks give exactly the declared failures (none for a positive).
for (const c of [{ name: 'base', signed_bundle: base, expect_failures: [] }, ...positives, ...cases]) {
  if (!schema(c.signed_bundle).valid) fail(`${c.name}: not schema-valid`);
  const got = structure(c.signed_bundle, VERIFICATION_TIME);
  if (JSON.stringify(got) !== JSON.stringify(c.expect_failures)) fail(`${c.name}: structural checks give ${JSON.stringify(got)}, declared ${JSON.stringify(c.expect_failures)}`);
}
for (const s of [base, positives[0].signed_bundle]) {
  const r = await verifySignedBundleV2(s, registry, POLICY, { now: Date.parse(VERIFICATION_TIME) });
  if (r.verified !== true) fail(`a positive does not verify: ${JSON.stringify(r.errors)}`);
}
// The two isolation claims on signatures, component by component.
const iso = (s, label) => label === 'bundle'
  ? components(DCP_CONTEXTS.Bundle, canon(s.bundle.manifest), s.signature.composite_sig, s.bundle.responsible_principal_record.payload.binding_keys)
  : components(DCP_CONTEXTS.AuditEvent, checkpointText(s.bundle.pq_checkpoints[0]), s.bundle.pq_checkpoints[0].composite_sig, s.bundle.agent_passport.payload.keys);
for (const [name, label] of [['bundle_classical_invalid_pq_resigned', 'bundle'], ['checkpoint_classical_invalid_pq_resigned', 'checkpoint']]) {
  const c = iso(cases.find((x) => x.name === name).signed_bundle, label);
  if (c.classical !== false || c.pq !== true) fail(`${name}: components ${JSON.stringify(c)}`);
}

const corpus = {
  _description: 'Structural vectors (spec/VERIFICATION.md V2-3, V2-4, V2-5, V2-6, V2-12). Under verifier_policy at verification_time, base and the positives MUST verify and every case MUST be rejected. Each case names the rule it breaks, the paths it changes from the base, its control (the base, and for the session case also its twin) and the failures that tools/conformance/structural-checks.js computes for it without any SDK. Policy mode: the passport risk_tier medium selects risk_overrides.medium (hybrid_preferred); the tier is standard (send_email, medium impact, contact_info, risk_score 450), so the effective mode is hybrid_preferred, which requires the classical signature.',
  _generator: 'tests/interop/v2/generate-structural-vectors.mjs',
  _keys: 'Every signature is made with the committed TEST-ONLY keys of tests/interop/v2/interop_vectors.json#test_keys (principal and agent).',
  _randomness: 'Construction, timestamps, nonce and Ed25519 signatures are deterministic; ML-DSA-65 signatures are hedged, so regeneration is not byte-identical. The committed file is the artifact.',
  verification_time: VERIFICATION_TIME,
  verifier_policy: POLICY,
  effective_mode: 'hybrid_preferred',
  base,
  positives: positives.map(({ signed_bundle, ...rest }) => ({ ...rest, expect: { verified: true }, signed_bundle })),
  cases: cases.map(({ signed_bundle, expect_failures, ...rest }) => ({ ...rest, expect: { verified: false, structural_failures: expect_failures }, signed_bundle })),
  isolation_limits: [
    'intent_payload_fraction: a fraction has no dcp-jcs-v1 form, so no payload_hash, manifest commitment or signature can be made over it; the base ones are kept and are stale, and any verifier rejects the bundle on them too. The case shows the verdict, not that dcp-jcs-v1 alone rejects; it is not a validly signed bundle under any normative profile, and no other profile is used to sign it.',
    'checkpoint_range_backwards: no merkle_root can be right for a run that does not exist; the one kept is that of the same two entries in trail order, so only the direction differs from the base. A range with a gap cannot be written without a count or a merkle_root that disagrees with the named run, which bundle_vectors.json already covers (pq_checkpoint_event_range_count_wrong, pq_checkpoint_merkle_root_other).',
    'session_issued_after_expires: with session_issued_at after session_expires_at and the session not expired, session_issued_at is necessarily after the verification time; it stays within the 30 s skew, and the twin positive (issued 5 s after that instant) is its control, so a verifier without that skew fails the control and the negative is not counted.',
    'The sig_b64 cases use the classical component and one byte-preserving mechanism, non-zero trailing bits: an ML-DSA-65 signature (3309 bytes, a multiple of 3) has no padding and no trailing bits, so this mechanism does not apply to it. Other non-canonical forms that a permissive decoder maps to the same bytes (ignored whitespace or other characters, for instance) are not covered here; bundle_vectors.json has some for the bundle PQ sig_b64 only (a newline, extra padding, trailing junk).',
  ],
};
writeFileSync(OUTPUT, JSON.stringify(corpus, null, 2) + '\n');
console.log(`wrote ${OUTPUT}: base, ${positives.length} positive, ${cases.length} cases`);
