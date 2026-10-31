// Self-tests of the differential fuzzer: the real driver (fuzz.mjs) against controlled real child processes
// (test/fake-shim.mjs), never an SDK. Injected commands are a test-only input: such a run never credits the SDKs.
//   node --test tools/difffuzz/difffuzz.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DEFAULTS, HERE, loadSeeds, parseArgs, provenance, replayFinding, runCampaign } from './fuzz.mjs';

const FAKE = path.join(HERE, 'test', 'fake-shim.mjs');
const fake = (b) => [process.execPath, FAKE, b];
const quiet = () => {};
const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'difffuzz-test-'));
const opts = (extra = {}) => ({ ...DEFAULTS, modes: ['default'], iterations: 0, timeoutMs: 20000, maxFindings: 1000, out: tmpdir(), ...extra });
const shims = (ts, rest = 'by-field') => ({ ts: fake(ts), py: fake(rest), go: fake(rest), rust: fake(rest) });
const synthetic = (docs) => ({
  basePolicy: { default_mode: 'hybrid_preferred' },
  seeds: docs.map((doc, i) => ({ name: `SEED-NAME-SECRET-${i}`, doc, expect: () => (doc.ok === true ? true : doc.ok === false ? false : null), overrides: null, basis: 'normative' })),
});
const bundle = (extra = {}) => ({ bundle: { dcp_bundle_version: '2.0', a: 1, n: 5, m: 7, s: 'x' }, signature: { s: 'y' }, ok: true, ...extra });
const classes = (report) => report.findings.flatMap((f) => f.classes);

test('the CLI refuses bad arguments with exit 2 before anything is built', () => {
  for (const args of [['--iterations', 'x'], ['--modes', 'bogus'], ['--modes', 'default,default'], ['--seed', ''], ['--bogus'], ['--timeout', '0'],
    ['--iterations'], ['--iterations', '-1'], ['--case-bytes', '9999999', '--batch-bytes', '65536'], ['--offline', '--offline']]) {
    // PATH has no go, cargo or python: a build would end in exit 3, never 2.
    const r = spawnSync(process.execPath, [path.join(HERE, 'run.mjs'), ...args], { env: { PATH: '/nonexistent' }, encoding: 'utf8', timeout: 20000 });
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
    assert.match(r.stderr, /^usage error: /);
  }
  const o = parseArgs(['--iterations=5', '--seed', '7', '--timeout', '30000', '--modes', 'pq_only,default']);
  assert.deepEqual([o.iterations, o.seed, o.timeoutMs, o.modes], [5, '7', 30000, ['pq_only', 'default']]);
});

test('accepting or rejecting everything contradicts the declared expectations of bundle_vectors.json', async () => {
  const { seeds } = loadSeeds();
  const declared = (v) => seeds.filter((s) => s.expect?.('default') === v).length;
  const all = { ts: fake('accept-all'), py: fake('accept-all'), go: fake('accept-all'), rust: fake('accept-all') };
  const a = await runCampaign(opts(), { commands: all, log: quiet });
  assert.equal(a.exit, 1);
  assert.equal(a.report.findings.filter((f) => f.classes.includes('expectation')).length, declared(false));
  assert.equal(a.report.sdk_campaign, false);
  const none = { ts: fake('reject-all'), py: fake('reject-all'), go: fake('reject-all'), rust: fake('reject-all') };
  const r = await runCampaign(opts(), { commands: none, log: quiet });
  assert.equal(r.exit, 1);
  assert.equal(r.report.findings.filter((f) => f.classes.includes('expectation')).length, declared(true));
  assert.ok(r.report.seeds.differential_only.length > 0, 'cross_sdk_vectors seeds are differential-only');
});

