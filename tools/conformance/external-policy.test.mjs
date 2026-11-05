// Tests of the opt-in verifier policy suites: the corpora (tests/interop/v2/verifier_policy_vectors.json and
// verifier_policy_clarification_vectors.json), their builders in external-evidence.js and the catalogs through the
// runner, against controlled implementations only: catalog 1.1, archived byte for byte (external-policy-catalog-1.1.json),
// with its original invariants, then the current catalog 2.0 (external-policy-catalog.json). These test the suites; they
// say nothing of any SDK's conformance.
//   node --test tools/conformance/external-policy.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import nacl from "tweetnacl";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { loadAdmissionPlan } from "./external-admission.js";
import { loadEvidencePlan, runEvidence } from "./external-evidence.js";
import { loadPlan } from "./external.js";
import { ROOT, canon } from "./schema-boundary.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CATALOG1 = path.join(HERE, "external-policy-catalog-1.1.json");
const CATALOG = path.join(HERE, "external-policy-catalog.json");
const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
const P = read("tests/interop/v2/verifier_policy_vectors.json");
const BV = read("tests/interop/v2/bundle_vectors.json");
const MODES = ["classical_only", "hybrid_preferred", "hybrid_required", "pq_only"];
const plan = () => loadEvidencePlan({ catalogFile: CATALOG1 });
const decoded = (c) => JSON.parse(Buffer.from(c.request.bundle_b64, "base64").toString("utf8"));
const byName = new Map(P.cases.map((c) => [c.name, c]));
const planCase = (name) => plan().suites[0].cases.find((c) => c.id === `external.v2.verifier_policy.${name}`);

test("the default catalogs, their fixtures and the schema-closure diagnostic are unchanged", () => {
  const evidence = loadEvidencePlan();
  assert.equal(evidence.suites.reduce((n, s) => n + s.cases.length, 0), 241);
  assert.deepEqual(Object.keys(evidence.fixtures).sort(), [
    "tests/conformance/v2/merkle_vectors.json", "tests/interop/v2/bundle_vectors.json", "tests/interop/v2/interop_vectors.json", "tests/interop/v2/secondary_sha3_vectors.json",
  ]);
  assert.equal(loadPlan().suites.reduce((n, s) => n + s.cases.length, 0), 38);
  assert.equal(loadAdmissionPlan().suites.reduce((n, s) => n + s.cases.length, 0), 140);
  assert.equal(loadEvidencePlan({ catalogFile: path.join(HERE, "external-schema-catalog.json") }).suites[0].cases.length, 15);
  const g1 = crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, "tests/interop/v2/schema_closure_vectors.json"))).digest("hex");
  assert.match(g1, /^79e1270d/);
});

test("every case carries its exact policy and instant: the requested mode everywhere, then only its overrides", () => {
  assert.deepEqual(P.base_policy, BV.default_verifier_policy);
  for (const c of P.cases) {
    const expected = { ...P.base_policy, default_mode: c.requested_mode, risk_overrides: { low: c.requested_mode, medium: c.requested_mode, high: c.requested_mode }, ...c.policy_overrides };
    assert.deepEqual(c.policy, expected, c.name);
    assert.equal(c.verification_time, P.verification_time, c.name);
    const req = planCase(c.name).request;
    assert.deepEqual(req.policy, c.policy, `${c.name}: request policy`);
    assert.equal(req.verification_time, c.verification_time, `${c.name}: request time`);
  }
});

