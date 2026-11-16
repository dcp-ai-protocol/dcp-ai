#!/usr/bin/env node
// Differential testing of DCP-09 §3.5.2 mandate chain verification through the TypeScript, Python, Go and Rust SDKs
// (format dcp-mandatefuzz/1). See README.md and mandate-fuzz.mjs.
//
//   node tools/difffuzz/run-mandates.mjs [--iterations N] [--seed S] [--timeout MS] [--python PATH] [--out DIR]
//     [--report FILE] [--offline] [--build-timeout-ms MS] [--batch-cases N] [--batch-bytes B] [--case-bytes B]
//     [--stdout-bytes B] [--max-findings N] [--max-retries N] [--minimize-steps N] [--minimize-total N]
//     [--go-wrapper PATH] [--rust-wrapper PATH]
//   node tools/difffuzz/run-mandates.mjs --replay <finding>.json [--python PATH] [--offline] [--report FILE]
//   node tools/difffuzz/run-mandates.mjs --transport-probe [--python PATH] [--offline] [--report FILE]
//
// --transport-probe records, per wrapper, what contract /4 does with a NaN token, a leading byte order mark and the
// literal 1e400 next to a signed control: an observation with stated limits, never a conformance result.
//
// Exit codes: 0 no finding and every control as expected, 1 a finding or a failed batch, 2 usage (checked before anything
// is built), 3 infrastructure or harness fault. With --report, an "incomplete" report is written first and replaced on
// every path, a usage error included.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { FORMAT, parseArgs, replayFinding, runCampaign, transportProbe } from './mandate-fuzz.mjs';
import { UsageError } from './fuzz.mjs';

function earlyReportPath(argv) {
  let report;
  for (let i = 0; i < argv.length; i++) {
    let v;
    if (argv[i] === '--report') v = argv[++i];
    else if (argv[i].startsWith('--report=')) v = argv[i].slice('--report='.length);
    else continue;
    if (v === undefined || v === '' || v.startsWith('--')) throw new UsageError('--report needs a value');
    if (report !== undefined) throw new UsageError('--report given more than once');
    report = v;
  }
  return report;
}

const argv = process.argv.slice(2);
const run = { id: crypto.randomUUID(), started_at: new Date().toISOString() };
let reportFile;
try {
  reportFile = earlyReportPath(argv);
} catch (e) {
  console.error(`usage error: ${e.message}`);
  process.exit(2);
}
const writeReport = (body) => {
  if (reportFile === undefined) return true;
  try {
    fs.mkdirSync(path.dirname(path.resolve(reportFile)), { recursive: true });
    fs.writeFileSync(reportFile, JSON.stringify({ tool: 'tools/difffuzz/run-mandates.mjs', format: FORMAT, run, ...body }, null, 2) + '\n');
    return true;
  } catch (e) {
    console.error(`cannot write the report ${reportFile}: ${e.message}`);
    return false;
  }
};
if (!writeReport({ status: 'incomplete' })) process.exit(3);

let opts;
try {
  opts = parseArgs(argv);
} catch (e) {
  console.error(`usage error: ${e.message}`);
  process.exit(writeReport({ status: 'error', error: { kind: 'usage', message: e.message }, exit: 2, finished_at: new Date().toISOString() }) ? 2 : 3);
}
const status = (exit) => (exit === 0 ? 'pass' : exit === 1 ? 'fail' : 'error');
if (opts.transportProbe) {
  const r = await transportProbe(opts);
  process.exitCode = writeReport({ status: r.exit === 0 ? 'observed' : 'error', ...r, finished_at: new Date().toISOString() }) ? r.exit : 3;
} else if (opts.replay) {
  const r = await replayFinding(opts);
  process.exitCode = writeReport({ status: r.exit === 0 ? 'reproduced' : r.exit === 1 ? 'not_reproduced' : 'error', replay: r, exit: r.exit, finished_at: new Date().toISOString() }) ? r.exit : 3;
} else {
  const r = await runCampaign(opts);
  process.exitCode = writeReport({ status: status(r.exit), ...r, finished_at: new Date().toISOString() }) ? r.exit : 3;
}
