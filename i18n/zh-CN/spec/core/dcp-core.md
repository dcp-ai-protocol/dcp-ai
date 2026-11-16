<sub>[English](../../../../spec/core/dcp-core.md) · **中文** · [Español](../../../es/spec/core/dcp-core.md) · [日本語](../../../ja/spec/core/dcp-core.md) · [Português](../../../pt-BR/spec/core/dcp-core.md)</sub>

<a id="dcp-core-specification"></a>

# DCP 核心规范

> 本文是[英文规范](../../../../spec/core/dcp-core.md)的参考译文，更新于 25/10/2026。**具有规范效力的是英文版**：本译文不具规范效力，如有出入，以英文版为准。标识符和代码块保持原文，不作翻译。

**状态：** 已发布 — v2.0  
**版本：** 2.0  
**日期：** 2026-03-01  

---

<a id="1-introduction"></a>

## 1. 引言

Digital Citizenship Protocol（DCP）为在开放网络上运行的 AI 代理定义了一个可移植的问责层。DCP 核心是协议的最小可互操作范围：每个符合要求的实现都必须支持的工件、关系和验证规则的集合。

收到 DCP bundle 的验证器无需依赖任何中心机构即可回答四个问题：

1. **谁对**这个代理**负责**？
2. 代理**声明**了它打算做什么？
3. 对该意图应用了**什么策略结果**？
4. 关于代理的操作存在**什么可验证的证据**？

DCP 核心定义这些答案的结构和语义。它不规定具体的密码算法、传输机制、治理政策或运营基础设施：这些属于配置文件和服务。

<a id="11-relationship-to-existing-specifications"></a>

### 1.1 与现有规范的关系

本文档是一份编辑性规范，组织并统一了已在以下文档中发布的材料：

- [DCP-01](../../../../spec/DCP-01.md) — 身份与委托人绑定
- [DCP-02](../../../../spec/DCP-02.md) — 意图声明与策略管控
- [DCP-03](../../../../spec/DCP-03.md) — 审计链与透明性
- [BUNDLE](../../../../spec/BUNDLE.md) — Citizenship Bundle 格式
- [VERIFICATION](../../../../spec/VERIFICATION.md) — 验证清单
- [DCP-AI v2.0](../../../../spec/DCP-AI-v2.0.md) — 包括后量子扩展在内的完整规范性规范

它并不取代这些文档。它提供统一的核心视图，并澄清核心与配置文件之间的边界。

---

<a id="2-problem-statement"></a>

## 2. 问题陈述

AI 代理越来越多地在开放网络上自主运行：调用 API、交换数据、进行交易，并与其他代理协作。现有的身份验证机制（API 密钥、OAuth 令牌、mTLS 证书）建立的是*访问控制*，而不是*问责*。

目前没有标准化的方法来回答：

- 谁部署了这个代理并为其行为承担责任？
- 代理在行动之前声明了它会做什么？
- 该操作是否得到了策略的授权？
- 是否存在对实际发生之事的可发现篡改的记录？

DCP 核心通过定义一组最小、可移植、任何代理都能携带、任何验证器都能评估的工件来弥补这一缺口。

---

<a id="3-scope"></a>

## 3. 范围

<a id="in-scope-core"></a>

### 范围内（核心）

- 六个核心工件及其必需字段
- 工件之间的关系（绑定、哈希、链接）
- 验证模型（验证器必须检查什么）
- bundle 格式（工件如何打包以便传输）
- 对密码签名的要求（不规定算法）
- 对审计条目以哈希链连接的要求（不规定哈希函数）

<a id="out-of-scope-profiles-and-services"></a>

### 范围外（配置文件和服务）

- 具体的密码算法 → [Crypto 配置文件](../../../../spec/profiles/crypto/)
- 代理之间的发现和通信 → [A2A 配置文件](../../../../spec/profiles/a2a/)
- 风险等级分配、司法管辖区、吊销、治理 → [Governance 配置文件](../../../../spec/profiles/governance/)
- 验证服务器、区块链锚定、透明日志 → 基础设施服务
- 策略引擎的实现
- 密钥管理基础设施的部署
- 超出传输格式的网络传输要求

