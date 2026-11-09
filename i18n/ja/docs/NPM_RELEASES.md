<a id="published-npm-packages"></a>

# 公開済み npm パッケージ

> [英語版](../../../docs/NPM_RELEASES.md)の参考訳です（09/11/2026 更新）。内容が異なる場合は英語版が優先されます。

2026 年 11 月 5 日に確認しました：`@dcp-ai/sdk` 2.3.0 と `@dcp-ai/wasm` 2.1.3 は `latest` タグで公開済みです。表のその他の 11 パッケージは変わりません（[変更点](#what-changed-on-05112026)）。2026 年 10 月 28 日には `@dcp-ai/sdk` 2.2.1、`@dcp-ai/wasm` 2.1.1、`@dcp-ai/cli` 2.1.1 が `latest` タグで公開されました。パッケージのバージョンは DCP のワイヤ形式・仕様のバージョンやリポジトリのタグとは独立しています。

2026 年 10 月 26 日には、`@dcp-ai/sdk` 2.2.0、`@dcp-ai/wasm` 2.1.0、`@dcp-ai/cli` 2.1.0 と、表に残っている 10 パッケージの計 13 バージョンが `latest` タグで公開されました。レジストリの整合性値はテスト済み tarball と一致し、npm からの新規インストールで 383 項目の確認に合格しました。

| パッケージ | バージョン |
|---|---|
| [`@dcp-ai/sdk`](https://www.npmjs.com/package/@dcp-ai/sdk) | 2.3.0 |
| [`@dcp-ai/wasm`](https://www.npmjs.com/package/@dcp-ai/wasm) | 2.1.3 |
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

`@dcp-ai/sdk` 2.2.1 と `@dcp-ai/wasm` 2.1.1 は、[VERIFICATION.md の V2-11](../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) の任意の二次 SHA3-256 フィールドが存在する場合にそれらを検証します。存在しないフィールドは要求されないため、検証済みのバンドルが完全な二次チェーンを持たないこともあり、存在するフィールドが `null`、文字列でない、または不整合の場合は拒否されます。`@dcp-ai/cli` 2.1.1 は `@dcp-ai/sdk` `^2.2.1` を必要とし、`--version` は `2.1.1` を表示します。API、結果のフィールド、`dcp-jcs-v1`、実験的でオプトインの `dcp-jcs-v2` API、`hash_alg` の扱いは変わりません。 公開済みのアダプター `@dcp-ai/express`、`@dcp-ai/openclaw`、`@dcp-ai/anthropic-mcp`、`@dcp-ai/google-a2a` 2.1.0 は再公開していません。これらは `@dcp-ai/sdk` `^2.2.0` に依存しており、ロックファイルが `@dcp-ai/sdk` 2.2.1 以降を解決すると二次の確認が行われます。

レジストリの 3 つの tarball はレビュー済みの成果物とバイト単位で同一で、`sha512` の整合性値も一致しました。ローカルの上書きなしで npm からインストールした新しい利用側は、二次 SHA3-256 の判定 411 件と対照 87 件、回帰確認 340 件、CLI の確認 80 件（`--version` 2.1.1）に合格しました。レジストリの `@dcp-ai/wasm` パッケージは実際のブラウザーで 167 件の確認に合格しました。

<a id="install-the-published-versions"></a>

## 公開済みバージョンのインストール

```bash
npm install @dcp-ai/sdk@^2.3.0
npm install @dcp-ai/wasm@^2.1.3
npm install @dcp-ai/express@^2.1.0 express
npx --package=@dcp-ai/cli@2.1.1 dcp-ai --help
```

npm の各公開の対象は npm のみです。PyPI の Python パッケージ、crates.io の Rust クレート、Go モジュールのタグ、コンテナイメージは公開していません。それらの環境でチェックアウトの例を使う前に、各 SDK のリリース状況を確認してください。リポジトリのルートではチェックアウトしたソースのテストにローカル SDK を使い続けます。これは開発上の選択であり、npm での提供に関する制限ではありません。

2.2.0 以降の `@dcp-ai/sdk` はプリンシパルの信頼、`strict-v1`、検証器の修正、候補の実験的 API を含みます。`@dcp-ai/express` と `@dcp-ai/openclaw` 2.1.0 は修正済みの V2 署名検証と文書化された受け入れ判定の制御を含みます。それらの 2.0.0 には問題が残ります。[SECURITY.md](../../../SECURITY.md) を参照してください。公開によって、検証済みのバンドルが信頼されるわけでも、行為が許可されるわけでもありません。

`@dcp-ai/sdk` 2.2.0 以降と `@dcp-ai/wasm` 2.1.0 以降で、`dcp-jcs-v2` は実験的かつ非規範的で、明示的な選択が必要なままです。`dcp-jcs-v1` が唯一の規範的な既定です。生成ツールやブリッジの補助関数には README に記載された制限が残ります。公開によってデモが本番用検証器に変わるわけではありません。

<a id="what-changed-on-05112026"></a>

## 2026 年 11 月 5 日の変更点

`@dcp-ai/sdk` 2.3.0 と `@dcp-ai/wasm` 2.1.3 は、公開前にテストした tarball から 05/11/2026 に公開されました。これらは、下記の 30/10/2026 の `@dcp-ai/wasm` 2.1.2 の候補を置き換えます。2.1.2 は公開されませんでした。

`@dcp-ai/sdk` 2.3.0 の 2.2.1 との違い：

- **V2-2 スキーマ検証（受け入れの変更）。** `verifySignedBundleV2`、統合されたアドミッション API、実験的な候補検証器は、ハッシュ、鍵、署名を確認する前に、署名済みバンドルのエンベロープと 4 つのペイロードを `schemas/v2` に照らして検証します。以前は受け入れられていたスキーマ上無効なバンドル（閉じたオブジェクト内の未知のメンバーや、マニフェスト内の `null` のセッション時刻など）は、`schema: <pointer> <keyword>` 診断とともに `verified: false` を返すようになりました。
- **委任状。** `verifyMandateValidity` は一つの契約を適用し、省略可能な `now` を受け取ります。以前は受け入れられていた欠落した日付や不正な形式の日付は無効です。`verifyMandateChain` はすべての時刻を同じ方法で読み取り、ドメインを繰り返すルート委任状を拒否します。
- **`VerificationCache`。** オプトインのオプション `context` と `agentIds` が加わりました。無効なオプションは例外を投げ、`set` と `get` は結果をコピーし、エントリーは単調時計でちょうど TTL に達した時点で期限切れになり、`invalidateByAgent` はエントリーを削除するようになりました。

`@dcp-ai/wasm` 2.1.3 の 2.1.1 との違い：

- **`dualMerkleRoot` が V2-11 に従う（受け入れの変更）。** この関数と直接のエクスポート `wasm_dual_merkle_root` は、`verifyBundle` がすでに使っていた [VERIFICATION.md V2-11](../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) の縮約（32 バイトの生のダイジェスト、奇数の層では最後のノードを複製）で二重 Merkle ルートを算出します。2.1.1 以前は 16 進テキストをハッシュし、奇数の最後のノードを変えずに上の層へ送るため、2 個以上の葉のルートが異なります。32 バイトの 16 進ダイジェストでない葉はエラーになり、ルートは小文字で返されます。
- **V2-2 スキーマ検証（受け入れの変更）。** `verifyBundle` と `wasm_verify_signed_bundle_v2` は、ハッシュ、鍵、署名を確認する前に、エンベロープと 4 つのペイロードを `schemas/v2` に照らして検証します。
- **JavaScript API の追加はありません。** WebAssembly は、同じく 05/11/2026 に公開された Rust `dcp-ai` 2.13.0 のソースから生成されます（[Rust](../../../docs/RUST_RELEASE.md) を参照）。

どちらのパッケージも、ワイヤーフォーマット、署名、プロファイル、規範的なデフォルトとしての `dcp-jcs-v1`、実験的なオプトイン `dcp-jcs-v2` API を維持し、Apache-2.0 の `LICENSE` を含みます。公開済みの各 tarball に含まれる README は公開前に準備したもので、「prepared, not published」と記載しており、WASM の README ではハッシュ操作の表の `dualMerkleRoot` の行がまだ「Prepared for 2.1.2」と記載しています。公開済みの tarball は変更できません。このページとリポジトリの README が公開済みのバージョンを説明します。

レジストリの `@dcp-ai/sdk` 2.3.0 と `@dcp-ai/wasm` 2.1.3 の tarball は、テスト済みの成果物とバイト単位で同一で、`sha512` の完全性も同じです。override なしで npm からそれらをインストールした新しい利用側は、外部適合性キット（SDK は 7 カタログ、697 ケース、`@dcp-ai/wasm` は対応する 5 カタログ、460 ケース）に合格し、そのインストールから配信した WASM パッケージはブラウザーで 14 の確認に合格しました。

<a id="migrating-dualmerkleroot-results"></a>

### `dualMerkleRoot` の結果の移行

この修正で変わるのは関数が算出するルートであり、すでに保持している証拠ではありません：

- **過去の証拠はそのまま保持してください。** `@dcp-ai/wasm` 2.1.1 以前で算出したルートと、それを含むバンドル、署名、アンカー、ログエントリーは、記録されたままです。一致させるために 2.1.3 で再計算して保存済みの値を置き換えないでください。署名済みまたはアンカー済みの証拠を書き換え、その署名を無効にします。
- **どのバージョンがルートを算出したかを記録してください。** 2.1.1 以前による 2 個以上の葉のルートは、同じ葉の V2-11 のルートではありません。確認するには、そのルートを生成したバージョンで再計算するか、その横に V2-11 のルートを算出して両方の値を保持してください。
- **新しいルート**は、2.1.3 か、すでに V2-11 に従っている他の SDK で算出します。バンドル検証が使う Merkle の縮約は変わりません。`verifyBundle` はすでに V2-11 を使っていました。ただし、上で説明した新しい V2-2 スキーマ検証は受け入れを変えます。

<a id="cli-and-adapters"></a>

### CLI とアダプター

`@dcp-ai/cli` と npm アダプターには新しいバージョンはありません。公開済みの範囲（CLI は `^2.2.1`、アダプターは `^2.2.0`）は `@dcp-ai/sdk` 2.3.0 を受け入れます。2 回確認しました。公開前は override で `@dcp-ai/sdk` を候補に解決させて npm からインストールし、公開後は override なしで npm からインストールして、それぞれの範囲がレジストリの `@dcp-ai/sdk` 2.3.0 を一つだけ、テスト済みの完全性で解決しました。どちらの場合も：

- **機能を確認：** `@dcp-ai/cli` 2.1.1（`--version`、有効な V2 バンドル、スキーマ上無効なバンドル。後者は SDK の実行前に CLI 自身のスキーマ確認が拒否します）、`@dcp-ai/express` と `@dcp-ai/openclaw` 2.1.0（アドミッションと検証の修正に対する回帰確認）。
- **インストールのみ確認：** `@dcp-ai/anthropic-mcp` と `@dcp-ai/google-a2a`（解決された `@dcp-ai/sdk` 2.3.0 が一つであること、受け入れられる範囲、エントリーポイントのインポート）、および SDK に依存しないパッケージ（エントリーポイントが構文解析できること）。これは統合テストではありません。

<a id="prepared-not-published-dcp-aiwasm-212"></a>

## 準備済み・未公開: `@dcp-ai/wasm` 2.1.2

`@dcp-ai/wasm` 2.1.2 は 30/10/2026 にリポジトリで準備済みですが、npm では公開されていません。準備の時点では、表とインストールコマンドは当時のレジストリのバージョンのままでした。現在のものは上記のとおりです。

`dualMerkleRoot` と生のエクスポート `wasm_dual_merkle_root` を修正します。`verifyBundle` がすでに使っていた [VERIFICATION.md の V2-11](../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) の縮約（32 バイトの生のダイジェストを使い、奇数個の層では最後のノードを複製する）で二重 Merkle ルートを計算するようになりました。2.1.1 以前は 16 進テキストをハッシュし、奇数個の層の最後のノードをそのまま上に渡すため、2 個以上の葉のルートが V2-11 と異なります。2.1.1 以前が受け入れていた不正な形式の葉は、エラーになりました。各葉は 32 バイトの 16 進ダイジェストでなければなりません。大文字の 16 進は受け入れられ、ルートは小文字で返されます。空の配列は以前と同じエラーになり（`dualMerkleRoot` は例外を投げます）、結果は `sha256` と `sha3_256` の 2 つのフィールドのままです。

`verifyBundle`、その他の API、`dcp-jcs-v1`、実験的でオプトインの `dcp-jcs-v2` API は変わらず、JavaScript API の追加もありません。tarball には翻訳版 README が含まれなくなりました。これらは現在、リポジトリの `i18n/` ツリーにあります。WebAssembly は Rust の `dcp-ai` 2.12.0 から作られ、これも準備済み・未公開です（[Rust](../../../docs/RUST_RELEASE.md) を参照）。

> **注記（05/11/2026）。** 上の段落は、準備済みの 2.1.2 について 30/10/2026 に書いたもので、2.1.2 は公開されませんでした。#116（02/11/2026）以降、`main` の `verifyBundle` はラップしている Rust のコアで V2-2 のスキーマ検証を実行します。2.1.2 はこの変更を含まず、上の 2.1.3 は含みます。2.1.3 は 2.1.2 を置き換え、`main` のマニフェストは 2.1.3 を記載しています。2.1.2 を挙げている記述や表（WASM の README の `dualMerkleRoot` の行を含む）は過去の記録です。[監査資料](../../../docs/conformance/AUDIT_DOSSIER.md#artifacts)を参照してください。

<a id="prepared-not-published-dcp-aisdk-240-dcp-aiwasm-220-and-dcp-aicli-220"></a>

## 準備済み・未公開：`@dcp-ai/sdk` 2.4.0、`@dcp-ai/wasm` 2.2.0、`@dcp-ai/cli` 2.2.0

08/11/2026 に準備し、公開していません。上記のバージョンは、各パッケージが公開されて確認されるまでレジストリのものです。

- **`@dcp-ai/sdk` 2.4.0：** オプトインの委任アドミッション、バイトからのアドミッション、委任状の確認応答と、Ed25519 の受理の変更 P-ED-1（[変更履歴](../../../CHANGELOG.md#unreleased)）。
- **`@dcp-ai/wasm` 2.2.0：** エラーと値の区別（`canonicalize`、`hashObject`、`deriveKid`）、Rust のプロバイダーにおける P-ED-1、ビルドした人のローカルパスを含まないバイナリ。アドミッションや委任状チェーンの API はありません。
- **`@dcp-ai/cli` 2.2.0：** `dcp-ai verify` における P-ED-1、`@dcp-ai/sdk` `^2.4.0`、パッケージ内の `LICENSE`、`package.json` から読むバージョン。[CLI のガイド](../cli/README.md)を参照してください。
- アダプターには新しいバージョンはありません。`^2.2.0` の範囲は新しいインストールで `@dcp-ai/sdk` 2.4.0 を解決し、それとともに P-ED-1 も適用されます。

<a id="related-releases"></a>

## 関連するリリース

各レジストリの現在のバージョンは[公開済みバージョン](../../../docs/README.md#published-versions)にあります。その他のリリースノート：[Python 2.10.2](../../../docs/PYTHON_RELEASE.md)、[Go v2.13.0](../../../docs/GO_RELEASE.md)、[Rust 2.13.0](../../../docs/RUST_RELEASE.md)。
