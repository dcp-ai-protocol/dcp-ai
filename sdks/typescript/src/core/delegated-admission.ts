/**
 * Delegated admission (opt-in): a leaf bundle admitted together with the DCP-09 mandate chain it acts
 * under and a bundle of every delegating agent, at one instant, against the operator's trust set,
 * policy and revocation sources. Design: docs/reviews/mp02-security-composition-design.md (v0.2 § 1).
 *
 * Everything is verified here, from the evidence itself: no verification result, key map or boolean is
 * taken from the caller. The chain floor (DCP-09 § 3.5.2 rule 6) is fed to the leaf's own tier
 * computation, so it raises the mode its signatures are verified in. Admission is not authorization:
 * action_authorized is always false, and activation (the agent's acknowledgment, DCP-09 § 3.3) is not
 * evaluated yet.
 *
 * Existing APIs are unchanged: verifyMandateChain, verifySignedBundleV2 and admitSignedBundleV2 keep
 * their behavior; the stricter checks below apply to this function only.
 */

import type { SecurityTier, SignedBundleV2, VerificationMode, VerifierPolicy } from '../types/v2.js';
import type { AlgorithmRegistry } from './crypto-registry.js';
import { deriveKid, type KeyEntry } from './crypto-provider.js';
import { canonicalizeV2 } from './canonicalize.js';
import { sha256Hex } from './dual-hash.js';
import { parseRfc3339 } from './session-nonce.js';
import { isSchemaDateTime } from './schema-v2.js';
import { verifyMandateChain } from './delegation.js';
import { maxTier } from './security-tier.js';
import {
  DEFAULT_VERIFIER_POLICY,
  SESSION_CLOCK_SKEW_MS,
  canonicalB64Bytes,
  verifySignedBundleV2WithProfile,
} from './verify-v2.js';
import {
  AdmissionConfigError,
  createPrincipalTrustStore,
  evaluateAdmissionV2,
  isPrincipalTrustStore,
  isStrictV1Profile,
  resolveStrictV1Profile,
  revocationSubjects,
  trustedKeyError,
  type AdmissionCode,
  type AdmissionResult,
  type PrincipalTrustSet,
  type PrincipalTrustStore,
  type RevocationSnapshot,
  type RevocationStatus,
  type StrictV1Profile,
  type StrictV1ProfileConfig,
} from './admission.js';

export type DelegationCode =
  | AdmissionCode
  | 'DELEGATION_INPUT_INVALID'
  | 'DELEGATION_CHAIN_INVALID'
  | 'DELEGATION_ALGORITHM_REJECTED'
  | 'DELEGATION_PRINCIPAL_MISMATCH'
  | 'DELEGATION_LEAF_MISMATCH'
  | 'DELEGATION_DELEGATOR_MISSING'
  | 'DELEGATION_DELEGATOR_UNEXPECTED'
  | 'DELEGATION_DELEGATOR_NOT_ADMITTED'
  | 'DELEGATION_REPEATED_ID'
  | 'DELEGATION_KEY_AMBIGUOUS'
  | 'DELEGATION_FLOOR_MISMATCH';

export interface DelegationError {
  code: DelegationCode;
  message: string;
}

/** Revocation status of mandates, as of `checked_at`: the shape of a revocation snapshot, for mandate ids. */
export interface MandateRevocationSnapshot {
  checked_at: string;
  mandates: Record<string, RevocationStatus>;
}

/** What the request may carry. Every value is copied as JSON data before anything is verified. */
export interface DelegatedEvidence {
  /** The bundle of the acting agent: the agent_id of the chain's last mandate. */
  signedBundle: unknown;
  /** The mandate chain, root first. */
  mandateChain: unknown;
  /** One bundle of each delegating agent (every mandate's agent_id but the last), signed by the same principal. */
  delegatorBundles?: unknown;
}

/** What only the operator sets (spec/profiles/admission A2): never taken from the request. */
export interface DelegatedOperator {
  /** Required: a loaded trust store (used as it is, immutable) or a trust set (loaded at the call). */
  trust: PrincipalTrustStore | PrincipalTrustSet;
  /** A strict-v1 profile or its configuration. Excludes `policy` and `maxRevocationAgeSeconds`. */
  profile?: StrictV1Profile | StrictV1ProfileConfig;
  /** The verifier policy without a profile. Default DEFAULT_VERIFIER_POLICY. */
  policy?: VerifierPolicy;
  /** Snapshot for every agent and key of the composition. Absent or null: the source could not answer. */
  revocation?: RevocationSnapshot | null;
  /** Snapshot for every mandate of the chain. Absent or null: the source could not answer. */
  mandateRevocation?: MandateRevocationSnapshot | null;
  /** Without a profile, required: an integer from 1 to 300. With a profile, the profile's applies. */
  maxRevocationAgeSeconds?: number;
  /** Milliseconds since the epoch, read once. Default Date.now(). */
  now?: number;
}

export interface DelegatedAdmissionResult {
  /** The leaf, the chain and every delegator verified, anchored and not revoked, with no code added. */
  admitted: boolean;
  /** The chain verified with keys taken from the verified bundles and is tied to the principal and the leaf. */
  delegation_verified: boolean;
  /** The agent's acknowledgment (DCP-09 § 3.3) is not evaluated yet. */
  activation: 'not_evaluated';
  /** Always false until acknowledgments are evaluated. */
  delegation_active: false;
  /** Always false: admission authorizes no action. */
  action_authorized: false;
  /** The leaf's tier and mode, from its verification with the chain floor; null when it did not verify. */
  security_tier: SecurityTier | null;
  verification_mode: VerificationMode | null;
  chain: {
    depth: number;
    mandate_ids: string[];
    /** The verified chain's effective tier, or null. */
    effective_floor: SecurityTier | null;
    /** A copy of the leaf mandate's authority_scope, not evaluated against any action. */
    leaf_authority_scope: unknown;
  } | null;
  leaf: AdmissionResult | null;
  /** The admission of each delegator bundle, in the order given. */
  delegators: AdmissionResult[];
  inputs: {
    now: number;
    leaf_bundle_sha256: string | null;
    trust_set_version: string;
    revocation_checked_at: string | null;
    mandate_revocation_checked_at: string | null;
  };
  errors: DelegationError[];
}

