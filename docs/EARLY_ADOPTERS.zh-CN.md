<sub>[English](EARLY_ADOPTERS.md) · **中文** · [Español](EARLY_ADOPTERS.es.md) · [日本語](EARLY_ADOPTERS.ja.md) · [Português](EARLY_ADOPTERS.pt-BR.md)</sub>

<a id="dcp-ai-early-adopter-program"></a>

# DCP-AI 早期采用者计划

> 本文是[英文版](EARLY_ADOPTERS.md)的参考译文，更新于 25/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

**状态：** 开放 — 滚动接收
**许可证：** Apache-2.0（参与无需任何费用）

---

<a id="what-it-is"></a>

## 这是什么

DCP-AI 是面向 AI 智能体的可移植问责层：密码学身份、机器可读的意图、可发现篡改的审计轨迹、智能体间通信、生命周期治理以及委托代理。整个技术栈都是开源的，可以从各大主要注册表安装。

早期采用者计划邀请在真实系统中部署 AI 智能体的团队集成 DCP-AI，发现仅靠审阅规范无法找到的边界情况，并直接塑造协议的下一次迭代。

这不是一次 beta 测试。SDK 已经发布并在使用。这是一种共同设计的伙伴关系：你的集成经历将成为下一批版本设计过程的一部分。

---

<a id="who-should-apply"></a>

## 谁应该申请

- 构建智能体框架或编排系统的 **AI 平台团队**
- 在责任、审计或合规至关重要的场景中部署自主智能体的**企业团队**
- 需要可验证智能体身份的**金融、医疗或公共部门团队**
- 研究智能体安全、后量子密码学或可验证凭证的**研究人员**
- 正在推出新型智能体产品、并愿意分享经验的**独立开发者**

---

<a id="what-you-get"></a>

## 你会得到什么

<a id="everything-in-the-public-stack"></a>

### 公开技术栈中的一切

你不需要等待任何“访问权限”。以下内容已经可以使用：

