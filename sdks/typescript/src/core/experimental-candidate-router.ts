/**
 * EXPERIMENTAL and opt-in: phase 2 of the inactive candidate profile `dcp-jcs-v2`
 * (docs/proposals/canonicalization-candidate, §5–§7): the unit from a transport, the profile it
 * selects, and the decision to reject it, to delegate it to `dcp-jcs-v1` through an explicit
 * historical adapter, or to hand it to the candidate path. Not normative and nothing calls it:
 * `dcp-jcs-v1`, its verifiers and every default are unchanged. It verifies, signs or admits nothing;
 * `candidate` is never an acceptance (phase 3 verifies it).
 *
 * One byte-level grammar walker serves both the envelope extraction and the profile reader; the
 * unit's own diagnosis is the unchanged phase 1 ingress. The historical adapter is consulted lazily,
 * at most once per route, and its reading can never produce `candidate`.
 */
import {
  experimentalCandidateIngress,
  ExperimentalCandidateInternalError,
  type ExperimentalCandidateRejectClass,
  type ExperimentalCandidateValue,
} from './experimental-candidate-ingress.js';

export type ExperimentalCandidateTransport = 'bare' | 'envelope';
export type ExperimentalCandidateProfile = 'dcp-jcs-v1' | 'dcp-jcs-v2';

/** A configuration error, raised when the router is created and never for the data. */
export class ExperimentalCandidateConfigError extends Error {
  constructor(
    readonly code: 'POLICY_INVALID' | 'CONFIG_INVALID',
    readonly detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = 'ExperimentalCandidateConfigError';
  }
}

/** A historical adapter that failed otherwise than by refusing the data; never a rejection. */
export class ExperimentalCandidateAdapterError extends Error {
  constructor(
    readonly adapter: string,
    message: string,
  ) {
    super(`historical adapter ${adapter}: ${message}`);
    this.name = 'ExperimentalCandidateAdapterError';
  }
}

/** What a historical adapter returns: the decoder's value as is, or its refusal of the data. */
export type ExperimentalHistoricalDecode =
  { ok: true; value: unknown } | { ok: false; reason: string };

/**
 * A historical decoder. `decode` receives its own copy of the unit bytes and must report a refusal
 * of the data as `{ ok: false }`; anything it throws is an ExperimentalCandidateAdapterError. The
 * router reads the profile from the returned value by the exact path, so the decoder must keep the
 * last duplicate member, as the built-in ones measurably do. Parity is only claimed for adapters
 * that pass the parity tests.
 */
export interface ExperimentalHistoricalAdapter {
  readonly name: string;
  decode(unit: Uint8Array): ExperimentalHistoricalDecode;
}

function jsonParseAdapter(
  name: string,
  text: (unit: Uint8Array) => string,
): ExperimentalHistoricalAdapter {
  return Object.freeze({
    name,
    decode(unit: Uint8Array): ExperimentalHistoricalDecode {
      try {
        return { ok: true, value: JSON.parse(text(unit)) };
      } catch (e) {
        // What the real decoder does with these bytes: a syntax error, or a stack overflow on deep nesting.
        if (e instanceof SyntaxError || e instanceof RangeError)
          return { ok: false, reason: `${e.name}: ${e.message}` };
        throw e;
      }
    },
  });
}

/** The measured TypeScript decoders, offered by name; none is a default. */
export const experimentalHistoricalAdapters = Object.freeze({
  bufferUtf8JsonParse: jsonParseAdapter('bufferUtf8JsonParse', (u) =>
    Buffer.from(u).toString('utf8'),
  ),
  textDecoderJsonParse: jsonParseAdapter('textDecoderJsonParse', (u) =>
    new TextDecoder().decode(u),
  ),
});

export type ExperimentalCandidateUnitRange = { start: number; end: number };
export type ExperimentalCandidateWarning = {
  class: ExperimentalCandidateRejectClass;
  offset: number;
  transportOffset: number;
};
export type ExperimentalCandidateRouteRejectClass =
  | ExperimentalCandidateRejectClass
  | 'TRANSPORT_INVALID'
  | 'TRANSPORT_AMBIGUOUS'
  | 'PROFILE_UNKNOWN'
  | 'PROFILE_NOT_ACCEPTED';
export type ExperimentalCandidateHistorical =
  { adapter: string; decoded: unknown } | { adapter: string; failed: string };

