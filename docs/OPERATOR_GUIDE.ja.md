<sub>[English](OPERATOR_GUIDE.md) · [中文](OPERATOR_GUIDE.zh-CN.md) · [Español](OPERATOR_GUIDE.es.md) · **日本語** · [Português](OPERATOR_GUIDE.pt-BR.md)</sub>

<a id="operator-guide--running-a-verification-service"></a>
<a id="operator-guide-running-a-verification-service"></a>

# オペレーターガイド — 検証サービスの運用

> [英語版](OPERATOR_GUIDE.md)の参考訳です（28/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

このガイドは、「エージェント検証済み」サービス、つまり DCP の Signed Bundle を検証する（オプションでハッシュをブロックチェーンにアンカーする）HTTP API を運用したい**第三者**のためのものです。プロトコルは中央のサーバーを**必要としません**。検証はいつでも `dcp verify-bundle` でローカルに行えます。このサービスは**オプション**であり、オペレーターの判断で運用されます。

<a id="what-is-an-agent-verified-service"></a>

## 「エージェント検証済み」サービスとは

**エージェント検証サービス**とは、次のことを行う HTTP API です。

1. Signed Bundle を**検証**する：[spec/VERIFICATION.md](../spec/VERIFICATION.md) と同じ規範的なチェックリスト（スキーマの検証、署名、intent_hash、監査チェーン、オプションの merkle_root）を実行します。
2. オプションで、`anchor_receipt` を公開のブロックチェーンや透明性ログと照合して**確認**します（公開データのみを使用）。
3. オプションで、`bundle_hash` を既存のチェーンに**アンカー**し、クライアントに `anchor_receipt` を返します。

サービスは**ステートレス**です。各リクエストはバンドル（とオプションで公開鍵）を受け取り、検証して結果を返します。エージェントの中央レジストリはなく、プロトコルは正規の URL を定めていません（たとえば、必須の「dcp.ai」エンドポイントはありません）。

`verified: true` は、バンドルが改ざんされておらず、それが示す鍵で署名されていることを意味します。プリンシパルが誰なのか、そのバンドルに基づいて行動すべきかどうかは示しません。信頼するプリンシパルからのバンドルだけを受け入れるのはアドミッションという別のステップです（リファレンスサーバーの `POST /v2/admit`。[ADMISSION.md](ADMISSION.md) を参照、未リリース）。

<a id="who-runs-it"></a>

## 誰が運用するのか

**第三者です。** このリポジトリ（スキーマ + 仕様 + CLI またはプログラムから使う API）を使えば、誰でもこのサービスをデプロイできます。プロトコルの作者は、中央の検証サーバーを運用していません。

<a id="requirements"></a>

## 要件

- このリポジトリのチェックアウト：`schemas/v1/` と `schemas/v2/` のスキーマ、`spec/` の仕様、そして npm には公開されていない
  ルートパッケージのリファレンス CLI と検証ライブラリ。
- 検証を実行する手段：CLI（`dcp verify-bundle [--policy <mode>] <signed.json> [public_key.txt]`）か、リポジトリのプログラム用 API である `lib/verify.js` の `verifySignedBundle`（非同期）と `validateBundle`。V2 のバンドルはそこでスキーマ検証され、その後 `@dcp-ai/sdk` で検証されます。
- オプション、アンカリング用：既存のチェーン（Bitcoin、Ethereum、または透明性ログ）への RPC やブロックエクスプローラーのアクセス。[STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md) を参照してください。

<a id="suggested-api-contract"></a>

## 推奨する API の契約

クライアントとオペレーターが相互運用できるよう、このセクションでは最小限の契約を提案します。実装はこれを拡張してもかまいません。

### POST /verify

規範的なチェックリスト（スキーマ、署名、intent_hash、監査チェーン、オプションの merkle）に照らして Signed Bundle を検証します。

- **リクエスト（JSON）：**
  - `signed_bundle`（オブジェクト）：検証する Signed Bundle。
  - `public_key_b64`（文字列、省略可能）：V1 では、バンドルに含まれていない場合の署名者の公開鍵。含まれている場合はバンドルの `signature.signer.public_key_b64` が使われます。V2 では、クラシカルな署名者を固定します（`pq_only` モードでは拒否されます）。

- **レスポンス（JSON）：**
  - `verified`（真偽値）：すべてのチェックに合格すれば `true`。
  - `errors`（文字列の配列、省略可能）：`verified` が `false` の場合の、人が読めるエラーメッセージ。

例：

