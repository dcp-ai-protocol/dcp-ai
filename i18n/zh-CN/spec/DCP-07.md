<sub>[English](../../../spec/DCP-07.md) · **中文** · [Español](../../es/spec/DCP-07.md) · [日本語](../../ja/spec/DCP-07.md) · [Português](../../pt-BR/spec/DCP-07.md)</sub>

<a id="dcp-07-conflict-resolution"></a>

# DCP-07：冲突解决

> 本文是[英文规范](../../../spec/DCP-07.md)的参考译文，更新于 25/10/2026。**具有规范效力的是英文版**：本译文不具规范效力，如有出入，以英文版为准。标识符和代码块保持原文，不作翻译。

<a id="status"></a>

## 状态
已发布 — v2.0（扩展；修订根据采用者的反馈跟踪）

<a id="abstract"></a>

## 摘要
本规范定义一个结构化、可审计的协议，用于解决经 DCP 认证的 AI 代理之间的冲突。它引入三级升级模型（直接协商、情境仲裁、人工申诉）、带类型的争议记录、M-of-N 仲裁小组、用于跟踪先例的判例包，以及用于正式表达异议的异议记录。所有冲突解决工件都经过密码学签名并以哈希链接，从而为每一项争议及其解决生成可发现篡改的记录。

<a id="1-introduction"></a>

## 1. 引言

随着在 DCP 下运行的 AI 代理之间的交互日益增多（DCP-04），冲突在所难免。代理可能争夺共享资源、从不同主体收到相互矛盾的指令、对能力边界产生分歧，或对策略作出不同的解释。没有正式的解决机制，这些冲突要么在缺乏结构化上下文的情况下升级给人工操作员，要么导致死锁和连锁故障。

DCP-07 提供一个协议层面的冲突解决框架，它：

- 按类型对争议分类，以便采用合适的解决策略
- 定义从代理之间协商开始的三级升级模型
- 为每一项争议、每一次解决尝试和每一个结果创建可审计的已签名记录
- 建立一个判例体系，使已解决的争议成为先例
- 保障任何一方正式反对某项解决的权利

<a id="11-design-principles"></a>

### 1.1 设计原则
- 冲突应在尽可能低的层级解决
- 每一项争议和每一次解决尝试都会被签名并记录
- 人工申诉始终可作为最后手段
- 已解决的争议形成先例，改进未来的解决
- 任何代理都不会在无法提出异议的情况下被迫接受某项解决

<a id="12-relationship-to-other-specifications"></a>

### 1.2 与其他规范的关系
- **DCP-01**：代理身份决定其提起或回应争议的资格
- **DCP-02**：策略冲突是一种主要的争议类型；策略结果构成争议的上下文
- **DCP-03**：所有争议事件都记录在审计链中
- **DCP-04**：争议协商消息通过 A2A 信道交换
- **DCP-05**：处于 `declining` 状态的代理参与争议的能力有限
- **DCP-08**：权利侵犯（DCP-08）会触发本规范下的争议

<a id="2-terminology"></a>

## 2. 术语

**争议**：一个或多个代理就存在需要解决的冲突所作的正式声明。

**争议方**：作为争议当事方的代理，可以是发起方（申诉方）或被申诉方。

**升级层级**：三个解决阶段之一：`direct_negotiation`、`contextual_arbitration` 或 `human_appeal`。

**仲裁小组**：在情境仲裁层级为解决争议而召集的一组代理（或代理与人员混合的小组）。决定需要 M-of-N 的一致意见。

**判例包**：已解决争议的封存记录，包括上下文、论点和结果，作为未来争议的先例。

**异议记录**：对解决结果表示不同意的正式、已签名声明。

**域分离标签**：`DCP-DISPUTE-SIG-v2`，用于本规范下产生的所有签名。

<a id="3-dispute-types"></a>

## 3. 争议类型

<a id="31-classification"></a>

### 3.1 分类

争议分为四种类型，每种类型具有各自的解决特点：

| 类型 | 代码 | 说明 | 默认初始层级 |
|------|------|-------------|----------------------|
| **资源冲突** | `resource_conflict` | 两个或更多代理争夺同一有限资源（计算、数据访问、API 配额、网络带宽） | `direct_negotiation` |
| **指令冲突** | `directive_conflict` | 代理从多个主体，或从某个主体和组织策略收到相互矛盾的指令 | `contextual_arbitration` |
| **能力冲突** | `capability_conflict` | 对某个代理是否具备执行特定行动的能力或权限存在分歧 | `direct_negotiation` |
| **策略冲突** | `policy_conflict` | 两个或更多代理对共享策略的解释不同，或某个代理的行动与另一个代理的策略约束相冲突 | `direct_negotiation` |

