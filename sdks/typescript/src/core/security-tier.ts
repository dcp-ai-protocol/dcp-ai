/**
 * DCP v2.0 Adaptive Security Tier Engine.
 *
 * Automatically selects the appropriate cryptographic security tier based on
 * intent risk score, data classification, and action type. The tier drives
 * verification mode selection and PQ checkpoint intervals.
 *
 * Tier 0 (ROUTINE)  — Ed25519 only, PQ checkpoint every 50 events
 * Tier 1 (STANDARD)  — Ed25519 + PQ checkpoint every 10 events
 * Tier 2 (ELEVATED)  — Full hybrid per-operation, checkpoint every event
 * Tier 3 (MAXIMUM)   — Full hybrid + immediate checkpoint verification
 */

import type { IntentV2, VerificationMode, DataClass, SecurityTier } from '../types/v2.js';

export type { SecurityTier } from '../types/v2.js';

const SENSITIVE_DATA_CLASSES: ReadonlySet<DataClass> = new Set([
  'pii',
  'financial_data',
  'health_data',
  'credentials',
  'children_data',
]);

const HIGH_VALUE_DATA_CLASSES: ReadonlySet<DataClass> = new Set([
  'credentials',
  'children_data',
]);

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
 * Compute the security tier for an intent based on risk score,
 * data classes, and action type. When risk_score is not provided,
 * classification falls back to data class / action type heuristics.
 */
export function computeSecurityTier(intent: IntentV2): SecurityTier {
  const score = (intent as IntentV2 & { risk_score?: number }).risk_score ?? 0;

  const hasHighValueData = intent.data_classes?.some((d) => HIGH_VALUE_DATA_CLASSES.has(d)) ?? false;
  const hasSensitiveData = intent.data_classes?.some((d) => SENSITIVE_DATA_CLASSES.has(d)) ?? false;
  const isPayment: boolean = intent.action_type === 'initiate_payment';

  if (score >= 800 || hasHighValueData) return 'maximum';
  if (score >= 500 || hasSensitiveData || isPayment) return 'elevated';
  if (score >= 200) return 'standard';
  return 'routine';
}

/**
 * Return the strictest (highest-rank) tier — useful when combining
 * auto-computed tier with an explicit override that must never downgrade.
 */
export function maxTier(a: SecurityTier, b: SecurityTier): SecurityTier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}

/**
 * Map a security tier to the corresponding verification mode.
 */
export function tierToVerificationMode(tier: SecurityTier): VerificationMode {
  return TIER_TO_VERIFICATION_MODE[tier];
}

/**
 * Map a security tier to the PQ checkpoint interval (number of events
 * between automatic checkpoints).
 */
export function tierToCheckpointInterval(tier: SecurityTier): number {
  return TIER_TO_CHECKPOINT_INTERVAL[tier];
}
