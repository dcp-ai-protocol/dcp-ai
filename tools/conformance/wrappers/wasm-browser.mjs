#!/usr/bin/env node
// External conformance wrapper for the public JavaScript API of @dcp-ai/wasm (initDcp and DcpWasm) in a real browser
// (contracts dcp-ai-conformance-external/1, /2 and /5, tools/conformance/README.md). Contracts /3 and /4 are refused
// (exit 2): DcpWasm has no admission or mandate chain API (D-04 = A, MP-03), and nothing here emulates one.
//
//   node tools/conformance/wrappers/wasm-browser.mjs [--root <dir with dist/ and pkg/>] [--chrome <executable>]
//     [--manual --url-file <file>] [--deadline-ms <n>] [--browser-report <file>] [--manifest <SHA256SUMS>]
//
// The request is validated here (a malformed one exits 2 before any browser starts). The page and the artifacts are
// served from memory by a loopback server (127.0.0.1, an ephemeral port, every path under a random per-run token, an
// exact allowlist, no directory listing, no CORS). The page (wrappers/browser/page.mjs) imports dist/index.js, calls
// initDcp() as a web page does (the .wasm fetched relative to the glue), answers every supported case through DcpWasm
// methods after JSON.parse of the case's bytes in the page, and posts the results once. Nothing in the page reads a
// fixture or an expectation; the runner judges the response.
//
// Automatic mode launches Chrome headless with a temporary profile and closes it; --manual launches nothing and writes
// the URL to --url-file for a person to open. The run fails (exit 1, no response) when the page reports an
// infrastructure failure, its exports differ from browser/expected-api.json, a fetched artifact's digest differs from
// the served bytes, the clock shim was not restored, the result's run_id or nonce differ, a second result arrives, a
// request under the token is outside the allowlist, a Host, Origin, method or size check fails, Chrome exits first, or
// the deadline passes. --manifest additionally pins the served artifacts to a SHA256SUMS file.
//
// DCP_CONFORMANCE_WRAPPER_FAULT is for the self-tests only; a faulted response says so in implementation.runtime.
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import crypto from "crypto";
import { spawn, execFileSync } from "child_process";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const PAGE_DIR = path.join(HERE, "browser");
// dcp-ai-browser-direct/1 is internal, not a kit contract: browser/direct-sections.mjs sends direct DcpWasm method
// calls and judges the raw observations itself.
const CONTRACTS = { "dcp-ai-conformance-external/1": 1, "dcp-ai-conformance-external/2": 2, "dcp-ai-conformance-external/5": 5, "dcp-ai-browser-direct/1": "direct" };
const FAULT = process.env.DCP_CONFORMANCE_WRAPPER_FAULT || null;
const RESULT_LIMIT = 8 * 1024 * 1024;
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const exactKeys = (o, keys) => isObj(o) && Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const utf8 = (buf) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf);

function usage(message) {
  process.stderr.write(`wasm-browser wrapper: ${message}\n`);
  process.exit(2);
}

// ── Arguments ──
const opts = { root: path.join(REPO, "sdks", "wasm"), chrome: null, manual: false, urlFile: null, deadlineMs: null, browserReport: null, manifest: null };
{
  const a = process.argv.slice(2);
  const value = (i, name) => (i + 1 < a.length && !a[i + 1].startsWith("--") ? a[i + 1] : usage(`${name} needs a value`));
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--manual") opts.manual = true;
    else if (a[i] === "--root") opts.root = path.resolve(value(i++, a[i]));
    else if (a[i] === "--chrome") opts.chrome = value(i++, a[i]);
    else if (a[i] === "--url-file") opts.urlFile = path.resolve(value(i++, a[i]));
    else if (a[i] === "--browser-report") opts.browserReport = path.resolve(value(i++, a[i]));
    else if (a[i] === "--manifest") opts.manifest = path.resolve(value(i++, a[i]));
    else if (a[i] === "--deadline-ms") {
      const n = Number(value(i++, a[i]));
      if (!Number.isSafeInteger(n) || n < 1000 || n > 3_600_000) usage("--deadline-ms must be an integer from 1000 to 3600000");
      opts.deadlineMs = n;
    } else usage(`unknown argument ${a[i]}`);
  }
  if (opts.manual !== (opts.urlFile !== null)) usage("--manual and --url-file go together");
  if (opts.manual && opts.chrome) usage("--chrome does not apply to --manual");
}

