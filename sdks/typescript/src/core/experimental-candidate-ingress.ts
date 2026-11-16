/**
 * EXPERIMENTAL and opt-in: the ingress of one unit under the inactive candidate profile
 * `dcp-jcs-v2` (docs/proposals/canonicalization-candidate, §3–§6). It is not normative and nothing
 * calls it: `dcp-jcs-v1` (`canonicalizeV2`) is unchanged and remains the only profile.
 *
 * Phase 1 only. From the original bytes of one unit it decides acceptance (UTF-8, BOM, the whole
 * RFC 8259 grammar, scalar strings, unique keys, exact integers by N4, at most 64 levels) with the
 * precedence and byte offsets of §6, and on acceptance materializes the exact value and produces its
 * canonical bytes and SHA-256. It reads no transport envelope, selects no profile, and verifies,
 * signs or admits nothing.
 *
 * A rejection of the data is a result (`status: 'reject'`). A wrong argument type is a TypeError and
 * a broken invariant an ExperimentalCandidateInternalError: neither is ever reported as a rejection.
 */
import { createHash } from 'crypto';

export type ExperimentalCandidateRejectClass =
  | 'BOM'
  | 'UTF8_INVALID'
  | 'SYNTAX'
  | 'SURROGATE_UNPAIRED'
  | 'DUPLICATE_KEY'
  | 'NUMBER_NOT_INTEGER'
  | 'NUMBER_OUT_OF_RANGE'
  | 'DEPTH_EXCEEDED';

/** Objects have a null prototype, so a key such as `__proto__` is an own data property. */
export type ExperimentalCandidateValue =
  | null
  | boolean
  | number
  | string
  | ExperimentalCandidateValue[]
  | { [key: string]: ExperimentalCandidateValue };

export type ExperimentalCandidateIngressResult =
  | {
      status: 'accept';
      value: ExperimentalCandidateValue;
      canonical: Uint8Array;
      canonicalSha256: string;
    }
  | { status: 'reject'; class: ExperimentalCandidateRejectClass; offset: number };

export class ExperimentalCandidateInternalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExperimentalCandidateInternalError';
  }
}

const MAX_DEPTH = 64;
const MAX_INTEGER_DIGITS = '9007199254740991'; // 2^53-1, 16 digits

class GrammarStop {
  constructor(readonly offset: number) {}
}

type Frame = {
  object: boolean;
  container: ExperimentalCandidateValue[] | Record<string, ExperimentalCandidateValue> | null;
  keys: Set<string> | null; // only within 64 levels: deeper defects cannot be the earliest
  key: string;
};

/** Offset of the first byte of the first ill-formed UTF-8 subsequence, or -1. */
function firstInvalidUtf8(b: Uint8Array): number {
  const n = b.length;
  let i = 0;
  while (i < n) {
    const c = b[i];
    if (c < 0x80) {
      i++;
      continue;
    }
    // Unicode Table 3-7: the allowed range of the second byte depends on the first.
    let need = 0;
    let lo = 0x80;
    let hi = 0xbf;
    if (c >= 0xc2 && c <= 0xdf) need = 1;
    else if ((c >= 0xe1 && c <= 0xec) || c === 0xee || c === 0xef) need = 2;
    else if (c >= 0xf1 && c <= 0xf3) need = 3;
    else if (c === 0xe0) [need, lo] = [2, 0xa0];
    else if (c === 0xed) [need, hi] = [2, 0x9f];
    else if (c === 0xf0) [need, lo] = [3, 0x90];
    else if (c === 0xf4) [need, hi] = [3, 0x8f];
    else return i;
    for (let k = 1; k <= need; k++) {
      if (i + k >= n) return i;
      const d = b[i + k];
      if (k === 1 ? d < lo || d > hi : d < 0x80 || d > 0xbf) return i;
    }
    i += need + 1;
  }
  return -1;
}

const isDigit = (c: number) => c >= 0x30 && c <= 0x39;
const hexValue = (c: number) =>
  c >= 0x30 && c <= 0x39
    ? c - 0x30
    : c >= 0x41 && c <= 0x46
      ? c - 0x37
      : c >= 0x61 && c <= 0x66
        ? c - 0x57
        : -1;

class Scanner {
  private pos = 0;
  private best: { cls: ExperimentalCandidateRejectClass; offset: number } | null = null;
  private readonly decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

  constructor(private readonly b: Uint8Array) {}

