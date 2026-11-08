// Self-tests of the browser harness (wrappers/wasm-browser.mjs, wrappers/browser/*): a positive control through the
// runner, the clock shim, a bundle the page cannot parse, the direct sections, and the controls that must never pass:
// faults injected through DCP_CONFORMANCE_WRAPPER_FAULT (self-tests only), an unwritable record, a missing Chrome, and
// requests the loopback server must refuse (sent in manual mode, where no browser starts).
//
//   DCP_BROWSER_ROOT=sdks/wasm DCP_EXTERNAL_REQUIRE_BROWSER=1 node --test tools/conformance/external-browser.test.mjs
//
// DCP_BROWSER_ROOT: a directory with dist/ and pkg/ (default sdks/wasm). Chrome: DCP_BROWSER_CHROME, CHROME_BIN, the
// macOS application or google-chrome/chromium on PATH. Without DCP_EXTERNAL_REQUIRE_BROWSER=1 a missing build or Chrome
// skips, and says so; with it, they fail. Every Chrome run uses a temporary profile, removed afterwards.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { spawn, spawnSync } from "child_process";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const CLI = path.join(REPO, "tools", "conformance-external.js");
const WRAPPER = path.join(HERE, "wrappers", "wasm-browser.mjs");
const DIRECT = path.join(HERE, "wrappers", "browser", "direct-sections.mjs");
const ROOT = path.resolve(REPO, process.env.DCP_BROWSER_ROOT ?? "sdks/wasm");
const REQUIRE = process.env.DCP_EXTERNAL_REQUIRE_BROWSER === "1";
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-browser-test-"));
process.on("exit", () => fs.rmSync(TMP, { recursive: true, force: true }));

function chromeFound() {
  const c = [process.env.DCP_BROWSER_CHROME, process.env.CHROME_BIN].filter(Boolean);
  if (c.length === 0) {
    if (process.platform === "darwin") c.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    for (const dir of (process.env.PATH || "").split(path.delimiter)) for (const n of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) c.push(path.join(dir, n));
  }
  return c.some((p) => { try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; } });
}
const BUILT = fs.existsSync(path.join(ROOT, "dist", "index.js")) && fs.existsSync(path.join(ROOT, "pkg", "dcp_ai_bg.wasm"));
const CHROME = chromeFound();
function available(t, { browser = true } = {}) {
  const why = !BUILT ? `no build at ${ROOT}` : browser && !CHROME ? "no Chrome found" : null;
  if (!why) return true;
  if (REQUIRE) assert.fail(`${why} (DCP_EXTERNAL_REQUIRE_BROWSER=1)`);
  t.skip(`${why}: NOT run`);
  return false;
}

let n = 0;
const record = () => path.join(TMP, `record-${++n}.json`);
const readRecord = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null);
// The wrapper alone, with one request on stdin.
function wrap(request, { fault, args = [], root = ROOT } = {}) {
  const file = record();
  const env = { ...process.env };
  delete env.DCP_CONFORMANCE_WRAPPER_FAULT;
  if (fault) env.DCP_CONFORMANCE_WRAPPER_FAULT = fault;
  const r = spawnSync(process.execPath, [WRAPPER, "--root", root, "--browser-report", file, ...args], { input: JSON.stringify(request), env, timeout: 300000, maxBuffer: 16 * 1024 * 1024 });
  let json = null;
  try { json = JSON.parse(r.stdout.toString("utf8")); } catch { /* checked by the caller */ }
  return { code: r.status, json, stdout: r.stdout.toString("utf8"), stderr: r.stderr.toString("utf8"), record: readRecord(file) };
}
// The runner over the wrapper.
function runner(args, { fault } = {}) {
  const report = path.join(TMP, `report-${++n}.json`);
  const env = { ...process.env };
  delete env.DCP_CONFORMANCE_WRAPPER_FAULT;
  if (fault) env.DCP_CONFORMANCE_WRAPPER_FAULT = fault;
  const r = spawnSync(process.execPath, [CLI, "--report", report, ...args, "--", process.execPath, WRAPPER, "--root", ROOT], { encoding: "utf8", env, timeout: 600000 });
  return { code: r.status, report: JSON.parse(fs.readFileSync(report, "utf8")), stderr: r.stderr };
}

