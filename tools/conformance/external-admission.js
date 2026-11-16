// Admission suites of the external kit (contract dcp-ai-conformance-external/3, opt-in through
// tools/conformance/external-admission-catalog.json): the strict-v1 admission decision of spec/profiles/admission on
// tests/interop/v2/admission_vectors.json, read at run time and byte-pinned by the catalog. The transport, process
// handling, limits and response envelope are those of external.js. A negative case names its controls: it counts only
// if they passed in the same run, and a selection that leaves a control out runs it too (`included_for_controls`).
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { isDeepStrictEqual } from "util";
import { fileURLToPath } from "url";
import {
  REPO_ROOT, LIMITS, UsageError, InfraError, isObj, exactKeys, sha256, utf8, decodeBase64Strict, runProcess, runLevel, parseResponse,
} from "./external.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ADMISSION_CATALOG_PATH = path.join(HERE, "external-admission-catalog.json");
export const ADMISSION_CONTRACT = "dcp-ai-conformance-external/3";
export const ADMISSION_TIMEOUT_MS = 300000;
const VECTORS = "tests/interop/v2/admission_vectors.json";
const BUNDLES = "tests/interop/v2/bundle_vectors.json";
const SUITES = { outcomes: "external.admission.outcomes", config: "external.admission.config", composed: "external.admission.composed" };
// The three trust sets with two applicable rows each (§2.2: with several problems, the code of any one of them may be
// reported). Every other configuration case has one code.
const MULTIPLE_DEFECTS = ["7_kid_of_other_alg", "7_key_wrong_length", "7_unknown_alg"];
const NO_PROFILE_NEUTRAL = { require_session_expiry: false, require_audience_binding: false, max_session_duration_seconds: 0 };
// The four compositions this kit defines: name, inputs, the vectors they compose and the expectation, exactly. The
// catalog states them with their rule and derivation; a catalog that changes any of them is refused, so no other
// oracle is adjudicated as these cases.
const NOW = "2026-11-02T10:01:00.000Z";
const APPROVED_COMPOSED = [
  { name: "profile_without_trust_set", inputs: { bundle: "base", profile: "strict", trust: null, revocation: { from_case: "A_known_principal_strict" }, now: NOW, verifier_policy: null },
    composes: ["A_known_principal_strict"], expected: { rejected: "CONFIG_PROFILE_CONTRADICTION" } },
  { name: "profile_with_caller_policy", inputs: { bundle: "base", profile: "strict", trust: "principal", revocation: { from_case: "A_known_principal_strict" }, now: NOW, verifier_policy: "no_profile_policy" },
    composes: ["A_known_principal_strict"], expected: { rejected: "CONFIG_PROFILE_CONTRADICTION" } },
  { name: "trust_then_revocation", inputs: { bundle: "base", profile: "strict", trust: "classical_revoked", revocation: { from_case: "13_agent_revoked" }, now: NOW, verifier_policy: null },
    composes: ["6_key_revoked_in_trust_set", "13_agent_revoked"],
    expected: { result: { verified: true, principal_trust: "untrusted", profile_compliance: "non_compliant", admitted: false, recorded_decision: "approve", action_authorized: false, codes: ["REVOCATION_REVOKED", "TRUST_KEY_REVOKED"] } } },
  { name: "session_then_structural_p4", inputs: { bundle: "classical_only", profile: "strict_120_s", trust: "principal", revocation: "unavailable", now: NOW, verifier_policy: null },
    composes: ["10_operator_lowers_maximum", "11_classical_only_bundle"],
    expected: { result: { verified: false, principal_trust: "not_evaluated", profile_compliance: "non_compliant", admitted: false, recorded_decision: null, action_authorized: false, codes: ["PROFILE_HYBRID_REQUIRED", "PROFILE_SESSION_TOO_LONG", "VERIFICATION_FAILED"] } } },
];
// spec/profiles/admission §5.2: a check that applies to several components or subjects may add its code once for each. These are the
// codes of such checks: P4 (each principal signature and component), T2 (each verified principal component) and R4/R5
// (each revocation subject). Every other check is one check of the bundle, the snapshot or the verification, and adds
// its code at most once; that includes the stops P1, T1, R1 and R2.
const REPEATABLE = new Set(["PROFILE_HYBRID_REQUIRED", "TRUST_KEY_NOT_ANCHORED", "TRUST_KEY_REVOKED", "TRUST_KEY_EXPIRED", "TRUST_KEY_NOT_YET_VALID", "REVOCATION_REVOKED", "REVOCATION_UNKNOWN"]);

// spec/profiles/admission §5.3.
const CONFIG_CODES = new Set(["CONFIG_UNKNOWN_FIELD", "CONFIG_INVALID_VALUE", "CONFIG_PROFILE_CONTRADICTION", "CONFIG_TRUST_EMPTY_ID", "CONFIG_TRUST_MALFORMED_KEY", "CONFIG_TRUST_KID_NOT_DERIVED", "CONFIG_TRUST_DUPLICATE"]);
const OUTCOME_CODES = new Set([
  "VERIFICATION_FAILED",
  "TRUST_PRINCIPAL_UNKNOWN", "TRUST_KEY_NOT_ANCHORED", "TRUST_KEY_REVOKED", "TRUST_KEY_EXPIRED", "TRUST_KEY_NOT_YET_VALID",
  "PROFILE_V2_REQUIRED", "PROFILE_AUDIENCE_MISSING", "PROFILE_AUDIENCE_MISMATCH", "PROFILE_SESSION_START_MISSING", "PROFILE_SESSION_EXPIRY_MISSING",
  "PROFILE_SESSION_TIME_INVALID", "PROFILE_SESSION_NOT_STARTED", "PROFILE_SESSION_EXPIRED", "PROFILE_SESSION_TOO_LONG", "PROFILE_HYBRID_REQUIRED",
  "REVOCATION_UNAVAILABLE", "REVOCATION_INVALID", "REVOCATION_STALE", "REVOCATION_REVOKED", "REVOCATION_UNKNOWN",
]);
const TRUST = new Set(["trusted", "untrusted", "not_evaluated"]);
const COMPLIANCE = new Set(["compliant", "non_compliant", "not_evaluated"]);
const RFC3339_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const HEX64 = /^[0-9a-f]{64}$/;
const KEY_LENGTH = { "ed25519": 32, "ml-dsa-65": 1952, "slh-dsa-192f": 48 };

