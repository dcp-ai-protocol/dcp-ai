// Tests of the opt-in structural suite: the corpus (tests/interop/v2/structural_vectors.json), its SDK-free checks
// (structural-checks.js), its builder in external-evidence.js and its catalog (external-structural-catalog.json)
// through the runner, against controlled implementations only. These test the suite, not any SDK's conformance.
//   node --test tools/conformance/external-structural.test.mjs
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
import { loadPlan } from "./external.js";
import { ROOT, canon, resolveSchemaPointer, schema } from "./schema-boundary.js";
import { canonicalB64, checkpointText, components, structure } from "./structural-checks.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CATALOG = path.join(HERE, "external-structural-catalog.json");
const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
const fileSha = (rel) => crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, rel))).digest("hex");
const S = read("tests/interop/v2/structural_vectors.json");
const T = S.verification_time;
const control = (c) => (c.twin ? S.positives.find((p) => p.name === c.twin) : { signed_bundle: S.base }).signed_bundle;
const at = (obj, p) => p.reduce((n, k) => n?.[k], obj);
const plan = () => loadEvidencePlan({ catalogFile: CATALOG });
const ID = (n) => `external.v2.structural.${n}`;

test("the default catalogs and the G1 and G2 corpora and catalogs are unchanged", () => {
  const evidence = loadEvidencePlan();
  assert.equal(evidence.suites.reduce((n, s) => n + s.cases.length, 0), 241);
  assert.equal(Object.keys(evidence.fixtures).length, 4);
  assert.equal(loadPlan().suites.reduce((n, s) => n + s.cases.length, 0), 38);
  assert.equal(loadAdmissionPlan().suites.reduce((n, s) => n + s.cases.length, 0), 140);
  assert.equal(loadEvidencePlan({ catalogFile: path.join(HERE, "external-schema-catalog.json") }).suites[0].cases.length, 15);
  assert.equal(loadEvidencePlan({ catalogFile: path.join(HERE, "external-policy-catalog.json") }).suites[0].cases.length, 74);
  assert.match(fileSha("tests/interop/v2/schema_closure_vectors.json"), /^79e1270d/);
  assert.match(fileSha("tools/conformance/external-schema-catalog.json"), /^79585454/);
  assert.match(fileSha("tests/interop/v2/verifier_policy_vectors.json"), /^674abbea/);
  assert.match(fileSha("tools/conformance/external-policy-catalog.json"), /^310ade61/);
});

test("every bundle is schema-valid and the SDK-free checks give exactly its declared failures", () => {
  for (const c of [{ name: "base", signed_bundle: S.base }, ...S.positives]) assert.deepEqual(structure(c.signed_bundle, T), [], c.name);
  for (const c of [{ name: "base", signed_bundle: S.base }, ...S.positives, ...S.cases]) assert.equal(schema(c.signed_bundle).valid, true, `${c.name}: schema`);
  for (const c of S.cases) assert.deepEqual(structure(c.signed_bundle, T), c.expect.structural_failures, c.name);
  assert.deepEqual(S.verifier_policy, read("tests/interop/v2/bundle_vectors.json").default_verifier_policy);
});

const diffPaths = (a, b, p = []) => {
  if (a === b) return [];
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return [p];
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) => diffPaths(a[k], b[k], [...p, k]));
};
const under = (p, prefix) => prefix.every((k, i) => String(p[i]) === String(k));

test("single change: each case differs from the base only under its declared paths, every declared path differs, and the session case differs from its twin only in session_issued_at", () => {
  for (const c of [...S.positives, ...S.cases]) {
    const diffs = diffPaths(S.base, c.signed_bundle);
    for (const d of diffs) assert.ok(c.changed_paths.some((p) => under(d, p)), `${c.name}: ${d.join(".")} changed but is not declared`);
    for (const p of c.changed_paths) assert.ok(diffs.some((d) => under(d, p)), `${c.name}: ${p.join(".")} declared but unchanged`);
  }
  const session = S.cases.find((c) => c.name === "session_issued_after_expires");
  assert.deepEqual(diffPaths(control(session), session.signed_bundle).map((d) => d.slice(0, 3).join(".")).sort(),
    ["bundle.manifest.session_issued_at", "signature.composite_sig.classical", "signature.composite_sig.pq", "signature.manifest_hash"].sort());
});

