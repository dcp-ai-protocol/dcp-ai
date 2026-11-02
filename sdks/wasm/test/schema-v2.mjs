// V2-2 in the built wasm package: wasm_verify_signed_bundle_v2 (directly and through DcpWasm.verifyBundle) and the
// experimental candidate verifier, over the signed cases of tests/interop/v2/schema_validation/, with the deeper checks
// the historical rows used to reach kept covered (deep_negatives.json). The binding's version dispatch and JSON parse
// stay before the V2 verifier, which now runs V2-2 first; each rejection is classified by the layer that made it.
// Needs `npm run build:wasm` and `npm run build:ts` first.
import { readFileSync } from 'node:fs';
import * as pkg from '../pkg/dcp_ai.js';
import { initDcp, experimentalWasmHistoricalAdapters } from '../dist/index.js';

const shared = (rel) => JSON.parse(readFileSync(new URL(`../../../tests/interop/v2/${rel}`, import.meta.url), 'utf8'));
const W = shared('schema_validation/wiring_cases.json');
const DEEP = shared('schema_validation/deep_negatives.json');
const P3 = shared('../candidate/phase3-signed-vectors.json');
const dcp = await initDcp({ module_or_path: readFileSync(new URL('../pkg/dcp_ai_bg.wasm', import.meta.url)) });

// The binding reads the JavaScript clock: each group runs at its fixture's instant, and the clock is always restored.
const REAL_NOW = Date.now;
const at = (instant, fn) => {
  Date.now = () => instant;
  try {
    return fn();
  } finally {
    Date.now = REAL_NOW;
  }
};
const W_NOW = Date.parse(W.verification_time);
const DEEP_NOW = Date.parse(DEEP.verification_time);

const failures = [];
let checks = 0;
const check = (name, ok, detail) => {
  checks += 1;
  if (!ok) failures.push(`${name}: ${JSON.stringify(detail)}`);
};
const binding = (text, policy) => JSON.parse(pkg.wasm_verify_signed_bundle_v2(text, policy === undefined ? undefined : JSON.stringify(policy)));
const target = (c) => `schema: ${c.target.instance || '/'} ${c.target.keyword}`;
const named = (errors, t) => errors.some((e) => e === t || e.startsWith(`${t} `));
const v22Only = (r, t) => r.verified === false && r.errors.length > 0 && r.errors.every((e) => e.startsWith('schema: ')) && named(r.errors, t)
  && JSON.stringify(r.signer_keys) === '[]' && r.manifest_valid === false && r.session_binding_valid === false;

// ── The 57 signed cases through the binding and the facade ──
at(W_NOW, () => {
  check('57 cases', W.cases.length === 57, W.cases.length);
  let verified = 0;
  let v22 = 0;
  for (const c of W.cases) {
    const text = c.signed_bundle_text ?? JSON.stringify(c.signed_bundle);
    const r = binding(text, W.verifier_policy);
    const viaFacade = dcp.verifyBundle(JSON.parse(text), W.verifier_policy);
    check(`${c.name}: the facade reaches the same binding result`, JSON.stringify(viaFacade.errors) === JSON.stringify(r.errors) && viaFacade.verified === r.verified, viaFacade.errors);
    if (c.expect.verified) {
      check(`${c.name}: verified`, r.verified === true && r.errors.length === 0, r.errors);
      verified += 1;
    } else {
      check(`${c.name}: refused by V2-2 alone`, v22Only(r, target(c)), r.errors);
      v22 += 1;
    }
  }
  check('13 verified, 44 refused by V2-2 (none by the version dispatch)', verified === 13 && v22 === 44, [verified, v22]);
  for (const name of ['c4_session_expires_at_null', 'c4_session_issued_at_null']) {
    const c = W.cases.find((x) => x.name === name);
    const r = binding(JSON.stringify(c.signed_bundle), W.verifier_policy);
    check(`${name}: exactly the null type`, r.verified === false && JSON.stringify(r.errors) === JSON.stringify([`schema: ${c.target.instance} type`]), r.errors);
  }
});

