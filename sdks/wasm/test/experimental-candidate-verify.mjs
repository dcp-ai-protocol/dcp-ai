// EXPERIMENTAL candidate dcp-jcs-v2, phase 3: the wasm verifier of original bytes against the public
// signed vectors (tests/interop/candidate/phase3-signed-vectors.json), with the four JS historical
// adapters, and the controls of the contract: one verify call, the decoder consulted once and resume
// never verifying, the delegated string being the decoder's own (with the policy JSON verifyBundle
// sends), parity with the binding called directly, the canonical bytes of every committed value, the
// profile policy, a decoder refusal versus a decoded null, mutated buffers, and today's binding still
// refusing dcp-jcs-v2. The bindings are counted through the internal module, which the package entry
// point does not export. Needs `npm run build:wasm` and `npm run build:ts` first.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as pkg from '../pkg/dcp_ai.js';
import * as entry from '../dist/index.js';
import { WasmCandidateVerifier } from '../dist/experimental-candidate-verify.js';

const { initDcp, experimentalWasmHistoricalAdapters: adapters, ExperimentalWasmCandidateConfigError, ExperimentalWasmCandidateAdapterError } = entry;
const root = new URL('../../../', import.meta.url);
const vectors = JSON.parse(readFileSync(new URL('tests/interop/candidate/phase3-signed-vectors.json', root), 'utf8'));

// The 57 case IDs approved for phase 3, written here: the vectors must carry exactly these, each once.
const APPROVED_IDS = [
  'P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08',
  'P09', 'P10', 'P11', 'P12', 'P13-800', 'P13-801', 'P13-5000', 'P14',
  'R01', 'R02', 'R03', 'R04', 'R05a', 'R05b-v2', 'R06', 'R07',
  'R08', 'R09', 'R10', 'R11', 'R12', 'R13', 'R14', 'R15',
  'R16', 'F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F07',
  'F08', 'F09', 'F10', 'F11', 'F12', 'F13', 'F14', 'D01',
  'D02', 'D03', 'D04', 'R05b-both', 'D05', 'D06', 'D07', 'D08',
  'D09',
];

/** Why `ids` is not exactly the approved set, each once (repeated, missing, unknown), or null. */
function idProblem(ids) {
  const seen = new Set();
  const repeated = ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
  const missing = APPROVED_IDS.filter((id) => !seen.has(id));
  const unknown = [...seen].filter((id) => !APPROVED_IDS.includes(id));
  return repeated.length + missing.length + unknown.length === 0 ? null : JSON.stringify({ repeated, missing, unknown });
}

// Checked before any case runs: a missing, repeated or unknown ID stops the test.
const vectorIdProblem = idProblem(vectors.cases.map((c) => c.id));
if (vectorIdProblem !== null) {
  console.error(`experimental candidate verify (wasm): not the approved case IDs: ${vectorIdProblem}`);
  process.exit(1);
}

const dcp = await initDcp({ module_or_path: readFileSync(new URL('../pkg/dcp_ai_bg.wasm', import.meta.url)) });

const failures = [];
let checks = 0;
const check = (name, ok, detail) => {
  checks += 1;
  if (!ok) failures.push(`${name}: ${JSON.stringify(detail)?.slice(0, 400)}`);
};
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const byId = (id) => vectors.cases.find((c) => c.id === id);

/** The input of a case: its base, then each edit in order on the bytes. */
function input(c) {
  let buf = Buffer.from(vectors.bases[c.input.base].input_json, 'latin1');
  for (const e of c.input.edits) {
    if ('find' in e) {
      const find = Buffer.from(e.find, 'latin1');
      const i = buf.indexOf(find);
      if (i < 0 || buf.indexOf(find, i + 1) >= 0) throw new Error(`${c.id}: find must occur exactly once`);
      const by = 'replace' in e ? Buffer.from(e.replace, 'latin1') : Buffer.from(e.replace_hex, 'hex');
      buf = Buffer.concat([buf.subarray(0, i), by, buf.subarray(i + find.length)]);
    } else if ('prefix' in e) buf = Buffer.concat([Buffer.from(e.prefix, 'latin1'), buf, Buffer.from(e.suffix, 'latin1')]);
    else if ('prefix_hex' in e) buf = Buffer.concat([Buffer.from(e.prefix_hex, 'hex'), buf]);
    else if ('drop_last' in e) buf = buf.subarray(0, buf.length - e.drop_last);
    else throw new Error(`${c.id}: unknown edit`);
  }
  return new Uint8Array(buf);
}

