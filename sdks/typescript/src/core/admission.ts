/**
 * Admission of V2 signed bundles: principal trust and the strict-v1 profile
 * (spec/profiles/admission). Deterministic and offline: the caller supplies the
 * trust set, the revocation snapshot and the clock. Verification itself is
 * verifySignedBundleV2's; admission only reads its result.
 */

import type { SignedBundleV2, VerificationMode, VerifierPolicy } from '../types/v2.js';
import type { AlgorithmRegistry } from './crypto-registry.js';
import { deriveKid } from './crypto-provider.js';
import { parseRfc3339 } from './session-nonce.js';
import {
  DEFAULT_VERIFIER_POLICY,
  SESSION_CLOCK_SKEW_MS,
  canonicalB64Bytes,
  verifySignedBundleV2,
  type SignerKeyUse,
  type VerifyV2Result,
} from './verify-v2.js';

export const STRICT_V1 = 'strict-v1' as const;

/** The longest session and the oldest revocation snapshot strict-v1 accepts, in seconds. */
export const STRICT_V1_MAX_SECONDS = 300;

export type AdmissionConfigCode =
  | 'CONFIG_UNKNOWN_FIELD'
  | 'CONFIG_INVALID_VALUE'
  | 'CONFIG_PROFILE_CONTRADICTION'
  | 'CONFIG_TRUST_EMPTY_ID'
  | 'CONFIG_TRUST_MALFORMED_KEY'
  | 'CONFIG_TRUST_KID_NOT_DERIVED'
  | 'CONFIG_TRUST_DUPLICATE';

export type AdmissionCode =
  | 'VERIFICATION_FAILED'
  | 'TRUST_PRINCIPAL_UNKNOWN'
  | 'TRUST_KEY_NOT_ANCHORED'
  | 'TRUST_KEY_REVOKED'
  | 'TRUST_KEY_EXPIRED'
  | 'TRUST_KEY_NOT_YET_VALID'
  | 'PROFILE_V2_REQUIRED'
  | 'PROFILE_AUDIENCE_MISSING'
  | 'PROFILE_AUDIENCE_MISMATCH'
  | 'PROFILE_SESSION_START_MISSING'
  | 'PROFILE_SESSION_EXPIRY_MISSING'
  | 'PROFILE_SESSION_TIME_INVALID'
  | 'PROFILE_SESSION_NOT_STARTED'
  | 'PROFILE_SESSION_EXPIRED'
  | 'PROFILE_SESSION_TOO_LONG'
  | 'PROFILE_HYBRID_REQUIRED'
  | 'REVOCATION_UNAVAILABLE'
  | 'REVOCATION_INVALID'
  | 'REVOCATION_STALE'
  | 'REVOCATION_REVOKED'
  | 'REVOCATION_UNKNOWN';

/** A trust set or profile that cannot be loaded. `code` is one of spec/profiles/admission § 5.3. */
export class AdmissionConfigError extends Error {
  constructor(
    readonly code: AdmissionConfigCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'AdmissionConfigError';
  }
}

const fail = (code: AdmissionConfigCode, message: string): never => {
  throw new AdmissionConfigError(code, message);
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInteger = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');

/** A short printable form of an untrusted value. */
function printable(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value.length > 80 ? `${value.slice(0, 80)}…` : value);
  if (value === null || value === undefined) return String(value);
  return typeof value === 'object' ? (Array.isArray(value) ? 'an array' : 'an object') : String(value);
}

function rejectUnknownFields(value: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail('CONFIG_UNKNOWN_FIELD', `${where}: unknown field ${printable(key)}`);
  }
}

// ── Trust set (§ 2.2) ──

export interface TrustedPrincipalKey {
  kid: string;
  alg: 'ed25519' | 'ml-dsa-65' | 'slh-dsa-192f';
  public_key_b64: string;
  status: 'active' | 'revoked' | 'expired';
  not_before?: string | null;
  expires_at?: string | null;
}

export interface PrincipalTrustSet {
  trust_set_version: string;
  principals: Array<{ human_id: string; keys: TrustedPrincipalKey[] }>;
}

interface TrustedKey {
  readonly alg: string;
  /** Canonical base64: one encoding per key, so equal strings are equal bytes. */
  readonly publicKeyB64: string;
  readonly status: TrustedPrincipalKey['status'];
  readonly notBefore?: number;
  readonly expiresAt?: number;
}

/** A Map that cannot be changed after it is built: a loaded trust set stays as it was validated. */
class FrozenMap<K, V> extends Map<K, V> {
  constructor(entries: Iterable<readonly [K, V]>) {
    super(); // Map(entries) would call the set below
    for (const [key, value] of entries) super.set(key, value);
  }
  override set(): this {
    throw new TypeError('a loaded trust set cannot be changed');
  }
  override delete(): boolean {
    throw new TypeError('a loaded trust set cannot be changed');
  }
  override clear(): void {
    throw new TypeError('a loaded trust set cannot be changed');
  }
}

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
};

