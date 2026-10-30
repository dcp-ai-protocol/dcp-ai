<sub>[English](../../../spec/CANONICALIZATION_PROFILE.md) · [中文](../../zh-CN/spec/CANONICALIZATION_PROFILE.md) · [Español](../../es/spec/CANONICALIZATION_PROFILE.md) · **日本語** · [Português](../../pt-BR/spec/CANONICALIZATION_PROFILE.md)</sub>

<a id="dcp-ai-canonicalization-profile"></a>

# DCP-AI の正規化のプロファイル

> [英語の仕様](../../../spec/CANONICALIZATION_PROFILE.md)の参考訳です（25/10/2026 更新）。**規範となるのは英語版です**。この翻訳に規範的な効力はなく、内容が異なる場合は英語版が優先されます。識別子とコードブロックは翻訳せずにそのまま掲載しています。

**プロファイルの識別子：** `dcp-jcs-v1`
**状態：** 公開済み — v2.0
**最初に含まれたバージョン：** Python 2.8.0、Rust 2.8.0、Go v2.8.0、TypeScript 2.1.0

この文書は、DCP-AI におけるバイト単位で正確な JSON の
正規化の規範的な参照です。`spec/DCP-AI-v2.0.md` § 15 にあった 5 項目の要約に
取って代わります。DCP のアーティファクトのすべての署名、すべてのハッシュ、
すべての Merkle の葉は、ここで規定するアルゴリズムの出力に対して計算されます。

このプロファイルは **RFC 8785（JCS）に基づいています**。数値を整数に限り
（規則 4）、JCS が実装に委ねている場合を明示的に扱います。JCS の厳密な部分集合ではありません。規則 1 は
オブジェクトのキーを Unicode のコードポイント順に並べますが、RFC 8785 §3.2.3 は
UTF-16 のコード単位で並べます。2 つの順序が異なるのは、オブジェクトのキーが補助面の
文字（U+10000 以上）と U+E000..U+FFFF の文字を混ぜて含む場合だけです。プロファイルへの適合を主張する SDK は、
§3 の境界のケースの表について、バイト単位で同一の出力を生成しなければなりません（MUST）。

---

<a id="1-why-a-profile-and-not-just-jcs"></a>

## 1. なぜ単なる「JCS」ではなくプロファイルなのか

RFC 8785 は構造の規則（キーの並べ替え、コンパクトな形式、文字列の
エスケープ、数値の表現）を定めますが、いくつかの判断を生成側の
ホストの言語に委ねています。`undefined` をどう扱うか、整数の値を持つ
float をどうするか、`1e2` を正規化するか、`null` に相当するホストの型を JSON の `null` にどう対応させるか、です。4 つの SDK
（TypeScript、Python、Rust、Go）では、それらの既定が食い違い、同じ元のオブジェクトから
異なるバイト列を生成します。`dcp-jcs-v1` はそれらの判断をそれぞれ固定し、
4 つの SDK が同一の出力を生成するようにします。

---

<a id="2-normative-rules"></a>

## 2. 規範的な規則

`dcp-jcs-v1` を実装する生成側は、規則 1 から 8 を守らなければなりません（MUST）。
`dcp-jcs-v1` を利用する検証器は、出力がこれらの規則から外れるアーティファクトを
拒否するべきです（SHOULD）。

<a id="rule-1--sorted-keys"></a>
<a id="rule-1-sorted-keys"></a>

### 規則 1 — キーの並べ替え

オブジェクトのキーは、Unicode のコードポイントの昇順で辞書順に並べます。
並べ替えはすべての入れ子の深さで行います。

```
input    → {"z": 1, "a": 2, "é": 3, "e": 4}
output   → {"a":2,"e":4,"z":1,"é":3}
```

<a id="rule-2--compact-form"></a>
<a id="rule-2-compact-form"></a>

### 規則 2 — コンパクトな形式

文字列の値の外には空白を一切入れません。組の区切りは `,`、
キーと値の区切りは `:` です。末尾のカンマはありません。

