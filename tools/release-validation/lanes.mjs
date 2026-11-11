// Work directory, isolated environment and, per ecosystem, installation, identity and origin.
// Here: what every ecosystem shares, and the npm consumer. Python, Go and Rust are in lanes-*.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT, UsageError, InfraError, sha256, loadPlan, LIMITS } from '../conformance/external.js';
import { EVIDENCE_CONTRACT, EVIDENCE_TIMEOUT_MS, loadEvidencePlan } from '../conformance/external-evidence.js';
import { ADMISSION_CONTRACT, ADMISSION_TIMEOUT_MS, loadAdmissionPlan } from '../conformance/external-admission.js';
import { DELEGATION_CONTRACT, DELEGATION_TIMEOUT_MS, loadDelegationPlan } from '../conformance/external-delegation.js';
import { EFFECTIVE_CONTRACT, EFFECTIVE_TIMEOUT_MS, loadEffectivePlan } from '../conformance/external-effective.js';
import { scanNpm, compareTrees, assessIdentity, processProblems } from './assess.mjs';
import { supervised } from './supervise.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const IMPLEMENTED = new Set(['npm-sdk', 'npm-wasm-node', 'npm-wasm-browser', 'npm-cli', 'pypi-wheel', 'pypi-sdist', 'go', 'crates-default', 'crates-otlp']);
export const WRAPPERS = path.join(REPO_ROOT, 'tools', 'conformance', 'wrappers');
const TAR = '/usr/bin/tar';
export const INSTALL_DEADLINE_MS = 10 * 60 * 1000;
const TOOL_DEADLINE_MS = 2 * 60 * 1000;
const INSTALL_LIMITS = { ...LIMITS, stdoutBytes: 64 * 1024 * 1024 };

const inside = (child, parent) => child === parent || child.startsWith(parent + path.sep);
const read = (file) => fs.readFileSync(file);
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

// ── The plan the runner is expected to report ────────────────────

// The same choice the runner makes: the catalog's contract decides the loader and the default deadline.
const KINDS = new Map([
  [EVIDENCE_CONTRACT, [loadEvidencePlan, EVIDENCE_TIMEOUT_MS]],
  [ADMISSION_CONTRACT, [loadAdmissionPlan, ADMISSION_TIMEOUT_MS]],
  [DELEGATION_CONTRACT, [loadDelegationPlan, DELEGATION_TIMEOUT_MS]],
  [EFFECTIVE_CONTRACT, [loadEffectivePlan, EFFECTIVE_TIMEOUT_MS]],
]);

/** Catalog hash (computed here from the file), fixture hashes, suite and case ids, and the runner's default deadline. */
export function expectedPlan(catalogFile, root = REPO_ROOT) {
  const raw = read(catalogFile);
  const [load, timeoutMs] = KINDS.get(JSON.parse(raw.toString('utf8')).contract) ?? [loadPlan, LIMITS.timeoutMs];
  const plan = load({ root, catalogFile });
  if (plan.catalog.sha256 !== sha256(raw)) throw new InfraError(`the kit's hash of ${catalogFile} is not the hash of its bytes`);
  return {
    catalog_sha256: sha256(raw),
    fixtures: plan.fixtures,
    suites: plan.suites.map((s) => ({ id: s.id, cases: s.cases.map((c) => c.id) })),
    // Only the delegation loader classifies cases; everywhere else every case is normative.
    informative: plan.suites.flatMap((s) => s.cases.filter((c) => c.class === 'informative').map((c) => c.id)),
    timeout_ms: timeoutMs,
  };
}

// ── Work directory ───────────────────────────────────────────────

/**
 * Creates the directory of one execution. Without `requested` it is a new mkdtemp directory. A requested
 * path must not exist (a symbolic link counts as existing), its parent must, and it must be outside the
 * checkout, so that no package manager finds the repository's configuration.
 */
