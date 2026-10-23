// Runs verifyBundle from the built package over tests/interop/v2/bundle_vectors.json
// in Node, so the wasm verifier (and the JavaScript clock it reads) runs, not
// only compiles. Needs `npm run build:wasm` and `npm run build:ts` first.
import { readFileSync } from 'node:fs';
import { initDcp } from '../dist/index.js';

const B = JSON.parse(readFileSync(new URL('../../../tests/interop/v2/bundle_vectors.json', import.meta.url), 'utf8'));
const dcp = await initDcp({ module_or_path: readFileSync(new URL('../pkg/dcp_ai_bg.wasm', import.meta.url)) });

const MODES = ['classical_only', 'hybrid_preferred', 'hybrid_required', 'pq_only'];
const policyFor = (mode) => ({
  ...B.default_verifier_policy,
  default_mode: mode,
  risk_overrides: { low: mode, medium: mode, high: mode },
});
const mutated = (signed, mutations) => {
  const out = structuredClone(signed);
  for (const { path, value } of mutations) {
    let node = out;
    for (const key of path.slice(0, -1)) node = node[key];
    node[path[path.length - 1]] = value;
  }
  return out;
};

const failures = [];
let checks = 0;
const check = (name, ok, result) => {
  checks += 1;
  if (!ok) failures.push(`${name}: ${JSON.stringify(result?.errors ?? result)}`);
};
const rejects = (name, result, errorContains) =>
  check(name, result.verified === false && result.errors.join('\n').toLowerCase().includes(errorContains), result);

check('signed_bundle without a policy', dcp.verifyBundle(B.signed_bundle).verified === true);
for (const mode of MODES) {
  const policy = policyFor(mode);
  const verify = (bundle) => dcp.verifyBundle(bundle, policy);
  // A case's verifier_policy_overrides replace those fields of the mode's policy.
  const verifyCase = (c) => dcp.verifyBundle(c.signed_bundle, { ...policy, ...c.verifier_policy_overrides });
  let result = verify(B.signed_bundle);
  check(`${mode}: signed_bundle`, result.verified === true, result);
  for (const c of B.must_accept_bundles) {
    result = verifyCase(c);
    check(`${mode}: ${c.name}`, result.verified === true, result);
  }
  for (const c of B.must_reject) rejects(`${mode}: ${c.name}`, verify(mutated(B.signed_bundle, c.mutations)), c.error_contains);
  for (const c of B.must_reject_bundles) rejects(`${mode}: ${c.name}`, verifyCase(c), c.error_contains);
  const control = B.classical_only_routine_bundle;
  result = verify(control.signed_bundle);
  check(`${mode}: classical_only_routine_bundle`, result.verified === control.verified_by_mode[mode], result);
}

if (failures.length > 0) {
  console.error(`verifyBundle: ${failures.length} of ${checks} checks failed\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`verifyBundle: all ${checks} bundle vector checks passed`);
