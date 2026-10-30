// Self-tests of the performance harness (dcp-ai-perf/1). No timing is asserted, ever: only the protocol, the
// verdicts, the counts, the identity, the provenance and the freshness of the report. The mandatory smoke run builds
// the five children (W=1, N=2, R=1) into a temporary build record; the fake children then run against those real
// artifacts. With DCP_EXTERNAL_REQUIRE_PYTHON=1 and DCP_EXTERNAL_REQUIRE_NATIVE=1 nothing may be skipped.
//
//   DCP_PERF_PYTHON=/path/to/python DCP_EXTERNAL_REQUIRE_PYTHON=1 DCP_EXTERNAL_REQUIRE_NATIVE=1 \
//     node --test tools/conformance/perf.test.mjs        (DCP_PERF_OFFLINE=1 builds offline)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { createHash } from "crypto";
import { fileURLToPath } from "url";
import {
  CONTRACT, ENTRYPOINTS, REPO_ROOT, SDKS, bounded, judge, loadWorkloads, requireComplete, runChildren, stableRecord, stats, verifyRecord, writeRecord,
} from "./perf.js";
import { InfraError } from "./external.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(REPO_ROOT, "tools", "conformance-perf.js");
const PYTHON = process.env.DCP_PERF_PYTHON ?? process.env.DCP_EXTERNAL_PYTHON;
const REQUIRED = process.env.DCP_EXTERNAL_REQUIRE_PYTHON === "1" && process.env.DCP_EXTERNAL_REQUIRE_NATIVE === "1";
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-perf-"));
process.on("exit", () => fs.rmSync(TMP, { recursive: true, force: true }));
const RECORD = path.join(TMP, "record.json");
const plan = loadWorkloads();

let n = 0;
function cli(args, reportFile = path.join(TMP, `report-${++n}.json`)) {
  const r = spawnSync(process.execPath, [CLI, "--report", reportFile, ...args], { encoding: "utf8", timeout: 1200000 });
  return { code: r.status, report: fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, "utf8")) : null, stderr: r.stderr, stdout: r.stdout };
}
const seed = (file) => fs.writeFileSync(file, JSON.stringify({ kit: { name: "dcp-ai-perf" }, run: { id: "old-run" }, status: "pass" }));

// ── Mandatory smoke run with the five real children ────────────

let built = false;
test("smoke: the five real children pass W=1, N=2, R=1, built into a fresh record", (t) => {
  if (!PYTHON) {
    if (REQUIRED) assert.fail("DCP_PERF_PYTHON is not set (required)");
    t.skip("DCP_PERF_PYTHON is not set: NOT run");
    return;
  }
  const r = cli(["--record", RECORD, "--warmup", "1", "--samples", "2", "--rounds", "1", "--python", PYTHON, ...(process.env.DCP_PERF_OFFLINE === "1" ? ["--offline"] : [])]);
  assert.equal(r.code, 0, r.stderr + r.stdout);
  assert.equal(r.report.status, "pass");
  assert.equal(r.report.baseline, true);
  assert.deepEqual(r.report.results.map((e) => e.sdk), SDKS);
  for (const e of r.report.results) {
    assert.equal(e.implementation.entrypoint, ENTRYPOINTS[e.sdk]);
    assert.deepEqual(e.results.map((x) => x.id), plan.workloads.map((w) => w.id));
    for (const x of e.results) {
      assert.equal(x.samples_ns.length, 2);
      assert.equal(x.errors_first.length > 0, x.verified === false, `${e.sdk} ${x.id}`);
    }
  }
  // Each import of the dist bundle is reported with the package.json Node resolved, wherever it is (no layout
  // imposed): the file exists, its hash is the reported one, and its name and version are the reported ones.
  const ts = r.report.results.find((e) => e.sdk === "ts").implementation.loaded.imports_resolved_from_dist;
  assert.ok(ts.length > 0);
  for (const i of ts) {
    const raw = fs.readFileSync(path.resolve(REPO_ROOT, i.package_json));
    const pkg = JSON.parse(raw);
    assert.equal(createHash("sha256").update(raw).digest("hex"), i.sha256, i.specifier);
    assert.deepEqual([pkg.name, pkg.version], [i.name, i.version], i.specifier);
    assert.ok(i.specifier === i.name || i.specifier.startsWith(`${i.name}/`), i.specifier);
  }
  const py = r.report.results.find((e) => e.sdk === "python").implementation.loaded;
  assert.ok(py.dcp_ai_file.startsWith(path.join(REPO_ROOT, "sdks", "python", "dcp_ai")));
  assert.deepEqual(Object.keys(r.report.provenance.record.stable.sdks), SDKS);
  built = true;
});

