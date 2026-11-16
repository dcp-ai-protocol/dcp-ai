// Tests of the opt-in V2-2 suite: its builder in external-evidence.js and its catalog
// (external-schema-validation-catalog.json, 57 pinned cases of tests/interop/v2/schema_validation/wiring_cases.json)
// through the runner, against controlled implementations only. These test the suite, not any SDK's conformance; CI runs
// the catalog itself through the five SDK wrappers.
//   node --test tools/conformance/external-schema-validation.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { loadAdmissionPlan } from "./external-admission.js";
import { loadEvidencePlan, runEvidence } from "./external-evidence.js";
import { loadPlan, InfraError } from "./external.js";
import { loadSchemaValidationPlan } from "../schema-ir/corpus.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const CATALOG = path.join(HERE, "external-schema-validation-catalog.json");
const WIRING = "tests/interop/v2/schema_validation/wiring_cases.json";
const W = JSON.parse(fs.readFileSync(path.join(ROOT, WIRING), "utf8"));
const plan = () => loadEvidencePlan({ catalogFile: CATALOG });
const ID = (n) => `external.v2.schema_validation.${n}`;
const NEGATIVES = W.cases.filter((c) => !c.expect.verified).map((c) => ID(c.name)).sort();

const created = [];
after(() => { for (const dir of created) fs.rmSync(dir, { recursive: true, force: true }); });
const tmp = (prefix) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); created.push(dir); return dir; };

test("the default catalogs and the other opt-in catalogs are unchanged", () => {
  assert.equal(loadEvidencePlan().suites.reduce((n, s) => n + s.cases.length, 0), 241);
  assert.equal(Object.keys(loadEvidencePlan().fixtures).length, 4);
  assert.equal(loadPlan().suites.reduce((n, s) => n + s.cases.length, 0), 38);
  assert.equal(loadAdmissionPlan().suites.reduce((n, s) => n + s.cases.length, 0), 140);
  for (const [file, n] of [["external-schema-catalog.json", 15], ["external-policy-catalog.json", 74], ["external-structural-catalog.json", 16]]) {
    assert.equal(loadEvidencePlan({ catalogFile: path.join(HERE, file) }).suites[0].cases.length, n, file);
  }
});

test("the kit builds exactly the plan the phase-1 corpus reader builds: 57 pinned cases, 13 positives, the base as control of each negative", () => {
  const kit = plan();
  const phase1 = loadSchemaValidationPlan();
  assert.equal(kit.suites.length, 1);
  assert.deepEqual(kit.suites[0].cases, phase1.suites[0].cases);
  assert.deepEqual(Object.keys(kit.fixtures), [...Object.keys(loadEvidencePlan().fixtures), WIRING]);
  assert.equal(kit.fixtures[WIRING], phase1.fixtures[WIRING]);
  const cases = kit.suites[0].cases;
  assert.equal(cases.length, 57);
  assert.equal(cases.filter((c) => c.expect.verified).length, 13);
  for (const c of cases) {
    assert.deepEqual(Object.keys(c.request).sort(), ["bundle_b64", "policy", "verification_time"]);
    assert.deepEqual(c.request.policy, W.verifier_policy);
    assert.equal(c.request.verification_time, W.verification_time);
    const wire = JSON.stringify({ id: "x", op: c.op, ...c.request });
    assert.ok(!/"expect"|error_contains|wiring_cases|"target"/.test(wire), `${c.id}: the request carries an expectation or the corpus name`);
    assert.deepEqual(c.controls, c.expect.verified ? undefined : [ID("base")], c.id);
    assert.match(c.anchor_source.spec_step, /^V2-(?:[1-9]|1[0-4])$/);
  }
  // A case given as text is sent as exactly those bytes, not re-serialized.
  const text = W.cases.find((c) => c.signed_bundle_text !== undefined);
  assert.equal(Buffer.from(cases.find((c) => c.id === ID(text.name)).request.bundle_b64, "base64").toString("utf8"), text.signed_bundle_text);
});

test("catalog and corpus integrity: a missing, extra or duplicate id, or a malformed case, is refused", () => {
  const cat = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
  const dir = tmp("schema-validation-cat-");
  const load = (mutate) => {
    const c = structuredClone(cat);
    mutate(c);
    const file = path.join(dir, `${crypto.randomUUID()}.json`);
    fs.writeFileSync(file, JSON.stringify(c));
    return () => loadEvidencePlan({ catalogFile: file });
  };
  assert.throws(load((c) => c.suites[0].expected_cases.pop()), (e) => e instanceof InfraError && /extra/.test(e.message));
  assert.throws(load((c) => c.suites[0].expected_cases.push(ID("not_in_the_corpus"))), (e) => e instanceof InfraError && /missing/.test(e.message));
  assert.throws(load((c) => c.suites[0].expected_cases.push(c.suites[0].expected_cases[0])), (e) => e instanceof InfraError && /duplicate/.test(e.message));
  // The corpus side: a root with a duplicate name, a case with both forms, a missing base.
  const root = tmp("schema-validation-root-");
  const withWiring = (mutate) => {
    fs.mkdirSync(path.join(root, "tests/interop/v2/schema_validation"), { recursive: true });
    for (const rel of ["tests/conformance/v2/merkle_vectors.json", "tests/interop/v2/interop_vectors.json", "tests/interop/v2/bundle_vectors.json", "tests/interop/v2/secondary_sha3_vectors.json"]) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.copyFileSync(path.join(ROOT, rel), path.join(root, rel));
    }
    const w = structuredClone(W);
    mutate(w);
    fs.writeFileSync(path.join(root, WIRING), JSON.stringify(w));
    return () => loadEvidencePlan({ root, catalogFile: CATALOG });
  };
  assert.throws(withWiring((w) => w.cases.push(structuredClone(w.cases[1]))), (e) => e instanceof InfraError && /duplicate/.test(e.message));
  assert.throws(withWiring((w) => { w.cases[1].signed_bundle_text = JSON.stringify(w.cases[1].signed_bundle); }), (e) => e instanceof InfraError && /exactly one of/.test(e.message));
  assert.throws(withWiring((w) => { w.cases[0].expect.verified = false; }), (e) => e instanceof InfraError && /base/.test(e.message));
  assert.doesNotThrow(withWiring(() => {}));
});