---

<a id="4-core-artifacts"></a>

## 4. 核心工件

DCP 核心定义了六个工件。有效的 Citizenship Bundle 包含全部六个（尽管操作证据可以包含一个或多个条目）。

<a id="41-responsible-principal-binding"></a>

### 4.1 负责委托人绑定

每个代理都必须（MUST）绑定到一个负责的委托人：为代理的行为承担问责的个人、组织或法律实体。

绑定记录包含：

- 委托人的唯一标识符
- 实体类型（自然人、法人）
- 委托人所处的司法管辖区
- 用于签名验证的密码密钥材料
- 吊销承诺（使无需签名的紧急吊销成为可能）
- 协议版本和会话绑定

该绑定建立了问责链：如果代理行为不当，可以找出负责的委托人。

规范性定义见 [DCP-01](../../../../spec/DCP-01.md)，schema 见 `schemas/v1/responsible_principal_record.schema.json`。

<a id="42-agent-passport"></a>

### 4.2 代理护照

每个代理都携带一本护照，用于确立其身份并将其与负责的委托人关联。护照包含：

- 代理的唯一标识符
- 人类可读的名称
- 声明的能力
- 负责委托人绑定记录的密码哈希（`owner_rpr_hash`）
- 代理自己的密钥材料
- 状态（active、suspended、revoked）
- 协议版本和会话绑定

护照由负责的委托人签名。验证器可以通过检查委托人的签名和哈希关联来确认代理已获授权。

规范性定义见 [DCP-01](../../../../spec/DCP-01.md)，schema 见 `schemas/v1/agent_passport.schema.json`。

<a id="43-intent-declaration"></a>

### 4.3 意图声明

在执行任何操作之前，代理都必须（MUST）声明其意图。意图是对以下内容的结构化描述：

- 代理计划执行什么操作
- 操作的目标是什么
- 涉及哪些数据分类
- 评估出的风险评分

意图有两个用途：它使策略管控成为可能（第 4.4 节），并创建一份可与审计轨迹中实际行为进行比较的事先承诺记录。

规范性定义见 [DCP-02](../../../../spec/DCP-02.md)，schema 见 `schemas/v1/intent.schema.json`。

<a id="44-policy-outcome"></a>

### 4.4 策略结果

每个意图都会从策略引擎获得一个策略结果。策略引擎在 DCP 之外：协议只定义结果的格式：

- **决定：** approve、escalate 或 block
- **意图哈希：** 与所评估意图的密码绑定
- **条件：** 批准附带的可选约束（速率限制、人工确认等）

DCP 核心要求 bundle 中的每个意图都存在策略结果。它不要求任何特定的策略引擎或决策算法。

规范性定义见 [DCP-02](../../../../spec/DCP-02.md)，schema 见 `schemas/v1/policy_decision.schema.json`。

<a id="45-action-evidence"></a>

### 4.5 操作证据

每个操作都会产生一个或多个审计条目，构成以哈希链连接、可发现篡改的日志。每个条目包含：

- 事件的唯一标识符
- 事件类型
- 对代理和意图的引用
- 意图的哈希（将证据绑定到声明）
- 前一个审计条目的哈希（`prev_hash`），构成一条不可变的链
- 时间戳

链中的第一个条目使用哨兵值 `"GENESIS"` 作为其 `prev_hash`。后续条目通过 `SHA-256(canonical(previous_entry))` 链接到其前一个条目。

可选地，可以在所有条目之上计算 Merkle 根，用一个哈希概括整个审计轨迹。

规范性定义见 [DCP-03](../../../../spec/DCP-03.md)，schema 见 `schemas/v1/audit_entry.schema.json`。

<a id="46-bundle-manifest"></a>

### 4.6 bundle 清单

