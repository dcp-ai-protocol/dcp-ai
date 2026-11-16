// Self-tests of the opt-in admission catalog (contract dcp-ai-conformance-external/3). The implementation is a
// synthetic fake: it answers each request from the catalog's own expectations (no SDK, no wrapper), altered by mode,
// so these tests isolate the runner's validation and judgement. Tampered fixtures and catalogs run on temporary
// copies; no file in the checkout is written.
//
//   node --test tools/conformance/external-admission.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { loadAdmissionPlan, orderProblem, cardinalityProblem } from "./external-admission.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const CLI = path.join(REPO, "tools", "conformance-external.js");
const CATALOG = path.join(HERE, "external-admission-catalog.json");
const VECTORS = "tests/interop/v2/admission_vectors.json";
const BUNDLES = "tests/interop/v2/bundle_vectors.json";
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-admission-"));
process.on("exit", () => fs.rmSync(TMP, { recursive: true, force: true }));

const PLAN = loadAdmissionPlan();
const ALL = PLAN.suites.flatMap((s) => s.cases);
const BY_NAME = new Map(ALL.map((c) => [c.id, c]));
const OUT = "external.admission.outcomes.";
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const fp = (c) => sha(JSON.stringify({ op: c.op, ...c.request }));

// Phases of the text, written here independently of the runner.
const phase = (k, verified) => (k === "PROFILE_V2_REQUIRED" ? 0 : k.startsWith("PROFILE_AUDIENCE_") ? 1 : k.startsWith("PROFILE_SESSION_") ? 2
  : k === "PROFILE_HYBRID_REQUIRED" ? (verified ? 6 : 3) : k === "VERIFICATION_FAILED" ? 4 : k.startsWith("TRUST_") ? 5 : 7);
const phased = (codes, verified) => [...codes].sort((a, b) => phase(a, verified) - phase(b, verified));
const phases = (codes, verified) => new Set(codes.map((k) => phase(k, verified))).size;

/** The honest synthetic answer of one case, from its expectation. */
function honest(c) {
  if (c.op === "load_admission_config") {
    if (c.expect.reject) return { status: "rejected", code: c.expect.allowed_codes[0] };
    return c.request.kind === "profile"
      ? { status: "ok", accepted: true, max_session_duration_seconds: c.expect.max_session_duration_seconds ?? 300, max_revocation_age_seconds: c.expect.max_revocation_age_seconds ?? 300 }
      : { status: "ok", accepted: true };
  }
  if (c.expect.rejected) return { status: "rejected", code: c.expect.rejected };
  const e = c.expect.result;
  return { status: "ok", ...e, codes: phased(e.codes, e.verified), verification_verified: e.verified };
}

