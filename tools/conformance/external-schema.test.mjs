// Tests of the V2-2 schema-closure diagnostic: the corpus (tests/interop/v2/schema_closure_vectors.json), its layers
// (tools/conformance/schema-boundary.js) and the opt-in /2 catalog (external-schema-catalog.json) through the runner,
// against controlled implementations only. These test the diagnostic; they say nothing of any SDK's conformance.
//   node --test tools/conformance/external-schema.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { loadAdmissionPlan } from "./external-admission.js";
import { loadEvidencePlan, runEvidence } from "./external-evidence.js";
import { loadPlan } from "./external.js";
import { ROOT, composition, integrity, loadCorpus, resolveSchemaPointer, schema } from "./schema-boundary.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CATALOG = path.join(HERE, "external-schema-catalog.json");
const corpus = loadCorpus();
const cases = corpus.cases;
const at = (doc, p) => p.reduce((n, k) => n?.[k], doc);

test("the default catalogs and their fixtures are unchanged", () => {
  const evidence = loadEvidencePlan();
  assert.equal(evidence.suites.reduce((n, s) => n + s.cases.length, 0), 241);
  assert.deepEqual(Object.keys(evidence.fixtures).sort(), [
    "tests/conformance/v2/merkle_vectors.json", "tests/interop/v2/bundle_vectors.json", "tests/interop/v2/interop_vectors.json", "tests/interop/v2/secondary_sha3_vectors.json",
  ]);
  assert.equal(loadPlan().suites.reduce((n, s) => n + s.cases.length, 0), 38);
  assert.equal(loadAdmissionPlan().suites.reduce((n, s) => n + s.cases.length, 0), 140);
});

test("every case names a real schema location whose rule decides it", () => {
  for (const c of cases) {
    const { pointer, rule } = c.expect.schema;
    const node = resolveSchemaPointer(pointer);
    if (rule.startsWith("closed")) assert.equal(node, false, `${c.name}: ${pointer} is not additionalProperties false`);
    else if (rule === "enumeration") {
      assert.ok(Array.isArray(node) && !node.includes(c.expect.schema.value), `${c.name}: ${pointer} is not an enumeration without the value`);
      assert.equal(at(c.signed_bundle, c.path), c.expect.schema.value);
    } else {
      assert.match(rule, /^open/);
      assert.ok(node && typeof node === "object" && node.additionalProperties === undefined && node.type === "object", `${c.name}: ${pointer} is not an open object`);
    }
  }
  const rules = new Set(cases.map((c) => c.expect.schema.rule.split(":")[0]));
  assert.deepEqual([...rules].sort(), ["closed", "enumeration", "open"]);
});

test("schema and SDK-free integrity give exactly what each case declares; signed closed cases are intact", () => {
  for (const c of [{ name: "base", signed_bundle: corpus.base, expect: corpus.base_expect }, ...cases]) {
    assert.equal(schema(c.signed_bundle).valid, c.expect.schema.valid, `${c.name}: schema`);
    const it = integrity(c.signed_bundle);
    assert.equal(it.valid, c.expect.integrity.valid, `${c.name}: integrity ${it.failures}`);
    if (!it.valid) assert.deepEqual([...it.failures].sort(), [...c.expect.integrity.failing].sort());
  }
  const signedClosed = cases.filter((c) => c.construction.startsWith("re-signed") && c.expect.schema.rule.startsWith("closed"));
  assert.equal(signedClosed.length, 4);
  for (const c of signedClosed) assert.ok(integrity(c.signed_bundle).valid && !schema(c.signed_bundle).valid, `${c.name}: intact and schema-invalid`);
});

test("the composition validateV2Bundle + verifySignedBundleV2 at the corpus instant gives the normative verdict (a composition, not an SDK alone)", async () => {
  for (const c of [{ name: "base", signed_bundle: corpus.base, expect: corpus.base_expect }, ...cases]) {
    const r = await composition(c.signed_bundle, corpus.verifier_policy, corpus.verification_time);
    assert.equal(r.verified, c.expect.verified, `${c.name}: ${JSON.stringify(r.sdk_errors)}`);
  }
});

