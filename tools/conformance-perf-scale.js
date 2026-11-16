#!/usr/bin/env node
// Bounded workload scaling of the normative verifiers (report contract dcp-ai-perf-scale/1, tools/conformance/README.md).
// A separate tool and contract: dcp-ai-perf/1 and its children are unchanged.
//
//   node tools/conformance-perf-scale.js --list
//   node tools/conformance-perf-scale.js --generate <empty dir>
//   node tools/conformance-perf-scale.js --corpus <dir> [--sizes all|small] [--phases latency,memory] [--no-build] [--offline]
//     [--warmup <n>] [--samples <n>] [--timeout-ms <n>] [--build-timeout-ms <n>] [--deadline-ms <n>]
//     [--python <path>] [--record <file>] [--report <file>]
//
// Deadline: this process is a supervisor. It starts the run as a worker (this file again, in its own process group)
// and stops it at --deadline-ms with every process it started (killTree), then writes an error report: that is the
// enforced bound. Inside, the worker keeps a cooperative budget (a step starts only if its reservation fits) so that a
// run normally ends on its own, with its report, before the supervisor has to act.
//
// Exit codes: 0 every check passed, 1 a check failed (verdict, stage; no timing is reported for that child), 2 usage,
// 3 infrastructure, corpus, build, provenance or deadline. With --report, an "incomplete" placeholder is written first
// and replaced on every path; an ambiguous --report writes nothing. --child-argv <bundle|mandate>:<sdk>=<JSON array> and
// --launcher-argv <JSON array> replace a command, for testing the harness only: such a report is never a baseline.
// Self-tests only, to test the supervisor: DCP_PERF_SCALE_SELFTEST_STALL=<validate|generate> makes the worker start a
// detached process and never return from that phase; DCP_PERF_SCALE_SELFTEST_NO_RESERVATIONS=1 lets a step start
// without its reservation (so that a real slow snapshot can be reached under a short deadline). Such a run is never a
// baseline: every DCP_PERF_SCALE_SELFTEST_* variable present (DCP_PERF_SCALE_SELFTEST_PS included) is named in the
// report as a test override and makes it not a baseline. The supervisor is tested on macOS and Linux (POSIX) only.
import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { LIMITS } from "./conformance/external.js";
import { BOUNDS, SDKS, VERIFICATION_TIME, informational, machine } from "./conformance/perf.js";
import {
  CONTROLS, DIMENSIONS, MANDATE_ENTRYPOINTS, MANDATE_SDKS, MEMORY_COUNTS, RECORD_FILE, REPORT_CONTRACT, DeadlineError, InfraError, UsageError,
  buildAll, childArgv, corpusUnchanged, deadline, generateCorpus, loadCorpus, mandateArgv, plannedWorkloads, policy, provenanceDifferences,
  killTree, processTable, runCampaign, rusageArgv, scaleRecord, scaling, sdksFor, SNAPSHOT_WORST_MS, VALIDATION_MARGIN_MS,
} from "./conformance/perf-scale.js";
import { ENTRYPOINTS } from "./conformance/perf.js";

const KIT = { name: "dcp-ai-perf-scale", contract: REPORT_CONTRACT, tool: "tools/conformance-perf-scale.js" };
// The approved scaling counts are the maxima (decision 05/11/2026): W 10, N 50, one round; the smoke uses less.
const DEFAULTS = { warmup: 10, samples: 50, rounds: 1, timeoutMs: 300000, buildTimeoutMs: 1800000, deadlineMs: 3600000 };
const SCALE_BOUNDS = { warmup: [1, 10], samples: [1, 50], deadlineMs: [5000, 14400000] };
const SELF = fileURLToPath(import.meta.url);
const WORKER_ENV = "DCP_PERF_SCALE_WORKER_BUDGET_MS";
const RUN_ENV = "DCP_PERF_SCALE_RUN_ID";
const STALL_ENV = "DCP_PERF_SCALE_SELFTEST_STALL";
const STALL_PIDS_ENV = "DCP_PERF_SCALE_SELFTEST_PIDS";
const NO_RESERVATIONS_ENV = "DCP_PERF_SCALE_SELFTEST_NO_RESERVATIONS";
const STAGING_ENV = "DCP_PERF_SCALE_STAGING";
// The worker's budget ends this much before the supervisor's deadline, so that it can write its report and exit.
const workerMargin = (ms) => Math.min(10000, Math.floor(ms / 4));
const LIMIT_TEXT = [
  "One machine, a small finite sample: frequency, thermal and power state and background load are not controlled; the CPU and OS are recorded.",
  "Latency is per call in process (parse of the input bytes and the verifier), as in dcp-ai-perf/1; generation, signing, build, process start and request decoding are outside it.",
  "Memory is the kernel high-water RSS of a fresh child over its whole life (runtime, imports, request copies, warmup, verification, result): not the verifier's allocation, not a sampled peak, never compared with latency. The heap is not measured.",
  "A negative's first errors show the category its SDK reports (schema or integrity), not that one internal path ran alone.",
  "Scaling is within one SDK: ratios of medians and differences of peaks against the smallest size of the same series. No ranking, no speed threshold, no attribution to a primitive.",
  "The record ties the artifacts, children, corpus checks and resolved dependencies to this checkout; it does not certify the supply chain.",
];

