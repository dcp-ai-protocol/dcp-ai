<sub>[English](../../../docs/OBSERVABILITY.md) · [中文](../../zh-CN/docs/OBSERVABILITY.md) · [Español](../../es/docs/OBSERVABILITY.md) · [日本語](../../ja/docs/OBSERVABILITY.md) · **Português**</sub>

<a id="observability--opentelemetry-integration"></a>
<a id="observability-opentelemetry-integration"></a>

# Observabilidade — integração com OpenTelemetry

> Tradução informativa da [versão em inglês](../../../docs/OBSERVABILITY.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

A partir da versão 2.1.0, os quatro SDKs principais (**TypeScript, Python, Rust, Go**) podem emitir **rastros e métricas** para qualquer backend compatível com OpenTelemetry. Se você usa Grafana, Jaeger, Honeycomb, Datadog, New Relic ou um OTel Collector auto-hospedado, não precisa de nenhuma ponte personalizada: o DCP-AI fala OTLP diretamente.

Esta página documenta as três coisas que você precisa saber:

1. Como a API de telemetria se mapeia para spans e métricas do OTel.
2. Como ativar o OTLP (TypeScript e Python).
3. Três receitas para copiar e colar com backends comuns.

---

<a id="what-the-sdk-emits"></a>

## O que o SDK emite

| Operação DCP | Primitiva do OTel | Nome da métrica |
|---|---|---|
| `startSpan` / `endSpan` | Span | `dcp.<span-name>` (atributos: `dcp.service`, `dcp.duration_ms` e os que você anexar) |
| `recordSignLatency(ms, alg)` | Histograma + contador | `dcp.sign.latency_ms` + `dcp.signatures.created` |
| `recordVerifyLatency(ms, alg)` | Histograma + contador | `dcp.verify.latency_ms` + `dcp.signatures.verified` |
| `recordKemLatency(ms, op)` | Histograma | `dcp.kem.latency_ms` (atributo `operation=encapsulate\|decapsulate`) |
| `recordCheckpointLatency(ms, tier)` | Histograma | `dcp.checkpoint.latency_ms` (atributo `tier=routine\|standard\|elevated\|maximum`) |
| `recordBundleVerify(ms, success, tier)` | Histograma + contador | `dcp.bundle_verify.latency_ms` + `dcp.bundles.verified` |
| `recordCacheHit` / `recordCacheMiss` | Contadores em memória (expostos via `getMetricsSummary`) | `cacheHitRate` no resumo |
| `recordA2ASession` / `recordA2AMessage` | Contador | `dcp.a2a.sessions` / `dcp.a2a.messages` |
| `recordError(op, err)` | Contador + status do span | `dcp.errors` (atributo `operation`) |

Atributos de recurso enviados em cada exportação:
- `service.name` → valor de `serviceName` passado para `init()`
- `service.version` → versão do pacote `@dcp-ai/sdk` / `dcp-ai`

---

<a id="turning-it-on"></a>

## Como ativar

### TypeScript

Instale os pacotes opcionais do OTel além do SDK (aqui `@dcp-ai/sdk` é a versão publicada; com o SDK
compilado a partir de uma cópia do repositório, instale apenas os pacotes `@opentelemetry/*`):

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

Com a telemetria ativada, `init()` retorna uma Promise quando `exporterType === 'otlp'`. Os eventos emitidos antes de a inicialização do OTLP terminar com sucesso continuam atualizando as métricas em memória e chegando aos listeners de `onEvent`, mas não são reenviados depois ao OTLP. Aguarde a inicialização antes de emitir os eventos que quiser encaminhar. Registre antes um listener de erros: uma Promise resolvida, por si só, não confirma o sucesso, pois falhas na inicialização são notificadas por eventos de erro. Aguardar a inicialização não garante a entrega das exportações; ela também depende do exportador e do backend.

Se você esquecer de instalar algum dos pacotes do OTel, `init()` emite um evento de erro claro no barramento de listeners (você pode vê-lo assinando com `dcpTelemetry.onEvent`) com um comando de instalação que lista os pacotes opcionais do OTel. O SDK continua funcionando; só o encaminhamento por OTLP fica desativado.

No encerramento, descarregue as exportações pendentes:

```typescript
await dcpTelemetry.shutdown();
```

### Python

Instale o extra de OTLP além do SDK (a versão publicada; a partir de uma cópia do repositório,
`pip install -e "/path/to/dcp-ai/sdks/python[otlp]"`):

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

As mesmas garantias do TypeScript: a instalação padrão é enxuta, os pacotes do OTel só são importados de forma preguiçosa quando você define `exporter_type="otlp"`, e uma dependência ausente aparece como evento de erro em vez de derrubar a aplicação.

### Rust

Ative a feature opcional `otlp` do Cargo:

```toml
[dependencies]
dcp-ai = { version = "2.11.0", features = ["otlp"] }
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

A ponte OTLP exporta a partir de threads em segundo plano (processador de spans em lote e leitor periódico de métricas sobre um cliente HTTP bloqueante), então não precisa de um runtime Tokio; chame `dcp_telemetry().shutdown()` antes de o processo terminar para descarregar as exportações pendentes. Sem a feature `otlp`, pedir `ExporterType::Otlp` emite um evento de erro claro via `on_event`, e os registradores continuam alimentando o `MetricsSummary` em memória.

### Go

Compile o binário com a build tag `otlp`:

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

Os pacotes `go.opentelemetry.io/otel` constam no `go.mod`, mas o arquivo da ponte OTLP é condicionado por `//go:build otlp`: os binários padrão (`go build`) não vinculam o runtime do OTel. Sem a tag, selecionar `ExporterOTLP` emite um evento de erro `otlp_init` pelo barramento de listeners; as métricas em memória continuam funcionando.

---

<a id="recipes"></a>

## Receitas

<a id="1-local-jaeger-free-docker-30-seconds"></a>

### 1. Jaeger local (grátis, docker, 30 segundos)

```bash
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest

# In your app: otlpEndpoint: 'http://localhost:4318'
```

Abra http://localhost:16686: você verá rastros sob o nome de serviço que definiu.

<a id="2-grafana-cloud-managed-free-tier"></a>

### 2. Grafana Cloud (gerenciado, nível gratuito)

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

O SDK lê `OTEL_EXPORTER_OTLP_ENDPOINT` como alternativa quando `otlpEndpoint` é omitido.

---

<a id="opt-out-paths"></a>

## Formas de desativar

- Sem chamada a `init`, ou com `enabled: false`: a telemetria fica desativada (o padrão); os registradores retornam imediatamente e os
  listeners de `onEvent` não recebem nada.
- `exporterType: 'none'` com `enabled: true`: nada é exportado, mas as métricas em memória
  (`getMetricsSummary`) e os listeners de `onEvent` continuam funcionando.
- `exporterType: 'console'`: cada evento também é impresso no stdout como `[DCP-AI Telemetry] <JSON>`. Útil durante
  o desenvolvimento sem executar um collector.

---

<a id="companion-tools"></a>

## Ferramentas complementares

O canal `dcpTelemetry.onEvent(listener)` continua disponível com o OTLP ativado ou não, então você também pode construir sua própria ponte: para um depurador via websocket, um arquivo de log estruturado ou um painel personalizado. O [Início rápido](../../../docs/QUICKSTART.md#6-telemetry--observability) mostra a API de telemetria, e a
[referência da API](../../../docs/API_REFERENCE.md#dcptelemetryoneventlistener), o listener.
