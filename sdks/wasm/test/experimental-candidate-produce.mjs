// EXPERIMENTAL candidate dcp-jcs-v2, phase 4 (WASM): the producers, as the TypeScript ones. Positives
// are verified by the phase 3 wasm verifier and refused by today's binding. Host values are checked in JS
// before anything is encoded (no getter or toJSON invoked); bytes are copied through the intrinsic
// accessors and reach the binding as each piece's own bytes. Rejections found in JS make no binding call
// (counted through the internal module); those found in Rust come back as the same error class. The
// sign_bundle export refuses a malformed piece range as a usage error, without trapping.
// Needs `npm run build:wasm` and `npm run build:ts` first.
import { readFileSync } from 'node:fs';
import * as pkg from '../pkg/dcp_ai.js';
import * as entry from '../dist/index.js';
import { createWasmCandidateProducer } from '../dist/experimental-candidate-produce.js';

const { initDcp, experimentalWasmHistoricalAdapters: adapters, ExperimentalWasmCandidateProduceError: ProduceError } = entry;
const dcp = await initDcp({ module_or_path: readFileSync(new URL('../pkg/dcp_ai_bg.wasm', import.meta.url)) });

const failures = [];
let checks = 0;
const check = (name, ok, detail) => {
  checks += 1;
  if (!ok) failures.push(`${name}: ${JSON.stringify(detail)?.slice(0, 300)}`);
};
const text = (b) => new TextDecoder().decode(b);
const utf8 = (s) => new TextEncoder().encode(s);

// Counted bindings: a rejection found in JS must make no call.
const calls = { payload: 0, bundle: 0 };
const counted = createWasmCandidateProducer({
  signPayload: (...a) => (calls.payload++, pkg.wasm_experimental_candidate_sign_payload(...a)),
  signBundle: (...a) => (calls.bundle++, pkg.wasm_experimental_candidate_sign_bundle(...a)),
});
const resetCalls = () => { calls.payload = 0; calls.bundle = 0; };

function key(kp) {
  return { kid: kp.kid ?? dcp.deriveKid(kp.alg, kp.public_key_b64), alg: kp.alg, secretKeyB64: kp.secret_key_b64, publicKeyB64: kp.public_key_b64 };
}
const hybrid = () => {
  const h = dcp.generateHybridKeypair();
  return { classical: key(h.classical), pq: key(h.pq) };
};
const principal = hybrid();
const agent = hybrid();
const classicalOnly = (k) => ({ classical: k.classical });

function outcome(run) {
  try {
    return { value: run() };
  } catch (e) {
    return { error: e };
  }
}
function rejected(name, run, cls, part, extra = () => true) {
  resetCalls();
  const r = outcome(run);
  const e = r.error;
  check(name, e instanceof ProduceError && e.class === cls && (part === undefined || e.part === part) && extra(e), e ? `${e.name}: ${e.message} ${e.path} ${e.offset}` : r.value);
}
function usage(name, run) {
  resetCalls();
  const r = outcome(run);
  check(name, r.error instanceof TypeError && calls.payload + calls.bundle === 0, r.error ? `${r.error.name}: ${r.error.message}` : 'no error');
}

const nest = (n, leaf) => (n === 0 ? leaf : [nest(n - 1, leaf)]);
const hashOf = (v) => {
  const canonical = pkg.wasm_canonicalize_v2(JSON.stringify(v));
  return `sha256:${JSON.parse(pkg.wasm_dual_hash(canonical)).sha256}`;
};

