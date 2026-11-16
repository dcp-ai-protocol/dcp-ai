// Blocks: the evidence of a lane that is not a catalog cell. npm-cli: the four CLI suites and the kit's
// negative control, both against the installed CLI (DCP_CLI_ROOT). npm-wasm-browser: the direct sections in
// a real browser. Each block runs the kit's own script as a supervised subprocess and is judged in assess.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, sha256 } from '../conformance/external.js';
import { assessCliSuites, assessCliNegative, assessDirect, assessCampaign, browserRecordProblems, parseTap, CONTROL_SETS } from './assess.mjs';
import { supervised } from './supervise.mjs';
import { HERE, WRAPPERS, IMPLEMENTED, Stop, isolatedEnv, isInside } from './lanes.mjs';

export const EXPECTED = JSON.parse(fs.readFileSync(path.join(HERE, 'expected-blocks.json'), 'utf8'));
const BLOCK_DEADLINE_MS = 10 * 60 * 1000;
const SERVED = ['dist/index.js', 'dist/experimental-candidate-verify.js', 'dist/experimental-candidate-produce.js', 'pkg/dcp_ai.js', 'pkg/dcp_ai_bg.wasm'];
const DIRECT = path.join(REPO_ROOT, EXPECTED.direct.script);

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
const existed = (file) => fs.lstatSync(file, { throwIfNoEntry: false }) !== undefined;
const brief = (r) => ({ exit_code: r.observed.exit_code, signal: r.observed.signal, duration_ms: r.observed.duration_ms, started_at: new Date(r.started).toISOString(), finished_at: new Date(r.finished).toISOString() });

/** One supervised process of a block; its stdout and stderr are kept next to the block's files. */
async function launch(ctx, dir, name, argv, { env, cwd, deadlineMs = BLOCK_DEADLINE_MS }) {
  fs.mkdirSync(dir, { recursive: true });
  const left = ctx.remainingMs();
  if (ctx.interrupted() || left <= 0) throw new Stop('incomplete', [ctx.interrupted() ? 'interrupted' : 'the campaign deadline was reached']);
  const r = await supervised(ctx.sup, argv, { deadlineMs: Math.min(deadlineMs, left), cwd, env });
  fs.writeFileSync(path.join(dir, `${name}.stdout.txt`), r.stdout);
  fs.writeFileSync(path.join(dir, `${name}.stderr.txt`), r.observed.stderr_excerpt);
  return r;
}
const stopped = (e) => ({ status: 'error', class: e instanceof Stop ? e.cls : 'infra', reasons: e instanceof Stop ? e.reasons : [e.stack ?? String(e)] });

// ── npm-cli ──────────────────────────────────────────────────────

/** Where the installed CLI is and what it would load: inside the execution, with the one verified SDK. */
export function cliOrigin(npm, run) {
  const cli = npm.packages['npm-cli'].installed.path;
  const sdk = npm.packages['npm-sdk'].installed.path;
  const problems = [];
  const bin = path.join(cli, 'bin', 'dcp-ai.js');
  if (fs.realpathSync(cli) !== cli || !isInside(cli, run)) problems.push(`the installed CLI ${cli} is a link or outside the execution`);
  if (!fs.statSync(bin, { throwIfNoEntry: false })?.isFile()) problems.push(`${bin} is not in the installed package`);
  // Path resolution only: nothing of the package is loaded here.
  let resolved = null;
  try { resolved = fs.realpathSync(createRequire(path.join(cli, 'package.json')).resolve('@dcp-ai/sdk')); } catch (e) { problems.push(`the installed CLI cannot resolve @dcp-ai/sdk (${e.code})`); }
  if (resolved !== null && !isInside(resolved, sdk)) problems.push(`the installed CLI would load @dcp-ai/sdk from ${resolved}, not the verified ${sdk}`);
  return { cli, bin, sdk_resolved: resolved, problems };
}

