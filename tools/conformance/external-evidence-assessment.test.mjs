// Self-tests of --assessment on the evidence catalog (contract /2): legacy (the default, unchanged) and verdict (the
// 146 rejections that carry an error_contains judged on verified=false alone, their wording a diagnostic). A fake
// implementation, written to a temporary directory, answers with the TypeScript wrapper's real answers (cached once
// per test run) altered by mode; it finds each case by its content through the runner's own loader. The five real
// wrappers run the verdict assessment too. No source file in the checkout is written.
//
//   DCP_EXTERNAL_PYTHON=/path/to/python DCP_EXTERNAL_REQUIRE_PYTHON=1 DCP_EXTERNAL_REQUIRE_NATIVE=1 \
//     node --test tools/conformance/external-evidence-assessment.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";
import { ARTIFACTS } from "./wrappers/build.mjs";
import { InfraError } from "./external.js";
import { ASSESSMENT_SCHEMA, VERDICT_TEXT, assertVerdictPlan, loadEvidencePlan } from "./external-evidence.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const CLI = path.join(REPO, "tools", "conformance-external.js");
const TS_SDK = path.join(REPO, "sdks", "typescript", "dist", "index.js");
const TS = [process.execPath, path.join(HERE, "wrappers", "ts-sdk.mjs"), "--sdk", TS_SDK];
const PYTHON = process.env.DCP_EXTERNAL_PYTHON;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-assessment-"));
process.on("exit", () => fs.rmSync(TMP, { recursive: true, force: true }));
const CATALOG = JSON.parse(fs.readFileSync(path.join(HERE, "external-evidence-catalog.json"), "utf8"));
const WORDING = 146;

const WRAPPERS = {
  ts: { argv: TS, ready: () => fs.existsSync(TS_SDK), why: "sdks/typescript/dist is not built", required: true },
  python: { argv: PYTHON ? [PYTHON, "-I", path.join(HERE, "wrappers", "python_sdk.py")] : null, ready: () => Boolean(PYTHON), why: "DCP_EXTERNAL_PYTHON is not set", required: process.env.DCP_EXTERNAL_REQUIRE_PYTHON === "1" },
  go: { argv: [ARTIFACTS.go], ready: () => fs.existsSync(ARTIFACTS.go), why: "the Go wrapper is not built", required: process.env.DCP_EXTERNAL_REQUIRE_NATIVE === "1" },
  rust: { argv: [ARTIFACTS.rust], ready: () => fs.existsSync(ARTIFACTS.rust), why: "the Rust wrapper is not built", required: process.env.DCP_EXTERNAL_REQUIRE_NATIVE === "1" },
  wasm: { argv: [process.execPath, path.join(HERE, "wrappers", "wasm.mjs")], ready: () => fs.existsSync(path.join(ARTIFACTS.wasm, "dcp_ai_bg.wasm")), why: "the WASM build is missing", required: process.env.DCP_EXTERNAL_REQUIRE_NATIVE === "1" },
};
function available(t, w) {
  if (w.ready()) return true;
  if (w.required) assert.fail(`${w.why} (required)`);
  t.skip(`${w.why}: NOT run`);
  return false;
}

let n = 0;
function cli(args, reportFile = path.join(TMP, `report-${++n}.json`)) {
  const r = spawnSync(process.execPath, [CLI, "--report", reportFile, ...args], { encoding: "utf8", timeout: 600000 });
  return { code: r.status, report: fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, "utf8")) : null, stdout: r.stdout, stderr: r.stderr };
}
const cases = (report) => report.suites.flatMap((s) => s.cases);
const wordingIds = new Set(loadEvidencePlan().suites.flatMap((s) => s.cases).filter((c) => c.expect.error_contains !== undefined).map((c) => c.id));
const isWording = (c) => wordingIds.has(c.id);

// ── The fake implementation ─────────────────────────────────────

