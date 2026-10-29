#!/usr/bin/env node
// External conformance wrapper for @dcp-ai/sdk (contract dcp-ai-conformance-external/1,
// tools/conformance/README.md). Reads one request on stdin and writes one response on stdout.
//
//   node tools/conformance/wrappers/ts-sdk.mjs [--sdk <path to the SDK's ESM entry>]
//
// canonicalize: fatal UTF-8 decoding and JSON.parse (a failure is rejected/parse), then ONE call to
// canonicalizeV2. Only the SDK's documented float rejection ("Float value prohibited in DCP v2.0 at ...",
// a plain Error with no stable code) is reported as rejected/profile; any other exception is an error.
// digest: sha256Hex / sha3_256Hex of the decoded bytes. Without --sdk, `@dcp-ai/sdk` is resolved from here.
// Contract /2 and /3 (opt-in) are described where they are handled below.
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const exactKeys = (o, keys) => isObj(o) && Object.keys(o).length === keys.length && keys.every((k) => k in o);

function fail(message) {
  process.stderr.write(`ts-sdk wrapper: ${message}\n`);
  process.exit(2);
}

function decodeBase64Strict(s) {
  if (typeof s !== "string" || s.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return null;
  const buf = Buffer.from(s, "base64");
  return buf.toString("base64") === s ? buf : null;
}

function packageVersion(file) {
  for (let dir = path.dirname(file); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    const pkg = path.join(dir, "package.json");
    if (fs.existsSync(pkg)) {
      const json = JSON.parse(fs.readFileSync(pkg, "utf8"));
      return json.name === "@dcp-ai/sdk" ? json.version : "unknown (not the @dcp-ai/sdk package)";
    }
  }
  return "unknown (no package.json)";
}

const args = process.argv.slice(2);
let sdkUrl;
if (args.length === 2 && args[0] === "--sdk") sdkUrl = pathToFileURL(path.resolve(args[1])).href;
else if (args.length === 0) sdkUrl = import.meta.resolve("@dcp-ai/sdk");
else fail("usage: ts-sdk.mjs [--sdk <path>]");
const sdk = await import(sdkUrl);
const sdkFile = fileURLToPath(sdkUrl);

let request;
try {
  request = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(fs.readFileSync(0)));
} catch (e) {
  fail(`the request is not UTF-8 JSON (${e.message})`);
}
const V2 = request?.contract === "dcp-ai-conformance-external/2";
const V3 = request?.contract === "dcp-ai-conformance-external/3";
if (!exactKeys(request, ["contract", "run_id", "nonce", "cases"]) || (request.contract !== "dcp-ai-conformance-external/1" && !V2 && !V3) ||
    typeof request.run_id !== "string" || typeof request.nonce !== "string" || !Array.isArray(request.cases)) {
  fail("the request needs exactly contract dcp-ai-conformance-external/1, /2 or /3, string run_id and nonce, and cases");
}

