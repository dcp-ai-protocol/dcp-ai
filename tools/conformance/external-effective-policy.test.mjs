// Tests of the opt-in effective-policy catalog (contract dcp-ai-conformance-external/5, external-effective.js): the
// corpus and catalog, the loader's checks, the judge and the transport through the runner's own dispatch (controlled
// implementations built from the TypeScript wrapper's real answers, altered by mode), and the five wrappers. Only
// committed public files are read.
//   node --test tools/conformance/external-effective-policy.test.mjs
//   DCP_EXTERNAL_PYTHON=/path/to/python DCP_EXTERNAL_REQUIRE_PYTHON=1 DCP_EXTERNAL_REQUIRE_NATIVE=1 \
//     node --test tools/conformance/external-effective-policy.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ARTIFACTS } from "./wrappers/build.mjs";
import { EFFECTIVE_CONTRACT, SUITES, TIERS, MODES, consistent, loadEffectivePlan } from "./external-effective.js";
import { buildEffectiveCatalog } from "./effective-policy-catalog.mjs";
import { schema } from "./schema-boundary.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const CLI = path.join(REPO, "tools", "conformance-external.js");
const CATALOG = path.join(HERE, "external-effective-policy-catalog.json");
const TS_SDK = path.join(REPO, "sdks", "typescript", "dist", "index.js");
const TS = [process.execPath, path.join(HERE, "wrappers", "ts-sdk.mjs"), "--sdk", TS_SDK];
const PYTHON = process.env.DCP_EXTERNAL_PYTHON;
const REQUIRE_PY = process.env.DCP_EXTERNAL_REQUIRE_PYTHON === "1";
const REQUIRE_NATIVE = process.env.DCP_EXTERNAL_REQUIRE_NATIVE === "1";
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-effective-"));
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

const read = (rel) => JSON.parse(fs.readFileSync(path.join(REPO, rel), "utf8"));
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const P = read("tests/interop/v2/verifier_policy_vectors.json");
const V = read("tests/interop/v2/effective_policy_vectors.json");
const EFFECTIVE_VECTORS_SHA256 = "5973cb22998b66985f307b12493818a3a0d8ea9c6e6ecdfb5a859ad4b5d756b5";
const OBSERVATIONAL = ["payment_from_passport_risk_tier_constructor", "payment_from_passport_risk_tier_proto", "payment_from_passport_risk_tier_toString",
  "payment_from_passport_risk_tier_hasOwnProperty", "intent_action_type_constructor", "intent_estimated_impact_constructor", "intent_security_tier_constructor"]
  .flatMap((n) => ["classical_only", "hybrid_preferred"].map((m) => `${SUITES.policy}.classical_only_${n}.${m}`)).sort();
const PRE = ["dcp_bundle_version_3_0", "intent_payload_hash_wrong", "audit_entries_truncated", "signature_manifest_hash_other"].map((n) => `${SUITES.pre}.${n}`);
const plan = loadEffectivePlan();
const CASES = plan.suites.flatMap((s) => s.cases);
const BY_ID = new Map(CASES.map((c) => [c.id, c]));
const decode = (b64) => JSON.parse(Buffer.from(b64, "base64").toString("utf8"));

// ── Corpus and catalog ──────────────────────────────────────────

test("catalog: built from the committed fixtures, 130 cases with their resolutions pinned", () => {
  assert.deepEqual(buildEffectiveCatalog(), JSON.parse(fs.readFileSync(CATALOG, "utf8")));
  assert.deepEqual(plan.suites.map((s) => [s.id, s.cases.length]), [[SUITES.policy, 74], [SUITES.clarification, 34], [SUITES.coverage, 17], [SUITES.pre, 5]]);
  const of = (r) => CASES.filter((c) => c.resolution === r).map((c) => c.id).sort();
  assert.equal(of("required").length, 112);
  assert.deepEqual(of("observational"), OBSERVATIONAL);
  assert.deepEqual(of("pre_resolution"), [...PRE].sort());
  assert.equal(sha(fs.readFileSync(path.join(REPO, "tests/interop/v2/effective_policy_vectors.json"))), EFFECTIVE_VECTORS_SHA256);
  // The observational cases are exactly those whose committed bytes fail the reference V2-2 validation.
  for (const c of CASES.filter((x) => x.id.startsWith(`${SUITES.policy}.`) || x.id.startsWith(`${SUITES.clarification}.`))) {
    assert.equal(schema(decode(c.request.bundle_b64)).valid, c.resolution !== "observational", c.id);
  }
  // Every control is a plain positive whose mode and tier are required.
  for (const c of CASES) for (const k of c.controls ?? []) assert.ok(BY_ID.get(k).expect.verified && BY_ID.get(k).resolution === "required" && !BY_ID.get(k).controls, `${c.id} -> ${k}`);
});

