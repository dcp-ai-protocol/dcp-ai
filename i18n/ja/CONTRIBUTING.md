<sub>[English](../../CONTRIBUTING.md) · [中文](../zh-CN/CONTRIBUTING.md) · [Español](../es/CONTRIBUTING.md) · **日本語** · [Português](../pt-BR/CONTRIBUTING.md)</sub>

<a id="contributing-to-dcp-ai"></a>

# DCP-AI へのコントリビューション

> [英語版](../../CONTRIBUTING.md)の参考訳です（26/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

AI エージェントのための Digital Citizenship Protocol へのコントリビューションに関心を持っていただき、ありがとうございます。このガイドは作業を始める手助けになります。

<a id="development-environment-setup"></a>

## 開発環境の準備

<a id="prerequisites"></a>

### 前提条件

- **Node.js** 20 以上（プロトコルの中核と TypeScript SDK。CI は 20 と 22 を使用）
- **Python** 3.10 以上（Python SDK。CI は 3.12 を使用）
- **Go** 1.25 以上（Go SDK に必要）
- **Rust**（安定版ツールチェーン。Rust SDK に必要）
- **Git**

<a id="getting-started"></a>

### はじめに

```bash
# Clone the repository
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai

# The root package uses the workspace SDK to test the checked-out source: build it first
(cd sdks/typescript && npm install && npm run build)

# Install root dependencies (core protocol + reference CLI); reinstall after rebuilding the SDK
npm install

# Run conformance tests to verify your setup (should print "DCP-AI CONFORMANCE PASS (V1 + V2)")
npm run conformance
```

<a id="sdk-setup"></a>

### SDK の準備

各 SDK は `sdks/` の下の独自のディレクトリにあり、依存関係もそれぞれ独立しています。以下のコマンドはリポジトリのルートから実行してください。各サブシェルは終了後にルートへ戻ります。

```bash
# TypeScript SDK
(cd sdks/typescript && npm install)

# Python SDK
(cd sdks/python && pip install -e ".[dev]")

# Go SDK
(cd sdks/go && go mod download)

# Rust SDK
(cd sdks/rust && cargo build)

# WASM SDK (requires Rust + wasm-pack + Node.js)
(cd sdks/wasm && npm install && npm run build:wasm)
```

<a id="running-tests"></a>

## テストの実行

<a id="core-protocol"></a>

### プロトコルの中核

```bash
npm run conformance
```

<a id="sdks"></a>

### SDK

```bash
# TypeScript
(cd sdks/typescript && npm run test)           # Run tests
(cd sdks/typescript && npm run test:coverage)  # Run tests with coverage

# Python
(cd sdks/python && pytest -v)

# Go
(cd sdks/go && go test ./...)

# Rust
(cd sdks/rust && cargo test)

# WASM (build verification)
(cd sdks/wasm && npm test)
```

<a id="cross-sdk"></a>

### SDK 間

各 SDK は、それぞれのテストスイートから `tests/interop/v2/` の共通ベクターを読み込みます。2 つのツールが SDK 同士を照合します（先に `sdks/typescript` をビルドし、`sdks/python` をインストールしてください。Go と Rust は `PATH` 上に必要です）。

```bash
node tools/interop-matrix/run.mjs   # agents on the four SDKs sign and verify each other's bundles
node tools/difffuzz/run.mjs         # the same mutated bundle through the four verifiers
```

どちらも pull request ごとと毎晩、CI で実行されます。

<a id="documentation-and-translations"></a>

### ドキュメントと翻訳

公開ドキュメントには英語の原文と 4 つの翻訳があり、`scripts/docs-i18n.json` に一覧があります。内容が異なる場合は英語の原文が
優先されます。英語の原文は元のパスのままで、各翻訳は `i18n/<locale>/`（`es`、`pt-BR`、`ja` または `zh-CN`）の下の
同じパスにあります。たとえば `spec/DCP-01.md` のスペイン語訳は `i18n/es/spec/DCP-01.md` です。以前は翻訳が
原文の隣に `<dir>/<name>.<locale>.md` として置かれていました。それらのパスは `main` にはもう存在せず、
リダイレクト用のファイルもありません。以前のコミットやタグでは、各ファイルは元のパスにあります。チェックには CI がインストールするドキュメントのツール群が必要で、これは `markdown` と
`yaml` のモジュールも提供します。

```bash
pip install 'mkdocs==1.6.*' 'mkdocs-material==9.5.*' 'pymdown-extensions==10.*'
python3 scripts/docs_i18n.py check                             # coverage, reviewed hashes, structure and links
python3 -m unittest discover -s scripts -p 'test_docs*.py' -v  # positive and negative controls of the gate
bash scripts/build-docs-site.sh                                 # builds and validates all five languages
```

