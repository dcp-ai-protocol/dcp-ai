// Effective-policy suites of the external kit (contract dcp-ai-conformance-external/5, opt-in through
// tools/conformance/external-effective-policy-catalog.json). Each case is one signed-bundle verification, as in /2,
// and the implementation also reports the verification mode and the security tier its own verifier resolved during
// that verification, copied from its result and never recomputed. The kit judges the verdict and those two values
// against expectations committed in public fixtures and written from spec/DCP-AI-v2.0.md § 14.2 / § 14.3 and
// spec/VERIFICATION.md V2-9. The transport, process handling and limits are those of external.js; the /1–/4 contracts,
// catalogs and modules are not changed. A negative case counts only if its controls passed in the same run.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import {
  REPO_ROOT, LIMITS, UsageError, InfraError, isObj, exactKeys, sha256, utf8, runProcess, runLevel, parseResponse,
} from "./external.js";
import { EVIDENCE_CATALOG_PATH, loadEvidencePlan } from "./external-evidence.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EFFECTIVE_CATALOG_PATH = path.join(HERE, "external-effective-policy-catalog.json");
export const EFFECTIVE_CONTRACT = "dcp-ai-conformance-external/5";
export const EFFECTIVE_TIMEOUT_MS = 300000;
export const MODES = ["classical_only", "hybrid_preferred", "hybrid_required", "pq_only"];
export const TIERS = ["routine", "standard", "elevated", "maximum"];
// spec/DCP-AI-v2.0.md § 14.3: the least mode each tier allows; pq_only stays pq_only whatever the tier.
const FLOOR = { routine: "classical_only", standard: "hybrid_preferred", elevated: "hybrid_required", maximum: "hybrid_required" };
const STRICTNESS = ["classical_only", "hybrid_preferred", "hybrid_required"];
export const consistent = (mode, tier) => mode === "pq_only" || STRICTNESS.indexOf(mode) >= STRICTNESS.indexOf(FLOOR[tier]);

const POLICY_CATALOG_PATH = path.join(HERE, "external-policy-catalog.json");
const SOURCES = {
  policy: "tests/interop/v2/verifier_policy_vectors.json",
  clarification: "tests/interop/v2/verifier_policy_clarification_vectors.json",
  effective: "tests/interop/v2/effective_policy_vectors.json",
};
export const SUITES = {
  policy: "external.v2.effective.verifier_policy",
  clarification: "external.v2.effective.verifier_policy_clarification",
  coverage: "external.v2.effective.coverage",
  pre: "external.v2.effective.pre_resolution",
};
const PRE_RESOLUTION_BASE = "external.v2.bundle_vectors.signed_bundle";
const PRE_RESOLUTION_MUTATIONS = ["dcp_bundle_version_3_0", "intent_payload_hash_wrong", "audit_entries_truncated", "signature_manifest_hash_other"];
const BUNDLE_TIME = "2026-10-22T00:00:00Z";

const need = (cond, msg) => { if (!cond) throw new InfraError(msg); };
const nonEmpty = (v) => typeof v === "string" && v.trim() !== "";
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const readJson = (root, rel) => {
  let buf;
  try { buf = fs.readFileSync(path.join(root, rel)); } catch (e) { throw new InfraError(`required fixture ${rel} is missing or unreadable (${e.code ?? e.message})`); }
  try { return { doc: JSON.parse(utf8(buf)), sha: sha256(buf) }; } catch (e) { throw new InfraError(`required fixture ${rel} is not valid UTF-8 JSON (${e.message})`); }
};
const effectiveOf = (verification_mode, resolved_tier) => ({ verification_mode, resolved_tier });
// A committed mutation may change signatures only: the fields § 14.2 and V2-9 read (the intent and policy-decision
// payloads, the passport risk_tier) stay those of the bundle whose tier the corpus records.
const signatureOnly = (p) => Array.isArray(p) && p.includes("composite_sig");

