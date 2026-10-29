// Self-tests of the opt-in evidence catalog (contract dcp-ai-conformance-external/2): the five wrappers, a pinned
// verification time per wrapper, the WASM clock shim, malformed /2 requests, one parameterized fake implementation
// (written to a temporary directory; it starts from the TypeScript wrapper's real answers and alters them), and
// tampered fixtures on temporary copies. No source file in the checkout is written.
//
//   DCP_EXTERNAL_PYTHON=/path/to/python DCP_EXTERNAL_REQUIRE_PYTHON=1 DCP_EXTERNAL_REQUIRE_NATIVE=1 \
//     node --test tools/conformance/external-evidence.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";
import { ARTIFACTS } from "./wrappers/build.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const CLI = path.join(REPO, "tools", "conformance-external.js");
const TS_SDK = path.join(REPO, "sdks", "typescript", "dist", "index.js");
const TS = [process.execPath, path.join(HERE, "wrappers", "ts-sdk.mjs"), "--sdk", TS_SDK];
const PYTHON = process.env.DCP_EXTERNAL_PYTHON;
const REQUIRE_PY = process.env.DCP_EXTERNAL_REQUIRE_PYTHON === "1";
const REQUIRE_NATIVE = process.env.DCP_EXTERNAL_REQUIRE_NATIVE === "1";
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-evidence-"));
process.on("exit", () => fs.rmSync(TMP, { recursive: true, force: true }));

const WRAPPERS = {
  ts: { argv: TS, ready: () => fs.existsSync(TS_SDK), why: "sdks/typescript/dist is not built", required: true },
  python: { argv: PYTHON ? [PYTHON, "-I", path.join(HERE, "wrappers", "python_sdk.py")] : null, ready: () => Boolean(PYTHON), why: "DCP_EXTERNAL_PYTHON is not set", required: REQUIRE_PY },
  go: { argv: [ARTIFACTS.go], ready: () => fs.existsSync(ARTIFACTS.go), why: "the Go wrapper is not built", required: REQUIRE_NATIVE },
  rust: { argv: [ARTIFACTS.rust], ready: () => fs.existsSync(ARTIFACTS.rust), why: "the Rust wrapper is not built", required: REQUIRE_NATIVE },
  wasm: { argv: [process.execPath, path.join(HERE, "wrappers", "wasm.mjs")], ready: () => fs.existsSync(path.join(ARTIFACTS.wasm, "dcp_ai_bg.wasm")), why: "the WASM build is missing", required: REQUIRE_NATIVE },
};
function available(t, w) {
  if (w.ready()) return true;
  if (w.required) assert.fail(`${w.why} (required)`);
  t.skip(`${w.why}: NOT run`);
  return false;
}

let n = 0;
function run(args, env = {}) {
  const report = path.join(TMP, `report-${++n}.json`);
  const r = spawnSync(process.execPath, [CLI, "--report", report, ...args], { encoding: "utf8", env: { ...process.env, ...env }, timeout: 600000 });
  return { code: r.status, report: JSON.parse(fs.readFileSync(report, "utf8")), stderr: r.stderr };
}
function call(argv, request) {
  const r = spawnSync(argv[0], argv.slice(1), { input: typeof request === "string" ? request : JSON.stringify(request), timeout: 120000 });
  let json = null;
  try { json = JSON.parse(r.stdout.toString("utf8")); } catch { /* checked by the caller */ }
  return { code: r.status, json };
}
const cases = (report) => report.suites.flatMap((s) => s.cases);
const byId = (report) => new Map(cases(report).map((c) => [c.id, c]));
const B = JSON.parse(fs.readFileSync(path.join(REPO, "tests/interop/v2/bundle_vectors.json"), "utf8"));
const V2 = (cases) => ({ contract: "dcp-ai-conformance-external/2", run_id: "r", nonce: "n", cases });
const verifyAt = (time) => ({ id: "c", op: "verify_signed_bundle_v2", bundle_b64: Buffer.from(JSON.stringify(B.signed_bundle)).toString("base64"), policy: B.default_verifier_policy, verification_time: time });

// ── The five wrappers ───────────────────────────────────────────

