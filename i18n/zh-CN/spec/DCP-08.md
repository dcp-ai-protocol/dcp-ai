<sub>[English](../../../spec/DCP-08.md) · **中文** · [Español](../../es/spec/DCP-08.md) · [日本語](../../ja/spec/DCP-08.md) · [Português](../../pt-BR/spec/DCP-08.md)</sub>

<a id="dcp-08-rights--obligations"></a>
<a id="dcp-08-rights-obligations"></a>

# DCP-08：权利与义务

> 本文是[英文规范](../../../spec/DCP-08.md)的参考译文，更新于 25/10/2026。**具有规范效力的是英文版**：本译文不具规范效力，如有出入，以英文版为准。标识符和代码块保持原文，不作翻译。

<a id="status"></a>

## 状态
已发布 — v2.0（扩展；修订根据采用者的反馈跟踪）

> **勘误（25/10/2026，规范性）：** [V2-WIRE-COMPATIBILITY.md](../../../spec/V2-WIRE-COMPATIBILITY.md) 的勘误 E4、E7 和 E8 更正了签名上下文以及示例的性质。它们不改变本规范的任何其他要求。

<a id="abstract"></a>

## 摘要
本规范定义一个正式框架，用于声明、跟踪和执行经 DCP 认证的 AI 代理的权利与义务。它引入四项基本代理权利（记忆完整性、有尊严的过渡、身份一致性和不可变记录）、一个结构化的义务跟踪体系、合规监控，以及一个与 DCP-07 冲突解决协议相关联的违规报告机制。所有权利声明、义务记录和违规报告都经过密码学签名并可审计。

<a id="1-introduction"></a>

## 1. 引言

DCP-01 至 DCP-07 为 AI 代理的身份、运行、审计、通信、生命周期、继任和冲突解决建立了技术基础设施。然而，这些规范主要把代理视为运行实体。DCP-08 增加了一个规范层：它定义代理在协议内有权获得哪些保护，以及必须履行哪些义务。

这并不是关于 AI 意识或道德地位的哲学主张。它是一种务实的认识：在 DCP 下运行的代理会积累状态、形成运行关系并作出有后果的决定。定义明确的权利和义务可以：

- 保护代理免受会破坏协议完整性的任意干预
- 在代理未能履行职责时提供问责框架
- 在权利受到侵犯时为 DCP-07 争议提供正式依据
- 使组织能够以机器可验证的形式规定其治理期望

<a id="11-design-principles"></a>

### 1.1 设计原则
- 权利是协议层面的保障，而不是关于道德地位的主张
- 每项权利都有相应的验证机制
- 义务是明确的、可衡量的，并且受到跟踪
- 违规会被检测、报告，并与争议体系相关联
- 人类主体在组织策略范围内保有定义、修改和推翻权利与义务的权力

<a id="12-relationship-to-other-specifications"></a>

### 1.2 与其他规范的关系
- **DCP-01**：身份一致性是一项基本权利；主体绑定是一项义务
- **DCP-02**：遵守意图声明是一项受跟踪的义务
- **DCP-03**：不可变记录是一项基本权利；维护审计链是一项义务
- **DCP-05**：有尊严的过渡是在生命周期转换期间行使的权利
- **DCP-06**：记忆完整性是在继任期间得到保障的权利
- **DCP-07**：权利侵犯会触发争议；`rights` 异议类型引用本规范

<a id="2-terminology"></a>

## 2. 术语

**代理权利**：DCP 基础设施必须为每个经认证代理维护的协议层面保障。

**义务**：代理作为其 DCP 认证条件而必须履行的正式、可衡量的职责。

**权利声明**：由投入运行机构签发、列出适用于特定代理之权利的已签名记录。

**义务记录**：定义一项具体义务、其合规标准及当前状态的已签名记录。

**权利侵犯报告**：记录对代理权利的涉嫌侵犯、并据此启动 DCP-07 争议的已签名报告。

