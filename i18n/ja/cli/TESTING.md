<sub>[English](../../../cli/TESTING.md) · [中文](../../zh-CN/cli/TESTING.md) · [Español](../../es/cli/TESTING.md) · **日本語** · [Português](../../pt-BR/cli/TESTING.md)</sub>

<a id="testing-dcp-aicli"></a>

# `@dcp-ai/cli` のテスト

> [英語版](../../../cli/TESTING.md)の参考訳です（10/11/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

CLI 2.2.0 は `@dcp-ai/sdk` `^2.4.0` を必要とします。このリポジトリのテストは、公開前のソース変更を検証するため、意図的に同じチェックアウトからビルドした SDK を使います。

```bash
cd sdks/typescript && npm install && npm run build
cd ../../cli
npm install --no-save --package-lock=false --ignore-scripts --install-links ../sdks/typescript
npm test                        # the four suites
npm run test:negative-control   # must print "failed as required"
```

`--install-links` はビルドした SDK をリンクではなく `cli/node_modules` にコピーし、そのほかのフラグは `package.json` とロックファイルに手を付けず、インストールスクリプトを実行しません。CI も `.github/workflows/ci.yml` の `cli` ジョブで、Node 20 と 22 で同じことをします。そのジョブはリポジトリのルートをインストールしないため、ルートの `node_modules` を通じて解決されるものはありません。

<a id="suites"></a>

## スイート

- `__tests__/verify-s-range.test.mjs`：V1 の検証、Ed25519 の S の範囲（RFC 8032 §5.1.7）、終了コード、過去の V2 の形式の拒否。
- `__tests__/verify-ped1.test.mjs`：凍結されたコーパス `tests/interop/v2/ed25519_ped1_vectors.json` に対する、Ed25519 P-ED-1 のもとでの V1 の検証。
- `__tests__/version.test.mjs`：別の作業ディレクトリから実行したとき、`--version` が `package.json` のバージョンを表示すること。
- `__tests__/verify-v2-normative.test.mjs`：規範的な検証器による V2 のバンドル（SDK 間のベクター、規範以前のエンベロープ、`.dcp` の鍵の固定）、`lib/schemas/v2` のスキーマのコピー、そして単体で実行したパッケージのファイル。その子プロセスは `Date.now` を固定して実行されるため、結果は日付に左右されません。

各ケースは、上位に `.dcp/` のない新しい一時ディレクトリで、子プロセスとして `bin/dcp-ai.js` を実行します。

<a id="negative-control"></a>

## ネガティブコントロール

`DCP_NEGATIVE_CONTROL=1` を設定すると、各スイートは陽性のケースを 1 つ反転します。`__tests__/negative-control.mjs` は 4 つのスイートをそのように実行します。実行が 1 で終了し、ちょうどその 4 つのケースがそれぞれアサーションで失敗し、ほかのすべてのテストが通り、取り消されたものもスキップされたものもない場合にだけ合格します。それ以外の結果は、読み込めないスイートも含め、すべて不合格になります。

リファレンスの検証器とプレイグラウンドには独自の S の範囲のテスト（`tools/crypto-s-range.test.mjs`、`tools/playground-s-range.test.mjs`）があり、`conformance` のジョブが実行します。

<a id="against-an-installed-package"></a>

## インストール済みパッケージに対する実行

`DCP_CLI_ROOT` を指定すると、同じ 4 つのスイートとネガティブコントロールが、このチェックアウトの `cli/` ではなくインストール済みの `@dcp-ai/cli` を対象にします。

```bash
cd cli
DCP_CLI_ROOT="/path/to/consumer/node_modules/@dcp-ai/cli" npm test
DCP_CLI_ROOT="/path/to/consumer/node_modules/@dcp-ai/cli" npm run test:negative-control
```

このとき、バイナリ、`lib/`、依存パッケージは、インストールされたそのパッケージから取得されます。`__tests__/cli-under-test.mjs` がそこから解決し、このチェックアウト内のパスや依存パッケージは拒否します。フィクスチャと期待値はこのチェックアウトのものをそのまま使います。2 つのケースだけ動作が変わります。単体コピーのケースは、パッケージがインストールされた `node_modules` ディレクトリから依存パッケージを取得します。パッケージングのテストは、ソースツリーを対象とする `npm pack --dry-run` に問い合わせる代わりに、2 つのファイルがインストール済みパッケージに含まれていることを確認します。変数を指定しなければ何も変わりません。[リリース検証](../../../tools/release-validation/README.md)は、公開済みパッケージに対してこの方法でスイートを実行します。
