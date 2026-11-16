// EXPERIMENTAL candidate router (phase 2) through the built package: the JS wrapper, its historical
// decoders (the w1 object path and the w2 text path, measured apart), and the real wasm route/resume
// bindings, including direct calls that misuse resume. Needs `npm run build:wasm` and `npm run build:ts`.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as pkg from '../pkg/dcp_ai.js';
import {
  initDcp,
  experimentalWasmHistoricalAdapters as A,
  ExperimentalWasmCandidateAdapterError,
  ExperimentalWasmCandidateConfigError,
} from '../dist/index.js';

const root = new URL('../../../', import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const design = read('docs/proposals/canonicalization-candidate/corpus.json').cases;
const fixture = read('tests/interop/candidate/phase2-adapter-expectations.json');
const vectors = read('tests/interop/v2/bundle_vectors.json');
const admission = read('tests/interop/v2/admission_vectors.json');
const dcp = await initDcp({ module_or_path: readFileSync(new URL('../pkg/dcp_ai_bg.wasm', import.meta.url)) });

const failures = [];
let checks = 0;
const check = (name, ok, detail) => {
  checks += 1;
  if (!ok) failures.push(`${name}: ${JSON.stringify(detail)}`);
};
const sha = (b) => createHash('sha256').update(b).digest('hex');
const utf8 = (s) => new TextEncoder().encode(s);
const join = (...parts) => new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...utf8(p)] : [...p])));
const inputOf = (c) => new Uint8Array(c.input_hex !== undefined ? Buffer.from(c.input_hex, 'hex') : Buffer.from(c.input_json, 'utf8'));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const throws = (fn, cls) => {
  try {
    fn();
  } catch (e) {
    return e instanceof cls;
  }
  return false;
};
const counting = (inner) => {
  const adapter = { name: inner.name, path: inner.path, calls: 0, decode: (u) => (adapter.calls++, inner.decode(u)) };
  return adapter;
};
const BOTH = ['dcp-jcs-v1', 'dcp-jcs-v2'];
const create = (historical, acceptedProfiles = BOTH, transport = 'bare') => dcp.createExperimentalCandidateRouter({ transport, acceptedProfiles, historical });
const unitWith = (profile, extra = '') => utf8(`{"bundle":{"manifest":{"canonicalization_profile":${profile}}},"signature":{}${extra}}`);
const bomV1 = join([0xef, 0xbb, 0xbf], unitWith('"dcp-jcs-v1"'));
const obsolete = (c) => c.options?.depth_scope === 'transport';

