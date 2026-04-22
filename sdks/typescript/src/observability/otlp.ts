/**
 * OTLP (OpenTelemetry Protocol) bridge for `dcpTelemetry`.
 *
 * Kept in its own file so the OTel SDK imports are lazy: nothing from
 * `@opentelemetry/*` is loaded unless `dcpTelemetry.init({ exporterType: 'otlp' })`
 * is called. That keeps the default install footprint and runtime of
 * `@dcp-ai/sdk` unchanged for the 95% of consumers who never turn OTLP on.
 */

import type { DcpTelemetryConfig, TelemetryEvent } from './telemetry.js';

export interface OtlpHandles {
  /** Record the given telemetry event by projecting it into OTel primitives. */
  handleEvent(event: TelemetryEvent): void;
  /** Flush + close the OTel SDK. Best-effort. */
  shutdown(): Promise<void>;
}

// The `@opentelemetry/*` packages are declared as optional peer dependencies,
// so their types are not guaranteed to be installed at compile time. We keep
// the imports dynamic and the handles untyped (`any`) to avoid dragging their
// type surface into `@dcp-ai/sdk`'s public typings. The runtime behaviour is
// still correct because the OTel SDK enforces its own shape at call time.
/* eslint-disable @typescript-eslint/no-explicit-any */

type HistogramMap = Map<string, { record(value: number, attrs?: Record<string, string | number | boolean>): void }>;
type CounterMap = Map<string, { add(value: number, attrs?: Record<string, string | number | boolean>): void }>;

// Suppress type-only import resolution when the optional OTel packages are
// not installed in the consuming environment. We want this file to compile
// against any TS config, dependency present or not.
// @ts-ignore
type OtelImport = any;

async function tryLoadOtel(): Promise<{
  api: OtelImport;
  sdkTraceNode: OtelImport;
  sdkMetrics: OtelImport;
  traceExporter: OtelImport;
  metricsExporter: OtelImport;
  resources: OtelImport;
  semconv: OtelImport;
}> {
  // Variable specifiers keep TypeScript from statically resolving these imports,
  // which would fail the build when the optional OTel packages are absent.
  const imp = (name: string) => import(/* @vite-ignore */ /* webpackIgnore: true */ name);
  const [api, sdkTraceNode, sdkMetrics, traceExporter, metricsExporter, resources, semconv] = await Promise.all([
    imp('@opentelemetry/api'),
    imp('@opentelemetry/sdk-trace-node'),
    imp('@opentelemetry/sdk-metrics'),
    imp('@opentelemetry/exporter-trace-otlp-http'),
    imp('@opentelemetry/exporter-metrics-otlp-http'),
    imp('@opentelemetry/resources'),
    imp('@opentelemetry/semantic-conventions'),
  ]);
  return { api, sdkTraceNode, sdkMetrics, traceExporter, metricsExporter, resources, semconv };
}

/**
 * Initialise the OTel SDK for traces + metrics and return a small adapter
 * that maps DCP telemetry events to OTel spans and histograms/counters.
 *
 * @throws if any of the optional `@opentelemetry/*` packages are missing.
 *         The error message names the packages to install.
 */