const B = JSON.parse(fs.readFileSync(path.join(REPO, "tests/interop/v2/bundle_vectors.json"), "utf8"));
const V2 = (cases) => ({ contract: "dcp-ai-conformance-external/2", run_id: `r-${++n}`, nonce: `n-${n}`, cases });
const verifyAt = (id, time) => ({ id, op: "verify_signed_bundle_v2", bundle_b64: Buffer.from(JSON.stringify(B.signed_bundle)).toString("base64"), policy: B.default_verifier_policy, verification_time: time });
const leaf = { sha256: "a".repeat(64), sha3_256: "b".repeat(64) };
const merkle = (id) => ({ id, op: "dual_merkle_root", leaves: [leaf] });
const SMALL = () => V2([verifyAt("v", "2026-10-22T00:00:00Z"), merkle("m")]);

function cleanRun(rec) {
  assert.ok(rec, "the record was written");
  assert.equal(rec.browser.profile_removed, true, "the temporary profile is removed");
  assert.notEqual(rec.browser.exit, undefined, "this run's own Chrome exit is recorded");
  assert.notEqual(rec.browser.exit, "not observed", "this run's own Chrome exited");
}

// ── Positive ──

test("positive control: /1 through the runner, 38/38, artifacts and exports as served, clean exit", { timeout: 120000 }, (t) => {
  if (!available(t)) return;
  const file = record();
  const report = path.join(TMP, `report-${++n}.json`);
  const r = spawnSync(process.execPath, [CLI, "--report", report, "--", process.execPath, WRAPPER, "--root", ROOT, "--browser-report", file], { encoding: "utf8", timeout: 120000 });
  const rep = JSON.parse(fs.readFileSync(report, "utf8"));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(rep.totals, { cases: 38, executed: 38, pass: 38, fail: 0, error: 0 });
  assert.match(rep.implementation.self_declared.runtime, /^automatic browser: .*HeadlessChrome\//);
  const rec = readRecord(file);
  assert.equal(rec.outcome, "responded");
  assert.deepEqual(rec.page.received_sha256, Object.fromEntries(Object.entries(rec.served_sha256).filter(([k]) => !k.endsWith(".map"))));
  assert.deepEqual(rec.server.refused, []);
  cleanRun(rec);
});

test("clock: the base bundle rejects at 2020, accepts at 2026 and rejects at 2100", { timeout: 120000 }, (t) => {
  if (!available(t)) return;
  const r = wrap(V2([verifyAt("a", "2020-01-01T00:00:00Z"), verifyAt("b", "2026-10-22T00:00:00Z"), verifyAt("c", "2100-01-01T00:00:00Z")]));
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.json.results.map((x) => [x.id, x.verified]), [["a", false], ["b", true], ["c", false]]);
  assert.equal(r.record.page.clock.calls, 3);
  assert.equal(r.record.page.clock.restored_every_time, true);
});

test("a bundle the page cannot parse is rejected/parse before verifyBundle, beside a valid control", { timeout: 120000 }, (t) => {
  if (!available(t)) return;
  const r = wrap(V2([{ ...verifyAt("broken", "2026-10-22T00:00:00Z"), bundle_b64: Buffer.from("{").toString("base64") }, verifyAt("control", "2026-10-22T00:00:00Z")]));
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.json.results.find((x) => x.id === "broken"), { id: "broken", status: "rejected", code: "parse" });
  assert.equal(r.json.results.find((x) => x.id === "control").verified, true);
  assert.equal(r.record.page.clock.calls, 1);
  assert.deepEqual(r.record.page.clock.not_called.map((x) => x.id), ["broken"]);
});

test("the shim is restored after the call throws (fault verify-throws), and the response says it is faulted", { timeout: 120000 }, (t) => {
  if (!available(t)) return;
  const r = wrap(V2([verifyAt("v", "2020-01-01T00:00:00Z"), merkle("m")]), { fault: "verify-throws" });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.json.results[0].message, /thrown inside the call at 1577836800000/);
  assert.equal(r.json.results[0].status, "error");
  assert.match(r.json.implementation.runtime, /FAULT INJECTED: verify-throws/);
  assert.equal(r.record.page.clock.restored_every_time, true);
});

