#!/usr/bin/env node
/**
 * Writes tests/interop/v2/schema_closure_vectors.json, a new file. It reads two committed files and rewrites none: the
 * test keys of interop_vectors.json#test_keys and the default_verifier_policy of bundle_vectors.json. It holds
 * one signed V2 bundle and single-change cases that bind spec/VERIFICATION.md V2-2 to the JSON Schema location that
 * decides them (a closed object, an enumeration, or an open object that permits the member).
 *
 * - Unsigned changes (a member at the root, in signature, signer, composite_sig or a SignedPayload envelope, a binding
 *   outside its enumeration) keep every signature and hash valid: the integrity layer stays valid and the schema is
 *   what rejects them.
 * - Signed closed objects (the manifest, an artifact payload, an audit entry, a key entry) get the member before
 *   signing: every payload hash, chain link, root, manifest commitment and signature is redone, so their integrity is
 *   valid under the same keys and contexts, independently checked, before the rejection is attributed to the schema.
 * - Permitted extensions: bundle.x_ext (the bundle object is open and unsigned) and audit_entries[0].evidence.x_ext
 *   (open, but committed: everything is redone) verify.
 * - Integrity negatives: the same evidence member, or a manifest member, added after signing; the first is
 *   schema-valid and fails integrity only, the second fails both and is not attributed to the schema alone.
 *
 * Keys: the committed public test keys of tests/interop/v2/interop_vectors.json#test_keys (TEST-ONLY, publicly known
 * by design), used by the principal and by the agent. Timestamps, nonce and contents are fixed, so the construction of
 * every case is deterministic; Ed25519 signatures are deterministic too, ML-DSA-65 signatures are hedged with fresh
 * entropy, so a new run writes different composite_sig.pq.sig_b64 bytes and nothing else. The committed file is the
 * artifact; regeneration is not byte-identical.
 *
 * Before writing, every case goes through validateV2Bundle (lib/verify.js) and the SDK-free integrity check of
 * tools/conformance/schema-boundary.js, and the base through verifySignedBundleV2: any result other than the declared
 * one stops the generator.
 *
 * Run: (cd sdks/typescript && npm run build) && node tests/interop/v2/generate-schema-closure-vectors.mjs
 */
import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  AlgorithmRegistry, BundleBuilderV2, DCP_CONTEXTS, Ed25519Provider, MlDsa65Provider, compositeSign, preparePayload,
  signBundleV2, verifySignedBundleV2,
} from '../../../sdks/typescript/dist/index.js';
import { canon, integrity, schema } from '../../../tools/conformance/schema-boundary.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(HERE, 'schema_closure_vectors.json');
const VERIFICATION_TIME = '2026-10-22T00:00:00Z';
const POLICY = JSON.parse(readFileSync(resolve(HERE, 'bundle_vectors.json'), 'utf8')).default_verifier_policy;
const TEST_KEYS = JSON.parse(readFileSync(resolve(HERE, 'interop_vectors.json'), 'utf8')).test_keys;
const hashOf = (obj) => `sha256:${createHash('sha256').update(canon(obj), 'utf8').digest('hex')}`;
const clone = (v) => JSON.parse(JSON.stringify(v));
const set = (obj, path, value) => { let n = obj; for (const k of path.slice(0, -1)) n = n[k]; n[path.at(-1)] = value; return obj; };

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

