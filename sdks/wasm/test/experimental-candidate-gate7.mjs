// Gate 7, dcp-jcs-v1 side (docs/proposals/canonicalization-candidate/README.md §9): a defect of each unit class,
// injected at byte level into a dcp-jcs-v1 bundle, keeps today's verdict. The public fixture
// tests/interop/candidate/gate7-v1-negatives.json has 38 cases over the frozen phase 3 bases with a reasoned
// expectation for each of 10 configurations; this file runs the four WASM ones (152 checks) and, apart, the 3
// envelope boundary cases (12 checks; no equivalence claimed).
//
// For each case the experimental verifier (§17, bare, ["dcp-jcs-v1"]) over counted bindings, and today's route of
// the WASM package written out here (w1: the JS decoder, JSON.parse, then dcp.verifyBundle; w2: the JS decoder,
// then wasm_verify_signed_bundle_v2 on the text), get the same bytes, policy (the binding's default) and clock: the
// binding reads Date.now, so every call on both routes runs with Date.now fixed to the fixture's instant and
// restored in finally. Their results must be equal on every declared field and both must match the expectation.
// A parse failure the binding returns in band counts only in strict form and corroborated by the same serde
// refusing the same text (wasm_canonicalize_v2); a throw, an {"error"} envelope or an uncorroborated one is a
// verifier error, never parity and never a rejection. The public verifier must give the counted one's result.
//
// The experimental route is measured at the binding boundary: the calls to wasm_experimental_candidate_verify,
// _resume and wasm_verify_signed_bundle_v2 (the delegation, which is the dcp-jcs-v1 entry) are counted and checked
// (one verify; one resume per decoder consultation; one delegation exactly when dcp-jcs-v1 is entered). Each
// cryptographic call inside the WASM module is not instrumented.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as pkg from '../pkg/dcp_ai.js';
import * as entry from '../dist/index.js';
import { WasmCandidateVerifier } from '../dist/experimental-candidate-verify.js';

const { initDcp, experimentalWasmHistoricalAdapters: adapters, ExperimentalWasmCandidateAdapterError } = entry;
const root = new URL('../../../', import.meta.url);
const F = JSON.parse(readFileSync(new URL('tests/interop/candidate/gate7-v1-negatives.json', root), 'utf8'));
const P3 = JSON.parse(readFileSync(new URL('tests/interop/candidate/phase3-signed-vectors.json', root), 'utf8'));
const dcp = await initDcp({ module_or_path: readFileSync(new URL('../pkg/dcp_ai_bg.wasm', import.meta.url)) });

const failures = [];
let checks = 0;
const check = (name, ok, detail) => {
  checks += 1;
  if (!ok) failures.push(`${name}: ${JSON.stringify(detail)?.slice(0, 600)}`);
};

const MUTATIONS = Array.from({ length: 18 }, (_, i) => `M${String(i + 1).padStart(2, '0')}`);
const APPROVED = ['V1', 'AB'].flatMap((t) => ['C00', ...MUTATIONS].map((s) => `G7-${t}-${s}`));
const textDecoder = (u) => new TextDecoder().decode(u);
const bufferUtf8 = (u) => Buffer.from(u).toString('utf8');
const CONFIGS = {
  'wasm.w1TextDecoderJsonParse': { adapter: adapters.w1TextDecoderJsonParse, path: 'w1', decode: textDecoder },
  'wasm.w1BufferUtf8JsonParse': { adapter: adapters.w1BufferUtf8JsonParse, path: 'w1', decode: bufferUtf8 },
  'wasm.w2TextDecoder': { adapter: adapters.w2TextDecoder, path: 'w2', decode: textDecoder },
  'wasm.w2BufferUtf8': { adapter: adapters.w2BufferUtf8, path: 'w2', decode: bufferUtf8 },
};
// The binding's result as serialized: equality between the routes covers exactly these fields.
const DECLARED = ['verified', 'dcp_version', 'errors', 'warnings', 'classical_valid', 'pq_valid', 'session_binding_valid', 'manifest_valid', 'verification_mode', 'resolved_tier', 'signer_keys'];
const NOW = F.now_ms;
const REAL_NOW = Date.now;
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const plain = (v) => JSON.stringify(v, (_k, x) => (x instanceof Uint8Array ? Buffer.from(x).toString('hex') : x));

