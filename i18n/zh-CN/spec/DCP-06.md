<sub>[English](../../../spec/DCP-06.md) · **中文** · [Español](../../es/spec/DCP-06.md) · [日本語](../../ja/spec/DCP-06.md) · [Português](../../pt-BR/spec/DCP-06.md)</sub>

<a id="dcp-06-succession--inheritance"></a>
<a id="dcp-06-succession-inheritance"></a>

# DCP-06：继任与继承

> 本文是[英文规范](../../../spec/DCP-06.md)的参考译文，更新于 25/10/2026。**具有规范效力的是英文版**：本译文不具规范效力，如有出入，以英文版为准。标识符和代码块保持原文，不作翻译。

<a id="status"></a>

## 状态
已发布 — v2.0（扩展；修订根据采用者的反馈跟踪）

<a id="abstract"></a>

## 摘要
本规范定义 AI 代理为继任做准备并执行继任的机制。继任是指将职责、运行上下文和关系知识从一个代理有序地转移给其继任者。本规范引入数字遗嘱、继任仪式和记忆转移清单，它们都经过密码学签名并以哈希链接。该协议在保持前任代理与继任代理之间身份边界的同时，确保服务的连续性。

**依赖关系**：本规范需要 DCP-05（代理生命周期）。继任事件由生命周期状态转换触发，退役记录引用继任结果。

<a id="1-introduction"></a>

## 1. 引言

当 AI 代理到达其生命周期终点（DCP-05）时，它积累的运行知识、建立的关系和进行中的承诺并不会就此消失。组织需要一个正式的协议，把相关上下文从即将退休的代理转移给其继任者，同时保持两个代理记录的密码学完整性。

DCP-06 应对三个根本性挑战：

1. **连续性**：确保继任代理能够不间断地接续前任的职责
2. **完整性**：保持前任与继任者之间的密码学边界；继任者是一个新的实体，而不是旧实体的延续
3. **选择性**：并非所有知识都应转移；有些运行上下文是临时的，有些是敏感的，还有些与前任的身份紧密绑定

<a id="11-design-principles"></a>

### 1.1 设计原则
- 继任代理始终是一个独立的身份，拥有自己的 DCP-01 绑定
- 记忆转移是有选择的：由前任（或其主体）控制转移哪些内容
- 数字遗嘱有版本并以哈希链接；以最新版本为准
- 继任仪式会为转移生成一份可审计的已签名记录
- 三种仪式类型适应不同的紧急程度：计划、强制、紧急

<a id="12-relationship-to-other-specifications"></a>

### 1.2 与其他规范的关系
- **DCP-01**：继任代理有自己的身份绑定；它们不继承前任的身份
- **DCP-03**：所有继任事件都记录在两个代理的审计链中
- **DCP-04**：前任的活动 A2A 会话不会转移；继任者必须建立新的会话
- **DCP-05**：继任由生命周期转换触发；退役记录引用继任结果

<a id="2-terminology"></a>

## 2. 术语

**数字遗嘱**：代理在活跃期间准备的、有版本的已签名文件，声明其继任偏好、记忆分类和转移指示。相当于遗嘱。

**继任仪式**：把职责从前任转移给继任者的正式流程，包括验证、授权和记忆转移。

**记忆转移**：在数字遗嘱和组织策略的约束下，将运行上下文从前任有选择地传给继任者。

**前任**：正在退役或其职责正在被转移的代理。

**继任者**：从前任接收职责和选定运行上下文的代理。

**记忆分类**：对代理积累的知识进行分类的体系：`operational`、`relational`、`ephemeral` 或 `restricted`。

**域分离标签**：`DCP-SUCCESSION-SIG-v2`，用于本规范下产生的所有签名。

<a id="3-digital-testament"></a>

## 3. 数字遗嘱

<a id="31-purpose"></a>

### 3.1 目的

数字遗嘱是代理就退役时应如何处理其职责和知识所作的声明。代理应当（SHOULD）在整个活跃生命周期中创建并维护一份数字遗嘱。遗嘱有版本；每个新版本取代前一个版本。

### 3.2 Schema