export type ExperimentalCandidateRouteResult =
  | {
      outcome: 'reject';
      class: ExperimentalCandidateRouteRejectClass;
      detail: string | null;
      offset: number | null;
      transportOffset: number | null;
      unit: ExperimentalCandidateUnitRange | null;
      profile: ExperimentalCandidateProfile | null;
      attempts: [];
      warnings: [];
    }
  | {
      outcome: 'v1_path';
      unit: ExperimentalCandidateUnitRange & { bytes: Uint8Array };
      profile: 'dcp-jcs-v1';
      profileSource: 'field' | 'absent' | 'historical';
      attempts: ['dcp-jcs-v1'];
      warnings: ExperimentalCandidateWarning[];
      historical: ExperimentalCandidateHistorical;
    }
  | {
      outcome: 'candidate';
      unit: ExperimentalCandidateUnitRange & { bytes: Uint8Array };
      profile: 'dcp-jcs-v2';
      attempts: ['dcp-jcs-v2'];
      warnings: [];
      value: ExperimentalCandidateValue;
      canonical: Uint8Array;
      canonicalSha256: string;
    };

export type ExperimentalCandidateExtraction =
  | { status: 'unit'; start: number; end: number }
  | {
      status: 'reject';
      class: 'TRANSPORT_INVALID' | 'TRANSPORT_AMBIGUOUS';
      detail:
        | 'BOM'
        | 'SYNTAX'
        | 'NOT_AN_OBJECT'
        | 'NO_SIGNED_BUNDLE'
        | 'SIGNED_BUNDLE_REPEATED'
        | 'UTF8_INVALID';
      transportOffset: number | null;
    };

// ── The byte-level grammar walker ──────────────────────────────────────────

/** A member of an object recorded by the walker: offsets in the input, quotes included in the name. */
type Member = {
  container: number;
  nameStart: number;
  nameEnd: number;
  valueStart: number;
  valueEnd: number;
  valueObject: number;
};
type Walk =
  | { ok: true; rootStart: number; rootObject: boolean; members: Member[] }
  | { ok: false; offset: number };

const isDigit = (c: number) => c >= 0x30 && c <= 0x39;
const isHex = (c: number) => isDigit(c) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
const isWs = (c: number) => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;

class WalkStop {
  constructor(readonly offset: number) {}
}

/**
 * The RFC 8259 grammar of b[start, end) as one JSON text, iteratively and at any depth, without
 * decoding: strings are delimited and their escapes checked, and bytes of 0x80 and above inside them
 * are left to the encoding check. Records the members of the objects within `recordDepth` levels.
 * On a grammar error, the first byte that cannot extend a prefix of a JSON text (or `end`).
 */
