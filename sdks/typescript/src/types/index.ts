/** DCP v1 Type Definitions — Generated from JSON Schemas */

// ── Enums ──

export type EntityType = 'natural_person' | 'organization';
export type LiabilityMode = 'owner_responsible';
export type Capability = 'browse' | 'api_call' | 'email' | 'calendar' | 'payments' | 'crm' | 'file_write' | 'code_exec';
export type RiskTier = 'low' | 'medium' | 'high';
export type AgentStatus = 'active' | 'revoked' | 'suspended';
export type ActionType = 'browse' | 'api_call' | 'send_email' | 'create_calendar_event' | 'initiate_payment' | 'update_crm' | 'write_file' | 'execute_code';
export type Channel = 'web' | 'api' | 'email' | 'calendar' | 'payments' | 'crm' | 'filesystem' | 'runtime';
export type DataClass = 'none' | 'contact_info' | 'pii' | 'credentials' | 'financial_data' | 'health_data' | 'children_data' | 'company_confidential';
export type Impact = 'low' | 'medium' | 'high';
export type PolicyDecisionType = 'approve' | 'escalate' | 'block';
export type AuditPolicyDecision = 'approved' | 'escalated' | 'blocked';
export type SignerType = 'human' | 'organization';
export type ConfirmationDecision = 'approve' | 'deny';

// ── DCP-01: Identity & Human Binding ──

export interface HumanBindingRecord {
  dcp_version: string;
  human_id: string;
  legal_name: string;
  entity_type: EntityType;
  jurisdiction: string;
  liability_mode: LiabilityMode;
  override_rights: boolean;
  issued_at: string;
  expires_at: string | null;
  contact?: string | null;
  signature: string;
}

export interface AgentPassport {
  dcp_version: string;
  agent_id: string;
  public_key: string;
  human_binding_reference: string;
  capabilities?: Capability[];
  risk_tier?: RiskTier;
  created_at: string;
  status: AgentStatus;
  signature: string;
}

// ── DCP-02: Intent Declaration & Policy Gating ──

export interface IntentTarget {
  channel: Channel;
  to?: string | null;
  domain?: string | null;
  url?: string | null;
  [key: string]: unknown;
}

export interface Intent {
  dcp_version: string;
  intent_id: string;
  agent_id: string;
  human_id: string;
  timestamp: string;
  action_type: ActionType;
  target: IntentTarget;
  data_classes: DataClass[];
  estimated_impact: Impact;
  requires_consent?: boolean | null;
}

export interface RequiredConfirmation {
  type: 'human_approve';
  fields?: string[];
}

export interface PolicyDecision {
  dcp_version: string;
  intent_id: string;
  decision: PolicyDecisionType;
  risk_score: number;
  reasons: string[];
  required_confirmation?: RequiredConfirmation | null;
}

// ── DCP-03: Audit Chain & Transparency ──

export interface AuditEvidence {
  tool?: string | null;
  result_ref?: string | null;
  [key: string]: unknown;
}

export interface AuditEntry {
  dcp_version: string;
  audit_id: string;
  prev_hash: string;
  timestamp: string;
  agent_id: string;
  human_id: string;
  intent_id: string;
  intent_hash: string;
  policy_decision: AuditPolicyDecision;
  outcome: string;
  evidence: AuditEvidence;
}

// ── Bundle Types ──

export interface CitizenshipBundle {
  human_binding_record: HumanBindingRecord;
  agent_passport: AgentPassport;
  intent: Intent;
  policy_decision: PolicyDecision;
  audit_entries: AuditEntry[];
}

export interface Signer {
  type: SignerType;
  id: string;
  public_key_b64: string;
}

export interface BundleSignature {
  alg: 'ed25519';
  created_at: string;
  signer: Signer;
  bundle_hash: string;
  merkle_root?: string | null;
  sig_b64: string;
}

export interface SignedBundle {
  bundle: CitizenshipBundle;
  signature: BundleSignature;
}

// ── Revocation ──

export interface RevocationRecord {
  dcp_version: string;
  agent_id: string;
  human_id: string;
  timestamp: string;
  reason: string;
  signature: string;
}

// ── Human Confirmation ──

export interface HumanConfirmation {
  dcp_version: string;
  intent_id: string;
  human_id: string;
  timestamp: string;
  decision: ConfirmationDecision;
  signature: string;
}

// ── Result Types ──

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

export interface VerificationResult {
  verified: boolean;
  errors?: string[];
}

export interface Keypair {
  publicKeyB64: string;
  secretKeyB64: string;
}
