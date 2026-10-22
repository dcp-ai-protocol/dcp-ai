/**
 * DCP-09 v2.0 Delegation & Representation.
 *
 * Implements delegation mandates (human → agent authority), sub-mandates and
 * mandate chains (agent → agent, DCP-09 §3.5), mandate verification between
 * agents, and revocation.
 */

import type { CompositeKeyPair } from './composite-ops.js';
import { compositeSign, compositeVerify } from './composite-ops.js';
import type { CompositeSignature, SignatureEntry } from './composite-sig.js';
import type { AlgorithmRegistry } from './crypto-registry.js';
import type { KeyEntry } from './crypto-provider.js';
import { canonicalizeV2 } from './canonicalize.js';
import { DCP_CONTEXTS } from './domain-separation.js';
import type { DcpContext } from './domain-separation.js';
import { parseRfc3339 } from './session-nonce.js';
import { maxTier } from './security-tier.js';
import type {
  AuthorityScopeEntry,
  DelegationMandate,
  InteractionRecord,
  SecurityTier,
  SubDelegationPolicy,
  SubMandate,
} from '../types/v2.js';

/** Fields a human sets on a root mandate; the chain fields are left out of the wire object when absent. */
export interface DelegationMandateParams {
  mandate_id: string;
  session_nonce: string;
  human_id: string;
  agent_id: string;
  authority_scope: AuthorityScopeEntry[];
  valid_from: string;
  valid_until: string;
  revocable: boolean;
  sub_delegation?: SubDelegationPolicy;
  minimum_security_tier?: SecurityTier;
}

/** Fields a delegating agent sets on a sub-mandate; human_id, parent_mandate_id and delegation_depth come from the parent. */
export interface SubMandateParams {
  mandate_id: string;
  session_nonce: string;
  agent_id: string;
  authority_scope: AuthorityScopeEntry[];
  valid_from: string;
  valid_until: string;
  revocable: boolean;
  sub_delegation?: SubDelegationPolicy;
  minimum_security_tier?: SecurityTier;
}

function chainFields(params: { sub_delegation?: SubDelegationPolicy; minimum_security_tier?: SecurityTier }) {
  return {
    ...(params.sub_delegation !== undefined ? { sub_delegation: params.sub_delegation } : {}),
    ...(params.minimum_security_tier !== undefined ? { minimum_security_tier: params.minimum_security_tier } : {}),
  };
}

/**
 * Create a delegation mandate (signed by the human principal).
 */
export async function createDelegationMandate(
  registry: AlgorithmRegistry,
  humanKeys: CompositeKeyPair,
  params: DelegationMandateParams,
): Promise<DelegationMandate> {
  const payload = {
    dcp_version: '2.0' as const,
    mandate_id: params.mandate_id,
    session_nonce: params.session_nonce,
    human_id: params.human_id,
    agent_id: params.agent_id,
    authority_scope: params.authority_scope,
    valid_from: params.valid_from,
    valid_until: params.valid_until,
    revocable: params.revocable,
    timestamp: new Date().toISOString(),
    ...chainFields(params),
  };

  const canonical = canonicalizeV2(payload);
  const payloadBytes = new TextEncoder().encode(canonical);
  const humanCompositeSig = await compositeSign(
    registry,
    DCP_CONTEXTS.Delegation,
    payloadBytes,
    humanKeys,
  );

  return { ...payload, human_composite_sig: humanCompositeSig };
}

/**
 * Create a sub-mandate (DCP-09 §3.5): the agent holding `parent` passes a
 * narrower authority on to `params.agent_id`, signing with its own keys under
 * the SubMandate context. Nothing is checked here; `verifyMandateChain` is the
 * gate, so a sub-mandate wider than its parent is simply one no verifier accepts.
 */
export async function createSubMandate(
  registry: AlgorithmRegistry,
  delegatorKeys: CompositeKeyPair,
  parent: DelegationMandate | SubMandate,
  params: SubMandateParams,
): Promise<SubMandate> {
  const payload = {
    dcp_version: '2.0' as const,
    mandate_id: params.mandate_id,
    session_nonce: params.session_nonce,
    human_id: parent.human_id,
    agent_id: params.agent_id,
    authority_scope: params.authority_scope,
    valid_from: params.valid_from,
    valid_until: params.valid_until,
    revocable: params.revocable,
    timestamp: new Date().toISOString(),
    parent_mandate_id: parent.mandate_id,
    delegation_depth: (parent.delegation_depth ?? 0) + 1,
    ...chainFields(params),
  };

  const payloadBytes = new TextEncoder().encode(canonicalizeV2(payload));
  const delegatorCompositeSig = await compositeSign(registry, DCP_CONTEXTS.SubMandate, payloadBytes, delegatorKeys);

  return { ...payload, delegator_composite_sig: delegatorCompositeSig };
}