  /** Value-level defects: the earliest offset is the primary one (§6.1, layer 3). */
  private defect(cls: ExperimentalCandidateRejectClass, offset: number): void {
    if (this.best === null || offset < this.best.offset) this.best = { cls, offset };
  }

  private stop(offset: number): never {
    throw new GrammarStop(offset);
  }

  private skipWs(): void {
    const b = this.b;
    while (this.pos < b.length) {
      const c = b[this.pos];
      if (c !== 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return;
      this.pos++;
    }
  }

  run(): ExperimentalCandidateIngressResult {
    const b = this.b;
    if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return reject('BOM', 0);
    const invalid = firstInvalidUtf8(b);
    if (invalid >= 0) return reject('UTF8_INVALID', invalid);
    let value: ExperimentalCandidateValue;
    try {
      value = this.document();
    } catch (e) {
      if (e instanceof GrammarStop) return reject('SYNTAX', e.offset);
      throw e;
    }
    if (this.best !== null) return reject(this.best.cls, this.best.offset);
    const text = serialize(value);
    const canonical = new TextEncoder().encode(text);
    return {
      status: 'accept',
      value,
      canonical,
      canonicalSha256: createHash('sha256').update(canonical).digest('hex'),
    };
  }

  /** One JSON text, iteratively: the grammar is checked to the end at any depth. */
  private document(): ExperimentalCandidateValue {
    const b = this.b;
    const n = b.length;
    const stack: Frame[] = [];
    let state: 'value' | 'key' | 'after' = 'value';
    let current: ExperimentalCandidateValue = null;
    this.skipWs();
    for (;;) {
      if (state === 'value') {
        if (this.pos >= n) this.stop(n);
        const c = b[this.pos];
        if (c === 0x7b || c === 0x5b) {
          const object = c === 0x7b;
          const depth = stack.length + 1;
          if (depth > MAX_DEPTH) this.defect('DEPTH_EXCEEDED', this.pos);
          const building = this.best === null;
          stack.push({
            object,
            container: building ? (object ? Object.create(null) : []) : null,
            keys: object && depth <= MAX_DEPTH ? new Set() : null,
            key: '',
          });
          this.pos++;
          this.skipWs();
          if (this.pos < n && b[this.pos] === (object ? 0x7d : 0x5d)) {
            this.pos++;
            current = stack.pop()!.container;
            state = 'after';
          } else {
            state = object ? 'key' : 'value';
          }
        } else if (c === 0x22) {
          current = this.string();
          state = 'after';
        } else if (c === 0x2d || isDigit(c)) {
          current = this.number();
          state = 'after';
        } else if (c === 0x74) {
          this.literal('true');
          current = true;
          state = 'after';
        } else if (c === 0x66) {
          this.literal('false');
          current = false;
          state = 'after';
        } else if (c === 0x6e) {
          this.literal('null');
          current = null;
          state = 'after';
        } else {
          this.stop(this.pos);
        }
      } else if (state === 'key') {
        if (this.pos >= n) this.stop(n);
        if (b[this.pos] !== 0x22) this.stop(this.pos);
        const start = this.pos;
        const key = this.string();
        const frame = stack[stack.length - 1];
        if (frame.keys !== null) {
          if (frame.keys.has(key)) this.defect('DUPLICATE_KEY', start);
          else frame.keys.add(key);
        }
        frame.key = key;
        this.skipWs();
        if (this.pos >= n) this.stop(n);
        if (b[this.pos] !== 0x3a) this.stop(this.pos);
        this.pos++;
        this.skipWs();
        state = 'value';
      } else {
        if (stack.length === 0) {
          this.skipWs();
          if (this.pos !== n) this.stop(this.pos);
          return current;
        }
        const frame = stack[stack.length - 1];
        if (this.best === null && frame.container !== null) {
          if (frame.object) {
            Object.defineProperty(frame.container, frame.key, {
              value: current,
              enumerable: true,
              writable: true,
              configurable: true,
            });
          } else {
            (frame.container as ExperimentalCandidateValue[]).push(current);
          }
        }
        this.skipWs();
        if (this.pos >= n) this.stop(n);
        const c = b[this.pos];
        if (c === 0x2c) {
          this.pos++;
          this.skipWs();
          state = frame.object ? 'key' : 'value';
        } else if (c === (frame.object ? 0x7d : 0x5d)) {
          this.pos++;
          current = stack.pop()!.container;
        } else {
          this.stop(this.pos);
        }
      }
    }
  }

  private literal(word: string): void {
    const b = this.b;
    for (let k = 0; k < word.length; k++) {
      if (this.pos + k >= b.length) this.stop(b.length);
      if (b[this.pos + k] !== word.charCodeAt(k)) this.stop(this.pos + k);
    }
    this.pos += word.length;
  }

  /** Four hex digits at `at`, or a grammar stop at the first byte that is not one. */
  private hex4(at: number): number {
    const b = this.b;
    let v = 0;
    for (let k = 0; k < 4; k++) {
      if (at + k >= b.length) this.stop(b.length);
      const h = hexValue(b[at + k]);
      if (h < 0) this.stop(at + k);
      v = v * 16 + h;
    }
    return v;
  }

  /** A low surrogate escape `\uDC00`–`\uDFFF` at `at`, read without consuming it, or -1. */
  private lowSurrogateAt(at: number): number {
    const b = this.b;
    if (at + 6 > b.length || b[at] !== 0x5c || b[at + 1] !== 0x75) return -1;
    let v = 0;
    for (let k = 2; k < 6; k++) {
      const h = hexValue(b[at + k]);
      if (h < 0) return -1;
      v = v * 16 + h;
    }
    return v >= 0xdc00 && v <= 0xdfff ? v : -1;
  }

  /** A string at the opening quote; keys and values alike, unescaped. */
  private string(): string {
    const b = this.b;
    const n = b.length;
    this.pos++;
    let out = '';
    let segment = this.pos;
    for (;;) {
      if (this.pos >= n) this.stop(n);
      const c = b[this.pos];
      if (c === 0x22) {
        out += this.decoder.decode(b.subarray(segment, this.pos));
        this.pos++;
        return out;
      }
      if (c < 0x20) this.stop(this.pos);
      if (c !== 0x5c) {
        this.pos++;
        continue;
      }
      out += this.decoder.decode(b.subarray(segment, this.pos));
      const escape = this.pos;
      if (escape + 1 >= n) this.stop(n);
      const e = b[escape + 1];
      const simple =
        e === 0x22
          ? '"'
          : e === 0x5c
            ? '\\'
            : e === 0x2f
              ? '/'
              : e === 0x62
                ? '\b'
                : e === 0x66
                  ? '\f'
                  : e === 0x6e
                    ? '\n'
                    : e === 0x72
                      ? '\r'
                      : e === 0x74
                        ? '\t'
                        : null;
      if (simple !== null) {
        out += simple;
        this.pos = escape + 2;
      } else if (e === 0x75) {
        const unit = this.hex4(escape + 2);
        this.pos = escape + 6;
        if (unit >= 0xd800 && unit <= 0xdbff) {
          const low = this.lowSurrogateAt(this.pos);
          if (low >= 0) {
            out += String.fromCharCode(unit, low);
            this.pos += 6;
          } else {
            this.defect('SURROGATE_UNPAIRED', escape);
            out += String.fromCharCode(unit);
          }
        } else {
          if (unit >= 0xdc00 && unit <= 0xdfff) this.defect('SURROGATE_UNPAIRED', escape);
          out += String.fromCharCode(unit);
        }
      } else {
        this.stop(escape + 1);
      }
      segment = this.pos;
    }
  }

  /** A number literal: its grammar, then its exact value by N4 (§3.3). */
  private number(): number {
    const b = this.b;
    const n = b.length;
    const start = this.pos;
    const negative = b[this.pos] === 0x2d;
    if (negative) this.pos++;
    if (this.pos >= n) this.stop(n);
    const intStart = this.pos;
    if (b[this.pos] === 0x30) this.pos++;
    else if (isDigit(b[this.pos])) while (this.pos < n && isDigit(b[this.pos])) this.pos++;
    else this.stop(this.pos);
    const intEnd = this.pos;
    let fracStart = intEnd;
    let fracEnd = intEnd;
    if (this.pos < n && b[this.pos] === 0x2e) {
      this.pos++;
      if (this.pos >= n) this.stop(n);
      if (!isDigit(b[this.pos])) this.stop(this.pos);
      fracStart = this.pos;
      while (this.pos < n && isDigit(b[this.pos])) this.pos++;
      fracEnd = this.pos;
    }
    let expNegative = false;
    let expStart = -1;
    let expEnd = -1;
    if (this.pos < n && (b[this.pos] === 0x65 || b[this.pos] === 0x45)) {
      this.pos++;
      if (this.pos >= n) this.stop(n);
      if (b[this.pos] === 0x2b || b[this.pos] === 0x2d) {
        expNegative = b[this.pos] === 0x2d;
        this.pos++;
        if (this.pos >= n) this.stop(n);
      }
      if (!isDigit(b[this.pos])) this.stop(this.pos);
      expStart = this.pos;
      while (this.pos < n && isDigit(b[this.pos])) this.pos++;
      expEnd = this.pos;
    }
    // N4. X saturates at len(literal) + 17: past it the outcome cannot change.
    const cap = this.pos - start + 17;
    let x = 0;
    for (let i = expStart; i >= 0 && i < expEnd; i++) x = Math.min(cap, x * 10 + (b[i] - 0x30));
    const digits = ascii(b.subarray(intStart, intEnd)) + ascii(b.subarray(fracStart, fracEnd));
    let first = 0;
    while (first < digits.length && digits[first] === '0') first++;
    let last = digits.length;
    while (last > first && digits[last - 1] === '0') last--;
    if (first === last) return 0; // D is empty: the value is 0, whatever the exponent
    const s = (expNegative ? -x : x) - (fracEnd - fracStart) + (digits.length - last);
    const d = digits.slice(first, last);
    if (s < 0) {
      this.defect('NUMBER_NOT_INTEGER', start);
      return 0;
    }
    if (d.length + s > 16) {
      this.defect('NUMBER_OUT_OF_RANGE', start);
      return 0;
    }
    const full = d + '0'.repeat(s);
    if (full.length === 16 && full > MAX_INTEGER_DIGITS) {
      this.defect('NUMBER_OUT_OF_RANGE', start);
      return 0;
    }
    const value = Number(full);
    return negative ? -value : value;
  }
}

/** ASCII digits to a string, without spreading a long mantissa onto the call stack. */
function ascii(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192)
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return out;
}