Schema 参考：`schemas/v2/digital_testament.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "digital_testament",
  "testament_id": "dt:<uuid>",
  "agent_id": "agent:<identifier>",
  "version": 3,
  "status": "active",
  "succession_preferences": {
    "preferred_successor_id": "agent:<identifier>",
    "alternate_successor_ids": [
      "agent:<alternate-1>",
      "agent:<alternate-2>"
    ],
    "successor_requirements": {
      "minimum_capabilities": ["negotiate", "purchase_order"],
      "minimum_security_tier": "elevated",
      "minimum_vitality": 800,
      "same_organization_required": true,
      "same_jurisdiction_required": false
    },
    "succession_mode_preferences": {
      "planned_retirement": "full_transfer",
      "termination_for_cause": "restricted_transfer",
      "organizational_restructuring": "full_transfer",
      "sudden_failure": "emergency_transfer"
    }
  },
  "memory_classification": {
    "operational": {
      "description": "Task-specific knowledge, procedures, and workflows",
      "transfer_policy": "transfer",
      "retention_after_transfer": "archive_7y",
      "items": [
        {
          "category": "workflow_procedures",
          "description": "Standard procurement workflows for vendor management",
          "data_reference": "mem:operational:workflows:001",
          "size_bytes": 524288,
          "classification": "operational",
          "transfer_priority": "high"
        }
      ]
    },
    "relational": {
      "description": "Knowledge about relationships with other agents and entities",
      "transfer_policy": "transfer_with_consent",
      "retention_after_transfer": "archive_3y",
      "items": [
        {
          "category": "agent_interaction_history",
          "description": "Interaction patterns and trust assessments for known agents",
          "data_reference": "mem:relational:interactions:001",
          "size_bytes": 131072,
          "classification": "relational",
          "transfer_priority": "medium"
        }
      ]
    },
    "ephemeral": {
      "description": "Temporary context that does not survive succession",
      "transfer_policy": "do_not_transfer",
      "retention_after_transfer": "purge",
      "items": [
        {
          "category": "active_session_state",
          "description": "Current in-flight session data",
          "data_reference": "mem:ephemeral:sessions:001",
          "size_bytes": 65536,
          "classification": "ephemeral",
          "transfer_priority": "none"
        }
      ]
    },
    "restricted": {
      "description": "Sensitive knowledge that requires principal authorization to transfer",
      "transfer_policy": "principal_approval_required",
      "retention_after_transfer": "archive_7y_encrypted",
      "items": [
        {
          "category": "security_observations",
          "description": "Anomaly patterns and security-relevant observations",
          "data_reference": "mem:restricted:security:001",
          "size_bytes": 32768,
          "classification": "restricted",
          "transfer_priority": "low"
        }
      ]
    }
  },
  "final_messages": [
    {
      "recipient_type": "principal",
      "recipient_id": "principal:<identifier>",
      "message": "Summary of unresolved items requiring human attention"
    },
    {
      "recipient_type": "agent",
      "recipient_id": "agent:<successor-identifier>",
      "message": "Key operational notes for successor"
    }
  ],
  "created_at": "2026-01-15T00:00:00Z",
  "updated_at": "2026-02-28T00:00:00Z",
  "prev_hash": "sha256:<hex of previous testament version>",
  "prev_hash_secondary": "sha3-256:<hex of previous testament version>",
  "signature": {
    "alg": "ed25519",
    "kid": "<agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-SUCCESSION-SIG-v2"
  }
}
```

<a id="33-testament-versioning"></a>

### 3.3 遗嘱版本管理

每次更新遗嘱都会使 `version` 字段递增。遗嘱各版本构成一条哈希链：每个版本的 `prev_hash` 引用前一个版本的哈希。创世遗嘱（版本 1）使用 null 哈希。

只有最新版本有效。较早的版本为审计目的而保留。如果发现遗嘱被篡改（哈希链断裂），继任将退回到由主体主导的转移。

<a id="34-transfer-policies"></a>

### 3.4 转移策略

