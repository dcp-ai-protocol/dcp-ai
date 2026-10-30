#!/usr/bin/env node
// Performance baseline of the normative V2 verifier in the five SDKs of this checkout (contract dcp-ai-perf/1,
// tools/conformance/README.md). Builds the measured artifacts (or, with --no-build, checks them against the build
// record), then runs one in-process child per SDK in sequence and reports every sample with its provenance.
//
//   node tools/conformance-perf.js [--list] [--no-build] [--offline] [--sdk <id>]... [--warmup <n>] [--samples <n>]
//     [--rounds <n>] [--timeout-ms <n>] [--build-timeout-ms <n>] [--python <path>] [--record <file>] [--report <file>]
//
// Exit codes: 0 every child passed every check, 1 a check failed (no timing is reported for it), 2 usage error,
// 3 infrastructure, build or provenance error. With --report, an "incomplete" placeholder is written first and
// replaced on every path; a missing, option-like or repeated --report value is ambiguous: exit 2, no report.
// --child-argv <sdk>=<JSON array> replaces a child's command, for testing the harness only: such a report is never
// a baseline.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { LIMITS } from "./conformance/external.js";
import {
  BOUNDS, CONTRACT, DEFAULTS, ENTRYPOINTS, RECORD_FILE, SDKS, VERIFICATION_TIME, InfraError, UsageError,
  build, childArgv, informational, loadWorkloads, machine, requireComplete, runChildren, stableRecord, verifyRecord, writeRecord,
} from "./conformance/perf.js";

const LIMIT_TEXT = [
  "A small local sample on one machine: frequency, thermal and power state and background load are not controlled; the CPU and OS are recorded.",
  "Each SDK is measured as it is, with its own cryptographic libraries and, for WASM, its public boundary; no algorithm is measured in isolation and no primitive is replaced.",
  "A negative can stop at its first failed check; errors_first is a diagnostic, not proof of the whole path. No time difference is attributed to a single field.",
  "No ranking, no speed threshold, no attributed percentage; at most a descriptive ratio of medians for the same workload.",
  "The build record ties the artifacts to this checkout; it does not certify the supply chain (toolchains, dependency caches, the OS).",
];

// Only an ambiguous --report prevents writing a report: missing, option-like (so "--report" read as another option's
// value never invents a path) or repeated. No other option is judged here; its errors come after the placeholder and
// replace an older report with a fresh error. No value of another option can be "--report": values starting with
// "--" are refused.
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
  const o = { list: false, build: true, offline: false, sdks: [], warmup: DEFAULTS.warmup, samples: DEFAULTS.samples, rounds: DEFAULTS.rounds,
    timeoutMs: DEFAULTS.timeoutMs, buildTimeoutMs: DEFAULTS.buildTimeoutMs, python: process.env.DCP_PERF_PYTHON, record: RECORD_FILE, report: undefined, overrides: {} };
  const seen = new Set();
  const int = (name, v, [lo, hi]) => {
    const n = Number(v);
    if (!Number.isSafeInteger(n) || n < lo || n > hi) throw new UsageError(`${name} must be an integer from ${lo} to ${hi}`);
    return n;
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
    else if (a === "--no-build") { once(); o.build = false; }
    else if (a === "--offline") { once(); o.offline = true; }
    else if (a === "--sdk") {
      const v = value();
      if (!SDKS.includes(v)) throw new UsageError(`unknown SDK ${v} (${SDKS.join(", ")})`);
      if (o.sdks.includes(v)) throw new UsageError(`--sdk ${v} given twice`);
      o.sdks.push(v);
    }
    else if (a === "--warmup") { once(); o.warmup = int(a, value(), BOUNDS.warmup); }
    else if (a === "--samples") { once(); o.samples = int(a, value(), BOUNDS.samples); }
    else if (a === "--rounds") { once(); o.rounds = int(a, value(), BOUNDS.rounds); }
    else if (a === "--timeout-ms") { once(); o.timeoutMs = int(a, value(), BOUNDS.timeoutMs); }
    else if (a === "--build-timeout-ms") { once(); o.buildTimeoutMs = int(a, value(), BOUNDS.buildTimeoutMs); }
    else if (a === "--python") { once(); o.python = value(); }
    else if (a === "--record") { once(); o.record = path.resolve(value()); }
    else if (a === "--report") { once(); o.report = value(); }
    else if (a === "--child-argv") {
      const v = value();
      const eq = v.indexOf("=");
      const sdk = v.slice(0, eq);
      let argv;
      try { argv = JSON.parse(v.slice(eq + 1)); } catch { argv = null; }
      if (eq < 1 || !SDKS.includes(sdk) || !Array.isArray(argv) || argv.length === 0 || !argv.every((x) => typeof x === "string" && x !== "")) {
        throw new UsageError("--child-argv takes <sdk>=<JSON array of non-empty strings>");
      }
      if (o.overrides[sdk]) throw new UsageError(`--child-argv ${sdk} given twice`);
      o.overrides[sdk] = argv;
    }
    else throw new UsageError(`unknown argument ${a}`);
  }
  if (o.sdks.length === 0) o.sdks = [...SDKS];
  if (o.list && (o.report !== undefined || Object.keys(o.overrides).length)) throw new UsageError("--list takes no --report and no --child-argv");
  if (o.sdks.includes("python") && !o.python && !o.overrides.python && !o.list) throw new UsageError("measuring python needs --python <path> (or DCP_PERF_PYTHON)");
  return o;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