for (const [name, w] of Object.entries(WRAPPERS)) {
  test(`${name}: 241/241 evidence cases`, (t) => {
    if (!available(t, w)) return;
    const r = run(["--catalog", "evidence", "--", ...w.argv]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.report.totals, { cases: 241, executed: 241, pass: 241, fail: 0, error: 0 });
    assert.equal(r.report.kit.contract, "dcp-ai-conformance-external/2");
  });

  test(`${name}: verification_time is pinned (2020 rejects, 2026 accepts, 2100 rejects)`, (t) => {
    if (!available(t, w)) return;
    const verdicts = ["2020-01-01T00:00:00Z", "2026-10-22T00:00:00Z", "2100-01-01T00:00:00Z"].map((time) => call(w.argv, V2([verifyAt(time)])).json.results[0].verified);
    assert.deepEqual(verdicts, [false, true, false]);
  });

  test(`${name}: malformed /2 requests exit 2`, (t) => {
    if (!available(t, w)) return;
    const leaf = { sha256: "a".repeat(64), sha3_256: "b".repeat(64) };
    for (const [label, c] of [
      ["empty leaves", { id: "c", op: "dual_merkle_root", leaves: [] }],
      ["an uppercase leaf", { id: "c", op: "dual_merkle_root", leaves: [{ ...leaf, sha256: "A".repeat(64) }] }],
      ["a short leaf", { id: "c", op: "dual_merkle_root", leaves: [{ ...leaf, sha3_256: "b".repeat(62) }] }],
      ["leaves as an object", { id: "c", op: "dual_merkle_root", leaves: leaf }],
      ["a leaf digest as an array of one hex string", { id: "c", op: "dual_merkle_root", leaves: [{ ...leaf, sha256: ["a".repeat(64)] }] }],
      ["a time without a zone", verifyAt("2026-10-22T00:00:00")],
      ["a date only", verifyAt("2026-10-22")],
      ["a time as a number", verifyAt(1761091200000)],
      ["a time as an array of one string", verifyAt(["2026-10-22T00:00:00Z"])],
      ["policy as an array", { ...verifyAt("2026-10-22T00:00:00Z"), policy: [] }],
      ["an unknown field", { ...verifyAt("2026-10-22T00:00:00Z"), extra: 1 }],
    ]) {
      const r = call(w.argv, V2([c]));
      assert.equal(r.code, 2, `${label}: exit ${r.code}`);
    }
  });
}

test("wasm: the Date.now shim is restored, also after the export throws", (t) => {
  if (!available(t, WRAPPERS.wasm)) return;
  const pkg = path.join(TMP, "wasm-clock-pkg");
  fs.mkdirSync(pkg);
  fs.copyFileSync(path.join(ARTIFACTS.wasm, "dcp_ai_bg.wasm"), path.join(pkg, "dcp_ai_bg.wasm"));
  fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "clock-probe", version: "0" }));
  fs.writeFileSync(path.join(pkg, "dcp_ai.js"), `import * as real from ${JSON.stringify(pathToFileURL(path.join(ARTIFACTS.wasm, "dcp_ai.js")).href)};
export default real.default;
export function wasm_verify_signed_bundle_v2() { throw new Error("thrown inside the call at " + Date.now()); }
export function wasm_dual_merkle_root() { return JSON.stringify({ sha256: String(Date.now()), sha3_256: "x" }); }
`);
  const before = Date.now();
  const r = call([...WRAPPERS.wasm.argv, "--pkg", pkg], V2([verifyAt("2020-01-01T00:00:00Z"), { id: "m", op: "dual_merkle_root", leaves: [{ sha256: "a".repeat(64), sha3_256: "b".repeat(64) }] }]));
  assert.equal(r.code, 0);
  assert.match(r.json.results[0].message, /thrown inside the call at 1577836800000/);
  assert.ok(Number(r.json.results[1].sha256) >= before, "Date.now is the host clock again after the throwing call");
});

// ── A fake implementation: the TS wrapper's real answers, altered by mode ──

