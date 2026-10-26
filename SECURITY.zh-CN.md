<sub>[English](SECURITY.md) · **中文** · [Español](SECURITY.es.md) · [日本語](SECURITY.ja.md) · [Português](SECURITY.pt-BR.md)</sub>

<a id="security-policy"></a>

# 安全策略

**Go 发布 (26/10/2026).** Go SDK `v2.11.0` 已通过模块标签 `sdks/go/v2.11.0` 发布，包含验证器修复、准入和实验性显式启用 API。Rust 仍独立发布。见 [Go v2.11.0](docs/GO_RELEASE.md).

> 本文是[英文版](SECURITY.md)的参考译文，更新于 26/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

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

<a id="out-of-scope"></a>

### 范围外

- 没有司法辖区证明的自我声明身份（这是设计如此；参见 [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md)）
- 运行被修改过的验证代码的运营方（每个运营方对自己的部署负责）
- 拒绝服务（属于基础设施问题，而非协议层面）
- 针对持有密钥人员的社会工程攻击

<a id="supported-versions"></a>

## 支持的版本

各软件包不共用一个版本号；npm 上的 `@dcp-ai/*` 软件包各有自己的版本线。

| 版本 | 是否支持 |
|---------|-----------|
| 2.11.x (`github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2`) | 是 |
| 2.10.x（PyPI / crates.io 上的 `dcp-ai`、Go 模块 `sdks/go/v2`） | 是 |
| 2.9.x（PyPI 和 crates.io 上的 `dcp-ai`、Go 模块 `sdks/go/v2`） | 是 |
| 2.8.x（PyPI 和 crates.io 上的 `dcp-ai`、Go 模块 `sdks/go/v2`） | 是 |
| 2.2.x（`@dcp-ai/sdk`） | 是 |
| 2.1.x（`@dcp-ai/sdk`） | 否：`verifySignedBundleV2` 可被绕过；修复在 2.2.x 中（见下方说明） |
| 2.1.x（`@dcp-ai/wasm`、`@dcp-ai/openclaw`, `@dcp-ai/cli`, `@dcp-ai/express`, `@dcp-ai/anthropic-mcp`, `@dcp-ai/google-a2a`） | 是 |
| 2.0.x（`@dcp-ai/wasm`、`@dcp-ai/cli` 以及其他 npm `@dcp-ai/*` 软件包） | 是 |
| 1.0.x   | 是（仅维护） |
| < 1.0   | 否        |

`@dcp-ai/sdk` 2.2.0 已于 2026 年 10 月 26 日发布到 npm，并标记为 `latest`。它包含验证器修复；请使用 `npm install @dcp-ai/sdk@^2.2.0` 升级并更新 lockfile。受影响的旧版本不会自动获得修复。见[已发布的 npm 软件包清单](docs/NPM_RELEASES.md)。

**受影响及已修复的集成版本（2026 年 10 月 26 日）。** `@dcp-ai/express` 2.0.0 和 `@dcp-ai/openclaw` 2.0.0 会在不验证签名的情况下接受结构有效的 V2 bundle。两者均已在 npm 版本 2.1.0 中修复，并使用 `@dcp-ai/sdk` `^2.2.0`。请勿使用 2.0.0 验证 V2 bundle。`dcp-ai` 2.9.0 的 FastAPI 集成仍受影响；修复后的实现已在 PyPI 2.10.0 发布。见 [Python 升级说明](docs/PYTHON_RELEASE.md)。见 [Express](integrations/express/README.md)、[OpenClaw](integrations/openclaw/README.md) 和 [FastAPI](integrations/fastapi/README.md)。软件包受支持不代表其所有旧构建都包含修复。

<a id="disclosure-policy"></a>

## 披露政策

- 我们遵循协调披露：修复在私下开发，并在公开披露之前发布。
- 报告者将在安全公告中获得致谢（除非其希望匿名）。
- 对于遵守本政策的研究人员，我们不会采取法律行动。

<a id="bug-bounty"></a>

## 漏洞赏金

DCP-AI 运营一个针对安全漏洞的赏金计划：

| 严重程度 | 奖励 |
|----------|--------|
| 严重（PQ 密码学被攻破、签名被绕过） | $5,000 - $15,000 |
| 高（验证被绕过、密钥泄露） | $1,000 - $5,000 |
| 中（等级降级、篡改链） | $500 - $1,000 |
| 低（信息泄露、DoS） | $100 - $500 |

> **说明（2026 年 10 月 25 日）：各文档的表述不一致。** 本表给出固定的奖励区间，而 [GOVERNANCE.md](GOVERNANCE.md) 和 [docs/EARLY_ADOPTERS.md](docs/EARLY_ADOPTERS.md) 说奖励逐案决定，没有固定档位。在维护者确认以哪个为准之前，各处文字保持原样；在此之前，请将任何奖励视为未确认，并向维护者询问。

计划的完整详情见 [docs/EARLY_ADOPTERS.md](docs/EARLY_ADOPTERS.md)。

<a id="security-model"></a>

## 安全模型

关于协议的安全架构、攻击向量和防护层的详细分析，参见 [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) 和 [docs/NIST_CONFORMITY.md](docs/NIST_CONFORMITY.md)。

<a id="protocol-integrity"></a>

## 协议完整性

将本地的 V1 模式文件与本地的指纹清单进行比较：

```bash
dcp integrity
```

这会将 V1 模式的字节与 `protocol_fingerprints.json` 进行比较。它不检查 V2 模式、实现行为或一致性，而且本地清单并不是经过认证的信任锚。详情参见 [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md#protocol-fingerprints)。
