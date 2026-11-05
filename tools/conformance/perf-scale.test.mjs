// Self-tests of the bounded workload scaling tool (dcp-ai-perf-scale/1). No timing or memory value is ever asserted:
// only the corpus checks, the protocol, verdicts, stages, counts, units, the deadline, cleanup and provenance. The
// mandatory smoke run builds the artifacts and runs the real children on the smallest size of each dimension
// (W=1, N=2, memory W=1 N=3) into a temporary record; no campaign runs here. With DCP_EXTERNAL_REQUIRE_PYTHON=1 and
// DCP_EXTERNAL_REQUIRE_NATIVE=1 nothing may be skipped.
//
//   DCP_PERF_PYTHON=/path/to/python DCP_EXTERNAL_REQUIRE_PYTHON=1 DCP_EXTERNAL_REQUIRE_NATIVE=1 \
//     node --test tools/conformance/perf-scale.test.mjs        (DCP_PERF_OFFLINE=1 builds offline)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn, spawnSync } from "child_process";
import { createHash } from "crypto";
import { once } from "events";
import { ENTRYPOINTS, REPO_ROOT } from "./perf.js";
import {
  CONTROLS, DIMENSIONS, MANDATE_ENTRYPOINTS, DeadlineError, InfraError, SNAPSHOT_WORST_MS, corpusUnchanged, deadline, generateCorpus, judgeAny,
  judgeRusage, loadCorpus, moduleClosure, pipFreeze, plannedWorkloads, policy, provenanceDifferences, runCampaign, sdksFor, stageProblem,
} from "./perf-scale.js";

const CLI = path.join(REPO_ROOT, "tools", "conformance-perf-scale.js");
const PYTHON = process.env.DCP_PERF_PYTHON ?? process.env.DCP_EXTERNAL_PYTHON;
const REQUIRED = process.env.DCP_EXTERNAL_REQUIRE_PYTHON === "1" && process.env.DCP_EXTERNAL_REQUIRE_NATIVE === "1";
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-perf-scale-"));
process.on("exit", () => fs.rmSync(TMP, { recursive: true, force: true }));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// ── Observing a process without signalling it (POSIX) ──────────
// "absent": kill(pid, 0) gives ESRCH. "zombie": it still exists and ps reports state Z: it has terminated but its parent
// (after an orphaning, init or a subreaper) has not reaped it yet, so its PID is not removed. "alive": it exists in any
// other state. "error": the observation itself failed (EPERM, ps missing or failing, or ps not listing a PID that
// kill still sees); a failing ps is never read as absence. kill(pid, 0) alone cannot tell a zombie from a live process.
const PS = "/bin/ps";
// Explicit outer margin of one observation: a ps still running at its timeout is killed (SIGKILL) and reaped.
const PS_KILL_MARGIN_MS = 1000;
// Below this much time left, no further ps is started: the last state seen is returned instead.
const MIN_PS_MS = 100;
function processState(pid, { ps = PS, timeoutMs = 5000 } = {}) {
  const exists = () => { try { process.kill(pid, 0); return true; } catch (e) { if (e.code === "ESRCH") return false; throw e; } };
  try { if (!exists()) return { state: "absent" }; } catch (e) { return { state: "error", detail: `kill(pid, 0): ${e.code}` }; }
  const r = spawnSync(ps, ["-o", "stat=", "-p", String(pid)], { encoding: "utf8", timeout: Math.max(1, Math.floor(timeoutMs)), killSignal: "SIGKILL" });
  if (r.error || r.signal) return { state: "error", detail: `${ps}: ${r.error?.code ?? r.error?.message ?? `killed by ${r.signal}`}` };
  const stat = r.stdout.trim();
  if (r.status === 0 && stat) return { state: stat.startsWith("Z") ? "zombie" : "alive", stat };
  try { if (r.status === 1 && !stat && !exists()) return { state: "absent" }; } catch { /* reported below */ }
  return { state: "error", detail: `${ps} exit ${r.status}${r.stderr.trim() ? `: ${r.stderr.trim()}` : ""} for a PID that kill(pid, 0) still sees` };
}
const STOPPED = new Set(["absent", "zombie"]);
/**
 * Observes a PID for at most `boundMs` (plus PS_KILL_MARGIN_MS for a ps killed at its timeout): each ps gets the time
 * left as its timeout, the pause between observations never passes the bound, and no ps starts with less than
 * MIN_PS_MS left. It returns as soon as the PID is absent or the observation fails, otherwise at the bound with the
 * last state (alive or zombie). Every distinct state seen is kept, in order, for the diagnosis.
 */
async function awaitStopped(pid, { boundMs = 2000, stepMs = 25, ps = PS } = {}) {
  const started = performance.now();
  const left = () => boundMs - (performance.now() - started);
  const seen = [];
  for (;;) {
    const s = processState(pid, { ps, timeoutMs: left() });
    if (seen.at(-1) !== s.state) seen.push(s.state);
    const out = { ...s, seen, waited_ms: Math.round(performance.now() - started) };
    if (s.state === "absent" || s.state === "error" || left() <= MIN_PS_MS) return out;
    await sleep(Math.min(stepMs, left() - MIN_PS_MS));
  }
}
const describe = (s) => `${s.state} after ${s.waited_ms} ms (states seen: ${s.seen.join(" -> ")}${s.stat ? `; ps stat ${s.stat}` : ""}${s.detail ? `; ${s.detail}` : ""})`;
/** A process must have stopped running (absent, or a zombie its parent has not reaped) within the bound. */
async function assertStopped(pid, what) {
  const s = await awaitStopped(pid);
  assert.ok(STOPPED.has(s.state), `${what}: ${describe(s)}`);
  return s;
}
/** Polls a deterministic condition at most `boundMs`; throws if it never holds. */
async function until(cond, boundMs, what) {
  const end = performance.now() + boundMs;
  while (!cond()) {
    if (performance.now() >= end) throw new Error(`not within ${boundMs} ms: ${what}`);
    await sleep(10);
  }
}
const commandOf = (pid, field = "command") => {
  const r = spawnSync(PS, ["-o", `${field}=`, "-p", String(pid)], { encoding: "utf8", timeout: 5000, killSignal: "SIGKILL" });
  return r.status === 0 ? r.stdout.trim() : "";
};
/** Kills a PID this test started, only if it still runs and its command line is still ours (a PID can be reused). */
function killOwn(pid, marker) {
  if (!Number.isSafeInteger(pid) || pid <= 1 || processState(pid).state !== "alive") return;
  if (commandOf(pid).includes(marker)) { try { process.kill(pid, "SIGKILL"); } catch { /* it ended meanwhile */ } }
}
/** The PIDs a stalled worker recorded, or none if it never wrote them. */
const recorded = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; } };
const recordedPid = (file) => { try { return Number(fs.readFileSync(file, "utf8")); } catch { return undefined; } };
const STALL_MARKER = "process.on('SIGTERM', () => {}); setInterval";
const CORPUS = path.join(TMP, "corpus");
await generateCorpus(CORPUS);
const { policy: POLICY } = policy();
const roomy = () => deadline(600000);