// Configuration, before any input, and a private snapshot.
for (const c of design.filter((c) => c.group === 'configuration')) {
  let err = null;
  try {
    dcp.createExperimentalCandidateRouter({ transport: 'bare', acceptedProfiles: c.policy, historical: A.w2TextDecoder });
  } catch (e) {
    err = e;
  }
  check(`config ${c.id}`, err instanceof ExperimentalWasmCandidateConfigError && err.code === c.expected.class && err.detail === c.expected.detail, String(err));
}
check('config transport', throws(() => create(A.w2TextDecoder, BOTH, 'header'), ExperimentalWasmCandidateConfigError), null);
check('config adapter', throws(() => create({ name: 'x', path: 'w3', decode: () => ({ ok: false, reason: '' }) }), ExperimentalWasmCandidateConfigError), null);
{
  // Strict types before anything is serialized: no boxed strings, no toJSON, no bigint, no raw TypeError.
  const detail = (config) => {
    try {
      dcp.createExperimentalCandidateRouter(config);
    } catch (e) {
      return e instanceof ExperimentalWasmCandidateConfigError ? e.detail : `raw ${e?.name}`;
    }
    return 'created';
  };
  const base = { transport: 'bare', acceptedProfiles: ['dcp-jcs-v2'], historical: A.w2TextDecoder };
  let toJSONCalls = 0;
  const cases = [
    ['boxed profile', { ...base, acceptedProfiles: [new String('dcp-jcs-v2')] }, 'NOT_STRINGS'],
    ['toJSON profile', { ...base, acceptedProfiles: [{ toJSON: () => (toJSONCalls++, 'dcp-jcs-v2') }] }, 'NOT_STRINGS'],
    ['bigint profile', { ...base, acceptedProfiles: [1n] }, 'NOT_STRINGS'],
    ['boxed transport', { ...base, transport: new String('bare') }, 'TRANSPORT'],
    ['boxed adapter path', { ...base, historical: { ...A.w2TextDecoder, path: new String('w2') } }, 'HISTORICAL_ADAPTER'],
    ['boxed adapter name', { ...base, historical: { ...A.w2TextDecoder, name: new String('w2.textDecoder') } }, 'HISTORICAL_ADAPTER'],
    ['throwing config getter', Object.defineProperty({ ...base }, 'acceptedProfiles', { get: () => { throw new Error('synthetic'); } }), 'CONFIG'],
    ['valid', base, 'created'],
  ];
  for (const [label, config, expected] of cases) check(`config ${label}`, detail(config) === expected, detail(config));
  check('toJSON never called', toJSONCalls === 0, toJSONCalls);
}
{
  const policy = ['dcp-jcs-v1'];
  const adapter = counting(A.w2TextDecoder);
  const config = { transport: 'bare', acceptedProfiles: policy, historical: adapter };
  const router = dcp.createExperimentalCandidateRouter(config);
  let replaced = 0;
  policy.push('dcp-jcs-v2');
  config.transport = 'envelope';
  adapter.decode = () => (replaced++, { ok: false, reason: 'replaced' });
  adapter.name = 'replaced';
  router.configuration.acceptedProfiles.push('dcp-jcs-v2');
  check('snapshot v2', router.route(unitWith('"dcp-jcs-v2"')).class === 'PROFILE_NOT_ACCEPTED', null);
  const v1 = router.route(unitWith('"dcp-jcs-v1"'));
  check('snapshot v1', v1.outcome === 'v1_path' && v1.historical.adapter === 'w2.textDecoder' && adapter.calls === 1 && replaced === 0, { calls: adapter.calls, replaced });
  check('snapshot view', same(router.configuration, { transport: 'bare', acceptedProfiles: ['dcp-jcs-v1'], historical: 'w2.textDecoder' }), router.configuration);
}

// Transport and selection on the corpus.
let envelopes = 0;
let routed = 0;
for (const c of design) {
  if (obsolete(c) || c.group === 'configuration' || 'historical' in c) continue;
  const input = inputOf(c);
  check(`${c.id} input`, sha(input) === c.input_sha256, null);
  const e = c.expected;
  if (c.mode === 'document') {
    if (c.transport !== 'envelope') continue;
    envelopes++;
    const x = dcp.experimentalCandidateExtractUnit(input, 'envelope');
    if (e.class === 'TRANSPORT_INVALID' || e.class === 'TRANSPORT_AMBIGUOUS') {
      check(`extract ${c.id}`, same(x, { status: 'reject', class: e.class, detail: e.detail, transportOffset: e.transport_offset ?? null }), x);
    } else {
      const r = x.status === 'unit' ? dcp.experimentalCandidateIngress(input.subarray(x.start, x.end)) : null;
      const ok = r !== null && (!e.unit || same([x.start, x.end], e.unit)) && (e.result === 'accept' ? r.canonicalSha256 === e.canonical_sha256 : r.class === e.class && r.offset === e.offset);
      check(`extract ${c.id}`, ok, { x, r });
    }
    continue;
  }
  routed++;
  const adapter = counting(A.w2TextDecoder);
  const r = create(adapter, c.policy, c.transport).route(input);
  if (e.result === 'accept_v2' || e.class === 'COMMITMENT_MISMATCH') {
    check(`route ${c.id}`, r.outcome === 'candidate' && same(r.attempts, ['dcp-jcs-v2']) && adapter.calls === 0 && (!e.unit || same([r.unit.start, r.unit.end], e.unit)), r);
  } else if (e.result === 'v1_path') {
    const warnings = r.warnings?.map((w) => ({ class: w.class, offset: w.offset }));
    check(`route ${c.id}`, r.outcome === 'v1_path' && same(r.attempts, e.attempts) && same(warnings, e.warnings) && adapter.calls === 1, r);
  } else {
    check(`route ${c.id}`, r.outcome === 'reject' && r.class === e.class && r.offset === (e.offset ?? null) && r.profile === (e.profile ?? null) && adapter.calls === 0, r);
  }
}
check('corpus counts', envelopes === 28 && routed === 58, { envelopes, routed });

