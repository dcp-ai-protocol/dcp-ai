// Package v2 — DCP-06 Digital Succession (Go port).
//
// Implements digital testaments, succession ceremonies, and memory transfer
// manifests. Mirrors sdks/typescript/src/core/succession.ts semantics.

package v2

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
)

// MemoryEntry is a single item in an agent's memory transfer set.
type MemoryEntry struct {
	Hash     string `json:"hash"`
	Category string `json:"category"`
	Size     int64  `json:"size"`
}

// ClassifiedMemory is the partition result from ClassifyMemory.
type ClassifiedMemory struct {
	Operational         []MemoryEntry
	RelationalDestroyed []string
}

// ClassifyMemory partitions entries by the provided category-to-disposition
// map. Unknown categories default to "destroy", matching the TS port.
func ClassifyMemory(entries []MemoryEntry, classification map[string]string) ClassifiedMemory {
	out := ClassifiedMemory{}
	for _, entry := range entries {
		disposition, ok := classification[entry.Category]
		if !ok {
			disposition = "destroy"
		}
		switch disposition {
		case "transfer":
			out.Operational = append(out.Operational, entry)
		case "destroy":
			out.RelationalDestroyed = append(out.RelationalDestroyed, entry.Hash)
		}
	}
	return out
}

// ── Digital testament ──

// DigitalTestamentParams bundles inputs for CreateDigitalTestament.
type DigitalTestamentParams struct {
	AgentID               string
	SessionNonce          string
	SuccessorPreferences  []map[string]interface{}
	MemoryClassification  map[string]string
	HumanConsentRequired  bool
}

// CreateDigitalTestament issues a first-version testament with prev_testament_hash="GENESIS".
func CreateDigitalTestament(
	registry *AlgorithmRegistry,
	classicalKey CompositeKeyInfo,
	pqKey CompositeKeyInfo,
	p DigitalTestamentParams,
) (map[string]interface{}, error) {
	now := utcNowISO()
	payload := map[string]interface{}{
		"dcp_version":              "2.0",
		"agent_id":                 p.AgentID,
		"session_nonce":            p.SessionNonce,
		"created_at":               now,
		"last_updated":             now,
		"successor_preferences":    p.SuccessorPreferences,
		"memory_classification":    p.MemoryClassification,
		"human_consent_required":   p.HumanConsentRequired,
		"testament_version":        1,
		"prev_testament_hash":      "GENESIS",
	}
	return finaliseSuccessionPayload(registry, classicalKey, pqKey, payload)
}

// TestamentUpdates captures which fields the caller wants to change.
type TestamentUpdates struct {
	SessionNonce          string
	SuccessorPreferences  *[]map[string]interface{}
	MemoryClassification  *map[string]string
	HumanConsentRequired  *bool
}

// UpdateDigitalTestament issues the next testament version, chaining the prev hash.
func UpdateDigitalTestament(
	registry *AlgorithmRegistry,
	classicalKey CompositeKeyInfo,
	pqKey CompositeKeyInfo,
	previous map[string]interface{},
	updates TestamentUpdates,
) (map[string]interface{}, error) {
	// Hash previous payload (composite_sig excluded) for chaining.
	prevPayload := make(map[string]interface{}, len(previous))
	for k, v := range previous {
		if k == "composite_sig" {
			continue
		}
		prevPayload[k] = v
	}
	prevCanon, err := CanonicalizeV2(prevPayload)
	if err != nil {
		return nil, fmt.Errorf("canonicalize previous: %w", err)
	}
	h := sha256.Sum256([]byte(prevCanon))
	prevHash := "sha256:" + hex.EncodeToString(h[:])

	// Resolve the effective values: override when supplied, otherwise inherit.
	successorPreferences := previous["successor_preferences"]
	if updates.SuccessorPreferences != nil {
		successorPreferences = *updates.SuccessorPreferences
	}
	memoryClassification := previous["memory_classification"]
	if updates.MemoryClassification != nil {
		memoryClassification = *updates.MemoryClassification
	}
	humanConsentRequired := previous["human_consent_required"]
	if updates.HumanConsentRequired != nil {
		humanConsentRequired = *updates.HumanConsentRequired
	}
	createdAt := previous["created_at"]
	prevVersion, _ := previous["testament_version"].(int)
	if prevVersion == 0 {
		if v, ok := previous["testament_version"].(float64); ok {
			prevVersion = int(v)
		}
	}

	payload := map[string]interface{}{
		"dcp_version":            "2.0",
		"agent_id":               previous["agent_id"],
		"session_nonce":          updates.SessionNonce,
		"created_at":             createdAt,
		"last_updated":           utcNowISO(),
		"successor_preferences":  successorPreferences,
		"memory_classification":  memoryClassification,
		"human_consent_required": humanConsentRequired,
		"testament_version":      prevVersion + 1,
		"prev_testament_hash":    prevHash,
	}
	return finaliseSuccessionPayload(registry, classicalKey, pqKey, payload)
}

