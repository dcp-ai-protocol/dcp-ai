// Evidence suites of the external kit (contract dcp-ai-conformance-external/2, opt-in through
// tools/conformance/external-evidence-catalog.json): exact dual Merkle roots, composite signature verification
// and normative V2 signed-bundle verification, built from committed public fixtures only. The transport,
// process handling, limits and response envelope are those of external.js; nothing here generates keys or
// signs. A negative case names its control: it passes only if that control passed in the same run.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import {
  REPO_ROOT, LIMITS, UsageError, InfraError, isObj, exactKeys, sha256, utf8, runProcess, runLevel, parseResponse,
} from "./external.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EVIDENCE_CATALOG_PATH = path.join(HERE, "external-evidence-catalog.json");
export const EVIDENCE_CONTRACT = "dcp-ai-conformance-external/2";
export const EVIDENCE_TIMEOUT_MS = 300000;
const HEX64 = /^[0-9a-f]{64}$/;
const BUNDLE_TIME = "2026-10-22T00:00:00Z"; // inside the window of the base bundle and of every bundle expected to verify; some negatives are expired or not yet valid on purpose
const FIXTURES = {
  merkle: "tests/conformance/v2/merkle_vectors.json",
  interop: "tests/interop/v2/interop_vectors.json",
  bundles: "tests/interop/v2/bundle_vectors.json",
  secondary: "tests/interop/v2/secondary_sha3_vectors.json",
};

const need = (cond, msg) => { if (!cond) throw new InfraError(msg); };
const isHex64 = (v) => typeof v === "string" && HEX64.test(v);
const nonEmpty = (v) => typeof v === "string" && v.trim() !== "";
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const flipLastByte = (sigB64) => { const b = Buffer.from(sigB64, "base64"); b[b.length - 1] ^= 0x01; return b.toString("base64"); };

// Changes the last character of the first string value of a canonical JSON text, so the text stays valid,
// canonical JSON (same keys, same order, no escape introduced) while the signed content differs.
function alterFirstStringValue(canonical) {
  const m = /:"([^"\\]+)"/.exec(canonical);
  need(m, "no string value to alter in the payload");
  const last = m[1].at(-1);
  const other = last === "a" ? "b" : last === "0" ? "1" : /[A-Za-z0-9]/.test(last) ? (last === "b" ? "c" : "a") : "a";
  const at = m.index + 2 + m[1].length - 1;
  return canonical.slice(0, at) + other + canonical.slice(at + 1);
}

function mutated(signed, mutations) {
  const out = structuredClone(signed);
  for (const { path: p, value } of mutations) {
    let node = out;
    for (const k of p.slice(0, -1)) node = node[k];
    node[p.at(-1)] = value;
  }
  return out;
}

const modePolicy = (base, mode) => ({ ...base, default_mode: mode, risk_overrides: { low: mode, medium: mode, high: mode } });
// `controls`: the ids that must pass in the same run for this negative to count.
const verifyCase = (id, source, signed, policy, time, expect, controls) => ({
  id, source, op: "verify_signed_bundle_v2", request: { bundle_b64: b64(JSON.stringify(signed)), policy, verification_time: time }, expect, ...(controls ? { controls } : {}),
});