// Independent handwritten rules (spec/DCP-AI-v2.0.md § 14.3, VERIFICATION.md V2-9): the override for the passport
// risk_tier replaces default_mode, then the tier floor raises it; pq_only stays pq_only. Not max(default, override, tier).
const FLOOR = { routine: "classical_only", standard: "hybrid_preferred", elevated: "hybrid_required", maximum: "hybrid_required" };
const STRICT = ["classical_only", "hybrid_preferred", "hybrid_required"];
const policyModeOf = (policy, riskTier) => (riskTier && Object.hasOwn(policy.risk_overrides ?? {}, riskTier) ? policy.risk_overrides[riskTier] : policy.default_mode);
const effectiveOf = (mode, tier) => (mode === "pq_only" ? "pq_only" : STRICT[Math.max(STRICT.indexOf(mode), STRICT.indexOf(FLOOR[tier]))]);

test("coverage: valid positives at four tiers under four requested modes, raised modes, overrides, risk_score, floors", () => {
  const positives = new Set();
  for (const c of P.cases) if (c.expect.verified) positives.add(`${c.tier}/${c.requested_mode}`);
  for (const c of V.cases) if (c.expect.verified) positives.add(`${V.bundles[c.bundle].tier}/${c.requested_mode}`);
  for (const t of TIERS) for (const m of MODES) assert.ok(positives.has(`${t}/${m}`), `no signed positive at ${t} under ${m}`);
  for (const c of V.cases) {
    const b = V.bundles[c.bundle];
    assert.equal(policyModeOf(c.policy, b.passport_risk_tier), c.requested_mode, c.name);
    assert.equal(effectiveOf(c.requested_mode, b.tier), c.expect.effective.verification_mode, c.name);
  }
  for (const c of P.cases) assert.equal(effectiveOf(policyModeOf(c.policy, P.bundles[c.bundle].passport_risk_tier), c.tier), c.effective_mode, c.name);
  const raised = V.cases.filter((c) => c.expect.verified && c.requested_mode !== c.expect.effective.verification_mode).map((c) => V.bundles[c.bundle].tier);
  for (const t of ["standard", "elevated", "maximum"]) assert.ok(raised.includes(t), `no raised positive at ${t}`);
  const base = V.cases.filter((c) => JSON.stringify(c.policy) === JSON.stringify(V.base_policy));
  assert.ok(base.some((c) => c.expect.verified && c.expect.effective.verification_mode === "classical_only" && V.base_policy.default_mode === "hybrid_preferred"), "an override lower than the default");
  assert.ok(base.some((c) => c.expect.verified && c.expect.effective.verification_mode === "hybrid_required" && V.bundles[c.bundle].tier === "routine"), "an override higher than the default and the floor");
  assert.ok(base.some((c) => c.expect.verified && c.requested_mode === "classical_only" && c.expect.effective.verification_mode === "hybrid_preferred"), "an override raised by the floor");
  assert.deepEqual(Object.values(V.bundles).map((b) => b.signed_bundle.bundle.policy_decision.payload.risk_score).filter((s) => s > 0).sort((a, b) => a - b), [200, 500, 799, 800]);
  assert.equal(V.bundles.maximum_risk_800_hybrid.signed_bundle.bundle.policy_decision.payload.resolved_tier, "routine");
  assert.equal(V.cases.length, 17);
});

// The loader refuses a catalog or fixtures that do not hold. A root copy carries the fixtures it reads.
const ROOT_FILES = ["tests/conformance/v2/merkle_vectors.json", "tests/interop/v2/interop_vectors.json", "tests/interop/v2/bundle_vectors.json", "tests/interop/v2/secondary_sha3_vectors.json",
  "tests/interop/v2/verifier_policy_vectors.json", "tests/interop/v2/verifier_policy_clarification_vectors.json", "tests/interop/v2/effective_policy_vectors.json"];