function earlyReportPath(args) {
  let report;
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--report") continue;
    const v = args[i + 1];
    if (v === undefined || v.startsWith("--")) throw new UsageError("--report needs a value");
    if (report !== undefined) throw new UsageError("--report given more than once");
    report = v;
    i++;
  }
  return report;
}

function parseArgs(args) {
  const o = { list: false, generate: undefined, corpus: undefined, sizes: "all", phases: ["latency", "memory"], build: true, offline: false, ...DEFAULTS,
    python: process.env.DCP_PERF_PYTHON, record: RECORD_FILE, report: undefined, overrides: {}, launcher: undefined };
  const seen = new Set();
  const int = (name, v, [lo, hi]) => {
    const n = Number(v);
    if (!Number.isSafeInteger(n) || n < lo || n > hi) throw new UsageError(`${name} must be an integer from ${lo} to ${hi}`);
    return n;
  };
  const argvList = (name, text) => {
    let argv;
    try { argv = JSON.parse(text); } catch { argv = null; }
    if (!Array.isArray(argv) || argv.length === 0 || !argv.every((x) => typeof x === "string" && x !== "")) throw new UsageError(`${name} takes a JSON array of non-empty strings`);
    return argv;
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const value = () => {
      const v = args[++i];
      if (v === undefined || v.startsWith("--")) throw new UsageError(`${a} needs a value`);
      return v;
    };
    const once = () => { if (seen.has(a)) throw new UsageError(`${a} given more than once`); seen.add(a); };
    if (a === "--list") o.list = true;
    else if (a === "--generate") { once(); o.generate = path.resolve(value()); }
    else if (a === "--corpus") { once(); o.corpus = path.resolve(value()); }
    else if (a === "--sizes") { once(); o.sizes = value(); if (!["all", "small"].includes(o.sizes)) throw new UsageError("--sizes is all or small"); }
    else if (a === "--phases") {
      once();
      o.phases = value().split(",");
      if (!o.phases.length || new Set(o.phases).size !== o.phases.length || !o.phases.every((p) => ["latency", "memory"].includes(p))) throw new UsageError("--phases is latency, memory or latency,memory");
    }
    else if (a === "--no-build") { once(); o.build = false; }
    else if (a === "--offline") { once(); o.offline = true; }
    else if (a === "--warmup") { once(); o.warmup = int(a, value(), SCALE_BOUNDS.warmup); }
    else if (a === "--samples") { once(); o.samples = int(a, value(), SCALE_BOUNDS.samples); }
    else if (a === "--timeout-ms") { once(); o.timeoutMs = int(a, value(), BOUNDS.timeoutMs); }
    else if (a === "--build-timeout-ms") { once(); o.buildTimeoutMs = int(a, value(), BOUNDS.buildTimeoutMs); }
    else if (a === "--deadline-ms") { once(); o.deadlineMs = int(a, value(), SCALE_BOUNDS.deadlineMs); }
    else if (a === "--python") { once(); o.python = value(); }
    else if (a === "--record") { once(); o.record = path.resolve(value()); }
    else if (a === "--report") { once(); o.report = value(); }
    else if (a === "--child-argv") {
      const v = value();
      const m = /^(bundle|mandate):([a-z]+)=(.*)$/s.exec(v);
      if (!m || !sdksFor(m[1]).includes(m[2])) throw new UsageError("--child-argv takes <bundle|mandate>:<sdk>=<JSON array>");
      const key = `${m[1]}:${m[2]}`;
      if (o.overrides[key]) throw new UsageError(`--child-argv ${key} given twice`);
      o.overrides[key] = argvList("--child-argv", m[3]);
    }
    else if (a === "--launcher-argv") { once(); o.launcher = argvList(a, value()); }
    else throw new UsageError(`unknown argument ${a}`);
  }
  const modes = [o.list, o.generate !== undefined, o.corpus !== undefined].filter(Boolean).length;
  if (modes !== 1) throw new UsageError("give exactly one of --list, --generate <dir> or --corpus <dir>");
  if ((o.list || o.generate) && (o.report !== undefined || Object.keys(o.overrides).length || o.launcher)) throw new UsageError("--list and --generate take no --report and no overrides");
  if (o.corpus && !o.python) throw new UsageError("a run needs --python <path> (or DCP_PERF_PYTHON): the Python SDK and the memory launcher use it");
  return o;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}