/** The bundle, with optional members added BEFORE signing, so that every commitment and signature covers them. */
async function build({ keyEntry, intentPayload, auditEntry, evidence, manifest } = {}) {
  const nonce = createHash('sha256').update('dcp-ai schema_closure session').digest('hex');
  const rpr = {
    dcp_version: '2.0', human_id: 'human:schema-closure-principal', session_nonce: nonce, legal_name: 'Schema Closure Principal',
    entity_type: 'natural_person', jurisdiction: 'US-CA', liability_mode: 'owner_responsible', override_rights: true,
    issued_at: '2026-10-21T00:00:00Z', expires_at: null, contact: null, binding_keys: keyEntries(),
  };
  if (keyEntry) rpr.binding_keys[0].x_ext = keyEntry;
  const passport = {
    dcp_version: '2.0', agent_id: 'agent:schema-closure-bot', session_nonce: nonce, keys: keyEntries(),
    principal_binding_reference: rpr.human_id, capabilities: ['browse', 'api_call'], risk_tier: 'medium',
    created_at: '2026-10-21T00:00:00Z', status: 'active',
  };
  const intent = {
    dcp_version: '2.0', intent_id: 'intent:schema-closure-001', session_nonce: nonce, agent_id: passport.agent_id, human_id: rpr.human_id,
    timestamp: '2026-10-21T12:00:00Z', action_type: 'send_email', target: { channel: 'email', to: 'bob@example.com', domain: 'example.com' },
    data_classes: ['contact_info'], estimated_impact: 'medium', requires_consent: false,
  };
  if (intentPayload) intent.x_ext = intentPayload;
  const policyDecision = {
    dcp_version: '2.0', intent_id: intent.intent_id, session_nonce: nonce, decision: 'approve', risk_score: 450,
    reasons: ['Known recipient domain'], required_confirmation: null, applied_policy_hash: hashOf({ policy: 'default' }), timestamp: '2026-10-21T12:00:01Z',
  };
  const audit1 = {
    dcp_version: '2.0', audit_id: 'audit:schema-closure-001', session_nonce: nonce, prev_hash: 'GENESIS', hash_alg: 'sha256',
    timestamp: '2026-10-21T12:01:00Z', agent_id: passport.agent_id, human_id: rpr.human_id, intent_id: intent.intent_id,
    intent_hash: hashOf(intent), policy_decision: 'approved', outcome: 'email_sent',
    evidence: { tool: 'smtp', result_ref: 'msg:schema-closure-001', evidence_hash: hashOf({ message: 'schema-closure-001' }) }, pq_checkpoint_ref: null,
  };
  if (auditEntry) audit1.x_ext = auditEntry;
  if (evidence) audit1.evidence.x_ext = evidence;
  const audit2 = {
    ...clone(audit1), audit_id: 'audit:schema-closure-002', prev_hash: hashOf(audit1), timestamp: '2026-10-21T12:02:00Z',
    evidence: { tool: 'smtp', result_ref: 'msg:schema-closure-002', evidence_hash: hashOf({ message: 'schema-closure-002' }) },
  };
  delete audit2.x_ext;
  const bundle = new BundleBuilderV2(nonce)
    .responsiblePrincipalRecord(await sign(rpr, DCP_CONTEXTS.ResponsiblePrincipal))
    .agentPassport(await sign(passport, DCP_CONTEXTS.AgentPassport))
    .intent(await sign(intent, DCP_CONTEXTS.Intent))
    .policyDecision(await sign(policyDecision, DCP_CONTEXTS.PolicyDecision))
    .addAuditEntries([audit1, audit2])
    .build();
  Object.assign(bundle.manifest, { session_issued_at: '2026-10-21T00:00:00Z', session_expires_at: '2099-12-31T23:59:59Z' });
  if (manifest) bundle.manifest.x_ext = manifest;
  const signed = await signBundleV2(bundle, { registry, signerType: 'human', signerId: rpr.human_id, keys: KEYS });
  signed.signature.created_at = '2026-10-21T12:03:00Z'; // outside the signed manifest; fixed
  return signed;
}

const S = (file, pointer) => `schemas/v2/${file}.schema.json#${pointer}`;
const closed = (file, pointer) => ({ valid: false, pointer: S(file, pointer), rule: 'closed: additionalProperties false' });
const base = await build();
const unsigned = (path, value) => ({ construction: 'one member set on the committed base after signing (unsigned region)', path, value, signed_bundle: set(clone(base), path, value) });
const stale = (path, value) => ({ construction: 'one member set on the committed base after signing, commitments and signatures not redone', path, value, signed_bundle: set(clone(base), path, value) });
const resigned = async (what, opts) => ({ construction: `re-signed: ${what} added before signing; every payload hash, chain link, root, manifest commitment and signature redone`, signed_bundle: await build(opts) });
const VALID = { valid: true };
const INVALID = (...failing) => ({ valid: false, failing });

