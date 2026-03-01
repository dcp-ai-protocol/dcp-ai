/**
 * DCP v2.0 Multi-Party Authorization (Gap #5).
 *
 * Critical operations (agent revocation, org key rotation, jurisdiction
 * change, recovery config modification) require M-of-N composite
 * signatures from authorized parties.
 *
 * Each party signs the operation_payload with their own composite
 * keypair. The verifier collects authorizations and checks that the
 * threshold is met.
 */

import type {
  MultiPartyAuthorization,
  MultiPartyOperation,
  PartyAuthorization,
  AuthorizationRole,
} from '../types/v2.js';
import type { CompositeSignature } from './composite-sig.js';
import type { CompositeKeyPair, CompositeVerifyResult } from './composite-ops.js';
import { compositeSign, compositeVerify } from './composite-ops.js';
import { AlgorithmRegistry } from './crypto-registry.js';
import { canonicalizeV2 } from './canonicalize.js';

const MPA_CONTEXT = 'DCP-AI.v2.MultiPartyAuth';

export interface MultiPartyPolicy {
  requiredParties: number;
  allowedRoles: AuthorizationRole[];
  requireOwner: boolean;
}

export interface MultiPartyConfig {
  thresholds?: Partial<Record<MultiPartyOperation, number>>;
  ownerRequirements?: Partial<Record<MultiPartyOperation, boolean>>;
  roleOverrides?: Partial<Record<MultiPartyOperation, AuthorizationRole[]>>;
}

const MIN_THRESHOLD = 2;

export const DEFAULT_MULTI_PARTY_POLICIES: Record<MultiPartyOperation, MultiPartyPolicy> = {
  revoke_agent: { requiredParties: 2, allowedRoles: ['owner', 'org_admin', 'recovery_contact'], requireOwner: true },
  rotate_org_key: { requiredParties: 2, allowedRoles: ['owner', 'org_admin'], requireOwner: true },
  change_jurisdiction: { requiredParties: 2, allowedRoles: ['owner', 'org_admin'], requireOwner: true },
  modify_recovery_config: { requiredParties: 2, allowedRoles: ['owner', 'org_admin', 'recovery_contact'], requireOwner: true },
};

/**
 * Create custom multi-party policies from a configuration object.
 * Thresholds are enforced to be >= MIN_THRESHOLD (2) for security.
 */
export function createMultiPartyPolicies(
  config: MultiPartyConfig,
): Record<MultiPartyOperation, MultiPartyPolicy> {
  const operations: MultiPartyOperation[] = [
    'revoke_agent', 'rotate_org_key', 'change_jurisdiction', 'modify_recovery_config',
  ];

  const result = { ...DEFAULT_MULTI_PARTY_POLICIES };

  for (const op of operations) {
    const threshold = config.thresholds?.[op];
    const roles = config.roleOverrides?.[op];
    const requireOwner = config.ownerRequirements?.[op];

    result[op] = {
      requiredParties: Math.max(MIN_THRESHOLD, threshold ?? result[op].requiredParties),
      allowedRoles: roles ?? result[op].allowedRoles,
      requireOwner: requireOwner ?? result[op].requireOwner,
    };
  }

  return result;
}

/**
 * Create a single party's authorization signature for an operation.
 */
export async function createPartyAuthorization(
  registry: AlgorithmRegistry,
  operation: MultiPartyOperation,
  operationPayload: Record<string, unknown>,
  partyId: string,
  role: AuthorizationRole,
  keys: CompositeKeyPair,
): Promise<PartyAuthorization> {
  const signable = {
    operation,
    operation_payload: operationPayload,
    party_id: partyId,
    role,
  };

  const canonical = canonicalizeV2(signable);
  const payloadBytes = new TextEncoder().encode(canonical);

  const sig = await compositeSign(registry, MPA_CONTEXT, payloadBytes, keys);

  return {
    party_id: partyId,
    role,
    composite_sig: sig,
  };
}