/** Date.now fixed to `ms` during one synchronous call, restored in finally (also when the call throws). */
function atNow(ms, call) {
  const real = Date.now;
  Date.now = () => ms;
  try {
    return call();
  } finally {
    Date.now = real;
  }
}

// The fixture's edit grammar, written here independently of the Python checker.
function applyEdits(base, edits) {
  let out = Buffer.from(base);
  for (const e of edits) {
    if ('prefix' in e) out = Buffer.concat([Buffer.from(e.prefix, 'utf8'), out]);
    else if ('prefix_hex' in e) out = Buffer.concat([Buffer.from(e.prefix_hex, 'hex'), out]);
    else if ('append' in e) out = Buffer.concat([out, Buffer.from(e.append, 'utf8')]);
    else if ('append_hex' in e) out = Buffer.concat([out, Buffer.from(e.append_hex, 'hex')]);
    else if ('drop_last' in e) out = out.subarray(0, out.length - e.drop_last);
    else if ('replace_once' in e) {
      const find = Buffer.from(e.replace_once, 'utf8');
      const at = out.indexOf(find);
      if (at < 0 || out.indexOf(find, at + 1) >= 0) throw new Error(`anchor not unique: ${e.replace_once}`);
      const w = 'with_hex' in e ? Buffer.from(e.with_hex, 'hex') : Buffer.from(e.with, 'utf8');
      out = Buffer.concat([out.subarray(0, at), w, out.subarray(at + find.length)]);
    } else throw new Error(`unknown edit ${JSON.stringify(e)}`);
  }
  return new Uint8Array(out);
}
const baseBytes = (name) => new Uint8Array(Buffer.from(P3.bases[name].input_json, 'utf8'));
const caseBytes = (c) => (c.mutation === null ? baseBytes(c.base) : applyEdits(baseBytes(c.base), F.mutations[c.mutation].edits));
const byId = (id) => F.cases.find((c) => c.id === id);

// ── Today's route, classified into exactly one outcome ──

/** The in-band shape of a parse failure: {verified: false, errors: ["JSON parse error: …"]} and nothing else. */
const strictParseFailure = (r) =>
  r !== null && typeof r === 'object' && plain(Object.keys(r).sort()) === '["errors","verified"]' && r.verified === false &&
  Array.isArray(r.errors) && r.errors.length === 1 && typeof r.errors[0] === 'string' && r.errors[0].startsWith('JSON parse error: ');

/** Classifies what the binding returned for `text` (the text it parsed). */
function classifyToday(text, r) {
  if (!strictParseFailure(r)) return { outcome: 'verified_result', result: r };
  let corroborated = false;
  try {
    const parsed = JSON.parse(pkg.wasm_canonicalize_v2(text));
    corroborated = typeof parsed?.error === 'string' && parsed.error.startsWith('JSON parse: ');
  } catch {
    corroborated = false;
  }
  if (!corroborated) return { outcome: 'verifier_error', message: `an in-band parse failure that serde does not corroborate: ${r.errors[0]}` };
  return { outcome: 'in_band_parse_error', kind: 'JSON parse error', result: r };
}

function today(cfg, bytes, now = NOW) {
  const { path, decode } = CONFIGS[cfg];
  const text = decode(bytes); // TextDecoder and Buffer replace ill-formed bytes; they never throw here
  if (path === 'w1') {
    let value;
    try {
      value = JSON.parse(text);
    } catch (e) {
      if (e instanceof SyntaxError || e instanceof RangeError) return { outcome: 'host_decode_error', kind: e.name };
      throw e; // infrastructure
    }
    let r;
    try {
      r = atNow(now, () => dcp.verifyBundle(value));
    } catch (e) {
      return { outcome: 'verifier_error', message: String(e?.message ?? e) };
    }
    return classifyToday(JSON.stringify(value), r);
  }
  let r;
  try {
    r = JSON.parse(atNow(now, () => pkg.wasm_verify_signed_bundle_v2(text, undefined)));
  } catch (e) {
    return { outcome: 'verifier_error', message: String(e?.message ?? e) };
  }
  if (r !== null && typeof r === 'object' && 'error' in r) return { outcome: 'verifier_error', message: `error envelope: ${r.error}` };
  return classifyToday(text, r);
}

// ── The experimental route over counted bindings ──