let roots = 0;
function rootWith(edit) {
  const root = path.join(TMP, `root-${++roots}`);
  for (const f of ROOT_FILES) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.copyFileSync(path.join(REPO, f), path.join(root, f)); }
  const file = path.join(root, "tests/interop/v2/effective_policy_vectors.json");
  const doc = JSON.parse(fs.readFileSync(file, "utf8")); edit(doc); fs.writeFileSync(file, JSON.stringify(doc));
  return root;
}
let cats = 0;
function catalogWith(edit) {
  const cat = JSON.parse(fs.readFileSync(CATALOG, "utf8")); edit(cat);
  const file = path.join(TMP, `catalog-${++cats}.json`); fs.writeFileSync(file, JSON.stringify(cat)); return file;
}
test("loader: missing, extra or duplicate ids, wrong resolutions, inconsistent expectations and controls that are not plain positives are refused", () => {
  const refuses = (opts, re) => assert.throws(() => loadEffectivePlan(opts), (e) => e.constructor.name === "InfraError" && re.test(e.message), re.source);
  refuses({ catalogFile: catalogWith((c) => c.suites[2].expected_cases.pop()) }, /fixtures and catalog disagree \(missing none; extra/);
  refuses({ catalogFile: catalogWith((c) => c.suites[2].expected_cases.push(`${SUITES.coverage}.invented`)) }, /missing external\.v2\.effective\.coverage\.invented/);
  refuses({ catalogFile: catalogWith((c) => c.suites[3].expected_cases.push(c.suites[3].expected_cases[0])) }, /duplicate id/);
  refuses({ catalogFile: catalogWith((c) => { c.suites[2].observational_cases = [`${SUITES.coverage}.elevated_payment_hybrid.pq_only.positive`]; c.suites[2].observational_basis = "x"; }) }, /expected to verify must require/);
  refuses({ catalogFile: catalogWith((c) => c.suites[3].pre_resolution_cases.push(`${SUITES.pre}.signed_bundle`)) }, /pre-resolution case is a rejection with no expected/);
  refuses({ catalogFile: catalogWith((c) => { c.contract = "dcp-ai-conformance-external/2"; }) }, /needs contract dcp-ai-conformance-external\/5/);
  refuses({ catalogFile: catalogWith((c) => { c.suites[0].id = "external.v2.effective.unknown"; }) }, /unknown suite/);
  refuses({ catalogFile: catalogWith((c) => { c.suites[3].control_effective.resolved_tier = "maximum"; c.suites[3].control_effective.verification_mode = "classical_only"; }) }, /known and consistent/);
  refuses({ root: rootWith((d) => { d.cases.find((c) => c.name === "maximum_risk_800_hybrid.classical_only.positive").expect.effective.verification_mode = "classical_only"; }) }, /known and consistent/);
  refuses({ root: rootWith((d) => { d.cases.find((c) => c.name === "passport_high_routine_hybrid.base_policy.positive").controls = ["classical_only_passport_high_routine.base_policy.rejected"]; }) }, /must be a positive that requires its mode and tier and has no controls/);
});

// ── Controlled implementations from the TypeScript wrapper's real answers ──

const keyOf = (c) => sha(`${c.bundle_b64}\0${JSON.stringify(c.policy)}\0${c.verification_time}`);
let REAL;
function real() {
  if (REAL) return REAL;
  const request = { contract: EFFECTIVE_CONTRACT, run_id: "real", nonce: "real", cases: CASES.map((c) => ({ id: c.id, op: c.op, ...c.request })) };
  const file = path.join(TMP, "real-request.json"); fs.writeFileSync(file, JSON.stringify(request));
  const fd = fs.openSync(file, "r");
  const r = spawnSync(TS[0], TS.slice(1), { stdio: [fd, "pipe", "pipe"], maxBuffer: 1 << 28, timeout: 300000 });
  fs.closeSync(fd);
  assert.equal(r.status, 0, r.stderr?.toString());
  REAL = new Map(JSON.parse(r.stdout.toString("utf8")).results.map(({ id, ...rest }) => [id, rest]));
  return REAL;
}
const resolvedPair = (e) => (e.verification_mode.exposed && e.resolved_tier.exposed && MODES.includes(e.verification_mode.value) && TIERS.includes(e.resolved_tier.value)
  ? { mode: e.verification_mode.value, tier: e.resolved_tier.value } : null);
// Derivation shortcuts a wrapper must not take, as functions of the reported pair and the request (serialised into the fake).
const HELPERS = `const FLOOR = ${JSON.stringify(FLOOR)};
const TIERS = ${JSON.stringify(TIERS)};
const dec = (c) => JSON.parse(Buffer.from(c.bundle_b64, "base64").toString("utf8"));
const policyMode = (c) => { const rt = dec(c)?.bundle?.agent_passport?.payload?.risk_tier; const o = c.policy.risk_overrides ?? {}; return rt && Object.hasOwn(o, rt) ? o[rt] : c.policy.default_mode; };
const declared = (c) => dec(c)?.bundle?.intent?.payload?.security_tier;
const decided = (c) => dec(c)?.bundle?.policy_decision?.payload?.resolved_tier;`;
const SHORTCUTS = {
  policy_mode: "(p, c) => ({ ...p, mode: policyMode(c) })",
  default_mode: "(p, c) => ({ ...p, mode: c.policy.default_mode })",
  tier_floor: "(p) => ({ ...p, mode: FLOOR[p.tier] })",
  declared_tier: "(p, c) => (TIERS.includes(declared(c)) ? { ...p, tier: declared(c) } : p)",
  decision_tier: "(p, c) => (TIERS.includes(decided(c)) ? { ...p, tier: decided(c) } : p)",
};
// Field and envelope mutations of one result.
const MUTATIONS = {
  absent: "(r) => ({ ...r, effective: { verification_mode: { exposed: false }, resolved_tier: { exposed: false } } })",
  null: "(r) => ({ ...r, effective: { verification_mode: { exposed: true, value: null }, resolved_tier: { exposed: true, value: null } } })",
  empty: "(r) => ({ ...r, effective: { verification_mode: { exposed: true, value: '' }, resolved_tier: { exposed: true, value: '' } } })",
  partial: "(r) => ({ ...r, effective: { verification_mode: { exposed: true, value: 'hybrid_required' }, resolved_tier: { exposed: false } } })",
  number: "(r) => ({ ...r, effective: { ...r.effective, verification_mode: { exposed: true, value: 5 } } })",
  unknown: "(r) => ({ ...r, effective: { ...r.effective, verification_mode: { exposed: true, value: 'hybrid' } } })",
  contradictory: "(r) => ({ ...r, effective: { verification_mode: { exposed: true, value: 'classical_only' }, resolved_tier: { exposed: true, value: 'maximum' } } })",
  wrong: "(r, e) => { const t = e?.effective?.resolved_tier === 'maximum' ? 'elevated' : 'maximum'; return { ...r, effective: { verification_mode: { exposed: true, value: 'hybrid_required' }, resolved_tier: { exposed: true, value: t } } }; }",
  flip: "(r) => ({ ...r, verified: !r.verified, errors: r.verified ? ['controlled rejection'] : [] })",
  verified_errors: "(r) => ({ ...r, verified: true, errors: ['controlled error'] })",
  no_effective: "({ effective: _e, ...r }) => r",
  obs_no_value: "(r) => ({ ...r, effective: { ...r.effective, verification_mode: { exposed: true } } })",
  obs_extra: "(r) => ({ ...r, effective: { ...r.effective, verification_mode: { exposed: false, value: 'x' } } })",
  effective_extra: "(r) => ({ ...r, effective: { ...r.effective, extra: { exposed: false } } })",
  unknown_status: "(r) => ({ id: r.id, status: 'maybe' })",
};
let fakes = 0;
// shortcut: one SHORTCUTS name applied to every resolved answer; mutate: {kit id: MUTATIONS name}; transport: code run
// after the results are built (it may change `response`, `results` or the exit code, or return before writing).
// The runner sends the cases in plan order, so the fake answers the i-th wire case with the i-th case's real answer,
// after checking its request is that case's (12 requests recur across the two policy suites, so content alone cannot
// tell them apart).
function fake({ shortcut, mutate = {}, transport = "" } = {}) {
  const table = CASES.map((c) => ({ id: c.id, key: keyOf(c.request), expect: c.expect, result: real().get(c.id) }));
  const file = path.join(TMP, `fake-${++fakes}.mjs`);
  fs.writeFileSync(file, `import fs from "node:fs";
import crypto from "node:crypto";
${HELPERS}
const table = ${JSON.stringify(table)};
const mutate = ${JSON.stringify(mutate)};
const M = { ${Object.entries(MUTATIONS).map(([k, f]) => `${JSON.stringify(k)}: ${f}`).join(",\n")} };
const S = ${shortcut ? SHORTCUTS[shortcut] : "null"};
const key = (c) => crypto.createHash("sha256").update(c.bundle_b64 + "\\0" + JSON.stringify(c.policy) + "\\0" + c.verification_time).digest("hex");
const request = JSON.parse(fs.readFileSync(0, "utf8"));
if (request.cases.length !== table.length || request.cases.some((c, i) => key(c) !== table[i].key)) { process.stderr.write("the request is not the plan in order"); process.exit(9); }
let results = request.cases.map((c, i) => {
  const e = table[i];
  let r = { id: c.id, ...structuredClone(e.result) };
  if (S && r.effective && r.effective.verification_mode.exposed && r.effective.resolved_tier.exposed) {
    const p = S({ mode: r.effective.verification_mode.value, tier: r.effective.resolved_tier.value }, c);
    r.effective = { verification_mode: { exposed: true, value: p.mode }, resolved_tier: { exposed: true, value: p.tier } };
  }
  return mutate[e.id] ? M[mutate[e.id]](r, e.expect) : r;
});
let response = { contract: request.contract, run_id: request.run_id, nonce: request.nonce, implementation: { name: "controlled", version: "0" }, results };
${transport}
process.stdout.write(typeof response === "string" ? response : JSON.stringify(response));
`);
  return [process.execPath, file];
}
let reports = 0;
function cli(argv, extra = [], reportInit) {
  const report = path.join(TMP, `report-${++reports}.json`);
  if (reportInit) fs.writeFileSync(report, JSON.stringify(reportInit));
  const r = spawnSync(process.execPath, [CLI, "--catalog", CATALOG, "--report", report, ...extra, "--", ...argv], { encoding: "utf8", timeout: 300000 });
  return { code: r.status, report: JSON.parse(fs.readFileSync(report, "utf8")), stderr: r.stderr };
}
const notPassing = (report) => Object.fromEntries(report.suites.flatMap((s) => s.cases).filter((c) => c.status !== "pass").map((c) => [c.id, `${c.status}:${c.kind}`]));

test("judge: the real TypeScript answers pass through the dispatch of the runner", (t) => {
  if (!available(t, WRAPPERS.ts)) return;
  const r = cli(fake());
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.report.kit.contract, EFFECTIVE_CONTRACT);
  assert.deepEqual(r.report.totals, { cases: 130, executed: 130, pass: 130, fail: 0, error: 0 });
  assert.equal(new Set(CASES.map((c) => keyOf(c.request))).size, 118, "12 requests recur across the two policy suites; the fake answers by position");
});