test("direct sections: domainSeparatedMessage 20, computeSecurityTier 79, P-ED-1 classical_only 2, hybrid round trip 2", { timeout: 180000 }, (t) => {
  if (!available(t)) return;
  const report = path.join(TMP, `direct-${++n}.json`);
  const r = spawnSync(process.execPath, [DIRECT, "--report", report, "--root", ROOT], { encoding: "utf8", timeout: 180000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const rep = JSON.parse(fs.readFileSync(report, "utf8"));
  assert.deepEqual(Object.fromEntries(Object.entries(rep.sections).map(([k, v]) => [k, [v.cases, v.pass]])), {
    domain_separation: [20, 20], security_tier: [79, 79], ped1_classical_only: [2, 2], hybrid_roundtrip: [2, 2],
  });
});

test("the direct judge fails a missing, a repeated, a thrown and an altered answer, in every section", { timeout: 300000 }, (t) => {
  if (!available(t)) return;
  const judge = (fault) => {
    const report = path.join(TMP, `direct-${++n}.json`);
    const r = spawnSync(process.execPath, [DIRECT, "--report", report, "--root", ROOT], { encoding: "utf8", timeout: 180000, env: { ...process.env, DCP_CONFORMANCE_WRAPPER_FAULT: fault } });
    return { code: r.status, report: JSON.parse(fs.readFileSync(report, "utf8")) };
  };
  const failed = (rep) => rep.cases.filter((c) => !c.pass);
  const missing = judge("drop-case");
  assert.equal(missing.code, 1);
  assert.deepEqual(failed(missing.report).map((c) => c.why), ["missing"]);
  const repeated = judge("duplicate-answer");
  assert.equal(repeated.code, 1);
  assert.deepEqual(failed(repeated.report).map((c) => c.why), ["duplicate"]);
  const thrown = judge("error-for-rejection");
  assert.equal(thrown.code, 1);
  assert.deepEqual(failed(thrown.report).map((c) => c.observed.kind), ["throw"]);
  const altered = judge("invert-verdict");
  assert.equal(altered.code, 1);
  assert.deepEqual(Object.fromEntries(Object.entries(altered.report.sections).map(([k, v]) => [k, v.fail])), {
    domain_separation: 1, security_tier: 1, ped1_classical_only: 1, hybrid_roundtrip: 1,
  });
  for (const r of [missing, repeated, thrown, altered]) assert.match(r.report.implementation.runtime, /FAULT INJECTED/);
});

// ── Requests refused before any browser ──

test("/3, /4 and unknown contracts are refused with exit 2 (D-04 = A), as are malformed requests", (t) => {
  if (!available(t, { browser: false })) return;
  for (const contract of ["dcp-ai-conformance-external/3", "dcp-ai-conformance-external/4", "dcp-ai-conformance-external/9"]) {
    const r = wrap({ contract, run_id: "r", nonce: "n", cases: [] });
    assert.equal(r.code, 2, contract);
    assert.equal(r.stdout, "");
  }
  for (const [label, c] of [
    ["empty leaves", { id: "c", op: "dual_merkle_root", leaves: [] }],
    ["a time without a zone", verifyAt("c", "2026-10-22T00:00:00")],
    ["policy as an array", { ...verifyAt("c", "2026-10-22T00:00:00Z"), policy: [] }],
    ["an unknown field", { ...verifyAt("c", "2026-10-22T00:00:00Z"), extra: 1 }],
  ]) assert.equal(wrap(V2([c])).code, 2, label);
  assert.equal(wrap(V2([merkle("x"), merkle("x")])).code, 2, "a repeated id");
  assert.equal(wrap({ contract: "dcp-ai-browser-direct/1", run_id: "r", nonce: "n", cases: [{ id: "d", call: "mlKem768Keygen" }] }).code, 2, "a direct call outside the list");
});

// ── Controls that must fail the run: exit 1, no response ──

for (const [fault, why, args] of [
  ["corrupt-wasm", /the page did not finish: infrastructure_failure/],
  ["bad-nonce", /run_id or nonce is not this run's/],
  ["wrong-hash", /pkg\/dcp_ai_bg\.wasm: the page received 0{64}/],
  ["extra-export", /module exports differ/],
  ["clock-not-restored", /clock shim/],
  ["unexpected-request", /not in the allowlist/],
  ["duplicate-post", /a result was already received/],
  ["done-with-error", /says done and also reports an error/],
  ["no-result", /no result within 8000 ms/, ["--deadline-ms", "8000"]],
]) {
  test(`fault ${fault}: the run fails and cleans up`, { timeout: 120000 }, (t) => {
    if (!available(t)) return;
    const r = wrap(SMALL(), { fault, args });
    assert.equal(r.code, 1, r.stderr);
    assert.equal(r.stdout, "", "no response");
    assert.equal(r.record.outcome, "failed");
    assert.match(r.record.failure, why);
    cleanRun(r.record);
  });
}

test("a stale artifact fails: an export missing from the build, a manifest that does not match", { timeout: 120000 }, (t) => {
  if (!available(t)) return;
  const stale = path.join(TMP, `stale-${++n}`);
  fs.cpSync(path.join(ROOT, "dist"), path.join(stale, "dist"), { recursive: true });
  fs.cpSync(path.join(ROOT, "pkg"), path.join(stale, "pkg"), { recursive: true });
  const glue = path.join(stale, "pkg", "dcp_ai.js");
  const text = fs.readFileSync(glue, "utf8");
  assert.ok(text.includes("export function wasm_canonicalize_v2_result("), "the build has the export to remove");
  fs.writeFileSync(glue, text.replace("export function wasm_canonicalize_v2_result(", "function wasm_canonicalize_v2_result("));
  const r = wrap(SMALL(), { root: stale });
  assert.equal(r.code, 1);
  assert.match(r.record.failure, /the raw exports differ/);
  cleanRun(r.record);
  const manifest = path.join(TMP, `SHA256SUMS-${++n}`);
  fs.writeFileSync(manifest, `${"0".repeat(64)}  ./dist/index.js\n`);
  const m = wrap(SMALL(), { args: ["--manifest", manifest] });
  assert.equal(m.code, 1);
  assert.match(m.record.failure, /dist\/index\.js does not match/);
  // A real build from before MP-03 P1, when one is given (not in CI).
  if (process.env.DCP_BROWSER_STALE_ROOT) {
    const before = wrap(SMALL(), { root: path.resolve(process.env.DCP_BROWSER_STALE_ROOT) });
    assert.equal(before.code, 1);
    assert.match(before.record.failure, /exports differ/);
  }
});

test("a requested --browser-report that cannot be written fails the run", { timeout: 120000 }, (t) => {
  if (!available(t)) return;
  const r = spawnSync(process.execPath, [WRAPPER, "--root", ROOT, "--browser-report", path.join(TMP, "no-such-dir", "record.json")], { input: JSON.stringify(SMALL()), timeout: 120000 });
  assert.equal(r.status, 1);
  assert.equal(r.stdout.toString(), "");
  assert.match(r.stderr.toString(), /cannot write the --browser-report/);
});

test("no Chrome: exit 1 through the wrapper, every case an error through the runner", { timeout: 60000 }, (t) => {
  if (!available(t, { browser: false })) return;
  const r = wrap(SMALL(), { args: ["--chrome", path.join(TMP, "no-chrome")] });
  assert.equal(r.code, 1);
  assert.match(r.record.failure, /no Chrome executable found/);
  const report = path.join(TMP, `report-${++n}.json`);
  const x = spawnSync(process.execPath, [CLI, "--report", report, "--", process.execPath, WRAPPER, "--root", ROOT, "--chrome", path.join(TMP, "no-chrome")], { encoding: "utf8", timeout: 60000 });
  assert.notEqual(x.status, 0);
  assert.equal(JSON.parse(fs.readFileSync(report, "utf8")).totals.pass, 0);
});

// ── Controls the runner must judge as not passing ──

test("faults the runner judges: a dropped case, an error for a rejection, an inverted verdict", { timeout: 300000 }, (t) => {
  if (!available(t)) return;
  const dropped = runner([], { fault: "drop-case" });
  assert.notEqual(dropped.code, 0);
  assert.equal(dropped.report.totals.pass, 37);
  const errored = runner([], { fault: "error-for-rejection" });
  assert.notEqual(errored.code, 0);
  assert.equal(errored.report.totals.error, 1);
  const inverted = runner(["--catalog", "evidence", "--assessment", "verdict", "--suite", "external.v2.secondary_sha3"], { fault: "invert-verdict" });
  assert.equal(inverted.code, 1);
  assert.equal(inverted.report.totals.fail, 1);
  for (const r of [dropped, errored, inverted]) assert.match(r.report.implementation.self_declared.runtime, /FAULT INJECTED/);
});

// ── The loopback server, probed in manual mode (no browser starts) ──

function startManual() {
  const urlFile = path.join(TMP, `url-${++n}.txt`);
  const file = record();
  const child = spawn(process.execPath, [WRAPPER, "--root", ROOT, "--manual", "--url-file", urlFile, "--deadline-ms", "15000", "--browser-report", file], { stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.end(JSON.stringify(SMALL()));
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  return { urlFile, file, child, exited };
}
async function urlOf(m) {
  for (let i = 0; i < 200 && !fs.existsSync(m.urlFile); i++) await new Promise((r) => setTimeout(r, 50));
  return new URL(fs.readFileSync(m.urlFile, "utf8").trim());
}
function probe(url, { method = "GET", path: p, headers = {}, body } = {}) {
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port: url.port, method, path: p ?? url.pathname, headers }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers }));
    });
    req.on("error", (e) => resolve({ status: null, error: e.code }));
    req.end(body);
  });
}

