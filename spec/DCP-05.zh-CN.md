<sub>[English](DCP-05.md) · **中文** · [Español](DCP-05.es.md) · [日本語](DCP-05.ja.md) · [Português](DCP-05.pt-BR.md)</sub>

<a id="dcp-05-agent-lifecycle"></a>

# DCP-05：代理生命周期

> 本文是[英文规范](DCP-05.md)的参考译文，更新于 25/10/2026。**具有规范效力的是英文版**：本译文不具规范效力，如有出入，以英文版为准。标识符和代码块保持原文，不作翻译。

<a id="status"></a>

## 状态
已发布 — v2.0（扩展；修订根据采用者的反馈跟踪）

> **勘误（25/10/2026，规范性）：** [V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md) 的勘误 E2、E3、E7 和 E8 更正了签名上下文、活力字段的名称以及示例的性质。它们不改变本规范的任何其他要求。

<a id="abstract"></a>

## 摘要
本规范定义经 DCP 认证的 AI 代理的完整生命周期：从投入运行，经过活跃服务和能力衰退，直至最终退役。它引入了生命周期状态机、活力指标、投入运行证书、活力报告和退役记录，所有这些都经过密码学签名、以哈希链接并可独立验证。该协议确保代理的运行历史可发现篡改，生命周期状态之间的转换经过授权且可审计，并以四种不同的终止模式覆盖所有生命终结场景。

<a id="1-introduction"></a>

## 1. 引言

DCP-01 至 DCP-04 确立了 AI 代理的身份、意图、审计和通信。然而，这些规范都假定代理处于稳定的运行状态。实际上，代理的寿命是有限的：它们被创建、运行、退化，最后被退休或终止。DCP-05 通过定义一个全面的生命周期模型来填补这一空白。

没有生命周期协议，组织将面临以下风险：

- 没有权威记录说明代理何时投入运行或何时退出服务
- 没有为信任模型提供输入的持续健康监控
- 没有有序退休或紧急终止的标准化流程
- 没有可发现篡改、把代理的诞生与终结联系起来的历史记录

<a id="11-design-principles"></a>

### 1.1 设计原则
- 每一次生命周期状态转换都必须（MUST）签名并记录
- 活力指标必须（MUST）以哈希链接，以防止追溯性篡改
- 退役必须（MUST）产生一份封存的、可独立验证的记录
- 生命周期事件集成到现有的 DCP 审计链（DCP-03）中
- 人类主体对生命周期转换保有最终权力

<a id="12-relationship-to-other-specifications"></a>

### 1.2 与其他规范的关系
- **DCP-01**：生命周期状态扩展了身份模型；已退役代理的身份为审计目的而保留，但不能授权新的行动
- **DCP-02**：只有处于 `active` 状态的代理所作的意图声明才有效
- **DCP-03**：所有生命周期事件都会在代理的哈希链中生成审计条目
- **DCP-04**：当代理离开 `active` 状态时，必须（MUST）终止其 A2A 会话
- **DCP-06**：继任与继承（另行定义）依赖于此处定义的生命周期状态

<a id="2-terminology"></a>

## 2. 术语

**投入运行（commissioning）**：创建代理身份、将其绑定到负责主体并投入服务的正式行为。相当于出生证明加上职务任命。

**活力**：一个复合指标（整数，0–1000），表示代理的运行健康状况、能力完整性和信任地位。活力为 1000 表示具备完全运行能力；0 表示完全丧失能力。

**活力报告**：关于代理活力指标及其各组成部分得分的定期、已签名、以哈希链接的记录。

**退役（decommissioning）**：将代理永久撤出服务并封存其运行记录的正式行为。

**生命周期状态**：代理所处的四种规范状态之一：`commissioned`、`active`、`declining` 或 `decommissioned`。

**终止模式**：代理转入 `decommissioned` 状态的方式：`planned_retirement`、`termination_for_cause`、`organizational_restructuring` 或 `sudden_failure`。

**域分离上下文**：`DCP-AI.v2.Lifecycle`（DCP-AI v2.0 §4.1；勘误 E2；此处原先写的是标签 `DCP-LIFECYCLE-SIG-v2`），用于本规范下产生的所有签名，以防止跨协议重放。

<a id="3-lifecycle-state-machine"></a>

## 3. 生命周期状态机

<a id="31-states"></a>

### 3.1 状态

代理在任何时候都必须（MUST）恰好处于以下状态之一：

