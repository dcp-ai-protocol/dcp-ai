// Layers of the schema-closure corpus (tests/interop/v2/schema_closure_vectors.json), kept apart (spec/VERIFICATION.md
// V2-2 and V2-3 to V2-8):
//   schema       validateV2Bundle of lib/verify.js: the envelope schema and the four artifact payload schemas;
//   integrity    hashes, chain, roots and signatures recomputed here with tweetnacl and @noble/post-quantum and a
//                minimal dcp-jcs-v1 canonicalizer, no SDK verifier: it shows a signed closed object is intact before a
//                rejection is attributed to its schema. It is integrity evidence for this finite corpus, not a
//                normative verifier: it applies no verifier policy, mode or algorithm list, no base64 or key
//                canonicality, no key status or expiry, no session, tier or cross-artifact rule, and accepts only
//                the integer-only JSON this corpus holds;
//   composition  validateV2Bundle, then verifySignedBundleV2 of @dcp-ai/sdk (as the root resolves it) at the corpus
//                instant. It is a composition of two calls, not the reference verifyV2SignedBundle, which reads the
//                system clock. It shows that composition only, never that an SDK alone enforces V2-2.
//
//   node tools/conformance/schema-boundary.js [--report <file>]
// Exit codes: 0 every layer gives the corpus expectation, 1 at least one does not, 3 the corpus cannot be read.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import nacl from "tweetnacl";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { verifySignedBundleV2 } from "@dcp-ai/sdk";
import { v2Registry, validateV2Bundle } from "../../lib/verify.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "..", "..");
export const CORPUS = "tests/interop/v2/schema_closure_vectors.json";
const ARTIFACTS = {
  responsible_principal_record: { context: "DCP-AI.v2.ResponsiblePrincipal", manifest: "rpr_hash", keys: "principal" },
  agent_passport: { context: "DCP-AI.v2.AgentPassport", manifest: "passport_hash", keys: "agent" },
  intent: { context: "DCP-AI.v2.Intent", manifest: "intent_hash", keys: "agent" },
  policy_decision: { context: "DCP-AI.v2.PolicyDecision", manifest: "policy_hash", keys: "agent" },
};
const BUNDLE_CONTEXT = "DCP-AI.v2.Bundle";

