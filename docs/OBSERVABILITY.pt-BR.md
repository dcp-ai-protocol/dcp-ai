<sub>[English](OBSERVABILITY.md) · [中文](OBSERVABILITY.zh-CN.md) · [Español](OBSERVABILITY.es.md) · [日本語](OBSERVABILITY.ja.md) · **Português**</sub>

# Observabilidade — Integração com OpenTelemetry

A partir do release 2.1.0, todos os quatro SDKs core (**TypeScript, Python, Rust, Go**) podem emitir **traces e métricas** para qualquer backend compatível com OpenTelemetry. Se você usa Grafana, Jaeger, Honeycomb, Datadog, New Relic ou um OTel Collector self-hosted, você não precisa de nenhuma ponte customizada — o DCP-AI fala OTLP diretamente.

Esta página documenta as três coisas que você precisa saber:

1. Como a API de telemetria se mapeia em spans e métricas OTel.
2. Como ativar OTLP (TypeScript e Python).
3. Três receitas prontas para backends comuns.

---

## O que o SDK emite

| Operação DCP | Primitiva OTel | Nome da métrica |
|---|---|---|
| `startSpan` / `endSpan` | Span | `dcp.<span-name>` (atributos: `dcp.service`, `dcp.duration_ms`, mais quaisquer que você anexar) |
| `recordSignLatency(ms, alg)` | Histograma + Contador | `dcp.sign.latency_ms` + `dcp.signatures.created` |
| `recordVerifyLatency(ms, alg)` | Histograma + Contador | `dcp.verify.latency_ms` + `dcp.signatures.verified` |
| `recordKemLatency(ms, op)` | Histograma | `dcp.kem.latency_ms` (atributo `operation=encapsulate\|decapsulate`) |
| `recordCheckpointLatency(ms, tier)` | Histograma | `dcp.checkpoint.latency_ms` (atributo `tier=routine\|standard\|elevated\|maximum`) |
| `recordBundleVerify(ms, success, tier)` | Histograma + Contador | `dcp.bundle_verify.latency_ms` + `dcp.bundles.verified` |
| `recordCacheHit` / `recordCacheMiss` | Contadores em memória (expostos via `getMetricsSummary`) | `cacheHitRate` no sumário |
| `recordA2ASession` / `recordA2AMessage` | Contador | `dcp.a2a.sessions` / `dcp.a2a.messages` |
| `recordError(op, err)` | Contador + status do span | `dcp.errors` (atributo `operation`) |

Atributos de recurso enviados a cada export:
- `service.name` → valor de `serviceName` passado para `init()`
- `service.version` → versão do pacote `@dcp-ai/sdk` / `dcp-ai`

---

## Ativando

### TypeScript

Instale os pacotes OTel opcionais sobre o SDK:

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

Conecte na sua aplicação (seis linhas):

```typescript
import { dcpTelemetry } from '@dcp-ai/sdk';

await dcpTelemetry.init({
  serviceName: 'my-agent',
  enabled: true,
  exporterType: 'otlp',
  otlpEndpoint: 'http://localhost:4318',   // or OTEL_EXPORTER_OTLP_ENDPOINT env var
});
```

A chamada `init()` retorna uma Promise quando `exporterType === 'otlp'`. Você não precisa usar await — eventos emitidos antes de a stack OTel estar pronta ainda alimentam as métricas em memória e a distribuição do listener `onEvent` — mas dar await garante que nenhum evento seja descartado da exportação OTLP.

Se você esquecer de instalar um dos pacotes OTel, `init()` emite um evento de erro claro no barramento de listeners (você pode vê-lo subscrevendo com `dcpTelemetry.onEvent`) com os nomes exatos dos pacotes que ainda faltam. O SDK continua funcionando; somente o encaminhamento OTLP fica desabilitado.

Ao desligar, esvazie as exportações pendentes:

```typescript
await dcpTelemetry.shutdown();
```

### Python

Instale o extra OTLP sobre o SDK:

```bash
pip install 'dcp-ai[otlp]'
```

Conecte na sua aplicação:

```python
from dcp_ai import dcp_telemetry

dcp_telemetry.init(
    service_name="my-agent",
    enabled=True,
    exporter_type="otlp",
    otlp_endpoint="http://localhost:4318",  # or OTEL_EXPORTER_OTLP_ENDPOINT env var
)
```

Mesmas garantias do TypeScript: a instalação default é enxuta, os pacotes OTel são importados de forma preguiçosa apenas quando você aciona `exporter_type="otlp"`, e uma dependência ausente aparece como evento de erro em vez de derrubar a aplicação.

### Rust

Habilite a Cargo feature opcional `otlp`:

```toml
[dependencies]
dcp-ai = { version = "2.1", features = ["otlp"] }
```

Conecte na sua aplicação:

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

A ponte OTLP roda em um runtime multi-thread do Tokio; chame `dcp_telemetry().shutdown()` antes do seu processo sair para esvaziar exportações pendentes. Sem a feature `otlp`, solicitar `ExporterType::Otlp` emite um evento de erro claro via `on_event` e os recorders continuam a alimentar o `MetricsSummary` em memória.

### Go

Compile seu binário com a build tag `otlp`:

```bash
go build -tags otlp ./...
```

Conecte na sua aplicação:

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

Os pacotes `go.opentelemetry.io/otel` estão listados em `go.mod` mas o arquivo da ponte OTLP é protegido por `//go:build otlp` — binários default (`go build`) não fazem link do runtime OTel. Sem a tag, selecionar `ExporterOTLP` emite um evento de erro `otlp_init` pelo barramento de listeners; as métricas em memória continuam funcionando.

---

## Receitas

### 1. Jaeger local (grátis, docker, 30 segundos)

```bash
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest

# In your app: otlpEndpoint: 'http://localhost:4318'
```

Abra http://localhost:16686 — você verá traces sob o nome de serviço que você configurou.

### 2. Grafana Cloud (gerenciado, free tier)

1. No Grafana Cloud, crie um endpoint OpenTelemetry (Observability → OpenTelemetry → Create integration). Você receberá uma URL e um token de API.
2. Na sua aplicação:

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

O SDK lê `OTEL_EXPORTER_OTLP_ENDPOINT` como fallback quando `otlpEndpoint` é omitido.

---

## Caminhos de opt-out

- `exporterType: 'none'` (ou nenhuma chamada a `init`): zero overhead, nenhuma exportação, recorders são no-op.
- `exporterType: 'console'`: cada evento é impresso em stdout como JSON. Útil em desenvolvimento sem rodar um collector.
- `enabled: false`: tudo faz short-circuit, até os listeners de `onEvent` não recebem nada.

---

## Ferramentas companheiras

O canal `dcpTelemetry.onEvent(listener)` continua disponível com OTLP ligado ou desligado, então você também pode construir sua própria ponte — para um debugger websocket, um arquivo de log estruturado ou um dashboard customizado. Consulte a seção "Live events" do [Início Rápido](QUICKSTART.md) para padrões.