const need = (cond, msg) => { if (!cond) throw new InfraError(msg); };
const isText = (v) => typeof v === "string" && v.trim() !== "";
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isStrictlySorted = (list) => list.every((x, i) => i === 0 || list[i - 1] < x);
const fingerprint = (op, request) => sha256(Buffer.from(JSON.stringify({ op, ...request }), "utf8"));

// ── Rules derived from spec/profiles/admission §3, §4.2, §4.3, §5.1 and §5.2 ──

const hasPrefix = (codes, prefix) => codes.some((k) => k.startsWith(prefix));

/**
 * What §3, §5.1 and §5.2 imply about one result, given whether the request carried a trust set and a profile.
 * Returns the first violated rule, or null. Used on the implementation's answers and on the fixture's expectations.
 */
export function contradiction(r, { trust, profile }) {
  const codes = r.codes;
  if (r.action_authorized !== false) return "action_authorized must be false (§5.2, §7)";
  if (r.verified !== r.verification_verified) return "verified differs from the verification it reports (§5.2)";
  if (r.admitted !== (codes.length === 0)) return "admitted must be true exactly when no code was added (§3, §5.1, §5.2)";
  if (codes.includes("VERIFICATION_FAILED") && r.verified) return "VERIFICATION_FAILED on a verified bundle (§5.1 step 2)";
  if (codes.includes("PROFILE_V2_REQUIRED") && r.verified) return "P1 stops before verification: the bundle is not verified (§5.1 step 1)";
  if (!r.verified && !codes.includes("VERIFICATION_FAILED") && !codes.includes("PROFILE_V2_REQUIRED")) return "a bundle that did not verify needs VERIFICATION_FAILED, unless P1 stopped (§5.1)";
  const trustCodes = hasPrefix(codes, "TRUST_");
  if (!trust || !r.verified) {
    if (r.principal_trust !== "not_evaluated" || trustCodes) return "principal trust is evaluated only with a trust set and a verified bundle (§3)";
  } else if (r.principal_trust === "not_evaluated" || (r.principal_trust === "untrusted") !== trustCodes) {
    return "untrusted exactly when T1 or T2 added a code (§3)";
  }
  const profileCodes = hasPrefix(codes, "PROFILE_") || hasPrefix(codes, "REVOCATION_");
  if (!profile) {
    if (r.profile_compliance !== "not_evaluated" || profileCodes) return "without a profile, compliance is not evaluated and no PROFILE_ or REVOCATION_ code is added (§5.2)";
  } else if (r.profile_compliance === "not_evaluated" || (r.profile_compliance === "compliant") !== (r.verified && !profileCodes)) {
    return "compliant exactly when verified with no PROFILE_ or REVOCATION_ code (§5.2)";
  }
  if (!r.verified && r.recorded_decision !== null) return "recorded_decision is null for a bundle that did not verify (§5.2)";
  return null;
}

// Phases of §5.1 and §5.2: P1, P2, P3, structural P4, VERIFICATION_FAILED, trust, verified P4, revocation.
const phaseOf = (k) => (k === "PROFILE_V2_REQUIRED" ? 0 : k.startsWith("PROFILE_AUDIENCE_") ? 1 : k.startsWith("PROFILE_SESSION_") ? 2
  : k === "VERIFICATION_FAILED" ? 4 : k.startsWith("TRUST_") ? 5 : k.startsWith("REVOCATION_") ? 7 : null);

/** Stops of §4.2 P1, §3 T1 and §4.3 R1/R2, and step 3 only for a verified bundle; on the set of codes. */
function stopProblem(codes, verified) {
  const set = new Set(codes);
  if (set.has("PROFILE_V2_REQUIRED") && set.size > 1) return "P1 stops: no other code may follow PROFILE_V2_REQUIRED (§4.2)";
  if (set.has("TRUST_PRINCIPAL_UNKNOWN") && [...set].some((k) => k.startsWith("TRUST_") && k !== "TRUST_PRINCIPAL_UNKNOWN")) return "T1 stops: no other TRUST_ code after TRUST_PRINCIPAL_UNKNOWN (§3)";
  if ((set.has("REVOCATION_UNAVAILABLE") || set.has("REVOCATION_INVALID")) && [...set].filter((k) => k.startsWith("REVOCATION_")).length > 1) return "R1 and R2 stop: one revocation code (§4.3)";
  if (!verified && (hasPrefix(codes, "TRUST_") || hasPrefix(codes, "REVOCATION_"))) return "trust and revocation are evaluated only for a verified bundle (§5.1 step 3)";
  return null;
}

/**
 * The raw sequence, every occurrence, must never go back to an earlier phase. PROFILE_HYBRID_REQUIRED is phase 3 when
 * the bundle did not verify; when it did, it may be the structural (3) or the verified (6) part: greedy, and marked.
 */
export function orderProblem(codes, verified) {
  let last = -1;
  let ambiguous = false;
  for (const k of codes) {
    let p = phaseOf(k);
    if (k === "PROFILE_HYBRID_REQUIRED") {
      if (!verified) p = 3;
      else { p = last <= 3 ? 3 : 6; ambiguous = true; }
    }
    if (p < last) return { problem: `${k} comes after a code of a later phase (§5.2 order: P1, P2, P3, structural P4, VERIFICATION_FAILED, trust, verified P4, revocation)` };
    last = p;
  }
  const stop = stopProblem(codes, verified);
  return stop ? { problem: stop } : { ambiguous };
}

