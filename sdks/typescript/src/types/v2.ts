/**
 * DCP v2.0 Type Definitions.
 *
 * Key differences from V1:
 * - No inline signatures (SignedPayload envelope handles signing)
 * - session_nonce on every artifact (anti-splicing)
 * - keys[] array instead of single public_key (multi-algorithm)
 * - risk_score is integer 0-1000 (millirisk, no floats)
 * - Blinded RPR mode for PII protection
 */

import type { KeyEntry } from '../core/crypto-provider.js';
import type { CompositeSignature } from '../core/composite-sig.js';
import type { SignedPayload } from '../core/signed-payload.js';

// ── Re-export shared types ──

export type { KeyEntry } from '../core/crypto-provider.js';
export type { CompositeSignature, SignatureEntry, BindingMode } from '../core/composite-sig.js';
export type { SignedPayload } from '../core/signed-payload.js';
export type { DualHash } from '../core/dual-hash.js';

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
export type VerificationMode = 'classical_only' | 'pq_only' | 'hybrid_required' | 'hybrid_preferred';

// ── DCP-01 V2: Identity & Responsible Principal ──

export interface AgentPassportV2 {
  dcp_version: '2.0';
  agent_id: string;
  session_nonce: string;
  keys: KeyEntry[];
  principal_binding_reference: string;
  capabilities: Capability[];
  risk_tier: RiskTier;
  created_at: string;
  status: AgentStatus;
  emergency_revocation_token?: string;
}

export interface ResponsiblePrincipalRecordV2 {
  dcp_version: '2.0';
  human_id: string;
  session_nonce: string;
  legal_name: string;
  entity_type: EntityType;
  jurisdiction: string;
  liability_mode: LiabilityMode;
  override_rights: boolean;
  issued_at: string;
  expires_at: string | null;
  contact: string | null;
  binding_keys: KeyEntry[];
}

export interface BlindedResponsiblePrincipalRecordV2 {
  dcp_version: '2.0';
  human_id: string;
  session_nonce: string;
  blinded: true;
  pii_hash: string;
  entity_type: EntityType;
  jurisdiction: string;
  liability_mode: LiabilityMode;
  override_rights: boolean;
  issued_at: string;
  expires_at: string | null;
  binding_keys: KeyEntry[];
}

// ── DCP-02 V2: Intent Declaration & Policy Gating ──

export interface IntentTargetV2 {
  channel: Channel;
  to?: string | null;
  domain?: string | null;
  url?: string | null;
  [key: string]: unknown;
}

export type SecurityTier = 'routine' | 'standard' | 'elevated' | 'maximum';

export interface IntentV2 {
  dcp_version: '2.0';
  intent_id: string;
  session_nonce: string;
  agent_id: string;
  human_id: string;
  timestamp: string;
  action_type: ActionType;
  target: IntentTargetV2;
  data_classes: DataClass[];
  estimated_impact: Impact;
  requires_consent: boolean;
  security_tier?: SecurityTier;
}

export interface PolicyDecisionV2 {
  dcp_version: '2.0';
  intent_id: string;
  session_nonce: string;
  decision: PolicyDecisionType;
  risk_score: number;
  reasons: string[];
  required_confirmation: { type: 'human_approve'; fields?: string[] } | null;
  applied_policy_hash: string;
  timestamp: string;
  resolved_tier?: SecurityTier;
}

// ── DCP-03 V2: Audit Chain & Transparency ──

export interface AuditEvidenceV2 {
  tool?: string | null;
  result_ref?: string | null;
  evidence_hash?: string | null;
  [key: string]: unknown;
}

export interface AuditEventV2 {
  dcp_version: '2.0';
  audit_id: string;
  session_nonce: string;
  prev_hash: string;
  prev_hash_secondary?: string;
  hash_alg: 'sha256' | 'sha256+sha3-256';
  timestamp: string;
  agent_id: string;
  human_id: string;
  intent_id: string;
  intent_hash: string;
  intent_hash_secondary?: string;
  policy_decision: AuditPolicyDecision;
  outcome: string;
  evidence: AuditEvidenceV2;
  pq_checkpoint_ref: string | null;
}

export interface PQCheckpoint {
  checkpoint_id: string;
  session_nonce: string;
  event_range: {
    from_audit_id: string;
    to_audit_id: string;
    count: number;
  };
  merkle_root: string;
  composite_sig: CompositeSignature;
}

// ── Bundle V2 ──

export interface BundleManifest {
  session_nonce: string;
  rpr_hash: string;
  passport_hash: string;
  intent_hash: string;
  policy_hash: string;
  audit_merkle_root: string;
  audit_merkle_root_secondary?: string;
  audit_count: number;
  pq_checkpoints?: string[];
  session_expires_at?: string;
  intended_verifier?: string;
}

export interface BundleSignerV2 {
  type: SignerType;
  id: string;
  kids: string[];
}

export interface BundleSignatureV2 {
  hash_alg: 'sha256' | 'sha256+sha3-256';
  created_at: string;
  signer: BundleSignerV2;
  manifest_hash: string;
  composite_sig: CompositeSignature;
}

export interface CitizenshipBundleV2 {
  dcp_bundle_version: '2.0';
  manifest: BundleManifest;
  responsible_principal_record: SignedPayload<ResponsiblePrincipalRecordV2 | BlindedResponsiblePrincipalRecordV2>;
  agent_passport: SignedPayload<AgentPassportV2>;
  intent: SignedPayload<IntentV2>;
  policy_decision: SignedPayload<PolicyDecisionV2>;
  audit_entries: AuditEventV2[];
  pq_checkpoints?: PQCheckpoint[];
}

