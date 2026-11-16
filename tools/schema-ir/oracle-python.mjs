// Runs schema oracle 2 (tools/schema-ir/oracle_jsonschema.py) over many JSON texts in one process, with a deadline and
// an output bound, and accepts its answer only when it is complete: exit 0 with no signal, one JSON document with the
// oracle's description, and exactly one well-typed result per requested id (no missing, duplicate or unknown id;
// valid is a boolean that agrees with the error list). Anything else throws: a missing or failed oracle never counts
// as a pass. The interpreter is SCHEMA_IR_PYTHON (default python3) and needs jsonschema and referencing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
export const ORACLE_SCRIPT = path.join(HERE, 'oracle_jsonschema.py');
export const ORACLE_TIMEOUT_MS = 120000;
export const ORACLE_MAX_BYTES = 64 * 1024 * 1024;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const exactKeys = (o, req, opt = []) => isObject(o) && req.every((k) => Object.hasOwn(o, k)) && Object.keys(o).every((k) => req.includes(k) || opt.includes(k));
const isError = (e) => exactKeys(e, ['instance', 'keyword'], ['member']) && typeof e.instance === 'string' && typeof e.keyword === 'string' && (e.member === undefined || typeof e.member === 'string');

/** Map id -> {valid, errors} for [{id, text}], plus the oracle's own description; throws unless the answer is complete. */
export function pythonValidate(cases, { python = process.env.SCHEMA_IR_PYTHON || 'python3', script = ORACLE_SCRIPT, timeoutMs = ORACLE_TIMEOUT_MS, maxBytes = ORACLE_MAX_BYTES } = {}) {
  const ids = cases.map((c) => c.id);
  if (new Set(ids).size !== ids.length) throw new Error('python oracle: duplicate request id');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-ir-oracle-'));
  try {
    const file = path.join(dir, 'cases.json');
    fs.writeFileSync(file, JSON.stringify({ cases }));
    const r = spawnSync(python, [script, path.join(REPO, 'schemas', 'v2'), file], { cwd: dir, timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: maxBytes, encoding: 'utf8' });
    const fail = (why) => { throw new Error(`python oracle (${python}): ${why}${r.stderr ? ` — stderr: ${String(r.stderr).slice(0, 2000)}` : ''}`); };
    if (r.error?.code === 'ETIMEDOUT') fail(`no answer within ${timeoutMs} ms`);
    if (r.error?.code === 'ENOBUFS') fail(`more than ${maxBytes} bytes of output`);
    if (r.error) fail(r.error.message);
    if (r.signal !== null) fail(`killed by ${r.signal}`);
    if (r.status !== 0) fail(`exit ${r.status}`);
    let out;
    try { out = JSON.parse(r.stdout); } catch (e) { fail(`output is not one JSON document (${e.message})`); }
    if (!exactKeys(out, ['oracle', 'python', 'versions', 'results']) || typeof out.oracle !== 'string' || typeof out.python !== 'string' || !isObject(out.versions) || !Object.values(out.versions).every((v) => typeof v === 'string') || !Array.isArray(out.results)) fail('the answer lacks oracle, python, versions or results');
    const results = new Map();
    for (const x of out.results) {
      if (!exactKeys(x, ['id', 'valid', 'errors']) || typeof x.id !== 'string' || typeof x.valid !== 'boolean' || !Array.isArray(x.errors) || !x.errors.every(isError)) fail(`malformed result ${JSON.stringify(x).slice(0, 200)}`);
      if (x.valid !== (x.errors.length === 0)) fail(`result ${x.id}: valid disagrees with its errors`);
      if (results.has(x.id)) fail(`duplicate result ${x.id}`);
      if (!ids.includes(x.id)) fail(`result for an id that was not sent: ${x.id}`);
      results.set(x.id, x);
    }
    const missing = ids.filter((i) => !results.has(i));
    if (missing.length) fail(`no result for ${missing.length} id(s): ${missing.slice(0, 5).join(', ')}`);
    return { about: { oracle: out.oracle, python: out.python, versions: out.versions }, results };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
