// The verdicts of the release validation, as pure functions: nothing here reads a file or starts a process.
// The same functions judge the real execution and the controls.
//
// Statuses: pass; fail (the artifact answered and the committed expectation does not match); error, with a
// class: infra, identity, unsupported, incomplete or implementation (the artifact or its wrapper failed to
// answer; never a normative rejection).
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { exitCodeFor } from '../conformance/external.js';

export const EXIT = { PASS: 0, FAIL: 1, USAGE: 2, ERROR: 3, PARTIAL: 4 };

const EXACT_VERSION = /^\d+\.\d+\.\d+$/;
const INFRA_KINDS = new Set(['spawn', 'timeout', 'output_limit']);

// ── A process that ran to completion ─────────────────────────────

/**
 * The one criterion for "this process ran completely", for installers, extraction and the runner: every
 * observation of runProcess and of the supervisor must be clean. Exit 0 alone proves nothing: a process can
 * exit 0 after the output limit or the deadline signalled it. `anyExitCode` is for the runner, whose exit
 * code is compared with its report instead. Returns the problems.
 */
export function processProblems({ observed: o, supervisor: s }, { anyExitCode = false } = {}) {
  const p = [];
  if (o.spawn_error) p.push(`could not start (${o.spawn_error})`);
  if (o.signal !== null) p.push(`ended by ${o.signal}`);
  if (!anyExitCode && o.exit_code !== 0) p.push(`exit code ${o.exit_code}`);
  if (o.timed_out) p.push('reached the backstop deadline of its process');
  if (o.output_limit) p.push('wrote more than the output limit and was stopped; its output is incomplete');
  if (o.cleanup_incomplete) p.push('its pipes did not close; cleanup not confirmed');
  if (o.group_alive_after_exit) p.push('left processes in its group after exiting');
  if (s.deadline_hit) p.push(`the deadline of ${s.deadline_ms} ms was reached and the process tree was stopped`);
  if (s.leaked === null) p.push('the process table could not be read after it exited');
  else if (s.leaked.length > 0) p.push(`${s.leaked.length} descendant process(es) were still alive after it exited`);
  if (s.cleanup && s.cleanup.complete !== true) p.push('the cleanup of the process tree was not confirmed');
  return p;
}

// ── Origin of the npm consumer ───────────────────────────────────

const npmPackages = (manifest) => Object.values(manifest.packages).filter((p) => p.ecosystem === 'npm');
export const npmTarballUrl = (p) => `${p.registry}${p.name}/-/${p.name.split('/').pop()}-${p.version}.tgz`;

/**
 * Static check of the consumer's package.json and, when given, its lock: only exact versions from the one
 * registry, the DCP packages exactly as the manifest names them, each installed once. Returns the problems.
 */
export function scanNpm({ pkg, lock, manifest }) {
  const problems = [];
  const dcp = npmPackages(manifest);
  const registry = dcp[0].registry;
  const allowed = new Set(['name', 'version', 'private', 'description', 'dependencies']);
  for (const k of Object.keys(pkg)) if (!allowed.has(k)) problems.push(`package.json: field ${k} is not allowed in a consumer`);
  const deps = pkg.dependencies ?? {};
  for (const [name, spec] of Object.entries(deps)) {
    if (typeof spec !== 'string' || !EXACT_VERSION.test(spec)) problems.push(`package.json: ${name} must be an exact registry version, not ${JSON.stringify(spec)}`);
  }
  for (const p of dcp) if (deps[p.name] !== p.version) problems.push(`package.json: ${p.name} must be ${p.version}`);
  for (const name of Object.keys(deps)) if (!dcp.some((p) => p.name === name)) problems.push(`package.json: ${name} is not a package of the manifest`);
  if (lock === null) return problems;

  if (lock.lockfileVersion !== 3 || lock.packages === null || typeof lock.packages !== 'object') {
    problems.push('package-lock.json: lockfileVersion 3 with packages is required');
    return problems;
  }
  if (!isDeepStrictEqual(lock.packages['']?.dependencies, deps)) problems.push('package-lock.json: its root dependencies are not those of package.json');
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (key === '') continue;
    if (!key.startsWith('node_modules/')) problems.push(`package-lock.json: ${key} is outside node_modules`);
    if (entry.link) problems.push(`package-lock.json: ${key} is a link`);
    if (typeof entry.resolved !== 'string' || !entry.resolved.startsWith(registry)) problems.push(`package-lock.json: ${key} is not resolved from ${registry}`);
    if (typeof entry.integrity !== 'string' || !entry.integrity.startsWith('sha512-')) problems.push(`package-lock.json: ${key} has no sha512 integrity`);
  }
  for (const p of dcp) {
    const keys = Object.keys(lock.packages).filter((k) => k === `node_modules/${p.name}` || k.endsWith(`/node_modules/${p.name}`));
    if (keys.length !== 1 || keys[0] !== `node_modules/${p.name}`) {
      problems.push(`package-lock.json: ${p.name} must be installed exactly once, at the top (found ${JSON.stringify(keys)})`);
      continue;
    }
    const e = lock.packages[keys[0]];
    if (e.version !== p.version) problems.push(`package-lock.json: ${p.name} is ${e.version}, the manifest says ${p.version}`);
    if (e.integrity !== p.integrity) problems.push(`package-lock.json: the integrity of ${p.name} is not the manifest's`);
    if (e.resolved !== npmTarballUrl(p)) problems.push(`package-lock.json: ${p.name} is resolved from ${e.resolved}`);
  }
  return problems;
}

// ── Origin of the Python consumer ─────────────────────────────────

const PY_LINE = /^([A-Za-z0-9][A-Za-z0-9._-]*)==([A-Za-z0-9.!+_-]+)((?: --hash=sha256:[0-9a-f]{64})+)$/;
const pyName = (n) => n.toLowerCase().replace(/[-_.]+/g, '-');

/** A requirements file of pinned, hashed requirements only. Returns { entries: [{ name, version, hashes }], problems }. */
export function parseRequirements(text, file) {
  const entries = [];
  const problems = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const m = PY_LINE.exec(line);
    if (!m) { problems.push(`${file}: only "name==version --hash=sha256:…" lines are allowed, not ${JSON.stringify(line.slice(0, 80))}`); continue; }
    const name = pyName(m[1]);
    if (entries.some((e) => e.name === name)) problems.push(`${file}: ${name} is pinned twice`);
    entries.push({ name, version: m[2], hashes: m[3].trim().split(' ').map((h) => h.slice('--hash=sha256:'.length)) });
  }
  return { entries, problems };
}