// The historical adapter decides: the public fixture, for the four wasm paths.
const WASM = {
  'wasm.w1.textDecoderJsonParse': A.w1TextDecoderJsonParse,
  'wasm.w1.bufferUtf8JsonParse': A.w1BufferUtf8JsonParse,
  'wasm.w2.textDecoder': A.w2TextDecoder,
  'wasm.w2.bufferUtf8': A.w2BufferUtf8,
};
for (const c of fixture.cases) {
  const input = new Uint8Array(Buffer.from(c.input_hex, 'hex'));
  for (const [name, inner] of Object.entries(WASM)) {
    const e = c.adapters[name].expected;
    const adapter = counting(inner);
    const r = create(adapter, c.policy).route(input);
    let ok = adapter.calls === e.adapter_calls;
    if (e.outcome === 'reject') ok &&= r.outcome === 'reject' && r.class === e.class && r.offset === e.offset && r.profile === (e.profile ?? null);
    else {
      ok &&= r.outcome === 'v1_path' && r.profileSource === e.profile_source;
      ok &&= same(r.warnings?.map((w) => ({ class: w.class, offset: w.offset })), e.warnings) && ('decoded' in (r.historical ?? {}) ? 'decoded' : 'failed') === e.historical;
    }
    check(`fixture ${c.id} ${name}`, ok, { r, e, calls: adapter.calls });
  }
}

// resume, called directly: stateless, recomputed, never a candidate, never a result for a misuse.
{
  const config = JSON.stringify({ transport: 'bare', accepted_profiles: BOTH, historical: 'w2.textDecoder' });
  const route = (input, cfg = config) => JSON.parse(pkg.wasm_experimental_candidate_route(input, cfg));
  const resume = (input, point, historical, cfg = config) => JSON.parse(pkg.wasm_experimental_candidate_resume(input, cfg, JSON.stringify(point), JSON.stringify(historical)));
  const needs = route(bomV1).needs_historical;
  check('route needs the decoder', needs?.step === 'unwalkable' && needs.config.historical === 'w2.textDecoder', needs);
  const v2text = { text: JSON.stringify({ bundle: { manifest: { canonicalization_profile: 'dcp-jcs-v2' } } }) };
  check('a v2 reading is a rejection', resume(bomV1, needs, v2text).class === 'BOM', resume(bomV1, needs, v2text));
  check('a refusal is a rejection', resume(bomV1, needs, { failed: 'no' }).class === 'BOM', null);
  check('a v1 reading delegates', resume(bomV1, needs, { text: new TextDecoder().decode(bomV1) }).outcome === 'v1_path', null);
  check('resume is stateless', same(resume(bomV1, needs, { failed: 'no' }), resume(bomV1, needs, { failed: 'no' })), null);
  const misuse = (label, result) => check(`misuse ${label}`, typeof result.usage_error === 'string' && result.outcome === undefined, result);
  misuse('on a candidate input', resume(unitWith('"dcp-jcs-v2"'), needs, v2text));
  misuse('on a transport rejection', resume(utf8('{"other":1}'), needs, v2text, JSON.stringify({ transport: 'envelope', accepted_profiles: BOTH, historical: 'w2.textDecoder' })));
  misuse('with another unit hash', resume(bomV1, { ...needs, unit_sha256: '0'.repeat(64) }, v2text));
  misuse('with another configuration', resume(bomV1, needs, v2text, JSON.stringify({ transport: 'bare', accepted_profiles: ['dcp-jcs-v1'], historical: 'w2.textDecoder' })));
  misuse('with another adapter name', resume(bomV1, needs, v2text, JSON.stringify({ transport: 'bare', accepted_profiles: BOTH, historical: 'other' })));
  const v1unit = unitWith('"dcp-jcs-v1"');
  const delegation = route(v1unit).needs_historical;
  check('a walkable v1 unit needs the delegated value', delegation?.step === 'v1_delegation' && delegation.scanner_profile?.profile === 'dcp-jcs-v1' && delegation.scanner_profile?.offset === 50, delegation);
  misuse('with another scanner reading', resume(v1unit, { ...delegation, scanner_profile: { profile: 'dcp-jcs-v1', offset: 51 } }, { failed: 'no' }));
  misuse('with another diagnosis', resume(bomV1, { ...needs, diagnosis: null }, v2text));
  misuse('with a malformed historical result', resume(bomV1, needs, { text: 'x', failed: 'y' }));
}

