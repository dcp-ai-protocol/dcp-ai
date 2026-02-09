/**
 * dcp_declare_intent — Declare an intent before performing an action (DCP-02).
 *
 * Required before sensitive operations like API calls, file writes, or payments.
 * Returns a PolicyDecision (approve / escalate / block) based on risk scoring.
 */
import { Type, type Static } from '@sinclair/typebox';
import type {
  Intent,
  PolicyDecision,
  ActionType,
  Channel,
  DataClass,
  Impact,
  PolicyDecisionType,
} from '@dcp-ai/sdk';
import { getSession, isIdentityReady } from '../state/agent-state.js';

// ── Parameter Schema ──

export const DeclareIntentParams = Type.Object({
  session_id: Type.String({
    description: 'OpenClaw session / thread identifier',
  }),
  action_type: Type.Union(
    [
      Type.Literal('browse'),
      Type.Literal('api_call'),
      Type.Literal('send_email'),
      Type.Literal('create_calendar_event'),
      Type.Literal('initiate_payment'),
      Type.Literal('update_crm'),
      Type.Literal('write_file'),
      Type.Literal('execute_code'),
    ],
    { description: 'The type of action the agent intends to perform' },
  ),
  target_channel: Type.Union(
    [
      Type.Literal('web'),
      Type.Literal('api'),
      Type.Literal('email'),
      Type.Literal('calendar'),
      Type.Literal('payments'),
      Type.Literal('crm'),
      Type.Literal('filesystem'),
      Type.Literal('runtime'),
    ],
    { description: 'Target channel for the action' },
  ),
  estimated_impact: Type.Union(
    [Type.Literal('low'), Type.Literal('medium'), Type.Literal('high')],
    { description: 'Estimated impact level of the action' },
  ),
  target_description: Type.Optional(
    Type.String({ description: 'Human-readable description of the target (URL, email, file path, etc.)' }),
  ),
  data_classes: Type.Optional(
    Type.Array(
      Type.Union([
        Type.Literal('none'),
        Type.Literal('contact_info'),
        Type.Literal('pii'),
        Type.Literal('credentials'),
        Type.Literal('financial_data'),
        Type.Literal('health_data'),
        Type.Literal('children_data'),
        Type.Literal('company_confidential'),
      ]),
      { description: 'Data classes involved. Defaults to ["none"].' },
    ),
  ),
});

export type DeclareIntentInput = Static<typeof DeclareIntentParams>;

// ── Risk Scoring ──

const IMPACT_SCORES: Record<Impact, number> = {
  low: 0.2,
  medium: 0.5,
  high: 0.9,
};

const ACTION_WEIGHTS: Partial<Record<ActionType, number>> = {
  browse: 0.1,
  api_call: 0.3,
  send_email: 0.5,
  create_calendar_event: 0.2,
  initiate_payment: 0.9,
  update_crm: 0.4,
  write_file: 0.4,
  execute_code: 0.7,
};

const SENSITIVE_DATA: Set<DataClass> = new Set([
  'pii',
  'credentials',
  'financial_data',
  'health_data',
  'children_data',
]);

function computeRiskScore(
  actionType: ActionType,
  impact: Impact,
  dataClasses: DataClass[],
): number {
  const base = IMPACT_SCORES[impact];
  const actionWeight = ACTION_WEIGHTS[actionType] ?? 0.3;
  const sensitiveCount = dataClasses.filter((d) => SENSITIVE_DATA.has(d)).length;
  const dataBoost = sensitiveCount * 0.15;
  return Math.min(1, (base + actionWeight) / 2 + dataBoost);
}

function decidePolicy(riskScore: number): { decision: PolicyDecisionType; reasons: string[] } {
  if (riskScore >= 0.8) {
    return {
      decision: 'block',
      reasons: [
        'Risk score exceeds threshold (>=0.8).',
        'Action requires explicit human approval before proceeding.',
      ],
    };
  }
  if (riskScore >= 0.5) {
    return {
      decision: 'escalate',
      reasons: ['Risk score is elevated (>=0.5). Escalating for human review.'],
    };
  }
  return {
    decision: 'approve',
    reasons: ['Risk score is within acceptable range.'],
  };
}

// ── Execution ──

export interface DeclareIntentResult {
  intent_id: string;
  decision: PolicyDecisionType;
  risk_score: number;
  reasons: string[];
  requires_human_confirmation: boolean;
  message: string;
}

export async function executeDeclareIntent(
  params: DeclareIntentInput,
): Promise<DeclareIntentResult> {
  if (!isIdentityReady(params.session_id)) {
    throw new Error(
      'DCP identity not set up. Run dcp_identity_setup first.',
    );
  }

  const session = getSession(params.session_id);
  const now = new Date().toISOString();
  const intentId = `intent:${crypto.randomUUID()}`;
  const dataClasses: DataClass[] = params.data_classes ?? ['none'];

  // Build Intent (DCP-02)
  const intent: Intent = {
    dcp_version: '1.0',
    intent_id: intentId,
    agent_id: session.passport!.agent_id,
    human_id: session.hbr!.human_id,
    timestamp: now,
    action_type: params.action_type as ActionType,
    target: {
      channel: params.target_channel as Channel,
      domain: params.target_description ?? null,
    },
    data_classes: dataClasses,
    estimated_impact: params.estimated_impact as Impact,
    requires_consent: params.estimated_impact === 'high',
  };

  session.intents.set(intentId, intent);

  // Risk scoring & policy decision
  const riskScore = computeRiskScore(
    params.action_type as ActionType,
    params.estimated_impact as Impact,
    dataClasses,
  );
  const { decision, reasons } = decidePolicy(riskScore);
  const requiresHuman = decision === 'block' || decision === 'escalate';

  const policyDecision: PolicyDecision = {
    dcp_version: '1.0',
    intent_id: intentId,
    decision,
    risk_score: Math.round(riskScore * 100) / 100,
    reasons,
    required_confirmation: requiresHuman
      ? { type: 'human_approve', fields: ['action_type', 'target', 'estimated_impact'] }
      : null,
  };

  session.policyDecisions.set(intentId, policyDecision);

  return {
    intent_id: intentId,
    decision,
    risk_score: policyDecision.risk_score,
    reasons,
    requires_human_confirmation: requiresHuman,
    message:
      decision === 'approve'
        ? `Intent ${intentId} approved. You may proceed with ${params.action_type}.`
        : decision === 'escalate'
          ? `Intent ${intentId} escalated. Awaiting human confirmation before ${params.action_type}.`
          : `Intent ${intentId} blocked. Risk too high for ${params.action_type}. Requires explicit human approval.`,
  };
}
