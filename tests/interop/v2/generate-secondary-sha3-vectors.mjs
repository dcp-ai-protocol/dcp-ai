#!/usr/bin/env node
// Writes tests/interop/v2/secondary_sha3_vectors.json: signed V2 bundles that check the secondary SHA3-256 fields
// (spec/VERIFICATION.md V2-11 and its 27/10/2026 erratum) layer by layer.
//
// Every case is a whole signed bundle. The four artifacts (RPR, passport, intent, policy decision) and the keys are
// shared in `base`; a case carries its own audit_entries, manifest and bundle signature, and is assembled as
//   { bundle: { dcp_bundle_version: "2.0", manifest, ...base.artifacts, audit_entries }, signature }.
// Entries are built in order, so every primary prev_hash, every secondary link that is not the deliberate defect, the
// primary root and the secondary root (when present and not the defect) are computed over the entries as carried, and
// the manifest is signed again. A rejected case therefore differs from an accepted one only in its secondary defect;
// its `control` (the same plan with every secondary field removed, primary chain and root recomputed, signed again)
// MUST verify.
//
// Run from the repository root after building the TypeScript SDK (sdks/typescript: npm run build):
//   node tests/interop/v2/generate-secondary-sha3-vectors.mjs
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import {
  AlgorithmRegistry, Ed25519Provider, MlDsa65Provider, DCP_CONTEXTS, canonicalizeV2, compositeSign, preparePayload,
  signBundleV2,
} from '../../../sdks/typescript/dist/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'secondary_sha3_vectors.json');

const registry = new AlgorithmRegistry();
const ed25519 = new Ed25519Provider();
const mlDsa65 = new MlDsa65Provider();
registry.registerSigner(ed25519);
registry.registerSigner(mlDsa65);

// Hashing here is written independently of the SDK verifiers.
const hex = (alg, bytes) => crypto.createHash(alg).update(bytes).digest('hex');
const canon = (obj) => Buffer.from(canonicalizeV2(obj), 'utf8');
const sha256Of = (obj) => `sha256:${hex('sha256', canon(obj))}`;
const sha3Of = (obj) => `sha3-256:${hex('sha3-256', canon(obj))}`;
function merkle(alg, entries) {
  if (entries.length === 0) return '0'.repeat(64);
  let layer = entries.map((e) => hex(alg, canon(e)));
  while (layer.length > 1) {
    if (layer.length % 2 === 1) layer.push(layer[layer.length - 1]);
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      next.push(hex(alg, Buffer.concat([Buffer.from(layer[i], 'hex'), Buffer.from(layer[i + 1], 'hex')])));
    }
    layer = next;
  }
  return layer[0];
}

async function keypair() {
  const c = await ed25519.generateKeypair();
  const p = await mlDsa65.generateKeypair();
  return {
    classical: { kid: c.kid, alg: 'ed25519', secretKeyB64: c.secretKeyB64, publicKeyB64: c.publicKeyB64 },
    pq: { kid: p.kid, alg: 'ml-dsa-65', secretKeyB64: p.secretKeyB64, publicKeyB64: p.publicKeyB64 },
  };
}
const keyEntries = (k, expiresAt = null) => [k.classical, k.pq].map((x) => ({
  kid: x.kid, alg: x.alg, public_key_b64: x.publicKeyB64, created_at: '2026-10-21T00:00:00Z', expires_at: expiresAt,
  status: 'active',
}));
async function sign(payload, context, keys) {
  const { canonicalBytes, payloadHash } = preparePayload(payload);
  return { payload, payload_hash: payloadHash, composite_sig: await compositeSign(registry, context, canonicalBytes, keys) };
}

const principal = await keypair();
const agent = await keypair();
const nonce = crypto.createHash('sha256').update('dcp-ai secondary sha3 vectors').digest('hex');