/**
 * Verify a delegation mandate is still valid (not expired, not revoked).
 */
export function verifyMandateValidity(
  mandate: DelegationMandate,
  revokedMandateIds: Set<string>,
): { valid: boolean; reason?: string } {
  if (revokedMandateIds.has(mandate.mandate_id)) {
    return { valid: false, reason: 'Mandate has been revoked' };
  }

  const now = new Date();
  if (new Date(mandate.valid_from) > now) {
    return { valid: false, reason: 'Mandate is not yet valid' };
  }
  if (new Date(mandate.valid_until) < now) {
    return { valid: false, reason: 'Mandate has expired' };
  }

  return { valid: true };
}

// ── Mandate chains (DCP-09 §3.5.2) ──

/** The keys a chain is verified against; each list is looked up by kid, as the bundle verifier does. */
export interface MandateChainKeys {
  /** Keys of the human principal (the RPR binding_keys): verify the root's human_composite_sig. */
  human_keys: KeyEntry[];
  /** Passport keys of each delegating agent, by agent_id: verify the delegator_composite_sig of its sub-mandates. */
  agent_keys: Record<string, KeyEntry[]>;
}

export interface MandateChainResult {
  valid: boolean;
  /** Empty when valid; every error names the mandate by its index in the chain. */
  errors: string[];
  /** The leaf's delegation_depth when valid, 0 otherwise. */
  depth: number;
  /** The greatest minimum_security_tier along the chain, or null when no mandate sets one. */
  effective_tier: SecurityTier | null;
}

const TIER_RANK: Record<string, number> = { routine: 0, standard: 1, elevated: 2, maximum: 3 };
const CLASSICAL_ALGS: readonly string[] = ['ed25519'];
const PQ_ALGS: readonly string[] = ['ml-dsa-65', 'slh-dsa-192f'];

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');
// A numeric limit compares only as an integer within ±(2^53 − 1): every SDK reads those exactly, whether
// it parses JSON numbers as doubles or keeps every digit, so beyond them two verifiers disagree on what a
// mandate says (DCP-09 §3.5.2 rule 5).
const isComparableNumber = (v: unknown): v is number => Number.isSafeInteger(v);
const hasOwn = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);
// A field set to undefined is absent on the wire (canonicalizeV2 omits it), so it is absent here too.
const present = (o: Record<string, unknown>, key: string): boolean => o[key] !== undefined;

function isScopeEntry(e: unknown): e is AuthorityScopeEntry {
  return (
    isObject(e) &&
    isNonEmptyString(e.domain) &&
    isStringArray(e.actions_permitted) &&
    (!present(e, 'data_classes') || isStringArray(e.data_classes)) &&
    (!present(e, 'limits') || isObject(e.limits))
  );
}

function isSubDelegation(v: unknown): v is SubDelegationPolicy {
  return isObject(v) && typeof v.permitted === 'boolean' && Number.isInteger(v.max_depth) && (v.max_depth as number) >= 0;
}

function canonicalEqual(a: unknown, b: unknown): boolean {
  try {
    return canonicalizeV2(a) === canonicalizeV2(b);
  } catch {
    return false;
  }
}

/** Errors in one mandate's own fields, whatever its position in the chain. */
function mandateShapeErrors(m: Record<string, unknown>): string[] {
  const errors: string[] = [];
  for (const field of ['mandate_id', 'human_id', 'agent_id']) {
    if (!isNonEmptyString(m[field])) errors.push(`missing or invalid ${field}`);
  }
  for (const field of ['valid_from', 'valid_until']) {
    if (parseRfc3339(m[field]) === undefined) errors.push(`missing or invalid ${field}`);
  }
  if (!Array.isArray(m.authority_scope) || m.authority_scope.length === 0 || !m.authority_scope.every(isScopeEntry)) {
    errors.push('missing or invalid authority_scope');
  } else {
    for (const entry of m.authority_scope as AuthorityScopeEntry[]) {
      for (const [key, v] of Object.entries(entry.limits ?? {})) {
        if (typeof v === 'number' && !isComparableNumber(v)) errors.push(`limits.${key} for domain "${entry.domain}" is not comparable`);
      }
    }
  }
  if (present(m, 'sub_delegation') && !isSubDelegation(m.sub_delegation)) errors.push('invalid sub_delegation');
  if (present(m, 'minimum_security_tier') && !(typeof m.minimum_security_tier === 'string' && hasOwn(TIER_RANK, m.minimum_security_tier))) {
    errors.push('invalid minimum_security_tier');
  }
  return errors;
}