// Laziness, the adapter contract and byte ownership.
{
  const adapter = counting(A.w2TextDecoder);
  const router = create(adapter);
  router.route(unitWith('"dcp-jcs-v2"'));
  router.route(unitWith('"DCP-JCS-V2"'));
  router.route(unitWith('"dcp-jcs-v2"', ',"x":1.5'));
  check('no call before it is needed', adapter.calls === 0, adapter.calls);
  router.route(unitWith('"dcp-jcs-v1"'));
  router.route(bomV1);
  check('one call each', adapter.calls === 2, adapter.calls);
  for (const [label, decode] of [
    ['throws', () => { throw new Error('synthetic'); }],
    ['shape', () => 'v1'],
    ['no text', () => ({ ok: true })],
    ['getter', () => Object.defineProperty({}, 'ok', { get: () => { throw new Error('synthetic'); } })],
  ]) {
    check(`adapter error ${label}`, throws(() => create({ name: 'custom', path: 'w2', decode }).route(bomV1), ExperimentalWasmCandidateAdapterError), null);
  }
  const original = bomV1.slice();
  const input = original.slice();
  const mutating = { name: 'mutating', path: 'w2', decode: (u) => { const r = A.w2TextDecoder.decode(u); u.fill(0); input.fill(0x20); return r; } };
  const first = create(mutating).route(input);
  check('ownership first', first.outcome === 'v1_path' && same([...first.unit.bytes], [...original]), first.outcome);
  first.unit.bytes.fill(1);
  const second = create(mutating).route(original);
  check('ownership second', second.outcome === 'v1_path' && same([...second.unit.bytes], [...original]), second.outcome);
  check('wrong argument', throws(() => router.route('{}'), TypeError), null);
}