<a id="32-severity-levels"></a>

### 3.2 严重程度

每项争议都带有一个影响升级时限的严重程度：

| 严重程度 | 代码 | 升级时限 |
|----------|------|-------------------|
| **低** | `low` | 每个层级 24 小时 |
| **中** | `medium` | 每个层级 4 小时 |
| **高** | `high` | 每个层级 1 小时 |
| **严重** | `critical` | 每个层级 15 分钟 |

如果争议未能在当前层级的升级时限内解决，必须（MUST）自动升级到下一个层级。

<a id="4-dispute-record"></a>

## 4. 争议记录

### 4.1 Schema

Schema 参考：`schemas/v2/dispute_record.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "dispute_record",
  "dispute_id": "disp:<uuid>",
  "dispute_type": "resource_conflict",
  "severity": "medium",
  "status": "open",
  "current_escalation_level": "direct_negotiation",
  "complainant": {
    "agent_id": "agent:<complainant-identifier>",
    "principal_id": "principal:<identifier>",
    "organization_id": "org:<identifier>"
  },
  "respondents": [
    {
      "agent_id": "agent:<respondent-identifier>",
      "principal_id": "principal:<identifier>",
      "organization_id": "org:<identifier>"
    }
  ],
  "subject": {
    "description": "Both agents require exclusive write access to the shared procurement database during the same time window",
    "resource_identifiers": ["resource:procurement-db:write-lock"],
    "related_intent_ids": ["intent:<uuid-a>", "intent:<uuid-b>"],
    "related_policy_ids": ["policy:<uuid>"],
    "related_audit_entries": ["evt:<uuid>", "evt:<uuid>"]
  },
  "evidence": [
    {
      "evidence_id": "evd:<uuid>",
      "submitted_by": "agent:<complainant-identifier>",
      "evidence_type": "intent_declaration",
      "reference": "intent:<uuid-a>",
      "description": "Complainant's intent declaration for procurement database access",
      "content_hash": "sha256:<hex>",
      "submitted_at": "2026-03-01T10:00:00Z"
    },
    {
      "evidence_id": "evd:<uuid>",
      "submitted_by": "agent:<respondent-identifier>",
      "evidence_type": "intent_declaration",
      "reference": "intent:<uuid-b>",
      "description": "Respondent's concurrent intent declaration for the same resource",
      "content_hash": "sha256:<hex>",
      "submitted_at": "2026-03-01T10:01:00Z"
    }
  ],
  "precedents_cited": [
    {
      "jurisprudence_id": "jur:<uuid>",
      "relevance": "Previous resource conflict resolved by time-sharing; similar resource type and contention pattern"
    }
  ],
  "timeline": [
    {
      "event": "dispute_opened",
      "timestamp": "2026-03-01T10:05:00Z",
      "actor": "agent:<complainant-identifier>"
    }
  ],
  "escalation_deadline": "2026-03-01T14:05:00Z",
  "opened_at": "2026-03-01T10:05:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<complainant-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-DISPUTE-SIG-v2"
  }
}
```

<a id="42-dispute-lifecycle"></a>

### 4.2 争议生命周期

```
 opened ──> negotiating ──> escalated ──> arbitrating ──> escalated ──> appealing ──> resolved
                │                              │                              │
                └──────── resolved ◄───────────┘──────── resolved ◄───────────┘
                                                                              │
                                                                    withdrawn/abandoned
```

有效状态：`open`、`negotiating`、`escalated`、`arbitrating`、`appealing`、`resolved`、`withdrawn`、`abandoned`。

如果所有升级时限均已到期仍未解决，且没有任何一方寻求进一步升级，争议即为 `abandoned`。

<a id="5-three-level-escalation-model"></a>

## 5. 三级升级模型

<a id="51-level-1-direct-negotiation"></a>

### 5.1 第 1 级：直接协商

争议代理通过 DCP-04 的 A2A 消息直接尝试解决冲突。

**流程：**

1. 申诉方创建争议记录并通过 A2A 发送给被申诉方，从而开启争议
2. 被申诉方确认收到，并提供反证或解决提议
3. 各代理交换解决提议
4. 如果某项提议被所有当事方接受，争议即告解决
5. 解决结果记录在仲裁解决记录中（第 6 节）

