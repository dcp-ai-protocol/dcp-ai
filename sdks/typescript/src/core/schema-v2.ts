/**
 * spec/VERIFICATION.md V2-2: the signed bundle against signed_bundle.schema.json and each SignedPayload.payload against
 * its artifact schema (bound by bundle member name), from the IR that tools/schema-ir/generate.mjs compiles out of
 * schemas/v2 (schema-v2.generated.ts; no schema file or network access at verification time). Internal: the package
 * exports no schema-only API; verifySignedBundleV2WithProfile runs this before any other check.
 *
 * Semantics, as the phase-1 reference evaluator (tools/schema-ir/evaluate.mjs) defines them:
 * - integer is a finite number with no fraction (2 and 2.0 alike); a boolean is never a number;
 * - an object is read through its own enumerable string keys; a key whose value is undefined is absent, as the
 *   dcp-jcs-v1 canonicalizer omits it; no prototype is required; members of an open object that no schema names are
 *   not visited: under a commitment (intent target, audit evidence) such a value reaches canonicalization, the later
 *   layer, while an unknown member of the unsigned bundle (bundle.x) may be read by no later check at all;
 * - an undefined array element is null (the canonicalizer writes null); a hole of a sparse array is a type error;
 * - lengths in code points as JavaScript iterates a string; enum and const by exact string equality; uniqueItems
 *   over strings with a set; patterns through the IR's deterministic programs (full-string match, as these anchored
 *   sources say); date-time as ajv-formats 3.0.1 asserts it (below);
 * - oneOf: exactly one branch valid, reported once at the instance;
 * - at most 16 errors and then a truncation marker; the verdict never depends on the cap; diagnostics name the
 *   instance pointer (RFC 6901, each token escaped and then cut to 64 code points) and the keyword, never a value.
 * Nothing is written to the input.
 */
import { sha256Hex } from './dual-hash.js';
import { SCHEMA_V2_IR, SCHEMA_V2_IR_SHA256 } from './schema-v2.generated.js';

type Program = { source: string; alternatives: { ranges: [number, number][]; min: number; max: number | null }[][] };
type IrNode = {
  site: string;
  types?: string[];
  properties?: [string, number][];
  required?: string[];
  closed?: boolean;
  items?: number;
  oneOf?: number[];
  enum?: string[];
  const?: string;
  pattern?: number;
  format?: string;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  uniqueItems?: boolean;
  minimum?: number;
  maximum?: number;
  ref?: number;
};
type Ir = {
  format: string;
  patterns: Program[];
  nodes: IrNode[];
  roots: { signed_bundle: number; payloads: [string, number][] };
  overlays: Record<string, { node: number; keyword: string; value: string }[]>;
};

export const SCHEMA_ERRORS_CAP = 16;
const TOKEN_CAP = 64;

export interface SchemaError {
  instance: string;
  keyword: string;
  site: string;
  member?: string;
}
export interface SchemaResult {
  valid: boolean;
  errors: SchemaError[];
  truncated: boolean;
}

let loaded: { ir: Ir; props: Map<number, Map<string, number>> } | undefined;

