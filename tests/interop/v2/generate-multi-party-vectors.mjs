#!/usr/bin/env node
/**
 * Writes tests/interop/v2/multi_party_vectors.json: the multi-party authorizations every SDK's evaluator
 * (evaluateMultiPartyAuthorization and its counterparts) must decide alike under the opt-in mpa-v1 profile.
 *
 * Each party signs {operation, operation_payload, party_id, role} under DCP-AI.v2.MultiPartyAuth, as in v2.0. Under
 * mpa-v1 the operation_payload is {request, parameters}, so every party signs the target, the audience and the
 * validity window too. Who the parties of a target are, with which role, and how many an operation needs come from
 * the operator's policy set; their keys come from the operator's principal trust set. Nothing in the record or the
 * request stands for either. The rules are in _description.
 *
 * Each case states its expectation by hand. Before writing, the generator checks every one against a reference
 * evaluator below, written from the rules alone with Ajv over the schemas, tweetnacl and @noble/post-quantum (no SDK
 * code), so a typo in an expectation fails here, not in four SDKs. It also checks what the groups are for: a
 * `controls` case is authorized, and a `binding`, `parties` or `threshold` case carries signatures that verify on
 * their own and must be refused anyway. A `limits` case sits exactly on a bound and gets past the structure phase. The reference evaluator and the SDK implementations have the same author:
 * agreement between them is not an independent review.
 * Deterministic: seeded keys, deterministic signatures, no clock.
 *
 *   node tests/interop/v2/generate-multi-party-vectors.mjs           write the file
 *   node tests/interop/v2/generate-multi-party-vectors.mjs --check   compare with the committed file, exit 1 if it differs
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import nacl from 'tweetnacl';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'multi_party_vectors.json');
const SCHEMAS = join(HERE, '..', '..', '..', 'schemas', 'v2');
const CONTEXT = 'DCP-AI.v2.MultiPartyAuth';
const PROFILE = 'mpa-v1';
const SKEW_MS = 30_000;
const MAX_AUTHORIZATIONS = 16;
const CLASSICAL_ALGS = ['ed25519'];
const PQ_ALGS = ['ml-dsa-65', 'slh-dsa-192f'];
const OPERATIONS = ['revoke_agent', 'rotate_org_key', 'change_jurisdiction', 'modify_recovery_config'];
const ROLES = ['owner', 'org_admin', 'recovery_contact'];
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const ALGS = {
  ed25519: {
    keygen: (seed) => nacl.sign.keyPair.fromSeed(seed),
    sign: (msg, secretKey) => nacl.sign.detached(msg, secretKey),
    verify: (sig, msg, publicKey) => nacl.sign.detached.verify(msg, sig, publicKey),
  },
  'ml-dsa-65': {
    keygen: (seed) => ml_dsa65.keygen(seed),
    sign: (msg, secretKey) => ml_dsa65.sign(msg, secretKey, { extraEntropy: false }),
    verify: (sig, msg, publicKey) => ml_dsa65.verify(sig, msg, publicKey),
  },
};

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const sha256 = (...parts) => createHash('sha256').update(Buffer.concat(parts.map((p) => Buffer.from(p)))).digest();
// kid = hex(SHA-256(UTF8(alg) || 0x00 || raw_public_key_bytes))[0:32]
const kidOf = (alg, publicKey) => sha256(alg, [0], publicKey).toString('hex').slice(0, 32);
const ms = (t) => Date.parse(t);

/** A test key, derived from its name: anyone can recompute it, so it protects nothing. */
function key(name, alg) {
  const { publicKey, secretKey } = ALGS[alg].keygen(sha256(`dcp-ai multi-party vectors: ${name}`));
  return { alg, kid: kidOf(alg, publicKey), publicKey, secretKey, public_key_b64: b64(publicKey) };
}
const party = (id) => ({ id, classical: key(`${id} classical`, 'ed25519'), pq: key(`${id} pq`, 'ml-dsa-65') });
const ALICE = party('human:alice');
const BOB = party('human:bob');
const CAROL = party('human:carol');
const DAVE = party('human:dave');
const ERIN = party('human:erin');
const MALLORY = party('human:mallory'); // in no trust set and in no policy
const EVERY_KEY = new Map([ALICE, BOB, CAROL, DAVE, ERIN, MALLORY].flatMap((p) => [p.classical, p.pq]).map((k) => [k.kid, k]));