/** A validated trust set: create it with createPrincipalTrustStore. */
export interface PrincipalTrustStore {
  readonly version: string;
  /** human_id → kid → trusted key. */
  readonly principals: ReadonlyMap<string, ReadonlyMap<string, TrustedKey>>;
}

const KEY_BYTES: Record<string, number> = { ed25519: 32, 'ml-dsa-65': 1952, 'slh-dsa-192f': 48 };
const KEY_STATUSES: readonly unknown[] = ['active', 'revoked', 'expired'];
const TRUST_STORES = new WeakSet<object>();

/** An optional RFC 3339 instant: undefined when absent or null; throws on anything else. */
function optionalInstant(value: unknown, where: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  const t = parseRfc3339(value);
  return t === undefined ? fail('CONFIG_INVALID_VALUE', `${where} is not an RFC 3339 timestamp`) : t;
}

/**
 * Validate a trust set (schemas/v2/principal_trust_set.schema.json, spec/profiles/admission § 2.2)
 * and return it as a store. Throws AdmissionConfigError on the first problem found.
 */
export function createPrincipalTrustStore(trustSet: unknown): PrincipalTrustStore {
  if (isPrincipalTrustStore(trustSet)) return trustSet;
  if (!isObject(trustSet)) fail('CONFIG_INVALID_VALUE', 'the trust set must be an object');
  const set = trustSet as Record<string, unknown>;
  rejectUnknownFields(set, ['trust_set_version', 'principals'], 'trust set');
  if (typeof set.trust_set_version !== 'string' || set.trust_set_version === '') {
    fail('CONFIG_INVALID_VALUE', 'trust_set_version must be a non-empty string');
  }
  if (!Array.isArray(set.principals)) fail('CONFIG_INVALID_VALUE', 'principals must be an array');

  const principals = new Map<string, Map<string, TrustedKey>>();
  const kids = new Set<string>();
  (set.principals as unknown[]).forEach((principal, i) => {
    const where = `principals[${i}]`;
    if (!isObject(principal)) fail('CONFIG_INVALID_VALUE', `${where} must be an object`);
    const p = principal as Record<string, unknown>;
    rejectUnknownFields(p, ['human_id', 'keys'], where);
    if (typeof p.human_id !== 'string' || p.human_id === '') fail('CONFIG_TRUST_EMPTY_ID', `${where}.human_id must be a non-empty string`);
    const humanId = p.human_id as string;
    if (principals.has(humanId)) fail('CONFIG_TRUST_DUPLICATE', `${where}: human_id ${printable(humanId)} is listed twice`);
    if (!Array.isArray(p.keys) || p.keys.length === 0) fail('CONFIG_INVALID_VALUE', `${where}.keys must be a non-empty array`);

    const keys = new Map<string, TrustedKey>();
    (p.keys as unknown[]).forEach((key, j) => {
      const at = `${where}.keys[${j}]`;
      if (!isObject(key)) fail('CONFIG_INVALID_VALUE', `${at} must be an object`);
      const k = key as Record<string, unknown>;
      rejectUnknownFields(k, ['kid', 'alg', 'public_key_b64', 'status', 'not_before', 'expires_at'], at);
      const alg = k.alg;
      if (typeof alg !== 'string' || !Object.hasOwn(KEY_BYTES, alg)) fail('CONFIG_TRUST_MALFORMED_KEY', `${at}.alg ${printable(alg)} is not ed25519, ml-dsa-65 or slh-dsa-192f`);
      const bytes = canonicalB64Bytes(k.public_key_b64);
      if (!bytes || bytes.length !== KEY_BYTES[alg as string]) {
        fail('CONFIG_TRUST_MALFORMED_KEY', `${at}.public_key_b64 is not a canonical base64 ${String(alg)} public key`);
      }
      if (typeof k.kid !== 'string' || deriveKid(alg as string, bytes as Uint8Array) !== k.kid) {
        fail('CONFIG_TRUST_KID_NOT_DERIVED', `${at}.kid ${printable(k.kid)} is not derived from its key`);
      }
      const kid = k.kid as string;
      if (kids.has(kid)) fail('CONFIG_TRUST_DUPLICATE', `${at}: kid ${kid} is listed twice in the trust set`);
      if (!KEY_STATUSES.includes(k.status)) fail('CONFIG_INVALID_VALUE', `${at}.status must be active, revoked or expired`);
      kids.add(kid);
      keys.set(kid, Object.freeze({
        alg: alg as string,
        publicKeyB64: k.public_key_b64 as string,
        status: k.status as TrustedKey['status'],
        notBefore: optionalInstant(k.not_before, `${at}.not_before`),
        expiresAt: optionalInstant(k.expires_at, `${at}.expires_at`),
      }));
    });
    principals.set(humanId, keys);
  });

  const frozen = new FrozenMap([...principals].map(([id, keys]) => [id, new FrozenMap(keys)] as const));
  const store: PrincipalTrustStore = Object.freeze({ version: set.trust_set_version as string, principals: frozen });
  TRUST_STORES.add(store);
  return store;
}

