// Delegation suites of the external kit (contract dcp-ai-conformance-external/4, opt-in through
// tools/conformance/external-delegation-catalog.json): DCP-09 §3.5.2 mandate chain verification on the committed
// tests/interop/v2/mandate_chain_vectors.json, mandate_chain_time_vectors.json and mandate_domain_vectors.json, read at
// run time and byte-pinned by the catalog. The transport, process handling, limits and response envelope are those of
// external.js. Chains and keys travel as the exact bytes the fixture holds (no JSON.parse/stringify on the way), so
// integers past 2^53 and every timestamp reach the implementation as written.
//
// Only the verdict is normative: valid, plus effective_tier on accepted chains (rule 6). The error texts and depth are
// the SDKs' diagnostics, reported but never judged. Ten chain_time cases rest on conventions DCP-09 §3.5.2 does not
// state (millisecond precision, signer key validity); they are informative: sent, reported, never pass or fail.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { isDeepStrictEqual } from "util";
import { fileURLToPath } from "url";
import {
  REPO_ROOT, UsageError, InfraError, isObj, exactKeys, sha256, utf8, runProcess, runLevel, parseResponse, LIMITS,
} from "./external.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DELEGATION_CATALOG_PATH = path.join(HERE, "external-delegation-catalog.json");
export const DELEGATION_CONTRACT = "dcp-ai-conformance-external/4";
export const DELEGATION_TIMEOUT_MS = 300000;
export const SUITES = [
  { id: "external.delegation.chain", file: "tests/interop/v2/mandate_chain_vectors.json" },
  { id: "external.delegation.chain_time", file: "tests/interop/v2/mandate_chain_time_vectors.json" },
  { id: "external.delegation.domains", file: "tests/interop/v2/mandate_domain_vectors.json" },
];
export const OP = "verify_mandate_chain";
export const TIERS = ["routine", "standard", "elevated", "maximum"];
// DCP-09 §3.5.2: rules 1 to 7, the preamble (unknown, missing or not comparable input fails closed), and every rule for
// an accepted chain.
export const ANCHORS = ["rule1", "rule2", "rule3", "rule4", "rule5", "rule6", "rule7", "fail_closed", "all_rules"];
// The relation a negative's control has to it, checked on the fixture bytes. None of them claims the two cases differ
// by one defect only: a different mandate can differ in many fields and in its signature.
export const SCOPES = ["same_chain", "single_mandate", "same_shape", "suite"];
// The ten cases whose expected verdict rests on a convention DCP-09 §3.5.2 does not state. Fixed here: a catalog that
// classifies otherwise is refused.
export const BASES = {
  millisecond_precision: {
    document: "spec/VERIFICATION.md (V2-4 timestamps); spec/DCP-09.md implementation notes (informative)",
    reason: "The expected verdict holds only if instants are compared in milliseconds, digits beyond them dropped. VERIFICATION.md states that for bundles; DCP-09 §3.5.2 says RFC 3339 instants, compared as instants, with no precision.",
  },
  signer_key_validity: {
    document: "spec/VERIFICATION.md (V2-13 key validity); spec/DCP-09.md implementation notes (informative)",
    reason: "The chain is rejected only because a signer key's expires_at is past or not an RFC 3339 instant. VERIFICATION.md V2-13 checks key validity for bundles; DCP-09 §3.5.2 does not state it for mandate signer keys.",
  },
};
const T = "external.delegation.chain_time.";
export const INFORMATIVE = {
  [`${T}nested_limits_equal_in_milliseconds_written_differently`]: "millisecond_precision",
  [`${T}windows_at_the_verification_time`]: "millisecond_precision",
  [`${T}verification_time_below_the_millisecond`]: "millisecond_precision",
  [`${T}human_classical_key_expired_one_millisecond_before`]: "signer_key_validity",
  [`${T}human_pq_key_expired_one_millisecond_before`]: "signer_key_validity",
  [`${T}agent_classical_key_expired_one_millisecond_before`]: "signer_key_validity",
  [`${T}agent_pq_key_expired_one_millisecond_before`]: "signer_key_validity",
  [`${T}key_expires_at_without_an_offset`]: "signer_key_validity",
  [`${T}key_expires_at_with_a_trailing_newline`]: "signer_key_validity",
  [`${T}key_expires_at_crossing_into_year_minus_1`]: "signer_key_validity",
};

