// Launcher of the MP-05 rehearsal (TEST ONLY): the one public command. Standard library only; runs from the checkout.
//
//   node tools/enterprise-rehearsal/node/rehearse.mjs --manifest ARTIFACTS.json --consumer DIR --work NEW_DIR [--lanes node,python]
//
// 1. Runs verify.py from the checkout once (the full installation guard: artifact hashes, installed contents, locks,
//    resolution, Python paths) and keeps its output as NEW_DIR/verify.json. Servers check that record, the staged
//    hashes and where the SDK resolves; they do not repeat verify.py.
// 2. Stages the kit into the consumer (node/stage.mjs).
// 3. Runs the staged runner under node/supervise.mjs: its own process group, a 900 s deadline, and an IPC channel over
//    which the launcher itself creates and stops every server the runner asks for (only the staged kit's scripts, with
//    this Node or the consumer's Python). On the runner's exit, the deadline or an interrupt, the launcher kills the
//    runner's group, stops every server still running, and scans for and deletes any secrets the runner left in the
//    work directory. It never kills a process it did not create; anything it had to clean is a failure.
// Exit code 0 only when every step passed and everything stopped cleanly.
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertOutsideGit } from './paths.mjs';
import { cleanRun, superviseRun } from './supervise.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEADLINE_MS = 900_000;

function parse(argv) {
  const out = { lanes: 'node,python' };
  for (let i = 0; i < argv.length; i++) {
    const key = { '--manifest': 'manifest', '--consumer': 'consumer', '--work': 'work', '--lanes': 'lanes' }[argv[i]];
    if (!key || argv[i + 1] === undefined) throw new Error(`unknown or incomplete argument ${argv[i]}`);
    out[key] = argv[++i];
  }
  if (!out.manifest || !out.consumer || !out.work) {
    throw new Error('usage: node tools/enterprise-rehearsal/node/rehearse.mjs --manifest ARTIFACTS.json --consumer DIR --work NEW_DIR [--lanes node,python]');
  }
  return { ...out, manifest: path.resolve(out.manifest), consumer: path.resolve(out.consumer), work: path.resolve(out.work) };
}

function fail(message) {
  process.stderr.write(`[rehearse] ${message}\n`);
  process.exit(1);
}

const args = (() => {
  try {
    return parse(process.argv.slice(2));
  } catch (e) {
    return fail(e.message);
  }
})();
try {
  assertOutsideGit(args.work);
  fs.mkdirSync(args.work); // a new directory: never reuse an old run
} catch (e) {
  fail(e.message);
}

const verify = spawnSync('python3', [path.join(KIT, 'verify.py'), '--manifest', args.manifest, '--work', args.consumer], {
  encoding: 'utf8',
  timeout: 600_000,
});
let parsed = null;
try {
  parsed = JSON.parse(verify.stdout);
} catch {
  parsed = null;
}
const record = {
  verify_format: 'dcp-ai-mp05-verify-run-v1',
  exit_code: verify.status,
  consumer: fs.realpathSync(args.consumer),
  manifest: args.manifest,
  stdout_sha256: crypto.createHash('sha256').update(verify.stdout ?? '').digest('hex'),
  report: parsed,
  at: new Date().toISOString(),
};
fs.writeFileSync(path.join(args.work, 'verify.json'), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
if (verify.status !== 0) fail(`verify.py failed (${verify.status}): ${(verify.stderr ?? '').slice(-2000)}`);

const stage = spawnSync(process.execPath, [path.join(KIT, 'node', 'stage.mjs'), '--consumer', args.consumer], { encoding: 'utf8', timeout: 60_000 });
fs.writeFileSync(path.join(args.work, 'stage.json'), stage.stdout ?? '');
if (stage.status !== 0) fail(`staging failed: ${stage.stderr}`);

const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR ?? '/tmp', LANG: 'C.UTF-8' };
const staged = fs.realpathSync(path.join(args.consumer, 'node', 'rehearsal'));
const result = await superviseRun(
  [
    process.execPath,
    path.join(staged, 'node', 'runner.mjs'),
    '--work',
    args.work,
    '--consumer',
    args.consumer,
    '--verify-report',
    path.join(args.work, 'verify.json'),
    '--lanes',
    args.lanes,
  ],
  { env, deadlineMs: DEADLINE_MS, work: args.work, executables: [process.execPath, path.join(args.consumer, 'python', 'bin', 'python')], scriptRoot: staged },
);
fs.writeFileSync(path.join(args.work, 'supervision.json'), `${JSON.stringify(result, null, 2)}\n`);
if (result.timedOut) process.stderr.write(`[rehearse] deadline of ${DEADLINE_MS / 1000} s reached: the runner and its servers were killed\n`);
if (!cleanRun(result)) {
  process.stderr.write(`[rehearse] not clean: ${JSON.stringify(result)}\n`);
  process.exit(result.interrupted ? 130 : 1);
}
process.exit(0);