// Contract /2 (opt-in evidence): one call per case to dualMerkleRoot, compositeVerify or verifySignedBundleV2,
// with the Ed25519 and ML-DSA-65 providers registered as the SDK's interop tests do.
const HEX64 = /^[0-9a-f]{64}$/;
// typeof first: RegExp.test coerces its argument, so ["<hex>"] would match.
const isHex64 = (v) => typeof v === "string" && HEX64.test(v);
// The kit's contract: RFC 3339 with an explicit zone (Z or ±HH:MM); Date.parse alone accepts local and other forms.
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
let registry;
const getRegistry = () => {
  if (!registry) {
    registry = new sdk.AlgorithmRegistry();
    registry.registerSigner(new sdk.Ed25519Provider());
    registry.registerSigner(new sdk.MlDsa65Provider());
  }
  return registry;
};
const EVIDENCE = {
  dual_merkle_root: ["id", "op", "leaves"],
  composite_verify: ["id", "op", "context", "payload_b64", "composite_sig", "classical_public_key_b64", "pq_public_key_b64"],
  verify_signed_bundle_v2: ["id", "op", "bundle_b64", "policy", "verification_time"],
};
async function runEvidenceCase(c) {
  if (!exactKeys(c, EVIDENCE[c.op])) fail(`case fields do not match op ${c.op}`);
  if (c.op === "dual_merkle_root") {
    if (!Array.isArray(c.leaves) || c.leaves.length === 0 || !c.leaves.every((l) => exactKeys(l, ["sha256", "sha3_256"]) && isHex64(l.sha256) && isHex64(l.sha3_256))) fail(`case ${c.id}: leaves must be a non-empty array of {sha256, sha3_256} lowercase 64-hex strings`);
    const root = sdk.dualMerkleRoot(c.leaves);
    if (!root) return { id: c.id, status: "error", message: "dualMerkleRoot returned no root" };
    return { id: c.id, status: "ok", sha256: root.sha256, sha3_256: root.sha3_256 };
  }
  if (c.op === "composite_verify") {
    const payload = decodeBase64Strict(c.payload_b64);
    if (typeof c.context !== "string" || !payload || !isObj(c.composite_sig) || typeof c.classical_public_key_b64 !== "string" ||
        (c.pq_public_key_b64 !== null && typeof c.pq_public_key_b64 !== "string")) fail(`case ${c.id}: composite_verify fields have the wrong types`);
    const r = await sdk.compositeVerify(getRegistry(), c.context, new Uint8Array(payload), c.composite_sig, c.classical_public_key_b64, c.pq_public_key_b64 ?? undefined);
    return { id: c.id, status: "ok", valid: r.valid, classical_valid: r.classical_valid, pq_valid: r.pq_valid };
  }
  const bytes = decodeBase64Strict(c.bundle_b64);
  const now = typeof c.verification_time === "string" && RFC3339.test(c.verification_time) ? Date.parse(c.verification_time) : NaN;
  if (!bytes || !isObj(c.policy) || !Number.isFinite(now)) fail(`case ${c.id}: verify_signed_bundle_v2 fields have the wrong types`);
  let signed;
  try { signed = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)); } catch { return { id: c.id, status: "rejected", code: "parse" }; }
  const r = await sdk.verifySignedBundleV2(signed, getRegistry(), c.policy, { now });
  return { id: c.id, status: "ok", verified: r.verified, errors: r.errors };
}

// Contract /3 (opt-in admission, spec/profiles/admission): one call per case to admitSignedBundleV2 (the combined
// function, at the request's now, never the system clock), createPrincipalTrustStore or resolveStrictV1Profile. Only
// the SDK's AdmissionConfigError is a rejection, with its code; any other exception is an error.
// DCP_CONFORMANCE_WRAPPER_FAULT=untyped (self-tests only) replaces each /3 SDK call by an Error that carries a
// configuration code but is not an AdmissionConfigError: it can only turn an answer into an error.
const ADMISSION = {
  admit_signed_bundle_v2: ["id", "op", "bundle_b64", "now", "profile", "trust_set", "verifier_policy", "revocation"],
  load_admission_config: ["id", "op", "kind", "config"],
};
const fault = () => {
  if (process.env.DCP_CONFORMANCE_WRAPPER_FAULT === "untyped") throw Object.assign(new Error("CONFIG_INVALID_VALUE: injected by DCP_CONFORMANCE_WRAPPER_FAULT"), { code: "CONFIG_INVALID_VALUE" });
};
const objOrNull = (v) => v === null || isObj(v);
// /3's now is exactly YYYY-MM-DDTHH:mm:ss.sssZ, a real date in the years 0001-9999: Date.parse alone would roll
// 2026-02-30 into March and accept year 0000.
const NOW_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const exactNow = (t) => {
  if (typeof t !== "string" || !NOW_MS.test(t) || t.startsWith("0000")) return NaN;
  const ms = Date.parse(t);
  return Number.isFinite(ms) && new Date(ms).toISOString() === t ? ms : NaN;
};
async function runAdmissionCase(c) {
  if (!exactKeys(c, ADMISSION[c.op])) fail(`case fields do not match op ${c.op}`);
  let call;
  if (c.op === "load_admission_config") {
    if (c.kind === "trust_set") call = () => { sdk.createPrincipalTrustStore(c.config); return { accepted: true }; };
    else if (c.kind === "profile") {
      call = () => {
        const p = sdk.resolveStrictV1Profile(c.config);
        return { accepted: true, max_session_duration_seconds: p.maxSessionDurationSeconds, max_revocation_age_seconds: p.maxRevocationAgeSeconds };
      };
    } else fail(`case ${c.id}: kind must be trust_set or profile`);
  } else {
    const bytes = decodeBase64Strict(c.bundle_b64);
    const now = exactNow(c.now);
    const rev = c.revocation;
    // A snapshot is an object, complete or not (the SDK judges its content); null is the separate unavailable state.
    const revOk = rev === null || (exactKeys(rev, ["state"]) && rev.state === "unavailable") || (exactKeys(rev, ["state", "snapshot"]) && rev.state === "snapshot" && isObj(rev.snapshot));
    if (!bytes || !Number.isFinite(now) || !objOrNull(c.profile) || !objOrNull(c.trust_set) || !objOrNull(c.verifier_policy) || !revOk || (c.profile === null) !== (rev === null)) {
      fail(`case ${c.id}: admit_signed_bundle_v2 fields have the wrong types`);
    }
    let signed;
    try { signed = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)); } catch { fail(`case ${c.id}: bundle_b64 is not UTF-8 JSON`); }
    const options = {
      now,
      ...(c.profile !== null ? { profile: c.profile, revocation: rev.state === "snapshot" ? rev.snapshot : null } : {}),
      ...(c.trust_set !== null ? { trust: c.trust_set } : {}),
      ...(c.verifier_policy !== null ? { policy: c.verifier_policy } : {}),
    };
    call = async () => {
      const r = await sdk.admitSignedBundleV2(signed, getRegistry(), options);
      return {
        verified: r.verified, principal_trust: r.principal_trust, profile: r.profile, profile_compliance: r.profile_compliance,
        admitted: r.admitted, action_authorized: r.action_authorized, recorded_decision: r.recorded_decision,
        trust_set_version: r.trust_set_version, codes: r.errors.map((e) => e.code), verification_verified: r.verification?.verified,
      };
    };
  }
  try {
    fault();
    return { id: c.id, status: "ok", ...(await call()) };
  } catch (e) {
    if (e instanceof sdk.AdmissionConfigError) return { id: c.id, status: "rejected", code: e.code };
    throw e;
  }
}

