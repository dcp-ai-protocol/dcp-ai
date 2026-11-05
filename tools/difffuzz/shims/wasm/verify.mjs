// WASM shim for the differential fuzzer: the Rust SDK compiled to WebAssembly (wasm-pack --target web, feature wasm) and
// run by Node (Node-hosted WebAssembly, not a browser). It speaks only the driver's protocol, dcp-difffuzz/3, as the four
// other shims do in --batch mode; the driver builds the package into the run's own directory.
//
//   node verify.mjs --pkg <dir> --batch            stdin: one request; stdout: one response (README.md)
//   node verify.mjs [--pkg <dir>] --bound-selftest stdin {lists: [[string]]}, stdout {bounded: [bounded(list)]}; no WASM
//
// wasm_verify_signed_bundle_v2 takes the bundle as text and the policy as JSON, and reads the host clock (Date.now): for
// each call, Date.now returns the request's now_ms and is restored in finally, also when the call throws. The decoded
// UTF-8 text is passed exactly as received (a leading byte order mark included), never parsed or re-serialized in JavaScript. Only the export's documented
// JSON parser rejection, a result {"verified": false, "errors": ["JSON parse error: ..."]}, is parse_rejected; bytes that
// are not UTF-8 cannot be passed as text and are parse_rejected, as in the TypeScript shim. Any other in-band error, a
// policy the export cannot read, an unexpected result or a trap is error, never a verdict. A malformed request exits 2.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const ERRORS_MAX = 8;
const ERROR_CODEPOINTS_MAX = 256;
// The bounds of protocol /3, the same code as bounded() in shims/ts/verify.mjs (a self-test compares the shims).
function measure(s, keep) {
  let n = 0;
  let cut = s.length;
  for (let i = 0; i < s.length; n++) {
    if (n === keep) cut = i;
    i += s.codePointAt(i) > 0xffff ? 2 : 1;
  }
  return { n, cut };
}
function bounded(errors) {
  if (!Array.isArray(errors) || !errors.every((e) => typeof e === 'string')) return { errors };
  const m = errors.map((e) => measure(e, ERROR_CODEPOINTS_MAX));
  if (errors.length <= ERRORS_MAX && m.every((x) => x.n <= ERROR_CODEPOINTS_MAX)) return { errors };
  const h = createHash('sha256');
  const len = Buffer.alloc(4);
  for (const e of errors) {
    len.writeUInt32BE(Buffer.byteLength(e, 'utf8'));
    h.update(len);
    h.update(e, 'utf8');
  }
  const kept = errors.slice(0, ERRORS_MAX).map((e, i) => e.slice(0, m[i].cut));
  return { errors: kept, truncated: { original_count: errors.length, kept: kept.length, original_code_points: m.reduce((n, x) => n + x.n, 0), sha256: h.digest('hex') } };
}
function badRequest(why) {
  process.stderr.write(`invalid request: ${why}\n`);
  process.exit(2);
}
const keysAre = (o, keys) => o !== null && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length === keys.length && keys.every((k) => k in o);
const plainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function atHostTime(ms, call) {
  const realNow = Date.now;
  Date.now = () => ms;
  try { return call(); } finally { Date.now = realNow; }
}
const PARSE_ERROR = 'JSON parse error: ';

async function load(pkg) {
  const glue = path.join(pkg, 'dcp_ai.js');
  const wasm = path.join(pkg, 'dcp_ai_bg.wasm');
  if (!fs.existsSync(glue) || !fs.existsSync(wasm)) badRequest(`no WASM package at ${pkg}`);
  const mod = await import(pathToFileURL(glue).href);
  await mod.default({ module_or_path: fs.readFileSync(wasm) });
  return mod;
}

function verdictOf(id, out) {
  let v;
  try { v = JSON.parse(out); } catch { return { id, status: 'error', message: 'the export returned text that is not JSON' }; }
  if (keysAre(v, ['error']) && typeof v.error === 'string') return { id, status: 'error', message: v.error.slice(0, 500) };
  if (!plainObject(v) || typeof v.verified !== 'boolean' || !Array.isArray(v.errors) || !v.errors.every((e) => typeof e === 'string')) {
    return { id, status: 'error', message: 'the export returned no boolean verified with a list of errors' };
  }
  if (!v.verified && v.errors.length === 1 && v.errors[0].startsWith(PARSE_ERROR)) return { id, status: 'parse_rejected', message: v.errors[0].slice(0, 500) };
  if (!v.verified && v.errors.length === 1 && v.errors[0].startsWith('Policy parse error: ')) return { id, status: 'error', message: v.errors[0].slice(0, 500) };
  return { id, status: 'verdict', verified: v.verified, ...bounded(v.errors) };
}

async function batch(mod) {
  let req;
  try { req = JSON.parse(fs.readFileSync(0, 'utf8')); } catch (e) { badRequest(`not JSON: ${e.message}`); }
  if (!keysAre(req, ['protocol', 'run_id', 'nonce', 'now_ms', 'cases']) || req.protocol !== 'dcp-difffuzz/3' || !Number.isSafeInteger(req.now_ms) || !Array.isArray(req.cases)) badRequest('envelope');
  const results = [];
  for (const c of req.cases) {
    if (!keysAre(c, ['id', 'policy', 'bundle_b64']) || typeof c.id !== 'string' || !plainObject(c.policy) || typeof c.bundle_b64 !== 'string') badRequest('case fields');
    const bytes = Buffer.from(c.bundle_b64, 'base64');
    if (bytes.toString('base64') !== c.bundle_b64) badRequest(`case ${c.id}: bundle_b64 is not canonical base64`);
    let text;
    // ignoreBOM: a leading EF BB BF stays U+FEFF in the text, as received; the decoder never strips it.
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch (e) {
      results.push({ id: c.id, status: 'parse_rejected', message: `not UTF-8: ${String(e.message).slice(0, 200)}` });
      continue;
    }
    try {
      results.push(verdictOf(c.id, atHostTime(req.now_ms, () => mod.wasm_verify_signed_bundle_v2(text, JSON.stringify(c.policy)))));
    } catch (e) {
      results.push({ id: c.id, status: 'error', message: `${e?.name ?? 'Error'}: ${String(e?.message ?? e)}`.slice(0, 500) });
    }
  }
  process.stdout.write(JSON.stringify({ protocol: req.protocol, run_id: req.run_id, nonce: req.nonce, results }) + '\n');
}

const pkgAt = args.indexOf('--pkg');
const pkg = pkgAt >= 0 ? args[pkgAt + 1] : undefined;
if (args.includes('--bound-selftest')) {
  const { lists } = JSON.parse(fs.readFileSync(0, 'utf8'));
  process.stdout.write(JSON.stringify({ bounded: lists.map(bounded) }) + '\n');
} else if (args.includes('--batch') && pkg) {
  await batch(await load(path.resolve(pkg)));
} else {
  badRequest('usage: verify.mjs --pkg <dir> --batch | --bound-selftest');
}
