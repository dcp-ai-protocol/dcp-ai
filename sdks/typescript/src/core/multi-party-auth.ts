/**
 * Multi-party authorization: the opt-in mpa-v1 profile (spec/profiles/multi-party).
 *
 * Three layers, each with its own answer:
 *   structure      checkMultiPartyAuthorizationStructure: is the record well formed? It verifies no signature.
 *   verification   which parties signed exactly this request, with the keys the operator trusts for them
 *   authorization  whether those parties are enough for this operation on this target, for this verifier, now
 * evaluateMultiPartyAuthorization gives the last two; only it produces `authorized`.
 *
 * Each party signs {operation, operation_payload, party_id, role} under DCP-AI.v2.MultiPartyAuth, as in v2.0. Under
 * mpa-v1 the operation_payload is {request, parameters}, so the target, the audience and the validity window are
 * signed too. Who the parties of a target are, their roles and the threshold come from the operator's policy set;
 * their keys come from the operator's principal trust set. Nothing in the record stands for either.
 *
 * Deterministic and offline. It keeps no state: evaluating a request does not consume it (single use is the
 * executor's, which must consume request_id and execute atomically). It decides on a copy of the record taken when
 * it is called: the caller's object is not read again.
 */

import { randomBytes } from 'crypto';
import type { AuthorizationRole, MultiPartyAuthorization, MultiPartyOperation, PartyAuthorization } from '../types/v2.js';
import { FrozenMap, createPrincipalTrustStore, type PrincipalTrustStore, type TrustedKey } from './admission.js';
import { canonicalizeV2 } from './canonicalize.js';
import { compositeSign, compositeVerify, type CompositeKeyPair } from './composite-ops.js';
import type { AlgorithmRegistry } from './crypto-registry.js';
import { DCP_CONTEXTS } from './domain-separation.js';
import { parseRfc3339 } from './session-nonce.js';
import { DEFAULT_VERIFIER_POLICY, SESSION_CLOCK_SKEW_MS, canonicalB64Bytes } from './verify-v2.js';

export const MPA_V1 = 'mpa-v1' as const;
/** The most authorizations a record may carry under the profile. */
export const MPA_V1_MAX_AUTHORIZATIONS = 16;
/** The longest validity window an operator may allow, in seconds. */
export const MPA_V1_MAX_VALIDITY_SECONDS = 86_400;

const MAX_REQUEST_ID = 128;
const MAX_IDENTIFIER = 256;
const MAX_MESSAGE = 300;
const OPERATIONS: readonly string[] = ['revoke_agent', 'rotate_org_key', 'change_jurisdiction', 'modify_recovery_config'];
const ROLES: readonly string[] = ['owner', 'org_admin', 'recovery_contact'];

export type MultiPartyConfigCode = 'CONFIG_UNKNOWN_FIELD' | 'CONFIG_INVALID_VALUE' | 'CONFIG_MPA_DUPLICATE' | 'CONFIG_MPA_UNSATISFIABLE';

export type MultiPartyCode =
  | 'MPA_SCHEMA_INVALID'
  | 'MPA_REQUEST_MISSING'
  | 'MPA_REQUEST_INVALID'
  | 'MPA_NOT_REPRESENTABLE'
  | 'MPA_TOO_MANY_AUTHORIZATIONS'
  | 'MPA_OPERATION_MISMATCH'
  | 'MPA_TARGET_MISMATCH'
  | 'MPA_PARAMETERS_MISMATCH'
  | 'MPA_AUDIENCE_MISMATCH'
  | 'MPA_NOT_YET_VALID'
  | 'MPA_EXPIRED'
  | 'MPA_VALIDITY_INVALID'
  | 'MPA_TARGET_UNKNOWN'
  | 'MPA_OPERATION_NOT_ALLOWED'
  | 'MPA_PARTY_UNKNOWN'
  | 'MPA_PARTY_DUPLICATE'
  | 'MPA_ROLE_MISMATCH'
  | 'MPA_ROLE_NOT_ALLOWED'
  | 'MPA_HYBRID_REQUIRED'
  | 'MPA_KEY_NOT_ANCHORED'
  | 'MPA_KEY_REVOKED'
  | 'MPA_KEY_EXPIRED'
  | 'MPA_KEY_NOT_YET_VALID'
  | 'MPA_SIGNATURE_INVALID'
  | 'MPA_THRESHOLD_NOT_MET'
  | 'MPA_REQUIRED_ROLE_MISSING';

/** A policy set, or what the executor states, that cannot be used. `code` is one of spec/profiles/multi-party § 5.3. */
export class MultiPartyConfigError extends Error {
  constructor(
    readonly code: MultiPartyConfigCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'MultiPartyConfigError';
  }
}

