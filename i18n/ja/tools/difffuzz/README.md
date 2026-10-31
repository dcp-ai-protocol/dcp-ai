<sub>[English](../../../../tools/difffuzz/README.md) · [中文](../../../zh-CN/tools/difffuzz/README.md) · [Español](../../../es/tools/difffuzz/README.md) · **日本語** · [Português](../../../pt-BR/tools/difffuzz/README.md)</sub>

<a id="differential-fuzzer-for-the-v2-bundle-verifiers"></a>

# V2 bundle 検証器の差分ファザー

> [英語版](../../../../tools/difffuzz/README.md)の参考訳です。更新日：2026年10月31日。相違がある場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せず保持しています。

`run.mjs` は同じ変異済みの署名付き V2 bundle を、明示的なポリシーと同じ検証時刻で 4 つの SDK 検証器（TypeScript の `verifySignedBundleV2`、Python の `verify_signed_bundle_v2`、Go の `VerifySignedBundleV2At`、Rust の `verify_signed_bundle_v2_at`）に渡します。実装間の不一致、共有ベクトルの宣言に反する判定、判定を変えるキーの並べ替え、エラー・異常終了・タイムアウトを検出事項とします。v2.10.0 で完了したセキュリティ対応のほとんどは 4 検証器間の不一致でした。本ツールはリリース前にそれを見つけるためのものです。制御モジュールは `fuzz.mjs` で、`run.mjs` と自己テストが共有します。

<a id="setup"></a>

## 準備

各 SDK は公開パッケージではなく、このチェックアウトから実行します。

```bash
(cd sdks/typescript && npm install && npm run build) # shims/ts imports sdks/typescript/dist
pip install -e sdks/python                            # dependencies of shims/py (pynacl, pqcrypto>=1.0)
```

`PATH` には Go（`sdks/go/go.mod` のバージョン）と安定版 Rust ツールチェーンが必要です。制御モジュールは `shims/go`（`replace` で SDK を `../../../../sdks/go` に向けるモジュール）を `-mod=readonly`、`shims/rust`（`../../../../sdks/rust` へのパス依存）を `--locked` でビルドします。Cargo の `CARGO_TARGET_DIR` も含め、実行ごとの専用一時ディレクトリを使用するため、同時実行でもバイナリを共有しません。そのため Rust shim は毎回最初からビルドされます。マニフェストやロックファイルは変更しません。`--offline` では Go が `GOPROXY=off`、Cargo が `--offline` を使うため、モジュールと crate のキャッシュに依存関係が揃っている必要があります。ビルドには専用の期限があります。

レポートの `build.artifacts` は測定対象を内容によって記録します。4 shim、ビルドした 2 バイナリ（ハッシュのみで一時的なパスは含まない）、TypeScript の `src` と `dist`、`package-lock.json`、Node が解決した各直接ランタイム依存のディレクトリ、Python SDK のソースとインタープリターおよび 5 配布物のバージョン、Go・Rust SDK のソースと Rust のロックです。`inputs` は制御モジュール（`fuzz.mjs`、`run.mjs`）とフィクスチャを記録します。実行終了時に両方を再確認し、変化があれば終了コード 3 になります。`provenance_limits` はハッシュで証明しない範囲を明示します。その `dist` がその `src` からビルドされたことや、推移的依存関係は検証しません。

<a id="usage"></a>

## 使用方法

```bash
node tools/difffuzz/run.mjs                       # 200 iterations, seed 1
node tools/difffuzz/run.mjs --iterations 2000 --seed 7 --report /tmp/difffuzz.json
node tools/difffuzz/run.mjs --replay tools/difffuzz/findings/<file>.json
node --test tools/difffuzz/difffuzz.test.mjs      # self-tests of the harness (no SDK)
node --test tools/difffuzz/real-shims.test.mjs    # bounded diagnostic tests with all four SDKs
```

