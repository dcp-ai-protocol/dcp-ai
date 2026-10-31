// Differential fuzzer for the V2 bundle verifiers (see README.md): the driver as a module, so the CLI (run.mjs) and the
// self-tests run the same code. The same mutated V2 signed bundle goes, in finite bounded batches, to the TypeScript,
// Python, Go and Rust shims under one explicit policy and one verification instant. A disagreement, a verdict that
// contradicts what tests/interop/v2/bundle_vectors.json declares for a seed, a key reorder that changes a verdict, and
// any error, crash or timeout is a finding; an error, crash or timeout is never counted as a verdict.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIMITS as KIT_LIMITS, decodeBase64Strict, exactKeys, isObj, runProcess, sha256, utf8 } from '../conformance/external.js';
import { bounded, treeDigest } from '../conformance/perf.js';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
export const PROTOCOL = 'dcp-difffuzz/3';
// /3: in a verdict, `errors` is a bounded diagnostic summary (at most ERRORS_MAX strings of at most ERROR_CODEPOINTS_MAX
// code points), with a `truncated` marker whenever a shim cut the SDK's list. It bounds the diagnostic transport, not the
// memory or work inside the SDK, which has already produced the full list.
export const ERRORS_MAX = 8;
export const ERROR_CODEPOINTS_MAX = 256;
export const VERIFICATION_TIME = '2026-10-22T00:00:00Z';
export const NOW_MS = Date.parse(VERIFICATION_TIME);
export const SDKS = ['ts', 'py', 'go', 'rust'];
export const MODES = ['default', 'classical_only', 'hybrid_preferred', 'hybrid_required', 'pq_only'];

export const DEFAULTS = {
  seed: '1', iterations: 200, modes: ['default', 'hybrid_required'], timeoutMs: 60000, buildTimeoutMs: 600000,
  batchCases: 64, batchBytes: 16 << 20, caseBytes: 4 << 20, stdoutBytes: 8 << 20,
  maxFindings: 50, maxRetries: 200, minimizeSteps: 24, minimizeTotal: 96,
  python: process.env.DIFFFUZZ_PYTHON || 'python3', out: path.join(HERE, 'findings'), report: undefined, offline: false, replay: undefined,
};
const INT_BOUNDS = {
  iterations: [0, 1_000_000], timeoutMs: [1000, KIT_LIMITS.maxTimeoutMs], buildTimeoutMs: [1000, 3_600_000],
  batchCases: [1, 256], batchBytes: [1 << 16, 64 << 20], caseBytes: [1 << 10, 32 << 20], stdoutBytes: [1 << 16, 64 << 20],
  maxFindings: [1, 10_000], maxRetries: [0, 100_000], minimizeSteps: [0, 1000], minimizeTotal: [0, 100_000],
};
// Non-definitive outcomes, most severe first. A definitive outcome is a verdict or a parser rejection.
const NONDEFINITIVE = ['protocol', 'unsupported', 'crash', 'timeout', 'output_limit', 'sdk_error'];
const HARNESS_FAULTS = new Set(['protocol', 'unsupported']);
const CATEGORIES = new Set(['verdict', 'parse_rejected', ...NONDEFINITIVE]);
const CLASSES = new Set([...NONDEFINITIVE, 'disagreement', 'expectation', 'reorder']);

/** Code points of a string as JavaScript iterates it (a lone surrogate counts one), counted up to cap + 1 at most. */
export function codePoints(s, cap = Infinity) {
  let n = 0;
  for (let i = 0; i < s.length && n <= cap; n++) i += s.codePointAt(i) > 0xffff ? 2 : 1;
  return n;
}
const isCount = (v) => Number.isSafeInteger(v) && v >= 0;
/**
 * A truncation marker coherent with the errors it comes with: exact keys, non-negative safe integers, kept equal to
 * min(original_count, ERRORS_MAX) and to errors.length, every kept error within the bound, original_code_points at
 * least what was kept, and a cut that is possible: fewer errors kept (the omitted ones may be empty, so the code
 * points may all have been kept), or, with every error kept, more original code points and at least one kept prefix
 * cut at exactly ERROR_CODEPOINTS_MAX. Coherence only: whether the shim cut what it says, and the sha256 of originals
 * the driver never sees, cannot be checked here.
 */
export function validMarker(errors, t) {
  if (!exactKeys(t, ['original_count', 'kept', 'original_code_points', 'sha256'])) return false;
  if (!isCount(t.original_count) || !isCount(t.kept) || !isCount(t.original_code_points) || typeof t.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(t.sha256)) return false;
  if (t.kept !== Math.min(t.original_count, ERRORS_MAX) || t.kept !== errors.length) return false;
  let kept = 0;
  let atBound = false;
  for (const e of errors) {
    const n = codePoints(e, ERROR_CODEPOINTS_MAX);
    if (n > ERROR_CODEPOINTS_MAX) return false;
    kept += n;
    atBound ||= n === ERROR_CODEPOINTS_MAX;
  }
  if (t.original_code_points < kept) return false;
  return t.original_count > t.kept || (t.original_code_points > kept && atBound);
}
/** The live bound of protocol /3: a verdict's errors within the bounds, or cut with a coherent marker. */
const boundedVerdict = (r) => (r.truncated !== undefined ? validMarker(r.errors, r.truncated)
  : r.errors.length <= ERRORS_MAX && r.errors.every((e) => codePoints(e, ERROR_CODEPOINTS_MAX) <= ERROR_CODEPOINTS_MAX));

/**
 * A recorded outcome, typed: a verdict has exactly a boolean verified and string errors, and a coherent truncation
 * marker if it has one; any other category at most a message. No length bound: findings recorded under /2 keep their
 * full errors and replay as they are; the bounds of /3 apply to live responses (judgeResponse).
 */
export function validOutcome(o) {
  if (!isObj(o) || !CATEGORIES.has(o.category)) return false;
  if (o.category === 'verdict') return exactKeys(o, ['category', 'verified', 'errors'], ['truncated']) && typeof o.verified === 'boolean' && Array.isArray(o.errors) && o.errors.every((e) => typeof e === 'string')
    && (o.truncated === undefined || validMarker(o.errors, o.truncated));
  return exactKeys(o, ['category'], ['message']) && (o.message === undefined || typeof o.message === 'string');
}
const validOutcomes = (m) => isObj(m) && Object.keys(m).length === SDKS.length && SDKS.every((s) => validOutcome(m[s]));

export class UsageError extends Error {}
export class InfraError extends Error {}

// ── CLI: every value is checked before anything is built or run ──
const OPTION = {
  '--seed': 'seed', '--iterations': 'iterations', '--modes': 'modes', '--timeout': 'timeoutMs', '--timeout-ms': 'timeoutMs',
  '--build-timeout-ms': 'buildTimeoutMs', '--batch-cases': 'batchCases', '--batch-bytes': 'batchBytes', '--case-bytes': 'caseBytes',
  '--stdout-bytes': 'stdoutBytes', '--max-findings': 'maxFindings', '--max-retries': 'maxRetries', '--minimize-steps': 'minimizeSteps',
  '--minimize-total': 'minimizeTotal', '--python': 'python', '--out': 'out', '--report': 'report', '--replay': 'replay',
};
export function parseArgs(argv) {
  const o = { ...DEFAULTS, modes: [...DEFAULTS.modes] };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^(--[a-z-]+)(?:=(.*))?$/s);
    if (m && m[1] === '--offline' && m[2] === undefined) {
      if (seen.has('offline')) throw new UsageError('--offline given more than once');
      seen.add('offline');
      o.offline = true;
      continue;
    }
    const key = m && OPTION[m[1]];
    if (!key) throw new UsageError(`unknown argument ${argv[i]}`);
    if (seen.has(key)) throw new UsageError(`${m[1]} given more than once`);
    seen.add(key);
    const v = m[2] ?? argv[++i];
    if (v === undefined || (m[2] === undefined && v.startsWith('--'))) throw new UsageError(`${m[1]} needs a value`);
    if (key in INT_BOUNDS) {
      const [lo, hi] = INT_BOUNDS[key];
      if (!/^\d+$/.test(v) || !Number.isSafeInteger(Number(v)) || Number(v) < lo || Number(v) > hi) throw new UsageError(`${m[1]} must be an integer from ${lo} to ${hi}`);
      o[key] = Number(v);
    } else if (key === 'modes') {
      const list = v.split(',');
      if (!list.length || list.some((x) => !MODES.includes(x)) || new Set(list).size !== list.length) throw new UsageError(`--modes takes distinct names from ${MODES.join(', ')}`);
      o.modes = list;
    } else if (key === 'seed') {
      if (v === '' || v.length > 256) throw new UsageError('--seed must be 1 to 256 characters');
      o.seed = v;
    } else {
      if (v === '') throw new UsageError(`${m[1]} needs a value`);
      o[key] = v;
    }
  }
  if (o.caseBytes > o.batchBytes) throw new UsageError('--case-bytes cannot exceed --batch-bytes');
  return o;
}

