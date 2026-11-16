#!/usr/bin/env node
// Release validation: installs the published packages from their official registries into a temporary
// consumer, checks their identity and origin, and runs the existing external conformance kit
// (tools/conformance-external.js) against what was installed. It adds no catalog and no oracle.
//
//   node tools/release-validation/run.mjs [--list] [--lane <id>]... [--catalog <id>]...
//                                         [--resolution locked|fresh] [--work <dir>] [--clean]
//                                         [--python <exe>] [--go <exe>] [--cargo <exe>] [--chrome <exe>]
//
// Exit codes: 0 PASS (every lane, every catalog, every control), 1 a discrepancy, 2 usage, 3 an
// infrastructure, identity, unsupported, incomplete or implementation error, 4 PARTIAL (a selection without
// failures: a diagnostic, never a validation).
//
// Everything is kept in the work directory (report.json, the runner's reports, logs, archives, the lock).
// --clean removes only the consumer directories of this execution after the report is written.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT, UsageError, sha256, runProcess } from '../conformance/external.js';
import { EXIT, CONTROL_LANE, REQUIRED_CONTROLS, assessCell, assessCampaign, assessIdentity, scanNpm, scanPython, scanGo, scanCargo } from './assess.mjs';
import { createSupervisor, supervised } from './supervise.mjs';
import { HERE, IMPLEMENTED, WRAPPERS, expectedPlan, createWorkDir, cleanConsumers, isolatedEnv, installNpm, npmLaneArgv, checkDeclared } from './lanes.mjs';
import { installPython, pythonLockKeys } from './lanes-python.mjs';
import { installGo } from './lanes-go.mjs';
import { installRust, RUST_FEATURES } from './lanes-rust.mjs';
import { BLOCKS, prepareBrowser, browserArgv, cellBrowserProblems, browserDeclaredProblems, cliControls, browserControls } from './blocks.mjs';

// Each lane and the installation it runs against. The two npm lanes share one.
const INSTALLS = {
  'npm-sdk': ['npm', installNpm],
  'npm-wasm-node': ['npm', installNpm],
  'npm-wasm-browser': ['npm', installNpm],
  'npm-cli': ['npm', installNpm],
  'pypi-wheel': ['pypi-wheel', (c) => installPython({ ...c, kind: 'wheel' })],
  'pypi-sdist': ['pypi-sdist', (c) => installPython({ ...c, kind: 'sdist' })],
  go: ['go', installGo],
  'crates-default': ['crates-default', (c) => installRust({ ...c, lane: 'crates-default' })],
  'crates-otlp': ['crates-otlp', (c) => installRust({ ...c, lane: 'crates-otlp' })],
};

const RUNNER = path.join(REPO_ROOT, 'tools', 'conformance-external.js');
const PENDING = path.join(HERE, 'fixtures', 'pending.mjs');
const CAMPAIGN_DEADLINE_MS = 45 * 60 * 1000;
const CELL_MARGIN_MS = 15000; // over the runner's own deadline: its SIGTERM grace, its close wait, its report

export function parseArgs(args, manifest) {
  const opts = { list: false, lanes: [], catalogs: [], resolution: 'locked', work: undefined, clean: false, tools: {} };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const value = () => {
      const v = args[++i];
      if (v === undefined || v.startsWith('--')) throw new UsageError(`${a} needs a value`);
      return v;
    };
    const pick = (list, known, what) => {
      const v = value();
      if (!Object.hasOwn(known, v)) throw new UsageError(`unknown ${what} ${v} (see --list)`);
      if (list.includes(v)) throw new UsageError(`${what} ${v} given twice`);
      list.push(v);
    };
    if (a === '--list') opts.list = true;
    else if (a === '--clean') opts.clean = true;
    else if (a === '--lane') pick(opts.lanes, manifest.lanes, 'lane');
    else if (a === '--catalog') pick(opts.catalogs, manifest.catalogs, 'catalog');
    else if (a === '--resolution') {
      opts.resolution = value();
      if (opts.resolution !== 'locked' && opts.resolution !== 'fresh') throw new UsageError('--resolution must be locked or fresh');
    } else if (a === '--work') opts.work = value();
    else if (a === '--python' || a === '--go' || a === '--cargo' || a === '--chrome') opts.tools[a.slice(2)] = value();
    else throw new UsageError(`unknown argument ${a}`);
  }
  if (opts.lanes.length === 0) opts.lanes = Object.keys(manifest.lanes);
  if (opts.catalogs.length === 0) opts.catalogs = Object.keys(manifest.catalogs);
  return opts;
}

