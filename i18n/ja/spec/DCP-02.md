<sub>[English](../../../spec/DCP-02.md) · [中文](../../zh-CN/spec/DCP-02.md) · [Español](../../es/spec/DCP-02.md) · **日本語** · [Português](../../pt-BR/spec/DCP-02.md)</sub>

<a id="dcp-02--intent-declaration--policy-gating"></a>
<a id="dcp-02-intent-declaration-policy-gating"></a>

# DCP-02 — 意図の宣言とポリシーによる制御

> [英語の仕様](../../../spec/DCP-02.md)の参考訳です（25/10/2026 更新）。**規範となるのは英語版です**。この翻訳に規範的な効力はなく、内容が異なる場合は英語版が優先されます。識別子とコードブロックは翻訳せずにそのまま掲載しています。

黙った行動はありません。エージェントは、行う前に何をするつもりかを宣言し、ポリシーの層が承認、エスカレート、ブロックのいずれにするかを決めます。DCP-02 は、宣言された意図とポリシー判断を定義します。

<a id="normative-artifacts"></a>

## 規範的なアーティファクト

| アーティファクト | 説明 | スキーマ |
|----------|-------------|--------|
| **Intent** | 意図の宣言：エージェント、人、行動、チャネル、データの分類、推定影響。 | `schemas/v1/intent.schema.json` |
| **PolicyDecision** | 意図に対する判断：approve / escalate / block、リスクスコア、理由。省略可能：人の確認を求める。 | `schemas/v1/policy_decision.schema.json` |
| **HumanConfirmation** | （省略可能）意図に対する人の明示的な確認：承認または拒否。 | `schemas/v1/human_confirmation.schema.json` |

スキーマの **$id**：`https://dcp-ai.org/schemas/v1/<name>.schema.json`

<a id="validation"></a>

## 検証

オブジェクトをそのスキーマに照らして検証します：

```bash
dcp validate schemas/v1/intent.schema.json <intent.json>
dcp validate schemas/v1/policy_decision.schema.json <policy_decision.json>
dcp validate schemas/v1/human_confirmation.schema.json <human_confirmation.json>
```

Citizenship Bundle には Intent と PolicyDecision が含まれます。次で検証します：

```bash
dcp validate-bundle <citizenship_bundle.json>
```

<a id="examples"></a>

## 例

- [tests/conformance/examples/intent.json](../../../tests/conformance/examples/intent.json)
- [tests/conformance/examples/policy_decision.json](../../../tests/conformance/examples/policy_decision.json)
- [tests/conformance/examples/human_confirmation.json](../../../tests/conformance/examples/human_confirmation.json)

フィールドと列挙値の正となるのは JSON Schema です。この文書は、それらを参照する規範的な仕様です。

<a id="implementation-notes-informative"></a>

## 実装に関する注記（参考）

> **2026 年 10 月 25 日に追加。規範的ではありません。** これらの注記は要件を加えず、上の内容を何も変えません。`main` のリファレンスの
> コードがこの文書とどう関係するかを説明するものです。食い違う場合は、上の規範的な本文がそのまま有効です。

- この文書とそのコマンドは **V1** のアーティファクト（`schemas/v1/`）を説明しています。その V2 の対応物
  （`schemas/v2/intent.schema.json`、`policy_decision.schema.json`、`human_confirmation.schema.json`）は、とりわけ、
  意図に `session_nonce` と `requires_consent` を、ポリシー判断に `session_nonce`、`applied_policy_hash`、
  `required_confirmation`、`timestamp` を加えます。それらは [DCP-AI v2.0](../../../spec/DCP-AI-v2.0.md) で
  規定されています。
- `<intent.json>` など山かっこで囲んだ名前は、自分のファイルのためのプレースホルダーです。
- ポリシー判断は、ポリシーの層が何を決めたかの記録です。バンドルの検証は、それが一貫していて署名されていることを
  確認するもので、判断を適用するものではありません。リファレンスの検証器は、判断が `block` だからといってバンドルを
  拒否しません。行動の前にそれを適用するのはアプリケーションの仕事です。