const T_POS = `${SUITES.coverage}.elevated_payment_hybrid.hybrid_preferred.positive`;
const T_NEG = `${SUITES.policy}.routine_hybrid.classical_only.pq_invalid_bundle`;
const T_OBS = `${SUITES.policy}.classical_only_payment_from_passport_risk_tier_constructor.classical_only`;
const T_PRE = `${SUITES.pre}.intent_payload_hash_wrong`;
const ALL4 = (kind) => ({ [T_POS]: kind, [T_NEG]: kind, [T_OBS]: kind, [T_PRE]: kind });
const FIELD_EXPECT = {
  absent: { [T_POS]: "fail:effective_contradictory", [T_NEG]: "fail:effective_missing" },
  null: { [T_POS]: "fail:effective_contradictory", [T_NEG]: "fail:effective_missing" },
  empty: { [T_POS]: "fail:effective_contradictory", [T_NEG]: "fail:effective_missing" },
  partial: ALL4("fail:effective_partial"),
  number: ALL4("fail:effective_malformed"),
  unknown: ALL4("fail:effective_unknown"),
  contradictory: ALL4("fail:effective_contradictory"),
  wrong: { [T_POS]: "fail:effective_wrong", [T_NEG]: "fail:effective_wrong", [T_OBS]: "fail:effective_wrong" },
  no_effective: ALL4("error:malformed_result"),
  obs_no_value: ALL4("error:malformed_result"),
  obs_extra: ALL4("error:malformed_result"),
  effective_extra: ALL4("error:malformed_result"),
  unknown_status: ALL4("error:malformed_result"),
};
for (const [m, want] of Object.entries(FIELD_EXPECT)) {
  test(`judge: ${m} reported for a positive, a required negative, an observational and a pre-resolution case`, (t) => {
    if (!available(t, WRAPPERS.ts)) return;
    const r = cli(fake({ mutate: { [T_POS]: m, [T_NEG]: m, [T_OBS]: m, [T_PRE]: m } }));
    assert.deepEqual(notPassing(r.report), want);
    assert.equal(r.code, Object.values(want).some((k) => k.startsWith("error")) ? 3 : 1);
  });
}
test("judge: the verdict stays judged first, and verified=true with errors is contradictory", (t) => {
  if (!available(t, WRAPPERS.ts)) return;
  assert.deepEqual(notPassing(cli(fake({ mutate: { [T_POS]: "flip", [T_NEG]: "flip" } })).report), { [T_POS]: "fail:discrepancy", [T_NEG]: "fail:discrepancy" });
  assert.deepEqual(notPassing(cli(fake({ mutate: { [T_POS]: "verified_errors" } })).report), { [T_POS]: "error:contradictory_result" });
});

