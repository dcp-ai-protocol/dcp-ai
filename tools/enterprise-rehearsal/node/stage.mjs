// Copies the P2 files of this kit (contract/, node/, python/) into an installed Node consumer, as node/rehearsal/,
// with the sha256 of every file in STAGED.json. Standard library only: it runs from the checkout and never loads the
// SDK. The staged copy is what runs, so @dcp-ai/sdk resolves from the consumer's node_modules.
//
// The destination is checked physically (symbolic links resolved): never inside this kit or the Git work tree that
// holds it, and an existing destination is replaced only if it is a real directory staged by this script.
//
//   node tools/enterprise-rehearsal/node/stage.mjs --consumer DIR
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The P2 directories, and the runtime helpers prepared by Codex at the kit root (copied unchanged). verify.py,
// install.py and prepare.py are not staged: the launcher runs verify.py from the checkout, as its README says.
const PARTS = ['contract', 'node', 'python', 'ingress-node.mjs', 'ingress_python.py', 'process.mjs', 'secrets.mjs'];
const SKIP = new Set(['__pycache__', 'node_modules']);

function refuse(message) {
  console.error(message);
  process.exit(2);
}

const inside = (p, root) => p === root || p.startsWith(root + path.sep);
function gitRoot(start) {
  for (let d = start; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    if (path.dirname(d) === d) return null;
  }
}

const at = process.argv.indexOf('--consumer');
if (at < 0 || !process.argv[at + 1]) refuse('usage: node tools/enterprise-rehearsal/node/stage.mjs --consumer DIR');
const nodeDir = path.join(path.resolve(process.argv[at + 1]), 'node');
if (!fs.existsSync(path.join(nodeDir, 'node_modules', '@dcp-ai', 'sdk', 'package.json'))) {
  refuse(`${nodeDir} is not an installed Node consumer`);
}
const kitReal = fs.realpathSync(KIT);
const repo = gitRoot(kitReal);
const dest = path.join(fs.realpathSync(nodeDir), 'rehearsal');
if (inside(dest, kitReal) || inside(kitReal, dest)) refuse(`${dest} is physically inside the kit, or contains it`);
if (repo && inside(dest, repo)) refuse(`${dest} is physically inside the repository ${repo}`);
const existing = fs.lstatSync(dest, { throwIfNoEntry: false });
if (existing) {
  if (existing.isSymbolicLink() || !existing.isDirectory()) refuse(`${dest} is a symbolic link or not a directory; nothing removed`);
  const marker = fs.lstatSync(path.join(dest, 'STAGED.json'), { throwIfNoEntry: false });
  if (!marker?.isFile()) refuse(`${dest} exists and was not staged by this script`);
  fs.rmSync(dest, { recursive: true });
}

const files = {};
const copy = (rel) => {
  const src = path.join(KIT, rel);
  const st = fs.lstatSync(src);
  if (st.isSymbolicLink()) throw new Error(`symbolic link in the kit: ${rel}`);
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(src).sort()) if (!SKIP.has(name) && !name.endsWith('.pyc')) copy(path.join(rel, name));
    return;
  }
  const bytes = fs.readFileSync(src);
  fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
  fs.writeFileSync(path.join(dest, rel), bytes, { flag: 'wx', mode: st.mode & 0o755 });
  files[rel.split(path.sep).join('/')] = crypto.createHash('sha256').update(bytes).digest('hex');
};
PARTS.forEach(copy);
const staged = { staged_format: 'dcp-ai-mp05-staged-v1', staged_at: new Date().toISOString(), source: 'tools/enterprise-rehearsal', files };
fs.writeFileSync(path.join(dest, 'STAGED.json'), `${JSON.stringify(staged, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ status: 'staged', dest, files: Object.keys(files).length }));