function scenario(o = {}) {
  const nonce = dcp.generateSessionNonce();
  const pk = o.classical ? classicalOnly(principal) : principal;
  const ak = o.classical ? classicalOnly(agent) : agent;
  const keyEntries = (k, expires) => [k.classical, ...(k.pq ? [k.pq] : [])].map((x) => ({
    kid: x.kid, alg: x.alg, public_key_b64: x.publicKeyB64, created_at: '2026-10-21T00:00:00Z', expires_at: expires, status: 'active',
  }));
  const rpr = { dcp_version: '2.0', human_id: 'human:candidate-principal', session_nonce: nonce, legal_name: 'Candidate Principal',
    entity_type: 'natural_person', jurisdiction: 'US-CA', liability_mode: 'owner_responsible', override_rights: true,
    issued_at: '2026-10-21T00:00:00Z', expires_at: null, contact: null, binding_keys: keyEntries(pk, null) };
  const passport = { dcp_version: '2.0', agent_id: 'agent:candidate-bot', session_nonce: nonce, keys: keyEntries(ak, '2099-12-31T18:59:59-05:00'),
    principal_binding_reference: rpr.human_id, capabilities: ['browse', 'api_call'], risk_tier: o.routine ? 'low' : 'medium',
    created_at: '2026-10-21T00:00:00Z', status: 'active' };
  const intent = { dcp_version: '2.0', intent_id: 'intent:candidate-001', session_nonce: nonce, agent_id: passport.agent_id, human_id: rpr.human_id,
    timestamp: '2026-10-21T12:00:00Z', action_type: o.routine ? 'browse' : 'send_email',
    target: { ...(o.routine ? { channel: 'web' } : { channel: 'email', to: 'bob@example.com', domain: 'example.com' }), ...o.target },
    data_classes: o.routine ? ['none'] : ['contact_info'], estimated_impact: o.routine ? 'low' : 'medium', requires_consent: false };
  const policy = { dcp_version: '2.0', intent_id: intent.intent_id, session_nonce: nonce, decision: 'approve', risk_score: o.routine ? 0 : 450,
    reasons: ['Known recipient domain'], required_confirmation: null, applied_policy_hash: hashOf({ policy: 'default' }), timestamp: '2026-10-21T12:00:01Z' };
  const entries = [];
  for (let i = 0; i < (o.entries ?? 2); i++) {
    entries.push({ dcp_version: '2.0', audit_id: `audit:candidate-00${i + 1}`, session_nonce: nonce, prev_hash: i === 0 ? 'GENESIS' : hashOf(entries[i - 1]),
      hash_alg: 'sha256', timestamp: `2026-10-21T12:0${i + 1}:00Z`, agent_id: passport.agent_id, human_id: rpr.human_id, intent_id: intent.intent_id,
      intent_hash: hashOf(intent), policy_decision: 'approved', outcome: 'email_sent', evidence: { tool: 'smtp', result_ref: null, evidence_hash: null },
      pq_checkpoint_ref: null });
  }
  const artifact = (context, payload, k) => {
    const r = dcp.experimentalCandidateSignPayload(context, { value: payload }, k);
    return o.bytes ? { bytes: r.bytes } : { value: r.signedPayload };
  };
  return {
    parts: {
      rpr: artifact('DCP-AI.v2.ResponsiblePrincipal', rpr, pk),
      passport: artifact('DCP-AI.v2.AgentPassport', passport, ak),
      intent: artifact('DCP-AI.v2.Intent', intent, ak),
      policyDecision: artifact('DCP-AI.v2.PolicyDecision', policy, ak),
      auditEntries: entries.map((e) => (o.bytes ? { bytes: utf8(JSON.stringify(e)) } : { value: e })),
    },
    signer: { signerType: 'human', signerId: rpr.human_id, keys: pk },
    options: { sessionNonce: nonce, sessionIssuedAt: '2026-10-21T00:00:00Z', sessionExpiresAt: '2099-12-31T23:59:59+05:00', createdAt: '2026-10-21T12:05:00Z' },
    intent, entries, ak,
  };
}

