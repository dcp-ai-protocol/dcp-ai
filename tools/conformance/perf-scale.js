// Bounded workload scaling of the normative verifiers (report contract dcp-ai-perf-scale/1, tools/conformance-perf-scale.js).
// Four dimensions, three sizes each, three controls per size: bytes of one string and depth of nested objects in an
// open member of intent.payload.target, number of audit entries (five SDKs, through the unchanged dcp-ai-perf/1
// children), and length of a DCP-09 mandate chain (four SDKs, WASM has no mandate API, through the separate
// dcp-ai-perf-mandate/1 children). The corpus is generated once, with TEST-ONLY keys, and measured from its exact bytes;
// its expectations come from construction and from SDK-free checks (Ajv schemas, the integrity layer of
// structural-checks.js, the mandate signatures of mandate-fuzz.mjs), never from agreement of the SDKs. Latency is per
// call in process; memory is the kernel high-water RSS of a fresh child per observation (perf/rusage.py). No speed
// threshold, no ranking, no attribution of a cost to one primitive.
import { spawnSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import { builtinModules, findPackageJSON } from "module";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import nacl from "tweetnacl";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { LIMITS, InfraError, UsageError, exactKeys, isObj, runProcess, runLevel, sha256, utf8 } from "./external.js";
import {
  BUILD_DIR, CONTRACT as PERF_CONTRACT, ENTRYPOINTS, REPO_ROOT, SDKS, VERIFICATION_TIME, VERSION_TIMEOUT_MS, bounded, build as buildPerf, childArgv,
  judge, recordDifferences, requireComplete, stableRecord, stats, treeDigest,
} from "./perf.js";
import { canon, schema as bundleSchema } from "./schema-boundary.js";
import { structure } from "./structural-checks.js";
import { validateOne } from "../../lib/verify.js";
import { CTX, compositeSig, normativeSignatures } from "../difffuzz/mandate-fuzz.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPORT_CONTRACT = "dcp-ai-perf-scale/1";
export const MANDATE_CONTRACT = "dcp-ai-perf-mandate/1";
export const CORPUS_FORMAT = "dcp-ai-perf-scale-corpus/1";
export const RUSAGE_FORMAT = "dcp-ai-perf-rusage/1";
export const MANDATE_SDKS = ["ts", "python", "go", "rust"];
export const MANDATE_ENTRYPOINTS = { ts: "verifyMandateChain", python: "verify_mandate_chain", go: "VerifyMandateChain", rust: "verify_mandate_chain" };
export const DIMENSIONS = {
  bytes: { kind: "bundle", sizes: [1024, 16384, 262144], unit: "bytes of one ASCII string in an open member of intent.payload.target" },
  nesting: { kind: "bundle", sizes: [4, 16, 64], unit: "nested objects in an open member of intent.payload.target" },
  audit: { kind: "bundle", sizes: [1, 16, 256], unit: "audit entries" },
  mandates: { kind: "mandate", sizes: [1, 4, 16], unit: "mandates in the chain (the root has delegation_depth 0, the leaf L-1)" },
};
export const CONTROLS = ["valid", "stale", "schema"];
export const EXPECT = { valid: true, stale: false, schema: false };
export const MEMORY_COUNTS = { warmup: 1, samples: 3 };
export const FILE_LIMIT = 1024 * 1024;
export const CLEANUP_RESERVE_MS = 5000;
export const RECORD_FILE = path.join(BUILD_DIR, "perf-scale-record.json");
const SENTINEL = "STALEMARK0";
const STALE_SENTINEL = "STALEMARK1";
const SCHEMA_DIAGNOSTIC = "schema: /bundle/intent/payload/estimated_impact enum";
const MANDATE_SHAPE = "mandate[0]: missing or invalid mandate_id";
const POLICY_FILE = "tests/interop/v2/bundle_vectors.json";
const KEYS_FILE = "tests/interop/v2/interop_vectors.json";
const DIST = path.join(REPO_ROOT, "sdks", "typescript", "dist", "index.js");
export const ARTIFACTS = {
  go: path.join(BUILD_DIR, "perf-mandate-go"),
  rust: path.join(BUILD_DIR, "rust-target", "release", "examples", "perf_mandate"),
};
const RUSAGE = path.join(HERE, "perf", "rusage.py");
// The JavaScript modules are found from these entry points (see moduleClosure); the other files the tool runs or
// reads, and the root manifests and lock its oracle helpers resolve from, are listed. The dcp-ai-perf/1 part (SDK
// sources, manifests, locks, children, artifacts, tools) is perf.js's record.
const ENTRY_MODULES = ["tools/conformance-perf-scale.js", "tools/conformance/perf/mandate.mjs"];
const SCALE_FILES = [
  "tools/conformance/perf/rusage.py", "tools/conformance/perf/python_mandate.py", "tools/conformance/wrappers/go/perfmandate/main.go",
  "tools/conformance/wrappers/rust/examples/perf_mandate.rs", POLICY_FILE, KEYS_FILE, "package.json", "package-lock.json", ".npmrc",
];
// Reservations of the cooperative budget (the hard bound is the supervisor's, see killTree). Worst case of one
// provenance snapshot, so that it is started only when it fits: perf.js's stableRecord asks
// at most 7 tool versions (Python 1, Go 1, Rust 2, WASM 3), each bounded by runProcess (its timeout, the SIGTERM grace
// and the close wait); pip freeze is bounded here; local hashing gets a margin.
export const PIP_TIMEOUT_MS = 60000;
const PROCESS_TAIL_MS = LIMITS.termGraceMs + LIMITS.closeWaitMs;
export const SNAPSHOT_WORST_MS = 7 * (VERSION_TIMEOUT_MS + PROCESS_TAIL_MS) + PIP_TIMEOUT_MS + PROCESS_TAIL_MS + 30000;
// Reservation before the synchronous corpus checks (bounded files, local hashing and SDK-free verification). Neither
// reservation interrupts a slow step: the supervisor does.
export const VALIDATION_MARGIN_MS = 120000;

export const idOf = (dimension, size, control) => `${dimension}_${size}_${control}`;
/** Every workload the code defines, in order: dimension, size, control. `small` keeps the first size of each dimension. */
export function plannedWorkloads({ sizes = "all" } = {}) {
  return Object.entries(DIMENSIONS).flatMap(([dimension, d]) => (sizes === "small" ? d.sizes.slice(0, 1) : d.sizes).flatMap((size) => CONTROLS.map((control) => ({
    id: idOf(dimension, size, control), dimension, size, control, kind: d.kind, expect: { verified: EXPECT[control] },
  }))));
}
export const sdksFor = (kind) => (kind === "bundle" ? SDKS : MANDATE_SDKS);
export function policy() {
  const p = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, POLICY_FILE), "utf8")).default_verifier_policy;
  return { policy: p, policy_sha256: sha256(Buffer.from(JSON.stringify(p))) };
}