// spec/DCP-AI-v2.0.md § 14.2 and VERIFICATION.md V2-9, written again here so the recorded derivation is checked by a
// second implementation.
const intentSchema = read("schemas/v2/intent.schema.json");
const RANK = { routine: 0, standard: 1, elevated: 2, maximum: 3 };
function tier(intent, decision) {
  const s = decision?.risk_score;
  const scoreKnown = Number.isInteger(s) && s >= 0 && s <= 1000;
  const dc = Array.isArray(intent.data_classes) ? intent.data_classes : null;
  const unknown = !scoreKnown || !intentSchema.properties.action_type.enum.includes(intent.action_type) || !["low", "medium", "high"].includes(intent.estimated_impact)
    || !dc || dc.some((d) => !intentSchema.properties.data_classes.items.enum.includes(d));
  const score = scoreKnown ? s : 0;
  let t = "routine";
  if (score >= 800 || dc?.some((d) => d === "credentials" || d === "children_data")) t = "maximum";
  else if (score >= 500 || dc?.some((d) => ["pii", "financial_data", "health_data"].includes(d)) || intent.action_type === "initiate_payment" || intent.estimated_impact === "high" || unknown) t = "elevated";
  else if (score >= 200 || intent.estimated_impact === "medium") t = "standard";
  const x = intent.security_tier;
  if (x != null) { const e = Object.hasOwn(RANK, x) ? x : "elevated"; if (RANK[e] > RANK[t]) t = e; }
  return t;
}
const effective = (requested, t) => requested === "pq_only" ? "pq_only"
  : ["classical_only", "hybrid_preferred", "hybrid_required"][Math.max(["classical_only", "hybrid_preferred", "hybrid_required"].indexOf(requested), { routine: 0, standard: 1, elevated: 2, maximum: 2 }[t])];

test("tier and effective mode: recorded values match an independent derivation from the signed payloads", () => {
  for (const c of P.cases) {
    const b = decoded(planCase(c.name)).bundle;
    const t = tier(b.intent.payload, b.policy_decision.payload);
    assert.equal(c.tier, t, `${c.name}: tier`);
    assert.equal(c.effective_mode, effective(c.requested_mode, t), `${c.name}: effective mode`);
  }
  const eff = (bundle) => new Set(P.cases.filter((c) => c.bundle === bundle).map((c) => `${c.requested_mode}->${c.effective_mode}`));
  assert.deepEqual([...eff("routine_hybrid")].sort(), MODES.map((m) => `${m}->${m}`).sort());
  assert.ok(eff("standard_hybrid").has("classical_only->hybrid_preferred") && !P.cases.some((c) => c.bundle === "standard_hybrid" && c.effective_mode === "classical_only"),
    "the standard bundle never reaches an effective classical_only");
  for (const c of P.cases.filter((x) => x.spec_step === "V2-9" && !x.expect.verified)) assert.equal(c.effective_mode, "hybrid_required", c.name);
});

test("coverage: PQ invalid at three locations in every mode, each list in every settled mode, ambiguities without expectation", () => {
  for (const b of ["routine_hybrid", "standard_hybrid"]) for (const m of MODES) {
    assert.equal(byName.get(`${b}.${m}.positive`)?.expect.verified, true);
    for (const loc of ["bundle", "passport", "checkpoint"]) {
      const c = byName.get(`${b}.${m}.pq_invalid_${loc}`);
      assert.equal(c?.expect.verified, false, `${b} ${m} ${loc}`);
      assert.deepEqual(c.controls, [`${b}.${m}.positive`]);
    }
  }
  const lists = ["classical_alg_not_accepted", "classical_alg_advisory_rejected", "pq_alg_not_accepted", "pq_alg_advisory_rejected"];
  for (const m of MODES) for (const l of lists) {
    const name = `routine_hybrid.${m}.${l}`;
    const c = byName.get(name);
    if (m === "pq_only" && l.startsWith("classical")) {
      assert.equal(c, undefined, `${name} must not carry a verdict`);
      const o = P.omitted.find((x) => x.name === name);
      assert.ok(o && !("expect" in o) && P.questions.some((q) => q.id === o.question), `${name}: omitted with a question`);
    } else {
      assert.equal(c?.expect.verified, false, name);
      assert.deepEqual(c.controls, [`routine_hybrid.${m}.positive`]);
    }
  }
  const covered = new Set(P.cases.flatMap((c) => Object.keys(c.policy_overrides)));
  assert.deepEqual([...covered].sort(), ["accepted_classical_algs", "accepted_pq_algs", "advisory_rejected_algs"]);
  for (const q of P.questions) assert.ok(q.question && q.clauses.length > 0, q.id);
});