// ── dcp-jcs-v1, as far as these vectors need it: sorted keys (code points), integers only ──
const byCodePoint = (a, b) => {
  const [x, y] = [Array.from(a), Array.from(b)];
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i].codePointAt(0) - y[i].codePointAt(0);
  return x.length - y.length;
};
function canon(v) {
  if (v === null || typeof v === 'boolean') return String(v);
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) throw new Error('not representable in dcp-jcs-v1');
    return String(v);
  }
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  return `{${Object.keys(v).sort(byCodePoint).map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
}

/** What a party signs: the context, 0x00 and the dcp-jcs-v1 form of {operation, operation_payload, party_id, role}. */
const signedBytes = (operation, operation_payload, party_id, role, context = CONTEXT) =>
  Buffer.concat([Buffer.from(context), Buffer.from([0]), Buffer.from(canon({ operation, operation_payload, party_id, role }))]);

/**
 * One party's authorization. The classical signature covers the signed bytes; the post-quantum one covers them
 * followed by the classical signature (pq_over_classical).
 */
function sign(signer, operation, operation_payload, role, { as = signer.id, context = CONTEXT, pqCoversClassical = true, kidsOf = signer } = {}) {
  const msg = signedBytes(operation, operation_payload, as, role, context);
  const classical = ALGS.ed25519.sign(msg, signer.classical.secretKey);
  const pq = ALGS['ml-dsa-65'].sign(pqCoversClassical ? Buffer.concat([msg, classical]) : msg, signer.pq.secretKey);
  return {
    party_id: as,
    role,
    composite_sig: {
      classical: { alg: 'ed25519', kid: kidsOf.classical.kid, sig_b64: b64(classical) },
      pq: { alg: 'ml-dsa-65', kid: kidsOf.pq.kid, sig_b64: b64(pq) },
      binding: 'pq_over_classical',
    },
  };
}
/** An entry that satisfies the schema and was signed by no one: for the cases the structure phase refuses. */
const unsigned = (party_id, role, n = 0) => ({
  party_id,
  role,
  composite_sig: {
    classical: { alg: 'ed25519', kid: (n * 2 + 1).toString(16).padStart(32, '0'), sig_b64: 'AAAAAAAAAAA=' },
    pq: { alg: 'ml-dsa-65', kid: (n * 2 + 2).toString(16).padStart(32, '0'), sig_b64: 'AAAAAAAAAAA=' },
    binding: 'pq_over_classical',
  },
});

// ── Requests and records ──
const ISSUED = '2026-11-18T00:00:00Z';
const EXPIRES = '2026-11-18T00:30:00Z';
const NOW = '2026-11-18T00:10:00Z';
const AGENT = 'agent:acme-bot';
const ORG = 'org:acme';
const AUDIENCE = 'verifier:acme-gateway';

const request = (over = {}) => ({
  profile: PROFILE,
  request_id: 'mpa:6f1c0a52d3b84e7f9a1c2d3e4f506172',
  target: AGENT,
  audience: AUDIENCE,
  issued_at: ISSUED,
  expires_at: EXPIRES,
  ...over,
});
const payload = (over = {}, parameters = { reason: 'key_compromise' }) => ({ request: request(over), parameters });
const record = (operation, operation_payload, authorizations, required_parties = 2) => ({
  type: 'multi_party_authorization',
  operation,
  operation_payload,
  required_parties,
  authorizations,
});
/** A record signed by the given [party, role] pairs. */
const signed = (operation, operation_payload, signers, required_parties = 2) =>
  record(operation, operation_payload, signers.map(([p, role]) => sign(p, operation, operation_payload, role)), required_parties);

const REVOKE = payload();
const ALICE_REVOKES = sign(ALICE, 'revoke_agent', REVOKE, 'owner');
const BOB_REVOKES = sign(BOB, 'revoke_agent', REVOKE, 'org_admin');
const CAROL_REVOKES = sign(CAROL, 'revoke_agent', REVOKE, 'recovery_contact');
/** The base record with Bob's entry replaced: Alice's is always a real, valid authorization. */
const withBob = (entry) => record('revoke_agent', REVOKE, [ALICE_REVOKES, entry]);

const RECOVERY = payload({}, { threshold: 2, holders: 3 });
const ORG_KEY = payload({ target: ORG }, { new_kid: 'c0ffee00c0ffee00c0ffee00c0ffee00' });
const JURISDICTION = payload({ target: ORG }, { jurisdiction: 'CL' });
const NO_PARAMETERS = payload({}, {});
const OTHER_AUDIENCE = payload({ audience: 'verifier:other-gateway' });
const TOO_LONG = payload({ expires_at: '2026-11-18T00:30:01Z' });
const BACKWARDS = payload({ issued_at: '2026-11-18T00:10:20Z', expires_at: '2026-11-18T00:10:10Z' });
const UNKNOWN_TARGET = payload({ target: 'agent:unknown-bot' });
const ORG_KEY_ON_AGENT = payload({}, { new_kid: 'c0ffee00c0ffee00c0ffee00c0ffee00' });
const OTHER_REQUEST = payload({ request_id: 'mpa:00000000000000000000000000000000' });
const LEGACY = { agent_id: AGENT, reason: 'key_compromise' };
// The same instants as ISSUED and EXPIRES, written with offsets and with more decimals than milliseconds.
const WITH_OFFSETS = payload({ issued_at: '2026-11-17T21:00:00-03:00', expires_at: '2026-11-18T01:30:00.000000+01:00' });
// Bounds are counted in Unicode code points: 250 characters outside the BMP are 250, not 500 and not 1000.
const LONGEST = payload({ request_id: `mpa:${'f'.repeat(124)}`, target: `agent:${'\u{1D49C}'.repeat(250)}` });

/** The same bytes, not the canonical encoding: non-zero bits in the last character before the padding. */
function notCanonical(sigB64) {
  const i = sigB64.indexOf('=') - 1;
  const out = sigB64.slice(0, i) + ALPHABET[ALPHABET.indexOf(sigB64[i]) | 1] + sigB64.slice(i + 1);
  if (out === sigB64 || !Buffer.from(out, 'base64').equals(Buffer.from(sigB64, 'base64'))) throw new Error('not a non-canonical spelling');
  return out;
}
const mutate = (entry, change) => {
  const e = structuredClone(entry);
  change(e);
  return e;
};
/** The record the structure cases start from, with one change. No one signed it: it is refused before any signature is read. */
const reshaped = (change) => mutate(record('revoke_agent', REVOKE, [unsigned(ALICE.id, 'owner'), unsigned(BOB.id, 'org_admin', 1)]), change);
/** The same, the change made to the composite signature of the second authorization. */
const resigned = (change) => reshaped((r) => change(r.authorizations[1].composite_sig));
/** The same, the change made to the request block. */
const rerequested = (change) => reshaped((r) => change(r.operation_payload.request));

/** 2^53 + 1: JSON.stringify cannot write it, so its digits replace a placeholder in the text of the file. */
const ODD = { placeholder: 2 ** 53 + 2, digits: '9007199254740993' };
/**
 * Number literals JSON.stringify does not write: each is the value of a member with a name of its own, and its text
 * replaces the value wherever the file has that member. A literal with a decimal point or an exponent is the integer
 * a binary64 reads it as.
 */
const LITERALS = [
  { member: 'amount', value: ODD.placeholder, text: ODD.digits },
  { member: 'ceiling_with_a_point', value: Number.MAX_SAFE_INTEGER, text: '9007199254740991.0' },
  { member: 'amount_with_a_point', value: 2 ** 53, text: '9007199254740992.0' },
];
const literal = (member) => ({ [member]: LITERALS.find((l) => l.member === member).value });

const RECORDS = {
  two_of_three: record('revoke_agent', REVOKE, [ALICE_REVOKES, BOB_REVOKES]),
  three_of_three: record('revoke_agent', REVOKE, [ALICE_REVOKES, BOB_REVOKES, CAROL_REVOKES]),
  recovery_three: signed('modify_recovery_config', RECOVERY, [[ALICE, 'owner'], [BOB, 'org_admin'], [CAROL, 'recovery_contact']], 3),
  recovery_two: signed('modify_recovery_config', RECOVERY, [[ALICE, 'owner'], [BOB, 'org_admin']]),
  org_key: signed('rotate_org_key', ORG_KEY, [[ALICE, 'owner'], [ERIN, 'org_admin']]),
  jurisdiction: signed('change_jurisdiction', JURISDICTION, [[BOB, 'org_admin'], [ERIN, 'org_admin']]),
  no_parameters: signed('revoke_agent', NO_PARAMETERS, [[ALICE, 'owner'], [BOB, 'org_admin']]),
  decimal_point_at_the_limit: signed('revoke_agent', payload({}, literal('ceiling_with_a_point')), [[ALICE, 'owner'], [BOB, 'org_admin']]),
  integers_at_the_limit: signed('revoke_agent', payload({}, { ceiling: Number.MAX_SAFE_INTEGER, floor: Number.MIN_SAFE_INTEGER }), [[ALICE, 'owner'], [BOB, 'org_admin']]),
  record_asks_for_five: record('revoke_agent', REVOKE, [ALICE_REVOKES, BOB_REVOKES], 5),
  record_asks_for_an_absurd_number: record('revoke_agent', REVOKE, [ALICE_REVOKES, BOB_REVOKES], 1e30),
  with_offsets: signed('revoke_agent', WITH_OFFSETS, [[ALICE, 'owner'], [BOB, 'org_admin']]),

  // limits: exactly on a bound, so the structure phase lets them through; no signature is read
  sixteen_authorizations: record('revoke_agent', REVOKE, Array.from({ length: 16 }, (_, n) => unsigned(`human:party-${String(n + 1).padStart(2, '0')}`, 'org_admin', n))),
  longest_identifiers: record('revoke_agent', LONGEST, [unsigned(ALICE.id, 'owner'), unsigned(BOB.id, 'org_admin', 1)]),

  // structure: refused before any signature is read, so most carry none
  unknown_member: { ...record('revoke_agent', REVOKE, [unsigned(ALICE.id, 'owner'), unsigned(BOB.id, 'org_admin', 1)]), extra: 1 },
  unknown_operation: record('delete_everything', REVOKE, [unsigned(ALICE.id, 'owner'), unsigned(BOB.id, 'org_admin', 1)]),
  no_authorizations: record('revoke_agent', REVOKE, []),
  entry_without_signature: record('revoke_agent', REVOKE, [unsigned(ALICE.id, 'owner'), { party_id: BOB.id, role: 'org_admin' }]),
  kid_not_hex: record('revoke_agent', REVOKE, [
    unsigned(ALICE.id, 'owner'),
    mutate(unsigned(BOB.id, 'org_admin', 1), (e) => { e.composite_sig.classical.kid = 'not-a-kid'; }),
  ]),
  threshold_below_two: record('revoke_agent', REVOKE, [unsigned(ALICE.id, 'owner'), unsigned(BOB.id, 'org_admin', 1)], 1),
  without_request: signed('revoke_agent', LEGACY, [[ALICE, 'owner'], [BOB, 'org_admin']]),
  request_unknown_member: record('revoke_agent', { request: { ...request(), note: 'urgent' }, parameters: {} }, [unsigned(ALICE.id, 'owner'), unsigned(BOB.id, 'org_admin', 1)]),
  payload_unknown_member: record('revoke_agent', { ...REVOKE, extra: true }, [unsigned(ALICE.id, 'owner'), unsigned(BOB.id, 'org_admin', 1)]),
  another_profile: record('revoke_agent', payload({ profile: 'mpa-v2' }), [unsigned(ALICE.id, 'owner'), unsigned(BOB.id, 'org_admin', 1)]),
  expiry_not_a_timestamp: record('revoke_agent', payload({ expires_at: 'tomorrow' }), [unsigned(ALICE.id, 'owner'), unsigned(BOB.id, 'org_admin', 1)]),
  empty_request_id: record('revoke_agent', payload({ request_id: '' }), [unsigned(ALICE.id, 'owner'), unsigned(BOB.id, 'org_admin', 1)]),
  target_too_long: record('revoke_agent', payload({ target: `agent:${'a'.repeat(251)}` }), [unsigned(ALICE.id, 'owner'), unsigned(BOB.id, 'org_admin', 1)]),
  parameters_not_an_object: record('revoke_agent', { request: request(), parameters: 'none' }, [unsigned(ALICE.id, 'owner'), unsigned(BOB.id, 'org_admin', 1)]),
  number_not_an_integer: record('revoke_agent', payload({}, { ratio: 0.5 }), [unsigned(ALICE.id, 'owner'), unsigned(BOB.id, 'org_admin', 1)]),
  // Past 2^53 - 1 a binary64 no longer holds every integer. Both parties signed these two: the signatures are not the problem.
  integer_above_the_limit: signed('revoke_agent', payload({}, { amount: 2 ** 53 }), [[ALICE, 'owner'], [BOB, 'org_admin']]),
  integer_below_the_limit: signed('revoke_agent', payload({}, { limits: [1, { floor: -(2 ** 53) }] }), [[ALICE, 'owner'], [BOB, 'org_admin']]),
  integer_in_exponent_form: record('revoke_agent', payload({}, { amount: 1e21 }), [unsigned(ALICE.id, 'owner'), unsigned(BOB.id, 'org_admin', 1)]),
  integer_no_binary64_holds: record('revoke_agent', payload({}, { amount: ODD.placeholder }), [unsigned(ALICE.id, 'owner'), unsigned(BOB.id, 'org_admin', 1)]),
  decimal_point_past_the_limit: signed('revoke_agent', payload({}, literal('amount_with_a_point')), [[ALICE, 'owner'], [BOB, 'org_admin']]),
  seventeen_authorizations_and_2_to_the_53: record('revoke_agent', payload({}, { amount: 2 ** 53 }), Array.from({ length: 17 }, (_, n) => unsigned(`human:party-${String(n + 1).padStart(2, '0')}`, 'org_admin', n))),
  seventeen_authorizations: record('revoke_agent', REVOKE, Array.from({ length: 17 }, (_, n) => unsigned(`human:party-${String(n + 1).padStart(2, '0')}`, 'org_admin', n))),

  // structure, the record schema keyword by keyword: the same record with one change
  not_an_object: [reshaped(() => {})],
  member_missing: reshaped((r) => { delete r.required_parties; }),
  member_renamed: reshaped((r) => { delete r.required_parties; r.threshold = 2; }),
  another_type: reshaped((r) => { r.type = 'delegation_mandate'; }),
  operation_not_a_string: reshaped((r) => { r.operation = ['revoke_agent']; }),
  payload_is_an_array: reshaped((r) => { r.operation_payload = [r.operation_payload]; }),
  payload_is_null: reshaped((r) => { r.operation_payload = null; }),
  threshold_not_an_integer: reshaped((r) => { r.required_parties = 2.5; }),
  threshold_a_boolean: reshaped((r) => { r.required_parties = true; }),
  threshold_a_string: reshaped((r) => { r.required_parties = '2'; }),
  authorizations_not_an_array: reshaped((r) => { r.authorizations = { ...r.authorizations }; }),
  entry_not_an_object: reshaped((r) => { r.authorizations[1] = BOB.id; }),
  entry_unknown_member: reshaped((r) => { r.authorizations[1].delegated_by = ALICE.id; }),
  party_id_not_a_string: reshaped((r) => { r.authorizations[1].party_id = 7; }),
  role_outside_the_list: reshaped((r) => { r.authorizations[1].role = 'admin'; }),
  role_not_a_string: reshaped((r) => { r.authorizations[1].role = ['org_admin']; }),
  signature_not_an_object: reshaped((r) => { r.authorizations[1].composite_sig = 'AAAAAAAAAAA='; }),
  signature_unknown_member: resigned((s) => { s.hash_alg = 'sha256'; }),
  signature_without_the_pq_member: resigned((s) => { delete s.pq; }),
  pq_is_false: resigned((s) => { s.pq = false; }),
  binding_outside_the_list: resigned((s) => { s.binding = 'hybrid'; }),
  binding_not_a_string: resigned((s) => { s.binding = ['pq_over_classical']; }),
  part_not_an_object: resigned((s) => { s.classical = s.classical.sig_b64; }),
  part_unknown_member: resigned((s) => { s.classical.public_key_b64 = ALICE.classical.public_key_b64; }),
  part_member_missing: resigned((s) => { delete s.pq.alg; }),
  alg_not_a_string: resigned((s) => { s.classical.alg = 1; }),
  kid_uppercase: resigned((s) => { s.classical.kid = 'ABCDEF0123456789ABCDEF0123456789'; }),
  kid_too_long: resigned((s) => { s.classical.kid += '0'; }),
  kid_with_a_line_feed: resigned((s) => { s.classical.kid += '\n'; }),
  kid_not_a_string: resigned((s) => { s.classical.kid = 7; }),
  signature_too_short: resigned((s) => { s.classical.sig_b64 = 'AAAAAA='; }),
  signature_too_long: resigned((s) => { s.pq.sig_b64 = 'A'.repeat(66477); }),
  signature_in_base64url: resigned((s) => { s.classical.sig_b64 = 'AAAA-AAA_AA='; }),
  signature_with_three_padding_characters: resigned((s) => { s.classical.sig_b64 = 'AAAAAAAAA==='; }),
  signature_padded_in_the_middle: resigned((s) => { s.classical.sig_b64 = 'AAAA=AAAAAA='; }),
  signature_with_a_line_feed: resigned((s) => { s.classical.sig_b64 += '\n'; }),
  sig_b64_not_a_string: resigned((s) => { s.pq.sig_b64 = 7; }),

  // structure, the request block keyword by keyword
  request_is_null: reshaped((r) => { r.operation_payload.request = null; }),
  request_member_missing: rerequested((q) => { delete q.audience; }),
  request_without_expiry: rerequested((q) => { delete q.expires_at; }),
  profile_not_a_string: rerequested((q) => { q.profile = [PROFILE]; }),
  without_parameters: reshaped((r) => { delete r.operation_payload.parameters; }),
  parameters_is_an_array: reshaped((r) => { r.operation_payload.parameters = []; }),
  request_id_too_long: rerequested((q) => { q.request_id = `mpa:${'f'.repeat(125)}`; }),
  request_id_not_a_string: rerequested((q) => { q.request_id = 7; }),
  empty_target: rerequested((q) => { q.target = ''; }),
  empty_audience: rerequested((q) => { q.audience = ''; }),
  audience_too_long: rerequested((q) => { q.audience = `verifier:${'a'.repeat(248)}`; }),
  target_not_a_string: rerequested((q) => { q.target = 7; }),
  audience_not_a_string: rerequested((q) => { q.audience = [AUDIENCE]; }),
  issued_at_not_a_timestamp: rerequested((q) => { q.issued_at = '2026-11-18'; }),
  expiry_without_an_offset: rerequested((q) => { q.expires_at = '2026-11-18T00:30:00'; }),
  expiry_on_an_impossible_day: rerequested((q) => { q.expires_at = '2026-11-31T00:30:00Z'; }),
  issued_at_a_number: rerequested((q) => { q.issued_at = ms(ISSUED); }),
  expiry_a_number: rerequested((q) => { q.expires_at = ms(EXPIRES); }),

  // binding: every signature verifies
  another_audience: signed('revoke_agent', OTHER_AUDIENCE, [[ALICE, 'owner'], [BOB, 'org_admin']]),
  validity_too_long: signed('revoke_agent', TOO_LONG, [[ALICE, 'owner'], [BOB, 'org_admin']]),
  expiry_before_issue: signed('revoke_agent', BACKWARDS, [[ALICE, 'owner'], [BOB, 'org_admin']]),
  unknown_target: signed('revoke_agent', UNKNOWN_TARGET, [[ALICE, 'owner'], [BOB, 'org_admin']]),
  org_key_on_an_agent: signed('rotate_org_key', ORG_KEY_ON_AGENT, [[ALICE, 'owner'], [BOB, 'org_admin']]),

  // parties: every signature verifies
  unknown_party: record('revoke_agent', REVOKE, [ALICE_REVOKES, sign(MALLORY, 'revoke_agent', REVOKE, 'owner')]),
  party_of_another_target: record('revoke_agent', REVOKE, [ALICE_REVOKES, sign(DAVE, 'revoke_agent', REVOKE, 'owner')]),
  same_party_twice: record('revoke_agent', REVOKE, [ALICE_REVOKES, ALICE_REVOKES]),
  same_party_two_roles: record('revoke_agent', REVOKE, [ALICE_REVOKES, sign(ALICE, 'revoke_agent', REVOKE, 'org_admin')]),
  self_assigned_role: record('revoke_agent', REVOKE, [sign(CAROL, 'revoke_agent', REVOKE, 'owner'), BOB_REVOKES]),
  role_not_allowed: signed('rotate_org_key', ORG_KEY, [[ALICE, 'owner'], [CAROL, 'recovery_contact']]),
  two_parties_and_an_outsider: record('revoke_agent', REVOKE, [ALICE_REVOKES, BOB_REVOKES, sign(MALLORY, 'revoke_agent', REVOKE, 'recovery_contact')]),
  empty_party_id: record('revoke_agent', REVOKE, [ALICE_REVOKES, sign(MALLORY, 'revoke_agent', REVOKE, 'org_admin', { as: '' })]),

  // signatures: Alice's entry is valid, Bob's is not
  classical_only: withBob(mutate(BOB_REVOKES, (e) => { e.composite_sig.pq = null; e.composite_sig.binding = 'classical_only'; })),
  pq_removed_under_the_hybrid_binding: withBob(mutate(BOB_REVOKES, (e) => { e.composite_sig.pq = null; })),
  hybrid_signature_declared_classical_only: withBob(mutate(BOB_REVOKES, (e) => { e.composite_sig.binding = 'classical_only'; })),
  unknown_classical_algorithm: withBob(mutate(BOB_REVOKES, (e) => { e.composite_sig.classical.alg = 'rsa-2048'; })),
  two_classical_signatures: withBob(mutate(BOB_REVOKES, (e) => {
    const msg = signedBytes('revoke_agent', REVOKE, BOB.id, 'org_admin');
    const second = ALGS.ed25519.sign(Buffer.concat([msg, Buffer.from(e.composite_sig.classical.sig_b64, 'base64')]), BOB.classical.secretKey);
    e.composite_sig.pq = { alg: 'ed25519', kid: BOB.classical.kid, sig_b64: b64(second) };
  })),
  signed_by_an_outsider: withBob(sign(MALLORY, 'revoke_agent', REVOKE, 'org_admin', { as: BOB.id })),
  signed_by_another_party: withBob(sign(ALICE, 'revoke_agent', REVOKE, 'org_admin', { as: BOB.id })),
  outsider_under_the_party_kids: withBob(sign(MALLORY, 'revoke_agent', REVOKE, 'org_admin', { as: BOB.id, kidsOf: BOB })),
  signed_another_request: withBob(sign(BOB, 'revoke_agent', OTHER_REQUEST, 'org_admin')),
  signed_under_another_context: withBob(sign(BOB, 'revoke_agent', REVOKE, 'org_admin', { context: 'DCP-AI.v2.KeyRotation' })),
  pq_not_over_the_classical: withBob(sign(BOB, 'revoke_agent', REVOKE, 'org_admin', { pqCoversClassical: false })),
  kid_of_the_other_algorithm: withBob(mutate(BOB_REVOKES, (e) => { e.composite_sig.classical.kid = BOB.pq.kid; })),
  two_valid_and_one_forged: record('revoke_agent', REVOKE, [ALICE_REVOKES, BOB_REVOKES, sign(MALLORY, 'revoke_agent', REVOKE, 'recovery_contact', { as: CAROL.id, kidsOf: CAROL })]),
  signature_not_canonical_base64: withBob(mutate(BOB_REVOKES, (e) => { e.composite_sig.classical.sig_b64 = notCanonical(e.composite_sig.classical.sig_b64); })),

  // threshold: every signature verifies
  one_party: record('revoke_agent', REVOKE, [ALICE_REVOKES]),
  no_owner: record('revoke_agent', REVOKE, [BOB_REVOKES, CAROL_REVOKES]),
  one_party_not_the_owner: record('revoke_agent', REVOKE, [BOB_REVOKES]),
};

// ── The operator's configuration ──
const trustKey = (k, over = {}) => ({ kid: k.kid, alg: k.alg, public_key_b64: k.public_key_b64, status: 'active', ...over });
const principal = (p, classical = {}, pq = {}) => ({ human_id: p.id, keys: [trustKey(p.classical, classical), trustKey(p.pq, pq)] });
const trustSet = (version, ...principals) => ({ trust_set_version: version, principals });
const TRUST_SETS = {
  base: trustSet('2026-11-18.1', ...[ALICE, BOB, CAROL, DAVE, ERIN].map((p) => principal(p))),
  bob_classical_revoked: trustSet('2026-11-18.2', principal(ALICE), principal(BOB, { status: 'revoked' })),
  bob_pq_expired: trustSet('2026-11-18.3', principal(ALICE), principal(BOB, {}, { expires_at: '2026-11-18T00:05:00Z' })),
  bob_classical_not_yet_valid: trustSet('2026-11-18.4', principal(ALICE), principal(BOB, { not_before: '2026-11-18T00:20:00Z' })),
  without_bob: trustSet('2026-11-18.5', principal(ALICE)),
};

const ALL_ROLES = ['owner', 'org_admin', 'recovery_contact'];
const POLICY_SETS = {
  base: {
    policy_set_version: '2026-11-18.1',
    profile: PROFILE,
    audience: AUDIENCE,
    max_validity_seconds: 1800,
    subjects: [
      {
        target: AGENT,
        parties: [{ party_id: ALICE.id, role: 'owner' }, { party_id: BOB.id, role: 'org_admin' }, { party_id: CAROL.id, role: 'recovery_contact' }],
        operations: {
          revoke_agent: { required_parties: 2, allowed_roles: ALL_ROLES, required_roles: ['owner'] },
          modify_recovery_config: { required_parties: 3, allowed_roles: ALL_ROLES, required_roles: ['owner'] },
        },
      },
      {
        target: ORG,
        parties: [
          { party_id: ALICE.id, role: 'owner' },
          { party_id: BOB.id, role: 'org_admin' },
          { party_id: ERIN.id, role: 'org_admin' },
          { party_id: CAROL.id, role: 'recovery_contact' },
        ],
        operations: {
          rotate_org_key: { required_parties: 2, allowed_roles: ['owner', 'org_admin'], required_roles: ['owner'] },
          change_jurisdiction: { required_parties: 2, allowed_roles: ['org_admin'], required_roles: [] },
        },
      },
      {
        target: 'agent:other-bot',
        parties: [{ party_id: DAVE.id, role: 'owner' }, { party_id: BOB.id, role: 'org_admin' }],
        operations: { revoke_agent: { required_parties: 2, allowed_roles: ['owner', 'org_admin'], required_roles: ['owner'] } },
      },
    ],
  },
};

// ── Cases: [name, group, rule, {record, trust_set, now, expected}, expect] ──
const expectedOf = (rec) => ({ operation: rec.operation, target: rec.operation_payload.request.target, parameters: rec.operation_payload.parameters });
const BASE_EXPECTED = expectedOf(RECORDS.two_of_three);
const yes = (parties_counted, required_parties = 2) => ({ authorized: true, structure: 'valid', verification: 'verified', parties_counted, required_parties, codes: [] });
const malformed = (code) => ({ authorized: false, structure: 'invalid', verification: 'not_evaluated', parties_counted: null, required_parties: null, codes: [code] });
const unbound = (codes, required_parties = 2) => ({ authorized: false, structure: 'valid', verification: 'not_evaluated', parties_counted: null, required_parties, codes: [...codes].sort() });
const unverified = (parties_counted, ...codes) => ({ authorized: false, structure: 'valid', verification: 'failed', parties_counted, required_parties: 2, codes: codes.sort() });
const short = (parties_counted, required_parties, ...codes) => ({ authorized: false, structure: 'valid', verification: 'verified', parties_counted, required_parties, codes: codes.sort() });

const CASES = [
  // controls: authorized
  ['two_of_three', 'controls', 'The owner and an administrator of the target, both hybrid signatures, within the window', { record: 'two_of_three' }, yes(2)],
  ['three_of_three', 'controls', 'More parties than the threshold, all valid', { record: 'three_of_three' }, yes(3)],
  ['three_required', 'controls', 'An operation the operator asks three parties for', { record: 'recovery_three' }, yes(3, 3)],
  ['organization_target', 'controls', 'Another target with its own parties and operations', { record: 'org_key' }, yes(2)],
  ['no_required_role', 'controls', 'An operation with no required role: two administrators', { record: 'jurisdiction' }, yes(2)],
  ['empty_parameters', 'controls', 'An operation without parameters', { record: 'no_parameters' }, yes(2)],
  ['decimal_point_at_the_limit', 'controls', '2^53 - 1 written 9007199254740991.0: the integer a binary64 reads, and the one the parties signed', { record: 'decimal_point_at_the_limit' }, yes(2)],
  ['integers_at_the_limit', 'controls', 'Parameters with 2^53 - 1 and -(2^53 - 1), the largest integers of the profile', { record: 'integers_at_the_limit' }, yes(2)],
  ['record_asks_for_more_than_the_operator', 'controls', 'required_parties in the record is not signed and does not count', { record: 'record_asks_for_five' }, yes(2)],
  ['record_asks_for_an_absurd_number', 'controls', 'required_parties 1e+30: an integer for the schema, larger than any machine integer, and it does not count', { record: 'record_asks_for_an_absurd_number' }, yes(2)],
  ['last_instant', 'controls', 'One millisecond before expires_at', { record: 'two_of_three', now: '2026-11-18T00:29:59.999Z' }, yes(2)],
  ['issued_within_the_clock_allowance', 'controls', 'issued_at 30 seconds ahead of now', { record: 'two_of_three', now: '2026-11-17T23:59:30Z' }, yes(2)],
  ['timestamps_with_offsets', 'controls', 'RFC 3339 instants with numeric offsets and microseconds', { record: 'with_offsets' }, yes(2)],

  // limits: exactly on a bound; refused later, by another phase
  ['sixteen_authorizations', 'limits', 'Sixteen authorizations are not too many', { record: 'sixteen_authorizations' }, unbound(['MPA_PARTY_UNKNOWN'])],
  ['longest_identifiers', 'limits', 'A request_id of 128 characters and a target of 256 code points outside the BMP', { record: 'longest_identifiers' }, unbound(['MPA_TARGET_UNKNOWN'], null)],

  // structure: one code, nothing else evaluated
  ['unknown_member', 'structure', 'A member the v2.0 schema does not have', { record: 'unknown_member' }, malformed('MPA_SCHEMA_INVALID')],
  ['unknown_operation', 'structure', 'An operation outside the list', { record: 'unknown_operation' }, malformed('MPA_SCHEMA_INVALID')],
  ['no_authorizations', 'structure', 'An empty authorizations array', { record: 'no_authorizations' }, malformed('MPA_SCHEMA_INVALID')],
  ['entry_without_signature', 'structure', 'An authorization without composite_sig', { record: 'entry_without_signature' }, malformed('MPA_SCHEMA_INVALID')],
  ['kid_not_hex', 'structure', 'A kid that is not 32 hexadecimal characters', { record: 'kid_not_hex' }, malformed('MPA_SCHEMA_INVALID')],
  ['threshold_below_two', 'structure', 'required_parties below the schema minimum', { record: 'threshold_below_two' }, malformed('MPA_SCHEMA_INVALID')],
  ['not_an_object', 'structure', 'The record inside an array', { record: 'not_an_object' }, malformed('MPA_SCHEMA_INVALID')],
  ['member_missing', 'structure', 'A record without required_parties: no evaluation reads it, and the schema requires it', { record: 'member_missing' }, malformed('MPA_SCHEMA_INVALID')],
  ['member_renamed', 'structure', 'Five members, one of them under another name', { record: 'member_renamed' }, malformed('MPA_SCHEMA_INVALID')],
  ['another_type', 'structure', 'The type of another artifact', { record: 'another_type' }, malformed('MPA_SCHEMA_INVALID')],
  ['operation_not_a_string', 'structure', 'An operation that is an array holding one', { record: 'operation_not_a_string' }, malformed('MPA_SCHEMA_INVALID')],
  ['payload_is_an_array', 'structure', 'operation_payload inside an array', { record: 'payload_is_an_array' }, malformed('MPA_SCHEMA_INVALID')],
  ['payload_is_null', 'structure', 'operation_payload that is null', { record: 'payload_is_null' }, malformed('MPA_SCHEMA_INVALID')],
  ['threshold_not_an_integer', 'structure', 'required_parties 2.5', { record: 'threshold_not_an_integer' }, malformed('MPA_SCHEMA_INVALID')],
  ['threshold_a_boolean', 'structure', 'required_parties true', { record: 'threshold_a_boolean' }, malformed('MPA_SCHEMA_INVALID')],
  ['threshold_a_string', 'structure', 'required_parties "2"', { record: 'threshold_a_string' }, malformed('MPA_SCHEMA_INVALID')],
  ['authorizations_not_an_array', 'structure', 'authorizations as an object with the members "0" and "1"', { record: 'authorizations_not_an_array' }, malformed('MPA_SCHEMA_INVALID')],
  ['entry_not_an_object', 'structure', 'An authorization that is a party_id alone', { record: 'entry_not_an_object' }, malformed('MPA_SCHEMA_INVALID')],
  ['entry_unknown_member', 'structure', 'An authorization with a member the schema does not have', { record: 'entry_unknown_member' }, malformed('MPA_SCHEMA_INVALID')],
  ['party_id_not_a_string', 'structure', 'A party_id that is a number', { record: 'party_id_not_a_string' }, malformed('MPA_SCHEMA_INVALID')],
  ['role_outside_the_list', 'structure', 'A role outside the list', { record: 'role_outside_the_list' }, malformed('MPA_SCHEMA_INVALID')],
  ['role_not_a_string', 'structure', 'A role that is an array holding one', { record: 'role_not_a_string' }, malformed('MPA_SCHEMA_INVALID')],
  ['signature_not_an_object', 'structure', 'composite_sig that is a string', { record: 'signature_not_an_object' }, malformed('MPA_SCHEMA_INVALID')],
  ['signature_unknown_member', 'structure', 'composite_sig with a fourth member', { record: 'signature_unknown_member' }, malformed('MPA_SCHEMA_INVALID')],
  ['signature_without_the_pq_member', 'structure', 'composite_sig without pq: absent is not null', { record: 'signature_without_the_pq_member' }, malformed('MPA_SCHEMA_INVALID')],
  ['pq_is_false', 'structure', 'pq that is false: only null stands for no post-quantum component', { record: 'pq_is_false' }, malformed('MPA_SCHEMA_INVALID')],
  ['binding_outside_the_list', 'structure', 'A binding outside the list', { record: 'binding_outside_the_list' }, malformed('MPA_SCHEMA_INVALID')],
  ['binding_not_a_string', 'structure', 'A binding that is an array holding one', { record: 'binding_not_a_string' }, malformed('MPA_SCHEMA_INVALID')],
  ['part_not_an_object', 'structure', 'A component that is its sig_b64 alone', { record: 'part_not_an_object' }, malformed('MPA_SCHEMA_INVALID')],
  ['part_unknown_member', 'structure', 'A component that brings a public key with it', { record: 'part_unknown_member' }, malformed('MPA_SCHEMA_INVALID')],
  ['part_member_missing', 'structure', 'A component without alg', { record: 'part_member_missing' }, malformed('MPA_SCHEMA_INVALID')],
  ['alg_not_a_string', 'structure', 'An alg that is a number', { record: 'alg_not_a_string' }, malformed('MPA_SCHEMA_INVALID')],
  ['kid_uppercase', 'structure', 'A kid of 32 uppercase hexadecimal characters', { record: 'kid_uppercase' }, malformed('MPA_SCHEMA_INVALID')],
  ['kid_too_long', 'structure', 'A kid of 33 hexadecimal characters', { record: 'kid_too_long' }, malformed('MPA_SCHEMA_INVALID')],
  ['kid_with_a_line_feed', 'structure', 'A kid followed by a line feed', { record: 'kid_with_a_line_feed' }, malformed('MPA_SCHEMA_INVALID')],
  ['kid_not_a_string', 'structure', 'A kid that is a number', { record: 'kid_not_a_string' }, malformed('MPA_SCHEMA_INVALID')],
  ['signature_too_short', 'structure', 'A sig_b64 of 7 characters', { record: 'signature_too_short' }, malformed('MPA_SCHEMA_INVALID')],
  ['signature_too_long', 'structure', 'A sig_b64 of 66477 characters', { record: 'signature_too_long' }, malformed('MPA_SCHEMA_INVALID')],
  ['signature_in_base64url', 'structure', 'A sig_b64 in the URL-safe alphabet', { record: 'signature_in_base64url' }, malformed('MPA_SCHEMA_INVALID')],
  ['signature_with_three_padding_characters', 'structure', 'A sig_b64 that ends in three padding characters', { record: 'signature_with_three_padding_characters' }, malformed('MPA_SCHEMA_INVALID')],
  ['signature_padded_in_the_middle', 'structure', 'A sig_b64 with a padding character before its end', { record: 'signature_padded_in_the_middle' }, malformed('MPA_SCHEMA_INVALID')],
  ['signature_with_a_line_feed', 'structure', 'A sig_b64 followed by a line feed', { record: 'signature_with_a_line_feed' }, malformed('MPA_SCHEMA_INVALID')],
  ['sig_b64_not_a_string', 'structure', 'A sig_b64 that is a number', { record: 'sig_b64_not_a_string' }, malformed('MPA_SCHEMA_INVALID')],
  ['without_request', 'structure', 'A v2.0 record, validly signed by two parties, without the request block: never authorized under the profile', { record: 'without_request' }, malformed('MPA_REQUEST_MISSING')],
  ['request_unknown_member', 'structure', 'A member the request block does not have', { record: 'request_unknown_member' }, malformed('MPA_REQUEST_INVALID')],
  ['payload_unknown_member', 'structure', 'operation_payload with a third member', { record: 'payload_unknown_member' }, malformed('MPA_REQUEST_INVALID')],
  ['another_profile', 'structure', 'A profile other than mpa-v1', { record: 'another_profile' }, malformed('MPA_REQUEST_INVALID')],
  ['expiry_not_a_timestamp', 'structure', 'expires_at that is not RFC 3339', { record: 'expiry_not_a_timestamp' }, malformed('MPA_REQUEST_INVALID')],
  ['empty_request_id', 'structure', 'An empty request_id', { record: 'empty_request_id' }, malformed('MPA_REQUEST_INVALID')],
  ['target_too_long', 'structure', 'A target of 257 characters', { record: 'target_too_long' }, malformed('MPA_REQUEST_INVALID')],
  ['parameters_not_an_object', 'structure', 'parameters that is a string', { record: 'parameters_not_an_object' }, malformed('MPA_REQUEST_INVALID')],
  ['request_is_null', 'structure', 'A request member that is null: it is there, and it is not a request', { record: 'request_is_null' }, malformed('MPA_REQUEST_INVALID')],
  ['request_member_missing', 'structure', 'A request without audience', { record: 'request_member_missing' }, malformed('MPA_REQUEST_INVALID')],
  ['request_without_expiry', 'structure', 'A request without expires_at: absent is not never', { record: 'request_without_expiry' }, malformed('MPA_REQUEST_INVALID')],
  ['profile_not_a_string', 'structure', 'A profile that is an array holding mpa-v1', { record: 'profile_not_a_string' }, malformed('MPA_REQUEST_INVALID')],
  ['without_parameters', 'structure', 'operation_payload without parameters: absent is not empty', { record: 'without_parameters' }, malformed('MPA_REQUEST_INVALID')],
  ['parameters_is_an_array', 'structure', 'parameters that is an empty array', { record: 'parameters_is_an_array' }, malformed('MPA_REQUEST_INVALID')],
  ['request_id_too_long', 'structure', 'A request_id of 129 characters', { record: 'request_id_too_long' }, malformed('MPA_REQUEST_INVALID')],
  ['request_id_not_a_string', 'structure', 'A request_id that is a number', { record: 'request_id_not_a_string' }, malformed('MPA_REQUEST_INVALID')],
  ['empty_target', 'structure', 'An empty target', { record: 'empty_target' }, malformed('MPA_REQUEST_INVALID')],
  ['empty_audience', 'structure', 'An empty audience', { record: 'empty_audience' }, malformed('MPA_REQUEST_INVALID')],
  ['audience_too_long', 'structure', 'An audience of 257 characters', { record: 'audience_too_long' }, malformed('MPA_REQUEST_INVALID')],
  ['target_not_a_string', 'structure', 'A target that is a number', { record: 'target_not_a_string' }, malformed('MPA_REQUEST_INVALID')],
  ['audience_not_a_string', 'structure', 'An audience that is an array holding the right one', { record: 'audience_not_a_string' }, malformed('MPA_REQUEST_INVALID')],
  ['issued_at_not_a_timestamp', 'structure', 'issued_at that is a date without a time', { record: 'issued_at_not_a_timestamp' }, malformed('MPA_REQUEST_INVALID')],
  ['expiry_without_an_offset', 'structure', 'expires_at without Z or an offset', { record: 'expiry_without_an_offset' }, malformed('MPA_REQUEST_INVALID')],
  ['expiry_on_an_impossible_day', 'structure', 'expires_at on 31 November', { record: 'expiry_on_an_impossible_day' }, malformed('MPA_REQUEST_INVALID')],
  ['issued_at_a_number', 'structure', 'issued_at as a number of milliseconds', { record: 'issued_at_a_number' }, malformed('MPA_REQUEST_INVALID')],
  ['expiry_a_number', 'structure', 'expires_at as a number of milliseconds', { record: 'expiry_a_number' }, malformed('MPA_REQUEST_INVALID')],
  ['number_not_an_integer', 'structure', 'A number dcp-jcs-v1 cannot represent', { record: 'number_not_an_integer' }, malformed('MPA_NOT_REPRESENTABLE')],
  ['integer_above_the_limit', 'structure', '2^53 in parameters, signed by both parties: one more than the largest integer of the profile', { record: 'integer_above_the_limit' }, malformed('MPA_NOT_REPRESENTABLE')],
  ['integer_below_the_limit', 'structure', '-(2^53) inside an array of parameters, signed by both parties', { record: 'integer_below_the_limit' }, malformed('MPA_NOT_REPRESENTABLE')],
  ['integer_in_exponent_form', 'structure', '1e+21: an integer for JSON, past the range', { record: 'integer_in_exponent_form' }, malformed('MPA_NOT_REPRESENTABLE')],
  ['integer_no_binary64_holds', 'structure', 'The digits of 2^53 + 1: read as a binary64 they are 2^53, read exactly they are not, and neither is in the range', { record: 'integer_no_binary64_holds' }, malformed('MPA_NOT_REPRESENTABLE')],
  ['decimal_point_past_the_limit', 'structure', '2^53 written 9007199254740992.0, signed by both parties: a decimal point does not move the limit', { record: 'decimal_point_past_the_limit' }, malformed('MPA_NOT_REPRESENTABLE')],
  ['number_out_of_range_before_too_many', 'structure', 'Seventeen authorizations and 2^53 in parameters: the first failure in the order of the phase is the number', { record: 'seventeen_authorizations_and_2_to_the_53' }, malformed('MPA_NOT_REPRESENTABLE')],
  ['seventeen_authorizations', 'structure', 'More than 16 authorizations', { record: 'seventeen_authorizations' }, malformed('MPA_TOO_MANY_AUTHORIZATIONS')],

  // binding: the signatures verify; the request is not the one the executor is about to carry out, here, now
  ['another_operation_expected', 'binding', 'The executor is about to do another operation', { record: 'two_of_three', expected: { ...BASE_EXPECTED, operation: 'modify_recovery_config' } }, unbound(['MPA_OPERATION_MISMATCH'])],
  ['another_target_expected', 'binding', 'The executor is about to act on another target', { record: 'two_of_three', expected: { ...BASE_EXPECTED, target: 'agent:other-bot' } }, unbound(['MPA_TARGET_MISMATCH'])],
  ['other_parameters_expected', 'binding', 'The executor is about to use other parameters', { record: 'two_of_three', expected: { ...BASE_EXPECTED, parameters: { reason: 'routine' } } }, unbound(['MPA_PARAMETERS_MISMATCH'])],
  ['another_target_and_other_parameters', 'binding', 'Every code of the phase is reported', { record: 'two_of_three', expected: { ...BASE_EXPECTED, target: 'agent:other-bot', parameters: {} } }, unbound(['MPA_TARGET_MISMATCH', 'MPA_PARAMETERS_MISMATCH'])],
  ['another_audience', 'binding', 'Signed for another verifier', { record: 'another_audience' }, unbound(['MPA_AUDIENCE_MISMATCH'])],
  ['binding_before_parties', 'binding', 'A phase that adds a code stops the next: the outsider among the parties is not reported', { record: 'unknown_party', expected: { ...BASE_EXPECTED, target: 'agent:other-bot' } }, unbound(['MPA_TARGET_MISMATCH'])],
  ['expired', 'binding', 'now is expires_at', { record: 'two_of_three', now: EXPIRES }, unbound(['MPA_EXPIRED'])],
  ['not_yet_valid', 'binding', 'issued_at more than 30 seconds ahead of now', { record: 'two_of_three', now: '2026-11-17T23:59:29.999Z' }, unbound(['MPA_NOT_YET_VALID'])],
  ['validity_longer_than_the_operator_allows', 'binding', 'A window of 1801 seconds under a limit of 1800', { record: 'validity_too_long' }, unbound(['MPA_VALIDITY_INVALID'])],
  ['expiry_before_issue', 'binding', 'expires_at before issued_at, both otherwise acceptable at now', { record: 'expiry_before_issue' }, unbound(['MPA_VALIDITY_INVALID'])],
  ['target_the_operator_does_not_have', 'binding', 'No subject for the target', { record: 'unknown_target' }, unbound(['MPA_TARGET_UNKNOWN'], null)],
  ['operation_not_listed_for_the_target', 'binding', 'The operator lists the operation for another target only', { record: 'org_key_on_an_agent' }, unbound(['MPA_OPERATION_NOT_ALLOWED'], null)],

  // parties: the signatures verify; the operator does not have these parties, with these roles, for the target
  ['party_the_operator_does_not_know', 'parties', 'Someone who is no party of anything signs as owner', { record: 'unknown_party' }, unbound(['MPA_PARTY_UNKNOWN'])],
  ['party_of_another_target', 'parties', 'The owner of another target', { record: 'party_of_another_target' }, unbound(['MPA_PARTY_UNKNOWN'])],
  ['same_party_twice', 'parties', 'One party listed twice to reach a threshold of two', { record: 'same_party_twice' }, unbound(['MPA_PARTY_DUPLICATE'])],
  ['same_party_under_two_roles', 'parties', 'One party signs once for each of two roles', { record: 'same_party_two_roles' }, unbound(['MPA_PARTY_DUPLICATE', 'MPA_ROLE_MISMATCH'])],
  ['self_assigned_role', 'parties', 'A recovery contact signs as owner', { record: 'self_assigned_role' }, unbound(['MPA_ROLE_MISMATCH'])],
  ['role_not_allowed_for_the_operation', 'parties', 'A party of the target whose role the operation does not allow', { record: 'role_not_allowed' }, unbound(['MPA_ROLE_NOT_ALLOWED'])],
  ['enough_parties_and_an_outsider', 'parties', 'Two valid parties meet the threshold; a third entry from no party of the target refuses the record', { record: 'two_parties_and_an_outsider' }, unbound(['MPA_PARTY_UNKNOWN'])],
  ['empty_party_id', 'parties', 'An empty party_id: a string for the schema, and a party of nothing', { record: 'empty_party_id' }, unbound(['MPA_PARTY_UNKNOWN'])],

  // signatures: one party's authorization is not a hybrid signature by its trusted keys over this request
  ['classical_only', 'signatures', 'The post-quantum component removed', { record: 'classical_only' }, unverified(1, 'MPA_HYBRID_REQUIRED')],
  ['two_classical_signatures', 'signatures', 'A classical signature in the post-quantum slot', { record: 'two_classical_signatures' }, unverified(1, 'MPA_HYBRID_REQUIRED')],
  ['pq_removed_under_the_hybrid_binding', 'signatures', 'The post-quantum component removed and the binding left as it was', { record: 'pq_removed_under_the_hybrid_binding' }, unverified(1, 'MPA_HYBRID_REQUIRED')],
  ['hybrid_signature_declared_classical_only', 'signatures', 'Both components present and valid, under the binding classical_only', { record: 'hybrid_signature_declared_classical_only' }, unverified(1, 'MPA_HYBRID_REQUIRED')],
  ['unknown_classical_algorithm', 'signatures', 'An algorithm no registry has, in the classical slot', { record: 'unknown_classical_algorithm' }, unverified(1, 'MPA_HYBRID_REQUIRED')],
  ['signed_by_an_outsider', 'signatures', 'Keys the trust set has for no one', { record: 'signed_by_an_outsider' }, unverified(1, 'MPA_KEY_NOT_ANCHORED')],
  ['signed_by_another_party', 'signatures', 'One party signs for another with its own trusted keys', { record: 'signed_by_another_party' }, unverified(1, 'MPA_KEY_NOT_ANCHORED')],
  ['outsider_under_the_party_kids', 'signatures', 'The kids of the party over signatures made with other keys', { record: 'outsider_under_the_party_kids' }, unverified(1, 'MPA_SIGNATURE_INVALID')],
  ['signed_another_request', 'signatures', 'A signature of the same party over another request_id', { record: 'signed_another_request' }, unverified(1, 'MPA_SIGNATURE_INVALID')],
  ['signed_under_another_context', 'signatures', 'The same bytes signed under another context tag', { record: 'signed_under_another_context' }, unverified(1, 'MPA_SIGNATURE_INVALID')],
  ['pq_not_over_the_classical', 'signatures', 'A post-quantum signature that does not cover the classical one', { record: 'pq_not_over_the_classical' }, unverified(1, 'MPA_SIGNATURE_INVALID')],
  ['kid_of_the_other_algorithm', 'signatures', 'The classical slot names the kid of the party\'s post-quantum key', { record: 'kid_of_the_other_algorithm' }, unverified(1, 'MPA_KEY_NOT_ANCHORED')],
  ['enough_parties_and_a_forged_signature', 'signatures', 'Two valid parties meet the threshold; a third entry that does not verify refuses the record', { record: 'two_valid_and_one_forged' }, unverified(2, 'MPA_SIGNATURE_INVALID')],
  ['signature_not_canonical_base64', 'signatures', 'A signature spelled with non-zero trailing bits', { record: 'signature_not_canonical_base64' }, unverified(1, 'MPA_SIGNATURE_INVALID')],
  ['key_revoked', 'signatures', 'The operator revoked the classical key', { record: 'two_of_three', trust_set: 'bob_classical_revoked' }, unverified(1, 'MPA_KEY_REVOKED')],
  ['key_expired', 'signatures', 'The post-quantum key expired before now', { record: 'two_of_three', trust_set: 'bob_pq_expired' }, unverified(1, 'MPA_KEY_EXPIRED')],
  ['key_not_yet_valid', 'signatures', 'The classical key is not valid until after now', { record: 'two_of_three', trust_set: 'bob_classical_not_yet_valid' }, unverified(1, 'MPA_KEY_NOT_YET_VALID')],
  ['party_without_keys', 'signatures', 'A party of the policy the trust set does not have', { record: 'two_of_three', trust_set: 'without_bob' }, unverified(1, 'MPA_KEY_NOT_ANCHORED')],

  // threshold: every authorization is valid; they are not enough
  ['one_of_two', 'threshold', 'One valid party under a threshold of two', { record: 'one_party' }, short(1, 2, 'MPA_THRESHOLD_NOT_MET')],
  ['required_role_missing', 'threshold', 'Two valid parties, none of them the owner', { record: 'no_owner' }, short(2, 2, 'MPA_REQUIRED_ROLE_MISSING')],
  ['one_party_not_the_owner', 'threshold', 'Both rules at once', { record: 'one_party_not_the_owner' }, short(1, 2, 'MPA_THRESHOLD_NOT_MET', 'MPA_REQUIRED_ROLE_MISSING')],
  ['record_asks_for_fewer_than_the_operator', 'threshold', 'required_parties 2 in the record, 3 in the policy', { record: 'recovery_two' }, short(2, 3, 'MPA_THRESHOLD_NOT_MET')],
];

// ── Configuration cases: a policy set (or a trust set) and the code its loader must give, or null when it loads ──
const MINI = {
  policy_set_version: '1',
  profile: PROFILE,
  audience: AUDIENCE,
  max_validity_seconds: 900,
  subjects: [
    {
      target: AGENT,
      parties: [{ party_id: ALICE.id, role: 'owner' }, { party_id: BOB.id, role: 'org_admin' }],
      operations: { revoke_agent: { required_parties: 2, allowed_roles: ['owner', 'org_admin'], required_roles: ['owner'] } },
    },
  ],
};
const policy = (change) => {
  const p = structuredClone(MINI);
  change(p);
  return p;
};
const op = (p) => p.subjects[0].operations.revoke_agent;
const CONFIG_CASES = [
  ['minimal', MINI, null],
  ['no_subjects', policy((p) => { p.subjects = []; }), null],
  ['unknown_field', policy((p) => { p.default_threshold = 2; }), 'CONFIG_UNKNOWN_FIELD'],
  ['unknown_field_in_a_party', policy((p) => { p.subjects[0].parties[0].keys = []; }), 'CONFIG_UNKNOWN_FIELD'],
  ['unknown_field_in_an_operation', policy((p) => { op(p).require_owner = true; }), 'CONFIG_UNKNOWN_FIELD'],
  ['another_profile', policy((p) => { p.profile = 'mpa-v2'; }), 'CONFIG_INVALID_VALUE'],
  ['version_missing', policy((p) => { delete p.policy_set_version; }), 'CONFIG_INVALID_VALUE'],
  ['empty_audience', policy((p) => { p.audience = ''; }), 'CONFIG_INVALID_VALUE'],
  ['validity_zero', policy((p) => { p.max_validity_seconds = 0; }), 'CONFIG_INVALID_VALUE'],
  ['validity_over_a_day', policy((p) => { p.max_validity_seconds = 86401; }), 'CONFIG_INVALID_VALUE'],
  ['unknown_role', policy((p) => { p.subjects[0].parties[1].role = 'admin'; }), 'CONFIG_INVALID_VALUE'],
  ['unknown_operation', policy((p) => { p.subjects[0].operations.delete_everything = op(p); }), 'CONFIG_INVALID_VALUE'],
  ['no_parties', policy((p) => { p.subjects[0].parties = []; }), 'CONFIG_INVALID_VALUE'],
  ['no_allowed_roles', policy((p) => { op(p).allowed_roles = []; op(p).required_roles = []; }), 'CONFIG_INVALID_VALUE'],
  ['allowed_role_repeated', policy((p) => { op(p).allowed_roles = ['owner', 'org_admin', 'owner']; }), 'CONFIG_INVALID_VALUE'],
  ['threshold_of_one', policy((p) => { op(p).required_parties = 1; }), 'CONFIG_INVALID_VALUE'],
  ['required_role_not_allowed', policy((p) => { op(p).required_roles = ['recovery_contact']; }), 'CONFIG_INVALID_VALUE'],
  ['target_twice', policy((p) => { p.subjects.push(structuredClone(p.subjects[0])); }), 'CONFIG_MPA_DUPLICATE'],
  ['party_twice', policy((p) => { p.subjects[0].parties.push({ party_id: ALICE.id, role: 'org_admin' }); }), 'CONFIG_MPA_DUPLICATE'],
  ['threshold_no_one_can_reach', policy((p) => { op(p).required_parties = 3; }), 'CONFIG_MPA_UNSATISFIABLE'],
  ['required_role_no_party_holds', policy((p) => { op(p).allowed_roles = ROLES; op(p).required_roles = ['recovery_contact']; }), 'CONFIG_MPA_UNSATISFIABLE'],
  // the policy set schema keyword by keyword: the same set with one change
  ['subject_with_no_operation', policy((p) => { p.subjects[0].operations = {}; }), null],
  ['not_an_object', [MINI], 'CONFIG_INVALID_VALUE'],
  ['version_not_a_string', policy((p) => { p.policy_set_version = 1; }), 'CONFIG_INVALID_VALUE'],
  ['audience_too_long', policy((p) => { p.audience = `verifier:${'a'.repeat(248)}`; }), 'CONFIG_INVALID_VALUE'],
  ['validity_not_an_integer', policy((p) => { p.max_validity_seconds = 900.5; }), 'CONFIG_INVALID_VALUE'],
  ['validity_a_string', policy((p) => { p.max_validity_seconds = '900'; }), 'CONFIG_INVALID_VALUE'],
  ['subjects_not_an_array', policy((p) => { p.subjects = {}; }), 'CONFIG_INVALID_VALUE'],
  ['subject_not_an_object', policy((p) => { p.subjects.push('agent:other-bot'); }), 'CONFIG_INVALID_VALUE'],
  ['unknown_field_in_a_subject', policy((p) => { p.subjects[0].required_parties = 2; }), 'CONFIG_UNKNOWN_FIELD'],
  ['subject_without_operations', policy((p) => { delete p.subjects[0].operations; }), 'CONFIG_INVALID_VALUE'],
  ['target_not_a_string', policy((p) => { p.subjects[0].target = 7; }), 'CONFIG_INVALID_VALUE'],
  ['target_too_long', policy((p) => { p.subjects[0].target = `agent:${'a'.repeat(251)}`; }), 'CONFIG_INVALID_VALUE'],
  ['parties_not_an_array', policy((p) => { p.subjects[0].parties = { ...p.subjects[0].parties }; }), 'CONFIG_INVALID_VALUE'],
  ['party_not_an_object', policy((p) => { p.subjects[0].parties.push(CAROL.id); }), 'CONFIG_INVALID_VALUE'],
  ['empty_party_id', policy((p) => { p.subjects[0].parties.push({ party_id: '', role: 'recovery_contact' }); }), 'CONFIG_INVALID_VALUE'],
  ['party_id_not_a_string', policy((p) => { p.subjects[0].parties.push({ party_id: 7, role: 'recovery_contact' }); }), 'CONFIG_INVALID_VALUE'],
  ['party_without_a_role', policy((p) => { p.subjects[0].parties.push({ party_id: CAROL.id }); }), 'CONFIG_INVALID_VALUE'],
  ['operations_not_an_object', policy((p) => { p.subjects[0].operations = ['revoke_agent']; }), 'CONFIG_INVALID_VALUE'],
  ['rule_not_an_object', policy((p) => { p.subjects[0].operations.revoke_agent = 2; }), 'CONFIG_INVALID_VALUE'],
  ['rule_without_required_roles', policy((p) => { delete op(p).required_roles; }), 'CONFIG_INVALID_VALUE'],
  ['threshold_not_an_integer', policy((p) => { op(p).required_parties = 2.5; }), 'CONFIG_INVALID_VALUE'],
  ['unknown_allowed_role', policy((p) => { op(p).allowed_roles = ['owner', 'org_admin', 'admin']; }), 'CONFIG_INVALID_VALUE'],
  ['required_roles_not_an_array', policy((p) => { op(p).required_roles = 'owner'; }), 'CONFIG_INVALID_VALUE'],
  ['required_role_repeated', policy((p) => { op(p).required_roles = ['owner', 'owner']; }), 'CONFIG_INVALID_VALUE'],
  // no member has a default, and no field takes a value of another type
  ['empty_version', policy((p) => { p.policy_set_version = ''; }), 'CONFIG_INVALID_VALUE'],
  ['profile_missing', policy((p) => { delete p.profile; }), 'CONFIG_INVALID_VALUE'],
  ['audience_missing', policy((p) => { delete p.audience; }), 'CONFIG_INVALID_VALUE'],
  ['audience_not_a_string', policy((p) => { p.audience = 7; }), 'CONFIG_INVALID_VALUE'],
  ['validity_missing', policy((p) => { delete p.max_validity_seconds; }), 'CONFIG_INVALID_VALUE'],
  ['subjects_missing', policy((p) => { delete p.subjects; }), 'CONFIG_INVALID_VALUE'],
  ['subject_without_a_target', policy((p) => { delete p.subjects[0].target; }), 'CONFIG_INVALID_VALUE'],
  ['empty_target', policy((p) => { p.subjects[0].target = ''; }), 'CONFIG_INVALID_VALUE'],
  ['subject_without_parties', policy((p) => { delete p.subjects[0].parties; }), 'CONFIG_INVALID_VALUE'],
  ['party_without_an_id', policy((p) => { p.subjects[0].parties.push({ role: 'recovery_contact' }); }), 'CONFIG_INVALID_VALUE'],
  ['role_not_a_string', policy((p) => { p.subjects[0].parties.push({ party_id: CAROL.id, role: ['recovery_contact'] }); }), 'CONFIG_INVALID_VALUE'],
  ['rule_without_a_threshold', policy((p) => { delete op(p).required_parties; }), 'CONFIG_INVALID_VALUE'],
  ['rule_without_allowed_roles', policy((p) => { delete op(p).allowed_roles; }), 'CONFIG_INVALID_VALUE'],
  ['allowed_roles_not_an_array', policy((p) => { op(p).allowed_roles = 'owner'; }), 'CONFIG_INVALID_VALUE'],
  ['unknown_required_role', policy((p) => { op(p).required_roles = ['admin']; }), 'CONFIG_INVALID_VALUE'],
].map(([name, policy_set, expect_code]) => ({ name, policy_set, expect_code }));

// A key under two parties would let one signer count twice. The existing trust set rule refuses it when it loads.
const TRUST_CONFIG_CASES = [
  { name: 'one_key_under_two_parties', trust_set: trustSet('dup', principal(ALICE), { human_id: 'human:alias', keys: [trustKey(ALICE.classical), trustKey(BOB.pq)] }), expect_code: 'CONFIG_TRUST_DUPLICATE' },
];

// ── Reference evaluator: the rules, written without any SDK code ──
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
for (const f of ['composite_signature', 'multi_party_authorization', 'multi_party_request', 'multi_party_policy_set']) {
  ajv.addSchema(JSON.parse(readFileSync(join(SCHEMAS, `${f}.schema.json`), 'utf8')));
}
const conforms = (name, value) => ajv.getSchema(`https://dcp-ai.org/schemas/v2/${name}.schema.json`)(value);
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;
/** An RFC 3339 instant on the calendar. Date.parse alone rolls 31 November over to December and takes 24:00. */
function isInstant(v) {
  const m = typeof v === 'string' ? RFC3339.exec(v) : null;
  if (!m) return false;
  const [year, month, day, hour, minute, second, offsetHours = 0, offsetMinutes = 0] = m.slice(1).map((n) => (n === undefined ? undefined : Number(n)));
  const daysInMonth = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return daysInMonth !== undefined && day >= 1 && day <= daysInMonth && hour <= 23 && minute <= 59 && second <= 59 && offsetHours <= 23 && offsetMinutes <= 59;
}
const canonicalBytes = (value) => {
  const bytes = Buffer.from(value, 'base64');
  return bytes.toString('base64') === value ? bytes : undefined;
};

