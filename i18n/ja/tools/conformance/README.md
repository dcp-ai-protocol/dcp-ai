<sub>[English](../../../../tools/conformance/README.md) · [中文](../../../zh-CN/tools/conformance/README.md) · [Español](../../../es/tools/conformance/README.md) · **日本語** · [Português](../../../pt-BR/tools/conformance/README.md)</sub>

<a id="dcp-ai-conformance-kit"></a>

# DCP-AI 適合性キット

> [英語版](../../../../tools/conformance/README.md)の参考訳です（08/11/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

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
  パッケージの JavaScript API（`DcpWasm`）やブラウザーは対象外で、それらは[ブラウザーラッパー](#browser-wrapper-dcpwasm-in-chrome)が扱います。SDK に安定したエラーコードがないため、拒否の判別は
  メッセージの文字列に依存します。また、WASM では、ルートが単一キーの `{"error": …}` の入力は、
  エクスポートが `{"error": string}` の封筒を返した場合にだけ曖昧なエラーになります（`{"error":5}` は `ok` の
  ままです）。
  合格が示すのは、これら 38 ケースが各ラッパーで合格することだけです。

<a id="browser-wrapper-dcpwasm-in-chrome"></a>

### ブラウザーラッパー：Chrome での DcpWasm

`wrappers/wasm-browser.mjs` は、契約 `/1`、契約 `/2` とそれを使うカタログ、契約 `/5` に応答します。生のエクスポート
ではなく、Chrome 上で `@dcp-ai/wasm` の公開 JavaScript API（`initDcp` と `DcpWasm`）を通ります。パッケージには
アドミッションや委任状チェーンの API がないため、`/3` と `/4` は拒否します（exit 2）。何もインストールしません。
必要なのは、パッケージのビルド（`wasm-pack --target web` と `tsc` による `dist/` と `pkg/`）と、すでにインストール
されている Chrome です。

```bash
node tools/conformance-external.js -- node tools/conformance/wrappers/wasm-browser.mjs --root sdks/wasm --browser-report /tmp/browser-1.json
node tools/conformance-external.js --catalog evidence --assessment verdict -- node tools/conformance/wrappers/wasm-browser.mjs --root sdks/wasm
node tools/conformance/wrappers/browser/direct-sections.mjs --report /tmp/direct.json --root sdks/wasm
DCP_BROWSER_ROOT=sdks/wasm DCP_EXTERNAL_REQUIRE_BROWSER=1 node --test tools/conformance/external-browser.test.mjs
```

- **実行の流れ：**
  - ラッパーは、WASM ラッパーと同じようにリクエストを検証します。
  - ページとアーティファクトを、メモリから 127.0.0.1 で、実行ごとのランダムなパスの下に配信します。許可リストは
    厳密で、CORS はなく、他のオリジンから何も読み込まないコンテンツセキュリティポリシーを使います。
  - 一時プロファイルで Chrome をヘッドレスで起動し、最後に閉じます。
  - ページは `initDcp()` を呼び、各ケースに対応する `DcpWasm` のメソッドで応答します：`canonicalize`、`dualHash`、
    `sha3_256`、`dualMerkleRoot`、`compositeVerify`、`verifyBundle`。正準化のケース、バンドル、複合ペイロードは、
    先にそのバイトを `JSON.parse` に通します。ダイジェストはケースのテキストを、Merkle ケースは 16 進の葉を使います。
    結果を一度だけ送信し、ランナーは他のラッパーと同じように判定します。
- **実行を失敗させるもの**（exit 1、応答なし）：
  - ページが初期化の失敗を報告するか、`done` と同時にエラーを報告する
  - エクスポートが、ソースから導出した `browser/expected-api.json` と異なる
  - ページが取得したアーティファクトが、配信したバイトと異なる
  - 時計が復元されなかった
  - 結果がこの実行のものでないか、2 回届く
  - 実行のパスの下のリクエストが許可リストの外にあるか、別の Host や Origin を持つ
  - Chrome が先に終了するか、期限が切れる
  - 要求された `--browser-report` を書き込めない

  `--manifest <SHA256SUMS>` は、配信するアーティファクトをハッシュのリストにも固定します。
- **時刻：** `verifyBundle` は `Date.now` を読みます。ページは、その 1 回の呼び出しの間だけ、それをケースの
  `verification_time` に設定し、呼び出しが例外を投げた場合も含めて、その後に復元します。ページがパースできない
  バンドルは、呼び出しをせずに `rejected`/`parse` と応答され、ページはそのケースを示します。
- **直接セクション：** `wrappers/browser/direct-sections.mjs` は内部リクエスト（`dcp-ai-browser-direct/1`、キットの
  契約ではない）を送ります。ページの生の観測結果を、既存の fixture と照らして判定します：
  - `domainSeparatedMessage`（20）
  - `computeSecurityTier`（79）
  - P-ED-1 の 2 つの複合原像（`classical_only` のバインディングで `compositeVerify` を通す）
  - ペイロード・コンテキスト・署名の否定例を伴う 2 つのハイブリッドの往復（`generateHybridKeypair`、
    `compositeSign`、`compositeVerify`）。鍵はページ内で生成され、外に出ません。

  合計 103 ケースで、カタログの 590 とは別です。
- **手動実行：** `--manual --url-file <file>` では、ラッパーはブラウザーを起動しません。URL をファイルに書き、人が
  それを開くのを待ちます。そのために `--deadline-ms` とランナーの `--timeout-ms` を大きくしてください。ランナーは
  同じ方法で結果を判定します。
- **セルフテスト：** `external-browser.test.mjs` には 21 のテストがあります：
  - 肯定の対照
  - 3 つの時点での時計
  - パースできないバンドル
  - 直接セクションと、その判定器の否定例
  - 決して合格してはならない対照：`DCP_CONFORMANCE_WRAPPER_FAULT` で注入した障害（セルフテスト専用。障害を注入した
    応答はそのことを示します）と、サーバーが拒否すべきリクエスト

  `DCP_EXTERNAL_REQUIRE_BROWSER=1` では、Chrome やビルドがないことはスキップではなく失敗になります。CI は、ビルドした
  パッケージに対してカタログ、直接セクション、セルフテストを実行します。
- **このラッパーの対象外：** `sdks/rust/tests/wasm_ped1_vectors.rs` は、P-ED-1 コーパスをプロバイダーのレベルで、
  Node 上の wasm32 で実行し、パッケージの API は通りません。テストは 3 つです：プロバイダー 67 ケース、V1 オブジェクト
  4 件、実際の ML-DSA-65 鍵を使う複合 2 ケース。
- **限界：**
  - エンジンは Chrome の一つだけで、性能は測定しません。
  - 正準化のケース、バンドル、複合ペイロードはページで `JSON.parse` を通るため、合格は、それらの元のバイトや
    [アドミッション § 11](../../../../spec/profiles/admission/README.md#11-admission-from-bytes-opt-in)のイングレスについて何も
    示しません。
  - 合格が示すのは、このブラウザーでこの API を通したこれらのケースだけです。

<a id="evidence-catalog-merkle-and-signature-verification"></a>

### 証拠カタログ：マークルと署名の検証

`--catalog evidence` は任意で選ぶカタログ [`external-evidence-catalog.json`](../../../../tools/conformance/external-evidence-catalog.json)
（契約 `dcp-ai-conformance-external/2`、241 ケース）を選択し、同じ種類の argv に対して実行します。
既定のカタログ、契約 `/1` とその 38 ケースは変わりません。カタログの `contract` が読み込みと判定の方法を決めます。
5 つのラッパーはどちらの契約も受け付け、リクエストの契約で応答します。
使うのはコミット済みの公開フィクスチャだけで、鍵を生成することも何かに署名することもありません。

```bash
node tools/conformance-external.js --catalog evidence --list
node tools/conformance-external.js --catalog evidence --assessment verdict --report /tmp/evidence-ts.json -- node tools/conformance/wrappers/ts-sdk.mjs --sdk sdks/typescript/dist/index.js
node tools/conformance-external.js --catalog evidence --assessment verdict -- /path/to/python -I tools/conformance/wrappers/python_sdk.py
node tools/conformance-external.js --catalog evidence --assessment verdict -- tools/conformance/wrappers/.build/go-wrapper
node tools/conformance-external.js --catalog evidence --assessment verdict -- tools/conformance/wrappers/.build/rust-target/debug/dcp-ai-conformance-wrapper
node tools/conformance-external.js --catalog evidence --assessment verdict -- node tools/conformance/wrappers/wasm.mjs
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
- **V2-2 とコミット済みの文言：** `main` の SDK 検証器は最初に V2-2 を実行するため、`error_contains` を持つ 146 の拒否のうち
  16（署名エンコーディングの `must_reject` 7 行と `must_reject_bundles` 9 件）は、より深い検査の文言ではなくスキーマの診断を
  受け取るようになりました。そのため `legacy` では、各 SDK ラッパーは 225 ケースに合格し、その 16 件を判定は正しいまま文言の
  不一致として不合格にします。これは合格ではありません。`verdict` では 241 ケースすべてが合格し、130 件は文言が `matched`、
  その 16 件は `differs` です。CI は五つの SDK ラッパーを `verdict` で評価します。フィクスチャ、その `error_contains` の文字列、
  既定の評価は変わりません。
- **セルフテスト：** `external-evidence.test.mjs` は 241 ケースを 5 つのラッパーで実行し、時刻の証明、不正な形のリクエスト、
  そして TypeScript ラッパーの実際の応答から作った偽の実装を実行します。偽の実装は、すべてを検証する、すべてを拒否する、
  矛盾した結果、誤ったエラーテキスト、順序を無視するか 16 進テキストをハッシュするマークル縮約、不合格になる基準、
  正しい場所と誤った場所での `missing_pq_signature`、陰性ケースでのエラーや `unsupported` を試します。
  改ざんしたフィクスチャとカタログはインフラのエラー（終了コード 3）です。このカタログの既定のタイムアウトは 300 000 ms です（`--timeout-ms`）。
  2 つの `REQUIRE` 変数を設定すると、ラッパーがない場合はスキップではなく不合格になります。CI では 5 つすべてを実行します。ラッパーを使う各実行では両方の評価を確認します。`legacy` は上記の 16 行だけを
  文言の不一致として不合格にし、`verdict` は 241 ケースすべてに合格しなければなりません。
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

<a id="schema-boundary-diagnostic-opt-in"></a>

#### スキーマ境界の診断（明示的選択）

別の [`external-schema-catalog.json`](../../../../tools/conformance/external-schema-catalog.json) は、新しいスキーマ閉鎖コーパスの 15 ケースを契約 `/2` で実行します。V2-2 の規範上の期待値を維持し、閉じたオブジェクトの未知のメンバーは、ハッシュと署名が有効でも拒否を要求します。基準データと許可された拡張が肯定対照です。署名を更新していない拡張は、別の整合性に関する否定ケースです。この診断はデフォルトの証拠カタログの 241 ケースを変更しません。

```bash
node tools/conformance-external.js --catalog tools/conformance/external-schema-catalog.json --assessment verdict --list
node tools/conformance-external.js --catalog tools/conformance/external-schema-catalog.json --assessment verdict --report /tmp/schema-diagnostic.json -- ./my-implementation
node --test tools/conformance/external-schema.test.mjs
```

`main` の SDK 検証器は V2-2 を実行し、五つの SDK ラッパーはこれら 15 ケースに合格します。不合格になる実装は失敗のままで、許容された例外にはなりません。`schema-boundary.js` は、参照スキーマ検証、この有限コーパスに限定した整合性検査、コーパスの時刻でのスキーマと TypeScript SDK の組み合わせを別々に報告します。組み合わせの合格は SDK 単体が V2-2 を実施する証明ではなく、時刻を注入して参照 API を実行したものでもありません。整合性ヘルパーは汎用の規範検証器ではありません。自己テストは診断、その対照、期待値を確認します。その合格は SDK の適合性を認証しません。[カバレッジマップ](../../docs/conformance/SECURITY_COVERAGE.md)と[実装者ガイド](../../docs/conformance/IMPLEMENTER_GUIDE.md)を参照してください。

<a id="schema-validation-catalog-v2-2-opt-in"></a>

#### スキーマ検証カタログ（V2-2、明示的選択）

[`external-schema-validation-catalog.json`](../../../../tools/conformance/external-schema-validation-catalog.json) は、[`wiring_cases.json`](../../../../tests/interop/v2/schema_validation/wiring_cases.json) の署名済み 57 ケースに契約 `/2` を使います。各ケースは ID で固定され、肯定 13 件、否定 44 件です。各否定ケースは同じ実行で基準ケースが検証に成功した場合にだけ数えられ、各ケースは `spec/VERIFICATION.md` の手順（V2-1 から V2-14）を示します。テキストとして保存されたケースは、そのバイト列のまま送られます。判定だけを評価します。どのケースも `error_contains` を持たないため、`legacy` と `verdict` の評価は同じです。既定のカタログは変わりません。

```bash
node tools/conformance-external.js --catalog tools/conformance/external-schema-validation-catalog.json --assessment verdict --list
node tools/conformance-external.js --catalog tools/conformance/external-schema-validation-catalog.json --assessment verdict --report /tmp/schema-validation.json -- ./my-implementation
node --test tools/conformance/external-schema-validation.test.mjs
```

セルフテストは、キットが `tools/schema-ir/` のコーパス読み取りと同じ計画を作ること、カタログとコーパスの整合性（ID の欠落・余剰・重複、両方の形式で与えられたケース、肯定でない基準）、ランナーの対照を確認します。すべてを受理すると 44 の否定ケースだけが不合格になり、すべてを拒否するとどれも数えられず、一つの制約を無視する検証器はそのケースだけが不合格になり、欠落・重複・不正な形の結果はエラーになります。CI はセルフテストとカタログを五つの SDK ラッパーで実行し、すべてを必須とします。合格が示すのは、これら 57 ケースをそのポリシーと検証時刻で通ることだけで、V2 の完全な適合ではありません。

<a id="verifier-policy-catalog-opt-in"></a>

#### 検証器ポリシーカタログ（明示的選択）

[`external-policy-catalog.json`](../../../../tools/conformance/external-policy-catalog.json) は、バージョン `2026-11-05.verifier-policy-2.0` で、`/2` 契約により固定時刻の 108 ケースを 2 つのスイートで扱います。既定の証拠カタログは変更しません。各否定ケースには肯定対照の成功が必要で、診断文言は評価しません。

- `external.v2.verifier_policy`：`verifier_policy_vectors.json` の 74 ケース。肯定対照 10、4 要求モードにわたる存在する無効な PQ 署名 24、アルゴリズムリストとアドバイザリ 14、ティアケース 26 です。
- `external.v2.verifier_policy_clarification`：`verifier_policy_clarification_vectors.json` の 34 ケース。[VERIFICATION.md](../../../../spec/VERIFICATION.md) の手順 V2-10 の日付付きの明確化（05/11/2026）のためのものです。
  - Q1：`pq_only` では、古典のリストとアドバイザリによる除外はハイブリッドの bundle を拒否しません。
  - Q2：`pq_only` では、古典の構成要素が失敗し、PQ の構成要素がその古典のバイトに対して検証される bundle、パスポート、チェックポイントの署名を受け入れます。正準でない古典の `sig_b64` や未知の古典の kid は引き続き拒否されます。
  - Q3：`classical_only` と `hybrid_preferred` では、PQ のリストは古典のみの bundle を拒否しません。同じポリシーでのハイブリッドの bundle は拒否されます。
  - 他のモードでは、Q1 の除外と Q2 の署名は拒否されます。

バージョン 1.1（74 ケース）は [`external-policy-catalog-1.1.json`](../../../../tools/conformance/external-policy-catalog-1.1.json) としてバイト単位で保管され、そのパスで引き続き実行できます。その報告はそのバージョンの証拠であり続けます。

```bash
node tools/conformance-external.js --catalog tools/conformance/external-policy-catalog.json --assessment verdict --list
node tools/conformance-external.js --catalog tools/conformance/external-policy-catalog.json --assessment verdict --report /tmp/policy-conformance.json -- ./my-implementation
node tools/conformance-external.js --catalog tools/conformance/external-policy-catalog-1.1.json --assessment verdict --report /tmp/policy-1.1.json -- ./my-implementation
node --test tools/conformance/external-policy.test.mjs
```

routine のハイブリッド肯定例は実効 `classical_only` に到達しますが、standard の肯定例はその要求を `hybrid_preferred` に引き上げます。記録されたティア・モードの導出は説明であり、結果フィールドの評価ではありません。[実効ポリシーのカタログ](#effective-policy-catalog-contract-5-opt-in)は、契約 `/5` でそれらを評価します。ティアケースは別々に署名された既存 bundle を使い、単一変更の対ではありません。明確化のケースは 2 つの routine の基礎を使うため、要求したモードがそのまま実効モードになります。その Q2 の変種は、コミット済みの TEST-ONLY 鍵で PQ の構成要素だけを署名し直します。自己テストはカタログ 1.1 を元の不変条件で実行し、Q1、Q2、Q3 を誤って読む偽の実装も実行します。`pq_only` での古典のリスト、`pq_only` で拒否される無効な古典の構成要素、PQ のない bundle への PQ のリスト、モードの無視です。それぞれがちょうど自分のケースで失敗します。CI はコーパスとランナーの自己テスト、および 5 SDK ラッパーを通じたカタログ検査を実行します。合格が示すのはこれらのケースだけです。

<a id="structural-catalog-opt-in"></a>

#### 構造カタログ（オプトイン）

[`external-structural-catalog.json`](../../../../tools/conformance/external-structural-catalog.json)は、`/2` と実効モード `hybrid_preferred` で時刻を固定した16ケースを実行します。陽性対照2件と構造上の陰性ケース14件です。各陰性ケースには基本対照が必要であり、時刻順序が逆のセッションには対応する陽性対照も必要です。既定のカタログは変わりません。

```bash
node tools/conformance-external.js --catalog tools/conformance/external-structural-catalog.json --assessment verdict --list
node tools/conformance-external.js --catalog tools/conformance/external-structural-catalog.json --assessment verdict --report /tmp/structural-conformance.json -- ./my-implementation
node --test tools/conformance/external-structural.test.mjs
```

評価対象は判定結果のみです。コーパスには署名の出所と分離の限界を記録しています。特に、小数を含むペイロードの古い証拠と、逆向きの範囲に有効なルートが存在しない点を明示しています。CIはコーパスとランナーの自己テスト、および5つのSDKラッパーを実行します。合格はこれらのケースとポリシーに限られ、V2の完全な適合性を示しません。

<a id="effective-policy-catalog-contract-5-opt-in"></a>

### 実効ポリシーのカタログ（契約 /5、オプトイン）

[`external-effective-policy-catalog.json`](../../../../tools/conformance/external-effective-policy-catalog.json)（契約 `dcp-ai-conformance-external/5`、バージョン `2026-11-07.effective-policy-1.0`）は、署名済み bundle の検証を 130 件実行します。リクエストは `/2` の `verify_signed_bundle_v2` と同じで、これが唯一の操作です。`ok` の結果には `effective` が加わります。これは、実装の検証器が同じ検証の中で解決した検証モードとセキュリティティアで、それぞれ `{"exposed": false}` または `{"exposed": true, "value": <the JSON value as returned>}` です。`/1` から `/4` の契約、そのカタログとレポート、それらへのラッパーの応答は変わりません。

`ok` の結果のキーはちょうど `id`、`status`、`verified`、`errors`、`effective` で、`effective` のキーはちょうど `verification_mode` と `resolved_tier` です。以下は TypeScript ラッパーの 2 つの結果で、カバレッジの肯定例と、何も解決される前に V2-2 で拒否された観察ケースです。

```json
{"id":"c1","status":"ok","verified":true,"errors":[],"effective":{"verification_mode":{"exposed":true,"value":"hybrid_required"},"resolved_tier":{"exposed":true,"value":"elevated"}}}
{"id":"c2","status":"ok","verified":false,"errors":["schema: /bundle/agent_passport/payload/risk_tier enum"],"effective":{"verification_mode":{"exposed":false},"resolved_tier":{"exposed":false}}}
```

```bash
node tools/conformance-external.js --catalog tools/conformance/external-effective-policy-catalog.json --list
node tools/conformance-external.js --catalog tools/conformance/external-effective-policy-catalog.json --report /tmp/effective.json -- ./my-implementation
DCP_EXTERNAL_PYTHON=/path/to/python DCP_EXTERNAL_REQUIRE_PYTHON=1 DCP_EXTERNAL_REQUIRE_NATIVE=1 node --test tools/conformance/external-effective-policy.test.mjs
```

| スイート | ケース | 出典 |
|-------|-------|--------|
| `external.v2.effective.verifier_policy` | 74：必須 60、観察 14 | `verifier_policy_vectors.json` の `effective_mode` と `tier` |
| `external.v2.effective.verifier_policy_clarification` | 必須 34 | `verifier_policy_clarification_vectors.json` の `effective_mode` と、その bundle の `tier` |
| `external.v2.effective.coverage` | 必須 17 | `effective_policy_vectors.json`：要求した各モードでの elevated と maximum の肯定例、`risk_score` 200、500、799、800、明示した `security_tier` と宣言した `security_tier`、ティアの下限の前にデフォルトを置き換えるパスポートのオーバーライド（低いものと高いもの）、オーバーライドが定めるモードによる拒否 |
| `external.v2.effective.pre_resolution` | 5：必須の対照 1、解決前 4 | `bundle_vectors.json`：署名済み bundle と、V2-1、V2-3、V2-4 で拒否されるその 4 つの変異 |

- **判定：** 判定結果は `/2` と同じです（文言は評価しません）。必須ケースでは、さらに 2 つの値がどちらも解決済み、既知、整合的（`pq_only` を除き、ティアの下限より弱いモードはない）で、期待値と等しい必要があります。欠落、部分的、未知、不正な形式（文字列でも `null` でもない）、矛盾、誤りの値は、判定結果が正しくても失敗になります。解決済みの組がない `verified: true` は矛盾です。観察ケース（コミット済みのバイトで V2-2 に失敗する bundle）と解決前のケースでは、2 つの値が未解決のままでも構いません。欠落、`null`、`""` のいずれも、そのまま報告されます。報告された値は、それでも既知で整合的であり、観察ケースでは期待値と等しくなければなりません。不正な形式の `effective` エンベロープは `malformed_result` エラーです。対照は単純な肯定例で、同じ実行で合格する必要があります。
- **期待値：** コミット済みのベクトルから取り、spec/DCP-AI-v2.0.md § 14.2・§ 14.3 と VERIFICATION.md V2-9 から手で書いたものです。パスポートの `risk_tier` に対するオーバーライドが `default_mode` を置き換え（低くてもよい）、その後ティアの下限がそれを引き上げます。キットは応答からモードやティアを計算しません。`effective_policy_vectors.json` はコミット済みの TEST-ONLY 鍵で署名されています。その ML-DSA-65 署名はヘッジ付きなので、再生成で異なるのはその署名だけで、コミット済みのファイルが成果物です。`node tools/conformance/effective-policy-catalog.mjs --check` はフィクスチャからカタログを再構築します。
- **ラッパー：** 各ラッパーはケースごとに 1 回検証を呼び出し、その結果の 2 つのフィールドをコピーします。TypeScript と Python は `details` から（`details` が欠けている、またはオブジェクトでない場合はエラーであり、未解決の応答ではありません）、Go と Rust は結果の文字列フィールドから（常に公開され、未解決なら `""`）、WASM は `wasm_verify_signed_bundle_v2` が返す JSON のメンバーから（空のときは省略）コピーします。`/5` では、ほかの操作はすべて `unsupported` です。先行する失敗の後にモードとティアを解決するかどうかは SDK ごとに異なり、解決前のスイートはそれを判定せずに記録します。
- **自己テスト：** `external-effective-policy.test.mjs` は、フィクスチャからカタログを再構築し、観察ケースをスキーマ検証と、カバレッジを独立した規則と照合し、欠落・余分・重複した ID、誤った解決区分、整合しない期待値、単純な肯定例でない対照をローダーが拒否することを確かめます。TypeScript ラッパーの実際の応答から作った偽の実装は、それぞれちょうど自分のケースで失敗します。欠落、`null`、`""`、部分的、未知、不正な形式、矛盾、誤りの値、エンベロープのエラー、そして要求したモード、デフォルトのモード、ティアの下限だけ、宣言した `security_tier`、`policy_decision.resolved_tier` を報告するラッパーです。転送のエラー、タイムアウト、古いレポートは、ランナーの `/5` のディスパッチを通ります。CI は自己テストとカタログを 5 つのラッパーで実行し、どれも必須です。
- **限界：** 合格が示すのは、これらのポリシーでのこの 130 ケースだけで、V2 への完全な適合ではありません。拒否された bundle について報告されたモードやティアは診断であり、受け入れや認可ではありません。対象外：DCP-09 の委任チェーンによるティアの下限（チェーンを運ぶ bundle のフィールドはない）。`@dcp-ai/wasm` の JavaScript API（`DcpWasm`）は、[ブラウザーラッパー](#browser-wrapper-dcpwasm-in-chrome)を通じて Chrome でこのカタログを実行します。このカタログが呼び出さない `computeSecurityTier` は、その直接セクションの一つです。

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

<a id="delegation-catalog-dcp-09-mandate-chains"></a>

### 委任のカタログ：DCP-09 の委任状チェーン

`--catalog delegation` は 3 つ目のオプトインのカタログ [`external-delegation-catalog.json`](../../../../tools/conformance/external-delegation-catalog.json)
（契約 `dcp-ai-conformance-external/4`、バージョン 2.0.0、規範的な 97 ケース）を選択し、同じ種類の argv に対して実行します。委任状チェーンの検証
（[DCP-09 §3.5.2](../../../../spec/DCP-09.md)）を、カタログが SHA-256 で固定する 3 つのコミット済みコーパスで判定します。
契約 `/1`、`/2`、`/3` とそのカタログは変わりません。TypeScript、Python、Go、Rust のラッパーは SDK を通じて `/4` に
応答します。WASM ビルドは委任状チェーンの関数をエクスポートしないため、そのラッパーは `/3` と同じく `/4` を拒否し
（exit 2）、何もそれをエミュレートしません。

```bash
node tools/conformance-external.js --catalog delegation --list
node tools/conformance-external.js --catalog delegation --report /tmp/delegation-ts.json -- node tools/conformance/wrappers/ts-sdk.mjs --sdk sdks/typescript/dist/index.js
node tools/conformance-external.js --catalog delegation -- /path/to/python -I tools/conformance/wrappers/python_sdk.py
node tools/conformance-external.js --catalog delegation -- tools/conformance/wrappers/.build/go-wrapper
node tools/conformance-external.js --catalog delegation -- tools/conformance/wrappers/.build/rust-target/debug/dcp-ai-conformance-wrapper
node tools/conformance-external.js --catalog tools/conformance/external-delegation-catalog-1.0.0.json -- /path/to/implementation
node --test tools/conformance/external-delegation.test.mjs
DCP_EXTERNAL_PYTHON=/path/to/python DCP_EXTERNAL_REQUIRE_PYTHON=1 DCP_EXTERNAL_REQUIRE_NATIVE=1 node --test tools/conformance/external-delegation-wrappers.test.mjs
```

| スイート | ケース | ソース |
|-------|-------|--------|
| `external.delegation.chain` | 52 | [`mandate_chain_vectors.json`](../../../../tests/interop/v2/mandate_chain_vectors.json)：署名と役割、リンク、深さ、権限の縮小、有効期間、層の下限、失効 |
| `external.delegation.chain_time` | 22（バージョン 1.0.0 ではうち 10 が参考） | [`mandate_chain_time_vectors.json`](../../../../tests/interop/v2/mandate_chain_time_vectors.json)：規則 4 の有効期間、その入れ子、検証時刻 |
| `external.delegation.domains` | 23 | [`mandate_domain_vectors.json`](../../../../tests/interop/v2/mandate_domain_vectors.json)：1 つの委任状で繰り返されるドメイン（どの深さでも） |

- **操作：** `verify_mandate_chain` は 4 つのフィールドを受け取ります。
  - `chain_b64` と `keys_b64`：フィクスチャがチェーンとその `{human_keys, agent_keys}` について持つバイトそのものの base64。
  - `revoked_mandate_ids`：文字列の配列。
  - `verification_time`：コミットされたとおりの RFC 3339 の文字列。

  ランナーはこれらを解析も再シリアライズもしません。2^53 を超える整数（`9007199254740993`）、10 進形式の `9007199254740991.0`、すべてのタイムスタンプが、書かれたとおりに実装へ届きます。
- **応答：**
  - `ok` は、ちょうど `valid`（真偽値）、`errors`（文字列の配列）、`effective_tier`（`routine`、`standard`、`elevated`、`maximum` または `null`）、`depth`（負でない整数）を持ちます。拒否されたチェーンは `valid: false` の `ok` です。
  - `message` を持つ `error`、または `unsupported`。

  別の形のリクエストでは、ラッパーは 2 で終了します。
- **判定：** 規範となるのは判定結果だけです。`valid` が一致し、受理されたチェーンでは `effective_tier` も一致すると合格です（規則 6）。エラーを伴う `valid: true` は `contradictory_result` です。
  - エラーの文言（コーパスの `error_contains` または正確な `errors`）と `depth` は SDK の診断です。報告されますが（`matched`、`differs`、`no_message`）、判定には使われません。
  - 拒否にはメッセージも、特定の `depth` も、特定の層も必要ありません。
  - `--assessment` は適用されません。
- **バージョン：** 既定の 2.0.0 は、DCP-09 §3.5.2 の明確化（05/11/2026）が定めるとおり 97 ケースすべてを判定します。規則 4 の瞬間と署名鍵の `expires_at` はミリ秒で比較され、各署名鍵は検証時刻に有効で期限切れでないことが必要です。
  - バージョン 1.0.0 は [`external-delegation-catalog-1.0.0.json`](../../../../tools/conformance/external-delegation-catalog-1.0.0.json) としてバイト単位で保管され、そのパスで実行されます。`chain_time` の 10 ケースを参考としていました。3 ケースはミリ秒での瞬間の比較に、7 ケースは署名鍵の `expires_at` に依存します。これらは送信され、`informative_totals`（`requested`、`completed`、`agrees`、`differs`、`error`）で報告され、合格にも不合格にもなりません。そのいずれかへの応答の欠落、不正な形式、`error` または `unsupported` は、引き続き実行のエラーです。
  - ランナーは各バージョンの分類を固定し、1.0.0 のバイトを固定します。ラベルを付け替えた、再シリアライズした、または未知のバージョンは拒否されるため、どちらのバージョンも他方の分類で判定されることはありません。10 ケースのいずれかで結果が異なっていた実装は 1.0.0 に合格し、2.0.0 に不合格になります。1.0.0 の報告は 1.0.0 だけの証拠です。
  - 規範ケースが 1 つも実行されなかった実行は合格になりません。
- **アンカー：** 各規範ケースは §3.5.2 の規則を示します。`rule1` から `rule7`、未知・欠落・比較できない入力には `fail_closed`、受理されたチェーンには `all_rules` です。
- **コントロール：** 拒否は、そのコントロールが同じ実行で合格した場合にだけ数えられます。コントロールは同じスイートの規範的に受理されるチェーンで、両者の関係は `control_scope` が示します。
  - `same_chain`：チェーンのバイトは同じで、失効した ID、時刻、または鍵が異なる。
  - `single_mandate`：委任状 1 つ全体が異なり、多くのフィールドと署名が変わりうる。
  - `same_shape`：長さが同じ。
  - `suite`：スイートの受理されるすべてのチェーン。

  ランナーはカタログの読み込み時に、この関係をバイトで確認します。どれも、2 つのケースの違いが 1 つの欠陥だけだとは主張しません。選択したスイートは自身のコントロールを含みます。
- **カタログ：** `delegation-catalog.mjs --check` は、コーパスとアンカーの表から 2.0.0 のカタログを再生成します。ルートの署名者の鍵には規則 1、委任するエージェントの鍵には規則 2 です。ランナーは、コーパスのケースを欠落、重複、並べ替えしたカタログ、ケースをそのバージョンと異なる分類にしたカタログ、またはコントロールを誇張したカタログを exit 3 で拒否します。
- **プロセスとラッパー：** `/1` から `/3` と同じです。このカタログの既定のタイムアウトは 300 000 ms です。ラッパーはケースごとに 1 回、システムの時計ではなくリクエストの時刻で呼び出し、それぞれ自身の SDK のコーパステストと同じ方法でチェーンを読みます。

  | SDK | チェーン | 時刻 |
  |-----|-------|------|
  | TypeScript | `JSON.parse` | `verifyMandateChain`、時刻は `parseRfc3339` で読む |
  | Python | `json.loads` | `verify_mandate_chain`、`rfc3339_epoch_ms` を aware な UTC の datetime として |
  | Go | `json.Unmarshal`（float64） | `VerifyMandateChain`、`time.Parse(time.RFC3339Nano)` で読む。SDK が現在時刻として読むゼロ時刻は拒否する |
  | Rust | `serde_json` | `verify_mandate_chain`、`parse_rfc3339_millis` で読む |
- **自己テスト：**
  - `external-delegation.test.mjs` は、SDK を使わず、コーパスの期待値から作った合成の応答を判定し、送信したバイトがフィクスチャの一部であることを確認します。対象は次のとおりです。
    - すべての受理または拒否、1 つの規則を無視する検証器、誤った層。
    - 矛盾した、不正な形式の、`error` と `unsupported` の応答。1.0.0 では異なる結果や失敗を返す参考ケース、2.0.0 では同じ応答がちょうどそれらのケースで失敗すること。
    - 欠落、重複、余分、途中で切れた結果、古い ID、失敗・強制終了・停止・遅れて終了するプロセス。
    - 新しいレポート、選択、改ざんされたカタログとフィクスチャ、ラベルを付け替えたまたは再シリアライズしたバージョン。
  - `external-delegation-wrappers.test.mjs` は 4 つのラッパーを SDK 経由で実行します。97 ケース、3 つの瞬間でのリクエストの時計、不正な形式のリクエスト、注入した障害です。WASM の拒否も確認し、改変した TypeScript の SDK を 4 つ検出します。失効を無視するもの、独自の時計を使うもの、署名鍵の有効期限を無視するもの、有効期間をミリ秒より下の精度で比較するものです。2.0.0 で測定すると、3 つ目は 7 つの鍵のケースで、4 つ目は 3 つのミリ秒のケースのうち 2 つで失敗します（ラッパーは SDK に、すでにミリ秒の検証時刻を渡します）。1.0.0 ではどちらも合格し、それらのケースで結果が異なるだけです。ラッパーは stdin を閉じて非同期に呼び出します。入力付きの同期実行では、ネイティブのラッパーがファイル終端を待ち続けることがありました。

  CI は両方を、4 つのラッパーを必須として実行します。
- **制限：** 合格が示すのは、実行した argv がこれらのコミット済みチェーンでこれらの判定を返すことだけです。
  - 鍵と失効した ID はリクエストで与えられます。キットは誰の鍵かを確認せず、`valid` はプリンシパルへの信頼でも、受け入れ判定でも、行為の承認でもありません。
  - 有効性ヘルパー（`verifyMandateValidity`）、`tier_floor`、その他の DCP-09 のレコードは、このカタログの対象外です。

<a id="performance-baseline"></a>

## 性能ベースライン

`tools/conformance-perf.js` は、このチェックアウトの 5 つの SDK の規範的な V2 検証器を、同じ入力バイト列、同じポリシー、同じ検証時刻で測定します（契約 `dcp-ai-perf/1`）。
小さく再現可能なローカルのベースラインであり、このハーネスのベンチマーク、セキュリティのランキング、速度の要件ではありません。CI は速度を一切確認しません。

```bash
node tools/conformance-perf.js --list
node tools/conformance-perf.js --offline --warmup 5 --samples 20 --rounds 1 --python /path/to/python --report /tmp/perf-sanity.json
node tools/conformance-perf.js --no-build --warmup 20 --samples 100 --rounds 3 --python /path/to/python --report /tmp/perf.json
DCP_PERF_PYTHON=/path/to/python DCP_EXTERNAL_REQUIRE_PYTHON=1 DCP_EXTERNAL_REQUIRE_NATIVE=1 node --test tools/conformance/perf.test.mjs
```

- **ワークロード：** コミット済みの 6 つのバンドルを読み込むだけで、決して再署名しません。`default_verifier_policy`、2026-10-22T00:00:00Z で、`hybrid_ok`、`classical_sig_invalid`（RPR の Ed25519 署名）、`pq_sig_invalid`（バンドルの ML-DSA-65 署名）、`secondary_root_ok`、`secondary_root_wrong`、`secondary_all_ok` です。
  二次のペアは基本の成果物とエントリーを共有し、マニフェストの `audit_merkle_root_secondary` と、それを覆うバンドル署名（`manifest_hash`、両方の署名値、`signature.hash_alg`）が異なります。1 つのフィールドのコストを切り出す実験ではありません。
- **測定する内容：** 呼び出しごとに、SDK ごとに 1 つのプロセスで測り、サンプルごとにプロセスを起動しません。TypeScript は `JSON.parse` と `await verifySignedBundleV2`（公開パッケージではなくローカルの `dist`）、Python は 1 つの永続的な `asyncio` ループの中で `json.loads` と `await verify_signed_bundle_v2`（チェックアウトの `dcp_ai`）、Go はバイト列 API が解析を含む `VerifySignedBundleV2At`、Rust は `serde_json::from_slice` と `verify_signed_bundle_v2_at`（release の example）です。
  WASM はデコード、`wasm_verify_signed_bundle_v2`、その結果の `JSON.parse` で、呼び出しの間 `Date.now` を検証時刻に置き換えます。公開境界のコストを含め、その旨を明記します。レジストリとポリシーは一度だけ用意し、結果はキャッシュしません。
- **確認：** ウォームアップと計測の呼び出しはワークロード間でラウンドロビンに実行し、各呼び出しを確認します。期待する判定、肯定ケースでエラーがないこと、否定ケースでエラーがあることです。確認に失敗すると、その子プロセスは止まり、時間を含まない `check_failed` を返して終了コード 0 で終わります。ランナーはその実行を失敗として報告します（ランナーの終了コード 1）。レポートには他の子プロセスの結果が残り、その場合はベースラインではありません（`baseline: false`）。失敗した子プロセスの時間は決して提示しません。
  子プロセスは、すべてのサンプルを持つ成功か、その失敗のどちらかを返します。ランナーは契約、実行の識別、SDK とエントリーポイント、件数、各サンプルがナノ秒の正の安全な整数であることを確認します。
- **統計：** すべてのサンプルを順に保持します。SDK とワークロードごとに、`n`、`min`、中央値（`n` が偶数なら中央 2 値の平均）、最近接順位による p90 と p99、`max`、IQR です。ランキングも割り当てた割合もありません。否定ケースは最初の失敗した確認で止まることがあり、その `errors_first` は診断にすぎません。
- **来歴：** 既定では、ツールは測定対象（TypeScript の `dist`、`.build` 配下に `-o` で出力する Go の子プロセス、release の Rust の example と WASM、独自のフォルダーの WASM）を、上限のある 1 つのビルド期限のもとでビルドします。
  その後、選択した各 SDK について、ソースツリー、マニフェストとロック、子プロセス、成果物のハッシュ（`dist` 全体、`.wasm` とその JS グルー、バイナリ）、ツールのバージョン、ビルドオプションを記録し、どれかが欠けていれば何も測定しません。
  `--no-build` は要求された SDK についてそれらすべてを再計算し、差異や欠落を拒否します。時刻、コミット、dirty フラグは参考情報です。各子プロセスは読み込んだものを報告します（TypeScript：`dist` から解決した各 import とそのパッケージマニフェストとハッシュ、Python：チェックアウトの `dcp_ai` と実際に import されたモジュール）。
  この記録は成果物をこのチェックアウトに結び付けますが、サプライチェーンを保証するものではありません。
- **プロセスとレポート：** 各子プロセスは外部キットのランナー（期限、プロセスグループ、出力の上限）のもとで実行します。レポートにはまず `incomplete` のプレースホルダーが書かれ、どの経路でも置き換えられます。曖昧な `--report`（欠落、オプションのような値、重複）は何も書きません。
  ランナーの終了コードは 0 が合格、1 が確認の失敗、2 が使用法、3 がインフラ、ビルド、来歴です。`--child-argv` はハーネスのテストのためだけに子プロセスを置き換え、そのレポートは決してベースラインになりません。
- **セルフテスト：** `perf.test.mjs` は、5 つの子プロセスの必須のスモーク実行（W=1、N=2、R=1）、偽の子プロセス（欠落、重複、未知の結果、誤った件数、不正または安全でないサンプル、誤った識別、矛盾、accept-all、ウォームアップとサンプルでの失敗、不正な失敗、有効な出力の後のゼロ以外の終了、ハング）、誤った肯定の期待を与えた実際の子プロセス、古い合格の上の新しいレポート、偽造、古い、不完全な来歴、一時ツリーでの選択、SIGTERM を無視するビルド手順を実行します。
  CI はすべての子プロセスを必須にしてネイティブのジョブでこれらを実行します。
- **制限：** 1 台のマシンと小さなサンプルです。周波数、熱と電源の状態、バックグラウンドの負荷は制御しません（CPU と OS は記録します）。各 SDK はそれぞれの暗号ライブラリを含めてそのまま測定し、Rust のプロファイルは既定の release です。結果はローカルにとどめ、この節は数値ではなく手法を記述します。

<a id="bounded-workload-scaling"></a>

## 上限のあるワークロードの規模変化

`tools/conformance-perf-scale.js`（レポート契約 `dcp-ai-perf-scale/1`）は、このチェックアウトの規範的な検証器が、小さく有限な格子の上でどう規模変化するかを測定します。4 つの次元それぞれに 3 つのサイズ、サイズごとに 3 つの対照があります。別のツールであり、`dcp-ai-perf/1` とその子プロセスとレポートは変わりません。ストレステストでも、失敗の閾値の探索でも、順位付けでも、速度の要件でもありません。CI はハーネス（判定、件数、単位、後始末）を確認し、速度やメモリの閾値は設けません。

```bash
node tools/conformance-perf-scale.js --list
node tools/conformance-perf-scale.js --generate /tmp/scale-corpus
node tools/conformance-perf-scale.js --corpus /tmp/scale-corpus --sizes small --warmup 1 --samples 2 --offline --python /path/to/python --report /tmp/scale-smoke.json
node tools/conformance-perf-scale.js --corpus /tmp/scale-corpus --no-build --python /path/to/python --report /tmp/scale.json
DCP_PERF_PYTHON=/path/to/python DCP_EXTERNAL_REQUIRE_PYTHON=1 DCP_EXTERNAL_REQUIRE_NATIVE=1 node --test tools/conformance/perf-scale.test.mjs
```

- **準備：** `--generate` は TypeScript の `dist` で署名し、ルートのパッケージを import するため、先に[監査資料](../../docs/conformance/AUDIT_DOSSIER.md#reproduce)のローカル準備が必要です。TypeScript SDK をビルドし、ルートをコミット済みのロックファイルでインストールしておきます。その後の実行は測定するものを自らビルドします。`--offline` では、Go、Cargo、wasm-pack のキャッシュに依存関係がすでにある必要があります。`--python`（または `DCP_PERF_PYTHON`）には、Python SDK の依存関係と pip を備えたインタプリタを指定します。
- **次元：** バイト数（`intent.payload.target` の開いたメンバーにある 1 つの ASCII 文字列が 1、16、256 KiB）、入れ子（同じメンバー内で 4、16、64 個の入れ子のオブジェクト）、監査の長さ（1、16、256 エントリ）、委任状チェーンの長さ（DCP-09 の委任状が 1、4、16。ルートの `delegation_depth` は 0）。bundle は、変更していない `dcp-ai-perf/1` の子プロセスで 5 つの SDK で実行します。チェーンは、WASM が委任状チェーンの API を公開していないため、別の `dcp-ai-perf-mandate/1` の子プロセスで TypeScript、Python、Go、Rust で実行します。
- **対照：** `valid` は大きくした後に署名し直すので、検証器の全体に到達します。`stale` は、大きくした部分の 1 バイトを署名後に変えた有効な文書です。`schema` は、固定したスキーマ違反を 1 つ持つ有効な文書です（チェーンではルートの形の誤り）。負の対照の最初のエラーは、そのカテゴリーを示さなければなりません。スキーマの対照では `schema: …` の行だけ、署名が古い対照では `intent: payload_hash mismatch`、`Manifest audit_merkle_root mismatch` または `mandate[i]: … does not verify` があり、スキーマや形のエラーはありません。これは SDK が報告するカテゴリーであり、内部の 1 つの経路だけが実行されたことの証明ではありません。
- **コーパス：** TEST-ONLY の鍵で一度だけ生成し、その正確なバイト列から測定します。バイト列はハッシュとともにマニフェストに記載します。bundle の ML-DSA-65 署名は hedged なので、生成し直すと別のバイト列になります。子プロセスを起動する前に、ツールはコーパスを確認します。上限のある通常ファイルであること、コードが定義するとおりの予定したエントリだけがあること、各サイズの大きさ、対照どうしの 1 バイトと 1 変更の関係、Ajv によるスキーマ、そして SDK を使わない完全性と署名です。期待値が SDK どうしの一致から来ることはありません。
- **レイテンシ：** `dcp-ai-perf/1` と同じく、プロセス内での呼び出しごとの時間（入力バイト列の解析と検証器）です。生成、署名、ビルド、プロセスの起動、リクエストのデコードは含みません。SDK と次元ごとに 1 つの子プロセスで、その 9 つのワークロードを round-robin で回します。ウォームアップは最大 10 回、サンプルはワークロードごとに最大 50 回、1 ラウンドです。すべての呼び出しを確認します。
- **メモリ：** SDK とワークロードごとに新しい子プロセス（ウォームアップ 1 回、サンプル 3 回、すべて確認）を `tools/conformance/perf/rusage.py` が起動し、そのプロセスについてカーネルが記録する RSS の最大値を読みます（`os.wait4` による `ru_maxrss`：macOS ではバイト、Linux では KiB で、バイトに正規化します。その他のプラットフォームでは理由付きの null で、0 にはしません）。これはプロセス全体の生存期間中のピーク（ランタイム、import、リクエストのコピー、ウォームアップ、検証、結果）であり、検証器の割り当てでもサンプリングした値でもありません。ヒープは測定しません。メモリをレイテンシと比べることはありません。
- **規模変化：** 1 つの SDK の中だけで比べます。各サイズの中央値を同じ系列の最小サイズと比べ、各ピーク RSS から最小サイズのものを引きます。順位付けも閾値もなく、プリミティブへの帰属もしません。
- **期限とプロセス：** コマンドはスーパーバイザーです。作業を独自のプロセスグループのワーカーとして実行し、`--deadline-ms`（既定は 60 分）に達すると、ワーカーと、それが起動したすべてのプロセスを停止します。プロセスは `/bin/ps` で見つけ、独自のグループにいる子も含みます。その後、エラーのレポートを書きます。プロセスを列挙できなければ何も起動しません。停止中に列挙が失敗しても、既知のワーカーのグループは停止させ、レポートには後始末が不完全であると記します。内部では、ワーカーは協調的な予算を守ります。ステップは予約が収まる場合にだけ始まります。スーパーバイザーは macOS と Linux でのみテストしています。`--generate` は実行自身が作るステージングディレクトリに書き込み、コーパスの確認の後にだけ名前を変えます。
- **由来：** 5 つの SDK の `dcp-ai-perf/1` の記録に加えて、エントリーポイントから推移的に見つけたツールの JavaScript モジュール、それらが解決するパッケージ、スキーマのツリー、ルートのマニフェストとロック、委任状の子プロセスとそのバイナリ、測定するインタプリタの `pip freeze` を記録します。実行の前と後に計算し、差異、欠落、コーパスのバイト列の変化があればエラーです。ビルドは `dcp-ai-perf/1` と共有します。
- **レポート：** `baseline` が true になるのは、すべてのサイズ、両方のフェーズ、合格、置き換えなしの場合だけです。`--child-argv`、`--launcher-argv`、および `DCP_PERF_SCALE_SELFTEST_*` の変数はすべて、テスト用の置き換えとして名前を記します。終了コード：0 合格、1 確認の失敗（判定またはステージ）、2 使い方、3 インフラ、コーパス、ビルド、由来、または期限。
- **限界：** 1 台のマシンと小さなサンプルです。周波数、熱と電源の状態、バックグラウンドの負荷は制御しません。結果はローカルにとどまります。このセクションは方法を記述するもので、数値は記載しません。
