// Package observability provides telemetry — spans, latency histograms, and
// event fan-out — for the DCP-AI Go SDK.
//
// The API mirrors the TypeScript, Python, and Rust SDKs:
//
//	import "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/observability"
//
//	observability.Default().Init(observability.Config{
//	    ServiceName: "my-agent",
//	    Enabled:     true,
//	})
//
// The package is disabled by default; no events are emitted and no memory is
// consumed until Init is called with Enabled=true. Wire an OTLP exporter with
// the optional `otlp` build tag — see otlp.go / otlp_stub.go.
package observability

import (
	"math"
	"sort"
	"sync"
	"time"
)

// SDKVersion is reported to OpenTelemetry as `service.version`. Bumped in
// lockstep with the Go module tag under sdks/go/v*.
const SDKVersion = "2.7.0"

// ExporterType selects how events are forwarded outside the in-memory bus.
type ExporterType string

const (
	ExporterNone    ExporterType = "none"
	ExporterConsole ExporterType = "console"
	ExporterOTLP    ExporterType = "otlp"
)

// Config configures the telemetry singleton.
type Config struct {
	ServiceName     string
	Enabled         bool
	ExporterType    ExporterType
	OTLPEndpoint    string
	MetricsInterval time.Duration
}

// DefaultConfig returns the disabled-by-default configuration.
func DefaultConfig() Config {
	return Config{
		ServiceName:     "dcp-ai-sdk",
		Enabled:         false,
		ExporterType:    ExporterNone,
		MetricsInterval: 60 * time.Second,
	}
}

// SpanStatus records whether a span completed OK or with an error.
type SpanStatus string

const (
	SpanOK    SpanStatus = "ok"
	SpanError SpanStatus = "error"
)

// Span is a timed operation annotated with attributes.
type Span struct {
	ID         string
	Name       string
	Attributes map[string]interface{}
	StartMs    int64
	EndMs      int64
	Status     SpanStatus
	Error      string

	startNs int64 // monotonic; not exported
}

// EventType categorizes the event bus payloads.
type EventType string

const (
	EventInit    EventType = "init"
	EventMetric  EventType = "metric"
	EventCounter EventType = "counter"
	EventSpan    EventType = "span"
	EventError   EventType = "error"
)

// Event is a single telemetry event delivered to listeners.
type Event struct {
	Type        EventType
	Name        string
	Value       float64
	Labels      map[string]string
	Span        *Span
	Operation   string
	Error       string
	ServiceName string
	Timestamp   time.Time
}

// Listener receives events from the bus. Listeners must not block for long;
// panics are recovered so one buggy listener can't break others.
type Listener func(Event)

// PercentileStats are aggregate latency statistics.
type PercentileStats struct {
	Count int
	Min   float64
	Max   float64
	Mean  float64
	P50   float64
	P95   float64
	P99   float64
}

// Totals are cumulative counters.
type Totals struct {
	SignaturesCreated  uint64
	SignaturesVerified uint64
	BundlesVerified    uint64
	Errors             uint64
	A2ASessions        uint64
	A2AMessages        uint64
}

// MetricsSummary is a snapshot of aggregated metrics.
type MetricsSummary struct {
	Sign             PercentileStats
	Verify           PercentileStats
	KEM              PercentileStats
	Checkpoint       PercentileStats
	BundleVerify     PercentileStats
	CacheHitRate     float64
	TierDistribution map[string]uint64
	Totals           Totals
}

type metrics struct {
	signLatencyMs         []float64
	verifyLatencyMs       []float64
	kemLatencyMs          []float64
	checkpointLatencyMs   []float64
	bundleVerifyLatencyMs []float64
	cacheHits             uint64
	cacheMisses           uint64
	tierDistribution      map[string]uint64
	errorsTotal           uint64
	signaturesCreated     uint64
	signaturesVerified    uint64
	bundlesVerified       uint64
	a2aSessions           uint64
	a2aMessages           uint64
}

func newMetrics() metrics {
	return metrics{
		tierDistribution: map[string]uint64{
			"routine":  0,
			"standard": 0,
			"elevated": 0,
			"maximum":  0,
		},
	}
}

