// TEST ONLY synthetic material for the MP-05 rehearsal, produced with the installed @dcp-ai/sdk and its public API only.
//
//   node node/fixtures.mjs generate --out DIR      (from a staged kit inside the Node consumer; DIR outside any checkout)
//
// DIR/secrets/keys holds the private keys (0600 in 0700 directories). DIR/public holds only public, signed material and
// a manifest with the sha256 of every public file; DIR/oob holds the fingerprints a principal sends out of band. The
// generator never writes a trust set: keys enter one only through the operator tool (node/operator.mjs).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AlgorithmRegistry,
  BundleBuilderV2,
  DCP_CONTEXTS,
  Ed25519Provider,
  MlDsa65Provider,
  compositeSign,
  createAwarenessThreshold,
  createDelegationMandate,
  createMandateAcknowledgment,
  createSubMandate,
  generateSessionNonce,
  preparePayload,
  signBundleV2,
} from '@dcp-ai/sdk';
import {
  assertInstalledSdk,
  assertOutsideGit,
  iso,
  json,
  loadContract,
  loadScenario,
  readJson,
  sha256Hex,
  sha256Of,
  writeNew,
} from './common.mjs';

export const MATERIAL_FORMAT = 'dcp-ai-mp05-material-v1';
export const KEY_DOCUMENT_FORMAT = 'dcp-ai-mp05-principal-keys-v1';
/** Key sets and their owners: P rotates p-k1 to p-k2, A1 rotates a1-k1 to a1-k2. */
export const KEYSETS = {
  'p-k1': 'P',
  'p-k2': 'P',
  'q-k1': 'Q',
  'a0-k1': 'A0',
  'a1-k1': 'A1',
  'a1-k2': 'A1',
  'a2-k1': 'A2',
};
const SECONDARY_DOMAIN = 'billing.example.com';
const SESSION_MS = 300_000;

export function newRegistry() {
  const registry = new AlgorithmRegistry();
  registry.registerSigner(new Ed25519Provider());
  registry.registerSigner(new MlDsa65Provider());
  return registry;
}

async function newKeyset() {
  const c = await new Ed25519Provider().generateKeypair();
  const p = await new MlDsa65Provider().generateKeypair();
  return {
    classical: { kid: c.kid, alg: 'ed25519', secretKeyB64: c.secretKeyB64, publicKeyB64: c.publicKeyB64 },
    pq: { kid: p.kid, alg: 'ml-dsa-65', secretKeyB64: p.secretKeyB64, publicKeyB64: p.publicKeyB64 },
  };
}

const publicKeys = (ks) =>
  [ks.classical, ks.pq].map((k) => ({ kid: k.kid, alg: k.alg, public_key_b64: k.publicKeyB64 }));