function experimental(cfg, bytes, transport = 'bare', now = NOW) {
  const { adapter } = CONFIGS[cfg];
  const calls = { adapter: 0, verify: 0, resume: 0, verifyBundle: 0 };
  try {
    const checked = JSON.parse(pkg.wasm_experimental_candidate_config(JSON.stringify({ transport, accepted_profiles: ['dcp-jcs-v1'], historical: adapter.name })));
    if (checked.config_error) throw new Error(JSON.stringify(checked));
    const verifier = new WasmCandidateVerifier({
      config: JSON.stringify(checked),
      normalized: checked,
      path: adapter.path,
      decode: (u) => (calls.adapter++, adapter.decode(u)),
      bindings: {
        verify: (i, c, p) => (calls.verify++, pkg.wasm_experimental_candidate_verify(i, c, p)),
        resume: (i, c, pt, h) => (calls.resume++, pkg.wasm_experimental_candidate_resume(i, c, pt, h)),
        verifyBundle: (text, p) => (calls.verifyBundle++, pkg.wasm_verify_signed_bundle_v2(text, p)),
      },
      adapterError: (a, m) => new ExperimentalWasmCandidateAdapterError(a, m),
    });
    const r = atNow(now, () => verifier.verify(bytes, undefined));
    const entries = [...Array(calls.verifyBundle).fill('dcp-jcs-v1'), ...(r.entered === 'dcp-jcs-v2' ? ['dcp-jcs-v2'] : [])];
    // The public verifier gives the counted one's result.
    const pub = atNow(now, () => dcp.createExperimentalCandidateVerifier({ transport, acceptedProfiles: ['dcp-jcs-v1'], historical: adapter }).verify(bytes));
    if (plain(pub) !== plain(r)) return { outcome: 'verifier_error', message: 'the public verifier differs from the counted one' };
    return { outcome: 'returned', value: r, calls: calls.adapter, entries, binding: { verify: calls.verify, resume: calls.resume, verifyBundle: calls.verifyBundle } };
  } catch (e) {
    return { outcome: 'verifier_error', message: String(e?.message ?? e) };
  }
}

// ── The judgement: pure, so the self-tests can feed it fakes ──

function routeShape(route, transport) {
  if (route.outcome === 'v1_path') {
    return { outcome: 'v1_path', profile_source: route.profileSource, warning_classes: route.warnings.map((w) => w.class), historical: 'decoded' in route.historical ? 'decoded' : 'failed' };
  }
  if (route.outcome === 'reject') return transport ? { outcome: 'reject', class: route.class, detail: route.detail } : { outcome: 'reject', class: route.class, offset: route.offset };
  return { outcome: route.outcome };
}

const undeclared = (r) => Object.keys(r).filter((k) => !DECLARED.includes(k));

function shapeProblems(r, name) {
  const s = F.verification_shapes[name];
  const p = [];
  if (r.verified !== s.verified) p.push(`verified ${r.verified}, expected ${s.verified}`);
  if (!Array.isArray(r.errors) || r.errors.length !== s.error_count) p.push(`${r.errors?.length} errors, expected ${s.error_count}: ${plain(r.errors)}`);
  for (const sub of s.errors_contain) if (!r.errors?.some((e) => e.includes(sub))) p.push(`no error contains ${plain(sub)}: ${plain(r.errors)}`);
  if (plain(r.warnings ?? null) !== plain(s.warnings)) p.push(`warnings ${plain(r.warnings)}, expected ${plain(s.warnings)}`);
  for (const [k, v] of Object.entries(s.fields)) if ((r[k] ?? null) !== v) p.push(`${k} ${plain(r[k])}, expected ${plain(v)}`);
  return p;
}

