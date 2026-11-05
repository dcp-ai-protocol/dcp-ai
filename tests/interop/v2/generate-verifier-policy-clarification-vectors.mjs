#!/usr/bin/env node
/**
 * Writes tests/interop/v2/verifier_policy_clarification_vectors.json, a new file: the cases of the dated clarification
 * of spec/VERIFICATION.md V2-10 (05/11/2026), questions Q1, Q2 and Q3 of verifier_policy_vectors.json. It rewrites no
 * committed file, and it uses no SDK: the expectations below are written by hand from that clarification, and every
 * signature is checked with the primitives (tweetnacl, @noble/post-quantum) over dcp-jcs-v1 bytes.
 *
 * - Bases, by reference and recorded sha256: routine_hybrid of verifier_policy_vectors.json (every signature
 *   pq_over_classical, routine tier, so the requested mode is the effective one) and the classical-only routine bundle
 *   of bundle_vectors.json.
 * - Q1: under pq_only, a policy whose accepted_classical_algs excludes ed25519 or whose advisory_rejected_algs lists it
 *   accepts routine_hybrid; the same policies under hybrid_required reject it (the lists are active).
 * - Q2: at the bundle signature, the passport and the checkpoint, a variant whose Ed25519 component does not verify
 *   (its first byte flipped, so it fails as a signature, not as an encoding) and whose ML-DSA-65 component is a valid
 *   signature over the domain-separated payload followed by those Ed25519 bytes, made here with the committed TEST-ONLY
 *   key: accepted under pq_only, rejected in the three other modes.
 * - Q2 scope: under pq_only only the cryptographic failure of the classical component is tolerated. A classical
 *   sig_b64 that is not canonical base64 for the same bytes (V2-5), or a classical kid that names no key (V2-6, V2-13),
 *   is rejected; every signature byte is the committed one.
 * - Q3: under classical_only and hybrid_preferred, PQ lists and advisories that exclude ml-dsa-65 do not reject the
 *   classical-only bundle, which uses no PQ algorithm; under the same policy routine_hybrid is rejected.
 *
 * ML-DSA-65 signing is hedged with fresh entropy, so a new run writes other PQ bytes for the Q2 variants and nothing
 * else. The committed file is the artifact; regeneration is not byte-identical.
 *
 * Run: node tests/interop/v2/generate-verifier-policy-clarification-vectors.mjs
 */
import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import nacl from 'tweetnacl';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { canon } from '../../../tools/conformance/schema-boundary.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(HERE, 'verifier_policy_clarification_vectors.json');
const read = (f) => JSON.parse(readFileSync(resolve(HERE, f), 'utf8'));
const P = read('verifier_policy_vectors.json');
const B = read('bundle_vectors.json');
const TEST_KEYS = read('interop_vectors.json').test_keys;
const digest = (obj) => createHash('sha256').update(JSON.stringify(obj), 'utf8').digest('hex');
const at = (obj, path) => path.reduce((n, k) => n[k], obj);
const b64 = (s) => Buffer.from(s, 'base64');
const fail = (msg) => { throw new Error(msg); };

const MODES = ['classical_only', 'hybrid_preferred', 'hybrid_required', 'pq_only'];
const modePolicy = (mode, overrides = {}) => ({ ...structuredClone(P.base_policy), default_mode: mode, risk_overrides: { low: mode, medium: mode, high: mode }, ...structuredClone(overrides) });
const routine = P.bundles.routine_hybrid.signed_bundle;
const classical = B.classical_only_routine_bundle.signed_bundle;
if (P.bundles.routine_hybrid.tier !== 'routine' || P.bundles.classical_only_routine.tier !== 'routine') fail('a base is not routine');
if (P.bundles.classical_only_routine.sha256 !== digest(classical)) fail('classical_only_routine differs from its recorded sha256');
const bundles = {
  routine_hybrid: { source: 'tests/interop/v2/verifier_policy_vectors.json#bundles/routine_hybrid', sha256: digest(routine), tier: 'routine' },
  classical_only_routine: { source: 'tests/interop/v2/bundle_vectors.json#classical_only_routine_bundle', sha256: digest(classical), tier: 'routine' },
};