// ── The request (same shapes and checks as wrappers/wasm.mjs; unsupported ops are answered here, without a call) ──
let request;
try { request = JSON.parse(utf8(fs.readFileSync(0))); } catch (e) { usage(`the request is not UTF-8 JSON (${e.message})`); }
if (!exactKeys(request, ["contract", "run_id", "nonce", "cases"]) || typeof request.run_id !== "string" || typeof request.nonce !== "string" || !Array.isArray(request.cases)) {
  usage("the request needs exactly contract, string run_id and nonce, and a cases array");
}
const CONTRACT = CONTRACTS[request.contract];
if (!CONTRACT) usage(`contract ${JSON.stringify(request.contract)} is not supported: DcpWasm has no admission or mandate chain API (D-04 = A)`);

function decodeBase64Strict(s) {
  if (typeof s !== "string" || s.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return null;
  const buf = Buffer.from(s, "base64");
  return buf.toString("base64") === s ? buf : null;
}
const HEX64 = /^[0-9a-f]{64}$/;
const isHex64 = (v) => typeof v === "string" && HEX64.test(v);
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const BUNDLE_FIELDS = ["id", "op", "bundle_b64", "policy", "verification_time"];
const EVIDENCE = {
  dual_merkle_root: ["id", "op", "leaves"],
  composite_verify: ["id", "op", "context", "payload_b64", "composite_sig", "classical_public_key_b64", "pq_public_key_b64"],
  verify_signed_bundle_v2: BUNDLE_FIELDS,
};

const DIRECT = {
  domainSeparatedMessage: (c) => exactKeys(c, ["id", "call", "context", "payload_hex"]) && typeof c.context === "string" && typeof c.payload_hex === "string" && /^(?:[0-9a-f]{2})*$/.test(c.payload_hex),
  // policy_decision may be absent, an object or null (a fixture case: null counts as none).
  computeSecurityTier: (c) => (exactKeys(c, ["id", "call", "intent"]) || (exactKeys(c, ["id", "call", "intent", "policy_decision"]) && (isObj(c.policy_decision) || c.policy_decision === null))) && isObj(c.intent),
  compositeVerify: (c) => exactKeys(c, ["id", "call", "context", "payload_b64", "composite_sig", "classical_public_key_b64", "pq_public_key_b64"]) && typeof c.context === "string" &&
    decodeBase64Strict(c.payload_b64) !== null && isObj(c.composite_sig) && typeof c.classical_public_key_b64 === "string" && (c.pq_public_key_b64 === null || typeof c.pq_public_key_b64 === "string"),
  hybridRoundtrip: (c) => exactKeys(c, ["id", "call", "context", "other_context", "payload", "altered_payload"]) && typeof c.context === "string" &&
    typeof c.other_context === "string" && isObj(c.payload) && isObj(c.altered_payload),
};

const ids = new Set();
const pageCases = [];
const local = []; // answered here: unsupported operations
for (const c of request.cases) {
  if (!isObj(c) || typeof c.id !== "string") usage("a case must be an object with a string id");
  if (ids.has(c.id)) usage(`case ${c.id} is repeated`);
  ids.add(c.id);
  if (CONTRACT === "direct") {
    if (!Object.hasOwn(DIRECT, c.call) || !DIRECT[c.call](c)) usage(`case ${c.id}: not a direct call this harness knows, or its fields have the wrong shape`);
    pageCases.push(c);
    continue;
  }
  if (typeof c.op !== "string") usage(`case ${c.id}: op must be a string`);
  if ((CONTRACT === 2 && Object.hasOwn(EVIDENCE, c.op)) || (CONTRACT === 5 && c.op === "verify_signed_bundle_v2")) {
    if (!exactKeys(c, EVIDENCE[c.op])) usage(`case ${c.id}: fields do not match op ${c.op}`);
    if (c.op === "dual_merkle_root") {
      if (!Array.isArray(c.leaves) || c.leaves.length === 0 || !c.leaves.every((l) => exactKeys(l, ["sha256", "sha3_256"]) && isHex64(l.sha256) && isHex64(l.sha3_256))) {
        usage(`case ${c.id}: leaves must be a non-empty array of {sha256, sha3_256} lowercase 64-hex strings`);
      }
      pageCases.push(c);
    } else if (c.op === "composite_verify") {
      if (typeof c.context !== "string" || !decodeBase64Strict(c.payload_b64) || !isObj(c.composite_sig) || typeof c.classical_public_key_b64 !== "string" ||
          (c.pq_public_key_b64 !== null && typeof c.pq_public_key_b64 !== "string")) usage(`case ${c.id}: composite_verify fields have the wrong types`);
      pageCases.push(c);
    } else {
      if (!decodeBase64Strict(c.bundle_b64) || !isObj(c.policy) || typeof c.verification_time !== "string" || !RFC3339.test(c.verification_time)) {
        usage(`case ${c.id}: verify_signed_bundle_v2 fields have the wrong types`);
      }
      const ms = Date.parse(c.verification_time);
      if (!Number.isFinite(ms)) usage(`case ${c.id}: verification_time is not a valid instant`);
      pageCases.push({ ...c, time_ms: ms });
    }
    continue;
  }
  if (CONTRACT === 5) { local.push({ id: c.id, status: "unsupported" }); continue; } // /5 has one operation
  const fields = c.op === "canonicalize" ? ["id", "op", "profile", "input_b64"] : c.op === "digest" ? ["id", "op", "alg", "input_b64"] : null;
  if (!fields) { local.push({ id: c.id, status: "unsupported" }); continue; }
  if (!exactKeys(c, fields)) usage(`case ${c.id}: fields do not match op ${c.op}`);
  for (const k of fields) if (typeof c[k] !== "string") usage(`case ${c.id}: ${k} must be a string`);
  if (!decodeBase64Strict(c.input_b64)) usage(`case ${c.id}: input_b64 is not canonical base64`);
  if ((c.op === "digest" && c.alg !== "sha256" && c.alg !== "sha3-256") || (c.op === "canonicalize" && c.profile !== "dcp-jcs-v1")) {
    local.push({ id: c.id, status: "unsupported" });
    continue;
  }
  pageCases.push(c);
}

// ── Run record (the --browser-report file), written on success and on failure ──
const record = {
  schema: "dcp-ai-browser-run/1",
  outcome: "running",
  failure: null,
  fault: FAULT,
  contract: request.contract,
  run_id: request.run_id,
  request_sha256: null,
  cases: { requested: request.cases.length, sent_to_page: pageCases.length, unsupported_here: local.length },
  root: opts.root,
  source: sourceInfo(),
  served_sha256: {},
  manifest: opts.manifest,
  browser: { mode: opts.manual ? "manual" : "automatic", executable: null, version: null, user_agent: null },
  page: null,
  server: { requests: [], refused: [], outside_token: 0 },
  started_at: new Date().toISOString(),
  finished_at: null,
};
record.request_sha256 = sha256(JSON.stringify(request));

function sourceInfo() {
  try {
    const head = execFileSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const dirty = execFileSync("git", ["-C", REPO, "status", "--porcelain", "--", "sdks/wasm/src", "sdks/rust/src", "sdks/rust/Cargo.lock"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return { head, wasm_sources_modified: dirty.length > 0, note: "the checkout the wrapper runs from; the served artifacts are bound by their hashes" };
  } catch {
    return { head: null, note: "git unavailable" };
  }
}

// A requested record that cannot be written fails the run (the caller asked for that evidence): false here.
function writeRecord() {
  if (!opts.browserReport) return true;
  record.finished_at = new Date().toISOString();
  try {
    fs.writeFileSync(opts.browserReport, JSON.stringify(record, null, 2) + "\n");
    return true;
  } catch (e) {
    process.stderr.write(`wasm-browser wrapper: cannot write the --browser-report ${opts.browserReport}: ${e.message}\n`);
    return false;
  }
}

// ── The served files: read once, hashed, served only from memory ──
const TYPES = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".map": "application/json; charset=utf-8", ".wasm": "application/wasm", ".json": "application/json; charset=utf-8" };
const assets = new Map(); // path under the token -> { bytes, type }
function addAsset(rel, file, { optional = false } = {}) {
  if (!fs.existsSync(file)) {
    if (optional) return;
    failEarly(`missing ${file}`);
  }
  let bytes = fs.readFileSync(file);
  if (rel === "pkg/dcp_ai_bg.wasm" && FAULT === "corrupt-wasm") bytes = Buffer.concat([Buffer.alloc(8), bytes.subarray(8)]);
  assets.set(rel, { bytes, type: TYPES[path.extname(file)] });
  record.served_sha256[rel] = sha256(bytes);
}
function failEarly(message) {
  record.outcome = "failed";
  record.failure = message;
  writeRecord();
  process.stderr.write(`wasm-browser wrapper: ${message}\n`);
  process.exit(1);
}
addAsset("", path.join(PAGE_DIR, "index.html"));
addAsset("page.mjs", path.join(PAGE_DIR, "page.mjs"));
for (const f of ["index.js", "experimental-candidate-verify.js", "experimental-candidate-produce.js"]) {
  addAsset(`dist/${f}`, path.join(opts.root, "dist", f));
  addAsset(`dist/${f}.map`, path.join(opts.root, "dist", `${f}.map`), { optional: true });
}
addAsset("pkg/dcp_ai.js", path.join(opts.root, "pkg", "dcp_ai.js"));
addAsset("pkg/dcp_ai_bg.wasm", path.join(opts.root, "pkg", "dcp_ai_bg.wasm"));
const EXPECTED_API = JSON.parse(fs.readFileSync(path.join(PAGE_DIR, "expected-api.json"), "utf8"));

if (opts.manifest) {
  const pinned = new Map();
  for (const line of fs.readFileSync(opts.manifest, "utf8").split("\n")) {
    const m = /^([0-9a-f]{64}) {2}\.\/(.+)$/.exec(line);
    if (m) pinned.set(m[2], m[1]);
  }
  for (const rel of ["dist/index.js", "dist/experimental-candidate-verify.js", "dist/experimental-candidate-produce.js", "pkg/dcp_ai.js", "pkg/dcp_ai_bg.wasm"]) {
    if (pinned.get(rel) !== record.served_sha256[rel]) failEarly(`${rel} does not match ${opts.manifest}`);
  }
}

let version = "unknown";
try {
  const crate = JSON.parse(fs.readFileSync(path.join(opts.root, "pkg", "package.json"), "utf8"));
  let npm = null;
  try { npm = JSON.parse(fs.readFileSync(path.join(opts.root, "package.json"), "utf8")); } catch { /* a bare build directory */ }
  version = `${npm?.name === "@dcp-ai/wasm" ? `@dcp-ai/wasm ${npm.version}, ` : ""}dcp-ai crate ${crate.version}`;
} catch { /* reported as unknown */ }

// ── Loopback server ──
const token = crypto.randomBytes(16).toString("hex");
const PAGE_ASSETS = [...assets.keys()].filter((k) => !k.endsWith(".map"));
const CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
let port = 0;
let settle; // resolves the run with { result } or { failure }
const done = new Promise((resolve) => { settle = resolve; });
let resultSeen = false;

function refuse(req, res, status, why, { failure = true } = {}) {
  const entry = { method: req.method, path: redact(req.url), status, why };
  if (failure) record.server.refused.push(entry);
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(why);
  if (failure) settle({ failure: `refused request: ${req.method} ${redact(req.url)} (${why})` });
}
const redact = (u) => String(u).split(token).join("<token>");

const server = http.createServer((req, res) => {
  try {
    handle(req, res);
  } catch (e) {
    // A defect of this harness, never a pass: the run fails.
    try { res.writeHead(500); res.end(); } catch { /* already sent */ }
    settle({ failure: `harness server error on ${req.method} ${redact(req.url)}: ${e?.message ?? e}` });
  }
});

function handle(req, res) {
  const host = `127.0.0.1:${port}`;
  const url = String(req.url);
  if (!url.startsWith(`/${token}/`)) {
    // Outside the token nothing is served; a browser's own probe (a DevTools well-known file) is counted, not failed.
    record.server.outside_token += 1;
    res.writeHead(404, { "cache-control": "no-store" });
    return res.end();
  }
  if (req.headers.host !== host) return refuse(req, res, 403, "unexpected Host");
  const rel = url.slice(token.length + 2);
  record.server.requests.push({ method: req.method, path: `<token>/${rel}` });
  if (rel === "result") {
    if (req.method !== "POST") return refuse(req, res, 405, "result takes POST");
    if (req.headers.origin !== `http://${host}`) return refuse(req, res, 403, "unexpected Origin");
    if (!String(req.headers["content-type"] || "").startsWith("application/json")) return refuse(req, res, 415, "result must be application/json");
    if (resultSeen) return refuse(req, res, 409, "a result was already received");
    resultSeen = true;
    const chunks = [];
    let size = 0;
    let over = false;
    req.on("data", (c) => {
      size += c.length;
      if (size > RESULT_LIMIT) { over = true; req.destroy(); } else chunks.push(c);
    });
    req.on("end", () => {
      if (over) return;
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end('{"received":true}');
      let body;
      try { body = JSON.parse(utf8(Buffer.concat(chunks))); } catch (e) { return settle({ failure: `the result is not UTF-8 JSON (${e.message})` }); }
      settle({ result: body });
    });
    req.on("close", () => { if (over) settle({ failure: `the result exceeds ${RESULT_LIMIT} bytes` }); });
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") return refuse(req, res, 405, "assets take GET");
  if (rel === "request") {
    const body = Buffer.from(JSON.stringify({ contract: CONTRACT, run_id: request.run_id, nonce: request.nonce, cases: pageCases, assets: PAGE_ASSETS, fault: FAULT }));
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
    return res.end(req.method === "HEAD" ? undefined : body);
  }
  const asset = assets.get(rel);
  if (!asset) return refuse(req, res, 404, "not in the allowlist");
  res.writeHead(200, {
    "content-type": asset.type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": CSP,
    "referrer-policy": "no-referrer",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
  });
  res.end(req.method === "HEAD" ? undefined : asset.bytes);
}

// ── Chrome ──
function findChrome() {
  const candidates = opts.chrome ? [opts.chrome] : [process.env.DCP_BROWSER_CHROME, process.env.CHROME_BIN].filter(Boolean);
  if (candidates.length === 0) {
    if (process.platform === "darwin") candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    for (const dir of (process.env.PATH || "").split(path.delimiter)) {
      for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) candidates.push(path.join(dir, name));
    }
  }
  return candidates.find((c) => { try { fs.accessSync(c, fs.constants.X_OK); return fs.statSync(c).isFile(); } catch { return false; } }) ?? null;
}

let chrome = null;
let chromeExited = null;
let profile = null;
function launchChrome(url) {
  const exe = findChrome();
  if (!exe) return settle({ failure: "no Chrome executable found (--chrome, DCP_BROWSER_CHROME or CHROME_BIN)" });
  record.browser.executable = exe;
  try { record.browser.version = execFileSync(exe, ["--version"], { encoding: "utf8", timeout: 20000, stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { record.browser.version = null; }
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-browser-profile-"));
  record.browser.profile = profile;
  const args = [
    "--headless=new", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--disable-background-networking", "--disable-component-update", "--disable-sync", "--disable-default-apps",
    // Only 127.0.0.1 resolves; the profile's secrets stay in this temporary directory, never in the user's keychain.
    "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1",
    process.platform === "darwin" ? "--use-mock-keychain" : "--password-store=basic",
    url,
  ];
  chrome = spawn(exe, args, { stdio: ["ignore", "ignore", "ignore"] });
  chrome.on("error", (e) => settle({ failure: `cannot start Chrome: ${e.message}` }));
  chromeExited = new Promise((resolve) => chrome.on("exit", (code, signal) => resolve({ code, signal })));
  chromeExited.then(({ code, signal }) => settle({ failure: `Chrome exited before a result (code ${code}, signal ${signal})` }));
}

async function stopChrome() {
  if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
    chrome.kill("SIGTERM");
    const t = new Promise((r) => setTimeout(() => r("timeout"), 5000));
    if ((await Promise.race([chromeExited, t])) === "timeout") {
      chrome.kill("SIGKILL");
      await Promise.race([chromeExited, new Promise((r) => setTimeout(r, 2000))]);
    }
  }
  // Only this run's own child is ever signalled; its exit is recorded so that the cleanup can be checked.
  if (chrome) record.browser.exit = chrome.exitCode !== null || chrome.signalCode !== null ? { code: chrome.exitCode, signal: chrome.signalCode } : "not observed";
  if (profile) {
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* reported below */ }
    record.browser.profile_removed = !fs.existsSync(profile);
  }
}

// Stopped from outside, or a defect of this harness: this run's own Chrome and profile go, and the run fails.
function abort(why) {
  try { chrome?.kill("SIGKILL"); } catch { /* gone */ }
  try { if (profile) fs.rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
  record.outcome = "failed";
  record.failure = why;
  writeRecord();
  process.stderr.write(`wasm-browser wrapper: ${why}\n`);
  process.exit(1);
}
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => abort(`stopped by ${sig}`));
process.on("uncaughtException", (e) => abort(`harness defect: ${e?.stack ?? e}`));
process.on("unhandledRejection", (e) => abort(`harness defect: ${e?.stack ?? e}`));

// ── The page's result ──
function checkResult(r) {
  const keys = ["run_id", "nonce", "terminal", "error", "environment", "api", "received_sha256", "clock", "results"];
  if (!exactKeys(r, keys)) return "the result has other fields than " + keys.join(", ");
  record.page = { terminal: r.terminal, error: r.error, environment: r.environment, api: r.api, received_sha256: r.received_sha256, clock: r.clock, results: Array.isArray(r.results) ? r.results.length : null };
  record.browser.user_agent = r.environment?.user_agent ?? null;
  if (r.terminal !== "done") return `the page did not finish: ${r.terminal} (${r.error})`;
  if (r.error !== null) return `the page says done and also reports an error: ${r.error}`;
  if (r.run_id !== request.run_id || r.nonce !== request.nonce) return "the result's run_id or nonce is not this run's";
  const env = r.environment;
  if (!isObj(env) || typeof env.user_agent !== "string" || env.node_absent !== true || env.secure_context !== true) return "the page's environment is not a browser page (node_absent, secure_context, user_agent)";
  for (const k of ["module", "prototype", "raw"]) {
    if (!Array.isArray(r.api?.[k]) || JSON.stringify(r.api[k]) !== JSON.stringify(EXPECTED_API[k])) return `the ${k} exports differ from browser/expected-api.json: ${JSON.stringify(r.api?.[k])}`;
  }
  for (const rel of PAGE_ASSETS) {
    if (r.received_sha256?.[rel] !== record.served_sha256[rel]) return `${rel}: the page received ${r.received_sha256?.[rel]}, the server sent ${record.served_sha256[rel]}`;
  }
  if (!Array.isArray(r.results)) return "results is not an array";
  // Each bundle case called verifyBundle under the shim, or was answered rejected/parse before it, by its id.
  const verifyIds = new Set(pageCases.filter((c) => c.op === "verify_signed_bundle_v2").map((c) => c.id));
  const c = r.clock;
  if (!isObj(c) || !Number.isSafeInteger(c.calls) || !Array.isArray(c.not_called) || c.restored_every_time !== true) return `the clock shim: ${JSON.stringify(c)}`;
  const skipped = c.not_called.map((x) => x?.id);
  if (new Set(skipped).size !== skipped.length || !skipped.every((id) => verifyIds.has(id))) return `the clock shim names unknown or repeated cases: ${JSON.stringify(skipped)}`;
  for (const id of skipped) {
    const answer = r.results.find((x) => x?.id === id);
    if (answer?.status !== "rejected" || answer.code !== "parse") return `case ${id} did not reach verifyBundle but is not answered rejected/parse`;
  }
  if (c.calls + skipped.length !== verifyIds.size) return `the clock shim: ${c.calls} calls and ${skipped.length} parse rejections for ${verifyIds.size} bundle cases`;
  if (typeof c.now_after !== "number" || Math.abs(c.now_after - Date.now()) > 10 * 60 * 1000) return "Date.now in the page is not the host clock after the run";
  return null;
}

server.listen(0, "127.0.0.1", async () => {
  port = server.address().port;
  const url = `http://127.0.0.1:${port}/${token}/`;
  const deadline = opts.deadlineMs ?? { 1: 25_000, direct: 60_000 }[CONTRACT] ?? 280_000;
  setTimeout(() => settle({ failure: `no result within ${deadline} ms` }), deadline).unref();
  if (pageCases.length === 0) settle({ result: null });
  else if (opts.manual) {
    fs.writeFileSync(opts.urlFile, url + "\n");
    process.stderr.write(`wasm-browser wrapper: open ${url} (written to ${opts.urlFile})\n`);
  } else launchChrome(url);

  const outcome = await done;
  // A short grace before closing, so that a request after the result (a second post) is still seen and refused.
  if (outcome.result) await new Promise((r) => setTimeout(r, 500));
  await stopChrome();
  server.closeAllConnections?.();
  server.close();

  let failure = outcome.failure ?? null;
  if (!failure && outcome.result !== null) failure = checkResult(outcome.result);
  if (!failure && record.server.refused.length) failure = `refused requests: ${JSON.stringify(record.server.refused)}`;
  if (failure) {
    record.outcome = "failed";
    record.failure = failure;
    writeRecord();
    process.stderr.write(`wasm-browser wrapper: ${failure}\n`);
    process.exit(1);
  }
  record.outcome = "responded";
  if (!writeRecord()) process.exit(1);
  const ua = outcome.result?.environment.user_agent ?? "no case reached the browser";
  process.stdout.write(JSON.stringify({
    contract: request.contract,
    run_id: request.run_id,
    nonce: request.nonce,
    implementation: {
      name: "@dcp-ai/wasm public API (initDcp, DcpWasm) in a real browser via tools/conformance/wrappers/wasm-browser.mjs",
      version,
      resolved_from: `${opts.root} (pkg/dcp_ai_bg.wasm sha256 ${record.served_sha256["pkg/dcp_ai_bg.wasm"]}, dist/index.js sha256 ${record.served_sha256["dist/index.js"]})`,
      runtime: [
        `${record.browser.mode} browser: ${ua}${record.browser.version ? ` (${record.browser.version})` : ""}`,
        CONTRACT === "direct"
          ? "direct DcpWasm method calls (internal request dcp-ai-browser-direct/1, not a kit contract), raw observations"
          : "each case through DcpWasm methods after JSON.parse of its bytes in the page, not the original bytes and not the raw wasm-bindgen exports",
        CONTRACT === 1 || CONTRACT === "direct" ? null : "host clock (Date.now) substituted by verification_time during each verifyBundle call",
        FAULT ? `FAULT INJECTED: ${FAULT}` : null,
      ].filter(Boolean).join("; "),
    },
    results: [...(outcome.result?.results ?? []), ...local],
  }) + "\n", (e) => process.exit(e ? 1 : 0)); // exit only once the pipe has taken the whole response
});
