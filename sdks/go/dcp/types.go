// Package dcp provides types and verification for the Digital Citizenship Protocol.
package dcp

// HumanBindingRecord represents DCP-01 Human Binding Record.
type HumanBindingRecord struct {
	DCPVersion     string  `json:"dcp_version"`
	HumanID        string  `json:"human_id"`
	LegalName      string  `json:"legal_name"`
	EntityType     string  `json:"entity_type"`
	Jurisdiction   string  `json:"jurisdiction"`
	LiabilityMode  string  `json:"liability_mode"`
	OverrideRights bool    `json:"override_rights"`
	IssuedAt       string  `json:"issued_at"`
	ExpiresAt      *string `json:"expires_at"`
	Contact        *string `json:"contact,omitempty"`
	Signature      string  `json:"signature"`
}

// AgentPassport represents DCP-01 Agent Passport.
type AgentPassport struct {
	DCPVersion            string   `json:"dcp_version"`
	AgentID               string   `json:"agent_id"`
	PublicKey             string   `json:"public_key"`
	HumanBindingReference string   `json:"human_binding_reference"`
	Capabilities          []string `json:"capabilities,omitempty"`
	RiskTier              string   `json:"risk_tier,omitempty"`
	CreatedAt             string   `json:"created_at"`
	Status                string   `json:"status"`
	Signature             string   `json:"signature"`
}

// IntentTarget represents the target of an intent action.
type IntentTarget struct {
	Channel string  `json:"channel"`
	To      *string `json:"to,omitempty"`
	Domain  *string `json:"domain,omitempty"`
	URL     *string `json:"url,omitempty"`
}

// Intent represents DCP-02 Intent Declaration.
type Intent struct {
	DCPVersion      string       `json:"dcp_version"`
	IntentID        string       `json:"intent_id"`
	AgentID         string       `json:"agent_id"`
	HumanID         string       `json:"human_id"`
	Timestamp       string       `json:"timestamp"`
	ActionType      string       `json:"action_type"`
	Target          IntentTarget `json:"target"`
	DataClasses     []string     `json:"data_classes"`
	EstimatedImpact string       `json:"estimated_impact"`
	RequiresConsent *bool        `json:"requires_consent,omitempty"`
}

// PolicyDecision represents DCP-02 Policy Decision.
type PolicyDecision struct {
	DCPVersion string   `json:"dcp_version"`
	IntentID   string   `json:"intent_id"`
	Decision   string   `json:"decision"`
	RiskScore  float64  `json:"risk_score"`
	Reasons    []string `json:"reasons"`
}

// AuditEvidence represents evidence attached to an audit entry.
type AuditEvidence struct {
	Tool      *string `json:"tool"`
	ResultRef *string `json:"result_ref"`
}

// AuditEntry represents DCP-03 Audit Entry.
type AuditEntry struct {
	DCPVersion     string        `json:"dcp_version"`
	AuditID        string        `json:"audit_id"`
	PrevHash       string        `json:"prev_hash"`
	Timestamp      string        `json:"timestamp"`
	AgentID        string        `json:"agent_id"`
	HumanID        string        `json:"human_id"`
	IntentID       string        `json:"intent_id"`
	IntentHash     string        `json:"intent_hash"`
	PolicyDecision string        `json:"policy_decision"`
	Outcome        string        `json:"outcome"`
	Evidence       AuditEvidence `json:"evidence"`
}

// CitizenshipBundle represents a full DCP Citizenship Bundle.
type CitizenshipBundle struct {
	HumanBindingRecord HumanBindingRecord `json:"human_binding_record"`
	AgentPassport      AgentPassport      `json:"agent_passport"`
	Intent             Intent             `json:"intent"`
	PolicyDecision     PolicyDecision     `json:"policy_decision"`
	AuditEntries       []AuditEntry       `json:"audit_entries"`
}

// Signer represents the bundle signer information.
type Signer struct {
	Type        string `json:"type"`
	ID          string `json:"id"`
	PublicKeyB64 string `json:"public_key_b64"`
}

// BundleSignature represents the signature block of a signed bundle.
type BundleSignature struct {
	Alg        string  `json:"alg"`
	CreatedAt  string  `json:"created_at"`
	SignerInfo Signer  `json:"signer"`
	BundleHash string  `json:"bundle_hash"`
	MerkleRoot *string `json:"merkle_root"`
	SigB64     string  `json:"sig_b64"`
}

// SignedBundle represents a signed DCP Citizenship Bundle.
type SignedBundle struct {
	Bundle    CitizenshipBundle `json:"bundle"`
	Signature BundleSignature   `json:"signature"`
}

// VerificationResult holds the result of a bundle verification.
type VerificationResult struct {
	Verified bool     `json:"verified"`
	Errors   []string `json:"errors,omitempty"`
}

// RevocationRecord represents a DCP agent revocation.
type RevocationRecord struct {
	DCPVersion string `json:"dcp_version"`
	AgentID    string `json:"agent_id"`
	HumanID    string `json:"human_id"`
	Timestamp  string `json:"timestamp"`
	Reason     string `json:"reason"`
	Signature  string `json:"signature"`
}
