package dcp

import (
	"encoding/json"
	"strings"
	"testing"

	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

// SignBundleV2 names the bundle's responsible principal as the signer: an empty
// signer.id violates signed_bundle.schema.json, which the reference verifier,
// the CLI and the server enforce.
func TestSignBundleV2NamesThePrincipal(t *testing.T) {
	reg := newRegistry()
	classical, pq := chainKeys(t, reg)
	bundle := &v2.CitizenshipBundleV2{
		DCPBundleVersion:           "2.0",
		Manifest:                   v2.BundleManifest{SessionNonce: strings.Repeat("a", 64)},
		ResponsiblePrincipalRecord: v2.SignedPayload{Payload: map[string]interface{}{"human_id": "rpr:alice"}},
	}
	signed, err := v2.SignBundleV2(reg, bundle, classical, &pq)
	if err != nil {
		t.Fatalf("SignBundleV2: %v", err)
	}
	if signed.Signature.Signer.ID != "rpr:alice" || signed.Signature.Signer.Type != "human" {
		t.Fatalf("signer = %+v, want human rpr:alice", signed.Signature.Signer)
	}
	raw, _ := json.Marshal(signed.Signature.Signer)
	if !strings.Contains(string(raw), `"id":"rpr:alice"`) {
		t.Fatalf("serialized signer %s lacks the id", raw)
	}

	bundle.ResponsiblePrincipalRecord = v2.SignedPayload{Payload: map[string]interface{}{}}
	if _, err := v2.SignBundleV2(reg, bundle, classical, &pq); err == nil || !strings.Contains(err.Error(), "human_id") {
		t.Fatalf("an RPR without human_id must be refused, got %v", err)
	}
}