export async function generate(out, { now = Date.now() } = {}) {
  assertInstalledSdk();
  assertOutsideGit(out);
  if (fs.existsSync(out) && fs.readdirSync(out).length > 0) throw new Error(`${out} is not empty`);
  const contract = loadContract();
  const scenario = loadScenario();
  const ids = { ...scenario.principals, ...scenario.agents };
  const registry = newRegistry();
  fs.mkdirSync(path.join(out, 'secrets', 'keys'), { recursive: true, mode: 0o700 });
  for (const d of ['secrets', path.join('secrets', 'keys')]) fs.chmodSync(path.join(out, d), 0o700);

  const files = {};
  const publish = (rel, text) => {
    writeNew(path.join(out, rel), text);
    files[rel] = sha256Hex(text);
  };

  const keys = {};
  for (const name of Object.keys(KEYSETS)) keys[name] = await newKeyset();
  for (const [name, ks] of Object.entries(keys)) {
    const secret = { test_only: true, keyset: name, owner: KEYSETS[name], ...ks };
    writeNew(path.join(out, 'secrets', 'keys', `${name}.json`), json(secret), 0o600);
    publish(`public/keysets/${name}.json`, json({ keyset: name, owner: KEYSETS[name], keys: publicKeys(ks) }));
  }
  for (const name of ['p-k1', 'p-k2', 'q-k1']) {
    const doc = { key_document_format: KEY_DOCUMENT_FORMAT, human_id: ids[KEYSETS[name]], keys: publicKeys(keys[name]) };
    publish(`public/principals/${name}.keys.json`, json(doc));
    publish(`oob/${name}.fingerprint`, `${sha256Of(doc)}\n`);
  }

  // Mandates, awareness thresholds and acknowledgments. Order matters (acknowledgment design § 6, T5): an agent
  // acknowledges a mandate before any sub-mandate below it is issued.
  const valid_from = iso(now - 60_000);
  const valid_until = iso(now + 7 * 86_400_000);
  const D = contract.domain;
  const CC = 'company_confidential';
  const FD = 'financial_data';
  const entry = (domain, actions, classes, max) => ({
    domain,
    actions_permitted: actions,
    data_classes: classes,
    limits: { max_amount: max },
  });
  const ROOT_SCOPE = [entry(D, ['quote', 'order', 'refund'], [CC, FD], 10000), entry(SECONDARY_DOMAIN, ['quote'], [CC], 10000)];
  const LEAF_SCOPE = [entry(D, ['quote', 'order'], [CC, FD], 5000)];
  const mandates = {};
  const thresholds = {};
  const acks = {};
  const root = async (name, id, keyset, authority_scope) => {
    mandates[name] = await createDelegationMandate(registry, keys[keyset], {
      mandate_id: id,
      session_nonce: generateSessionNonce(),
      human_id: ids.P,
      agent_id: ids.A1,
      authority_scope,
      valid_from,
      valid_until,
      revocable: true,
      sub_delegation: { permitted: true, max_depth: 1 },
    });
  };
  const sub = async (name, id, parent, keyset, authority_scope, window = {}) => {
    mandates[name] = await createSubMandate(registry, keys[keyset], mandates[parent], {
      mandate_id: id,
      session_nonce: generateSessionNonce(),
      agent_id: ids.A2,
      authority_scope,
      valid_from,
      valid_until,
      revocable: true,
      ...window,
    });
  };
  const acknowledge = async (name, chain, keyset) => {
    const m = mandates[chain.at(-1)];
    thresholds[name] = await createAwarenessThreshold(registry, keys[keyset], {
      threshold_id: `threshold:mp05-${name}`,
      session_nonce: m.session_nonce,
      agent_id: m.agent_id,
      human_id: m.human_id,
      threshold_rules: [{ dimension: 'amount', operator: 'gt', value: 5000, action_if_triggered: 'escalate' }],
    });
    acks[name] = await createMandateAcknowledgment(registry, keys[keyset], {
      mandateChain: chain.map((n) => mandates[n]),
      awarenessThreshold: thresholds[name],
      acknowledgmentId: `ack:mp05-${name}`,
    });
  };

  // P → A1 → A2, and the leaf variants of design § 2.6, all below m1.
  await root('m1', 'mandate:mp05-m1', 'p-k1', ROOT_SCOPE);
  await acknowledge('m1', ['m1'], 'a1-k1');
  await sub('m2', 'mandate:mp05-m2', 'm1', 'a1-k1', LEAF_SCOPE);
  await sub('m2_dom', 'mandate:mp05-m2-dom', 'm1', 'a1-k1', [entry(SECONDARY_DOMAIN, ['quote'], [CC], 5000)]);
  await sub('m2_dc', 'mandate:mp05-m2-dc', 'm1', 'a1-k1', [entry(D, ['quote', 'order'], [CC], 5000)]);
  await sub('m2_q', 'mandate:mp05-m2-q', 'm1', 'a1-k1', [entry(D, ['quote'], [CC, FD], 5000)]);
  await sub('m2_r', 'mandate:mp05-m2-r', 'm1', 'a1-k1', [entry(D, ['quote', 'order', 'refund'], [CC, FD], 5000)]);
  await sub('m2_expired', 'mandate:mp05-m2-expired', 'm1', 'a1-k1', LEAF_SCOPE, { valid_until: iso(now - 1_000) });
  await sub('m2_future', 'mandate:mp05-m2-future', 'm1', 'a1-k1', LEAF_SCOPE, { valid_from: iso(now + 86_400_000) });
  for (const n of ['m2', 'm2_dom', 'm2_dc', 'm2_q', 'm2_r']) await acknowledge(n, ['m1', n], 'a2-k1');
  // A2's acknowledgment of m2, signed with A1's keys (G7: ACK_KEY_UNKNOWN).
  acks.m2_by_a1 = await createMandateAcknowledgment(registry, keys['a1-k1'], {
    mandateChain: [mandates.m1, mandates.m2],
    awarenessThreshold: thresholds.m2,
    acknowledgmentId: 'ack:mp05-m2_by_a1',
  });
  // A root with a lower max_amount. DCP-09 § 3.5.2 rule 5 (attenuation, checked by the SDK): a sub-mandate keeps every
  // limits key of its parent with a numeric value not greater. m2_low (equal) is valid; m2_looser (5000 > 3000) is not.
  await root('m1_low', 'mandate:mp05-m1-low', 'p-k1', [entry(D, ['quote', 'order'], [CC, FD], 3000)]);
  await acknowledge('m1_low', ['m1_low'], 'a1-k1');
  await sub('m2_low', 'mandate:mp05-m2-low', 'm1_low', 'a1-k1', [entry(D, ['quote', 'order'], [CC, FD], 3000)]);
  await sub('m2_looser', 'mandate:mp05-m2-looser', 'm1_low', 'a1-k1', LEAF_SCOPE);
  await acknowledge('m2_low', ['m1_low', 'm2_low'], 'a2-k1');
  // Principal rotation: m1 re-issued with p-k2 under the same id. Its hash changes, so the chain_hash of every
  // acknowledgment below changes too: A1 acknowledges again, m2 is re-issued after that (T5) and A2 acknowledges again,
  // although neither agent rotates.
  await root('m1_k2', 'mandate:mp05-m1', 'p-k2', ROOT_SCOPE);
  await acknowledge('m1_k2', ['m1_k2'], 'a1-k1');
  await sub('m2_k2', 'mandate:mp05-m2', 'm1_k2', 'a1-k1', LEAF_SCOPE);
  await acknowledge('m2_k2', ['m1_k2', 'm2_k2'], 'a2-k1');
  // Agent rotation: A1's new keys sign a new awareness threshold and acknowledgment of m1, then a new m2, which A2
  // acknowledges again; re-signing m2 alone would leave the old acknowledgments in the chain.
  await acknowledge('m1_a1k2', ['m1'], 'a1-k2');
  await sub('m2_a1k2', 'mandate:mp05-m2', 'm1', 'a1-k2', LEAF_SCOPE);
  await acknowledge('m2_a1k2', ['m1', 'm2_a1k2'], 'a2-k1');

  const spec = (chain, acknowledged, a1 = 'a1-k1', principal = 'p-k1') => ({
    chain,
    acknowledgments: acknowledged,
    awareness_thresholds: acknowledged,
    leaf: { agent: 'A2', keyset: 'a2-k1' },
    delegators: [{ agent: 'A1', keyset: a1 }],
    principal: { name: 'P', keyset: principal },
  });
  const chains = {
    valid: spec(['m1', 'm2'], ['m1', 'm2']),
    dom: spec(['m1', 'm2_dom'], ['m1', 'm2_dom']),
    dc: spec(['m1', 'm2_dc'], ['m1', 'm2_dc']),
    q: spec(['m1', 'm2_q'], ['m1', 'm2_q']),
    r: spec(['m1', 'm2_r'], ['m1', 'm2_r']),
    low: spec(['m1_low', 'm2_low'], ['m1_low', 'm2_low']),
    looser: spec(['m1_low', 'm2_looser'], ['m1_low']),
    expired: spec(['m1', 'm2_expired'], ['m1']),
    future: spec(['m1', 'm2_future'], ['m1']),
    rot_principal: spec(['m1_k2', 'm2_k2'], ['m1_k2', 'm2_k2'], 'a1-k1', 'p-k2'),
    rot_agent: spec(['m1', 'm2_a1k2'], ['m1_a1k2', 'm2_a1k2'], 'a1-k2'),
  };
  for (const [n, v] of Object.entries(mandates)) publish(`public/mandates/${n}.json`, json(v));
  for (const [n, v] of Object.entries(thresholds)) publish(`public/thresholds/${n}.json`, json(v));
  for (const [n, v] of Object.entries(acks)) publish(`public/acks/${n}.json`, json(v));
  publish('public/chains.json', json(chains));

  const manifest = {
    material_format: MATERIAL_FORMAT,
    test_only: true,
    contract_version: contract.contract_version,
    scenario_version: scenario.scenario_version,
    created_at: iso(now),
    identities: ids,
    keysets: Object.fromEntries(
      Object.entries(keys).map(([n, ks]) => [n, { owner: KEYSETS[n], kids: [ks.classical.kid, ks.pq.kid] }]),
    ),
    files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1))),
  };
  writeNew(path.join(out, 'public', 'manifest.json'), json(manifest));
  return manifest;
}

