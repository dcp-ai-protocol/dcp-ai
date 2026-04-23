<sub>[English](CONTRIBUTING.md) · [中文](CONTRIBUTING.zh-CN.md) · [Español](CONTRIBUTING.es.md) · **日本語** · [Português](CONTRIBUTING.pt-BR.md)</sub>

# DCP-AI へのコントリビューション

AIエージェントのためのデジタル市民権プロトコルへのコントリビューションにご関心をお寄せいただきありがとうございます。このガイドでは、最初の一歩をお手伝いします。

## 開発環境のセットアップ

### 前提条件

- **Node.js** >= 18 (コアプロトコルとTypeScript SDKに必要)
- **Python** >= 3.12 (Python SDKに必要)
- **Go** >= 1.21 (Go SDKに必要)
- **Rust** (stableツールチェーン、Rust SDKに必要)
- **Git**

### はじめに

```bash
# Clone the repository
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai

# Install root dependencies (core protocol + CLI)
npm install

# Run conformance tests to verify your setup (should print "DCP-AI CONFORMANCE PASS (V1 + V2)")
npm run conformance
```

### SDKセットアップ

各SDKは `sdks/` 配下の独自ディレクトリに置かれ、独立した依存関係を持ちます。

```bash
# TypeScript SDK
cd sdks/typescript && npm install

# Python SDK
cd sdks/python && pip install -e ".[dev]"

# Go SDK
cd sdks/go && go mod download

# Rust SDK
cd sdks/rust && cargo build

# WASM SDK (requires Rust + wasm-pack + Node.js)
cd sdks/wasm && npm install
```

## テストの実行

### コアプロトコル

```bash
npm run conformance
```

### SDK

```bash
# TypeScript
cd sdks/typescript
npm run test              # Run tests
npm run test:coverage     # Run tests with coverage

# Python
cd sdks/python
pytest -v

# Go
cd sdks/go
go test ./...

# Rust
cd sdks/rust
cargo test

# WASM (build verification)
cd sdks/wasm
npm test
```

## コードスタイル

このプロジェクトでは、一貫したコードスタイルを強制するために自動化ツールを使用しています。

- **ESLint** JavaScript/TypeScript の lint (`.eslintrc.json` を参照)
- **Prettier** コードフォーマット (`.prettierrc.json` を参照)
- **EditorConfig** 基本的なエディタ設定 (`.editorconfig` を参照)

### 主なルール

- デフォルトで `const` を使用すること。`var` は絶対に使用しないこと
- 文字列にはシングルクォートを使用すること
- 末尾のカンマは常に付けること
- 最大行幅は100文字
- 2スペースのインデントを使用すること (Makefileを除く)

コミット前にコードをフォーマットしてください。

```bash
npx prettier --write .
npx eslint --fix .
```

## プルリクエストの送信

1. **リポジトリをフォーク**して、`main` から機能ブランチを作成します。
2. フォーカスされた論理的なコミットで**変更を加えます**。
3. 新機能やバグ修正には**テストを追加または更新します**。
4. PRを開く前にローカルで**すべてのテストがパスすることを確認します**。
5. 何が変わったか、なぜ変わったかを明確に記述した**プルリクエストを `main` に対して開きます**。

### PRチェックリスト

- [ ] すべての既存テストがパスする
- [ ] 新機能には新しいテストが追加されている
- [ ] コードがプロジェクトのスタイルガイドラインに従っている
- [ ] 該当する場合、ドキュメントが更新されている
- [ ] コミットメッセージが以下のフォーマットに従っている

## コミットメッセージのフォーマット

コンベンショナルコミットメッセージを使用してください。

```
<type>(<scope>): <short summary>

<optional body>
```

### タイプ

- **feat**: 新機能
- **fix**: バグ修正
- **docs**: ドキュメントのみの変更
- **style**: フォーマット、セミコロンの欠落など (コード変更なし)
- **refactor**: バグ修正も機能追加もしないコード変更
- **test**: テストの追加または更新
- **chore**: ビルドプロセス、依存関係の更新、ツーリング

### スコープ

- **core**: コアプロトコル、CLI、スキーマ
- **sdk/ts**: TypeScript SDK
- **sdk/py**: Python SDK
- **sdk/go**: Go SDK
- **sdk/rust**: Rust SDK
- **sdk/wasm**: WASM SDK
- **integration/\***: フレームワーク統合
- **ci**: CI/CDワークフロー

### 例

```
feat(sdk/ts): add post-quantum signature support
fix(core): correct Merkle root computation for single-entry chains
docs(sdk/py): add installation instructions for extras
test(core): add conformance tests for expired bundles
chore(ci): add code coverage to TypeScript SDK workflow
```

## テスト要件

- すべての新機能には対応するテストを含めてください。
- バグ修正には、そのバグを捕捉できたはずのリグレッションテストを含めてください。
- `tests/conformance/` の適合性テストは、すべての実装でプロトコル準拠を検証します。
- SDKテストでは、バンドル作成、署名、検証、エラーケースをカバーしてください。
- PRがマージされる前にCIがパスする必要があります。テスト失敗は抑制されません — テストが失敗すると、ビルドも失敗します。

## 質問?

コントリビューションについて質問がある場合は、GitHub issueを開くか、ディスカッションを開始してください。喜んで最初の一歩をお手伝いします。