const rpr = {
  dcp_version: '2.0', human_id: 'human:secondary-principal', session_nonce: nonce, legal_name: 'Secondary Principal',
  entity_type: 'natural_person', jurisdiction: 'US-CA', liability_mode: 'owner_responsible', override_rights: true,
  issued_at: '2026-10-21T00:00:00Z', expires_at: null, contact: null, binding_keys: keyEntries(principal),
};
const passport = {
  dcp_version: '2.0', agent_id: 'agent:secondary-bot', session_nonce: nonce,
  keys: keyEntries(agent, '2099-12-31T23:59:59Z'), principal_binding_reference: rpr.human_id,
  capabilities: ['browse', 'api_call'], risk_tier: 'medium', created_at: '2026-10-21T00:00:00Z', status: 'active',
};
const intent = {
  dcp_version: '2.0', intent_id: 'intent:secondary-001', session_nonce: nonce, agent_id: passport.agent_id,
  human_id: rpr.human_id, timestamp: '2026-10-21T12:00:00Z', action_type: 'send_email',
  target: { channel: 'email', to: 'bob@example.com', domain: 'example.com' }, data_classes: ['contact_info'],
  estimated_impact: 'medium', requires_consent: false,
};
const policyDecision = {
  dcp_version: '2.0', intent_id: intent.intent_id, session_nonce: nonce, decision: 'approve', risk_score: 450,
  reasons: ['Known recipient domain'], required_confirmation: null, applied_policy_hash: sha256Of({ policy: 'default' }),
  timestamp: '2026-10-21T12:00:01Z',
};
const artifacts = {
  responsible_principal_record: await sign(rpr, DCP_CONTEXTS.ResponsiblePrincipal, principal),
  agent_passport: await sign(passport, DCP_CONTEXTS.AgentPassport, agent),
  intent: await sign(intent, DCP_CONTEXTS.Intent, agent),
  policy_decision: await sign(policyDecision, DCP_CONTEXTS.PolicyDecision, agent),
};

/**
 * A plan: n entries; chain[i] and intent[i] are 'absent' | 'ok' | { value } | { over: (entries, i) => object };
 * root is 'absent' | 'ok' | { value }; entryHashAlg and dual (signature hash_alg) are declarative.
 */
function entriesFor(plan) {
  const out = [];
  for (let i = 0; i < plan.n; i++) {
    const e = {
      dcp_version: '2.0', audit_id: `audit:secondary-${String(i).padStart(3, '0')}`, session_nonce: nonce,
      prev_hash: i === 0 ? 'GENESIS' : sha256Of(out[i - 1]), hash_alg: plan.entryHashAlg ?? 'sha256',
      timestamp: `2026-10-21T12:${String(10 + i).padStart(2, '0')}:00Z`, agent_id: passport.agent_id,
      human_id: rpr.human_id, intent_id: intent.intent_id, intent_hash: sha256Of(intent), policy_decision: 'approved',
      outcome: `step-${i}`, evidence: { tool: 'smtp', result_ref: null, evidence_hash: null }, pq_checkpoint_ref: null,
    };
    const c = plan.chain?.[i] ?? 'absent';
    if (c === 'ok') e.prev_hash_secondary = i === 0 ? 'GENESIS' : sha3Of(out[i - 1]);
    else if (c !== 'absent' && 'value' in c) e.prev_hash_secondary = c.value;
    else if (c !== 'absent' && 'over' in c) e.prev_hash_secondary = sha3Of(c.over(out, i));
    const t = plan.intent?.[i] ?? 'absent';
    if (t === 'ok') e.intent_hash_secondary = sha3Of(intent);
    else if (t !== 'absent') e.intent_hash_secondary = t.value;
    out.push(e);
  }
  return out;
}

async function bundleFor(plan) {
  const entries = entriesFor(plan);
  const manifest = {
    session_nonce: nonce,
    rpr_hash: artifacts.responsible_principal_record.payload_hash,
    passport_hash: artifacts.agent_passport.payload_hash,
    intent_hash: artifacts.intent.payload_hash,
    policy_hash: artifacts.policy_decision.payload_hash,
    audit_merkle_root: `sha256:${merkle('sha256', entries)}`,
    audit_count: entries.length,
    canonicalization_profile: 'dcp-jcs-v1',
  };
  const root = plan.root ?? 'absent';
  if (root === 'ok') manifest.audit_merkle_root_secondary = `sha3-256:${merkle('sha3-256', entries)}`;
  else if (root !== 'absent') manifest.audit_merkle_root_secondary = root.value;
  const bundle = { dcp_bundle_version: '2.0', manifest, ...structuredClone(artifacts), audit_entries: entries };
  const signed = await signBundleV2(bundle, {
    registry, signerType: 'human', signerId: rpr.human_id, keys: principal, dualHash: plan.dual ?? false,
  });
  signed.signature.created_at = '2026-10-21T12:30:00Z';
  return { audit_entries: signed.bundle.audit_entries, manifest: signed.bundle.manifest, signature: signed.signature };
}