function judge(exp, t, x, transport = false) {
  if (x.outcome === 'verifier_error') return [`experimental verifier_error: ${x.message}`];
  if (t?.outcome === 'verifier_error') return [`today verifier_error: ${t.message}`];
  const p = [];
  const { route, entered, verification } = x.value;
  const got = routeShape(route, transport);
  if (plain(got) !== plain(exp.route)) p.push(`route ${plain(got)}, expected ${plain(exp.route)}`);
  if (x.calls !== exp.adapter_calls) p.push(`adapter calls ${x.calls}, expected ${exp.adapter_calls}`);
  if (entered !== exp.entered) p.push(`entered ${entered}, expected ${exp.entered}`);
  const wanted = exp.entered === 'none' ? [] : ['dcp-jcs-v1'];
  if (plain(x.entries) !== plain(wanted)) p.push(`verifier entries ${plain(x.entries)}, expected ${plain(wanted)}`);
  if (plain(x.entries) !== plain(entered === 'none' ? [] : [entered])) p.push(`verifier entries ${plain(x.entries)} contradict entered ${entered}`);
  // The binding calls: one verify, one resume per decoder consultation, one delegation exactly when entered.
  const b = x.binding;
  if (b?.verify !== 1) p.push(`binding verify calls ${b?.verify}, expected 1`);
  if (b?.resume !== exp.adapter_calls) p.push(`binding resume calls ${b?.resume}, expected ${exp.adapter_calls}`);
  if (b?.verifyBundle !== (exp.entered === 'dcp-jcs-v1' ? 1 : 0)) p.push(`binding verifyBundle calls ${b?.verifyBundle}, expected ${exp.entered === 'dcp-jcs-v1' ? 1 : 0}`);
  if (exp.verification === null) {
    if (verification !== null) p.push('a verification where none was expected');
  } else if (verification === null) p.push(`no verification, expected ${exp.verification}`);
  else {
    p.push(...undeclared(verification).map((k) => `experimental result has undeclared field ${k}`));
    p.push(...shapeProblems(verification, exp.verification).map((m) => `experimental: ${m}`));
  }
  if (t === null) return p;
  if (t.outcome !== exp.today.outcome) {
    p.push(`today ${t.outcome}, expected ${exp.today.outcome}`);
    return p;
  }
  if (t.outcome === 'host_decode_error') {
    if (t.kind !== exp.today.kind) p.push(`today decoder error ${t.kind}, expected ${exp.today.kind}`);
    if (entered !== 'none') p.push('today refused the bytes but the experimental route entered a verifier');
    return p;
  }
  if (t.outcome === 'in_band_parse_error' && t.kind !== exp.today.kind) p.push(`today in-band error ${t.kind}, expected ${exp.today.kind}`);
  if (t.outcome === 'verified_result') {
    p.push(...undeclared(t.result).map((k) => `today result has undeclared field ${k}`));
    if (exp.verification !== null) p.push(...shapeProblems(t.result, exp.verification).map((m) => `today: ${m}`));
    if (verification === null) p.push('today verified a result but the experimental route entered no verifier');
  }
  // An in-band failure pairs with no verifier (the unit was rejected) or with the same whole in-band result.
  if (verification !== null && plain(t.result) !== plain(verification)) {
    p.push(`the routes differ: today ${plain(t.result).slice(0, 300)} / experimental ${plain(verification).slice(0, 300)}`);
  }
  return p;
}

function runCase(c, cfg) {
  const bytes = caseBytes(c);
  const before = sha256(bytes);
  const t = today(cfg, bytes);
  const x = experimental(cfg, bytes);
  const problems = judge(c.expected[cfg], t, x);
  if (sha256(bytes) !== before) problems.push('the input buffer was changed');
  if (Date.now !== REAL_NOW) problems.push('Date.now was not restored');
  return { problems, t, x };
}

function gate(results) {
  // A failed or missing control invalidates every case of its base, in the same configuration.
  return results.map((r) => {
    if (r.id.endsWith('C00')) return r;
    const id = `${r.id.slice(0, 6)}C00`;
    const control = results.find((o) => o.cfg === r.cfg && o.id === id);
    if (!control) return { ...r, problems: [`control_missing: ${id}`, ...r.problems] };
    return control.problems.length === 0 ? r : { ...r, problems: [`control_failed: ${id}`, ...r.problems] };
  });
}

// ── Fixture ──
{
  const ids = F.cases.map((c) => c.id);
  check('exactly the 38 approved case IDs', plain([...ids].sort()) === plain([...APPROVED].sort()) && new Set(ids).size === 38, ids);
  check('10 configurations, the four WASM ones among them', F.configurations.length === 10 && Object.keys(CONFIGS).every((k) => F.configurations.includes(k)), F.configurations);
  check('every case expects the 10 configurations', F.cases.every((c) => plain(Object.keys(c.expected)) === plain(F.configurations)), null);
  check('the boundary IDs', plain(F.boundary.cases.map((c) => c.id)) === '["G7E-1","G7E-2","G7E-3"]', null);
  check('now_ms is the phase 3 instant', F.now_ms === P3.now_ms, [F.now_ms, P3.now_ms]);
  for (const b of ['B-v1', 'B-absent']) check(`base ${b} hash`, sha256(baseBytes(b)) === F.bases[b].input_sha256, b);
  for (const c of F.cases) check(`${c.id} input hash`, sha256(caseBytes(c)) === c.input_sha256, c.id);
  for (const c of F.boundary.cases) check(`${c.id} input hash`, sha256(applyEdits(baseBytes(c.base), c.edits)) === c.input_sha256, c.id);
}