/** Why `child` is not within `parent` (rule 5 of DCP-09 §3.5.2), or undefined when it is. */
function attenuationError(parent: AuthorityScopeEntry[], child: AuthorityScopeEntry[]): string | undefined {
  const byDomain = new Map<string, AuthorityScopeEntry>();
  for (const p of parent) {
    if (byDomain.has(p.domain)) return `authority_scope domain "${p.domain}" is duplicated in the parent`;
    byDomain.set(p.domain, p);
  }
  const seen = new Set<string>();
  for (const c of child) {
    if (seen.has(c.domain)) return `authority_scope domain "${c.domain}" is duplicated`;
    seen.add(c.domain);
    const p = byDomain.get(c.domain);
    if (!p) return `authority_scope domain "${c.domain}" is not in the parent`;
    const actions = new Set(p.actions_permitted);
    if (!c.actions_permitted.every((a) => actions.has(a))) {
      return `actions_permitted for domain "${c.domain}" is not a subset of the parent`;
    }
    if (c.data_classes !== undefined) {
      if (p.data_classes === undefined) return `data_classes for domain "${c.domain}" present but the parent has none`;
      const classes = new Set(p.data_classes);
      if (!c.data_classes.every((d) => classes.has(d))) {
        return `data_classes for domain "${c.domain}" is not a subset of the parent`;
      }
    }
    if (p.limits !== undefined) {
      if (c.limits === undefined) return `limits for domain "${c.domain}" missing`;
      for (const key of Object.keys(p.limits)) {
        if (!hasOwn(c.limits, key)) return `limits.${key} for domain "${c.domain}" missing`;
        const [pv, cv] = [p.limits[key], c.limits[key]];
        // A number may only shrink; anything else must stay identical. A number outside ±(2^53 − 1), or a
        // number against a non-number, is not comparable.
        if (typeof pv === 'number' || typeof cv === 'number') {
          if (!isComparableNumber(pv) || !isComparableNumber(cv)) return `limits.${key} for domain "${c.domain}" is not comparable`;
          if (cv > pv) return `limits.${key} for domain "${c.domain}" is not within the parent`;
        } else if (!canonicalEqual(pv, cv)) {
          return `limits.${key} for domain "${c.domain}" is not within the parent`;
        }
      }
    }
  }
  return undefined;
}

/** The key entry a signature slot names, or why none can verify it. */
function signerKey(keys: KeyEntry[], entry: SignatureEntry, nowMs: number): KeyEntry | string {
  if (!isNonEmptyString(entry.kid) || !isNonEmptyString(entry.alg) || typeof entry.sig_b64 !== 'string') {
    return 'malformed signature entry';
  }
  const key = keys.find((k) => isObject(k) && k.kid === entry.kid);
  if (!key) return `signer key kid=${entry.kid} not found`;
  if (key.alg !== entry.alg) return `signer key kid=${entry.kid} is ${key.alg}, not ${entry.alg}`;
  if (key.status !== 'active') return `signer key kid=${entry.kid} is ${String(key.status)}`;
  if (key.expires_at !== undefined && key.expires_at !== null) {
    const expires = parseRfc3339(key.expires_at);
    if (expires === undefined || expires < nowMs) return `signer key kid=${entry.kid} has expired or has an invalid expires_at`;
  }
  return key;
}

