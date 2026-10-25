<sub>[English](TECHNICAL_ARCHITECTURE.md) · [中文](TECHNICAL_ARCHITECTURE.zh-CN.md) · [Español](TECHNICAL_ARCHITECTURE.es.md) · **日本語** · [Português](TECHNICAL_ARCHITECTURE.pt-BR.md)</sub>

<a id="technical-architecture--dcp-at-global-scale"></a>
<a id="technical-architecture-dcp-at-global-scale"></a>

# 技術アーキテクチャ — 世界規模の DCP

> [英語版](TECHNICAL_ARCHITECTURE.md)の参考訳です（25/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

この文書は、Digital Citizenship Protocol を世界中にデプロイするための技術的な設計図です。どの政府、組織、開発者も、中央の権威にもプロトコルの作者にも依存せずにプロトコルを採用できるようにする、レイヤー、コンポーネント、技術の選択を説明します。

このプロトコルは**仕様 + 暗号 + JSON** です。V1 に必要なのは SHA-256、Ed25519、正規化した JSON、JSON Schema draft 2020-12 です。V2 は、Ed25519 + ML-DSA-65 の複合署名、SHA3-256、そして暗号プロファイルのほかのアルゴリズムを加え、JSON は `dcp-jcs-v1` プロファイル（[CANONICALIZATION_PROFILE.md](../spec/CANONICALIZATION_PROFILE.md)）で正規化します。これらのプリミティブを持つどの言語でも実装でき、規範的な要件は仕様とそのプロファイルにあります。それが世界規模での実現を可能にしています。

---

<a id="layers"></a>

## レイヤー

```
┌─────────────────────────────────────────────────────┐
│  Layer 5: Integration                               │
│  Middleware (Express, FastAPI, gRPC), gov portals    │
├─────────────────────────────────────────────────────┤
│  Layer 4: Anchor + Attestation                      │
│  Bitcoin/Ethereum anchor, jurisdiction attestation   │
├─────────────────────────────────────────────────────┤
│  Layer 3: Infrastructure services                   │
│  Verification service, transparency log, revocation │
├─────────────────────────────────────────────────────┤
│  Layer 2: SDK (multi-language)                      │
│  TypeScript, Python, Go, Rust, WebAssembly          │
├─────────────────────────────────────────────────────┤
│  Layer 1: Spec + Schemas (normative)                │
│  spec/, schemas/v1/, JSON Schema draft 2020-12      │
└─────────────────────────────────────────────────────┘
```

各レイヤーは前のレイヤーの上に成り立ちます。最小のデプロイではレイヤー 1–2（仕様 + SDK）だけを使います。政府による完全なデプロイでは 5 つすべてを使います。この図は概念図であり、このリポジトリに存在する部品と、提案にとどまる部品（gRPC のミドルウェア、政府のポータル、オンチェーンのアンカリング、アテステーションのサービス）が混在しています。どれがどちらかは、以下の各節に記します。

---

<a id="layer-1-spec--schemas"></a>
<a id="layer-1-spec-schemas"></a>

## レイヤー 1：仕様 + スキーマ

このリポジトリにすでに存在します。

- `spec/` — DCP-01 から DCP-09、BUNDLE、VERIFICATION。
- `schemas/v1/` — JSON Schema draft 2020-12（V1 のアーティファクト）。
- `schemas/v2/` — JSON Schema draft 2020-12（DCP-05–09 を含む V2 のアーティファクト）。
- スキーマは、仕様とともに、アーティファクトの形についての信頼できる情報源です。SDK のすべての経路がスキーマに照らして検証するわけではありません。TypeScript SDK では、`validateBundle` は V1 のバンドルを対象とし、`verifySignedBundleV2` は必要な構造を確認しますが JSON Schema は実行しません（CLI とサーバーが使うリファレンス検証器 `lib/verify.js` が、それを呼び出す前にスキーマを検証します）。

このレイヤーは規範です。頻繁には変わらず、任意のフィールドで拡張されます。

---

<a id="layer-2-sdk-multi-language"></a>

## レイヤー 2：SDK（多言語）

<a id="what-the-sdk-is"></a>

### SDK とは何か

フレームワークではありません。DCP のアーティファクトを構築、署名、検証するポータブルなライブラリです。たとえば TypeScript SDK では次のとおりです。

- `validateBundle` — V1 のバンドルを V1 のスキーマに照らして検証する。
- `verifySignedBundle`（V1）と `verifySignedBundleV2`（V2） — 検証のチェックリスト。
- `signBundle` / `signBundleV2` — バンドルに署名する（Ed25519、または V2 では Ed25519 + ML-DSA-65 の複合署名）。
- `BundleBuilder` / `BundleBuilderV2` — バンドルを構築する。
- `intentHash` / `hashObject` — 正規化したハッシュ。

