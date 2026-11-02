#!/usr/bin/env node
// Runs the opt-in schema-validation catalog (tools/conformance/external-schema-validation-catalog.json, the wiring
// cases) against one conformance wrapper through runEvidence of the external kit, unchanged: the same /2 request,
// process limits and judgement. Phase 1 uses it for the BEFORE sample: a negative that a verifier accepts is a V2-2 gap.
//
//   node tools/schema-ir/before.mjs --report <file> -- <wrapper argv...>
// Exit codes: 0 every case passed, 1 at least one failed, 3 infrastructure error.
import fs from 'node:fs';
import { runEvidence } from '../conformance/external-evidence.js';
import { loadSchemaValidationPlan } from './corpus.mjs';

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const at = argv.indexOf('--report');
if (sep < 0 || sep === argv.length - 1) { console.error('usage: node tools/schema-ir/before.mjs [--report <file>] -- <wrapper argv...>'); process.exit(3); }
try {
  const report = await runEvidence({ plan: loadSchemaValidationPlan(), argv: argv.slice(sep + 1) });
  if (at >= 0 && at < sep) fs.writeFileSync(argv[at + 1], `${JSON.stringify(report, null, 2)}\n`);
  const t = report.totals;
  console.log(`${report.status}: ${t.pass} pass, ${t.fail} fail, ${t.error} error of ${t.cases} (${report.implementation.self_declared?.name ?? 'unknown'} ${report.implementation.self_declared?.version ?? ''})`);
  process.exitCode = report.status === 'pass' ? 0 : report.status === 'fail' ? 1 : 3;
} catch (e) {
  console.error(e.stack);
  process.exitCode = 3;
}