// The signature at each location, its context, the signed text and the key list its kids are looked up in.
const LOCATIONS = {
  bundle: { spec_step: 'V2-6', path: ['signature', 'composite_sig'], context: 'DCP-AI.v2.Bundle', text: (s) => canon(s.bundle.manifest), keys: (s) => s.bundle.responsible_principal_record.payload.binding_keys },
  passport: { spec_step: 'V2-8', path: ['bundle', 'agent_passport', 'composite_sig'], context: 'DCP-AI.v2.AgentPassport', text: (s) => canon(s.bundle.agent_passport.payload), keys: (s) => s.bundle.agent_passport.payload.keys },
  checkpoint: { spec_step: 'V2-12', path: ['bundle', 'pq_checkpoints', 0, 'composite_sig'], context: 'DCP-AI.v2.AuditEvent', text: (s) => { const { composite_sig: _c, ...body } = s.bundle.pq_checkpoints[0]; return canon(body); }, keys: (s) => s.bundle.agent_passport.payload.keys },
};
const message = (s, L) => Buffer.concat([Buffer.from(L.context, 'utf8'), Buffer.from([0]), Buffer.from(L.text(s), 'utf8')]);
const keyOf = (s, L, kid) => L.keys(s).find((k) => k.kid === kid);
const classicalValid = (msg, sigB64, key) => nacl.sign.detached.verify(msg, b64(sigB64), b64(key.public_key_b64));
const pqValid = (msg, classicalB64, pqB64, key) => ml_dsa65.verify(b64(pqB64), Buffer.concat([msg, b64(classicalB64)]), b64(key.public_key_b64));

const variants = {};
for (const [loc, L] of Object.entries(LOCATIONS)) {
  const cs = at(routine, L.path);
  const msg = message(routine, L);
  const ed = keyOf(routine, L, cs.classical.kid) ?? fail(`${loc}: classical key missing`);
  const pq = keyOf(routine, L, cs.pq.kid) ?? fail(`${loc}: PQ key missing`);
  if (pq.public_key_b64 !== TEST_KEYS.ml_dsa_65.public_key_b64) fail(`${loc}: the PQ key is not the committed test key`);
  if (!classicalValid(msg, cs.classical.sig_b64, ed) || !pqValid(msg, cs.classical.sig_b64, cs.pq.sig_b64, pq)) fail(`${loc}: the committed signature does not verify`);
  // Q2: R's first byte flipped (S unchanged, so S < L still holds), and a PQ signature over those bytes.
  const bad = b64(cs.classical.sig_b64);
  bad[0] ^= 0x01;
  const badB64 = bad.toString('base64');
  const pqB64 = Buffer.from(ml_dsa65.sign(Buffer.concat([msg, bad]), b64(TEST_KEYS.ml_dsa_65.secret_key_b64))).toString('base64');
  const checks = {
    classical_valid: classicalValid(msg, badB64, ed),
    pq_valid_over_these_classical_bytes: pqValid(msg, badB64, pqB64, pq),
    committed_pq_valid_over_these_classical_bytes: pqValid(msg, badB64, cs.pq.sig_b64, pq),
  };
  if (checks.classical_valid || !checks.pq_valid_over_these_classical_bytes || checks.committed_pq_valid_over_these_classical_bytes) fail(`${loc}: Q2 variant checks ${JSON.stringify(checks)}`);
  variants[`q2_${loc}`] = { of: 'routine_hybrid', location: loc, mutations: [{ path: [...L.path, 'classical', 'sig_b64'], value: badB64 }, { path: [...L.path, 'pq', 'sig_b64'], value: pqB64 }], checks };
}
// The Ed25519 signature is 64 bytes: 88 characters ending in "==", whose third-to-last character keeps 2 data bits and
// 4 bits that canonical base64 sets to zero. Setting one of them gives other text for the same bytes.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function nonCanonical(s) {
  const v = ALPHABET.indexOf(s[85]);
  if (s.length !== 88 || !s.endsWith('==') || v < 0 || (v & 0x0f) !== 0) fail('unexpected Ed25519 sig_b64');
  const t = `${s.slice(0, 85)}${ALPHABET[v | 1]}${s.slice(86)}`;
  if (!b64(t).equals(b64(s)) || b64(t).toString('base64') === t) fail('not a same-bytes, non-canonical text');
  return t;
}
const UNKNOWN_KID = createHash('sha256').update('dcp-ai verifier_policy_clarification unknown classical kid').digest('hex').slice(0, 32);
for (const loc of ['bundle', 'passport']) {
  const L = LOCATIONS[loc];
  const cs = at(routine, L.path);
  if (L.keys(routine).some((k) => k.kid === UNKNOWN_KID)) fail('kid collision');
  const text = nonCanonical(cs.classical.sig_b64);
  variants[`scope_${loc}_noncanonical_classical_sig_b64`] = { of: 'routine_hybrid', location: loc, mutations: [{ path: [...L.path, 'classical', 'sig_b64'], value: text }],
    checks: { same_bytes_as_committed: b64(text).equals(b64(cs.classical.sig_b64)), canonical: b64(text).toString('base64') === text } };
  variants[`scope_${loc}_unknown_classical_kid`] = { of: 'routine_hybrid', location: loc, mutations: [{ path: [...L.path, 'classical', 'kid'], value: UNKNOWN_KID }],
    checks: { kid_in_key_list: false, committed_pq_valid: pqValid(message(routine, L), cs.classical.sig_b64, cs.pq.sig_b64, keyOf(routine, L, cs.pq.kid)) } };
}

