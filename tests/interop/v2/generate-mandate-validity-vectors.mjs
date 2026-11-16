#!/usr/bin/env node
/**
 * Writes tests/interop/v2/mandate_validity_vectors.json: the cases every SDK's mandate validity helper
 * (verifyMandateValidity, verify_mandate_validity, VerifyMandateValidityAt, verify_mandate_validity_at) must
 * decide alike. The helper checks only
 * the mandate_id, local revocation and the validity window at a verification time; it verifies no signature, so the
 * mandates are unsigned JSON and only the fields it reads matter.
 *
 * Each case states its expectation by hand. Before writing, the generator checks every one against a reference
 * evaluator below, written from the contract alone (RFC 3339 as interop_vectors.json#rfc3339: YYYY-MM-DDTHH:MM:SS,
 * an optional fraction of at least one digit truncated to milliseconds, then Z or ±hh:mm; uppercase T and Z, ASCII
 * digits, years 0000 to 9999, a real calendar date, hour 23, minute 59, second 59, offset hour 23 and minute 59 at
 * most), so a typo in an expectation fails here, not in four SDKs. Deterministic: no clock, no randomness.
 *
 *   node tests/interop/v2/generate-mandate-validity-vectors.mjs           write the file
 *   node tests/interop/v2/generate-mandate-validity-vectors.mjs --check   compare with the committed file, exit 1 if it differs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'mandate_validity_vectors.json');
const NOW = '2026-06-15T12:00:00.000Z';
const ID = 'mandate-validity-0001';
const BASE = { mandate_id: ID, valid_from: '2026-06-01T00:00:00Z', valid_until: '2026-07-01T00:00:00Z' };

const R = {
  object: 'Mandate is not an object',
  id: 'Mandate mandate_id is missing or invalid',
  revoked: 'Mandate has been revoked',
  from: 'Mandate valid_from is missing or invalid',
  until: 'Mandate valid_until is missing or invalid',
  inverted: 'Mandate valid_from is after valid_until',
  notYet: 'Mandate is not yet valid',
  expired: 'Mandate has expired',
};
const ok = { valid: true };
const no = (reason) => ({ valid: false, reason });
const without = (key) => Object.fromEntries(Object.entries(BASE).filter(([k]) => k !== key));

// [name, group, mandate, expect, extra (revoked_mandate_ids, now)]
const CASES = [
  // Controls.
  ['current', 'controls', BASE, ok],
  ['expired', 'controls', { ...BASE, valid_until: '2026-06-10T00:00:00Z' }, no(R.expired)],
  ['not_yet_valid', 'controls', { ...BASE, valid_from: '2026-06-20T00:00:00Z' }, no(R.notYet)],
  ['revoked', 'controls', BASE, no(R.revoked), { revoked_mandate_ids: [ID] }],
  ['revoked_and_expired', 'controls', { ...BASE, valid_until: '2026-06-10T00:00:00Z' }, no(R.revoked), { revoked_mandate_ids: [ID] }],
  ['revoked_with_an_invalid_window', 'controls', { ...BASE, valid_until: 'not-a-date' }, no(R.revoked), { revoked_mandate_ids: [ID] }],
  ['other_ids_revoked', 'controls', BASE, ok, { revoked_mandate_ids: ['mandate-validity-0002', 'MANDATE-VALIDITY-0001', `${ID} `] }],
  ['now_at_valid_until', 'controls', BASE, ok, { now: '2026-07-01T00:00:00.000Z' }],
  ['now_one_ms_after_valid_until', 'controls', BASE, no(R.expired), { now: '2026-07-01T00:00:00.001Z' }],
  ['now_at_valid_from', 'controls', BASE, ok, { now: '2026-06-01T00:00:00.000Z' }],
  ['now_one_ms_before_valid_from', 'controls', BASE, no(R.notYet), { now: '2026-05-31T23:59:59.999Z' }],
  ['now_with_an_offset', 'controls', BASE, no(R.expired), { now: '2026-07-01T02:00:00.001+02:00' }],

  // Equivalent offsets: instants, never text.
  ['until_offset_equal_to_now', 'offsets', { ...BASE, valid_until: '2026-06-15T14:00:00+02:00' }, ok],
  ['until_offset_one_ms_before_now', 'offsets', { ...BASE, valid_until: '2026-06-15T13:59:59.999+02:00' }, no(R.expired)],
  ['from_negative_offset_equal_to_now', 'offsets', { ...BASE, valid_from: '2026-06-15T06:30:00-05:30' }, ok],
  ['from_negative_offset_one_ms_after_now', 'offsets', { ...BASE, valid_from: '2026-06-15T06:30:00.001-05:30' }, no(R.notYet)],
  ['until_later_than_text_suggests', 'offsets', { ...BASE, valid_until: '2026-06-15T11:00:00-02:00' }, ok],
  ['from_earlier_than_text_suggests', 'offsets', { ...BASE, valid_from: '2026-06-15T13:00:00+02:00' }, ok],
  ['until_minus_zero_offset_equal_to_now', 'offsets', { ...BASE, valid_until: '2026-06-15T12:00:00-00:00' }, ok],
  ['until_plus_zero_offset_equal_to_now', 'offsets', { ...BASE, valid_until: '2026-06-15T12:00:00+00:00' }, ok],
  ['until_largest_offset_equal_to_now', 'offsets', { ...BASE, valid_until: '2026-06-16T11:59:00+23:59' }, ok],
  ['until_smallest_offset_one_minute_before_now', 'offsets', { ...BASE, valid_until: '2026-06-14T12:00:00-23:59' }, no(R.expired)],

  // Exact limits and subseconds (milliseconds; digits beyond are dropped, never rounded).
  ['from_equal_to_now', 'limits', { ...BASE, valid_from: '2026-06-15T12:00:00Z' }, ok],
  ['until_equal_to_now', 'limits', { ...BASE, valid_until: '2026-06-15T12:00:00Z' }, ok],
  ['from_one_ms_after_now', 'limits', { ...BASE, valid_from: '2026-06-15T12:00:00.001Z' }, no(R.notYet)],
  ['until_one_ms_before_now', 'limits', { ...BASE, valid_until: '2026-06-15T11:59:59.999Z' }, no(R.expired)],
  ['until_submillisecond_truncated_before_now', 'limits', { ...BASE, valid_until: '2026-06-15T11:59:59.9999999Z' }, no(R.expired)],
  ['from_submillisecond_truncated_to_now', 'limits', { ...BASE, valid_from: '2026-06-15T12:00:00.0009Z' }, ok],
  ['equal_limits_at_now', 'limits', { ...BASE, valid_from: '2026-06-15T12:00:00Z', valid_until: '2026-06-15T12:00:00.000Z' }, ok],
  ['equal_limits_before_now', 'limits', { ...BASE, valid_from: '2026-06-15T11:59:59.999Z', valid_until: '2026-06-15T11:59:59.999Z' }, no(R.expired)],
  ['long_fraction', 'limits', { ...BASE, valid_until: `2026-06-15T12:00:00.${'0'.repeat(300)}Z` }, ok],
  ['year_0000_from', 'limits', { ...BASE, valid_from: '0000-01-01T00:00:00Z' }, ok],
  ['year_9999_until', 'limits', { ...BASE, valid_until: '9999-12-31T23:59:59.999Z' }, ok],
  ['leap_day', 'limits', { ...BASE, valid_until: '2028-02-29T00:00:00Z' }, ok],

  // Inverted windows.
  ['inverted', 'inverted', { ...BASE, valid_from: '2026-06-20T00:00:00Z', valid_until: '2026-06-10T00:00:00Z' }, no(R.inverted)],
  ['inverted_by_one_ms', 'inverted', { ...BASE, valid_from: '2026-06-15T12:00:00.001Z', valid_until: '2026-06-15T12:00:00.000Z' }, no(R.inverted)],
  ['inverted_by_offsets', 'inverted', { ...BASE, valid_from: '2026-06-15T13:00:00+00:00', valid_until: '2026-06-15T14:00:00+02:00' }, no(R.inverted)],

  // Invalid calendar or format in valid_until (and some in valid_from).
  ...[
    ['not_a_date', 'not-a-date'],
    ['empty', ''],
    ['date_only', '2026-07-01'],
    ['no_offset', '2026-07-01T00:00:00'],
    ['space_separator', '2026-07-01 00:00:00Z'],
    ['lowercase_t', '2026-07-01t00:00:00Z'],
    ['lowercase_z', '2026-07-01T00:00:00z'],
    ['offset_without_colon', '2026-07-01T00:00:00+0200'],
    ['offset_hours_only', '2026-07-01T00:00:00+02'],
    ['offset_hour_24', '2026-07-01T00:00:00+24:00'],
    ['offset_minute_60', '2026-07-01T00:00:00+05:60'],
    ['no_seconds', '2026-07-01T00:00Z'],
    ['month_13', '2026-13-01T00:00:00Z'],
    ['day_00', '2026-07-00T00:00:00Z'],
    ['february_30', '2026-02-30T00:00:00Z'],
    ['february_29_common_year', '2027-02-29T00:00:00Z'],
    ['april_31', '2026-04-31T00:00:00Z'],
    ['hour_24', '2026-07-01T24:00:00Z'],
    ['minute_60', '2026-07-01T00:60:00Z'],
    ['leap_second', '2026-06-30T23:59:60Z'],
    ['empty_fraction', '2026-07-01T00:00:00.Z'],
    ['comma_fraction', '2026-07-01T00:00:00,5Z'],
    ['five_digit_year', '20260-07-01T00:00:00Z'],
    ['signed_year', '+2026-07-01T00:00:00Z'],
    ['leading_space', ' 2026-07-01T00:00:00Z'],
    ['trailing_newline', '2026-07-01T00:00:00Z\n'],
    ['nul_inside', '2026-07-01T00:00:00Z\u0000'],
    ['fullwidth_digits', '２０２６-07-01T00:00:00Z'],
    ['double_z', '2026-07-01T00:00:00ZZ'],
  ].map(([name, value]) => [`until_${name}`, 'format', { ...BASE, valid_until: value }, no(R.until)]),
  ['from_not_a_date', 'format', { ...BASE, valid_from: 'not-a-date' }, no(R.from)],
  ['from_no_offset', 'format', { ...BASE, valid_from: '2026-06-01T00:00:00' }, no(R.from)],
  ['from_february_30', 'format', { ...BASE, valid_from: '2026-02-30T00:00:00Z' }, no(R.from)],
  ['from_and_until_invalid', 'format', { ...BASE, valid_from: 'x', valid_until: 'y' }, no(R.from)],

  // Missing fields, null and other types.
  ['from_missing', 'types', without('valid_from'), no(R.from)],
  ['until_missing', 'types', without('valid_until'), no(R.until)],
  ['from_null', 'types', { ...BASE, valid_from: null }, no(R.from)],
  ['until_null', 'types', { ...BASE, valid_until: null }, no(R.until)],
  ['until_epoch_ms_number', 'types', { ...BASE, valid_until: 1782864000000 }, no(R.until)],
  ['until_boolean', 'types', { ...BASE, valid_until: true }, no(R.until)],
  ['until_object', 'types', { ...BASE, valid_until: {} }, no(R.until)],
  ['until_array', 'types', { ...BASE, valid_until: ['2026-07-01T00:00:00Z'] }, no(R.until)],
  ['id_missing', 'types', without('mandate_id'), no(R.id)],
  ['id_null', 'types', { ...BASE, mandate_id: null }, no(R.id)],
  ['id_empty', 'types', { ...BASE, mandate_id: '' }, no(R.id)],
  ['id_number', 'types', { ...BASE, mandate_id: 1 }, no(R.id)],
  ['id_array', 'types', { ...BASE, mandate_id: [ID] }, no(R.id)],
  ['id_object', 'types', { ...BASE, mandate_id: {} }, no(R.id)],
  ['id_missing_and_empty_id_revoked', 'types', without('mandate_id'), no(R.id), { revoked_mandate_ids: [''] }],
  ['all_fields_missing', 'types', {}, no(R.id)],

  // Hostile input.
  ['mandate_null', 'hostile', null, no(R.object)],
  ['mandate_array', 'hostile', [BASE], no(R.object)],
  ['mandate_string', 'hostile', 'mandate', no(R.object)],
  ['mandate_number', 'hostile', 1, no(R.object)],
  ['mandate_boolean', 'hostile', true, no(R.object)],
  ['proto_member_not_an_id', 'hostile', JSON.parse(`{"__proto__":{"mandate_id":"${ID}"},"valid_from":"${BASE.valid_from}","valid_until":"${BASE.valid_until}"}`), no(R.id)],
  ['proto_named_id_revoked', 'hostile', { ...BASE, mandate_id: '__proto__' }, no(R.revoked), { revoked_mandate_ids: ['__proto__'] }],
  ['constructor_named_id_not_revoked', 'hostile', { ...BASE, mandate_id: 'constructor' }, ok],
];

// ── Reference evaluator: the contract alone ──

const RFC3339 = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]+))?(?:Z|([+-])([0-9]{2}):([0-9]{2}))$/;
const daysFromCivil = (y, m, d) => {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 719468;
};
function instant(v) {
  const m = typeof v === 'string' ? RFC3339.exec(v) : null;
  if (!m) return undefined;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number);
  const [oh, om] = [Number(m[9] ?? 0), Number(m[10] ?? 0)];
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const last = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  if (mo < 1 || mo > 12 || d < 1 || d > last || h > 23 || mi > 59 || s > 59 || oh > 23 || om > 59) return undefined;
  const ms = Number((m[7] ?? '').slice(0, 3).padEnd(3, '0'));
  const offset = (m[8] === '-' ? -1 : 1) * (oh * 60 + om);
  return ((daysFromCivil(y, mo, d) * 24 + h) * 60 + mi - offset) * 60000 + s * 1000 + ms;
}
function reference(mandate, revoked, now) {
  if (mandate === null || typeof mandate !== 'object' || Array.isArray(mandate)) return no(R.object);
  const own = (k) => (Object.hasOwn(mandate, k) ? mandate[k] : undefined);
  const id = own('mandate_id');
  if (typeof id !== 'string' || id === '') return no(R.id);
  if (revoked.includes(id)) return no(R.revoked);
  const from = instant(own('valid_from'));
  if (from === undefined) return no(R.from);
  const until = instant(own('valid_until'));
  if (until === undefined) return no(R.until);
  if (from > until) return no(R.inverted);
  if (from > now) return no(R.notYet);
  if (until < now) return no(R.expired);
  return ok;
}

const names = new Set();
const cases = CASES.map(([name, group, mandate, expect, extra = {}]) => {
  if (names.has(name)) throw new Error(`duplicate case ${name}`);
  names.add(name);
  const revoked = extra.revoked_mandate_ids ?? [];
  const now = instant(extra.now ?? NOW);
  if (now === undefined) throw new Error(`${name}: now is not an instant`);
  const got = reference(mandate, revoked, now);
  if (JSON.stringify(got) !== JSON.stringify(expect)) throw new Error(`${name}: expected ${JSON.stringify(expect)}, the reference gives ${JSON.stringify(got)}`);
  return { name, group, mandate, revoked_mandate_ids: revoked, ...(extra.now ? { now: extra.now } : {}), expect };
});

const out = {
  _description:
    'Cross-SDK mandate validity vectors (DCP-09 §3.5.2 rule 4 and §3.6): the helper that checks a mandate_id, local revocation and the validity window. ' +
    'Every helper MUST return each case\'s expect ({valid} or {valid: false, reason}, the first failing rule) for its mandate, its revoked_mandate_ids and its now ' +
    '(verification_time when absent). The rules, in order: the mandate is a JSON object; mandate_id is a non-empty string; it is not revoked (exact string match); ' +
    'valid_from and valid_until are RFC 3339 instants as in interop_vectors.json#rfc3339, compared in milliseconds, never as text; valid_from is not after valid_until; ' +
    'the verification time lies within the window, both limits included. The helper verifies no signature, schema, scope, chain or trust and authorizes nothing; ' +
    'the mandates are unsigned. An API that cannot take a value (a typed map cannot hold a JSON array) MUST skip the case explicitly, never pass it.',
  _generator: 'tests/interop/v2/generate-mandate-validity-vectors.mjs',
  verification_time: NOW,
  reasons: R,
  cases,
};
const text = `${JSON.stringify(out, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const same = readFileSync(OUT, 'utf8') === text;
  console.log(same ? `mandate_validity_vectors.json matches (${cases.length} cases)` : 'mandate_validity_vectors.json differs from the generator');
  process.exit(same ? 0 : 1);
}
writeFileSync(OUT, text);
console.log(`wrote ${OUT}: ${cases.length} cases`);