// Builders: each returns the suite's cases, built from the /2 plans (which check the committed sources and their
// recorded sha256) and the corpora that record each case's tier and effective mode.
function buildSuites(docs, plans, catalogSuites) {
  const fromPlan = (plan, id) => plan.suites.find((s) => s.id === id)?.cases ?? need(false, `the /2 plan has no suite ${id}`);
  const rename = (from, to) => (id) => { need(id.startsWith(`${from}.`), `${id} is not a case of ${from}`); return `${to}.${id.slice(from.length + 1)}`; };
  const P = docs.policy; const Q = docs.clarification; const V = docs.effective;
  return {
    [SUITES.policy]: () => {
      const re = rename("external.v2.verifier_policy", SUITES.policy);
      return fromPlan(plans.policy, "external.v2.verifier_policy").map((c) => {
        const name = c.id.slice("external.v2.verifier_policy.".length);
        const v = P.cases.find((x) => x.name === name);
        need(isObj(v) && nonEmpty(v.effective_mode) && nonEmpty(v.tier), `${SOURCES.policy}: case ${name} records no tier or effective_mode`);
        if (v.mutation !== undefined) { const [k, loc] = String(v.mutation).split("."); need(signatureOnly(P.bundles[v.bundle]?.[k]?.[loc]?.path), `${name}: mutation ${v.mutation} does not touch a signature only`); }
        return { id: re(c.id), source: c.source, op: c.op, request: c.request, expect: { verified: c.expect.verified, effective: effectiveOf(v.effective_mode, v.tier) }, ...(c.controls ? { controls: c.controls.map(re) } : {}) };
      });
    },
    [SUITES.clarification]: () => {
      const re = rename("external.v2.verifier_policy_clarification", SUITES.clarification);
      const tierOf = (bundle) => {
        if (Object.hasOwn(Q.variants ?? {}, bundle)) {
          const v = Q.variants[bundle];
          need(Array.isArray(v?.mutations) && v.mutations.every((m) => signatureOnly(m?.path)), `${SOURCES.clarification}: variant ${bundle} does not change signatures only`);
          return Q.bundles[v.of]?.tier;
        }
        return Q.bundles?.[bundle]?.tier;
      };
      return fromPlan(plans.policy, "external.v2.verifier_policy_clarification").map((c) => {
        const name = c.id.slice("external.v2.verifier_policy_clarification.".length);
        const v = Q.cases.find((x) => x.name === name);
        const tier = isObj(v) ? tierOf(v.bundle) : undefined;
        need(isObj(v) && nonEmpty(v.effective_mode) && nonEmpty(tier), `${SOURCES.clarification}: case ${name} records no effective_mode, or its bundle no tier`);
        return { id: re(c.id), source: c.source, op: c.op, request: c.request, expect: { verified: c.expect.verified, effective: effectiveOf(v.effective_mode, tier) }, ...(c.controls ? { controls: c.controls.map(re) } : {}) };
      });
    },
    [SUITES.coverage]: () => {
      need(isObj(V?.bundles) && Array.isArray(V.cases) && V.cases.length > 0, `${SOURCES.effective}: malformed`);
      const id = (n) => `${SUITES.coverage}.${n}`;
      return V.cases.map((c) => {
        const b = V.bundles[c.bundle];
        need(nonEmpty(c.name) && isObj(b?.signed_bundle) && isObj(c.policy) && nonEmpty(c.verification_time) && typeof c.expect?.verified === "boolean" &&
          exactKeys(c.expect.effective, ["verification_mode", "resolved_tier"]) && c.expect.effective.resolved_tier === b.tier && (c.expect.verified || c.controls?.length > 0),
        `${SOURCES.effective}: case ${c.name} needs a bundle, a policy, a verification_time, expect.verified, expect.effective with its bundle's tier and, if negative, controls`);
        return { id: id(c.name), source: `${SOURCES.effective}#cases/${c.name}`, op: "verify_signed_bundle_v2",
          request: { bundle_b64: b64(JSON.stringify(b.signed_bundle)), policy: c.policy, verification_time: c.verification_time },
          expect: { verified: c.expect.verified, effective: effectiveOf(c.expect.effective.verification_mode, c.expect.effective.resolved_tier) }, ...(c.controls ? { controls: c.controls.map(id) } : {}) };
      });
    },
    [SUITES.pre]: () => {
      const s = catalogSuites.find((x) => x.id === SUITES.pre);
      const control = s?.control_effective;
      need(exactKeys(control, ["verification_mode", "resolved_tier", "basis"]) && nonEmpty(control.basis), `${SUITES.pre}: the catalog needs control_effective {verification_mode, resolved_tier, basis}`);
      const cases = fromPlan(plans.evidence, "external.v2.bundle_vectors");
      const base = cases.find((c) => c.id === PRE_RESOLUTION_BASE);
      need(base && base.expect.verified === true && base.request.verification_time === BUNDLE_TIME, `${PRE_RESOLUTION_BASE} is missing or not a positive at ${BUNDLE_TIME}`);
      const out = [{ id: `${SUITES.pre}.signed_bundle`, source: base.source, op: base.op, request: base.request, expect: { verified: true, effective: effectiveOf(control.verification_mode, control.resolved_tier) } }];
      for (const n of PRE_RESOLUTION_MUTATIONS) {
        const c = cases.find((x) => x.id === `external.v2.bundle_vectors.must_reject.${n}`);
        need(c && c.expect.verified === false, `external.v2.bundle_vectors.must_reject.${n} is missing or not a rejection`);
        out.push({ id: `${SUITES.pre}.${n}`, source: c.source, op: c.op, request: c.request, expect: { verified: false }, controls: [`${SUITES.pre}.signed_bundle`] });
      }
      return out;
    },
  };
}