const FAKE = path.join(TMP, "fake.mjs");
fs.writeFileSync(FAKE, `
import fs from "fs";
import crypto from "crypto";
import { spawnSync } from "child_process";
const mode = process.argv[2];
const input = fs.readFileSync(0);
const req = JSON.parse(input);
const real = spawnSync(process.execPath, ${JSON.stringify(TS.slice(1))}, { input, maxBuffer: 1 << 26 });
const resp = JSON.parse(real.stdout);
const B = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(REPO, "tests/interop/v2/bundle_vectors.json"))}, "utf8"));
const baseB64 = Buffer.from(JSON.stringify(B.signed_bundle)).toString("base64");
const H = (alg, buf) => crypto.createHash(alg).update(buf).digest();
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
resp.results = resp.results.map((r) => {
  const c = req.cases.find((x) => x.id === r.id);
  if (c.op === "verify_signed_bundle_v2") {
    if (mode === "all-verified") return { id: r.id, status: "ok", verified: true, errors: [] };
    if (mode === "none-verified") return { id: r.id, status: "ok", verified: false, errors: ["rejected"] };
    if (mode === "contradictory" && r.verified) return { ...r, errors: ["internal failure"] };
    if (mode === "error-text-ignored" && !r.verified) return { ...r, errors: ["rejected"] };
    if (mode === "base-fails" && c.bundle_b64 === baseB64) return { id: r.id, status: "ok", verified: false, errors: ["rejected"] };
  }
  const negative = (c.op === "composite_verify" && r.valid === false) || (c.op === "verify_signed_bundle_v2" && r.verified === false);
  if (negative && mode === "error-on-negatives") return { id: r.id, status: "error", message: "unexpected failure" };
  if (negative && mode === "unsupported-on-negatives") return { id: r.id, status: "unsupported" };
  if (c.op === "dual_merkle_root" && mode === "merkle-array-root") return { ...r, sha256: [r.sha256] };
  if (c.op === "dual_merkle_root" && (mode === "merkle-sorted" || mode === "merkle-promote-odd")) {
    const s = mode === "merkle-sorted", p = mode === "merkle-promote-odd";
    return { id: r.id, status: "ok", sha256: root(c.leaves.map((l) => l.sha256), "sha256", s, p), sha3_256: root(c.leaves.map((l) => l.sha3_256), "sha3-256", s, p) };
  }
  if (c.op === "composite_verify") {
    if (mode === "composite-all-valid") return { id: r.id, status: "ok", valid: true, classical_valid: true, pq_valid: true };
    const stripped = c.composite_sig.binding === "pq_over_classical" && c.composite_sig.pq === null;
    if (mode === "missing-pq-everywhere" || (mode === "missing-pq-on-negatives" && r.valid === false) || (mode === "missing-pq-stripped-only" && stripped)) {
      return { id: r.id, status: "rejected", code: "missing_pq_signature" };
    }
  }
  return r;
});
process.stdout.write(JSON.stringify(resp));
`);
const fake = (mode) => run(["--catalog", "evidence", "--", process.execPath, FAKE, mode]);
const statuses = (report, prefix) => cases(report).filter((c) => c.id.startsWith(prefix)).map((c) => c.status);

test("fake: unaltered answers pass 241/241 (the fake is sound)", () => {
  assert.equal(fake("unaltered").report.totals.pass, 241);
});

test("fake: verifying everything fails every negative", () => {
  const r = fake("all-verified");
  assert.equal(r.code, 1);
  const neg = cases(r.report).filter((c) => c.op === "verify_signed_bundle_v2" && c.expect.verified === false);
  assert.ok(neg.length > 100 && neg.every((c) => c.status === "fail"));
});

test("fake: rejecting everything fails the positives and gates every controlled negative", () => {
  const r = fake("none-verified");
  assert.notEqual(r.code, 0);
  const ids = byId(r.report);
  assert.equal(ids.get("external.v2.bundle_vectors.signed_bundle").status, "fail");
  assert.ok(cases(r.report).filter((c) => c.controls && c.op === "verify_signed_bundle_v2").every((c) => c.kind === "control_failed"));
});

