<sub>[English](../../../spec/DCP-01.md) · **中文** · [Español](../../es/spec/DCP-01.md) · [日本語](../../ja/spec/DCP-01.md) · [Português](../../pt-BR/spec/DCP-01.md)</sub>

<a id="dcp-01--identity--principal-binding"></a>
<a id="dcp-01-identity-principal-binding"></a>

# DCP-01 — 身份与委托人绑定

> 本文是[英文规范](../../../spec/DCP-01.md)的参考译文，更新于 25/10/2026。**具有规范效力的是英文版**：本译文不具规范效力，如有出入，以英文版为准。标识符和代码块保持原文，不作翻译。

人先于代理。没有明确绑定到承担责任的个人或法律实体，任何代理都不存在。DCP-01 定义了将代理身份与人类身份绑定的工件。

<a id="normative-artifacts"></a>

## 规范性工件

| 工件 | 说明 | Schema |
|----------|-------------|--------|
| **Responsible Principal Record（RPR）** | 声明个人或组织是谁、司法管辖区、责任模式和有效期的记录。 | `schemas/v1/responsible_principal_record.schema.json` |
| **Agent Passport（AP）** | 代理护照：身份、公钥、对 RPR 的引用、状态（active/revoked/suspended）。 | `schemas/v1/agent_passport.schema.json` |
| **Revocation Record** | 代理吊销的记录：谁吊销、何时、原因。 | `schemas/v1/revocation_record.schema.json` |

schema 的 **$id**：`https://dcp-ai.org/schemas/v1/<name>.schema.json`

<a id="validation"></a>

## 校验

按其 schema 校验一个对象：

```bash
dcp validate schemas/v1/responsible_principal_record.schema.json <hbr.json>
dcp validate schemas/v1/agent_passport.schema.json <ap.json>
dcp validate schemas/v1/revocation_record.schema.json <revocation.json>
```

Citizenship Bundle（包含 RPR 和 AP）用以下命令校验：

```bash
dcp validate-bundle <citizenship_bundle.json>
```

<a id="examples"></a>

## 示例

- [tests/conformance/examples/responsible_principal_record.json](../../../tests/conformance/examples/responsible_principal_record.json)
- [tests/conformance/examples/agent_passport.json](../../../tests/conformance/examples/agent_passport.json)

字段和枚举值以 JSON Schema 为准；本文档是引用它们的规范性规范。

---

<a id="jurisdiction-attestation-optional"></a>

## 司法管辖区证明（可选）

**司法管辖区证明**是一个可选对象，用于证明某个代理的 Responsible Principal Record 在特定司法管辖区内有效。它由司法管辖区机构（政府、监管机构或经认可的签发方）出具，可以包含在 Signed Bundle 中，也可以与之一同出示。

<a id="object-format"></a>

### 对象格式

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

### 字段

| 字段 | 类型 | 说明 |
|-------|------|-------------|
| `type` | string | 始终为 `"jurisdiction_attestation"`。 |
| `issuer` | string | 签发机构的标识符。 |
| `jurisdiction` | string | ISO 3166-1 alpha-2 国家代码（例如 `"US"`、`"EU"`、`"JP"`）。 |
| `rpr_hash` | string | `sha256:<hex>` — 被证明的 Responsible Principal Record 的规范 JSON 的 SHA-256。 |
| `agent_id` | string | Agent Passport 中的 agent_id。 |
| `attested_at` | string | 证明签发时的 ISO 8601 日期时间。 |
| `expires_at` | string 或 null | 证明过期时的 ISO 8601 日期时间；不过期时为 `null`。 |
| `signature` | object | 对除 `signature` 本身以外所有字段的规范 JSON 的 Ed25519 签名。`alg`、`public_key_b64`、`sig_b64`。 |

<a id="how-it-works"></a>

### 工作方式

