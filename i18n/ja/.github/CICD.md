<sub>[English](../../../.github/CICD.md) · [中文](../../zh-CN/.github/CICD.md) · [Español](../../es/.github/CICD.md) · **日本語** · [Português](../../pt-BR/.github/CICD.md)</sub>

<a id="github-actions--ci"></a>

# GitHub Actions と CI

> [英語版](../../../.github/CICD.md)の参考訳です（25/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

このリポジトリの GitHub Actions と CI のワークフローです。`.github/actions/` にある 2 つのコンポジットアクションと、`ci.yml` のワークフローがあります。

> **このリポジトリのワークフローは、これらのアクションを使っていません**（2026 年 10 月 25 日）。また、ほかのリポジトリからも試されていません。どちらもこのリポジトリのチェックアウトのコードを実行します。`verify-bundle` は、ワークスペースの SDK（`sdks/typescript`）のビルドを必要とする `lib/verify.js` を読み込み、`conformance-test` はワークスペースの `tools/conformance.js` を実行するため、このリポジトリのチェックアウトでしか動きません。自分のパイプラインでバンドルを検証するには、[あなたのプロジェクトでのバンドルの検証](#verifying-bundles-in-your-project)を参照してください。

<a id="available-actions"></a>

## 利用できるアクション

### `verify-bundle`

リファレンス検証器（`lib/verify.js`）を使って、GitHub Actions のワークフローで DCP の Signed Bundle を検証します。V1 のバンドルにはスキーマ、Ed25519 の署名、監査チェーン、マークルの確認を行います。規範的な V2 のバンドル（`schemas/v2/signed_bundle.schema.json`）はスキーマで検証した後、`@dcp-ai/sdk` がマニフェスト、Ed25519 + ML-DSA-65 の複合署名、セッションの結び付け、監査チェーンを検証します。

実行元のチェックアウトのルートのパッケージをインストールします（`npm install --production`。インストールのエラーは無視）が、ワークスペースの SDK はビルドしないため、前のステップで `sdks/typescript` をビルドしてください。検証は既定のポリシーで行い、ポリシーの入力はありません。

信頼できる文字どおりのパスの入力だけを使ってください。アクションは、それらをデータとして渡すのではなく、シェルと `eval` で評価する JavaScript に埋め込みます。パスの中の引用符やシェルの構文はコマンドを変えてしまうことがあります。これらの入力を、信頼できないプルリクエスト、issue、アーティファクトの名前から作らないでください。下のリファレンス CLI の例は、パスを引数として渡します。

```yaml
- uses: ./.github/actions/verify-bundle
  with:
    bundle-path: "path/to/signed_bundle.json"
    public-key-path: "keys/public_key.txt"  # Optional
    fail-on-invalid: "true"
    node-version: "20"
```

<a id="inputs"></a>

#### 入力

| 入力 | 必須 | 既定値 | 説明 |
|-------|----------|---------|-------------|
| `bundle-path` | はい | — | 署名付きバンドルの JSON ファイルのパス |
| `public-key-path` | いいえ | — | 想定する Ed25519 の公開鍵のパス。V1：それで検証する（なければバンドルに埋め込まれた鍵を使う）。V2：バンドルのクラシカルな署名者を固定する |
| `fail-on-invalid` | いいえ | `"true"` | バンドルが無効ならステップを失敗させる |
| `node-version` | いいえ | `"20"` | Node.js のバージョン |

<a id="outputs"></a>

#### 出力

| 出力 | 説明 |
|--------|-------------|
| `verified` | `"true"` または `"false"` |
| `errors` | 検証のエラー（あれば） |

<a id="usage-example"></a>

#### 使用例

このリポジトリのチェックアウト向けの概略です（このページのためには実行していません）。アクションと `lib/verify.js` は
チェックアウトから来るもので、`agent/citizenship_bundle.signed.json` と `agent/public_key.txt` はオペレーターが用意するファイルを
表します。

```yaml
name: Verify Agent Bundle
on: [push]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Build the workspace SDK (the action does not)
        run: (cd sdks/typescript && npm ci && npm run build)

      - name: Verify DCP Bundle
        id: verify
        uses: ./.github/actions/verify-bundle
        with:
          bundle-path: "agent/citizenship_bundle.signed.json"
          public-key-path: "agent/public_key.txt"

      - name: Check result
        run: echo "Verified: ${{ steps.verify.outputs.verified }}"
```

### `conformance-test`

ワークスペースで `node tools/conformance.js` を実行します。リポジトリ自身の例に対する、V1 + V2 の適合性のテストスイートです。このリポジトリのチェックアウトでしか動かず、`test-dir` の入力は使われません。

```yaml
- uses: ./.github/actions/conformance-test
  with:
    node-version: "20"
    test-dir: "tests/conformance/examples"
```

<a id="inputs-1"></a>
<a id="inputs_1"></a>

#### 入力

| 入力 | 必須 | 既定値 | 説明 |
|-------|----------|---------|-------------|
| `node-version` | いいえ | `"20"` | Node.js のバージョン |
| `test-dir` | いいえ | `"tests/conformance/examples"` | アクションでは使われない |

<a id="outputs-1"></a>
<a id="outputs_1"></a>

#### 出力

| 出力 | 説明 |
|--------|-------------|
| `passed` | すべてのテストが合格したかどうか |
| `summary` | テストの要約 |

<a id="usage-example-1"></a>
<a id="usage-example_1"></a>

#### 使用例

このリポジトリのチェックアウト向けの概略です（このページのためには実行していません）。`tools/conformance.js` は
`@dcp-ai/sdk` をインポートするため、先にワークスペースの SDK をビルドします。

```yaml
name: DCP Conformance
on: [push]

jobs:
  conformance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Build the workspace SDK (the action does not)
        run: (cd sdks/typescript && npm ci && npm run build)

      - name: Run Conformance Tests
        id: conform
        uses: ./.github/actions/conformance-test

      - name: Results
        run: echo "${{ steps.conform.outputs.summary }}"
```

<a id="ci-workflow"></a>

## CI のワークフロー

`ci.yml` のワークフローは、`main` への push と、任意のベースブランチに対するプルリクエストで実行されます。`changes` のジョブがどの部分が変わったかを検出し（`dorny/paths-filter`）、その部分について以下のジョブが実行されます。

| ジョブ | 実行する内容 |
|-----|--------------|
| `conformance` | Node.js 20 と 22：`npm install`、`npm run conformance`、`tools/crypto.js` とプレイグラウンドの スカラー S の範囲のテスト、`npm run examples:generate:v2`、V1 と V2 の例に対する `dcp verify-bundle`（V2 は `hybrid_required`）、`dcp integrity` |
| `typescript-sdk` | `sdks/typescript`：`npm install`、`npx tsc --noEmit`、`npm run build`、`npm run test`、カバレッジ |
| `integrations` | `anthropic-mcp`、`express`、`google-a2a`、`openclaw`：ワークスペースの SDK のビルド、`npm ci`、ビルド、`vitest run` |
| `cli` | Node.js 20 と 22：ワークスペースの SDK のビルド、`cli/` へのインストール、CLI のテストとその否定の対照、パックされたファイルの確認 |
| `python-sdk` | Python 3.12：`pip install -e ".[dev]"`、カバレッジ付きの `pytest` |
| `go-sdk` | `sdks/go/go.mod` の Go：`go build ./...`、カバレッジ付きの `go test` |
| `rust-sdk` | Rust の stable：`cargo build`、`cargo build --features otlp`、カバレッジ、`cargo test --all-features`、`wasm32-unknown-unknown` 向けのテストのビルド |
| `wasm-sdk` | Rust の stable と `wasm-pack`：`sdks/wasm` での `npm run build:wasm`、`npm test` |

ほかのワークフローは、正規化の候補のマトリクスとラボ、コントラクト、差分ファジング、相互運用性のマトリクス、ラベル、公開（npm、PyPI、Docker イメージ、統合、テンプレート）を扱います。ドキュメントを扱うのは 2 つで、どちらも自動で翻訳することはありません。`i18n-sync.yml`（「Documentation and i18n」）は、Markdown やドキュメントのツールに触れるプルリクエストと `main` への push で、5 つの言語のカバレッジ、レビュー済みのハッシュ、構造、リンクを確認し、そのゲートの肯定と否定の対照を実行し、5 つの言語でサイトをビルドします。`docs.yml` は `main` で同じサイトをビルドし、GitHub Pages にデプロイします。

同じドキュメントの確認をローカルで実行するには、CONTRIBUTING.md の [Documentation and translations](../../../CONTRIBUTING.md#documentation-and-translations) を参照してください。

```bash
pip install 'mkdocs==1.6.*' 'mkdocs-material==9.5.*' 'pymdown-extensions==10.*'
python3 scripts/docs_i18n.py check
python3 -m unittest discover -s scripts -p 'test_docs*.py' -v
bash scripts/build-docs-site.sh
```

<a id="verifying-bundles-in-your-project"></a>

## あなたのプロジェクトでのバンドルの検証

固定したチェックアウトのリファレンス CLI でバンドルを検証する概略です（このページのためには実行していません）。`dcp verify-bundle` は、バンドルが検証できれば 0、そうでなければ 0 以外で終了し、現在のディレクトリの下のファイルだけを読みます。

```yaml
# .github/workflows/dcp.yml
name: DCP Verification
on: [push, pull_request]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/checkout@v4
        with:
          repository: dcp-ai-protocol/dcp-ai
          ref: <full commit SHA you have reviewed>
          path: dcp-ai

      - uses: actions/setup-node@v4
        with:
          node-version: "22"

      - name: Build the reference verifier
        run: |
          (cd dcp-ai/sdks/typescript && npm ci && npm run build)
          (cd dcp-ai && npm install)

      - name: Verify the agent's bundle
        run: node dcp-ai/bin/dcp.js verify-bundle --policy hybrid_required my-agent/bundle.signed.json
```

検証済みのバンドルは、完全で、それが挙げる鍵で署名されています。信頼するプリンシパルからのバンドルだけを受け入れるには、アドミッション（`dcp admit-bundle`、[docs/ADMISSION.md](../../../docs/ADMISSION.md) を参照）を使ってください。

<a id="license"></a>

## ライセンス

Apache-2.0