const fail = (code: MultiPartyConfigCode, message: string): never => {
  throw new MultiPartyConfigError(code, message);
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInteger = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const hasOnly = (v: Record<string, unknown>, allowed: readonly string[]) => Object.keys(v).every((k) => allowed.includes(k));
const hasAll = (v: Record<string, unknown>, required: readonly string[]) => required.every((k) => Object.hasOwn(v, k));

/** A string of 1 to `max` Unicode code points. */
function isBounded(v: unknown, max: number): v is string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 2 * max) return false;
  let n = 0;
  for (const _ of v) n += 1;
  return n <= max;
}

/** A short printable form of an untrusted value. */
function printable(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value.length > 80 ? `${value.slice(0, 80)}…` : value);
  if (value === null || value === undefined) return String(value);
  return typeof value === 'object' ? (Array.isArray(value) ? 'an array' : 'an object') : String(value);
}

/**
 * An object that is only its named members: what JSON.parse, a literal or Object.create(null) makes, in this realm or
 * in another (its prototype is the end of the chain, or there is none).
 */
function isPlain(v: unknown): v is Record<string, unknown> {
  if (!isObject(v)) return false;
  const proto: object | null = Object.getPrototypeOf(v);
  return (proto === null || Object.getPrototypeOf(proto) === null) && Object.getOwnPropertySymbols(v).length === 0;
}

const RANGE = '-(2^53 - 1) to 2^53 - 1';

/**
 * Whether `value` is data of the profile (§ 3): JSON, with no number but the integers from -(2^53 - 1) to 2^53 - 1.
 * dcp-jcs-v1 takes more, and what it makes of it is not one thing. An integer beyond that range is written digit by
 * digit by one SDK and as the nearest binary64 by another, and read as that binary64 by most parsers: two numbers
 * would be signed, compared and verified as one. And this canonicalizer writes any object as the members it lists, so
 * a Set, a Map, a Date or an instance would be compared as {}.
 */
function isProfileData(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isSafeInteger(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) if (!(i in value) || !isProfileData(value[i])) return false;
    return true;
  }
  if (!isPlain(value)) return false;
  for (const key of Object.keys(value)) if (!isProfileData(value[key])) return false;
  return true;
}

/** The dcp-jcs-v1 form, or undefined when the value is not data of the profile or is not representable. */
function canonical(value: unknown): string | undefined {
  try {
    return isProfileData(value) ? canonicalizeV2(value) : undefined;
  } catch {
    return undefined;
  }
}

/** What snapshot leaves where an object was more than its members. No check takes it for data of any kind. */
const NOT_DATA = Symbol('not JSON data');

/**
 * `value` with arrays and objects of its own: the JSON it is, read once, with nothing of the caller's left to read
 * again. An object that is more than its members (a Set, a Date, an instance, one with an own symbol) is not copied
 * member by member, which would make an empty object of most; NOT_DATA takes its place, so that what judges the
 * copy refuses it. Plain loops, one frame a level, so that it reaches at least as deep as canonicalization does; a
 * hole stays a hole, so that an array is never made larger than it was.
 */
function snapshot(value: unknown): unknown {
  if (Array.isArray(value)) {
    const copy = new Array<unknown>(value.length);
    for (let i = 0; i < copy.length; i += 1) if (i in value) copy[i] = snapshot(value[i]);
    return copy;
  }
  if (!isObject(value)) return value;
  if (!isPlain(value)) return NOT_DATA;
  const copy: Record<string, unknown> = Object.create(null); // no prototype: "__proto__" is a member like any other
  for (const key of Object.keys(value)) copy[key] = snapshot(value[key]);
  return copy;
}

// ── Operator policy (§ 2.3) ──

export interface MultiPartyOperationRule {
  readonly required_parties: number;
  readonly allowed_roles: readonly AuthorizationRole[];
  readonly required_roles: readonly AuthorizationRole[];
}

/** The operator's configuration, as schemas/v2/multi_party_policy_set.schema.json describes it. */
export interface MultiPartyPolicySet {
  policy_set_version: string;
  profile: typeof MPA_V1;
  audience: string;
  max_validity_seconds: number;
  subjects: Array<{
    target: string;
    parties: Array<{ party_id: string; role: AuthorizationRole }>;
    operations: Partial<Record<MultiPartyOperation, MultiPartyOperationRule>>;
  }>;
}

export interface MultiPartySubject {
  /** party_id → the role the operator gives it on this target. */
  readonly parties: ReadonlyMap<string, AuthorizationRole>;
  readonly operations: ReadonlyMap<string, MultiPartyOperationRule>;
}

/** A validated policy set: create it with createMultiPartyPolicyStore. */
export interface MultiPartyPolicyStore {
  readonly version: string;
  readonly audience: string;
  readonly maxValiditySeconds: number;
  /** target → its parties and the operations they may authorize. */
  readonly subjects: ReadonlyMap<string, MultiPartySubject>;
}

