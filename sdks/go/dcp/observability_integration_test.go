package dcp_test

import (
	"testing"

	"github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp"
	"github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/observability"
)

func TestSignObjectEmitsTelemetryWhenEnabled(t *testing.T) {
	tel := observability.Default()
	tel.Reset()
	defer tel.Reset()
	tel.Init(observability.Config{Enabled: true, ExporterType: observability.ExporterNone})

	var signMetrics int
	unsub := tel.OnEvent(func(e observability.Event) {
		if e.Type == observability.EventMetric && e.Name == "sign_latency_ms" {
			signMetrics++
		}
	})
	defer unsub()

	kp, err := dcp.GenerateKeypair()
	if err != nil {
		t.Fatalf("keygen: %v", err)
	}
	if _, err := dcp.SignObject(map[string]interface{}{"x": 1}, kp.SecretKeyB64); err != nil {
		t.Fatalf("sign: %v", err)
	}
	if signMetrics != 1 {
		t.Fatalf("expected 1 sign_latency_ms event, got %d", signMetrics)
	}

	s := tel.GetMetricsSummary()
	if s.Totals.SignaturesCreated != 1 {
		t.Fatalf("expected 1 signatures created, got %d", s.Totals.SignaturesCreated)
	}
}

func TestSignObjectSilentWhenDisabled(t *testing.T) {
	tel := observability.Default()
	tel.Reset()
	defer tel.Reset()

	var events int
	unsub := tel.OnEvent(func(_ observability.Event) {
		events++
	})
	defer unsub()

	kp, err := dcp.GenerateKeypair()
	if err != nil {
		t.Fatalf("keygen: %v", err)
	}
	if _, err := dcp.SignObject(map[string]interface{}{"x": 1}, kp.SecretKeyB64); err != nil {
		t.Fatalf("sign: %v", err)
	}
	if events != 0 {
		t.Fatalf("expected no events, got %d", events)
	}
}
