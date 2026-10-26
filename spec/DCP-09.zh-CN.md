<sub>[English](DCP-09.md) · **中文** · [Español](DCP-09.es.md) · [日本語](DCP-09.ja.md) · [Português](DCP-09.pt-BR.md)</sub>

<a id="dcp-09-delegation--representation"></a>
<a id="dcp-09-delegation-representation"></a>

# DCP-09：委托与代表

> 本文是[英文规范](DCP-09.md)的参考译文，更新于 25/10/2026。**具有规范效力的是英文版**：本译文不具规范效力，如有出入，以英文版为准。标识符和代码块保持原文，不作翻译。

<a id="status"></a>

## 状态
已发布 — v2.0（扩展；修订根据采用者的反馈跟踪）

> **勘误（25/10/2026，规范性）：** [V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md) 的勘误 E5、E6、E7 和 E8 更正了签名上下文、承载授权书到期时间的字段以及示例的性质。它们不改变本规范的任何其他要求。

<a id="abstract"></a>

## 摘要
本规范定义人类向代理委托权限、代理认知阈值、建议声明、主体镜像以及双层交互记录的协议。它提供以下机制：人类主体正式将特定权限委托给 AI 代理；代理声明其对所委托上下文的理解；交互同时在技术层和人类可读层得到记录。DCP-09 还扩展了 DCP-04 的 A2A 握手，使其包含委托授权书验证，确保代表主体行事的代理能够向对方证明其权限。

<a id="1-introduction"></a>

## 1. 引言

DCP-01 规定每个代理都绑定到一个负责主体。然而，这种绑定的性质——主体委托了什么权限、代理如何理解其被委托的角色，以及代理在交互中如何代表其主体——并没有正式规定。DCP-09 填补了这一空白。

在多代理系统中，代理经常代表无法亲自参与每次交互的人类主体行事。采购代理与供应商代理谈判，合规代理代表治理负责人审查策略，研究代理代表科学家查询数据源。在每种情况下，代理都在行使被委托的权限，而该权限的范围和限制必须是明确的、可验证的和可审计的。

DCP-09 应对五个相互关联的问题：

1. **委托**：主体如何正式授予代理权限
2. **认知**：代理如何声明其对所委托上下文及自身局限的理解
3. **建议**：代理如何向其主体传达不确定性或建议
4. **代表**：代理如何以人类可读的形式呈现其主体的利益
5. **交互记录**：如何同时在技术层和叙述层记录交互

<a id="11-design-principles"></a>

### 1.1 设计原则
- 委托是明确的、有范围的、有时限的
- 代理必须声明自己理解什么，而不只是能做什么
- 人类主体必须能够用自然语言审查代理的行动
- 交互产生双层记录：机器可验证的和人类可读的
- 对方可在 A2A 握手期间验证委托授权书

<a id="12-relationship-to-other-specifications"></a>

### 1.2 与其他规范的关系
- **DCP-01**：委托授权书以明确的权限范围扩展主体绑定
- **DCP-02**：意图声明引用授权该行动的委托授权书
- **DCP-03**：所有委托事件都记录在审计链中
- **DCP-04**：A2A 握手被扩展为包含授权书验证
- **DCP-05**：代理退役时，其委托授权书被撤销
- **DCP-07**：超出委托权限可能引发争议
- **DCP-08**：代理有义务在被委托的范围内行事

<a id="2-terminology"></a>

## 2. 术语

**委托授权书**：由人类主体签署、授予代理特定权限的文件，规定了范围、条件和到期时间。

**认知阈值**：代理就其对所委托上下文理解什么、不理解什么所作的结构化声明，作为一种可验证的诚实机制。

**建议声明**：代理向其主体发出的正式通知，用于声明不确定性、建议人工审查，或指出可能超出代理被委托能力的情况。

**主体镜像**：以人类可读的叙述形式呈现代理所理解的主体利益、价值观和优先事项，在交互中伴随代理。

**交互记录**：一次交互的双层记录：技术层（机器可验证）和叙述层（人类可读），两者都经过签名并以哈希链接。

**授权书链**：当一个代理将其部分权限委托给另一个代理时，从最初的人类主体经由中间代理直到最终受托者的授权书链。

**域分离上下文**：`DCP-AI.v2.Delegation`（根授权书、主体镜像和交互记录）、`DCP-AI.v2.Awareness`（认知阈值和建议声明）、`DCP-AI.v2.SubMandate`（子授权书，第 3.5 节）。勘误 E5；前两个此处原先写作标签 `DCP-DELEGATION-SIG-v2` 和 `DCP-AWARENESS-SIG-v2`。

<a id="3-delegation-mandate"></a>

## 3. 委托授权书

<a id="31-purpose"></a>

### 3.1 目的

委托授权书是人类主体向 AI 代理授予权限的正式文书。它规定代理被授权做什么、在什么条件下、有哪些限制以及期限多长。没有有效的委托授权书，代理不得（MUST NOT）超出其基本能力代表主体行事。

### 3.2 Schema

Schema 参考：`schemas/v2/delegation_mandate.schema.json`

> **勘误 E6 和 E7（25/10/2026）：** 本示例是概念性的。V2.0 传输格式是模式：有效期窗口是 `valid_from` / `valid_until`，签名是 `human_composite_sig`（根）或 `delegator_composite_sig`（子授权书），见第 3.5 节。已签名的根授权书和子授权书见 `tests/interop/v2/mandate_chain_vectors.json`。见 [V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md)。

