#!/usr/bin/env node
// Differential fuzzer: the same mutated V2 signed bundle goes, in finite bounded batches, through the TypeScript,
// Python, Go and Rust verifiers under one explicit policy and one verification instant. See README.md and fuzz.mjs.
//
//   node tools/difffuzz/run.mjs [--iterations N] [--seed S] [--modes a,b] [--timeout MS] [--python PATH] [--out DIR]
//     [--report FILE] [--offline] [--build-timeout-ms MS] [--batch-cases N] [--batch-bytes B] [--case-bytes B]
//     [--stdout-bytes B] [--max-findings N] [--max-retries N] [--minimize-steps N] [--minimize-total N]
//   node tools/difffuzz/run.mjs --replay findings/<file>.json [--python PATH] [--offline] [--report FILE]
//
// Exit codes: 0 no finding, 1 at least one finding, 2 usage (checked before anything is built), 3 infrastructure or
// harness fault (build, a shim outside the protocol, an exhausted retry budget, no declared-valid seed).
// With an unambiguous --report, an "incomplete" report is written first and replaced on every path, a usage error
// included; a missing, option-like or repeated --report value is ambiguous: exit 2 and no report is written.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PROTOCOL, UsageError, parseArgs, replayFinding, runCampaign } from './fuzz.mjs';

// Only --report is read here. No other option takes a value starting with "--", so a "--report" token is always
// this option and never another option's value.
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
    fs.writeFileSync(reportFile, JSON.stringify({ tool: 'tools/difffuzz/run.mjs', protocol: PROTOCOL, run, ...body }, null, 2) + '\n');
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
if (opts.replay) {
  const { exit, report } = await replayFinding(opts);
  process.exitCode = writeReport({ status: exit === 0 ? 'reproduced' : exit === 1 ? 'not_reproduced' : 'error', replay: report, exit, finished_at: new Date().toISOString() }) ? exit : 3;
} else {
  process.exitCode = (await runCampaign(opts)).exit;
}