export function isPrincipalTrustStore(value: unknown): value is PrincipalTrustStore {
  return typeof value === 'object' && value !== null && TRUST_STORES.has(value);
}

// ── strict-v1 profile (§ 4.1) ──

export interface StrictV1ProfileConfig {
  profile: 'strict-v1';
  verifier_id: string;
  max_session_duration_seconds?: number;
  max_revocation_age_seconds?: number;
  verifier_policy?: Partial<VerifierPolicy>;
}

/** A validated strict-v1 profile: create it with resolveStrictV1Profile. */
export interface StrictV1Profile {
  readonly profile: 'strict-v1';
  readonly verifierId: string;
  readonly maxSessionDurationSeconds: number;
  readonly maxRevocationAgeSeconds: number;
  /** The verifier policy the profile verifies with. */
  readonly policy: Readonly<VerifierPolicy>;
}

const PROFILES = new WeakSet<object>();
const MODES: readonly unknown[] = ['classical_only', 'hybrid_preferred', 'hybrid_required', 'pq_only'];
const ALG_SUBSETS: Record<string, readonly string[]> = {
  accepted_classical_algs: ['ed25519'],
  accepted_pq_algs: ['ml-dsa-65', 'slh-dsa-192f'],
  accepted_hash_algs: ['sha256', 'sha384'],
};

/** A strict-v1 limit in seconds: an integer from 1 to `max`, default `max`. */
function profileSeconds(value: unknown, field: string, max: number): number {
  if (value === undefined) return max;
  if (!isInteger(value)) fail('CONFIG_INVALID_VALUE', `${field} must be an integer`);
  if ((value as number) < 1 || (value as number) > max) {
    fail('CONFIG_PROFILE_CONTRADICTION', `${field} must be from 1 to ${max} under strict-v1`);
  }
  return value as number;
}

/** A required boolean policy field that only `fixed` keeps the profile's guarantee. */
function fixedBoolean(value: unknown, field: string, fixed: boolean): boolean {
  if (typeof value !== 'boolean') fail('CONFIG_INVALID_VALUE', `verifier_policy.${field} must be a boolean`);
  if (value !== fixed) fail('CONFIG_PROFILE_CONTRADICTION', `strict-v1 requires verifier_policy.${field} to be ${fixed}`);
  return fixed;
}

function hybridRequired(value: unknown, field: string): VerificationMode {
  if (!MODES.includes(value)) fail('CONFIG_INVALID_VALUE', `${field} must be a verification mode`);
  if (value !== 'hybrid_required') {
    fail('CONFIG_PROFILE_CONTRADICTION', `strict-v1 requires ${field} to be hybrid_required (pq_only drops the classical signature)`);
  }
  return 'hybrid_required';
}

/**
 * Validate a strict-v1 configuration (schemas/v2/admission_profile.schema.json, spec/profiles/admission
 * § 4.1) and return the profile with the verifier policy it enforces. Throws AdmissionConfigError.
 */