const FAKE = path.join(TMP, "fake.mjs");
const CACHE = path.join(TMP, "ts-answers.json");
fs.writeFileSync(FAKE, `
import fs from "fs";
import crypto from "crypto";
import { spawn } from "child_process";
import { loadEvidencePlan } from ${JSON.stringify(pathToFileURL(path.join(HERE, "external-evidence.js")).href)};
const [mode, cacheFile] = process.argv.slice(2);
if (mode === "exit-1") process.exit(1);
if (mode === "hang") setInterval(() => {}, 1000); // never answers: the runner's deadline ends it
const input = fs.readFileSync(0);
const req = JSON.parse(input);
const key = ({ id, ...rest }) => crypto.createHash("sha256").update(JSON.stringify(rest)).digest("hex");
const byKey = new Map(loadEvidencePlan().suites.flatMap((s) => s.cases.map((c) => [key({ id: "", op: c.op, ...c.request }), c])));
let cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, "utf8")) : {};
if (req.cases.some((x) => !cache[key(x)])) {
  // The TS wrapper's real answers, once: an asynchronous spawn with a deadline, exit, signal and size checked.
  const child = spawn(process.execPath, ${JSON.stringify(TS.slice(1))}, { stdio: ["pipe", "pipe", "pipe"] });
  const chunks = [];
  let bytes = 0;
  child.stdout.on("data", (d) => { bytes += d.length; if (bytes > 1 << 26) child.kill("SIGKILL"); else chunks.push(d); });
  child.stderr.resume();
  child.stdin.on("error", () => {});
  child.stdin.end(input);
  const deadline = setTimeout(() => child.kill("SIGKILL"), 240000);
  const [code, signal] = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", (c, s) => resolve([c, s])); });
  clearTimeout(deadline);
  if (code !== 0 || signal !== null || bytes > 1 << 26) { process.stderr.write("fake: TS wrapper exit " + code + ", signal " + signal + "\\n"); process.exit(1); }
  const resp = JSON.parse(Buffer.concat(chunks));
  for (const r of resp.results) { const { id, ...rest } = r; cache[key(req.cases.find((x) => x.id === id))] = rest; }
  fs.writeFileSync(cacheFile + ".tmp", JSON.stringify(cache));
  fs.renameSync(cacheFile + ".tmp", cacheFile);
}
const caseOf = (x) => byKey.get(key(x));
const wording = (c) => c.expect.error_contains !== undefined;
const firstWording = req.cases.find((x) => wording(caseOf(x)))?.id; // none when only Merkle or composite suites run
const H = (alg, buf) => crypto.createHash(alg).update(buf).digest();
// An order-blind reduction (sorted) and the old odd-node promotion over hex text, as in external-evidence.test.mjs.
const root = (hex, alg, sorted, promote) => {
  let layer = (sorted ? [...hex].sort() : hex).map((h) => promote ? h : Buffer.from(h, "hex"));
  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      if (i + 1 === layer.length) { if (promote) { next.push(layer[i]); continue; } layer.push(layer[i]); }
      next.push(promote ? H(alg, Buffer.from(layer[i] + layer[i + 1])).toString("hex") : H(alg, Buffer.concat([layer[i], layer[i + 1]])));
    }
    layer = next;
  }
  return promote ? layer[0] : layer[0].toString("hex");
};
const negative = (c) => c.expect.verified === false || c.expect.valid === false;
const out = [];
for (const x of req.cases) {
  const c = caseOf(x);
  const r = { id: x.id, ...cache[key(x)] };
  const verify = c.op === "verify_signed_bundle_v2";
  const first = x.id === firstWording;
  let a = r;
  if (mode === "neutral-text" && wording(c)) a = { ...r, errors: ["rejected"] };
  else if (mode === "empty-errors" && wording(c)) a = { ...r, errors: [] };
  else if (mode === "reject-positives-with-text" && verify && c.expect.verified === true) a = { id: x.id, status: "ok", verified: false, errors: ["sig_b64 is not canonical base64"] };
  else if (mode === "wrong-verdict-silent" && wording(c)) a = { id: x.id, status: "ok", verified: true, errors: [] };
  else if (mode === "wrong-verdict-with-text" && wording(c)) a = { ...r, verified: true };
  else if (mode === "accept-all" && verify) a = { id: x.id, status: "ok", verified: true, errors: [] };
  else if (mode === "reject-all" && verify) a = { id: x.id, status: "ok", verified: false, errors: ["rejected"] };
  else if (mode === "error-on-negatives" && negative(c)) a = { id: x.id, status: "error", message: "unexpected failure" };
  else if (mode === "unsupported-on-negatives" && negative(c)) a = { id: x.id, status: "unsupported" };
  else if (mode === "missing-first-wording" && first) continue;
  else if (mode === "duplicate-first-wording" && first) out.push(r);
  else if (mode === "malformed-first-wording" && first) a = { ...r, errors: "rejected" };
  else if (mode === "rejected-first-wording" && first) a = { id: x.id, status: "rejected", code: "parse" };
  else if (mode === "base-fails" && c.id === "external.v2.bundle_vectors.signed_bundle") a = { id: x.id, status: "ok", verified: false, errors: ["rejected"] };
  else if (mode === "secondary-controls-fail" && c.id.startsWith("external.v2.secondary_sha3.") && c.id.endsWith(".control")) a = { id: x.id, status: "ok", verified: false, errors: ["rejected"] };
  else if (mode === "routine-valid-mode-fails" && c.id.startsWith("external.v2.bundle_vectors.classical_only_routine.") && c.expect.verified === true) a = { id: x.id, status: "ok", verified: false, errors: ["rejected"] };
  else if (mode === "composite-all-valid" && c.op === "composite_verify") a = { id: x.id, status: "ok", valid: true, classical_valid: true, pq_valid: true };
  else if (mode === "missing-pq-everywhere" && c.op === "composite_verify") a = { id: x.id, status: "rejected", code: "missing_pq_signature" };
  else if (mode === "merkle-wrong" && c.op === "dual_merkle_root") a = { ...r, sha256: "0".repeat(64) };
  else if ((mode === "merkle-sorted" || mode === "merkle-promote-odd") && c.op === "dual_merkle_root") {
    const s = mode === "merkle-sorted", pr = mode === "merkle-promote-odd";
    a = { id: x.id, status: "ok", sha256: root(x.leaves.map((l) => l.sha256), "sha256", s, pr), sha3_256: root(x.leaves.map((l) => l.sha3_256), "sha3-256", s, pr) };
  } else if (c.op === "composite_verify" && ((mode === "missing-pq-on-negatives" && c.expect.valid === false)
      || (mode === "missing-pq-stripped-only" && x.composite_sig.binding === "pq_over_classical" && x.composite_sig.pq === null))) {
    a = { id: x.id, status: "rejected", code: "missing_pq_signature" };
  }
  out.push(a);
}
if (mode === "extra-result") out.push({ id: "not-sent", status: "ok", verified: true, errors: [] });
process.stdout.write(JSON.stringify({ contract: req.contract, run_id: req.run_id, nonce: req.nonce, implementation: { name: "fake", version: mode }, results: out }));
`);

