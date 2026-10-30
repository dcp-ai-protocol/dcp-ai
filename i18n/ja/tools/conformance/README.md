<sub>[English](../../../../tools/conformance/README.md) · [中文](../../../zh-CN/tools/conformance/README.md) · [Español](../../../es/tools/conformance/README.md) · **日本語** · [Português](../../../pt-BR/tools/conformance/README.md)</sub>

<a id="dcp-ai-conformance-kit"></a>

# DCP-AI 適合性キット

> [英語版](../../../../tools/conformance/README.md)の参考訳です（29/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

`tools/conformance.js` は、[`catalog.json`](../../../../tools/conformance/catalog.json) で宣言されたスイートを、リポジトリにコミット済みの
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
プロパティテストがあり、それぞれ独自の範囲を持ちます（[その README](../../tests/nist-kat/README.md)
を参照）。これらも SDK のテストスイートで実行されます。`dcp-jcs-v2` 候補は実験的で、
`dcp-jcs-v1` の外にあり、独自のスイート（`tests/interop/candidate/`）を持ちます。

<a id="external-implementations"></a>

## 外部実装

`tools/conformance-external.js` は、別のカタログ [`external-catalog.json`](../../../../tools/conformance/external-catalog.json)（契約
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

<a id="go-rust-and-wasm-wrappers"></a>

### Go、Rust、WASM のラッパー

さらに 3 つのラッパーが、同じ 38 ケースと同じ契約を、このチェックアウトの Go SDK、Rust SDK、Rust SDK の
WASM ビルドに対して実行します。`build.mjs` はそれらを `tools/conformance/wrappers/.build/`（Git の対象外）に
コンパイルします。Go 1.25 以降、Cargo、`wasm32-unknown-unknown` ターゲット付きの `wasm-pack` が必要です。
DCP のパッケージをインストールや公開することはなく、SDK のマニフェストやロックファイルも変更しません。`--offline`
なしでは、Cargo と `wasm-pack` がビルドツールや固定された依存関係をキャッシュにダウンロードすることがあります。
`--offline` は `GOPROXY=off`、Cargo の `--offline`、`wasm-pack --mode no-install` を使い、それらのキャッシュが
すでに埋まっている必要があります。

```bash
node tools/conformance/wrappers/build.mjs all
node tools/conformance/wrappers/build.mjs --offline go rust wasm
node tools/conformance-external.js -- tools/conformance/wrappers/.build/go-wrapper
node tools/conformance-external.js -- tools/conformance/wrappers/.build/rust-target/debug/dcp-ai-conformance-wrapper
node tools/conformance-external.js -- node tools/conformance/wrappers/wasm.mjs
DCP_EXTERNAL_REQUIRE_NATIVE=1 node --test tools/conformance/external-native.test.mjs
```

- **ビルド：** Go はラッパーの `go.mod` と `go.sum` に対して `-mod=readonly` でビルドします。そのバージョンは SDK
  自身のものの部分集合です。Cargo は `--locked` でビルドします。ネイティブのラッパーはその `Cargo.lock`（SDK の
  ロックのコピーをオフラインで解決したもので、固定されたバージョンは同じ）を、WASM の成果物は SDK の
  `Cargo.lock` を使います。`--offline` はローカルのキャッシュだけを使います。SDK のマニフェストやロックファイルは
  変わりません。
- **Go**（`wrappers/go`）：入力は UTF-8 でなければなりません（`encoding/json` は不正なバイトを置き換えるため、
  先に確認します）。その後、SDK 自身の interop テストと同じく `interface{}` に `json.Unmarshal` し、
  `v2.CanonicalizeV2` を 1 回だけ呼びます。`rejected`/`profile` になるのは文書化された拒否（`non-integer float at`、`non-finite float at`）だけです。ダイジェストは `v2.SHA256Hex`、`v2.SHA3256Hex`。バージョンはローカルの
  チェックアウトとして報告します。
