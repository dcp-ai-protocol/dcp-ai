<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · **日本語** · [Português](README.pt-BR.md)</sub>

<a id="dcp-ai-conformance-kit"></a>

# DCP-AI 適合性キット

> [英語版](README.md)の参考訳です（28/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

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
| `v2.secondary_sha3` | 51 | `VERIFICATION.md` の V2-11 とその正誤 | `secondary_sha3_vectors.json`、`lib/verify.js` | 存在する二次の SHA3-256 フィールドに対するリファレンス検証器の判定。拒否される各ケースに対照あり。完全な二次チェーンではない |
| `v2.schema` | 4 | DCP-AI-v2.0 | `schemas/v2`、`*_v2.json` の例 | スキーマの妥当性のみ |
| `ext.dcp05_09.schema` | 18 | DCP-05〜DCP-09 | `schemas/v2`、`<record>_v2.json` の例 | スキーマの妥当性のみ |
| `ext.dcp05_09.wire` | 28 | DCP-05、DCP-08、DCP-09、`V2-WIRE-COMPATIBILITY.md` | `schemas/v2`、メモリ内で署名した記録、`interop_vectors.json#domain_separation_all_contexts` | これらの記録の表現、スキーマの妥当性、署名を別々の層として確認。機能的な適合ではない |
| `admission.strict_v1` | 117 | `spec/profiles/admission` | `admission_vectors.json` | 期待される受け入れ結果とエラーコード。`action_authorized` は常に false |

<a id="limits"></a>

## 制限

- 一部のスイートに合格しても、これらのフィクスチャに対するそのチェックが認定されるだけです。DCP の完全な
  実装、他の SDK、デプロイメントを認定するものではありません。スキーマのスイートはスキーマの妥当性のみを
  証明します。V2 スキーマのスイートだけでは、正規化・ハッシュ・署名のスイートなしに V2 実装にはなりません。
- `verified` と `admitted` がアクションを認可することはありません。
- アダプター（Express、FastAPI、OpenClaw、検証サーバー）はキットに含まれません。
- プロトコル上の論点（`spec/V2-WIRE-COMPATIBILITY.md` による）：DCP-09 の期限のフィールド（`valid_until`）と、
  DCP-05、DCP-08、DCP-09 の署名コンテキストは正誤で訂正され、`ext.dcp05_09.wire` でテストされます。明示的で
  バージョン管理された設計を待っており、キットが判断しないもの：DCP-05 の `vitality_report` の小数のメトリクス
  （`dcp-jcs-v1` では 0 と 1 しか表現できない）、DCP-08 §4.3 の逆ドメイン表記の権利（`right_type` の enum で
  拒否される）、2 人目の署名者や確認応答（DCP-05 §4.4、DCP-09 §3.3 と §6.3）。DCP-04、DCP-06、DCP-07 の例は
  これらの正誤の対象外です。

<a id="inventory"></a>

## インベントリ

`--list` とレポートに、合計の外で表示されます。キットはこれらを実行せず、存在することは合格したテスト
ではありません。`interop_vectors.json` の攻撃ベクター、正規化のエッジケースとその他のカテゴリ、バンドル
とマンデートのベクターは SDK のテストスイートで実行されます。`tests/nist-kat/` には既知解ベクターと
プロパティテストがあり、それぞれ独自の範囲を持ちます（[その README](../../tests/nist-kat/README.ja.md)
を参照）。これらも SDK のテストスイートで実行されます。`dcp-jcs-v2` 候補は実験的で、
`dcp-jcs-v1` の外にあり、独自のスイート（`tests/interop/candidate/`）を持ちます。

<a id="external-implementations"></a>

## 外部実装

`tools/conformance-external.js` は、別のカタログ [`external-catalog.json`](external-catalog.json)（契約
`dcp-ai-conformance-external/1`）を、`--` の後に argv として指定した実装に対して実行します。実装はどの言語で書いても
かまいません。stdin から JSON のリクエストを 1 つ読み、stdout に JSON のレスポンスを 1 つ書きます。ランナーには
Node 20 以降が必要で、組み込みモジュールだけを使います。上記のコマンド、カタログ、レポートは変わりません。

```bash
node tools/conformance-external.js --list
node tools/conformance-external.js --report /tmp/external.json -- node tools/conformance/wrappers/ts-sdk.mjs
node tools/conformance-external.js -- /path/to/python -I tools/conformance/wrappers/python_sdk.py
node tools/conformance-external.js --suite external.digest -- ./my-implementation --its-own-flag
node --test tools/conformance/external.test.mjs
DCP_EXTERNAL_PYTHON=/path/to/python DCP_EXTERNAL_REQUIRE_PYTHON=1 node --test tools/conformance/external.test.mjs
```

`DCP_EXTERNAL_PYTHON` がないと、`node --test` は Python のラッパーをスキップし、その旨を表示します。
`DCP_EXTERNAL_REQUIRE_PYTHON=1` を指定すると、インタープリターがないことは失敗になります。最後のコマンドは
すべてのテストを実行します。

| スイート | ケース | ベクター |
|----------|--------|----------|
| `external.dcp-jcs-v1.canonicalize` | 30 | `golden_vectors.json#canonicalization`、`#v2_canonicalization`、`interop_vectors.json#canonicalization` とその 19 の `edge_cases`（うち 3 つは拒否されなければならない） |
| `external.digest` | 8 | `golden_vectors.json#hash_vectors`、`#dual_hash_vectors` の raw と intent（SHA-256 と SHA3-256） |

