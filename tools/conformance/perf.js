// Performance baseline of the normative V2 verifier in the five SDKs of this checkout (contract dcp-ai-perf/1).
// Six committed workloads, read and never re-signed, the same input bytes, policy and verification instant for every
// SDK; one in-process child per SDK, warmed and timed round-robin, every result checked. Not a benchmark of the
// harness, not a security ranking, no speed threshold. The build record ties the measured artifacts to the
// checkout; it does not certify the supply chain (toolchains, dependency caches, the OS).
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { LIMITS, InfraError, UsageError, isObj, exactKeys, sha256, utf8, runProcess, runLevel } from "./external.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..", "..");
export const CONTRACT = "dcp-ai-perf/1";
export const BUILD_DIR = path.join(HERE, "wrappers", ".build");
export const RECORD_FILE = path.join(BUILD_DIR, "perf-build-record.json");
export const VERIFICATION_TIME = "2026-10-22T00:00:00Z";
export const SDKS = ["ts", "python", "go", "rust", "wasm"];
export const ENTRYPOINTS = {
  ts: "verifySignedBundleV2", python: "verify_signed_bundle_v2", go: "VerifySignedBundleV2At",
  rust: "verify_signed_bundle_v2_at", wasm: "wasm_verify_signed_bundle_v2",
};
export const BOUNDS = { warmup: [1, 200], samples: [1, 1000], rounds: [1, 5], timeoutMs: [1, LIMITS.maxTimeoutMs], buildTimeoutMs: [1, 3600000] };
export const DEFAULTS = { warmup: 20, samples: 100, rounds: 1, timeoutMs: 300000, buildTimeoutMs: 1800000 };

const ARTIFACTS = {
  go: path.join(BUILD_DIR, "perf-go"),
  rust: path.join(BUILD_DIR, "rust-target", "release", "examples", "perf"),
  wasm: path.join(BUILD_DIR, "perf-wasm-pkg"),
};

// ── Workloads (read only) ─────────────────────────────────────────

const read = (root, rel) => {
  try { return JSON.parse(utf8(fs.readFileSync(path.join(root, rel)))); } catch (e) { throw new InfraError(`fixture ${rel}: ${e.message}`); }
};

function mutated(signed, mutations) {
  const out = structuredClone(signed);
  for (const { path: p, value } of mutations) {
    let node = out;
    for (const k of p.slice(0, -1)) node = node[k];
    node[p.at(-1)] = value;
  }
  return out;
}

/** The six workloads, the policy and the fixture hashes. Nothing is written or signed. */
export function loadWorkloads(root = REPO_ROOT) {
  const bundlesRel = "tests/interop/v2/bundle_vectors.json";
  const secondaryRel = "tests/interop/v2/secondary_sha3_vectors.json";
  const B = read(root, bundlesRel);
  const V = read(root, secondaryRel);
  if (V.verification_time !== VERIFICATION_TIME) throw new InfraError(`${secondaryRel}: verification_time is not ${VERIFICATION_TIME}`);
  const reject = (name) => {
    const c = B.must_reject?.find((x) => x.name === name);
    if (!c) throw new InfraError(`${bundlesRel}: no must_reject ${name}`);
    return mutated(B.signed_bundle, c.mutations);
  };
  const secondary = (name) => {
    const c = V.cases?.find((x) => x.name === name);
    if (!c) throw new InfraError(`${secondaryRel}: no case ${name}`);
    return { bundle: { dcp_bundle_version: "2.0", manifest: c.manifest, ...V.base.artifacts, audit_entries: c.audit_entries }, signature: c.signature };
  };
  const list = [
    ["hybrid_ok", `${bundlesRel}#signed_bundle`, B.signed_bundle, true],
    ["classical_sig_invalid", `${bundlesRel}#must_reject/rpr_classical_signature_invalid`, reject("rpr_classical_signature_invalid"), false],
    ["pq_sig_invalid", `${bundlesRel}#must_reject/bundle_pq_signature_invalid`, reject("bundle_pq_signature_invalid"), false],
    ["secondary_root_ok", `${secondaryRel}#cases/root_ok_3_entries`, secondary("root_ok_3_entries"), true],
    ["secondary_root_wrong", `${secondaryRel}#cases/root_wrong_value`, secondary("root_wrong_value"), false],
    ["secondary_all_ok", `${secondaryRel}#cases/mixed_all_three`, secondary("mixed_all_three"), true],
  ];
  if (!isObj(B.default_verifier_policy)) throw new InfraError(`${bundlesRel}: default_verifier_policy missing`);
  const workloads = list.map(([id, source, bundle, verified]) => {
    const bytes = Buffer.from(JSON.stringify(bundle), "utf8");
    return { id, source, bytes, sha256: sha256(bytes), expect: { verified } };
  });
  return {
    workloads, policy: B.default_verifier_policy, policy_sha256: sha256(Buffer.from(JSON.stringify(B.default_verifier_policy))),
    fixtures: { [bundlesRel]: sha256(fs.readFileSync(path.join(root, bundlesRel))), [secondaryRel]: sha256(fs.readFileSync(path.join(root, secondaryRel))) },
  };
}

