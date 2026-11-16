// Self-tests of the external conformance runner (tools/conformance-external.js): the two wrappers, one
// parameterized control written to a temporary directory, fake SDKs, and catalog and fixture defects on
// temporary copies. Nothing in the checkout is written.
//
//   node --test tools/conformance/external.test.mjs
//   DCP_EXTERNAL_PYTHON=/path/to/python [DCP_EXTERNAL_REQUIRE_PYTHON=1] node --test tools/conformance/external.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn, spawnSync } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const CLI = path.join(REPO, "tools", "conformance-external.js");
const TS_WRAPPER = path.join(HERE, "wrappers", "ts-sdk.mjs");
const PY_WRAPPER = path.join(HERE, "wrappers", "python_sdk.py");
const CATALOG = path.join(HERE, "external-catalog.json");
const SDK_URL = import.meta.resolve("@dcp-ai/sdk");
const MERKLE_URL = pathToFileURL(path.join(REPO, "tools", "merkle.js")).href;
const PYTHON = process.env.DCP_EXTERNAL_PYTHON;
const REQUIRE_PYTHON = process.env.DCP_EXTERNAL_REQUIRE_PYTHON === "1";
const FRACTIONS = ["non_integer_float_rejected", "fractional_rejected", "scientific_fractional_rejected"].map((n) => `external.dcp-jcs-v1.canonicalize.edge.${n}`);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-external-"));
process.on("exit", () => fs.rmSync(TMP, { recursive: true, force: true }));

// One control implementation; argv[2] picks the behaviour. It computes correct answers with the real SDK.
const CONTROL = path.join(TMP, "control.mjs");
fs.writeFileSync(CONTROL, `
import fs from "fs";
import { spawn } from "child_process";
const mode = process.argv[2];
const sdk = await import(process.env.CONTROL_SDK);
const req = JSON.parse(fs.readFileSync(0, "utf8"));
const correct = (c) => {
  const input = Buffer.from(c.input_b64, "base64");
  if (c.op === "digest") return { id: c.id, status: "ok", hex: c.alg === "sha256" ? sdk.sha256Hex(input) : sdk.sha3_256Hex(input) };
  let v;
  try { v = JSON.parse(input.toString("utf8")); } catch { return { id: c.id, status: "rejected", code: "parse" }; }
  try { return { id: c.id, status: "ok", output_b64: Buffer.from(sdk.canonicalizeV2(v), "utf8").toString("base64") }; }
  catch { return { id: c.id, status: "rejected", code: "profile" }; }
};
const results = req.cases.map(correct);
const resp = { contract: req.contract, run_id: req.run_id, nonce: req.nonce, implementation: { name: "control", version: mode }, results };
const out = (v, cb) => process.stdout.write(typeof v === "string" || Buffer.isBuffer(v) ? v : JSON.stringify(v), cb);
const first = (op) => results.find((r) => req.cases.find((c) => c.id === r.id).op === op);
switch (mode) {
  case "correct": out(resp); break;
  case "flip-byte": { const r = first("canonicalize"); const b = Buffer.from(r.output_b64, "base64"); b[b.length - 1] ^= 1; r.output_b64 = b.toString("base64"); out(resp); break; }
  case "reject-all": resp.results = req.cases.map((c) => ({ id: c.id, status: "rejected", code: "profile" })); out(resp); break;
  case "omit-one": results.pop(); out(resp); break;
  case "duplicate-one": results.push({ ...results[0] }); out(resp); break;
  case "extra-one": results.push({ id: "not-sent", status: "unsupported" }); out(resp); break;
  case "wrong-nonce": resp.nonce = "0".repeat(32); out(resp); break;
  case "wrong-run-id": resp.run_id = "00000000-0000-4000-8000-000000000000"; out(resp); break;
  case "record": fs.writeFileSync(process.argv[3], JSON.stringify(resp)); out(resp); break;
  case "replay": out(fs.readFileSync(process.argv[3])); break;
  case "sleep-ignore-term": process.on("SIGTERM", () => {}); setInterval(() => {}, 1000); break;
  case "close-stdout-stay": fs.closeSync(1); setInterval(() => {}, 1000); break;
  case "leader-exits-grandchild": {
    const g = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: ["ignore", "inherit", "inherit"] });
    fs.writeFileSync(process.argv[3], String(g.pid));
    out(resp, () => { g.unref(); });
    break;
  }
  case "leader-exits-detached-stdio": {
    const g = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    fs.writeFileSync(process.argv[3], String(g.pid));
    out(resp, () => { g.unref(); });
    break;
  }
  case "flood-stdout": { const chunk = Buffer.alloc(1 << 20, 0x20); const more = () => { while (process.stdout.write(chunk)); process.stdout.once("drain", more); }; more(); break; }
  case "flood-stderr": process.stderr.write(Buffer.alloc(1 << 20, 0x61)); out(resp); break;
  case "invalid-json": out("{not json"); break;
  case "invalid-utf8": out(Buffer.from([0x7b, 0xff, 0x7d])); break;
  case "trailing-data": out(JSON.stringify(resp) + " x"); break;
  case "unknown-top-field": resp.extra = 1; out(resp); break;
  case "unknown-impl-field": resp.implementation.build = "x"; out(resp); break;
  case "late-exit": out(resp); process.exitCode = 1; break;
  case "self-kill": out(resp, () => process.kill(process.pid, "SIGKILL")); break;
  case "unsupported-digest": resp.results = req.cases.map((c) => (c.op === "digest" ? { id: c.id, status: "unsupported" } : correct(c))); out(resp); break;
  case "upper-hex": { const r = first("digest"); r.hex = r.hex.toUpperCase(); out(resp); break; }
  case "bad-base64": { const r = first("canonicalize"); r.output_b64 += "\\n"; out(resp); break; }
  case "unknown-result-field": results[0].note = "x"; out(resp); break;
  case "ok-no-output": delete first("canonicalize").output_b64; out(resp); break;
  case "malformed-ok-on-reject": {
    // An ok with invalid base64 on a case the runner expects to be rejected: the format is judged first.
    resp.results = req.cases.map((c) => (correct(c).status === "rejected" ? { id: c.id, status: "ok", output_b64: "%%%" } : correct(c)));
    out(resp);
    break;
  }
  case "impl-error": results[0] = { id: results[0].id, status: "error", message: "boom" }; out(resp); break;
  case "argv-echo": resp.implementation.name = JSON.stringify(process.argv.slice(3)); out(resp); break;
  case "copy-request": out(req); break;
  default: process.stderr.write("unknown mode " + mode); process.exitCode = 2;
}
`);

