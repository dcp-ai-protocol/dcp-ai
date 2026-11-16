<sub>[English](../../../services/README.md) · [Español](../../es/services/README.md) · [Português](../../pt-BR/services/README.md) · **日本語** · [中文](../../zh-CN/services/README.md)</sub>

<a id="dcp-infrastructure-services"></a>

# DCP インフラストラクチャサービス

> [英語版](../../../services/README.md)の参考訳です。更新日：2026年10月25日。相違がある場合は英語の原文が優先されます。識別子とコードブロック（コメントを含む）は原文のままです。

DCP 参照 Gateway を補完するオプションの HTTP マイクロサービスです。各サービスは独立して動作し、個別にも、Docker Compose でまとめてもデプロイできます。

<a id="architecture"></a>

## アーキテクチャ

```
                        ┌─────────────────────┐
                        │  DCP Reference       │
                        │  Gateway (:3000)     │
                        │  Verification +      │
                        │  Key Registry +      │
                        │  Policy Engine       │
                        └──────────┬──────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                     │
    ┌─────────▼──────────┐  ┌─────▼──────────┐  ┌──────▼──────────┐
    │  Anchor Service    │  │ Transparency   │  │  Revocation     │
    │  (:3001)           │  │ Log (:3002)    │  │  Service (:3003)│
    │                    │  │                │  │                  │
    │  Bundle hash →     │  │ Append-only    │  │  V1: agent-level│
    │  Local records     │  │ Merkle tree +  │  │  V2: kid-level  │
    │  (L2 planned)      │  │ inclusion      │  │  + emergency    │
    │                    │  │ proofs         │  │  + short-lived  │
    └────────────────────┘  └────────────────┘  └─────────────────┘
```

<a id="services"></a>

## サービス

| サービス | ポート | 状態 | 説明 |
|---------|------|--------|-------------|
| [アンカリング](../../../services/anchor/README.md) | 3001 | 部分実装 | バンドルハッシュをローカルに記録し、L2 ブロックチェーンへのアンカリングを計画しています。Merkle バッチ処理はメモリ上で動作します。オンチェーン送信は未実装なので、記録の値は `tx_hash: null` です。 |
| [透明性ログ](../../../services/transparency-log/README.md) | 3002 | 動作可能 | CT 型の追記専用ログ。RFC 6962 Merkle 木、包含証明、Ed25519 で署名したツリーヘッドを提供します。メモリ内保存です。 |
| [失効](../../../services/revocation/README.md) | 3003 | 動作可能 | エージェントが署名済みパスポートで鍵を登録します。V1 のエージェント単位と V2 の kid 単位の失効には、その鍵による署名が必要です。緊急停止ボタンも備えます。既定ではメモリ内保存で、ファイルへの永続化はオプションです。 |

<a id="quick-start"></a>

## クイックスタート

```bash
# Run all services with Docker Compose
(cd docker && docker compose up)

# Or run individually from the root of a checkout, after building the workspace SDK
# and installing the root package (the revocation service imports @dcp-ai/sdk):
#   (cd sdks/typescript && npm install && npm run build) && npm install
node services/anchor/index.js
node services/transparency-log/index.js
node services/revocation/index.js
```

<a id="data-flow"></a>

## データフロー

1. **エージェントが登録**：Gateway（`POST /v2/passport/register`）で登録し、運用者が失効サービス（`POST /v2/register`、運用者トークン）にも登録します。どちらも自己署名したパスポートを使用します
2. **意図を宣言**し、ポリシーを評価します（`POST /v2/intent/declare`）
3. **バンドルを署名し検証**します（`POST /v2/bundle/verify`）
4. **ハッシュを送信**：アンカリングサービス（`POST /anchor`）でローカル記録またはバッチ処理を行います。オンチェーン送信は未実装です
5. **ハッシュをログに記録**：透明性ログ（`POST /add`）へ追加します
6. **失効を確認**してからバンドルを受け入れます。`GET /v2/check/kid/:kid` は `POST /v2/register` で登録した各 kid の個別失効、緊急失効、有効期限切れを確認し、それ以外の kid には404（`registered: false`、状態不明）を返します。`GET /check/:agent_id` はエージェント単位の失効を確認します。

