// External conformance runner (contract dcp-ai-conformance-external/1): validates the external catalog
// against the committed fixtures, sends the selected cases to an implementation chosen by the operator as
// a separate process (argv, no shell), checks its JSON response and judges each case against the
// committed expectation. Nothing is written except the report the CLI asks for.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..", "..");
export const EXTERNAL_CATALOG_PATH = path.join(HERE, "external-catalog.json");
export const CONTRACT = "dcp-ai-conformance-external/1";

export const LIMITS = {
  stdoutBytes: 4 * 1024 * 1024,
  stderrKeptBytes: 64 * 1024,
  stderrExcerptBytes: 4 * 1024,
  termGraceMs: 2000,
  closeWaitMs: 2000,
  timeoutMs: 30000,
  maxTimeoutMs: 600000,
};

export class UsageError extends Error {}
export class InfraError extends Error {}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
// Fatal UTF-8 decoding, BOM kept: invalid bytes are refused, never replaced with U+FFFD.
const utf8 = (buf) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf);
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const OPS = new Set(["canonicalize", "digest"]);
const ALGS = new Set(["sha256", "sha3-256"]);
const HEX64 = /^[0-9a-f]{64}$/;
const isText = (v) => typeof v === "string" && v.trim() !== "";
const isTextList = (v) => Array.isArray(v) && v.every(isText);