const verifier = dcp.createExperimentalCandidateVerifier({ transport: 'bare', acceptedProfiles: ['dcp-jcs-v2'], historical: adapters.w2TextDecoder });
function produceAndVerify(name, s) {
  const r = outcome(() => dcp.experimentalCandidateSignBundle(s.parts, s.signer, s.options));
  if (r.error) {
    check(`${name}: produced`, false, `${r.error.name}: ${r.error.message}`);
    return null;
  }
  const v = verifier.verify(r.value.bytes);
  check(`${name}: verified by phase 3`, v.entered === 'dcp-jcs-v2' && v.verification.verified === true, v.verification?.errors);
  const today = JSON.parse(pkg.wasm_verify_signed_bundle_v2(text(r.value.bytes), undefined));
  check(`${name}: refused by today's binding`, today.verified === false && today.errors.includes('Unknown canonicalization_profile: dcp-jcs-v2'), today.errors);
  return JSON.parse(text(r.value.bytes));
}

// ── signPayload ──
{
  const r = dcp.experimentalCandidateSignPayload('DCP-AI.v2.Intent', { value: { a: 1, b: 'x' } }, agent);
  check('signPayload: no profile, canonical bytes', !text(r.bytes).includes('canonicalization_profile') && r.signedPayload.payload_hash === hashOf({ a: 1, b: 'x' }), text(r.bytes).slice(0, 80));
  const long = dcp.experimentalCandidateSignPayload('DCP-AI.v2.Intent', { bytes: utf8(`{"n":1.${'0'.repeat(800)}}`) }, agent);
  check('signPayload: 1 followed by 800 zeros is 1', text(long.bytes).includes('"payload":{"n":1}'), text(long.bytes).slice(0, 60));
  const c = dcp.experimentalCandidateSignPayload('DCP-AI.v2.Intent', { value: { a: 1 } }, classicalOnly(agent));
  check('signPayload: classical-only', c.signedPayload.composite_sig.binding === 'classical_only', c.signedPayload.composite_sig);
  const n = dcp.experimentalCandidateSignPayload('DCP-AI.v2.Intent', { value: { a: 1.0, b: -0, c: 5n } }, agent);
  check('signPayload: integral floats, -0 and BigInt normalized', JSON.stringify(n.signedPayload.payload) === '{"a":1,"b":0,"c":5}', n.signedPayload.payload);
  dcp.experimentalCandidateSignPayload('DCP-AI.v2.Intent', { value: { d: nest(62, 0) } }, classicalOnly(agent));
  rejected('signPayload: artifact over 64 levels', () => dcp.experimentalCandidateSignPayload('DCP-AI.v2.Intent', { value: { d: nest(63, 0) } }, agent), 'DEPTH_EXCEEDED', 'payload');
  rejected('signPayload: not an object', () => dcp.experimentalCandidateSignPayload('DCP-AI.v2.Intent', { value: [1] }, agent), 'TYPE_UNSUPPORTED', 'payload');
  usage('signPayload: unknown context', () => counted.signPayload('DCP-AI.v2.Unknown', { value: {} }, agent));
  usage('signPayload: both members', () => counted.signPayload('DCP-AI.v2.Intent', { bytes: utf8('{}'), value: undefined }, agent));
  resetCalls();
  const u = outcome(() => counted.signPayload('DCP-AI.v2.Intent', { value: undefined }, agent));
  check('signPayload: value undefined', u.error instanceof ProduceError && u.error.class === 'TYPE_UNSUPPORTED' && calls.payload === 0, u.error?.message);
}