// ── Build and build record ────────────────────────────────────────

const SKIP = (name) => name === "__pycache__" || name.endsWith(".pyc") || name === ".DS_Store";

/** sha256 of the sorted (relative path, file sha256) list of a tree; caches and the record itself are excluded. */
export function treeDigest(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (SKIP(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && path.resolve(p) !== RECORD_FILE) files.push(`${path.relative(dir, p).split(path.sep).join("/")}\0${sha256(fs.readFileSync(p))}`);
    }
  };
  walk(dir);
  return { files: files.length, sha256: sha256(Buffer.from(files.join("\n"))) };
}

const fileDigest = (p) => (fs.existsSync(p) && fs.statSync(p).isFile() ? sha256(fs.readFileSync(p)) : null);
const LAUNCHER = path.join(HERE, "perf", "launch.mjs");
export const VERSION_TIMEOUT_MS = 20000;

/**
 * Runs one command under runProcess through perf/launch.mjs: one deadline on a monotonic clock, then SIGTERM to the
 * process group, SIGKILL after the grace period and a bounded wait for the pipes (the full LIMITS of external.js).
 */
export async function bounded(argv, { cwd = REPO_ROOT, env = {}, timeoutMs, mode = "log" }) {
  const { stdout, observed } = await runProcess([process.execPath, LAUNCHER, mode, cwd, JSON.stringify(env), "--", ...argv], Buffer.alloc(0), { timeoutMs, limits: LIMITS });
  return { stdout: stdout.toString("utf8"), observed, level: runLevel(observed) };
}

async function toolVersion(argv) {
  const r = await bounded(argv, { mode: "capture", timeoutMs: VERSION_TIMEOUT_MS });
  if (r.level) throw new InfraError(`${argv.join(" ")}: ${r.level.message}`);
  const text = (r.stdout || r.observed.stderr_excerpt).trim();
  if (!text) throw new InfraError(`${argv.join(" ")} printed no version`);
  return text;
}

// What each SDK's measurement depends on: its source tree, manifests and locks, children, artifacts and tools.
const REQUIRES = {
  ts: { sources: ["sdks/typescript/src"], manifests: ["sdks/typescript/package.json", "sdks/typescript/package-lock.json"],
    children: ["tools/conformance/perf/child.mjs", "tools/conformance/perf/ts.mjs"], trees: { dist: "sdks/typescript/dist" } },
  python: { sources: ["sdks/python/dcp_ai"], manifests: ["sdks/python/pyproject.toml"], children: ["tools/conformance/perf/python_perf.py"] },
  go: { sources: ["sdks/go/dcp"], manifests: ["sdks/go/go.mod", "sdks/go/go.sum", "tools/conformance/wrappers/go/go.mod", "tools/conformance/wrappers/go/go.sum"],
    children: ["tools/conformance/wrappers/go/perf/main.go"], files: { binary: ARTIFACTS.go } },
  rust: { sources: ["sdks/rust/src"], manifests: ["sdks/rust/Cargo.toml", "sdks/rust/Cargo.lock", "tools/conformance/wrappers/rust/Cargo.toml", "tools/conformance/wrappers/rust/Cargo.lock"],
    children: ["tools/conformance/wrappers/rust/examples/perf.rs"], files: { binary: ARTIFACTS.rust } },
  wasm: { sources: ["sdks/rust/src"], manifests: ["sdks/rust/Cargo.toml", "sdks/rust/Cargo.lock"],
    children: ["tools/conformance/perf/child.mjs", "tools/conformance/perf/wasm.mjs"],
    files: { wasm: path.join(ARTIFACTS.wasm, "dcp_ai_bg.wasm"), glue: path.join(ARTIFACTS.wasm, "dcp_ai.js"), package_json: path.join(ARTIFACTS.wasm, "package.json") } },
};
const HARNESS = ["tools/conformance-perf.js", "tools/conformance/perf.js", "tools/conformance/perf/launch.mjs", "tools/conformance/external.js"];
export const BUILD_OPTIONS = {
  ts: { command: "npm run build", cwd: "sdks/typescript" },
  go: { command: "go build -mod=readonly -o tools/conformance/wrappers/.build/perf-go ./perf", cwd: "tools/conformance/wrappers/go" },
  rust: { command: "cargo build --example perf --release --locked", manifest: "tools/conformance/wrappers/rust/Cargo.toml", target_dir: "tools/conformance/wrappers/.build/rust-target", features: "default" },
  wasm: { command: "wasm-pack build sdks/rust --target web --release -- --features wasm --locked", out_dir: "tools/conformance/wrappers/.build/perf-wasm-pkg", target_dir: "tools/conformance/wrappers/.build/wasm-target" },
};