let n = 0;
function cli(args, reportFile = path.join(TMP, `report-${++n}.json`)) {
  const r = spawnSync(process.execPath, [CLI, "--report", reportFile, ...args], { encoding: "utf8", timeout: 1800000 });
  return { code: r.status, report: fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, "utf8")) : null, stderr: r.stderr, stdout: r.stdout };
}
const seed = (file) => fs.writeFileSync(file, JSON.stringify({ kit: { name: "dcp-ai-perf-scale" }, run: { id: "old-run" }, status: "pass", baseline: true }));

// ── Plan and corpus ────────────────────────────────────────────

test("plan: 36 inputs and 171 observations; the smoke keeps 12 inputs and 57 observations", () => {
  const obs = (ws) => ws.reduce((k, w) => k + sdksFor(w.kind).length, 0);
  assert.equal(plannedWorkloads().length, 36);
  assert.equal(obs(plannedWorkloads()), 171);
  assert.equal(plannedWorkloads({ sizes: "small" }).length, 12);
  assert.equal(obs(plannedWorkloads({ sizes: "small" })), 57);
  assert.deepEqual(Object.values(DIMENSIONS).map((d) => d.sizes), [[1024, 16384, 262144], [4, 16, 64], [1, 16, 256], [1, 4, 16]]);
});

/** A copy of the corpus with `edit(dir, manifest)` applied; the manifest is written back as edited. */
function tampered(edit) {
  const dir = fs.mkdtempSync(path.join(TMP, "tampered-"));
  for (const f of fs.readdirSync(CORPUS)) fs.copyFileSync(path.join(CORPUS, f), path.join(dir, f));
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  edit(dir, manifest);
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
  return dir;
}
const entry = (m, id) => m.workloads.find((w) => w.id === id);
const rewrite = (dir, m, id, bytes) => { fs.writeFileSync(path.join(dir, `${id}.json`), bytes); Object.assign(entry(m, id), { bytes: bytes.length, sha256: sha(bytes) }); };
const read = (dir, id) => fs.readFileSync(path.join(dir, `${id}.json`));

test("corpus: the generated corpus loads; every tampering is refused before any child", () => {
  assert.equal(loadCorpus(CORPUS).workloads.length, 36);
  assert.equal(loadCorpus(CORPUS, { sizes: "small" }).workloads.length, 12);
  for (const [label, edit, pattern] of [
    ["an extra file", (dir) => fs.writeFileSync(path.join(dir, "extra.json"), "{}"), /extra: extra\.json/],
    ["a missing file", (dir) => fs.rmSync(path.join(dir, "audit_16_valid.json")), /missing: audit_16_valid\.json/],
    ["a symlink", (dir) => { fs.rmSync(path.join(dir, "bytes_1024_valid.json")); fs.symlinkSync(path.join(CORPUS, "bytes_1024_valid.json"), path.join(dir, "bytes_1024_valid.json")); }, /not a regular file/],
    ["an oversized file", (dir) => fs.writeFileSync(path.join(dir, "bytes_1024_valid.json"), Buffer.alloc(1024 * 1024 + 1, 32)), /over 1048576/],
    ["a byte flipped, hashes untouched", (dir) => { const b = read(dir, "nesting_4_valid"); b[10] ^= 1; fs.writeFileSync(path.join(dir, "nesting_4_valid.json"), b); }, /does not match its length or sha256/],
    ["an arbitrary expected=false", (_dir, m) => { entry(m, "audit_1_valid").expect.verified = false; }, /not audit_1_valid as the code defines it/],
    ["a control kind changed", (_dir, m) => { entry(m, "audit_1_stale").control = "schema"; }, /not audit_1_stale as the code defines it/],
    ["a traversing file name", (_dir, m) => { entry(m, "audit_1_stale").file = "../audit_1_stale.json"; }, /as the code defines it/],
    ["a duplicated id", (_dir, m) => { m.workloads[1].id = m.workloads[0].id; }, /as the code defines it/],
    ["valid and stale swapped", (dir, m) => { const v = read(dir, "bytes_1024_valid"); const s = read(dir, "bytes_1024_stale"); rewrite(dir, m, "bytes_1024_valid", s); rewrite(dir, m, "bytes_1024_stale", v); }, /does not end its grown part with STALEMARK0/],
    ["a nesting stale with the valid terminal", (dir, m) => rewrite(dir, m, "nesting_16_stale", read(dir, "nesting_16_valid")), /nesting_16_stale does not end its grown part with STALEMARK1/],
    ["a stale with a second byte changed", (dir, m) => { const b = read(dir, "audit_16_stale"); b[20] = b[20] === 0x61 ? 0x62 : 0x61; rewrite(dir, m, "audit_16_stale", b); }, /exactly the sentinel byte changed|not UTF-8 JSON|does not hold|integrity|schema-valid/],
    ["a size smaller than declared", (dir, m) => { const d = JSON.parse(read(dir, "audit_16_valid")); d.bundle.audit_entries.pop(); d.bundle.manifest.audit_count = 15; rewrite(dir, m, "audit_16_valid", Buffer.from(JSON.stringify(d))); }, /does not hold 16 audit entries/],
    ["a schema control changed elsewhere too", (dir, m) => { const d = JSON.parse(read(dir, "bytes_1024_schema")); d.bundle.intent.payload.requires_consent = true; rewrite(dir, m, "bytes_1024_schema", Buffer.from(JSON.stringify(d))); }, /differs from bytes_1024_valid elsewhere/],
    ["a schema control without its change", (dir, m) => rewrite(dir, m, "mandates_4_schema", read(dir, "mandates_4_valid")), /does not carry its schema change/],
    ["a re-signed stale (no longer stale)", (dir, m) => rewrite(dir, m, "mandates_4_stale", read(dir, "mandates_4_valid")), /mandates_4_stale does not end its grown part with STALEMARK1/],
    ["another policy", (_dir, m) => { m.policy_sha256 = "0".repeat(64); }, /not a corpus of this contract, instant and policy/],
  ]) {
    const dir = tampered(edit);
    assert.throws(() => loadCorpus(dir), (e) => e instanceof InfraError && pattern.test(e.message), label);
  }
  const big = fs.mkdtempSync(path.join(TMP, "manifest-"));
  fs.writeFileSync(path.join(big, "manifest.json"), Buffer.alloc(1024 * 1024 + 1, 32));
  assert.throws(() => loadCorpus(big), /manifest\.json is 1048577 bytes, over/);
});

