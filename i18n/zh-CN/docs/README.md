<sub>[English](../../../docs/README.md) · **中文** · [Español](../../es/docs/README.md) · [日本語](../../ja/docs/README.md) · [Português](../../pt-BR/docs/README.md)</sub>

<a id="documentation"></a>

# 文档

> 本文是[英文版](../../../docs/README.md)的参考译文，更新于 09/11/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

本索引按任务整理 DCP-AI 文档：入门、架构与安全、测试、参考、运维、规范和提案。各注册表中软件包的当前版本见
[已发布版本](#published-versions)。

<a id="published-versions"></a>

## 已发布版本

于 09/11/2026 核实。软件包版本独立于 DCP 传输格式和规范的版本（2.0）。

| 注册表 | 软件包 | 版本 | 发布说明 |
|---|---|---|---|
| npm | [`@dcp-ai/sdk`](https://www.npmjs.com/package/@dcp-ai/sdk) (TypeScript SDK) | 2.4.0 | [npm 软件包](../../../docs/NPM_RELEASES.md) |
| npm | [`@dcp-ai/wasm`](https://www.npmjs.com/package/@dcp-ai/wasm) | 2.2.0 | [npm 软件包](../../../docs/NPM_RELEASES.md) |
| npm | [`@dcp-ai/cli`](https://www.npmjs.com/package/@dcp-ai/cli) | 2.2.0 | [npm 软件包](../../../docs/NPM_RELEASES.md) |
| PyPI | [`dcp-ai`](https://pypi.org/project/dcp-ai/2.11.0/) (Python SDK) | 2.11.0 | [Python 发布](../../../docs/PYTHON_RELEASE.md) |
| Go modules | `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` | v2.14.0 | [Go 发布](../../../docs/GO_RELEASE.md) |
| crates.io | [`dcp-ai`](https://crates.io/crates/dcp-ai/2.14.0) (Rust SDK) | 2.14.0 | [Rust 发布](../../../docs/RUST_RELEASE.md) |

- 于 09/11/2026 从 `main`（`cdb7099b`）发布：`@dcp-ai/sdk` 2.4.0、`@dcp-ai/wasm` 2.2.0、`@dcp-ai/cli` 2.2.0、
  `dcp-ai` 2.11.0、Go v2.14.0 和 Rust `dcp-ai` 2.14.0。四个 SDK 增加了显式启用的委托准入、从字节准入和委托书确认，
  所有 Ed25519 验证器都应用 P-ED-1：这是接受范围的变化，会拒绝非规范编码和小阶点。它们保留 05/11/2026 的 V2-2 模式
  验证，并且与 28/10/2026 以来的版本一样，在 V2-11 的可选辅助 SHA3-256 字段存在时对其进行验证。参见[变更日志](../../../CHANGELOG.md#2026-11-09-six-releases)和各发布说明。
- `@dcp-ai/cli` 2.2.0 要求 `@dcp-ai/sdk` `^2.4.0`。npm 适配器没有重新发布：它们的 `^2.2.0` 范围（`@dcp-ai/express`、
  `@dcp-ai/openclaw`、`@dcp-ai/anthropic-mcp` 和 `@dcp-ai/google-a2a`）接受 `@dcp-ai/sdk` 2.4.0，只有在安装解析到它时，
  才会获得其检查（包括 P-ED-1）；现有的 lockfile 在你更新之前会保留原来的解析结果。
- 09/11/2026 各归档中的 README 标明其自身版本，并指向此表了解注册表中的可用情况。05/11/2026 及更早版本的说明保留在
  [变更日志](../../../CHANGELOG.md#2026-11-05-auditable-releases)和各发布说明中。
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
- [tools/enterprise-rehearsal](../../../tools/enterprise-rehearsal/README.md) — 可选的企业集成演练：从同一个提交构建的软件包、一个 Express 应用和一个 FastAPI 应用，以及运行前写好的预期结果
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
- [OPERATIONAL_LIMITS.md](../../../docs/OPERATIONAL_LIMITS.md) — 什么在限制输入、来源、并发、断开和缓存，以及运营方需要设置什么
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
