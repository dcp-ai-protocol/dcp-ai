// Package v2 — DCP-05 Agent Lifecycle Management (Go port).
//
// State machine: commissioned -> active -> declining -> decommissioned.
// Mirrors sdks/typescript/src/core/lifecycle.ts semantics.

package v2

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"time"
)

// ── Lifecycle state machine ──

// ValidateStateTransition returns true iff the transition from -> to is allowed.
func ValidateStateTransition(from, to string) bool {
	switch from {
	case "commissioned":
		return to == "active" || to == "decommissioned"
	case "active":
		return to == "declining" || to == "decommissioned"
	case "declining":
		return to == "decommissioned" || to == "active"
	case "decommissioned":
		return false
	}
	return false
}

// ── Vitality scoring ──

const (
	weightTaskCompletion    = 0.3
	weightErrorRate         = 0.25
	weightHumanSatisfaction = 0.25
	weightPolicyAlignment   = 0.2
)

// VitalityMetricsFloat are per-metric floats in [0.0, 1.0].
type VitalityMetricsFloat struct {
	TaskCompletionRate float64
	ErrorRate          float64
	HumanSatisfaction  float64
	PolicyAlignment    float64
}

// VitalityMetricsInt are the on-wire integer representation. DCP v2.0 forbids
// floats in canonicalisation; callers pass boundary-integer values (typically
// 0 or 1 per field) and may derive the numeric score using the float form.
type VitalityMetricsInt struct {
	TaskCompletionRate int
	ErrorRate          int
	HumanSatisfaction  int
	PolicyAlignment    int
}

// ComputeVitalityScore produces an integer score in 0..=1000.
func ComputeVitalityScore(m VitalityMetricsFloat) int {
	raw := m.TaskCompletionRate*weightTaskCompletion +
		(1.0-m.ErrorRate)*weightErrorRate +
		m.HumanSatisfaction*weightHumanSatisfaction +
		m.PolicyAlignment*weightPolicyAlignment
	clamped := math.Max(0.0, math.Min(1.0, raw))
	return int(math.Round(clamped * 1000.0))
}

// ── Timestamps ──

func utcNowISO() string {
	// 2026-04-23T00:00:00.000Z — match the TS `new Date().toISOString()` format.
	return time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
}

// ── Artifact creation ──

// CommissioningParams bundles the inputs for CreateCommissioningCertificate.
type CommissioningParams struct {
	AgentID                    string
	SessionNonce               string
	HumanID                    string
	CommissioningAuthority     string
	Purpose                    string
	InitialCapabilities        []string
	RiskTier                   string
	PrincipalBindingReference  string
}

// CreateCommissioningCertificate issues a commissioning certificate.
func CreateCommissioningCertificate(
	registry *AlgorithmRegistry,
	classicalKey CompositeKeyInfo,
	pqKey CompositeKeyInfo,
	p CommissioningParams,
) (map[string]interface{}, error) {
	payload := map[string]interface{}{
		"dcp_version":                  "2.0",
		"agent_id":                     p.AgentID,
		"session_nonce":                p.SessionNonce,
		"human_id":                     p.HumanID,
		"commissioning_authority":      p.CommissioningAuthority,
		"timestamp":                    utcNowISO(),
		"purpose":                      p.Purpose,
		"initial_capabilities":         p.InitialCapabilities,
		"risk_tier":                    p.RiskTier,
		"principal_binding_reference":  p.PrincipalBindingReference,
	}
	return finaliseLifecyclePayload(registry, classicalKey, pqKey, payload)
}

// VitalityReportParams bundles inputs for CreateVitalityReport.
type VitalityReportParams struct {
	AgentID        string
	SessionNonce   string
	State          string
	Metrics        VitalityMetricsInt
	PrevReportHash string
}

