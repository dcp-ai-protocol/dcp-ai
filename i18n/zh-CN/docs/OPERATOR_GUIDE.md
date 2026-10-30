<sub>[English](../../../docs/OPERATOR_GUIDE.md) · **中文** · [Español](../../es/docs/OPERATOR_GUIDE.md) · [日本語](../../ja/docs/OPERATOR_GUIDE.md) · [Português](../../pt-BR/docs/OPERATOR_GUIDE.md)</sub>

<a id="operator-guide--running-a-verification-service"></a>
<a id="operator-guide-running-a-verification-service"></a>

# 运营方指南 — 运行验证服务

> 本文是[英文版](../../../docs/OPERATOR_GUIDE.md)的参考译文，更新于 28/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

本指南面向希望运行“智能体已验证”服务的**第三方**：一个验证 DCP Signed Bundle 的 HTTP API（还可以选择把哈希锚定到区块链上）。协议**不**要求任何中央服务器；验证随时都可以用 `dcp verify-bundle` 在本地完成。此服务是**可选的**，由运营方自行决定是否运行。

<a id="what-is-an-agent-verified-service"></a>

## 什么是“智能体已验证”服务？

**智能体验证服务**是一个 HTTP API，它会：

1. **验证** Signed Bundle：执行与 [spec/VERIFICATION.md](../../../spec/VERIFICATION.md) 相同的规范性检查清单（模式验证、签名、intent_hash、审计链、可选的 merkle_root）。
2. 可选地对照公共区块链或透明度日志**检查** `anchor_receipt`（只使用公开数据）。
3. 可选地把 `bundle_hash` **锚定**到现有的链上，并向客户端返回 `anchor_receipt`。

该服务是**无状态的**：每个请求接收一个 bundle（以及可选的公钥），验证后返回结果。没有中央的智能体注册表；协议也没有定义规范的 URL（例如，不存在必须使用的“dcp.ai”端点）。

`verified: true` 表示 bundle 未被篡改，并由它所指明的密钥签署。它并不说明委托人是谁，也不说明你是否应该据此行事：只接受来自你所信任委托人的 bundle 是准入，一个单独的步骤（参考服务器中的 `POST /v2/admit`，参见 [ADMISSION.md](../../../docs/ADMISSION.md)，未发布）。

<a id="who-runs-it"></a>

## 由谁运行？

**第三方。** 任何人都可以用本仓库（模式 + 规范 + CLI 或编程 API）部署此服务。协议作者不运营任何中央验证服务器。

<a id="requirements"></a>

## 要求

- 本仓库的检出副本：`schemas/v1/` 和 `schemas/v2/` 中的模式，`spec/` 中的规范，以及根软件包（未发布到 npm）中的
  参考 CLI 和验证库。
- 运行验证的能力：使用 CLI（`dcp verify-bundle [--policy <mode>] <signed.json> [public_key.txt]`），或仓库中的编程 API：`lib/verify.js` 中的 `verifySignedBundle`（异步）和 `validateBundle`。V2 bundle 在那里先进行模式验证，然后由 `@dcp-ai/sdk` 验证。
- 可选，用于锚定：对现有链（Bitcoin、Ethereum 或透明度日志）的 RPC 或区块浏览器访问。参见 [STORAGE_AND_ANCHORING.md](../../../docs/STORAGE_AND_ANCHORING.md)。

<a id="suggested-api-contract"></a>

## 建议的 API 契约

为了让客户端和运营方能够互操作，本节建议一个最小契约。实现可以对其进行扩展。

### POST /verify

按照规范性检查清单（模式、签名、intent_hash、审计链、可选的 merkle）验证 Signed Bundle。

- **请求（JSON）：**
  - `signed_bundle`（对象）：要验证的 Signed Bundle。
  - `public_key_b64`（字符串，可选）：对于 V1，当 bundle 中不含签名者公钥时提供该公钥；否则使用 bundle 的 `signature.signer.public_key_b64`。对于 V2，它固定经典签名者（在 `pq_only` 模式下会被拒绝）。

- **响应（JSON）：**
  - `verified`（布尔值）：所有检查都通过时为 `true`。
  - `errors`（字符串数组，可选）：当 `verified` 为 `false` 时，提供人类可读的错误消息。

示例：