| 策略 | 代码 | 说明 |
|--------|------|-------------|
| **转移** | `transfer` | 记忆项无条件转移给继任者 |
| **经同意后转移** | `transfer_with_consent` | 转移需要受影响对方的明确同意 |
| **需要主体批准** | `principal_approval_required` | 转移需要负责主体的明确批准 |
| **不转移** | `do_not_transfer` | 记忆项永不转移；予以清除或存档 |

<a id="4-succession-ceremony"></a>

## 4. 继任仪式

<a id="41-overview"></a>

### 4.1 概述

继任仪式是把职责从前任转移给继任者的正式流程。三种类型适应不同的紧急程度：

| 类型 | 代码 | 触发条件 | 持续时间 |
|------|------|---------|----------|
| **计划** | `planned` | 计划退休或组织重组 | 数小时到数天 |
| **强制** | `forced` | 因故终止 | 数分钟到数小时 |
| **紧急** | `emergency` | 突发故障 | 数秒到数分钟 |

<a id="42-planned-succession"></a>

### 4.2 计划继任

有序的过渡流程：

1. **发起**：前任（或其主体）声明继任意图，并引用数字遗嘱
2. **继任者验证**：根据遗嘱的要求验证继任者的身份、能力和活力
3. **授权**：负责主体授权本次继任
4. **并行运行**（可选）：在过渡窗口内前任与继任者同时运行，使继任者能够观察和学习
5. **记忆转移**：按遗嘱的分类转移运行记忆和关系记忆
6. **通知对方**：通过 DCP-04 通知曾与前任交互的代理本次继任
7. **交接确认**：继任者确认已接收并已做好运行准备
8. **封存**：创建继任记录，由两个代理和主体签署

<a id="43-forced-succession"></a>

### 4.3 强制继任

针对因故终止的简化流程：

1. **发起**：主体或组织机构下令继任
2. **继任者验证**：验证继任者（来自遗嘱的备选者或由主体指定）
3. **受限转移**：只转移策略为 `transfer` 的 `operational` 记忆；`relational` 和 `restricted` 记忆需要主体的明确批准
4. **立即交接**：没有并行运行期
5. **封存**：创建继任记录；前任的退役记录注明其强制性质

<a id="44-emergency-succession"></a>

### 4.4 紧急继任

针对突发故障的最简流程：

1. **检测**：监控系统或同行代理检测到前任故障（DCP-05 第 7.5 节）
2. **通知主体**：向负责主体发出警报
3. **激活继任者**：如果存在可用的首选继任者，立即将其激活；否则由主体指定一个
4. **尽力转移**：从可用的备份或复制状态转移记忆；前任无法参与
5. **恢复验证**：继任者使用前任已知最后一份活力报告中的 Merkle 根，验证所转移数据的完整性
6. **封存**：由主体和继任者创建继任记录（前任无法签名）

<a id="45-succession-record"></a>

### 4.5 继任记录

Schema 参考：`schemas/v2/succession_record.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "succession_record",
  "succession_id": "sr:<uuid>",
  "ceremony_type": "planned",
  "predecessor": {
    "agent_id": "agent:<predecessor-identifier>",
    "final_vitality": 720,
    "lifecycle_state_at_succession": "declining",
    "decommission_id": "dc:<uuid>",
    "testament_id": "dt:<uuid>",
    "testament_version": 3,
    "testament_hash": "sha256:<hex>"
  },
  "successor": {
    "agent_id": "agent:<successor-identifier>",
    "vitality_at_succession": 980,
    "lifecycle_state_at_succession": "active",
    "commissioning_certificate_id": "cc:<uuid>"
  },
  "authorized_by": {
    "principal_id": "principal:<identifier>",
    "authorization_timestamp": "2026-03-01T00:00:00Z"
  },
  "memory_transfer": {
    "manifest_id": "mtm:<uuid>",
    "items_transferred": 12,
    "items_skipped": 5,
    "items_failed": 0,
    "total_bytes_transferred": 1048576,
    "transfer_merkle_root": {
      "sha256": "<hex>",
      "sha3_256": "<hex>"
    },
    "transfer_verified": true
  },
  "counterparties_notified": [
    {
      "agent_id": "agent:<counterparty-1>",
      "notification_status": "acknowledged"
    },
    {
      "agent_id": "agent:<counterparty-2>",
      "notification_status": "pending"
    }
  ],
  "parallel_operation_window": {
    "start": "2026-02-28T00:00:00Z",
    "end": "2026-03-01T00:00:00Z"
  },
  "ceremony_started_at": "2026-02-28T00:00:00Z",
  "ceremony_completed_at": "2026-03-01T01:00:00Z",
  "timestamp": "2026-03-01T01:00:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "predecessor_signature": {
    "alg": "ed25519",
    "kid": "<predecessor-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-SUCCESSION-SIG-v2"
  },
  "successor_signature": {
    "alg": "ed25519",
    "kid": "<successor-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-SUCCESSION-SIG-v2"
  },
  "principal_signature": {
    "alg": "ed25519",
    "kid": "<principal-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-SUCCESSION-SIG-v2"
  }
}
```