/** Codes of checks that do not apply to several components or subjects, added more than once (§5.2). */
export function cardinalityProblem(codes) {
  const twice = [...new Set(codes)].filter((k) => !REPEATABLE.has(k) && codes.filter((x) => x === k).length > 1);
  return twice.length ? `${twice.join(", ")} added more than once: only a check that applies to several components or subjects repeats its code (§5.2)` : null;
}

/** The type and value problems of one expected result (the 7 fields of the fixture's expected), or null. */
function expectationProblem(e) {
  if (!exactKeys(e, ["verified", "principal_trust", "profile_compliance", "admitted", "recorded_decision", "action_authorized", "codes"])) return "expected needs exactly the 7 fields";
  if (typeof e.verified !== "boolean" || typeof e.admitted !== "boolean" || e.action_authorized !== false || !TRUST.has(e.principal_trust) || !COMPLIANCE.has(e.profile_compliance)) return "expected field types";
  if (e.recorded_decision !== null && !isText(e.recorded_decision)) return "recorded_decision is a string or null";
  if (!Array.isArray(e.codes) || !e.codes.every((k) => OUTCOME_CODES.has(k)) || !isStrictlySorted(e.codes)) return "codes must be known §5.3 outcome codes, sorted and unique";
  return null;
}

// ── Configuration facts the catalog's multiple defects rely on ────

const kidOf = (alg, raw) => sha256(Buffer.concat([Buffer.from(alg, "utf8"), Buffer.from([0]), raw])).slice(0, 32);

/** The trust-set codes whose condition holds, for the rows the three multiple defects involve (§2.2). */
function trustSetDefects(cfg) {
  const out = new Set();
  const kids = [];
  const ids = [];
  for (const p of Array.isArray(cfg?.principals) ? cfg.principals : []) {
    ids.push(p?.human_id);
    for (const k of Array.isArray(p?.keys) ? p.keys : []) {
      kids.push(k?.kid);
      const raw = decodeBase64Strict(k?.public_key_b64);
      if (!Object.hasOwn(KEY_LENGTH, k?.alg) || !raw || raw.length !== KEY_LENGTH[k.alg]) out.add("CONFIG_TRUST_MALFORMED_KEY");
      const bytes = raw ?? (typeof k?.public_key_b64 === "string" ? Buffer.from(k.public_key_b64, "base64") : null);
      if (typeof k?.alg === "string" && bytes && k.kid !== kidOf(k.alg, bytes)) out.add("CONFIG_TRUST_KID_NOT_DERIVED");
    }
  }
  if (new Set(kids).size !== kids.length || new Set(ids).size !== ids.length) out.add("CONFIG_TRUST_DUPLICATE");
  return out;
}

// ── Catalog and fixtures ─────────────────────────────────────────

function validateVectors(V) {
  need(exactKeys(V, ["description", "spec", "generated_by", "verifier_id", "signed_bundles", "trust_sets", "profiles", "cases", "config_cases", "accepted_profiles"]), `${VECTORS}: unexpected top-level keys`);
  for (const k of ["signed_bundles", "trust_sets", "profiles"]) need(isObj(V[k]) && Object.values(V[k]).every(isObj), `${VECTORS}: ${k} must map names to objects`);
  for (const [n, t] of Object.entries(V.trust_sets)) need(isText(t.trust_set_version), `${VECTORS}: trust set ${n} needs a trust_set_version`);
  need(Array.isArray(V.cases) && Array.isArray(V.config_cases) && Array.isArray(V.accepted_profiles), `${VECTORS}: cases, config_cases and accepted_profiles must be arrays`);
  const names = new Set();
  const unique = (n, where) => { need(isText(n) && !names.has(n), `${where}: missing or duplicate name ${JSON.stringify(n)}`); names.add(n); };
  for (const c of V.cases) {
    const where = `${VECTORS}#cases/${c?.name}`;
    need(exactKeys(c, ["name", "rule", "reason", "bundle", "now", "profile", "trust", "expected"], ["revocation"]), `${where}: unexpected keys`);
    unique(c.name, where);
    need(isText(c.rule) && isText(c.reason) && Object.hasOwn(V.signed_bundles, c.bundle), `${where}: rule, reason and a known bundle`);
    need(c.profile === null || Object.hasOwn(V.profiles, c.profile), `${where}: unknown profile`);
    need(c.trust === null || Object.hasOwn(V.trust_sets, c.trust), `${where}: unknown trust set`);
    need(RFC3339_MS.test(c.now) && Number.isFinite(Date.parse(c.now)), `${where}: now must be RFC 3339 with milliseconds and Z`);
    // Revocation is part of the case exactly when there is a profile: an object, or null (no snapshot, R1).
    need(c.profile === null ? !Object.hasOwn(c, "revocation") : Object.hasOwn(c, "revocation") && (c.revocation === null || isObj(c.revocation)), `${where}: revocation must be present exactly under a profile, as an object or null`);
    const e = c.expected;
    const shape = expectationProblem(e);
    need(!shape, `${where}: ${shape}`);
    // The fixture's own expectation must satisfy what the text implies (it is a reading of the text, not of an SDK).
    const ctx = { trust: c.trust !== null, profile: c.profile !== null };
    const bad = contradiction({ ...e, verification_verified: e.verified }, ctx) ?? stopProblem(e.codes, e.verified);
    need(!bad, `${where}: the expectation contradicts the text: ${bad}`);
  }
  for (const c of V.config_cases) {
    const where = `${VECTORS}#config_cases/${c?.name}`;
    need(exactKeys(c, ["name", "rule", "kind", "config", "expected_code"]), `${where}: unexpected keys`);
    unique(c.name, where);
    need(isText(c.rule) && (c.kind === "trust_set" || c.kind === "profile") && CONFIG_CODES.has(c.expected_code), `${where}: rule, kind and a §5.3 configuration code`);
  }
  for (const c of V.accepted_profiles) {
    const where = `${VECTORS}#accepted_profiles/${c?.name}`;
    need(exactKeys(c, ["name", "rule", "config", "expected_max_session_duration_seconds", "expected_max_revocation_age_seconds"]), `${where}: unexpected keys`);
    unique(c.name, where);
    for (const k of ["expected_max_session_duration_seconds", "expected_max_revocation_age_seconds"]) need(Number.isInteger(c[k]) && c[k] >= 1 && c[k] <= 300, `${where}: ${k} from 1 to 300`);
  }
}