| 状态 | 代码 | 说明 |
|-------|------|-------------|
| **已投入运行** | `commissioned` | 代理身份已创建并绑定到某个主体，但代理尚未进入活跃服务。相当于刚签发、尚未激活的凭证。 |
| **活跃** | `active` | 代理完全可运行。它可以声明意图、执行行动、参与 A2A 会话并生成审计条目。 |
| **衰退中** | `declining` | 代理的活力已降至低于可配置阈值的水平，或某个主体已启动受控的逐步收尾。代理可以（MAY）继续运行，但能力受限。应当（SHOULD）拒绝新的长期承诺。 |
| **已退役** | `decommissioned` | 代理已永久退出服务。其身份记录为审计和历史验证而保留，但它不得（MUST NOT）发起任何新的行动、会话或意图声明。 |

<a id="32-valid-transitions"></a>

### 3.2 有效转换

```
                  activate
 commissioned ──────────────> active
                               │  │
                               │  │ decline (vitality < threshold
                               │  │         OR principal-initiated)
                               │  v
                               │  declining
                               │  │
                               │  │ reactivate (vitality restored
                               │  │            AND principal-approved)
                               │  │───────────> active
                               │  │
                  decommission │  │ decommission
                  (any mode)   │  │ (any mode)
                               v  v
                          decommissioned
```

有效转换：

1. `commissioned` -> `active`（激活）
2. `active` -> `declining`（活力下降或由主体发起的衰退）
3. `declining` -> `active`（重新激活，需要主体批准且活力高于阈值）
4. `active` -> `decommissioned`（直接终止）
5. `declining` -> `decommissioned`（从衰退状态终止）

无效转换：

- `decommissioned` -> 任何状态（终止状态，不可逆）
- `commissioned` -> `declining`（必须先激活）
- `commissioned` -> `decommissioned`（必须先激活；如果投入运行有误，则使用 `termination_for_cause`，它会隐式激活并立即退役）

<a id="33-transition-record"></a>

### 3.3 转换记录

每一次状态转换都必须（MUST）产生一条已签名的记录：

```json
{
  "dcp_version": "2.0",
  "record_type": "lifecycle_transition",
  "transition_id": "lt:<uuid>",
  "agent_id": "agent:<identifier>",
  "from_state": "active",
  "to_state": "declining",
  "reason": "vitality_threshold_breach",
  "vitality_at_transition": 340,
  "threshold": 400,
  "authorized_by": {
    "principal_id": "principal:<identifier>",
    "role": "responsible_principal"
  },
  "timestamp": "2026-03-01T00:00:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-LIFECYCLE-SIG-v2"
  }
}
```

<a id="4-commissioning-certificate"></a>

## 4. 投入运行证书

<a id="41-purpose"></a>

### 4.1 目的

投入运行证书是代理存在的基础文件。它记录代理的创建参数、所绑定的主体、初始能力以及授权实体。它必须（MUST）是代理生命周期链中的第一条记录。

### 4.2 Schema

Schema 参考：`schemas/v2/commissioning_certificate.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "commissioning_certificate",
  "certificate_id": "cc:<uuid>",
  "agent_id": "agent:<identifier>",
  "agent_name": "Human-readable agent name",
  "agent_description": "Purpose and scope of the agent",
  "principal_binding": {
    "principal_id": "principal:<identifier>",
    "principal_name": "Responsible Human or Entity",
    "organization_id": "org:<identifier>",
    "binding_type": "direct",
    "authority_level": "full"
  },
  "initial_capabilities": [
    "negotiate",
    "purchase_order",
    "data_query"
  ],
  "operational_parameters": {
    "intended_lifespan": "P365D",
    "vitality_report_interval": "PT1H",
    "vitality_decline_threshold": 400,
    "vitality_critical_threshold": 200,
    "max_concurrent_sessions": 100,
    "security_tier": "elevated",
    "permitted_domains": ["procurement", "finance"]
  },
  "initial_vitality": 1000,
  "cryptographic_identity": {
    "ed25519_public_key": "<base64>",
    "ml_dsa_65_public_key": "<base64>",
    "key_generation_timestamp": "2026-03-01T00:00:00Z"
  },
  "commissioning_authority": {
    "authority_id": "auth:<identifier>",
    "authority_name": "Organization Commissioning Authority",
    "authorization_reference": "AUTH-2026-0042"
  },
  "metadata": {
    "model_identifier": "model-name-v1.0",
    "deployment_environment": "production",
    "geographic_jurisdiction": "US"
  },
  "commissioned_at": "2026-03-01T00:00:00Z",
  "prev_hash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "prev_hash_secondary": "sha3-256:0000000000000000000000000000000000000000000000000000000000000000",
  "signature": {
    "alg": "ed25519",
    "kid": "<authority-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-LIFECYCLE-SIG-v2"
  },
  "countersignature": {
    "alg": "ed25519",
    "kid": "<principal-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-LIFECYCLE-SIG-v2"
  }
}
```