export function resolveStrictV1Profile(config: unknown): StrictV1Profile {
  if (isStrictV1Profile(config)) return config;
  if (!isObject(config)) fail('CONFIG_INVALID_VALUE', 'the profile configuration must be an object');
  const c = config as Record<string, unknown>;
  rejectUnknownFields(c, ['profile', 'verifier_id', 'max_session_duration_seconds', 'max_revocation_age_seconds', 'verifier_policy'], 'profile');
  if (c.profile !== STRICT_V1) fail('CONFIG_INVALID_VALUE', `profile ${printable(c.profile)} is not "strict-v1"`);
  if (c.verifier_id === undefined || c.verifier_id === null) fail('CONFIG_PROFILE_CONTRADICTION', 'strict-v1 requires verifier_id');
  if (typeof c.verifier_id !== 'string') fail('CONFIG_INVALID_VALUE', 'verifier_id must be a string');
  if (c.verifier_id === '') fail('CONFIG_PROFILE_CONTRADICTION', 'strict-v1 requires a non-empty verifier_id');
  const verifierId = c.verifier_id as string;
  let maxSession = profileSeconds(c.max_session_duration_seconds, 'max_session_duration_seconds', STRICT_V1_MAX_SECONDS);
  const maxRevocation = profileSeconds(c.max_revocation_age_seconds, 'max_revocation_age_seconds', STRICT_V1_MAX_SECONDS);

  const policy: VerifierPolicy = {
    ...DEFAULT_VERIFIER_POLICY,
    default_mode: 'hybrid_required',
    risk_overrides: { low: 'hybrid_required', medium: 'hybrid_required', high: 'hybrid_required' },
    min_classical: 1,
    min_pq: 1,
    accepted_classical_algs: [...ALG_SUBSETS.accepted_classical_algs],
    accepted_pq_algs: [...ALG_SUBSETS.accepted_pq_algs],
    accepted_hash_algs: [...ALG_SUBSETS.accepted_hash_algs],
    require_session_binding: true,
    require_composite_binding: true,
    allow_v1_bundles: false,
    allow_classical_fallback_disable: false,
    warn_classical_only_deprecated: false,
    advisory_rejected_algs: [],
    require_session_expiry: true,
    require_audience_binding: true,
    verifier_id: verifierId,
  };

  if (c.verifier_policy !== undefined) {
    if (!isObject(c.verifier_policy)) fail('CONFIG_INVALID_VALUE', 'verifier_policy must be an object');
    for (const [field, value] of Object.entries(c.verifier_policy as Record<string, unknown>)) {
      switch (field) {
        case 'require_session_binding':
        case 'require_composite_binding':
        case 'require_session_expiry':
        case 'require_audience_binding':
          fixedBoolean(value, field, true);
          break;
        case 'allow_v1_bundles':
        case 'allow_classical_fallback_disable':
          fixedBoolean(value, field, false);
          break;
        case 'default_mode':
          hybridRequired(value, 'verifier_policy.default_mode');
          break;
        case 'risk_overrides':
          if (!isObject(value)) fail('CONFIG_INVALID_VALUE', 'verifier_policy.risk_overrides must be an object');
          rejectUnknownFields(value as Record<string, unknown>, ['low', 'medium', 'high'], 'verifier_policy.risk_overrides');
          for (const [tier, mode] of Object.entries(value as Record<string, unknown>)) {
            hybridRequired(mode, `verifier_policy.risk_overrides.${tier}`);
          }
          break;
        // Fields the profile fixes: a composite signature has one classical and one PQ component,
        // verifiers check the bundle hash_alg by V2-4 and only warn on key age, so another value
        // would be either weaker or not enforced by any verifier.
        case 'min_classical':
        case 'min_pq':
        case 'max_key_age_days':
          if (!isInteger(value)) fail('CONFIG_INVALID_VALUE', `verifier_policy.${field} must be an integer`);
          if (value !== policy[field]) fail('CONFIG_PROFILE_CONTRADICTION', `strict-v1 fixes verifier_policy.${field} at ${policy[field]}`);
          break;
        case 'accepted_hash_algs':
          if (!isStringList(value)) fail('CONFIG_INVALID_VALUE', 'verifier_policy.accepted_hash_algs must be a list of strings');
          if (new Set(value as string[]).size !== (value as string[]).length || (value as string[]).length !== 2 || !ALG_SUBSETS.accepted_hash_algs.every((alg) => (value as string[]).includes(alg))) {
            fail('CONFIG_PROFILE_CONTRADICTION', 'strict-v1 fixes verifier_policy.accepted_hash_algs at sha256, sha384');
          }
          break;
        case 'accepted_classical_algs':
        case 'accepted_pq_algs': {
          if (!isStringList(value)) fail('CONFIG_INVALID_VALUE', `verifier_policy.${field} must be a list of strings`);
          const allowed = ALG_SUBSETS[field];
          if ((value as string[]).length === 0 || (value as string[]).some((alg) => !allowed.includes(alg))) {
            fail('CONFIG_PROFILE_CONTRADICTION', `strict-v1 requires verifier_policy.${field} to be a non-empty subset of ${allowed.join(', ')}`);
          }
          policy[field] = [...(value as string[])];
          break;
        }
        case 'advisory_rejected_algs':
          if (!isStringList(value)) fail('CONFIG_INVALID_VALUE', 'verifier_policy.advisory_rejected_algs must be a list of strings');
          policy.advisory_rejected_algs = [...(value as string[])];
          break;
        case 'warn_classical_only_deprecated':
          if (typeof value !== 'boolean') fail('CONFIG_INVALID_VALUE', 'verifier_policy.warn_classical_only_deprecated must be a boolean');
          policy.warn_classical_only_deprecated = value as boolean;
          break;
        case 'max_session_duration_seconds':
          if (!isInteger(value)) fail('CONFIG_INVALID_VALUE', 'verifier_policy.max_session_duration_seconds must be an integer');
          if ((value as number) < 1 || (value as number) > maxSession) {
            fail('CONFIG_PROFILE_CONTRADICTION', `verifier_policy.max_session_duration_seconds must be from 1 to ${maxSession} under strict-v1`);
          }
          maxSession = value as number;
          break;
        case 'verifier_id':
          if (typeof value !== 'string') fail('CONFIG_INVALID_VALUE', 'verifier_policy.verifier_id must be a string');
          if (value !== verifierId) fail('CONFIG_PROFILE_CONTRADICTION', 'verifier_policy.verifier_id differs from the profile verifier_id');
          break;
        default:
          fail('CONFIG_UNKNOWN_FIELD', `verifier_policy: unknown field ${printable(field)}`);
      }
    }
  }
  policy.max_session_duration_seconds = maxSession;

  const profile: StrictV1Profile = Object.freeze({
    profile: STRICT_V1,
    verifierId,
    maxSessionDurationSeconds: maxSession,
    maxRevocationAgeSeconds: maxRevocation,
    policy: deepFreeze(policy),
  });
  PROFILES.add(profile);
  return profile;
}