test('answers outside the protocol are harness faults (exit 3), never agreement', async () => {
  for (const b of ['empty', 'string-valid', 'missing', 'duplicate', 'unknown', 'stale', 'extra-field', 'unsupported', 'silent', 'descendant']) {
    const r = await runCampaign(opts(), { commands: shims(b), seedsOverride: synthetic([bundle(), bundle({ ok: false })]), log: quiet });
    assert.equal(r.exit, 3, b);
    assert.ok(classes(r.report).some((c) => c === 'protocol' || c === 'unsupported'), `${b}: ${classes(r.report)}`);
    assert.equal(r.report.stats.agreements, 0, b);
  }
});

test('an exit 1 after a correct answer, an SDK error, a hang that ignores SIGTERM and oversized output are findings, not votes', async () => {
  for (const [b, cls, extra] of [['exit1', 'crash'], ['error', 'sdk_error'], ['hang', 'timeout', { timeoutMs: 1000 }], ['large', 'output_limit', { stdoutBytes: 1 << 16 }]]) {
    const started = Date.now();
    const r = await runCampaign(opts(extra), { commands: shims(b), seedsOverride: synthetic([bundle({ ok: 'n/a' })]), log: quiet });
    assert.equal(r.exit, 1, b);
    assert.deepEqual(r.report.findings.map((f) => f.classes), [[cls]], b);
    assert.ok(Date.now() - started < 20000, `${b} took ${Date.now() - started} ms`);
  }
});

test('mutants without any seed declared valid in the first mode are an infrastructure error', async () => {
  const r = await runCampaign(opts({ iterations: 1 }), { commands: shims('by-field'), seedsOverride: synthetic([bundle({ ok: false })]), log: quiet });
  assert.equal(r.exit, 3);
  assert.match(r.report.error.message, /no seed is declared valid/);
});

test('a cannot-start shim is an infrastructure error', async () => {
  const r = await runCampaign(opts(), { commands: { ...shims('by-field'), ts: ['/nonexistent/difffuzz-shim'] }, seedsOverride: synthetic([bundle()]), log: quiet });
  assert.equal(r.exit, 3);
  assert.match(r.report.error.message, /cannot start/);
});

test('a failed batch is isolated case by case and never hidden', async () => {
  // ok: 'n/a' declares no expectation, so a crash is the only class.
  const seeds = synthetic([bundle({ ok: 'n/a' }), bundle({ ok: 'n/a', note: 'BOOM' })]);
  const r = await runCampaign(opts(), { commands: shims('crash-on-boom'), seedsOverride: seeds, log: quiet });
  assert.equal(r.exit, 1);
  assert.deepEqual(r.report.findings.map((f) => [f.seed_name, f.classes]), [['SEED-NAME-SECRET-1', ['crash']]]);
  assert.equal(r.report.events.length, 1);
  assert.deepEqual(r.report.events[0].isolated, [{ job: 1, category: 'crash' }]);
  const flaky = await runCampaign(opts(), { commands: shims('crash-if-batch'), seedsOverride: seeds, log: quiet });
  assert.equal(flaky.exit, 1);
  assert.deepEqual(flaky.report.findings.map((f) => f.classes), [['batch_failure_not_reproduced']]);
  const budget = await runCampaign(opts({ maxRetries: 0 }), { commands: shims('crash-on-boom'), seedsOverride: seeds, log: quiet });
  assert.equal(budget.exit, 3);
  assert.match(budget.report.error.message, /retry budget/);
});

