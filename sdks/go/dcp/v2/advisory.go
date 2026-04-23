// Package v2 — DCP v2.0 Algorithm Advisory helpers (Go port).

package v2

import "time"

// AdvisoryCheckResult summarises an advisory against the current time.
type AdvisoryCheckResult struct {
	AffectedAlgorithms  []string
	Action              string
	Severity            string
	AdvisoryID          string
	Description         string
	GracePeriodExpired  bool
}

// CheckAdvisory evaluates an advisory payload against a point in time.
// `advisory` is a raw map with fields: advisory_id, severity,
// affected_algorithms, action, effective_date, grace_period_days, description.
func CheckAdvisory(advisory map[string]interface{}, now time.Time) AdvisoryCheckResult {
	if now.IsZero() {
		now = time.Now().UTC()
	}
	effectiveStr, _ := advisory["effective_date"].(string)
	effective, err := time.Parse(time.RFC3339, effectiveStr)
	if err != nil {
		effective, _ = time.Parse("2006-01-02T15:04:05Z", effectiveStr)
	}
	graceDays, _ := toInt(advisory["grace_period_days"])
	if graceDays == 0 {
		graceDays = 90
	}
	graceEnd := effective.Add(time.Duration(graceDays) * 24 * time.Hour)

	var algs []string
	switch a := advisory["affected_algorithms"].(type) {
	case []string:
		algs = a
	case []interface{}:
		for _, v := range a {
			if s, ok := v.(string); ok {
				algs = append(algs, s)
			}
		}
	}
	action, _ := advisory["action"].(string)
	severity, _ := advisory["severity"].(string)
	advisoryID, _ := advisory["advisory_id"].(string)
	description, _ := advisory["description"].(string)

	return AdvisoryCheckResult{
		AffectedAlgorithms: algs,
		Action:             action,
		Severity:           severity,
		AdvisoryID:         advisoryID,
		Description:        description,
		GracePeriodExpired: !now.Before(graceEnd),
	}
}

// AdvisoryEvaluation is the result of EvaluateAdvisories.
type AdvisoryEvaluation struct {
	Deprecated       map[string]struct{}
	Warned           map[string]struct{}
	Revoked          map[string]struct{}
	ActiveAdvisories []AdvisoryCheckResult
}

// EvaluateAdvisories routes each advisory into deprecated / warned / revoked sets.
func EvaluateAdvisories(advisories []map[string]interface{}, now time.Time) AdvisoryEvaluation {
	if now.IsZero() {
		now = time.Now().UTC()
	}
	out := AdvisoryEvaluation{
		Deprecated: map[string]struct{}{},
		Warned:     map[string]struct{}{},
		Revoked:    map[string]struct{}{},
	}
	for _, advisory := range advisories {
		effStr, _ := advisory["effective_date"].(string)
		eff, err := time.Parse(time.RFC3339, effStr)
		if err != nil {
			eff, _ = time.Parse("2006-01-02T15:04:05Z", effStr)
		}
		if now.Before(eff) {
			continue
		}
		r := CheckAdvisory(advisory, now)
		out.ActiveAdvisories = append(out.ActiveAdvisories, r)
		for _, alg := range r.AffectedAlgorithms {
			switch r.Action {
			case "revoke":
				out.Revoked[alg] = struct{}{}
			case "deprecate":
				if r.GracePeriodExpired {
					out.Deprecated[alg] = struct{}{}
				} else {
					out.Warned[alg] = struct{}{}
				}
			case "warn":
				out.Warned[alg] = struct{}{}
			}
		}
	}
	return out
}

// PolicyFilterOutcome is the result of ApplyAdvisoriesToPolicy.
type PolicyFilterOutcome struct {
	FilteredAlgs []string
	RemovedAlgs  []string
	Warnings     []string
}

// ApplyAdvisoriesToPolicy filters accepted algorithms by the advisory evaluation.
func ApplyAdvisoriesToPolicy(acceptedAlgs []string, eval AdvisoryEvaluation) PolicyFilterOutcome {
	out := PolicyFilterOutcome{
		FilteredAlgs: []string{},
		RemovedAlgs:  []string{},
		Warnings:     []string{},
	}
	for _, alg := range acceptedAlgs {
		_, revoked := eval.Revoked[alg]
		_, deprecated := eval.Deprecated[alg]
		if revoked || deprecated {
			out.RemovedAlgs = append(out.RemovedAlgs, alg)
			continue
		}
		out.FilteredAlgs = append(out.FilteredAlgs, alg)
		if _, ok := eval.Warned[alg]; ok {
			out.Warnings = append(out.Warnings, "Algorithm "+alg+" has an active advisory warning")
		}
	}
	return out
}

// BuildAlgorithmAdvisory constructs an AlgorithmAdvisory payload with defaults.
func BuildAlgorithmAdvisory(
	advisoryID, severity string,
	affectedAlgorithms []string,
	action, effectiveDate, description, issuer string,
) map[string]interface{} {
	return map[string]interface{}{
		"type":                     "algorithm_advisory",
		"advisory_id":              advisoryID,
		"severity":                 severity,
		"affected_algorithms":      affectedAlgorithms,
		"action":                   action,
		"replacement_algorithms":   []string{},
		"effective_date":           effectiveDate,
		"grace_period_days":        90,
		"description":              description,
		"issued_at":                effectiveDate,
		"issuer":                   issuer,
	}
}

func toInt(v interface{}) (int, bool) {
	switch x := v.(type) {
	case int:
		return x, true
	case int64:
		return int(x), true
	case float64:
		return int(x), true
	}
	return 0, false
}
