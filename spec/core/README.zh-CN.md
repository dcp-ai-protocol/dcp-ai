<sub>[English](README.md) · **中文** · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="dcp-core"></a>

# DCP 核心

> 本文是[英文规范](README.md)的参考译文，更新于 25/10/2026。**具有规范效力的是英文版**：本译文不具规范效力，如有出入，以英文版为准。标识符和代码块保持原文，不作翻译。

本目录包含 Digital Citizenship Protocol 的**核心规范**：每个 DCP 实现都必须支持的最小可互操作协议范围。

<a id="what-is-dcp-core"></a>

## 什么是 DCP 核心？

DCP 核心定义了工件、它们之间的关系以及验证模型，使任何验证器都能评估：

- 代理由**谁负责**（与负责委托人的绑定）
- 代理**声明**了它打算做什么（意图声明）
- 应用了**什么策略结果**（策略决定）
- 产生了**什么可验证的证据**（操作证据 / 审计轨迹）
- **所有工件如何打包**以便可移植地验证（bundle 清单）

核心刻意保持最小。它定义*什么*必须存在以及*如何*验证，但把*如何*签名、使用*哪些*算法、代理*如何*相互发现以及治理策略*如何*执行委托给**配置文件**。

<a id="core-artifacts"></a>

## 核心工件

| 工件 | 用途 | 现有规范 |
|----------|---------|---------------|
| Responsible Principal Record | 将代理绑定到个人或法律实体 | [DCP-01](../DCP-01.md)（作为“Responsible Principal Record”） |
| Agent Passport | 代理的身份、能力和密钥材料 | [DCP-01](../DCP-01.md) |
| Intent Declaration | 行动前的结构化声明 | [DCP-02](../DCP-02.md) |
| Policy Outcome | 对某个意图的授权决定 | [DCP-02](../DCP-02.md) |
| Action Evidence | 以哈希链连接的审计条目 | [DCP-03](../DCP-03.md) |
| Bundle Manifest | 绑定所有工件的可移植包 | [BUNDLE](../BUNDLE.md) |

<a id="documents"></a>

## 文档

- [dcp-core.md](dcp-core.md) — 包含完整理由和工件定义的编辑性核心规范

<a id="relationship-to-existing-specs"></a>

## 与现有规范的关系

核心规范是一个编辑性的叠加层，把现有的规范性规范（DCP-01 至 DCP-03、BUNDLE、VERIFICATION）组织成一个连贯的核心。它并不取代它们，而是提供协议最小范围的统一视图。

<a id="what-is-not-core"></a>

## 什么不属于核心

以下内容明确不属于核心，而属于配置文件或服务：

- 具体的密码算法（Ed25519、ML-DSA-65 等）→ [Crypto 配置文件](../profiles/crypto/)
- 代理之间的发现和通信 → [A2A 配置文件](../profiles/a2a/)
- 风险等级、司法管辖区、吊销、治理 → [Governance 配置文件](../profiles/governance/)
- 验证服务器、锚定、透明日志 → 基础设施服务

<a id="implementation-notes-informative"></a>

## 实现说明（参考性）

> **2026 年 10 月 25 日添加。非规范性。** 这些说明不增加任何要求，也不改变上文任何内容：它们描述 `main` 上的参考代码
> 与本文的关系。两者不一致时，以上文的规范性文本为准。

- 核心工件有两个传输格式版本。V1（`schemas/v1/`）：没有清单、没有 `SignedPayload` 封装、没有
  `session_nonce`、对 bundle 的一个 Ed25519 签名，且至少一个审计条目。V2（`schemas/v2/`，在
  [DCP-AI v2.0](../DCP-AI-v2.0.md) 中规定）：一个对每个工件作出承诺的已签名清单，RPR、护照、意图和
  策略决定的 `SignedPayload` 封装，一个会话 nonce，复合签名，以及可以为空的
  审计轨迹。
- 在 V2 中，RPR 带有委托人的 `binding_keys`，护照由代理自己的密钥签名。通过验证的
  bundle 证明其签名与它列出的密钥相符，而不是证明委托人是谁：信任来自
  验证器的信任集（[docs/ADMISSION.md](../../docs/ADMISSION.md)）。