// ── Deterministic PRNG (mulberry32 seeded from a string), as before ──
function hashSeed(s) {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.codePointAt(0), 16777619);
  return h >>> 0;
}
export function makeRng(seed) {
  let a = hashSeed(seed);
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { rand, pick: (arr) => arr[Math.floor(rand() * arr.length)], randInt: (n) => Math.floor(rand() * n) };
}

// ── Seeds and what bundle_vectors.json declares for them ──
const isSignedBundle = (v) => isObj(v) && isObj(v.bundle) && v.bundle.dcp_bundle_version === '2.0' && 'signature' in v;
function collect(value, where, into) {
  if (isSignedBundle(value)) into.push({ name: where, doc: value });
  else if (Array.isArray(value)) value.forEach((v, i) => collect(v, `${where}[${i}]`, into));
  else if (isObj(value)) for (const [k, v] of Object.entries(value)) collect(v, where ? `${where}.${k}` : k, into);
}
export const clone = (v) => JSON.parse(JSON.stringify(v));
function mutated(signed, mutations) {
  const out = clone(signed);
  for (const { path: p, value } of mutations) {
    let node = out;
    for (const k of p.slice(0, -1)) node = node[k];
    node[p[p.length - 1]] = value;
  }
  return out;
}

/**
 * Seeds with their expectation per mode, from the declaration in bundle_vectors.json._description: every verifier
 * accepts signed_bundle; it rejects every must_reject mutation and must_reject_bundles entry whatever its mode;
 * every must_accept_bundles entry verifies in every mode; classical_only_routine_bundle gets verified_by_mode. The
 * default policy resolves to one of the four modes, so "every"/"any mode" covers it; verified_by_mode names no
 * expectation for it. cross_sdk_vectors.json and tests/conformance/examples declare none: differential-only.
 */
export function loadSeeds(root = ROOT) {
  const B = JSON.parse(fs.readFileSync(path.join(root, 'tests/interop/v2/bundle_vectors.json'), 'utf8'));
  const seeds = [];
  const add = (name, doc, expect, overrides) => seeds.push({ name, doc, expect, overrides: overrides ?? null, basis: expect ? 'normative' : 'differential-only' });
  const always = (v) => () => v;
  add('bundle_vectors.signed_bundle', B.signed_bundle, always(true));
  for (const c of B.must_reject) add(`bundle_vectors.must_reject.${c.name}`, mutated(B.signed_bundle, c.mutations), always(false));
  for (const c of B.must_accept_bundles) add(`bundle_vectors.must_accept_bundles.${c.name}`, c.signed_bundle, always(true), c.verifier_policy_overrides);
  const routine = B.classical_only_routine_bundle;
  add('bundle_vectors.classical_only_routine_bundle', routine.signed_bundle, (mode) => (mode in routine.verified_by_mode ? routine.verified_by_mode[mode] : null));
  for (const c of B.must_reject_bundles) add(`bundle_vectors.must_reject_bundles.${c.name}`, c.signed_bundle, always(false), c.verifier_policy_overrides);
  const other = [];
  collect(JSON.parse(fs.readFileSync(path.join(root, 'tests/interop/v2/cross_sdk_vectors.json'), 'utf8')), 'cross_sdk_vectors', other);
  const examples = path.join(root, 'tests/conformance/examples');
  for (const f of fs.readdirSync(examples).filter((f) => f.endsWith('.json')).sort()) collect(JSON.parse(fs.readFileSync(path.join(examples, f), 'utf8')), `examples/${f}`, other);
  for (const s of other) add(s.name, s.doc, null);
  return { seeds, basePolicy: B.default_verifier_policy };
}

/** The explicit policy of a mode: default_verifier_policy, or each mode's policy as the vectors build it; then the case's overrides. */
export function policyFor(basePolicy, mode, overrides) {
  const p = mode === 'default' ? { ...basePolicy } : { ...basePolicy, default_mode: mode, risk_overrides: { low: mode, medium: mode, high: mode } };
  return overrides ? { ...p, ...overrides } : p;
}

// ── Mutators (unchanged behaviour; each mutant is a JS value plus "raw" placeholders spliced verbatim) ──
const RAW = (token) => `\0RAW:${token}\0`;
export function serialize(doc) {
  return JSON.stringify(doc).replace(/"\\u0000RAW:([^"\\]*)\\u0000"/g, '$1');
}
function slots(doc) {
  const out = [];
  const walk = (container, p) => {
    const keys = Array.isArray(container) ? container.map((_, i) => i) : Object.keys(container);
    for (const k of keys) {
      const q = [...p, k];
      out.push({ container, key: k, path: q, value: container[k] });
      if (container[k] && typeof container[k] === 'object') walk(container[k], q);
    }
  };
  walk(doc, []);
  return out;
}
const fmtPath = (p) => p.map((k) => (typeof k === 'number' ? `[${k}]` : `.${k}`)).join('').replace(/^\./, '');
const BASE64 = /^[A-Za-z0-9+/]{16,}={0,2}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const ENUMISH = /^[a-z][a-z0-9_-]{1,31}$/;
const PROTO_KEYS = ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty', 'prototype'];
const ARTIFACTS = ['responsible_principal_record', 'agent_passport', 'intent', 'policy_decision'];

