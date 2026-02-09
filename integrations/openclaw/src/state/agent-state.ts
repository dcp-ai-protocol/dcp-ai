/**
 * DCP per-session state management for OpenClaw agents.
 *
 * Tracks the agent's identity (keypair, HBR, passport), intents,
 * policy decisions, and the hash-chained audit trail across a session.
 */
import type {
  Keypair,
  HumanBindingRecord,
  AgentPassport,
  Intent,
  PolicyDecision,
  AuditEntry,
} from '@dcp-ai/sdk';

// ── Session State ──

export interface DCPSessionState {
  /** Ed25519 keypair for this session. */
  keypair: Keypair | null;
  /** Human Binding Record (DCP-01). */
  hbr: HumanBindingRecord | null;
  /** Agent Passport (DCP-01). */
  passport: AgentPassport | null;
  /** Intents declared this session, keyed by intent_id. */
  intents: Map<string, Intent>;
  /** Policy decisions this session, keyed by intent_id. */
  policyDecisions: Map<string, PolicyDecision>;
  /** Hash-chained audit entries (DCP-03). */
  auditEntries: AuditEntry[];
  /** Timestamp when the session was created. */
  createdAt: string;
}

// ── State Store (per session ID) ──

const sessions = new Map<string, DCPSessionState>();

/** Create a fresh session state. */
function createSession(): DCPSessionState {
  return {
    keypair: null,
    hbr: null,
    passport: null,
    intents: new Map(),
    policyDecisions: new Map(),
    auditEntries: [],
    createdAt: new Date().toISOString(),
  };
}

/**
 * Get (or lazily create) the DCP session state for a given session ID.
 * When used inside OpenClaw, the session ID maps to the OpenClaw session/thread.
 */
export function getSession(sessionId: string): DCPSessionState {
  let session = sessions.get(sessionId);
  if (!session) {
    session = createSession();
    sessions.set(sessionId, session);
  }
  return session;
}

/** Check whether identity has been set up for this session. */
export function isIdentityReady(sessionId: string): boolean {
  const s = sessions.get(sessionId);
  return !!(s?.keypair && s?.hbr && s?.passport);
}

/** Delete a session (useful at session end after building the final bundle). */
export function clearSession(sessionId: string): void {
  sessions.delete(sessionId);
}

/** List all active session IDs (for debugging / admin). */
export function listSessions(): string[] {
  return Array.from(sessions.keys());
}

/**
 * Get the last audit entry hash for chaining (DCP-03).
 * Returns "GENESIS" if the audit trail is empty.
 */
export function getLastAuditHash(sessionId: string): string {
  const s = sessions.get(sessionId);
  if (!s || s.auditEntries.length === 0) return 'GENESIS';
  // The actual hash is computed by the caller using hashObject()
  // from @dcp-ai/sdk, so here we return a sentinel that the caller
  // should replace. In practice the audit-tool computes it inline.
  return '__COMPUTE__';
}