test("server: headers, outside the token, and the requests it refuses (each ends the run)", { timeout: 180000 }, async (t) => {
  if (!available(t, { browser: false })) return;
  const m = startManual();
  const url = await urlOf(m);
  const ok = await probe(url);
  assert.equal(ok.status, 200);
  assert.match(ok.headers["content-security-policy"], /default-src 'none'; script-src 'self' 'wasm-unsafe-eval'/);
  assert.equal(ok.headers["cache-control"], "no-store");
  assert.equal(ok.headers["access-control-allow-origin"], undefined);
  assert.equal((await probe(url, { path: "/" })).status, 404);
  assert.equal((await probe(url, { path: "/pkg/dcp_ai_bg.wasm" })).status, 404, "nothing outside the token");
  m.child.kill("SIGTERM");
  await m.exited;
  assert.equal(readRecord(m.file).server.outside_token, 2);

  const origin = (u) => `http://127.0.0.1:${u.port}`;
  for (const [label, make, status, why] of [
    ["a foreign Host", (u) => ({ headers: { host: "dcp.example" } }), 403, /unexpected Host/],
    ["a directory", (u) => ({ path: `${u.pathname}dist/` }), 404, /not in the allowlist/],
    ["a path escaping the token", (u) => ({ path: `${u.pathname}../pkg/dcp_ai.js` }), 404, /not in the allowlist/],
    ["a POST to an asset", (u) => ({ method: "POST", path: `${u.pathname}page.mjs`, headers: { origin: origin(u) } }), 405, /assets take GET/],
    ["a GET of the result", (u) => ({ path: `${u.pathname}result` }), 405, /result takes POST/],
    ["a result from another Origin", (u) => ({ method: "POST", path: `${u.pathname}result`, headers: { origin: "http://dcp.example", "content-type": "application/json" }, body: "{}" }), 403, /unexpected Origin/],
    ["a result that is not JSON", (u) => ({ method: "POST", path: `${u.pathname}result`, headers: { origin: origin(u), "content-type": "text/plain" }, body: "x" }), 415, /application\/json/],
  ]) {
    const run = startManual();
    const u = await urlOf(run);
    const res = await probe(u, make(u));
    assert.equal(res.status, status, label);
    assert.equal(await run.exited, 1, `${label}: the run fails`);
    assert.match(readRecord(run.file).failure, why, label);
  }

  // A well-formed post with another run's nonce, and one over the size limit.
  const stale = startManual();
  const su = await urlOf(stale);
  const body = JSON.stringify({ run_id: "other", nonce: "other", terminal: "done", error: null, environment: {}, api: {}, received_sha256: {}, clock: {}, results: [] });
  assert.equal((await probe(su, { method: "POST", path: `${su.pathname}result`, headers: { origin: origin(su), "content-type": "application/json" }, body })).status, 200);
  assert.equal(await stale.exited, 1);
  assert.match(readRecord(stale.file).failure, /environment is not a browser page|run_id or nonce/);
  const big = startManual();
  const bu = await urlOf(big);
  await probe(bu, { method: "POST", path: `${bu.pathname}result`, headers: { origin: origin(bu), "content-type": "application/json" }, body: Buffer.alloc(9 * 1024 * 1024, 32) });
  assert.equal(await big.exited, 1);
  assert.match(readRecord(big.file).failure, /exceeds/);
});