export async function initOtlp(config: DcpTelemetryConfig, sdkVersion: string): Promise<OtlpHandles> {
  let api: OtelImport;
  let sdkTraceNode: OtelImport;
  let sdkMetrics: OtelImport;
  let traceExporter: OtelImport;
  let metricsExporter: OtelImport;
  let resources: OtelImport;
  let semconv: OtelImport;

  try {
    ({ api, sdkTraceNode, sdkMetrics, traceExporter, metricsExporter, resources, semconv } = await tryLoadOtel());
  } catch (err) {
    throw new Error(
      '[DCP-AI Telemetry] OTLP exporter requires the optional OpenTelemetry packages. Install them with:\n' +
        '  npm install @opentelemetry/api @opentelemetry/sdk-trace-node @opentelemetry/sdk-metrics ' +
        '@opentelemetry/exporter-trace-otlp-http @opentelemetry/exporter-metrics-otlp-http ' +
        '@opentelemetry/resources @opentelemetry/semantic-conventions\n' +
        `Underlying error: ${(err as Error).message}`,
    );
  }

  const endpoint = config.otlpEndpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318';
  const traceUrl = endpoint.replace(/\/+$/, '') + '/v1/traces';
  const metricsUrl = endpoint.replace(/\/+$/, '') + '/v1/metrics';

  const resource = new resources.Resource({
    [semconv.SEMRESATTRS_SERVICE_NAME]: config.serviceName,
    [semconv.SEMRESATTRS_SERVICE_VERSION]: sdkVersion,
  });

  const tracerProvider = new sdkTraceNode.NodeTracerProvider({ resource });
  tracerProvider.addSpanProcessor(
    new sdkTraceNode.BatchSpanProcessor(new traceExporter.OTLPTraceExporter({ url: traceUrl })),
  );
  tracerProvider.register();

  const metricReader = new sdkMetrics.PeriodicExportingMetricReader({
    exporter: new metricsExporter.OTLPMetricExporter({ url: metricsUrl }),
    exportIntervalMillis: config.metricsInterval ?? 15_000,
  });
  const meterProvider = new sdkMetrics.MeterProvider({ resource, readers: [metricReader] });
  api.metrics.setGlobalMeterProvider(meterProvider);

  const tracer = api.trace.getTracer('@dcp-ai/sdk', sdkVersion);
  const meter = api.metrics.getMeter('@dcp-ai/sdk', sdkVersion);

  // Pre-create the histograms + counters we know we emit. Creating them lazily
  // inside handleEvent() would also work, but this is cheaper and matches
  // OTel best practice.
  const histograms: HistogramMap = new Map();
  const counters: CounterMap = new Map();
  const histogram = (name: string, unit = 'ms') => {
    const existing = histograms.get(name);
    if (existing) return existing;
    const h = meter.createHistogram(name, { unit, description: `DCP-AI ${name}` });
    histograms.set(name, h);
    return h;
  };
  const counter = (name: string) => {
    const existing = counters.get(name);
    if (existing) return existing;
    const c = meter.createCounter(name, { description: `DCP-AI ${name}` });
    counters.set(name, c);
    return c;
  };

  // Active OTel spans, keyed by our internal DcpSpan.name + startTime pair.
  // Because dcpTelemetry.emit fires on endSpan (we receive the fully-terminated
  // span), we do not need to track anything here — we create+end the OTel span
  // in one step using startActiveSpan with the measured duration attached as an
  // attribute. That's simpler and faster than maintaining a parallel span map.

  function handleEvent(event: TelemetryEvent): void {
    try {
      if (event.type === 'span') {
        const span = (event as any).span as { name: string; attributes: Record<string, unknown>; status: 'ok' | 'error'; error?: string };
        const durationMs = (event as any).durationMs as number;
        // Create and immediately end an OTel span carrying the full duration.
        const otelSpan = tracer.startSpan(span.name, {
          attributes: { ...span.attributes, 'dcp.duration_ms': durationMs },
          startTime: new Date(Date.now() - durationMs),
        });
        if (span.status === 'error') {
          otelSpan.setStatus({ code: api.SpanStatusCode.ERROR, message: span.error ?? 'error' });
        } else {
          otelSpan.setStatus({ code: api.SpanStatusCode.OK });
        }
        otelSpan.end();
        return;
      }

      if (event.type === 'metric') {
        const name = String((event as any).name);
        const value = Number((event as any).value);
        const labels = (event as any).labels as Record<string, string> | undefined;
        const attrs = labels ?? {};
        switch (name) {
          case 'sign_latency_ms':
            histogram('dcp.sign.latency_ms').record(value, attrs);
            counter('dcp.signatures.created').add(1, attrs);
            return;
          case 'verify_latency_ms':
            histogram('dcp.verify.latency_ms').record(value, attrs);
            counter('dcp.signatures.verified').add(1, attrs);
            return;
          case 'kem_latency_ms':
            histogram('dcp.kem.latency_ms').record(value, attrs);
            return;
          case 'checkpoint_latency_ms':
            histogram('dcp.checkpoint.latency_ms').record(value, attrs);
            return;
          case 'bundle_verify_ms':
            histogram('dcp.bundle_verify.latency_ms').record(value, attrs);
            counter('dcp.bundles.verified').add(1, attrs);
            return;
          case 'a2a_sessions_total':
            counter('dcp.a2a.sessions').add(1, attrs);
            return;
          default:
            // Unknown metric name — record on a generic histogram with the name as an attr.
            histogram('dcp.metric').record(value, { ...attrs, name });
            return;
        }
      }

      if (event.type === 'error') {
        const operation = String((event as any).operation);
        counter('dcp.errors').add(1, { operation });
        return;
      }
      // 'init' and anything else: no-op for OTel.
    } catch {
      // Telemetry must never break the application.
    }
  }

  async function shutdown(): Promise<void> {
    try {
      await metricReader.shutdown();
    } catch {
      /* ignore */
    }
    try {
      await tracerProvider.shutdown();
    } catch {
      /* ignore */
    }
  }

  return { handleEvent, shutdown };
}