test('requests carry no expectation and no seed name', async () => {
  const record = path.join(tmpdir(), 'requests.jsonl');
  process.env.FAKE_RECORD = record;
  try {
    const r = await runCampaign(opts({ iterations: 3 }), { commands: shims('by-field'), seedsOverride: synthetic([bundle(), bundle({ ok: false })]), log: quiet });
    assert.equal(r.exit, 0);
  } finally {
    delete process.env.FAKE_RECORD;
  }
  const lines = fs.readFileSync(record, 'utf8').trim().split('\n');
  assert.ok(lines.length >= 8);
  for (const line of lines) {
    assert.doesNotMatch(line, /SEED-NAME-SECRET|"expect|must_reject|error_contains/);
    const req = JSON.parse(line);
    assert.deepEqual(Object.keys(req).sort(), ['cases', 'nonce', 'now_ms', 'protocol', 'run_id']);
    for (const c of req.cases) {
      assert.deepEqual(Object.keys(c).sort(), ['bundle_b64', 'id', 'policy']);
      assert.match(c.id, /^[0-9a-f]{24}$/);
    }
  }
});

test('a clean run passes, batch by batch, with the same instant and explicit policy in every request', async () => {
  const r = await runCampaign(opts({ iterations: 40, modes: ['default', 'hybrid_required'], batchCases: 8 }), { commands: shims('by-field'), seedsOverride: synthetic([bundle(), bundle({ ok: false })]), log: quiet });
  assert.equal(r.exit, 0, JSON.stringify(r.report.findings.slice(0, 2)));
  assert.equal(r.report.status, 'pass');
  assert.ok(r.report.stats.batches >= 4 * 10, `batches ${r.report.stats.batches}`);
  assert.equal(r.report.injected_commands, true);
});

test('a key reorder that changes a verdict is a finding even when every shim agrees', async () => {
  const r = await runCampaign(opts({ iterations: 12 }), { commands: shims('order', 'order'), seedsOverride: synthetic([bundle()]), mutators: ['reorder_keys'], log: quiet });
  assert.equal(r.exit, 1);
  assert.ok(classes(r.report).includes('reorder'));
  assert.ok(!classes(r.report).includes('disagreement'));
  assert.ok(r.report.findings.every((f) => f.minimization?.status === 'skipped'));
});

test('minimization keeps the raw bytes, the class and the control, within its budget', async () => {
  const seed = synthetic([bundle({ x: 1, y: 2, z: 3 })]);
  const r = await runCampaign(opts({ iterations: 40, seed: 'raw' }), { commands: shims('raw-detect', 'accept-all'), seedsOverride: seed, mutators: ['number_variant'], log: quiet });
  const raw = r.report.findings.filter((f) => f.classes.includes('disagreement'));
  assert.ok(raw.length > 0, 'no 1e400 mutant with this seed');
  for (const f of raw) {
    assert.equal(f.minimization.status, 'locally_minimal_within_budget', JSON.stringify(f.minimization));
    assert.equal(f.minimization.units, 1);
    assert.match(Buffer.from(f.minimization.minimized_b64, 'base64').toString('utf8'), /:1e400[,}]/);
  }
});

test('a batch answered outside the protocol keeps the run from passing even when every case alone is valid', async () => {
  // The batch answers {} whenever it carries more than one case; each case alone answers correctly.
  const seeds = synthetic([bundle(), bundle({ ok: false })]);
  const r = await runCampaign(opts(), { commands: { ts: fake('empty-if-batch'), py: fake('empty-if-batch'), go: fake('empty-if-batch'), rust: fake('empty-if-batch') }, seedsOverride: seeds, log: quiet });
  assert.equal(r.exit, 3);
  assert.equal(r.report.status, 'error');
  assert.equal(r.report.events.length, 4);
  assert.ok(r.report.events.every((e) => e.category === 'protocol' && e.not_reproduced));
});

test('every shim run is awaited before the run ends, whichever fails first', async () => {
  const marker = `difffuzz-orphan-${process.pid}-${Date.now()}`;
  const hang = [process.execPath, FAKE, 'hang', marker];
  const r = await runCampaign(opts({ timeoutMs: 1000 }), { commands: { ts: ['/nonexistent/difffuzz-shim'], py: hang, go: hang, rust: hang }, seedsOverride: synthetic([bundle()]), log: quiet });
  assert.equal(r.exit, 3);
  assert.equal(spawnSync('pgrep', ['-f', marker]).status, 1, 'a hanging shim outlived the run');
});