// ── Memory transfer manifest ──

// MemoryTransferManifestParams bundles inputs for CreateMemoryTransferManifest.
type MemoryTransferManifestParams struct {
	SessionNonce              string
	PredecessorAgentID        string
	SuccessorAgentID          string
	OperationalMemory         []MemoryEntry
	RelationalMemoryDestroyed []string
	// TransferHash is a dual-hash reference: {"sha256": ..., "sha3_256": ...}.
	TransferHash map[string]string
}

// CreateMemoryTransferManifest signs a manifest tying predecessor->successor.
func CreateMemoryTransferManifest(
	registry *AlgorithmRegistry,
	classicalKey CompositeKeyInfo,
	pqKey CompositeKeyInfo,
	p MemoryTransferManifestParams,
) (map[string]interface{}, error) {
	payload := map[string]interface{}{
		"dcp_version":                  "2.0",
		"session_nonce":                p.SessionNonce,
		"predecessor_agent_id":         p.PredecessorAgentID,
		"successor_agent_id":           p.SuccessorAgentID,
		"timestamp":                    utcNowISO(),
		"operational_memory":           p.OperationalMemory,
		"relational_memory_destroyed":  p.RelationalMemoryDestroyed,
		"transfer_hash":                p.TransferHash,
	}
	return finaliseSuccessionPayload(registry, classicalKey, pqKey, payload)
}

// ── Succession ceremony ──

// SuccessionParams bundles inputs for ExecuteSuccession.
type SuccessionParams struct {
	PredecessorAgentID          string
	SuccessorAgentID            string
	SessionNonce                string
	TransitionType              string
	HumanConsent                map[string]interface{} // nil if absent
	CeremonyParticipants        []string
	MemoryTransferManifestHash  string
}

// ErrNoCeremonyParticipants surfaces when ExecuteSuccession is called with an empty slice.
var ErrNoCeremonyParticipants = errors.New("succession ceremony requires at least one participant")

// ExecuteSuccession produces a signed succession record.
func ExecuteSuccession(
	registry *AlgorithmRegistry,
	classicalKey CompositeKeyInfo,
	pqKey CompositeKeyInfo,
	p SuccessionParams,
) (map[string]interface{}, error) {
	if len(p.CeremonyParticipants) == 0 {
		return nil, ErrNoCeremonyParticipants
	}
	var humanConsent interface{}
	if p.HumanConsent != nil {
		humanConsent = p.HumanConsent
	} else {
		humanConsent = nil
	}
	payload := map[string]interface{}{
		"dcp_version":                    "2.0",
		"predecessor_agent_id":           p.PredecessorAgentID,
		"successor_agent_id":             p.SuccessorAgentID,
		"session_nonce":                  p.SessionNonce,
		"timestamp":                      utcNowISO(),
		"transition_type":                p.TransitionType,
		"human_consent":                  humanConsent,
		"ceremony_participants":          p.CeremonyParticipants,
		"memory_transfer_manifest_hash": p.MemoryTransferManifestHash,
	}
	return finaliseSuccessionPayload(registry, classicalKey, pqKey, payload)
}

// ── Shared helpers ──

func finaliseSuccessionPayload(
	registry *AlgorithmRegistry,
	classicalKey CompositeKeyInfo,
	pqKey CompositeKeyInfo,
	payload map[string]interface{},
) (map[string]interface{}, error) {
	canonical, err := CanonicalizeV2(payload)
	if err != nil {
		return nil, fmt.Errorf("canonicalize: %w", err)
	}
	sig, err := CompositeSign(registry, CtxSuccession, []byte(canonical), classicalKey, pqKey)
	if err != nil {
		return nil, err
	}
	payload["composite_sig"] = sig
	return payload, nil
}