/** The default by omission, as a caller of verifyBundle; any other policy as written in the file. */
const policyOf = (c) => (c.verifier_policy === 'default' ? undefined : vectors.verifier_policies[c.verifier_policy]);

/** A verifier over counted bindings and a counted adapter; the configuration is checked as the entry point does. */
function counted(c, adapter) {
  const calls = { adapter: 0, verify: 0, resume: 0, verifyBundle: [] };
  const checked = JSON.parse(pkg.wasm_experimental_candidate_config(JSON.stringify({ transport: c.transport, accepted_profiles: c.accepted_profiles, historical: adapter.name })));
  if (checked.config_error) throw new Error(JSON.stringify(checked));
  const verifier = new WasmCandidateVerifier({
    config: JSON.stringify(checked),
    normalized: checked,
    path: adapter.path,
    decode: (u) => (calls.adapter++, adapter.decode(u)),
    bindings: {
      verify: (i, cfg, p) => (calls.verify++, pkg.wasm_experimental_candidate_verify(i, cfg, p)),
      resume: (i, cfg, pt, h) => (calls.resume++, pkg.wasm_experimental_candidate_resume(i, cfg, pt, h)),
      verifyBundle: (text, p) => (calls.verifyBundle.push({ text, p }), pkg.wasm_verify_signed_bundle_v2(text, p)),
    },
    adapterError: (a, m) => new ExperimentalWasmCandidateAdapterError(a, m),
  });
  return { calls, verifier };
}

/** JSON with typed arrays as hex, to compare results. */
const plain = (v) => JSON.stringify(v, (_k, x) => (x instanceof Uint8Array ? Buffer.from(x).toString('hex') : x));

function checkCase(label, r, exp) {
  const er = exp.route;
  check(`${label} outcome`, r.route.outcome === er.outcome, [r.route.outcome, er.outcome]);
  for (const k of ['class', 'detail', 'offset', 'profile']) if (k in er) check(`${label} ${k}`, r.route[k] === er[k], [r.route[k], er[k]]);
  if ('profile_source' in er) check(`${label} profile source`, r.route.profileSource === er.profile_source, [r.route.profileSource, er.profile_source]);
  if ('warning_classes' in er) check(`${label} warnings`, plain(r.route.warnings.map((w) => w.class)) === plain(er.warning_classes), r.route.warnings);
  if ('historical' in er) check(`${label} historical`, ('decoded' in r.route.historical ? 'decoded' : 'failed') === er.historical, r.route.historical);
  check(`${label} entered`, r.entered === exp.entered, [r.entered, exp.entered]);
  if (exp.verification === null) {
    check(`${label} no verification`, r.verification === null, r.verification);
    return;
  }
  const v = r.verification;
  check(`${label} verified`, v?.verified === exp.verification.verified, v?.errors);
  if (exp.verification.verified) check(`${label} no errors`, (v?.errors ?? []).length === 0, v?.errors);
  for (const s of exp.verification.errors_contain.wasm) check(`${label} error ${s}`, (v?.errors ?? []).some((e) => e.includes(s)), v?.errors);
}

// ── The approved IDs, and a missing, repeated or unknown one refused (in memory) ──
{
  const ids = vectors.cases.map((c) => c.id);
  check('exactly the approved IDs', idProblem(ids) === null && idProblem(APPROVED_IDS) === null, idProblem(ids));
  check('a missing ID is refused', idProblem(ids.filter((id) => id !== 'F07')) === '{"repeated":[],"missing":["F07"],"unknown":[]}', null);
  check('a repeated ID is refused', idProblem([...ids, 'D03']) === '{"repeated":["D03"],"missing":[],"unknown":[]}', null);
  check('an unknown ID is refused', idProblem(ids.map((id) => (id === 'P05' ? 'P99' : id))) === '{"repeated":[],"missing":["P05"],"unknown":["P99"]}', null);
}

