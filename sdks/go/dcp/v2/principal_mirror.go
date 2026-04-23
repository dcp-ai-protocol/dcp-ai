// Package v2 — DCP-09 Principal Mirror (Go port).

package v2

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
)

func computeAuditChainHash(entries []map[string]interface{}) (string, error) {
	h := sha256.New()
	for _, entry := range entries {
		canonical, err := CanonicalizeV2(entry)
		if err != nil {
			return "", err
		}
		h.Write([]byte(canonical))
	}
	return "sha256:" + hex.EncodeToString(h.Sum(nil)), nil
}

// MirrorParams bundles inputs for GenerateMirror.
type MirrorParams struct {
	MirrorID        string
	SessionNonce    string
	AgentID         string
	HumanID         string
	Period          map[string]string // {"from": "...", "to": "..."}
	AuditEntries    []map[string]interface{}
	Narrative       string
	DecisionSummary string
}

// GenerateMirror produces a signed principal-mirror artefact over a narrative
// and an audit-chain integrity hash.
func GenerateMirror(
	registry *AlgorithmRegistry,
	classicalKey CompositeKeyInfo,
	pqKey CompositeKeyInfo,
	p MirrorParams,
) (map[string]interface{}, error) {
	auditHash, err := computeAuditChainHash(p.AuditEntries)
	if err != nil {
		return nil, err
	}
	payload := map[string]interface{}{
		"dcp_version":         "2.0",
		"mirror_id":           p.MirrorID,
		"session_nonce":       p.SessionNonce,
		"agent_id":            p.AgentID,
		"human_id":            p.HumanID,
		"period":              p.Period,
		"narrative":           p.Narrative,
		"action_count":        len(p.AuditEntries),
		"decision_summary":    p.DecisionSummary,
		"audit_chain_hash":    auditHash,
		"timestamp":           utcNowISO(),
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