const fileHashes = (files) => Object.fromEntries(files.map((f) => [path.relative(REPO_ROOT, f), sha256(fs.readFileSync(f))]));

async function main(args) {
  const manifestFile = path.join(HERE, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  let opts;
  let run;
  try {
    opts = parseArgs(args, manifest);
    if (opts.list) {
      for (const [id, l] of Object.entries(manifest.lanes)) {
        const p = manifest.packages[l.package];
        console.log(`${id.padEnd(18)} ${p.name} ${p.version}  ${IMPLEMENTED.has(id) ? `catalogs: ${l.catalogs.join(', ')}` : 'not implemented in this revision'}`);
      }
      return EXIT.PASS;
    }
    if (process.platform === 'win32') throw new UsageError('the release validation needs a POSIX host');
    run = createWorkDir(opts.work);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.error(`usage error: ${e.message}`);
    return EXIT.USAGE;
  }

  const id = crypto.randomUUID();
  const startedAt = new Date();
  const deadlineAt = performance.now() + CAMPAIGN_DEADLINE_MS;
  const remainingMs = () => Math.round(deadlineAt - performance.now());
  fs.writeFileSync(path.join(run, 'run.json'), JSON.stringify({ id, started_at: startedAt.toISOString() }) + '\n');
  for (const d of ['logs', 'runner', 'controls']) fs.mkdirSync(path.join(run, d));
  console.log(`release validation ${id}\nwork directory: ${run}`);

  const sup = createSupervisor();
  let interrupted = null;
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      if (interrupted) return;
      interrupted = sig;
      sup.killAll(); // the phase in flight sees its process die; the campaign then stops and reports
    });
  }

  const seen = new Set();
  const env = isolatedEnv(run);
  fs.mkdirSync(path.join(run, 'home'));
  fs.mkdirSync(path.join(run, 'tmp'));

  /** One invocation of the runner, judged by assessCell. */
  async function runCell({ catalogFile, assessment, implArgv, reportPath, timeoutMs, deadlineMs, root, extraEnv = {} }) {
    const base = { report: path.relative(run, reportPath) };
    let plan;
    try { plan = expectedPlan(catalogFile, root); } catch (e) { return { ...base, status: 'error', class: 'infra', reasons: [`catalog: ${e.message}`] }; }
    const timeout = timeoutMs ?? plan.timeout_ms;
    const left = remainingMs();
    if (interrupted || left <= 0) return { ...base, status: 'error', class: 'incomplete', reasons: [interrupted ? `interrupted by ${interrupted}` : 'the campaign deadline was reached'] };
    const argv = [process.execPath, RUNNER, '--catalog', catalogFile, ...(root ? ['--root', root] : []), ...(assessment ? ['--assessment', assessment] : []), '--report', reportPath,
      ...(timeoutMs ? ['--timeout-ms', String(timeoutMs)] : []), '--', ...implArgv];
    const existedBefore = fs.lstatSync(reportPath, { throwIfNoEntry: false }) !== undefined;
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    const r = await supervised(sup, argv, { deadlineMs: Math.min(deadlineMs ?? timeout + CELL_MARGIN_MS, left), cwd: run, env: { ...env, ...extraEnv } });
    fs.writeFileSync(`${reportPath}.log`, Buffer.concat([r.stdout, Buffer.from(`\n--- stderr ---\n${r.observed.stderr_excerpt}`)]));
    const text = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : null;
    const verdict = assessCell({
      expected: { argv: implArgv, plan, timeout_ms: timeout },
      observed: { existed_before: existedBefore, started: r.started, finished: r.finished, process: r.observed, supervisor: r.supervisor, report_text: text, seen_run_ids: seen },
    });
    if (verdict.run_id) seen.add(verdict.run_id);
    return {
      ...base, report_sha256: text === null ? null : sha256(Buffer.from(text, 'utf8')), runner_argv: argv,
      runner: { exit_code: r.observed.exit_code, signal: r.observed.signal, duration_ms: r.observed.duration_ms, started_at: new Date(r.started).toISOString(), finished_at: new Date(r.finished).toISOString() },
      supervisor: r.supervisor, ...verdict,
      // Kept for the controls, which judge altered copies of a real report; not written to report.json.
      _text: text, _expected: { argv: implArgv, plan, timeout_ms: timeout }, _observed: { existed_before: existedBefore, started: r.started, finished: r.finished, process: r.observed, supervisor: r.supervisor },
    };
  }
  const declaredOf = (cell) => { try { return JSON.parse(cell._text).implementation.self_declared; } catch { return null; } };

  // ── Lanes ──
  const lanes = {};
  const cells = [];
  const blocks = [];
  const installs = {};
  const ctx = { run, sup, manifest, remainingMs, seen, interrupted: () => interrupted !== null, npm: null, browser: null };
  for (const lane of opts.lanes) {
    if (!IMPLEMENTED.has(lane)) {
      lanes[lane] = { status: 'error', class: 'unsupported', reasons: ['not implemented in this revision of the tool'] };
      continue;
    }
    const [group, install] = INSTALLS[lane];
    if (!installs[group]) {
      if (interrupted || remainingMs() <= 0) installs[group] = { status: 'error', class: 'incomplete', reasons: [interrupted ? `interrupted by ${interrupted}` : 'the campaign deadline was reached'], phases: [], packages: {}, paths: {} };
      else {
        console.log(`${group}: installing from the registry (${opts.resolution})`);
        installs[group] = await install({ run, sup, manifest, resolution: opts.resolution, remainingMs, tools: opts.tools });
      }
      const i = installs[group];
      console.log(`${group}: ${i.status}${i.status === 'pass' ? '' : ` ${i.class}: ${i.reasons.join('; ').slice(0, 1500)}`}`);
    }
    const inst = installs[group];
    lanes[lane] = { status: inst.status, ...(inst.status === 'pass' ? {} : { class: inst.class, reasons: inst.reasons }), install: group };
    if (inst.status !== 'pass') continue;
    const inBrowser = lane === 'npm-wasm-browser';
    if (inBrowser) {
      try { ctx.browser = prepareBrowser({ run, npm: inst, tools: opts.tools }); }
      catch (e) {
        lanes[lane] = { status: 'error', class: e.cls ?? 'infra', reasons: e.reasons ?? [e.message], install: group };
        console.log(`${lane}: error ${lanes[lane].class}: ${lanes[lane].reasons.join('; ')}`);
        continue;
      }
      lanes[lane].browser = { chrome: ctx.browser.chrome, manifest: path.relative(run, ctx.browser.manifest), served_sha256: ctx.browser.served };
    }
    ctx.npm = installs.npm ?? null;
    for (const catalog of manifest.lanes[lane].catalogs.filter((c) => opts.catalogs.includes(c))) {
      const c = manifest.catalogs[catalog];
      const reportPath = path.join(run, 'runner', lane, `${catalog}.json`);
      // The browser wrapper writes its own record of the run, at a path of this cell alone.
      const record = path.join(run, 'runner', lane, `${catalog}.browser.json`);
      const recordExisted = fs.lstatSync(record, { throwIfNoEntry: false }) !== undefined;
      const cell = await runCell({ catalogFile: path.join(REPO_ROOT, c.file), assessment: c.assessment, implArgv: inBrowser ? browserArgv(ctx.browser, record) : npmLaneArgv(lane, inst.paths), reportPath });
      const declared = declaredOf(cell);
      if (cell.status !== 'error' || declared) {
        const problems = inBrowser ? browserDeclaredProblems(declared, ctx.browser, inst) : checkDeclared(lane, declared, inst, run);
        if (problems.length) Object.assign(cell, { status: 'error', class: 'identity', reasons: problems });
      }
      if (inBrowser && cell.status !== 'error') {
        let contract = null;
        try { contract = JSON.parse(cell._text).kit.contract; } catch { /* reported by the record check */ }
        const problems = cellBrowserProblems(ctx.browser, record, recordExisted, cell, contract);
        if (problems.length) Object.assign(cell, { status: 'error', class: 'incomplete', reasons: problems });
        cell.browser_record = path.relative(run, record);
      }
      cells.push({ lane, catalog, self_declared: declared, ...cell });
      console.log(`${lane} × ${catalog}: ${cell.status}${cell.status === 'error' ? ` ${cell.class}: ${cell.reasons[0]}` : ''}${cell.totals ? ` (${cell.totals.pass}/${cell.totals.cases})` : ''}`);
    }
    for (const block of manifest.lanes[lane].blocks ?? []) {
      const result = await BLOCKS[block](ctx);
      blocks.push({ lane, block, ...result });
      console.log(`${lane} : ${block}: ${result.status}${result.status === 'error' ? ` ${result.class}: ${result.reasons[0]}` : ''}${result.totals?.pass !== undefined ? ` (${result.totals.pass}/${result.totals.cases ?? result.totals.tests})` : ''}`);
    }
  }
  const npm = installs.npm ?? null;

  // ── Controls ──
  const controls = npm?.status === 'pass' && opts.lanes.includes(CONTROL_LANE) && !interrupted ? await runControls() : [];
  // The controls of the block lanes: copies of this execution's real outputs, and real runs of the harness faults.
  if (!interrupted) {
    const control = (cid, required, got, ok, extra = {}) => controls.push({ id: cid, required, observed: got, ok, ...extra });
    if (opts.lanes.includes('npm-cli')) cliControls(ctx, blocks, control);
    if (opts.lanes.includes('npm-wasm-browser')) await browserControls(ctx, blocks, control);
  }
  for (const c of controls) console.log(`control ${c.id}: ${c.ok ? 'as required' : 'NOT as required'} (${c.observed})`);

  /**
   * Each control must give its required result in this execution. They use the installed SDK, altered copies
   * inside the work directory and a fixture process; none changes the kit, a catalog or the manifest.
   */
  async function runControls() {
    const out = [];
    const control = (cid, required, got, ok, extra = {}) => out.push({ id: cid, required, observed: got, ok, ...extra });
    const show = (v) => `${v.status}${v.class ? ` ${v.class}` : ''}`;
    const isError = (v, cls) => v.status === 'error' && v.class === cls;
    const dir = path.join(run, 'controls');
    const sdkArgv = npmLaneArgv('npm-sdk', npm.paths);
    const defaultCatalog = path.join(REPO_ROOT, manifest.catalogs.default.file);
    const pendingArgv = (pidFile) => [process.execPath, PENDING, pidFile];
    const alive = (pidFile) => {
      try { process.kill(Number(fs.readFileSync(pidFile, 'utf8')), 0); return true; } catch { return false; }
    };
    const strip = ({ _text, _expected, _observed, ...rest }) => rest;

    // Positive: the installed SDK passes catalog /1. The copies below are made from this report.
    const pos = await runCell({ catalogFile: defaultCatalog, implArgv: sdkArgv, reportPath: path.join(dir, 'positive.json') });
    control('positive', 'pass', show(pos), pos.status === 'pass', { cell: strip(pos) });
    if (pos.status !== 'pass') return out;
    const judge = (mutate, observed = {}) => {
      const doc = JSON.parse(pos._text);
      mutate(doc);
      return assessCell({ expected: pos._expected, observed: { ...pos._observed, seen_run_ids: new Set(), report_text: JSON.stringify(doc), ...observed } });
    };
    const same = judge(() => {});
    control('copy-unaltered', 'pass', show(same), same.status === 'pass');

    // Per-case result missing and duplicated.
    let v = judge((d) => { d.suites[0].cases.pop(); });
    control('case-missing', 'error incomplete', show(v), isError(v, 'incomplete'));
    v = judge((d) => { d.suites[0].cases.push(d.suites[0].cases[0]); });
    control('case-duplicate', 'error incomplete', show(v), isError(v, 'incomplete'));
    // A case with a status the plan does not allow, and counts that its cases do not support.
    v = judge((d) => { d.suites[0].cases[0].status = 'skipped'; });
    control('case-unknown-status', 'error incomplete', show(v), isError(v, 'incomplete'));
    v = judge((d) => { d.suites[0].cases[0].status = 'informative'; d.suites[0].totals.pass--; d.totals.pass--; });
    control('case-normative-as-informative', 'error incomplete', show(v), isError(v, 'incomplete'));
    v = judge((d) => { d.totals.executed = 0; });
    control('case-executed-inconsistent', 'error incomplete', show(v), isError(v, 'incomplete'));

    // Stale reports: the real one again (its id was seen), one with an id never seen but run before this
    // execution's interval, and one already at the path.
    v = judge(() => {}, { seen_run_ids: seen });
    control('stale-seen-id', 'error incomplete', show(v), isError(v, 'incomplete'));
    v = judge((d) => { d.run.id = crypto.randomUUID(); }, { started: pos._observed.finished + 1, finished: pos._observed.finished + 60000 });
    control('stale-unseen-id', 'error incomplete', show(v), isError(v, 'incomplete'));
    v = judge(() => {}, { existed_before: true });
    control('stale-path', 'error incomplete', show(v), isError(v, 'incomplete'));

    // Cell missing and duplicated in the campaign.
    const allOk = REQUIRED_CONTROLS.map((cid) => ({ id: cid, ok: true }));
    const camp = (list, ctl = allOk) => assessCampaign({ manifest, implemented: IMPLEMENTED, selection: { lanes: [CONTROL_LANE], catalogs: ['default'] }, lanes: { [CONTROL_LANE]: { status: 'pass' } }, cells: list, controls: ctl });
    const one = { lane: 'npm-sdk', catalog: 'default', status: 'pass' };
    let c = camp([one]);
    control('campaign-subset', 'PARTIAL, exit 4', `${c.status}, exit ${c.exit_code}`, c.status === 'PARTIAL' && c.exit_code === 4);
    c = camp([]);
    control('cell-missing', 'ERROR', c.status, c.status === 'ERROR' && c.reasons.some((r) => r.includes('missing')));
    c = camp([one, one]);
    control('cell-duplicate', 'ERROR', c.status, c.status === 'ERROR' && c.reasons.some((r) => r.includes('2 times')));
    // Controls missing, duplicated, invented, or with an ok that is not the boolean true.
    c = camp([one], allOk.slice(1));
    control('control-missing', 'ERROR', c.status, c.status === 'ERROR' && c.reasons.some((r) => r.includes('control positive: missing')));
    c = camp([one], [...allOk, allOk[0]]);
    control('control-duplicate', 'ERROR', c.status, c.status === 'ERROR' && c.reasons.some((r) => r.includes('control positive: reported 2 times')));
    c = camp([one], [...allOk, { id: 'invented', ok: true }]);
    control('control-unknown', 'ERROR', c.status, c.status === 'ERROR' && c.reasons.some((r) => r.includes('"invented"')));
    c = camp([one], allOk.map((x, i) => (i === 0 ? { ...x, ok: 'true' } : x)));
    control('control-ok-not-boolean', 'ERROR', c.status, c.status === 'ERROR' && c.reasons.some((r) => r.includes('control positive: did not give')));

    // Identity: a manifest copy with another expected hash, against the archive downloaded in this execution.
    const sdk = npm.packages['npm-sdk'];
    let problems = assessIdentity({ ...sdk.identity, expected: sdk.identity.expected.replace(/.(?===$)/, (ch) => (ch === 'A' ? 'B' : 'A')) });
    control('identity-altered-expected', 'identity problems', `${problems.length} problem(s)`, problems.length === 2);

    // Local origin: a consumer copy with a file: dependency, a lock entry resolved elsewhere, an SDK outside the execution.
    const pkg = JSON.parse(fs.readFileSync(path.join(run, 'consumers', 'npm', 'package.json'), 'utf8'));
    const lock = JSON.parse(fs.readFileSync(path.join(run, 'consumers', 'npm', 'package-lock.json'), 'utf8'));
    problems = scanNpm({ pkg: { ...pkg, dependencies: { ...pkg.dependencies, '@dcp-ai/sdk': 'file:../../sdks/typescript' } }, lock: null, manifest });
    control('origin-file-dependency', 'origin problems', `${problems.length} problem(s)`, problems.length > 0);
    const moved = structuredClone(lock);
    moved.packages['node_modules/@dcp-ai/sdk'].resolved = 'https://registry.example.invalid/@dcp-ai/sdk/-/sdk-2.4.0.tgz';
    problems = scanNpm({ pkg, lock: moved, manifest });
    control('origin-lock-resolved-elsewhere', 'origin problems', `${problems.length} problem(s)`, problems.length > 0);
    problems = checkDeclared('npm-sdk', { ...declaredOf(pos), resolved_from: path.join(REPO_ROOT, 'sdks', 'typescript', 'dist', 'index.js') }, npm, run);
    control('origin-sdk-outside-execution', 'identity problems', `${problems.length} problem(s)`, problems.length > 0);

    // Inverted: catalog /1 unchanged, against a copy of its fixtures in which the expected bytes of the first
    // case are altered. A real discrepancy: that case fails, the others pass, the runner exits 1.
    const first = JSON.parse(fs.readFileSync(defaultCatalog, 'utf8')).suites[0].cases[0];
    const invRoot = path.join(dir, 'inverted-root');
    for (const rel of Object.keys(pos._expected.plan.fixtures)) {
      fs.mkdirSync(path.dirname(path.join(invRoot, rel)), { recursive: true });
      fs.copyFileSync(path.join(REPO_ROOT, rel), path.join(invRoot, rel));
    }
    const fixtureFile = path.join(invRoot, first.source.file);
    const fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
    const vector = first.source.path.reduce((node, seg) => node?.[seg], fixture);
    const field = ['expected_canonical', 'canonical'].find((k) => typeof vector?.[k] === 'string');
    if (field) vector[field] += ' ';
    fs.writeFileSync(fixtureFile, JSON.stringify(fixture, null, 2) + '\n');
    const inv = await runCell({ catalogFile: defaultCatalog, root: invRoot, implArgv: sdkArgv, reportPath: path.join(dir, 'inverted.json') });
    control('inverted-expectation', 'fail: runner exit 1, exactly the altered case', `${show(inv)}, exit ${inv.runner?.exit_code}, failed ${JSON.stringify(inv.failed ?? null)}`,
      field !== undefined && inv.status === 'fail' && inv.runner.exit_code === 1 && inv.failed.length === 1 && inv.failed[0] === first.id && inv.totals.pass === inv.totals.cases - 1, { cell: strip(inv) });

    // Wrapper fault after the SDK was loaded: the real wrapper with DCP_CONFORMANCE_WRAPPER_FAULT=untyped on the
    // admission catalog. An error, never a rejection that counts.
    const fault = await runCell({ catalogFile: path.join(REPO_ROOT, manifest.catalogs.admission.file), implArgv: sdkArgv, reportPath: path.join(dir, 'fault.json'), extraEnv: { DCP_CONFORMANCE_WRAPPER_FAULT: 'untyped' } });
    control('wrapper-fault', 'error implementation, runner exit 3', `${show(fault)}, exit ${fault.runner?.exit_code}`, isError(fault, 'implementation') && fault.runner.exit_code === 3, { cell: strip(fault) });

    // Timeout inside the runner: an implementation that never answers and ignores SIGTERM. The runner's own
    // report must say timed_out, and the runner must have stopped it.
    let pidFile = path.join(dir, 'timeout.pid');
    const to = await runCell({ catalogFile: defaultCatalog, implArgv: pendingArgv(pidFile), reportPath: path.join(dir, 'timeout.json'), timeoutMs: 1000 });
    control('runner-timeout', 'error infra with timed_out in the runner report; implementation stopped',
      `${show(to)}, wrapper timed_out ${to.wrapper?.timed_out}, kinds ${JSON.stringify(to.error_kinds ?? null)}, alive ${alive(pidFile)}`,
      isError(to, 'infra') && to.wrapper?.timed_out === true && isDeepEqualKinds(to.error_kinds, ['timeout']) && !to.supervisor.deadline_hit && fs.existsSync(pidFile) && !alive(pidFile), { cell: strip(to) });

    // Deadline of this tool, through runner → implementation: the runner would wait 10 s; the tree is stopped
    // at 1.5 s, and the implementation (in its own process group) must be gone.
    pidFile = path.join(dir, 'deadline.pid');
    const dl = await runCell({ catalogFile: defaultCatalog, implArgv: pendingArgv(pidFile), reportPath: path.join(dir, 'deadline.json'), timeoutMs: 10000, deadlineMs: 1500 });
    control('nested-deadline', 'error infra: deadline reached, cleanup complete, implementation stopped',
      `${show(dl)}, deadline_hit ${dl.supervisor?.deadline_hit}, cleanup complete ${dl.supervisor?.cleanup?.complete}, alive ${alive(pidFile)}`,
      isError(dl, 'infra') && dl.supervisor.deadline_hit && dl.supervisor.cleanup.complete && fs.existsSync(pidFile) && !alive(pidFile), { cell: strip(dl) });

    // A process left behind by an implementation that exits normally.
    pidFile = path.join(dir, 'leak.pid');
    const leak = await runCell({ catalogFile: defaultCatalog, implArgv: [...pendingArgv(pidFile), 'spawn-detached'], reportPath: path.join(dir, 'leak.json') });
    control('leaked-descendant', 'error infra: a descendant alive after exit, then stopped',
      `${show(leak)}, leaked ${leak.supervisor?.leaked?.length}, cleanup complete ${leak.supervisor?.cleanup?.complete}, alive ${alive(pidFile)}`,
      isError(leak, 'infra') && leak.supervisor.leaked?.length === 1 && leak.supervisor.cleanup.complete && fs.existsSync(pidFile) && !alive(pidFile), { cell: strip(leak) });

    // Python, Go and Rust: the committed consumers are clean, and a copy with a local origin, an altered checksum
    // or without the DCP package is refused by the same guard each lane runs before it installs anything.
    const text = (...rel) => fs.readFileSync(path.join(HERE, 'consumers', ...rel), 'utf8');
    const guard = (name, clean, local, checksum, missing) => {
      const base = clean((x) => x).length;
      for (const [what, mutate] of [['origin-local', local], ['checksum-altered', checksum], ['package-missing', missing]]) {
        const n = clean(mutate).length;
        control(`${name}-${what}`, 'clean consumer: 0 problems; altered copy: problems', `clean ${base}, altered ${n}`, base === 0 && n > 0);
      }
    };
    const flip = (hash) => hash.replace(/.$/, (ch) => (ch === '0' ? '1' : '0'));
    // Every platform's Python lock.
    const py = pythonLockKeys().map((k) => ({ wheel: text('python', k, 'wheel.txt'), sdist: text('python', k, 'sdist.txt'), build: text('python', k, 'build.txt') }));
    const pw = manifest.packages['pypi-wheel'];
    // An altered copy must be refused in every lock: a lock that lets it through gives no problems here.
    guard('python', (m) => {
      const per = py.map((l) => scanPython({ ...m(l), manifest }));
      return per.some((x) => x.length === 0) && per.some((x) => x.length > 0) ? [] : per.flat();
    },
      (l) => ({ ...l, wheel: `${l.wheel}-e ../../sdks/python\n` }),
      (l) => ({ ...l, wheel: l.wheel.replace(pw.sha256, flip(pw.sha256)) }),
      (l) => ({ ...l, wheel: l.wheel.split('\n').filter((line) => !line.startsWith('dcp-ai==')).join('\n') }));
    const g = manifest.packages.go;
    const gof = { mod: text('go', 'go.mod'), sum: text('go', 'go.sum') };
    guard('go', (m) => scanGo({ ...m(gof), manifest }),
      (l) => ({ ...l, mod: `${l.mod}\nreplace ${g.name} => ../../sdks/go\n` }),
      (l) => ({ ...l, sum: l.sum.replace(g.h1, g.h1.replace(/^h1:./, (x) => (x === 'h1:A' ? 'h1:B' : 'h1:A'))) }),
      (l) => ({ ...l, mod: l.mod.split('\n').filter((line) => !line.includes(`${g.name} `)).join('\n') }));
    const cr = manifest.packages.crates;
    const rs = { toml: text('rust-default', 'Cargo.toml'), lock: text('rust-default', 'Cargo.lock') };
    guard('rust', (m) => scanCargo({ ...m(rs), features: RUST_FEATURES['crates-default'], manifest }),
      (l) => ({ ...l, toml: l.toml.replace(`dcp-ai = "=${cr.version}"`, 'dcp-ai = { path = "../../sdks/rust" }') }),
      (l) => ({ ...l, lock: l.lock.replace(cr.sha256, flip(cr.sha256)) }),
      (l) => ({ ...l, lock: l.lock.replace(/\[\[package\]\]\nname = "dcp-ai"\n[^[]*/, '') }));
    return out;
  }

  // ── Report ──
  let stillAlive = null;
  try { stillAlive = sup.observe().alive.map((k) => k.pid); } catch { /* reported as null */ }
  const finalCleanup = stillAlive === null || stillAlive.length > 0 ? await sup.killAll() : null;
  const verdict = assessCampaign({
    manifest, implemented: IMPLEMENTED, selection: { lanes: opts.lanes, catalogs: opts.catalogs }, lanes,
    cells: cells.map(({ lane, catalog, status, class: cls }) => ({ lane, catalog, status, class: cls })),
    blocks: blocks.map(({ lane, block, status, class: cls }) => ({ lane, block, status, class: cls })), controls, interrupted: interrupted !== null,
  });
  if (stillAlive === null || stillAlive.length > 0) {
    verdict.reasons.push(`processes of this execution were alive at the end (${JSON.stringify(stillAlive)}); cleanup complete: ${finalCleanup.complete}`);
    if (verdict.status !== 'ERROR') Object.assign(verdict, { status: 'ERROR', exit_code: EXIT.ERROR });
  }
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const used = [RUNNER, ...walk(HERE).sort(),
    ...['ts-sdk.mjs', 'wasm.mjs', 'python_sdk.py', path.join('go', 'main.go'), path.join('rust', 'src', 'main.rs'), 'wasm-browser.mjs', ...walk(path.join(WRAPPERS, 'browser')).map((f) => path.relative(WRAPPERS, f))].map((f) => path.join(WRAPPERS, f)),
    ...walk(path.join(REPO_ROOT, 'cli', '__tests__')),
    ...['tests/interop/v2/interop_vectors.json', 'tests/interop/v2/mandate_acknowledgment_vectors.json', 'tests/interop/v2/ed25519_ped1_vectors.json'].map((f) => path.join(REPO_ROOT, f)),
    ...['external.js', 'external-evidence.js', 'external-admission.js', 'external-delegation.js', 'external-effective.js'].map((f) => path.join(REPO_ROOT, 'tools', 'conformance', f)),
    ...Object.values(manifest.catalogs).map((c) => path.join(REPO_ROOT, c.file))];
  // The revision names the commit only: the hashes above are what was actually used, and the files listed as
  // differing from the revision (modified or untracked) are not described by it. Without Git: unavailable.
  const git = async (...a) => {
    const r = await runProcess(['git', '-C', REPO_ROOT, ...a], Buffer.alloc(0), { env, cwd: run, timeoutMs: 20000 });
    return r.observed.exit_code === 0 ? r.stdout.toString('utf8') : null;
  };
  const head = (await git('rev-parse', 'HEAD'))?.trim();
  const dirty = head ? await git('status', '--porcelain', '--', ...used) : null;
  const revision = head && dirty !== null
    ? { revision: head, files_differing_from_revision: dirty.split('\n').filter(Boolean).map((l) => l.slice(3)) }
    : { revision: 'unavailable', files_differing_from_revision: null };
  const strip = ({ _text, _expected, _observed, ...rest }) => rest;
  const report = {
    schema: 'dcp-ai-release-validation-report/1',
    scope: 'These artifacts, with these hashes, obtained from these registries, were run against these catalogs with the kit at this revision in this environment. It is not a certification and covers nothing that was not executed.',
    notes: [
      'Paths are absolute paths of the host that ran the validation.',
      'The environment of every subprocess is built by the tool: no variable is inherited, no credential or registry configuration of the user is read.',
      'What a wrapper declares about itself (self_declared) is a diagnostic and proves no origin.',
    ],
    run: { id, started_at: startedAt.toISOString(), finished_at: new Date().toISOString(), work: run, interrupted },
    selection: { lanes: opts.lanes, catalogs: opts.catalogs, resolution: opts.resolution },
    host: { platform: process.platform, arch: process.arch },
    toolchains: { node: process.version, node_path: process.execPath, ...Object.fromEntries(Object.entries(installs).map(([g, i]) => [g, i.toolchain ?? null])) },
    environment: { variables: Object.keys(env), path: env.PATH },
    checkout: { root: REPO_ROOT, ...revision, files_sha256: fileHashes(used) },
    installs,
    lanes,
    cells: cells.map(strip),
    blocks: blocks.map(strip),
    controls,
    verdict,
  };
  fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  let cleaned = null;
  if (opts.clean) {
    try { cleaned = cleanConsumers(run); } catch (e) { console.error(`clean: ${e.message}`); }
  }
  console.log(`\n${verdict.status} (exit ${verdict.exit_code})`);
  for (const r of verdict.reasons) console.log(`  ${r}`);
  if (verdict.not_executed.length) console.log(`  not executed: ${verdict.not_executed.join('; ')}`);
  console.log(`report: ${path.join(run, 'report.json')}${cleaned ? `\nremoved from the work directory: ${cleaned.join(', ')}` : ''}`);
  return verdict.exit_code;
}

const isDeepEqualKinds = (a, b) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