/** Strict base64: alphabet, padding, length multiple of 4 and the same string after re-encoding. */
export function decodeBase64Strict(s) {
  if (typeof s !== "string" || s.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return null;
  const buf = Buffer.from(s, "base64");
  return buf.toString("base64") === s ? buf : null;
}

function exactKeys(obj, required, optional = []) {
  if (!isObj(obj)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((k) => k in obj) && Object.keys(obj).every((k) => allowed.has(k));
}

// ── Catalog and fixtures ─────────────────────────────────────────

function resolvePointer(doc, segments, where) {
  let node = doc;
  for (const seg of segments) {
    if (typeof seg !== "string" || seg === "") throw new InfraError(`${where}: path segments must be non-empty strings`);
    if (Array.isArray(node)) {
      const hits = node.filter((v) => isObj(v) && v.name === seg);
      if (hits.length !== 1) throw new InfraError(`${where}: ${hits.length} array members named ${seg}`);
      node = hits[0];
    } else if (isObj(node) && Object.hasOwn(node, seg)) {
      node = node[seg];
    } else {
      throw new InfraError(`${where}: ${seg} not found`);
    }
  }
  return node;
}

function members(node, where) {
  if (Array.isArray(node)) {
    const names = node.map((v) => (isObj(v) && typeof v.name === "string" && v.name !== "" ? v.name : null));
    if (names.includes(null)) throw new InfraError(`${where}: every array member needs a non-empty name`);
    if (new Set(names).size !== names.length) throw new InfraError(`${where}: duplicate member name`);
    return names;
  }
  if (isObj(node)) return Object.keys(node);
  throw new InfraError(`${where}: a collection must be an object or an array`);
}

/** Exactly one of `names` is present in `vec`, and it is a string; returns its name. */
function oneString(vec, names, where) {
  const present = names.filter((k) => Object.hasOwn(vec, k));
  if (present.length !== 1) throw new InfraError(`${where}: needs exactly one of ${names.join(", ")} (has ${present.length})`);
  if (typeof vec[present[0]] !== "string") throw new InfraError(`${where}: ${present[0]} must be a string`);
  return present[0];
}

/**
 * The committed input bytes and expectation of one case. A wrong type, an ambiguous or contradictory
 * expectation, or an `expect` that disagrees with the vector is an InfraError naming what is wrong.
 */
function caseVector(c, vec, where) {
  if (!isObj(vec)) throw new InfraError(`${where}: the vector must be an object`);
  if (c.op === "canonicalize") {
    const hasInput = Object.hasOwn(vec, "input");
    const hasJson = Object.hasOwn(vec, "input_json");
    if (hasInput === hasJson) throw new InfraError(`${where}: needs exactly one of input and input_json`);
    if (hasJson && typeof vec.input_json !== "string") throw new InfraError(`${where}: input_json must be a string`);
    const input = hasJson ? Buffer.from(vec.input_json, "utf8") : Buffer.from(JSON.stringify(vec.input), "utf8");
    if (Object.hasOwn(vec, "expects_error") && typeof vec.expects_error !== "boolean") throw new InfraError(`${where}: expects_error must be a boolean`);
    const canonical = ["expected_canonical", "canonical"].filter((k) => Object.hasOwn(vec, k));
    if (vec.expects_error === true) {
      if (c.expect !== "reject" || canonical.length) throw new InfraError(`${where}: a rejected vector needs expect reject and no canonical value`);
      return { input, expected: null };
    }
    if (c.expect !== "accept") throw new InfraError(`${where}: a vector with a canonical value needs expect accept`);
    return { input, expected: Buffer.from(vec[oneString(vec, ["expected_canonical", "canonical"], where)], "utf8") };
  }
  const text = vec[oneString(vec, ["input_utf8", "canonical_json"], where)];
  const field = Object.hasOwn(vec, "expected_hex") ? oneString(vec, ["expected_hex", "sha256", "sha3_256"], where) : (c.alg === "sha256" ? "sha256" : "sha3_256");
  const expected = vec[field];
  if (c.expect !== "accept" || typeof expected !== "string" || !HEX64.test(expected)) {
    throw new InfraError(`${where}: expect must be accept, with a 64-character lowercase hex ${field}`);
  }
  return { input: Buffer.from(text, "utf8"), expected };
}

/** Loads and validates the catalog and every fixture it names; returns the plan for the selection. */
export function loadPlan({ root = REPO_ROOT, catalogFile = EXTERNAL_CATALOG_PATH, select } = {}) {
  let raw;
  try { raw = fs.readFileSync(catalogFile); } catch (e) { throw new InfraError(`catalog ${catalogFile} is unreadable (${e.code ?? e.message})`); }
  let cat;
  try { cat = JSON.parse(utf8(raw)); } catch (e) { throw new InfraError(`catalog ${catalogFile} is not valid UTF-8 JSON (${e.message})`); }
  const bad = (m) => { throw new InfraError(`invalid catalog: ${m}`); };
  if (!exactKeys(cat, ["contract", "catalog_version", "collections", "suites"], ["limits"])) bad("needs exactly contract, catalog_version, collections, suites (and optional limits)");
  if (cat.contract !== CONTRACT || !isText(cat.catalog_version)) bad(`contract must be ${CONTRACT} and catalog_version a non-empty string`);
  if (cat.limits !== undefined && !isTextList(cat.limits)) bad("limits must be an array of non-empty strings");
  if (!Array.isArray(cat.collections) || !Array.isArray(cat.suites) || cat.suites.length === 0) bad("collections and suites must be arrays, suites non-empty");

  const fixtures = new Map();
  const fixture = (rel) => {
    if (typeof rel !== "string" || rel === "" || path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) bad(`fixture path ${JSON.stringify(rel)} must be relative to the root`);
    if (!fixtures.has(rel)) {
      let buf;
      try { buf = fs.readFileSync(path.join(root, rel)); } catch (e) { throw new InfraError(`required fixture ${rel} is missing or unreadable (${e.code ?? e.message})`); }
      let doc;
      try { doc = JSON.parse(utf8(buf)); } catch (e) { throw new InfraError(`required fixture ${rel} is not valid UTF-8 JSON (${e.message})`); }
      fixtures.set(rel, { doc, sha256: sha256(buf) });
    }
    return fixtures.get(rel).doc;
  };
  const key = (file, segs) => JSON.stringify([file, ...segs]);

  const collections = new Map();
  for (const col of cat.collections) {
    if (!exactKeys(col, ["file", "path", "coverage", "variants"], ["exclude", "members"]) || !Array.isArray(col.path)) bad("every collection needs exactly file, path, coverage, variants (and optional exclude or members)");
    const where = `collection ${col.file}#${col.path.join("/")}`;
    if (collections.has(key(col.file, col.path))) bad(`${where} declared twice`);
    const all = members(resolvePointer(fixture(col.file), col.path, where), where);
    let want;
    if (col.coverage === "all" && col.members === undefined) {
      const exclude = col.exclude ?? [];
      if (!Array.isArray(exclude) || exclude.some((x) => !all.includes(x))) bad(`${where}: every excluded member must exist`);
      want = all.filter((m) => !exclude.includes(m));
    } else if (col.coverage === "listed" && col.exclude === undefined && Array.isArray(col.members) && col.members.length > 0) {
      if (new Set(col.members).size !== col.members.length || col.members.some((m) => !all.includes(m))) bad(`${where}: listed members must be unique and exist`);
      want = col.members;
    } else bad(`${where}: coverage must be "all" (optional exclude) or "listed" (members)`);
    // Every member must be pinned exactly once per variant (operation, and algorithm when given).
    if (!Array.isArray(col.variants) || col.variants.length === 0 ||
        col.variants.some((v) => !exactKeys(v, ["op"], ["alg"]) || !OPS.has(v.op) || (v.alg !== undefined && (v.op !== "digest" || !ALGS.has(v.alg))))) {
      bad(`${where}: variants must be a non-empty array of {op[, alg]}`);
    }
    if (new Set(col.variants.map((v) => JSON.stringify([v.op, v.alg ?? null]))).size !== col.variants.length) bad(`${where}: duplicate variant`);
    collections.set(key(col.file, col.path), { where, want, variants: col.variants, seen: new Map() });
  }

  const ids = new Set();
  const suites = [];
  for (const s of cat.suites) {
    if (!exactKeys(s, ["id", "title", "claim", "cases"], ["limits"]) || !isText(s.id) || !isText(s.title) || !isText(s.claim) ||
        (s.limits !== undefined && !isTextList(s.limits)) || !Array.isArray(s.cases) || s.cases.length === 0) {
      bad("every suite needs non-empty string id, title and claim, optional limits as non-empty strings, and non-empty cases");
    }
    if (ids.has(s.id)) bad(`duplicate id ${s.id}`);
    ids.add(s.id);
    const cases = [];
    for (const c of s.cases) {
      if (!exactKeys(c, ["id", "op", "source", "expect"], ["alg"]) || !isText(c.id) || (c.expect !== "accept" && c.expect !== "reject")) {
        bad(`a case of ${s.id} needs exactly a non-empty id, op, source, expect accept or reject (and alg for digest)`);
      }
      if (ids.has(c.id)) bad(`duplicate id ${c.id}`);
      ids.add(c.id);
      if (!OPS.has(c.op) || (c.op === "digest") !== ALGS.has(c.alg) || (c.op === "canonicalize" && c.alg !== undefined)) bad(`${c.id}: unknown op or alg`);
      if (!exactKeys(c.source, ["file", "path"]) || !Array.isArray(c.source.path) || c.source.path.length === 0) bad(`${c.id}: source needs file and a non-empty path`);
      const parent = collections.get(key(c.source.file, c.source.path.slice(0, -1)));
      const member = c.source.path.at(-1);
      if (!parent) bad(`${c.id}: its vector is not in a declared collection`);
      if (!parent.want.includes(member)) bad(`${c.id}: ${member} is excluded from or not listed in ${parent.where}`);
      const variant = parent.variants.findIndex((v) => v.op === c.op && (v.alg === undefined || v.alg === c.alg));
      if (variant === -1) bad(`${c.id}: ${c.op}${c.alg ? `/${c.alg}` : ""} is not a declared variant of ${parent.where}`);
      const pin = JSON.stringify([member, variant]);
      if (parent.seen.has(pin)) bad(`${c.id}: ${member} is pinned twice for the same variant (with ${parent.seen.get(pin)})`);
      parent.seen.set(pin, c.id);
      const vec = caseVector(c, resolvePointer(fixture(c.source.file), c.source.path, c.id), c.id);
      cases.push({ ...c, ...vec });
    }
    suites.push({ id: s.id, title: s.title, claim: s.claim, limits: s.limits ?? [], cases });
  }
  for (const col of collections.values()) {
    const missing = col.want.flatMap((m) => col.variants.map((v, i) => [m, v, i]))
      .filter(([m, , i]) => !col.seen.has(JSON.stringify([m, i])))
      .map(([m, v]) => `${m} (${v.op}${v.alg ? `/${v.alg}` : ""})`);
    if (missing.length) bad(`${col.where}: not pinned by any case: ${missing.join(", ")}`);
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
  if (selected.reduce((n, s) => n + s.cases.length, 0) === 0) throw new InfraError("the selection has no case");
  return {
    catalog: { version: cat.catalog_version, sha256: sha256(raw), limits: cat.limits ?? [] },
    fixtures: Object.fromEntries([...fixtures].map(([rel, f]) => [rel, f.sha256])),
    suites: selected,
  };
}

// ── Process ──────────────────────────────────────────────────────

/**
 * Runs argv once with `input` on stdin. Ends when the process has exited and its pipes have closed;
 * on the deadline or the stdout limit it signals the process group (SIGTERM, then SIGKILL), waits a
 * bounded time for close, and otherwise destroys the pipes and reports cleanup_incomplete.
 */
export function runProcess(argv, input, { timeoutMs = LIMITS.timeoutMs, limits = LIMITS } = {}) {
  return new Promise((resolve) => {
    const posix = process.platform !== "win32";
    const started = performance.now();
    const observed = {
      exit_code: null, signal: null, duration_ms: null, stdout_bytes: 0, stderr_bytes: 0,
      stderr_truncated: false, stderr_excerpt: "", timed_out: false, output_limit: false,
      cleanup_incomplete: false, group_alive_after_exit: false, spawn_error: null,
    };
    const out = [];
    const err = [];
    let errKept = 0;
    let child;
    let finished = false;
    const timers = [];
    const later = (ms, fn) => timers.push(setTimeout(fn, ms));
    const finish = () => {
      if (finished) return;
      finished = true;
      for (const t of timers) clearTimeout(t);
      if (posix && child?.pid && !observed.cleanup_incomplete) {
        try { process.kill(-child.pid, 0); observed.group_alive_after_exit = true; process.kill(-child.pid, "SIGKILL"); } catch { /* group gone */ }
      }
      const elapsed = performance.now() - started;
      // The deadline is the monotonic time elapsed, even if the timer callback has not run yet.
      if (elapsed > timeoutMs) observed.timed_out = true;
      observed.duration_ms = Math.round(elapsed);
      const stderr = Buffer.concat(err);
      observed.stderr_excerpt = stderr.subarray(0, limits.stderrExcerptBytes).toString("utf8");
      resolve({ stdout: Buffer.concat(out), observed });
    };
    const signalGroup = (sig) => {
      try {
        if (posix) process.kill(-child.pid, sig);
        else child.kill(sig);
      } catch { /* already gone */ }
    };
    let terminating = false;
    const terminate = () => {
      if (terminating || finished) return;
      terminating = true;
      signalGroup("SIGTERM");
      later(limits.termGraceMs, () => {
        signalGroup("SIGKILL");
        later(limits.closeWaitMs, () => {
          observed.cleanup_incomplete = true;
          for (const s of [child.stdin, child.stdout, child.stderr]) s?.destroy();
          child.unref(); // the CLI must not stay alive on a process it could not see close
          finish();
        });
      });
    };

    try {
      child = spawn(argv[0], argv.slice(1), { shell: false, detached: posix, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    } catch (e) {
      observed.spawn_error = e.code ?? e.message;
      finish();
      return;
    }
    child.on("error", (e) => {
      if (child.pid === undefined) {
        observed.spawn_error = e.code ?? e.message;
        finish();
      }
    });
    if (child.pid === undefined) return; // the error event reports the spawn failure

    child.stdout.on("data", (chunk) => {
      observed.stdout_bytes += chunk.length;
      if (observed.stdout_bytes > limits.stdoutBytes) {
        if (!observed.output_limit) { observed.output_limit = true; terminate(); }
        return;
      }
      out.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      observed.stderr_bytes += chunk.length;
      if (errKept < limits.stderrKeptBytes) {
        const part = chunk.subarray(0, limits.stderrKeptBytes - errKept);
        err.push(part);
        errKept += part.length;
      }
      if (observed.stderr_bytes > limits.stderrKeptBytes) observed.stderr_truncated = true;
    });
    child.stdin.on("error", () => { /* EPIPE: the process stopped reading; its exit code and stdout decide */ });
    child.on("exit", (code, signal) => { observed.exit_code = code; observed.signal = signal; });
    child.on("close", finish);
    later(timeoutMs, () => { observed.timed_out = true; terminate(); });
    child.stdin.end(input);
  });
}

// ── Response and judgement ───────────────────────────────────────

const RESULT_FIELDS = {
  ok: { canonicalize: ["output_b64"], digest: ["hex"] },
  rejected: ["code"],
  error: ["message"],
  unsupported: [],
};

function runLevel(observed) {
  if (observed.spawn_error) return { kind: "spawn", message: `cannot start the implementation: ${observed.spawn_error}` };
  if (observed.output_limit) return { kind: "output_limit", message: `stdout exceeded ${LIMITS.stdoutBytes} bytes` };
  if (observed.timed_out) return { kind: "timeout", message: "the process had not exited with its pipes closed before the deadline" };
  if (observed.cleanup_incomplete) return { kind: "timeout", message: "close was not observed; pipes destroyed" };
  if (observed.exit_code !== 0 || observed.signal) return { kind: "process", message: `exit code ${observed.exit_code}, signal ${observed.signal}` };
  return null;
}

function parseResponse(stdout, request) {
  let doc;
  try {
    doc = JSON.parse(utf8(stdout));
  } catch (e) {
    return { error: { kind: "invalid_output", message: `stdout is not one UTF-8 JSON document (${e.message})` } };
  }
  if (!exactKeys(doc, ["contract", "run_id", "nonce", "implementation", "results"]) || !Array.isArray(doc.results) ||
      !exactKeys(doc.implementation, ["name", "version"], ["resolved_from", "runtime"]) ||
      Object.values(doc.implementation).some((v) => typeof v !== "string")) {
    return { error: { kind: "invalid_output", message: "the response must have exactly contract, run_id, nonce, implementation {name, version[, resolved_from, runtime]} and results" } };
  }
  if (doc.contract !== CONTRACT || doc.run_id !== request.run_id || doc.nonce !== request.nonce) {
    return { error: { kind: "stale", message: "contract, run_id or nonce does not match this run" }, implementation: doc.implementation };
  }
  return { doc };
}

function judgeCase(c, results) {
  if (results.length === 0) return { status: "error", kind: "missing", message: "no result for this case" };
  if (results.length > 1) return { status: "error", kind: "duplicate", message: `${results.length} results for this case` };
  const r = results[0];
  const fields = r.status === "ok" ? RESULT_FIELDS.ok[c.op] : RESULT_FIELDS[r.status];
  if (!fields || !exactKeys(r, ["id", "status", ...fields]) || fields.some((f) => typeof r[f] !== "string")) {
    return { status: "error", kind: "malformed_result", message: `result fields do not match status ${JSON.stringify(r.status)}` };
  }
  if (r.status === "error") return { status: "error", kind: "implementation", message: r.message.slice(0, 500) };
  if (r.status === "unsupported") return { status: "error", kind: "unsupported", message: `${c.op} is not supported by the implementation` };
  if (r.status === "rejected") {
    if (r.code !== "parse" && r.code !== "profile") return { status: "error", kind: "malformed_result", message: "code must be parse or profile" };
    return c.expect === "reject" ? { status: "pass", detail: `rejected (${r.code})` } : { status: "fail", kind: "discrepancy", message: `rejected (${r.code}) an input that must be accepted` };
  }
  // The output's format is checked before the expectation: a malformed ok is malformed for every case.
  if (c.op === "digest" && !HEX64.test(r.hex)) return { status: "error", kind: "malformed_result", message: "hex must be 64 lowercase hex characters" };
  const got = c.op === "canonicalize" ? decodeBase64Strict(r.output_b64) : null;
  if (c.op === "canonicalize" && !got) return { status: "error", kind: "malformed_result", message: "output_b64 is not canonical base64" };
  if (c.expect === "reject") return { status: "fail", kind: "discrepancy", message: "accepted an input that must be rejected" };
  if (c.op === "digest") {
    return r.hex === c.expected ? { status: "pass" } : { status: "fail", kind: "discrepancy", message: `got ${r.hex}, expected ${c.expected}` };
  }
  return got.equals(c.expected) ? { status: "pass" }
    : { status: "fail", kind: "discrepancy", message: `got ${JSON.stringify(got.toString("utf8"))}, expected ${JSON.stringify(c.expected.toString("utf8"))}` };
}

/** Runs the plan against argv and returns the report (status pass, fail or error). */
export async function runExternal({ plan, argv, timeoutMs = LIMITS.timeoutMs, run = { id: crypto.randomUUID(), started_at: new Date().toISOString() } }) {
  const runId = run.id;
  const nonce = crypto.randomBytes(16).toString("hex");
  const sent = [];
  for (const s of plan.suites) for (const c of s.cases) sent.push({ wire: crypto.randomBytes(8).toString("hex"), c, suite: s.id });
  const request = {
    contract: CONTRACT,
    run_id: runId,
    nonce,
    cases: sent.map(({ wire, c }) => (c.op === "canonicalize"
      ? { id: wire, op: "canonicalize", profile: "dcp-jcs-v1", input_b64: c.input.toString("base64") }
      : { id: wire, op: "digest", alg: c.alg, input_b64: c.input.toString("base64") })),
  };
  const requestBytes = Buffer.from(JSON.stringify(request), "utf8");
  const startedAt = run.started_at;
  const { stdout, observed } = await runProcess(argv, requestBytes, { timeoutMs });

  let fatal = runLevel(observed);
  let implementation = null;
  const byWire = new Map(sent.map((x) => [x.wire, []]));
  let extra = 0;
  if (!fatal) {
    const parsed = parseResponse(stdout, request);
    implementation = parsed.implementation ?? parsed.doc?.implementation ?? null;
    if (parsed.error) fatal = parsed.error;
    else {
      for (const r of parsed.doc.results) {
        if (isObj(r) && typeof r.id === "string" && byWire.has(r.id)) byWire.get(r.id).push(r);
        else extra++;
      }
    }
  }

  const report = {
    kit: { name: "dcp-ai-conformance-external", contract: CONTRACT, catalog_version: plan.catalog.version, catalog_sha256: plan.catalog.sha256, fixtures_sha256: plan.fixtures },
    run: { id: runId, nonce, started_at: startedAt, finished_at: new Date().toISOString(), node: process.version, request_sha256: sha256(requestBytes), timeout_ms: timeoutMs },
    implementation: { argv, self_declared: implementation, observed },
    selection: plan.suites.map((s) => s.id),
    status: "incomplete",
    totals: { cases: 0, executed: 0, pass: 0, fail: 0, error: 0 },
    suites: [],
    limits: plan.catalog.limits,
  };
  for (const s of plan.suites) {
    const cases = sent.filter((x) => x.suite === s.id).map(({ wire, c }) => ({
      id: c.id, op: c.op, ...(c.alg ? { alg: c.alg } : {}), source: c.source, expect: c.expect,
      input_sha256: sha256(c.input),
      ...(fatal ? { status: "error", ...fatal } : judgeCase(c, byWire.get(wire))),
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

export const exitCodeFor = (status) => (status === "pass" ? 0 : status === "fail" ? 1 : 3);