const cases = [
  { name: 'root_unknown_member', ...unsigned(['x_ext'], true), spec_step: 'V2-2', attribution: 'schema',
    expect: { schema: closed('signed_bundle', '/additionalProperties'), integrity: VALID, verified: false } },
  { name: 'signature_unknown_member', ...unsigned(['signature', 'x_ext'], true), spec_step: 'V2-2', attribution: 'schema',
    expect: { schema: closed('signed_bundle', '/properties/signature/additionalProperties'), integrity: VALID, verified: false } },
  { name: 'signer_unknown_member', ...unsigned(['signature', 'signer', 'x_ext'], true), spec_step: 'V2-2', attribution: 'schema',
    expect: { schema: closed('signed_bundle', '/properties/signature/properties/signer/additionalProperties'), integrity: VALID, verified: false } },
  { name: 'composite_sig_unknown_member', ...unsigned(['signature', 'composite_sig', 'x_ext'], true), spec_step: 'V2-2', attribution: 'schema',
    expect: { schema: closed('composite_signature', '/additionalProperties'), integrity: VALID, verified: false } },
  { name: 'envelope_unknown_member', ...unsigned(['bundle', 'intent', 'x_ext'], true), spec_step: 'V2-2', attribution: 'schema',
    expect: { schema: closed('signed_payload', '/additionalProperties'), integrity: VALID, verified: false } },
  { name: 'binding_outside_enumeration', ...unsigned(['signature', 'composite_sig', 'binding'], 'pq_and_classical'), spec_step: 'V2-2', attribution: 'schema (enumeration; V2-5 also names the two bindings)',
    expect: { schema: { valid: false, pointer: S('composite_signature', '/properties/binding/enum'), rule: 'enumeration', value: 'pq_and_classical' }, integrity: VALID, verified: false } },
  { name: 'manifest_unknown_member_resigned', ...(await resigned('manifest.x_ext', { manifest: true })), spec_step: 'V2-2', attribution: 'schema (integrity independently valid)',
    expect: { schema: closed('bundle_manifest', '/additionalProperties'), integrity: VALID, verified: false } },
  { name: 'intent_payload_unknown_member_resigned', ...(await resigned('intent.payload.x_ext', { intentPayload: true })), spec_step: 'V2-2', attribution: 'schema (integrity independently valid)',
    expect: { schema: closed('intent', '/additionalProperties'), integrity: VALID, verified: false } },
  { name: 'audit_entry_unknown_member_resigned', ...(await resigned('audit_entries[0].x_ext', { auditEntry: true })), spec_step: 'V2-2', attribution: 'schema (integrity independently valid)',
    expect: { schema: closed('audit_entry', '/additionalProperties'), integrity: VALID, verified: false } },
  { name: 'key_entry_unknown_member_resigned', ...(await resigned('responsible_principal_record.payload.binding_keys[0].x_ext', { keyEntry: true })), spec_step: 'V2-2', attribution: 'schema (integrity independently valid)',
    expect: { schema: closed('key_entry', '/additionalProperties'), integrity: VALID, verified: false } },
  { name: 'bundle_open_member', ...unsigned(['bundle', 'x_ext'], true), spec_step: 'V2-2', attribution: 'none: a permitted extension',
    expect: { schema: { valid: true, pointer: S('signed_bundle', '/properties/bundle'), rule: 'open: no additionalProperties' }, integrity: VALID, verified: true } },
  { name: 'evidence_open_member_resigned', ...(await resigned('audit_entries[0].evidence.x_ext', { evidence: true })), spec_step: 'V2-2', attribution: 'none: a permitted extension',
    expect: { schema: { valid: true, pointer: S('audit_entry', '/properties/evidence'), rule: 'open: no additionalProperties' }, integrity: VALID, verified: true } },
  { name: 'evidence_open_member_stale', ...stale(['bundle', 'audit_entries', 0, 'evidence', 'x_ext'], true), spec_step: 'V2-3', attribution: 'integrity: schema-valid, the commitments are stale',
    twin: 'evidence_open_member_resigned',
    expect: { schema: { valid: true, pointer: S('audit_entry', '/properties/evidence'), rule: 'open: no additionalProperties' }, integrity: INVALID('audit_entries[1].prev_hash', 'manifest.audit_merkle_root'), verified: false } },
  { name: 'manifest_unknown_member_stale', ...stale(['bundle', 'manifest', 'x_ext'], true), spec_step: 'V2-2', attribution: 'schema and integrity: not attributable to the schema alone',
    expect: { schema: closed('bundle_manifest', '/additionalProperties'), integrity: INVALID('signature.manifest_hash', 'bundle: classical signature', 'bundle: pq signature'), verified: false } },
];