const HEX64 = /^[0-9a-f]{64}$/;
const need = (cond, msg) => { if (!cond) throw new InfraError(msg); };
const isText = (v) => typeof v === "string" && v.trim() !== "";
const isStringList = (v) => Array.isArray(v) && v.every((s) => typeof s === "string");
const fingerprint = (request) => sha256(Buffer.from(JSON.stringify({ op: OP, ...request }), "utf8"));

// ── Raw JSON slices ───────────────────────────────────────────────

const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

/**
 * A strict RFC 8259 scan of `text` that keeps where every value starts and ends: { type, start, end } plus `members`
 * (a Map, duplicate names refused) for objects and `items` for arrays. Numbers stay text, so nothing is rounded.
 */
export function scanJson(text) {
  let i = 0;
  const fault = (what) => { throw new InfraError(`not strict JSON at offset ${i}: ${what}`); };
  const ws = () => { while (i < text.length && (text[i] === " " || text[i] === "\t" || text[i] === "\n" || text[i] === "\r")) i++; };
  const string = () => {
    const start = i++;
    for (;;) {
      if (i >= text.length) fault("unterminated string");
      const ch = text.charCodeAt(i);
      if (ch === 0x22) { i++; break; }
      if (ch < 0x20) fault("control character in a string");
      if (ch === 0x5c) {
        const e = text[i + 1];
        if (e === "u") { if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) fault("bad \\u escape"); i += 6; }
        else if ('"\\/bfnrt'.includes(e) && e !== undefined) i += 2;
        else fault("bad escape");
      } else i++;
    }
    return { type: "string", start, end: i, value: JSON.parse(text.slice(start, i)) };
  };
  const value = () => {
    ws();
    const start = i;
    const ch = text[i];
    if (ch === "{") {
      i++;
      const members = new Map();
      ws();
      if (text[i] === "}") { i++; return { type: "object", start, end: i, members }; }
      for (;;) {
        ws();
        if (text[i] !== '"') fault("member name expected");
        const name = string().value;
        if (members.has(name)) fault(`duplicate member ${JSON.stringify(name)}`);
        ws();
        if (text[i++] !== ":") fault("':' expected");
        members.set(name, value());
        ws();
        if (text[i] === ",") { i++; continue; }
        if (text[i] === "}") { i++; return { type: "object", start, end: i, members }; }
        fault("',' or '}' expected");
      }
    }
    if (ch === "[") {
      i++;
      const items = [];
      ws();
      if (text[i] === "]") { i++; return { type: "array", start, end: i, items }; }
      for (;;) {
        items.push(value());
        ws();
        if (text[i] === ",") { i++; continue; }
        if (text[i] === "]") { i++; return { type: "array", start, end: i, items }; }
        fault("',' or ']' expected");
      }
    }
    if (ch === '"') return string();
    // Sticky, on the whole text: a number of any length is one token, never cut.
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(text);
    if (m) { i += m[0].length; return { type: "number", start, end: i }; }
    for (const lit of ["true", "false", "null"]) if (text.startsWith(lit, i)) { i += lit.length; return { type: lit, start, end: i }; }
    return fault("value expected");
  };
  const root = value();
  ws();
  if (i !== text.length) fault("data after the document");
  return root;
}

/** The node at `segments` (member names and array indexes) of a scanned document, or undefined. */
export function nodeAt(node, segments) {
  for (const seg of segments) {
    if (node?.type === "object") node = node.members.get(seg);
    else if (node?.type === "array" && Number.isInteger(seg)) node = node.items[seg];
    else return undefined;
  }
  return node;
}