const MAX_MESSAGE = 500;
const MAX_SECONDS = 300;
const NONCE = /^[0-9a-f]{64}$/;
const KID = /^[0-9a-f]{32}$/;
const KEY_BYTES: Readonly<Record<string, number>> = { ed25519: 32, 'ml-dsa-65': 1952, 'slh-dsa-192f': 48 };
const SIG_BYTES: Readonly<Record<string, number>> = { ed25519: 64, 'ml-dsa-65': 3309, 'slh-dsa-192f': 35664 };
const CLASSICAL_ALGS: readonly string[] = ['ed25519'];
const PQ_ALGS: readonly string[] = ['ml-dsa-65', 'slh-dsa-192f'];
const TIERS: readonly unknown[] = ['routine', 'standard', 'elevated', 'maximum'];
const REVOCATION_STATUSES: readonly unknown[] = ['revoked', 'not_revoked', 'unknown'];
// The shape of schemas/v2/delegation_mandate.schema.json, checked by the parity test. @internal
export const MANDATE_FIELDS: readonly string[] = [
  'dcp_version', 'mandate_id', 'session_nonce', 'human_id', 'agent_id', 'authority_scope', 'valid_from',
  'valid_until', 'revocable', 'timestamp', 'parent_mandate_id', 'delegation_depth', 'sub_delegation',
  'minimum_security_tier', 'human_composite_sig', 'delegator_composite_sig',
];
export const MANDATE_REQUIRED: readonly string[] = [
  'dcp_version', 'mandate_id', 'session_nonce', 'human_id', 'agent_id', 'authority_scope', 'valid_from',
  'valid_until', 'revocable', 'timestamp',
];
/** authority_scope items: closed, with domain and actions_permitted required; limits is an open object. */
export const SCOPE_FIELDS: readonly string[] = ['domain', 'actions_permitted', 'data_classes', 'limits'];
export const SCOPE_REQUIRED: readonly string[] = ['domain', 'actions_permitted'];
/** sub_delegation: closed, both members required. */
export const SUB_DELEGATION_FIELDS: readonly string[] = ['permitted', 'max_depth'];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** @internal */
export const bounded = (message: string) => (message.length > MAX_MESSAGE ? `${message.slice(0, MAX_MESSAGE - 1)}…` : message);
/** @internal */
export const printable = (v: unknown) =>
  typeof v === 'string' ? JSON.stringify(v.length > 80 ? `${v.slice(0, 80)}…` : v) : v === null ? 'null' : typeof v;
/** @internal */
export const codePoints = (s: string) => [...s].length;

// ── Snapshot: JSON data only ──

/** @internal A request value that is not JSON data; also read by the mandate acknowledgment. */
export class InputError extends Error {}

/**
 * A copy of `value` made of JSON values only: plain or null-prototype objects with string keys and data
 * properties, dense arrays, strings, finite numbers, booleans and null. Anything else (a cycle, an accessor
 * property, a Map, a Date, a class instance, a symbol key, a non-enumerable property, undefined, a function,
 * a bigint) throws InputError; nothing is converted. Accessors are detected from their descriptors, never
 * called. A Proxy's traps still run, once, during this copy; the copy is all that is read afterwards.
 */
export function jsonCopy(value: unknown, where: string, ancestors: Set<object> = new Set()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new InputError(`${where} is not a finite number`);
    return value;
  }
  if (typeof value !== 'object') throw new InputError(`${where} is not a JSON value (${typeof value})`);
  if (ancestors.has(value)) throw new InputError(`${where} contains a cycle`);
  ancestors.add(value);
  try {
    const keys = Reflect.ownKeys(value);
    if (Array.isArray(value)) {
      const length = (Object.getOwnPropertyDescriptor(value, 'length') as PropertyDescriptor).value as number;
      if (keys.length !== length + 1) throw new InputError(`${where} is a sparse array or has extra members`);
      const out: unknown[] = [];
      for (let i = 0; i < length; i++) out.push(jsonCopy(dataProperty(value, String(i), `${where}[${i}]`), `${where}[${i}]`, ancestors));
      return out;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new InputError(`${where} is not a plain object`);
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      if (typeof key !== 'string') throw new InputError(`${where} has a symbol key`);
      const member = jsonCopy(dataProperty(value, key, `${where}.${key}`), `${where}.${key}`, ancestors);
      // defineProperty, not assignment: a "__proto__" member stays an own member, as JSON.parse makes it.
      Object.defineProperty(out, key, { value: member, enumerable: true, writable: true, configurable: true });
    }
    return out;
  } finally {
    ancestors.delete(value);
  }
}

/** @internal */
export function dataProperty(value: object, key: string, where: string): unknown {
  const d = Object.getOwnPropertyDescriptor(value, key);
  if (!d) throw new InputError(`${where} is missing`);
  if (!('value' in d)) throw new InputError(`${where} is an accessor property`);
  if (!d.enumerable) throw new InputError(`${where} is not enumerable`);
  return d.value;
}

const configError = (message: string): never => {
  throw new AdmissionConfigError('CONFIG_INVALID_VALUE', message);
};

/** An operator value copied as JSON; a value that is not JSON data is a configuration error. */
function configCopy(value: unknown, where: string): unknown {
  try {
    return jsonCopy(value, where);
  } catch (e) {
    if (e instanceof InputError) return configError(e.message);
    throw e;
  }
}

/** A revocation input copied as JSON; anything that is not JSON data reads as malformed (REVOCATION_INVALID). */
const MALFORMED = Symbol('malformed');
function snapshotCopy(value: unknown, where: string): unknown {
  if (value === undefined || value === null) return null;
  try {
    return jsonCopy(value, where);
  } catch (e) {
    if (e instanceof InputError) return MALFORMED;
    throw e;
  }
}

// ── Verifier policy without a profile: the shape of schemas/v2/verifier_policy.schema.json ──

const MODE_VALUES: readonly unknown[] = ['classical_only', 'pq_only', 'hybrid_required', 'hybrid_preferred'];

/** One member of the verifier policy schema. @internal Exported for the parity test against the schema. */
export interface PolicyFieldRule {
  type: 'string' | 'boolean' | 'integer' | 'string_array' | 'mode' | 'risk_overrides';
  minimum?: number;
  minItems?: number;
}

