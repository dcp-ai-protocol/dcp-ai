<sub>[English](../../../spec/V2-WIRE-COMPATIBILITY.md) · **中文** · [Español](../../es/spec/V2-WIRE-COMPATIBILITY.md) · [日本語](../../ja/spec/V2-WIRE-COMPATIBILITY.md) · [Português](../../pt-BR/spec/V2-WIRE-COMPATIBILITY.md)</sub>

<a id="dcp-ai-v20-wire-compatibility-errata-for-dcp-05-dcp-08-and-dcp-09"></a>

# DCP-AI v2.0 传输格式兼容性：DCP-05、DCP-08 和 DCP-09 勘误

> 本文是[英文规范](../../../spec/V2-WIRE-COMPATIBILITY.md)的参考译文，更新于 25/10/2026。**具有规范效力的是英文版**：本译文不具规范效力，如有出入，以英文版为准。标识符和代码块保持原文，不作翻译。

<a id="status"></a>

## 状态

发布于 25/10/2026。**仅对下文的勘误 E1 至 E8 以及第 2 节的层次定义具有规范性。** DCP-AI v2.0、DCP-05、DCP-08
和 DCP-09 的所有其他要求保持其规范效力不变。规范化配置文件的要求、签名规则、模式以及各规范的正文共同适用：
它们之间不存在相互覆盖，本文也不放宽其中任何一项。

这些勘误更正各规范对 V2.0 传输格式数据（字段名、签名上下文及其示例的格式）的**命名和展示方式**，使之与
`schemas/v2/`、四个执行签名的 SDK 以及共享向量已在使用的格式一致。它们不改变任何模式、上下文、规范化配置文件、
SDK 行为或接受判定。它们不增加任何别名：此处更正的标签或字段名不会被接受来代替传输格式中的名称，在这些勘误之前
产生的记录既不改名，也不转换。

此处的兼容性涵盖当前模式和 SDK 的传输格式及接受行为，不涵盖未经验证的第三方实现行为。使用过示例中旧标签的
实现需要明确的迁移决定。不得更改现有已签名证据的标签或重写其内容；这些勘误不允许在签名上下文之间自动回退。

<a id="1-scope"></a>

## 1. 范围

| 勘误 | 规范及章节 | 主题 |
|------|------------|------|
| E1 | DCP-AI v2.0 §4.1 | 已在使用的上下文登记表行 |
| E2 | DCP-05 §2、§4.4（最后一句）、§10.5、§11 第 7 项 | 生命周期记录的签名上下文 |
| E3 | DCP-05 §5.1 和 §6.2 | 活力报告中活力字段的名称 |
| E4 | DCP-08 §2、§9.5、§10 第 8 项 | 权利记录的签名上下文 |
| E5 | DCP-09 §2、§10.6、§11 第 9 项 | 委托记录和认知记录的签名上下文 |
| E6 | DCP-09 §3.6 | 承载授权书到期时间的字段 |
| E7 | DCP-05 §3.3、§4.2、§6.2、§8.2、§9.2；DCP-08 §4.2、§5.2、§6.2、§8.2；DCP-09 §3.2、§4.2、§5.2、§6.2、§7.2、§9.2 | JSON 示例的性质 |
| E8 | DCP-05、DCP-08、DCP-09 的“实现说明（参考性）” | 说明中的优先顺序语句 |

<a id="2-layers"></a>

## 2. 层次

V2.0 记录在四个层次上接受检查。这些检查不能相互替代；只通过其中一项检查并不证明完全合规。验证（第 3 层）会对
记录进行规范化，因此要求第 1 层；第 4 层对所涉记录要求第 1 至第 3 层。

1. **可表示**：规范化配置文件 `dcp-jcs-v1` 接受该记录
   （[CANONICALIZATION_PROFILE.md](../../../spec/CANONICALIZATION_PROFILE.md)）。非整数的数值不可表示。
2. **符合模式**：记录能通过 `schemas/v2/` 中其模式的校验。符合模式的记录仍可能不可表示（例如活力指标 `0.5`），
   并且模式检查的是形状和范围，而不是含义。
3. **已通过密码学验证**：复合签名在上下文登记表所分配的上下文下，按 DCP-AI v2.0 §5 的定义通过验证：经典签名针对域分离
   消息 `UTF8(context) || 0x00 || canonical bytes`（§4），而在 `pq_over_classical` 绑定下，后量子签名针对该消息
   后接经典签名。它认证的是持有密钥者所作的声明；它不表明记录所述内容属实，也不表明其按要求计算。
4. **功能合规**：实现满足规范本身的要求（各“合规性”章节中的计算、签名者、流程、间隔和强制执行）。第 1 至第 3
   层对所涉记录是必要的，但对本层并不充分。

<a id="3-errata"></a>

## 3. 勘误

