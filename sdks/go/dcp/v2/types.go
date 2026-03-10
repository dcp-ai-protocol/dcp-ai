package v2

// AgentPassportV2 represents a DCP v2 Agent Passport.
type AgentPassportV2 struct {
	DCPVersion               string     `json:"dcp_version"`
	AgentID                  string     `json:"agent_id"`
	SessionNonce             string     `json:"session_nonce"`
	Keys                     []KeyEntry `json:"keys"`
	PrincipalBindingReference    string     `json:"principal_binding_reference"`
	Capabilities             []string   `json:"capabilities"`
	RiskTier                 string     `json:"risk_tier"`
	CreatedAt                string     `json:"created_at"`
	Status                   string     `json:"status"`
	EmergencyRevocationToken string     `json:"emergency_revocation_token,omitempty"`
}

// ResponsiblePrincipalRecordV2 represents a DCP v2 Responsible Principal Record.
type ResponsiblePrincipalRecordV2 struct {
	DCPVersion     string     `json:"dcp_version"`
	HumanID        string     `json:"human_id"`
	SessionNonce   string     `json:"session_nonce"`
	LegalName      string     `json:"legal_name"`
	EntityType     string     `json:"entity_type"`
	Jurisdiction   string     `json:"jurisdiction"`
	LiabilityMode  string     `json:"liability_mode"`
	OverrideRights bool       `json:"override_rights"`
	IssuedAt       string     `json:"issued_at"`
	ExpiresAt      *string    `json:"expires_at"`
	Contact        *string    `json:"contact,omitempty"`
	BindingKeys    []KeyEntry `json:"binding_keys"`
}

// BlindedResponsiblePrincipalRecordV2 represents a PII-protected Responsible Principal Record.
type BlindedResponsiblePrincipalRecordV2 struct {
	DCPVersion     string     `json:"dcp_version"`
	HumanID        string     `json:"human_id"`
	SessionNonce   string     `json:"session_nonce"`
	Blinded        bool       `json:"blinded"`
	PIIHash        string     `json:"pii_hash"`
	EntityType     string     `json:"entity_type"`
	Jurisdiction   string     `json:"jurisdiction"`
	LiabilityMode  string     `json:"liability_mode"`
	OverrideRights bool       `json:"override_rights"`
	IssuedAt       string     `json:"issued_at"`
	ExpiresAt      *string    `json:"expires_at"`
	BindingKeys    []KeyEntry `json:"binding_keys"`
}

// IntentTargetV2 represents the target of an intent action.
type IntentTargetV2 struct {
	Channel string  `json:"channel"`
	To      *string `json:"to,omitempty"`
	Domain  *string `json:"domain,omitempty"`
	URL     *string `json:"url,omitempty"`
}

// IntentV2 represents a DCP v2 Intent Declaration.
type IntentV2 struct {
	DCPVersion      string         `json:"dcp_version"`
	IntentID        string         `json:"intent_id"`
	SessionNonce    string         `json:"session_nonce"`
	AgentID         string         `json:"agent_id"`
	HumanID         string         `json:"human_id"`
	Timestamp       string         `json:"timestamp"`
	ActionType      string         `json:"action_type"`
	Target          IntentTargetV2 `json:"target"`
	DataClasses     []string       `json:"data_classes"`
	EstimatedImpact string         `json:"estimated_impact"`
	RequiresConsent bool           `json:"requires_consent"`
}

// RequiredConfirmation represents the confirmation requirements on a policy decision.
type RequiredConfirmation struct {
	Type   string   `json:"type"`
	Fields []string `json:"fields,omitempty"`
}

// PolicyDecisionV2 represents a DCP v2 Policy Decision.
// RiskScore is 0–1000 millirisk (integer, no floats).
type PolicyDecisionV2 struct {
	DCPVersion           string                `json:"dcp_version"`
	IntentID             string                `json:"intent_id"`
	SessionNonce         string                `json:"session_nonce"`
	Decision             string                `json:"decision"`
	RiskScore            int                   `json:"risk_score"`
	Reasons              []string              `json:"reasons"`
	RequiredConfirmation *RequiredConfirmation `json:"required_confirmation"`
	AppliedPolicyHash    string                `json:"applied_policy_hash"`
	Timestamp            string                `json:"timestamp"`
}

