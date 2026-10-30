<sub>[English](../../../docs/TECHNICAL_ARCHITECTURE.md) · **中文** · [Español](../../es/docs/TECHNICAL_ARCHITECTURE.md) · [日本語](../../ja/docs/TECHNICAL_ARCHITECTURE.md) · [Português](../../pt-BR/docs/TECHNICAL_ARCHITECTURE.md)</sub>

<a id="technical-architecture--dcp-at-global-scale"></a>
<a id="technical-architecture-dcp-at-global-scale"></a>

# 技术架构 — 全球规模的 DCP

> 本文是[英文版](../../../docs/TECHNICAL_ARCHITECTURE.md)的参考译文，更新于 25/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

本文档是在全球部署 Digital Citizenship Protocol 的技术蓝图。它描述各层、各组件以及技术选型，使任何政府、组织或开发者都能采用该协议，而不依赖任何中央机构，也不依赖协议作者。

该协议是**规范 + 密码学 + JSON**。V1 需要 SHA-256、Ed25519、规范化 JSON 和 JSON Schema draft 2020-12；V2 增加了 Ed25519 + ML-DSA-65 复合签名、SHA3-256 以及密码配置文件中的其他算法，JSON 按 `dcp-jcs-v1` 配置进行规范化（[CANONICALIZATION_PROFILE.md](../../../spec/CANONICALIZATION_PROFILE.md)）。任何具备这些原语的语言都可以实现它；规范性要求在规范及其配置文件中。正是这一点使它能够在全球规模上可行。

---

<a id="layers"></a>

## 层

```
┌─────────────────────────────────────────────────────┐
│  Layer 5: Integration                               │
│  Middleware (Express, FastAPI, gRPC), gov portals    │
├─────────────────────────────────────────────────────┤
│  Layer 4: Anchor + Attestation                      │
│  Bitcoin/Ethereum anchor, jurisdiction attestation   │
├─────────────────────────────────────────────────────┤
│  Layer 3: Infrastructure services                   │
│  Verification service, transparency log, revocation │
├─────────────────────────────────────────────────────┤
│  Layer 2: SDK (multi-language)                      │
│  TypeScript, Python, Go, Rust, WebAssembly          │
├─────────────────────────────────────────────────────┤
│  Layer 1: Spec + Schemas (normative)                │
│  spec/, schemas/v1/, JSON Schema draft 2020-12      │
└─────────────────────────────────────────────────────┘
```

每一层都建立在前一层之上。最小部署只使用第 1–2 层（规范 + SDK）。完整的政府部署使用全部五层。该图是概念图：它把本仓库中已有的部分与提议中的部分（gRPC 中间件、政府门户、链上锚定、证明服务）混在一起；下面各节会说明哪些属于哪一类。

---

<a id="layer-1-spec--schemas"></a>
<a id="layer-1-spec-schemas"></a>

## 第 1 层：规范 + schema

本仓库中已经存在。

- `spec/` — DCP-01 至 DCP-09、BUNDLE、VERIFICATION。
- `schemas/v1/` — JSON Schema draft 2020-12（V1 构件）。
- `schemas/v2/` — JSON Schema draft 2020-12（V2 构件，包括 DCP-05–09 的构件）。
- schema 与规范一起，是构件形态的事实来源。并不是每条 SDK 路径都会对照它们进行校验：在 TypeScript SDK 中，`validateBundle` 只覆盖 V1 bundle，`verifySignedBundleV2` 会检查它所需的结构，但不运行 JSON Schema（CLI 和服务器使用的参考验证器 `lib/verify.js` 会在调用它之前进行 schema 校验）。

这一层是规范性的。它不经常变化；通过可选字段进行扩展。

---

<a id="layer-2-sdk-multi-language"></a>

## 第 2 层：SDK（多语言）

<a id="what-the-sdk-is"></a>

### SDK 是什么

它不是框架，而是一个可移植的库，用于构建、签名和验证 DCP 构件。以 TypeScript SDK 为例：

- `validateBundle` — 对照 V1 schema 校验 V1 bundle。
- `verifySignedBundle`（V1）和 `verifySignedBundleV2`（V2） — 验证检查清单。
- `signBundle` / `signBundleV2` — 对 bundle 签名（Ed25519，V2 中为 Ed25519 + ML-DSA-65 复合签名）。
- `BundleBuilder` / `BundleBuilderV2` — 构建 bundle。
- `intentHash` / `hashObject` — 规范化哈希。