// Telemetry is the core telemetry state.
type Telemetry struct {
	mu            sync.Mutex
	config        Config
	m             metrics
	spans         map[string]*Span
	listeners     map[uint64]Listener
	nextListener  uint64
	nextSpan      uint64
	otlpShutdown  func()
	otlpForward   func(Event)
}

// New constructs an isolated Telemetry instance (primarily for tests). Most
// callers should use Default().
func New() *Telemetry {
	return &Telemetry{
		config:    DefaultConfig(),
		m:         newMetrics(),
		spans:     map[string]*Span{},
		listeners: map[uint64]Listener{},
	}
}

var (
	globalOnce      sync.Once
	globalTelemetry *Telemetry
)

// Default returns the process-wide Telemetry singleton.
func Default() *Telemetry {
	globalOnce.Do(func() {
		globalTelemetry = New()
	})
	return globalTelemetry
}

// Init configures the telemetry and (if OTLP is selected and compiled in)
// starts the exporter bridge.
func (t *Telemetry) Init(cfg Config) {
	if cfg.ServiceName == "" {
		cfg.ServiceName = "dcp-ai-sdk"
	}
	if cfg.MetricsInterval == 0 {
		cfg.MetricsInterval = 60 * time.Second
	}
	t.mu.Lock()
	t.config = cfg
	enabled := cfg.Enabled
	exporter := cfg.ExporterType
	endpoint := cfg.OTLPEndpoint
	serviceName := cfg.ServiceName
	t.mu.Unlock()

	if !enabled {
		return
	}
	t.emit(Event{
		Type:        EventInit,
		ServiceName: serviceName,
		Timestamp:   time.Now(),
	})

	if exporter == ExporterOTLP {
		forward, shutdown, err := initOTLPBridge(serviceName, endpoint)
		if err != nil {
			t.emit(Event{
				Type:      EventError,
				Operation: "otlp_init",
				Error:     err.Error(),
				Timestamp: time.Now(),
			})
			return
		}
		t.mu.Lock()
		t.otlpForward = forward
		t.otlpShutdown = shutdown
		t.mu.Unlock()
	}
}

// Shutdown flushes exporters and resets the telemetry to defaults.
func (t *Telemetry) Shutdown() {
	t.mu.Lock()
	shutdown := t.otlpShutdown
	t.otlpForward = nil
	t.otlpShutdown = nil
	t.mu.Unlock()
	if shutdown != nil {
		shutdown()
	}
	t.mu.Lock()
	t.config = DefaultConfig()
	t.m = newMetrics()
	t.spans = map[string]*Span{}
	t.mu.Unlock()
}

// Reset is an alias for Shutdown; retained for symmetry with sibling SDKs.
func (t *Telemetry) Reset() { t.Shutdown() }

// IsEnabled reports whether telemetry is currently recording.
func (t *Telemetry) IsEnabled() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.config.Enabled
}

// OnEvent registers a listener and returns an unsubscribe closure.
func (t *Telemetry) OnEvent(l Listener) func() {
	t.mu.Lock()
	t.nextListener++
	id := t.nextListener
	t.listeners[id] = l
	t.mu.Unlock()
	return func() {
		t.mu.Lock()
		delete(t.listeners, id)
		t.mu.Unlock()
	}
}

func (t *Telemetry) emit(ev Event) {
	t.mu.Lock()
	enabled := t.config.Enabled
	if !enabled && ev.Type != EventInit {
		t.mu.Unlock()
		return
	}
	listeners := make([]Listener, 0, len(t.listeners))
	for _, l := range t.listeners {
		listeners = append(listeners, l)
	}
	forward := t.otlpForward
	t.mu.Unlock()

	if forward != nil {
		forward(ev)
	}
	for _, l := range listeners {
		safeListener(l, ev)
	}
}

func safeListener(l Listener, ev Event) {
	defer func() {
		_ = recover()
	}()
	l(ev)
}

// StartSpan begins a timed operation. Returns the span id (empty string if
// telemetry is disabled).
func (t *Telemetry) StartSpan(name string, attrs map[string]interface{}) string {
	t.mu.Lock()
	if !t.config.Enabled {
		t.mu.Unlock()
		return ""
	}
	t.nextSpan++
	id := formatSpanID(t.nextSpan)
	sp := &Span{
		ID:         id,
		Name:       name,
		Attributes: attrs,
		StartMs:    time.Now().UnixMilli(),
		Status:     SpanOK,
		startNs:    time.Now().UnixNano(),
	}
	t.spans[id] = sp
	t.mu.Unlock()
	return id
}