function cliContext(ctx) {
  const origin = cliOrigin(ctx.npm, ctx.run);
  const dir = path.join(ctx.run, 'blocks', 'npm-cli');
  const cwd = path.join(dir, 'cwd'); // new and empty: no .dcp/ in it or above it inside the execution
  fs.mkdirSync(cwd, { recursive: true });
  return { origin, dir, cwd, env: isolatedEnv(ctx.run, { DCP_CLI_ROOT: origin.cli }) };
}

export async function runCliSuites(ctx) {
  try {
    const c = cliContext(ctx);
    if (c.origin.problems.length) return { status: 'error', class: 'identity', reasons: c.origin.problems };
    const argv = [process.execPath, '--test', '--test-reporter=tap', ...EXPECTED.cli.suites.map((s) => path.join(REPO_ROOT, s))];
    const r = await launch(ctx, c.dir, 'suites', argv, { env: c.env, cwd: c.cwd });
    const observed = { process: r.observed, supervisor: r.supervisor, tap: r.stdout.toString('utf8') };
    return { argv, cli_root: c.origin.cli, sdk_resolved: c.origin.sdk_resolved, output: 'blocks/npm-cli/suites.stdout.txt', output_sha256: sha256(r.stdout), process: brief(r), supervisor: r.supervisor,
      ...assessCliSuites({ expected: EXPECTED.cli, observed }), _observed: observed };
  } catch (e) { return stopped(e); }
}

export async function runCliNegative(ctx) {
  try {
    const c = cliContext(ctx);
    if (c.origin.problems.length) return { status: 'error', class: 'identity', reasons: c.origin.problems };
    const argv = [process.execPath, path.join(REPO_ROOT, EXPECTED.cli.negative_control)];
    const r = await launch(ctx, c.dir, 'negative-control', argv, { env: c.env, cwd: c.cwd });
    const observed = { process: r.observed, supervisor: r.supervisor, stdout: r.stdout.toString('utf8') };
    return { argv, cli_root: c.origin.cli, output: 'blocks/npm-cli/negative-control.stdout.txt', output_sha256: sha256(r.stdout), process: brief(r), supervisor: r.supervisor,
      ...assessCliNegative({ expected: { ...EXPECTED.cli, cli_root: c.origin.cli }, observed }), _observed: observed };
  } catch (e) { return stopped(e); }
}

// ── npm-wasm-browser ─────────────────────────────────────────────

/**
 * What the browser lane needs before any run: a Chrome that exists (given with --chrome, or the usual one of
 * the platform; never installed or changed), and a SHA256SUMS of the installed files the wrapper serves, which
 * pins every run to the installed package. No Chrome is an infrastructure error.
 */
export function prepareBrowser({ run, npm, tools }) {
  const candidates = tools.chrome !== undefined ? [path.resolve(tools.chrome)]
    : [...(process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] : []),
      ...isolatedEnv('/').PATH.split(':').flatMap((d) => ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].map((n) => path.join(d, n)))];
  const chrome = candidates.find((c) => {
    try { fs.accessSync(c, fs.constants.X_OK); return fs.statSync(c).isFile(); } catch { return false; }
  });
  if (!chrome) throw new Stop('infra', [tools.chrome !== undefined ? `--chrome ${tools.chrome} is not an executable file` : 'no Chrome found; pass --chrome <path>']);
  const root = npm.packages['npm-wasm'].installed.path;
  const served = Object.fromEntries(SERVED.map((rel) => [rel, sha256(fs.readFileSync(path.join(root, rel)))]));
  const dir = path.join(run, 'blocks', 'npm-wasm-browser');
  fs.mkdirSync(dir, { recursive: true });
  const manifest = path.join(dir, 'SHA256SUMS');
  fs.writeFileSync(manifest, SERVED.map((rel) => `${served[rel]}  ./${rel}\n`).join(''));
  return { chrome, root, served, manifest, dir };
}