async function toolsFor(sdk, root, python) {
  const tsup = () => { try { return JSON.parse(fs.readFileSync(path.join(root, "sdks/typescript/node_modules/tsup/package.json"), "utf8")).version; } catch { return null; } };
  switch (sdk) {
    case "ts": return { node: process.version, tsup: tsup() };
    case "python": return { python: python ? await toolVersion([python, "-I", "-c", "import sys; print(sys.version)"]) : null };
    case "go": return { go: await toolVersion(["go", "version"]) };
    case "rust": return { rustc: await toolVersion(["rustc", "-vV"]), cargo: await toolVersion(["cargo", "-V"]) };
    default: return { node: process.version, rustc: await toolVersion(["rustc", "-vV"]), cargo: await toolVersion(["cargo", "-V"]), wasm_pack: await toolVersion(["wasm-pack", "--version"]) };
  }
}

/**
 * The stable record of the selected SDKs: inputs, artifacts, tool versions and options, only what each selected SDK
 * needs. No time, counter or dirty flag; caches (__pycache__, .pyc) and the record itself are not fingerprinted.
 */
export async function stableRecord(root = REPO_ROOT, { python, sdks = SDKS } = {}) {
  const abs = (rel) => path.join(root, rel);
  const under = (p) => path.join(root, path.relative(REPO_ROOT, p));
  const out = { harness: Object.fromEntries(HARNESS.map((rel) => [rel, fileDigest(abs(rel))])), sdks: {} };
  for (const sdk of sdks) {
    const need = REQUIRES[sdk];
    out.sdks[sdk] = {
      sources: Object.fromEntries(need.sources.map((rel) => [rel, treeDigest(abs(rel))])),
      manifests: Object.fromEntries(need.manifests.map((rel) => [rel, fileDigest(abs(rel))])),
      children: Object.fromEntries(need.children.map((rel) => [rel, fileDigest(abs(rel))])),
      artifacts: {
        ...Object.fromEntries(Object.entries(need.trees ?? {}).map(([k, rel]) => [k, treeDigest(abs(rel))])),
        ...Object.fromEntries(Object.entries(need.files ?? {}).map(([k, p]) => [k, fileDigest(under(p))])),
      },
      tools: await toolsFor(sdk, root, python),
      options: BUILD_OPTIONS[sdk] ?? { source: "checkout, through sys.path" },
    };
  }
  return out;
}

/** Every path where two stable records differ, or a value is missing. */
export function recordDifferences(a, b, at = "") {
  if (isObj(a) && isObj(b)) {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().flatMap((k) => recordDifferences(a[k], b[k], at ? `${at}.${k}` : k));
  }
  if (a === null || a === undefined || b === null || b === undefined) return [`${at || "(root)"}: missing`];
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [`${at}: differs`];
}

const missing = (rec, at = "") => (isObj(rec) ? Object.entries(rec).flatMap(([k, v]) => missing(v, at ? `${at}.${k}` : k)) : rec === null || rec === undefined ? [at] : []);