test('the commands must be exactly the four SDKs, injected or not', async () => {
  for (const commands of [{ ts: fake('by-field'), py: fake('by-field'), go: fake('by-field') }, { ...shims('by-field'), wasm: fake('by-field') }, { ...shims('by-field'), rust: [] }]) {
    const r = await runCampaign(opts(), { commands, seedsOverride: synthetic([bundle()]), log: quiet });
    assert.equal(r.exit, 3);
    assert.match(r.report.error.message, /commands must be exactly|non-empty argv/);
  }
});

test('requests are cut by their exact UTF-8 size; a seed that does not fit is an error, an oversized mutant is skipped and counted', async () => {
  const record = path.join(tmpdir(), 'requests.jsonl');
  process.env.FAKE_RECORD = record;
  try {
    const pad = (n) => bundle({ pad: 'é'.repeat(n) });
    const r = await runCampaign(opts({ batchBytes: 65536 }), { commands: shims('by-field'), seedsOverride: synthetic([pad(8000), pad(8000), pad(8000), pad(8000)]), log: quiet });
    assert.equal(r.exit, 0);
  } finally {
    delete process.env.FAKE_RECORD;
  }
  const sizes = fs.readFileSync(record, 'utf8').trim().split('\n').map((l) => Buffer.byteLength(l));
  assert.ok(sizes.length > 4 && sizes.every((n) => n <= 65536), `request sizes ${sizes}`);
  const big = await runCampaign(opts({ batchBytes: 65536 }), { commands: shims('by-field'), seedsOverride: synthetic([bundle({ pad: 'x'.repeat(70000) })]), log: quiet });
  assert.equal(big.exit, 3);
  assert.match(big.report.error.message, /does not fit/);
  const skip = await runCampaign(opts({ iterations: 10, caseBytes: 32768 }), { commands: shims('by-field'), seedsOverride: synthetic([bundle()]), mutators: ['oversized_string'], log: quiet });
  assert.equal(skip.exit, 0);
  assert.ok(skip.report.stats.skipped_oversize > 0);
});

test('--max-findings bounds the baseline and the batches too', async () => {
  const all = { ts: fake('accept-all'), py: fake('accept-all'), go: fake('accept-all'), rust: fake('accept-all') };
  const r = await runCampaign(opts({ maxFindings: 3, batchCases: 16 }), { commands: all, log: quiet });
  assert.equal(r.exit, 1);
  assert.equal(r.report.findings.length, 3);
  assert.equal(r.report.stopped_early, true);
  assert.equal(r.report.seeds.baseline_complete, false);
  assert.ok(r.report.stats.jobs_not_run > 0 && r.report.stats.findings_suppressed > 0);
});

test('no minimization without a valid control', async () => {
  // The seed itself carries 1e400, so its baseline already disagrees: it cannot control a minimization.
  const seed = synthetic([bundle({ x: '\0RAW:1e400\0', y: 2 })]);
  const r = await runCampaign(opts({ iterations: 20, seed: 'ctl' }), { commands: shims('raw-detect', 'accept-all'), seedsOverride: seed, mutators: ['number_variant'], log: quiet });
  const mutants = r.report.findings.filter((f) => f.kind === 'mutant');
  assert.ok(mutants.length > 0);
  assert.ok(mutants.every((f) => f.minimization.status === 'skipped' && /no valid positive control/.test(f.minimization.reason)));
});