const micro = (ns) => (ns / 1000).toFixed(1);
const MB = (b) => (b === null ? "unavailable" : `${(b / 1048576).toFixed(1)} MiB`);

/** Self-tests only: start a detached process (as runProcess does) and never return from this phase. */
function stall(phase) {
  if (process.env[STALL_ENV] !== phase) return;
  const g = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], { detached: true, stdio: "ignore" });
  fs.writeFileSync(process.env[STALL_PIDS_ENV], JSON.stringify({ worker: process.pid, detached: g.pid }));
  for (;;) { /* a synchronous phase that never ends */ }
}

/** The supervisor: runs the worker in its own process group and stops the whole tree at the deadline. */
async function main(args) {
  if (process.env[WORKER_ENV] !== undefined) return work(args, Number(process.env[WORKER_ENV]));
  const run = { id: crypto.randomUUID(), started_at: new Date().toISOString() };
  let reportFile;
  try { reportFile = earlyReportPath(args); } catch (e) { console.error(`usage error: ${e.message}`); return 2; }
  const fail = (code, kind, message, extra = {}) => {
    console.error(`${kind} error: ${message}`);
    if (reportFile !== undefined) {
      try { writeJson(reportFile, { kit: KIT, run: { ...run, finished_at: new Date().toISOString() }, status: "error", baseline: false, error: { kind, message, ...extra } }); }
      catch (e) { console.error(`cannot write the report ${reportFile}: ${e.message}`); return 3; }
    }
    return code;
  };
  if (reportFile !== undefined) {
    try { writeJson(reportFile, { kit: KIT, run, status: "incomplete" }); } catch (e) { console.error(`cannot write the report ${reportFile}: ${e.message}`); return 3; }
  }
  let o;
  try { o = parseArgs(args); } catch (e) { return fail(2, "usage", e.message); }
  if (o.list) return work(args, Infinity);
  // Preflight: without process enumeration a run could not be stopped with its descendants, so none is started.
  let ownGroup;
  try {
    ownGroup = processTable().find((x) => x.pid === process.pid)?.pgid;
    if (!Number.isSafeInteger(ownGroup)) throw new InfraError("the supervisor is not in the process table");
  } catch (e) { return fail(3, "supervisor", `process enumeration is unavailable (${e.message}): nothing was started`); }
  // A generation writes into a staging directory this run creates (unique, exclusive) and owns; only that exact
  // directory is ever removed, never a caller's.
  let staging;
  if (o.generate) {
    try {
      fs.mkdirSync(path.dirname(o.generate), { recursive: true });
      staging = fs.mkdtempSync(path.join(path.dirname(o.generate), `.${path.basename(o.generate)}.staging-`));
    } catch (e) { return fail(3, "generate", `cannot create a staging directory: ${e.message}`); }
  }
  const dropStaging = () => { if (staging) fs.rmSync(staging, { recursive: true, force: true }); };
  const started = performance.now();
  const worker = spawn(process.execPath, [SELF, ...args], {
    detached: true, stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, [WORKER_ENV]: String(o.deadlineMs - workerMargin(o.deadlineMs)), [RUN_ENV]: run.id, ...(staging ? { [STAGING_ENV]: staging } : {}) },
  });
  const exited = new Promise((resolve) => { worker.on("exit", (code, sig) => resolve({ code, sig })); worker.on("error", (e) => resolve({ code: null, sig: null, error: e.message })); });
  let timer;
  const expired = new Promise((resolve) => { timer = setTimeout(() => resolve(null), Math.max(0, o.deadlineMs - (performance.now() - started))); });
  // Stopping the supervisor stops the worker's tree too (it runs in its own group and would not get a terminal signal).
  let interrupted = null;
  const stopOn = (sig) => process.on(sig, () => { interrupted = sig; killTree(worker.pid, ownGroup).finally(() => { dropStaging(); process.exit(130); }); });
  ["SIGINT", "SIGTERM", "SIGHUP"].forEach(stopOn);
  const r = await Promise.race([exited, expired]);
  clearTimeout(timer);
  if (interrupted) return 130;
  if (r) {
    dropStaging();
    if (r.code === null) return fail(3, "worker", r.error ?? `the worker ended by signal ${r.sig}`);
    return r.code;
  }
  let cleanup;
  try { cleanup = await killTree(worker.pid, ownGroup); } catch (e) { cleanup = { complete: false, alive: null, errors: [e.message] }; }
  await Promise.race([exited, new Promise((res) => setTimeout(res, 5000))]);
  try { dropStaging(); } catch (e) { cleanup.errors = [...(cleanup.errors ?? []), `staging: ${e.message}`]; cleanup.complete = false; }
  const state = cleanup.complete ? `${cleanup.killed} process(es) killed, none alive`
    : `cleanup incomplete (${cleanup.errors.join("; ") || "processes still alive"}); still alive: ${cleanup.alive === null ? "unknown" : cleanup.alive.join(", ")}`;
  return fail(3, "deadline", `the supervisor stopped the run at its ${o.deadlineMs} ms deadline: ${state}`, { cleanup, elapsed_ms: Math.round(performance.now() - started) });
}

