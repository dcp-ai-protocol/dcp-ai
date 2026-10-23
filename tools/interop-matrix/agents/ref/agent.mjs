// Reference-verifier agent for tools/interop-matrix: lib/verify.js, what `npx dcp-ai verify`
// and the verification server run (schema validation, then the published @dcp-ai/sdk V2
// verifier). Verify only: it produces no bundles. Needs `npm install` at the repository root.
import { createInterface } from 'node:readline';
import { verifySignedBundle } from '../../../../lib/verify.js';

for await (const line of createInterface({ input: process.stdin })) {
  if (line.trim() === '') continue;
  let id = null;
  try {
    const req = JSON.parse(line);
    id = req.id;
    let result;
    if (req.cmd === 'verify') {
      const { signed_bundle, mode } = req.args ?? {};
      let r;
      try {
        r = await verifySignedBundle(signed_bundle, undefined, undefined, mode ? { mode } : {});
      } catch (e) {
        r = { verified: false, errors: [`reference verifier threw: ${e instanceof Error ? e.message : String(e)}`] };
      }
      result = { valid: r.verified === true, errors: r.errors ?? [] };
    } else if (req.cmd === 'shutdown') {
      setImmediate(() => process.exit(0));
      result = {};
    } else {
      throw new Error(`the reference verifier only verifies (got ${req.cmd})`);
    }
    process.stdout.write(JSON.stringify({ id, ok: true, result }) + '\n');
  } catch (e) {
    process.stdout.write(JSON.stringify({ id, ok: false, error: e instanceof Error ? e.message : String(e) }) + '\n');
  }
}