/** The numbers of the profile, at every depth: integers a binary64 holds exactly, from -(2^53 - 1) to 2^53 - 1. */
const inProfile = (v) => (typeof v === 'number' ? Number.isSafeInteger(v) : v === null || typeof v !== 'object' || Object.values(v).every(inProfile));

function structureCode(rec) {
  if (!conforms('multi_party_authorization', rec)) return 'MPA_SCHEMA_INVALID';
  const p = rec.operation_payload;
  if (!Object.hasOwn(p, 'request')) return 'MPA_REQUEST_MISSING';
  if (!conforms('multi_party_request', p) || !isInstant(p.request.issued_at) || !isInstant(p.request.expires_at)) return 'MPA_REQUEST_INVALID';
  if (!inProfile(p)) return 'MPA_NOT_REPRESENTABLE';
  try {
    canon(p);
  } catch {
    return 'MPA_NOT_REPRESENTABLE';
  }
  return rec.authorizations.length > MAX_AUTHORIZATIONS ? 'MPA_TOO_MANY_AUTHORIZATIONS' : undefined;
}

/** The codes of one authorization in the verification phase: none when it is a hybrid signature by the party's trusted keys. */
function verificationCodes(rec, entry, trust, now) {
  const sig = entry.composite_sig;
  if (sig.binding !== 'pq_over_classical' || sig.pq === null || !CLASSICAL_ALGS.includes(sig.classical.alg) || !PQ_ALGS.includes(sig.pq.alg)) {
    return ['MPA_HYBRID_REQUIRED'];
  }
  const trusted = trust.principals.find((p) => p.human_id === entry.party_id)?.keys ?? [];
  const codes = [];
  const keys = [sig.classical, sig.pq].map((part) => {
    const k = trusted.find((t) => t.kid === part.kid && t.alg === part.alg);
    if (!k) codes.push('MPA_KEY_NOT_ANCHORED');
    else if (k.status === 'revoked') codes.push('MPA_KEY_REVOKED');
    else if (k.status === 'expired' || (k.expires_at != null && ms(k.expires_at) < now)) codes.push('MPA_KEY_EXPIRED');
    else if (k.not_before != null && ms(k.not_before) > now) codes.push('MPA_KEY_NOT_YET_VALID');
    return k;
  });
  if (codes.length) return codes;
  const [classicalSig, pqSig] = [canonicalBytes(sig.classical.sig_b64), canonicalBytes(sig.pq.sig_b64)];
  const msg = signedBytes(rec.operation, rec.operation_payload, entry.party_id, entry.role);
  const ok =
    classicalSig !== undefined && pqSig !== undefined &&
    ALGS[sig.classical.alg].verify(classicalSig, msg, Buffer.from(keys[0].public_key_b64, 'base64')) &&
    ALGS[sig.pq.alg].verify(pqSig, Buffer.concat([msg, classicalSig]), Buffer.from(keys[1].public_key_b64, 'base64'));
  return ok ? [] : ['MPA_SIGNATURE_INVALID'];
}