/** The worker: the whole run, within a cooperative budget of `budgetMs` (the supervisor enforces the deadline). */
async function work(args, budgetMs) {
  const clockStart = performance.now();
  const run = { id: process.env[RUN_ENV] ?? crypto.randomUUID(), started_at: new Date().toISOString() };
  let reportFile;
  try { reportFile = earlyReportPath(args); } catch (e) { console.error(`usage error: ${e.message}`); return 2; }
  if (reportFile !== undefined) {
    try { writeJson(reportFile, { kit: KIT, run, status: "incomplete" }); } catch (e) { console.error(`cannot write the report ${reportFile}: ${e.message}`); return 3; }
  }
  const fail = (code, kind, message) => {
    console.error(`${kind} error: ${message}`);
    if (reportFile !== undefined) {
      try { writeJson(reportFile, { kit: KIT, run: { ...run, finished_at: new Date().toISOString() }, status: "error", baseline: false, error: { kind, message } }); }
      catch (e) { console.error(`cannot write the report ${reportFile}: ${e.message}`); return 3; }
    }
    return code;
  };
  let o;
  try { o = parseArgs(args); } catch (e) { return fail(2, "usage", e.message); }
  if (o.list) {
    console.log(`dcp-ai-perf-scale (${REPORT_CONTRACT}), verification_time ${VERIFICATION_TIME}, policy sha256 ${policy().policy_sha256}`);
    for (const [d, x] of Object.entries(DIMENSIONS)) console.log(`  ${d.padEnd(9)} ${x.kind.padEnd(8)} sizes ${x.sizes.join(", ")} (${x.unit}); controls ${CONTROLS.join(", ")}; SDKs ${sdksFor(x.kind).join(", ")}`);
    for (const s of SDKS) console.log(`  sdk ${s}: ${ENTRYPOINTS[s]}${MANDATE_SDKS.includes(s) ? `, ${MANDATE_ENTRYPOINTS[s]}` : ""}`);
    const all = plannedWorkloads();
    const small = plannedWorkloads({ sizes: "small" });
    const obs = (ws) => ws.reduce((n, w) => n + sdksFor(w.kind).length, 0);
    console.log(`  inputs ${all.length} (small ${small.length}); observations ${obs(all)} (small ${obs(small)}); memory: one fresh child per observation, W=${MEMORY_COUNTS.warmup} N=${MEMORY_COUNTS.samples}`);
    return 0;
  }
  if (o.generate) {
    try {
      // Written into the supervisor's staging directory and renamed only once it passed the corpus checks: a stopped
      // generation leaves no corpus.
      if (fs.existsSync(o.generate) && fs.readdirSync(o.generate).length) throw new UsageError(`${o.generate} is not empty`);
      const staging = process.env[STAGING_ENV];
      if (!staging) throw new InfraError("no staging directory from the supervisor");
      stall("generate");
      const m = await generateCorpus(staging);
      if (fs.existsSync(o.generate)) fs.rmdirSync(o.generate);
      fs.renameSync(staging, o.generate);
      console.log(`corpus written to ${o.generate}: ${m.workloads.length} workloads, ${m.workloads.reduce((n, w) => n + w.bytes, 0)} bytes; it passed the corpus checks`);
      return 0;
    } catch (e) {
      return fail(e instanceof UsageError ? 2 : 3, "generate", e instanceof InfraError || e instanceof UsageError ? e.message : e.stack ?? String(e));
    }
  }

  // The cooperative budget: the corpus checks and the snapshots start only if their reservation fits, the build and
  // each child get min(their cap, what is left after the final snapshot and corpus check). It cannot interrupt a slow
  // step; the supervisor's deadline does.
  const base = deadline(budgetMs - (performance.now() - clockStart));
  // Two separate things: whether reservations are disabled, and whether any test instrumentation is active at all.
  const noReservations = process.env[NO_RESERVATIONS_ENV] === "1";
  const testHooks = Object.keys(process.env).filter((k) => k.startsWith("DCP_PERF_SCALE_SELFTEST_")).sort().map((k) => `env:${k}`);
  const clock = noReservations ? { ...base, require: () => {} } : base;
  const TAIL_MS = SNAPSHOT_WORST_MS + VALIDATION_MARGIN_MS;
  const leaving = { ...clock, cap: (capMs, what) => clock.cap(Math.min(capMs, clock.left() - TAIL_MS), what) };
  let corpus;
  try {
    stall("validate");
    clock.require(VALIDATION_MARGIN_MS, "the corpus checks");
    corpus = loadCorpus(o.corpus, { sizes: o.sizes });
  } catch (e) {
    if (e instanceof DeadlineError) return fail(3, "deadline", e.message);
    return fail(3, "corpus", e instanceof InfraError ? e.message : e.stack ?? String(e));
  }

  let record;
  try {
    if (o.build) {
      const steps = await buildAll({ offline: o.offline, timeoutMs: leaving.cap(Math.min(o.buildTimeoutMs, clock.left() - SNAPSHOT_WORST_MS), "the build") });
      record = { record_version: 1, created_at: new Date().toISOString(), informational: await informational(), steps, stable: await scaleRecord(o.python, clock) };
      const gaps = provenanceDifferences(record.stable, record.stable);
      if (gaps.length) throw new InfraError(gaps.join("; "));
      writeJson(o.record, record);
    } else {
      let recorded;
      try { recorded = JSON.parse(fs.readFileSync(o.record, "utf8")); } catch (e) { throw new InfraError(`no usable build record at ${o.record} (${e.code ?? e.message}); build first`); }
      if (recorded?.record_version !== 1 || !recorded.stable) throw new InfraError("the build record is malformed");
      const diffs = provenanceDifferences(recorded.stable, await scaleRecord(o.python, clock));
      if (diffs.length) throw new InfraError(`the build record does not match this checkout and its artifacts: ${diffs.slice(0, 12).join("; ")}`);
      record = recorded;
    }
  } catch (e) {
    if (e instanceof DeadlineError) return fail(3, "deadline", e.message);
    if (e instanceof InfraError) return fail(3, o.build ? "build" : "provenance", e.message);
    return fail(3, "exception", e.stack ?? String(e));
  }

  const { policy: p } = policy();
  let outcome;
  try {
    outcome = await runCampaign({
      workloads: corpus.workloads, policy: p, phases: o.phases, warmup: o.warmup, samples: o.samples, rounds: o.rounds, timeoutMs: o.timeoutMs, python: o.python, clock: leaving,
      argvFor: (kind, sdk) => o.overrides[`${kind}:${sdk}`] ?? (kind === "bundle" ? childArgv(sdk, o.python) : mandateArgv(sdk, o.python)),
      launcherArgv: o.launcher ?? rusageArgv(o.python),
    });
  } catch (e) { return fail(3, "exception", e.stack ?? String(e)); }

  // After the run: the same stable record and the same corpus bytes, or the run is not evidence.
  const after = [];
  try {
    after.push(...provenanceDifferences(record.stable, await scaleRecord(o.python, clock)).map((d) => `provenance changed: ${d}`));
    clock.require(VALIDATION_MARGIN_MS, "the corpus check");
    if (!corpusUnchanged(o.corpus, corpus)) after.push("the corpus changed during the run");
  } catch (e) { after.push(`after-run check failed: ${e.message}`); }
  if (clock.left() === 0) after.push("the campaign deadline passed");
  const status = after.length ? "error" : outcome.status;
  const overridden = [...Object.keys(o.overrides), ...(o.launcher ? ["launcher"] : []), ...testHooks];
  const report = {
    kit: KIT,
    run: { ...run, finished_at: new Date().toISOString(), node: process.version },
    status,
    baseline: status === "pass" && overridden.length === 0 && o.sizes === "all" && o.phases.length === 2,
    smoke: o.sizes === "small",
    parameters: { sizes: o.sizes, phases: o.phases, warmup: o.warmup, samples: o.samples, rounds: o.rounds, memory: MEMORY_COUNTS, child_timeout_cap_ms: o.timeoutMs,
      order: "latency: one child per SDK and dimension, round-robin over its workloads; memory: one fresh child per SDK and workload; all in sequence",
      provenance: o.build ? "built in this run" : "checked against the build record", stdout_limit_bytes: LIMITS.stdoutBytes },
    deadline: { supervisor_ms: o.deadlineMs, worker_budget_ms: budgetMs, used_ms: Math.round(performance.now() - clockStart), left_ms: clock.left(), stopped: outcome.stopped,
      enforcement: "the supervisor kills the worker's process tree at supervisor_ms; inside, a cooperative budget" },
    counts: { ...outcome.counts, planned_children: outcome.planned_children },
    after_run: { problems: after },
    provenance: { record, overrides: overridden },
    machine: machine(),
    corpus: { dir: o.corpus, manifest_sha256: corpus.manifest_sha256, generated_at: corpus.manifest.generated_at, generator: corpus.manifest.generator,
      randomness: corpus.manifest.randomness, keys: corpus.manifest.keys, verification_time: VERIFICATION_TIME,
      workloads: corpus.workloads.map((w) => ({ id: w.id, dimension: w.dimension, size: w.size, control: w.control, kind: w.kind, bytes: w.bytes.length, sha256: w.sha256, expect: w.expect })) },
    latency: outcome.latency,
    memory: outcome.memory,
    scaling: scaling(outcome.latency, outcome.memory),
    limits: LIMIT_TEXT,
  };
  for (const e of outcome.latency) {
    console.log(`── latency ${e.sdk} ${e.dimension} (round ${e.round}): ${e.status.toUpperCase()}${e.message ? ` — ${e.error_kind}: ${e.message}` : ""}`);
    for (const r of e.results ?? []) console.log(`  ${r.id.padEnd(26)} median ${micro(r.stats.median)} µs  n ${r.stats.n}`);
  }
  const memFailed = outcome.memory.filter((m) => m.status !== "pass");
  console.log(`── memory: ${outcome.memory.length - memFailed.length}/${outcome.memory.length} children passed`);
  for (const m of memFailed) console.log(`  ${m.sdk} ${m.id}: ${m.status} — ${m.error_kind}: ${m.message}`);
  for (const m of outcome.memory.filter((x) => x.status === "pass")) console.log(`  ${m.sdk.padEnd(6)} ${m.id.padEnd(26)} peak RSS ${MB(m.memory.peak_rss_bytes)}`);
  for (const a of after) console.log(`after the run: ${a}`);
  console.log(`\n${status.toUpperCase()}${report.baseline ? "" : " (not a baseline)"}: ${outcome.counts.latency_groups} latency group(s), ${outcome.counts.memory_children} memory child(ren), ${outcome.counts.not_run} not run`);
  if (reportFile !== undefined) {
    try { writeJson(reportFile, report); } catch (e) { console.error(`cannot write the report ${reportFile}: ${e.message}`); return 3; }
  }
  return status === "pass" ? 0 : status === "fail" ? 1 : 3;
}

process.exitCode = await main(process.argv.slice(2));