// ── 38 cases x 4 WASM configurations ──
{
  const results = [];
  for (const cfg of Object.keys(CONFIGS)) for (const c of F.cases) results.push({ id: c.id, cfg, problems: runCase(c, cfg).problems });
  check('152 checks ran (completeness: zero executed checks can never pass)', results.length === 152, results.length);
  for (const r of gate(results)) check(`${r.cfg} ${r.id}`, r.problems.length === 0, r.problems);
}

// ── Envelope boundary (separate; no equivalence with any server) ──
{
  let n = 0;
  const control = byId('G7-V1-C00');
  for (const cfg of Object.keys(CONFIGS)) {
    const bare = experimental(cfg, caseBytes(control));
    for (const c of F.boundary.cases) {
      const x = experimental(cfg, applyEdits(baseBytes(c.base), c.edits), 'envelope');
      const problems = judge(c.expected[cfg], null, x, true);
      if (c.id === 'G7E-1' && x.outcome === 'returned' && bare.outcome === 'returned' && plain(x.value.verification) !== plain(bare.value.verification)) problems.push('G7E-1 differs from the bare control');
      check(`boundary ${cfg} ${c.id}`, problems.length === 0, problems);
      n++;
    }
  }
  check('12 boundary checks ran', n === 12, n);
}

