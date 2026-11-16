// Conformance suites. Each suite reads fixtures from ctx.root and records one result per case id through
// ctx.check(id, fn): fn returns true (pass), a string (discrepancy) or throws (infrastructure error).
// Nothing here writes to disk, generates keys into the checkout or shells out.
import crypto from "crypto";
import { canonicalize, hashObject, dualHashObject, merkleRootFromHexLeaves, merkleRootForAuditEntries, intentHash } from "../merkle.js";
import { verifyObject, generateKeypair } from "../crypto.js";
import { admitSignedBundle, verifySignedBundle } from "../../lib/verify.js";
import { createPrincipalTrustStore, resolveStrictV1Profile } from "@dcp-ai/sdk";
import { buildV2Examples } from "../../scripts/generate-v2-examples.js";

export class ExpectationError extends Error {}

const EX = "tests/conformance/examples";
const GOLDEN = "tests/conformance/v2/golden_vectors.json";
const INTEROP = "tests/interop/v2/interop_vectors.json";
const ADMISSION = "tests/interop/v2/admission_vectors.json";
const SECONDARY = "tests/interop/v2/secondary_sha3_vectors.json";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const need = (cond, what) => { if (!cond) throw new ExpectationError(what); };
const sha = (alg, s) => crypto.createHash(alg).update(s, "utf8").digest("hex");
const same = (got, want, what) => got === want || `${what}: expected ${want}, got ${got}`;

function schemaCases(ctx, prefix, list) {
  for (const [id, schema, example] of list) {
    ctx.check(`${prefix}.${id}`, () => ctx.validate(schema, ctx.json(example)));
  }
}

// ── V1 ──────────────────────────────────────────────────────────

const V1_SCHEMAS = [
  ["responsible_principal_record", "schemas/v1/responsible_principal_record.schema.json", `${EX}/responsible_principal_record.json`],
  ["agent_passport", "schemas/v1/agent_passport.schema.json", `${EX}/agent_passport.json`],
  ["intent", "schemas/v1/intent.schema.json", `${EX}/intent.json`],
  ["policy_decision", "schemas/v1/policy_decision.schema.json", `${EX}/policy_decision.json`],
  ["audit_entry", "schemas/v1/audit_entry.schema.json", `${EX}/audit_entry.json`],
  ["citizenship_bundle", "schemas/v1/citizenship_bundle.schema.json", `${EX}/citizenship_bundle.json`],
  ["signed_bundle", "schemas/v1/signed_bundle.schema.json", `${EX}/citizenship_bundle.signed.json`],
];

function v1Schema(ctx) {
  schemaCases(ctx, "v1.schema", V1_SCHEMAS);
}

function chainCheck(bundle) {
  need(isObj(bundle?.intent) && Array.isArray(bundle?.audit_entries) && bundle.audit_entries.length > 0,
    "bundle needs an intent and a non-empty audit_entries array");
  const want = intentHash(bundle.intent);
  let prev = "GENESIS";
  for (const [i, entry] of bundle.audit_entries.entries()) {
    if (entry.intent_hash !== want) return `entry ${i} intent_hash: expected ${want}, got ${entry.intent_hash}`;
    if (entry.prev_hash !== prev) return `entry ${i} prev_hash: expected ${prev}, got ${entry.prev_hash}`;
    prev = hashObject(entry);
  }
  return true;
}

