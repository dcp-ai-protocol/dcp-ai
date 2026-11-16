// Self-tests for the conformance kit runner (node --test tools/conformance/conformance.test.mjs).
// Fixtures are mutated only in temporary copies; the checkout's keys and fixtures must stay untouched.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { spawnSync } from "child_process";
import { loadCatalog, runConformance, REPO_ROOT } from "./runner.js";
import { main } from "../conformance.js";

const CLI = path.join(REPO_ROOT, "tools", "conformance.js");
const catalog = loadCatalog();
const FAST = ["v1.schema", "v1.integrity", "v2.canonicalization", "v2.hashes", "v2.schema", "ext.dcp05_09.schema"];

function tempRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-conformance-"));
  for (const rel of ["schemas", "tests/conformance", "tests/interop/v2/interop_vectors.json", "tests/interop/v2/admission_vectors.json", "keys/public_key.txt"]) {
    fs.cpSync(path.join(REPO_ROOT, rel), path.join(dir, rel), { recursive: true });
  }
  return dir;
}

const editJson = (root, rel, fn) => {
  const file = path.join(root, rel);
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  fn(data);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
};
const caseOf = (report, id) => report.suites.flatMap((s) => s.cases).find((c) => c.id === id);
const cli = (args, cwd = os.tmpdir()) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });

// keys/ may hold a user's own secret key: it is compared by metadata only and never read.
function snapshot() {
  const out = {};
  const walk = (dir, readContent) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, readContent);
      else {
        const st = fs.statSync(p);
        out[path.relative(REPO_ROOT, p)] = readContent
          ? crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex")
          : `${st.size}:${st.mtimeMs}:${st.ino}`;
      }
    }
  };
  walk(path.join(REPO_ROOT, "keys"), false);
  for (const d of ["tests/conformance", "tests/interop/v2"]) walk(path.join(REPO_ROOT, d), true);
  return out;
}

test("full run from another cwd passes every pinned case and writes nothing in the checkout", () => {
  const before = snapshot();
  const report = path.join(os.tmpdir(), `dcp-conf-${process.pid}-full.json`);
  const r = cli(["--report", report]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /DCP-AI CONFORMANCE PASS \(V1 \+ V2\)/);
  const rep = JSON.parse(fs.readFileSync(report, "utf8"));
  const pinned = catalog.suites.reduce((n, s) => n + s.expected_cases.length, 0);
  assert.equal(rep.status, "pass");
  assert.deepEqual(rep.totals, { cases: pinned, executed: pinned, pass: pinned, fail: 0, error: 0 });
  assert.deepEqual(rep.selection, catalog.suites.map((s) => s.id));
  assert.equal(rep.kit.version, catalog.kit_version);
  assert.equal(new Set(rep.suites.flatMap((s) => s.cases.map((c) => c.id))).size, pinned);
  assert.ok(rep.inventory.every((v) => v.id && v.where));
  assert.deepEqual(snapshot(), before);
});

test("a missing or malformed catalog is an infrastructure error with a fresh report", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-conf-catalog-"));
  const bad = path.join(dir, "catalog.json");
  const report = path.join(dir, "report.json");
  for (const write of [() => fs.rmSync(bad, { force: true }), () => fs.writeFileSync(bad, "{ not json"),
    () => fs.writeFileSync(bad, JSON.stringify({ kit_version: "x", suites: [{ id: "a", expected_cases: [] }], inventory: [] }))]) {
    write();
    fs.writeFileSync(report, JSON.stringify({ status: "pass" }));
    assert.equal(await main(["--report", report], { catalogPath: bad }), 3);
    const rep = JSON.parse(fs.readFileSync(report, "utf8"));
    assert.equal(rep.status, "error");
    assert.ok(rep.catalog_error);
  }
});

test("selection runs only the selected suites", async () => {
  const rep = await runConformance({ select: ["v2.hashes", "v1.schema"] });
  assert.equal(rep.status, "pass");
  assert.deepEqual(rep.suites.map((s) => s.id), ["v2.hashes", "v1.schema"]);
});

