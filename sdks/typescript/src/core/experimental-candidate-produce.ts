/**
 * EXPERIMENTAL, opt-in (candidate `dcp-jcs-v2`, phase 4): producers of new candidate evidence.
 *
 * - experimentalCandidateSignPayload signs one artifact `{payload, payload_hash, composite_sig}`. It
 *   signs no profile: the artifact has the form and the domain context of today's artifacts.
 * - experimentalCandidateSignBundle assembles a bundle whose new manifest commits to
 *   `canonicalization_profile: "dcp-jcs-v2"`, and signs that manifest.
 *
 * Inputs are `{ bytes }` (original bytes, checked by the phase 1 ingress before anything parses them:
 * the way for JSON received from elsewhere) or `{ value }` (a host value, checked and copied by a strict
 * walk; it cannot recover the literal a parser read it from). Rejections of this experimental contract
 * are ExperimentalCandidateProduceError, raised before any signer is called; they are not a normative
 * activation of the profile. Errors of the key, the registry or the provider stay today's errors, with
 * no rollback promised for a signature already made. Every function copies all its inputs, options and
 * key labels before its first await; getters and toJSON are never invoked.
 *
 * Nothing here relabels received evidence or recomputes a received commitment: an artifact whose
 * payload_hash is not the hash of its payload is refused, and an audit chain must start at GENESIS and
 * link. Builders, signers and verifiers of dcp-jcs-v1 are unchanged; only their primitives are reused.
 */

import type { CompositeKeyInfo } from './composite-ops.js';
import { classicalOnlySign, compositeSign } from './composite-ops.js';
import type { CompositeSignature } from './composite-sig.js';
import type { AlgorithmRegistry } from './crypto-registry.js';
import { canonicalizeV2 } from './canonicalize.js';
import { DCP_CONTEXTS } from './domain-separation.js';
import { dualHashCanonical, dualMerkleRoot, sha256Hex } from './dual-hash.js';
import {
  ExperimentalCandidateInternalError,
  experimentalCandidateIngress,
} from './experimental-candidate-ingress.js';
import type { ExperimentalCandidateValue } from './experimental-candidate-ingress.js';
import {
  createExperimentalCandidateRouter,
  experimentalHistoricalAdapters,
} from './experimental-candidate-router.js';
import { isValidSessionNonce, parseRfc3339, verifySessionBinding } from './session-nonce.js';
import { preparePayload } from './signed-payload.js';

const MAX_SAFE = 9007199254740991; // 2^53-1
const MAX_DEPTH = 64;
const ZEROS = '0'.repeat(64);

export type ExperimentalCandidateProduceClass =
  | 'BOM'
  | 'UTF8_INVALID'
  | 'SYNTAX'
  | 'SURROGATE_UNPAIRED'
  | 'DUPLICATE_KEY'
  | 'NUMBER_NOT_INTEGER'
  | 'NUMBER_OUT_OF_RANGE'
  | 'DEPTH_EXCEEDED'
  | 'NUMBER_NOT_FINITE'
  | 'TYPE_UNSUPPORTED'
  | 'COMMITMENT_MISMATCH'
  | 'CHAIN_NOT_GENESIS'
  | 'CHAIN_BREAK'
  | 'SIGNER_MISMATCH'
  | 'SESSION_INVALID'
  | 'SESSION_ISSUED_AT_REQUIRED';

/**
 * A rejection of the experimental producer contract, raised before any signer is called. `part` names
 * the input; `offset` is a byte offset in that input's bytes, `path` a JSON Pointer in its value.
 */
export class ExperimentalCandidateProduceError extends Error {
  readonly class: ExperimentalCandidateProduceClass;
  readonly part: string;
  readonly path: string | null;
  readonly offset: number | null;

  constructor(cls: ExperimentalCandidateProduceClass, part: string, path: string | null, offset: number | null = null) {
    super(`${cls} in ${part}${path === null ? '' : ` at ${path === '' ? '/' : path}`}${offset === null ? '' : ` (byte ${offset})`}`);
    this.name = 'ExperimentalCandidateProduceError';
    this.class = cls;
    this.part = part;
    this.path = path;
    this.offset = offset;
  }
}