// ── Generation (TEST-ONLY keys; nothing here is timed) ───────────

const hex = (s) => sha256(Buffer.from(s, "utf8"));
const hashOf = (v) => `sha256:${hex(canon(v))}`;
const iso = (ms) => new Date(ms).toISOString().replace(".000Z", "Z");
const nest = (n) => { let v = SENTINEL; for (let i = 0; i < n; i++) v = { d: v }; return v; };

async function bundleGenerator() {
  const S = await import(pathToFileURL(DIST).href);
  const registry = new S.AlgorithmRegistry();
  registry.registerSigner(new S.Ed25519Provider());
  registry.registerSigner(new S.MlDsa65Provider());
  const T = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, KEYS_FILE), "utf8")).test_keys;
  const k = (t) => ({ kid: t.kid, alg: t.alg, secretKeyB64: t.secret_key_b64, publicKeyB64: t.public_key_b64 });
  const KEYS = { classical: k(T.ed25519), pq: k(T.ml_dsa_65) };
  const NONCE = hex("dcp-ai-perf-scale session");
  const keyEntries = (expires) => [KEYS.classical, KEYS.pq].map((x) => ({ kid: x.kid, alg: x.alg, public_key_b64: x.publicKeyB64, created_at: "2026-10-21T00:00:00Z", expires_at: expires, status: "active" }));
  const sign = async (payload, context) => {
    const { canonicalBytes, payloadHash } = S.preparePayload(payload);
    return { payload, payload_hash: payloadHash, composite_sig: await S.compositeSign(registry, context, canonicalBytes, KEYS) };
  };
  return async (dimension, size) => {
    const rpr = {
      dcp_version: "2.0", human_id: "human:perf-scale-principal", session_nonce: NONCE, legal_name: "Perf Scale Principal", entity_type: "natural_person",
      jurisdiction: "US-CA", liability_mode: "owner_responsible", override_rights: true, issued_at: "2026-10-21T00:00:00Z", expires_at: null,
      contact: "principal@example.com", binding_keys: keyEntries(null),
    };
    const passport = {
      dcp_version: "2.0", agent_id: "agent:perf-scale-bot", session_nonce: NONCE, keys: keyEntries("2099-12-31T23:59:59Z"), principal_binding_reference: rpr.human_id,
      capabilities: ["browse", "api_call", "email"], risk_tier: "medium", created_at: "2026-10-21T00:00:00Z", status: "active",
    };
    const target = { channel: "email", to: "bob@example.com", domain: "example.com" };
    if (dimension === "bytes") target.x_scale = SENTINEL + "a".repeat(size - SENTINEL.length);
    if (dimension === "nesting") target.x_scale = nest(size);
    const intent = {
      dcp_version: "2.0", intent_id: "intent:perf-scale-001", session_nonce: NONCE, agent_id: passport.agent_id, human_id: rpr.human_id,
      timestamp: "2026-10-21T12:00:00Z", action_type: "send_email", target, data_classes: ["contact_info"], estimated_impact: "medium", requires_consent: false,
    };
    const decision = {
      dcp_version: "2.0", intent_id: intent.intent_id, session_nonce: NONCE, decision: "approve", risk_score: 450, reasons: ["Known recipient domain"],
      required_confirmation: null, applied_policy_hash: hashOf({ policy: "default" }), timestamp: "2026-10-21T12:00:01Z",
    };
    const count = dimension === "audit" ? size : 1;
    const intentHash = hashOf(intent);
    const trail = [];
    for (let i = 0; i < count; i++) {
      trail.push({
        dcp_version: "2.0", audit_id: `audit:perf-scale-${i + 1}`, session_nonce: NONCE, prev_hash: i === 0 ? "GENESIS" : hashOf(trail[i - 1]), hash_alg: "sha256",
        timestamp: iso(Date.UTC(2026, 9, 21, 12, 0, 2 + i)), agent_id: passport.agent_id, human_id: rpr.human_id, intent_id: intent.intent_id, intent_hash: intentHash,
        policy_decision: "approved", outcome: "email_sent",
        evidence: { tool: "smtp", result_ref: dimension === "audit" && i === count - 1 ? `msg:${SENTINEL}` : `msg:perf-scale-${i + 1}`, evidence_hash: hashOf({ message: `perf-scale-${i + 1}` }) },
        pq_checkpoint_ref: null,
      });
    }
    const bundle = new S.BundleBuilderV2(NONCE)
      .responsiblePrincipalRecord(await sign(rpr, S.DCP_CONTEXTS.ResponsiblePrincipal))
      .agentPassport(await sign(passport, S.DCP_CONTEXTS.AgentPassport))
      .intent(await sign(intent, S.DCP_CONTEXTS.Intent))
      .policyDecision(await sign(decision, S.DCP_CONTEXTS.PolicyDecision))
      .addAuditEntries(trail)
      .build();
    Object.assign(bundle.manifest, { session_issued_at: "2026-10-21T00:00:00Z", session_expires_at: "2099-12-31T23:59:59Z", intended_verifier: "verifier:perf-scale", canonicalization_profile: "dcp-jcs-v1" });
    for (const [key, v] of Object.entries(bundle.manifest)) if (v === undefined) delete bundle.manifest[key];
    const signed = await S.signBundleV2(bundle, { registry, signerType: "human", signerId: rpr.human_id, keys: KEYS });
    signed.signature.created_at = "2026-10-21T13:00:00Z"; // outside the signed manifest; after the last entry; fixed
    return signed;
  };
}

// TEST-ONLY parties of the mandate chains, derived from fixed labels (deterministic: ML-DSA-65 without extra entropy).
const seedOf = (label) => crypto.createHash("sha256").update(`dcp-ai ${CORPUS_FORMAT} TEST-ONLY ${label}`).digest();
const kidOf = (alg, pub) => crypto.createHash("sha256").update(Buffer.concat([Buffer.from(alg), Buffer.from([0]), Buffer.from(pub)])).digest("hex").slice(0, 32);
function party(label) {
  const ed = nacl.sign.keyPair.fromSeed(seedOf(`${label} ed25519`));
  const pq = ml_dsa65.keygen(seedOf(`${label} ml-dsa-65`));
  return { ed: { alg: "ed25519", kid: kidOf("ed25519", ed.publicKey), pub: Buffer.from(ed.publicKey), sec: ed.secretKey },
    pq: { alg: "ml-dsa-65", kid: kidOf("ml-dsa-65", pq.publicKey), pub: Buffer.from(pq.publicKey), sec: pq.secretKey } };
}
const keyEntry = (key) => ({ kid: key.kid, alg: key.alg, public_key_b64: key.pub.toString("base64"), created_at: "2026-01-01T00:00:00Z", expires_at: null, status: "active" });

