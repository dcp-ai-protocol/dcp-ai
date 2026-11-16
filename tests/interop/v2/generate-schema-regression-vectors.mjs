#!/usr/bin/env node
/**
 * Writes two new shared fixtures of the SDK schema-validation work (spec/VERIFICATION.md V2-2), for every SDK phase:
 *
 *   tests/interop/v2/schema_validation/regression_map.json
 *     The historical rejects that V2-2 now decides first: the must_reject and must_reject_bundles rows of
 *     bundle_vectors.json and the reject cases of secondary_sha3_vectors.json that fail the schema (read, never
 *     rewritten). For each: the historical error_contains, the schema errors both oracles report (an SDK asserts these
 *     instead, as V2-2 now rejects first), and where the deeper check it used to reach stays covered: schema-valid rows
 *     of the same fixture, new schema-valid signed negatives (deep_negatives.json), an existing helper's direct test,
 *     or "structural": the schema is now the guard and the deeper branch is no longer reachable.
 *
 *   tests/interop/v2/schema_validation/deep_negatives.json
 *     Schema-valid signed negatives that still reach checks the historical rows used to reach with schema-invalid
 *     input: the temporal parsers of V2-4, V2-13 and V2-14 (forms ajv-formats accepts and the parsers refuse) and the
 *     canonicalization of a fraction inside an open, committed member. Built from the wiring base of
 *     schema_validation/wiring_cases.json with the committed test keys (TEST-ONLY), every commitment redone where the
 *     change is under one.
 *
 * Run: SCHEMA_IR_PYTHON=<python3 with jsonschema> node tests/interop/v2/generate-schema-regression-vectors.mjs
 *      node tests/interop/v2/generate-schema-regression-vectors.mjs --update-wording
 *        rewrites only error_contains_by_sdk of the committed deep_negatives.json from WORDING below (a new SDK phase
 *        adds its wording without signing anything again); every other byte must stay the same.
 */
import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  AlgorithmRegistry, DCP_CONTEXTS, Ed25519Provider, MlDsa65Provider, compositeSign, preparePayload, verifySignedBundleV2,
} from '../../../sdks/typescript/dist/index.js';
import { canon } from '../../../tools/conformance/schema-boundary.js';
import { structure } from '../../../tools/conformance/structural-checks.js';
import { ajvValidate } from '../../../tools/schema-ir/oracle-ajv.mjs';
import { pythonValidate } from '../../../tools/schema-ir/oracle-python.mjs';

// The wording each SDK phase that has run a deep negative reports for it, where no token is shared by every SDK.
const WORDING = {
  intent_target_fraction: { ts: 'Float value prohibited', py: 'Non-integer number', go: 'Cannot hash intent payload', rust: 'Cannot hash intent payload', wasm: 'Cannot hash intent payload' },
  audit_evidence_fraction: { ts: 'Float value prohibited', py: 'Non-integer number', go: 'Cannot hash audit entry 0', rust: 'Cannot hash audit entry 0', wasm: 'Cannot hash audit entry 0' },
};
const SDKS_RUN = ['ts', 'py', 'go', 'rust', 'wasm'];
const wordingOf = (name, token) => Object.fromEntries(SDKS_RUN.map((k) => [k, token ?? WORDING[name]?.[k] ?? fail(`no ${k} wording for ${name}`)]));
if (process.argv.includes('--update-wording')) {
  const file = resolve(dirname(fileURLToPath(import.meta.url)), 'schema_validation', 'deep_negatives.json');
  const before = readFileSync(file, 'utf8');
  const doc = JSON.parse(before);
  for (const c of doc.cases) c.error_contains_by_sdk = wordingOf(c.name, c.error_contains);
  const after = `${JSON.stringify(doc, null, 2)}\n`;
  const strip = (t) => JSON.stringify(JSON.parse(t).cases.map(({ error_contains_by_sdk: _w, ...rest }) => rest)) + JSON.stringify({ ...JSON.parse(t), cases: null });
  if (strip(before) !== strip(after)) fail('--update-wording would change more than error_contains_by_sdk');
  writeFileSync(file, after);
  console.log(`deep_negatives.json: error_contains_by_sdk for ${SDKS_RUN.join(', ')}; signed bundles and every other member unchanged`);
  process.exit(0);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, 'schema_validation');
