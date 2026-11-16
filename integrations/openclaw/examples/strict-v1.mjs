// strict-v1 admission with @dcp-ai/openclaw's dcp_verify_bundle (docs/ADMISSION.md).
//
// Runs offline on the shared admission vectors: their trust set, profile and bundles, with the
// clock fixed at the vectors' time and a revocation source that answers "not revoked". In a real
// deployment, drop `clock`, load the trust set from your own configuration, and use
// denyListRevocationSource({ url }) or your own source.
//
//   cd integrations/openclaw && npm run build && node examples/strict-v1.mjs

import { readFileSync } from 'node:fs';
import { configureVerifier, executeVerifyBundle } from '../dist/index.js';

const vectors = JSON.parse(readFileSync(new URL('../../../tests/interop/v2/admission_vectors.json', import.meta.url), 'utf8'));
const now = Date.parse(vectors.cases.find((c) => c.name === 'A_known_principal_strict').now);

configureVerifier({
  trustedPrincipals: vectors.trust_sets.principal,
  profile: vectors.profiles.strict,
  revocationSource: async ({ agent_ids, kids }) => ({
    checked_at: new Date(now - 30_000).toISOString(),
    agents: Object.fromEntries(agent_ids.map((id) => [id, 'not_revoked'])),
    keys: Object.fromEntries(kids.map((kid) => [kid, 'not_revoked'])),
  }),
  clock: () => now,
});

// What the model sees: admitted bundles name the agent; the model cannot change the profile.
for (const [name, extra] of [['base', {}], ['unknown_principal', {}], ['base', { verifier_policy: { default_mode: 'pq_only' } }]]) {
  const result = await executeVerifyBundle({ signed_bundle: vectors.signed_bundles[name], ...extra });
  console.log(`${name}${extra.verifier_policy ? ' with a model verifier_policy' : ''}:`, {
    admitted: result.admitted,
    codes: result.codes,
    agent_id: result.agent_id,
    action_authorized: result.action_authorized,
    message: result.message.slice(0, 120),
  });
}
