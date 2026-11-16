// The Rust consumers: the kit's wrapper (src/main.rs, byte for byte) built against the crate crates.io
// serves, once with default features (crates-default) and once with the otlp feature (crates-otlp). Each
// has its own Cargo.toml and Cargo.lock (consumers/rust-default, consumers/rust-otlp), its own CARGO_HOME
// and its own target directory.
//
// cargo is the one given with --cargo, or the first on the isolated PATH, with the rustc next to it. A
// rustup proxy is refused: with the clean HOME of the execution it would not find its toolchain, and it
// must not install or switch one.
import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from '../conformance/external.js';
import { scanCargo, parseCargoLock, checkCargoMetadata, compareTrees, assessIdentity } from './assess.mjs';
import { HERE, WRAPPERS, Stop, createInstall, findTool, isolatedEnv, treeOf, treeDigest, isInside } from './lanes.mjs';

const BUILD_DEADLINE_MS = 20 * 60 * 1000;
const read = (f) => fs.readFileSync(f, 'utf8');
export const RUST_FEATURES = { 'crates-default': [], 'crates-otlp': ['otlp'] };
const BINARY = 'dcp-ai-conformance-wrapper';

export async function installRust({ lane, run, sup, manifest, resolution, remainingMs, tools }) {
  const pkg = manifest.packages.crates;
  const features = RUST_FEATURES[lane];
  const name = lane.replace('crates', 'rust'); // rust-default, rust-otlp
  const template = path.join(HERE, 'consumers', name);
  const consumer = path.join(run, 'consumers', name);
  const home = path.join(run, 'cargo', `${name}-home`);
  const target = path.join(run, 'cargo', `${name}-target`);
  const locked = resolution === 'locked';
  const declared = `crates.io ${pkg.name} =${pkg.version} (registry consumer ${name})`;
  const { result, phase, exec, untar, settle } = createInstall({ run, sup, remainingMs, resolution });
  let cargo;
  let env;
  const cargoRun = (log, args, deadlineMs = BUILD_DEADLINE_MS) => exec(`${name}-${log}`, [cargo, ...args], { cwd: consumer, env, deadlineMs });

  return settle(async () => {
    await phase('origin-static', async () => {
      const toml = read(path.join(template, 'Cargo.toml'));
      const lock = locked ? read(path.join(template, 'Cargo.lock')) : null;
      const problems = scanCargo({ toml, lock, features, manifest });
      // cargo reads .cargo/config.toml from every directory above the consumer.
      for (let d = consumer; d !== path.dirname(d); d = path.dirname(d)) {
        for (const f of ['config', 'config.toml']) if (fs.existsSync(path.join(d, '.cargo', f))) problems.push(`${path.join(d, '.cargo', f)} would configure cargo`);
      }
      if (problems.length) throw new Stop('identity', problems);
      cargo = findTool('cargo', tools.cargo, '--cargo');
      if (path.basename(cargo).startsWith('rustup')) throw new Stop('infra', [`${tools.cargo ?? 'cargo'} is a rustup proxy; pass --cargo with the toolchain's own cargo (rustup which cargo)`]);
      const rustc = path.join(path.dirname(cargo), 'rustc');
      if (!fs.existsSync(rustc)) throw new Stop('infra', [`no rustc next to ${cargo}`]);
      for (const d of [path.join(consumer, 'src'), home, path.join(run, 'artifacts', lane)]) fs.mkdirSync(d, { recursive: true });
      env = isolatedEnv(run, {
        PATH: `${path.dirname(cargo)}:${isolatedEnv(run).PATH}`, CARGO_HOME: home, CARGO_TARGET_DIR: target, RUSTC: rustc, CARGO_TERM_COLOR: 'never',
        // Read by the wrapper at compile time (option_env!): what it declares as its source. A label, not a proof.
        DCP_CONFORMANCE_SDK_SOURCE: declared,
      });
      fs.writeFileSync(path.join(consumer, 'Cargo.toml'), toml);
      if (lock !== null) fs.writeFileSync(path.join(consumer, 'Cargo.lock'), lock);
      fs.copyFileSync(path.join(WRAPPERS, 'rust', 'src', 'main.rs'), path.join(consumer, 'src', 'main.rs'));
      result.toolchain = { cargo, rustc, cargo_version: (await cargoRun('cargo-version', ['--version'])).trim(), rustc_version: (await exec(`${name}-rustc-version`, [rustc, '-vV'], { cwd: consumer, env })).trim().split('\n') };
      return { wrapper_sha256: sha256(fs.readFileSync(path.join(consumer, 'src', 'main.rs'))), features };
    });

    const pk = { name: pkg.name, version: pkg.version, registry: pkg.registry, features, archive: null, identity: { expected: pkg.sha256, observed: null, installer: null } };
    result.packages[lane] = pk;
    await phase('download', async () => {
      if (!locked) await cargoRun('generate-lockfile', ['generate-lockfile']);
      await cargoRun('fetch', ['fetch', '--locked']);
      fs.mkdirSync(path.join(run, 'locks', name), { recursive: true });
      fs.copyFileSync(path.join(consumer, 'Cargo.lock'), path.join(run, 'locks', name, 'Cargo.lock'));
      const cache = path.join(home, 'registry', 'cache');
      const found = fs.readdirSync(cache).map((d) => path.join(cache, d, `${pkg.name}-${pkg.version}.crate`)).filter((f) => fs.existsSync(f));
      if (found.length !== 1) throw new Stop('infra', [`cargo fetch left ${found.length} ${pkg.name}-${pkg.version}.crate files`]);
      pk.archive = path.join(run, 'artifacts', lane, path.basename(found[0]));
      fs.copyFileSync(found[0], pk.archive);
      pk.identity.observed = sha256(fs.readFileSync(pk.archive));
      return {};
    });

    let meta;
    await phase('identity', async () => {
      // The lock cargo used (fresh wrote it), checked again, and its checksum for the crate.
      const lock = read(path.join(consumer, 'Cargo.lock'));
      const problems = scanCargo({ toml: read(path.join(consumer, 'Cargo.toml')), lock, features, manifest });
      if (locked && lock !== read(path.join(template, 'Cargo.lock'))) problems.push('cargo changed Cargo.lock in locked mode');
      pk.identity.installer = parseCargoLock(lock).find((p) => p.name === pkg.name)?.checksum ?? null;
      problems.push(...assessIdentity(pk.identity));
      if (problems.length) throw new Stop('identity', problems);
      return {};
    });

    // What cargo really compiles: the source directory it resolved, against the .crate, and the features.
    await phase('origin-tree', async () => {
      meta = JSON.parse(await cargoRun('metadata', ['metadata', '--format-version', '1', '--locked']));
      const problems = checkCargoMetadata(meta, { features, manifest, within: fs.realpathSync(home) });
      const src = path.dirname(meta.packages.find((p) => p.name === pkg.name).manifest_path);
      const dest = path.join(run, 'extracted', lane);
      await untar(`${name}-untar`, pk.archive, dest, `${pkg.name}-${pkg.version}/`, env);
      const published = treeOf(path.join(dest, `${pkg.name}-${pkg.version}`));
      const compiled = treeOf(src, ['.cargo-ok']); // cargo's own marker of a finished extraction
      if (!isInside(fs.realpathSync(src), run)) problems.push(`cargo compiles from ${src}, outside the execution`);
      problems.push(...compareTrees(published, compiled));
      if (problems.length) throw new Stop('identity', problems);
      pk.installed = { path: src, files: compiled.size, tree_sha256: treeDigest(compiled), published_files: published.size, source: meta.packages.find((p) => p.name === pkg.name).source };
      pk.compiled_features = meta.resolve.nodes.find((n) => n.id === meta.packages.find((p) => p.name === pkg.name).id).features;
      return {};
    });

    await phase('build', async () => {
      await cargoRun('build', ['build', '--locked']);
      const binary = path.join(target, 'debug', BINARY);
      if (!fs.existsSync(binary)) throw new Stop('infra', [`cargo build left no ${binary}`]);
      result.paths = { binary, binary_sha256: sha256(fs.readFileSync(binary)), argv: [binary] };
      result.expect_declared = { version: pkg.version, resolved_from: declared };
      return {};
    });
  });
}