function evaluate(rec, policySet, trust, expected, now) {
  const codes = [];
  const result = (fields) => ({ authorized: false, structure: 'valid', verification: 'not_evaluated', parties_counted: null, required_parties: null, ...fields, codes: [...new Set(codes)].sort() });

  // 1. Structure: the first failure, nothing else
  const malformedAs = structureCode(rec);
  if (malformedAs) {
    codes.push(malformedAs);
    return result({ structure: 'invalid' });
  }

  // 2. Binding: this operation, on this target, with these parameters, for this verifier, now
  const { request: req, parameters } = rec.operation_payload;
  if (rec.operation !== expected.operation) codes.push('MPA_OPERATION_MISMATCH');
  if (req.target !== expected.target) codes.push('MPA_TARGET_MISMATCH');
  if (canon(parameters) !== canon(expected.parameters)) codes.push('MPA_PARAMETERS_MISMATCH');
  if (req.audience !== policySet.audience) codes.push('MPA_AUDIENCE_MISMATCH');
  const [issued, expires] = [ms(req.issued_at), ms(req.expires_at)];
  if (issued > now + SKEW_MS) codes.push('MPA_NOT_YET_VALID');
  if (expires <= now) codes.push('MPA_EXPIRED');
  if (expires <= issued || expires - issued > policySet.max_validity_seconds * 1000) codes.push('MPA_VALIDITY_INVALID');
  const subject = policySet.subjects.find((s) => s.target === req.target);
  const rule = subject && Object.hasOwn(subject.operations, rec.operation) ? subject.operations[rec.operation] : undefined;
  if (!subject) codes.push('MPA_TARGET_UNKNOWN');
  else if (!rule) codes.push('MPA_OPERATION_NOT_ALLOWED');
  const required_parties = rule ? rule.required_parties : null;
  if (codes.length) return result({ required_parties });

  // 3. Parties: distinct parties of the target, each with the role the operator gives it
  const roleOf = (id) => subject.parties.find((p) => p.party_id === id)?.role;
  const seen = new Set();
  for (const entry of rec.authorizations) {
    const role = roleOf(entry.party_id);
    if (role === undefined) {
      codes.push('MPA_PARTY_UNKNOWN');
      continue;
    }
    if (seen.has(entry.party_id)) codes.push('MPA_PARTY_DUPLICATE');
    seen.add(entry.party_id);
    if (entry.role !== role) codes.push('MPA_ROLE_MISMATCH');
    if (!rule.allowed_roles.includes(role)) codes.push('MPA_ROLE_NOT_ALLOWED');
  }
  if (codes.length) return result({ required_parties });

  // 4. Verification: every authorization is a hybrid signature by the party's trusted keys over this request
  let parties_counted = 0;
  for (const entry of rec.authorizations) {
    const entryCodes = verificationCodes(rec, entry, trust, now);
    codes.push(...entryCodes);
    if (!entryCodes.length) parties_counted += 1;
  }
  if (codes.length) return result({ verification: 'failed', parties_counted, required_parties });

  // 5. Decision
  if (parties_counted < rule.required_parties) codes.push('MPA_THRESHOLD_NOT_MET');
  const roles = new Set(rec.authorizations.map((entry) => roleOf(entry.party_id)));
  if (rule.required_roles.some((r) => !roles.has(r))) codes.push('MPA_REQUIRED_ROLE_MISSING');
  return result({ verification: 'verified', parties_counted, required_parties, authorized: codes.length === 0 });
}

