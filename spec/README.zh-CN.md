<sub>[English](README.md) · **中文** · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="specs--dcp-ai-normative"></a>
<a id="specs-dcp-ai-normative"></a>

# 规范 — DCP-AI 规范性文档

**Go 发布 (26/10/2026).** Go SDK `v2.11.0` 已通过模块标签 `sdks/go/v2.11.0` 发布，包含验证器修复、准入和实验性显式启用 API。Rust 仍独立发布。见 [Go v2.11.0](../docs/GO_RELEASE.md).

**Python 发布 (26/10/2026).** `dcp-ai` 2.10.0 已在 PyPI 发布，包含验证器修复、准入和实验性显式启用 API。Go 和 Rust 仍独立发布。见 [Python 2.10.0](../docs/PYTHON_RELEASE.md).

> 本文是[英文版](README.md)的参考译文，更新于 26/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

Digital Citizenship Protocol for AI Agents 的规范性规范。格式以 `schemas/v1/` 和 `schemas/v2/` 中的 JSON Schema 为准；这些文档定义范围、工件以及如何校验。[V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md) 列出了使 DCP-05、DCP-08 和 DCP-09 的名称、签名上下文和示例与该格式一致的勘误，以及分别判断的四个层次（可表示、符合模式、已验证、合规）。

<a id="foundation-specifications-dcp-01--dcp-03"></a>
<a id="foundation-specifications-dcp-01-dcp-03"></a>

## 基础规范（DCP-01 – DCP-03）

| 规范 | 范围 | 工件 |
|------|-------|-----------|
| [DCP-01](DCP-01.md) | 身份与委托人绑定 | Responsible Principal Record、Agent Passport、Revocation Record |
| [DCP-02](DCP-02.md) | 意图声明与策略管控 | Intent、PolicyDecision、HumanConfirmation（可选） |
| [DCP-03](DCP-03.md) | 审计链与透明性 | AuditEntry、prev_hash 链接、可选的 Merkle |
| [BUNDLE](BUNDLE.md) | Citizenship Bundle 与 Signed Bundle | Citizenship Bundle（L3）、Signed Bundle（Ed25519 签名、bundle_hash、merkle_root） |
| [VERIFICATION](VERIFICATION.md) | 验证清单 | 验证 Signed Bundle 的规范性步骤（schema、签名、过期、吊销、intent_hash、审计链、Merkle；全部在本地完成） |

**校验**（`dcp` 是检出代码中的参考 CLI，即 `node bin/dcp.js`）：`dcp validate <schema> <json>`、`dcp validate-bundle <bundle.json>`、`dcp verify-bundle [--policy <mode>] <signed.json> [public_key.txt]`、`dcp intent-hash <intent.json>`。
**一致性：** `npm run conformance` 校验 L3-OBJECTS + L3-BUNDLE + L3-SIGNED + intent_hash 和 prev_hash 链。

这些命令以及 DCP-01 至 DCP-03 描述的是 V1 工件；V2 工件和检查见
[DCP-AI v2.0](DCP-AI-v2.0.md) 以及 [VERIFICATION](VERIFICATION.md) 的 V2 清单。通过验证的 bundle 是一致的，
并由它列出的密钥签名；对其委托人的信任是另一个步骤（[docs/ADMISSION.md](../docs/ADMISSION.md)）。

---

<a id="communication--cryptography-dcp-04-v20"></a>
<a id="communication-cryptography-dcp-04-v20"></a>

## 通信与密码学（DCP-04、v2.0）

| 文档 | 范围 |
|----------|-------|
| [DCP-04](DCP-04.md) | 代理之间的通信 |
| [DCP-AI v2.0](DCP-AI-v2.0.md) | 后量子规范性规范 |
| [规范化配置文件](CANONICALIZATION_PROFILE.md) | `dcp-jcs-v1` — 用于每个签名、哈希和 Merkle 叶节点的逐字节精确 JSON 规范化 |
| [安全审计](AUDIT-v2.0-FINAL.md) | 2026 年 2 月 26 日的 v2.0 最终安全审计（关闭了 13 个缺口）；这是一份历史记录，附有关于后续审查所作限定的说明 |

---

<a id="constitutional-framework-dcp-05--dcp-09"></a>
<a id="constitutional-framework-dcp-05-dcp-09"></a>

## 宪法性框架（DCP-05 – DCP-09）

规定代理生命周期、继承、争议解决、权利和委托的规范，即协议的宪法层。

| 规范 | 范围 | 关键工件 |
|------|-------|---------------|
| [DCP-05](DCP-05.md) | 代理生命周期管理 | CommissioningCertificate、VitalityReport、DecommissioningRecord |
| [DCP-06](DCP-06.md) | 数字继承与遗产 | DigitalTestament、SuccessionRecord、MemoryTransferManifest |
| [DCP-07](DCP-07.md) | 冲突解决与争议仲裁 | DisputeRecord、ArbitrationResolution、JurisprudenceBundle、ObjectionRecord |
| [DCP-08](DCP-08.md) | 权利与义务框架 | RightsDeclaration、ObligationRecord、RightsViolationReport |
| [DCP-09](DCP-09.md) | 个人代表与委托 | DelegationMandate、AdvisoryDeclaration、PrincipalMirror、AwarenessThreshold |

**Schema：** `schemas/v2/` 中的 18 个 JSON Schema，覆盖 DCP-05–09 的所有工件。
**服务器端点：** 参考验证服务器中的 31 个 REST 端点，没有身份验证，也不验证签名（见 [OPERATOR_GUIDE](../docs/OPERATOR_GUIDE.md#dcp-0509-service-endpoints)）。
**域分离：** 7 个新上下文 — `Lifecycle`、`Succession`、`Dispute`、`Rights`、`Delegation`、`Awareness`、`SubMandate`。

---

<a id="core-and-profiles"></a>

## 核心与配置文件

规范正在被组织为**核心**（最小可互操作协议）和**配置文件**（针对特定部署需求的扩展）：

| 目录 | 范围 |
|-----------|-------|
| [core/](core/) | DCP 核心 — 工件、验证模型、bundle 结构 |
| [profiles/](profiles/) | 配置文件 — 密码、A2A、治理扩展 |
| [profiles/crypto/](profiles/crypto/) | 算法选择、复合签名、密码敏捷性 |
| [profiles/a2a/](profiles/a2a/) | 代理发现、握手、会话管理 |
| [profiles/governance/](profiles/governance/) | 风险等级、司法管辖区、吊销、密钥恢复 |
| [profiles/admission/](profiles/admission/) | 准入：受信任的委托人和 strict-v1 配置文件（在 `main` 的 SDK 中，已包含在 npm SDK 2.2.0 中，其他生态独立发布） |

现有规范（DCP-01 至 DCP-09、BUNDLE、VERIFICATION、DCP-AI v2.0）仍具权威性。核心和配置文件文档提供编辑性背景，并澄清关注点的分离。计划中的演进见 [ROADMAP](../ROADMAP.md)。
