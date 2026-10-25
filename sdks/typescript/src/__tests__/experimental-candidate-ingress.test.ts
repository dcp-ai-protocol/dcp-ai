/**
 * Experimental candidate ingress (phase 1): the public corpus cases that test one unit from its
 * bytes, and focused examples. Bundle cases (selection, policy, configuration, migration, historical
 * parsers) and transport envelopes, the obsolete depth rule among them, belong to later phases: they
 * are counted here, not run.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  canonicalizeV2,
  experimentalCandidateIngress,
  ExperimentalCandidateInternalError,
} from '../index.js';

const DIR = new URL('../../../../docs/proposals/canonicalization-candidate/', import.meta.url);
const BASELINE = JSON.parse(readFileSync(new URL('baseline-corpus.json', DIR), 'utf8'));
const DESIGN = JSON.parse(readFileSync(new URL('corpus.json', DIR), 'utf8'));

type Case = {
  id: string;
  input_json?: string;
  input_hex?: string;
  input_sha256: string;
  [k: string]: any;
};
const inputOf = (c: Case) =>
  new Uint8Array(
    c.input_hex !== undefined
      ? Buffer.from(c.input_hex, 'hex')
      : Buffer.from(c.input_json!, 'utf8'),
  );
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const ingest = (text: string | Uint8Array) =>
  experimentalCandidateIngress(typeof text === 'string' ? new TextEncoder().encode(text) : text);
const text = (b: Uint8Array) =>
  new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(b);
const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === 'string' ? [...new TextEncoder().encode(p)] : p)),
  );

const BASELINE_CASES: Case[] = BASELINE.cases;
const DOCUMENT: Case[] = DESIGN.cases.filter(
  (c: Case) => c.mode === 'document' && c.transport === 'bare' && !c.options,
);

describe('experimental candidate ingress: public corpus', () => {
  it('runs the 87 baseline units and the 81 bare document cases, and only excludes later phases', () => {
    expect(BASELINE_CASES).toHaveLength(87);
    expect(DOCUMENT).toHaveLength(81);
    const excluded = DESIGN.cases.filter((c: Case) => !DOCUMENT.includes(c));
    expect(excluded.filter((c: Case) => c.mode === 'bundle')).toHaveLength(77);
    expect(
      excluded.filter((c: Case) => c.mode === 'document' && c.transport === 'envelope'),
    ).toHaveLength(29);
    expect(excluded).toHaveLength(106);
    for (const c of [...BASELINE_CASES, ...DOCUMENT])
      expect(sha(inputOf(c)), c.id).toBe(c.input_sha256);
  });

  it.each(BASELINE_CASES.map((c: Case) => [c.id, c] as [string, Case]))('baseline %s', (_id, c) => {
    const r = experimentalCandidateIngress(inputOf(c));
    if (c.expected === 'accept') {
      expect(r.status).toBe('accept');
      if (r.status !== 'accept') return;
      expect(text(r.canonical)).toBe(c.canonical);
      expect(r.canonicalSha256).toBe(c.canonical_sha256);
      expect(canonicalizeV2(r.value)).toBe(text(r.canonical));
    } else {
      expect(r).toMatchObject({ status: 'reject', class: c.reject_class });
    }
  });

  it.each(DOCUMENT.map((c: Case) => [c.id, c] as [string, Case]))('design %s', (_id, c) => {
    const r = experimentalCandidateIngress(inputOf(c));
    if (c.expected.result === 'accept') {
      expect(r.status).toBe('accept');
      if (r.status !== 'accept') return;
      expect(r.canonicalSha256).toBe(c.expected.canonical_sha256);
      expect(sha(r.canonical)).toBe(r.canonicalSha256);
      expect(canonicalizeV2(r.value)).toBe(text(r.canonical));
    } else {
      expect(r).toEqual({ status: 'reject', class: c.expected.class, offset: c.expected.offset });
    }
  });
});

describe('experimental candidate ingress: focused examples', () => {
  it('rejects ill-formed UTF-8 at the first byte of the ill-formed subsequence', () => {
    for (const bad of [
      [0xc0, 0x80],
      [0xe0, 0x80, 0x80],
      [0xed, 0xa0, 0x80],
      [0xf4, 0x90, 0x80, 0x80],
      [0xf5],
      [0x80],
      [0xe2, 0x82],
    ]) {
      expect(ingest(bytes('{"s":"', bad, '"}')), bad.join()).toEqual({
        status: 'reject',
        class: 'UTF8_INVALID',
        offset: 6,
      });
    }
    // The encoding layer wins over an earlier grammar error.
    expect(ingest(bytes('[,"', [0xff], '"]'))).toEqual({
      status: 'reject',
      class: 'UTF8_INVALID',
      offset: 3,
    });
  });

  it('rejects a leading BOM and keeps U+FEFF inside a string', () => {
    expect(ingest(bytes([0xef, 0xbb, 0xbf], '{"a":1}'))).toEqual({
      status: 'reject',
      class: 'BOM',
      offset: 0,
    });
    expect(ingest(bytes([0xef, 0xbb, 0xbf], '["', [0xff], '"]'))).toEqual({
      status: 'reject',
      class: 'BOM',
      offset: 0,
    });
    const r = ingest(bytes('["', [0xef, 0xbb, 0xbf], 'x"]'));
    expect(r.status === 'accept' && [...r.canonical]).toEqual([
      ...bytes('["', [0xef, 0xbb, 0xbf], 'x"]'),
    ]);
  });

  it('compares keys after unescaping, without normalization', () => {
    expect(ingest('{"a":1,"\\u0061":2}')).toEqual({
      status: 'reject',
      class: 'DUPLICATE_KEY',
      offset: 7,
    });
    expect(ingest('{"\\u00e9":1,"é":2}')).toEqual({
      status: 'reject',
      class: 'DUPLICATE_KEY',
      offset: 12,
    });
    expect(ingest('{"\\ud83d\\ude00":1,"😀":2}')).toEqual({
      status: 'reject',
      class: 'DUPLICATE_KEY',
      offset: 18,
    });
    expect(ingest('{"é":1,"e\\u0301":2}').status).toBe('accept');
    // The earliest value-level defect wins: the lone surrogate of the first key, not the duplicate.
    expect(ingest('{"\\ud800":1,"\\ud800":2}')).toEqual({
      status: 'reject',
      class: 'SURROGATE_UNPAIRED',
      offset: 2,
    });
  });

  it('keeps __proto__ as data', () => {
    const r = ingest('{"__proto__":{"x":1},"y":[]}');
    expect(r.status).toBe('accept');
    if (r.status !== 'accept') return;
    const value = r.value as Record<string, unknown>;
    expect(Object.getPrototypeOf(value)).toBeNull();
    expect(Object.keys(value)).toEqual(['__proto__', 'y']);
    expect(text(r.canonical)).toBe('{"__proto__":{"x":1},"y":[]}');
    expect(canonicalizeV2(r.value)).toBe(text(r.canonical));
    expect(ingest('{"__proto__":1,"__proto__":2}')).toEqual({
      status: 'reject',
      class: 'DUPLICATE_KEY',
      offset: 15,
    });
  });

  it('decides numbers on the exact literal, with saturated exponents', () => {
    const accepted = (s: string) => {
      const r = ingest(s);
      return r.status === 'accept' ? text(r.canonical) : r;
    };
    expect(
      accepted('[9007199254740991,-9007199254740991,-0,-0.0e-0,0e99999999999999999999999]'),
    ).toBe('[9007199254740991,-9007199254740991,0,0,0]');
    expect(accepted('[100000000000000000000e-5,1.5e1,100e-2,1E+2]')).toBe(
      '[1000000000000000,15,1,100]',
    );
    expect(accepted('[1' + '0'.repeat(100000) + 'e-100000]')).toBe('[1]');
    expect(accepted('[0.' + '0'.repeat(50000) + '1e50001]')).toBe('[1]');
    expect(ingest('[9007199254740992]')).toEqual({
      status: 'reject',
      class: 'NUMBER_OUT_OF_RANGE',
      offset: 1,
    });
    expect(ingest('[1e21]')).toEqual({ status: 'reject', class: 'NUMBER_OUT_OF_RANGE', offset: 1 });
    expect(ingest('[1e99999999999999999999999]')).toEqual({
      status: 'reject',
      class: 'NUMBER_OUT_OF_RANGE',
      offset: 1,
    });
    expect(ingest('[1e-99999999999999999999999]')).toEqual({
      status: 'reject',
      class: 'NUMBER_NOT_INTEGER',
      offset: 1,
    });
    expect(ingest('[1.0000000000000001]')).toEqual({
      status: 'reject',
      class: 'NUMBER_NOT_INTEGER',
      offset: 1,
    });
    expect(ingest('[4503599627370497.5e40]')).toEqual({
      status: 'reject',
      class: 'NUMBER_OUT_OF_RANGE',
      offset: 1,
    });
    expect(ingest('[0.5e-400000000000]')).toEqual({
      status: 'reject',
      class: 'NUMBER_NOT_INTEGER',
      offset: 1,
    });
  });

  it('pairs surrogate escapes and outputs scalars as UTF-8', () => {
    const r = ingest('["\\ud83d\\ude00"]');
    expect(r.status === 'accept' && [...r.canonical]).toEqual([
      ...bytes('["', [0xf0, 0x9f, 0x98, 0x80], '"]'),
    ]);
    for (const s of [
      '["\\ud83d"]',
      '["\\ude00"]',
      '["\\ud83d\\u0041"]',
      '["\\ud83d\\ud83d\\ude00"]',
      '["\\ud83dx"]',
    ]) {
      expect(ingest(s), s).toEqual({ status: 'reject', class: 'SURROGATE_UNPAIRED', offset: 2 });
    }
    expect(ingest('["\\ud83d\\uZZZZ"]')).toEqual({ status: 'reject', class: 'SYNTAX', offset: 10 });
  });

  it('applies the dcp-jcs-v1 escapes and leaves the rest literal', () => {
    const r = ingest('["\\u0000\\u001f\\b\\t\\n\\f\\r\\"\\\\\\/\\u007f\\u2028"]');
    expect(r.status === 'accept' && text(r.canonical)).toBe(
      '["\\u0000\\u001f\\b\\t\\n\\f\\r\\"\\\\/\u007f "]',
    );
  });

  it('counts depth from the unit root and keeps checking the grammar past level 64, iteratively', () => {
    expect(ingest('['.repeat(64) + ']'.repeat(64)).status).toBe('accept');
    expect(ingest('['.repeat(65) + ']'.repeat(65))).toEqual({
      status: 'reject',
      class: 'DEPTH_EXCEEDED',
      offset: 64,
    });
    expect(ingest('['.repeat(65) + '1.5' + ']'.repeat(65))).toEqual({
      status: 'reject',
      class: 'DEPTH_EXCEEDED',
      offset: 64,
    });
    expect(ingest('['.repeat(20000) + ']'.repeat(20000))).toEqual({
      status: 'reject',
      class: 'DEPTH_EXCEEDED',
      offset: 64,
    });
    expect(ingest('['.repeat(20000) + ']'.repeat(19999))).toEqual({
      status: 'reject',
      class: 'SYNTAX',
      offset: 39999,
    });
    expect(ingest('['.repeat(20000) + ']'.repeat(19999) + '}')).toEqual({
      status: 'reject',
      class: 'SYNTAX',
      offset: 39999,
    });
    // Grammar wins over an earlier value-level defect.
    expect(ingest('{"a":1,"a":2,}')).toEqual({ status: 'reject', class: 'SYNTAX', offset: 13 });
  });

  it('separates a wrong argument from a rejection of the data', () => {
    expect(() => experimentalCandidateIngress('{}' as unknown as Uint8Array)).toThrow(TypeError);
    expect(() => experimentalCandidateIngress([0x7b, 0x7d] as unknown as Uint8Array)).toThrow(
      TypeError,
    );
    expect(new ExperimentalCandidateInternalError('x')).toBeInstanceOf(Error);
  });
});