/** Every stable value a measurement relies on must be present: after a build as much as with --no-build. */
export function requireComplete(stable) {
  const gaps = missing(stable);
  if (gaps.length) throw new InfraError(`the provenance is incomplete (${gaps.slice(0, 12).join(", ")}${gaps.length > 12 ? ", …" : ""}); nothing is measured`);
  return stable;
}

async function step(argv, { cwd, env = {}, deadline }) {
  const timeoutMs = Math.round(deadline - performance.now());
  const command = argv.join(" ");
  if (timeoutMs <= 0) throw new InfraError(`the build deadline passed before: ${command}`);
  const r = await bounded(argv, { cwd, env, timeoutMs });
  const record = { command, cwd: path.relative(REPO_ROOT, cwd) || ".", exit_code: r.observed.exit_code, signal: r.observed.signal, duration_ms: r.observed.duration_ms };
  if (r.level) throw new InfraError(`build step failed (${r.level.message}): ${command}\n${r.observed.stderr_excerpt}`);
  return record;
}

/** Builds what the selected SDKs need, in sequence, under one bounded build deadline (each step bounded by runProcess). */
export async function build(sdks, { offline = false, buildTimeoutMs = DEFAULTS.buildTimeoutMs } = {}) {
  const deadline = performance.now() + buildTimeoutMs;
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  const steps = [];
  if (sdks.includes("ts")) steps.push(await step(["npm", "run", "build"], { cwd: path.join(REPO_ROOT, "sdks", "typescript"), deadline }));
  if (sdks.includes("go")) {
    steps.push(await step(["go", "build", "-mod=readonly", "-o", ARTIFACTS.go, "./perf"], {
      cwd: path.join(HERE, "wrappers", "go"), env: offline ? { GOPROXY: "off", GOFLAGS: "-mod=readonly" } : {}, deadline,
    }));
  }
  if (sdks.includes("rust")) {
    steps.push(await step(["cargo", "build", "--example", "perf", "--release", "--locked", ...(offline ? ["--offline"] : []), "--manifest-path", path.join(HERE, "wrappers", "rust", "Cargo.toml")], {
      cwd: REPO_ROOT, env: { CARGO_TARGET_DIR: path.join(BUILD_DIR, "rust-target") }, deadline,
    }));
  }
  if (sdks.includes("wasm")) {
    fs.rmSync(ARTIFACTS.wasm, { recursive: true, force: true });
    steps.push(await step(["wasm-pack", "build", path.join(REPO_ROOT, "sdks", "rust"), "--target", "web", "--release", "--out-dir", ARTIFACTS.wasm,
      "--mode", offline ? "no-install" : "normal", "--", "--features", "wasm", "--locked", ...(offline ? ["--offline"] : [])], {
      cwd: REPO_ROOT, env: { CARGO_TARGET_DIR: path.join(BUILD_DIR, "wasm-target") }, deadline,
    }));
  }
  return steps;
}

/** Commit and dirty flag, read only and bounded; informational, never compared by --no-build. */
export async function informational(root = REPO_ROOT) {
  const git = async (args) => {
    const r = await bounded(["git", ...args], { cwd: root, mode: "capture", timeoutMs: VERSION_TIMEOUT_MS });
    return r.level ? null : r.stdout.trim();
  };
  const status = await git(["status", "--porcelain"]);
  return { commit: await git(["rev-parse", "HEAD"]), dirty: status === null ? null : status !== "" };
}

export function writeRecord(record, file = RECORD_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
}

/**
 * --no-build: the record must cover every requested SDK, and its stable part for those SDKs (and the harness) must
 * equal a fresh computation; any difference or missing value is an error.
 */
