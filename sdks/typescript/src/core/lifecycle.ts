/**
 * DCP-05 v2.0 Agent Lifecycle Management.
 *
 * Implements the agent lifecycle state machine:
 *   commissioned → active → declining → decommissioned
 *
 * Provides commissioning certificates, vitality reports (hash-chained),
 * decommissioning records, vitality scoring, and state transition validation.
 */

import { createHash } from 'crypto';
import type { CompositeSignature } from './composite-sig.js';
import type { CompositeKeyPair } from './composite-ops.js';
import { compositeSign } from './composite-ops.js';
import type { AlgorithmRegistry } from './crypto-registry.js';
import { canonicalizeV2 } from './canonicalize.js';
import { DCP_CONTEXTS } from './domain-separation.js';
import type {
  LifecycleState,
  TerminationMode,
  DataDisposition,
  VitalityMetrics,
  CommissioningCertificate,
  VitalityReport,
  DecommissioningRecord,
  Capability,
  RiskTier,
} from '../types/v2.js';

// ── Lifecycle State Machine ──

const VALID_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  commissioned: ['active', 'decommissioned'],
  active: ['declining', 'decommissioned'],
  declining: ['decommissioned', 'active'],
  decommissioned: [],
};

/**
 * Validate whether a state transition is allowed.
 */
export function validateStateTransition(from: LifecycleState, to: LifecycleState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Vitality Scoring ──

const METRIC_WEIGHTS = {
  task_completion_rate: 0.3,
  error_rate: 0.25,
  human_satisfaction: 0.25,
  policy_alignment: 0.2,
} as const;

/**
 * Compute a vitality score (0–1000) from metrics.
 * Higher is better. Error rate is inverted (lower error = higher score).
 */
export function computeVitalityScore(metrics: VitalityMetrics): number {
  const raw =
    metrics.task_completion_rate * METRIC_WEIGHTS.task_completion_rate +
    (1 - metrics.error_rate) * METRIC_WEIGHTS.error_rate +
    metrics.human_satisfaction * METRIC_WEIGHTS.human_satisfaction +
    metrics.policy_alignment * METRIC_WEIGHTS.policy_alignment;

  return Math.round(Math.max(0, Math.min(1, raw)) * 1000);
}

// ── Artifact Creation ──

/**
 * Create a commissioning certificate for a new agent.
 */
export async function createCommissioningCertificate(
  registry: AlgorithmRegistry,
  keys: CompositeKeyPair,
  params: {
    agent_id: string;
    session_nonce: string;
    human_id: string;
    commissioning_authority: string;
    purpose: string;
    initial_capabilities: Capability[];
    risk_tier: RiskTier;
    principal_binding_reference: string;
  },
): Promise<CommissioningCertificate> {
  const payload = {
    dcp_version: '2.0' as const,
    agent_id: params.agent_id,
    session_nonce: params.session_nonce,
    human_id: params.human_id,
    commissioning_authority: params.commissioning_authority,
    timestamp: new Date().toISOString(),
    purpose: params.purpose,
    initial_capabilities: params.initial_capabilities,
    risk_tier: params.risk_tier,
    principal_binding_reference: params.principal_binding_reference,
  };

  const canonical = canonicalizeV2(payload);
  const payloadBytes = new TextEncoder().encode(canonical);
  const compositeSig = await compositeSign(registry, DCP_CONTEXTS.Lifecycle, payloadBytes, keys);

  return { ...payload, composite_sig: compositeSig };
}

/**
 * Create a vitality report, hash-chained to the previous report.
 */
export async function createVitalityReport(
  registry: AlgorithmRegistry,
  keys: CompositeKeyPair,
  params: {
    agent_id: string;
    session_nonce: string;
    state: LifecycleState;
    metrics: VitalityMetrics;
    prev_report_hash: string;
  },
): Promise<VitalityReport> {
  const vitalityScore = computeVitalityScore(params.metrics);

  const payload = {
    dcp_version: '2.0' as const,
    agent_id: params.agent_id,
    session_nonce: params.session_nonce,
    timestamp: new Date().toISOString(),
    vitality_score: vitalityScore,
    state: params.state,
    metrics: params.metrics,
    prev_report_hash: params.prev_report_hash,
  };

  const canonical = canonicalizeV2(payload);
  const payloadBytes = new TextEncoder().encode(canonical);
  const compositeSig = await compositeSign(registry, DCP_CONTEXTS.Lifecycle, payloadBytes, keys);

  return { ...payload, composite_sig: compositeSig };
}

/**
 * Compute hash of a vitality report for chaining.
 */
export function hashVitalityReport(report: VitalityReport): string {
  const { composite_sig: _, ...payload } = report;
  return 'sha256:' + createHash('sha256').update(canonicalizeV2(payload)).digest('hex');
}

/**
 * Create a decommissioning record.
 */
export async function createDecommissioningRecord(
  registry: AlgorithmRegistry,
  keys: CompositeKeyPair,
  params: {
    agent_id: string;
    session_nonce: string;
    human_id: string;
    termination_mode: TerminationMode;
    reason: string;
    final_vitality_score: number;
    successor_agent_id: string | null;
    data_disposition: DataDisposition;
  },
): Promise<DecommissioningRecord> {
  const payload = {
    dcp_version: '2.0' as const,
    agent_id: params.agent_id,
    session_nonce: params.session_nonce,
    human_id: params.human_id,
    timestamp: new Date().toISOString(),
    termination_mode: params.termination_mode,
    reason: params.reason,
    final_vitality_score: params.final_vitality_score,
    successor_agent_id: params.successor_agent_id,
    data_disposition: params.data_disposition,
  };

  const canonical = canonicalizeV2(payload);
  const payloadBytes = new TextEncoder().encode(canonical);
  const compositeSig = await compositeSign(registry, DCP_CONTEXTS.Lifecycle, payloadBytes, keys);

  return { ...payload, composite_sig: compositeSig };
}