const fakeArgv = (mode) => [process.execPath, FAKE, mode, CACHE];
const memo = new Map();
/** One run per (fake mode, assessment); `legacy` passes no --assessment, the default. */
function fake(mode, assessment, extra = []) {
  const k = `${mode}/${assessment}/${extra.join(" ")}`;
  if (!memo.has(k)) memo.set(k, cli(["--catalog", "evidence", ...(assessment === "verdict" ? ["--assessment", "verdict"] : []), ...extra, "--", ...fakeArgv(mode)]));
  return memo.get(k);
}
const wordingCases = (report) => cases(report).filter(isWording);
const reasons = (report) => new Set(wordingCases(report).map((c) => c.diagnostic.wording === "not_evaluated" ? c.diagnostic.reason : c.diagnostic.wording));
const checkTotals = (report) => {
  const d = report.diagnostic_totals;
  const w = wordingCases(report);
  assert.equal(d.matched + d.differs + d.no_message + d.not_evaluated, w.length, "diagnostic totals add up to the wording cases");
  assert.equal(d.matched + d.differs + d.no_message, w.filter((c) => c.status === "pass").length, "only passing cases have their wording evaluated");
  assert.ok(w.every((c) => (c.status === "pass") === (c.diagnostic.wording !== "not_evaluated")));
};

// ── T1–T10: one scenario per fake mode, in both assessments ─────

test("T1 unaltered answers: 241/241 in both; verdict reports 146 matched", () => {
  const legacy = fake("unaltered", "legacy");
  assert.equal(legacy.code, 0, legacy.stderr);
  assert.deepEqual(legacy.report.totals, { cases: 241, executed: 241, pass: 241, fail: 0, error: 0 });
  const verdict = fake("unaltered", "verdict");
  assert.equal(verdict.code, 0, verdict.stderr);
  assert.equal(verdict.report.totals.pass, 241);
  assert.deepEqual(verdict.report.diagnostic_totals, { matched: WORDING, differs: 0, no_message: 0, not_evaluated: 0 });
  checkTotals(verdict.report);
});

test("T2 right verdicts with a neutral message: legacy fails the 146, verdict passes them as differs", () => {
  const legacy = fake("neutral-text", "legacy");
  assert.equal(legacy.code, 1);
  const failed = cases(legacy.report).filter((c) => c.status !== "pass");
  assert.equal(failed.length, WORDING);
  assert.ok(failed.every((c) => isWording(c) && c.status === "fail" && c.kind === "discrepancy"));
  const verdict = fake("neutral-text", "verdict");
  assert.equal(verdict.code, 0, verdict.stderr);
  assert.equal(verdict.report.totals.pass, 241);
  assert.deepEqual(verdict.report.diagnostic_totals, { matched: 0, differs: WORDING, no_message: 0, not_evaluated: 0 });
  assert.match(verdict.stdout, /wording differs \(diagnostic\)/);
});