/** The wrapper's argv for one run; `record` is the browser record that run must write, a path not used before. */
export const browserArgv = (b, record, chrome = b.chrome) => [process.execPath, path.join(WRAPPERS, 'wasm-browser.mjs'), ...browserOptions(b, record, chrome)];
const browserOptions = (b, record, chrome = b.chrome) => ['--root', b.root, '--chrome', chrome, '--manifest', b.manifest, '--browser-report', record];
export const browserExpect = (b, chrome = b.chrome) => ({ root: b.root, manifest: b.manifest, chrome, served: b.served });

/** The browser record of a catalog cell, against the runner's report of the same run. Returns the problems. */
export function cellBrowserProblems(b, record, existedBefore, cell, contract) {
  return browserRecordProblems({ text: read(record), existed_before: existedBefore }, { ...browserExpect(b), contract, run_id: cell.run_id, started: cell._observed.started, finished: cell._observed.finished });
}

/** What the browser wrapper declares: the installed root and the hashes of the two files it names. */
export function browserDeclaredProblems(declared, b, npm) {
  if (declared === null || typeof declared !== 'object') return ['the wrapper declared nothing about the implementation'];
  const want = `${b.root} (pkg/dcp_ai_bg.wasm sha256 ${b.served['pkg/dcp_ai_bg.wasm']}, dist/index.js sha256 ${b.served['dist/index.js']})`;
  const problems = [];
  if (declared.resolved_from !== want) problems.push(`the wrapper served ${declared.resolved_from}, not ${want}`);
  const p = npm.packages['npm-wasm'];
  // The browser wrapper names both identities: the npm package and the crate inside it.
  const version = `${p.name} ${p.version}, ${p.inner.name} crate ${p.inner.version}`;
  if (declared.version !== version) problems.push(`the wrapper declares version ${JSON.stringify(declared.version)}, the checked package is ${JSON.stringify(version)}`);
  return problems;
}

async function direct(ctx, b, name, { chrome = b.chrome, extraEnv = {}, fault = null } = {}) {
  const report = path.join(b.dir, `${name}.json`);
  const record = path.join(b.dir, `${name}.browser.json`);
  const before = { report: existed(report), record: existed(record) };
  const options = browserOptions(b, record, chrome);
  const argv = [process.execPath, DIRECT, '--report', report, ...options];
  const r = await launch(ctx, b.dir, name, argv, { env: isolatedEnv(ctx.run, extraEnv), cwd: ctx.run });
  const observed = {
    process: r.observed, supervisor: r.supervisor, existed_before: before.report, report_text: read(report),
    browser: { text: read(record), existed_before: before.record }, started: r.started, finished: r.finished,
  };
  const expected = {
    argv: options, cases: EXPECTED.direct.cases, browser: { ...browserExpect(b, chrome), fault },
    fixtures: Object.fromEntries(EXPECTED.direct.fixtures.map((f) => [f, sha256(fs.readFileSync(path.join(REPO_ROOT, f)))])),
  };
  const verdict = assessDirect({ expected, observed: { ...observed, seen_run_ids: ctx.seen } });
  if (verdict.run_id) ctx.seen.add(verdict.run_id);
  let browser = null;
  try { browser = JSON.parse(observed.browser.text).browser; } catch { /* no record */ }
  return {
    argv, report: path.relative(ctx.run, report), browser_record: path.relative(ctx.run, record), report_sha256: observed.report_text === null ? null : sha256(Buffer.from(observed.report_text)),
    browser: browser && { executable: browser.executable, version: browser.version, user_agent: browser.user_agent, exit: browser.exit, profile_removed: browser.profile_removed },
    process: brief(r), supervisor: r.supervisor, ...verdict, _observed: observed, _expected: expected,
  };
}

export async function runDirectSections(ctx) {
  try {
    const d = await direct(ctx, ctx.browser, 'direct');
    if (d.status === 'pass') {
      let declared = null;
      try { declared = JSON.parse(d._observed.report_text).implementation; } catch { /* judged below */ }
      const problems = browserDeclaredProblems(declared, ctx.browser, ctx.npm);
      if (problems.length) return { ...d, status: 'error', class: 'identity', reasons: problems };
    }
    return d;
  } catch (e) { return stopped(e); }
}

