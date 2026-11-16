#!/usr/bin/env node
/**
 * Writes tests/interop/v2/audit_entry_roundtrip_vectors.json: V2 audit entries whose dcp-jcs-v1 text is written by
 * hand below (never computed here: the script only checks it against canonicalizeV2 and refuses to write on any
 * difference), and string_evidence_bundle, a signed bundle whose audit entries hold nothing the typed Rust and Go
 * structs lose (string evidence members, pq_checkpoint_ref null, no secondary or unknown member), with mutations
 * the SDK tests apply to it. The SDKs use them to check RawAuditEventV2 and to contrast their canonicalizers.
 * The entries are preservation and canonicalization data with simplified identifiers, timestamps and hashes, not
 * schema-validity vectors: schema_valid false marks a member the schema or the V2-11 erratum rejects, and its absence
 * does not attest schema validity. Only string_evidence_bundle carries a verification control.
 *
 * Keys are synthetic test keys from fixed seeds (sha256 of a label), so they are the same on every run. Ed25519
 * signatures are deterministic; ML-DSA-65 signatures are not (@noble/post-quantum hedges them with fresh entropy),
 * so a new run writes different PQ signature bytes, equally valid. The committed file is the artifact.
 *
 * Run: cd sdks/typescript && npm run build && node scripts/generate-audit-entry-roundtrip-vectors.mjs
 */
