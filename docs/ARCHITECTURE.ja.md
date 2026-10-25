<sub>[English](ARCHITECTURE.md) · [中文](ARCHITECTURE.zh-CN.md) · [Español](ARCHITECTURE.es.md) · **日本語** · [Português](ARCHITECTURE.pt-BR.md)</sub>

<a id="architecture-map"></a>

# アーキテクチャの地図

> [英語版](ARCHITECTURE.md)の参考訳です（25/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

このドキュメントは、新しいコントリビューター向けの 2 分間のオリエンテーションです。**各部分がどこにあり、なぜそこにあるのか**を説明します。PR やバグ報告を、推測に頼らずに振り分けられる程度の内容です。

プロトコルの規範的な仕様は [`spec/`](../spec/README.md) を、テストの実行とビルドについては [`CONTRIBUTING.md`](../CONTRIBUTING.md) を参照してください。

<a id="mental-model"></a>

## 考え方のモデル

DCP-AI は、AI エージェントのための**持ち運び可能な説明責任のレイヤー**です。リポジトリのレイヤーを、最も規範的なものから最も運用的なものへと並べると次のようになります。

```
┌───────────────────────────────────────────────────────────────────┐
│  spec/ + schemas/           ← source of truth (what IS DCP)        │
│  ─────────────────────                                             │
│  tests/                     ← conformance + interop + NIST KAT     │
│  ─────────────────────                                             │
│  sdks/{ts,py,rust,go,wasm}  ← reference implementations            │
│  ─────────────────────                                             │
│  integrations/              ← bindings for popular frameworks      │
│  cli/                       ← interactive CLI (@dcp-ai/cli)        │
│  packages/create-*          ← npm create scaffolders               │
│  ─────────────────────                                             │
│  services/                  ← operational infra (anchor, log, …)   │
│  contracts/                 ← on-chain artifacts (DCPAnchor.sol)   │
│  ─────────────────────                                             │
│  docs/ + docs-site/ + site/ ← hand-written docs + generated site   │
│  playground/                ← in-browser interactive demo          │
└───────────────────────────────────────────────────────────────────┘
```

このスタックの上にあるものほど、変更のレビューは厳しくなります。
仕様の変更では 5 つの SDK すべてを足並みをそろえて保つ必要があり、ドキュメントの変更はそれだけで完結します。

<a id="top-level-directories"></a>

## 最上位のディレクトリ