export function isStrictV1Profile(value: unknown): value is StrictV1Profile {
  return typeof value === 'object' && value !== null && PROFILES.has(value);
}

// ── Revocation (§ 2.4, § 4.3) ──

export type RevocationStatus = 'revoked' | 'not_revoked' | 'unknown';

export interface RevocationSnapshot {
  checked_at: string;
  agents: Record<string, RevocationStatus>;
  keys: Record<string, RevocationStatus>;
}

export interface RevocationSubjects {
  agent_ids: string[];
  kids: string[];
}

const PRINCIPAL_SIGNATURES: ReadonlySet<string> = new Set(['bundle', 'responsible_principal_record']);
const REVOCATION_STATUSES: readonly unknown[] = ['revoked', 'not_revoked', 'unknown'];

function signerKeysOf(verification: VerifyV2Result | undefined): SignerKeyUse[] {
  const keys = verification?.details?.signer_keys;
  return Array.isArray(keys) ? keys : [];
}

const payloadOf = (bundle: Record<string, unknown> | undefined, artifact: string): Record<string, unknown> => {
  const signed = bundle?.[artifact];
  return isObject(signed) && isObject(signed.payload) ? signed.payload : {};
};

/**
 * What a revocation source must answer for (§ 2.4): the passport agent_id and the kid of every
 * signer key that verified, sorted.
 */
export function revocationSubjects(signedBundle: unknown, verification: VerifyV2Result): RevocationSubjects {
  const bundle = isObject(signedBundle) && isObject(signedBundle.bundle) ? signedBundle.bundle : undefined;
  const agentId = payloadOf(bundle, 'agent_passport').agent_id;
  const kids = new Set(signerKeysOf(verification).filter((k) => k.verified).map((k) => k.kid));
  return { agent_ids: typeof agentId === 'string' ? [agentId] : [], kids: [...kids].sort() };
}

/** A revocation list that cannot be read: admission reports REVOCATION_INVALID for it. */
export class RevocationListError extends Error {
  readonly code = 'REVOCATION_INVALID' as const;
  constructor(message: string) {
    super(message);
    this.name = 'RevocationListError';
  }
}

/**
 * The revocation snapshot of `subjects` from a complete deny list in the format of the reference
 * revocation service's /.well-known/dcp-revocations.json: `updated_at` (RFC 3339), `revocations`
 * (objects with an `agent_id`) and `kid_revocations` (objects with a `revoked_kid`), both present. A
 * listed agent or kid is revoked, every other subject not_revoked, as of `updated_at`. Throws
 * RevocationListError for a document of another shape.
 */
export function revocationSnapshotFromDenyList(document: unknown, subjects: RevocationSubjects): RevocationSnapshot {
  if (!isObject(document) || typeof document.updated_at !== 'string' || parseRfc3339(document.updated_at) === undefined) {
    throw new RevocationListError('revocation list: updated_at is not an RFC 3339 timestamp');
  }
  // Both lists must be present: a document without one may be truncated, and is not read as empty.
  const listed = (field: string, key: string): Set<string> => {
    const items = document[field];
    if (!Array.isArray(items) || !items.every((item) => isObject(item) && typeof item[key] === 'string')) {
      throw new RevocationListError(`revocation list: ${field} is not a list of objects with a ${key}`);
    }
    return new Set(items.map((item) => (item as Record<string, string>)[key]));
  };
  const agents = listed('revocations', 'agent_id');
  const kids = listed('kid_revocations', 'revoked_kid');
  const status = (set: Set<string>, id: string): RevocationStatus => (set.has(id) ? 'revoked' : 'not_revoked');
  return {
    checked_at: document.updated_at as string,
    agents: Object.fromEntries(subjects.agent_ids.map((id) => [id, status(agents, id)])),
    keys: Object.fromEntries(subjects.kids.map((kid) => [kid, status(kids, kid)])),
  };
}

function isRevocationSnapshot(value: unknown): value is RevocationSnapshot {
  if (!isObject(value) || Object.keys(value).some((k) => !['checked_at', 'agents', 'keys'].includes(k))) return false;
  if (parseRfc3339(value.checked_at) === undefined) return false;
  return [value.agents, value.keys].every((m) => isObject(m) && Object.values(m).every((s) => REVOCATION_STATUSES.includes(s)));
}

// ── Admission (§ 5) ──

export type PrincipalTrust = 'trusted' | 'untrusted' | 'not_evaluated';
export type ProfileCompliance = 'compliant' | 'non_compliant' | 'not_evaluated';