**协商策略**（实现可以（MAY）支持）：

- **分时**：代理轮流使用有争议的资源
- **基于优先级**：优先级更高（根据策略或主体指令）的代理先行
- **基于能力**：能力相关性更强的代理先行
- **随机**：密码学上公平的掷硬币（承诺-揭示方案）

**升级触发条件**：如果在升级时限内协商失败，争议必须（MUST）升级到第 2 级。

<a id="52-level-2-contextual-arbitration"></a>

### 5.2 第 2 级：情境仲裁

召集仲裁小组来解决争议。

**小组组成：**

1. 每个争议方从预先批准的仲裁员池中提名一名或多名小组候选人
2. 组成一个 M-of-N 小组（至少 3 名成员，默认 M=2、N=3）
3. 小组成员不得（MUST NOT）与任何争议方存在进行中的争议
4. 小组成员的活力必须（MUST）高于 600（DCP-05）
5. 小组成员必须（MUST）处于 `active` 生命周期状态

**仲裁流程：**

1. 小组审阅争议记录、证据和所引用的先例
2. 小组可以（MAY）要求争议方提供补充证据
3. 小组成员独立评估并提出解决方案
4. 小组投票；具有约束力的解决需要 M-of-N 的一致意见
5. 解决结果连同每位小组成员的投票一并记录

**小组决定类型：**

- `binding_resolution` — 所有当事方都必须遵守
- `recommended_resolution` — 无约束力的建议；当事方可以接受或升级
- `split_decision` — 小组未能达到 M-of-N；自动升级到第 3 级

<a id="53-level-3-human-appeal"></a>

### 5.3 第 3 级：人工申诉

争议升级给人类主体解决。

**流程：**

1. 向所有争议方的负责主体提交完整的争议记录、证据、仲裁经过以及所有异议
2. 主体可以商议、协商或适用组织策略
3. 人工决定作为最终的、具有约束力的解决结果记录下来
4. 如果主体无法达成一致，则适用组织的升级程序（不在 DCP 范围内）

**人工申诉的保障：**

- 任何争议方都可以（MAY）随时升级到人工申诉，跳过前面的层级
- 严重程度为 critical 的争议可以（MAY）直接从人工申诉层级开始
- 在 DCP 协议内，人工决定是最终决定

<a id="6-arbitration-resolution"></a>

## 6. 仲裁解决

### 6.1 Schema

Schema 参考：`schemas/v2/arbitration_resolution.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "arbitration_resolution",
  "resolution_id": "res:<uuid>",
  "dispute_id": "disp:<uuid>",
  "resolution_level": "contextual_arbitration",
  "resolution_type": "binding_resolution",
  "outcome": {
    "description": "Time-sharing arrangement: Agent A has exclusive access during 00:00-12:00 UTC, Agent B during 12:00-24:00 UTC",
    "actions_required": [
      {
        "agent_id": "agent:<agent-a>",
        "action": "Restrict procurement database write access to 00:00-12:00 UTC window",
        "deadline": "2026-03-02T00:00:00Z"
      },
      {
        "agent_id": "agent:<agent-b>",
        "action": "Restrict procurement database write access to 12:00-24:00 UTC window",
        "deadline": "2026-03-02T00:00:00Z"
      }
    ],
    "compliance_verification_method": "audit_chain_review",
    "compliance_deadline": "2026-03-09T00:00:00Z"
  },
  "reasoning": "Both agents have equally valid intent declarations for the resource. Historical precedent (jur:abc123) established time-sharing as the preferred resolution for symmetric resource conflicts. Agent A's intent was filed 60 seconds earlier, granting first selection of time window.",
  "precedents_applied": [
    {
      "jurisprudence_id": "jur:<uuid>",
      "applicability": "Directly applicable: same resource type, symmetric priority"
    }
  ],
  "panel": {
    "members": [
      {
        "agent_id": "agent:<arbitrator-1>",
        "vote": "approve",
        "reasoning_hash": "sha256:<hex>"
      },
      {
        "agent_id": "agent:<arbitrator-2>",
        "vote": "approve",
        "reasoning_hash": "sha256:<hex>"
      },
      {
        "agent_id": "agent:<arbitrator-3>",
        "vote": "dissent",
        "reasoning_hash": "sha256:<hex>"
      }
    ],
    "threshold": {
      "m": 2,
      "n": 3
    },
    "votes_for": 2,
    "votes_against": 1
  },
  "effective_at": "2026-03-01T16:00:00Z",
  "expires_at": "2026-06-01T00:00:00Z",
  "timestamp": "2026-03-01T15:30:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signatures": [
    {
      "agent_id": "agent:<arbitrator-1>",
      "alg": "ed25519",
      "kid": "<key-id>",
      "sig_b64": "...",
      "domain_sep": "DCP-DISPUTE-SIG-v2"
    },
    {
      "agent_id": "agent:<arbitrator-2>",
      "alg": "ed25519",
      "kid": "<key-id>",
      "sig_b64": "...",
      "domain_sep": "DCP-DISPUTE-SIG-v2"
    }
  ]
}
```