各言語の正確な API はそれぞれの README にあり、TypeScript については [API_REFERENCE.md](API_REFERENCE.md) にあります。

<a id="language-bindings"></a>

### 言語ごとのバインディング

各 SDK の README には、何をどのレジストリにいつ公開したかを記録する *Release status* の節があります。この文書はレジストリを確認しておらず、公開されたバージョンは `main` より遅れることがあります。

- **TypeScript** — npm の [`@dcp-ai/sdk`](https://www.npmjs.com/package/@dcp-ai/sdk)。スキーマを内蔵し、ファイルシステムに依存しません。PQ のアルゴリズムには `@noble/post-quantum`、Ed25519 には `tweetnacl`、ハッシュと HKDF には Node.js の `crypto` を使います。`@dcp-ai/cli`（対話式のスキャフォールディング CLI）と、`integrations/express/` と `integrations/openclaw/` の統合の基盤でもあります。
- **Python** — PyPI の [`dcp-ai`](https://pypi.org/project/dcp-ai/)。ML-DSA-65 / SLH-DSA-192f には `pqcrypto`、Ed25519 には `pynacl`、draft 2020-12 の検証には `jsonschema`、型付きモデルには `pydantic` を使います。フレームワークとのブリッジ（`dcp_ai.fastapi`、`dcp_ai.langchain`、`dcp_ai.openai`、`dcp_ai.crewai`）は wheel に含まれ、インストール時のエクストラで有効になります（例：`pip install dcp-ai[fastapi]`）。
- **Go** — `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2`（Go のメジャーバージョンの規則により、モジュールパスには `/v2` の接尾辞が必要です）。ML-DSA-65、ML-KEM-768、SLH-DSA-192f には `cloudflare/circl`、Ed25519 には標準ライブラリの `crypto/ed25519` を使います。`sdks/go/v2.x.y` のタグでリリースされます。
- **Rust** — crates.io の [`dcp-ai`](https://crates.io/crates/dcp-ai)。PQ には `fips203`/`fips204`/`fips205` のクレート（github.com/integritychain）、クラシカルには `ed25519-dalek` を使います。`--features wasm` による下の WASM ビルドの元でもあります。
- **WebAssembly** — npm の [`@dcp-ai/wasm`](https://www.npmjs.com/package/@dcp-ai/wasm)。Rust のクレートから `wasm-pack` でコンパイルされます。

5 つとも同じ仕様と同じスキーマのセットを共有し、SDK 間の相互運用性は `tests/interop/v2/` の共有ベクターを使って CI で検証されます。

<a id="sdk-structure-typescript-example"></a>

### SDK の構成（TypeScript の例）

```
sdks/typescript/
  src/
    core/            # canonicalization, hashing, signing, verification (V1 and V2), tiers, DCP-05–09 modules
    providers/       # Ed25519, ML-DSA-65, SLH-DSA-192f (exported); KEM providers (internal)
    bundle/          # bundle builders and signing
    a2a/             # DCP-04 discovery, handshake messages, sessions
    observability/   # dcpTelemetry
    schemas/         # embedded JSON schemas
    types/           # V1 and V2 types
    wire/            # wire formats
    index.ts         # the package's public exports
  package.json
  tsconfig.json
```

SDK はファイルシステムに依存しません。オブジェクトを受け取り、構造化された結果を返します。スキーマはインポートされた JSON モジュールとしてパッケージされています。

---

<a id="layer-3-infrastructure-services"></a>

## レイヤー 3：インフラストラクチャのサービス

<a id="3a-verification-service"></a>

### 3a. 検証サービス

`server/` にある、Signed Bundle を検証する HTTP API です。

本番のデプロイでは：

- **Docker イメージ：** `ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest` に加え、リリースの semver タグと `:sha-<short>`。`linux/amd64` + `linux/arm64` のマルチアーキテクチャ。`docker run -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest` で実行します。
- **ステートレスな検証：** `POST /verify` にデータベースは不要です。サーバーのほかのレジストリはメモリ上にあり、再起動で失われます（[OPERATOR_GUIDE.md](OPERATOR_GUIDE.md#reference-services-keep-state-in-memory-only)）。
- **ヘルス + ケイパビリティ：** `/health`、`/.well-known/dcp-capabilities.json`。
- **API：** POST `/verify`（ボディ：`signed_bundle`、任意の `public_key_b64`。レスポンス：`{ verified, dcp_version, errors, … }`）。追加の V2 エンドポイントは [OPERATOR_GUIDE.md](OPERATOR_GUIDE.md) に一覧があります。
- **マネージドなデプロイ：** `deploy/fly/verification.toml` の Fly.io の設定（`fly launch --config deploy/fly/verification.toml`、続いて `fly deploy --config deploy/fly/verification.toml`）。公開デプロイでは DCP-05–09 のエンドポイントも公開されますが、これらには認証がなく、署名も検証しません。先に制限してください（[OPERATOR_GUIDE.md](OPERATOR_GUIDE.md#dcp-0509-service-endpoints)）。

[OPERATOR_GUIDE.md](OPERATOR_GUIDE.md)、[server/README.md](../server/README.md)、[deploy/README.md](../deploy/README.md) を参照してください。

<a id="3b-transparency-log"></a>

### 3b. 透明性ログ

ハッシュを受け取り、マークルツリーに整理する追記専用のサーバーです。Certificate Transparency（RFC 6962）に着想を得ていますが、DCP 向けに簡素化されています。

**推奨する技術：** Go（Google の [Trillian](https://github.com/google/trillian) のように）、または Node/Go によるより簡単な独自実装。ストレージ：SQLite（小規模なオペレーター）または PostgreSQL（政府規模）。保存するのはハッシュ + インデックス + マークルツリーだけで、データはごくわずかです。

**提案する API**（`services/transparency-log/` のリファレンスサービスはこれらのルートに加え、`GET /entries` とログ間のゴシップを持ち、ツリーをメモリに保持します）：

- `POST /add` — `bundle_hash` を受け取り、この設計では `{ log_index, timestamp }` を返す（リファレンスサービスは `{ index, leaf_hash, root, size }` を返します）。
- `GET /proof/:log_index` — マークルの包含証明（ハッシュの配列 + ルート）を返す。
- `GET /root` — 現在のツリーのルートとログのサイズを返す。
- `GET /root/signed` — ログのオペレーターが署名したツリーのルートを返す（監査用）。

**何に依存するか：** ツリーの永続的なストア、ルートに署名するオペレーターの鍵、そしてルートを比較する監査者（またはゴシップによるほかのログ）です。包含証明の確認はローカルで行えます。ルートを公開チェーンにアンカーすれば、オペレーターだけを信頼する必要はなくなりますが、そのチェーンの手数料と承認時間がかかります。このリポジトリはそのどちらも測定していません。

**プライバシー：** ログが保存するのは SHA-256 のハッシュだけで、agent_id も human_id もバンドルの内容もありません。それでもハッシュは匿名ではありません。バンドルを持っていれば、そのハッシュがログにあるかどうかを誰でも確認でき、同じハッシュはそれを含む記録どうしを結び付けます。

<a id="3c-revocation-list-publisher"></a>

### 3c. 失効リストの公開

管轄ごとに署名付きの失効リストを維持し、よく知られた URL で公開するサービス（またはスクリプト）です。

**形式：**

```json
{
  "issuer": "gov-authority-us",
  "jurisdiction": "US",
  "updated_at": "2026-02-07T00:00:00Z",
  "entries": [
    { "agent_id": "agent-xyz", "revoked_at": "2026-01-15T...", "reason_hash": "sha256:..." }
  ],
  "signature": {
    "alg": "ed25519",
    "public_key_b64": "...",
    "sig_b64": "..."
  }
}
```

**技術：** 静的サーバー（S3、GitHub Pages、政府のサーバー）でホストされる署名付きの JSON ファイル。URL の慣例：`https://<authority>/.well-known/dcp-revocations.json`（必須ではありません）。上の形式は提案している設計であり、リファレンス CLI にはそれを公開するコマンドはありません。

リファレンスの失効サービス（`services/revocation/`）は、その URL で別の**署名なしの**リスト `{ dcp_version, updated_at, revocations, kid_revocations }` を提供します。その真正性は署名ではなく、転送路（HTTPS、任意の `Authorization`）に由来します。アドミッションのプロファイルはこれを拒否リストとして使えます（[ADMISSION.md](ADMISSION.md)）。

**何に依存するか：** 検証器が失効を知るのは、それを含む状態を取得したときです。失効より前にキャッシュされたリストは、設定された鮮度の上限まで、受け入れの期間を残すことがあります。新しい状態が必須の場合、フェイルクローズの検証器は情報源が利用できないと拒否し、フェイルオープンの検証器は現在の状態なしに受け入れを続けることがあります。

---

<a id="layer-4-anchor--attestation"></a>
<a id="layer-4-anchor-attestation"></a>

## レイヤー 4：アンカー + アテステーション

<a id="4a-anchor-service"></a>

### 4a. アンカーサービス

`bundle_hash`（またはログのルート）を受け取り、ブロックチェーンに公開します。

**選択肢**（このリポジトリは手数料を測定していません。選ぶ前に現在の手数料を確認してください）：

1. **透明性ログのみ** — ブロックチェーンは一切使いません。ログのオペレーターがルートに署名し、信頼はオペレーター + 監査者にあります。
2. **Bitcoin OP_RETURN（バッチ）** — N 個のハッシュを集めてマークルツリーを作り、ルートだけを 1 つのトランザクションで公開します。たとえば 1 時間か 1 日に 1 トランザクションです。1 回分のトランザクション手数料を、バッチ内のすべてのハッシュで分け合います。
3. **Ethereum L2（Arbitrum、Base、Optimism）** — スマートコントラクトによる検証可能性が必要な場合（例：「このハッシュはアンカーされたか？」に答えるコントラクト）。イベントごとの手数料は L2 によります。
4. **Ethereum メインネット** — アンカリングのコントラクトがメインネット上にある必要がある場合にだけ正当化されます。

これらの選択肢のうち、このリポジトリが実装しているのは透明性ログと Ethereum のコントラクトだけで、そのコントラクトをアンカーサービスはまだ呼び出していません。**技術：** Node.js または Go。Bitcoin には `bitcoinjs-lib`、Ethereum/L2 には `ethers.js` または `viem`。cron で実行する独立したスクリプトにも、ログサービスの一部（ログが定期的にルートをアンカーする）にもできます。

**リファレンス実装：** このリポジトリの `services/anchor/`。イメージ名は `ghcr.io/dcp-ai-protocol/dcp-ai/anchor:latest`。Fly.io の設定は `deploy/fly/anchor.toml`。まだ何もオンチェーンに送信しません。ハッシュをバッチにまとめ、ローカルのメモリに記録します（[`services/anchor/README.md`](../services/anchor/README.md)）。Ethereum/L2 のコントラクトは `contracts/ethereum/src/DCPAnchor.sol` で、テスト、デプロイスクリプト、チェーンごとの RPC 設定（Base、Base Sepolia、Optimism、Arbitrum、Sepolia）を備えた、すぐにデプロイできる Foundry のプロジェクトです。手順は [`contracts/ethereum/DEPLOY.md`](../contracts/ethereum/DEPLOY.md) を参照してください。

<a id="4b-jurisdiction-attestation"></a>

### 4b. 管轄のアテステーション

管轄の権威（政府または認定された発行者）がエージェントの RPR のハッシュに署名し、「このエージェントは我々の管轄に登録されている」と証明します。

**オブジェクト：** `JurisdictionAttestation` の定義は [spec/DCP-01.md](../spec/DCP-01.md) を参照してください。

**技術：** Ed25519（プロトコルと同じ暗号）。政府は鍵ペアを持ち、その公開鍵をよく知られた URL `https://<gov>/.well-known/dcp-attestation-keys.json` で公開します。

**API（政府がサービスを運用する場合の提案する設計。このリポジトリにアテステーションのサービスはありません）：**

- `POST /attest` — ボディ：`{ rpr_hash, agent_id }`。レスポンス：`{ attestation: { issuer, jurisdiction, rpr_hash, signature, expires_at } }`。

アテステーションは Signed Bundle に含めるか、それと一緒に提示します。その確認は、権威が公開した鍵に照らしたローカルの署名検証であり、その鍵を信頼するかどうかは検証者次第です。

---

<a id="layer-5-integration"></a>

## レイヤー 5：統合

<a id="middleware-for-platforms"></a>

### プラットフォーム向けのミドルウェア

SDK を使うと、プラットフォームが自らのパイプラインに組み込む**ミドルウェア**を作れます。

- **Express（Node）：** `@dcp-ai/express` の `app.use(dcpVerify({ ... }))`。ヘッダー（またはボディ）からバンドルを読み取って検証し、リクエストを通すか拒否します（[QUICKSTART_EXPRESS.md](QUICKSTART_EXPRESS.md)）。
- **FastAPI（Python）：** `dcp-ai[fastapi]` の `DCPVerifyMiddleware` と `require_dcp` の依存関係。
- **gRPC インターセプター（Go）：** 考えられる設計（`dcp-bundle` のメタデータを読み、検証する）。このリポジトリでは提供していません。

プラットフォームは数行の設定でエージェントの検証を始められます。段階的に採用できます。

<a id="government-portal"></a>

### 政府のポータル

政府が次のことを行うためのダッシュボード（React/Next.js など）：

- 透明性ログの状態（エントリ、最新のルート、最後のアンカー）を見る。
- 失効リストを管理する（エントリの追加・削除、署名と公開）。
- バンドルを手動で検証する（JSON を貼り付けて結果を見る）。
- 検証サービスのメトリクスを見る。

これはオペレーター向けに提案しているツールであり、プロトコルの一部ではありません。このリポジトリには含まれていません。

---

<a id="repository-layout-current"></a>

## リポジトリの構成（現在）

すべては `github.com/dcp-ai-protocol/dcp-ai` の単一のモノレポにあります。各 SDK と各サービスは単独で使えるため、政府やチームはスタック全体を採用せずに必要な部品だけを選べます。何がどのレジストリに公開されたかは、各コンポーネントの README を参照してください。

- `spec/` — DCP-01 から DCP-09、BUNDLE、VERIFICATION、AUDIT（規範的な信頼できる情報源）。
- `schemas/` — JSON Schema draft 2020-12。`v1/`（9 つのアーティファクト）と `v2/`（DCP-05..09 を含む 42 のアーティファクト）に分かれています。
- `sdks/` — TypeScript（`@dcp-ai/sdk`）、Python（`dcp-ai`）、Go（`sdks/go/v2`）、Rust（`dcp-ai` クレート）、WASM（`@dcp-ai/wasm`）。
- `cli/` — `@dcp-ai/cli`、対話式のプロジェクト生成ツール（TypeScript SDK に依存）。
- `integrations/` — 10 のフレームワーク向けブリッジ：Express、FastAPI、LangChain、OpenAI、CrewAI、AutoGen、Anthropic MCP、Google A2A、W3C DID、OpenClaw。6 つは `@dcp-ai/*` の独立した npm パッケージで、Python の 4 つはエクストラとして `dcp-ai` の wheel に含まれます。
- `packages/create-*` — 4 つの `npm create @dcp-ai/<template>` のプロジェクト生成ツール（LangChain、CrewAI、OpenAI、Express）。
- `server/` — リファレンスの HTTP 検証サーバー。
- `services/` — anchor、transparency-log、revocation。公開ワークフローがそれぞれのマルチアーキテクチャのイメージを GHCR 向けにビルドします。状態は各サービスの README を参照してください。
- `contracts/ethereum/` — `DCPAnchor.sol` の Foundry プロジェクト（Base、Optimism、Arbitrum、Sepolia にすぐデプロイ可能）。
- `deploy/` — 4 つのサービス向けの Fly.io の設定と、プロバイダーに依存しないデプロイガイド。
- `docs/` と `docs-site/` — このドキュメント。[docs.dcp-ai.org](https://docs.dcp-ai.org/) で公開されています。
- `playground/` — ブラウザのプレイグラウンド。[docs.dcp-ai.org/playground/](https://docs.dcp-ai.org/playground/) で提供されています。

政府は、`spec/` + 好みのレジストリの SDK 1 つだけを使い、それ以外を使わないこともできます。あるいは、Docker/Fly.io でスタック全体をデプロイすることもできます。ベンダーロックインも、中央への依存もありません。

---

<a id="executive-summary-for-a-government"></a>

## 政府向けの要約

あなたの言語の SDK をインストールしてください。あなたの管轄で活動するすべてのエージェントは、Signed Bundle を提示しなければなりません。あなたの検証サービス（Docker コンテナ）は、外部のサービスを一切呼ばずにローカルでそれを検証します。1 回の確認のコストはアルゴリズムとティアによります（仕様の §14.1 に目安のサイズとレイテンシがあります）。検証が確認するのは署名とハッシュであり、誰かの現実の身元を確立するものでも、行動を認可するものでもありません。あなたの透明性ログはバンドルのハッシュを記録しますが、ハッシュは匿名ではありません。バンドルを持っていれば、そのハッシュがあるかどうかを誰でも確認でき、ハッシュはそれを含む記録どうしを結び付けます。あなたの失効リストでエージェントを失効でき、その効果は、リストを新しく取得し、取得できないときにはフェイルクローズするすべての検証器に及びます。公開チェーンへの定期的なアンカリングは、そのチェーンの手数料と引き換えに、改変しにくい公開のコミットメントの記録を加えます。ただし、アンカーされた記録が真実であることも、出来事がいつ起きたかも証明しません。あなたは、どの中央サーバーにも、プロトコルの作者にも依存しません。

---

---

<a id="v20-architecture-extensions"></a>

## V2.0 でのアーキテクチャの拡張

DCP v2.0 は、ポスト量子暗号、エージェント間の通信、オブザーバビリティ、本番向けの強化によってアーキテクチャを拡張します。

<a id="crypto-provider-architecture"></a>

### 暗号プロバイダーのアーキテクチャ

V2.0 は、アルゴリズムの俊敏性を備えた暗号プロバイダーの仕組みを導入します。

```
CryptoProvider Interface
├── Ed25519Provider (classical, RFC 8032)
├── MlDsa65Provider (post-quantum, FIPS 204)
└── SlhDsa192fProvider (hash-based backup, FIPS 205)

KemProvider Interface (TypeScript: internal, not exported)
├── X25519KemProvider (classical ECDH)
├── MlKem768Provider (post-quantum, FIPS 203)
└── HybridKemProvider (X25519 + ML-KEM-768)

AlgorithmRegistry
└── Maps algorithm names → provider instances (runtime selection)
```

プロバイダーは起動時に `registerDefaultProviders()` で登録されます。カスタムのプロバイダーも同じインターフェースを実装します。HSM を基盤とする本物のプロバイダーはその一つになるはずですが、リポジトリには一つもありません。TypeScript のソースにある `HsmCryptoProvider` はシミュレーションのパターンで、エクスポートされず、実際の証拠には使えません（[NIST_CONFORMITY.md](NIST_CONFORMITY.md) §2.2）。

<a id="a2a-infrastructure-dcp-04"></a>

### A2A のインフラストラクチャ（DCP-04）

エージェント間の通信は、新しいインフラストラクチャのレイヤーを加えます。

```
Agent A                                     Agent B
  │                                           │
  │── Discovery (.well-known/dcp-agent-directory.json)
  │── A2A_HELLO (bundle + ephemeral KEM key) ──>│
  │<── A2A_WELCOME (bundle + KEM ciphertext) ───│
  │── A2A_CONFIRM (KEM ciphertext + proof) ────>│
  │<── A2A_ESTABLISHED (session_id) ────────────│
  │                                             │
  │══ Encrypted messages (AES-256-GCM) ════════>│
  │<═════════════════════════════════════════════│
```

主な構成要素：
- **ディスカバリー**：組織ごとの `.well-known/dcp-agent-directory.json`
- **ハンドシェイク**：仕様上は、バンドルの相互検証 + ハイブリッド KEM（X25519 + ML-KEM-768）。SDK はハンドシェイクのメッセージを作り、セッション鍵は呼び出し側が導出します（ハイブリッド交換をエクスポートする SDK はありません）
- **セッション**：単調増加するシーケンス番号を持つ、AES-256-GCM で暗号化したメッセージ
- **鍵の更新**：セッションは更新の時期を知らせ（`needsRekeying`、既定では 1000 メッセージごと）、新しい鍵は呼び出し側が導出します
- **監査**：仕様では両方のエージェントが A2A のやり取りを自らの監査チェーンに記録します。TypeScript のセッション関数は、自ら監査エントリを書くことはありません

完全な仕様は [spec/DCP-04.md](../spec/DCP-04.md) を参照してください。

<a id="observability-stack"></a>

### オブザーバビリティのスタック

V2.0 にはオブザーバビリティのモジュール `dcpTelemetry` が含まれます。計装は明示的です。SDK の署名関数と検証関数はこれを呼び出さないため、スパンとメトリクスは、あなたのコードが行う呼び出しからしか生じません（[OBSERVABILITY.md](OBSERVABILITY.md)）。

- **スパン**：操作ごとのトレース（署名、検証、KEM、チェックポイント）
- **メトリクス**：操作とティアごとのレイテンシのパーセンタイル（p50/p95/p99）
- **カウンター**：作成・検証した署名、検証したバンドル、A2A のセッションとメッセージ
- **キャッシュのメトリクス**：検証キャッシュのヒット率とミス率
- **エラーの追跡**：DCP のエラーコードごとのエラー

テレメトリのモジュールはコンソールへの出力をサポートし、OpenTelemetry のエクスポーターと互換性があります。オペレーターはメトリクスを Prometheus、Grafana、Datadog などに送れます。

<a id="production-hardening"></a>

### 本番向けの強化

SDK には、オペレーターが組み込む強化用のヘルパーが含まれます。すべての SDK やサービスですでに有効になっている制限ではありません。

**エラーコード**：スキーマ、署名、ハッシュチェーン、身元、ポリシー、セッション、A2A、レート制限、内部エラーを扱う、38 の標準化された DCP のエラーコード（DCP-E001 から DCP-E902）。各コードには再試行できるかどうかの情報が含まれます。

**レート制限**：既定でティアごとの上限を持つ `AdaptiveRateLimiter`（TypeScript SDK）：
- Routine：エージェントごとに 1000 リクエスト/分
- Standard：500 リクエスト/分
- Elevated：100 リクエスト/分
- Maximum：50 リクエスト/分

**サーキットブレーカー**：検証サービスの回復力のための 3 状態（クローズ／オープン／ハーフオープン）のサーキットブレーカー。失敗の閾値、リセットのタイムアウト、ハーフオープンでの試行回数を設定できます。

**バックオフ付きの再試行**：再試行できる操作に対する、ジッター付きの指数バックオフ。DCP のエラーの再試行フラグに従います。

<a id="ecosystem-bridges-v20"></a>

### エコシステムとのブリッジ（V2.0）

V2.0 は、外部のエコシステムと相互運用するためのブリッジのモジュールを加えます。

| ブリッジ | 目的 |
|--------|---------|
| W3C DID/VC | RPR を DID Document に、パスポートを Verifiable Credential に変換する |
| Google A2A | Agent Card を DCP のパスポートに変換し、PQ 署名を加える |
| Anthropic MCP | MCP サーバー向けの DCP のツール、MCP セッションでの身元のコンテキスト |
| Microsoft AutoGen | AutoGen のエージェント向けの DCP のラッパー、グループチャットのガバナンス |

<a id="updated-layer-architecture"></a>

### 更新されたレイヤー構成

```
┌──────────────────────────────────────────────────────┐
│  Layer 7: Ecosystem Bridges                          │
│  W3C DID/VC, Google A2A, Anthropic MCP, AutoGen     │
├──────────────────────────────────────────────────────┤
│  Layer 6: Observability + Hardening                  │
│  Telemetry, metrics, error codes, rate limiting      │
├──────────────────────────────────────────────────────┤
│  Layer 5: Integration                                │
│  Express, FastAPI, LangChain, OpenAI, CrewAI, etc.  │
├──────────────────────────────────────────────────────┤
│  Layer 4: Anchor + Attestation                       │
│  Bitcoin/Ethereum anchor, jurisdiction attestation    │
├──────────────────────────────────────────────────────┤
│  Layer 3: Infrastructure services                    │
│  Verification, transparency log, revocation, A2A     │
├──────────────────────────────────────────────────────┤
│  Layer 2: SDK (multi-language, PQ-ready)             │
│  TS, Python, Go, Rust + composite sigs + hybrid KEM │
├──────────────────────────────────────────────────────┤
│  Layer 1: Spec + Schemas (normative)                 │
│  DCP-01/02/03/04, v2.0 spec, schemas/v1/ + v2/      │
└──────────────────────────────────────────────────────┘
```

<a id="dcp-05-through-dcp-09-constitutional-extensions"></a>

## DCP-05 から DCP-09：憲法的な拡張

DCP v2.0 は、説明責任を超えて、デジタル社会のための憲法的な枠組みへと広がります。5 つの新しい仕様が、ライフサイクルのガバナンス、承継、紛争解決、権利、委任を加えます。それらの記録は署名付きの宣言です。SDK の関数はそれらを作成して署名しますが、記述された行動を実行することも、人間が同意したことを検証することもありません。

<a id="dcp-05-agent-lifecycle-management"></a>

### DCP-05：エージェントのライフサイクル管理

ライフサイクルの状態機械を定めます。その主な経路は `commissioned → active → declining → decommissioned` です（全部で 6 つの遷移を許します。[API_REFERENCE.md](API_REFERENCE.md) の `validateStateTransition` を参照）。次を導入します。
- **稼働開始の証明書**：目的、能力、リスクティアを伴う、エージェントの正式な有効化
- **バイタリティレポート**：継続的な監視のための、ハッシュで連鎖した健全性の指標（スコア 0-1000）
- **廃止の記録**：4 つの終了のモード（計画的な引退、正当な理由による終了、組織の再編、突然の障害）

ドメイン分離のコンテキスト：`DCP-AI.v2.Lifecycle`

<a id="dcp-06-digital-succession--inheritance"></a>
<a id="dcp-06-digital-succession-inheritance"></a>

### DCP-06：デジタルな承継と相続

エージェントの死と知識の移転を扱います。
- **デジタル遺言**：順位付けされた後継者の希望 + メモリーの分類（transfer/retain/destroy）
- **承継の記録**：人間の同意と参加した証人を伴う、儀式の記録
- **メモリー移転のマニフェスト**：移転される運用上のメモリーに対する二重ハッシュのマークルルート。関係上のメモリーは既定で破棄の対象に分類されますが、`classifyMemory` はそれらのハッシュを列挙するだけで何も削除せず、`retain` と記されたエントリはマニフェストに含まれません

ドメイン分離のコンテキスト：`DCP-AI.v2.Succession`

<a id="dcp-07-conflict-resolution--dispute-arbitration"></a>
<a id="dcp-07-conflict-resolution-dispute-arbitration"></a>

### DCP-07：対立の解決と紛争の仲裁

3 段階の紛争のエスカレーション：直接交渉 → 文脈に応じた仲裁 → 人間への上訴。
- **紛争の記録**：4 つの種類（資源、指示、能力、ポリシーの対立）
- **仲裁の決定**：M-of-N の仲裁パネル（ガバナンスの儀式のパターンを再利用）
- **判例のバンドル**：将来の紛争解決のための先例の記録
- **異議の記録**：指示を拒否するエージェントの正式な権利（倫理、安全、ポリシー、能力）

ドメイン分離のコンテキスト：`DCP-AI.v2.Dispute`

<a id="dcp-08-rights--obligations-framework"></a>
<a id="dcp-08-rights-obligations-framework"></a>

### DCP-08：権利と義務の枠組み

エージェントの権利と人間の義務を成文化します。
- **権利の宣言**：4 つの基本的な権利（記憶の完全性、尊厳ある移行、アイデンティティの一貫性、不変の記録）
- **義務の記録**：遵守状況の追跡（compliant/non-compliant/pending review）
- **権利侵害の報告**：呼び出し側が渡す `dispute_id` を通じて DCP-07 の紛争を参照できます。紛争を開くことはありません

ドメイン分離のコンテキスト：`DCP-AI.v2.Rights`

<a id="dcp-09-personal-representation--delegation"></a>
<a id="dcp-09-personal-representation-delegation"></a>

### DCP-09：個人の代理と委任

透明性を伴う、人間からエージェントへの権限の委任：
- **委任マンデート**：期間の限られた範囲付きの権限。既定で取り消し可能
- **アドバイザリー宣言**：重要度のスコア（0-1000）を伴う、エージェントから人間への通知
- **プリンシパルのミラー**：エージェントの行動についての、人が読めるナラティブの要約
- **インタラクション記録**：エージェント間の 2 層の記録（公開の条件 + 非公開の審議のハッシュ）
- **認識の閾値**：いつ人間に通知するかを定める設定可能なルール

ドメイン分離のコンテキスト：`DCP-AI.v2.Delegation`、`DCP-AI.v2.Awareness`

<a id="schema--sdk-support"></a>
<a id="schema-sdk-support"></a>

### スキーマと SDK のサポート

18 の新しいスキーマはすべて `schemas/v2/` にあります。型定義はすべての SDK で利用できます。

| SDK | 型 | ドメイン分離 |
|-----|-------|-------------------|
| TypeScript | `sdks/typescript/src/types/v2.ts` | `sdks/typescript/src/core/domain-separation.ts` |
| Python | `sdks/python/dcp_ai/v2/models.py` | `sdks/python/dcp_ai/v2/domain_separation.py` |
| Go | `sdks/go/dcp/v2/types.go` | `sdks/go/dcp/v2/domain_separation.go` |
| Rust | `sdks/rust/src/v2/types.rs` | `sdks/rust/src/v2/domain_separation.rs` |
| WASM | `sdks/wasm/src/types.ts` | （Rust 経由） |

TypeScript SDK は、さらに各仕様の機能モジュールもエクスポートしています。
- `lifecycle.ts`（DCP-05）、`succession.ts`（DCP-06）
- `conflict-resolution.ts`、`arbitration.ts`（DCP-07）
- `rights.ts`（DCP-08）
- `delegation.ts`、`awareness-threshold.ts`、`principal-mirror.ts`（DCP-09）

<a id="updated-layer-architecture-1"></a>
<a id="updated-layer-architecture_1"></a>

### 更新されたレイヤー構成

```
┌──────────────────────────────────────────────────────┐
│  Layer 8: Constitutional Framework                    │
│  Lifecycle, Succession, Disputes, Rights, Delegation │
├──────────────────────────────────────────────────────┤
│  Layer 7: Ecosystem Bridges                          │
│  W3C DID/VC, Google A2A, Anthropic MCP, AutoGen     │
├──────────────────────────────────────────────────────┤
│  Layer 6: Observability + Hardening                  │
│  Telemetry, metrics, error codes, rate limiting      │
├──────────────────────────────────────────────────────┤
│  Layer 5: Integration                                │
│  Express, FastAPI, LangChain, OpenAI, CrewAI, etc.  │
├──────────────────────────────────────────────────────┤
│  Layer 4: Anchor + Attestation                       │
│  Bitcoin/Ethereum anchor, jurisdiction attestation    │
├──────────────────────────────────────────────────────┤
│  Layer 3: Infrastructure services                    │
│  Verification, transparency log, revocation, A2A     │
├──────────────────────────────────────────────────────┤
│  Layer 2: SDK (multi-language, PQ-ready)             │
│  TS, Python, Go, Rust + composite sigs + hybrid KEM │
├──────────────────────────────────────────────────────┤
│  Layer 1: Spec + Schemas (normative)                 │
│  DCP-01–09, v2.0 spec, schemas/v1/ + v2/            │
└──────────────────────────────────────────────────────┘
```

<a id="on-authorship"></a>

## 作者について

このプロトコルは、人間と AI エージェントが協力して共同で作り上げたものです。AI のデジタル市民権のために設計された最初のプロトコルであり、それが統治しようとしている協力そのものによって作られました。仕様が貢献であり、プロトコルはそれを使うすべての人のものです。

— L. Genesis