const verifyComponents = (msg, cs, keys) => {
  const key = (kid) => Buffer.from(keys.find((k) => k.kid === kid).public_key_b64, "base64");
  const csig = Buffer.from(cs.classical.sig_b64, "base64");
  return {
    classical: nacl.sign.detached.verify(msg, csig, key(cs.classical.kid)),
    pq: ml_dsa65.verify(Buffer.from(cs.pq.sig_b64, "base64"), Buffer.concat([msg, csig]), key(cs.pq.kid)),
  };
};
const LOC = {
  bundle: (s) => [s.signature.composite_sig, "DCP-AI.v2.Bundle", canon(s.bundle.manifest), s.bundle.responsible_principal_record.payload.binding_keys],
  passport: (s) => [s.bundle.agent_passport.composite_sig, "DCP-AI.v2.AgentPassport", canon(s.bundle.agent_passport.payload), s.bundle.agent_passport.payload.keys],
  checkpoint: (s) => { const { composite_sig: cs, ...body } = s.bundle.pq_checkpoints[0]; return [cs, "DCP-AI.v2.AuditEvent", canon(body), s.bundle.agent_passport.payload.keys]; },
};
const check = (s, loc) => { const [cs, ctx, text, keys] = LOC[loc](s); return verifyComponents(Buffer.concat([Buffer.from(ctx), Buffer.from([0]), Buffer.from(text)]), cs, keys); };
const diffPaths = (a, b, p = []) => {
  if (a === b) return [];
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return [p.join(".")];
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) => diffPaths(a[k], b[k], [...p, k]));
};

test("single change: each PQ-invalid case differs from its control only in that PQ signature, which alone fails (SDK-free)", () => {
  for (const c of P.cases.filter((x) => x.mutation)) {
    const loc = c.mutation.split(".")[1];
    const control = decoded(planCase(c.controls[0]));
    const bad = decoded(planCase(c.name));
    assert.deepEqual(diffPaths(control, bad), [P.bundles[c.bundle].pq_invalid[loc].path.join(".")], c.name);
    assert.deepEqual(check(control, loc), { classical: true, pq: true }, `${c.name}: control`);
    assert.deepEqual(check(bad, loc), { classical: true, pq: false }, `${c.name}: case`);
  }
  for (const c of P.cases.filter((x) => Object.keys(x.policy_overrides).length)) assert.equal(planCase(c.name).request.bundle_b64, planCase(c.controls[0]).request.bundle_b64, `${c.name}: same bundle as its control`);
});

test("provenance: routine_hybrid uses only the committed test keys; committed bundles match their recorded sha256", () => {
  const committed = new Map(Object.values(read("tests/interop/v2/interop_vectors.json").test_keys).map((k) => [k.kid, k]));
  const s = P.bundles.routine_hybrid.signed_bundle;
  const b = s.bundle;
  for (const cs of [s.signature.composite_sig, ...["responsible_principal_record", "agent_passport", "intent", "policy_decision"].map((n) => b[n].composite_sig), b.pq_checkpoints[0].composite_sig]) {
    for (const comp of [cs.classical, cs.pq]) assert.equal(committed.get(comp.kid)?.alg, comp.alg, comp.kid);
  }
  for (const e of [...b.responsible_principal_record.payload.binding_keys, ...b.agent_passport.payload.keys]) assert.equal(e.public_key_b64, committed.get(e.kid)?.public_key_b64, e.kid);
  for (const [name, e] of Object.entries(P.bundles).filter(([, e]) => !e.signed_bundle)) {
    const [, pointer] = e.source.split("#");
    const [coll, n] = pointer.split("/");
    const signed = coll === "classical_only_routine_bundle" ? BV.classical_only_routine_bundle.signed_bundle : BV[coll].find((c) => c.name === n).signed_bundle;
    assert.equal(crypto.createHash("sha256").update(JSON.stringify(signed)).digest("hex"), e.sha256, name);
  }
  assert.ok(fs.existsSync(path.join(ROOT, P._generator)));
  assert.match(P._randomness, /not byte-identical/);
});