test("corpus: a file changed after loading is detected by the after-run check", () => {
  const dir = tampered(() => {});
  const c = loadCorpus(dir);
  assert.equal(corpusUnchanged(dir, c), true);
  const b = read(dir, "bytes_16384_valid");
  b[b.length - 2] ^= 1;
  fs.writeFileSync(path.join(dir, "bytes_16384_valid.json"), b);
  assert.equal(corpusUnchanged(dir, c), false);
});

// ── Stage of the negatives ─────────────────────────────────────

const W = (id) => plannedWorkloads().find((w) => w.id === id);
test("stage: each negative must show its control's category, from the SDKs' own diagnostics", () => {
  const ok = [
    ["bytes_1024_schema", ["schema: /bundle/intent/payload/estimated_impact enum"]],
    ["audit_256_stale", ["Manifest audit_merkle_root mismatch"]],
    ["nesting_64_stale", ["intent: payload_hash mismatch", "Manifest intent_hash mismatch"]],
    ["mandates_1_stale", ["mandate[0]: human_composite_sig does not verify"]],
    ["mandates_16_stale", ["mandate[15]: delegator_composite_sig does not verify"]],
    ["mandates_4_schema", ["mandate[0]: missing or invalid mandate_id"]],
  ];
  for (const [id, errors] of ok) assert.equal(stageProblem(W(id), errors), null, id);
  for (const [id, errors] of [
    ["bytes_1024_schema", ["intent: payload_hash mismatch"]],
    ["bytes_1024_schema", ["schema: /bundle/intent/payload/estimated_impact enum", "intent: payload_hash mismatch"]],
    ["bytes_1024_stale", ["schema: /bundle/intent/payload/x enum", "intent: payload_hash mismatch"]],
    ["audit_16_stale", ["intent: payload_hash mismatch"]],
    ["mandates_16_stale", ["mandate[14]: delegator_composite_sig does not verify"]],
    ["mandates_4_stale", ["mandate[0]: missing or invalid mandate_id", "mandate[3]: delegator_composite_sig does not verify"]],
    ["mandates_4_schema", ["mandate[3]: delegator_composite_sig does not verify"]],
  ]) assert.notEqual(stageProblem(W(id), errors), null, `${id} ${errors}`);
});

// ── Memory documents ───────────────────────────────────────────

const rusageDoc = (o = {}) => ({
  format: "dcp-ai-perf-rusage/1", platform: "darwin", child: { exit_code: 0, signal: null }, stdout_over_limit: false, stdout_b64: Buffer.from("{}").toString("base64"),
  wall_ns: 1000, utime_ns: 10, stime_ns: 10, ru_maxrss_raw: 4096, ru_maxrss_unit: "bytes", peak_rss_bytes: 4096, unavailable_reason: null, ...o,
});
test("memory: units are normalized; unsafe, zero, inconsistent or substituted values are refused", () => {
  assert.equal(judgeRusage(rusageDoc()).memory.peak_rss_bytes, 4096);
  assert.equal(judgeRusage(rusageDoc({ platform: "linux", ru_maxrss_unit: "KiB", ru_maxrss_raw: 4, peak_rss_bytes: 4096 })).memory.peak_rss_bytes, 4096);
  const unknown = judgeRusage(rusageDoc({ platform: "sunos5", ru_maxrss_raw: null, ru_maxrss_unit: null, peak_rss_bytes: null, unavailable_reason: "unit not known" }));
  assert.deepEqual([unknown.memory.peak_rss_bytes, unknown.memory.heap_bytes], [null, null], "unavailable, never 0");
  for (const [label, o, kind] of [
    ["linux overflow", { platform: "linux", ru_maxrss_unit: "KiB", ru_maxrss_raw: Number.MAX_SAFE_INTEGER, peak_rss_bytes: Number.MAX_SAFE_INTEGER * 1024 }, "memory_malformed"],
    ["zero", { ru_maxrss_raw: 0, peak_rss_bytes: 0 }, "memory_malformed"],
    ["fraction", { ru_maxrss_raw: 1.5, peak_rss_bytes: 1.5 }, "memory_malformed"],
    ["wrong unit", { ru_maxrss_unit: "KiB" }, "memory_malformed"],
    ["not normalized", { peak_rss_bytes: 4097 }, "memory_malformed"],
    ["0 substituted for unknown", { platform: "sunos5", ru_maxrss_raw: 0, ru_maxrss_unit: null, peak_rss_bytes: 0, unavailable_reason: "x" }, "memory_malformed"],
    ["unknown without reason", { platform: "sunos5", ru_maxrss_raw: null, ru_maxrss_unit: null, peak_rss_bytes: null, unavailable_reason: null }, "memory_malformed"],
    ["zero wall time", { wall_ns: 0 }, "memory_malformed"],
    ["negative cpu", { utime_ns: -1 }, "memory_malformed"],
    ["extra field", { extra: 1 }, "memory_malformed"],
    ["wrong format", { format: "other/1" }, "memory_malformed"],
    ["child failed", { child: { exit_code: 7, signal: null } }, "process"],
    ["child killed", { child: { exit_code: null, signal: 9 } }, "process"],
    ["over the stdout limit", { stdout_over_limit: true }, "output_limit"],
    ["non-canonical base64", { stdout_b64: "e30" }, "memory_malformed"],
  ]) {
    const v = judgeRusage(rusageDoc(o));
    assert.deepEqual([v.status, v.kind], ["error", kind], label);
  }
});