export interface AdmissionError {
  code: AdmissionCode;
  message: string;
}

export interface AdmissionResult {
  /** The verifier's verdict, with its meaning unchanged. */
  verified: boolean;
  /** The verifier's full result. */
  verification: VerifyV2Result;
  principal_trust: PrincipalTrust;
  profile: 'strict-v1' | null;
  profile_compliance: ProfileCompliance;
  /** The bundle is admitted as evidence under this configuration. */
  admitted: boolean;
  /** Always false: admission does not authorize an action (§ 7). */
  action_authorized: false;
  /** The policy decision's decision of a verified bundle (approve, escalate, block), else null. */
  recorded_decision: string | null;
  trust_set_version: string | null;
  errors: AdmissionError[];
}

export interface AdmissionInput {
  signedBundle: unknown;
  /** verifySignedBundleV2's result for this bundle at `now`, under the profile's policy when there is one. */
  verification: VerifyV2Result;
  /** A strict-v1 profile (resolveStrictV1Profile) or its configuration. */
  profile?: StrictV1Profile | StrictV1ProfileConfig;
  /** A trust store (createPrincipalTrustStore) or a trust set. Required with a profile. */
  trust?: PrincipalTrustStore | PrincipalTrustSet;
  /** Evaluated under a profile only. Absent or null: the source could not answer. */
  revocation?: RevocationSnapshot | null;
  /** Milliseconds since the epoch. */
  now: number;
}

const MAX_MESSAGE = 500;
const bounded = (message: string) => (message.length > MAX_MESSAGE ? `${message.slice(0, MAX_MESSAGE - 1)}…` : message);

function sessionChecks(manifest: Record<string, unknown>, profile: StrictV1Profile, now: number, add: (c: AdmissionCode, m: string) => void) {
  const audience = manifest.intended_verifier;
  if (typeof audience !== 'string' || audience === '') {
    add('PROFILE_AUDIENCE_MISSING', 'the signed manifest has no intended_verifier');
  } else if (audience !== profile.verifierId) {
    add('PROFILE_AUDIENCE_MISMATCH', `the bundle is intended for verifier ${printable(audience)}, not this one`);
  }

  const issuedRaw = manifest.session_issued_at;
  const expiresRaw = manifest.session_expires_at;
  const issuedMissing = issuedRaw === undefined || issuedRaw === null;
  const expiresMissing = expiresRaw === undefined || expiresRaw === null;
  if (issuedMissing) add('PROFILE_SESSION_START_MISSING', 'the signed manifest has no session_issued_at');
  if (expiresMissing) add('PROFILE_SESSION_EXPIRY_MISSING', 'the signed manifest has no session_expires_at');
  const issued = issuedMissing ? undefined : parseRfc3339(issuedRaw);
  const expires = expiresMissing ? undefined : parseRfc3339(expiresRaw);
  if ((!issuedMissing && issued === undefined) || (!expiresMissing && expires === undefined)) {
    add('PROFILE_SESSION_TIME_INVALID', 'session_issued_at or session_expires_at is not an RFC 3339 timestamp');
    return;
  }
  if (issued === undefined || expires === undefined) return;
  if (issued > expires) {
    add('PROFILE_SESSION_TIME_INVALID', 'session_issued_at is after session_expires_at');
    return;
  }
  if (issued > now + SESSION_CLOCK_SKEW_MS) add('PROFILE_SESSION_NOT_STARTED', 'session_issued_at is in the future');
  if (expires < now) add('PROFILE_SESSION_EXPIRED', 'the session has expired');
  if (expires - issued > profile.maxSessionDurationSeconds * 1000) {
    add('PROFILE_SESSION_TOO_LONG', `the session lasts ${(expires - issued) / 1000} s, more than ${profile.maxSessionDurationSeconds} s`);
  }
}

/** P4, structural part: both principal signatures declare a hybrid signature. */
function hybridDeclared(signedBundle: Record<string, unknown>, bundle: Record<string, unknown>, add: (c: AdmissionCode, m: string) => void) {
  const rpr = bundle.responsible_principal_record;
  const signatures: Array<[string, unknown]> = [
    ['bundle', isObject(signedBundle.signature) ? signedBundle.signature.composite_sig : undefined],
    ['responsible_principal_record', isObject(rpr) ? rpr.composite_sig : undefined],
  ];
  for (const [name, sig] of signatures) {
    if (!isObject(sig) || sig.binding !== 'pq_over_classical' || !isObject(sig.pq)) {
      add('PROFILE_HYBRID_REQUIRED', `the ${name} signature is not a hybrid (pq_over_classical) signature`);
    }
  }
}