test("provenance: only the committed public test keys sign, by kid, algorithm and key bytes; generator and randomness stated", () => {
  const keys = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/interop/v2/interop_vectors.json"), "utf8")).test_keys;
  const committed = new Map(Object.values(keys).map((k) => [k.kid, k]));
  for (const c of [{ name: "base", signed_bundle: corpus.base }, ...cases]) {
    const b = c.signed_bundle.bundle;
    const sigs = [c.signed_bundle.signature.composite_sig, ...["responsible_principal_record", "agent_passport", "intent", "policy_decision"].map((n) => b[n].composite_sig)];
    for (const s of sigs) for (const comp of [s.classical, s.pq].filter(Boolean)) {
      assert.ok(committed.has(comp.kid), `${c.name}: kid ${comp.kid}`);
      assert.equal(comp.alg, committed.get(comp.kid).alg, `${c.name}: alg of ${comp.kid}`);
    }
    // Every key entry a signature can resolve to carries exactly the committed algorithm and public key bytes.
    for (const entry of [...b.responsible_principal_record.payload.binding_keys, ...b.agent_passport.payload.keys]) {
      const k = committed.get(entry.kid);
      assert.ok(k, `${c.name}: key entry ${entry.kid} is not a committed test key`);
      assert.equal(entry.alg, k.alg, `${c.name}: alg of ${entry.kid}`);
      assert.ok(Buffer.from(entry.public_key_b64, "base64").equals(Buffer.from(k.public_key_b64, "base64")) && entry.public_key_b64 === k.public_key_b64, `${c.name}: key bytes of ${entry.kid}`);
    }
  }
  assert.ok(fs.existsSync(path.join(ROOT, corpus._generator)));
  assert.match(corpus._keys, /interop_vectors\.json#test_keys/);
  assert.match(corpus._randomness, /not byte-identical/);
});

test("the opt-in catalog: per-case controls, twin control, no expectation or name in the request", () => {
  const plan = loadEvidencePlan({ catalogFile: CATALOG });
  const all = plan.suites[0].cases;
  assert.equal(all.length, cases.length + 1);
  assert.equal(plan.fixtures["tests/interop/v2/schema_closure_vectors.json"]?.length, 64);
  for (const c of all) {
    assert.deepEqual(Object.keys(c.request).sort(), ["bundle_b64", "policy", "verification_time"]);
    const wire = JSON.stringify({ id: "x", op: c.op, ...c.request });
    for (const n of cases.map((k) => k.name)) assert.ok(!wire.includes(n), `${c.id}: request names ${n}`);
    assert.ok(!/"expect"|error_contains|schema_closure/.test(wire), `${c.id}: request carries an expectation or the corpus name`);
    if (c.expect.verified === false) assert.ok(c.controls.includes("external.v2.schema_closure.base"), `${c.id}: no base control`);
  }
  assert.deepEqual(all.find((c) => c.id.endsWith("evidence_open_member_stale")).controls, ["external.v2.schema_closure.base", "external.v2.schema_closure.evidence_open_member_resigned"]);
});

// Controlled implementations of contract /2, written to a temporary directory and run as real child processes. Only
// the directories this file creates are recorded and removed.
const created = [];
after(() => { for (const dir of created) fs.rmSync(dir, { recursive: true, force: true }); });
const fake = (body) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-diag-"));
  created.push(dir);
  const file = path.join(dir, "impl.mjs");
  fs.writeFileSync(file, `import fs from "node:fs";
${body.imports ?? ""}
const r = JSON.parse(fs.readFileSync(0, "utf8"));
const results = [];
for (const c of r.cases) { const signed = JSON.parse(Buffer.from(c.bundle_b64, "base64").toString("utf8")); results.push({ id: c.id, status: "ok", ...(${body.verdict}) }); }
process.stdout.write(JSON.stringify({ contract: r.contract, run_id: r.run_id, nonce: r.nonce, implementation: { name: "controlled", version: "0" }, results }));`);
  return [process.execPath, file];
};
const runWith = async (argv) => runEvidence({ plan: loadEvidencePlan({ catalogFile: CATALOG }), argv, timeoutMs: 120000 });

test("runner controls: accept-all fails every negative, reject-all leaves no counted negative, the composition passes", async () => {
  const accept = await runWith(fake({ verdict: "{ verified: true, errors: [] }" }));
  assert.equal(accept.status, "fail");
  const failed = accept.suites[0].cases.filter((c) => c.status === "fail").map((c) => c.id.split(".").pop());
  assert.deepEqual(failed.sort(), cases.filter((c) => !c.expect.verified).map((c) => c.name).sort());
  const reject = await runWith(fake({ verdict: "{ verified: false, errors: ['controlled rejection'] }" }));
  assert.equal(reject.status, "error");
  assert.ok(reject.suites[0].cases.filter((c) => c.expect.verified === false).every((c) => c.kind === "control_failed"));
  const imports = `import { validateV2Bundle } from ${JSON.stringify(path.join(ROOT, "lib/verify.js"))};\nimport { integrity } from ${JSON.stringify(path.join(HERE, "schema-boundary.js"))};`;
  const composed = await runWith(fake({ imports, verdict: "(() => { const ok = validateV2Bundle(signed).valid && integrity(signed).valid; return { verified: ok, errors: ok ? [] : ['rejected'] }; })()" }));
  assert.equal(composed.status, "pass", JSON.stringify(composed.suites[0].cases.filter((c) => c.status !== "pass")));
});

test("the CLI loads the opt-in catalog by path and keeps a failure a failure", () => {
  const cli = (impl) => spawnSync(process.execPath, [path.join(ROOT, "tools/conformance-external.js"), "--catalog", CATALOG, "--", ...impl], { encoding: "utf8", timeout: 120000 });
  assert.equal(cli(fake({ verdict: "{ verified: true, errors: [] }" })).status, 1);
});
