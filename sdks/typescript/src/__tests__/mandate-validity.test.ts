/**
 * The mandate validity helper (DCP-09 §3.5.2 rule 4, §3.6): the shared vectors every SDK must agree on
 * (tests/interop/v2/mandate_validity_vectors.json), the injected and default clocks, and wrong types that must give a
 * result, never an exception.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { revokeDelegation, verifyMandateValidity } from '../core/delegation.js';
import { parseRfc3339 } from '../core/session-nonce.js';
import type { DelegationMandate } from '../types/v2.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VECTORS_PATH = resolve(__dirname, '../../../../tests/interop/v2/mandate_validity_vectors.json');

let V: any;
beforeAll(() => {
  V = JSON.parse(readFileSync(VECTORS_PATH, 'utf-8'));
});

const ID = 'mandate-validity-0001';
const NOW = Date.parse('2026-06-15T12:00:00.000Z');
const mandate = (fields: Record<string, unknown> = {}) =>
  ({ mandate_id: ID, valid_from: '2026-06-01T00:00:00Z', valid_until: '2026-07-01T00:00:00Z', ...fields }) as unknown as DelegationMandate;
const call = verifyMandateValidity as (...a: unknown[]) => { valid: boolean; reason?: string };
const check = (m: unknown, revoked: unknown = new Set<string>(), now?: unknown) => call(m, revoked, ...(now === undefined ? [] : [now]));

describe('mandate validity vectors (mandate_validity_vectors.json)', () => {
  it('decides every case as the vectors expect', () => {
    expect(V.cases.length).toBe(94);
    const wrong = V.cases
      .map((c: any) => ({ c, got: check(c.mandate, new Set(c.revoked_mandate_ids), parseRfc3339(c.now ?? V.verification_time)) }))
      .filter(({ c, got }: any) => JSON.stringify(got) !== JSON.stringify(c.expect))
      .map(({ c, got }: any) => `${c.name}: got ${JSON.stringify(got)}, want ${JSON.stringify(c.expect)}`);
    expect(wrong).toEqual([]);
  });

  it('the vectors cover every reason and every group', () => {
    const reasons = new Set(V.cases.filter((c: any) => !c.expect.valid).map((c: any) => c.expect.reason));
    expect([...reasons].sort()).toEqual(Object.values(V.reasons).sort());
    expect(new Set(V.cases.map((c: any) => c.group))).toEqual(new Set(['controls', 'offsets', 'limits', 'inverted', 'format', 'types', 'hostile']));
  });
});

describe('verifyMandateValidity clock', () => {
  it('without now it uses the current time, as before', () => {
    const iso = (ms: number) => new Date(ms).toISOString();
    expect(check(mandate({ valid_from: iso(Date.now() - 3_600_000), valid_until: iso(Date.now() + 3_600_000) }))).toEqual({ valid: true });
    expect(check(mandate({ valid_from: iso(Date.now() - 7_200_000), valid_until: iso(Date.now() - 3_600_000) }))).toEqual({ valid: false, reason: 'Mandate has expired' });
    expect(check(mandate({ valid_from: iso(Date.now() + 3_600_000), valid_until: iso(Date.now() + 7_200_000) }))).toEqual({ valid: false, reason: 'Mandate is not yet valid' });
  });

  it('takes now as a Date or as milliseconds, with the same result', () => {
    for (const at of ['2026-05-31T23:59:59.999Z', '2026-06-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.001Z']) {
      expect(check(mandate(), new Set(), new Date(at))).toEqual(check(mandate(), new Set(), Date.parse(at)));
    }
  });

  it('truncates now to milliseconds, as the window limits are', () => {
    const end = Date.parse('2026-07-01T00:00:00.000Z');
    expect(check(mandate(), new Set(), end + 0.999)).toEqual({ valid: true });
    expect(check(mandate(), new Set(), end + 1)).toEqual({ valid: false, reason: 'Mandate has expired' });
  });

  it('refuses a verification time that is not an instant', () => {
    for (const now of [NaN, Infinity, -Infinity, new Date('not a date'), '2026-06-15T12:00:00Z', null, {}, true, 1n]) {
      expect(check(mandate(), new Set(), now)).toEqual({ valid: false, reason: 'Verification time is not an instant' });
    }
  });
});

describe('verifyMandateValidity inputs', () => {
  it('refuses a revoked set that is not a Set, and takes a Set subclass', () => {
    for (const revoked of [[ID], ID, null, undefined, {}, { has: () => true }, new Map([[ID, true]])]) {
      expect(call(mandate(), revoked, NOW)).toEqual({ valid: false, reason: 'Revoked mandate IDs are not a set' });
    }
    class IdSet extends Set<string> {}
    expect(check(mandate(), new IdSet([ID]), NOW)).toEqual({ valid: false, reason: 'Mandate has been revoked' });
  });

  it('reads own members only: an inherited mandate_id or window is absent', () => {
    const inherited = Object.create({ mandate_id: ID, valid_from: '2026-06-01T00:00:00Z', valid_until: '2026-07-01T00:00:00Z' });
    expect(check(inherited, new Set(), NOW)).toEqual({ valid: false, reason: 'Mandate mandate_id is missing or invalid' });
    const windowInherited = Object.assign(Object.create({ valid_from: '2026-06-01T00:00:00Z', valid_until: '2026-07-01T00:00:00Z' }), { mandate_id: ID });
    expect(check(windowInherited, new Set(), NOW)).toEqual({ valid: false, reason: 'Mandate valid_from is missing or invalid' });
  });

  it('gives a result, never an exception, for JSON values and common wrong types', () => {
    // Every value but a non-empty string is a wrong mandate_id, and none is a mandate or an RFC 3339 instant.
    const values: unknown[] = [undefined, null, 0, -1, NaN, '', true, [], {}, [ID], new Date(), Symbol('s'), () => ID, 10n, new Map(), new Set()];
    for (const v of values) {
      for (const m of [v, mandate({ mandate_id: v }), mandate({ valid_from: v }), mandate({ valid_until: v })]) {
        expect(() => check(m, new Set(), NOW)).not.toThrow();
        expect(check(m, new Set(), NOW).valid).toBe(false);
      }
    }
  });

  it('keeps the existing reasons and leaves revokeDelegation unchanged', () => {
    const revoked = new Set<string>();
    expect(revokeDelegation({ ...mandate(), revocable: true } as DelegationMandate, revoked)).toEqual({ revoked: true });
    expect(check(mandate(), revoked, NOW)).toEqual({ valid: false, reason: 'Mandate has been revoked' });
  });
});
