<sub>[English](../../../spec/DCP-02.md) · **中文** · [Español](../../es/spec/DCP-02.md) · [日本語](../../ja/spec/DCP-02.md) · [Português](../../pt-BR/spec/DCP-02.md)</sub>

<a id="dcp-02--intent-declaration--policy-gating"></a>
<a id="dcp-02-intent-declaration-policy-gating"></a>

# DCP-02 — 意图声明与策略管控

> 本文是[英文规范](../../../spec/DCP-02.md)的参考译文，更新于 25/10/2026。**具有规范效力的是英文版**：本译文不具规范效力，如有出入，以英文版为准。标识符和代码块保持原文，不作翻译。

没有静默的操作。代理在行动之前声明它打算做什么；策略层决定是批准、升级还是阻止。DCP-02 定义了声明的意图和策略决定。

<a id="normative-artifacts"></a>

## 规范性工件

| 工件 | 说明 | Schema |
|----------|-------------|--------|
| **Intent** | 意图声明：代理、人、操作、通道、数据类别、预估影响。 | `schemas/v1/intent.schema.json` |
| **PolicyDecision** | 对某个意图的决定：approve / escalate / block、风险评分、理由。可选：要求人工确认。 | `schemas/v1/policy_decision.schema.json` |
| **HumanConfirmation** | （可选）对某个意图的明确人工确认：批准或拒绝。 | `schemas/v1/human_confirmation.schema.json` |

schema 的 **$id**：`https://dcp-ai.org/schemas/v1/<name>.schema.json`

<a id="validation"></a>

## 校验

按其 schema 校验一个对象：

```bash
dcp validate schemas/v1/intent.schema.json <intent.json>
dcp validate schemas/v1/policy_decision.schema.json <policy_decision.json>
dcp validate schemas/v1/human_confirmation.schema.json <human_confirmation.json>
```

Citizenship Bundle 包含 Intent 和 PolicyDecision；用以下命令校验它：

```bash
dcp validate-bundle <citizenship_bundle.json>
```

<a id="examples"></a>

## 示例

- [tests/conformance/examples/intent.json](../../../tests/conformance/examples/intent.json)
- [tests/conformance/examples/policy_decision.json](../../../tests/conformance/examples/policy_decision.json)
- [tests/conformance/examples/human_confirmation.json](../../../tests/conformance/examples/human_confirmation.json)

字段和枚举值以 JSON Schema 为准；本文档是引用它们的规范性规范。

<a id="implementation-notes-informative"></a>

## 实现说明（参考性）

> **2026 年 10 月 25 日添加。非规范性。** 这些说明不增加任何要求，也不改变上文任何内容：它们描述 `main` 上的参考代码
> 与本文的关系。两者不一致时，以上文的规范性文本为准。

- 本文档及其命令描述的是 **V1** 工件（`schemas/v1/`）。其 V2 对应项
  （`schemas/v2/intent.schema.json`、`policy_decision.schema.json`、`human_confirmation.schema.json`）尤其为意图
  增加了 `session_nonce` 和 `requires_consent`，为策略决定增加了 `session_nonce`、`applied_policy_hash`、
  `required_confirmation` 和 `timestamp`；它们在 [DCP-AI v2.0](../../../spec/DCP-AI-v2.0.md) 中
  规定。
- `<intent.json>` 以及其他尖括号中的名称是你自己文件的占位符。
- 策略决定是策略层所作决定的记录。验证 bundle 检查的是它是否一致且
  已签名；它并不执行该决定，参考验证器也不会因为决定为 `block` 而拒绝 bundle。
  在操作之前执行该决定是应用程序的工作。
