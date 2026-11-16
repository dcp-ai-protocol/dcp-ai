<sub>[English](../../../docs/OBSERVABILITY.md) · [中文](../../zh-CN/docs/OBSERVABILITY.md) · **Español** · [日本語](../../ja/docs/OBSERVABILITY.md) · [Português](../../pt-BR/docs/OBSERVABILITY.md)</sub>

<a id="observability--opentelemetry-integration"></a>
<a id="observability-opentelemetry-integration"></a>

# Observabilidad — integración con OpenTelemetry

> Traducción informativa de [la versión en inglés](../../../docs/OBSERVABILITY.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Desde la versión 2.1.0, los cuatro SDK principales (**TypeScript, Python, Rust, Go**) pueden emitir **trazas y métricas** a cualquier backend compatible con OpenTelemetry. Si usas Grafana, Jaeger, Honeycomb, Datadog, New Relic o un OTel Collector autoalojado, no necesitas ningún puente a medida: DCP-AI habla OTLP directamente.

Esta página documenta las tres cosas que necesitas saber:

1. Cómo se corresponde la API de telemetría con los spans y las métricas de OTel.
2. Cómo activar OTLP (TypeScript y Python).
3. Tres recetas para copiar y pegar con backends habituales.

---

<a id="what-the-sdk-emits"></a>

## Qué emite el SDK

| Operación DCP | Primitiva de OTel | Nombre de la métrica |
|---|---|---|
| `startSpan` / `endSpan` | Span | `dcp.<span-name>` (atributos: `dcp.service`, `dcp.duration_ms` y los que añadas) |
| `recordSignLatency(ms, alg)` | Histograma + contador | `dcp.sign.latency_ms` + `dcp.signatures.created` |
| `recordVerifyLatency(ms, alg)` | Histograma + contador | `dcp.verify.latency_ms` + `dcp.signatures.verified` |
| `recordKemLatency(ms, op)` | Histograma | `dcp.kem.latency_ms` (atributo `operation=encapsulate\|decapsulate`) |
| `recordCheckpointLatency(ms, tier)` | Histograma | `dcp.checkpoint.latency_ms` (atributo `tier=routine\|standard\|elevated\|maximum`) |
| `recordBundleVerify(ms, success, tier)` | Histograma + contador | `dcp.bundle_verify.latency_ms` + `dcp.bundles.verified` |
| `recordCacheHit` / `recordCacheMiss` | Contadores en memoria (expuestos mediante `getMetricsSummary`) | `cacheHitRate` en el resumen |
| `recordA2ASession` / `recordA2AMessage` | Contador | `dcp.a2a.sessions` / `dcp.a2a.messages` |
| `recordError(op, err)` | Contador + estado del span | `dcp.errors` (atributo `operation`) |

Atributos de recurso enviados con cada exportación:
- `service.name` → valor de `serviceName` pasado a `init()`
- `service.version` → versión del paquete `@dcp-ai/sdk` / `dcp-ai`

---

<a id="turning-it-on"></a>

## Activarla

### TypeScript

Instala los paquetes opcionales de OTel además del SDK (aquí `@dcp-ai/sdk` es la versión publicada; con el SDK
compilado desde una copia del repositorio, instala solo los paquetes `@opentelemetry/*`):

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

Con la telemetría activada, `init()` devuelve una Promise cuando `exporterType === 'otlp'`. Los eventos emitidos antes de que la inicialización de OTLP termine correctamente siguen actualizando las métricas en memoria y llegando a los listeners de `onEvent`, pero no se reenvían después a OTLP. Espera la inicialización antes de emitir los eventos que quieras reenviar. Registra antes un listener de errores: una Promise resuelta por sí sola no confirma el éxito, porque los fallos de inicialización se notifican mediante eventos de error. Esperar la inicialización no garantiza la entrega de las exportaciones; esta también depende del exportador y del backend.

Si olvidas instalar alguno de los paquetes de OTel, `init()` emite un evento de error claro en el bus de listeners (puedes verlo suscribiéndote con `dcpTelemetry.onEvent`) con un comando de instalación que enumera los paquetes opcionales de OTel. El SDK sigue funcionando; solo se desactiva el reenvío por OTLP.

Al cerrar, vacía las exportaciones pendientes:

```typescript
await dcpTelemetry.shutdown();
```

### Python

Instala el extra de OTLP además del SDK (la versión publicada; desde una copia del repositorio,
`pip install -e "/path/to/dcp-ai/sdks/python[otlp]"`):

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

Las mismas garantías que en TypeScript: la instalación por defecto es ligera, los paquetes de OTel se importan de forma diferida solo cuando pones `exporter_type="otlp"`, y una dependencia que falta aparece como evento de error en lugar de hacer caer la aplicación.

### Rust

Activa la feature opcional de Cargo `otlp`:

```toml
[dependencies]
dcp-ai = { version = "2.11.0", features = ["otlp"] }
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

El puente OTLP exporta desde hilos en segundo plano (procesador de spans por lotes y lector periódico de métricas sobre un cliente HTTP bloqueante), así que no necesita un runtime de Tokio; llama a `dcp_telemetry().shutdown()` antes de que termine el proceso para vaciar las exportaciones pendientes. Sin la feature `otlp`, pedir `ExporterType::Otlp` emite un evento de error claro mediante `on_event`, y los registradores siguen alimentando el `MetricsSummary` en memoria.

### Go

Compila tu binario con la etiqueta de compilación `otlp`:

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

Los paquetes `go.opentelemetry.io/otel` figuran en `go.mod`, pero el archivo del puente OTLP está condicionado por `//go:build otlp`: los binarios por defecto (`go build`) no enlazan el runtime de OTel. Sin la etiqueta, elegir `ExporterOTLP` emite un evento de error `otlp_init` por el bus de listeners; las métricas en memoria siguen funcionando.

---

<a id="recipes"></a>

## Recetas

<a id="1-local-jaeger-free-docker-30-seconds"></a>

### 1. Jaeger local (gratis, docker, 30 segundos)

```bash
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest

# In your app: otlpEndpoint: 'http://localhost:4318'
```

Abre http://localhost:16686: verás trazas con el nombre de servicio que configuraste.

<a id="2-grafana-cloud-managed-free-tier"></a>

### 2. Grafana Cloud (gestionado, nivel gratuito)

1. En Grafana Cloud, crea un endpoint de OpenTelemetry (Observability → OpenTelemetry → Create integration). Obtendrás una URL y un token de API.
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

El SDK lee `OTEL_EXPORTER_OTLP_ENDPOINT` como alternativa cuando se omite `otlpEndpoint`.

---

<a id="opt-out-paths"></a>

## Formas de desactivarla

- Sin llamada a `init`, o con `enabled: false`: la telemetría está desactivada (el valor por defecto); los registradores retornan de inmediato y los
  listeners de `onEvent` no reciben nada.
- `exporterType: 'none'` con `enabled: true`: no se exporta nada, pero las métricas en memoria
  (`getMetricsSummary`) y los listeners de `onEvent` siguen funcionando.
- `exporterType: 'console'`: cada evento se imprime además en stdout como `[DCP-AI Telemetry] <JSON>`. Útil durante
  el desarrollo sin ejecutar un collector.

---

<a id="companion-tools"></a>

## Herramientas complementarias

El canal `dcpTelemetry.onEvent(listener)` sigue disponible tanto si OTLP está activado como si no, así que también puedes construir tu propio puente: hacia un depurador por websocket, un archivo de log estructurado o un panel a medida. El [Inicio rápido](../../../docs/QUICKSTART.md#6-telemetry--observability) muestra la API de telemetría, y la
[referencia de la API](../../../docs/API_REFERENCE.md#dcptelemetryoneventlistener), el listener.