最小のやり取りとして、0 バイトの SHA-256 を TypeScript のラッパーに対して実行できます。

```bash
printf '%s' '{"contract":"dcp-ai-conformance-external/1","run_id":"00000000-0000-4000-8000-000000000000","nonce":"00000000000000000000000000000000","cases":[{"id":"c1","op":"digest","alg":"sha256","input_b64":""}]}' | node tools/conformance/wrappers/ts-sdk.mjs
```

このリクエストに対する有効なレスポンスです（ラッパーはさらに `resolved_from` と `runtime` を加えます）。

```json
{"contract":"dcp-ai-conformance-external/1","run_id":"00000000-0000-4000-8000-000000000000","nonce":"00000000000000000000000000000000","implementation":{"name":"example","version":"0.0.1"},"results":[{"id":"c1","status":"ok","hex":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}]}
```

- **封筒：** リクエストとレスポンスは UTF-8 の JSON です。レスポンスは stdout 上のちょうど 1 つの JSON 文書で、
  プロセスは終了コード 0 で終了します。
- **リクエスト：** `contract`、`run_id`、`nonce`、`cases`。各ケースは `id`、`op`（`profile` が `dcp-jcs-v1` の
  `canonicalize`、または `alg` が `sha256` か `sha3-256` の `digest`）、`input_b64` を持ちます。ID は実行ごとに
  ランダムで、期待値は送りません。canonicalize の入力は JSON テキストです。`input_json` のベクターはコミットされた
  とおりに、`input` の値は `JSON.stringify` が書くとおりに送ります。
- **レスポンス：** 同じ `contract`、`run_id`、`nonce`、`implementation`（`name`、`version`、任意の `resolved_from`
  と `runtime`。いずれも実装の自己申告）、そして `results` です。`results` はケースごとにちょうど 1 つのオブジェクト
  を持つ配列で、各オブジェクトはそのケースの `id` と `status` を持ちます。`status` は、`output_b64`（正規化された
  バイト列）または `hex` を持つ `ok`、`code` が `parse` か `profile` の `rejected`、`message` を持つ `error`、
  または `unsupported` です。それ以外のフィールドは受け付けません。
- **エンコーディング：** `input_b64` と `output_b64` は、標準のアルファベット、パディングあり、改行なしの
  RFC 4648 base64 の正規形です。`hex` はちょうど 64 文字の小文字の 16 進数です。
- **判定：** バイト列は完全に比較し、拒否されなければならないベクターは拒否されたときだけ合格です。`error` や
  `unsupported` の結果、不正な形式・欠落・重複・余分な結果、古い `run_id` や `nonce`、不正な出力、0 以外の終了
  コードやシグナル、タイムアウト、4 MiB を超える stdout はエラーであり、合格にはなりません。終了コードは
  [契約](#contract)のとおりです。
- **プロセス：** シェルを使わずに起動し、POSIX では独自のプロセスグループに入れます。期限は 1 つ
  （`--timeout-ms`、既定 30 000）で、単調時計で測ります。その後 SIGTERM、2 秒後に SIGKILL を送り、パイプが閉じる
  のを最大 2 秒待ちます（閉じなければ `cleanup_incomplete`）。stderr は 64 KiB まで保持し、解釈はしません。
- **カタログとフィクスチャ** は事前に検証します。ID が一意であること、ポインターが存在すること、期待値がベクターと
  整合していること、各コレクションのすべてのメンバーが操作とアルゴリズムごとに 1 回ずつ固定されていることです。
  欠陥があれば exit 3 です。レポートには、カタログ、フィクスチャ、リクエストのハッシュと、実装が自己申告した
  識別情報をランナーが観測した内容と分けて記録します。
- **レポート：** `--report` の値がない、オプションのように見える、または繰り返されている場合は使い方のエラー
  （exit 2）で、パスがあいまいなためレポートは書きません。上記のコマンドと同様に、Node が起動しない場合、レポートを
  書けない場合、ランナーが強制終了された場合にも古いレポートが残ることがあります。必ず終了コードを確認し、その後で
  レポートの `run.id` と `status` を確認してください。
- **ラッパー：** `wrappers/ts-sdk.mjs`（`@dcp-ai/sdk`。`--sdk <path>` は任意）と `wrappers/python_sdk.py`
  （インストール済みの `dcp_ai`。`-I` で実行）。どちらも実際の正規化関数を 1 回だけ呼び、SDK が文書化している
  非整数の拒否に対してだけ `rejected`/`profile` を返します。SDK には安定したエラーコードがないため、型とメッセージ
  で判別します。これらが変わると、正しい拒否はエラーとして表示され、合格にはなりません。CI は両方のラッパーを
  実行します。
- **制限：** 合格が示すのは、実行した argv が、それが使うパーサーを通してこれら 38 ケースに合格したことです。完全な
  `dcp-jcs-v1` の実装や DCP への適合を示すものではなく、識別情報は自己申告です。サンドボックスではありません。実装は
  あなたの権限と環境で実行され、プロセスグループから離れた子孫（`setsid`）は見えず、Windows では直接の子だけを終了
  させます。