/**
 * §4.1: the effective maxima of a valid strict-v1 configuration. The session maximum is the top-level one (300 when
 * absent), lowered by verifier_policy.max_session_duration_seconds when that is given ("the smaller applies"); the
 * revocation maximum is the top-level one (300 when absent).
 */
function effectiveMaxima(cfg, where) {
  const top = cfg.max_session_duration_seconds ?? 300;
  const policy = isObj(cfg.verifier_policy) ? cfg.verifier_policy.max_session_duration_seconds : undefined;
  const revocation = cfg.max_revocation_age_seconds ?? 300;
  const ok = (v) => Number.isInteger(v) && v >= 1 && v <= 300;
  need(ok(top) && ok(revocation) && (policy === undefined || (ok(policy) && policy <= top)), `${where}: maxima must be integers from 1 to 300, the policy's no larger than the profile's`);
  return { max_session_duration_seconds: policy === undefined ? top : Math.min(top, policy), max_revocation_age_seconds: revocation };
}

/** Revocation on the wire: three states, so "no snapshot" (R1) is never confused with "not applicable". */
const wireRevocation = (profile, value) => (profile === null ? null : value === null ? { state: "unavailable" } : { state: "snapshot", snapshot: value });

/** Loads the admission catalog and fixtures; every suite must produce exactly the case ids it pins. */
export function loadAdmissionPlan({ root = REPO_ROOT, catalogFile = ADMISSION_CATALOG_PATH, select } = {}) {
  let raw;
  try { raw = fs.readFileSync(catalogFile); } catch (e) { throw new InfraError(`catalog ${catalogFile} is unreadable (${e.code ?? e.message})`); }
  let cat;
  try { cat = JSON.parse(utf8(raw)); } catch (e) { throw new InfraError(`catalog ${catalogFile} is not valid UTF-8 JSON (${e.message})`); }
  need(exactKeys(cat, ["contract", "catalog_version", "fixtures", "no_profile_policy", "multiple_defects", "composed", "suites", "limits"]) && cat.contract === ADMISSION_CONTRACT && isText(cat.catalog_version), `invalid catalog: needs exactly contract ${ADMISSION_CONTRACT}, catalog_version, fixtures, no_profile_policy, multiple_defects, composed, suites and limits`);
  need(Array.isArray(cat.limits) && cat.limits.every(isText), "invalid catalog: limits must be non-empty strings");

  // Fixtures: byte-pinned by the catalog, then validated.
  need(exactKeys(cat.fixtures, [VECTORS, BUNDLES]) && Object.values(cat.fixtures).every((h) => typeof h === "string" && HEX64.test(h)), `invalid catalog: fixtures must pin exactly ${VECTORS} and ${BUNDLES} by sha256`);
  const fixtures = {};
  const docs = {};
  for (const rel of [VECTORS, BUNDLES]) {
    let buf;
    try { buf = fs.readFileSync(path.join(root, rel)); } catch (e) { throw new InfraError(`required fixture ${rel} is missing or unreadable (${e.code ?? e.message})`); }
    fixtures[rel] = sha256(buf);
    need(fixtures[rel] === cat.fixtures[rel], `fixture ${rel} is not the one the catalog pins (sha256 ${fixtures[rel]}, expected ${cat.fixtures[rel]})`);
    try { docs[rel] = JSON.parse(utf8(buf)); } catch (e) { throw new InfraError(`required fixture ${rel} is not valid UTF-8 JSON (${e.message})`); }
  }
  const V = docs[VECTORS];
  validateVectors(V);

  // The complete explicit policy of the cases without a profile (§5.1 step 2: the caller's policy).
  const shared = docs[BUNDLES].default_verifier_policy;
  need(isObj(shared), `${BUNDLES}: default_verifier_policy missing`);
  const policy = cat.no_profile_policy;
  need(isObj(policy) && !Object.hasOwn(policy, "verifier_id") && same(Object.keys(policy).sort(), [...Object.keys(shared), ...Object.keys(NO_PROFILE_NEUTRAL)].sort()) &&
    Object.entries(shared).every(([k, v]) => same(policy[k], v)) && Object.entries(NO_PROFILE_NEUTRAL).every(([k, v]) => policy[k] === v),
  `invalid catalog: no_profile_policy must be ${BUNDLES}#default_verifier_policy plus exactly ${JSON.stringify(NO_PROFILE_NEUTRAL)}, without verifier_id`);

  // §2.2: exactly the three multiple defects this kit documents, each with every applicable code and only those.
  need(isObj(cat.multiple_defects) && same(Object.keys(cat.multiple_defects).sort(), [...MULTIPLE_DEFECTS].sort()), `invalid catalog: multiple_defects must list exactly ${MULTIPLE_DEFECTS.join(", ")}`);
  const configByName = new Map(V.config_cases.map((c) => [c.name, c]));
  for (const [name, d] of Object.entries(cat.multiple_defects)) {
    const c = configByName.get(name);
    need(c && c.kind === "trust_set", `multiple_defects ${name}: not a trust-set configuration case`);
    need(exactKeys(d, ["allowed_codes", "reasons"]) && Array.isArray(d.allowed_codes) && d.allowed_codes.length === 2 && isStrictlySorted(d.allowed_codes) && d.allowed_codes.every((k) => CONFIG_CODES.has(k)), `multiple_defects ${name}: two sorted configuration codes`);
    need(exactKeys(d.reasons, d.allowed_codes) && Object.values(d.reasons).every(isText), `multiple_defects ${name}: one reason per allowed code`);
    need(d.allowed_codes.includes(c.expected_code), `multiple_defects ${name}: the fixture's ${c.expected_code} is not allowed`);
    const holds = [...trustSetDefects(c.config)].sort();
    need(same(holds, d.allowed_codes), `multiple_defects ${name}: the applicable codes are ${holds.join(", ") || "none"}, not ${d.allowed_codes.join(", ")}`);
  }

  // ── Cases ──
  const byName = new Map(V.cases.map((c) => [c.name, c]));
  const outcomeId = (n) => `${SUITES.outcomes}.${n}`;
  const resultOf = (e, profile, trust) => ({
    verified: e.verified, principal_trust: e.principal_trust, profile: profile === null ? null : "strict-v1", profile_compliance: e.profile_compliance,
    admitted: e.admitted, action_authorized: false, recorded_decision: e.recorded_decision,
    trust_set_version: trust === null ? null : V.trust_sets[trust].trust_set_version, codes: e.codes,
  });
  const admitRequest = ({ bundle, now, profile, trust, revocation, verifierPolicy }) => ({
    bundle_b64: b64(JSON.stringify(V.signed_bundles[bundle])), now,
    profile: profile === null ? null : V.profiles[profile], trust_set: trust === null ? null : V.trust_sets[trust],
    verifier_policy: verifierPolicy, revocation,
  });

  // A negative's control: the positive on its own bundle under the same mode, else a suite-level positive.
  const anchors = { base: "A_known_principal_strict", rotated_keys: "C_new_key_added_to_trust_set" };
  const noProfileAnchor = "B_trust_without_profile";
  for (const a of [...Object.values(anchors), noProfileAnchor]) need(byName.get(a)?.expected.admitted === true, `control ${a} must be an admitted fixture case`);
  const outcomes = V.cases.map((c) => {
    const request = admitRequest({ ...c, revocation: wireRevocation(c.profile, c.revocation), verifierPolicy: c.profile === null ? policy : null });
    const out = { id: outcomeId(c.name), source: `${VECTORS}#cases/${c.name}`, op: "admit_signed_bundle_v2", rule: c.rule, request, context: { trust: c.trust !== null, profile: c.profile !== null }, expect: { result: resultOf(c.expected, c.profile, c.trust) } };
    if (c.expected.admitted) return out;
    const anchor = c.profile === null ? noProfileAnchor : anchors[c.bundle] ?? anchors.base;
    return { ...out, controls: [outcomeId(anchor)], control_scope: byName.get(anchor).bundle === c.bundle ? "same_bundle" : "suite" };
  });

  const loadId = (kind, n) => `${SUITES.config}.load.${kind}.${n}`;
  const trustControl = loadId("trust_set", "principal");
  const profileControls = [loadId("profile", "strict"), `${SUITES.config}.accepted_profiles.profile_defaults`];
  const config = [
    ...V.config_cases.map((c) => ({
      id: `${SUITES.config}.reject.${c.name}`, source: `${VECTORS}#config_cases/${c.name}`, op: "load_admission_config", rule: c.rule,
      request: { kind: c.kind, config: c.config },
      expect: { reject: true, allowed_codes: cat.multiple_defects[c.name]?.allowed_codes ?? [c.expected_code], ...(cat.multiple_defects[c.name] ? { multiple_defects: true } : {}) },
      controls: c.kind === "trust_set" ? [trustControl] : profileControls, control_scope: "suite",
    })),
    ...V.accepted_profiles.map((c) => {
      const pinned = { max_session_duration_seconds: c.expected_max_session_duration_seconds, max_revocation_age_seconds: c.expected_max_revocation_age_seconds };
      // The rule that gives the six fixture profiles their maxima must reproduce the two the fixture pins.
      need(isDeepStrictEqual(effectiveMaxima(c.config, `${VECTORS}#accepted_profiles/${c.name}`), pinned), `${VECTORS}#accepted_profiles/${c.name}: §4.1 gives other maxima than the fixture pins`);
      return { id: `${SUITES.config}.accepted_profiles.${c.name}`, source: `${VECTORS}#accepted_profiles/${c.name}`, op: "load_admission_config", rule: c.rule, request: { kind: "profile", config: c.config }, expect: { accept: true, ...pinned } };
    }),
    ...Object.entries(V.trust_sets).map(([n, t]) => ({ id: loadId("trust_set", n), source: `${VECTORS}#trust_sets/${n}`, op: "load_admission_config", rule: "§2.2", request: { kind: "trust_set", config: t }, expect: { accept: true } })),
    ...Object.entries(V.profiles).map(([n, p]) => ({ id: loadId("profile", n), source: `${VECTORS}#profiles/${n}`, op: "load_admission_config", rule: "§4.1", request: { kind: "profile", config: p }, expect: { accept: true, ...effectiveMaxima(p, `${VECTORS}#profiles/${n}`) } })),
  ];

  // Composed cases: inputs of the fixture, expectations written in the catalog and checked against the text.
  need(Array.isArray(cat.composed) && cat.composed.length === APPROVED_COMPOSED.length, `invalid catalog: composed must hold the ${APPROVED_COMPOSED.length} approved compositions`);
  cat.composed.forEach((d, k) => {
    const { name, inputs, composes, expected } = isObj(d) ? d : {};
    need(isDeepStrictEqual({ name, inputs, composes, expected }, APPROVED_COMPOSED[k]), `invalid catalog: composed ${JSON.stringify(name)} is not the approved composition ${APPROVED_COMPOSED[k].name} (name, inputs, composes and expected must be exactly those this kit defines)`);
  });
  const composed = cat.composed.map((d) => {
    const where = `composed ${d?.name}`;
    need(exactKeys(d, ["name", "rule", "inputs", "composes", "expected", "derivation"]) && isText(d.name) && isText(d.rule) && isText(d.derivation), `${where}: needs exactly name, rule, inputs, composes, expected and derivation`);
    const i = d.inputs;
    need(exactKeys(i, ["bundle", "profile", "trust", "revocation", "now", "verifier_policy"]), `${where}: inputs needs exactly bundle, profile, trust, revocation, now and verifier_policy`);
    need(Object.hasOwn(V.signed_bundles, i.bundle) && Object.hasOwn(V.profiles, i.profile) && (i.trust === null || Object.hasOwn(V.trust_sets, i.trust)) && RFC3339_MS.test(i.now), `${where}: unknown bundle, profile or trust set, or a malformed now`);
    need(i.verifier_policy === null || i.verifier_policy === "no_profile_policy", `${where}: verifier_policy is null or "no_profile_policy"`);
    need(Array.isArray(d.composes) && d.composes.length > 0 && d.composes.every((n) => byName.has(n)), `${where}: composes must name fixture cases`);
    const parts = d.composes.map((n) => byName.get(n));
    for (const k of ["bundle", "profile", "now"]) need(parts.some((p) => p[k] === i[k]), `${where}: its ${k} is not that of a case it composes`);
    let revocation;
    if (i.revocation === "unavailable") revocation = { state: "unavailable" };
    else {
      need(exactKeys(i.revocation, ["from_case"]) && parts.some((p) => p.name === i.revocation.from_case) && isObj(byName.get(i.revocation.from_case).revocation), `${where}: revocation is "unavailable" or {from_case} naming a composed case with a snapshot`);
      revocation = { state: "snapshot", snapshot: byName.get(i.revocation.from_case).revocation };
    }
    const request = admitRequest({ ...i, revocation, verifierPolicy: i.verifier_policy === null ? null : policy });
    const base = { id: `${SUITES.composed}.${d.name}`, source: `tools/conformance/external-admission-catalog.json#composed/${d.name} (inputs of ${VECTORS})`, op: "admit_signed_bundle_v2", rule: d.rule, request, composes: d.composes };
    const controls = [...new Set([outcomeId(anchors.base), ...d.composes.map(outcomeId)])];
    if (exactKeys(d.expected, ["rejected"])) {
      // §5.1: a profile without a trust set, or with a policy of the caller's, is a configuration error.
      need(d.expected.rejected === "CONFIG_PROFILE_CONTRADICTION" && (i.trust === null || i.verifier_policy !== null), `${where}: a refusal is CONFIG_PROFILE_CONTRADICTION, for a profile without a trust set or with a caller's policy`);
      return { ...base, expect: { rejected: d.expected.rejected }, controls, control_scope: "inputs" };
    }
    need(exactKeys(d.expected, ["result"]) && i.trust !== null && i.verifier_policy === null && parts.some((p) => p.trust === i.trust), `${where}: an outcome uses a trust set of a case it composes and no caller policy`);
    const e = d.expected.result;
    const shape = expectationProblem(e);
    need(!shape, `${where}: ${shape}`);
    const union = [...new Set(parts.flatMap((p) => p.expected.codes))].sort();
    need(same(e.codes, union), `${where}: its codes must be the union of the cases it composes (${union.join(", ")})`);
    const bad = contradiction({ ...e, verification_verified: e.verified }, { trust: true, profile: true }) ?? stopProblem(e.codes, e.verified);
    need(!bad, `${where}: the expectation contradicts the text: ${bad}`);
    return { ...base, context: { trust: true, profile: true }, expect: { result: resultOf(e, i.profile, i.trust) }, controls, control_scope: "inputs" };
  });

  const built = { [SUITES.outcomes]: outcomes, [SUITES.config]: config, [SUITES.composed]: composed };
  need(Array.isArray(cat.suites) && same(cat.suites.map((s) => s?.id), Object.values(SUITES)), `invalid catalog: suites must be exactly ${Object.values(SUITES).join(", ")}, in that order`);
  const ids = new Set();
  const suites = cat.suites.map((s) => {
    need(exactKeys(s, ["id", "title", "claim", "limits", "expected_cases"]) && isText(s.title) && isText(s.claim) && Array.isArray(s.limits) && s.limits.every(isText) &&
      Array.isArray(s.expected_cases) && s.expected_cases.length > 0 && s.expected_cases.every(isText), `invalid catalog: suite ${s.id} needs title, claim, limits and non-empty expected_cases`);
    for (const id of [s.id, ...s.expected_cases]) { need(!ids.has(id), `invalid catalog: duplicate id ${id}`); ids.add(id); }
    const cases = built[s.id];
    const produced = cases.map((c) => c.id);
    need(new Set(produced).size === produced.length, `${s.id}: duplicate case produced`);
    const missing = s.expected_cases.filter((id) => !produced.includes(id));
    const extra = produced.filter((id) => !s.expected_cases.includes(id));
    need(missing.length === 0 && extra.length === 0, `${s.id}: fixtures and catalog disagree (missing ${missing.join(", ") || "none"}; extra ${extra.join(", ") || "none"})`);
    return { id: s.id, title: s.title, claim: s.claim, limits: s.limits, cases };
  });
  const all = new Map(suites.flatMap((s) => s.cases.map((c) => [c.id, { c, suite: s.id }])));
  for (const { c } of all.values()) for (const k of c.controls ?? []) need(all.has(k) && k !== c.id, `${c.id}: control ${k} must be another case`);
  // Controls form no cycle, so every chain of controls ends in cases that have none.
  const state = new Map();
  const visit = (id) => {
    need(state.get(id) !== "open", `control cycle through ${id}`);
    if (state.get(id) === "done") return;
    state.set(id, "open");
    for (const k of all.get(id).c.controls ?? []) visit(k);
    state.set(id, "done");
  };
  for (const id of all.keys()) visit(id);
  // Cases that send the very same request (A_known_principal_strict and 10_session_300_s_exactly; profile_defaults and
  // the strict profile) cannot be told apart by an implementation: their expectations must be identical.
  const byRequest = new Map();
  for (const { c } of all.values()) {
    const k = fingerprint(c.op, c.request);
    if (byRequest.has(k)) need(isDeepStrictEqual(byRequest.get(k).expect, c.expect), `${c.id} sends the request of ${byRequest.get(k).id} with another expectation`);
    else byRequest.set(k, c);
  }

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
  // Controls the selection leaves out, and their own controls, are run too and reported as such: a negative never
  // counts without its control.
  const chosen = new Set(selected.flatMap((s) => s.cases.map((c) => c.id)));
  const needed = new Set();
  const pull = (id) => { for (const k of all.get(id).c.controls ?? []) if (!needed.has(k)) { needed.add(k); pull(k); } };
  for (const id of chosen) pull(id);
  const included = [...all.keys()].filter((k) => needed.has(k) && !chosen.has(k)).map((k) => all.get(k));
  need(selected.reduce((n, s) => n + s.cases.length, 0) > 0, "the selection has no case");
  return { catalog: { version: cat.catalog_version, sha256: sha256(raw), limits: cat.limits, contract: ADMISSION_CONTRACT }, fixtures, suites: selected, included };
}