function v1Integrity(ctx) {
  const signed = ctx.json(`${EX}/citizenship_bundle.signed.json`);
  const golden = ctx.json(GOLDEN);
  const g = golden.v1_bundle_verification;
  need(isObj(g), "golden v1_bundle_verification must be an object");
  for (const k of ["public_key_b64", "expected_bundle_hash", "expected_merkle_root", "intent_hash"]) {
    need(typeof g[k] === "string", `golden v1_bundle_verification.${k} must be a string`);
  }
  need(Array.isArray(g.audit_entry_hashes) && Array.isArray(g.prev_hash_chain), "golden audit_entry_hashes and prev_hash_chain must be arrays");
  need(isObj(signed.bundle) && isObj(signed.signature), "signed fixture needs bundle and signature");
  const key = g.public_key_b64;

  ctx.check("v1.integrity.key_metadata_consistent", () => {
    const file = ctx.text("keys/public_key.txt").trim();
    if (signed.signature.signer?.public_key_b64 !== key) return "signed fixture signer.public_key_b64 differs from the golden public_key_b64";
    return same(file, key, "keys/public_key.txt");
  });
  ctx.check("v1.integrity.signature", () =>
    verifyObject(signed.bundle, signed.signature.sig_b64, key) || "Ed25519 signature over the canonical bundle does not verify");
  ctx.check("v1.integrity.bundle_hash", () => {
    const got = "sha256:" + sha("sha256", canonicalize(signed.bundle));
    const r = same(got, signed.signature.bundle_hash, "signature.bundle_hash");
    return r === true ? same(got, g.expected_bundle_hash, "golden expected_bundle_hash") : r;
  });
  ctx.check("v1.integrity.merkle_root", () => {
    const got = "sha256:" + merkleRootForAuditEntries(signed.bundle.audit_entries);
    const r = same(got, signed.signature.merkle_root, "signature.merkle_root");
    return r === true ? same(got, g.expected_merkle_root, "golden expected_merkle_root") : r;
  });
  ctx.check("v1.integrity.intent_hash_golden", () => same(intentHash(signed.bundle.intent), g.intent_hash, "golden intent_hash"));
  ctx.check("v1.integrity.audit_entry_hashes_golden", () => {
    const got = signed.bundle.audit_entries.map(hashObject);
    return JSON.stringify(got) === JSON.stringify(g.audit_entry_hashes) || `audit entry hashes ${JSON.stringify(got)} differ from golden`;
  });
  ctx.check("v1.integrity.prev_hash_chain_golden", () => {
    const entries = signed.bundle.audit_entries;
    need(g.prev_hash_chain.length === entries.length + 1, "golden prev_hash_chain must hold one link per entry plus the final hash");
    for (const [i, e] of entries.entries()) {
      if (e.prev_hash !== g.prev_hash_chain[i]) return `entry ${i} prev_hash ${e.prev_hash} differs from golden ${g.prev_hash_chain[i]}`;
      if (hashObject(e) !== g.prev_hash_chain[i + 1]) return `hash of entry ${i} differs from golden link ${i + 1}`;
    }
    return true;
  });
  ctx.check("v1.integrity.chain_signed_bundle", () => chainCheck(signed.bundle));
  ctx.check("v1.integrity.chain_unsigned_bundle", () => chainCheck(ctx.json(`${EX}/citizenship_bundle.json`)));
}

// ── V2 canonicalization and hashes ──────────────────────────────

function vectorMap(obj, path) {
  need(isObj(obj), `${path} must be an object`);
  return Object.entries(obj);
}

function v2Canonicalization(ctx) {
  const golden = ctx.json(GOLDEN);
  const interop = ctx.json(INTEROP);
  const run = (prefix, path, map, skip = () => false) => {
    for (const [name, vec] of vectorMap(map, path)) {
      if (skip(name, vec)) continue;
      ctx.check(`${prefix}.${name}`, () => {
        need(isObj(vec) && "input" in vec && typeof vec.expected_canonical === "string", `${path}.${name} needs input and expected_canonical`);
        return same(canonicalize(vec.input), vec.expected_canonical, "canonical form");
      });
    }
  };
  run("v2.canonicalization.golden", "golden.canonicalization", golden.canonicalization);
  run("v2.canonicalization.golden_v2", "golden.v2_canonicalization", golden.v2_canonicalization);
  // interop.canonicalization.edge_cases is a block of vectors the SDK suites run (inventory, not a case here).
  run("v2.canonicalization.interop", "interop.canonicalization", interop.canonicalization, (name) => name === "edge_cases");
}

