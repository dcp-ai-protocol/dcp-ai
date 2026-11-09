#!/usr/bin/env node
// Release gate for @dcp-ai/wasm (npm run release-check; CI runs it after the build). It accredits a built package only:
// pkg/ and dist/ must exist, and npm's own pack list must hold the runtime files and LICENSE. Every packed member is then
// read. LICENSE (and pkg/LICENSE) must equal the repository LICENSE; dist/index.js must keep the ajv-formats MIT notice;
// a source map may name relative sources only; and no member, the .wasm bytes included, may contain an absolute local
// path (a user, home or temporary directory, the Cargo home, or this package's or this checkout's directory). Any
// failure exits 1 and lists every problem; nothing is skipped. test/release-artifact.test.mjs holds its negative controls.
//
//   node test/release-artifact.mjs [--root <package directory>]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const at = args.indexOf('--root');
if (args.length !== (at >= 0 ? 2 : 0) || (at >= 0 && !args[at + 1])) {
  console.error('usage: node test/release-artifact.mjs [--root <package directory>]');
  process.exit(2);
}
const root = resolve(at >= 0 ? args[at + 1] : fileURLToPath(new URL('..', import.meta.url)));
const license = readFileSync(fileURLToPath(new URL('../../../LICENSE', import.meta.url)));
const REQUIRED = ['package.json', 'README.md', 'LICENSE', 'dist/index.js', 'dist/index.d.ts', 'pkg/dcp_ai.js', 'pkg/dcp_ai_bg.wasm'];
const NOTICE = ['ajv-formats', 'MIT License', 'Copyright (c) 2020 Evgeny Poberezkin'];
const PATTERNS = [/\/Users\/[^/\0\s"'`]+/, /\/home\/[^/\0\s"'`]+/, /\/private\/(?:tmp|var)\//, /\/tmp\/[^/\0\s"'`]+/, /[A-Za-z]:\\Users\\/];

const both = (p) => {
  try {
    return [p, realpathSync(p)];
  } catch {
    return [p];
  }
};
const localDirs = [
  ...new Set(
    [homedir(), process.env.CARGO_HOME, join(homedir(), '.cargo'), root, fileURLToPath(new URL('../../..', import.meta.url))]
      .filter(Boolean)
      .flatMap(both)
      .map((p) => p.replace(/[\\/]+$/, ''))
      .filter((p) => p.length > 1),
  ),
];

const problems = [];
for (const dir of ['pkg', 'dist']) {
  if (!existsSync(join(root, dir))) problems.push(`${dir}/ is missing: build the package first (npm run build)`);
}
let members = [];
if (problems.length === 0) {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  members = JSON.parse(out)[0].files.map((f) => f.path).sort();
  for (const name of REQUIRED) if (!members.includes(name)) problems.push(`not packed: ${name}`);
}
for (const name of members) {
  const bytes = readFileSync(join(root, name));
  const text = bytes.toString('latin1');
  for (const p of PATTERNS) if (p.test(text)) problems.push(`${name}: absolute local path matching ${p.source}`);
  for (const d of localDirs) if (text.includes(d)) problems.push(`${name}: contains a local directory of this build`);
  if ((name === 'LICENSE' || name === 'pkg/LICENSE') && !bytes.equals(license)) problems.push(`${name}: differs from the repository LICENSE`);
  if (name.endsWith('.map')) {
    const map = JSON.parse(bytes.toString('utf8'));
    for (const s of [map.sourceRoot ?? '', ...(map.sources ?? [])]) {
      if (/^(?:\/|[A-Za-z]:|file:)/.test(s)) problems.push(`${name}: absolute source ${JSON.stringify(s)}`);
    }
  }
}
if (members.includes('dist/index.js')) {
  const js = readFileSync(join(root, 'dist', 'index.js'), 'utf8');
  for (const n of NOTICE) if (!js.includes(n)) problems.push(`dist/index.js: the ajv-formats notice lacks ${JSON.stringify(n)}`);
}

console.log(JSON.stringify({ root, members: members.length, problems }, null, 2));
console.log(problems.length === 0 ? 'release-artifact: PASS' : `release-artifact: FAIL (${problems.length})`);
process.exit(problems.length === 0 ? 0 : 1);