// ── Layers before V2-2: policy parse, JSON parse, version dispatch, the error budget ──
at(W_NOW, () => {
  const base = W.cases.find((c) => c.name === 'base').signed_bundle;
  const text = JSON.stringify(base);
  const bad = JSON.parse(pkg.wasm_verify_signed_bundle_v2(JSON.stringify({ x: 1 }), '{"default_mode":"classical_only"}'));
  check('policy parse error first', bad.verified === false && bad.errors.length === 1 && bad.errors[0].startsWith('Policy parse error'), bad.errors);
  const unenforced = binding(JSON.stringify({ ...base, x: 1 }), { ...W.verifier_policy, min_classical: 5 });
  check('policy contract first', unenforced.verified === false && unenforced.errors.length === 1 && unenforced.errors[0].includes('does not enforce'), unenforced.errors);
  for (const raw of [text.replace('"legal_name":"', '"legal_name":"\\ud800'), text.replace('"audit_count":3', '"audit_count":1e400'), '{"bundle":']) {
    const r = JSON.parse(pkg.wasm_verify_signed_bundle_v2(raw, undefined));
    check(`JSON parse error before V2-2: ${raw.slice(0, 20)}`, r.verified === false && r.errors.length === 1 && r.errors[0].startsWith('JSON parse error'), r.errors);
  }
  // The facade stringifies JS values: a lone surrogate is written as its escape, which serde_json refuses.
  const lone = structuredClone(base);
  lone.bundle.responsible_principal_record.payload.legal_name = '\ud800';
  const lr = dcp.verifyBundle(lone);
  check('a lone surrogate through the facade is a JSON parse error', lr.verified === false && lr.errors.length === 1 && lr.errors[0].startsWith('JSON parse error'), lr.errors);
  const noVersion = structuredClone(base);
  delete noVersion.bundle.dcp_bundle_version;
  const nv = binding(JSON.stringify(noVersion));
  check('no V2 marker: the version dispatch refuses it first', nv.verified === false && JSON.stringify(nv.errors) === '["Unknown DCP version"]', nv.errors);
  const nullRoot = JSON.parse(pkg.wasm_verify_signed_bundle_v2('null', undefined));
  check('a null root: the version dispatch', nullRoot.verified === false && JSON.stringify(nullRoot.errors) === '["Unknown DCP version"]', nullRoot.errors);
  const many = structuredClone(base);
  for (let i = 0; i < 40; i++) many[`x_${String(i).padStart(2, '0')}`] = i;
  const mr = binding(JSON.stringify(many));
  check('over 16 errors: cut with the marker, still refused', mr.verified === false && mr.errors.length === 17 && mr.errors[16] === 'schema: further errors not listed'
    && mr.errors.slice(0, 16).every((e) => e.startsWith('schema: / additionalProperties x_')), mr.errors);
});

// ── The deep negatives reach the temporal parsers and the canonicalizer past V2-2, after their positive control ──
at(DEEP_NOW, () => {
  const control = binding(JSON.stringify(W.cases.find((c) => c.name === 'base').signed_bundle), DEEP.verifier_policy);
  check('deep negatives: their control (the wiring base they are built from) verifies', control.verified === true && control.errors.length === 0, control.errors);
  check('7 deep negatives', DEEP.cases.length === 7, DEEP.cases.length);
  for (const c of DEEP.cases) {
    const r = binding(JSON.stringify(c.signed_bundle), DEEP.verifier_policy);
    const want = c.error_contains_by_sdk.wasm;
    check(`${c.name}: past V2-2 with the wasm wording`, typeof want === 'string' && r.verified === false && !r.errors.some((e) => e.startsWith('schema: '))
      && r.errors.join('\n').toLowerCase().includes(want.toLowerCase()), r.errors);
  }
});

// ── The candidate: success, schema rejection on its route, no opt-in, default separation ──
{
  const adapter = experimentalWasmHistoricalAdapters.w1TextDecoderJsonParse;
  const optIn = dcp.createExperimentalCandidateVerifier({ transport: 'bare', acceptedProfiles: ['dcp-jcs-v2'], historical: adapter });
  const v1Only = dcp.createExperimentalCandidateVerifier({ transport: 'bare', acceptedProfiles: ['dcp-jcs-v1'], historical: adapter });
  const text = P3.bases['B-v2'].input_json;
  const enc = (s) => new TextEncoder().encode(s);
  at(P3.now_ms, () => {
    const ok = optIn.verify(enc(text));
    check('candidate positive', ok.entered === 'dcp-jcs-v2' && ok.verification?.verified === true, ok.verification?.errors);
    const bad = optIn.verify(enc(`{"x_ext":1,${text.trimStart().slice(1)}`));
    check('candidate schema negative', bad.entered === 'dcp-jcs-v2' && v22Only(bad.verification, 'schema: / additionalProperties x_ext'), bad.verification?.errors);
    const today = binding(text);
    check('no opt-in: the default binding refuses dcp-jcs-v2 by V2-2', today.verified === false
      && JSON.stringify(today.errors) === '["schema: /bundle/manifest/canonicalization_profile const"]', today.errors);
    const sep = v1Only.verify(enc(text));
    check('a v1-only verifier does not take the candidate', sep.entered === 'none' && sep.verification === null, sep.route);
  });
  at(W_NOW, () => {
    const base = JSON.stringify(W.cases.find((c) => c.name === 'base').signed_bundle);
    const refused = optIn.verify(enc(base));
    check('a candidate-only verifier does not take dcp-jcs-v1', refused.entered === 'none' && refused.route.class === 'PROFILE_NOT_ACCEPTED', refused.route);
    const v1 = v1Only.verify(enc(base));
    check('a v1-only verifier verifies dcp-jcs-v1', v1.entered === 'dcp-jcs-v1' && v1.verification?.verified === true, v1.verification?.errors);
  });
}
check('the clock is restored', Date.now === REAL_NOW, null);

if (failures.length) {
  console.error(`schema V2-2 (wasm): ${failures.length} of ${checks} checks failed`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`schema V2-2 (wasm): ${checks} checks passed (57 signed cases x binding and facade, layers before V2-2, 7 deep negatives, candidate)`);