// v1 parity on really signed bundles, bare, for each wasm path: the routing never changes today's verdict.
{
  const text = JSON.stringify(vectors.signed_bundle);
  const profile = '"canonicalization_profile":"dcp-jcs-v1"';
  const action = text.indexOf('"action_type":"') + '"action_type":"'.length;
  const variants = {
    'bom': join([0xef, 0xbb, 0xbf], text),
    'dup-profile-unknown-then-v1': utf8(text.replace(profile, '"canonicalization_profile":"dcp-jcs-v9",' + profile)),
    'dup-profile-v2-then-v1': utf8(text.replace(profile, '"canonicalization_profile":"dcp-jcs-v2",' + profile)),
    'dup-profile-v1-then-unknown': utf8(text.replace(profile, profile + ',"canonicalization_profile":"dcp-jcs-v9"')),
    'dup-manifest-empty-then-real': utf8(text.replace('"manifest":{', '"manifest":{},"manifest":{')),
    'dup-bundle-empty-then-real': utf8(text.replace('{"bundle":{', '{"bundle":{},"bundle":{')),
    'utf8-ff-in-intent': join(text.slice(0, action), [0xff], text.slice(action + 1)),
    'ufffd-literal-in-intent': join(text.slice(0, action), [0xef, 0xbf, 0xbd], text.slice(action + 1)),
    'trailing-comma': utf8(text.slice(0, -1) + ',}'),
    'inf-unsigned': utf8(text.slice(0, -1) + ',"x":1e999}'),
    'nan-unsigned': utf8(text.slice(0, -1) + ',"x":NaN}'),
    'lone-surrogate-unsigned': utf8(text.slice(0, -1) + ',"x":"\\ud800"}'),
    'inf-profile': utf8(text.replace(profile, '"canonicalization_profile":1e999')),
    'nan-before-v1': utf8(text.replace(profile, '"canonicalization_profile":NaN,' + profile)),
    'inf-before-v1': utf8(text.replace(profile, '"canonicalization_profile":1e999,' + profile)),
  };
  const inputs = [
    ['signed_bundle', utf8(text)],
    ['classical_only_routine_bundle', utf8(JSON.stringify(vectors.classical_only_routine_bundle.signed_bundle))],
    ...vectors.must_accept_bundles.map((c) => [`must_accept ${c.name}`, utf8(JSON.stringify(c.signed_bundle))]),
    ...vectors.must_reject_bundles.map((c) => [`must_reject ${c.name}`, utf8(JSON.stringify(c.signed_bundle))]),
    ...Object.entries(admission.signed_bundles).map(([k, b]) => [`admission ${k}`, utf8(JSON.stringify(b))]),
    ...Object.entries(variants).map(([k, v]) => [`variant ${k}`, v]),
  ];
  check('parity inputs', inputs.length === 2 + vectors.must_accept_bundles.length + vectors.must_reject_bundles.length + 20 + 15, inputs.length);
  // Today's verdict on each path: w1 is the wrapper (object to JSON.stringify to Rust); w2 is the binding on the text.
  // A decoder refusal (JSON.parse) is not an acceptance. Every exception of today's binding is recorded with
  // its input, path, side and class: none is allowed (the V1 path no longer traps in wasm), and the V1
  // bundle of the admission vectors must verify on both sides of every path.
  const exceptions = [];
  const v1Verdicts = [];
  const today = (path, decode) => (label, side, bytes) => {
    let text;
    try {
      text = decode(bytes);
      if (path === 'w1') text = JSON.stringify(JSON.parse(text));
    } catch (e) {
      if (e instanceof SyntaxError) return false;
      throw e;
    }
    try {
      const verified =
        path === 'w1'
          ? dcp.verifyBundle(JSON.parse(text)).verified === true
          : JSON.parse(pkg.wasm_verify_signed_bundle_v2(text, undefined)).verified === true;
      if (label === 'admission v1_bundle') v1Verdicts.push({ side, verified });
      return verified;
    } catch (e) {
      exceptions.push({ label, path, side, class: e?.constructor?.name, message: String(e?.message) });
      return `throws ${e?.constructor?.name}`;
    }
  };
  for (const [name, adapter] of Object.entries(WASM)) {
    const decode = name.includes('buffer') ? (b) => Buffer.from(b).toString('utf8') : (b) => new TextDecoder().decode(b);
    const verdict = today(adapter.path, decode);
    const router = create(adapter, ['dcp-jcs-v1']);
    const differences = [];
    let accepted = 0;
    for (const [label, bytes] of inputs) {
      const t = verdict(label, `${name} today`, bytes);
      const r = router.route(bytes);
      // The delegated unit goes to today's path unchanged (bare: the unit is the input).
      const routedVerdict = r.outcome === 'v1_path' ? verdict(label, `${name} routed`, r.unit.bytes) : false;
      if (r.outcome === 'candidate' || routedVerdict !== t) differences.push(`${label}: today ${t}, routed ${routedVerdict} (${r.outcome} ${r.class ?? ''})`);
      accepted += t === true ? 1 : 0;
    }
    check(`parity ${name}`, differences.length === 0 && accepted > 10, { differences, accepted });
  }
  const expected = Object.keys(WASM).flatMap((name) => [`${name} today`, `${name} routed`]);
  check('no exception on any input, path or side', exceptions.length === 0, exceptions);
  check(
    'the V1 bundle verifies on both sides of every path',
    same(v1Verdicts.map((v) => v.side).sort(), expected.sort()) && v1Verdicts.every((v) => v.verified === true),
    v1Verdicts,
  );
}

if (failures.length > 0) {
  console.error(`experimental candidate router (wasm): ${failures.length} of ${checks} checks failed`);
  for (const f of failures.slice(0, 25)) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`experimental candidate router (wasm): ${checks} checks passed (corpus, fixture x 4 paths, resume misuse, laziness, adapter, ownership, parity)`);
