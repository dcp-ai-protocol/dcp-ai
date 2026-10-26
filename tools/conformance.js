#!/usr/bin/env node
// DCP-AI conformance kit CLI (legacy entry point kept for `npm run conformance`).
// Runs every suite of tools/conformance/catalog.json by default. See tools/conformance/README.md.
//
//   node tools/conformance.js [--list] [--suite <id>]... [--report <file>] [--root <dir>]
//
// Exit codes: 0 pass, 1 discrepancy, 2 usage error, 3 infrastructure error (missing or malformed fixture,
// malformed expectation, missing or malformed catalog, exception, catalog mismatch, or no check executed).
import { pathToFileURL } from "url";
import { loadCatalog, selectSuites, runConformance, beginReport, writeReport, UsageError, REPO_ROOT, CATALOG_PATH } from "./conformance/runner.js";

export function parseArgs(argv) {
  const opts = { select: [], list: false, report: undefined, root: REPO_ROOT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      if (i + 1 >= argv.length || argv[i + 1] === "" || argv[i + 1].startsWith("--")) {
        throw new UsageError(`${a} needs a value`);
      }
      return argv[++i];
    };
    if (a === "--list") opts.list = true;
    else if (a === "--suite") opts.select.push(value());
    else if (a === "--report") opts.report = value();
    else if (a === "--root") opts.root = value();
    else throw new UsageError(`unknown argument ${a}`);
  }
  if (opts.report === "") throw new UsageError("--report needs a path");
  return opts;
}

// The report path is looked up before full parsing, so a usage error still replaces an older report.
function reportPathOf(argv) {
  const i = argv.lastIndexOf("--report");
  return i >= 0 && i + 1 < argv.length && argv[i + 1] !== "" && !argv[i + 1].startsWith("--")
    ? argv[i + 1] : undefined;
}

function failReport(file, fields) {
  if (!file) return;
  try {
    writeReport(file, { status: "error", ...fields, finished_at: new Date().toISOString() });
  } catch (e) {
    console.error(`conformance: cannot write report ${file}: ${e.message}`);
  }
}

export async function main(argv = process.argv.slice(2), { catalogPath = CATALOG_PATH } = {}) {
  let opts;
  let catalog;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    console.error(`conformance: ${e.message}`);
    failReport(reportPathOf(argv), { usage_error: e.message });
    return 2;
  }
  // A missing or malformed catalog is an infrastructure error, not a usage error.
  try {
    catalog = loadCatalog(catalogPath);
  } catch (e) {
    console.error(`conformance: cannot load catalog: ${e.message}`);
    failReport(opts.report, { catalog_error: e.message });
    return 3;
  }
  try {
    if (opts.select.length) selectSuites(catalog, opts.select);
    if (opts.list && opts.report) throw new UsageError("--list does not write a report; drop --report");
  } catch (e) {
    console.error(`conformance: ${e.message}`);
    failReport(reportPathOf(argv), { usage_error: e.message });
    return 2;
  }
  if (opts.list) {
    const shown = opts.select.length ? catalog.suites.filter((s) => opts.select.includes(s.id)) : catalog.suites;
    console.log(`DCP-AI conformance kit ${catalog.kit_version}`);
    for (const s of shown) console.log(`  ${s.id.padEnd(22)} ${String(s.expected_cases.length).padStart(4)} cases  ${s.title}`);
    console.log("Inventory (not executed by this kit, outside the totals):");
    for (const v of catalog.inventory) console.log(`  ${v.id.padEnd(36)} ${v.where}`);
    return 0;
  }
  try {
    if (opts.report) beginReport(opts.report);
  } catch (e) {
    console.error(`conformance: cannot write report ${opts.report}: ${e.message}`);
    return 2;
  }
  let report;
  try {
    report = await runConformance({ root: opts.root, select: opts.select, catalog, log: (l) => console.log(l) });
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`conformance: ${e.message}`);
      failReport(opts.report, { usage_error: e.message });
      return 2;
    }
    console.error(`conformance: runner failure: ${e.stack ?? e}`);
    failReport(opts.report, { runner_failure: String(e) });
    return 3;
  }
  if (opts.report) writeReport(opts.report, report);
  const t = report.totals;
  console.log(`\n${t.cases} cases: ${t.pass} pass, ${t.fail} fail, ${t.error} error (${report.selection.length} suites, kit ${report.kit.version})`);
  if (report.status === "pass") {
    console.log(report.selection.length === catalog.suites.length ? "DCP-AI CONFORMANCE PASS (V1 + V2)" : `DCP-AI CONFORMANCE PASS (selected suites: ${report.selection.join(", ")})`);
    return 0;
  }
  console.error(report.status === "fail" ? `Conformance FAILED (${t.fail} discrepancies)` : `Conformance ERROR (${t.error} infrastructure errors${report.no_checks ? ", no check executed" : ""})`);
  return report.status === "fail" ? 1 : 3;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