| オプション | デフォルト | 意味 |
| --- | --- | --- |
| `--iterations N` | `200` | 生成する変異入力数（0～1,000,000） |
| `--seed S` | `1` | PRNG シード。同じシードとフィクスチャで同じ変異を生成 |
| `--modes a,b` | `default,hybrid_required` | 全シードと変異入力に適用するポリシー（ポリシー節参照） |
| `--timeout MS` | `60000` | 1 バッチプロセスの期限（`--timeout-ms` と同じ） |
| `--python PATH` | `$DIFFFUZZ_PYTHON` または `python3` | Python SDK の依存関係を持つインタープリター |
| `--out DIR` | `tools/difffuzz/findings` | 検出事項の保存先 |
| `--report FILE` | なし | 実行全体の JSON レポート。最初に `incomplete` を書き、使用方法エラーを含む全経路で置換する。値が欠落・オプション形式・重複の場合は書かない |
| `--offline` | 無効 | ローカルキャッシュのみでビルド |
| `--build-timeout-ms MS` | `600000` | shim ビルド全体の期限 |
| `--batch-cases N`, `--batch-bytes B`, `--case-bytes B` | `64`, 16 MiB, 4 MiB | バッチあたりのケース数、リクエスト全体の正確な UTF-8 サイズ、1 入力の生バイト数。シードが収まらなければ終了 3、変異入力ならスキップして集計 |
| `--stdout-bytes B` | 8 MiB | 1 バッチプロセスの出力上限 |
| `--max-findings N` | `50` | 保存する検出事項数。到達後は基準検査を含む追加バッチを実行せず、合格にはならない |
| `--max-retries N` | `200` | 失敗バッチを切り分ける単独ケース再実行数。使い切ると終了 3 |
| `--minimize-steps N`, `--minimize-total N` | `24`, `96` | 検出事項ごと・実行全体の縮小予算 |

ビルド前に全値を確認します。未知、重複、欠落、範囲外の引数は終了コード 2 です。終了コードは、0：検出事項も失敗したバッチもなく基準検査が完全、1：検出事項・失敗バッチ・不完全な基準検査のいずれかがある、2：使用方法の誤り、3：インフラまたは実行ツールの不具合です。3 には、ビルド失敗、実行中の入力変更、shim の起動失敗、バッチまたは単独実行での規約外・未対応の応答、再試行予算の枯渇、反復を行うのに最初のモードで有効と宣言されたシードがない場合を含みます。コマンドは常に正確に 4 shim です。

<a id="policies-and-time"></a>

### ポリシーと時刻

各リクエストはポリシーと時刻を明示します。`now_ms` は外部適合性キットの時刻 2026-10-22T00:00:00Z なので、判定は実行日によって変わりません。`default` は全 SDK に対してベクトルの `default_verifier_policy`（TypeScript の `DEFAULT_VERIFIER_POLICY`）を使います。他のモード名は、ベクトルが各モードのポリシーを構築するのと同じく `default_mode` と全リスクティアに適用します。シードの `verifier_policy_overrides` は全モードでそれらのフィールドを上書きします。このプロトコル以前は、`default` は各 SDK 固有のデフォルトであり、shim はそれぞれシステム時計を読んでいました。

<a id="seeds-and-expectations"></a>

### シードと期待値

シードは `tests/interop/v2/bundle_vectors.json` の bundle で、`_description` の宣言を用います。`signed_bundle` は検証に成功し、その全 `must_reject` 変異と全 `must_reject_bundles` はモードにかかわらず拒否、全 `must_accept_bundles` は全モードで成功します。`classical_only_routine_bundle` には `verified_by_mode` を適用しますが、`default` の判定は宣言していません。デフォルトポリシーは 4 モードのいずれかに解決されるので、「全」「いずれの」モードにも含まれます。宣言された期待値に反する判定は、4 SDK が一致しても `expectation` の検出事項です。一致を正解の根拠にはしません。期待値が仕様自体に反すると分かった場合、再現ケースを保存してその解釈の使用を止め、多数派に置き換えないでください。`tests/interop/v2/cross_sdk_vectors.json` と `tests/conformance/examples/` の署名付き bundle は期待値を宣言せず、差分比較のみに使います。

