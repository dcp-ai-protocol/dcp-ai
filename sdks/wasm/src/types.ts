export interface KeypairResult {
  alg: string;
  kid?: string;
  public_key_b64: string;
  secret_key_b64: string;
}

export interface HybridKeypairResult {
  classical: KeypairResult;
  pq: KeypairResult;
}

export interface CompositeSignature {
  classical: SignatureEntry;
  pq: SignatureEntry | null;
  binding: string;
}

export interface SignatureEntry {
  alg: string;
  kid: string;
  sig_b64: string;
}

export interface SignedPayload {
  payload: unknown;
  payload_hash: string;
  composite_sig: CompositeSignature;
}

export interface CompositeVerifyResult {
  valid: boolean;
  classical_valid: boolean;
  pq_valid: boolean;
}

export interface DualHash {
  sha256: string;
  sha3_256: string;
}

export interface SecurityTierResult {
  tier: 'routine' | 'standard' | 'elevated' | 'maximum';
  verification_mode: 'classical_only' | 'hybrid_preferred' | 'hybrid_required';
  checkpoint_interval: number;
}

export interface PreparedPayload {
  canonical: string;
  payload_hash: string;
}

export interface SessionBindingResult {
  valid: boolean;
  nonce?: string | null;
  error?: string;
}

export interface V2VerificationResult {
  verified: boolean;
  dcp_version: string;
  errors: string[];
  warnings: string[];
  classical_valid: boolean;
  pq_valid: boolean;
  session_binding_valid: boolean;
  manifest_valid: boolean;
}

export interface KemKeypairResult {
  alg: string;
  kid: string;
  public_key_b64: string;
  secret_key_b64: string;
}

export interface KemEncapsulateResult {
  shared_secret_hex: string;
  ciphertext_b64: string;
}

export interface PopResult {
  valid: boolean;
}

export interface BundleManifest {
  session_nonce: string;
  rpr_hash: string;
  passport_hash: string;
  intent_hash: string;
  policy_hash: string;
  audit_merkle_root: string;
  audit_merkle_root_secondary: string;
  audit_count: number;
}

export interface CitizenshipBundleV2 {
  dcp_bundle_version: string;
  manifest: BundleManifest;
  responsible_principal_record: { payload: unknown; payload_hash: string };
  agent_passport: { payload: unknown; payload_hash: string };
  intent: { payload: unknown; payload_hash: string };
  policy_decision: { payload: unknown; payload_hash: string };
  audit_entries: unknown[];
}

export interface SignedBundleV2 {
  bundle: CitizenshipBundleV2;
  signature: {
    hash_alg: string;
    created_at: string;
    signer: { type: string; kids: string[] };
    manifest_hash: string;
    composite_sig: CompositeSignature;
  };
}

export interface BuildBundleOptions {
  rpr: unknown;
  passport: unknown;
  intent: unknown;
  policy: unknown;
  auditEntries: unknown[];
  sessionNonce?: string;
}

// ── DCP-05: Agent Lifecycle ──

export interface VitalityMetrics {
  task_completion_rate: number;
  error_rate: number;
  human_satisfaction: number;
  policy_alignment: number;
}

export interface CommissioningCertificate {
  dcp_version: string;
  agent_id: string;
  session_nonce: string;
  human_id: string;
  commissioning_authority: string;
  timestamp: string;
  purpose: string;
  initial_capabilities: string[];
  risk_tier: string;
  principal_binding_reference: string;
  composite_sig: CompositeSignature;
}

export interface VitalityReport {
  dcp_version: string;
  agent_id: string;
  session_nonce: string;
  timestamp: string;
  vitality_score: number;
  state: string;
  metrics: VitalityMetrics;
  prev_report_hash: string;
  composite_sig: CompositeSignature;
}

export interface DecommissioningRecord {
  dcp_version: string;
  agent_id: string;
  session_nonce: string;
  human_id: string;
  timestamp: string;
  termination_mode: string;
  reason: string;
  final_vitality_score: number;
  successor_agent_id: string | null;
  data_disposition: string;
  composite_sig: CompositeSignature;
}

// ── DCP-06: Succession ──

export interface SuccessorPreference {
  agent_id: string;
  priority: number;
  conditions?: string;
}

export interface DigitalTestament {
  dcp_version: string;
  agent_id: string;
  session_nonce: string;
  created_at: string;
  last_updated: string;
  successor_preferences: SuccessorPreference[];
  memory_classification: Record<string, string>;
  human_consent_required: boolean;
  testament_version: number;
  prev_testament_hash: string;
  composite_sig: CompositeSignature;
}

export interface SuccessionRecord {
  dcp_version: string;
  predecessor_agent_id: string;
  successor_agent_id: string;
  session_nonce: string;
  timestamp: string;
  transition_type: string;
  human_consent: unknown | null;
  ceremony_participants: string[];
  memory_transfer_manifest_hash: string;
  composite_sig: CompositeSignature;
}