test("T3 right verdicts with no message: legacy fails, verdict passes as no_message", () => {
  assert.equal(fake("empty-errors", "legacy").code, 1);
  const verdict = fake("empty-errors", "verdict");
  assert.equal(verdict.code, 0, verdict.stderr);
  assert.deepEqual(verdict.report.diagnostic_totals, { matched: 0, differs: 0, no_message: WORDING, not_evaluated: 0 });
});

test("T4 wrong verdicts with the expected message never pass", () => {
  // Positives rejected with a committed message: the positives fail and every negative they control is gated.
  for (const assessment of ["legacy", "verdict"]) {
    const r = fake("reject-positives-with-text", assessment);
    assert.notEqual(r.code, 0);
    assert.ok(cases(r.report).filter((c) => c.op === "verify_signed_bundle_v2" && c.expect.verified === true).every((c) => c.status === "fail"));
    assert.ok(wordingCases(r.report).every((c) => c.status === "error" && c.kind === "control_failed"));
  }
  assert.deepEqual(reasons(fake("reject-positives-with-text", "verdict").report), new Set(["control_failed"]));
  // Negatives verified with no error: a wrong verdict, never evaluated.
  const silent = fake("wrong-verdict-silent", "verdict");
  assert.equal(silent.code, 1);
  assert.ok(wordingCases(silent.report).every((c) => c.status === "fail"));
  assert.deepEqual(reasons(silent.report), new Set(["wrong_verdict"]));
  checkTotals(silent.report);
});

test("T4' negatives verified while carrying the expected message are contradictory, never matched", () => {
  for (const assessment of ["legacy", "verdict"]) {
    const r = fake("wrong-verdict-with-text", assessment);
    assert.equal(r.code, 3);
    assert.ok(wordingCases(r.report).every((c) => c.kind === "contradictory_result"));
  }
  assert.deepEqual(reasons(fake("wrong-verdict-with-text", "verdict").report), new Set(["contradictory_result"]));
});

test("T5 accept-all fails every negative in both assessments", () => {
  for (const assessment of ["legacy", "verdict"]) {
    const r = fake("accept-all", assessment);
    assert.equal(r.code, 1);
    const neg = cases(r.report).filter((c) => c.op === "verify_signed_bundle_v2" && c.expect.verified === false);
    assert.equal(neg.length, WORDING + 2); // and the two rejecting modes of the classical-only bundle
    assert.ok(neg.every((c) => c.status === "fail"));
  }
  assert.deepEqual(reasons(fake("accept-all", "verdict").report), new Set(["wrong_verdict"]));
});

test("T6 reject-all fails the positives and gates every controlled negative", () => {
  for (const assessment of ["legacy", "verdict"]) {
    const r = fake("reject-all", assessment);
    assert.notEqual(r.code, 0);
    assert.equal(cases(r.report).find((c) => c.id === "external.v2.bundle_vectors.signed_bundle").status, "fail");
    assert.ok(cases(r.report).filter((c) => c.controls && c.op === "verify_signed_bundle_v2").every((c) => c.kind === "control_failed"));
  }
  assert.deepEqual(reasons(fake("reject-all", "verdict").report), new Set(["control_failed"]));
});

test("T7 error or unsupported on negatives is never a pass", () => {
  for (const [mode, kind] of [["error-on-negatives", "implementation"], ["unsupported-on-negatives", "unsupported"]]) {
    for (const assessment of ["legacy", "verdict"]) {
      const r = fake(mode, assessment);
      assert.equal(r.code, 3, `${mode} ${assessment}`);
      assert.ok(wordingCases(r.report).every((c) => c.status === "error" && c.kind === kind));
    }
    assert.deepEqual(reasons(fake(mode, "verdict").report), new Set([kind]));
  }
});