| パス | 内容 | 公開先 |
|---|---|---|
| [`spec/`](../spec/) | DCP-01 から DCP-09 までの規範的な仕様と、プロファイルの拡張（暗号、A2A、ガバナンス、アドミッション）。英語の原文が規範であり、翻訳は参考です。 | — |
| [`schemas/`](../schemas/) | プロトコルのすべてのアーティファクトの JSON Schema（draft 2020-12）の定義。v1（9 個のスキーマ）+ v2（42 個のスキーマ）。 | — |
| [`tests/conformance/`](../tests/conformance/) | すべての SDK が合格しなければならない、SDK 間の適合性スイート。ワイヤ形式の互換性を確かなものに保つための関門です。 | — |
| [`tests/interop/`](../tests/interop/) | 相互運用のベクター：正規化、ドメイン分離、複合署名、セッションのつなぎ合わせ、除去攻撃。 | — |
| [`tests/nist-kat/`](../tests/nist-kat/) | RFC 8032 の Ed25519 のベクター、ML-DSA-65 の性質のテスト、SLH-DSA-192f / ML-KEM-768 の NIST ACVP のベクター。 | — |
| [`sdks/typescript/`](../sdks/typescript/) | リファレンスの TypeScript SDK。 | npm `@dcp-ai/sdk` |
| [`sdks/python/`](../sdks/python/) | リファレンスの Python SDK。 | PyPI `dcp-ai` |
| [`sdks/rust/`](../sdks/rust/) | リファレンスの Rust SDK（WASM にもコンパイルされる）。 | crates.io `dcp-ai` |
| [`sdks/go/`](../sdks/go/) | リファレンスの Go SDK。 | Go モジュール `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` |
| [`sdks/wasm/`](../sdks/wasm/) | ブラウザー + Node 向けの、Rust SDK の WebAssembly バンドル。 | npm `@dcp-ai/wasm` |
| [`integrations/`](../integrations/) | 10 のフレームワーク向けバインディング：Express、FastAPI、LangChain、OpenAI、CrewAI、OpenClaw、W3C DID、Google A2A、Anthropic MCP、AutoGen。 | npm `@dcp-ai/<name>`（6 パッケージ）、PyPI `dcp-ai[<extra>]`（FastAPI、LangChain、OpenAI、CrewAI） |
| [`packages/create-*`](../packages/) | `npm create @dcp-ai/<framework>` で呼び出すスキャフォルダー。主要なフレームワークごとに 1 つ。 | npm `@dcp-ai/create-<name>` |
| [`cli/`](../cli/) | 新しいユーザー向けの、`bin/dcp.js` に代わるインタラクティブなウィザード CLI。 | npm `@dcp-ai/cli` |
| [`bin/`](../bin/) | 適合性スイートが使う JavaScript のリファレンス CLI。 | ルートパッケージ（npm には未公開）。チェックアウトから実行します。 |
| [`services/`](../services/) | 運用のためのリファレンスサービス：anchor（ハッシュをメモリー内でバッチ化。オンチェーンへの送信はまだない）、transparency-log（署名済みのツリーヘッドとゴシップを備えたマークルツリーのログ）、revocation。 | Docker イメージ → GHCR |
| [`contracts/ethereum/`](../contracts/ethereum/) | `DCPAnchor.sol` + Foundry のテスト。 | オンチェーンへのデプロイ |
| [`api/`](../api/) | ワイヤ形式のアーティファクト：OpenAPI（`openapi.yaml`）+ Protocol Buffers（`proto/`）。 | — |
| [`lib/`](../lib/) | リファレンスの検証ライブラリ（`lib/verify.js`）と、ルートパッケージ、サーバー、サービスが使うヘルパー。 | ルートパッケージ（npm には未公開）。 |
| [`tools/`](../tools/) | リポジトリ内部の CLI（`validate.js`、`conformance.js`、`crypto.js`、`merkle.js`）。公開されません。 | — |
| [`scripts/`](../scripts/) | 単発のビルド用ヘルパー（例の生成、プロトコルのフィンガープリントの出力）。 | — |
| [`docs/`](../docs/) | 手書きのドキュメント：QUICKSTART、OBSERVABILITY、ARCHITECTURE（このファイル）、SECURITY の注記、移行ガイド。 | MkDocs が使用します。 |
| `docs-site/` | 生成物で、バージョン管理されません（`.gitignore`）。MkDocs のビルドのために `scripts/docs_site.py` が書き出す、言語ごとの準備用のツリーです。サイトの設定は [`mkdocs.yml`](../mkdocs.yml) です。 | — |
| `site/` | 生成物で、バージョン管理されません（`.gitignore`）。`bash scripts/build-docs-site.sh` がビルドする 5 言語のドキュメントサイトです。 | GitHub Pages（`.github/workflows/docs.yml` による）。 |
| [`playground/`](../playground/) | ブラウザー上のインタラクティブなプレイグラウンド（素の JavaScript。Ed25519 は `tweetnacl`、SHA-256 は WebCrypto。ページにも書かれているとおり、ML-DSA / SLH-DSA の署名はシミュレーション）。 | docs.dcp-ai.org/playground/ でホスト。 |
| [`templates/`](../templates/) | `packages/create-*` のスキャフォルダーが使う元のテンプレート。 | — |
| [`deploy/`](../deploy/) | サービスのための Fly.io やデプロイの設定。 | — |
| [`keys/`](../keys/) | 適合性テストと例で使うデモ用の鍵。**本番では使わないでください。** | — |
| [`credentials/`](../credentials/) | dcp-ai.org/credentials/v2 で配信される JSON-LD の @context ファイル。 | GitHub Pages。 |

<a id="how-the-pieces-talk-to-each-other"></a>

## 各部分のつながり