```json
// Request
{ "signed_bundle": { "bundle": { ... }, "signature": { ... } } }

// Response (success)
{ "verified": true }

// Response (failure)
{ "verified": false, "errors": ["SIGNATURE INVALID", "Hint: Check that the public key ..."] }
```

参考服务器（`server/`）将其实现为 `POST /verify`。其响应始终带有 `dcp_version` 和 `errors`；对于 V2，还会增加 `warnings`、`verifier_policy_hash` 和 `resolved_tier`。请求体为 JSON。

<a id="post-anchor-optional"></a>

### POST /anchor（可选）

把 `bundle_hash` 锚定到链上并返回 `anchor_receipt`。链和凭据（例如钱包、RPC URL）由运营方配置。回执格式参见 [STORAGE_AND_ANCHORING.md](../../../docs/STORAGE_AND_ANCHORING.md)。

- **请求（JSON）：**
  - `bundle_hash`（字符串）：例如 `sha256:<hex>`。
  - `chain`（字符串）：例如 `"bitcoin"`、`"ethereum"`。

- **响应（JSON）：**
  - `anchor_receipt`（对象）：例如 `{ "chain": "bitcoin", "tx_id": "...", "block_height": N }`，或 Ethereum 风格的字段。

`/anchor` 的实现取决于运营方的链和工具（Bitcoin OP_RETURN、Ethereum 合约事件等）。参考锚定服务（`services/anchor`）尚未实现它：它只在本地内存中记录哈希，带有 `tx_hash: null` 和 `onchain: false`，不返回任何 `anchor_receipt`。参考验证服务器对 `POST /anchor` 返回 501。

<a id="deployment"></a>

## 部署

参考验证服务器、锚定服务、透明度日志和吊销注册表都**以 Docker 镜像的形式发布**在 GitHub Container Registry 上。在大多数情况下，你根本不需要克隆仓库，`docker run` 就够了。

<a id="option-1--pull-the-reference-image-fastest"></a>
<a id="option-1-pull-the-reference-image-fastest"></a>

### 选项 1 — 拉取参考镜像（最快）

```bash
docker run -d -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest
curl http://localhost:3000/health
```

多架构（`linux/amd64` + `linux/arm64`）。标签：`:latest`、发布版本的 semver 标签（`:<major>.<minor>.<patch>`、`:<major>.<minor>`、`:<major>`）以及 `:sha-<short>`。完整的服务栈（验证 + 锚定 + 两个透明度日志 + 吊销，共五个容器）可以在 `docker/` 中运行一次 `docker compose up -d` 启动，也可以在仓库根目录运行 `docker compose -f docker/docker-compose.yml up -d`。

<a id="option-2--managed-paas"></a>
<a id="option-2-managed-paas"></a>

### 选项 2 — 托管 PaaS

Fly.io 的预配置文件位于 [`deploy/fly/`](../../../deploy/fly/)；[部署指南](../../../deploy/README.md)还介绍了 Google Cloud Run 和 Railway 的模式。

<a id="option-3--embed-the-verifier-in-your-own-service"></a>
<a id="option-3-embed-the-verifier-in-your-own-service"></a>

### 选项 3 — 把验证器嵌入你自己的服务

如果你希望在现有应用内部进行验证（不单独运行 HTTP 服务），请安装你所用语言的 SDK 并直接调用其验证器（TypeScript 中为 `verifySignedBundleV2`，Python 和 Rust 中为 `verify_signed_bundle_v2`，Go 中为 `v2.VerifySignedBundleV2`）。以下命令安装的是已发布的版本：

```bash
npm install @dcp-ai/sdk        # TypeScript / Node.js
pip install dcp-ai             # Python
cargo add dcp-ai@2.11.1
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.11.1
```