// ── The 57 cases with the four adapters ──
for (const c of vectors.cases) {
  const bytes = input(c);
  check(`${c.id} input hash`, sha256(bytes) === c.input_sha256, c.id);
  for (const adapter of Object.values(adapters)) {
    const label = `${c.id} (${adapter.name})`;
    const exp = c.by_adapter?.[`wasm:${adapter.name}`] ?? c.expected;
    const policy = policyOf(c);
    const policyJson = policy === undefined ? undefined : JSON.stringify(policy);
    const { calls, verifier } = counted(c, adapter);
    let r;
    try {
      r = verifier.verify(bytes, policy);
    } catch (e) {
      check(`${label} no exception`, false, `${e?.name}: ${e?.message}`);
      continue;
    }
    checkCase(label, r, exp);
    check(`${label} one verify call`, calls.verify === 1, calls.verify);
    check(`${label} adapter calls`, calls.adapter === exp.adapter_calls, [calls.adapter, exp.adapter_calls]);
    check(`${label} resume only after the decoder`, calls.resume === calls.adapter, calls);
    check(`${label} delegations`, calls.verifyBundle.length === (exp.entered === 'dcp-jcs-v1' ? 1 : 0), calls.verifyBundle.length);
    if (calls.verifyBundle.length === 1) {
      // The decoder's own string and verifyBundle's policy JSON, and the binding's own result.
      const own = adapter.decode(r.route.unit.bytes);
      check(`${label} delegated string`, own.ok && calls.verifyBundle[0].text === own.text && calls.verifyBundle[0].p === policyJson, calls.verifyBundle[0].p);
      check(`${label} parity`, plain(r.verification) === plain(JSON.parse(pkg.wasm_verify_signed_bundle_v2(own.text, policyJson))), null);
    }
    if (r.route.outcome === 'candidate' && exp.manifest_sha256 !== undefined) {
      const unit = JSON.parse(new TextDecoder().decode(r.route.canonical));
      const manifest = pkg.wasm_canonicalize_v2(JSON.stringify(unit.bundle.manifest));
      check(`${label} canonical hash`, r.route.canonicalSha256 === exp.canonical_sha256, r.route.canonicalSha256);
      check(`${label} manifest hash`, `sha256:${sha256(manifest)}` === exp.manifest_sha256 && unit.signature.manifest_hash === exp.manifest_sha256, manifest.slice(0, 60));
    }
    // The public verifier gives the same result.
    const pub = dcp.createExperimentalCandidateVerifier({ transport: c.transport, acceptedProfiles: c.accepted_profiles, historical: adapter }).verify(bytes, policy);
    check(`${label} public verifier`, plain(pub) === plain(r), null);
  }
}

// ── Canonical bytes of every committed value of the positives (through the wasm bindings) ──
const committed = (unit) => {
  const b = unit.bundle;
  const roots = [unit, b.manifest, ...['responsible_principal_record', 'agent_passport', 'intent', 'policy_decision'].map((n) => b[n].payload), ...b.audit_entries];
  for (const { composite_sig: _s, ...payload } of b.pq_checkpoints ?? []) roots.push(payload);
  const out = [];
  const walk = (v) => {
    if (v === null || typeof v !== 'object') return;
    out.push(v);
    for (const k of Object.keys(v)) walk(v[k]);
  };
  roots.forEach(walk);
  return out;
};
const positives = vectors.cases.filter((c) => c.expected.manifest_sha256 !== undefined);
check('16 positives', positives.length === 16, positives.length);
for (const c of positives) {
  const r = dcp.createExperimentalCandidateVerifier({ transport: c.transport, acceptedProfiles: c.accepted_profiles, historical: adapters.w2TextDecoder }).verify(input(c));
  const values = committed(JSON.parse(new TextDecoder().decode(r.route.canonical)));
  if (c.id === 'P10') check('P10 checkpoint committed', values.some((v) => Object.hasOwn(v, 'checkpoint_id')), null);
  let ok = true;
  for (const v of values) {
    const canonical = pkg.wasm_canonicalize_v2(JSON.stringify(v));
    const again = JSON.parse(pkg.wasm_experimental_candidate_ingress(new TextEncoder().encode(canonical)));
    ok &&= again.status === 'accept' && again.canonical === canonical;
  }
  check(`${c.id} canonical bytes of ${values.length} committed values`, ok, null);
}