const all = (n, v) => Array.from({ length: n }, () => v);
const without = (obj, key) => { const { [key]: _drop, ...rest } = obj; return rest; };
const H64 = 'ab'.repeat(32);

// [name, group, plan, expect, token]
const CASES = [
  // Positives: root
  ...[0, 1, 2, 3, 5, 8].map((n) => [`root_ok_${n}_entries`, 'root', { n, root: 'ok', dual: true }, 'accept']),
  ['root_absent_sha256_only', 'root', { n: 3 }, 'accept'],
  // Positives: chain
  ['chain_generator_form_entry0_absent', 'chain', { n: 3, chain: ['absent', 'ok', 'ok'] }, 'accept'],
  ['chain_openclaw_form_genesis', 'chain', { n: 3, chain: all(3, 'ok'), entryHashAlg: 'sha256+sha3-256' }, 'accept'],
  ['chain_single_entry_genesis', 'chain', { n: 1, chain: ['ok'] }, 'accept'],
  ['chain_only_genesis_of_several', 'chain', { n: 4, chain: ['ok'] }, 'accept'],
  ['chain_only_last_link', 'chain', { n: 4, chain: ['absent', 'absent', 'absent', 'ok'] }, 'accept'],
  ['chain_gap_in_middle', 'chain', { n: 5, chain: ['ok', 'ok', 'absent', 'ok', 'ok'] }, 'accept'],
  ['chain_link_over_previous_without_secondary', 'chain', { n: 3, chain: ['ok', 'absent', 'ok'] }, 'accept'],
  ['chain_all_absent', 'chain', { n: 4 }, 'accept'],
  // Positives: mixed and hash_alg
  ['mixed_root_only_builder_form', 'mixed', { n: 3, root: 'ok' }, 'accept'],
  ['mixed_chain_only', 'mixed', { n: 3, chain: all(3, 'ok') }, 'accept'],
  ['mixed_intent_only', 'mixed', { n: 3, intent: all(3, 'ok') }, 'accept'],
  ['mixed_intent_on_one_entry', 'mixed', { n: 3, intent: ['absent', 'ok', 'absent'] }, 'accept'],
  ['mixed_all_three', 'mixed', { n: 5, root: 'ok', chain: all(5, 'ok'), intent: all(5, 'ok'), dual: true, entryHashAlg: 'sha256+sha3-256' }, 'accept'],
  ['hash_alg_dual_without_fields', 'mixed', { n: 3, dual: true, entryHashAlg: 'sha256+sha3-256' }, 'accept'],
  ['hash_alg_sha256_with_all_fields', 'mixed', { n: 3, root: 'ok', chain: all(3, 'ok'), intent: all(3, 'ok') }, 'accept'],
  // Negatives: root
  ['root_wrong_value', 'root', { n: 3, root: { value: `sha3-256:${H64}` } }, 'reject', 'audit_merkle_root_secondary'],
  ['root_over_reordered_entries', 'root', { n: 3, root: { value: null }, rootOver: (es) => [es[1], es[0], es[2]] }, 'reject', 'audit_merkle_root_secondary'],
  ['root_without_odd_duplication', 'root', { n: 3, root: { value: null }, rootNoDup: true }, 'reject', 'audit_merkle_root_secondary'],
  ['root_sha256_tree_under_sha3_prefix', 'root', { n: 3, root: { value: null }, rootSha256: true }, 'reject', 'audit_merkle_root_secondary'],
  ['root_zeros_on_non_empty_trail', 'root', { n: 2, root: { value: `sha3-256:${'0'.repeat(64)}` } }, 'reject', 'audit_merkle_root_secondary'],
  ['root_non_zero_on_empty_trail', 'root', { n: 0, root: { value: `sha3-256:${H64}` } }, 'reject', 'audit_merkle_root_secondary'],
  ['root_null', 'root', { n: 2, root: { value: null } }, 'reject', 'audit_merkle_root_secondary'],
  ['root_number', 'root', { n: 2, root: { value: 7 } }, 'reject', 'audit_merkle_root_secondary'],
  ['root_uppercase_hex', 'root', { n: 2, root: { value: null }, rootUpper: true }, 'reject', 'audit_merkle_root_secondary'],
  ['root_sha256_prefix', 'root', { n: 2, root: { value: null }, rootPrefix: 'sha256:' }, 'reject', 'audit_merkle_root_secondary'],
  ['root_63_hex', 'root', { n: 2, root: { value: null }, rootTrim: true }, 'reject', 'audit_merkle_root_secondary'],
  // Negatives: chain
  ['chain_wrong_link_at_1', 'chain', { n: 3, chain: ['ok', { value: `sha3-256:${H64}` }, 'ok'] }, 'reject', 'prev_hash_secondary'],
  ['chain_wrong_link_at_last', 'chain', { n: 4, chain: ['ok', 'ok', 'ok', { value: `sha3-256:${H64}` }] }, 'reject', 'prev_hash_secondary'],
  ['chain_link_over_previous_without_its_secondary', 'chain', { n: 3, chain: ['ok', 'ok', { over: (es, i) => without(es[i - 1], 'prev_hash_secondary') }] }, 'reject', 'prev_hash_secondary'],
  ['chain_link_over_entry_before_previous', 'chain', { n: 3, chain: ['ok', 'absent', { over: (es) => es[0] }] }, 'reject', 'prev_hash_secondary'],
  ['chain_genesis_after_first', 'chain', { n: 3, chain: ['ok', { value: 'GENESIS' }, 'ok'] }, 'reject', 'prev_hash_secondary'],
  ['chain_entry0_hash_instead_of_genesis', 'chain', { n: 2, chain: [{ value: `sha3-256:${H64}` }, 'ok'] }, 'reject', 'prev_hash_secondary'],
  ['chain_null', 'chain', { n: 2, chain: ['ok', { value: null }] }, 'reject', 'prev_hash_secondary'],
  ['chain_null_on_entry0', 'chain', { n: 2, chain: [{ value: null }, 'ok'] }, 'reject', 'prev_hash_secondary'],
  ['chain_number', 'chain', { n: 2, chain: ['ok', { value: 1 }] }, 'reject', 'prev_hash_secondary'],
  ['chain_uppercase_hex', 'chain', { n: 2, chain: ['ok', { upper: true }] }, 'reject', 'prev_hash_secondary'],
  ['chain_sha256_prefix', 'chain', { n: 2, chain: ['ok', { prefix: 'sha256:' }] }, 'reject', 'prev_hash_secondary'],
  ['chain_lowercase_genesis', 'chain', { n: 2, chain: [{ value: 'genesis' }, 'ok'] }, 'reject', 'prev_hash_secondary'],
  // Negatives: intent
  ['intent_wrong_value', 'intent', { n: 2, intent: ['ok', { value: `sha3-256:${H64}` }] }, 'reject', 'intent_hash_secondary'],
  ['intent_sha256_digest_under_sha3_prefix', 'intent', { n: 2, intent: [{ value: `sha3-256:${hex('sha256', canon(intent))}` }, 'ok'] }, 'reject', 'intent_hash_secondary'],
  ['intent_over_signed_intent_envelope', 'intent', { n: 2, intent: [{ value: sha3Of(artifacts.intent) }, 'absent'] }, 'reject', 'intent_hash_secondary'],
  ['intent_null', 'intent', { n: 2, intent: [{ value: null }, 'absent'] }, 'reject', 'intent_hash_secondary'],
  ['intent_number', 'intent', { n: 2, intent: ['absent', { value: 3 }] }, 'reject', 'intent_hash_secondary'],
  ['intent_on_one_entry_of_several', 'intent', { n: 4, intent: ['ok', 'ok', { value: `sha3-256:${H64}` }, 'ok'] }, 'reject', 'intent_hash_secondary'],
];