// ── The judgement, the classifier and the clock can fail ──
{
  const cfg = 'wasm.w2TextDecoder';
  const control = byId('G7-V1-C00');
  const exp = control.expected[cfg];
  const has = (p, prefix) => p.some((m) => m.startsWith(prefix));

  // The clock: a binding call sees the instant; Date.now is restored after a call that throws.
  const late = experimental(cfg, caseBytes(control), 'bare', Date.parse('2100-01-02T00:00:00Z'));
  check('the experimental route at 2100 is reported', has(judge(exp, today(cfg, caseBytes(control)), late), 'the routes differ'), late);
  let thrown = null;
  try {
    atNow(1, () => {
      if (Date.now() !== 1) throw new Error('the synthetic instant is not seen');
      throw new Error('a call that throws');
    });
  } catch (e) {
    thrown = e;
  }
  check('Date.now is restored after a call that throws', thrown?.message === 'a call that throws' && Date.now === REAL_NOW, thrown?.message);

  // One changed error entry.
  const m10 = byId('G7-V1-M10');
  const r10 = runCase(m10, cfg);
  check('M10 passes before it is altered', r10.problems.length === 0, r10.problems);
  const altered = { ...r10.x, value: { ...r10.x.value, verification: { ...r10.x.value.verification, errors: ['intent: payload_hash mismatch (altered)'] } } };
  check('one changed error entry is reported', has(judge(m10.expected[cfg], r10.t, altered), 'the routes differ'), null);

  // A verifier error, even on both sides.
  const boom = { outcome: 'verifier_error', message: 'provider exploded' };
  check('a verifier error on both sides is never parity', plain(judge(exp, boom, boom)) === plain(['experimental verifier_error: provider exploded']), null);

  // A second, a candidate or a missing entry; an entry under G7E-2.
  const rc = runCase(control, cfg);
  check('the control enters once', plain(rc.x.entries) === '["dcp-jcs-v1"]', rc.x.entries);
  for (const entries of [['dcp-jcs-v1', 'dcp-jcs-v1'], ['dcp-jcs-v2'], []]) {
    check(`entries ${plain(entries)} are reported`, has(judge(exp, rc.t, { ...rc.x, entries }), 'verifier entries'), entries);
  }
  const g7e2 = F.boundary.cases.find((c) => c.id === 'G7E-2');
  const rejected = experimental(cfg, applyEdits(baseBytes(g7e2.base), g7e2.edits), 'envelope');
  check('G7E-2 enters no verifier', plain(rejected.entries) === '[]', rejected.entries);
  check('an entry under G7E-2 is reported', has(judge(g7e2.expected[cfg], null, { ...rejected, entries: ['dcp-jcs-v1'] }, true), 'verifier entries'), null);

  // Binding calls that are counted are also checked: an extra verify or resume, or a delegation under entered: none.
  check('the control makes one verify, one resume and one delegation', plain(rc.x.binding) === '{"verify":1,"resume":1,"verifyBundle":1}', rc.x.binding);
  check('G7E-2 makes one verify and no resume or delegation', plain(rejected.binding) === '{"verify":1,"resume":0,"verifyBundle":0}', rejected.binding);
  for (const [label, binding] of [['an extra verify', { ...rc.x.binding, verify: 2 }], ['an extra resume', { ...rc.x.binding, resume: 2 }], ['no delegation', { ...rc.x.binding, verifyBundle: 0 }]]) {
    check(`${label} is reported`, has(judge(exp, rc.t, { ...rc.x, binding }), 'binding '), binding);
  }
  check('a delegation under entered: none is reported', has(judge(g7e2.expected[cfg], null, { ...rejected, binding: { ...rejected.binding, verifyBundle: 1 } }, true), 'binding verifyBundle'), null);
  const m04 = byId('G7-V1-M04');
  const r04 = runCase(m04, cfg);
  check('a decoder refusal makes one resume and no delegation', r04.problems.length === 0 && plain(r04.x.binding) === '{"verify":1,"resume":1,"verifyBundle":0}', [r04.problems, r04.x.binding]);
  check('a delegation after a decoder refusal is reported', has(judge(m04.expected[cfg], r04.t, { ...r04.x, binding: { ...r04.x.binding, verifyBundle: 1 } }), 'binding verifyBundle'), null);

  // A missing control.
  check('a missing control never passes', plain(gate([{ id: 'G7-V1-M01', cfg, problems: [] }])[0].problems) === '["control_missing: G7-V1-C00"]', null);

  // The in-band classifier: a fake parse failure on valid text is a verifier error; the real one is recognized;
  // the same shape with another field is a result.
  const validText = Buffer.from(caseBytes(control)).toString('utf8');
  const invalidText = Buffer.from(caseBytes(byId('G7-V1-M04'))).toString('utf8');
  const fake = { verified: false, errors: ['JSON parse error: invented'] };
  const fakeOnValid = classifyToday(validText, fake);
  check('a fake parse failure on valid text is a verifier error', fakeOnValid.outcome === 'verifier_error' && fakeOnValid.message.includes('does not corroborate'), fakeOnValid);
  const realResult = JSON.parse(atNow(NOW, () => pkg.wasm_verify_signed_bundle_v2(invalidText, undefined)));
  const real = classifyToday(invalidText, realResult);
  check('the real in-band parse failure is recognized', real.outcome === 'in_band_parse_error' && real.kind === 'JSON parse error' && real.result === realResult, real);
  check('the same shape with a warnings field is a result', classifyToday(invalidText, { ...fake, warnings: [] }).outcome === 'verified_result', null);

  // Fakes that reject or accept everything.
  const rejectAll = gate(F.cases.map((c) => ({
    id: c.id,
    cfg,
    problems: judge(c.expected[cfg], { outcome: 'host_decode_error', kind: 'SyntaxError' }, { outcome: 'returned', calls: 1, entries: [], binding: { verify: 1, resume: 1, verifyBundle: 0 }, value: { route: { outcome: 'reject', class: 'SYNTAX', offset: 0 }, entered: 'none', verification: null } }),
  })));
  check('a reject-everything fake passes nothing', rejectAll.every((o) => o.problems.length > 0), rejectAll.filter((o) => o.problems.length === 0).map((o) => o.id));
  check('a reject-everything fake fails its controls', rejectAll.filter((o) => o.problems[0]?.startsWith('control_failed')).length === 36, null);
  const negatives = F.cases.filter((c) => c.expected[cfg].verification !== 'wasm.ok');
  const acceptAll = negatives.filter((c) => judge(c.expected[cfg], rc.t, rc.x).length === 0).map((c) => c.id);
  check('an accept-everything fake fails every negative', negatives.length > 10 && acceptAll.length === 0, acceptAll);
}

if (failures.length) {
  console.error(`experimental candidate gate 7 (wasm): ${failures.length} of ${checks} checks failed`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`experimental candidate gate 7 (wasm): ${checks} checks passed`);