export const BLOCKS = { 'cli-suites': runCliSuites, 'cli-negative-control': runCliNegative, 'direct-sections': runDirectSections };

// ── Controls of the blocks ───────────────────────────────────────

const show = (v) => `${v.status}${v.class ? ` ${v.class}` : ''}`;
const isError = (v, cls) => v.status === 'error' && v.class === cls;

/** npm-cli: altered copies of this execution's real outputs, and the aggregation of blocks. `blocks`: the real results. */
export function cliControls(ctx, blocks, control) {
  const suites = blocks.find((b) => b.block === 'cli-suites');
  const negative = blocks.find((b) => b.block === 'cli-negative-control');
  if (suites?.status !== 'pass' || negative?.status !== 'pass') return; // the controls stay missing, which is an error
  const tap = suites._observed.tap;
  const judge = (mutate, proc = {}) => assessCliSuites({ expected: EXPECTED.cli, observed: { ...suites._observed, process: { ...suites._observed.process, ...proc }, tap: mutate(tap) } });
  const first = parseTap(tap).results[0].name;
  const line = tap.split('\n').find((l) => /^ok \d+ - /.test(l) && l.endsWith(` - ${first}`));
  const total = EXPECTED.cli.tests.length;
  const retotal = (t, tests, pass, fail = 0) => t.replace(`# tests ${total}`, `# tests ${tests}`).replace(`# pass ${total}`, `# pass ${pass}`).replace('# fail 0', `# fail ${fail}`);
  let v = judge((t) => retotal(t.replace(`${line}\n`, ''), total - 1, total - 1));
  control('cli-test-missing', 'error incomplete', show(v), isError(v, 'incomplete'));
  v = judge((t) => retotal(t.replace(`${line}\n`, `${line}\n${line}\n`), total + 1, total + 1));
  control('cli-test-duplicate', 'error incomplete', show(v), isError(v, 'incomplete'));
  v = judge((t) => t.replace(line, `${line} (another test)`));
  control('cli-test-unknown', 'error incomplete', show(v), isError(v, 'incomplete'));
  v = judge((t) => t.replace(line, `${line} # SKIP`).replace(`# pass ${total}`, `# pass ${total - 1}`).replace('# skipped 0', '# skipped 1'));
  control('cli-test-skipped', 'error incomplete', show(v), isError(v, 'incomplete'));
  // A real failed assertion is a discrepancy (fail), and only with the exit code that goes with it.
  v = judge((t) => retotal(t.replace(line, `not ${line}\n  ---\n  code: 'ERR_ASSERTION'\n  ...`), total, total - 1, 1), { exit_code: 1 });
  control('cli-test-failed', 'fail', show(v), v.status === 'fail' && v.failed.length === 1);
  v = judge((t) => t, { exit_code: 1 });
  control('cli-late-failure', 'error incomplete', show(v), isError(v, 'incomplete'));

  const out = negative._observed.stdout;
  const cut = out.trimEnd().lastIndexOf('\n');
  const doc = JSON.parse(out.slice(0, cut));
  const judgeNeg = (mutate) => {
    const d = structuredClone(doc);
    mutate(d);
    return assessCliNegative({ expected: { ...EXPECTED.cli, cli_root: negative.cli_root }, observed: { ...negative._observed, stdout: `${JSON.stringify(d, null, 2)}\n${out.slice(cut + 1)}` } });
  };
  v = judgeNeg((d) => { d.failures.pop(); d.totals.fail--; d.totals.pass++; });
  control('cli-negative-three-failures', 'error incomplete', show(v), isError(v, 'incomplete'));
  v = judgeNeg((d) => { d.failures[0].assertion = false; });
  control('cli-negative-not-assertion', 'error incomplete', show(v), isError(v, 'incomplete'));
  v = judgeNeg((d) => { d.cli_root = null; }); // the control of the checkout's CLI proves nothing about the installed one
  control('cli-negative-other-cli', 'error incomplete', show(v), isError(v, 'incomplete'));

  // Aggregation: an installed lane with no cells owes its blocks. Its own status credits nothing.
  const camp = (list) => assessCampaign({
    manifest: ctx.manifest, implemented: IMPLEMENTED, selection: { lanes: ['npm-cli'], catalogs: ['default'] }, lanes: { 'npm-cli': { status: 'pass' } }, cells: [], blocks: list,
    controls: CONTROL_SETS['npm-cli'].map((id) => ({ id, ok: true })),
  });
  const both = [{ lane: 'npm-cli', block: 'cli-suites', status: 'pass' }, { lane: 'npm-cli', block: 'cli-negative-control', status: 'pass' }];
  let c = camp(both);
  const sane = c.status === 'PARTIAL';
  c = camp(both.slice(0, 1));
  control('block-missing', 'ERROR', c.status, sane && c.status === 'ERROR' && c.reasons.some((r) => r.includes('cli-negative-control: missing')));
  c = camp([...both, both[0]]);
  control('block-duplicate', 'ERROR', c.status, sane && c.status === 'ERROR' && c.reasons.some((r) => r.includes('reported 2 times')));
  c = camp([...both, { lane: 'npm-cli', block: 'invented', status: 'pass' }]);
  control('block-unknown', 'ERROR', c.status, sane && c.status === 'ERROR' && c.reasons.some((r) => r.includes('invented')));
  c = camp([]);
  control('block-status-alone', 'ERROR', c.status, sane && c.status === 'ERROR');
}