<a id="5-memory-transfer"></a>

## 5. 记忆转移

<a id="51-memory-classification"></a>

### 5.1 记忆分类

代理的记忆分为四类，每类具有不同的转移语义：

| 分类 | 说明 | 默认转移策略 |
|---------------|-------------|------------------------|
| **运行** | 与任务相关的知识：工作流、程序、决策启发式、领域模型 | `transfer` |
| **关系** | 关于关系的知识：交互历史、信任评估、对各方的沟通偏好 | `transfer_with_consent` |
| **临时** | 临时状态：活动会话、进行中的交易、短期缓存 | `do_not_transfer` |
| **受限** | 敏感知识：安全观察、漏洞模式、特权访问记录 | `principal_approval_required` |

<a id="52-memory-transfer-manifest"></a>

### 5.2 记忆转移清单

Schema 参考：`schemas/v2/memory_transfer_manifest.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "memory_transfer_manifest",
  "manifest_id": "mtm:<uuid>",
  "succession_id": "sr:<uuid>",
  "predecessor_agent_id": "agent:<predecessor>",
  "successor_agent_id": "agent:<successor>",
  "transfer_items": [
    {
      "item_id": "mti:<uuid>",
      "data_reference": "mem:operational:workflows:001",
      "classification": "operational",
      "transfer_policy": "transfer",
      "transfer_status": "completed",
      "size_bytes": 524288,
      "content_hash": {
        "sha256": "<hex>",
        "sha3_256": "<hex>"
      },
      "encrypted": true,
      "encryption_alg": "aes-256-gcm",
      "transfer_timestamp": "2026-03-01T00:30:00Z"
    },
    {
      "item_id": "mti:<uuid>",
      "data_reference": "mem:relational:interactions:001",
      "classification": "relational",
      "transfer_policy": "transfer_with_consent",
      "transfer_status": "completed",
      "consent_records": [
        {
          "counterparty_id": "agent:<counterparty>",
          "consent_given": true,
          "consent_timestamp": "2026-02-28T20:00:00Z"
        }
      ],
      "size_bytes": 131072,
      "content_hash": {
        "sha256": "<hex>",
        "sha3_256": "<hex>"
      },
      "encrypted": true,
      "encryption_alg": "aes-256-gcm",
      "transfer_timestamp": "2026-03-01T00:35:00Z"
    },
    {
      "item_id": "mti:<uuid>",
      "data_reference": "mem:ephemeral:sessions:001",
      "classification": "ephemeral",
      "transfer_policy": "do_not_transfer",
      "transfer_status": "skipped",
      "reason": "ephemeral_policy"
    }
  ],
  "transfer_merkle_root": {
    "sha256": "<hex over all transferred item content_hashes>",
    "sha3_256": "<hex>"
  },
  "summary": {
    "total_items": 17,
    "transferred": 12,
    "skipped": 5,
    "failed": 0,
    "total_bytes": 1048576
  },
  "transfer_started_at": "2026-03-01T00:15:00Z",
  "transfer_completed_at": "2026-03-01T00:45:00Z",
  "timestamp": "2026-03-01T00:45:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "predecessor_signature": {
    "alg": "ed25519",
    "kid": "<predecessor-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-SUCCESSION-SIG-v2"
  },
  "successor_signature": {
    "alg": "ed25519",
    "kid": "<successor-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-SUCCESSION-SIG-v2"
  }
}
```

