<sub>[English](OBSERVABILITY.md) · **中文** · [Español](OBSERVABILITY.es.md) · [日本語](OBSERVABILITY.ja.md) · [Português](OBSERVABILITY.pt-BR.md)</sub>

# 可观测性 — OpenTelemetry 集成

自 2.1.0 版本起，所有四个核心 SDK (**TypeScript、Python、Rust、Go**) 都可以向任何兼容 OpenTelemetry 的后端发射**追踪和指标**。如果你运行 Grafana、Jaeger、Honeycomb、Datadog、New Relic 或自托管的 OTel Collector，你不需要任何自定义桥接 —— DCP-AI 直接讲 OTLP。

本页记录了你需要知道的三件事：

1. 遥测 API 如何映射到 OTel 跨度 (OpenTelemetry 跨度) 与指标。
2. 如何开启 OTLP（TypeScript 和 Python）。
3. 针对常见后端的三个复制粘贴配方。

---

## SDK 发射什么

| DCP 操作 | OTel 原语 | 指标名称 |
|---|---|---|
| `startSpan` / `endSpan` | 跨度 (OpenTelemetry 跨度) | `dcp.<span-name>`（属性：`dcp.service`、`dcp.duration_ms`、以及你附加的任何属性） |
| `recordSignLatency(ms, alg)` | 直方图 + 计数器 | `dcp.sign.latency_ms` + `dcp.signatures.created` |
| `recordVerifyLatency(ms, alg)` | 直方图 + 计数器 | `dcp.verify.latency_ms` + `dcp.signatures.verified` |
| `recordKemLatency(ms, op)` | 直方图 | `dcp.kem.latency_ms`（属性 `operation=encapsulate\|decapsulate`） |
| `recordCheckpointLatency(ms, tier)` | 直方图 | `dcp.checkpoint.latency_ms`（属性 `tier=routine\|standard\|elevated\|maximum`） |
| `recordBundleVerify(ms, success, tier)` | 直方图 + 计数器 | `dcp.bundle_verify.latency_ms` + `dcp.bundles.verified` |
| `recordCacheHit` / `recordCacheMiss` | 内存中计数器（通过 `getMetricsSummary` 暴露） | 摘要中的 `cacheHitRate` |
| `recordA2ASession` / `recordA2AMessage` | 计数器 | `dcp.a2a.sessions` / `dcp.a2a.messages` |
| `recordError(op, err)` | 计数器 + 跨度状态 | `dcp.errors`（属性 `operation`） |

每次导出都会随附的资源属性：
- `service.name` → 传入 `init()` 的 `serviceName` 值
- `service.version` → `@dcp-ai/sdk` / `dcp-ai` 包的版本

---

## 开启方法

### TypeScript

在 SDK 之上安装可选的 OTel 包：

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

在你的应用中接入（六行）：

```typescript
import { dcpTelemetry } from '@dcp-ai/sdk';

await dcpTelemetry.init({
  serviceName: 'my-agent',
  enabled: true,
  exporterType: 'otlp',
  otlpEndpoint: 'http://localhost:4318',   // or OTEL_EXPORTER_OTLP_ENDPOINT env var
});
```

当 `exporterType === 'otlp'` 时，`init()` 调用返回一个 Promise。你不必 await —— 在 OTel 栈就绪前发射的事件仍会填充内存指标与 `onEvent` 监听器扇出 —— 但 await 可以保证不会从 OTLP 导出中丢失任何事件。

如果你忘记安装某个 OTel 包，`init()` 会在监听器总线上发射一个清晰的错误事件（可通过 `dcpTelemetry.onEvent` 订阅看到），其中包含你仍然需要的确切包名。SDK 继续工作；仅 OTLP 转发被禁用。

关闭时，刷新挂起的导出：

```typescript
await dcpTelemetry.shutdown();
```

### Python

在 SDK 之上安装 OTLP 额外依赖：

```bash
pip install 'dcp-ai[otlp]'
```

在你的应用中接入：

```python
from dcp_ai import dcp_telemetry

dcp_telemetry.init(
    service_name="my-agent",
    enabled=True,
    exporter_type="otlp",
    otlp_endpoint="http://localhost:4318",  # or OTEL_EXPORTER_OTLP_ENDPOINT env var
)
```

与 TypeScript 有相同的保证：默认安装很精简，OTel 包仅在你切换到 `exporter_type="otlp"` 时才会被延迟导入，缺失的依赖会以错误事件的形式浮现，而不是导致应用崩溃。

### Rust

启用可选的 `otlp` Cargo 特性：

```toml
[dependencies]
dcp-ai = { version = "2.1", features = ["otlp"] }
```

在你的应用中接入：

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

OTLP 桥接在 Tokio 多线程运行时上运行；在进程退出前调用 `dcp_telemetry().shutdown()` 以刷新挂起的导出。如果不启用 `otlp` 特性，请求 `ExporterType::Otlp` 会通过 `on_event` 发射一个清晰的错误事件，且记录器仍会填充内存中的 `MetricsSummary`。

### Go

使用 `otlp` 构建标签构建你的二进制：

```bash
go build -tags otlp ./...
```

在你的应用中接入：

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

`go.opentelemetry.io/otel` 包列于 `go.mod` 中，但 OTLP 桥接文件由 `//go:build otlp` 控制 —— 默认 (`go build`) 二进制不会链接 OTel 运行时。没有该标签时，选择 `ExporterOTLP` 会通过监听器总线发射一个 `otlp_init` 错误事件；内存指标仍然工作。

---

## 配方

### 1. 本地 Jaeger（免费、docker、30 秒）

```bash
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest

# In your app: otlpEndpoint: 'http://localhost:4318'
```

打开 http://localhost:16686 —— 你将在你设置的服务名下看到追踪。

### 2. Grafana Cloud（托管，免费层）

1. 在 Grafana Cloud 中创建一个 OpenTelemetry 端点 (Observability → OpenTelemetry → Create integration)。你将得到一个 URL 和一个 API 令牌。
2. 在你的应用中：

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

当省略 `otlpEndpoint` 时，SDK 会读取 `OTEL_EXPORTER_OTLP_ENDPOINT` 作为回退。

---

## 停用路径

- `exporterType: 'none'`（或完全不调用 `init`）：零开销、零导出、记录器为空操作。
- `exporterType: 'console'`：每个事件以 JSON 形式打印到 stdout。适用于无 collector 的开发环境。
- `enabled: false`：一切短路，甚至 `onEvent` 监听器也不会收到任何内容。

---

## 配套工具

无论 OTLP 开关如何，`dcpTelemetry.onEvent(listener)` 通道始终可用，因此你也可以构建自己的桥接 —— 到 websocket 调试器、结构化日志文件或自定义仪表板。有关模式，请参阅 [快速开始](QUICKSTART.md) 的 "Live events" 部分。