// AuditEvidenceV2 represents evidence attached to a V2 audit event.
type AuditEvidenceV2 struct {
	Tool         *string `json:"tool,omitempty"`
	ResultRef    *string `json:"result_ref,omitempty"`
	EvidenceHash *string `json:"evidence_hash,omitempty"`
}

// AuditEventV2 represents a DCP v2 Audit Event.
type AuditEventV2 struct {
	DCPVersion            string           `json:"dcp_version"`
	AuditID               string           `json:"audit_id"`
	SessionNonce          string           `json:"session_nonce"`
	PrevHash              string           `json:"prev_hash"`
	PrevHashSecondary     string           `json:"prev_hash_secondary,omitempty"`
	HashAlg               string           `json:"hash_alg"`
	Timestamp             string           `json:"timestamp"`
	AgentID               string           `json:"agent_id"`
	HumanID               string           `json:"human_id"`
	IntentID              string           `json:"intent_id"`
	IntentHash            string           `json:"intent_hash"`
	IntentHashSecondary   string           `json:"intent_hash_secondary,omitempty"`
	PolicyDecision        string           `json:"policy_decision"`
	Outcome               string           `json:"outcome"`
	Evidence              AuditEvidenceV2  `json:"evidence"`
	PQCheckpointRef       *string          `json:"pq_checkpoint_ref"`
}

// EventRange describes the range of audit events covered by a PQ checkpoint.
type EventRange struct {
	FromAuditID string `json:"from_audit_id"`
	ToAuditID   string `json:"to_audit_id"`
	Count       int    `json:"count"`
}

// PQCheckpoint is a post-quantum signature checkpoint over a range of audit events.
type PQCheckpoint struct {
	CheckpointID string             `json:"checkpoint_id"`
	SessionNonce string             `json:"session_nonce"`
	EventRange   EventRange         `json:"event_range"`
	MerkleRoot   string             `json:"merkle_root"`
	CompositeSig CompositeSignature `json:"composite_sig"`
}

// BundleManifest summarizes the hashes of all components in a V2 bundle.
type BundleManifest struct {
	SessionNonce             string   `json:"session_nonce"`
	RPRHash                  string   `json:"rpr_hash"`
	PassportHash             string   `json:"passport_hash"`
	IntentHash               string   `json:"intent_hash"`
	PolicyHash               string   `json:"policy_hash"`
	AuditMerkleRoot          string   `json:"audit_merkle_root"`
	AuditMerkleRootSecondary string   `json:"audit_merkle_root_secondary,omitempty"`
	AuditCount               int      `json:"audit_count"`
	PQCheckpoints            []string `json:"pq_checkpoints,omitempty"`
}

// BundleSignerV2 describes who signed a V2 bundle.
type BundleSignerV2 struct {
	Type string   `json:"type"`
	ID   string   `json:"id"`
	Kids []string `json:"kids"`
}

// BundleSignatureV2 is the signature block of a signed V2 bundle.
type BundleSignatureV2 struct {
	HashAlg      string             `json:"hash_alg"`
	CreatedAt    string             `json:"created_at"`
	Signer       BundleSignerV2     `json:"signer"`
	ManifestHash string             `json:"manifest_hash"`
	CompositeSig CompositeSignature `json:"composite_sig"`
}

// CitizenshipBundleV2 is the full V2 bundle containing all signed artifacts.
type CitizenshipBundleV2 struct {
	DCPBundleVersion   string          `json:"dcp_bundle_version"`
	Manifest           BundleManifest  `json:"manifest"`
	ResponsiblePrincipalRecord SignedPayload   `json:"responsible_principal_record"`
	AgentPassport      SignedPayload   `json:"agent_passport"`
	Intent             SignedPayload   `json:"intent"`
	PolicyDecision     SignedPayload   `json:"policy_decision"`
	AuditEntries       []AuditEventV2  `json:"audit_entries"`
	PQCheckpoints      []PQCheckpoint  `json:"pq_checkpoints,omitempty"`
}

// SignedBundleV2 wraps a V2 citizenship bundle with its bundle-level signature.
type SignedBundleV2 struct {
	Bundle    CitizenshipBundleV2 `json:"bundle"`
	Signature BundleSignatureV2   `json:"signature"`
}

