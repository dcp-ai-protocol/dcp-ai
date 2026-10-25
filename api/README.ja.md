<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · **日本語** · [Português](README.pt-BR.md)</sub>

<a id="api--openapi--protocol-buffers"></a>

# API — OpenAPI と Protocol Buffers

> [英語版](README.md)の参考訳です（25/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

DCP の API の正式な定義です。HTTP/REST 向けの OpenAPI 3.1 の仕様と、gRPC 向けの Protocol Buffers があります。これらの定義を使って、任意の言語でクライアントを生成できます。

対象範囲（2026 年 10 月 25 日）：

- `openapi.yaml` は、リファレンスのゲートウェイ（`server/`）と、アンカー、透明性ログ、失効の各サービスを記述します。`POST /v2/admit` とゲートウェイの DCP-05 から DCP-09 のエンドポイントは対象外です。それらについては [server/README.md](../server/README.md) と [docs/OPERATOR_GUIDE.md](../docs/OPERATOR_GUIDE.md) を参照してください。
- `proto/dcp.proto` は定義だけで、このリポジトリのどの gRPC のサーバーやクライアントもそれを実装していません。
- このリポジトリは、ホストされた DCP-AI の API を設定していません。`openapi.yaml` はローカルの開発用アドレスのほかに `https://api.dcp-ai.org` を挙げていますが、そこで宣言された URL は動作中のサービスの証拠ではなく、この説明はそれを確認も呼び出しもしません。対象はオペレーターが運用するサービスです。

<a id="files"></a>

## ファイル

| ファイル | 形式 | 説明 |
|------|--------|-------------|
| `openapi.yaml` | OpenAPI 3.1.0 | REST の仕様（V1 + V2 + フェーズ 3）。上記の対象外を除く |
| `proto/dcp.proto` | Protocol Buffers 3 | 5 つのサービスを持つ gRPC の定義 |

<a id="openapi-spec"></a>

## OpenAPI の仕様

<a id="servers"></a>

### サーバー

| 環境 | URL |
|-------------|-----|
| ゲートウェイ（ローカル） | `http://localhost:3000` |
| アンカーサービス（ローカル） | `http://localhost:3001` |
| 透明性ログ（ローカル） | `http://localhost:3002` |
| 失効サービス（ローカル） | `http://localhost:3003` |

<a id="endpoints"></a>

### エンドポイント

<a id="health--discovery"></a>
<a id="health-discovery"></a>

#### ヘルスと発見

| メソッド | パス | 説明 |
|--------|------|-------------|
| `GET /health` | ヘルスチェック | レスポンス：`{ ok, service, supported_versions }` |
| `GET /.well-known/dcp-capabilities.json` | ケイパビリティの発見 | レスポンス：サポートするバージョン、アルゴリズム、機能 |
| `GET /.well-known/algorithm-advisories.json` | アルゴリズムのアドバイザリー | レスポンス：`{ advisories }` |
| `GET /.well-known/governance-keys.json` | ガバナンスの鍵 | レスポンス：ガバナンスの鍵セット |

<a id="verification"></a>

#### 検証

| メソッド | パス | 説明 |
|--------|------|-------------|
| `POST /verify` | Signed Bundle を検証する（V1/V2 を自動判別） | リクエスト：`{ signed_bundle, public_key_b64? }` → レスポンス：`{ verified, dcp_version, errors, warnings }` |
| `POST /v2/bundle/verify` | ティアに応じた V2 の完全な検証（規範的な `SignedBundleV2` のみ。V1 のバンドルには 400） | レスポンスに `resolved_tier`、`verification_mode`、`session_binding_valid` が加わる |

<a id="v2-passport--keys"></a>
<a id="v2-passport-keys"></a>

#### V2：パスポートと鍵

| メソッド | パス | 説明 |
|--------|------|-------------|
| `POST /v2/passport/register` | エージェントのパスポートと鍵を登録する（新しい `agent_id` にはオペレーターのトークンが必要） | リクエスト：`{ signed_passport }`。複合の自己署名が検証できなければならない |
| `GET /v2/keys/{kid}` | 鍵のレジストリの照会 | レスポンス：`{ found, kid, key, agent_id }` |
| `POST /v2/keys/rotate` | 保有の証明を伴う鍵のローテーション | リクエスト：`KeyRotationRecord`（`{ old_kid, new_key, timestamp, proof_of_possession, authorization_sig }`） |

<a id="v2-intent--policy"></a>
<a id="v2-intent-policy"></a>

#### V2：意図とポリシー