// EndSpan finishes a span and emits it on the event bus. Returns the span's
// duration in milliseconds, or 0 if the id is unknown.
func (t *Telemetry) EndSpan(id string) float64 {
	return t.EndSpanWith(id, SpanOK, "")
}

// EndSpanWith finishes a span with an explicit status/error.
func (t *Telemetry) EndSpanWith(id string, status SpanStatus, errMsg string) float64 {
	if id == "" {
		return 0
	}
	t.mu.Lock()
	sp, ok := t.spans[id]
	if !ok {
		t.mu.Unlock()
		return 0
	}
	delete(t.spans, id)
	t.mu.Unlock()
	sp.EndMs = time.Now().UnixMilli()
	sp.Status = status
	sp.Error = errMsg
	durationMs := float64(time.Now().UnixNano()-sp.startNs) / float64(time.Millisecond)
	t.emit(Event{
		Type:      EventSpan,
		Span:      sp,
		Timestamp: time.Now(),
	})
	return durationMs
}

// RecordSignLatency records a successful signature creation.
func (t *Telemetry) RecordSignLatency(ms float64, algorithm string) {
	t.mu.Lock()
	if !t.config.Enabled {
		t.mu.Unlock()
		return
	}
	t.m.signLatencyMs = append(t.m.signLatencyMs, ms)
	t.m.signaturesCreated++
	t.mu.Unlock()
	t.emit(metricEvent("sign_latency_ms", ms, map[string]string{"algorithm": algorithm}))
	t.emit(counterEvent("signatures_created", map[string]string{"algorithm": algorithm}))
}

// RecordVerifyLatency records a successful signature verification.
func (t *Telemetry) RecordVerifyLatency(ms float64, algorithm string) {
	t.mu.Lock()
	if !t.config.Enabled {
		t.mu.Unlock()
		return
	}
	t.m.verifyLatencyMs = append(t.m.verifyLatencyMs, ms)
	t.m.signaturesVerified++
	t.mu.Unlock()
	t.emit(metricEvent("verify_latency_ms", ms, map[string]string{"algorithm": algorithm}))
	t.emit(counterEvent("signatures_verified", map[string]string{"algorithm": algorithm}))
}

// RecordKEMLatency records an ML-KEM encapsulate/decapsulate call.
func (t *Telemetry) RecordKEMLatency(ms float64, operation string) {
	t.mu.Lock()
	if !t.config.Enabled {
		t.mu.Unlock()
		return
	}
	t.m.kemLatencyMs = append(t.m.kemLatencyMs, ms)
	t.mu.Unlock()
	t.emit(metricEvent("kem_latency_ms", ms, map[string]string{"operation": operation}))
}

// RecordCheckpointLatency records a checkpoint emission latency.
func (t *Telemetry) RecordCheckpointLatency(ms float64, checkpointType string) {
	t.mu.Lock()
	if !t.config.Enabled {
		t.mu.Unlock()
		return
	}
	t.m.checkpointLatencyMs = append(t.m.checkpointLatencyMs, ms)
	t.mu.Unlock()
	t.emit(metricEvent("checkpoint_latency_ms", ms, map[string]string{"type": checkpointType}))
}

// RecordBundleVerify records a bundle verification with its observed tier.
func (t *Telemetry) RecordBundleVerify(ms float64, success bool, tier string) {
	t.mu.Lock()
	if !t.config.Enabled {
		t.mu.Unlock()
		return
	}
	t.m.bundleVerifyLatencyMs = append(t.m.bundleVerifyLatencyMs, ms)
	if success {
		t.m.bundlesVerified++
	}
	t.m.tierDistribution[tier]++
	t.mu.Unlock()
	labels := map[string]string{"tier": tier, "success": "false"}
	if success {
		labels["success"] = "true"
	}
	t.emit(metricEvent("bundle_verify_ms", ms, labels))
	if success {
		t.emit(counterEvent("bundles_verified", map[string]string{"tier": tier}))
	}
}

