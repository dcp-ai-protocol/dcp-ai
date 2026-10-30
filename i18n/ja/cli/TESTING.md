<sub>[English](../../../cli/TESTING.md) · [中文](../../zh-CN/cli/TESTING.md) · [Español](../../es/cli/TESTING.md) · **日本語** · [Português](../../pt-BR/cli/TESTING.md)</sub>

<a id="testing-dcp-aicli"></a>

# `@dcp-ai/cli` のテスト

> [英語版](../../../cli/TESTING.md)の参考訳です（26/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

公開済み CLI 2.1.0 は npm で提供される `@dcp-ai/sdk` `^2.2.0` を必要とします。このリポジトリのテストは、将来の公開前のソース変更を検証するため、意図的に同じチェックアウトからビルドした SDK を使います。

```bash
cd sdks/typescript && npm install && npm run build
cd ../../cli
npm install --no-save --package-lock=false --ignore-scripts --install-links ../sdks/typescript
npm test                        # both suites
npm run test:negative-control   # must print "failed as required"
```

`--install-links` はビルドした SDK をリンクではなく `cli/node_modules` にコピーし、そのほかのフラグは `package.json` とロックファイルに手を付けず、インストールスクリプトを実行しません。CI も `.github/workflows/ci.yml` の `cli` ジョブで、Node 20 と 22 で同じことをします。そのジョブはリポジトリのルートをインストールしないため、ルートの `node_modules` を通じて解決されるものはありません。

<a id="suites"></a>

## スイート

- `__tests__/verify-s-range.test.mjs`：V1 の検証、Ed25519 の S の範囲（RFC 8032 §5.1.7）、終了コード、過去の V2 の形式の拒否。
- `__tests__/verify-v2-normative.test.mjs`：規範的な検証器による V2 のバンドル（SDK 間のベクター、規範以前のエンベロープ、`.dcp` の鍵の固定）、`lib/schemas/v2` のスキーマのコピー、そして単体で実行したパッケージのファイル。その子プロセスは `Date.now` を固定して実行されるため、結果は日付に左右されません。

各ケースは、上位に `.dcp/` のない新しい一時ディレクトリで、子プロセスとして `bin/dcp-ai.js` を実行します。

<a id="negative-control"></a>

## ネガティブコントロール

`DCP_NEGATIVE_CONTROL=1` を設定すると、各スイートは陽性のケースを 1 つ反転します。`__tests__/negative-control.mjs` は両方のスイートをそのように実行します。実行が 1 で終了し、ちょうどその 2 つのケースがそれぞれアサーションで失敗し、ほかのすべてのテストが通り、取り消されたものもスキップされたものもない場合にだけ合格します。それ以外の結果は、読み込めないスイートも含め、すべて不合格になります。

リファレンスの検証器とプレイグラウンドには独自の S の範囲のテスト（`tools/crypto-s-range.test.mjs`、`tools/playground-s-range.test.mjs`）があり、`conformance` のジョブが実行します。