// ── Catalog and fixtures ──────────────────────────────────────────

/** One fixture: its bytes (pinned unless `pinned` is undefined), decoded strictly, scanned and parsed, with the shape every chain corpus has. */
export function loadFixture(root, rel, pinned) {
  let buf;
  try { buf = fs.readFileSync(path.join(root, rel)); } catch (e) { throw new InfraError(`required fixture ${rel} is missing or unreadable (${e.code ?? e.message})`); }
  const digest = sha256(buf);
  need(pinned === undefined || digest === pinned, `fixture ${rel} is not the one the catalog pins (sha256 ${digest}, expected ${pinned})`);
  let text;
  try { text = utf8(buf); } catch (e) { throw new InfraError(`fixture ${rel} is not valid UTF-8 (${e.message})`); }
  let tree;
  try { tree = scanJson(text); } catch (e) { throw new InfraError(`fixture ${rel}: ${e.message}`); }
  const doc = JSON.parse(text);
  need(isObj(doc) && isText(doc.verification_time) && isObj(doc.keys) && Array.isArray(doc.must_accept) && Array.isArray(doc.must_reject),
    `${rel}: needs verification_time, keys, must_accept and must_reject`);
  return { rel, buf, text, tree, doc, sha256: digest };
}

/** The exact bytes of the value at `segments`, checked to parse to the same value as the whole document there. */
function rawAt(fx, segments, where) {
  const node = nodeAt(fx.tree, segments);
  need(node, `${where}: ${segments.join("/")} not found in ${fx.rel}`);
  const slice = fx.text.slice(node.start, node.end);
  let parsed = fx.doc;
  for (const seg of segments) parsed = parsed[seg];
  need(isDeepStrictEqual(JSON.parse(slice), parsed), `${where}: the raw slice does not parse to the fixture's value`);
  return Buffer.from(slice, "utf8");
}

/** Everything one case of a fixture sends and expects, with the raw bytes of its chain, keys and mandates. */
export function fixtureCase(fx, list, index, where) {
  const c = fx.doc[list][index];
  need(isObj(c) && isText(c.name) && Array.isArray(c.chain) && c.chain.length > 0, `${where}: a case needs a name and a non-empty chain`);
  need(!("revoked_mandate_ids" in c) || isStringList(c.revoked_mandate_ids), `${where}: revoked_mandate_ids must be strings`);
  need(!("verification_time" in c) || isText(c.verification_time), `${where}: verification_time must be a string`);
  need(!("keys" in c) || isObj(c.keys), `${where}: keys must be an object`);
  if (list === "must_accept") {
    need(exactKeys(c.expected, ["depth", "effective_tier"]) && Number.isSafeInteger(c.expected.depth) && c.expected.depth >= 0 &&
      (c.expected.effective_tier === null || TIERS.includes(c.expected.effective_tier)), `${where}: expected needs depth and effective_tier`);
  } else {
    need(typeof c.error_contains === "string" ? c.error_contains !== "" && !("errors" in c) : isStringList(c.errors) && c.errors.length > 0,
      `${where}: a rejection carries error_contains or errors`);
  }
  const chain = rawAt(fx, [list, index, "chain"], where);
  const keys = "keys" in c ? rawAt(fx, [list, index, "keys"], where) : rawAt(fx, ["keys"], where);
  const mandates = c.chain.map((_m, j) => rawAt(fx, [list, index, "chain", j], where));
  return {
    name: c.name,
    list,
    index,
    raw: { chain, keys, mandates },
    request: {
      chain_b64: chain.toString("base64"),
      keys_b64: keys.toString("base64"),
      revoked_mandate_ids: c.revoked_mandate_ids ?? [],
      verification_time: c.verification_time ?? fx.doc.verification_time,
    },
    expect: list === "must_accept" ? { valid: true, effective_tier: c.expected.effective_tier } : { valid: false },
    reference: list === "must_accept" ? { depth: c.expected.depth } : "errors" in c ? { errors: c.errors } : { error_contains: c.error_contains },
  };
}