const POLICY_STORES = new WeakSet<object>();

export function isMultiPartyPolicyStore(value: unknown): value is MultiPartyPolicyStore {
  return typeof value === 'object' && value !== null && POLICY_STORES.has(value);
}

function unknownField(value: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail('CONFIG_UNKNOWN_FIELD', `${where}: unknown field ${printable(key)}`);
  }
}

function roleList(value: unknown, where: string): AuthorizationRole[] {
  if (!Array.isArray(value) || value.some((r) => !ROLES.includes(r)) || new Set(value).size !== value.length) {
    fail('CONFIG_INVALID_VALUE', `${where} must list roles, each once`);
  }
  return value as AuthorizationRole[];
}

/**
 * Validate a policy set (schemas/v2/multi_party_policy_set.schema.json, spec/profiles/multi-party § 2.3) and return
 * it as a store. Throws MultiPartyConfigError on the first problem found. There are no defaults: an operation the
 * operator does not list for a target is not authorized.
 */
export function createMultiPartyPolicyStore(policySet: unknown): MultiPartyPolicyStore {
  if (isMultiPartyPolicyStore(policySet)) return policySet;
  if (!isObject(policySet)) return fail('CONFIG_INVALID_VALUE', 'the policy set must be an object');
  unknownField(policySet, ['policy_set_version', 'profile', 'audience', 'max_validity_seconds', 'subjects'], 'policy set');
  if (typeof policySet.policy_set_version !== 'string' || policySet.policy_set_version === '') {
    fail('CONFIG_INVALID_VALUE', 'policy_set_version must be a non-empty string');
  }
  if (policySet.profile !== MPA_V1) fail('CONFIG_INVALID_VALUE', `profile must be ${MPA_V1}`);
  if (!isBounded(policySet.audience, MAX_IDENTIFIER)) fail('CONFIG_INVALID_VALUE', 'audience must be a string of 1 to 256 characters');
  const seconds = policySet.max_validity_seconds;
  if (!isInteger(seconds) || seconds < 1 || seconds > MPA_V1_MAX_VALIDITY_SECONDS) {
    fail('CONFIG_INVALID_VALUE', `max_validity_seconds must be an integer from 1 to ${MPA_V1_MAX_VALIDITY_SECONDS}`);
  }
  if (!Array.isArray(policySet.subjects)) fail('CONFIG_INVALID_VALUE', 'subjects must be an array');

  const subjects = new Map<string, MultiPartySubject>();
  (policySet.subjects as unknown[]).forEach((subject, i) => {
    const where = `subjects[${i}]`;
    if (!isObject(subject)) return fail('CONFIG_INVALID_VALUE', `${where} must be an object`);
    unknownField(subject, ['target', 'parties', 'operations'], where);
    if (!isBounded(subject.target, MAX_IDENTIFIER)) fail('CONFIG_INVALID_VALUE', `${where}.target must be a string of 1 to 256 characters`);
    const target = subject.target as string;
    if (subjects.has(target)) fail('CONFIG_MPA_DUPLICATE', `${where}: target ${printable(target)} is listed twice`);
    if (!Array.isArray(subject.parties) || subject.parties.length === 0) fail('CONFIG_INVALID_VALUE', `${where}.parties must be a non-empty array`);

    const parties = new Map<string, AuthorizationRole>();
    (subject.parties as unknown[]).forEach((party, j) => {
      const at = `${where}.parties[${j}]`;
      if (!isObject(party)) return fail('CONFIG_INVALID_VALUE', `${at} must be an object`);
      unknownField(party, ['party_id', 'role'], at);
      if (typeof party.party_id !== 'string' || party.party_id === '') fail('CONFIG_INVALID_VALUE', `${at}.party_id must be a non-empty string`);
      if (!ROLES.includes(party.role as string)) fail('CONFIG_INVALID_VALUE', `${at}.role ${printable(party.role)} is not a role`);
      const id = party.party_id as string;
      if (parties.has(id)) fail('CONFIG_MPA_DUPLICATE', `${at}: party ${printable(id)} is listed twice for the target`);
      parties.set(id, party.role as AuthorizationRole);
    });

    if (!isObject(subject.operations)) return fail('CONFIG_INVALID_VALUE', `${where}.operations must be an object`);
    const operations = new Map<string, MultiPartyOperationRule>();
    for (const [operation, rule] of Object.entries(subject.operations)) {
      const at = `${where}.operations.${printable(operation)}`;
      if (!OPERATIONS.includes(operation)) fail('CONFIG_INVALID_VALUE', `${at} is not an operation`);
      if (!isObject(rule)) return fail('CONFIG_INVALID_VALUE', `${at} must be an object`);
      unknownField(rule, ['required_parties', 'allowed_roles', 'required_roles'], at);
      const required = rule.required_parties;
      if (!isInteger(required) || required < 2) return fail('CONFIG_INVALID_VALUE', `${at}.required_parties must be an integer of at least 2`);
      const allowed = roleList(rule.allowed_roles, `${at}.allowed_roles`);
      const requiredRoles = roleList(rule.required_roles, `${at}.required_roles`);
      if (allowed.length === 0) fail('CONFIG_INVALID_VALUE', `${at}.allowed_roles must not be empty`);
      if (requiredRoles.some((r) => !allowed.includes(r))) fail('CONFIG_INVALID_VALUE', `${at}.required_roles must be among allowed_roles`);
      const eligible = [...parties.values()].filter((role) => allowed.includes(role));
      if (required > eligible.length) fail('CONFIG_MPA_UNSATISFIABLE', `${at}: ${required} parties are required and ${eligible.length} have an allowed role`);
      if (requiredRoles.some((r) => !eligible.includes(r))) fail('CONFIG_MPA_UNSATISFIABLE', `${at}: no party holds a required role`);
      operations.set(operation, Object.freeze({ required_parties: required, allowed_roles: Object.freeze([...allowed]), required_roles: Object.freeze([...requiredRoles]) }));
    }
    subjects.set(target, Object.freeze({ parties: new FrozenMap(parties), operations: new FrozenMap(operations) }));
  });

  const store: MultiPartyPolicyStore = Object.freeze({
    version: policySet.policy_set_version as string,
    audience: policySet.audience as string,
    maxValiditySeconds: seconds as number,
    subjects: new FrozenMap(subjects),
  });
  POLICY_STORES.add(store);
  return store;
}

