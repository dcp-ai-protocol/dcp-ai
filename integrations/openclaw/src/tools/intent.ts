/**
 * dcp_declare_intent — Declare a V2 intent with composite signatures (DCP-02).
 *
 * V2 changes:
 * - session_nonce embedded in intent and policy decision
 * - Composite-signed with context "DCP-AI.v2.Intent"
 * - risk_score is integer 0-1000 (millirisk, no floats)
 * - PolicyDecisionV2 includes applied_policy_hash
 */
import { Type, type Static } from '@sinclair/typebox';
import crypto from 'crypto';
import {
  registerDefaultProviders,
  getDefaultRegistry,
  compositeSign,
  classicalOnlySign,
  preparePayload,
  computeSecurityTier,
  DCP_CONTEXTS,
  type IntentV2,
  type PolicyDecisionV2,
  type ActionType,
  type DataClass,
  type Impact,
  type PolicyDecisionType,
  type SecurityTier,
  type SignedPayload,
} from '@dcp-ai/sdk';
import { getSession, isIdentityReady } from '../state/agent-state.js';

// ── Parameter Schema ──

export const DeclareIntentParams = Type.Object({
  session_id: Type.String({
    description: 'OpenClaw session / thread identifier',
  }),
  action_type: Type.Union(
    [
      Type.Literal('browse'), Type.Literal('api_call'),
      Type.Literal('send_email'), Type.Literal('create_calendar_event'),
      Type.Literal('initiate_payment'), Type.Literal('update_crm'),
      Type.Literal('write_file'), Type.Literal('execute_code'),
    ],
    { description: 'The type of action the agent intends to perform' },
  ),
  target_channel: Type.Union(
    [
      Type.Literal('web'), Type.Literal('api'), Type.Literal('email'),
      Type.Literal('calendar'), Type.Literal('payments'), Type.Literal('crm'),
      Type.Literal('filesystem'), Type.Literal('runtime'),
    ],
    { description: 'Target channel for the action' },
  ),
  estimated_impact: Type.Union(
    [Type.Literal('low'), Type.Literal('medium'), Type.Literal('high')],
    { description: 'Estimated impact level of the action' },
  ),
  target_description: Type.Optional(
    Type.String({ description: 'Human-readable description of the target' }),
  ),
  data_classes: Type.Optional(
    Type.Array(
      Type.Union([
        Type.Literal('none'), Type.Literal('contact_info'), Type.Literal('pii'),
        Type.Literal('credentials'), Type.Literal('financial_data'),
        Type.Literal('health_data'), Type.Literal('children_data'),
        Type.Literal('company_confidential'),
      ]),
      { description: 'Data classes involved. Defaults to ["none"].' },
    ),
  ),
});

export type DeclareIntentInput = Static<typeof DeclareIntentParams>;

// ── Risk Scoring (V2: integer millirisk 0-1000) ──

const IMPACT_SCORES: Record<string, number> = {
  low: 200, medium: 500, high: 900,
};

const ACTION_WEIGHTS: Record<string, number> = {
  browse: 100, api_call: 300, send_email: 500, create_calendar_event: 200,
  initiate_payment: 900, update_crm: 400, write_file: 400, execute_code: 700,
};

const SENSITIVE_DATA = new Set<string>([
  'pii', 'credentials', 'financial_data', 'health_data', 'children_data',
]);

function computeRiskScore(actionType: string, impact: string, dataClasses: string[]): number {
  const base = IMPACT_SCORES[impact] ?? 500;
  const actionWeight = ACTION_WEIGHTS[actionType] ?? 300;
  const sensitiveCount = dataClasses.filter(d => SENSITIVE_DATA.has(d)).length;
  const dataBoost = sensitiveCount * 150;
  return Math.min(1000, Math.round((base + actionWeight) / 2 + dataBoost));
}

function decidePolicy(riskScore: number): { decision: PolicyDecisionType; reasons: string[] } {
  if (riskScore >= 800) {
    return {
      decision: 'block',
      reasons: ['Risk score >= 800 (millirisk). Requires explicit human approval.'],
    };
  }
  if (riskScore >= 500) {
    return {
      decision: 'escalate',
      reasons: ['Risk score >= 500 (millirisk). Escalating for human review.'],
    };
  }
  return {
    decision: 'approve',
    reasons: ['Risk score within acceptable range.'],
  };
}

