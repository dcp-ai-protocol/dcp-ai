<sub>[English](README.md) · **中文** · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

# 规范 — DCP-AI 规范性

面向 AI 智能体的数字公民身份协议的规范性规范。格式的唯一真理来源是 `schemas/v1/` 和 `schemas/v2/` 中的 JSON Schema；这些文档定义范围、工件以及如何验证。

## 基础规范 (DCP-01 – DCP-03)

| 规范 | 范围 | 工件 |
|------|-------|-----------|
| [DCP-01](DCP-01.md) | 身份与主体绑定 | 责任主体记录、智能体护照、撤销记录 |
| [DCP-02](DCP-02.md) | 意图声明与策略门控 | Intent、PolicyDecision、HumanConfirmation（可选） |
| [DCP-03](DCP-03.md) | 审计链与透明度 | AuditEntry、prev_hash 链接、可选 Merkle |
| [BUNDLE](BUNDLE.md) | 公民凭证包与已签名凭证包 | 公民凭证包 (L3)、已签名凭证包 (Ed25519 签名、bundle_hash、merkle_root) |
| [VERIFICATION](VERIFICATION.md) | 验证清单 | 验证已签名凭证包的规范性步骤（schema、签名、过期、撤销、intent_hash、审计链、merkle；全部本地） |

**验证：** `dcp validate <schema> <json>`、`dcp validate-bundle <bundle.json>`、`dcp verify-bundle <signed.json> <public_key.txt>`、`dcp intent-hash <intent.json>`。
**一致性：** `npm run conformance` 验证 L3-OBJECTS + L3-BUNDLE + L3-SIGNED + intent_hash 与 prev_hash 链。

---

## 通信与密码学 (DCP-04、v2.0)

| 文档 | 范围 |
|----------|-------|
| [DCP-04](DCP-04.md) | 智能体间通信 |
| [DCP-AI v2.0](DCP-AI-v2.0.md) | 后量子规范性规范 |
| [Security Audit](AUDIT-v2.0-FINAL.md) | v2.0 最终安全审计（关闭 13 个缺口） |

---

## 宪法框架 (DCP-05 – DCP-09)

管理智能体生命周期、继任、争议解决、权利与委派的规范 —— 协议的宪法层。

| 规范 | 范围 | 关键工件 |
|------|-------|---------------|
| [DCP-05](DCP-05.md) | 智能体生命周期管理 | CommissioningCertificate、VitalityReport、DecommissioningRecord |
| [DCP-06](DCP-06.md) | 数字继承与继任 | DigitalTestament、SuccessionRecord、MemoryTransferManifest |
| [DCP-07](DCP-07.md) | 冲突解决与争议仲裁 | DisputeRecord、ArbitrationResolution、JurisprudenceBundle、ObjectionRecord |
| [DCP-08](DCP-08.md) | 权利与义务框架 | RightsDeclaration、ObligationRecord、RightsViolationReport |
| [DCP-09](DCP-09.md) | 个人代表与委派 | DelegationMandate、AdvisoryDeclaration、PrincipalMirror、AwarenessThreshold |

**Schema：** `schemas/v2/` 中的 18 个 JSON Schema，覆盖所有 DCP-05–09 工件。
**服务器端点：** 验证服务器中的 31 个 REST 端点（参见 [OPERATOR_GUIDE](../docs/OPERATOR_GUIDE.md)）。
**域分离：** 6 个新上下文 —— `Lifecycle`、`Succession`、`Dispute`、`Rights`、`Delegation`、`Awareness`。

---

## 核心与 Profile

规范正在被组织为 **Core**（最小互操作协议）和 **Profile**（针对特定部署需求的扩展）：

| 目录 | 范围 |
|-----------|-------|
| [core/](core/) | DCP Core — 工件、验证模型、凭证包结构 |
| [profiles/](profiles/) | Profiles — crypto、A2A、治理扩展 |
| [profiles/crypto/](profiles/crypto/) | 算法选择、复合签名、密码学敏捷性 |
| [profiles/a2a/](profiles/a2a/) | 智能体发现、握手、会话管理 |
| [profiles/governance/](profiles/governance/) | 风险等级、管辖权、撤销、密钥恢复 |

现有规范（DCP-01 至 DCP-09、BUNDLE、VERIFICATION、DCP-AI v2.0）仍具有权威性。核心与 Profile 文档提供编辑性上下文，并明晰关注点分离。有关规划中的演进，参见 [ROADMAP](../ROADMAP.md)。