function walk(b: Uint8Array, start: number, end: number, recordDepth: number): Walk {
  let pos = start;
  const stop = (offset: number): never => {
    throw new WalkStop(offset);
  };
  const skipWs = () => {
    while (pos < end && isWs(b[pos])) pos++;
  };
  const need = () => (pos < end ? b[pos] : stop(end));
  const string = () => {
    pos++;
    for (;;) {
      const c = need();
      if (c === 0x22) return void pos++;
      if (c < 0x20) stop(pos);
      if (c !== 0x5c) {
        pos++;
        continue;
      }
      pos++;
      const e = need();
      if (e === 0x75) {
        for (let k = 1; k <= 4; k++) {
          pos++;
          if (!isHex(need())) stop(pos);
        }
        pos++;
      } else if ([0x22, 0x5c, 0x2f, 0x62, 0x66, 0x6e, 0x72, 0x74].includes(e)) {
        pos++;
      } else {
        stop(pos);
      }
    }
  };
  const digits = () => {
    while (pos < end && isDigit(b[pos])) pos++;
  };
  const number = () => {
    if (b[pos] === 0x2d) pos++;
    const c = need();
    if (c === 0x30) pos++;
    else if (isDigit(c)) digits();
    else stop(pos);
    if (pos < end && b[pos] === 0x2e) {
      pos++;
      if (!isDigit(need())) stop(pos);
      digits();
    }
    if (pos < end && (b[pos] === 0x65 || b[pos] === 0x45)) {
      pos++;
      if (need() === 0x2b || b[pos] === 0x2d) pos++;
      if (!isDigit(need())) stop(pos);
      digits();
    }
  };
  const literal = (word: string) => {
    for (let k = 0; k < word.length; k++) {
      if (pos >= end) stop(end);
      if (b[pos] !== word.charCodeAt(k)) stop(pos);
      pos++;
    }
  };

  const members: Member[] = [];
  const stack: { object: boolean; id: number; depth: number; pending: number }[] = [];
  let nextId = 0;
  try {
    skipWs();
    const rootStart = pos;
    let rootObject = false;
    let state: 'value' | 'key' | 'after' = 'value';
    for (;;) {
      if (state === 'value') {
        const c = need();
        if (c === 0x7b || c === 0x5b) {
          const object = c === 0x7b;
          const id = nextId++;
          const parent = stack[stack.length - 1];
          if (parent === undefined) rootObject = object;
          else if (parent.pending >= 0 && object) members[parent.pending].valueObject = id;
          stack.push({ object, id, depth: stack.length + 1, pending: -1 });
          pos++;
          skipWs();
          if (pos < end && b[pos] === (object ? 0x7d : 0x5d)) {
            pos++;
            stack.pop();
            state = 'after';
          } else {
            state = object ? 'key' : 'value';
          }
        } else if (c === 0x22) {
          string();
          state = 'after';
        } else if (c === 0x2d || isDigit(c)) {
          number();
          state = 'after';
        } else if (c === 0x74) {
          literal('true');
          state = 'after';
        } else if (c === 0x66) {
          literal('false');
          state = 'after';
        } else if (c === 0x6e) {
          literal('null');
          state = 'after';
        } else {
          stop(pos);
        }
      } else if (state === 'key') {
        if (need() !== 0x22) stop(pos);
        const nameStart = pos;
        string();
        const nameEnd = pos;
        skipWs();
        if (need() !== 0x3a) stop(pos);
        pos++;
        skipWs();
        const frame = stack[stack.length - 1];
        if (frame.depth <= recordDepth) {
          frame.pending = members.length;
          members.push({
            container: frame.id,
            nameStart,
            nameEnd,
            valueStart: pos,
            valueEnd: -1,
            valueObject: -1,
          });
        }
        state = 'value';
      } else {
        const frame = stack[stack.length - 1];
        if (frame === undefined) {
          skipWs();
          if (pos !== end) stop(pos);
          return { ok: true, rootStart, rootObject, members };
        }
        if (frame.pending >= 0) {
          members[frame.pending].valueEnd = pos;
          frame.pending = -1;
        }
        skipWs();
        const c = need();
        if (c === 0x2c) {
          pos++;
          skipWs();
          state = frame.object ? 'key' : 'value';
        } else if (c === (frame.object ? 0x7d : 0x5d)) {
          pos++;
          stack.pop();
        } else {
          stop(pos);
        }
      }
    }
  } catch (e) {
    if (e instanceof WalkStop) return { ok: false, offset: e.offset };
    throw e;
  }
}

const SIMPLE_ESCAPES: Record<number, number> = {
  0x22: 0x22,
  0x5c: 0x5c,
  0x2f: 0x2f,
  0x62: 0x08,
  0x66: 0x0c,
  0x6e: 0x0a,
  0x72: 0x0d,
  0x74: 0x09,
};

/** Whether the string b[start, end) (quotes included, grammar already checked) unescapes to the ASCII `target`. */
function stringEquals(b: Uint8Array, start: number, end: number, target: string): boolean {
  let i = start + 1;
  let k = 0;
  while (i < end - 1) {
    let unit: number;
    if (b[i] === 0x5c) {
      if (b[i + 1] === 0x75) {
        unit = parseInt(String.fromCharCode(b[i + 2], b[i + 3], b[i + 4], b[i + 5]), 16);
        i += 6;
      } else {
        unit = SIMPLE_ESCAPES[b[i + 1]];
        i += 2;
      }
    } else {
      if (b[i] >= 0x80) return false; // the targets are ASCII
      unit = b[i];
      i++;
    }
    if (k >= target.length || unit !== target.charCodeAt(k)) return false;
    k++;
  }
  return k === target.length;
}

function lastMember(
  b: Uint8Array,
  members: Member[],
  container: number,
  name: string,
): Member | undefined {
  for (let i = members.length - 1; i >= 0; i--) {
    const m = members[i];
    if (m.container === container && stringEquals(b, m.nameStart, m.nameEnd, name)) return m;
  }
  return undefined;
}