/** The code a policy set is refused with, or null. Unknown fields first, then values, then the two rules a schema cannot state. */
function policyCode(p) {
  // What is not an object has no fields to be unknown: the schema refuses it below, as a value.
  const isObject = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
  const known = (o, allowed) => !isObject(o) || Object.keys(o).every((k) => allowed.includes(k));
  const objects = (v) => (Array.isArray(v) ? v : []).filter(isObject);
  const subjects = objects(p.subjects);
  const everyKnown =
    known(p, ['policy_set_version', 'profile', 'audience', 'max_validity_seconds', 'subjects']) &&
    subjects.every((s) =>
      known(s, ['target', 'parties', 'operations']) &&
      objects(s.parties).every((party) => known(party, ['party_id', 'role'])) &&
      Object.values(isObject(s.operations) ? s.operations : {}).every((rule) => known(rule, ['required_parties', 'allowed_roles', 'required_roles'])));
  if (!everyKnown) return 'CONFIG_UNKNOWN_FIELD';
  if (!conforms('multi_party_policy_set', p)) return 'CONFIG_INVALID_VALUE';
  for (const s of p.subjects) {
    for (const rule of Object.values(s.operations)) if (rule.required_roles.some((r) => !rule.allowed_roles.includes(r))) return 'CONFIG_INVALID_VALUE';
  }
  const repeated = (list) => new Set(list).size !== list.length;
  if (repeated(p.subjects.map((s) => s.target)) || p.subjects.some((s) => repeated(s.parties.map((party) => party.party_id)))) return 'CONFIG_MPA_DUPLICATE';
  for (const s of p.subjects) {
    for (const rule of Object.values(s.operations)) {
      const eligible = s.parties.filter((party) => rule.allowed_roles.includes(party.role));
      if (rule.required_parties > eligible.length || rule.required_roles.some((r) => !eligible.some((party) => party.role === r))) return 'CONFIG_MPA_UNSATISFIABLE';
    }
  }
  return null;
}