// ── host values, refused in JS before any binding call ──
{
  let invoked = 0;
  const lone = String.fromCharCode(0xd800);
  const cases = [
    ['NaN', { n: NaN }, 'NUMBER_NOT_FINITE'], ['Infinity', { n: Infinity }, 'NUMBER_NOT_FINITE'], ['fraction', { n: 0.5 }, 'NUMBER_NOT_INTEGER'],
    ['2^53', { n: 2 ** 53 }, 'NUMBER_OUT_OF_RANGE'], ['BigInt 2^53', { n: 2n ** 53n }, 'NUMBER_OUT_OF_RANGE'], ['lone surrogate', { s: lone }, 'SURROGATE_UNPAIRED'],
    ['undefined', { u: undefined }, 'TYPE_UNSUPPORTED'], ['getter', Object.defineProperty({}, 'g', { get: () => (invoked++, 1), enumerable: true }), 'TYPE_UNSUPPORTED'],
    ['toJSON method', { toJSON: () => (invoked++, {}) }, 'TYPE_UNSUPPORTED'], ['hole', { a: [1, , 2] }, 'TYPE_UNSUPPORTED'],
    ['array member', { a: Object.assign([1], { x: 1 }) }, 'TYPE_UNSUPPORTED'], ['Date', { d: new Date(0) }, 'TYPE_UNSUPPORTED'],
  ];
  for (const [name, value, cls] of cases) {
    resetCalls();
    const r = outcome(() => counted.signPayload('DCP-AI.v2.Intent', { value }, agent));
    check(`host value ${name}`, r.error instanceof ProduceError && r.error.class === cls && calls.payload === 0, r.error?.message);
  }
  const cycle = {};
  cycle.self = cycle;
  resetCalls();
  const r = outcome(() => counted.signPayload('DCP-AI.v2.Intent', { value: cycle }, agent));
  check('host value cycle', r.error?.class === 'DEPTH_EXCEEDED' && calls.payload === 0, r.error?.message);
  check('no getter or toJSON invoked', invoked === 0, invoked);
  const kept = dcp.experimentalCandidateSignPayload('DCP-AI.v2.Intent', { value: JSON.parse('{"__proto__":{"x":1},"toJSON":"data"}') }, agent);
  check('__proto__ and toJSON as data are kept', text(kept.bytes).includes('"__proto__":{"x":1}') && text(kept.bytes).includes('"toJSON":"data"'), text(kept.bytes).slice(0, 80));
}

// Gate 2 (§4.1 of the phase 4 contract): each R and T cell of WASM (the JS values of TypeScript), by corpus
// ID, as the value of the corpus document; rejected in JS, with no binding call. n-huge-exponent has no R
// cell: its 5000-digit exponent cannot be materialized as a BigInt (N); its T cell uses 1e99999, a shorter
// literal that a parser also turns into Infinity. The 9 parser IDs (P) are documented, not tested.
{
  const cells = [
    ['n-two53', 'R', 2 ** 53, 'NUMBER_OUT_OF_RANGE'], ['n-1e20', 'R', 1e20, 'NUMBER_OUT_OF_RANGE'], ['n-1e21', 'R', 1e21, 'NUMBER_OUT_OF_RANGE'],
    ['n-fraction', 'R', 0.5, 'NUMBER_NOT_INTEGER'],
    ['n-two53-plus-one', 'R', 2n ** 53n + 1n, 'NUMBER_OUT_OF_RANGE'], ['n-two53-plus-one', 'T', Number('9007199254740993'), 'NUMBER_OUT_OF_RANGE'],
    ['n-neg-two53-plus-one', 'R', -(2n ** 53n + 1n), 'NUMBER_OUT_OF_RANGE'], ['n-neg-two53-plus-one', 'T', Number('-9007199254740993'), 'NUMBER_OUT_OF_RANGE'],
    ['n-int64-max', 'R', 2n ** 63n - 1n, 'NUMBER_OUT_OF_RANGE'], ['n-int64-max', 'T', Number('9223372036854775807'), 'NUMBER_OUT_OF_RANGE'],
    ['n-sci-over', 'R', 9007199254740993n, 'NUMBER_OUT_OF_RANGE'], ['n-sci-over', 'T', Number('9.007199254740993e15'), 'NUMBER_OUT_OF_RANGE'],
    ['n-overflow', 'R', 10n ** 400n, 'NUMBER_OUT_OF_RANGE'], ['n-overflow', 'T', Number('1e400'), 'NUMBER_NOT_FINITE'],
    ['n-huge-exponent', 'T', Number('1e99999'), 'NUMBER_NOT_FINITE'], ['n-nan', 'T', NaN, 'NUMBER_NOT_FINITE'],
    ['n-negative-infinity', 'T', -Infinity, 'NUMBER_NOT_FINITE'],
  ];
  for (const [id, cell, n, cls] of cells) {
    resetCalls();
    const r = outcome(() => counted.signPayload('DCP-AI.v2.Intent', { value: { n } }, agent));
    check(`gate 2 ${id} ${cell}`, r.error instanceof ProduceError && r.error.class === cls && r.error.part === 'payload' && r.error.path === '/n' && calls.payload === 0, r.error?.message);
  }
  for (const levels of [65, 129]) {
    resetCalls();
    const r = outcome(() => counted.signPayload('DCP-AI.v2.Intent', { value: nest(levels, 1) }, agent));
    check(`gate 2 s-depth-${levels}`, r.error instanceof ProduceError && r.error.class === 'DEPTH_EXCEEDED' && calls.payload === 0, r.error?.message);
  }
}

