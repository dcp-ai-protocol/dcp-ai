<sub>[English](../../../../services/anchor/README.md) · [Español](../../../es/services/anchor/README.md) · [Português](../../../pt-BR/services/anchor/README.md) · **日本語** · [中文](../../../zh-CN/services/anchor/README.md)</sub>

<a id="anchoring-service"></a>

# アンカリングサービス

> [英語版](../../../../services/anchor/README.md)の参考訳です。更新日：2026年10月25日。相違がある場合は英語の原文が優先されます。識別子とコードブロック（コメントを含む）は原文のままです。

Citizenship Bundle のハッシュを L2 ブロックチェーン（Base、Arbitrum、Optimism）に、個別または Merkle ルート配下のバッチとしてアンカリングするための HTTP サービスです。現在はローカルに記録するだけです（以下の注記を参照）。

> **オンチェーン送信はまだ実装されていません。** ハッシュとバッチルートは
> `tx_hash: null`、`onchain: false` としてローカルに記録されます。サービスがトランザクションハッシュを捏造することはありません。
> `ANCHOR_RPC_URL`、`ANCHOR_PRIVATE_KEY`、`ANCHOR_CONTRACT` はまだ使用しません。状態はメモリ内にあります
> （[永続化](../../../../services/README.md#persistence)を参照）。

<a id="quickstart"></a>

## クイックスタート

```bash
# Start the service, from the repo root after installing the root dependencies
node services/anchor/index.js

# Or with Docker, from the repo root
docker compose -f docker/docker-compose.yml up anchor
```

サービスは既定で `http://localhost:3001` で待ち受けます。

<a id="endpoints"></a>

## エンドポイント

### `GET /health`

サービスのヘルスチェック。

```bash
curl http://localhost:3001/health
```

```json
{
  "ok": true,
  "service": "dcp-anchor",
  "mode": "batch",
  "pending": 0,
  "total_anchored": 5
}
```

`total_anchored` はハッシュ数ではなく、バッチごとのローカル記録数を数えます。正常という応答は、オンチェーン上の処理を示すものではありません。

### `POST /anchor`

アンカリングするバンドルハッシュを送信します。`sha256:` に続く64文字の小文字16進数で指定します（プレフィックスは任意）。それ以外の形式、または1 MBを超える本文には400を返します。

```bash
curl -X POST http://localhost:3001/anchor \
  -H "Content-Type: application/json" \
  -d '{"bundle_hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"}'
```

**個別モード** — ハッシュを直ちにローカルへ記録します。`anchored: true` は、このサービスに記録されたことを意味し、オンチェーン上にあることを意味しません（`onchain: false`、`tx_hash: null`）。

```json
{
  "anchored": true,
  "hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "count": 1,
  "timestamp": "2025-01-01T00:00:00.000Z",
  "tx_hash": null,
  "onchain": false,
  "chain": "base"
}
```

**バッチモード** — 受け入れてキューに追加します（HTTP 202）。

```json
{
  "accepted": true,
  "bundle_hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "position": 3,
  "hint": "Will be anchored in next batch (interval: 60000ms)"
}
```

### `GET /status/:hash`

アンカリングしたハッシュの状態を照会します。

```bash
curl http://localhost:3001/status/sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
```

```json
{
  "anchored": true,
  "hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "count": 1,
  "timestamp": "2025-01-01T00:00:00.000Z",
  "tx_hash": null,
  "onchain": false,
  "chain": "base"
}
```

まだアンカリングされておらず、保留中の場合：

```json
{
  "anchored": false,
  "pending": true
}
```

記録は、保存されているハッシュによってのみ取得できます。個別モードとハッシュ1個のバッチでは、送信したハッシュ（`sha256:` プレフィックス付き）です。複数ハッシュのバッチでは Merkle ルートだけなので、個々のハッシュへの応答は `{"anchored": false, "pending": false}` となります。ハッシュごとの包含証明はまだありません。保留中は、送信時の形式（プレフィックスあり／なし）のままハッシュを照合します。記録はメモリ内にあり、再起動で失われます。

### `GET /anchored`

アンカリング済みの記録をすべて列挙します。

```bash
curl http://localhost:3001/anchored
```

```json
{
  "records": [
    { "hash": "sha256:...", "count": 1, "timestamp": "...", "tx_hash": null, "onchain": false, "chain": "base" }
  ]
}
```

### `POST /flush`

保留中のバッチを強制的に処理します（バッチモードのみ）。運用者トークンが必要です。`OPERATOR_TOKEN` を設定していなければ、このエンドポイントはロックされたままです（401）。

```bash
curl -X POST http://localhost:3001/flush -H "Authorization: Bearer $OPERATOR_TOKEN"
```

```json
{ "flushed": true }
```

<a id="configuration"></a>

## 設定

<a id="environment-variables"></a>

### 環境変数

| 変数 | 既定値 | 説明 |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP ポート |
| `ANCHOR_MODE` | `"batch"` | アンカリングモード：`"individual"` または `"batch"` |
| `BATCH_INTERVAL_MS` | `60000` | 自動処理の間隔（ミリ秒、バッチモード） |
| `ANCHOR_RPC_URL` | — | L2 ノードの JSON-RPC URL（まだ使用せず、設定すると警告を記録する） |
| `ANCHOR_PRIVATE_KEY` | — | トランザクション署名用ウォレットの秘密鍵（まだ使用しない） |
| `ANCHOR_CONTRACT` | — | デプロイした DCPAnchor コントラクトのアドレス（まだ使用しない） |
| `ANCHOR_CHAIN` | `"base"` | チェーン識別子 |
| `OPERATOR_TOKEN` | — | `POST /flush` の Bearer トークン。未設定時はロック |

<a id="operating-modes"></a>

### 動作モード

**個別（`ANCHOR_MODE=individual`）：** 各ハッシュを直ちに個別のローカル記録として保存します。オンチェーン送信を接続した後は、それぞれが別のトランザクションになる想定です。

**バッチ（`ANCHOR_MODE=batch`）：** ハッシュを蓄積し、`BATCH_INTERVAL_MS` ミリ秒ごと、または `POST /flush` により直ちに、一つの Merkle ルートとして記録します。オンチェーン送信を接続した後は、バッチごとに一つのトランザクションになる想定です。

<a id="integration-with-dcpanchorsol"></a>

## DCPAnchor.sol との連携

接続後、サービスは `DCPAnchor.sol` スマートコントラクトと次のように連携する予定です。

- **個別モード：** `anchorBundle(bytes32 bundleHash)` を呼び出す
- **バッチモード：** 保留中のハッシュの Merkle ルートを計算し、`anchorBatch(bytes32 merkleRoot, uint256 count)` を呼び出す

コントラクトの詳細は [contracts/ethereum/README.md](../../../../contracts/ethereum/README.md) を参照してください。

<a id="development"></a>

## 開発

```bash
# Start in development mode, from the repo root
PORT=3001 ANCHOR_MODE=batch node services/anchor/index.js

# Test with curl
curl http://localhost:3001/health
curl -X POST http://localhost:3001/anchor \
  -H "Content-Type: application/json" \
  -d '{"bundle_hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"}'
```

<a id="license"></a>

## ライセンス

Apache-2.0