test("fake: verified=true with errors is a contradictory result, never a pass", () => {
  const r = fake("contradictory");
  assert.equal(r.code, 3);
  assert.ok(cases(r.report).filter((c) => c.op === "verify_signed_bundle_v2" && c.expect.verified).every((c) => c.kind === "contradictory_result"));
});

test("fake: a rejection with the wrong error text fails the committed error_contains", () => {
  const r = fake("error-text-ignored");
  assert.equal(r.code, 1);
  assert.ok(cases(r.report).filter((c) => c.expect?.error_contains).every((c) => c.status === "fail"));
});

test("fake: a failing base gates the 38 mutations and the 79 separately built rejected bundles", () => {
  const r = fake("base-fails");
  assert.notEqual(r.code, 0);
  for (const prefix of ["external.v2.bundle_vectors.must_reject.", "external.v2.bundle_vectors.must_reject_bundles."]) {
    const s = statuses(r.report, prefix);
    assert.ok(s.length > 30 && s.every((x) => x === "error"), prefix);
  }
});

test("fake: an order-blind Merkle and the old odd-node promotion are caught", () => {
  const M = JSON.parse(fs.readFileSync(path.join(REPO, "tests/conformance/v2/merkle_vectors.json"), "utf8")).cases;
  const inOrder = (c) => ["sha256", "sha3_256"].every((f) => c.leaves.every((l, i) => i === 0 || c.leaves[i - 1][f] <= l[f]));
  const sorted = byId(fake("merkle-sorted").report);
  const promoted = byId(fake("merkle-promote-odd").report);
  for (const c of M) {
    const id = `external.merkle.dual_root.${c.name}`;
    assert.equal(sorted.get(id).status, inOrder(c) ? "pass" : "fail", `sorted: ${c.name}`);
    assert.equal(promoted.get(id).status, c.leaves.length === 1 ? "pass" : "fail", `hex text, promoted odd node: ${c.name}`);
  }
  assert.ok(M.filter((c) => !inOrder(c)).length >= 3, "the corpus has leaves out of order");
});

test("fake: a root that is not a string is a malformed result, never a match", () => {
  const r = fake("merkle-array-root");
  assert.equal(r.code, 3);
  assert.ok(cases(r.report).filter((c) => c.op === "dual_merkle_root").every((c) => c.status === "error" && c.kind === "malformed_result"));
});

test("fake: composites that are always valid fail every negative", () => {
  const r = fake("composite-all-valid");
  const neg = cases(r.report).filter((c) => c.op === "composite_verify" && c.expect.valid === false);
  assert.ok(neg.length >= 14 && neg.every((c) => c.status === "fail"));
});

// DR2: rejected/missing_pq_signature is admissible only for the stripped-PQ attack, and only while its positive control passes.
const STRIPPED = "external.signature.composite.attack.stripping_pq_removal";
const composites = (r) => cases(r.report).filter((c) => c.op === "composite_verify");

test("fake: missing_pq_signature on the stripped-PQ attack alone is the documented rejection (241/241)", () => {
  const r = fake("missing-pq-stripped-only");
  assert.equal(r.code, 0);
  assert.equal(r.report.totals.pass, 241);
  assert.equal(byId(r.report).get(STRIPPED).expect.missing_pq_rejection_allowed, true);
});

test("fake: missing_pq_signature on every composite passes nothing; the stripped case is gated by its failed control", () => {
  const r = fake("missing-pq-everywhere");
  assert.equal(r.code, 3, "a control_failed is an error, which outranks the discrepancies");
  assert.deepEqual(composites(r).filter((c) => c.status === "pass").map((c) => c.id), []);
  assert.ok(composites(r).filter((c) => c.expect.valid === true).every((c) => c.status === "fail" && c.kind === "discrepancy"));
  assert.equal(byId(r.report).get(STRIPPED).kind, "control_failed");
});

test("fake: missing_pq_signature on any other negative is a discrepancy", () => {
  const r = fake("missing-pq-on-negatives");
  assert.equal(r.code, 1);
  const negatives = composites(r).filter((c) => c.expect.valid === false);
  assert.deepEqual(negatives.filter((c) => c.status === "pass").map((c) => c.id), [STRIPPED]);
  assert.ok(negatives.length >= 14 && negatives.filter((c) => c.id !== STRIPPED).every((c) => c.status === "fail" && c.kind === "discrepancy"));
});

