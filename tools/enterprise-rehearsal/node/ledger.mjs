// Single-use ledger and effects of the MP-05 rehearsal (TEST ONLY; design v0.2 § 2.7 with the P2a corrections).
//
// A reservation is a file created with O_CREAT|O_EXCL under ledger/<tenant>/, then fsync of the file and of its
// directory: at most one attempt per signed intent, never exactly-once execution and no transaction with external
// systems. Its key is bound to the payload_hash of the intent the SDK verified, so request ids, headers or a
// re-serialized envelope do not change it. Effects are JSON lines written with one write() on an O_APPEND descriptor;
// a short write fails closed and is never retried. On macOS fsync does not flush the disk cache (F_FULLFSYNC), so no
// durability across a machine crash is claimed. Standard library only.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const TENANT = /^[A-Za-z0-9_-]{1,32}$/;
const PAYLOAD_HASH = /^sha256:[0-9a-f]{64}$/;
const KEY = /^[0-9a-f]{64}$/;
const { O_APPEND, O_CREAT, O_EXCL, O_WRONLY } = fs.constants;

export class LedgerError extends Error {}

export function actionKey(tenant, payloadHash) {
  if (typeof tenant !== 'string' || !TENANT.test(tenant)) throw new LedgerError('invalid tenant');
  if (typeof payloadHash !== 'string' || !PAYLOAD_HASH.test(payloadHash)) throw new LedgerError('invalid payload_hash');
  const bytes = Buffer.concat([Buffer.from(tenant, 'utf8'), Buffer.from([0]), Buffer.from(payloadHash, 'utf8')]);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function fsyncDir(dir) {
  const fd = fs.openSync(dir, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function writeExactly(fd, buf, write) {
  const n = write(fd, buf, 0, buf.length);
  if (n !== buf.length) throw new LedgerError(`short write: ${n} of ${buf.length} bytes`);
}

/** true if this call reserved the key; false if it was already reserved. Any other failure throws. */
export function reserve(root, tenant, key, { write = fs.writeSync } = {}) {
  if (typeof tenant !== 'string' || !TENANT.test(tenant)) throw new LedgerError('invalid tenant');
  if (typeof key !== 'string' || !KEY.test(key)) throw new LedgerError('invalid key');
  const dir = path.join(root, tenant);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  let fd;
  try {
    fd = fs.openSync(path.join(dir, key), O_CREAT | O_EXCL | O_WRONLY, 0o600);
  } catch (e) {
    if (e.code === 'EEXIST') return false;
    throw e;
  }
  try {
    writeExactly(fd, Buffer.from(`${JSON.stringify({ key, tenant, reserved_at: new Date().toISOString() })}\n`), write);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fsyncDir(dir);
  return true;
}

export function reservations(root, tenant) {
  const dir = path.join(root, tenant);
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => KEY.test(f)).sort() : [];
}

/** Appends one effect record as a JSON line; throws on a short write without retrying. */
export function appendEffect(file, record, { write = fs.writeSync } = {}) {
  const buf = Buffer.from(`${JSON.stringify(record)}\n`, 'utf8');
  const fd = fs.openSync(file, O_WRONLY | O_APPEND | O_CREAT, 0o600);
  try {
    writeExactly(fd, buf, write);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fsyncDir(path.dirname(file));
}

/** Every effect record; throws on a line that is not complete JSON, such as the remains of a short write. */
export function readEffects(file) {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
  if (text !== '' && !text.endsWith('\n')) throw new LedgerError('incomplete last line');
  return text
    .split('\n')
    .filter((line, i, all) => i < all.length - 1 || line !== '')
    .map((line, i) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new LedgerError(`line ${i + 1} is not JSON`);
      }
    });
}