/** npm-wasm-browser: altered copies of the real direct report, and three real runs (no Chrome, two harness faults). */
export async function browserControls(ctx, blocks, control) {
  const real = blocks.find((b) => b.block === 'direct-sections');
  if (real?.status !== 'pass') return;
  const judge = (mutate, observed = {}) => {
    const doc = JSON.parse(real._observed.report_text);
    mutate(doc);
    return assessDirect({ expected: real._expected, observed: { ...real._observed, seen_run_ids: new Set(), report_text: JSON.stringify(doc), ...observed } });
  };
  const same = judge(() => {});
  const sane = same.status === 'pass';
  const section = (d, c, k) => { d.sections[c.section].cases += k; d.sections[c.section].pass += k; };
  let v = judge((d) => section(d, d.cases.pop(), -1));
  control('direct-case-missing', 'error incomplete', show(v), sane && isError(v, 'incomplete'));
  v = judge((d) => { d.cases.push(d.cases[0]); section(d, d.cases[0], 1); });
  control('direct-case-duplicate', 'error incomplete', show(v), sane && isError(v, 'incomplete'));
  v = judge((d) => { d.cases.push({ ...d.cases[0], id: 'invented' }); section(d, d.cases[0], 1); });
  control('direct-case-unknown', 'error incomplete', show(v), sane && isError(v, 'incomplete'));
  v = judge(() => {}, { existed_before: true });
  control('direct-stale-report', 'error incomplete', show(v), sane && isError(v, 'incomplete'));
  // The same report with the browser record of another moment: before this interval, then of another run.
  const later = judge(() => {}, { started: real._observed.finished + 1, finished: real._observed.finished + 60000 });
  const other = judge((d) => { d.run_id = '00000000-0000-4000-8000-000000000000'; });
  control('direct-stale-browser-record', 'error incomplete, both ways', `${show(later)}; ${show(other)}`, sane && isError(later, 'incomplete') && isError(other, 'incomplete'));
  v = judge(() => {}, { process: { ...real._observed.process, exit_code: 1 } });
  control('direct-late-failure', 'error incomplete', show(v), sane && isError(v, 'incomplete'));

  const strip = ({ _observed, _expected, ...rest }) => rest;
  const tryDirect = async (name, options) => {
    try { return await direct(ctx, ctx.browser, name, options); } catch (e) { return stopped(e); }
  };
  // No Chrome: infrastructure, never a pass and never a skip.
  let d = await tryDirect('control-missing-chrome', { chrome: path.join(ctx.browser.dir, 'no-such-chrome') });
  control('browser-missing-chrome', 'error infra', show(d), isError(d, 'infra'), { block: strip(d) });
  // The harness's own faults, in the real browser: a repeated answer is an error, an inverted verdict a discrepancy.
  d = await tryDirect('control-duplicate-answer', { extraEnv: { DCP_CONFORMANCE_WRAPPER_FAULT: 'duplicate-answer' }, fault: 'duplicate-answer' });
  control('direct-fault-duplicate-answer', 'error implementation', show(d), isError(d, 'implementation'), { block: strip(d) });
  d = await tryDirect('control-invert-verdict', { extraEnv: { DCP_CONFORMANCE_WRAPPER_FAULT: 'invert-verdict' }, fault: 'invert-verdict' });
  control('direct-fault-invert-verdict', 'fail: a real discrepancy, the other cases pass', `${show(d)}, failed ${JSON.stringify(d.failed ?? null)}`,
    d.status === 'fail' && d.failed.length >= 1 && d.totals.pass === d.totals.cases - d.failed.length, { block: strip(d) });

  // The whole tree, through direct-sections → wrapper → Chrome (Chrome in its own process group): once this run's
  // Chrome is seen running, the supervisor stops everything, as it does at a deadline or an interruption. This
  // run's Chrome must be among what it found, and nothing of this run may be left running.
  const marker = `--user-data-dir=${path.join(ctx.run, 'tmp', 'dcp-browser-profile-')}`;
  // This run's Chrome processes: [{ pid, ppid, pgid }], or null when ps cannot be read (which fails the control).
  let psError = null;
  const chromes = () => {
    const r = spawnSync('/bin/ps', ['-A', '-o', 'pid=,ppid=,pgid=,command='], { encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024 * 1024, env: { LC_ALL: 'C' } });
    if (r.error || r.status !== 0 || !r.stdout) { psError = r.error?.message ?? `ps exit ${r.status}`; return null; }
    const rows = r.stdout.split('\n').map((l) => l.trim().split(/\s+/)).map(([pid, ppid, pgid, ...cmd]) => ({ pid: +pid, ppid: +ppid, pgid: +pgid, command: cmd.join(' ') }));
    return rows.filter((p) => p.command.includes(marker)).map((p) => ({ pid: p.pid, ppid: p.ppid, pgid: p.pgid, parent_pgid: rows.find((x) => x.pid === p.ppid)?.pgid ?? null }));
  };
  const before = chromes();
  const running = tryDirect('control-tree-stopped', {});
  let seen = [];
  for (let i = 0; i < 400 && seen !== null && seen.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 50));
    seen = chromes();
  }
  const cleanup = await ctx.sup.killAll();
  d = await running;
  await new Promise((r) => setTimeout(r, 300));
  const left = chromes();
  const readable = before !== null && seen !== null && left !== null;
  // Measured, not assumed: the first Chrome process seen is the one the wrapper started; its group is not its parent's.
  const main = readable && seen.length > 0 ? seen.find((p) => p.pgid === p.pid) ?? null : null;
  const ownGroup = main !== null && main.parent_pgid !== null && main.pgid !== main.parent_pgid;
  const found = readable ? seen.filter((p) => cleanup.found?.includes(p.pid)).length : null;
  control('browser-tree-stopped', 'error; this run\'s Chrome, in a process group of its own, found and stopped; nothing left',
    readable ? `${show(d)}, chrome processes before ${before.length}, seen ${seen.length}, in its own group ${ownGroup}, found by the supervisor ${found}, left ${left.length}, cleanup complete ${cleanup.complete}` : `the process table could not be read: ${psError}`,
    readable && before.length === 0 && seen.length > 0 && ownGroup && found === seen.length && cleanup.complete && left.length === 0 && d.status === 'error',
    { block: strip(d), chrome: readable ? { seen, group_leader: main, in_own_group: ownGroup } : null, ps_error: psError });
}