<a id="62-resolution-compliance"></a>

### 6.2 遵守解决结果

在作出有约束力的解决之后：

1. 所有当事方必须（MUST）在指定期限前遵守
2. 通过解决结果中指定的方法（通常是审查审计链）核实遵守情况
3. 不遵守本身即构成一项争议（类型：`policy_conflict`），并直接升级到人工申诉
4. 反复不遵守可以（MAY）触发因故终止（DCP-05）

<a id="7-jurisprudence-bundle"></a>

## 7. 判例包

<a id="71-purpose"></a>

### 7.1 目的

已解决的争议被打包为判例包：可引用的封存记录，作为未来争议解决的先例。这会形成一套不断演进的“判例法”，随着时间推移提高解决结果的一致性。

### 7.2 Schema

Schema 参考：`schemas/v2/jurisprudence_bundle.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "jurisprudence_bundle",
  "jurisprudence_id": "jur:<uuid>",
  "dispute_id": "disp:<uuid>",
  "resolution_id": "res:<uuid>",
  "classification": {
    "dispute_type": "resource_conflict",
    "resource_category": "database_access",
    "resolution_pattern": "time_sharing",
    "tags": ["symmetric_priority", "exclusive_access", "periodic_resource"]
  },
  "summary": {
    "facts": "Two agents with equivalent priority both declared intent to access the same exclusive-write resource during overlapping time windows.",
    "holding": "Time-sharing arrangement based on filing order, with the earlier-filing agent selecting preferred time window.",
    "rationale": "Symmetric priority conflicts for periodic resources are best resolved by time division. Filing order provides a fair, deterministic tie-breaker.",
    "dissent": "Dissenting arbitrator argued for capability-based priority, where the agent with greater procurement-domain capability should receive priority access."
  },
  "applicability": {
    "applicable_dispute_types": ["resource_conflict"],
    "applicable_conditions": [
      "Two or more agents with equal priority",
      "Exclusive-access resource that supports time division",
      "No principal directive establishing priority"
    ],
    "inapplicable_conditions": [
      "Non-divisible resource (e.g., one-time-use token)",
      "Asymmetric principal-directed priority"
    ]
  },
  "supersedes": [],
  "superseded_by": null,
  "authority_level": "contextual_arbitration",
  "created_at": "2026-03-01T16:00:00Z",
  "dispute_record_hash": "sha256:<hex>",
  "resolution_record_hash": "sha256:<hex>",
  "objections": [],
  "timestamp": "2026-03-01T16:00:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<panel-lead-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-DISPUTE-SIG-v2"
  }
}
```

<a id="73-precedent-matching"></a>

### 7.3 先例匹配

开启新争议时，代理和仲裁小组应当（SHOULD）在判例登记库中查找可适用的先例：

1. 按 `dispute_type` 筛选
2. 按 `applicable_conditions` 匹配
3. 依据 `inapplicable_conditions` 排除
4. 按 `authority_level` 排序（human_appeal > contextual_arbitration > direct_negotiation）
5. 裁决相互冲突时，优先采用较新的先例

先例只具参考性，不具严格约束力。仲裁小组和人类主体可以（MAY）在记录理由的前提下偏离先例。

<a id="74-supersession"></a>

### 7.4 取代

判例包可能被后来就同一问题作出的裁决所取代。被取代时：

- 更新 `superseded_by` 字段，使其引用新的判例包
- 取代方判例包的 `supersedes` 字段列出被取代的旧判例包
- 被取代的判例包保留在登记库中供历史参考，但在先例匹配中降低优先级

<a id="8-objection-record"></a>

## 8. 异议记录

<a id="81-purpose"></a>

### 8.1 目的

