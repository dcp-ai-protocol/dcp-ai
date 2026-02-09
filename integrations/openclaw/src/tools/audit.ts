/**
 * dcp_log_action + dcp_get_audit_trail — Audit tools with hash-chaining (DCP-03).
 *
 * dcp_log_action: Record an action as an AuditEntry. Automatically computes
 * intent_hash from the referenced Intent and prev_hash from the chain.
 *
 * dcp_get_audit_trail: Return the full audit trail for the current session.
 */
import { Type, type Static } from '@sinclair/typebox';
import {
  hashObject,
  intentHash as computeIntentHash,
  type AuditEntry,
  type AuditPolicyDecision,
} from '@dcp-ai/sdk';
import { getSession, isIdentityReady } from '../state/agent-state.js';

// ── dcp_log_action ──

export const LogActionParams = Type.Object({
  session_id: Type.String({
    description: 'OpenClaw session / thread identifier',
  }),
  intent_id: Type.String({
    description: 'The intent_id this action fulfills (from dcp_declare_intent)',
  }),
  outcome: Type.String({
    description: 'Description of the action outcome (e.g. "email sent", "file written", "API response 200")',
  }),
  evidence_tool: Type.Optional(
    Type.String({
      description: 'Name of the OpenClaw tool that was executed (e.g. "browser.navigate", "exec")',
    }),
  ),
  evidence_result_ref: Type.Optional(
    Type.String({
      description: 'Reference to the tool result (URL, file path, response hash, etc.)',
    }),
  ),
});

export type LogActionInput = Static<typeof LogActionParams>;

export interface LogActionResult {
  audit_id: string;
  intent_hash: string;
  prev_hash: string;
  chain_length: number;
  message: string;
}

export async function executeLogAction(
  params: LogActionInput,
): Promise<LogActionResult> {
  if (!isIdentityReady(params.session_id)) {
    throw new Error('DCP identity not set up. Run dcp_identity_setup first.');
  }

  const session = getSession(params.session_id);
  const intent = session.intents.get(params.intent_id);
  if (!intent) {
    throw new Error(
      `Intent ${params.intent_id} not found. Declare an intent with dcp_declare_intent first.`,
    );
  }

  const policy = session.policyDecisions.get(params.intent_id);

  // Compute hash chain values
  const iHash = computeIntentHash(intent);
  const prevHash =
    session.auditEntries.length === 0
      ? 'GENESIS'
      : hashObject(session.auditEntries[session.auditEntries.length - 1]);

  const auditId = `audit:${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  // Map policy decision to audit format
  let auditDecision: AuditPolicyDecision = 'approved';
  if (policy) {
    const map: Record<string, AuditPolicyDecision> = {
      approve: 'approved',
      escalate: 'escalated',
      block: 'blocked',
    };
    auditDecision = map[policy.decision] ?? 'approved';
  }

  const entry: AuditEntry = {
    dcp_version: '1.0',
    audit_id: auditId,
    prev_hash: prevHash,
    timestamp: now,
    agent_id: session.passport!.agent_id,
    human_id: session.hbr!.human_id,
    intent_id: params.intent_id,
    intent_hash: iHash,
    policy_decision: auditDecision,
    outcome: params.outcome,
    evidence: {
      tool: params.evidence_tool ?? null,
      result_ref: params.evidence_result_ref ?? null,
    },
  };

  session.auditEntries.push(entry);

  return {
    audit_id: auditId,
    intent_hash: iHash,
    prev_hash: prevHash,
    chain_length: session.auditEntries.length,
    message: `Action logged. Audit chain length: ${session.auditEntries.length}.`,
  };
}

// ── dcp_get_audit_trail ──

export const GetAuditTrailParams = Type.Object({
  session_id: Type.String({
    description: 'OpenClaw session / thread identifier',
  }),
  limit: Type.Optional(
    Type.Number({
      description: 'Maximum number of entries to return (most recent first). Omit for all.',
      minimum: 1,
    }),
  ),
});

export type GetAuditTrailInput = Static<typeof GetAuditTrailParams>;

export interface GetAuditTrailResult {
  entries: AuditEntry[];
  total: number;
  agent_id: string | null;
  human_id: string | null;
  message: string;
}

export async function executeGetAuditTrail(
  params: GetAuditTrailInput,
): Promise<GetAuditTrailResult> {
  const session = getSession(params.session_id);
  const total = session.auditEntries.length;

  let entries = [...session.auditEntries];
  if (params.limit && params.limit < entries.length) {
    entries = entries.slice(-params.limit);
  }

  return {
    entries,
    total,
    agent_id: session.passport?.agent_id ?? null,
    human_id: session.hbr?.human_id ?? null,
    message:
      total === 0
        ? 'No audit entries recorded yet.'
        : `Returned ${entries.length} of ${total} audit entries.`,
  };
}