/** Verify `field` of `mandate`, a pq_over_classical composite signature over the mandate without its signature fields. */
async function mandateSigError(
  registry: AlgorithmRegistry,
  context: DcpContext,
  mandate: Record<string, unknown>,
  field: string,
  keys: KeyEntry[] | undefined,
  keysLabel: string,
  nowMs: number,
): Promise<string | undefined> {
  const sig = mandate[field];
  if (!isObject(sig) || !isObject(sig.classical) || !isObject(sig.pq) || sig.binding !== 'pq_over_classical') {
    return `${field} must be a pq_over_classical composite signature`;
  }
  const classical = sig.classical as unknown as SignatureEntry;
  const pq = sig.pq as unknown as SignatureEntry;
  if (!CLASSICAL_ALGS.includes(classical.alg)) return `${field} classical slot holds ${classical.alg}, which is not a classical algorithm`;
  if (!PQ_ALGS.includes(pq.alg)) return `${field} PQ slot holds ${pq.alg}, which is not a PQ algorithm`;
  if (!Array.isArray(keys)) return `${field}: no keys for ${keysLabel}`;
  const classicalKey = signerKey(keys, classical, nowMs);
  if (typeof classicalKey === 'string') return `${field}: ${classicalKey} in ${keysLabel}`;
  const pqKey = signerKey(keys, pq, nowMs);
  if (typeof pqKey === 'string') return `${field}: ${pqKey} in ${keysLabel}`;

  const { human_composite_sig: _human, delegator_composite_sig: _delegator, ...payload } = mandate;
  try {
    const bytes = new TextEncoder().encode(canonicalizeV2(payload));
    const result = await compositeVerify(
      registry,
      context,
      bytes,
      sig as unknown as CompositeSignature,
      classicalKey.public_key_b64,
      pqKey.public_key_b64,
    );
    if (!result.valid) return `${field} does not verify`;
  } catch (err) {
    return `${field} verification error: ${(err as Error).message}`;
  }
  return undefined;
}

/**
 * Verify a mandate chain, root first (DCP-09 §3.5.2): the root carries a
 * valid human signature; each sub-mandate links to the previous mandate, is
 * signed by that mandate's agent, is permitted by the chain's `sub_delegation`
 * policies, lies inside its parent's validity window, only narrows the
 * parent's authority and never lowers its `minimum_security_tier`; and no
 * mandate is revoked, so a revoked ancestor invalidates every descendant.
 * Anything unknown, missing for the depth or not comparable fails closed.
 * `now` is the verification time (default: the current time).
 */