const BUILDERS = {
  "external.merkle.dual_root": ({ merkle }) => {
    need(Array.isArray(merkle.cases) && merkle.cases.length > 0, `${FIXTURES.merkle}: cases missing`);
    return merkle.cases.map((c) => {
      need(nonEmpty(c.name) && Array.isArray(c.leaves) && c.leaves.length > 0 && c.leaves.every((l) => exactKeys(l, ["sha256", "sha3_256"]) && isHex64(l.sha256) && isHex64(l.sha3_256)), `merkle ${c.name}: malformed leaves`);
      need(exactKeys(c.expected, ["sha256", "sha3_256"]) && isHex64(c.expected.sha256) && isHex64(c.expected.sha3_256), `merkle ${c.name}: malformed expected roots`);
      return { id: `external.merkle.dual_root.${c.name}`, source: `${FIXTURES.merkle}#cases/${c.name}`, op: "dual_merkle_root", request: { leaves: c.leaves }, expect: { roots: c.expected } };
    });
  },
  "external.signature.composite": ({ interop }) => {
    const ed = interop.test_keys?.ed25519?.public_key_b64;
    const pq = interop.test_keys?.ml_dsa_65?.public_key_b64;
    need(typeof ed === "string" && typeof pq === "string", `${FIXTURES.interop}: public test keys missing`);
    const payload = (key) => { const p = interop.canonicalization?.[key]?.expected_canonical; need(typeof p === "string", `no canonical payload ${key}`); return p; };
    const req = (context, text, sig, pqKey) => ({ context, payload_b64: b64(text), composite_sig: sig, classical_public_key_b64: ed, pq_public_key_b64: pqKey });
    const out = [];
    const positives = [
      ...Object.entries(interop.composite_signatures ?? {}).map(([n, v]) => [n, v, true]),
      ...Object.entries(interop.classical_only_signatures ?? {}).map(([n, v]) => [n, v, false]),
    ];
    need(positives.length === 4, "expected 3 composite and 1 classical-only committed signature");
    const contexts = ["DCP-AI.v2.AgentPassport", "DCP-AI.v2.Intent", "DCP-AI.v2.AuditEvent"];
    const positiveFor = {};
    for (const [name, v, composite] of positives) {
      const id = `external.signature.composite.${name}`;
      const text = payload(v.payload_key);
      const pqKey = composite ? pq : null;
      const source = `${FIXTURES.interop}#${composite ? "composite_signatures" : "classical_only_signatures"}/${name}`;
      positiveFor[v.payload_key] ??= composite ? id : undefined;
      out.push({ id, source, op: "composite_verify", request: req(v.context, text, v.composite_sig, pqKey), expect: composite ? { valid: true, classical_valid: true, pq_valid: true } : { valid: true, classical_valid: true } });
      const sig = (f) => { const s = structuredClone(v.composite_sig); f(s); return s; };
      out.push({ id: `${id}.altered_classical_sig`, source: `${source} (altered classical sig)`, op: "composite_verify", controls: [id], request: req(v.context, text, sig((s) => { s.classical.sig_b64 = flipLastByte(s.classical.sig_b64); }), pqKey), expect: { valid: false, classical_valid: false } });
      if (composite) out.push({ id: `${id}.altered_pq_sig`, source: `${source} (altered pq sig)`, op: "composite_verify", controls: [id], request: req(v.context, text, sig((s) => { s.pq.sig_b64 = flipLastByte(s.pq.sig_b64); }), pqKey), expect: { valid: false, pq_valid: false } });
      out.push({ id: `${id}.altered_payload`, source: `${source} (altered payload)`, op: "composite_verify", controls: [id], request: req(v.context, alterFirstStringValue(text), v.composite_sig, pqKey), expect: composite ? { valid: false, classical_valid: false, pq_valid: false } : { valid: false, classical_valid: false } });
      out.push({ id: `${id}.altered_context`, source: `${source} (altered context)`, op: "composite_verify", controls: [id], request: req(contexts.find((c) => c !== v.context), text, v.composite_sig, pqKey), expect: { valid: false } });
    }
    // Attacks: only the fields each fixture commits are judged. stripping_pq_with_downgrade commits
    // classical_valid=true and pq_valid=false; its rejection belongs to a hybrid_required policy, not here.
    for (const [name, a] of Object.entries(interop.attack_vectors ?? {})) {
      const expect = Object.fromEntries(["valid", "classical_valid", "pq_valid"].filter((f) => typeof a[`expected_${f}`] === "boolean").map((f) => [f, a[`expected_${f}`]]));
      need(Object.keys(expect).length > 0, `attack ${name}: no committed expectation`);
      need(positiveFor[a.payload_key], `attack ${name}: no committed composite positive for ${a.payload_key}`);
      // DR2: only a case that commits valid=false alone, for a pq_over_classical signature whose PQ part is
      // absent, may also pass as rejected(missing_pq_signature).
      if (Object.keys(expect).join() === "valid" && expect.valid === false && a.composite_sig?.binding === "pq_over_classical" && a.composite_sig?.pq == null) {
        expect.missing_pq_rejection_allowed = true;
      }
      out.push({ id: `external.signature.composite.attack.${name}`, source: `${FIXTURES.interop}#attack_vectors/${name}`, op: "composite_verify", controls: [positiveFor[a.payload_key]], request: req(a.verify_context ?? a.context, payload(a.payload_key), a.composite_sig, pq), expect });
    }
    return out;
  },
  "external.v2.bundle_vectors": ({ bundles: B }) => {
    need(isObj(B.signed_bundle) && isObj(B.default_verifier_policy), `${FIXTURES.bundles}: signed_bundle or default policy missing`);
    const policy = B.default_verifier_policy;
    need(Array.isArray(B.must_reject) && Array.isArray(B.must_accept_bundles) && Array.isArray(B.must_reject_bundles) && isObj(B.classical_only_routine_bundle?.verified_by_mode), `${FIXTURES.bundles}: collections missing`);
    const src = (p) => `${FIXTURES.bundles}#${p}`;
    const base = "external.v2.bundle_vectors.signed_bundle";
    const out = [verifyCase(base, src("signed_bundle"), B.signed_bundle, policy, BUNDLE_TIME, { verified: true })];
    const overrides = (c) => { need(c.verifier_policy_overrides === undefined || isObj(c.verifier_policy_overrides), `${c.name}: verifier_policy_overrides must be an object`); return { ...policy, ...(c.verifier_policy_overrides ?? {}) }; };
    for (const c of B.must_reject) {
      need(nonEmpty(c.name) && nonEmpty(c.error_contains) && Array.isArray(c.mutations) && c.mutations.length > 0, `must_reject ${c.name}: needs a name, a non-empty error_contains and mutations`);
      out.push(verifyCase(`external.v2.bundle_vectors.must_reject.${c.name}`, src(`must_reject/${c.name}`), mutated(B.signed_bundle, c.mutations), policy, BUNDLE_TIME, { verified: false, error_contains: c.error_contains }, [base]));
    }
    const accepted = [base];
    for (const c of B.must_accept_bundles) {
      need(nonEmpty(c.name) && isObj(c.signed_bundle), `must_accept ${c.name}: needs a name and a signed_bundle`);
      const id = `external.v2.bundle_vectors.must_accept.${c.name}`;
      accepted.push(id);
      out.push(verifyCase(id, src(`must_accept_bundles/${c.name}`), c.signed_bundle, overrides(c), BUNDLE_TIME, { verified: true }));
    }
    // Separately built bundles with no per-case positive twin: gated on the base and every committed positive
    // of the same generator (a suite-level control, a weaker guarantee), plus their specific error_contains.
    for (const c of B.must_reject_bundles) {
      need(nonEmpty(c.name) && nonEmpty(c.error_contains) && isObj(c.signed_bundle), `must_reject_bundles ${c.name}: needs a name, a non-empty error_contains and a signed_bundle`);
      out.push(verifyCase(`external.v2.bundle_vectors.must_reject_bundles.${c.name}`, src(`must_reject_bundles/${c.name}`), c.signed_bundle, overrides(c), BUNDLE_TIME, { verified: false, error_contains: c.error_contains }, accepted));
    }
    const modes = Object.entries(B.classical_only_routine_bundle.verified_by_mode);
    need(modes.every(([, v]) => typeof v === "boolean") && modes.some(([, v]) => v), "classical_only_routine_bundle.verified_by_mode must hold booleans, at least one true");
    const okMode = `external.v2.bundle_vectors.classical_only_routine.${modes.find(([, v]) => v)[0]}`;
    for (const [mode, verified] of modes) {
      out.push(verifyCase(`external.v2.bundle_vectors.classical_only_routine.${mode}`, src(`classical_only_routine_bundle (mode ${mode})`), B.classical_only_routine_bundle.signed_bundle, modePolicy(policy, mode), BUNDLE_TIME, { verified }, verified ? undefined : [okMode]));
    }
    return out;
  },
  "external.v2.secondary_sha3": ({ secondary: V, bundles: B }) => {
    need(Array.isArray(V.cases) && isObj(V.base?.artifacts) && typeof V.verification_time === "string", `${FIXTURES.secondary}: malformed`);
    const assemble = (p) => ({ bundle: { dcp_bundle_version: "2.0", manifest: p.manifest, ...V.base.artifacts, audit_entries: p.audit_entries }, signature: p.signature });
    const out = [];
    for (const c of V.cases) {
      const id = `external.v2.secondary_sha3.${c.name}`;
      const source = `${FIXTURES.secondary}#cases/${c.name}`;
      need(nonEmpty(c.name), "secondary: a case needs a name");
      if (c.expect === "accept") { out.push(verifyCase(id, source, assemble(c), B.default_verifier_policy, V.verification_time, { verified: true })); continue; }
      need(c.expect === "reject" && isObj(c.control) && nonEmpty(c.error_contains), `secondary ${c.name}: needs expect, a control and a non-empty error_contains`);
      out.push(verifyCase(`${id}.control`, `${source}/control`, assemble(c.control), B.default_verifier_policy, V.verification_time, { verified: true }));
      out.push(verifyCase(id, source, assemble(c), B.default_verifier_policy, V.verification_time, { verified: false, error_contains: c.error_contains }, [`${id}.control`]));
    }
    return out;
  },
};

