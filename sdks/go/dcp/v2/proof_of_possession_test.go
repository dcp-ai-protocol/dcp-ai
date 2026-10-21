package v2

import "testing"

// PoP payloads are signed cross-SDK, so they must use dcp-jcs-v1 bytes.
func TestPopCanonicalJSONMatchesProfile(t *testing.T) {
	got, err := canonicalJSON(map[string]interface{}{"nonce": "a&b<c>", "kid": "k"})
	if err != nil {
		t.Fatal(err)
	}
	if want := `{"kid":"k","nonce":"a&b<c>"}`; string(got) != want {
		t.Fatalf("got %s, want %s", got, want)
	}
}
