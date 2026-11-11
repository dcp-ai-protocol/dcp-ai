#!/usr/bin/env node
// The CI entry of the release validation (.github/workflows/release-validation.yml). It takes its inputs from
// the environment, as data: LANE ("all" or one lane of the manifest), RESOLUTION (locked or fresh), WORK, and
// the toolchain paths PYTHON, GO, CARGO and CHROME. It runs run.mjs and decides what the job may say:
//
//   all       + exit 0  → PASS: the complete campaign
//   one lane  + exit 4  → PARTIAL: a diagnostic, the job succeeds and says so
//   anything else       → the job fails. In particular a selection that returns 0, or "all" that returns 4,
//                         is a contradiction and never becomes a success.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** { ok, exit (the job's exit code), summary } for a selection and the exit code run.mjs returned. */
export function ciOutcome(lane, code) {
  if (lane === 'all' && code === 0) return { ok: true, exit: 0, summary: 'PASS: the complete campaign.' };
  if (lane !== 'all' && code === 4) return { ok: true, exit: 0, summary: `PARTIAL: lane \`${lane}\` only. A diagnostic, not a validation of the release.` };
  if (lane !== 'all' && code === 0) return { ok: false, exit: 1, summary: `Contradiction: lane \`${lane}\` alone returned 0, which only the complete campaign may return.` };
  if (lane === 'all' && code === 4) return { ok: false, exit: 1, summary: 'Contradiction: the complete campaign returned PARTIAL (4).' };
  return { ok: false, exit: Number.isInteger(code) && code > 0 && code < 256 ? code : 1, summary: `Release validation failed (exit code ${code}).` };
}

/** The arguments of run.mjs for the environment, or a usage error. Nothing here is passed through a shell. */
export function ciArgs(env, manifest) {
  const { LANE: lane, RESOLUTION: resolution } = env;
  if (lane !== 'all' && !Object.hasOwn(manifest.lanes, lane ?? '')) throw new Error(`LANE must be "all" or a lane of the manifest, not ${JSON.stringify(lane)}`);
  if (resolution !== 'locked' && resolution !== 'fresh') throw new Error(`RESOLUTION must be locked or fresh, not ${JSON.stringify(resolution)}`);
  const args = ['--resolution', resolution, '--clean'];
  for (const [name, flag] of [['WORK', '--work'], ['PYTHON', '--python'], ['GO', '--go'], ['CARGO', '--cargo'], ['CHROME', '--chrome']]) {
    if (!env[name]) throw new Error(`${name} is required`);
    args.push(flag, env[name]);
  }
  if (lane !== 'all') args.push('--lane', lane);
  return args;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(fs.readFileSync(path.join(HERE, 'manifest.json'), 'utf8'));
  let args;
  try { args = ciArgs(process.env, manifest); } catch (e) { console.error(`::error::${e.message}`); process.exit(2); }
  const r = spawnSync(process.execPath, [path.join(HERE, 'run.mjs'), ...args], { stdio: 'inherit' });
  const outcome = ciOutcome(process.env.LANE, r.status ?? -1);
  console.log(`${outcome.ok ? '::notice::' : '::error::'}${outcome.summary}`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${outcome.summary}\n`);
  process.exit(outcome.exit);
}