/** Loads the evidence catalog and fixtures; every suite must produce exactly the case ids it pins. */
export function loadEvidencePlan({ root = REPO_ROOT, catalogFile = EVIDENCE_CATALOG_PATH, select } = {}) {
  let raw;
  try { raw = fs.readFileSync(catalogFile); } catch (e) { throw new InfraError(`catalog ${catalogFile} is unreadable (${e.code ?? e.message})`); }
  let cat;
  try { cat = JSON.parse(utf8(raw)); } catch (e) { throw new InfraError(`catalog ${catalogFile} is not valid UTF-8 JSON (${e.message})`); }
  const isText = (v) => typeof v === "string" && v.trim() !== "";
  need(exactKeys(cat, ["contract", "catalog_version", "suites"], ["limits"]) && cat.contract === EVIDENCE_CONTRACT && isText(cat.catalog_version), `invalid catalog: needs contract ${EVIDENCE_CONTRACT}, catalog_version and suites`);
  need(Array.isArray(cat.suites) && cat.suites.length > 0 && (cat.limits === undefined || (Array.isArray(cat.limits) && cat.limits.every(isText))), "invalid catalog: suites and limits");
  const fixtures = {};
  const docs = {};
  for (const [k, rel] of Object.entries(FIXTURES)) {
    let buf;
    try { buf = fs.readFileSync(path.join(root, rel)); } catch (e) { throw new InfraError(`required fixture ${rel} is missing or unreadable (${e.code ?? e.message})`); }
    try { docs[k] = JSON.parse(utf8(buf)); } catch (e) { throw new InfraError(`required fixture ${rel} is not valid UTF-8 JSON (${e.message})`); }
    fixtures[rel] = sha256(buf);
  }
  const ids = new Set();
  const suites = cat.suites.map((s) => {
    need(exactKeys(s, ["id", "title", "claim", "expected_cases"], ["limits"]) && isText(s.id) && isText(s.title) && isText(s.claim) &&
      Array.isArray(s.expected_cases) && s.expected_cases.length > 0 && s.expected_cases.every(isText) && (s.limits === undefined || (Array.isArray(s.limits) && s.limits.every(isText))), "invalid catalog: every suite needs id, title, claim and non-empty expected_cases");
    need(BUILDERS[s.id], `invalid catalog: unknown suite ${s.id}`);
    for (const id of [s.id, ...s.expected_cases]) { need(!ids.has(id), `invalid catalog: duplicate id ${id}`); ids.add(id); }
    let cases;
    try { cases = BUILDERS[s.id](docs); } catch (e) { if (e instanceof InfraError) throw e; throw new InfraError(`fixture for ${s.id} is malformed (${e.message})`); }
    const produced = cases.map((c) => c.id);
    need(new Set(produced).size === produced.length, `${s.id}: duplicate case produced`);
    const missing = s.expected_cases.filter((id) => !produced.includes(id));
    const extra = produced.filter((id) => !s.expected_cases.includes(id));
    need(missing.length === 0 && extra.length === 0, `${s.id}: fixtures and catalog disagree (missing ${missing.join(", ") || "none"}; extra ${extra.join(", ") || "none"})`);
    for (const c of cases) for (const k of c.controls ?? []) need(produced.includes(k) && k !== c.id, `${c.id}: control ${k} is not another case of the suite`);
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
  return { catalog: { version: cat.catalog_version, sha256: sha256(raw), limits: cat.limits ?? [], contract: EVIDENCE_CONTRACT }, fixtures, suites: selected };
}

const RESULT_FIELDS = {
  dual_merkle_root: ["sha256", "sha3_256"],
  composite_verify: ["valid", "classical_valid", "pq_valid"],
  verify_signed_bundle_v2: ["verified", "errors"],
};

function judge(c, results) {
  if (results.length === 0) return { status: "error", kind: "missing", message: "no result for this case" };
  if (results.length > 1) return { status: "error", kind: "duplicate", message: `${results.length} results for this case` };
  const r = results[0];
  if (r.status === "error") return exactKeys(r, ["id", "status", "message"]) && typeof r.message === "string" ? { status: "error", kind: "implementation", message: r.message.slice(0, 500) } : { status: "error", kind: "malformed_result", message: "error needs a message" };
  if (r.status === "unsupported") return exactKeys(r, ["id", "status"]) ? { status: "error", kind: "unsupported", message: `${c.op} is not supported by the implementation` } : { status: "error", kind: "malformed_result", message: "unsupported takes no other field" };
  if (r.status === "rejected") {
    // missing_pq_signature: an SDK whose composite verification reports an absent PQ signature under a
    // pq_over_classical binding as an error (Rust, WASM). It passes only on the case built for it (DR2).
    const codes = c.op === "composite_verify" ? ["parse", "missing_pq_signature"] : ["parse"];
    if (!exactKeys(r, ["id", "status", "code"]) || !codes.includes(r.code)) return { status: "error", kind: "malformed_result", message: `a rejection of ${c.op} is code ${codes.join(" or ")}` };
    if (r.code === "missing_pq_signature") {
      return c.expect.missing_pq_rejection_allowed ? { status: "pass", detail: "rejected (missing_pq_signature)" }
        : { status: "fail", kind: "discrepancy", message: "rejected as missing_pq_signature a case that is not a stripped PQ signature" };
    }
    return { status: "fail", kind: "discrepancy", message: "rejected a committed input as unparseable" };
  }
  if (r.status !== "ok" || !exactKeys(r, ["id", "status", ...RESULT_FIELDS[c.op]])) return { status: "error", kind: "malformed_result", message: `result fields do not match ${c.op}` };
  if (c.op === "dual_merkle_root") {
    if (!isHex64(r.sha256) || !isHex64(r.sha3_256)) return { status: "error", kind: "malformed_result", message: "roots must be 64 lowercase hex characters" };
    return r.sha256 === c.expect.roots.sha256 && r.sha3_256 === c.expect.roots.sha3_256 ? { status: "pass" } : { status: "fail", kind: "discrepancy", message: `got ${r.sha256} / ${r.sha3_256}` };
  }
  if (c.op === "composite_verify") {
    const types = ["valid", "classical_valid", "pq_valid"].every((f) => typeof r[f] === "boolean" || (f === "pq_valid" && r[f] === null));
    if (!types) return { status: "error", kind: "malformed_result", message: "valid and classical_valid are booleans, pq_valid a boolean or null" };
    const wrong = Object.entries(c.expect).filter(([f]) => f !== "missing_pq_rejection_allowed").filter(([f, v]) => r[f] !== v).map(([f, v]) => `${f}=${r[f]}, expected ${v}`);
    return wrong.length ? { status: "fail", kind: "discrepancy", message: wrong.join("; ") } : { status: "pass" };
  }
  if (typeof r.verified !== "boolean" || !Array.isArray(r.errors) || !r.errors.every((e) => typeof e === "string")) return { status: "error", kind: "malformed_result", message: "verified is a boolean and errors an array of strings" };
  if (r.verified && r.errors.length > 0) return { status: "error", kind: "contradictory_result", message: `verified=true with errors: ${JSON.stringify(r.errors).slice(0, 300)}` };
  if (r.verified !== c.expect.verified) return { status: "fail", kind: "discrepancy", message: `verified=${r.verified}, expected ${c.expect.verified}: ${JSON.stringify(r.errors).slice(0, 300)}` };
  if (c.expect.error_contains && !r.errors.join("\n").toLowerCase().includes(c.expect.error_contains.toLowerCase())) {
    return { status: "fail", kind: "discrepancy", message: `no error contains ${JSON.stringify(c.expect.error_contains)}: ${JSON.stringify(r.errors).slice(0, 300)}` };
  }
  return { status: "pass" };
}

/** Runs the evidence plan against argv and returns the report (status pass, fail or error). */
export async function runEvidence({ plan, argv, timeoutMs = EVIDENCE_TIMEOUT_MS, run = { id: crypto.randomUUID(), started_at: new Date().toISOString() } }) {
  const nonce = crypto.randomBytes(16).toString("hex");
  const sent = [];
  for (const s of plan.suites) for (const c of s.cases) sent.push({ wire: crypto.randomBytes(8).toString("hex"), c, suite: s.id });
  const request = { contract: EVIDENCE_CONTRACT, run_id: run.id, nonce, cases: sent.map(({ wire, c }) => ({ id: wire, op: c.op, ...c.request })) };
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
  // A negative counts only if its control passed in the same run.
  for (const { c } of sent) {
    const failed = (c.controls ?? []).filter((k) => outcome.get(k)?.status !== "pass");
    if (failed.length && outcome.get(c.id).status !== "error") {
      outcome.set(c.id, { status: "error", kind: "control_failed", message: `control(s) did not pass: ${failed.slice(0, 5).join(", ")}${failed.length > 5 ? ", …" : ""}` });
    }
  }
  const report = {
    kit: { name: "dcp-ai-conformance-external", contract: EVIDENCE_CONTRACT, catalog_version: plan.catalog.version, catalog_sha256: plan.catalog.sha256, fixtures_sha256: plan.fixtures },
    run: { id: run.id, nonce, started_at: run.started_at, finished_at: new Date().toISOString(), node: process.version, request_sha256: sha256(requestBytes), timeout_ms: timeoutMs },
    implementation: { argv, self_declared: implementation, observed },
    selection: plan.suites.map((s) => s.id),
    status: "incomplete",
    totals: { cases: 0, executed: 0, pass: 0, fail: 0, error: 0 },
    suites: [],
    limits: plan.catalog.limits,
  };
  for (const s of plan.suites) {
    const cases = sent.filter((x) => x.suite === s.id).map(({ c }) => ({
      id: c.id, op: c.op, source: c.source, input_sha256: sha256(Buffer.from(JSON.stringify(c.request), "utf8")),
      ...(c.controls ? { controls: c.controls } : {}), expect: c.expect, ...outcome.get(c.id),
    }));
    if (!fatal && extra > 0) cases.push({ id: `${s.id}#extra`, status: "error", kind: "extra", message: `${extra} result(s) with an id that was not sent` });
    const totals = { cases: cases.length, executed: 0, pass: 0, fail: 0, error: 0 };
    for (const r of cases) { totals[r.status]++; if (r.status !== "error") totals.executed++; }
    report.suites.push({ id: s.id, title: s.title, claim: s.claim, limits: s.limits, status: totals.error ? "error" : totals.fail ? "fail" : "pass", totals, cases });
    for (const k of Object.keys(totals)) report.totals[k] += totals[k];
  }
  report.status = report.totals.error || report.totals.executed === 0 ? "error" : report.totals.fail ? "fail" : "pass";
  return report;
}

/** The ids each builder produces from the committed fixtures, to write expected_cases into the catalog. */
export function producedIds(root = REPO_ROOT) {
  const docs = Object.fromEntries(Object.entries(FIXTURES).map(([k, rel]) => [k, JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"))]));
  return Object.fromEntries(Object.entries(BUILDERS).map(([id, b]) => [id, b(docs).map((c) => c.id)]));
}