/** Whether `control` relates to `negative` as `scope` says, on the bytes both send. */
export function scopeHolds(scope, negative, control) {
  const same = (a, b) => a.equals(b);
  const sameKeys = same(negative.raw.keys, control.raw.keys);
  const sameTime = negative.request.verification_time === control.request.verification_time;
  const sameRevoked = isDeepStrictEqual(negative.request.revoked_mandate_ids, control.request.revoked_mandate_ids);
  const n = negative.raw.mandates;
  const k = control.raw.mandates;
  if (scope === "same_chain") return same(negative.raw.chain, control.raw.chain) && !(sameKeys && sameTime && sameRevoked);
  if (scope === "single_mandate") return n.length === k.length && n.filter((m, j) => !same(m, k[j])).length === 1 && sameKeys && sameTime && sameRevoked;
  if (scope === "same_shape") return n.length === k.length;
  return false;
}

export function loadDelegationPlan({ root = REPO_ROOT, catalogFile = DELEGATION_CATALOG_PATH, select } = {}) {
  let raw;
  try { raw = fs.readFileSync(catalogFile); } catch (e) { throw new InfraError(`catalog ${catalogFile} is unreadable (${e.code ?? e.message})`); }
  let cat;
  try { cat = JSON.parse(utf8(raw)); } catch (e) { throw new InfraError(`catalog ${catalogFile} is not valid UTF-8 JSON (${e.message})`); }
  need(exactKeys(cat, ["contract", "catalog_version", "fixtures", "informative_bases", "informative", "suites", "limits"]) && cat.contract === DELEGATION_CONTRACT && isText(cat.catalog_version),
    `invalid catalog: needs exactly contract ${DELEGATION_CONTRACT}, catalog_version, fixtures, informative_bases, informative, suites and limits`);
  need(Array.isArray(cat.limits) && cat.limits.length > 0 && cat.limits.every(isText), "invalid catalog: limits must be non-empty strings");
  const files = SUITES.map((s) => s.file);
  need(exactKeys(cat.fixtures, files) && Object.values(cat.fixtures).every((h) => typeof h === "string" && HEX64.test(h)), `invalid catalog: fixtures must pin exactly ${files.join(", ")} by sha256`);
  // The informative classification is fixed by this runner: the catalog restates it, it cannot change it.
  need(isDeepStrictEqual(cat.informative_bases, BASES), "invalid catalog: informative_bases must be the runner's");
  need(isDeepStrictEqual(cat.informative, INFORMATIVE), "invalid catalog: informative must be exactly the runner's ten cases and bases");
  need(Array.isArray(cat.suites) && isDeepStrictEqual(cat.suites.map((s) => s?.id), SUITES.map((s) => s.id)), `invalid catalog: suites must be ${SUITES.map((s) => s.id).join(", ")}, in that order`);

  const fixtures = {};
  const suites = [];
  for (const [n, entry] of cat.suites.entries()) {
    const spec = SUITES[n];
    need(exactKeys(entry, ["id", "title", "source", "claim", "limits", "cases"]) && entry.source === spec.file && isText(entry.title) && isText(entry.claim) &&
      Array.isArray(entry.limits) && entry.limits.every(isText) && Array.isArray(entry.cases), `invalid catalog: suite ${spec.id} needs id, title, source ${spec.file}, claim, limits and cases`);
    const fx = loadFixture(root, spec.file, cat.fixtures[spec.file]);
    fixtures[spec.file] = fx.sha256;
    const names = [...fx.doc.must_accept, ...fx.doc.must_reject].map((c) => c?.name);
    need(new Set(names).size === names.length, `${spec.file}: case names must be unique`);

    // The partition: every case of the fixture exactly once, in the fixture's order, and nothing else.
    const expected = [...fx.doc.must_accept.map((_c, i) => ["must_accept", i]), ...fx.doc.must_reject.map((_c, i) => ["must_reject", i])];
    need(entry.cases.length === expected.length, `${spec.id}: ${entry.cases.length} cases for ${expected.length} in ${spec.file}`);
    const cases = entry.cases.map((e, i) => {
      const [list, index] = expected[i];
      const where = `${spec.id} case ${i}`;
      need(isObj(e) && e.list === list && e.index === index, `${where}: must be ${list}[${index}] (every case once, in the fixture's order)`);
      const f = fixtureCase(fx, list, index, where);
      const id = `${spec.id}.${f.name}`;
      need(e.id === id && e.name === f.name, `${where}: id must be ${id}`);
      const informative = Object.hasOwn(INFORMATIVE, id);
      need(e.class === (informative ? "informative" : "normative"), `${where}: class must be ${informative ? "informative" : "normative"}`);
      if (informative) {
        need(exactKeys(e, ["id", "name", "list", "index", "class", "basis"]) && e.basis === INFORMATIVE[id], `${where}: an informative case has exactly id, name, list, index, class and its basis ${INFORMATIVE[id]}`);
      } else if (list === "must_accept") {
        need(exactKeys(e, ["id", "name", "list", "index", "class", "anchor"]) && e.anchor === "all_rules", `${where}: a normative positive has exactly id, name, list, index, class and anchor all_rules`);
      } else {
        need(exactKeys(e, ["id", "name", "list", "index", "class", "anchor", "controls", "control_scope"]) && ANCHORS.includes(e.anchor) && e.anchor !== "all_rules" &&
          SCOPES.includes(e.control_scope) && Array.isArray(e.controls) && e.controls.length > 0, `${where}: a normative negative has exactly id, name, list, index, class, an anchor of DCP-09 §3.5.2, controls and a control_scope`);
      }
      return {
        id, name: f.name, op: OP, class: e.class, source: `${spec.file}#/${list}/${index}`,
        ...(informative ? { basis: e.basis } : { anchor: e.anchor }),
        ...(e.controls ? { controls: e.controls, control_scope: e.control_scope } : {}),
        request: f.request, expect: f.expect, reference: f.reference, raw: f.raw,
      };
    });
    // Controls: normative positives of the same suite, related to the negative as the catalog says.
    const byId = new Map(cases.map((c) => [c.id, c]));
    const positives = cases.filter((c) => c.class === "normative" && c.expect.valid).map((c) => c.id);
    for (const c of cases.filter((x) => x.controls)) {
      for (const k of c.controls) need(positives.includes(k), `${c.id}: control ${k} must be a normative positive of ${spec.id}`);
      if (c.control_scope === "suite") need(isDeepStrictEqual(c.controls, positives), `${c.id}: a suite control lists every normative positive of ${spec.id}`);
      else {
        need(c.controls.length === 1, `${c.id}: a ${c.control_scope} control is one case`);
        need(scopeHolds(c.control_scope, c, byId.get(c.controls[0])), `${c.id}: ${c.controls[0]} is not ${c.control_scope} on the fixture bytes`);
      }
    }
    suites.push({ id: spec.id, title: entry.title, claim: entry.claim, limits: entry.limits, cases });
  }

  let selected = suites;
  if (select && select.length > 0) {
    const seen = new Set();
    for (const id of select) {
      if (id === "") throw new UsageError("empty suite id");
      if (seen.has(id)) throw new UsageError(`duplicate suite ${id}`);
      if (!suites.some((s) => s.id === id)) throw new UsageError(`unknown suite ${id} (see --list)`);
      seen.add(id);
    }
    selected = select.map((id) => suites.find((s) => s.id === id));
  }
  // Every control is in its negative's suite, so a selected suite always runs the controls it needs.
  need(selected.some((s) => s.cases.some((c) => c.class === "normative")), "the selection has no normative case");
  return { catalog: { version: cat.catalog_version, sha256: sha256(raw), limits: cat.limits, contract: DELEGATION_CONTRACT }, fixtures, suites: selected };
}