// ── The request and the signing side (§ 2.2) ──

export interface MultiPartyRequest {
  profile: typeof MPA_V1;
  request_id: string;
  target: string;
  audience: string;
  issued_at: string;
  expires_at: string;
}

/** The operation_payload of a record under mpa-v1 (schemas/v2/multi_party_request.schema.json). */
export interface MultiPartyOperationPayload {
  request: MultiPartyRequest;
  parameters: Record<string, unknown>;
}

export interface CreateMultiPartyRequestInput {
  /** The object of the operation, as the operator's policy set names it. */
  target: string;
  /** The verifier that may act on the authorization. */
  audience: string;
  parameters?: Record<string, unknown>;
  /** How long the request is valid, in seconds (1 to 86400; the operator may allow less). */
  validitySeconds: number;
  /** Milliseconds since the Unix epoch; the system clock by default. */
  issuedAt?: number;
  /** A unique identifier; 16 random bytes by default. */
  requestId?: string;
}

/** Build the operation_payload every party signs. Throws MultiPartyConfigError on a request the profile would refuse. */
export function createMultiPartyRequest(input: CreateMultiPartyRequestInput): MultiPartyOperationPayload {
  if (!isObject(input)) return fail('CONFIG_INVALID_VALUE', 'the request input must be an object');
  const { target, audience, parameters = {}, validitySeconds, issuedAt = Date.now(), requestId = `mpa:${randomBytes(16).toString('hex')}` } = input;
  if (!isBounded(target, MAX_IDENTIFIER)) fail('CONFIG_INVALID_VALUE', 'target must be a string of 1 to 256 characters');
  if (!isBounded(audience, MAX_IDENTIFIER)) fail('CONFIG_INVALID_VALUE', 'audience must be a string of 1 to 256 characters');
  if (!isBounded(requestId, MAX_REQUEST_ID)) fail('CONFIG_INVALID_VALUE', 'requestId must be a string of 1 to 128 characters');
  if (!isInteger(validitySeconds) || validitySeconds < 1 || validitySeconds > MPA_V1_MAX_VALIDITY_SECONDS) {
    fail('CONFIG_INVALID_VALUE', `validitySeconds must be an integer from 1 to ${MPA_V1_MAX_VALIDITY_SECONDS}`);
  }
  if (!isInteger(issuedAt)) fail('CONFIG_INVALID_VALUE', 'issuedAt must be an integer number of milliseconds');
  if (!isObject(parameters) || canonical(snapshot(parameters)) === undefined) fail('CONFIG_INVALID_VALUE', `parameters must be an object of JSON data with integers within ${RANGE}`);
  return {
    request: {
      profile: MPA_V1,
      request_id: requestId,
      target,
      audience,
      issued_at: new Date(issuedAt).toISOString(),
      expires_at: new Date(issuedAt + validitySeconds * 1000).toISOString(),
    },
    parameters,
  };
}