/** Whether every authorization of a record is a hybrid signature over its own signed bytes, by whoever holds the kids it names. */
function signaturesVerifyOnTheirOwn(rec) {
  return rec.authorizations.every((entry) => {
    const { classical, pq } = entry.composite_sig;
    const [ck, pk] = [EVERY_KEY.get(classical.kid), pq && EVERY_KEY.get(pq.kid)];
    if (!ck || !pk) return false;
    const msg = signedBytes(rec.operation, rec.operation_payload, entry.party_id, entry.role);
    const classicalSig = Buffer.from(classical.sig_b64, 'base64');
    return ALGS[ck.alg].verify(classicalSig, msg, ck.publicKey) && ALGS[pk.alg].verify(Buffer.from(pq.sig_b64, 'base64'), Buffer.concat([msg, classicalSig]), pk.publicKey);
  });
}

// ── Build, check, write ──
for (const [name, set] of Object.entries(POLICY_SETS)) if (policyCode(set) !== null) throw new Error(`policy set ${name} does not load: ${policyCode(set)}`);
const GROUPS = ['controls', 'limits', 'structure', 'binding', 'parties', 'signatures', 'threshold'];
const cases = CASES.map(([name, group, rule, given, expect]) => {
  const rec = RECORDS[given.record];
  if (!rec) throw new Error(`${name}: no record ${given.record}`);
  if (!GROUPS.includes(group)) throw new Error(`${name}: unknown group ${group}`);
  const now = given.now ?? NOW;
  const c = {
    name,
    group,
    rule,
    record: given.record,
    policy_set: 'base',
    trust_set: given.trust_set ?? 'base',
    now,
    now_ms: ms(now),
    expected: given.expected ?? (expect.structure === 'valid' ? expectedOf(rec) : BASE_EXPECTED),
    expect,
  };
  const got = evaluate(rec, POLICY_SETS[c.policy_set], TRUST_SETS[c.trust_set], c.expected, c.now_ms);
  if (!isDeepStrictEqual(got, expect)) throw new Error(`${name}: the reference evaluator gives ${JSON.stringify(got)}, the case expects ${JSON.stringify(expect)}`);
  if ((group === 'controls') !== expect.authorized) throw new Error(`${name}: only controls are authorized`);
  if (['controls', 'binding', 'parties', 'threshold'].includes(group) && !signaturesVerifyOnTheirOwn(rec)) throw new Error(`${name}: a ${group} case needs signatures that verify on their own`);
  if (group === 'signatures' && expect.verification !== 'failed') throw new Error(`${name}: a signatures case fails in the verification phase`);
  if (group === 'structure' && expect.structure !== 'invalid') throw new Error(`${name}: a structure case is refused by the structure phase`);
  if (group === 'limits' && expect.structure !== 'valid') throw new Error(`${name}: a limits case gets past the structure phase`);
  return c;
});
if (new Set(cases.map((c) => c.name)).size !== cases.length) throw new Error('duplicate case name');
const unused = Object.keys(RECORDS).filter((r) => !cases.some((c) => c.record === r));
if (unused.length) throw new Error(`records no case uses: ${unused.join(', ')}`);
for (const c of CONFIG_CASES) {
  const got = policyCode(c.policy_set);
  if (got !== c.expect_code) throw new Error(`config case ${c.name}: the reference loader gives ${got}, the case expects ${c.expect_code}`);
}
if (new Set(CONFIG_CASES.map((c) => c.name)).size !== CONFIG_CASES.length) throw new Error('duplicate config case name');
for (const c of TRUST_CONFIG_CASES) {
  const kids = c.trust_set.principals.flatMap((p) => p.keys.map((k) => k.kid));
  if (new Set(kids).size === kids.length) throw new Error(`trust config case ${c.name}: no kid is listed twice`);
}
const every = new Set([...cases.flatMap((c) => c.expect.codes), ...CONFIG_CASES.map((c) => c.expect_code).filter(Boolean)]);
const CODES = [
  'MPA_SCHEMA_INVALID', 'MPA_REQUEST_MISSING', 'MPA_REQUEST_INVALID', 'MPA_NOT_REPRESENTABLE', 'MPA_TOO_MANY_AUTHORIZATIONS',
  'MPA_OPERATION_MISMATCH', 'MPA_TARGET_MISMATCH', 'MPA_PARAMETERS_MISMATCH', 'MPA_AUDIENCE_MISMATCH', 'MPA_NOT_YET_VALID', 'MPA_EXPIRED',
  'MPA_VALIDITY_INVALID', 'MPA_TARGET_UNKNOWN', 'MPA_OPERATION_NOT_ALLOWED',
  'MPA_PARTY_UNKNOWN', 'MPA_PARTY_DUPLICATE', 'MPA_ROLE_MISMATCH', 'MPA_ROLE_NOT_ALLOWED',
  'MPA_HYBRID_REQUIRED', 'MPA_KEY_NOT_ANCHORED', 'MPA_KEY_REVOKED', 'MPA_KEY_EXPIRED', 'MPA_KEY_NOT_YET_VALID', 'MPA_SIGNATURE_INVALID',
  'MPA_THRESHOLD_NOT_MET', 'MPA_REQUIRED_ROLE_MISSING',
  'CONFIG_UNKNOWN_FIELD', 'CONFIG_INVALID_VALUE', 'CONFIG_MPA_DUPLICATE', 'CONFIG_MPA_UNSATISFIABLE',
];
const uncovered = CODES.filter((code) => !every.has(code));
if (uncovered.length) throw new Error(`codes no case expects: ${uncovered.join(', ')}`);
const stray = [...every].filter((code) => !CODES.includes(code));
if (stray.length) throw new Error(`codes outside the list: ${stray.join(', ')}`);