// Fake TS SDKs for the wrapper's --sdk.
const fake = (name, body) => { const f = path.join(TMP, name); fs.writeFileSync(f, body); return f; };
const REAL = `import * as real from ${JSON.stringify(SDK_URL)};\nexport const sha256Hex = real.sha256Hex, sha3_256Hex = real.sha3_256Hex;\n`;
const FAKE_ACCEPTS_FRACTIONS = fake("sdk-accepts-fractions.mjs", REAL + "export function canonicalizeV2(v) { try { return real.canonicalizeV2(v); } catch { return JSON.stringify(v); } }\n");
const FAKE_INTERNAL_ERROR = fake("sdk-internal-error.mjs", REAL + 'export function canonicalizeV2() { throw new TypeError("internal failure"); }\n');
const FAKE_OTHER_ERROR_MESSAGE = fake("sdk-other-error.mjs", REAL + 'export function canonicalizeV2() { throw new Error("Float handling crashed"); }\n');
const FAKE_HISTORICAL = fake("sdk-historical.mjs", REAL + `export { canonicalize as canonicalizeV2 } from ${JSON.stringify(MERKLE_URL)};\n`);

let n = 0;
function run(args, { env = {}, report = path.join(TMP, `report-${++n}.json`) } = {}) {
  const r = spawnSync(process.execPath, [CLI, "--report", report, ...args], {
    encoding: "utf8", env: { ...process.env, CONTROL_SDK: SDK_URL, ...env }, timeout: 60000,
  });
  let parsed = null;
  try { parsed = JSON.parse(fs.readFileSync(report, "utf8")); } catch { /* checked by the caller */ }
  return { code: r.status, report: parsed, stdout: r.stdout, stderr: r.stderr };
}
const control = (mode, ...extra) => ["--", process.execPath, CONTROL, mode, ...extra];
const cases = (report) => report.suites.flatMap((s) => s.cases);
const byStatus = (report, status) => cases(report).filter((c) => c.status === status);
const kinds = (report) => [...new Set(cases(report).map((c) => c.kind).filter(Boolean))].sort();
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// ── Positive ────────────────────────────────────────────────────

