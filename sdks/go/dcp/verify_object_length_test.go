package dcp

import (
	"encoding/base64"
	"fmt"
	"strings"
	"testing"

	"github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/observability"
)

// A V1 public key that is not 32 bytes long is an error, never an input to
// ed25519.Verify, which panics on it.

func keyOfLength(n int) string { return base64.StdEncoding.EncodeToString(make([]byte, n)) }

// notPanicking fails the test, instead of crashing the test binary, if f panics.
func notPanicking(t *testing.T, f func()) {
	t.Helper()
	defer func() {
		if p := recover(); p != nil {
			t.Fatalf("panicked: %v", p)
		}
	}()
	f()
}

func TestV1VerifyObjectRejectsPublicKeyLengths(t *testing.T) {
	sb := loadSignedBundle(t)
	// "" decodes to a key of 0 bytes: only a direct VerifyObject call gets one.
	for _, n := range []int{0, 1, 31, 33, 64} {
		t.Run(fmt.Sprintf("%d bytes", n), func(t *testing.T) {
			key := keyOfLength(n)
			notPanicking(t, func() {
				ok, err := VerifyObject(sb.Bundle, sb.Signature.SigB64, key)
				if ok || err == nil {
					t.Fatalf("want false and an error, got %v, %v", ok, err)
				}
				if !strings.Contains(err.Error(), "invalid public key length") {
					t.Fatalf("unexpected error: %v", err)
				}
				if key != "" && strings.Contains(err.Error(), key) {
					t.Fatal("the error must not contain the key")
				}
			})
		})
	}
}

func TestV1VerifySignedBundleRejectsEmbeddedKeyLengths(t *testing.T) {
	for _, n := range []int{1, 31, 33, 64} {
		t.Run(fmt.Sprintf("%d bytes", n), func(t *testing.T) {
			sb := loadSignedBundle(t)
			sb.Signature.SignerInfo.PublicKeyB64 = keyOfLength(n)
			notPanicking(t, func() {
				r := VerifySignedBundle(sb, "")
				if r.Verified || len(r.Errors) != 1 || r.Errors[0] != "SIGNATURE INVALID" {
					t.Fatalf("want SIGNATURE INVALID, got %+v", r)
				}
			})
		})
	}
}

func TestV1VerifySignedBundleRejectsCallerKeyLengths(t *testing.T) {
	for _, n := range []int{1, 31, 33, 64} {
		t.Run(fmt.Sprintf("%d bytes", n), func(t *testing.T) {
			sb := loadSignedBundle(t)
			notPanicking(t, func() {
				r := VerifySignedBundle(sb, keyOfLength(n))
				if r.Verified || len(r.Errors) != 1 || r.Errors[0] != "SIGNATURE INVALID" {
					t.Fatalf("want SIGNATURE INVALID, got %+v", r)
				}
			})
		})
	}
}

// For VerifySignedBundle, "" is not a key of 0 bytes: it means the embedded key.
func TestV1VerifySignedBundleEmptyKeyUsesTheEmbeddedKey(t *testing.T) {
	sb := loadSignedBundle(t)
	if r := VerifySignedBundle(sb, ""); !r.Verified {
		t.Fatalf("the embedded key should verify the bundle: %v", r.Errors)
	}
}

func TestV1VerifySignedBundleWithoutAnyKey(t *testing.T) {
	sb := loadSignedBundle(t)
	sb.Signature.SignerInfo.PublicKeyB64 = ""
	notPanicking(t, func() {
		r := VerifySignedBundle(sb, "")
		if r.Verified || len(r.Errors) != 1 || r.Errors[0] != "missing public key" {
			t.Fatalf("want missing public key, got %+v", r)
		}
	})
}

func TestV1VerifyObjectControls(t *testing.T) {
	sb := loadSignedBundle(t)
	key := loadGoldenVectors(t).V1BundleVerification.PublicKeyB64
	if ok, err := VerifyObject(sb.Bundle, sb.Signature.SigB64, key); !ok || err != nil {
		t.Fatalf("the signed bundle should verify: %v, %v", ok, err)
	}
	altered := loadSignedBundle(t)
	altered.Bundle.Intent.ActionType = "execute_code"
	if ok, err := VerifyObject(altered.Bundle, sb.Signature.SigB64, key); ok || err != nil {
		t.Fatalf("an altered bundle: want false without an error, got %v, %v", ok, err)
	}
	if ok, err := VerifyObject(sb.Bundle, sb.Signature.SigB64, keyOfLength(32)); ok || err != nil {
		t.Fatalf("a wrong 32-byte key: want false without an error, got %v, %v", ok, err)
	}
}

// The length error follows the telemetry of the other VerifyObject errors: one
// error event, the span ended with an error, no verify latency.
func TestV1VerifyObjectKeyLengthTelemetry(t *testing.T) {
	tel := observability.Default()
	tel.Reset()
	defer tel.Reset()
	tel.Init(observability.Config{Enabled: true, ExporterType: observability.ExporterNone})

	var errors, verifyMetrics int
	var spans []*observability.Span
	unsub := tel.OnEvent(func(e observability.Event) {
		switch {
		case e.Type == observability.EventError && e.Operation == "verify":
			errors++
		case e.Type == observability.EventSpan && e.Span != nil && e.Span.Name == "dcp.verify":
			spans = append(spans, e.Span)
		case e.Type == observability.EventMetric && e.Name == "verify_latency_ms":
			verifyMetrics++
		}
	})
	defer unsub()

	sb := loadSignedBundle(t)
	notPanicking(t, func() {
		_, _ = VerifyObject(sb.Bundle, sb.Signature.SigB64, keyOfLength(31))
	})
	if errors != 1 || verifyMetrics != 0 || len(spans) != 1 {
		t.Fatalf("want 1 error, 0 verify latencies, 1 span; got %d, %d, %d", errors, verifyMetrics, len(spans))
	}
	if spans[0].Status != observability.SpanError || !strings.Contains(spans[0].Error, "invalid public key length") {
		t.Fatalf("want an error span, got %s %q", spans[0].Status, spans[0].Error)
	}
	if s := tel.GetMetricsSummary(); s.Totals.Errors != 1 || s.Totals.SignaturesVerified != 0 {
		t.Fatalf("want 1 error and 0 verifications, got %+v", s.Totals)
	}

	// The valid path is unchanged: an ok span and one verify latency.
	key := loadGoldenVectors(t).V1BundleVerification.PublicKeyB64
	if ok, err := VerifyObject(sb.Bundle, sb.Signature.SigB64, key); !ok || err != nil {
		t.Fatalf("the signed bundle should verify: %v, %v", ok, err)
	}
	if verifyMetrics != 1 || len(spans) != 2 || spans[1].Status != observability.SpanOK {
		t.Fatalf("want 1 verify latency and an ok span, got %d, %d spans", verifyMetrics, len(spans))
	}
}
