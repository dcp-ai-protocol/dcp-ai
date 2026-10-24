// strict-v1 admission with @dcp-ai/express (docs/ADMISSION.md).
//
// Runs offline on the shared admission vectors: their trust set, profile and bundles, with the
// clock fixed at the vectors' time and a revocation source that answers "not revoked". In a real
// deployment, drop `clock`, load the trust set from your own configuration, and use
// denyListRevocationSource({ url }) or your own source.
//
//   cd integrations/express && npm run build && node examples/strict-v1.mjs

import { readFileSync } from 'node:fs';
import express from 'express';
import { dcpVerify } from '../dist/index.js';

const vectors = JSON.parse(readFileSync(new URL('../../../tests/interop/v2/admission_vectors.json', import.meta.url), 'utf8'));
const now = Date.parse(vectors.cases.find((c) => c.name === 'A_known_principal_strict').now);

const app = express();
app.use(express.json({ limit: '5mb' }));
app.post(
  '/agent/action',
  dcpVerify({
    trustedPrincipals: vectors.trust_sets.principal,
    profile: vectors.profiles.strict,
    revocationSource: async ({ agent_ids, kids }) => ({
      checked_at: new Date(now - 30_000).toISOString(),
      agents: Object.fromEntries(agent_ids.map((id) => [id, 'not_revoked'])),
      keys: Object.fromEntries(kids.map((kid) => [kid, 'not_revoked'])),
    }),
    clock: () => now,
  }),
  (req, res) => res.json({ reached: true, admission: req.dcpAgent.admission }),
);

const server = app.listen(0, async () => {
  const url = `http://127.0.0.1:${server.address().port}/agent/action`;
  for (const name of ['base', 'unknown_principal', 'other_intended_verifier']) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ signed_bundle: vectors.signed_bundles[name] }),
    });
    const body = await response.json();
    console.log(`${name}: ${response.status}`, body.reached ? body.admission : { admitted: body.admitted, codes: body.codes });
  }
  server.close();
});