/** @internal The members of schemas/v2/verifier_policy.schema.json, checked by the parity test. */
export const POLICY_FIELDS: Readonly<Record<string, PolicyFieldRule>> = {
  default_mode: { type: 'mode' },
  risk_overrides: { type: 'risk_overrides' },
  min_classical: { type: 'integer', minimum: 0 },
  min_pq: { type: 'integer', minimum: 0 },
  accepted_classical_algs: { type: 'string_array', minItems: 1 },
  accepted_pq_algs: { type: 'string_array' },
  accepted_hash_algs: { type: 'string_array', minItems: 1 },
  require_session_binding: { type: 'boolean' },
  require_composite_binding: { type: 'boolean' },
  max_key_age_days: { type: 'integer', minimum: 1 },
  allow_v1_bundles: { type: 'boolean' },
  allow_classical_fallback_disable: { type: 'boolean' },
  warn_classical_only_deprecated: { type: 'boolean' },
  advisory_rejected_algs: { type: 'string_array' },
  require_session_expiry: { type: 'boolean' },
  max_session_duration_seconds: { type: 'integer', minimum: 0 },
  require_audience_binding: { type: 'boolean' },
  verifier_id: { type: 'string' },
};

/** @internal The required members of the same schema. */
export const POLICY_REQUIRED: readonly string[] = [
  'default_mode', 'risk_overrides', 'min_classical', 'min_pq', 'accepted_classical_algs', 'accepted_pq_algs',
  'accepted_hash_algs', 'require_session_binding', 'require_composite_binding', 'max_key_age_days', 'allow_v1_bundles',
];

/**
 * A verifier policy given without a profile, checked against the policy schema: no unknown member
 * (CONFIG_UNKNOWN_FIELD), every required member, and each member of its type, enumeration and bounds
 * (CONFIG_INVALID_VALUE). Nothing is defaulted or converted. @internal
 */
export function checkVerifierPolicy(policy: unknown): VerifierPolicy {
  if (!isObject(policy)) return configError('policy must be an object');
  for (const key of Object.keys(policy)) {
    if (!Object.hasOwn(POLICY_FIELDS, key)) throw new AdmissionConfigError('CONFIG_UNKNOWN_FIELD', `policy: unknown field ${printable(key)}`);
  }
  for (const key of POLICY_REQUIRED) if (!Object.hasOwn(policy, key)) configError(`policy.${key} is required`);
  for (const [key, value] of Object.entries(policy)) {
    const rule = POLICY_FIELDS[key];
    const bad = (what: string) => configError(`policy.${key} ${what}`);
    switch (rule.type) {
      case 'string':
        if (typeof value !== 'string') bad('must be a string');
        break;
      case 'boolean':
        if (typeof value !== 'boolean') bad('must be a boolean');
        break;
      case 'integer':
        if (!Number.isInteger(value)) bad('must be an integer');
        if (rule.minimum !== undefined && (value as number) < rule.minimum) bad(`must be at least ${rule.minimum}`);
        break;
      case 'string_array':
        if (!Array.isArray(value) || !value.every((s) => typeof s === 'string')) bad('must be a list of strings');
        if (rule.minItems !== undefined && (value as unknown[]).length < rule.minItems) bad(`must have at least ${rule.minItems} item(s)`);
        break;
      case 'mode':
        if (!MODE_VALUES.includes(value)) bad('must be a verification mode');
        break;
      case 'risk_overrides': {
        if (!isObject(value)) bad('must be an object');
        const tiers = ['low', 'medium', 'high'];
        for (const tier of Object.keys(value as object)) {
          if (!tiers.includes(tier)) throw new AdmissionConfigError('CONFIG_UNKNOWN_FIELD', `policy.risk_overrides: unknown field ${printable(tier)}`);
        }
        for (const tier of tiers) {
          if (!MODE_VALUES.includes((value as Record<string, unknown>)[tier])) bad(`.${tier} must be a verification mode`);
        }
        break;
      }
    }
  }
  checkPolicyContract(policy);
  return policy as unknown as VerifierPolicy;
}

/** The largest max_session_duration_seconds this API takes: an int32, held by every SDK without overflow. */
const POLICY_CONTRACT_MAX_SESSION = 2147483647;

/**
 * The policy contract of the composition (design R4): the members no verifier applies as a control must take
 * the values that add none. min_pq 1; min_classical 1, or 0 when every mode is pq_only; require_composite_binding
 * true, or false when every mode is pq_only; require_session_binding true; accepted_hash_algs exactly the set
 * {sha256, sha384}; max_key_age_days 365 (it changes warnings only, never a verdict); max_session_duration_seconds
 * from 0 to 2147483647. The other members are applied by every SDK verifier, or have no effect by norm
 * (allow_v1_bundles: admission § 5.1 step 2; the warnings of V2-10). Anything else is CONFIG_INVALID_VALUE: a
 * control that would not be applied.
 */
function checkPolicyContract(p: Record<string, unknown>): void {
  const o = p.risk_overrides as Record<string, unknown>;
  const allPQ = p.default_mode === 'pq_only' && o.low === 'pq_only' && o.medium === 'pq_only' && o.high === 'pq_only';
  const invalid = (what: string) => configError(`policy contract: ${what}`);
  if (p.min_pq !== 1) invalid('min_pq must be 1: the effective mode decides whether a PQ component is required');
  if (!(p.min_classical === 1 || (p.min_classical === 0 && allPQ))) invalid('min_classical must be 1, or 0 when every mode is pq_only');
  if (!(p.require_composite_binding === true || allPQ)) invalid('require_composite_binding must be true, or false when every mode is pq_only');
  if (p.require_session_binding !== true) invalid('require_session_binding must be true (V2-4)');
  const hashes = p.accepted_hash_algs as string[];
  if (!(hashes.length === 2 && hashes.includes('sha256') && hashes.includes('sha384'))) invalid('accepted_hash_algs must be the set sha256, sha384');
  if (p.max_key_age_days !== 365) invalid('max_key_age_days must be 365');
  if (p.max_session_duration_seconds !== undefined && (p.max_session_duration_seconds as number) > POLICY_CONTRACT_MAX_SESSION) {
    invalid(`max_session_duration_seconds must be at most ${POLICY_CONTRACT_MAX_SESSION}`);
  }
}

// ── Mandate preflight (this function only) ──