const read = (f) => JSON.parse(readFileSync(resolve(HERE, f), 'utf8'));
const sha = (f) => createHash('sha256').update(readFileSync(resolve(HERE, f))).digest('hex');
const B = read('bundle_vectors.json');
const V = read('secondary_sha3_vectors.json');
const WIRING = read('schema_validation/wiring_cases.json');
const TEST_KEYS = read('interop_vectors.json').test_keys;
const fail = (m) => { throw new Error(m); };
const clone = (v) => JSON.parse(JSON.stringify(v));

// ── The historical rows ──
const mutated = (signed, mutations) => { const d = clone(signed); for (const m of mutations) m.path.slice(0, -1).reduce((n, k) => n[k], d)[m.path.at(-1)] = m.value; return d; };
const rows = [
  ...B.must_reject.map((c) => ({ fixture: 'tests/interop/v2/bundle_vectors.json', group: 'must_reject', name: c.name, spec_step: c.spec_step, error_contains: c.error_contains, doc: mutated(B.signed_bundle, c.mutations) })),
  ...B.must_reject_bundles.map((c) => ({ fixture: 'tests/interop/v2/bundle_vectors.json', group: 'must_reject_bundles', name: c.name, spec_step: c.spec_step, error_contains: c.error_contains, doc: c.signed_bundle })),
  ...V.cases.filter((c) => c.expect === 'reject').map((c) => ({
    fixture: 'tests/interop/v2/secondary_sha3_vectors.json', group: c.group, name: c.name, spec_step: 'V2-11', error_contains: c.error_contains,
    doc: { bundle: { dcp_bundle_version: '2.0', manifest: c.manifest, ...V.base.artifacts, audit_entries: c.audit_entries }, signature: c.signature },
  })),
];
const py = pythonValidate(rows.map((r) => ({ id: `${r.group}:${r.name}`, text: JSON.stringify(r.doc) })));
const SCHEMA_VALID_COVERAGE = {
  base64: ['bundle_classical_sig_b64_unpadded', 'bundle_classical_sig_b64_with_trailing_bits', 'bundle_pq_sig_b64_with_extra_padding', 'bundle_pq_sig_b64_with_junk_after', 'intent_classical_sig_b64_unpadded', 'intent_classical_sig_b64_with_trailing_bits'],
  nonce: ['audit_entry_session_nonce_differs', 'intent_session_nonce_differs', 'manifest_session_nonce_differs_from_artifacts'],
  root: ['manifest_audit_merkle_root_mismatch'],
  manifest_hash: ['manifest_intent_hash_mismatch', 'intent_payload_hash_wrong'],
  pq_required: ['classical_only_estimated_impact_high', 'classical_only_payment_from_low_risk_passport', 'classical_only_policy_risk_score_900'],
  root_secondary: ['root_wrong_value', 'root_over_reordered_entries', 'root_without_odd_duplication', 'root_sha256_tree_under_sha3_prefix', 'root_zeros_on_non_empty_trail', 'root_non_zero_on_empty_trail'],
  chain_secondary: ['chain_wrong_link_at_1', 'chain_wrong_link_at_last', 'chain_link_over_previous_without_its_secondary', 'chain_link_over_entry_before_previous', 'chain_genesis_after_first', 'chain_entry0_hash_instead_of_genesis'],
  intent_secondary: ['intent_wrong_value', 'intent_sha256_digest_under_sha3_prefix', 'intent_over_signed_intent_envelope', 'intent_on_one_entry_of_several'],
};
function coverage(r) {
  const n = r.name;
  const rowsOf = (key) => ({ kind: 'schema_valid_rows', fixture: r.fixture, rows: SCHEMA_VALID_COVERAGE[key] });
  if (/sig_b64_with_(junk_after|extra_padding|a_newline)$/.test(n)) return rowsOf('base64');
  if (/without_session_nonce$/.test(n)) return rowsOf('nonce');
  if (n === 'empty_audit_trail_with_another_root') return { ...rowsOf('root'), note: 'the root comparison stays reachable with a schema-valid wrong root; must_accept empty_audit_trail keeps the zero-root branch' };
  if (/^session_expires_at_/.test(n)) return { kind: 'deep_negatives', cases: ['session_expires_at_space_separator'] };
  if (/^session_issued_at_/.test(n)) return { kind: 'deep_negatives', cases: ['session_issued_at_lowercase'] };
  if (/^passport_key_expires_at_/.test(n)) return { kind: 'deep_negatives', cases: ['passport_key_expires_at_leap_second'] };
  if (/^rpr_binding_key_expires_at_/.test(n)) return { kind: 'deep_negatives', cases: ['rpr_binding_key_expires_at_offset_without_colon'] };
  if (n === 'rpr_expires_at_impossible_date') return { kind: 'deep_negatives', cases: ['rpr_expires_at_tab_separator'] };
  if (/constructor$|_proto$|toString$|hasOwnProperty$/.test(n)) return { kind: 'helper', helper: 'the tier and mode lookups with prototype names: computeSecurityTier (public) and resolveMode (verify-v2 internal), tested directly in each SDK' };
  if (n === 'classical_only_bundle_signature_without_pq') return { kind: 'structural', reason: 'pq is a required member (null allowed); the PQ requirement of the effective mode stays reachable with pq null', also: rowsOf('pq_required') };
  if (n === 'manifest_without_rpr_hash') return { kind: 'structural', reason: 'the manifest hashes are required members; a mismatched hash stays reachable', also: rowsOf('manifest_hash') };
  if (/^dcp_bundle_version_/.test(n)) return { kind: 'structural', reason: 'dcp_bundle_version is const "2.0"; the version branch of the V2 verifier is no longer reachable' };
  if (n === 'signature_hash_alg_unknown') return { kind: 'structural', reason: 'the hash_alg enum is the set the verifier accepts' };
  if (/^canonicalization_profile_/.test(n)) return { kind: 'structural', reason: 'canonicalization_profile is const "dcp-jcs-v1" on the default path; the candidate route has its own one-node overlay and its own tests' };
  if (/_null$|not_an_object$|_unsigned$|rpr_null_in_agent_signed_bundle/.test(n) && r.group.startsWith('must_reject')) return { kind: 'structural', reason: 'the SignedPayload envelope is closed and its members required; the "not a SignedPayload object" branch is no longer reachable' };
  if (r.fixture.endsWith('secondary_sha3_vectors.json')) {
    const key = r.group === 'root' ? 'root_secondary' : r.group === 'chain' ? 'chain_secondary' : 'intent_secondary';
    return { kind: 'structural', reason: 'a secondary field that is null, not a string or outside its pattern fails the schema; a present inconsistent value stays reachable', also: { kind: 'schema_valid_rows', fixture: r.fixture, rows: SCHEMA_VALID_COVERAGE[key] } };
  }
  return fail(`no coverage rule for ${r.group}:${n}`);
}
const map = [];
const problems = [];
for (const r of rows) {
  const id = `${r.group}:${r.name}`;
  const a = ajvValidate(r.doc);
  const p = py.results.get(id);
  if (a.valid !== p.valid) problems.push(`${id}: oracles disagree (ajv ${a.valid}, python ${p.valid})`);
  if (p.valid) continue;
  // The python oracle reports a failed oneOf once at its instance, as the SDK interpreters do; Ajv also lists the
  // branch errors under it, which are dropped here before the two lists are compared.
  const oneOf = a.errors.filter((e) => e.keyword === 'oneOf').map((e) => e.instance);
  const ajvNorm = a.errors.filter((e) => e.keyword === 'oneOf' || !oneOf.some((o) => e.instance === o || e.instance.startsWith(`${o}/`)));
  const key = (e) => `${e.instance} ${e.keyword} ${e.member ?? ''}`;
  if (JSON.stringify([...new Set(ajvNorm.map(key))].sort()) !== JSON.stringify(p.errors.map(key).sort())) problems.push(`${id}: oracle error sets differ: ${JSON.stringify(ajvNorm.map(key))} vs ${JSON.stringify(p.errors.map(key))}`);
  map.push({ fixture: r.fixture, group: r.group, name: r.name, spec_step: r.spec_step, historical_error_contains: r.error_contains, schema_errors: p.errors, deep_coverage: coverage(r) });
}
for (const m of map) for (const c of [m.deep_coverage, m.deep_coverage.also].filter((x) => x?.kind === 'schema_valid_rows')) {
  for (const n of c.rows) {
    const row = rows.find((r) => r.name === n && r.fixture === c.fixture);
    if (!row) problems.push(`${m.name}: coverage row ${n} does not exist`);
    else if (!py.results.get(`${row.group}:${row.name}`).valid) problems.push(`${m.name}: coverage row ${n} is not schema-valid`);
  }
}