// ── Mandate judgement adapter ──────────────────────────────────

test("mandate children: own contract and entry points, the rest judged as dcp-ai-perf/1", () => {
  const ws = plannedWorkloads({ sizes: "small" }).filter((w) => w.kind === "mandate");
  const request = { run_id: "r", nonce: "n", warmup: 1, samples: 2 };
  const doc = (o = {}) => ({ contract: "dcp-ai-perf-mandate/1", run_id: "r", nonce: "n", status: "ok",
    implementation: { sdk: "go", entrypoint: MANDATE_ENTRYPOINTS.go, source: "checkout", clock: "c", unit: "ns", runtime: {}, loaded: {} },
    results: ws.map((w) => ({ id: w.id, verified: w.expect.verified, errors_first: w.expect.verified ? [] : ["x"], warmup_checked: 1, checked: 2, samples_ns: [1, 2] })), ...o });
  assert.equal(judgeAny("mandate", "go", doc(), request, ws).status, "pass");
  assert.equal(judgeAny("mandate", "go", doc(), request, ws).implementation.entrypoint, "VerifyMandateChain");
  for (const [label, d, kind] of [
    ["bundle contract", doc({ contract: "dcp-ai-perf/1" }), "stale"],
    ["bundle entrypoint", doc({ implementation: { ...doc().implementation, entrypoint: ENTRYPOINTS.go } }), "identity"],
    ["stale nonce", doc({ nonce: "old" }), "stale"],
    ["unit", doc({ implementation: { ...doc().implementation, unit: "ms" } }), "malformed"],
    ["missing result", doc({ results: doc().results.slice(1) }), "missing"],
  ]) assert.deepEqual([judgeAny("mandate", "go", d, request, ws).status, judgeAny("mandate", "go", d, request, ws).kind], ["error", kind], label);
});

// ── Fake children and launchers through runCampaign ────────────

const FAKE = path.join(TMP, "fake.mjs");
fs.writeFileSync(FAKE, `
import fs from "fs";
const [mode, kind, sdk] = process.argv.slice(2);
const ENTRY = ${JSON.stringify({ bundle: ENTRYPOINTS, mandate: MANDATE_ENTRYPOINTS })};
if (mode === "hang") { process.on("SIGTERM", () => {}); setInterval(() => {}, 1000); }
else {
  const req = JSON.parse(fs.readFileSync(0, "utf8"));
  const errorsOf = (id) => {
    const [dim, size, control] = id.split("_");
    if (control === "valid") return [];
    if (dim === "mandates") return [control === "schema" ? "mandate[0]: missing or invalid mandate_id" : \`mandate[\${size - 1}]: \${size === "1" ? "human" : "delegator"}_composite_sig does not verify\`];
    if (control === "schema") return ["schema: /bundle/intent/payload/estimated_impact enum"];
    return [dim === "audit" ? "Manifest audit_merkle_root mismatch" : "intent: payload_hash mismatch"];
  };
  const doc = { contract: req.contract, run_id: req.run_id, nonce: req.nonce, status: "ok",
    implementation: { sdk, entrypoint: ENTRY[kind][sdk], source: "checkout", clock: "fake", unit: "ns", runtime: {},
      loaded: sdk === "python" ? { dcp_ai_file: ${JSON.stringify(path.join(REPO_ROOT, "sdks", "python", "dcp_ai", "__init__.py"))} } : {} },
    results: req.workloads.map((w) => ({ id: w.id, verified: w.expect.verified, errors_first: errorsOf(w.id), warmup_checked: req.warmup, checked: req.samples,
      samples_ns: Array.from({ length: req.samples }, (_, i) => 1000 + i) })) };
  const r = doc.results;
  if (mode === "accept-all") for (const x of r) { x.verified = true; x.errors_first = []; }
  if (mode === "reject-all") for (const x of r) { x.verified = false; x.errors_first = ["fast"]; }
  if (mode === "stale-nonce") doc.nonce = "old";
  if (mode === "missing") r.pop();
  if (mode === "duplicate") r.push({ ...r[0] });
  if (mode === "unknown") r[0].id = "other";
  if (mode === "counts") r[0].checked += 1;
  if (mode === "zero-sample") r[0].samples_ns[0] = 0;
  if (mode === "unit") doc.implementation.unit = "us";
  if (mode === "stale-as-schema") for (const x of r) if (x.id.endsWith("_stale")) x.errors_first = ["schema: /bundle x"];
  if (mode === "schema-unmarked") for (const x of r) if (x.id.endsWith("_schema")) x.errors_first = ["rejected"];
  if (mode === "invalid-json") { process.stdout.write("{"); process.exit(0); }
  process.stdout.write(JSON.stringify(doc));
  if (mode === "exit-after-json") process.exit(1);
}
`);
const LAUNCHER = path.join(TMP, "launcher.mjs");
// Like perf/rusage.py: the child inherits this process's stdin (the request) and its stdout is collected. (An earlier
// version passed the request through spawnSync's input to a child reading fs.readFileSync(0), a combination that hung
// in about 1 run out of 8 on this machine: a defect of that fake, never of an SDK or of rusage.py.)
fs.writeFileSync(LAUNCHER, `
import { spawn } from "child_process";
const mode = process.argv[2];
const child = process.argv.slice(4);
if (mode === "hang") { process.on("SIGTERM", () => {}); setInterval(() => {}, 1000); }
else {
  const p = spawn(child[0], child.slice(1), { stdio: ["inherit", "pipe", "inherit"] });
  const out = [];
  p.stdout.on("data", (c) => out.push(c));
  p.on("close", (code) => {
    const doc = { format: "dcp-ai-perf-rusage/1", platform: "linux", child: { exit_code: code, signal: null }, stdout_over_limit: false,
      stdout_b64: Buffer.concat(out).toString("base64"), wall_ns: 5, utime_ns: 1, stime_ns: 1, ru_maxrss_raw: 100, ru_maxrss_unit: "KiB", peak_rss_bytes: 102400, unavailable_reason: null };
    if (mode === "overflow") Object.assign(doc, { ru_maxrss_raw: Number.MAX_SAFE_INTEGER, peak_rss_bytes: Number.MAX_SAFE_INTEGER * 1024 });
    if (mode === "zero") Object.assign(doc, { ru_maxrss_raw: 0, peak_rss_bytes: 0 });
    if (mode === "unknown-as-zero") Object.assign(doc, { platform: "aix", ru_maxrss_unit: null, peak_rss_bytes: 0, ru_maxrss_raw: null, unavailable_reason: "x" });
    if (mode === "missing-stdout") delete doc.stdout_b64;
    process.stdout.write(mode === "garbage" ? "not json" : JSON.stringify(doc));
  });
}
`);
const SMALL = loadCorpus(CORPUS, { sizes: "small" }).workloads;
const bytesSmall = SMALL.filter((w) => w.dimension === "bytes");
const mandatesSmall = SMALL.filter((w) => w.dimension === "mandates");
// A generous cap (fake children start in about 0.1 s; a loaded machine must not turn a faithful run into a timeout);
// only the hang cases use a short one.
const campaign = (ws, { mode = "faithful", memMode = "faithful", phases = ["latency", "memory"], kinds, clock = roomy(), timeoutMs = 30000 } = {}) => runCampaign({
  workloads: ws, policy: POLICY, phases, warmup: 2, samples: 3, rounds: 1, timeoutMs, python: null, clock,
  argvFor: (kind, sdk) => (kinds && !kinds.includes(sdk) ? null : [process.execPath, FAKE, mode, kind, sdk]),
  launcherArgv: [process.execPath, LAUNCHER, memMode, "--"],
});

