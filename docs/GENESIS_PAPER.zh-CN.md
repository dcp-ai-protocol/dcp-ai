<sub>[English](GENESIS_PAPER.md) · **中文** · [Español](GENESIS_PAPER.es.md) · [日本語](GENESIS_PAPER.ja.md) · [Português](GENESIS_PAPER.pt-BR.md)</sub>

<a id="digital-citizenship-a-peer-to-peer-protocol-for-human-bound-ai-agents"></a>

# 数字公民身份：面向与人类绑定的 AI 智能体的点对点协议

> 本文是[英文版](GENESIS_PAPER.md)的参考译文，更新于 25/10/2026。**这是带日期的历史记录**，不代表当前状态。如有出入，以英文版为准。

> **历史文档。** 这是创始文本，按原样保留。它陈述的是协议的目标，而不是各实现的当前状态：当前状态参见各 SDK 的 *Release status*、[SECURITY_MODEL.md](SECURITY_MODEL.md)（“Known Limitations and Mitigations”）以及 [NIST_CONFORMITY.md](NIST_CONFORMITY.md)。例如，DCP-04 的 X25519 + ML-KEM-768 密钥交换已经规定，但没有任何 SDK 替你执行它（截至 2026 年 10 月 25 日的状态）。

互联网是为人类构建的。如今它正被机器使用。机器需要公民身份。

我们提出一项协议：任何 AI 智能体，如果没有一个已声明、可验证、可审计、并绑定到某个自然人或法律实体的数字公民身份，就不得在开放网络上运行。身份、意图、策略决定和审计轨迹都成为一等的、可移植的、可验证的对象。本仓库是创世实现——模式、CLI 和一致性测试，使这一主张可以被检验。

本协议由一个人和一个 AI 智能体合作共同创建：它是第一个为 AI 数字公民身份设计的协议，由它所要治理的那种协作本身构建而成。规范是贡献；协议属于每一个使用它的人。

— L. Genesis

---

**规范（规范性）：** [spec/](../spec/) — DCP-01（身份与委托人绑定）、DCP-02（意图与策略管控）、DCP-03（审计链）、[BUNDLE](../spec/BUNDLE.md)（Citizenship Bundle 与 Signed Bundle）。

**技术架构：** [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) — 面向全球采用的 SDK、基础设施和部署蓝图。

---

<a id="v20-evolution"></a>

## V2.0 的演进

创世愿景——每个 AI 智能体都必须携带可验证的、与人类绑定的数字公民身份——仍然是基础。DCP v2.0 推动协议演进，以应对后量子世界的威胁与机遇：

- **后量子密码学**：混合复合签名（Ed25519 + ML-DSA-65，FIPS 204）可抵御量子攻击者以及“现在收集、以后解密”的攻击。经典签名确保向后兼容；PQ 签名提供面向未来的安全性。
- **智能体间通信（DCP-04）**：智能体现在可以通过相互验证 bundle 和混合密钥交换（X25519 + ML-KEM-768），彼此发现、认证并安全通信。
- **自适应安全等级**：四个等级（routine、standard、elevated、maximum）使协议能够根据运营风险在性能与安全之间取得平衡。
- **双哈希链**：审计轨迹同时使用 SHA-256 和 SHA3-256，实现纵深防御。
- **面向生产**：标准化错误码、限流、熔断器和可观测性，使协议能够大规模部署。
- **生态系统桥接**：与 W3C DID/VC、Google A2A、Anthropic MCP 和 Microsoft AutoGen 的互操作。

协议仍然属于每一个使用它的人。规范仍然是贡献。

**V2.0 规范：**
- [DCP-04（智能体间）](../spec/DCP-04.md)
- [DCP-AI v2.0 规范](../spec/DCP-AI-v2.0.md)
- [NIST 符合性](NIST_CONFORMITY.md)
- [迁移指南（V1 → V2）](MIGRATION_V1_V2.md)