export function verifyRecord(fresh, requested, file = RECORD_FILE) {
  let recorded;
  try { recorded = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { throw new InfraError(`no usable build record at ${file} (${e.code ?? e.message}); build first`); }
  if (!isObj(recorded) || recorded.record_version !== 1 || !isObj(recorded.stable) || !isObj(recorded.stable.sdks)) throw new InfraError("the build record is malformed");
  const uncovered = requested.filter((s) => !isObj(recorded.stable.sdks[s]));
  if (uncovered.length) throw new InfraError(`the build record does not cover ${uncovered.join(", ")}; build them first`);
  const expected = { harness: recorded.stable.harness, sdks: Object.fromEntries(requested.map((s) => [s, recorded.stable.sdks[s]])) };
  const diffs = [...missing(expected).map((p) => `${p}: missing in the record`), ...missing(fresh).map((p) => `${p}: missing now`), ...recordDifferences(expected, fresh)];
  if (diffs.length) throw new InfraError(`the build record does not match this checkout and its artifacts: ${[...new Set(diffs)].slice(0, 12).join("; ")}${diffs.length > 12 ? "; …" : ""}`);
  return recorded;
}

// ── Children, judgement and statistics ───────────────────────────

export function childArgv(sdk, python) {
  return {
    ts: [process.execPath, path.join(HERE, "perf", "ts.mjs")],
    wasm: [process.execPath, path.join(HERE, "perf", "wasm.mjs")],
    python: python ? [python, "-I", path.join(HERE, "perf", "python_perf.py")] : null,
    go: [ARTIFACTS.go],
    rust: [ARTIFACTS.rust],
  }[sdk];
}

const isStringList = (v) => Array.isArray(v) && v.every((e) => typeof e === "string");
const fault = (kind, message) => ({ status: "error", kind, message });

/** Judges one child response: {status: "pass", results} | {status: "fail", ...} | {status: "error", ...}. */
export function judge(sdk, doc, request, workloads) {
  const W = request.warmup;
  const N = request.samples;
  const common = ["contract", "run_id", "nonce", "status", "implementation"];
  if (!isObj(doc) || !(exactKeys(doc, [...common, "results"]) || exactKeys(doc, [...common, "failure"]))) return fault("malformed", "the response is neither a success nor a failure of dcp-ai-perf/1");
  if (doc.contract !== CONTRACT || doc.run_id !== request.run_id || doc.nonce !== request.nonce) return fault("stale", "contract, run_id or nonce is not this run's");
  const impl = doc.implementation;
  if (!exactKeys(impl, ["sdk", "entrypoint", "source", "clock", "unit", "runtime", "loaded"]) || !isObj(impl.runtime) || !isObj(impl.loaded)
      || typeof impl.clock !== "string" || impl.unit !== "ns" || impl.source !== "checkout") return fault("malformed", "implementation has the wrong shape");
  if (impl.sdk !== sdk || impl.entrypoint !== ENTRYPOINTS[sdk]) return fault("identity", `implementation ${impl.sdk}/${impl.entrypoint}, expected ${sdk}/${ENTRYPOINTS[sdk]}`);
  if (sdk === "python") {
    const file = impl.loaded.dcp_ai_file;
    const checkout = path.join(REPO_ROOT, "sdks", "python", "dcp_ai") + path.sep;
    if (typeof file !== "string" || !path.resolve(file).startsWith(checkout)) return fault("identity", `dcp_ai was loaded from ${file}, not from the checkout`);
  }
  const ids = new Map(workloads.map((w) => [w.id, w]));
  if (doc.status === "check_failed") {
    const f = doc.failure;
    if (!exactKeys(f, ["id", "phase", "index", "verified", "errors", "reason"]) || !ids.has(f.id) || !["warmup", "sample"].includes(f.phase)
        || !Number.isSafeInteger(f.index) || f.index < 0 || f.index >= (f.phase === "warmup" ? W : N) || typeof f.verified !== "boolean"
        || !isStringList(f.errors) || !["verdict", "contradiction", "no_errors", "malformed_result"].includes(f.reason)) {
      return fault("malformed", "check_failed has the wrong shape");
    }
    return { status: "fail", kind: "check_failed", message: `${f.id}: ${f.reason} in ${f.phase} ${f.index} (verified ${f.verified}); no timing is reported`, failure: f, implementation: impl };
  }
  if (doc.status !== "ok" || !Array.isArray(doc.results)) return fault("malformed", "status must be ok or check_failed");
  const seen = new Set();
  const results = [];
  for (const r of doc.results) {
    if (!exactKeys(r, ["id", "verified", "errors_first", "warmup_checked", "checked", "samples_ns"])) return fault("malformed", "a result has the wrong fields");
    if (!ids.has(r.id)) return fault("unknown", `result for unknown workload ${JSON.stringify(r.id)}`);
    if (seen.has(r.id)) return fault("duplicate", `two results for ${r.id}`);
    seen.add(r.id);
    if (r.warmup_checked !== W || r.checked !== N) return fault("counts", `${r.id}: warmup_checked ${r.warmup_checked}, checked ${r.checked}; expected ${W} and ${N}`);
    if (!Array.isArray(r.samples_ns) || r.samples_ns.length !== N || !r.samples_ns.every((x) => Number.isSafeInteger(x) && x > 0)) {
      return fault("samples", `${r.id}: samples_ns must be ${N} safe integers greater than 0`);
    }
    if (!isStringList(r.errors_first)) return fault("malformed", `${r.id}: errors_first must be a list of strings`);
    const expect = ids.get(r.id).expect.verified;
    if (r.verified !== expect) return { status: "fail", kind: "verdict", message: `${r.id}: verified ${r.verified}, expected ${expect}`, implementation: impl };
    if (expect && r.errors_first.length) return { status: "fail", kind: "contradiction", message: `${r.id}: verified with errors`, implementation: impl };
    if (!expect && !r.errors_first.length) return { status: "fail", kind: "no_errors", message: `${r.id}: rejected without errors`, implementation: impl };
    results.push(r);
  }
  const absent = workloads.filter((w) => !seen.has(w.id)).map((w) => w.id);
  if (absent.length) return fault("missing", `no result for ${absent.join(", ")}`);
  return { status: "pass", results, implementation: impl };
}

/** Nearest-rank quantile of sorted values: the ceil(q·n)-th smallest. */
const rank = (sorted, q) => sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
export function stats(samples) {
  const s = [...samples].sort((a, b) => a - b);
  const n = s.length;
  const median = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  return { n, min: s[0], median, p90: rank(s, 0.9), p99: rank(s, 0.99), max: s[n - 1], iqr: rank(s, 0.75) - rank(s, 0.25), unit: "ns",
    convention: "median: mean of the two middle values for even n; p25/p75/p90/p99: nearest rank, the ceil(q*n)-th smallest" };
}

/** Runs the selected children in sequence, R rounds each. Returns {status, sdks}. */
export async function runChildren({ sdks, workloads, policy, warmup, samples, rounds, timeoutMs, python, argvFor = childArgv }) {
  const out = [];
  for (let round = 1; round <= rounds; round++) {
    for (const sdk of sdks) {
      const argv = argvFor(sdk, python);
      if (!argv) { out.push({ sdk, round, status: "error", kind: "spawn", message: `no command for ${sdk}` }); continue; }
      const request = {
        contract: CONTRACT, run_id: crypto.randomUUID(), nonce: crypto.randomBytes(16).toString("hex"), verification_time: VERIFICATION_TIME,
        policy, warmup, samples, workloads: workloads.map((w) => ({ id: w.id, input_b64: w.bytes.toString("base64"), input_sha256: w.sha256, expect: w.expect })),
      };
      const { stdout, observed } = await runProcess(argv, Buffer.from(JSON.stringify(request)), { timeoutMs, limits: LIMITS });
      const level = runLevel(observed);
      let verdict;
      if (level) verdict = { status: "error", ...level };
      else {
        let doc;
        try { doc = JSON.parse(utf8(stdout)); } catch (e) { doc = undefined; verdict = fault("invalid_output", `stdout is not one UTF-8 JSON document (${e.message})`); }
        verdict ??= judge(sdk, doc, request, workloads);
      }
      const entry = { sdk, round, argv, observed, status: verdict.status, ...(verdict.kind ? { kind: verdict.kind, message: verdict.message } : {}) };
      if (verdict.implementation) entry.implementation = verdict.implementation;
      if (verdict.failure) entry.failure = verdict.failure;
      if (verdict.status === "pass") {
        entry.results = verdict.results.map((r) => ({ id: r.id, verified: r.verified, errors_first: r.errors_first, stats: stats(r.samples_ns), samples_ns: r.samples_ns }));
      }
      out.push(entry);
    }
  }
  const status = out.some((e) => e.status === "error") ? "error" : out.some((e) => e.status === "fail") ? "fail" : "pass";
  return { status, sdks: out };
}

export function machine() {
  const cpus = os.cpus();
  return { os: os.type(), release: os.release(), arch: os.arch(), cpu: cpus[0]?.model ?? null, cores: cpus.length, memory_bytes: os.totalmem() };
}

export { UsageError, InfraError };
