// Self-tests of the opt-in delegation catalog (contract dcp-ai-conformance-external/4). The implementation is a
// synthetic fake: it answers each request from the corpus expectations the plan carries (no SDK, no wrapper), altered
// by mode, so these tests isolate the runner's validation and judgement. Tampered fixtures and catalogs run on
// temporary copies; no file in the checkout is written.
//
//   node --test tools/conformance/external-delegation.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { loadDelegationPlan, scanJson, INFORMATIVE, SUITES, CLASSIFICATIONS, DELEGATION_CATALOG_1_PATH } from "./external-delegation.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const CLI = path.join(REPO, "tools", "conformance-external.js");
const CATALOG = path.join(HERE, "external-delegation-catalog.json");
const CATALOG1 = DELEGATION_CATALOG_1_PATH;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-delegation-"));
process.on("exit", () => fs.rmSync(TMP, { recursive: true, force: true }));

const PLAN = loadDelegationPlan();
const ALL = PLAN.suites.flatMap((s) => s.cases);
const NORMATIVE = ALL.filter((c) => c.class === "normative");
const NEGATIVES = NORMATIVE.filter((c) => !c.expect.valid);
const POSITIVES = NORMATIVE.filter((c) => c.expect.valid);
// The archived catalog 1.0.0: the same 97 requests, ten of them informative.
const PLAN1 = loadDelegationPlan({ catalogFile: CATALOG1 });
const ALL1 = PLAN1.suites.flatMap((s) => s.cases);
const TEN = Object.keys(INFORMATIVE).sort();
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const fp = (c) => sha(JSON.stringify({ op: c.op, ...c.request }));

/** The honest synthetic answer of one case, from the corpus expectation and its committed wording. */
function honest(c) {
  if (c.expect.valid) return { status: "ok", valid: true, errors: [], effective_tier: c.expect.effective_tier, depth: c.reference.depth };
  return { status: "ok", valid: false, errors: c.reference.errors ?? [`mandate[0]: ${c.reference.error_contains}`], effective_tier: null, depth: 0 };
}

let n = 0;
/** Writes the answers of a mode: alter(c, answer) returns the answer to send. */
function answers(alter = (_c, a) => a) {
  const map = {};
  for (const c of ALL) {
    const k = fp(c);
    assert.ok(!(k in map), `${c.id}: two cases send the same request`);
    map[k] = alter(c, structuredClone(honest(c)));
  }
  const file = path.join(TMP, `answers-${++n}.json`);
  fs.writeFileSync(file, JSON.stringify(map));
  return file;
}

const FAKE = path.join(TMP, "fake.mjs");
fs.writeFileSync(FAKE, `
import fs from "fs";
import crypto from "crypto";
const [answersFile, envelope = "ok"] = process.argv.slice(2);
const req = JSON.parse(fs.readFileSync(0, "utf8"));
const map = JSON.parse(fs.readFileSync(answersFile, "utf8"));
const fp = ({ id, ...rest }) => crypto.createHash("sha256").update(JSON.stringify(rest)).digest("hex");
const results = req.cases.map((c) => ({ id: c.id, ...(map[fp(c)] ?? { status: "error", message: "no synthetic answer" }) }));
const doc = { contract: req.contract, run_id: req.run_id, nonce: req.nonce, implementation: { name: "synthetic", version: "0" }, results };
if (envelope === "stale-run-id") doc.run_id = "00000000-0000-4000-8000-000000000000";
if (envelope === "stale-nonce") doc.nonce = "0".repeat(32);
if (envelope === "other-contract") doc.contract = "dcp-ai-conformance-external/3";
if (envelope === "missing-one") results.pop();
if (envelope === "duplicate-one") results.push(results[0]);
if (envelope === "extra-one") results.push({ ...results[0], id: "not-sent" });
if (envelope === "unknown-field") results[0].extra = 1;
if (envelope === "not-json") process.stdout.write("{");
else if (envelope === "truncated") process.stdout.write(JSON.stringify(doc).slice(0, 2000));
else if (envelope === "sleep") setTimeout(() => {}, 60000);
else {
  process.stdout.write(JSON.stringify(doc));
  if (envelope === "exit-1") process.exitCode = 1;
  if (envelope === "signal") process.kill(process.pid, "SIGKILL");
  if (envelope === "late-exit") setTimeout(() => {}, 60000);
}
`);

