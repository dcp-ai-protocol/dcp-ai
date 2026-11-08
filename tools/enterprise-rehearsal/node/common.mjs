// Shared helpers of the MP-05 rehearsal kit (TEST ONLY). The kit runs only from a copy staged inside an installed
// Node consumer (node/stage.mjs), so that @dcp-ai/sdk resolves from the reviewed artifacts, never from the checkout.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalizeV2 } from '@dcp-ai/sdk';

export const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
export const loadContract = () => readJson(path.join(KIT, 'contract', 'rehearsal-contract.json'));
export const loadScenario = () => readJson(path.join(KIT, 'contract', 'operator-scenario.json'));
export const iso = (ms) => new Date(ms).toISOString();
export const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
export const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex');
/** "sha256:" and the hex SHA-256 of dcp-jcs-v1(value), through the installed SDK canonicalizer. */
export const sha256Of = (value) => `sha256:${sha256Hex(Buffer.from(canonicalizeV2(value), 'utf8'))}`;

/** Refuses to run unless this kit is a staged copy and @dcp-ai/sdk resolves inside the consumer's node_modules. */
export function assertInstalledSdk() {
  const resolved = fs.realpathSync(fileURLToPath(import.meta.resolve('@dcp-ai/sdk')));
  const modules = path.join(path.dirname(KIT), 'node_modules');
  const inside = fs.existsSync(modules) && resolved.startsWith(fs.realpathSync(modules) + path.sep);
  if (!fs.existsSync(path.join(KIT, 'STAGED.json')) || !inside) {
    throw new Error(`run the staged kit inside the installed consumer; @dcp-ai/sdk resolved to ${resolved}`);
  }
  return resolved;
}

/**
 * Re-hashes every staged file against STAGED.json, so a server never runs a staged copy changed after staging. It does
 * not check the installed packages: that is verify.py's job, run once per rehearsal by the launcher (node/rehearse.mjs).
 */
export function checkStaged() {
  const staged = readJson(path.join(KIT, 'STAGED.json'));
  for (const [rel, digest] of Object.entries(staged.files)) {
    const file = path.join(KIT, rel);
    if (fs.lstatSync(file).isSymbolicLink() || sha256Hex(fs.readFileSync(file)) !== digest) throw new Error(`staged file changed: ${rel}`);
  }
  return Object.keys(staged.files).length;
}

/** The launcher's record of verify.py for this consumer must say it passed. */
export function assertVerified(file, consumer) {
  const record = readJson(file);
  if (record.verify_format !== 'dcp-ai-mp05-verify-run-v1' || record.exit_code !== 0) throw new Error(`${file}: verify.py did not pass`);
  if (fs.realpathSync(record.consumer) !== fs.realpathSync(consumer)) throw new Error(`${file}: verified another consumer`);
  return record;
}

export { assertOutsideGit } from './paths.mjs';

export function fsyncDir(dir) {
  const fd = fs.openSync(dir, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** Creates a file that must not exist yet. */
export function writeNew(file, text, mode = 0o644) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, { mode, flag: 'wx' });
}

/** Replaces a JSON file atomically (temporary file, fsync, rename, fsync of the directory). */
export function writeAtomic(file, value, mode = 0o644) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}`);
  const fd = fs.openSync(tmp, 'wx', mode);
  try {
    fs.writeFileSync(fd, json(value));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  fsyncDir(dir);
}