奇数回目の反復（切り上げで少なくとも半数）は、最初のモードで有効と宣言されたシードからランダムに選んで開始します。それ以外は任意のシードを使います。反復があるのにそのような有効シードがない場合は終了コード 3 で停止します。

<a id="mutators"></a>

### 変異処理

各反復はランダムな位置に 1 回（70%）または 2 回（30%）の変異を適用します。キー削除、`null` への設定、値の型変更、兄弟値の交換、base64 の 1 文字変更、列挙文字列をプロトタイプのキー（`constructor`、`__proto__`、`toString`、`valueOf`、...）に置換、キーをプロトタイプのキーに改名、未知のキー追加、成果物やその `payload`、`payload_hash`、`composite_sig` を別の位置へ複製、数値を `1.0`、`1e2`、`-0`、`0.1`、`2^64`、`1e400` などに変更、RFC 3339 時刻を別オフセット・不正形式・遠い過去や未来へ変更、過大な文字列（64 KiB または 1 MiB）、深さ 100 の入れ子、再帰的なキーの並べ替えです。最後の処理で判定が変わってはいけないため、各 SDK の結果をそのシードの同じ SDK の基準結果と比較します。JavaScript が表現できない数値はシリアライズしたテキストにそのまま挿入し、全パーサーが同じバイト列を見るようにします。並べ替えは、以前は失われていた自身の `__proto__` キーも保持します。

<a id="judgement"></a>

## 判定

各 shim は `verdict`（`verified` と `errors`）、`parse_rejected`（JSON パーサーによる拒否）、`error`（SDK の例外または panic）、`unsupported` のいずれかを返します。制御モジュールは `crash`（0 以外の終了またはシグナル）、`timeout`、`output_limit`、`protocol`（規約外の応答）を追加します。SDK は受理・拒否で比較し、`true` は受理、`false` またはパーサー拒否は従来どおり拒否です。他の区分は票として扱いません。プロセスが失敗したバッチは記録し、原因を分離するため各ケースを単独で再実行します。再試行の結果にかかわらず失敗バッチがあれば合格にはなりません。単独ケースでは再現しない失敗も検出事項（`batch_failure_not_reproduced`）です。どれが最初に失敗しても、バッチの各 shim 実行を待ってから終了します。

<a id="findings"></a>

## 検出事項

各検出事項は `findings/<seed>-<iteration>-<mode>-<n>.json` に保存します。このディレクトリは `.gitkeep` 以外 Git の対象外です。分類、シード、モード、明示的なポリシーと `now_ms`、変異、各 SDK の結果、正確な入力バイト列（`input_b64`、`input_sha256`）を記録します。検出事項は手がかりであり、まだバグとは限りません。まず `--replay` で再現してください。記録したバイト列と、あれば縮小済み入力を、検出事項自身の `now_ms` とポリシーで 4 shim に渡します。同じバッチには、その検出事項が記録した対照、つまり変異前の元シードのバイト列・ハッシュ・ポリシー・宣言された期待値・基準結果を含めます。同名の現在のフィクスチャには置き換えません。最初に検出事項全体の型を検証し、種別、結果から導く分類と一致する既知の分類集合、型付きの 4 結果、ハッシュ、対照を確認します。現在のビルド、制御モジュール、フィクスチャ、シードを記録と比較し、差を由来の差異として報告します。再現の終了コードは、0：記録された判定と対照の基準結果を再現、1：再現しない、3：検出事項・対照・インフラによって判定できない、です。

次に変異入力の不一致、エラー、異常終了を予算内で縮小します。期待値の検出事項は既に変異前のシードです。縮小には肯定対照が必須で、そのモードで元シードが基準検査を通り、4 SDK すべてが `true` と検証している必要があります。正しく拒否されたシードは対照にはなりません。各 SDK の判断と、候補と同時に実行するシードの基準結果を保ったまま差分を減らします。`1e400` のような生のトークンはバイト列のまま保持し、再解析しません。結果はその探索と予算内での最小であり、大域的な最小ではありません。キー順序の検出事項とタイムアウトは縮小しません。