// ── Judgement ────────────────────────────────────────────────────

const ADMIT_FIELDS = ["verified", "principal_trust", "profile", "profile_compliance", "admitted", "action_authorized", "recorded_decision", "trust_set_version", "codes", "verification_verified"];

function shapeProblem(r) {
  if (typeof r.verified !== "boolean" || typeof r.admitted !== "boolean" || typeof r.action_authorized !== "boolean" || typeof r.verification_verified !== "boolean") return "verified, admitted, action_authorized and verification_verified are booleans";
  if (!TRUST.has(r.principal_trust) || !COMPLIANCE.has(r.profile_compliance)) return "principal_trust and profile_compliance must be values of §5.2";
  if (r.profile !== null && r.profile !== "strict-v1") return "profile is \"strict-v1\" or null";
  if ((r.recorded_decision !== null && typeof r.recorded_decision !== "string") || (r.trust_set_version !== null && typeof r.trust_set_version !== "string")) return "recorded_decision and trust_set_version are strings or null";
  if (!Array.isArray(r.codes) || !r.codes.every((k) => typeof k === "string")) return "codes is an array of strings";
  const unknown = r.codes.filter((k) => !OUTCOME_CODES.has(k));
  if (unknown.length) return `codes outside §5.3: ${unknown.slice(0, 3).join(", ")}`;
  return null;
}

