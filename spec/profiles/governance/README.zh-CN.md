<sub>[English](README.md) · **中文** · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="governance-profile"></a>

# Governance 配置文件

> 本文是[英文规范](README.md)的参考译文，更新于 25/10/2026。**具有规范效力的是英文版**：本译文不具规范效力，如有出入，以英文版为准。标识符和代码块保持原文，不作翻译。

**状态：** 已发布 — v2.0  
**范围：** 风险等级、司法管辖区证明、吊销、密钥恢复和治理操作  

---

<a id="purpose"></a>

## 目的

DCP 核心定义工件和验证模型。Governance 配置文件定义政策、规则和运营机制，决定这些工件在其生命周期中如何管理：谁可以吊销代理、如何分配风险等级、适用哪些司法管辖区要求，以及如何恢复密钥。

这明确不属于核心，因为：

- 治理政策取决于部署（政府部署与初创企业的规则不同）
- 风险等级的分配取决于验证器的背景，而不是协议结构
- 司法管辖区要求因国家和监管框架而异
- 密钥恢复和吊销机制涉及运营基础设施
- 治理仪式需要超出验证范围的多方协调

<a id="what-lives-here-not-in-core"></a>

## 这里包含什么（不在核心中）

<a id="adaptive-security-tiers"></a>

### 自适应安全等级

四级体系（routine、standard、elevated、maximum），根据意图风险评分、数据分类和操作类型自动选择密码保护级别。

见 [DCP-AI v2.0](../../DCP-AI-v2.0.md) 第 14 节。

<a id="jurisdiction-attestation"></a>

### 司法管辖区证明

由政府或经认可的机构出具的可选证明，针对特定司法管辖区证明委托人绑定记录中的身份。

见 [DCP-01](../../DCP-01.md) 的“Jurisdiction Attestation”一节。

<a id="revocation"></a>

### 吊销

吊销代理的机制：

- 通过已签名的 Revocation Record 进行的**标准吊销**（[DCP-01](../../DCP-01.md)）
- 通过预先登记的吊销令牌进行的**紧急吊销**（无需签名）
- 由机构发布的**司法管辖区吊销列表**

见 [DCP-AI v2.0](../../DCP-AI-v2.0.md) 第 11.3 节以及 [AUDIT 报告](../../AUDIT-v2.0-FINAL.md) 的第 13 号缺口。

<a id="key-recovery"></a>

### 密钥恢复

使用 Shamir 秘密共享的 M-of-N 社交恢复，各份额通过混合 KEM 加密。

见 [DCP-AI v2.0](../../DCP-AI-v2.0.md) 第 11.2 节以及 [AUDIT 报告](../../AUDIT-v2.0-FINAL.md) 的第 1 号缺口。

<a id="key-rotation"></a>

### 密钥轮换

轮换仪式：新密钥签名持有证明，旧密钥会签授权，并有可配置的宽限期。

见 [DCP-AI v2.0](../../DCP-AI-v2.0.md) 第 11.1 节。

<a id="governance-key-ceremonies"></a>

### 治理密钥仪式

用于签名算法公告和协议决定的 M-of-N 多方治理操作。

见 [DCP-AI v2.0](../../DCP-AI-v2.0.md) 第 13.1 节以及 [AUDIT 报告](../../AUDIT-v2.0-FINAL.md) 的“Governance Key Ceremony”。

<a id="verifier-authoritative-policy"></a>

### 由验证器决定的策略

签名策略由验证器的配置而不是代理设定的原则，包括安全等级绝不降级的规则。

见 [DCP-AI v2.0](../../DCP-AI-v2.0.md) 第 7.2 节。

<a id="what-stays-in-core"></a>

## 什么留在核心中

- 委托人绑定中存在吊销承诺（`revocation_token` 字段）
- 代理护照的 `status` 字段（active/suspended/revoked）
- 策略结果工件（但不包括策略决定如何作出）
- 审计轨迹（但不包括记录哪些治理事件）

<a id="normative-references"></a>

## 规范性参考

- [DCP-01](../../DCP-01.md) — 司法管辖区证明、Revocation Record
- [DCP-AI v2.0](../../DCP-AI-v2.0.md) — 第 7.2 节（验证器策略）、第 11 节（密钥管理）、第 13 节（治理）、第 14 节（安全等级）
- [存储与锚定](../../../docs/STORAGE_AND_ANCHORING.md) — 吊销列表、透明日志
- [运营指南](../../../docs/OPERATOR_GUIDE.md) — 运行验证服务

<a id="implementation-notes-informative"></a>

## 实现说明（参考性）

> **2026 年 10 月 25 日添加。非规范性。** 这些说明不增加任何要求，也不改变上文任何内容：它们描述 `main` 上的参考代码
> 与本文的关系。两者不一致时，以上文的规范性文本为准。

- 两个 RPR schema 都没有 `revocation_token` 字段。V2 护照 schema 有一个可选的
  `emergency_revocation_token`，即紧急吊销所检查的承诺；V1 护照没有。
- 护照的 `status` 枚举在 V1 中为 `active`、`suspended` 和 `revoked`，在 V2 中另加 `commissioned`、`declining` 和
  `decommissioned`（六种状态）。
- SDK 的密钥恢复辅助函数用 Shamir 方案拆分和重建秘密，并原样返回各份额：
  它们不会用混合 KEM 加密份额，也不会分发份额。加密并递送每一份额是
  调用方的工作。