const cases = [];
const add = (name, question, bundle, mode, spec_step, verified, basis, { overrides = {}, controls } = {}) => {
  cases.push({ name, question, bundle, requested_mode: mode, effective_mode: mode, policy_overrides: overrides, policy: modePolicy(mode, overrides),
    verification_time: P.verification_time, spec_step, expect: { verified }, ...(controls ? { controls } : {}), basis });
};
const control = (mode) => [`base.${mode}.positive`];
for (const m of MODES) add(`base.${m}.positive`, 'control', 'routine_hybrid', m, 'V2-10', true, 'Every signature pq_over_classical and valid, both algorithms accepted, none under advisory (verifier_policy_vectors.json routine_hybrid positives).');
const CLASSICAL_LISTS = { classical_alg_not_accepted: { accepted_classical_algs: ['ml-dsa-65'] }, classical_alg_advisory_rejected: { advisory_rejected_algs: ['ed25519'] } };
const PQ_LISTS = { pq_alg_not_accepted: { accepted_pq_algs: ['slh-dsa-192f'] }, pq_alg_advisory_rejected: { advisory_rejected_algs: ['ml-dsa-65'] } };
for (const [n, overrides] of Object.entries(CLASSICAL_LISTS)) {
  add(`q1.pq_only.${n}`, 'Q1', 'routine_hybrid', 'pq_only', 'V2-10', true, 'Clarification of V2-10 (Q1): under pq_only the classical lists and advisories do not apply to the classical component, which is not required (DCP-AI-v2.0.md § 7.1, § 7.3, § 13.3).', { overrides });
  add(`q1.hybrid_required.${n}`, 'Q1', 'routine_hybrid', 'hybrid_required', 'V2-10', false, 'V2-10: outside pq_only a policy that excludes the classical algorithm the bundle uses rejects it (the contrast of Q1).', { overrides, controls: control('hybrid_required') });
}
for (const loc of Object.keys(LOCATIONS)) {
  const step = LOCATIONS[loc].spec_step;
  for (const m of MODES) {
    if (m === 'pq_only') add(`q2.${loc}.pq_only`, 'Q2', `q2_${loc}`, m, step, true, `Clarification of V2-10 (Q2): under pq_only a classical component that fails cryptographic verification is tolerated when the PQ component verifies over those classical bytes (pq_over_classical; DCP-AI-v2.0.md § 5, § 7.1${loc === 'checkpoint' ? '; V2-12 (3)' : ''}).`);
    else add(`q2.${loc}.${m}`, 'Q2', `q2_${loc}`, m, step, false, `${step}: outside pq_only the classical component is required and MUST verify (the contrast of Q2).`, { controls: control(m) });
  }
}
for (const loc of ['bundle', 'passport']) {
  add(`q2_scope.${loc}.noncanonical_classical_sig_b64`, 'Q2 scope', `scope_${loc}_noncanonical_classical_sig_b64`, 'pq_only', 'V2-5', false,
    'Clarification of V2-10 (Q2) leaves V2-5 in force under pq_only: every sig_b64 MUST be canonical base64, including a classical one whose verification is tolerated.', { controls: control('pq_only') });
  add(`q2_scope.${loc}.unknown_classical_kid`, 'Q2 scope', `scope_${loc}_unknown_classical_kid`, 'pq_only', 'V2-13', false,
    'Clarification of V2-10 (Q2) leaves the key lookup and identity of V2-6 and V2-13 in force under pq_only: a classical kid that names no key in the list is rejected.', { controls: control('pq_only') });
}
for (const m of ['classical_only', 'hybrid_preferred']) {
  add(`q3.${m}.positive`, 'control', 'classical_only_routine', m, 'V2-10', true, `bundle_vectors.json classical_only_routine_bundle.verified_by_mode.${m} = true.`);
  for (const [n, overrides] of Object.entries(PQ_LISTS)) {
    add(`q3.${m}.${n}`, 'Q3', 'classical_only_routine', m, 'V2-10', true, 'Clarification of V2-10 (Q3): a bundle with no PQ component uses no PQ algorithm, so the PQ lists and advisories do not reject it; the effective mode admits classical_only.', { overrides });
    add(`q3_contrast.${m}.${n}`, 'Q3', 'routine_hybrid', m, 'V2-10', false, 'V2-10: a PQ component that is present is checked against the PQ lists in every mode (the contrast of Q3).', { overrides, controls: control(m) });
  }
}
if (cases.length !== 34 || new Set(cases.map((c) => c.name)).size !== cases.length) fail(`unexpected case list (${cases.length})`);

