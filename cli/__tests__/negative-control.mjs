// Negative control for the CLI suites (npm run test:negative-control). With DCP_NEGATIVE_CONTROL=1
// each suite inverts the expectation of one positive case, so the run must exit 1 with exactly
// those cases failing, each on an assertion. Any other outcome fails the control: another or a
// missing failure, a suite that did not load, a cancelled or skipped test, a timeout, another
// exit code. It runs the suites itself and reads no earlier report.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('..', import.meta.url));
const SUITES = ['__tests__/verify-s-range.test.mjs', '__tests__/verify-v2-normative.test.mjs'];
const INVERTED = [
  'v1, rfc8032_test1 key: a signature over its bytes: VALID',
  'signed_bundle (hybrid, pq_over_classical): VALID, exit 0',
];

const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...SUITES], {
  cwd: CLI,
  encoding: 'utf8',
  env: { ...process.env, DCP_NEGATIVE_CONTROL: '1' },
  timeout: 600_000,
  maxBuffer: 64 * 1024 * 1024,
});
const lines = (run.stdout ?? '').split('\n');
const count = (name) => Number(lines.find((l) => l.startsWith(`# ${name} `))?.slice(name.length + 3) ?? NaN);
// Top-level results only: a test's own subtests are indented.
const failures = [];
lines.forEach((line, i) => {
  const m = line.match(/^not ok \d+ - (.*?)(?: # .*)?$/);
  if (!m) return;
  const end = lines.findIndex((l, j) => j > i && /^(ok |not ok |# Subtest: )/.test(l));
  const block = lines.slice(i + 1, end === -1 ? undefined : end).join('\n');
  failures.push({ name: m[1], assertion: /code: 'ERR_ASSERTION'/.test(block) });
});

const totals = { tests: count('tests'), pass: count('pass'), fail: count('fail'), cancelled: count('cancelled'),
  skipped: count('skipped'), todo: count('todo') };
const checks = {
  ran: run.error === undefined && run.signal === null,
  exit_code_1: run.status === 1,
  only_the_inverted_cases_failed: JSON.stringify(failures.map((f) => f.name).sort()) === JSON.stringify([...INVERTED].sort()),
  each_on_an_assertion: failures.length === INVERTED.length && failures.every((f) => f.assertion),
  every_other_test_passed: totals.fail === INVERTED.length && totals.pass === totals.tests - INVERTED.length,
  nothing_cancelled_or_skipped: totals.cancelled === 0 && totals.skipped === 0 && totals.todo === 0,
};
const ok = Object.values(checks).every(Boolean);
console.log(JSON.stringify({ exit_code: run.status, signal: run.signal, error: run.error?.message ?? null, totals,
  failures, checks }, null, 2));
console.log(ok ? 'NEGATIVE CONTROL: failed as required' : 'NEGATIVE CONTROL: DID NOT FAIL AS REQUIRED');
if (!ok) process.stderr.write(run.stderr ?? '');
process.exit(ok ? 0 : 1);