- **Rust**（`wrappers/rust`）：致命的な UTF-8 デコード、`serde_json::from_str`、そして
  `dcp_ai::v2::canonicalize::canonicalize_v2` を 1 回だけ呼びます。`rejected`/`profile` になるのは文書化された
  拒否（パスの接頭辞の後に続く `Non-integer number in V2 canonical form:`、`Non-finite number in V2 canonical form:`）だけです。ダイジェストは `sha256_hex`、`sha3_256_hex`。バージョンは `DCP_SDK_VERSION` です。
- **WASM**（`wrappers/wasm.mjs`）：`wasm-pack` が `sdks/rust` から `wasm` フィーチャー（`--target web`）で
  コンパイルした実際の `.wasm` を読み込み、その SHA-256 を報告します。生の JSON テキストを
  `wasm_canonicalize_v2` に 1 回だけ渡し、呼び出し前に JavaScript で `JSON.parse` や
  `JSON.stringify` は使いません。呼び出し後は、曖昧さを示すためだけに入力と出力を調べ、バイト列を計算し直すことは
  ありません。この
  エクスポートはエラーを結果の中で `{"error": "…"}` として返しますが、有効な入力も同じものを生成し得ます。その
  ため、単一キーの `{"error": string}` の結果は、入力自体が唯一のキーが `error` であるルートオブジェクト（値の型は問わない）であれば曖昧な `error`
  とし、それ以外では文書化されたメッセージの場合にだけ拒否とします。ダイジェストのエクスポートはテキストを
  受け取ります。8 つのダイジェスト入力はテキストで、UTF-8 でないバイト列は `error` となり、置き換えはしません。
- **エラー：** 3 つとも、型が誤っているリクエスト（たとえば数値や `null` の `input_b64`、配列でない `cases`）は
  不正で、ラッパーは 2 で終了します。文書化された拒否以外のエラーは `error` です。Rust と WASM では、文書化された数値の拒否は、
  バックトラックする正規表現を使わず 1 回の線形な走査で判別します。UTF-8 で 1 MiB を超えるメッセージは拒否ではなく
  `error` になります（この上限はその判別にだけ適用され、構文解析のエラーには適用されません）。`DCP_EXTERNAL_REQUIRE_NATIVE=1`
  がないと、`node --test` はビルドされていないものをスキップし、その旨を表示します。指定すると、ツールや成果物が
  ないことは失敗になります。CI はチェックアウトから 3 つのラッパーをビルドし、それぞれで 38 ケースを実行するため、
  そこでは 5 つのラッパーすべてが必須です。
- **制限：** WASM のラッパーは、Node 上で wasm-bindgen の生のエクスポートを呼びます。`@dcp-ai/wasm`
  パッケージの JavaScript API（`DcpClient` など）やブラウザーは対象外です。SDK に安定したエラーコードがないため、拒否の判別は
  メッセージの文字列に依存します。また、WASM では、ルートが単一キーの `{"error": …}` の入力は、
  エクスポートが `{"error": string}` の封筒を返した場合にだけ曖昧なエラーになります（`{"error":5}` は `ok` の
  ままです）。
  合格が示すのは、これら 38 ケースが各ラッパーで合格することだけです。

<a id="evidence-catalog-merkle-and-signature-verification"></a>

### 証拠カタログ：マークルと署名の検証

`--catalog evidence` は任意で選ぶカタログ [`external-evidence-catalog.json`](../../../../tools/conformance/external-evidence-catalog.json)
（契約 `dcp-ai-conformance-external/2`、241 ケース）を選択し、同じ種類の argv に対して実行します。
既定のカタログ、契約 `/1` とその 38 ケースは変わりません。カタログの `contract` が読み込みと判定の方法を決めます。
5 つのラッパーはどちらの契約も受け付け、リクエストの契約で応答します。
使うのはコミット済みの公開フィクスチャだけで、鍵を生成することも何かに署名することもありません。

