// Guards the published tarball: @dcp-ai/wasm@2.0.0 shipped without pkg/ because
// wasm-pack writes pkg/.gitignore = "*" and npm honours nested .gitignore files,
// so the runtime import of ../pkg/dcp_ai.js failed for every consumer.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

if (!existsSync(resolve(root, 'pkg'))) {
  console.log('packlist: pkg/ not built (run npm run build:wasm) — skipping tarball check');
  process.exit(0);
}

const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
});
const files = new Set(JSON.parse(out)[0].files.map((f) => f.path));
const required = ['pkg/dcp_ai.js', 'pkg/dcp_ai_bg.wasm', 'dist/index.js'];
const missing = required.filter((f) => !files.has(f));
if (missing.length > 0) {
  console.error(`packlist: tarball is missing ${missing.join(', ')} (${files.size} files packed)`);
  process.exit(1);
}
console.log(`packlist: ok (${files.size} files, pkg/ included)`);