/**
 * Build a complete multi-party authorization from individual party authorizations.
 */
export function buildMultiPartyAuthorization(
  operation: MultiPartyOperation,
  operationPayload: Record<string, unknown>,
  requiredParties: number,
  authorizations: PartyAuthorization[],
): MultiPartyAuthorization {
  return {
    type: 'multi_party_authorization',
    operation,
    operation_payload: operationPayload,
    required_parties: requiredParties,
    authorizations,
  };
}

export interface MultiPartyVerifyResult {
  valid: boolean;
  errors: string[];
  partiesVerified: number;
  details: Array<{
    party_id: string;
    role: AuthorizationRole;
    sigValid: boolean;
  }>;
}

/**
 * Verify a multi-party authorization meets the policy threshold.
 *
 * Checks:
 *   1. Number of authorizations >= required_parties
 *   2. Each authorization's composite signature is valid
 *   3. Roles are allowed for the operation
 *   4. Owner is present if required by policy
 */
export async function verifyMultiPartyAuthorization(
  registry: AlgorithmRegistry,
  mpa: MultiPartyAuthorization,
  partyKeys: Map<string, { classicalPubkeyB64: string; pqPubkeyB64: string }>,
  policy?: MultiPartyPolicy,
): Promise<MultiPartyVerifyResult> {
  const errors: string[] = [];
  const effectivePolicy = policy || DEFAULT_MULTI_PARTY_POLICIES[mpa.operation];

  if (!effectivePolicy) {
    return {
      valid: false,
      errors: [`No policy defined for operation: ${mpa.operation}`],
      partiesVerified: 0,
      details: [],
    };
  }

  if (mpa.authorizations.length < effectivePolicy.requiredParties) {
    errors.push(
      `Insufficient authorizations: ${mpa.authorizations.length} < ${effectivePolicy.requiredParties}`,
    );
  }

  if (effectivePolicy.requireOwner) {
    const hasOwner = mpa.authorizations.some((a) => a.role === 'owner');
    if (!hasOwner) {
      errors.push('Owner authorization required but not present');
    }
  }

  const details: MultiPartyVerifyResult['details'] = [];
  let validCount = 0;

  for (const auth of mpa.authorizations) {
    if (!effectivePolicy.allowedRoles.includes(auth.role)) {
      errors.push(`Role ${auth.role} not allowed for operation ${mpa.operation}`);
      details.push({ party_id: auth.party_id, role: auth.role, sigValid: false });
      continue;
    }

    const keys = partyKeys.get(auth.party_id);
    if (!keys) {
      errors.push(`No public keys found for party ${auth.party_id}`);
      details.push({ party_id: auth.party_id, role: auth.role, sigValid: false });
      continue;
    }

    const signable = {
      operation: mpa.operation,
      operation_payload: mpa.operation_payload,
      party_id: auth.party_id,
      role: auth.role,
    };

    const canonical = canonicalizeV2(signable);
    const payloadBytes = new TextEncoder().encode(canonical);

    try {
      const result = await compositeVerify(
        registry,
        MPA_CONTEXT,
        payloadBytes,
        auth.composite_sig,
        keys.classicalPubkeyB64,
        keys.pqPubkeyB64,
      );

      details.push({ party_id: auth.party_id, role: auth.role, sigValid: result.valid });
      if (result.valid) validCount++;
      else errors.push(`Signature invalid for party ${auth.party_id}`);
    } catch (err) {
      errors.push(`Verification error for party ${auth.party_id}: ${(err as Error).message}`);
      details.push({ party_id: auth.party_id, role: auth.role, sigValid: false });
    }
  }

  if (validCount < effectivePolicy.requiredParties) {
    errors.push(
      `Insufficient valid signatures: ${validCount} < ${effectivePolicy.requiredParties}`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    partiesVerified: validCount,
    details,
  };
}