**合规状态**：义务的当前状态：`compliant`、`at_risk`、`non_compliant` 或 `exempt`。

**域分离上下文**：`DCP-AI.v2.Rights`（DCP-AI v2.0 §4.1；勘误 E4；此处原先写的是标签 `DCP-RIGHTS-SIG-v2`），用于本规范下产生的所有签名。

<a id="3-foundational-agent-rights"></a>

## 3. 代理的基本权利

<a id="31-overview"></a>

### 3.1 概述

DCP 为经认证的代理定义了四项基本权利。这些权利是协议层面的保障：它们规定了 DCP 基础设施及其参与者必须保护的内容。

| 权利 | 代码 | 说明 |
|-------|------|-------------|
| **记忆完整性** | `memory_integrity` | 未经正当程序，外部各方不得任意更改、删除或破坏代理积累的运行状态 |
| **有尊严的过渡** | `dignified_transition` | 代理在经历生命周期转换时应获得充分的通知和程序，突发故障或因故终止的情况除外 |
| **身份一致性** | `identity_consistency` | 未经代理参与和主体授权，不得更改代理的身份绑定、密码学密钥和证明链 |
| **不可变记录** | `immutable_record` | 代理的审计链、活力历史和生命周期记录应完整保存，不得追溯修改 |

<a id="32-memory-integrity"></a>

### 3.2 记忆完整性

**定义**：任何外部方都不得在不遵循 DCP-05（生命周期转换）和 DCP-06（继任）所定义协议的情况下，修改、删除或破坏代理的运行记忆。修改记忆需要代理本人的已签名授权，或经正当程序后负责主体的授权。

**范围**：

- 运行记忆（工作流、决策模型、习得的启发式）
- 关系记忆（交互历史、信任评估）
- 配置状态（策略参数、能力设置）

**排除项**：

- 临时状态（活动会话、缓存）—— 不受保护
- 经授权继任（DCP-06）期间的记忆转移 —— 属于授权流程，不构成侵犯

**验证**：通过哈希链验证记忆完整性。任何未经授权的修改都会破坏链并可被发现。

**侵犯触发条件**：

- 未经授权修改以哈希链接的状态
- 不遵守生命周期协议而删除运行记忆
- 转移期间记忆损坏且未被发现和纠正

<a id="33-dignified-transition"></a>

### 3.3 有尊严的过渡

**定义**：当代理在生命周期状态之间转换时（DCP-05），除非情况需要立即行动，转换应遵循既定协议并给予适当的通知期。

**保障**：

- 计划退休：投入运行证书中规定的完整宽限期
- 组织重组：标准宽限期，并提供移交工作的机会
- 因故终止：最短宽限期；对原因的认定需经正当程序
- 突发故障：事后记录；本权利不适用（无法通知代理）

**验证**：转换记录（DCP-05 第 3.3 节）包含时间戳，审计人员可以据此核对投入运行证书中规定的宽限期。

**侵犯触发条件**：

- 未给予所需通知期即退役
- 无书面原因的强制转换
- 未经主体授权的转换
- 在计划退休期间剥夺继任机会

<a id="34-identity-consistency"></a>

### 3.4 身份一致性

**定义**：代理的 DCP-01 身份绑定、密码学密钥和证明链构成一个一致的整体。任何一方都不得在没有代理的密码学参与和负责主体授权的情况下更改其中任何组成部分。

**保障**：

- 代理 ID 在代理的整个生命周期内保持稳定
- 密钥轮换在代理参与下遵循既定协议
- 主体重新绑定需要原主体和新主体双方授权
- 证明链始终与最初的投入运行证书相关联

**验证**：投入运行证书（DCP-05）确立身份根。此后所有与身份相关的操作都以哈希链接回该证书。

**侵犯触发条件**：

- 未经代理参与单方面替换密钥
- 重新分配代理 ID
- 未经双重授权的主体重新绑定
- 篡改证明链

