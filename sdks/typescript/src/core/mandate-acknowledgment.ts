/**
 * Mandate acknowledgment (opt-in, MP-02 F4): DCP-09 § 3.3 steps 4–6. The delegate agent signs a separate,
 * versioned record (format dcp09-mandate-ack-v1, context DCP-AI.v2.MandateAcknowledgment) that binds one mandate
 * of a chain, the chain up to it and the agent's awareness threshold. Design: docs/reviews/mp02-acknowledgment-design.md
 * v0.2.
 *
 * evaluateDelegationActivationV2 takes one snapshot of the evidence, the acknowledgments, the thresholds and the
 * configuration, runs the delegated admission (F2) over it at one instant, and evaluates the acknowledgments only
 * when that composition is admitted, with the agents, keys, policy, mode and revocation snapshot the composition
 * verified. Nothing is taken from the caller as a result, key or digest. An active delegation authorizes no action:
 * action_authorized is always false, and neither authority_scope nor threshold_rules is evaluated. A valid signature
 * shows the agent's signed declaration, not its understanding.
 *
 * Existing APIs are unchanged: admitDelegatedBundleV2 still reports activation 'not_evaluated'.
 */

import type { KeyEntry } from './crypto-provider.js';
import type { AlgorithmRegistry } from './crypto-registry.js';
import type { CompositeSignature, SignatureEntry } from './composite-sig.js';
import { compositeSign, compositeVerify, type CompositeKeyPair } from './composite-ops.js';
import { canonicalizeV2 } from './canonicalize.js';
import { sha256Hex } from './dual-hash.js';
import { parseRfc3339 } from './session-nonce.js';
import { isSchemaDateTime } from './schema-v2.js';
import { DCP_CONTEXTS, MANDATE_ACKNOWLEDGMENT_CONTEXT } from './domain-separation.js';
import { signerKey } from './delegation.js';
import { SESSION_CLOCK_SKEW_MS } from './verify-v2.js';
import {
  InputError,
  bounded,
  codePoints,
  composeDelegated,
  dataProperty,
  jsonCopy,
  mandatePreflight,
  printable,
  signatureSlotError,
  takeDelegatedSnapshot,
  usedKeyError,
  type DelegatedAdmissionResult,
  type DelegatedEvidence,
  type DelegatedOperator,
  type DelegatedVerified,
} from './delegated-admission.js';

export const MANDATE_ACKNOWLEDGMENT_FORMAT = 'dcp09-mandate-ack-v1' as const;

/** schemas/v2/mandate_acknowledgment.schema.json */
export interface MandateAcknowledgment {
  dcp_version: '2.0';
  acknowledgment_format: typeof MANDATE_ACKNOWLEDGMENT_FORMAT;
  acknowledgment_id: string;
  mandate_id: string;
  mandate_hash: string;
  chain_hash: string;
  session_nonce: string;
  human_id: string;
  agent_id: string;
  awareness_threshold_id: string;
  awareness_threshold_hash: string;
  acknowledged_at: string;
  composite_sig: CompositeSignature;
}

export interface ActivationEvidence extends DelegatedEvidence {
  /** One acknowledgment per mandate of the chain, in any order. */
  acknowledgments: unknown;
  /** The awareness threshold each acknowledgment names. */
  awarenessThresholds: unknown;
}

export type AcknowledgmentCode =
  | 'ACK_INPUT_INVALID'
  | 'ACK_FORM_INVALID'
  | 'ACK_THRESHOLD_INVALID'
  | 'ACK_MISSING'
  | 'ACK_DUPLICATE'
  | 'ACK_UNEXPECTED'
  | 'ACK_THRESHOLD_MISSING'
  | 'ACK_THRESHOLD_DUPLICATE'
  | 'ACK_THRESHOLD_REUSED'
  | 'ACK_THRESHOLD_UNEXPECTED'
  | 'ACK_MANDATE_MISMATCH'
  | 'ACK_CHAIN_MISMATCH'
  | 'ACK_THRESHOLD_MISMATCH'
  | 'ACK_KEY_UNKNOWN'
  | 'ACK_KEY_INVALID'
  | 'ACK_ALGORITHM_REJECTED'
  | 'ACK_THRESHOLD_SIGNATURE_INVALID'
  | 'ACK_SIGNATURE_INVALID'
  | 'ACK_TIME_INVALID'
  | 'ACK_KEY_REVOKED'
  | 'ACK_KEY_REVOCATION_UNKNOWN';