// Plans whose defect depends on the final entries: computed values, transformed from the correct one.
function resolve(plan) {
  const p = { ...plan };
  const entries = entriesFor({ ...p, root: 'absent' });
  const goodRoot = merkle('sha3-256', entries);
  if (p.rootOver) p.root = { value: `sha3-256:${merkle('sha3-256', p.rootOver(entries))}` };
  if (p.rootNoDup) {
    const leaves = entries.map((e) => hex('sha3-256', canon(e)));
    const pair = hex('sha3-256', Buffer.concat([Buffer.from(leaves[0], 'hex'), Buffer.from(leaves[1], 'hex')]));
    p.root = { value: `sha3-256:${hex('sha3-256', Buffer.concat([Buffer.from(pair, 'hex'), Buffer.from(leaves[2], 'hex')]))}` };
  }
  if (p.rootSha256) p.root = { value: `sha3-256:${merkle('sha256', entries)}` };
  if (p.rootUpper) p.root = { value: `sha3-256:${goodRoot.toUpperCase()}` };
  if (p.rootPrefix) p.root = { value: `${p.rootPrefix}${goodRoot}` };
  if (p.rootTrim) p.root = { value: `sha3-256:${goodRoot.slice(0, 63)}` };
  if (p.chain) {
    p.chain = p.chain.map((c, i) => {
      if (c?.upper) return { value: sha3Of(entriesFor(p)[i - 1]).toUpperCase().replace('SHA3-256:', 'sha3-256:') };
      if (c?.prefix) return { value: `${c.prefix}${sha3Of(entriesFor(p)[i - 1]).slice('sha3-256:'.length)}` };
      return c;
    });
  }
  return p;
}
const strip = (plan) => ({ n: plan.n, entryHashAlg: plan.entryHashAlg, dual: plan.dual });