/** One result against one case. A config code is judged by value: whether it came from a typed error only the wrapper saw. */
function judge(c, results) {
  if (results.length === 0) return { status: "error", kind: "missing", message: "no result for this case" };
  if (results.length > 1) return { status: "error", kind: "duplicate", message: `${results.length} results for this case` };
  const r = results[0];
  if (r.status === "error") return exactKeys(r, ["id", "status", "message"]) && typeof r.message === "string" ? { status: "error", kind: "implementation", message: r.message.slice(0, 500) } : { status: "error", kind: "malformed_result", message: "error needs a message" };
  if (r.status === "unsupported") return exactKeys(r, ["id", "status"]) ? { status: "error", kind: "unsupported", message: `${c.op} is not supported by the implementation` } : { status: "error", kind: "malformed_result", message: "unsupported takes no other field" };
  if (r.status === "rejected") {
    if (!exactKeys(r, ["id", "status", "code"]) || !CONFIG_CODES.has(r.code)) return { status: "error", kind: "malformed_result", message: "a rejection carries one §5.3 configuration code" };
    const allowed = c.expect.allowed_codes ?? (c.expect.rejected ? [c.expect.rejected] : []);
    if (allowed.includes(r.code)) return { status: "pass", answered_code: r.code };
    return { status: "fail", kind: "discrepancy", answered_code: r.code, message: allowed.length ? `rejected with ${r.code}, expected ${allowed.join(" or ")}` : `rejected with ${r.code} a case that must be ${c.expect.accept ? "accepted" : "evaluated"}` };
  }
  if (r.status !== "ok") return { status: "error", kind: "malformed_result", message: `unknown status ${JSON.stringify(r.status)}` };

  if (c.op === "load_admission_config") {
    const profile = c.request.kind === "profile";
    const fields = profile ? ["accepted", "max_session_duration_seconds", "max_revocation_age_seconds"] : ["accepted"];
    if (!exactKeys(r, ["id", "status", ...fields]) || r.accepted !== true || (profile && ![r.max_session_duration_seconds, r.max_revocation_age_seconds].every((v) => Number.isInteger(v) && v >= 1 && v <= 300))) {
      return { status: "error", kind: "malformed_result", message: `an accepted ${c.request.kind} has exactly accepted: true${profile ? " and both maxima, integers from 1 to 300" : ""}` };
    }
    if (c.expect.reject) return { status: "fail", kind: "discrepancy", message: `accepted a configuration that must be rejected with ${c.expect.allowed_codes.join(" or ")}` };
    if (c.expect.max_session_duration_seconds !== undefined && (r.max_session_duration_seconds !== c.expect.max_session_duration_seconds || r.max_revocation_age_seconds !== c.expect.max_revocation_age_seconds)) {
      return { status: "fail", kind: "discrepancy", message: `maxima ${r.max_session_duration_seconds}/${r.max_revocation_age_seconds}, expected ${c.expect.max_session_duration_seconds}/${c.expect.max_revocation_age_seconds}` };
    }
    return { status: "pass" };
  }

  if (!exactKeys(r, ["id", "status", ...ADMIT_FIELDS])) return { status: "error", kind: "malformed_result", message: `an admission result has exactly ${ADMIT_FIELDS.join(", ")}` };
  const shape = shapeProblem(r);
  if (shape) return { status: "error", kind: "malformed_result", message: shape };
  if (c.expect.rejected) return { status: "fail", kind: "discrepancy", message: `evaluated a call that must be refused with ${c.expect.rejected}` };
  const contra = contradiction(r, { trust: c.request.trust_set !== null, profile: c.request.profile !== null });
  if (contra) return { status: "error", kind: "contradictory_result", message: contra };
  const e = c.expect.result;
  const wrong = ADMIT_FIELDS.filter((f) => f !== "codes" && f !== "verification_verified" && r[f] !== e[f]).map((f) => `${f}=${JSON.stringify(r[f])}, expected ${JSON.stringify(e[f])}`);
  if (wrong.length) return { status: "fail", kind: "discrepancy", message: wrong.join("; ") };
  const distinct = [...new Set(r.codes)].sort();
  if (!same(distinct, e.codes)) return { status: "fail", kind: "discrepancy", message: `codes ${distinct.join(", ") || "none"}, expected ${e.codes.join(", ") || "none"}` };
  const order = orderProblem(r.codes, r.verified);
  if (order.problem) return { status: "fail", kind: "order", message: `${order.problem}: ${r.codes.join(" > ")}` };
  const twice = cardinalityProblem(r.codes);
  if (twice) return { status: "fail", kind: "cardinality", message: `${twice}: ${r.codes.join(" > ")}` };
  return { status: "pass", ...(order.ambiguous ? { p4_ambiguous: true } : {}) };
}