test("P1: the TS wrapper passes 38/38 and reports what it loaded", () => {
  const r = run(["--", process.execPath, TS_WRAPPER]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.report.status, "pass");
  assert.deepEqual(r.report.totals, { cases: 38, executed: 38, pass: 38, fail: 0, error: 0 });
  assert.equal(r.report.implementation.self_declared.resolved_from, fileURLToPath(SDK_URL));
  assert.match(r.report.implementation.self_declared.version, /^\d+\.\d+\.\d+$/);
  assert.match(r.report.kit.catalog_sha256, /^[0-9a-f]{64}$/);
  assert.equal(Object.keys(r.report.kit.fixtures_sha256).length, 2);
  assert.match(r.report.run.request_sha256, /^[0-9a-f]{64}$/);
});

test("P2: the Python wrapper passes 38/38 with the installed dcp_ai", (t) => {
  if (!PYTHON) {
    if (REQUIRE_PYTHON) assert.fail("DCP_EXTERNAL_REQUIRE_PYTHON=1 but DCP_EXTERNAL_PYTHON is not set");
    t.skip("DCP_EXTERNAL_PYTHON is not set: the Python wrapper was NOT run");
    return;
  }
  const r = run(["--", PYTHON, "-I", PY_WRAPPER]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.deepEqual(r.report.totals, { cases: 38, executed: 38, pass: 38, fail: 0, error: 0 });
  assert.match(r.report.implementation.self_declared.version, /^\d+\.\d+\.\d+/);
});

test("P3: selecting only external.digest runs and claims 8 cases", () => {
  const r = run(["--suite", "external.digest", "--", process.execPath, TS_WRAPPER]);
  assert.equal(r.code, 0);
  assert.deepEqual(r.report.selection, ["external.digest"]);
  assert.equal(r.report.totals.pass, 8);
});

// ── Wrong or incomplete implementations ─────────────────────────

test("F3/N1: the historical json-stable-stringify path fails exactly the 4 known cases", () => {
  const r = run(["--", process.execPath, TS_WRAPPER, "--sdk", FAKE_HISTORICAL]);
  assert.equal(r.code, 1);
  assert.deepEqual(byStatus(r.report, "fail").map((c) => c.id).sort(),
    [...FRACTIONS, "external.dcp-jcs-v1.canonicalize.edge.key_sort_code_point_astral"].sort());
});

test("F1: a canonicalizer that accepts fractions gives 3 discrepancies through the wrapper", () => {
  const r = run(["--", process.execPath, TS_WRAPPER, "--sdk", FAKE_ACCEPTS_FRACTIONS]);
  assert.equal(r.code, 1);
  assert.deepEqual(byStatus(r.report, "fail").map((c) => c.id).sort(), [...FRACTIONS].sort());
  assert.equal(r.report.implementation.self_declared.version, "unknown (no package.json)");
});

for (const [label, sdk] of [["an internal TypeError", FAKE_INTERNAL_ERROR], ["a plain Error with another message", FAKE_OTHER_ERROR_MESSAGE]]) {
  test(`F2: ${label} is an error, never an approved rejection`, () => {
    const r = run(["--", process.execPath, TS_WRAPPER, "--sdk", sdk]);
    assert.equal(r.code, 3);
    const canon = r.report.suites.find((s) => s.id === "external.dcp-jcs-v1.canonicalize");
    assert.ok(canon.cases.every((c) => c.status === "error" && c.kind === "implementation"));
    for (const id of FRACTIONS) assert.equal(canon.cases.find((c) => c.id === id).status, "error");
  });
}

test("N2: one changed byte is one discrepancy", () => {
  const r = run(control("flip-byte"));
  assert.equal(r.code, 1);
  assert.equal(byStatus(r.report, "fail").length, 1);
});

test("N3: rejecting everything fails the 35 accept cases", () => {
  const r = run(control("reject-all"));
  assert.equal(r.code, 1);
  assert.equal(byStatus(r.report, "fail").length, 35);
  assert.equal(byStatus(r.report, "pass").length, 3);
});

for (const [mode, kind] of [["omit-one", "missing"], ["duplicate-one", "duplicate"], ["extra-one", "extra"], ["unsupported-digest", "unsupported"],
  ["upper-hex", "malformed_result"], ["bad-base64", "malformed_result"], ["unknown-result-field", "malformed_result"],
  ["ok-no-output", "malformed_result"], ["malformed-ok-on-reject", "malformed_result"], ["impl-error", "implementation"]]) {
  test(`N4/N5/N14/N15/N16: ${mode} is reported as ${kind}, exit 3`, () => {
    const r = run(control(mode));
    assert.equal(r.code, 3);
    assert.equal(r.report.status, "error");
    assert.ok(kinds(r.report).includes(kind), JSON.stringify(kinds(r.report)));
  });
}

test("N14: unsupported digest still passes when only canonicalize is selected", () => {
  const r = run(["--suite", "external.dcp-jcs-v1.canonicalize", ...control("unsupported-digest")]);
  assert.equal(r.code, 0);
  assert.equal(r.report.totals.pass, 30);
});

test("N6: a wrong nonce, a wrong run_id or a recorded earlier response is stale", () => {
  for (const mode of ["wrong-nonce", "wrong-run-id"]) {
    const r = run(control(mode));
    assert.equal(r.code, 3);
    assert.deepEqual(kinds(r.report), ["stale"]);
  }
  const rec = path.join(TMP, "recorded.json");
  assert.equal(run(control("record", rec)).code, 0);
  const r = run(control("replay", rec));
  assert.equal(r.code, 3);
  assert.deepEqual(kinds(r.report), ["stale"]);
});

for (const mode of ["invalid-json", "invalid-utf8", "trailing-data", "unknown-top-field", "unknown-impl-field", "copy-request"]) {
  test(`N12/N18: ${mode} is invalid output`, () => {
    const r = run(control(mode));
    assert.equal(r.code, 3);
    assert.deepEqual(kinds(r.report), ["invalid_output"]);
  });
}

test("N13: valid output followed by exit 1, or by a signal, is a process error", () => {
  for (const mode of ["late-exit", "self-kill"]) {
    const r = run(control(mode));
    assert.equal(r.code, 3);
    assert.deepEqual(kinds(r.report), ["process"]);
  }
});

// ── Process: deadlines, limits, cleanup ─────────────────────────

test("N7: a process that ignores SIGTERM is killed and the run is bounded", () => {
  const t0 = Date.now();
  const r = run(["--timeout-ms", "500", ...control("sleep-ignore-term")]);
  assert.equal(r.code, 3);
  assert.deepEqual(kinds(r.report), ["timeout"]);
  const o = r.report.implementation.observed;
  assert.equal(o.timed_out, true);
  assert.equal(o.signal, "SIGKILL");
  assert.equal(o.cleanup_incomplete, false);
  assert.ok(Date.now() - t0 < 8000, `took ${Date.now() - t0} ms`);
});

test("N8: stdout closed while the process stays alive reaches the deadline", () => {
  const r = run(["--timeout-ms", "500", ...control("close-stdout-stay")]);
  assert.equal(r.code, 3);
  assert.deepEqual(kinds(r.report), ["timeout"]);
});

test("N9: a leader that exits 0 and leaves a grandchild holding the pipes does not hang the run", { skip: process.platform === "win32" }, () => {
  const pidFile = path.join(TMP, "grandchild.pid");
  const r = run(["--timeout-ms", "800", ...control("leader-exits-grandchild", pidFile)]);
  assert.equal(r.code, 3);
  assert.deepEqual(kinds(r.report), ["timeout"]);
  assert.equal(r.report.implementation.observed.exit_code, 0);
  assert.equal(r.report.implementation.observed.cleanup_incomplete, false);
  assert.equal(alive(Number(fs.readFileSync(pidFile, "utf8"))), false);
});

test("N9b: a descendant left in the group after a normal exit is killed and reported", { skip: process.platform === "win32" }, () => {
  const pidFile = path.join(TMP, "detached.pid");
  const r = run(control("leader-exits-detached-stdio", pidFile));
  assert.equal(r.code, 0);
  assert.equal(r.report.implementation.observed.group_alive_after_exit, true);
  const pid = Number(fs.readFileSync(pidFile, "utf8"));
  for (let i = 0; i < 50 && alive(pid); i++) spawnSync("sleep", ["0.05"]);
  assert.equal(alive(pid), false);
});

test("N10: stdout above the limit is cut and reported", () => {
  const r = run(control("flood-stdout"));
  assert.equal(r.code, 3);
  assert.deepEqual(kinds(r.report), ["output_limit"]);
});

test("N11: a stderr flood is truncated and does not fail correct output", () => {
  const r = run(control("flood-stderr"));
  assert.equal(r.code, 0);
  const o = r.report.implementation.observed;
  assert.equal(o.stderr_truncated, true);
  assert.equal(o.stderr_bytes, 1 << 20);
  assert.ok(o.stderr_excerpt.length <= 4096);
});

test("N17: argv reaches the process literally, without a shell", () => {
  const args = ["a b", ";", "$(echo injected)", "*", "`id`"];
  const r = run(control("argv-echo", ...args));
  assert.equal(r.code, 0);
  assert.equal(r.report.implementation.self_declared.name, JSON.stringify(args));
  assert.deepEqual(r.report.implementation.argv.slice(-5), args);
});

test("N18: an executable that does not exist is a spawn error with a fresh report", () => {
  const r = run(["--", path.join(TMP, "does-not-exist")]);
  assert.equal(r.code, 3);
  assert.deepEqual(kinds(r.report), ["spawn"]);
});

// ── Catalog, fixtures, usage and fresh reports ──────────────────

const FIXTURES = ["tests/conformance/v2/golden_vectors.json", "tests/interop/v2/interop_vectors.json"];
function tamperedRun(editCatalog, editFixtures) {
  const root = fs.mkdtempSync(path.join(TMP, "root-"));
  const docs = {};
  for (const rel of FIXTURES) docs[rel] = JSON.parse(fs.readFileSync(path.join(REPO, rel), "utf8"));
  const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
  let catalogText = editCatalog ? editCatalog(catalog) : undefined;
  let fixtureText = editFixtures ? editFixtures(docs) : undefined;
  for (const rel of FIXTURES) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), typeof fixtureText === "object" && fixtureText?.[rel] !== undefined ? fixtureText[rel] : JSON.stringify(docs[rel]));
  }
  const catFile = path.join(root, "catalog.json");
  fs.writeFileSync(catFile, typeof catalogText === "string" || Buffer.isBuffer(catalogText) ? catalogText : JSON.stringify(catalog));
  return run(["--root", root, "--catalog", catFile, "--", process.execPath, TS_WRAPPER]);
}
const canonCases = (c) => c.suites[0].cases;