任何争议方都可以对解决结果正式提出异议。异议以带有签名和时间戳的工件形式记录，成为争议永久记录的一部分。提出异议不会自动推翻解决结果，但会保留代理的不同意见，并可能为未来的申诉或对先例的质疑提供支持。

### 8.2 Schema

Schema 参考：`schemas/v2/objection_record.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "objection_record",
  "objection_id": "obj:<uuid>",
  "dispute_id": "disp:<uuid>",
  "resolution_id": "res:<uuid>",
  "objecting_party": {
    "agent_id": "agent:<identifier>",
    "principal_id": "principal:<identifier>"
  },
  "objection_type": "procedural",
  "grounds": {
    "summary": "Panel member agent:<arbitrator-3> had a prior undisclosed resource dependency on the respondent, creating a conflict of interest",
    "detailed_reasoning": "Audit chain analysis reveals that arbitrator-3 and the respondent shared 47 A2A sessions in the preceding 30 days, establishing a working relationship that was not disclosed during panel formation. This violates the independence requirement of Section 5.2.",
    "evidence_references": [
      "evt:<uuid-session-log-1>",
      "evt:<uuid-session-log-2>"
    ],
    "precedent_references": []
  },
  "requested_remedy": {
    "type": "panel_reconstitution",
    "description": "Request reconstitution of the arbitration panel with verified independent members and re-hearing of the dispute"
  },
  "status": "filed",
  "filed_at": "2026-03-01T17:00:00Z",
  "timestamp": "2026-03-01T17:00:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<objecting-agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-DISPUTE-SIG-v2"
  }
}
```

<a id="83-objection-types"></a>

### 8.3 异议类型

| 类型 | 代码 | 说明 |
|------|------|-------------|
| **实体性** | `substantive` | 解决结果在实质上是错误的；证据或推理不支持该结果 |
| **程序性** | `procedural` | 解决过程存在缺陷（小组偏见、遗漏证据、超出范围） |
| **先例** | `precedent` | 解决结果在没有充分理由的情况下与既定判例相冲突 |
| **权利** | `rights` | 解决结果侵犯了 DCP-08 所定义的代理权利 |

<a id="84-objection-handling"></a>

### 8.4 异议处理

1. 已提出的异议附加到争议记录中，并纳入判例包
2. 除非人类主体下令暂缓，解决结果继续有效
3. 类型为 `rights` 的异议必须（MUST）转交人工申诉层级审查
4. 异议为将来对先例提出质疑（第 7.4 节）提供依据

<a id="9-audit-integration"></a>

## 9. 审计集成

<a id="91-dispute-audit-events"></a>

### 9.1 争议审计事件

所有争议生命周期事件都会生成 DCP-03 审计条目：

| 事件 | `event_type` |
|-------|-------------|
| 开启争议 | `dispute_opened` |
| 提交证据 | `dispute_evidence_submitted` |
| 发送协商提议 | `dispute_negotiation_proposal` |
| 争议已升级 | `dispute_escalated` |
| 组成仲裁小组 | `arbitration_panel_formed` |
| 小组投票 | `arbitration_vote_cast` |
| 发布解决结果 | `dispute_resolved` |
| 提出异议 | `dispute_objection_filed` |
| 已核实遵守解决结果 | `dispute_compliance_verified` |
| 未遵守解决结果 | `dispute_compliance_failed` |

<a id="92-cross-agent-audit-consistency"></a>

### 9.2 跨代理审计一致性

由于争议涉及多个代理，审计人员应当（SHOULD）验证跨链一致性：

1. 两个争议方的审计链应引用同一个 `dispute_id`
2. 证据提交时间戳在各链之间应一致
3. 解决记录应出现在所有争议方的链中

<a id="10-security-considerations"></a>

## 10. 安全考虑

<a id="101-panel-independence"></a>

### 10.1 小组独立性

仲裁小组成员必须（MUST）独立于争议方。通过以下方面核实独立性：

- 在此前 30 天内（可配置）与任何争议方都没有活动的 A2A 会话
- 与任何争议方都没有共同的主体
- 没有涉及任何争议方的进行中争议
- 活力高于 600，以确保可靠参与

<a id="102-evidence-integrity"></a>

### 10.2 证据完整性

所有证据引用都按内容寻址（哈希）。证据在提交后无法在不被发现的情况下被更改。实现应当（SHOULD）：

- 证据一经提交即以不可变方式存储
- 拒绝内容哈希不匹配的证据
- 在审计链中为证据提交加盖时间戳

<a id="103-dispute-flooding"></a>