/** Runs the admission plan against argv and returns the report (status pass, fail or error). */
export async function runAdmission({ plan, argv, timeoutMs = ADMISSION_TIMEOUT_MS, run = { id: crypto.randomUUID(), started_at: new Date().toISOString() } }) {
  const nonce = crypto.randomBytes(16).toString("hex");
  const sent = [];
  for (const s of plan.suites) for (const c of s.cases) sent.push({ wire: crypto.randomBytes(8).toString("hex"), c, suite: s.id, role: "selected" });
  for (const { c, suite } of plan.included) sent.push({ wire: crypto.randomBytes(8).toString("hex"), c, suite, role: "control" });
  const request = { contract: ADMISSION_CONTRACT, run_id: run.id, nonce, cases: sent.map(({ wire, c }) => ({ id: wire, op: c.op, ...c.request })) };
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
  // An infrastructure failure is an error for every case, never a rejection or "not admitted".
  const judged = new Map(sent.map(({ wire, c }) => [c.id, fatal ? { status: "error", ...fatal } : judge(c, byWire.get(wire))]));
  const byId = new Map(sent.map(({ c }) => [c.id, c]));
  // A case counts only if its controls count, transitively (the catalog has no control cycle).
  const outcome = new Map();
  const settle = (id) => {
    if (outcome.has(id)) return outcome.get(id);
    const own = judged.get(id);
    const failed = (byId.get(id).controls ?? []).filter((k) => settle(k).status !== "pass");
    const result = failed.length && own.status !== "error"
      ? { status: "error", kind: "control_failed", message: `control(s) did not pass: ${failed.slice(0, 5).join(", ")}${failed.length > 5 ? ", …" : ""}` } : own;
    outcome.set(id, result);
    return result;
  };
  for (const { c } of sent) settle(c.id);
  const report = {
    kit: { name: "dcp-ai-conformance-external", contract: ADMISSION_CONTRACT, catalog_version: plan.catalog.version, catalog_sha256: plan.catalog.sha256, fixtures_sha256: plan.fixtures },
    run: { id: run.id, nonce, started_at: run.started_at, finished_at: new Date().toISOString(), node: process.version, request_sha256: sha256(requestBytes), timeout_ms: timeoutMs },
    implementation: { argv, self_declared: implementation, observed },
    selection: plan.suites.map((s) => s.id),
    controls_included: plan.included.map(({ c }) => c.id),
    status: "incomplete",
    totals: { cases: 0, executed: 0, pass: 0, fail: 0, error: 0 },
    suites: [],
    limits: plan.catalog.limits,
  };
  const groups = [...plan.suites.map((s) => ({ s, role: "selected" })), ...[...new Set(plan.included.map((x) => x.suite))].map((id) => ({ s: { id, title: `controls from ${id}`, claim: "Run because a selected negative needs them; not a selection of this suite.", limits: [] }, role: "control" }))];
  for (const { s, role } of groups) {
    const cases = sent.filter((x) => x.suite === s.id && x.role === role).map(({ c }) => ({
      id: c.id, op: c.op, rule: c.rule, source: c.source, input_sha256: fingerprint(c.op, c.request),
      ...(c.controls ? { controls: c.controls, control_scope: c.control_scope } : {}), ...(c.composes ? { composes: c.composes } : {}), expect: c.expect, ...outcome.get(c.id),
    }));
    if (role === "selected" && !fatal && extra > 0 && s === plan.suites[0]) cases.push({ id: `${s.id}#extra`, status: "error", kind: "extra", message: `${extra} result(s) with an id that was not sent` });
    const totals = { cases: cases.length, executed: 0, pass: 0, fail: 0, error: 0 };
    for (const r of cases) { totals[r.status]++; if (r.status !== "error") totals.executed++; }
    report.suites.push({ id: s.id, title: s.title, claim: s.claim, limits: s.limits, ...(role === "control" ? { included_for_controls: true } : {}), status: totals.error ? "error" : totals.fail ? "fail" : "pass", totals, cases });
    for (const k of Object.keys(totals)) report.totals[k] += totals[k];
  }
  report.status = report.totals.error || report.totals.executed === 0 ? "error" : report.totals.fail ? "fail" : "pass";
  return report;
}

/** The ids each suite produces from the committed fixtures and the catalog's composed cases, to write expected_cases. */
export function producedAdmissionIds({ root = REPO_ROOT, catalogFile = ADMISSION_CATALOG_PATH } = {}) {
  const cat = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
  const V = JSON.parse(fs.readFileSync(path.join(root, VECTORS), "utf8"));
  return {
    [SUITES.outcomes]: V.cases.map((c) => `${SUITES.outcomes}.${c.name}`),
    [SUITES.config]: [
      ...V.config_cases.map((c) => `${SUITES.config}.reject.${c.name}`),
      ...V.accepted_profiles.map((c) => `${SUITES.config}.accepted_profiles.${c.name}`),
      ...Object.keys(V.trust_sets).map((n) => `${SUITES.config}.load.trust_set.${n}`),
      ...Object.keys(V.profiles).map((n) => `${SUITES.config}.load.profile.${n}`),
    ],
    [SUITES.composed]: cat.composed.map((d) => `${SUITES.composed}.${d.name}`),
  };
}