<a id="rule-3--string-escaping"></a>
<a id="rule-3-string-escaping"></a>

### 規則 3 — 文字列のエスケープ

文字列は UTF-8 で符号化します。エスケープは RFC 8785 §3.2 に従います。エスケープするのは
JSON がエスケープを求める文字（制御文字 U+0000 から
U+001F、`"`、`\`）だけです。スラッシュ、ASCII でない
文字、絵文字、漢字などは、その UTF-8 のバイト列としてそのまま出力します。

```
input    → {"emoji": "🔑", "kanji": "鍵"}
output   → {"emoji":"🔑","kanji":"鍵"}
```

<a id="rule-4--numeric-values-integer-only"></a>
<a id="rule-4-numeric-values-integer-only"></a>

### 規則 4 — 数値：整数のみ

この形式は、値が正確な整数である数値だけを受け入れます。
「正確な整数」は**解析の後に**決めます：

- JSON の `Number` は、(a) 有限で、かつ (b) その値に小数部がない
  （`floor(n) == n`）場合に限り有効です。
- 元のリテラルが `1.0`、`1.00`、`1e2`、`100`、または
  `-0` であった `Number` は有効です。それらのリテラルはどれも、解析の後に整数の値に
  復号されるからです。
- 値が `0.1`、`1.5`、`1e-1`、`NaN`、または `±Infinity` である `Number` は
  無効で、正規化器はどの出力も生成する前にエラーを発生させなければなりません（MUST）。

出力の正規化：有効な数値はすべて単純な整数の形で出力し、
小数点も指数も、先頭のゼロ（`0` を除く）も、末尾のゼロも付けません。

```
{"n": 1.0}    → {"n":1}
{"n": 1e2}    → {"n":100}
{"n": -0}     → {"n":0}
{"n": 0.1}    → ERROR
{"n": NaN}    → ERROR
```

この規則が 4 つの SDK を一致させます。JavaScript の生成側は
`1.0` をリテラルとして渡せ（整数の型がない）、Python の生成側は
`int(100)` を渡せ、Go の生成側は JSON から解析した `1e2` を渡せ、
4 つすべてが同じバイト列を出力します。

<a id="rule-5--null-preservation"></a>
<a id="rule-5-null-preservation"></a>

### 規則 5 — null の保持

JSON の `null` の値は、そのキーとともに保持しなければなりません（MUST）：

```
input    → {"x": null, "y": 1}
output   → {"x":null,"y":1}
```

配列の中の null はその位置を保ちます：

```
input    → [1, null, 3]
output   → [1,null,3]
```

<a id="rule-6--null-and-undefined-handling-cross-language"></a>
<a id="rule-6-null-and-undefined-handling-cross-language"></a>

### 規則 6 — null と undefined の扱い（言語をまたいで）

JSON には値がないことを表す経路が 1 つしかありません（`null`）。ホストの言語にはそれより多くあります。
`undefined` と `null` を区別するホストの言語は TypeScript だけで、Python、Go、Rust は区別しません。
正規化器は、ホストの各値を次のように扱わなければなりません（MUST）：

| ホストの言語 | ホストの値                                          | オブジェクトのキーで | 配列の位置で |
|---------------|-----------------------------------------------------|------------------|------------------|
| TypeScript    | `undefined`                                         | **キーを省く** | `null` を出力      |
| TypeScript    | `null`                                              | `null` を出力      | `null` を出力      |
| Python        | キーがない                                          | **キーを省く** | n/a              |
| Python        | `None`                                              | `null` を出力      | `null` を出力      |
| Go            | マップのエントリーがない                            | **キーを省く** | n/a              |
| Go            | `nil` のインターフェース / 明示的な JSON の null    | `null` を出力      | `null` を出力      |
| Rust          | `skip_serializing_if=None` で欠けた構造体のフィールド | **キーを省く** | n/a              |
| Rust          | skip なしでシリアライズした `Option::None`          | `null` を出力      | `null` を出力      |
| Rust          | `Value::Null`                                       | `null` を出力      | `null` を出力      |

```
input    → { a: 1, b: undefined, c: 3 }   (TS)
output   → {"a":1,"c":3}

