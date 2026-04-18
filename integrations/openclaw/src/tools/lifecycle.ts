/**
 * DCP-05 Lifecycle tools — Commission, Vitality, Decommission.
 *
 * Follows the same pattern as tools/identity.ts:
 * TypeBox params → execute function → returns result object.
 */
import { Type, type Static } from '@sinclair/typebox';
import {
  registerDefaultProviders,
  getDefaultRegistry,
  createCommissioningCertificate,
  createVitalityReport,
  computeVitalityScore,
  createDecommissioningRecord,
} from '@dcp-ai/sdk';
import { getSession, isIdentityReady } from '../state/agent-state.js';

// ── Commission Agent ──

export const CommissionAgentParams = Type.Object({
  session_id: Type.String({ description: 'OpenClaw session / thread identifier' }),
  purpose: Type.String({ description: 'Purpose of the agent (DCP-05 §3.1)' }),
  capabilities: Type.Array(Type.String(), {
    description: 'Declared capabilities for commissioning',
  }),
  risk_tier: Type.Optional(
    Type.Union([Type.Literal('low'), Type.Literal('medium'), Type.Literal('high')], {
      description: 'Agent risk tier. Defaults to medium.',
      default: 'medium',
    }),
  ),
});

export type CommissionAgentInput = Static<typeof CommissionAgentParams>;

export interface CommissionAgentResult {
  certificate_id: string;
  agent_id: string;
  lifecycle_state: string;
  message: string;
}

export async function executeCommissionAgent(
  params: CommissionAgentInput,
): Promise<CommissionAgentResult> {
  if (!isIdentityReady(params.session_id)) {
    throw new Error('DCP identity not set up. Run dcp_identity_setup first.');
  }

  registerDefaultProviders();
  const registry = getDefaultRegistry();
  const session = getSession(params.session_id);

  const certificate = await createCommissioningCertificate(registry, session.compositeKeys!, {
    agent_id: session.passportV2!.agent_id,
    session_nonce: session.sessionNonce!,
    human_id: session.rprV2!.human_id,
    commissioning_authority: session.rprV2!.human_id,
    purpose: params.purpose,
    initial_capabilities: params.capabilities as any,
    risk_tier: (params.risk_tier ?? 'medium') as any,
    principal_binding_reference: session.rprV2!.human_id,
  });

  session.commissioningCertificate = certificate as any;
  session.lifecycleState = 'commissioned';

  return {
    certificate_id: (certificate as any).certificate_id ?? crypto.randomUUID(),
    agent_id: session.passportV2!.agent_id,
    lifecycle_state: 'commissioned',
    message: `Agent ${session.passportV2!.agent_id} commissioned (DCP-05 §3.1). Purpose: ${params.purpose}.`,
  };
}

// ── Report Vitality ──

export const ReportVitalityParams = Type.Object({
  session_id: Type.String({ description: 'OpenClaw session / thread identifier' }),
  metrics: Type.Object(
    {
      task_completion_rate: Type.Number({ description: '0.0–1.0' }),
      error_rate: Type.Number({ description: '0.0–1.0' }),
      human_satisfaction: Type.Number({ description: '0.0–1.0' }),
      policy_alignment: Type.Number({ description: '0.0–1.0' }),
    },
    { description: 'Vitality metrics (DCP-05 §4.1)' },
  ),
});

export type ReportVitalityInput = Static<typeof ReportVitalityParams>;

export interface ReportVitalityResult {
  report_id: string;
  agent_id: string;
  vitality_score: number;
  message: string;
}

export async function executeReportVitality(
  params: ReportVitalityInput,
): Promise<ReportVitalityResult> {
  if (!isIdentityReady(params.session_id)) {
    throw new Error('DCP identity not set up. Run dcp_identity_setup first.');
  }

  registerDefaultProviders();
  const registry = getDefaultRegistry();
  const session = getSession(params.session_id);

  const report = await createVitalityReport(registry, session.compositeKeys!, {
    agent_id: session.passportV2!.agent_id,
    session_nonce: session.sessionNonce!,
    state: session.lifecycleState as any,
    metrics: params.metrics,
    prev_report_hash: session.vitalityReports.length > 0 ? '__COMPUTE__' : 'GENESIS',
  });

  const score = computeVitalityScore(params.metrics);
  session.vitalityReports.push(report as any);

  return {
    report_id: (report as any).report_id ?? crypto.randomUUID(),
    agent_id: session.passportV2!.agent_id,
    vitality_score: score,
    message: `Vitality report recorded (DCP-05 §4.1). Score: ${score.toFixed(2)}.`,
  };
}

// ── Decommission Agent ──

export const DecommissionAgentParams = Type.Object({
  session_id: Type.String({ description: 'OpenClaw session / thread identifier' }),
  termination_mode: Type.Union(
    [Type.Literal('graceful'), Type.Literal('immediate'), Type.Literal('emergency')],
    { description: 'How to terminate the agent (DCP-05 §5.1)' },
  ),
  reason: Type.String({ description: 'Reason for decommissioning' }),
  successor_agent_id: Type.Optional(
    Type.String({ description: 'Agent ID to succeed this agent' }),
  ),
});

export type DecommissionAgentInput = Static<typeof DecommissionAgentParams>;

export interface DecommissionAgentResult {
  record_id: string;
  agent_id: string;
  lifecycle_state: string;
  message: string;
}

export async function executeDecommissionAgent(
  params: DecommissionAgentInput,
): Promise<DecommissionAgentResult> {
  if (!isIdentityReady(params.session_id)) {
    throw new Error('DCP identity not set up. Run dcp_identity_setup first.');
  }

  registerDefaultProviders();
  const registry = getDefaultRegistry();
  const session = getSession(params.session_id);

  const lastScore = session.vitalityReports.length > 0
    ? (session.vitalityReports[session.vitalityReports.length - 1] as any).vitality_score ?? 0
    : 0;

  const record = await createDecommissioningRecord(registry, session.compositeKeys!, {
    agent_id: session.passportV2!.agent_id,
    session_nonce: session.sessionNonce!,
    human_id: session.rprV2!.human_id,
    termination_mode: params.termination_mode as any,
    reason: params.reason,
    final_vitality_score: lastScore,
    successor_agent_id: params.successor_agent_id ?? null,
    data_disposition: 'archive' as any,
  });

  session.lifecycleState = 'decommissioned';

  return {
    record_id: (record as any).record_id ?? crypto.randomUUID(),
    agent_id: session.passportV2!.agent_id,
    lifecycle_state: 'decommissioned',
    message: `Agent ${session.passportV2!.agent_id} decommissioned (DCP-05 §5.1). Mode: ${params.termination_mode}. Reason: ${params.reason}.`,
  };
}