```bash
node tools/conformance-external.js --catalog evidence --list
node tools/conformance-external.js --catalog evidence --report /tmp/evidence-ts.json -- node tools/conformance/wrappers/ts-sdk.mjs --sdk sdks/typescript/dist/index.js
node tools/conformance-external.js --catalog evidence -- /path/to/python -I tools/conformance/wrappers/python_sdk.py
node tools/conformance-external.js --catalog evidence -- tools/conformance/wrappers/.build/go-wrapper
node tools/conformance-external.js --catalog evidence -- tools/conformance/wrappers/.build/rust-target/debug/dcp-ai-conformance-wrapper
node tools/conformance-external.js --catalog evidence -- node tools/conformance/wrappers/wasm.mjs
DCP_EXTERNAL_PYTHON=/path/to/python DCP_EXTERNAL_REQUIRE_PYTHON=1 DCP_EXTERNAL_REQUIRE_NATIVE=1 node --test tools/conformance/external-evidence.test.mjs
```

| スイート | ケース数 | ベクター |
|----------|----------|----------|
| `external.merkle.dual_root` | 6 | `tests/conformance/v2/merkle_vectors.json`：葉が 1、2、3、5 枚の場合と並べ替えた葉（`spec/VERIFICATION.md` V2-11）。Python の標準ライブラリでオフラインに生成 |
| `external.signature.composite` | 24 | `interop_vectors.json`：複合署名と古典署名のみの署名、コミット済みの攻撃、各陽性ケースの決定的な改変 |
| `external.v2.bundle_vectors` | 131 | `bundle_vectors.json`：署名済みバンドル、コミット済みの 38 の変異、受理される 9 のバンドルと別途構築された拒否される 79 のバンドル、4 つのモードでの古典署名のみのルーチンバンドル |
| `external.v2.secondary_sha3` | 80 | `secondary_sha3_vectors.json`：受理されるケースと拒否されるケース、拒否される各ケースのコミット済みの対照 |

- **操作：** `dual_merkle_root` は `leaves`（小文字の 64 桁の 16 進文字列からなる `{sha256, sha3_256}` の空でない配列）を受け取り、
  `sha256` と `sha3_256`（小文字の 64 桁の 16 進数）を持つ `ok` で応答します。
  `composite_verify` は `context`、`payload_b64`（ペイロードの正規バイト列）、コミットされたままの `composite_sig`、
  `classical_public_key_b64`、`pq_public_key_b64`（または `null`）を受け取り、`valid` と `classical_valid`（ブール値）、
  `pq_valid`（ブール値または `null`）を持つ `ok` で応答します。
  `verify_signed_bundle_v2` は `bundle_b64`（署名済みバンドルの JSON）、`policy`（検証器のポリシーのオブジェクト）、
  `verification_time`（`Z` またはオフセット付きの RFC 3339）を受け取り、`verified`（ブール値）と `errors`（文字列の配列）を持つ `ok` で応答します。
  形の正しくないリクエスト（空または大文字の葉、文字列でない葉、タイムゾーンのない時刻、未知のフィールド）では、ラッパーは 2 で終了します。
- **判定：** 複合署名のケースはフィクスチャがコミットしたフィールドだけを比較します。バンドルの判定は一致しなければならず、
  拒否はコミット済みの `error_contains` を含まなければなりません（大文字と小文字を区別せず、連結したエラーに対して）。
  エラーを伴う `verified: true` は `contradictory_result` のエラーです。
  コミット済みの入力はすべて解析できるため、`code` が `parse` の `rejected` は不合格です。`error` と `unsupported` は決して合格になりません。
- **対照：** 陰性ケースは対照が合格した場合にだけ数えられ、そうでなければエラーの `control_failed` になります。
  基準の署名済みバンドルはその 38 の変異の対照です。同じペイロードの陽性ケースはその改変とコミット済みの攻撃の対照です。
  古典署名のみのバンドルの有効なモードは、拒否するモードの対照です。拒否される二次ケースにはそれぞれコミット済みの対照があります。
  79 の `must_reject_bundles` にはケースごとの対照がありません。基準と受理される 9 のバンドルが合格した場合にだけ数えられ
  （スイート単位の対照で、より弱い保証）、コミット済みの `error_contains` で判定されます。
  レポートには各ケースの `source`、`input_sha256`、`controls` が記録されます。