| メソッド | パス | 説明 |
|--------|------|-------------|
| `POST /v2/intent/declare` | 意図を宣言し、ポリシーを得る | リクエスト：`{ signed_intent }`（その `composite_sig` は検証されない）→ レスポンス：`{ ok, policy_decision, security_tier, verification_mode, checkpoint_interval }` |
| `GET /v2/policy` | 現在の検証器のポリシー | レスポンス：`{ policy, policy_hash, mode }` |
| `POST /v2/policy/mode` | 検証器のモードを切り替える（オペレーターのトークン） | リクエスト：`{ mode }`（pq_only、hybrid_required など） |

<a id="v2-audit"></a>

#### V2：監査

| メソッド | パス | 説明 |
|--------|------|-------------|
| `POST /v2/audit/append` | 監査イベントを追加する | リクエスト：`{ audit_event }` |
| `POST /v2/audit/compact` | 監査証跡を圧縮する | リクエスト：`{ compaction }` |

<a id="v2-revocation--emergency"></a>
<a id="v2-revocation-emergency"></a>

#### V2：失効と緊急時

| メソッド | パス | 説明 |
|--------|------|-------------|
| `POST /v2/emergency-revoke` | 緊急失効（パニックボタン） | レート制限と原像の検証あり |
| `POST /v2/multi-party/authorize` | M-of-N のマルチパーティ承認 | リクエスト：`{ authorization }` |

<a id="v2-advisory--governance"></a>
<a id="v2-advisory-governance"></a>

#### V2：アドバイザリーとガバナンス

| メソッド | パス | 説明 |
|--------|------|-------------|
| `POST /v2/advisory/publish` | アルゴリズムのアドバイザリーを公開する（オペレーターのトークン） | リクエスト：`{ advisory }` |
| `GET /v2/advisory/check` | 有効なアドバイザリーを確認する | レスポンス：`{ deprecated, warned, revoked }` |
| `POST /v2/advisory/auto-apply` | アドバイザリーをポリシーに自動適用する（オペレーターのトークン） | 非推奨のアルゴリズムを削除し、代替を加える |
| `POST /v2/governance/register` | ガバナンスの鍵セットを登録する（オペレーターのトークン） | リクエスト：`{ governance_key_set }` |

<a id="anchoring"></a>

#### アンカリング

| メソッド | パス | 説明 |
|--------|------|-------------|
| `POST /anchor` | バンドルのハッシュをアンカーする | アンカーサービス（`:3001`）では：リクエスト `{ bundle_hash }` → レスポンス `{ anchored, chain, tx_hash }`（オンチェーンへの送信が実装されるまで `tx_hash: null`）、またはバッチモードでは 202。ゲートウェイ（`:3000`）では 501 |

<a id="revocation-service-on-port-3003"></a>

#### 失効（ポート 3003 のサービス）

`openapi.yaml` はこれらを、サービスをプロキシするゲートウェイが公開する形として `/revocations` の接頭辞の下に挙げています。リファレンスのゲートウェイはプロキシしないため、ポート 3003 の失効サービスを直接のパスで呼び出してください。

| メソッド | ゲートウェイのパス | 直接のパス（`:3003`） | 説明 |
|--------|-------------|----------------------|-------------|
| `GET` | `/revocations` | `/list` | 失効を一覧する |
| `POST` | `/revocations` | `/revoke` | 失効を公開する |
| `GET` | `/revocations/{agent_id}` | `/check/{agent_id}` | 失効の状態 |

<a id="transparency-log-service-on-port-3002"></a>

#### 透明性ログ（ポート 3002 のサービス）

`openapi.yaml` はこれらを、プロキシするゲートウェイが公開する形として `/transparency-log` の接頭辞の下に挙げています。リファレンスのゲートウェイはプロキシしないため、ポート 3002 のサービスを接頭辞なしで呼び出してください。

| メソッド | ゲートウェイのパス | 直接のパス（`:3002`） | 説明 |
|--------|-------------|----------------------|-------------|
| `POST` | `/transparency-log/add` | `/add` | エントリを追加する |
| `GET` | `/transparency-log/root` | `/root` | 現在のマークルルート |
| `GET` | `/transparency-log/proof/{index}` | `/proof/{index}` | 包含証明 |

<a id="main-schemas"></a>

### 主なスキーマ

- `SignedBundleV1` / `SignedBundleV2` — 署名付きバンドル（V1：Ed25519、V2：複合署名）
- `CitizenshipBundleV1` / `CitizenshipBundleV2` — Citizenship bundle。マニフェストと署名付きペイロードを持つのは V2 だけ
- `CompositeSignature` — バインディングのモードを持つクラシカル + PQ の署名
- `SignedPayload` — 個別に署名されたアーティファクトのエンベロープ
- `BundleManifest` — アーティファクトごとのハッシュとセッションの nonce を持つ V2 のマニフェスト
- `VerificationResult` — `verified`、`errors`、`warnings`、`verifier_policy_hash`、`resolved_tier` を持つ結果
- `KeyEntryV2` — kid、alg、状態を持つ V2 の鍵のエントリ
- `PolicyDecisionV2` — リスクスコアとセキュリティティアを持つ V2 のポリシー判断
- `VerifierPolicy` — 検証器のポリシーの設定
- `AlgorithmAdvisory` — アルゴリズムの非推奨化や失効のアドバイザリー
- `GovernanceKeySet` — 閾値を持つガバナンスの鍵セット
- `AnchorReceipt` — アンカリングの受領証
- `RevocationRecord` — 失効の記録
- `InclusionProof` — 透明性ログの包含証明
- `ErrorResponse` — 標準のエラーレスポンス

