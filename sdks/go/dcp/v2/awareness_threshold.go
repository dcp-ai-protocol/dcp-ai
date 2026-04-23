// Package v2 — DCP-09 Awareness Threshold Engine (Go port).

package v2

import (
	"fmt"
	"math"
)

// SignificanceContext feeds EvaluateSignificance; unset fields default to 0.
type SignificanceContext struct {
	FinancialImpact     float64
	DataSensitivity     float64
	RelationshipImpact  float64
	Irreversibility     float64
	PrecedentSetting    float64
}

// EvaluateSignificance produces a score in 0..=1000 using the shared weights.
func EvaluateSignificance(ctx SignificanceContext) int {
	clamp := func(v float64) float64 {
		if v < 0 {
			return 0
		}
		if v > 1 {
			return 1
		}
		return v
	}
	total := clamp(ctx.FinancialImpact)*0.25 +
		clamp(ctx.DataSensitivity)*0.20 +
		clamp(ctx.RelationshipImpact)*0.20 +
		clamp(ctx.Irreversibility)*0.20 +
		clamp(ctx.PrecedentSetting)*0.15
	return int(math.Round(total * 1000))
}

// NotifyResult is the outcome of ShouldNotifyHuman.
type NotifyResult struct {
	Notify         bool
	TriggeredRules []map[string]interface{}
	Actions        []string
}

func evaluateOperator(op string, actual, threshold float64) bool {
	switch op {
	case "gt":
		return actual > threshold
	case "lt":
		return actual < threshold
	case "gte":
		return actual >= threshold
	case "lte":
		return actual <= threshold
	case "eq":
		return actual == threshold
	}
	return false
}

// ShouldNotifyHuman evaluates a set of threshold rules against a significance score.
func ShouldNotifyHuman(significance float64, thresholds []map[string]interface{}) NotifyResult {
	triggered := []map[string]interface{}{}
	seen := map[string]bool{}
	actions := []string{}
	for _, rule := range thresholds {
		dim, _ := rule["dimension"].(string)
		op, _ := rule["operator"].(string)
		val, _ := toFloat(rule["value"])
		actual := 0.0
		if dim == "significance" {
			actual = significance
		}
		if evaluateOperator(op, actual, val) {
			triggered = append(triggered, rule)
			if action, ok := rule["action_if_triggered"].(string); ok && !seen[action] {
				seen[action] = true
				actions = append(actions, action)
			}
		}
	}
	return NotifyResult{
		Notify:         len(triggered) > 0,
		TriggeredRules: triggered,
		Actions:        actions,
	}
}

func toFloat(v interface{}) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case float32:
		return float64(x), true
	case int:
		return float64(x), true
	case int64:
		return float64(x), true
	case uint:
		return float64(x), true
	default:
		return 0, false
	}
}

// AwarenessThresholdParams bundles inputs for CreateAwarenessThreshold.
type AwarenessThresholdParams struct {
	ThresholdID     string
	SessionNonce    string
	AgentID         string
	HumanID         string
	ThresholdRules  []map[string]interface{}
}

// CreateAwarenessThreshold signs an awareness threshold configuration.
func CreateAwarenessThreshold(
	registry *AlgorithmRegistry,
	classicalKey CompositeKeyInfo,
	pqKey CompositeKeyInfo,
	p AwarenessThresholdParams,
) (map[string]interface{}, error) {
	payload := map[string]interface{}{
		"dcp_version":       "2.0",
		"threshold_id":      p.ThresholdID,
		"session_nonce":     p.SessionNonce,
		"agent_id":          p.AgentID,
		"human_id":          p.HumanID,
		"threshold_rules":   p.ThresholdRules,
		"timestamp":         utcNowISO(),
	}
	canonical, err := CanonicalizeV2(payload)
	if err != nil {
		return nil, fmt.Errorf("canonicalize: %w", err)
	}
	sig, err := CompositeSign(registry, CtxAwareness, []byte(canonical), classicalKey, pqKey)
	if err != nil {
		return nil, err
	}
	payload["composite_sig"] = sig
	return payload, nil
}

// AdvisoryDeclarationParams bundles inputs for CreateAdvisoryDeclaration.
type AdvisoryDeclarationParams struct {
	DeclarationID        string
	SessionNonce         string
	AgentID              string
	HumanID              string
	SignificanceScore    int
	ActionSummary        string
	RecommendedResponse  string
	ResponseDeadline     string
}

// CreateAdvisoryDeclaration signs an advisory intended for the human principal.
func CreateAdvisoryDeclaration(
	registry *AlgorithmRegistry,
	classicalKey CompositeKeyInfo,
	pqKey CompositeKeyInfo,
	p AdvisoryDeclarationParams,
) (map[string]interface{}, error) {
	payload := map[string]interface{}{
		"dcp_version":                   "2.0",
		"declaration_id":                p.DeclarationID,
		"session_nonce":                 p.SessionNonce,
		"agent_id":                      p.AgentID,
		"human_id":                      p.HumanID,
		"significance_score":            p.SignificanceScore,
		"action_summary":                p.ActionSummary,
		"recommended_response":          p.RecommendedResponse,
		"response_deadline":             p.ResponseDeadline,
		"human_response":                nil,
		"proceeded_without_response":    false,
		"timestamp":                     utcNowISO(),
	}
	canonical, err := CanonicalizeV2(payload)
	if err != nil {
		return nil, fmt.Errorf("canonicalize: %w", err)
	}
	sig, err := CompositeSign(registry, CtxAwareness, []byte(canonical), classicalKey, pqKey)
	if err != nil {
		return nil, err
	}
	payload["composite_sig"] = sig
	return payload, nil
}
