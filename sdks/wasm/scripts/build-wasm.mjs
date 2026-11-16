#!/usr/bin/env node
// Builds pkg/ with wasm-pack from sdks/rust (feature `wasm`, Cargo.lock as is) and maps local build paths out of the
// binary: the Cargo home and the crate source become /cargo and /dcp-ai/sdks/rust in panic locations and other
// embedded paths, so the .wasm carries no builder's home or checkout path. Flags already in CARGO_ENCODED_RUSTFLAGS,
// or else in RUSTFLAGS, are kept in their order; all of them are passed through CARGO_ENCODED_RUSTFLAGS, one argument
// per entry, so a path with spaces stays one argument. With that variable set, Cargo does not read rustflags from its
// config files; this repository defines none. test/release-artifact.mjs checks the result.
//
//   node scripts/build-wasm.mjs web       (npm run build:wasm, the published package)
//   node scripts/build-wasm.mjs nodejs    (npm run build:wasm:node)
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const target = process.argv[2];
if (process.argv.length !== 3 || (target !== 'web' && target !== 'nodejs')) {
  console.error('usage: node scripts/build-wasm.mjs web|nodejs');
  process.exit(2);
}

const wasmDir = fileURLToPath(new URL('..', import.meta.url));
const crateDir = realpathSync(join(wasmDir, '..', 'rust'));
// Cargo runs in crateDir and reads a relative CARGO_HOME from there (an empty one counts as unset).
const cargoHome = process.env.CARGO_HOME ? resolve(crateDir, process.env.CARGO_HOME) : join(homedir(), '.cargo');
// Both spellings when the Cargo home is reached through a symbolic link: the alias Cargo is given and its real path.
const homes = [...new Set([cargoHome, existsSync(cargoHome) ? realpathSync(cargoHome) : cargoHome])];
const remap = [...homes.map((h) => `--remap-path-prefix=${h}=/cargo`), `--remap-path-prefix=${crateDir}=/dcp-ai/sdks/rust`];

// As Cargo reads them: CARGO_ENCODED_RUSTFLAGS wins whenever it is set, an empty value meaning no flags; otherwise
// RUSTFLAGS, split on spaces with empty entries dropped.
const encoded = process.env.CARGO_ENCODED_RUSTFLAGS;
const existing =
  encoded !== undefined
    ? encoded === '' ? [] : encoded.split('\x1f')
    : (process.env.RUSTFLAGS ?? '').split(' ').map((s) => s.trim()).filter((s) => s !== '');
const env = { ...process.env, CARGO_ENCODED_RUSTFLAGS: [...existing, ...remap].join('\x1f') };
delete env.RUSTFLAGS;

const r = spawnSync(
  'wasm-pack',
  ['build', '--target', target, '--out-dir', join(wasmDir, 'pkg'), '--', '--features', 'wasm', '--locked'],
  { cwd: crateDir, env, stdio: 'inherit' },
);
if (r.error) {
  console.error(`build-wasm: cannot run wasm-pack: ${r.error.message}`);
  process.exit(1);
}
if (r.status !== 0) process.exit(r.status ?? 1);
// wasm-pack writes pkg/.gitignore with "*", which would keep pkg/ out of the npm tarball.
rmSync(join(wasmDir, 'pkg', '.gitignore'), { force: true });
