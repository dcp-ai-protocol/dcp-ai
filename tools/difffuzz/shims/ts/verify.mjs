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
// Usage: node verify.mjs --batch   (the driver's protocol, dcp-difffuzz/2; see README.md)
//   stdin: one request {protocol, run_id, nonce, now_ms, cases: [{id, policy, bundle_b64}]}; stdout: one response
//   with exactly one result per case: verdict {verified, errors}, parse_rejected {message}, error {message} (the SDK
//   threw) or unsupported. Each case is verified under its own explicit policy at now_ms. A malformed request exits 2.
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
  if (!keysAre(req, ['protocol', 'run_id', 'nonce', 'now_ms', 'cases']) || req.protocol !== 'dcp-difffuzz/2' || !Number.isSafeInteger(req.now_ms) || !Array.isArray(req.cases)) badRequest('envelope');
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
      results.push({ id: c.id, status: 'verdict', verified: r.verified, errors: r.errors });
    } catch (e) {
      results.push({ id: c.id, status: 'error', message: String(e?.message ?? e).slice(0, 500) });
    }
  }
  process.stdout.write(JSON.stringify({ protocol: req.protocol, run_id: req.run_id, nonce: req.nonce, results }) + '\n');
}

if (args.includes('--batch')) {
  await batch();
} else if (loop) {
  for await (const line of createInterface({ input: process.stdin })) {
    if (line.trim() === '') continue;
    process.stdout.write(JSON.stringify(await verdict(line)) + '\n');
  }
} else {
  process.stdout.write(JSON.stringify(await verdict(readFileSync(0, 'utf8'))) + '\n');
}