test("the builder refuses a committed bundle that no longer matches its sha256", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "policy-root-"));
  created.push(dir);
  for (const rel of ["tests/conformance/v2/merkle_vectors.json", "tests/interop/v2/interop_vectors.json", "tests/interop/v2/secondary_sha3_vectors.json", "tests/interop/v2/verifier_policy_vectors.json"]) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), path.join(dir, rel));
  }
  const bv = structuredClone(BV);
  bv.classical_only_routine_bundle.signed_bundle.signature.created_at = "2026-10-21T12:04:00Z";
  fs.writeFileSync(path.join(dir, "tests/interop/v2/bundle_vectors.json"), JSON.stringify(bv));
  assert.throws(() => loadEvidencePlan({ catalogFile: CATALOG1, root: dir }), /differs from its recorded sha256/);
});

test("the opt-in catalog: ids match the corpus, controls under the same requested mode, no expectation or name in the request", () => {
  const all = plan().suites[0].cases;
  assert.equal(all.length, P.cases.length);
  for (const c of all) {
    assert.deepEqual(Object.keys(c.request).sort(), ["bundle_b64", "policy", "verification_time"]);
    const wire = JSON.stringify({ id: "x", op: c.op, ...c.request });
    assert.ok(!/"expect"|error_contains|verifier_policy_vectors|requested_mode|effective_mode|pq_invalid/.test(wire), `${c.id}: request carries an expectation or the corpus name`);
    const k = byName.get(c.id.replace("external.v2.verifier_policy.", ""));
    for (const ctl of c.controls ?? []) assert.equal(byName.get(ctl.replace("external.v2.verifier_policy.", "")).requested_mode, k.requested_mode, `${c.id}: control ${ctl}`);
  }
});

// Controlled implementations of contract /2, written to a temporary directory and run as real child processes. Only
// the directories this file creates are recorded and removed.
const created = [];
after(() => { for (const dir of created) fs.rmSync(dir, { recursive: true, force: true }); });
const keyOf = (r) => crypto.createHash("sha256").update(`${r.bundle_b64}\0${JSON.stringify(r.policy)}\0${r.verification_time}`).digest("hex");
// A lookup of the verdict each request should get (spec_steps listed in `blind` answered true instead): a runner
// control, not a verifier.
const lookup = (blind = []) => Object.fromEntries(P.cases.map((c) => [keyOf(planCase(c.name).request), blind.includes(c.spec_step) ? true : c.expect.verified]));
const fake = (verdict, table = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "policy-ctl-"));
  created.push(dir);
  const file = path.join(dir, "impl.mjs");
  fs.writeFileSync(file, `import fs from "node:fs";
import crypto from "node:crypto";
const table = ${JSON.stringify(table)};
const key = (c) => crypto.createHash("sha256").update(c.bundle_b64 + "\\0" + JSON.stringify(c.policy) + "\\0" + c.verification_time).digest("hex");
const r = JSON.parse(fs.readFileSync(0, "utf8"));
const results = r.cases.map((c) => ({ id: c.id, status: "ok", ...(${verdict}) }));
process.stdout.write(JSON.stringify({ contract: r.contract, run_id: r.run_id, nonce: r.nonce, implementation: { name: "controlled", version: "0" }, results }));`);
  return [process.execPath, file];
};
const runWith = (argv) => runEvidence({ plan: plan(), argv, timeoutMs: 120000 });
const failedNames = (report) => report.suites[0].cases.filter((c) => c.status === "fail").map((c) => c.id.replace("external.v2.verifier_policy.", "")).sort();

test("runner controls: accept-all fails every negative, reject-all counts none, a policy-blind verifier fails the list and tier cases, the lookup passes", async () => {
  const accept = await runWith(fake("{ verified: true, errors: [] }"));
  assert.equal(accept.status, "fail");
  assert.deepEqual(failedNames(accept), P.cases.filter((c) => !c.expect.verified).map((c) => c.name).sort());
  const reject = await runWith(fake("{ verified: false, errors: ['controlled rejection'] }"));
  assert.equal(reject.status, "error");
  assert.ok(reject.suites[0].cases.filter((c) => c.expect.verified === false).every((c) => c.kind === "control_failed"));
  const answer = "(() => { const v = table[key(c)]; return { verified: v, errors: v ? [] : ['controlled rejection'] }; })()";
  const blind = await runWith(fake(answer, lookup(["V2-9", "V2-10"])));
  assert.equal(blind.status, "fail");
  assert.deepEqual(failedNames(blind), P.cases.filter((c) => !c.expect.verified && ["V2-9", "V2-10"].includes(c.spec_step)).map((c) => c.name).sort());
  const right = await runWith(fake(answer, lookup()));
  assert.equal(right.status, "pass", JSON.stringify(right.suites[0].cases.filter((c) => c.status !== "pass").slice(0, 3)));
});