test("fake children: a faithful run passes with exact counts; every lie is a fail or an error with no timing", async () => {
  const ok = await campaign([...bytesSmall, ...mandatesSmall]);
  assert.equal(ok.status, "pass", JSON.stringify([...ok.latency, ...ok.memory].filter((e) => e.status !== "pass").slice(0, 2)));
  assert.deepEqual([ok.counts.observations, ok.counts.latency_groups, ok.counts.memory_children, ok.counts.not_run], [27, 9, 27, 0]);
  assert.equal(ok.counts.latency_checked_calls, 27 * 5);
  assert.equal(ok.memory[0].memory.peak_rss_bytes, 102400);
  for (const [mode, status, kind] of [
    ["accept-all", "fail", "verdict"], ["reject-all", "fail", "verdict"], ["stale-nonce", "error", "stale"], ["missing", "error", "missing"],
    ["duplicate", "error", "duplicate"], ["unknown", "error", "unknown"], ["counts", "error", "counts"], ["zero-sample", "error", "samples"],
    ["unit", "error", "malformed"], ["stale-as-schema", "fail", "stage"], ["schema-unmarked", "fail", "stage"], ["invalid-json", "error", "invalid_output"],
    ["exit-after-json", "error", "process"], ["hang", "error", "timeout"],
  ]) {
    const out = await campaign(mode === "hang" ? bytesSmall.slice(0, 1) : bytesSmall, { mode, phases: ["latency"], kinds: ["go"], ...(mode === "hang" ? { timeoutMs: 3000 } : {}) });
    const e = out.latency.find((x) => x.sdk === "go");
    assert.deepEqual([e.status, e.error_kind], [status, kind], mode);
    assert.notEqual(out.status, "pass", mode);
    assert.equal(e.results, undefined, `${mode}: no timing is presented`);
  }
});

test("fake launchers: memory lies are errors; the child's verdicts and stages are judged too", async () => {
  for (const [memMode, mode, kind] of [
    ["overflow", "faithful", "memory_malformed"], ["zero", "faithful", "memory_malformed"], ["unknown-as-zero", "faithful", "memory_malformed"],
    ["missing-stdout", "faithful", "memory_malformed"], ["garbage", "faithful", "memory_malformed"], ["hang", "faithful", "timeout"],
    ["faithful", "accept-all", "verdict"], ["faithful", "stale-as-schema", "stage"], ["faithful", "exit-after-json", "process"],
  ]) {
    const out = await campaign(bytesSmall.slice(1, 2), { mode, memMode, phases: ["memory"], kinds: ["rust"], ...(memMode === "hang" ? { timeoutMs: 3000 } : {}) });
    const e = out.memory.find((x) => x.sdk === "rust");
    assert.equal(e.error_kind, kind, `${memMode}/${mode}: ${e.message}`);
    assert.ok(["fail", "error"].includes(e.status) && out.status !== "pass" && !e.memory, `${memMode}/${mode}`);
  }
});

// ── Deadline, slow snapshots and cleanup ───────────────────────

test("deadline: a step starts only if it fits; a child is capped by what is left", async () => {
  let t = 0;
  const c = deadline(20000, () => t);
  assert.equal(c.cap(60000, "x"), 15000, "min(cap, left - cleanup reserve)");
  t = 14500;
  assert.throws(() => c.cap(60000, "x"), DeadlineError);
  assert.throws(() => deadline(SNAPSHOT_WORST_MS).require(SNAPSHOT_WORST_MS, "a snapshot"), DeadlineError, "the reserve is on top of the worst case");
  assert.doesNotThrow(() => deadline(SNAPSHOT_WORST_MS + 6000).require(SNAPSHOT_WORST_MS, "a snapshot"));
  const late = await campaign(bytesSmall, { phases: ["latency"], clock: deadline(5500) });
  assert.equal(late.status, "error");
  assert.match(late.stopped, /deadline/);
  assert.equal(late.counts.not_run, 5, "the children that could not start are counted, not dropped");
});

