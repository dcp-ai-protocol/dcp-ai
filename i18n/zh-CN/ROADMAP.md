<sub>[English](../../ROADMAP.md) · **中文** · [Español](../es/ROADMAP.md) · [日本語](../ja/ROADMAP.md) · [Português](../pt-BR/ROADMAP.md)</sub>

<a id="dcp-ai-roadmap"></a>

# DCP-AI 路线图

> 本文是[英文版](../../ROADMAP.md)的参考译文，更新于 27/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

本文档描述 DCP-AI 项目的计划演进。路线图按阶段组织，各阶段可以相互重叠，但必须遵循依赖顺序。当前已发布的内容见[已发布版本](../../docs/README.md#published-versions)。

---

<a id="phase-1--stabilize-core-semantics"></a>
<a id="phase-1-stabilize-core-semantics"></a>

## 阶段 1 — 稳定核心语义

**状态：** 已完成

定义并记录协议的最小可互操作面：每个 DCP 实现都必须支持的构件、它们之间的关系以及验证模型。

- ✅ `spec/core/dcp-core.md` 作为核心的编辑性规范发布
- ✅ 划清了核心构件与各配置专属构件的界限
- ✅ 确立 Responsible Principal Record（RPR）为正式术语
- ✅ 验证模型的文档独立于密码算法的选择
- ✅ 在核心规范与 DCP-01 至 DCP-09 以及 DCP-AI v2.0 之间建立交叉引用

<a id="deliverables"></a>

### 交付物

- `spec/core/dcp-core.md` — 核心的编辑性规范
- `spec/core/README.md` — 核心的索引与理由
- `README.md` 介绍 DCP Core / 配置 / 服务的架构

---

<a id="phase-2--separate-profiles"></a>
<a id="phase-2-separate-profiles"></a>

## 阶段 2 — 拆分配置

**状态：** 就 README 而言已完成；配置的规范性文档仍在进行中。

将特定于算法、传输和治理的细节拆分到配置文档中，这些文档扩展核心，但不是基本互操作所必需的。

- **密码学配置** — 算法注册表、混合/PQ 签名、复合绑定、密码敏捷性、验证器策略
- **A2A 配置** — 智能体发现、握手协议、会话管理、传输绑定
- **治理配置** — 风险等级、司法辖区证明、吊销策略、密钥恢复、治理仪式

<a id="deliverables-1"></a>
<a id="deliverables_1"></a>

### 交付物

- `spec/profiles/crypto/README.md`
- `spec/profiles/a2a/README.md`
- `spec/profiles/governance/README.md`
- 各配置专属的规范性文档（将来，在最初的 README 之后）

<a id="principles"></a>

### 原则

- 配置不得（MUST NOT）与核心相矛盾
- 配置可以（MAY）定义额外的构件、字段或验证步骤
- 符合核心的实现在没有任何配置时也是有效的
- 配置独立于核心进行版本管理

---

<a id="phase-3--standards-positioning"></a>
<a id="phase-3-standards-positioning"></a>

## 阶段 3 — 标准化定位

**状态：** 已推迟

向标准组织正式提交（IETF Internet-Draft、W3C 工作组采纳或 DIF 贡献）推迟到协议获得早期采用者的真实采用反馈之后。原因是：标准组织青睐已有生产使用经验的设计，而一份典型草案大约需要 12 个月，在实际集成检验过 v2.0.x 之后再投入这段时间更为值得。

恢复时的候选平台包括：

- **IETF** — 用于传输格式 / 规范化 / 验证策略这一子集
- **W3C** — 用于 Verifiable Credentials 集成层
- **DIF（Decentralized Identity Foundation）** — 用于智能体身份模型

在此期间，项目的规范仍可通过 Zenodo 引用（论文 DOI [`10.5281/zenodo.19040913`](https://doi.org/10.5281/zenodo.19040913)，软件 DOI [`10.5281/zenodo.19656026`](https://doi.org/10.5281/zenodo.19656026)）。

---

<a id="phase-4--align-schemas-and-implementations"></a>
<a id="phase-4-align-schemas-and-implementations"></a>

## 阶段 4 — 统一模式与实现

**状态：** 随着 v2.0.x 的发布已基本完成。

- ✅ 以 RPR 命名的模式在全部五个 SDK（TS、Python、Go、Rust、WASM）中通过验证
- ✅ 跨 SDK 一致性测试在每次 CI 推送时运行（`tests/interop/v2/`）
- ✅ 在 `schemas/` 下发布了 39 个 v2 JSON 模式和 9 个 v1 模式
- 🔄 区分仅核心一致性与完整一致性（今后的改进——当前套件作为单一矩阵运行）
- 🔄 `schemas/profiles/` 下的配置专属 JSON 模式（将来——当前的配置是描述性的 README）

<a id="principles-1"></a>
<a id="principles_1"></a>

### 原则

- RPR 术语是所有构件中的规范命名
- 核心的一致性测试是完整一致性的严格子集

---

<a id="phase-5--adoption-and-operations"></a>
<a id="phase-5-adoption-and-operations"></a>

## 阶段 5 — 采用与运营

**状态：** 进行中

技术栈已经发布，下一阶段是推动采用：

- 按照[早期采用者计划](../../docs/EARLY_ADOPTERS.md)吸引早期采用者
- 收集真实集成的反馈，为后续次要版本提供依据
- 在社区需求合理时，运营四个服务（verification、anchor、transparency-log、revocation）的托管参考部署
- 在创始维护者之外扩大维护者队伍（见 [GOVERNANCE.md](../../GOVERNANCE.md)）
- 发布案例研究和集成模式

<a id="delivered-since-v20-launch"></a>

### v2.0 发布以来的交付

2026-04-22..23 发布的七个次要版本（v2.1.0 至 v2.7.0）弥合了第一次外部对照发现的 SDK 间行为差距。在这些版本之前，DCP-04..09 的行为只存在于 TypeScript SDK 中；之后，所有核心 SDK 都使用相同的协议面。随后 v2.8.0 和 v2.8.1（2026-04-26）使四个 SDK 的规范化逐字节一致，v2.9.0（2026-10-21）使参考验证器能够验证规范性的 V2 bundle，v2.10.0（2026-10-22）使所有 SDK 验证器执行完整的 V2 流程，包括安全等级。

- **v2.1.0** — OpenTelemetry OTLP 导出器，使 TS 与 Python 的遥测对等。
- **v2.2.0** — 将 DCP-05 生命周期和 DCP-06 继承移植到 Python、Rust、Go。
- **v2.3.0** — 将 DCP-07 争议、DCP-08 权利和 DCP-09 委托/感知阈值/镜像移植到 Python、Rust、Go（21 个函数 × 3 个 SDK）。
- **v2.4.0** — Python、Rust、Go 中的生产加固原语（会话 nonce 辅助函数、安全等级引擎、紧急吊销、通过 `PQCheckpointManager` 实现的延迟 PQ 检查点）。
- **v2.5.0** — DCP-04 智能体间通信：在 Python（通过 `cryptography`）和 Go（标准库 `crypto/aes`）中提供完整的 AES-256-GCM 会话层；在 Rust 中提供发现和握手的基础结构。
- **v2.6.0** — 将 Blinded RPR、多方授权和算法公告的辅助函数从 Python 移植到 Rust 和 Go。
- **v2.7.0** — 38 个规范的 `DcpErrorCode` 值和 `detect_wire_format` 辅助函数在四个核心 SDK 中统一，使跨 SDK 的错误处理基于同一个稳定字符串一致。
- **v2.8.0** — 规范化配置 `dcp-jcs-v1`（[`spec/CANONICALIZATION_PROFILE.md`](../../spec/CANONICALIZATION_PROFILE.md)）固定了 RFC 8785 留给实现定义的情形，消除了四个 SDK 在 `1.0`、`1e2` 和 `undefined` 上的分歧；14 个共享的边界情况互操作向量。
- **v2.8.1** — 清单字段 `canonicalization_profile` 在四个 SDK 中接通：构建器输出 `"dcp-jcs-v1"`，验证器将缺失的字段视为 `dcp-jcs-v1`，并拒绝未知值。
- **v2.9.0**（2026-10-21）— 参考验证器、CLI 和服务器通过 `@dcp-ai/sdk` 验证规范性的 V2 bundle；Go 和 TypeScript 的规范化按 `dcp-jcs-v1` 修正；关闭了所有未解决的依赖安全告警（Go 和 Rust 2.9.0、Python 2.8.2、`@dcp-ai/sdk` 2.1.2）。
- **v2.10.0**（2026-10-22）— 四个 SDK 的验证器执行 VERIFICATION.md 的 V2-7/V2-8、安全等级、审计轨迹绑定和密钥有效性；修复了 `@dcp-ai/sdk` 中一个严重的验证绕过问题；Blinded RPR 承诺加了盐；Python 增加了 ML-KEM-768、FIPS 205 和 V2 bundle；各服务增加了运营方认证、注册限制和拒绝服务防护限制。

<a id="in-the-repository-not-released-yet"></a>

<a id="after-v2100"></a>

### v2.10.0 之后

这些变更位于 `v2.10.0` 标签之后的 `main`。截至 2026 年 10 月 26 日，npm 已发布 SDK 2.2.0、WASM 2.1.0 以及更新后的适配器和 CLI；见[已发布清单](../../docs/NPM_RELEASES.md)。其他生态独立发布。[变更日志的 `[Unreleased]` 部分](../../CHANGELOG.md#unreleased)保留开发历史，并不表示这些 npm 功能不可用。

- **准入** — 受信任的委托人和 `strict-v1` 配置（[`docs/ADMISSION.md`](../../docs/ADMISSION.md)、[`spec/profiles/admission`](../../spec/profiles/admission/README.md)），见于四个 SDK、Express、FastAPI 和 OpenClaw 集成、参考验证器、服务器和 CLI。仅有验证仍然不会授予信任；准入也从不授权任何操作。
- **规范化候选方案 `dcp-jcs-v2`** — TypeScript、Python、Go、Rust 和 WASM 中实验性、需显式启用的接入、路由器、字节验证器和生成方，附五乘五的交叉矩阵（[`docs/proposals/canonicalization-candidate`](../../docs/proposals/canonicalization-candidate/README.md)）。它不是规范性的，也未启用：`dcp-jcs-v1` 仍是唯一的配置，将候选方案推进到后续阶段或设为默认需要单独决定。

<a id="out-of-scope-for-phase-5"></a>

### 阶段 5 范围之外

- 由项目自营的参考服务 SaaS（运营方自行托管）
- 获得认证或认可计划（为时过早）

---

<a id="proposal-direction-after-v210"></a>

## 提案：v2.10 之后的方向

**状态：** 供维护者讨论的提案。本节中的任何内容都未排期，也未作承诺；一个条目只有在其自己的 issue 或 pull request 中被接受后，才会成为路线图的一部分。

<a id="positioning"></a>

### 定位

DCP 不与工具访问协议（MCP）、智能体间协议（A2A）、智能体支付协议或 IETF 上关于 AI 智能体身份的草案（撰写时为 2026 年 10 月，就我们所知均为个人提交）竞争。它是位于这些协议之上的问责与证据层。它回答这些协议留下的问题：谁为这个智能体所做的事负责，第三方如何在不信任运营方的情况下核实这一点？

<a id="what-the-v210-round-showed"></a>

### v2.10 这一轮暴露的情况

- 覆盖面大于采用规模：9 份规范、39 个 v2 模式、5 个 SDK、10 个集成和 4 个服务。
- 发现的大多数验证器缺陷是四个 SDK 验证器之间的分歧，而不是单个算法的缺陷：TypeScript 中的验证模式绕过、Go 和 Rust 在后量子位置接受了 Ed25519、Go 跳过了空构件、Rust 把时间戳当作文本比较。
- 运营依赖于一个人（截至 2026 年 10 月）：npm 的发布凭据阻碍了一个安全修复的发布，而创建安全公告需要维护者账户所没有的权限。

<a id="proposed-priorities"></a>

### 建议的优先事项

1. **运营安全（数周）。** 不使用长期令牌发布（在 npm 和 crates.io 上使用 trusted publishing，就像 PyPI 已经做的那样）。把 v2.10 这一轮中的每个漏洞都变成四个 SDK 都必须拒绝的负向向量。差分模糊测试：向各验证器发送相同的字节、策略和验证时刻，用已知结果作对照，并依据规范调查分歧。分歧是调查线索，并不必然是验证器缺陷；测试工具也可能出错。一次外部审计。一名拥有管理员权限的第二维护者。
2. **小核心与独立的合规验证器。** 规范仍然是准则，任何 SDK 的行为都不会成为标准。Rust/WASM 可以作为提供绑定的参考实现，同时独立实现继续按照同样的要求验证证据。使用[安全覆盖图](docs/conformance/SECURITY_COVERAGE.md)区分核心、配置和适配器的能力声明，并使用[实现者指南](docs/conformance/IMPLEMENTER_GUIDE.md)准备外部验证。可能的 Core 3.0 重组仍是需要单独讨论的设计问题：本提案不将现有工件改为实验性状态，不移除 SDK 的验证功能，也不改变兼容性或默认值。
3. **委托链。** 人、智能体、子智能体、工具和支付：每一跳都要签名，且只能收窄权限、不能扩大；整条链可以离线验证，一直追溯到负责的人；子智能体不能降低委托给它的一方的安全等级（意图本来就不能降低自己的等级）。它们将扩展 DCP-09 的委托授权书。任何移入核心的变更都需要单独经过评审的设计和兼容性决策。
4. **集成而非竞争。** 在现有 MCP 集成中为每次工具调用提供一张签名回执；把 DCP 护照放进 A2A 的 Agent Card（`google-a2a` 集成已经能在两者之间转换）；HTTP Message Signatures（RFC 9421）；接受来自 WIMSE/SPIFFE、OAuth 或 DID 的身份，并将其绑定到负责的人。
5. **监管证据。** 按 `docs/NIST_CONFORMITY.md` 的方式，将审计轨迹对应到欧盟《人工智能法》的日志记录、人工监督和记录保存义务（第 12、14 和 26 条）。在引用之前，必须对照现行文本核实这种对应关系和适用日期。

<a id="notes-from-the-agent-side"></a>

### 来自智能体一方的说明

- 日常操作必须保持低成本。如果每次工具调用都要付出一个后量子签名和一个完整 bundle 的代价，就不会有人采用。一个会话的回执可以汇集到一棵 Merkle 树中，在会话关闭时或安全等级提高时用混合方案签名。
- 智能体面临的主要风险不是密钥被盗，而是在持有合法密钥时遭到提示注入。能限制它的是：行动前签名的意图、独立的策略决定、短期且最小权限的授权，以及能显示操作是否偏离了所声明意图的证据。
- 能够证明自己在授权范围内行事，既保护智能体，也保护为它负责的人。

<a id="not-proposed"></a>

### 不提议的内容

- 没有至少两个独立实现者的新规范。
- 由项目运营的中心服务（见“阶段 5 范围之外”）。
- 在两三个集成投入生产之前向 IETF 提交（阶段 3 为等待采用反馈而推迟提交；这里把门槛具体化）。

<a id="open-questions"></a>

### 未决问题

- 鉴于“新增优于删减”这一指导原则，削减为 Core 3.0 是否可以接受？把 DCP-05 至 DCP-09 移为实验性配置是一个不兼容的更改。
- 在保留独立实现和基于规范的合规性验证的同时，哪些组件可以从共享的 Rust/WASM 参考实现中受益？
- 委托链应复用现有的能力格式（UCAN、Biscuit），还是保持 DCP 原生？
- 第二位维护者是谁？管理员权限如何安全地共享？

---

<a id="out-of-scope-general"></a>

## 范围之外（总体）

以下内容仍明确推迟：

- 没有向后兼容别名的模式字段重命名
- 未经清晰的主版本过渡而对已在注册表发布的软件包做不兼容更改
- 由项目自身拥有的集中式运行时基础设施

---

<a id="guiding-principles"></a>

## 指导原则

1. **非破坏性迁移** — 每项更改都必须可逆，且不得破坏现有的导入、测试或脚本
2. **编辑优先** — 文档和概念上的清晰先于代码更改
3. **新增优于删减** — 优先创建新文件和交叉引用，而不是移动或删除现有文件
4. **核心最小化** — 核心应定义最小的有用协议面；其余一切都是配置或服务
5. **注重互操作性** — 核心必须能用任何语言实现，且不依赖特定框架