/**
 * A chain of `length` mandates: the root (delegation_depth 0, signed by the human) and length-1 sub-mandates, one agent
 * per mandate, each signed by its parent's agent. Every mandate permits sub-delegation down to depth length-1, narrows
 * max_messages_per_day, keeps the tier and lies inside its parent's window; all are valid at VERIFICATION_TIME.
 */
export function mandateDocument(length) {
  const human = "human:perf-scale-principal";
  const agents = Array.from({ length }, (_, i) => `agent:perf-scale-${i}`);
  const parties = { [human]: party("human"), ...Object.fromEntries(agents.map((a) => [a, party(a)])) };
  const chain = [];
  for (let i = 0; i < length; i++) {
    const body = {
      dcp_version: "2.0", mandate_id: `mandate:perf-scale-${length}-${i}${i === length - 1 ? `-${SENTINEL}` : ""}`, session_nonce: hex(`perf-scale mandate ${length} ${i}`),
      human_id: human, agent_id: agents[i],
      authority_scope: [{ domain: "email", actions_permitted: ["read"], data_classes: ["contact_info"], limits: { max_messages_per_day: 1000 - 10 * i } }],
      valid_from: iso(Date.UTC(2026, 0, 1 + i)), valid_until: iso(Date.UTC(2099, 0, 1 - i)), revocable: true, timestamp: iso(Date.UTC(2026, 0, 1 + i)),
      ...(i ? { parent_mandate_id: chain[i - 1].mandate_id, delegation_depth: i } : {}),
      sub_delegation: { permitted: true, max_depth: length - 1 }, minimum_security_tier: "standard",
    };
    chain.push(i === 0 ? { ...body, human_composite_sig: compositeSig(CTX.root, body, parties[human]) }
      : { ...body, delegator_composite_sig: compositeSig(CTX.sub, body, parties[agents[i - 1]]) });
  }
  const keys = { human_keys: [keyEntry(parties[human].ed), keyEntry(parties[human].pq)], agent_keys: Object.fromEntries(agents.map((a) => [a, [keyEntry(parties[a].ed), keyEntry(parties[a].pq)]])) };
  return { chain, keys };
}

const staleOf = (valid) => {
  const at = valid.indexOf(Buffer.from(SENTINEL));
  if (at < 0 || valid.indexOf(Buffer.from(SENTINEL), at + 1) >= 0) throw new InfraError("the sentinel must occur exactly once");
  const out = Buffer.from(valid);
  out[at + SENTINEL.length - 1] = STALE_SENTINEL.charCodeAt(SENTINEL.length - 1);
  return out;
};
// The one change of a schema control, applied to (or undone on) a parsed valid document.
const SCHEMA_EDIT = {
  bundle: { get: (d) => d.bundle.intent.payload.estimated_impact, set: (d, v) => { d.bundle.intent.payload.estimated_impact = v; }, value: "perf-scale-invalid" },
  mandate: { get: (d) => d.chain[0].mandate_id, set: (d, v) => { d.chain[0].mandate_id = v; }, value: 7 },
};

/** Writes the corpus to an empty or new directory: one file per workload and manifest.json. Returns the manifest. */
export async function generateCorpus(dir) {
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new UsageError(`${dir} is not empty`);
  fs.mkdirSync(dir, { recursive: true });
  const makeBundle = await bundleGenerator();
  const files = new Map();
  for (const [dimension, d] of Object.entries(DIMENSIONS)) {
    for (const size of d.sizes) {
      const doc = d.kind === "bundle" ? await makeBundle(dimension, size) : mandateDocument(size);
      const valid = Buffer.from(JSON.stringify(doc), "utf8");
      const edited = JSON.parse(valid.toString("utf8"));
      SCHEMA_EDIT[d.kind].set(edited, SCHEMA_EDIT[d.kind].value);
      files.set(idOf(dimension, size, "valid"), valid);
      files.set(idOf(dimension, size, "stale"), staleOf(valid));
      files.set(idOf(dimension, size, "schema"), Buffer.from(JSON.stringify(edited), "utf8"));
    }
  }
  const workloads = plannedWorkloads().map((w) => {
    const bytes = files.get(w.id);
    if (bytes.length > FILE_LIMIT) throw new InfraError(`${w.id} is ${bytes.length} bytes, over ${FILE_LIMIT}`);
    fs.writeFileSync(path.join(dir, `${w.id}.json`), bytes, { flag: "wx" });
    return { ...w, file: `${w.id}.json`, bytes: bytes.length, sha256: sha256(bytes) };
  });
  const manifest = {
    format: CORPUS_FORMAT, generated_at: new Date().toISOString(), verification_time: VERIFICATION_TIME, policy_sha256: policy().policy_sha256,
    keys: `TEST-ONLY: bundles signed with ${KEYS_FILE}#test_keys; mandates with keys derived from fixed labels`,
    randomness: "Construction is deterministic. Bundle ML-DSA-65 signatures come from the SDK signer and are hedged, so regeneration changes those bytes; mandate signatures are deterministic.",
    generator: { file: "tools/conformance/perf-scale.js", sha256: sha256(fs.readFileSync(fileURLToPath(import.meta.url))), dist: treeDigest(path.dirname(DIST)) },
    workloads,
  };
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  loadCorpus(dir); // the generated corpus passes the same validation as any other
  return manifest;
}

// ── Corpus validation (bounded, before any child) ───────────────