// What the judge must report for a shortcut, from the real answers: a changed pair fails where it is inconsistent or,
// with an expectation, differs from it; a negative whose control fails is a control_failed error.
function expectedFor(shortcut) {
  const fn = new Function(`${HELPERS}\nreturn ${SHORTCUTS[shortcut]};`)();
  const out = new Map();
  for (const c of CASES) {
    let p = resolvedPair(real().get(c.id).effective);
    if (p) p = fn(p, c.request);
    const e = c.expect.effective;
    const fails = p && (!consistent(p.mode, p.tier) || (c.resolution !== "pre_resolution" && (p.mode !== e.verification_mode || p.tier !== e.resolved_tier)));
    out.set(c.id, fails ? "fail" : "pass");
  }
  // As the runner does: a case whose control did not pass is a control_failed error, also when it failed itself.
  for (const c of CASES) if ((c.controls ?? []).some((k) => out.get(k) !== "pass")) out.set(c.id, "error");
  return Object.fromEntries([...out].filter(([, v]) => v !== "pass"));
}
const MUST_FAIL = {
  policy_mode: [`${SUITES.coverage}.elevated_payment_hybrid.classical_only.positive`, `${SUITES.coverage}.passport_low_standard_hybrid.base_policy.positive`],
  default_mode: [`${SUITES.coverage}.passport_low_routine_hybrid.base_policy.positive`, `${SUITES.coverage}.passport_high_routine_hybrid.base_policy.positive`],
  tier_floor: [`${SUITES.policy}.routine_hybrid.hybrid_required.positive`, `${SUITES.coverage}.elevated_payment_hybrid.pq_only.positive`],
  declared_tier: [`${SUITES.coverage}.payment_declaring_routine_hybrid.classical_only.positive`],
  decision_tier: MODES.map((m) => `${SUITES.coverage}.maximum_risk_800_hybrid.${m}.positive`),
};
for (const s of Object.keys(SHORTCUTS)) {
  test(`judge: a wrapper that reports ${s.replace("_", " ")} instead of the resolved value fails exactly the cases where they differ`, (t) => {
    if (!available(t, WRAPPERS.ts)) return;
    const r = cli(fake({ shortcut: s }));
    const got = Object.fromEntries(Object.entries(notPassing(r.report)).map(([id, k]) => [id, k.split(":")[0]]));
    assert.deepEqual(got, expectedFor(s));
    for (const id of MUST_FAIL[s]) assert.equal(got[id], "fail", id);
    if (s === "decision_tier") assert.deepEqual(Object.keys(got).sort(), [...MUST_FAIL[s]].sort());
  });
}