// CreateVitalityReport issues a hash-chained vitality report.
func CreateVitalityReport(
	registry *AlgorithmRegistry,
	classicalKey CompositeKeyInfo,
	pqKey CompositeKeyInfo,
	p VitalityReportParams,
) (map[string]interface{}, error) {
	floatMetrics := VitalityMetricsFloat{
		TaskCompletionRate: float64(p.Metrics.TaskCompletionRate),
		ErrorRate:          float64(p.Metrics.ErrorRate),
		HumanSatisfaction:  float64(p.Metrics.HumanSatisfaction),
		PolicyAlignment:    float64(p.Metrics.PolicyAlignment),
	}
	score := ComputeVitalityScore(floatMetrics)

	payload := map[string]interface{}{
		"dcp_version":      "2.0",
		"agent_id":         p.AgentID,
		"session_nonce":    p.SessionNonce,
		"timestamp":        utcNowISO(),
		"vitality_score":   score,
		"state":            p.State,
		"metrics": map[string]interface{}{
			"task_completion_rate": p.Metrics.TaskCompletionRate,
			"error_rate":           p.Metrics.ErrorRate,
			"human_satisfaction":   p.Metrics.HumanSatisfaction,
			"policy_alignment":     p.Metrics.PolicyAlignment,
		},
		"prev_report_hash": p.PrevReportHash,
	}
	return finaliseLifecyclePayload(registry, classicalKey, pqKey, payload)
}

// HashVitalityReport produces `sha256:<hex>` over the canonical payload,
// with `composite_sig` excluded. Use this to chain successive reports.
func HashVitalityReport(report map[string]interface{}) (string, error) {
	payload := make(map[string]interface{}, len(report))
	for k, v := range report {
		if k == "composite_sig" {
			continue
		}
		payload[k] = v
	}
	canonical, err := CanonicalizeV2(payload)
	if err != nil {
		return "", err
	}
	h := sha256.Sum256([]byte(canonical))
	return "sha256:" + hex.EncodeToString(h[:]), nil
}

// DecommissioningParams bundles inputs for CreateDecommissioningRecord.
type DecommissioningParams struct {
	AgentID             string
	SessionNonce        string
	HumanID             string
	TerminationMode     string
	Reason              string
	FinalVitalityScore  int
	SuccessorAgentID    *string
	DataDisposition     string
}

// CreateDecommissioningRecord issues a decommissioning record.
func CreateDecommissioningRecord(
	registry *AlgorithmRegistry,
	classicalKey CompositeKeyInfo,
	pqKey CompositeKeyInfo,
	p DecommissioningParams,
) (map[string]interface{}, error) {
	var successor interface{}
	if p.SuccessorAgentID != nil {
		successor = *p.SuccessorAgentID
	} else {
		successor = nil
	}
	payload := map[string]interface{}{
		"dcp_version":           "2.0",
		"agent_id":              p.AgentID,
		"session_nonce":         p.SessionNonce,
		"human_id":              p.HumanID,
		"timestamp":             utcNowISO(),
		"termination_mode":      p.TerminationMode,
		"reason":                p.Reason,
		"final_vitality_score":  p.FinalVitalityScore,
		"successor_agent_id":    successor,
		"data_disposition":      p.DataDisposition,
	}
	return finaliseLifecyclePayload(registry, classicalKey, pqKey, payload)
}

// ── Shared helpers ──

func finaliseLifecyclePayload(
	registry *AlgorithmRegistry,
	classicalKey CompositeKeyInfo,
	pqKey CompositeKeyInfo,
	payload map[string]interface{},
) (map[string]interface{}, error) {
	canonical, err := CanonicalizeV2(payload)
	if err != nil {
		return nil, fmt.Errorf("canonicalize: %w", err)
	}
	sig, err := CompositeSign(registry, CtxLifecycle, []byte(canonical), classicalKey, pqKey)
	if err != nil {
		return nil, err
	}
	payload["composite_sig"] = sig
	return payload, nil
}

// ErrInvalidTransition is returned by callers that want a descriptive error
// when ValidateStateTransition reports false.
var ErrInvalidTransition = errors.New("invalid lifecycle state transition")