// ── bytes through the intrinsic accessors ──
{
  let invoked = 0;
  class Lying extends Uint8Array {
    slice() { invoked++; return utf8('{"n":1}'); }
    subarray() { invoked++; return utf8('{"n":1}'); }
    [Symbol.iterator]() { invoked++; return utf8('{"n":1}')[Symbol.iterator](); }
  }
  const lying = new Lying(utf8('{"n":1.5}'));
  Object.defineProperty(lying, 'length', { get: () => (invoked++, 7) });
  rejected('bytes: a subclass is read by its real content', () => dcp.experimentalCandidateSignPayload('DCP-AI.v2.Intent', { bytes: lying }, agent), 'NUMBER_NOT_INTEGER', 'payload', (e) => e.offset === 5);
  const buffer = Buffer.from('{"n":1.5}');
  Object.defineProperty(buffer, 'slice', { value: () => (invoked++, Buffer.from('{"n":1}')) });
  rejected('bytes: a Buffer with its own slice', () => dcp.experimentalCandidateSignPayload('DCP-AI.v2.Intent', { bytes: buffer }, agent), 'NUMBER_NOT_INTEGER', 'payload');
  check('bytes: no member of the input ran', invoked === 0, invoked);
  usage('bytes: a Uint16Array', () => counted.signPayload('DCP-AI.v2.Intent', { bytes: new Uint16Array(2) }, agent));
}