export async function verifyMandateChain(
  registry: AlgorithmRegistry,
  chain: ReadonlyArray<DelegationMandate | SubMandate>,
  revokedMandateIds: Set<string>,
  keys: MandateChainKeys,
  now: Date | number = Date.now(),
): Promise<MandateChainResult> {
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const invalid = (errors: string[]): MandateChainResult => ({ valid: false, errors, depth: 0, effective_tier: null });
  if (!Array.isArray(chain) || chain.length === 0) return invalid(['chain must be a non-empty list of mandates']);
  if (!Number.isFinite(nowMs)) return invalid(['verification time is not an instant']);
  if (!isObject(keys) || !Array.isArray(keys.human_keys) || !isObject(keys.agent_keys)) {
    return invalid(['keys must have human_keys and agent_keys']);
  }

  let effective: SecurityTier | null = null;
  let maxDepth = Infinity; // the smallest sub_delegation.max_depth of the ancestors so far
  let parent: Record<string, unknown> | undefined;
  for (let i = 0; i < chain.length; i++) {
    const at = (error: string) => `mandate[${i}]: ${error}`;
    const m: unknown = chain[i];
    if (!isObject(m)) return invalid([at('not an object')]);
    const shape = mandateShapeErrors(m);
    if (shape.length > 0) return invalid(shape.map(at));

    const errors: string[] = [];
    let slotsRight: boolean;
    if (parent === undefined) {
      if (present(m, 'delegation_depth') && m.delegation_depth !== 0) errors.push(at('root must have delegation_depth 0'));
      if (present(m, 'parent_mandate_id')) errors.push(at('root must not have parent_mandate_id'));
      slotsRight = present(m, 'human_composite_sig') && !present(m, 'delegator_composite_sig');
      if (!slotsRight) errors.push(at('root must carry human_composite_sig and no delegator_composite_sig'));
    } else {
      const expectedDepth = ((parent.delegation_depth as number | undefined) ?? 0) + 1;
      if (m.delegation_depth !== expectedDepth) errors.push(at(`delegation_depth must be ${expectedDepth}`));
      if (m.parent_mandate_id !== parent.mandate_id) errors.push(at('parent_mandate_id must equal the parent mandate_id'));
      slotsRight = present(m, 'delegator_composite_sig') && !present(m, 'human_composite_sig');
      if (!slotsRight) errors.push(at('sub-mandate must carry delegator_composite_sig and no human_composite_sig'));
      const policy = parent.sub_delegation as SubDelegationPolicy | undefined;
      if (policy === undefined || policy.permitted !== true) {
        errors.push(at('parent does not permit sub-delegation'));
      } else {
        maxDepth = Math.min(maxDepth, policy.max_depth);
      }
      if (Number.isInteger(m.delegation_depth) && (m.delegation_depth as number) > maxDepth) {
        errors.push(at(`delegation_depth ${m.delegation_depth} exceeds sub_delegation.max_depth ${maxDepth}`));
      }
      if (m.human_id !== parent.human_id) errors.push(at('human_id differs from the parent'));
      if (parseRfc3339(m.valid_from)! < parseRfc3339(parent.valid_from)!) errors.push(at('valid_from is before the parent valid_from'));
      if (parseRfc3339(m.valid_until)! > parseRfc3339(parent.valid_until)!) errors.push(at('valid_until is after the parent valid_until'));
      const attenuation = attenuationError(
        parent.authority_scope as AuthorityScopeEntry[],
        m.authority_scope as AuthorityScopeEntry[],
      );
      if (attenuation) errors.push(at(attenuation));
      if (parent.minimum_security_tier !== undefined) {
        const tier = m.minimum_security_tier;
        if (typeof tier !== 'string' || TIER_RANK[tier] < TIER_RANK[parent.minimum_security_tier as string]) {
          errors.push(at('minimum_security_tier is below the parent'));
        }
      }
    }

    if (revokedMandateIds.has(m.mandate_id as string)) errors.push(at('revoked'));
    if (parseRfc3339(m.valid_from)! > nowMs) errors.push(at('not yet valid at the verification time'));
    if (parseRfc3339(m.valid_until)! < nowMs) errors.push(at('expired at the verification time'));

    // The signature is the costly check; only a mandate whose slots are right can have the right one.
    if (slotsRight) {
      const sigError =
        parent === undefined
          ? await mandateSigError(registry, DCP_CONTEXTS.Delegation, m, 'human_composite_sig', keys.human_keys, 'human_keys', nowMs)
          : await mandateSigError(
              registry,
              DCP_CONTEXTS.SubMandate,
              m,
              'delegator_composite_sig',
              hasOwn(keys.agent_keys, parent.agent_id as string) ? keys.agent_keys[parent.agent_id as string] : undefined,
              `agent_keys of ${parent.agent_id}`,
              nowMs,
            );
      if (sigError) errors.push(at(sigError));
    }
    if (errors.length > 0) return invalid(errors);

    if (m.minimum_security_tier !== undefined) {
      const tier = m.minimum_security_tier as SecurityTier;
      effective = effective === null ? tier : maxTier(effective, tier);
    }
    parent = m;
  }
  return { valid: true, errors: [], depth: chain.length - 1, effective_tier: effective };
}

/**
 * Revoke a delegation mandate.
 */
export function revokeDelegation(
  mandate: DelegationMandate,
  revokedMandateIds: Set<string>,
): { revoked: boolean; reason?: string } {
  if (!mandate.revocable) {
    return { revoked: false, reason: 'Mandate is not revocable' };
  }

  revokedMandateIds.add(mandate.mandate_id);
  return { revoked: true };
}

/**
 * Create a dual-layer interaction record between agents acting under delegation.
 */
export async function generateInteractionRecord(
  registry: AlgorithmRegistry,
  keys: CompositeKeyPair,
  params: {
    interaction_id: string;
    session_nonce: string;
    agent_id: string;
    counterparty_agent_id: string;
    public_layer: { terms: string; decisions: string; commitments: string };
    private_layer_hash: string;
    mandate_id: string;
  },
): Promise<InteractionRecord> {
  const payload = {
    dcp_version: '2.0' as const,
    interaction_id: params.interaction_id,
    session_nonce: params.session_nonce,
    agent_id: params.agent_id,
    counterparty_agent_id: params.counterparty_agent_id,
    public_layer: params.public_layer,
    private_layer_hash: params.private_layer_hash,
    mandate_id: params.mandate_id,
    timestamp: new Date().toISOString(),
  };

  const canonical = canonicalizeV2(payload);
  const payloadBytes = new TextEncoder().encode(canonical);
  const compositeSig = await compositeSign(registry, DCP_CONTEXTS.Delegation, payloadBytes, keys);

  return { ...payload, composite_sig: compositeSig };
}
