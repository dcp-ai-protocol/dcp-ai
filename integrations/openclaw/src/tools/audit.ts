/**
 * dcp_log_action + dcp_get_audit_trail — V2 audit tools (DCP-03).
 *
 * V2 changes:
 * - AuditEventV2 with session_nonce, dual-hash chains, Ed25519-only per-event sig
 * - PQ checkpoint at configurable interval (lazy PQ model)
 * - Hash chain uses "sha256:..." prefixed format
 */
import { Type, type Static } from '@sinclair/typebox';
import {
  registerDefaultProviders,
  getDefaultRegistry,
  sha256Hex,
  sha3_256Hex,
  canonicalizeV2,
  computeSecurityTier,
  tierToCheckpointInterval,
  DCP_CONTEXTS,
  PQCheckpointManager,
  type AuditEventV2,
  type AuditPolicyDecision,
  type SecurityTier,
} from '@dcp-ai/sdk';
import { getSession, isIdentityReady } from '../state/agent-state.js';

const PQ_CHECKPOINT_INTERVAL_DEFAULT = 10;

// ── dcp_log_action ──

export const LogActionParams = Type.Object({
  session_id: Type.String({
    description: 'OpenClaw session / thread identifier',
  }),
  intent_id: Type.String({
    description: 'The intent_id this action fulfills (from dcp_declare_intent)',
  }),
  outcome: Type.String({
    description: 'Description of the action outcome',
  }),
  evidence_tool: Type.Optional(
    Type.String({ description: 'Name of the tool that was executed' }),
  ),
  evidence_result_ref: Type.Optional(
    Type.String({ description: 'Reference to the tool result' }),
  ),
});

export type LogActionInput = Static<typeof LogActionParams>;

export interface LogActionResult {
  audit_id: string;
  intent_hash: string;
  prev_hash: string;
  chain_length: number;
  pq_checkpoint_produced: boolean;
  message: string;
}

// Per-session checkpoint managers
const checkpointManagers = new Map<string, PQCheckpointManager>();

function getCheckpointManager(sessionId: string, tier?: SecurityTier): PQCheckpointManager | null {
  const existing = checkpointManagers.get(sessionId);
  if (existing) {
    if (tier && existing.tier !== tier) {
      existing.setTier(tier);
    }
    return existing;
  }
  const session = getSession(sessionId);
  if (!session.compositeKeys || !session.sessionNonce) return null;

  registerDefaultProviders();
  const registry = getDefaultRegistry();
  const interval = tier ? tierToCheckpointInterval(tier) : PQ_CHECKPOINT_INTERVAL_DEFAULT;
  const manager = new PQCheckpointManager(
    interval,
    registry,
    session.sessionNonce,
    session.compositeKeys,
    tier,
  );
  checkpointManagers.set(sessionId, manager);
  return manager;
}

