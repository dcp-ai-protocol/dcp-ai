<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · **日本語** · [Português](README.pt-BR.md)</sub>

<a id="documentation"></a>

# ドキュメント

**npm 公開（2026 年 10 月 26 日）。** [NPM_RELEASES.md](NPM_RELEASES.md) の 13 バージョンは、TypeScript/WASM の候補 API と TypeScript の受け入れ判定を含めて公開済みです。以下の項目は開発履歴として保持しています。`[Unreleased]` はこれらの npm 機能が利用できないことを意味しません。Python、Go、Rust の公開は別です。

> [英語版](README.md)の参考訳です（25/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

<a id="quick-start"></a>

## クイックスタート

- [QUICKSTART.md](QUICKSTART.md) — 数分で使い始める（公開パッケージとリポジトリのチェックアウト）
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