export function makeMutators({ rand, pick, randInt }) {
  const randomValue = () => pick([null, true, false, 0, 1, -1, 'x', '', [], {}, [null], { a: 1 }, RAW('1e2'), 'constructor']);
  const otherType = (v) => {
    const kinds = { string: 'str', number: 'num', boolean: 'bool', object: Array.isArray(v) ? 'arr' : v === null ? 'null' : 'obj' };
    const current = kinds[typeof v];
    const candidates = { str: 'text', num: 42, bool: true, arr: [v], obj: { value: v }, null: null };
    return candidates[pick(Object.keys(candidates).filter((k) => k !== current))];
  };
  return {
    delete_key(doc) {
      const s = pick(slots(doc).filter((x) => isObj(x.container)));
      if (!s) return null;
      delete s.container[s.key];
      return fmtPath(s.path);
    },
    set_null(doc) {
      const s = pick(slots(doc));
      if (!s) return null;
      s.container[s.key] = null;
      return fmtPath(s.path);
    },
    swap_type(doc) {
      const s = pick(slots(doc));
      if (!s) return null;
      s.container[s.key] = otherType(s.value);
      return fmtPath(s.path);
    },
    swap_siblings(doc) {
      const s = pick(slots(doc).filter((x) => isObj(x.container) && Object.keys(x.container).length > 1));
      if (!s) return null;
      const other = pick(Object.keys(s.container).filter((k) => k !== s.key));
      [s.container[s.key], s.container[other]] = [s.container[other], s.container[s.key]];
      return `${fmtPath(s.path)} <-> ${other}`;
    },
    flip_base64_char(doc) {
      const all = slots(doc).filter((x) => typeof x.value === 'string' && BASE64.test(x.value));
      if (!all.length) return null;
      const s = pick(all);
      const i = randInt(s.value.length - (s.value.endsWith('=') ? 2 : 0));
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      let c = alphabet[randInt(64)];
      if (c === s.value[i]) c = alphabet[(alphabet.indexOf(c) + 1) % 64];
      s.container[s.key] = s.value.slice(0, i) + c + s.value.slice(i + 1);
      return `${fmtPath(s.path)}[${i}]`;
    },
    prototype_key(doc) {
      const all = slots(doc).filter((x) => typeof x.value === 'string' && ENUMISH.test(x.value));
      if (!all.length) return null;
      const s = pick(all);
      const k = pick(PROTO_KEYS);
      s.container[s.key] = k;
      return `${fmtPath(s.path)} = ${k}`;
    },
    prototype_key_as_key(doc) {
      const s = pick(slots(doc).filter((x) => isObj(x.container)));
      if (!s) return null;
      const k = pick(PROTO_KEYS);
      if (k === s.key) return null;
      // An own key: plain assignment to "__proto__" would set the prototype instead.
      Object.defineProperty(s.container, k, { value: s.value, enumerable: true, writable: true, configurable: true });
      delete s.container[s.key];
      return `${fmtPath(s.path)} renamed to ${k}`;
    },
    add_unknown_key(doc) {
      const s = pick(slots(doc).filter((x) => isObj(x.value)));
      if (!s) return null;
      const k = `x_${randInt(1e6).toString(36)}`;
      s.value[k] = randomValue();
      return `${fmtPath([...s.path, k])}`;
    },
    duplicate_artifact(doc) {
      const b = doc.bundle;
      if (!isObj(b)) return null;
      const [from, to] = [pick(ARTIFACTS), pick(ARTIFACTS)];
      if (b[from] === undefined) return null;
      if (rand() < 0.5 || from === to) {
        b[to] = clone(b[from]);
        return `bundle.${to} = bundle.${from}`;
      }
      if (!isObj(b[from]) || !isObj(b[to])) return null;
      const part = pick(['composite_sig', 'payload', 'payload_hash']);
      if (b[from][part] === undefined) return null;
      b[to][part] = clone(b[from][part]);
      return `bundle.${to}.${part} = bundle.${from}.${part}`;
    },
    number_variant(doc) {
      const all = slots(doc).filter((x) => typeof x.value === 'number');
      if (!all.length) return null;
      const s = pick(all);
      const n = s.value;
      const token = pick([`${n}.0`, `${n}e0`, `${n === 0 ? 1 : n}e2`, '-0', '0.1', `${n}.5`, '1.0', '1e2', '18446744073709551616',
        '-9223372036854775809', '1' + '0'.repeat(40), '1e400', '-1e-400', '4.9e-324', '9007199254740993']);
      s.container[s.key] = RAW(token);
      return `${fmtPath(s.path)} = ${token}`;
    },
    timestamp_variant(doc) {
      const all = slots(doc).filter((x) => typeof x.value === 'string' && RFC3339.test(x.value));
      if (!all.length) return null;
      const s = pick(all);
      const t = new Date(s.value);
      if (Number.isNaN(t.getTime())) return null;
      const iso = t.toISOString();
      const offset = (sign, h) => `${new Date(t.getTime() + sign * h * 3600000).toISOString().slice(0, 19)}${sign > 0 ? '+' : '-'}${String(h).padStart(2, '0')}:00`;
      const v = pick([offset(1, 5), offset(-1, 5), offset(1, 14), offset(-1, 12), iso.replace('Z', '+00:00'), iso.replace(/\.\d{3}Z$/, 'Z'),
        iso.replace('Z', '.123456789Z'), iso.replace('Z', ''), iso.slice(0, 10), iso.replace('T', ' '), iso.toLowerCase(), iso.replace('Z', '+0500'),
        iso.replace('Z', '+24:00'), iso.replace('Z', '+05:60'), iso.replace(/T\d{2}/, 'T24'), iso.replace(/T\d{2}:\d{2}:\d{2}/, 'T23:59:60'),
        iso.replace(/-\d{2}T/, '-32T'), iso.replace(/-\d{2}-/, '-13-'), iso.replace(/-\d{2}T/, '-00T'), '0001-01-01T00:00:00Z',
        '1969-12-31T23:59:59Z', '1970-01-01T00:00:00Z', '2038-01-19T03:14:08Z', '9999-12-31T23:59:59Z', '+10000-01-01T00:00:00Z',
        '275760-09-13T00:00:00Z', '2026-02-29T00:00:00Z', '2024-02-29T00:00:00Z', '', 'now', '0', '1761004800', `${iso}Z`, ` ${iso}`, `${iso} `]);
      s.container[s.key] = v;
      return `${fmtPath(s.path)} = ${JSON.stringify(v)}`;
    },
    oversized_string(doc) {
      const s = pick(slots(doc));
      if (!s) return null;
      const size = pick([65536, 1 << 20]);
      s.container[s.key] = pick(['A', 'é', '\u0000']).repeat(size);
      return `${fmtPath(s.path)} = <${size} chars>`;
    },
    deep_nesting(doc) {
      // ponytail: depth 100 stays inside every parser's limit (serde_json's default is 128).
      const s = pick(slots(doc));
      if (!s) return null;
      let v = pick([null, 'leaf', 1]);
      for (let i = 0; i < 100; i++) v = rand() < 0.5 ? { n: v } : [v];
      s.container[s.key] = v;
      return `${fmtPath(s.path)} = <depth 100>`;
    },
    reorder_keys(doc) {
      const shuffle = (v) => {
        if (Array.isArray(v)) return v.map(shuffle);
        if (!isObj(v)) return v;
        const keys = Object.keys(v);
        for (let i = keys.length - 1; i > 0; i--) {
          const j = randInt(i + 1);
          [keys[i], keys[j]] = [keys[j], keys[i]];
        }
        const out = {};
        for (const k of keys) Object.defineProperty(out, k, { value: shuffle(v[k]), enumerable: true, writable: true, configurable: true });
        return out;
      };
      const shuffled = shuffle(doc);
      for (const k of Object.keys(doc)) delete doc[k];
      Object.assign(doc, shuffled);
      return '<all keys>';
    },
  };
}
export const MUTATOR_NAMES = Object.keys(makeMutators(makeRng('x')));

// ── One finite batch through one shim ──
const RESULT_KEYS = { verdict: ['verified', 'errors'], parse_rejected: ['message'], error: ['message'], unsupported: [] };
const RESULT_OPTIONAL = { verdict: ['truncated'] };

