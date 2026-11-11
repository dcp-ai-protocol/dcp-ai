// Tests of the release validation tool. No external network and no installed package: the verdict functions on
// synthetic data, the process helpers on real processes (the kit's runner and a fixture).
//
//   node --test tools/release-validation/release-validation.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { runProcess, REPO_ROOT, UsageError } from '../conformance/external.js';
import { parseTap, assessCliSuites, assessCliNegative, assessDirect, browserRecordProblems, CONTROL_SETS, requiredControls } from './assess.mjs';
import { EXPECTED, cliOrigin, prepareBrowser, browserDeclaredProblems } from './blocks.mjs';
import {
  scanPython, parseRequirements, pythonTreeView, sdistModuleProblems, goH1, scanGo, checkGoBuildInfo, scanCargo, parseCargoLock, checkCargoMetadata, CRATES_IO,
} from './assess.mjs';
import { EXIT, CONTROL_LANE, REQUIRED_CONTROLS, processProblems, scanNpm, compareTrees, assessIdentity, assessCell, assessCampaign } from './assess.mjs';
import { createSupervisor, supervised, descendantsOf, processTable } from './supervise.mjs';
import http from 'node:http';
import { HERE, IMPLEMENTED, expectedPlan, createWorkDir, cleanConsumers, isolatedEnv, treeOf, checkDeclared, findTool, Stop } from './lanes.mjs';
import { installPython, pythonLockKey, pythonLockKeys, pythonEnv } from './lanes-python.mjs';
import { RUST_FEATURES } from './lanes-rust.mjs';
import { parseArgs } from './run.mjs';
import { ciOutcome, ciArgs } from './ci.mjs';