// ── UTF-8 outside the unit (T5) ────────────────────────────────────────────

/** Offset of the first byte of the first ill-formed UTF-8 subsequence in b[start, end), or -1. */
function firstInvalidUtf8(b: Uint8Array, start: number, end: number): number {
  let i = start;
  while (i < end) {
    const c = b[i];
    if (c < 0x80) {
      i++;
      continue;
    }
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
      if (i + k >= end) return i;
      const d = b[i + k];
      if (k === 1 ? d < lo || d > hi : d < 0x80 || d > 0xbf) return i;
    }
    i += need + 1;
  }
  return -1;
}

function extract(
  b: Uint8Array,
  transport: ExperimentalCandidateTransport,
): ExperimentalCandidateExtraction {
  const n = b.length;
  if (transport === 'bare') return { status: 'unit', start: 0, end: n };
  type Rejected = Extract<ExperimentalCandidateExtraction, { status: 'reject' }>;
  const reject = (
    cls: Rejected['class'],
    detail: Rejected['detail'],
    transportOffset: number | null,
  ): Rejected => ({
    status: 'reject',
    class: cls,
    detail,
    transportOffset,
  });
  if (n >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf)
    return reject('TRANSPORT_INVALID', 'BOM', 0); // T1
  const w = walk(b, 0, n, 1); // T2
  if (!w.ok) return reject('TRANSPORT_INVALID', 'SYNTAX', w.offset);
  if (!w.rootObject) return reject('TRANSPORT_INVALID', 'NOT_AN_OBJECT', w.rootStart); // T3
  const named = w.members.filter(
    (m) => m.container === 0 && stringEquals(b, m.nameStart, m.nameEnd, 'signed_bundle'),
  );
  if (named.length === 0) return reject('TRANSPORT_INVALID', 'NO_SIGNED_BUNDLE', null); // T4
  if (named.length > 1)
    return reject('TRANSPORT_AMBIGUOUS', 'SIGNED_BUNDLE_REPEATED', named[1].nameStart);
  const { valueStart: start, valueEnd: end } = named[0];
  for (const [from, to] of [
    [0, start],
    [end, n],
  ]) {
    const bad = firstInvalidUtf8(b, from, to); // T5: before the unit, then after it
    if (bad >= 0) return reject('TRANSPORT_INVALID', 'UTF8_INVALID', bad);
  }
  return { status: 'unit', start, end };
}

/**
 * EXPERIMENTAL, opt-in (candidate `dcp-jcs-v2`, phase 2): the unit of a transport, by the phases T1–T5
 * of §6.3 for an envelope (the whole input for `bare`), as offsets in the input. It does not look
 * inside the unit beyond its grammar.
 */
export function experimentalCandidateExtractUnit(
  bytes: Uint8Array,
  transport: ExperimentalCandidateTransport,
): ExperimentalCandidateExtraction {
  if (!(bytes instanceof Uint8Array))
    throw new TypeError(
      'experimentalCandidateExtractUnit expects the original bytes as a Uint8Array',
    );
  if (transport !== 'bare' && transport !== 'envelope')
    throw new TypeError("transport must be 'bare' or 'envelope'");
  return extract(bytes, transport);
}

type Reading = {
  profile: ExperimentalCandidateProfile | 'absent' | 'unknown';
  offset: number | null;
};

/** The profile a walkable unit selects: the exact path, the last duplicate at each step (§7). */
function readProfile(b: Uint8Array, start: number, end: number): Reading {
  const w = walk(b, start, end, 3);
  if (!w.ok)
    throw new ExperimentalCandidateInternalError(
      'the grammar walker refused a unit the ingress walked',
    );
  const absent: Reading = { profile: 'absent', offset: null };
  if (!w.rootObject) return absent;
  const bundle = lastMember(b, w.members, 0, 'bundle');
  if (bundle === undefined || bundle.valueObject < 0) return absent;
  const manifest = lastMember(b, w.members, bundle.valueObject, 'manifest');
  if (manifest === undefined || manifest.valueObject < 0) return absent;
  const field = lastMember(b, w.members, manifest.valueObject, 'canonicalization_profile');
  if (field === undefined) return absent;
  const offset = field.valueStart - start;
  for (const known of ['dcp-jcs-v1', 'dcp-jcs-v2'] as const) {
    if (b[field.valueStart] === 0x22 && stringEquals(b, field.valueStart, field.valueEnd, known))
      return { profile: known, offset };
  }
  return { profile: 'unknown', offset };
}

