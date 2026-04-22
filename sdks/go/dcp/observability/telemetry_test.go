package observability_test

import (
	"sync"
	"testing"

	"github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/observability"
)

func fresh(t *testing.T) *observability.Telemetry {
	t.Helper()
	return observability.New()
}

func TestDisabledByDefault(t *testing.T) {
	tel := fresh(t)
	if tel.IsEnabled() {
		t.Fatal("telemetry should be disabled by default")
	}
	tel.RecordSignLatency(10, "ed25519")
	tel.RecordVerifyLatency(5, "ed25519")
	tel.RecordBundleVerify(30, true, "standard")
	s := tel.GetMetricsSummary()
	if s.Sign.Count != 0 {
		t.Fatalf("expected sign count 0, got %d", s.Sign.Count)
	}
	if s.Totals.SignaturesCreated != 0 {
		t.Fatalf("expected 0 signatures created, got %d", s.Totals.SignaturesCreated)
	}
}

func TestInitEmitsInitEvent(t *testing.T) {
	tel := fresh(t)
	var mu sync.Mutex
	var inits []string
	unsub := tel.OnEvent(func(e observability.Event) {
		if e.Type == observability.EventInit {
			mu.Lock()
			inits = append(inits, e.ServiceName)
			mu.Unlock()
		}
	})
	defer unsub()
	tel.Init(observability.Config{ServiceName: "svc", Enabled: true, ExporterType: observability.ExporterNone})
	mu.Lock()
	defer mu.Unlock()
	if len(inits) != 1 || inits[0] != "svc" {
		t.Fatalf("expected init event with svc, got %#v", inits)
	}
}

func TestSignAggregatesAndPercentiles(t *testing.T) {
	tel := fresh(t)
	tel.Init(observability.Config{Enabled: true})
	for v := 1; v <= 10; v++ {
		tel.RecordSignLatency(float64(v), "ed25519")
	}
	s := tel.GetMetricsSummary()
	if s.Sign.Count != 10 {
		t.Fatalf("expected 10, got %d", s.Sign.Count)
	}
	if s.Sign.Min != 1 || s.Sign.Max != 10 || s.Sign.Mean != 5.5 {
		t.Fatalf("unexpected stats: %#v", s.Sign)
	}
	if s.Sign.P50 != 6 {
		t.Fatalf("expected p50 = 6, got %v", s.Sign.P50)
	}
	if s.Totals.SignaturesCreated != 10 {
		t.Fatalf("expected 10 sigs created, got %d", s.Totals.SignaturesCreated)
	}
}

func TestTierDistributionGrows(t *testing.T) {
	tel := fresh(t)
	tel.Init(observability.Config{Enabled: true})
	tel.RecordBundleVerify(1, true, "routine")
	tel.RecordBundleVerify(1, true, "routine")
	tel.RecordBundleVerify(1, true, "elevated")
	s := tel.GetMetricsSummary()
	if s.TierDistribution["routine"] != 2 {
		t.Fatalf("expected routine = 2, got %d", s.TierDistribution["routine"])
	}
	if s.TierDistribution["elevated"] != 1 {
		t.Fatalf("expected elevated = 1, got %d", s.TierDistribution["elevated"])
	}
	if s.TierDistribution["maximum"] != 0 {
		t.Fatalf("expected maximum = 0, got %d", s.TierDistribution["maximum"])
	}
}

func TestSpanLifecycle(t *testing.T) {
	tel := fresh(t)
	tel.Init(observability.Config{Enabled: true})
	var mu sync.Mutex
	var spans []string
	unsub := tel.OnEvent(func(e observability.Event) {
		if e.Type == observability.EventSpan && e.Span != nil {
			mu.Lock()
			spans = append(spans, e.Span.Name)
			mu.Unlock()
		}
	})
	defer unsub()
	id := tel.StartSpan("dcp.test", map[string]interface{}{"n": 1})
	if id == "" {
		t.Fatal("expected span id")
	}
	d := tel.EndSpan(id)
	if d < 0 {
		t.Fatalf("duration should be non-negative, got %v", d)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(spans) != 1 || spans[0] != "dcp.test" {
		t.Fatalf("unexpected span events: %#v", spans)
	}
}

func TestEndUnknownSpanIsNoop(t *testing.T) {
	tel := fresh(t)
	tel.Init(observability.Config{Enabled: true})
	if tel.EndSpan("nope") != 0 {
		t.Fatal("expected 0 for unknown span")
	}
}

func TestListenerPanicDoesNotBreakEmit(t *testing.T) {
	tel := fresh(t)
	tel.Init(observability.Config{Enabled: true})
	unsub := tel.OnEvent(func(_ observability.Event) {
		panic("listener bug")
	})
	defer unsub()
	// Must not propagate.
	tel.RecordSignLatency(1, "ed25519")
}

func TestCacheHitRate(t *testing.T) {
	tel := fresh(t)
	tel.Init(observability.Config{Enabled: true})
	tel.RecordCacheHit()
	tel.RecordCacheHit()
	tel.RecordCacheHit()
	tel.RecordCacheMiss()
	s := tel.GetMetricsSummary()
	if s.CacheHitRate != 0.75 {
		t.Fatalf("expected 0.75, got %v", s.CacheHitRate)
	}
}

func TestErrorIncrementsTotals(t *testing.T) {
	tel := fresh(t)
	tel.Init(observability.Config{Enabled: true})
	var got string
	unsub := tel.OnEvent(func(e observability.Event) {
		if e.Type == observability.EventError {
			got = e.Operation
		}
	})
	defer unsub()
	tel.RecordError("sign", "boom")
	if got != "sign" {
		t.Fatalf("expected sign, got %q", got)
	}
	if tel.GetMetricsSummary().Totals.Errors != 1 {
		t.Fatalf("expected 1 error, got %d", tel.GetMetricsSummary().Totals.Errors)
	}
}

func TestOTLPRequestedWithoutBuildTagSurfacesError(t *testing.T) {
	tel := fresh(t)
	var got string
	unsub := tel.OnEvent(func(e observability.Event) {
		if e.Type == observability.EventError && e.Operation == "otlp_init" {
			got = e.Error
		}
	})
	defer unsub()
	tel.Init(observability.Config{
		ServiceName:  "otlp-missing",
		Enabled:      true,
		ExporterType: observability.ExporterOTLP,
		OTLPEndpoint: "http://localhost:4318",
	})
	if got == "" {
		t.Fatal("expected otlp_init error event when built without -tags otlp")
	}
}