const isDocumentedRejection = (e) => e?.constructor === Error && /^Float value prohibited in DCP v2\.0 at /.test(e.message);

function runCase(c) {
  if (V2 && isObj(c) && typeof c.id === "string" && Object.hasOwn(EVIDENCE, c.op)) return runEvidenceCase(c);
  if (V3 && isObj(c) && typeof c.id === "string" && Object.hasOwn(ADMISSION, c.op)) return runAdmissionCase(c);
  const known = c.op === "canonicalize" ? ["id", "op", "profile", "input_b64"] : c.op === "digest" ? ["id", "op", "alg", "input_b64"] : null;
  if (!known) return isObj(c) && typeof c.id === "string" ? { id: c.id, status: "unsupported" } : fail("a case needs an id");
  if (!exactKeys(c, known) || typeof c.id !== "string") fail(`case fields do not match op ${c.op}`);
  const input = decodeBase64Strict(c.input_b64);
  if (!input) fail(`case ${c.id}: input_b64 is not canonical base64`);
  if (c.op === "digest") {
    if (c.alg === "sha256") return { id: c.id, status: "ok", hex: sdk.sha256Hex(input) };
    if (c.alg === "sha3-256") return { id: c.id, status: "ok", hex: sdk.sha3_256Hex(input) };
    return { id: c.id, status: "unsupported" };
  }
  if (c.profile !== "dcp-jcs-v1") return { id: c.id, status: "unsupported" };
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input));
  } catch {
    return { id: c.id, status: "rejected", code: "parse" };
  }
  let out;
  try {
    out = sdk.canonicalizeV2(value);
  } catch (e) {
    if (isDocumentedRejection(e)) return { id: c.id, status: "rejected", code: "profile" };
    throw e;
  }
  return { id: c.id, status: "ok", output_b64: Buffer.from(out, "utf8").toString("base64") };
}

const results = [];
for (const c of request.cases) {
  try {
    results.push(await runCase(c));
  } catch (e) {
    results.push({ id: c.id, status: "error", message: `${e?.name ?? "Error"}: ${e?.message ?? String(e)}`.slice(0, 500) });
  }
}

process.stdout.write(JSON.stringify({
  contract: request.contract,
  run_id: request.run_id,
  nonce: request.nonce,
  implementation: {
    name: "@dcp-ai/sdk via tools/conformance/wrappers/ts-sdk.mjs",
    version: packageVersion(sdkFile),
    resolved_from: sdkFile,
    runtime: `node ${process.version}`,
  },
  results,
}) + "\n");
