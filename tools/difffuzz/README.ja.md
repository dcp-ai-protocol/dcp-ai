<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · **日本語** · [Português](README.pt-BR.md)</sub>

<a id="differential-fuzzer-for-the-v2-bundle-verifiers"></a>

# V2 のバンドルの検証器のための差分ファザー

> [英語版](README.md)の参考訳です（25/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

`run.mjs` は、同じ変異させた V2 の署名付きバンドルを 4 つの SDK の検証器
（TypeScript の `verifySignedBundleV2`、Python の `verify_signed_bundle_v2`、
Go の `VerifySignedBundleV2WithPolicy`、Rust の `verify_signed_bundle_v2_with_policy`）に与え、
`valid` の判定の不一致、クラッシュ、時間切れをすべて発見として扱います。v2.10.0 で閉じたセキュリティの
ラウンドは、ほぼすべてが 4 つの検証器の間の不一致でした。このツールは、リリースの前にそれらを見つけるための
ものです。

<a id="setup"></a>

## 準備

各 SDK は、公開されたパッケージからではなく、必ずこのチェックアウトから実行されます：

```bash
(cd sdks/typescript && npm install && npm run build) # shims/ts imports sdks/typescript/dist
pip install -e sdks/python                            # dependencies of shims/py (pynacl, pqcrypto>=1.0)
```

Go（`sdks/go/go.mod` のバージョン）と安定版の Rust のツールチェーンが `PATH` に
なければなりません。ドライバーは `shims/go`（SDK を `replace` で
`../../../../sdks/go` に置き換えるモジュール）と `shims/rust`（
`../../../../sdks/rust` へのパスの依存関係を持つクレート）を自らビルドします。

<a id="usage"></a>

## 使い方

```bash
node tools/difffuzz/run.mjs                       # 200 iterations, seed 1
node tools/difffuzz/run.mjs --iterations 2000 --seed 7
```

| オプション       | 既定値                          | 意味                                                           |
| ---------------- | ------------------------------- | -------------------------------------------------------------- |
| `--iterations N` | `200`                           | 生成する変異体の数                                             |
| `--seed S`       | `1`                             | PRNG のシード。同じシードと同じシードのファイルからは同じ変異体ができる |
| `--modes a,b`    | `default,hybrid_required`       | 各変異体を実行する検証器のポリシー                             |
| `--timeout MS`   | `30000`                         | 判定ごとの時間の上限。超えると発見になる                       |
| `--python PATH`  | `$DIFFFUZZ_PYTHON` or `python3` | Python の SDK をインストールしたインタープリター               |
| `--out DIR`      | `tools/difffuzz/findings`       | 発見を書く場所                                                 |

発見が 1 つ以上あると、終了コードは 1 です。最後の要約は、
反復、判定、一致、発見、ミューテーターの内訳を報告します。

<a id="policies"></a>

### ポリシー

`default` は各 SDK の既定の検証器のポリシー（`DEFAULT_VERIFIER_POLICY`、
`DefaultVerifierPolicy()`、`VerifierPolicy::default()`）で、パスポートの
リスクティアを `classical_only` / `hybrid_preferred` /
`hybrid_required` に対応付けます。ほかのモードの名前は、SDK の相互運用のテストと同じく、`default_mode` と
すべてのリスクティアに適用されるため、`hybrid_required` はすべての
バンドルを厳格なモードで実行します。

<a id="seeds"></a>

### シード

`tests/interop/v2/bundle_vectors.json`（`signed_bundle`、`must_accept_bundles`、
`classical_only_routine_bundle`、`must_reject_bundles`）、`tests/interop/v2/cross_sdk_vectors.json`、
`tests/conformance/examples/*.json`（V2 の署名付きの例がそこに追加されるまでは空）にある、
すべての V2 の署名付きバンドルです。各シードは、まず変異させずにすべてのモードで検証されます（
ベースライン）。ベースラインの不一致も発見です。ほとんどのシードは
すべての SDK がすでに拒否する `must_reject` のバンドルなので、反復の少なくとも半分は、
最初のモードでのベースラインの判定が有効なシードから始まります。要約の行はその内訳を報告します。

