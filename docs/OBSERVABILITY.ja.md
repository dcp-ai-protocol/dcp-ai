<sub>[English](OBSERVABILITY.md) · [中文](OBSERVABILITY.zh-CN.md) · [Español](OBSERVABILITY.es.md) · **日本語** · [Português](OBSERVABILITY.pt-BR.md)</sub>

<a id="observability--opentelemetry-integration"></a>
<a id="observability-opentelemetry-integration"></a>

# オブザーバビリティ — OpenTelemetry との統合

> [英語版](OBSERVABILITY.md)の参考訳です（25/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

2.1.0 のリリース以降、4 つのコア SDK（**TypeScript、Python、Rust、Go**）はすべて、OpenTelemetry 互換の任意のバックエンドに**トレースとメトリクス**を送れます。Grafana、Jaeger、Honeycomb、Datadog、New Relic、あるいはセルフホストの OTel Collector を使っていれば、独自のブリッジは必要ありません。DCP-AI は OTLP を直接話します。

このページでは、知っておくべき 3 つのことを説明します。

1. テレメトリー API が OTel のスパンとメトリクスにどう対応するか。
2. OTLP を有効にする方法（TypeScript と Python）。
3. よく使われるバックエンド向けの、コピーして使える 3 つのレシピ。

---

<a id="what-the-sdk-emits"></a>

## SDK が送るもの

| DCP の操作 | OTel のプリミティブ | メトリクス名 |
|---|---|---|
| `startSpan` / `endSpan` | スパン | `dcp.<span-name>`（属性：`dcp.service`、`dcp.duration_ms`、および付加した任意の属性） |
| `recordSignLatency(ms, alg)` | ヒストグラム + カウンター | `dcp.sign.latency_ms` + `dcp.signatures.created` |
| `recordVerifyLatency(ms, alg)` | ヒストグラム + カウンター | `dcp.verify.latency_ms` + `dcp.signatures.verified` |
| `recordKemLatency(ms, op)` | ヒストグラム | `dcp.kem.latency_ms`（属性 `operation=encapsulate\|decapsulate`） |
| `recordCheckpointLatency(ms, tier)` | ヒストグラム | `dcp.checkpoint.latency_ms`（属性 `tier=routine\|standard\|elevated\|maximum`） |
| `recordBundleVerify(ms, success, tier)` | ヒストグラム + カウンター | `dcp.bundle_verify.latency_ms` + `dcp.bundles.verified` |
| `recordCacheHit` / `recordCacheMiss` | メモリー内のカウンター（`getMetricsSummary` で公開） | 概要内の `cacheHitRate` |
| `recordA2ASession` / `recordA2AMessage` | カウンター | `dcp.a2a.sessions` / `dcp.a2a.messages` |
| `recordError(op, err)` | カウンター + スパンのステータス | `dcp.errors`（属性 `operation`） |

エクスポートのたびに送られるリソース属性：
- `service.name` → `init()` に渡した `serviceName` の値
- `service.version` → `@dcp-ai/sdk` / `dcp-ai` パッケージのバージョン

---

<a id="turning-it-on"></a>

## 有効にする

### TypeScript

SDK に加えて、オプションの OTel パッケージをインストールします（ここでの `@dcp-ai/sdk` は公開済みのバージョンです。チェックアウトから
ビルドした SDK を使う場合は、`@opentelemetry/*` パッケージだけをインストールします）。

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

アプリケーションに組み込みます（6 行）。

```typescript
import { dcpTelemetry } from '@dcp-ai/sdk';

await dcpTelemetry.init({
  serviceName: 'my-agent',
  enabled: true,
  exporterType: 'otlp',
  otlpEndpoint: 'http://localhost:4318',   // or OTEL_EXPORTER_OTLP_ENDPOINT env var
});
```

テレメトリーが有効な場合、`exporterType === 'otlp'` のときに `init()` は Promise を返します。OTLP の初期化が正常に完了する前に発生したイベントも、メモリー内のメトリクスを更新し、`onEvent` のリスナーに届きますが、後から OTLP に再送されることはありません。転送したいイベントを発生させる前に、初期化を await してください。エラーのリスナーは事前に登録してください。初期化の失敗はエラーイベントとして通知されるため、Promise が解決しただけでは成功を確認できません。初期化を待ってもエクスポートの配送は保証されず、エクスポーターとバックエンドにも依存します。