function readBounded(dir, name) {
  if (!/^[a-z0-9_]+\.json$/.test(name)) throw new InfraError(`corpus: invalid file name ${JSON.stringify(name)}`);
  const file = path.join(dir, name);
  const st = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!st || !st.isFile()) throw new InfraError(`corpus: ${name} is missing or not a regular file`);
  if (st.size > FILE_LIMIT) throw new InfraError(`corpus: ${name} is ${st.size} bytes, over ${FILE_LIMIT}`);
  const bytes = fs.readFileSync(file);
  if (bytes.length !== st.size) throw new InfraError(`corpus: ${name} changed while it was read`);
  return bytes;
}
const parse = (bytes, name) => { try { return JSON.parse(utf8(bytes)); } catch (e) { throw new InfraError(`corpus: ${name} is not UTF-8 JSON (${e.message})`); } };
// The magnitude of a size and the terminal that carries the sentinel: STALEMARK0 in a valid document, STALEMARK1 in its
// stale twin (a schema control is checked against its valid document instead, change by change).
const chainOf = (v) => { let n = 0; while (isObj(v) && exactKeys(v, ["d"])) { v = v.d; n++; } return { n, leaf: v }; };
const shape = (dimension, doc) => ({
  bytes: () => { const x = doc.bundle?.intent?.payload?.target?.x_scale; return typeof x === "string" ? { size: x.length, terminal: x.slice(0, SENTINEL.length) } : null; },
  nesting: () => { const c = chainOf(doc.bundle?.intent?.payload?.target?.x_scale); return { size: c.n, terminal: c.leaf }; },
  audit: () => {
    const e = doc.bundle?.audit_entries;
    if (!Array.isArray(e) || !e.length || doc.bundle.manifest?.audit_count !== e.length) return null;
    const ref = e.at(-1).evidence?.result_ref;
    return { size: e.length, terminal: typeof ref === "string" && ref.startsWith("msg:") ? ref.slice(4) : null };
  },
  mandates: () => {
    const c = doc.chain;
    if (!Array.isArray(c) || !c.length) return null;
    const id = c.at(-1).mandate_id;
    return { size: c.length, terminal: typeof id === "string" ? id.slice(-SENTINEL.length) : null };
  },
})[dimension]();
// The integrity failures a stale bundle must show, exactly: the SDK-free layer, not an SDK.
const STALE_FAILURES = {
  bytes: ["intent: payload_hash", "manifest.intent_hash", "intent: classical signature", "intent: pq signature"],
  audit: ["manifest.audit_merkle_root"],
};
STALE_FAILURES.nesting = STALE_FAILURES.bytes;
const mandateSchemaErrors = (chain) => chain.flatMap((m, i) => (validateOne("schemas/v2/delegation_mandate.schema.json", m).errors ?? []).map((e) => `mandate[${i}] ${e}`));

/**
 * Loads and checks a corpus: bounded files, exactly the planned ids and nothing else, each entry as the code defines
 * it, hashes and lengths, the magnitude of each size, the relation of each control to its valid document, the schemas
 * with Ajv and the integrity without any SDK. Returns the selected workloads with their bytes.
 */
export function loadCorpus(dir, { sizes = "all" } = {}) {
  const st = fs.lstatSync(dir, { throwIfNoEntry: false });
  if (!st || !st.isDirectory()) throw new InfraError(`corpus: ${dir} is not a directory`);
  const manifestBytes = readBounded(dir, "manifest.json");
  const manifest = parse(manifestBytes, "manifest.json");
  const planned = plannedWorkloads();
  if (!isObj(manifest) || manifest.format !== CORPUS_FORMAT || manifest.verification_time !== VERIFICATION_TIME || manifest.policy_sha256 !== policy().policy_sha256
      || !Array.isArray(manifest.workloads)) throw new InfraError("corpus: manifest.json is not a corpus of this contract, instant and policy");
  const names = fs.readdirSync(dir).sort();
  const expected = ["manifest.json", ...planned.map((w) => `${w.id}.json`)].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    const extra = names.filter((n) => !expected.includes(n));
    const missing = expected.filter((n) => !names.includes(n));
    throw new InfraError(`corpus: the files are not exactly the planned ones (extra: ${extra.join(", ") || "none"}; missing: ${missing.join(", ") || "none"})`);
  }
  if (manifest.workloads.length !== planned.length) throw new InfraError(`corpus: ${manifest.workloads.length} entries, ${planned.length} planned`);
  const byId = new Map();
  manifest.workloads.forEach((m, i) => {
    const p = planned[i];
    if (!exactKeys(m, ["id", "dimension", "size", "control", "kind", "expect", "file", "bytes", "sha256"]) || m.id !== p.id || m.dimension !== p.dimension || m.size !== p.size
        || m.control !== p.control || m.kind !== p.kind || !exactKeys(m.expect, ["verified"]) || m.expect.verified !== p.expect.verified || m.file !== `${p.id}.json`) {
      throw new InfraError(`corpus: entry ${i} is not ${p.id} as the code defines it`);
    }
    const bytes = readBounded(dir, m.file);
    if (bytes.length !== m.bytes || sha256(bytes) !== m.sha256) throw new InfraError(`corpus: ${m.id} does not match its length or sha256`);
    byId.set(m.id, { ...p, file: m.file, bytes, sha256: m.sha256 });
  });
  for (const [dimension, d] of Object.entries(DIMENSIONS)) {
    for (const size of d.sizes) {
      const [valid, stale, schemaControl] = CONTROLS.map((c) => byId.get(idOf(dimension, size, c)));
      const docs = [valid, stale, schemaControl].map((w) => parse(w.bytes, w.file));
      docs.forEach((doc, i) => {
        const id = [valid, stale, schemaControl][i].id;
        const sh = shape(dimension, doc);
        if (i < 2 && (!sh || sh.size !== size)) throw new InfraError(`corpus: ${id} does not hold ${size} ${d.unit}`);
        if (i < 2 && sh.terminal !== [SENTINEL, STALE_SENTINEL][i]) throw new InfraError(`corpus: ${id} does not end its grown part with ${[SENTINEL, STALE_SENTINEL][i]}`);
      });
      // stale: the valid bytes with exactly one byte changed, the last one of the sentinel.
      const diff = valid.bytes.length === stale.bytes.length ? [...valid.bytes.keys()].filter((i) => valid.bytes[i] !== stale.bytes[i]) : null;
      if (!diff || diff.length !== 1 || !valid.bytes.subarray(diff[0] - SENTINEL.length + 1, diff[0] + 1).equals(Buffer.from(SENTINEL))) {
        throw new InfraError(`corpus: ${stale.id} is not ${valid.id} with exactly the sentinel byte changed`);
      }
      // schema: the parsed valid document with exactly the one designated change.
      const edit = SCHEMA_EDIT[d.kind];
      const undone = structuredClone(docs[2]);
      if (edit.get(docs[2]) !== edit.value) throw new InfraError(`corpus: ${schemaControl.id} does not carry its schema change`);
      edit.set(undone, edit.get(docs[0]));
      if (JSON.stringify(undone) !== JSON.stringify(docs[0])) throw new InfraError(`corpus: ${schemaControl.id} differs from ${valid.id} elsewhere than its schema change`);
      if (d.kind === "bundle") {
        const [sv, ss, sx] = docs.map((doc) => bundleSchema(doc));
        if (!sv.valid || !ss.valid) throw new InfraError(`corpus: ${!sv.valid ? valid.id : stale.id} is not schema-valid (Ajv): ${[...sv.errors, ...ss.errors].slice(0, 3).join("; ")}`);
        if (sx.valid || !sx.errors.some((e) => e.startsWith("intent: /estimated_impact"))) throw new InfraError(`corpus: ${schemaControl.id} is not schema-invalid at intent /estimated_impact (Ajv)`);
        const fv = structure(docs[0], VERIFICATION_TIME);
        const fst = structure(docs[1], VERIFICATION_TIME);
        if (fv.length) throw new InfraError(`corpus: ${valid.id} fails the SDK-free integrity checks: ${fv.join("; ")}`);
        if (JSON.stringify([...fst].sort()) !== JSON.stringify([...STALE_FAILURES[dimension]].sort())) {
          throw new InfraError(`corpus: ${stale.id} shows ${JSON.stringify(fst)} in the SDK-free integrity checks, not exactly ${JSON.stringify(STALE_FAILURES[dimension])}`);
        }
      } else {
        const [ev, es, ex] = docs.map((doc) => mandateSchemaErrors(doc.chain));
        if (ev.length || es.length) throw new InfraError(`corpus: ${ev.length ? valid.id : stale.id} is not schema-valid (Ajv): ${[...ev, ...es].slice(0, 3).join("; ")}`);
        if (!ex.some((e) => e.startsWith("mandate[0] /mandate_id"))) throw new InfraError(`corpus: ${schemaControl.id} is not schema-invalid at mandate[0] /mandate_id (Ajv)`);
        if (!normativeSignatures(docs[0].chain, docs[0].keys)) throw new InfraError(`corpus: ${valid.id} does not carry valid normative signatures (SDK-free)`);
        const leaf = docs[1].chain.length - 1;
        if (normativeSignatures(docs[1].chain, docs[1].keys) || !normativeSignatures(docs[1].chain.slice(0, leaf), docs[1].keys)) {
          throw new InfraError(`corpus: ${stale.id} must fail its leaf signature only (SDK-free)`);
        }
      }
    }
  }
  const selected = plannedWorkloads({ sizes }).map((p) => byId.get(p.id));
  return { manifest, manifest_sha256: sha256(manifestBytes), workloads: selected };
}

