// scripts/build-wasm.mjs with a wasm-pack stub (npm run test:build-script): no Rust is compiled. Each case copies the
// script into a temporary tree whose path contains spaces (sdks/wasm and sdks/rust), puts a stub named wasm-pack first
// on PATH, runs the script from another working directory and reads what the stub received: its arguments, its working
// directory and the rustflags variables.
//
//   node --test test/build-wasm.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/build-wasm.mjs', import.meta.url));
const STUB = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const out = args[args.indexOf('--out-dir') + 1];
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, '.gitignore'), '*\\n');
fs.writeFileSync(process.env.STUB_OUT, JSON.stringify({ args, cwd: process.cwd(),
  encoded: process.env.CARGO_ENCODED_RUSTFLAGS ?? null, rustflags: process.env.RUSTFLAGS ?? null }));
process.exit(Number(process.env.STUB_EXIT ?? 0));
`;

function tree() {
  const root = mkdtempSync(join(tmpdir(), 'dcp wasm builder '));
  mkdirSync(join(root, 'sdks', 'wasm', 'scripts'), { recursive: true });
  mkdirSync(join(root, 'sdks', 'rust'), { recursive: true });
  cpSync(SCRIPT, join(root, 'sdks', 'wasm', 'scripts', 'build-wasm.mjs'));
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, 'bin', 'wasm-pack'), STUB);
  chmodSync(join(root, 'bin', 'wasm-pack'), 0o755);
  mkdirSync(join(root, 'elsewhere'));
  return root;
}

function build(root, vars, target = 'web') {
  const env = { ...process.env };
  for (const k of ['CARGO_ENCODED_RUSTFLAGS', 'RUSTFLAGS', 'CARGO_HOME']) delete env[k];
  Object.assign(env, vars, { PATH: `${join(root, 'bin')}${delimiter}${process.env.PATH}`, STUB_OUT: join(root, 'stub.json') });
  const r = spawnSync(process.execPath, [join(root, 'sdks', 'wasm', 'scripts', 'build-wasm.mjs'), target], {
    cwd: join(root, 'elsewhere'), env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.error, undefined);
  const seen = existsSync(join(root, 'stub.json')) ? JSON.parse(readFileSync(join(root, 'stub.json'), 'utf8')) : null;
  return { status: r.status, out: r.stdout + r.stderr, seen };
}

const crate = (root) => realpathSync(join(root, 'sdks', 'rust'));
const remapCrate = (root) => `--remap-path-prefix=${crate(root)}=/dcp-ai/sdks/rust`;
const defaultHomes = () => {
  const h = join(homedir(), '.cargo');
  return [...new Set([h, existsSync(h) ? realpathSync(h) : h])].map((p) => `--remap-path-prefix=${p}=/cargo`);
};
const entries = (seen) => seen.encoded.split('\x1f');

function withTree(fn) {
  const root = tree();
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('arguments, working directory and pkg/.gitignore removal for web and nodejs', () => {
  for (const target of ['web', 'nodejs']) {
    withTree((root) => {
      const r = build(root, {}, target);
      assert.equal(r.status, 0, r.out);
      assert.deepEqual(r.seen.args, ['build', '--target', target, '--out-dir', join(realpathSync(join(root, 'sdks', 'wasm')), 'pkg'),
        '--', '--features', 'wasm', '--locked']);
      assert.equal(r.seen.cwd, crate(root));
      assert.equal(r.seen.rustflags, null, 'RUSTFLAGS is not passed on');
      assert.deepEqual(entries(r.seen), [...defaultHomes(), remapCrate(root)]);
      assert.equal(existsSync(join(root, 'sdks', 'wasm', 'pkg', '.gitignore')), false);
    });
  }
});

test('a set but empty CARGO_ENCODED_RUSTFLAGS wins over RUSTFLAGS, as in Cargo', () => {
  withTree((root) => {
    const r = build(root, { CARGO_ENCODED_RUSTFLAGS: '', RUSTFLAGS: '-C opt-level=1' });
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(entries(r.seen), [...defaultHomes(), remapCrate(root)]);
  });
});

test('CARGO_ENCODED_RUSTFLAGS entries are kept whole and first, spaces included; RUSTFLAGS is then ignored', () => {
  withTree((root) => {
    const r = build(root, { CARGO_ENCODED_RUSTFLAGS: '--cfg\x1fsome value with spaces', RUSTFLAGS: '-C opt-level=1' });
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(entries(r.seen), ['--cfg', 'some value with spaces', ...defaultHomes(), remapCrate(root)]);
  });
});

test('RUSTFLAGS alone is split on spaces as Cargo splits it, and kept first', () => {
  withTree((root) => {
    const r = build(root, { RUSTFLAGS: '  -C   debuginfo=0  --cfg x ' });
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(entries(r.seen), ['-C', 'debuginfo=0', '--cfg', 'x', ...defaultHomes(), remapCrate(root)]);
  });
});

test('a relative CARGO_HOME resolves against sdks/rust, with its alias and real path remapped, spaces included', () => {
  withTree((root) => {
    mkdirSync(join(root, 'real cargo home'));
    symlinkSync(join(root, 'real cargo home'), join(root, 'sdks', 'rust', 'cargo home alias'));
    const r = build(root, { CARGO_HOME: 'cargo home alias' });
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(entries(r.seen), [
      `--remap-path-prefix=${join(crate(root), 'cargo home alias')}=/cargo`,
      `--remap-path-prefix=${realpathSync(join(root, 'real cargo home'))}=/cargo`,
      remapCrate(root),
    ]);
  });
});

test("wasm-pack's exit code is propagated and pkg/.gitignore is then left alone", () => {
  withTree((root) => {
    const r = build(root, { STUB_EXIT: '3' });
    assert.equal(r.status, 3, r.out);
    assert.equal(existsSync(join(root, 'sdks', 'wasm', 'pkg', '.gitignore')), true);
  });
});

test('a usage error exits 2 before running wasm-pack', () => {
  withTree((root) => {
    const r = build(root, {}, 'bundler');
    assert.equal(r.status, 2, r.out);
    assert.equal(r.seen, null);
  });
});