// ── Judgement of one response (no process) ──────────────────────

const request = { run_id: "r", nonce: "n", warmup: 3, samples: 4 };
function response(sdk = "rust") {
  return {
    contract: CONTRACT, run_id: "r", nonce: "n", status: "ok",
    implementation: { sdk, entrypoint: ENTRYPOINTS[sdk], source: "checkout", clock: "c", unit: "ns", runtime: {},
      loaded: sdk === "python" ? { dcp_ai_file: path.join(REPO_ROOT, "sdks", "python", "dcp_ai", "__init__.py") } : {} },
    results: plan.workloads.map((w) => ({ id: w.id, verified: w.expect.verified, errors_first: w.expect.verified ? [] : ["rejected"], warmup_checked: 3, checked: 4, samples_ns: [10, 20, 30, 40] })),
  };
}
const verdictOf = (mutate, sdk) => { const doc = response(sdk); mutate(doc); return judge(sdk ?? "rust", doc, request, plan.workloads); };

test("judge: a faithful response passes, and the statistics follow the stated convention", () => {
  assert.equal(verdictOf(() => {}).status, "pass");
  assert.equal(verdictOf(() => {}, "python").status, "pass");
  assert.deepEqual(stats([40, 10, 30, 20]).median, 25);
  const s = stats([5, 1, 4, 2, 3, 6, 7, 8, 9, 10]);
  assert.deepEqual([s.n, s.min, s.median, s.p90, s.p99, s.max, s.iqr], [10, 1, 5.5, 9, 10, 10, 5]);
});

test("judge: missing, duplicate, unknown, wrong counts and malformed samples are errors", () => {
  for (const [label, mutate, kind] of [
    ["missing", (d) => d.results.pop(), "missing"],
    ["duplicate", (d) => d.results.push(structuredClone(d.results[0])), "duplicate"],
    ["unknown", (d) => { d.results[0].id = "other"; }, "unknown"],
    ["short", (d) => d.results[0].samples_ns.pop(), "samples"],
    ["long", (d) => d.results[0].samples_ns.push(1), "samples"],
    ["zero", (d) => { d.results[0].samples_ns[0] = 0; }, "samples"],
    ["negative", (d) => { d.results[0].samples_ns[0] = -1; }, "samples"],
    ["fraction", (d) => { d.results[0].samples_ns[0] = 1.5; }, "samples"],
    ["unsafe", (d) => { d.results[0].samples_ns[0] = 2 ** 53; }, "samples"],
    ["string", (d) => { d.results[0].samples_ns[0] = "1"; }, "samples"],
    ["warmup count", (d) => { d.results[0].warmup_checked = 2; }, "counts"],
    ["sample count", (d) => { d.results[0].checked = 5; }, "counts"],
    ["errors not strings", (d) => { d.results[1].errors_first = [1]; }, "malformed"],
    ["extra field", (d) => { d.results[0].extra = 1; }, "malformed"],
    ["status error", (d) => { d.status = "error"; }, "malformed"],
    ["unit", (d) => { d.implementation.unit = "ms"; }, "malformed"],
    ["stale run_id", (d) => { d.run_id = "old"; }, "stale"],
    ["stale nonce", (d) => { d.nonce = "old"; }, "stale"],
    ["wrong sdk", (d) => { d.implementation.sdk = "go"; }, "identity"],
    ["wrong entrypoint", (d) => { d.implementation.entrypoint = "verify"; }, "identity"],
  ]) {
    const v = verdictOf(mutate);
    assert.equal(v.status, "error", label);
    assert.equal(v.kind, kind, label);
  }
  const outside = verdictOf((d) => { d.implementation.loaded.dcp_ai_file = "/usr/lib/python3/site-packages/dcp_ai/__init__.py"; }, "python");
  assert.deepEqual([outside.status, outside.kind], ["error", "identity"]);
});