/** Runs the CLI against the fake and returns { code, report }. */
function run(answersFile, { envelope = "ok", args = [], timeoutMs, catalog = "delegation" } = {}) {
  const report = path.join(TMP, `report-${++n}.json`);
  const r = spawnSync(process.execPath, [CLI, "--catalog", catalog, ...args, "--report", report, ...(timeoutMs ? ["--timeout-ms", String(timeoutMs)] : []), "--", process.execPath, FAKE, answersFile, envelope], { encoding: "utf8", timeout: 120000 });
  return { code: r.status, report: JSON.parse(fs.readFileSync(report, "utf8")), stdout: r.stdout, stderr: r.stderr };
}
const cases = (report) => report.suites.flatMap((s) => s.cases);
const byId = (report) => new Map(cases(report).map((c) => [c.id, c]));

// ── The catalog and the plan ────────────────────────────────────────

test("the committed catalog is what the corpora and the generator give", () => {
  const r = spawnSync(process.execPath, [path.join(HERE, "delegation-catalog.mjs"), "--check"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

test("the plan is a partition of the three corpora: 97 cases, all normative in 2.0.0, 87 and the 10 fixed informative in 1.0.0", () => {
  const scopesOf = (cases) => { const out = {}; for (const c of cases) out[c.control_scope] = (out[c.control_scope] ?? 0) + 1; return out; };
  for (const plan of [PLAN, PLAN1]) {
    assert.deepEqual(plan.suites.map((s) => s.id), SUITES.map((s) => s.id));
    for (const s of plan.suites) {
      const doc = JSON.parse(fs.readFileSync(path.join(REPO, SUITES.find((x) => x.id === s.id).file), "utf8"));
      assert.deepEqual(s.cases.map((c) => c.name), [...doc.must_accept, ...doc.must_reject].map((c) => c.name), s.id);
    }
  }
  assert.equal(PLAN.catalog.version, "2.0.0");
  assert.equal(ALL.length, 97);
  assert.equal(new Set(ALL.map((c) => c.id)).size, 97);
  assert.equal(NORMATIVE.length, 97);
  assert.equal(POSITIVES.length, 25);
  assert.equal(NEGATIVES.length, 72);
  assert.deepEqual(scopesOf(NEGATIVES), { single_mandate: 48, same_chain: 4, same_shape: 19, suite: 1 });
  // The archive: its exact bytes, its classification, and the same requests and expectations.
  assert.equal(PLAN1.catalog.version, "1.0.0");
  assert.equal(PLAN1.catalog.sha256, CLASSIFICATIONS["1.0.0"].catalog_sha256);
  assert.equal(PLAN1.catalog.sha256, "e31de86f5834c1a394d3beed58f0901d265f5da560b7725aa73dcbf6948a8133");
  assert.deepEqual(ALL1.filter((c) => c.class === "informative").map((c) => c.id).sort(), TEN);
  assert.equal(ALL1.filter((c) => c.class === "normative").length, 87);
  assert.deepEqual(scopesOf(ALL1.filter((c) => c.class === "normative" && !c.expect.valid)), { single_mandate: 48, same_chain: 4, same_shape: 12, suite: 1 });
  assert.deepEqual(ALL1.map((c) => [c.id, c.request, c.expect]), ALL.map((c) => [c.id, c.request, c.expect]));
  // 2.0.0 changes the ten cases only: every other case keeps its anchor, controls and scope.
  const before = new Map(ALL1.map((c) => [c.id, c]));
  const changed = ALL.filter((c) => { const o = before.get(c.id); return o.class !== c.class || o.anchor !== c.anchor || o.control_scope !== c.control_scope || JSON.stringify(o.controls) !== JSON.stringify(c.controls); }).map((c) => c.id).sort();
  assert.deepEqual(changed, TEN);
});

// ── The bytes sent ──────────────────────────────────────────────────

test("chains and keys travel as the exact bytes of the fixture, numbers past 2^53 and times included", () => {
  const files = new Map(SUITES.map((s) => [s.id, fs.readFileSync(path.join(REPO, s.file))]));
  for (const s of PLAN.suites) {
    const file = files.get(s.id);
    const doc = JSON.parse(file.toString("utf8"));
    for (const c of s.cases) {
      for (const field of ["chain_b64", "keys_b64"]) assert.ok(file.includes(Buffer.from(c.request[field], "base64")), `${c.id}: ${field} is a slice of the fixture`);
      const fixtureCase = [...doc.must_accept, ...doc.must_reject].find((x) => x.name === c.name);
      assert.equal(c.request.verification_time, fixtureCase.verification_time ?? doc.verification_time, c.id);
      assert.deepEqual(c.request.revoked_mandate_ids, fixtureCase.revoked_mandate_ids ?? [], c.id);
    }
  }
  const chainOf = (name) => Buffer.from(ALL.find((c) => c.id === `external.delegation.chain.${name}`).request.chain_b64, "base64").toString("utf8");
  assert.match(chainOf("limit_of_2_53_is_not_comparable"), /9007199254740992/);
  assert.match(chainOf("added_limit_of_2_53_plus_1"), /9007199254740993/);
  assert.match(chainOf("limits_written_in_decimal_form"), /9007199254740991\.0/);
  // What JSON.parse + JSON.stringify would have sent instead.
  assert.doesNotMatch(JSON.stringify(JSON.parse(chainOf("added_limit_of_2_53_plus_1"))), /9007199254740993/);
  const time = (name) => ALL.find((c) => c.id === `external.delegation.chain_time.${name}`).request.verification_time;
  assert.equal(time("verification_time_below_the_millisecond"), "2026-10-22T12:00:00.0009Z");
  assert.equal(time("verification_time_with_an_offset"), "2026-10-22T14:00:00+02:00");
});

test("the scanner is strict: duplicate members, trailing data, bad escapes and bad numbers are refused", () => {
  for (const bad of ['{"a":1,"a":2}', '{"a":1} x', '["\\x"]', '[01]', '[1.]', '[-]', '{"a" 1}', '["a\u0001"]', '[tru]']) {
    assert.throws(() => scanJson(bad), /not strict JSON/, bad);
  }
  // A number is one token whatever its length: 401 and 600 digits, with a fraction and an exponent.
  for (const num of ["9".repeat(401), `-${"1".repeat(600)}.${"0".repeat(500)}e-${"7".repeat(450)}`, `1E+${"0".repeat(1000)}`]) {
    const text = `[${num}, 2]`;
    const node = scanJson(text).items[0];
    assert.equal(text.slice(node.start, node.end), num);
  }
  const t = scanJson(' {"a":[1,9007199254740993,2.0e3],"b":"\\u00e9"} ');
  assert.equal(' {"a":[1,9007199254740993,2.0e3],"b":"\\u00e9"} '.slice(t.members.get("a").items[1].start, t.members.get("a").items[1].end), "9007199254740993");
  assert.equal(t.members.get("b").value, "é");
});

// ── Judgement ───────────────────────────────────────────────────────

test("an honest implementation passes: 97 normative cases in 2.0.0, 87 and 10 informative that agree in 1.0.0, wording and depth matched", () => {
  const one = run(answers(), { catalog: CATALOG1 });
  assert.equal(one.code, 0, JSON.stringify(one.report.totals));
  assert.deepEqual(one.report.totals, { cases: 87, executed: 87, pass: 87, fail: 0, error: 0 });
  assert.deepEqual(one.report.informative_totals, { requested: 10, completed: 10, agrees: 10, differs: 0, error: 0 });
  assert.equal(one.report.kit.catalog_version, "1.0.0");
  const { code, report } = run(answers());
  assert.equal(code, 0, JSON.stringify(report.totals));
  assert.equal(report.status, "pass");
  assert.equal(report.kit.catalog_version, "2.0.0");
  assert.deepEqual(report.totals, { cases: 97, executed: 97, pass: 97, fail: 0, error: 0 });
  assert.deepEqual(report.informative_totals, { requested: 0, completed: 0, agrees: 0, differs: 0, error: 0 });
  for (const c of cases(report).filter((x) => x.class === "normative")) {
    if (c.expect.valid) assert.equal(c.diagnostic.depth, "matched", c.id);
    else assert.equal(c.diagnostic.wording, "matched", c.id);
  }
  assert.equal(report.kit.contract, "dcp-ai-conformance-external/4");
  assert.ok(report.run.id && report.run.request_sha256);
});

test("accepting every chain fails exactly the 72 normative rejections", () => {
  const { code, report } = run(answers((c, a) => ({ ...a, valid: true, errors: [], effective_tier: c.expect.valid ? a.effective_tier : null })));
  assert.equal(code, 1);
  assert.equal(report.status, "fail");
  const failed = cases(report).filter((c) => c.status === "fail").map((c) => c.id).sort();
  assert.deepEqual(failed, NEGATIVES.map((c) => c.id).sort());
  assert.equal(report.totals.pass, 25);
});

test("rejecting every chain fails the positives, and no rejection counts without its control", () => {
  const { code, report } = run(answers((_c, a) => ({ ...a, valid: false, errors: ["no"], effective_tier: null, depth: 0 })));
  assert.equal(code, 3);
  assert.equal(report.status, "error");
  const r = byId(report);
  for (const c of POSITIVES) assert.equal(r.get(c.id).status, "fail", c.id);
  for (const c of NEGATIVES) assert.equal(r.get(c.id).kind, "control_failed", c.id);
});

test("a verifier that ignores one rule fails exactly that rule's cases", () => {
  const ignored = (anchor) => run(answers((c, a) => (c.anchor === anchor && !c.expect.valid ? { ...a, valid: true, errors: [] } : a)));
  for (const anchor of ["rule7", "rule3", "rule6"]) {
    const { code, report } = ignored(anchor);
    assert.equal(code, 1, anchor);
    assert.deepEqual(cases(report).filter((c) => c.status === "fail").map((c) => c.id).sort(), NEGATIVES.filter((c) => c.anchor === anchor).map((c) => c.id).sort(), anchor);
  }
  // Root duplicates (rule 5 at depth 0): the domains corpus rejections whose duplicate is in the root.
  const rootDuplicates = NEGATIVES.filter((c) => c.id.startsWith("external.delegation.domains.root_") && c.anchor === "rule5");
  const { report } = run(answers((c, a) => (rootDuplicates.includes(c) ? { ...a, valid: true, errors: [] } : a)));
  assert.deepEqual(cases(report).filter((c) => c.status === "fail").map((c) => c.id).sort(), rootDuplicates.map((c) => c.id).sort());
});

test("a wrong effective tier fails its positive (rule 6), and its rejections lose their control", () => {
  const target = POSITIVES.find((c) => c.expect.effective_tier === "elevated");
  const { code, report } = run(answers((c, a) => (c === target ? { ...a, effective_tier: "standard" } : a)));
  assert.equal(code, 3);
  const r = byId(report);
  assert.equal(r.get(target.id).status, "fail");
  assert.match(r.get(target.id).message, /effective_tier.*rule 6/);
  const dependents = NEGATIVES.filter((c) => c.controls.includes(target.id));
  assert.ok(dependents.length > 0);
  for (const c of dependents) assert.equal(r.get(c.id).kind, "control_failed", c.id);
});

test("wording and depth are diagnostics: other messages, no message, other depth, a rejection's own tier and depth all pass", () => {
  const { code, report } = run(answers((c, a) => (c.expect.valid ? { ...a, depth: a.depth + 1 } : c.class === "informative" ? a
    : { ...a, errors: c.id.endsWith("e") ? [] : ["refused"], depth: 7, effective_tier: "maximum" })));
  assert.equal(code, 0, JSON.stringify(report.totals));
  const wording = cases(report).filter((c) => c.class === "normative" && !c.expect.valid).map((c) => c.diagnostic.wording);
  assert.ok(wording.includes("differs") && wording.includes("no_message"));
  assert.ok(cases(report).filter((c) => c.class === "normative" && c.expect.valid).every((c) => c.diagnostic.depth === "differs"));
});

// The same wrong verdicts on the ten cases, judged by each version's own classification: never by the other's.
const flipTen = (c, a) => (TEN.includes(c.id) ? { ...a, valid: !a.valid, errors: a.valid ? ["x"] : [], effective_tier: a.valid ? null : a.effective_tier } : a);

test("1.0.0 (archived): its informative cases never decide the run: differing verdicts pass, a failed answer is an error", () => {
  const flip = run(answers(flipTen), { catalog: CATALOG1 });
  assert.equal(flip.code, 0);
  assert.deepEqual(flip.report.informative_totals, { requested: 10, completed: 10, agrees: 0, differs: 10, error: 0 });
  assert.deepEqual(flip.report.totals, { cases: 87, executed: 87, pass: 87, fail: 0, error: 0 });
  for (const status of [{ status: "error", message: "boom" }, { status: "unsupported" }, { status: "ok", valid: "yes", errors: [], effective_tier: null, depth: 0 }]) {
    const one = Object.keys(INFORMATIVE)[0];
    const { code, report } = run(answers((c, a) => (c.id === one ? status : a)), { catalog: CATALOG1 });
    assert.equal(code, 3, JSON.stringify(status));
    assert.equal(report.status, "error");
    assert.equal(report.totals.error, 0, "the 87 normative cases still pass");
    assert.equal(report.informative_totals.error, 1);
  }
});

test("2.0.0: the ten cases are normative: the same differing verdicts fail exactly them", () => {
  const { code, report } = run(answers(flipTen));
  assert.equal(code, 1);
  assert.deepEqual(cases(report).filter((c) => c.status === "fail").map((c) => c.id).sort(), TEN);
  assert.deepEqual(report.informative_totals, { requested: 0, completed: 0, agrees: 0, differs: 0, error: 0 });
  assert.ok(cases(report).every((c) => c.kind !== "control_failed"));
});

test("malformed, contradictory, rejected and unsupported answers are errors, never a verdict", () => {
  const target = NEGATIVES[0];
  for (const [bad, kind] of [
    [{ status: "ok", valid: "false", errors: [], effective_tier: null, depth: 0 }, "malformed_result"],
    [{ status: "ok", valid: false, errors: "x", effective_tier: null, depth: 0 }, "malformed_result"],
    [{ status: "ok", valid: false, errors: [], effective_tier: "high", depth: 0 }, "malformed_result"],
    [{ status: "ok", valid: false, errors: [], effective_tier: null, depth: -1 }, "malformed_result"],
    [{ status: "ok", valid: false, errors: [], effective_tier: null }, "malformed_result"],
    [{ status: "ok", valid: false, errors: [], effective_tier: null, depth: 0, codes: [] }, "malformed_result"],
    [{ status: "rejected", code: "parse" }, "malformed_result"],
    [{ status: "unsupported" }, "unsupported"],
    [{ status: "error", message: "boom" }, "implementation"],
  ]) {
    const { code, report } = run(answers((c, a) => (c === target ? bad : a)));
    assert.equal(code, 3, JSON.stringify(bad));
    assert.equal(byId(report).get(target.id).kind, kind, JSON.stringify(bad));
  }
  const positive = POSITIVES[0];
  const { report } = run(answers((c, a) => (c === positive ? { ...a, errors: ["but"] } : a)));
  assert.equal(byId(report).get(positive.id).kind, "contradictory_result");
});

test("the transport: missing, duplicate, extra, truncated, stale, failing, killed, hung and late processes are errors", () => {
  const file = answers();
  for (const envelope of ["missing-one", "duplicate-one", "extra-one", "unknown-field", "not-json", "truncated", "stale-run-id", "stale-nonce", "other-contract", "exit-1", "signal"]) {
    const { code, report } = run(file, { envelope });
    assert.equal(code, 3, envelope);
    assert.equal(report.status, "error", envelope);
  }
  for (const envelope of ["sleep", "late-exit"]) {
    const { code, report } = run(file, { envelope, timeoutMs: 1500 });
    assert.equal(code, 3, envelope);
    assert.ok(report.implementation.observed.timed_out, envelope);
  }
});

// ── Selection, reports, catalogs and fixtures ───────────────────────

test("a suite selected alone runs with its controls; unknown, repeated or empty selections and --assessment are usage errors", () => {
  const { code, report } = run(answers(), { args: ["--suite", "external.delegation.domains"] });
  assert.equal(code, 0);
  assert.deepEqual(report.selection, ["external.delegation.domains"]);
  assert.equal(report.totals.cases, 23);
  const usage = (args) => spawnSync(process.execPath, [CLI, "--catalog", "delegation", ...args, "--", process.execPath, FAKE, "x"], { encoding: "utf8" }).status;
  assert.equal(usage(["--suite", "external.delegation.nope"]), 2);
  assert.equal(usage(["--suite", "external.delegation.chain", "--suite", "external.delegation.chain"]), 2);
  assert.equal(usage(["--assessment", "verdict"]), 2);
  assert.equal(usage(["--assessment", "legacy"]), 2);
});

test("a failed run replaces an older passing report with a fresh one", () => {
  const report = path.join(TMP, "fresh.json");
  fs.writeFileSync(report, JSON.stringify({ status: "pass", run: { id: "old" } }));
  const r = spawnSync(process.execPath, [CLI, "--catalog", "delegation", "--report", report, "--", process.execPath, FAKE, answers(), "not-json"], { encoding: "utf8" });
  assert.equal(r.status, 3);
  const doc = JSON.parse(fs.readFileSync(report, "utf8"));
  assert.equal(doc.status, "error");
  assert.notEqual(doc.run.id, "old");
});

/** Runs the CLI on a tampered catalog (or fixture root) and returns its exit code. */
function tampered({ catalog = (c) => c, root } = {}) {
  const cat = catalog(JSON.parse(fs.readFileSync(CATALOG, "utf8")));
  const file = path.join(TMP, `catalog-${++n}.json`);
  fs.writeFileSync(file, JSON.stringify(cat));
  return spawnSync(process.execPath, [CLI, "--catalog", file, ...(root ? ["--root", root] : []), "--list"], { encoding: "utf8" });
}
const caseOf = (cat, id) => cat.suites.flatMap((s) => s.cases).find((c) => c.id === id);

test("a catalog that misclassifies, drops, repeats, reorders or overstates a case is an infrastructure error", () => {
  assert.equal(tampered().status, 0);
  const sameShape = NEGATIVES.find((c) => c.control_scope === "same_shape").id;
  const singleMandate = NEGATIVES.find((c) => c.control_scope === "single_mandate").id;
  const informative = Object.keys(INFORMATIVE)[0];
  for (const [what, edit] of [
    ["an overstated control", (c) => { caseOf(c, sameShape).control_scope = "single_mandate"; return c; }],
    ["a same_chain claim on another chain", (c) => { caseOf(c, singleMandate).control_scope = "same_chain"; return c; }],
    ["a control that is a negative", (c) => { caseOf(c, singleMandate).controls = [sameShape]; return c; }],
    ["the ten made informative again (the 1.0.0 classification)", (c) => {
      for (const id of TEN) { const x = caseOf(c, id); for (const k of ["anchor", "controls", "control_scope"]) delete x[k]; Object.assign(x, { class: "informative", basis: INFORMATIVE[id] }); }
      Object.assign(c, { informative_bases: CLASSIFICATIONS["1.0.0"].informative_bases, informative: INFORMATIVE });
      return c;
    }],
    ["one case made informative", (c) => { c.informative[informative] = "signer_key_validity"; return c; }],
    ["a normative case made informative", (c) => { c.informative[NEGATIVES[0].id] = "millisecond_precision"; return c; }],
    ["a dropped case", (c) => { c.suites[0].cases.pop(); return c; }],
    ["a repeated case", (c) => { c.suites[2].cases.push(c.suites[2].cases[0]); return c; }],
    ["two cases swapped", (c) => { const s = c.suites[0].cases; [s[0], s[1]] = [s[1], s[0]]; return c; }],
    ["an unknown anchor", (c) => { caseOf(c, NEGATIVES[0].id).anchor = "rule8"; return c; }],
    ["a positive with a rule anchor", (c) => { caseOf(c, POSITIVES[0].id).anchor = "rule1"; return c; }],
    ["another fixture pin", (c) => { c.fixtures[SUITES[0].file] = "0".repeat(64); return c; }],
    ["another contract", (c) => { c.contract = "dcp-ai-conformance-external/3"; return c; }],
    ["an unknown member", (c) => { c.extra = 1; return c; }],
  ]) {
    const r = tampered({ catalog: edit });
    // Another contract routes to another loader, which refuses this catalog as well.
    assert.equal(r.status, 3, `${what}: ${r.stderr}`);
  }
});

test("each version keeps its own classification: a relabeled, re-serialized or unknown catalog is an infrastructure error", () => {
  const list = (text) => {
    const file = path.join(TMP, `catalog-${++n}.json`);
    fs.writeFileSync(file, text);
    return spawnSync(process.execPath, [CLI, "--catalog", file, "--list"], { encoding: "utf8" });
  };
  const archived = fs.readFileSync(CATALOG1, "utf8");
  const current = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
  assert.equal(list(archived).status, 0, "the archived bytes load as 1.0.0");
  for (const [what, text] of [
    ["1.0.0 relabeled 2.0.0, its ten still informative", JSON.stringify({ ...JSON.parse(archived), catalog_version: "2.0.0" })],
    ["2.0.0 relabeled 1.0.0, its ten normative", JSON.stringify({ ...current, catalog_version: "1.0.0" })],
    ["1.0.0 re-serialized: the same JSON in other bytes", JSON.stringify(JSON.parse(archived))],
    ["an unknown version", JSON.stringify({ ...current, catalog_version: "2.0.1" })],
  ]) {
    const r = list(text);
    assert.equal(r.status, 3, `${what}: ${r.stderr}`);
  }
});

test("a fixture that is not the pinned one, or not strict JSON, is an infrastructure error", () => {
  for (const [what, edit] of [
    ["one byte changed", (text) => text.replace("2026-10-22T12:00:00Z", "2026-10-22T12:00:01Z")],
    ["a duplicate member", (text) => text.replace('"verification_time"', '"verification_time": "x", "verification_time"')],
  ]) {
    const root = fs.mkdtempSync(path.join(TMP, "root-"));
    for (const { file } of SUITES) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.copyFileSync(path.join(REPO, file), path.join(root, file));
    }
    const target = path.join(root, SUITES[0].file);
    fs.writeFileSync(target, edit(fs.readFileSync(target, "utf8")));
    const r = tampered({ root });
    assert.equal(r.status, 3, `${what}: ${r.stderr}`);
  }
});