<a id="e1-context-registry-dcp-ai-v20-41"></a>

### E1. 上下文登记表（DCP-AI v2.0 §4.1）

§4.1 的表格新增 `DCP-AI.v2.MultiPartyAuth`、`DCP-AI.v2.Lifecycle`、`DCP-AI.v2.Succession`、`DCP-AI.v2.Dispute`、
`DCP-AI.v2.Rights` 和 `DCP-AI.v2.Awareness` 这几行，`DCP-AI.v2.Delegation` 行也列出主体镜像。这些上下文已由
四个执行签名的 SDK 定义，并由 `tests/interop/v2/interop_vectors.json#domain_separation_all_contexts` 逐字节
覆盖；这些行只是加以记录，不新增任何标签。其他行不变。

<a id="e2-lifecycle-signatures-dcp-05"></a>

### E2. 生命周期签名（DCP-05）

凡 DCP-05 提到域分离标签 `DCP-LIFECYCLE-SIG-v2` 之处，V2.0 传输格式中的上下文是 `DCP-AI.v2.Lifecycle`，按
DCP-AI v2.0 §4 和 §5 的定义应用于每条生命周期记录（`schemas/v2/` 中的 `commissioning_certificate`、
`vitality_report`、`decommissioning_record`）的 `composite_sig`。标签 `DCP-LIFECYCLE-SIG-v2` 不是 V2.0 上下文。
§4.4 中投入运行证书须带有机构签名和主体副署的要求不变（见第 4 节）。

<a id="e3-vitality-field-dcp-05"></a>

### E3. 活力字段（DCP-05）

V2.0 活力报告将 §5.1 的综合活力值放在字段 `vitality_score` 中（0 至 1000 的整数，
`schemas/v2/vitality_report.schema.json`）；§6.2 示例中名为 `vitality` 的字段就是这个值。§5.1 的定义、组成部分、
权重和 `floor` 以及 §5.2 的阈值不变。模式检查范围，签名认证所声明的值；两者都不表明该值是按 §5.1 的要求计算的。
V2.0 模式的 `metrics` 对象承载的是与 §5.1 四个组成部分得分不同的量，而根据这些指标计算得分的 SDK 辅助函数使用
其他输入，并采用舍入而非向下取整：它们不表明符合 §5.1。

<a id="e4-rights-signatures-dcp-08"></a>

### E4. 权利签名（DCP-08）

凡 DCP-08 提到标签 `DCP-RIGHTS-SIG-v2` 之处，V2.0 传输格式中的上下文是 `DCP-AI.v2.Rights`，应用于
`rights_declaration`、`obligation_record` 和 `rights_violation_report` 的 `composite_sig`。§9.1 中须根据投入运行
机构的密钥验证权利声明的要求不变。

<a id="e5-delegation-and-awareness-signatures-dcp-09"></a>

### E5. 委托和认知签名（DCP-09）

凡 DCP-09 提到标签 `DCP-DELEGATION-SIG-v2` 和 `DCP-AWARENESS-SIG-v2` 之处，V2.0 传输格式中的上下文如下：

| 记录 | 签名字段 | 上下文 |
|------|----------|--------|
| 根委托授权书 | `human_composite_sig` | `DCP-AI.v2.Delegation`（§3.5.1 已有说明） |
| 子授权书 | `delegator_composite_sig` | `DCP-AI.v2.SubMandate`（§3.5.1 已有说明） |
| 主体镜像、交互记录 | `composite_sig` | `DCP-AI.v2.Delegation` |
| 认知阈值、建议声明 | `composite_sig` | `DCP-AI.v2.Awareness` |

§3.5 的授权书链规则不变。

<a id="e6-mandate-expiry-dcp-09-36"></a>

### E6. 授权书到期（DCP-09 §3.6）

“已过 `effective_until` 时间戳”读作“已过 `valid_until` 时刻”。V2.0 授权书的有效期窗口是 `valid_from` /
`valid_until`（`schemas/v2/delegation_mandate.schema.json`，必填），按 §3.5.2 的要求作为 RFC 3339 时刻比较；
§3.2 示例中的 `effective_from` / `effective_until` 就是这两个字段。带有 `effective_until` 而非 `valid_until`
的授权书会被模式拒绝，也会被 TypeScript 授权书链验证器（按本套件的测试方式）拒绝。

<a id="e7-examples"></a>

### E7. 示例