const cases = [];
for (const [name, group, plan, expect, token] of CASES) {
  const resolved = resolve(plan);
  const c = { name, group, expect, ...(await bundleFor(resolved)) };
  if (expect === 'reject') {
    c.error_contains = token;
    c.control = await bundleFor(strip(resolved));
  }
  // Self-checks of the generator: the primary chain and root are always right.
  for (const b of [c, c.control].filter(Boolean)) {
    b.audit_entries.forEach((e, i) => {
      if (e.prev_hash !== (i === 0 ? 'GENESIS' : sha256Of(b.audit_entries[i - 1]))) throw new Error(`${name}: primary chain`);
    });
    if (b.manifest.audit_merkle_root !== `sha256:${merkle('sha256', b.audit_entries)}`) throw new Error(`${name}: primary root`);
  }
  cases.push(c);
}
if (new Set(cases.map((c) => c.name)).size !== cases.length) throw new Error('duplicate case name');

const out = {
  _description:
    'Secondary SHA3-256 vectors (spec/VERIFICATION.md V2-11 and its erratum of 27/10/2026). Assemble each case as ' +
    '{ bundle: { dcp_bundle_version: "2.0", manifest, ...base.artifacts, audit_entries }, signature } and verify it ' +
    'with the default verifier policy at verification_time. expect "accept": it MUST verify. expect "reject": it MUST ' +
    'fail with an error that contains error_contains, and its control (the same entries without secondary fields, ' +
    'primary chain and root recomputed, signed again) MUST verify.',
  _generator: 'tests/interop/v2/generate-secondary-sha3-vectors.mjs',
  verification_time: '2026-10-22T00:00:00Z',
  base: { artifacts, principal_keys: keyEntries(principal), agent_keys: passport.keys },
  cases,
};
fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
console.log(`${cases.length} cases (${cases.filter((c) => c.expect === 'accept').length} accept, ${cases.filter((c) => c.expect === 'reject').length} reject) -> ${path.relative(process.cwd(), OUT)}`);