// The /2 plans give the committed bundles, policies and verdicts (and check the recorded sha256 of every reference).
function loadInputs(root) {
  const plans = { policy: loadEvidencePlan({ root, catalogFile: POLICY_CATALOG_PATH }), evidence: loadEvidencePlan({ root, catalogFile: EVIDENCE_CATALOG_PATH, select: ["external.v2.bundle_vectors"] }) };
  const docs = {}; const fixtures = { ...plans.policy.fixtures, ...plans.evidence.fixtures };
  for (const [k, rel] of Object.entries(SOURCES)) { const { doc, sha } = readJson(root, rel); docs[k] = doc; fixtures[rel] = sha; }
  fixtures[path.relative(REPO_ROOT, POLICY_CATALOG_PATH)] = plans.policy.catalog.sha256;
  fixtures[path.relative(REPO_ROOT, EVIDENCE_CATALOG_PATH)] = plans.evidence.catalog.sha256;
  return { docs, plans, fixtures };
}

/** The cases each suite builds from the committed fixtures (for the catalog builder): {suite id: cases}. */
export function producedEffectiveCases(root = REPO_ROOT, catalogSuites = []) {
  const { docs, plans } = loadInputs(root);
  return Object.fromEntries(Object.entries(buildSuites(docs, plans, catalogSuites)).map(([id, b]) => [id, b()]));
}