/** The profile a decoded value carries at the exact path, own properties only. */
function readDecodedProfile(value: unknown): Reading['profile'] {
  const own = (node: unknown, key: string): unknown =>
    node !== null &&
    typeof node === 'object' &&
    !Array.isArray(node) &&
    Object.prototype.hasOwnProperty.call(node, key)
      ? (node as Record<string, unknown>)[key]
      : undefined;
  const field = own(own(own(value, 'bundle'), 'manifest'), 'canonicalization_profile');
  if (field === undefined) return 'absent';
  return field === 'dcp-jcs-v1' || field === 'dcp-jcs-v2' ? field : 'unknown';
}

/**
 * Whether a returned value has only what a JSON decoder produces: null, booleans, any number, any
 * string, plain arrays and objects of enumerable data properties, no shared or cyclic references. It
 * reads property descriptors and never invokes an accessor; an accessor is not decoder output.
 */
function decoderTypes(value: unknown): boolean {
  const seen = new Set<object>();
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const v = stack.pop();
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
      continue;
    if (typeof v !== 'object' || seen.has(v as object)) return false;
    seen.add(v as object);
    const array = Array.isArray(v);
    const proto = Object.getPrototypeOf(v);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null)
      return false;
    for (const key of Reflect.ownKeys(v as object)) {
      if (typeof key !== 'string') return false;
      if (array && key === 'length') continue;
      const d = Object.getOwnPropertyDescriptor(v, key)!;
      if (!('value' in d) || !d.enumerable) return false;
      stack.push(d.value);
    }
  }
  return true;
}

/** A thrown value described without trusting it. */
function describe(e: unknown): string {
  try {
    return e instanceof Error ? `${e.name}: ${e.message}` : typeof e;
  } catch {
    return 'an unprintable value';
  }
}

const PROFILES = ['dcp-jcs-v1', 'dcp-jcs-v2'];

/** A router over a private snapshot of its configuration (createExperimentalCandidateRouter). */
export type ExperimentalCandidateRouter = {
  readonly configuration: {
    transport: ExperimentalCandidateTransport;
    acceptedProfiles: string[];
    historical: string;
  };
  route(bytes: Uint8Array): ExperimentalCandidateRouteResult;
};

class Router implements ExperimentalCandidateRouter {
  readonly #transport: ExperimentalCandidateTransport;
  readonly #acceptsV1: boolean;
  readonly #acceptsV2: boolean;
  readonly #adapterName: string;
  readonly #decode: (unit: Uint8Array) => ExperimentalHistoricalDecode;

  constructor(
    transport: ExperimentalCandidateTransport,
    acceptsV1: boolean,
    acceptsV2: boolean,
    name: string,
    decode: (unit: Uint8Array) => ExperimentalHistoricalDecode,
  ) {
    this.#transport = transport;
    this.#acceptsV1 = acceptsV1;
    this.#acceptsV2 = acceptsV2;
    this.#adapterName = name;
    this.#decode = decode;
  }

  /** A fresh copy of the effective configuration; changing it changes nothing. */
  get configuration(): {
    transport: ExperimentalCandidateTransport;
    acceptedProfiles: string[];
    historical: string;
  } {
    return {
      transport: this.#transport,
      acceptedProfiles: PROFILES.filter((p) =>
        p === 'dcp-jcs-v1' ? this.#acceptsV1 : this.#acceptsV2,
      ),
      historical: this.#adapterName,
    };
  }