for (const [label, edit] of [
  ["a duplicate case id", (c) => { canonCases(c)[1].id = canonCases(c)[0].id; }],
  ["an empty case id", (c) => { canonCases(c)[0].id = ""; }],
  ["a pointer to a vector that does not exist", (c) => { canonCases(c)[0].source.path = ["canonicalization", "no_such_vector"]; }],
  ["expect reject on a vector that must be accepted", (c) => { canonCases(c)[0].expect = "reject"; }],
  ["expect accept on a vector that must be rejected", (c) => { canonCases(c).find((x) => FRACTIONS.includes(x.id)).expect = "accept"; }],
  ["an unknown field in a case", (c) => { canonCases(c)[0].note = "x"; }],
  ["a pinned case removed (collection incomplete)", (c) => { canonCases(c).shift(); }],
  ["the same vector pinned twice", (c) => { canonCases(c).push({ ...canonCases(c)[0], id: "external.extra" }); }],
  ["a suite with no case", (c) => { c.suites[1].cases = []; }],
  ["one algorithm variant of a dual vector removed", (c) => { c.suites[1].cases = c.suites[1].cases.filter((x) => x.id !== "external.digest.dual.intent_canonical.sha3_256"); }],
  ["a whitespace-only case id", (c) => { canonCases(c)[0].id = "   "; }],
  ["a title that is not a string", (c) => { c.suites[0].title = 5; }],
  ["limits that are not strings", (c) => { c.suites[0].limits = [""]; }],
  ["an expect value that is neither accept nor reject", (c) => { canonCases(c)[0].expect = "maybe"; }],
  ["a collection without variants", (c) => { delete c.collections[0].variants; }],
  ["malformed catalog JSON", () => "{"],
  ["an invalid UTF-8 byte in the catalog", (c) => { c.suites[0].title = "X"; const b = Buffer.from(JSON.stringify(c)); b[b.indexOf("\"X\"") + 1] = 0xff; return b; }],
]) {
  test(`C1: ${label} is an infrastructure error with a fresh report`, () => {
    const r = tamperedRun(edit);
    assert.equal(r.code, 3, r.stderr);
    assert.equal(r.report.status, "error");
    assert.equal(r.report.error.kind, "catalog");
  });
}