/** Loads generated material and checks every public file against the manifest. */
export function loadMaterial(dir) {
  const manifest = readJson(path.join(dir, 'public', 'manifest.json'));
  if (manifest.material_format !== MATERIAL_FORMAT) throw new Error(`${dir} is not rehearsal material`);
  for (const [rel, digest] of Object.entries(manifest.files)) {
    if (path.isAbsolute(rel) || rel.split('/').includes('..')) throw new Error(`manifest path ${rel}`);
    if (sha256Hex(fs.readFileSync(path.join(dir, rel))) !== digest) throw new Error(`${rel} does not match the manifest`);
  }
  const group = (sub) =>
    Object.fromEntries(
      Object.keys(manifest.files)
        .filter((rel) => rel.startsWith(`public/${sub}/`))
        .map((rel) => [path.basename(rel, '.json'), readJson(path.join(dir, rel))]),
    );
  return {
    dir,
    manifest,
    chains: readJson(path.join(dir, 'public', 'chains.json')),
    mandates: group('mandates'),
    thresholds: group('thresholds'),
    acks: group('acks'),
    keysets: group('keysets'),
    secret: (name) => readJson(path.join(dir, 'secrets', 'keys', `${name}.json`)),
  };
}

/**
 * A bundle signed now, with a session of 300 s. The principal signs the RPR and the bundle; the agent signs its
 * passport, the intent and the policy decision. With `action`, the intent carries the rehearsal binding
 * (target.x_rehearsal) for `args` on `route`; without it, a neutral intent for a delegator bundle. `intent` and
 * `manifest` overwrite members, for negative cases.
 */
