<sub>[English](OBSERVABILITY.md) · [中文](OBSERVABILITY.zh-CN.md) · [Español](OBSERVABILITY.es.md) · **日本語** · [Português](OBSERVABILITY.pt-BR.md)</sub>

# 可観測性 — OpenTelemetry 統合

2.1.0リリース以降、4つのコアSDKすべて (**TypeScript、Python、Rust、Go**) が、任意のOpenTelemetry互換バックエンドに**トレースとメトリクス**を送出できるようになりました。Grafana、Jaeger、Honeycomb、Datadog、New Relic、またはセルフホストされたOTel Collectorを運用している場合、カスタムブリッジは不要です — DCP-AIは直接OTLPを話します。

このページでは、知っておくべき3つのことを説明します。

1. テレメトリーAPIがOTelスパンおよびメトリクスにどのようにマッピングされるか。
2. OTLPを有効にする方法 (TypeScriptとPython)。
3. 一般的なバックエンド向けの3つのコピペ可能なレシピ。

---

## SDKが送出するもの

| DCP操作 | OTelプリミティブ | メトリック名 |
|---|---|---|
| `startSpan` / `endSpan` | スパン | `dcp.<span-name>` (属性: `dcp.service`、`dcp.duration_ms`、任意に添付したもの) |
| `recordSignLatency(ms, alg)` | ヒストグラム + カウンター | `dcp.sign.latency_ms` + `dcp.signatures.created` |
| `recordVerifyLatency(ms, alg)` | ヒストグラム + カウンター | `dcp.verify.latency_ms` + `dcp.signatures.verified` |
| `recordKemLatency(ms, op)` | ヒストグラム | `dcp.kem.latency_ms` (属性 `operation=encapsulate\|decapsulate`) |
| `recordCheckpointLatency(ms, tier)` | ヒストグラム | `dcp.checkpoint.latency_ms` (属性 `tier=routine\|standard\|elevated\|maximum`) |
| `recordBundleVerify(ms, success, tier)` | ヒストグラム + カウンター | `dcp.bundle_verify.latency_ms` + `dcp.bundles.verified` |
| `recordCacheHit` / `recordCacheMiss` | インメモリカウンター (`getMetricsSummary` 経由で公開) | サマリー内の `cacheHitRate` |
| `recordA2ASession` / `recordA2AMessage` | カウンター | `dcp.a2a.sessions` / `dcp.a2a.messages` |
| `recordError(op, err)` | カウンター + スパンステータス | `dcp.errors` (属性 `operation`) |

すべてのエクスポートに送信されるリソース属性:
- `service.name` → `init()` に渡された `serviceName` の値
- `service.version` → `@dcp-ai/sdk` / `dcp-ai` パッケージのバージョン

---

## 有効化する方法

### TypeScript

SDKに加えて、オプションのOTelパッケージをインストールしてください。

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

アプリに組み込む (6行):

```typescript
import { dcpTelemetry } from '@dcp-ai/sdk';

await dcpTelemetry.init({
  serviceName: 'my-agent',
  enabled: true,
  exporterType: 'otlp',
  otlpEndpoint: 'http://localhost:4318',   // or OTEL_EXPORTER_OTLP_ENDPOINT env var
});
```

`exporterType === 'otlp'` のとき、`init()` 呼び出しはPromiseを返します。awaitする必要はありません — OTelスタックが準備される前に送出されたイベントでも、インメモリメトリクスと `onEvent` リスナーのファンアウトは依然として更新されます — ただしawaitすることで、OTLPエクスポートからイベントが1つも欠落しないことが保証されます。

OTelパッケージのいずれかのインストールを忘れた場合、`init()` はリスナーバスに明確なエラーイベントを送出します (`dcpTelemetry.onEvent` で購読すれば確認できます)。エラーには、まだ必要なパッケージの正確な名前が含まれます。SDK自体は動作を続け、OTLPフォワーディングだけが無効化されます。

シャットダウン時に保留中のエクスポートをフラッシュしてください。

```typescript
await dcpTelemetry.shutdown();
```

### Python

SDKに加えてOTLPエクストラをインストールしてください。

```bash
pip install 'dcp-ai[otlp]'
```

アプリに組み込む:

```python
from dcp_ai import dcp_telemetry

dcp_telemetry.init(
    service_name="my-agent",
    enabled=True,
    exporter_type="otlp",
    otlp_endpoint="http://localhost:4318",  # or OTEL_EXPORTER_OTLP_ENDPOINT env var
)
```

TypeScriptと同じ保証: デフォルトインストールはスリムで、OTelパッケージは `exporter_type="otlp"` に切り替えた場合にのみ遅延的にインポートされます。依存関係の欠落は、アプリケーションをクラッシュさせるのではなく、エラーイベントとして表面化します。

### Rust

オプションの `otlp` Cargoフィーチャーを有効にしてください。

```toml
[dependencies]
dcp-ai = { version = "2.1", features = ["otlp"] }
```

アプリに組み込む:

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

OTLPブリッジはTokioマルチスレッドランタイム上で動作します。プロセス終了前に `dcp_telemetry().shutdown()` を呼び出して、保留中のエクスポートをフラッシュしてください。`otlp` フィーチャーなしで `ExporterType::Otlp` を要求した場合、`on_event` 経由で明確なエラーイベントが送出され、レコーダーはインメモリの `MetricsSummary` を引き続き更新します。

### Go

バイナリを `otlp` ビルドタグ付きでビルドしてください。

```bash
go build -tags otlp ./...
```

アプリに組み込む:

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

`go.opentelemetry.io/otel` パッケージは `go.mod` に列挙されていますが、OTLPブリッジファイルは `//go:build otlp` でゲートされています — デフォルト (`go build`) のバイナリはOTelランタイムをリンクしません。タグなしで `ExporterOTLP` を選択すると、リスナーバスを通じて `otlp_init` エラーイベントが送出されます。インメモリメトリクスは引き続き動作します。

---

## レシピ

### 1. ローカルJaeger (無料、Docker、30秒)

```bash
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest

# In your app: otlpEndpoint: 'http://localhost:4318'
```

http://localhost:16686 を開くと、設定したサービス名の下でトレースを見ることができます。

### 2. Grafana Cloud (マネージド、無料ティアあり)

1. Grafana Cloudで、OpenTelemetryエンドポイントを作成します (Observability → OpenTelemetry → Create integration)。URLとAPIトークンが発行されます。
2. アプリに以下を組み込みます。

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

`otlpEndpoint` が省略された場合、SDKはフォールバックとして `OTEL_EXPORTER_OTLP_ENDPOINT` を読み取ります。

---

## オプトアウトの経路

- `exporterType: 'none'` (または `init` 呼び出し自体を行わない): オーバーヘッドゼロ、エクスポートなし、レコーダーはno-opになります。
- `exporterType: 'console'`: 各イベントはJSONとしてstdoutに出力されます。Collectorを起動せずに開発したい場合に便利です。
- `enabled: false`: すべてが短絡され、`onEvent` リスナーですら何も受信しません。

---

## コンパニオンツール

`dcpTelemetry.onEvent(listener)` チャネルは、OTLPがオンかオフかに関係なく常に利用可能です。そのため、独自のブリッジ — websocketデバッガ、構造化ログファイル、またはカスタムダッシュボードへの — を構築することもできます。パターンについては [クイックスタート](QUICKSTART.md) の「Live events」セクションを参照してください。
