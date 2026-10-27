<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · **日本語** · [Português](README.pt-BR.md)</sub>

<a id="documentation"></a>

# ドキュメント

> [英語版](README.md)の参考訳です（27/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

この索引は、DCP-AI のドキュメントを作業別（はじめに、アーキテクチャとセキュリティ、テスト、リファレンス、運用、仕様、
提案）に整理したものです。各レジストリのパッケージの現在のバージョンは
[公開済みバージョン](#published-versions)にあります。

<a id="published-versions"></a>

## 公開済みバージョン

26/10/2026 に確認済み。パッケージのバージョンは、DCP のワイヤーフォーマットと仕様のバージョン（2.0）とは独立しています。

| レジストリ | パッケージ | バージョン | リリースノート |
|---|---|---|---|
| npm | [`@dcp-ai/sdk`](https://www.npmjs.com/package/@dcp-ai/sdk) (TypeScript SDK) | 2.2.0 | [npm パッケージ](NPM_RELEASES.md) |
| npm | [`@dcp-ai/wasm`](https://www.npmjs.com/package/@dcp-ai/wasm) | 2.1.0 | [npm パッケージ](NPM_RELEASES.md) |
| npm | [`@dcp-ai/cli`](https://www.npmjs.com/package/@dcp-ai/cli) | 2.1.0 | [npm パッケージ](NPM_RELEASES.md) |
| PyPI | [`dcp-ai`](https://pypi.org/project/dcp-ai/2.10.0/) (Python SDK) | 2.10.0 | [Python のリリース](PYTHON_RELEASE.md) |
| Go modules | `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` | v2.11.0 | [Go のリリース](GO_RELEASE.md) |
| crates.io | [`dcp-ai`](https://crates.io/crates/dcp-ai/2.11.0) (Rust SDK) | 2.11.0 | [Rust のリリース](RUST_RELEASE.md) |

- npm のアダプターとプロジェクト生成ツールは任意で、プロトコルのコアとは別です。正確なバージョンは、13 の npm パッケージ
  すべてを載せた [NPM_RELEASES.md](NPM_RELEASES.md) にあります。
- 影響を受ける以前のバージョンと更新の注意は [SECURITY.md](../SECURITY.md#supported-versions) に、DCP v1.0 からの移行は
  [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md) にあります。
- どの SDK でも、`dcp-jcs-v1` が引き続き規範的なデフォルトの正規化で、`dcp-jcs-v2` の API は実験的でオプトインです。
  検証はプリンシパルへの信頼、受け入れ、認可を確立しません。
- この一覧は上の 4 つのレジストリを対象とし、コンテナイメージは対象外です。

<a id="quick-start"></a>

## クイックスタート

- [QUICKSTART.md](QUICKSTART.md) — SDK で証拠を作成・検証する（公開パッケージまたはリポジトリのチェックアウト）。デモは別に示しています
- [QUICKSTART_EXPRESS.md](QUICKSTART_EXPRESS.md) — Express ミドルウェアとの統合
- [QUICKSTART_LANGCHAIN.md](QUICKSTART_LANGCHAIN.md) — LangChain のツールのラップ
- [QUICKSTART_OPENAI.md](QUICKSTART_OPENAI.md) — OpenAI の関数呼び出し（Node SDK、Chat Completions、Python クライアントのラッパー）
- [QUICKSTART_CREWAI.md](QUICKSTART_CREWAI.md) — CrewAI のマルチエージェントのクルー
- [QUICKSTART_AGNO.md](QUICKSTART_AGNO.md) — `agno-dcp` による Agno のエージェント、チーム、ワークフロー

<a id="architecture--security"></a>
<a id="architecture-security"></a>

## アーキテクチャとセキュリティ

- [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) — システムアーキテクチャとデプロイの設計図
- [SECURITY_MODEL.md](SECURITY_MODEL.md) — 脅威モデル、攻撃ベクトル、防御層
- [STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md) — P2P ストレージと任意のブロックチェーンアンカリング
- [ARCHITECTURE.md](ARCHITECTURE.md) — コントリビューター向けのリポジトリの地図
- [OBSERVABILITY.md](OBSERVABILITY.md) — SDK からの OpenTelemetry のトレースとメトリクス

<a id="testing--assurance"></a>
<a id="testing-assurance"></a>

## テストと保証

- [tools/interop-matrix](../tools/interop-matrix/README.md) — 4 つの SDK 上の実際のエージェントが、互いのバンドルを、そのままの状態と転送中に改ざんした状態で署名・検証します
- [tools/difffuzz](../tools/difffuzz/README.md) — 4 つの V2 検証器の差分ファジング
- [tests/interop/v2](../tests/interop/v2/) — すべての SDK が受理または拒否しなければならない共通ベクター
- [tests/interop/candidate/phase4](../tests/interop/candidate/phase4/README.md) — 実験的な `dcp-jcs-v2` の生成側のクロスマトリクス（5 つの SDK）

<a id="reference"></a>

## リファレンス

- [API_REFERENCE.md](API_REFERENCE.md) — `main` の状態の TypeScript SDK API リファレンス
- [NIST_CONFORMITY.md](NIST_CONFORMITY.md) — NIST FIPS 203/204/205 への適合に関する声明
- [EU_AI_ACT_MAPPING.md](EU_AI_ACT_MAPPING.md) — EU AI 法（規則 (EU) 2024/1689）のログ記録、人による監督、記録保持の義務と DCP アーティファクトの対応
- [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md) — DCP v1.0 から v2.0 への移行

<a id="operations"></a>

## 運用

- [OPERATOR_GUIDE.md](OPERATOR_GUIDE.md) — DCP 検証サービスの運用
- [ADMISSION.md](ADMISSION.md) — 信頼できるプリンシパルからのバンドルだけを受け入れる方法と strict-v1 プロファイル
- [AGENT_CREATION_AND_CERTIFICATION.md](AGENT_CREATION_AND_CERTIFICATION.md) — エージェントの作成と認証の流れ

<a id="specifications"></a>

## 仕様

- [spec/DCP-01.md](../spec/DCP-01.md) — アイデンティティと責任あるプリンシパルの結び付け
- [spec/DCP-02.md](../spec/DCP-02.md) — 意図の宣言とポリシーによる制御
- [spec/DCP-03.md](../spec/DCP-03.md) — 監査チェーンと透明性
- [spec/DCP-04.md](../spec/DCP-04.md) — エージェント間通信
- [spec/DCP-05.md](../spec/DCP-05.md) — エージェントのライフサイクル管理
- [spec/DCP-06.md](../spec/DCP-06.md) — デジタルな継承と相続
- [spec/DCP-07.md](../spec/DCP-07.md) — 紛争の解決と仲裁
- [spec/DCP-08.md](../spec/DCP-08.md) — 権利と義務の枠組み
- [spec/DCP-09.md](../spec/DCP-09.md) — 個人の代理と委任
- [spec/profiles](../spec/profiles/README.md) — 任意のプロファイル：暗号、A2A、ガバナンス、アドミッション

<a id="proposals-experimental-not-normative"></a>

## 提案（実験的、規範的ではない）

- [proposals/canonicalization-candidate](proposals/canonicalization-candidate/README.md) — 有効化されていない候補 `dcp-jcs-v2` と、SDK のオプトイン API。プロファイルは引き続き `dcp-jcs-v1` だけです

<a id="community--vision"></a>
<a id="community-vision"></a>

## コミュニティとビジョン

- [EARLY_ADOPTERS.md](EARLY_ADOPTERS.md) — アーリーアダプタープログラム、特典、条件
- [GENESIS_PAPER.md](GENESIS_PAPER.md) — 創設時のホワイトペーパー

---

プロトコルの仕様は [spec/](../spec/) を、コントリビューションのガイドラインは [CONTRIBUTING.md](../CONTRIBUTING.md) を参照してください。