for (const [label, edit] of [
  ["a vector removed from a collection", (d) => { delete d[FIXTURES[0]].canonicalization.unicode; }],
  ["a vector added to a collection", (d) => { d[FIXTURES[0]].hash_vectors.sha256_new = { input_utf8: "x", expected_hex: "0".repeat(64) }; }],
  ["a duplicated edge vector", (d) => { const v = d[FIXTURES[1]].canonicalization.edge_cases.vectors; v.push({ ...v[0] }); }],
  ["an edge vector whose expectation changed kind", (d) => { const v = d[FIXTURES[1]].canonicalization.edge_cases.vectors.find((x) => x.expects_error); delete v.expects_error; v.canonical = "{}"; }],
  ["a malformed fixture", () => ({ [FIXTURES[1]]: "{" })],
  ["an invalid UTF-8 byte in a fixture", (d) => { d[FIXTURES[1]]._note = "X"; const b = Buffer.from(JSON.stringify(d[FIXTURES[1]])); b[b.indexOf("\"X\"") + 1] = 0xff; return { [FIXTURES[1]]: b }; }],
  ["expects_error as the string \"true\"", (d) => { d[FIXTURES[0]].canonicalization.simple_sorted_keys.expects_error = "true"; }],
  ["both canonical and expected_canonical", (d) => { d[FIXTURES[0]].canonicalization.simple_sorted_keys.canonical = "{}"; }],
  ["input_json that is not a string", (d) => { const v = d[FIXTURES[1]].canonicalization.edge_cases.vectors.find((x) => x.input_json); v.input_json = { n: 1 }; }],
  ["both input and input_json", (d) => { d[FIXTURES[0]].canonicalization.simple_sorted_keys.input_json = "{}"; }],
  ["expected_hex together with sha256 on a dual vector", (d) => { d[FIXTURES[0]].dual_hash_vectors.raw_dual_hash.expected_hex = "0".repeat(64); }],
]) {
  test(`C2: ${label} is an infrastructure error`, () => {
    const r = tamperedRun(undefined, edit);
    assert.equal(r.code, 3, r.stderr);
    assert.equal(r.report.error.kind, "catalog");
  });
}