<a id="43-commissioning-flow"></a>

### 4.3 投入运行流程

1. 投入运行机构生成代理的密码学身份
2. 该机构创建并签署投入运行证书
3. 负责主体对证书进行副署，接受问责
4. 证书作为创世条目（`prev_hash` 为 null）记录在代理的生命周期链中
5. 在 DCP-03 审计链中创建一条 `agent_commissioned` 审计条目
6. 代理转入 `commissioned` 状态
7. 经就绪验证后，代理转入 `active` 状态

<a id="44-countersignature-requirement"></a>

### 4.4 副署要求

投入运行证书必须（MUST）带有两个签名：

- **机构签名**：获授权让代理投入运行的实体（组织根密钥或委派的投入运行密钥）
- **主体副署**：对代理接受问责的负责主体

两个签名都必须（MUST）使用域分离上下文 `DCP-AI.v2.Lifecycle`（勘误 E2）。

> *参考说明（25/10/2026）：* V2.0 的 `commissioning_certificate` 模式只带一个 `composite_sig`，没有用于副署的字段；见 [V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md#4-requirements-the-v20-structures-do-not-represent-directly)。

<a id="5-vitality-metric"></a>

## 5. 活力指标

<a id="51-definition"></a>

### 5.1 定义

活力是一个 [0, 1000] 范围内的整数，表示代理的整体运行适应性。它由四个组成部分的得分合成：

| 组成部分 | 权重 | 范围 | 说明 |
|-----------|--------|-------|-------------|
| **能力完整性** | 0.30 | 0–1000 | 衡量代理能否正确执行其声明的能力。来自自测、能力探测或外部验证。 |
| **信任地位** | 0.25 | 0–1000 | 根据审计历史、策略合规情况和同行评估衡量代理的可信度。 |
| **资源健康** | 0.25 | 0–1000 | 衡量计算资源的可用性：内存、延迟、吞吐量、错误率。 |
| **策略合规** | 0.20 | 0–1000 | 衡量对已声明意图和组织策略的遵守程度。来自 DCP-02 的策略结果记录。 |

复合活力：
```
vitality = floor(0.30 * capability_integrity + 0.25 * trust_standing +
                 0.25 * resource_health + 0.20 * policy_compliance)
```

在 V2.0 活力报告中，该值放在字段 `vitality_score` 中（勘误 E3）。

<a id="52-thresholds"></a>

### 5.2 阈值

组织在投入运行证书中为每个代理配置两个阈值：

- **衰退阈值**（默认 400）：活力低于该值时，代理转入 `declining` 状态
- **临界阈值**（默认 200）：活力低于该值时，需要立即干预；除非负责主体明确授权继续运行，否则应当（SHOULD）让代理退役

<a id="53-vitality-decay-and-recovery"></a>

### 5.3 活力的衰减与恢复

活力不是静态的。各组成部分的得分会根据以下因素变化：

- **自我评估**：代理报告的能力测试结果
- **外部探测**：验证服务的健康检查
- **审计分析**：对审计链异常的自动审查
- **同行报告**：其他代理通过 DCP-04 报告的交互质量

恢复：如果处于 `declining` 的代理的活力回升至高于衰退阈值的水平且负责主体批准，该代理可以（MAY）转回 `active`。

<a id="6-vitality-report"></a>

## 6. 活力报告

<a id="61-purpose"></a>

### 6.1 目的

活力报告构成一个以哈希链接的序列，提供代理随时间变化的、可发现篡改的健康历史。它们按投入运行证书中指定的间隔生成。

### 6.2 Schema

Schema 参考：`schemas/v2/vitality_report.schema.json`

> **勘误 E3 和 E7（25/10/2026）：** 本示例中的字段 `vitality` 在 V2.0 传输格式中是 `vitality_score`，且整个示例是概念性的：传输格式是模式，其 `metrics` 在 `dcp-jcs-v1` 下只能表示为 0 或 1。见 [V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md)。

```json
{
  "dcp_version": "2.0",
  "record_type": "vitality_report",
  "report_id": "vr:<uuid>",
  "agent_id": "agent:<identifier>",
  "sequence_number": 42,
  "lifecycle_state": "active",
  "vitality": 872,
  "components": {
    "capability_integrity": {
      "score": 920,
      "details": {
        "tests_passed": 47,
        "tests_failed": 2,
        "tests_total": 49,
        "last_test_timestamp": "2026-03-01T12:00:00Z"
      }
    },
    "trust_standing": {
      "score": 850,
      "details": {
        "successful_interactions": 1203,
        "failed_interactions": 12,
        "policy_violations": 0,
        "peer_trust_score": 880
      }
    },
    "resource_health": {
      "score": 810,
      "details": {
        "avg_response_latency_ms": 45,
        "error_rate_percent": 0.3,
        "memory_utilization_percent": 72,
        "throughput_ops_per_sec": 150
      }
    },
    "policy_compliance": {
      "score": 900,
      "details": {
        "intents_declared": 500,
        "intents_completed": 495,
        "policy_outcomes_compliant": 498,
        "policy_outcomes_noncompliant": 2
      }
    }
  },
  "anomalies": [],
  "recommendations": [],
  "report_interval": "PT1H",
  "report_window": {
    "from": "2026-03-01T11:00:00Z",
    "to": "2026-03-01T12:00:00Z"
  },
  "timestamp": "2026-03-01T12:00:05Z",
  "prev_hash": "sha256:<hex of previous vitality report>",
  "prev_hash_secondary": "sha3-256:<hex of previous vitality report>",
  "merkle_root": {
    "sha256": "<hex>",
    "sha3_256": "<hex>"
  },
  "signature": {
    "alg": "ed25519",
    "kid": "<agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-LIFECYCLE-SIG-v2"
  }
}
```

<a id="63-hash-chaining"></a>

### 6.3 哈希链接

活力报告构成一条哈希链。每份报告的 `prev_hash` 和 `prev_hash_secondary` 引用紧邻的上一份活力报告的 SHA-256 和 SHA3-256 哈希。投入运行后的第一份活力报告引用投入运行证书的哈希。

双哈希方式（SHA-256 + SHA3-256）遵循与 DCP-03 审计链相同的模式，可抵御单一算法被攻破的风险。

<a id="64-merkle-root"></a>

### 6.4 Merkle 根

每份活力报告都包含一个基于各组成部分得分及其细节计算的双哈希 Merkle 根。这使选择性披露成为可能：代理可以在只公开特定组成部分细节的情况下证明其整体活力得分。

<a id="65-anomaly-detection"></a>

### 6.5 异常检测

`anomalies` 数组可以（MAY）包含结构化的异常报告：

```json
{
  "anomaly_id": "anom:<uuid>",
  "type": "capability_degradation",
  "severity": "warning",
  "component": "capability_integrity",
  "description": "Test pass rate dropped 15% in the last reporting interval",
  "detected_at": "2026-03-01T11:45:00Z",
  "data": {
    "previous_pass_rate": 0.98,
    "current_pass_rate": 0.83
  }
}
```

异常严重程度：`info`、`warning`、`critical`。

<a id="7-termination-modes"></a>

## 7. 终止模式

<a id="71-overview"></a>

### 7.1 概述

代理通过四种终止模式之一到达 `decommissioned` 状态，每种模式有不同的程序要求：

| 模式 | 代码 | 触发条件 | 宽限期 |
|------|------|---------|--------------|
| **计划退休** | `planned_retirement` | 代理已完成其目的或达到预定寿命终点 | 完整（可配置，默认 72 小时） |
| **因故终止** | `termination_for_cause` | 代理违反策略、表现出不安全行为或已被攻破 | 最短（可配置，默认 1 小时） |
| **组织重组** | `organizational_restructuring` | 与其表现无关的、让代理退休的业务决定 | 标准（可配置，默认 24 小时） |
| **突发故障** | `sudden_failure` | 代理失去响应或发生灾难性故障 | 无（由主体事后办理退役） |

<a id="72-planned-retirement"></a>

### 7.2 计划退休

有序的生命终结流程：

1. 负责主体发出带有宽限期的退休通知
2. 代理进入 `declining` 状态（如果尚未进入）
3. 代理完成或移交进行中的工作
4. 代理以原因 `complete` 终止所有 A2A 会话
5. 代理生成最终的活力报告
6. 如已配置，代理执行继任协议（DCP-06）
7. 创建并签署退役记录
8. 代理转入 `decommissioned`

<a id="73-termination-for-cause"></a>

### 7.3 因故终止

因策略违规或被攻破而进行的紧急终止：

1. 负责主体或组织机构发出终止命令
2. 代理的凭证立即被标记为待撤销
3. 所有 A2A 会话以原因 `revocation` 终止
4. 最短的宽限期允许进行中的操作完成（或回滚）
5. 创建包含 `cause` 详情的退役记录
6. 代理转入 `decommissioned`
7. 事后分析生成审计摘要

<a id="74-organizational-restructuring"></a>

### 7.4 组织重组

出于业务原因的退休：

1. 组织发出影响该代理的重组通知
2. 用于移交工作的标准宽限期
3. 代理按组织策略完成或移交工作
4. 如果指定了继任者，则执行继任协议（DCP-06）
5. 创建退役记录
6. 代理转入 `decommissioned`

<a id="75-sudden-failure"></a>

### 7.5 突发故障

当代理意外故障时：

1. 监控系统或同行代理检测到无响应
2. 在可配置的超时（默认：无响应 5 分钟）后触发 `sudden_failure` 事件
3. 通知负责主体
4. 主体代表代理事后创建退役记录
5. 主体用自己的密钥签署退役记录（因为代理无法签名）
6. 如果代理当时处于活动会话中，则通知 A2A 对方
7. 如已配置，继任协议（DCP-06）以紧急模式执行

<a id="8-decommissioning-record"></a>

## 8. 退役记录

<a id="81-purpose"></a>

### 8.1 目的

退役记录是代理生命周期链中的终止文件。它封存代理的运行历史，并就代理如何以及为何退休提供一份永久、可验证的记录。

### 8.2 Schema

Schema 参考：`schemas/v2/decommissioning_record.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "decommissioning_record",
  "decommission_id": "dc:<uuid>",
  "agent_id": "agent:<identifier>",
  "agent_name": "Human-readable agent name",
  "termination_mode": "planned_retirement",
  "lifecycle_summary": {
    "commissioned_at": "2026-01-01T00:00:00Z",
    "activated_at": "2026-01-01T01:00:00Z",
    "decommissioned_at": "2026-03-01T00:00:00Z",
    "total_active_duration": "P59D",
    "total_vitality_reports": 1416,
    "final_vitality": 720,
    "average_vitality": 865,
    "min_vitality": 410,
    "max_vitality": 995,
    "total_audit_entries": 15230,
    "total_a2a_sessions": 342,
    "total_intents_declared": 8901,
    "policy_violations": 2
  },
  "audit_chain_seal": {
    "final_audit_hash": "sha256:<hex>",
    "final_audit_hash_secondary": "sha3-256:<hex>",
    "audit_merkle_root": {
      "sha256": "<hex>",
      "sha3_256": "<hex>"
    },
    "total_entries": 15230
  },
  "vitality_chain_seal": {
    "final_vitality_hash": "sha256:<hex>",
    "final_vitality_hash_secondary": "sha3-256:<hex>",
    "vitality_merkle_root": {
      "sha256": "<hex>",
      "sha3_256": "<hex>"
    },
    "total_reports": 1416
  },
  "succession_reference": {
    "successor_agent_id": "agent:<identifier>",
    "succession_record_id": "sr:<uuid>",
    "memory_transfer_complete": true
  },
  "reason": "Agent fulfilled its intended operational lifespan",
  "cause_details": null,
  "key_disposition": {
    "private_keys_destroyed": true,
    "destruction_method": "secure_erasure",
    "destruction_witness": "principal:<identifier>",
    "public_keys_archived": true,
    "archive_location": "org-key-archive-2026"
  },
  "data_disposition": {
    "operational_data": "transferred_to_successor",
    "audit_data": "archived",
    "session_data": "purged",
    "archive_retention_period": "P7Y"
  },
  "decommissioned_at": "2026-03-01T00:00:00Z",
  "decommissioned_by": {
    "principal_id": "principal:<identifier>",
    "role": "responsible_principal"
  },
  "prev_hash": "sha256:<hex of final vitality report or last lifecycle record>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<agent-key-id or principal-key-id for sudden_failure>",
    "sig_b64": "...",
    "domain_sep": "DCP-LIFECYCLE-SIG-v2"
  },
  "countersignature": {
    "alg": "ed25519",
    "kid": "<principal-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-LIFECYCLE-SIG-v2"
  }
}
```

<a id="83-chain-sealing"></a>

### 8.3 链的封存

退役记录包含审计链和活力链两者的 Merkle 根封印。这些封印使任何未来的验证方无需重放整条链，就能确认代理历史记录的完整性和一致性。

<a id="84-key-disposition"></a>

### 8.4 密钥处置

退役时：

- 私钥必须（MUST）安全销毁
- 公钥必须（MUST）存档，以便将来验证历史工件
- 必须（MUST）记录销毁方法和见证人
- 对于 `sudden_failure`，由负责主体执行密钥销毁

<a id="85-sudden-failure-special-handling"></a>

### 8.5 突发故障的特殊处理

当代理突然故障、无法签署自己的退役记录时：

1. 负责主体用自己的密钥签署该记录
2. `signature.kid` 引用主体的密钥，而不是代理的密钥
3. 将 `principal_signed_on_behalf` 标志设为 `true`
4. 原因必须（MUST）包含可获得的诊断信息
5. 如果能获得代理的最后一份活力报告，则用其哈希作为 `prev_hash`；否则使用已知的最后一条审计条目的哈希

<a id="9-integration-with-dcp-03-audit-chain"></a>

## 9. 与 DCP-03 审计链的集成

<a id="91-lifecycle-audit-events"></a>

### 9.1 生命周期审计事件

所有生命周期事件都会在 DCP-03 审计链中生成条目：

| 事件 | `event_type` |
|-------|-------------|
| 创建投入运行证书 | `agent_commissioned` |
| 代理已激活 | `agent_activated` |
| 代理进入衰退状态 | `agent_declining` |
| 代理从衰退中重新激活 | `agent_reactivated` |
| 生成活力报告 | `vitality_report_generated` |
| 活力低于阈值 | `vitality_threshold_breach` |
| 开始退役 | `decommissioning_initiated` |
| 退役完成 | `agent_decommissioned` |

<a id="92-audit-entry-format"></a>

### 9.2 审计条目格式

```json
{
  "dcp_version": "2.0",
  "event_id": "evt:<uuid>",
  "event_type": "agent_declining",
  "agent_id": "agent:<identifier>",
  "lifecycle_state": "declining",
  "vitality": 380,
  "trigger": "vitality_threshold_breach",
  "details": {
    "threshold": 400,
    "vitality_report_id": "vr:<uuid>"
  },
  "timestamp": "2026-03-01T00:00:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>"
}
```

<a id="10-security-considerations"></a>

## 10. 安全考虑

<a id="101-lifecycle-chain-integrity"></a>

### 10.1 生命周期链的完整性

由投入运行证书、活力报告、转换记录和退役记录组成的哈希链接序列，构成一条可发现篡改的生命周期链。对任何历史记录的修改都会使其后所有哈希失效。

<a id="102-vitality-report-authenticity"></a>

### 10.2 活力报告的真实性

活力报告由代理自行报告。实现应当（SHOULD）以外部验证补充自报数据：

- 验证服务的健康探测
- 同行代理关于交互质量的报告
- 组织的监控系统
- 自动化的能力测试

被攻破的代理可能伪造自己的活力。外部验证来源提供纵深防御。

<a id="103-termination-authorization"></a>

### 10.3 终止授权

只有经授权的主体才能发起生命周期转换。授权模型：

- **激活**：投入运行机构或负责主体
- **衰退**：自动（活力阈值）或负责主体
- **重新激活**：仅负责主体（需要明确批准）
- **退役**：负责主体、组织机构或自动（突发故障检测）

<a id="104-post-decommissioning-verification"></a>

### 10.4 退役后的验证

退役后，代理的公钥仍然存档。任何一方都可以验证代理的历史签名、审计链和活力报告。退役记录的链封印使验证无需重放全部历史即可高效完成。

<a id="105-domain-separation"></a>

### 10.5 域分离

本规范下的所有签名都使用域分离上下文 `DCP-AI.v2.Lifecycle`（勘误 E2）。这可以防止为生命周期目的创建的签名在其他 DCP 协议上下文（例如意图声明或 A2A 会话）中被重放。

<a id="106-sudden-failure-risks"></a>

### 10.6 突发故障的风险

突发故障带来特有的安全风险：

- 代理无法签署自己的退役记录
- 代理的私钥材料可能处于未知状态
- 进行中的操作可能处于不一致状态

缓解措施：

- 由主体签署的退役记录会被清楚标记
- 必须（MUST）假定密钥材料已被攻破；应当（SHOULD）发出撤销
- 对方代理应当（SHOULD）将来自故障代理的进行中数据视为可能不可靠

<a id="11-conformance"></a>

## 11. 一致性

满足以下条件的实现符合 DCP-05：

1. 实现第 3 节定义的全部四种生命周期状态和有效转换
2. 按第 4 节的定义生成带双重签名的投入运行证书
3. 按第 6 节的定义，以配置的间隔产生以哈希链接的活力报告
4. 支持第 7 节定义的全部四种终止模式
5. 按第 8 节的定义生成封存的退役记录
6. 按第 9 节的定义为所有生命周期事件创建 DCP-03 审计条目
7. 所有签名都使用域分离上下文 `DCP-AI.v2.Lifecycle`（勘误 E2）
8. 在所有哈希链链接中实现双哈希（SHA-256 + SHA3-256）

<a id="references"></a>

## 参考资料

- DCP-01：身份与主体绑定
- DCP-02：意图声明与策略管控
- DCP-03：审计链与透明度
- DCP-04：代理间通信
- DCP-06：继任与继承
- NIST SP 800-88：Guidelines for Media Sanitization（密钥销毁）
- RFC 3339：Date and Time on the Internet

---

*本规范承认，AI 代理和所有运行系统一样，寿命是有限的。一个面向数字公民身份的协议不仅要考虑代理如何存在，还要考虑它们如何终结：有尊严、可问责，并留下完整的记录。*

<a id="implementation-notes-informative"></a>

## 实现说明（参考性）

> **2026 年 10 月 25 日添加。非规范性。** 这些说明不增加任何要求，也不改变上文任何内容：它们描述 `main` 上的参考代码
> 与本文的关系。两者不一致时，以上文的规范性文本为准，并适用
> [V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md) 的勘误所作的更正。

- **`schemas/v2/` 中的记录。** SDK 构建、`schemas/v2/` 验证的投入运行证书、活力报告和退役记录，其字段与
  §3 至 §9 的示例不同：例如活力报告中的 `vitality_score`、`state`、`metrics` 和 `prev_report_hash`，以及退役记录中的
  `final_vitality_score` 和 `data_disposition`。它们都没有 `prev_hash_secondary`、`merkle_root`、
  `countersignature` 或 `domain_sep`。§3.3 的转换记录和 §9.2 的审计条目没有 schema。
- **签名。** 每条记录只带一个 `composite_sig`（Ed25519 + ML-DSA-65），由持有所传入密钥的一方在上下文
  `DCP-AI.v2.Lifecycle` 下签署（勘误 E2）；SDK 不产生 §4.4 的机构签名加主体副署。
- **转换。** `validateStateTransition` 接受六条边：§3.2 的五条，以及 `commissioned` ->
  `decommissioned`。它只检查状态对，不检查主体批准、活力或签名者。
- **活力得分。** `computeVitalityScore` 接收 [0, 1] 范围内的四个指标（`task_completion_rate`、取反的
  `error_rate`、`human_satisfaction`、`policy_alignment`），使用 §5.1 的权重，并四舍五入到最接近的整数
  （`Math.round`）；§5.1 使用的是按 0–1000 计分的其他组成部分和 `floor`。活力链通过 `prev_report_hash`
  （仅 SHA-256）链接每份报告。
- **小数指标。** `dcp-jcs-v1` 只接受整数，因此 `metrics` 中含有 `0.83` 之类小数的活力报告无法规范化，也无法签名；
  在 schema 的 [0, 1] 范围下，已签名的报告每个指标只能是 0 或 1。§6 的示例中也有小数（`error_rate_percent`、
  `previous_pass_rate`）：它们是带有占位符的说明，而不是 fixtures。
- 这些记录是签名者所作的已签名声明；它们不能证明某个状态、得分或处置是真实的，SDK 和服务中也没有任何机制强制执行
  §7 和 §8 的宽限期、密钥销毁或会话终止。SDK 类型请参阅 [docs/API_REFERENCE.md](../docs/API_REFERENCE.md)。