```json
// Request
{ "signed_bundle": { "bundle": { ... }, "signature": { ... } } }

// Response (success)
{ "verified": true }

// Response (failure)
{ "verified": false, "errors": ["SIGNATURE INVALID", "Hint: Check that the public key ..."] }
```

リファレンスサーバー（`server/`）はこれを `POST /verify` として実装しています。そのレスポンスには常に `dcp_version` と `errors` が含まれ、V2 では `warnings`、`verifier_policy_hash`、`resolved_tier` が加わります。リクエストのボディは JSON です。

<a id="post-anchor-optional"></a>

### POST /anchor（オプション）

`bundle_hash` をチェーンにアンカーし、`anchor_receipt` を返します。チェーンと認証情報（ウォレット、RPC の URL など）はオペレーターが設定します。レシートの形式は [STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md) を参照してください。

- **リクエスト（JSON）：**
  - `bundle_hash`（文字列）：例 `sha256:<hex>`。
  - `chain`（文字列）：例 `"bitcoin"`、`"ethereum"`。

- **レスポンス（JSON）：**
  - `anchor_receipt`（オブジェクト）：例 `{ "chain": "bitcoin", "tx_id": "...", "block_height": N }`、または Ethereum 形式のフィールド。

`/anchor` の実装は、オペレーターのチェーンとツール（Bitcoin の OP_RETURN、Ethereum のコントラクトのイベントなど）によって異なります。リファレンスのアンカーサービス（`services/anchor`）はまだこれを実装していません。ハッシュをローカルのメモリーに `tx_hash: null` と `onchain: false` で記録するだけで、`anchor_receipt` は返しません。リファレンスの検証サーバーは `POST /anchor` に 501 で応答します。

<a id="deployment"></a>

## デプロイ

リファレンスの検証サーバー、アンカーサービス、透明性ログ、失効レジストリは、すべて GitHub Container Registry で **Docker イメージとして公開**されています。ほとんどの場合、リポジトリをクローンする必要はなく、`docker run` で足ります。

<a id="option-1--pull-the-reference-image-fastest"></a>
<a id="option-1-pull-the-reference-image-fastest"></a>

### オプション 1 — リファレンスイメージを取得する（最速）

```bash
docker run -d -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest
curl http://localhost:3000/health
```

マルチアーキテクチャ（`linux/amd64` + `linux/arm64`）です。タグは `:latest`、リリースの semver タグ（`:<major>.<minor>.<patch>`、`:<major>.<minor>`、`:<major>`）、`:sha-<short>` です。スタック全体（検証 + アンカー + 2 つの透明性ログ + 失効の 5 つのコンテナー）は、`docker/` で `docker compose up -d` を 1 回実行するか、リポジトリのルートから `docker compose -f docker/docker-compose.yml up -d` を実行すれば起動できます。

<a id="option-2--managed-paas"></a>
<a id="option-2-managed-paas"></a>

### オプション 2 — マネージド PaaS

Fly.io 用の設定済みの構成が [`deploy/fly/`](../deploy/fly/) にあります。[デプロイガイド](../deploy/README.md)では、Google Cloud Run と Railway のパターンも扱っています。

<a id="option-3--embed-the-verifier-in-your-own-service"></a>
<a id="option-3-embed-the-verifier-in-your-own-service"></a>

### オプション 3 — 自分のサービスに検証器を組み込む

既存のアプリケーションの中で検証したい場合（別の HTTP サービスを立てない場合）は、使用する言語の SDK をインストールし、その検証器を直接呼び出します（TypeScript では `verifySignedBundleV2`、Python と Rust では `verify_signed_bundle_v2`、Go では `v2.VerifySignedBundleV2`）。次のコマンドは公開済みのバージョンをインストールします。

```bash
npm install @dcp-ai/sdk        # TypeScript / Node.js
pip install dcp-ai             # Python
cargo add dcp-ai@2.11.1
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.11.1
```

