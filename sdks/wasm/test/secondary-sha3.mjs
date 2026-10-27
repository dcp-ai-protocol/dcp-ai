// Runs the built package over tests/interop/v2/secondary_sha3_vectors.json (spec/VERIFICATION.md V2-11 and its
// erratum of 27/10/2026): verifyBundle (wasm_verify_signed_bundle_v2) and the experimental candidate verifier on its
// v1 route, so the wasm verifier runs, not only compiles. Needs `npm run build:wasm` and `npm run build:ts` first.
import { readFileSync } from 'node:fs';
import { initDcp, experimentalWasmHistoricalAdapters } from '../dist/index.js';

const V = JSON.parse(readFileSync(new URL('../../../tests/interop/v2/secondary_sha3_vectors.json', import.meta.url), 'utf8'));
const dcp = await initDcp({ module_or_path: readFileSync(new URL('../pkg/dcp_ai_bg.wasm', import.meta.url)) });

const assemble = (part) => ({
  bundle: { dcp_bundle_version: '2.0', manifest: part.manifest, ...V.base.artifacts, audit_entries: part.audit_entries },
  signature: part.signature,
});
const failures = [];
let checks = 0;
const check = (name, ok, detail) => {
  checks += 1;
  if (!ok) failures.push(`${name}: ${JSON.stringify(detail)}`);
};

const cases = V.cases;
check('51 unique cases, 22 accept and 29 reject',
  cases.length === 51 && new Set(cases.map((c) => c.name)).size === 51 &&
  cases.filter((c) => c.expect === 'accept').length === 22 && cases.filter((c) => c.expect === 'reject').length === 29,
  cases.length);

// The vectors name dcp-jcs-v1 in the manifest, so the router must accept it to take the v1 route.
const candidate = dcp.createExperimentalCandidateVerifier({
  transport: 'bare', acceptedProfiles: ['dcp-jcs-v1', 'dcp-jcs-v2'], historical: experimentalWasmHistoricalAdapters.w1TextDecoderJsonParse,
});

for (const c of cases) {
  const ok = c.expect === 'accept';
  const r = dcp.verifyBundle(assemble(c));
  if (ok) {
    check(`${c.name}: accepted`, r.verified === true && r.errors.length === 0, r.errors);
  } else {
    check(`${c.name}: rejected with ${c.error_contains}`,
      r.verified === false && r.errors.some((e) => e.includes(c.error_contains)) && r.errors.every((e) => e.includes('secondary')), r.errors);
    const ctl = dcp.verifyBundle(assemble(c.control));
    check(`${c.name}: control accepted`, ctl.verified === true && ctl.errors.length === 0, ctl.errors);
  }
  const routed = candidate.verify(new TextEncoder().encode(JSON.stringify(assemble(c))));
  check(`${c.name}: candidate v1 route`, routed.entered === 'dcp-jcs-v1' && routed.verification?.verified === ok, routed.verification?.errors ?? routed.entered);
}

if (failures.length) {
  console.error(`secondary SHA3-256 (wasm): ${failures.length} of ${checks} checks failed`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`secondary SHA3-256 (wasm): ${checks} checks passed`);