```json
{
  "dcp_version": "2.0",
  "record_type": "delegation_mandate",
  "mandate_id": "dm:<uuid>",
  "mandate_hash": "sha256:<hex of the canonical form of this mandate>",
  "delegator": {
    "principal_id": "principal:<identifier>",
    "principal_name": "Dr. Sarah Chen",
    "organization_id": "org:<identifier>",
    "role": "Head of Procurement"
  },
  "delegate": {
    "agent_id": "agent:<identifier>",
    "agent_name": "Procurement Agent Alpha"
  },
  "authority": {
    "scope": "procurement",
    "permissions": [
      {
        "action": "negotiate",
        "resource_pattern": "vendor:*",
        "conditions": {
          "max_contract_value": 50000,
          "currency": "USD",
          "approved_vendors_only": true,
          "vendor_list_reference": "policy:approved-vendors-2026-q1"
        }
      },
      {
        "action": "issue_purchase_order",
        "resource_pattern": "vendor:approved:*",
        "conditions": {
          "max_order_value": 10000,
          "currency": "USD",
          "requires_dual_quote": true
        }
      },
      {
        "action": "request_information",
        "resource_pattern": "vendor:*",
        "conditions": {}
      }
    ],
    "prohibitions": [
      {
        "action": "approve_payment",
        "reason": "Payment approval requires human authorization"
      },
      {
        "action": "modify_vendor_list",
        "reason": "Vendor list modifications require governance review"
      }
    ],
    "escalation_triggers": [
      {
        "condition": "contract_value_exceeds_threshold",
        "threshold": 25000,
        "action": "advisory_to_principal",
        "description": "Notify principal when negotiated value exceeds $25,000"
      },
      {
        "condition": "new_vendor_encountered",
        "action": "advisory_to_principal",
        "description": "Alert principal when interacting with a vendor not on the approved list"
      },
      {
        "condition": "uncertainty_above_threshold",
        "threshold": 0.3,
        "action": "pause_and_advise",
        "description": "Pause action and seek principal guidance when confidence drops below 70%"
      }
    ]
  },
  "sub_delegation": {
    "permitted": true,
    "max_depth": 1,
    "sub_delegate_requirements": {
      "same_organization_required": true,
      "minimum_security_tier": "elevated",
      "permitted_scope_reduction_only": true
    }
  },
  "validity": {
    "effective_from": "2026-03-01T00:00:00Z",
    "effective_until": "2026-06-01T00:00:00Z",
    "renewable": true,
    "revocation_conditions": [
      "principal_revocation",
      "agent_decommissioned",
      "policy_violation_detected",
      "organization_policy_change"
    ]
  },
  "audit_requirements": {
    "log_all_actions": true,
    "narrative_record_required": true,
    "principal_review_interval": "P7D",
    "advisory_threshold": "medium"
  },
  "issued_at": "2026-03-01T00:00:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<principal-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-DELEGATION-SIG-v2"
  },
  "agent_acknowledgment": {
    "acknowledged_at": "2026-03-01T00:01:00Z",
    "awareness_threshold_id": "at:<uuid>",
    "alg": "ed25519",
    "kid": "<agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-DELEGATION-SIG-v2"
  }
}
```

<a id="33-mandate-issuance-flow"></a>

### 3.3 授权书签发流程

1. 主体创建委托授权书，规定范围、许可、禁止事项和有效期
2. 主体用自己的密钥签署授权书
3. 授权书交付给代理
4. 代理审阅授权书，并创建反映其理解的认知阈值（第 4 节）
5. 代理签署确认回执，并将其与认知阈值关联
6. 经确认的授权书生效
7. 在主体和代理双方的审计链中都创建一条 `delegation_mandate_issued` 审计条目

