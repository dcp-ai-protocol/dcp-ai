<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · **日本語** · [Português](README.pt-BR.md)</sub>

<a id="docker--dcp-infrastructure"></a>
<a id="docker-dcp-infrastructure"></a>

# Docker — DCP のインフラストラクチャ

> [英語版](README.md)の参考訳です（25/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

DCP のすべてのサービスをコンテナとしてデプロイするための Docker Compose の設定です。検証、アンカリング、透明性ログ、失効を含みます。

<a id="quickstart"></a>

## クイックスタート

```bash
cd docker
docker compose up
```

`docker compose up` はフォアグラウンドで動き続けます。以下の確認は 2 つ目のターミナルで実行するか、`docker compose up -d`
でスタックを起動してください。これにより、4 つのサービスが 5 つのコンテナ（2 つの透明性ログ）で起動します。

| コンテナ | ポート | 説明 |
|---------|------|-------------|
| **verification** | `3000` | バンドルの検証サーバー |
| **anchor** | `3001` | アンカリングサービス：ローカルの記録のみで、オンチェーンへの送信は実装されていません |
| **transparency-log-a** | `3002` | マークルの証明を伴う透明性ログ `log-alpha` |
| **transparency-log-b** | `3012` | `log-alpha` のゴシップのピアである透明性ログ `log-beta` |
| **revocation** | `3003` | エージェントの失効サービス |

<a id="verify-everything-is-running"></a>

### すべてが動いていることの確認

```bash
curl http://localhost:3000/health
curl http://localhost:3001/health
curl http://localhost:3002/health
curl http://localhost:3012/health
curl http://localhost:3003/health
```

正常な応答が意味するのは、プロセスが HTTP に応答することだけです。永続化、アンカリング、ゴシップは確認しません（ログの
`gossip_peers` は、固定の有無にかかわらず、設定されたピアの数を数えます）。

<a id="services"></a>

## サービス

### verification (`:3000`)

DCP（V1 + V2 + フェーズ 3）の Signed Bundle の検証サーバーです。以下の 2 つの検証リクエストはテンプレートで、`{...}` と
`...` は実際の署名付きバンドルを表すため、そのままでは動きません。このページの最後の完全な例では、代わりにテスト用の
フィクスチャを使います。

```bash
# V1 verification
curl -X POST http://localhost:3000/verify \
  -H "Content-Type: application/json" \
  -d '{"signed_bundle": {"bundle": {...}, "signature": {...}}, "public_key_b64": "..."}'

# V2 composite verification
curl -X POST http://localhost:3000/v2/bundle/verify \
  -H "Content-Type: application/json" \
  -d '{"signed_bundle": {"bundle": {"dcp_bundle_version":"2.0","manifest":{...},...}, "signature": {"composite_sig":{...},...}}}'

# Capability discovery
curl http://localhost:3000/.well-known/dcp-capabilities.json
```

### anchor (`:3001`)

ブロックチェーン向けのバンドルのハッシュのアンカリングサービスです。[services/anchor/README.md](../services/anchor/README.md) を参照してください。

### transparency-log (`:3002`)

包含証明を伴う追記専用の透明性ログです。[services/transparency-log/README.md](../services/transparency-log/README.md) を参照してください。

### revocation (`:3003`)

失効の公開と照会のサービスです。[services/revocation/README.md](../services/revocation/README.md) を参照してください。

<a id="configuration"></a>

## 設定

<a id="environment-variables"></a>

### 環境変数

各サービスは `docker-compose.yml` の環境変数で設定します。

#### verification

| 変数 | 既定値 | 説明 |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP のポート |
| `VERIFIER_MODE` | `hybrid_required` | V2 の検証モード |
| `ALLOW_V1_BUNDLES` | `true` | V1 形式のバンドルを受け入れる |
| `REQUIRE_SESSION_BINDING`、`REQUIRE_COMPOSITE_BINDING`、`MAX_KEY_AGE_DAYS`、`PQ_CHECKPOINT_INTERVAL`、`ADVISORY_POLL_INTERVAL_MS` | イメージとここで設定 | **サーバーはまだ読みません。** 組み込みのポリシー（セッションの結び付けと複合バインディングが必須、鍵の経過日数の閾値は 365 日）が適用され、`GET /v2/policy` で確認できます |

