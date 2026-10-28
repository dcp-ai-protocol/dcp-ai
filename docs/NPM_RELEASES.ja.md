<a id="published-npm-packages"></a>

# 公開済み npm パッケージ

> [英語版](NPM_RELEASES.md)の参考訳です（28/10/2026 更新）。内容が異なる場合は英語版が優先されます。

2026 年 10 月 28 日に確認しました：`@dcp-ai/sdk` 2.2.1、`@dcp-ai/wasm` 2.1.1、`@dcp-ai/cli` 2.1.1 は `latest` タグで公開済みです。表のその他の 10 パッケージは変わりません。パッケージのバージョンは DCP のワイヤ形式・仕様のバージョンやリポジトリのタグとは独立しています。

2026 年 10 月 26 日には、`@dcp-ai/sdk` 2.2.0、`@dcp-ai/wasm` 2.1.0、`@dcp-ai/cli` 2.1.0 と、表に残っている 10 パッケージの計 13 バージョンが `latest` タグで公開されました。レジストリの整合性値はテスト済み tarball と一致し、npm からの新規インストールで 383 項目の確認に合格しました。

| パッケージ | バージョン |
|---|---|
| [`@dcp-ai/sdk`](https://www.npmjs.com/package/@dcp-ai/sdk) | 2.2.1 |
| [`@dcp-ai/wasm`](https://www.npmjs.com/package/@dcp-ai/wasm) | 2.1.1 |
| [`@dcp-ai/cli`](https://www.npmjs.com/package/@dcp-ai/cli) | 2.1.1 |
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

<a id="what-changed-on-28102026"></a>

## 2026 年 10 月 28 日の変更点

`@dcp-ai/sdk` 2.2.1 と `@dcp-ai/wasm` 2.1.1 は、[VERIFICATION.md の V2-11](../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) の任意の二次 SHA3-256 フィールドが存在する場合にそれらを検証します。存在しないフィールドは要求されないため、検証済みのバンドルが完全な二次チェーンを持たないこともあり、存在するフィールドが `null`、文字列でない、または不整合の場合は拒否されます。`@dcp-ai/cli` 2.1.1 は `@dcp-ai/sdk` `^2.2.1` を必要とし、`--version` は `2.1.1` を表示します。API、結果のフィールド、`dcp-jcs-v1`、実験的でオプトインの `dcp-jcs-v2` API、`hash_alg` の扱いは変わりません。 公開済みのアダプター `@dcp-ai/express`、`@dcp-ai/openclaw`、`@dcp-ai/anthropic-mcp`、`@dcp-ai/google-a2a` 2.1.0 は再公開していません。これらは `@dcp-ai/sdk` `^2.2.0` に依存しており、ロックファイルが `@dcp-ai/sdk` 2.2.1 以降を解決すると二次の確認が行われます。

レジストリの 3 つの tarball はレビュー済みの成果物とバイト単位で同一で、`sha512` の整合性値も一致しました。ローカルの上書きなしで npm からインストールした新しい利用側は、二次 SHA3-256 の判定 411 件と対照 87 件、回帰確認 340 件、CLI の確認 80 件（`--version` 2.1.1）に合格しました。レジストリの `@dcp-ai/wasm` パッケージは実際のブラウザーで 167 件の確認に合格しました。

<a id="install-the-published-versions"></a>

## 公開済みバージョンのインストール

```bash
npm install @dcp-ai/sdk@^2.2.1
npm install @dcp-ai/wasm@^2.1.1
npm install @dcp-ai/express@^2.1.0 express
npx --package=@dcp-ai/cli@2.1.1 dcp-ai --help
```

npm の各公開の対象は npm のみです。PyPI の Python パッケージ、crates.io の Rust クレート、Go モジュールのタグ、コンテナイメージは公開していません。それらの環境でチェックアウトの例を使う前に、各 SDK のリリース状況を確認してください。リポジトリのルートではチェックアウトしたソースのテストにローカル SDK を使い続けます。これは開発上の選択であり、npm での提供に関する制限ではありません。

2.2.0 以降の `@dcp-ai/sdk` はプリンシパルの信頼、`strict-v1`、検証器の修正、候補の実験的 API を含みます。`@dcp-ai/express` と `@dcp-ai/openclaw` 2.1.0 は修正済みの V2 署名検証と文書化された受け入れ判定の制御を含みます。それらの 2.0.0 には問題が残ります。[SECURITY.md](../SECURITY.md) を参照してください。公開によって、検証済みのバンドルが信頼されるわけでも、行為が許可されるわけでもありません。

`@dcp-ai/sdk` 2.2.0 以降と `@dcp-ai/wasm` 2.1.0 以降で、`dcp-jcs-v2` は実験的かつ非規範的で、明示的な選択が必要なままです。`dcp-jcs-v1` が唯一の規範的な既定です。生成ツールやブリッジの補助関数には README に記載された制限が残ります。公開によってデモが本番用検証器に変わるわけではありません。

<a id="related-releases"></a>

## 関連するリリース

各レジストリの現在のバージョンは[公開済みバージョン](README.md#published-versions)にあります。その他のリリースノート：[Python 2.10.1](PYTHON_RELEASE.md)、[Go v2.11.1](GO_RELEASE.md)、[Rust 2.11.1](RUST_RELEASE.md)。