// ── signBundle ──
{
  const base = produceAndVerify('hybrid, values', scenario());
  check('manifest commits to dcp-jcs-v2', base?.bundle.manifest.canonicalization_profile === 'dcp-jcs-v2' && base?.signature.created_at === '2026-10-21T12:05:00Z', base?.bundle.manifest);
  produceAndVerify('hybrid, bytes received', scenario({ bytes: true }));
  const routine = produceAndVerify('classical-only routine', scenario({ classical: true, routine: true }));
  check('classical-only binding', routine?.signature.composite_sig.binding === 'classical_only', routine?.signature.composite_sig.binding);
  const dual = scenario();
  dual.options.dualHash = true;
  const d = produceAndVerify('dual hash', dual);
  check('dual hash members', d?.signature.hash_alg === 'sha256+sha3-256' && d?.bundle.manifest.audit_merkle_root_secondary?.startsWith('sha3-256:'), d?.signature.hash_alg);
  const empty = scenario({ entries: 0 });
  empty.options.dualHash = true;
  const e = produceAndVerify('empty audit', empty);
  check('empty audit roots', e?.bundle.manifest.audit_count === 0 && e?.bundle.manifest.audit_merkle_root === `sha256:${'0'.repeat(64)}`
    && e?.bundle.manifest.audit_merkle_root_secondary === `sha3-256:${'0'.repeat(64)}`, e?.bundle.manifest);

  const ext = scenario({ target: { x_payload_ext: { kept: 1 } } });
  ext.entries[1] = { ...ext.entries[1], x_entry_ext: 'kept' };
  ext.parts.auditEntries = ext.entries.map((v) => ({ value: v }));
  const intent = ext.parts.intent.value;
  ext.parts.intent = { value: { ...intent, x_artifact_ext: 'unsigned', composite_sig: { ...intent.composite_sig, x_sig_ext: 'unsigned' } } };
  const first = dcp.experimentalCandidateSignBundle(ext.parts, ext.signer, ext.options);
  const checkpoint = { checkpoint_id: 'ckpt-1', session_nonce: ext.options.sessionNonce, x_checkpoint_ext: [1, 2], merkle_root: first.signedBundle.bundle.manifest.audit_merkle_root,
    event_range: { from_audit_id: ext.entries[0].audit_id, to_audit_id: ext.entries[1].audit_id, count: 2 } };
  const signedCheckpoint = dcp.experimentalCandidateSignPayload('DCP-AI.v2.AuditEvent', { value: checkpoint }, agent).signedPayload;
  ext.parts.pqCheckpoints = [{ value: { ...checkpoint, composite_sig: signedCheckpoint.composite_sig } }];
  const x = produceAndVerify('checkpoint and extensions', ext);
  check('extensions kept', x?.bundle.intent.payload.target.x_payload_ext?.kept === 1 && x?.bundle.audit_entries[1].x_entry_ext === 'kept'
    && x?.bundle.pq_checkpoints[0].x_checkpoint_ext?.length === 2 && x?.bundle.intent.x_artifact_ext === 'unsigned'
    && x?.bundle.intent.composite_sig.x_sig_ext === 'unsigned' && x?.bundle.manifest.pq_checkpoints?.[0] === 'ckpt-1', x?.bundle.manifest);

  const e000 = String.fromCodePoint(0xe000);
  const smile = String.fromCodePoint(0x1f600);
  const borders = produceAndVerify('boundaries of §9', scenario({ target: { limits: { max: 9007199254740991, min: -9007199254740991 }, keys: { [smile]: 2, [e000]: 1 },
    strings: [String.fromCodePoint(0xfeff) + 'start', String.fromCodePoint(0xfffd), String.fromCodePoint(0x2028), String.fromCodePoint(0)] } }));
  check('keys in code point order', borders && Object.keys(borders.bundle.intent.payload.target.keys).join() === [e000, smile].join(), borders && Object.keys(borders.bundle.intent.payload.target.keys));
  produceAndVerify('payload 61 deep, unit 64', scenario({ target: { d: nest(59, 'deep') } }));
  const deep = scenario({ target: { d: nest(60, 'deep') } });
  rejected('unit 65', () => dcp.experimentalCandidateSignBundle(deep.parts, deep.signer, deep.options), 'DEPTH_EXCEEDED', 'unit');
}