| 构件 | 位置 |
|---|---|
| 9 份协议规范（DCP-01..09） | [docs.dcp-ai.org](https://docs.dcp-ai.org/) |
| 实现同一核心协议的 5 个 SDK（TypeScript、Python、Go、Rust、WASM）；版本和覆盖范围各不相同，参见各 SDK 的 *Release status* | npm / PyPI / crates.io / Go 模块 |
| 11 个框架集成（LangChain、CrewAI、Agno、OpenAI、Express、FastAPI、Anthropic MCP、Google A2A、AutoGen、W3C DID、OpenClaw） | npm + dcp-ai[extras] + agno-dcp（PyPI） |
| 4 个 `npm create @dcp-ai/*` 脚手架 | npm |
| 四个服务的 Docker 镜像 | `ghcr.io/dcp-ai-protocol/dcp-ai/*` |
| 交互式 playground | [docs.dcp-ai.org/playground](https://docs.dcp-ai.org/playground/) |
| 用于可验证凭证的 JSON-LD `@context` | [dcp-ai.org/credentials/v2](https://dcp-ai.org/credentials/v2) |

<a id="what-early-adopters-get-on-top"></a>

### 早期采用者额外获得的内容

- 通过 GitHub Issues/Discussions **与维护者的直接沟通渠道**：2 个工作日内回复，阻塞性问题获得最高优先级分诊。
- 对后续版本路线图的**共同设计意见**：采用哪些安全等级、哪些算法、哪些线上格式决策。
- **一致性验证**：帮助你构建覆盖你的具体集成路径的测试套件；结果会反馈到公开的一致性测试套件中。
- **案例研究合作**（可选）：发表一篇关于你的集成的文章——架构决策、挑战、成果——每一段都需经你批准。
- **治理路径**：活跃的贡献者会按照 [GOVERNANCE.md](../GOVERNANCE.md) 受邀成为 Reviewer 或 Maintainer。

---

<a id="what-we-ask"></a>

## 我们的要求

<a id="integration"></a>

### 集成

1. 在启动后 90 天内，把 DCP-AI SDK 集成到至少一条预发布或生产路径中。
2. 端到端实现核心流程：身份绑定 → 意图声明 → 策略决定 → 审计条目 → bundle 验证。
3. 在 v2.0 中使用混合复合签名（Ed25519 + ML-DSA-65）。SDK 会替你完成；无需手写实现。
4. 针对你的集成运行一致性测试套件，并分享结果。

<a id="feedback"></a>

### 反馈

1. 每月一份结构化反馈——GitHub Discussion、电子邮件或简短的通话，哪种方便用哪种。
2. 把缺陷和边界情况提交为 GitHub issue。对于涉及安全的发现，请使用 GitHub 的私密漏洞报告。
3. 至少参与一个正在权衡设计决策的公开讨论帖。

<a id="testing"></a>

### 测试

1. 对你所依赖的密码学原语运行 NIST KAT 验证（Ed25519、ML-DSA-65；如适用，还有 ML-KEM-768 和 SLH-DSA-192f）。
2. 如果在同一系统中使用多个 SDK，请运行跨 SDK 互操作向量（`tests/interop/v2/`）。
3. 如果你的流水线中有 v1.0 bundle，请验证向后兼容性。
4. 尝试攻破它：篡改 bundle、剥离签名、拼接会话、重放。如果你攻破了，我们希望知道。

---

<a id="timeline"></a>

## 时间表

本计划采用滚动接收。你的计时从你接受邀请时开始。

| 阶段 | 典型时长 | 发生什么 |
|---|---|---|
| 入门 | 第 1 周 | 启动会议或讨论帖。针对你的技术栈讲解协议。起草集成计划。 |
| 集成 | 第 2-8 周 | 构建核心流程。第一次一致性测试运行。出现第一个阻塞问题。在维护者协助下解除阻塞。 |
| 加固 | 第 9-12 周 | 调整安全等级。覆盖 NIST KAT。如适用，进行跨 SDK 互操作。生产就绪评审。 |
| 结业 | 第 13 周及以后 | 你成为生态系统的正式参与者。如果你选择了案例研究，则起草案例研究。治理路径开放。 |

没有正式的“结束日期”。只要你在持续发布、反馈循环保持活跃，你就一直留在计划中。

---

<a id="how-to-apply"></a>

## 如何申请

<a id="process"></a>

### 流程

1. 在 [`dcp-ai-protocol/dcp-ai`](https://github.com/dcp-ai-protocol/dcp-ai/discussions) 上使用 **Early Adopter Application** 模板发起一个 GitHub Discussion（如果你那边没有启用讨论区，也可以开一个带 `early-adopter` 标签的 issue）。
2. 或者，给维护者发电子邮件（当前维护者的联系方式参见 [GOVERNANCE.md](../GOVERNANCE.md)）。

<a id="what-to-include"></a>

### 需要包含的内容

- 组织或团队名称，以及简短介绍
- 用例：你部署或计划部署什么样的智能体？
- 技术栈：语言、框架、基础设施
- 哪些 DCP 组件与你最相关（DCP-01 身份？DCP-03 审计？DCP-07 仲裁？全部？）
- 时间安排：你什么时候可以开始？
- 团队规模：有多少工程师会参与集成？

<a id="review"></a>

### 评审

申请以滚动方式评审，通常在 7 个工作日内完成。我们追求用例的多样组合——企业合规、研究、独立开发者——而不是按规模挑选。

---

<a id="selection-criteria"></a>

## 选择标准

- **用例的多样性**——我们积极寻找不寻常的应用，而不仅仅是预期中的企业路径。
- **真实的部署意图**——优先考虑要部署到真实系统的团队，而不只是做评估的团队。
- **参与度**——愿意分享你的发现，无论正面还是负面。
- **技术能力**——团队在密码学协议、智能体系统或与安全相关的基础设施方面有经验。

---

<a id="support-channels"></a>

## 支持渠道

| 渠道 | 用途 | 访问方式 |
|---|---|---|
| GitHub Issues | 缺陷、功能请求、一致性问题 | 公开 |
| GitHub Discussions | 设计问题、早期采用者讨论帖、集成模式 | 公开 |
| 私密漏洞报告 | 涉及安全的发现 | GitHub 私密报告 |
| 电子邮件 | 受 NDA 约束的工作、合同讨论 | 按 [GOVERNANCE.md](../GOVERNANCE.md) |

目前没有专门的 Slack、Discord 或答疑时间。本计划以精简的方式运营，让维护者的时间真正用于解决你的问题。如果需求增长到足以开设社区渠道，我们会新增并在此公布。

---

<a id="security-disclosure"></a>

## 安全披露

DCP-AI 的安全问题通过 GitHub 的私密漏洞报告进行负责任的披露。对于高影响的发现，可能会逐案提供漏洞赏金；赏金按每份报告的严重程度和可复现性决定，而不是预先承诺的档位。希望公开致谢的研究人员会在发布说明中得到致谢。

> **说明（2026 年 10 月 25 日）：各文档的表述不一致。** [SECURITY.md](../SECURITY.md) 按严重程度列出固定的奖励区间，而本页和 [GOVERNANCE.md](../GOVERNANCE.md) 说奖励逐份报告决定。在维护者确认以哪个为准之前，两处文字都保持原样。

威胁模型和报告指引参见 [SECURITY_MODEL.md](SECURITY_MODEL.md)。

---

<a id="success-stories"></a>

## 成功案例

*随着早期采用者发布他们的集成，本节将逐步充实。*

<a id="your-organization-here"></a>

### [你的组织在此]

如果你集成了 DCP-AI 并愿意分享经历——架构决策、意外之处、成果——我们希望展示它。请联系维护者开启一个案例研究讨论帖。

---

<a id="faq"></a>

## 常见问题

**问：DCP-AI 可以用于生产了吗？**
答：v2.0 规范已经完成，5 个 SDK 已经发布并在使用。DCP-04 至 DCP-09 的文件头中标注为“Published — v2.0 (extension; revisions tracked via adopter feedback)”；线上格式稳定且经过测试，小版本修订将由采用者的反馈驱动，而不是由破坏性变更驱动。它是否适合你的部署，取决于你使用的部分：

- SDK 验证器是生产路径；参考服务把状态保存在内存中，参考网关的 DCP-05–09 端点没有认证（[OPERATOR_GUIDE.md](OPERATOR_GUIDE.md)）；
- 仓库中没有 HSM 集成，`@dcp-ai/cli init` 向导只是演示（[SECURITY_MODEL.md](SECURITY_MODEL.md)，“Known Limitations and Mitigations”）。

2026 年 2 月 26 日的 v2.0 最终安全审计（[spec/AUDIT-v2.0-FINAL.md](../spec/AUDIT-v2.0-FINAL.md)）是一份带日期的记录：之后的审查发现了它没有报告的限制，例如其 HSM 缺口只是用一个模拟的提供者填补的。

**问：参加早期采用者计划需要费用吗？**
答：不需要。本计划免费。整个项目采用 Apache-2.0 许可证。

**问：我必须使用后量子功能吗？**
答：取决于验证者。V2 bundle 可以只带经典签名；在 `hybrid_required` 模式下，验证者要求混合复合签名（Ed25519 + ML-DSA-65），该模式适用于 elevated 和 maximum 等级的操作，也是参考服务器的默认模式。使用混合密钥，SDK 会替你完成两种签名；你无需手写密码学代码。

**问：我可以以个人开发者的身份参加吗？**
答：可以。欢迎个人开发者和小团队，他们往往能发现最有意思的边界情况。

**问：计划结束后会怎样？**
答：你继续使用 DCP-AI。活跃的贡献者会按照 [GOVERNANCE.md](../GOVERNANCE.md) 受邀成为 Reviewer 或 Maintainer。

**问：我可以自己托管运行这些服务吗？**
答：可以——这正是预期的模式。验证服务器、锚定、透明度日志和吊销注册表都以 Docker 镜像形式发布在 GHCR 上，Fly.io 配置已在 [`deploy/`](../deploy/) 中备好。没有第一方 SaaS；每个运营方都自己运行。它们是参考服务：在对外暴露之前，请加入持久存储，限制网关上未经认证的 DCP-05–09 端点，并阅读 [OPERATOR_GUIDE.md](OPERATOR_GUIDE.md)。

**问：如何在论文中引用 DCP-AI？**
答：论文和软件的 DOI 参见 [CITATION.cff](../CITATION.cff)。

---

*DCP-AI 早期采用者计划是一份公开的邀请，邀请大家共同构建自主 AI 系统所需的问责基础设施。*