确切的导入路径和 API 范围参见各 SDK 的 README，已发布版本缺少的内容参见其 *Release status*。在 `main` 上，TypeScript、Python、Go 和 Rust SDK 原生验证 V1 和 V2 bundle，`@dcp-ai/wasm` 公开了 Rust 的 V2 验证器。它们的 V2 验证器遵循 [VERIFICATION.md](../../../spec/VERIFICATION.md) 中的检查清单，包括每个构件的签名（步骤 V2-8）和 PQ 检查点（步骤 V2-12），并且自 `@dcp-ai/sdk` 2.2.1、`@dcp-ai/wasm` 2.1.1、`dcp-ai` 2.10.1（PyPI）、Go v2.11.1 和 Rust `dcp-ai` 2.11.1 起还检查存在的步骤 V2-11 次级字段：更早的版本检查主审计链和 Merkle 根，但不检查可选的次级链或 `audit_merkle_root_secondary`（参见 [STORAGE_AND_ANCHORING.md](../../../docs/STORAGE_AND_ANCHORING.md#dual-hash-chains)）。

<a id="stateless-by-design"></a>

### 设计上无状态

- 验证**不需要数据库**：每个请求都是自包含的。
- 其他一切都需要**持久化**：网关的护照和密钥注册表、锚定队列、透明度日志和吊销注册表。

<a id="reference-services-keep-state-in-memory-only"></a>

### 参考服务只在内存中保存状态

参考网关（`server/`）和各服务（`services/`）没有持久存储，唯一的例外是吊销服务可以把状态保存在文件中（`REVOCATION_STATE_PATH`：在服务中默认关闭，在 `docker/` 的 compose 文件中开启，并放在卷上）。**重启、部署或崩溃都会清空它们的状态**，包括内存耗尽导致的崩溃。这些状态包括：

- 已注册的护照、密钥和紧急令牌；
- 吊销记录；
- 透明度日志；
- 待处理的锚定和本地锚定记录。

唯一的例外是把 `REVOCATION_STATE_PATH` 放在持久存储（卷）上的吊销服务：它的注册和吊销记录在重启后仍然保留。

状态被清空后，已记录的内容会丢失，但关卡依然存在：

- **注册。** 注册 `agent_id` 仍然需要运营方令牌；对于清空之前就已注册的 `agent_id` 也是如此，因为它们全都重新变成了新的。
- **吊销查询。** 吊销服务不再知道它记录过的吊销：
  - 对于清空之前已被吊销的智能体，`GET /check/<agent_id>` 返回 `revoked: false`；
  - `/.well-known/dcp-revocations.json` 不再列出它，因此基于拒绝列表的吊销信息源会把它读作未吊销；
  - `GET /v2/check/kid/<kid>` 对其密钥返回 404（状态未知）。
- **网关**会忘记它的护照、密钥（包括已吊销和已退役的）以及紧急令牌。
- **不会因此获得信任。** 仅仅清空状态并不会让某个委托人变得受信任，也不会让某个 bundle 被准入：准入仍然需要运营方的信任集合，在 strict-v1 下还需要吊销快照。

在生产中依赖这些服务之前，请加入持久存储。

为了让内存保持在有限范围内，身份、密钥和吊销注册表会拒绝工作，而不是逐出状态：

| 服务 | 限制 | 设置 |
|---------|-------|---------|
| 网关 | 注册新的 `agent_id` 需要运营方令牌（401） | `OPERATOR_TOKEN` |
| 网关 | 每个客户端每小时 20 次护照注册（429） | `REGISTRATIONS_PER_HOUR` |
| 网关 | 最多 10,000 个已注册密钥；超过后新的智能体会得到 507（轮换会先移除一个已退役的密钥，因此仍然放得下） | `MAX_REGISTERED_KEYS` |
| 网关 | 每个智能体保留 4 个轮换下来的密钥；更早的密钥作为墓碑保持吊销状态 | — |
| 网关 | 每个智能体在其生命周期内最多 64 个密钥；之后的轮换会得到 409（对频繁轮换的智能体请调高此值） | `MAX_KEYS_PER_AGENT` |
| 网关 | 每个客户端每分钟 100 个 POST 请求，每分钟 5 次紧急吊销 | — |
| 吊销 | 注册新的 `agent_id` 需要运营方令牌（401） | `OPERATOR_TOKEN` |
| 吊销 | 每个客户端每小时 20 次注册（429） | `REGISTRATIONS_PER_HOUR` |
| 吊销 | 最多 10,000 个已注册智能体；超过后新的会得到 507 | `MAX_AGENTS` |
| 吊销 | 文本字段最多 256 个字符；每个客户端每分钟 5 次紧急吊销 | — |
| 透明度日志 | gossip 交换需要由固定的对等方签名的树头（`GOSSIP_PEERS=<url>#<key>`）；请求体 16 KB；保留最近 100 条不同的告警；轮询最多读取 16 KB，在一个间隔后超时，且从不重叠 | `GOSSIP_PEERS` |
| 读取请求体的端点 | 请求体 1 MB（413）；`POST /v2/disputes/:id/escalate` 和 `POST /v2/delegation/mandate/:id/revoke` 不读取请求体 | — |

网关有两部分的行为不同：

- **DCP-05–09 记录存储会逐出。** 这些是生命周期、活力、遗嘱、继承、争议、判例、异议、权利、义务、违规、委托书、咨询声明、镜像、交互和关注阈值的存储。每个存储最多保留 10,000 条，在按智能体划分的列表中每个智能体最多 10,000 条，并逐出最旧的条目（FIFO）：被逐出的记录会直接消失，不报错。
- **审计链没有自己的上限**（`POST /v2/audit/append`）。只有请求方面的限制适用于它们。

限制按客户端 IP 计数。在会把客户端 IP 追加到 `X-Forwarded-For` 的代理之后，请设置 `TRUST_PROXY=true`；否则所有客户端都会共享代理的地址。

<a id="environment-variables-verification-service"></a>

### 环境变量（验证服务）

- `PORT` — HTTP 端口（默认 `3000`）
- `OPERATOR_TOKEN` — 用于管理端点（策略、公告、治理）以及注册新 `agent_id` 的 bearer 令牌；不设置时这些功能保持锁定
- `VERIFIER_MODE` — `classical_only` | `hybrid_preferred` | `hybrid_required` | `pq_only`
- `ALLOW_V1_BUNDLES` — `false` 会拒绝 V1 bundle
- `TRUST_PROXY`、`REGISTRATIONS_PER_HOUR`、`MAX_REGISTERED_KEYS`、`MAX_KEYS_PER_AGENT` — 见上文
- `DCP_TRUSTED_PRINCIPALS_FILE`、`DCP_ADMISSION_PROFILE_FILE`、`DCP_REVOCATION_LIST_URL`、`DCP_REVOCATION_LIST_AUTHORIZATION`、`DCP_REVOCATION_TIMEOUT_MS` — 用于 `POST /v2/admit` 的准入，参见 [ADMISSION.md](../../../docs/ADMISSION.md)
- `REQUIRE_SESSION_BINDING`、`REQUIRE_COMPOSITE_BINDING`、`MAX_KEY_AGE_DAYS` 和 `PQ_CHECKPOINT_INTERVAL` 出现在部署配置中，但尚未被读取

`anchor`、`transparency-log` 和 `revocation` 的环境变量参见 [`services/`](../../../services/) 下各自的 README，或 [`deploy/fly/`](../../../deploy/fly/) 中各服务的 `fly.toml`。

<a id="blockchain-and-verification"></a>

## 区块链与验证

- **仅验证：** 服务可以只提供 POST `/verify`，应用 [VERIFICATION.md](../../../spec/VERIFICATION.md) 的检查清单（模式、签名、intent_hash、审计链、merkle；自 `@dcp-ai/sdk` 2.2.1、`@dcp-ai/wasm` 2.1.1、`dcp-ai` 2.10.1（PyPI）、Go v2.11.1 和 Rust `dcp-ai` 2.11.1 起，SDK 验证器也会检查存在的可选次级链字段；更早的版本不会）。不需要区块链。
- **验证 anchor_receipt：** 如果客户端随 bundle 发送了 `anchor_receipt`，服务可以选择**只使用公开数据**（例如从区块浏览器获取交易）检查 `bundle_hash` 是否出现在指定的链或日志索引处。不涉及协议的任何中央服务器。
- **锚定（写入）：** 运营方运行节点或使用 RPC，把哈希写入现有的链；服务向客户端返回 `anchor_receipt`。这是可选的、因运营方而异的，参考锚定服务目前还不做这件事（参见 [`services/anchor/README.md`](../../../services/anchor/README.md)）。

---

<a id="v20-verification-service"></a>

## V2.0 验证服务

DCP v2.0 引入了后量子混合密码学、自适应安全等级和复合签名。运行验证服务的运营方必须更新配置以支持 V2。

<a id="verifier-policy-configuration"></a>

### 验证器策略配置

验证器接受一个 `VerifierPolicy`（[`schemas/v2/verifier_policy.schema.json`](../../../schemas/v2/verifier_policy.schema.json)）。参考服务器以如下策略启动：

```json
{
  "default_mode": "hybrid_required",
  "risk_overrides": { "high": "hybrid_required", "medium": "hybrid_required", "low": "hybrid_required" },
  "min_classical": 1,
  "min_pq": 1,
  "accepted_classical_algs": ["ed25519"],
  "accepted_pq_algs": ["ml-dsa-65", "slh-dsa-192f"],
  "accepted_hash_algs": ["sha256", "sha384"],
  "require_session_binding": true,
  "require_composite_binding": true,
  "max_key_age_days": 365,
  "allow_v1_bundles": true,
  "allow_classical_fallback_disable": false,
  "warn_classical_only_deprecated": false,
  "advisory_rejected_algs": []
}
```

`risk_overrides` 以护照的 `risk_tier` 为键。服务器没有策略文件：`VERIFIER_MODE` 和 `ALLOW_V1_BUNDLES` 在启动时设定策略，带 `{ "mode": "<mode>" }` 的 `POST /v2/policy/mode`（需要运营方令牌）在运行时切换模式，被接受的公告会加入 `advisory_rejected_algs`，`GET /v2/policy` 返回当前策略及其哈希。切换模式会把 `default_mode` 和 `risk_overrides` 的每个条目都设为该模式。要用你自己的策略嵌入验证器，请向 SDK 传入完整的策略：部分策略也会被接受，但你省略的字段不会用默认值填充（参见 [MIGRATION_V1_V2.md](../../../docs/MIGRATION_V1_V2.md) 的步骤 8）。

验证模式：
- `classical_only` — 只要求 Ed25519 签名（兼容 V1）
- `hybrid_preferred` — 要求 Ed25519，存在 ML-DSA-65 时也会检查
- `hybrid_required` — 要求同时具有 Ed25519 和 ML-DSA-65 的复合签名
- `pq_only` — 只要求并检查后量子签名；以 `classical_only` 签署的 bundle 会被拒绝，固定的经典密钥（`public_key_b64`）也会被拒绝。在参考服务器中，该模式还会关闭 V1 bundle。

在所有模式下，存在的 PQ 签名（ML-DSA-65 或 SLH-DSA-192f）都必须通过验证；无效的会被拒绝。

<a id="post-verify-v2"></a>

### POST /verify（V2）

V2 bundle 包含带经典和后量子两个分量的 `composite_sig`：

```json
{
  "signed_bundle": {
    "bundle": {
      "dcp_bundle_version": "2.0",
      "manifest": {
        "session_nonce": "a1b2c3...",
        "rpr_hash": "sha256:...",
        "passport_hash": "sha256:...",
        "intent_hash": "sha256:...",
        "policy_hash": "sha256:...",
        "audit_merkle_root": "sha256:...",
        "audit_merkle_root_secondary": "sha3-256:...",
        "audit_count": 1
      },
      "responsible_principal_record": { "payload": {...}, "payload_hash": "sha256:...", "composite_sig": {...} },
      "agent_passport": { "payload": {...}, "payload_hash": "sha256:...", "composite_sig": {...} },
      "intent": { "payload": {...}, "payload_hash": "sha256:...", "composite_sig": {...} },
      "policy_decision": { "payload": {...}, "payload_hash": "sha256:...", "composite_sig": {...} },
      "audit_entries": [ {...} ]
    },
    "signature": {
      "composite_sig": {
        "classical": { "alg": "ed25519", "kid": "...", "sig_b64": "..." },
        "pq": { "alg": "ml-dsa-65", "kid": "...", "sig_b64": "..." },
        "binding": "pq_over_classical"
      }
    }
  }
}
```

参考服务器的 V2 响应包含解析出的安全等级。`POST /v2/bundle/verify`（仅 V2；也接受把已签名 bundle 作为整个请求体）的响应为：

```json
{
  "verified": true,
  "dcp_version": "2.0",
  "errors": [],
  "warnings": [],
  "verifier_policy_hash": "sha256:...",
  "resolved_tier": "elevated",
  "verification_mode": "hybrid_required",
  "session_binding_valid": true,
  "manifest_valid": true
}
```

`POST /verify` 给出直到 `resolved_tier` 的相同字段。`session_binding_valid` 和 `manifest_valid` 是从错误消息中读出的，因此请依据 `verified` 和 `errors` 做决定。

<a id="security-tiers-in-verification"></a>

### 验证中的安全等级

每个安全等级对应一种验证模式和一个 PQ 检查点间隔（规范 §14.1）：

| 等级 | 验证模式 | PQ 检查点 |
|------|------------------|---------------|
| Routine | `classical_only` | 每 50 个事件 |
| Standard | `hybrid_preferred` | 每 10 个事件 |
| Elevated | `hybrid_required` | 每个事件 |
| Maximum | `hybrid_required` | 每个事件 |

不存在按等级划分的大小预算。bundle 的大小取决于其算法、审计条目和 PQ 检查点
以及 JSON 编码：请测量你最大的 bundle。例如，`tests/interop/v2/admission_vectors.json` 中的
合成混合 bundle `signed_bundles.base` 以紧凑 JSON 表示为 32,996 字节；这是一个
观测值，而不是上限。请把 bundle 放在带有明确大小预算的 JSON 请求体中发送，而不是放在请求头中（参见
[QUICKSTART_EXPRESS.md](../../../docs/QUICKSTART_EXPRESS.md#sending-dcp-bundles-from-a-client)）。

验证器可以**提高**等级（例如对金融操作强制使用 `elevated`），但**不得**（MUST NOT）**降低**等级。在 `main` 上，SDK 验证器（TypeScript、Go、Rust、WASM 和 Python）按策略模式（护照 `risk_tier` 对应的 `risk_overrides` 条目，或 `default_mode`）与等级模式（规范 §14.3）中较严格者检查 bundle 签名和每个构件的签名，因此声明 `risk_tier: "low"` 的护照在支付意图下仍然需要混合签名。它们还会检查 bundle 携带的 PQ 检查点（`spec/VERIFICATION.md` V2-12）。已发布的版本可能滞后：参见各 SDK 的 *Release status*。

参考服务器通过 `lib/verify.js` 验证 V2 bundle，后者把它们连同服务器的策略交给同一检出副本中的 TypeScript SDK；Docker 镜像从源码构建该 SDK（参见 [`docker/Dockerfile`](../../../docker/Dockerfile)）。其 `verification_mode` 字段是等级对应的模式，而不是实际生效的模式。

<a id="capabilities-endpoint-v2"></a>

### 能力端点（V2）

V2 服务公开 `GET /.well-known/dcp-capabilities.json`。参考服务器的响应为：

```json
{
  "supported_versions": ["1.0", "2.0"],
  "supported_algs": {
    "signing": ["ed25519", "ml-dsa-65", "slh-dsa-192f"],
    "kem": ["x25519", "ml-kem-768", "x25519-ml-kem-768"],
    "hash": ["sha256", "sha3-256", "sha384"]
  },
  "supported_wire_formats": ["application/json", "application/cbor"],
  "features": {
    "composite_signatures": true,
    "session_binding": true,
    "blinded_rpr": true,
    "dual_hash_chains": true,
    "pq_checkpoints": true,
    "emergency_revocation": true,
    "multi_party_auth": true,
    "pq_only_mode": true,
    "advisory_auto_response": true,
    "governance_keys": true,
    "hsm_provider": true,
    "agent_lifecycle": true,
    "succession": true,
    "dispute_resolution": true,
    "rights_obligations": true,
    "delegation": true
  },
  "verifier_policy_hash": "sha256:...",
  "min_accepted_version": "1.0"
}
```

这是服务器所声明的内容，而不是经过检查的保证清单。虽然列出了 `application/cbor`，但其端点只读取 JSON 请求体。声明了 `hsm_provider: true`，但仓库中的 HSM 提供者是一个没有硬件支撑的模拟实现（[SECURITY_MODEL.md](../../../docs/SECURITY_MODEL.md)）。

<a id="observability"></a>

### 可观测性

V2 服务应当公开用于监控的指标：

- **延迟**：按安全等级划分的 p50/p95/p99 验证延迟
- **吞吐量**：每秒验证的 bundle 数
- **缓存**：验证缓存的命中率/未命中率
- **PQ 检查点**：已验证的 PQ 检查点数量
- **错误**：按 DCP 错误码（DCP-E001 至 DCP-E902）统计的错误数
- **等级**：验证请求在各安全等级上的分布

建议：使用 SDK 内置的 `dcpTelemetry` 模块以及兼容 OpenTelemetry 的导出器（[OBSERVABILITY.md](../../../docs/OBSERVABILITY.md)）。参考服务器本身不会发出这些指标。

<a id="migration-for-existing-v1-operators"></a>

### 现有 V1 运营方的迁移

现有的 V1 运营方可以逐步升级：

1. 更新到 DCP v2.0 SDK
2. 设置 `default_mode: 'classical_only'`（在参考服务器中为 `VERIFIER_MODE=classical_only`）；对于 elevated 和 maximum 操作，安全等级仍会把模式提高到 `hybrid_required`
3. 为新智能体逐步启用 `hybrid_preferred`
4. 当 PQ 的采用足够广泛时，转为 `hybrid_required`

详细的迁移步骤参见 [MIGRATION_V1_V2.md](../../../docs/MIGRATION_V1_V2.md)。

<a id="dcp-0509-service-endpoints"></a>

## DCP-05–09 服务端点

DCP v2.0 为验证服务器扩展了 31 个端点，用于生命周期管理、数字继承、争议解决、权利框架和个人代理。

> **未认证且未验证。** 这些端点只对照模式及 ID 的格式检查每条记录。它们不验证任何 `composite_sig`，也不需要运营方令牌。任何能访问服务器的人都可以，例如，停用或重新启用一个智能体、吊销一份可吊销的委托书，或把一个争议标记为已解决。设置 `OPERATOR_TOKEN` 并不能保护它们：它只保护管理路由和新 `agent_id` 的注册。不要把它们暴露给不受信任的客户端：请把它们放在你自己的授权机制之后，或者完全不暴露，并把它们存储的内容视为未经验证的记录。

每个 POST 都在表中所列的键下接收记录（例如 `{ "commissioning_certificate": { ... } }`）。`:agent_id` 和 `:id` 需进行 URL 编码。

<a id="dcp-05-agent-lifecycle-management"></a>

### DCP-05：智能体生命周期管理

| 方法 | 端点 | 请求体键 | 说明 |
|--------|----------|----------|-------------|
| POST | `/v2/lifecycle/commission` | `commissioning_certificate` | 把智能体置于 `commissioned` 状态；对已知的智能体，会重置其状态和历史 |
| POST | `/v2/lifecycle/vitality` | `vitality_report` | 存储一份活力报告；报告中不同的 `state` 即为一次生命周期转换 |
| POST | `/v2/lifecycle/decommission` | `decommissioning_record` | 把智能体转为 `decommissioned`，并把已注册的护照标记为 `decommissioned` |
| GET | `/v2/lifecycle/:agent_id` | — | 当前状态、历史和活力报告数量 |

服务器接受的生命周期转换：`commissioned → active`、`active → declining`、`active → decommissioned`、`declining → decommissioned`。SDK 的状态机还允许 `commissioned → decommissioned` 和 `declining → active`。

<a id="dcp-06-digital-succession--inheritance"></a>
<a id="dcp-06-digital-succession-inheritance"></a>

### DCP-06：数字继承与遗产

| 方法 | 端点 | 请求体键 | 说明 |
|--------|----------|----------|-------------|
| POST | `/v2/succession/testament` | `digital_testament` | 存储智能体的遗嘱（每个智能体一份） |
| GET | `/v2/succession/testament/:agent_id` | — | 智能体的遗嘱 |
| POST | `/v2/succession/execute` | `succession_record` | 记录一次继承；当服务器知道前任的状态时，前任必须处于 `declining` 或 `decommissioned` |
| POST | `/v2/succession/memory-transfer` | `memory_transfer_manifest` | 验证清单并返回计数；不会存储 |
| GET | `/v2/succession/:agent_id` | — | 为某个前任记录的继承 |

<a id="dcp-07-conflict-resolution--dispute-arbitration"></a>
<a id="dcp-07-conflict-resolution-dispute-arbitration"></a>

### DCP-07：冲突解决与争议仲裁

| 方法 | 端点 | 请求体键 | 说明 |
|--------|----------|----------|-------------|
| POST | `/v2/disputes/create` | `dispute_record` | 存储一项争议 |
| POST | `/v2/disputes/:id/escalate` | — | 把争议移到下一个升级级别 |
| POST | `/v2/disputes/:id/resolve` | `arbitration_resolution`（可选） | 把争议标记为已解决；如提供裁决，则原样存储 |
| GET | `/v2/disputes/:id` | — | 该争议 |
| POST | `/v2/objections/create` | `objection_record` | 存储一项异议 |
| POST | `/v2/jurisprudence` | `jurisprudence_bundle` | 存储一个判例 bundle |
| GET | `/v2/jurisprudence` | — | 所有已存储的判例 bundle |

<a id="dcp-08-rights--obligations-framework"></a>
<a id="dcp-08-rights-obligations-framework"></a>

### DCP-08：权利与义务框架

| 方法 | 端点 | 请求体键 | 说明 |
|--------|----------|----------|-------------|
| POST | `/v2/rights/declare` | `rights_declaration` | 存储智能体的权利声明（每个智能体一份） |
| GET | `/v2/rights/:agent_id` | — | 智能体的权利声明 |
| POST | `/v2/obligations/record` | `obligation_record` | 添加一条义务记录 |
| GET | `/v2/obligations/:agent_id` | — | 智能体的义务记录 |
| POST | `/v2/rights/violation` | `violation_report` | 存储一份权利侵害报告 |

<a id="dcp-09-personal-representation--delegation"></a>
<a id="dcp-09-personal-representation-delegation"></a>

### DCP-09：个人代理与委托

| 方法 | 端点 | 请求体键 | 说明 |
|--------|----------|----------|-------------|
| POST | `/v2/delegation/mandate` | `delegation_mandate` | 存储一份委托书 |
| GET | `/v2/delegation/mandate/:id` | — | 该委托书，带 `revoked` |
| POST | `/v2/delegation/mandate/:id/revoke` | — | 吊销 `revocable` 为 true 的委托书 |
| POST | `/v2/agent-advisory/declare` | `advisory_declaration` | 存储一份咨询声明 |
| GET | `/v2/agent-advisory/:id` | — | 该咨询声明 |
| POST | `/v2/mirror/generate` | `principal_mirror` | 添加一个委托人镜像 |
| GET | `/v2/mirror/:agent_id` | — | 智能体的委托人镜像 |
| POST | `/v2/interactions/record` | `interaction_record` | 存储一条交互记录 |
| POST | `/v2/awareness/threshold` | `awareness_threshold` | 存储智能体的关注阈值（每个智能体一份） |
| GET | `/v2/awareness/threshold/:agent_id` | — | 智能体的关注阈值 |

按 ID 存储的记录，或每个智能体一份的记录，会被之后针对同一 ID 或智能体的 POST 替换。异议、违规报告和交互记录没有 GET 端点。

<a id="production-hardening"></a>

### 面向生产的加固

DCP-05–09 端点具备：

- **JSON Schema 验证** — 每个提交记录的 POST 在存储之前都会按其模式验证。`escalate` 和 `revoke` 不接收记录；`resolve` 接收一个可选的 `arbitration_resolution`，并且不经验证就存储
- **限流** — 所有 POST 端点每 IP 每分钟 100 个请求
- **请求体大小限制** — 在读取请求体的地方，最大 1 MB（返回 413）；`escalate` 和 `revoke` 不读取请求体
- **输入 ID 验证** — 服务器用作键的 ID 必须匹配 `^[\w:.\-]{1,256}$`；其他字符会被拒绝
- **有界存储** — 每个内存存储最多保留 10,000 条，并逐出最旧的条目（FIFO）：被逐出的记录会消失。身份注册表则改为拒绝（507）；参见[参考服务只在内存中保存状态](#reference-services-keep-state-in-memory-only)
- **安全头** — X-Content-Type-Options、X-Frame-Options、Strict-Transport-Security、Cache-Control

它们**不**包括对记录的签名验证，也不包括任何认证（参见本节开头的说明）。

<a id="reference"></a>

## 参考资料

- 验证检查清单：[spec/VERIFICATION.md](../../../spec/VERIFICATION.md)
- 存储与锚定：[STORAGE_AND_ANCHORING.md](../../../docs/STORAGE_AND_ANCHORING.md)
- bundle 格式：[spec/BUNDLE.md](../../../spec/BUNDLE.md)
