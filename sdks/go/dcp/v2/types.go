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