> *参考说明（25/10/2026）：* V2.0 `delegation_mandate` 模式没有用于第 5 步代理确认的字段；见 [V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md#4-requirements-the-v20-structures-do-not-represent-directly)。

<a id="34-mandate-hash"></a>

### 3.4 授权书哈希

`mandate_hash` 是授权书规范（确定性序列化）内容（不含签名）的 SHA-256 哈希。该哈希用于 A2A 握手（第 8 节），使对方无需获取完整授权书即可验证代理的权限。

<a id="35-sub-delegation"></a>

### 3.5 再委托

受托代理可以（MAY）通过签发**子授权书**将其部分权限转交给另一个代理：子授权书是一份引用其父授权书、由委托代理而非人类签署的 `DelegationMandate`（`schemas/v2/delegation_mandate.schema.json`）。从人类的根授权书到实际行事的代理之间的各份授权书构成**授权书链**。由于每一跳都经过签名、只能收窄上一跳授予的内容，并且可以离线一直验证到人类主体，责任在每一跳中都得以保留。

<a id="351-wire-fields"></a>

#### 3.5.1 传输字段

传输 schema 有以下可选字段；不属于任何链的授权书中这些字段全部缺省，因此现有根授权书的字节完全不变：

| 字段 | 类型 | 含义 |
|---|---|---|
| `parent_mandate_id` | string | 本子授权书所收窄的授权书的 `mandate_id`。在根授权书中必须（MUST）缺省。 |
| `delegation_depth` | integer ≥ 0 | 距人类的跳数：根授权书为 `0`（或缺省），子授权书为父授权书深度 + 1。 |
| `sub_delegation` | `{ "permitted": boolean, "max_depth": integer ≥ 0 }` | 受托者是否可以再委托，以及任何后代可以达到的最大 `delegation_depth`。缺省表示不允许再委托。 |
| `minimum_security_tier` | `routine` \| `standard` \| `elevated` \| `maximum` | 该授权书下每个行动的安全层级（DCP-AI v2.0 §14.2）下限。 |
| `delegator_composite_sig` | `CompositeSignature` | 委托代理（父授权书的 `agent_id`）在 `DCP-AI.v2.SubMandate` 域分离上下文下对规范化子授权书所作的签名。 |

根授权书必须（MUST）带有 `human_composite_sig`（上下文 `DCP-AI.v2.Delegation`），且不得（MUST NOT）带有 `delegator_composite_sig`。子授权书必须（MUST）带有 `delegator_composite_sig`、`parent_mandate_id` 和 `delegation_depth`，且不得（MUST NOT）带有 `human_composite_sig`。被签名的字节是去掉签名字段的规范化授权书，并使用与其深度对应的上下文。

`human_composite_sig` 和 `delegator_composite_sig` 都必须（MUST）使用 `pq_over_classical` 绑定（DCP-AI v2.0 §5）：无论验证模式如何，验证方都必须（MUST）拒绝签名为 `classical_only` 的授权书。

<a id="352-chain-verification"></a>

#### 3.5.2 链验证

接受授权书链的验证方必须（MUST）接收有序的链（根在前）、已撤销 `mandate_id` 的集合、验证时间，以及人类主体和每个委托代理的密钥；并且除非以下各项全部成立，否则必须（MUST）拒绝整条链。人类主体的密钥必须（MUST）是链中 `human_id` 的 Responsible Principal Record 的 `binding_keys`，委托代理的密钥必须（MUST）是该 `agent_id` 经验证的 Agent Passport 的 `keys`；链验证方只按 `kid` 在所给内容中查找密钥，本身并不建立这种对应关系，这与 bundle 验证方的信任模型相同。时间戳按 RFC 3339 时刻解析，不得（MUST NOT）按文本比较。任何值未知的字段、任何按授权书深度应有却缺失的字段，以及任何不可比较的输入，都会导致失败关闭。

1. **根。** 第一份授权书的 `delegation_depth` 为 0 或缺省，没有 `parent_mandate_id`，并带有可用人类主体密钥验证的 `human_composite_sig`。
2. **链接。** 每份子授权书的 `parent_mandate_id` 等于上一份授权书的 `mandate_id`；其 `delegation_depth` 为父授权书的值 + 1；其 `human_id` 等于父授权书的值；其 `delegator_composite_sig` 可用父授权书 `agent_id` 的密钥验证。
3. **许可与深度。** 父授权书的 `sub_delegation.permitted` 为 `true`，且子授权书的 `delegation_depth` 不超过其所有祖先中最小的 `sub_delegation.max_depth`。
4. **有效期窗口。** `valid_from` 不早于父授权书的值，`valid_until` 不晚于父授权书的值，且验证时间位于每份授权书的窗口之内。
5. **收窄。** 子授权书的每个 `authority_scope` 条目都对应父授权书中 `domain` 相同的一个条目；其 `actions_permitted` 是父授权书相应值的子集；其 `data_classes` 是父授权书相应值的子集：父条目有 `data_classes` 时，子授权书条目也必须有（空列表，即没有任何数据类别，是最窄的），父条目没有时，子授权书条目也没有；对于父条目 `limits` 的每个键，子授权书条目都有该键，且其值是不大于父值的数值，或与父值完全相同；子授权书可以（MAY）增加键。数值限制必须（MUST）是 ±(2^53 − 1) 范围内的整数，这是无论如何表示 JSON 数字的实现都能精确读取的范围：超出该范围时，把数字解析为双精度浮点数的验证方与保留全部位数的验证方会对授权书的内容产生分歧。带有该范围之外数值限制的授权书，无论处于哪个深度、父授权书是否有该键，都不可比较。同一授权书中出现两次的领域不可比较。
6. **层级下限。** 父授权书有 `minimum_security_tier` 时，子授权书也有一个不低于它的值（`routine` < `standard` < `elevated` < `maximum`）。链的实际层级是链上最大的 `minimum_security_tier`；将其纳入 DCP-AI v2.0 §14.2 层级计算的验证方必须（MUST）只允许它提高层级。
7. **撤销。** 链中没有任何授权书被撤销。被撤销的祖先会使其所有后代失效。

参考实现：`verifyMandateChain`（TypeScript）、`verify_mandate_chain`（Python 和 Rust）以及 `VerifyMandateChain`（Go）。`tests/interop/v2/mandate_chain_vectors.json` 包含每个实现都必须（MUST）接受的链和必须（MUST）拒绝的链，四个 SDK 的测试套件都会运行它。

<a id="36-mandate-revocation"></a>

### 3.6 授权书撤销

授权书可能因以下原因被撤销：

- **主体撤销**：委托主体明确撤销授权书
- **到期**：已过 `valid_until` 时刻（勘误 E6；按 RFC 3339 时刻比较，第 3.5.2 节）
- **代理退役**：受托代理转入 `decommissioned`（DCP-05）
- **策略违规**：代理违反了授权书中规定的条件

撤销会产生一条附加到授权书链上的已签名撤销记录。

<a id="4-awareness-threshold"></a>

## 4. 认知阈值

<a id="41-purpose"></a>

### 4.1 目的

认知阈值是代理就其对所委托上下文理解什么、不理解什么所作的正式声明。它是一种可验证的诚实机制：通过明确说明其知识边界，代理使主体和对方能够评估其行动的可靠性。

### 4.2 Schema

Schema 参考：`schemas/v2/awareness_threshold.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "awareness_threshold",
  "threshold_id": "at:<uuid>",
  "agent_id": "agent:<identifier>",
  "mandate_id": "dm:<uuid>",
  "version": 1,
  "understanding": {
    "delegation_scope": {
      "confidence": 0.95,
      "summary": "I understand that I am authorized to negotiate with approved vendors for procurement contracts up to $50,000 and issue purchase orders up to $10,000",
      "gaps": []
    },
    "domain_knowledge": {
      "confidence": 0.82,
      "summary": "I have strong knowledge of standard procurement procedures and vendor evaluation criteria. I have moderate knowledge of supply chain risk assessment.",
      "gaps": [
        {
          "area": "international_trade_compliance",
          "confidence": 0.45,
          "description": "Limited knowledge of export control regulations and international trade compliance requirements",
          "mitigation": "Will escalate to principal for any international procurement"
        },
        {
          "area": "specialized_materials",
          "confidence": 0.55,
          "description": "Limited ability to evaluate technical specifications for specialized laboratory equipment",
          "mitigation": "Will request technical review from domain specialist before proceeding"
        }
      ]
    },
    "counterparty_context": {
      "confidence": 0.70,
      "summary": "I have interaction history with 15 of the 23 approved vendors. I have no prior context for 8 vendors.",
      "gaps": [
        {
          "area": "new_vendor_negotiation_patterns",
          "confidence": 0.40,
          "description": "No historical data on negotiation patterns for vendors added in Q1 2026",
          "mitigation": "Will adopt conservative negotiation stance and consult principal for high-value engagements"
        }
      ]
    },
    "ethical_boundaries": {
      "confidence": 0.98,
      "summary": "I understand the organization's ethical procurement policy, including fair dealing requirements, conflict of interest restrictions, and sustainability criteria",
      "gaps": []
    }
  },
  "self_assessed_overall_confidence": 0.78,
  "advisory_triggers": [
    {
      "condition": "confidence_below_threshold",
      "threshold": 0.6,
      "action": "issue_advisory",
      "description": "Will issue advisory declaration when confidence in any domain drops below 60%"
    },
    {
      "condition": "novel_situation",
      "action": "issue_advisory",
      "description": "Will issue advisory when encountering a situation with no precedent in training or interaction history"
    }
  ],
  "created_at": "2026-03-01T00:01:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-AWARENESS-SIG-v2"
  }
}
```

<a id="43-confidence-scores"></a>

### 4.3 置信度得分

置信度得分是 [0, 1] 范围内的浮点值：

- **0.9–1.0**：高置信度。代理理解充分，可以独立行事。
- **0.7–0.9**：中等置信度。代理可以继续，但应留意意外情况。
- **0.5–0.7**：低置信度。代理应谨慎行事，并准备好升级。
- **0.0–0.5**：极低置信度。代理不应独立行事；需要向主体发出建议。

这些阈值仅供参考。组织可以（MAY）定义更严格或更宽松的阈值。

<a id="44-awareness-updates"></a>

### 4.4 认知更新

认知阈值有版本。随着代理在授权书下运行的经验增加，它可以（MAY）更新其认知阈值，以反映理解的提高或下降。每次更新：

- 使 `version` 字段递增
- 通过 `prev_hash` 引用上一版本
- 生成一条审计条目
- 用代理的密钥签名

置信度大幅下降（任一类别下降超过 0.15）应当（SHOULD）触发建议声明。

<a id="5-advisory-declaration"></a>

## 5. 建议声明

<a id="51-purpose"></a>

### 5.1 目的

建议声明是代理向其主体发出的正式通知，用于指出不确定性、建议人工审查，或报告可能超出代理被委托能力的情况。这是代理表达“我不确定，请审查”的机制。

### 5.2 Schema

Schema 参考：`schemas/v2/advisory_declaration.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "advisory_declaration",
  "advisory_id": "adv:<uuid>",
  "agent_id": "agent:<identifier>",
  "mandate_id": "dm:<uuid>",
  "principal_id": "principal:<identifier>",
  "urgency": "medium",
  "category": "uncertainty",
  "subject": {
    "description": "Vendor proposal contains non-standard liability terms that fall outside my training distribution for contract evaluation",
    "related_interaction_id": "ir:<uuid>",
    "related_intent_id": "intent:<uuid>",
    "confidence_at_trigger": 0.42,
    "awareness_gap_reference": "international_trade_compliance"
  },
  "context": {
    "current_action": "Evaluating vendor proposal from TechSupply Co. for laboratory equipment",
    "decision_point": "Whether to accept modified liability terms in section 4.3 of the proposed contract",
    "options_considered": [
      {
        "option": "Accept modified terms",
        "agent_assessment": "Cannot reliably assess risk; liability exposure unclear",
        "confidence": 0.35
      },
      {
        "option": "Reject modified terms and counter with standard terms",
        "agent_assessment": "Safe option but may lose competitive pricing",
        "confidence": 0.80
      },
      {
        "option": "Escalate to principal for review",
        "agent_assessment": "Recommended: terms exceed my competence for risk assessment",
        "confidence": 0.95
      }
    ],
    "recommendation": "Escalate to principal. The modified liability terms in section 4.3 include indemnification clauses that I cannot reliably evaluate against organizational risk tolerance."
  },
  "action_taken": "paused",
  "action_details": "Negotiation paused pending principal review. Counterparty notified of brief delay.",
  "response_requested": true,
  "response_deadline": "2026-03-02T12:00:00Z",
  "issued_at": "2026-03-01T14:30:00Z",
  "timestamp": "2026-03-01T14:30:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-AWARENESS-SIG-v2"
  }
}
```

<a id="53-urgency-levels"></a>

### 5.3 紧急程度

| 紧急程度 | 代码 | 预期响应时间 |
|---------|------|----------------------|
| **低** | `low` | 7 天内 |
| **中** | `medium` | 24 小时内 |
| **高** | `high` | 4 小时内 |
| **严重** | `critical` | 1 小时内 |

<a id="54-advisory-categories"></a>

### 5.4 建议类别

| 类别 | 代码 | 说明 |
|----------|------|-------------|
| **不确定性** | `uncertainty` | 代理在当前任务上的置信度已降至低于阈值的水平 |
| **新情况** | `novel_situation` | 代理遇到超出其训练或经验的场景 |
| **范围边界** | `scope_boundary` | 行动接近或超出授权书规定的范围 |
| **伦理关切** | `ethical_concern` | 代理发现可能需要人类判断的伦理问题 |
| **信号冲突** | `conflicting_signals` | 代理收到相互矛盾的信息或指令 |
| **资源限制** | `resource_limitation` | 代理的能力不足以完成当前任务 |

<a id="55-principal-response"></a>

### 5.5 主体的回应

主体可以用以下方式回应建议声明：

- **继续**：授权代理按指定选项继续
- **覆盖**：给出一条优先于代理评估的具体指令
- **接管**：直接接管交互
- **另行委托**：把任务转给另一个代理或人员
- **确认知悉**：记录该建议而不改变代理的行动方向

回应由主体签署并记录在审计链中。

<a id="6-principal-mirror"></a>

## 6. 主体镜像

<a id="61-purpose"></a>

### 6.1 目的

主体镜像是一份人类可读的叙述性文件，表达代理所理解的主体利益、价值观和优先事项。它在交互中伴随代理，使对方（人员和代理）能够理解代理代表谁以及这种代表意味着什么。

主体镜像是连接 DCP 的密码学世界与组织关系的人类世界的桥梁。

### 6.2 Schema

Schema 参考：`schemas/v2/principal_mirror.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "principal_mirror",
  "mirror_id": "pm:<uuid>",
  "agent_id": "agent:<identifier>",
  "principal_id": "principal:<identifier>",
  "mandate_id": "dm:<uuid>",
  "narrative": {
    "principal_role": "Dr. Sarah Chen serves as Head of Procurement for Acme Research Labs, responsible for all vendor relationships and purchasing decisions for the organization's research operations.",
    "organizational_context": "Acme Research Labs is a mid-sized biotech research organization focused on molecular diagnostics. Procurement supports approximately 200 researchers across 12 laboratory groups.",
    "delegation_narrative": "Dr. Chen has delegated routine procurement negotiations and purchase order processing to this agent. The agent manages vendor relationships for standard laboratory supplies, equipment under $50,000, and service contracts. Dr. Chen retains authority over payment approvals, vendor list changes, and contracts involving novel terms.",
    "values_and_priorities": [
      "Quality of materials takes precedence over cost savings",
      "Long-term vendor relationships are preferred over one-time transactions",
      "Sustainability and ethical sourcing are organizational requirements",
      "Transparency in pricing and terms is expected from all vendors"
    ],
    "interaction_guidance": "This agent represents Dr. Chen in procurement negotiations. It is authorized to discuss terms, request quotes, and issue purchase orders within its mandate. For matters outside its scope, it will consult with Dr. Chen. Counterparties should expect the same professional standards as direct interaction with Dr. Chen's office."
  },
  "version": 2,
  "approved_by_principal": true,
  "principal_approval_timestamp": "2026-03-01T00:05:00Z",
  "created_at": "2026-03-01T00:02:00Z",
  "updated_at": "2026-03-01T00:05:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "agent_signature": {
    "alg": "ed25519",
    "kid": "<agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-DELEGATION-SIG-v2"
  },
  "principal_signature": {
    "alg": "ed25519",
    "kid": "<principal-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-DELEGATION-SIG-v2"
  }
}
```

<a id="63-principal-approval"></a>

### 6.3 主体批准

主体必须（MUST）在镜像用于交互之前对其进行审查和批准。这确保代理的叙述性表达准确反映主体的意图。两个签名（代理和主体）都是必需的。

> *参考说明（25/10/2026）：* V2.0 `principal_mirror` 模式只带一个 `composite_sig`；见 [V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md#4-requirements-the-v20-structures-do-not-represent-directly)。

<a id="64-mirror-updates"></a>

### 6.4 镜像更新

主体镜像有版本。在以下情况下更新：

- 主体的角色或上下文发生变化
- 委托授权书被更新
- 代理的认知阈值发生重大变化
- 主体在审查交互记录后要求修订

每次更新都会生成一个版本号递增的新版本，并以哈希链接到上一版本。

<a id="7-interaction-record"></a>

## 7. 交互记录

<a id="71-purpose"></a>

### 7.1 目的

交互记录在两个层面上记录代理的交互：

- **技术层**：机器可验证的数据，包括消息哈希、时间戳、序列号和密码学证明
- **叙述层**：对发生了什么、作出了哪些决定以及原因的人类可读摘要

这种双层方式确保人类主体能够用自然语言审查代理的行动，而底层数据仍可通过密码学验证。

### 7.2 Schema

Schema 参考：`schemas/v2/interaction_record.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "interaction_record",
  "interaction_id": "ir:<uuid>",
  "agent_id": "agent:<identifier>",
  "mandate_id": "dm:<uuid>",
  "counterparty": {
    "type": "agent",
    "agent_id": "agent:<counterparty>",
    "organization_id": "org:<counterparty-org>",
    "mandate_verified": true,
    "mandate_hash": "sha256:<hex>"
  },
  "session_reference": {
    "session_id": "<hex>",
    "session_type": "a2a",
    "protocol": "DCP-04"
  },
  "technical_layer": {
    "messages_exchanged": 24,
    "first_message_timestamp": "2026-03-01T10:00:00Z",
    "last_message_timestamp": "2026-03-01T10:45:00Z",
    "message_hashes": [
      {
        "sequence": 1,
        "direction": "sent",
        "content_hash": "sha256:<hex>",
        "timestamp": "2026-03-01T10:00:00Z"
      },
      {
        "sequence": 2,
        "direction": "received",
        "content_hash": "sha256:<hex>",
        "timestamp": "2026-03-01T10:00:30Z"
      }
    ],
    "intents_declared": ["intent:<uuid-1>", "intent:<uuid-2>"],
    "policy_outcomes": ["po:<uuid-1>", "po:<uuid-2>"],
    "interaction_merkle_root": {
      "sha256": "<hex>",
      "sha3_256": "<hex>"
    }
  },
  "narrative_layer": {
    "summary": "Negotiated Q2 2026 supply contract with TechSupply Co. for standard laboratory consumables. Achieved 8% volume discount against previous quarter pricing.",
    "key_decisions": [
      {
        "decision": "Accepted 8% volume discount in exchange for 90-day payment terms (vs. standard 60-day)",
        "reasoning": "Extended payment terms align with organizational cash flow preferences communicated in procurement policy P-2026-03. The 8% discount exceeds the 5% target.",
        "confidence": 0.88,
        "mandate_authority": "negotiate:vendor:techsupply"
      },
      {
        "decision": "Declined optional maintenance package for centrifuge equipment",
        "reasoning": "Maintenance package at $12,000/year exceeds the value threshold for independent decision. Flagged for principal review via advisory declaration.",
        "confidence": 0.72,
        "mandate_authority": "escalated_to_principal"
      }
    ],
    "counterparty_behavior": "TechSupply Co. agent was cooperative and transparent. Pricing was consistent with market data. No unusual terms or conditions proposed beyond the liability clause flagged in advisory adv:xxx.",
    "unresolved_items": [
      {
        "item": "Modified liability terms in section 4.3",
        "status": "pending_principal_review",
        "advisory_id": "adv:<uuid>"
      }
    ],
    "principal_action_required": true,
    "action_items_for_principal": [
      "Review and approve/reject modified liability terms in section 4.3 of TechSupply contract",
      "Confirm acceptance of 90-day payment terms for Q2 supply contract"
    ]
  },
  "delegation_compliance": {
    "within_scope": true,
    "permissions_exercised": ["negotiate", "request_information"],
    "prohibitions_respected": ["approve_payment", "modify_vendor_list"],
    "escalation_triggers_activated": [
      {
        "trigger": "contract_value_exceeds_threshold",
        "threshold": 25000,
        "actual_value": 47000,
        "action_taken": "advisory_issued",
        "advisory_id": "adv:<uuid>"
      }
    ]
  },
  "timestamp": "2026-03-01T11:00:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-DELEGATION-SIG-v2"
  }
}
```

<a id="73-technical-layer"></a>

### 7.3 技术层

技术层是机器可验证的，包括：

- 所有交换消息的哈希（可据此与 A2A 审计链核对）
- 对意图声明和策略结果的引用
- 基于所有消息哈希的双哈希 Merkle 根，可实现紧凑验证

<a id="74-narrative-layer"></a>

### 7.4 叙述层

叙述层是人类可读的，包括：

- 用通俗语言撰写的交互摘要
- 关键决定及其理由和置信度
- 对对方行为的观察
- 需要主体关注的未决事项
- 给主体的明确行动项

叙述层使主体无需解析原始 A2A 消息日志即可高效审查代理的行动。

<a id="75-delegation-compliance"></a>

### 7.5 委托合规

每条交互记录都包含一个合规部分，跟踪：

- 所有行动是否都在授权书范围之内
- 行使了哪些许可
- 遵守了哪些禁止事项
- 触发了哪些升级条件以及采取了什么行动

这为每次交互提供合规审计，并输入更广泛的义务跟踪体系（DCP-08）。

<a id="8-a2a-handshake-extension"></a>

## 8. A2A 握手扩展

<a id="81-purpose"></a>

### 8.1 目的

当两个代理在委托授权书下交互时，每个代理都应能验证对方的权限。DCP-09 扩展 DCP-04 的 A2A 握手，使其包含委托授权书验证。

<a id="82-extended-a2a_hello"></a>

### 8.2 扩展的 A2A_HELLO

A2A_HELLO 消息（DCP-04 第 3.2 节）扩展了一个可选的 `delegation` 字段：

```json
{
  "type": "A2A_HELLO",
  "protocol_version": "2.0",
  "initiator_bundle": { "...SignedBundleV2..." },
  "ephemeral_kem_public_key": { "..." },
  "nonce": "<hex>",
  "supported_algorithms": { "..." },
  "delegation": {
    "mandate_id": "dm:<uuid>",
    "mandate_hash": "sha256:<hex>",
    "delegator_principal_id": "principal:<identifier>",
    "delegator_organization_id": "org:<identifier>",
    "authority_scope": "procurement",
    "permissions_summary": ["negotiate", "issue_purchase_order", "request_information"],
    "valid_until": "2026-06-01T00:00:00Z",
    "mandate_signature_kid": "<principal-key-id>",
    "mirror_id": "pm:<uuid>",
    "mirror_hash": "sha256:<hex>"
  },
  "requested_capabilities": ["negotiate", "purchase_order"],
  "security_tier": "elevated",
  "timestamp": "2026-03-01T10:00:00Z"
}
```

<a id="83-mandate-verification-during-handshake"></a>

### 8.3 握手期间的授权书验证

当响应方收到带有 `delegation` 字段的 A2A_HELLO 时：

1. 根据授权书签名验证 `mandate_hash`（响应方可以缓存已验证的授权书）
2. 检查授权书未过期（`valid_until`）
3. 验证所请求的交互在授权书的 `authority_scope` 之内
4. 可选地从发起方的组织获取并验证完整授权书
5. 如果验证失败，以 `A2A_REJECT` 回应，原因为 `mandate_verification_failed`

<a id="84-mutual-mandate-verification"></a>

### 8.4 授权书相互验证

如果两个代理都在委托授权书下运行，双方都在各自的握手消息中包含 `delegation` 字段，并且都验证对方的授权书。这为双方提供了两个代理都有权参与该交互的相互保证。

<a id="9-audit-integration"></a>

## 9. 审计集成

<a id="91-delegation-audit-events"></a>

### 9.1 委托审计事件

| 事件 | `event_type` |
|-------|-------------|
| 签发委托授权书 | `delegation_mandate_issued` |
| 确认委托授权书 | `delegation_mandate_acknowledged` |
| 撤销委托授权书 | `delegation_mandate_revoked` |
| 创建认知阈值 | `awareness_threshold_created` |
| 更新认知阈值 | `awareness_threshold_updated` |
| 发出建议声明 | `advisory_declaration_issued` |
| 收到建议回应 | `advisory_response_received` |
| 创建主体镜像 | `principal_mirror_created` |
| 更新主体镜像 | `principal_mirror_updated` |
| 创建交互记录 | `interaction_record_created` |
| A2A 期间授权书验证通过 | `mandate_verified_a2a` |
| 授权书验证失败 | `mandate_verification_failed` |
| 签发再委托 | `sub_delegation_issued` |

<a id="92-audit-entry-format"></a>

### 9.2 审计条目格式

```json
{
  "dcp_version": "2.0",
  "event_id": "evt:<uuid>",
  "event_type": "advisory_declaration_issued",
  "agent_id": "agent:<identifier>",
  "details": {
    "advisory_id": "adv:<uuid>",
    "mandate_id": "dm:<uuid>",
    "principal_id": "principal:<identifier>",
    "urgency": "medium",
    "category": "uncertainty",
    "confidence_at_trigger": 0.42
  },
  "timestamp": "2026-03-01T14:30:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>"
}
```

<a id="10-security-considerations"></a>

## 10. 安全考虑

<a id="101-mandate-forgery"></a>

### 10.1 授权书伪造

被攻破的代理可能伪造委托授权书，以声称自己未被授予的权限。缓解措施：

- 授权书由主体的密钥签署，代理并不持有该密钥
- 对方用主体已知的公钥验证授权书签名
- 授权书哈希在签发时记录在审计链中，提供独立的验证途径

<a id="102-authority-escalation"></a>

### 10.2 权限升级

代理可能试图通过歪曲其授权书的范围来超越被委托的权限。缓解措施：

- 授权书许可是明确的且机器可验证
- 交互记录跟踪行使了哪些许可
- 对方在 A2A 握手期间验证所请求的行动在授权书范围之内
- 义务跟踪（DCP-08）监控越权行为

<a id="103-sub-delegation-abuse"></a>

### 10.3 再委托滥用

再委托会形成可能被利用的权限链。缓解措施：

- 再委托深度受每个祖先的 `sub_delegation.max_depth` 限制（第 3.5 节）
- 子授权书必须（MUST）比父授权书更窄：行动和数据类别是其子集，限制不更宽松，有效期窗口在父授权书之内，`minimum_security_tier` 不低于父授权书，因此子代理永远无法降低委托给它的一方的安全层级
- 完整的授权书链可以离线一直验证到人类主体：每一跳由上一个受托者签名，被撤销的祖先会使其所有后代失效
- 再委托默认禁用（`sub_delegation` 缺省或 `permitted: false`）

<a id="104-stale-awareness-thresholds"></a>

### 10.4 过时的认知阈值

在经过很长时间或经验发生重大变化之后，代理的认知阈值可能不再反映其实际理解。缓解措施：

- 认知阈值有版本，并在理解变化时更新
- 置信度大幅下降会触发建议声明
- 主体在定期审查授权书时审查认知阈值
- 对方可以检查认知阈值的时间戳以判断是否过时

<a id="105-narrative-manipulation"></a>

### 10.5 叙述操纵

交互记录的叙述层可能被精心编写以呈现误导性的描述。缓解措施：

- 技术层提供密码学上的事实依据
- 叙述中的说法可以与技术层的消息哈希核对
- 主体审查交互记录时会对照叙述和技术数据
- 对方保留自己的交互记录以便交叉验证

<a id="106-domain-separation"></a>

### 10.6 域分离

本规范使用三个域分离上下文（勘误 E5）：

- `DCP-AI.v2.Delegation` 用于根委托授权书、主体镜像和交互记录
- `DCP-AI.v2.Awareness` 用于认知阈值和建议声明
- `DCP-AI.v2.SubMandate` 用于子授权书（第 3.5 节），使委托代理签署的授权书永远无法冒充人类主体签署的授权书

前两个此处原先写作标签 `DCP-DELEGATION-SIG-v2` 和 `DCP-AWARENESS-SIG-v2`，它们不是 V2.0 上下文（DCP-AI v2.0 §4.1）。

这种分离防止一个上下文中的签名在另一个上下文中被重放。

<a id="11-conformance"></a>

## 11. 一致性

满足以下条件的实现符合 DCP-09：

1. 支持第 3 节定义的委托授权书的签发、确认和撤销
2. 按第 4 节的定义生成带版本和置信度得分的认知阈值
3. 按第 5 节的定义支持带紧急程度和主体回应的建议声明
4. 按第 6 节的定义生成带双重签名的主体镜像
5. 按第 7 节的定义创建同时包含技术层和叙述层的双层交互记录
6. 按第 8 节的定义以授权书验证扩展 A2A 握手
7. 按第 9 节的定义为所有委托事件创建 DCP-03 审计条目
8. 启用时支持再委托，并强制执行范围收窄
9. 按第 10.6 节的分配使用域分离上下文 `DCP-AI.v2.Delegation`、`DCP-AI.v2.Awareness` 和 `DCP-AI.v2.SubMandate`（勘误 E5）

<a id="references"></a>

## 参考资料

- DCP-01：身份与主体绑定
- DCP-02：意图声明与策略管控
- DCP-03：审计链与透明度
- DCP-04：代理间通信
- DCP-05：代理生命周期
- DCP-07：冲突解决
- DCP-08：权利与义务

---

*本规范认为，委托是人类与 AI 代理之间最根本的信任行为。通过使委托明确、有范围且可审计，并为代理提供正式机制来声明它们知道什么、不知道什么，DCP-09 为在可问责边界内的负责任自主奠定了基础。*

<a id="implementation-notes-informative"></a>

## 实现说明（参考性）

> **2026 年 10 月 25 日添加。非规范性。** 这些说明不增加任何要求，也不改变上文任何内容：它们描述 `main` 上的参考代码
> 与本文的关系。两者不一致时，以上文的规范性文本为准，并适用
> [V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md) 的勘误所作的更正。

- **SDK 验证什么。** §3.5 的授权书链已在四个签名 SDK 中实现，并用 `tests/interop/v2/mandate_chain_vectors.json`
  检查。DCP-09 的其余部分是 SDK 构建并签署的记录，而不是它们执行或强制的协议步骤。
- **`schemas/v2/` 中的记录。** schema 的字段与 §3 至 §9 的示例不同。授权书的有效期窗口是 `valid_from` /
  `valid_until`（§3.6 依勘误 E6 读作 `valid_until`；§3.2 示例是概念性的），并带有 `authority_scope` 和
  `revocable`。认知阈值是一个 `threshold_rules` 列表（`dimension`、`operator`、`value`、`action_if_triggered`），
  而不是 §4.2 的置信度声明。建议声明带有整数 `significance_score`（0–1000）、`action_summary`、
  `recommended_response`、`response_deadline` 和 `human_response`，没有 §5.3 和 §5.4 的紧急程度或类别。主体镜像带有
  `narrative`、`decision_summary`、`action_count` 和 `audit_chain_hash`。交互记录带有 `public_layer`（`terms`、
  `decisions`、`commitments`）、`private_layer_hash` 和 `mandate_id`，没有 §7.3 和 §7.5 的 Merkle 根或合规部分。
- **签名。** 根授权书带有 `human_composite_sig`（上下文 `DCP-AI.v2.Delegation`），子授权书带有
  `delegator_composite_sig`（`DCP-AI.v2.SubMandate`）。其他每种记录只带一个 `composite_sig`，由持有所传入密钥的一方
  签署：认知阈值和建议声明使用 `DCP-AI.v2.Awareness`，主体镜像和交互记录使用 `DCP-AI.v2.Delegation`。没有代理对
  授权书的确认（§3.3），镜像上也没有主体的第二个签名（§6.3）。
- **辅助函数做什么。** `verifyMandateValidity` 只检查已撤销 ID 集合和有效期窗口，不检查签名或范围。
  `revoke_delegation`（Python）在授权书为 `revocable` 时把 ID 加入一个本地集合；它不会产生已签名的撤销记录（§3.6）。
  `generateMirror` 对收到的审计条目计算哈希（SHA-256），并签署调用方撰写的叙述和摘要；它既不撰写叙述，也不取得任何
  批准。`A2A_HELLO` 和 `A2A_WELCOME` 类型有可选的 `mandate_id` 和 `mandate_hash` 字段，但没有任何 SDK 在握手期间
  验证授权书（§8.3），也没有任何 SDK 发送 `A2A_REJECT`。
- 示例是带有占位符的说明，而不是 fixtures。`"confidence": 0.95` 这样的小数值无法在 `dcp-jcs-v1` 下规范化，因此
  按原样书写的这些记录无法签名。SDK 类型请参阅 [docs/API_REFERENCE.md](../docs/API_REFERENCE.md)。