test("unknown, duplicate and empty suite ids are usage errors", () => {
  for (const args of [["--suite", "nope"], ["--suite", "v1.schema", "--suite", "v1.schema"], ["--suite", ""], ["--suite"], ["--bogus"], ["--list", "--suite", "nope"]]) {
    const r = cli(args);
    assert.equal(r.status, 2, `${args.join(" ")}: ${r.stdout}${r.stderr}`);
  }
  assert.equal(cli(["--list"]).status, 0);
});

test("a usage error replaces an older successful report", () => {
  const report = path.join(os.tmpdir(), `dcp-conf-${process.pid}-usage.json`);
  fs.writeFileSync(report, JSON.stringify({ status: "pass", totals: { pass: 185 } }));
  assert.equal(cli(["--report", report, "--bogus"]).status, 2);
  const rep = JSON.parse(fs.readFileSync(report, "utf8"));
  assert.equal(rep.status, "error");
  assert.match(rep.usage_error, /unknown argument/);
});

test("an option cannot be consumed as a missing path value or create a report named after a flag", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-conf-args-"));
  try {
    for (const args of [["--report", "--list"], ["--root", "--list"], ["--root", ""], ["--report", ""]]) {
      const r = cli(args, dir);
      assert.equal(r.status, 2, `${JSON.stringify(args)}: ${r.stdout}${r.stderr}`);
      assert.deepEqual(fs.readdirSync(dir), []);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a failing run replaces an older successful report with a fresh one", () => {
  const root = tempRoot();
  editJson(root, "tests/conformance/v2/golden_vectors.json", (g) => { g.hash_vectors.sha256_hello.expected_hex = "00".repeat(32); });
  const report = path.join(root, "report.json");
  fs.writeFileSync(report, JSON.stringify({ status: "pass", run: { id: "old" } }));
  const r = cli(["--root", root, "--suite", "v2.hashes", "--report", report]);
  assert.equal(r.status, 1);
  const rep = JSON.parse(fs.readFileSync(report, "utf8"));
  assert.equal(rep.status, "fail");
  assert.notEqual(rep.run.id, "old");
  assert.equal(caseOf(rep, "v2.hashes.sha256_hello").kind, "discrepancy");
});

test("real negatives: a tampered signature, golden hash or chain link is a discrepancy", async () => {
  const root = tempRoot();
  editJson(root, "tests/conformance/examples/citizenship_bundle.signed.json", (s) => { s.signature.sig_b64 = Buffer.alloc(64, 1).toString("base64"); });
  editJson(root, "tests/conformance/v2/golden_vectors.json", (g) => {
    g.v1_bundle_verification.prev_hash_chain[2] = "ab".repeat(32);
    g.dual_hash_vectors.dual_merkle_roots.sha3_256 = "cd".repeat(32);
  });
  const rep = await runConformance({ root, select: ["v1.integrity", "v2.hashes"] });
  assert.equal(rep.status, "fail");
  for (const id of ["v1.integrity.signature", "v1.integrity.prev_hash_chain_golden", "v2.hashes.dual.merkle_roots"]) {
    assert.equal(caseOf(rep, id).status, "fail", id);
  }
  assert.equal(caseOf(rep, "v1.integrity.bundle_hash").status, "pass");
});

test("key metadata must agree", async () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, "keys/public_key.txt"), Buffer.alloc(32, 7).toString("base64") + "\n");
  const rep = await runConformance({ root, select: ["v1.integrity"] });
  assert.equal(caseOf(rep, "v1.integrity.key_metadata_consistent").status, "fail");
});

test("missing and malformed required fixtures are infrastructure errors, never skips", async () => {
  for (const [rel, mutate] of [
    ["tests/conformance/v2/golden_vectors.json", (f) => fs.rmSync(f)],
    ["tests/conformance/examples/rpr_v2.json", (f) => fs.rmSync(f)],
    ["tests/interop/v2/interop_vectors.json", (f) => fs.writeFileSync(f, "{ not json")],
    ["keys/public_key.txt", (f) => fs.rmSync(f)],
  ]) {
    const root = tempRoot();
    mutate(path.join(root, rel));
    const rep = await runConformance({ root, select: FAST });
    assert.equal(rep.status, "error", rel);
    assert.ok(rep.suites.flatMap((s) => s.cases).some((c) => c.kind === "fixture" && c.message.includes(rel)), rel);
  }
  const root = tempRoot();
  fs.rmSync(path.join(root, "tests/conformance/v2/golden_vectors.json"));
  const r = cli(["--root", root, "--suite", "v2.hashes"]);
  assert.equal(r.status, 3);
});