どの SDK が正しいかは、規範要件（`spec/VERIFICATION.md`、正規化プロファイル）と共有フィクスチャ（`tests/interop/v2/`）から判断します。それらで決まらない場合は、修正対象を選ぶのではなく、仕様の未解決問題として記録します。予防的な拒否をデフォルトの正解にしないでください。誤っている SDK に先に単体テストを追加して修正し、一致させるために検証器を弱めてはいけません。

## Shims

`--batch` は制御モジュールのプロトコル（`dcp-difffuzz/3`）です。外部適合性キットの `runProcess`（`tools/conformance/external.js`）で、1 バッチにつき有限のプロセスを実行します。期限、専用プロセスグループ、SIGTERM に続く SIGKILL、出力上限、後片付けを備えます。標準入力は `{protocol, run_id, nonce, now_ms, cases: [{id, policy, bundle_b64}]}` で、ID はランダム、期待値やシード名は含めません。標準出力は各ケースにつき 1 結果を含む JSON 文書 `{protocol, run_id, nonce, results}` で、その後に 0 で終了します。不正なリクエストは 2 で終了します。Go shim は nil の `errors` を `[]` として出力し、Rust shim は `std` のみで base64 をデコードします。

このハーネス内部プロトコルでは、バッチの判定診断は最大 8 件の `errors` を保持し、各文字列は最大 256 Unicode コードポイントの元の接頭辞とします。リストまたは文字列を切り詰めた場合、`truncated` に `original_count`（元の件数）、`kept`（保持件数）、`original_code_points`（元の合計）、`sha256`（元のリストのダイジェスト）を記録します。範囲内の通常の診断は変わりません。診断の型が不正なら引き続きプロトコル障害となり、有効な拒否には変換されません。DCP のワイヤ形式や検証器の判定は変更しません。

ダイジェストは元の診断を順番に処理し、各診断の UTF-8 バイト長を 4 バイトのビッグエンディアン整数で表した値に続けて UTF-8 バイト列をハッシュします。TypeScript と Python はこのハッシュのために孤立サロゲートを U+FFFD に置換しますが、診断の接頭辞自体は正規化しません。Go はハッシュのために不正な UTF-8 バイトごとに U+FFFD を使用し、Rust の文字列は有効な UTF-8 です。診断文は SDK 間で異なるため、このダイジェストは特定の shim の診断を識別するもので、SDK 間の同値性を示すものではありません。

ドライバーは上限とマーカーの整合性を検査し、実際に省略があったことを示す情報も要求します。マーカーは記録された結果に保持されます。ただし、元のテキストなしにその真正性を確認したり、形式上有効な短いメッセージを shim が黙って短縮していないと証明したりすることはできません。`dcp-difffuzz/2` の過去の発見項目は、元の無制限の診断を含めて引き続き再実行できます。現在の応答には `dcp-difffuzz/3` とその上限が必要です。手動およびループ出力の従来の動作は維持します。

`stats.truncated_diagnostic_observations` は SDK ごとに切り詰めた診断の観測回数を数え、分離再試行や縮小中の重複観測も含みます。異なる入力の数ではありません。上限が制限するのは診断の転送量であり、SDK の計算や内部メモリではありません。既存の出力上限も適用されます。`--stdout-bytes` を小さく設定すれば正当に `output_limit` が発生し得ます。失敗したバッチがある実行は引き続き合格になりません。

`--batch` がない場合は手動利用向けの従来形式を保ちます。標準入力に 1 文書（`--loop` なら 1 行に 1 文書）、文書ごとに `{"valid": bool, "errors": [string]}`、第 1 引数に任意のモード、各 SDK 固有のデフォルトポリシーとシステム時計です。

## CI

`.github/workflows/difffuzz.yml` は自己テストと 4 SDK の有界診断テストの後、各 pull request で 300 回、毎晩 3000 回の反復を実行し、`workflow_dispatch` では `iterations` と `seed` を受け取ります。ジョブ失敗時は検出事項とレポートを `difffuzz-findings` 成果物としてアップロードします。