test("T8 a missing, duplicate, malformed or rejected result is not evaluated; an extra result fails the run", () => {
  const first = [...wordingIds][0];
  for (const [mode, status, reason] of [["missing-first-wording", "error", "missing"], ["duplicate-first-wording", "error", "duplicate"],
    ["malformed-first-wording", "error", "malformed_result"], ["rejected-first-wording", "fail", "rejected"]]) {
    const r = fake(mode, "verdict");
    assert.notEqual(r.code, 0, mode);
    const c = cases(r.report).find((x) => x.id === first);
    assert.equal(c.status, status, mode);
    assert.deepEqual(c.diagnostic, { wording: "not_evaluated", reason, expected_wording: c.diagnostic.expected_wording }, mode);
    assert.equal(r.report.diagnostic_totals.not_evaluated, 1, mode);
    checkTotals(r.report);
    assert.equal(fake(mode, "legacy").report.status, r.report.status, mode);
  }
  // Extra: every known result is valid and keeps its observed diagnostic, yet the run is an error (exit 3).
  const extra = fake("extra-result", "verdict");
  assert.equal(extra.code, 3);
  assert.equal(extra.report.status, "error");
  assert.ok(cases(extra.report).some((c) => c.id.endsWith("#extra") && c.kind === "extra"));
  assert.equal(extra.report.diagnostic_totals.matched, WORDING);
  assert.match(extra.report.assessment.conformance, /only status pass/);
  assert.equal(fake("extra-result", "legacy").code, 3);
});

test("T9 failed controls gate their negatives, whatever their wording", () => {
  const base = fake("base-fails", "verdict");
  const bundle = wordingCases(base.report).filter((c) => c.id.startsWith("external.v2.bundle_vectors."));
  assert.equal(bundle.length, 117);
  assert.ok(bundle.every((c) => c.kind === "control_failed" && c.diagnostic.reason === "control_failed"));
  const secondary = fake("secondary-controls-fail", "verdict");
  const sec = wordingCases(secondary.report).filter((c) => c.id.startsWith("external.v2.secondary_sha3."));
  assert.equal(sec.length, 29);
  assert.ok(sec.every((c) => c.kind === "control_failed" && c.diagnostic.reason === "control_failed"));
  for (const assessment of ["legacy", "verdict"]) {
    const routine = fake("routine-valid-mode-fails", assessment);
    const rejecting = cases(routine.report).filter((c) => c.id.startsWith("external.v2.bundle_vectors.classical_only_routine.") && c.expect.verified === false);
    assert.ok(rejecting.length > 0 && rejecting.every((c) => c.kind === "control_failed"), assessment);
  }
});

test("T10 a fatal run (exit 1 or a real timeout) is an error in both; verdict marks every wording case run_error", () => {
  for (const [mode, kind, extra] of [["exit-1", "process", []], ["hang", "timeout", ["--timeout-ms", "1500"]]]) {
    for (const assessment of ["legacy", "verdict"]) {
      const r = fake(mode, assessment, extra);
      assert.equal(r.code, 3, `${mode} ${assessment}`);
      assert.ok(cases(r.report).every((c) => c.status === "error" && c.kind === kind), `${mode} ${assessment}`);
      if (mode === "hang") assert.equal(r.report.implementation.observed.timed_out, true);
    }
    const verdict = fake(mode, "verdict", extra).report;
    assert.deepEqual(reasons(verdict), new Set(["run_error"]), mode);
    assert.deepEqual(verdict.diagnostic_totals, { matched: 0, differs: 0, no_message: 0, not_evaluated: WORDING }, mode);
  }
});

test("T10b each suite selected alone: its controls are included, the counts and diagnostic totals are its own", () => {
  const expected = { "external.merkle.dual_root": [6, 0], "external.signature.composite": [24, 0], "external.v2.bundle_vectors": [131, 117], "external.v2.secondary_sha3": [80, 29] };
  for (const [suite, [count, wording]] of Object.entries(expected)) {
    for (const assessment of ["legacy", "verdict"]) {
      const r = fake("unaltered", assessment, ["--suite", suite]);
      assert.equal(r.code, 0, `${suite} ${assessment}: ${r.stderr}`);
      assert.deepEqual(r.report.selection, [suite]);
      assert.deepEqual(r.report.totals, { cases: count, executed: count, pass: count, fail: 0, error: 0 }, `${suite} ${assessment}`);
      const ids = new Set(cases(r.report).map((c) => c.id));
      assert.ok(cases(r.report).every((c) => (c.controls ?? []).every((k) => ids.has(k))), `${suite}: every control is in the selection`);
      if (assessment === "verdict") {
        assert.equal(r.report.assessment.wording_cases, wording, suite);
        assert.deepEqual(r.report.diagnostic_totals, { matched: wording, differs: 0, no_message: 0, not_evaluated: 0 }, suite);
      }
    }
  }
  // A selection with no wording case still judges its own negatives: a wrong composite is a failure in both.
  for (const assessment of ["legacy", "verdict"]) assert.equal(fake("composite-all-valid", assessment, ["--suite", "external.signature.composite"]).code, 1);
});

// ── T11: the verdict assessment never relaxes anything else ─────

