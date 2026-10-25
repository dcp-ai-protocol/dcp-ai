<sub>[English](DCP-01.md) · [中文](DCP-01.zh-CN.md) · [Español](DCP-01.es.md) · **日本語** · [Português](DCP-01.pt-BR.md)</sub>

<a id="dcp-01--identity--principal-binding"></a>
<a id="dcp-01-identity-principal-binding"></a>

# DCP-01 — アイデンティティとプリンシパルへの結び付け

> [英語の仕様](DCP-01.md)の参考訳です（25/10/2026 更新）。**規範となるのは英語版です**。この翻訳に規範的な効力はなく、内容が異なる場合は英語版が優先されます。識別子とコードブロックは翻訳せずにそのまま掲載しています。

人がエージェントに先立ちます。責任を負う人または法人への明示的な結び付けなしに、エージェントは存在しません。DCP-01 は、エージェントのアイデンティティを人のアイデンティティに結び付けるアーティファクトを定義します。

<a id="normative-artifacts"></a>

## 規範的なアーティファクト

| アーティファクト | 説明 | スキーマ |
|----------|-------------|--------|
| **Responsible Principal Record（RPR）** | 人や組織が誰か、管轄区域、責任の形態、有効性を宣言する記録。 | `schemas/v1/responsible_principal_record.schema.json` |
| **Agent Passport（AP）** | エージェントのパスポート：アイデンティティ、公開鍵、RPR への参照、状態（active/revoked/suspended）。 | `schemas/v1/agent_passport.schema.json` |
| **Revocation Record** | エージェントの失効の記録：誰が、いつ、なぜ失効させるか。 | `schemas/v1/revocation_record.schema.json` |

スキーマの **$id**：`https://dcp-ai.org/schemas/v1/<name>.schema.json`

<a id="validation"></a>

## 検証

オブジェクトをそのスキーマに照らして検証します：

```bash
dcp validate schemas/v1/responsible_principal_record.schema.json <hbr.json>
dcp validate schemas/v1/agent_passport.schema.json <ap.json>
dcp validate schemas/v1/revocation_record.schema.json <revocation.json>
```

Citizenship Bundle（RPR と AP を含む）は次で検証します：

```bash
dcp validate-bundle <citizenship_bundle.json>
```

<a id="examples"></a>

## 例

- [tests/conformance/examples/responsible_principal_record.json](../tests/conformance/examples/responsible_principal_record.json)
- [tests/conformance/examples/agent_passport.json](../tests/conformance/examples/agent_passport.json)

フィールドと列挙値の正となるのは JSON Schema です。この文書は、それらを参照する規範的な仕様です。

---

<a id="jurisdiction-attestation-optional"></a>

## 管轄区域の証明（省略可能）

**管轄区域の証明**は、エージェントの Responsible Principal Record が特定の管轄区域で有効であることを証明する、省略可能なオブジェクトです。管轄区域の権限者（政府、規制機関、または認定された発行者）が作り、Signed Bundle に含めるか、それと一緒に提示することができます。

<a id="object-format"></a>

### オブジェクトの形式

```json
{
  "type": "jurisdiction_attestation",
  "issuer": "authority-us-ai-registry",
  "jurisdiction": "US",
  "rpr_hash": "sha256:<hex>",
  "agent_id": "agent-uuid-here",
  "attested_at": "2026-02-07T00:00:00Z",
  "expires_at": "2027-02-07T00:00:00Z",
  "signature": {
    "alg": "ed25519",
    "public_key_b64": "...",
    "sig_b64": "..."
  }
}
```

<a id="fields"></a>

### フィールド

| フィールド | 型 | 説明 |
|-------|------|-------------|
| `type` | string | 常に `"jurisdiction_attestation"`。 |
| `issuer` | string | 発行する権限者の識別子。 |
| `jurisdiction` | string | ISO 3166-1 alpha-2 の国コード（たとえば `"US"`、`"EU"`、`"JP"`）。 |
| `rpr_hash` | string | `sha256:<hex>` — 証明する Responsible Principal Record の正規の JSON の SHA-256。 |
| `agent_id` | string | Agent Passport の agent_id。 |
| `attested_at` | string | 証明が発行された ISO 8601 の日時。 |
| `expires_at` | string または null | 証明の期限が切れる ISO 8601 の日時。期限がない場合は `null`。 |
| `signature` | object | `signature` 自体を除くすべてのフィールドの正規の JSON に対する Ed25519 の署名。`alg`、`public_key_b64`、`sig_b64`。 |

