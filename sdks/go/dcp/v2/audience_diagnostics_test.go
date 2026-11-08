package v2

import (
	"strings"
	"testing"
)

func TestAudienceDiagnosticQuotesUntrustedIdentifiers(t *testing.T) {
	result := V2VerificationResult{}
	verifyAudience(map[string]interface{}{"intended_verifier": "agent'\n\"\\"},
		VerifierPolicy{RequireAudienceBinding: true, VerifierID: "expected'\n\"\\"}, &result)
	want := `Bundle intended for verifier "agent'\n\"\\", not "expected'\n\"\\"`
	if len(result.Errors) != 1 || result.Errors[0] != want {
		t.Fatalf("diagnostic = %q, want exactly %q", result.Errors, want)
	}
	if strings.ContainsAny(result.Errors[0], "\r\n") {
		t.Fatal("untrusted identifiers introduced a new log line")
	}
}

func TestAudienceDiagnosticPreservesBindingControls(t *testing.T) {
	for _, tc := range []struct {
		name, intended, expected string
		required                 bool
		wantErrors               int
	}{
		{"matching special identifiers", "agent'\n\"\\", "agent'\n\"\\", true, 0},
		{"missing audience", "", "expected", true, 1},
		{"ordinary mismatch", "other", "expected", true, 1},
		{"binding disabled", "other", "expected", false, 0},
		{"no configured verifier", "other", "", true, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := V2VerificationResult{}
			verifyAudience(map[string]interface{}{"intended_verifier": tc.intended},
				VerifierPolicy{RequireAudienceBinding: tc.required, VerifierID: tc.expected}, &result)
			if len(result.Errors) != tc.wantErrors {
				t.Fatalf("errors = %q, want %d", result.Errors, tc.wantErrors)
			}
		})
	}
}
