/**
 * EXPERIMENTAL, opt-in (inactive candidate dcp-jcs-v2, phase 4): the wasm producers, exposed as
 * DcpWasm.experimentalCandidateSignPayload and experimentalCandidateSignBundle. Internal module: the
 * package entry point re-exports only the error class.
 *
 * `{ bytes }` inputs are copied through the intrinsic %TypedArray% accessors (no slice, iterator or
 * other member of the input runs) and reach the binding as they are: every piece keeps its own bytes,
 * never nested in a request, so the ingress sees the original bytes and the depth budget is the final
 * unit's. `{ value }` inputs are checked and copied here by the strict walk of the TypeScript SDK (no
 * getter or toJSON invoked, holes and foreign types refused, safe integers only) and encoded only after
 * that check. The binding then signs no profile in an artifact and commits the new manifest to
 * dcp-jcs-v2; its rejections come back as ExperimentalWasmCandidateProduceError.
 */

const MAX_SAFE = 9007199254740991;
const MAX_DEPTH = 64;

/** A rejection of the experimental producer contract, raised before any signer is called. */
export class ExperimentalWasmCandidateProduceError extends Error {
  readonly class: string;
  readonly part: string;
  readonly path: string | null;
  readonly offset: number | null;

  constructor(cls: string, part: string, path: string | null, offset: number | null = null) {
    super(`${cls} in ${part}${path === null ? '' : ` at ${path === '' ? '/' : path}`}${offset === null ? '' : ` (byte ${offset})`}`);
    this.name = 'ExperimentalWasmCandidateProduceError';
    this.class = cls;
    this.part = part;
    this.path = path;
    this.offset = offset;
  }
}

/** The bindings the producers call; the tests count them. */
export type CandidateProduceBindings = {
  signPayload(payload: Uint8Array, context: string, keys: string): string;
  signBundle(pieces: Uint8Array, layout: string, signer: string, options: string): string;
};

const usage = (message: string) => new TypeError(`experimental candidate producer (wasm): ${message}`);

function describe(e: unknown): string {
  try {
    return e instanceof Error ? `${e.name}: ${e.message}` : typeof e;
  } catch {
    return 'an unprintable value';
  }
}

function inspecting<T>(what: string, run: () => T): T {
  try {
    return run();
  } catch (e) {
    if (e instanceof ExperimentalWasmCandidateProduceError || e instanceof TypeError) throw e;
    throw usage(`inspecting ${what} threw ${describe(e)}`);
  }
}

/** The own data properties of a parameter object, present ones included even when undefined. */
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

const TYPED_ARRAY = Object.getPrototypeOf(Uint8Array.prototype) as object;
const intrinsic = (key: PropertyKey) => Object.getOwnPropertyDescriptor(TYPED_ARRAY, key)!.get!;
const typedTag = intrinsic(Symbol.toStringTag);
const typedBuffer = intrinsic('buffer');
const typedOffset = intrinsic('byteOffset');
const typedLength = intrinsic('byteLength');