export function loadEffectivePlan({ root = REPO_ROOT, catalogFile = EFFECTIVE_CATALOG_PATH, select } = {}) {
  let raw;
  try { raw = fs.readFileSync(catalogFile); } catch (e) { throw new InfraError(`catalog ${catalogFile} is unreadable (${e.code ?? e.message})`); }
  let cat;
  try { cat = JSON.parse(utf8(raw)); } catch (e) { throw new InfraError(`catalog ${catalogFile} is not valid UTF-8 JSON (${e.message})`); }
  const isText = (v) => typeof v === "string" && v.trim() !== "";
  const textList = (v) => Array.isArray(v) && v.every(isText);
  need(exactKeys(cat, ["contract", "catalog_version", "suites"], ["limits"]) && cat.contract === EFFECTIVE_CONTRACT && isText(cat.catalog_version), `invalid catalog: needs contract ${EFFECTIVE_CONTRACT}, catalog_version and suites`);
  need(Array.isArray(cat.suites) && cat.suites.length > 0 && (cat.limits === undefined || textList(cat.limits)), "invalid catalog: suites and limits");
  for (const s of cat.suites) {
    need(exactKeys(s, ["id", "title", "claim", "expected_cases"], ["limits", "observational_cases", "observational_basis", "pre_resolution_cases", "control_effective"]) &&
      isText(s.id) && isText(s.title) && isText(s.claim) && textList(s.expected_cases) && s.expected_cases.length > 0 && (s.limits === undefined || textList(s.limits)) &&
      (s.observational_cases === undefined || (textList(s.observational_cases) && isText(s.observational_basis))) && (s.pre_resolution_cases === undefined || textList(s.pre_resolution_cases)),
    "invalid catalog: every suite needs id, title, claim and non-empty expected_cases; observational_cases need an observational_basis");
  }
  const { docs, plans, fixtures } = loadInputs(root);
  const builders = buildSuites(docs, plans, cat.suites);
  const ids = new Set();
  const suites = cat.suites.map((s) => {
    need(builders[s.id], `invalid catalog: unknown suite ${s.id}`);
    for (const id of [s.id, ...s.expected_cases]) { need(!ids.has(id), `invalid catalog: duplicate id ${id}`); ids.add(id); }
    let cases;
    try { cases = builders[s.id](); } catch (e) { if (e instanceof InfraError) throw e; throw new InfraError(`fixture for ${s.id} is malformed (${e.message})`); }
    const produced = cases.map((c) => c.id);
    need(new Set(produced).size === produced.length, `${s.id}: duplicate case produced`);
    const missing = s.expected_cases.filter((id) => !produced.includes(id));
    const extra = produced.filter((id) => !s.expected_cases.includes(id));
    need(missing.length === 0 && extra.length === 0, `${s.id}: fixtures and catalog disagree (missing ${missing.join(", ") || "none"}; extra ${extra.join(", ") || "none"})`);
    const obs = new Set(s.observational_cases ?? []); const pre = new Set(s.pre_resolution_cases ?? []);
    need(obs.size === (s.observational_cases ?? []).length && pre.size === (s.pre_resolution_cases ?? []).length, `${s.id}: an observational or pre-resolution id is listed twice`);
    for (const id of [...obs, ...pre]) need(produced.includes(id), `${s.id}: ${id} is not a case of the suite`);
    for (const id of obs) need(!pre.has(id), `${s.id}: ${id} is both observational and pre-resolution`);
    for (const c of cases) {
      c.resolution = obs.has(c.id) ? "observational" : pre.has(c.id) ? "pre_resolution" : "required";
      const e = c.expect.effective;
      if (c.resolution === "pre_resolution") need(e === undefined && c.expect.verified === false, `${c.id}: a pre-resolution case is a rejection with no expected mode or tier`);
      else need(exactKeys(e, ["verification_mode", "resolved_tier"]) && MODES.includes(e.verification_mode) && TIERS.includes(e.resolved_tier) && consistent(e.verification_mode, e.resolved_tier),
        `${c.id}: the expected mode and tier must be known and consistent`);
      need(c.expect.verified === false || c.resolution === "required", `${c.id}: a case expected to verify must require the resolved mode and tier`);
      for (const k of c.controls ?? []) need(produced.includes(k) && k !== c.id, `${c.id}: control ${k} is not another case of the suite`);
    }
    // A control is a plain positive: expected to verify, its mode and tier required, no controls of its own, so negatives
    // can never establish each other's validity.
    const byId = new Map(cases.map((c) => [c.id, c]));
    for (const c of cases) for (const k of c.controls ?? []) {
      const t = byId.get(k);
      need(t.expect.verified === true && t.resolution === "required" && t.controls === undefined, `${c.id}: control ${k} must be a positive that requires its mode and tier and has no controls`);
    }
    return { id: s.id, title: s.title, claim: s.claim, limits: s.limits ?? [], cases };
  });
  let selected = suites;
  if (select !== undefined && select.length > 0) {
    const seen = new Set();
    for (const id of select) {
      if (typeof id !== "string" || id.trim() === "") throw new UsageError("empty suite id");
      if (seen.has(id)) throw new UsageError(`suite ${id} selected twice`);
      if (!suites.some((s) => s.id === id)) throw new UsageError(`unknown suite ${id} (see --list)`);
      seen.add(id);
    }
    selected = select.map((id) => suites.find((s) => s.id === id));
  }
  need(selected.reduce((n, s) => n + s.cases.length, 0) > 0, "the selection has no case");
  return { catalog: { version: cat.catalog_version, sha256: sha256(raw), limits: cat.limits ?? [], contract: EFFECTIVE_CONTRACT }, fixtures, suites: selected };
}

// ── Judgement ──
// One reported field: {"exposed": false} or {"exposed": true, "value": <JSON>}. Its class keeps every distinction:
// absent, null, empty (""), known, unknown (another string) or malformed (not a string).
function fieldClass(o, allowed) {
  if (!o.exposed) return "absent";
  if (o.value === null) return "null";
  if (typeof o.value !== "string") return "malformed";
  if (o.value === "") return "empty";
  return allowed.includes(o.value) ? "known" : "unknown";
}
const UNRESOLVED = new Set(["absent", "null", "empty"]);
function pairClass(fields) {
  const v = Object.values(fields);
  if (v.includes("malformed")) return "malformed";
  if (v.includes("unknown")) return "unknown";
  if (v.every((f) => f === "known")) return "resolved";
  if (v.every((f) => UNRESOLVED.has(f))) return "unresolved";
  return "partial";
}
const validObs = (o) => (exactKeys(o, ["exposed"]) && o.exposed === false) || (exactKeys(o, ["exposed", "value"]) && o.exposed === true);

