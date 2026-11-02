#!/usr/bin/env node
/**
 * Writes the shared corpus of the SDK schema-validation work (spec/VERIFICATION.md V2-2, phase 1), new files only:
 *
 *   tests/interop/v2/schema_validation/schema_cases.json   site-by-site SCHEMA cases (unsigned instances)
 *   tests/interop/v2/schema_validation/wiring_cases.json   SIGNED cases for the real verifier entry points
 *   tests/interop/v2/schema_validation/coverage.json       every assertion site of the IR -> the cases that cover it
 *   tests/interop/v2/schema_validation/date_time_cases.json the date-time boundary (ajv-formats 3.0.1, decision D2)
 *   tools/conformance/external-schema-validation-catalog.json  opt-in /2 catalog of the wiring cases
 *
 * Expectations come from the two schema oracles only (tools/schema-ir/oracle-ajv.mjs, Ajv with the upstream
 * ajv-formats; tools/schema-ir/oracle_jsonschema.py, python-jsonschema), never from the IR evaluator under test. Both
 * must give the same verdict for every case, except the one declared difference (Ajv takes a non-finite number for an
 * integer; the schema domain is finite JSON numbers). A schema expectation is not a verification expectation:
 * - schema cases change committed content without signing it again, so they carry no full-verifier expectation;
 * - wiring cases are signed again with every commitment redone (or changed only in unsigned regions), checked by the
 *   SDK-free structural check structure() of tools/conformance/structural-checks.js (the integrity() of
 *   schema-boundary.js — every payload hash and manifest commitment, the audit chain and root, the bundle and artifact
 *   signatures — plus, for the pq_checkpoints: listed and carried ids, event_range ids, order and count, merkle_root,
 *   session_nonce and both signature components; plus canonical sig_b64 and the session order at the corpus time), and
 *   carry both expectations and the reason.
 *
 * Keys: the committed public test keys of tests/interop/v2/interop_vectors.json#test_keys (TEST-ONLY). Construction is
 * deterministic; ML-DSA-65 signatures are hedged, so regeneration rewrites those bytes only.
 *
 * Run: SCHEMA_IR_PYTHON=<python3 with jsonschema> node tests/interop/v2/generate-schema-validation-vectors.mjs
 */