/** P4, after verification: both components of both principal signatures verified, in hybrid_required. */
function hybridVerified(verification: VerifyV2Result, add: (c: AdmissionCode, m: string) => void) {
  if (verification.details?.verification_mode !== 'hybrid_required') {
    add('PROFILE_HYBRID_REQUIRED', `the bundle was verified in ${String(verification.details?.verification_mode)}, not hybrid_required`);
  }
  const keys = signerKeysOf(verification);
  for (const signature of PRINCIPAL_SIGNATURES) {
    for (const component of ['classical', 'pq'] as const) {
      if (!keys.some((k) => k.signature === signature && k.component === component && k.verified)) {
        add('PROFILE_HYBRID_REQUIRED', `the ${signature} signature has no verified ${component} component`);
      }
    }
  }
}


/** § 3: whether every verified component of the principal signatures is a trusted key of the principal. */
function principalTrust(
  bundle: Record<string, unknown>,
  verification: VerifyV2Result,
  store: PrincipalTrustStore,
  now: number,
  add: (c: AdmissionCode, m: string) => void,
): boolean {
  const humanId = payloadOf(bundle, 'responsible_principal_record').human_id;
  const trusted = typeof humanId === 'string' ? store.principals.get(humanId) : undefined;
  if (!trusted) {
    add('TRUST_PRINCIPAL_UNKNOWN', `principal ${printable(humanId)} is not in trust set ${printable(store.version)}`);
    return false;
  }
  let ok = true;
  const reject = (code: AdmissionCode, message: string) => {
    add(code, message);
    ok = false;
  };
  const uses = signerKeysOf(verification).filter((k) => PRINCIPAL_SIGNATURES.has(k.signature) && k.verified);
  if (uses.length === 0) reject('TRUST_KEY_NOT_ANCHORED', 'no principal signature component verified');
  for (const use of uses) {
    const where = `${use.signature} ${use.component} key ${use.kid}`;
    const key = trusted.get(use.kid);
    // Both are canonical base64 (V2-13 for the verifier's key, § 2.2 for the trust set's).
    if (!key || key.alg !== use.alg || !canonicalB64Bytes(use.public_key_b64) || use.public_key_b64 !== key.publicKeyB64) {
      reject('TRUST_KEY_NOT_ANCHORED', `${where} is not a trusted key of the principal`);
    } else if (key.status === 'revoked') {
      reject('TRUST_KEY_REVOKED', `${where} is revoked in the trust set`);
    } else if (key.status === 'expired' || (key.expiresAt !== undefined && key.expiresAt < now)) {
      reject('TRUST_KEY_EXPIRED', `${where} has expired in the trust set`);
    } else if (key.notBefore !== undefined && key.notBefore > now) {
      reject('TRUST_KEY_NOT_YET_VALID', `${where} is not valid yet in the trust set`);
    }
  }
  return ok;
}

/** § 4.3. */
function revocationChecks(
  subjects: RevocationSubjects,
  snapshot: unknown,
  profile: StrictV1Profile,
  now: number,
  add: (c: AdmissionCode, m: string) => void,
) {
  if (snapshot === undefined || snapshot === null) {
    add('REVOCATION_UNAVAILABLE', 'no revocation status could be obtained');
    return;
  }
  if (!isRevocationSnapshot(snapshot)) {
    add('REVOCATION_INVALID', 'the revocation snapshot is malformed');
    return;
  }
  const checkedAt = parseRfc3339(snapshot.checked_at) as number;
  if (checkedAt > now + SESSION_CLOCK_SKEW_MS) {
    add('REVOCATION_INVALID', 'the revocation snapshot is dated in the future');
    return;
  }
  if (now - checkedAt > profile.maxRevocationAgeSeconds * 1000) {
    add('REVOCATION_STALE', `the revocation snapshot is older than ${profile.maxRevocationAgeSeconds} s`);
  }
  const statusOf = (map: Record<string, RevocationStatus>, id: string) => (Object.hasOwn(map, id) ? map[id] : undefined);
  const subjectsByKind: Array<[string, string[], Record<string, RevocationStatus>]> = [
    ['agent', subjects.agent_ids, snapshot.agents],
    ['key', subjects.kids, snapshot.keys],
  ];
  for (const [kind, ids, map] of subjectsByKind) {
    for (const id of ids) {
      const status = statusOf(map, id);
      if (status === 'revoked') add('REVOCATION_REVOKED', `${kind} ${printable(id)} is revoked`);
      else if (status !== 'not_revoked') add('REVOCATION_UNKNOWN', `the revocation status of ${kind} ${printable(id)} is unknown`);
    }
  }
}

/**
 * § 5: admit a bundle given verifySignedBundleV2's result. No cryptography and no I/O. Throws
 * AdmissionConfigError for an invalid profile or trust set, or a profile without a trust set.
 *
 * It trusts `verification`: pass only the result of verifySignedBundleV2 on this same bundle, at
 * this same `now`, under the profile's policy (profile.policy) when there is a profile. It does
 * not re-verify, and a result made up, from another bundle or under another policy gives a wrong
 * answer. admitSignedBundleV2 does both steps and is the safer entry point.
 */
