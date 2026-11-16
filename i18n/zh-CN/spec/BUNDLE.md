<sub>[English](../../../spec/BUNDLE.md) · **中文** · [Español](../../es/spec/BUNDLE.md) · [日本語](../../ja/spec/BUNDLE.md) · [Português](../../pt-BR/spec/BUNDLE.md)</sub>

<a id="bundle--citizenship-bundle--signed-bundle"></a>

# Bundle — Citizenship Bundle 与 Signed Bundle

> 本文是[英文规范](../../../spec/BUNDLE.md)的参考译文，更新于 25/10/2026。**具有规范效力的是英文版**：本译文不具规范效力，如有出入，以英文版为准。标识符和代码块保持原文，不作翻译。

代理并不是在真空中运行：它带着身份、声明的意图、策略决定和可审计的记录运行。**Citizenship Bundle** 是把这些汇集在一起的可移植数据包。**Signed Bundle** 使其可通过密码学验证。

<a id="citizenship-bundle-l3-bundle"></a>

## Citizenship Bundle（L3 bundle）

Citizenship Bundle 是一个恰好包含以下内容的 JSON 对象：

- `responsible_principal_record` — DCP-01（RPR）
- `agent_passport` — DCP-01（AP）
- `intent` — DCP-02
- `policy_decision` — DCP-02
- `audit_entries` — DCP-03（数组，至少一个元素）

**规范性 schema：** `schemas/v1/citizenship_bundle.schema.json`  
**$id：** `https://dcp-ai.org/schemas/v1/citizenship_bundle.schema.json`

**校验：**

```bash
dcp validate-bundle <bundle.json>
```

或直接按 bundle schema 校验该对象：

```bash
dcp validate schemas/v1/citizenship_bundle.schema.json <bundle.json>
```

**示例：** [tests/conformance/examples/citizenship_bundle.json](../../../tests/conformance/examples/citizenship_bundle.json)

---

## Signed Bundle

Signed Bundle 用一个 Ed25519 签名和确定性哈希包装 Citizenship Bundle：

- `bundle` — 完整的 Citizenship Bundle 对象
- `signature` — 一个对象，包含：
  - `alg`：`"ed25519"`
  - `created_at`：ISO 8601 日期时间
  - `signer`：`{ type: "human"|"organization", id, public_key_b64 }`
  - `bundle_hash`：`sha256:<hex>` — bundle 规范化 JSON 的 SHA-256
  - `merkle_root`：`sha256:<hex>` 或 `null` — `audit_entries` 的 Merkle 根（可选）
  - `sig_b64`：Base64 编码的签名

**规范性 schema：** `schemas/v1/signed_bundle.schema.json`  
**$id：** `https://dcp-ai.org/schemas/v1/signed_bundle.schema.json`

**校验（schema + 签名）：**

```bash
dcp verify-bundle <bundle.signed.json> <public_key.txt>
```

**辅助命令：**

```bash
dcp bundle-hash <bundle.json>        # Prints bundle_hash (sha256:...)
dcp merkle-root <bundle.json>       # Prints merkle_root of audit_entries or null
dcp sign-bundle <bundle.json> <secret_key.txt> [out.json]
dcp keygen [out_dir]
```

**示例：** [tests/conformance/examples/citizenship_bundle.signed.json](../../../tests/conformance/examples/citizenship_bundle.signed.json)

**V2 bundle**（`bundle.dcp_bundle_version: "2.0"`）使用 `schemas/v2/signed_bundle.schema.json`：每个工件都是 `SignedPayload`，Ed25519 + ML-DSA-65 复合签名覆盖 bundle 的 `manifest`。见 [VERIFICATION.md](../../../spec/VERIFICATION.md) 中的 V2 清单。

```bash
dcp sign-bundle --composite <bundle_v2.json> <ed25519_secret_key.txt> <ml_dsa_65_secret_key.txt> [out.json]
dcp verify-bundle [--policy <mode>] <signed_bundle_v2.json> [public_key.txt]   # key pins the classical signer
```

---

<a id="verification-checklist"></a>

## 验证清单

规范性的逐步验证清单（schema、签名、过期、吊销、intent_hash、审计链、Merkle、可选的锚定）见 [VERIFICATION.md](../../../spec/VERIFICATION.md)。所有步骤都在本地完成；不需要调用任何服务器。

<a id="implementation-notes-informative"></a>

## 实现说明（参考性）

> **2026 年 10 月 25 日添加。非规范性。** 这些说明不增加任何要求，也不改变上文任何内容：它们描述 `main` 上的参考代码
> 与本文的关系。两者不一致时，以上文的规范性文本为准。

- 在 V2 中，只有四个主要工件（RPR、护照、意图和策略决定）是 `SignedPayload` 封装；
  审计条目是普通对象，由清单的 Merkle 根承诺，并由 bundle 对清单的签名所覆盖，
  而不是逐一签名。
- V1 Citizenship Bundle 至少需要一个审计条目；V2 bundle 可以有空的审计轨迹（其 Merkle 根为
  64 个零），这是 [VERIFICATION.md](../../../spec/VERIFICATION.md) 所允许的。
- 通过验证的 bundle 是一致的，并由它列出的密钥签名；仅凭这一点并不能确定委托人是谁，
  也不能准入该 bundle 或授权某项操作（[docs/ADMISSION.md](../../../docs/ADMISSION.md)）。
- `<bundle.json>` 以及其他尖括号中的名称是你自己文件的占位符。
