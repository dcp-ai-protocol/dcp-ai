// Negative controls of the release gate (npm run release-check:negative), run on copies of the built package so the
// package itself is never changed. The unchanged copy must pass; each copy with one defect in a packed member must fail
// with exit 1 and name that defect. It requires a built package (pkg/ and dist/) and fails without one; it never skips.
//
//   node --test test/release-artifact.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = fileURLToPath(new URL('..', import.meta.url));
const GATE = fileURLToPath(new URL('./release-artifact.mjs', import.meta.url));

function copy(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'dcp-wasm-gate-'));
  for (const name of ['package.json', 'README.md', 'LICENSE', 'dist', 'pkg']) {
    cpSync(join(PKG, name), join(dir, name), { recursive: true });
  }
  mutate(dir);
  return dir;
}

function gate(dir) {
  try {
    const r = spawnSync(process.execPath, [GATE, '--root', dir], { encoding: 'utf8', timeout: 120_000 });
    assert.equal(r.error, undefined);
    return { status: r.status, out: r.stdout + r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the package is built (pkg/ and dist/), or every control below would prove nothing', () => {
  assert.ok(existsSync(join(PKG, 'pkg', 'dcp_ai_bg.wasm')) && existsSync(join(PKG, 'dist', 'index.js')), 'run npm run build first');
});

test('an unchanged copy passes', () => {
  const r = gate(copy(() => {}));
  assert.equal(r.status, 0, r.out);
});

const CONTROLS = [
  ['pkg/ missing', (d) => rmSync(join(d, 'pkg'), { recursive: true }), 'pkg/ is missing'],
  ['LICENSE missing', (d) => rmSync(join(d, 'LICENSE')), 'not packed: LICENSE'],
  ['a local path in pkg/dcp_ai.js', (d) => appendFileSync(join(d, 'pkg', 'dcp_ai.js'), '\n// /Users/someone/.cargo/registry/src/x.rs\n'), 'pkg/dcp_ai.js: absolute local path'],
  ['a local path in the .wasm bytes', (d) => appendFileSync(join(d, 'pkg', 'dcp_ai_bg.wasm'), Buffer.from('/home/runner/.cargo/registry/src/x.rs')), 'pkg/dcp_ai_bg.wasm: absolute local path'],
  ['the ajv-formats notice removed', (d) => {
    const f = join(d, 'dist', 'index.js');
    writeFileSync(f, readFileSync(f, 'utf8').replaceAll('MIT License', 'License'));
  }, 'the ajv-formats notice lacks'],
  ['an absolute source in a map', (d) => {
    const name = readdirSync(join(d, 'dist')).find((f) => f.endsWith('.js.map'));
    assert.ok(name, 'a .js.map is packed');
    const f = join(d, 'dist', name);
    const map = JSON.parse(readFileSync(f, 'utf8'));
    map.sources = ['/abs/src/index.ts'];
    writeFileSync(f, JSON.stringify(map));
  }, 'absolute source'],
];
for (const [name, mutate, message] of CONTROLS) {
  test(`fails as required: ${name}`, () => {
    const r = gate(copy(mutate));
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
}