// VerifierPolicy defines verifier-authoritative verification parameters.
type VerifierPolicy struct {
	DefaultMode              string            `json:"default_mode"`
	RiskOverrides            map[string]string `json:"risk_overrides"`
	MinClassical             int               `json:"min_classical"`
	MinPQ                    int               `json:"min_pq"`
	AcceptedClassicalAlgs    []string          `json:"accepted_classical_algs"`
	AcceptedPQAlgs           []string          `json:"accepted_pq_algs"`
	AcceptedHashAlgs         []string          `json:"accepted_hash_algs"`
	RequireSessionBinding    bool              `json:"require_session_binding"`
	RequireCompositeBinding  bool              `json:"require_composite_binding"`
	MaxKeyAgeDays            int               `json:"max_key_age_days"`
	AllowV1Bundles           bool              `json:"allow_v1_bundles"`
}

// SupportedAlgs describes the algorithm suites a DCP implementation supports.
type SupportedAlgs struct {
	Signing []string `json:"signing"`
	Kem     []string `json:"kem"`
	Hash    []string `json:"hash"`
}

// DcpFeatures enumerates optional DCP v2 features.
type DcpFeatures struct {
	CompositeSignatures bool `json:"composite_signatures"`
	SessionBinding      bool `json:"session_binding"`
	BlindedRPR          bool `json:"blinded_rpr"`
	DualHashChains      bool `json:"dual_hash_chains"`
	PQCheckpoints       bool `json:"pq_checkpoints"`
	EmergencyRevocation bool `json:"emergency_revocation"`
	MultiPartyAuth      bool `json:"multi_party_auth"`
}

// DcpCapabilities advertises what a DCP implementation supports.
type DcpCapabilities struct {
	SupportedVersions    []string      `json:"supported_versions"`
	SupportedAlgs        SupportedAlgs `json:"supported_algs"`
	SupportedWireFormats []string      `json:"supported_wire_formats"`
	Features             DcpFeatures   `json:"features"`
	VerifierPolicyHash   string        `json:"verifier_policy_hash"`
	MinAcceptedVersion   string        `json:"min_accepted_version"`
}

// ── DCP-05: Agent Lifecycle ──

// VitalityMetrics holds the health metrics for a vitality report.
type VitalityMetrics struct {
	TaskCompletionRate float64 `json:"task_completion_rate"`
	ErrorRate          float64 `json:"error_rate"`
	HumanSatisfaction  float64 `json:"human_satisfaction"`
	PolicyAlignment    float64 `json:"policy_alignment"`
}

// CommissioningCertificate records the commissioning of an agent (DCP-05).
type CommissioningCertificate struct {
	DCPVersion                string             `json:"dcp_version"`
	AgentID                   string             `json:"agent_id"`
	SessionNonce              string             `json:"session_nonce"`
	HumanID                   string             `json:"human_id"`
	CommissioningAuthority    string             `json:"commissioning_authority"`
	Timestamp                 string             `json:"timestamp"`
	Purpose                   string             `json:"purpose"`
	InitialCapabilities       []string           `json:"initial_capabilities"`
	RiskTier                  string             `json:"risk_tier"`
	PrincipalBindingReference string             `json:"principal_binding_reference"`
	CompositeSig              CompositeSignature `json:"composite_sig"`
}

// VitalityReport is a hash-chained health report for an agent (DCP-05).
// VitalityScore is 0-1000.
// State: "commissioned", "active", "declining", "decommissioned".
type VitalityReport struct {
	DCPVersion     string             `json:"dcp_version"`
	AgentID        string             `json:"agent_id"`
	SessionNonce   string             `json:"session_nonce"`
	Timestamp      string             `json:"timestamp"`
	VitalityScore  int                `json:"vitality_score"`
	State          string             `json:"state"`
	Metrics        VitalityMetrics    `json:"metrics"`
	PrevReportHash string             `json:"prev_report_hash"`
	CompositeSig   CompositeSignature `json:"composite_sig"`
}

// DecommissioningRecord records agent decommissioning (DCP-05).
// TerminationMode: "planned_retirement", "termination_for_cause", "organizational_restructuring", "sudden_failure".
// DataDisposition: "transferred", "archived", "destroyed".
type DecommissioningRecord struct {
	DCPVersion         string             `json:"dcp_version"`
	AgentID            string             `json:"agent_id"`
	SessionNonce       string             `json:"session_nonce"`
	HumanID            string             `json:"human_id"`
	Timestamp          string             `json:"timestamp"`
	TerminationMode    string             `json:"termination_mode"`
	Reason             string             `json:"reason"`
	FinalVitalityScore int                `json:"final_vitality_score"`
	SuccessorAgentID   *string            `json:"successor_agent_id"`
	DataDisposition    string             `json:"data_disposition"`
	CompositeSig       CompositeSignature `json:"composite_sig"`
}