export function createWorkDir(requested, repoRoot = REPO_ROOT) {
  if (requested === undefined) return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dcp-release-validation-'));
  let parent;
  try { parent = fs.realpathSync(path.dirname(path.resolve(requested))); }
  catch { throw new UsageError(`--work: the parent of ${requested} does not exist`); }
  const dir = path.join(parent, path.basename(path.resolve(requested)));
  if (inside(dir, fs.realpathSync(repoRoot))) throw new UsageError('--work must be outside the checkout');
  try { fs.mkdirSync(dir); }
  catch (e) { throw new UsageError(`--work: ${dir} cannot be created (${e.code}); an existing path is never reused`); }
  return dir;
}

// What an execution installs or downloads again; the report, runner reports, logs, locks and archives stay.
const CONSUMER_DIRS = ['consumers', 'extracted', 'home', 'tmp', 'npm', 'go', 'cargo'];

/**
 * Removes the consumer directories of an execution this process created. `created` is the path createWorkDir
 * returned in this process: a marker file or a path given by someone else authorises nothing.
 */
export function cleanConsumers(created) {
  const removed = [];
  if (fs.realpathSync(created) !== created || !fs.lstatSync(created).isDirectory()) throw new InfraError(`${created} is not the directory this execution created`);
  for (const name of CONSUMER_DIRS) {
    const target = path.join(created, name);
    const st = fs.lstatSync(target, { throwIfNoEntry: false });
    if (!st) continue;
    if (!st.isDirectory()) throw new InfraError(`${target} is not a directory; nothing more is removed`);
    fs.rmSync(target, { recursive: true }); // rmSync does not follow symbolic links inside the tree
    removed.push(name);
  }
  return removed;
}

// ── Environment ──────────────────────────────────────────────────

/** A whole environment built here: nothing is inherited. PATH is this node's directory and the system's. */
export function isolatedEnv(run, extra = {}) {
  return {
    PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: path.join(run, 'home'),
    TMPDIR: path.join(run, 'tmp'),
    LANG: 'C',
    LC_ALL: 'C',
    ...extra,
  };
}

const npmEnv = (run, registry) => isolatedEnv(run, {
  npm_config_userconfig: path.join(run, 'npm', 'userconfig'),
  npm_config_globalconfig: path.join(run, 'npm', 'globalconfig'),
  npm_config_cache: path.join(run, 'npm', 'cache'),
  npm_config_registry: registry,
  npm_config_ignore_scripts: 'true',
  npm_config_audit: 'false',
  npm_config_fund: 'false',
  npm_config_update_notifier: 'false',
});

