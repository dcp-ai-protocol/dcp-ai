// The Go consumer: the kit's wrapper (main.go, byte for byte) built against the module the proxy serves.
// go.mod and go.sum of the consumer are committed (consumers/go) and used read-only; `fresh` writes new ones
// with `go mod tidy` and keeps them. The go tool is the one given with --go, or the first on the isolated
// PATH; GOTOOLCHAIN=local, so it is never replaced or updated.
import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from '../conformance/external.js';
import { scanGo, goH1, checkGoBuildInfo, compareTrees, assessIdentity } from './assess.mjs';
import { HERE, WRAPPERS, INSTALL_DEADLINE_MS, Stop, createInstall, findTool, isolatedEnv, treeOf, treeDigest, isInside } from './lanes.mjs';

const TEMPLATE = path.join(HERE, 'consumers', 'go');
const UNZIP = '/usr/bin/unzip';
const read = (f) => fs.readFileSync(f, 'utf8');

export async function installGo({ run, sup, manifest, resolution, remainingMs, tools }) {
  const pkg = manifest.packages.go;
  const consumer = path.join(run, 'consumers', 'go');
  const artifacts = path.join(run, 'artifacts', 'go');
  const locked = resolution === 'locked';
  const { result, phase, exec, settle } = createInstall({ run, sup, remainingMs, resolution });
  let go;
  let env;
  const goRun = (log, args, cwd = consumer, deadlineMs) => exec(`go-${log}`, [go, ...args], { cwd, env, deadlineMs });

  return settle(async () => {
    await phase('origin-static', async () => {
      const mod = locked ? read(path.join(TEMPLATE, 'go.mod')) : `module dcp-ai-release-validation/go-consumer\n\ngo 1.25.0\n\nrequire ${pkg.name} ${pkg.version}\n`;
      const sum = locked ? read(path.join(TEMPLATE, 'go.sum')) : null;
      const problems = scanGo({ mod, sum, manifest });
      if (problems.length) throw new Stop('identity', problems);
      go = findTool('go', tools.go, '--go');
      for (const d of [consumer, artifacts, path.join(run, 'go', 'download')]) fs.mkdirSync(d, { recursive: true });
      // GOENV=off: no user configuration file. GOWORK=off: no workspace. -modcacherw only makes the module cache removable.
      env = isolatedEnv(run, {
        PATH: `${path.dirname(go)}:${isolatedEnv(run).PATH}`,
        GOPATH: path.join(run, 'go', 'path'), GOMODCACHE: path.join(run, 'go', 'modcache'), GOCACHE: path.join(run, 'go', 'cache'),
        GOPROXY: pkg.registry.replace(/\/$/, ''), GOSUMDB: 'sum.golang.org', GOENV: 'off', GOWORK: 'off', GOTOOLCHAIN: 'local', GOFLAGS: '-modcacherw',
      });
      fs.writeFileSync(path.join(consumer, 'go.mod'), mod);
      if (sum !== null) fs.writeFileSync(path.join(consumer, 'go.sum'), sum);
      fs.copyFileSync(path.join(WRAPPERS, 'go', 'main.go'), path.join(consumer, 'main.go'));
      // The architecture go builds for is the go tool's, which need not be the host's or Node's: recorded, and the
      // lane validates a binary of that architecture only.
      const goEnv = JSON.parse(await goRun('env', ['env', '-json', 'GOOS', 'GOARCH', 'GOHOSTOS', 'GOHOSTARCH', 'GOVERSION', 'GOROOT']));
      result.toolchain = { go, version: (await goRun('version', ['version'])).trim(), ...goEnv, node_arch: process.arch };
      return { wrapper_sha256: sha256(fs.readFileSync(path.join(consumer, 'main.go'))) };
    });

    const pk = { name: pkg.name, version: pkg.version, registry: pkg.registry, archive: null, identity: { expected: pkg.h1, observed: null, installer: null } };
    result.packages.go = pk;
    let info;
    // Outside any module, so there is no go.sum to trust: go checks the module against the checksum database.
    await phase('download', async () => {
      info = JSON.parse(await goRun('download', ['mod', 'download', '-json', `${pkg.name}@${pkg.version}`], path.join(run, 'go', 'download'), INSTALL_DEADLINE_MS));
      if (info.Error) throw new Stop('infra', [`go mod download: ${info.Error}`]);
      pk.archive = path.join(artifacts, path.basename(info.Zip));
      fs.copyFileSync(info.Zip, pk.archive);
      pk.archive_sha256 = sha256(fs.readFileSync(pk.archive));
      pk.identity.installer = info.Sum;
      return {};
    });

    // h1 computed here over the files of the downloaded zip, and the zip against the directory go compiles from.
    await phase('identity', async () => {
      const dest = path.join(run, 'extracted', 'go');
      fs.mkdirSync(dest, { recursive: true });
      await exec('go-unzip', [UNZIP, '-q', pk.archive, '-d', dest], { cwd: run, env });
      const zipTree = treeOf(dest);
      const prefix = `${pkg.name}@${pkg.version}/`;
      const problems = [];
      if ([...zipTree.keys()].some((n) => !n.startsWith(prefix))) problems.push(`the module zip has an entry outside ${prefix}`);
      if ([...zipTree.values()].includes('symlink')) problems.push('the module zip has a symbolic link');
      pk.identity.observed = goH1(zipTree);
      problems.push(...assessIdentity(pk.identity));
      const dir = fs.realpathSync(info.Dir);
      if (!isInside(dir, run)) problems.push(`go keeps the module in ${dir}, outside the execution`);
      const compiled = treeOf(dir);
      problems.push(...compareTrees(new Map([...zipTree].map(([n, h]) => [n.slice(prefix.length), h])), compiled));
      if (problems.length) throw new Stop('identity', problems);
      pk.installed = { path: dir, files: compiled.size, tree_sha256: treeDigest(compiled), zip_files: zipTree.size };
      return {};
    });

    await phase('build', async () => {
      if (!locked) await goRun('tidy', ['mod', 'tidy'], consumer, INSTALL_DEADLINE_MS);
      const binary = path.join(consumer, 'go-wrapper');
      await goRun('build', ['build', '-mod=readonly', '-o', binary, '.'], consumer, INSTALL_DEADLINE_MS);
      fs.mkdirSync(path.join(run, 'locks', 'go'), { recursive: true });
      for (const f of ['go.mod', 'go.sum']) fs.copyFileSync(path.join(consumer, f), path.join(run, 'locks', 'go', f));
      // What was built, from the files go used: the lock again (fresh wrote it), and the binary's own build information.
      const problems = scanGo({ mod: read(path.join(consumer, 'go.mod')), sum: read(path.join(consumer, 'go.sum')), manifest });
      if (locked && (read(path.join(consumer, 'go.mod')) !== read(path.join(TEMPLATE, 'go.mod')) || read(path.join(consumer, 'go.sum')) !== read(path.join(TEMPLATE, 'go.sum')))) problems.push('go changed go.mod or go.sum in locked mode');
      const buildInfo = await goRun('buildinfo', ['version', '-m', binary]);
      problems.push(...checkGoBuildInfo(buildInfo, manifest));
      if (problems.length) throw new Stop('identity', problems);
      pk.build_info = buildInfo.split('\n').filter((l) => /^\s+(path|mod|dep|=>)\s/.test(l)).map((l) => l.trim().split(/\s+/).join(' '));
      result.paths = { binary, binary_sha256: sha256(fs.readFileSync(binary)), binary_target: `${result.toolchain.GOOS}/${result.toolchain.GOARCH}`, argv: [binary] };
      result.expect_declared = { version: pkg.version, resolved_from: pkg.name };
      return {};
    });
  });
}
