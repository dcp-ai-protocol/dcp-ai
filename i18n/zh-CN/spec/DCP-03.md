<sub>[English](../../../spec/DCP-03.md) · **中文** · [Español](../../es/spec/DCP-03.md) · [日本語](../../ja/spec/DCP-03.md) · [Português](../../pt-BR/spec/DCP-03.md)</sub>

<a id="dcp-03--audit-chain--transparency"></a>
<a id="dcp-03-audit-chain-transparency"></a>

# DCP-03 — 审计链与透明性

> 本文是[英文规范](../../../spec/DCP-03.md)的参考译文，更新于 25/10/2026。**具有规范效力的是英文版**：本译文不具规范效力，如有出入，以英文版为准。标识符和代码块保持原文，不作翻译。

每个决定和每个结果都会被记录。审计链用前一个哈希（第一个为 GENESIS）连接各条目；可选地，还可以在条目之上计算 Merkle 根。由此可追溯性是可验证的。

<a id="normative-artifacts"></a>

## 规范性工件

| 工件 | 说明 | Schema |
|----------|-------------|--------|
| **AuditEntry** | 一个审计条目：prev_hash、timestamp、agent_id、human_id、intent_id、intent_hash、policy_decision（approved/escalated/blocked）、outcome、evidence。 | `schemas/v1/audit_entry.schema.json` |

**$id：** `https://dcp-ai.org/schemas/v1/audit_entry.schema.json`

**intent_hash：** 对每个 AuditEntry，`intent_hash` 必须（MUST）等于该条目所指 Intent 的规范 JSON 形式的 SHA-256 哈希。形式上：`intent_hash = SHA-256(canonical(intent))`（十六进制字符串）。意图由 `intent_id` 标识；规范形式与 bundle 哈希所用的相同（例如 `json-stable-stringify`）。可使用 `dcp intent-hash <intent.json>` 或参考实现中的 `intentHash()` 辅助函数来计算它。

**链接（prev_hash）：** 第一个审计条目必须（MUST）具有 `prev_hash = "GENESIS"`（字面字符串）。对于索引 n（n ≥ 1）处的条目，`prev_hash` 必须（MUST）等于前一条目规范 JSON 形式的 SHA-256 哈希：`prev_hash = SHA-256(canonical(entry_{n-1}))`（十六进制字符串）。这把条目连接成一条不可变的链。

**Merkle（可选）：** 给定一个 `audit_entries` 数组，可以计算 Merkle 根。Signed Bundle 可以包含 `signature.merkle_root`，取值为 `sha256:<hex>` 或 `null`。

<a id="validation"></a>

## 校验

校验一个审计条目：

```bash
dcp validate schemas/v1/audit_entry.schema.json <audit_entry.json>
```

校验完整的 bundle（包含所有 audit_entries）：

```bash
dcp validate-bundle <citizenship_bundle.json>
```

获取 bundle 的 audit_entries 的 Merkle 根：

```bash
dcp merkle-root <citizenship_bundle.json>
```

<a id="examples"></a>

## 示例

- [tests/conformance/examples/audit_entry.json](../../../tests/conformance/examples/audit_entry.json)
- bundle [tests/conformance/examples/citizenship_bundle.json](../../../tests/conformance/examples/citizenship_bundle.json) 包含 `audit_entries`。

字段和枚举值以 JSON Schema 为准；本文档是引用它们的规范性规范。

<a id="implementation-notes-informative"></a>

## 实现说明（参考性）

> **2026 年 10 月 25 日添加。非规范性。** 这些说明不增加任何要求，也不改变上文任何内容：它们描述 `main` 上的参考代码
> 与本文的关系。两者不一致时，以上文的规范性文本为准。

- 本文档及其命令描述的是 **V1** 审计条目（`schemas/v1/audit_entry.schema.json`），其
  `intent_hash` 以及第一个之后每个条目的 `prev_hash` 都是不带前缀的十六进制字符串。在 V2（`schemas/v2/audit_entry.schema.json`，在
  [DCP-AI v2.0](../../../spec/DCP-AI-v2.0.md) 中规定）中它们写作 `sha256:<hex>`；在两个版本中，第一个条目的 `prev_hash` 都仍是字面的
  `"GENESIS"`。V2 条目还带有 `session_nonce`、`hash_alg` 和
  `pq_checkpoint_ref`，并且这些条目由清单的 Merkle 根承诺，而不是逐一签名。
- 这些哈希所用的规范形式是配置文件 `dcp-jcs-v1`
  （[CANONICALIZATION_PROFILE.md](../../../spec/CANONICALIZATION_PROFILE.md)）；上文的 `json-stable-stringify` 只是一个
  按键排序的序列化器示例，并不是另一个配置文件。
- 这条链使被修改、删除或重排的条目可被发现；它并不能让条目
  无法更改，也不说明其内容是否真实。
- `<audit_entry.json>` 以及其他尖括号中的名称是你自己文件的占位符。