test("judge: wrong verdicts, contradictions and check_failed are failures with no timing", () => {
  const neg = plan.workloads.findIndex((w) => !w.expect.verified);
  for (const [label, mutate, kind] of [
    ["accept-all", (d) => { for (const r of d.results) { r.verified = true; r.errors_first = []; } }, "verdict"],
    ["contradiction", (d) => { d.results[0].errors_first = ["but"]; }, "contradiction"],
    ["negative without errors", (d) => { d.results[neg].errors_first = []; }, "no_errors"],
  ]) {
    const v = verdictOf(mutate);
    assert.deepEqual([v.status, v.kind], ["fail", kind], label);
    assert.equal(v.results, undefined, label);
  }
  for (const phase of ["warmup", "sample"]) {
    const v = verdictOf((d) => { delete d.results; d.status = "check_failed"; d.failure = { id: "hybrid_ok", phase, index: 0, verified: false, errors: ["x"], reason: "verdict" }; });
    assert.deepEqual([v.status, v.kind], ["fail", "check_failed"], phase);
  }
  for (const [label, failure] of [
    ["index out of range", { id: "hybrid_ok", phase: "warmup", index: 3, verified: false, errors: [], reason: "verdict" }],
    ["unknown reason", { id: "hybrid_ok", phase: "sample", index: 0, verified: false, errors: [], reason: "slow" }],
    ["unknown workload", { id: "other", phase: "sample", index: 0, verified: false, errors: [], reason: "verdict" }],
    ["with timings", { id: "hybrid_ok", phase: "sample", index: 0, verified: false, errors: [], reason: "verdict", samples_ns: [1] }],
  ]) {
    const v = verdictOf((d) => { delete d.results; d.status = "check_failed"; d.failure = failure; });
    assert.deepEqual([v.status, v.kind], ["error", "malformed"], label);
  }
});

// ── Fake children through the CLI, against the real build record ─

const FAKE = path.join(TMP, "fake.mjs");
fs.writeFileSync(FAKE, `
import fs from "fs";
const mode = process.argv[2], sdk = process.argv[3];
const ENTRY = ${JSON.stringify(ENTRYPOINTS)};
if (mode === "hang") { process.on("SIGTERM", () => {}); setInterval(() => {}, 1000); }
else {
  const req = JSON.parse(fs.readFileSync(0, "utf8"));
  const doc = { contract: req.contract, run_id: req.run_id, nonce: req.nonce, status: "ok",
    implementation: { sdk, entrypoint: ENTRY[sdk], source: "checkout", clock: "fake", unit: "ns", runtime: {}, loaded: {} },
    results: req.workloads.map((w) => ({ id: w.id, verified: w.expect.verified, errors_first: w.expect.verified ? [] : ["rejected"],
      warmup_checked: req.warmup, checked: req.samples, samples_ns: Array.from({ length: req.samples }, (_, i) => 1000 + i) })) };
  if (mode === "accept-all") for (const r of doc.results) { r.verified = true; r.errors_first = []; }
  if (mode === "fail-warmup" || mode === "fail-sample") { delete doc.results; doc.status = "check_failed"; doc.failure = { id: req.workloads[0].id, phase: mode.slice(5), index: 0, verified: false, errors: ["x"], reason: "verdict" }; }
  if (mode === "fail-malformed") { delete doc.results; doc.status = "check_failed"; doc.failure = { id: req.workloads[0].id }; }
  if (mode === "invalid-json") { process.stdout.write("{"); process.exit(0); }
  process.stdout.write(JSON.stringify(doc));
  if (mode === "exit-after-json") process.exit(1);
}
`);
const fakeArgs = (mode, sdk = "rust") => ["--sdk", sdk, "--no-build", "--record", RECORD, "--warmup", "2", "--samples", "3", "--timeout-ms", "1500",
  "--child-argv", `${sdk}=${JSON.stringify([process.execPath, FAKE, mode, sdk])}`];

test("fake children: each failure replaces an older PASS report with a fresh fail or error", (t) => {
  if (!built) { if (REQUIRED) assert.fail("the smoke build did not run"); t.skip("needs the smoke build record"); return; }
  const faithful = cli(fakeArgs("faithful"));
  assert.equal(faithful.code, 0, faithful.stderr);
  assert.equal(faithful.report.baseline, false, "an overridden child is never a baseline");
  for (const [mode, code, status] of [
    ["accept-all", 1, "fail"], ["fail-warmup", 1, "fail"], ["fail-sample", 1, "fail"], ["fail-malformed", 3, "error"],
    ["invalid-json", 3, "error"], ["exit-after-json", 3, "error"], ["hang", 3, "error"],
  ]) {
    const file = path.join(TMP, `seeded-${++n}.json`);
    seed(file);
    const r = cli(fakeArgs(mode), file);
    assert.equal(r.code, code, `${mode}: ${r.stderr}`);
    assert.equal(r.report.status, status, mode);
    assert.notEqual(r.report.run.id, "old-run", mode);
    assert.ok(!r.report.results[0].results, `${mode}: no timing is presented`);
  }
});

