// Package v2 — DCP-08 Rights & Obligations (Go port).

package v2

import "fmt"

func finaliseRights(
	registry *AlgorithmRegistry,
	classicalKey CompositeKeyInfo,
	pqKey CompositeKeyInfo,
	payload map[string]interface{},
) (map[string]interface{}, error) {
	canonical, err := CanonicalizeV2(payload)
	if err != nil {
		return nil, fmt.Errorf("canonicalize: %w", err)
	}
	sig, err := CompositeSign(registry, CtxRights, []byte(canonical), classicalKey, pqKey)
	if err != nil {
		return nil, err
	}
	payload["composite_sig"] = sig
	return payload, nil
}

// DeclareRightsParams bundles inputs for DeclareRights.
type DeclareRightsParams struct {
	DeclarationID string
	SessionNonce  string
	AgentID       string
	Rights        []map[string]interface{}
	Jurisdiction  string
}

func DeclareRights(
	registry *AlgorithmRegistry,
	classicalKey CompositeKeyInfo,
	pqKey CompositeKeyInfo,
	p DeclareRightsParams,
) (map[string]interface{}, error) {
	payload := map[string]interface{}{
		"dcp_version":     "2.0",
		"declaration_id":  p.DeclarationID,
		"session_nonce":   p.SessionNonce,
		"agent_id":        p.AgentID,
		"rights":          p.Rights,
		"jurisdiction":    p.Jurisdiction,
		"timestamp":       utcNowISO(),
	}
	return finaliseRights(registry, classicalKey, pqKey, payload)
}

// ObligationParams bundles inputs for RecordObligation.
type ObligationParams struct {
	ObligationID      string
	SessionNonce      string
	AgentID           string
	HumanID           string
	ObligationType    string
	ComplianceStatus  string
	EvidenceHashes    []string
}

func RecordObligation(
	registry *AlgorithmRegistry,
	classicalKey CompositeKeyInfo,
	pqKey CompositeKeyInfo,
	p ObligationParams,
) (map[string]interface{}, error) {
	payload := map[string]interface{}{
		"dcp_version":        "2.0",
		"obligation_id":      p.ObligationID,
		"session_nonce":      p.SessionNonce,
		"agent_id":           p.AgentID,
		"human_id":           p.HumanID,
		"obligation_type":    p.ObligationType,
		"compliance_status":  p.ComplianceStatus,
		"evidence_hashes":    p.EvidenceHashes,
		"timestamp":          utcNowISO(),
	}
	return finaliseRights(registry, classicalKey, pqKey, payload)
}

// ViolationParams bundles inputs for ReportViolation.
type ViolationParams struct {
	ViolationID    string
	SessionNonce   string
	AgentID        string
	ViolatedRight  string
	EvidenceHashes []string
	DisputeID      *string
}

func ReportViolation(
	registry *AlgorithmRegistry,
	classicalKey CompositeKeyInfo,
	pqKey CompositeKeyInfo,
	p ViolationParams,
) (map[string]interface{}, error) {
	var disputeID interface{}
	if p.DisputeID != nil {
		disputeID = *p.DisputeID
	} else {
		disputeID = nil
	}
	payload := map[string]interface{}{
		"dcp_version":      "2.0",
		"violation_id":     p.ViolationID,
		"session_nonce":    p.SessionNonce,
		"agent_id":         p.AgentID,
		"violated_right":   p.ViolatedRight,
		"evidence_hashes":  p.EvidenceHashes,
		"dispute_id":       disputeID,
		"timestamp":        utcNowISO(),
	}
	return finaliseRights(registry, classicalKey, pqKey, payload)
}

// ComplianceReport is the outcome of CheckRightsCompliance.
type ComplianceReport struct {
	Compliant  bool
	Violations []string
}

// CheckRightsCompliance returns a report listing non-compliant obligations.
// `declaration` is kept in the signature for API parity with the other SDKs.
func CheckRightsCompliance(_declaration map[string]interface{}, obligations []map[string]interface{}) ComplianceReport {
	violations := []string{}
	for _, o := range obligations {
		if o["compliance_status"] == "non_compliant" {
			id, _ := o["obligation_id"].(string)
			otype, _ := o["obligation_type"].(string)
			violations = append(violations, fmt.Sprintf("Obligation %s (%s) is non-compliant", id, otype))
		}
	}
	return ComplianceReport{
		Compliant:  len(violations) == 0,
		Violations: violations,
	}
}
