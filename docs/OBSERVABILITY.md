# Observability — OpenTelemetry integration

As of `@dcp-ai/sdk` 2.1.0 (TypeScript) and `dcp-ai` 2.1.0 (Python), the SDKs can emit **traces and metrics** to any OpenTelemetry-compatible backend. If you run Grafana, Jaeger, Honeycomb, Datadog, New Relic, or a self-hosted OTel Collector, you don't need any custom bridge — DCP-AI talks OTLP directly.

This page documents the three things you need to know:

1. How the telemetry API maps to OTel spans and metrics.
2. How to turn OTLP on (TypeScript and Python).
3. Three copy-paste recipes for common backends.

---

## What the SDK emits

| DCP operation | OTel primitive | Metric name |
|---|---|---|
| `startSpan` / `endSpan` | Span | `dcp.<span-name>` (attributes: `dcp.service`, `dcp.duration_ms`, any you attach) |
| `recordSignLatency(ms, alg)` | Histogram + Counter | `dcp.sign.latency_ms` + `dcp.signatures.created` |
| `recordVerifyLatency(ms, alg)` | Histogram + Counter | `dcp.verify.latency_ms` + `dcp.signatures.verified` |
| `recordKemLatency(ms, op)` | Histogram | `dcp.kem.latency_ms` (attr `operation=encapsulate\|decapsulate`) |
| `recordCheckpointLatency(ms, tier)` | Histogram | `dcp.checkpoint.latency_ms` (attr `tier=routine\|standard\|elevated\|maximum`) |
| `recordBundleVerify(ms, success, tier)` | Histogram + Counter | `dcp.bundle_verify.latency_ms` + `dcp.bundles.verified` |
| `recordCacheHit` / `recordCacheMiss` | In-memory counters (exposed via `getMetricsSummary`) | `cacheHitRate` in summary |
| `recordA2ASession` / `recordA2AMessage` | Counter | `dcp.a2a.sessions` / `dcp.a2a.messages` |
| `recordError(op, err)` | Counter + span status | `dcp.errors` (attr `operation`) |

Resource attributes sent with every export:
- `service.name` → value of `serviceName` passed to `init()`
- `service.version` → version of the `@dcp-ai/sdk` / `dcp-ai` package

---

## Turning it on

### TypeScript

Install the optional OTel packages on top of the SDK:

```bash
npm install @dcp-ai/sdk \
  @opentelemetry/api \
  @opentelemetry/sdk-trace-node \
  @opentelemetry/sdk-metrics \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions
```

Wire in your app (six lines):

```typescript
import { dcpTelemetry } from '@dcp-ai/sdk';

await dcpTelemetry.init({
  serviceName: 'my-agent',
  enabled: true,
  exporterType: 'otlp',
  otlpEndpoint: 'http://localhost:4318',   // or OTEL_EXPORTER_OTLP_ENDPOINT env var
});
```

The `init()` call returns a Promise when `exporterType === 'otlp'`. You don't have to await it — events emitted before the OTel stack is ready still populate the in-memory metrics and the `onEvent` listener fan-out — but awaiting guarantees no events are dropped from the OTLP export.

If you forget to install one of the OTel packages, `init()` emits a clear error event on the listener bus (you can see it by subscribing with `dcpTelemetry.onEvent`) with the exact package names you still need. The SDK keeps working; only the OTLP forwarding is disabled.

On shutdown, flush pending exports:

```typescript
await dcpTelemetry.shutdown();
```

### Python

Install the OTLP extra on top of the SDK:

```bash
pip install 'dcp-ai[otlp]'
```

Wire in your app:

```python
from dcp_ai import dcp_telemetry

dcp_telemetry.init(
    service_name="my-agent",
    enabled=True,
    exporter_type="otlp",
    otlp_endpoint="http://localhost:4318",  # or OTEL_EXPORTER_OTLP_ENDPOINT env var
)
```

Same guarantees as TypeScript: default install is slim, OTel packages are imported lazily only when you flip `exporter_type="otlp"`, and a missing dependency surfaces as an error event rather than an application crash.

---

## Recipes

### 1. Local Jaeger (free, docker, 30 seconds)

```bash
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest

# In your app: otlpEndpoint: 'http://localhost:4318'
```

Open http://localhost:16686 — you'll see traces under the service name you set.

### 2. Grafana Cloud (managed, free tier)

1. In Grafana Cloud, create an OpenTelemetry endpoint (Observability → OpenTelemetry → Create integration). You'll get a URL and an API token.
2. In your app:

```typescript
await dcpTelemetry.init({
  serviceName: 'my-agent',
  enabled: true,
  exporterType: 'otlp',
  otlpEndpoint: 'https://<your-instance>.grafana.net/otlp',
});

// Export OTEL_EXPORTER_OTLP_HEADERS="authorization=Basic <base64 of instanceID:token>"
// in the shell that runs your app. The OTel SDK picks it up automatically.
```

### 3. Honeycomb

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io
export OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=<YOUR_API_KEY>
```

```typescript
await dcpTelemetry.init({
  serviceName: 'my-agent',
  enabled: true,
  exporterType: 'otlp',
});
```

The SDK reads `OTEL_EXPORTER_OTLP_ENDPOINT` as a fallback when `otlpEndpoint` is omitted.

---

## Opt-out paths

- `exporterType: 'none'` (or no `init` call at all): zero overhead, no exports, recorders are no-ops.
- `exporterType: 'console'`: each event is printed to stdout as JSON. Useful in development without running a collector.
- `enabled: false`: everything short-circuits, even `onEvent` listeners receive nothing.

---

## Companion tools

The `dcpTelemetry.onEvent(listener)` channel stays available whether OTLP is on or off, so you can also build your own bridge — to a websocket debugger, a structured log file, or a custom dashboard. See the "Live events" section of the [Quick Start](QUICKSTART.md) for patterns.
