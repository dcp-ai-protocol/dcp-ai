<sub>[English](ARCHITECTURE.md) · **中文** · [Español](ARCHITECTURE.es.md) · [日本語](ARCHITECTURE.ja.md) · [Português](ARCHITECTURE.pt-BR.md)</sub>

<a id="architecture-map"></a>

# 架构地图

> 本文是[英文版](ARCHITECTURE.md)的参考译文，更新于 25/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

本文档是为新贡献者准备的 2 分钟入门。它说明**每个部分位于何处以及原因**，足以让你在不靠猜测的情况下把 PR 或缺陷报告分派到正确的位置。

协议的规范性规范参见 [`spec/`](../spec/README.md)。如何运行测试和构建，参见 [`CONTRIBUTING.md`](../CONTRIBUTING.md)。

<a id="mental-model"></a>

## 心智模型

DCP-AI 是面向 AI 智能体的**可移植问责层**。仓库的各层，从最具规范性到最偏运营：

```
┌───────────────────────────────────────────────────────────────────┐
│  spec/ + schemas/           ← source of truth (what IS DCP)        │
│  ─────────────────────                                             │
│  tests/                     ← conformance + interop + NIST KAT     │
│  ─────────────────────                                             │
│  sdks/{ts,py,rust,go,wasm}  ← reference implementations            │
│  ─────────────────────                                             │
│  integrations/              ← bindings for popular frameworks      │
│  cli/                       ← interactive CLI (@dcp-ai/cli)        │
│  packages/create-*          ← npm create scaffolders               │
│  ─────────────────────                                             │
│  services/                  ← operational infra (anchor, log, …)   │
│  contracts/                 ← on-chain artifacts (DCPAnchor.sol)   │
│  ─────────────────────                                             │
│  docs/ + docs-site/ + site/ ← hand-written docs + generated site   │
│  playground/                ← in-browser interactive demo          │
└───────────────────────────────────────────────────────────────────┘
```

在这个栈中越靠上，对变更的审查就越严格：
修改规范需要五个 SDK 保持同步；修改文档则是独立的。

<a id="top-level-directories"></a>

## 顶层目录

| 路径 | 内容 | 发布目标 |
|---|---|---|
| [`spec/`](../spec/) | DCP-01 至 DCP-09 的规范性规范，以及配置扩展（密码学、A2A、治理、准入）。英文文本具有规范效力；译文仅供参考。 | — |
| [`schemas/`](../schemas/) | 协议中每个构件的 JSON Schema（draft 2020-12）定义。v1（9 个模式）+ v2（42 个模式）。 | — |
| [`tests/conformance/`](../tests/conformance/) | 每个 SDK 都必须通过的跨 SDK 一致性测试套件。它是保证线上格式兼容性的关卡。 | — |
| [`tests/interop/`](../tests/interop/) | 互操作向量：规范化、域分离、复合签名、会话拼接、剥离攻击。 | — |
| [`tests/nist-kat/`](../tests/nist-kat/) | RFC 8032 的 Ed25519 向量、ML-DSA-65 的性质测试，以及 SLH-DSA-192f / ML-KEM-768 的 NIST ACVP 向量。 | — |
| [`sdks/typescript/`](../sdks/typescript/) | 参考 TypeScript SDK。 | npm `@dcp-ai/sdk` |
| [`sdks/python/`](../sdks/python/) | 参考 Python SDK。 | PyPI `dcp-ai` |
| [`sdks/rust/`](../sdks/rust/) | 参考 Rust SDK（也编译为 WASM）。 | crates.io `dcp-ai` |
| [`sdks/go/`](../sdks/go/) | 参考 Go SDK。 | Go 模块 `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` |
| [`sdks/wasm/`](../sdks/wasm/) | 面向浏览器 + Node 的 Rust SDK 的 WebAssembly 包。 | npm `@dcp-ai/wasm` |
| [`integrations/`](../integrations/) | 10 个框架绑定：Express、FastAPI、LangChain、OpenAI、CrewAI、OpenClaw、W3C DID、Google A2A、Anthropic MCP、AutoGen。 | npm `@dcp-ai/<name>`（六个软件包）；PyPI `dcp-ai[<extra>]`（FastAPI、LangChain、OpenAI、CrewAI） |
| [`packages/create-*`](../packages/) | 通过 `npm create @dcp-ai/<framework>` 调用的脚手架。每个主流框架一个。 | npm `@dcp-ai/create-<name>` |
| [`cli/`](../cli/) | 交互式向导 CLI，是为新用户提供的 `bin/dcp.js` 的替代品。 | npm `@dcp-ai/cli` |
| [`bin/`](../bin/) | 一致性测试套件使用的参考 JavaScript CLI。 | 根软件包（未发布到 npm）；从检出副本运行。 |
| [`services/`](../services/) | 参考运营服务：anchor（在内存中把哈希分批；尚未上链提交）、transparency-log（带已签名树头和 gossip 的 Merkle 树日志）、revocation。 | Docker 镜像 → GHCR |
| [`contracts/ethereum/`](../contracts/ethereum/) | `DCPAnchor.sol` + Foundry 测试。 | 链上部署 |
| [`api/`](../api/) | 线上格式构件：OpenAPI（`openapi.yaml`）+ Protocol Buffers（`proto/`）。 | — |
| [`lib/`](../lib/) | 参考验证库（`lib/verify.js`）以及根软件包、服务器和各服务使用的辅助函数。 | 根软件包（未发布到 npm）。 |
| [`tools/`](../tools/) | 仓库内部的 CLI（`validate.js`、`conformance.js`、`crypto.js`、`merkle.js`）。不发布。 | — |
| [`scripts/`](../scripts/) | 一次性的构建辅助脚本（示例生成器、协议指纹输出）。 | — |
| [`docs/`](../docs/) | 手写文档：QUICKSTART、OBSERVABILITY、ARCHITECTURE（本文件）、SECURITY 说明、迁移指南。 | 由 MkDocs 使用。 |
| `docs-site/` | 生成的、不受版本控制（`.gitignore`）：`scripts/docs_site.py` 为 MkDocs 构建写出的按语言划分的暂存目录树。站点配置是 [`mkdocs.yml`](../mkdocs.yml)。 | — |
| `site/` | 生成的、不受版本控制（`.gitignore`）：由 `bash scripts/build-docs-site.sh` 构建的五种语言的文档站点。 | GitHub Pages，通过 `.github/workflows/docs.yml`。 |
| [`playground/`](../playground/) | 浏览器内的交互式 playground（纯 JavaScript；Ed25519 使用 `tweetnacl`，SHA-256 使用 WebCrypto；如页面所述，其 ML-DSA / SLH-DSA 签名是模拟的）。 | 托管在 docs.dcp-ai.org/playground/。 |
| [`templates/`](../templates/) | `packages/create-*` 脚手架所使用的源模板。 | — |
| [`deploy/`](../deploy/) | 各服务的 Fly.io / 部署配置。 | — |
| [`keys/`](../keys/) | 一致性测试和示例使用的演示密钥。**不要在生产中使用。** | — |
| [`credentials/`](../credentials/) | 在 dcp-ai.org/credentials/v2 提供的 JSON-LD @context 文件。 | GitHub Pages。 |