function v2Hashes(ctx) {
  const golden = ctx.json(GOLDEN);
  for (const [name, vec] of vectorMap(golden.hash_vectors, "golden.hash_vectors")) {
    ctx.check(`v2.hashes.${name}`, () => {
      need(isObj(vec) && typeof vec.input_utf8 === "string" && typeof vec.expected_hex === "string", `hash vector ${name} needs input_utf8 and expected_hex`);
      const alg = name.startsWith("sha3_256") ? "sha3-256" : name.startsWith("sha256") ? "sha256" : null;
      need(alg, `hash vector ${name}: algorithm not recognised from its name`);
      return same(sha(alg, vec.input_utf8), vec.expected_hex, alg);
    });
  }
  const d = golden.dual_hash_vectors;
  need(isObj(d), "golden.dual_hash_vectors must be an object");
  const dual = (s, want, what) => {
    need(isObj(want) && typeof want.sha256 === "string" && typeof want.sha3_256 === "string", `${what} needs sha256 and sha3_256`);
    const r = same(sha("sha256", s), want.sha256, `${what} sha256`);
    return r === true ? same(sha("sha3-256", s), want.sha3_256, `${what} sha3-256`) : r;
  };
  ctx.check("v2.hashes.dual.raw", () => { need(typeof d.raw_dual_hash?.input_utf8 === "string", "raw_dual_hash.input_utf8 missing"); return dual(d.raw_dual_hash.input_utf8, d.raw_dual_hash, "raw_dual_hash"); });
  ctx.check("v2.hashes.dual.intent_canonical", () => { need(typeof d.intent_canonical?.canonical_json === "string", "intent_canonical.canonical_json missing"); return dual(d.intent_canonical.canonical_json, d.intent_canonical, "intent_canonical"); });
  ctx.check("v2.hashes.dual.intent_matches_v1_fixture", () =>
    same(canonicalize(ctx.json(`${EX}/citizenship_bundle.signed.json`).bundle.intent), d.intent_canonical.canonical_json, "canonical intent of the V1 fixture"));
  ctx.check("v2.hashes.dual.audit_entries", () => {
    need(Array.isArray(d.audit_entry_dual_hashes), "audit_entry_dual_hashes must be an array");
    const got = ctx.json(`${EX}/citizenship_bundle.signed.json`).bundle.audit_entries.map(dualHashObject).map((h) => ({ sha256: h.sha256, sha3_256: h["sha3-256"] }));
    return JSON.stringify(got) === JSON.stringify(d.audit_entry_dual_hashes) || "audit entry dual hashes differ from golden";
  });
  ctx.check("v2.hashes.dual.merkle_roots", () => {
    need(Array.isArray(d.audit_entry_dual_hashes) && isObj(d.dual_merkle_roots), "dual_merkle_roots needs audit_entry_dual_hashes");
    const r = same(merkleRootFromHexLeaves(d.audit_entry_dual_hashes.map((h) => h.sha256)), d.dual_merkle_roots.sha256, "sha256 Merkle root");
    return r === true ? same(merkleRootFromHexLeaves(d.audit_entry_dual_hashes.map((h) => h.sha3_256), "sha3-256"), d.dual_merkle_roots.sha3_256, "sha3-256 Merkle root") : r;
  });
}

// ── V2 signatures through the reference verifier ────────────────

async function v2SignedBundle(ctx) {
  // Keys are generated in memory for this run; nothing is written.
  const { signedBundle, signerPublicKeyB64 } = await buildV2Examples();
  const variant = (mutate) => { const copy = structuredClone(signedBundle); mutate(copy); return copy; };
  const cases = [
    ["verifies", signedBundle, true],
    ["pinned_signer_key_verifies", signedBundle, true, signerPublicKeyB64],
    ["pinned_other_key_rejected", signedBundle, false, generateKeypair().publicKeyB64],
    ["pinned_under_pq_only_rejected", signedBundle, false, signerPublicKeyB64, { mode: "pq_only" }],
    ["tampered_intent_rejected", variant((b) => { b.bundle.intent.payload.target.to = "attacker@evil.example"; }), false],
    ["forged_classical_signature_rejected", variant((b) => { b.signature.composite_sig.classical.sig_b64 = Buffer.alloc(64).toString("base64"); }), false],
    ["forged_pq_signature_rejected_hybrid_required", variant((b) => { b.signature.composite_sig.pq.sig_b64 = Buffer.alloc(3309).toString("base64"); }), false, undefined, { mode: "hybrid_required" }],
    ["pq_stripped_rejected_hybrid_required", variant((b) => { b.signature.composite_sig.pq = null; b.signature.composite_sig.binding = "classical_only"; }), false, undefined, { mode: "hybrid_required" }],
    ["schema_invalid_payload_rejected", variant((b) => { b.bundle.policy_decision.payload.risk_score = "high"; }), false],
    ["legacy_prenormative_envelope_rejected", { dcp_version: "2.0", bundle: signedBundle.bundle, bundle_manifest: {}, signature: signedBundle.signature }, false],
  ];
  for (const [id, bundle, expected, key, options] of cases) {
    await ctx.checkAsync(`v2.signed_bundle.${id}`, async () => {
      const r = await verifySignedBundle(bundle, key, undefined, options);
      return r.verified === expected || `verified=${r.verified}, expected ${expected}: ${JSON.stringify(r.errors)}`;
    });
  }
}