export interface AcknowledgmentError {
  code: AcknowledgmentCode;
  message: string;
}

export interface DelegationActivationResult {
  /** Exactly admitDelegatedBundleV2's result over the same snapshot and instant (its own activation stays not_evaluated). */
  composition: DelegatedAdmissionResult;
  /** 'evaluated' if and only if the composition is admitted and both containers are valid input (design § 4.2). */
  activation: 'not_evaluated' | 'evaluated';
  /** activation evaluated and no acknowledgment error. */
  delegation_active: boolean;
  /** Always false: activation authorizes no action. */
  action_authorized: false;
  /** One entry per mandate, chain order; empty when not evaluated. */
  acknowledgments: Array<{ mandate_id: string; acknowledgment_id: string | null; awareness_threshold_id: string | null; verified: boolean }>;
  inputs: { now: number; acknowledgments: number | null; awareness_thresholds: number | null };
  /** In the normative order of design § 7.2. */
  errors: AcknowledgmentError[];
}

export interface MandateAcknowledgmentParams {
  /** Root first, ending with the acknowledged mandate. */
  mandateChain: unknown;
  /** The signed awareness threshold of the same agent. */
  awarenessThreshold: unknown;
  acknowledgmentId: string;
  /** RFC 3339; default the system clock, UTC, milliseconds. */
  acknowledgedAt?: string;
}

// ── Form (design § 2 and § 2.1) ──

/** @internal The members of schemas/v2/mandate_acknowledgment.schema.json, all required; checked by the parity test. */
export const ACK_FIELDS: readonly string[] = [
  'dcp_version', 'acknowledgment_format', 'acknowledgment_id', 'mandate_id', 'mandate_hash', 'chain_hash', 'session_nonce',
  'human_id', 'agent_id', 'awareness_threshold_id', 'awareness_threshold_hash', 'acknowledged_at', 'composite_sig',
];
/** @internal The members of schemas/v2/awareness_threshold.schema.json, all required. */
export const THRESHOLD_FIELDS: readonly string[] = [
  'dcp_version', 'threshold_id', 'session_nonce', 'agent_id', 'human_id', 'threshold_rules', 'timestamp', 'composite_sig',
];
/** @internal The members of a threshold rule, all required. */
export const RULE_FIELDS: readonly string[] = ['dimension', 'operator', 'value', 'action_if_triggered'];
/** @internal */
export const RULE_OPERATORS: readonly string[] = ['gt', 'lt', 'gte', 'lte', 'eq'];
/** @internal */
export const RULE_ACTIONS: readonly string[] = ['notify', 'escalate', 'block'];

const NONCE = /^[0-9a-f]{64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const PQ_ALGS: readonly string[] = ['ml-dsa-65', 'slh-dsa-192f'];

type Rec = Record<string, unknown>;
const isObject = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Whether `s` is a sequence of Unicode scalar values: walked by code points, a lone surrogate is its own. */
function isScalarString(s: string): boolean {
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    if (cp >= 0xd800 && cp <= 0xdfff) return false;
  }
  return true;
}

/** Where the first string (a value or a member name) that is not Unicode scalar values is, or undefined. */
function illFormedString(v: unknown, where: string): string | undefined {
  if (typeof v === 'string') return isScalarString(v) ? undefined : where;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const bad = illFormedString(v[i], `${where}[${i}]`);
      if (bad) return bad;
    }
  } else if (isObject(v)) {
    for (const [k, x] of Object.entries(v)) {
      if (!isScalarString(k)) return `${where} member name`;
      const bad = illFormedString(x, `${where}.${k}`);
      if (bad) return bad;
    }
  }
  return undefined;
}

function membersError(v: Rec, fields: readonly string[]): string | undefined {
  for (const key of Object.keys(v)) if (!fields.includes(key)) return `unknown member ${printable(key)}`;
  for (const key of fields) if (!Object.hasOwn(v, key)) return `missing ${key}`;
  return undefined;
}

const isId = (v: unknown) => typeof v === 'string' && codePoints(v) >= 6;
const isInstant = (v: unknown) => typeof v === 'string' && isSchemaDateTime(v) && parseRfc3339(v) !== undefined;
/** design § 2.1: an integer of ±(2^53 − 1); a boolean is not a number. */
const isSafeIntegerValue = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v);