- **PQ 署名の欠落：** PQ 部分のない `pq_over_classical` 署名に対して、Rust の `composite_verify` はエラーを返し、
  WASM のエクスポートはインバンドのエラー `Signature error: pq_over_classical binding requires PQ signature` を返します。
  この 2 つのラッパーは、その正確なエラーで、かつ入力がそのバインディングと `pq: null` を持つ場合にだけ、
  `code` が `missing_pq_signature` の `rejected` として報告します。
  ランナーがそれを受け入れるのは、フィクスチャが `valid: false` だけをコミットしている場所（`stripping_pq_removal`）で、
  その陽性の対照が合格した場合だけです。有効な署名や他の陰性ケースに対する同じコードは不合格です。
  TypeScript、Python、Go はそのケースにブール値で応答します。
- **ペイロードの改変**は正規ペイロードの最初の文字列値の最後の文字を変えるため、ペイロードは有効な正規 JSON のままであり
  （WASM のエクスポートはペイロードの JSON を受け取ります）、パーサーのエラーが暗号上の失敗として数えられることはありません。
- **時刻：** バンドルの各ケースは `verification_time` を送ります。基準のバンドルと検証に成功すべき各バンドルの有効期間内にある
  2026-10-22T00:00:00Z（一部の陰性ケースは、その時点で意図的に期限切れまたはまだ有効でない状態です）、または二次ベクターのコミット済みの時刻です。TypeScript は `{ now }`、Python は `now_ms`、
  Go は `VerifySignedBundleV2At`、Rust は `verify_signed_bundle_v2_at` を使います。
  WASM のエクスポートは `Date.now` を読むため、WASM ラッパーは同期呼び出しの間だけ `Date.now` をその時刻に置き換え、
  呼び出しが例外を投げた場合も含めて `finally` で元に戻します。その旨は `runtime` に記載されます。
  セルフテストは、各ラッパーが基準のバンドルを 2020-01-01 では拒否し、2026-10-22 では受理し、2100-01-01 では拒否すること、
  そして例外の後に元に戻ることを示します。
- **WASM 経由のマークル：** ラッパーはこのチェックアウトからビルドした `wasm_dual_merkle_root` を使い、これは Rust のコアに委譲します。
  `@dcp-ai/wasm` 2.1.1 以前で公開されたヘルパーは、複数の葉のケースで不合格になります（CHANGELOG を参照）。
- **セルフテスト：** `external-evidence.test.mjs` は 241 ケースを 5 つのラッパーで実行し、時刻の証明、不正な形のリクエスト、
  そして TypeScript ラッパーの実際の応答から作った偽の実装を実行します。偽の実装は、すべてを検証する、すべてを拒否する、
  矛盾した結果、誤ったエラーテキスト、順序を無視するか 16 進テキストをハッシュするマークル縮約、不合格になる基準、
  正しい場所と誤った場所での `missing_pq_signature`、陰性ケースでのエラーや `unsupported` を試します。
  改ざんしたフィクスチャとカタログはインフラのエラー（終了コード 3）です。このカタログの既定のタイムアウトは 300 000 ms です（`--timeout-ms`）。
  2 つの `REQUIRE` 変数を設定すると、ラッパーがない場合はスキップではなく不合格になります。CI では 5 つすべてを実行します。