/** Original bytes, or a host value. */
export type ExperimentalCandidateInput = { bytes: Uint8Array } | { value: unknown };

/** The signing keys: hybrid with `pq`, classical-only without. */
export type ExperimentalCandidateKeys = { classical: CompositeKeyInfo; pq?: CompositeKeyInfo };

export type ExperimentalCandidateSignedPayload = {
  payload: ExperimentalCandidateValue;
  payload_hash: string;
  composite_sig: ExperimentalCandidateValue;
} & Record<string, ExperimentalCandidateValue>;

export type ExperimentalCandidateBundleParts = {
  rpr: ExperimentalCandidateInput;
  passport: ExperimentalCandidateInput;
  intent: ExperimentalCandidateInput;
  policyDecision: ExperimentalCandidateInput;
  auditEntries: ExperimentalCandidateInput[];
  pqCheckpoints?: ExperimentalCandidateInput[];
};

export type ExperimentalCandidateBundleSigner = {
  signerType: string;
  signerId: string;
  keys: ExperimentalCandidateKeys;
};

export type ExperimentalCandidateBundleOptions = {
  sessionNonce: string;
  sessionIssuedAt?: string;
  sessionExpiresAt?: string;
  intendedVerifier?: string;
  /** Adds audit_merkle_root_secondary (SHA3-256) and signs with hash_alg sha256+sha3-256. Default false. */
  dualHash?: boolean;
  /** signature.created_at: outside every signature, not protected. Default: the clock. */
  createdAt?: string;
};

type Obj = { [key: string]: ExperimentalCandidateValue };

// ── Reading parameters and host values (descriptors only: no getter or toJSON is ever invoked) ──

const usage = (message: string) => new TypeError(`experimental candidate producer: ${message}`);

function describe(e: unknown): string {
  try {
    return e instanceof Error ? `${e.name}: ${e.message}` : typeof e;
  } catch {
    return 'an unprintable value';
  }
}

/** Runs an inspection; anything it throws that is not a rejection is a usage error. */
function inspecting<T>(what: string, run: () => T): T {
  try {
    return run();
  } catch (e) {
    if (e instanceof ExperimentalCandidateProduceError || e instanceof TypeError) throw e;
    throw usage(`inspecting ${what} threw ${describe(e)}`);
  }
}

/**
 * The own data properties of a parameter object, present ones included even when undefined (an
 * optional parameter reads undefined as absent; the bytes/value discriminant does not). An accessor or
 * an unknown member is a usage error.
 */
function params(v: unknown, what: string, allowed: readonly string[]): Map<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw usage(`${what} must be an object`);
  const out = new Map<string, unknown>();
  for (const key of Reflect.ownKeys(v)) {
    if (typeof key !== 'string' || !allowed.includes(key)) throw usage(`${what} has an unknown member ${String(key)}`);
    const d = Object.getOwnPropertyDescriptor(v, key)!;
    if (!('value' in d)) throw usage(`${what}.${key} must be a data property`);
    out.set(key, d.value);
  }
  return out;
}

/** The elements of a parameter array: closed (no hole, no other member), each a data element. */
function elements(v: unknown, what: string): unknown[] {
  if (!Array.isArray(v) || Object.getPrototypeOf(v) !== Array.prototype) throw usage(`${what} must be an array`);
  const length = v.length;
  if (Reflect.ownKeys(v).length !== length + 1) throw usage(`${what} must have no hole and no member other than its elements`);
  return Array.from({ length }, (_, i) => {
    const d = Object.getOwnPropertyDescriptor(v, String(i));
    if (d === undefined || !('value' in d)) throw usage(`${what}[${i}] must be a data element`);
    return d.value;
  });
}

// The intrinsic accessors of %TypedArray%.prototype: a subclass, a Buffer or an own member cannot replace them.
const TYPED_ARRAY = Object.getPrototypeOf(Uint8Array.prototype) as object;
const intrinsic = (key: PropertyKey) => Object.getOwnPropertyDescriptor(TYPED_ARRAY, key)!.get!;
const typedTag = intrinsic(Symbol.toStringTag);
const typedBuffer = intrinsic('buffer');
const typedOffset = intrinsic('byteOffset');
const typedLength = intrinsic('byteLength');