<a id="how-the-pieces-talk-to-each-other"></a>

## 各部分如何协作

- **规范 → SDK。** `spec/` 和 `schemas/` 供人阅读；SDK 实现它们。每个 SDK 都会重新实现规范化、哈希、签名和验证，以产出线上格式兼容的构件。`tests/conformance/` 中的一致性测试套件在 CI 中对每个 SDK 运行相同的向量。
- **SDK → 集成。** 每个 `integrations/*` 软件包都把其语言的 SDK 作为依赖引入——例如 `@dcp-ai/express` 依赖 `@dcp-ai/sdk`。没有任何集成重新实现密码学。
- **集成 → 脚手架。** `packages/create-*` 提供用户在某个特定集成之上启动项目所需的最少粘合代码。
- **SDK → 服务。** 验证服务器和吊销服务通过 `lib/verify.js` 和 `@dcp-ai/sdk` 进行验证。透明度日志直接用 `tweetnacl` 签署其树头，锚定服务只计算哈希。
- **根软件包（`dcp-ai`，未发布到 npm）。** 顶层的 `package.json` 包含参考 CLI + 验证库（`bin/dcp.js`、`lib/verify.js`）以及一致性测试框架。V1 在原地验证；V2 在那里进行模式验证，然后由 `@dcp-ai/sdk` 验证，因此只有一个 V2 实现。它是最初的入口；大多数新用户则是通过某个 SDK 或脚手架进入的。

<a id="where-to-change-what"></a>

## 在哪里修改什么

| 你想要… | 编辑 |
|---|---|
| 提议新的构件或收紧某个模式 | `spec/` + `schemas/`，然后同步更新每个 SDK，并在 `tests/conformance/` 中加入一致性向量。 |
| 修复某种语言中的密码学缺陷 | `sdks/<language>/`。加入回归测试。如果该缺陷可能影响其他语言，在 `tests/interop/` 中加入共享的互操作向量。 |
| 添加框架集成 | `integrations/<framework>/`。把对应语言的 SDK 作为依赖使用。如果是主流框架，在 `packages/create-<framework>/` 中加入脚手架。 |
| 修改营销网站 | 不在本仓库中（参见[范围边界](#scope-boundary)）。 |
| 修改文档站点 | Markdown 源文件及其四份翻译、`mkdocs.yml`，以及 `scripts/docs-i18n.json` 中的已发布文档列表；`docs-site/` 和 `site/` 是生成的。参见 [CONTRIBUTING.md](../CONTRIBUTING.md#documentation-and-translations)。 |
| 修改交互式演示 | `playground/`。 |
| 部署或重新部署某个服务 | `services/<name>/` + `deploy/fly/`。 |
| 发布 SDK 的新版本 | 在相应的 `package.json` / `Cargo.toml` / `pyproject.toml` 或 git 标签中提升版本；CI 会检测到并通过 `.github/workflows/publish*.yml` 发布。已内置跳过已发布版本的逻辑。 |

<a id="scope-boundary"></a>

## 范围边界

这个单体仓库包含**协议及其参考实现**：规范、模式、五个 SDK、框架集成、脚手架、CLI、运营服务、智能合约、文档以及交互式 playground。这就是第三方采用 DCP-AI 所需的一切。

面向最终用户的应用（仪表板、智能体、演示）和营销渠道有意**不**放在本仓库中。它们属于托管它们的代码库——它们是构建在协议之上的应用，而不是协议的一部分。

<a id="why-monorepo-today"></a>

## 为什么目前采用单体仓库

一个拥有五个 SDK 的协议，成败取决于能否让它们保持线上格式兼容。一次性审查同时涉及五个 SDK 的 PR——并在每个 PR 上对五个 SDK 运行一致性测试套件——是维护这一不变量最轻量的方式。一旦某个特定的 SDK 或组件形成了自己的社区和自己的节奏，把它拆分出去就是合理的做法。在那之前，协调多个仓库的开销超过其收益。

延伸阅读：[`GOVERNANCE.md`](../GOVERNANCE.md) 中的治理模式，以及 [`ROADMAP.md`](../ROADMAP.md) 中的未来方向。