/** Why a composite signature slot is not a well-formed pq_over_classical signature, or undefined. */
/** @internal Also the form of an acknowledgment's or a threshold's composite_sig. */
export function signatureSlotError(sig: unknown, field: string): string | undefined {
  if (!isObject(sig)) return `${field} is not an object`;
  for (const key of Object.keys(sig)) if (!['classical', 'pq', 'binding'].includes(key)) return `${field} has unknown member ${printable(key)}`;
  if (sig.binding !== 'pq_over_classical') return `${field} binding must be pq_over_classical`;
  for (const [component, algs] of [['classical', CLASSICAL_ALGS], ['pq', PQ_ALGS]] as const) {
    const entry = sig[component];
    const at = `${field}.${component}`;
    if (!isObject(entry)) return `${at} is not an object`;
    for (const key of Object.keys(entry)) if (!['alg', 'kid', 'sig_b64'].includes(key)) return `${at} has unknown member ${printable(key)}`;
    if (typeof entry.alg !== 'string' || !algs.includes(entry.alg)) return `${at}.alg ${printable(entry.alg)} is not a ${component} algorithm`;
    if (typeof entry.kid !== 'string' || !KID.test(entry.kid)) return `${at}.kid is not 32 lowercase hex digits`;
    const bytes = canonicalB64Bytes(entry.sig_b64);
    if (!bytes) return `${at}.sig_b64 is not canonical base64 (V2-5)`;
    if (bytes.length !== SIG_BYTES[entry.alg]) return `${at}.sig_b64 is ${bytes.length} bytes, not a ${entry.alg} signature (${SIG_BYTES[entry.alg]})`;
  }
  return undefined;
}

const isNonEmptyStringList = (v: unknown): boolean => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length > 0);

/**
 * authority_scope as the schema has it: a non-empty array of closed objects; domain a non-empty string;
 * actions_permitted and data_classes lists of non-empty strings (an empty list is allowed); limits an object
 * whose members are not constrained here (DCP-09 § 3.5.2 rule 5 reads them; the schema leaves it open).
 */
function scopeShapeErrors(scope: unknown): string[] {
  if (!Array.isArray(scope) || scope.length === 0) return ['authority_scope must be a non-empty array'];
  const errors: string[] = [];
  scope.forEach((e, j) => {
    const w = `authority_scope[${j}]`;
    if (!isObject(e)) {
      errors.push(`${w} is not an object`);
      return;
    }
    for (const key of Object.keys(e)) if (!SCOPE_FIELDS.includes(key)) errors.push(`${w} has unknown member ${printable(key)}`);
    for (const key of SCOPE_REQUIRED) if (!Object.hasOwn(e, key)) errors.push(`${w} is missing ${key}`);
    if (Object.hasOwn(e, 'domain') && !(typeof e.domain === 'string' && e.domain.length > 0)) errors.push(`${w}.domain must be a non-empty string`);
    for (const key of ['actions_permitted', 'data_classes']) {
      if (Object.hasOwn(e, key) && !isNonEmptyStringList(e[key])) errors.push(`${w}.${key} must be a list of non-empty strings`);
    }
    if (Object.hasOwn(e, 'limits') && !isObject(e.limits)) errors.push(`${w}.limits must be an object`);
  });
  return errors;
}

/** The fields of the mandate schema this function requires before the chain verifier runs (depth i). */
/** @internal */
export function mandatePreflight(m: unknown, i: number): string[] {
  const at = (e: string) => `mandate[${i}]: ${e}`;
  if (!isObject(m)) return [at('not an object')];
  const errors: string[] = [];
  for (const key of Object.keys(m)) if (!MANDATE_FIELDS.includes(key)) errors.push(at(`unknown field ${printable(key)}`));
  for (const key of MANDATE_REQUIRED) if (!Object.hasOwn(m, key)) errors.push(at(`missing ${key}`));
  if (m.dcp_version !== '2.0') errors.push(at('dcp_version must be "2.0"'));
  if (typeof m.session_nonce !== 'string' || !NONCE.test(m.session_nonce)) errors.push(at('session_nonce is not 64 lowercase hex digits'));
  for (const field of ['mandate_id', 'human_id', 'agent_id']) {
    const v = m[field];
    if (typeof v !== 'string' || codePoints(v) < 6) errors.push(at(`${field} must be a string of at least 6 characters`));
  }
  if (Object.hasOwn(m, 'parent_mandate_id') && (typeof m.parent_mandate_id !== 'string' || codePoints(m.parent_mandate_id) < 6)) {
    errors.push(at('parent_mandate_id must be a string of at least 6 characters'));
  }
  if (typeof m.revocable !== 'boolean') errors.push(at('revocable must be a boolean'));
  for (const field of ['valid_from', 'valid_until', 'timestamp']) {
    const v = m[field];
    if (typeof v !== 'string' || !isSchemaDateTime(v) || parseRfc3339(v) === undefined) errors.push(at(`${field} is not an RFC 3339 date-time`));
  }
  if (Object.hasOwn(m, 'delegation_depth') && !(Number.isInteger(m.delegation_depth) && (m.delegation_depth as number) >= 0)) {
    errors.push(at('delegation_depth must be an integer >= 0'));
  }
  // The schema's oneOf: a root has no parent and depth 0 or none; a sub-mandate has both, depth >= 1.
  if (i === 0) {
    if (Object.hasOwn(m, 'parent_mandate_id')) errors.push(at('a root mandate has no parent_mandate_id'));
    if (Object.hasOwn(m, 'delegation_depth') && m.delegation_depth !== 0) errors.push(at('a root mandate has delegation_depth 0'));
  } else {
    if (!Object.hasOwn(m, 'parent_mandate_id')) errors.push(at('missing parent_mandate_id'));
    if (!Object.hasOwn(m, 'delegation_depth')) errors.push(at('missing delegation_depth'));
    else if ((m.delegation_depth as number) < 1) errors.push(at('a sub-mandate has delegation_depth >= 1'));
  }
  errors.push(...scopeShapeErrors(m.authority_scope).map(at));
  if (Object.hasOwn(m, 'sub_delegation')) {
    const sd = m.sub_delegation;
    if (!isObject(sd)) {
      errors.push(at('sub_delegation is not an object'));
    } else {
      for (const key of Object.keys(sd)) if (!SUB_DELEGATION_FIELDS.includes(key)) errors.push(at(`sub_delegation has unknown member ${printable(key)}`));
      if (typeof sd.permitted !== 'boolean') errors.push(at('sub_delegation.permitted must be a boolean'));
      if (!(Number.isInteger(sd.max_depth) && (sd.max_depth as number) >= 0)) errors.push(at('sub_delegation.max_depth must be an integer >= 0'));
    }
  }
  if (Object.hasOwn(m, 'minimum_security_tier') && !TIERS.includes(m.minimum_security_tier)) {
    errors.push(at('minimum_security_tier is not routine, standard, elevated or maximum'));
  }
  // The slot of the mandate's depth, and only that one (the schema's oneOf; DCP-09 § 3.5.1).
  const [field, other] = i === 0 ? ['human_composite_sig', 'delegator_composite_sig'] : ['delegator_composite_sig', 'human_composite_sig'];
  if (!Object.hasOwn(m, field)) {
    errors.push(at(`missing ${field}`));
  } else {
    const slot = signatureSlotError(m[field], field);
    if (slot) errors.push(at(slot));
  }
  if (Object.hasOwn(m, other)) errors.push(at(`${other} is not allowed at this depth`));
  return errors;
}