/** npm's own entry, run with this node: the npm next to the node executable. */
export function findNpm() {
  const dir = path.dirname(process.execPath);
  for (const candidate of [path.join(dir, 'npm'), path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')]) {
    try {
      const real = fs.realpathSync(candidate);
      if (real.endsWith('.js')) return real;
    } catch { /* next */ }
  }
  throw new InfraError(`no npm found next to ${process.execPath}`);
}

// ── Trees ────────────────────────────────────────────────────────

/** Map(relative path -> sha256 of the file, or 'symlink'). `skipTop` names top-level entries to leave out. */
export function treeOf(dir, skipTop = []) {
  const out = new Map();
  const walk = (rel) => {
    for (const name of fs.readdirSync(path.join(dir, rel)).sort()) {
      if (rel === '' && skipTop.includes(name)) continue;
      const r = rel === '' ? name : `${rel}/${name}`;
      const st = fs.lstatSync(path.join(dir, r));
      if (st.isSymbolicLink()) out.set(r, 'symlink');
      else if (st.isDirectory()) walk(r);
      else out.set(r, sha256(read(path.join(dir, r))));
    }
  };
  walk('');
  return out;
}

export const treeDigest = (tree) => sha256(Buffer.from([...tree].map(([rel, h]) => `${rel}\0${h}\n`).join(''), 'utf8'));

// ── Installation steps, shared by every ecosystem ───────────────

export class Stop extends Error {
  constructor(cls, reasons) { super(reasons[0]); this.cls = cls; this.reasons = reasons; }
}

/**
 * A tool the user's machine provides (python, go, cargo): the path given with its option, or the first one
 * on the isolated PATH. Returns its real path. Nothing is installed or updated.
 */
export function findTool(name, explicit, flag) {
  const candidates = explicit !== undefined ? [path.resolve(explicit)] : isolatedEnv('/').PATH.split(':').map((d) => path.join(d, name));
  for (const c of candidates) {
    try {
      const real = fs.realpathSync(c);
      fs.accessSync(real, fs.constants.X_OK);
      if (fs.statSync(real).isFile()) return real;
    } catch { /* next */ }
  }
  throw new Stop('infra', [explicit !== undefined ? `${flag} ${explicit} is not an executable file` : `no ${name} on ${isolatedEnv('/').PATH}; pass ${flag} <path>`]);
}

/**
 * The frame of one installation: phases with status and duration, and `exec`, which runs argv under the
 * supervisor and returns its stdout only if the process ran to completion (processProblems).
 */
export function createInstall({ run, sup, remainingMs, resolution }) {
  const result = { status: 'pass', resolution, phases: [], packages: {}, paths: {} };
  fs.mkdirSync(path.join(run, 'logs'), { recursive: true });
  const phase = async (name, fn) => {
    const t = Date.now();
    try {
      const detail = await fn();
      result.phases.push({ name, status: 'pass', duration_ms: Date.now() - t, ...detail });
    } catch (e) {
      const cls = e instanceof Stop ? e.cls : 'infra';
      result.phases.push({ name, status: 'error', class: cls, reasons: e instanceof Stop ? e.reasons : [e.message], duration_ms: Date.now() - t });
      throw e;
    }
  };
  const exec = async (log, argv, { cwd, env, deadlineMs = TOOL_DEADLINE_MS }) => {
    const left = remainingMs();
    if (left <= 0) throw new Stop('incomplete', ['the campaign deadline was reached']);
    const r = await supervised(sup, argv, { deadlineMs: Math.min(deadlineMs, left), cwd, env, limits: INSTALL_LIMITS });
    fs.writeFileSync(path.join(run, 'logs', `${log}.log`), Buffer.concat([r.stdout, Buffer.from(`\n--- stderr (first ${LIMITS.stderrExcerptBytes} bytes) ---\n${r.observed.stderr_excerpt}`)]));
    const problems = processProblems(r);
    if (problems.length) throw new Stop('infra', [`${log} did not run to completion: ${problems.join('; ')} (logs/${log}.log)`]);
    return r.stdout.toString('utf8');
  };
  /** Lists a .tar.gz, refuses an entry outside `prefix`, and extracts it into a new directory. */
  const untar = async (log, archive, dest, prefix, env) => {
    const listing = (await exec(`${log}-list`, [TAR, '-tzf', archive], { cwd: run, env })).split('\n').filter(Boolean);
    if (listing.some((e) => !e.startsWith(prefix) || e.split('/').includes('..'))) throw new Stop('identity', [`${path.basename(archive)} has an entry outside ${prefix}`]);
    fs.mkdirSync(dest, { recursive: true });
    await exec(`${log}-extract`, [TAR, '-xzf', archive, '-C', dest], { cwd: run, env });
  };
  const settle = async (fn) => {
    try { await fn(); } catch (e) {
      result.status = 'error';
      result.class = e instanceof Stop ? e.cls : 'infra';
      result.reasons = e instanceof Stop ? e.reasons : [e.stack ?? String(e)];
    }
    return result;
  };
  return { result, phase, exec, untar, settle };
}

/** The one new file a download left in `dir` (`before`: its listing before the download). */
export function newFile(dir, before, what) {
  const added = fs.readdirSync(dir).filter((f) => !before.has(f));
  if (added.length !== 1) throw new Stop('infra', [`${what} left ${added.length} files, not one`]);
  return path.join(dir, added[0]);
}

export const isInside = inside;

// ── npm ──────────────────────────────────────────────────────────

/**
 * Installs the three npm packages in <run>/consumers/npm and checks, for each: the archive downloaded now
 * against the manifest and the lock (identity), and every published file against the installed file
 * (archive → tree). Returns { status, class?, reasons?, phases, packages, paths, resolution }.
 */
export async function installNpm({ run, sup, manifest, resolution, remainingMs }) {
  const dcp = Object.entries(manifest.packages).filter(([, p]) => p.ecosystem === 'npm');
  const registry = dcp[0][1].registry;
  const consumer = path.join(run, 'consumers', 'npm');
  const env = npmEnv(run, registry);
  const { result, phase, exec, untar, settle } = createInstall({ run, sup, remainingMs, resolution });
  let npm;
  const npmRun = (log, args, deadlineMs) => exec(log, [process.execPath, npm, ...args], { cwd: consumer, env, deadlineMs });

  return settle(async () => {
    await phase('origin-static', async () => {
      const pkg = json(path.join(HERE, 'consumers', 'npm', 'package.json'));
      const lock = resolution === 'locked' ? json(path.join(HERE, 'consumers', 'npm', 'package-lock.json')) : null;
      const problems = scanNpm({ pkg, lock, manifest });
      if (problems.length) throw new Stop('identity', problems);
      for (const d of ['npm', 'tarballs', 'extracted']) fs.mkdirSync(path.join(run, d), { recursive: true });
      fs.mkdirSync(consumer, { recursive: true });
      fs.copyFileSync(path.join(HERE, 'consumers', 'npm', 'package.json'), path.join(consumer, 'package.json'));
      if (lock) fs.copyFileSync(path.join(HERE, 'consumers', 'npm', 'package-lock.json'), path.join(consumer, 'package-lock.json'));
      npm = findNpm();
      const version = (await npmRun('npm-version', ['--version'])).trim();
      const observedRegistry = (await npmRun('npm-registry', ['config', 'get', 'registry'])).trim();
      if (observedRegistry !== registry) throw new Stop('identity', [`npm would use the registry ${observedRegistry}, not ${registry}`]);
      result.toolchain = { npm: version, npm_entry: npm, registry: observedRegistry };
      return {};
    });

    // The archive is downloaded first, into an empty cache, and hashed here.
    await phase('download', async () => {
      for (const [id, p] of dcp) {
        const before = new Set(fs.readdirSync(path.join(run, 'tarballs')));
        await npmRun(`npm-pack-${id}`, ['pack', `${p.name}@${p.version}`, '--pack-destination', path.join(run, 'tarballs')]);
        const file = newFile(path.join(run, 'tarballs'), before, `npm pack ${p.name}`);
        result.packages[id] = {
          name: p.name, version: p.version, registry: p.registry, archive: file,
          identity: { expected: p.integrity, observed: `sha512-${crypto.createHash('sha512').update(read(file)).digest('base64')}`, installer: null },
        };
      }
      return {};
    });

    await phase('install', async () => {
      await npmRun('npm-install', resolution === 'locked' ? ['ci', '--ignore-scripts'] : ['install', '--ignore-scripts'], INSTALL_DEADLINE_MS);
      fs.copyFileSync(path.join(consumer, 'package-lock.json'), path.join(run, `package-lock.${resolution}.json`));
      return { lock: `package-lock.${resolution}.json`, lock_sha256: sha256(read(path.join(consumer, 'package-lock.json'))) };
    });

    await phase('identity', async () => {
      // The lock npm installed from: the committed one (locked) or the one this resolution produced (fresh).
      const lock = json(path.join(consumer, 'package-lock.json'));
      const problems = scanNpm({ pkg: json(path.join(consumer, 'package.json')), lock, manifest });
      for (const [id, p] of dcp) {
        const pk = result.packages[id];
        pk.identity.installer = lock.packages?.[`node_modules/${p.name}`]?.integrity ?? null;
        problems.push(...assessIdentity(pk.identity).map((m) => `${p.name}: ${m}`));
      }
      if (problems.length) throw new Stop('identity', problems);
      return {};
    });

    // Archive → installed tree: every published file is the installed file, and nothing else is installed.
    await phase('origin-tree', async () => {
      const problems = [];
      for (const [id, p] of dcp) {
        const pk = result.packages[id];
        const dest = path.join(run, 'extracted', id);
        await untar(`npm-tar-${id}`, pk.archive, dest, 'package/', env);
        const installedDir = path.join(consumer, 'node_modules', ...p.name.split('/'));
        if (fs.realpathSync(installedDir) !== installedDir || !inside(installedDir, run)) problems.push(`${p.name}: installed through a link or outside the execution`);
        const published = treeOf(path.join(dest, 'package'));
        const installed = treeOf(installedDir, ['node_modules']);
        problems.push(...compareTrees(published, installed).map((m) => `${p.name}: ${m}`));
        pk.installed = { path: installedDir, files: installed.size, tree_sha256: treeDigest(installed), published_files: published.size, published_tree_sha256: treeDigest(published) };
        if (p.inner) {
          const inner = json(path.join(installedDir, p.inner.file));
          pk.inner = { file: p.inner.file, name: inner.name, version: inner.version, meaning: p.inner.meaning };
          if (inner.name !== p.inner.name || inner.version !== p.inner.version) problems.push(`${p.name}: ${p.inner.file} is ${inner.name} ${inner.version}, the manifest says ${p.inner.name} ${p.inner.version}`);
        }
      }
      if (problems.length) throw new Stop('identity', problems);
      const at = (id, ...rel) => path.join(result.packages[id].installed.path, ...rel);
      result.paths = { sdk_entry: at('npm-sdk', 'dist', 'index.js'), wasm_pkg: at('npm-wasm', 'pkg'), wasm_file: at('npm-wasm', 'pkg', 'dcp_ai_bg.wasm') };
      for (const f of [result.paths.sdk_entry, result.paths.wasm_file]) if (!fs.statSync(f, { throwIfNoEntry: false })?.isFile()) throw new Stop('identity', [`${f} is not in the installed package`]);
      result.paths.wasm_file_sha256 = sha256(read(result.paths.wasm_file));
      return {};
    });
  });
}

/** The implementation argv of an npm lane: the kit's wrapper, pointed at the installed package. */
export function npmLaneArgv(lane, paths) {
  if (paths.argv) return paths.argv; // Python, Go and Rust installations give their argv
  if (lane === 'npm-sdk') return [process.execPath, path.join(WRAPPERS, 'ts-sdk.mjs'), '--sdk', paths.sdk_entry];
  if (lane === 'npm-wasm-node') return [process.execPath, path.join(WRAPPERS, 'wasm.mjs'), '--pkg', paths.wasm_pkg];
  throw new InfraError(`lane ${lane} is not an npm lane of this revision`);
}

/**
 * What the wrapper declares about itself is a diagnostic and proves no origin; but if it contradicts the
 * identity that was checked, the cell is an identity error. Returns the problems.
 */
export function checkDeclared(lane, declared, npm, run) {
  if (declared === null || typeof declared !== 'object') return ['the wrapper declared nothing about the implementation'];
  const problems = [];
  if (npm.expect_declared) {
    // Python, Go and Rust: the installation says exactly what its wrapper must declare.
    for (const k of ['version', 'resolved_from']) {
      if (declared[k] !== npm.expect_declared[k]) problems.push(`the wrapper declares ${k} ${JSON.stringify(declared[k])}, the checked installation gives ${JSON.stringify(npm.expect_declared[k])}`);
    }
  } else if (lane === 'npm-sdk') {
    const p = npm.packages['npm-sdk'];
    if (declared.version !== p.version) problems.push(`the wrapper declares version ${declared.version}, the checked package is ${p.version}`);
    if (declared.resolved_from !== npm.paths.sdk_entry || !inside(declared.resolved_from, run)) problems.push(`the wrapper loaded ${declared.resolved_from}, not ${npm.paths.sdk_entry}`);
  } else {
    // The WASM wrapper reports the crate metadata of pkg/package.json, not the npm version.
    const p = npm.packages['npm-wasm'];
    if (declared.version !== p.inner.version) problems.push(`the wrapper declares version ${declared.version}, pkg/package.json of the checked package says ${p.inner.version}`);
    const m = /^(.*) \(sha256 ([0-9a-f]{64})\)$/.exec(declared.resolved_from ?? '');
    if (!m || m[1] !== npm.paths.wasm_file || !inside(m[1], run)) problems.push(`the wrapper loaded ${declared.resolved_from}, not ${npm.paths.wasm_file}`);
    else if (m[2] !== npm.paths.wasm_file_sha256) problems.push('the wrapper hashed a .wasm that is not the installed file');
  }
  return problems;
}