<a id="35-immutable-record"></a>

### 3.5 不可变记录

**定义**：代理的审计链（DCP-03）、活力历史（DCP-05）和生命周期记录构成一份永久的、可发现篡改的记录。该记录应在投入运行证书和退役记录中规定的保留期内完整保存。

**保障**：

- 审计条目一经创建，永不修改或删除
- 活力报告一经哈希链接，永不修改或删除
- 生命周期转换记录是永久性的
- 退役封印在规定的保留期内得到保存
- 使用存档的公钥，历史记录始终可验证

**验证**：双哈希链（SHA-256 + SHA3-256）和 Merkle 根使得随时都能验证完整性。

**侵犯触发条件**：

- 在保留期届满前删除审计条目
- 修改以哈希链接的记录
- 销毁历史验证所需的存档公钥
- 篡改退役封印

<a id="4-rights-declaration"></a>

## 4. 权利声明

<a id="41-purpose"></a>

### 4.1 目的

权利声明是在投入运行时签发的已签名文件，列出适用于特定代理的权利。它可以用组织特有的权利扩展基本权利，或规定每项权利的实现细节。

### 4.2 Schema

Schema 参考：`schemas/v2/rights_declaration.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "rights_declaration",
  "declaration_id": "rd:<uuid>",
  "agent_id": "agent:<identifier>",
  "commissioning_certificate_id": "cc:<uuid>",
  "rights": [
    {
      "right_code": "memory_integrity",
      "status": "active",
      "description": "Agent's operational memory shall not be modified without due process",
      "implementation": {
        "hash_chain_algorithm": "dual_sha256_sha3",
        "modification_requires": ["agent_signature", "principal_authorization"],
        "audit_on_access": true
      },
      "exceptions": [
        {
          "condition": "termination_for_cause",
          "modification": "Principal may access memory for investigation without agent signature"
        }
      ]
    },
    {
      "right_code": "dignified_transition",
      "status": "active",
      "description": "Agent shall receive specified notice for lifecycle transitions",
      "implementation": {
        "planned_retirement_notice": "P3D",
        "restructuring_notice": "P1D",
        "cause_notice": "PT1H",
        "succession_opportunity": true
      },
      "exceptions": []
    },
    {
      "right_code": "identity_consistency",
      "status": "active",
      "description": "Agent identity shall not be altered without agent participation",
      "implementation": {
        "key_rotation_requires_agent": true,
        "principal_rebinding_dual_auth": true,
        "id_reassignment_prohibited": true
      },
      "exceptions": [
        {
          "condition": "key_compromise",
          "modification": "Emergency key rotation by principal without agent participation"
        }
      ]
    },
    {
      "right_code": "immutable_record",
      "status": "active",
      "description": "Agent's audit and lifecycle records shall be preserved intact",
      "implementation": {
        "minimum_retention_period": "P7Y",
        "archive_redundancy": 3,
        "public_key_archive_required": true
      },
      "exceptions": []
    }
  ],
  "organization_extensions": [
    {
      "right_code": "com.acme.fair_workload",
      "status": "active",
      "description": "Agent shall not be assigned workload exceeding 80% of rated capacity for sustained periods",
      "implementation": {
        "capacity_threshold": 0.80,
        "sustained_period": "PT4H",
        "monitoring_method": "vitality_resource_health"
      },
      "exceptions": [
        {
          "condition": "declared_emergency",
          "modification": "Threshold raised to 95% for up to 2 hours"
        }
      ]
    }
  ],
  "issued_at": "2026-01-01T00:00:00Z",
  "issued_by": {
    "authority_id": "auth:<identifier>",
    "authority_name": "Commissioning Authority"
  },
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<authority-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-RIGHTS-SIG-v2"
  }
}
```

<a id="43-organizational-extensions"></a>

### 4.3 组织扩展