/** The highest minimum_security_tier of the chain; a name that is not a tier counts as elevated. */
function provisionalFloor(chain: Record<string, unknown>[]): SecurityTier | null {
  let floor: SecurityTier | null = null;
  for (const m of chain) {
    if (m.minimum_security_tier === undefined) continue;
    const tier = (TIERS.includes(m.minimum_security_tier) ? m.minimum_security_tier : 'elevated') as SecurityTier;
    floor = floor === null ? tier : maxTier(floor, tier);
  }
  return floor;
}

// ── Revocation snapshots (§ 4.3 of the admission profile, for any subjects) ──

type Add = (code: DelegationCode, message: string) => void;

function snapshotChecks(
  snapshot: unknown,
  maps: ReadonlyArray<readonly [kind: string, field: string, ids: readonly string[]]>,
  maxAgeSeconds: number,
  now: number,
  add: Add,
): void {
  const label = maps.map(([kind]) => kind).join(' and ');
  if (snapshot === null) {
    add('REVOCATION_UNAVAILABLE', `no ${label} revocation status could be obtained`);
    return;
  }
  const fields = ['checked_at', ...maps.map(([, field]) => field)];
  const valid =
    isObject(snapshot) &&
    Object.keys(snapshot).length === fields.length &&
    fields.every((f) => Object.hasOwn(snapshot, f)) &&
    parseRfc3339(snapshot.checked_at) !== undefined &&
    maps.every(([, field]) => isObject(snapshot[field]) && Object.values(snapshot[field] as object).every((s) => REVOCATION_STATUSES.includes(s)));
  if (!valid) {
    add('REVOCATION_INVALID', `the ${label} revocation snapshot is malformed`);
    return;
  }
  const s = snapshot as Record<string, unknown>;
  const checkedAt = parseRfc3339(s.checked_at) as number;
  if (checkedAt > now + SESSION_CLOCK_SKEW_MS) {
    add('REVOCATION_INVALID', `the ${label} revocation snapshot is dated in the future`);
    return;
  }
  if (now - checkedAt > maxAgeSeconds * 1000) add('REVOCATION_STALE', `the ${label} revocation snapshot is older than ${maxAgeSeconds} s`);
  for (const [kind, field, ids] of maps) {
    const map = s[field] as Record<string, unknown>;
    for (const id of ids) {
      const status = Object.hasOwn(map, id) ? map[id] : undefined;
      if (status === 'revoked') add('REVOCATION_REVOKED', `${kind} ${printable(id)} is revoked`);
      else if (status !== 'not_revoked') add('REVOCATION_UNKNOWN', `the revocation status of ${kind} ${printable(id)} is unknown`);
    }
  }
}

// ── Keys ──

const keyIdentity = (k: KeyEntry) => `${k.alg}\u0000${k.public_key_b64}`;

/** A key entry that can verify `alg` with this `kid`: canonical base64 of the algorithm's size, kid derived (V2-13). */
/** @internal */
export function usedKeyError(key: KeyEntry | undefined, kid: string, alg: string, where: string): string | undefined {
  if (!key) return undefined; // the chain verifier reports a kid it cannot find
  if (key.alg !== alg) return `${where}: key ${kid} is ${printable(key.alg)}, not ${alg}`;
  const bytes = canonicalB64Bytes(key.public_key_b64);
  if (!bytes || bytes.length !== KEY_BYTES[alg]) return `${where}: key ${kid} is not a canonical base64 ${alg} public key`;
  if (deriveKid(alg, bytes) !== kid) return `${where}: kid ${kid} is not derived from its key (V2-13)`;
  return undefined;
}

const keysOf = (bundle: unknown, artifact: 'responsible_principal_record' | 'agent_passport', field: string): unknown[] => {
  const b = isObject(bundle) && isObject(bundle.bundle) ? bundle.bundle : undefined;
  const signed = b?.[artifact];
  const payload = isObject(signed) && isObject(signed.payload) ? signed.payload : undefined;
  const keys = payload?.[field];
  return Array.isArray(keys) ? keys : [];
};

const payloadField = (bundle: unknown, artifact: string, field: string): unknown => {
  const b = isObject(bundle) && isObject(bundle.bundle) ? bundle.bundle : undefined;
  const signed = b?.[artifact];
  return isObject(signed) && isObject(signed.payload) ? signed.payload[field] : undefined;
};

/** @internal Everything admitDelegatedBundleV2 reads from its caller, copied before any await (F4 design § 10.1). */
export interface DelegatedSnapshot {
  nowMs: number;
  trust: PrincipalTrustStore;
  profile: StrictV1Profile | undefined;
  policy: VerifierPolicy;
  maxAge: number;
  /** A copy, null (the source could not answer) or MALFORMED. */
  revocation: unknown;
  mandateRevocation: unknown;
  evidence: { leafBundle: unknown; chain: unknown[]; delegatorBundles: unknown[] } | { inputError: string };
}

/**
 * @internal What an admitted composition verified, as references to the snapshot's copies or values derived
 * from them during that composition. Read by the mandate acknowledgment only; never modified.
 */
export interface DelegatedVerified {
  nowMs: number;
  mandates: Record<string, unknown>[];
  agentIds: string[];
  /** The passport keys of every agent of the chain (the delegators and the leaf), from bundles that verified. */
  agentKeys: Record<string, KeyEntry[]>;
  policy: VerifierPolicy;
  /** The leaf's verification mode, the one step 7 applied. */
  mode: VerificationMode;
  revocation: RevocationSnapshot;
  /** The key ids step 10 looked up in `revocation`. */
  checkedKids: ReadonlySet<string>;
}

/**
 * @internal Step 0 of admitDelegatedBundleV2: the operator configuration, read once, then every copy of the
 * evidence, before any await. Throws AdmissionConfigError as before and in the same order; evidence that is not
 * JSON data is recorded, not thrown, and any other exception propagates as before.
 */