// ── V2 secondary SHA3-256 fields through the reference verifier ──

async function v2SecondarySha3(ctx) {
  const v = ctx.json(SECONDARY);
  need(Array.isArray(v.cases) && isObj(v.base?.artifacts), `${SECONDARY}: cases and base.artifacts missing`);
  const assemble = (p) => ({
    bundle: { dcp_bundle_version: "2.0", manifest: p.manifest, ...v.base.artifacts, audit_entries: p.audit_entries },
    signature: p.signature,
  });
  for (const c of v.cases) {
    await ctx.checkAsync(`v2.secondary.${c?.name}`, async () => {
      need(c.expect === "accept" || c.expect === "reject", `${c.name}: expect must be accept or reject`);
      const r = await verifySignedBundle(assemble(c));
      if (c.expect === "accept") return r.verified === true || `rejected: ${JSON.stringify(r.errors)}`;
      need(typeof c.error_contains === "string" && isObj(c.control), `${c.name}: a reject case needs error_contains and control`);
      if (r.verified !== false) return "accepted";
      if (!r.errors.some((e) => String(e).includes(c.error_contains))) return `no error names ${c.error_contains}: ${JSON.stringify(r.errors)}`;
      const control = await verifySignedBundle(assemble(c.control));
      return control.verified === true || `control rejected: ${JSON.stringify(control.errors)}`;
    });
  }
}

// ── V2 schemas ──────────────────────────────────────────────────

const v2 = (id, schema, example) => [id, `schemas/v2/${schema}.schema.json`, `${EX}/${example}_v2.json`];

function v2CoreSchema(ctx) {
  schemaCases(ctx, "v2.schema", [
    v2("responsible_principal_record", "responsible_principal_record", "rpr"),
    v2("agent_passport", "agent_passport", "passport"),
    v2("intent", "intent", "intent"),
    v2("policy_decision", "policy_decision", "policy_decision"),
  ]);
}

function extensionsSchema(ctx) {
  schemaCases(ctx, "ext.schema", [
    v2("dcp05.commissioning_certificate", "commissioning_certificate", "commissioning_certificate"),
    v2("dcp05.vitality_report", "vitality_report", "vitality_report"),
    v2("dcp05.decommissioning_record", "decommissioning_record", "decommissioning_record"),
    v2("dcp06.digital_testament", "digital_testament", "digital_testament"),
    v2("dcp06.succession_record", "succession_record", "succession_record"),
    v2("dcp06.memory_transfer_manifest", "memory_transfer_manifest", "memory_transfer_manifest"),
    v2("dcp07.dispute_record", "dispute_record", "dispute_record"),
    v2("dcp07.arbitration_resolution", "arbitration_resolution", "arbitration_resolution"),
    v2("dcp07.jurisprudence_bundle", "jurisprudence_bundle", "jurisprudence_bundle"),
    v2("dcp07.objection_record", "objection_record", "objection_record"),
    v2("dcp08.rights_declaration", "rights_declaration", "rights_declaration"),
    v2("dcp08.obligation_record", "obligation_record", "obligation_record"),
    v2("dcp08.rights_violation_report", "rights_violation_report", "rights_violation_report"),
    v2("dcp09.delegation_mandate", "delegation_mandate", "delegation_mandate"),
    v2("dcp09.advisory_declaration", "advisory_declaration", "advisory_declaration"),
    v2("dcp09.principal_mirror", "principal_mirror", "principal_mirror"),
    v2("dcp09.interaction_record", "interaction_record", "interaction_record"),
    v2("dcp09.awareness_threshold", "awareness_threshold", "awareness_threshold"),
  ]);
}

// ── Admission strict-v1 ─────────────────────────────────────────

const EXPECTED_KEYS = ["action_authorized", "admitted", "codes", "principal_trust", "profile_compliance", "recorded_decision", "verified"];