/** @internal The first defect of an acknowledgment's form, in the fixed order of design § 2, or undefined. */
export function acknowledgmentFormError(a: unknown): string | undefined {
  if (!isObject(a)) return 'not an object';
  return acknowledgmentFieldsError(a, ACK_FIELDS) ?? signatureSlotError(a.composite_sig, 'composite_sig');
}

/** The checks of acknowledgmentFormError on `fields`, but the composite_sig slot. */
function acknowledgmentFieldsError(a: Rec, fields: readonly string[]): string | undefined {
  const members = membersError(a, fields);
  if (members) return members;
  const text = illFormedString(a, 'acknowledgment');
  if (text) return `${text} is not Unicode scalar values (lone surrogate)`;
  if (a.dcp_version !== '2.0') return 'dcp_version must be "2.0"';
  if (a.acknowledgment_format !== MANDATE_ACKNOWLEDGMENT_FORMAT) return `acknowledgment_format must be "${MANDATE_ACKNOWLEDGMENT_FORMAT}"`;
  for (const f of ['acknowledgment_id', 'mandate_id', 'human_id', 'agent_id', 'awareness_threshold_id']) {
    if (!isId(a[f])) return `${f} must be a string of at least 6 code points`;
  }
  for (const f of ['mandate_hash', 'chain_hash', 'awareness_threshold_hash']) {
    if (typeof a[f] !== 'string' || !DIGEST.test(a[f] as string)) return `${f} is not sha256: and 64 lowercase hex digits`;
  }
  if (typeof a.session_nonce !== 'string' || !NONCE.test(a.session_nonce)) return 'session_nonce is not 64 lowercase hex digits';
  if (!isInstant(a.acknowledged_at)) return 'acknowledged_at is not an RFC 3339 date-time';
  return undefined;
}

/** @internal The first defect of an awareness threshold's form, with the domain of design § 2.1, or undefined. */
export function thresholdFormError(u: unknown): string | undefined {
  if (!isObject(u)) return 'not an object';
  const members = membersError(u, THRESHOLD_FIELDS);
  if (members) return members;
  const text = illFormedString(u, 'threshold');
  if (text) return `${text} is not Unicode scalar values (lone surrogate)`;
  if (u.dcp_version !== '2.0') return 'dcp_version must be "2.0"';
  for (const f of ['threshold_id', 'agent_id', 'human_id']) if (!isId(u[f])) return `${f} must be a string of at least 6 code points`;
  if (typeof u.session_nonce !== 'string' || !NONCE.test(u.session_nonce)) return 'session_nonce is not 64 lowercase hex digits';
  if (!isInstant(u.timestamp)) return 'timestamp is not an RFC 3339 date-time';
  const rules = u.threshold_rules;
  if (!Array.isArray(rules) || rules.length === 0) return 'threshold_rules must be a non-empty array';
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    const at = `threshold_rules[${i}]`;
    if (!isObject(r)) return `${at} is not an object`;
    const m = membersError(r, RULE_FIELDS);
    if (m) return `${at}: ${m}`;
    if (typeof r.dimension !== 'string' || codePoints(r.dimension) < 1) return `${at}.dimension must be a non-empty string`;
    if (!RULE_OPERATORS.includes(r.operator as string)) return `${at}.operator is not gt, lt, gte, lte or eq`;
    if (!isSafeIntegerValue(r.value)) return `${at}.value is not an integer of ±(2^53 − 1)`;
    if (!RULE_ACTIONS.includes(r.action_if_triggered as string)) return `${at}.action_if_triggered is not notify, escalate or block`;
  }
  const slot = signatureSlotError(u.composite_sig, 'composite_sig');
  if (slot) return slot;
  try {
    canonicalizeV2(unsigned(u));
  } catch (e) {
    return `not canonicalizable under dcp-jcs-v1: ${(e as Error).message}`;
  }
  return undefined;
}

// ── Hashes (design § 2) ──