export function takeDelegatedSnapshot(evidence: DelegatedEvidence, operator: DelegatedOperator): DelegatedSnapshot {
  if (!isObject(operator)) configError('the operator configuration must be an object');
  // Each operator field is read once; the values are then copied or are immutable loaded objects.
  const {
    trust: trustIn,
    profile: profileIn,
    policy: policyIn,
    revocation: revocationIn,
    mandateRevocation: mandateRevocationIn,
    maxRevocationAgeSeconds: maxAgeIn,
    now: nowIn,
  } = operator;
  const now = nowIn === undefined ? Date.now() : nowIn;
  if (typeof now !== 'number' || !Number.isFinite(now)) configError('now must be a finite number of milliseconds');
  const nowMs = Math.floor(now);

  if (trustIn === undefined || trustIn === null) configError('delegated admission requires a trust set');
  const trust = isPrincipalTrustStore(trustIn) ? trustIn : createPrincipalTrustStore(configCopy(trustIn, 'trust'));

  let profile: StrictV1Profile | undefined;
  if (profileIn !== undefined) {
    profile = isStrictV1Profile(profileIn) ? profileIn : resolveStrictV1Profile(configCopy(profileIn, 'profile'));
    if (policyIn !== undefined) {
      throw new AdmissionConfigError('CONFIG_PROFILE_CONTRADICTION', 'a strict-v1 profile sets its own verifier policy; do not pass one');
    }
    if (maxAgeIn !== undefined) {
      throw new AdmissionConfigError('CONFIG_PROFILE_CONTRADICTION', 'a strict-v1 profile sets max_revocation_age_seconds; do not pass one');
    }
  }
  let maxAge: number;
  if (profile) {
    maxAge = profile.maxRevocationAgeSeconds;
  } else {
    if (!(Number.isInteger(maxAgeIn) && (maxAgeIn as number) >= 1 && (maxAgeIn as number) <= MAX_SECONDS)) {
      configError(`without a profile, maxRevocationAgeSeconds must be an integer from 1 to ${MAX_SECONDS}`);
    }
    maxAge = maxAgeIn as number;
  }
  // Without a profile, the operator's policy is checked against the policy schema; a profile's is already resolved.
  const policy = profile ? (profile.policy as VerifierPolicy) : checkVerifierPolicy(configCopy(policyIn ?? DEFAULT_VERIFIER_POLICY, 'policy'));
  const revocation = snapshotCopy(revocationIn, 'revocation');
  const mandateRevocation = snapshotCopy(mandateRevocationIn, 'mandateRevocation');
  const config = { nowMs, trust, profile, policy, maxAge, revocation, mandateRevocation };

  try {
    if (!isObject(evidence)) throw new InputError('evidence is not an object');
    const leafBundle = jsonCopy(dataProperty(evidence, 'signedBundle', 'evidence.signedBundle'), 'signedBundle');
    const c = jsonCopy(dataProperty(evidence, 'mandateChain', 'evidence.mandateChain'), 'mandateChain');
    if (!Array.isArray(c)) throw new InputError('mandateChain is not an array');
    const d = Object.hasOwn(evidence, 'delegatorBundles')
      ? jsonCopy(dataProperty(evidence, 'delegatorBundles', 'evidence.delegatorBundles'), 'delegatorBundles')
      : [];
    if (!Array.isArray(d)) throw new InputError('delegatorBundles is not an array');
    return { ...config, evidence: { leafBundle, chain: c, delegatorBundles: d } };
  } catch (e) {
    if (!(e instanceof InputError)) throw e;
    return { ...config, evidence: { inputError: e.message } };
  }
}

/**
 * Admit a leaf bundle with the mandate chain it acts under (design § 1.3). Throws AdmissionConfigError for
 * an invalid operator configuration; every problem with the evidence is a code in the result.
 *
 * The registry is a capability the operator trusts: it is used as given, not copied, and must not change
 * during the call. Every other input is copied before the first await, and only the copies are read.
 */
export async function admitDelegatedBundleV2(
  evidence: DelegatedEvidence,
  registry: AlgorithmRegistry,
  operator: DelegatedOperator,
): Promise<DelegatedAdmissionResult> {
  return (await composeDelegated(takeDelegatedSnapshot(evidence, operator), registry)).result;
}

/**
 * @internal Steps 1 to 11 of admitDelegatedBundleV2 over a snapshot, with the same codes, order and early returns.
 * `verified` is null unless the result is admitted.
 */