export async function executeLogAction(
  params: LogActionInput,
): Promise<LogActionResult> {
  if (!isIdentityReady(params.session_id)) {
    throw new Error('DCP identity not set up. Run dcp_identity_setup first.');
  }

  const session = getSession(params.session_id);
  const intent = session.intentsV2.get(params.intent_id);
  if (!intent) {
    throw new Error(`Intent ${params.intent_id} not found. Declare with dcp_declare_intent first.`);
  }

  const policy = session.policyDecisionsV2.get(params.intent_id);

  // Compute intent hash (sha256 of canonical intent)
  const intentCanonical = canonicalizeV2(intent);
  const iHash = `sha256:${sha256Hex(Buffer.from(intentCanonical, 'utf8'))}`;

  // Compute prev_hash from chain
  let prevHash: string;
  let prevHashSecondary: string | undefined;
  if (session.auditEntriesV2.length === 0) {
    prevHash = 'GENESIS';
    prevHashSecondary = 'GENESIS';
  } else {
    const lastEntry = session.auditEntriesV2[session.auditEntriesV2.length - 1];
    const lastCanonical = canonicalizeV2(lastEntry);
    const lastBytes = Buffer.from(lastCanonical, 'utf8');
    prevHash = `sha256:${sha256Hex(lastBytes)}`;
    prevHashSecondary = `sha3-256:${sha3_256Hex(lastBytes)}`;
  }

  const auditId = `audit:${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  let auditDecision: AuditPolicyDecision = 'approved';
  if (policy) {
    const map: Record<string, AuditPolicyDecision> = {
      approve: 'approved', escalate: 'escalated', block: 'blocked',
    };
    auditDecision = map[policy.decision] ?? 'approved';
  }

  // Compute evidence hash if evidence provided
  let evidenceHash: string | null = null;
  if (params.evidence_result_ref) {
    evidenceHash = `sha256:${sha256Hex(Buffer.from(params.evidence_result_ref, 'utf8'))}`;
  }

  const entry: AuditEventV2 = {
    dcp_version: '2.0',
    audit_id: auditId,
    session_nonce: session.sessionNonce!,
    prev_hash: prevHash,
    prev_hash_secondary: prevHashSecondary,
    hash_alg: 'sha256+sha3-256',
    timestamp: now,
    agent_id: session.passportV2!.agent_id,
    human_id: session.rprV2!.human_id,
    intent_id: params.intent_id,
    intent_hash: iHash,
    policy_decision: auditDecision,
    outcome: params.outcome,
    evidence: {
      tool: params.evidence_tool ?? null,
      result_ref: params.evidence_result_ref ?? null,
      evidence_hash: evidenceHash,
    },
    pq_checkpoint_ref: null,
  };

  session.auditEntriesV2.push(entry);

  // PQ checkpoint management (lazy model) — tier-aware interval
  let pqCheckpointProduced = false;
  const intentTier: SecurityTier | undefined =
    (intent as any).security_tier ?? computeSecurityTier(intent);
  const manager = getCheckpointManager(params.session_id, intentTier);
  if (manager) {
    const checkpoint = await manager.recordEvent(entry);
    if (checkpoint) {
      session.pqCheckpoints.push(checkpoint);
      // Update the last N entries with checkpoint ref
      const count = checkpoint.event_range.count;
      const start = session.auditEntriesV2.length - count;
      for (let i = start; i < session.auditEntriesV2.length; i++) {
        if (i >= 0) {
          session.auditEntriesV2[i].pq_checkpoint_ref = checkpoint.checkpoint_id;
        }
      }
      pqCheckpointProduced = true;
    }
  }

  session.checkpointCounter++;

  return {
    audit_id: auditId,
    intent_hash: iHash,
    prev_hash: prevHash,
    chain_length: session.auditEntriesV2.length,
    pq_checkpoint_produced: pqCheckpointProduced,
    message: `Action logged (V2). Chain length: ${session.auditEntriesV2.length}.${pqCheckpointProduced ? ' PQ checkpoint produced.' : ''}`,
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
  entries: AuditEventV2[];
  total: number;
  pq_checkpoints: number;
  agent_id: string | null;
  human_id: string | null;
  message: string;
}

export async function executeGetAuditTrail(
  params: GetAuditTrailInput,
): Promise<GetAuditTrailResult> {
  const session = getSession(params.session_id);
  const total = session.auditEntriesV2.length;

  let entries = [...session.auditEntriesV2];
  if (params.limit && params.limit < entries.length) {
    entries = entries.slice(-params.limit);
  }

  return {
    entries,
    total,
    pq_checkpoints: session.pqCheckpoints.length,
    agent_id: session.passportV2?.agent_id ?? null,
    human_id: session.rprV2?.human_id ?? null,
    message:
      total === 0
        ? 'No audit entries recorded yet.'
        : `Returned ${entries.length} of ${total} audit entries (${session.pqCheckpoints.length} PQ checkpoints).`,
  };
}