// Controlled implementations of contract /2, written to a temporary directory and run as real child processes.
const keyOf = (r) => crypto.createHash("sha256").update(r.bundle_b64).digest("hex");
// A lookup of the verdict each request should get, with `flip` names answered the other way: a runner control, not a verifier.
const lookup = (flip = []) => Object.fromEntries(plan().suites[0].cases.map((c) => [keyOf(c.request), flip.includes(c.id) ? !c.expect.verified : c.expect.verified]));
const fake = (results, table = {}) => {
  const file = path.join(tmp("schema-validation-ctl-"), "impl.mjs");
  fs.writeFileSync(file, `import fs from "node:fs";
import crypto from "node:crypto";
const table = ${JSON.stringify(table)};
const key = (c) => crypto.createHash("sha256").update(c.bundle_b64).digest("hex");
const r = JSON.parse(fs.readFileSync(0, "utf8"));
const results = ${results};
process.stdout.write(JSON.stringify({ contract: r.contract, run_id: r.run_id, nonce: r.nonce, implementation: { name: "controlled", version: "0" }, results }));`);
  return [process.execPath, file];
};
const EACH = (verdict) => `r.cases.map((c) => ({ id: c.id, status: "ok", ...(${verdict}) }))`;
const ANSWER = EACH("(() => { const v = table[key(c)]; return { verified: v, errors: v ? [] : ['controlled rejection'] }; })()");
const runWith = (argv) => runEvidence({ plan: plan(), argv, timeoutMs: 120000 });
const byStatus = (report, status) => report.suites[0].cases.filter((c) => c.status === status).map((c) => c.id).sort();

test("runner controls: accept-all fails exactly the 44 negatives, reject-all counts none, the lookup passes", async () => {
  const accept = await runWith(fake(EACH("{ verified: true, errors: [] }")));
  assert.equal(accept.status, "fail");
  assert.deepEqual(byStatus(accept, "fail"), NEGATIVES);
  const reject = await runWith(fake(EACH("{ verified: false, errors: ['controlled rejection'] }")));
  assert.equal(reject.status, "error");
  assert.ok(reject.suites[0].cases.filter((c) => c.expect.verified === false).every((c) => c.kind === "control_failed"));
  const right = await runWith(fake(ANSWER, lookup()));
  assert.equal(right.status, "pass", JSON.stringify(right.suites[0].cases.filter((c) => c.status !== "pass").slice(0, 3)));
});

test("runner controls: a verifier that ignores one constraint fails exactly that case", async () => {
  for (const id of [ID("c4_session_expires_at_null"), ID("c4_session_issued_at_null"), NEGATIVES[0], NEGATIVES.at(-1)]) {
    const r = await runWith(fake(ANSWER, lookup([id])));
    assert.equal(r.status, "fail", id);
    assert.deepEqual(byStatus(r, "fail"), [id], id);
  }
});

test("runner controls: a missing, a duplicate and a malformed result are errors, never a pass", async () => {
  // Wire ids are random per run: the controlled implementation finds the case by the hash of its request.
  const target = JSON.stringify(keyOf(plan().suites[0].cases.find((c) => c.id === NEGATIVES[0]).request));
  const missing = await runWith(fake(`(${ANSWER}).filter((x, i) => key(r.cases[i]) !== ${target})`, lookup()));
  assert.equal(missing.status, "error");
  assert.equal(missing.suites[0].cases.find((c) => c.id === NEGATIVES[0]).kind, "missing");
  const duplicate = await runWith(fake(`[...(${ANSWER}), (${ANSWER}).find((x, i) => key(r.cases[i]) === ${target})]`, lookup()));
  assert.equal(duplicate.status, "error");
  assert.equal(duplicate.suites[0].cases.find((c) => c.id === NEGATIVES[0]).kind, "duplicate");
  const malformed = await runWith(fake(EACH("{ verified: 'no', errors: [] }")));
  assert.equal(malformed.status, "error");
});

test("the CLI runs the catalog by path in both assessments, keeps a failure a failure and replaces an older report", () => {
  const cli = (args, argv) => spawnSync(process.execPath, [path.join(ROOT, "tools/conformance-external.js"), "--catalog", CATALOG, ...args, "--", ...argv], { encoding: "utf8", timeout: 120000 });
  const report = path.join(tmp("schema-validation-report-"), "report.json");
  assert.equal(cli(["--assessment", "verdict", "--report", report], fake(ANSWER, lookup())).status, 0);
  assert.equal(JSON.parse(fs.readFileSync(report, "utf8")).status, "pass");
  const failed = cli(["--assessment", "verdict", "--report", report], fake(EACH("{ verified: true, errors: [] }")));
  assert.equal(failed.status, 1, failed.stderr);
  assert.equal(JSON.parse(fs.readFileSync(report, "utf8")).status, "fail", "the older pass report must be replaced");
  assert.equal(cli([], fake(ANSWER, lookup())).status, 0, "legacy (the default) judges these cases the same: none carries an error_contains");
});