// ── Transport, through the runner's dispatch for /5 ─────────────

test("transport: no results, invalid output, a stale run, a self-declared identity out of shape, output then a non-zero exit, a timeout", (t) => {
  if (!available(t, WRAPPERS.ts)) return;
  const all = (r, kind) => { assert.equal(r.code, 3, r.stderr); assert.equal(r.report.status, "error"); assert.ok(r.report.suites.flatMap((s) => s.cases).every((c) => c.status === "error" && c.kind === kind), kind); };
  all(cli(fake({ transport: "delete response.results;" })), "invalid_output");
  all(cli(fake({ transport: "response = 'not json';" })), "invalid_output");
  all(cli(fake({ transport: "response.run_id = 'stale';" })), "stale");
  all(cli(fake({ transport: "response.implementation.extra = 'x';" })), "invalid_output");
  all(cli(fake({ transport: "process.exitCode = 1;" })), "process");
  all(cli(fake({ transport: "await new Promise((r) => setTimeout(r, 10000));" }), ["--timeout-ms", "1500"]), "timeout");
});
test("transport: a missing, a duplicate and an extra result", (t) => {
  if (!available(t, WRAPPERS.ts)) return;
  const at = (id) => CASES.findIndex((c) => c.id === id);
  assert.deepEqual(notPassing(cli(fake({ transport: `response.results = results.filter((r, i) => i !== ${at(T_POS)});` })).report), { [T_POS]: "error:missing" });
  assert.deepEqual(notPassing(cli(fake({ transport: `response.results = [...results, results[${at(T_NEG)}]];` })).report), { [T_NEG]: "error:duplicate" });
  const extra = notPassing(cli(fake({ transport: "response.results = [...results, { id: 'not-sent', status: 'unsupported' }];" })).report);
  assert.deepEqual(extra, Object.fromEntries(Object.values(SUITES).map((s) => [`${s}#extra`, "error:extra"])));
});
test("transport: an older passing report is replaced by the new run, and --assessment is refused for /5", (t) => {
  if (!available(t, WRAPPERS.ts)) return;
  const r = cli(fake({ transport: "response = 'not json';" }), [], { kit: { name: "dcp-ai-conformance-external" }, run: { id: "older" }, status: "pass" });
  assert.equal(r.code, 3);
  assert.notEqual(r.report.run.id, "older");
  assert.equal(r.report.status, "error");
  const a = cli(fake(), ["--assessment", "verdict"], { run: { id: "older" }, status: "pass" });
  assert.equal(a.code, 2);
  assert.equal(a.report.status, "error");
  assert.notEqual(a.report.run.id, "older");
});