// ── Verifier policy hash (for PolicyDecisionV2.applied_policy_hash) ──
const DEFAULT_POLICY = {
  default_mode: 'hybrid_required',
  risk_overrides: { high: 'hybrid_required', medium: 'hybrid_required', low: 'hybrid_preferred' },
};
const APPLIED_POLICY_HASH = 'sha256:' + crypto.createHash('sha256')
  .update(JSON.stringify(DEFAULT_POLICY)).digest('hex');

// ── Execution ──

export interface DeclareIntentResult {
  intent_id: string;
  decision: PolicyDecisionType;
  risk_score: number;
  security_tier: SecurityTier;
  reasons: string[];
  requires_human_confirmation: boolean;
  message: string;
}

export async function executeDeclareIntent(
  params: DeclareIntentInput,
): Promise<DeclareIntentResult> {
  if (!isIdentityReady(params.session_id)) {
    throw new Error('DCP identity not set up. Run dcp_identity_setup first.');
  }

  registerDefaultProviders();
  const registry = getDefaultRegistry();
  const session = getSession(params.session_id);
  const now = new Date().toISOString();
  const intentId = `intent:${crypto.randomUUID()}`;
  const dataClasses = (params.data_classes ?? ['none']) as DataClass[];

  // Build IntentV2 with auto-computed security tier
  const intentForTier: IntentV2 = {
    dcp_version: '2.0',
    intent_id: intentId,
    session_nonce: session.sessionNonce!,
    agent_id: session.passportV2!.agent_id,
    human_id: session.rprV2!.human_id,
    timestamp: now,
    action_type: params.action_type as ActionType,
    target: {
      channel: params.target_channel as any,
      to: params.target_description ?? null,
    },
    data_classes: dataClasses,
    estimated_impact: params.estimated_impact as Impact,
    requires_consent: params.estimated_impact === 'high',
  };

  const securityTier = computeSecurityTier(intentForTier);
  const intent: IntentV2 = { ...intentForTier, security_tier: securityTier };

  session.intentsV2.set(intentId, intent);

  // Composite-sign intent
  const intentPrepared = preparePayload(intent);
  const intentSig = await compositeSign(
    registry,
    DCP_CONTEXTS.Intent,
    intentPrepared.canonicalBytes,
    session.compositeKeys!,
  );
  const signedIntent: SignedPayload<IntentV2> = {
    payload: intent,
    payload_hash: intentPrepared.payloadHash,
    composite_sig: intentSig,
  };
  session.signedIntents.set(intentId, signedIntent);

  // Risk scoring & policy decision (V2: integer millirisk)
  const riskScore = computeRiskScore(
    params.action_type,
    params.estimated_impact,
    dataClasses,
  );
  const { decision, reasons } = decidePolicy(riskScore);
  const requiresHuman = decision === 'block' || decision === 'escalate';

  const policyDecision: PolicyDecisionV2 = {
    dcp_version: '2.0',
    intent_id: intentId,
    session_nonce: session.sessionNonce!,
    decision,
    risk_score: riskScore,
    reasons,
    required_confirmation: requiresHuman
      ? { type: 'human_approve', fields: ['action_type', 'target', 'estimated_impact'] }
      : null,
    applied_policy_hash: APPLIED_POLICY_HASH,
    timestamp: now,
    resolved_tier: securityTier,
  };

  session.policyDecisionsV2.set(intentId, policyDecision);

  // Sign policy decision (classical-only: trusted internal component)
  const policyPrepared = preparePayload(policyDecision);
  const policySig = await classicalOnlySign(
    registry,
    DCP_CONTEXTS.PolicyDecision,
    policyPrepared.canonicalBytes,
    session.compositeKeys!.classical,
  );
  const signedPolicy: SignedPayload<PolicyDecisionV2> = {
    payload: policyDecision,
    payload_hash: policyPrepared.payloadHash,
    composite_sig: policySig,
  };
  session.signedPolicies.set(intentId, signedPolicy);

  return {
    intent_id: intentId,
    decision,
    risk_score: riskScore,
    security_tier: securityTier,
    reasons,
    requires_human_confirmation: requiresHuman,
    message:
      decision === 'approve'
        ? `Intent ${intentId} approved (risk: ${riskScore}/1000, tier: ${securityTier}). Proceed with ${params.action_type}.`
        : decision === 'escalate'
          ? `Intent ${intentId} escalated (risk: ${riskScore}/1000, tier: ${securityTier}). Awaiting human confirmation.`
          : `Intent ${intentId} blocked (risk: ${riskScore}/1000, tier: ${securityTier}). Requires explicit human approval.`,
  };
}
