/**
 * DCP per-session state management for OpenClaw agents (V1 + V2).
 *
 * V2 additions:
 * - session_nonce for anti-splicing
 * - Dual keypairs (classical + PQ) via CompositeKeyPair
 * - PQ checkpoint tracking
 * - Emergency revocation token
 * - V2 artifact types
 */
import type {
  Keypair,
  ResponsiblePrincipalRecord,
  AgentPassport,
  Intent,
  PolicyDecision,
  AuditEntry,
  CompositeKeyPair,
  AgentPassportV2,
  ResponsiblePrincipalRecordV2,
  IntentV2,
  PolicyDecisionV2,
  AuditEventV2,
  PQCheckpoint,
  SignedPayload,
  EmergencyRevocationTokenPair,
} from '@dcp-ai/sdk';

// ── Session State ──

export interface DCPSessionState {
  /** Protocol version for this session. */
  dcpVersion: '1.0' | '2.0';

  // ── V1 fields ──
  keypair: Keypair | null;
  rpr: ResponsiblePrincipalRecord | null;
  passport: AgentPassport | null;
  intents: Map<string, Intent>;
  policyDecisions: Map<string, PolicyDecision>;
  auditEntries: AuditEntry[];

  // ── V2 fields ──
  sessionNonce: string | null;
  compositeKeys: CompositeKeyPair | null;
  rprV2: ResponsiblePrincipalRecordV2 | null;
  passportV2: AgentPassportV2 | null;
  signedPassport: SignedPayload<AgentPassportV2> | null;
  signedRpr: SignedPayload<ResponsiblePrincipalRecordV2> | null;
  intentsV2: Map<string, IntentV2>;
  signedIntents: Map<string, SignedPayload<IntentV2>>;
  policyDecisionsV2: Map<string, PolicyDecisionV2>;
  signedPolicies: Map<string, SignedPayload<PolicyDecisionV2>>;
  auditEntriesV2: AuditEventV2[];
  pqCheckpoints: PQCheckpoint[];
  checkpointCounter: number;
  emergencyToken: EmergencyRevocationTokenPair | null;

  // ── DCP-05–09 fields ──
  lifecycleState: 'active' | 'commissioned' | 'declining' | 'decommissioned';
  commissioningCertificate: Record<string, unknown> | null;
  vitalityReports: Record<string, unknown>[];
  digitalTestament: Record<string, unknown> | null;
  delegationMandate: Record<string, unknown> | null;

  createdAt: string;
}

// ── State Store ──

const sessions = new Map<string, DCPSessionState>();

function createSession(): DCPSessionState {
  return {
    dcpVersion: '2.0',
    keypair: null,
    rpr: null,
    passport: null,
    intents: new Map(),
    policyDecisions: new Map(),
    auditEntries: [],
    sessionNonce: null,
    compositeKeys: null,
    rprV2: null,
    passportV2: null,
    signedPassport: null,
    signedRpr: null,
    intentsV2: new Map(),
    signedIntents: new Map(),
    policyDecisionsV2: new Map(),
    signedPolicies: new Map(),
    auditEntriesV2: [],
    pqCheckpoints: [],
    checkpointCounter: 0,
    emergencyToken: null,
    lifecycleState: 'active',
    commissioningCertificate: null,
    vitalityReports: [],
    digitalTestament: null,
    delegationMandate: null,
    createdAt: new Date().toISOString(),
  };
}

export function getSession(sessionId: string): DCPSessionState {
  let session = sessions.get(sessionId);
  if (!session) {
    session = createSession();
    sessions.set(sessionId, session);
  }
  return session;
}

export function isIdentityReady(sessionId: string): boolean {
  const s = sessions.get(sessionId);
  if (!s) return false;
  if (s.dcpVersion === '2.0') {
    return !!(s.compositeKeys && s.rprV2 && s.passportV2 && s.sessionNonce);
  }
  return !!(s.keypair && s.rpr && s.passport);
}

export function clearSession(sessionId: string): void {
  sessions.delete(sessionId);
}

export function listSessions(): string[] {
  return Array.from(sessions.keys());
}

export function getLastAuditHash(sessionId: string): string {
  const s = sessions.get(sessionId);
  if (!s) return 'GENESIS';
  if (s.dcpVersion === '2.0') {
    return s.auditEntriesV2.length === 0 ? 'GENESIS' : '__COMPUTE__';
  }
  return s.auditEntries.length === 0 ? 'GENESIS' : '__COMPUTE__';
}