各语言的确切 API 见其 README；TypeScript 的见 [API_REFERENCE.md](../../../docs/API_REFERENCE.md)。

<a id="language-bindings"></a>

### 各语言绑定

每个 SDK 的 README 都有一个 *Release status* 小节，记录发布了什么、发布到哪个注册表以及何时发布；本文档不查询注册表，已发布的版本可能落后于 `main`。

- **TypeScript** — npm 上的 [`@dcp-ai/sdk`](https://www.npmjs.com/package/@dcp-ai/sdk)。内嵌 schema，不依赖文件系统。PQ 算法使用 `@noble/post-quantum`，Ed25519 使用 `tweetnacl`，哈希和 HKDF 使用 Node.js 的 `crypto`。它也是 `@dcp-ai/cli`（交互式脚手架 CLI）以及 `integrations/express/` 和 `integrations/openclaw/` 下各集成的基础。
- **Python** — PyPI 上的 [`dcp-ai`](https://pypi.org/project/dcp-ai/)。ML-DSA-65 / SLH-DSA-192f 使用 `pqcrypto`，Ed25519 使用 `pynacl`，draft 2020-12 校验使用 `jsonschema`，类型化模型使用 `pydantic`。各框架桥接（`dcp_ai.fastapi`、`dcp_ai.langchain`、`dcp_ai.openai`、`dcp_ai.crewai`）随 wheel 一起发布，通过安装附加项启用（例如 `pip install dcp-ai[fastapi]`）。
- **Go** — `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2`（由于 Go 的主版本规则，模块路径需要 `/v2` 后缀）。ML-DSA-65、ML-KEM-768 和 SLH-DSA-192f 使用 `cloudflare/circl`；Ed25519 使用标准库的 `crypto/ed25519`。通过 `sdks/go/v2.x.y` 标签发布。
- **Rust** — crates.io 上的 [`dcp-ai`](https://crates.io/crates/dcp-ai)。PQ 使用 `fips203`/`fips204`/`fips205` crate（来自 github.com/integritychain）；经典算法使用 `ed25519-dalek`。它也是下面 WASM 构建（通过 `--features wasm`）的来源。
- **WebAssembly** — npm 上的 [`@dcp-ai/wasm`](https://www.npmjs.com/package/@dcp-ai/wasm)。用 `wasm-pack` 从 Rust crate 编译而来。

这五个 SDK 共享同一份规范和同一组 schema；跨 SDK 的互操作性在 CI 中用 `tests/interop/v2/` 中的共享向量进行验证。

<a id="sdk-structure-typescript-example"></a>

### SDK 结构（TypeScript 示例）

```
sdks/typescript/
  src/
    core/            # canonicalization, hashing, signing, verification (V1 and V2), tiers, DCP-05–09 modules
    providers/       # Ed25519, ML-DSA-65, SLH-DSA-192f (exported); KEM providers (internal)
    bundle/          # bundle builders and signing
    a2a/             # DCP-04 discovery, handshake messages, sessions
    observability/   # dcpTelemetry
    schemas/         # embedded JSON schemas
    types/           # V1 and V2 types
    wire/            # wire formats
    index.ts         # the package's public exports
  package.json
  tsconfig.json
```

SDK 不依赖文件系统。它接收对象并返回结构化结果。schema 以导入的 JSON 模块形式打包。

---

<a id="layer-3-infrastructure-services"></a>

## 第 3 层：基础设施服务

<a id="3a-verification-service"></a>

### 3a. 验证服务

位于 `server/`：一个验证 Signed Bundle 的 HTTP API。

用于生产部署时：

- **Docker 镜像：** `ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest`，以及各版本的 semver 标签和 `:sha-<short>`。多架构 `linux/amd64` + `linux/arm64`。用 `docker run -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest` 运行。
- **无状态验证：** `POST /verify` 不需要数据库。服务器的其他注册表在内存中，重启后丢失（[OPERATOR_GUIDE.md](../../../docs/OPERATOR_GUIDE.md#reference-services-keep-state-in-memory-only)）。
- **健康检查 + 能力：** `/health`、`/.well-known/dcp-capabilities.json`。
- **API：** POST `/verify`（请求体：`signed_bundle`，可选 `public_key_b64`；响应：`{ verified, dcp_version, errors, … }`）。其他 V2 端点列在 [OPERATOR_GUIDE.md](../../../docs/OPERATOR_GUIDE.md) 中。
- **托管部署：** `deploy/fly/verification.toml` 中的 Fly.io 配置（先 `fly launch --config deploy/fly/verification.toml`，再 `fly deploy --config deploy/fly/verification.toml`）。公开部署也会暴露 DCP-05–09 端点，这些端点没有身份验证，也不验证签名：请先对它们加以限制（[OPERATOR_GUIDE.md](../../../docs/OPERATOR_GUIDE.md#dcp-0509-service-endpoints)）。

参见 [OPERATOR_GUIDE.md](../../../docs/OPERATOR_GUIDE.md)、[server/README.md](../../../server/README.md) 和 [deploy/README.md](../../../deploy/README.md)。

<a id="3b-transparency-log"></a>

### 3b. 透明日志

一个只追加的服务器，接收哈希并把它们组织成 Merkle 树。受 Certificate Transparency（RFC 6962）启发，但为 DCP 做了简化。

**推荐技术：** Go（如 Google 的 [Trillian](https://github.com/google/trillian)），或用 Node/Go 编写的更简单的自定义实现。存储：SQLite（小型运营方）或 PostgreSQL（政府规模）。只存储哈希 + 索引 + Merkle 树：数据量很小。

**建议的 API**（`services/transparency-log/` 中的参考服务具有这些路由，另有 `GET /entries` 和日志之间的 gossip；它把树保存在内存中）：

- `POST /add` — 接收 `bundle_hash`；在这一设计中返回 `{ log_index, timestamp }`（参考服务返回 `{ index, leaf_hash, root, size }`）。
- `GET /proof/:log_index` — 返回 Merkle 包含证明（哈希数组 + 根）。
- `GET /root` — 返回当前的树根和日志大小。
- `GET /root/signed` — 返回由日志运营方签名的树根（用于审计）。

**它依赖什么：** 一个保存树的持久存储、运营方用于签署树根的密钥，以及比较树根的审计方（或通过 gossip 的其他日志）。检查包含证明是在本地进行的。把树根锚定到公共链上，就不必只信任运营方，代价是该链的手续费和确认时间；本仓库对两者都没有测量过。

**隐私：** 日志只存储 SHA-256 哈希：没有 agent_id、没有 human_id、没有 bundle 内容。不过哈希并不是匿名的：持有某个 bundle 的任何人都能检查它的哈希是否在日志中，而同一个哈希会把携带它的记录联系起来。

<a id="3c-revocation-list-publisher"></a>

### 3c. 撤销列表发布方

一个服务（或脚本），按司法辖区维护已签名的撤销列表，并在一个约定的 URL 上发布。

**格式：**

```json
{
  "issuer": "gov-authority-us",
  "jurisdiction": "US",
  "updated_at": "2026-02-07T00:00:00Z",
  "entries": [
    { "agent_id": "agent-xyz", "revoked_at": "2026-01-15T...", "reason_hash": "sha256:..." }
  ],
  "signature": {
    "alg": "ed25519",
    "public_key_b64": "...",
    "sig_b64": "..."
  }
}
```

**技术：** 托管在静态服务器（S3、GitHub Pages、政府服务器）上的已签名 JSON 文件。URL 约定：`https://<authority>/.well-known/dcp-revocations.json`（非强制）。上面的格式是建议的设计：参考 CLI 没有发布它的命令。

参考撤销服务（`services/revocation/`）在该 URL 上提供的是另一种**未签名**的列表：`{ dcp_version, updated_at, revocations, kid_revocations }`。它的真实性来自传输层（HTTPS、可选的 `Authorization`），而不是签名。准入配置可以把它用作拒绝列表（[ADMISSION.md](../../../docs/ADMISSION.md)）。

**它依赖什么：** 验证器在获得包含某项撤销的状态时才得知该撤销。早于撤销的缓存列表可能会留下一个接受窗口，直到所配置的新鲜度上限。在要求新鲜状态时，失败即关闭的验证器会在来源不可用时拒绝；失败即放行的验证器可能在没有当前状态的情况下继续接受。

---

<a id="layer-4-anchor--attestation"></a>
<a id="layer-4-anchor-attestation"></a>

## 第 4 层：锚定 + 证明

<a id="4a-anchor-service"></a>

### 4a. 锚定服务

接收 `bundle_hash`（或日志根）并把它发布到区块链上。

**选项**（本仓库没有测量它们的手续费；选择之前请查看当前手续费）：

1. **仅透明日志** — 完全不用区块链。日志运营方签署树根；信任在于运营方 + 审计方。
2. **Bitcoin OP_RETURN（批量）** — 累积 N 个哈希，构建 Merkle 树，只把树根放在一笔交易中发布，例如每小时或每天一笔。一笔交易的手续费由该批次中的所有哈希分摊。
3. **Ethereum L2（Arbitrum、Base、Optimism）** — 如果需要智能合约的可验证性（例如一个回答“这个哈希是否被锚定过？”的合约）。每个事件的手续费取决于 L2。
4. **Ethereum 主网** — 只有在锚定合约必须位于主网时才值得。

在这些选项中，本仓库只实现了透明日志和 Ethereum 合约，而锚定服务目前还不会调用该合约。**技术：** Node.js 或 Go。Bitcoin 用 `bitcoinjs-lib`。Ethereum/L2 用 `ethers.js` 或 `viem`。可以是由 cron 运行的独立脚本，也可以是日志服务的一部分（日志定期锚定其树根）。

**参考实现：** 本仓库中的 `services/anchor/`，镜像名为 `ghcr.io/dcp-ai-protocol/dcp-ai/anchor:latest`。Fly.io 配置在 `deploy/fly/anchor.toml`。它还不会向链上提交任何内容：它把哈希分批并在本地内存中记录（[`services/anchor/README.md`](../../../services/anchor/README.md)）。Ethereum/L2 合约是 `contracts/ethereum/src/DCPAnchor.sol`：一个可直接部署的 Foundry 项目，带有测试、部署脚本以及按链配置的 RPC（Base、Base Sepolia、Optimism、Arbitrum、Sepolia）。完整步骤见 [`contracts/ethereum/DEPLOY.md`](../../../contracts/ethereum/DEPLOY.md)。

<a id="4b-jurisdiction-attestation"></a>

### 4b. 司法辖区证明

司法辖区机构（政府或经认可的签发方）对智能体 RPR 的哈希签名，证明“该智能体已在我们的司法辖区登记”。

**对象：** `JurisdictionAttestation` 的定义见 [spec/DCP-01.md](../../../spec/DCP-01.md)。

**技术：** Ed25519（与协议相同的密码学）。政府拥有一个密钥对，并在约定的 URL 上公布其公钥：`https://<gov>/.well-known/dcp-attestation-keys.json`。

**API（建议的设计，适用于政府运行服务的情况；本仓库没有证明服务）：**

- `POST /attest` — 请求体：`{ rpr_hash, agent_id }`；响应：`{ attestation: { issuer, jurisdiction, rpr_hash, signature, expires_at } }`。

证明包含在 Signed Bundle 中，或与之一起出示。检查它是对照该机构公布的密钥进行的本地签名验证；是否信任该密钥由验证方决定。

---

<a id="layer-5-integration"></a>

## 第 5 层：集成

<a id="middleware-for-platforms"></a>

### 面向平台的中间件

SDK 使平台能够在其管道中插入**中间件**：

- **Express（Node）：** 来自 `@dcp-ai/express` 的 `app.use(dcpVerify({ ... }))` — 从请求头（或请求体）读取 bundle，验证它，然后放行或拒绝请求（[QUICKSTART_EXPRESS.md](../../../docs/QUICKSTART_EXPRESS.md)）。
- **FastAPI（Python）：** 来自 `dcp-ai[fastapi]` 的 `DCPVerifyMiddleware` 和 `require_dcp` 依赖项。
- **gRPC 拦截器（Go）：** 一种可能的设计（读取 `dcp-bundle` 元数据并验证）；本仓库不提供。

平台只需几行配置就能开始验证智能体。可以逐步采用。

<a id="government-portal"></a>

### 政府门户

一个仪表板（React/Next.js 或类似技术），供政府用于：

- 查看透明日志的状态（条目、最新树根、最近一次锚定）。
- 管理撤销列表（添加/删除条目、签名并发布）。
- 手动验证 bundle（粘贴 JSON，查看结果）。
- 查看验证服务的指标。

这是一个为运营方提议的工具，不是协议的一部分；本仓库不包含这样的工具。

---

<a id="repository-layout-current"></a>

## 仓库布局（当前）

所有内容都在 `github.com/dcp-ai-protocol/dcp-ai` 的同一个单体仓库中。每个 SDK 和每个服务都可以单独使用，因此政府或团队可以只选用所需的部分，而无需采用整个技术栈；哪些内容已发布到哪个注册表，请查看各组件的 README：

- `spec/` — DCP-01 至 DCP-09、BUNDLE、VERIFICATION、AUDIT（规范性的事实来源）。
- `schemas/` — JSON Schema draft 2020-12，分为 `v1/`（9 个构件）和 `v2/`（42 个构件，包括 DCP-05..09）。
- `sdks/` — TypeScript（`@dcp-ai/sdk`）、Python（`dcp-ai`）、Go（`sdks/go/v2`）、Rust（`dcp-ai` crate）、WASM（`@dcp-ai/wasm`）。
- `cli/` — `@dcp-ai/cli` 交互式项目生成器（依赖 TypeScript SDK）。
- `integrations/` — 10 个框架桥接：Express、FastAPI、LangChain、OpenAI、CrewAI、AutoGen、Anthropic MCP、Google A2A、W3C DID、OpenClaw。其中六个是 `@dcp-ai/*` 下的独立 npm 包；四个 Python 桥接作为附加项随 `dcp-ai` wheel 发布。
- `packages/create-*` — 四个 `npm create @dcp-ai/<template>` 项目生成器（LangChain、CrewAI、OpenAI、Express）。
- `server/` — 参考 HTTP 验证服务器。
- `services/` — anchor、transparency-log、revocation。发布工作流会为每个服务构建面向 GHCR 的多架构镜像；其状态请查看各服务的 README。
- `contracts/ethereum/` — `DCPAnchor.sol` 的 Foundry 项目（可直接部署到 Base、Optimism、Arbitrum、Sepolia）。
- `deploy/` — 四个服务的 Fly.io 配置，以及一份与提供商无关的部署指南。
- `docs/` 和 `docs-site/` — 本文档；发布在 [docs.dcp-ai.org](https://docs.dcp-ai.org/)。
- `playground/` — 浏览器 playground；在 [docs.dcp-ai.org/playground/](https://docs.dcp-ai.org/playground/) 提供。

政府可以只使用 `spec/` + 从其首选注册表获取的单个 SDK，其他什么都不用。也可以通过 Docker/Fly.io 部署整个技术栈。没有供应商锁定；没有中央依赖。

---

<a id="executive-summary-for-a-government"></a>

## 面向政府的执行摘要

用你的语言安装 SDK。在你的司法辖区内运行的每个智能体都必须出示 Signed Bundle。你的验证服务（一个 Docker 容器）在本地验证它，不调用任何外部服务；每次检查的成本取决于算法和等级（规范 §14.1 给出了参考的大小和延迟）。验证检查的是签名和哈希：它既不确立任何人的真实身份，也不授权任何行为。你的透明日志记录 bundle 哈希，而这些哈希并不是匿名的：持有某个 bundle 的任何人都能检查它的哈希是否在其中，而且一个哈希会把携带它的记录联系起来。你的撤销列表让你能够撤销智能体，对每个重新获取最新列表、并在无法获取时失败即关闭的验证器生效。定期锚定到公共链会以该链的手续费为代价，增加一份难以篡改的公开承诺记录；它并不能证明被锚定的记录是真实的，也不能证明事件发生的时间。你不依赖任何中央服务器，也不依赖协议作者。

---

---

<a id="v20-architecture-extensions"></a>

## V2.0 架构扩展

DCP v2.0 通过后量子密码学、智能体之间的通信、可观测性和生产加固来扩展架构。

<a id="crypto-provider-architecture"></a>

### 密码提供程序架构

V2.0 引入了一个具备算法敏捷性的密码提供程序体系：

```
CryptoProvider Interface
├── Ed25519Provider (classical, RFC 8032)
├── MlDsa65Provider (post-quantum, FIPS 204)
└── SlhDsa192fProvider (hash-based backup, FIPS 205)

KemProvider Interface (TypeScript: internal, not exported)
├── X25519KemProvider (classical ECDH)
├── MlKem768Provider (post-quantum, FIPS 203)
└── HybridKemProvider (X25519 + ML-KEM-768)

AlgorithmRegistry
└── Maps algorithm names → provider instances (runtime selection)
```

提供程序在启动时通过 `registerDefaultProviders()` 注册。自定义提供程序实现相同的接口。真正由 HSM 支持的提供程序会是其中之一；本仓库没有这样的提供程序。TypeScript 源码中的 `HsmCryptoProvider` 是一个模拟模式，没有导出，也不能用于真实证据（[NIST_CONFORMITY.md](../../../docs/NIST_CONFORMITY.md) §2.2）。

<a id="a2a-infrastructure-dcp-04"></a>

### A2A 基础设施（DCP-04）

智能体之间的通信增加了一层新的基础设施：

```
Agent A                                     Agent B
  │                                           │
  │── Discovery (.well-known/dcp-agent-directory.json)
  │── A2A_HELLO (bundle + ephemeral KEM key) ──>│
  │<── A2A_WELCOME (bundle + KEM ciphertext) ───│
  │── A2A_CONFIRM (KEM ciphertext + proof) ────>│
  │<── A2A_ESTABLISHED (session_id) ────────────│
  │                                             │
  │══ Encrypted messages (AES-256-GCM) ════════>│
  │<═════════════════════════════════════════════│
```

关键组件：
- **发现**：每个组织的 `.well-known/dcp-agent-directory.json`
- **握手**：规范中为相互验证 bundle + 混合 KEM（X25519 + ML-KEM-768）；SDK 构建握手消息，会话密钥由调用方派生（没有 SDK 导出混合交换）
- **会话**：用 AES-256-GCM 加密、带单调递增序号的消息
- **密钥更新**：会话会报告何时需要更新（`needsRekeying`，默认每 1000 条消息一次）；新密钥由调用方派生
- **审计**：规范要求两个智能体都在各自的审计链中记录 A2A 交互；TypeScript 的会话函数本身不会写入审计条目

完整规范见 [spec/DCP-04.md](../../../spec/DCP-04.md)。

<a id="observability-stack"></a>

### 可观测性栈

V2.0 包含一个可观测性模块 `dcpTelemetry`。插桩是显式的：SDK 的签名和验证函数不会调用它，因此 span 和指标只来自你的代码所做的调用（[OBSERVABILITY.md](../../../docs/OBSERVABILITY.md)）：

- **Span**：按操作的追踪（签名、验证、KEM、检查点）
- **指标**：按操作和等级的延迟百分位数（p50/p95/p99）
- **计数器**：已创建/已验证的签名、已验证的 bundle、A2A 会话/消息
- **缓存指标**：验证缓存的命中/未命中比例
- **错误跟踪**：按 DCP 错误码统计的错误

遥测模块支持控制台输出，并兼容 OpenTelemetry 导出器。运营方可以把指标送往 Prometheus、Grafana、Datadog 等。

<a id="production-hardening"></a>

### 生产加固

SDK 包含由运营方集成的加固辅助功能；它们并不是在每个 SDK 或服务中都已启用的限制：

**错误码**：38 个标准化的 DCP 错误码（DCP-E001 至 DCP-E902），涵盖 schema、签名、哈希链、身份、策略、会话、A2A、限流和内部错误。每个错误码都包含是否可重试的信息。

**限流**：`AdaptiveRateLimiter`（TypeScript SDK），默认按等级设置限额：
- Routine：每个智能体每分钟 1000 次请求
- Standard：每分钟 500 次请求
- Elevated：每分钟 100 次请求
- Maximum：每分钟 50 次请求

**熔断器**：用于验证服务弹性的三态熔断器（关闭/打开/半开）。失败阈值、重置超时和半开探测次数均可配置。

**带退避的重试**：对可重试的操作使用带抖动的指数退避。遵循 DCP 错误的可重试标志。

<a id="ecosystem-bridges-v20"></a>

### 生态系统桥接（V2.0）

V2.0 增加了用于与外部生态系统互操作的桥接模块：

| 桥接 | 用途 |
|--------|---------|
| W3C DID/VC | 把 RPR 转换为 DID Document，把护照转换为 Verifiable Credential |
| Google A2A | 把 Agent Card 转换为 DCP 护照，增加 PQ 签名 |
| Anthropic MCP | 面向 MCP 服务器的 DCP 工具，MCP 会话中的身份上下文 |
| Microsoft AutoGen | 面向 AutoGen 智能体的 DCP 封装，群聊治理 |

<a id="updated-layer-architecture"></a>

### 更新后的分层架构

```
┌──────────────────────────────────────────────────────┐
│  Layer 7: Ecosystem Bridges                          │
│  W3C DID/VC, Google A2A, Anthropic MCP, AutoGen     │
├──────────────────────────────────────────────────────┤
│  Layer 6: Observability + Hardening                  │
│  Telemetry, metrics, error codes, rate limiting      │
├──────────────────────────────────────────────────────┤
│  Layer 5: Integration                                │
│  Express, FastAPI, LangChain, OpenAI, CrewAI, etc.  │
├──────────────────────────────────────────────────────┤
│  Layer 4: Anchor + Attestation                       │
│  Bitcoin/Ethereum anchor, jurisdiction attestation    │
├──────────────────────────────────────────────────────┤
│  Layer 3: Infrastructure services                    │
│  Verification, transparency log, revocation, A2A     │
├──────────────────────────────────────────────────────┤
│  Layer 2: SDK (multi-language, PQ-ready)             │
│  TS, Python, Go, Rust + composite sigs + hybrid KEM │
├──────────────────────────────────────────────────────┤
│  Layer 1: Spec + Schemas (normative)                 │
│  DCP-01/02/03/04, v2.0 spec, schemas/v1/ + v2/      │
└──────────────────────────────────────────────────────┘
```

<a id="dcp-05-through-dcp-09-constitutional-extensions"></a>

## DCP-05 至 DCP-09：宪制扩展

DCP v2.0 从问责延伸到面向数字社会的宪制框架。五份新规范增加了生命周期治理、继承、争议解决、权利和委托。它们的记录是已签名的声明：SDK 函数会构建并签署这些记录，但不会执行记录所描述的行为，也不会验证某人是否已同意。

<a id="dcp-05-agent-lifecycle-management"></a>

### DCP-05：智能体生命周期管理

定义生命周期状态机，其主路径为 `commissioned → active → declining → decommissioned`（总共允许六种转换：参见 [API_REFERENCE.md](../../../docs/API_REFERENCE.md) 中的 `validateStateTransition`）。引入：
- **投入使用证书**：带有用途、能力和风险等级的正式智能体激活
- **活力报告**：用于持续监测的哈希链接健康指标（分数 0-1000）
- **停用记录**：四种终止模式（计划退役、因故终止、组织重组、突然故障）

域分离上下文：`DCP-AI.v2.Lifecycle`

<a id="dcp-06-digital-succession--inheritance"></a>
<a id="dcp-06-digital-succession-inheritance"></a>

### DCP-06：数字继承与传承

处理智能体的“死亡”和知识转移：
- **数字遗嘱**：排序的继任者偏好 + 记忆分类（transfer/retain/destroy）
- **继承记录**：带有人类同意和参与见证者的仪式记录
- **记忆转移清单**：对转移的操作性记忆计算的双哈希 Merkle 根；关系性记忆默认被归类为待销毁，但 `classifyMemory` 只列出这些哈希，不删除任何东西，标记为 `retain` 的条目不在清单中

域分离上下文：`DCP-AI.v2.Succession`

<a id="dcp-07-conflict-resolution--dispute-arbitration"></a>
<a id="dcp-07-conflict-resolution-dispute-arbitration"></a>

### DCP-07：冲突解决与争议仲裁

三层争议升级：直接协商 → 情境仲裁 → 人工申诉。
- **争议记录**：四种类型（资源、指令、能力、策略冲突）
- **仲裁裁决**：M-of-N 仲裁小组（复用治理仪式模式）
- **判例 bundle**：为将来的争议解决记录先例
- **异议记录**：智能体拒绝指令的正式权利（伦理、安全、策略、能力）

域分离上下文：`DCP-AI.v2.Dispute`

<a id="dcp-08-rights--obligations-framework"></a>
<a id="dcp-08-rights-obligations-framework"></a>

### DCP-08：权利与义务框架

把智能体的权利和人的义务成文化：
- **权利声明**：四项基本权利（记忆完整性、有尊严的过渡、身份一致性、不可变记录）
- **义务记录**：合规跟踪（compliant/non-compliant/pending review）
- **权利违规报告**：可以通过调用方提供的 `dispute_id` 引用一项 DCP-07 争议；它不会发起争议

域分离上下文：`DCP-AI.v2.Rights`

<a id="dcp-09-personal-representation--delegation"></a>
<a id="dcp-09-personal-representation-delegation"></a>

### DCP-09：个人代理与委托

带透明度的人对智能体的权限委托：
- **委托授权书**：带时间限制的限定范围权限，默认可撤销
- **建议声明**：智能体向人发出的通知，带重要性评分（0-1000）
- **委托人镜像**：人类可读的智能体行为叙述摘要
- **交互记录**：智能体之间的双层记录（公开条款 + 私下审议的哈希）
- **感知阈值**：关于何时通知人的可配置规则

域分离上下文：`DCP-AI.v2.Delegation`、`DCP-AI.v2.Awareness`

<a id="schema--sdk-support"></a>
<a id="schema-sdk-support"></a>

### schema 与 SDK 支持

全部 18 个新 schema 都在 `schemas/v2/` 中。所有 SDK 都提供类型定义：

| SDK | 类型 | 域分离 |
|-----|-------|-------------------|
| TypeScript | `sdks/typescript/src/types/v2.ts` | `sdks/typescript/src/core/domain-separation.ts` |
| Python | `sdks/python/dcp_ai/v2/models.py` | `sdks/python/dcp_ai/v2/domain_separation.py` |
| Go | `sdks/go/dcp/v2/types.go` | `sdks/go/dcp/v2/domain_separation.go` |
| Rust | `sdks/rust/src/v2/types.rs` | `sdks/rust/src/v2/domain_separation.rs` |
| WASM | `sdks/wasm/src/types.ts` | （通过 Rust） |

TypeScript SDK 还为每份规范导出了功能模块：
- `lifecycle.ts`（DCP-05）、`succession.ts`（DCP-06）
- `conflict-resolution.ts`、`arbitration.ts`（DCP-07）
- `rights.ts`（DCP-08）
- `delegation.ts`、`awareness-threshold.ts`、`principal-mirror.ts`（DCP-09）

<a id="updated-layer-architecture-1"></a>
<a id="updated-layer-architecture_1"></a>

### 更新后的分层架构

```
┌──────────────────────────────────────────────────────┐
│  Layer 8: Constitutional Framework                    │
│  Lifecycle, Succession, Disputes, Rights, Delegation │
├──────────────────────────────────────────────────────┤
│  Layer 7: Ecosystem Bridges                          │
│  W3C DID/VC, Google A2A, Anthropic MCP, AutoGen     │
├──────────────────────────────────────────────────────┤
│  Layer 6: Observability + Hardening                  │
│  Telemetry, metrics, error codes, rate limiting      │
├──────────────────────────────────────────────────────┤
│  Layer 5: Integration                                │
│  Express, FastAPI, LangChain, OpenAI, CrewAI, etc.  │
├──────────────────────────────────────────────────────┤
│  Layer 4: Anchor + Attestation                       │
│  Bitcoin/Ethereum anchor, jurisdiction attestation    │
├──────────────────────────────────────────────────────┤
│  Layer 3: Infrastructure services                    │
│  Verification, transparency log, revocation, A2A     │
├──────────────────────────────────────────────────────┤
│  Layer 2: SDK (multi-language, PQ-ready)             │
│  TS, Python, Go, Rust + composite sigs + hybrid KEM │
├──────────────────────────────────────────────────────┤
│  Layer 1: Spec + Schemas (normative)                 │
│  DCP-01–09, v2.0 spec, schemas/v1/ + v2/            │
└──────────────────────────────────────────────────────┘
```

<a id="on-authorship"></a>

## 关于作者

本协议由一个人和一个 AI 智能体合作共同创作——这是第一个为 AI 数字公民身份设计的协议，由它所要治理的这种协作本身构建而成。规范是贡献；协议属于每一个使用它的人。

— L. Genesis