test('a replay uses the finding\'s own instant and policy, checks the control, and exits honestly', async () => {
  const seeds = synthetic([bundle({ x: 1, y: 2, z: 3 })]);
  const out = tmpdir();
  const r = await runCampaign(opts({ iterations: 40, seed: 'raw', out }), { commands: shims('raw-detect', 'accept-all'), seedsOverride: seeds, mutators: ['number_variant'], log: quiet });
  const finding = r.report.findings.find((f) => f.classes.includes('disagreement'));
  assert.ok(finding);
  const file = path.join(out, finding.file);
  const record = path.join(tmpdir(), 'requests.jsonl');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...saved, now_ms: saved.now_ms + 1234 }));
  process.env.FAKE_RECORD = record;
  let ok;
  try {
    ok = await replayFinding({ ...opts(), replay: file }, { commands: shims('raw-detect', 'accept-all'), seedsOverride: seeds, log: quiet });
  } finally {
    delete process.env.FAKE_RECORD;
  }
  assert.equal(ok.exit, 0, JSON.stringify(ok.report));
  assert.deepEqual([ok.report.control, ok.report.input, ok.report.minimized], ['reproduced', 'reproduced', 'reproduced']);
  assert.ok(fs.readFileSync(record, 'utf8').trim().split('\n').every((l) => JSON.parse(l).now_ms === saved.now_ms + 1234));
  const gone = await replayFinding({ ...opts(), replay: file }, { commands: shims('accept-all', 'accept-all'), seedsOverride: seeds, log: quiet });
  assert.equal(gone.exit, 1);
  assert.equal(gone.report.input, 'not_reproduced');
  const badControl = await replayFinding({ ...opts(), replay: file }, { commands: shims('reject-all', 'reject-all'), seedsOverride: seeds, log: quiet });
  assert.equal(badControl.exit, 3);
  fs.writeFileSync(file, JSON.stringify({ ...saved, input_sha256: '0'.repeat(64) }));
  const corrupt = await replayFinding({ ...opts(), replay: file }, { commands: shims('raw-detect', 'accept-all'), seedsOverride: seeds, log: quiet });
  assert.equal(corrupt.exit, 3);
  const cli = spawnSync(process.execPath, [path.join(HERE, 'run.mjs'), '--replay', path.join(out, 'missing.json')], { encoding: 'utf8', timeout: 20000, env: { PATH: '/nonexistent' } });
  assert.equal(cli.status, 3);
});

test('the CLI renews an unambiguous --report on a usage error, and writes nothing for an ambiguous one', () => {
  const dir = tmpdir();
  const stale = path.join(dir, 'report.json');
  const old = JSON.stringify({ status: 'pass', run: { id: 'old-pass' } });
  const cli = (...args) => spawnSync(process.execPath, [path.join(HERE, 'run.mjs'), ...args], { env: { PATH: '/nonexistent' }, encoding: 'utf8', timeout: 20000 });
  for (const args of [['--iterations', 'bad', '--report', stale], [`--report=${stale}`, '--modes', 'bogus']]) {
    fs.writeFileSync(stale, old);
    const r = cli(...args);
    assert.equal(r.status, 2, r.stderr);
    const rep = JSON.parse(fs.readFileSync(stale, 'utf8'));
    assert.equal(rep.status, 'error');
    assert.equal(rep.error.kind, 'usage');
    assert.equal(rep.exit, 2);
    assert.notEqual(rep.run.id, 'old-pass');
  }
  for (const args of [['--report', stale, '--report', path.join(dir, 'other.json')], ['--iterations', 'bad', '--report'], ['--report', '--iterations', '5']]) {
    fs.writeFileSync(stale, old);
    const r = cli(...args);
    assert.equal(r.status, 2, args.join(' '));
    assert.equal(fs.readFileSync(stale, 'utf8'), old, `${args.join(' ')} wrote a report`);
    assert.ok(!fs.existsSync(path.join(dir, 'other.json')));
  }
  const unwritable = cli('--iterations', 'bad', '--report', path.join(stale, 'under-a-file.json'));
  assert.equal(unwritable.status, 3);
  assert.match(unwritable.stderr, /cannot write the report/);
});

test('at least half of the iterations, rounded up, start from a seed declared valid', async () => {
  const seeds = synthetic([bundle(), bundle({ ok: false }), bundle({ ok: false }), bundle({ ok: false })]);
  const r = await runCampaign(opts({ iterations: 9 }), { commands: shims('by-field'), seedsOverride: seeds, log: quiet });
  assert.equal(r.exit, 0);
  assert.ok(r.report.stats.from_valid >= 5, `from_valid ${r.report.stats.from_valid}`);
});