  /**
   * The adapter, consulted once on its own copy of the unit. Anything thrown while calling it, while
   * inspecting what it returned or while reading the profile from it is an adapter error, never a
   * rejection of the data.
   */
  #consult(unit: Uint8Array): ExperimentalCandidateHistorical {
    const fail = (what: string, e?: unknown) =>
      new ExperimentalCandidateAdapterError(
        this.#adapterName,
        e === undefined ? what : `${what} threw ${describe(e)}`,
      );
    let r: unknown;
    try {
      r = this.#decode(unit.slice());
    } catch (e) {
      throw fail('decode', e);
    }
    try {
      if (r === null || typeof r !== 'object')
        throw fail('decode must return { ok: true, value } or { ok: false, reason }');
      const ok = (r as { ok?: unknown }).ok;
      if (typeof ok !== 'boolean')
        throw fail('decode must return { ok: true, value } or { ok: false, reason }');
      if (!ok)
        return { adapter: this.#adapterName, failed: String((r as { reason?: unknown }).reason) };
      if (!('value' in r)) throw fail('decode returned { ok: true } without a value');
      const value = (r as { value: unknown }).value;
      if (!decoderTypes(value)) throw fail('decode returned a value no JSON decoder produces');
      return { adapter: this.#adapterName, decoded: value };
    } catch (e) {
      if (e instanceof ExperimentalCandidateAdapterError) throw e;
      throw fail('inspecting the result of decode', e);
    }
  }

  #readHistorical(value: unknown): Reading['profile'] {
    try {
      return readDecodedProfile(value);
    } catch (e) {
      throw new ExperimentalCandidateAdapterError(
        this.#adapterName,
        `reading the profile of the decoded value threw ${describe(e)}`,
      );
    }
  }