test("the CLI loads the archived catalog 1.1 by path and keeps a failure a failure", () => {
  const cli = spawnSync(process.execPath, [path.join(ROOT, "tools/conformance-external.js"), "--catalog", CATALOG1, "--", ...fake("{ verified: true, errors: [] }")], { encoding: "utf8", timeout: 120000 });
  assert.equal(cli.status, 1, cli.stderr);
});

// ── Catalog 2.0: catalog 1.1 archived, the clarification of V2-10 added ──────

const Q = read("tests/interop/v2/verifier_policy_clarification_vectors.json");
const QID = "external.v2.verifier_policy_clarification.";
const plan2 = () => loadEvidencePlan({ catalogFile: CATALOG });
const plan2Case = (name) => plan2().suites[1].cases.find((c) => c.id === QID + name);
const fileSha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

test("catalog 1.1 is archived byte for byte; catalog 2.0 keeps its 74 cases unchanged and adds the clarification suite", () => {
  assert.equal(fileSha(CATALOG1), "310ade61dcb39367cefe9284dce2cb2bd3d56dc97b9db91f48d804067f4c1719");
  assert.match(fileSha(path.join(ROOT, "tests/interop/v2/verifier_policy_vectors.json")), /^674abbea/);
  const one = JSON.parse(fs.readFileSync(CATALOG1, "utf8"));
  const two = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
  assert.equal(one.catalog_version, "2026-10-31.verifier-policy-1.1 (opt-in)");
  assert.equal(two.catalog_version, "2026-11-05.verifier-policy-2.0 (opt-in)");
  assert.deepEqual(two.suites.map((s) => s.id), ["external.v2.verifier_policy", "external.v2.verifier_policy_clarification"]);
  for (const k of ["id", "title", "claim", "expected_cases"]) assert.deepEqual(two.suites[0][k], one.suites[0][k], k);
  const p2 = plan2();
  assert.deepEqual(p2.suites[0].cases, plan().suites[0].cases, "same requests, expectations and controls as catalog 1.1");
  assert.deepEqual(two.suites[1].expected_cases, Q.cases.map((c) => QID + c.name));
  assert.equal(p2.suites[1].cases.length, 34);
});

test("clarification corpus: routine bases bound by sha256, exact policy and instant, the verdicts the clarification gives", () => {
  assert.deepEqual(Q.base_policy, P.base_policy);
  assert.equal(Q.verification_time, P.verification_time);
  const bases = { routine_hybrid: P.bundles.routine_hybrid.signed_bundle, classical_only_routine: BV.classical_only_routine_bundle.signed_bundle };
  assert.deepEqual(Object.keys(Q.bundles).sort(), Object.keys(bases).sort());
  for (const [n, e] of Object.entries(Q.bundles)) assert.equal(crypto.createHash("sha256").update(JSON.stringify(bases[n])).digest("hex"), e.sha256, n);
  // Written again here from the clarification of V2-10, case by case.
  const expected = {};
  for (const m of MODES) expected[`base.${m}.positive`] = true;
  for (const l of ["classical_alg_not_accepted", "classical_alg_advisory_rejected"]) Object.assign(expected, { [`q1.pq_only.${l}`]: true, [`q1.hybrid_required.${l}`]: false });
  for (const loc of ["bundle", "passport", "checkpoint"]) for (const m of MODES) expected[`q2.${loc}.${m}`] = m === "pq_only";
  for (const loc of ["bundle", "passport"]) for (const x of ["noncanonical_classical_sig_b64", "unknown_classical_kid"]) expected[`q2_scope.${loc}.${x}`] = false;
  for (const m of ["classical_only", "hybrid_preferred"]) {
    expected[`q3.${m}.positive`] = true;
    for (const l of ["pq_alg_not_accepted", "pq_alg_advisory_rejected"]) Object.assign(expected, { [`q3.${m}.${l}`]: true, [`q3_contrast.${m}.${l}`]: false });
  }
  assert.deepEqual(Object.fromEntries(Q.cases.map((c) => [c.name, c.expect.verified])), expected);
  for (const c of Q.cases) {
    assert.deepEqual(c.policy, { ...Q.base_policy, default_mode: c.requested_mode, risk_overrides: { low: c.requested_mode, medium: c.requested_mode, high: c.requested_mode }, ...c.policy_overrides }, c.name);
    assert.equal(c.verification_time, Q.verification_time, c.name);
    const b = decoded(plan2Case(c.name)).bundle;
    assert.equal(tier(b.intent.payload, b.policy_decision.payload), "routine", c.name);
    assert.equal(c.effective_mode, effective(c.requested_mode, "routine"), c.name);
    if (c.expect.verified) assert.equal(c.controls, undefined, c.name);
    else assert.deepEqual(c.controls, [`base.${c.requested_mode}.positive`], c.name);
  }
});