export async function signAgentBundle(material, registry, o) {
  const contract = loadContract();
  const ids = material.manifest.identities;
  const principal = o.principal ?? 'P';
  const humanId = ids[principal];
  const agentId = ids[o.agent];
  const issued = (o.now ?? Date.now()) - 5_000;
  const nonce = generateSessionNonce();
  const composite = (name) => {
    const s = material.secret(name);
    return { classical: s.classical, pq: s.pq };
  };
  const principalKeys = composite(o.principalKeyset ?? 'p-k1');
  const agentKeys = composite(o.keyset);
  const entries = (names) =>
    names.flatMap((n) =>
      material.keysets[n].keys.map((k) => ({ ...k, created_at: material.manifest.created_at, expires_at: null, status: 'active' })),
    );
  const rpr = {
    dcp_version: '2.0',
    human_id: humanId,
    session_nonce: nonce,
    legal_name: `Synthetic principal ${principal} (TEST ONLY)`,
    entity_type: 'organization',
    jurisdiction: 'US-CA',
    liability_mode: 'owner_responsible',
    override_rights: true,
    issued_at: material.manifest.created_at,
    expires_at: null,
    contact: null,
    binding_keys: entries(o.bindings ?? Object.keys(KEYSETS).filter((n) => KEYSETS[n] === principal)),
  };
  const passport = {
    dcp_version: '2.0',
    agent_id: agentId,
    session_nonce: nonce,
    keys: entries(o.passport ?? [o.keyset]),
    principal_binding_reference: humanId,
    capabilities: ['api_call'],
    risk_tier: 'medium',
    created_at: material.manifest.created_at,
    status: 'active',
  };
  const base = {
    dcp_version: '2.0',
    intent_id: `intent:mp05-${crypto.randomUUID()}`,
    session_nonce: nonce,
    agent_id: agentId,
    human_id: humanId,
    timestamp: iso(issued + 1_000),
    estimated_impact: 'low',
    requires_consent: false,
  };
  let intent;
  if (o.action) {
    const a = contract.actions[o.action];
    const url = contract.routes[o.route ?? 'delegated'].path.replace('{action}', o.action);
    intent = {
      ...base,
      action_type: a.action_type,
      target: { channel: a.channel, domain: contract.domain, url, x_rehearsal: { action: o.action, args_sha256: sha256Of(o.args) } },
      data_classes: [...a.data_classes],
    };
  } else {
    intent = { ...base, action_type: 'api_call', target: { channel: 'api', domain: contract.domain, url: null }, data_classes: ['none'] };
  }
  Object.assign(intent, o.intent ?? {});
  const decision = {
    dcp_version: '2.0',
    intent_id: intent.intent_id,
    session_nonce: nonce,
    decision: 'approve',
    risk_score: 100,
    reasons: ['MP-05 rehearsal (TEST ONLY)'],
    required_confirmation: null,
    applied_policy_hash: sha256Of({ policy: 'mp05-rehearsal' }),
    timestamp: iso(issued + 2_000),
  };
  const audit = {
    dcp_version: '2.0',
    audit_id: `audit:mp05-${crypto.randomUUID()}`,
    session_nonce: nonce,
    prev_hash: 'GENESIS',
    hash_alg: 'sha256',
    timestamp: iso(issued + 3_000),
    agent_id: agentId,
    human_id: humanId,
    intent_id: intent.intent_id,
    intent_hash: sha256Of(intent),
    policy_decision: 'approved',
    outcome: 'api_called',
    evidence: { tool: 'http', result_ref: null, evidence_hash: null },
    pq_checkpoint_ref: null,
  };
  const sign = async (payload, context, keys) => {
    const { canonicalBytes, payloadHash } = preparePayload(payload);
    return { payload, payload_hash: payloadHash, composite_sig: await compositeSign(registry, context, canonicalBytes, keys) };
  };
  const bundle = new BundleBuilderV2(nonce)
    .responsiblePrincipalRecord(await sign(rpr, DCP_CONTEXTS.ResponsiblePrincipal, principalKeys))
    .agentPassport(await sign(passport, DCP_CONTEXTS.AgentPassport, agentKeys))
    .intent(await sign(intent, DCP_CONTEXTS.Intent, agentKeys))
    .policyDecision(await sign(decision, DCP_CONTEXTS.PolicyDecision, agentKeys))
    .addAuditEntries([audit])
    .build();
  Object.assign(
    bundle.manifest,
    { session_issued_at: iso(issued), session_expires_at: iso(issued + SESSION_MS), intended_verifier: contract.verifier_id },
    o.manifest ?? {},
  );
  return signBundleV2(bundle, { registry, signerType: 'organization', signerId: humanId, keys: principalKeys });
}

