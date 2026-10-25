<sub>[English](DCP-03.md) · [中文](DCP-03.zh-CN.md) · [Español](DCP-03.es.md) · **日本語** · [Português](DCP-03.pt-BR.md)</sub>

<a id="dcp-03--audit-chain--transparency"></a>
<a id="dcp-03-audit-chain-transparency"></a>

# DCP-03 — 監査チェーンと透明性

> [英語の仕様](DCP-03.md)の参考訳です（25/10/2026 更新）。**規範となるのは英語版です**。この翻訳に規範的な効力はなく、内容が異なる場合は英語版が優先されます。識別子とコードブロックは翻訳せずにそのまま掲載しています。

すべての判断とすべての結果が記録されます。監査チェーンは、エントリーを前のハッシュ（最初のものは GENESIS）でつなぎます。省略可能ですが、エントリーの上に Merkle ルートを計算することもできます。こうして追跡可能性が検証可能になります。

<a id="normative-artifacts"></a>

## 規範的なアーティファクト

| アーティファクト | 説明 | スキーマ |
|----------|-------------|--------|
| **AuditEntry** | 監査エントリー：prev_hash、timestamp、agent_id、human_id、intent_id、intent_hash、policy_decision（approved/escalated/blocked）、outcome、evidence。 | `schemas/v1/audit_entry.schema.json` |

**$id：** `https://dcp-ai.org/schemas/v1/audit_entry.schema.json`

**intent_hash：** 各 AuditEntry について、`intent_hash` は、そのエントリーが参照する Intent の正規の JSON の形の SHA-256 ハッシュに等しくなければなりません（MUST）。形式的には `intent_hash = SHA-256(canonical(intent))`（16 進の文字列）です。意図は `intent_id` で特定され、正規の形はバンドルのハッシュに使うものと同じです（たとえば `json-stable-stringify`）。計算には `dcp intent-hash <intent.json>` か、リファレンスの実装の `intentHash()` ヘルパーを使ってください。

**チェーン（prev_hash）：** 最初の監査エントリーは `prev_hash = "GENESIS"`（そのままの文字列）を持たなければなりません（MUST）。インデックス n（n ≥ 1）のエントリーでは、`prev_hash` は直前のエントリーの正規の JSON の形の SHA-256 ハッシュに等しくなければなりません（MUST）：`prev_hash = SHA-256(canonical(entry_{n-1}))`（16 進の文字列）。これによりエントリーは不変のチェーンでつながります。

**Merkle（省略可能）：** `audit_entries` の配列から、Merkle ルートを計算できます。Signed Bundle は、`signature.merkle_root` を `sha256:<hex>` または `null` として含めることができます。

<a id="validation"></a>

## 検証

監査エントリーを検証します：

```bash
dcp validate schemas/v1/audit_entry.schema.json <audit_entry.json>
```

バンドル全体を検証します（すべての audit_entries を含む）：

```bash
dcp validate-bundle <citizenship_bundle.json>
```

バンドルの audit_entries の Merkle ルートを得ます：

```bash
dcp merkle-root <citizenship_bundle.json>
```

<a id="examples"></a>

## 例

- [tests/conformance/examples/audit_entry.json](../tests/conformance/examples/audit_entry.json)
- バンドル [tests/conformance/examples/citizenship_bundle.json](../tests/conformance/examples/citizenship_bundle.json) は `audit_entries` を含みます。

フィールドと列挙値の正となるのは JSON Schema です。この文書は、それらを参照する規範的な仕様です。

<a id="implementation-notes-informative"></a>

## 実装に関する注記（参考）

> **2026 年 10 月 25 日に追加。規範的ではありません。** これらの注記は要件を加えず、上の内容を何も変えません。`main` のリファレンスの
> コードがこの文書とどう関係するかを説明するものです。食い違う場合は、上の規範的な本文がそのまま有効です。

- この文書とそのコマンドは **V1** の監査エントリー（`schemas/v1/audit_entry.schema.json`）を説明しており、その
  `intent_hash` と、最初のものより後の各エントリーの `prev_hash` は接頭辞のない 16 進の文字列です。V2（`schemas/v2/audit_entry.schema.json`、
  [DCP-AI v2.0](DCP-AI-v2.0.md) で規定）では `sha256:<hex>` と書かれます。どちらのバージョンでも、最初のエントリーの `prev_hash` はそのままの文字列
  `"GENESIS"` です。V2 のエントリーは `session_nonce`、`hash_alg`、
  `pq_checkpoint_ref` も持ち、エントリーは 1 つずつ署名されるのではなく、マニフェストの Merkle ルートで約束されます。
- これらのハッシュに使う正規の形は、プロファイル `dcp-jcs-v1`
  （[CANONICALIZATION_PROFILE.md](CANONICALIZATION_PROFILE.md)）です。上の `json-stable-stringify` はキーを並べる
  シリアライザーの例で、別のプロファイルではありません。
- チェーンは、改変、削除、並べ替えられたエントリーを検出できるようにします。エントリーを変更
  できなくするものではなく、その内容が真実かどうかについては何も示しません。
- `<audit_entry.json>` など山かっこで囲んだ名前は、自分のファイルのためのプレースホルダーです。