const cmpCodePoints = (a, b) => {
  const x = Array.from(a, (c) => c.codePointAt(0));
  const y = Array.from(b, (c) => c.codePointAt(0));
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
};
/** dcp-jcs-v1 as far as this corpus needs it: keys by code point, integers only, compact; anything else throws. */
export function canon(v) {
  if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new Error(`not an integer: ${v}`);
    return String(v);
  }
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (typeof v === "object") return `{${Object.keys(v).sort(cmpCodePoints).map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;
  throw new Error(`not JSON: ${typeof v}`);
}
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest();
const sha256Prefixed = (text) => `sha256:${sha256(Buffer.from(text, "utf8")).toString("hex")}`;

/** The dual-free SHA-256 Merkle root of V2-3: raw 32-byte leaf digests, the last node duplicated on an odd layer. */
function merkleRoot(entries) {
  if (!entries.length) return `sha256:${"0".repeat(64)}`;
  let layer = entries.map((e) => sha256(Buffer.from(canon(e), "utf8")));
  while (layer.length > 1) {
    if (layer.length % 2) layer.push(layer[layer.length - 1]);
    const next = [];
    for (let i = 0; i < layer.length; i += 2) next.push(sha256(Buffer.concat([layer[i], layer[i + 1]])));
    layer = next;
  }
  return `sha256:${layer[0].toString("hex")}`;
}

/** Integrity without any SDK: every payload hash and manifest commitment, the audit chain and root, and every signature. */
export function integrity(signed) {
  const failures = [];
  try {
    const { bundle: b, signature: s } = signed;
    const m = b.manifest;
    const lists = { principal: b.responsible_principal_record.payload.binding_keys, agent: b.agent_passport.payload.keys };
    const composite = (context, text, cs, list, label) => {
      const msg = Buffer.concat([Buffer.from(context, "utf8"), Buffer.from([0]), Buffer.from(text, "utf8")]);
      const ck = list.find((k) => k.kid === cs.classical?.kid);
      const csig = Buffer.from(cs.classical?.sig_b64 ?? "", "base64");
      if (!ck || !nacl.sign.detached.verify(msg, csig, Buffer.from(ck.public_key_b64, "base64"))) failures.push(`${label}: classical signature`);
      if (cs.pq) {
        const pk = list.find((k) => k.kid === cs.pq.kid);
        if (!pk || !ml_dsa65.verify(Buffer.from(cs.pq.sig_b64, "base64"), Buffer.concat([msg, csig]), Buffer.from(pk.public_key_b64, "base64"))) failures.push(`${label}: pq signature`);
      } else if (cs.binding === "pq_over_classical") failures.push(`${label}: pq_over_classical without a pq signature`);
    };
    for (const [name, a] of Object.entries(ARTIFACTS)) {
      const env = b[name];
      const text = canon(env.payload);
      const hash = sha256Prefixed(text);
      if (env.payload_hash !== hash) failures.push(`${name}: payload_hash`);
      if (m[a.manifest] !== hash) failures.push(`manifest.${a.manifest}`);
      composite(a.context, text, env.composite_sig, lists[a.keys], name);
    }
    const entries = b.audit_entries;
    if (m.audit_count !== entries.length) failures.push("manifest.audit_count");
    entries.forEach((e, i) => {
      if (e.prev_hash !== (i === 0 ? "GENESIS" : sha256Prefixed(canon(entries[i - 1])))) failures.push(`audit_entries[${i}].prev_hash`);
      if (e.intent_hash !== m.intent_hash) failures.push(`audit_entries[${i}].intent_hash`);
    });
    if (m.audit_merkle_root !== merkleRoot(entries)) failures.push("manifest.audit_merkle_root");
    const manifestText = canon(m);
    if (s.manifest_hash !== sha256Prefixed(manifestText)) failures.push("signature.manifest_hash");
    composite(BUNDLE_CONTEXT, manifestText, s.composite_sig, lists.principal, "bundle");
  } catch (e) {
    failures.push(`structure: ${e.message}`);
  }
  return { valid: failures.length === 0, failures };
}

export function schema(signed) {
  const r = validateV2Bundle(signed);
  return { valid: r.valid, errors: r.errors ?? [] };
}

export async function composition(signed, policy, time) {
  const s = schema(signed);
  const sdk = await verifySignedBundleV2(signed, v2Registry, policy, { now: Date.parse(time) });
  return { schema_valid: s.valid, sdk_verified: sdk.verified === true, verified: s.valid && sdk.verified === true, sdk_errors: sdk.errors ?? [] };
}

/** Resolves a JSON Pointer inside a schema file of the repository: `schemas/v2/x.schema.json#/a/b`. */
export function resolveSchemaPointer(ref, root = ROOT) {
  const [file, pointer = ""] = ref.split("#");
  let node = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  for (const seg of pointer.split("/").slice(1).map((x) => x.replace(/~1/g, "/").replace(/~0/g, "~"))) {
    if (node === null || typeof node !== "object" || !(seg in node)) return undefined;
    node = node[seg];
  }
  return node;
}

export function loadCorpus(root = ROOT) {
  return JSON.parse(fs.readFileSync(path.join(root, CORPUS), "utf8"));
}

/** Every case through the three layers, each compared with the corpus expectation of that layer. */
export async function layerReport(corpus = loadCorpus()) {
  const out = [];
  for (const c of [{ name: "base", signed_bundle: corpus.base, expect: corpus.base_expect }, ...corpus.cases]) {
    const sc = schema(c.signed_bundle);
    const it = integrity(c.signed_bundle);
    const co = await composition(c.signed_bundle, corpus.verifier_policy, corpus.verification_time);
    out.push({
      name: c.name,
      schema: { got: sc.valid, expected: c.expect.schema.valid, match: sc.valid === c.expect.schema.valid, errors: sc.errors.slice(0, 3) },
      integrity: { got: it.valid, expected: c.expect.integrity.valid, match: it.valid === c.expect.integrity.valid, failures: it.failures },
      composition: { got: co.verified, expected: c.expect.verified, match: co.verified === c.expect.verified },
      sdk_alone: { label: "@dcp-ai/sdk verifySignedBundleV2 at the corpus instant, without validateV2Bundle", verified: co.sdk_verified, normative: c.expect.verified, gap: co.sdk_verified !== c.expect.verified },
    });
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--report");
  let rows;
  try { rows = await layerReport(); } catch (e) { console.error(`cannot read the corpus: ${e.message}`); process.exit(3); }
  for (const r of rows) console.log(`${r.name.padEnd(36)} schema ${r.schema.got}${r.schema.match ? "" : " (!)"}  integrity ${r.integrity.got}${r.integrity.match ? "" : " (!)"}  composition ${r.composition.got}${r.composition.match ? "" : " (!)"}  sdk-alone ${r.sdk_alone.verified}${r.sdk_alone.gap ? " (gap)" : ""}`);
  if (i > 0) fs.writeFileSync(process.argv[i + 1], JSON.stringify(rows, null, 2) + "\n");
  process.exit(rows.every((r) => r.schema.match && r.integrity.match && r.composition.match) ? 0 : 1);
}