test("observer: absent, zombie, alive and failed observations are told apart; only absent or zombie counts as stopped", async () => {
  const live = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  try {
    assert.equal(processState(live.pid).state, "alive");
    const s = await awaitStopped(live.pid, { boundMs: 200 });
    assert.deepEqual([s.state, STOPPED.has(s.state)], ["alive", false], "a process still running at the bound is rejected");
    assert.ok(s.waited_ms <= 200 + PS_KILL_MARGIN_MS, `within the bound (${s.waited_ms} ms)`);
    assert.equal(processState(live.pid, { ps: path.join(TMP, "no-such-ps") }).state, "error", "a missing ps is an error, not absence");
    const silent = path.join(TMP, "silent-ps");
    fs.writeFileSync(silent, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const e = await awaitStopped(live.pid, { ps: silent });
    assert.deepEqual([e.state, e.seen], ["error", ["error"]], "ps failing silently while kill still sees the PID is an error, at once");
    const hung = path.join(TMP, "hung-ps");
    fs.writeFileSync(hung, "#!/bin/sh\ntrap '' TERM\nexec sleep 30\n", { mode: 0o755 }); // ignores SIGTERM, as sleep inherits
    const started = performance.now();
    const h = await awaitStopped(live.pid, { boundMs: 500, ps: hung });
    const took = performance.now() - started;
    assert.deepEqual([h.state, h.seen], ["error", ["error"]], `a ps that hangs and ignores SIGTERM is an error (${describe(h)})`);
    assert.ok(took <= 500 + PS_KILL_MARGIN_MS, `a hung ps is cut within the bound plus the margin (${Math.round(took)} ms)`);
  } finally { live.kill("SIGKILL"); }
  // A child that ends during the wait: it waits for its stdin, the first observation of awaitStopped runs synchronously
  // (alive), and only then is it released. Between its exit and its parent's reaping it may be seen as a zombie: a
  // legitimate transition. The end must be absent; no error, no process still running.
  const dying = spawn(process.execPath, ["-e", "process.stdin.once('data', () => process.exit(0))"], { stdio: ["pipe", "ignore", "ignore"] });
  try {
    const pending = awaitStopped(dying.pid, { boundMs: 5000 });
    dying.stdin.write("go\n");
    const d = await pending;
    assert.equal(d.state, "absent", `alive, then gone within the bound: ${describe(d)}`);
    assert.ok(["alive>absent", "alive>zombie>absent"].includes(d.seen.join(">")), `alive, then gone within the bound: ${describe(d)}`);
  } finally {
    dying.stdin.destroy();
    if (processState(dying.pid).state === "alive") dying.kill("SIGKILL");
  }
  const done = spawn(process.execPath, ["-e", "0"], { stdio: "ignore" });
  await once(done, "exit");
  assert.equal(processState(done.pid).state, "absent", "exited and reaped by its parent");
  // A zombie, made deterministically: the shell starts a child blocked on its stdin, prints its PID and replaces itself
  // with sleep (which never reaps). Only once ps shows the parent running sleep is the child released; it then exits
  // and stays unreaped.
  const parent = spawn("/bin/sh", ["-c", "exec 3<&0; (read x <&3) & echo $!; exec sleep 30"], { stdio: ["pipe", "pipe", "ignore"] });
  try {
    const child = Number(String((await once(parent.stdout, "data"))[0]).trim());
    await until(() => /(^|\/)sleep$/.test(commandOf(parent.pid, "comm")), 5000, "the parent has replaced the shell with sleep");
    assert.equal(processState(child).state, "alive", "the child waits for its release");
    parent.stdin.write("go\n");
    await until(() => processState(child).state === "zombie", 5000, "the released child is a zombie");
    const w = await awaitStopped(child, { boundMs: 200 });
    assert.deepEqual([w.state, STOPPED.has(w.state)], ["zombie", true], "not running, although its PID is not removed");
  } finally {
    parent.stdin.end(); // a child still blocked on its stdin reads EOF and exits
    parent.kill("SIGKILL");
  }
});

test("a slow snapshot step (pip freeze) is cut at what the deadline leaves, and its process stops running", async () => {
  const pidFile = path.join(TMP, "slow.pid");
  const slow = path.join(TMP, "slow-python");
  fs.writeFileSync(slow, `#!${process.execPath}\nrequire("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nprocess.on("SIGTERM", () => {});\nsetInterval(() => {}, 1000);\n`, { mode: 0o755 });
  const started = performance.now();
  let r;
  let observed;
  try {
    r = await pipFreeze(slow, deadline(8000));
    // When the runner's pipes close, the killed process may not have been reaped yet: a zombie (its parent died first,
    // so init or a subreaper reaps it) or still exiting. kill(pid, 0) succeeds in both cases; the state is observed.
    observed = await awaitStopped(recordedPid(pidFile));
  } finally {
    killOwn(recordedPid(pidFile), slow);
  }
  const total = performance.now() - started;
  assert.equal(r, null, "a snapshot step that does not finish is missing, so the record is incomplete");
  assert.ok(STOPPED.has(observed.state), `the slow tool process: ${describe(observed)}`);
  assert.ok(total < 12000, `bounded by min(cap, left - reserve), the kill grace, the observation and the cleanup (${Math.round(total)} ms)`);
});

// ── Provenance ─────────────────────────────────────────────────

test("provenance: the oracle's helpers, schemas and dependencies are in the record; a change or gap is refused", () => {
  const { modules, bare } = moduleClosure();
  for (const rel of ["tools/conformance/perf-scale.js", "tools/conformance/schema-boundary.js", "tools/conformance/structural-checks.js", "lib/verify.js",
    "tools/difffuzz/mandate-fuzz.mjs", "tools/conformance/perf/child.mjs"]) assert.ok(modules.includes(rel), rel);
  for (const spec of ["@dcp-ai/sdk", "ajv/dist/2020.js", "tweetnacl", "@noble/post-quantum/ml-dsa.js"]) assert.ok(bare.has(spec), spec);
  const rec = { a: { b: "x" }, scale: { modules: { "lib/verify.js": "1" }, schemas: { files: 1, sha256: "s" } } };
  assert.deepEqual(provenanceDifferences(rec, structuredClone(rec)), []);
  assert.ok(provenanceDifferences(rec, { ...rec, scale: { ...rec.scale, modules: { "lib/verify.js": "2" } } }).length);
  assert.ok(provenanceDifferences(rec, { ...rec, scale: { ...rec.scale, schemas: null } }).some((d) => /incomplete|missing/.test(d)));
});

// ── Real smoke (mandatory in CI) and the CLI ───────────────────

let built = false;
const RECORD = path.join(TMP, "record.json");
test("smoke: the real children pass the smallest sizes, latency and memory, built into a fresh record", (t) => {
  if (!PYTHON) {
    if (REQUIRED) assert.fail("DCP_PERF_PYTHON is not set (required)");
    t.skip("DCP_PERF_PYTHON is not set: NOT run");
    return;
  }
  const r = cli(["--corpus", CORPUS, "--sizes", "small", "--warmup", "1", "--samples", "2", "--python", PYTHON, "--record", RECORD, ...(process.env.DCP_PERF_OFFLINE === "1" ? ["--offline"] : [])]);
  assert.equal(r.code, 0, r.stderr + r.stdout.slice(-2000));
  assert.deepEqual([r.report.status, r.report.baseline, r.report.smoke], ["pass", false, true]);
  assert.deepEqual([r.report.counts.inputs, r.report.counts.observations, r.report.counts.latency_groups, r.report.counts.memory_children, r.report.counts.not_run], [12, 57, 19, 57, 0]);
  for (const m of r.report.memory) {
    assert.ok(m.memory.peak_rss_bytes === null ? typeof m.memory.unavailable_reason === "string" : Number.isSafeInteger(m.memory.peak_rss_bytes) && m.memory.peak_rss_bytes > 0, m.id);
    assert.equal(m.memory.heap_bytes, null);
  }
  for (const e of r.report.latency) for (const x of e.results) assert.equal(x.errors_first.length > 0, !x.verified, `${e.sdk} ${x.id}`);
  assert.deepEqual(r.report.after_run.problems, []);
  built = true;
});

test("CLI: overrides are never a baseline; a failure replaces an older PASS; a short deadline refuses to start", (t) => {
  if (!built) { if (REQUIRED) assert.fail("the smoke build did not run"); t.skip("needs the smoke build record"); return; }
  const base = ["--corpus", CORPUS, "--sizes", "small", "--no-build", "--record", RECORD, "--python", PYTHON, "--phases", "latency", "--warmup", "1", "--samples", "1"];
  const fake = (mode) => ["--child-argv", `bundle:go=${JSON.stringify([process.execPath, FAKE, mode, "bundle", "go"])}`];
  const faithful = cli([...base, ...fake("faithful")]);
  assert.equal(faithful.code, 0, faithful.stderr);
  assert.deepEqual([faithful.report.baseline, faithful.report.provenance.overrides], [false, ["bundle:go"]]);
  // Any test hook in the environment, even one that changes nothing here, is named and makes the report not a baseline.
  const hooked = spawnSync(process.execPath, [CLI, "--report", path.join(TMP, `report-${++n}.json`), ...base], {
    encoding: "utf8", env: { ...process.env, DCP_PERF_SCALE_SELFTEST_PS: "/bin/ps" } });
  const hookedReport = JSON.parse(fs.readFileSync(path.join(TMP, `report-${n}.json`), "utf8"));
  assert.equal(hooked.status, 0, hooked.stderr);
  assert.deepEqual([hookedReport.baseline, hookedReport.provenance.overrides], [false, ["env:DCP_PERF_SCALE_SELFTEST_PS"]]);
  const file = path.join(TMP, `seeded-${++n}.json`);
  seed(file);
  const lie = cli([...base, ...fake("accept-all")], file);
  assert.deepEqual([lie.code, lie.report.status, lie.report.baseline], [1, "fail", false]);
  assert.notEqual(lie.report.run.id, "old-run");
  const short = cli([...base, "--deadline-ms", "60000"]);
  assert.deepEqual([short.code, short.report.status, short.report.error.kind], [3, "error", "deadline"]);
  const forged = JSON.parse(fs.readFileSync(RECORD, "utf8"));
  forged.stable.scale.modules["lib/verify.js"] = "0".repeat(64);
  const forgedFile = path.join(TMP, "forged.json");
  fs.writeFileSync(forgedFile, JSON.stringify(forged));
  const stale = cli([...base.filter((x) => x !== RECORD && x !== "--record"), "--record", forgedFile]);
  assert.deepEqual([stale.code, stale.report.error.kind], [3, "provenance"]);
});

test("usage: ambiguous or invalid commands write a fresh error or nothing", () => {
  for (const args of [["--corpus", CORPUS, "--sizes", "medium"], ["--corpus", CORPUS, "--phases", "latency,latency"], ["--list", "--corpus", CORPUS], ["--corpus", CORPUS, "--deadline-ms", "1000"],
    ["--corpus", CORPUS, "--warmup", "11"], ["--corpus", CORPUS, "--samples", "51"], ["--corpus", CORPUS, "--rounds", "1"],
    ["--corpus", CORPUS, "--child-argv", "bundle:java=[\"x\"]"], ["--corpus", CORPUS, "--child-argv", "mandate:wasm=[\"x\"]"]]) {
    const file = path.join(TMP, `seeded-${++n}.json`);
    seed(file);
    const r = cli(args, file);
    assert.equal(r.code, 2, args.join(" "));
    assert.deepEqual([r.report.status, r.report.error.kind, r.report.baseline], ["error", "usage", false], args.join(" "));
  }
  const cwd = fs.mkdtempSync(path.join(TMP, "cwd-"));
  for (const args of [["--report"], ["--report", "--corpus", CORPUS], ["--report", "a.json", "--report", "b.json"]]) {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
    assert.equal(r.status, 2, args.join(" "));
    assert.deepEqual(fs.readdirSync(cwd), [], args.join(" "));
  }
});

// ── The supervisor: real interruption of slow phases, and cleanup of every process ─

function supervised(args, env, reportFile) {
  const started = performance.now();
  const r = spawnSync(process.execPath, [CLI, ...(reportFile ? ["--report", reportFile] : []), ...args], { encoding: "utf8", timeout: 120000, env: { ...process.env, ...env } });
  return { code: r.status, elapsed: performance.now() - started, stderr: r.stderr, report: reportFile && fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, "utf8")) : null };
}