第 1 节所列章节中的 JSON 示例用于说明各记录的内容；它们不是 V2.0 传输格式，也不是 fixture，而且按原样书写时，
出于两个不同的原因，它们不是有效的 V2.0 记录。其中带有 `alg`、`kid`、`sig_b64` 和 `domain_sep` 的
`signature` / `countersignature` / `agent_acknowledgment` 块、模式中没有的 `record_type`、`prev_hash_secondary`
和 `merkle_root` 字段，以及与模式不同的其他字段名，会使记录不符合模式，即使它可以规范化。非整数值（例如
`error_rate_percent: 0.3`、`capacity_threshold: 0.80`、`threshold: 0.3`、`confidence: 0.95`）在 `dcp-jcs-v1`
下不可表示。对于在 `schemas/v2/` 中有已发布模式的记录，其传输格式是该模式加上 `dcp-jcs-v1` 规范化，并按 E2、E4
和 E5 的规定签名。所列示例中有一些没有自己的已发布模式：DCP-05 §3.3 的状态转换记录，以及 DCP-05 §9.2、DCP-08
§8.2 和 DCP-09 §9.2 的审计条目，后者也不符合 `schemas/v2/audit_entry.schema.json`。这样的示例并不定义模式，
这些勘误也不会使其成为有效的传输格式记录。这些章节正文所述的要求不变。

<a id="e8-implementation-notes"></a>

### E8. 实现说明

DCP-05、DCP-08 和 DCP-09 参考性说明中的“两者不一致时，以上文的规范性文本为准。”一句，读作“两者不一致时，以上文的
规范性文本为准，并适用 [V2-WIRE-COMPATIBILITY.md](../../../spec/V2-WIRE-COMPATIBILITY.md) 的勘误所作的更正。”

<a id="4-requirements-the-v20-structures-do-not-represent-directly"></a>

## 4. V2.0 结构不直接表示的要求

这些要求仍具规范性。下文所列记录的 V2.0 模式每条记录只带一个签名或一个封闭的取值集合，因此这些记录不直接表示
这些要求，仅凭 SDK 辅助函数也不能满足这些要求。这些记录之外的机制能否满足这些要求，取决于能否证明功能性要求
本身；这些勘误既不确立也不假定这一点。要在记录内部表示这些要求，需要明确的、有版本的设计（新的模式版本或
配置文件）；这些勘误没有定义或启用任何此类设计。

| 要求 | V2.0 记录为何不承载它 |
|------|------------------------|
| DCP-05 §4.4：机构签名和主体副署 | 只有一个 `composite_sig`；没有用于第二签名者的字段 |
| DCP-05 §5.1 的组成部分得分 | 模式的 `metrics` 是其他的量；只承载 `vitality_score` |
| DCP-05 §6 的小数指标 | `dcp-jcs-v1` 只接受整数，因此模式中 [0, 1] 的指标只能表示为 0 或 1 |
| DCP-08 §4.3 以反向域名表示的组织权利 | `right_type` 是四项基本权利的封闭枚举 |
| DCP-08 §9.1：由投入运行机构签名 | 记录不标明签名者的角色；辅助函数也不检查 |
| DCP-09 §3.3：代理确认；§6.3：主体在镜像上的签名 | 每条记录一个签名 |

SDK 的活力得分辅助函数在收到小数输入时，对恰好居中的情况处理也互不相同（对于 `task_completion_rate` 0、
`error_rate` 1、`human_satisfaction` 0.002 和 `policy_alignment` 0，TypeScript 辅助函数返回 1，Python 辅助函数
返回 0）。这些输入无法在已签名的报告中表示；这一差异是单独的待决事项，不是协议要求。

<a id="5-evidence"></a>

## 5. 依据

| 勘误 | 参考 |
|------|------|
| E1 | `sdks/typescript/src/core/domain-separation.ts`；`interop_vectors.json#domain_separation_all_contexts`；套件用例 `ext.wire.contexts.registry_documented` |
| E2、E4、E5 | `schemas/v2/{commissioning_certificate,vitality_report,decommissioning_record,rights_declaration,obligation_record,rights_violation_report,delegation_mandate,principal_mirror,interaction_record,awareness_threshold,advisory_declaration}.schema.json`；套件用例 `ext.wire.dcp0*.*.signed`、`ext.wire.context.*` |
| E3 | `schemas/v2/vitality_report.schema.json#/properties/vitality_score`；套件用例 `ext.wire.dcp05.vitality_field_name.schema_rejected`、`ext.wire.tamper.vitality_score_changed` |
| E6 | `schemas/v2/delegation_mandate.schema.json#/required`；`tests/interop/v2/mandate_chain_vectors.json`（`expired_at_verification_time`、`validity_*`）；套件用例 `ext.wire.dcp09.effective_until.*` |
| E7、第 4 节 | 套件用例 `ext.wire.dcp05.fractional_metric.*`、`ext.wire.dcp08.extension_signed_but_schema_invalid`、`ext.wire.dcp05.countersignature.schema_rejected`、`ext.wire.fixture.*` |

套件用例属于 [`tools/conformance`](../../../tools/conformance/README.md) 的 `ext.dcp05_09.wire` 测试集。