export interface SignedBundleV2 {
  bundle: CitizenshipBundleV2;
  signature: BundleSignatureV2;
}

// ── Verifier Policy (verifier-authoritative, not in signed artifacts) ──

export interface VerifierPolicy {
  default_mode: VerificationMode;
  risk_overrides: Record<RiskTier, VerificationMode>;
  min_classical: number;
  min_pq: number;
  accepted_classical_algs: string[];
  accepted_pq_algs: string[];
  accepted_hash_algs: string[];
  require_session_binding: boolean;
  require_composite_binding: boolean;
  max_key_age_days: number;
  allow_v1_bundles: boolean;
  /** Phase 3: when true, classical signatures are not required even in hybrid mode */
  allow_classical_fallback_disable?: boolean;
  /** Phase 3: emit deprecation warnings for classical-only bundles */
  warn_classical_only_deprecated?: boolean;
  /** Phase 3: rejected algorithms from advisory auto-response */
  advisory_rejected_algs?: string[];
  /** Require bundles to include session_expires_at */
  require_session_expiry?: boolean;
  /** Max allowed session duration in seconds (0 = no limit) */
  max_session_duration_seconds?: number;
  /** Require bundles to include intended_verifier matching this verifier's ID */
  require_audience_binding?: boolean;
  /** This verifier's identity for audience binding checks */
  verifier_id?: string;
}

// ── Governance Key Ceremony ──

export interface GovernanceKeySet {
  governance_id: string;
  keys: KeyEntry[];
  threshold: number;
  created_at: string;
  description: string;
}

export interface GovernanceSignedAdvisory {
  advisory: AlgorithmAdvisory;
  governance_signatures: Array<{
    party_id: string;
    kid: string;
    composite_sig: CompositeSignature;
  }>;
  threshold_met: boolean;
}

// ── Revocation V2 ──

export interface RevocationRecordV2 {
  dcp_version: '2.0';
  agent_id: string;
  human_id: string;
  revoked_kid: string;
  timestamp: string;
  reason: 'key_compromise' | 'key_rotation' | 'administrative' | 'key_compromise_emergency';
  composite_sig: CompositeSignature;
}

// ── Emergency Revocation (Gap #13) ──

export interface EmergencyRevocation {
  type: 'emergency_revocation';
  agent_id: string;
  human_id: string;
  revocation_secret: string;
  timestamp: string;
  reason: 'key_compromise_emergency';
}

// ── Jurisdiction Attestation V2 (Gap #3) ──

export interface JurisdictionAttestationV2 {
  type: 'jurisdiction_attestation';
  dcp_version: '2.0';
  issuer: string;
  jurisdiction: string;
  rpr_hash: string;
  agent_id: string;
  attested_at: string;
  expires_at: string;
  composite_sig: CompositeSignature;
}

// ── Human Confirmation V2 (Gap #3) ──

export interface HumanConfirmationV2 {
  dcp_version: '2.0';
  intent_id: string;
  session_nonce: string;
  human_id: string;
  timestamp: string;
  decision: ConfirmationDecision;
  composite_sig: CompositeSignature;
}

// ── Key Recovery — M-of-N Social Recovery (Gap #1) ──

export interface RecoveryShareHolder {
  holder_id: string;
  share_index: number;
  holder_kid: string;
}

export interface RecoveryConfig {
  type: 'recovery_config';
  human_id: string;
  threshold: number;
  total_shares: number;
  share_holders: RecoveryShareHolder[];
  created_at: string;
  composite_sig: CompositeSignature;
}

// ── Audit Trail Compaction ──

export interface AuditCompaction {
  type: 'audit_compaction';
  session_nonce: string;
  range: {
    from: string;
    to: string;
    count: number;
  };
  merkle_root: string;
  prev_hash: string;
  timestamp: string;
  composite_sig: CompositeSignature;
}

// ── Multi-Party Authorization (Gap #5) ──

export type MultiPartyOperation =
  | 'revoke_agent'
  | 'rotate_org_key'
  | 'change_jurisdiction'
  | 'modify_recovery_config';

export type AuthorizationRole = 'owner' | 'org_admin' | 'recovery_contact';

export interface PartyAuthorization {
  party_id: string;
  role: AuthorizationRole;
  composite_sig: CompositeSignature;
}

export interface MultiPartyAuthorization {
  type: 'multi_party_authorization';
  operation: MultiPartyOperation;
  operation_payload: Record<string, unknown>;
  required_parties: number;
  authorizations: PartyAuthorization[];
}

// ── Algorithm Deprecation Advisory (Gap #4) ──

export type AdvisorySeverity = 'critical' | 'high' | 'medium' | 'low';
export type AdvisoryAction = 'deprecate' | 'warn' | 'revoke';

export interface AlgorithmAdvisory {
  type: 'algorithm_advisory';
  advisory_id: string;
  severity: AdvisorySeverity;
  affected_algorithms: string[];
  action: AdvisoryAction;
  replacement_algorithms: string[];
  effective_date: string;
  grace_period_days: number;
  description: string;
  issued_at: string;
  issuer: string;
  composite_sig: CompositeSignature;
}

// ── Capability Discovery ──

export interface DcpCapabilities {
  supported_versions: string[];
  supported_algs: {
    signing: string[];
    kem: string[];
    hash: string[];
  };
  supported_wire_formats: string[];
  features: {
    composite_signatures: boolean;
    session_binding: boolean;
    blinded_rpr: boolean;
    dual_hash_chains: boolean;
    pq_checkpoints: boolean;
    emergency_revocation: boolean;
    multi_party_auth: boolean;
  };
  verifier_policy_hash: string;
  min_accepted_version: string;
}