test("a deliberately wrong expected positive fails through a real child", async (t) => {
  if (!built) { if (REQUIRED) assert.fail("the smoke build did not run"); t.skip("needs the smoke build"); return; }
  const wrong = plan.workloads.map((w) => (w.id === "hybrid_ok" ? { ...w, expect: { verified: false } } : w));
  const out = await runChildren({ sdks: ["rust"], workloads: wrong, policy: plan.policy, warmup: 1, samples: 1, rounds: 1, timeoutMs: 60000 });
  assert.equal(out.status, "fail");
  assert.equal(out.sdks[0].kind, "check_failed");
  assert.deepEqual([out.sdks[0].failure.id, out.sdks[0].failure.phase, out.sdks[0].failure.reason], ["hybrid_ok", "warmup", "verdict"]);
});

// ── Usage and freshness ────────────────────────────────────────

test("usage: an invalid command replaces an older report; an ambiguous report path writes none", () => {
  for (const args of [["--warmup", "0"], ["--samples", "1001"], ["--sdk", "java"], ["--sdk", "go", "--sdk", "go"], ["--rounds", "6"], ["--frobnicate"], ["--child-argv", "go=[]"]]) {
    const file = path.join(TMP, `seeded-${++n}.json`);
    seed(file);
    const r = cli(args, file);
    assert.equal(r.code, 2, args.join(" "));
    assert.equal(r.report.status, "error");
    assert.equal(r.report.error.kind, "usage");
    assert.notEqual(r.report.run.id, "old-run");
  }
  // Another option without its value, before or after an unambiguous --report: a fresh error, never the old PASS.
  for (const order of [(f) => ["--report", f, "--warmup"], (f) => ["--warmup", "--report", f], (f) => ["--sdk", "--report", f]]) {
    const file = path.join(TMP, `seeded-${++n}.json`);
    seed(file);
    const r = spawnSync(process.execPath, [CLI, ...order(file)], { encoding: "utf8" });
    const report = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(r.status, 2, order("F").join(" "));
    assert.deepEqual([report.status, report.error?.kind], ["error", "usage"], order("F").join(" "));
    assert.notEqual(report.run.id, "old-run", order("F").join(" "));
  }
  // An ambiguous --report writes nothing, and "--report" read as another option's value invents no path.
  const cwd = fs.mkdtempSync(path.join(TMP, "cwd-"));
  for (const args of [["--report"], ["--report", "--samples", "2"], ["--report", "a.json", "--report", "b.json"], ["--python", "--report"], ["--sdk", "--report", "--warmup", "2"]]) {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
    assert.equal(r.status, 2, args.join(" "));
    assert.deepEqual(fs.readdirSync(cwd), [], args.join(" "));
  }
});

// ── Provenance ─────────────────────────────────────────────────