/** Rehashes the corpus files after a run: the measured bytes must not have changed. */
export function corpusUnchanged(dir, corpus) {
  if (sha256(readBounded(dir, "manifest.json")) !== corpus.manifest_sha256) return false;
  return corpus.manifest.workloads.every((m) => sha256(readBounded(dir, m.file)) === m.sha256);
}

// ── Stage of a negative (categories the SDKs report, fixed from their sources) ─

/** Why the first errors of a workload do not show its control's category, or null. */
export function stageProblem(w, errors) {
  if (w.control === "valid") return null;
  const schemaLines = errors.filter((e) => e.startsWith("schema: "));
  if (w.kind === "bundle" && w.control === "schema") {
    return errors.length && schemaLines.length === errors.length && errors.includes(SCHEMA_DIAGNOSTIC) ? null : `expected only schema diagnostics including "${SCHEMA_DIAGNOSTIC}"`;
  }
  if (w.kind === "bundle") {
    const marker = w.dimension === "audit" ? "Manifest audit_merkle_root mismatch" : "intent: payload_hash mismatch";
    return !schemaLines.length && errors.includes(marker) ? null : `expected no schema diagnostic and "${marker}"`;
  }
  if (w.control === "schema") return errors.includes(MANDATE_SHAPE) ? null : `expected "${MANDATE_SHAPE}"`;
  const marker = `mandate[${w.size - 1}]: ${w.size === 1 ? "human_composite_sig" : "delegator_composite_sig"} does not verify`;
  return !errors.some((e) => e.includes("missing or invalid")) && errors.includes(marker) ? null : `expected no shape error and "${marker}"`;
}

// ── Provenance ──────────────────────────────────────────────────

const fileDigest = (p) => (fs.existsSync(p) && fs.lstatSync(p).isFile() ? sha256(fs.readFileSync(p)) : null);
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"'\n]+)["']/g;
/**
 * The local JavaScript modules reached from the entry points by literal imports (static or dynamic), transitively,
 * and the bare packages they import with the first file that imports each. Computed, so a new helper or dependency of
 * the oracle changes the record.
 */
export function moduleClosure(root = REPO_ROOT) {
  const modules = new Set();
  const bare = new Map();
  const visit = (rel) => {
    if (modules.has(rel)) return;
    modules.add(rel);
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) return; // recorded as missing
    for (const [, spec] of fs.readFileSync(file, "utf8").matchAll(IMPORT)) {
      if (spec.startsWith(".")) visit(path.relative(root, path.resolve(path.dirname(file), spec)).split(path.sep).join("/"));
      else if (!spec.startsWith("node:") && !builtinModules.includes(spec) && !bare.has(spec)) bare.set(spec, file);
    }
  };
  ENTRY_MODULES.forEach(visit);
  return { modules: [...modules].sort(), bare: new Map([...bare].sort(([a], [b]) => (a < b ? -1 : 1))) };
}
function nodeDependency(specifier, from) {
  let file;
  try { file = findPackageJSON(specifier, pathToFileURL(from).href); } catch { file = undefined; }
  if (!file) return null;
  const raw = fs.readFileSync(file);
  const pkg = JSON.parse(raw);
  return { package_json: path.relative(REPO_ROOT, file), name: pkg.name ?? null, version: pkg.version ?? null, sha256: sha256(raw) };
}
/** The resolved distributions of the measured interpreter (editable installs excluded: the SDK is the checkout's). */
export async function pipFreeze(python, clock) {
  if (!python) return null;
  const r = await bounded([python, "-I", "-m", "pip", "freeze", "--all", "--exclude-editable"], { mode: "capture", timeoutMs: clock.cap(PIP_TIMEOUT_MS, "pip freeze") });
  if (r.level || !r.stdout.trim()) return null;
  return { command: `${path.basename(python)} -I -m pip freeze --all --exclude-editable`, text: r.stdout, sha256: sha256(Buffer.from(r.stdout)) };
}

/**
 * The stable record: perf.js's for the five SDKs, plus this tool's modules (transitively), files, schemas, root
 * manifests and lock, mandate artifacts and resolved dependencies. It starts only when its worst case fits the deadline.
 */
