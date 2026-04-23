package dcp_test

import (
	"testing"

	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

func TestErrorCodeStableIdentifiers(t *testing.T) {
	if string(v2.ErrPqSigInvalid) != "DCP-E101" {
		t.Fatalf("ErrPqSigInvalid mismatch: %s", v2.ErrPqSigInvalid)
	}
	if string(v2.ErrHashChainBroken) != "DCP-E200" {
		t.Fatalf("mismatch")
	}
	if string(v2.ErrA2ADecryptFailed) != "DCP-E604" {
		t.Fatalf("mismatch")
	}
	if string(v2.ErrHSM) != "DCP-E902" {
		t.Fatalf("mismatch")
	}
}

func TestErrorCodeRetryable(t *testing.T) {
	if !v2.ErrRateLimitExceeded.Retry() {
		t.Fatalf("rate-limit should be retryable")
	}
	if !v2.ErrA2AHandshakeFailed.Retry() {
		t.Fatalf("handshake-failed should be retryable")
	}
	if v2.ErrPqSigInvalid.Retry() {
		t.Fatalf("pq-sig-invalid should NOT be retryable")
	}
	if v2.ErrAgentRevoked.Retry() {
		t.Fatalf("agent-revoked should NOT be retryable")
	}
}

func TestCreateDcpErrorDefaultMessage(t *testing.T) {
	err := v2.CreateDcpError(v2.ErrManifestMissing, "", nil)
	if err.Code != v2.ErrManifestMissing {
		t.Fatalf("code: %s", err.Code)
	}
	if err.Message == "" {
		t.Fatalf("message should be populated")
	}
	if err.Retryable {
		t.Fatalf("manifest-missing should not be retryable")
	}
}

func TestCreateDcpErrorOverrideMessage(t *testing.T) {
	err := v2.CreateDcpError(v2.ErrInternal, "db dropped", nil)
	if err.Message != "db dropped" {
		t.Fatalf("override ignored: %s", err.Message)
	}
	if !err.Retryable {
		t.Fatalf("internal should be retryable")
	}
}

func TestIsDcpError(t *testing.T) {
	err := v2.CreateDcpError(v2.ErrInternal, "", nil)
	if !v2.IsDcpError(err) {
		t.Fatalf("IsDcpError should be true")
	}
}

func TestDetectWireFormat(t *testing.T) {
	if v2.DetectWireFormat([]byte{}) != "json" {
		t.Fatalf("empty -> json")
	}
	if v2.DetectWireFormat([]byte(`{"dcp_version":"2.0"}`)) != "json" {
		t.Fatalf("json object")
	}
	if v2.DetectWireFormat([]byte(`[1,2,3]`)) != "json" {
		t.Fatalf("json array")
	}
	if v2.DetectWireFormat([]byte("  {")) != "json" {
		t.Fatalf("leading whitespace")
	}
	if v2.DetectWireFormat([]byte{0xa3, 0x01, 0x02}) != "cbor" {
		t.Fatalf("cbor map header")
	}
	if v2.DetectWireFormat([]byte{0xd8, 0x1e}) != "cbor" {
		t.Fatalf("cbor tag")
	}
}