/** Judges one response against its request. Returns { ok: true, results: Map(id → outcome) } or a batch failure. */
export function judgeResponse(stdout, observed, request) {
  const fail = (category, detail) => ({ ok: false, category, detail, stderr: observed.stderr_excerpt });
  if (observed.spawn_error) return fail('protocol', `cannot start the shim: ${observed.spawn_error}`);
  if (observed.output_limit) return fail('output_limit', `stdout exceeded ${observed.stdout_bytes} bytes`);
  if (observed.timed_out || observed.cleanup_incomplete) return fail('timeout', 'no exit with closed pipes before the deadline');
  if (observed.exit_code !== 0 || observed.signal) return fail('crash', `exit code ${observed.exit_code}, signal ${observed.signal}`);
  if (observed.group_alive_after_exit) return fail('protocol', 'a descendant was still running after the shim exited');
  let res;
  try { res = JSON.parse(utf8(stdout)); } catch (e) { return fail('protocol', `stdout is not one UTF-8 JSON document: ${e.message.slice(0, 200)}`); }
  if (!exactKeys(res, ['protocol', 'run_id', 'nonce', 'results'])) return fail('protocol', 'response fields are not exactly protocol, run_id, nonce, results');
  if (res.protocol !== PROTOCOL || res.run_id !== request.run_id || res.nonce !== request.nonce) return fail('protocol', 'stale or foreign protocol, run_id or nonce');
  if (!Array.isArray(res.results)) return fail('protocol', 'results is not an array');
  const wanted = new Set(request.cases.map((c) => c.id));
  const results = new Map();
  for (const r of res.results) {
    if (!isObj(r) || typeof r.id !== 'string') return fail('protocol', 'a result has no string id');
    if (!wanted.has(r.id)) return fail('protocol', `unknown result id ${JSON.stringify(r.id).slice(0, 80)}`);
    if (results.has(r.id)) return fail('protocol', `duplicate result id ${r.id}`);
    const fields = RESULT_KEYS[r.status];
    if (!fields || !exactKeys(r, ['id', 'status', ...fields], RESULT_OPTIONAL[r.status])) return fail('protocol', `malformed result for ${r.id}`);
    if (r.status === 'verdict' && (typeof r.verified !== 'boolean' || !Array.isArray(r.errors) || !r.errors.every((e) => typeof e === 'string'))) return fail('protocol', `malformed verdict for ${r.id}`);
    if (r.status === 'verdict' && !boundedVerdict(r)) return fail('protocol', `diagnostics of ${r.id} exceed ${ERRORS_MAX} errors of ${ERROR_CODEPOINTS_MAX} code points without a coherent truncation marker`);
    if ((r.status === 'parse_rejected' || r.status === 'error') && typeof r.message !== 'string') return fail('protocol', `malformed ${r.status} for ${r.id}`);
    const category = r.status === 'error' ? 'sdk_error' : r.status;
    results.set(r.id, category === 'verdict' ? { category, verified: r.verified, errors: r.errors, ...(r.truncated !== undefined ? { truncated: r.truncated } : {}) } : { category, ...(r.message !== undefined ? { message: r.message.slice(0, 500) } : {}) });
  }
  if (results.size !== wanted.size) return fail('protocol', `${wanted.size - results.size} result(s) missing`);
  return { ok: true, results };
}

// The exact UTF-8 size of a request: its envelope (ids of fixed length), each case as sent, and the commas between.
const envelopeBytes = (nowMs) => Buffer.byteLength(JSON.stringify({ protocol: PROTOCOL, run_id: crypto.randomUUID(), nonce: '0'.repeat(32), now_ms: nowMs, cases: [] }));
export const caseWireBytes = (job) => Buffer.byteLength(JSON.stringify({ id: '0'.repeat(24), policy: job.policy, bundle_b64: job.bytes.toString('base64') }));

export async function runBatch(argv, cases, { timeoutMs, stdoutBytes, batchBytes }, nowMs = NOW_MS) {
  const request = {
    protocol: PROTOCOL, run_id: crypto.randomUUID(), nonce: crypto.randomBytes(16).toString('hex'), now_ms: nowMs,
    cases: cases.map((c) => ({ id: c.wireId, policy: c.policy, bundle_b64: c.bytes.toString('base64') })),
  };
  const input = Buffer.from(JSON.stringify(request));
  if (batchBytes && input.length > batchBytes) throw new InfraError(`a request of ${input.length} bytes exceeds --batch-bytes ${batchBytes}`);
  const { stdout, observed } = await runProcess(argv, input, { timeoutMs, limits: { ...KIT_LIMITS, stdoutBytes } });
  return { request, observed, judged: judgeResponse(stdout, observed, request) };
}

/** Exactly the four shims, each a non-empty argv of strings, injected (tests) or built. */
export function checkCommands(cmds) {
  const names = Object.keys(cmds ?? {});
  if (names.length !== SDKS.length || !SDKS.every((s) => names.includes(s))) throw new InfraError(`commands must be exactly ${SDKS.join(', ')}, got ${names.join(', ') || 'none'}`);
  for (const s of SDKS) if (!Array.isArray(cmds[s]) || !cmds[s].length || !cmds[s].every((x) => typeof x === 'string' && x !== '')) throw new InfraError(`the ${s} command is not a non-empty argv of strings`);
  return SDKS;
}

// ── Judgement of one job (one document under one policy, through the four shims) ──
const sig = (o) => (o.category === 'verdict' ? `verdict:${o.verified}` : o.category);
// What is compared between SDKs: acceptance. A parser rejection rejects the document, as before (it stays visible as
// parse_rejected); an error, crash, timeout or protocol fault is its own category and never a vote.
export const decision = (o) => (o.category === 'verdict' ? (o.verified ? 'accept' : 'reject') : o.category === 'parse_rejected' ? 'reject' : o.category);
const isDefinitive = (o) => o.category === 'verdict' || o.category === 'parse_rejected';
export function judgeJob(job, outcomes, baselineOf) {
  const classes = [];
  const sdks = Object.keys(outcomes);
  const nondef = NONDEFINITIVE.filter((c) => sdks.some((s) => outcomes[s].category === c));
  classes.push(...nondef);
  const definitive = sdks.filter((s) => isDefinitive(outcomes[s]));
  if (definitive.length && new Set(definitive.map((s) => decision(outcomes[s]))).size > 1) classes.push('disagreement');
  // A declared expectation needs a verdict from every SDK: a parser rejection of a committed seed is not one.
  if (typeof job.expect === 'boolean' && sdks.some((s) => outcomes[s].category !== 'verdict' || outcomes[s].verified !== job.expect)) classes.push('expectation');
  if (job.reorderOnly) {
    const base = baselineOf(job.seed, job.mode);
    if (base && sdks.some((s) => base[s] && isDefinitive(base[s]) && isDefinitive(outcomes[s]) && decision(base[s]) !== decision(outcomes[s]))) classes.push('reorder');
  }
  return classes;
}