const digest = (v: unknown) => `sha256:${sha256Hex(Buffer.from(canonicalizeV2(v), 'utf8'))}`;
function unsigned(record: Rec): Rec {
  const { composite_sig: _sig, ...payload } = record;
  return payload;
}
/** @internal The mandate without human_composite_sig and delegator_composite_sig (DCP-09 § 3.4). */
export function mandateHash(mandate: Rec): string {
  const { human_composite_sig: _human, delegator_composite_sig: _delegator, ...payload } = mandate;
  return digest(payload);
}
/** @internal chain_hash of each mandate: the digest of the array of mandate_hash from the root to it. */
export function chainHashes(mandates: Rec[]): string[] {
  const hashes = mandates.map(mandateHash);
  return hashes.map((_, i) => digest(hashes.slice(0, i + 1)));
}
/** @internal The threshold without composite_sig. */
export const thresholdHash = (threshold: Rec): string => digest(unsigned(threshold));

const instant = (v: unknown) => parseRfc3339(v) as number;
const utf8 = (v: unknown) => new TextEncoder().encode(canonicalizeV2(v));

// ── Creation (design § 3.2) ──

const PARAM_FIELDS: readonly string[] = ['mandateChain', 'awarenessThreshold', 'acknowledgmentId', 'acknowledgedAt'];

function copyOrTypeError(value: unknown, where: string): unknown {
  try {
    return jsonCopy(value, where);
  } catch (e) {
    if (e instanceof InputError) throw new TypeError(`createMandateAcknowledgment: ${e.message}`);
    throw e;
  }
}

/**
 * Sign the acknowledgment of the last mandate of `mandateChain`, linked to `awarenessThreshold`. Computes
 * mandate_hash, chain_hash and awareness_threshold_hash from the inputs; takes no digest from the caller. The
 * parameters and the keys, secret key strings included, are copied before the first await; no input is modified.
 * Throws TypeError for an argument of the wrong shape and Error for an acknowledgment that could never verify.
 */
export async function createMandateAcknowledgment(
  registry: AlgorithmRegistry,
  keys: CompositeKeyPair,
  params: MandateAcknowledgmentParams,
): Promise<MandateAcknowledgment> {
  const fail = (message: string): never => {
    throw new Error(`createMandateAcknowledgment: ${message}`);
  };
  const k = copyOrTypeError(keys, 'keys');
  const keyOf = (component: 'classical' | 'pq'): CompositeKeyPair['classical'] => {
    const entry = isObject(k) ? k[component] : undefined;
    if (!isObject(entry) || !['kid', 'alg', 'secretKeyB64', 'publicKeyB64'].every((f) => typeof entry[f] === 'string')) {
      throw new TypeError(`createMandateAcknowledgment: keys.${component} must have string kid, alg, secretKeyB64 and publicKeyB64`);
    }
    return { kid: entry.kid as string, alg: entry.alg as string, secretKeyB64: entry.secretKeyB64 as string, publicKeyB64: entry.publicKeyB64 as string };
  };
  const signingKeys: CompositeKeyPair = { classical: keyOf('classical'), pq: keyOf('pq') };
  if (signingKeys.classical.alg !== 'ed25519') fail('keys.classical must be ed25519');
  if (!PQ_ALGS.includes(signingKeys.pq.alg)) fail('keys.pq must be ml-dsa-65 or slh-dsa-192f');
  // The public metadata the signature slot will carry: a canonical public key of the algorithm's size, and its
  // derived kid (V2-13). Messages name the kid only, never a secret.
  for (const component of ['classical', 'pq'] as const) {
    const { kid, alg, publicKeyB64 } = signingKeys[component];
    const entry = { kid, alg, public_key_b64: publicKeyB64, created_at: '', expires_at: null, status: 'active' } as KeyEntry;
    const error = usedKeyError(entry, kid, alg, `keys.${component}`);
    if (error) fail(error);
  }

  const p = copyOrTypeError(params, 'params');
  if (!isObject(p)) throw new TypeError('createMandateAcknowledgment: params must be an object');
  for (const key of Object.keys(p)) if (!PARAM_FIELDS.includes(key)) throw new TypeError(`createMandateAcknowledgment: unknown parameter ${printable(key)}`);
  const chain = p.mandateChain;
  if (!Array.isArray(chain) || chain.length === 0) throw new TypeError('createMandateAcknowledgment: mandateChain must be a non-empty array');
  for (let i = 0; i < chain.length; i++) {
    const errors = mandatePreflight(chain[i], i);
    if (errors.length > 0) fail(errors[0]);
    if (i > 0 && (chain[i] as Rec).parent_mandate_id !== (chain[i - 1] as Rec).mandate_id) fail(`mandate[${i}] does not name mandate[${i - 1}] as its parent`);
  }
  const mandates = chain as Rec[];
  const threshold = p.awarenessThreshold;
  const thresholdError = thresholdFormError(threshold);
  if (thresholdError) fail(`awarenessThreshold: ${thresholdError}`);
  const u = threshold as Rec;
  const id = p.acknowledgmentId;
  if (typeof id !== 'string') throw new TypeError('createMandateAcknowledgment: acknowledgmentId must be a string');
  if (codePoints(id) < 6 || !isScalarString(id)) fail('acknowledgmentId must be at least 6 Unicode scalar values');
  const acknowledgedAt = p.acknowledgedAt === undefined ? new Date(Date.now()).toISOString() : p.acknowledgedAt;
  if (!isInstant(acknowledgedAt)) fail('acknowledgedAt is not an RFC 3339 date-time');

  const m = mandates[mandates.length - 1];
  for (const f of ['agent_id', 'human_id', 'session_nonce']) if (u[f] !== m[f]) fail(`the threshold's ${f} is not the mandate's`);
  const at = instant(acknowledgedAt);
  if (at < instant(m.timestamp)) fail('acknowledgedAt is before the mandate timestamp');
  if (at < instant(u.timestamp)) fail('acknowledgedAt is before the threshold timestamp');
  if (at > instant(m.valid_until)) fail('acknowledgedAt is after the mandate valid_until');

  const payload = {
    dcp_version: '2.0' as const,
    acknowledgment_format: MANDATE_ACKNOWLEDGMENT_FORMAT,
    acknowledgment_id: id,
    mandate_id: m.mandate_id as string,
    mandate_hash: mandateHash(m),
    chain_hash: chainHashes(mandates)[mandates.length - 1],
    session_nonce: m.session_nonce as string,
    human_id: m.human_id as string,
    agent_id: m.agent_id as string,
    awareness_threshold_id: u.threshold_id as string,
    awareness_threshold_hash: thresholdHash(u),
    acknowledged_at: acknowledgedAt as string,
  };
  // Every computed field, before signing: a mandate field copied here (mandate_id, the ids, the nonce) must give an
  // acknowledgment of the form design § 2 requires, which the mandate preflight alone does not ensure.
  const fieldsError = acknowledgmentFieldsError(payload, ACK_FIELDS.filter((f) => f !== 'composite_sig'));
  if (fieldsError) fail(`the acknowledgment would not have its form: ${fieldsError}`);
  const bytes = utf8(payload);
  const composite_sig = await compositeSign(registry, MANDATE_ACKNOWLEDGMENT_CONTEXT, bytes, signingKeys);
  const acknowledgment = { ...payload, composite_sig };
  const formError = acknowledgmentFormError(acknowledgment);
  if (formError) fail(`the signed acknowledgment does not have its form: ${formError}`);
  return acknowledgment;
}

