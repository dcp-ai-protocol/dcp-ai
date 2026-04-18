/**
 * DCP-09 v2.0 Awareness Threshold Engine.
 *
 * Configures and evaluates when an agent must notify its human principal.
 * Mirrors the security-tier pattern but operates on significance rather than risk.
 *
 * Significance scoring: 0–1000 (millipoints).
 */

import type { CompositeKeyPair } from './composite-ops.js';
import { compositeSign } from './composite-ops.js';
import type { AlgorithmRegistry } from './crypto-registry.js';
import { canonicalizeV2 } from './canonicalize.js';
import { DCP_CONTEXTS } from './domain-separation.js';
import type {
  ThresholdOperator,
  ThresholdAction,
  ThresholdRule,
  AwarenessThreshold,
  AdvisoryDeclaration,
} from '../types/v2.js';

// ── Significance Scoring ──

export interface SignificanceContext {
  financial_impact?: number;
  data_sensitivity?: number;
  relationship_impact?: number;
  irreversibility?: number;
  precedent_setting?: number;
}

const SIGNIFICANCE_WEIGHTS = {
  financial_impact: 0.25,
  data_sensitivity: 0.20,
  relationship_impact: 0.20,
  irreversibility: 0.20,
  precedent_setting: 0.15,
} as const;

/**
 * Evaluate the significance of an action (0–1000).
 */
export function evaluateSignificance(context: SignificanceContext): number {
  let total = 0;
  for (const [key, weight] of Object.entries(SIGNIFICANCE_WEIGHTS)) {
    const value = context[key as keyof SignificanceContext] ?? 0;
    total += Math.max(0, Math.min(1, value)) * weight;
  }
  return Math.round(total * 1000);
}

// ── Threshold Evaluation ──

function evaluateOperator(operator: ThresholdOperator, actual: number, threshold: number): boolean {
  switch (operator) {
    case 'gt': return actual > threshold;
    case 'lt': return actual < threshold;
    case 'gte': return actual >= threshold;
    case 'lte': return actual <= threshold;
    case 'eq': return actual === threshold;
  }
}

/**
 * Determine whether a human should be notified given significance and threshold rules.
 */
export function shouldNotifyHuman(
  significance: number,
  thresholds: ThresholdRule[],
): { notify: boolean; triggered_rules: ThresholdRule[]; actions: ThresholdAction[] } {
  const triggered: ThresholdRule[] = [];
  const actions = new Set<ThresholdAction>();

  for (const rule of thresholds) {
    const value = rule.dimension === 'significance' ? significance : 0;
    if (evaluateOperator(rule.operator, value, rule.value)) {
      triggered.push(rule);
      actions.add(rule.action_if_triggered);
    }
  }

  return {
    notify: triggered.length > 0,
    triggered_rules: triggered,
    actions: [...actions],
  };
}

// ── Artifact Creation ──

/**
 * Create an awareness threshold configuration.
 */
export async function createAwarenessThreshold(
  registry: AlgorithmRegistry,
  keys: CompositeKeyPair,
  params: {
    threshold_id: string;
    session_nonce: string;
    agent_id: string;
    human_id: string;
    threshold_rules: ThresholdRule[];
  },
): Promise<AwarenessThreshold> {
  const payload = {
    dcp_version: '2.0' as const,
    threshold_id: params.threshold_id,
    session_nonce: params.session_nonce,
    agent_id: params.agent_id,
    human_id: params.human_id,
    threshold_rules: params.threshold_rules,
    timestamp: new Date().toISOString(),
  };

  const canonical = canonicalizeV2(payload);
  const payloadBytes = new TextEncoder().encode(canonical);
  const compositeSig = await compositeSign(registry, DCP_CONTEXTS.Awareness, payloadBytes, keys);

  return { ...payload, composite_sig: compositeSig };
}

/**
 * Create an advisory declaration to notify the human.
 */
export async function createAdvisoryDeclaration(
  registry: AlgorithmRegistry,
  keys: CompositeKeyPair,
  params: {
    declaration_id: string;
    session_nonce: string;
    agent_id: string;
    human_id: string;
    significance_score: number;
    action_summary: string;
    recommended_response: string;
    response_deadline: string;
  },
): Promise<AdvisoryDeclaration> {
  const payload = {
    dcp_version: '2.0' as const,
    declaration_id: params.declaration_id,
    session_nonce: params.session_nonce,
    agent_id: params.agent_id,
    human_id: params.human_id,
    significance_score: params.significance_score,
    action_summary: params.action_summary,
    recommended_response: params.recommended_response,
    response_deadline: params.response_deadline,
    human_response: null,
    proceeded_without_response: false,
    timestamp: new Date().toISOString(),
  };

  const canonical = canonicalizeV2(payload);
  const payloadBytes = new TextEncoder().encode(canonical);
  const compositeSig = await compositeSign(registry, DCP_CONTEXTS.Awareness, payloadBytes, keys);

  return { ...payload, composite_sig: compositeSig };
}