`build-docs-site.sh` はサイトのビルドと検証を行います。その後に `mkdocs build` を実行しないでください。1 つの言語だけを
ローカルでプレビューするには次のようにします。これは完全なビルドではありません。

```bash
python3 scripts/docs_site.py preview --locale en
mkdocs serve -f docs-site/en/mkdocs.yml
```

ドキュメントを変更したら、その 4 つの翻訳を完全な状態に保ち、注記、アンカー、コードブロックを
英語と一致させてください。新しい英語の原文に照らして 4 つすべてを読んだ後でのみ、そのハッシュを記録します。

```bash
python3 scripts/docs_i18n.py record <source.md> --reviewed
```

これはハッシュを記録するだけで、翻訳の品質を証明するものではありません。翻訳を読んでいない
ドキュメントは記録しないでください。

<a id="code-style"></a>

## コードスタイル

このプロジェクトでは、一貫したコードスタイルを保つために自動化ツールを使っています。

- **ESLint**：JavaScript/TypeScript の静的解析（`.eslintrc.json` を参照）
- **Prettier**：コードの整形（`.prettierrc.json` を参照）
- **EditorConfig**：エディターの基本設定（`.editorconfig` を参照）

<a id="key-rules"></a>

### 主なルール

- 既定では `const` を使い、`var` は使わない
- 文字列にはシングルクォートを使う
- 末尾のカンマを常に付ける
- 1 行の最大幅は 100 文字
- インデントはスペース 2 つ（Makefile を除く）

コミットの前にコードを整形してください（ルートパッケージは Prettier も ESLint もインストールしないため、インストールされていなければ `npx` が取得します）。

```bash
npx prettier --write .
npx eslint --fix .
```

<a id="submitting-pull-requests"></a>

## Pull request の提出

1. **リポジトリをフォーク**し、`main` から作業用のブランチを作成します。
2. まとまりのある論理的なコミットで**変更を加えます**。
3. 新しい機能や不具合の修正には**テストを書くか更新します**。
4. PR を開く前に、ローカルで**すべてのテストが通ることを確認します**。
5. 何をなぜ変えたのかを明確に説明して、`main` に対して **pull request を開きます**。

<a id="pr-checklist"></a>

### PR チェックリスト

- [ ] 既存のテストがすべて通る
- [ ] 新しい機能に対するテストを追加した
- [ ] コードがプロジェクトのスタイルガイドラインに従っている
- [ ] 該当する場合、ドキュメントを、その文書があるすべての言語で更新した
- [ ] 署名、ハッシュ、正規化、検証に関わる変更：共通ベクターを更新し、相互運用マトリクスが通る
- [ ] コミットメッセージが下記の形式に従っている

<a id="commit-message-format"></a>

## コミットメッセージの形式

Conventional Commits 形式のメッセージを使ってください。

```
<type>(<scope>): <short summary>

<optional body>
```

<a id="types"></a>

### 種類

- **feat**：新しい機能
- **fix**：不具合の修正
- **docs**：ドキュメントのみの変更
- **style**：整形、セミコロンの抜けなど（コードの変更なし）
- **refactor**：不具合の修正でも機能の追加でもないコードの変更
- **test**：テストの追加や更新
- **chore**：ビルド処理、依存関係の更新、ツール

<a id="scopes"></a>

### スコープ

- **core**：プロトコルの中核、CLI、スキーマ
- **sdk/ts**：TypeScript SDK
- **sdk/py**：Python SDK
- **sdk/go**：Go SDK
- **sdk/rust**：Rust SDK
- **sdk/wasm**：WASM SDK
- **integration/\***：フレームワークとの統合
- **ci**：CI/CD のワークフロー

<a id="examples"></a>

### 例

```
feat(sdk/ts): add post-quantum signature support
fix(core): correct Merkle root computation for single-entry chains
docs(sdk/py): add installation instructions for extras
test(core): add conformance tests for expired bundles
chore(ci): add code coverage to TypeScript SDK workflow
```

<a id="testing-requirements"></a>

## テストの要件

- 新しい機能にはすべて、対応するテストを含めてください。
- 不具合の修正には、その不具合を検出できたはずの回帰テストを含めてください。
- `tests/conformance/` の適合性テストは、すべての実装でプロトコルへの準拠を確認します。
- すべての SDK が適用するルールには `tests/interop/v2/` に共通ベクターを追加し、4 つの SDK を同じケースでテストします。
- SDK のテストは、バンドルの作成、署名、検証、エラーの場合を網羅してください。
- PR をマージするには CI が通っている必要があります。テストの失敗を握りつぶすことはなく、テストが失敗すればビルドも失敗します。

<a id="questions"></a>

## 質問

コントリビューションについて質問があれば、GitHub で issue を開くか、ディスカッションを始めてください。喜んでお手伝いします。