test("supervisor: a worker stuck in validation, with a detached child, is stopped at the deadline with its whole tree", async () => {
  const pids = path.join(TMP, `stall-${++n}.json`);
  const file = path.join(TMP, `seeded-${++n}.json`);
  seed(file);
  try {
    const r = supervised(["--corpus", CORPUS, "--python", process.execPath, "--deadline-ms", "5000"],
      { DCP_PERF_SCALE_SELFTEST_STALL: "validate", DCP_PERF_SCALE_SELFTEST_PIDS: pids }, file);
    assert.equal(r.code, 3, r.stderr);
    assert.ok(r.elapsed < 15000, `stopped near the deadline (${Math.round(r.elapsed)} ms)`);
    assert.deepEqual([r.report.status, r.report.baseline, r.report.error.kind, r.report.error.cleanup.alive, r.report.error.cleanup.complete], ["error", false, "deadline", [], true]);
    assert.notEqual(r.report.run.id, "old-run");
    const { worker, detached } = recorded(pids);
    await assertStopped(worker, "the worker");
    await assertStopped(detached, "its detached child");
  } finally {
    const { worker, detached } = recorded(pids);
    killOwn(worker, CLI);
    killOwn(detached, STALL_MARKER);
  }
});

test("supervisor: a real snapshot hung in a detached tool subprocess is stopped, and the tool process is gone", async () => {
  const pidFile = path.join(TMP, `tool-${++n}.pid`);
  const fake = path.join(TMP, `hung-python-${n}`);
  fs.writeFileSync(fake, `#!${process.execPath}\nrequire("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nprocess.on("SIGTERM", () => {});\nsetInterval(() => {}, 1000);\n`, { mode: 0o755 });
  const record = path.join(TMP, `record-${n}.json`);
  fs.writeFileSync(record, JSON.stringify({ record_version: 1, stable: {} }));
  const file = path.join(TMP, `seeded-${++n}.json`);
  seed(file);
  try {
    const r = supervised(["--corpus", CORPUS, "--sizes", "small", "--no-build", "--record", record, "--python", fake, "--deadline-ms", "8000"],
      { DCP_PERF_SCALE_SELFTEST_NO_RESERVATIONS: "1" }, file);
    assert.equal(r.code, 3, r.stderr);
    assert.ok(r.elapsed < 18000, `stopped near the deadline (${Math.round(r.elapsed)} ms)`);
    assert.deepEqual([r.report.status, r.report.error.kind, r.report.error.cleanup.alive], ["error", "deadline", []]);
    assert.ok(fs.existsSync(pidFile), "the snapshot reached the tool query");
    await assertStopped(recordedPid(pidFile), "the hung tool process (its own process group)");
  } finally {
    killOwn(recordedPid(pidFile), fake);
  }
});

