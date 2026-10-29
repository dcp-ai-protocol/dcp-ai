#!/usr/bin/env node
// External conformance wrapper for the WASM build of the Rust SDK (contract dcp-ai-conformance-external/1,
// tools/conformance/README.md), hosted in Node. It runs the real .wasm artifact compiled from this checkout
// (tools/conformance/wrappers/build.mjs wasm) through its wasm-bindgen exports; nothing is computed in JS.
//
//   node tools/conformance/wrappers/wasm.mjs [--pkg <wasm-pack --target web output directory>]
//
// canonicalize: fatal UTF-8 decoding (a failure is rejected/parse), then the raw JSON text goes to ONE
// call of wasm_canonicalize_v2 (no JSON.parse/stringify in JS before it). That export reports errors in band as a
// single-key object {"error": "<message>"}, which a valid input can also produce as its canonical form.
// Classification is conservative. Any other result is the canonical output. For a single-key
// {"error": <string>} result, the input is inspected (after the one call, only to mark ambiguity, never to
// compute an output): if it reads as a root object whose only key is "error", the result is an
// ambiguous error. Otherwise it is rejected/parse when the message starts "JSON parse: ",
// rejected/profile when it is the documented number rejection, and an ambiguous error otherwise. digest: the export takes text,
// so the bytes must be UTF-8 (otherwise an error, never a substitute); sha256 from wasm_dual_hash,
// sha3-256 from wasm_sha3_256.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath, pathToFileURL } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT = "dcp-ai-conformance-external/1";
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const exactKeys = (o, keys) => isObj(o) && Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));
const utf8 = (buf) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf);

// The documented rejection of canonicalize_v2 behind any number of path prefixes. json_err in
// sdks/rust/src/lib.rs replaces '"' with "'", so a prefix reads `key '<k>': ` (<k> may itself contain "': ")
// or `array[<digits>]: `. A regular expression for this backtracks exponentially, so a small automaton is
// run over the characters instead: one pass, a constant number of states per character. A message longer
// than MAX_REJECTION_MESSAGE UTF-8 bytes (1 MiB, the same measure as the Rust wrapper) is never classified
// as a profile rejection: it is reported as an error. The limit applies to this classifier only.
const MAX_REJECTION_MESSAGE = 1 << 20;
const REJECTION_TEXTS = ["Non-integer number in V2 canonical form: ", "Non-finite number in V2 canonical form: "];
const KEY_OPEN = "key '";
const ARRAY_OPEN = "array[";
// States, as bits: B at a prefix boundary; K1..K4 inside "key '"; KB inside the key; E1/E2 after "'" and "':"
// of a possible key end; A1..A5 inside "array["; D0 before the first digit; D in the digits; F1/F2 after
// "]" and "]:".
const B = 1, KB = 1 << 5, E1 = 1 << 6, E2 = 1 << 7, D0 = 1 << 13, D = 1 << 14, F1 = 1 << 15, F2 = 1 << 16;
const K = (i) => 1 << i;       // K1..K4: bits 1..4
const A = (i) => 1 << (7 + i); // A1..A5: bits 8..12

function step(set, c) {
  let next = 0;
  if (set & B) {
    if (c === KEY_OPEN[0]) next |= K(1);
    if (c === ARRAY_OPEN[0]) next |= A(1);
  }
  for (let i = 1; i <= 4; i++) if (set & K(i) && c === KEY_OPEN[i]) next |= i < 4 ? K(i + 1) : KB;
  if (set & KB) next |= c === "'" ? KB | E1 : KB;
  if (set & E1 && c === ":") next |= E2;
  if (set & E2 && c === " ") next |= B;
  for (let i = 1; i <= 5; i++) if (set & A(i) && c === ARRAY_OPEN[i]) next |= i < 5 ? A(i + 1) : D0;
  const digit = c >= "0" && c <= "9";
  if (set & (D0 | D) && digit) next |= D;
  if (set & D && c === "]") next |= F1;
  if (set & F1 && c === ":") next |= F2;
  if (set & F2 && c === " ") next |= B;
  return next;
}

function isDocumentedRejection(msg) {
  if (Buffer.byteLength(msg, "utf8") > MAX_REJECTION_MESSAGE) return false;
  let set = B;
  for (let i = 0; set !== 0; i++) {
    if (set & B && REJECTION_TEXTS.some((t) => msg.startsWith(t, i))) return true;
    if (i === msg.length) return false;
    set = step(set, msg[i]);
  }
  return false;
}

function fail(message) {
  process.stderr.write(`wasm wrapper: ${message}\n`);
  process.exit(2);
}