const signedBytes = (operation: unknown, operationPayload: unknown, partyId: unknown, role: unknown): Uint8Array =>
  new TextEncoder().encode(canonicalizeV2({ operation, operation_payload: operationPayload, party_id: partyId, role }));

/** One party's authorization: its composite signature over {operation, operation_payload, party_id, role}. */
export async function createPartyAuthorization(
  registry: AlgorithmRegistry,
  operation: MultiPartyOperation,
  operationPayload: Record<string, unknown> | MultiPartyOperationPayload,
  partyId: string,
  role: AuthorizationRole,
  keys: CompositeKeyPair,
): Promise<PartyAuthorization> {
  const sig = await compositeSign(registry, DCP_CONTEXTS.MultiPartyAuth, signedBytes(operation, operationPayload, partyId, role), keys);
  return { party_id: partyId, role, composite_sig: sig };
}

/**
 * Put the parties' authorizations in one record. `requiredParties` fills the schema's field: it is not signed and
 * no evaluation reads it.
 */
export function buildMultiPartyAuthorization(
  operation: MultiPartyOperation,
  operationPayload: Record<string, unknown> | MultiPartyOperationPayload,
  authorizations: PartyAuthorization[],
  requiredParties = 2,
): MultiPartyAuthorization {
  return {
    type: 'multi_party_authorization',
    operation,
    operation_payload: operationPayload as Record<string, unknown>,
    required_parties: requiredParties,
    authorizations,
  };
}

// ── Structure: the shape, and nothing else ──

export interface MultiPartyStructurePolicy {
  requiredParties: number;
  allowedRoles: AuthorizationRole[];
  requireOwner: boolean;
}

export interface MultiPartyStructureResult {
  valid: boolean;
  errors: string[];
}

const ANYONE: AuthorizationRole[] = ['owner', 'org_admin', 'recovery_contact'];
const STRUCTURE_POLICIES: Record<string, MultiPartyStructurePolicy> = {
  revoke_agent: { requiredParties: 2, allowedRoles: ANYONE, requireOwner: true },
  rotate_org_key: { requiredParties: 2, allowedRoles: ['owner', 'org_admin'], requireOwner: true },
  change_jurisdiction: { requiredParties: 2, allowedRoles: ['owner', 'org_admin'], requireOwner: true },
  modify_recovery_config: { requiredParties: 2, allowedRoles: ANYONE, requireOwner: true },
};

/**
 * Check the shape of a record: how many authorizations it lists, with which roles, and that each carries a
 * composite_sig. It verifies no signature, knows no party and reads no operator policy, so `valid` says nothing
 * about who signed or whether the operation is authorized: for that, evaluateMultiPartyAuthorization.
 */
export function checkMultiPartyAuthorizationStructure(mpa: MultiPartyAuthorization, policy?: MultiPartyStructurePolicy): MultiPartyStructureResult {
  if (!isObject(mpa) || !Array.isArray(mpa.authorizations)) return { valid: false, errors: ['Not a multi-party authorization'] };
  const effective = policy ?? (Object.hasOwn(STRUCTURE_POLICIES, mpa.operation) ? STRUCTURE_POLICIES[mpa.operation] : undefined);
  if (!effective) return { valid: false, errors: [`No policy defined for operation: ${mpa.operation}`] };
  const errors: string[] = [];
  if (mpa.authorizations.length < effective.requiredParties) {
    errors.push(`Insufficient authorizations: ${mpa.authorizations.length} < ${effective.requiredParties}`);
  }
  if (effective.requireOwner && !mpa.authorizations.some((a) => a?.role === 'owner')) errors.push('Owner authorization required but not present');
  for (const auth of mpa.authorizations) {
    if (!effective.allowedRoles.includes(auth?.role)) errors.push(`Role ${auth?.role} not allowed for operation ${mpa.operation}`);
    if (!auth?.composite_sig) errors.push(`Missing composite_sig for party ${auth?.party_id}`);
  }
  return { valid: errors.length === 0, errors };
}

// ── Evaluation: verification and authorization (§ 4) ──

/** What the executor is about to do. The authorization must be for exactly this. */
export interface MultiPartyExpected {
  operation: MultiPartyOperation;
  target: string;
  parameters: Record<string, unknown>;
}

export interface EvaluateMultiPartyOptions {
  /** The operator's policy set, as JSON or loaded. Never taken from the record or the request. */
  policy: MultiPartyPolicyStore | MultiPartyPolicySet | unknown;
  /** The operator's principal trust set, as JSON or loaded: the keys of the parties. */
  trust: PrincipalTrustStore | unknown;
  expected: MultiPartyExpected;
  /** Milliseconds since the Unix epoch; the system clock by default. */
  now?: number;
}