/** A private copy of a Uint8Array (a Buffer or a subclass included) through the intrinsic accessors. */
function ownBytes(v: unknown, what: string): Uint8Array {
  if (typedTag.call(v) !== 'Uint8Array') throw usage(`${what} must be a Uint8Array`);
  return new Uint8Array(new Uint8Array(typedBuffer.call(v), typedOffset.call(v), typedLength.call(v)));
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

const pointer = (path: string, key: string | number) => `${path}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;

/** The strict walk of the TypeScript SDK: a host value checked against the exact domain and copied. */
function exactCopy(v: unknown, part: string, path: string, depth: number): unknown {
  const reject = (cls: string, at = path) => new ExperimentalWasmCandidateProduceError(cls, part, at);
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
      return v === 0 ? 0 : v;
    case 'bigint':
      if (v > BigInt(MAX_SAFE) || v < -BigInt(MAX_SAFE)) throw reject('NUMBER_OUT_OF_RANGE');
      return Number(v);
    case 'object':
      break;
    default:
      throw reject('TYPE_UNSUPPORTED');
  }
  if (v === null) return null;
  if (depth + 1 > MAX_DEPTH) throw reject('DEPTH_EXCEEDED');
  const proto = Object.getPrototypeOf(v);
  const keys = Reflect.ownKeys(v);
  if (Array.isArray(v)) {
    if (proto !== Array.prototype) throw reject('TYPE_UNSUPPORTED');
    const length = v.length;
    if (keys.length !== length + 1) throw reject('TYPE_UNSUPPORTED');
    const out: unknown[] = [];
    for (let i = 0; i < length; i++) {
      const d = Object.getOwnPropertyDescriptor(v, String(i));
      if (d === undefined || !('value' in d) || !d.enumerable) throw reject('TYPE_UNSUPPORTED', pointer(path, i));
      out.push(exactCopy(d.value, part, pointer(path, i), depth + 1));
    }
    return out;
  }
  if (proto !== Object.prototype && proto !== null) throw reject('TYPE_UNSUPPORTED');
  const out: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    if (typeof key !== 'string') throw reject('TYPE_UNSUPPORTED');
    const at = pointer(path, key);
    if (!isWellFormed(key)) throw reject('SURROGATE_UNPAIRED', at);
    const d = Object.getOwnPropertyDescriptor(v, key)!;
    if (!('value' in d) || !d.enumerable) throw reject('TYPE_UNSUPPORTED', at);
    out[key] = exactCopy(d.value, part, at, depth + 1);
  }
  return out;
}

/** An input `{ bytes }` or `{ value }` as the bytes the binding receives: original, or encoded after the check. */
function inputBytes(input: unknown, part: string, path = ''): Uint8Array {
  const p = inspecting(part, () => params(input, part, ['bytes', 'value']));
  if (p.size !== 1) throw usage(`${part} must have exactly one of bytes and value`);
  if (p.has('bytes')) return inspecting(`${part}.bytes`, () => ownBytes(p.get('bytes'), `${part}.bytes`));
  const copy = inspecting(part, () => exactCopy(p.get('value'), part, path, 0));
  return new TextEncoder().encode(JSON.stringify(copy));
}

/** A label that ends up in the unit: a non-empty string, well formed. */
function label(v: unknown, part: string, path: string, required: boolean): string | undefined {
  if (v === undefined && !required) return undefined;
  if (typeof v !== 'string' || v.length === 0) throw usage(`${part}${path} must be a non-empty string`);
  if (!isWellFormed(v)) throw new ExperimentalWasmCandidateProduceError('SURROGATE_UNPAIRED', part, path);
  return v;
}

function keysJson(keys: unknown, part: string): string {
  return inspecting(part, () => {
    const p = params(keys, part, ['classical', 'pq']);
    const one = (name: 'classical' | 'pq') => {
      const k = params(p.get(name), `${part}.${name}`, ['kid', 'alg', 'secretKeyB64', 'publicKeyB64']);
      for (const field of ['secretKeyB64', 'publicKeyB64']) if (typeof k.get(field) !== 'string') throw usage(`${part}.${name}.${field} must be a string`);
      return {
        kid: label(k.get('kid'), part, `/${name}/kid`, true),
        alg: label(k.get('alg'), part, `/${name}/alg`, true),
        secret_key_b64: k.get('secretKeyB64'),
        public_key_b64: k.get('publicKeyB64'),
      };
    };
    if (p.get('classical') === undefined) throw usage(`${part}.classical is required`);
    return JSON.stringify(p.get('pq') === undefined ? { classical: one('classical') } : { classical: one('classical'), pq: one('pq') });
  });
}

const PARTS: Record<string, string> = { policy_decision: 'policyDecision', audit_entries: 'auditEntries', pq_checkpoints: 'pqCheckpoints' };

/** A binding result: the canonical text, or its rejection, misuse or error raised. */
function result(json: string): string {
  const r = JSON.parse(json);
  if (typeof r.canonical === 'string') return r.canonical;
  if (r.reject) throw new ExperimentalWasmCandidateProduceError(r.reject.class, PARTS[r.reject.part] ?? r.reject.part, r.reject.path, r.reject.offset);
  if (r.usage_error) throw usage(String(r.usage_error));
  throw new Error(`experimental candidate producer (wasm): ${String(r.error)}`);
}

const DCP_CONTEXTS = [
  'DCP-AI.v2.AgentPassport', 'DCP-AI.v2.ResponsiblePrincipal', 'DCP-AI.v2.Intent', 'DCP-AI.v2.PolicyDecision', 'DCP-AI.v2.AuditEvent',
  'DCP-AI.v2.Bundle', 'DCP-AI.v2.Revocation', 'DCP-AI.v2.KeyRotation', 'DCP-AI.v2.ProofOfPossession', 'DCP-AI.v2.JurisdictionAttestation',
  'DCP-AI.v2.HumanConfirmation', 'DCP-AI.v2.MultiPartyAuth', 'DCP-AI.v2.Lifecycle', 'DCP-AI.v2.Succession', 'DCP-AI.v2.Dispute',
  'DCP-AI.v2.Rights', 'DCP-AI.v2.Delegation', 'DCP-AI.v2.Awareness', 'DCP-AI.v2.SubMandate',
];

export function createWasmCandidateProducer(bindings: CandidateProduceBindings) {
  return {
    signPayload(context: string, input: unknown, keys: unknown): { bytes: Uint8Array; signedPayload: Record<string, unknown> } {
      if (typeof context !== 'string' || !DCP_CONTEXTS.includes(context)) throw usage('context must be one of the DCP contexts');
      const k = keysJson(keys, 'keys');
      const payload = inputBytes(input, 'payload');
      const canonical = result(bindings.signPayload(payload, context, k));
      return { bytes: new TextEncoder().encode(canonical), signedPayload: JSON.parse(canonical) };
    },

    signBundle(parts: unknown, signer: unknown, options: unknown): { bytes: Uint8Array; signedBundle: Record<string, unknown> } {
      const o = inspecting('options', () => params(options, 'options', ['sessionNonce', 'sessionIssuedAt', 'sessionExpiresAt', 'intendedVerifier', 'dualHash', 'createdAt']));
      const s = inspecting('signer', () => params(signer, 'signer', ['signerType', 'signerId', 'keys']));
      const p = inspecting('parts', () => params(parts, 'parts', ['rpr', 'passport', 'intent', 'policyDecision', 'auditEntries', 'pqCheckpoints']));
      for (const name of ['rpr', 'passport', 'intent', 'policyDecision', 'auditEntries']) if (p.get(name) === undefined) throw usage(`parts.${name} is required`);
      if (s.get('keys') === undefined) throw usage('signer.keys is required');
      const nonce = o.get('sessionNonce');
      if (typeof nonce !== 'string') throw usage('options.sessionNonce must be a string');
      const dualHash = o.get('dualHash') === undefined ? false : o.get('dualHash');
      if (typeof dualHash !== 'boolean') throw usage('options.dualHash must be a boolean');
      const optional: Record<string, string> = {};
      for (const [name, snake] of [['sessionIssuedAt', 'session_issued_at'], ['sessionExpiresAt', 'session_expires_at'], ['intendedVerifier', 'intended_verifier'], ['createdAt', 'created_at']]) {
        const v = label(o.get(name), 'options', `/${name}`, false);
        if (v !== undefined) optional[snake] = v;
      }
      const signerJson = JSON.stringify({
        signer_type: label(s.get('signerType'), 'signer', '/signerType', true),
        signer_id: label(s.get('signerId'), 'signer', '/signerId', true),
        keys: JSON.parse(keysJson(s.get('keys'), 'signer.keys')),
      });
      const optionsJson = JSON.stringify({ session_nonce: nonce, dual_hash: dualHash, ...optional });
      // Every piece's own bytes, side by side; the layout gives their ranges.
      const pieces: Uint8Array[] = [];
      let at = 0;
      const place = (bytes: Uint8Array): [number, number] => {
        pieces.push(bytes);
        at += bytes.length;
        return [at - bytes.length, at];
      };
      const list = (name: string) => (p.get(name) === undefined ? [] : inspecting(`parts.${name}`, () => elements(p.get(name), `parts.${name}`)));
      const layout = {
        rpr: place(inputBytes(p.get('rpr'), 'rpr')),
        passport: place(inputBytes(p.get('passport'), 'passport')),
        intent: place(inputBytes(p.get('intent'), 'intent')),
        policy_decision: place(inputBytes(p.get('policyDecision'), 'policyDecision')),
        audit_entries: list('auditEntries').map((e, i) => place(inputBytes(e, 'auditEntries', `/${i}`))),
        pq_checkpoints: list('pqCheckpoints').map((c, i) => place(inputBytes(c, 'pqCheckpoints', `/${i}`))),
      };
      const all = new Uint8Array(at);
      let offset = 0;
      for (const piece of pieces) {
        all.set(piece, offset);
        offset += piece.length;
      }
      const canonical = result(bindings.signBundle(all, JSON.stringify(layout), signerJson, optionsJson));
      return { bytes: new TextEncoder().encode(canonical), signedBundle: JSON.parse(canonical) };
    },
  };
}
