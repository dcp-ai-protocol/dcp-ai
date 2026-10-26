<a id="published-npm-packages"></a>

# 公開済み npm パッケージ

**Python の公開 (26/10/2026).** `dcp-ai` 2.10.0 が PyPI で公開され、検証器の修正、受け入れ判定、実験的なオプトイン API を含みます。Go と Rust の公開は別です。参照： [Python 2.10.0](PYTHON_RELEASE.md).

> [英語版](NPM_RELEASES.md)の参考訳です（26/10/2026 更新）。内容が異なる場合は英語版が優先されます。

2026 年 10 月 26 日に確認しました。以下の 13 バージョンは `latest` タグで公開済みです。レジストリの整合性値はテスト済み tarball と一致し、npm からの新規インストールで 383 項目の確認に合格しました。パッケージのバージョンは DCP のワイヤ形式・仕様のバージョンやリポジトリのタグとは独立しています。

| パッケージ | バージョン |
|---|---|
| [`@dcp-ai/sdk`](https://www.npmjs.com/package/@dcp-ai/sdk) | 2.2.0 |
| [`@dcp-ai/wasm`](https://www.npmjs.com/package/@dcp-ai/wasm) | 2.1.0 |
| [`@dcp-ai/cli`](https://www.npmjs.com/package/@dcp-ai/cli) | 2.1.0 |
| [`@dcp-ai/anthropic-mcp`](https://www.npmjs.com/package/@dcp-ai/anthropic-mcp) | 2.1.0 |
| [`@dcp-ai/autogen`](https://www.npmjs.com/package/@dcp-ai/autogen) | 2.0.1 |
| [`@dcp-ai/express`](https://www.npmjs.com/package/@dcp-ai/express) | 2.1.0 |
| [`@dcp-ai/google-a2a`](https://www.npmjs.com/package/@dcp-ai/google-a2a) | 2.1.0 |
| [`@dcp-ai/openclaw`](https://www.npmjs.com/package/@dcp-ai/openclaw) | 2.1.0 |
| [`@dcp-ai/w3c-did`](https://www.npmjs.com/package/@dcp-ai/w3c-did) | 2.0.1 |
| [`@dcp-ai/create-crewai`](https://www.npmjs.com/package/@dcp-ai/create-crewai) | 2.0.1 |
| [`@dcp-ai/create-express`](https://www.npmjs.com/package/@dcp-ai/create-express) | 2.0.1 |
| [`@dcp-ai/create-langchain`](https://www.npmjs.com/package/@dcp-ai/create-langchain) | 2.0.1 |
| [`@dcp-ai/create-openai`](https://www.npmjs.com/package/@dcp-ai/create-openai) | 2.0.1 |

<a id="install-the-published-versions"></a>

## 公開済みバージョンのインストール

```bash
npm install @dcp-ai/sdk@^2.2.0
npm install @dcp-ai/wasm@^2.1.0
npm install @dcp-ai/express@^2.1.0 express
npx --package=@dcp-ai/cli@2.1.0 dcp-ai --help
```

今回の公開対象は npm のみです。PyPI の Python パッケージ、crates.io の Rust クレート、Go モジュールのタグ、コンテナイメージは公開していません。それらの環境でチェックアウトの例を使う前に、各 SDK のリリース状況を確認してください。リポジトリのルートではチェックアウトしたソースのテストにローカル SDK を使い続けます。これは開発上の選択であり、npm での提供に関する制限ではありません。

`@dcp-ai/sdk` 2.2.0 はプリンシパルの信頼、`strict-v1`、検証器の修正、候補の実験的 API を含みます。`@dcp-ai/express` と `@dcp-ai/openclaw` 2.1.0 は修正済みの V2 署名検証と文書化された受け入れ判定の制御を含みます。それらの 2.0.0 には問題が残ります。[SECURITY.md](../SECURITY.md) を参照してください。公開によって、検証済みのバンドルが信頼されるわけでも、行為が許可されるわけでもありません。

`@dcp-ai/sdk` 2.2.0 と `@dcp-ai/wasm` 2.1.0 の両方で、`dcp-jcs-v2` は実験的かつ非規範的で、明示的な選択が必要なままです。`dcp-jcs-v1` が唯一の規範的な既定です。生成ツールやブリッジの補助関数には README に記載された制限が残ります。公開によってデモが本番用検証器に変わるわけではありません。
