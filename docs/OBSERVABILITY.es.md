<sub>[English](OBSERVABILITY.md) · [中文](OBSERVABILITY.zh-CN.md) · **Español** · [日本語](OBSERVABILITY.ja.md) · [Português](OBSERVABILITY.pt-BR.md)</sub>

# Observabilidad — Integración con OpenTelemetry

A partir del release 2.1.0, los cuatro SDKs core (**TypeScript, Python, Rust, Go**) pueden emitir **trazas y métricas** a cualquier backend compatible con OpenTelemetry. Si corres Grafana, Jaeger, Honeycomb, Datadog, New Relic o un OTel Collector auto-hospedado, no necesitas ningún puente personalizado — DCP-AI habla OTLP directamente.

Esta página documenta las tres cosas que necesitas saber:

1. Cómo la API de telemetría se mapea a spans y métricas de OTel.
2. Cómo activar OTLP (TypeScript y Python).
3. Tres recetas copy-paste para backends comunes.

---

## Qué emite el SDK

| Operación DCP | Primitiva OTel | Nombre de métrica |
|---|---|---|
| `startSpan` / `endSpan` | Span | `dcp.<span-name>` (atributos: `dcp.service`, `dcp.duration_ms`, cualquiera que adjuntes) |
| `recordSignLatency(ms, alg)` | Histograma + Contador | `dcp.sign.latency_ms` + `dcp.signatures.created` |
| `recordVerifyLatency(ms, alg)` | Histograma + Contador | `dcp.verify.latency_ms` + `dcp.signatures.verified` |
| `recordKemLatency(ms, op)` | Histograma | `dcp.kem.latency_ms` (atributo `operation=encapsulate\|decapsulate`) |
| `recordCheckpointLatency(ms, tier)` | Histograma | `dcp.checkpoint.latency_ms` (atributo `tier=routine\|standard\|elevated\|maximum`) |
| `recordBundleVerify(ms, success, tier)` | Histograma + Contador | `dcp.bundle_verify.latency_ms` + `dcp.bundles.verified` |
| `recordCacheHit` / `recordCacheMiss` | Contadores en memoria (expuestos vía `getMetricsSummary`) | `cacheHitRate` en el resumen |
| `recordA2ASession` / `recordA2AMessage` | Contador | `dcp.a2a.sessions` / `dcp.a2a.messages` |
| `recordError(op, err)` | Contador + estado del span | `dcp.errors` (atributo `operation`) |

Atributos de recurso enviados con cada exportación:
- `service.name` → valor de `serviceName` pasado a `init()`
- `service.version` → versión del paquete `@dcp-ai/sdk` / `dcp-ai`

---

## Activándolo

### TypeScript

Instala los paquetes opcionales de OTel sobre el SDK:

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

Conéctalo en tu aplicación (seis líneas):

```typescript
import { dcpTelemetry } from '@dcp-ai/sdk';

await dcpTelemetry.init({
  serviceName: 'my-agent',
  enabled: true,
  exporterType: 'otlp',
  otlpEndpoint: 'http://localhost:4318',   // or OTEL_EXPORTER_OTLP_ENDPOINT env var
});
```

La llamada `init()` devuelve una Promise cuando `exporterType === 'otlp'`. No tienes que esperarla — los eventos emitidos antes de que el stack de OTel esté listo aún poblan las métricas en memoria y la distribución del listener `onEvent` — pero esperarla garantiza que ningún evento sea descartado de la exportación OTLP.

Si olvidas instalar alguno de los paquetes OTel, `init()` emite un evento de error claro en el bus del listener (puedes verlo suscribiéndote con `dcpTelemetry.onEvent`) con los nombres exactos de los paquetes que todavía necesitas. El SDK sigue funcionando; solo el forwarding OTLP queda deshabilitado.

Al cierre, flushea las exportaciones pendientes:

```typescript
await dcpTelemetry.shutdown();
```

### Python

Instala el extra OTLP sobre el SDK:

```bash
pip install 'dcp-ai[otlp]'
```

Conéctalo en tu aplicación:

```python
from dcp_ai import dcp_telemetry

dcp_telemetry.init(
    service_name="my-agent",
    enabled=True,
    exporter_type="otlp",
    otlp_endpoint="http://localhost:4318",  # or OTEL_EXPORTER_OTLP_ENDPOINT env var
)
```

Mismas garantías que en TypeScript: la instalación por defecto es liviana, los paquetes OTel se importan perezosamente solo cuando pones `exporter_type="otlp"`, y una dependencia faltante aparece como un evento de error en lugar de un crash de la aplicación.

### Rust

Habilita el feature opcional `otlp` de Cargo:

```toml
[dependencies]
dcp-ai = { version = "2.1", features = ["otlp"] }
```

Conéctalo en tu aplicación:

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

El puente OTLP corre sobre un runtime multi-hilo de Tokio; llama a `dcp_telemetry().shutdown()` antes de que tu proceso termine para flushear exportaciones pendientes. Sin el feature `otlp`, solicitar `ExporterType::Otlp` emite un evento de error claro vía `on_event` y los recorders siguen poblando el `MetricsSummary` en memoria.

### Go

Construye tu binario con el build tag `otlp`:

```bash
go build -tags otlp ./...
```

Conéctalo en tu aplicación:

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

Los paquetes `go.opentelemetry.io/otel` están listados en `go.mod` pero el archivo del puente OTLP está gated por `//go:build otlp` — los binarios por defecto (`go build`) no linkean el runtime de OTel. Sin el tag, seleccionar `ExporterOTLP` emite un evento de error `otlp_init` a través del bus del listener; las métricas en memoria siguen funcionando.

---

## Recetas

### 1. Jaeger local (gratis, docker, 30 segundos)

```bash
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest

# In your app: otlpEndpoint: 'http://localhost:4318'
```

Abre http://localhost:16686 — verás las trazas bajo el nombre de servicio que configuraste.

### 2. Grafana Cloud (administrado, tier gratuito)

1. En Grafana Cloud, crea un endpoint OpenTelemetry (Observability → OpenTelemetry → Create integration). Obtendrás una URL y un token de API.
2. En tu aplicación:

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

El SDK lee `OTEL_EXPORTER_OTLP_ENDPOINT` como fallback cuando se omite `otlpEndpoint`.

---

## Rutas de opt-out

- `exporterType: 'none'` (o ninguna llamada a `init`): cero overhead, sin exportaciones, los recorders son no-ops.
- `exporterType: 'console'`: cada evento se imprime a stdout como JSON. Útil en desarrollo sin correr un collector.
- `enabled: false`: todo hace cortocircuito, incluso los listeners de `onEvent` no reciben nada.

---

## Herramientas complementarias

El canal `dcpTelemetry.onEvent(listener)` permanece disponible esté OTLP activado o no, así que también puedes construir tu propio puente — hacia un debugger por websocket, un archivo de log estructurado o un dashboard personalizado. Consulta la sección "Live events" del [Inicio Rápido](QUICKSTART.md) para los patrones.
