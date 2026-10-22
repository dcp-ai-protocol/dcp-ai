package v2

import (
	"encoding/json"
	"strings"
	"testing"
)

// Limits compare as exact integers whatever their representation; a fraction is not comparable.
func TestAttenuationLimitsCompareExactly(t *testing.T) {
	entry := func(n interface{}) []scopeEntry {
		scope, ok := parseScope([]interface{}{map[string]interface{}{"domain": "api", "actions_permitted": []interface{}{}, "limits": map[string]interface{}{"n": n}}})
		if !ok {
			t.Fatalf("parseScope rejected %v", n)
		}
		return scope
	}
	parent := entry(int64(1<<53 + 3)) // float64 rounds it up to 2^53+4
	for name, child := range map[string]interface{}{
		"float_one_above_after_rounding": float64(1<<53 + 4),
		"int_one_above":                  int64(1<<53 + 4),
		"json_number_one_above":          json.Number("9007199254740996"),
		"fraction":                       1.5,
		"string":                         "1",
		"exponent_form_out_of_range":     json.Number("1e999999999"),
		"too_many_digits":                json.Number("1" + strings.Repeat("0", 100)),
		"float_out_of_range":             1e300,
	} {
		if err := attenuationError(parent, entry(child)); err == "" {
			t.Errorf("%s: %v must not be within 2^53+3", name, child)
		}
	}
	for name, child := range map[string]interface{}{
		"float_below":       float64(1<<53 + 2),
		"json_number_equal": json.Number("9007199254740995"),
		"negative":          -1,
	} {
		if err := attenuationError(parent, entry(child)); err != "" {
			t.Errorf("%s: %v must be within 2^53+3: %s", name, child, err)
		}
	}
	if err := attenuationError(entry(1.5), entry(1)); err == "" {
		t.Error("a parent limit with a fraction is not comparable")
	}
}