export async function scaleRecord(python, clock, root = REPO_ROOT) {
  clock.require(SNAPSHOT_WORST_MS, "a provenance snapshot");
  const out = await stableRecord(root, { python, sdks: SDKS });
  const closure = moduleClosure(root);
  out.scale = {
    modules: Object.fromEntries(closure.modules.map((rel) => [rel, fileDigest(path.join(root, rel))])),
    files: Object.fromEntries(SCALE_FILES.map((rel) => [rel, fileDigest(path.join(root, rel))])),
    schemas: treeDigest(path.join(root, "schemas")),
    artifacts: Object.fromEntries(Object.entries(ARTIFACTS).map(([k, p]) => [k, fileDigest(path.join(root, path.relative(REPO_ROOT, p)))])),
    node_dependencies: Object.fromEntries([...closure.bare].map(([spec, from]) => [spec, nodeDependency(spec, from)])),
    python_freeze: await pipFreeze(python, clock),
    options: { go: "go build -mod=readonly -o tools/conformance/wrappers/.build/perf-mandate-go ./perfmandate", rust: "cargo build --example perf_mandate --release --locked" },
  };
  return out;
}

/** Builds the five dcp-ai-perf/1 artifacts (perf.js) and the two mandate children, once, within the deadline. */
export async function buildAll({ offline, timeoutMs }) {
  const started = performance.now();
  const left = () => Math.round(timeoutMs - (performance.now() - started));
  const steps = await buildPerf(SDKS, { offline, buildTimeoutMs: timeoutMs });
  for (const [argv, cwd, env] of [
    [["go", "build", "-mod=readonly", "-o", ARTIFACTS.go, "./perfmandate"], path.join(HERE, "wrappers", "go"), offline ? { GOPROXY: "off", GOFLAGS: "-mod=readonly" } : {}],
    [["cargo", "build", "--example", "perf_mandate", "--release", "--locked", ...(offline ? ["--offline"] : []), "--manifest-path", path.join(HERE, "wrappers", "rust", "Cargo.toml")], REPO_ROOT,
      { CARGO_TARGET_DIR: path.join(BUILD_DIR, "rust-target") }],
  ]) {
    if (left() <= 0) throw new InfraError(`the build deadline passed before: ${argv.join(" ")}`);
    const r = await bounded(argv, { cwd, env, timeoutMs: left() });
    steps.push({ command: argv.join(" "), cwd: path.relative(REPO_ROOT, cwd) || ".", exit_code: r.observed.exit_code, signal: r.observed.signal, duration_ms: r.observed.duration_ms });
    if (r.level) throw new InfraError(`build step failed (${r.level.message}): ${argv.join(" ")}\n${r.observed.stderr_excerpt}`);
  }
  return steps;
}

/** Every difference between two stable records, and every gap in either. */
export function provenanceDifferences(a, b) {
  const gaps = (rec) => { try { requireComplete(rec); return []; } catch (e) { return [e.message]; } };
  return [...gaps(a), ...gaps(b), ...recordDifferences(a, b)];
}

// ── Children ────────────────────────────────────────────────────

export function mandateArgv(sdk, python) {
  return {
    ts: [process.execPath, path.join(HERE, "perf", "mandate.mjs")],
    python: python ? [python, "-I", path.join(HERE, "perf", "python_mandate.py")] : null,
    go: [ARTIFACTS.go],
    rust: [ARTIFACTS.rust],
  }[sdk];
}
export const rusageArgv = (python) => (python ? [python, "-I", RUSAGE, "--"] : null);

/** A request for one child: dcp-ai-perf/1 for bundles (the unchanged children), dcp-ai-perf-mandate/1 for chains. */
export function requestFor(kind, workloads, { warmup, samples, policy: p }) {
  const common = { run_id: crypto.randomUUID(), nonce: crypto.randomBytes(16).toString("hex"), verification_time: VERIFICATION_TIME };
  const ws = workloads.map((w) => ({ id: w.id, input_b64: w.bytes.toString("base64"), input_sha256: w.sha256, expect: w.expect }));
  return kind === "bundle" ? { contract: PERF_CONTRACT, ...common, policy: p, warmup, samples, workloads: ws } : { contract: MANDATE_CONTRACT, ...common, warmup, samples, workloads: ws };
}

const fault = (kind, message) => ({ status: "error", kind, message });
/** perf.js judge() for a mandate child: its own contract and entry points, the rest of the judgement unchanged. */
export function judgeAny(kind, sdk, doc, request, workloads) {
  if (kind === "bundle") return judge(sdk, doc, request, workloads);
  if (!isObj(doc) || !isObj(doc.implementation)) return fault("malformed", "the response is neither a success nor a failure");
  if (doc.contract !== MANDATE_CONTRACT) return fault("stale", `contract ${JSON.stringify(doc.contract)} is not ${MANDATE_CONTRACT}`);
  if (doc.implementation.entrypoint !== MANDATE_ENTRYPOINTS[sdk]) return fault("identity", `entrypoint ${doc.implementation.entrypoint}, expected ${MANDATE_ENTRYPOINTS[sdk]}`);
  const v = judge(sdk, { ...doc, contract: PERF_CONTRACT, implementation: { ...doc.implementation, entrypoint: ENTRYPOINTS[sdk] } }, request, workloads);
  return v.implementation ? { ...v, implementation: doc.implementation } : v;
}

/** The judgement of a child's stdout: protocol, verdicts and counts (judge), then the stage of every negative. */
export function judgeOutput(kind, sdk, stdout, request, workloads) {
  let doc;
  try { doc = JSON.parse(utf8(stdout)); } catch (e) { return fault("invalid_output", `stdout is not one UTF-8 JSON document (${e.message})`); }
  const v = judgeAny(kind, sdk, doc, request, workloads);
  if (v.status !== "pass") return v;
  const byId = new Map(workloads.map((w) => [w.id, w]));
  for (const r of v.results) {
    const why = stageProblem(byId.get(r.id), r.errors_first);
    if (why) return { status: "fail", kind: "stage", message: `${r.id}: ${why}; got ${JSON.stringify(r.errors_first.slice(0, 4))}`, implementation: v.implementation };
  }
  return v;
}

