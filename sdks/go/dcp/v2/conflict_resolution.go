// Package v2 — DCP-07 Conflict Resolution (Go port).

package v2

import (
	"errors"
	"fmt"
)

var escalationOrder = []string{"direct_negotiation", "contextual_arbitration", "human_appeal"}

func finaliseDispute(
	registry *AlgorithmRegistry,
	classicalKey CompositeKeyInfo,
	pqKey CompositeKeyInfo,
	payload map[string]interface{},
) (map[string]interface{}, error) {
	canonical, err := CanonicalizeV2(payload)
	if err != nil {
		return nil, fmt.Errorf("canonicalize: %w", err)
	}
	sig, err := CompositeSign(registry, CtxDispute, []byte(canonical), classicalKey, pqKey)
	if err != nil {
		return nil, err
	}
	payload["composite_sig"] = sig
	return payload, nil
}

// DisputeParams bundles inputs for CreateDispute.
type DisputeParams struct {
	DisputeID          string
	SessionNonce       string
	InitiatorAgentID   string
	RespondentAgentID  string
	DisputeType        string
	EvidenceHashes     []string
}

// CreateDispute opens a dispute at the direct_negotiation level.
func CreateDispute(
	registry *AlgorithmRegistry,
	classicalKey CompositeKeyInfo,
	pqKey CompositeKeyInfo,
	p DisputeParams,
) (map[string]interface{}, error) {
	payload := map[string]interface{}{
		"dcp_version":           "2.0",
		"dispute_id":            p.DisputeID,
		"session_nonce":         p.SessionNonce,
		"initiator_agent_id":    p.InitiatorAgentID,
		"respondent_agent_id":   p.RespondentAgentID,
		"dispute_type":          p.DisputeType,
		"evidence_hashes":       p.EvidenceHashes,
		"escalation_level":      "direct_negotiation",
		"status":                "open",
		"timestamp":             utcNowISO(),
	}
	return finaliseDispute(registry, classicalKey, pqKey, payload)
}

// ErrAlreadyAtMaxEscalation is returned when escalating past human_appeal.
var ErrAlreadyAtMaxEscalation = errors.New("dispute is already at maximum escalation level (human_appeal)")

// EscalateDispute moves a dispute to the next escalation level.
func EscalateDispute(
	registry *AlgorithmRegistry,
	classicalKey CompositeKeyInfo,
	pqKey CompositeKeyInfo,
	dispute map[string]interface{},
	sessionNonce string,
) (map[string]interface{}, error) {
	current, _ := dispute["escalation_level"].(string)
	idx := -1
	for i, lvl := range escalationOrder {
		if lvl == current {
			idx = i
			break
		}
	}
	if idx < 0 {
		return nil, fmt.Errorf("unknown escalation_level: %q", current)
	}
	if idx+1 >= len(escalationOrder) {
		return nil, ErrAlreadyAtMaxEscalation
	}
	next := escalationOrder[idx+1]

	payload := map[string]interface{}{
		"dcp_version":           "2.0",
		"dispute_id":            dispute["dispute_id"],
		"session_nonce":         sessionNonce,
		"initiator_agent_id":    dispute["initiator_agent_id"],
		"respondent_agent_id":   dispute["respondent_agent_id"],
		"dispute_type":          dispute["dispute_type"],
		"evidence_hashes":       dispute["evidence_hashes"],
		"escalation_level":      next,
		"status":                "in_negotiation",
		"timestamp":             utcNowISO(),
	}
	return finaliseDispute(registry, classicalKey, pqKey, payload)
}

// ResolveDispute marks a dispute as resolved without changing its escalation level.
func ResolveDispute(
	registry *AlgorithmRegistry,
	classicalKey CompositeKeyInfo,
	pqKey CompositeKeyInfo,
	dispute map[string]interface{},
	sessionNonce string,
) (map[string]interface{}, error) {
	payload := map[string]interface{}{
		"dcp_version":           "2.0",
		"dispute_id":            dispute["dispute_id"],
		"session_nonce":         sessionNonce,
		"initiator_agent_id":    dispute["initiator_agent_id"],
		"respondent_agent_id":   dispute["respondent_agent_id"],
		"dispute_type":          dispute["dispute_type"],
		"evidence_hashes":       dispute["evidence_hashes"],
		"escalation_level":      dispute["escalation_level"],
		"status":                "resolved",
		"timestamp":             utcNowISO(),
	}
	return finaliseDispute(registry, classicalKey, pqKey, payload)
}

// ObjectionParams bundles inputs for CreateObjection.
type ObjectionParams struct {
	ObjectionID             string
	SessionNonce            string
	AgentID                 string
	DirectiveHash           string
	ObjectionType           string
	Reasoning               string
	ProposedAlternative     *string
	HumanEscalationRequired bool
}

// CreateObjection creates a formal objection to a directive.
func CreateObjection(
	registry *AlgorithmRegistry,
	classicalKey CompositeKeyInfo,
	pqKey CompositeKeyInfo,
	p ObjectionParams,
) (map[string]interface{}, error) {
	var alt interface{}
	if p.ProposedAlternative != nil {
		alt = *p.ProposedAlternative
	} else {
		alt = nil
	}
	payload := map[string]interface{}{
		"dcp_version":                "2.0",
		"objection_id":               p.ObjectionID,
		"session_nonce":              p.SessionNonce,
		"agent_id":                   p.AgentID,
		"directive_hash":             p.DirectiveHash,
		"objection_type":             p.ObjectionType,
		"reasoning":                  p.Reasoning,
		"proposed_alternative":       alt,
		"human_escalation_required":  p.HumanEscalationRequired,
		"timestamp":                  utcNowISO(),
	}
	return finaliseDispute(registry, classicalKey, pqKey, payload)
}