// ── Controls ──
const D01 = byId('D01');
const P01 = byId('P01');
for (const acceptedProfiles of [undefined, null, [], ['dcp-jcs-v3'], ['dcp-jcs-v2', 'dcp-jcs-v2']]) {
  let thrown;
  try {
    dcp.createExperimentalCandidateVerifier({ transport: 'bare', acceptedProfiles, historical: adapters.w2TextDecoder });
  } catch (e) {
    thrown = e;
  }
  check(`profile policy ${JSON.stringify(acceptedProfiles)}`, thrown instanceof ExperimentalWasmCandidateConfigError && thrown.code === 'POLICY_INVALID', thrown?.message);
}
{
  const refuses = { name: 'refuses', path: 'w1', decode: () => ({ ok: false, reason: 'refused by the test' }) };
  const { calls, verifier } = counted(D01, refuses);
  const r = verifier.verify(input(D01));
  check('a decoder refusal is not delegated', r.route.outcome === 'v1_path' && r.route.historical.failed === 'refused by the test' && r.entered === 'none' && r.verification === null && calls.verifyBundle.length === 0, r);
}
{
  const decodesNull = { name: 'decodes-null', path: 'w2', decode: () => ({ ok: true, text: 'null' }) };
  const { calls, verifier } = counted(D01, decodesNull);
  const r = verifier.verify(input(D01));
  check('a decoded null is delegated', r.entered === 'dcp-jcs-v1' && calls.verifyBundle.length === 1 && calls.verifyBundle[0].text === 'null' && r.verification.verified === false, r.verification);
}
{
  const throws = { name: 'throws', path: 'w1', decode: () => { throw new Error('boom'); } };
  const { calls, verifier } = counted(D01, throws);
  let thrown;
  try {
    verifier.verify(input(D01));
  } catch (e) {
    thrown = e;
  }
  check('an adapter that throws is an adapter error, and no verifier runs', thrown instanceof ExperimentalWasmCandidateAdapterError && calls.verifyBundle.length === 0, thrown?.message);
}
{
  const verifier = dcp.createExperimentalCandidateVerifier({ transport: 'bare', acceptedProfiles: ['dcp-jcs-v1'], historical: adapters.w1TextDecoderJsonParse });
  const reference = plain(verifier.verify(input(D01)));
  const mutates = { name: adapters.w1TextDecoderJsonParse.name, path: 'w1', decode: (u) => { const out = adapters.w1TextDecoderJsonParse.decode(u); u.fill(0x20); return out; } };
  const bytes = input(D01);
  const r = dcp.createExperimentalCandidateVerifier({ transport: 'bare', acceptedProfiles: ['dcp-jcs-v1'], historical: mutates }).verify(bytes);
  bytes.fill(0x7b);
  check('mutations by the adapter or the caller change nothing', plain(r) === reference && sha256(r.route.unit.bytes) === D01.input_sha256 && r.verification.verified === true, null);
}
{
  const today = JSON.parse(pkg.wasm_verify_signed_bundle_v2(Buffer.from(input(P01)).toString('utf8'), undefined));
  check("today's binding still refuses dcp-jcs-v2", today.verified === false && today.errors.includes('Unknown canonicalization_profile: dcp-jcs-v2'), today.errors);
}
check('the entry point does not export the internal verifier', !('WasmCandidateVerifier' in entry) && typeof dcp.createExperimentalCandidateVerifier === 'function', Object.keys(entry));

if (failures.length > 0) {
  console.error(`experimental candidate verify (wasm): ${failures.length} of ${checks} checks failed`);
  for (const f of failures.slice(0, 40)) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`experimental candidate verify (wasm): ${checks} checks passed (the 57 approved cases x 4 adapters, committed values, controls)`);
