/**
 * DCP v2.0 Adaptive Security Tier Engine.
 *
 * Selects the cryptographic security tier from the policy decision's risk
 * score and the intent's data classes, action type and estimated impact. The
 * tier drives verification mode selection and PQ checkpoint intervals.
 *
 * Tier 0 (ROUTINE)  — Ed25519 only, PQ checkpoint every 50 events
 * Tier 1 (STANDARD)  — Ed25519 + PQ checkpoint every 10 events
 * Tier 2 (ELEVATED)  — Full hybrid per-operation, checkpoint every event
 * Tier 3 (MAXIMUM)   — Full hybrid + immediate checkpoint verification
 */

import type { IntentV2, PolicyDecisionV2, VerificationMode, SecurityTier } from '../types/v2.js';

export type { SecurityTier } from '../types/v2.js';

// Values allowed by schemas/v2/intent.schema.json.
const ACTION_TYPES: ReadonlySet<unknown> = new Set([
  'browse',
  'api_call',
  'send_email',
  'create_calendar_event',
  'initiate_payment',
  'update_crm',
  'write_file',
  'execute_code',
]);
const DATA_CLASSES: ReadonlySet<unknown> = new Set([
  'none',
  'contact_info',
  'pii',
  'credentials',
  'financial_data',
  'health_data',
  'children_data',
  'company_confidential',
]);
const IMPACTS: ReadonlySet<unknown> = new Set(['low', 'medium', 'high']);
const TIERS: ReadonlySet<unknown> = new Set(['routine', 'standard', 'elevated', 'maximum']);

const MAXIMUM_DATA_CLASSES: ReadonlySet<unknown> = new Set(['credentials', 'children_data']);
const ELEVATED_DATA_CLASSES: ReadonlySet<unknown> = new Set(['pii', 'financial_data', 'health_data']);

const TIER_TO_VERIFICATION_MODE: Record<SecurityTier, VerificationMode> = {
  routine: 'classical_only',
  standard: 'hybrid_preferred',
  elevated: 'hybrid_required',
  maximum: 'hybrid_required',
};

const TIER_TO_CHECKPOINT_INTERVAL: Record<SecurityTier, number> = {
  routine: 50,
  standard: 10,
  elevated: 1,
  maximum: 1,
};

/**
 * Numeric ordering for tier comparison — higher value = stricter tier.
 */
const TIER_RANK: Record<SecurityTier, number> = {
  routine: 0,
  standard: 1,
  elevated: 2,
  maximum: 3,
};

/**
 * Compute the security tier (spec §14.2) from the intent and the bundle's
 * policy decision. `risk_score` is read from the policy decision only; with
 * no policy decision it counts as 0, as does a non-numeric value. A value
 * outside the intent schema enums, including a missing `action_type`,
 * `estimated_impact` or `data_classes`, fails closed to at least `elevated`.
 * An explicit `intent.security_tier` can only raise the result.
 */
export function computeSecurityTier(
  intent: IntentV2,
  policyDecision?: Pick<PolicyDecisionV2, 'risk_score'>,
): SecurityTier {
  // Signed payloads are not schema-checked here, so read them as untyped.
  const raw = intent as unknown as Record<string, unknown>;
  const riskScore: unknown = policyDecision?.risk_score;
  const score = typeof riskScore === 'number' ? riskScore : 0;
  const dataClasses: unknown[] = Array.isArray(raw.data_classes) ? raw.data_classes : [undefined];
  const unknownValue =
    !ACTION_TYPES.has(raw.action_type) ||
    !IMPACTS.has(raw.estimated_impact) ||
    dataClasses.some((d) => !DATA_CLASSES.has(d));

  let tier: SecurityTier;
  if (score >= 800 || dataClasses.some((d) => MAXIMUM_DATA_CLASSES.has(d))) {
    tier = 'maximum';
  } else if (
    score >= 500 ||
    unknownValue ||
    dataClasses.some((d) => ELEVATED_DATA_CLASSES.has(d)) ||
    raw.action_type === 'initiate_payment' ||
    raw.estimated_impact === 'high'
  ) {
    tier = 'elevated';
  } else if (score >= 200 || raw.estimated_impact === 'medium') {
    tier = 'standard';
  } else {
    tier = 'routine';
  }

  const explicit = raw.security_tier;
  if (explicit === undefined || explicit === null) return tier;
  return maxTier(tier, explicit as SecurityTier);
}

/** A tier name, or 'elevated' for anything else: fails closed, never an inherited value. */
function knownTier(tier: SecurityTier): SecurityTier {
  return TIERS.has(tier) ? tier : 'elevated';
}

/**
 * Return the strictest (highest-rank) tier — useful when combining
 * auto-computed tier with an explicit override that must never downgrade.
 * An unknown tier name counts as 'elevated'.
 */
export function maxTier(a: SecurityTier, b: SecurityTier): SecurityTier {
  const [x, y] = [knownTier(a), knownTier(b)];
  return TIER_RANK[x] >= TIER_RANK[y] ? x : y;
}

/**
 * Map a security tier to the corresponding verification mode.
 */
export function tierToVerificationMode(tier: SecurityTier): VerificationMode {
  return TIER_TO_VERIFICATION_MODE[knownTier(tier)];
}

/**
 * Map a security tier to the PQ checkpoint interval (number of events
 * between automatic checkpoints).
 */
export function tierToCheckpointInterval(tier: SecurityTier): number {
  return TIER_TO_CHECKPOINT_INTERVAL[knownTier(tier)];
}