test("clarification variants, without any SDK: Q2 re-signs only the PQ component over failing classical bytes; scope variants keep every signature byte", () => {
  const routine = decoded(plan2Case("base.pq_only.positive"));
  const sigPath = { bundle: "signature.composite_sig", passport: "bundle.agent_passport.composite_sig", checkpoint: "bundle.pq_checkpoints.0.composite_sig" };
  for (const loc of Object.keys(sigPath)) {
    const v = decoded(plan2Case(`q2.${loc}.pq_only`));
    assert.deepEqual(diffPaths(routine, v).sort(), [`${sigPath[loc]}.classical.sig_b64`, `${sigPath[loc]}.pq.sig_b64`], loc);
    assert.deepEqual(check(routine, loc), { classical: true, pq: true }, `${loc}: base`);
    assert.deepEqual(check(v, loc), { classical: false, pq: true }, `${loc}: variant`);
  }
  for (const loc of ["bundle", "passport"]) {
    const [cs] = LOC[loc](routine);
    const nc = decoded(plan2Case(`q2_scope.${loc}.noncanonical_classical_sig_b64`));
    const text = LOC[loc](nc)[0].classical.sig_b64;
    assert.deepEqual(diffPaths(routine, nc), [`${sigPath[loc]}.classical.sig_b64`]);
    assert.ok(Buffer.from(text, "base64").equals(Buffer.from(cs.classical.sig_b64, "base64")) && Buffer.from(text, "base64").toString("base64") !== text, `${loc}: same bytes, not canonical`);
    const uk = decoded(plan2Case(`q2_scope.${loc}.unknown_classical_kid`));
    const [ucs, , , keys] = LOC[loc](uk);
    assert.deepEqual(diffPaths(routine, uk), [`${sigPath[loc]}.classical.kid`]);
    assert.ok(!keys.some((k) => k.kid === ucs.classical.kid), `${loc}: the kid names no key`);
  }
});

// Hostile controls: each fake answers every request of catalog 2.0 from the corpus expectations, except for one wrong
// reading of the clarification, decided on the request alone, as a verifier would. Each must fail exactly its cases,
// in either suite, and never lose a control.
const runWith2 = (argv) => runEvidence({ plan: plan2(), argv, timeoutMs: 120000 });
const failedIds = (report) => report.suites.flatMap((s) => s.cases).filter((c) => c.status === "fail").map((c) => c.id).sort();
const table2 = (wrong = (_r, v) => v) => {
  const t = {};
  for (const c of plan2().suites.flatMap((s) => s.cases)) {
    const k = keyOf(c.request);
    const v = wrong(c.request, c.expect.verified);
    assert.ok(!(k in t) || t[k] === v, `${c.id}: one request, two verdicts`);
    t[k] = v;
  }
  return t;
};
const ANSWER = "(() => { const v = table[key(c)]; return { verified: v, errors: v ? [] : ['controlled rejection'] }; })()";