test("provenance: a forged or stale record is an error; time, dirty and caches are not compared", (t) => {
  if (!built) { if (REQUIRED) assert.fail("the smoke build did not run"); t.skip("needs the smoke build record"); return; }
  const real = JSON.parse(fs.readFileSync(RECORD, "utf8"));
  const stable = { ...real, created_at: "1999-01-01T00:00:00Z", informational: { commit: "0".repeat(40), dirty: !real.informational.dirty }, steps: [] };
  const okFile = path.join(TMP, "record-informational.json");
  writeRecord(stable, okFile);
  assert.equal(cli(["--sdk", "rust", "--no-build", "--record", okFile, "--warmup", "1", "--samples", "1"]).code, 0, "informational fields are not compared");
  for (const [label, forge, sdk] of [
    ["rust binary", (r) => { r.stable.sdks.rust.artifacts.binary = "0".repeat(64); }, "rust"],
    ["ts dist tree", (r) => { r.stable.sdks.ts.artifacts.dist.sha256 = "0".repeat(64); }, "ts"],
    ["wasm glue", (r) => { r.stable.sdks.wasm.artifacts.glue = "0".repeat(64); }, "wasm"],
    ["go source", (r) => { r.stable.sdks.go.sources["sdks/go/dcp"].sha256 = "0".repeat(64); }, "go"],
    ["a lock", (r) => { r.stable.sdks.rust.manifests["sdks/rust/Cargo.lock"] = "0".repeat(64); }, "rust"],
    ["a tool version", (r) => { r.stable.sdks.go.tools.go = "go version go0.0"; }, "go"],
    ["a removed field", (r) => { delete r.stable.sdks.rust.children; }, "rust"],
    ["an uncovered SDK", (r) => { delete r.stable.sdks.go; }, "go"],
  ]) {
    const forged = structuredClone(real);
    forge(forged);
    const file = path.join(TMP, `record-forged-${++n}.json`);
    writeRecord(forged, file);
    const r = cli(["--sdk", sdk, "--no-build", "--record", file, "--warmup", "1", "--samples", "1", ...(sdk === "python" ? ["--python", PYTHON] : [])]);
    assert.equal(r.code, 3, label);
    assert.equal(r.report.error.kind, "provenance", label);
  }
  const absent = cli(["--sdk", "rust", "--no-build", "--record", path.join(TMP, "no-record.json")]);
  assert.deepEqual([absent.code, absent.report.error.kind], [3, "provenance"]);
});

test("provenance: a selection needs only its own inputs, in a temporary tree without other artifacts", async () => {
  const root = fs.mkdtempSync(path.join(TMP, "tree-"));
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  for (const rel of ["tools/conformance-perf.js", "tools/conformance/perf.js", "tools/conformance/perf/launch.mjs", "tools/conformance/external.js", "tools/conformance/perf/python_perf.py",
    "sdks/python/pyproject.toml", "sdks/python/dcp_ai/__init__.py", "sdks/python/dcp_ai/v2/verify.py"]) put(rel, `${rel}\n`);
  const python = process.execPath; // a stand-in "interpreter" is never run here: only its version is asked through the bounded runner
  const fresh = await stableRecord(root, { sdks: ["python"], python: null });
  assert.equal(fresh.sdks.python.tools.python, null, "no interpreter given: recorded as missing, and so refused");
  const withPython = await stableRecord(root, { sdks: ["python"], python: PYTHON ?? python });
  assert.deepEqual(Object.keys(withPython.sdks), ["python"]);
  const file = path.join(root, "record.json");
  writeRecord({ record_version: 1, created_at: "x", informational: {}, steps: [], stable: withPython }, file);
  assert.doesNotThrow(() => verifyRecord(withPython, ["python"], file));
  put("sdks/python/dcp_ai/__pycache__/verify.cpython-312.pyc", "cache");
  put("sdks/python/dcp_ai/v2/__pycache__/x.pyc", "cache");
  assert.doesNotThrow(() => verifyRecord(withPython, ["python"], file), "caches are not fingerprinted");
  const again = await stableRecord(root, { sdks: ["python"], python: PYTHON ?? python });
  assert.doesNotThrow(() => verifyRecord(again, ["python"], file));
  put("sdks/python/dcp_ai/v2/verify.py", "changed\n");
  const changed = await stableRecord(root, { sdks: ["python"], python: PYTHON ?? python });
  assert.throws(() => verifyRecord(changed, ["python"], file), InfraError);
  assert.throws(() => verifyRecord(again, ["ts"], file), /does not cover ts/);
  const go = await stableRecord(root, { sdks: ["go"] });
  assert.equal(go.sdks.go.artifacts.binary, null, "a selected SDK without its artifact is recorded as missing");
  // After a build, as with --no-build, a measurement needs complete provenance: the same check refuses any gap.
  assert.throws(() => requireComplete(go), /provenance is incomplete.*sdks\.go\.artifacts\.binary/);
  assert.throws(() => requireComplete(fresh), /sdks\.python\.tools\.python/);
  assert.doesNotThrow(() => requireComplete(withPython), "a complete record of the selection is accepted");
});

// ── Bounded build steps ────────────────────────────────────────

test("a build step that ignores SIGTERM is stopped by the deadline, and its group killed", async () => {
  const started = performance.now();
  const r = await bounded([process.execPath, "-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], { timeoutMs: 300 });
  assert.ok(r.level && r.level.kind === "timeout", JSON.stringify(r.level));
  assert.ok(performance.now() - started < 10000, "bounded by the deadline, the grace period and the close wait");
});