test("supervisor: a stopped generation leaves no corpus and no staging, and never touches a caller's directory", async () => {
  const pids = path.join(TMP, `stall-${++n}.json`);
  const target = path.join(TMP, `gen-${n}`);
  fs.mkdirSync(`${target}.partial`);
  fs.writeFileSync(path.join(`${target}.partial`, "keep.txt"), "a caller's file");
  try {
    const r = supervised(["--generate", target, "--deadline-ms", "5000"], { DCP_PERF_SCALE_SELFTEST_STALL: "generate", DCP_PERF_SCALE_SELFTEST_PIDS: pids });
    assert.equal(r.code, 3, r.stderr);
    assert.match(r.stderr, /deadline error/);
    assert.equal(fs.existsSync(target), false);
    assert.equal(fs.readFileSync(path.join(`${target}.partial`, "keep.txt"), "utf8"), "a caller's file", "a directory the run did not create is untouched");
    assert.deepEqual(fs.readdirSync(TMP).filter((f) => f.startsWith(`.gen-${n}.staging-`)), [], "the run's own staging directory is removed");
    const { worker, detached } = recorded(pids);
    await assertStopped(worker, "the generating worker");
    await assertStopped(detached, "its detached child");
  } finally {
    const { worker, detached } = recorded(pids);
    killOwn(worker, CLI);
    killOwn(detached, STALL_MARKER);
  }
});

test("supervisor: without process enumeration nothing starts, and an older report is replaced by the error", () => {
  const pids = path.join(TMP, `stall-${++n}.json`);
  const file = path.join(TMP, `seeded-${++n}.json`);
  seed(file);
  const r = supervised(["--corpus", CORPUS, "--python", process.execPath, "--deadline-ms", "5000"],
    { DCP_PERF_SCALE_SELFTEST_PS: path.join(TMP, "no-such-ps"), DCP_PERF_SCALE_SELFTEST_STALL: "validate", DCP_PERF_SCALE_SELFTEST_PIDS: pids }, file);
  assert.equal(r.code, 3, r.stderr);
  assert.deepEqual([r.report.status, r.report.baseline, r.report.error.kind], ["error", false, "supervisor"]);
  assert.notEqual(r.report.run.id, "old-run");
  assert.equal(fs.existsSync(pids), false, "no worker was started");
});

test("supervisor: if ps fails during the cleanup, the known worker group is still killed and the report says the cleanup is incomplete", async () => {
  const counter = path.join(TMP, `ps-count-${++n}`);
  const fakePs = path.join(TMP, `ps-${n}`);
  fs.writeFileSync(fakePs, `#!${process.execPath}
const fs = require("fs");
const k = fs.existsSync(${JSON.stringify(counter)}) ? Number(fs.readFileSync(${JSON.stringify(counter)}, "utf8")) : 0;
fs.writeFileSync(${JSON.stringify(counter)}, String(k + 1));
if (k > 0) process.exit(1);
const r = require("child_process").spawnSync("/bin/ps", process.argv.slice(2), { encoding: "utf8" });
process.stdout.write(r.stdout);
process.exitCode = r.status; // not process.exit(): a pipe would lose the unflushed table
`, { mode: 0o755 });
  const pids = path.join(TMP, `stall-${++n}.json`);
  const file = path.join(TMP, `seeded-${++n}.json`);
  seed(file);
  try {
    const r = supervised(["--corpus", CORPUS, "--python", process.execPath, "--deadline-ms", "5000"],
      { DCP_PERF_SCALE_SELFTEST_PS: fakePs, DCP_PERF_SCALE_SELFTEST_STALL: "validate", DCP_PERF_SCALE_SELFTEST_PIDS: pids }, file);
    assert.equal(r.code, 3, r.stderr);
    assert.deepEqual([r.report.status, r.report.error.kind, r.report.error.cleanup.complete, r.report.error.cleanup.alive], ["error", "deadline", false, null]);
    assert.ok(r.report.error.cleanup.errors.length > 0);
    assert.match(r.report.error.message, /cleanup incomplete.*still alive: unknown/);
    assert.notEqual(r.report.run.id, "old-run");
    await assertStopped(recorded(pids).worker, "the worker (its own group, killed by the fallback)");
  } finally {
    const { worker, detached } = recorded(pids);
    killOwn(worker, CLI);
    killOwn(detached, STALL_MARKER); // a detached child the failing ps could not find: the test removes its own
  }
});

test("generate: refuses a non-empty directory and writes nothing there", async () => {
  await assert.rejects(() => generateCorpus(CORPUS), /is not empty/);
  assert.equal(fs.readdirSync(CORPUS).length, 37);
  assert.deepEqual(CONTROLS, ["valid", "stale", "schema"]);
});