test("isolation: encodings keep their bytes, classical negatives keep a valid PQ component, ranges use real trail positions", () => {
  for (const c of S.cases.filter((x) => x.spec_step === "V2-5")) {
    const p = c.changed_paths[0];
    assert.ok(!canonicalB64(at(c.signed_bundle, p)) && canonicalB64(at(S.base, p)), c.name);
    assert.ok(Buffer.from(at(c.signed_bundle, p), "base64").equals(Buffer.from(at(S.base, p), "base64")), `${c.name}: decoded bytes`);
  }
  const bundleSig = (s) => components("DCP-AI.v2.Bundle", canon(s.bundle.manifest), s.signature.composite_sig, s.bundle.responsible_principal_record.payload.binding_keys);
  const cpSig = (s) => components("DCP-AI.v2.AuditEvent", checkpointText(s.bundle.pq_checkpoints[0]), s.bundle.pq_checkpoints[0].composite_sig, s.bundle.agent_passport.payload.keys);
  const get = (n) => S.cases.find((c) => c.name === n).signed_bundle;
  assert.deepEqual(bundleSig(S.base), { classical: true, pq: true });
  assert.deepEqual(bundleSig(get("bundle_classical_invalid_pq_resigned")), { classical: false, pq: true });
  assert.deepEqual(cpSig(S.base), { classical: true, pq: true });
  assert.deepEqual(cpSig(get("checkpoint_classical_invalid_pq_resigned")), { classical: false, pq: true });
  assert.deepEqual(cpSig(get("checkpoint_without_pq")), { classical: true, pq: null });
  const trail = S.base.bundle.audit_entries.map((e) => e.audit_id);
  assert.notDeepEqual([...trail].sort(), trail, "audit_ids must not be in lexical order");
  const range = S.base.bundle.pq_checkpoints[0].event_range;
  assert.deepEqual([trail.indexOf(range.from_audit_id), trail.indexOf(range.to_audit_id)], [1, 2], "the base checkpoint covers positions 1 and 2");
  const back = get("checkpoint_range_backwards").bundle.pq_checkpoints[0].event_range;
  assert.ok(trail.indexOf(back.from_audit_id) > trail.indexOf(back.to_audit_id) && trail.indexOf(back.to_audit_id) >= 0);
  assert.equal(trail.indexOf(get("checkpoint_from_audit_id_absent").bundle.pq_checkpoints[0].event_range.from_audit_id), -1);
  assert.throws(() => canon(get("intent_payload_fraction").bundle.intent.payload), /not an integer/);
  assert.equal(resolveSchemaPointer("schemas/v2/intent.schema.json#/properties/target/additionalProperties"), undefined, "intent.target is open");
  const m = get("session_issued_after_expires").bundle.manifest;
  const t = Date.parse(T);
  assert.ok(Date.parse(m.session_expires_at) > t && Date.parse(m.session_issued_at) > Date.parse(m.session_expires_at) && Date.parse(m.session_issued_at) <= t + 30000);
  assert.equal(get("manifest_audit_count_off_root_right").bundle.manifest.audit_merkle_root, S.base.bundle.manifest.audit_merkle_root);
});

test("provenance: only the committed test keys sign, by kid, algorithm and key bytes; generator and randomness stated", () => {
  const committed = new Map(Object.values(read("tests/interop/v2/interop_vectors.json").test_keys).map((k) => [k.kid, k]));
  for (const c of [{ name: "base", signed_bundle: S.base }, ...S.positives, ...S.cases]) {
    const s = c.signed_bundle;
    const b = s.bundle;
    const sigs = [s.signature.composite_sig, ...["responsible_principal_record", "agent_passport", "intent", "policy_decision"].map((n) => b[n].composite_sig), ...b.pq_checkpoints.map((x) => x.composite_sig)];
    for (const cs of sigs) for (const comp of [cs.classical, cs.pq].filter(Boolean)) assert.equal(committed.get(comp.kid)?.alg, comp.alg, `${c.name}: ${comp.kid}`);
    for (const e of [...b.responsible_principal_record.payload.binding_keys, ...b.agent_passport.payload.keys]) assert.equal(e.public_key_b64, committed.get(e.kid)?.public_key_b64, `${c.name}: ${e.kid}`);
  }
  assert.ok(fs.existsSync(path.join(ROOT, S._generator)));
  assert.match(S._randomness, /not byte-identical/);
});