function decodeBase64Strict(s) {
  if (typeof s !== "string" || s.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return null;
  const buf = Buffer.from(s, "base64");
  return buf.toString("base64") === s ? buf : null;
}

const args = process.argv.slice(2);
let pkg;
if (args.length === 2 && args[0] === "--pkg") pkg = path.resolve(args[1]);
else if (args.length === 0) pkg = path.join(HERE, ".build", "wasm-pkg");
else fail("usage: wasm.mjs [--pkg <dir>]");
const glue = path.join(pkg, "dcp_ai.js");
const wasmFile = path.join(pkg, "dcp_ai_bg.wasm");
if (!fs.existsSync(glue) || !fs.existsSync(wasmFile)) fail(`no WASM build at ${pkg} (run: node tools/conformance/wrappers/build.mjs wasm)`);
const wasmBytes = fs.readFileSync(wasmFile);
const mod = await import(pathToFileURL(glue).href);
await mod.default({ module_or_path: wasmBytes });
let version = "unknown (no package.json)";
try { const p = JSON.parse(fs.readFileSync(path.join(pkg, "package.json"), "utf8")); version = p.name === "dcp-ai" ? p.version : `unknown (package ${p.name})`; } catch { /* reported as unknown */ }

let request;
try { request = JSON.parse(utf8(fs.readFileSync(0))); } catch (e) { fail(`the request is not UTF-8 JSON (${e.message})`); }
const V2 = request?.contract === "dcp-ai-conformance-external/2";
if (!exactKeys(request, ["contract", "run_id", "nonce", "cases"]) || (request.contract !== CONTRACT && !V2) ||
    typeof request.run_id !== "string" || typeof request.nonce !== "string" || !Array.isArray(request.cases)) {
  fail("the request needs exactly contract dcp-ai-conformance-external/1, string run_id and nonce, and a cases array");
}

function canonicalize(id, text) {
  const out = mod.wasm_canonicalize_v2(text);
  let parsed;
  try { parsed = JSON.parse(out); } catch { return { id, status: "error", message: "wasm_canonicalize_v2 returned text that is not JSON" }; }
  if (exactKeys(parsed, ["error"]) && typeof parsed.error === "string") {
    let input;
    try { input = JSON.parse(text); } catch { /* not JSON for JS either: it cannot be a single-key object */ }
    if (exactKeys(input, ["error"])) {
      return { id, status: "error", message: "ambiguous: the input is a single-key {\"error\": …} object, so the export's in-band error cannot be told apart from its canonical form" };
    }
    if (parsed.error.startsWith("JSON parse: ")) return { id, status: "rejected", code: "parse" };
    if (isDocumentedRejection(parsed.error)) return { id, status: "rejected", code: "profile" };
    return { id, status: "error", message: `ambiguous single-key {"error": …} result: ${parsed.error}`.slice(0, 500) };
  }
  return { id, status: "ok", output_b64: Buffer.from(out, "utf8").toString("base64") };
}

// Contract /2 (opt-in evidence): one call per case to the raw exports wasm_dual_merkle_root,
// wasm_composite_verify or wasm_verify_signed_bundle_v2. Their errors come in band as {"error": "<message>"}.
const HEX64 = /^[0-9a-f]{64}$/;
// typeof first: RegExp.test coerces its argument, so ["<hex>"] would match.
const isHex64 = (v) => typeof v === "string" && HEX64.test(v);
// The kit's contract: RFC 3339 with an explicit zone (Z or ±HH:MM).
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const MISSING_PQ = "Signature error: pq_over_classical binding requires PQ signature";
const EVIDENCE = {
  dual_merkle_root: ["id", "op", "leaves"],
  composite_verify: ["id", "op", "context", "payload_b64", "composite_sig", "classical_public_key_b64", "pq_public_key_b64"],
  verify_signed_bundle_v2: ["id", "op", "bundle_b64", "policy", "verification_time"],
};
const inBandError = (out) => { try { const v = JSON.parse(out); return exactKeys(v, ["error"]) && typeof v.error === "string" ? v.error : null; } catch { return null; } };

// wasm_verify_signed_bundle_v2 reads the host clock (Date.now, through js_date_now) and takes no time. This
// test-only shim makes Date.now return verification_time synchronously around the one call and restores it in
// finally, also when the call throws; nothing else runs in between.
function atHostTime(ms, call) {
  const realNow = Date.now;
  Date.now = () => ms;
  try { return call(); } finally { Date.now = realNow; }
}

function runEvidenceCase(c) {
  if (!exactKeys(c, EVIDENCE[c.op])) fail(`case ${c.id}: fields do not match op ${c.op}`);
  if (c.op === "dual_merkle_root") {
    if (!Array.isArray(c.leaves) || c.leaves.length === 0 || !c.leaves.every((l) => exactKeys(l, ["sha256", "sha3_256"]) && isHex64(l.sha256) && isHex64(l.sha3_256))) {
      fail(`case ${c.id}: leaves must be a non-empty array of {sha256, sha3_256} lowercase 64-hex strings`);
    }
    const out = mod.wasm_dual_merkle_root(JSON.stringify(c.leaves));
    const err = inBandError(out);
    if (err !== null) return { id: c.id, status: "error", message: err.slice(0, 500) };
    const r = JSON.parse(out);
    return { id: c.id, status: "ok", sha256: r.sha256, sha3_256: r.sha3_256 };
  }
  if (c.op === "composite_verify") {
    const payload = decodeBase64Strict(c.payload_b64);
    if (typeof c.context !== "string" || !payload || !isObj(c.composite_sig) || typeof c.classical_public_key_b64 !== "string" ||
        (c.pq_public_key_b64 !== null && typeof c.pq_public_key_b64 !== "string")) fail(`case ${c.id}: composite_verify fields have the wrong types`);
    let text;
    try { text = utf8(payload); } catch { return { id: c.id, status: "rejected", code: "parse" }; }
    // The export takes payload JSON and canonicalizes it inside; the kit sends canonical payload text.
    const out = mod.wasm_composite_verify(c.context, text, JSON.stringify(c.composite_sig), c.classical_public_key_b64, c.pq_public_key_b64 ?? undefined);
    const err = inBandError(out);
    if (err === MISSING_PQ && c.composite_sig.binding === "pq_over_classical" && c.composite_sig.pq === null) return { id: c.id, status: "rejected", code: "missing_pq_signature" };
    if (err !== null) return { id: c.id, status: "error", message: err.slice(0, 500) };
    const r = JSON.parse(out);
    return { id: c.id, status: "ok", valid: r.valid, classical_valid: r.classical_valid, pq_valid: r.pq_valid };
  }
  const bytes = decodeBase64Strict(c.bundle_b64);
  if (!bytes || !isObj(c.policy) || typeof c.verification_time !== "string" || !RFC3339.test(c.verification_time)) fail(`case ${c.id}: verify_signed_bundle_v2 fields have the wrong types`);
  const ms = Date.parse(c.verification_time);
  if (!Number.isFinite(ms)) fail(`case ${c.id}: verification_time is not a valid instant`);
  let text;
  try { text = utf8(bytes); JSON.parse(text); } catch { return { id: c.id, status: "rejected", code: "parse" }; }
  const out = atHostTime(ms, () => mod.wasm_verify_signed_bundle_v2(text, JSON.stringify(c.policy)));
  const err = inBandError(out);
  if (err !== null) return { id: c.id, status: "error", message: err.slice(0, 500) };
  const r = JSON.parse(out);
  return { id: c.id, status: "ok", verified: r.verified, errors: r.errors };
}

function runCase(c) {
  if (!isObj(c) || typeof c.id !== "string") fail("a case must be an object with a string id");
  if (typeof c.op !== "string") fail(`case ${c.id}: op must be a string`);
  if (V2 && Object.hasOwn(EVIDENCE, c.op)) return runEvidenceCase(c);
  const fields = c.op === "canonicalize" ? ["id", "op", "profile", "input_b64"] : c.op === "digest" ? ["id", "op", "alg", "input_b64"] : null;
  if (!fields) return { id: c.id, status: "unsupported" };
  if (!exactKeys(c, fields)) fail(`case ${c.id}: fields do not match op ${c.op}`);
  for (const k of fields) if (typeof c[k] !== "string") fail(`case ${c.id}: ${k} must be a string`);
  const input = decodeBase64Strict(c.input_b64);
  if (!input) fail(`case ${c.id}: input_b64 is not canonical base64`);
  let text;
  if (c.op === "digest") {
    if (c.alg !== "sha256" && c.alg !== "sha3-256") return { id: c.id, status: "unsupported" };
    try { text = utf8(input); } catch { return { id: c.id, status: "error", message: "the WASM digest exports take UTF-8 text; these bytes are not UTF-8" }; }
    return { id: c.id, status: "ok", hex: c.alg === "sha256" ? JSON.parse(mod.wasm_dual_hash(text)).sha256 : mod.wasm_sha3_256(text) };
  }
  if (c.profile !== "dcp-jcs-v1") return { id: c.id, status: "unsupported" };
  try { text = utf8(input); } catch { return { id: c.id, status: "rejected", code: "parse" }; }
  return canonicalize(c.id, text);
}

const results = request.cases.map((c) => {
  try { return runCase(c); } catch (e) {
    return { id: c.id, status: "error", message: `${e?.name ?? "Error"}: ${e?.message ?? String(e)}`.slice(0, 500) };
  }
});

process.stdout.write(JSON.stringify({
  contract: request.contract,
  run_id: request.run_id,
  nonce: request.nonce,
  implementation: {
    name: "dcp-ai Rust SDK compiled to WASM (wasm-bindgen, --target web) via tools/conformance/wrappers/wasm.mjs",
    version,
    resolved_from: `${wasmFile} (sha256 ${crypto.createHash("sha256").update(wasmBytes).digest("hex")})`,
    runtime: `node ${process.version} (Node-hosted WebAssembly, not a browser${V2 ? "; host clock (Date.now) substituted by verification_time during each verification call" : ""})`,
  },
  results,
}) + "\n");