export interface MultiPartyEvaluation {
  profile: typeof MPA_V1;
  structure: 'valid' | 'invalid';
  verification: 'verified' | 'failed' | 'not_evaluated';
  /** The decision. True only when no phase added a code. */
  authorized: boolean;
  /** The signed operation, target, request_id and expires_at of a well-formed record, else null. */
  operation: MultiPartyOperation | null;
  target: string | null;
  request_id: string | null;
  expires_at: string | null;
  /** One per authorization: the signed party_id and role, and whether its signature verified (null: not evaluated). */
  parties: Array<{ party_id: string; role: AuthorizationRole; verified: boolean | null }>;
  parties_counted: number | null;
  /** The operator's threshold for the operation on the target, or null when no rule was found. */
  required_parties: number | null;
  policy_set_version: string;
  trust_set_version: string;
  errors: Array<{ code: MultiPartyCode; message: string }>;
}

const KID = /^[0-9a-f]{32}$/;
const SIG_B64 = /^[A-Za-z0-9+/]+={0,2}$/;

function isSignaturePart(v: unknown): boolean {
  return (
    isObject(v) && hasOnly(v, ['alg', 'kid', 'sig_b64']) && typeof v.alg === 'string' && typeof v.kid === 'string' && KID.test(v.kid) &&
    typeof v.sig_b64 === 'string' && v.sig_b64.length >= 8 && v.sig_b64.length <= 66476 && SIG_B64.test(v.sig_b64)
  );
}

/** schemas/v2/multi_party_authorization.schema.json, by hand. */
function conformsToSchema(record: unknown): record is MultiPartyAuthorization {
  if (!isObject(record)) return false;
  const top = ['type', 'operation', 'operation_payload', 'required_parties', 'authorizations'];
  if (!hasOnly(record, top) || !hasAll(record, top)) return false;
  if (record.type !== 'multi_party_authorization' || !OPERATIONS.includes(record.operation as string) || !isObject(record.operation_payload)) return false;
  if (!isInteger(record.required_parties) || record.required_parties < 2) return false;
  if (!Array.isArray(record.authorizations) || record.authorizations.length === 0) return false;
  if (record.authorizations.includes(undefined)) return false; // a hole: every() below would skip it
  return record.authorizations.every((a) => {
    if (!isObject(a) || !hasOnly(a, ['party_id', 'role', 'composite_sig']) || !hasAll(a, ['party_id', 'role', 'composite_sig'])) return false;
    const sig = a.composite_sig;
    return (
      typeof a.party_id === 'string' && ROLES.includes(a.role as string) &&
      isObject(sig) && hasOnly(sig, ['classical', 'pq', 'binding']) && hasAll(sig, ['classical', 'pq', 'binding']) &&
      isSignaturePart(sig.classical) && (sig.pq === null || isSignaturePart(sig.pq)) &&
      (sig.binding === 'pq_over_classical' || sig.binding === 'classical_only')
    );
  });
}

/** schemas/v2/multi_party_request.schema.json, by hand, with the instants parsed as everywhere else. */
function conformsToRequest(payload: Record<string, unknown>): payload is Record<string, unknown> & MultiPartyOperationPayload {
  const request = payload.request;
  const members = ['profile', 'request_id', 'target', 'audience', 'issued_at', 'expires_at'];
  return (
    hasOnly(payload, ['request', 'parameters']) && isObject(payload.parameters) &&
    isObject(request) && hasOnly(request, members) && hasAll(request, members) &&
    request.profile === MPA_V1 && isBounded(request.request_id, MAX_REQUEST_ID) &&
    isBounded(request.target, MAX_IDENTIFIER) && isBounded(request.audience, MAX_IDENTIFIER) &&
    parseRfc3339(request.issued_at) !== undefined && parseRfc3339(request.expires_at) !== undefined
  );
}

/** The first structural problem of a record, in the order of § 4, or undefined. */
function structureCode(record: unknown): MultiPartyCode | undefined {
  if (!conformsToSchema(record)) return 'MPA_SCHEMA_INVALID';
  const payload = record.operation_payload;
  if (!Object.hasOwn(payload, 'request')) return 'MPA_REQUEST_MISSING';
  if (!conformsToRequest(payload)) return 'MPA_REQUEST_INVALID';
  if (canonical(payload) === undefined) return 'MPA_NOT_REPRESENTABLE';
  return record.authorizations.length > MPA_V1_MAX_AUTHORIZATIONS ? 'MPA_TOO_MANY_AUTHORIZATIONS' : undefined;
}