Citizenship Bundle 是把所有工件汇集在一起的可移植包。一个 bundle 恰好包含：

- 一个负责委托人绑定记录
- 一本代理护照
- 一个意图声明
- 一个策略结果
- 一个或多个操作证据条目（审计轨迹）

Signed Bundle 用密码签名、`bundle_hash`（规范 bundle 的哈希）以及可选的审计条目 `merkle_root` 包装 Citizenship Bundle。

规范性定义见 [BUNDLE](../../../../spec/BUNDLE.md)，schema 见 `schemas/v1/citizenship_bundle.schema.json` / `schemas/v1/signed_bundle.schema.json`。

---

<a id="5-verification-model"></a>

## 5. 验证模型

收到 Signed Bundle 的验证器执行以下检查。所有检查都在本地完成：不需要调用任何服务器。

1. **schema 校验** — bundle 及其内部工件符合预期的 schema
2. **签名验证** — bundle 签名对签名者的公钥有效
3. **哈希完整性** — `bundle_hash` 与重新计算的规范 bundle 哈希一致
4. **委托人有效性** — 负责委托人记录未过期
5. **代理状态** — 代理护照的状态为 `active`
6. **意图绑定** — 每个审计条目的 `intent_hash` 与所声明意图的哈希一致
7. **审计链完整性** — `prev_hash` 链从 `GENESIS` 到所有条目都有效
8. **Merkle 根**（如果存在）— 声明的 Merkle 根与重新计算的根一致

其他可选检查（在配置文件中定义，不属于核心）：

- 吊销列表查询（Governance 配置文件）
- 司法管辖区证明验证（Governance 配置文件）
- 透明日志包含证明（Governance 配置文件）
- 区块链锚定验证（Governance 配置文件）
- 复合签名 / PQ 验证（Crypto 配置文件）

完整的规范性清单见 [VERIFICATION](../../../../spec/VERIFICATION.md)。

---

<a id="6-security-notes"></a>

## 6. 安全说明

<a id="61-algorithm-independence"></a>

### 6.1 算法无关性

DCP 核心要求密码签名和哈希函数，但不强制规定具体算法。这种分离使得：

- 实现可以从经典算法开始，之后再采用后量子算法
- 验证器可以执行自己的算法策略
- 协议能够经受算法过渡而不破坏核心规范

[Crypto 配置文件](../../../../spec/profiles/crypto/) 定义了 DCP v2.0 中使用的具体算法、复合签名绑定和密码敏捷性机制。

<a id="62-trust-model"></a>

### 6.2 信任模型

DCP 不假定存在中心机构。验证是本地的、点对点的：验证器只需要 Signed Bundle 和（可选的）一组吊销记录。对负责委托人的信任通过绑定记录及其签名链建立，而不是通过中心化注册表。

<a id="63-privacy"></a>

### 6.3 隐私