1. 代理的创建者（或代理持有人）计算 `rpr_hash` = SHA-256(canonical(responsible_principal_record))。
2. 创建者把 `rpr_hash` + `agent_id` 提交给该司法管辖区的证明服务（或通过现场 / 线下流程）。
3. 机构核实 RPR（身份、司法管辖区、有效期）并对证明签名。
4. 证明返回给代理持有人，与 Signed Bundle 一起保存或保存在其中。

<a id="verification"></a>

### 验证

验证器通过以下方式检查证明：

1. 根据 bundle 的 `responsible_principal_record` 计算 `rpr_hash`，并与证明中的 `rpr_hash` 比较。
2. 用签发方的公钥（从该司法管辖区的 well-known URL 或受信任的签发方密钥集合获得）验证 Ed25519 签名。
3. 检查 `attested_at` 在过去，且 `expires_at` 为 `null` 或在未来。

见 [VERIFICATION.md](../../../spec/VERIFICATION.md) 第 10 步。

<a id="issuer-public-keys"></a>

### 签发方公钥

协议建议（但不强制）司法管辖区在 well-known URL 上发布其证明公钥：

`https://<authority>/.well-known/dcp-attestation-keys.json`

格式：

```json
{
  "issuer": "authority-us-ai-registry",
  "jurisdiction": "US",
  "keys": [
    { "key_id": "key-2026-01", "public_key_b64": "...", "valid_from": "2026-01-01T...", "valid_until": "2027-01-01T..." }
  ]
}
```

这只是一个约定；任何分发签发方密钥的方法都可以接受（点对点、注册表、well-known URL 等）。

---

<a id="jurisdictional-revocation-list"></a>

## 司法管辖区吊销列表

司法管辖区可以发布**已签名的吊销列表**：一个列出在该司法管辖区内已被吊销的代理的 JSON 文件。格式、发布约定以及验证器如何使用它，见 [docs/STORAGE_AND_ANCHORING.md](../../../docs/STORAGE_AND_ANCHORING.md)。

---

<a id="reference"></a>

## 参考

- 验证清单：[VERIFICATION.md](../../../spec/VERIFICATION.md)
- 存储与锚定（吊销列表、透明日志）：[docs/STORAGE_AND_ANCHORING.md](../../../docs/STORAGE_AND_ANCHORING.md)

<a id="implementation-notes-informative"></a>

## 实现说明（参考性）

> **2026 年 10 月 25 日添加。非规范性。** 这些说明不增加任何要求，也不改变上文任何内容：它们描述 `main` 上的参考代码
> 与本文的关系。两者不一致时，以上文的规范性文本为准。

- 上面的工件和命令是 **V1** 的（`schemas/v1/`）。V2 的 RPR 和护照
  （`schemas/v2/`，在 [DCP-AI v2.0](../../../spec/DCP-AI-v2.0.md) 中规定）带有密钥列表（`binding_keys`、`keys`）、
  `session_nonce` 以及 `SignedPayload` 封装中的复合签名；V2 护照增加了 DCP-05 的生命周期状态
  和可选的 `emergency_revocation_token`。
- `<hbr.json>`、`<ap.json>` 以及其他尖括号中的名称是你自己文件的占位符。
- 上面展示的司法管辖区证明对象没有 V1 JSON Schema。
  `schemas/v2/jurisdiction_attestation.schema.json` 定义了一种 V2 形式，它要求 `dcp_version` 和 `composite_sig`，
  并且由于 `additionalProperties: false`，不允许上面展示的 `signature` 成员。参考验证器
  （`lib/verify.js`、SDK 验证器、`dcp verify-bundle`）不检查证明；使用证明的验证器需自行执行
  本节的检查。
- `schemas/v1/signed_bundle.schema.json` 和 `schemas/v2/signed_bundle.schema.json` 都只允许 `bundle` 和
  `signature`（`additionalProperties: false`）。按照当前的形式，证明与 Signed Bundle 一同传递、
  单独出示；把它作为额外成员加入会使 Signed Bundle 无法通过 schema 校验。