const MODES = ["unaltered", "neutral-text", "empty-errors", "reject-positives-with-text", "wrong-verdict-silent", "wrong-verdict-with-text",
  "accept-all", "reject-all", "error-on-negatives", "unsupported-on-negatives", "missing-first-wording", "duplicate-first-wording",
  "malformed-first-wording", "rejected-first-wording", "extra-result", "base-fails", "secondary-controls-fail", "routine-valid-mode-fails",
  "composite-all-valid", "missing-pq-everywhere", "missing-pq-on-negatives", "missing-pq-stripped-only", "merkle-wrong", "merkle-sorted",
  "merkle-promote-odd", "exit-1"];

test("T11 the Merkle and missing-PQ modes are effective, the same in both assessments", () => {
  for (const assessment of ["legacy", "verdict"]) {
    for (const mode of ["merkle-sorted", "merkle-promote-odd"]) {
      const merkle = cases(fake(mode, assessment).report).filter((c) => c.op === "dual_merkle_root");
      assert.ok(merkle.some((c) => c.status === "fail") && merkle.some((c) => c.status === "pass"), `${mode} ${assessment}`);
    }
    // The stripped-PQ attack alone may be rejected as missing_pq_signature (241/241); the same code on other negatives fails.
    assert.equal(fake("missing-pq-stripped-only", assessment).report.totals.pass, 241, assessment);
    const onNegatives = cases(fake("missing-pq-on-negatives", assessment).report).filter((c) => c.op === "composite_verify" && c.expect.valid === false);
    assert.ok(onNegatives.some((c) => c.status === "pass") && onNegatives.some((c) => c.status === "fail"), assessment);
  }
});

test("T11 monotony: same status and kind outside the 146; legacy pass implies verdict pass; totals coherent", () => {
  for (const mode of MODES) {
    const legacy = new Map(cases(fake(mode, "legacy").report).map((c) => [c.id, c]));
    const verdict = fake(mode, "verdict");
    checkTotals(verdict.report);
    for (const c of cases(verdict.report)) {
      const l = legacy.get(c.id);
      if (isWording(c)) {
        if (l.status === "pass") assert.equal(c.status, "pass", `${mode} ${c.id}`);
        if (c.status !== l.status) assert.ok(l.status === "fail" && l.kind === "discrepancy" && c.status === "pass", `${mode} ${c.id}: only a text discrepancy may turn into a pass`);
      } else {
        assert.equal(c.status, l.status, `${mode} ${c.id}`);
        assert.equal(c.kind, l.kind, `${mode} ${c.id}`);
      }
    }
  }
});

// ── T12: the premises of a verdict run ──────────────────────────

const FIX = ["tests/conformance/v2/merkle_vectors.json", "tests/interop/v2/interop_vectors.json", "tests/interop/v2/bundle_vectors.json", "tests/interop/v2/secondary_sha3_vectors.json"];
function rootWith(edit) {
  const root = fs.mkdtempSync(path.join(TMP, "root-"));
  for (const rel of FIX) {
    const doc = JSON.parse(fs.readFileSync(path.join(REPO, rel), "utf8"));
    edit(rel, doc);
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), JSON.stringify(doc));
  }
  return root;
}

test("T12 a fixture without a valid anchor: legacy still passes, verdict is an infrastructure error", () => {
  for (const [label, edit] of [
    ["no spec_step", (rel, d) => { if (rel.endsWith("bundle_vectors.json")) delete d.must_reject[0].spec_step; }],
    ["spec_step V2-15", (rel, d) => { if (rel.endsWith("bundle_vectors.json")) d.must_reject_bundles[0].spec_step = "V2-15"; }],
    ["an unknown secondary group", (rel, d) => { if (rel.endsWith("secondary_sha3_vectors.json")) d.cases.find((c) => c.expect === "reject").group = "constructor"; }],
  ]) {
    const root = rootWith(edit);
    const legacy = cli(["--root", root, "--catalog", "evidence", "--", ...fakeArgv("unaltered")]);
    assert.equal(legacy.code, 0, `${label}: ${legacy.stderr}`);
    const verdict = cli(["--root", root, "--catalog", "evidence", "--assessment", "verdict", "--", ...fakeArgv("unaltered")]);
    assert.equal(verdict.code, 3, label);
    assert.equal(verdict.report.error.kind, "catalog", label);
    assert.match(verdict.report.error.message, /normative anchor/, label);
  }
});