  /**
   * EXPERIMENTAL, opt-in (candidate `dcp-jcs-v2`, phase 2): reject, delegate to `dcp-jcs-v1`, or
   * select the candidate path (§6.4), from the original bytes. Works on a private copy of `bytes`.
   */
  route(bytes: Uint8Array): ExperimentalCandidateRouteResult {
    if (!(bytes instanceof Uint8Array))
      throw new TypeError('route expects the original bytes as a Uint8Array');
    const b = new Uint8Array(bytes); // a private copy: nothing the caller or the adapter does reaches it
    const x = extract(b, this.#transport);
    if (x.status === 'reject') {
      return {
        outcome: 'reject',
        class: x.class,
        detail: x.detail,
        offset: null,
        transportOffset: x.transportOffset,
        unit: null,
        profile: null,
        attempts: [],
        warnings: [],
      };
    }
    const { start, end } = x;
    const unit = b.subarray(start, end);
    const range = { start, end };
    const scan = experimentalCandidateIngress(unit);
    const diagnosis =
      scan.status === 'reject'
        ? { class: scan.class, offset: scan.offset, transportOffset: start + scan.offset }
        : null;
    const reject = (
      cls: ExperimentalCandidateRouteRejectClass,
      offset: number | null,
      profile: ExperimentalCandidateProfile | null,
    ) =>
      ({
        outcome: 'reject',
        class: cls,
        detail: null,
        offset,
        transportOffset: offset === null ? null : start + offset,
        unit: range,
        profile,
        attempts: [],
        warnings: [],
      }) as ExperimentalCandidateRouteResult;
    const delegate = (
      profileSource: 'field' | 'absent' | 'historical',
      historical: ExperimentalCandidateHistorical,
    ) =>
      ({
        outcome: 'v1_path',
        unit: { start, end, bytes: unit.slice() },
        profile: 'dcp-jcs-v1',
        profileSource,
        attempts: ['dcp-jcs-v1'],
        warnings: diagnosis === null ? [] : [diagnosis],
        historical,
      }) as ExperimentalCandidateRouteResult;

    const walkable =
      diagnosis === null || !['BOM', 'UTF8_INVALID', 'SYNTAX'].includes(diagnosis.class);
    if (walkable) {
      const reading = readProfile(b, start, end);
      if (reading.profile === 'unknown') return reject('PROFILE_UNKNOWN', reading.offset, null);
      if (reading.profile === 'absent' || reading.profile === 'dcp-jcs-v1') {
        if (!this.#acceptsV1) return reject('PROFILE_NOT_ACCEPTED', reading.offset, 'dcp-jcs-v1');
        return delegate(reading.profile === 'absent' ? 'absent' : 'field', this.#consult(unit));
      }
      if (!this.#acceptsV2) return reject('PROFILE_NOT_ACCEPTED', reading.offset, 'dcp-jcs-v2');
      if (diagnosis !== null) return reject(diagnosis.class, diagnosis.offset, 'dcp-jcs-v2');
      if (scan.status !== 'accept')
        throw new ExperimentalCandidateInternalError('no diagnosis without an accepted unit');
      return {
        outcome: 'candidate',
        unit: { start, end, bytes: unit.slice() },
        profile: 'dcp-jcs-v2',
        attempts: ['dcp-jcs-v2'],
        warnings: [],
        value: scan.value,
        canonical: scan.canonical,
        canonicalSha256: scan.canonicalSha256,
      };
    }
    // Not walkable: the historical adapter decides, once; its reading never selects the candidate.
    const historical = this.#consult(unit);
    if (!('decoded' in historical)) return reject(diagnosis!.class, diagnosis!.offset, null);
    const profile = this.#readHistorical(historical.decoded);
    if (profile !== 'absent' && profile !== 'dcp-jcs-v1')
      return reject(diagnosis!.class, diagnosis!.offset, null);
    if (!this.#acceptsV1) return reject('PROFILE_NOT_ACCEPTED', null, 'dcp-jcs-v1');
    return delegate('historical', historical);
  }
}

function snapshotPolicy(policy: unknown): { acceptsV1: boolean; acceptsV2: boolean } {
  if (policy === undefined || policy === null)
    throw new ExperimentalCandidateConfigError('POLICY_INVALID', 'MISSING');
  if (!Array.isArray(policy) || policy.length === 0)
    throw new ExperimentalCandidateConfigError('POLICY_INVALID', 'NOT_A_NON_EMPTY_LIST');
  const entries: unknown[] = [];
  try {
    for (let i = 0; i < policy.length; i++) entries.push(policy[i]);
  } catch {
    throw new ExperimentalCandidateConfigError('CONFIG_INVALID', 'CONFIG');
  }
  if (!entries.every((p) => typeof p === 'string'))
    throw new ExperimentalCandidateConfigError('POLICY_INVALID', 'NOT_STRINGS');
  if (new Set(entries).size !== entries.length)
    throw new ExperimentalCandidateConfigError('POLICY_INVALID', 'REPEATED');
  if (!entries.every((p) => PROFILES.includes(p)))
    throw new ExperimentalCandidateConfigError('POLICY_INVALID', 'UNKNOWN_PROFILE');
  return { acceptsV1: entries.includes('dcp-jcs-v1'), acceptsV2: entries.includes('dcp-jcs-v2') };
}

/**
 * EXPERIMENTAL, opt-in (candidate `dcp-jcs-v2`, phase 2): a router over a snapshot of `config`, which
 * is validated here, before any input: the transport, the accepted profiles (no default) and the
 * historical adapter (no default; its name and its decode function are captured now).
 */
export function createExperimentalCandidateRouter(config: {
  transport: ExperimentalCandidateTransport;
  acceptedProfiles: readonly string[];
  historical: ExperimentalHistoricalAdapter;
}): ExperimentalCandidateRouter {
  const fail = (code: 'POLICY_INVALID' | 'CONFIG_INVALID', detail: string) =>
    new ExperimentalCandidateConfigError(code, detail);
  let transport: unknown, acceptedProfiles: unknown, historical: unknown;
  try {
    if (config === null || typeof config !== 'object') throw fail('CONFIG_INVALID', 'CONFIG');
    ({ transport, acceptedProfiles, historical } = config);
  } catch (e) {
    throw e instanceof ExperimentalCandidateConfigError ? e : fail('CONFIG_INVALID', 'CONFIG');
  }
  const policy = snapshotPolicy(acceptedProfiles);
  if (transport !== 'bare' && transport !== 'envelope') throw fail('CONFIG_INVALID', 'TRANSPORT');
  let name: unknown, decode: unknown;
  try {
    if (historical !== null && typeof historical === 'object')
      ({ name, decode } = historical as Record<string, unknown>);
  } catch {
    throw fail('CONFIG_INVALID', 'HISTORICAL_ADAPTER');
  }
  if (typeof name !== 'string' || name.length === 0 || typeof decode !== 'function') {
    throw fail('CONFIG_INVALID', 'HISTORICAL_ADAPTER');
  }
  return new Router(
    transport,
    policy.acceptsV1,
    policy.acceptsV2,
    `${name}`,
    decode.bind(historical),
  );
}

/**
 * @internal Not exported by the package: the grammar verdict of the walker over a whole input, for
 * the differential tests against the phase 1 scanner.
 */
export function walkCandidateGrammarForTests(bytes: Uint8Array): {
  ok: boolean;
  offset: number | null;
} {
  const w = walk(bytes, 0, bytes.length, 0);
  return w.ok ? { ok: true, offset: null } : { ok: false, offset: w.offset };
}