function judge(c, results) {
  if (results.length === 0) return { status: "error", kind: "missing", message: "no result for this case" };
  if (results.length > 1) return { status: "error", kind: "duplicate", message: `${results.length} results for this case` };
  const r = results[0];
  if (r.status === "error") return exactKeys(r, ["id", "status", "message"]) && typeof r.message === "string" ? { status: "error", kind: "implementation", message: r.message.slice(0, 500) } : { status: "error", kind: "malformed_result", message: "error needs a message" };
  if (r.status === "unsupported") return exactKeys(r, ["id", "status"]) ? { status: "error", kind: "unsupported", message: `${c.op} is not supported by the implementation` } : { status: "error", kind: "malformed_result", message: "unsupported takes no other field" };
  if (r.status === "rejected") {
    if (!exactKeys(r, ["id", "status", "code"]) || r.code !== "parse") return { status: "error", kind: "malformed_result", message: `a rejection of ${c.op} is code parse` };
    return { status: "fail", kind: "discrepancy", message: "rejected a committed input as unparseable" };
  }
  if (r.status !== "ok" || !exactKeys(r, ["id", "status", "verified", "errors", "effective"])) return { status: "error", kind: "malformed_result", message: "an ok result has exactly id, status, verified, errors and effective" };
  if (typeof r.verified !== "boolean" || !Array.isArray(r.errors) || !r.errors.every((e) => typeof e === "string")) return { status: "error", kind: "malformed_result", message: "verified is a boolean and errors an array of strings" };
  if (!exactKeys(r.effective, ["verification_mode", "resolved_tier"]) || !validObs(r.effective.verification_mode) || !validObs(r.effective.resolved_tier)) {
    return { status: "error", kind: "malformed_result", message: 'effective has exactly verification_mode and resolved_tier, each {"exposed": false} or {"exposed": true, "value": <JSON>}' };
  }
  const fields = { verification_mode: fieldClass(r.effective.verification_mode, MODES), resolved_tier: fieldClass(r.effective.resolved_tier, TIERS) };
  const cls = pairClass(fields);
  const effective = { class: cls, fields, observed: r.effective };
  const got = cls === "resolved" ? effectiveOf(r.effective.verification_mode.value, r.effective.resolved_tier.value) : null;
  const show = (e) => `${e.verification_mode}/${e.resolved_tier}`;
  if (r.verified && r.errors.length > 0) return { status: "error", kind: "contradictory_result", message: `verified=true with errors: ${JSON.stringify(r.errors).slice(0, 300)}`, effective };
  if (r.verified !== c.expect.verified) return { status: "fail", kind: "discrepancy", message: `verified=${r.verified}, expected ${c.expect.verified}: ${JSON.stringify(r.errors).slice(0, 300)}`, effective };
  // The reported values, whatever the case: never malformed, unknown, partial or inconsistent.
  if (cls === "malformed") return { status: "fail", kind: "effective_malformed", message: `a reported value is not a string or null: ${JSON.stringify(r.effective).slice(0, 300)}`, effective };
  if (cls === "unknown") return { status: "fail", kind: "effective_unknown", message: `a reported value is outside the modes or tiers: ${JSON.stringify(r.effective).slice(0, 300)}`, effective };
  if (cls === "partial") return { status: "fail", kind: "effective_partial", message: `one of the mode and the tier is resolved, the other is not (${fields.verification_mode}/${fields.resolved_tier})`, effective };
  if (cls === "resolved" && !consistent(got.verification_mode, got.resolved_tier)) return { status: "fail", kind: "effective_contradictory", message: `mode ${got.verification_mode} is below the floor of tier ${got.resolved_tier}`, effective };
  if (r.verified && cls !== "resolved") return { status: "fail", kind: "effective_contradictory", message: `verified=true without a resolved mode and tier (${fields.verification_mode}/${fields.resolved_tier})`, effective };
  if (c.resolution === "required" && cls !== "resolved") return { status: "fail", kind: "effective_missing", message: `no resolved mode and tier (${fields.verification_mode}/${fields.resolved_tier}), expected ${show(c.expect.effective)}`, effective };
  if (c.resolution !== "pre_resolution" && cls === "resolved" && (got.verification_mode !== c.expect.effective.verification_mode || got.resolved_tier !== c.expect.effective.resolved_tier)) {
    return { status: "fail", kind: "effective_wrong", message: `reported ${show(got)}, expected ${show(c.expect.effective)}`, effective };
  }
  return { status: "pass", effective };
}

