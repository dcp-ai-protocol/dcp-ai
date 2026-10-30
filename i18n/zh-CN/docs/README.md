<sub>[English](../../../docs/README.md) · **中文** · [Español](../../es/docs/README.md) · [日本語](../../ja/docs/README.md) · [Português](../../pt-BR/docs/README.md)</sub>

<a id="documentation"></a>

# 文档

> 本文是[英文版](../../../docs/README.md)的参考译文，更新于 28/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

本索引按任务整理 DCP-AI 文档：入门、架构与安全、测试、参考、运维、规范和提案。各注册表中软件包的当前版本见
[已发布版本](#published-versions)。

<a id="published-versions"></a>

## 已发布版本

于 28/10/2026 核实。软件包版本独立于 DCP 传输格式和规范的版本（2.0）。

| 注册表 | 软件包 | 版本 | 发布说明 |
|---|---|---|---|
| npm | [`@dcp-ai/sdk`](https://www.npmjs.com/package/@dcp-ai/sdk) (TypeScript SDK) | 2.2.1 | [npm 软件包](../../../docs/NPM_RELEASES.md) |
| npm | [`@dcp-ai/wasm`](https://www.npmjs.com/package/@dcp-ai/wasm) | 2.1.1 | [npm 软件包](../../../docs/NPM_RELEASES.md) |
| npm | [`@dcp-ai/cli`](https://www.npmjs.com/package/@dcp-ai/cli) | 2.1.1 | [npm 软件包](../../../docs/NPM_RELEASES.md) |
| PyPI | [`dcp-ai`](https://pypi.org/project/dcp-ai/2.10.1/) (Python SDK) | 2.10.1 | [Python 发布](../../../docs/PYTHON_RELEASE.md) |
| Go modules | `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` | v2.11.1 | [Go 发布](../../../docs/GO_RELEASE.md) |
| crates.io | [`dcp-ai`](https://crates.io/crates/dcp-ai/2.11.1) (Rust SDK) | 2.11.1 | [Rust 发布](../../../docs/RUST_RELEASE.md) |

- 这些版本会在 V2-11 的可选二级 SHA3-256 字段存在时验证它们；不存在的字段不作要求，因此已验证的 bundle 可能没有完整的二级链，存在但不一致的字段会被拒绝。更早的版本不检查这些字段。 已发布的适配器 `@dcp-ai/express`、`@dcp-ai/openclaw`、`@dcp-ai/anthropic-mcp` 和 `@dcp-ai/google-a2a` 2.1.0 没有重新发布：它们依赖 `@dcp-ai/sdk` `^2.2.0`，当你的锁定文件解析到 `@dcp-ai/sdk` 2.2.1 或更高版本时即获得二级检查。
- npm 适配器和项目脚手架是可选的，独立于协议核心；它们的确切版本见列出全部 13 个 npm 软件包的
  [NPM_RELEASES.md](../../../docs/NPM_RELEASES.md)。
- 受影响的早期版本和升级说明见 [SECURITY.md](../../../SECURITY.md#supported-versions)；从 DCP v1.0 迁移见
  [MIGRATION_V1_V2.md](../../../docs/MIGRATION_V1_V2.md)。
- 在所有 SDK 中，`dcp-jcs-v1` 仍是规范性的默认规范化方式；`dcp-jcs-v2` 的 API 属于实验性、需选择启用。验证不建立
  对主体的信任，也不构成准入或授权。
- 本清单覆盖上述四个注册表；不覆盖容器镜像。

<a id="quick-start"></a>

## 快速开始

- [QUICKSTART.md](../../../docs/QUICKSTART.md) — 用 SDK 生成并验证证据（已发布的软件包或仓库检出副本）；演示另行标注
- [QUICKSTART_EXPRESS.md](../../../docs/QUICKSTART_EXPRESS.md) — Express 中间件集成
- [QUICKSTART_LANGCHAIN.md](../../../docs/QUICKSTART_LANGCHAIN.md) — 包装 LangChain 工具
- [QUICKSTART_OPENAI.md](../../../docs/QUICKSTART_OPENAI.md) — OpenAI 函数调用（Node SDK、Chat Completions；Python 客户端包装器）
- [QUICKSTART_CREWAI.md](../../../docs/QUICKSTART_CREWAI.md) — CrewAI 多智能体团队
- [QUICKSTART_AGNO.md](../../../docs/QUICKSTART_AGNO.md) — 使用 `agno-dcp` 的 Agno 智能体、团队和工作流

<a id="architecture--security"></a>
<a id="architecture-security"></a>

## 架构与安全

- [TECHNICAL_ARCHITECTURE.md](../../../docs/TECHNICAL_ARCHITECTURE.md) — 系统架构和部署蓝图
- [SECURITY_MODEL.md](../../../docs/SECURITY_MODEL.md) — 威胁模型、攻击向量、防护层
- [STORAGE_AND_ANCHORING.md](../../../docs/STORAGE_AND_ANCHORING.md) — P2P 存储和可选的区块链锚定
- [ARCHITECTURE.md](../../../docs/ARCHITECTURE.md) — 面向贡献者的仓库地图
- [OBSERVABILITY.md](../../../docs/OBSERVABILITY.md) — 来自各 SDK 的 OpenTelemetry 追踪和指标

<a id="testing--assurance"></a>
<a id="testing-assurance"></a>

## 测试与保证

- [tools/interop-matrix](../../../tools/interop-matrix/README.md) — 四个 SDK 上的真实智能体相互签署并验证彼此的 bundle，包括原样的和在传输中被篡改的
- [tools/difffuzz](../../../tools/difffuzz/README.md) — 对四个 V2 验证器进行差分模糊测试
- [tests/interop/v2](../../../tests/interop/v2/) — 每个 SDK 都必须接受或拒绝的共享向量
- [tests/interop/candidate/phase4](../../../tests/interop/candidate/phase4/README.md) — 实验性 `dcp-jcs-v2` 生成方的交叉矩阵（五个 SDK）

<a id="reference"></a>

## 参考

- [API_REFERENCE.md](../../../docs/API_REFERENCE.md) — TypeScript SDK 的 API 参考，以 `main` 为准
- [NIST_CONFORMITY.md](../../../docs/NIST_CONFORMITY.md) — NIST FIPS 203/204/205 一致性声明
- [EU_AI_ACT_MAPPING.md](../../../docs/EU_AI_ACT_MAPPING.md) — 欧盟《人工智能法》（法规 (EU) 2024/1689）中日志记录、人工监督和记录保存义务与 DCP 构件的对应
- [MIGRATION_V1_V2.md](../../../docs/MIGRATION_V1_V2.md) — 从 DCP v1.0 迁移到 v2.0

<a id="operations"></a>

## 运营

- [OPERATOR_GUIDE.md](../../../docs/OPERATOR_GUIDE.md) — 运行 DCP 验证服务
- [ADMISSION.md](../../../docs/ADMISSION.md) — 只接受来自受信任委托人的 bundle，以及 strict-v1 配置
- [AGENT_CREATION_AND_CERTIFICATION.md](../../../docs/AGENT_CREATION_AND_CERTIFICATION.md) — 智能体的创建和认证流程

<a id="specifications"></a>

## 规范

- [spec/DCP-01.md](../../../spec/DCP-01.md) — 身份与责任委托人绑定
- [spec/DCP-02.md](../../../spec/DCP-02.md) — 意图声明与策略管控
- [spec/DCP-03.md](../../../spec/DCP-03.md) — 审计链与透明度
- [spec/DCP-04.md](../../../spec/DCP-04.md) — 智能体间通信
- [spec/DCP-05.md](../../../spec/DCP-05.md) — 智能体生命周期管理
- [spec/DCP-06.md](../../../spec/DCP-06.md) — 数字继承与传承
- [spec/DCP-07.md](../../../spec/DCP-07.md) — 冲突解决与争议仲裁
- [spec/DCP-08.md](../../../spec/DCP-08.md) — 权利与义务框架
- [spec/DCP-09.md](../../../spec/DCP-09.md) — 个人代理与委托
- [spec/profiles](../../../spec/profiles/README.md) — 可选配置：密码学、A2A、治理和准入

<a id="proposals-experimental-not-normative"></a>

## 提案（实验性，非规范）

- [proposals/canonicalization-candidate](../../../docs/proposals/canonicalization-candidate/README.md) — 未启用的候选方案 `dcp-jcs-v2` 及其 SDK 显式启用 API；`dcp-jcs-v1` 仍是唯一的规范化配置

<a id="community--vision"></a>
<a id="community-vision"></a>

## 社区与愿景

- [EARLY_ADOPTERS.md](../../../docs/EARLY_ADOPTERS.md) — 早期采用者计划、权益和要求
- [GENESIS_PAPER.md](../../../docs/GENESIS_PAPER.md) — 创始白皮书

---

协议规范见 [spec/](../../../spec/)。贡献指南见 [CONTRIBUTING.md](../../../CONTRIBUTING.md)。