正確なインポートパスと API の範囲は各 SDK の README を、公開済みのバージョンに欠けているものはその *Release status* を参照してください。`main` では、TypeScript、Python、Go、Rust の SDK が V1 と V2 のバンドルをネイティブに検証し、`@dcp-ai/wasm` が Rust の V2 検証器を公開しています。それらの V2 検証器は、各アーティファクトの署名（ステップ V2-8）と PQ チェックポイント（ステップ V2-12）を含め、[VERIFICATION.md](../spec/VERIFICATION.md) のチェックリストに従い、`@dcp-ai/sdk` 2.2.1、`@dcp-ai/wasm` 2.1.1、`dcp-ai` 2.10.1（PyPI）、Go v2.11.1、Rust `dcp-ai` 2.11.1 以降では、存在するステップ V2-11 の二次フィールドも確認します。それより前のバージョンは一次の監査チェーンとマークルルートを確認しますが、オプションの二次チェーンや `audit_merkle_root_secondary` は確認しません（[STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md#dual-hash-chains) を参照）。

<a id="stateless-by-design"></a>

### 設計上ステートレス

- 検証に**データベースは不要**です。各リクエストはそれだけで完結します。
- それ以外のすべてには**永続化**が必要です。ゲートウェイのパスポートと鍵のレジストリ、アンカーのキュー、透明性ログ、失効レジストリです。

<a id="reference-services-keep-state-in-memory-only"></a>

### リファレンスサービスは状態をメモリーにしか保持しない

リファレンスのゲートウェイ（`server/`）とサービス（`services/`）には永続的なストアがありません。例外として、失効サービスは状態をファイルに保持できます（`REVOCATION_STATE_PATH`。サービスでは既定でオフ、`docker/` の compose ファイルではオンで、ボリュームに置かれます）。**再起動、デプロイ、クラッシュで状態は消えます**。メモリー不足によるクラッシュも含みます。その状態とは次のものです。

- 登録済みのパスポート、鍵、緊急トークン
- 失効
- 透明性ログ
- 保留中のアンカーとローカルのアンカー記録

唯一の例外は、`REVOCATION_STATE_PATH` を永続的なストレージ（ボリューム）に置いた失効サービスで、その登録と失効は再起動後も残ります。

状態が消えると記録されていたものは失われますが、関門は残ります。

- **登録。** `agent_id` の登録には引き続きオペレーターのトークンが必要です。消える前に登録されていた `agent_id` も、すべて新しいものに戻るため同様です。
- **失効の照会。** 失効サービスは、記録した失効を知らなくなります。
  - `GET /check/<agent_id>` は、消える前に失効したエージェントについて `revoked: false` と応答します。
  - `/.well-known/dcp-revocations.json` にはもう載らないため、拒否リストに基づく失効情報の提供元はそれを失効していないものとして読みます。
  - `GET /v2/check/kid/<kid>` は、その鍵について 404（状態不明）を返します。
- **ゲートウェイ**は、パスポート、鍵（失効済み・退役済みのものを含む）、緊急トークンを忘れます。
- **信頼が得られるわけではありません。** 状態が消えただけで、プリンシパルが信頼済みになったりバンドルが受け入れられたりすることはありません。アドミッションには引き続きオペレーターの信頼セットと、strict-v1 のもとでは失効スナップショットが必要です。

本番でこれらのサービスに頼る前に、永続的なストレージを追加してください。

メモリーを一定の範囲に保つため、アイデンティティ、鍵、失効のレジストリは、状態を追い出すのではなく処理を拒否します。

| サービス | 制限 | 設定 |
|---------|-------|---------|
| ゲートウェイ | 新しい `agent_id` の登録にはオペレーターのトークンが必要（401） | `OPERATOR_TOKEN` |
| ゲートウェイ | クライアントごとに 1 時間あたり 20 件のパスポート登録（429） | `REGISTRATIONS_PER_HOUR` |
| ゲートウェイ | 登録できる鍵は 10,000 個。それを超えると新しいエージェントは 507（ローテーションでは先に退役した鍵が外されるので、引き続き収まる） | `MAX_REGISTERED_KEYS` |
| ゲートウェイ | エージェントごとにローテーションで外した鍵を 4 個保持。それより古いものは墓標として失効状態のまま残る | — |
| ゲートウェイ | エージェントごとに生涯で 64 個の鍵。それ以上のローテーションは 409（頻繁にローテーションするエージェントでは引き上げる） | `MAX_KEYS_PER_AGENT` |
| ゲートウェイ | クライアントごとに 1 分あたり 100 件の POST リクエスト、1 分あたり 5 件の緊急失効 | — |
| 失効 | 新しい `agent_id` の登録にはオペレーターのトークンが必要（401） | `OPERATOR_TOKEN` |
| 失効 | クライアントごとに 1 時間あたり 20 件の登録（429） | `REGISTRATIONS_PER_HOUR` |
| 失効 | 登録できるエージェントは 10,000。それを超えると新しいものは 507 | `MAX_AGENTS` |
| 失効 | テキストフィールドは最大 256 文字。クライアントごとに 1 分あたり 5 件の緊急失効 | — |
| 透明性ログ | ゴシップの交換には、固定されたピアが署名したツリーヘッドが必要（`GOSSIP_PEERS=<url>#<key>`）。ボディは 16 KB。直近の異なるアラートを 100 件。ポーリングは最大 16 KB を読み、1 間隔でタイムアウトし、重複して実行されない | `GOSSIP_PEERS` |
| ボディを読むエンドポイント | リクエストボディは 1 MB（413）。`POST /v2/disputes/:id/escalate` と `POST /v2/delegation/mandate/:id/revoke` はボディを読まない | — |

ゲートウェイの 2 つの部分は動作が異なります。

- **DCP-05–09 のレコードストアは追い出しを行います。** ライフサイクル、稼働状況、遺言、継承、紛争、判例、異議、権利、義務、違反、委任状、助言の宣言、ミラー、インタラクション、注意の閾値のストアです。それぞれ最大 10,000 件、エージェントごとのリストでもエージェントあたり 10,000 件を保持し、古いものから追い出します（FIFO）。追い出されたレコードはエラーなしで消えます。
- **監査チェーンには独自の上限がありません**（`POST /v2/audit/append`）。適用されるのはリクエストの制限だけです。

制限はクライアントの IP ごとに数えます。`X-Forwarded-For` にクライアントの IP を追加するプロキシの背後では `TRUST_PROXY=true` を設定してください。そうしないと、すべてのクライアントがプロキシのアドレスを共有します。

<a id="environment-variables-verification-service"></a>

### 環境変数（検証サービス）

- `PORT` — HTTP のポート（既定値 `3000`）
- `OPERATOR_TOKEN` — 管理用エンドポイント（ポリシー、勧告、ガバナンス）と新しい `agent_id` の登録のための bearer トークン。未設定ならそれらはロックされたまま
- `VERIFIER_MODE` — `classical_only` | `hybrid_preferred` | `hybrid_required` | `pq_only`
- `ALLOW_V1_BUNDLES` — `false` で V1 バンドルを拒否
- `TRUST_PROXY`、`REGISTRATIONS_PER_HOUR`、`MAX_REGISTERED_KEYS`、`MAX_KEYS_PER_AGENT` — 上記を参照
- `DCP_TRUSTED_PRINCIPALS_FILE`、`DCP_ADMISSION_PROFILE_FILE`、`DCP_REVOCATION_LIST_URL`、`DCP_REVOCATION_LIST_AUTHORIZATION`、`DCP_REVOCATION_TIMEOUT_MS` — `POST /v2/admit` のアドミッション。[ADMISSION.md](ADMISSION.md) を参照
- `REQUIRE_SESSION_BINDING`、`REQUIRE_COMPOSITE_BINDING`、`MAX_KEY_AGE_DAYS`、`PQ_CHECKPOINT_INTERVAL` はデプロイの設定に現れるが、まだ読み込まれない

`anchor`、`transparency-log`、`revocation` の環境変数については、[`services/`](../services/) にあるそれぞれの README か、[`deploy/fly/`](../deploy/fly/) にあるサービスごとの `fly.toml` を参照してください。

<a id="blockchain-and-verification"></a>

## ブロックチェーンと検証

- **検証のみ：** サービスは POST `/verify` だけに限定し、[VERIFICATION.md](../spec/VERIFICATION.md) のチェックリスト（スキーマ、署名、intent_hash、監査チェーン、merkle。`@dcp-ai/sdk` 2.2.1、`@dcp-ai/wasm` 2.1.1、`dcp-ai` 2.10.1（PyPI）、Go v2.11.1、Rust `dcp-ai` 2.11.1 以降の SDK の検証器は、存在するオプションの二次チェーンのフィールドも確認する。それより前のバージョンは確認しない）を適用できます。ブロックチェーンは不要です。
- **anchor_receipt の確認：** クライアントがバンドルと一緒に `anchor_receipt` を送ってきた場合、サービスはオプションで、`bundle_hash` が指定されたチェーンやログのインデックスに現れることを、**公開データだけ**を使って確認できます（例：ブロックエクスプローラーからトランザクションを取得する）。プロトコルの中央サーバーは関与しません。
- **アンカー（書き込み）：** オペレーターはノードを運用するか RPC を使って既存のチェーンにハッシュを書き込み、サービスはクライアントに `anchor_receipt` を返します。これはオプションでオペレーターごとに異なり、リファレンスのアンカーサービスはまだこれを行いません（[`services/anchor/README.md`](../services/anchor/README.md) を参照）。

---

<a id="v20-verification-service"></a>

## V2.0 の検証サービス

DCP v2.0 では、ポスト量子のハイブリッド暗号、適応型のセキュリティティア、複合署名が導入されました。検証サービスを運用するオペレーターは、V2 に対応するよう設定を更新する必要があります。

<a id="verifier-policy-configuration"></a>

### 検証器のポリシーの設定

検証器は `VerifierPolicy`（[`schemas/v2/verifier_policy.schema.json`](../schemas/v2/verifier_policy.schema.json)）を受け取ります。リファレンスサーバーは次のポリシーで起動します。

```json
{
  "default_mode": "hybrid_required",
  "risk_overrides": { "high": "hybrid_required", "medium": "hybrid_required", "low": "hybrid_required" },
  "min_classical": 1,
  "min_pq": 1,
  "accepted_classical_algs": ["ed25519"],
  "accepted_pq_algs": ["ml-dsa-65", "slh-dsa-192f"],
  "accepted_hash_algs": ["sha256", "sha384"],
  "require_session_binding": true,
  "require_composite_binding": true,
  "max_key_age_days": 365,
  "allow_v1_bundles": true,
  "allow_classical_fallback_disable": false,
  "warn_classical_only_deprecated": false,
  "advisory_rejected_algs": []
}
```

`risk_overrides` のキーはパスポートの `risk_tier` です。サーバーにはポリシーファイルがありません。`VERIFIER_MODE` と `ALLOW_V1_BUNDLES` が起動時にそれを決め、`{ "mode": "<mode>" }` を付けた `POST /v2/policy/mode`（オペレーターのトークン）が実行時にモードを切り替え、受け入れられた勧告は `advisory_rejected_algs` に追加され、`GET /v2/policy` が現在のポリシーとそのハッシュを返します。モードを切り替えると、`default_mode` と `risk_overrides` のすべてのエントリがそのモードになります。独自のポリシーで検証器を組み込むには、SDK に完全なポリシーを渡してください。部分的なポリシーも受け付けられますが、省略したフィールドは既定値で埋められません（[MIGRATION_V1_V2.md](MIGRATION_V1_V2.md) のステップ 8 を参照）。

検証モード：
- `classical_only` — Ed25519 の署名のみが必要（V1 との互換性）
- `hybrid_preferred` — Ed25519 が必要で、ML-DSA-65 は存在すれば確認される
- `hybrid_required` — Ed25519 と ML-DSA-65 の両方による複合署名が必要
- `pq_only` — ポスト量子の署名だけが要求・確認される。`classical_only` で署名されたバンドルは拒否され、固定したクラシカルな鍵（`public_key_b64`）は拒否される。リファレンスサーバーでは、このモードで V1 バンドルも無効になる。

どのモードでも、存在する PQ 署名（ML-DSA-65 または SLH-DSA-192f）は検証に通らなければならず、無効なものは拒否されます。

<a id="post-verify-v2"></a>

### POST /verify（V2）

V2 のバンドルには、クラシカルとポスト量子の両方の要素を持つ `composite_sig` が含まれます。

```json
{
  "signed_bundle": {
    "bundle": {
      "dcp_bundle_version": "2.0",
      "manifest": {
        "session_nonce": "a1b2c3...",
        "rpr_hash": "sha256:...",
        "passport_hash": "sha256:...",
        "intent_hash": "sha256:...",
        "policy_hash": "sha256:...",
        "audit_merkle_root": "sha256:...",
        "audit_merkle_root_secondary": "sha3-256:...",
        "audit_count": 1
      },
      "responsible_principal_record": { "payload": {...}, "payload_hash": "sha256:...", "composite_sig": {...} },
      "agent_passport": { "payload": {...}, "payload_hash": "sha256:...", "composite_sig": {...} },
      "intent": { "payload": {...}, "payload_hash": "sha256:...", "composite_sig": {...} },
      "policy_decision": { "payload": {...}, "payload_hash": "sha256:...", "composite_sig": {...} },
      "audit_entries": [ {...} ]
    },
    "signature": {
      "composite_sig": {
        "classical": { "alg": "ed25519", "kid": "...", "sig_b64": "..." },
        "pq": { "alg": "ml-dsa-65", "kid": "...", "sig_b64": "..." },
        "binding": "pq_over_classical"
      }
    }
  }
}
```

リファレンスサーバーの V2 のレスポンスには、解決されたセキュリティティアが含まれます。`POST /v2/bundle/verify`（V2 のみ。署名済みのバンドルをボディ全体として受け取ることもできます）は次のように応答します。

```json
{
  "verified": true,
  "dcp_version": "2.0",
  "errors": [],
  "warnings": [],
  "verifier_policy_hash": "sha256:...",
  "resolved_tier": "elevated",
  "verification_mode": "hybrid_required",
  "session_binding_valid": true,
  "manifest_valid": true
}
```

`POST /verify` は `resolved_tier` までの同じフィールドを返します。`session_binding_valid` と `manifest_valid` はエラーメッセージから読み取られたものなので、判断には `verified` と `errors` を使ってください。

<a id="security-tiers-in-verification"></a>

### 検証におけるセキュリティティア

各セキュリティティアは、検証モードと PQ チェックポイントの間隔に対応します（仕様 §14.1）。

| ティア | 検証モード | PQ チェックポイント |
|------|------------------|---------------|
| Routine | `classical_only` | 50 イベントごと |
| Standard | `hybrid_preferred` | 10 イベントごと |
| Elevated | `hybrid_required` | すべてのイベント |
| Maximum | `hybrid_required` | すべてのイベント |

ティアごとのサイズの予算はありません。バンドルのサイズは、そのアルゴリズム、監査エントリと PQ チェックポイント、
JSON のエンコードによって決まるので、自分の最大のバンドルを測ってください。たとえば、`tests/interop/v2/admission_vectors.json` の
合成のハイブリッドバンドル `signed_bundles.base` は、コンパクトな JSON で 32,996 バイトです。これは観測値であって、上限ではありません。
バンドルはヘッダーではなく、明示的なサイズの予算を設けた JSON のリクエストボディで送ってください（
[QUICKSTART_EXPRESS.md](QUICKSTART_EXPRESS.md#sending-dcp-bundles-from-a-client) を参照）。

検証器はティアを**引き上げる**ことはできますが（例：金融の操作で `elevated` を強制する）、**引き下げては**なりません（MUST NOT）。`main` では、SDK の検証器（TypeScript、Go、Rust、WASM、Python）は、バンドルの署名とすべてのアーティファクトの署名を、ポリシーのモード（パスポートの `risk_tier` に対する `risk_overrides` のエントリ、または `default_mode`）とティアのモード（仕様 §14.3）のうち厳しいほうで確認します。そのため、`risk_tier: "low"` を宣言したパスポートでも、支払いの意図にはハイブリッド署名が必要です。バンドルが持つ PQ チェックポイントも確認します（`spec/VERIFICATION.md` V2-12）。公開済みのバージョンは遅れていることがあります。各 SDK の *Release status* を参照してください。

リファレンスサーバーは `lib/verify.js` を通じて V2 のバンドルを検証し、`lib/verify.js` は同じチェックアウトの TypeScript SDK にサーバーのポリシーとともにそれらを渡します。Docker イメージはその SDK をソースからビルドします（[`docker/Dockerfile`](../docker/Dockerfile) を参照）。その `verification_mode` フィールドはティアのモードであり、実際に適用されたモードではありません。

<a id="capabilities-endpoint-v2"></a>

### 機能のエンドポイント（V2）

V2 のサービスは `GET /.well-known/dcp-capabilities.json` を公開します。リファレンスサーバーの応答は次のとおりです。

```json
{
  "supported_versions": ["1.0", "2.0"],
  "supported_algs": {
    "signing": ["ed25519", "ml-dsa-65", "slh-dsa-192f"],
    "kem": ["x25519", "ml-kem-768", "x25519-ml-kem-768"],
    "hash": ["sha256", "sha3-256", "sha384"]
  },
  "supported_wire_formats": ["application/json", "application/cbor"],
  "features": {
    "composite_signatures": true,
    "session_binding": true,
    "blinded_rpr": true,
    "dual_hash_chains": true,
    "pq_checkpoints": true,
    "emergency_revocation": true,
    "multi_party_auth": true,
    "pq_only_mode": true,
    "advisory_auto_response": true,
    "governance_keys": true,
    "hsm_provider": true,
    "agent_lifecycle": true,
    "succession": true,
    "dispute_resolution": true,
    "rights_obligations": true,
    "delegation": true
  },
  "verifier_policy_hash": "sha256:...",
  "min_accepted_version": "1.0"
}
```

これはサーバーが宣伝している内容であって、確認済みの保証の一覧ではありません。`application/cbor` が挙げられていますが、そのエンドポイントが読むのは JSON のボディだけです。`hsm_provider: true` と宣伝されていますが、リポジトリの HSM プロバイダーはハードウェアの裏付けのないシミュレーションです（[SECURITY_MODEL.md](SECURITY_MODEL.md)）。

<a id="observability"></a>

### オブザーバビリティ

V2 のサービスは、監視のためのメトリクスを公開すべきです。

- **レイテンシー**：セキュリティティアごとの検証レイテンシーの p50/p95/p99
- **スループット**：1 秒あたりに検証されたバンドル数
- **キャッシュ**：検証キャッシュのヒット率とミス率
- **PQ チェックポイント**：検証された PQ チェックポイントの数
- **エラー**：DCP のエラーコード（DCP-E001 から DCP-E902）ごとのエラー件数
- **ティア**：セキュリティティアごとの検証リクエストの分布

推奨：SDK に組み込まれた `dcpTelemetry` モジュールを、OpenTelemetry 互換のエクスポーターとともに使ってください（[OBSERVABILITY.md](OBSERVABILITY.md)）。リファレンスサーバー自体はこれらのメトリクスを送りません。

<a id="migration-for-existing-v1-operators"></a>

### 既存の V1 オペレーターの移行

既存の V1 オペレーターは、段階的にアップグレードできます。

1. DCP v2.0 の SDK に更新する
2. `default_mode: 'classical_only'` を設定する（リファレンスサーバーでは `VERIFIER_MODE=classical_only`）。それでも、elevated と maximum のアクションでは、セキュリティティアがモードを `hybrid_required` に引き上げる
3. 新しいエージェントに対して `hybrid_preferred` を段階的に有効にする
4. PQ の普及が十分になったら `hybrid_required` に移行する

詳しい移行の手順は [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md) を参照してください。

<a id="dcp-0509-service-endpoints"></a>

## DCP-05–09 のサービスエンドポイント

DCP v2.0 は、ライフサイクル管理、デジタル継承、紛争解決、権利の枠組み、個人の代理のための 31 のエンドポイントで検証サーバーを拡張します。

> **認証なし、検証なし。** これらのエンドポイントは、各レコードをそのスキーマと ID の形式に照らして確認します。`composite_sig` は一切検証せず、オペレーターのトークンも不要です。サーバーに到達できる人なら誰でも、たとえばエージェントの稼働を終了・再開させたり、取り消し可能な委任状を失効させたり、紛争を解決済みにしたりできます。`OPERATOR_TOKEN` を設定してもこれらは保護されません。保護されるのは管理用のルートと新しい `agent_id` の登録だけです。信頼できないクライアントには公開しないでください。独自の認可の背後に置くか、まったく公開しないようにし、保存される内容は未検証のレコードとして扱ってください。

各 POST は、表に示したキーのもとでレコードを受け取ります（例：`{ "commissioning_certificate": { ... } }`）。`:agent_id` と `:id` は URL エンコードします。

<a id="dcp-05-agent-lifecycle-management"></a>

### DCP-05：エージェントのライフサイクル管理

| メソッド | エンドポイント | ボディのキー | 説明 |
|--------|----------|----------|-------------|
| POST | `/v2/lifecycle/commission` | `commissioning_certificate` | エージェントを `commissioned` 状態にする。既知のエージェントの場合は、状態と履歴をリセットする |
| POST | `/v2/lifecycle/vitality` | `vitality_report` | 稼働状況レポートを保存する。レポートの `state` が異なれば、ライフサイクルの遷移になる |
| POST | `/v2/lifecycle/decommission` | `decommissioning_record` | エージェントを `decommissioned` に移し、登録済みのパスポートを `decommissioned` にする |
| GET | `/v2/lifecycle/:agent_id` | — | 現在の状態、履歴、稼働状況レポートの数 |

サーバーが受け付けるライフサイクルの遷移：`commissioned → active`、`active → declining`、`active → decommissioned`、`declining → decommissioned`。SDK の状態機械は、さらに `commissioned → decommissioned` と `declining → active` も許します。

<a id="dcp-06-digital-succession--inheritance"></a>
<a id="dcp-06-digital-succession-inheritance"></a>

### DCP-06：デジタル継承と相続

| メソッド | エンドポイント | ボディのキー | 説明 |
|--------|----------|----------|-------------|
| POST | `/v2/succession/testament` | `digital_testament` | エージェントの遺言を保存する（エージェントごとに 1 つ） |
| GET | `/v2/succession/testament/:agent_id` | — | エージェントの遺言 |
| POST | `/v2/succession/execute` | `succession_record` | 継承を記録する。サーバーが前任者の状態を知っている場合、その状態は `declining` か `decommissioned` でなければならない |
| POST | `/v2/succession/memory-transfer` | `memory_transfer_manifest` | マニフェストを検証して件数を返す。保存はされない |
| GET | `/v2/succession/:agent_id` | — | 前任者について記録された継承 |

<a id="dcp-07-conflict-resolution--dispute-arbitration"></a>
<a id="dcp-07-conflict-resolution-dispute-arbitration"></a>

### DCP-07：紛争の解決と仲裁

| メソッド | エンドポイント | ボディのキー | 説明 |
|--------|----------|----------|-------------|
| POST | `/v2/disputes/create` | `dispute_record` | 紛争を保存する |
| POST | `/v2/disputes/:id/escalate` | — | 紛争を次のエスカレーションレベルに移す |
| POST | `/v2/disputes/:id/resolve` | `arbitration_resolution`（省略可能） | 紛争を解決済みにする。解決内容が与えられれば、そのまま保存する |
| GET | `/v2/disputes/:id` | — | 紛争 |
| POST | `/v2/objections/create` | `objection_record` | 異議を保存する |
| POST | `/v2/jurisprudence` | `jurisprudence_bundle` | 判例のバンドルを保存する |
| GET | `/v2/jurisprudence` | — | 保存されたすべての判例のバンドル |

<a id="dcp-08-rights--obligations-framework"></a>
<a id="dcp-08-rights-obligations-framework"></a>

### DCP-08：権利と義務の枠組み

| メソッド | エンドポイント | ボディのキー | 説明 |
|--------|----------|----------|-------------|
| POST | `/v2/rights/declare` | `rights_declaration` | エージェントの権利の宣言を保存する（エージェントごとに 1 つ） |
| GET | `/v2/rights/:agent_id` | — | エージェントの権利の宣言 |
| POST | `/v2/obligations/record` | `obligation_record` | 義務の記録を追加する |
| GET | `/v2/obligations/:agent_id` | — | エージェントの義務の記録 |
| POST | `/v2/rights/violation` | `violation_report` | 権利侵害の報告を保存する |

<a id="dcp-09-personal-representation--delegation"></a>
<a id="dcp-09-personal-representation-delegation"></a>

### DCP-09：個人の代理と委任

| メソッド | エンドポイント | ボディのキー | 説明 |
|--------|----------|----------|-------------|
| POST | `/v2/delegation/mandate` | `delegation_mandate` | 委任状を保存する |
| GET | `/v2/delegation/mandate/:id` | — | `revoked` を伴う委任状 |
| POST | `/v2/delegation/mandate/:id/revoke` | — | `revocable` が true の委任状を失効させる |
| POST | `/v2/agent-advisory/declare` | `advisory_declaration` | 助言の宣言を保存する |
| GET | `/v2/agent-advisory/:id` | — | 助言の宣言 |
| POST | `/v2/mirror/generate` | `principal_mirror` | プリンシパルのミラーを追加する |
| GET | `/v2/mirror/:agent_id` | — | エージェントのプリンシパルのミラー |
| POST | `/v2/interactions/record` | `interaction_record` | インタラクションの記録を保存する |
| POST | `/v2/awareness/threshold` | `awareness_threshold` | エージェントの注意の閾値を保存する（エージェントごとに 1 つ） |
| GET | `/v2/awareness/threshold/:agent_id` | — | エージェントの注意の閾値 |

ID ごと、またはエージェントごとに 1 つ保存されるレコードは、同じ ID やエージェントに対する後の POST で置き換えられます。異議、違反の報告、インタラクションの記録には GET のエンドポイントがありません。

<a id="production-hardening"></a>

### 本番向けの堅牢化

DCP-05–09 のエンドポイントには次のものがあります。

- **JSON Schema による検証** — レコードを送る POST はすべて、保存前にそのスキーマで検証される。`escalate` と `revoke` はレコードを受け取らない。`resolve` はオプションの `arbitration_resolution` を受け取り、それを検証せずに保存する
- **レート制限** — すべての POST エンドポイントで IP ごとに 1 分あたり 100 リクエスト
- **ボディのサイズ制限** — ボディを読む場合、リクエストボディは最大 1 MB（超えると 413）。`escalate` と `revoke` はボディを読まない
- **入力された ID の検証** — サーバーがキーとして使う ID は `^[\w:.\-]{1,256}$` に一致しなければならず、それ以外の文字は拒否される
- **上限付きのストレージ** — メモリー内の各ストアは最大 10,000 件を保持し、古いものから追い出す（FIFO）。追い出されたレコードは消える。アイデンティティのレジストリは代わりに拒否する（507）。[リファレンスサービスは状態をメモリーにしか保持しない](#reference-services-keep-state-in-memory-only)を参照
- **セキュリティヘッダー** — X-Content-Type-Options、X-Frame-Options、Strict-Transport-Security、Cache-Control

レコードの署名の検証や認証は**含まれていません**（このセクションの冒頭の注記を参照）。

<a id="reference"></a>

## 参考資料

- 検証のチェックリスト：[spec/VERIFICATION.md](../spec/VERIFICATION.md)
- ストレージとアンカリング：[STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md)
- バンドルの形式：[spec/BUNDLE.md](../spec/BUNDLE.md)