// A campaign that leaves one disagreement finding on disk, with its recorded control: the base of the replay tests.
async function oneFinding() {
  const seeds = synthetic([bundle({ x: 1, y: 2, z: 3 })]);
  const out = tmpdir();
  const r = await runCampaign(opts({ iterations: 40, seed: 'raw', out }), { commands: shims('raw-detect', 'accept-all'), seedsOverride: seeds, mutators: ['number_variant'], log: quiet });
  const finding = r.report.findings.find((f) => f.kind === 'mutant' && f.classes.includes('disagreement'));
  const file = path.join(out, finding.file);
  return { seeds, file, saved: JSON.parse(fs.readFileSync(file, 'utf8')) };
}
const replay = (file, seeds, ts = 'raw-detect', rest = 'accept-all') => replayFinding({ ...opts(), replay: file }, { commands: shims(ts, rest), seedsOverride: seeds, log: quiet });

test('a replay refuses a finding whose outcomes are not typed or whose classes are not those of its outcomes', async () => {
  const { seeds, file, saved } = await oneFinding();
  assert.equal((await replay(file, seeds)).exit, 0);
  const untyped = { ...saved, outcomes: { ...saved.outcomes, ts: { category: 'verdict' } } };
  const sameRejections = { ...saved, outcomes: Object.fromEntries(['ts', 'py', 'go', 'rust'].map((s) => [s, { category: 'verdict', verified: false, errors: [] }])) };
  const noControl = { ...saved, control: undefined };
  const unknownClass = { ...saved, classes: ['disagreement', 'vibes'] };
  for (const [name, f, why] of [['untyped', untyped, /four typed SDK outcomes/], ['same rejections', sameRejections, /not those of its own outcomes/], ['no control', noControl, /no original control/], ['unknown class', unknownClass, /known classes/]]) {
    fs.writeFileSync(file, JSON.stringify(f));
    const r = await replay(file, seeds);
    assert.equal(r.exit, 3, name);
    assert.match(r.report.error, why, name);
  }
});

test('a replay runs its own recorded control, not the current fixture of that name, and reports the difference', async () => {
  const { file, saved } = await oneFinding();
  const changed = synthetic([bundle({ x: 1, y: 2, z: 3, revision: 'different bytes, same name' })]);
  const record = path.join(tmpdir(), 'requests.jsonl');
  process.env.FAKE_RECORD = record;
  let r;
  try {
    r = await replay(file, changed);
  } finally {
    delete process.env.FAKE_RECORD;
  }
  assert.equal(r.exit, 0, JSON.stringify(r.report));
  assert.equal(r.report.control, 'reproduced');
  assert.ok(r.report.provenance_differences.includes('fixture_seed_changed:SEED-NAME-SECRET-0'), r.report.provenance_differences);
  for (const line of fs.readFileSync(record, 'utf8').trim().split('\n')) {
    const sent = JSON.parse(line).cases.map((c) => c.bundle_b64);
    assert.ok(sent.includes(saved.control.input_b64));
    assert.ok(!sent.some((b) => Buffer.from(b, 'base64').toString('utf8').includes('different bytes')));
  }
});

test('minimization needs a positive control: a seed correctly rejected is no control', async () => {
  const seeds = synthetic([bundle({ x: 1, y: 2 }), bundle({ ok: false, x: 1, y: 2 })]);
  const r = await runCampaign(opts({ iterations: 200, seed: 'pos-neg' }), { commands: shims('raw-error', 'by-field'), seedsOverride: seeds, mutators: ['number_variant'], log: quiet });
  const bySeed = (i) => r.report.findings.filter((f) => f.kind === 'mutant' && f.seed_name === `SEED-NAME-SECRET-${i}`);
  assert.ok(bySeed(0).length > 0 && bySeed(1).length > 0, 'both seeds need sdk_error mutants with this PRNG seed');
  assert.ok(bySeed(0).every((f) => f.minimization.status === 'locally_minimal_within_budget'), JSON.stringify(bySeed(0).map((f) => f.minimization)));
  assert.ok(bySeed(1).every((f) => f.minimization.status === 'skipped' && /positive control/.test(f.minimization.reason)));
  assert.equal(r.report.findings.filter((f) => f.kind === 'baseline').length, 0, 'the negative seed is correctly rejected by all four');
});