OTel のパッケージのどれかをインストールし忘れると、`init()` はリスナーのバスにわかりやすいエラーイベントを送ります（`dcpTelemetry.onEvent` で購読すると確認できます）。そこには、オプションの OTel パッケージを列挙したインストールコマンドが含まれます。SDK は動き続け、OTLP への転送だけが無効になります。

終了時には、保留中のエクスポートをフラッシュします。

```typescript
await dcpTelemetry.shutdown();
```

### Python

SDK に加えて OTLP の extra をインストールします（公開済みのバージョン。チェックアウトからの場合は
`pip install -e "/path/to/dcp-ai/sdks/python[otlp]"`）。

```bash
pip install 'dcp-ai[otlp]'
```

アプリケーションに組み込みます。

```python
from dcp_ai import dcp_telemetry

dcp_telemetry.init(
    service_name="my-agent",
    enabled=True,
    exporter_type="otlp",
    otlp_endpoint="http://localhost:4318",  # or OTEL_EXPORTER_OTLP_ENDPOINT env var
)
```

TypeScript と同じことが保証されます。既定のインストールは軽量で、OTel のパッケージは `exporter_type="otlp"` に切り替えたときにだけ遅延インポートされ、依存関係が欠けていてもアプリケーションはクラッシュせず、エラーイベントとして通知されます。

### Rust

オプションの Cargo フィーチャー `otlp` を有効にします。

```toml
[dependencies]
dcp-ai = { version = "2.10", features = ["otlp"] }
```

アプリケーションに組み込みます。

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

OTLP ブリッジはバックグラウンドのスレッドからエクスポートします（ブロッキング HTTP クライアント上のバッチスパンプロセッサーと定期的なメトリクスリーダー）。そのため Tokio のランタイムは不要です。保留中のエクスポートをフラッシュするには、プロセスの終了前に `dcp_telemetry().shutdown()` を呼んでください。`otlp` フィーチャーなしで `ExporterType::Otlp` を要求すると、`on_event` を通じてわかりやすいエラーイベントが送られ、記録関数はメモリー内の `MetricsSummary` を更新し続けます。

### Go

`otlp` ビルドタグを付けてバイナリをビルドします。

```bash
go build -tags otlp ./...
```

アプリケーションに組み込みます。

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

`go.opentelemetry.io/otel` のパッケージは `go.mod` に載っていますが、OTLP ブリッジのファイルは `//go:build otlp` で制限されています。既定の（`go build` の）バイナリは OTel のランタイムをリンクしません。タグなしで `ExporterOTLP` を選ぶと、リスナーのバスに `otlp_init` のエラーイベントが送られます。メモリー内のメトリクスは引き続き動作します。

---

<a id="recipes"></a>

## レシピ

<a id="1-local-jaeger-free-docker-30-seconds"></a>

### 1. ローカルの Jaeger（無料、docker、30 秒）

```bash
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest

# In your app: otlpEndpoint: 'http://localhost:4318'
```

http://localhost:16686 を開くと、設定したサービス名のもとにトレースが表示されます。

<a id="2-grafana-cloud-managed-free-tier"></a>

### 2. Grafana Cloud（マネージド、無料枠あり）

1. Grafana Cloud で OpenTelemetry のエンドポイントを作成します（Observability → OpenTelemetry → Create integration）。URL と API トークンが得られます。
2. アプリケーションでは次のようにします。

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

`otlpEndpoint` を省略した場合、SDK は代わりに `OTEL_EXPORTER_OTLP_ENDPOINT` を読み取ります。

---

<a id="opt-out-paths"></a>

## 無効にする方法

- `init` を呼ばない、または `enabled: false`：テレメトリーはオフです（既定）。記録関数はすぐに戻り、`onEvent` の
  リスナーには何も届きません。
- `enabled: true` で `exporterType: 'none'`：何もエクスポートされませんが、メモリー内のメトリクス
  （`getMetricsSummary`）と `onEvent` のリスナーは動作します。
- `exporterType: 'console'`：各イベントが `[DCP-AI Telemetry] <JSON>` として標準出力にも書き出されます。コレクターを動かさずに
  開発するときに便利です。

---

<a id="companion-tools"></a>

## 補助ツール

`dcpTelemetry.onEvent(listener)` のチャネルは、OTLP のオン・オフにかかわらず利用できるので、独自のブリッジも作れます。たとえば WebSocket のデバッガー、構造化ログのファイル、独自のダッシュボードなどです。テレメトリー API は[クイックスタート](QUICKSTART.md#6-telemetry--observability)に、
リスナーは [API リファレンス](API_REFERENCE.md#dcptelemetryoneventlistener)にあります。