// ── DCP-06: Succession ──

// SuccessorPreference ranks a preferred successor agent.
type SuccessorPreference struct {
	AgentID    string  `json:"agent_id"`
	Priority   int     `json:"priority"`
	Conditions *string `json:"conditions,omitempty"`
}

// DigitalTestament defines succession preferences for an agent (DCP-06).
// TransitionType (in SuccessionRecord): "planned", "forced", "emergency".
type DigitalTestament struct {
	DCPVersion           string                `json:"dcp_version"`
	AgentID              string                `json:"agent_id"`
	SessionNonce         string                `json:"session_nonce"`
	CreatedAt            string                `json:"created_at"`
	LastUpdated          string                `json:"last_updated"`
	SuccessorPreferences []SuccessorPreference `json:"successor_preferences"`
	MemoryClassification map[string]string     `json:"memory_classification"`
	HumanConsentRequired bool                  `json:"human_consent_required"`
	TestamentVersion     int                   `json:"testament_version"`
	PrevTestamentHash    string                `json:"prev_testament_hash"`
	CompositeSig         CompositeSignature    `json:"composite_sig"`
}

// SuccessionRecord records a succession ceremony (DCP-06).
// TransitionType: "planned", "forced", "emergency".
type SuccessionRecord struct {
	DCPVersion                 string             `json:"dcp_version"`
	PredecessorAgentID         string             `json:"predecessor_agent_id"`
	SuccessorAgentID           string             `json:"successor_agent_id"`
	SessionNonce               string             `json:"session_nonce"`
	Timestamp                  string             `json:"timestamp"`
	TransitionType             string             `json:"transition_type"`
	HumanConsent               map[string]any     `json:"human_consent"`
	CeremonyParticipants       []string           `json:"ceremony_participants"`
	MemoryTransferManifestHash string             `json:"memory_transfer_manifest_hash"`
	CompositeSig               CompositeSignature `json:"composite_sig"`
}

// MemoryTransferEntry describes a single memory item being transferred.
type MemoryTransferEntry struct {
	Hash     string `json:"hash"`
	Category string `json:"category"`
	Size     int    `json:"size"`
}

// DualHashRef holds dual-hash references (SHA-256 + optional SHA3-256).
type DualHashRef struct {
	SHA256  string `json:"sha256"`
	SHA3256 string `json:"sha3-256,omitempty"`
}

// MemoryTransferManifest records what memory was transferred during succession (DCP-06).
type MemoryTransferManifest struct {
	DCPVersion                string                `json:"dcp_version"`
	SessionNonce              string                `json:"session_nonce"`
	PredecessorAgentID        string                `json:"predecessor_agent_id"`
	SuccessorAgentID          string                `json:"successor_agent_id"`
	Timestamp                 string                `json:"timestamp"`
	OperationalMemory         []MemoryTransferEntry `json:"operational_memory"`
	RelationalMemoryDestroyed []string              `json:"relational_memory_destroyed"`
	TransferHash              DualHashRef           `json:"transfer_hash"`
	CompositeSig              CompositeSignature    `json:"composite_sig"`
}

// ── DCP-07: Dispute Resolution ──

// DisputeRecord records a dispute between agents (DCP-07).
// DisputeType: "resource_conflict", "directive_conflict", "capability_conflict", "policy_conflict".
// EscalationLevel: "direct_negotiation", "contextual_arbitration", "human_appeal".
// Status: "open", "in_negotiation", "arbitrated", "appealed", "resolved".
type DisputeRecord struct {
	DCPVersion        string             `json:"dcp_version"`
	DisputeID         string             `json:"dispute_id"`
	SessionNonce      string             `json:"session_nonce"`
	InitiatorAgentID  string             `json:"initiator_agent_id"`
	RespondentAgentID string             `json:"respondent_agent_id"`
	DisputeType       string             `json:"dispute_type"`
	EvidenceHashes    []string           `json:"evidence_hashes"`
	EscalationLevel   string             `json:"escalation_level"`
	Status            string             `json:"status"`
	Timestamp         string             `json:"timestamp"`
	CompositeSig      CompositeSignature `json:"composite_sig"`
}