// ── Judgement ─────────────────────────────────────────────────────

const RESULT_FIELDS = ["id", "status", "valid", "errors", "effective_tier", "depth"];

/** The answer's own format: types only. A rejection needs no message, depth 0 or a null tier. */
function shapeProblem(r) {
  if (typeof r.valid !== "boolean") return "valid must be a boolean";
  if (!Array.isArray(r.errors) || !r.errors.every((e) => typeof e === "string")) return "errors must be an array of strings";
  if (r.effective_tier !== null && !TIERS.includes(r.effective_tier)) return `effective_tier must be null or one of ${TIERS.join(", ")}`;
  if (!Number.isSafeInteger(r.depth) || r.depth < 0) return "depth must be a non-negative integer";
  return null;
}

/** Diagnostics, never a status: the wording against the fixture's, and the depth of an accepted chain. */
function diagnostics(c, r) {
  if (r.valid) return c.reference.depth === undefined ? {} : { depth: r.depth === c.reference.depth ? "matched" : "differs" };
  if (r.errors.length === 0) return { wording: "no_message" };
  if (c.reference.errors) return { wording: isDeepStrictEqual(r.errors, c.reference.errors) ? "matched" : "differs" };
  if (c.reference.error_contains) return { wording: r.errors.join("\n").toLowerCase().includes(c.reference.error_contains.toLowerCase()) ? "matched" : "differs" };
  return {};
}