ゲートウェイの DCP-05 から DCP-09 のエンドポイントはトークン不要で、署名も検証しません。前段に独自の認可を置かずに、信頼できないクライアントにポート 3000 を公開しないでください（[docs/OPERATOR_GUIDE.md](../docs/OPERATOR_GUIDE.md#dcp-0509-service-endpoints)）。

#### anchor

| 変数 | 既定値 | 説明 |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP のポート |
| `ANCHOR_MODE` | `batch` | `"individual"` または `"batch"` |
| `BATCH_INTERVAL_MS` | `60000` | フラッシュの間隔（ms） |
| `ANCHOR_RPC_URL` | — | L2 ノードの JSON-RPC の URL |
| `ANCHOR_PRIVATE_KEY` | — | ウォレットの秘密鍵 |
| `ANCHOR_CONTRACT` | — | DCPAnchor のコントラクトのアドレス |
| `OPERATOR_TOKEN` | — | `POST /flush` の Bearer トークン（ホストの環境から渡されます） |

オンチェーンへの送信はまだ実装されていないため、3 つのチェーン用の `ANCHOR_*` の設定は使われません。

#### transparency-log

| 変数 | 既定値 | 説明 |
|----------|---------|-------------|
| `PORT` | `3002` | HTTP のポート |
| `LOG_ID` | 自動生成 | このログのインスタンスの一意な識別子 |
| `OPERATOR_KEY` | 一時的 | STH に署名する鍵の Ed25519 のシード：16 進数 64 文字（`openssl rand -hex 32`）、ログごとに 1 つ。それ以外ではサービスが停止します |
| `OPERATOR_TOKEN` | — | `POST /gossip/peers` の Bearer トークン（ホストの環境から渡されます） |
| `GOSSIP_PEERS` | — | カンマ区切りのピア。それぞれ `<endpoint>#<base64 Ed25519 public key>`（例：`http://log-b:3002#q1w2...`）。固定していないピアのツリーヘッドは無視されます |
| `GOSSIP_INTERVAL_MS` | `30000` | ゴシップの取得間隔（ミリ秒） |

Compose の 2 つのログにゴシップをさせるには、それぞれに固定の鍵を与え、相手の鍵を固定します。これは、ルートの依存関係を
インストールした状態で、リポジトリのルートから実行してください（ルートの `node_modules` の `tweetnacl` を使います）。ルートには
compose ファイルがないため、`-f` でこのファイルを指定します。

```bash
export TLOG_ALPHA_OPERATOR_KEY=$(openssl rand -hex 32) TLOG_BETA_OPERATOR_KEY=$(openssl rand -hex 32)
pub() { node -e 'const n = require("tweetnacl"); console.log(Buffer.from(n.sign.keyPair.fromSeed(Buffer.from(process.argv[1], "hex")).publicKey).toString("base64"))' "$1"; }
export TLOG_ALPHA_PUBLIC_KEY=$(pub $TLOG_ALPHA_OPERATOR_KEY) TLOG_BETA_PUBLIC_KEY=$(pub $TLOG_BETA_OPERATOR_KEY)
docker compose -f docker/docker-compose.yml up
```

ログはツリーをメモリに保持します。固定の `OPERATOR_KEY` を使えば再起動をまたいで同じ署名鍵を保てますが、再起動すると
引き続き空のツリーから始まります。

#### revocation

| 変数 | 既定値 | 説明 |
|----------|---------|-------------|
| `PORT` | `3003` | HTTP のポート |
| `TRUST_PROXY` | — | クライアントの IP を `X-Forwarded-For` に付け加えるプロキシの背後でだけ `true` |
| `REVOCATION_STATE_PATH` | メモリのみ | 追記専用の状態ファイル。この compose ファイルは、`revocation-data` ボリューム上の `/data/revocation-state.jsonl` を設定します |

検証と失効のサービスも `OPERATOR_TOKEN` を読みます。ゲートウェイの管理用のエンドポイントと、両方での新しい `agent_id` の
登録のためです。リポジトリのルートから `OPERATOR_TOKEN=$(openssl rand -hex 32) docker compose -f docker/docker-compose.yml up`
を実行するとロックが解除され、それがなければ 401 を返します。

状態：すべてのサービスは状態をメモリに保持し、再起動や `docker compose down` の後は空から始まりますが、**revocation は
例外**です。ここでは登録と失効が `revocation-data` ボリュームに書かれるため、再起動と `docker compose down` の後も残ります。
`docker compose down -v` はボリュームを削除し、それとともにそれらも消えます。

<a id="blockchain-anchoring-is-not-implemented"></a>

### ブロックチェーンへのアンカリングは実装されていません

アンカーサービスはオンチェーンには何も送信しません。`docker-compose.yml` でコメントアウトされている `ANCHOR_RPC_URL`、
`ANCHOR_PRIVATE_KEY`、`ANCHOR_CONTRACT` の設定は読まれない（`ANCHOR_RPC_URL` を設定しても警告がログに出るだけ）ため、そこに
ウォレットの鍵を置かないでください。記録はローカルのメモリに、`tx_hash: null` と `onchain: false` で残ります。

## Dockerfile

`Dockerfile` は、独立したターゲットを持つマルチステージのビルドを使います。

```
Base: node:20-alpine
├── verification  → node server/index.js        (port 3000)
├── anchor        → node services/anchor/index.js      (port 3001)
├── transparency-log → node services/transparency-log/index.js (port 3002)
└── revocation    → node services/revocation/index.js  (port 3003)
```

<a id="individual-build"></a>

### 個別のビルド

```bash
# Build a specific service (from the repo root: the build context is the repo)
docker build -f docker/Dockerfile --target anchor -t dcp-anchor .

# Run
docker run -p 3001:3001 -e ANCHOR_MODE=batch dcp-anchor
```

<a id="build-all"></a>

### すべてのビルド

```bash
# from the repo root
docker compose -f docker/docker-compose.yml build
```

<a id="health-checks"></a>

## ヘルスチェック

すべてのサービスにヘルスチェックが設定されています。

- **間隔：** 30 秒
- **タイムアウト：** 5 秒
- **再試行：** 3 回
- **コマンド：** `wget -qO- http://localhost:PORT/health`
- **再起動のポリシー：** `unless-stopped`

チェックに合格しても、プロセスが HTTP に応答することを意味するだけで、永続化、アンカリング、ゴシップ、本番への準備状況の
証拠にはなりません。

<a id="full-example--verify-a-bundle"></a>
<a id="full-example-verify-a-bundle"></a>

## 完全な例 — バンドルの検証

```bash
# Run from the repo root: the example files are under tests/.
# 1. Start services
docker compose -f docker/docker-compose.yml up -d

# 2. Verify a signed bundle (note: body must wrap in signed_bundle key)
curl -X POST http://localhost:3000/verify \
  -H "Content-Type: application/json" \
  -d "{\"signed_bundle\": $(cat tests/conformance/examples/citizenship_bundle.signed.json)}"

# 3. Take the bundle_hash the signature carries (computed over the canonical bundle) and anchor it
HASH=$(node -e 'console.log(require("./tests/conformance/examples/citizenship_bundle.signed.json").signature.bundle_hash)')
curl -X POST http://localhost:3001/anchor \
  -H "Content-Type: application/json" \
  -d "{\"bundle_hash\": \"$HASH\"}"

# 4. Add to transparency log (service on port 3002, route is /add)
curl -X POST http://localhost:3002/add \
  -H "Content-Type: application/json" \
  -d "{\"bundle_hash\": \"$HASH\"}"

# 5. Stop
docker compose -f docker/docker-compose.yml down
```

<a id="license"></a>

## ライセンス

Apache-2.0