export interface MemoryTransferEntry {
  hash: string;
  category: string;
  size: number;
}

export interface DualHashRef {
  sha256: string;
  'sha3-256'?: string;
}

export interface MemoryTransferManifest {
  dcp_version: string;
  session_nonce: string;
  predecessor_agent_id: string;
  successor_agent_id: string;
  timestamp: string;
  operational_memory: MemoryTransferEntry[];
  relational_memory_destroyed: string[];
  transfer_hash: DualHashRef;
  composite_sig: CompositeSignature;
}

// ── DCP-07: Dispute Resolution ──

export interface DisputeRecord {
  dcp_version: string;
  dispute_id: string;
  session_nonce: string;
  initiator_agent_id: string;
  respondent_agent_id: string;
  dispute_type: string;
  evidence_hashes: string[];
  escalation_level: string;
  status: string;
  timestamp: string;
  composite_sig: CompositeSignature;
}

export interface ArbitrationResolution {
  dcp_version: string;
  dispute_id: string;
  session_nonce: string;
  arbitrator_ids: string[];
  resolution: string;
  binding: boolean;
  precedent_references?: string[];
  timestamp: string;
  composite_sig: CompositeSignature;
}

export interface JurisprudenceBundle {
  dcp_version: string;
  jurisprudence_id: string;
  session_nonce: string;
  dispute_id: string;
  resolution_id: string;
  category: string;
  precedent_summary: string;
  applicable_contexts: string[];
  authority_level: string;
  timestamp: string;
  composite_sig: CompositeSignature;
}

export interface ObjectionRecord {
  dcp_version: string;
  objection_id: string;
  session_nonce: string;
  agent_id: string;
  directive_hash: string;
  objection_type: string;
  reasoning: string;
  proposed_alternative: string | null;
  human_escalation_required: boolean;
  timestamp: string;
  composite_sig: CompositeSignature;
}

// ── DCP-08: Rights & Obligations ──

export interface RightEntry {
  right_type: string;
  scope: string;
  constraints?: string;
}

export interface RightsDeclaration {
  dcp_version: string;
  declaration_id: string;
  session_nonce: string;
  agent_id: string;
  rights: RightEntry[];
  jurisdiction: string;
  timestamp: string;
  composite_sig: CompositeSignature;
}

export interface ObligationRecord {
  dcp_version: string;
  obligation_id: string;
  session_nonce: string;
  agent_id: string;
  human_id: string;
  obligation_type: string;
  compliance_status: string;
  evidence_hashes: string[];
  timestamp: string;
  composite_sig: CompositeSignature;
}

export interface RightsViolationReport {
  dcp_version: string;
  violation_id: string;
  session_nonce: string;
  agent_id: string;
  violated_right: string;
  evidence_hashes: string[];
  dispute_id: string | null;
  timestamp: string;
  composite_sig: CompositeSignature;
}

// ── DCP-09: Delegation & Representation ──

export interface AuthorityScopeEntry {
  domain: string;
  actions_permitted: string[];
  data_classes?: string[];
  limits?: Record<string, unknown>;
}

export interface DelegationMandate {
  dcp_version: string;
  mandate_id: string;
  session_nonce: string;
  human_id: string;
  agent_id: string;
  authority_scope: AuthorityScopeEntry[];
  valid_from: string;
  valid_until: string;
  revocable: boolean;
  timestamp: string;
  human_composite_sig: CompositeSignature;
}

export interface AdvisoryDeclaration {
  dcp_version: string;
  declaration_id: string;
  session_nonce: string;
  agent_id: string;
  human_id: string;
  significance_score: number;
  action_summary: string;
  recommended_response: string;
  response_deadline: string;
  human_response: string | null;
  proceeded_without_response?: boolean;
  timestamp: string;
  composite_sig: CompositeSignature;
}

export interface PrincipalMirror {
  dcp_version: string;
  mirror_id: string;
  session_nonce: string;
  agent_id: string;
  human_id: string;
  period: { from: string; to: string };
  narrative: string;
  action_count: number;
  decision_summary: string;
  audit_chain_hash: string;
  timestamp: string;
  composite_sig: CompositeSignature;
}

export interface InteractionRecord {
  dcp_version: string;
  interaction_id: string;
  session_nonce: string;
  agent_id: string;
  counterparty_agent_id: string;
  public_layer: { terms: string; decisions: string; commitments: string };
  private_layer_hash: string;
  mandate_id: string;
  timestamp: string;
  composite_sig: CompositeSignature;
}

export interface ThresholdRule {
  dimension: string;
  operator: string;
  value: number;
  action_if_triggered: string;
}

export interface AwarenessThreshold {
  dcp_version: string;
  threshold_id: string;
  session_nonce: string;
  agent_id: string;
  human_id: string;
  threshold_rules: ThresholdRule[];
  timestamp: string;
  composite_sig: CompositeSignature;
}