test('provenance compares content, not the ephemeral paths of the built shims, and records driver and fixtures', async () => {
  const bin = (dir, content) => { const f = path.join(dir, 'bin'); fs.writeFileSync(f, content); return f; };
  const files = (go, rust) => ({ go_shim: go, rust_shim: rust, ts_shim: path.join(HERE, 'shims/ts/verify.mjs'), py_shim: path.join(HERE, 'shims/py/verify.py') });
  const a = provenance(files(bin(tmpdir(), 'go'), bin(tmpdir(), 'rust')), { python: 'x' });
  const b = provenance(files(bin(tmpdir(), 'go'), bin(tmpdir(), 'rust')), { python: 'x' });
  const c = provenance(files(bin(tmpdir(), 'go2'), bin(tmpdir(), 'rust')), { python: 'x' });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.go_shim, c.go_shim);
  assert.ok(a.ts_sdk_source && a.ts_sdk_dist);
  const r = await runCampaign(opts(), { commands: shims('by-field'), seedsOverride: synthetic([bundle()]), log: quiet });
  assert.equal(r.report.inputs.driver.fuzz.sha256.length, 64);
  assert.match(r.report.inputs.fixtures, /injected/);
  assert.ok(r.report.provenance_limits.some((l) => /not verified/.test(l)));
});

test('a harness fault decides the exit even when --max-findings left no room to record it, in either order', async () => {
  const pos = bundle();
  const err = bundle({ ok: 'n/a', fault: 'error' });
  const unsup = bundle({ ok: 'n/a', fault: 'unsupported' });
  for (const docs of [[pos, err, unsup], [pos, unsup, err]]) {
    const r = await runCampaign(opts({ maxFindings: 1 }), { commands: shims('fault-field'), seedsOverride: synthetic(docs), log: quiet });
    assert.equal(r.exit, 3, JSON.stringify(r.report.stats));
    assert.equal(r.report.status, 'error');
    assert.equal(r.report.findings.length, 1);
    assert.ok(r.report.stats.findings_suppressed >= 1);
    assert.deepEqual([r.report.stats.observed_classes.unsupported, r.report.stats.observed_classes.sdk_error], [1, 1]);
  }
  // Without a harness fault the same cap gives findings (exit 1), and a clean seed alone passes.
  const findings = await runCampaign(opts({ maxFindings: 1 }), { commands: shims('fault-field'), seedsOverride: synthetic([pos, err, err]), log: quiet });
  assert.deepEqual([findings.exit, findings.report.status], [1, 'findings']);
  const clean = await runCampaign(opts({ maxFindings: 1 }), { commands: shims('fault-field'), seedsOverride: synthetic([pos]), log: quiet });
  assert.deepEqual([clean.exit, clean.report.status], [0, 'pass']);
});

test('a harness fault seen only during minimization still makes the run a harness error', async () => {
  // The ts shim answers unsupported to every two-case request: exactly the minimization batches (candidate + control).
  const r = await runCampaign(opts({ iterations: 40, seed: 'raw' }), { commands: shims('unsup-if-two', 'accept-all'), seedsOverride: synthetic([bundle({ x: 1, y: 2, z: 3 })]), mutators: ['number_variant'], log: quiet });
  assert.ok(r.report.findings.length > 0 && r.report.findings.every((f) => !f.classes.includes('unsupported')), 'the recorded findings carry no harness class');
  assert.ok(r.report.stats.minimize_runs > 0);
  assert.equal(r.exit, 3);
  assert.equal(r.report.status, 'error');
});
