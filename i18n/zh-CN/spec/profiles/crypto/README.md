<sub>[English](../../../../../spec/profiles/crypto/README.md) · **中文** · [Español](../../../../es/spec/profiles/crypto/README.md) · [日本語](../../../../ja/spec/profiles/crypto/README.md) · [Português](../../../../pt-BR/spec/profiles/crypto/README.md)</sub>

<a id="crypto-profile"></a>

# Crypto 配置文件

> 本文是[英文规范](../../../../../spec/profiles/crypto/README.md)的参考译文，更新于 28/10/2026。**具有规范效力的是英文版**：本译文不具规范效力，如有出入，以英文版为准。标识符和代码块保持原文，不作翻译。

**状态：** 已发布 — v2.0  
**范围：** 密码算法选择、复合签名、密码敏捷性和验证器策略  

---

<a id="purpose"></a>

## 目的

DCP 核心要求密码签名和哈希函数，但刻意不强制规定具体算法。Crypto 配置文件定义 DCP v2.0 中使用的具体密码选择，以及随时间演进这些选择的机制。

这种分离确保：

- 核心协议能在不做结构性改动的情况下经受算法过渡（例如后量子迁移）
- 验证器可以根据风险背景执行自己的算法策略
- 实现可以从经典算法开始，在准备好时再采用后量子算法
- 算法的弃用不会破坏核心规范

<a id="what-lives-here-not-in-core"></a>

## 这里包含什么（不在核心中）

<a id="algorithm-registry"></a>

### 算法注册表

已批准的签名算法（Ed25519、ML-DSA-65、ML-DSA-87、SLH-DSA-192f）、密钥封装机制（X25519、ML-KEM-768、混合 X25519+ML-KEM-768）和哈希算法（SHA-256、SHA3-256、SHA-384）的集合。

> *参考性说明（2026 年 10 月 25 日），不属于配置文件：* 目前还没有任何 DCP-AI SDK 实现 ML-DSA-87，也没有任何 SDK 导出混合 X25519+ML-KEM-768 交换（[docs/NIST_CONFORMITY.md](../../../../../docs/NIST_CONFORMITY.md)）。

完整的注册表见 [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md) 第 2 节。

<a id="composite-signature-binding"></a>

### 复合签名绑定

`pq_over_classical` 绑定协议，确保经典签名和后量子签名组件都不能被剥离：

1. 经典签名对 `context || 0x00 || payload` 签名
2. PQ 签名对 `context || 0x00 || payload || classical_sig` 签名

绑定协议和传输格式见 [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md) 第 5 节。

<a id="domain-separation"></a>

### 域分离

防止跨工件重放攻击的上下文标签。每种工件类型都有唯一的上下文标签（例如 `DCP-AI.v2.AgentPassport`、`DCP-AI.v2.Intent`）。

完整的标签列表见 [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md) 第 4 节。

<a id="verification-modes"></a>

### 验证模式

由验证器决定的策略，确定需要哪些签名组件：

- `classical_only` — 只需要经典签名
- `hybrid_preferred` — 需要经典签名，建议有 PQ 签名
- `hybrid_required` — 经典签名和 PQ 签名都需要
- `pq_only` — 只需要 PQ 签名（第 3 阶段）

验证模式和验证器策略格式见 [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md) 第 7 节。

<a id="crypto-agility"></a>

### 密码敏捷性

算法公告系统，允许治理机构通过已签名的公告弃用或吊销算法，并由验证器自动响应。

见 [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md) 第 13.2 节以及 [AUDIT 报告](../../../../../spec/AUDIT-v2.0-FINAL.md) 的第 4 号缺口。

<a id="dual-hash-chains"></a>

### 双哈希链

审计条目的并行 SHA-256 和 SHA3-256 哈希链，在某一哈希族被攻破时提供连续性。

见 [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md) 第 10.3 节。

<a id="what-stays-in-core"></a>

## 什么留在核心中

- 工件必须签名的要求（但不规定用哪种算法）
- 审计条目必须以哈希链连接的要求（但不规定用哪种哈希函数）
- bundle 结构和验证模型
- `bundle_hash` 和 `merkle_root` 概念

<a id="normative-references"></a>

## 规范性参考

- [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md) — 第 2 节（算法注册表）、第 4 节（域分离）、第 5 节（复合签名）、第 7 节（验证模式）、第 10.3 节（双哈希）、第 13.2 节（公告系统）
- [NIST 符合性](../../../../../docs/NIST_CONFORMITY.md) — 对 NIST 后量子密码的符合性
- [安全模型](../../../../../docs/SECURITY_MODEL.md) — 威胁模型和保护层

<a id="implementation-notes-informative"></a>

## 实现说明（参考性）

> **2026 年 10 月 25 日添加。非规范性。** 这些说明不增加任何要求，也不改变上文任何内容：它们描述 `main` 上的参考代码
> 与本文的关系。两者不一致时，以上文的规范性文本为准。

- 复合绑定只在验证器要求时才使剥离可被发现。起作用的是验证器解析出的
  有效模式，在应用风险等级、安全等级和策略之后，它可能比请求的 `default_mode` 更严格。
  在 SDK 验证器中，删除 PQ 签名并把绑定重新标注为 `classical_only` 时，若有效模式为 `classical_only` 或
  `hybrid_preferred` 则会被接受（在 `hybrid_preferred` 下附带警告），若为 `hybrid_required` 或 `pq_only` 则被拒绝。
  只有明确缺失的 PQ 签名才可能被容忍：在 `pq_over_classical` 下存在但
  无效的 PQ 签名在任何模式下都会被拒绝，其他所有检查也照常适用。
- SDK 验证器中的 `pq_only` 仍然要求带有经典签名字节的 `pq_over_classical` 绑定，
  因为 PQ 签名覆盖了这些字节；它不接受只带 PQ 签名的 bundle。
- 公告系统不是自动的：只有当运营方加载公告并调用
  公告辅助函数或相应地设置策略时，验证器才会应用它。
- SDK 验证器检查 SHA-256 审计链和 Merkle 根；自 `@dcp-ai/sdk` 2.2.1、`@dcp-ai/wasm` 2.1.1、`dcp-ai` 2.10.1（PyPI）、Go v2.11.1 和 Rust `dcp-ai` 2.11.1 起，它们也检查存在的二级 SHA3-256 字段（[VERIFICATION.md](../../../../../spec/VERIFICATION.md) 的 V2-11 及其勘误），更早的版本则不检查。