test("C3: usage errors exit 2 and replace an older successful report", () => {
  for (const args of [["--suite", "no.such.suite", "--", process.execPath, TS_WRAPPER], ["--suite", "", "--", process.execPath, TS_WRAPPER],
    ["--suite", "external.digest", "--suite", "external.digest", "--", process.execPath, TS_WRAPPER], [], ["--bogus"], ["--timeout-ms", "0", "--", "x"]]) {
    const report = path.join(TMP, `stale-${++n}.json`);
    fs.writeFileSync(report, JSON.stringify({ status: "pass", totals: { pass: 38 } }));
    const r = run(args, { report });
    assert.equal(r.code, 2, JSON.stringify(args));
    assert.equal(r.report.status, "error");
    assert.equal(r.report.error.kind, "usage");
  }
});

test("C3: a missing, option-like or repeated --report is refused before any file is written", () => {
  const cwd = fs.mkdtempSync(path.join(TMP, "cwd-"));
  for (const args of [["--report", "--suite", "external.digest", "--", process.execPath, TS_WRAPPER], ["--report"],
    ["--report", "a.json", "--report", "b.json", "--", process.execPath, TS_WRAPPER], ["--suite", "--report", "c.json"]]) {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
    assert.equal(r.status, 2, JSON.stringify(args));
  }
  assert.deepEqual(fs.readdirSync(cwd), []);
});