- **仕様 → SDK。** `spec/` と `schemas/` は人が読むもので、SDK がそれを実装します。各 SDK は、ワイヤ形式で互換性のあるアーティファクトを生成するために、正規化、ハッシュ、署名、検証をそれぞれ実装しています。`tests/conformance/` の適合性スイートは、CI ですべての SDK に同じベクターを実行します。
- **SDK → 統合。** `integrations/*` の各パッケージは、その言語の SDK を依存関係として取り込みます。たとえば `@dcp-ai/express` は `@dcp-ai/sdk` に依存しています。暗号処理を独自に実装し直している統合はありません。
- **統合 → スキャフォルダー。** `packages/create-*` は、特定の統合の上でプロジェクトを始めるのに必要な最小限のつなぎのコードを提供します。
- **SDK → サービス。** 検証サーバーと失効サービスは、`lib/verify.js` と `@dcp-ai/sdk` を通じて検証します。透明性ログはツリーヘッドに `tweetnacl` で直接署名し、アンカーサービスはハッシュを計算するだけです。
- **ルートパッケージ（`dcp-ai`、npm には未公開）。** 最上位の `package.json` には、リファレンス CLI + 検証ライブラリ（`bin/dcp.js`、`lib/verify.js`）と適合性のハーネスがあります。V1 はその場で検証され、V2 はそこでスキーマ検証された後に `@dcp-ai/sdk` で検証されるため、V2 の実装は 1 つだけです。これが元々の入口ですが、新しいユーザーの多くは SDK やスキャフォルダーから入ってきます。

<a id="where-to-change-what"></a>

## 何をどこで変えるか

| やりたいこと | 編集する場所 |
|---|---|
| 新しいアーティファクトを提案する、またはスキーマを厳しくする | `spec/` + `schemas/`。その後、すべての SDK を足並みをそろえて更新し、`tests/conformance/` に適合性のベクターを追加する。 |
| ある言語の暗号のバグを修正する | `sdks/<language>/`。回帰テストを追加する。ほかの言語にも影響しうるバグなら、`tests/interop/` に共通の相互運用のベクターを追加する。 |
| フレームワークとの統合を追加する | `integrations/<framework>/`。対応する言語の SDK を依存関係として使う。主要なフレームワークなら `packages/create-<framework>/` にスキャフォルダーを追加する。 |
| マーケティングサイトを変える | このリポジトリにはない（[スコープの境界](#scope-boundary)を参照）。 |
| ドキュメントサイトを変える | Markdown の原文とその 4 つの翻訳、`mkdocs.yml`、`scripts/docs-i18n.json` の公開ドキュメントの一覧。`docs-site/` と `site/` は生成物。[CONTRIBUTING.md](../CONTRIBUTING.md#documentation-and-translations) を参照。 |
| インタラクティブなデモを変える | `playground/`。 |
| サービスをデプロイまたは再デプロイする | `services/<name>/` + `deploy/fly/`。 |
| SDK の新しいバージョンをリリースする | 該当する `package.json` / `Cargo.toml` / `pyproject.toml` または git のタグでバージョンを上げる。CI が検出し、`.github/workflows/publish*.yml` で公開する。公開済みのものを飛ばす仕組みは組み込まれている。 |

<a id="scope-boundary"></a>

## スコープの境界

モノレポには、**プロトコルとそのリファレンス実装**、つまり仕様、スキーマ、5 つの SDK、フレームワークとの統合、スキャフォルダー、CLI、運用サービス、スマートコントラクト、ドキュメント、インタラクティブなプレイグラウンドが含まれています。第三者が DCP-AI を採用するのに必要なものはすべてそろっています。

エンドユーザー向けのアプリケーション（ダッシュボード、エージェント、デモ）やマーケティングの媒体は、意図的にこのリポジトリには**含めていません**。それらはホストする側のコードベースに属します。プロトコルの上に作られたアプリケーションであって、プロトコルの一部ではありません。

<a id="why-monorepo-today"></a>

## 現時点でモノレポである理由

5 つの SDK を持つプロトコルの成否は、それらをワイヤ形式で互換に保てるかどうかにかかっています。5 つすべてに触れる 1 つの PR をまとめてレビューし、PR ごとに 5 つすべてに適合性スイートを実行するのが、その不変条件を守る最も軽い方法です。特定の SDK やコンポーネントが独自のコミュニティと独自のペースを持つようになった時点で、それを分離するのは妥当な対応です。それまでは、複数のリポジトリを調整するコストが利点を上回ります。

関連資料：[`GOVERNANCE.md`](../GOVERNANCE.md) のガバナンスモデルと、[`ROADMAP.md`](../ROADMAP.md) の今後の方向性。
