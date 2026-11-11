// The Python consumers: the published wheel (pypi-wheel) and the published sdist, really built here
// (pypi-sdist). Each has its own virtual environments inside the execution.
//
// Locks (consumers/python/<platform>): wheel.txt pins the wheel and its runtime dependencies, sdist.txt the
// sdist, build.txt the build dependencies; platform.json names the one interpreter and platform the hashes
// were resolved on. There is one directory per platform, chosen by the interpreter that runs (never by an
// option). On an interpreter or platform without a lock the locked mode is refused, not attempted.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO_ROOT, sha256 } from '../conformance/external.js';
import { scanPython, parseRequirements, pythonTreeView, sdistModuleProblems, compareTrees, assessIdentity } from './assess.mjs';
import { HERE, WRAPPERS, INSTALL_DEADLINE_MS, Stop, createInstall, findTool, newFile, isolatedEnv, treeOf, treeDigest, isInside } from './lanes.mjs';

export const PYTHON_LOCKS = path.join(HERE, 'consumers', 'python');
/** The lock directory of an interpreter: cpython-3.12-linux-x86_64, cpython-3.12-darwin-arm64, … */
export const pythonLockKey = (p) => `${p.implementation.toLowerCase()}-${p.python}-${p.sys_platform}-${p.machine}`;
export const pythonLockKeys = () => fs.readdirSync(PYTHON_LOCKS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const read = (f) => fs.readFileSync(f, 'utf8');
const requirementLine = (e) => `${e.name}==${e.version} --hash=sha256:${e.sha256}`;

/** kind: 'wheel' or 'sdist'. Returns the installation result (see createInstall). */
export async function installPython({ kind, run, sup, manifest, resolution, remainingMs, tools }) {
  const id = `pypi-${kind}`;
  const pkg = manifest.packages[id];
  const index = pkg.registry;
  const FILE_HOST = pkg.files;
  const consumer = path.join(run, 'consumers', id);
  const artifacts = path.join(run, 'artifacts', id);
  const extracted = path.join(run, 'extracted', id);
  // PIP_CONFIG_FILE=os.devnull stops pip from loading any configuration file; --isolated drops the rest.
  const env = isolatedEnv(run, { PIP_CONFIG_FILE: os.devnull });
  const { result, phase, exec, untar, settle } = createInstall({ run, sup, remainingMs, resolution });
  const locked = resolution === 'locked';
  const venvPython = (name) => path.join(consumer, name, 'bin', 'python');
  const py = (log, python, args, deadlineMs) => exec(`${id}-${log}`, [python, '-I', '-B', ...args], { cwd: consumer, env, deadlineMs });
  const pip = (log, python, args, deadlineMs = INSTALL_DEADLINE_MS) => py(log, python, ['-m', 'pip', '--isolated', '--disable-pip-version-check', '--no-input', ...args, '--no-cache-dir', '--index-url', index], deadlineMs);
  const pyJson = async (log, python, code) => JSON.parse(await py(log, python, ['-c', code]));
  const hashOf = (file) => sha256(fs.readFileSync(file));
  /** pip's own record of what it installed (or would install): [{ name, version, url, sha256 }]. */
  const reportOf = (file) => JSON.parse(read(file)).install.map((i) => ({
    name: i.metadata.name.toLowerCase().replace(/[-_.]+/g, '-'), version: i.metadata.version, url: i.download_info.url, sha256: i.download_info.archive_info?.hashes?.sha256 ?? null,
  }));
  const fromIndex = (entries, except = []) => {
    const bad = entries.filter((e) => !except.includes(e.name) && (!e.url.startsWith(FILE_HOST) || !e.sha256));
    if (bad.length) throw new Stop('identity', bad.map((e) => `${e.name} ${e.version} was taken from ${e.url}, not from ${FILE_HOST} with a hash`));
  };
  const makeVenv = async (name, base) => {
    await py(`venv-${name}`, base, ['-m', 'venv', path.join(consumer, name)]);
    const python = venvPython(name);
    const config = (await py(`pip-config-${name}`, python, ['-m', 'pip', 'config', 'list'])).trim();
    if (config !== '') throw new Stop('identity', [`pip would read configuration: ${config.slice(0, 200)}`]);
    return python;
  };
  /** Extracts a wheel with the interpreter's own zipfile module (it refuses absolute and parent paths). */
  const unzipWheel = async (log, python, wheel, dest) => {
    fs.mkdirSync(dest, { recursive: true });
    await py(log, python, ['-m', 'zipfile', '-e', wheel, dest]);
    return treeOf(dest);
  };
  /** The installed distribution against the wheel it was installed from, and where `import dcp_ai` really comes from. */
  const checkInstalled = async (python, wheelTree, directUrl) => {
    const where = await pyJson('origin', python, [
      'import json, sys, site, sysconfig, importlib.metadata, dcp_ai',
      'print(json.dumps({"file": dcp_ai.__file__, "purelib": sysconfig.get_paths()["purelib"], "user_site": bool(site.ENABLE_USER_SITE),',
      ' "path": sys.path, "prefix": sys.prefix, "base_prefix": sys.base_prefix, "version": importlib.metadata.version("dcp-ai")}))',
    ].join('\n'));
    const problems = [];
    const purelib = fs.realpathSync(where.purelib);
    if (!isInside(purelib, run)) problems.push(`site-packages ${purelib} is outside the execution`);
    if (fs.realpathSync(where.file) !== path.join(purelib, 'dcp_ai', '__init__.py')) problems.push(`import dcp_ai loads ${where.file}, not the distribution installed in ${purelib}`);
    if (where.user_site) problems.push('the user site-packages directory is enabled');
    if (where.version !== pkg.version) problems.push(`the installed distribution is ${where.version}, not ${pkg.version}`);
    const base = fs.realpathSync(where.base_prefix);
    for (const entry of where.path.filter(Boolean)) {
      const real = fs.existsSync(entry) ? fs.realpathSync(entry) : entry;
      if (!isInside(real, run) && !isInside(real, base)) problems.push(`sys.path has ${entry}, outside the execution and the interpreter`);
      if (isInside(real, fs.realpathSync(REPO_ROOT))) problems.push(`sys.path has ${entry}, inside the checkout`);
    }
    const tops = new Set([...wheelTree.keys()].map((rel) => rel.split('/')[0]));
    const installed = new Map([...treeOf(purelib)].filter(([rel]) => tops.has(rel.split('/')[0])));
    problems.push(...compareTrees(pythonTreeView(wheelTree), pythonTreeView(installed, { installed: true, directUrl })));
    const direct = [...installed.keys()].find((rel) => rel.endsWith('.dist-info/direct_url.json'));
    if (direct && directUrl) {
      const url = JSON.parse(read(path.join(purelib, direct))).url;
      if (!url.startsWith('file://') || !isInside(decodeURIComponent(new URL(url).pathname), run)) problems.push(`direct_url.json points to ${url}, outside the execution`);
    }
    if (problems.length) throw new Stop('identity', problems);
    result.paths = { python, module_file: where.file, site_packages: purelib, sys_path: where.path, argv: [python, '-I', '-B', path.join(WRAPPERS, 'python_sdk.py')] };
    result.expect_declared = { version: pkg.version, resolved_from: where.file };
    return { files: installed.size, tree_sha256: treeDigest(pythonTreeView(installed, { installed: true, directUrl })), wheel_files: wheelTree.size, wheel_tree_sha256: treeDigest(pythonTreeView(wheelTree)) };
  };
  // What this execution resolved, in the layout of consumers/python/<platform>: the lock a fresh run produces.
  let lockOut = null;
  const saveLock = (name, entries) => fs.writeFileSync(path.join(lockOut, name), entries.map(requirementLine).sort().join('\n') + '\n');

  return settle(async () => {
    let base;
    let lock = null;
    await phase('origin-static', async () => {
      base = findTool('python3', tools.python, '--python');
      for (const d of [consumer, artifacts, extracted]) fs.mkdirSync(d, { recursive: true });
      const me = await pyJson('interpreter', base, 'import json, sys, platform, sysconfig; print(json.dumps({"implementation": platform.python_implementation(), "python": "%d.%d" % sys.version_info[:2], "full": platform.python_version(), "sys_platform": sys.platform, "machine": platform.machine(), "platform": sysconfig.get_platform()}))');
      result.toolchain = { python_path: base, ...me };
      const { full: _full, platform: _platform, ...mine } = me;
      const key = pythonLockKey(mine);
      lockOut = path.join(run, 'locks', 'python', key);
      fs.mkdirSync(lockOut, { recursive: true });
      fs.writeFileSync(path.join(lockOut, 'platform.json'), JSON.stringify(mine, null, 2) + '\n');
      result.toolchain.lock = locked ? `consumers/python/${key}` : null;
      if (!locked) return {};
      const dir = path.join(PYTHON_LOCKS, key);
      if (!/^[a-z0-9._-]+$/.test(key) || !fs.existsSync(path.join(dir, 'platform.json'))) {
        throw new Stop('unsupported', [`there is no Python lock for ${key} (locks: ${pythonLockKeys().join(', ')}). Use --resolution fresh, or --python with an interpreter that has one`]);
      }
      if (JSON.stringify(JSON.parse(read(path.join(dir, 'platform.json')))) !== JSON.stringify(mine)) throw new Stop('identity', [`consumers/python/${key}/platform.json does not describe ${JSON.stringify(mine)}`]);
      lock = { wheel: read(path.join(dir, 'wheel.txt')), sdist: read(path.join(dir, 'sdist.txt')), build: read(path.join(dir, 'build.txt')) };
      const problems = scanPython({ ...lock, manifest });
      if (problems.length) throw new Stop('identity', problems);
      return { lock: `consumers/python/${key}` };
    });

    result.packages[id] = { name: pkg.name, version: pkg.version, registry: index, kind, archive: null, identity: { expected: pkg.sha256, observed: null, installer: null } };
    const pk = result.packages[id];
    const spec = `${pkg.name}==${pkg.version}`;

    if (kind === 'wheel') {
      let python;
      await phase('venv', async () => {
        python = await makeVenv('venv', base);
        result.toolchain.pip = (await py('pip-version', python, ['-m', 'pip', '--version'])).trim();
        return {};
      });
      await phase('download', async () => {
        const before = new Set(fs.readdirSync(artifacts));
        await pip('download', python, ['download', '--no-deps', '--only-binary', ':all:', '--dest', artifacts, spec]);
        pk.archive = newFile(artifacts, before, 'pip download');
        pk.identity.observed = hashOf(pk.archive);
        // Checked before anything is installed from it.
        if (pk.identity.observed !== pkg.sha256) throw new Stop('identity', assessIdentity({ ...pk.identity, installer: pkg.sha256 }));
        return {};
      });
      await phase('install', async () => {
        const report = path.join(consumer, 'install-report.json');
        const req = path.join(consumer, 'requirements.txt');
        if (locked) fs.writeFileSync(req, lock.wheel);
        await pip('install', python, ['install', '--no-compile', '--only-binary', ':all:', '--report', report, ...(locked ? ['--require-hashes', '-r', req] : [spec])]);
        const entries = reportOf(report);
        fromIndex(entries);
        pk.identity.installer = entries.find((e) => e.name === 'dcp-ai')?.sha256 ?? null;
        pk.runtime_dependencies = entries.filter((e) => e.name !== 'dcp-ai').map((e) => `${e.name}==${e.version}`).sort();
        saveLock('wheel.txt', entries);
        fs.copyFileSync(report, path.join(lockOut, 'wheel-install-report.json'));
        return {};
      });
      await phase('identity', async () => {
        const problems = assessIdentity(pk.identity);
        if (problems.length) throw new Stop('identity', problems);
        return {};
      });
      await phase('origin-tree', async () => {
        pk.installed = await checkInstalled(python, await unzipWheel('unzip', python, pk.archive, path.join(extracted, 'wheel')), false);
        return {};
      });
      return;
    }

    // sdist: a build environment with recorded build dependencies, then a clean runtime environment.
    if (path.basename(pkg.file) !== pkg.file || !pkg.file.endsWith('.tar.gz')) throw new Stop('identity', [`the manifest's sdist file name ${pkg.file} is not a plain .tar.gz name`]);
    let builder;
    let python;
    let buildSet;
    const installBuildDeps = async (args) => {
      const report = path.join(consumer, 'build-report.json');
      await pip('build-deps', builder, ['install', '--no-compile', '--only-binary', ':all:', '--report', report, ...args]);
      buildSet = reportOf(report);
      fromIndex(buildSet);
      saveLock('build.txt', buildSet);
    };
    // The sdist is first downloaded as bytes, by a process that unpacks and runs nothing, and its SHA-256 is
    // compared with the manifest. Only bytes that passed are unpacked, and only then does any build backend
    // run, with build dependencies that are recorded (and pinned, in locked mode).
    await phase('download', async () => {
      const file = path.join(artifacts, pkg.file);
      const fetched = JSON.parse(await exec(`${id}-fetch`, [process.execPath, path.join(HERE, 'fetch-pypi.mjs'), index, pkg.name, pkg.file, FILE_HOST, file], { cwd: consumer, env }));
      pk.archive = file;
      pk.archive_url = fetched.url;
      pk.identity.observed = hashOf(file);
      // What the registry declares for the file. A statement of the index, recorded as such; the identity is the hash computed here.
      pk.identity.installer = fetched.declared_sha256;
      pk.identity.installer_meaning = 'sha256 the package index declares for the file';
      return {};
    });
    await phase('identity', async () => {
      const problems = assessIdentity(pk.identity);
      if (problems.length) throw new Stop('identity', problems);
      saveLock('sdist.txt', [{ name: 'dcp-ai', version: pkg.version, sha256: pk.identity.observed }]);
      return {};
    });
    await phase('venv', async () => {
      builder = await makeVenv('build-venv', base);
      python = await makeVenv('venv', base);
      result.toolchain.pip = (await py('pip-version', builder, ['-m', 'pip', '--version'])).trim();
      return {};
    });
    const sdistRoot = () => path.join(extracted, 'sdist', path.basename(pk.archive, '.tar.gz'));
    await phase('build-dependencies', async () => {
      await untar(`${id}-untar`, pk.archive, path.join(extracted, 'sdist'), `${path.basename(pk.archive, '.tar.gz')}/`, env);
      if (locked) {
        const req = path.join(consumer, 'build-requirements.txt');
        fs.writeFileSync(req, lock.build);
        await installBuildDeps(['--require-hashes', '-r', req]);
        return { pinned: true };
      }
      // Fresh: what the verified sdist's own pyproject.toml asks for, read as data (no backend runs), resolved now and recorded.
      const requires = await pyJson('build-requires', builder, `import json, tomllib; print(json.dumps(tomllib.load(open(${JSON.stringify(path.join(sdistRoot(), 'pyproject.toml'))}, "rb"))["build-system"]["requires"]))`);
      await installBuildDeps(requires);
      return { pinned: false, requires };
    });
    let built;
    await phase('build', async () => {
      const out = path.join(artifacts, 'built');
      fs.mkdirSync(out);
      await pip('build', builder, ['wheel', '--no-index', '--no-deps', '--no-build-isolation', '--wheel-dir', out, pk.archive]);
      built = newFile(out, new Set(), 'pip wheel');
      pk.built_wheel = {
        file: built, sha256: hashOf(built), build_dependencies: buildSet.map((e) => `${e.name}==${e.version}`).sort(), build_dependencies_pinned: locked,
        note: 'Built here from the published sdist. Its hash is not a published identity and is not expected to be reproducible across build dependencies or platforms.',
      };
      return {};
    });
    await phase('install', async () => {
      const report = path.join(consumer, 'install-report.json');
      const req = path.join(consumer, 'requirements.txt');
      const local = `dcp-ai @ ${new URL(`file://${built}`).href}`;
      if (locked) {
        const deps = parseRequirements(lock.wheel, 'wheel.txt').entries.filter((e) => e.name !== 'dcp-ai');
        fs.writeFileSync(req, [`${local} --hash=sha256:${pk.built_wheel.sha256}`, ...deps.map((e) => `${e.name}==${e.version} ${e.hashes.map((h) => `--hash=sha256:${h}`).join(' ')}`)].join('\n') + '\n');
      }
      await pip('install', python, ['install', '--no-compile', '--only-binary', ':all:', '--report', report, ...(locked ? ['--require-hashes', '-r', req] : [built])]);
      const entries = reportOf(report);
      fromIndex(entries, ['dcp-ai']);
      const mine = entries.find((e) => e.name === 'dcp-ai');
      if (!mine || !mine.url.startsWith('file://') || mine.sha256 !== pk.built_wheel.sha256) throw new Stop('identity', ['pip did not install the wheel built here from the published sdist']);
      pk.runtime_dependencies = entries.filter((e) => e.name !== 'dcp-ai').map((e) => `${e.name}==${e.version}`).sort();
      return {};
    });
    await phase('origin-tree', async () => {
      const wheelTree = await unzipWheel('unzip', python, built, path.join(extracted, 'built-wheel'));
      // The built wheel against the verified sdist, both ways: the same module files, the same bytes.
      const problems = sdistModuleProblems(wheelTree, treeOf(sdistRoot()));
      if (problems.length) throw new Stop('identity', problems);
      const modules = [...wheelTree.keys()].filter((rel) => !rel.includes('.dist-info/')).length;
      pk.built_wheel.module_files_equal_to_sdist = modules;
      pk.installed = await checkInstalled(python, wheelTree, true);
      return {};
    });
  });
}