<a id="mutators"></a>

### ミューテーター

各反復は、ランダムな位置に 1 つの変異（70%）または 2 つの変異（30%）を加えます：
キーの削除、値を `null` にする、値の型の入れ替え、兄弟の 2 つの値の
入れ替え、base64 の文字列の 1 文字の反転、列挙された文字列を
プロトタイプのキー（`constructor`、`__proto__`、`toString`、`valueOf` など）に置き換える、
キーの名前をプロトタイプのキーに変える、未知のキーの追加、アーティファクト（または
その `payload`、`payload_hash`、`composite_sig`）を別の位置に複製する、数値を
`1.0`、`1e2`、`-0`、`0.1`、`2^64`、`1e400` などとして書き換える、RFC 3339 のタイムスタンプを
別のオフセット、不正な形式、遠い過去や未来で書き換える、大きすぎる
文字列（64 KiB または 1 MiB）、100 段に入れ子にした値、そして再帰的な
キーの並べ替え（これは決して判定を変えてはならず、シードのベースラインの判定と比較されます）。
JavaScript が表現できない数値は、シリアライズしたテキストにそのまま埋め込まれるため、
すべてのパーサーが同じバイト列を見ます。

<a id="findings"></a>

## 発見

各発見は `findings/<seed>-<iteration>.json` に書かれ（このディレクトリは
`.gitkeep` を除いて Git に無視されます）、シードの名前、変異の経路、
変異体の正確なテキスト、そして食い違ったモードごとの 4 つの判定を含みます：

```json
{
  "seed": "1",
  "iteration": 42,
  "seed_name": "bundle_vectors.signed_bundle",
  "mutations": [{ "mutator": "set_null", "detail": "bundle.audit_entries" }],
  "verdicts": {
    "default": {
      "ts": { "valid": false, "errors": ["..."] },
      "py": { "crash": "exit 1: ..." },
      "go": { "valid": false, "errors": ["..."] },
      "rust": { "valid": false, "errors": ["..."] }
    }
  },
  "mutant_json": "{...}"
}
```

発見は手がかりであって、まだバグではありません。まず再現させてください。正確な変異体で
再現する不一致やクラッシュは、解決すべき食い違いです。時間切れ、ツールチェーンやマシンの
クラッシュ、再現しない結果は、そうでないと示されるまではインフラの問題です。再現手順を最小化し、
どの SDK が正しいかを、規範的な要件
（`spec/VERIFICATION.md`、正規化のプロファイル）と共有のフィクスチャー
（`tests/interop/v2/`）から判断してください。それらで決着しない場合、それは仕様にとっての
未解決の問題であって、選ぶべき修正ではありません。フェイルクローズの判定を既定で採用するのではなく、
記録してください。誤っている SDK は、その SDK の単体テストを先に書いて修正し、一致させるために
検証器を弱めることは決してしないでください。正確な変異体は、1 つのシムを通して
再実行できます：

```bash
node -e 'console.log(require("./tools/difffuzz/findings/1-42.json").mutant_json)' | node tools/difffuzz/shims/ts/verify.mjs
```

<a id="shims"></a>

## シム

`shims/` の下の各シムは、stdin から 1 つの JSON の文書を読み、stdout に 1 行の JSON
`{"valid": bool, "errors": [string]}` を書きます。終了コードは、判定なら 0、
クラッシュならそれ以外です。`--loop` を付けると、1 行に 1 つの圧縮した文書を読み、
それぞれに答えます。ドライバーはこの方法で実行します（SDK とモードごとに長く動く
プロセスを 1 つ持ち、クラッシュや時間切れの後に再起動します）。最初の
位置引数がモードを選びます（「ポリシー」で説明したとおり）。SDK の JSON パーサーが
拒否する文書は、`valid: false` の判定です。

## CI

`.github/workflows/difffuzz.yml` は、各プルリクエストで 300 回、
毎晩 3000 回の反復を実行し、`workflow_dispatch` では `iterations` と `seed` の入力を受け取ります。
ジョブが失敗すると、発見は `difffuzz-findings` のアーティファクトとしてアップロードされます。