test("T12 every control must be a plain positive: positive, no error_contains, no controls of its own", () => {
  const plan = loadEvidencePlan();
  assert.doesNotThrow(() => assertVerdictPlan(plan));
  const bundle = plan.suites.find((s) => s.id === "external.v2.bundle_vectors");
  const base = bundle.cases.find((c) => c.id === "external.v2.bundle_vectors.signed_bundle");
  const rejectingMode = bundle.cases.find((c) => c.id.startsWith("external.v2.bundle_vectors.classical_only_routine.") && c.expect.verified === false);
  for (const [label, change] of [
    ["a control with error_contains", () => { base.expect = { ...base.expect, error_contains: "x" }; }],
    ["a control with controls of its own", () => { base.controls = [rejectingMode.id]; }],
    ["a negative control", () => { base.expect = { verified: false }; }],
  ]) {
    const saved = structuredClone(base);
    change();
    assert.throws(() => assertVerdictPlan(plan), InfraError, label);
    for (const k of Object.keys(base)) delete base[k];
    Object.assign(base, saved);
  }
  assert.doesNotThrow(() => assertVerdictPlan(plan));
});

// ── T13: every --assessment error replaces an older report ──────

test("T13 an invalid --assessment replaces an older PASS report with a fresh error", () => {
  const noAnchor = rootWith((rel, d) => { if (rel.endsWith("bundle_vectors.json")) delete d.must_reject[0].spec_step; });
  for (const [label, args, code, kind] of [
    ["an unknown value", ["--catalog", "evidence", "--assessment", "strict"], 2, "usage"],
    ["given twice", ["--catalog", "evidence", "--assessment", "verdict", "--assessment", "verdict"], 2, "usage"],
    ["no value at the end", ["--catalog", "evidence", "--assessment"], 2, "usage"],
    ["no value before another option", ["--catalog", "evidence", "--assessment", "--suite", "external.merkle.dual_root"], 2, "usage"],
    ["legacy with the default /1 catalog", ["--assessment", "legacy"], 2, "usage"],
    ["verdict with the default /1 catalog", ["--assessment", "verdict"], 2, "usage"],
    ["legacy with the /3 catalog", ["--catalog", "admission", "--assessment", "legacy"], 2, "usage"],
    ["verdict with the /3 catalog", ["--catalog", "admission", "--assessment", "verdict"], 2, "usage"],
    ["verdict without an anchor", ["--root", noAnchor, "--catalog", "evidence", "--assessment", "verdict"], 3, "catalog"],
  ]) {
    const file = path.join(TMP, `seeded-${++n}.json`);
    fs.writeFileSync(file, JSON.stringify({ kit: { name: "dcp-ai-conformance-external" }, run: { id: "old-run" }, status: "pass" }));
    const r = cli([...args, "--", ...fakeArgv("unaltered")], file);
    assert.equal(r.code, code, `${label}: ${r.stderr}`);
    assert.equal(r.report.status, "error", label);
    assert.notEqual(r.report.run.id, "old-run", label);
    assert.equal(r.report.error.kind, kind, label);
  }
});

// ── T14: report shapes, claims and --list ───────────────────────

test("T14 legacy reports keep their shape; an explicit legacy equals the default", () => {
  const implicit = fake("unaltered", "legacy").report;
  const explicit = cli(["--catalog", "evidence", "--assessment", "legacy", "--", ...fakeArgv("unaltered")]).report;
  const strip = (r) => { const { run: _run, implementation: _impl, ...rest } = r; return rest; };
  assert.deepEqual(strip(explicit), strip(implicit));
  assert.deepEqual(Object.keys(implicit), ["kit", "run", "implementation", "selection", "status", "totals", "suites", "limits"]);
  assert.ok(implicit.suites.every((s) => JSON.stringify(Object.keys(s)) === JSON.stringify(["id", "title", "claim", "limits", "status", "totals", "cases"])));
  assert.ok(cases(implicit).every((c) => !("diagnostic" in c) && !("anchor" in c)));
  assert.ok(wordingCases(implicit).every((c) => typeof c.expect.error_contains === "string"));
  assert.deepEqual(implicit.suites.map((s) => s.claim), CATALOG.suites.map((s) => s.claim));
});