const corpus = {
  _description: 'Verifier policy vectors of the dated clarification of spec/VERIFICATION.md V2-10 (05/11/2026), questions Q1, Q2 and Q3 of verifier_policy_vectors.json, which is not changed and keeps its omitted cases as history. Each case gives the exact policy and verification_time, the bundle (a base in bundles, or a variant: a base with mutations applied) and the verdict; a negative counts only if its controls verified in the same run. Every base is routine, so requested_mode is also the effective mode. A contract /2 run judges the verdict only: warnings are diagnostics, and allow_classical_fallback_disable changes a warning, never a verdict.',
  _generator: 'tests/interop/v2/generate-verifier-policy-clarification-vectors.mjs',
  _keys: 'The bases are committed elsewhere and bound by the sha256 of their JSON.stringify text. The Q2 variants re-sign only the PQ component, with the committed TEST-ONLY ML-DSA-65 key of tests/interop/v2/interop_vectors.json#test_keys; the scope variants change one value and keep every signature byte.',
  _randomness: 'ML-DSA-65 signatures are hedged, so regeneration is not byte-identical. The committed file is the artifact.',
  verification_time: P.verification_time,
  base_policy: P.base_policy,
  requested_mode_policy: 'base_policy with default_mode and risk_overrides.low, .medium and .high all set to the requested mode, then policy_overrides.',
  bundles,
  variants,
  cases,
};
writeFileSync(OUTPUT, JSON.stringify(corpus, null, 2) + '\n');
console.log(`wrote ${OUTPUT}: ${cases.length} cases, ${Object.keys(variants).length} variants`);