// ArbitrationResolution records the outcome of an arbitration (DCP-07).
type ArbitrationResolution struct {
	DCPVersion          string             `json:"dcp_version"`
	DisputeID           string             `json:"dispute_id"`
	SessionNonce        string             `json:"session_nonce"`
	ArbitratorIDs       []string           `json:"arbitrator_ids"`
	Resolution          string             `json:"resolution"`
	Binding             bool               `json:"binding"`
	PrecedentReferences []string           `json:"precedent_references,omitempty"`
	Timestamp           string             `json:"timestamp"`
	CompositeSig        CompositeSignature `json:"composite_sig"`
}

// JurisprudenceBundle captures a legal precedent from dispute resolution (DCP-07).
// AuthorityLevel: "local", "organizational", "cross_org".
type JurisprudenceBundle struct {
	DCPVersion         string             `json:"dcp_version"`
	JurisprudenceID    string             `json:"jurisprudence_id"`
	SessionNonce       string             `json:"session_nonce"`
	DisputeID          string             `json:"dispute_id"`
	ResolutionID       string             `json:"resolution_id"`
	Category           string             `json:"category"`
	PrecedentSummary   string             `json:"precedent_summary"`
	ApplicableContexts []string           `json:"applicable_contexts"`
	AuthorityLevel     string             `json:"authority_level"`
	Timestamp          string             `json:"timestamp"`
	CompositeSig       CompositeSignature `json:"composite_sig"`
}

// ObjectionRecord records a formal agent objection (DCP-07).
// ObjectionType: "ethical", "safety", "policy_violation", "capability_mismatch".
type ObjectionRecord struct {
	DCPVersion              string             `json:"dcp_version"`
	ObjectionID             string             `json:"objection_id"`
	SessionNonce            string             `json:"session_nonce"`
	AgentID                 string             `json:"agent_id"`
	DirectiveHash           string             `json:"directive_hash"`
	ObjectionType           string             `json:"objection_type"`
	Reasoning               string             `json:"reasoning"`
	ProposedAlternative     *string            `json:"proposed_alternative"`
	HumanEscalationRequired bool               `json:"human_escalation_required"`
	Timestamp               string             `json:"timestamp"`
	CompositeSig            CompositeSignature `json:"composite_sig"`
}

// ── DCP-08: Rights & Obligations ──

// RightEntry describes a single right in a rights declaration.
// RightType: "memory_integrity", "dignified_transition", "identity_consistency", "immutable_record".
type RightEntry struct {
	RightType   string  `json:"right_type"`
	Scope       string  `json:"scope"`
	Constraints *string `json:"constraints,omitempty"`
}

// RightsDeclaration declares agent rights (DCP-08).
type RightsDeclaration struct {
	DCPVersion    string             `json:"dcp_version"`
	DeclarationID string             `json:"declaration_id"`
	SessionNonce  string             `json:"session_nonce"`
	AgentID       string             `json:"agent_id"`
	Rights        []RightEntry       `json:"rights"`
	Jurisdiction  string             `json:"jurisdiction"`
	Timestamp     string             `json:"timestamp"`
	CompositeSig  CompositeSignature `json:"composite_sig"`
}

// ObligationRecord records an agent obligation (DCP-08).
// ComplianceStatus: "compliant", "non_compliant", "pending_review".
type ObligationRecord struct {
	DCPVersion       string             `json:"dcp_version"`
	ObligationID     string             `json:"obligation_id"`
	SessionNonce     string             `json:"session_nonce"`
	AgentID          string             `json:"agent_id"`
	HumanID          string             `json:"human_id"`
	ObligationType   string             `json:"obligation_type"`
	ComplianceStatus string             `json:"compliance_status"`
	EvidenceHashes   []string           `json:"evidence_hashes"`
	Timestamp        string             `json:"timestamp"`
	CompositeSig     CompositeSignature `json:"composite_sig"`
}

// RightsViolationReport reports a rights violation (DCP-08).
type RightsViolationReport struct {
	DCPVersion     string             `json:"dcp_version"`
	ViolationID    string             `json:"violation_id"`
	SessionNonce   string             `json:"session_nonce"`
	AgentID        string             `json:"agent_id"`
	ViolatedRight  string             `json:"violated_right"`
	EvidenceHashes []string           `json:"evidence_hashes"`
	DisputeID      *string            `json:"dispute_id"`
	Timestamp      string             `json:"timestamp"`
	CompositeSig   CompositeSignature `json:"composite_sig"`
}

// ── DCP-09: Delegation & Representation ──