/** Checks a dcp-ai-perf-rusage/1 document; returns {memory, stdout} or a fault. Unknown units are null, never 0. */
export function judgeRusage(doc) {
  const keys = ["format", "platform", "child", "stdout_over_limit", "stdout_b64", "wall_ns", "utime_ns", "stime_ns", "ru_maxrss_raw", "ru_maxrss_unit", "peak_rss_bytes", "unavailable_reason"];
  const nat = (n) => Number.isSafeInteger(n) && n >= 0;
  if (!exactKeys(doc, keys) || doc.format !== RUSAGE_FORMAT || typeof doc.platform !== "string" || !exactKeys(doc.child, ["exit_code", "signal"])
      || typeof doc.stdout_over_limit !== "boolean" || typeof doc.stdout_b64 !== "string" || !nat(doc.wall_ns) || doc.wall_ns === 0 || !nat(doc.utime_ns) || !nat(doc.stime_ns)) {
    return fault("memory_malformed", "the rusage document has the wrong shape");
  }
  const units = { darwin: ["bytes", 1], linux: ["KiB", 1024] };
  const u = units[doc.platform];
  if (u) {
    if (!Number.isSafeInteger(doc.ru_maxrss_raw) || doc.ru_maxrss_raw <= 0 || doc.ru_maxrss_unit !== u[0] || !Number.isSafeInteger(doc.peak_rss_bytes)
        || doc.peak_rss_bytes !== doc.ru_maxrss_raw * u[1] || doc.unavailable_reason !== null) {
      return fault("memory_malformed", `ru_maxrss on ${doc.platform} must be a positive integer in ${u[0]} with its normalized bytes`);
    }
  } else if (doc.ru_maxrss_raw !== null || doc.ru_maxrss_unit !== null || doc.peak_rss_bytes !== null || typeof doc.unavailable_reason !== "string" || !doc.unavailable_reason) {
    return fault("memory_malformed", `platform ${doc.platform}: an unknown unit must be reported as null with its reason`);
  }
  if (doc.stdout_over_limit) return fault("output_limit", "the child's stdout exceeded the launcher limit");
  if (doc.child.exit_code !== 0 || doc.child.signal !== null) return fault("process", `child exit code ${doc.child.exit_code}, signal ${doc.child.signal}`);
  const stdout = Buffer.from(doc.stdout_b64, "base64");
  if (stdout.toString("base64") !== doc.stdout_b64) return fault("memory_malformed", "stdout_b64 is not canonical base64");
  const memory = { platform: doc.platform, ru_maxrss_raw: doc.ru_maxrss_raw, ru_maxrss_unit: doc.ru_maxrss_unit, peak_rss_bytes: doc.peak_rss_bytes,
    unavailable_reason: doc.unavailable_reason, heap_bytes: null, heap_reason: "not measured: whole-process high-water RSS only (decision D1)",
    wall_ns: doc.wall_ns, utime_ns: doc.utime_ns, stime_ns: doc.stime_ns };
  return { memory, stdout };
}

// ── Deadline: a cooperative budget inside the worker, enforced from outside by the supervisor ─

// A stable executable, not a PATH lookup; DCP_PERF_SCALE_SELFTEST_PS replaces it in the self-tests only.
const PS = process.env.DCP_PERF_SCALE_SELFTEST_PS ?? "/bin/ps";
/** The process table (pid, parent, group, state). Throws when it cannot be read. */
export const processTable = () => {
  const r = spawnSync(PS, ["-A", "-o", "pid=,ppid=,pgid=,stat="], { encoding: "utf8", timeout: 5000 });
  if (r.status !== 0 || !r.stdout.trim()) throw new InfraError(`${PS} could not list the processes (${r.error?.message ?? `exit ${r.status}`})`);
  return r.stdout.trim().split("\n").map((l) => { const [pid, ppid, pgid, stat] = l.trim().split(/\s+/); return { pid: +pid, ppid: +ppid, pgid: +pgid, stat: stat ?? "" }; });
};
const descendants = (root, table) => {
  const out = [];
  const queue = [root];
  while (queue.length) {
    const p = queue.shift();
    for (const c of table.filter((x) => x.ppid === p && x.pid !== root)) { out.push(c); queue.push(c.pid); }
  }
  return out;
};
const signal = (target, sig) => { try { process.kill(target, sig); return true; } catch { return false; } };
/**
 * Stops a worker and every process it started, wherever its process group: the worker's group is frozen (SIGSTOP),
 * then every descendant found through ps and its group, the tree is read again once nothing can start, and every
 * group and process is killed (SIGKILL). Detached children (runProcess gives each its own group) are found by their
 * parent link before anything dies. If ps fails at any point, the fallback still kills what is known (the worker's
 * group and the descendants already found) and the result says the cleanup is not complete: it never claims that
 * nothing is alive without having checked. The supervisor's own group is never signalled. POSIX only.
 */
export async function killTree(rootPid, ownGroup) {
  const errors = [];
  const table = () => { try { return processTable(); } catch (e) { errors.push(e.message); return null; } };
  const known = new Map(); // pid -> pgid, every descendant seen
  const add = (t) => { if (t) for (const p of descendants(rootPid, t)) known.set(p.pid, p.pgid); return t; };
  try {
    signal(-rootPid, "SIGSTOP");
    add(table());
    for (const [pid, pgid] of known) { if (pgid !== ownGroup) signal(-pgid, "SIGSTOP"); signal(pid, "SIGSTOP"); }
    add(table());
  } finally {
    for (const g of new Set([rootPid, ...known.values()])) if (g !== ownGroup) signal(-g, "SIGKILL");
    for (const pid of known.keys()) signal(pid, "SIGKILL");
    signal(rootPid, "SIGKILL");
  }
  const pids = [rootPid, ...known.keys()];
  let alive = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const t = table();
    if (!t) { alive = null; break; }
    const live = new Map(t.map((x) => [x.pid, x]));
    alive = pids.filter((pid) => live.has(pid) && !live.get(pid).stat.startsWith("Z"));
    if (!alive.length) break;
  }
  return { killed: pids.length, known_pids: pids, alive, errors, complete: errors.length === 0 && Array.isArray(alive) && alive.length === 0 };
}

// ── Campaign ────────────────────────────────────────────────────

export class DeadlineError extends InfraError {}
/**
 * The worker's cooperative budget, on a monotonic clock: each child gets min(cap, what is left minus the cleanup
 * reserve), at least 1 s, and a step with a reservation starts only if it fits. It does not interrupt a slow
 * synchronous step; the supervisor's deadline does.
 */
export function deadline(ms, now = () => performance.now()) {
  const end = now() + ms;
  return {
    left: () => Math.max(0, Math.round(end - now())),
    cap(capMs, what) {
      const t = Math.min(capMs, Math.round(end - now()) - CLEANUP_RESERVE_MS);
      if (t < 1000) throw new DeadlineError(`the campaign deadline leaves no time for ${what}`);
      return t;
    },
    /** Refuses to start a step whose worst case does not fit what is left (minus the cleanup reserve). */
    require(worstMs, what) {
      if (end - now() - CLEANUP_RESERVE_MS < worstMs) throw new DeadlineError(`the campaign deadline leaves less than the ${Math.round(worstMs / 1000)} s that ${what} may take`);
    },
  };
}

