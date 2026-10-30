<sub>[English](../../../spec/BUNDLE.md) · [中文](../../zh-CN/spec/BUNDLE.md) · [Español](../../es/spec/BUNDLE.md) · **日本語** · [Português](../../pt-BR/spec/BUNDLE.md)</sub>

<a id="bundle--citizenship-bundle--signed-bundle"></a>
<a id="bundle-citizenship-bundle-signed-bundle"></a>

# バンドル — Citizenship Bundle と Signed Bundle

> [英語の仕様](../../../spec/BUNDLE.md)の参考訳です（25/10/2026 更新）。**規範となるのは英語版です**。この翻訳に規範的な効力はなく、内容が異なる場合は英語版が優先されます。識別子とコードブロックは翻訳せずにそのまま掲載しています。

エージェントは真空の中で動くのではありません。アイデンティティ、宣言された意図、ポリシー判断、監査可能な記録とともに動きます。**Citizenship Bundle** は、それらすべてをまとめる持ち運べるパケットです。**Signed Bundle** はそれを暗号で検証可能にします。

<a id="citizenship-bundle-l3-bundle"></a>

## Citizenship Bundle（L3 のバンドル）

Citizenship Bundle は、ちょうど次のものを含む JSON のオブジェクトです：

- `responsible_principal_record` — DCP-01（RPR）
- `agent_passport` — DCP-01（AP）
- `intent` — DCP-02
- `policy_decision` — DCP-02
- `audit_entries` — DCP-03（配列、少なくとも 1 つの要素）

**規範的なスキーマ：** `schemas/v1/citizenship_bundle.schema.json`  
**$id：** `https://dcp-ai.org/schemas/v1/citizenship_bundle.schema.json`

**検証：**

```bash
dcp validate-bundle <bundle.json>
```

または、オブジェクトをバンドルのスキーマに照らして直接検証します：

```bash
dcp validate schemas/v1/citizenship_bundle.schema.json <bundle.json>
```

**例：** [tests/conformance/examples/citizenship_bundle.json](../../../tests/conformance/examples/citizenship_bundle.json)

---

## Signed Bundle

Signed Bundle は、Citizenship Bundle を Ed25519 の署名と決定的なハッシュで包みます：

- `bundle` — Citizenship Bundle のオブジェクト全体
- `signature` — 次を持つオブジェクト：
  - `alg`：`"ed25519"`
  - `created_at`：ISO 8601 の日時
  - `signer`：`{ type: "human"|"organization", id, public_key_b64 }`
  - `bundle_hash`：`sha256:<hex>` — バンドルの正規化した JSON の SHA-256
  - `merkle_root`：`sha256:<hex>` または `null` — `audit_entries` の Merkle ルート（省略可能）
  - `sig_b64`：Base64 の署名

**規範的なスキーマ：** `schemas/v1/signed_bundle.schema.json`  
**$id：** `https://dcp-ai.org/schemas/v1/signed_bundle.schema.json`

**検証（スキーマ + 署名）：**

```bash
dcp verify-bundle <bundle.signed.json> <public_key.txt>
```

**補助のコマンド：**

```bash
dcp bundle-hash <bundle.json>        # Prints bundle_hash (sha256:...)
dcp merkle-root <bundle.json>       # Prints merkle_root of audit_entries or null
dcp sign-bundle <bundle.json> <secret_key.txt> [out.json]
dcp keygen [out_dir]
```

**例：** [tests/conformance/examples/citizenship_bundle.signed.json](../../../tests/conformance/examples/citizenship_bundle.signed.json)

**V2 のバンドル**（`bundle.dcp_bundle_version: "2.0"`）は `schemas/v2/signed_bundle.schema.json` を使います。すべてのアーティファクトは `SignedPayload` で、Ed25519 + ML-DSA-65 の複合署名がバンドルの `manifest` を覆います。[VERIFICATION.md](../../../spec/VERIFICATION.md) の V2 のチェックリストを参照してください。

```bash
dcp sign-bundle --composite <bundle_v2.json> <ed25519_secret_key.txt> <ml_dsa_65_secret_key.txt> [out.json]
dcp verify-bundle [--policy <mode>] <signed_bundle_v2.json> [public_key.txt]   # key pins the classical signer
```

---

<a id="verification-checklist"></a>

## 検証のチェックリスト

規範的で手順を追った検証のチェックリスト（スキーマ、署名、期限、失効、intent_hash、監査チェーン、Merkle、省略可能なアンカー）は [VERIFICATION.md](../../../spec/VERIFICATION.md) を参照してください。すべての手順はローカルで、サーバーの呼び出しは必要ありません。

<a id="implementation-notes-informative"></a>

## 実装に関する注記（参考）

> **2026 年 10 月 25 日に追加。規範的ではありません。** これらの注記は要件を加えず、上の内容を何も変えません。`main` のリファレンスの
> コードがこの文書とどう関係するかを説明するものです。食い違う場合は、上の規範的な本文がそのまま有効です。

- V2 では、4 つの主なアーティファクト（RPR、パスポート、意図、ポリシー判断）だけが `SignedPayload` のエンベロープです。
  監査エントリーは単なるオブジェクトで、マニフェストの Merkle ルートで約束され、マニフェストに対するバンドルの署名で
  覆われており、1 つずつ署名されてはいません。
- V1 の Citizenship Bundle には少なくとも 1 つの監査エントリーが必要です。V2 のバンドルは、[VERIFICATION.md](../../../spec/VERIFICATION.md) が認めるとおり、
  空の監査証跡を持つことができます（その Merkle ルートは 64 個のゼロ）。
- 検証を通るバンドルは一貫しており、列挙する鍵で署名されています。それだけでは、プリンシパルが誰かは確定せず、
  バンドルを受け入れることにも、行動を認可することにもなりません（[docs/ADMISSION.md](../../../docs/ADMISSION.md)）。
- `<bundle.json>` など山かっこで囲んだ名前は、自分のファイルのためのプレースホルダーです。