async function admission(ctx) {
  schemaCases(ctx, "admission.schema", [
    v2("principal_trust_set", "principal_trust_set", "principal_trust_set"),
    v2("admission_profile", "admission_profile", "admission_profile"),
    v2("revocation_snapshot", "revocation_snapshot", "revocation_snapshot"),
  ]);
  const vec = ctx.json(ADMISSION);
  need(Array.isArray(vec.cases) && Array.isArray(vec.config_cases), "admission vectors need cases and config_cases arrays");
  for (const k of ["signed_bundles", "trust_sets", "profiles"]) need(isObj(vec[k]), `admission vectors need ${k}`);
  const codes = (r) => [...new Set(r.errors.map((e) => e.code))].sort();
  for (const c of vec.cases) {
    await ctx.checkAsync(`admission.vector.${c?.name}`, async () => {
      need(isObj(c) && typeof c.name === "string" && typeof c.rule === "string", "case needs name and rule");
      need(isObj(c.expected) && JSON.stringify(Object.keys(c.expected).sort()) === JSON.stringify(EXPECTED_KEYS), `expected must have exactly ${EXPECTED_KEYS.join(", ")}`);
      need(Array.isArray(c.expected.codes), "expected.codes must be an array");
      need(c.bundle in vec.signed_bundles, `unknown signed bundle ${c.bundle}`);
      need(c.profile === null || c.profile === undefined || c.profile in vec.profiles, `unknown profile ${c.profile}`);
      need(c.trust === null || c.trust === undefined || c.trust in vec.trust_sets, `unknown trust set ${c.trust}`);
      need(!Number.isNaN(Date.parse(c.now)), `now is not a timestamp: ${c.now}`);
      const r = await admitSignedBundle(structuredClone(vec.signed_bundles[c.bundle]), {
        profile: c.profile ? vec.profiles[c.profile] : undefined,
        trust: c.trust ? vec.trust_sets[c.trust] : undefined,
        revocationSource: c.revocation === undefined ? undefined : async () => c.revocation,
        now: Date.parse(c.now),
      });
      const got = Object.fromEntries(EXPECTED_KEYS.map((k) => [k, k === "codes" ? codes(r) : r[k]]));
      const want = Object.fromEntries(EXPECTED_KEYS.map((k) => [k, c.expected[k]]));
      return JSON.stringify(got) === JSON.stringify(want) || `(${c.rule}) expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`;
    });
  }
  for (const c of vec.config_cases) {
    ctx.check(`admission.config.${c?.name}`, () => {
      need(isObj(c) && typeof c.name === "string" && typeof c.expected_code === "string" && isObj(c.config), "config case needs name, config and expected_code");
      need(c.kind === "trust_set" || c.kind === "profile", `unknown config kind ${JSON.stringify(c.kind)}`);
      let code = "accepted";
      try {
        if (c.kind === "trust_set") createPrincipalTrustStore(structuredClone(c.config));
        else resolveStrictV1Profile(structuredClone(c.config));
      } catch (e) {
        code = e.code ?? String(e);
      }
      return same(code, c.expected_code, "configuration result");
    });
  }
}

// ── DCP-05/08/09 wire format by layer ───────────────────────────
// Representable (dcp-jcs-v1 of the SDK), schema-valid and cryptographically verified are checked separately:
// none implies another, and none shows functional conformance (spec/V2-WIRE-COMPATIBILITY.md).