/**
 * Runs the latency groups (one child per SDK and dimension and round) then the memory observations (one fresh child
 * per SDK and workload, through the launcher). Stops at the deadline. Returns {status, latency, memory, counts}.
 */
export async function runCampaign({ workloads, policy: p, phases, warmup, samples, rounds, timeoutMs, python, clock, argvFor, launcherArgv }) {
  const latency = [];
  const memory = [];
  const counts = { inputs: workloads.length, observations: 0, latency_groups: 0, latency_checked_calls: 0, memory_children: 0, memory_checked_calls: 0, not_run: 0 };
  const groups = [];
  for (const [dimension, d] of Object.entries(DIMENSIONS)) {
    const ws = workloads.filter((w) => w.dimension === dimension);
    if (ws.length) for (const sdk of sdksFor(d.kind)) groups.push({ dimension, kind: d.kind, sdk, ws });
  }
  counts.observations = groups.reduce((n, g) => n + g.ws.length, 0);
  const plannedChildren = (phases.includes("latency") ? groups.length * rounds : 0) + (phases.includes("memory") ? counts.observations : 0);
  let stopped = null;
  const run = async (argv, request, what) => {
    const { stdout, observed } = await runProcess(argv, Buffer.from(JSON.stringify(request)), { timeoutMs: clock.cap(timeoutMs, what), limits: LIMITS });
    return { stdout, observed, level: runLevel(observed) };
  };
  try {
    if (phases.includes("latency")) {
      for (let round = 1; round <= rounds; round++) {
        for (const g of groups) {
          const argv = argvFor(g.kind, g.sdk);
          const entry = { sdk: g.sdk, dimension: g.dimension, kind: g.kind, round, argv };
          if (!argv) { latency.push({ ...entry, status: "error", error_kind: "spawn", message: `no command for ${g.sdk}` }); continue; }
          const request = requestFor(g.kind, g.ws, { warmup, samples, policy: p });
          const r = await run(argv, request, `${g.sdk} ${g.dimension}`);
          counts.latency_groups++;
          const v = r.level ? { status: "error", ...r.level } : judgeOutput(g.kind, g.sdk, r.stdout, request, g.ws);
          latency.push({ ...entry, observed: r.observed, status: v.status, ...(v.kind ? { error_kind: v.kind, message: v.message } : {}), ...(v.implementation ? { implementation: v.implementation } : {}),
            ...(v.failure ? { failure: v.failure } : {}),
            ...(v.status === "pass" ? { results: v.results.map((x) => ({ id: x.id, verified: x.verified, errors_first: x.errors_first, stats: stats(x.samples_ns), samples_ns: x.samples_ns })) } : {}) });
          if (v.status === "pass") counts.latency_checked_calls += g.ws.length * (warmup + samples);
        }
      }
    }
    if (phases.includes("memory")) {
      for (const g of groups) {
        for (const w of g.ws) {
          const child = argvFor(g.kind, g.sdk);
          const argv = launcherArgv && child ? [...launcherArgv, ...child] : null;
          const entry = { sdk: g.sdk, dimension: g.dimension, kind: g.kind, id: w.id, argv };
          if (!argv) { memory.push({ ...entry, status: "error", error_kind: "spawn", message: `no command for ${g.sdk}` }); continue; }
          const request = requestFor(g.kind, [w], { ...MEMORY_COUNTS, policy: p });
          const r = await run(argv, request, `memory ${g.sdk} ${w.id}`);
          counts.memory_children++;
          let v;
          if (r.level) v = { status: "error", ...r.level };
          else {
            let doc;
            try { doc = JSON.parse(utf8(r.stdout)); } catch (e) { doc = undefined; v = fault("memory_malformed", `the launcher output is not JSON (${e.message})`); }
            const m = v ? null : judgeRusage(doc);
            if (m && m.status === "error") v = m;
            else if (m) {
              v = judgeOutput(g.kind, g.sdk, m.stdout, request, [w]);
              if (v.status === "pass") v = { ...v, memory: m.memory };
            }
          }
          memory.push({ ...entry, observed: r.observed, status: v.status, ...(v.kind ? { error_kind: v.kind, message: v.message } : {}), ...(v.memory ? { memory: v.memory } : {}) });
          if (v.status === "pass") counts.memory_checked_calls += MEMORY_COUNTS.warmup + MEMORY_COUNTS.samples;
        }
      }
    }
  } catch (e) {
    if (!(e instanceof DeadlineError)) throw e;
    stopped = e.message;
  }
  counts.not_run = plannedChildren - counts.latency_groups - counts.memory_children;
  const all = [...latency, ...memory];
  const status = stopped || all.some((e) => e.status === "error") ? "error" : all.some((e) => e.status === "fail") ? "fail" : "pass";
  return { status, stopped, latency, memory, counts, planned_children: plannedChildren };
}

/** Within-SDK scaling: each size's median (latency, per round) and peak RSS (memory) against the smallest size of the same series. */
export function scaling(latency, memory) {
  const series = [];
  for (const e of latency.filter((x) => x.status === "pass")) {
    const sizes = DIMENSIONS[e.dimension].sizes;
    for (const control of CONTROLS) {
      const points = sizes.map((size) => ({ size, r: e.results.find((x) => x.id === idOf(e.dimension, size, control)) })).filter((x) => x.r);
      if (points.length < 2) continue;
      const base = points[0];
      series.push({ phase: "latency", sdk: e.sdk, dimension: e.dimension, control, round: e.round, unit: "ns (median per call)",
        points: points.map((x) => ({ size: x.size, size_ratio: x.size / base.size, median: x.r.stats.median, median_ratio: x.r.stats.median / base.r.stats.median })) });
    }
  }
  const passed = memory.filter((x) => x.status === "pass");
  for (const sdk of SDKS) {
    for (const [dimension, d] of Object.entries(DIMENSIONS)) {
      for (const control of CONTROLS) {
        const points = d.sizes.map((size) => ({ size, m: passed.find((x) => x.sdk === sdk && x.id === idOf(dimension, size, control)) })).filter((x) => x.m);
        if (points.length < 2) continue;
        const base = points[0].m.memory.peak_rss_bytes;
        series.push({ phase: "memory", sdk, dimension, control, unit: "bytes (whole-process high-water RSS)",
          points: points.map((x) => ({ size: x.size, peak_rss_bytes: x.m.memory.peak_rss_bytes, delta_bytes: base === null || x.m.memory.peak_rss_bytes === null ? null : x.m.memory.peak_rss_bytes - base })) });
      }
    }
  }
  return series;
}

export { childArgv, InfraError, UsageError };
