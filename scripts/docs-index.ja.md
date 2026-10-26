---
hide:
  - navigation
  - toc
---

<sub>[English](docs-index.md) · [中文](docs-index.zh-CN.md) · [Español](docs-index.es.md) · **日本語** · [Português](docs-index.pt-BR.md)</sub>

<a id="dcp-ai--digital-citizenship-protocol-for-ai-agents"></a>
<a id="dcp-ai-digital-citizenship-protocol-for-ai-agents"></a>

# DCP-AI — AI エージェントのための Digital Citizenship Protocol

**Go の公開 (26/10/2026).** Go SDK `v2.11.0` はモジュールタグ `sdks/go/v2.11.0` から利用でき、検証器の修正、受け入れ、実験的なオプトイン API を含みます。Rust の公開は別です。参照： [Go v2.11.0](reference/docs/GO_RELEASE.md).

**Python の公開 (26/10/2026).** `dcp-ai` 2.10.0 が PyPI で公開され、検証器の修正、受け入れ判定、実験的なオプトイン API を含みます。Go と Rust の公開は別です。参照： [Python 2.10.0](reference/docs/PYTHON_RELEASE.md).

> [英語版](docs-index.md)の参考訳です（26/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

> オープンなネットワーク上の AI エージェントのための、持ち運べる説明責任の層。

暗号的に検証できるアイデンティティ、機械が読める意図、改ざんを検知できる監査証跡、認証されたエージェント間通信、ライフサイクルのガバナンス、手続き上の説明責任、委任による代理を、1 つのハイブリッドなポスト量子プロトコルスタックで提供します。

