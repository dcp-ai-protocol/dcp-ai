<sub>**English** · [中文](../i18n/zh-CN/docs/OBSERVABILITY.md) · [Español](../i18n/es/docs/OBSERVABILITY.md) · [日本語](../i18n/ja/docs/OBSERVABILITY.md) · [Português](../i18n/pt-BR/docs/OBSERVABILITY.md)</sub>

# Observability — OpenTelemetry integration

As of the 2.1.0 release all four core SDKs (**TypeScript, Python, Rust, Go**) can emit **traces and metrics** to any OpenTelemetry-compatible backend. If you run Grafana, Jaeger, Honeycomb, Datadog, New Relic, or a self-hosted OTel Collector, you don't need any custom bridge — DCP-AI talks OTLP directly.

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

Install the optional OTel packages on top of the SDK (`@dcp-ai/sdk` here is the published version; with the SDK
built from a checkout, install only the `@opentelemetry/*` packages):

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

With telemetry enabled, `init()` returns a Promise when `exporterType === 'otlp'`. Events emitted before successful OTLP initialization still update in-memory metrics and reach `onEvent` listeners, but are not replayed to OTLP. Await initialization before emitting events you want forwarded. Register an error listener beforehand: a resolved Promise alone does not confirm success, because initialization failures are reported as error events. Awaiting initialization does not guarantee export delivery; that also depends on the exporter and backend.

If you forget to install one of the OTel packages, `init()` emits a clear error event on the listener bus (you can see it by subscribing with `dcpTelemetry.onEvent`) with an installation command listing the optional OTel packages. The SDK keeps working; only the OTLP forwarding is disabled.

On shutdown, flush pending exports:

```typescript
await dcpTelemetry.shutdown();
```

### Python

Install the OTLP extra on top of the SDK (the published version; from a checkout,
`pip install -e "/path/to/dcp-ai/sdks/python[otlp]"`):

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

### Rust

Enable the optional `otlp` Cargo feature:

```toml
[dependencies]
dcp-ai = { version = "2.11.0", features = ["otlp"] }
```

Wire in your app:

```rust
use dcp_ai::observability::{dcp_telemetry, ExporterType, TelemetryConfig};

dcp_telemetry().init(TelemetryConfig {
    service_name: "my-agent".into(),
    enabled: true,
    exporter_type: ExporterType::Otlp,
    otlp_endpoint: Some("http://localhost:4318".into()),
    ..Default::default()
});
```

The OTLP bridge exports from background threads (batch span processor and periodic metric reader over a blocking HTTP client), so it needs no Tokio runtime; call `dcp_telemetry().shutdown()` before your process exits to flush pending exports. Without the `otlp` feature, requesting `ExporterType::Otlp` emits a clear error event via `on_event` and recorders continue to populate the in-memory `MetricsSummary`.

### Go

Build your binary with the `otlp` build tag:

```bash
go build -tags otlp ./...
```

Wire in your app:

```go
import (
    "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/observability"
)

observability.Default().Init(observability.Config{
    ServiceName:  "my-agent",
    Enabled:      true,
    ExporterType: observability.ExporterOTLP,
    OTLPEndpoint: "http://localhost:4318",
})
defer observability.Default().Shutdown()
```

The `go.opentelemetry.io/otel` packages are listed in `go.mod` but the OTLP bridge file is gated by `//go:build otlp` — default (`go build`) binaries do not link the OTel runtime. Without the tag, selecting `ExporterOTLP` emits an `otlp_init` error event through the listener bus; the in-memory metrics still work.

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

- No `init` call, or `enabled: false`: telemetry is off (the default); recorders return at once and `onEvent`
  listeners receive nothing.
- `exporterType: 'none'` with `enabled: true`: nothing is exported, but the in-memory metrics
  (`getMetricsSummary`) and the `onEvent` listeners still work.
- `exporterType: 'console'`: each event is also printed to stdout as `[DCP-AI Telemetry] <JSON>`. Useful in
  development without running a collector.

---

## Companion tools

The `dcpTelemetry.onEvent(listener)` channel stays available whether OTLP is on or off, so you can also build your own bridge — to a websocket debugger, a structured log file, or a custom dashboard. The [Quick Start](QUICKSTART.md#6-telemetry--observability) shows the telemetry API, and the
[API reference](API_REFERENCE.md#dcptelemetryoneventlistener) the listener.
