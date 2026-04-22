//go:build otlp

package observability

import (
	"context"
	"fmt"
	"strings"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.24.0"
	"go.opentelemetry.io/otel/trace"
)

type otlpHandles struct {
	tracerProvider *sdktrace.TracerProvider
	meterProvider  *sdkmetric.MeterProvider
	tracer         trace.Tracer
	sign           metric.Float64Histogram
	verify         metric.Float64Histogram
	kem            metric.Float64Histogram
	checkpoint     metric.Float64Histogram
	bundleVerify   metric.Float64Histogram
	sigCreated     metric.Int64Counter
	sigVerified    metric.Int64Counter
	bundlesOK      metric.Int64Counter
	a2aSessions    metric.Int64Counter
	a2aMessages    metric.Int64Counter
	errors         metric.Int64Counter
}

func initOTLPBridge(serviceName, endpoint string) (func(Event), func(), error) {
	if endpoint == "" {
		endpoint = "http://localhost:4318"
	}
	ctx := context.Background()

	traceURL, metricURL := splitEndpoint(endpoint)

	traceExp, err := otlptracehttp.New(ctx,
		otlptracehttp.WithEndpointURL(traceURL),
	)
	if err != nil {
		return nil, nil, fmt.Errorf("trace exporter: %w", err)
	}
	metricExp, err := otlpmetrichttp.New(ctx,
		otlpmetrichttp.WithEndpointURL(metricURL),
	)
	if err != nil {
		_ = traceExp.Shutdown(ctx)
		return nil, nil, fmt.Errorf("metric exporter: %w", err)
	}

	res, err := resource.Merge(
		resource.Default(),
		resource.NewWithAttributes(
			semconv.SchemaURL,
			semconv.ServiceName(serviceName),
			semconv.ServiceVersion(SDKVersion),
			attribute.String("sdk.language", "go"),
		),
	)
	if err != nil {
		_ = traceExp.Shutdown(ctx)
		_ = metricExp.Shutdown(ctx)
		return nil, nil, fmt.Errorf("resource: %w", err)
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(traceExp),
		sdktrace.WithResource(res),
	)
	mp := sdkmetric.NewMeterProvider(
		sdkmetric.WithReader(sdkmetric.NewPeriodicReader(metricExp)),
		sdkmetric.WithResource(res),
	)
	otel.SetTracerProvider(tp)
	otel.SetMeterProvider(mp)

	tracer := tp.Tracer("dcp-ai")
	meter := mp.Meter("dcp-ai")

	h := &otlpHandles{tracerProvider: tp, meterProvider: mp, tracer: tracer}
	h.sign, _ = meter.Float64Histogram("dcp.sign.latency_ms")
	h.verify, _ = meter.Float64Histogram("dcp.verify.latency_ms")
	h.kem, _ = meter.Float64Histogram("dcp.kem.latency_ms")
	h.checkpoint, _ = meter.Float64Histogram("dcp.checkpoint.latency_ms")
	h.bundleVerify, _ = meter.Float64Histogram("dcp.bundle_verify.latency_ms")
	h.sigCreated, _ = meter.Int64Counter("dcp.signatures.created")
	h.sigVerified, _ = meter.Int64Counter("dcp.signatures.verified")
	h.bundlesOK, _ = meter.Int64Counter("dcp.bundles.verified")
	h.a2aSessions, _ = meter.Int64Counter("dcp.a2a.sessions")
	h.a2aMessages, _ = meter.Int64Counter("dcp.a2a.messages")
	h.errors, _ = meter.Int64Counter("dcp.errors")

	forward := func(ev Event) { h.forward(ev) }
	shutdown := func() {
		shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = tp.Shutdown(shutCtx)
		_ = mp.Shutdown(shutCtx)
	}
	return forward, shutdown, nil
}

func (h *otlpHandles) forward(ev Event) {
	switch ev.Type {
	case EventMetric:
		attrs := kvFromMap(ev.Labels)
		switch ev.Name {
		case "sign_latency_ms":
			h.sign.Record(context.Background(), ev.Value, metric.WithAttributes(attrs...))
		case "verify_latency_ms":
			h.verify.Record(context.Background(), ev.Value, metric.WithAttributes(attrs...))
		case "kem_latency_ms":
			h.kem.Record(context.Background(), ev.Value, metric.WithAttributes(attrs...))
		case "checkpoint_latency_ms":
			h.checkpoint.Record(context.Background(), ev.Value, metric.WithAttributes(attrs...))
		case "bundle_verify_ms":
			h.bundleVerify.Record(context.Background(), ev.Value, metric.WithAttributes(attrs...))
		}
	case EventCounter:
		attrs := kvFromMap(ev.Labels)
		switch ev.Name {
		case "signatures_created":
			h.sigCreated.Add(context.Background(), 1, metric.WithAttributes(attrs...))
		case "signatures_verified":
			h.sigVerified.Add(context.Background(), 1, metric.WithAttributes(attrs...))
		case "bundles_verified":
			h.bundlesOK.Add(context.Background(), 1, metric.WithAttributes(attrs...))
		case "a2a_sessions":
			h.a2aSessions.Add(context.Background(), 1, metric.WithAttributes(attrs...))
		case "a2a_messages":
			h.a2aMessages.Add(context.Background(), 1, metric.WithAttributes(attrs...))
		}
	case EventError:
		h.errors.Add(context.Background(), 1, metric.WithAttributes(attribute.String("operation", ev.Operation)))
	case EventSpan:
		if ev.Span == nil {
			return
		}
		startTime := time.UnixMilli(ev.Span.StartMs)
		endTime := time.UnixMilli(ev.Span.EndMs)
		if ev.Span.EndMs == 0 {
			endTime = time.Now()
		}
		ctx, sp := h.tracer.Start(context.Background(), ev.Span.Name,
			trace.WithTimestamp(startTime),
			trace.WithAttributes(attrsFromInterfaceMap(ev.Span.Attributes)...),
		)
		if ev.Span.Status == SpanError {
			sp.SetStatus(codes.Error, ev.Span.Error)
		} else {
			sp.SetStatus(codes.Ok, "")
		}
		sp.End(trace.WithTimestamp(endTime))
		_ = ctx
	}
}

func splitEndpoint(base string) (traceURL, metricURL string) {
	trimmed := strings.TrimRight(base, "/")
	return trimmed + "/v1/traces", trimmed + "/v1/metrics"
}

func kvFromMap(m map[string]string) []attribute.KeyValue {
	out := make([]attribute.KeyValue, 0, len(m))
	for k, v := range m {
		out = append(out, attribute.String(k, v))
	}
	return out
}

func attrsFromInterfaceMap(m map[string]interface{}) []attribute.KeyValue {
	out := make([]attribute.KeyValue, 0, len(m))
	for k, v := range m {
		switch val := v.(type) {
		case string:
			out = append(out, attribute.String(k, val))
		case int:
			out = append(out, attribute.Int(k, val))
		case int64:
			out = append(out, attribute.Int64(k, val))
		case float64:
			out = append(out, attribute.Float64(k, val))
		case bool:
			out = append(out, attribute.Bool(k, val))
		default:
			out = append(out, attribute.String(k, fmt.Sprintf("%v", v)))
		}
	}
	return out
}