// ── Diff units and bounded minimization (works on the document with raw placeholders, never re-parses the text) ──
export function diffUnits(a, b, p = []) {
  if (isObj(a) && isObj(b)) {
    const units = [];
    for (const k of Object.keys(a)) if (!Object.hasOwn(b, k)) units.push({ path: [...p, k], op: 'delete' });
    for (const k of Object.keys(b)) units.push(...(Object.hasOwn(a, k) ? diffUnits(a[k], b[k], [...p, k]) : [{ path: [...p, k], op: 'set', value: b[k] }]));
    return units;
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return a.flatMap((v, i) => diffUnits(v, b[i], [...p, i]));
  return serialize([a]) === serialize([b]) ? [] : [{ path: p, op: 'set', value: b }];
}
export function applyUnits(seedDoc, units) {
  let root = clone(seedDoc);
  for (const u of units) {
    if (!u.path.length) { root = clone(u.value); continue; }
    let node = root;
    for (const k of u.path.slice(0, -1)) node = node?.[k];
    if (node === null || typeof node !== 'object') continue;
    const last = u.path[u.path.length - 1];
    if (u.op === 'delete') delete node[last];
    else Object.defineProperty(node, last, { value: clone([u.value])[0], enumerable: true, writable: true, configurable: true });
  }
  return root;
}


// ── Build of the four shims, bounded by one deadline; Go and Rust build into the run's private directory ──
const fileSha = (f) => ({ path: path.relative(ROOT, f).startsWith('..') ? f : path.relative(ROOT, f), sha256: sha256(fs.readFileSync(f)) });
// A binary built in the run's private directory: its content only, never its ephemeral path.
const builtSha = (f) => ({ built_in: 'the run private directory', sha256: sha256(fs.readFileSync(f)) });

/** The driver and the fixtures a run reads (or that the seeds were injected): recorded for every run and finding. */
export function runInputs({ seedsOverride } = {}) {
  return {
    driver: { fuzz: fileSha(path.join(HERE, 'fuzz.mjs')), run: fileSha(path.join(HERE, 'run.mjs')) },
    fixtures: seedsOverride ? 'seeds injected by the caller (self-tests)' : {
      bundle_vectors: fileSha(path.join(ROOT, 'tests/interop/v2/bundle_vectors.json')),
      cross_sdk_vectors: fileSha(path.join(ROOT, 'tests/interop/v2/cross_sdk_vectors.json')),
      examples: treeDigest(path.join(ROOT, 'tests/conformance/examples')),
    },
  };
}
// What the hashes do not prove, stated with them.
export const PROVENANCE_LIMITS = [
  'sdks/typescript/dist and sdks/typescript/src are both hashed; that the dist was built from that src is not verified.',
  'Only the directories of the direct runtime dependencies Node resolves for sdks/typescript are hashed; transitive dependencies are not recorded.',
  'The Python runtime is the interpreter version and five distribution versions it reports; its other modules are not recorded.',
];

/** Where Node finds a bare dependency of sdks/typescript/dist: the first node_modules/<name> going up from sdks/typescript. */
function nodeDependency(name) {
  for (let dir = path.join(ROOT, 'sdks/typescript'); ; dir = path.dirname(dir)) {
    const pkg = path.join(dir, 'node_modules', name, 'package.json');
    if (fs.existsSync(pkg)) return { version: JSON.parse(fs.readFileSync(pkg, 'utf8')).version, path: path.relative(ROOT, path.dirname(pkg)), tree: treeDigest(path.dirname(pkg)) };
    if (dir === path.dirname(dir)) return null;
  }
}

/** What each shim runs, as hashes: the shims, the built binaries, the TypeScript dist and its dependencies, the SDK sources. */
export function provenance(files, pythonRuntime) {
  const tsPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'sdks/typescript/package.json'), 'utf8'));
  return {
    ts_shim: fileSha(files.ts_shim), py_shim: fileSha(files.py_shim), go_shim: builtSha(files.go_shim), rust_shim: builtSha(files.rust_shim),
    ts_sdk_source: treeDigest(path.join(ROOT, 'sdks/typescript/src')),
    ts_sdk_dist: treeDigest(path.join(ROOT, 'sdks/typescript/dist')), ts_package_lock: fileSha(path.join(ROOT, 'sdks/typescript/package-lock.json')),
    ts_dependencies: Object.fromEntries(Object.keys(tsPkg.dependencies ?? {}).sort().map((d) => [d, nodeDependency(d)])),
    py_sdk_source: treeDigest(path.join(ROOT, 'sdks/python/dcp_ai')), py_runtime: pythonRuntime,
    go_sdk_source: treeDigest(path.join(ROOT, 'sdks/go')), rust_sdk_source: treeDigest(path.join(ROOT, 'sdks/rust/src')), rust_lock: fileSha(path.join(HERE, 'shims/rust/Cargo.lock')),
  };
}

export async function buildShims(o, tmp) {
  const deadline = performance.now() + o.buildTimeoutMs;
  const left = () => Math.max(1000, Math.round(deadline - performance.now()));
  const steps = [];
  const step = async (sdk, argv, cwd, env = {}, mode = 'log') => {
    const r = await bounded(argv, { cwd, env, timeoutMs: left(), mode });
    steps.push({ sdk, argv, cwd: path.relative(ROOT, cwd), env, duration_ms: r.observed.duration_ms, exit_code: r.observed.exit_code, level: r.level?.kind ?? null });
    if (r.level || performance.now() > deadline) throw new InfraError(`${sdk} build failed (${r.level?.message ?? 'build deadline'}): ${r.observed.stderr_excerpt.slice(-800)}`);
    return r.stdout;
  };
  const tsDist = path.join(ROOT, 'sdks/typescript/dist/index.js');
  if (!fs.existsSync(tsDist)) throw new InfraError(`${tsDist} not found: run "npm install && npm run build" in sdks/typescript`);
  const goBin = path.join(tmp, 'go-shim');
  const rustTarget = path.join(tmp, 'rust-target');
  await step('go', ['go', 'build', '-mod=readonly', '-o', goBin, '.'], path.join(HERE, 'shims/go'), o.offline ? { GOPROXY: 'off', GOFLAGS: '-mod=readonly' } : { GOFLAGS: '-mod=readonly' });
  await step('rust', ['cargo', 'build', '--release', '--locked', '--quiet', ...(o.offline ? ['--offline'] : [])], path.join(HERE, 'shims/rust'), { CARGO_TARGET_DIR: rustTarget });
  const py = await step('py', [o.python, '-I', '-c', 'import sys, json, importlib.metadata as m\n'
    + 'def v(d):\n    try:\n        return m.version(d)\n    except m.PackageNotFoundError:\n        return None\n'
    + 'assert sys.version_info >= (3, 10), sys.version\n'
    + 'print(json.dumps({"python": sys.version, "distributions": {d: v(d) for d in ("PyNaCl", "pqcrypto", "cryptography", "pydantic", "jsonschema")}}))'], ROOT, {}, 'capture');
  let pythonRuntime;
  try { pythonRuntime = JSON.parse(py); } catch { throw new InfraError(`the Python interpreter did not report its runtime: ${py.slice(0, 200)}`); }
  const files = { go_shim: goBin, rust_shim: path.join(rustTarget, 'release', 'difffuzz-rust-shim'), ts_shim: path.join(HERE, 'shims/ts/verify.mjs'), py_shim: path.join(HERE, 'shims/py/verify.py') };
  return {
    steps, files, artifacts: provenance(files, pythonRuntime), pythonRuntime,
    commands: { ts: [process.execPath, files.ts_shim, '--batch'], py: [o.python, '-I', files.py_shim, '--batch'], go: [goBin, '--batch'], rust: [files.rust_shim, '--batch'] },
  };
}

// ── The campaign ──
/**
 * Runs a campaign. `commands` (test injection only) replaces the four shims and skips the build; such a run never
 * credits the SDKs (`sdk_campaign: false`). `seedsOverride` and `mutators` are also for the self-tests.
 */