/** Runs the effective-policy plan against argv and returns the report (status pass, fail or error). */
export async function runEffective({ plan, argv, timeoutMs = EFFECTIVE_TIMEOUT_MS, run = { id: crypto.randomUUID(), started_at: new Date().toISOString() } }) {
  const nonce = crypto.randomBytes(16).toString("hex");
  const sent = [];
  for (const s of plan.suites) for (const c of s.cases) sent.push({ wire: crypto.randomBytes(8).toString("hex"), c, suite: s.id });
  const request = { contract: EFFECTIVE_CONTRACT, run_id: run.id, nonce, cases: sent.map(({ wire, c }) => ({ id: wire, op: c.op, ...c.request })) };
  const requestBytes = Buffer.from(JSON.stringify(request), "utf8");
  const { stdout, observed } = await runProcess(argv, requestBytes, { timeoutMs, limits: LIMITS });
  let fatal = runLevel(observed);
  let implementation = null;
  const byWire = new Map(sent.map((x) => [x.wire, []]));
  let extra = 0;
  if (!fatal) {
    const parsed = parseResponse(stdout, request);
    implementation = parsed.implementation ?? parsed.doc?.implementation ?? null;
    if (parsed.error) fatal = parsed.error;
    else for (const r of parsed.doc.results) { if (isObj(r) && typeof r.id === "string" && byWire.has(r.id)) byWire.get(r.id).push(r); else extra++; }
  }
  const outcome = new Map(sent.map(({ wire, c }) => [c.id, fatal ? { status: "error", ...fatal } : judge(c, byWire.get(wire))]));
  // A negative counts only if its controls passed in the same run.
  for (const { c } of sent) {
    const failed = (c.controls ?? []).filter((k) => outcome.get(k)?.status !== "pass");
    if (failed.length && outcome.get(c.id).status !== "error") {
      const { effective } = outcome.get(c.id);
      outcome.set(c.id, { status: "error", kind: "control_failed", message: `control(s) did not pass: ${failed.slice(0, 5).join(", ")}${failed.length > 5 ? ", …" : ""}`, ...(effective ? { effective } : {}) });
    }
  }
  const report = {
    kit: { name: "dcp-ai-conformance-external", contract: EFFECTIVE_CONTRACT, catalog_version: plan.catalog.version, catalog_sha256: plan.catalog.sha256, fixtures_sha256: plan.fixtures },
    run: { id: run.id, nonce, started_at: run.started_at, finished_at: new Date().toISOString(), node: process.version, request_sha256: sha256(requestBytes), timeout_ms: timeoutMs },
    implementation: { argv, self_declared: implementation, observed },
    selection: plan.suites.map((s) => s.id),
    status: "incomplete",
    totals: { cases: 0, executed: 0, pass: 0, fail: 0, error: 0 },
    effective_totals: { resolved: 0, unresolved: 0, partial: 0, unknown: 0, malformed: 0, not_received: 0 },
    suites: [],
    limits: plan.catalog.limits,
  };
  for (const s of plan.suites) {
    const cases = sent.filter((x) => x.suite === s.id).map(({ c }) => {
      const { effective, ...o } = outcome.get(c.id);
      report.effective_totals[effective?.class ?? "not_received"]++;
      return {
        id: c.id, op: c.op, source: c.source, input_sha256: sha256(Buffer.from(JSON.stringify(c.request), "utf8")), resolution: c.resolution,
        ...(c.controls ? { controls: c.controls } : {}), expect: c.expect, ...o, effective: effective ?? null,
      };
    });
    if (!fatal && extra > 0) cases.push({ id: `${s.id}#extra`, status: "error", kind: "extra", message: `${extra} result(s) with an id that was not sent` });
    const totals = { cases: cases.length, executed: 0, pass: 0, fail: 0, error: 0 };
    for (const r of cases) { totals[r.status]++; if (r.status !== "error") totals.executed++; }
    const status = totals.error ? "error" : totals.fail ? "fail" : "pass";
    report.suites.push({ id: s.id, title: s.title, claim: s.claim, limits: s.limits, status, totals, cases });
    for (const k of Object.keys(totals)) report.totals[k] += totals[k];
  }
  report.status = report.totals.error || report.totals.executed === 0 ? "error" : report.totals.fail ? "fail" : "pass";
  return report;
}