import { createHash } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import ajvFormats from 'ajv-formats/dist/formats.js';
import {
  AlgorithmRegistry, BundleBuilderV2, DCP_CONTEXTS, Ed25519Provider, MlDsa65Provider, compositeSign, preparePayload,
  signBundleV2, verifySignedBundleV2,
} from '../../../sdks/typescript/dist/index.js';
import { canon } from '../../../tools/conformance/schema-boundary.js';
import { merkleRoot, structure } from '../../../tools/conformance/structural-checks.js';
import { buildIR, readSchemaDir } from '../../../tools/schema-ir/generate.mjs';
import { ajvValidate } from '../../../tools/schema-ir/oracle-ajv.mjs';
import { pythonValidate } from '../../../tools/schema-ir/oracle-python.mjs';
import { checkCoverage, checkIR, sourceSites } from '../../../tools/schema-ir/source-sites.mjs';
import { compilePattern } from '../../../tools/schema-ir/patterns.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const OUT = resolve(HERE, 'schema_validation');
const CATALOG = resolve(REPO, 'tools', 'conformance', 'external-schema-validation-catalog.json');
const VERIFICATION_TIME = '2026-10-22T00:00:00Z';
const POLICY = JSON.parse(readFileSync(resolve(HERE, 'bundle_vectors.json'), 'utf8')).default_verifier_policy;
const TEST_KEYS = JSON.parse(readFileSync(resolve(HERE, 'interop_vectors.json'), 'utf8')).test_keys;
const upstreamDateTime = ajvFormats.fullFormats['date-time'].validate;
const hex = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const hashOf = (obj) => `sha256:${createHash('sha256').update(canon(obj), 'utf8').digest('hex')}`;
const clone = (v) => JSON.parse(JSON.stringify(v));
const fail = (msg) => { throw new Error(msg); };
const escapeToken = (t) => String(t).replace(/~/g, '~0').replace(/\//g, '~1');
const pointer = (path) => path.map((t) => `/${escapeToken(t)}`).join('');
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ── Signed construction (wiring cases) ──
const registry = new AlgorithmRegistry();
registry.registerSigner(new Ed25519Provider());
registry.registerSigner(new MlDsa65Provider());
const k = (t) => ({ kid: t.kid, alg: t.alg, secretKeyB64: t.secret_key_b64, publicKeyB64: t.public_key_b64 });
const KEYS = { classical: k(TEST_KEYS.ed25519), pq: k(TEST_KEYS.ml_dsa_65) };
const NONCE = hex('dcp-ai schema_validation session');
const AUDIT_IDS = ['audit:schema-validation-001', 'audit:schema-validation-002', 'audit:schema-validation-003'];
const CHECKPOINT_ID = 'ckpt-schema-validation-001';
const keyEntries = (expires = null) => [KEYS.classical, KEYS.pq].map((x) => ({
  kid: x.kid, alg: x.alg, public_key_b64: x.publicKeyB64, created_at: '2026-10-21T00:00:00Z', expires_at: expires, status: 'active',
}));
async function sign(payload, context) {
  const { canonicalBytes, payloadHash } = preparePayload(payload);
  return { payload, payload_hash: payloadHash, composite_sig: await compositeSign(registry, context, canonicalBytes, KEYS) };
}

/** The unsigned parts of the wiring base: every optional member the schemas allow that the verifiers accept. */
function parts() {
  const rpr = {
    dcp_version: '2.0', human_id: 'human:schema-validation-principal', session_nonce: NONCE, legal_name: 'Schema Validation Principal',
    entity_type: 'natural_person', jurisdiction: 'US-CA', liability_mode: 'owner_responsible', override_rights: true,
    issued_at: '2026-10-21T00:00:00Z', expires_at: null, contact: 'principal@example.com', binding_keys: keyEntries(),
    pii_salt: hex('dcp-ai schema_validation pii salt'),
  };
  const passport = {
    dcp_version: '2.0', agent_id: 'agent:schema-validation-bot', session_nonce: NONCE, keys: keyEntries('2099-12-31T23:59:59Z'),
    principal_binding_reference: rpr.human_id, capabilities: ['browse', 'api_call', 'email'], risk_tier: 'medium',
    created_at: '2026-10-21T00:00:00Z', status: 'active', emergency_revocation_token: hashOf({ token: 'schema-validation' }),
  };
  const intent = {
    dcp_version: '2.0', intent_id: 'intent:schema-validation-001', session_nonce: NONCE, agent_id: passport.agent_id, human_id: rpr.human_id,
    timestamp: '2026-10-21T12:00:00Z', action_type: 'send_email',
    target: { channel: 'email', to: 'bob@example.com', domain: 'example.com', url: 'https://example.com/inbox' },
    data_classes: ['contact_info'], estimated_impact: 'medium', requires_consent: false,
  };
  const policy = {
    dcp_version: '2.0', intent_id: intent.intent_id, session_nonce: NONCE, decision: 'approve', risk_score: 450,
    reasons: ['Known recipient domain'], required_confirmation: { type: 'human_approve', fields: ['to'] },
    applied_policy_hash: hashOf({ policy: 'default' }), timestamp: '2026-10-21T12:00:01Z',
  };
  const trail = AUDIT_IDS.map((id, i) => ({
    dcp_version: '2.0', audit_id: id, session_nonce: NONCE, hash_alg: 'sha256', timestamp: `2026-10-21T12:0${i + 1}:00Z`,
    agent_id: passport.agent_id, human_id: rpr.human_id, intent_id: intent.intent_id, policy_decision: 'approved', outcome: 'email_sent',
    evidence: { tool: 'smtp', result_ref: `msg:schema-validation-${i + 1}`, evidence_hash: hashOf({ message: `schema-validation-${i + 1}` }) },
    pq_checkpoint_ref: null,
  }));
  const manifest = {
    session_issued_at: '2026-10-21T00:00:00Z', session_expires_at: '2099-12-31T23:59:59Z', intended_verifier: 'verifier:schema-validation',
    canonicalization_profile: 'dcp-jcs-v1',
  };
  return { rpr, passport, intent, policy, trail, manifest, checkpoint: {}, eventRange: {} };
}

async function build(p) {
  const intentHash = hashOf(p.intent);
  const trail = [];
  p.trail.forEach((t, i) => trail.push({ ...t, prev_hash: i === 0 ? 'GENESIS' : hashOf(trail[i - 1]), intent_hash: intentHash }));
  const bundle = new BundleBuilderV2(NONCE)
    .responsiblePrincipalRecord(await sign(p.rpr, DCP_CONTEXTS.ResponsiblePrincipal))
    .agentPassport(await sign(p.passport, DCP_CONTEXTS.AgentPassport))
    .intent(await sign(p.intent, DCP_CONTEXTS.Intent))
    .policyDecision(await sign(p.policy, DCP_CONTEXTS.PolicyDecision))
    .addAuditEntries(trail)
    .build();
  const body = {
    checkpoint_id: CHECKPOINT_ID, session_nonce: NONCE,
    event_range: { from_audit_id: AUDIT_IDS[1], to_audit_id: AUDIT_IDS[2], count: 2, ...p.eventRange },
    merkle_root: merkleRoot(trail.slice(1, 3)), ...p.checkpoint,
  };
  const cs = await compositeSign(registry, DCP_CONTEXTS.AuditEvent, new Uint8Array(Buffer.from(canon(body), 'utf8')), KEYS);
  bundle.pq_checkpoints = [{ ...body, composite_sig: cs }];
  Object.assign(bundle.manifest, { pq_checkpoints: [CHECKPOINT_ID] }, p.manifest);
  for (const [key, v] of Object.entries(bundle.manifest)) if (v === undefined) delete bundle.manifest[key];
  const signed = await signBundleV2(bundle, { registry, signerType: 'human', signerId: p.rpr.human_id, keys: KEYS });
  signed.signature.created_at = '2026-10-21T12:03:00Z'; // outside the signed manifest; fixed
  if (p.manifestAfterSigning) {
    // signBundleV2 fills a nullish session_issued_at with the current time (??=): set such a value afterwards and sign
    // the manifest again, so the manifest_hash and the bundle composite signature cover it.
    Object.assign(signed.bundle.manifest, p.manifestAfterSigning);
    const text = canon(signed.bundle.manifest);
    signed.signature.manifest_hash = `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
    signed.signature.composite_sig = await compositeSign(registry, DCP_CONTEXTS.Bundle, new Uint8Array(Buffer.from(text, 'utf8')), KEYS);
  }
  return signed;
}

const set = (doc, path, value) => { if (path.length === 0) return value; path.slice(0, -1).reduce((n, t) => n[t], doc)[path.at(-1)] = value; return doc; };
const del = (doc, path) => { delete path.slice(0, -1).reduce((n, t) => n[t], doc)[path.at(-1)]; return doc; };
const deep = (n) => { let v = { leaf: true }; for (let i = 0; i < n; i++) v = { d: v }; return v; };

// Wiring cases: [name, family, spec_step, construction, pre(parts)?, post(signed)?, raw(text)?, schema target {path, keyword}, why]
const R = 're-signed: changed before signing, every payload hash, chain link, root, manifest commitment and signature redone';
const U = 'unsigned region: changed after signing; no commitment covers it';
const W = [
  // Positive controls: schema-valid, integrity-valid, verified at the corpus time under its policy.
  ['base', 'positive', 'V2-2', 'every optional member the verifiers accept'],
  ['bundle_open_member_deep', 'positive', 'V2-2', U, null, (s) => { s.bundle.x_ext = deep(64); }],
  ['target_open_member', 'positive', 'V2-2', R, (p) => { p.intent.target.x_ext = 'open'; }],
  ['confirmation_open_member', 'positive', 'V2-2', R, (p) => { p.policy.required_confirmation.x_ext = 'open'; }],
  ['evidence_open_member', 'positive', 'V2-2', R, (p) => { p.trail[0].evidence.x_ext = 'open'; }],
  ['date_time_space_separator', 'positive', 'V2-2', R, (p) => { p.trail[0].timestamp = '2026-10-21 12:01:00Z'; }],
  ['date_time_lowercase', 'positive', 'V2-2', R, (p) => { p.intent.timestamp = '2026-10-21t12:00:00z'; }],
  ['date_time_leap_second', 'positive', 'V2-2', R, (p) => { p.policy.timestamp = '2016-12-31T23:59:60Z'; }],
  ['date_time_hour_offset', 'positive', 'V2-2', U, null, (s) => { s.signature.created_at = '2026-10-21T17:03:00+05'; }],
  ['lengths_at_minimum_astral', 'positive', 'V2-2', R, (p) => { p.rpr.legal_name = '\u{1F600}'; p.rpr.jurisdiction = '\u{1F600}\u{1F600}'; }],
  ['intended_verifier_256_astral', 'positive', 'V2-2', R, (p) => { p.manifest.intended_verifier = '\u{1F600}'.repeat(256); }],
  ['nullable_members_null', 'positive', 'V2-2', R, (p) => { p.rpr.contact = null; p.intent.target.url = null; p.trail[0].evidence.tool = null; p.policy.required_confirmation = null; }],
  ['audit_count_written_3_0', 'positive', 'V2-2', 'raw text: the signed base with "audit_count":3 written as 3.0 (same value, same canonical bytes)', null, null, (t) => t.replace('"audit_count":3,', '"audit_count":3.0,')],
  // Negatives: one schema constraint broken, every hash and signature valid.
  ['payload_unknown_member_rpr', 'closed object (payload binding)', 'V2-2', R, (p) => { p.rpr.x_ext = 1; }, null, null, { path: ['bundle', 'responsible_principal_record', 'payload'], keyword: 'additionalProperties' }],
  ['payload_unknown_member_passport', 'closed object (payload binding)', 'V2-2', R, (p) => { p.passport.x_ext = 1; }, null, null, { path: ['bundle', 'agent_passport', 'payload'], keyword: 'additionalProperties' }],
  ['payload_unknown_member_intent', 'closed object (payload binding)', 'V2-2', R, (p) => { p.intent.x_ext = 1; }, null, null, { path: ['bundle', 'intent', 'payload'], keyword: 'additionalProperties' }],
  ['payload_unknown_member_policy', 'closed object (payload binding)', 'V2-2', R, (p) => { p.policy.x_ext = 1; }, null, null, { path: ['bundle', 'policy_decision', 'payload'], keyword: 'additionalProperties' }],
  ['envelope_unknown_member_rpr', 'closed object ($ref signed_payload)', 'V2-2', U, null, (s) => { s.bundle.responsible_principal_record.x_ext = 1; }, null, { path: ['bundle', 'responsible_principal_record'], keyword: 'additionalProperties' }],
  ['envelope_unknown_member_policy', 'closed object ($ref signed_payload)', 'V2-2', U, null, (s) => { s.bundle.policy_decision.x_ext = 1; }, null, { path: ['bundle', 'policy_decision'], keyword: 'additionalProperties' }],
  ['artifact_composite_sig_unknown_member', 'closed object ($ref composite_signature)', 'V2-2', U, null, (s) => { s.bundle.agent_passport.composite_sig.x_ext = 1; }, null, { path: ['bundle', 'agent_passport', 'composite_sig'], keyword: 'additionalProperties' }],
  ['bundle_classical_unknown_member', 'closed object', 'V2-2', U, null, (s) => { s.signature.composite_sig.classical.x_ext = 1; }, null, { path: ['signature', 'composite_sig', 'classical'], keyword: 'additionalProperties' }],
  ['bundle_pq_unknown_member', 'closed object (oneOf branch)', 'V2-2', U, null, (s) => { s.signature.composite_sig.pq.x_ext = 1; }, null, { path: ['signature', 'composite_sig', 'pq'], keyword: 'oneOf' }],
  ['checkpoint_composite_sig_unknown_member', 'closed object ($ref composite_signature)', 'V2-2', U, null, (s) => { s.bundle.pq_checkpoints[0].composite_sig.x_ext = 1; }, null, { path: ['bundle', 'pq_checkpoints', 0, 'composite_sig'], keyword: 'additionalProperties' }],
  ['checkpoint_unknown_member', 'closed object ($ref pq_checkpoint)', 'V2-2', R, (p) => { p.checkpoint.x_ext = 1; }, null, null, { path: ['bundle', 'pq_checkpoints', 0], keyword: 'additionalProperties' }],
  ['event_range_unknown_member', 'closed object', 'V2-2', R, (p) => { p.eventRange.x_ext = 1; }, null, null, { path: ['bundle', 'pq_checkpoints', 0, 'event_range'], keyword: 'additionalProperties' }],
  ['rpr_key_entry_unknown_member', 'closed object ($ref key_entry)', 'V2-2', R, (p) => { p.rpr.binding_keys[0].x_ext = 1; }, null, null, { path: ['bundle', 'responsible_principal_record', 'payload', 'binding_keys', 0], keyword: 'additionalProperties' }],
  ['passport_key_entry_unknown_member', 'closed object ($ref key_entry)', 'V2-2', R, (p) => { p.passport.keys[0].x_ext = 1; }, null, null, { path: ['bundle', 'agent_passport', 'payload', 'keys', 0], keyword: 'additionalProperties' }],
  ['manifest_unknown_member', 'closed object ($ref bundle_manifest)', 'V2-2', R, (p) => { p.manifest.x_ext = 1; }, null, null, { path: ['bundle', 'manifest'], keyword: 'additionalProperties' }],
  ['audit_entry_unknown_member', 'closed object ($ref audit_entry)', 'V2-2', R, (p) => { p.trail[0].x_ext = 1; }, null, null, { path: ['bundle', 'audit_entries', 0], keyword: 'additionalProperties' }],
  ['manifest_member_case_variant', 'closed object (exact names)', 'V2-2', R, (p) => { p.manifest.Audit_Count = 3; }, null, null, { path: ['bundle', 'manifest'], keyword: 'additionalProperties' }],
  ['pii_salt_trailing_newline', 'pattern (anchors)', 'V2-2', R, (p) => { p.rpr.pii_salt += '\n'; }, null, null, { path: ['bundle', 'responsible_principal_record', 'payload', 'pii_salt'], keyword: 'pattern' }],
  ['applied_policy_hash_uppercase', 'pattern', 'V2-2', R, (p) => { p.policy.applied_policy_hash = p.policy.applied_policy_hash.toUpperCase().replace('SHA256', 'sha256'); }, null, null, { path: ['bundle', 'policy_decision', 'payload', 'applied_policy_hash'], keyword: 'pattern' }],
  ['emergency_token_not_a_hash', 'pattern', 'V2-2', R, (p) => { p.passport.emergency_revocation_token = 'sha256:abc'; }, null, null, { path: ['bundle', 'agent_passport', 'payload', 'emergency_revocation_token'], keyword: 'pattern' }],
  ['capability_outside_enum', 'enum', 'V2-2', R, (p) => { p.passport.capabilities = ['browse', 'teleport']; }, null, null, { path: ['bundle', 'agent_passport', 'payload', 'capabilities', 1], keyword: 'enum' }],
  ['capabilities_duplicated', 'uniqueItems', 'V2-2', R, (p) => { p.passport.capabilities = ['browse', 'browse']; }, null, null, { path: ['bundle', 'agent_passport', 'payload', 'capabilities'], keyword: 'uniqueItems' }],
  ['data_class_outside_enum', 'enum', 'V2-2', R, (p) => { p.intent.data_classes = ['dna']; }, null, null, { path: ['bundle', 'intent', 'payload', 'data_classes', 0], keyword: 'enum' }],
  ['target_channel_outside_enum', 'enum (declared member of an open object)', 'V2-2', R, (p) => { p.intent.target.channel = 'pigeon'; }, null, null, { path: ['bundle', 'intent', 'payload', 'target', 'channel'], keyword: 'enum' }],
  ['entity_type_outside_enum', 'enum', 'V2-2', R, (p) => { p.rpr.entity_type = 'robot'; }, null, null, { path: ['bundle', 'responsible_principal_record', 'payload', 'entity_type'], keyword: 'enum' }],
  ['confirmation_type_not_const', 'const (oneOf branch)', 'V2-2', R, (p) => { p.policy.required_confirmation.type = 'auto'; }, null, null, { path: ['bundle', 'policy_decision', 'payload', 'required_confirmation'], keyword: 'oneOf' }],
  ['confirmation_not_null_or_object', 'oneOf', 'V2-2', R, (p) => { p.policy.required_confirmation = 'yes'; }, null, null, { path: ['bundle', 'policy_decision', 'payload', 'required_confirmation'], keyword: 'oneOf' }],
  ['signature_created_at_impossible_date', 'format', 'V2-2', U, null, (s) => { s.signature.created_at = '2000-02-30T00:00:00Z'; }, null, { path: ['signature', 'created_at'], keyword: 'format' }],
  ['audit_timestamp_not_a_date', 'format', 'V2-2', R, (p) => { p.trail[0].timestamp = 'n/a'; }, null, null, { path: ['bundle', 'audit_entries', 0, 'timestamp'], keyword: 'format' }],
  ['rpr_issued_at_offset_24', 'format', 'V2-2', R, (p) => { p.rpr.issued_at = '2026-10-21T00:00:00+24:00'; }, null, null, { path: ['bundle', 'responsible_principal_record', 'payload', 'issued_at'], keyword: 'format' }],
  ['legal_name_empty', 'minLength', 'V2-2', R, (p) => { p.rpr.legal_name = ''; }, null, null, { path: ['bundle', 'responsible_principal_record', 'payload', 'legal_name'], keyword: 'minLength' }],
  ['jurisdiction_one_code_point_two_units', 'minLength (code points)', 'V2-2', R, (p) => { p.rpr.jurisdiction = '\u{1F600}'; }, null, null, { path: ['bundle', 'responsible_principal_record', 'payload', 'jurisdiction'], keyword: 'minLength' }],
  ['intended_verifier_257', 'maxLength', 'V2-2', R, (p) => { p.manifest.intended_verifier = 'v'.repeat(257); }, null, null, { path: ['bundle', 'manifest', 'intended_verifier'], keyword: 'maxLength' }],
  ['contact_number', 'type', 'V2-2', R, (p) => { p.rpr.contact = 42; }, null, null, { path: ['bundle', 'responsible_principal_record', 'payload', 'contact'], keyword: 'type' }],
  ['override_rights_string', 'type', 'V2-2', R, (p) => { p.rpr.override_rights = 'yes'; }, null, null, { path: ['bundle', 'responsible_principal_record', 'payload', 'override_rights'], keyword: 'type' }],
  ['evidence_tool_number', 'type (declared member of an open object)', 'V2-2', R, (p) => { p.trail[0].evidence.tool = 7; }, null, null, { path: ['bundle', 'audit_entries', 0, 'evidence', 'tool'], keyword: 'type' }],
  ['audit_pq_checkpoint_ref_absent', 'required (nullable, absent)', 'V2-2', R, (p) => { delete p.trail[0].pq_checkpoint_ref; }, null, null, { path: ['bundle', 'audit_entries', 0], keyword: 'required' }],
  ['rpr_expires_at_absent', 'required (nullable, absent)', 'V2-2', R, (p) => { delete p.rpr.expires_at; }, null, null, { path: ['bundle', 'responsible_principal_record', 'payload'], keyword: 'required' }],
  ['risk_score_1001', 'maximum', 'V2-2', R, (p) => { p.policy.risk_score = 1001; }, null, null, { path: ['bundle', 'policy_decision', 'payload', 'risk_score'], keyword: 'maximum' }],
  ['passport_dcp_version_not_const', 'const', 'V2-2', R, (p) => { p.passport.dcp_version = '2.1'; }, null, null, { path: ['bundle', 'agent_passport', 'payload', 'dcp_version'], keyword: 'const' }],
  ['signer_kids_empty', 'minItems', 'V2-2', U, null, (s) => { s.signature.signer.kids = []; }, null, { path: ['signature', 'signer', 'kids'], keyword: 'minItems' }],
  ['many_unknown_members', 'error bound (20 violations, at most 16 listed)', 'V2-2', U, null, (s) => { for (let i = 0; i < 20; i++) s[`x_ext_${String(i).padStart(2, '0')}`] = i; }, null, { path: [], keyword: 'additionalProperties' }],
  // C4: the manifest schema admits string session times only; V2-4 prose says absent or null means no expiry.
  ['c4_session_expires_at_null', 'C4 (type)', 'V2-2', R, (p) => { p.manifest.session_expires_at = null; }, null, null, { path: ['bundle', 'manifest', 'session_expires_at'], keyword: 'type' }],
  ['c4_session_issued_at_null', 'C4 (type)', 'V2-2', `${R}; set after signBundleV2, which replaces a null session_issued_at, and the manifest signed again`, (p) => { p.manifestAfterSigning = { session_issued_at: null }; }, null, null, { path: ['bundle', 'manifest', 'session_issued_at'], keyword: 'type' }],
];

// ── Schema cases from the IR ──
const { ir } = buildIR({ files: readSchemaDir() });
const nodeSite = (id, kw, extra) => `${ir.nodes[id].site}/${kw}${extra !== undefined ? `/${escapeToken(extra)}` : ''}`;

/** Where each node applies in `doc`: id -> [{path, oneOf}] (oneOf: the path of the nearest enclosing oneOf, or null). */
function applications(doc) {
  const out = new Map();
  const add = (id, path, oneOf) => { if (!out.has(id)) out.set(id, []); out.get(id).push({ path, oneOf }); };
  const walk = (id, v, path, oneOf) => {
    const n = ir.nodes[id];
    add(id, path, oneOf);
    if (n.ref !== undefined) walk(n.ref, v, path, oneOf);
    if (isObject(v) && n.properties) for (const [name, child] of n.properties) if (Object.hasOwn(v, name)) walk(child, v[name], [...path, name], oneOf);
    if (Array.isArray(v) && n.items !== undefined) v.forEach((x, i) => walk(n.items, x, [...path, i], oneOf));
    if (n.oneOf) for (const b of n.oneOf) walk(b, v, path, path);
  };
  walk(ir.roots.signed_bundle, doc, [], null);
  for (const [member, root] of ir.roots.payloads) walk(root, doc.bundle[member].payload, ['bundle', member, 'payload'], null);
  return out;
}
const get = (doc, path) => path.reduce((n, t) => n[t], doc);
const TYPE_CANDIDATES = [['string', 'zz'], ['integer', 7], ['boolean', true], ['null', null], ['array', []], ['object', {}]];

function schemaCases(M) {
  const apps = applications(M);
  const cases = [];
  const seen = new Set();
  const push = (c) => {
    const key = JSON.stringify(c.mutation);
    if (seen.has(key)) { cases.find((x) => JSON.stringify(x.mutation) === key).sites.push(...c.sites); return; }
    seen.add(key);
    cases.push(c);
  };
  const neg = (id, kw, path, at, mutation, extra) => {
    const a = apps.get(id).find((x) => JSON.stringify(x.path) === JSON.stringify(at));
    const attribution = a?.oneOf ? { instance: pointer(a.oneOf), keyword: 'oneOf' } : { instance: pointer(path), keyword: kw };
    push({ id: `${kw}@${pointer(at) || '/'}${extra !== undefined ? `#${extra}` : ''}`, kind: 'negative', sites: [nodeSite(id, kw, kw === 'required' ? extra : undefined)], attribution, mutation });
  };
  for (let id = 0; id < ir.nodes.length; id++) {
    const n = ir.nodes[id];
    const list = apps.get(id);
    if (!list) fail(`node ${n.site} applies nowhere in the maximal instance`);
    const { path } = list[0];
    const v = get(M, path);
    if (n.types) {
      const [, bad] = TYPE_CANDIDATES.find(([t]) => !n.types.includes(t));
      neg(id, 'type', path, path, { op: 'set', path, value: bad });
      if (n.types.includes('integer')) neg(id, 'type', path, path, { op: 'set', path, value: 0.5 }, 'fraction');
    }
    if (n.required) for (const r of n.required) neg(id, 'required', path, path, { op: 'delete', path: [...path, r] }, r);
    if (n.closed) for (const a of list) neg(id, 'additionalProperties', a.path, a.path, { op: 'set', path: [...a.path, 'x_unknown_member'], value: true });
    if (n.enum) neg(id, 'enum', path, path, { op: 'set', path, value: 'zz-outside-enum' });
    if (n.const !== undefined) neg(id, 'const', path, path, { op: 'set', path, value: 'zz-const-mismatch' });
    if (n.pattern !== undefined) neg(id, 'pattern', path, path, { op: 'set', path, value: `${v}\n` });
    if (n.format) neg(id, 'format', path, path, { op: 'set', path, value: '2000-02-30T00:00:00Z' });
    if (n.minLength) neg(id, 'minLength', path, path, { op: 'set', path, value: 'A'.repeat(n.minLength - 1) });
    if (n.maxLength !== undefined) neg(id, 'maxLength', path, path, { op: 'set', path, value: 'A'.repeat(n.maxLength + 1) });
    if (n.minItems) neg(id, 'minItems', path, path, { op: 'set', path, value: v.slice(0, n.minItems - 1) });
    if (n.uniqueItems) neg(id, 'uniqueItems', path, path, { op: 'set', path, value: [v[0], v[0]] });
    if (n.minimum !== undefined) neg(id, 'minimum', path, path, { op: 'set', path, value: n.minimum - 1 });
    if (n.maximum !== undefined) neg(id, 'maximum', path, path, { op: 'set', path, value: n.maximum + 1 });
    if (n.oneOf) neg(id, 'oneOf', path, path, { op: 'set', path, value: 7 });
    // Positive boundaries: exactly at each bound, lengths in code points (astral where no pattern applies).
    const pos = (name, mutation) => push({ id: `positive:${name}@${pointer(path) || '/'}`, kind: 'positive', sites: [], mutation });
    const unit = n.pattern !== undefined ? 'A' : '\u{1F600}';
    if (n.minLength) pos('minLength', { op: 'set', path, value: unit.repeat(n.minLength) });
    if (n.maxLength !== undefined) pos('maxLength', { op: 'set', path, value: unit.repeat(n.maxLength) });
    if (n.minimum !== undefined) pos('minimum', { op: 'set', path, value: n.minimum });
    if (n.maximum !== undefined) pos('maximum', { op: 'set', path, value: n.maximum });
    if (n.minItems) pos('minItems', { op: 'set', path, value: v.slice(0, n.minItems) });
    if (n.types && n.types.length > 1 && n.types.includes('null')) pos(v === null ? 'non-null' : 'null', { op: 'set', path, value: v === null ? '2099-12-31T23:59:59Z' : null });
    if (n.types?.includes('object') && !n.closed && n.properties) for (const a of list) pos(`open-member@${pointer(a.path)}`, { op: 'set', path: [...a.path, 'x_open_member'], value: deep(8) });
  }
  return cases;
}

const extraSchemaCases = (M) => {
  const sig = ['signature', 'created_at'];
  const at = (value, kind, note) => ({ id: `date-time:${note}`, kind, sites: kind === 'negative' ? [`${ir.nodes.find((x) => x.site.endsWith('signed_bundle.schema.json#/properties/signature/properties/created_at')).site}/format`] : [], attribution: kind === 'negative' ? { instance: '/signature/created_at', keyword: 'format' } : undefined, mutation: { op: 'set', path: sig, value } });
  const out = [
    at('2026-10-21\t12:03:00Z', 'positive', 'tab separator'), at('2026-10-21 12:03:00Z', 'positive', 'space separator'),
    at('2026-10-21　12:03:00Z', 'positive', 'ideographic space separator'), at('2026-10-21t12:03:00z', 'positive', 'lowercase'),
    at('2026-10-21T17:03:00+05', 'positive', 'hours-only offset'), at('2026-10-21T17:33:00+0530', 'positive', 'offset without colon'),
    at('2016-12-31T23:59:60Z', 'positive', 'leap second'), at('2017-01-01T00:59:60+01:00', 'positive', 'leap second with offset'),
    at('0000-01-01T00:00:00Z', 'positive', 'year 0000'), at('2026-10-21T12:03:00-00:00', 'positive', 'offset -00:00'),
    at('2026-10-21T23:59:59.99999999999999999Z', 'positive', 'long fraction at 23:59'),
    at('2026-10-21T12:00:59.99999999999999999Z', 'negative', 'long fraction rounding to 60'),
    at('2026-10-21T12:03:00+24:00', 'negative', 'offset hour 24'), at('2026-10-21T12:03:00+05:', 'negative', 'dangling colon'),
    at('2026-10-21T12:03:00,5Z', 'negative', 'comma fraction'), at('2026-10-21T12:03:00', 'negative', 'no zone'),
    at('2026-10-21T22:59:60Z', 'negative', 'leap second at 22:59'), at('2026-10-21TT12:03:00Z', 'negative', 'two separators'),
    at('2026-10-21​12:03:00Z', 'negative', 'zero-width space is not a separator'), at('٢026-10-21T12:03:00Z', 'negative', 'non-ASCII digit'),
    at('2026-10-21T12:03:00Z\n', 'negative', 'trailing newline'),
  ];
  const kid = ['signature', 'composite_sig', 'classical', 'kid'];
  const pat = (value, note, kind = 'negative', path = kid) => ({ id: `pattern:${note}@${pointer(path)}`, kind, sites: kind === 'negative' ? [`${ir.nodes.find((x) => x.site.endsWith('composite_signature.schema.json#/properties/classical/properties/' + path.at(-1))).site}/pattern`] : [], attribution: kind === 'negative' ? { instance: pointer(path), keyword: 'pattern' } : undefined, mutation: { op: 'set', path, value } });
  const k = get(M, kid);
  const sigB64 = ['signature', 'composite_sig', 'classical', 'sig_b64'];
  out.push(
    pat(k.toUpperCase(), 'uppercase hex'), pat(k.slice(1), 'one short'), pat(`${k}0`, 'one long'), pat(` ${k}`, 'leading space'),
    pat(`${k.slice(1)}١`, 'non-ASCII digit'), pat(`${k.slice(0, -1)}\r`, 'carriage return'),
    pat('AAAA=AAA', 'padding inside', 'negative', sigB64), pat('AAAAA===', 'three pads', 'negative', sigB64), pat('AAAAAAAé', 'non-ASCII letter', 'negative', sigB64),
    pat('AAAAAA==', 'two pads', 'positive', sigB64),
  );
  // Layering: a payload member unknown to its artifact schema passes the envelope (payload: type object) and fails V2-2.
  out.push({ id: 'layering:intent payload unknown member', kind: 'negative', sites: [`${ir.nodes[ir.roots.payloads.find(([m]) => m === 'intent')[1]].site}/additionalProperties`], attribution: { instance: '/bundle/intent/payload', keyword: 'additionalProperties' }, mutation: { op: 'set', path: ['bundle', 'intent', 'payload', 'x_unknown_member'], value: true }, layers: { envelope_only: 'valid', combined: 'invalid' } });
  // Raw JSON texts: number spellings, a lone surrogate, the error bound, and the one declared oracle difference.
  out.push(
    { id: 'raw:audit_count 3.0', kind: 'positive', sites: [], raw: ['"audit_count":3,', '"audit_count":3.0,'] },
    { id: 'raw:audit_count 3e0', kind: 'positive', sites: [], raw: ['"audit_count":3,', '"audit_count":3e0,'] },
    { id: 'raw:risk_score 450.5', kind: 'negative', sites: [nodeSite(ir.nodes.findIndex((x) => x.site.endsWith('policy_decision.schema.json#/properties/risk_score')), 'type')], attribution: { instance: '/bundle/policy_decision/payload/risk_score', keyword: 'type' }, raw: ['"risk_score":450,', '"risk_score":450.5,'] },
    { id: 'raw:legal_name lone surrogate', kind: 'positive', sites: [], raw: ['"legal_name":"Schema Validation Principal"', '"legal_name":"\\ud800"'] },
    { id: 'raw:jurisdiction lone surrogate', kind: 'negative', sites: [nodeSite(ir.nodes.findIndex((x) => x.site.endsWith('responsible_principal_record.schema.json#/properties/jurisdiction')), 'minLength')], attribution: { instance: '/bundle/responsible_principal_record/payload/jurisdiction', keyword: 'minLength' }, raw: ['"jurisdiction":"US-CA"', '"jurisdiction":"\\ud800"'] },
    { id: 'raw:audit_count 1e400 (non-finite after parsing)', kind: 'negative', sites: [], attribution: { instance: '/bundle/manifest/audit_count', keyword: 'type' }, raw: ['"audit_count":3,', '"audit_count":1e400,'], known_oracle_difference: 'Ajv (oracle 1) takes the non-finite number JSON.parse gives for an integer; the schema domain is finite JSON numbers (decision D2), as oracle 2 and the IR read it' },
    { id: 'bound:40 unknown members at the root', kind: 'negative', sites: [], attribution: { instance: '', keyword: 'additionalProperties' }, mutation: { op: 'many', path: [], count: 40 } },
  );
  return out;
};

function materialize(M, c) {
  if (c.raw) {
    const text = JSON.stringify(M);
    if (text.split(c.raw[0]).length !== 2) fail(`${c.id}: raw anchor ${c.raw[0]} is not unique`);
    return text.replace(c.raw[0], c.raw[1]);
  }
  const d = clone(M);
  const m = c.mutation;
  if (m.op === 'set') return JSON.stringify(set(d, m.path, m.value));
  if (m.op === 'delete') return JSON.stringify(del(d, m.path));
  if (m.op === 'many') { for (let i = 0; i < m.count; i++) d[`x_unknown_${String(i).padStart(2, '0')}`] = i; return JSON.stringify(d); }
  return fail(`${c.id}: unknown mutation`);
}

// ── Oracles ──
function oracles(items) {
  const py = pythonValidate(items.map(({ id, text }) => ({ id, text })));
  return { about: py.about, check: (id, text) => ({ ajv: ajvValidate(JSON.parse(text)), py: py.results.get(id) }) };
}
const attributed = (errors, a) => errors.some((e) => e.instance === a.instance && e.keyword === a.keyword);

// ── Main ──
const wiring = [];
for (const [name, family, spec_step, construction, pre, post, raw, target] of W) {
  const p = parts();
  pre?.(p);
  const s = await build(p);
  post?.(s);
  let text = JSON.stringify(s);
  if (raw) { const t = raw(text); if (t === text) fail(`${name}: raw edit did not apply`); text = t; }
  wiring.push({ name, family, spec_step, construction, target, text });
}
const M = (() => {
  const d = JSON.parse(wiring[0].text);
  // Schema-only additions: optional members the wiring base leaves out, with schema-valid values.
  d.bundle.intent.payload.security_tier = 'standard';
  d.bundle.policy_decision.payload.resolved_tier = 'standard';
  d.bundle.manifest.audit_merkle_root_secondary = `sha3-256:${'0'.repeat(64)}`;
  d.bundle.audit_entries.forEach((e, i) => { e.prev_hash_secondary = i === 0 ? 'GENESIS' : `sha3-256:${'1'.repeat(64)}`; e.intent_hash_secondary = `sha3-256:${'2'.repeat(64)}`; e.pq_checkpoint_ref = i === 2 ? CHECKPOINT_ID : null; });
  d.signature.composite_sig.pq = { ...d.signature.composite_sig.pq }; // the object branch; the null branch is a positive case
  return d;
})();
const sCases = [...schemaCases(M), ...extraSchemaCases(M)];
const sTexts = [{ id: 'positive:maximal instance', text: JSON.stringify(M) }, ...sCases.map((c) => ({ id: c.id, text: materialize(M, c) }))];
const wTexts = wiring.map((w) => ({ id: `wiring:${w.name}`, text: w.text }));
const O = oracles([...sTexts, ...wTexts]);
const problems = [];

const schemaOut = [];
for (const { id, text } of sTexts) {
  const c = sCases.find((x) => x.id === id) ?? { id, kind: 'positive', sites: [] };
  const { ajv, py } = O.check(id, text);
  const want = c.kind === 'positive';
  if (py.valid !== want) problems.push(`${id}: python oracle valid=${py.valid}, expected ${want} ${JSON.stringify(py.errors.slice(0, 3))}`);
  if (ajv.valid !== want && !c.known_oracle_difference) problems.push(`${id}: ajv oracle valid=${ajv.valid}, expected ${want} ${JSON.stringify(ajv.errors.slice(0, 3))}`);
  if (!want && c.attribution) {
    if (!attributed(py.errors, c.attribution)) problems.push(`${id}: python oracle does not attribute ${JSON.stringify(c.attribution)}: ${JSON.stringify(py.errors.slice(0, 4))}`);
    if (!c.known_oracle_difference && !attributed(ajv.errors, c.attribution)) problems.push(`${id}: ajv oracle does not attribute ${JSON.stringify(c.attribution)}: ${JSON.stringify(ajv.errors.slice(0, 4))}`);
  }
  if (c.layers && ajvValidate(JSON.parse(text), { envelopeOnly: true }).valid !== (c.layers.envelope_only === 'valid')) problems.push(`${id}: the envelope layer alone does not give ${c.layers.envelope_only}`);
  const { mutation, raw, ...rest } = c;
  schemaOut.push({ ...rest, ...(mutation ? { mutation } : {}), ...(raw ? { raw_replace: raw } : {}), expect: { schema: { valid: want, ...(c.attribution ? { attribution: c.attribution } : {}) } }, oracles: { ajv: { valid: ajv.valid, errors: ajv.errors.length }, python: { valid: py.valid, errors: py.errors.length } } });
}

const wiringOut = [];
let baseCheck = null;
for (const w of wiring) {
  const id = `wiring:${w.name}`;
  const doc = JSON.parse(w.text);
  const { ajv, py } = O.check(id, w.text);
  const positive = w.family === 'positive';
  if (py.valid !== positive || ajv.valid !== positive) problems.push(`${id}: oracles ajv=${ajv.valid} python=${py.valid}, expected ${positive}: ${JSON.stringify([...ajv.errors, ...py.errors].slice(0, 4))}`);
  if (!positive) {
    const a = { instance: pointer(w.target.path), keyword: w.target.keyword };
    if (!attributed(py.errors, a) || !attributed(ajv.errors, a)) problems.push(`${id}: target ${JSON.stringify(a)} not attributed by both oracles: ajv ${JSON.stringify(ajv.errors.slice(0, 3))} python ${JSON.stringify(py.errors.slice(0, 3))}`);
  }
  const st = structure(doc, VERIFICATION_TIME);
  if (st.length) problems.push(`${id}: the SDK-free structural check fails: ${st.join('; ')}`);
  if (positive) {
    const r = await verifySignedBundleV2(doc, registry, POLICY, { now: Date.parse(VERIFICATION_TIME) });
    if (!r.verified) problems.push(`${id}: the TypeScript SDK does not verify this positive: ${JSON.stringify(r.errors)}`);
    if (w.name === 'base') baseCheck = r.verified;
  }
  const why = positive
    ? 'schema-valid for both oracles, structurally valid (SDK-free check, checkpoints included), and verified by the TypeScript SDK at the corpus time under its policy when generated'
    : w.family.startsWith('C4')
      ? 'V2-2 as the schema stands: the manifest schema admits a string only, while V2-4 prose reads absent or null as no expiry (C4, disposition pending); structurally valid'
      : 'V2-2: the schema constraint named by target fails for both oracles while every hash and signature, checkpoints included, is valid (SDK-free check)';
  wiringOut.push({
    name: w.name, family: w.family, spec_step: w.spec_step, construction: w.construction,
    ...(w.target ? { target: { instance: pointer(w.target.path), keyword: w.target.keyword } } : {}),
    expect: { schema: { valid: positive }, verified: positive, why },
    ...(w.construction.startsWith('raw text') ? { signed_bundle_text: w.text } : { signed_bundle: doc }),
  });
}
if (baseCheck !== true) problems.push('the wiring base does not verify');

// Coverage: every assertion site of the IR -> the schema cases that cover it (the generation fails on a gap).
const sites = {};
const STRUCTURAL = { properties: 'covered through the sites of each named member', items: 'covered through the sites of the item schema', ref: 'covered through the referenced schema at this location (see ref_sites)' };
for (const [id, n] of ir.nodes.entries()) {
  const keys = [];
  for (const kw of ['types', 'enum', 'const', 'pattern', 'format', 'minLength', 'maxLength', 'minItems', 'uniqueItems', 'minimum', 'maximum', 'oneOf']) if (n[kw] !== undefined) keys.push(nodeSite(id, kw === 'types' ? 'type' : kw));
  if (n.closed) keys.push(nodeSite(id, 'additionalProperties'));
  for (const r of n.required ?? []) keys.push(nodeSite(id, 'required', r));
  for (const key of keys) sites[key] = schemaOut.filter((c) => c.sites.includes(key)).map((c) => c.id);
  if (n.properties) sites[nodeSite(id, 'properties')] = STRUCTURAL.properties;
  if (n.items !== undefined) sites[nodeSite(id, 'items')] = STRUCTURAL.items;
  if (n.ref !== undefined) sites[nodeSite(id, '$ref')] = STRUCTURAL.ref;
}
const gaps = Object.entries(sites).filter(([, v]) => Array.isArray(v) && v.length === 0).map(([kk]) => kk);
if (gaps.length) problems.push(`uncovered assertion sites: ${gaps.join(', ')}`);
// The same obligation read from the normative files by a walk that shares no code with the compiler.
const source = sourceSites(resolve(REPO, 'schemas', 'v2'));
problems.push(...checkIR(ir, source, { compile: compilePattern }).map((x) => `IR vs normative source: ${x}`));
problems.push(...checkCoverage({ sites }, source, schemaOut).map((x) => `coverage vs normative source: ${x}`));
const apps = applications(M);
const refSites = ir.nodes.flatMap((n, id) => (n.ref === undefined ? [] : apps.get(id).map((a) => ({ site: nodeSite(id, '$ref'), instance: pointer(a.path), cases: schemaOut.filter((c) => c.attribution?.instance === pointer(a.path) || c.attribution?.instance?.startsWith(`${pointer(a.path)}/`)).map((c) => c.id) }))));
const refGaps = refSites.filter((r) => r.cases.length === 0);
if (refGaps.length) problems.push(`reference locations without a case: ${refGaps.map((r) => r.instance).join(', ')}`);
const closedApps = ir.nodes.flatMap((n, id) => (n.closed ? apps.get(id).map((a) => pointer(a.path)) : []));
const closedGaps = closedApps.filter((p) => !schemaOut.some((c) => c.attribution?.keyword === 'additionalProperties' && c.attribution.instance === p) && !schemaOut.some((c) => c.mutation?.path && pointer(c.mutation.path) === `${p}/x_unknown_member`));
if (closedGaps.length) problems.push(`closed-object locations without an unknown-member case: ${closedGaps.join(', ')}`);

// The date-time boundary: a deterministic grid defined here, each value with the upstream function's answer.
const grid = new Map();
const addDT = (value, source) => { if (!grid.has(value)) grid.set(value, { value, accepted: upstreamDateTime(value), source }); };
for (const v of ['', ' ', 'n/a', '2000-01-01T00:00:00Z', '2000-01-01T00:00:00z', '2000-01-01t00:00:00Z', ' 2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z ',
  '\t2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z\n', '﻿2000-01-01T00:00:00Z', '2000-01-01T00:00:00', '2000-01-01', '00:00:00Z', '2000-01-01TT00:00:00Z',
  '2000-01-01T 00:00:00Z', '2000-01-01 00:00:00 Z', '2000-01-01T00:00:00UTC', '2000-01-01T00:00:00GMT', '2000-01-01T00:00Z', '2000-01-01T00:00:00.Z']) addDT(v, 'grid: whole value');
for (const t of ['00:00:00', '23:59:59', '24:00:00', '23:60:00', '1:00:00', '00:0:00', '00:00:0', '00:00:00.0', '00:00:00.123456789012', '00:00:00,5', '٠٠:00:00', '０0:00:00']) addDT(`2000-01-01T${t}Z`, 'grid: times');
// Every BMP scalar as the separator is checked against upstream here; the file keeps the accepted ones as a list and a
// few rejected neighbours as cases, so a port can iterate the BMP itself.
const separatorScalars = [];
for (let c = 0; c <= 0xffff; c++) if ((c < 0xd800 || c > 0xdfff) && upstreamDateTime(`2000-01-01${String.fromCharCode(c)}00:00:00Z`)) separatorScalars.push(c);
for (const c of [...separatorScalars, 0x00, 0x1c, 0x1d, 0x1e, 0x1f, 0x7f, 0x85, 0x180e, 0x200b, 0x2060, 0x78, 0xff34, 0xff54, 0x3c4]) addDT(`2000-01-01${String.fromCharCode(c)}00:00:00Z`, 'grid: separators');
for (const off of ['Z', 'z', '+00', '+0000', '+00:00', '-00:00', '+05', '+0530', '+05:30', '+05:', '+5', '+055', '+23:59', '+24:00', '+23:60', '-12:00', '+00:0', '+00:000', 'ZZ', '+05:30Z']) addDT(`2026-10-21T12:03:00${off}`, 'grid: offsets');
for (const [t, off] of [['23:59:60', 'Z'], ['23:59:60.5', 'Z'], ['23:59:60.999999', 'Z'], ['23:59:61', 'Z'], ['22:59:60', 'Z'], ['00:59:60', '+01:00'], ['00:59:60', '+0100'], ['00:00:60', '+00:01'], ['23:60:00', '+00:01'], ['23:60:60', '+00:01'], ['24:59:60', '+01:00'], ['15:59:60', '-08:00'], ['23:59:60', '-00:00'], ['00:00:60', 'Z'], ['99:99:60', 'Z']]) addDT(`2016-12-31T${t}${off}`, 'grid: leap-second rule');
for (const f of ['.0', '.5', '.123456789', '.99999999999999999', '.', '.5.5', '.0000000000000000000000001']) { addDT(`2026-10-21T12:00:59${f}Z`, 'grid: fractions'); addDT(`2026-10-21T23:59:59${f}Z`, 'grid: fractions'); }
for (const d of ['1900-02-29', '2000-02-29', '2024-02-29', '2023-02-29', '0000-02-29', '2026-04-31', '2026-00-10', '2026-13-01', '2026-12-00', '2026-12-32', '9999-12-31', '+2026-10-21', '2026-1-21', '20261021', '٢026-10-21', '２026-10-21', '2026/10/21']) addDT(`${d}T00:00:00Z`, 'grid: calendar');
const dateTimeCases = [...grid.values()];

if (problems.length) { console.error(problems.join('\n')); process.exit(1); }

const MAX_FIXTURE_BYTES = 4 * 1024 * 1024;
const outputs = new Map();
const write = (file, doc) => outputs.set(resolve(OUT, file), `${JSON.stringify(doc, null, 2)}\n`);
const sources = { ir_sha256: createHash('sha256').update(buildIR({ files: readSchemaDir() }).text, 'utf8').digest('hex'), generator: 'tests/interop/v2/generate-schema-validation-vectors.mjs' };
write('schema_cases.json', {
  _description: 'spec/VERIFICATION.md V2-2, site by site: a maximal schema-valid instance (the signed wiring base plus schema-only members) and single changes to it, each naming the IR assertion site(s) it breaks and the error both oracles must report (attribution: the instance pointer and keyword, or the enclosing oneOf). '
    + 'A case applies mutation (set the value at path, delete the member at path, or add count members x_unknown_NN at the root) to the instance, or raw_replace ([from, to], one occurrence) to JSON.stringify(instance) and parses the result. '
    + 'These are SCHEMA expectations only: the changes touch committed content without signing it again, so no case here is a full-verification case (see wiring_cases.json). '
    + 'Expectations come from oracle 1 (Ajv + upstream ajv-formats) and oracle 2 (python-jsonschema with two disclosed test adapters), never from the IR evaluator under test.',
  _sources: { ...sources, oracle_python: O.about },
  instance: M,
  cases: schemaOut,
});
write('wiring_cases.json', {
  _description: 'Signed V2 bundles for the real verifier entry points: positive controls and single-constraint negatives whose hashes and signatures are all valid (SDK-free check), plus the C4 pair. expect.schema is the two oracles; expect.verified is the normative verdict and why says on what it rests. A verifier that accepts a negative shows a V2-2 gap.',
  _sources: sources,
  _keys: `tests/interop/v2/interop_vectors.json#test_keys (TEST-ONLY, publicly known): ed25519 kid ${KEYS.classical.kid}, ml-dsa-65 kid ${KEYS.pq.kid}`,
  _randomness: 'Construction is deterministic; ML-DSA-65 signatures are hedged, so regeneration rewrites those bytes only.',
  verification_time: VERIFICATION_TIME,
  verifier_policy: POLICY,
  cases: wiringOut,
});
write('coverage.json', {
  _description: 'Every assertion site of the IR (type, enum, const, pattern, format, minLength, maxLength, minItems, uniqueItems, minimum, maximum, oneOf, additionalProperties, and each required name) with the schema cases that break it; structural keywords (properties, items, $ref) with how they are covered; every location a $ref reaches and every closed-object location, with their cases.',
  _sources: sources,
  totals: { assertion_sites: Object.values(sites).filter(Array.isArray).length, schema_cases: schemaOut.length, wiring_cases: wiringOut.length },
  sites,
  ref_sites: refSites,
  closed_object_locations: closedApps,
});
write('date_time_cases.json', {
  _description: 'The date-time boundary of decision D2: each value with the answer of the upstream function itself (ajv-formats 3.0.1, fullFormats["date-time"].validate), for the four SDK ports. Not RFC 3339 and not the V2-4 temporal parsers.',
  upstream: 'ajv-formats 3.0.1 dist/formats.js fullFormats["date-time"] (getDateTime(true))',
  totals: { cases: dateTimeCases.length, accepted: dateTimeCases.filter((c) => c.accepted).length },
  separator_scalars: separatorScalars.map((c) => `U+${c.toString(16).toUpperCase().padStart(4, '0')}`),
  separator_note: 'With "2000-01-01" before and "00:00:00Z" after it, upstream accepts exactly these BMP scalars as the separator (checked over every BMP scalar at generation): "t", "T" and ECMAScript white space.',
  cases: dateTimeCases,
});
const catalog = {
  contract: 'dcp-ai-conformance-external/2',
  catalog_version: '2026-11-02.schema-validation-1 (opt-in, phase 1)',
  suites: [{
    id: 'external.v2.schema_validation',
    title: 'V2-2 schema validation through the verifier entry point (wiring_cases.json)',
    claim: 'At the corpus verification_time under its verifier_policy, the positive controls verify and every single-constraint negative is rejected (verified false) although each of its hashes and signatures is valid; the two C4 cases are rejected as the manifest schema stands. A verifier that accepts a negative fails it: a V2-2 gap, never conformance.',
    limits: [
      'Opt-in: node tools/conformance-external.js --catalog tools/conformance/external-schema-validation-catalog.json runs it through the kit (tools/conformance/external-evidence.js), and CI runs it through the five SDK wrappers. tools/schema-ir/before.mjs, which recorded the phase-1 BEFORE sample, builds the same plan.',
      'Representative: site-by-site coverage of every assertion is in schema_cases.json and coverage.json (schema layer); these cases show the gate through the actual verifier API, not every site.',
      'Only the verdict is judged; diagnostics, signer_keys and the order of errors are not.',
    ],
    expected_cases: wiringOut.map((c) => `external.v2.schema_validation.${c.name}`),
  }],
  limits: ['Phase 1 of the SDK schema-validation work: expectations from two schema oracles and an SDK-free structural check of hashes and signatures (checkpoints included).'],
};
outputs.set(CATALOG, `${JSON.stringify(catalog, null, 2)}\n`);
const big = [...outputs].filter(([, text]) => Buffer.byteLength(text, 'utf8') > MAX_FIXTURE_BYTES);
if (big.length) { console.error(`over ${MAX_FIXTURE_BYTES} bytes: ${big.map(([f]) => f).join(', ')}`); process.exit(1); }
mkdirSync(OUT, { recursive: true });
for (const [file, text] of outputs) writeFileSync(file, text);
console.log(`wrote ${OUT}: ${schemaOut.length} schema cases, ${wiringOut.length} wiring cases, ${Object.keys(sites).length} sites (${gaps.length} gaps), ${dateTimeCases.length} date-time cases; catalog ${CATALOG}`);
