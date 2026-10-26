<sub>[English](README.md) · **中文** · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="documentation"></a>

# 文档

**Python 发布 (26/10/2026).** `dcp-ai` 2.10.0 已在 PyPI 发布，包含验证器修复、准入和实验性显式启用 API。Go 和 Rust 仍独立发布。见 [Python 2.10.0](PYTHON_RELEASE.md).

**npm 发布（2026 年 10 月 26 日）。** [NPM_RELEASES.md](NPM_RELEASES.md) 中的 13 个版本已发布，包括 TypeScript/WASM 候选 API 和 TypeScript 准入功能。以下条目保留开发历史；`[Unreleased]` 不表示这些 npm 功能不可用。Python、Go 和 Rust 的发布独立进行。

> 本文是[英文版](README.md)的参考译文，更新于 26/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

<a id="quick-start"></a>

## 快速开始

- [QUICKSTART.md](QUICKSTART.md) — 几分钟内上手（已发布的软件包和仓库检出副本）
- [QUICKSTART_EXPRESS.md](QUICKSTART_EXPRESS.md) — Express 中间件集成
- [QUICKSTART_LANGCHAIN.md](QUICKSTART_LANGCHAIN.md) — 包装 LangChain 工具
- [QUICKSTART_OPENAI.md](QUICKSTART_OPENAI.md) — OpenAI 函数调用（Node SDK、Chat Completions；Python 客户端包装器）
- [QUICKSTART_CREWAI.md](QUICKSTART_CREWAI.md) — CrewAI 多智能体团队
- [QUICKSTART_AGNO.md](QUICKSTART_AGNO.md) — 使用 `agno-dcp` 的 Agno 智能体、团队和工作流

<a id="architecture--security"></a>
<a id="architecture-security"></a>

## 架构与安全

- [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) — 系统架构和部署蓝图
- [SECURITY_MODEL.md](SECURITY_MODEL.md) — 威胁模型、攻击向量、防护层
- [STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md) — P2P 存储和可选的区块链锚定
- [ARCHITECTURE.md](ARCHITECTURE.md) — 面向贡献者的仓库地图
- [OBSERVABILITY.md](OBSERVABILITY.md) — 来自各 SDK 的 OpenTelemetry 追踪和指标

<a id="testing--assurance"></a>
<a id="testing-assurance"></a>

## 测试与保证

- [tools/interop-matrix](../tools/interop-matrix/README.md) — 四个 SDK 上的真实智能体相互签署并验证彼此的 bundle，包括原样的和在传输中被篡改的
- [tools/difffuzz](../tools/difffuzz/README.md) — 对四个 V2 验证器进行差分模糊测试
- [tests/interop/v2](../tests/interop/v2/) — 每个 SDK 都必须接受或拒绝的共享向量
- [tests/interop/candidate/phase4](../tests/interop/candidate/phase4/README.md) — 实验性 `dcp-jcs-v2` 生成方的交叉矩阵（五个 SDK）

<a id="reference"></a>

## 参考

- [API_REFERENCE.md](API_REFERENCE.md) — TypeScript SDK 的 API 参考，以 `main` 为准
- [NIST_CONFORMITY.md](NIST_CONFORMITY.md) — NIST FIPS 203/204/205 一致性声明
- [EU_AI_ACT_MAPPING.md](EU_AI_ACT_MAPPING.md) — 欧盟《人工智能法》（法规 (EU) 2024/1689）中日志记录、人工监督和记录保存义务与 DCP 构件的对应
- [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md) — 从 DCP v1.0 迁移到 v2.0

<a id="operations"></a>

## 运营

- [OPERATOR_GUIDE.md](OPERATOR_GUIDE.md) — 运行 DCP 验证服务
- [ADMISSION.md](ADMISSION.md) — 只接受来自受信任委托人的 bundle，以及 strict-v1 配置
- [AGENT_CREATION_AND_CERTIFICATION.md](AGENT_CREATION_AND_CERTIFICATION.md) — 智能体的创建和认证流程

<a id="specifications"></a>

## 规范

- [spec/DCP-01.md](../spec/DCP-01.md) — 身份与责任委托人绑定
- [spec/DCP-02.md](../spec/DCP-02.md) — 意图声明与策略管控
- [spec/DCP-03.md](../spec/DCP-03.md) — 审计链与透明度
- [spec/DCP-04.md](../spec/DCP-04.md) — 智能体间通信
- [spec/DCP-05.md](../spec/DCP-05.md) — 智能体生命周期管理
- [spec/DCP-06.md](../spec/DCP-06.md) — 数字继承与传承
- [spec/DCP-07.md](../spec/DCP-07.md) — 冲突解决与争议仲裁
- [spec/DCP-08.md](../spec/DCP-08.md) — 权利与义务框架
- [spec/DCP-09.md](../spec/DCP-09.md) — 个人代理与委托
- [spec/profiles](../spec/profiles/README.md) — 可选配置：密码学、A2A、治理和准入

<a id="proposals-experimental-not-normative"></a>

## 提案（实验性，非规范）

- [proposals/canonicalization-candidate](proposals/canonicalization-candidate/README.md) — 未启用的候选方案 `dcp-jcs-v2` 及其 SDK 显式启用 API；`dcp-jcs-v1` 仍是唯一的规范化配置

<a id="community--vision"></a>
<a id="community-vision"></a>

## 社区与愿景

- [EARLY_ADOPTERS.md](EARLY_ADOPTERS.md) — 早期采用者计划、权益和要求
- [GENESIS_PAPER.md](GENESIS_PAPER.md) — 创始白皮书

---

协议规范见 [spec/](../spec/)。贡献指南见 [CONTRIBUTING.md](../CONTRIBUTING.md)。