input    → [1, undefined, 3]              (TS)
output   → [1,null,3]

input    → {"a": 1, "b": None, "c": 3}    (Python)
output   → {"a":1,"b":null,"c":3}
```

これは意図的に非対称です。TypeScript では、キーがないオブジェクトと
`b: undefined` を持つオブジェクトは同じ出力を生成します。JSON が「ない」と「undefined の値」を
区別して表せないことに合わせたものです。配列の中では位置に意味があるため、
`undefined` は `null` として具体化されます。

SDK は、ホストの言語にない `undefined` の経路を作り出してはなりません（MUST NOT）。
Python の `None`、解析で JSON の null を生んだインターフェース型の Go の `nil`、
Rust の `Value::Null` は、すべて JSON の `null` に対応します。

<a id="rule-7--booleans"></a>
<a id="rule-7-booleans"></a>

### 規則 7 — 真偽値

真偽値はリテラルの `true` と `false` として出力します。

```
input    → {"t": true, "f": false}
output   → {"f":false,"t":true}
```

<a id="rule-8--empty-containers"></a>
<a id="rule-8-empty-containers"></a>

### 規則 8 — 空のコンテナー

空のオブジェクトは `{}` を、空の配列は `[]` を出力します。どちらも
省きません。

```
input    → {}
output   → {}