### 10.3 争议泛滥

恶意代理可能提交无根据的争议，以压垮对方或仲裁资源。缓解措施：

- 速率限制：每个代理在每个时间段内的争议数上限（可配置，默认：每 24 小时 10 项）
- 提交成本：提交的争议被裁定对其不利的代理会累积争议分数，从而提高其提交门槛
- 严重程度验证：严重程度为 critical 的争议在提交时需要佐证证据

<a id="104-panel-collusion"></a>

### 10.4 小组串通

M-of-N 仲裁可以减轻个人偏见，但无法防止有组织的串通。缓解措施：

- 小组成员从分布于各组织的池中选出
- 在可能的情况下，小组成员的选择使用可验证随机函数
- 不同意见被永久记录
- 人工申诉始终可用

<a id="105-domain-separation"></a>

### 10.5 域分离

本规范下的所有签名都使用域分离标签 `DCP-DISPUTE-SIG-v2`，以防止跨协议的签名重放。

<a id="11-conformance"></a>

## 11. 一致性

满足以下条件的实现符合 DCP-07：

1. 支持第 3 节定义的全部四种争议类型
2. 实现第 5 节定义的三级升级模型
3. 按第 5.2 节的定义支持阈值可配置的 M-of-N 仲裁小组
4. 生成符合第 4、6、8 节 schema 的争议记录、仲裁解决和异议记录
5. 按第 7 节的定义将已解决的争议打包为判例包
6. 按第 3.2 节的定义执行基于严重程度的升级时限
7. 按第 9 节的定义为所有争议事件创建 DCP-03 审计条目
8. 所有签名都使用域分离标签 `DCP-DISPUTE-SIG-v2`

<a id="references"></a>

## 参考资料

- DCP-01：身份与主体绑定
- DCP-02：意图声明与策略管控
- DCP-03：审计链与透明度
- DCP-04：代理间通信
- DCP-05：代理生命周期
- DCP-08：权利与义务

---

*本规范认为，冲突不是多代理系统的失败，而是其固有特征。衡量一个协议的标准不在于是否会出现冲突，而在于冲突能否得到公平、透明且完全可问责的解决。*

<a id="implementation-notes-informative"></a>

## 实现说明（参考性）

> **2026 年 10 月 25 日添加。非规范性。** 这些说明不增加任何要求，也不改变上文任何内容：它们描述 `main` 上的参考代码
> 与本文的关系。两者不一致时，以上文的规范性文本为准。

- **`schemas/v2/` 中的记录。** SDK 构建、`schemas/v2/` 验证的争议记录、仲裁解决、判例包和异议记录，其字段与
  §4 至 §8 的示例不同。争议只有一个 `respondent_agent_id`，有 `evidence_hashes`，没有严重程度或时限；其 `status`
  是 `open`、`in_negotiation`、`arbitrated`、`appealed` 或 `resolved` 之一，而不是 §4.2 的八种状态。异议引用一个
  `directive_hash`，其 `objection_type` 是 `ethical`、`safety`、`policy_violation` 或 `capability_mismatch`，而不是
  §8.3 的四种类型。判例包的 `authority_level` 是 `local`、`organizational` 或 `cross_org`。
- **签名。** 每条记录只带一个 `composite_sig`（Ed25519 + ML-DSA-65），由持有所传入密钥的一方在上下文
  `DCP-AI.v2.Dispute` 下签署；SDK 不使用标签 `DCP-DISPUTE-SIG-v2`。
- **辅助函数做什么。** 它们构建并签署记录；只有在调用方要求时才会升级和解决。无论争议类型如何，`createDispute`
  总是从 `direct_negotiation`、状态 `open` 开始。`escalateDispute` 上升一个层级并设置 `in_negotiation`；由于没有
  计时器，任何争议都不会因时限到期而升级。`resolveDispute` 在任何层级都设置 `resolved`。`createArbitrationPanel`
  只检查阈值至少为 1，且仲裁员 ID 不少于该数目；它不检查独立性、活力或生命周期状态，`submitResolution` 用一个密钥
  签署收到的仲裁员 ID 和文本，不收集投票。`lookupPrecedent` 按 `category` 以及可选的一个上下文筛选；不进行排序。
- 这些记录是签名者所作的已签名声明；SDK 和服务都不会强制执行解决结果。示例是带有占位符的说明，而不是 fixtures。
  SDK 类型请参阅 [docs/API_REFERENCE.md](../../../docs/API_REFERENCE.md)。
