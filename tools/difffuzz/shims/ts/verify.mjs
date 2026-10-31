// TypeScript SDK shim for the differential fuzzer.
//
// Imports the LOCAL SDK build (run `npm install && npm run build` in
// sdks/typescript first), never the published @dcp-ai/sdk that the root
// lib/verify.js depends on.
//
// Usage: node verify.mjs [mode] [--loop]
//   stdin: one signed bundle (JSON document); with --loop, one compact JSON
//          document per line.
//   stdout: one line per document: {"valid": bool, "errors": [string]}
//   mode: empty for DEFAULT_VERIFIER_POLICY, or a verification mode applied
//         to default_mode and to every risk tier (as the interop tests do).
// Exit code 0 for a verdict; anything else is a crash of the verifier.
//
// Usage: node verify.mjs --batch   (the driver's protocol, dcp-difffuzz/3; see README.md)
//   stdin: one request {protocol, run_id, nonce, now_ms, cases: [{id, policy, bundle_b64}]}; stdout: one response
//   with exactly one result per case: verdict {verified, errors[, truncated]}, parse_rejected {message}, error
//   {message} (the SDK threw) or unsupported. Each case is verified under its own explicit policy at now_ms. A
//   malformed request exits 2. In a verdict, errors is the SDK's list bounded by bounded() below.
// Usage: node verify.mjs --bound-selftest   stdin {lists: [[string]]}, stdout {bounded: [bounded(list)]}; no SDK call.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import {
  AlgorithmRegistry,
  DEFAULT_VERIFIER_POLICY,
  Ed25519Provider,
  MlDsa65Provider,
  verifySignedBundleV2,
} from '../../../../sdks/typescript/dist/index.js';

const args = process.argv.slice(2);
const loop = args.includes('--loop');
const mode = args.find((a) => !a.startsWith('--')) || '';
const policy = mode
  ? {
      ...DEFAULT_VERIFIER_POLICY,
      default_mode: mode,
      risk_overrides: { low: mode, medium: mode, high: mode },
    }
  : DEFAULT_VERIFIER_POLICY;

const registry = new AlgorithmRegistry();
registry.registerSigner(new Ed25519Provider());
registry.registerSigner(new MlDsa65Provider());

async function verdict(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return { valid: false, errors: [`JSON parse error: ${e.message}`] };
  }
  const r = await verifySignedBundleV2(doc, registry, policy);
  return { valid: r.verified === true, errors: r.errors };
}

const ERRORS_MAX = 8;
const ERROR_CODEPOINTS_MAX = 256;
// Code points as JavaScript iterates them (a lone surrogate counts one) and the index where the first `keep` end.
function measure(s, keep) {
  let n = 0;
  let cut = s.length;
  for (let i = 0; i < s.length; n++) {
    if (n === keep) cut = i;
    i += s.codePointAt(i) > 0xffff ? 2 : 1;
  }
  return { n, cut };
}
// Protocol /3: at most ERRORS_MAX errors of at most ERROR_CODEPOINTS_MAX code points, each a literal prefix, and a
// marker whenever anything was cut. The sha256 takes each original as its UTF-8 length (4 bytes, big-endian) then its
// UTF-8 bytes, a lone surrogate as U+FFFD. Counting keeps no array of code points. A list that is not of strings is
// returned as it is, so the driver still rejects it as malformed: never a valid rejection.
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

async function batch() {
  let req;
  try {
    req = JSON.parse(readFileSync(0, 'utf8'));
  } catch (e) {
    badRequest(`not JSON: ${e.message}`);
  }
  if (!keysAre(req, ['protocol', 'run_id', 'nonce', 'now_ms', 'cases']) || req.protocol !== 'dcp-difffuzz/3' || !Number.isSafeInteger(req.now_ms) || !Array.isArray(req.cases)) badRequest('envelope');
  const results = [];
  for (const c of req.cases) {
    const plainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
    if (!keysAre(c, ['id', 'policy', 'bundle_b64']) || typeof c.id !== 'string' || !plainObject(c.policy) || typeof c.bundle_b64 !== 'string') badRequest('case fields');
    const bytes = Buffer.from(c.bundle_b64, 'base64');
    if (bytes.toString('base64') !== c.bundle_b64) badRequest(`case ${c.id}: bundle_b64 is not canonical base64`);
    let doc;
    try {
      doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch (e) {
      results.push({ id: c.id, status: 'parse_rejected', message: String(e.message).slice(0, 500) });
      continue;
    }
    try {
      const r = await verifySignedBundleV2(doc, registry, c.policy, { now: req.now_ms });
      if (typeof r.verified !== 'boolean') throw new Error(`verified is ${typeof r.verified}, not a boolean`);
      results.push({ id: c.id, status: 'verdict', verified: r.verified, ...bounded(r.errors) });
    } catch (e) {
      results.push({ id: c.id, status: 'error', message: String(e?.message ?? e).slice(0, 500) });
    }
  }
  process.stdout.write(JSON.stringify({ protocol: req.protocol, run_id: req.run_id, nonce: req.nonce, results }) + '\n');
}

if (args.includes('--bound-selftest')) {
  const { lists } = JSON.parse(readFileSync(0, 'utf8'));
  process.stdout.write(JSON.stringify({ bounded: lists.map(bounded) }) + '\n');
} else if (args.includes('--batch')) {
  await batch();
} else if (loop) {
  for await (const line of createInterface({ input: process.stdin })) {
    if (line.trim() === '') continue;
    process.stdout.write(JSON.stringify(await verdict(line)) + '\n');
  }
} else {
  process.stdout.write(JSON.stringify(await verdict(readFileSync(0, 'utf8'))) + '\n');
}