test("the opt-in catalog: one policy and instant, base (and twin) controls, no expectation or name in the request", () => {
  const all = plan().suites[0].cases;
  assert.equal(all.length, 2 + S.cases.length);
  const names = [...S.positives, ...S.cases].map((c) => c.name);
  for (const c of all) {
    assert.deepEqual(Object.keys(c.request).sort(), ["bundle_b64", "policy", "verification_time"]);
    assert.deepEqual(c.request.policy, S.verifier_policy);
    assert.equal(c.request.verification_time, T);
    const wire = JSON.stringify({ id: "x", op: c.op, ...c.request });
    for (const n of names) assert.ok(!wire.includes(n), `${c.id}: request names ${n}`);
    assert.ok(!/"expect"|error_contains|structural_vectors|structural_failures/.test(wire), `${c.id}: request carries an expectation or the corpus name`);
    if (c.expect.verified === false) assert.ok(c.controls.includes(ID("base")), `${c.id}: no base control`);
  }
  assert.deepEqual(all.find((c) => c.id === ID("session_issued_after_expires")).controls, [ID("base"), ID("session_issued_before_expires")]);
});

// Controlled implementations of contract /2, written to a temporary directory and run as real child processes. Only
// the directories this file creates are recorded and removed.
const created = [];
after(() => { for (const dir of created) fs.rmSync(dir, { recursive: true, force: true }); });
const keyOf = (r) => crypto.createHash("sha256").update(r.bundle_b64).digest("hex");
// A lookup of the verdict each request should get, with `flip` names answered the other way: a runner control, not a verifier.
const lookup = (flip = []) => Object.fromEntries(plan().suites[0].cases.map((c) => [keyOf(c.request), flip.includes(c.id) ? !c.expect.verified : c.expect.verified]));
const fake = (verdict, table = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "structural-ctl-"));
  created.push(dir);
  const file = path.join(dir, "impl.mjs");
  fs.writeFileSync(file, `import fs from "node:fs";
import crypto from "node:crypto";
const table = ${JSON.stringify(table)};
const key = (c) => crypto.createHash("sha256").update(c.bundle_b64).digest("hex");
const r = JSON.parse(fs.readFileSync(0, "utf8"));
const results = r.cases.map((c) => ({ id: c.id, status: "ok", ...(${verdict}) }));
process.stdout.write(JSON.stringify({ contract: r.contract, run_id: r.run_id, nonce: r.nonce, implementation: { name: "controlled", version: "0" }, results }));`);
  return [process.execPath, file];
};
const runWith = (argv) => runEvidence({ plan: plan(), argv, timeoutMs: 120000 });
const ANSWER = "(() => { const v = table[key(c)]; return { verified: v, errors: v ? [] : ['controlled rejection'] }; })()";
const byStatus = (report, status) => report.suites[0].cases.filter((c) => c.status === status).map((c) => c.id).sort();

test("runner controls: accept-all fails every negative, reject-all counts none, the lookup passes", async () => {
  const accept = await runWith(fake("{ verified: true, errors: [] }"));
  assert.equal(accept.status, "fail");
  assert.deepEqual(byStatus(accept, "fail"), S.cases.map((c) => ID(c.name)).sort());
  const reject = await runWith(fake("{ verified: false, errors: ['controlled rejection'] }"));
  assert.equal(reject.status, "error");
  assert.ok(reject.suites[0].cases.filter((c) => c.expect.verified === false).every((c) => c.kind === "control_failed"));
  const right = await runWith(fake(ANSWER, lookup()));
  assert.equal(right.status, "pass", JSON.stringify(right.suites[0].cases.filter((c) => c.status !== "pass").slice(0, 3)));
});

test("runner controls: a verifier that ignores one specific rule fails exactly that case", async () => {
  for (const c of S.cases) {
    const r = await runWith(fake(ANSWER, lookup([ID(c.name)])));
    assert.equal(r.status, "fail", c.name);
    assert.deepEqual(byStatus(r, "fail"), [ID(c.name)], c.name);
  }
});

test("runner controls: when the twin positive fails, the session negative is not counted", async () => {
  const r = await runWith(fake(ANSWER, lookup([ID("session_issued_before_expires")])));
  assert.notEqual(r.status, "pass");
  assert.equal(r.suites[0].cases.find((c) => c.id === ID("session_issued_after_expires")).kind, "control_failed");
});

test("the CLI loads the opt-in catalog by path and keeps a failure a failure", () => {
  const cli = spawnSync(process.execPath, [path.join(ROOT, "tools/conformance-external.js"), "--catalog", CATALOG, "--", ...fake("{ verified: true, errors: [] }")], { encoding: "utf8", timeout: 120000 });
  assert.equal(cli.status, 1, cli.stderr);
});