/** One result against one case: the transport, the format, then the verdict. */
export function judge(c, results) {
  if (results.length === 0) return { status: "error", kind: "missing", message: "no result for this case" };
  if (results.length > 1) return { status: "error", kind: "duplicate", message: `${results.length} results for this case` };
  const r = results[0];
  if (r.status === "error") return exactKeys(r, ["id", "status", "message"]) && typeof r.message === "string" ? { status: "error", kind: "implementation", message: r.message.slice(0, 500) } : { status: "error", kind: "malformed_result", message: "error needs a message" };
  if (r.status === "unsupported") return exactKeys(r, ["id", "status"]) ? { status: "error", kind: "unsupported", message: `${OP} is not supported by the implementation` } : { status: "error", kind: "malformed_result", message: "unsupported takes no other field" };
  if (r.status !== "ok") return { status: "error", kind: "malformed_result", message: `unknown status ${JSON.stringify(r.status)} (a rejected chain is ok with valid: false)` };
  if (!exactKeys(r, RESULT_FIELDS)) return { status: "error", kind: "malformed_result", message: `an ok result has exactly ${RESULT_FIELDS.slice(2).join(", ")}` };
  const shape = shapeProblem(r);
  if (shape) return { status: "error", kind: "malformed_result", message: shape };
  if (r.valid && r.errors.length > 0) return { status: "error", kind: "contradictory_result", message: "valid: true with errors" };
  const diagnostic = diagnostics(c, r);
  let wrong = null;
  if (r.valid !== c.expect.valid) wrong = `valid=${r.valid}, expected ${c.expect.valid}`;
  else if (c.expect.valid && r.effective_tier !== c.expect.effective_tier) wrong = `effective_tier=${JSON.stringify(r.effective_tier)}, expected ${JSON.stringify(c.expect.effective_tier)} (rule 6)`;
  if (c.class === "informative") return { status: "informative", informative: wrong ? "differs" : "agrees", ...(wrong ? { message: wrong } : {}), diagnostic };
  return wrong ? { status: "fail", kind: "discrepancy", message: wrong, diagnostic } : { status: "pass", diagnostic };
}