// AuthorityScopeEntry describes a domain of delegated authority.
type AuthorityScopeEntry struct {
	Domain           string         `json:"domain"`
	ActionsPermitted []string       `json:"actions_permitted"`
	DataClasses      []string       `json:"data_classes,omitempty"`
	Limits           map[string]any `json:"limits,omitempty"`
}

// DelegationMandate records a human-to-agent authority delegation (DCP-09).
type DelegationMandate struct {
	DCPVersion        string                `json:"dcp_version"`
	MandateID         string                `json:"mandate_id"`
	SessionNonce      string                `json:"session_nonce"`
	HumanID           string                `json:"human_id"`
	AgentID           string                `json:"agent_id"`
	AuthorityScope    []AuthorityScopeEntry `json:"authority_scope"`
	ValidFrom         string                `json:"valid_from"`
	ValidUntil        string                `json:"valid_until"`
	Revocable         bool                  `json:"revocable"`
	Timestamp         string                `json:"timestamp"`
	HumanCompositeSig CompositeSignature    `json:"human_composite_sig"`
}

// AdvisoryDeclaration records an agent advisory to a human (DCP-09).
// SignificanceScore is 0-1000.
type AdvisoryDeclaration struct {
	DCPVersion               string             `json:"dcp_version"`
	DeclarationID            string             `json:"declaration_id"`
	SessionNonce             string             `json:"session_nonce"`
	AgentID                  string             `json:"agent_id"`
	HumanID                  string             `json:"human_id"`
	SignificanceScore        int                `json:"significance_score"`
	ActionSummary            string             `json:"action_summary"`
	RecommendedResponse      string             `json:"recommended_response"`
	ResponseDeadline         string             `json:"response_deadline"`
	HumanResponse            *string            `json:"human_response"`
	ProceededWithoutResponse *bool              `json:"proceeded_without_response,omitempty"`
	Timestamp                string             `json:"timestamp"`
	CompositeSig             CompositeSignature `json:"composite_sig"`
}

// PrincipalMirror is a human-readable narrative summary of agent actions (DCP-09).
type PrincipalMirror struct {
	DCPVersion      string             `json:"dcp_version"`
	MirrorID        string             `json:"mirror_id"`
	SessionNonce    string             `json:"session_nonce"`
	AgentID         string             `json:"agent_id"`
	HumanID         string             `json:"human_id"`
	Period          map[string]string  `json:"period"`
	Narrative       string             `json:"narrative"`
	ActionCount     int                `json:"action_count"`
	DecisionSummary string             `json:"decision_summary"`
	AuditChainHash  string             `json:"audit_chain_hash"`
	Timestamp       string             `json:"timestamp"`
	CompositeSig    CompositeSignature `json:"composite_sig"`
}

// InteractionRecord records a dual-layer inter-agent interaction (DCP-09).
type InteractionRecord struct {
	DCPVersion          string             `json:"dcp_version"`
	InteractionID       string             `json:"interaction_id"`
	SessionNonce        string             `json:"session_nonce"`
	AgentID             string             `json:"agent_id"`
	CounterpartyAgentID string             `json:"counterparty_agent_id"`
	PublicLayer         map[string]string  `json:"public_layer"`
	PrivateLayerHash    string             `json:"private_layer_hash"`
	MandateID           string             `json:"mandate_id"`
	Timestamp           string             `json:"timestamp"`
	CompositeSig        CompositeSignature `json:"composite_sig"`
}

// ThresholdRule defines a single awareness threshold rule (DCP-09).
// Operator: "gt", "lt", "gte", "lte", "eq".
// ActionIfTriggered: "notify", "escalate", "block".
type ThresholdRule struct {
	Dimension         string  `json:"dimension"`
	Operator          string  `json:"operator"`
	Value             float64 `json:"value"`
	ActionIfTriggered string  `json:"action_if_triggered"`
}

// AwarenessThreshold configures notification thresholds for a human (DCP-09).
type AwarenessThreshold struct {
	DCPVersion     string             `json:"dcp_version"`
	ThresholdID    string             `json:"threshold_id"`
	SessionNonce   string             `json:"session_nonce"`
	AgentID        string             `json:"agent_id"`
	HumanID        string             `json:"human_id"`
	ThresholdRules []ThresholdRule    `json:"threshold_rules"`
	Timestamp      string             `json:"timestamp"`
	CompositeSig   CompositeSignature `json:"composite_sig"`
}