// ── The five wrappers ───────────────────────────────────────────

const call = (argv, request, env = {}) => {
  const file = path.join(TMP, `call-${++reports}.json`); fs.writeFileSync(file, typeof request === "string" ? request : JSON.stringify(request));
  const fd = fs.openSync(file, "r");
  const r = spawnSync(argv[0], argv.slice(1), { stdio: [fd, "pipe", "pipe"], env: { ...process.env, ...env }, timeout: 120000 });
  fs.closeSync(fd);
  let json = null;
  try { json = JSON.parse(r.stdout.toString("utf8")); } catch { /* checked by the caller */ }
  return { code: r.status, json, stderr: r.stderr.toString("utf8") };
};
const V5 = (cases) => ({ contract: EFFECTIVE_CONTRACT, run_id: "r", nonce: "n", cases });
const positive = BY_ID.get(T_POS); const early = BY_ID.get(T_OBS);
const verifyCase = (id, c) => ({ id, op: "verify_signed_bundle_v2", ...c.request });

for (const [name, w] of Object.entries(WRAPPERS)) {
  test(`${name}: 130/130 under /5, every required mode and tier resolved; one operation; malformed requests refused`, (t) => {
    if (!available(t, w)) return;
    const r = cli(w.argv);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.report.totals, { cases: 130, executed: 130, pass: 130, fail: 0, error: 0 });
    for (const c of r.report.suites.flatMap((s) => s.cases)) if (c.resolution === "required") assert.equal(c.effective.class, "resolved", c.id);
    const one = call(w.argv, V5([{ id: "d", op: "digest", alg: "sha256", input_b64: "" }, verifyCase("v", positive)]));
    assert.equal(one.code, 0, one.stderr);
    assert.deepEqual(one.json.results[0], { id: "d", status: "unsupported" });
    assert.equal(one.json.results[1].status, "ok");
    assert.equal(call(w.argv, V5([{ id: "x", op: "verify_signed_bundle_v2", bundle_b64: 5, policy: {}, verification_time: "2026-10-22T00:00:00Z" }])).code, 2);
  });
}