input    → []
output   → []
```

<a id="rule-9--unicode-normalization-is-out-of-scope"></a>
<a id="rule-9-unicode-normalization-is-out-of-scope"></a>

### 規則 9 — Unicode の正規化は範囲外

文字列は、規則 3 のエスケープの規則に従った UTF-8 のバイト列として出力し、
Unicode の正規化（NFC、NFD、NFKC、NFKD）は**一切行いません**。合成済みの文字列 `"é"`
（U+00E9）を与える生成側と、分解した並び
`"e"` + `U+0301` を与える生成側は、2 つの文字列が同じに表示され、正準等価のもとで等しくても、
**異なるバイト列**を生成します。

これは意図的に決めないことにしたものです。正規化のレイヤーで正規化の形式を求めると、
すべての SDK に ICU や Unicode の表に相当する依存関係を持たせることになり、
それでもどの形式（NFC か NFKC か）を採るかは決まりません。ホモグラフへの耐性を
重視するアプリケーションは、値を正規化器に渡す**前に**文字列を正規化しなければなりません（MUST）
（通信路上の JSON の交換では NFC が慣例的な選択です — RFC 8259 § 8.1）。

将来のプロファイル（`dcp-jcs-v2` 以降）は正規化の形式を固定してもかまいません（MAY）。
その判断は独自のプロファイルの文書に置かれます。

> `NaN` / `±Infinity` についての注記：これらの値は RFC 8259 の JSON の
> 形式には含まれません。ほとんどの JSON のパーサーは解析の時点でそれらを拒否するため、
> 正規化器がそれらを見ることはありません。パーサーがそれらを受け入れる場合
> （たとえば既定で受け入れる Python の `json.loads("NaN")`、JavaScript で手作りした
> 値）でも、規則 4 は解析の後にそれらを拒否します。相互運用のフィクスチャーは、
> 移植可能な JSON の構文でそれらを表せないため、意図的に NaN/Infinity のベクターを含んでいません。拒否は SDK ごとの
> 単体テストで確認します（たとえば `sdks/rust/src/v2/canonicalize.rs` の `test_rejects_non_finite`）。

---

<a id="3-edge-case-acceptance-table"></a>

## 3. 境界のケースの受け入れの表

プロファイルが形式化される前に SDK の間で食い違っていたケースです。
プロファイルに適合する SDK は、この表のすべてのセルに一致しなければなりません（MUST）。

| 入力（JSON のリテラル） | 出力 | 注記 |
|---|---|---|
| `null` | `null` | 規則 5 |
| `true` | `true` | 規則 7 |
| `false` | `false` | 規則 7 |
| `0` | `0` | 規則 4 |
| `-0` | `0` | 規則 4、符号を正規化 |
| `1` | `1` | 規則 4 |
| `1.0` | `1` | 規則 4、整数の値の float |
| `1.00` | `1` | 規則 4、末尾のゼロ |
| `1e2` | `100` | 規則 4、整数の値の指数表記 |
| `100` | `100` | 規則 4 |
| `-42` | `-42` | 規則 4 |
| `0.1` | ERROR | 規則 4、小数の値 |
| `1.5` | ERROR | 規則 4、小数の値 |
| `1.0e-1` | ERROR | 規則 4、小数の値 |
| `NaN` | ERROR | 規則 4、有限でない |
| `Infinity` | ERROR | 規則 4、有限でない |
| `{}` | `{}` | 規則 8 |
| `[]` | `[]` | 規則 8 |
| `{"x": null, "y": 1}` | `{"x":null,"y":1}` | 規則 5 |
| `[1, null, 3]` | `[1,null,3]` | 規則 5 |
| `{"é": 1, "e": 2, "z": 3}` | `{"e":2,"z":3,"é":1}` | 規則 1、コードポイントの順序 |
| `{"a": {"b": {"c": 42}}}` | `{"a":{"b":{"c":42}}}` | 規則 1、再帰的 |
| `{"ﬁ": 1, "😀": 2, "a": 3}` | `{"a":3,"ﬁ":1,"😀":2}` | 規則 1、コードポイントの順序：U+FB01 < U+1F600（UTF-16 のコード単位の順序なら絵文字が先になる） |
| `{"s": "<a href='/x?y=1&z=2'>"}` | `{"s":"<a href='/x?y=1&z=2'>"}` | 規則 3、`<`、`>`、`&` はエスケープしない |
| `{"s": "a b c"}` | `{"s":"a` U+2028 `b` U+2029 `c"}` をエスケープしない UTF-8 で | 規則 3、行と段落の区切り文字はエスケープしない |
| `{"s": "\u0000\u0008\t\n\u000b\f\r\u001f\"\\"}` | `{"s":"\u0000\b\t\n\u000b\f\r\u001f\"\\"}` | 規則 3、RFC 8785 §3.2 の短いエスケープ、ほかの C0 の制御文字には小文字の `\u00xx` |

---

<a id="4-bundle-manifest-declaration"></a>

## 4. バンドルのマニフェストでの宣言

このプロファイルのもとで生成したバンドルは、マニフェストに最上位の
`canonicalization_profile` のフィールドを含めるべきです（SHOULD）：

```json
{
  "manifest": {
    "canonicalization_profile": "dcp-jcs-v1",
    "session_nonce": "...",
    "rpr_hash": "sha256:...",
    ...
  }
}
```

このフィールドは、プロファイルができる前に生成したバンドルとの後方互換のために省略可能です。
フィールドのないバンドルに出会った検証器は、`dcp-jcs-v1` を想定しなければなりません（MUST）
（ほかのプロファイルはまだ存在しないからです）。将来のプロファイル（`dcp-jcs-v2` など）が出たときは、
区別のためにこのフィールドが必須になります。

このフィールドは `schemas/v2/bundle_manifest.schema.json` に加えられています：

```json
"canonicalization_profile": {
  "type": "string",
  "const": "dcp-jcs-v1",
  "description": "Identifier of the canonicalization profile under which this bundle was produced."
}
```

---

<a id="5-versioning"></a>

## 5. バージョン管理

この文書はプロファイル `dcp-jcs-v1` を定義しており、それは**凍結**されています。上の規則の
どんな変更にも、新しいプロファイルの識別子が必要です。新しいプロファイルを加える
ためのガバナンス：

- 新しい入力を認める、または別の方法で正規化する変更 → 新しい
  プロファイル（たとえば `dcp-jcs-v2`）。
- 検証を厳しくするだけの変更（以前は受け入れていた入力を拒否する）→ 下流の検証器が
  足並みをそろえて更新できるかを検討し、できなければ新しいプロファイルが必要。
- 既存の動作を変えずに文書化する明確化
  → その場で更新し、同じプロファイルの ID で CHANGELOG に記録する。

将来のプロファイルが出るときは：

1. 新しいプロファイルは `spec/` に独自の文書を持つ
   （たとえば `CANONICALIZATION_PROFILE_V2.md`）。
2. SDK は README でサポートのマトリクスを公開する。
3. バンドルのマニフェストの `canonicalization_profile` は必須のフィールドになり、
   検証器はその値に基づいて適切な正規化器に振り分ける。

---

<a id="6-conformance-vectors"></a>

## 6. 適合性のベクター

共有の `tests/interop/v2/interop_vectors.json` のファイルには、§3 をテストのフィクスチャーの集合として
具体化した `canonicalization.edge_cases` のブロックがあります。4 つの SDK（TypeScript、Python、Rust、Go）は、
プロファイルへの適合を主張するには、このブロックを通らなければなりません（MUST）。

ベクターは SDK ごとの相互運用のテストが使います：

- `sdks/typescript/src/__tests__/interop.test.ts`
- `sdks/python/tests/test_interop.py`
- `sdks/rust/tests/interop.rs`
- `sdks/go/dcp/interop_test.go`

CI は、各 PR で 4 つすべてを並行して実行します。SDK の間の食い違いは
リリースを止める問題です。

---

<a id="7-references"></a>

## 7. 参考文献

- RFC 8785 — JSON Canonicalization Scheme（JCS）— 基礎の仕様。
- RFC 8259 — JSON Data Interchange Format — 通信路のレベルの文法。
- `spec/DCP-AI-v2.0.md` § 15 — プロトコルのレベルの要約。
- `schemas/v2/bundle_manifest.schema.json` — マニフェストのフィールドの宣言。
- `tests/interop/v2/interop_vectors.json#canonicalization.edge_cases` — テストのフィクスチャー。