const micro = (ns) => (ns / 1000).toFixed(1);

async function main(args) {
  const run = { id: crypto.randomUUID(), started_at: new Date().toISOString() };
  let reportFile;
  try { reportFile = earlyReportPath(args); } catch (e) { console.error(`usage error: ${e.message}`); return 2; }
  if (reportFile !== undefined) {
    try { writeJson(reportFile, { kit: { name: "dcp-ai-perf", contract: CONTRACT }, run, status: "incomplete" }); }
    catch (e) { console.error(`cannot write the report ${reportFile}: ${e.message}`); return 3; }
  }
  const fail = (code, kind, message) => {
    console.error(`${kind} error: ${message}`);
    if (reportFile !== undefined) {
      try { writeJson(reportFile, { kit: { name: "dcp-ai-perf", contract: CONTRACT }, run: { ...run, finished_at: new Date().toISOString() }, status: "error", error: { kind, message } }); }
      catch (e) { console.error(`cannot write the report ${reportFile}: ${e.message}`); return 3; }
    }
    return code;
  };
  let o;
  try { o = parseArgs(args); } catch (e) { return fail(2, "usage", e.message); }
  let plan;
  try { plan = loadWorkloads(); } catch (e) { return fail(3, "fixture", e.message); }
  if (o.list) {
    console.log(`dcp-ai-perf (${CONTRACT}), verification_time ${VERIFICATION_TIME}, policy sha256 ${plan.policy_sha256}`);
    for (const w of plan.workloads) console.log(`  ${w.id}  expect verified=${w.expect.verified}  ${w.bytes.length} bytes  sha256 ${w.sha256}  ${w.source}`);
    for (const s of SDKS) console.log(`  sdk ${s}: ${ENTRYPOINTS[s]}`);
    return 0;
  }

  // Provenance: build now, or check every stable input and artifact against the build record.
  let record;
  try {
    if (o.build) {
      const steps = await build(o.sdks, { offline: o.offline, buildTimeoutMs: o.buildTimeoutMs });
      record = { record_version: 1, created_at: new Date().toISOString(), informational: await informational(), steps,
        stable: requireComplete(await stableRecord(undefined, { python: o.python, sdks: o.sdks })) };
      writeRecord(record, o.record);
    } else {
      record = verifyRecord(await stableRecord(undefined, { python: o.python, sdks: o.sdks }), o.sdks, o.record);
    }
  } catch (e) {
    if (e instanceof InfraError) return fail(3, o.build ? "build" : "provenance", e.message);
    return fail(3, "exception", e.stack ?? String(e));
  }

  let outcome;
  try {
    outcome = await runChildren({
      sdks: o.sdks, workloads: plan.workloads, policy: plan.policy, warmup: o.warmup, samples: o.samples, rounds: o.rounds,
      timeoutMs: o.timeoutMs, python: o.python, argvFor: (sdk, python) => o.overrides[sdk] ?? childArgv(sdk, python),
    });
  } catch (e) { return fail(3, "exception", e.stack ?? String(e)); }

  const report = {
    kit: { name: "dcp-ai-perf", contract: CONTRACT, tool: "tools/conformance-perf.js" },
    run: { ...run, finished_at: new Date().toISOString(), node: process.version },
    status: outcome.status,
    baseline: outcome.status === "pass" && Object.keys(o.overrides).length === 0,
    parameters: { sdks: o.sdks, warmup: o.warmup, samples: o.samples, rounds: o.rounds, timeout_ms: o.timeoutMs, order: "round_robin over workloads, SDKs in sequence",
      provenance: o.build ? "built in this run" : "checked against the build record", stdout_limit_bytes: LIMITS.stdoutBytes },
    provenance: { record, child_overrides: Object.keys(o.overrides) },
    machine: machine(),
    workload: { verification_time: VERIFICATION_TIME, policy_sha256: plan.policy_sha256, fixtures: plan.fixtures,
      workloads: plan.workloads.map((w) => ({ id: w.id, source: w.source, sha256: w.sha256, bytes: w.bytes.length, expect: w.expect })) },
    results: outcome.sdks,
    limits: LIMIT_TEXT,
  };
  for (const e of outcome.sdks) {
    console.log(`\n── ${e.sdk} (round ${e.round}): ${e.status.toUpperCase()}${e.message ? ` — ${e.kind}: ${e.message}` : ""}`);
    for (const r of e.results ?? []) console.log(`  ${r.id.padEnd(22)} median ${micro(r.stats.median)} µs  p90 ${micro(r.stats.p90)} µs  n ${r.stats.n}`);
  }
  console.log(`\n${report.status.toUpperCase()}${report.baseline ? "" : " (not a baseline)"}: ${outcome.sdks.length} child run(s); every sample is in the report`);
  if (reportFile !== undefined) {
    try { writeJson(reportFile, report); } catch (e) { console.error(`cannot write the report ${reportFile}: ${e.message}`); return 3; }
  }
  return report.status === "pass" ? 0 : report.status === "fail" ? 1 : 3;
}

process.exitCode = await main(process.argv.slice(2));