<a id="53-merkle-root-verification"></a>

### 5.3 Merkle 根验证

`transfer_merkle_root` 是基于所有成功转移项的 `content_hash` 值计算的双哈希（SHA-256 + SHA3-256）Merkle 树。这使继任者能够验证自己收到的恰好是清单中列出的项，而无需前任在场进行重新验证。

构造方法：

1. 收集所有 `transfer_status: "completed"` 项的 `content_hash.sha256` 值，按 `item_id` 排序
2. 构建一棵 SHA-256 Merkle 树；其根即 `transfer_merkle_root.sha256`
3. 用 `content_hash.sha3_256` 值重复上述步骤，得到 `transfer_merkle_root.sha3_256`

<a id="54-transfer-encryption"></a>

### 5.4 转移加密

所有记忆转移项在传输中都必须（MUST）使用 AES-256-GCM 加密，并使用通过以下方式派生的一次性转移密钥：

```
transfer_key = HKDF-SHA256(
  salt = succession_id,
  ikm  = predecessor_private_key_contribution || successor_public_key_contribution,
  info = "DCP-AI.v2.Succession.TransferKey",
  len  = 32
)
```

在前任无法参与密钥协商的紧急继任中，由负责主体提供密钥材料。

<a id="55-consent-for-relational-memory"></a>

### 5.5 关系记忆的同意

关系记忆项（交互历史、对特定对方的信任评估）在转移前需要受影响对方的同意。同意流程：

1. 前任（紧急情况下为主体）通过 DCP-04 向每个受影响的对方发送同意请求
2. 对方以同意或拒绝回应
3. 只转移已获同意的项
4. 同意记录包含在记忆转移清单中
5. 如果在继任窗口内无法联系到某个对方，则跳过该项

<a id="6-identity-boundary"></a>

## 6. 身份边界

<a id="61-principle"></a>

### 6.1 原则

继任代理是一个新的、独立的实体。它不会继承前任的以下任何内容：

- 代理 ID
- 密码学密钥
- DCP-01 身份绑定
- 审计链
- A2A 会话

继任者接收选定的运行上下文，但以自己的身份运行。这一原则是根本性的：继任是职责和知识的转移，而不是身份的转移。

<a id="62-provenance-tracking"></a>

### 6.2 来源追踪

当继任者使用通过继任获得的知识时，应当（SHOULD）在相关审计条目中加入来源引用：

```json
{
  "provenance": {
    "source": "succession",
    "predecessor_agent_id": "agent:<predecessor>",
    "succession_id": "sr:<uuid>",
    "memory_item_id": "mti:<uuid>"
  }
}
```

这使审计人员能够追踪转移来的知识如何影响继任者的决策。

<a id="7-security-considerations"></a>

## 7. 安全考虑

<a id="71-testament-tampering"></a>

### 7.1 遗嘱篡改

数字遗嘱以哈希链接并经过签名。如果遗嘱的哈希链断裂，继任必须（MUST）退回到由主体主导、不自动转移记忆的转移。主体必须明确授权每一个转移项。

<a id="72-unauthorized-succession"></a>

### 7.2 未经授权的继任

继任仪式需要主体授权。代理不能单方面宣布继任者或发起继任。继任记录要求三个签名（前任、继任者、主体），确保各方都已同意。

<a id="73-memory-exfiltration"></a>

### 7.3 记忆外泄

记忆转移是数据外泄的潜在途径。缓解措施：

- 转移项经过分类并受策略控制
- 受限项需要主体的明确批准
- 关系项需要对方同意
- 所有转移都经过加密并记录在案
- 转移清单提供一份完整的已签名清单

<a id="74-emergency-succession-risks"></a>

### 7.4 紧急继任的风险

由于时间压力和前任不可用，紧急继任在保障措施减弱的情况下进行：