/** Writes the answers of a mode: alter(c, answer) returns the answer to send, or the honest one unchanged. */
let n = 0;
function answers(alter = (_c, a) => a) {
  const map = {};
  for (const c of ALL) {
    const a = alter(c, structuredClone(honest(c)));
    const k = fp(c);
    // Two cases may send the same request (profile_defaults loads the strict profile): their answers must agree.
    assert.ok(!(k in map) || JSON.stringify(map[k]) === JSON.stringify(a), `${c.id}: two answers for one request`);
    map[k] = a;
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
if (envelope === "other-contract") doc.contract = "dcp-ai-conformance-external/2";
if (envelope === "missing-one") results.pop();
if (envelope === "duplicate-one") results.push(results[0]);
if (envelope === "extra-one") results.push({ ...results[0], id: "not-sent" });
if (envelope === "unknown-field") results[0].extra = 1;
if (envelope === "not-json") process.stdout.write("{");
else if (envelope === "sleep") setTimeout(() => {}, 60000);
else {
  process.stdout.write(JSON.stringify(doc));
  if (envelope === "exit-1") process.exitCode = 1;
  if (envelope === "signal") process.kill(process.pid, "SIGKILL");
}
`);

function run(args) {
  const report = path.join(TMP, `report-${++n}.json`);
  const r = spawnSync(process.execPath, [CLI, "--report", report, ...args], { encoding: "utf8", timeout: 300000, maxBuffer: 1 << 26 });
  return { code: r.status, report: JSON.parse(fs.readFileSync(report, "utf8")), stdout: r.stdout, stderr: r.stderr };
}
const fake = (alter, { envelope = "ok", args = [] } = {}) => run(["--catalog", "admission", ...args, "--", process.execPath, FAKE, answers(alter), envelope]);
const cases = (report) => report.suites.flatMap((s) => s.cases);
const byId = (report) => new Map(cases(report).map((c) => [c.id, c]));
const isNegative = (c) => c.op === "admit_signed_bundle_v2" && (c.expect.rejected || !c.expect.result.admitted);
const admits = (c) => c.op === "admit_signed_bundle_v2" && !c.expect.rejected;
const O12 = new Set(["external.admission.composed.trust_then_revocation", "external.admission.composed.session_then_structural_p4"]);

// ── The sound fake, listing and selection ───────────────────────

test("synthetic answers from the expectations pass 140/140 (the fake is sound)", () => {
  const r = fake();
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.report.totals, { cases: 140, executed: 140, pass: 140, fail: 0, error: 0 });
  assert.equal(r.report.kit.contract, "dcp-ai-conformance-external/3");
  assert.deepEqual(r.report.controls_included, []);
  assert.deepEqual(Object.keys(r.report.kit.fixtures_sha256).sort(), [VECTORS, BUNDLES].sort());
});

test("--list shows the three suites and their pinned counts", () => {
  const r = spawnSync(process.execPath, [CLI, "--catalog", "admission", "--list"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  for (const line of ["external.admission.outcomes  65 cases", "external.admission.config  71 cases", "external.admission.composed  4 cases"]) assert.ok(r.stdout.includes(line), line);
});

test("--suite runs the controls a selected negative needs, transitively, and marks them", () => {
  const r = fake(undefined, { args: ["--suite", "external.admission.composed"] });
  assert.equal(r.code, 0, r.stderr);
  const want = ["A_known_principal_strict", "6_key_revoked_in_trust_set", "10_operator_lowers_maximum", "11_classical_only_bundle", "13_agent_revoked"].map((x) => OUT + x);
  assert.deepEqual([...r.report.controls_included].sort(), [...want].sort());
  const included = r.report.suites.filter((s) => s.included_for_controls);
  assert.equal(included.length, 1);
  assert.deepEqual(included[0].cases.map((c) => c.id).sort(), [...want].sort());
  assert.equal(r.report.totals.cases, 9);
  // A selection whose controls are in the same suite pulls nothing in.
  assert.deepEqual(fake(undefined, { args: ["--suite", "external.admission.config"] }).report.controls_included, []);
});

test("a control that fails in a partial selection gates its negatives; it is never skipped", () => {
  // By request, not by id: 10_session_300_s_exactly sends the very request of A_known_principal_strict.
  const anchor = fp(BY_NAME.get(OUT + "A_known_principal_strict"));
  const r = fake((c, a) => (fp(c) === anchor ? { ...a, principal_trust: "untrusted", admitted: false, codes: ["TRUST_KEY_NOT_ANCHORED"] } : a), { args: ["--suite", "external.admission.composed"] });
  assert.equal(r.code, 3);
  const ids = byId(r.report);
  for (const d of ["profile_without_trust_set", "profile_with_caller_policy", "trust_then_revocation", "session_then_structural_p4"]) assert.equal(ids.get(`external.admission.composed.${d}`).kind, "control_failed", d);
});

// ── Wrong decisions ─────────────────────────────────────────────

test("admitting everything fails every negative and both refusals", () => {
  const r = fake((c, a) => {
    if (!isNegative(c)) return a;
    const trust = c.request.trust_set !== null, profile = c.request.profile !== null;
    return { status: "ok", verified: true, principal_trust: trust ? "trusted" : "not_evaluated", profile: profile ? "strict-v1" : null, profile_compliance: profile ? "compliant" : "not_evaluated",
      admitted: true, action_authorized: false, recorded_decision: "approve", trust_set_version: trust ? c.request.trust_set.trust_set_version : null, codes: [], verification_verified: true };
  });
  assert.equal(r.code, 3);
  const negatives = cases(r.report).filter(isNegative);
  assert.equal(negatives.length, 48 + 4);
  // The two compositions are gated by the vectors they compose, which now fail: control_failed, never a pass.
  for (const c of negatives) assert.deepEqual([c.status, c.kind], [O12.has(c.id) ? "error" : "fail", O12.has(c.id) ? "control_failed" : "discrepancy"], c.id);
  assert.ok(cases(r.report).filter((c) => !isNegative(c)).every((c) => c.status === "pass"));
});

test("deciding on verified alone contradicts §3 or §5.2 wherever a trust set or a profile was given", () => {
  const r = fake((c, a) => (admits(c) ? { ...a, principal_trust: "not_evaluated", profile_compliance: "not_evaluated", admitted: a.verified, codes: a.verified ? [] : ["VERIFICATION_FAILED"] } : a));
  assert.equal(r.code, 3);
  const touched = cases(r.report).filter((c) => admits(c) && (c.expect.result.principal_trust !== "not_evaluated" || c.expect.result.profile_compliance !== "not_evaluated"));
  assert.ok(touched.length > 50 && touched.every((c) => c.status !== "pass"));
  assert.ok(touched.some((c) => c.kind === "contradictory_result"));
});

test("trust taken from the bundle fails every case whose principal is untrusted", () => {
  const r = fake((c, a) => {
    if (!admits(c) || !a.codes.some((k) => k.startsWith("TRUST_"))) return a;
    const codes = a.codes.filter((k) => !k.startsWith("TRUST_"));
    return { ...a, principal_trust: "trusted", codes, admitted: codes.length === 0 };
  });
  assert.equal(r.code, 3);
  const untrusted = cases(r.report).filter((c) => admits(c) && c.expect.result.codes.some((k) => k.startsWith("TRUST_")));
  assert.ok(untrusted.length >= 15);
  for (const c of untrusted) assert.equal(c.kind, c.id === "external.admission.composed.trust_then_revocation" ? "control_failed" : "discrepancy", c.id);
});

test("an unavailable revocation read as not revoked is caught (R1)", () => {
  const r = fake((c, a) => (admits(c) && a.codes.includes("REVOCATION_UNAVAILABLE") ? { ...a, codes: [], profile_compliance: "compliant", admitted: true } : a));
  assert.equal(r.code, 1);
  assert.equal(byId(r.report).get(OUT + "13_unavailable").kind, "discrepancy");
});

test("action_authorized true is a contradictory result, never a pass", () => {
  const r = fake((c, a) => (admits(c) && a.admitted ? { ...a, action_authorized: true } : a));
  assert.equal(r.code, 3);
  const admitted = cases(r.report).filter((c) => admits(c) && c.expect.result.admitted);
  assert.equal(admitted.length, 17);
  assert.ok(admitted.every((c) => c.kind === "contradictory_result"));
});

test("profile and trust_set_version are judged as the inputs imply", () => {
  const r = fake((c, a) => (admits(c) ? { ...a, profile: null, trust_set_version: null } : a));
  assert.equal(r.code, 3);
  for (const c of cases(r.report).filter(admits)) {
    const given = c.expect.result.profile !== null || c.expect.result.trust_set_version !== null;
    // Where the control itself is now wrong, the negative is gated (control_failed) instead of judged.
    assert.equal(c.status === "pass", !given, c.id);
    if (given) assert.ok(["discrepancy", "control_failed"].includes(c.kind), c.id);
  }
  assert.equal(byId(r.report).get(OUT + "A_known_principal_strict").kind, "discrepancy");
});

test("verification_verified that contradicts verified is a contradictory result", () => {
  const r = fake((c, a) => (admits(c) ? { ...a, verification_verified: !a.verified } : a));
  assert.equal(r.code, 3);
  assert.ok(cases(r.report).filter(admits).every((c) => c.kind === "contradictory_result"));
});

// ── Order of the raw sequence ───────────────────────────────────

test("codes in the inverse phase order fail with kind order; one-phase sequences pass", () => {
  const r = fake((c, a) => (admits(c) ? { ...a, codes: [...a.codes].reverse() } : a));
  assert.equal(r.code, 3);
  for (const c of cases(r.report).filter(admits)) {
    const multi = phases(c.expect.result.codes, c.expect.result.verified) > 1;
    if (c.id === "external.admission.composed.session_then_structural_p4") { assert.equal(c.kind, "control_failed"); continue; } // it composes two multi-phase vectors
    assert.equal(c.status, multi ? "fail" : "pass", c.id);
    if (multi) assert.equal(c.kind, "order", c.id);
  }
});

test("a late repetition out of phase fails, although its first appearances are in order", () => {
  const r = fake((c, a) => (admits(c) && phases(a.codes, a.verified) > 1 ? { ...a, codes: [...a.codes, a.codes[0]] } : a));
  assert.equal(r.code, 3);
  const repeated = cases(r.report).filter((c) => admits(c) && phases(c.expect.result.codes, c.expect.result.verified) > 1);
  assert.ok(repeated.length >= 15);
  for (const c of repeated) {
    assert.equal(c.kind, c.id === "external.admission.composed.session_then_structural_p4" ? "control_failed" : "order", c.id);
    const firsts = phased(c.expect.result.codes, c.expect.result.verified); // what first appearances alone would see
    assert.equal(orderProblem(firsts, c.expect.result.verified).problem, undefined, c.id);
  }
});

test("codes sorted alphabetically fail only the two composed order cases", () => {
  const r = fake((c, a) => (admits(c) ? { ...a, codes: [...a.codes].sort() } : a));
  assert.equal(r.code, 1);
  const failed = cases(r.report).filter((c) => c.status !== "pass").map((c) => c.id).sort();
  assert.deepEqual(failed, ["external.admission.composed.session_then_structural_p4", "external.admission.composed.trust_then_revocation"]);
  assert.ok(cases(r.report).filter((c) => c.status !== "pass").every((c) => c.kind === "order"));
});

// Codes of checks that apply to several components or subjects (spec/profiles/admission §5.2): P4, T2, R4 and R5.
const REPEATABLE = (k) => k === "PROFILE_HYBRID_REQUIRED" || k.startsWith("TRUST_KEY_") || k === "REVOCATION_REVOKED" || k === "REVOCATION_UNKNOWN";

test("repetition of a per-component or per-subject code, and the other code of each multiple defect, pass (positive control of the judge)", () => {
  const r = fake((c, a) => {
    if (admits(c)) return { ...a, codes: a.codes.flatMap((k) => (REPEATABLE(k) ? [k, k, k] : [k])) };
    if (c.expect.multiple_defects) return { status: "rejected", code: c.expect.allowed_codes[1] };
    return a;
  });
  assert.equal(r.code, 0, r.stderr);
  const multi = cases(r.report).filter((c) => c.expect.multiple_defects);
  assert.equal(multi.length, 3);
  assert.ok(multi.every((c) => c.status === "pass" && c.answered_code === c.expect.allowed_codes[1]));
});

test("a singular check's code added twice fails with kind cardinality (P1, T1, R1, R2, R3, P2, P3, step 2)", () => {
  const twice = {
    "11_v1_bundle": "PROFILE_V2_REQUIRED", "1_empty_trust_set": "TRUST_PRINCIPAL_UNKNOWN", "13_unavailable": "REVOCATION_UNAVAILABLE",
    "13_checked_30_001_s_ahead": "REVOCATION_INVALID", "13_stale_by_1_ms": "REVOCATION_STALE", "8_other_intended_verifier": "PROFILE_AUDIENCE_MISMATCH",
    "10_session_301_s": "PROFILE_SESSION_TOO_LONG", "12_pq_signature_present_and_invalid": "VERIFICATION_FAILED",
  };
  const r = fake((c, a) => {
    const k = twice[c.id.slice(OUT.length)];
    return c.id.startsWith(OUT) && k ? { ...a, codes: a.codes.flatMap((x) => (x === k ? [x, x] : [x])) } : a;
  });
  assert.equal(r.code, 1);
  const failed = cases(r.report).filter((c) => c.status !== "pass");
  assert.deepEqual(failed.map((c) => c.id).sort(), Object.keys(twice).map((x) => OUT + x).sort());
  assert.ok(failed.every((c) => c.kind === "cardinality"));
});

test("cardinalityProblem: per-component and per-subject codes may repeat, singular ones may not", () => {
  assert.equal(cardinalityProblem(["TRUST_KEY_NOT_ANCHORED", "TRUST_KEY_NOT_ANCHORED", "TRUST_KEY_REVOKED", "TRUST_KEY_REVOKED"]), null);
  assert.equal(cardinalityProblem(["PROFILE_HYBRID_REQUIRED", "PROFILE_HYBRID_REQUIRED", "VERIFICATION_FAILED"]), null);
  assert.equal(cardinalityProblem(["REVOCATION_STALE", "REVOCATION_REVOKED", "REVOCATION_REVOKED", "REVOCATION_UNKNOWN", "REVOCATION_UNKNOWN"]), null);
  for (const k of ["PROFILE_V2_REQUIRED", "TRUST_PRINCIPAL_UNKNOWN", "REVOCATION_UNAVAILABLE", "REVOCATION_INVALID", "REVOCATION_STALE", "VERIFICATION_FAILED", "PROFILE_AUDIENCE_MISSING", "PROFILE_SESSION_EXPIRED"]) {
    assert.ok(cardinalityProblem([k, k]), k);
  }
});

test("orderProblem: the structural and verified parts of P4, and the stops of the text", () => {
  assert.deepEqual(orderProblem(["PROFILE_HYBRID_REQUIRED", "TRUST_KEY_REVOKED", "PROFILE_HYBRID_REQUIRED"], true), { ambiguous: true });
  assert.ok(orderProblem(["REVOCATION_REVOKED", "PROFILE_HYBRID_REQUIRED"], true).problem);
  assert.deepEqual(orderProblem(["PROFILE_HYBRID_REQUIRED", "VERIFICATION_FAILED"], false), { ambiguous: false });
  assert.ok(orderProblem(["VERIFICATION_FAILED", "PROFILE_HYBRID_REQUIRED"], false).problem);
  assert.ok(orderProblem(["PROFILE_V2_REQUIRED", "VERIFICATION_FAILED"], false).problem, "P1 stops");
  assert.ok(orderProblem(["TRUST_PRINCIPAL_UNKNOWN", "TRUST_KEY_NOT_ANCHORED"], true).problem, "T1 stops");
  assert.ok(orderProblem(["REVOCATION_UNAVAILABLE", "REVOCATION_STALE"], true).problem, "R1 stops");
  assert.ok(orderProblem(["VERIFICATION_FAILED", "TRUST_KEY_REVOKED"], false).problem, "no trust without verification");
  assert.deepEqual(orderProblem(["REVOCATION_REVOKED", "REVOCATION_STALE"], true), { ambiguous: false }, "no order inside revocation");
});

// ── Configuration ───────────────────────────────────────────────

test("a configuration code outside allowed_codes fails, for singletons and multiple defects", () => {
  const r = fake((c, a) => {
    if (!c.expect.reject) return a;
    const other = ["CONFIG_UNKNOWN_FIELD", "CONFIG_INVALID_VALUE"].find((k) => !c.expect.allowed_codes.includes(k));
    return { status: "rejected", code: other };
  });
  assert.equal(r.code, 1);
  const rejections = cases(r.report).filter((c) => c.expect.reject);
  assert.equal(rejections.length, 49);
  assert.ok(rejections.every((c) => c.status === "fail" && c.kind === "discrepancy"));
});

test("a configuration code given only as an error text is never a pass", () => {
  const r = fake((c, a) => (c.expect.reject ? { status: "error", message: `AdmissionConfigError: ${c.expect.allowed_codes[0]}` } : a));
  assert.equal(r.code, 3);
  assert.ok(cases(r.report).filter((c) => c.expect.reject).every((c) => c.status === "error" && c.kind === "implementation"));
});

test("accepting a rejected configuration, or rejecting a valid one, is a discrepancy", () => {
  const r = fake((c, a) => {
    if (c.op !== "load_admission_config") return a;
    if (c.expect.reject) return c.request.kind === "profile" ? { status: "ok", accepted: true, max_session_duration_seconds: 300, max_revocation_age_seconds: 300 } : { status: "ok", accepted: true };
    return c.id.includes(".load.trust_set.") ? { status: "rejected", code: "CONFIG_INVALID_VALUE" } : a;
  });
  assert.equal(r.code, 3);
  const ids = byId(r.report);
  assert.ok(cases(r.report).filter((c) => c.id.includes(".load.trust_set.")).every((c) => c.kind === "discrepancy"));
  // The trust-set rejections lose their control (loading the principal trust set) and are gated, not passed.
  assert.ok(cases(r.report).filter((c) => c.expect.reject && c.id.startsWith("external.admission.config.reject.7_")).every((c) => c.kind === "control_failed"));
  assert.equal(ids.get("external.admission.config.reject.14_allow_v1_bundles").kind, "discrepancy");
});

test("every profile load is judged on its §4.1 effective maxima (120 s for strict_120_s, 45/30 for profile_tightened)", () => {
  const loads = cases(fake().report).filter((c) => c.op === "load_admission_config" && c.expect.accept && c.id.includes("profile"));
  const maxima = Object.fromEntries(loads.map((c) => [c.id.split(".").slice(-1)[0], [c.expect.max_session_duration_seconds, c.expect.max_revocation_age_seconds]]));
  assert.deepEqual(maxima, {
    profile_tightened: [45, 30], profile_defaults: [300, 300], strict: [300, 300], strict_120_s: [120, 300], strict_other_verifier: [300, 300],
    strict_slh_dsa_only: [300, 300], strict_ml_dsa_rejected_by_advisory: [300, 300], strict_restated_defaults: [300, 300],
  });
  // A loader that ignores the profile's own 120 s maximum and answers the default fails that case only.
  const r = fake((c, a) => (c.id === "external.admission.config.load.profile.strict_120_s" ? { ...a, max_session_duration_seconds: 300 } : a));
  assert.equal(r.code, 1);
  const failed = cases(r.report).filter((c) => c.status !== "pass");
  assert.deepEqual(failed.map((c) => [c.id, c.kind]), [["external.admission.config.load.profile.strict_120_s", "discrepancy"]]);
});

test("unknown codes and wrong types are malformed results", () => {
  const r = fake((c, a) => {
    if (c.id === OUT + "13_stale_by_1_ms") return { ...a, codes: [...a.codes, "INVENTED_CODE"] };
    if (c.id === OUT + "B_general_verifier_unchanged") return { ...a, verified: "true" };
    if (c.id === "external.admission.config.accepted_profiles.profile_tightened") return { ...a, max_session_duration_seconds: 45.5 };
    return a;
  });
  assert.equal(r.code, 3);
  const ids = byId(r.report);
  for (const id of [OUT + "13_stale_by_1_ms", OUT + "B_general_verifier_unchanged", "external.admission.config.accepted_profiles.profile_tightened"]) assert.equal(ids.get(id).kind, "malformed_result", id);
});

// ── Infrastructure: never a rejection, never "not admitted" ─────

for (const [envelope, args] of [["exit-1"], ["signal"], ["not-json"], ["stale-run-id"], ["stale-nonce"], ["other-contract"], ["sleep", ["--timeout-ms", "1500"]]]) {
  test(`infrastructure: ${envelope} is an error for every case`, () => {
    const r = fake(undefined, { envelope, args });
    assert.equal(r.code, 3, r.stderr);
    assert.equal(r.report.status, "error");
    assert.ok(cases(r.report).every((c) => c.status === "error"), "no case passes, negatives included");
  });
}

for (const [envelope, kind] of [["missing-one", "missing"], ["duplicate-one", "duplicate"], ["extra-one", "extra"], ["unknown-field", "malformed_result"]]) {
  test(`results: ${envelope} is an error (${kind})`, () => {
    const r = fake(undefined, { envelope });
    assert.equal(r.code, 3);
    assert.ok(cases(r.report).some((c) => c.status === "error" && c.kind === kind));
  });
}

// ── Report ──────────────────────────────────────────────────────

test("the report gives each case its rule, source, input_sha256, controls and their scope", () => {
  const r = fake();
  const all = cases(r.report);
  assert.ok(all.every((c) => typeof c.rule === "string" && typeof c.source === "string" && /^[0-9a-f]{64}$/.test(c.input_sha256)));
  const outcomeNegatives = all.filter((c) => c.id.startsWith(OUT) && !c.expect.result.admitted);
  assert.equal(outcomeNegatives.length, 48);
  assert.equal(outcomeNegatives.filter((c) => c.control_scope === "suite").length, 19);
  assert.equal(outcomeNegatives.filter((c) => c.control_scope === "same_bundle").length, 29);
  assert.ok(all.filter((c) => c.id.startsWith("external.admission.composed.")).every((c) => c.control_scope === "inputs" && c.composes.length > 0));
  assert.ok(BY_NAME.size === 140);
});

// ── Tampered fixtures and catalog (temporary copies) ────────────

function tampered(editFixture, editCatalog, { rehash = true } = {}) {
  const root = fs.mkdtempSync(path.join(TMP, "root-"));
  const cat = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
  for (const rel of [VECTORS, BUNDLES]) {
    let text = fs.readFileSync(path.join(REPO, rel), "utf8");
    if (editFixture) {
      const doc = JSON.parse(text);
      if (editFixture(rel, doc) !== false) text = JSON.stringify(doc);
    }
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
    if (rehash) cat.fixtures[rel] = sha(text);
  }
  editCatalog?.(cat);
  const file = path.join(root, "catalog.json");
  fs.writeFileSync(file, JSON.stringify(cat));
  return run(["--root", root, "--catalog", file, "--", process.execPath, FAKE, answers(), "ok"]);
}
const caseOf = (d, name) => d.cases.find((c) => c.name === name);
for (const [label, fixture, catalog, opts] of [
  ["a fixture that is not the pinned one", (rel, d) => { if (rel === VECTORS) d.description += " "; }, undefined, { rehash: false }],
  ["a fourth multiple defect", undefined, (c) => { c.multiple_defects["7_bad_status"] = { allowed_codes: ["CONFIG_INVALID_VALUE", "CONFIG_UNKNOWN_FIELD"], reasons: { CONFIG_INVALID_VALUE: "x", CONFIG_UNKNOWN_FIELD: "y" } }; }],
  ["an allowed code that does not apply", undefined, (c) => { c.multiple_defects["7_kid_of_other_alg"] = { allowed_codes: ["CONFIG_TRUST_KID_NOT_DERIVED", "CONFIG_TRUST_MALFORMED_KEY"], reasons: { CONFIG_TRUST_KID_NOT_DERIVED: "x", CONFIG_TRUST_MALFORMED_KEY: "y" } }; }],
  ["a multiple defect without the pinned code", (rel, d) => { if (rel === VECTORS) d.config_cases.find((c) => c.name === "7_unknown_alg").expected_code = "CONFIG_TRUST_DUPLICATE"; }],
  ["composed codes that are not the union", undefined, (c) => { c.composed[2].expected.result.codes = ["REVOCATION_REVOKED"]; }],
  ["a composed expectation that contradicts the text", undefined, (c) => { c.composed[2].expected.result.admitted = true; }],
  ["a composed refusal of a call the text allows", undefined, (c) => { c.composed[0].inputs.trust = "principal"; }],
  // Composed expectations of the wrong type, or with other inputs: refused when the catalog loads.
  ["a composed recorded_decision that is a number", undefined, (c) => { c.composed[2].expected.result.recorded_decision = 17; }],
  ["a composed verified that is a number", undefined, (c) => { c.composed[2].expected.result.verified = 1; }],
  ["a composed trust set that is not the approved one", undefined, (c) => { c.composed[2].inputs.trust = "principal"; }],
  ["a composed case renamed", undefined, (c) => { c.composed[3].name = "another_order_case"; c.suites[2].expected_cases[3] = "external.admission.composed.another_order_case"; }],
  ["a composed case removed", undefined, (c) => { c.composed.pop(); c.suites[2].expected_cases.pop(); }],
  ["a no-profile policy that differs from the defaults", undefined, (c) => { c.no_profile_policy.allow_v1_bundles = false; }],
  ["a no-profile policy with verifier_id", undefined, (c) => { c.no_profile_policy.verifier_id = "verifier:acme-api"; }],
  ["a fixture expectation that contradicts the text", (rel, d) => { if (rel === VECTORS) caseOf(d, "1_empty_trust_set").expected.admitted = true; }],
  ["a fixture expectation that ignores a stop", (rel, d) => { if (rel === VECTORS) caseOf(d, "11_v1_bundle").expected.codes = ["PROFILE_V2_REQUIRED", "VERIFICATION_FAILED"]; }],
  ["two identical requests with different expectations", (rel, d) => { if (rel === VECTORS) caseOf(d, "10_session_300_s_exactly").expected.recorded_decision = "escalate"; }],
  ["accepted maxima that §4.1 does not give", (rel, d) => { if (rel === VECTORS) d.accepted_profiles.find((a) => a.name === "profile_tightened").expected_max_session_duration_seconds = 60; }],
  ["revocation missing under a profile", (rel, d) => { if (rel === VECTORS) delete caseOf(d, "13_unavailable").revocation; }],
  ["revocation given without a profile", (rel, d) => { if (rel === VECTORS) caseOf(d, "B_general_verifier_unchanged").revocation = null; }],
  ["a fixture case removed (the catalog pins it)", (rel, d) => { if (rel === VECTORS) d.cases.pop(); }],
  ["a pinned id removed from the catalog", undefined, (c) => { c.suites[0].expected_cases.pop(); }],
  ["a duplicate pinned id", undefined, (c) => { c.suites[1].expected_cases.push(c.suites[1].expected_cases[0]); }],
  ["suites out of order", undefined, (c) => { c.suites.reverse(); }],
  ["an unknown catalog field", undefined, (c) => { c.extra = 1; }],
]) {
  test(`catalog and fixtures: ${label} is an infrastructure error`, () => {
    const r = tampered(fixture, catalog, opts);
    assert.equal(r.code, 3, r.stderr);
    assert.equal(r.report.status, "error");
    assert.equal(r.report.error.kind, "catalog");
  });
}