[はじめる :material-rocket-launch:](quickstart/QUICKSTART.md){ .md-button .md-button--primary }
[プレイグラウンドを試す :material-play-circle:](playground/){ .md-button }
[論文を読む :material-file-document:](https://doi.org/10.5281/zenodo.19040913){ .md-button }
[GitHub で見る :material-github:](https://github.com/dcp-ai-protocol/dcp-ai){ .md-button }

---

<a id="install"></a>

## インストール

!!! note "公開済みパッケージと `main`"
    npm では `@dcp-ai/sdk` 2.2.0、`@dcp-ai/wasm` と `@dcp-ai/cli` 2.1.0、および更新済みアダプターと生成ツールを利用できます。[npm 一覧](reference/docs/NPM_RELEASES.md)を参照してください。Python、Go、Rust の公開は別です。[クイックスタート](quickstart/QUICKSTART.md#published-packages-and-this-guide)でレジストリとチェックアウトの例を区別しています。

=== "Node.js"

    ```bash
    npm install @dcp-ai/sdk@^2.2.0 @dcp-ai/cli
    ```

=== "Python"

    ```bash
    pip install dcp-ai
    ```

=== "Go"

    ```bash
    go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.11.0
    ```

=== "Rust"

    ```bash
    cargo add dcp-ai
    ```

=== "WebAssembly"

    ```bash
    npm install @dcp-ai/wasm@^2.1.0
    ```

---

<a id="the-nine-specifications"></a>

## 9 つの仕様

<div class="grid cards" markdown>

-   :material-card-account-details:{ .lg .middle } **DCP-01 — アイデンティティと人への結び付け**

    ---

    すべてのエージェントは、説明責任を負う責任ある人または法人に暗号的に結び付けられます。

    [読む →](specs/DCP-01.md)

-   :material-target:{ .lg .middle } **DCP-02 — 意図の宣言とポリシーによる制御**

    ---

    エージェントは行動の前に構造化された意図を宣言し、検証器はティアに応じたポリシー判断を適用します。

    [読む →](specs/DCP-02.md)

-   :material-link-variant:{ .lg .middle } **DCP-03 — 監査チェーンと透明性**

    ---

    Merkle 証明と、任意の透明性ログへの記録を備えた、ハッシュで連鎖した監査エントリー。

    [読む →](specs/DCP-03.md)

-   :material-account-group:{ .lg .middle } **DCP-04 — エージェント間通信**

    ---

    認証されたエージェント間メッセージング、発見、ハンドシェイク、委任、信頼のチェーン。

    [読む →](specs/DCP-04.md)

-   :material-heart-pulse:{ .lg .middle } **DCP-05 — エージェントのライフサイクル**

    ---

    稼働開始、バイタリティ報告、運用終了。4 つの終了モードを、改ざんを検知できる形で記録します。

    [読む →](specs/DCP-05.md)

-   :material-file-sign:{ .lg .middle } **DCP-06 — 継承と相続**

    ---

    デジタル遺言と継承のセレモニーで、エージェントの世代をまたいだ継続性を保ちます。

    [読む →](specs/DCP-06.md)

-   :material-gavel:{ .lg .middle } **DCP-07 — 紛争の解決**

    ---

    3 段階のエスカレーション、M-of-N の仲裁パネル、先例のための判例バンドル。

    [読む →](specs/DCP-07.md)

-   :material-scale-balance:{ .lg .middle } **DCP-08 — 権利と義務**

    ---

    エージェントの 4 つの基本的な権利、義務の構造化された追跡、違反の報告。

    [読む →](specs/DCP-08.md)

-   :material-account-tie:{ .lg .middle } **DCP-09 — 委任と代理**

    ---

    委任の権限委任状、認識しきい値、プリンシパルのミラー、2 層のやり取りの記録。

    [読む →](specs/DCP-09.md)

</div>

---

<a id="whats-in-the-box"></a>

## 含まれるもの

<div class="grid cards" markdown>

-   :material-package-variant-closed:{ .lg .middle } **5 つの SDK**

    ---

    TypeScript、Python、Go、Rust、WebAssembly。同じ中核プロトコルと共通のテストベクターを使います。各 SDK の README に、まだ対応していないことと公開状況を記載しています。

    `@dcp-ai/sdk`、`dcp-ai`（PyPI）、`dcp-ai`（crates.io）、`sdks/go/v2`、`@dcp-ai/wasm`

-   :material-connection:{ .lg .middle } **11 の統合**

    ---

    よく使われる AI と Web のフレームワークとの橋渡しです。何を確認するかはそれぞれ異なります。署名済みのバンドルを検証するものもあれば、
    署名のないイベントを記録するだけのものやポリシーを適用しないものもあり、公開済みのパッケージの中には `main` にある修正を含まないものもあります
    （[サポートされるバージョン](reference/SECURITY.md#supported-versions)）。頼る前に、
    それぞれの制限を読んでください。

    [Express](reference/integrations/express/README.md)、[FastAPI](reference/integrations/fastapi/README.md)、[LangChain](reference/integrations/langchain/README.md)、[OpenAI](reference/integrations/openai/README.md)、[CrewAI](reference/integrations/crewai/README.md)、[Agno](quickstart/QUICKSTART_AGNO.md)、[OpenClaw](reference/integrations/openclaw/README.md)、[W3C DID](reference/integrations/w3c-did/README.md)、[Google A2A](reference/integrations/google-a2a/README.md)、[Anthropic MCP](reference/integrations/anthropic-mcp/README.md)、[AutoGen](reference/integrations/autogen/README.md)

-   :material-shield-key:{ .lg .middle } **ハイブリッドなポスト量子暗号**

    ---

    Ed25519 + ML-DSA-65 の複合署名、予備としての SLH-DSA-192f、SHA-256 / SHA3-256 の二重監査チェーン。4 段階の適応的なティア（Routine から Maximum まで）。

    [セキュリティモデル →](architecture/SECURITY_MODEL.md)

-   :material-console:{ .lg .middle } **リファレンス CLI とサービス**

    ---

    `dcp-ai` CLI、検証サーバー、アンカリングサービス（ローカルの記録のみ。チェーンへの送信は未実装）、透明性ログ、失効レジストリ。Docker Compose による完全なスタック。

    [オペレーターガイド →](guides/OPERATOR_GUIDE.md)

</div>

---

<a id="cite"></a>

## 引用

研究で DCP-AI を使う場合は、概念を示した論文と、使用したソフトウェアのリリースの**両方**を引用してください。

**論文** — *Agents Don't Need a Better Brain — They Need a World: Toward a Digital Citizenship Protocol for Autonomous AI Systems*
Naranjo Emparanza, D. (2026). Zenodo. [`10.5281/zenodo.19040913`](https://doi.org/10.5281/zenodo.19040913)

**ソフトウェア** — 使用したリリースを引用してください。概念 DOI [`10.5281/zenodo.19656025`](https://doi.org/10.5281/zenodo.19656025) は最新のアーカイブ版を指します。v2.0.2 は
*DCP-AI v2.0.2 — Digital Citizenship Protocol for AI Agents (Reference Implementation)*, Naranjo Emparanza, D. (2026). Zenodo. [`10.5281/zenodo.19656026`](https://doi.org/10.5281/zenodo.19656026) です。

---

<p style="text-align: center; font-style: italic; color: var(--md-default-fg-color--light);">
「このプロトコルは、人と AI エージェントが共同で作りました。統治しようとする協働そのもののために設計されています。」
</p>