test("removing one vector from a collection is reported, not a silent loss of coverage", async () => {
  const root = tempRoot();
  editJson(root, "tests/conformance/v2/golden_vectors.json", (g) => { delete g.canonicalization.unicode; });
  editJson(root, "tests/interop/v2/admission_vectors.json", (a) => { a.cases.pop(); a.config_cases.shift(); });
  const rep = await runConformance({ root, select: ["v2.canonicalization", "admission.strict_v1"] });
  assert.equal(rep.status, "error");
  const missing = rep.suites.flatMap((s) => s.cases).filter((c) => c.kind === "catalog").map((c) => c.id);
  assert.equal(missing.length, 3);
  assert.ok(missing.includes("v2.canonicalization.golden.unicode"));
});

test("an extra vector not pinned in the catalog is reported", async () => {
  const root = tempRoot();
  editJson(root, "tests/conformance/v2/golden_vectors.json", (g) => { g.canonicalization.extra = { input: { a: 1 }, expected_canonical: "{\"a\":1}" }; });
  const rep = await runConformance({ root, select: ["v2.canonicalization"] });
  assert.equal(rep.status, "error");
  assert.equal(caseOf(rep, "v2.canonicalization.golden.extra").kind, "catalog");
});

test("malformed expectations and unknown config kinds are infrastructure errors", async () => {
  const root = tempRoot();
  editJson(root, "tests/interop/v2/admission_vectors.json", (a) => {
    delete a.cases[0].expected.admitted;
    a.config_cases[0].kind = "policy";
  });
  editJson(root, "tests/conformance/v2/golden_vectors.json", (g) => { delete g.hash_vectors.sha256_empty.expected_hex; });
  const rep = await runConformance({ root, select: ["admission.strict_v1", "v2.hashes"] });
  const a = JSON.parse(fs.readFileSync(path.join(root, "tests/interop/v2/admission_vectors.json"), "utf8"));
  assert.equal(caseOf(rep, `admission.vector.${a.cases[0].name}`).kind, "expectation");
  assert.equal(caseOf(rep, `admission.config.${a.config_cases[0].name}`).kind, "expectation");
  assert.equal(caseOf(rep, "v2.hashes.sha256_empty").kind, "expectation");
  assert.equal(rep.status, "error");
});

test("a suite that throws fails even after producing every pinned case", async () => {
  const cat = { kit_version: "t", sha256: "", inventory: [], suites: [{ id: "probe", title: "probe", expected_cases: ["probe.ok"] }] };
  const late = { probe: (ctx) => { ctx.check("probe.ok", () => true); throw new Error("late"); } };
  const rep = await runConformance({ catalog: cat, suites: late });
  assert.equal(rep.status, "error");
  assert.equal(rep.totals.error, 1);
  assert.equal(caseOf(rep, "probe#suite").kind, "exception");
  const early = { probe: () => { throw new Error("early"); } };
  const rep2 = await runConformance({ catalog: cat, suites: early });
  assert.equal(rep2.status, "error");
  assert.equal(rep2.totals.executed, 0);
  assert.equal(rep2.no_checks, "no check was executed");
});

test("a case that throws, a duplicate case id and a missing implementation are errors", async () => {
  const cat = { kit_version: "t", sha256: "", inventory: [], suites: [
    { id: "probe", title: "probe", expected_cases: ["probe.a", "probe.b"] },
    { id: "absent", title: "absent", expected_cases: ["absent.a"] },
  ] };
  const impl = { probe: (ctx) => { ctx.check("probe.a", () => { throw new TypeError("boom"); }); ctx.check("probe.b", () => true); ctx.check("probe.b", () => true); } };
  const rep = await runConformance({ catalog: cat, suites: impl });
  assert.equal(caseOf(rep, "probe.a").kind, "exception");
  assert.equal(rep.suites[0].cases.filter((c) => c.id === "probe.b" && c.status === "error").length, 1);
  assert.equal(caseOf(rep, "absent.a").kind, "catalog");
  assert.equal(rep.status, "error");
});
