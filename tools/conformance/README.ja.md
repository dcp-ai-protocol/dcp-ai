<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · **日本語** · [Português](README.pt-BR.md)</sub>

<a id="dcp-ai-conformance-kit"></a>

# DCP-AI 適合性キット

> [英語版](README.md)の参考訳です（25/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

`tools/conformance.js` は、[`catalog.json`](catalog.json) で宣言されたスイートを、リポジトリにコミット済みの
フィクスチャとベクターに対して実行します。カタログはバージョン管理され（`kit_version`）、スイートごとに
生成すべきケース ID を正確に固定しています。キットはフィクスチャを読むだけです。チェックアウト内に鍵や
フィクスチャを生成せず、正規化、署名、プロファイル、スキーマ、ベクターも変更しません。

<a id="commands"></a>

## コマンド

```bash
npm run conformance                                    # every suite (same as node tools/conformance.js)
node tools/conformance.js --list                       # suites, pinned case counts and inventory
node tools/conformance.js --suite v1.integrity --suite v2.hashes
node tools/conformance.js --report /tmp/conformance.json
node --test tools/conformance/conformance.test.mjs     # runner self-tests (temporary copies only)
```

フィクスチャ、スキーマ、カタログのパスは、現在のディレクトリではなくスクリプトの位置から解決されます。
上記のコマンドはリポジトリのルートから実行してください。別のディレクトリからは、スクリプトを絶対パスで
呼び出します（`node /path/to/dcp-ai/tools/conformance.js`）。`--root <dir>` はキットをフィクスチャの別の
コピーに向けます（セルフテストは一時コピーに対してこれを使います）。

<a id="contract"></a>

## 契約

| 終了コード | 意味 |
|------------|------|
| 0 | 選択したすべてのケースが合格 |
| 1 | 少なくとも 1 件の不一致（値または判定が期待値と異なる） |
| 2 | 使用法エラー：不明な引数、不明・重複・空のスイート ID、`--report` と組み合わせた `--list` |
| 3 | インフラストラクチャエラー：フィクスチャの欠落または不正な形式、不正な形式の期待値、不明な設定 `kind`、カタログの欠落または不正な形式、例外、固定されたケースが生成されない、または固定されていないケースが生成された、あるいはチェックが 1 件も実行されなかった |

- ケースの欠落や余剰はエラーになります。そのため、他のベクターが残っているコレクションから 1 つを削除
  しても、カバレッジが黙って減ることはありません。例外を投げたスイートは、固定されたケースをすべて生成
  した後であっても失敗になります。
- `--report` を指定すると、実行前に `incomplete` のプレースホルダーが書き込まれ、最終レポートで置き換え
  られます。使用法エラーやカタログのエラーでもファイルは置き換えられます。これはキットが処理するエラーで、
  レポートのパスに書き込める場合に限ります。Node が起動できない場合やファイルに書き込めない場合は以前の
  ファイルが残ることがあるため、利用側は既存のファイルを信用せず、終了コードとレポートの `run.id` と
  `status` を確認してください。
- レポートには、`kit`（名前、バージョン、カタログの SHA-256）、`run`（uuid、タイムスタンプ、ルート、
  Node のバージョン）、`selection`、`status`、`totals`（`cases`、`executed`、`pass`、`fail`、`error`）、
  主張・制限・ケース（`status` と、`discrepancy`、`fixture`、`expectation`、`exception`、`catalog` の
  いずれかの `kind`）を含む各スイート、インベントリ、全体の制限が含まれます。

<a id="suites"></a>

## スイート

| スイート | ケース数 | 仕様 | スキーマ / ベクター | 合格が証明するもの |
|----------|----------|------|---------------------|--------------------|
| `v1.schema` | 7 | DCP-01、DCP-02、DCP-03、`BUNDLE.md` | `schemas/v1`、`tests/conformance/examples/*.json` | スキーマの妥当性のみ |
| `v1.integrity` | 9 | `VERIFICATION.md`（V1）、DCP-03 | `citizenship_bundle.signed.json`、`keys/public_key.txt`、`golden_vectors.json#v1_bundle_verification` | 1 つのフィクスチャの Ed25519 署名、バンドルハッシュ、Merkle ルート、インテントハッシュ、エントリハッシュ、`prev_hash` チェーンを golden 値と比較。鍵メタデータの整合性 |
| `v2.canonicalization` | 11 | `CANONICALIZATION_PROFILE.md` | `golden_vectors.json#canonicalization`、`#v2_canonicalization`、`interop_vectors.json#canonicalization` | リファレンス正規化器の `dcp-jcs-v1` バイト列 |
| `v2.hashes` | 9 | DCP-AI-v2.0 §2.3、§10.3 | `golden_vectors.json#hash_vectors`、`#dual_hash_vectors` | SHA-256 / SHA3-256 の値、デュアルハッシュ、デュアル Merkle ルート |
| `v2.signed_bundle` | 10 | `VERIFICATION.md`（V2） | `lib/verify.js`、メモリ内で構築したバンドル | 正当なバンドルと改ざんされたバンドルに対するリファレンス検証器の判定。検証済みは受け入れではない |
| `v2.schema` | 4 | DCP-AI-v2.0 | `schemas/v2`、`*_v2.json` の例 | スキーマの妥当性のみ |
| `ext.dcp05_09.schema` | 18 | DCP-05〜DCP-09 | `schemas/v2`、`<record>_v2.json` の例 | スキーマの妥当性のみ |
| `admission.strict_v1` | 117 | `spec/profiles/admission` | `admission_vectors.json` | 期待される受け入れ結果とエラーコード。`action_authorized` は常に false |

<a id="limits"></a>

## 制限

- 一部のスイートに合格しても、これらのフィクスチャに対するそのチェックが認定されるだけです。DCP の完全な
  実装、他の SDK、デプロイメントを認定するものではありません。スキーマのスイートはスキーマの妥当性のみを
  証明します。V2 スキーマのスイートだけでは、正規化・ハッシュ・署名のスイートなしに V2 実装にはなりません。
- `verified` と `admitted` がアクションを認可することはありません。
- アダプター（Express、FastAPI、OpenClaw、検証サーバー）はキットに含まれません。
- 未解決のプロトコル上の論点（`ext.dcp05_09.schema` に列挙され、キットは判断しません）：
  DCP-05 の `vitality_report` のメトリクスは [0, 1] の数値ですが、`dcp-jcs-v1` は整数しか正規化しません。
  DCP-08 §4.3 の逆ドメイン表記の権利は `right_type` の enum で拒否されます。DCP-09 は `effective_until`
  を使いますが、スキーマと SDK は `valid_until` を使います。DCP-04〜DCP-09 の例は、スキーマや SDK の
  コンテキストと異なる署名タグとフィールドを使っています。

<a id="inventory"></a>

## インベントリ

`--list` とレポートに、合計の外で表示されます。キットはこれらを実行せず、存在することは合格したテスト
ではありません。`interop_vectors.json` の攻撃ベクター、正規化のエッジケースとその他のカテゴリ、バンドル
とマンデートのベクターは SDK のテストスイートで実行されます。`tests/nist-kat/` には既知解ベクターと
プロパティテストがあり、それぞれ独自の範囲を持ちます（[その README](../../tests/nist-kat/README.ja.md)
を参照）。これらも SDK のテストスイートで実行されます。`dcp-jcs-v2` 候補は実験的で、
`dcp-jcs-v1` の外にあり、独自のスイート（`tests/interop/candidate/`）を持ちます。
