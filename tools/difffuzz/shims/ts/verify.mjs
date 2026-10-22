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

if (loop) {
  for await (const line of createInterface({ input: process.stdin })) {
    if (line.trim() === '') continue;
    process.stdout.write(JSON.stringify(await verdict(line)) + '\n');
  }
} else {
  process.stdout.write(JSON.stringify(await verdict(readFileSync(0, 'utf8'))) + '\n');
}