/**
 * Static check of the Python locks: wheel.txt (the published wheel and its runtime dependencies), sdist.txt
 * (the published sdist alone) and build.txt (the build dependencies of the sdist). Every line is a pinned
 * name with sha256 hashes: no path, URL, editable install, option or include. The DCP lines carry exactly
 * the manifest's hash. Returns the problems.
 */
export function scanPython({ wheel, sdist, build, manifest }) {
  const w = manifest.packages['pypi-wheel'];
  const sd = manifest.packages['pypi-sdist'];
  const problems = [];
  const parsed = Object.fromEntries(Object.entries({ 'wheel.txt': wheel, 'sdist.txt': sdist, 'build.txt': build }).map(([file, text]) => {
    const r = parseRequirements(text, file);
    problems.push(...r.problems);
    return [file, r.entries];
  }));
  const dcpLine = (file, p) => {
    const lines = parsed[file].filter((e) => e.name === pyName(p.name));
    if (lines.length !== 1) problems.push(`${file}: ${p.name} must be pinned exactly once`);
    else if (lines[0].version !== p.version || lines[0].hashes.length !== 1 || lines[0].hashes[0] !== p.sha256) problems.push(`${file}: ${p.name} must be ${p.version} with exactly the manifest's hash`);
  };
  dcpLine('wheel.txt', w);
  dcpLine('sdist.txt', sd);
  if (parsed['sdist.txt'].length !== 1) problems.push('sdist.txt: only the published sdist belongs here');
  if (parsed['build.txt'].some((e) => e.name === pyName(w.name))) problems.push(`build.txt: ${w.name} is not a build dependency`);
  if (parsed['build.txt'].length === 0) problems.push('build.txt: the build dependencies of the sdist must be pinned');
  return problems;
}

/**
 * What pip adds to, or rewrites in, an installed distribution is left out of the comparison with the wheel:
 * RECORD (rewritten), INSTALLER and REQUESTED (added), and direct_url.json only where a local wheel was
 * installed on purpose. Anything else that differs is a problem of compareTrees.
 */
export function pythonTreeView(tree, { installed = false, directUrl = false } = {}) {
  const out = new Map();
  for (const [rel, hash] of tree) {
    const m = /^[^/]+\.dist-info\/([^/]+)$/.exec(rel);
    if (m && (m[1] === 'RECORD' || (installed && (m[1] === 'INSTALLER' || m[1] === 'REQUESTED' || (directUrl && m[1] === 'direct_url.json'))))) continue;
    out.set(rel, hash);
  }
  return out;
}

/**
 * The wheel built from an sdist against that sdist, both ways: for every top-level package of the wheel, the
 * wheel's files and the sdist's files under it are the same set with the same bytes. A module the build left
 * out, added or changed is a problem. The wheel's *.dist-info is build metadata and is left apart.
 */
