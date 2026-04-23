// Package v2 — DCP-07 Arbitration & Jurisprudence (Go port).

package v2

import (
	"errors"
	"fmt"
)

// ArbitrationPanel is an M-of-N governance ceremony shell.
type ArbitrationPanel struct {
	ArbitratorIDs []string
	Threshold     int
	CreatedAt     string
}

// CreateArbitrationPanel enforces N >= threshold >= 1 and timestamps the panel.
func CreateArbitrationPanel(arbitratorIDs []string, threshold int) (*ArbitrationPanel, error) {
	if threshold < 1 {
		return nil, errors.New("arbitration panel: threshold must be >= 1")
	}
	if len(arbitratorIDs) < threshold {
		return nil, fmt.Errorf(
			"arbitration panel: need at least %d arbitrators, got %d",
			threshold, len(arbitratorIDs),
		)
	}
	return &ArbitrationPanel{
		ArbitratorIDs: arbitratorIDs,
		Threshold:     threshold,
		CreatedAt:     utcNowISO(),
	}, nil
}

// SubmitResolutionParams bundles inputs for SubmitResolution.
type SubmitResolutionParams struct {
	DisputeID             string
	SessionNonce          string
	ArbitratorIDs         []string
	Resolution            string
	Binding               bool
	PrecedentReferences   []string
}

// SubmitResolution signs an arbitration resolution for a dispute.
func SubmitResolution(
	registry *AlgorithmRegistry,
	classicalKey CompositeKeyInfo,
	pqKey CompositeKeyInfo,
	p SubmitResolutionParams,
) (map[string]interface{}, error) {
	payload := map[string]interface{}{
		"dcp_version":            "2.0",
		"dispute_id":             p.DisputeID,
		"session_nonce":          p.SessionNonce,
		"arbitrator_ids":         p.ArbitratorIDs,
		"resolution":             p.Resolution,
		"binding":                p.Binding,
		"precedent_references":   p.PrecedentReferences,
		"timestamp":              utcNowISO(),
	}
	return finaliseDispute(registry, classicalKey, pqKey, payload)
}

// JurisprudenceParams bundles inputs for BuildJurisprudenceBundle.
type JurisprudenceParams struct {
	JurisprudenceID      string
	SessionNonce         string
	DisputeID            string
	ResolutionID         string
	Category             string
	PrecedentSummary     string
	ApplicableContexts   []string
	AuthorityLevel       string
}

// BuildJurisprudenceBundle signs a precedent-of-record derived from a resolved dispute.
func BuildJurisprudenceBundle(
	registry *AlgorithmRegistry,
	classicalKey CompositeKeyInfo,
	pqKey CompositeKeyInfo,
	p JurisprudenceParams,
) (map[string]interface{}, error) {
	payload := map[string]interface{}{
		"dcp_version":           "2.0",
		"jurisprudence_id":      p.JurisprudenceID,
		"session_nonce":         p.SessionNonce,
		"dispute_id":            p.DisputeID,
		"resolution_id":         p.ResolutionID,
		"category":              p.Category,
		"precedent_summary":     p.PrecedentSummary,
		"applicable_contexts":   p.ApplicableContexts,
		"authority_level":       p.AuthorityLevel,
		"timestamp":             utcNowISO(),
	}
	return finaliseDispute(registry, classicalKey, pqKey, payload)
}

// LookupPrecedent filters a jurisprudence collection by category, optionally
// restricting to entries whose `applicable_contexts` include the given context.
func LookupPrecedent(
	jurisprudence []map[string]interface{},
	category string,
	context *string,
) []map[string]interface{} {
	out := []map[string]interface{}{}
	for _, entry := range jurisprudence {
		if entry["category"] != category {
			continue
		}
		if context != nil {
			contexts, _ := entry["applicable_contexts"].([]string)
			found := false
			for _, c := range contexts {
				if c == *context {
					found = true
					break
				}
			}
			if !found {
				// also try []interface{} (e.g. loaded from JSON)
				if generic, ok := entry["applicable_contexts"].([]interface{}); ok {
					for _, c := range generic {
						if s, ok := c.(string); ok && s == *context {
							found = true
							break
						}
					}
				}
			}
			if !found {
				continue
			}
		}
		out = append(out, entry)
	}
	return out
}