// RecordCacheHit records a cache hit.
func (t *Telemetry) RecordCacheHit() {
	t.mu.Lock()
	defer t.mu.Unlock()
	if !t.config.Enabled {
		return
	}
	t.m.cacheHits++
}

// RecordCacheMiss records a cache miss.
func (t *Telemetry) RecordCacheMiss() {
	t.mu.Lock()
	defer t.mu.Unlock()
	if !t.config.Enabled {
		return
	}
	t.m.cacheMisses++
}

// RecordA2ASession records an A2A session establishment.
func (t *Telemetry) RecordA2ASession() {
	t.mu.Lock()
	if !t.config.Enabled {
		t.mu.Unlock()
		return
	}
	t.m.a2aSessions++
	t.mu.Unlock()
	t.emit(counterEvent("a2a_sessions", nil))
}

// RecordA2AMessage records an A2A message exchange.
func (t *Telemetry) RecordA2AMessage() {
	t.mu.Lock()
	if !t.config.Enabled {
		t.mu.Unlock()
		return
	}
	t.m.a2aMessages++
	t.mu.Unlock()
	t.emit(counterEvent("a2a_messages", nil))
}

// RecordError emits an error event and increments the error counter.
func (t *Telemetry) RecordError(operation, errMsg string) {
	t.mu.Lock()
	if !t.config.Enabled {
		t.mu.Unlock()
		return
	}
	t.m.errorsTotal++
	t.mu.Unlock()
	t.emit(Event{
		Type:      EventError,
		Operation: operation,
		Error:     errMsg,
		Timestamp: time.Now(),
	})
}

// GetMetricsSummary returns a snapshot of aggregated metrics.
func (t *Telemetry) GetMetricsSummary() MetricsSummary {
	t.mu.Lock()
	defer t.mu.Unlock()
	m := t.m
	totalCache := m.cacheHits + m.cacheMisses
	var hitRate float64
	if totalCache > 0 {
		hitRate = float64(m.cacheHits) / float64(totalCache)
	}
	tierCopy := make(map[string]uint64, len(m.tierDistribution))
	for k, v := range m.tierDistribution {
		tierCopy[k] = v
	}
	return MetricsSummary{
		Sign:             computePercentiles(m.signLatencyMs),
		Verify:           computePercentiles(m.verifyLatencyMs),
		KEM:              computePercentiles(m.kemLatencyMs),
		Checkpoint:       computePercentiles(m.checkpointLatencyMs),
		BundleVerify:     computePercentiles(m.bundleVerifyLatencyMs),
		CacheHitRate:     hitRate,
		TierDistribution: tierCopy,
		Totals: Totals{
			SignaturesCreated:  m.signaturesCreated,
			SignaturesVerified: m.signaturesVerified,
			BundlesVerified:    m.bundlesVerified,
			Errors:             m.errorsTotal,
			A2ASessions:        m.a2aSessions,
			A2AMessages:        m.a2aMessages,
		},
	}
}

func computePercentiles(values []float64) PercentileStats {
	if len(values) == 0 {
		return PercentileStats{}
	}
	sorted := make([]float64, len(values))
	copy(sorted, values)
	sort.Float64s(sorted)
	var sum float64
	for _, v := range sorted {
		sum += v
	}
	n := len(sorted)
	idx := func(p float64) int {
		i := int(math.Floor(float64(n) * p))
		if i >= n {
			i = n - 1
		}
		return i
	}
	return PercentileStats{
		Count: n,
		Min:   sorted[0],
		Max:   sorted[n-1],
		Mean:  sum / float64(n),
		P50:   sorted[idx(0.5)],
		P95:   sorted[idx(0.95)],
		P99:   sorted[idx(0.99)],
	}
}

func metricEvent(name string, value float64, labels map[string]string) Event {
	return Event{
		Type:      EventMetric,
		Name:      name,
		Value:     value,
		Labels:    labels,
		Timestamp: time.Now(),
	}
}

func counterEvent(name string, labels map[string]string) Event {
	return Event{
		Type:      EventCounter,
		Name:      name,
		Labels:    labels,
		Timestamp: time.Now(),
	}
}

func formatSpanID(n uint64) string {
	return "span-" + itoa(n) + "-" + itoa(uint64(time.Now().UnixNano()))
}

func itoa(n uint64) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}