const out = {
  _description:
    'Cross-SDK vectors for the opt-in mpa-v1 profile of multi-party authorization (spec/profiles/multi-party). Every evaluator MUST return each ' +
    "case's expect for records[record], under policy_sets[policy_set] and trust_sets[trust_set], for the operation, target and parameters in expected, at now_ms. " +
    'expect.codes is the set of codes, sorted; no order among them is compared. Phases, each stopping the next when it adds a code: ' +
    '(1) structure, first failure only: the record conforms to multi_party_authorization.schema.json (MPA_SCHEMA_INVALID); operation_payload has a request member ' +
    '(MPA_REQUEST_MISSING) and conforms to multi_party_request.schema.json with RFC 3339 instants (MPA_REQUEST_INVALID); every number in it, read as the nearest binary64, is an integer from ' +
    '-(2^53 - 1) to 2^53 - 1, the integers a binary64 holds exactly, so it is representable in dcp-jcs-v1 and every implementation writes the same text for it ' +
    '(MPA_NOT_REPRESENTABLE); at most 16 authorizations (MPA_TOO_MANY_AUTHORIZATIONS). ' +
    '(2) binding, every code: operation, request.target and the canonical form of parameters equal the expected ones (MPA_OPERATION_MISMATCH, MPA_TARGET_MISMATCH, ' +
    'MPA_PARAMETERS_MISMATCH); request.audience equals the policy set audience (MPA_AUDIENCE_MISMATCH); issued_at is not later than now plus 30 seconds ' +
    '(MPA_NOT_YET_VALID); expires_at is later than now (MPA_EXPIRED); expires_at is later than issued_at by at most max_validity_seconds (MPA_VALIDITY_INVALID); ' +
    'the policy set has a subject for request.target (MPA_TARGET_UNKNOWN) that lists the operation (MPA_OPERATION_NOT_ALLOWED). ' +
    '(3) parties, every code: each party_id is a party of the subject (MPA_PARTY_UNKNOWN, and nothing else for that entry), appears once (MPA_PARTY_DUPLICATE), ' +
    'signed the role the operator gives it (MPA_ROLE_MISMATCH), and that role is allowed for the operation (MPA_ROLE_NOT_ALLOWED). ' +
    '(4) verification, every code: binding pq_over_classical with a classical algorithm in the classical slot and a post-quantum one in the other ' +
    '(MPA_HYBRID_REQUIRED); each kid is a key of that party in the trust set with that algorithm (MPA_KEY_NOT_ANCHORED), not revoked (MPA_KEY_REVOKED), not expired ' +
    '(MPA_KEY_EXPIRED: status expired, or expires_at before now) and already valid (MPA_KEY_NOT_YET_VALID: not_before after now), the first of these per key; ' +
    'both signatures are canonical base64 and verify, the classical one over UTF8(context) || 0x00 || dcp-jcs-v1({operation, operation_payload, party_id, role}) ' +
    'and the post-quantum one over those bytes followed by the classical signature (MPA_SIGNATURE_INVALID). parties_counted is the number of authorizations with no ' +
    'code in this phase. (5) decision: parties_counted is at least the required_parties of the policy (MPA_THRESHOLD_NOT_MET) and every required role is held by a ' +
    'counted party (MPA_REQUIRED_ROLE_MISSING). authorized is true only when no phase added a code. The required_parties of the record never counts. ' +
    'verification is not_evaluated when phase 4 was not reached; required_parties is null when no operation rule was found. ' +
    'config_cases: loading policy_set MUST fail with expect_code, or succeed when it is null; a set with several problems is not among the cases. ' +
    'trust_config_cases: loading trust_set with the principal trust set loader MUST fail with expect_code. ' +
    'Bounds (request_id 128, target and audience 256) count Unicode code points. ' +
    'Groups: controls are authorized; structure, binding, parties, signatures and threshold are refused by that phase; in binding, parties and threshold every ' +
    'signature verifies on its own; limits sit exactly on a bound, get past the structure phase and are refused by a later one. ' +
    'The evaluation is strict: an authorization that fails refuses the record even when the others meet the threshold.',
  _security_notice: 'The keys are derived from fixed strings in the generator. Test material only.',
  _generator: 'tests/interop/v2/generate-multi-party-vectors.mjs',
  profile: PROFILE,
  context: CONTEXT,
  clock_skew_seconds: SKEW_MS / 1000,
  max_authorizations: MAX_AUTHORIZATIONS,
  trust_sets: TRUST_SETS,
  policy_sets: POLICY_SETS,
  records: RECORDS,
  cases,
  config_cases: CONFIG_CASES,
  trust_config_cases: TRUST_CONFIG_CASES,
};
const written = `${JSON.stringify(out, null, 2)}\n`;
let text = written;
for (const { member, value, text: digits } of LITERALS) {
  const [from, to] = [`"${member}": ${value}`, `"${member}": ${digits}`];
  if (!text.includes(from) || text.includes(to)) throw new Error(`${member}: the literal ${digits} has no place of its own in the file`);
  text = text.split(from).join(to);
}
if (text.split(ODD.digits).length !== 2 || text.includes(String(ODD.placeholder))) throw new Error('the digits of 2^53 + 1 were not written once');
const summary = `${cases.length} cases, ${CONFIG_CASES.length} policy configuration cases, ${TRUST_CONFIG_CASES.length} trust configuration case`;
if (process.argv.includes('--check')) {
  const same = readFileSync(OUT, 'utf8') === text;
  console.log(same ? `multi_party_vectors.json matches (${summary})` : 'multi_party_vectors.json differs from the generator');
  process.exit(same ? 0 : 1);
}
writeFileSync(OUT, text);
console.log(`wrote ${OUT}: ${summary}`);