// ── Evaluation (design § 4) ──

type Pair = { k: Rec; u: Rec };

/**
 * Evaluate the activation of a delegation (design § 4): the delegated admission over one snapshot, then the
 * acknowledgments of every mandate of its chain. Throws AdmissionConfigError for an invalid operator configuration,
 * as admitDelegatedBundleV2 does; every problem with the evidence or the acknowledgments is a code in the result.
 * The registry is used as given; every other input is copied before the first await.
 */
export async function evaluateDelegationActivationV2(
  evidence: ActivationEvidence,
  registry: AlgorithmRegistry,
  operator: DelegatedOperator,
): Promise<DelegationActivationResult> {
  // ── 0–1. F2's snapshot (configuration errors throw), then the two containers ──
  const snapshot = takeDelegatedSnapshot(evidence, operator);
  const errors: AcknowledgmentError[] = [];
  const add = (code: AcknowledgmentCode, message: string) => errors.push({ code, message: bounded(message) });
  const container = (field: 'acknowledgments' | 'awarenessThresholds'): unknown[] | null => {
    try {
      if (!isObject(evidence)) throw new InputError('evidence is not an object');
      const v = jsonCopy(dataProperty(evidence, field, `evidence.${field}`), field);
      if (!Array.isArray(v)) throw new InputError(`${field} is not an array`);
      return v;
    } catch (e) {
      if (!(e instanceof InputError)) throw e;
      add('ACK_INPUT_INVALID', e.message);
      return null;
    }
  };
  const acks = container('acknowledgments');
  const thresholds = container('awarenessThresholds');

  // ── 2. The composition, always ──
  const { result: composition, verified } = await composeDelegated(snapshot, registry);
  const inputs = { now: snapshot.nowMs, acknowledgments: acks?.length ?? null, awareness_thresholds: thresholds?.length ?? null };
  if (!composition.admitted || verified === null || acks === null || thresholds === null) {
    return { composition, activation: 'not_evaluated', delegation_active: false, action_authorized: false, acknowledgments: [], inputs, errors };
  }
  const entries = verified.mandates.map((m) => ({
    mandate_id: m.mandate_id as string,
    acknowledgment_id: null as string | null,
    awareness_threshold_id: null as string | null,
    verified: false,
  }));
  const evaluated = (): DelegationActivationResult => ({
    composition,
    activation: 'evaluated',
    delegation_active: errors.length === 0,
    action_authorized: false,
    acknowledgments: entries,
    inputs,
    errors,
  });

  // ── 3. Form ──
  acks.forEach((a, i) => {
    const e = acknowledgmentFormError(a);
    if (e) add('ACK_FORM_INVALID', `acknowledgments[${i}]: ${e}`);
  });
  thresholds.forEach((u, i) => {
    const e = thresholdFormError(u);
    if (e) add('ACK_THRESHOLD_INVALID', `awarenessThresholds[${i}]: ${e}`);
  });
  if (errors.length > 0) return evaluated();

  // ── 4. Cardinality, in the order of design § 7.2 ──
  const A = acks as Rec[];
  const U = thresholds as Rec[];
  const ids = verified.mandates.map((m) => m.mandate_id as string);
  const byMandate = ids.map((id) => A.filter((a) => a.mandate_id === id));
  byMandate.forEach((list, i) => {
    if (list.length === 0) add('ACK_MISSING', `mandate ${printable(ids[i])} has no acknowledgment`);
    else if (list.length > 1) add('ACK_DUPLICATE', `mandate ${printable(ids[i])} has ${list.length} acknowledgments`);
  });
  A.forEach((a, i) => {
    if (!ids.includes(a.mandate_id as string)) add('ACK_UNEXPECTED', `acknowledgments[${i}] acknowledges ${printable(a.mandate_id)}, not in the chain`);
  });
  const secondOccurrences = (values: unknown[]): number[] => {
    const seen = new Map<unknown, number>();
    const out: number[] = [];
    values.forEach((v, i) => {
      const n = (seen.get(v) ?? 0) + 1;
      seen.set(v, n);
      if (n === 2) out.push(i);
    });
    return out;
  };
  for (const i of secondOccurrences(A.map((a) => a.acknowledgment_id))) add('ACK_DUPLICATE', `acknowledgment_id ${printable(A[i].acknowledgment_id)} is repeated`);
  for (const i of secondOccurrences(U.map((u) => u.threshold_id))) add('ACK_THRESHOLD_DUPLICATE', `threshold_id ${printable(U[i].threshold_id)} is repeated`);
  const thresholdIds = U.map((u) => u.threshold_id);
  A.forEach((a, i) => {
    if (!thresholdIds.includes(a.awareness_threshold_id)) add('ACK_THRESHOLD_MISSING', `acknowledgments[${i}] names threshold ${printable(a.awareness_threshold_id)}, which was not given`);
  });
  for (const i of secondOccurrences(A.map((a) => a.awareness_threshold_id))) add('ACK_THRESHOLD_REUSED', `threshold ${printable(A[i].awareness_threshold_id)} is named by more than one acknowledgment`);
  const named = new Set(A.map((a) => a.awareness_threshold_id));
  U.forEach((u, i) => {
    if (!named.has(u.threshold_id)) add('ACK_THRESHOLD_UNEXPECTED', `awarenessThresholds[${i}] (${printable(u.threshold_id)}) is named by no acknowledgment`);
  });
  byMandate.forEach((list, i) => {
    if (list.length !== 1) return;
    entries[i].acknowledgment_id = list[0].acknowledgment_id as string;
    const matching = U.filter((u) => u.threshold_id === list[0].awareness_threshold_id);
    if (matching.length === 1) entries[i].awareness_threshold_id = matching[0].threshold_id as string;
  });
  if (errors.length > 0) return evaluated();

  // ── 5–8. Per mandate, chain order: A bindings, B keys and policy, C signatures, D own time ──
  const pairs: Pair[] = byMandate.map((list) => ({ k: list[0], u: U.find((u) => u.threshold_id === list[0].awareness_threshold_id) as Rec }));
  const n = verified.mandates.length;
  const hashes = verified.mandates.map(mandateHash);
  const chains = chainHashes(verified.mandates);
  const selfValid: boolean[] = new Array(n).fill(false);
  const pairKeys: KeyEntry[][] = new Array(n).fill([]);
  for (let i = 0; i < n; i++) {
    const keys = await evaluatePair(i, pairs[i], verified, hashes[i], chains[i], registry, add);
    if (keys === null) continue;
    selfValid[i] = true;
    pairKeys[i] = keys;
  }

  // ── 9. T5: the parent acknowledged before the sub-mandate was issued ──
  const t5Failed: boolean[] = new Array(n).fill(false);
  for (let i = 1; i < n; i++) {
    if (!selfValid[i - 1]) continue;
    const parentAck = instant(pairs[i - 1].k.acknowledged_at);
    if (parentAck > instant(verified.mandates[i].timestamp)) {
      add('ACK_TIME_INVALID', `T5: the acknowledgment of mandate ${printable(ids[i - 1])} is after the issuance of mandate ${printable(ids[i])}`);
      t5Failed[i - 1] = true;
    }
  }

  // ── 10. Revocation of the keys only acknowledgments and thresholds use, in the composition's snapshot ──
  const revokedPair: boolean[] = new Array(n).fill(false);
  const users = new Map<string, number[]>();
  pairKeys.forEach((keys, i) => {
    if (!selfValid[i]) return;
    for (const key of keys) {
      if (verified.checkedKids.has(key.kid)) continue;
      users.set(key.kid, [...(users.get(key.kid) ?? []), i]);
    }
  });
  const statuses = isObject(verified.revocation.keys) ? (verified.revocation.keys as Rec) : {};
  for (const kid of [...users.keys()].sort()) {
    const status = Object.hasOwn(statuses, kid) ? statuses[kid] : undefined;
    if (status === 'not_revoked') continue;
    if (status === 'revoked') add('ACK_KEY_REVOKED', `key ${kid} is revoked`);
    else add('ACK_KEY_REVOCATION_UNKNOWN', `the revocation status of key ${kid} is unknown`);
    for (const i of users.get(kid) as number[]) revokedPair[i] = true;
  }

  // ── 11. Result ──
  for (let i = 0; i < n; i++) entries[i].verified = selfValid[i] && !t5Failed[i] && !revokedPair[i];
  return evaluated();
}