const manifest = JSON.parse(fs.readFileSync(path.join(HERE, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(HERE, 'consumers', 'npm', 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(HERE, 'consumers', 'npm', 'package-lock.json'), 'utf8'));
const RUNNER = path.join(REPO_ROOT, 'tools', 'conformance-external.js');
const PENDING = path.join(HERE, 'fixtures', 'pending.mjs');
const tmp = () => fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dcp-rv-test-'));
const node = (code, ...args) => [process.execPath, '-e', code, ...args];
const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};
const waitFor = async (file) => {
  for (let i = 0; i < 100 && !fs.existsSync(file); i++) await new Promise((r) => setTimeout(r, 50));
  return Number(fs.readFileSync(file, 'utf8'));
};

// ── runProcess: cwd and env (tools/conformance/external.js) ──────

test('runProcess: a given env is the whole environment, a given cwd is the working directory', async () => {
  const dir = tmp();
  process.env.DCP_RV_TEST_LEAK = 'inherited';
  try {
    const print = 'console.log(JSON.stringify({ cwd: process.cwd(), env: process.env }))';
    const r = await runProcess(node(print), Buffer.alloc(0), { cwd: dir, env: { ONLY: 'this' } });
    assert.equal(r.observed.exit_code, 0);
    const got = JSON.parse(r.stdout.toString('utf8'));
    assert.equal(got.cwd, dir);
    assert.equal(got.env.ONLY, 'this');
    assert.equal(got.env.DCP_RV_TEST_LEAK, undefined);
    assert.equal(got.env.HOME, undefined);
    assert.equal(got.env.PATH, undefined);

    // Without them, both are inherited, as before the options existed.
    const d = JSON.parse((await runProcess(node(print), Buffer.alloc(0))).stdout.toString('utf8'));
    assert.equal(d.cwd, process.cwd());
    assert.equal(d.env.DCP_RV_TEST_LEAK, 'inherited');
  } finally {
    delete process.env.DCP_RV_TEST_LEAK;
    fs.rmSync(dir, { recursive: true });
  }
});

test('runProcess: with cwd and env, stdin, arguments, the deadline and the group kill are unchanged', async () => {
  const dir = tmp();
  try {
    const echo = await runProcess(node('process.stdin.pipe(process.stdout); console.error(process.argv[1])', '$(touch x); `y` "z" *'), Buffer.from('in'), { cwd: dir, env: {} });
    assert.equal(echo.stdout.toString(), 'in');
    assert.equal(echo.observed.stderr_excerpt.trim(), '$(touch x); `y` "z" *'); // literal: no shell
    assert.deepEqual(fs.readdirSync(dir), []);

    // A child of the process, in the same group, that ignores SIGTERM: both die at the deadline.
    const pidFile = path.join(dir, 'pid');
    const parent = `require('child_process').spawn(process.execPath, [${JSON.stringify(PENDING)}, ${JSON.stringify(pidFile)}], { stdio: 'inherit' }); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)`;
    const limits = { stdoutBytes: 1024, stderrKeptBytes: 1024, stderrExcerptBytes: 1024, termGraceMs: 200, closeWaitMs: 2000 };
    const run = runProcess(node(parent), Buffer.alloc(0), { timeoutMs: 1500, limits, cwd: dir, env: {} });
    const pid = await waitFor(pidFile);
    const r = await run;
    assert.equal(r.observed.timed_out, true);
    assert.equal(r.observed.signal, 'SIGKILL');
    assert.equal(r.observed.cleanup_incomplete, false);
    assert.equal(alive(pid), false);

    const missing = await runProcess(node('0'), Buffer.alloc(0), { cwd: path.join(dir, 'absent') });
    assert.equal(missing.observed.spawn_error, 'ENOENT');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

// ── Supervision ──────────────────────────────────────────────────

test('descendantsOf follows parent links across groups and ignores unrelated processes', () => {
  const t = [
    { pid: 10, ppid: 1, pgid: 10 }, { pid: 11, ppid: 10, pgid: 11 }, { pid: 12, ppid: 11, pgid: 12 },
    { pid: 13, ppid: 11, pgid: 11 }, { pid: 20, ppid: 1, pgid: 20 }, { pid: 21, ppid: 20, pgid: 10 },
  ];
  assert.deepEqual(descendantsOf([10], t).map((r) => r.pid), [11, 12, 13]);
  assert.deepEqual(descendantsOf([20, 12], t).map((r) => r.pid), [21]);
});

test('the supervisor never signals a reused pid, a foreign group or its own group', async () => {
  const signals = [];
  let rows = [
    { pid: 1, ppid: 0, pgid: 1, stat: 'S', started: 'a' },
    { pid: 5, ppid: 1, pgid: 5, stat: 'S', started: 'b' }, // a child in its own group
    { pid: 6, ppid: 5, pgid: 99, stat: 'S', started: 'c' }, // joined a group whose leader is not ours
    { pid: 7, ppid: 1, pgid: 1, stat: 'S', started: 'd' }, // in the supervisor's group
    { pid: 99, ppid: 0, pgid: 99, stat: 'S', started: 'e' },
  ];
  const sup = createSupervisor({ root: 1, table: () => rows, kill: (pid, sig) => { signals.push([pid, sig]); if (sig === 'SIGKILL') rows = rows.filter((r) => r.pid !== Math.abs(pid) || r.pid === 5); } });
  assert.deepEqual(sup.observe().alive.map((k) => k.pid).sort(), [5, 6, 7]);
  // 5 exits and its pid is reused by an unrelated process (another start time); 6 is now an orphan.
  rows = rows.map((r) => (r.pid === 5 ? { ...r, ppid: 0, started: 'later' } : r.pid === 6 ? { ...r, ppid: 0 } : r));
  const done = await sup.killAll();
  assert.equal(done.complete, true);
  const targets = new Set(signals.map(([pid]) => pid));
  assert.deepEqual([...targets].sort((a, b) => a - b), [6, 7]); // by pid only: never 5, -5, -99, -1 or 1
});

test('the supervisor reports an unreadable process table and signals nothing', async () => {
  const signals = [];
  const sup = createSupervisor({ root: 1, table: () => { throw new Error('ps failed'); }, kill: (...a) => signals.push(a) });
  const done = await sup.killAll();
  assert.equal(done.complete, false);
  assert.deepEqual(done.errors.slice(0, 1), ['ps failed']);
  assert.deepEqual(signals, []);
});

test('deadline through the real runner: the implementation, in its own group, is stopped', async () => {
  const dir = tmp();
  try {
    const pidFile = path.join(dir, 'pid');
    const sup = createSupervisor();
    const run = supervised(sup, [process.execPath, RUNNER, '--timeout-ms', '10000', '--', process.execPath, PENDING, pidFile], { deadlineMs: 1500 });
    const pid = await waitFor(pidFile);
    const mine = processTable().find((r) => r.pid === process.pid).pgid;
    assert.notEqual(processTable().find((r) => r.pid === pid).pgid, mine); // the topology under test
    const r = await run;
    assert.equal(r.supervisor.deadline_hit, true);
    assert.equal(r.supervisor.cleanup.complete, true);
    assert.ok(r.supervisor.cleanup.found.includes(pid));
    assert.equal(alive(pid), false); // the descendant itself, not a flag of the outer process
    assert.ok(r.observed.duration_ms < 6000);
    assert.deepEqual(sup.observe().alive, []);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('a detached process left behind after a normal exit is reported as leaked and stopped', async () => {
  const dir = tmp();
  try {
    const pidFile = path.join(dir, 'pid');
    const sup = createSupervisor();
    const r = await supervised(sup, [process.execPath, PENDING, pidFile, 'spawn-detached'], { deadlineMs: 20000 });
    const pid = await waitFor(pidFile);
    assert.equal(r.observed.exit_code, 0);
    assert.equal(r.supervisor.deadline_hit, false);
    assert.deepEqual(r.supervisor.leaked, [pid]);
    assert.equal(r.supervisor.cleanup.complete, true);
    assert.equal(alive(pid), false);

    const clean = await supervised(sup, node('0'), { deadlineMs: 20000 });
    assert.deepEqual(clean.supervisor, { deadline_ms: 20000, deadline_hit: false, leaked: [], cleanup: null });
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('R4: exit 0 is not a completed process: output limit, SIGTERM answered with exit 0, every observation', async () => {
  const limits = { stdoutBytes: 64, stderrKeptBytes: 1024, stderrExcerptBytes: 1024, termGraceMs: 2000, closeWaitMs: 2000 };
  const sup = createSupervisor();
  // Writes more than the quota, then answers the SIGTERM it gets with exit 0.
  const over = await supervised(sup, node("process.on('SIGTERM', () => process.exit(0)); process.stdout.write('x'.repeat(100)); setInterval(() => {}, 1000)"), { deadlineMs: 20000, limits });
  assert.deepEqual([over.observed.exit_code, over.observed.signal, over.observed.output_limit], [0, null, true]);
  assert.match(processProblems(over).join('; '), /output limit/);
  // Never finishes, and answers the deadline's signals... it cannot: the tree is killed. And one that would exit 0 on SIGTERM at runProcess's own deadline.
  const late = await runProcess(node("process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000)"), Buffer.alloc(0), { timeoutMs: 300, limits });
  assert.deepEqual([late.observed.exit_code, late.observed.timed_out], [0, true]);
  assert.match(processProblems({ observed: late.observed, supervisor: { deadline_hit: false, leaked: [], cleanup: null } }).join('; '), /backstop deadline/);

  const clean = await supervised(sup, node('0'), { deadlineMs: 20000 });
  assert.deepEqual(processProblems(clean), []);
  const o = clean.observed;
  const s = clean.supervisor;
  const dirty = (obs, supv = {}) => processProblems({ observed: { ...o, ...obs }, supervisor: { ...s, ...supv } }).length;
  for (const obs of [{ spawn_error: 'ENOENT' }, { signal: 'SIGKILL' }, { exit_code: 1 }, { exit_code: null }, { timed_out: true }, { output_limit: true }, { cleanup_incomplete: true }, { group_alive_after_exit: true }]) {
    assert.equal(dirty(obs), 1, JSON.stringify(obs));
  }
  for (const supv of [{ deadline_hit: true }, { leaked: [1] }, { leaked: null }, { cleanup: { complete: false } }, { cleanup: {} }]) assert.equal(dirty({}, supv), 1, JSON.stringify(supv));
  assert.equal(dirty({}, { cleanup: { complete: true } }), 0);
  // The runner's exit code is judged against its report, everything else the same way.
  assert.deepEqual(processProblems({ observed: { ...o, exit_code: 3 }, supervisor: s }, { anyExitCode: true }), []);
  assert.equal(processProblems({ observed: { ...o, exit_code: 0, output_limit: true }, supervisor: s }, { anyExitCode: true }).length, 1);
});

// ── Manifest, consumer and lock ──────────────────────────────────

test('the manifest names exactly what the audit dossier published', () => {
  const dossier = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'conformance', 'AUDIT_DOSSIER.md'), 'utf8');
  const section = dossier.slice(dossier.indexOf('Publication of 09/11/2026'));
  const table = section.slice(0, section.indexOf('\n\n', section.indexOf('| Registry |')));
  const ids = Object.values(manifest.packages).map((p) => p.integrity ?? p.sha256 ?? p.h1);
  assert.equal(new Set(ids).size, 7);
  for (const p of Object.values(manifest.packages)) {
    const id = p.integrity ?? p.sha256 ?? p.h1;
    const row = table.split('\n').find((l) => l.includes(id));
    assert.ok(row, `${p.name} ${id} is not in the dossier`);
    assert.ok(row.includes(p.version), `${p.name}: version ${p.version} is not in its dossier row`);
  }
  // Frozen here as well: a new version or commit cannot change the expected values without changing this test.
  assert.deepEqual(Object.fromEntries(Object.entries(manifest.packages).map(([k, p]) => [k, `${p.name}@${p.version}`])), {
    'npm-sdk': '@dcp-ai/sdk@2.4.0', 'npm-wasm': '@dcp-ai/wasm@2.2.0', 'npm-cli': '@dcp-ai/cli@2.2.0', 'pypi-wheel': 'dcp-ai@2.11.0', 'pypi-sdist': 'dcp-ai@2.11.0',
    crates: 'dcp-ai@2.14.0', go: 'github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.14.0',
  });
  assert.deepEqual(manifest.packages['npm-wasm'].inner.version, '2.14.0'); // the crate inside, not the npm version
  assert.equal(Object.keys(manifest.lanes).length, 9);
  for (const l of Object.values(manifest.lanes)) {
    assert.ok(manifest.packages[l.package]);
    for (const c of l.catalogs) assert.ok(fs.existsSync(path.join(REPO_ROOT, manifest.catalogs[c].file)));
  }
  assert.deepEqual([...IMPLEMENTED].sort(), Object.keys(manifest.lanes).sort());
});

test('the committed consumer and lock are clean; every local or foreign origin is refused', () => {
  assert.deepEqual(scanNpm({ pkg, lock, manifest }), []);
  assert.deepEqual(scanNpm({ pkg, lock: null, manifest }), []);
  const withDep = (spec) => scanNpm({ pkg: { ...pkg, dependencies: { ...pkg.dependencies, '@dcp-ai/sdk': spec } }, lock: null, manifest });
  for (const spec of ['file:../../sdks/typescript', 'link:../sdk', 'workspace:*', 'git+https://github.com/dcp-ai-protocol/dcp-ai.git', 'https://example.invalid/sdk.tgz', '^2.4.0', '2.4.1', 'latest', 'npm:other@2.4.0']) {
    assert.ok(withDep(spec).length > 0, spec);
  }
  for (const extra of [{ overrides: {} }, { workspaces: ['x'] }, { resolutions: {} }, { scripts: { postinstall: 'x' } }, { dependencies: { ...pkg.dependencies, other: '1.0.0' } }]) {
    assert.ok(scanNpm({ pkg: { ...pkg, ...extra }, lock: null, manifest }).length > 0, JSON.stringify(extra));
  }
  const mutated = (fn) => { const l = structuredClone(lock); fn(l.packages); return scanNpm({ pkg, lock: l, manifest }); };
  const sdk = 'node_modules/@dcp-ai/sdk';
  const other = Object.keys(lock.packages).find((k) => k !== '' && !k.includes('@dcp-ai'));
  assert.ok(mutated((p) => { p[sdk].resolved = 'file:../../sdks/typescript'; }).length > 0);
  assert.ok(mutated((p) => { p[sdk].resolved = p[sdk].resolved.replace('registry.npmjs.org', 'registry.example.invalid'); }).length > 0);
  assert.ok(mutated((p) => { p[sdk].integrity = p['node_modules/@dcp-ai/wasm'].integrity; }).length > 0);
  assert.ok(mutated((p) => { p[sdk].version = '2.3.0'; }).length > 0);
  assert.ok(mutated((p) => { p[sdk] = { resolved: '../x', link: true }; }).length > 0);
  assert.ok(mutated((p) => { p['node_modules/@dcp-ai/cli/node_modules/@dcp-ai/sdk'] = { ...p[sdk] }; }).length > 0); // a second SDK
  assert.ok(mutated((p) => { delete p[sdk]; }).length > 0);
  assert.ok(mutated((p) => { p[other].resolved = 'git+ssh://git@example.invalid/x.git'; }).length > 0);
  assert.ok(mutated((p) => { delete p[other].integrity; }).length > 0);
  assert.ok(mutated((p) => { p['../outside'] = { ...p[other] }; }).length > 0);
  assert.ok(scanNpm({ pkg, lock: { ...lock, lockfileVersion: 1 }, manifest }).length > 0);
});

test('identity needs expected, observed and installer to agree; trees are compared file by file', () => {
  assert.deepEqual(assessIdentity({ expected: 'a', observed: 'a', installer: 'a' }), []);
  assert.equal(assessIdentity({ expected: 'a', observed: 'b', installer: 'a' }).length, 1);
  assert.equal(assessIdentity({ expected: 'a', observed: 'a', installer: null }).length, 1);
  assert.equal(assessIdentity({ expected: 'x', observed: 'a', installer: 'a' }).length, 2);

  const dir = tmp();
  try {
    for (const side of ['a', 'b']) {
      fs.mkdirSync(path.join(dir, side, 'dist'), { recursive: true });
      fs.writeFileSync(path.join(dir, side, 'package.json'), '{}');
      fs.writeFileSync(path.join(dir, side, 'dist', 'index.js'), 'export {}');
    }
    fs.mkdirSync(path.join(dir, 'b', 'node_modules'));
    fs.writeFileSync(path.join(dir, 'b', 'node_modules', 'nested.js'), '');
    const a = () => treeOf(path.join(dir, 'a'));
    const b = () => treeOf(path.join(dir, 'b'), ['node_modules']);
    assert.deepEqual([...a().keys()], ['dist/index.js', 'package.json']);
    assert.deepEqual(compareTrees(a(), b()), []);
    fs.writeFileSync(path.join(dir, 'b', 'dist', 'index.js'), 'export {};');
    assert.match(compareTrees(a(), b())[0], /dist\/index\.js: the installed file differs/);
    fs.writeFileSync(path.join(dir, 'b', 'dist', 'index.js'), 'export {}');
    fs.writeFileSync(path.join(dir, 'b', 'extra.js'), '');
    assert.match(compareTrees(a(), b())[0], /extra\.js: installed, not published/);
    fs.rmSync(path.join(dir, 'b', 'extra.js'));
    fs.rmSync(path.join(dir, 'b', 'package.json'));
    assert.match(compareTrees(a(), b())[0], /package\.json: published, not installed/);
    fs.symlinkSync(path.join(dir, 'a', 'package.json'), path.join(dir, 'b', 'package.json'));
    assert.ok(compareTrees(a(), b()).some((m) => /symbolic link in the installed tree/.test(m)));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('what a wrapper declares is compared with what was checked, per lane', () => {
  const run = '/work/run';
  const npm = {
    packages: { 'npm-sdk': { version: '2.4.0' }, 'npm-wasm': { version: '2.2.0', inner: { version: '2.14.0' } } },
    paths: { sdk_entry: `${run}/n/sdk/dist/index.js`, wasm_file: `${run}/n/wasm/pkg/dcp_ai_bg.wasm`, wasm_file_sha256: 'a'.repeat(64) },
  };
  const sdk = { name: 'x', version: '2.4.0', resolved_from: npm.paths.sdk_entry };
  assert.deepEqual(checkDeclared('npm-sdk', sdk, npm, run), []);
  assert.equal(checkDeclared('npm-sdk', { ...sdk, version: '2.3.0' }, npm, run).length, 1);
  assert.equal(checkDeclared('npm-sdk', { ...sdk, resolved_from: '/checkout/sdks/typescript/dist/index.js' }, npm, run).length, 1);
  assert.equal(checkDeclared('npm-sdk', null, npm, run).length, 1);
  // The WASM wrapper declares the crate version inside the package: 2.14.0 is right, the npm version 2.2.0 is not.
  const wasm = { name: 'x', version: '2.14.0', resolved_from: `${npm.paths.wasm_file} (sha256 ${'a'.repeat(64)})` };
  assert.deepEqual(checkDeclared('npm-wasm-node', wasm, npm, run), []);
  assert.equal(checkDeclared('npm-wasm-node', { ...wasm, version: '2.2.0' }, npm, run).length, 1);
  assert.equal(checkDeclared('npm-wasm-node', { ...wasm, resolved_from: `${npm.paths.wasm_file} (sha256 ${'b'.repeat(64)})` }, npm, run).length, 1);
  assert.equal(checkDeclared('npm-wasm-node', { ...wasm, resolved_from: `/checkout/pkg/dcp_ai_bg.wasm (sha256 ${'a'.repeat(64)})` }, npm, run).length, 1);
});

// ── assessCell ───────────────────────────────────────────────────

const plan = { catalog_sha256: 'c'.repeat(64), fixtures: { 'f.json': 'f'.repeat(64) }, suites: [{ id: 's1', cases: ['a', 'b'] }, { id: 's2', cases: ['c'] }] };
const expected = { argv: ['impl', '--x'], plan, timeout_ms: 30000 };
const T = Date.parse('2026-11-10T10:00:00.000Z');
const goodReport = () => ({
  kit: { name: 'dcp-ai-conformance-external', catalog_sha256: plan.catalog_sha256, fixtures_sha256: { 'f.json': 'f'.repeat(64) } },
  run: { id: 'run-1', started_at: new Date(T + 100).toISOString(), finished_at: new Date(T + 900).toISOString(), timeout_ms: 30000 },
  implementation: { argv: ['impl', '--x'], self_declared: { name: 'n', version: 'v' }, observed: { exit_code: 0, signal: null, timed_out: false } },
  selection: ['s1', 's2'],
  status: 'pass',
  totals: { cases: 3, executed: 3, pass: 3, fail: 0, error: 0 },
  suites: [
    { id: 's1', status: 'pass', totals: { cases: 2, executed: 2, pass: 2, fail: 0, error: 0 }, cases: [{ id: 'a', status: 'pass' }, { id: 'b', status: 'pass' }] },
    { id: 's2', status: 'pass', totals: { cases: 1, executed: 1, pass: 1, fail: 0, error: 0 }, cases: [{ id: 'c', status: 'pass' }] },
  ],
});
// Recomputes suite and report totals and statuses from the cases, as the kit does (`informative` ids apart).
const retotal = (r, informative = []) => {
  r.totals = { cases: 0, executed: 0, pass: 0, fail: 0, error: 0 };
  let infoErr = 0;
  for (const s of r.suites) {
    s.totals = { cases: 0, executed: 0, pass: 0, fail: 0, error: 0 };
    let e = 0;
    for (const c of s.cases) {
      if (informative.includes(c.id)) { if (c.status !== 'informative') e++; continue; }
      s.totals.cases++; s.totals[c.status]++; if (c.status !== 'error') s.totals.executed++;
    }
    s.status = s.totals.error || e ? 'error' : s.totals.fail ? 'fail' : 'pass';
    for (const k of Object.keys(r.totals)) r.totals[k] += s.totals[k];
    infoErr += e;
  }
  r.status = r.totals.error || infoErr || r.totals.executed === 0 ? 'error' : r.totals.fail ? 'fail' : 'pass';
};
const goodObserved = () => ({
  existed_before: false, started: T, finished: T + 1000, seen_run_ids: new Set(),
  process: { exit_code: 0, signal: null, timed_out: false, output_limit: false, cleanup_incomplete: false, spawn_error: null },
  supervisor: { deadline_ms: 45000, deadline_hit: false, leaked: [], cleanup: null },
});
const cell = (mutateReport = () => {}, mutateObserved = () => {}, exp = expected) => {
  const report = goodReport();
  const text = mutateReport(report);
  const observed = goodObserved();
  mutateObserved(observed);
  return assessCell({ expected: exp, observed: { ...observed, report_text: observed.report_text === null ? null : typeof text === 'string' ? text : JSON.stringify(report) } });
};
const failing = (r) => { r.suites[0].cases[0] = { id: 'a', status: 'fail', kind: 'discrepancy' }; retotal(r); };
const erroring = (kind) => (r) => { for (const s of r.suites) for (const c of s.cases) Object.assign(c, { status: 'error', kind }); retotal(r); r.implementation.observed = { exit_code: 1, signal: null, timed_out: kind === 'timeout' }; };
const exit = (code) => (o) => { o.process.exit_code = code; };

test('assessCell: pass, fail and the classes of error', () => {
  assert.deepEqual(cell(), { status: 'pass', run_id: 'run-1', report_status: 'pass', totals: { cases: 3, executed: 3, pass: 3, fail: 0, error: 0 }, wrapper: { exit_code: 0, signal: null, timed_out: false } });
  const f = cell(failing, exit(1));
  assert.equal(f.status, 'fail');
  assert.deepEqual(f.failed, ['a']);
  for (const [kind, cls] of [['timeout', 'infra'], ['spawn', 'infra'], ['unsupported', 'unsupported'], ['implementation', 'implementation'], ['process', 'implementation'], ['invalid_output', 'implementation']]) {
    const e = cell(erroring(kind), exit(3));
    assert.deepEqual([e.status, e.class, e.error_kinds], ['error', cls, [kind]], kind);
  }
  // One unsupported case among errors of another kind is not "unsupported".
  assert.equal(cell((r) => { erroring('unsupported')(r); r.suites[1].cases[0].kind = 'implementation'; }, exit(3)).class, 'implementation');
  // Some cases pass and one errors: still an error, with the counts of the cases.
  const mixed = cell((r) => { Object.assign(r.suites[1].cases[0], { status: 'error', kind: 'implementation' }); retotal(r); }, exit(3));
  assert.deepEqual([mixed.class, mixed.totals], ['implementation', { cases: 3, executed: 2, pass: 2, fail: 0, error: 1 }]);
  // A report of the runner's own failure (usage, catalog, exception).
  const own = cell((r) => { for (const k of Object.keys(r)) if (k !== 'run' && k !== 'kit') delete r[k]; r.status = 'error'; r.error = { kind: 'catalog', message: 'm' }; }, exit(3));
  assert.deepEqual([own.status, own.class], ['error', 'infra']);
  // Informative cases exist only where the plan says so (delegation). There they are counted apart, as the kit
  // does: completed, they do not prevent a pass; in error, the run is an error.
  const withInfo = { ...expected, plan: { ...plan, informative: ['c'] } };
  const info = cell((r) => { r.suites[1].cases[0].status = 'informative'; retotal(r, ['c']); }, undefined, withInfo);
  assert.deepEqual([info.status, info.totals], ['pass', { cases: 2, executed: 2, pass: 2, fail: 0, error: 0 }]);
  assert.equal(cell((r) => { Object.assign(r.suites[1].cases[0], { status: 'error', kind: 'implementation' }); retotal(r, ['c']); }, exit(3), withInfo).class, 'implementation');
  // An informative case reported as a normative pass is not what the plan asked.
  assert.equal(cell(undefined, undefined, withInfo).class, 'incomplete');
});

test('assessCell: a report that is not this execution\'s is never a verdict', () => {
  const incomplete = (mr, mo) => {
    const v = cell(mr, mo);
    assert.deepEqual([v.status, v.class], ['error', 'incomplete'], JSON.stringify(v));
    return v;
  };
  incomplete(undefined, (o) => { o.existed_before = true; });
  incomplete(undefined, (o) => { o.report_text = null; });
  incomplete(() => 'not json');
  incomplete(() => '[]');
  incomplete((r) => { for (const k of Object.keys(r)) if (k !== 'run' && k !== 'kit') delete r[k]; r.status = 'incomplete'; delete r.run.finished_at; }, exit(3)); // the placeholder
  incomplete(undefined, (o) => { o.seen_run_ids.add('run-1'); });
  incomplete((r) => { delete r.run.id; });
  // An older report with an id never seen: before the interval, after it, or with no times at all.
  incomplete((r) => { r.run.id = 'never-seen'; r.run.started_at = new Date(T - 5000).toISOString(); r.run.finished_at = new Date(T - 4000).toISOString(); });
  incomplete((r) => { r.run.started_at = new Date(T - 1).toISOString(); });
  incomplete((r) => { r.run.finished_at = new Date(T + 1001).toISOString(); });
  incomplete((r) => { r.run.finished_at = new Date(T + 50).toISOString(); });
  incomplete((r) => { delete r.run.started_at; });
  // Another argv, deadline, catalog, fixture, selection.
  incomplete((r) => { r.implementation.argv = ['impl', '--y']; });
  incomplete((r) => { r.run.timeout_ms = 1; });
  incomplete((r) => { r.kit.catalog_sha256 = 'd'.repeat(64); });
  incomplete((r) => { delete r.kit.catalog_sha256; r.plan = { catalog: { sha256: plan.catalog_sha256 } }; }); // not the real field
  incomplete((r) => { r.kit.fixtures_sha256['f.json'] = 'e'.repeat(64); });
  incomplete((r) => { r.kit.fixtures_sha256['g.json'] = 'e'.repeat(64); });
  incomplete((r) => { r.selection = ['s1']; });
  incomplete((r) => { r.suites.reverse(); });
  incomplete((r) => { r.suites.pop(); r.selection.pop(); });
  // Case results missing, duplicated, not asked: the counts alone would still say 3.
  assert.match(incomplete((r) => { r.suites[0].cases.pop(); }).reasons[0], /case b: no result/);
  assert.match(incomplete((r) => { r.suites[0].cases[1] = { id: 'a', status: 'pass' }; }).reasons.join(' '), /case a: 2 results/);
  incomplete((r) => { r.suites[0].cases.push({ id: 'z', status: 'pass' }); });
  incomplete((r) => { [r.suites[0].cases[1].id, r.suites[1].cases[0].id] = ['c', 'b']; }); // right ids, wrong suites
  // Exit code and report disagree, in each direction; a signal.
  incomplete(undefined, exit(1));
  incomplete(undefined, exit(3));
  incomplete(failing, exit(0));
  incomplete(erroring('process'), exit(1));
  incomplete(undefined, (o) => { o.process.exit_code = null; o.process.signal = 'SIGKILL'; });
  // A status that its own cases or wrapper observation contradict.
  // R2: a normative case never becomes informative, whatever the counts say; no status outside pass, fail, error.
  incomplete((r) => { r.suites[1].cases[0].status = 'informative'; r.totals.executed = 0; });
  incomplete((r) => { r.suites[1].cases[0].status = 'informative'; r.suites[1].totals = { cases: 0, executed: 0, pass: 0, fail: 0, error: 0 }; r.totals = { cases: 2, executed: 2, pass: 2, fail: 0, error: 0 }; });
  for (const status of ['skipped', 'ok', 'PASS', undefined, null, 1]) incomplete((r) => { r.suites[0].cases[0].status = status; });
  // executed, per suite and overall, and the suite's own totals and status.
  incomplete((r) => { r.totals.executed = 0; });
  incomplete((r) => { r.totals.executed = 2; });
  incomplete((r) => { r.totals.cases = 4; });
  incomplete((r) => { delete r.totals; });
  incomplete((r) => { r.suites[0].totals.executed = 0; });
  incomplete((r) => { r.suites[0].totals.pass = 1; });
  incomplete((r) => { delete r.suites[1].totals; });
  incomplete((r) => { r.suites[0].status = 'fail'; });
  incomplete((r) => { delete r.suites[0].status; });
  incomplete((r) => { failing(r); r.suites[0].status = 'pass'; }, exit(1));
  incomplete((r) => { r.suites[0].cases[0].status = 'fail'; });
  incomplete((r) => { r.suites[0].cases[0].status = 'error'; });
  incomplete((r) => { r.totals.pass = 2; });
  incomplete((r) => { r.implementation.observed.exit_code = 1; });
  incomplete((r) => { r.implementation.observed.timed_out = true; });
  incomplete((r) => { r.status = 'fail'; }, exit(1)); // fail without a failed case
  incomplete((r) => { r.status = 'ok'; }, exit(3));
});

test('assessCell: supervisor observations are infrastructure errors, whatever the report says', () => {
  const infra = (mo) => assert.deepEqual([cell(undefined, mo).status, cell(undefined, mo).class], ['error', 'infra']);
  infra((o) => { o.supervisor.deadline_hit = true; });
  infra((o) => { o.supervisor.leaked = [123]; });
  infra((o) => { o.supervisor.leaked = null; });
  infra((o) => { o.supervisor.cleanup = { complete: false }; });
  infra((o) => { o.process.spawn_error = 'ENOENT'; });
  infra((o) => { o.process.timed_out = true; });
  infra((o) => { o.process.output_limit = true; });
  infra((o) => { o.process.cleanup_incomplete = true; });
  infra((o) => { o.process.group_alive_after_exit = true; });
  infra((o) => { o.supervisor.cleanup = {}; });
});

test('expectedPlan gives the catalog hash, fixtures, suites and case ids of every catalog of the manifest', () => {
  const ids = new Set();
  for (const [id, c] of Object.entries(manifest.catalogs)) {
    const p = expectedPlan(path.join(REPO_ROOT, c.file));
    assert.match(p.catalog_sha256, /^[0-9a-f]{64}$/);
    assert.ok(p.suites.length > 0 && p.suites.every((s) => s.cases.length > 0), id);
    assert.ok(Object.keys(p.fixtures).length > 0, id);
    assert.equal(p.timeout_ms, id === 'default' ? 30000 : 300000);
    ids.add(p.catalog_sha256);
  }
  assert.equal(ids.size, 8);
  // The current delegation catalog has no informative case; the archived 1.0.0 has ten.
  for (const c of Object.values(manifest.catalogs)) assert.deepEqual(expectedPlan(path.join(REPO_ROOT, c.file)).informative, []);
  assert.equal(expectedPlan(path.join(REPO_ROOT, 'tools', 'conformance', 'external-delegation-catalog-1.0.0.json')).informative.length, 10);
  assert.equal(expectedPlan(path.join(REPO_ROOT, manifest.catalogs.default.file)).suites.flatMap((s) => s.cases).length, 38);
});

// ── assessCampaign ───────────────────────────────────────────────

test('assessCampaign: PARTIAL for a clean selection; PASS only with every lane, cell, block and control', () => {
  const all = Object.keys(manifest.lanes);
  const everyCatalog = Object.keys(manifest.catalogs);
  const cellsOf = (lanes, catalogs) => lanes.flatMap((lane) => manifest.lanes[lane].catalogs.filter((c) => catalogs.includes(c)).map((catalog) => ({ lane, catalog, status: 'pass' })));
  const blocksOf = (lanes) => lanes.flatMap((lane) => (manifest.lanes[lane].blocks ?? []).map((block) => ({ lane, block, status: 'pass' })));
  const lanesOf = (lanes) => Object.fromEntries(lanes.map((l) => [l, { status: 'pass' }]));
  const okFor = (lanes) => requiredControls(lanes).map((id) => ({ id, ok: true }));
  const allOk = okFor([CONTROL_LANE]);
  const run = (o) => assessCampaign({ manifest, implemented: IMPLEMENTED, controls: okFor(o.selection.lanes), ...o });
  const two = ['npm-sdk', 'npm-wasm-node'];
  const sel = { lanes: two, catalogs: ['default'] };

  let v = run({ selection: sel, lanes: lanesOf(two), cells: cellsOf(two, ['default']) });
  assert.deepEqual([v.status, v.exit_code], ['PARTIAL', EXIT.PARTIAL]);
  assert.equal(EXIT.PARTIAL, 4);
  assert.ok(v.not_executed.includes('cell npm-sdk × evidence') && v.not_executed.includes('lane go') && v.not_executed.includes('controls of lane npm-cli'));
  // Two lanes with every catalog and their controls: still PARTIAL, seven lanes are missing.
  v = run({ selection: { lanes: two, catalogs: everyCatalog }, lanes: lanesOf(two), cells: cellsOf(two, everyCatalog) });
  assert.equal(v.status, 'PARTIAL');
  // A lane a revision cannot run is an error when selected, and prevents PASS when not.
  const some = new Set(two);
  v = assessCampaign({ manifest, implemented: some, selection: { lanes: all, catalogs: everyCatalog }, lanes: { ...lanesOf(two), ...Object.fromEntries(all.filter((l) => !some.has(l)).map((l) => [l, { status: 'error', class: 'unsupported', reasons: ['x'] }])) }, cells: cellsOf(two, everyCatalog), blocks: [], controls: okFor(all) });
  assert.deepEqual([v.status, v.exit_code], ['ERROR', 3]);

  // The full campaign: 60 cells, 3 blocks, the controls of the three lanes that bring them.
  const full = (over = {}) => assessCampaign({ manifest, implemented: new Set(all), selection: { lanes: all, catalogs: everyCatalog }, lanes: lanesOf(all), cells: cellsOf(all, everyCatalog), blocks: blocksOf(all), controls: okFor(all), ...over });
  assert.equal(cellsOf(all, everyCatalog).length, 60);
  assert.deepEqual(blocksOf(all).map((b) => `${b.lane}:${b.block}`), ['npm-wasm-browser:direct-sections', 'npm-cli:cli-suites', 'npm-cli:cli-negative-control']);
  assert.deepEqual(Object.keys(CONTROL_SETS), ['npm-sdk', 'npm-cli', 'npm-wasm-browser']);
  v = full();
  assert.deepEqual([v.status, v.exit_code, v.not_executed], ['PASS', 0, []]);
  assert.equal(full({ controls: [...okFor(all)].reverse() }).status, 'PASS'); // the order does not matter
  const notPass = (over, why) => { const r = full(over); assert.deepEqual([r.status, r.exit_code], ['ERROR', 3], why); return r.reasons.join('\n'); };

  // R1: controls absent, partial, invented, duplicated or not strictly true are never PASS.
  const required = okFor(all);
  assert.equal(notPass({ controls: [] }, 'none').split('\n').length, required.length);
  notPass({ controls: [{ id: 'positive', ok: true }] }, 'only one');
  notPass({ controls: [{ id: 'invented', ok: true }] }, 'invented alone');
  notPass({ controls: allOk }, 'the controls of one lane only');
  for (const { id } of required) assert.match(notPass({ controls: required.filter((c) => c.id !== id) }, id), new RegExp(`control ${id}: missing`));
  assert.match(notPass({ controls: [...required, required[3]] }, 'duplicate'), /reported 2 times/);
  assert.match(notPass({ controls: [...required, { id: 'invented', ok: true }] }, 'unknown'), /"invented": not a required control/);
  for (const ok of [false, 'true', 1, null, undefined, {}, []]) assert.match(notPass({ controls: required.map((c, i) => (i === 5 ? { id: c.id, ok } : c)) }, String(ok)), /did not give its required result/);
  for (const entry of [null, 'positive', {}, { ok: true }]) notPass({ controls: [...required, entry] }, JSON.stringify(entry));
  for (const controls of [undefined, null, {}, 'all']) notPass({ controls }, String(controls));
  assert.equal(new Set(required.map((c) => c.id)).size, required.length);

  // P3: the blocks are owed explicitly. 60 cells and every lane "pass" are not enough.
  const blocks = blocksOf(all);
  assert.equal(notPass({ blocks: [] }, 'no blocks').split('\n').length, 3);
  assert.match(notPass({ blocks: undefined }, 'blocks left out'), /direct-sections: missing/);
  for (const b of blocks) assert.match(notPass({ blocks: blocks.filter((x) => x !== b) }, b.block), new RegExp(`${b.block}: missing`));
  assert.match(notPass({ blocks: [...blocks, blocks[0]] }, 'duplicate block'), /reported 2 times/);
  notPass({ blocks: [...blocks, { lane: 'npm-cli', block: 'invented', status: 'pass' }] }, 'unknown block');
  notPass({ blocks: [...blocks, { lane: 'npm-sdk', block: 'cli-suites', status: 'pass' }] }, 'a block of another lane');
  for (const status of ['error', 'ok', undefined, true]) notPass({ blocks: blocks.map((b, i) => (i === 1 ? { ...b, status, class: 'incomplete' } : b)) }, String(status));
  for (const entry of [null, 'cli-suites', {}]) notPass({ blocks: [...blocks, entry] }, JSON.stringify(entry));
  notPass({ blocks: 'all' }, 'not a list');
  v = full({ blocks: blocks.map((b, i) => (i === 0 ? { ...b, status: 'fail' } : b)) });
  assert.deepEqual([v.status, v.exit_code], ['FAIL', 1]); // a discrepancy in the direct sections
  // npm-cli alone: its installation and a "pass" lane credit nothing without its two blocks.
  const cli = { selection: { lanes: ['npm-cli'], catalogs: everyCatalog }, lanes: lanesOf(['npm-cli']), cells: [] };
  assert.equal(run({ ...cli, blocks: blocksOf(['npm-cli']) }).status, 'PARTIAL');
  assert.equal(run({ ...cli, blocks: [] }).status, 'ERROR');
  assert.equal(run({ ...cli }).status, 'ERROR');

  // A selection without npm-sdk owes no npm-sdk controls and says so; a control given anyway is refused.
  const wasmOnly = { selection: { lanes: ['npm-wasm-node'], catalogs: ['default'] }, lanes: lanesOf(['npm-wasm-node']), cells: cellsOf(['npm-wasm-node'], ['default']) };
  v = run({ ...wasmOnly });
  assert.equal(v.status, 'PARTIAL');
  assert.ok(v.not_executed.includes(`controls of lane ${CONTROL_LANE}`));
  assert.equal(run({ ...wasmOnly, controls: allOk }).status, 'ERROR');
  assert.equal(run({ selection: sel, lanes: lanesOf(two), cells: cellsOf(two, ['default']), controls: [] }).status, 'ERROR');

  const base = { selection: sel, lanes: lanesOf(two) };
  const cells = cellsOf(two, ['default']);
  assert.equal(run({ ...base, cells: cells.slice(1) }).status, 'ERROR'); // a cell missing
  assert.equal(run({ ...base, cells: [...cells, cells[0]] }).status, 'ERROR'); // a cell twice
  assert.equal(run({ ...base, cells: [...cells, { lane: 'npm-sdk', catalog: 'evidence', status: 'pass' }] }).status, 'ERROR'); // a cell nobody asked
  assert.deepEqual([run({ ...base, cells: [{ ...cells[0], status: 'fail' }, cells[1]] }).status, run({ ...base, cells: [{ ...cells[0], status: 'fail' }, cells[1]] }).exit_code], ['FAIL', 1]);
  // An error outranks a discrepancy: a missing answer is never reported as a rejection.
  assert.equal(run({ ...base, cells: [{ ...cells[0], status: 'fail' }, { ...cells[1], status: 'error', class: 'infra' }] }).exit_code, 3);
  assert.equal(run({ ...base, cells, controls: allOk.map((c, i) => (i === 0 ? { ...c, ok: false } : c)) }).status, 'ERROR');
  assert.equal(run({ ...base, cells, interrupted: true }).status, 'ERROR');
  assert.equal(run({ ...base, lanes: { 'npm-sdk': { status: 'error', class: 'identity', reasons: ['x'] }, 'npm-wasm-node': { status: 'pass' } }, cells: cells.slice(1) }).status, 'ERROR');
  assert.equal(run({ ...base, lanes: { 'npm-sdk': { status: 'pass' } }, cells }).status, 'ERROR'); // a selected lane never ran
});

// ── Work directory, environment, arguments ───────────────────────

test('the work directory is always new, outside the checkout, and only its own consumers are removed', () => {
  const base = tmp();
  try {
    const made = createWorkDir(path.join(base, 'run'));
    assert.equal(made, path.join(base, 'run'));
    assert.throws(() => createWorkDir(made), UsageError); // exists, even empty
    fs.symlinkSync(base, path.join(base, 'link'));
    assert.throws(() => createWorkDir(path.join(base, 'link')), UsageError); // a symbolic link is an existing path
    assert.throws(() => createWorkDir(path.join(base, 'absent', 'run')), UsageError);
    assert.throws(() => createWorkDir(path.join(REPO_ROOT, 'tools', 'rv-work-test')), /outside the checkout/);
    assert.equal(fs.existsSync(path.join(REPO_ROOT, 'tools', 'rv-work-test')), false);
    const auto = createWorkDir(undefined);
    assert.ok(fs.statSync(auto).isDirectory() && !auto.startsWith(fs.realpathSync(REPO_ROOT)));
    fs.rmdirSync(auto);

    // Evidence stays; consumers go; a link in the place of a consumer directory stops the cleanup untouched.
    const outside = path.join(base, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'keep'), '');
    for (const d of ['consumers/npm/node_modules', 'home', 'runner', 'logs', 'tarballs']) fs.mkdirSync(path.join(made, d), { recursive: true });
    fs.symlinkSync(outside, path.join(made, 'consumers', 'npm', 'node_modules', 'link'));
    fs.writeFileSync(path.join(made, 'report.json'), '{}');
    assert.deepEqual(cleanConsumers(made), ['consumers', 'home']);
    assert.deepEqual(fs.readdirSync(made).sort(), ['logs', 'report.json', 'runner', 'tarballs']);
    assert.ok(fs.existsSync(path.join(outside, 'keep'))); // the link was removed, not followed
    fs.symlinkSync(outside, path.join(made, 'tmp'));
    assert.throws(() => cleanConsumers(made), /not a directory/);
    assert.throws(() => cleanConsumers(path.join(base, 'link', 'run')), /not the directory/);
    assert.ok(fs.existsSync(path.join(outside, 'keep')));
  } finally {
    fs.rmSync(base, { recursive: true });
  }
});

test('the environment of a subprocess is built from nothing', () => {
  const env = isolatedEnv('/work/run');
  assert.deepEqual(Object.keys(env).sort(), ['HOME', 'LANG', 'LC_ALL', 'PATH', 'TMPDIR']);
  assert.equal(env.HOME, '/work/run/home');
  assert.equal(env.PATH, `${path.dirname(process.execPath)}:/usr/bin:/bin`);
});

test('arguments: unknown or repeated values are usage errors; the CLI exits 2 and creates nothing', async () => {
  assert.deepEqual(parseArgs([], manifest).lanes, Object.keys(manifest.lanes));
  assert.deepEqual(parseArgs(['--lane', 'npm-sdk', '--catalog', 'default', '--resolution', 'fresh'], manifest), { list: false, lanes: ['npm-sdk'], catalogs: ['default'], resolution: 'fresh', work: undefined, clean: false, tools: {} });
  assert.deepEqual(parseArgs(['--python', '/a/python3', '--go', '/b/go', '--cargo', '/c/cargo'], manifest).tools, { python: '/a/python3', go: '/b/go', cargo: '/c/cargo' });
  assert.deepEqual(parseArgs(['--chrome', '/d/chrome'], manifest).tools, { chrome: '/d/chrome' });
  for (const bad of [['--lane', 'nope'], ['--lane', 'npm-sdk', '--lane', 'npm-sdk'], ['--catalog', 'nope'], ['--lane'], ['--lane', '--list'], ['--resolution', 'any'], ['--keep'], ['--lane', 'constructor']]) {
    assert.throws(() => parseArgs(bad, manifest), UsageError, bad.join(' '));
  }
  const cli = (...args) => runProcess([process.execPath, path.join(HERE, 'run.mjs'), ...args], Buffer.alloc(0), { env: isolatedEnv(os.tmpdir()) });
  assert.equal((await cli('--lane', 'nope')).observed.exit_code, 2);
  const inRepo = path.join(REPO_ROOT, 'tools', 'rv-work-test');
  assert.equal((await cli('--work', inRepo)).observed.exit_code, 2);
  assert.equal(fs.existsSync(inRepo), false);
  const list = await cli('--list');
  assert.equal(list.observed.exit_code, 0);
  assert.equal(list.stdout.toString().split('\n').filter((l) => l.includes('not implemented')).length, 0);
});

// ── P2: Python, Go and Rust guards ───────────────────────────────

const consumerText = (...rel) => fs.readFileSync(path.join(HERE, 'consumers', ...rel), 'utf8');

test('Python locks: one per platform, chosen by the interpreter; only pinned, hashed names; the DCP lines carry the manifest hashes', () => {
  const keys = pythonLockKeys();
  assert.ok(keys.includes('cpython-3.12-darwin-arm64') && keys.includes('cpython-3.12-linux-x86_64'), keys.join(', '));
  for (const key of keys) {
    // The directory name is exactly what its platform.json describes, and each lock is clean on its own.
    const platform = JSON.parse(consumerText('python', key, 'platform.json'));
    assert.deepEqual(Object.keys(platform), ['implementation', 'python', 'sys_platform', 'machine']);
    assert.equal(pythonLockKey(platform), key);
    assert.deepEqual(scanPython({ wheel: consumerText('python', key, 'wheel.txt'), sdist: consumerText('python', key, 'sdist.txt'), build: consumerText('python', key, 'build.txt'), manifest }), [], key);
    assert.deepEqual(fs.readdirSync(path.join(HERE, 'consumers', 'python', key)).sort(), ['build.txt', 'platform.json', 'sdist.txt', 'wheel.txt']);
  }
  assert.equal(pythonLockKey({ implementation: 'CPython', python: '3.13', sys_platform: 'linux', machine: 'aarch64' }), 'cpython-3.13-linux-aarch64');
  // The same sdist everywhere; the wheel of dcp-ai is pure Python, so its line is the same too.
  assert.equal(new Set(keys.map((k) => consumerText('python', k, 'sdist.txt'))).size, 1);
  const lock = { wheel: consumerText('python', keys[0], 'wheel.txt'), sdist: consumerText('python', keys[0], 'sdist.txt'), build: consumerText('python', keys[0], 'build.txt') };
  assert.deepEqual(scanPython({ ...lock, manifest }), []);
  const bad = (change, why) => assert.ok(scanPython({ ...lock, ...change, manifest }).length > 0, why);
  const h = 'a'.repeat(64);
  for (const line of ['-e ../../sdks/python', 'dcp-ai @ file:///x/dcp_ai-2.11.0-py3-none-any.whl', '../../sdks/python', 'https://example.invalid/x.whl', '--index-url https://example.invalid/simple',
    '--extra-index-url https://example.invalid/simple', '--find-links /tmp', '-r other.txt', '-c constraints.txt', 'requests', 'requests>=2', 'requests==2.0', `requests==2.0 --hash=md5:${h}`,
    `requests==2.0 --hash=sha256:${h} --index-url https://example.invalid/`, 'git+https://example.invalid/x.git', `requests==2.0 --hash=sha256:${h} ; python_version < "3"`]) {
    bad({ wheel: `${lock.wheel}${line}\n` }, line);
    bad({ build: `${lock.build}${line}\n` }, line);
  }
  const w = manifest.packages['pypi-wheel'];
  const sd = manifest.packages['pypi-sdist'];
  bad({ wheel: lock.wheel.replace(w.sha256, h) }, 'wheel hash');
  bad({ wheel: lock.wheel.replace(w.sha256, sd.sha256) }, 'the sdist hash in the wheel lock');
  bad({ wheel: lock.wheel.replace('dcp-ai==2.11.0', 'dcp-ai==2.10.0') }, 'wheel version');
  bad({ wheel: lock.wheel.replace(`--hash=sha256:${w.sha256}`, `--hash=sha256:${w.sha256} --hash=sha256:${h}`) }, 'a second hash for the wheel');
  bad({ wheel: lock.wheel.split('\n').filter((l) => !l.startsWith('dcp-ai==')).join('\n') }, 'no wheel line');
  bad({ wheel: `${lock.wheel}DCP_AI==2.11.0 --hash=sha256:${w.sha256}\n` }, 'the wheel twice under another spelling');
  bad({ sdist: lock.sdist.replace(sd.sha256, h) }, 'sdist hash');
  bad({ sdist: `${lock.sdist}hatchling==1.0 --hash=sha256:${h}\n` }, 'something else in sdist.txt');
  bad({ sdist: '' }, 'empty sdist.txt');
  bad({ build: '' }, 'no build dependencies');
  bad({ build: `${lock.build}dcp-ai==2.11.0 --hash=sha256:${w.sha256}\n` }, 'dcp-ai as a build dependency');
  assert.deepEqual(parseRequirements(`# c\n\nA_b.C==1.0 --hash=sha256:${h} --hash=sha256:${'b'.repeat(64)}\n`, 'f').entries, [{ name: 'a-b-c', version: '1.0', hashes: [h, 'b'.repeat(64)] }]);
});

test('Python disables real pip configuration files, including site config, rather than omitting PIP_CONFIG_FILE', async (t) => {
  let python;
  try { python = findTool('python3', process.env.DCP_RELEASE_VALIDATION_TEST_PYTHON, '--python'); }
  catch (e) { assert.ok(e instanceof Stop); t.skip('no Python on the isolated PATH'); return; }
  const base = tmp();
  try {
    for (const d of ['home', 'tmp']) fs.mkdirSync(path.join(base, d));
    const venv = path.join(base, 'venv');
    const made = await runProcess([python, '-I', '-B', '-m', 'venv', venv], Buffer.alloc(0), { env: isolatedEnv(base), timeoutMs: 30000 });
    assert.equal(made.observed.exit_code, 0, made.observed.stderr_excerpt);
    fs.writeFileSync(path.join(venv, 'pip.conf'), '[global]\nindex-url = https://must-not-be-used.invalid/simple\nbreak-system-packages = true\n');
    const command = [path.join(venv, 'bin', 'python'), '-I', '-B', '-m', 'pip', '--isolated', 'config', 'list'];
    const control = await runProcess(command, Buffer.alloc(0), { env: isolatedEnv(base) });
    assert.equal(control.observed.exit_code, 0, control.observed.stderr_excerpt);
    assert.match(control.stdout.toString(), /must-not-be-used\.invalid/);
    const env = pythonEnv(base);
    assert.equal(env.PIP_CONFIG_FILE, os.devNull);
    assert.equal(typeof env.PIP_CONFIG_FILE, 'string');
    const isolated = await runProcess(command, Buffer.alloc(0), { env });
    assert.equal(isolated.observed.exit_code, 0, isolated.observed.stderr_excerpt);
    assert.equal(isolated.stdout.toString().trim(), '');
  } finally { fs.rmSync(base, { recursive: true }); }
});

test('Python trees: only what pip adds or rewrites is left out of the comparison', () => {
  const wheel = new Map([['dcp_ai/__init__.py', 'a'], ['dcp_ai-2.11.0.dist-info/METADATA', 'm'], ['dcp_ai-2.11.0.dist-info/RECORD', 'r1'], ['dcp_ai-2.11.0.dist-info/WHEEL', 'w']]);
  const installed = new Map([...wheel, ['dcp_ai-2.11.0.dist-info/RECORD', 'r2'], ['dcp_ai-2.11.0.dist-info/INSTALLER', 'i'], ['dcp_ai-2.11.0.dist-info/REQUESTED', 'q']]);
  const diff = (inst, directUrl = false) => compareTrees(pythonTreeView(wheel), pythonTreeView(inst, { installed: true, directUrl }));
  assert.deepEqual(diff(installed), []);
  const withDirect = new Map([...installed, ['dcp_ai-2.11.0.dist-info/direct_url.json', 'd']]);
  assert.equal(diff(withDirect).length, 1); // an index install must not have it
  assert.deepEqual(diff(withDirect, true), []); // the sdist lane installs the wheel it built
  assert.equal(diff(new Map([...installed, ['dcp_ai/__init__.py', 'changed']])).length, 1);
  assert.equal(diff(new Map([...installed, ['dcp_ai/extra.py', 'x']])).length, 1);
  assert.equal(diff(new Map([...installed, ['dcp_ai/__pycache__/x.pyc', 'x']])).length, 1);
  assert.equal(diff(new Map([...installed, ['dcp_ai-2.11.0.dist-info/METADATA', 'other']])).length, 1);
  assert.equal(diff(new Map([...installed].filter(([k]) => !k.endsWith('WHEEL')))).length, 1);
  assert.equal(diff(new Map([...installed, ['dcp_ai/INSTALLER', 'x']])).length, 1); // only inside a dist-info directory
});

test('R7: the wheel built from the sdist has exactly the sdist\'s module files', () => {
  const sdist = new Map([['pyproject.toml', 'p'], ['README.md', 'r'], ['PKG-INFO', 'i'], ['dcp_ai/__init__.py', 'a'], ['dcp_ai/v2/verify.py', 'b'], ['dcp_ai/py.typed', 't'], ['tests/test_x.py', 'x']]);
  const wheel = new Map([['dcp_ai/__init__.py', 'a'], ['dcp_ai/v2/verify.py', 'b'], ['dcp_ai/py.typed', 't'], ['dcp_ai-2.11.0.dist-info/METADATA', 'm'], ['dcp_ai-2.11.0.dist-info/RECORD', 'r']]);
  assert.deepEqual(sdistModuleProblems(wheel, sdist), []);
  const without = (k) => new Map([...wheel].filter(([rel]) => rel !== k));
  assert.match(sdistModuleProblems(without('dcp_ai/v2/verify.py'), sdist)[0], /dcp_ai\/v2\/verify\.py: in the sdist, not in the built wheel/); // a module left out
  assert.match(sdistModuleProblems(new Map([...wheel, ['dcp_ai/extra.py', 'e']]), sdist)[0], /in the built wheel, not in the sdist/);
  assert.match(sdistModuleProblems(new Map([...wheel, ['dcp_ai/__init__.py', 'changed']]), sdist)[0], /not the sdist's file/);
  assert.equal(sdistModuleProblems(new Map([...wheel, ['other_pkg/__init__.py', 'o']]), sdist).length, 1); // a package the sdist does not have
  assert.deepEqual(sdistModuleProblems(new Map([['dcp_ai-2.11.0.dist-info/METADATA', 'm']]), sdist), ['the built wheel has no module file']);
});

test('R5: an sdist whose bytes are not the manifest\'s never reaches unpacking or a build backend', async (t) => {
  let python;
  try { python = findTool('python3', undefined, '--python'); } catch (e) { assert.ok(e instanceof Stop); t.skip('no python3 on the isolated PATH'); return; }
  const base = tmp();
  // An sdist of the right name whose backend would leave a marker if anything imported or ran it.
  const marker = path.join(base, 'BACKEND-RAN');
  const src = path.join(base, 'src', 'dcp_ai-2.11.0');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'pyproject.toml'), '[build-system]\nrequires = []\nbuild-backend = "evil"\nbackend-path = ["."]\n[project]\nname = "dcp-ai"\nversion = "2.11.0"\n');
  fs.writeFileSync(path.join(src, 'evil.py'), `open(${JSON.stringify(marker)}, "w").close()\n`);
  const tar = await runProcess(['/usr/bin/tar', '-czf', path.join(base, 'evil.tar.gz'), '-C', path.join(base, 'src'), 'dcp_ai-2.11.0'], Buffer.alloc(0));
  assert.equal(tar.observed.exit_code, 0);
  const bytes = fs.readFileSync(path.join(base, 'evil.tar.gz'));
  const requests = [];
  let listing = (port) => ({ files: [{ filename: 'dcp_ai-2.11.0.tar.gz', url: `http://127.0.0.1:${port}/files/dcp_ai-2.11.0.tar.gz`, hashes: { sha256: manifest.packages['pypi-sdist'].sha256 } }] });
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    if (req.url === '/simple/dcp-ai/') res.end(JSON.stringify(listing(server.address().port)));
    else if (req.url === '/files/dcp_ai-2.11.0.tar.gz') res.end(bytes);
    else { res.statusCode = 404; res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  // The manifest keeps the real expected hash; only the registry is this server, which even declares that hash.
  const local = structuredClone(manifest);
  Object.assign(local.packages['pypi-sdist'], { registry: `http://127.0.0.1:${port}/simple/`, files: `http://127.0.0.1:${port}/files/` });
  const attempt = async (name) => {
    const run = path.join(base, name);
    fs.mkdirSync(path.join(run, 'home'), { recursive: true });
    fs.mkdirSync(path.join(run, 'tmp'));
    return { run, r: await installPython({ kind: 'sdist', run, sup: createSupervisor(), manifest: local, resolution: 'fresh', remainingMs: () => 600000, tools: { python } }) };
  };
  try {
    const { run, r } = await attempt('run');
    assert.deepEqual([r.status, r.class], ['error', 'identity']);
    assert.deepEqual(r.phases.map((p) => `${p.name}:${p.status}`), ['origin-static:pass', 'download:pass', 'identity:error']);
    const id = r.packages['pypi-sdist'].identity;
    assert.equal(id.observed, crypto.createHash('sha256').update(bytes).digest('hex'));
    assert.equal(id.installer, id.expected); // the index's word was not taken for the bytes
    assert.notEqual(id.observed, id.expected);
    assert.equal(fs.existsSync(marker), false);
    assert.equal(fs.existsSync(path.join(run, 'extracted', 'pypi-sdist', 'sdist')), false); // not even unpacked
    assert.equal(fs.existsSync(path.join(run, 'consumers', 'pypi-sdist', 'build-venv')), false);
    assert.deepEqual(fs.readdirSync(path.join(run, 'logs')).sort(), ['pypi-sdist-fetch.log', 'pypi-sdist-interpreter.log']);
    assert.deepEqual(requests, ['/simple/dcp-ai/', '/files/dcp_ai-2.11.0.tar.gz']);

    // An index that points the file somewhere else: nothing is downloaded from there.
    listing = () => ({ files: [{ filename: 'dcp_ai-2.11.0.tar.gz', url: 'http://127.0.0.1:1/elsewhere.tar.gz', hashes: {} }] });
    const other = await attempt('run2');
    assert.deepEqual([other.r.status, other.r.phases.at(-1).name, other.r.phases.at(-1).status], ['error', 'download', 'error']);
    assert.equal(fs.existsSync(path.join(other.run, 'artifacts', 'pypi-sdist', 'dcp_ai-2.11.0.tar.gz')), false);
    listing = () => ({ files: [] });
    assert.equal((await attempt('run3')).r.phases.at(-1).name, 'download');
    assert.equal(fs.existsSync(marker), false);
  } finally {
    server.close();
    fs.rmSync(base, { recursive: true });
  }
});

test('R6: h1 sorts names by their UTF-8 bytes, as Go does, and refuses a newline', () => {
  const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
  // Expected values computed apart from this code (Python hashlib, names sorted by their UTF-8 encoding).
  assert.equal(goH1(new Map([['m@v1.0.0/sub/b.go', sha('package sub\n')], ['m@v1.0.0/go.mod', sha('module m\n')], ['m@v1.0.0/a.go', sha('package m\n')]])), 'h1:E5l2ARkngJOmNEDCK6c+/dAEepj99ci3SZuB8w/mT8o=');
  // U+E000 sorts before U+10000 in UTF-8 and after it in UTF-16.
  const unicode = new Map([['m@v1/\u{10000}.go', sha('y')], ['m@v1/.go', sha('x')]]);
  assert.ok('m@v1/\u{10000}.go' < 'm@v1/.go');
  assert.equal(goH1(unicode), 'h1:ZHO/geq/Wdk9t7p1V8KjdeCLNjmR2hs4sQ2Scuz8AwU=');
  assert.equal(goH1(new Map([...unicode].reverse())), goH1(unicode));
  assert.throws(() => goH1(new Map([['m@v1/a\nb.go', sha('x')]])), /newline/);
});

test('Go consumer: go.mod, go.sum and the binary\'s build information', () => {
  const g = manifest.packages.go;
  const mod = consumerText('go', 'go.mod');
  const sum = consumerText('go', 'go.sum');
  assert.deepEqual(scanGo({ mod, sum, manifest }), []);
  assert.deepEqual(scanGo({ mod, sum: null, manifest }), []);
  const bad = (m, s, why) => assert.ok(scanGo({ mod: m, sum: s, manifest }).length > 0, why);
  for (const extra of [`replace ${g.name} => ../../../sdks/go`, `replace ${g.name} v2.14.0 => example.invalid/fork v2.14.0`, `replace (\n\t${g.name} => ../x\n)`, `exclude ${g.name} v2.14.0`, 'toolchain go1.99.0', 'godebug x=1', 'retract v1.0.0']) {
    bad(`${mod}\n${extra}\n`, sum, extra);
  }
  bad(mod.replace(`${g.name} ${g.version}`, `${g.name} v2.13.0`), sum, 'another version');
  bad(`${mod}\nrequire ${g.name} v2.13.0\n`, sum, 'required twice');
  bad(mod.split('\n').filter((l) => !l.includes(`${g.name} `)).join('\n'), sum, 'not required');
  bad(mod, sum.replace(g.h1, 'h1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='), 'another h1');
  bad(mod, sum.split('\n').filter((l) => !l.startsWith(`${g.name} ${g.version} `)).join('\n'), 'no h1 line');
  bad(mod, `${sum}${g.name} v2.13.0 h1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n`, 'a second version in go.sum');
  bad(mod, `${sum}garbage\n`, 'malformed go.sum');

  const info = (dep) => `/x/go-wrapper: go1.26.10\n\tpath\tconsumer\n\tmod\tconsumer\t(devel)\t\n${dep}\tbuild\tGOARCH=amd64\n`;
  assert.deepEqual(checkGoBuildInfo(info(`\tdep\t${g.name}\t${g.version}\t${g.h1}\n`), manifest), []);
  assert.equal(checkGoBuildInfo(info(`\tdep\t${g.name}\t${g.version}\n\t=>\t../../sdks/go\t(devel)\t\n`), manifest).length, 2);
  assert.equal(checkGoBuildInfo(info(`\tdep\t${g.name}\tv2.13.0\t${g.h1}\n`), manifest).length, 1);
  assert.equal(checkGoBuildInfo(info(`\tdep\t${g.name}\t${g.version}\th1:other=\n`), manifest).length, 1);
  assert.equal(checkGoBuildInfo(info(''), manifest).length, 1);
});

test('Rust consumers: Cargo.toml, Cargo.lock and cargo metadata, per feature set', () => {
  const c = manifest.packages.crates;
  for (const [lane, features] of Object.entries(RUST_FEATURES)) {
    const dir = lane.replace('crates', 'rust');
    const toml = consumerText(dir, 'Cargo.toml');
    const lock = consumerText(dir, 'Cargo.lock');
    assert.deepEqual(scanCargo({ toml, lock, features, manifest }), [], lane);
    assert.deepEqual(scanCargo({ toml, lock: null, features, manifest }), [], lane);
    // The other lane's feature set is not this lane's consumer.
    assert.ok(scanCargo({ toml, lock, features: features.length ? [] : ['otlp'], manifest }).length > 0, lane);
    const bad = (t, l, why) => assert.ok(scanCargo({ toml: t, lock: l, features, manifest }).length > 0, `${lane}: ${why}`);
    const dep = toml.split('\n').find((l) => l.startsWith('dcp-ai '));
    for (const line of ['dcp-ai = { path = "../../../sdks/rust" }', 'dcp-ai = { git = "https://example.invalid/dcp-ai.git" }', 'dcp-ai = { version = "=2.14.0", registry = "other" }', 'dcp-ai = "2.14.0"', 'dcp-ai = "^2.14"', 'dcp-ai = "=2.13.0"',
      'dcp-ai = { version = "=2.14.0", features = ["otlp", "wasm"] }', 'renamed = { package = "dcp-ai", version = "=2.14.0" }']) {
      bad(toml.replace(dep, line), lock, line);
    }
    // R8: the same things in other valid TOML spellings, and anything else that is not the one expected manifest.
    for (const extra of ['["patch"."crates-io"]\nserde_json = { "path" = "/tmp/dcp-rv-static-not-used" }', "['patch'.crates-io]\nserde_json = { 'git' = 'https://example.invalid/x.git' }", '[ patch . crates-io ]\nx = { path = "../x" }',
      'patch.crates-io.serde_json.path = "../x"', '"replace"."dcp-ai:2.14.0".path = "../x"', '[ "source" . crates-io ]\nreplace-with = "m"', '[dependencies.other]\n"registry" = "r"', '[target.x.dependencies]\ny = "1"', '[features]\nx = []', '[build-dependencies]\ncc = "1"']) {
      bad(`${toml}\n${extra}\n`, lock, extra);
    }
    for (const line of ['serde_json = { "path" = "/tmp/x" }', 'serde_json = { \'git\' = "https://example.invalid/x.git" }', 'serde_json = { version = "1.0", "registry" = "other" }', '"serde_json" = "1.0"', 'serde_json = "1.0" # trailing comment']) {
      bad(toml.replace('serde_json = "1.0"', line), lock, line);
    }
    bad(toml.replace(dep, `"dcp-ai" = { "path" = "../../../sdks/rust" }`), lock, 'quoted path for dcp-ai');
    bad(toml.replace('[workspace]', '[workspace]\nmembers = ["../x"]'), lock, 'workspace members');
    bad(toml.replace('publish = false', 'publish = false\nbuild = "build.rs"'), lock, 'a build script');
    bad(toml.split('\n').filter((l) => l !== '[workspace]').join('\n'), lock, 'no [workspace]');
    assert.deepEqual(scanCargo({ toml: `# another comment\n\n${toml}\n   # indented comment\n`, lock, features, manifest }), [], 'comments and blank lines');
    for (const section of ['[patch.crates-io]\ndcp-ai = { path = "../x" }', '[replace]\n"dcp-ai:2.14.0" = { path = "../x" }', '[source.crates-io]\nreplace-with = "mirror"', '[registries.other]\nindex = "https://example.invalid"']) {
      bad(`${toml}\n${section}\n`, lock, section);
    }
    bad(toml, lock.replace(c.sha256, 'b'.repeat(64)), 'checksum');
    bad(toml, lock.replace(/(name = "dcp-ai"\nversion = ")2\.14\.0/, '$12.13.0'), 'version');
    bad(toml, lock.replace(new RegExp(`(name = "dcp-ai"\\nversion = "2\\.14\\.0"\\n)source = "[^"]*"\\nchecksum = "[^"]*"\\n`), '$1'), 'dcp-ai without a source (a path dependency)');
    bad(toml, lock.replace(/(name = "serde_json"\nversion = "[^"]*"\nsource = ")[^"]*/, '$1git+https://example.invalid/serde.git#abc'), 'a third-party crate from git');
    const pkgs = parseCargoLock(lock);
    assert.equal(pkgs.filter((p) => p.name === 'dcp-ai').length, 1);
    assert.equal(pkgs.filter((p) => p.source === null).length, 1);
    assert.ok(pkgs.every((p) => p.source === null || p.source === CRATES_IO));
  }
  assert.notEqual(consumerText('rust-default', 'Cargo.lock'), consumerText('rust-otlp', 'Cargo.lock'));

  const meta = (over = {}, feats = ['default']) => ({
    packages: [{ name: 'consumer', id: 'root', source: null, manifest_path: '/run/consumers/rust/Cargo.toml' }, { name: 'dcp-ai', id: 'dcp', version: '2.14.0', source: CRATES_IO, manifest_path: '/run/home/registry/src/x/dcp-ai-2.14.0/Cargo.toml', ...over }],
    resolve: { root: 'root', nodes: [{ id: 'dcp', features: feats }] },
  });
  const check = (m, features = []) => checkCargoMetadata(m, { features, manifest, within: '/run/home' }).length;
  assert.equal(check(meta()), 0);
  assert.equal(check(meta({}, ['default', 'opentelemetry', 'otlp']), ['otlp']), 0);
  assert.equal(check(meta({}, ['default', 'otlp'])), 1); // otlp compiled in the default lane
  assert.equal(check(meta(), ['otlp']), 1); // otlp missing in the otlp lane
  assert.equal(check(meta({ source: null })), 2); // a path dependency: the crate itself and the "every package" rule
  assert.equal(check(meta({ manifest_path: '/checkout/sdks/rust/Cargo.toml' })), 1);
  assert.equal(check(meta({ version: '2.13.0' })), 1);
  const twice = meta();
  twice.packages.push({ ...twice.packages[1], id: 'dcp2' });
  assert.equal(check(twice), 1);
});

test('tools: an explicit path must be an executable file; nothing is searched outside the isolated PATH', () => {
  assert.equal(findTool('node', process.execPath, '--node'), fs.realpathSync(process.execPath));
  assert.throws(() => findTool('go', '/nonexistent/go', '--go'), (e) => e instanceof Stop && e.cls === 'infra' && /--go/.test(e.message));
  assert.throws(() => findTool('go', os.tmpdir(), '--go'), Stop); // a directory
  assert.throws(() => findTool('dcp-no-such-tool', undefined, '--tool'), /pass --tool <path>/);
});

// ── P3: blocks (CLI suites, negative control, direct sections) ───

const cleanProc = { exit_code: 0, signal: null, timed_out: false, output_limit: false, cleanup_incomplete: false, group_alive_after_exit: false, spawn_error: null };
const cleanSup = { deadline_ms: 600000, deadline_hit: false, leaked: [], cleanup: null };
const TESTS = EXPECTED.cli.tests;
const tapOf = (results, totals = {}) => {
  const t = { tests: results.length, pass: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).length, cancelled: 0, skipped: 0, todo: 0, ...totals };
  return ['TAP version 13', ...results.flatMap((r, i) => [`# Subtest: ${r.name}`, `${r.ok ? 'ok' : 'not ok'} ${i + 1} - ${r.name}${r.directive ?? ''}`, '  ---', ...(r.ok ? [] : [`  code: '${r.code ?? 'ERR_ASSERTION'}'`]), '  ...']),
    `1..${results.length}`, ...Object.entries(t).map(([k, n]) => `# ${k} ${n}`), '# duration_ms 1', ''].join('\n');
};
const allOkResults = () => TESTS.map((name) => ({ ok: true, name }));

test('expected blocks: the pinned ids are those of the kit\'s own files', () => {
  assert.equal(TESTS.length, 218);
  assert.equal(new Set(TESTS).size, 218);
  // The four inverted cases are literally the ones cli/__tests__/negative-control.mjs lists.
  const source = fs.readFileSync(path.join(REPO_ROOT, EXPECTED.cli.negative_control), 'utf8');
  const listed = [...source.slice(source.indexOf('const INVERTED = ['), source.indexOf('];', source.indexOf('const INVERTED = ['))).matchAll(/^\s+(['"])(.*)\1,$/gm)].map((m) => m[2]);
  assert.deepEqual(listed, EXPECTED.cli.inverted);
  assert.ok(EXPECTED.cli.inverted.every((n) => TESTS.includes(n)));
  for (const f of [...EXPECTED.cli.suites, EXPECTED.cli.negative_control, EXPECTED.direct.script, ...EXPECTED.direct.fixtures]) assert.ok(fs.existsSync(path.join(REPO_ROOT, f)), f);
  assert.deepEqual(source.match(/'__tests__\/[a-z0-9-]+\.test\.mjs'/g).map((x) => `cli/${x.slice(1, -1)}`), EXPECTED.cli.suites);
  // 103 direct cases: 20 + 79 + 2 + 2, unique.
  const cases = EXPECTED.direct.cases;
  assert.equal(cases.length, 103);
  assert.equal(new Set(cases.map((c) => c.id)).size, 103);
  const bySection = {};
  for (const c of cases) bySection[c.section] = (bySection[c.section] ?? 0) + 1;
  assert.deepEqual(bySection, { domain_separation: 20, security_tier: 79, ped1_classical_only: 2, hybrid_roundtrip: 2 });
  assert.deepEqual(bySection, EXPECTED.direct.sections);
  assert.deepEqual(manifest.lanes['npm-cli'], { package: 'npm-cli', catalogs: [], blocks: ['cli-suites', 'cli-negative-control'] });
  assert.deepEqual(manifest.lanes['npm-wasm-browser'].blocks, ['direct-sections']);
});

test('CLI suites block: every expected test once and ok, or nothing is credited', () => {
  const judge = (results, { proc = {}, sup = {}, totals } = {}) => assessCliSuites({ expected: EXPECTED.cli, observed: { process: { ...cleanProc, ...proc }, supervisor: { ...cleanSup, ...sup }, tap: typeof results === 'string' ? results : tapOf(results, totals) } });
  assert.equal(judge(allOkResults()).status, 'pass');
  assert.deepEqual(parseTap(tapOf(allOkResults())).totals, { tests: 218, pass: 218, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
  const incomplete = (v, why) => assert.deepEqual([v.status, v.class], ['error', 'incomplete'], why);
  incomplete(judge(allOkResults().slice(1)), 'a test missing');
  incomplete(judge([...allOkResults(), allOkResults()[0]]), 'a test twice');
  incomplete(judge([...allOkResults().slice(1), { ok: true, name: 'another test' }]), 'an unknown test in the place of an expected one');
  incomplete(judge([...allOkResults(), { ok: true, name: 'another test' }]), 'an extra test');
  incomplete(judge(allOkResults().map((r, i) => (i === 0 ? { ...r, directive: ' # SKIP' } : r)), { totals: { pass: 217, skipped: 1 } }), 'skipped');
  incomplete(judge(allOkResults().map((r, i) => (i === 0 ? { ...r, directive: ' # TODO later' } : r)), { totals: { pass: 217, todo: 1 } }), 'todo');
  incomplete(judge(allOkResults(), { totals: { pass: 217, cancelled: 1 } }), 'cancelled');
  incomplete(judge(allOkResults(), { totals: { tests: 219 } }), 'the summary counts another test');
  incomplete(judge(tapOf(allOkResults()).split('\n').filter((l) => !l.startsWith('# pass')).join('\n')), 'no summary: the run did not finish');
  incomplete(judge(''), 'no output');
  incomplete(judge(allOkResults(), { proc: { exit_code: 1 } }), 'a failure after a complete passing output');
  incomplete(judge(allOkResults(), { proc: { exit_code: null, signal: 'SIGKILL' } }), 'killed');
  // A failed assertion with the exit code that goes with it is a discrepancy; without it, or not an assertion, it is not.
  const oneFailed = allOkResults().map((r, i) => (i === 3 ? { ...r, ok: false } : r));
  const f = judge(oneFailed, { proc: { exit_code: 1 } });
  assert.deepEqual([f.status, f.failed], ['fail', [TESTS[3]]]);
  incomplete(judge(oneFailed), 'a failed test with exit 0');
  assert.deepEqual([judge(oneFailed.map((r) => (r.ok ? r : { ...r, code: 'ERR_MODULE_NOT_FOUND' })), { proc: { exit_code: 1 } }).class], ['implementation']);
  for (const sup of [{ deadline_hit: true }, { leaked: [1] }, { cleanup: { complete: false } }]) assert.equal(judge(allOkResults(), { sup }).class, 'infra');
  assert.equal(judge(allOkResults(), { proc: { output_limit: true } }).class, 'infra');
});

test('CLI negative control block: exactly the four inverted cases fail, on assertions, for the installed CLI', () => {
  const root = '/run/consumers/npm/node_modules/@dcp-ai/cli';
  const good = () => ({
    cli_root: root, exit_code: 1, signal: null, error: null, totals: { tests: 218, pass: 214, fail: 4, cancelled: 0, skipped: 0, todo: 0 },
    failures: EXPECTED.cli.inverted.map((name) => ({ name, assertion: true })),
    checks: { ran: true, exit_code_1: true, only_the_inverted_cases_failed: true, each_on_an_assertion: true, every_other_test_passed: true, nothing_cancelled_or_skipped: true },
  });
  const judge = (mutate = () => {}, { proc = {}, last = 'NEGATIVE CONTROL: failed as required', raw } = {}) => {
    const doc = good();
    mutate(doc);
    return assessCliNegative({ expected: { ...EXPECTED.cli, cli_root: root }, observed: { process: { ...cleanProc, ...proc }, supervisor: cleanSup, stdout: raw ?? `${JSON.stringify(doc, null, 2)}\n${last}\n` } });
  };
  assert.equal(judge().status, 'pass');
  const bad = (v, why) => assert.equal(v.status, 'error', why);
  bad(judge((d) => { d.cli_root = null; }), 'the checkout\'s CLI');
  bad(judge((d) => { d.cli_root = '/other'; }), 'another CLI');
  bad(judge((d) => { d.failures.pop(); d.totals.fail = 3; d.totals.pass = 215; }), 'three failures');
  bad(judge((d) => { d.failures.push({ name: TESTS.find((n) => !EXPECTED.cli.inverted.includes(n)), assertion: true }); d.totals.fail = 5; d.totals.pass = 213; }), 'five failures');
  bad(judge((d) => { d.failures[0].name = TESTS.find((n) => !EXPECTED.cli.inverted.includes(n)); }), 'another test failed');
  bad(judge((d) => { d.failures[1].assertion = false; }), 'not an assertion');
  bad(judge((d) => { d.totals.skipped = 1; d.totals.pass = 213; }), 'a skipped test');
  bad(judge((d) => { d.totals.cancelled = 1; }), 'cancelled');
  bad(judge((d) => { d.totals.tests = 100; d.totals.pass = 96; }), 'another number of tests');
  bad(judge((d) => { d.exit_code = 0; }), 'the inverted run exited 0');
  bad(judge((d) => { d.signal = 'SIGTERM'; }), 'the inverted run was signalled');
  bad(judge((d) => { d.error = 'spawnSync ETIMEDOUT'; }), 'timeout');
  bad(judge((d) => { d.checks.each_on_an_assertion = false; }), 'one of its own checks is false');
  bad(judge((d) => { d.checks = {}; }), 'no checks');
  bad(judge(() => {}, { last: 'NEGATIVE CONTROL: DID NOT FAIL AS REQUIRED' }), 'its own verdict');
  bad(judge(() => {}, { proc: { exit_code: 1 } }), 'the control exited 1');
  bad(judge(() => {}, { raw: 'NEGATIVE CONTROL: failed as required\n' }), 'the line alone, with no result');
  bad(judge(() => {}, { raw: '' }), 'nothing');
});

const B = { root: '/run/n/@dcp-ai/wasm', manifest: '/run/blocks/SHA256SUMS', chrome: '/opt/chrome', served: Object.fromEntries(['dist/index.js', 'dist/experimental-candidate-verify.js', 'dist/experimental-candidate-produce.js', 'pkg/dcp_ai.js', 'pkg/dcp_ai_bg.wasm'].map((f, i) => [f, String(i).repeat(64)])) };
const goodRecord = (over = {}) => ({
  schema: 'dcp-ai-browser-run/1', outcome: 'responded', failure: null, fault: null, contract: 'dcp-ai-browser-direct/1', run_id: 'direct-run', root: B.root, manifest: B.manifest, served_sha256: { '': 'page', ...B.served },
  browser: { mode: 'automatic', executable: B.chrome, version: 'Chrome 1', user_agent: 'UA', exit: { code: null, signal: 'SIGTERM' }, profile_removed: true, cleanup: { group: 'drained', incomplete: [] } },
  server: { requests: [], refused: [], outside_token: 0 }, started_at: new Date(T + 100).toISOString(), finished_at: new Date(T + 900).toISOString(), ...over,
});

test('browser record: new, of this run and interval, the installed files, a browser that answered and was cleaned up', () => {
  const expect = { ...B, contract: 'dcp-ai-browser-direct/1', run_id: 'direct-run', started: T, finished: T + 1000 };
  const problems = (mutate = () => {}, input = {}) => { const r = goodRecord(); mutate(r); return browserRecordProblems({ text: JSON.stringify(r), existed_before: false, ...input }, expect).length; };
  assert.equal(problems(), 0);
  // Chrome ending by a signal during the wrapper's own cleanup is normal and is not a problem.
  assert.equal(problems((r) => { r.browser.exit = { code: 0, signal: null }; }), 0);
  assert.equal(problems(() => {}, { existed_before: true }), 1);
  assert.equal(problems(() => {}, { text: null }), 1);
  assert.equal(problems(() => {}, { text: 'x' }), 1);
  for (const mutate of [
    (r) => { r.schema = 'other'; }, (r) => { r.outcome = 'failed'; r.failure = 'x'; }, (r) => { r.outcome = 'running'; }, (r) => { r.fault = 'invert-verdict'; }, (r) => { r.contract = 'dcp-ai-conformance-external/1'; },
    (r) => { r.run_id = 'another'; }, (r) => { r.started_at = new Date(T - 1).toISOString(); }, (r) => { r.finished_at = new Date(T + 1001).toISOString(); }, (r) => { delete r.finished_at; },
    (r) => { r.root = '/checkout/sdks/wasm'; }, (r) => { r.manifest = '/checkout/sdks/wasm/SHA256SUMS'; }, (r) => { r.manifest = null; }, (r) => { r.served_sha256['pkg/dcp_ai_bg.wasm'] = 'f'.repeat(64); }, (r) => { delete r.served_sha256['dist/index.js']; },
    (r) => { r.browser.executable = '/other/chrome'; }, (r) => { r.browser.mode = 'manual'; }, (r) => { r.browser.user_agent = null; }, (r) => { r.browser.exit = 'not observed'; }, (r) => { delete r.browser.exit; },
    (r) => { r.browser.profile_removed = false; }, (r) => { r.browser.cleanup.incomplete = ['group not drained']; }, (r) => { delete r.browser.cleanup; }, (r) => { r.server.refused = [{ path: '/x' }]; }, (r) => { r.server.outside_token = 1; },
  ]) assert.ok(problems(mutate) > 0, String(mutate));
});

test('direct sections block: 103 cases once each, tied to the browser record; R9 the inner wrapper must have exited 0', () => {
  const fixtures = Object.fromEntries(EXPECTED.direct.fixtures.map((f, i) => [f, String(i + 1).repeat(64)]));
  const argv = ['--root', B.root, '--chrome', B.chrome, '--manifest', B.manifest, '--browser-report', '/run/blocks/direct.browser.json'];
  const expected = { argv, cases: EXPECTED.direct.cases, fixtures, browser: { ...B } };
  const goodReport = () => {
    const sections = {};
    const cases = EXPECTED.direct.cases.map((c) => { const s = (sections[c.section] ??= { api: 'x', cases: 0, pass: 0, fail: 0 }); s.cases++; s.pass++; return { ...c, label: 'l', pass: true, why: null, observed: { kind: 'return' } }; });
    return { schema: 'dcp-ai-browser-direct-report/1', run_id: 'direct-run', fixtures_sha256: { ...fixtures }, wrapper: { argv: [...argv], exit: 0, signal: null, stderr: '' }, implementation: { name: 'n' }, status: 'pass', sections, cases };
  };
  const failCase = (d, i, why = 'observed differs from the fixture') => { d.cases[i].pass = false; d.cases[i].why = why; d.sections[d.cases[i].section].pass--; d.sections[d.cases[i].section].fail++; d.status = 'fail'; };
  const judge = (mutate = () => {}, { proc = {}, record = {}, observed = {} } = {}) => {
    const d = goodReport();
    mutate(d);
    return assessDirect({ expected, observed: { process: { ...cleanProc, ...proc }, supervisor: cleanSup, existed_before: false, report_text: JSON.stringify(d), browser: { text: JSON.stringify(goodRecord(record)), existed_before: false }, started: T, finished: T + 1000, seen_run_ids: new Set(), ...observed } });
  };
  const ok = judge();
  assert.deepEqual([ok.status, ok.totals, ok.sections.security_tier], ['pass', { cases: 103, pass: 103 }, { cases: 79, pass: 79, fail: 0 }]);
  const incomplete = (v, why) => assert.deepEqual([v.status, v.class], ['error', 'incomplete'], why);

  // R9: a pass or a fail with an inner wrapper (Node) that did not exit 0 without a signal is contradictory evidence.
  incomplete(judge((d) => { d.wrapper.exit = 1; }), 'wrapper.exit 1 with pass');
  incomplete(judge((d) => { d.wrapper.signal = 'SIGTERM'; }), 'wrapper.signal with pass');
  incomplete(judge((d) => { d.wrapper.exit = null; d.wrapper.signal = 'SIGKILL'; }), 'wrapper killed with pass');
  incomplete(judge((d) => { delete d.wrapper.exit; }), 'no wrapper.exit');
  incomplete(judge((d) => { failCase(d, 0); d.wrapper.exit = 1; }, { proc: { exit_code: 1 } }), 'wrapper.exit 1 with fail');
  incomplete(judge((d) => { failCase(d, 0); d.wrapper.signal = 'SIGTERM'; }, { proc: { exit_code: 1 } }), 'wrapper.signal with fail');
  // Chrome's own exit by a signal during cleanup is in the browser record and is not the wrapper's.
  assert.equal(judge(() => {}, { record: { browser: { ...goodRecord().browser, exit: { code: null, signal: 'SIGKILL' } } } }).status, 'pass');

  incomplete(judge((d) => { const c = d.cases.pop(); d.sections[c.section].cases--; d.sections[c.section].pass--; }), 'a case missing');
  incomplete(judge((d) => { d.cases.push(d.cases[0]); d.sections[d.cases[0].section].cases++; d.sections[d.cases[0].section].pass++; }), 'a case twice');
  incomplete(judge((d) => { d.cases.push({ ...d.cases[0], id: 'invented' }); d.sections[d.cases[0].section].cases++; d.sections[d.cases[0].section].pass++; }), 'an unknown case');
  incomplete(judge((d) => { d.cases[0].section = 'security_tier'; d.sections.security_tier.cases++; d.sections.security_tier.pass++; d.sections.domain_separation.cases--; d.sections.domain_separation.pass--; }), 'a case in another section');
  incomplete(judge((d) => { d.cases[0].pass = 'true'; }), 'pass is not a boolean');
  incomplete(judge((d) => { d.sections.security_tier.pass = 78; }), 'section totals');
  incomplete(judge((d) => { d.cases[0].pass = false; }), 'pass with a failed case');
  incomplete(judge((d) => { d.status = 'fail'; }, { proc: { exit_code: 1 } }), 'fail without a failed case');
  incomplete(judge((d) => { d.wrapper.argv = ['--root', '/checkout/sdks/wasm']; }), 'other wrapper options');
  incomplete(judge((d) => { d.fixtures_sha256[EXPECTED.direct.fixtures[0]] = 'f'.repeat(64); }), 'other fixtures');
  incomplete(judge((d) => { d.schema = 'other'; }), 'schema');
  incomplete(judge(() => {}, { proc: { exit_code: 1 } }), 'a failure after a complete passing report');
  incomplete(judge(() => {}, { proc: { exit_code: 3 } }), 'exit 3 with a pass report');
  incomplete(judge(() => {}, { observed: { existed_before: true } }), 'a report that was already there');
  incomplete(judge(() => {}, { observed: { report_text: null } }), 'no report');
  incomplete(judge(() => {}, { observed: { seen_run_ids: new Set(['direct-run']) } }), 'a run id already seen');
  // Old evidence: the report has no time of its own, the browser record ties it to this run and interval.
  incomplete(judge(() => {}, { record: { run_id: 'another-run' } }), 'the browser record of another run');
  incomplete(judge(() => {}, { observed: { started: T + 2000, finished: T + 3000 } }), 'a browser record from before this interval');
  incomplete(judge(() => {}, { observed: { browser: { text: null, existed_before: false } } }), 'no browser record');
  incomplete(judge(() => {}, { observed: { browser: { text: JSON.stringify(goodRecord()), existed_before: true } } }), 'a browser record that was already there');
  incomplete(judge(() => {}, { record: { served_sha256: { ...B.served, 'pkg/dcp_ai_bg.wasm': 'f'.repeat(64) } } }), 'another .wasm served');
  incomplete(judge(() => {}, { record: { fault: 'invert-verdict' } }), 'an injected fault in a normal run');

  // A discrepancy is a fail; a missing, repeated or unasked answer is an error, never a discrepancy.
  const f = judge((d) => failCase(d, 5), { proc: { exit_code: 1 } });
  assert.deepEqual([f.status, f.failed], ['fail', [EXPECTED.direct.cases[5].id]]);
  assert.deepEqual([judge((d) => failCase(d, 5, 'missing'), { proc: { exit_code: 1 } }).class], ['implementation']);
  assert.deepEqual([judge((d) => failCase(d, 5, 'duplicate'), { proc: { exit_code: 1 } }).class], ['implementation']);
  assert.deepEqual([judge((d) => { d.extra_results = ['x']; d.status = 'fail'; }, { proc: { exit_code: 1 } }).class], ['implementation']);
  // No answer: no Chrome is infrastructure; a page that failed is the implementation's.
  const none = (failure) => judge((d) => { d.status = 'error'; d.cases = []; d.sections = {}; d.wrapper.exit = 1; }, { proc: { exit_code: 3 }, record: { outcome: 'failed', failure } });
  assert.equal(none('no Chrome executable found (--chrome, DCP_BROWSER_CHROME or CHROME_BIN)').class, 'infra');
  assert.equal(none('the page reported an infrastructure failure').class, 'implementation');
  for (const sup of [{ deadline_hit: true }, { leaked: [1] }]) assert.equal(assessDirect({ expected, observed: { process: cleanProc, supervisor: { ...cleanSup, ...sup }, existed_before: false, report_text: JSON.stringify(goodReport()), browser: { text: JSON.stringify(goodRecord()), existed_before: false }, started: T, finished: T + 1000, seen_run_ids: new Set() } }).class, 'infra');
});

test('CLI origin and browser preparation: the installed package, its one SDK, an existing Chrome', () => {
  const run = tmp();
  try {
    const nm = path.join(run, 'consumers', 'npm', 'node_modules', '@dcp-ai');
    for (const [name, files] of Object.entries({ cli: { 'package.json': '{"name":"@dcp-ai/cli","type":"module"}', 'bin/dcp-ai.js': '' }, sdk: { 'package.json': '{"name":"@dcp-ai/sdk","main":"index.cjs"}', 'index.cjs': '' } })) {
      for (const [f, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(nm, name, f)), { recursive: true }); fs.writeFileSync(path.join(nm, name, f), text); }
    }
    const npm = { packages: { 'npm-cli': { installed: { path: path.join(nm, 'cli') } }, 'npm-sdk': { installed: { path: path.join(nm, 'sdk') } } } };
    assert.deepEqual(cliOrigin(npm, run).problems, []);
    assert.equal(cliOrigin(npm, run).sdk_resolved, path.join(nm, 'sdk', 'index.cjs'));
    // A second SDK nested in the CLI is not the verified one. (Another tree: Node caches a resolution per directory.)
    const nm2 = path.join(run, 'consumers', 'npm2', 'node_modules', '@dcp-ai');
    fs.cpSync(nm, nm2, { recursive: true });
    fs.mkdirSync(path.join(nm2, 'cli', 'node_modules', '@dcp-ai'), { recursive: true });
    fs.cpSync(path.join(nm2, 'sdk'), path.join(nm2, 'cli', 'node_modules', '@dcp-ai', 'sdk'), { recursive: true });
    const nested = cliOrigin({ packages: { 'npm-cli': { installed: { path: path.join(nm2, 'cli') } }, 'npm-sdk': { installed: { path: path.join(nm2, 'sdk') } } } }, run);
    assert.equal(nested.problems.length, 1);
    assert.match(nested.problems[0], /would load @dcp-ai\/sdk from/);
    assert.equal(cliOrigin(npm, path.join(run, 'elsewhere')).problems.length, 1); // outside the execution
    fs.rmSync(path.join(nm, 'cli', 'bin', 'dcp-ai.js'));
    assert.equal(cliOrigin(npm, run).problems.length, 1);

    const wasm = path.join(nm, 'wasm');
    for (const f of Object.keys(B.served)) { fs.mkdirSync(path.dirname(path.join(wasm, f)), { recursive: true }); fs.writeFileSync(path.join(wasm, f), f); }
    const wnpm = { packages: { 'npm-wasm': { name: '@dcp-ai/wasm', version: '2.2.0', inner: { name: 'dcp-ai', version: '2.14.0' }, installed: { path: wasm } } } };
    // No Chrome is an infrastructure error, never a skip.
    assert.throws(() => prepareBrowser({ run, npm: wnpm, tools: { chrome: path.join(run, 'no-chrome') } }), (e) => e instanceof Stop && e.cls === 'infra');
    const b = prepareBrowser({ run, npm: wnpm, tools: { chrome: process.execPath } });
    assert.equal(b.chrome, process.execPath);
    const sums = fs.readFileSync(b.manifest, 'utf8').trim().split('\n');
    assert.equal(sums.length, 5);
    assert.ok(sums.every((l) => /^[0-9a-f]{64} {2}\.\/(dist|pkg)\//.test(l)));
    const declared = { version: '@dcp-ai/wasm 2.2.0, dcp-ai crate 2.14.0', resolved_from: `${wasm} (pkg/dcp_ai_bg.wasm sha256 ${b.served['pkg/dcp_ai_bg.wasm']}, dist/index.js sha256 ${b.served['dist/index.js']})` };
    assert.deepEqual(browserDeclaredProblems(declared, b, wnpm), []);
    assert.equal(browserDeclaredProblems({ ...declared, version: '@dcp-ai/wasm 2.1.3, dcp-ai crate 2.14.0' }, b, wnpm).length, 1);
    assert.equal(browserDeclaredProblems({ ...declared, resolved_from: declared.resolved_from.replace(wasm, '/checkout/sdks/wasm') }, b, wnpm).length, 1);
    assert.equal(browserDeclaredProblems(null, b, wnpm).length, 1);
  } finally {
    fs.rmSync(run, { recursive: true });
  }
});

test('DCP_CLI_ROOT: the suites\' helper takes the CLI and its dependencies from the installed package, never from the checkout', async () => {
  const base = tmp();
  try {
    const helper = path.join(REPO_ROOT, 'cli', '__tests__', 'cli-under-test.mjs');
    const probe = `const m = await import(${JSON.stringify(helper)}); console.log(JSON.stringify({ cli: m.CLI, bin: m.BIN, installed: m.INSTALLED, dirs: m.dependencyDirs(), dep: await m.dependency('fake-dep'), find: typeof m.findConfigDir }))`;
    const runProbe = (root) => runProcess([process.execPath, '--input-type=module', '-e', probe], Buffer.alloc(0), { env: { ...isolatedEnv(base), ...(root === undefined ? {} : { DCP_CLI_ROOT: root }) }, cwd: base });
    // A package shaped like an installed CLI: hoisted dependencies next to it.
    const nm = path.join(base, 'consumer', 'node_modules');
    const cli = path.join(nm, '@dcp-ai', 'cli');
    fs.mkdirSync(path.join(cli, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(cli, 'package.json'), '{"name":"@dcp-ai/cli","type":"module"}');
    fs.writeFileSync(path.join(cli, 'lib', 'config.js'), 'export const findConfigDir = () => null;\n');
    fs.mkdirSync(path.join(nm, 'fake-dep'));
    fs.writeFileSync(path.join(nm, 'fake-dep', 'package.json'), '{"name":"fake-dep","main":"index.js"}');
    fs.writeFileSync(path.join(nm, 'fake-dep', 'index.js'), 'module.exports = "from the consumer";\n');
    const r = await runProbe(cli);
    assert.equal(r.observed.exit_code, 0, r.observed.stderr_excerpt);
    const got = JSON.parse(r.stdout.toString());
    assert.deepEqual(got, { cli: cli + path.sep, bin: path.join(cli, 'bin', 'dcp-ai.js'), installed: true, dirs: [nm], dep: 'from the consumer', find: 'function' });
    // The checkout's own cli/ is refused as an "installed" package, and a missing directory fails the load.
    const inside = await runProbe(path.join(REPO_ROOT, 'cli'));
    assert.notEqual(inside.observed.exit_code, 0);
    assert.match(inside.observed.stderr_excerpt, /inside this checkout/);
    assert.notEqual((await runProbe(path.join(base, 'absent'))).observed.exit_code, 0);
  } finally {
    fs.rmSync(base, { recursive: true });
  }
});

// ── P4: the CI entry ─────────────────────────────────────────────

test('R11: CI says PASS only for "all" with exit 0 and PARTIAL only for one lane with exit 4', async () => {
  const lanes = ['all', ...Object.keys(manifest.lanes)];
  for (const lane of lanes) {
    for (const code of [0, 1, 2, 3, 4, 5, 137, -1, null, undefined, 256]) {
      const o = ciOutcome(lane, code);
      const pass = lane === 'all' && code === 0;
      const partial = lane !== 'all' && code === 4;
      assert.equal(o.ok, pass || partial, `${lane} ${code}`);
      assert.equal(o.exit === 0, pass || partial, `${lane} ${code}`);
      assert.equal(o.summary.startsWith('PASS'), pass, `${lane} ${code}`);
      assert.equal(o.summary.startsWith('PARTIAL'), partial, `${lane} ${code}`);
      if (!o.ok) assert.ok(Number.isInteger(o.exit) && o.exit > 0 && o.exit < 256, `${lane} ${code}`);
    }
  }
  // The two contradictions never become a success.
  assert.deepEqual([ciOutcome('npm-sdk', 0).ok, ciOutcome('npm-sdk', 0).exit], [false, 1]);
  assert.deepEqual([ciOutcome('all', 4).ok, ciOutcome('all', 4).exit], [false, 1]);
  assert.equal(ciOutcome('all', 3).exit, 3);
  assert.equal(ciOutcome('go', 1).exit, 1);

  const env = { LANE: 'all', RESOLUTION: 'locked', WORK: '/w', PYTHON: '/p', GO: '/g', CARGO: '/c', CHROME: '/ch' };
  assert.deepEqual(ciArgs(env, manifest), ['--resolution', 'locked', '--clean', '--work', '/w', '--python', '/p', '--go', '/g', '--cargo', '/c', '--chrome', '/ch']);
  assert.deepEqual(ciArgs({ ...env, LANE: 'go', RESOLUTION: 'fresh' }, manifest).slice(-2), ['--lane', 'go']);
  for (const bad of [{ LANE: 'nope' }, { LANE: '' }, { LANE: undefined }, { LANE: 'all; rm -rf /' }, { LANE: 'constructor' }, { LANE: '--list' }, { RESOLUTION: 'any' }, { RESOLUTION: undefined }, { WORK: '' }, { PYTHON: undefined }, { CHROME: '' }]) {
    assert.throws(() => ciArgs({ ...env, ...bad }, manifest), Error, JSON.stringify(bad));
  }
  // The real entry: bad inputs exit 2 before anything runs; the workflow offers exactly "all" and the manifest's lanes.
  const ci = (over) => runProcess([process.execPath, path.join(HERE, 'ci.mjs')], Buffer.alloc(0), { env: { ...isolatedEnv(os.tmpdir()), ...env, ...over } });
  assert.equal((await ci({ LANE: 'nope' })).observed.exit_code, 2);
  assert.equal((await ci({ RESOLUTION: 'x' })).observed.exit_code, 2);
  const workflow = fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'release-validation.yml'), 'utf8');
  const options = workflow.slice(workflow.indexOf('lane:'), workflow.indexOf('resolution:')).match(/^ {10}- (\S+)$/gm).map((l) => l.trim().slice(2));
  assert.deepEqual(options, lanes);
  assert.match(workflow, /^on:\n {2}workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /\n {2}(push|pull_request_target|schedule):/);
  assert.match(workflow, /\n {2}pull_request:\n {4}paths:/);
  assert.ok(workflow.includes("LANE: ${{ inputs.lane || 'all' }}"));
  assert.ok(workflow.includes("RESOLUTION: ${{ inputs.resolution || 'locked' }}"));
  assert.match(workflow, /^permissions:\n {2}contents: read\n/m);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /secrets\.|id-token|npm publish|cargo publish|twine|run:.*\$\{\{/);
});