function load(): { ir: Ir; props: Map<number, Map<string, number>> } {
  if (loaded) return loaded;
  if (sha256Hex(SCHEMA_V2_IR) !== SCHEMA_V2_IR_SHA256) throw new Error('the V2 schema IR does not match its sha256');
  const ir = JSON.parse(SCHEMA_V2_IR) as Ir;
  if (ir.format !== 'dcp-ai.v2-schema-ir/1') throw new Error(`unsupported V2 schema IR ${String(ir.format)}`);
  const props = new Map<number, Map<string, number>>();
  ir.nodes.forEach((n, id) => { if (n.properties) props.set(id, new Map(n.properties)); });
  loaded = { ir, props };
  return loaded;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const enumerable = Object.prototype.propertyIsEnumerable;
const present = (o: Record<string, unknown>, k: string): boolean => enumerable.call(o, k) && o[k] !== undefined;

/** An RFC 6901 token, escaped first and then cut to 64 code points with a marker. */
export function boundedToken(t: string): string {
  const cps = Array.from(t.replace(/~/g, '~0').replace(/\//g, '~1'));
  return cps.length > TOKEN_CAP ? `${cps.slice(0, TOKEN_CAP).join('')}…[cut]` : cps.join('');
}

function typeOk(t: string, v: unknown): boolean {
  switch (t) {
    case 'null': return v === null;
    case 'boolean': return typeof v === 'boolean';
    case 'string': return typeof v === 'string';
    case 'integer': return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v);
    case 'array': return Array.isArray(v);
    case 'object': return isObject(v);
    default: return false;
  }
}

/** Full-string match of a compiled program over the code points of s (a lone surrogate is its own code point). */
export function matchProgram(program: Program, s: string): boolean {
  const cps = Array.from(s, (ch) => ch.codePointAt(0) as number);
  const inRanges = (ranges: [number, number][], c: number) => ranges.some(([lo, hi]) => c >= lo && c <= hi);
  return program.alternatives.some((items) => {
    let i = 0;
    for (const it of items) {
      let n = 0;
      while ((it.max === null || n < it.max) && i < cps.length && inRanges(it.ranges, cps[i])) {
        i += 1;
        n += 1;
      }
      if (n < it.min) return false;
    }
    return i === cps.length;
  });
}

// ── date-time: ajv-formats 3.0.1 fullFormats["date-time"] (getDateTime(true)), the format lib/verify.js asserts ──
// A compatibility boundary, quirks included, not a reading of RFC 3339; the V2-4, V2-13 and V2-14 temporal parsers
// are a later, different layer. Ported from ajv-formats (https://github.com/ajv-validator/ajv-formats); the notice is a
// legal comment (/*! */) so the bundler keeps it in dist/index.js and dist/index.cjs.
/*! @license ajv-formats date-time (adapted in @dcp-ai/sdk src/core/schema-v2.ts)
 *
 * MIT License
 *
 * Copyright (c) 2020 Evgeny Poberezkin
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// DATE_TIME_SEPARATOR = /t|\s/i: "t", "T" and ECMAScript white space and line terminators.
const SEPARATORS = new Set([
  0x74, 0x54, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
]);
const DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const isDigit = (s: string, i: number) => s.charCodeAt(i) >= 0x30 && s.charCodeAt(i) <= 0x39;
const digits = (s: string, i: number, n: number) => { for (let k = 0; k < n; k++) if (!isDigit(s, i + k)) return false; return true; };
const leap = (y: number) => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);

function isDate(s: string): boolean {
  if (s.length !== 10 || !digits(s, 0, 4) || s[4] !== '-' || !digits(s, 5, 2) || s[7] !== '-' || !digits(s, 8, 2)) return false;
  const year = Number(s.slice(0, 4));
  const month = Number(s.slice(5, 7));
  const day = Number(s.slice(8, 10));
  return month >= 1 && month <= 12 && day >= 1 && day <= (month === 2 && leap(year) ? 29 : DAYS[month]);
}

function isTime(s: string): boolean {
  if (!digits(s, 0, 2) || s[2] !== ':' || !digits(s, 3, 2) || s[5] !== ':' || !digits(s, 6, 2)) return false;
  let i = 8;
  if (s[i] === '.') {
    let j = i + 1;
    while (isDigit(s, j)) j += 1;
    if (j === i + 1) return false;
    i = j;
  }
  const secText = s.slice(6, i);
  let tz = false;
  let sign = 1;
  let tzH = 0;
  let tzM = 0;
  if (s[i] === 'z' || s[i] === 'Z') {
    tz = true;
    i += 1;
  } else if (s[i] === '+' || s[i] === '-') {
    if (!digits(s, i + 1, 2)) return false;
    tz = true;
    sign = s[i] === '-' ? -1 : 1;
    tzH = Number(s.slice(i + 1, i + 3));
    i += 3;
    if (s[i] === ':' && digits(s, i + 1, 2)) {
      tzM = Number(s.slice(i + 1, i + 3));
      i += 3;
    } else if (digits(s, i, 2)) {
      tzM = Number(s.slice(i, i + 2));
      i += 2;
    }
  }
  if (i !== s.length) return false;
  const hr = Number(s.slice(0, 2));
  const min = Number(s.slice(3, 5));
  const sec = Number(secText);
  if (tzH > 23 || tzM > 59 || !tz) return false;
  if (hr <= 23 && min <= 59 && sec < 60) return true;
  const utcMin = min - tzM * sign;
  const utcHr = hr - tzH * sign - (utcMin < 0 ? 1 : 0);
  return (utcHr === 23 || utcHr === -1) && (utcMin === 59 || utcMin === -1) && sec < 61;
}

/** True when the string is a date-time as ajv-formats 3.0.1 (full mode) accepts it. */
export function isSchemaDateTime(s: string): boolean {
  let at = -1;
  for (let i = 0; i < s.length; i++) {
    if (!SEPARATORS.has(s.charCodeAt(i))) continue;
    if (at >= 0) return false;
    at = i;
  }
  return at >= 0 && isDate(s.slice(0, at)) && isTime(s.slice(at + 1));
}

const STOP = Symbol('stop');
type Sink = (ptr: string, keyword: string, node: IrNode, member?: string) => void;

/**
 * V2-2 for `doc` under the accepted canonicalization profile: 'dcp-jcs-v1' is the normative schema; 'dcp-jcs-v2'
 * (only the explicitly selected experimental route) replaces exactly one const, canonicalization_profile.
 */
export function validateSignedBundleV2Schema(doc: unknown, acceptedProfile: 'dcp-jcs-v1' | 'dcp-jcs-v2'): SchemaResult {
  const { ir, props } = load();
  const replaced = new Map<string, string>();
  if (acceptedProfile === 'dcp-jcs-v2') {
    const overlay = ir.overlays['dcp-jcs-v2'];
    if (!overlay || overlay.length !== 1) throw new Error('the V2 schema IR has no dcp-jcs-v2 overlay');
    for (const e of overlay) replaced.set(`${e.node}/${e.keyword}`, e.value);
  }
  const constOf = (id: number) => (replaced.has(`${id}/const`) ? replaced.get(`${id}/const`) : ir.nodes[id].const);
  const errors: SchemaError[] = [];
  let truncated = false;
  let invalid = false;

  const evalNode = (id: number, v: unknown, ptr: string, sink: Sink): void => {
    const n = ir.nodes[id];
    if (n.ref !== undefined) evalNode(n.ref, v, ptr, sink);
    if (n.types && !n.types.some((t) => typeOk(t, v))) sink(ptr, 'type', n);
    if (n.enum && !(typeof v === 'string' && n.enum.includes(v))) sink(ptr, 'enum', n);
    if (n.const !== undefined && v !== constOf(id)) sink(ptr, 'const', n);
    if (typeof v === 'string') {
      if (n.minLength !== undefined || n.maxLength !== undefined) {
        let len = 0;
        for (const _ of v) len += 1;
        if (n.minLength !== undefined && len < n.minLength) sink(ptr, 'minLength', n);
        if (n.maxLength !== undefined && len > n.maxLength) sink(ptr, 'maxLength', n);
      }
      if (n.pattern !== undefined && !matchProgram(ir.patterns[n.pattern], v)) sink(ptr, 'pattern', n);
      if (n.format === 'date-time' && !isSchemaDateTime(v)) sink(ptr, 'format', n);
    }
    if (Array.isArray(v)) {
      if (n.minItems !== undefined && v.length < n.minItems) sink(ptr, 'minItems', n);
      if (n.uniqueItems && v.every((x) => typeof x === 'string') && new Set(v).size !== v.length) sink(ptr, 'uniqueItems', n);
      if (n.items !== undefined) {
        for (let i = 0; i < v.length; i++) {
          if (!(i in v)) sink(`${ptr}/${i}`, 'type', ir.nodes[n.items]);
          else evalNode(n.items, v[i] === undefined ? null : v[i], `${ptr}/${i}`, sink);
        }
      }
    }
    if (isObject(v)) {
      if (n.required) for (const r of n.required) if (!present(v, r)) sink(ptr, 'required', n, r);
      const named = props.get(id);
      if (n.closed) for (const k of Object.keys(v)) if (v[k] !== undefined && !(named && named.has(k))) sink(ptr, 'additionalProperties', n, k);
      if (named) for (const [k, child] of named) if (present(v, k)) evalNode(child, v[k], `${ptr}/${boundedToken(k)}`, sink);
    }
    if (typeof v === 'number' && Number.isFinite(v)) {
      if (n.minimum !== undefined && v < n.minimum) sink(ptr, 'minimum', n);
      if (n.maximum !== undefined && v > n.maximum) sink(ptr, 'maximum', n);
    }
    if (n.oneOf) {
      let valid = 0;
      for (const b of n.oneOf) {
        let failed = false;
        evalNode(b, v, ptr, () => { failed = true; });
        if (!failed) valid += 1;
      }
      if (valid !== 1) sink(ptr, 'oneOf', n);
    }
  };

  const top: Sink = (ptr, keyword, node, member) => {
    invalid = true;
    if (errors.length >= SCHEMA_ERRORS_CAP) {
      truncated = true;
      throw STOP;
    }
    errors.push({ instance: ptr, keyword, site: `${node.site}/${keyword}`, ...(member !== undefined ? { member: boundedToken(member) } : {}) });
  };
  try {
    evalNode(ir.roots.signed_bundle, doc, '', top);
    const bundle = isObject(doc) && present(doc, 'bundle') && isObject(doc.bundle) ? doc.bundle : null;
    for (const [member, root] of ir.roots.payloads) {
      const env = bundle && present(bundle, member) && isObject(bundle[member]) ? (bundle[member] as Record<string, unknown>) : null;
      if (env && present(env, 'payload') && isObject(env.payload)) evalNode(root, env.payload, `/bundle/${member}/payload`, top);
    }
  } catch (e) {
    if (e !== STOP) throw e;
  }
  return { valid: !invalid, errors, truncated };
}

/** The verifier's errors for a schema failure: one line per error, then the truncation marker. No input value. */
export function schemaDiagnostics(result: SchemaResult): string[] {
  const lines = result.errors.map((e) => `schema: ${e.instance || '/'} ${e.keyword}${e.member !== undefined ? ` ${e.member}` : ''}`);
  if (result.truncated) lines.push('schema: further errors not listed');
  return lines;
}
