<sub>[English](../../SECURITY.md) · **中文** · [Español](../es/SECURITY.md) · [日本語](../ja/SECURITY.md) · [Português](../pt-BR/SECURITY.md)</sub>

<a id="security-policy"></a>

# 安全策略

> 本文是[英文版](../../SECURITY.md)的参考译文，更新于 09/11/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

<a id="reporting-a-vulnerability"></a>

## 报告漏洞

**请勿通过公开的 GitHub issue 报告安全漏洞。**

如果你在 DCP-AI 协议、SDK、服务或智能合约中发现安全漏洞，请以负责任的方式报告：

- **电子邮件：** security@dcp-ai.org
- **GitHub：** 使用 [Private Vulnerability Reporting](https://github.com/dcp-ai-protocol/dcp-ai/security/advisories/new)

请尽量提供详细信息：
- 漏洞描述
- 复现步骤
- 受影响的组件（协议、SDK、服务、合约）
- 潜在影响评估

<a id="response-timeline"></a>

## 响应时间

| 阶段 | 时限 |
|-------|-----------|
| 确认收到 | 48 小时内 |
| 初步评估 | 7 天内 |
| 修复（严重/高） | 30 天内 |
| 修复（中/低） | 90 天内 |

<a id="scope"></a>

## 范围

<a id="in-scope"></a>

### 范围内

- 密码学缺陷（Ed25519 签名、SHA-256 哈希、Merkle 树）
- 绕过 bundle 验证（签名、bundle_hash、merkle_root、哈希链）
- SDK 漏洞（TypeScript、Python、Go、Rust、WASM）
- 智能合约缺陷（DCPAnchor.sol）
- HTTP 服务漏洞（anchor、transparency-log、revocation）
- 绕过中间件（Express、FastAPI 集成）
- 协议层面的攻击（篡改模式、破坏哈希链）
- 后量子密码学缺陷（ML-DSA-65/87 签名、ML-KEM-768 KEM、SLH-DSA-192f）
- 复合签名绑定漏洞（剥离 pq_over_classical 的攻击）
- 混合 KEM 密钥派生的弱点（X25519 + ML-KEM-768）
- A2A 握手协议漏洞（会话劫持、重放）
- 安全等级降级攻击
- 双哈希链（SHA-256 + SHA3-256）不一致
- PQ 检查点链的完整性
- 绕过域分离标签
- 会话 nonce 重放或拼接
- 不成比例的资源消耗或算法性耗尽：使验证器、SDK 或参考服务所用的 CPU、内存或时间与输入大小不成比例的输入，并以有上限的本地复现展示

<a id="out-of-scope"></a>

### 范围外

- 没有司法辖区证明的自我声明身份（这是设计如此；参见 [docs/SECURITY_MODEL.md](../../docs/SECURITY_MODEL.md)）
- 运行被修改过的验证代码的运营方（每个运营方对自己的部署负责）
- 针对在线基础设施的负载或洪泛测试，或对已部署服务的任何其他破坏性测试：未经授权
- 针对持有密钥人员的社会工程攻击

<a id="supported-versions"></a>

## 支持的版本

我们接收针对任何已发布版本和 `main` 的报告。接收报告并不意味着某个版本包含或将会获得相应修复。修复在 `main` 上完成，只会通过之后的版本到达用户；不承诺任何回移、维护版本或长期支持。各软件包不共用一个版本号；npm 上的 `@dcp-ai/*` 软件包各有自己的版本线。

| 版本 | 状态 |
|---------|--------|
| 最新发布（09/11/2026）：`@dcp-ai/sdk` 2.4.0、`@dcp-ai/wasm` 2.2.0、`@dcp-ai/cli` 2.2.0、`dcp-ai` 2.11.0（PyPI）、Go `v2.14.0`、Rust `dcp-ai` 2.14.0 | 当前版本。包含 26/10/2026 的验证器修复、28/10/2026 的二级 SHA3-256 检查、[审计资料](../../docs/conformance/AUDIT_DOSSIER.md#artifacts)中列出的修复，以及 Ed25519 接受范围变化 P-ED-1（见下方说明） |
| 依赖 SDK 的适配器（`@dcp-ai/express`、`@dcp-ai/openclaw`、`@dcp-ai/anthropic-mcp` 和 `@dcp-ai/google-a2a` 2.1.0） | 当前版本，未重新发布。只有在安装解析到 `@dcp-ai/sdk` 2.4.0 时才会获得 09/11/2026 的检查；保留更早 SDK 的 lockfile 在你更新之前不会获得 |
| 之前的版本（05/11/2026 时的当前版本）：`@dcp-ai/sdk` 2.3.0、`@dcp-ai/wasm` 2.1.3、`dcp-ai` 2.10.2（PyPI）、Go `v2.13.0` 和 Rust `dcp-ai` 2.13.0（05/11/2026 发布），以及 `@dcp-ai/cli` 2.1.1（28/10/2026 发布） | 已被取代：它们不应用 P-ED-1，因此其 TypeScript、Go、Rust、WASM 和 CLI 验证会接受最新版本拒绝的 Ed25519 签名（Python SDK 所用的官方 PyNaCl 构建原本就会拒绝）；请升级 |
| 28/10/2026 发布：`@dcp-ai/sdk` 2.2.1、`@dcp-ai/wasm` 2.1.1、`dcp-ai` 2.10.1（PyPI）、Go `v2.11.1`、Rust `dcp-ai` 2.11.1 | 已被取代：它们不执行 V2-2 模式校验，因此会接受最新版本拒绝的模式无效 bundle；请升级 |
| 包含 26/10/2026 验证器修复的最低发布版本：`@dcp-ai/sdk` 2.2.0、`@dcp-ai/wasm` 和 `@dcp-ai/cli` 2.1.0、`dcp-ai` 2.10.0（PyPI）、Go `v2.11.0`、Rust `dcp-ai` 2.11.0 | 已被取代：不检查最新版本会检查的二级 SHA3-256 字段；请升级 |
| `@dcp-ai/sdk` 2.1.x | 受影响：`verifySignedBundleV2` 可被绕过；已在 2.2.0 修复（见下方说明） |
| `@dcp-ai/express` 和 `@dcp-ai/openclaw` 2.0.0 | 受影响：在不验证签名的情况下接受结构有效的 V2 bundle；不要用它们验证 V2 bundle。已在 2.1.0 修复 |
| `dcp-ai` 2.9.0（PyPI）中的 FastAPI 集成 | 对 V2 受影响；已在 2.10.0 修复 |
| 其他更早的已发布版本 | 未针对这些修复进行评估：不对其声明任何覆盖。接收报告 |
| 其他 npm 适配器和脚手架：`@dcp-ai/anthropic-mcp` 和 `@dcp-ai/google-a2a` 2.1.0；`@dcp-ai/autogen`、`@dcp-ai/w3c-did` 和 `create-*` 脚手架 2.0.1 | 可选，位于协议核心之外；其限制见各自的 README 和 [npm 清单](../../docs/NPM_RELEASES.md) |
| 1.0.x | 较早的版本线：接收报告；没有计划或承诺任何维护版本 |
| < 1.0 | 不支持 |

`@dcp-ai/sdk` 2.2.0 已于 2026 年 10 月 26 日以 `latest` 标签发布到 npm，包含验证器修复。受影响的旧版本不会自动获得修复。

**Ed25519 P-ED-1（09/11/2026）。** `@dcp-ai/sdk` 2.4.0、`@dcp-ai/wasm` 2.2.0、`@dcp-ai/cli` 2.2.0、`dcp-ai` 2.11.0（PyPI）、Go v2.14.0 和 Rust `dcp-ai` 2.14.0 会拒绝公钥或 R 不是规范编码、或是阶整除 8 的点的 Ed25519 签名，以及 S ≥ L 的签名。这改变了被接受的签名范围：请保持验证失败的证据原样；密钥符合 P-ED-1 时用同一密钥重新签名，轮换非规范公钥，替换小阶密钥。请用 `npm install @dcp-ai/sdk@^2.4.0` 或你所用生态系统中的等效命令升级，并刷新 lockfile；当 lockfile 解析到 `@dcp-ai/sdk` 2.4.0 时，2.1.0 版适配器即获得 P-ED-1。Rust 2.14.0 的 `otlp` feature 要求 `anyhow` 1.0.103 和 `tokio` 1.53.3 或更高版本（RUSTSEC-2026-0190、RUSTSEC-2026-0386）；默认和 `wasm` 构建都不选择它们，启用 `otlp` 的 lock 会保留其版本，直到你运行 `cargo update -p anyhow -p tokio`。

**二级 SHA3-256 字段（2026 年 10 月 28 日）。** `@dcp-ai/sdk` 2.2.1、`@dcp-ai/wasm` 2.1.1、`dcp-ai` 2.10.1（PyPI）、Go v2.11.1 和 Rust `dcp-ai` 2.11.1 会在 [V2-11](../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) 的可选二级 SHA3-256 字段存在时验证它们；更早的版本（包括 2.2.0、2.1.0、2.10.0 和 2.11.0）不验证。请使用 `npm install @dcp-ai/sdk@^2.2.1` 或你所用生态的等效方式升级，并更新 lockfile。已发布的适配器 `@dcp-ai/express`、`@dcp-ai/openclaw`、`@dcp-ai/anthropic-mcp` 和 `@dcp-ai/google-a2a` 2.1.0 没有重新发布：它们依赖 `@dcp-ai/sdk` `^2.2.0`，当你的锁定文件解析到 `@dcp-ai/sdk` 2.2.1 或更高版本时即获得二级检查。见[已发布的 npm 软件包清单](../../docs/NPM_RELEASES.md)和[已发布版本](../../docs/README.md#published-versions)。

**受影响及已修复的集成版本（2026 年 10 月 26 日）。** `@dcp-ai/express` 2.0.0 和 `@dcp-ai/openclaw` 2.0.0 会在不验证签名的情况下接受结构有效的 V2 bundle。两者均已在 npm 版本 2.1.0 中修复，并使用 `@dcp-ai/sdk` `^2.2.0`。请勿使用 2.0.0 验证 V2 bundle。`dcp-ai` 2.9.0 的 FastAPI 集成仍受影响；修复后的实现已在 PyPI 2.10.0 发布。见 [Python 升级说明](../../docs/PYTHON_RELEASE.md)。见 [Express](../../integrations/express/README.md)、[OpenClaw](../../integrations/openclaw/README.md) 和 [FastAPI](../../integrations/fastapi/README.md)。软件包受支持不代表其所有旧构建都包含修复。

<a id="disclosure-policy"></a>

## 披露政策

- 我们遵循协调披露：修复在私下开发，并在公开披露之前发布。
- 报告者将在安全公告中获得致谢（除非其希望匿名）。
- 对于遵守本政策的研究人员，我们不会采取法律行动。

<a id="rewards"></a>

## 奖励

没有固定奖励金额的漏洞赏金计划，也不保证任何奖励。维护者可能针对某份报告逐案提供奖励；只有与维护者的明确协议才构成对奖励的承诺。安全公告中的致谢见“披露政策”。

> **说明（05/11/2026）。** 在此日期之前，本节列出了按严重程度划分的固定奖励区间，并明确标注为未确认，因为 [GOVERNANCE.md](../../GOVERNANCE.md) 和 [docs/EARLY_ADOPTERS.md](../../docs/EARLY_ADOPTERS.md) 描述的是逐案决定的奖励。本页现在与这两份文档一样，说明奖励逐案决定。

安全披露与早期采用者计划的关系见 [docs/EARLY_ADOPTERS.md](../../docs/EARLY_ADOPTERS.md#security-disclosure)。

<a id="security-model"></a>

## 安全模型

关于协议的安全架构、攻击向量和防护层的详细分析，参见 [docs/SECURITY_MODEL.md](../../docs/SECURITY_MODEL.md) 和 [docs/NIST_CONFORMITY.md](../../docs/NIST_CONFORMITY.md)。如需独立审查，请从[审计资料](../../docs/conformance/AUDIT_DOSSIER.md)开始：其中给出基准、复现命令、制品和已知限制。

<a id="protocol-integrity"></a>

## 协议完整性

将本地的 V1 模式文件与本地的指纹清单进行比较：

```bash
dcp integrity
```

这会将 V1 模式的字节与 `protocol_fingerprints.json` 进行比较。它不检查 V2 模式、实现行为或一致性，而且本地清单并不是经过认证的信任锚。详情参见 [docs/SECURITY_MODEL.md](../../docs/SECURITY_MODEL.md#protocol-fingerprints)。