/** What the executor states must itself be well formed: a mistake here is the caller's, not a verdict on the record. */
function validExpected(expected: unknown): { operation: string; target: string; parameters: string } {
  if (!isObject(expected) || !hasOnly(expected, ['operation', 'target', 'parameters'])) return fail('CONFIG_INVALID_VALUE', 'expected must be {operation, target, parameters}');
  if (!OPERATIONS.includes(expected.operation as string)) fail('CONFIG_INVALID_VALUE', `expected.operation ${printable(expected.operation)} is not an operation`);
  if (!isBounded(expected.target, MAX_IDENTIFIER)) fail('CONFIG_INVALID_VALUE', 'expected.target must be a string of 1 to 256 characters');
  const parameters = isObject(expected.parameters) ? canonical(snapshot(expected.parameters)) : undefined;
  if (parameters === undefined) return fail('CONFIG_INVALID_VALUE', `expected.parameters must be an object of JSON data with integers within ${RANGE}`);
  return { operation: expected.operation as string, target: expected.target as string, parameters };
}

/** Why a trusted key cannot count at `now`, the first that applies, or undefined. */
function keyCode(key: TrustedKey | undefined, alg: string, now: number): MultiPartyCode | undefined {
  if (!key || key.alg !== alg) return 'MPA_KEY_NOT_ANCHORED';
  if (key.status === 'revoked') return 'MPA_KEY_REVOKED';
  if (key.status === 'expired' || (key.expiresAt !== undefined && key.expiresAt < now)) return 'MPA_KEY_EXPIRED';
  return key.notBefore !== undefined && key.notBefore > now ? 'MPA_KEY_NOT_YET_VALID' : undefined;
}

/**
 * Decide whether a multi-party authorization authorizes what the executor is about to do (spec/profiles/multi-party
 * § 4). Strict: any authorization that fails refuses the record. A phase that adds a code stops the next ones, so no
 * signature of a malformed, foreign or expired request is verified.
 *
 * Throws AdmissionConfigError or MultiPartyConfigError when the operator's configuration or `expected` is unusable.
 */
