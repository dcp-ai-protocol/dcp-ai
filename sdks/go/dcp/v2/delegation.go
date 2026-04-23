// Package v2 — DCP-09 Delegation & Representation (Go port).

package v2

import (
	"fmt"
	"time"
)

// DelegationMandateParams bundles inputs for CreateDelegationMandate.
type DelegationMandateParams struct {
	MandateID      string
	SessionNonce   string
	HumanID        string
	AgentID        string
	AuthorityScope []map[string]interface{}
	ValidFrom      string // ISO-8601
	ValidUntil     string // ISO-8601
	Revocable      bool
}

// CreateDelegationMandate produces a mandate signed by the human principal.
// The signature is placed in `human_composite_sig` (not `composite_sig`) to
// distinguish the human-principal witness on the artefact.
func CreateDelegationMandate(
	registry *AlgorithmRegistry,
	humanClassicalKey CompositeKeyInfo,
	humanPQKey CompositeKeyInfo,
	p DelegationMandateParams,
) (map[string]interface{}, error) {
	payload := map[string]interface{}{
		"dcp_version":      "2.0",
		"mandate_id":       p.MandateID,
		"session_nonce":    p.SessionNonce,
		"human_id":         p.HumanID,
		"agent_id":         p.AgentID,
		"authority_scope":  p.AuthorityScope,
		"valid_from":       p.ValidFrom,
		"valid_until":      p.ValidUntil,
		"revocable":        p.Revocable,
		"timestamp":        utcNowISO(),
	}
	canonical, err := CanonicalizeV2(payload)
	if err != nil {
		return nil, fmt.Errorf("canonicalize: %w", err)
	}
	sig, err := CompositeSign(registry, CtxDelegation, []byte(canonical), humanClassicalKey, humanPQKey)
	if err != nil {
		return nil, err
	}
	payload["human_composite_sig"] = sig
	return payload, nil
}

// MandateValidity is the outcome of VerifyMandateValidity.
type MandateValidity struct {
	Valid  bool
	Reason string
}

// VerifyMandateValidity checks mandate expiry and revocation.
func VerifyMandateValidity(mandate map[string]interface{}, revokedMandateIDs map[string]bool) MandateValidity {
	id, _ := mandate["mandate_id"].(string)
	if revokedMandateIDs[id] {
		return MandateValidity{Valid: false, Reason: "Mandate has been revoked"}
	}
	validFrom, _ := mandate["valid_from"].(string)
	validUntil, _ := mandate["valid_until"].(string)
	now := time.Now().UTC()
	vf, err := time.Parse(time.RFC3339, validFrom)
	if err == nil && vf.After(now) {
		return MandateValidity{Valid: false, Reason: "Mandate is not yet valid"}
	}
	vu, err := time.Parse(time.RFC3339, validUntil)
	if err == nil && vu.Before(now) {
		return MandateValidity{Valid: false, Reason: "Mandate has expired"}
	}
	return MandateValidity{Valid: true}
}

// RevocationOutcome is the result of RevokeDelegation.
type RevocationOutcome struct {
	Revoked bool
	Reason  string
}

// RevokeDelegation marks a mandate as revoked, mutating `revokedMandateIDs`.
// Non-revocable mandates return {Revoked: false, Reason: "Mandate is not revocable"}.
func RevokeDelegation(mandate map[string]interface{}, revokedMandateIDs map[string]bool) RevocationOutcome {
	revocable, _ := mandate["revocable"].(bool)
	if !revocable {
		return RevocationOutcome{Revoked: false, Reason: "Mandate is not revocable"}
	}
	if id, ok := mandate["mandate_id"].(string); ok && id != "" {
		revokedMandateIDs[id] = true
	}
	return RevocationOutcome{Revoked: true}
}

// InteractionParams bundles inputs for GenerateInteractionRecord.
type InteractionParams struct {
	InteractionID          string
	SessionNonce           string
	AgentID                string
	CounterpartyAgentID    string
	PublicLayer            map[string]string
	PrivateLayerHash       string
	MandateID              string
}

// GenerateInteractionRecord signs a dual-layer interaction record.
func GenerateInteractionRecord(
	registry *AlgorithmRegistry,
	classicalKey CompositeKeyInfo,
	pqKey CompositeKeyInfo,
	p InteractionParams,
) (map[string]interface{}, error) {
	payload := map[string]interface{}{
		"dcp_version":              "2.0",
		"interaction_id":           p.InteractionID,
		"session_nonce":            p.SessionNonce,
		"agent_id":                 p.AgentID,
		"counterparty_agent_id":    p.CounterpartyAgentID,
		"public_layer":             p.PublicLayer,
		"private_layer_hash":       p.PrivateLayerHash,
		"mandate_id":               p.MandateID,
		"timestamp":                utcNowISO(),
	}
	canonical, err := CanonicalizeV2(payload)
	if err != nil {
		return nil, fmt.Errorf("canonicalize: %w", err)
	}
	sig, err := CompositeSign(registry, CtxDelegation, []byte(canonical), classicalKey, pqKey)
	if err != nil {
		return nil, err
	}
	payload["composite_sig"] = sig
	return payload, nil
}