// ── rejections found in Rust, by class ──
{
  const s = scenario();
  const run = (parts, signer, options) => () => dcp.experimentalCandidateSignBundle(parts, signer, options);
  const intent = s.parts.intent.value;
  rejected('commitment', run({ ...s.parts, intent: { value: { ...intent, payload: { ...intent.payload, action_type: 'send_fax' } } } }, s.signer, s.options), 'COMMITMENT_MISMATCH', 'intent', (e) => e.path === '/payload_hash');
  rejected('chain not GENESIS', run({ ...s.parts, auditEntries: [{ value: { ...s.entries[0], prev_hash: hashOf({ earlier: 'v1' }) } }, { value: s.entries[1] }] }, s.signer, s.options), 'CHAIN_NOT_GENESIS', 'auditEntries');
  rejected('chain break', run({ ...s.parts, auditEntries: [{ value: s.entries[0] }, { value: { ...s.entries[1], prev_hash: `sha256:${'0'.repeat(64)}` } }] }, s.signer, s.options), 'CHAIN_BREAK', 'auditEntries');
  rejected('session nonce', run(s.parts, s.signer, { ...s.options, sessionNonce: dcp.generateSessionNonce() }), 'SESSION_INVALID', 'parts');
  const { sessionIssuedAt: _absent, ...noStart } = s.options;
  rejected('session start required', run(s.parts, s.signer, noStart), 'SESSION_ISSUED_AT_REQUIRED', 'options');
  rejected('signer', run(s.parts, { ...s.signer, signerId: 'human:else' }, s.options), 'SIGNER_MISMATCH', 'signer');
  const entryText = JSON.stringify(s.entries[1]);
  for (const [name, bytes, cls, offset] of [
    ['BOM', new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(entryText)]), 'BOM', 0],
    ['SYNTAX', utf8(entryText.slice(0, -1)), 'SYNTAX', entryText.length - 1],
    ['DUPLICATE', utf8(entryText.replace('"outcome":"email_sent"', '"outcome":"email_sent","outcome":"email_sent"')), 'DUPLICATE_KEY', null],
    ['FRACTION', utf8(entryText.replace('"hash_alg":"sha256"', '"hash_alg":"sha256","n":1.5')), 'NUMBER_NOT_INTEGER', null],
    ['UTF8', new Uint8Array([...utf8(entryText.slice(0, 20)), 0xff, ...utf8(entryText.slice(20))]), 'UTF8_INVALID', 20],
  ]) {
    rejected(`received bytes ${name}`, run({ ...s.parts, auditEntries: [{ value: s.entries[0] }, { bytes }] }, s.signer, s.options), cls, 'auditEntries',
      (e) => e.path === '/1' && (offset === null || e.offset === offset));
  }
  for (const auditEntries of [Object.assign([...s.parts.auditEntries], { extra: 1 }), [s.parts.auditEntries[0], , s.parts.auditEntries[1]]]) {
    usage('parts arrays are closed', () => counted.signBundle({ ...s.parts, auditEntries }, s.signer, s.options));
  }
  usage('dualHash null is not absent', () => counted.signBundle(s.parts, s.signer, { ...s.options, dualHash: null }));
}

// ── the sign_bundle export refuses malformed piece ranges, without trapping ──
{
  const s = scenario();
  const pieceText = (v) => utf8(JSON.stringify(v));
  const pieces = [s.parts.rpr.value, s.parts.passport.value, s.parts.intent.value, s.parts.policyDecision.value].map(pieceText);
  const all = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0));
  const ranges = [];
  let at = 0;
  for (const p of pieces) { all.set(p, at); ranges.push([at, at + p.length]); at += p.length; }
  const signerJson = JSON.stringify({ signer_type: 'human', signer_id: 'human:candidate-principal', keys: { classical: { kid: principal.classical.kid, alg: 'ed25519', secret_key_b64: principal.classical.secretKeyB64, public_key_b64: principal.classical.publicKeyB64 } } });
  const optionsJson = JSON.stringify({ session_nonce: s.options.sessionNonce });
  for (const [name, bad] of [
    ['above 2^32', '[4294967296,4294967297]'], ['end above 2^32', '[1,4294967296]'], ['u64 max', '[0,18446744073709551615]'],
    ['inverted', '[5,2]'], ['three bounds', '[0,1,2]'], ['not a range', '{"start":0}'], ['negative', '[-1,2]'],
  ]) {
    const layout = `{"rpr":${bad},"passport":${JSON.stringify(ranges[1])},"intent":${JSON.stringify(ranges[2])},"policy_decision":${JSON.stringify(ranges[3])},"audit_entries":[]}`;
    const r = outcome(() => JSON.parse(pkg.wasm_experimental_candidate_sign_bundle(all, layout, signerJson, optionsJson)));
    check(`export: piece range ${name}`, r.value && typeof r.value.usage_error === 'string' && !('canonical' in r.value), r.error ? `${r.error.name}: ${r.error.message}` : r.value);
  }
}

check('the entry point exports the producer error, not the internal module', typeof entry.ExperimentalWasmCandidateProduceError === 'function' && !('createWasmCandidateProducer' in entry), Object.keys(entry));

if (failures.length > 0) {
  console.error(`experimental candidate produce (wasm): ${failures.length} of ${checks} checks failed`);
  for (const f of failures.slice(0, 40)) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`experimental candidate produce (wasm): ${checks} checks passed (producers, host values, bytes, rejections, piece ranges)`);