test("ts: a details value that is not an object is an implementation error, never an unresolved answer", (t) => {
  if (!available(t, WRAPPERS.ts)) return;
  for (const [label, expr] of [["missing", "undefined"], ["null", "null"], ["array", "[]"], ["string", "'x'"]]) {
    const shim = path.join(TMP, `sdk-${label}.mjs`);
    fs.writeFileSync(shim, `export * from ${JSON.stringify(pathToFileURL(TS_SDK).href)};
import { verifySignedBundleV2 as real } from ${JSON.stringify(pathToFileURL(TS_SDK).href)};
export async function verifySignedBundleV2(...a) { const r = await real(...a); const out = { ...r, details: ${expr} }; if (${JSON.stringify(label)} === "missing") delete out.details; return out; }
`);
    const r = call([process.execPath, TS[1], "--sdk", shim], V5([verifyCase("p", positive), verifyCase("e", early)]));
    assert.equal(r.code, 0, r.stderr);
    for (const res of r.json.results) { assert.equal(res.status, "error", label); assert.match(res.message, /not a details object/); }
  }
  const control = call(TS, V5([verifyCase("p", positive), verifyCase("e", early)]));
  assert.deepEqual(control.json.results.map((x) => x.status), ["ok", "ok"]);
  assert.deepEqual(control.json.results[1].effective, { verification_mode: { exposed: false }, resolved_tier: { exposed: false } });
});

test("python: a details value that is not a dict is an implementation error, never an unresolved answer", (t) => {
  if (!available(t, WRAPPERS.python)) return;
  const driver = path.join(TMP, "py-details.py");
  fs.writeFileSync(driver, `import asyncio, importlib.util, json, sys
spec = importlib.util.spec_from_file_location("python_sdk", ${JSON.stringify(path.join(HERE, "wrappers", "python_sdk.py"))})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
import dcp_ai.v2.verify as v
real = v.verify_signed_bundle_v2
mode = sys.argv[1]
async def altered(*a, **k):
    r = await real(*a, **k)
    if mode == "missing": r.pop("details", None)
    else: r["details"] = {"null": None, "array": [], "string": "x", "real": r["details"]}[mode]
    return r
v.verify_signed_bundle_v2 = altered
print(json.dumps([m.run_effective_case(c) for c in json.loads(sys.stdin.read())]))
`);
  const input = [verifyCase("p", positive), verifyCase("e", early)];
  for (const mode of ["missing", "null", "array", "string"]) {
    const r = call([PYTHON, "-I", driver, mode], input);
    assert.equal(r.code, 0, r.stderr);
    for (const res of r.json) { assert.equal(res.status, "error", mode); assert.match(res.message, /not a details dict/); }
  }
  const control = call([PYTHON, "-I", driver, "real"], input);
  assert.deepEqual(control.json.map((x) => x.status), ["ok", "ok"]);
  assert.deepEqual(control.json[1].effective, { verification_mode: { exposed: false }, resolved_tier: { exposed: false } });
});

test("wasm: a result that is not a JSON object is an implementation error", (t) => {
  if (!available(t, WRAPPERS.wasm)) return;
  const pkg = path.join(TMP, "wasm-root-pkg");
  fs.mkdirSync(pkg);
  fs.copyFileSync(path.join(ARTIFACTS.wasm, "dcp_ai_bg.wasm"), path.join(pkg, "dcp_ai_bg.wasm"));
  fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "root-probe", version: "0" }));
  fs.writeFileSync(path.join(pkg, "dcp_ai.js"), `import * as real from ${JSON.stringify(pathToFileURL(path.join(ARTIFACTS.wasm, "dcp_ai.js")).href)};
export default real.default;
export function wasm_verify_signed_bundle_v2() { return "[]"; }
`);
  const r = call([...WRAPPERS.wasm.argv, "--pkg", pkg], V5([verifyCase("p", positive)]));
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.results[0].status, "error");
  assert.match(r.json.results[0].message, /not an object/);
});

test("no wrapper and no kit module names an SDK tier or mode helper (a supplementary guard; the SDK output mutations are the evidence)", () => {
  const helpers = /\b(computeSecurityTier|effectiveVerificationMode|tierToVerificationMode|resolveMode|compute_security_tier|effective_verification_mode|tier_to_verification_mode|ComputeSecurityTier|EffectiveVerificationMode|TierToVerificationMode|wasm_compute_security_tier)\b/;
  for (const f of ["wrappers/ts-sdk.mjs", "wrappers/python_sdk.py", "wrappers/go/main.go", "wrappers/rust/src/main.rs", "wrappers/wasm.mjs", "external-effective.js"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(HERE, f), "utf8"), helpers, f);
  }
});