function reject(
  cls: ExperimentalCandidateRejectClass,
  offset: number,
): ExperimentalCandidateIngressResult {
  return { status: 'reject', class: cls, offset };
}

function compareCodePoints(a: string, b: string): number {
  const ia = a[Symbol.iterator]();
  const ib = b[Symbol.iterator]();
  for (;;) {
    const x = ia.next();
    const y = ib.next();
    if (x.done || y.done) return x.done ? (y.done ? 0 : -1) : 1;
    const diff = x.value.codePointAt(0)! - y.value.codePointAt(0)!;
    if (diff !== 0) return diff;
  }
}

/** The `dcp-jcs-v1` output rules (§3.4) over an accepted value, at most 64 levels deep. */
function serialize(v: ExperimentalCandidateValue): string {
  if (v === null) return 'null';
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v))
      throw new ExperimentalCandidateInternalError(`not a safe integer: ${v}`);
    return String(v);
  }
  if (typeof v === 'string') return quote(v);
  if (Array.isArray(v)) return '[' + v.map(serialize).join(',') + ']';
  const keys = Object.keys(v).sort(compareCodePoints);
  return '{' + keys.map((k) => quote(k) + ':' + serialize(v[k])).join(',') + '}';
}

const SHORT_ESCAPES: Record<number, string> = {
  0x08: '\\b',
  0x09: '\\t',
  0x0a: '\\n',
  0x0c: '\\f',
  0x0d: '\\r',
  0x22: '\\"',
  0x5c: '\\\\',
};

function quote(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const u = s.charCodeAt(i);
    const short = SHORT_ESCAPES[u];
    if (short !== undefined) out += short;
    else if (u < 0x20) out += '\\u00' + u.toString(16).padStart(2, '0');
    else out += s[i];
  }
  return out + '"';
}

/**
 * EXPERIMENTAL, opt-in (candidate `dcp-jcs-v2`, phase 1): the ingress of one unit from its original
 * bytes. Returns the rejection class and byte offset, or the exact value, its canonical bytes and their
 * SHA-256. It never verifies, signs or admits anything, and it does not change `dcp-jcs-v1`.
 */
export function experimentalCandidateIngress(
  bytes: Uint8Array,
): ExperimentalCandidateIngressResult {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('experimentalCandidateIngress expects the original bytes as a Uint8Array');
  }
  try {
    return new Scanner(bytes).run();
  } catch (e) {
    if (e instanceof ExperimentalCandidateInternalError) throw e;
    throw new ExperimentalCandidateInternalError(
      `unexpected failure: ${(e as Error)?.message ?? String(e)}`,
    );
  }
}