/** Runs the plan against argv and returns the report (status pass, fail or error). */
export async function runDelegation({ plan, argv, timeoutMs = DELEGATION_TIMEOUT_MS, run = { id: crypto.randomUUID(), started_at: new Date().toISOString() } }) {
  const nonce = crypto.randomBytes(16).toString("hex");
  const sent = [];
  for (const s of plan.suites) for (const c of s.cases) sent.push({ wire: crypto.randomBytes(8).toString("hex"), c, suite: s.id });
  const request = { contract: DELEGATION_CONTRACT, run_id: run.id, nonce, cases: sent.map(({ wire, c }) => ({ id: wire, op: c.op, ...c.request })) };
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
  // An infrastructure failure is an error for every case, never a rejection.
  const judged = new Map(sent.map(({ wire, c }) => [c.id, fatal ? { status: "error", ...fatal } : judge(c, byWire.get(wire))]));
  // A negative counts only if its controls passed in this run.
  const outcome = new Map();
  for (const { c } of sent) {
    const own = judged.get(c.id);
    const failed = (c.controls ?? []).filter((k) => judged.get(k)?.status !== "pass");
    outcome.set(c.id, failed.length && own.status !== "error"
      ? { status: "error", kind: "control_failed", message: `control(s) did not pass: ${failed.slice(0, 5).join(", ")}${failed.length > 5 ? ", …" : ""}`, ...(own.diagnostic ? { diagnostic: own.diagnostic } : {}) } : own);
  }
  const report = {
    kit: { name: "dcp-ai-conformance-external", contract: DELEGATION_CONTRACT, catalog_version: plan.catalog.version, catalog_sha256: plan.catalog.sha256, fixtures_sha256: plan.fixtures },
    run: { id: run.id, nonce, started_at: run.started_at, finished_at: new Date().toISOString(), node: process.version, request_sha256: sha256(requestBytes), timeout_ms: timeoutMs },
    implementation: { argv, self_declared: implementation, observed },
    selection: plan.suites.map((s) => s.id),
    status: "incomplete",
    totals: { cases: 0, executed: 0, pass: 0, fail: 0, error: 0 },
    informative_totals: { requested: 0, completed: 0, agrees: 0, differs: 0, error: 0 },
    suites: [],
    limits: plan.catalog.limits,
  };
  for (const s of plan.suites) {
    const cases = sent.filter((x) => x.suite === s.id).map(({ c }) => ({
      id: c.id, op: c.op, class: c.class, source: c.source, input_sha256: fingerprint(c.request),
      ...(c.anchor ? { anchor: c.anchor } : { basis: c.basis }),
      ...(c.controls ? { controls: c.controls, control_scope: c.control_scope } : {}),
      expect: c.expect, ...outcome.get(c.id),
    }));
    if (!fatal && extra > 0 && s === plan.suites[0]) cases.push({ id: `${s.id}#extra`, class: "normative", status: "error", kind: "extra", message: `${extra} result(s) with an id that was not sent` });
    const totals = { cases: 0, executed: 0, pass: 0, fail: 0, error: 0 };
    const info = { requested: 0, completed: 0, agrees: 0, differs: 0, error: 0 };
    for (const r of cases) {
      if (r.class === "informative") {
        info.requested++;
        if (r.status === "informative") { info.completed++; info[r.informative]++; } else info.error++;
      } else {
        totals.cases++;
        totals[r.status]++;
        if (r.status !== "error") totals.executed++;
      }
    }
    report.suites.push({ id: s.id, title: s.title, claim: s.claim, limits: s.limits, status: totals.error || info.error ? "error" : totals.fail ? "fail" : "pass", totals, informative_totals: info, cases });
    for (const k of Object.keys(totals)) report.totals[k] += totals[k];
    for (const k of Object.keys(info)) report.informative_totals[k] += info[k];
  }
  // An informative case that did not complete is an error of the run; a run with no normative case executed never passes.
  report.status = report.totals.error || report.informative_totals.error || report.totals.executed === 0 ? "error" : report.totals.fail ? "fail" : "pass";
  return report;
}