// Self-check before writing: the schema and the integrity layers give exactly what each case declares.
const baseExpect = { schema: { valid: true }, integrity: VALID, verified: true };
for (const c of [{ name: 'base', signed_bundle: base, expect: baseExpect }, ...cases]) {
  const sc = schema(c.signed_bundle);
  const it = integrity(c.signed_bundle);
  if (sc.valid !== c.expect.schema.valid) throw new Error(`${c.name}: schema valid ${sc.valid}, declared ${c.expect.schema.valid}: ${sc.errors.join('; ')}`);
  if (it.valid !== c.expect.integrity.valid) throw new Error(`${c.name}: integrity valid ${it.valid}, declared ${c.expect.integrity.valid}: ${it.failures.join('; ')}`);
  if (!it.valid && JSON.stringify([...it.failures].sort()) !== JSON.stringify([...c.expect.integrity.failing].sort())) throw new Error(`${c.name}: integrity failures ${JSON.stringify(it.failures)}, declared ${JSON.stringify(c.expect.integrity.failing)}`);
}
const check = await verifySignedBundleV2(base, registry, POLICY, { now: Date.parse(VERIFICATION_TIME) });
if (!check.verified) throw new Error(`the base does not verify: ${JSON.stringify(check.errors)}`);

const out = {
  _description: 'spec/VERIFICATION.md V2-2 boundary: a signed V2 bundle and single-change cases, each bound to the JSON Schema location that decides it. '
    + 'expect.verified is the normative verdict (V2-1 to V2-14): a closed-object or enumeration case is rejected even when every signature and hash is valid, and a verifier that accepts it shows a gap, never conformance. '
    + 'expect.schema is validateV2Bundle (the envelope schema and the four artifact payload schemas); expect.integrity is the SDK-free recomputation of hashes, chain, roots and signatures. '
    + 'Unsigned cases are changed after signing; re-signed cases carry the member under every commitment and signature; stale cases add it after signing. '
    + 'twin names the positive case that carries the same member with every commitment redone: a same-run control besides the base.',
  _generator: 'tests/interop/v2/generate-schema-closure-vectors.mjs',
  _keys: `tests/interop/v2/interop_vectors.json#test_keys (TEST-ONLY, publicly known): ed25519 kid ${KEYS.classical.kid}, ml-dsa-65 kid ${KEYS.pq.kid}; the principal and the agent use the same pair`,
  _randomness: 'Case construction, timestamps, nonce and Ed25519 signatures are deterministic; ML-DSA-65 signatures are hedged with fresh entropy, so a new run writes different composite_sig.pq.sig_b64 bytes and nothing else. The committed file is the artifact; regeneration is not byte-identical.',
  verification_time: VERIFICATION_TIME,
  verifier_policy: POLICY,
  base,
  base_expect: baseExpect,
  cases,
};
writeFileSync(OUTPUT, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${OUTPUT}: base verified, ${cases.length} cases, schema and integrity layers as declared`);