核心支持一种盲化模式，其中委托人绑定中的个人数据字段被替换为加盐的承诺哈希（`pii_hash`，见 [DCP-AI v2.0 §12.1](../../../../spec/DCP-AI-v2.0.md#121-blinded-rpr)）。非个人数据字段（密钥、司法管辖区、责任）被保留以供验证。完整记录可以按需向获授权方披露。

<a id="64-replay-protection"></a>

### 6.4 重放防护

在 DCP v2.0 中，`session_nonce` 字段把 bundle 中的所有工件绑定到同一个会话。验证器必须检查所有工件共享同一个 nonce。这可以防止会话拼接攻击。会话绑定在 v2.0 中是规范性必需的，但在 v1.0 中并不存在。

---

<a id="7-extensibility"></a>

## 7. 可扩展性

DCP 核心被设计为通过配置文件进行扩展。一个配置文件：

- 不得（MUST NOT）与核心要求相矛盾
- 可以（MAY）定义额外的工件、字段或验证步骤
- 可以（MAY）指定算法选择、传输绑定或治理政策
- 独立于核心进行版本管理

一个符合要求的核心实现即使没有任何配置文件也是有效的。配置文件增加的是能力，而不是要求。

当前已定义的配置文件有：

| 配置文件 | 范围 | 文档 |
|---------|-------|----------|
| Crypto | 算法、复合签名、密码敏捷性 | [spec/profiles/crypto/](../../../../spec/profiles/crypto/) |
| A2A | 代理发现、握手、会话管理 | [spec/profiles/a2a/](../../../../spec/profiles/a2a/) |
| Governance | 风险等级、司法管辖区、吊销、恢复 | [spec/profiles/governance/](../../../../spec/profiles/governance/) |

---

<a id="references"></a>

## 参考

- [DCP-01](../../../../spec/DCP-01.md) — 身份与委托人绑定
- [DCP-02](../../../../spec/DCP-02.md) — 意图声明与策略管控
- [DCP-03](../../../../spec/DCP-03.md) — 审计链与透明性
- [DCP-04](../../../../spec/DCP-04.md) — 代理之间的通信
- [BUNDLE](../../../../spec/BUNDLE.md) — Citizenship Bundle 格式
- [VERIFICATION](../../../../spec/VERIFICATION.md) — 验证清单
- [DCP-AI v2.0](../../../../spec/DCP-AI-v2.0.md) — 后量子规范性规范
- [ROADMAP](../../../../ROADMAP.md) — 项目演进路线图

<a id="implementation-notes-informative"></a>

## 实现说明（参考性）

> **2026 年 10 月 25 日添加。非规范性。** 这些说明不增加任何要求，也不改变上文任何内容：它们描述 `main` 上的参考代码
> 与本文的关系。两者不一致时，以上文的规范性文本为准。

- **字段名称。** 第 4 节中的一些描述是概念性的，与 schema 并不逐字段对应。两个 RPR
  schema 都没有吊销承诺字段；V2 护照有一个可选的 `emergency_revocation_token`。没有任何护照
  schema 带有名称或 `owner_rpr_hash`：护照用
  `principal_binding_reference` 指向委托人。风险评分位于策略决定中（`risk_score`），而不在意图中，
  策略决定通过 `intent_id` 引用其意图，并在 `required_confirmation` 中列出条件。审计条目
  带有 `audit_id` 和 `outcome`，而不是事件类型。
- **V1 与 V2。** 第 4.6 节的 bundle 和第 5 节的检查是 V1 的：对 bundle 的一个 Ed25519 签名，且至少
  一个审计条目。V2 bundle 带有一个对每个工件作出承诺的已签名清单、四个主要工件的
  `SignedPayload` 封装、一个会话 nonce 和复合签名，审计轨迹可以
  为空（[VERIFICATION.md](../../../../spec/VERIFICATION.md)，V2 清单）。
- **谁签名护照。** 在 V2 中，代理用护照 `keys` 签名自己的护照；它通过委托人对清单的签名
  （用 RPR `binding_keys` 作出）与委托人绑定（VERIFICATION.md V2-6）。
- **审计证据（第 4.5 节、第 6 节）。** 通过验证的审计轨迹表明所记录的条目完好，并由 bundle 列出的密钥
  承诺；它并不表明这些操作真的发生过，而且对于持有这些密钥并签名新链的人来说，这条链并非
  不可变。验证和准入本身都不授权任何操作。
- **信任（第 6.2 节）。** 通过验证的 bundle 证明其签名与它列出的密钥相符；它并不证明委托人是谁，
  因为任何人都可以创建 RPR。对委托人的信任来自验证器自己的信任集：
  见 [docs/ADMISSION.md](../../../../docs/ADMISSION.md) 和[准入配置文件](../../../../spec/profiles/admission/)。
- **配置文件（第 7 节）。** “没有任何配置文件也是有效的”是就核心工件的互操作而言。它并不免除
  实现对核心要求的遵守，部署仍要应用自己的验证器策略，在使用时
  还要应用准入配置文件。
