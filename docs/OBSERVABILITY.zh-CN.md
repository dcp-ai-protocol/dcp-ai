<sub>[English](OBSERVABILITY.md) · **中文** · [Español](OBSERVABILITY.es.md) · [日本語](OBSERVABILITY.ja.md) · [Português](OBSERVABILITY.pt-BR.md)</sub>

<a id="observability--opentelemetry-integration"></a>
<a id="observability-opentelemetry-integration"></a>

# 可观测性 — OpenTelemetry 集成

> 本文是[英文版](OBSERVABILITY.md)的参考译文，更新于 25/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

自 2.1.0 版本起，全部四个核心 SDK（**TypeScript、Python、Rust、Go**）都可以向任何兼容 OpenTelemetry 的后端发送**追踪和指标**。如果你使用 Grafana、Jaeger、Honeycomb、Datadog、New Relic 或自托管的 OTel Collector，就不需要任何自定义桥接：DCP-AI 直接使用 OTLP。

本页说明你需要了解的三件事：

1. 遥测 API 如何映射到 OTel 的 span 和指标。
2. 如何开启 OTLP（TypeScript 和 Python）。
3. 面向常见后端的三个可直接复制使用的示例。

---

<a id="what-the-sdk-emits"></a>

## SDK 会发送什么

| DCP 操作 | OTel 原语 | 指标名称 |
|---|---|---|
| `startSpan` / `endSpan` | Span | `dcp.<span-name>`（属性：`dcp.service`、`dcp.duration_ms` 以及你附加的任何属性） |
| `recordSignLatency(ms, alg)` | 直方图 + 计数器 | `dcp.sign.latency_ms` + `dcp.signatures.created` |
| `recordVerifyLatency(ms, alg)` | 直方图 + 计数器 | `dcp.verify.latency_ms` + `dcp.signatures.verified` |
| `recordKemLatency(ms, op)` | 直方图 | `dcp.kem.latency_ms`（属性 `operation=encapsulate\|decapsulate`） |
| `recordCheckpointLatency(ms, tier)` | 直方图 | `dcp.checkpoint.latency_ms`（属性 `tier=routine\|standard\|elevated\|maximum`） |
| `recordBundleVerify(ms, success, tier)` | 直方图 + 计数器 | `dcp.bundle_verify.latency_ms` + `dcp.bundles.verified` |
| `recordCacheHit` / `recordCacheMiss` | 内存计数器（通过 `getMetricsSummary` 公开） | 摘要中的 `cacheHitRate` |
| `recordA2ASession` / `recordA2AMessage` | 计数器 | `dcp.a2a.sessions` / `dcp.a2a.messages` |
| `recordError(op, err)` | 计数器 + span 状态 | `dcp.errors`（属性 `operation`） |

每次导出都会附带的资源属性：
- `service.name` → 传给 `init()` 的 `serviceName` 的值
- `service.version` → `@dcp-ai/sdk` / `dcp-ai` 软件包的版本

---

<a id="turning-it-on"></a>

## 开启方法

### TypeScript

在 SDK 之外安装可选的 OTel 软件包（这里的 `@dcp-ai/sdk` 是已发布的版本；使用从检出副本
构建的 SDK 时，只需安装 `@opentelemetry/*` 软件包）：

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

启用遥测时，如果 `exporterType === 'otlp'`，`init()` 会返回一个 Promise。在 OTLP 成功初始化之前发出的事件仍会更新内存指标并传给 `onEvent` 监听器，但之后不会重新发送到 OTLP。请先 await 初始化，再发出需要转发的事件。应提前注册错误监听器：Promise 正常完成本身并不能确认初始化成功，因为初始化失败会通过错误事件报告。等待初始化并不保证导出数据送达；这还取决于导出器和后端。

如果忘了安装某个 OTel 软件包，`init()` 会在监听器总线上发出一个清晰的错误事件（用 `dcpTelemetry.onEvent` 订阅即可看到），其中包含可选 OTel 软件包的安装命令。SDK 会继续工作，只是 OTLP 转发被禁用。

关闭时，请刷新待处理的导出：

```typescript
await dcpTelemetry.shutdown();
```

### Python

在 SDK 之外安装 OTLP extra（已发布的版本；从检出副本安装时为
`pip install -e "/path/to/dcp-ai/sdks/python[otlp]"`）：

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

保证与 TypeScript 相同：默认安装很精简，只有在你设置 `exporter_type="otlp"` 时才会惰性导入 OTel 软件包，缺少依赖时会以错误事件的形式出现，而不会导致应用崩溃。

### Rust

启用可选的 Cargo 特性 `otlp`：

```toml
[dependencies]
dcp-ai = { version = "2.11.0", features = ["otlp"] }
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

OTLP 桥接从后台线程导出（基于阻塞式 HTTP 客户端的批量 span 处理器和周期性指标读取器），因此不需要 Tokio 运行时；请在进程退出前调用 `dcp_telemetry().shutdown()` 以刷新待处理的导出。没有 `otlp` 特性时，请求 `ExporterType::Otlp` 会通过 `on_event` 发出一个清晰的错误事件，记录函数则继续填充内存中的 `MetricsSummary`。

### Go

使用 `otlp` 构建标签构建你的二进制文件：

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

`go.opentelemetry.io/otel` 软件包列在 `go.mod` 中，但 OTLP 桥接文件受 `//go:build otlp` 约束：默认（`go build`）构建的二进制文件不会链接 OTel 运行时。不带该标签时，选择 `ExporterOTLP` 会通过监听器总线发出 `otlp_init` 错误事件；内存指标仍然可用。

---

<a id="recipes"></a>

## 示例

<a id="1-local-jaeger-free-docker-30-seconds"></a>

### 1. 本地 Jaeger（免费，docker，30 秒）

```bash
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest

# In your app: otlpEndpoint: 'http://localhost:4318'
```

打开 http://localhost:16686，即可看到你所设置的服务名下的追踪。

<a id="2-grafana-cloud-managed-free-tier"></a>

### 2. Grafana Cloud（托管，免费层）

1. 在 Grafana Cloud 中创建一个 OpenTelemetry 端点（Observability → OpenTelemetry → Create integration）。你会得到一个 URL 和一个 API 令牌。
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

省略 `otlpEndpoint` 时，SDK 会回退读取 `OTEL_EXPORTER_OTLP_ENDPOINT`。

---

<a id="opt-out-paths"></a>

## 关闭方式

- 不调用 `init`，或 `enabled: false`：遥测关闭（默认）；记录函数会立即返回，`onEvent`
  监听器收不到任何内容。
- `enabled: true` 且 `exporterType: 'none'`：不导出任何内容，但内存指标
  （`getMetricsSummary`）和 `onEvent` 监听器仍然可用。
- `exporterType: 'console'`：每个事件还会以 `[DCP-AI Telemetry] <JSON>` 的形式打印到 stdout。适合在
  不运行 collector 的情况下进行开发。

---

<a id="companion-tools"></a>

## 配套工具

无论 OTLP 是否开启，`dcpTelemetry.onEvent(listener)` 通道都可用，因此你也可以构建自己的桥接：连接到 websocket 调试器、结构化日志文件或自定义仪表板。[快速开始](QUICKSTART.md#6-telemetry--observability)展示了遥测 API，
[API 参考](API_REFERENCE.md#dcptelemetryoneventlistener)介绍了监听器。
