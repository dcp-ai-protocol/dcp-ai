package v2

import (
	"encoding/json"
	"strings"
	"testing"
)

// Limits compare as integers within ±(2^53-1) whatever their representation; one past that
// bound, a fraction or a number against a non-number is not comparable.
func TestAttenuationLimitsBeyondTheSafeIntegersAreNotComparable(t *testing.T) {
	entry := func(n interface{}) []scopeEntry {
		scope, ok := parseScope([]interface{}{map[string]interface{}{"domain": "api", "actions_permitted": []interface{}{}, "limits": map[string]interface{}{"n": n}}})
		if !ok {
			t.Fatalf("parseScope rejected %v", n)
		}
		return scope
	}
	parent := entry(int64(1<<53 - 1))
	for name, child := range map[string]interface{}{
		"int_equal":         int64(1<<53 - 1),
		"float_equal":       float64(1<<53 - 1),
		"json_number_equal": json.Number("9007199254740991"),
		"exponent_form":     json.Number("1e15"),
		"negative":          -1,
		"negative_bound":    int64(-(1<<53 - 1)),
	} {
		if err := attenuationError(parent, entry(child)); err != "" {
			t.Errorf("%s: %v must be within 2^53-1: %s", name, child, err)
		}
	}
	for name, child := range map[string]interface{}{
		"int_2_53":                   int64(1 << 53),
		"float_2_53":                 float64(1 << 53),
		"json_number_2_53":           json.Number("9007199254740992"),
		"json_number_2_53_plus_1":    json.Number("9007199254740993"),
		"negative_2_53":              int64(-(1 << 53)),
		"fraction":                   1.5,
		"string":                     "1",
		"exponent_form_out_of_range": json.Number("1e999999999"),
		"exponent_form_1e400":        json.Number("1e400"),
		"too_many_digits":            json.Number("1" + strings.Repeat("0", 100)),
		"float_out_of_range":         1e300,
	} {
		if err := attenuationError(parent, entry(child)); !strings.Contains(err, "not comparable") {
			t.Errorf("%s: %v must not be comparable: %q", name, child, err)
		}
	}
	for name, bad := range map[string]interface{}{"parent_2_53": int64(1 << 53), "parent_fraction": 1.5} {
		if err := attenuationError(entry(bad), entry(1)); !strings.Contains(err, "not comparable") {
			t.Errorf("%s: a parent limit of %v is not comparable: %q", name, bad, err)
		}
	}
	if err := attenuationError(entry(5), entry(6)); !strings.Contains(err, "not within the parent") {
		t.Errorf("6 is not within 5: %q", err)
	}
}