<a id="implementation-notes-informative"></a>

## 実装に関する注記（参考）

> **2026 年 10 月 25 日に追加。規範的ではありません。** これらの注記は要件を加えず、上の内容を何も変えません。`main` のリファレンスの
> コードがこの文書とどう関係するかを説明するものです。食い違う場合は、上の規範的な本文がそのまま有効です。

- `dcp-jcs-v1` は凍結されたまま（§5）で、唯一の規範的な正規化のプロファイルであり、既定でもあります。
  識別子 `dcp-jcs-v2` は、[docs/proposals/canonicalization-candidate](../../../docs/proposals/canonicalization-candidate/README.md) で
  説明している規範的ではない候補を指し、既定の経路が呼ばない、実験的でオプトインの SDK の API があります。マニフェストのスキーマは
  引き続き `canonicalization_profile` を `dcp-jcs-v1` に固定しており、既存の V2 の検証器は候補の識別子を拒否します。
- 規則 4 は解析した値で決まるため、生成側や検証器が何を正規化するかは、その JSON のパーサーに依存します。
  パーサーは、このプロファイルが固定していない入力で異なります。繰り返されたメンバー名、孤立したサロゲートのエスケープ、先頭の
  バイトオーダーマーク、binary64 のパーサーが丸める数値のリテラル（たとえば `1.0000000000000001` は `1` と読まれる）です。
  そのため、2 つのパーサーが同じテキストを異なって正規化することがあります。候補の提案はこれらのケースを記録しています。
- 規則 9 の下の注記の例は 2026 年 10 月 25 日に修正しました。`json.loads` に `allow_nan` の引数はなく（既定で
  `NaN` を受け入れる）、`allow_nan` は `json.dumps` のものです。規則は何も変わっていません。