export async function runCampaign(o, { commands: injected, seedsOverride, mutators: only, log = console.log } = {}) {
  const run = { id: crypto.randomUUID(), started_at: new Date().toISOString() };
  const report = { tool: 'tools/difffuzz/run.mjs', protocol: PROTOCOL, run, status: 'incomplete', verification_time: VERIFICATION_TIME,
    sdk_campaign: !injected, injected_commands: Boolean(injected),
    options: { ...o, out: o.out && path.relative(ROOT, o.out) }, limits: { kit: KIT_LIMITS }, provenance_limits: PROVENANCE_LIMITS };
  const writeReport = () => { if (o.report) { fs.mkdirSync(path.dirname(path.resolve(o.report)), { recursive: true }); fs.writeFileSync(o.report, JSON.stringify(report, null, 2) + '\n'); } };
  writeReport();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dcp-difffuzz-'));
  const stats = { iterations: 0, jobs: 0, batches: 0, batch_failures: 0, retries: 0, agreements: 0, skipped_oversize: 0, jobs_not_run: 0,
    findings_suppressed: 0, from_valid: 0, by_mutator: {}, minimize_runs: 0, observed_classes: {},
    // Results received with a truncation marker, per SDK: observations (baseline, mutants, isolation retries and
    // minimization steps each count once per result), not unique cases.
    truncated_diagnostic_observations: Object.fromEntries(SDKS.map((s) => [s, 0])) };
  // Severity comes from every observation the driver receives (baseline, mutants and minimization steps), never
  // from the findings it had room to record: --max-findings limits files, not what a run is judged to be.
  let harnessSeen = false;
  const events = [];
  const findings = [];
  const full = () => findings.length >= o.maxFindings;
  let built = null;
  let exit = 0;
  let baselineComplete = false;
  try {
    if (injected) checkCommands(injected);
    report.inputs = runInputs({ seedsOverride });
    const { seeds, basePolicy } = seedsOverride ?? loadSeeds();
    const seedBytes = seeds.map((s) => Buffer.from(serialize(s.doc)));
    if (!seeds.length) throw new InfraError('no V2 signed bundles found');
    built = injected ? { steps: [], artifacts: null, commands: injected } : await buildShims(o, tmp);
    checkCommands(built.commands);
    report.build = { steps: built.steps, artifacts: built.artifacts };
    const cmds = built.commands;
    fs.mkdirSync(o.out, { recursive: true });

    const write = (finding) => {
      if (full()) { stats.findings_suppressed++; return null; }
      findings.push(finding);
      fs.writeFileSync(path.join(o.out, finding.file), JSON.stringify(finding, null, 2) + '\n');
      return finding;
    };

    // Runs jobs through every shim and waits for all of them, whatever fails; a failed batch is recorded, then each
    // job is rerun alone to find the culprit. The batch failure stays in the report and never lets the run pass.
    const execute = async (jobs) => {
      jobs.forEach((j) => { j.wireId = crypto.randomBytes(12).toString('hex'); });
      const outcomes = jobs.map(() => ({}));
      const settled = await Promise.allSettled(SDKS.map(async (sdk) => {
        stats.batches++;
        const b = await runBatch(cmds[sdk], jobs, o);
        const note = (r) => { if (r?.truncated) stats.truncated_diagnostic_observations[sdk]++; return r; };
        if (b.judged.ok) { jobs.forEach((j, i) => { outcomes[i][sdk] = note(b.judged.results.get(j.wireId)); }); return; }
        stats.batch_failures++;
        const event = { sdk, category: b.judged.category, detail: b.judged.detail, stderr: b.judged.stderr?.slice(0, 1000), jobs: jobs.length, isolated: [] };
        events.push(event);
        if (b.observed.spawn_error) throw new InfraError(`${sdk} shim cannot start: ${b.observed.spawn_error}`);
        if (jobs.length === 1) { outcomes[0][sdk] = { category: b.judged.category, message: b.judged.detail }; return; }
        for (let i = 0; i < jobs.length; i++) {
          if (stats.retries >= o.maxRetries) throw new InfraError(`retry budget of ${o.maxRetries} exhausted after a ${b.judged.category} batch failure of ${sdk}`);
          stats.retries++;
          const one = await runBatch(cmds[sdk], [jobs[i]], o);
          outcomes[i][sdk] = one.judged.ok ? note(one.judged.results.get(jobs[i].wireId)) : { category: one.judged.category, message: one.judged.detail };
          if (!one.judged.ok) event.isolated.push({ job: i, category: one.judged.category });
        }
        if (!event.isolated.length) {
          event.not_reproduced = true;
          const f = write({ file: `${o.seed}-batch-${sdk}-${findings.length + 1}.json`.replace(/[^\w.-]+/g, '_'), classes: ['batch_failure_not_reproduced'], kind: 'batch', sdk, event });
          if (f) log(`FINDING ${f.file}: a ${event.category} batch failure of ${sdk} that no single case reproduced`);
        }
      }));
      const rejected = settled.find((r) => r.status === 'rejected');
      if (rejected) throw rejected.reason;
      if (outcomes.some((o) => SDKS.some((s) => HARNESS_FAULTS.has(o[s]?.category)))) harnessSeen = true;
      return outcomes;
    };

    const baseline = new Map();
    const positiveControl = new Set();
    const baselineOf = (seed, mode) => baseline.get(`${seed}|${mode}`);
    const record = (job, outcomes, classes) => {
      const seed = seeds[job.seed];
      const file = `${o.seed}-${job.kind === 'baseline' ? 'baseline' : job.iteration}-${job.mode}-${findings.length + 1}.json`.replace(/[^\w.-]+/g, '_');
      const f = write({
        file, classes, kind: job.kind, iteration: job.iteration ?? null, seed_name: seed.name, basis: seed.basis, mode: job.mode, expect: job.expect,
        policy: job.policy, now_ms: NOW_MS, mutations: job.mutations ?? [], outcomes, build_artifacts: built.artifacts, inputs: report.inputs,
        input_sha256: sha256(job.bytes), input_bytes: job.bytes.length, input_b64: job.bytes.toString('base64'),
        // The original control: the unmutated seed's own bytes, policy, declared expectation and baseline outcomes.
        control: job.kind === 'mutant' ? {
          seed_name: seed.name, policy: job.policy, expect: typeof seed.expect?.(job.mode) === 'boolean' ? seed.expect(job.mode) : null,
          baseline_outcomes: baselineOf(job.seed, job.mode) ?? null,
          input_sha256: sha256(seedBytes[job.seed]), input_b64: seedBytes[job.seed].toString('base64'),
        } : null,
      });
      if (f) log(`FINDING ${file}: ${classes.join('+')} on ${seed.name} [${job.mode}] ${job.mutations?.map((m) => `${m.mutator}(${m.detail})`).join(' + ') ?? ''} -> ${Object.entries(outcomes).map(([s, v]) => `${s}=${sig(v)}`).join(' ')}`);
      return f;
    };
    const kept = [];
    const judgeAll = (jobs, outcomes) => {
      jobs.forEach((job, i) => {
        stats.jobs++;
        const classes = judgeJob(job, outcomes[i], baselineOf);
        for (const c of classes) stats.observed_classes[c] = (stats.observed_classes[c] || 0) + 1;
        if (job.kind === 'baseline') {
          baseline.set(`${job.seed}|${job.mode}`, outcomes[i]);
          if (!classes.length && SDKS.every((s) => outcomes[i][s].category === 'verdict' && outcomes[i][s].verified === true)) positiveControl.add(`${job.seed}|${job.mode}`);
        }
        if (!classes.length) { stats.agreements++; return; }
        const f = record(job, outcomes[i], classes);
        if (f && job.doc) kept.push({ finding: f, job });
      });
    };

    // Batches are cut by case count and by the exact UTF-8 size of the whole request. A seed never is skipped: a
    // baseline that does not fit is an infrastructure error; a mutant that does not fit is skipped and counted.
    const env = envelopeBytes(NOW_MS);
    const batcher = () => {
      let jobs = [];
      let bytes = 0;
      const flush = async () => {
        if (!jobs.length) return;
        const j = jobs;
        jobs = [];
        bytes = 0;
        if (full()) { stats.jobs_not_run += j.length; report.stopped_early = true; return; }
        judgeAll(j, await execute(j));
      };
      return {
        async add(job) {
          const w = caseWireBytes(job);
          if (job.bytes.length > o.caseBytes || env + w > o.batchBytes) {
            if (job.kind === 'baseline') throw new InfraError(`baseline seed ${seeds[job.seed].name} does not fit: ${job.bytes.length} input bytes (--case-bytes ${o.caseBytes}), a ${env + w}-byte request alone (--batch-bytes ${o.batchBytes})`);
            stats.skipped_oversize++;
            return;
          }
          if (jobs.length && (jobs.length >= o.batchCases || bytes + 1 + w > o.batchBytes)) await flush();
          bytes = jobs.length ? bytes + 1 + w : env + w;
          jobs.push(job);
        },
        flush,
      };
    };

    // Baseline: every seed under every selected mode, judged against its declared expectation.
    const base = batcher();
    for (let s = 0; s < seeds.length; s++) {
      for (const mode of o.modes) {
        const e = seeds[s].expect?.(mode);
        await base.add({ kind: 'baseline', seed: s, mode, policy: policyFor(basePolicy, mode, seeds[s].overrides), bytes: seedBytes[s], expect: typeof e === 'boolean' ? e : null });
      }
    }
    await base.flush();
    baselineComplete = !report.stopped_early;
    const validSeeds = seeds.map((_, i) => i).filter((i) => seeds[i].expect?.(o.modes[0]) === true);
    report.seeds = {
      total: seeds.length, normative: seeds.filter((s) => s.basis === 'normative').length, differential_only: seeds.filter((s) => s.basis !== 'normative').map((s) => s.name),
      declared_valid_in_first_mode: validSeeds.length, baseline_complete: baselineComplete,
    };
    if (!validSeeds.length && o.iterations > 0) throw new InfraError(`no seed is declared valid under ${o.modes[0]}: mutants would only start from rejected bundles`);
    log(`seeds: ${seeds.length} (${report.seeds.normative} with declared expectations, ${report.seeds.differential_only.length} differential-only); baseline findings: ${findings.length}`);

    // Mutants, generated batch by batch: only the current batch is held in memory.
    const r = makeRng(o.seed);
    const muts = makeMutators(r);
    const names = only ?? MUTATOR_NAMES;
    const mutants = batcher();
    for (let i = 1; i <= o.iterations && !full(); i++) {
      stats.iterations++;
      // A guaranteed quota, not a probability: every odd iteration starts from a seed declared valid in the first mode.
      const fromValid = i % 2 === 1;
      const s = fromValid ? r.pick(validSeeds) : r.randInt(seeds.length);
      if (seeds[s].expect?.(o.modes[0]) === true) stats.from_valid++;
      const doc = clone(seeds[s].doc);
      const mutations = [];
      const count = r.rand() < 0.7 ? 1 : 2;
      for (let tries = 0; mutations.length < count && tries < 20; tries++) {
        const name = r.pick(names);
        const detail = muts[name](doc);
        if (detail !== null) mutations.push({ mutator: name, detail });
      }
      if (!mutations.length) mutations.push({ mutator: 'none', detail: 'no eligible slot' });
      for (const m of mutations) stats.by_mutator[m.mutator] = (stats.by_mutator[m.mutator] || 0) + 1;
      const bytes = Buffer.from(serialize(doc));
      const reorderOnly = mutations.every((m) => m.mutator === 'reorder_keys');
      for (const mode of o.modes) {
        await mutants.add({ kind: 'mutant', iteration: i, seed: s, mode, policy: policyFor(basePolicy, mode, seeds[s].overrides), bytes, doc, mutations, reorderOnly, expect: null });
      }
      if (i % 100 === 0) log(`${i}/${o.iterations} iterations, ${findings.length} findings`);
    }
    await mutants.flush();
    if (full()) report.stopped_early = true;

    // Bounded minimization, only against a seed whose baseline in that mode was clean (a confirmed valid control).
    for (const { finding, job } of kept) {
      let skip = null;
      if (job.kind !== 'mutant') skip = 'not a mutant';
      else if (job.reorderOnly) skip = 'key order only';
      else if (finding.classes.some((c) => ['timeout', 'output_limit', 'protocol', 'unsupported'].includes(c))) skip = 'class not minimized (timeout, output limit or harness fault)';
      else if (!positiveControl.has(`${job.seed}|${job.mode}`)) skip = 'no valid positive control: the unmutated seed did not pass its baseline verified by the four SDKs in this mode';
      finding.minimization = skip ? { status: 'skipped', reason: skip } : await minimize(job, finding, seeds, baselineOf, execute, o, stats);
      fs.writeFileSync(path.join(o.out, finding.file), JSON.stringify(finding, null, 2) + '\n');
    }
    if (JSON.stringify(runInputs({ seedsOverride })) !== JSON.stringify(report.inputs)) throw new InfraError('the driver or the fixtures changed during the run');
    if (!injected) {
      const now = provenance(built.files, built.pythonRuntime);
      const changed = Object.keys(now).filter((k) => JSON.stringify(now[k]) !== JSON.stringify(built.artifacts[k]));
      if (changed.length) throw new InfraError(`inputs changed during the run: ${changed.join(', ')}`);
    }
    const harness = harnessSeen || findings.some((f) => f.classes.some((c) => HARNESS_FAULTS.has(c))) || events.some((e) => HARNESS_FAULTS.has(e.category));
    const failing = findings.length || events.length || stats.findings_suppressed || !baselineComplete;
    exit = harness ? 3 : failing ? 1 : 0;
    report.status = harness ? 'error' : failing ? 'findings' : 'pass';
    if (harness) report.error = { kind: 'harness', message: 'a shim answered outside the protocol or as unsupported, in a batch or alone: no verdict of that run can be trusted' };
  } catch (e) {
    exit = e instanceof UsageError ? 2 : 3;
    report.status = 'error';
    report.error = { kind: e instanceof InfraError ? 'infrastructure' : 'exception', message: e instanceof InfraError ? e.message : (e.stack ?? String(e)) };
    log(`${report.error.kind} error: ${e.message}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  Object.assign(report, { stats, events, findings: findings.map(({ input_b64: _, build_artifacts: __, ...f }) => f), exit });
  run.finished_at = new Date().toISOString();
  writeReport();
  log(`\nseed ${o.seed}: ${stats.iterations} iterations, ${stats.jobs} jobs in ${stats.batches} batch runs (${stats.batch_failures} failed, ${stats.retries} retries), ${stats.agreements} agreements, ${findings.length} findings, ${stats.from_valid}/${stats.iterations} from a declared-valid seed; exit ${exit}`);
  return { exit, report };
}

async function minimize(job, finding, seeds, baselineOf, execute, o, stats) {
  const seedDoc = seeds[job.seed].doc;
  const control = { kind: 'control', seed: job.seed, mode: job.mode, policy: job.policy, bytes: Buffer.from(serialize(seedDoc)) };
  // The failure class and its distribution: each SDK keeps its decision (accept, reject or its non-definitive category).
  const want = Object.fromEntries(Object.entries(finding.outcomes).map(([s, v]) => [s, decision(v)]));
  const base = baselineOf(job.seed, job.mode);
  let steps = 0;
  const reproduces = async (units) => {
    if (stats.minimize_runs >= o.minimizeTotal || steps >= o.minimizeSteps) return null;
    steps++;
    stats.minimize_runs++;
    const candidate = { kind: 'minimize', seed: job.seed, mode: job.mode, policy: job.policy, bytes: Buffer.from(serialize(applyUnits(seedDoc, units))) };
    const [got, ctl] = await execute([candidate, control]);
    const controlOk = SDKS.every((s) => isDefinitive(ctl[s]) && sig(ctl[s]) === sig(base[s]));
    return { same: controlOk && SDKS.every((s) => decision(got[s]) === want[s]), controlOk, bytes: candidate.bytes };
  };
  let units = diffUnits(seedDoc, job.doc);
  const first = await reproduces(units);
  if (!first) return { status: 'budget_exhausted', steps };
  if (!first.controlOk) return { status: 'control_failed', steps };
  if (!first.same) return { status: 'not_reproduced', steps };
  let bytes = first.bytes;
  let n = 2;
  while (units.length >= 2) {
    const chunk = Math.ceil(units.length / n);
    let reduced = false;
    for (let i = 0; i < units.length; i += chunk) {
      const rest = units.slice(0, i).concat(units.slice(i + chunk));
      if (!rest.length) continue;
      const r = await reproduces(rest);
      if (!r) return { status: 'budget_exhausted', steps, units: units.length, minimized_sha256: sha256(bytes), minimized_b64: bytes.toString('base64') };
      if (r.same) { units = rest; bytes = r.bytes; n = Math.max(n - 1, 2); reduced = true; break; }
    }
    if (!reduced) { if (n >= units.length) break; n = Math.min(units.length, n * 2); }
  }
  return { status: 'locally_minimal_within_budget', steps, units: units.length, paths: units.map((u) => fmtPath(u.path) || '<root>'), minimized_sha256: sha256(bytes), minimized_b64: bytes.toString('base64') };
}

// ── Replay of a finding: its bytes, policy and instant, with its own recorded control ──
const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
const decode = (b64, sha, what, bad) => {
  const bytes = decodeBase64Strict(b64);
  if (!bytes || sha256(bytes) !== sha) bad(`${what} is not canonical base64 or does not match its sha256`);
  return bytes;
};

/** A finding file, fully typed, with its classes derived again from its own outcomes. Throws an InfraError otherwise. */
export function checkFinding(f) {
  const bad = (why) => { throw new InfraError(`not a replayable finding: ${why}`); };
  if (!isObj(f)) bad('not an object');
  if (f.kind === 'batch') bad('a batch failure has no single input; rerun the campaign with its seed');
  if (!['baseline', 'mutant'].includes(f.kind)) bad('kind is neither baseline nor mutant');
  if (!Array.isArray(f.classes) || !f.classes.length || !f.classes.every((c) => CLASSES.has(c)) || new Set(f.classes).size !== f.classes.length) bad('classes are not a set of known classes');
  if (!isObj(f.policy) || !Number.isSafeInteger(f.now_ms) || typeof f.seed_name !== 'string' || !MODES.includes(f.mode)) bad('policy, now_ms, seed_name or mode missing or mistyped');
  if (!(f.expect === null || typeof f.expect === 'boolean') || (f.kind === 'mutant' && f.expect !== null)) bad('expect is not null or a boolean (always null for a mutant)');
  if (!Array.isArray(f.mutations) || !f.mutations.every((m) => exactKeys(m, ['mutator', 'detail']) && typeof m.mutator === 'string' && typeof m.detail === 'string')) bad('mutations are not {mutator, detail} strings');
  if (!validOutcomes(f.outcomes)) bad('the outcomes are not exactly four typed SDK outcomes');
  const input = decode(f.input_b64, f.input_sha256, 'input_b64', bad);
  let minimized = null;
  if (f.minimization?.minimized_b64 !== undefined) minimized = decode(f.minimization.minimized_b64, f.minimization.minimized_sha256, 'minimized_b64', bad);
  let control = null;
  if (f.kind === 'mutant') {
    const c = f.control;
    if (!exactKeys(c, ['seed_name', 'policy', 'expect', 'baseline_outcomes', 'input_sha256', 'input_b64'])) bad('a mutant finding records no original control');
    if (c.seed_name !== f.seed_name || JSON.stringify(c.policy) !== JSON.stringify(f.policy)) bad('the control names another seed or another policy');
    if (!(c.expect === null || typeof c.expect === 'boolean') || !validOutcomes(c.baseline_outcomes)) bad('the control expectation or baseline outcomes are not typed');
    if (judgeJob({ expect: c.expect }, c.baseline_outcomes, () => null).length) bad('the recorded control did not pass its own baseline');
    control = { bytes: decode(c.input_b64, c.input_sha256, 'control.input_b64', bad), expect: c.expect, baseline: c.baseline_outcomes };
  } else if (f.control !== null && f.control !== undefined) bad('a baseline finding is its own seed and records no separate control');
  const reorderOnly = f.kind === 'mutant' && f.mutations.length > 0 && f.mutations.every((m) => m.mutator === 'reorder_keys');
  const derived = judgeJob({ expect: f.expect, reorderOnly }, f.outcomes, () => control?.baseline ?? null);
  if (!sameSet(derived, f.classes)) bad(`the recorded classes ${JSON.stringify(f.classes)} are not those of its own outcomes ${JSON.stringify(derived)}`);
  return { input, minimized, control };
}

/**
 * Replays a finding through the four shims, at its own now_ms and under its own policy, with its own recorded control
 * (the original seed bytes, never the current fixture of that name) in the same batch. Differences from the recorded
 * build, driver and fixtures are reported as provenance differences. Exit 0: the recorded decisions reproduce and the
 * control reproduces its baseline; 1: they do not reproduce; 3: the finding, the control or the infrastructure does
 * not allow a judgement.
 */
export async function replayFinding(o, { commands: injected, seedsOverride, log = console.log } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dcp-difffuzz-'));
  const out = { replay: o.replay, run_id: crypto.randomUUID() };
  try {
    const f = JSON.parse(fs.readFileSync(o.replay, 'utf8'));
    const { input, minimized, control } = checkFinding(f);
    if (injected) checkCommands(injected);
    const built = injected ? { commands: injected, artifacts: null } : await buildShims(o, tmp);
    checkCommands(built.commands);
    // Provenance differences are recorded, never repaired: the current fixture of the same name is not the control.
    const changed = [];
    const inputs = runInputs({ seedsOverride });
    for (const [k, v] of Object.entries({ build: [f.build_artifacts, built.artifacts], driver: [f.inputs?.driver, inputs.driver], fixtures: [f.inputs?.fixtures, inputs.fixtures] })) {
      if (v[0] === undefined || v[0] === null || v[1] === null) changed.push(`${k}:not_recorded`);
      else if (k === 'build') changed.push(...Object.keys({ ...v[0], ...v[1] }).filter((a) => JSON.stringify(v[0][a]) !== JSON.stringify(v[1][a])).map((a) => `build:${a}`));
      else if (JSON.stringify(v[0]) !== JSON.stringify(v[1])) changed.push(k);
    }
    const current = (seedsOverride ?? loadSeeds()).seeds.find((s) => s.name === f.seed_name);
    const recordedSeed = f.kind === 'mutant' ? f.control.input_sha256 : f.input_sha256;
    if (!current) changed.push(`fixture_seed_missing:${f.seed_name}`);
    else if (sha256(Buffer.from(serialize(current.doc))) !== recordedSeed) changed.push(`fixture_seed_changed:${f.seed_name}`);
    out.provenance_differences = changed;
    const jobs = [
      { name: 'input', bytes: input, policy: f.policy },
      ...(minimized ? [{ name: 'minimized', bytes: minimized, policy: f.policy }] : []),
      ...(control ? [{ name: 'control', bytes: control.bytes, policy: f.policy }] : []),
    ];
    jobs.forEach((j) => { j.wireId = crypto.randomBytes(12).toString('hex'); });
    const results = Object.fromEntries(jobs.map((j) => [j.name, {}]));
    const settled = await Promise.allSettled(SDKS.map(async (sdk) => {
      const b = await runBatch(built.commands[sdk], jobs, o, f.now_ms);
      if (!b.judged.ok) throw new InfraError(`${sdk}: ${b.judged.category}: ${b.judged.detail}`);
      for (const j of jobs) results[j.name][sdk] = b.judged.results.get(j.wireId);
    }));
    const rejected = settled.find((r) => r.status === 'rejected');
    if (rejected) throw rejected.reason;
    out.results = results;
    const same = (got, recorded) => SDKS.every((s) => decision(got[s]) === decision(recorded[s]));
    if (control) {
      const ok = same(results.control, control.baseline) && (control.expect === null || SDKS.every((s) => results.control[s].category === 'verdict' && results.control[s].verified === control.expect));
      out.control = ok ? 'reproduced' : 'not_reproduced';
      if (!ok) throw new InfraError('the recorded control did not reproduce its baseline: the replay cannot be judged');
    } else {
      out.control = 'not applicable: a baseline finding is the unmutated seed itself';
    }
    out.input = same(results.input, f.outcomes) ? 'reproduced' : 'not_reproduced';
    if (minimized) out.minimized = same(results.minimized, f.outcomes) ? 'reproduced' : 'not_reproduced';
    out.exit = out.input === 'reproduced' && out.minimized !== 'not_reproduced' ? 0 : 1;
  } catch (e) {
    out.exit = 3;
    out.error = e instanceof InfraError ? e.message : (e.stack ?? String(e));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  log(JSON.stringify(out, null, 2));
  return { exit: out.exit, report: out };
}
