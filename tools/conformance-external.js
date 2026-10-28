#!/usr/bin/env node
// Runs the external conformance suites (tools/conformance/external-catalog.json) against an implementation
// given as argv after `--`, through the contract dcp-ai-conformance-external/1 (tools/conformance/README.md).
//
//   node tools/conformance-external.js [--list] [--suite <id>]... [--report <file>] [--timeout-ms <n>] -- <argv...>
//
// Exit codes: 0 every selected case passed, 1 a discrepancy, 2 usage error, 3 infrastructure or
// implementation error. With --report, an "incomplete" placeholder is written before anything else and is
// replaced on every path, so an older report never survives a failed run.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  LIMITS, UsageError, InfraError, loadPlan, runExternal, exitCodeFor, EXTERNAL_CATALOG_PATH, REPO_ROOT,
} from "./conformance/external.js";

function parseArgs(args) {
  const opts = { suites: [], list: false, report: undefined, timeoutMs: LIMITS.timeoutMs, root: REPO_ROOT, catalog: EXTERNAL_CATALOG_PATH, argv: null };
  const sep = args.indexOf("--");
  const own = sep === -1 ? args : args.slice(0, sep);
  if (sep !== -1) opts.argv = args.slice(sep + 1);
  for (let i = 0; i < own.length; i++) {
    const a = own[i];
    const value = () => {
      const v = own[++i];
      if (v === undefined || v.startsWith("--")) throw new UsageError(`${a} needs a value`);
      return v;
    };
    if (a === "--list") opts.list = true;
    else if (a === "--suite") opts.suites.push(value());
    else if (a === "--report") {
      if (opts.report !== undefined) throw new UsageError("--report given more than once");
      opts.report = value();
    }
    else if (a === "--root") opts.root = path.resolve(value());
    else if (a === "--catalog") opts.catalog = path.resolve(value());
    else if (a === "--timeout-ms") {
      const n = Number(value());
      if (!Number.isSafeInteger(n) || n < 1 || n > LIMITS.maxTimeoutMs) throw new UsageError(`--timeout-ms must be an integer from 1 to ${LIMITS.maxTimeoutMs}`);
      opts.timeoutMs = n;
    } else throw new UsageError(`unknown argument ${a}`);
  }
  if (opts.list && (opts.argv !== null || opts.report !== undefined)) throw new UsageError("--list takes no implementation and no --report");
  if (!opts.list && (opts.argv === null || opts.argv.length === 0 || opts.argv[0] === "")) throw new UsageError("give the implementation as argv after --");
  return opts;
}

// The report path is taken before full parsing, so even a later usage error replaces an older report.
// A missing value, a value that is another option, or a repeated --report is refused before anything
// is written: no file named after an option is ever created.
const VALUE_OPTIONS = new Set(["--suite", "--report", "--root", "--catalog", "--timeout-ms"]);

function earlyReportPath(args) {
  const own = args.includes("--") ? args.slice(0, args.indexOf("--")) : args;
  let report;
  for (let i = 0; i < own.length; i++) {
    if (!VALUE_OPTIONS.has(own[i])) continue;
    const v = own[i + 1];
    if (v === undefined || v.startsWith("--")) throw new UsageError(`${own[i]} needs a value`);
    if (own[i] === "--report") {
      if (report !== undefined) throw new UsageError("--report given more than once");
      report = v;
    }
    i++;
  }
  return report;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

async function main(args) {
  // One run identity, from the placeholder to the final or error report.
  const run = { id: crypto.randomUUID(), started_at: new Date().toISOString() };
  let reportFile;
  try { reportFile = earlyReportPath(args); } catch (e) { console.error(`usage error: ${e.message}`); return 2; }
  if (reportFile !== undefined) {
    try { writeJson(reportFile, { kit: { name: "dcp-ai-conformance-external" }, run, status: "incomplete" }); }
    catch (e) { console.error(`cannot write the report ${reportFile}: ${e.message}`); return 3; }
  }
  const fail = (code, kind, message) => {
    console.error(`${kind} error: ${message}`);
    if (reportFile !== undefined) {
      try { writeJson(reportFile, { kit: { name: "dcp-ai-conformance-external" }, run: { ...run, finished_at: new Date().toISOString() }, status: "error", error: { kind, message } }); }
      catch (e) { console.error(`cannot write the report ${reportFile}: ${e.message}`); return 3; }
    }
    return code;
  };
  let opts;
  try { opts = parseArgs(args); } catch (e) { return fail(2, "usage", e.message); }
  let plan;
  try { plan = loadPlan({ root: opts.root, catalogFile: opts.catalog, select: opts.suites }); }
  catch (e) {
    if (e instanceof UsageError) return fail(2, "usage", e.message);
    if (e instanceof InfraError) return fail(3, "catalog", e.message);
    return fail(3, "exception", e.stack ?? String(e));
  }
  if (opts.list) {
    console.log(`dcp-ai-conformance-external, catalog ${plan.catalog.version} (sha256 ${plan.catalog.sha256})`);
    for (const s of plan.suites) console.log(`  ${s.id}  ${s.cases.length} cases  ${s.title}`);
    return 0;
  }
  let report;
  try { report = await runExternal({ plan, argv: opts.argv, timeoutMs: opts.timeoutMs, run }); }
  catch (e) { return fail(3, "exception", e.stack ?? String(e)); }
  for (const s of report.suites) {
    console.log(`\n── ${s.id}: ${s.title} ──`);
    for (const c of s.cases) console.log(`${c.status === "pass" ? "✔" : c.status === "fail" ? "✖" : "!"} ${c.id}${c.message ? ` — ${c.message}` : ""}`);
  }
  const o = report.implementation.observed;
  const who = report.implementation.self_declared;
  console.log(`\nimplementation (self-declared): ${who ? `${who.name} ${who.version}` : "none"}; exit ${o.exit_code}, signal ${o.signal}, ${o.duration_ms} ms`);
  console.log(`${report.status.toUpperCase()}: ${report.totals.pass} pass, ${report.totals.fail} fail, ${report.totals.error} error of ${report.totals.cases}`);
  if (reportFile !== undefined) {
    try { writeJson(reportFile, report); } catch (e) { console.error(`cannot write the report ${reportFile}: ${e.message}`); return 3; }
  }
  return exitCodeFor(report.status);
}

process.exitCode = await main(process.argv.slice(2));