// ── The schema-valid deep negatives ──
const registry = new AlgorithmRegistry();
registry.registerSigner(new Ed25519Provider());
registry.registerSigner(new MlDsa65Provider());
const k = (t) => ({ kid: t.kid, alg: t.alg, secretKeyB64: t.secret_key_b64, publicKeyB64: t.public_key_b64 });
const KEYS = { classical: k(TEST_KEYS.ed25519), pq: k(TEST_KEYS.ml_dsa_65) };
const base = WIRING.cases.find((c) => c.name === 'base').signed_bundle;
const MANIFEST_FIELD = { responsible_principal_record: 'rpr_hash', agent_passport: 'passport_hash', intent: 'intent_hash', policy_decision: 'policy_hash' };
const CONTEXT = { responsible_principal_record: DCP_CONTEXTS.ResponsiblePrincipal, agent_passport: DCP_CONTEXTS.AgentPassport, intent: DCP_CONTEXTS.Intent, policy_decision: DCP_CONTEXTS.PolicyDecision };
async function resignManifest(s) {
  const text = canon(s.bundle.manifest);
  s.signature.manifest_hash = `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
  s.signature.composite_sig = await compositeSign(registry, DCP_CONTEXTS.Bundle, new Uint8Array(Buffer.from(text, 'utf8')), KEYS);
  return s;
}
async function resignArtifact(s, name, edit) {
  edit(s.bundle[name].payload);
  const { canonicalBytes, payloadHash } = preparePayload(s.bundle[name].payload);
  s.bundle[name].payload_hash = payloadHash;
  s.bundle[name].composite_sig = await compositeSign(registry, CONTEXT[name], canonicalBytes, KEYS);
  s.bundle.manifest[MANIFEST_FIELD[name]] = payloadHash;
  return resignManifest(s);
}
const R = 're-signed: every commitment over the change redone';
const U = 'changed after signing, inside an open member: no hash or signature can be computed over a fraction';
const DEEP = [
  ['session_expires_at_space_separator', 'V2-4', 'session_expires_at', R, (s) => { s.bundle.manifest.session_expires_at = '2099-12-31 23:59:59Z'; return resignManifest(s); }],
  ['session_issued_at_lowercase', 'V2-4', 'session_issued_at', R, (s) => { s.bundle.manifest.session_issued_at = '2026-10-21t00:00:00z'; return resignManifest(s); }],
  ['passport_key_expires_at_leap_second', 'V2-13', 'expires_at', R, (s) => resignArtifact(s, 'agent_passport', (p) => { p.keys[0].expires_at = '2099-12-31T23:59:60Z'; })],
  ['rpr_binding_key_expires_at_offset_without_colon', 'V2-13', 'expires_at', R, (s) => resignArtifact(s, 'responsible_principal_record', (p) => { p.binding_keys[0].expires_at = '2099-12-31T23:59:59+0500'; })],
  ['rpr_expires_at_tab_separator', 'V2-14', 'responsible_principal_record has an invalid expires_at', R, (s) => resignArtifact(s, 'responsible_principal_record', (p) => { p.expires_at = '2099-12-31\t23:59:59Z'; })],
  ['intent_target_fraction', 'V2-3', null, U, (s) => { s.bundle.intent.payload.target.x_fraction = 1.5; return s; }],
  ['audit_evidence_fraction', 'V2-3', null, U, (s) => { s.bundle.audit_entries[0].evidence.x_fraction = 1.5; return s; }],
];
const deep = [];
const now = Date.parse(WIRING.verification_time);
for (const [name, step, token, construction, make] of DEEP) {
  const s = await make(clone(base));
  if (!ajvValidate(s).valid) problems.push(`deep ${name}: not schema-valid for oracle 1`);
  if (construction === R) { const st = structure(s, WIRING.verification_time); if (st.length) problems.push(`deep ${name}: structure fails: ${st.join('; ')}`); }
  const r = await verifySignedBundleV2(s, registry, WIRING.verifier_policy, { now });
  const ts = r.errors.find((e) => !e.startsWith('schema:'));
  if (r.verified || !ts) problems.push(`deep ${name}: the TypeScript verifier gives ${JSON.stringify(r)}`);
  if (token && !r.errors.some((e) => e.toLowerCase().includes(token.toLowerCase()))) problems.push(`deep ${name}: no error contains ${token}: ${JSON.stringify(r.errors)}`);
  deep.push({ name, spec_step: step, construction, error_contains: token ?? undefined, error_contains_by_sdk: wordingOf(name, token), signed_bundle: s });
}
const pyDeep = pythonValidate(deep.map((d) => ({ id: d.name, text: JSON.stringify(d.signed_bundle) })));
for (const d of deep) if (!pyDeep.results.get(d.name).valid) problems.push(`deep ${d.name}: not schema-valid for oracle 2`);
for (const m of map) if (m.deep_coverage.kind === 'deep_negatives') for (const c of m.deep_coverage.cases) if (!deep.some((d) => d.name === c)) problems.push(`${m.name}: deep negative ${c} missing`);
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }

const sources = Object.fromEntries(['bundle_vectors.json', 'secondary_sha3_vectors.json', 'schema_validation/wiring_cases.json'].map((f) => [`tests/interop/v2/${f}`, sha(f)]));
writeFileSync(resolve(OUT, 'regression_map.json'), `${JSON.stringify({
  _description: 'The historical rejects V2-2 now decides first (schema-invalid rows of bundle_vectors.json and secondary_sha3_vectors.json, read unchanged). An SDK with the schema gate asserts schema_errors (each {instance, keyword, member?}, the set both oracles report; a failed oneOf once at its instance) for these rows instead of historical_error_contains, and keeps the deeper check covered as deep_coverage says. Rows not listed keep their historical assertion.',
  _sources: { ...sources, generator: 'tests/interop/v2/generate-schema-regression-vectors.mjs', oracle_python: py.about },
  totals: { rows_read: rows.length, schema_invalid: map.length, by_fixture: Object.fromEntries([...new Set(map.map((m) => m.fixture))].map((f) => [f, map.filter((m) => m.fixture === f).length])) },
  rows: map,
}, null, 2)}\n`);
writeFileSync(resolve(OUT, 'deep_negatives.json'), `${JSON.stringify({
  _description: 'Schema-valid signed negatives that reach the deeper checks the historical schema-invalid rows used to reach: the V2-4, V2-13 and V2-14 temporal parsers (date-times ajv-formats accepts and the parsers refuse) and the canonicalization of a fraction in an open member under a commitment. Each MUST be rejected with an error that contains error_contains (case-insensitive) where it is given; error_contains_by_sdk records the wording of each SDK phase that has run it.',
  _sources: { ...sources, generator: 'tests/interop/v2/generate-schema-regression-vectors.mjs' },
  _keys: `tests/interop/v2/interop_vectors.json#test_keys (TEST-ONLY): ed25519 kid ${KEYS.classical.kid}, ml-dsa-65 kid ${KEYS.pq.kid}`,
  verification_time: WIRING.verification_time,
  verifier_policy: WIRING.verifier_policy,
  cases: deep,
}, null, 2)}\n`);
console.log(`regression_map: ${map.length} schema-invalid of ${rows.length} rows; deep_negatives: ${deep.length}`);