- 继任记录上没有前任的签名
- 关系记忆没有交互式同意
- 记忆状态可能已过时（来自最后一次备份，而非当前状态）

缓解措施：

- 主体必须明确授权紧急继任
- 继任者必须根据前任已知的最后 Merkle 根验证所转移的数据
- 应当（SHOULD）在 24 小时内进行继任后审计

<a id="75-successor-impersonation"></a>

### 7.5 继任者冒充

继任者不得（MUST NOT）自称为前任。对方通知（第 4.2 节第 6 步）确保所有与之交互的代理都知道本次继任。实现应当（SHOULD）拒绝继任者自称为前任的交互。

<a id="76-domain-separation"></a>

### 7.6 域分离

本规范下的所有签名都使用域分离标签 `DCP-SUCCESSION-SIG-v2`，以防止跨协议的签名重放。

<a id="8-conformance"></a>

## 8. 一致性

满足以下条件的实现符合 DCP-06：

1. 支持第 3 节定义的数字遗嘱的创建及其以哈希链接的版本管理
2. 实现第 4 节定义的全部三种继任仪式类型（计划、强制、紧急）
3. 执行第 5 节定义的记忆分类和转移策略
4. 按第 5.3 节的定义，对转移项计算双哈希 Merkle 根
5. 按第 6 节的定义保持前任与继任者之间的身份边界
6. 所有继任仪式都需要主体授权
7. 为所有继任事件生成 DCP-03 审计条目
8. 所有签名都使用域分离标签 `DCP-SUCCESSION-SIG-v2`

<a id="references"></a>

## 参考资料

- DCP-01：身份与主体绑定
- DCP-03：审计链与透明度
- DCP-04：代理间通信
- DCP-05：代理生命周期
- RFC 5869：HKDF
- NIST SP 800-88：Guidelines for Media Sanitization

---

*本规范承认，AI 代理在其生命中积累的知识，其价值超出代理本身。继任确保这种价值以有选择、安全且完全可问责的方式跨越代际得以保留。*

<a id="implementation-notes-informative"></a>

## 实现说明（参考性）

> **2026 年 10 月 25 日添加。非规范性。** 这些说明不增加任何要求，也不改变上文任何内容：它们描述 `main` 上的参考代码
> 与本文的关系。两者不一致时，以上文的规范性文本为准。

- **`schemas/v2/` 中的记录。** SDK 构建、`schemas/v2/` 验证的遗嘱、继任记录和记忆转移清单，其字段与 §3 至 §5
  的示例不同：例如 `testament_version` 和 `prev_testament_hash`（版本 1 为 `GENESIS`，之后为前一版本的
  `sha256:`，仅 SHA-256），为每个类别指定 `transfer`、`retain` 或 `destroy` 的 `memory_classification`，以及清单中的
  `transfer_hash`。§3.4 和 §5.1 的四种分类和四种转移策略不在 schema 中。
- **签名。** 每条记录只带一个 `composite_sig`（Ed25519 + ML-DSA-65），由持有所传入密钥的一方在上下文
  `DCP-AI.v2.Succession` 下签署；SDK 不使用标签 `DCP-SUCCESSION-SIG-v2`，也不产生 §7.2 的三个签名（前任、继任者、
  主体）。
- **辅助函数做什么。** 它们构建并签署记录。`executeSuccession` 只拒绝空的 `ceremony_participants`；它不执行任何
  仪式，不检查主体授权，不验证继任者，也不移动任何记忆。`classifyMemory` 按遗嘱的处置对条目分类：`transfer`
  进入清单，`destroy` 以及遗嘱中没有的类别被列为已销毁，`retain` 条目不出现在任何一个列表中。
  `createMemoryTransferManifest` 从调用方接收 `transfer_hash`，不计算 §5.3 的 Merkle 根。加密、同意请求和通知对方
  （§5.4、§5.5、§4.2）由调用方负责。
- 这些记录是签名者所作的已签名声明。示例是带有占位符的说明，而不是 fixtures。SDK 类型请参阅
  [docs/API_REFERENCE.md](../../../docs/API_REFERENCE.md)。