export async function composeDelegated(
  snapshot: DelegatedSnapshot,
  registry: AlgorithmRegistry,
): Promise<{ result: DelegatedAdmissionResult; verified: DelegatedVerified | null }> {
  const { nowMs, trust, profile, policy, maxAge, revocation, mandateRevocation } = snapshot;
  const errors: DelegationError[] = [];
  const add: Add = (code, message) => errors.push({ code, message: bounded(message) });
  const checkedAt = (s: unknown) => (isObject(s) && typeof s.checked_at === 'string' ? s.checked_at : null);
  const inputs: DelegatedAdmissionResult['inputs'] = {
    now: nowMs,
    leaf_bundle_sha256: null,
    trust_set_version: trust.version,
    revocation_checked_at: checkedAt(revocation),
    mandate_revocation_checked_at: checkedAt(mandateRevocation),
  };
  const result = (fields: Partial<DelegatedAdmissionResult>): DelegatedAdmissionResult => ({
    admitted: false,
    delegation_verified: false,
    activation: 'not_evaluated',
    delegation_active: false,
    action_authorized: false,
    security_tier: null,
    verification_mode: null,
    chain: null,
    leaf: null,
    delegators: [],
    inputs,
    errors,
    ...fields,
  });
  const early = () => ({ result: result({}), verified: null });

  if ('inputError' in snapshot.evidence) {
    add('DELEGATION_INPUT_INVALID', snapshot.evidence.inputError);
    return early();
  }
  const { leafBundle, chain, delegatorBundles } = snapshot.evidence;
  try {
    inputs.leaf_bundle_sha256 = sha256Hex(Buffer.from(canonicalizeV2(leafBundle), 'utf8'));
  } catch {
    // Not canonicalizable: the verifier rejects it below.
  }

  // ── 1. Form and preflight ──
  if (chain.length === 0) {
    add('DELEGATION_CHAIN_INVALID', 'the mandate chain is empty');
    return early();
  }
  for (let i = 0; i < chain.length; i++) for (const e of mandatePreflight(chain[i], i)) add('DELEGATION_CHAIN_INVALID', e);
  if (errors.length > 0) return early();
  const mandates = chain as Record<string, unknown>[];
  const mandateIds = mandates.map((m) => m.mandate_id as string);
  const agentIds = mandates.map((m) => m.agent_id as string);
  for (const [kind, ids] of [['mandate_id', mandateIds], ['agent_id', agentIds]] as const) {
    const repeated = ids.filter((id, i) => ids.indexOf(id) !== i);
    for (const id of new Set(repeated)) add('DELEGATION_REPEATED_ID', `${kind} ${printable(id)} appears more than once in the chain`);
  }
  if (errors.length > 0) return early();
  const humanId = mandates[0].human_id as string;
  const leafAgent = agentIds[agentIds.length - 1];
  const delegatingAgents = agentIds.slice(0, -1);

  // ── 2. Provisional floor: it can only make the bundle checks stricter ──
  const floor = provisionalFloor(mandates);

  // ── 3. Bundles: verified at the same instant with the floor, then admitted ──
  const admit = async (bundle: unknown): Promise<AdmissionResult> => {
    const verification = await verifySignedBundleV2WithProfile(bundle as SignedBundleV2, registry, policy, { now: nowMs }, 'dcp-jcs-v1', floor);
    return evaluateAdmissionV2({
      signedBundle: bundle,
      verification,
      profile,
      trust,
      revocation: revocation === MALFORMED ? {} as RevocationSnapshot : (revocation as RevocationSnapshot | null),
      now: nowMs,
    });
  };
  const leaf = await admit(leafBundle);
  const delegators: AdmissionResult[] = [];
  for (const bundle of delegatorBundles) delegators.push(await admit(bundle));

  // The leaf's own codes, but revocation, which step 10 evaluates once for every subject.
  for (const e of leaf.errors) if (!e.code.startsWith('REVOCATION_')) add(e.code, `leaf: ${e.message}`);

  // ── 4. Links ──
  let delegationProblem = false;
  const problem: Add = (code, message) => {
    delegationProblem = true;
    add(code, message);
  };
  const leafId = payloadField(leafBundle, 'agent_passport', 'agent_id');
  if (leafId !== leafAgent) problem('DELEGATION_LEAF_MISMATCH', `the leaf bundle's agent ${printable(leafId)} is not the last mandate's agent ${printable(leafAgent)}`);
  const leafPrincipal = payloadField(leafBundle, 'responsible_principal_record', 'human_id');
  if (leafPrincipal !== humanId) problem('DELEGATION_PRINCIPAL_MISMATCH', `the leaf bundle's principal ${printable(leafPrincipal)} is not the chain's ${printable(humanId)}`);

  const byAgent = new Map<string, number>();
  delegatorBundles.forEach((bundle, i) => {
    const id = payloadField(bundle, 'agent_passport', 'agent_id');
    const principal = payloadField(bundle, 'responsible_principal_record', 'human_id');
    if (principal !== humanId) {
      problem('DELEGATION_PRINCIPAL_MISMATCH', `delegatorBundles[${i}]: principal ${printable(principal)} is not the chain's ${printable(humanId)}`);
    }
    if (typeof id !== 'string' || !delegatingAgents.includes(id)) {
      problem('DELEGATION_DELEGATOR_UNEXPECTED', `delegatorBundles[${i}]: agent ${printable(id)} delegates nothing in this chain`);
    } else if (byAgent.has(id)) {
      problem('DELEGATION_DELEGATOR_UNEXPECTED', `delegatorBundles[${i}]: a second bundle of agent ${printable(id)}`);
    } else {
      byAgent.set(id, i);
    }
    if (!delegators[i].admitted) {
      problem('DELEGATION_DELEGATOR_NOT_ADMITTED', `delegatorBundles[${i}] is not admitted: ${delegators[i].errors.map((e) => e.code).join(', ')}`);
    }
  });
  for (const id of delegatingAgents) {
    if (!byAgent.has(id)) problem('DELEGATION_DELEGATOR_MISSING', `no bundle of delegating agent ${printable(id)}`);
  }

  // ── 5. Keys of every actor: the principal, each delegator and the leaf ──
  // Only from bundles that verified: an unverified bundle's keys are not the agent's keys.
  const leafVerified = leaf.verified;
  const actors: Array<{ label: string; lists: unknown[][] }> = [];
  const principalLists: unknown[][] = [];
  if (leafVerified) principalLists.push(keysOf(leafBundle, 'responsible_principal_record', 'binding_keys'));
  const agentKeys: Record<string, KeyEntry[]> = Object.create(null);
  for (const [id, i] of byAgent) {
    if (!delegators[i].verified) continue;
    principalLists.push(keysOf(delegatorBundles[i], 'responsible_principal_record', 'binding_keys'));
    agentKeys[id] = keysOf(delegatorBundles[i], 'agent_passport', 'keys') as KeyEntry[];
    actors.push({ label: `delegator ${id}`, lists: [agentKeys[id]] });
  }
  actors.unshift({ label: 'principal', lists: principalLists });
  if (leafVerified) actors.push({ label: `leaf ${leafAgent}`, lists: [keysOf(leafBundle, 'agent_passport', 'keys')] });

  const kidOwner = new Map<string, string>();
  const keyOwner = new Map<string, string>();
  const kidKey = new Map<string, string>();
  for (const actor of actors) {
    for (const list of actor.lists) {
      const seen = new Set<string>();
      for (const entry of list) {
        if (!isObject(entry) || typeof entry.kid !== 'string' || typeof entry.alg !== 'string' || typeof entry.public_key_b64 !== 'string') continue;
        const key = entry as unknown as KeyEntry;
        const identity = keyIdentity(key);
        if (seen.has(key.kid)) problem('DELEGATION_KEY_AMBIGUOUS', `${actor.label}: kid ${key.kid} is listed twice in one key list`);
        seen.add(key.kid);
        for (const [map, id] of [[kidOwner, key.kid], [keyOwner, identity]] as const) {
          const owner = map.get(id);
          if (owner !== undefined && owner !== actor.label) problem('DELEGATION_KEY_AMBIGUOUS', `kid ${key.kid}: the same key belongs to ${owner} and ${actor.label}`);
          else map.set(id, actor.label);
        }
        const known = kidKey.get(key.kid);
        if (known !== undefined && known !== identity) problem('DELEGATION_KEY_AMBIGUOUS', `${actor.label}: kid ${key.kid} names two different keys`);
        kidKey.set(key.kid, identity);
      }
    }
  }

  // The keys each mandate signature names, with their identity checked here (the chain verifier does not).
  const humanKeys = leafVerified ? (keysOf(leafBundle, 'responsible_principal_record', 'binding_keys') as KeyEntry[]) : [];
  const usedKids = new Set<string>();
  const slotOf = (i: number) => mandates[i][i === 0 ? 'human_composite_sig' : 'delegator_composite_sig'] as Record<string, Record<string, string>>;
  const listOf = (i: number): KeyEntry[] => (i === 0 ? humanKeys : agentKeys[agentIds[i - 1]] ?? []);
  for (let i = 0; i < mandates.length; i++) {
    const sig = slotOf(i);
    if (!isObject(sig)) continue;
    for (const component of ['classical', 'pq'] as const) {
      const { kid, alg } = sig[component];
      usedKids.add(kid);
      const error = usedKeyError(listOf(i).find((k) => isObject(k) && k.kid === kid), kid, alg, `mandate[${i}] ${component}`);
      if (error) problem('DELEGATION_CHAIN_INVALID', error);
    }
  }

  // ── 6. The chain, with the history API unchanged ──
  const revokedMandates = new Set<string>();
  if (isObject(mandateRevocation) && isObject(mandateRevocation.mandates)) {
    for (const [id, status] of Object.entries(mandateRevocation.mandates)) if (status === 'revoked') revokedMandates.add(id);
  }
  let chainFloor: SecurityTier | null = null;
  let chainValid = false;
  if (leafVerified) {
    const verdict = await verifyMandateChain(
      registry,
      mandates as unknown as Parameters<typeof verifyMandateChain>[1],
      revokedMandates,
      { human_keys: humanKeys, agent_keys: agentKeys },
      nowMs,
    );
    chainValid = verdict.valid;
    if (!verdict.valid) for (const e of verdict.errors) problem('DELEGATION_CHAIN_INVALID', e);
    else if (verdict.effective_tier !== floor) {
      problem('DELEGATION_FLOOR_MISMATCH', `the verified chain floor ${String(verdict.effective_tier)} is not the floor the bundles were verified with (${String(floor)})`);
    } else {
      chainFloor = verdict.effective_tier;
    }
  } else {
    problem('DELEGATION_CHAIN_INVALID', 'the chain is not verified: the leaf bundle, whose RPR holds the principal keys, did not verify');
  }

  // ── 7. Verifier policy on every chain signature component ──
  const mode = leaf.verification.details?.verification_mode ?? 'hybrid_required';
  const listed = (field: 'accepted_classical_algs' | 'accepted_pq_algs' | 'advisory_rejected_algs'): readonly unknown[] => {
    const value = policy[field];
    return Array.isArray(value) ? value : [];
  };
  for (let i = 0; i < mandates.length; i++) {
    const sig = slotOf(i);
    const classical = sig.classical.alg;
    const pq = sig.pq.alg;
    if (mode !== 'pq_only') {
      if (!listed('accepted_classical_algs').includes(classical)) problem('DELEGATION_ALGORITHM_REJECTED', `mandate[${i}]: classical algorithm ${classical} is not accepted by the verifier policy`);
      if (listed('advisory_rejected_algs').includes(classical)) problem('DELEGATION_ALGORITHM_REJECTED', `mandate[${i}]: classical algorithm ${classical} is rejected by an active advisory`);
    }
    if (!listed('accepted_pq_algs').includes(pq)) problem('DELEGATION_ALGORITHM_REJECTED', `mandate[${i}]: PQ algorithm ${pq} is not accepted by the verifier policy`);
    if (listed('advisory_rejected_algs').includes(pq)) problem('DELEGATION_ALGORITHM_REJECTED', `mandate[${i}]: PQ algorithm ${pq} is rejected by an active advisory`);
  }

  // ── 8. The root's components, each anchored in the current trust set ──
  const trusted = trust.principals.get(humanId);
  if (!trusted) {
    problem('TRUST_PRINCIPAL_UNKNOWN', `mandate[0]: principal ${printable(humanId)} is not in trust set ${printable(trust.version)}`);
  } else {
    const root = slotOf(0);
    for (const component of ['classical', 'pq'] as const) {
      const kid = root[component].kid;
      const key = humanKeys.find((k) => isObject(k) && k.kid === kid);
      if (!key) continue; // the chain verifier reports it
      const error = trustedKeyError(trusted, key, `mandate[0] ${component} key ${kid}`, nowMs);
      if (error) problem(error.code, error.message);
    }
  }

  // ── 9. session_nonce: the explicit rule ──
  // A mandate's nonce is its issuance session's; each bundle is an action session. No equality is required
  // between a mandate and any bundle, or between mandates; within each bundle V2-4 applies (step 3).

  // ── 10. Revocation of every subject of the composition ──
  const kids = new Set<string>(usedKids);
  const bundles: Array<[unknown, AdmissionResult]> = [[leafBundle, leaf], ...delegatorBundles.map((b, i) => [b, delegators[i]] as [unknown, AdmissionResult])];
  for (const [bundle, admission] of bundles) for (const kid of revocationSubjects(bundle, admission.verification).kids) kids.add(kid);
  snapshotChecks(revocation === MALFORMED ? {} : revocation, [['agent', 'agents', agentIds], ['key', 'keys', [...kids].sort()]], maxAge, nowMs, add);
  snapshotChecks(mandateRevocation === MALFORMED ? {} : mandateRevocation, [['mandate', 'mandates', mandateIds]], maxAge, nowMs, add);

  // ── 11. Result ──
  const delegationVerified = chainValid && chainFloor === floor && !delegationProblem;
  const leafScope = mandates[mandates.length - 1].authority_scope;
  const admitted = errors.length === 0 && leaf.admitted && delegators.every((d) => d.admitted) && delegationVerified;
  const outcome = result({
    admitted,
    delegation_verified: delegationVerified,
    security_tier: leafVerified ? leaf.verification.details?.resolved_tier ?? null : null,
    verification_mode: leafVerified ? leaf.verification.details?.verification_mode ?? null : null,
    chain: { depth: mandates.length - 1, mandate_ids: mandateIds, effective_floor: chainFloor, leaf_authority_scope: jsonCopy(leafScope, 'scope') },
    leaf,
    delegators,
  });
  if (!admitted) return { result: outcome, verified: null };
  // Admitted: the leaf and every delegator verified, so each agent's passport keys are its verified keys.
  const verifiedKeys: Record<string, KeyEntry[]> = Object.create(null);
  for (const id of delegatingAgents) verifiedKeys[id] = agentKeys[id];
  verifiedKeys[leafAgent] = keysOf(leafBundle, 'agent_passport', 'keys') as KeyEntry[];
  return {
    result: outcome,
    verified: {
      nowMs,
      mandates,
      agentIds,
      agentKeys: verifiedKeys,
      policy,
      mode: mode as VerificationMode,
      revocation: revocation as RevocationSnapshot,
      checkedKids: kids,
    },
  };
}