export function evaluateAdmissionV2(input: AdmissionInput): AdmissionResult {
  const { signedBundle, verification, revocation } = input;
  if (!Number.isFinite(input.now)) fail('CONFIG_INVALID_VALUE', 'now must be a finite number of milliseconds');
  // Whole milliseconds, as verifySignedBundleV2 uses it.
  const now = Math.floor(input.now);
  const profile = input.profile === undefined ? undefined : resolveStrictV1Profile(input.profile);
  const trust = input.trust === undefined ? undefined : createPrincipalTrustStore(input.trust);
  if (profile && !trust) fail('CONFIG_PROFILE_CONTRADICTION', 'strict-v1 requires a trust set');

  const errors: AdmissionError[] = [];
  const add = (code: AdmissionCode, message: string) => errors.push({ code, message: bounded(message) });
  const sb = isObject(signedBundle) ? signedBundle : {};
  const bundle = isObject(sb.bundle) ? sb.bundle : undefined;
  const base = {
    verification,
    profile: profile ? STRICT_V1 : null,
    action_authorized: false as const,
    trust_set_version: trust ? trust.version : null,
    errors,
  };

  if (profile && bundle?.dcp_bundle_version !== '2.0') {
    add('PROFILE_V2_REQUIRED', 'strict-v1 admits V2 bundles only');
    return {
      ...base,
      verified: false,
      principal_trust: 'not_evaluated',
      profile_compliance: 'non_compliant',
      admitted: false,
      recorded_decision: null,
    };
  }

  const b = bundle ?? {};
  if (profile) {
    sessionChecks(isObject(b.manifest) ? b.manifest : {}, profile, now, add);
    hybridDeclared(sb, b, add);
  }
  const verified = verification?.verified === true;
  if (!verified) {
    const reasons = Array.isArray(verification?.errors) ? verification.errors.slice(0, 3).join('; ') : '';
    add('VERIFICATION_FAILED', `the bundle did not verify${reasons ? `: ${reasons}` : ''}`);
  }
  let trustResult: PrincipalTrust = 'not_evaluated';
  if (trust && verified) trustResult = principalTrust(b, verification, trust, now, add) ? 'trusted' : 'untrusted';
  if (profile && verified) {
    hybridVerified(verification, add);
    revocationChecks(revocationSubjects(sb, verification), revocation, profile, now, add);
  }

  const profileFailed = errors.some((e) => e.code.startsWith('PROFILE_') || e.code.startsWith('REVOCATION_'));
  const compliance: ProfileCompliance = !profile ? 'not_evaluated' : verified && !profileFailed ? 'compliant' : 'non_compliant';
  const decision = payloadOf(b, 'policy_decision').decision;
  return {
    ...base,
    verified,
    principal_trust: trustResult,
    profile_compliance: compliance,
    admitted: verified && (!trust || trustResult === 'trusted') && (!profile || compliance === 'compliant'),
    recorded_decision: verified && typeof decision === 'string' ? decision : null,
  };
}

export interface AdmitOptions {
  /** A strict-v1 profile or its configuration; it sets the verifier policy. */
  profile?: StrictV1Profile | StrictV1ProfileConfig;
  /** The verifier policy without a profile. Default DEFAULT_VERIFIER_POLICY. */
  policy?: VerifierPolicy;
  trust?: PrincipalTrustStore | PrincipalTrustSet;
  revocation?: RevocationSnapshot | null;
  /** Milliseconds since the epoch. Default Date.now(). */
  now?: number;
}

/**
 * Verify a signed bundle at `now` (under the profile's policy when there is one) and evaluate its
 * admission (§ 5.1). A non-V2 bundle under a profile is not verified at all (P1).
 */
export async function admitSignedBundleV2(
  signedBundle: unknown,
  registry: AlgorithmRegistry,
  options: AdmitOptions = {},
): Promise<AdmissionResult> {
  const now = Math.floor(options.now ?? Date.now());
  const profile = options.profile === undefined ? undefined : resolveStrictV1Profile(options.profile);
  if (profile && options.policy !== undefined) {
    fail('CONFIG_PROFILE_CONTRADICTION', 'a strict-v1 profile sets its own verifier policy; do not pass one');
  }
  const sb = isObject(signedBundle) ? signedBundle : {};
  const isV2 = isObject(sb.bundle) && sb.bundle.dcp_bundle_version === '2.0';
  const verification: VerifyV2Result =
    profile && !isV2
      ? { verified: false, errors: ['strict-v1 admits V2 bundles only'], warnings: [], details: {} }
      : await verifySignedBundleV2(signedBundle as SignedBundleV2, registry, profile ? (profile.policy as VerifierPolicy) : options.policy ?? DEFAULT_VERIFIER_POLICY, { now });
  return evaluateAdmissionV2({ signedBundle, verification, profile, trust: options.trust, revocation: options.revocation, now });
}