<a id="authentication"></a>

## 認証

- **失効**の書き込みには署名があります。登録はパスポート自身の鍵、失効はエージェントに登録済みの鍵で署名します。読み取りには署名がありません。提供するリスト（`/list`、`/v2/list`、`/.well-known/dcp-revocations.json`）には署名がなく、検証器はサービスの URL と通信経路を信頼します。新しい `agent_id` の登録には運用者トークンも必要で、他者の ID の先取りを防ぎます。緊急失効には登録済みトークンの原像が必要です。
- **新しい `agent_id`** は運用者が Gateway（`POST /v2/passport/register`）と失効サービス（`POST /v2/register`）で登録します。再登録はエージェントの鍵で署名するセルフサービスです。
- **アンカリング**の `POST /flush` と**透明性ログ**の `POST /gossip/peers` には `Authorization: Bearer <OPERATOR_TOKEN>` が必要です。`OPERATOR_TOKEN` がなければロックされたままです。ログ自身がピアへアクセスするため、ピアリストを公開編集可能にすると、誰でも内部 URL にアクセスさせられてしまいます。
- リクエスト本文の上限は1 MBです。レート制限（登録、緊急失効、Gateway の POST）はソケットアドレスをキーとします。`TRUST_PROXY=true` は、クライアント IP を `X-Forwarded-For` に追記するプロキシの背後でのみ設定してください。
- レジストリが満杯になると、既存項目を追い出さず新規登録を拒否します（507）。失効サービスはエージェント数（`MAX_AGENTS`）、Gateway は鍵数（`MAX_REGISTERED_KEYS`、エージェントの全存続期間にわたる `MAX_KEYS_PER_AGENT`）を制限し、エージェントごとに退役した鍵を4個保持します。鍵と署名は、アルゴリズムごとの正確なサイズの正規 base64 でなければなりません。透明性ログは、鍵を固定したピアが署名するツリーヘッドだけを信頼します（`GOSSIP_PEERS=<url>#<key>`）。

<a id="persistence"></a>

## 永続化

既定では、各サービスは状態を**メモリ内**に保持します。永続化を設定しない限り、**状態は再起動を越えて保持されず**、デプロイ、クラッシュ、マシン停止でも失われます。

- **失効**：失効情報を失うとエージェントの失効が解除されたように扱われます。`REVOCATION_STATE_PATH` を設定すると、登録と失効をファイルに保存して再起動後も保持できます（Compose スタックはボリューム上でこれを設定します）。設定しない場合、`deploy/fly/revocation.toml` はアイドル時に状態が消えないようマシンを1台稼働させるだけで、デプロイ時には依然として失われます。
- **透明性ログ**：再起動すると新しい空の木になり、以前の STH と証明はその木に対応しなくなります。Fly 設定ではすでにマシン1台を稼働状態に保ちます。
- **アンカリング**：保留中のハッシュと記録は失われます。Fly 設定はまだゼロ台にスケールしますが、オンチェーンに何もアンカリングしていない間はオンチェーン記録への影響はありません。

本番環境では永続ストレージ（SQLite、PostgreSQL）を追加し、必要に応じて Fly ボリュームも使用してください。その他の制限：

- **アンカリング**：ethers.js と実際の L2 RPC エンドポイントを接続してください。`DCPAnchor.sol` コントラクトは `contracts/ethereum/` にあります。
- **失効**：高可用性のデプロイでは CRL（証明書失効リスト）や OCSP 型の配布を検討してください。

<a id="environment-variables"></a>

## 環境変数

設定の詳細は各サービスの README を参照してください。
- [アンカリング](../../../services/anchor/README.md#configuration)
- [透明性ログ](../../../services/transparency-log/README.md#configuration)
- [失効](../../../services/revocation/README.md#configuration)