test("T14 verdict reports: schema, anchors, effective claims and limits, verbatim catalog prose", () => {
  const r = fake("unaltered", "verdict").report;
  assert.equal(r.kit.contract, "dcp-ai-conformance-external/2");
  assert.equal(r.assessment.schema, ASSESSMENT_SCHEMA);
  assert.equal(r.assessment.wording_cases, WORDING);
  assert.deepEqual(r.catalog_limits, CATALOG.limits);
  assert.deepEqual(r.limits, VERDICT_TEXT.limits);
  for (const s of r.suites) {
    const committed = CATALOG.suites.find((x) => x.id === s.id);
    assert.equal(s.catalog_claim, committed.claim);
    assert.deepEqual(s.catalog_limits, committed.limits);
    assert.equal(s.claim, VERDICT_TEXT.suites[s.id].claim);
    assert.deepEqual(s.limits, VERDICT_TEXT.suites[s.id].limits);
    for (const text of [s.claim, ...s.limits]) assert.doesNotMatch(text, /with (its|their) error_contains|judged on its committed error_contains/, s.id);
  }
  const w = wordingCases(r);
  assert.ok(w.every((c) => JSON.stringify(c.expect) === '{"verified":false}' && /^V2-(?:[1-9]|1[0-4])$/.test(c.anchor.step) && c.anchor.document === "spec/VERIFICATION.md"));
  assert.equal(w.filter((c) => c.anchor.step === "V2-11" && c.anchor.field).length, 29);
  // Outside the 146, a verdict report states the same expectations as a legacy one.
  const legacy = new Map(cases(fake("unaltered", "legacy").report).map((c) => [c.id, c]));
  assert.ok(cases(r).filter((c) => !isWording(c)).every((c) => JSON.stringify(c.expect) === JSON.stringify(legacy.get(c.id).expect) && !("diagnostic" in c)));
});

test("T14 the effective texts are the committed prose but for the three wording requirements", () => {
  assert.deepEqual(VERDICT_TEXT.limits.slice(0, 3), CATALOG.limits);
  const changed = [];
  for (const s of CATALOG.suites) {
    if (VERDICT_TEXT.suites[s.id].claim !== s.claim) changed.push(`${s.id} claim`);
    s.limits.forEach((l, i) => { if (VERDICT_TEXT.suites[s.id].limits[i] !== l) changed.push(`${s.id} limit ${i + 1}`); });
  }
  assert.deepEqual(changed, ["external.v2.bundle_vectors claim", "external.v2.bundle_vectors limit 2", "external.v2.secondary_sha3 claim"]);
});

test("T14 a custom /2 catalog by path works in both modes; its prose is kept apart from the effective claims", () => {
  const custom = structuredClone(CATALOG);
  custom.suites[2].claim = "Custom prose that the runner does not check.";
  const file = path.join(TMP, "custom-evidence.json");
  fs.writeFileSync(file, JSON.stringify(custom));
  const legacy = cli(["--catalog", file, "--", ...fakeArgv("unaltered")]);
  assert.equal(legacy.code, 0, legacy.stderr);
  assert.equal(legacy.report.suites[2].claim, custom.suites[2].claim);
  const verdict = cli(["--catalog", file, "--assessment", "verdict", "--", ...fakeArgv("unaltered")]);
  assert.equal(verdict.code, 0, verdict.stderr);
  assert.equal(verdict.report.suites[2].catalog_claim, custom.suites[2].claim);
  assert.equal(verdict.report.suites[2].claim, VERDICT_TEXT.suites["external.v2.bundle_vectors"].claim);
});

test("T14 --list: unchanged without --assessment, states the mode with it", () => {
  const list = (args) => spawnSync(process.execPath, [CLI, "--list", ...args], { encoding: "utf8" });
  const plain = list(["--catalog", "evidence"]);
  assert.equal(plain.status, 0);
  assert.equal(plain.stdout.split("\n").filter(Boolean).length, 5);
  assert.doesNotMatch(plain.stdout, /assessment/);
  const legacy = list(["--catalog", "evidence", "--assessment", "legacy"]);
  assert.match(legacy.stdout, new RegExp(`^assessment: legacy \\(${ASSESSMENT_SCHEMA}\\)$`, "m"));
  const verdict = list(["--catalog", "evidence", "--assessment", "verdict"]);
  assert.match(verdict.stdout, new RegExp(`^assessment: verdict \\(${ASSESSMENT_SCHEMA}\\)$`, "m"));
  assert.match(verdict.stdout, /external\.v2\.bundle_vectors {2}131 cases .*\(117 rejections judged on the verdict alone/);
  assert.equal(list(["--assessment", "verdict"]).status, 2);
  assert.equal(list(["--catalog", "admission", "--assessment", "legacy"]).status, 2);
});

// ── T15: the five real wrappers under the verdict assessment ────

for (const [name, w] of Object.entries(WRAPPERS)) {
  test(`T15 ${name}: verdict 241/241, 146 matched`, (t) => {
    if (!available(t, w)) return;
    const r = cli(["--catalog", "evidence", "--assessment", "verdict", "--", ...w.argv]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.report.totals, { cases: 241, executed: 241, pass: 241, fail: 0, error: 0 });
    assert.deepEqual(r.report.diagnostic_totals, { matched: WORDING, differs: 0, no_message: 0, not_evaluated: 0 });
  });
}