### Swagger UI

仕様を対話的に見るには：

```bash
# With Redocly CLI 1.x (downloads it)
npx @redocly/cli@1 preview-docs api/openapi.yaml

# Or with Docker
docker run -p 8080:8080 -e SWAGGER_JSON=/api/openapi.yaml \
  -v $(pwd)/api:/api swaggerapi/swagger-ui
```

<a id="protocol-buffers-grpc"></a>

## Protocol Buffers（gRPC）

<a id="package"></a>

### パッケージ

```protobuf
package dcp.v1;
option go_package = "github.com/dcp-ai/dcp-ai-go/proto";
```

`go_package` のパスは公開されたモジュールではありません。コードを生成するときに、自分のパスを設定してください。

<a id="services"></a>

### サービス

#### VerificationService

| RPC | リクエスト | レスポンス |
|-----|---------|----------|
| `VerifyBundle` | `VerifyBundleRequest` | `VerifyBundleResponse` |
| `ValidateBundle` | `ValidateBundleRequest` | `ValidateBundleResponse` |
| `VerifyBundleV2` | `VerifyBundleV2Request` | `VerifyBundleV2Response` |
| `HealthCheck` | `HealthCheckRequest` | `HealthCheckResponse` |

#### AnchorService

| RPC | リクエスト | レスポンス |
|-----|---------|----------|
| `AnchorHash` | `AnchorHashRequest` | `AnchorHashResponse` |
| `AnchorBatch` | `AnchorBatchRequest` | `AnchorBatchResponse` |
| `CheckAnchor` | `CheckAnchorRequest` | `CheckAnchorResponse` |

#### RevocationService

| RPC | リクエスト | レスポンス |
|-----|---------|----------|
| `Revoke` | `RevokeRequest` | `RevokeResponse` |
| `RevokeV2` | `RevokeV2Request` | `RevokeV2Response` |
| `EmergencyRevoke` | `EmergencyRevokeRequest` | `EmergencyRevokeResponse` |
| `CheckRevocation` | `CheckRevocationRequest` | `CheckRevocationResponse` |
| `CheckRevocationByKid` | `CheckRevocationByKidRequest` | `CheckRevocationByKidResponse` |
| `ListRevocations` | `ListRevocationsRequest` | `ListRevocationsResponse` |

#### TransparencyLogService

| RPC | リクエスト | レスポンス |
|-----|---------|----------|
| `AddEntry` | `AddEntryRequest` | `AddEntryResponse` |
| `GetRoot` | `GetRootRequest` | `GetRootResponse` |
| `GetProof` | `GetProofRequest` | `GetProofResponse` |

#### KeyService

| RPC | リクエスト | レスポンス |
|-----|---------|----------|
| `RegisterKeys` | `RegisterKeysRequest` | `RegisterKeysResponse` |
| `LookupKey` | `LookupKeyRequest` | `LookupKeyResponse` |
| `RotateKey` | `RotateKeyRequest` | `RotateKeyResponse` |

<a id="generate-clients"></a>

### クライアントの生成

これらのコマンドには、それぞれのツール（`protoc` とそのプラグイン、`grpc_tools`、`tonic-build`）のインストールが必要です。このページのためには実行していません。

#### Go

```bash
protoc --go_out=. --go-grpc_out=. api/proto/dcp.proto
```

#### Python

```bash
python -m grpc_tools.protoc \
  -I api/proto \
  --python_out=. \
  --grpc_python_out=. \
  api/proto/dcp.proto
```

#### TypeScript

```bash
npx grpc_tools_node_protoc \
  --ts_out=. \
  --grpc_out=. \
  -I api/proto \
  api/proto/dcp.proto
```

#### Rust

`build.rs` で `tonic-build` を使います。

```rust
fn main() {
    tonic_build::compile_protos("api/proto/dcp.proto").unwrap();
}
```

<a id="development"></a>

## 開発

```bash
# Validate OpenAPI spec
npx @redocly/cli lint api/openapi.yaml

# Generate clients with OpenAPI Generator
npx @openapitools/openapi-generator-cli generate \
  -i api/openapi.yaml \
  -g typescript-fetch \
  -o generated/ts-client
```

<a id="license"></a>

## ライセンス

Apache-2.0