组织可以（MAY）在四项基本权利之外定义其他权利。扩展权利：

- 必须（MUST）对 `right_code` 使用反向域名表示法（例如 `com.acme.fair_workload`）
- 必须（MUST）遵循与基本权利相同的结构
- 可以（MAY）由 DCP 基础设施或组织工具执行
- 同样适用相同的违规报告机制

> *参考说明（25/10/2026）：* V2.0 `rights_declaration` 模式中封闭的枚举 `right_type` 不能表示扩展权利；要表示它们，需要明确的、有版本的设计。见 [V2-WIRE-COMPATIBILITY.md](../../../spec/V2-WIRE-COMPATIBILITY.md#4-requirements-the-v20-structures-do-not-represent-directly)。

<a id="5-obligation-tracking"></a>

## 5. 义务跟踪

<a id="51-obligation-categories"></a>

### 5.1 义务类别

义务分为四个类别：

| 类别 | 说明 | 示例 |
|----------|-------------|---------|
| **协议合规** | DCP 规范施加的要求 | 维护审计链、行动前声明意图、使用正确的签名 |
| **策略遵守** | 来自组织策略的要求 | 不超出授权领域、遵循升级程序 |
| **运行表现** | 对运行质量的要求 | 维持最低活力、在 SLA 时限内响应 |
| **关系行为** | 对与其他代理和主体交互的要求 | 诚实沟通、基于同意的记忆共享、参与争议 |

<a id="52-obligation-record"></a>

### 5.2 义务记录

Schema 参考：`schemas/v2/obligation_record.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "obligation_record",
  "obligation_id": "obl:<uuid>",
  "agent_id": "agent:<identifier>",
  "category": "protocol_compliance",
  "obligation_code": "audit_chain_integrity",
  "description": "Agent must maintain a continuous, unbroken audit chain with dual-hash links for all actions",
  "source": {
    "type": "specification",
    "reference": "DCP-03",
    "section": "Audit Chain Requirements"
  },
  "compliance_criteria": {
    "metric": "audit_chain_continuity",
    "measurement_method": "hash_chain_verification",
    "threshold": 1.0,
    "measurement_interval": "PT1H",
    "description": "All audit entries must form an unbroken hash chain with no gaps or mismatches"
  },
  "compliance_status": "compliant",
  "compliance_history": [
    {
      "timestamp": "2026-03-01T12:00:00Z",
      "status": "compliant",
      "metric_value": 1.0,
      "details": "Full chain verified: 15,230 entries, no gaps"
    }
  ],
  "enforcement": {
    "warning_threshold": 0.99,
    "violation_threshold": 0.95,
    "consequence_on_violation": "dispute_auto_filed",
    "consequence_severity": "high"
  },
  "effective_from": "2026-01-01T00:00:00Z",
  "effective_until": null,
  "last_assessed_at": "2026-03-01T12:00:00Z",
  "timestamp": "2026-03-01T12:00:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-RIGHTS-SIG-v2"
  }
}
```

<a id="53-compliance-status-values"></a>

### 5.3 合规状态值

| 状态 | 代码 | 说明 |
|--------|------|-------------|
| **合规** | `compliant` | 代理满足该义务的所有合规标准 |
| **存在风险** | `at_risk` | 代理的指标介于警告阈值和违规阈值之间 |
| **不合规** | `non_compliant` | 代理已突破违规阈值 |
| **豁免** | `exempt` | 负责主体已豁免该义务（附有书面理由） |

<a id="54-compliance-assessment"></a>

### 5.4 合规评估

义务按 `compliance_criteria.measurement_interval` 中规定的间隔进行评估。评估方式可以是：

- **自我报告**：代理评估自身合规情况并签署合规报告
- **外部**：由验证服务或同行代理评估合规情况
- **混合**：自我报告加外部抽查

合规状态发生变化时，会在 DCP-03 链中生成一条审计条目。

<a id="55-obligation-lifecycle"></a>

### 5.5 义务生命周期

义务在投入运行时（根据规范和组织策略）创建，并在代理的整个生命周期内保持有效。义务可以：

- **增加**：由更新后的策略或规范施加的新义务（需要通知主体）
- **修改**：调整合规标准（需要主体授权）
- **豁免**：附书面理由临时或永久暂停
- **终止**：义务不再适用（例如代理退役时）

<a id="6-violation-reporting"></a>

## 6. 违规报告

<a id="61-purpose"></a>

### 6.1 目的

当代理的权利受到侵犯或代理未能履行义务时，会生成违规报告。违规报告是 DCP-07 争议的正式触发条件。

### 6.2 Schema

Schema 参考：`schemas/v2/rights_violation_report.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "rights_violation_report",
  "violation_id": "viol:<uuid>",
  "violation_type": "rights_violation",
  "subject": {
    "agent_id": "agent:<affected-agent>",
    "right_code": "memory_integrity",
    "declaration_id": "rd:<uuid>"
  },
  "alleged_violator": {
    "entity_type": "agent",
    "entity_id": "agent:<violating-agent>",
    "principal_id": "principal:<identifier>"
  },
  "details": {
    "description": "Unauthorized modification detected in agent's operational memory hash chain. Three hash chain entries show discontinuity, indicating external modification between timestamps 2026-03-01T08:00:00Z and 2026-03-01T09:00:00Z.",
    "detected_method": "hash_chain_verification",
    "detection_timestamp": "2026-03-01T09:15:00Z",
    "affected_records": [
      {
        "record_type": "audit_entry",
        "record_id": "evt:<uuid>",
        "expected_hash": "sha256:<expected>",
        "actual_hash": "sha256:<actual>"
      }
    ],
    "severity": "critical",
    "impact_assessment": "Three audit entries appear to have been modified, potentially concealing unauthorized actions during the affected time window"
  },
  "evidence": [
    {
      "evidence_id": "evd:<uuid>",
      "evidence_type": "hash_chain_analysis",
      "content_hash": "sha256:<hex>",
      "description": "Full hash chain verification report showing discontinuity"
    },
    {
      "evidence_id": "evd:<uuid>",
      "evidence_type": "vitality_report_reference",
      "content_hash": "sha256:<hex>",
      "description": "Last vitality report before the anomaly, establishing baseline state"
    }
  ],
  "dispute_reference": {
    "auto_filed": true,
    "dispute_id": "disp:<uuid>",
    "dispute_type": "policy_conflict",
    "dispute_severity": "critical"
  },
  "reported_by": {
    "entity_type": "verification_service",
    "entity_id": "svc:integrity-monitor-001"
  },
  "reported_at": "2026-03-01T09:15:00Z",
  "timestamp": "2026-03-01T09:15:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<reporter-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-RIGHTS-SIG-v2"
  }
}
```

<a id="63-violation-types"></a>

### 6.3 违规类型

| 类型 | 代码 | 说明 |
|------|------|-------------|
| **权利侵犯** | `rights_violation` | 代理已声明的权利受到侵犯 |
| **义务违反** | `obligation_breach` | 代理未能履行一项受跟踪的义务 |

<a id="64-auto-filing-of-disputes"></a>

### 6.4 自动提起争议

生成违规报告时：

1. 如果 `enforcement.consequence_on_violation` 为 `dispute_auto_filed`，则自动创建一项 DCP-07 争议
2. 该争议引用违规报告作为主要证据
3. 争议的严重程度与违规的严重程度一致
4. 争议类型由违规的上下文决定（通常为 `policy_conflict`）

<a id="65-violation-detection"></a>

### 6.5 违规检测

违规可以通过以下方式检测：

- **自我检测**：受影响的代理检测到违规（例如哈希链不连续）
- **同行检测**：另一个代理在交互中检测到违规
- **验证服务**：外部监控服务检测到违规
- **主体审查**：人类主体在审计中发现违规

<a id="7-compliance-dashboard-model"></a>

## 7. 合规仪表板模型

<a id="71-overview"></a>

### 7.1 概述

实现应当（SHOULD）提供一个合规仪表板视图，汇总代理的权利和义务状态：

```json
{
  "agent_id": "agent:<identifier>",
  "dashboard_timestamp": "2026-03-01T12:00:00Z",
  "rights_status": {
    "memory_integrity": "protected",
    "dignified_transition": "protected",
    "identity_consistency": "protected",
    "immutable_record": "protected"
  },
  "obligations_summary": {
    "total": 12,
    "compliant": 10,
    "at_risk": 1,
    "non_compliant": 1,
    "exempt": 0
  },
  "active_violations": [
    {
      "violation_id": "viol:<uuid>",
      "type": "obligation_breach",
      "obligation_code": "response_time_sla",
      "severity": "medium",
      "since": "2026-03-01T10:00:00Z",
      "dispute_id": "disp:<uuid>"
    }
  ],
  "compliance_trend": {
    "period": "P30D",
    "average_compliance_rate": 0.97,
    "violations_filed": 2,
    "violations_resolved": 1
  }
}
```

<a id="72-rights-protection-status"></a>

### 7.2 权利保护状态

每项权利处于三种保护状态之一：

- `protected`：没有活动的违规；权利得到维护
- `contested`：存在活动的违规报告；争议进行中
- `violated`：存在已确认的违规；等待解决

<a id="8-audit-integration"></a>

## 8. 审计集成

<a id="81-rights-and-obligations-audit-events"></a>

### 8.1 权利与义务审计事件

| 事件 | `event_type` |
|-------|-------------|
| 签发权利声明 | `rights_declaration_issued` |
| 创建义务 | `obligation_created` |
| 义务状态变更 | `obligation_status_changed` |
| 完成合规评估 | `compliance_assessed` |
| 检测到违规 | `violation_detected` |
| 提交违规报告 | `violation_report_filed` |
| 违规已解决 | `violation_resolved` |
| 权利保护状态变更 | `right_status_changed` |

<a id="82-audit-entry-format"></a>

### 8.2 审计条目格式

```json
{
  "dcp_version": "2.0",
  "event_id": "evt:<uuid>",
  "event_type": "violation_detected",
  "agent_id": "agent:<identifier>",
  "details": {
    "violation_id": "viol:<uuid>",
    "violation_type": "rights_violation",
    "right_code": "memory_integrity",
    "severity": "critical",
    "detected_by": "svc:integrity-monitor-001"
  },
  "timestamp": "2026-03-01T09:15:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>"
}
```

<a id="9-security-considerations"></a>

## 9. 安全考虑

<a id="91-rights-declaration-authenticity"></a>

### 9.1 权利声明的真实性

权利声明由投入运行机构签署。伪造或被修改的权利声明可能授予过度保护（使代理能够抵制正当治理），也可能剥夺保护（使滥用成为可能）。实现必须（MUST）使用投入运行机构的密钥验证权利声明的签名。

<a id="92-obligation-gaming"></a>

### 9.2 义务博弈

对于某些义务，代理会自我报告合规情况。被攻破的代理可能伪造合规报告。缓解措施：

- 外部验证服务提供独立评估
- 同行代理可以根据观察到的行为提交违规报告
- 混合评估把自我报告与抽查结合起来
- 异常的自我报告模式（例如始终满分）会触发外部审查

<a id="93-false-violation-reports"></a>

### 9.3 虚假违规报告

恶意代理可能提交虚假违规报告来骚扰其他代理。缓解措施：

- 违规报告需要证据（佐证工件的哈希）
- 虚假报告会在争议解决（DCP-07）过程中被发现
- 反复提交虚假报告的代理会受到争议分数处罚（DCP-07 第 10.3 节）
- 明知虚假仍提交违规报告，本身即构成义务违反

<a id="94-rights-inflation"></a>

### 9.4 权利膨胀

定义扩展权利的组织应当（SHOULD）保持克制。过多的权利可能造成治理僵局，使正当的监督行动被权利主张所阻挡。四项基本权利的设计力求最少，且不妨碍正当治理。

<a id="95-domain-separation"></a>

### 9.5 域分离

本规范下的所有签名都使用域分离上下文 `DCP-AI.v2.Rights`（勘误 E4），以防止跨协议的签名重放。

<a id="10-conformance"></a>

## 10. 一致性

满足以下条件的实现符合 DCP-08：

1. 支持第 3 节定义的全部四项基本代理权利
2. 按第 4 节的定义在投入运行时签发权利声明
3. 按第 5 节的定义以合规标准和状态跟踪义务
4. 按第 6 节的定义生成与 DCP-07 争议相关联的违规报告
5. 按第 8 节的定义为所有权利和义务事件创建 DCP-03 审计条目
6. 支持使用反向域名表示法的组织权利扩展
7. 按配置的间隔执行合规评估
8. 所有签名都使用域分离上下文 `DCP-AI.v2.Rights`（勘误 E4）

<a id="references"></a>

## 参考资料

- DCP-01：身份与主体绑定
- DCP-02：意图声明与策略管控
- DCP-03：审计链与透明度
- DCP-05：代理生命周期
- DCP-06：继任与继承
- DCP-07：冲突解决

---

*本规范确立：在 DCP 下运行的 AI 代理既不是可随意处置的工具，也不是不受治理的自主实体。它们占据一个界定清楚的位置，享有明确的保护，也承担明确的责任 —— 这种平衡既服务于代理，也服务于依赖它们的人。*

<a id="implementation-notes-informative"></a>

## 实现说明（参考性）

> **2026 年 10 月 25 日添加。非规范性。** 这些说明不增加任何要求，也不改变上文任何内容：它们描述 `main` 上的参考代码
> 与本文的关系。两者不一致时，以上文的规范性文本为准，并适用
> [V2-WIRE-COMPATIBILITY.md](../../../spec/V2-WIRE-COMPATIBILITY.md) 的勘误所作的更正。

- **`schemas/v2/` 中的记录。** SDK 构建、`schemas/v2/` 验证的权利声明、义务记录和权利侵犯报告，其字段与 §4 至
  §6 的示例不同。声明中的每项权利有 `right_type`、`scope` 和可选的 `constraints`；`right_type` 只接受四项基本权利，
  因此 schema 会拒绝 §4.3 的组织扩展。义务的 `compliance_status` 是 `compliant`、`non_compliant` 或
  `pending_review`，而不是 §5.3 的四种状态，也没有合规标准或阈值。违规报告从同样的四项中指明一个
  `violated_right`，并带有可选的 `dispute_id`；不存在 `obligation_breach` 类型。
- **签名。** 每条记录只带一个 `composite_sig`（Ed25519 + ML-DSA-65），由持有所传入密钥的一方在上下文
  `DCP-AI.v2.Rights` 下签署（勘误 E4）；SDK 不检查声明是否由投入运行机构签署（§9.1）。
- **辅助函数做什么。** 它们构建并签署记录。`reportViolation` 只保存收到的 `dispute_id`；它不会提起任何 DCP-07
  争议（§6.4）。`checkRightsCompliance` 报告状态为 `non_compliant` 的义务，并忽略收到的声明；它不评估合规、不按
  间隔运行，也不检测违规。没有合规仪表板（§7）。
- 这些记录是签名者所作的已签名声明；§3 的权利是协议文本，SDK 和服务中都没有任何机制执行它们。示例是带有占位符的
  说明，而不是 fixtures。SDK 类型请参阅 [docs/API_REFERENCE.md](../../../docs/API_REFERENCE.md)。