/**
 * A private copy of a Uint8Array (a Buffer or a subclass included), read through the intrinsic
 * accessors over its own memory: no slice, iterator, length getter or other member of the input runs.
 */
function ownBytes(v: unknown, what: string): Uint8Array {
  if (typedTag.call(v) !== 'Uint8Array') throw usage(`${what} must be a Uint8Array`);
  const view = new Uint8Array(typedBuffer.call(v), typedOffset.call(v), typedLength.call(v));
  return new Uint8Array(view);
}

function isWellFormed(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = s.charCodeAt(i + 1);
      if (!(n >= 0xdc00 && n <= 0xdfff)) return false;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return false;
    }
  }
  return true;
}

const pointer = (path: string, key: string | number) =>
  `${path}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;

/**
 * A host value checked against the exact domain and copied (objects with a null prototype, so that a
 * key such as `__proto__` stays data), at most MAX_DEPTH levels deep.
 */
function exactCopy(v: unknown, part: string, path: string, depth: number): ExperimentalCandidateValue {
  const reject = (cls: ExperimentalCandidateProduceClass, at = path) => new ExperimentalCandidateProduceError(cls, part, at);
  switch (typeof v) {
    case 'boolean':
      return v;
    case 'string':
      if (!isWellFormed(v)) throw reject('SURROGATE_UNPAIRED');
      return v;
    case 'number':
      if (!Number.isFinite(v)) throw reject('NUMBER_NOT_FINITE');
      if (!Number.isInteger(v)) throw reject('NUMBER_NOT_INTEGER');
      if (Math.abs(v) > MAX_SAFE) throw reject('NUMBER_OUT_OF_RANGE');
      return v === 0 ? 0 : v; // -0 is 0
    case 'bigint':
      if (v > BigInt(MAX_SAFE) || v < -BigInt(MAX_SAFE)) throw reject('NUMBER_OUT_OF_RANGE');
      return Number(v);
    case 'object':
      break;
    default:
      throw reject('TYPE_UNSUPPORTED'); // undefined, functions (toJSON as a method), symbols
  }
  if (v === null) return null;
  if (depth + 1 > MAX_DEPTH) throw reject('DEPTH_EXCEEDED');
  const proto = Object.getPrototypeOf(v);
  const keys = Reflect.ownKeys(v);
  if (Array.isArray(v)) {
    if (proto !== Array.prototype) throw reject('TYPE_UNSUPPORTED');
    const length = v.length;
    if (keys.length !== length + 1) throw reject('TYPE_UNSUPPORTED'); // a hole, or a member that is not an index
    const out: ExperimentalCandidateValue[] = [];
    for (let i = 0; i < length; i++) {
      const d = Object.getOwnPropertyDescriptor(v, String(i));
      if (d === undefined || !('value' in d) || !d.enumerable) throw reject('TYPE_UNSUPPORTED', pointer(path, i));
      out.push(exactCopy(d.value, part, pointer(path, i), depth + 1));
    }
    return out;
  }
  if (proto !== Object.prototype && proto !== null) throw reject('TYPE_UNSUPPORTED'); // Date, Map, class instances
  const out: Obj = Object.create(null);
  for (const key of keys) {
    if (typeof key !== 'string') throw reject('TYPE_UNSUPPORTED');
    const at = pointer(path, key);
    if (!isWellFormed(key)) throw reject('SURROGATE_UNPAIRED', at);
    const d = Object.getOwnPropertyDescriptor(v, key)!;
    if (!('value' in d) || !d.enumerable) throw reject('TYPE_UNSUPPORTED', at); // accessors are never invoked
    out[key] = exactCopy(d.value, part, at, depth + 1);
  }
  return out;
}

/** An input `{ bytes }` or `{ value }`, checked and copied now. */
function readInput(input: unknown, part: string, path = ''): ExperimentalCandidateValue {
  const p = inspecting(part, () => params(input, part, ['bytes', 'value']));
  if (p.size !== 1) throw usage(`${part} must have exactly one of bytes and value`);
  if (p.has('bytes')) {
    const bytes = inspecting(`${part}.bytes`, () => ownBytes(p.get('bytes'), `${part}.bytes`));
    const r = experimentalCandidateIngress(bytes);
    if (r.status === 'reject') throw new ExperimentalCandidateProduceError(r.class, part, path === '' ? null : path, r.offset);
    return r.value;
  }
  return inspecting(part, () => exactCopy(p.get('value'), part, path, 0));
}

const isObj = (v: ExperimentalCandidateValue): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o: Obj, key: string): ExperimentalCandidateValue | undefined =>
  Object.hasOwn(o, key) ? o[key] : undefined;

/** The pointer of the first container that opens a level beyond `limit`, or null. */
function tooDeep(v: ExperimentalCandidateValue, limit: number, path = '', depth = 0): string | null {
  if (v === null || typeof v !== 'object') return null;
  if (depth + 1 > limit) return path;
  for (const [k, x] of Array.isArray(v) ? v.entries() : Object.entries(v)) {
    const found = tooDeep(x, limit, pointer(path, k), depth + 1);
    if (found !== null) return found;
  }
  return null;
}

/** The keys, with their labels checked (they end up in the signed unit); the secrets stay the provider's. */
function readKeys(keys: unknown, part: string): ExperimentalCandidateKeys {
  return inspecting(part, () => {
    const p = params(keys, part, ['classical', 'pq']);
    const one = (name: 'classical' | 'pq'): CompositeKeyInfo => {
      const k = params(p.get(name), `${part}.${name}`, ['kid', 'alg', 'secretKeyB64', 'publicKeyB64']);
      for (const field of ['kid', 'alg', 'secretKeyB64', 'publicKeyB64']) {
        if (typeof k.get(field) !== 'string') throw usage(`${part}.${name}.${field} must be a string`);
      }
      for (const label of ['kid', 'alg']) {
        if (!isWellFormed(k.get(label) as string)) {
          throw new ExperimentalCandidateProduceError('SURROGATE_UNPAIRED', part, `/${name}/${label}`);
        }
      }
      return { kid: k.get('kid'), alg: k.get('alg'), secretKeyB64: k.get('secretKeyB64'), publicKeyB64: k.get('publicKeyB64') } as CompositeKeyInfo;
    };
    if (p.get('classical') === undefined) throw usage(`${part}.classical is required`);
    return p.get('pq') !== undefined ? { classical: one('classical'), pq: one('pq') } : { classical: one('classical') };
  });
}

/** A string parameter that ends up in the signed unit (or beside it): its type, then its domain. */
function label(v: unknown, part: string, path: string, required: boolean): string | undefined {
  if (v === undefined && !required) return undefined;
  if (typeof v !== 'string' || v.length === 0) throw usage(`${part}${path} must be a non-empty string`);
  if (!isWellFormed(v)) throw new ExperimentalCandidateProduceError('SURROGATE_UNPAIRED', part, path);
  return v;
}

const CONTEXTS: readonly string[] = Object.values(DCP_CONTEXTS);

const toExact = (v: unknown): ExperimentalCandidateValue => exactCopy(v, 'internal', '', 0);

const encode = (canonical: string) => new TextEncoder().encode(canonical);

async function signWith(
  registry: AlgorithmRegistry,
  context: string,
  bytes: Uint8Array,
  keys: ExperimentalCandidateKeys,
): Promise<CompositeSignature> {
  return keys.pq
    ? compositeSign(registry, context, bytes, { classical: keys.classical, pq: keys.pq })
    : classicalOnlySign(registry, context, bytes, keys.classical);
}

// ── signPayload ──

/**
 * EXPERIMENTAL, opt-in (candidate `dcp-jcs-v2`, phase 4): signs one artifact under `context` (one of
 * DCP_CONTEXTS) over the canonical bytes of the payload's exact value. The payload must be an object
 * and the artifact must fit in 64 levels (the payload in 63): its own bytes go through the ingress. It
 * returns the artifact's canonical bytes, usable as a `{ bytes }` part of the bundle, and its value.
 */
export async function experimentalCandidateSignPayload(
  registry: AlgorithmRegistry,
  context: string,
  input: ExperimentalCandidateInput,
  keys: ExperimentalCandidateKeys,
): Promise<{ bytes: Uint8Array; signedPayload: ExperimentalCandidateSignedPayload }> {
  // The snapshot and every check, before the first await.
  if (typeof context !== 'string' || !CONTEXTS.includes(context)) throw usage('context must be one of DCP_CONTEXTS');
  const k = readKeys(keys, 'keys');
  const payload = readInput(input, 'payload');
  if (!isObj(payload)) throw new ExperimentalCandidateProduceError('TYPE_UNSUPPORTED', 'payload', '');
  const deep = tooDeep(payload, MAX_DEPTH - 1);
  if (deep !== null) throw new ExperimentalCandidateProduceError('DEPTH_EXCEEDED', 'payload', deep);
  const { canonicalBytes, payloadHash } = preparePayload(payload);

  const compositeSig = await signWith(registry, context, canonicalBytes, k);

  const signedPayload = Object.assign(Object.create(null), {
    payload,
    payload_hash: payloadHash,
    composite_sig: toExact(compositeSig),
  }) as ExperimentalCandidateSignedPayload;
  const bytes = encode(canonicalizeV2(signedPayload));
  const again = experimentalCandidateIngress(bytes);
  if (again.status !== 'accept' || again.canonicalSha256 !== sha256Hex(bytes)) {
    throw new ExperimentalCandidateInternalError('a signed artifact the candidate ingress does not give back as is');
  }
  return { bytes, signedPayload };
}

// ── signBundle ──

const ARTIFACTS = [
  ['rpr', 'responsible_principal_record', 'rpr_hash'],
  ['passport', 'agent_passport', 'passport_hash'],
  ['intent', 'intent', 'intent_hash'],
  ['policyDecision', 'policy_decision', 'policy_hash'],
] as const;

/** A received or produced artifact: an object with an object payload, its own payload_hash and a composite_sig. */
function readArtifact(input: unknown, part: string): Obj {
  const a = readInput(input, part);
  if (!isObj(a)) throw new ExperimentalCandidateProduceError('TYPE_UNSUPPORTED', part, '');
  const payload = own(a, 'payload');
  if (payload === undefined || !isObj(payload)) throw new ExperimentalCandidateProduceError('TYPE_UNSUPPORTED', part, '/payload');
  const sig = own(a, 'composite_sig');
  if (sig === undefined || !isObj(sig)) throw new ExperimentalCandidateProduceError('TYPE_UNSUPPORTED', part, '/composite_sig');
  // The received commitment is checked, never recomputed into the artifact.
  if (own(a, 'payload_hash') !== preparePayload(payload).payloadHash) {
    throw new ExperimentalCandidateProduceError('COMMITMENT_MISMATCH', part, '/payload_hash');
  }
  return a;
}

const entryHash = (e: ExperimentalCandidateValue) => `sha256:${sha256Hex(Buffer.from(canonicalizeV2(e), 'utf8'))}`;

/**
 * EXPERIMENTAL, opt-in (candidate `dcp-jcs-v2`, phase 4): assembles a bundle from its parts and signs
 * a new manifest that commits to `canonicalization_profile: "dcp-jcs-v2"`. Every part is copied whole:
 * members it does not know (in a payload, an audit entry, a checkpoint, an artifact or a composite_sig)
 * are kept; those outside a payload, an entry, a checkpoint or the manifest are not signed, so their
 * integrity is not claimed. An empty audit trail has audit_count 0 and the root of 64 zeros, as the
 * verifiers expect (VERIFICATION.md V2-3). The session start is never stamped from the clock: with an
 * expiry, sessionIssuedAt is required. It returns the unit's canonical bytes and its value.
 */
export async function experimentalCandidateSignBundle(
  registry: AlgorithmRegistry,
  parts: ExperimentalCandidateBundleParts,
  signer: ExperimentalCandidateBundleSigner,
  options: ExperimentalCandidateBundleOptions,
): Promise<{ bytes: Uint8Array; signedBundle: Obj }> {
  // The snapshot and every check, before the first await.
  const o = inspecting('options', () => params(options, 'options', ['sessionNonce', 'sessionIssuedAt', 'sessionExpiresAt', 'intendedVerifier', 'dualHash', 'createdAt']));
  const s = inspecting('signer', () => params(signer, 'signer', ['signerType', 'signerId', 'keys']));
  const p = inspecting('parts', () => params(parts, 'parts', ['rpr', 'passport', 'intent', 'policyDecision', 'auditEntries', 'pqCheckpoints']));
  for (const name of ['rpr', 'passport', 'intent', 'policyDecision', 'auditEntries']) {
    if (p.get(name) === undefined) throw usage(`parts.${name} is required`);
  }
  if (s.get('keys') === undefined) throw usage('signer.keys is required');

  const signerType = label(s.get('signerType'), 'signer', '/signerType', true)!;
  const signerId = label(s.get('signerId'), 'signer', '/signerId', true)!;
  const keys = readKeys(s.get('keys'), 'signer.keys');
  const nonce = o.get('sessionNonce');
  if (typeof nonce !== 'string') throw usage('options.sessionNonce must be a string');
  if (!isValidSessionNonce(nonce)) throw new ExperimentalCandidateProduceError('SESSION_INVALID', 'options', '/sessionNonce');
  const issuedAt = label(o.get('sessionIssuedAt'), 'options', '/sessionIssuedAt', false);
  const expiresAt = label(o.get('sessionExpiresAt'), 'options', '/sessionExpiresAt', false);
  const intendedVerifier = label(o.get('intendedVerifier'), 'options', '/intendedVerifier', false);
  const dualHash = o.get('dualHash') === undefined ? false : o.get('dualHash'); // null is not absent
  if (typeof dualHash !== 'boolean') throw usage('options.dualHash must be a boolean');
  const createdAtGiven = label(o.get('createdAt'), 'options', '/createdAt', false);
  if (createdAtGiven !== undefined && parseRfc3339(createdAtGiven) === undefined) throw usage('options.createdAt must be an RFC 3339 date');
  const createdAt = createdAtGiven ?? new Date().toISOString();
  const issued = issuedAt === undefined ? undefined : parseRfc3339(issuedAt);
  const expires = expiresAt === undefined ? undefined : parseRfc3339(expiresAt);
  if (issuedAt !== undefined && issued === undefined) throw new ExperimentalCandidateProduceError('SESSION_INVALID', 'options', '/sessionIssuedAt');
  if (expiresAt !== undefined && expires === undefined) throw new ExperimentalCandidateProduceError('SESSION_INVALID', 'options', '/sessionExpiresAt');
  if (expiresAt !== undefined && issuedAt === undefined) throw new ExperimentalCandidateProduceError('SESSION_ISSUED_AT_REQUIRED', 'options', '/sessionIssuedAt');
  if (issued !== undefined && expires !== undefined && issued > expires) throw new ExperimentalCandidateProduceError('SESSION_INVALID', 'options', '/sessionExpiresAt');

  const artifacts = ARTIFACTS.map(([part]) => readArtifact(p.get(part), part));
  const list = (name: string): unknown[] =>
    inspecting(`parts.${name}`, () => (p.get(name) === undefined ? [] : elements(p.get(name), `parts.${name}`)));
  const entries = list('auditEntries').map((e, i) => {
    const v = readInput(e, 'auditEntries', `/${i}`);
    if (!isObj(v)) throw new ExperimentalCandidateProduceError('TYPE_UNSUPPORTED', 'auditEntries', `/${i}`);
    return v;
  });
  const checkpoints = list('pqCheckpoints').map((c, i) => {
    const v = readInput(c, 'pqCheckpoints', `/${i}`);
    if (!isObj(v) || typeof own(v, 'checkpoint_id') !== 'string') {
      throw new ExperimentalCandidateProduceError('TYPE_UNSUPPORTED', 'pqCheckpoints', `/${i}`);
    }
    return v;
  });

  // The chain is checked, never inferred or repaired: a new chain starts at GENESIS.
  entries.forEach((e, i) => {
    const expected = i === 0 ? 'GENESIS' : entryHash(entries[i - 1]);
    if (own(e, 'prev_hash') !== expected) {
      throw new ExperimentalCandidateProduceError(i === 0 ? 'CHAIN_NOT_GENESIS' : 'CHAIN_BREAK', 'auditEntries', `/${i}/prev_hash`);
    }
  });
  const binding = verifySessionBinding([
    ...artifacts.map((a) => own(a, 'payload') as { session_nonce?: string }),
    ...(entries as Array<{ session_nonce?: string }>),
    ...(checkpoints as Array<{ session_nonce?: string }>),
  ]);
  if (!binding.valid || binding.nonce !== nonce) throw new ExperimentalCandidateProduceError('SESSION_INVALID', 'parts', null);
  if (own(own(artifacts[0], 'payload') as Obj, 'human_id') !== signerId) {
    throw new ExperimentalCandidateProduceError('SIGNER_MISMATCH', 'signer', '/signerId');
  }

  const roots = dualMerkleRoot(entries.map((e) => dualHashCanonical(canonicalizeV2(e))));
  const manifest: Obj = Object.create(null);
  Object.assign(manifest, {
    session_nonce: nonce,
    rpr_hash: own(artifacts[0], 'payload_hash'),
    passport_hash: own(artifacts[1], 'payload_hash'),
    intent_hash: own(artifacts[2], 'payload_hash'),
    policy_hash: own(artifacts[3], 'payload_hash'),
    audit_merkle_root: `sha256:${roots?.sha256 ?? ZEROS}`,
    audit_count: entries.length,
    canonicalization_profile: 'dcp-jcs-v2',
  });
  if (dualHash) manifest.audit_merkle_root_secondary = `sha3-256:${roots?.sha3_256 ?? ZEROS}`;
  if (checkpoints.length > 0) manifest.pq_checkpoints = checkpoints.map((c) => own(c, 'checkpoint_id')!);
  if (issuedAt !== undefined) manifest.session_issued_at = issuedAt;
  if (expiresAt !== undefined) manifest.session_expires_at = expiresAt;
  if (intendedVerifier !== undefined) manifest.intended_verifier = intendedVerifier;

  const bundle: Obj = Object.create(null);
  Object.assign(bundle, { dcp_bundle_version: '2.0', manifest });
  ARTIFACTS.forEach(([, member], i) => (bundle[member] = artifacts[i]));
  bundle.audit_entries = entries;
  if (checkpoints.length > 0) bundle.pq_checkpoints = checkpoints;

  const kids = keys.pq ? [keys.classical.kid, keys.pq.kid] : [keys.classical.kid];
  const signatureWith = (manifestHash: string, compositeSig: ExperimentalCandidateValue): Obj =>
    toExact({
      hash_alg: dualHash ? 'sha256+sha3-256' : 'sha256',
      created_at: createdAt,
      signer: { type: signerType, id: signerId, kids },
      manifest_hash: manifestHash,
      composite_sig: compositeSig,
    }) as Obj;
  // The final unit's skeleton, its signature included, must fit in 64 levels before anything is signed.
  const entry = (k: CompositeKeyInfo) => ({ alg: k.alg, kid: k.kid, sig_b64: '' });
  const skeleton = Object.assign(Object.create(null), {
    bundle,
    signature: signatureWith(`sha256:${ZEROS}`, toExact({
      classical: entry(keys.classical),
      pq: keys.pq ? entry(keys.pq) : null,
      binding: keys.pq ? 'pq_over_classical' : 'classical_only',
    })),
  });
  const deep = tooDeep(skeleton, MAX_DEPTH);
  if (deep !== null) throw new ExperimentalCandidateProduceError('DEPTH_EXCEEDED', 'unit', deep);
  const manifestBytes = encode(canonicalizeV2(manifest));
  const manifestHash = `sha256:${sha256Hex(manifestBytes)}`;

  const compositeSig = await signWith(registry, DCP_CONTEXTS.Bundle, manifestBytes, keys);

  const signedBundle: Obj = Object.create(null);
  Object.assign(signedBundle, { bundle, signature: signatureWith(manifestHash, toExact(compositeSig)) });
  const bytes = encode(canonicalizeV2(signedBundle));
  const route = createExperimentalCandidateRouter({
    transport: 'bare',
    acceptedProfiles: ['dcp-jcs-v2'],
    historical: experimentalHistoricalAdapters.bufferUtf8JsonParse,
  }).route(bytes);
  if (route.outcome !== 'candidate' || route.canonicalSha256 !== sha256Hex(bytes)) {
    throw new ExperimentalCandidateInternalError('a produced unit the candidate route does not give back as is');
  }
  return { bytes, signedBundle };
}