test("fake: an unexpected error or unsupported on a negative is never a pass", () => {
  for (const [mode, kind] of [["error-on-negatives", "implementation"], ["unsupported-on-negatives", "unsupported"]]) {
    const r = fake(mode);
    assert.equal(r.code, 3, mode);
    const negatives = cases(r.report).filter((c) => c.expect?.valid === false || c.expect?.verified === false);
    assert.ok(negatives.length > 100 && negatives.every((c) => c.status === "error" && c.kind === kind), mode);
  }
});

test("report: each case carries its source and input_sha256", () => {
  const r = fake("unaltered");
  assert.ok(cases(r.report).every((c) => typeof c.source === "string" && c.source.includes("#") && /^[0-9a-f]{64}$/.test(c.input_sha256)));
  assert.equal(byId(r.report).get("external.v2.bundle_vectors.must_reject_bundles." + B.must_reject_bundles[0].name).controls.length, 10);
});

test("a /1-only implementation never passes the evidence catalog", () => {
  const r = run(["--catalog", "evidence", "--", process.execPath, "-e", "const r=JSON.parse(require('fs').readFileSync(0));if(r.contract!=='dcp-ai-conformance-external/1')process.exit(2)"]);
  assert.equal(r.code, 3);
  assert.equal(r.report.status, "error");
});

// ── Tampered fixtures and catalog (temporary copies) ────────────

const FIX = ["tests/conformance/v2/merkle_vectors.json", "tests/interop/v2/interop_vectors.json", "tests/interop/v2/bundle_vectors.json", "tests/interop/v2/secondary_sha3_vectors.json"];
function tampered(editFixture, editCatalog) {
  const root = fs.mkdtempSync(path.join(TMP, "root-"));
  for (const rel of FIX) {
    const doc = JSON.parse(fs.readFileSync(path.join(REPO, rel), "utf8"));
    editFixture?.(rel, doc);
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), JSON.stringify(doc));
  }
  const cat = JSON.parse(fs.readFileSync(path.join(HERE, "external-evidence-catalog.json"), "utf8"));
  editCatalog?.(cat);
  const catFile = path.join(root, "catalog.json");
  fs.writeFileSync(catFile, JSON.stringify(cat));
  return run(["--root", root, "--catalog", catFile, "--", ...TS]);
}
for (const [label, fixture, catalog] of [
  ["an empty error_contains", (rel, d) => { if (rel.endsWith("bundle_vectors.json")) d.must_reject_bundles[0].error_contains = ""; }],
  ["a missing error_contains", (rel, d) => { if (rel.endsWith("bundle_vectors.json")) delete d.must_reject[0].error_contains; }],
  ["verified_by_mode as a string", (rel, d) => { if (rel.endsWith("bundle_vectors.json")) d.classical_only_routine_bundle.verified_by_mode.classical_only = "true"; }],
  ["a Merkle root given as an array", (rel, d) => { if (rel.endsWith("merkle_vectors.json")) d.cases[0].expected.sha256 = [d.cases[0].expected.sha256]; }],
  ["a secondary case without its control", (rel, d) => { if (rel.endsWith("secondary_sha3_vectors.json")) delete d.cases.find((c) => c.expect === "reject").control; }],
  ["a vector removed (the catalog pins it)", (rel, d) => { if (rel.endsWith("merkle_vectors.json")) d.cases.pop(); }],
  ["a pinned id removed from the catalog", undefined, (c) => { c.suites[0].expected_cases.pop(); }],
  ["a duplicate pinned id", undefined, (c) => { c.suites[0].expected_cases.push(c.suites[0].expected_cases[0]); }],
  ["another contract", undefined, (c) => { c.contract = "dcp-ai-conformance-external/1"; }],
]) {
  test(`fixtures: ${label} is an infrastructure error`, () => {
    const r = tampered(fixture, catalog);
    assert.equal(r.code, 3, r.stderr);
    assert.equal(r.report.status, "error");
  });
}