test("hostile controls: each wrong reading of Q1, Q2 or Q3 fails exactly its cases; accept-all and reject-all are caught", async () => {
  const q2 = new Set(["bundle", "passport", "checkpoint"].map((l) => plan2Case(`q2.${l}.pq_only`).request.bundle_b64));
  const noPq = plan2Case("q3.classical_only.positive").request.bundle_b64;
  const pqOnly = (r) => r.policy.default_mode === "pq_only";
  const excludes = (p, alg, list) => !p[list].includes(alg) || p.advisory_rejected_algs.includes(alg);
  const q = (...names) => names.map((n) => QID + n);
  const old = (...names) => names.map((n) => `external.v2.verifier_policy.${n}`);
  const LISTS = ["classical_alg_advisory_rejected", "classical_alg_not_accepted"];
  const MUTANTS = [
    ["classical lists applied under pq_only", (r, v) => (pqOnly(r) && excludes(r.policy, "ed25519", "accepted_classical_algs") ? false : v), q(...LISTS.map((l) => `q1.pq_only.${l}`))],
    ["an invalid classical component rejected under pq_only", (r, v) => (pqOnly(r) && q2.has(r.bundle_b64) ? false : v), q("q2.bundle.pq_only", "q2.checkpoint.pq_only", "q2.passport.pq_only")],
    ["PQ lists applied to a bundle without PQ", (r, v) => (r.bundle_b64 === noPq && excludes(r.policy, "ml-dsa-65", "accepted_pq_algs") ? false : v),
      q(...["classical_only", "hybrid_preferred"].flatMap((m) => [`q3.${m}.pq_alg_advisory_rejected`, `q3.${m}.pq_alg_not_accepted`]))],
    ["the mode ignored: what pq_only tolerates, tolerated in every mode", (r, v) => (q2.has(r.bundle_b64) || excludes(r.policy, "ed25519", "accepted_classical_algs") ? true : v), [
      ...q(...LISTS.map((l) => `q1.hybrid_required.${l}`), ...["bundle", "checkpoint", "passport"].flatMap((loc) => ["classical_only", "hybrid_preferred", "hybrid_required"].map((m) => `q2.${loc}.${m}`))),
      ...old(...["classical_only", "hybrid_preferred", "hybrid_required"].flatMap((m) => LISTS.map((l) => `routine_hybrid.${m}.${l}`))),
    ]],
  ];
  for (const [what, wrong, expected] of MUTANTS) {
    const report = await runWith2(fake(ANSWER, table2(wrong)));
    assert.equal(report.status, "fail", what);
    assert.deepEqual(failedIds(report), [...expected].sort(), what);
    assert.ok(report.suites.flatMap((s) => s.cases).every((c) => c.kind !== "control_failed"), `${what}: a control was lost`);
  }
  const right = await runWith2(fake(ANSWER, table2()));
  assert.equal(right.status, "pass");
  const accept = await runWith2(fake("{ verified: true, errors: [] }"));
  assert.deepEqual(failedIds(accept), plan2().suites.flatMap((s) => s.cases).filter((c) => !c.expect.verified).map((c) => c.id).sort());
  const reject = await runWith2(fake("{ verified: false, errors: ['controlled rejection'] }"));
  assert.equal(reject.status, "error");
  assert.ok(reject.suites[1].cases.filter((c) => !c.expect.verified).every((c) => c.kind === "control_failed"));
});

test("the CLI runs catalog 2.0 by path, selects the clarification suite alone, and keeps a failure a failure", () => {
  const cli = (argv, ...extra) => spawnSync(process.execPath, [path.join(ROOT, "tools/conformance-external.js"), "--catalog", CATALOG, ...extra, "--", ...argv], { encoding: "utf8", timeout: 120000 });
  const select = ["--suite", "external.v2.verifier_policy_clarification", "--assessment", "verdict"];
  assert.equal(cli(fake(ANSWER, table2()), ...select).status, 0);
  assert.equal(cli(fake("{ verified: true, errors: [] }"), ...select).status, 1);
});
