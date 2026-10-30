<sub>[English](../../GOVERNANCE.md) · **中文** · [Español](../es/GOVERNANCE.md) · [日本語](../ja/GOVERNANCE.md) · [Português](../pt-BR/GOVERNANCE.md)</sub>

<a id="dcp-ai-governance"></a>

# DCP-AI 治理

> 本文是[英文版](../../GOVERNANCE.md)的参考译文，更新于 25/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

本文档描述 DCP-AI（Digital Citizenship Protocol for AI Agents）项目的治理模式。

<a id="governance-model"></a>

## 治理模式

DCP-AI 采用**开放治理**模式。项目公开开发，欢迎任何人贡献。重大决定由维护者在参考社区意见的基础上协商一致作出。

**当前状态（2026 年 4 月）：** 项目处于起步阶段，只有一位创始维护者。下文描述的角色、决策流程和投票规则规定了项目在增加更多维护者后如何运作。在项目只有一位维护者期间，“维护者之间的共识”即指该维护者的决定；本文档按其构造同样适用于这种情况。

<a id="roles"></a>

## 角色

<a id="contributors"></a>

### 贡献者

任何提交拉取请求、提出 issue、参与讨论或以其他方式为项目作出贡献的人。贡献者应遵守[贡献指南](../../CONTRIBUTING.md)。

<a id="reviewers"></a>

### 审阅者

已表现出持续、高质量贡献并对协议有扎实理解的受信任贡献者。审阅者可以：

- 批准拉取请求
- 对 issue 进行分类和加标签
- 以更高的权重参与设计讨论

审阅者由维护者提名，并经共识确认。

<a id="maintainers"></a>

### 维护者

维护者拥有仓库的完整写权限，并对项目的总体方向负责。维护者可以：

- 合并拉取请求
- 创建版本
- 管理 CI/CD 和基础设施
- 提名和批准新的审阅者和维护者
- 在无法达成共识时作出最终决定

新维护者须经现有维护者一致同意方可加入。

<a id="decision-making-process"></a>

## 决策流程

1. **提案**：重大变更（新的协议版本、破坏性变更、新的 SDK、治理变更）应在实施之前以 GitHub issue 或讨论的形式提出。

2. **讨论**：鼓励所有相关方提供反馈。重大提案至少应留出 7 天的讨论时间。

3. **共识**：决定由维护者之间协商一致作出。共识是指讨论之后没有任何维护者坚持反对。

4. **投票**：如果无法达成共识，则由维护者以简单多数投票决定结果。每位维护者有一票。投票必须至少开放 72 小时。

5. **记录**：所有重大决定都记录在相关的 issue、PR 或讨论帖中。

<a id="protocol-changes"></a>

## 协议变更

对规范性协议规范（`spec/`）的变更要求更高：

- 一份书面提案，说明变更内容、动机及向后兼容性影响
- 至少两位维护者的审阅
- 破坏性变更至少需要 14 天的讨论期
- 更新验证新行为的一致性测试
- 更新 `schemas/v1/` 或 `schemas/v2/` 中的 schema（或新的版本目录）

<a id="release-process"></a>

## 发布流程

1. **版本管理**：项目遵循 [Semantic Versioning](https://semver.org/)。协议版本（例如 DCP v1.0）独立于实现版本。

2. **发布节奏**：按需发布，没有固定的时间表。

3. **发布步骤**：
   - `main` 上的所有 CI 检查都必须通过
   - 维护者创建发布分支（如适用）或从 `main` 打标签
   - 用所有值得注意的变更更新 `CHANGELOG.md`
   - 在 GitHub 上发布版本说明
   - 将 SDK 软件包发布到各自的注册表（npm、PyPI、crates.io）。Go SDK 不发布到中央注册表：Go 模块通过 `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` 上的标签被发现，pkg.go.dev 会从那里自动建立索引。
   - 发布通过 `publish.yml`、`publish-pypi.yml`、`publish-integrations.yml`、`publish-templates.yml` 和 `publish-docker.yml` 工作流自动完成，由 GitHub Release 触发或手动运行。软件包工作流会检查注册表中是否已有该版本；Docker 工作流构建并推送镜像时不做这种版本存在检查。`publish-docker.yml` 还会在每次推送到 `main` 且涉及 `server/`、`services/`、`lib/`、`tools/`、`schemas/`、`docker/Dockerfile` 或该工作流本身时运行，并推送 `:latest`、`:main` 和 `:sha-…` 镜像标签。
   - 如适用，会创建或关联一个 Zenodo 软件 DOI，使该版本可在学术工作中被引用（见 [CITATION.cff](../../CITATION.cff)）。

4. **紧急修复**：关键的安全或正确性修复可由维护者酌情跳过正常的讨论期。

<a id="security-disclosure-policy"></a>

## 安全披露政策

如果你在 DCP-AI 中发现安全漏洞：

1. **不要**公开提出 issue。
2. 通过以下方式之一私下报告：
   - 电子邮件：**security@dcp-ai.org**
   - GitHub 私密漏洞报告：[security/advisories/new](https://github.com/dcp-ai-protocol/dcp-ai/security/advisories/new)
3. 请包括漏洞描述、复现步骤、受影响的组件（协议、特定 SDK、某个服务或智能合约）以及潜在影响评估。
4. 维护者会在 48 小时内确认收到，并告知预计的修复时间。
5. 修复发布后会公布安全公告。

完整细节见 [SECURITY.md](../../SECURITY.md)，包括范围、SLA 和严重程度处理。金钱奖励逐案处理，而不是按固定的赏金档位。

> **说明（2026 年 10 月 25 日）：各文档的表述不一致。** [SECURITY.md](../../SECURITY.md) 按严重程度列出固定的奖励区间，而本文档和 [docs/EARLY_ADOPTERS.md](../../docs/EARLY_ADOPTERS.md) 说奖励逐案决定。在维护者确认以哪个为准之前，两处文字都保留。

<a id="amendments"></a>

## 修订

本治理文档可由维护者之间协商一致进行修订，并遵循标准决策流程，讨论期至少 14 天。