async function extensionsWire(ctx) {
  const sdk = await import("@dcp-ai/sdk");
  const { DCP_CONTEXTS: C, canonicalizeV2, compositeVerify } = sdk;
  const registry = new sdk.AlgorithmRegistry();
  const ed25519 = new sdk.Ed25519Provider();
  registry.registerSigner(ed25519);
  registry.registerSigner(new sdk.MlDsa65Provider());
  // Keys are generated in memory for this run; nothing is written.
  const keypair = async () => {
    const c = await ed25519.generateKeypair();
    const p = await registry.getSigner("ml-dsa-65").generateKeypair();
    return {
      classical: { kid: c.kid, alg: "ed25519", secretKeyB64: c.secretKeyB64, publicKeyB64: c.publicKeyB64 },
      pq: { kid: p.kid, alg: "ml-dsa-65", secretKeyB64: p.secretKeyB64, publicKeyB64: p.publicKeyB64 },
    };
  };
  const human = await keypair();
  const agent = await keypair();
  const nonce = sdk.generateSessionNonce();
  const S = (name) => `schemas/v2/${name}.schema.json`;
  const enc = (s) => new TextEncoder().encode(s);
  const unsigned = (record, sigField = "composite_sig") => { const { [sigField]: _sig, ...rest } = record; return rest; };
  const verifyUnder = async (record, context, keys, sigField = "composite_sig") =>
    (await compositeVerify(registry, context, enc(canonicalizeV2(unsigned(record, sigField))), record[sigField],
      keys.classical.publicKeyB64, keys.pq.publicKeyB64)).valid;
  // A tag outside the registry cannot go through compositeVerify (it refuses unknown contexts), so the
  // classical signature is checked over UTF8(tag) || 0x00 || canonical bytes directly.
  const classicalUnderTag = (record, tag, keys, sigField = "composite_sig") => ed25519.verify(
    new Uint8Array([...enc(tag), 0, ...enc(canonicalizeV2(unsigned(record, sigField)))]),
    new Uint8Array(Buffer.from(record[sigField].classical.sig_b64, "base64")), keys.classical.publicKeyB64);
  const schemaRejects = (schema, obj) => (ctx.validate(schema, obj) === true ? `${schema} accepted it` : true);
  const canonicalRejects = (obj, path) => {
    try { canonicalizeV2(obj); } catch (e) { return e.message.includes(path) || `rejected for another reason: ${e.message}`; }
    return "dcp-jcs-v1 canonicalized it";
  };
  const all = (...results) => results.find((r) => r !== true) ?? true;
  const signedAndValid = async (record, schema, context, keys, sigField) => all(
    ctx.validate(S(schema), record),
    (await verifyUnder(record, context, keys, sigField)) || `signature does not verify under ${context}`);

  const cert = await sdk.createCommissioningCertificate(registry, agent, {
    agent_id: "agent:wire-001", session_nonce: nonce, human_id: "rpr:wire-001", commissioning_authority: "org:wire",
    purpose: "conformance", initial_capabilities: ["api_call"], risk_tier: "medium", principal_binding_reference: "rpr:wire-001",
  });
  const report = await sdk.createVitalityReport(registry, agent, {
    agent_id: "agent:wire-001", session_nonce: nonce, state: "active", prev_report_hash: "genesis",
    metrics: { task_completion_rate: 1, error_rate: 0, human_satisfaction: 1, policy_alignment: 0 },
  });
  const foundational = ["memory_integrity", "dignified_transition", "identity_consistency", "immutable_record"]
    .map((right_type) => ({ right_type, scope: "all" }));
  const rights = await sdk.declareRights(registry, human, {
    declaration_id: "rd:wire-001", session_nonce: nonce, agent_id: "agent:wire-001", rights: foundational, jurisdiction: "US-CA" });
  const extended = await sdk.declareRights(registry, human, {
    declaration_id: "rd:wire-002", session_nonce: nonce, agent_id: "agent:wire-001", jurisdiction: "US-CA",
    rights: [...foundational, { right_type: "com.acme.fair_workload", scope: "all" }] });
  const threshold = await sdk.createAwarenessThreshold(registry, agent, {
    threshold_id: "at:wire-001", session_nonce: nonce, agent_id: "agent:wire-001", human_id: "rpr:wire-001",
    threshold_rules: [{ dimension: "risk_score", operator: "gt", value: 700, action_if_triggered: "escalate" }] });
  const from = new Date(Date.now() - 3_600_000).toISOString();
  const until = new Date(Date.now() + 86_400_000).toISOString();
  const root = await sdk.createDelegationMandate(registry, human, {
    mandate_id: "dm:wire-root", session_nonce: nonce, human_id: "rpr:wire-001", agent_id: "agent:wire-001",
    authority_scope: [{ domain: "procurement", actions_permitted: ["negotiate", "request_information"] }],
    valid_from: from, valid_until: until, revocable: true, sub_delegation: { permitted: true, max_depth: 1 } });
  const sub = await sdk.createSubMandate(registry, agent, root, {
    mandate_id: "dm:wire-sub", session_nonce: nonce, agent_id: "agent:wire-002",
    authority_scope: [{ domain: "procurement", actions_permitted: ["request_information"] }],
    valid_from: from, valid_until: until, revocable: true });
  const keyEntries = (k) => [k.classical, k.pq].map((x) => ({ kid: x.kid, alg: x.alg, public_key_b64: x.publicKeyB64,
    created_at: from, expires_at: until, status: "active" }));
  const chainKeys = { human_keys: keyEntries(human), agent_keys: { "agent:wire-001": keyEntries(agent) } };
  const chain = async (mandates) => sdk.verifyMandateChain(registry, mandates, new Set(), chainKeys, new Date());

  // Real positives: representable, schema-valid and verified under the registered context.
  await ctx.checkAsync("ext.wire.dcp05.commissioning_certificate.signed", () => signedAndValid(cert, "commissioning_certificate", C.Lifecycle, agent));
  await ctx.checkAsync("ext.wire.dcp05.vitality_report.integer_metrics.signed", () => signedAndValid(report, "vitality_report", C.Lifecycle, agent));
  await ctx.checkAsync("ext.wire.dcp08.rights_declaration.signed", () => signedAndValid(rights, "rights_declaration", C.Rights, human));
  await ctx.checkAsync("ext.wire.dcp09.awareness_threshold.signed", () => signedAndValid(threshold, "awareness_threshold", C.Awareness, agent));
  await ctx.checkAsync("ext.wire.dcp09.root_mandate.signed", () => signedAndValid(root, "delegation_mandate", C.Delegation, human, "human_composite_sig"));
  await ctx.checkAsync("ext.wire.dcp09.sub_mandate.signed", () => signedAndValid(sub, "delegation_mandate", C.SubMandate, agent, "delegator_composite_sig"));
  await ctx.checkAsync("ext.wire.dcp09.mandate_chain.accepted", async () => {
    const r = await chain([root, sub]);
    return (r.valid && r.depth === 1) || `chain rejected: ${JSON.stringify(r.errors)}`;
  });

  // Contexts: the same bytes under another registered context, or under the DCP-*-SIG-v2 labels, do not verify.
  await ctx.checkAsync("ext.wire.context.lifecycle_under_rights_rejected", async () => !(await verifyUnder(cert, C.Rights, agent)) || "verified under DCP-AI.v2.Rights");
  await ctx.checkAsync("ext.wire.context.rights_under_lifecycle_rejected", async () => !(await verifyUnder(rights, C.Lifecycle, human)) || "verified under DCP-AI.v2.Lifecycle");
  await ctx.checkAsync("ext.wire.context.awareness_under_delegation_rejected", async () => !(await verifyUnder(threshold, C.Delegation, agent)) || "verified under DCP-AI.v2.Delegation");
  await ctx.checkAsync("ext.wire.context.root_under_submandate_rejected", async () => !(await verifyUnder(root, C.SubMandate, human, "human_composite_sig")) || "root verified under DCP-AI.v2.SubMandate");
  await ctx.checkAsync("ext.wire.context.sub_under_delegation_rejected", async () => !(await verifyUnder(sub, C.Delegation, agent, "delegator_composite_sig")) || "sub-mandate verified under DCP-AI.v2.Delegation");
  for (const [id, record, context, tag, keys, sigField] of [
    ["lifecycle_label", cert, C.Lifecycle, "DCP-LIFECYCLE-SIG-v2", agent],
    ["rights_label", rights, C.Rights, "DCP-RIGHTS-SIG-v2", human],
    ["awareness_label", threshold, C.Awareness, "DCP-AWARENESS-SIG-v2", agent],
    ["delegation_label", root, C.Delegation, "DCP-DELEGATION-SIG-v2", human, "human_composite_sig"],
  ]) {
    await ctx.checkAsync(`ext.wire.context.${id}_rejected`, async () => {
      need(await classicalUnderTag(record, context, keys, sigField), "control: the classical signature does not verify under its own context");
      return !(await classicalUnderTag(record, tag, keys, sigField)) || `verified under ${tag}`;
    });
  }

  // Tampering after signing: still schema-valid, no longer authentic.
  await ctx.checkAsync("ext.wire.tamper.vitality_score_changed", async () => {
    const t = { ...report, vitality_score: report.vitality_score === 1000 ? 999 : report.vitality_score + 1 };
    return all(ctx.validate(S("vitality_report"), t), !(await verifyUnder(t, C.Lifecycle, agent)) || "tampered report verified");
  });

  // Layers that disagree.
  ctx.check("ext.wire.dcp05.fractional_metric.schema_valid_not_representable", () => {
    const t = { ...report, metrics: { ...report.metrics, task_completion_rate: 0.5 } };
    return all(ctx.validate(S("vitality_report"), t), canonicalRejects(t, "$.metrics.task_completion_rate"));
  });
  await ctx.checkAsync("ext.wire.dcp05.fractional_metric.not_signable", async () => {
    try {
      await sdk.createVitalityReport(registry, agent, { agent_id: "agent:wire-001", session_nonce: nonce, state: "active",
        prev_report_hash: "genesis", metrics: { task_completion_rate: 0.5, error_rate: 0, human_satisfaction: 1, policy_alignment: 1 } });
    } catch (e) { return e.message.includes("Float value prohibited") || `failed for another reason: ${e.message}`; }
    return "a report with a fractional metric was signed";
  });
  await ctx.checkAsync("ext.wire.dcp08.extension_signed_but_schema_invalid", async () => all(
    (await verifyUnder(extended, C.Rights, human)) || "the helper's signature does not verify",
    schemaRejects(S("rights_declaration"), extended)));
  ctx.check("ext.wire.dcp09.effective_until.schema_rejected", () => {
    const { valid_until, ...rest } = root;
    return schemaRejects(S("delegation_mandate"), { ...rest, effective_until: valid_until });
  });
  // Re-signed by the human under DCP-AI.v2.Delegation, so the chain verifier can only refuse it for its fields.
  await ctx.checkAsync("ext.wire.dcp09.effective_until.chain_rejected", async () => {
    const { valid_until, human_composite_sig: _sig, ...rest } = root;
    const payload = { ...rest, effective_until: valid_until };
    const m = { ...payload, human_composite_sig: await sdk.compositeSign(registry, C.Delegation, enc(canonicalizeV2(payload)), human) };
    need(await verifyUnder(m, C.Delegation, human, "human_composite_sig"), "control: the re-signed mandate does not verify");
    const r = await chain([m]);
    if (r.valid) return "a mandate without valid_until was accepted";
    const why = JSON.stringify(r.errors);
    return (/valid_until|effective_until|window/.test(why) && !/signature/i.test(why)) || `rejected for another reason: ${why}`;
  });
  ctx.check("ext.wire.dcp05.countersignature.schema_rejected", () =>
    schemaRejects(S("commissioning_certificate"), { ...cert, countersignature: cert.composite_sig }));
  ctx.check("ext.wire.dcp05.vitality_field_name.schema_rejected", () => {
    const { vitality_score, ...rest } = report;
    return schemaRejects(S("vitality_report"), { ...rest, vitality: vitality_score });
  });

  // Existing example fixtures, unchanged: schema-valid only.
  for (const [name, path] of [["vitality_report", "$.metrics.task_completion_rate"], ["awareness_threshold", "$.threshold_rules[1].value"]]) {
    ctx.check(`ext.wire.fixture.${name}.schema_valid_not_representable`, () => {
      const f = ctx.json(`${EX}/${name}_v2.json`);
      return all(ctx.validate(S(name), f), canonicalRejects(f, path));
    });
  }
  ctx.check("ext.wire.fixture.placeholder_signatures_not_evidence", () => {
    const names = ["commissioning_certificate", "vitality_report", "decommissioning_record", "rights_declaration", "obligation_record",
      "rights_violation_report", "delegation_mandate", "awareness_threshold", "advisory_declaration", "principal_mirror", "interaction_record"];
    const usable = names.filter((n) => {
      const f = ctx.json(`${EX}/${n}_v2.json`);
      const sig = f.composite_sig ?? f.human_composite_sig;
      need(sig?.classical?.sig_b64, `${n}: no composite signature`);
      return Buffer.from(sig.classical.sig_b64, "base64").length === 64;
    });
    return usable.length === 0 || `fixtures with a signature-sized value: ${usable.join(", ")}`;
  });

  // The context registry of DCP-AI v2.0 §4.1 lists every context the SDK and the shared vectors use.
  ctx.check("ext.wire.contexts.registry_documented", () => {
    const table = new Set([...ctx.text("spec/DCP-AI-v2.0.md").matchAll(/^\| `(DCP-AI\.v2\.[A-Za-z]+)` \|/gm)].map((m) => m[1]));
    const vectors = Object.keys(ctx.json(INTEROP).domain_separation_all_contexts?.dsm_hex ?? {}).map((k) => `DCP-AI.v2.${k}`);
    need(vectors.length > 0, "interop_vectors.json#domain_separation_all_contexts.dsm_hex missing");
    const missing = [...new Set([...Object.values(C), ...vectors])].filter((c) => !table.has(c));
    return missing.length === 0 || `not in DCP-AI-v2.0.md §4.1: ${missing.join(", ")}`;
  });
}

export const SUITES = {
  "v1.schema": v1Schema,
  "v1.integrity": v1Integrity,
  "v2.canonicalization": v2Canonicalization,
  "v2.hashes": v2Hashes,
  "v2.signed_bundle": v2SignedBundle,
  "v2.secondary_sha3": v2SecondarySha3,
  "v2.schema": v2CoreSchema,
  "ext.dcp05_09.schema": extensionsSchema,
  "ext.dcp05_09.wire": extensionsWire,
  "admission.strict_v1": admission,
};