<a id="how-it-works"></a>

### 仕組み

1. エージェントの作成者（またはエージェントを保持する者）が `rpr_hash` = SHA-256(canonical(responsible_principal_record)) を計算します。
2. 作成者は `rpr_hash` + `agent_id` を管轄区域の証明のサービス（または対面やオフラインの手続き）に提出します。
3. 権限者は RPR（アイデンティティ、管轄区域、有効性）を確認し、証明に署名します。
4. 証明はエージェントを保持する者に返され、Signed Bundle と一緒に、またはその中に保存されます。

<a id="verification"></a>

### 検証

検証器は次のようにして証明を確認します：

1. バンドルの `responsible_principal_record` から `rpr_hash` を計算し、証明の `rpr_hash` と比べる。
2. 発行者の公開鍵（管轄区域の well-known の URL、または信頼する発行者の鍵の集合から得る）で Ed25519 の署名を検証する。
3. `attested_at` が過去で、`expires_at` が `null` か未来であることを確認する。

[VERIFICATION.md](VERIFICATION.md) の手順 10 を参照してください。

<a id="issuer-public-keys"></a>

### 発行者の公開鍵

プロトコルは、管轄区域が証明の公開鍵を well-known の URL で公開することを推奨しています（義務ではありません）：

`https://<authority>/.well-known/dcp-attestation-keys.json`

形式：

```json
{
  "issuer": "authority-us-ai-registry",
  "jurisdiction": "US",
  "keys": [
    { "key_id": "key-2026-01", "public_key_b64": "...", "valid_from": "2026-01-01T...", "valid_until": "2027-01-01T..." }
  ]
}
```

これは慣習であり、発行者の鍵を配布する方法はどれでもかまいません（ピア、レジストリ、well-known の URL など）。

---

<a id="jurisdictional-revocation-list"></a>

## 管轄区域の失効のリスト

管轄区域は、その管轄区域で失効したエージェントを列挙する JSON のファイルである、**署名された失効のリスト**を公開することができます。形式、公開の慣習、検証器がそれをどう使うかは [docs/STORAGE_AND_ANCHORING.md](../docs/STORAGE_AND_ANCHORING.md) を参照してください。

---

<a id="reference"></a>

## 参照

- 検証のチェックリスト：[VERIFICATION.md](VERIFICATION.md)
- 保存とアンカリング（失効のリスト、透明性ログ）：[docs/STORAGE_AND_ANCHORING.md](../docs/STORAGE_AND_ANCHORING.md)

<a id="implementation-notes-informative"></a>

## 実装に関する注記（参考）

> **2026 年 10 月 25 日に追加。規範的ではありません。** これらの注記は要件を加えず、上の内容を何も変えません。`main` のリファレンスの
> コードがこの文書とどう関係するかを説明するものです。食い違う場合は、上の規範的な本文がそのまま有効です。

- 上のアーティファクトとコマンドは **V1** のもの（`schemas/v1/`）です。V2 の RPR とパスポート
  （`schemas/v2/`、[DCP-AI v2.0](DCP-AI-v2.0.md) で規定）は、鍵のリスト（`binding_keys`、`keys`）、
  `session_nonce`、`SignedPayload` のエンベロープの中の複合署名を持ちます。V2 のパスポートは DCP-05 のライフサイクルの
  状態と、省略可能な `emergency_revocation_token` を加えます。
- `<hbr.json>`、`<ap.json>` など山かっこで囲んだ名前は、自分のファイルのためのプレースホルダーです。
- 上に示した管轄区域の証明のオブジェクトには、V1 の JSON Schema がありません。
  `schemas/v2/jurisdiction_attestation.schema.json` は `dcp_version` と `composite_sig` を必須とする V2 の形を定義しており、
  `additionalProperties: false` により、上に示した `signature` のメンバーを認めません。リファレンスの検証器
  （`lib/verify.js`、SDK の検証器、`dcp verify-bundle`）は証明を確認しません。それを使う検証器は、
  この節の確認を自ら行います。
- `schemas/v1/signed_bundle.schema.json` と `schemas/v2/signed_bundle.schema.json` はどちらも `bundle` と
  `signature` だけを認めます（`additionalProperties: false`）。現在の形では、証明は Signed Bundle とは別に
  提示され、それと一緒に運ばれます。追加のメンバーとして加えると、Signed Bundle はスキーマの検証を通りません。