export function sdistModuleProblems(wheelTree, sdistTree) {
  const modules = new Map([...wheelTree].filter(([rel]) => !/^[^/]+\.dist-info\//.test(rel)));
  if (modules.size === 0) return ['the built wheel has no module file'];
  const tops = new Set([...modules.keys()].map((rel) => rel.split('/')[0]));
  const source = new Map([...sdistTree].filter(([rel]) => rel.includes('/') && tops.has(rel.split('/')[0])));
  return compareTrees(source, modules).map((m) => m.replace('published, not installed', 'in the sdist, not in the built wheel').replace('installed, not published', 'in the built wheel, not in the sdist').replace('the installed file differs from the published one', 'the built wheel\'s file is not the sdist\'s file'));
}

// ── Origin of the Go consumer ────────────────────────────────────

/**
 * Go's h1: sha256 over "<sha256 of file>  <name>\n" for every file, sorted by name as Go sorts strings: by
 * their UTF-8 bytes. (JavaScript compares UTF-16 code units, which orders a name with a character above
 * U+FFFF before one with U+E000..U+FFFF.) `files`: Map(name -> sha256 hex).
 */
export function goH1(files) {
  const names = [...files.keys()].sort((a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')));
  if (names.some((n) => n.includes('\n'))) throw new Error('h1 is not defined for a file name with a newline');
  const summary = names.map((n) => `${files.get(n)}  ${n}\n`).join('');
  return `h1:${createHash('sha256').update(summary, 'utf8').digest('base64')}`;
}

/**
 * Static check of the consumer's go.mod and, when given, go.sum: the SDK required once at the manifest's
 * version, no replace, exclude, retract or toolchain directive, and the manifest's h1 in go.sum.
 */
export function scanGo({ mod, sum, manifest }) {
  const g = manifest.packages.go;
  const problems = [];
  const lines = mod.split('\n').map((l) => l.replace(/\/\/.*$/, '').trim()).filter(Boolean);
  for (const l of lines) if (/^(replace|exclude|retract|toolchain|godebug|tool|ignore)\b/.test(l)) problems.push(`go.mod: directive not allowed in a consumer: ${l.slice(0, 80)}`);
  if (lines.some((l) => l.includes('=>'))) problems.push('go.mod: a replacement (=>) is not allowed');
  const sdk = lines.filter((l) => l.replace(/^require\s+/, '').split(/\s+/)[0] === g.name);
  if (sdk.length !== 1 || sdk[0].replace(/^require\s+/, '') !== `${g.name} ${g.version}`) problems.push(`go.mod: ${g.name} must be required once, at exactly ${g.version}`);
  if (sum === null) return problems;
  const sums = sum.split('\n').filter(Boolean);
  for (const l of sums) if (!/^\S+ \S+ h1:[A-Za-z0-9+/]{43}=$/.test(l)) problems.push(`go.sum: malformed line ${JSON.stringify(l.slice(0, 80))}`);
  const mine = sums.filter((l) => l.startsWith(`${g.name} `));
  if (!mine.includes(`${g.name} ${g.version} ${g.h1}`)) problems.push(`go.sum: no line for ${g.name} ${g.version} with the manifest's h1`);
  if (mine.some((l) => !l.startsWith(`${g.name} ${g.version} `) && !l.startsWith(`${g.name} ${g.version}/go.mod `))) problems.push(`go.sum: another version of ${g.name}`);
  return problems;
}

/** The output of `go version -m <binary>`: the SDK as a dependency at the manifest's version and h1, nothing replaced. */
export function checkGoBuildInfo(text, manifest) {
  const g = manifest.packages.go;
  const problems = [];
  const rows = text.split('\n').map((l) => l.trim().split(/\s+/));
  if (rows.some((r) => r[0] === '=>')) problems.push('the binary was built with a replaced module');
  const deps = rows.filter((r) => r[0] === 'dep' && r[1] === g.name);
  if (deps.length !== 1) problems.push(`the binary does not list ${g.name} exactly once as a dependency`);
  else if (deps[0][2] !== g.version || deps[0][3] !== g.h1) problems.push(`the binary was built with ${g.name} ${deps[0][2]} ${deps[0][3]}, not ${g.version} ${g.h1}`);
  return problems;
}

// ── Origin of the Rust consumers ─────────────────────────────────

export const CRATES_IO = 'registry+https://github.com/rust-lang/crates.io-index';

/** The [[package]] entries of a Cargo.lock: [{ name, version, source, checksum }]. */
export function parseCargoLock(text) {
  return text.split(/^\[\[package\]\]$/m).slice(1).map((block) => {
    const field = (k) => new RegExp(`^${k} = "([^"]*)"$`, 'm').exec(block)?.[1] ?? null;
    return { name: field('name'), version: field('version'), source: field('source'), checksum: field('checksum') };
  });
}

/**
 * Static check of a Rust consumer's Cargo.toml and, when given, Cargo.lock: dcp-ai required as exactly the
 * manifest's version with exactly `features`, no path, git, alternative registry, [patch], [replace] or
 * [source]; in the lock, every package but the consumer comes from crates.io with a checksum, and dcp-ai's
 * is the manifest's.
 */
export function scanCargo({ toml, lock, features, manifest }) {
  const c = manifest.packages.crates;
  const problems = [];
  // The consumer's Cargo.toml is not parsed: it must be, line for line (comments and blank lines apart), the one
  // manifest this tool builds. Anything else is refused, however it is spelled (quoted keys, dotted keys, other
  // tables), so no path, git, registry, [patch], [replace] or [source] can be written in any TOML form.
  const want = features.length === 0 ? `${c.name} = "=${c.version}"` : `${c.name} = { version = "=${c.version}", features = [${features.map((f) => `"${f}"`).join(', ')}] }`;
  const expected = ['[package]', 'name = "dcp-ai-conformance-wrapper"', 'version = "0.0.0"', 'edition = "2021"', 'publish = false', '[dependencies]', want, 'serde_json = "1.0"', 'base64 = "0.22"', '[workspace]'];
  const lines = toml.split('\n').map((l) => (l.trimStart().startsWith('#') ? '' : l.trimEnd())).filter(Boolean);
  for (let k = 0; k < Math.max(lines.length, expected.length); k++) {
    if (lines[k] !== expected[k]) {
      problems.push(`Cargo.toml: line ${JSON.stringify((lines[k] ?? '(missing)').slice(0, 80))} where exactly ${JSON.stringify(expected[k] ?? '(nothing more)')} is required`);
      break;
    }
  }
  if (lock === null) return problems;
  const pkgs = parseCargoLock(lock);
  if (pkgs.filter((p) => p.source === null).length !== 1) problems.push('Cargo.lock: exactly one package without a source (the consumer) is expected');
  for (const p of pkgs) {
    if (p.source !== null && (p.source !== CRATES_IO || !/^[0-9a-f]{64}$/.test(p.checksum ?? ''))) problems.push(`Cargo.lock: ${p.name} ${p.version} is not from crates.io with a checksum`);
  }
  const dcp = pkgs.filter((p) => p.name === c.name);
  if (dcp.length !== 1 || dcp[0].version !== c.version || dcp[0].source !== CRATES_IO || dcp[0].checksum !== c.sha256) problems.push(`Cargo.lock: ${c.name} must be ${c.version} from crates.io with the manifest's checksum, once`);
  return problems;
}

/** `cargo metadata` of a consumer: where dcp-ai really comes from and which of its features are compiled. */
export function checkCargoMetadata(meta, { features, manifest, within }) {
  const c = manifest.packages.crates;
  const problems = [];
  const dcp = meta.packages.filter((p) => p.name === c.name);
  if (dcp.length !== 1) return [`cargo metadata lists ${c.name} ${dcp.length} times`];
  const [pkg] = dcp;
  if (pkg.version !== c.version) problems.push(`cargo resolved ${c.name} ${pkg.version}, not ${c.version}`);
  if (pkg.source !== CRATES_IO) problems.push(`cargo takes ${c.name} from ${pkg.source ?? 'a path'}, not crates.io`);
  if (!pkg.manifest_path.startsWith(within + '/')) problems.push(`cargo compiles ${c.name} from ${pkg.manifest_path}, outside the execution`);
  for (const p of meta.packages) if (p.source !== CRATES_IO && p.id !== meta.resolve.root) problems.push(`cargo takes ${p.name} from ${p.source ?? 'a path'}`);
  const node = meta.resolve.nodes.find((n) => n.id === pkg.id);
  const got = (node?.features ?? []).filter((f) => f !== 'default').sort();
  const extra = got.filter((f) => !features.includes(f) && f === 'otlp');
  if (features.some((f) => !got.includes(f)) || extra.length) problems.push(`cargo compiles ${c.name} with features ${JSON.stringify(got)}; this lane requires ${JSON.stringify(features)}${features.includes('otlp') ? '' : ' and no otlp'}`);
  return problems;
}

/** Compares two trees given as Map(relative path -> sha256, or 'symlink'). Returns the problems. */
export function compareTrees(published, installed) {
  const problems = [];
  for (const [rel, hash] of published) {
    if (hash === 'symlink') problems.push(`${rel}: a symbolic link in the published archive`);
    else if (!installed.has(rel)) problems.push(`${rel}: published, not installed`);
    else if (installed.get(rel) !== hash) problems.push(`${rel}: the installed file differs from the published one`);
  }
  for (const [rel, hash] of installed) {
    if (hash === 'symlink') problems.push(`${rel}: a symbolic link in the installed tree`);
    else if (!published.has(rel)) problems.push(`${rel}: installed, not published`);
  }
  return problems;
}

/** expected (manifest), observed (computed here from the downloaded bytes), installer (lock): all three must agree. */
export function assessIdentity({ expected, observed, installer }) {
  const problems = [];
  if (observed !== expected) problems.push(`the downloaded archive is ${observed}, the manifest expects ${expected}`);
  if (installer !== expected) problems.push(`the installer recorded ${installer}, the manifest expects ${expected}`);
  return problems;
}

// ── One cell: one runner report ──────────────────────────────────

/**
 * expected: { argv, plan: { catalog_sha256, fixtures, suites: [{ id, cases: [id] }], informative: [id] }, timeout_ms }
 * observed: { existed_before, started, finished (ms, this host's clock around the runner process), process
 *             (runProcess's observation of the runner), supervisor, report_text (or null), seen_run_ids }
 *
 * A report counts only if it is this execution's: a path that did not exist, a run inside the observed
 * interval with an id not seen before, the argv, catalog, fixtures, selection and case ids that were asked,
 * and a status that agrees with the runner's exit code. Then its content decides pass, fail or error.
 */
export function assessCell({ expected, observed }) {
  const problems = [];
  const add = (cls, reason) => problems.push({ class: cls, reason });
  const failed = (info = {}) => ({ status: 'error', class: problems[0].class, reasons: problems.map((p) => p.reason), ...info });
  const { process: proc, supervisor: sup } = observed;

  if (observed.existed_before) add('incomplete', 'the report path existed before the runner started');
  // A signal is judged below, against the report: it is first of all a report that cannot be this run's verdict.
  for (const m of processProblems({ observed: { ...proc, signal: null }, supervisor: sup }, { anyExitCode: true })) add('infra', `the runner: ${m}`);

  let report = null;
  if (observed.report_text === null) add('incomplete', 'the runner wrote no report');
  else {
    try { report = JSON.parse(observed.report_text); } catch { add('incomplete', 'the report is not JSON'); }
    if (report === null || typeof report !== 'object' || Array.isArray(report)) { report = null; add('incomplete', 'the report is not an object'); }
  }
  if (!report) return failed();

  const info = { run_id: typeof report.run?.id === 'string' ? report.run.id : null, report_status: report.status ?? null };
  if (report.status === 'incomplete') add('incomplete', 'the report is the placeholder the runner writes before running');
  if (info.run_id === null) add('incomplete', 'the report has no run id');
  else if (observed.seen_run_ids.has(info.run_id)) add('incomplete', `run id ${info.run_id} was already reported in this campaign`);
  const t0 = Date.parse(report.run?.started_at);
  const t1 = Date.parse(report.run?.finished_at);
  if (report.status !== 'incomplete' && !(t0 >= observed.started && t1 >= t0 && t1 <= observed.finished)) {
    add('incomplete', 'the run of the report is not inside the interval in which the runner was observed (a report of another execution)');
  }
  if (problems.length) return failed(info);

  if (report.error) {
    add('infra', `the runner stopped before running: ${report.error.kind}: ${String(report.error.message).slice(0, 300)}`);
    return failed(info);
  }
  const { plan } = expected;
  if (!isDeepStrictEqual(report.implementation?.argv, expected.argv)) add('incomplete', 'the report is for another implementation argv');
  if (report.run.timeout_ms !== expected.timeout_ms) add('incomplete', `the report is for timeout ${report.run.timeout_ms} ms, not ${expected.timeout_ms}`);
  if (report.kit?.catalog_sha256 !== plan.catalog_sha256) add('incomplete', 'the report is for another catalog (kit.catalog_sha256)');
  if (!isDeepStrictEqual(report.kit?.fixtures_sha256, plan.fixtures)) add('incomplete', 'the report is for other fixtures (kit.fixtures_sha256)');
  const wantSuites = plan.suites.map((s) => s.id);
  const suites = Array.isArray(report.suites) ? report.suites : [];
  if (!isDeepStrictEqual(report.selection, wantSuites) || !isDeepStrictEqual(suites.map((s) => s?.id), wantSuites)) {
    add('incomplete', 'the suites of the report are not the selection that was asked');
  } else {
    for (const [i, s] of suites.entries()) {
      const got = (Array.isArray(s.cases) ? s.cases : []).map((c) => c?.id);
      for (const id of plan.suites[i].cases) {
        const n = got.filter((g) => g === id).length;
        if (n !== 1) add('incomplete', `case ${id}: ${n === 0 ? 'no result' : `${n} results`} in the report`);
      }
      for (const id of got) if (!plan.suites[i].cases.includes(id)) add('incomplete', `case ${JSON.stringify(id)} was not asked`);
    }
  }
  if (proc.signal !== null || proc.exit_code !== exitCodeFor(report.status)) {
    add('incomplete', `the runner exited with ${proc.exit_code} (signal ${proc.signal}) and its report says ${report.status}`);
  }
  if (problems.length) return failed(info);

  // Every case has a status its class allows, and every count of the report is the count of its cases: per
  // suite and overall, `executed` included, as the kit computes them. An informative case (delegation) is
  // counted apart and never stands in for a normative one.
  const informative = new Set(plan.informative ?? []);
  const zero = () => ({ cases: 0, executed: 0, pass: 0, fail: 0, error: 0 });
  const KEYS = Object.keys(zero());
  const sameTotals = (a, b) => a !== null && typeof a === 'object' && KEYS.every((k) => a[k] === b[k]);
  const totals = zero();
  let informativeErrors = 0;
  for (const s of suites) {
    const t = zero();
    let infoErrors = 0;
    for (const c of s.cases) {
      if (informative.has(c.id)) {
        if (c.status === 'error') infoErrors++;
        else if (c.status !== 'informative') add('incomplete', `case ${c.id}: status ${JSON.stringify(c.status)} is not allowed for an informative case`);
      } else if (c.status === 'pass' || c.status === 'fail' || c.status === 'error') {
        t.cases++;
        t[c.status]++;
        if (c.status !== 'error') t.executed++;
      } else add('incomplete', `case ${c.id}: status ${JSON.stringify(c.status)} is not allowed for a normative case`);
    }
    if (!sameTotals(s.totals, t)) add('incomplete', `suite ${s.id}: its totals do not match its cases`);
    if (s.status !== (t.error || infoErrors ? 'error' : t.fail ? 'fail' : 'pass')) add('incomplete', `suite ${s.id}: its status does not match its cases`);
    for (const k of KEYS) totals[k] += t[k];
    informativeErrors += infoErrors;
  }
  if (!sameTotals(report.totals, totals)) add('incomplete', 'the totals of the report do not match its cases');
  const derived = totals.error || informativeErrors || totals.executed === 0 ? 'error' : totals.fail ? 'fail' : 'pass';
  if (report.status !== derived) add('incomplete', `the report says ${JSON.stringify(report.status)} and its cases say ${derived}`);
  info.totals = totals;
  const cases = suites.flatMap((s) => s.cases);
  const wrapper = report.implementation.observed ?? {};
  info.wrapper = { exit_code: wrapper.exit_code ?? null, signal: wrapper.signal ?? null, timed_out: wrapper.timed_out ?? null };
  if (problems.length) return failed(info);

  if (derived === 'error') {
    const kinds = [...new Set(cases.filter((c) => c.status === 'error').map((c) => c.kind))];
    info.error_kinds = kinds;
    const cls = kinds.some((k) => INFRA_KINDS.has(k)) ? 'infra' : kinds.length > 0 && kinds.every((k) => k === 'unsupported') ? 'unsupported' : 'implementation';
    add(cls, `the runner reports an error (${kinds.join(', ') || 'no case executed'})`);
    return failed(info);
  }
  if (wrapper.exit_code !== 0 || wrapper.signal !== null || wrapper.timed_out !== false) {
    add('incomplete', 'the report says pass or fail for a wrapper that did not exit cleanly');
    return failed(info);
  }
  if (derived === 'fail') return { status: 'fail', ...info, failed: cases.filter((c) => c.status === 'fail').map((c) => c.id) };
  return { status: 'pass', ...info };
}

// ── Blocks: evidence that is not a catalog cell ───────────────────
//
// npm-cli has no catalog: its evidence is the four CLI suites and their negative control. npm-wasm-browser
// adds the direct sections. Each is a block of the lane, judged here with the same rule as a cell: it counts
// only if it is this execution's, complete, with the expected ids exactly once.

const blockError = (problems, info = {}) => ({ status: 'error', class: problems[0].class, reasons: problems.map((p) => p.reason), ...info });

/** Top-level results and the summary of `node --test --test-reporter=tap`. A test's own subtests are indented. */
export function parseTap(text) {
  const lines = text.split('\n');
  const results = [];
  lines.forEach((line, i) => {
    const m = /^(ok|not ok) \d+ - (.*)$/.exec(line);
    if (!m) return;
    const d = / # (SKIP|TODO)\b.*$/i.exec(m[2]);
    const end = lines.findIndex((l, j) => j > i && /^(ok |not ok |# Subtest: |# tests )/.test(l));
    const block = lines.slice(i + 1, end === -1 ? undefined : end).join('\n');
    results.push({ ok: m[1] === 'ok', name: d ? m[2].slice(0, d.index) : m[2], directive: d ? d[1].toUpperCase() : null, assertion: /code: 'ERR_ASSERTION'/.test(block) });
  });
  const count = (name) => {
    const found = lines.filter((l) => l.startsWith(`# ${name} `));
    return found.length === 1 && /^\d+$/.test(found[0].slice(name.length + 3)) ? Number(found[0].slice(name.length + 3)) : null;
  };
  return { results, totals: Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map((k) => [k, count(k)])) };
}

/**
 * The four CLI suites against the installed CLI. expected: { tests: [name] }; observed: { process, supervisor,
 * tap }. Pass: every expected test exactly once and ok, nothing else, nothing skipped, cancelled or todo, the
 * summary agreeing, exit 0. A missing, repeated, unknown or skipped test never credits anything.
 */
export function assessCliSuites({ expected, observed }) {
  const problems = [];
  const add = (cls, reason) => problems.push({ class: cls, reason });
  for (const m of processProblems({ observed: { ...observed.process, signal: null }, supervisor: observed.supervisor }, { anyExitCode: true })) add('infra', `the test process: ${m}`);
  if (observed.process.signal !== null) add('incomplete', `the test process ended by ${observed.process.signal}`);
  const { results, totals } = parseTap(observed.tap);
  const info = { totals, failed: results.filter((r) => !r.ok).map((r) => r.name) };
  if (Object.values(totals).some((v) => v === null)) add('incomplete', 'the TAP output has no complete summary (the run did not finish)');
  for (const name of expected.tests) {
    const n = results.filter((r) => r.name === name).length;
    if (n !== 1) add('incomplete', `test ${JSON.stringify(name)}: ${n === 0 ? 'no result' : `${n} results`}`);
  }
  for (const r of results) {
    if (!expected.tests.includes(r.name)) add('incomplete', `test ${JSON.stringify(r.name)} is not an expected test`);
    if (r.directive) add('incomplete', `test ${JSON.stringify(r.name)} was ${r.directive}: it proves nothing`);
  }
  if (totals.cancelled || totals.skipped || totals.todo) add('incomplete', `cancelled ${totals.cancelled}, skipped ${totals.skipped}, todo ${totals.todo}`);
  const failed = results.filter((r) => !r.ok);
  if (totals.tests !== expected.tests.length || totals.tests !== results.length || totals.fail !== failed.length || totals.pass !== results.length - failed.length) {
    add('incomplete', 'the TAP summary does not match its results or the expected number of tests');
  }
  if (observed.process.exit_code !== (failed.length ? 1 : 0)) add('incomplete', `the test process exited with ${observed.process.exit_code} and its output has ${failed.length} failed test(s)`);
  if (problems.length) return blockError(problems, info);
  if (failed.length === 0) return { status: 'pass', ...info };
  if (failed.every((r) => r.assertion)) return { status: 'fail', ...info };
  return blockError([{ class: 'implementation', reason: 'a test failed on something other than an assertion' }], info);
}

/**
 * The kit's negative control (cli/__tests__/negative-control.mjs) against the installed CLI. expected: { tests,
 * inverted, cli_root }; observed: { process, supervisor, stdout }. Its own verdict is not taken on trust: its
 * output must show exactly the inverted cases failing, each on an assertion, and every other expected test
 * passing, for that CLI.
 */
export function assessCliNegative({ expected, observed }) {
  const problems = [];
  const add = (cls, reason) => problems.push({ class: cls, reason });
  for (const m of processProblems({ observed: observed.process, supervisor: observed.supervisor })) add('infra', `the control process: ${m}`);
  const text = observed.stdout.trimEnd();
  const cut = text.lastIndexOf('\n');
  let doc = null;
  try { doc = JSON.parse(text.slice(0, cut)); } catch { add('incomplete', 'the control printed no JSON result'); }
  if (text.slice(cut + 1) !== 'NEGATIVE CONTROL: failed as required') add('incomplete', 'the control did not end with "NEGATIVE CONTROL: failed as required"');
  if (doc === null || typeof doc !== 'object') return blockError(problems.length ? problems : [{ class: 'incomplete', reason: 'the control result is not an object' }]);
  const info = { totals: doc.totals ?? null, failures: doc.failures ?? null };
  const n = expected.tests.length;
  const k = expected.inverted.length;
  if (doc.cli_root !== expected.cli_root) add('incomplete', `the control ran the CLI at ${JSON.stringify(doc.cli_root)}, not the installed one`);
  if (doc.exit_code !== 1 || doc.signal !== null || doc.error !== null) add('incomplete', `the inverted run ended with exit ${doc.exit_code}, signal ${doc.signal}, error ${doc.error}; exit 1 is required`);
  if (!isDeepStrictEqual(doc.totals, { tests: n, pass: n - k, fail: k, cancelled: 0, skipped: 0, todo: 0 })) add('incomplete', `the inverted run's totals are not ${n} tests, ${n - k} passed, ${k} failed, none cancelled or skipped`);
  const failures = Array.isArray(doc.failures) ? doc.failures : [];
  if (!isDeepStrictEqual(failures.map((f) => f?.name).sort(), [...expected.inverted].sort())) add('incomplete', 'the failed tests are not exactly the inverted cases');
  if (failures.some((f) => f?.assertion !== true)) add('incomplete', 'an inverted case failed on something other than an assertion');
  if (expected.inverted.some((name) => !expected.tests.includes(name))) add('incomplete', 'an inverted case is not an expected test');
  if (doc.checks === null || typeof doc.checks !== 'object' || Object.keys(doc.checks).length === 0 || Object.values(doc.checks).some((v) => v !== true)) add('incomplete', 'the control\'s own checks are not all true');
  return problems.length ? blockError(problems, info) : { status: 'pass', ...info };
}

const SERVED = ['dist/index.js', 'dist/experimental-candidate-verify.js', 'dist/experimental-candidate-produce.js', 'pkg/dcp_ai.js', 'pkg/dcp_ai_bg.wasm'];

/**
 * The browser wrapper's own record of one run (--browser-report). expect: { contract, run_id, root, manifest,
 * chrome, served: { path: sha256 }, started, finished, fault? }. Returns the problems: the record must be new,
 * of this run, inside the observed interval, for the installed files, with a browser that answered and was
 * cleaned up.
 */
export function browserRecordProblems({ text, existed_before: existedBefore }, expect) {
  if (existedBefore) return ['the browser record path existed before the run'];
  if (text === null) return ['the wrapper wrote no browser record'];
  let r;
  try { r = JSON.parse(text); } catch { return ['the browser record is not JSON']; }
  if (r === null || typeof r !== 'object') return ['the browser record is not an object'];
  const p = [];
  if (r.schema !== 'dcp-ai-browser-run/1') p.push(`browser record: schema ${r.schema}`);
  if (r.outcome !== 'responded' || r.failure !== null) p.push(`browser record: outcome ${r.outcome}${r.failure ? ` (${String(r.failure).slice(0, 300)})` : ''}`);
  if ((r.fault ?? null) !== (expect.fault ?? null)) p.push(`browser record: fault ${r.fault}`);
  if (r.contract !== expect.contract) p.push(`browser record: contract ${r.contract}, not ${expect.contract}`);
  if (r.run_id !== expect.run_id) p.push('browser record: it is the record of another run (run_id)');
  const t0 = Date.parse(r.started_at);
  const t1 = Date.parse(r.finished_at);
  if (!(t0 >= expect.started && t1 >= t0 && t1 <= expect.finished)) p.push('browser record: not inside the interval in which the process was observed');
  if (r.root !== expect.root) p.push(`browser record: served from ${r.root}, not the installed package`);
  if (r.manifest !== expect.manifest) p.push('browser record: not pinned to the manifest of this execution');
  for (const rel of SERVED) if (r.served_sha256?.[rel] !== expect.served[rel] || !expect.served[rel]) p.push(`browser record: ${rel} served is not the installed file`);
  const b = r.browser ?? {};
  if (b.mode !== 'automatic' || b.executable !== expect.chrome) p.push(`browser record: browser ${b.mode} ${b.executable}, not ${expect.chrome}`);
  if (typeof b.user_agent !== 'string' || b.user_agent === '') p.push('browser record: no user agent was observed');
  if (b.exit === undefined || b.exit === 'not observed' || b.profile_removed !== true || !Array.isArray(b.cleanup?.incomplete) || b.cleanup.incomplete.length > 0) p.push('browser record: the browser exit and cleanup were not confirmed');
  if (r.server?.refused?.length !== 0 || r.server?.outside_token !== 0) p.push('browser record: refused or stray requests');
  return p;
}

/**
 * The direct sections (browser/direct-sections.mjs) against the installed package. expected: { argv (the
 * options it forwards to the wrapper), cases: [{ id, section }], fixtures: { path: sha256 }, browser };
 * observed: { process, supervisor, existed_before, report_text, browser: { text, existed_before }, started,
 * finished, seen_run_ids }. The report has no time of its own: it is tied to this run by the browser record
 * with its run_id, which must lie inside the observed interval.
 */
export function assessDirect({ expected, observed }) {
  const problems = [];
  const add = (cls, reason) => problems.push({ class: cls, reason });
  for (const m of processProblems({ observed: { ...observed.process, signal: null }, supervisor: observed.supervisor }, { anyExitCode: true })) add('infra', `the direct-sections process: ${m}`);
  if (observed.existed_before) add('incomplete', 'the report path existed before the run');
  let report = null;
  if (observed.report_text === null) add('incomplete', 'direct-sections wrote no report');
  else {
    try { report = JSON.parse(observed.report_text); } catch { add('incomplete', 'the report is not JSON'); }
    if (report === null || typeof report !== 'object') { report = null; add('incomplete', 'the report is not an object'); }
  }
  if (!report) return blockError(problems);
  const info = { run_id: typeof report.run_id === 'string' ? report.run_id : null, report_status: report.status ?? null };
  if (report.schema !== 'dcp-ai-browser-direct-report/1') add('incomplete', `report schema ${report.schema}`);
  if (info.run_id === null) add('incomplete', 'the report has no run id');
  else if (observed.seen_run_ids.has(info.run_id)) add('incomplete', `run id ${info.run_id} was already reported in this campaign`);
  if (!isDeepStrictEqual(report.wrapper?.argv, expected.argv)) add('incomplete', 'the report is for other wrapper options');
  if (!isDeepStrictEqual(report.fixtures_sha256, expected.fixtures)) add('incomplete', 'the report is for other fixtures');
  const noAnswer = report.status === 'error';
  // report.wrapper is direct-sections' own observation of the wrapper process it started (Node, not Chrome, whose
  // signals during cleanup are in the browser record). A pass or a fail is credited only to a wrapper that exited
  // 0 without a signal; anything else belongs to a run with no answer.
  const w = report.wrapper ?? {};
  if (!noAnswer && (w.exit !== 0 || (w.signal ?? null) !== null)) add('incomplete', `the report says ${report.status} for a wrapper that ended with exit ${w.exit}, signal ${w.signal}`);
  const record = browserRecordProblems(observed.browser, { ...expected.browser, contract: 'dcp-ai-browser-direct/1', run_id: info.run_id, started: observed.started, finished: observed.finished });
  // A run with no answer has a failed browser record by construction: that is judged below, as an error.
  const tie = noAnswer ? record.filter((m) => /another run|existed before|interval|no browser record|not JSON/.test(m)) : record;
  for (const m of tie) add('incomplete', m);
  if (observed.process.signal !== null || observed.process.exit_code !== ({ pass: 0, fail: 1, error: 3 }[report.status] ?? -1)) {
    add('incomplete', `direct-sections exited with ${observed.process.exit_code} (signal ${observed.process.signal}) and its report says ${report.status}`);
  }
  if (problems.length) return blockError(problems, info);
  if (noAnswer) {
    let failure = null;
    try { failure = JSON.parse(observed.browser.text).failure; } catch { /* no record */ }
    const infra = failure === null || /^no Chrome executable|^cannot start Chrome|deadline/.test(String(failure));
    return blockError([{ class: infra ? 'infra' : 'implementation', reason: `the browser run gave no answer: ${String(failure ?? report.wrapper?.stderr ?? '').slice(0, 300)}` }], info);
  }

  const cases = Array.isArray(report.cases) ? report.cases : [];
  for (const want of expected.cases) {
    const got = cases.filter((c) => c?.id === want.id);
    if (got.length !== 1) add('incomplete', `case ${want.id}: ${got.length === 0 ? 'no result' : `${got.length} results`}`);
    else if (got[0].section !== want.section) add('incomplete', `case ${want.id}: section ${got[0].section}, not ${want.section}`);
    else if (typeof got[0].pass !== 'boolean') add('incomplete', `case ${want.id}: pass is not a boolean`);
  }
  for (const c of cases) if (!expected.cases.some((w) => w.id === c?.id)) add('incomplete', `case ${JSON.stringify(c?.id)} is not an expected case`);
  const sections = {};
  for (const c of cases) {
    const t = (sections[c.section] ??= { cases: 0, pass: 0, fail: 0 });
    t.cases++;
    t[c.pass === true ? 'pass' : 'fail']++;
  }
  const reported = Object.fromEntries(Object.entries(report.sections ?? {}).map(([k, v]) => [k, { cases: v?.cases, pass: v?.pass, fail: v?.fail }]));
  if (!isDeepStrictEqual(reported, sections)) add('incomplete', 'the section totals of the report do not match its cases');
  info.sections = sections;
  info.totals = { cases: cases.length, pass: cases.filter((c) => c.pass === true).length };
  const failed = cases.filter((c) => c.pass !== true);
  const extra = report.extra_results ?? [];
  if (report.status !== (failed.length === 0 && extra.length === 0 ? 'pass' : 'fail')) add('incomplete', `the report says ${report.status} and its cases say otherwise`);
  if (problems.length) return blockError(problems, info);
  if (failed.length === 0 && extra.length === 0) return { status: 'pass', ...info };
  info.failed = failed.map((c) => c.id);
  // An answer that is missing, repeated or not asked is not a verdict of the API: an error, never a discrepancy.
  if (extra.length || failed.some((c) => c.why === 'missing' || c.why === 'duplicate')) return blockError([{ class: 'implementation', reason: 'an answer was missing, repeated or not asked' }], info);
  return { status: 'fail', ...info };
}

// ── The campaign ─────────────────────────────────────────────────

// The controls of one execution, in the order run.mjs produces them. They run on the installed npm SDK, so
// they are required exactly when CONTROL_LANE is selected: one result for each id, nothing else.
export const CONTROL_LANE = 'npm-sdk';
export const REQUIRED_CONTROLS = [
  'positive', 'copy-unaltered', 'case-missing', 'case-duplicate', 'case-unknown-status', 'case-normative-as-informative', 'case-executed-inconsistent',
  'stale-seen-id', 'stale-unseen-id', 'stale-path',
  'campaign-subset', 'cell-missing', 'cell-duplicate', 'control-missing', 'control-duplicate', 'control-unknown', 'control-ok-not-boolean',
  'identity-altered-expected', 'origin-file-dependency', 'origin-lock-resolved-elsewhere', 'origin-sdk-outside-execution',
  'inverted-expectation', 'wrapper-fault', 'runner-timeout', 'nested-deadline', 'leaked-descendant',
  'python-origin-local', 'python-checksum-altered', 'python-package-missing',
  'go-origin-local', 'go-checksum-altered', 'go-package-missing',
  'rust-origin-local', 'rust-checksum-altered', 'rust-package-missing',
];
// Every lane that brings controls, and its controls. A campaign needs exactly the controls of its selected lanes.
export const CONTROL_SETS = {
  [CONTROL_LANE]: REQUIRED_CONTROLS,
  'npm-cli': [
    'cli-test-missing', 'cli-test-duplicate', 'cli-test-unknown', 'cli-test-skipped', 'cli-test-failed', 'cli-late-failure',
    'cli-negative-three-failures', 'cli-negative-not-assertion', 'cli-negative-other-cli',
    'block-missing', 'block-duplicate', 'block-unknown', 'block-status-alone',
  ],
  'npm-wasm-browser': [
    'direct-case-missing', 'direct-case-duplicate', 'direct-case-unknown', 'direct-stale-report', 'direct-stale-browser-record', 'direct-late-failure',
    'browser-missing-chrome', 'direct-fault-duplicate-answer', 'direct-fault-invert-verdict', 'browser-tree-stopped',
  ],
};
export const requiredControls = (lanes, sets = CONTROL_SETS) => Object.entries(sets).filter(([lane]) => lanes.includes(lane)).flatMap(([, ids]) => ids);

/**
 * selection: { lanes: [id], catalogs: [id] }; implemented: Set of lane ids this revision can run;
 * lanes: { id: { status, class?, reasons? } } (install, identity and origin of each selected lane);
 * cells: [{ lane, catalog, status, class? }]; blocks: [{ lane, block, status, class? }], the blocks of each
 * lane being those of the manifest; controls: [{ id, ok }], judged against the controls of the selected lanes.
 *
 * PASS needs every lane of the manifest with every one of its catalogs and blocks, each cell and each block
 * exactly once, and exactly one result with ok === true for every required control and no other control. A
 * lane's own status never stands in for its cells and blocks. A selection without failures is PARTIAL, which is a diagnostic and never exit 0.
 */
export function assessCampaign({ manifest, implemented, selection, lanes, cells, blocks = [], controls, interrupted = false, controlSets = CONTROL_SETS }) {
  const required = requiredControls(selection.lanes, controlSets);
  const reasons = [];
  let error = interrupted;
  let fail = false;
  if (interrupted) reasons.push('the campaign was interrupted');
  const key = (c) => (c !== null && typeof c === 'object' ? `${c.lane} × ${c.catalog}` : null);
  const want = selection.lanes.flatMap((lane) => manifest.lanes[lane].catalogs.filter((c) => selection.catalogs.includes(c)).map((catalog) => ({ lane, catalog })));
  for (const lane of selection.lanes) {
    const l = lanes[lane];
    if (!l) { error = true; reasons.push(`lane ${lane}: not executed`); }
    else if (l.status !== 'pass') { error = true; reasons.push(`lane ${lane}: error ${l.class}: ${(l.reasons ?? []).join('; ')}`); }
  }
  for (const w of want) {
    const n = cells.filter((c) => key(c) === key(w)).length;
    if (n !== 1 && lanes[w.lane]?.status === 'pass') { error = true; reasons.push(`cell ${key(w)}: ${n === 0 ? 'missing' : `reported ${n} times`} (incomplete)`); }
  }
  for (const c of cells) {
    if (key(c) === null || !want.some((w) => key(w) === key(c))) { error = true; reasons.push(`cell ${key(c) ?? JSON.stringify(c)}: not part of the selection (incomplete)`); }
    else if (c.status === 'error') { error = true; reasons.push(`cell ${key(c)}: error ${c.class}`); }
    else if (c.status === 'fail') { fail = true; reasons.push(`cell ${key(c)}: discrepancy`); }
    else if (c.status !== 'pass') { error = true; reasons.push(`cell ${key(c)}: unknown status`); }
  }
  // Blocks: the same rule as cells. They are not a matter of selection: a selected lane owes every block it has.
  const bkey = (b) => (b !== null && typeof b === 'object' ? `${b.lane} : ${b.block}` : null);
  const wantBlocks = selection.lanes.flatMap((lane) => (manifest.lanes[lane].blocks ?? []).map((block) => ({ lane, block })));
  if (!Array.isArray(blocks)) { error = true; reasons.push('blocks: not a list'); blocks = []; }
  for (const w of wantBlocks) {
    const n = blocks.filter((b) => bkey(b) === bkey(w)).length;
    if (n !== 1 && lanes[w.lane]?.status === 'pass') { error = true; reasons.push(`block ${bkey(w)}: ${n === 0 ? 'missing' : `reported ${n} times`} (incomplete)`); }
  }
  for (const b of blocks) {
    if (bkey(b) === null || !wantBlocks.some((w) => bkey(w) === bkey(b))) { error = true; reasons.push(`block ${bkey(b) ?? JSON.stringify(b)}: not a block of the selection (incomplete)`); }
    else if (b.status === 'error') { error = true; reasons.push(`block ${bkey(b)}: error ${b.class}`); }
    else if (b.status === 'fail') { fail = true; reasons.push(`block ${bkey(b)}: discrepancy`); }
    else if (b.status !== 'pass') { error = true; reasons.push(`block ${bkey(b)}: unknown status`); }
  }
  const controlsDue = required.length > 0;
  if (!Array.isArray(controls)) { error = true; reasons.push('controls: not a list'); }
  else {
    const idOf = (c) => (c !== null && typeof c === 'object' ? c.id : undefined);
    for (const id of required) {
      const got = controls.filter((c) => idOf(c) === id);
      if (got.length !== 1) { error = true; reasons.push(`control ${id}: ${got.length === 0 ? 'missing' : `reported ${got.length} times`} (incomplete)`); }
      else if (got[0].ok !== true) { error = true; reasons.push(`control ${id}: did not give its required result`); }
    }
    for (const c of controls) {
      if (!controlsDue || !required.includes(idOf(c))) { error = true; reasons.push(`control ${JSON.stringify(idOf(c))}: not a required control of this selection`); }
    }
  }

  const all = Object.keys(manifest.lanes);
  const notExecuted = [
    ...all.filter((l) => !selection.lanes.includes(l) && implemented.has(l)).map((l) => `lane ${l}`),
    ...selection.lanes.flatMap((l) => manifest.lanes[l].catalogs.filter((c) => !selection.catalogs.includes(c)).map((c) => `cell ${l} × ${c}`)),
    ...all.filter((l) => !implemented.has(l)).map((l) => `lane ${l}: not implemented in this revision`),
    ...Object.keys(controlSets).filter((l) => !selection.lanes.includes(l)).map((l) => `controls of lane ${l}`),
  ];
  const status = error ? 'ERROR' : fail ? 'FAIL' : notExecuted.length > 0 ? 'PARTIAL' : 'PASS';
  if (status === 'PARTIAL') reasons.push('a selection without failures: a diagnostic, not a validation of the six packages');
  return { status, exit_code: EXIT[status], reasons, not_executed: [...new Set(notExecuted)] };
}