export async function evaluateMultiPartyAuthorization(
  record: unknown,
  registry: AlgorithmRegistry,
  options: EvaluateMultiPartyOptions,
): Promise<MultiPartyEvaluation> {
  if (!isObject(options)) return fail('CONFIG_INVALID_VALUE', 'options must be an object');
  const policy = createMultiPartyPolicyStore(options.policy);
  const trust = createPrincipalTrustStore(options.trust);
  const expected = validExpected(options.expected);
  const now = options.now ?? Date.now();
  if (!isInteger(now)) return fail('CONFIG_INVALID_VALUE', 'now must be an integer number of milliseconds');

  const result: MultiPartyEvaluation = {
    profile: MPA_V1,
    structure: 'valid',
    verification: 'not_evaluated',
    authorized: false,
    operation: null,
    target: null,
    request_id: null,
    expires_at: null,
    parties: [],
    parties_counted: null,
    required_parties: null,
    policy_set_version: policy.version,
    trust_set_version: trust.version,
    errors: [],
  };
  // Bounded: an identifier from the record is quoted in it.
  const add = (code: MultiPartyCode, message: string) =>
    result.errors.push({ code, message: message.length <= MAX_MESSAGE ? message : `${message.slice(0, MAX_MESSAGE - 1)}…` });

  // 1. Structure: the first failure, and nothing else is read. From here on `record` is the evaluation's own copy:
  // it waits on the signatures, and what the caller does to its object meanwhile must not count.
  let malformed: MultiPartyCode | undefined;
  try {
    record = snapshot(record);
  } catch {
    malformed = structureCode(record) ?? 'MPA_NOT_REPRESENTABLE'; // nested too deeply to copy
  }
  malformed ??= structureCode(record);
  if (malformed) {
    result.structure = 'invalid';
    add(malformed, 'the record is not a well-formed mpa-v1 multi-party authorization');
    return result;
  }
  const mpa = record as MultiPartyAuthorization;
  const { request, parameters } = mpa.operation_payload as unknown as MultiPartyOperationPayload;
  Object.assign(result, {
    operation: mpa.operation,
    target: request.target,
    request_id: request.request_id,
    expires_at: request.expires_at,
    parties: mpa.authorizations.map((a) => ({ party_id: a.party_id, role: a.role, verified: null })),
  });

  // 2. Binding: this operation, on this target, with these parameters, for this verifier, now.
  if (mpa.operation !== expected.operation) add('MPA_OPERATION_MISMATCH', `the record authorizes ${mpa.operation}, not ${expected.operation}`);
  if (request.target !== expected.target) add('MPA_TARGET_MISMATCH', `the request is for target ${printable(request.target)}`);
  if (canonical(parameters) !== expected.parameters) add('MPA_PARAMETERS_MISMATCH', 'the signed parameters are not the ones about to be used');
  if (request.audience !== policy.audience) add('MPA_AUDIENCE_MISMATCH', `the request is for audience ${printable(request.audience)}`);
  const issued = parseRfc3339(request.issued_at) as number;
  const expires = parseRfc3339(request.expires_at) as number;
  if (issued > now + SESSION_CLOCK_SKEW_MS) add('MPA_NOT_YET_VALID', 'issued_at is in the future');
  if (expires <= now) add('MPA_EXPIRED', 'expires_at has passed');
  if (expires <= issued || expires - issued > policy.maxValiditySeconds * 1000) {
    add('MPA_VALIDITY_INVALID', `the validity window must be positive and at most ${policy.maxValiditySeconds} seconds`);
  }
  const subject = policy.subjects.get(request.target);
  const rule = subject?.operations.get(mpa.operation);
  if (!subject) add('MPA_TARGET_UNKNOWN', `the operator has no parties for target ${printable(request.target)}`);
  else if (!rule) add('MPA_OPERATION_NOT_ALLOWED', `the operator does not list ${mpa.operation} for the target`);
  if (rule) result.required_parties = rule.required_parties;
  if (result.errors.length > 0 || !subject || !rule) return result;

  // 3. Parties: distinct parties of the target, each with the role the operator gives it.
  const seen = new Set<string>();
  for (const auth of mpa.authorizations) {
    const role = subject.parties.get(auth.party_id);
    if (role === undefined) {
      add('MPA_PARTY_UNKNOWN', `${printable(auth.party_id)} is not a party of the target`);
      continue;
    }
    if (seen.has(auth.party_id)) add('MPA_PARTY_DUPLICATE', `${printable(auth.party_id)} is listed more than once`);
    seen.add(auth.party_id);
    if (auth.role !== role) add('MPA_ROLE_MISMATCH', `${printable(auth.party_id)} signed as ${auth.role}; the operator has it as ${role}`);
    if (!rule.allowed_roles.includes(role)) add('MPA_ROLE_NOT_ALLOWED', `the role ${role} may not authorize ${mpa.operation}`);
  }
  if (result.errors.length > 0) return result;

  // 4. Verification: every authorization is a hybrid signature, by the party's trusted keys, over this request.
  const { accepted_classical_algs: classicalAlgs, accepted_pq_algs: pqAlgs } = DEFAULT_VERIFIER_POLICY;
  let counted = 0;
  for (const [i, auth] of mpa.authorizations.entries()) {
    const before = result.errors.length;
    const sig = auth.composite_sig;
    if (sig.binding !== 'pq_over_classical' || !sig.pq || !classicalAlgs.includes(sig.classical.alg) || !pqAlgs.includes(sig.pq.alg)) {
      add('MPA_HYBRID_REQUIRED', `${printable(auth.party_id)}: a classical and a post-quantum signature are both required`);
    } else {
      const trusted = trust.principals.get(auth.party_id);
      const [classicalKey, pqKey] = [trusted?.get(sig.classical.kid), trusted?.get(sig.pq.kid)];
      for (const [part, key] of [[sig.classical, classicalKey], [sig.pq, pqKey]] as const) {
        const code = keyCode(key, part.alg, now);
        if (code) add(code, `${printable(auth.party_id)}: key ${part.kid} cannot count`);
      }
      if (result.errors.length === before) {
        let valid = false;
        try {
          valid =
            canonicalB64Bytes(sig.classical.sig_b64) !== undefined && canonicalB64Bytes(sig.pq.sig_b64) !== undefined &&
            (await compositeVerify(
              registry,
              DCP_CONTEXTS.MultiPartyAuth,
              signedBytes(mpa.operation, mpa.operation_payload, auth.party_id, auth.role),
              sig,
              (classicalKey as TrustedKey).publicKeyB64,
              (pqKey as TrustedKey).publicKeyB64,
            )).valid;
        } catch {
          valid = false; // an algorithm the registry cannot verify, or a malformed signature
        }
        if (!valid) add('MPA_SIGNATURE_INVALID', `${printable(auth.party_id)}: the signature does not verify`);
      }
    }
    const verified = result.errors.length === before;
    result.parties[i].verified = verified;
    if (verified) counted += 1;
  }
  result.parties_counted = counted;
  if (result.errors.length > 0) {
    result.verification = 'failed';
    return result;
  }
  result.verification = 'verified';

  // 5. Decision: enough parties, and the roles the operator requires.
  if (counted < rule.required_parties) add('MPA_THRESHOLD_NOT_MET', `${counted} parties authorized; the operator requires ${rule.required_parties}`);
  const roles = new Set(mpa.authorizations.map((a) => subject.parties.get(a.party_id)));
  for (const role of rule.required_roles) {
    if (!roles.has(role)) add('MPA_REQUIRED_ROLE_MISSING', `no ${role} authorized the operation`);
  }
  result.authorized = result.errors.length === 0;
  return result;
}