/**
 * The evidence of a named chain (public/chains.json) with fresh leaf and delegator bundles. `over` replaces members of
 * the chain spec (chain, acknowledgments, awareness_thresholds, delegators, principal) for negative cases; `leaf` is
 * passed to signAgentBundle for the leaf.
 */
export async function chainEvidence(material, registry, name, leaf, over = {}) {
  const c = { ...material.chains[name], ...over };
  const principalKeyset = c.principal.keyset;
  const delegatorBundles = [];
  for (const d of c.delegators) {
    delegatorBundles.push(await signAgentBundle(material, registry, { agent: d.agent, keyset: d.keyset, principalKeyset }));
  }
  const copy = (v) => structuredClone(v);
  return {
    signedBundle: await signAgentBundle(material, registry, { agent: c.leaf.agent, keyset: c.leaf.keyset, principalKeyset, ...leaf }),
    mandateChain: c.chain.map((n) => copy(material.mandates[n])),
    delegatorBundles,
    acknowledgments: c.acknowledgments.map((n) => copy(material.acks[n])),
    awarenessThresholds: c.awareness_thresholds.map((n) => copy(material.thresholds[n])),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--out');
  if (args[0] !== 'generate' || at < 0 || !args[at + 1]) {
    console.error('usage: node node/fixtures.mjs generate --out DIR');
    process.exit(2);
  }
  const out = path.resolve(args[at + 1]);
  const manifest = await generate(out);
  console.log(JSON.stringify({ status: 'generated', out, public_files: Object.keys(manifest.files).length, keysets: Object.keys(manifest.keysets) }));
}