test("C3: the placeholder, the final report and error reports carry one fresh run id", async () => {
  const report = path.join(TMP, `identity-${++n}.json`);
  const child = spawn(process.execPath, [CLI, "--report", report, "--timeout-ms", "1500", ...control("sleep-ignore-term")],
    { env: { ...process.env, CONTROL_SDK: SDK_URL }, stdio: "ignore" });
  let placeholder;
  for (let i = 0; i < 100 && !placeholder; i++) {
    await new Promise((r) => setTimeout(r, 20));
    try { placeholder = JSON.parse(fs.readFileSync(report, "utf8")); } catch { /* not yet */ }
  }
  assert.equal(placeholder.status, "incomplete");
  assert.match(placeholder.run.id, /^[0-9a-f-]{36}$/);
  await new Promise((r) => child.on("close", r));
  const final = JSON.parse(fs.readFileSync(report, "utf8"));
  assert.equal(final.run.id, placeholder.run.id);
  const a = run(["--suite", "no.such.suite", "--", "x"]);
  const b = run(["--suite", "no.such.suite", "--", "x"]);
  assert.match(a.report.run.id, /^[0-9a-f-]{36}$/);
  assert.notEqual(a.report.run.id, b.report.run.id);
});

test("C3: --list prints the suites and their pinned counts", () => {
  const r = spawnSync(process.execPath, [CLI, "--list"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /external\.dcp-jcs-v1\.canonicalize {2}30 cases/);
  assert.match(r.stdout, /external\.digest {2}8 cases/);
});

// ── Python fakes (only with DCP_EXTERNAL_PYTHON) ────────────────

function pythonFake(name, canonicalizeBody) {
  const root = fs.mkdtempSync(path.join(TMP, `py-${name}-`));
  fs.mkdirSync(path.join(root, "dcp_ai", "v2"), { recursive: true });
  fs.writeFileSync(path.join(root, "dcp_ai", "__init__.py"), "");
  fs.writeFileSync(path.join(root, "dcp_ai", "v2", "__init__.py"), "");
  fs.writeFileSync(path.join(root, "dcp_ai", "v2", "dual_hash.py"),
    "import hashlib\ndef sha256_hex(b): return hashlib.sha256(b).hexdigest()\ndef sha3_256_hex(b): return hashlib.sha3_256(b).hexdigest()\n");
  fs.writeFileSync(path.join(root, "dcp_ai", "v2", "canonicalize.py"), canonicalizeBody);
  return root;
}
const PY_REAL = `import importlib.metadata, importlib.util, json
_spec = importlib.util.spec_from_file_location("_real", str(importlib.metadata.distribution("dcp-ai").locate_file("dcp_ai/v2/canonicalize.py")))
_real = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_real)
`;

for (const [label, body, check] of [
  ["F1 (Python): a canonicalizer that accepts fractions gives 3 discrepancies", PY_REAL +
    "def canonicalize_v2(obj):\n    try:\n        return _real.canonicalize_v2(obj)\n    except TypeError:\n        return json.dumps(obj, separators=(',', ':'))\n",
  (r) => { assert.equal(r.code, 1); assert.deepEqual(byStatus(r.report, "fail").map((c) => c.id).sort(), [...FRACTIONS].sort()); }],
  ["F2 (Python): an internal TypeError is an error, never an approved rejection",
    "def canonicalize_v2(obj):\n    raise TypeError('internal failure')\n",
  (r) => { assert.equal(r.code, 3); assert.ok(r.report.suites[0].cases.every((c) => c.status === "error" && c.kind === "implementation")); }],
]) {
  test(label, (t) => {
    if (!PYTHON) {
      if (REQUIRE_PYTHON) assert.fail("DCP_EXTERNAL_REQUIRE_PYTHON=1 but DCP_EXTERNAL_PYTHON is not set");
      t.skip("DCP_EXTERNAL_PYTHON is not set: the Python fake was NOT run");
      return;
    }
    const root = pythonFake(label.slice(0, 2), body);
    const r = run(["--", PYTHON, PY_WRAPPER], { env: { PYTHONPATH: root } });
    check(r);
    assert.match(r.report.implementation.self_declared.version, /^unknown/);
  });
}