/**
 * Phases A to D for mandate i (design § 4.2): each phase runs all its checks, and a phase that adds a code skips
 * the later phases of this mandate. Returns the four resolved keys when every phase passed, else null.
 */
async function evaluatePair(
  i: number,
  { k, u }: Pair,
  verified: DelegatedVerified,
  mandateHashI: string,
  chainHashI: string,
  registry: AlgorithmRegistry,
  add: (code: AcknowledgmentCode, message: string) => void,
): Promise<KeyEntry[] | null> {
  const m = verified.mandates[i];
  const label = `mandate ${printable(m.mandate_id)}`;
  let failed = false;
  const fail = (code: AcknowledgmentCode, message: string) => {
    failed = true;
    add(code, `${label}: ${message}`);
  };

  // A. Bindings, in the order of design § 4.4
  if (k.mandate_hash !== mandateHashI) fail('ACK_MANDATE_MISMATCH', 'mandate_hash is not the hash of the mandate');
  if (k.session_nonce !== m.session_nonce) fail('ACK_MANDATE_MISMATCH', 'session_nonce is not the mandate\'s');
  if (k.human_id !== m.human_id) fail('ACK_MANDATE_MISMATCH', 'human_id is not the mandate\'s');
  if (k.agent_id !== m.agent_id) fail('ACK_MANDATE_MISMATCH', 'agent_id is not the mandate\'s');
  if (k.chain_hash !== chainHashI) fail('ACK_CHAIN_MISMATCH', 'chain_hash is not the hash of the chain up to the mandate');
  if (k.awareness_threshold_hash !== thresholdHash(u)) fail('ACK_THRESHOLD_MISMATCH', 'awareness_threshold_hash is not the hash of the threshold');
  if (u.agent_id !== m.agent_id) fail('ACK_THRESHOLD_MISMATCH', 'the threshold\'s agent_id is not the mandate\'s');
  if (u.human_id !== m.human_id) fail('ACK_THRESHOLD_MISMATCH', 'the threshold\'s human_id is not the mandate\'s');
  if (u.session_nonce !== m.session_nonce) fail('ACK_THRESHOLD_MISMATCH', 'the threshold\'s session_nonce is not the mandate\'s');
  if (failed) return null;

  // B. Keys, in the passport the composition verified for the mandate's agent, then the policy
  const list = verified.agentKeys[m.agent_id as string] ?? [];
  const components: Array<[string, SignatureEntry, 'classical' | 'pq']> = [
    ['threshold classical', (u.composite_sig as CompositeSignature).classical, 'classical'],
    ['threshold pq', (u.composite_sig as CompositeSignature).pq as SignatureEntry, 'pq'],
    ['acknowledgment classical', (k.composite_sig as CompositeSignature).classical, 'classical'],
    ['acknowledgment pq', (k.composite_sig as CompositeSignature).pq as SignatureEntry, 'pq'],
  ];
  const resolved: KeyEntry[] = [];
  for (const [where, entry] of components) {
    const key = signerKey(list, entry, verified.nowMs);
    if (typeof key === 'string') {
      const known = list.some((x) => isObject(x) && x.kid === entry.kid);
      fail(known ? 'ACK_KEY_INVALID' : 'ACK_KEY_UNKNOWN', `${where}: ${key} in the passport of ${printable(m.agent_id)}`);
      continue;
    }
    const identity = usedKeyError(key, entry.kid, entry.alg, where);
    if (identity) {
      fail('ACK_KEY_INVALID', identity);
      continue;
    }
    resolved.push(key);
  }
  const listed = (field: 'accepted_classical_algs' | 'accepted_pq_algs' | 'advisory_rejected_algs'): readonly unknown[] => {
    const value = verified.policy[field];
    return Array.isArray(value) ? value : [];
  };
  for (const [where, entry, kind] of components) {
    if (kind === 'classical' && verified.mode === 'pq_only') continue;
    const accepted = kind === 'classical' ? 'accepted_classical_algs' : 'accepted_pq_algs';
    if (!listed(accepted).includes(entry.alg)) fail('ACK_ALGORITHM_REJECTED', `${where}: ${entry.alg} is not accepted by the verifier policy`);
    if (listed('advisory_rejected_algs').includes(entry.alg)) fail('ACK_ALGORITHM_REJECTED', `${where}: ${entry.alg} is rejected by an active advisory`);
  }
  if (failed) return null;

  // C. Signatures: the threshold under Awareness, then the acknowledgment under its own context
  const [uc, up, kc, kp] = resolved;
  const verifies = async (context: string, record: Rec, classical: KeyEntry, pq: KeyEntry): Promise<boolean> => {
    try {
      const r = await compositeVerify(registry, context, utf8(unsigned(record)), record.composite_sig as CompositeSignature, classical.public_key_b64, pq.public_key_b64);
      return r.valid && r.classical_valid && r.pq_valid;
    } catch {
      return false;
    }
  };
  if (!(await verifies(DCP_CONTEXTS.Awareness, u, uc, up))) fail('ACK_THRESHOLD_SIGNATURE_INVALID', 'the threshold does not verify under DCP-AI.v2.Awareness');
  if (!(await verifies(MANDATE_ACKNOWLEDGMENT_CONTEXT, k, kc, kp))) fail('ACK_SIGNATURE_INVALID', 'the acknowledgment does not verify under DCP-AI.v2.MandateAcknowledgment');
  if (failed) return null;

  // D. Own time, T1 to T4 (design § 6)
  const at = instant(k.acknowledged_at);
  if (at < instant(m.timestamp)) fail('ACK_TIME_INVALID', 'T1: acknowledged_at is before the mandate timestamp');
  if (at < instant(u.timestamp)) fail('ACK_TIME_INVALID', 'T2: acknowledged_at is before the threshold timestamp');
  if (at > instant(m.valid_until)) fail('ACK_TIME_INVALID', 'T3: acknowledged_at is after the mandate valid_until');
  if (at > verified.nowMs + SESSION_CLOCK_SKEW_MS) fail('ACK_TIME_INVALID', 'T4: acknowledged_at is after now plus the clock skew');
  return failed ? null : resolved;
}