import { createHash } from 'crypto';
import { writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import nacl from 'tweetnacl';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import {
  AlgorithmRegistry, BundleBuilderV2, DCP_CONTEXTS, DEFAULT_VERIFIER_POLICY, Ed25519Provider, MlDsa65Provider,
  canonicalizeV2, compositeSign, deriveKid, preparePayload, sha256Hex, signBundleV2, verifySignedBundleV2,
} from '../dist/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(HERE, '../../../tests/interop/v2/audit_entry_roundtrip_vectors.json');
const VERIFICATION_TIME = '2026-10-22T00:00:00Z';
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const seed = (label) => createHash('sha256').update(`dcp-ai audit_entry_roundtrip ${label}`).digest();
const b64 = (bytes) => Buffer.from(bytes).toString('base64');

// ── Entries and their dcp-jcs-v1 text, by hand ─────────────────────
// Base members, sorted by Unicode code point as the profile requires.
const base = {
  agent_id: 'a', audit_id: 'x', dcp_version: '2.0', hash_alg: 'sha256', human_id: 'h', intent_hash: 'sha256:i',
  intent_id: 'i', outcome: 'o', policy_decision: 'approved', pq_checkpoint_ref: null, prev_hash: 'GENESIS',
  session_nonce: 'n', timestamp: 't',
};
const entry = (evidence, changes = {}) => {
  const e = { ...base, evidence, ...changes };
  for (const [k, v] of Object.entries(changes)) if (v === undefined) delete e[k];
  return e;
};

const ENTRIES = [
  { name: 'evidence_empty', entry: entry({}),
    canonical: '{"agent_id":"a","audit_id":"x","dcp_version":"2.0","evidence":{},"hash_alg":"sha256","human_id":"h","intent_hash":"sha256:i","intent_id":"i","outcome":"o","policy_decision":"approved","pq_checkpoint_ref":null,"prev_hash":"GENESIS","session_nonce":"n","timestamp":"t"}' },
  { name: 'evidence_all_null', entry: entry({ tool: null, result_ref: null, evidence_hash: null }),
    canonical: '{"agent_id":"a","audit_id":"x","dcp_version":"2.0","evidence":{"evidence_hash":null,"result_ref":null,"tool":null},"hash_alg":"sha256","human_id":"h","intent_hash":"sha256:i","intent_id":"i","outcome":"o","policy_decision":"approved","pq_checkpoint_ref":null,"prev_hash":"GENESIS","session_nonce":"n","timestamp":"t"}' },
  { name: 'evidence_null_and_absent', entry: entry({ tool: 'smtp', result_ref: null }),
    canonical: '{"agent_id":"a","audit_id":"x","dcp_version":"2.0","evidence":{"result_ref":null,"tool":"smtp"},"hash_alg":"sha256","human_id":"h","intent_hash":"sha256:i","intent_id":"i","outcome":"o","policy_decision":"approved","pq_checkpoint_ref":null,"prev_hash":"GENESIS","session_nonce":"n","timestamp":"t"}' },
  { name: 'evidence_all_strings', entry: entry({ tool: 'smtp', result_ref: 'r', evidence_hash: 'sha256:e' }),
    canonical: '{"agent_id":"a","audit_id":"x","dcp_version":"2.0","evidence":{"evidence_hash":"sha256:e","result_ref":"r","tool":"smtp"},"hash_alg":"sha256","human_id":"h","intent_hash":"sha256:i","intent_id":"i","outcome":"o","policy_decision":"approved","pq_checkpoint_ref":null,"prev_hash":"GENESIS","session_nonce":"n","timestamp":"t"}' },
  { name: 'evidence_extra_members', entry: entry({ tool: 'smtp', note: 'x', flag: null, nested: { b: [1, null, 'c'], a: {} }, list: [] }),
    canonical: '{"agent_id":"a","audit_id":"x","dcp_version":"2.0","evidence":{"flag":null,"list":[],"nested":{"a":{},"b":[1,null,"c"]},"note":"x","tool":"smtp"},"hash_alg":"sha256","human_id":"h","intent_hash":"sha256:i","intent_id":"i","outcome":"o","policy_decision":"approved","pq_checkpoint_ref":null,"prev_hash":"GENESIS","session_nonce":"n","timestamp":"t"}' },
  { name: 'pq_checkpoint_ref_string', entry: entry({}, { pq_checkpoint_ref: 'ckpt-1' }),
    canonical: '{"agent_id":"a","audit_id":"x","dcp_version":"2.0","evidence":{},"hash_alg":"sha256","human_id":"h","intent_hash":"sha256:i","intent_id":"i","outcome":"o","policy_decision":"approved","pq_checkpoint_ref":"ckpt-1","prev_hash":"GENESIS","session_nonce":"n","timestamp":"t"}' },
  { name: 'pq_checkpoint_ref_absent', schema_valid: false, entry: entry({}, { pq_checkpoint_ref: undefined }),
    canonical: '{"agent_id":"a","audit_id":"x","dcp_version":"2.0","evidence":{},"hash_alg":"sha256","human_id":"h","intent_hash":"sha256:i","intent_id":"i","outcome":"o","policy_decision":"approved","prev_hash":"GENESIS","session_nonce":"n","timestamp":"t"}' },
  { name: 'secondaries_with_values', entry: entry({}, { prev_hash_secondary: 'GENESIS', intent_hash_secondary: 'sha3-256:i' }),
    canonical: '{"agent_id":"a","audit_id":"x","dcp_version":"2.0","evidence":{},"hash_alg":"sha256","human_id":"h","intent_hash":"sha256:i","intent_hash_secondary":"sha3-256:i","intent_id":"i","outcome":"o","policy_decision":"approved","pq_checkpoint_ref":null,"prev_hash":"GENESIS","prev_hash_secondary":"GENESIS","session_nonce":"n","timestamp":"t"}' },
  { name: 'secondaries_null', schema_valid: false, entry: entry({}, { prev_hash_secondary: null, intent_hash_secondary: null }),
    canonical: '{"agent_id":"a","audit_id":"x","dcp_version":"2.0","evidence":{},"hash_alg":"sha256","human_id":"h","intent_hash":"sha256:i","intent_hash_secondary":null,"intent_id":"i","outcome":"o","policy_decision":"approved","pq_checkpoint_ref":null,"prev_hash":"GENESIS","prev_hash_secondary":null,"session_nonce":"n","timestamp":"t"}' },
  { name: 'unknown_entry_member', schema_valid: false, entry: entry({}, { zz_unknown: 'u' }),
    canonical: '{"agent_id":"a","audit_id":"x","dcp_version":"2.0","evidence":{},"hash_alg":"sha256","human_id":"h","intent_hash":"sha256:i","intent_id":"i","outcome":"o","policy_decision":"approved","pq_checkpoint_ref":null,"prev_hash":"GENESIS","session_nonce":"n","timestamp":"t","zz_unknown":"u"}' },
  { name: 'integers_at_safe_limits', entry: entry({ tool: 't', max: 9007199254740991, min: -9007199254740991, zero: 0 }),
    canonical: '{"agent_id":"a","audit_id":"x","dcp_version":"2.0","evidence":{"max":9007199254740991,"min":-9007199254740991,"tool":"t","zero":0},"hash_alg":"sha256","human_id":"h","intent_hash":"sha256:i","intent_id":"i","outcome":"o","policy_decision":"approved","pq_checkpoint_ref":null,"prev_hash":"GENESIS","session_nonce":"n","timestamp":"t"}' },
  { name: 'unicode_values', entry: entry({ tool: 'é', result_ref: '日本', evidence_hash: '😀' }),
    canonical: '{"agent_id":"a","audit_id":"x","dcp_version":"2.0","evidence":{"evidence_hash":"😀","result_ref":"日本","tool":"é"},"hash_alg":"sha256","human_id":"h","intent_hash":"sha256:i","intent_id":"i","outcome":"o","policy_decision":"approved","pq_checkpoint_ref":null,"prev_hash":"GENESIS","session_nonce":"n","timestamp":"t"}' },
  // Code point order: t (U+0074), ﬁ (U+FB01), 😀 (U+1F600). UTF-16 order would put 😀 (0xD83D…) before ﬁ (0xFB01).
  { name: 'unicode_key_order_by_code_point', entry: entry({ '😀': 'emoji', 'ﬁ': 'ligature', tool: 't' }),
    canonical: '{"agent_id":"a","audit_id":"x","dcp_version":"2.0","evidence":{"tool":"t","ﬁ":"ligature","😀":"emoji"},"hash_alg":"sha256","human_id":"h","intent_hash":"sha256:i","intent_id":"i","outcome":"o","policy_decision":"approved","pq_checkpoint_ref":null,"prev_hash":"GENESIS","session_nonce":"n","timestamp":"t"}' },
  // Given as text: whitespace, member order and escapes that dcp-jcs-v1 rewrites (é, A, \/), and the
  // escapes it keeps (\n, \u001f).
  { name: 'escapes_and_layout_rewritten',
    entry_json: '{ "timestamp": "t", "session_nonce": "n", "prev_hash": "GENESIS", "pq_checkpoint_ref": null,\n  "evidence": { "tool": "\\u00e9\\u0041\\/", "result_ref": "line\\nbreak\\u001f" },\n  "policy_decision": "approved", "outcome": "o", "intent_id": "i", "intent_hash": "sha256:i",\n  "human_id": "h", "hash_alg": "sha256", "dcp_version": "2.0", "audit_id": "x", "agent_id": "a" }',
    canonical: '{"agent_id":"a","audit_id":"x","dcp_version":"2.0","evidence":{"result_ref":"line\\nbreak\\u001f","tool":"éA/"},"hash_alg":"sha256","human_id":"h","intent_hash":"sha256:i","intent_id":"i","outcome":"o","policy_decision":"approved","pq_checkpoint_ref":null,"prev_hash":"GENESIS","session_nonce":"n","timestamp":"t"}' },
];

const entries = ENTRIES.map((c) => {
  const value = c.entry ?? JSON.parse(c.entry_json);
  const computed = canonicalizeV2(value);
  if (computed !== c.canonical) {
    throw new Error(`${c.name}: the hand-written canonical text differs from canonicalizeV2:\n  hand ${c.canonical}\n  TS   ${computed}`);
  }
  const { canonical, ...rest } = c;
  return { ...rest, canonical, canonical_sha256: sha256(canonical) };
});

// ── string_evidence_bundle: a signed bundle the typed structs keep intact ──
const registry = new AlgorithmRegistry();
registry.registerSigner(new Ed25519Provider());
registry.registerSigner(new MlDsa65Provider());

function keys(label) {
  const c = nacl.sign.keyPair.fromSeed(seed(`${label} ed25519`));
  const p = ml_dsa65.keygen(seed(`${label} ml-dsa-65`));
  return {
    classical: { kid: deriveKid('ed25519', c.publicKey), alg: 'ed25519', secretKeyB64: b64(c.secretKey), publicKeyB64: b64(c.publicKey) },
    pq: { kid: deriveKid('ml-dsa-65', p.publicKey), alg: 'ml-dsa-65', secretKeyB64: b64(p.secretKey), publicKeyB64: b64(p.publicKey) },
  };
}
const keyEntries = (k, expires) => [k.classical, k.pq].map((x) => ({
  kid: x.kid, alg: x.alg, public_key_b64: x.publicKeyB64, created_at: '2026-10-21T00:00:00Z', expires_at: expires, status: 'active',
}));
async function sign(payload, context, k) {
  const { canonicalBytes, payloadHash } = preparePayload(payload);
  return { payload, payload_hash: payloadHash, composite_sig: await compositeSign(registry, context, canonicalBytes, k) };
}
const hashOf = (obj) => `sha256:${sha256Hex(Buffer.from(canonicalizeV2(obj), 'utf8'))}`;

const principal = keys('principal');
const agent = keys('agent');
const nonce = createHash('sha256').update('dcp-ai audit_entry_roundtrip session').digest('hex');
const rpr = {
  dcp_version: '2.0', human_id: 'human:roundtrip-principal', session_nonce: nonce, legal_name: 'Roundtrip Principal',
  entity_type: 'natural_person', jurisdiction: 'US-CA', liability_mode: 'owner_responsible', override_rights: true,
  issued_at: '2026-10-21T00:00:00Z', expires_at: null, contact: null, binding_keys: keyEntries(principal, null),
};
const passport = {
  dcp_version: '2.0', agent_id: 'agent:roundtrip-bot', session_nonce: nonce, keys: keyEntries(agent, '2099-12-31T18:59:59-05:00'),
  principal_binding_reference: rpr.human_id, capabilities: ['browse', 'api_call'], risk_tier: 'medium',
  created_at: '2026-10-21T00:00:00Z', status: 'active',
};
const intent = {
  dcp_version: '2.0', intent_id: 'intent:roundtrip-001', session_nonce: nonce, agent_id: passport.agent_id, human_id: rpr.human_id,
  timestamp: '2026-10-21T12:00:00Z', action_type: 'send_email', target: { channel: 'email', to: 'bob@example.com', domain: 'example.com' },
  data_classes: ['contact_info'], estimated_impact: 'medium', requires_consent: false,
};
const policyDecision = {
  dcp_version: '2.0', intent_id: intent.intent_id, session_nonce: nonce, decision: 'approve', risk_score: 450,
  reasons: ['Known recipient domain'], required_confirmation: null, applied_policy_hash: hashOf({ policy: 'default' }),
  timestamp: '2026-10-21T12:00:01Z',
};
// Every evidence member is a string; pq_checkpoint_ref is null; no secondary and no unknown member.
const audit1 = {
  dcp_version: '2.0', audit_id: 'audit:roundtrip-001', session_nonce: nonce, prev_hash: 'GENESIS', hash_alg: 'sha256',
  timestamp: '2026-10-21T12:01:00Z', agent_id: passport.agent_id, human_id: rpr.human_id, intent_id: intent.intent_id,
  intent_hash: hashOf(intent), policy_decision: 'approved', outcome: 'email_sent',
  evidence: { tool: 'smtp', result_ref: 'msg:roundtrip-001', evidence_hash: hashOf({ message: 'roundtrip-001' }) },
  pq_checkpoint_ref: null,
};
const audit2 = {
  ...audit1, audit_id: 'audit:roundtrip-002', prev_hash: hashOf(audit1), timestamp: '2026-10-21T12:02:00Z',
  evidence: { tool: 'smtp', result_ref: 'msg:roundtrip-002', evidence_hash: hashOf({ message: 'roundtrip-002' }) },
};
const bundle = new BundleBuilderV2(nonce)
  .responsiblePrincipalRecord(await sign(rpr, DCP_CONTEXTS.ResponsiblePrincipal, principal))
  .agentPassport(await sign(passport, DCP_CONTEXTS.AgentPassport, agent))
  .intent(await sign(intent, DCP_CONTEXTS.Intent, agent))
  .policyDecision(await sign(policyDecision, DCP_CONTEXTS.PolicyDecision, agent))
  .addAuditEntries([audit1, audit2])
  .build();
Object.assign(bundle.manifest, { session_issued_at: '2026-10-21T00:00:00Z', session_expires_at: '2099-12-31T23:59:59+05:00' });
const signedBundle = await signBundleV2(bundle, { registry, signerType: 'human', signerId: rpr.human_id, keys: principal });
// created_at is outside the signed manifest; fixed so that only the ML-DSA-65 signature bytes differ between runs.
signedBundle.signature.created_at = '2026-10-21T12:03:00Z';

const check = await verifySignedBundleV2(signedBundle, registry, undefined, { now: Date.parse(VERIFICATION_TIME) });
if (!check.verified) throw new Error(`string_evidence_bundle does not verify: ${JSON.stringify(check.errors)}`);
for (const e of signedBundle.bundle.audit_entries) {
  const lossy = Object.values(e.evidence).some((v) => v === null) || 'prev_hash_secondary' in e || 'intent_hash_secondary' in e;
  if (lossy) throw new Error('string_evidence_bundle carries a member the typed structs lose');
}

const out = {
  _description: 'V2 audit entries for RawAuditEventV2 (Rust, Go) and canonicalizer contrast (TS, Python, Go, Rust). '
    + 'Each entry (or entry_json, given as text) has its dcp-jcs-v1 text, written by hand, and its SHA-256. '
    + 'The entries are preservation and canonicalization data with simplified identifiers, timestamps and hashes (a, t, sha256:i), not schema-validity vectors: '
    + 'schema_valid false marks an entry whose exercised member the audit_entry schema or the V2-11 erratum rejects (kept because a lossless type keeps invalid evidence too), '
    + 'and its absence does not attest schema validity. Only string_evidence_bundle carries a verification control. '
    + 'string_evidence_bundle verifies at verification_time under verifier_policy; its entries carry nothing the typed Rust and Go structs lose, '
    + 'so each mutation (set value at path, or delete it, in audit_entries[entry_index]) isolates one change.',
  _generator: 'sdks/typescript/scripts/generate-audit-entry-roundtrip-vectors.mjs',
  _randomness: 'Keys come from fixed seeds, Ed25519 signatures are deterministic and signature.created_at is fixed; ML-DSA-65 signatures are hedged with fresh entropy, so a new run writes different bytes in the five composite_sig.pq.sig_b64 members, and nowhere else. The committed file is the artifact.',
  entries,
  string_evidence_bundle: {
    verification_time: VERIFICATION_TIME,
    verifier_policy: DEFAULT_VERIFIER_POLICY,
    signed_bundle: signedBundle,
    mutations: [
      { name: 'prev_hash_secondary_null', entry_index: 0, op: 'set', path: ['prev_hash_secondary'], value: null },
      { name: 'intent_hash_secondary_null', entry_index: 0, op: 'set', path: ['intent_hash_secondary'], value: null },
      { name: 'pq_checkpoint_ref_removed', entry_index: 0, op: 'delete', path: ['pq_checkpoint_ref'] },
      { name: 'unknown_entry_member_added', entry_index: 0, op: 'set', path: ['zz_unknown'], value: 'u' },
      { name: 'evidence_member_added', entry_index: 0, op: 'set', path: ['evidence', 'note'], value: 'x' },
      { name: 'evidence_tool_nulled', entry_index: 0, op: 'set', path: ['evidence', 'tool'], value: null },
      { name: 'evidence_member_added_last_entry', entry_index: 1, op: 'set', path: ['evidence', 'note'], value: 'x' },
      { name: 'prev_hash_secondary_null_last_entry', entry_index: 1, op: 'set', path: ['prev_hash_secondary'], value: null },
    ],
  },
};
writeFileSync(OUTPUT, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${OUTPUT}: ${entries.length} entries, string_evidence_bundle verified, ${out.string_evidence_bundle.mutations.length} mutations`);