- **制限：** 合格が示すのは、実行した argv がこれら 241 ケースに合格することだけです。ポリシーは、各ケースのコミット済みの
  `verifier_policy_overrides` を適用した `default_verifier_policy` と、古典署名のみのバンドルの 4 つのモードであり、それ以外のポリシーは試しません。`composite_verify` はバインディングと鍵を与えられたプリミティブであり、
  バンドルの判定は受け入れ、プリンシパルへの信頼、行為の認可のいずれでもありません。
  `stripping_pq_with_downgrade` は `classical_valid` と `pq_valid` で判定され、それを拒否するのは `hybrid_required` のポリシーの役割です。
  二次フィールドは存在する場合にだけ確認されるため、合格は完全な二次チェーンを示しません。WASM 経由では、時刻は置き換えたホストの時計です。
  `error_contains` の文字列は SDK の診断用の文言であり、規範ではありません。`spec/VERIFICATION.md` はエラーコードを定めていません。
  これら 146 ケースの合格はその文言との一致を示すだけです。同じ判定で別のメッセージを返す検証器はそれらに失敗しますが、その失敗だけでは判定の誤りを示しません。[判定による評価](#verdict-assessment)では、これらのケースを判定だけで評価します。

<a id="verdict-assessment"></a>

#### 判定による評価

`spec/VERIFICATION.md` が定めるのは bundle が検証に通らない条件であり、エラーの文言ではありません。`--assessment verdict` は、独自のメッセージを返す実装のために、このカタログを判定だけで評価します。
オプションを指定しない場合、または `--assessment legacy` の場合、判定、レポート、終了コードは上記のとおりで変わりません。
このオプションは `/2` のカタログ（コミット済みのもの、または独自のファイル）にだけ適用されます。`/1` や `/3` のカタログでは `legacy` も含めて使用法エラーになります。それらのコードは契約の一部であるか、規範だからです。

```bash
node tools/conformance-external.js --catalog evidence --assessment verdict --list
node tools/conformance-external.js --catalog evidence --assessment verdict --report /tmp/evidence-verdict.json -- ./my-implementation
DCP_EXTERNAL_PYTHON=/path/to/python DCP_EXTERNAL_REQUIRE_PYTHON=1 DCP_EXTERNAL_REQUIRE_NATIVE=1 node --test tools/conformance/external-evidence-assessment.test.mjs
```

- **変わる点：** `error_contains` を持つ 146 件の拒否（38 件の変更、別途構築された 79 件の bundle、29 件の二次ケース）だけです。
  結果が `ok` で、形式が正しく、矛盾がなく、`verified: false` を返し、同じ実行で制御が合格していれば、それぞれ合格します。メッセージは判定しません。
  それ以外の規則は制御も含めて従来どおりです。同じ回答に対して、`legacy` で合格するケースは `verdict` でも合格し、146 件以外のケースはすべて同じ状態と種別になります。
- **アンカーと前提：** これらの各ケースは `spec/VERIFICATION.md` の手順（`anchor`）を示します。bundle ベクトルでは `spec_step`（V2-1 から V2-14）、二次グループでは V2-11 とエラッタのフィールド（`audit_merkle_root_secondary`、`prev_hash_secondary`、`intent_hash_secondary`）です。
  すべての制御は単純な肯定ケースでなければなりません。検証に通る（または有効である）ことが期待され、`error_contains` も独自の制御も持ちません。そのため、評価方法によって制御の結果が変わることはありません。
  どちらも実行前に確認され、満たさない計画は `verdict` では終了コード 3 になります（`legacy` では、たとえば独自の `--root` で合格することがあります）。上記の性質は、両方の評価で有効な計画にだけ成り立ちます。
- **診断：** 合格した拒否の文言は、`matched`（コミット済みの `error_contains` を含む）、`differs`、`no_message`（`errors: []`）として報告されます。
  それ以外の結果は `not_evaluated` で、その `reason` は `run_error`、`missing`、`duplicate`、`malformed_result`、`implementation`、`unsupported`、`rejected`、`contradictory_result`、`wrong_verdict`、`control_failed` のいずれかです。
  誤った判定は、メッセージがどうであれ合格せず、文言が状態、合計、終了コードを変えることはありません。
- **レポート：** `kit.contract` は `/2` のままです。レポートには `assessment`（その `schema` は wire の契約とは別の `dcp-ai-conformance-assessment/1`）と `diagnostic_totals` が加わります。
  `claim` と `limits` は、この評価が実際に確認する内容を示し、カタログの文章に関係なくランナーがスイートごとに定めます。その文章は `catalog_claim` と `catalog_limits` にそのまま残り、確認済みの結果ではありません。
  146 件の各ケースは `expect: {"verified": false}`、`anchor`、`diagnostic` を示します。legacy のレポートには新しいフィールド（`assessment`、`diagnostic_totals`、`catalog_claim`、`catalog_limits`、`anchor`、`diagnostic`）はなく、`claim`、`limits`、`expect`（`error_contains` を含む）は従来どおりです。
  `--assessment` を付けた `--list` はモードを示し、付けない場合の出力は変わりません。
- **終了コードと鮮度：** [契約](#contract)のとおりです。実行が合格したことを意味するのは状態 `pass`（終了コード 0）だけです。状態が `fail` や `error` の実行（たとえば余分な結果がある場合）の診断は部分的な情報であり、適合を意味しません。
  `--assessment` のエラー（不明、重複、欠落した値、`/1` や `/3` のカタログ、欠けたアンカー）はすべてプレースホルダーの後に起こるため、古いレポートを新しい `run.id` を持つ新しいエラーで置き換えます。レポートが残らないのは、[コマンド](#external-implementations)で説明した例外だけです。
- **セルフテスト：** `external-evidence-assessment.test.mjs` は、TypeScript ラッパーの実際の回答から作った fake を両方の評価で実行します。期待どおりのメッセージ、中立的なメッセージ、メッセージなしの正しい判定、期待どおりのメッセージを伴う誤った判定、すべてを検証またはすべてを拒否する回答、エラー、`unsupported`、欠落、重複、形式不正、拒否、余分な結果、制御の失敗、実行の失敗とタイムアウト、各スイートの単独選択、全モードでの上記の性質（順序を無視する Merkle、奇数ノードの旧来の昇格、正しい場所とそれ以外での `missing_pq_signature` を含む）、アンカーと前提、古い合格の上に書かれる新しいレポート、レポートの形と `--list` を扱います。
  さらに、5 つのラッパーで 241 ケースを `verdict` で実行します。CI はすべてのラッパーを必須にして実行します。
- **制限：** `verdict` での合格が示すのは、実行した argv と同じポリシーでのこれらのケースの判定が正しいことです。メッセージが正確か有用かは評価しません。
  `/2` の wire の契約、カタログ、フィクスチャ、ラッパーは変わりません。

<a id="admission-catalog-strict-v1-admission"></a>

### アドミッションのカタログ：strict-v1 のアドミッション

`--catalog admission` は 2 つ目のオプトインのカタログ [`external-admission-catalog.json`](../../../../tools/conformance/external-admission-catalog.json)
（契約 `dcp-ai-conformance-external/3`、140 ケース）を選び、同じ種類の argv に対して実行します。これは
[`spec/profiles/admission`](../../../../spec/profiles/admission/README.md) のアドミッションの判断を、コミット済みの
[`admission_vectors.json`](../../../../tests/interop/v2/admission_vectors.json) で判定します。カタログはこのファイルを
`bundle_vectors.json` とともに SHA-256 で固定します。契約 `/1` と `/2` とそのカタログは変わりません。TypeScript、
Python、Go、Rust のラッパーは SDK を通じて `/3` に答えます。WASM のビルドにはアドミッションの API がないため、その
ラッパーは `/3` を拒否し（exit 2）、何もそれをエミュレートしません。

```bash
node tools/conformance-external.js --catalog admission --list
node tools/conformance-external.js --catalog admission --report /tmp/admission-ts.json -- node tools/conformance/wrappers/ts-sdk.mjs --sdk sdks/typescript/dist/index.js
node tools/conformance-external.js --catalog admission -- /path/to/python -I tools/conformance/wrappers/python_sdk.py
node tools/conformance-external.js --catalog admission -- tools/conformance/wrappers/.build/go-wrapper
node tools/conformance-external.js --catalog admission -- tools/conformance/wrappers/.build/rust-target/debug/dcp-ai-conformance-wrapper
node --test tools/conformance/external-admission.test.mjs
DCP_EXTERNAL_PYTHON=/path/to/python DCP_EXTERNAL_REQUIRE_PYTHON=1 DCP_EXTERNAL_REQUIRE_NATIVE=1 node --test tools/conformance/external-admission-wrappers.test.mjs
```

| スイート | ケース | 出典 |
|-------|-------|--------|
| `external.admission.outcomes` | 65 | `admission_vectors.json` の結果のベクトル |
| `external.admission.config` | 71 | その 49 の拒否される設定、最大値つきの 2 つの受け入れられるプロファイル、ベクトルが使う 14 の信頼セットと 6 つのプロファイルの読み込み |
| `external.admission.composed` | 4 | ベクトルの入力からカタログに書いたもの：信頼セットのないプロファイル、呼び出し元の検証器のポリシーを伴うプロファイル、そしてアルファベット順ではコードの位置がずれる 2 つの組み合わせ |

- **操作：** `admit_signed_bundle_v2` は `bundle_b64`、`now`、`profile`、`trust_set`、`verifier_policy`、
  `revocation` を常に 6 つすべて受け取り、`load_admission_config` は `kind`（`trust_set` または `profile`）と
  `config` を受け取ります。
  - `now` は正確に `YYYY-MM-DDTHH:mm:ss.sssZ` で、0001 年から 9999 年の実在する日付です。これはこのトランスポートの
    範囲にすぎず、プロトコルのタイムスタンプは何も変えません。
  - `revocation` は、プロファイルがなければ `null`、`{"state": "unavailable"}`（スナップショットなし、R1）、または
    `{"state": "snapshot", "snapshot": {…}}`（完全かどうかにかかわらず SDK が判定するオブジェクト）です。プロファイルが
    あるときに限って与えられます。
  - `profile`、`trust_set`、`verifier_policy` はオブジェクトか `null` です。信頼セットとプロファイルは運用者の設定で
    あり、リクエストの中で帯域外から与えられ、バンドルから取られることは決してありません。プロファイルがなければ、
    リクエストは完全な検証器のポリシーを持ちます：`default_verifier_policy` の 14 のフィールドに、
    `require_session_expiry: false`、`require_audience_binding: false`、`max_session_duration_seconds: 0` を加えた
    もの。プロファイルがあるときはポリシーを持ちません。ただし、その拒否を確かめるケースは例外です。
  - それ以外の形のリクエストでは、ラッパーは SDK を呼ぶ前に 2 で終了します。
- **答え：** `ok` は、正確に `verified`、`principal_trust`、`profile`、`profile_compliance`、`admitted`、
  `action_authorized`、`recorded_decision`、`trust_set_version`、`codes`（`errors` のコードを出た順に、繰り返しも
  含めて）、`verification_verified` を持ちます。設定では `accepted: true`、プロファイルではさらに 2 つの最大値を
  持ちます。`rejected` は、SDK が型付きの設定エラーを投げたときに限って `CONFIG_*` のコードを持ちます。`error` と
  `unsupported` は決して合格になりません。
- **判定**（この順）：
  - フィールドの型（`malformed_result`）。
  - spec/profiles/admission から導かれる規則（`contradictory_result`）：`action_authorized` は `false`。`admitted` は
    コードが 1 つも加えられなかったときに限って成り立つ。プリンシパルへの信頼は、信頼セットがあり、バンドルが検証を
    通ったときだけ評価される。
  - 正確なフィールドとコードの集合。
  - 生の並びの順序。§5.1 と §5.2 の段階に従い、P1、T1、R1、R2 の停止を含む（`order`）。
  - 繰り返し（`cardinality`）：複数の構成要素や対象に当てはまる P4、T2、R4、R5 だけが、そのコードを繰り返して
    かまいません。

  拒否される設定は、その `allowed_codes` のどれかで合格します。それは自身のコードか、2 つの問題を持つ 3 つの信頼
  セットでは当てはまる 2 つのコードのどちらかです（§2.2）。プロファイルは実効の最大値で判定されます（§4.1）。
- **対照：** 否定のケースは、その対照が推移的に合格した場合にだけ数えられます。そうでなければ `control_failed`
  というエラーです。
  - 結果の否定のケースのうち 29 は、同じバンドルの肯定のケースを対照とします。
  - 19 は同じバンドルに肯定のケースがなく、スイートの単位で対照されます。これはより弱い保証です。
  - 設定の拒否は、有効な信頼セットかプロファイルの読み込みを対照とします。
  - 組み合わせたケースは、組み合わせたベクトルを対照とします。

  `--suite` は、選んだケースが必要とする対照も実行し、それを報告します（`controls_included`、
  `included_for_controls`）。
- **プロセスとエラー：** `/1` と `/2` と同じです（run id、nonce、ランダムなケース id、プロセスグループ、制限）。
  このカタログの既定のタイムアウトは 300 000 ms です。起動の失敗、0 以外の exit、シグナル、タイムアウト、古い id、
  あるいは不正な形の、欠けた、重複した、余分な結果はエラーであり、拒否や「アドミッションされない」になることは
  決してありません。カタログとそのフィクスチャーは読み込むときに検証されます（固定したハッシュ、正確なキーと型、
  本文と整合する各期待値）。欠陥は exit 3 です。
- **ラッパー：** ケースごとに 1 回、SDK の組み合わせた関数または読み込み関数を、システムの時計ではなくリクエストの
  `now` で呼びます：`admitSignedBundleV2`、`createPrincipalTrustStore`、`resolveStrictV1Profile`（TypeScript）、
  `admit_signed_bundle_v2`、`create_principal_trust_store`、`resolve_strict_v1_profile`（Python）、
  `AdmitSignedBundleV2`、`NewPrincipalTrustStore`、`ResolveStrictV1Profile`（Go）、`admit_signed_bundle_v2`、
  `PrincipalTrustStore::from_json`、`resolve_strict_v1_profile`（Rust）。プロバイダーは Ed25519 と ML-DSA-65 です。
  拒否になるのは型付きのエラーだけです：`AdmissionConfigError`（TypeScript、Python、Rust）、または `errors.As` を
  通した `*AdmissionConfigError`（Go）。`DCP_CONFORMANCE_WRAPPER_FAULT` はセルフテスト専用で、答えをエラーに変える
  ことしかできません。
- **セルフテスト：**
  - `external-admission.test.mjs` は、カタログ自身の期待値から作った合成の答えを、SDK なしで判定します：誤った判断、
    順序、カーディナリティ、設定のコード、インフラの失敗、改ざんしたカタログとフィクスチャー。
  - `external-admission-wrappers.test.mjs` は 4 つのラッパーを SDK を通じて実行します：それぞれ 140 ケース、
    リクエストの時計（1 つのケースを 3 つの時刻で）、不正な形のリクエスト、注入した失敗、読み込めない実装、WASM の
    拒否、そしてバンドルから信頼を取る SDK（TypeScript を通じて）。

  CI は 4 つのラッパーを必須として両方を実行します。
- **制限：**
  - **合格が示すこと。** 実行した argv がこれら 140 ケースに合格すること、それだけです。アドミッションは決して認可では
    ありません：`action_authorized` は常に `false` です。
  - **射影。** 答えはアドミッションの結果の射影です。内包する検証（そのエラー、警告、詳細、`signer_keys`、モード、
    階層）は判定しません。`verification_verified` は実装自身が報告するものです。
  - **型付きのエラー。** 拒否はそのコードで判定されます。それが SDK の型付きのエラーから来たかどうかを見るのは
    ラッパーであり、ランナーではありません。
  - **より弱い保証。** スイートの単位の 19 の対照と、ベクトルではなくカタログに書いた 4 つの組み合わせの期待値です。
  - **このカタログの外。** アダプター、信頼と失効の情報源、TLS、テナント、キャッシュ、一度限りの使用。コーパスは
    コミット済みのベクトルとこの 4 つの組み合わせであり、あらゆる入力ではありません。
