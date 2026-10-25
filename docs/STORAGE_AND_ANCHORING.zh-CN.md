<sub>[English](STORAGE_AND_ANCHORING.md) · **中文** · [Español](STORAGE_AND_ANCHORING.es.md) · [日本語](STORAGE_AND_ANCHORING.ja.md) · [Português](STORAGE_AND_ANCHORING.pt-BR.md)</sub>

<a id="storage-and-anchoring--p2p-verification-local"></a>
<a id="storage-and-anchoring-p2p-verification-local"></a>

# 存储与锚定 — P2P，本地验证

> 本文是[英文版](STORAGE_AND_ANCHORING.md)的参考译文，更新于 25/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

协议不依赖任何中央服务。验证在本地进行；可选的锚定使用**现有的**公共区块链或**第三方**服务。协议并不指向任何规范的“DCP 注册中心”或“dcp.ai” URL。

<a id="design"></a>

## 设计

- **验证在本地进行。** 验证者只需要：(1) Signed Bundle（或 Citizenship Bundle + 签名），以及 (2) 可选的一组已签名的 RevocationRecord（来自对等方、文件，或锚定在链上）。不需要调用任何中央服务器的 API。
- **可选的锚定：** 用户（或任何第三方）把哈希发布到**现有的**公共区块链（Bitcoin、Ethereum）或**第三方**透明度日志。
- **吊销：** 一个或多个已签名的 RevocationRecord。以 P2P 方式分发（持有者交给验证者），或以哈希形式发布到链上或日志中；验证者拥有一组“已知吊销”（哈希或记录），并据此检查签名者或 agent_id。没有中央吊销服务器。

<a id="storage-options"></a>

## 存储选项

| 选项 | 存储什么 | 存储在哪里 |
|--------|----------------|--------|
| **仅可移植** | 完整的 bundle 由持有者保存；在需要时（例如调用 API 时）出示给验证者。 | 持有者的设备或存储；验证者在通信中收到 bundle。 |
| **锚定（仅哈希）** | 只发布 bundle_hash 或 merkle_root（以及可选的吊销哈希）。完整的 bundle 留在链下。 | 公共区块链、透明度日志或 DHT。验证者使用公开数据检查“此哈希在 T 时刻被锚定”。用户或第三方锚定服务使用现有的链或日志。 |
| **吊销** | 一个或多个已签名的 RevocationRecord。以 P2P 方式分发，或以哈希形式发布到链上或日志中。 | 对等方、文件、IPFS、区块链（仅哈希）或用户提供的列表。 |

<a id="optional-anchor-receipt"></a>

## 可选的锚定回执

如果使用锚定，可以在 bundle **旁边**保存一份可选的证明（不一定放在模式中）：

- `anchor_receipt`：`{ chain, tx_id, block_height }`（Bitcoin）或 `{ chain, contract, tx_id, block_number, event_index }`（Ethereum）或 `{ log_url, log_index }`（透明度日志）。

锚定由用户或第三方锚定服务在现有的链或日志上完成。

<a id="blockchain-anchoring"></a>

## 区块链锚定

如何把 DCP 哈希锚定到区块链上。用户（或任何第三方锚定服务）把哈希发布到**现有的**公共链上。

<a id="what-goes-on-chain-only-hashes"></a>

### 上链的内容（仅哈希）

- **bundle_hash**（例如 `sha256:<hex>`）或 audit_entries 的 **merkle_root**。每次锚定一个哈希。
- 可选：**RevocationRecord 的哈希**（以便验证者可以从链上拉取吊销哈希列表并在本地检查）。
- **除此之外什么都没有：** 没有完整的 bundle，没有 agent_id，没有 human_id，没有 RPR/AP 载荷。链上只能看到哈希。哈希并不是匿名的：任何持有该 bundle 的人都能在链上找到它的哈希，同一个哈希会把所有携带它的记录联系起来。

<a id="implementation-options"></a>

### 实现选项

| 链 / 系统 | 方法 | 格式 | 说明 |
|----------------|--------|--------|--------|
| **Bitcoin** | OP_RETURN 输出（或 taproot 承诺）。每个哈希一笔交易，或把许多哈希批量放入一棵 Merkle 树并承诺其根。 | 输出中的 32 字节（SHA-256）。 | 便宜、不可变；每笔交易的载荷大小有限。批量时：每笔交易一个根，证明放在链下。 |
| **Ethereum（或 L2）** | 发出带 `bytes32 bundleHash`（以及可选时间戳）事件的合约。 | 事件：`Anchored(bytes32 bundleHash, uint256 timestamp)`。 | 验证者读取事件；无需信任中央服务器。需要 gas 成本。 |
| **透明度日志（例如 CT 风格）** | 只追加日志：每个条目 = 哈希（+ 可选时间戳）。在条目之上构建 Merkle 树；根可以定期发布到 Bitcoin/Ethereum。 | 日志条目 = 32 字节哈希。包含证明 = Merkle 路径。 | 追加非常便宜；验证者检查包含证明。可由第三方运营。 |
| **IPFS** | 只把哈希作为内容发布（例如一个 DAG 节点）。从多个节点固定（pin）。 | CID 或原始哈希。 | 不是区块链，但是去中心化的；验证者解析 CID 得到哈希并进行比较。 |

<a id="concrete-flow-bitcoin-op_return"></a>

### 具体流程（Bitcoin OP_RETURN）

1. 持有者拥有 Signed Bundle；`bundle_hash` 已经在 `signature.bundle_hash` 中。
2. 持有者（或任何第三方）创建一笔 Bitcoin 交易，其 OP_RETURN 输出包含该 32 字节的十六进制值（或带上 `dcp:v1:` + hex 之类的前缀以标识协议）。
3. 持有者保存 **anchor_receipt**：`{ chain: "bitcoin", network: "mainnet", tx_id: "<txid>", block_height: N }`（如果是批量的，还可以保存 Merkle 证明）。
4. 验证者：给定一个 Signed Bundle 和一个 anchor_receipt，(a) 根据 bundle 计算 bundle_hash，(b) 从链上（或公共区块浏览器、自己的节点）获取该交易，(c) 检查 OP_RETURN 输出与 bundle_hash 是否一致。验证在本地进行，加上链上的公开数据。

<a id="anchoring-by-users-or-third-parties"></a>

### 由用户或第三方进行锚定

锚定由**用户**或**第三方锚定服务**在现有的链上完成。参考 CLI 没有锚定命令，参考锚定服务（`services/anchor/`）也尚未向链上提交：它只是把哈希分批，并在本地内存中记录。`contracts/ethereum/` 中有一个可部署到 Ethereum 或 L2 的合约。

<a id="revocation-p2p"></a>

## 吊销（P2P）

- 已签名的 **RevocationRecord**（参见 [spec/DCP-01.md](../spec/DCP-01.md)）声明某个智能体（或签名者）已被吊销。
- 验证者维护一组**本地**的已签名 RevocationRecord（来自文件、对等方、IPFS，或以哈希锚定在链上）。他们据此检查 bundle 的签名者或 agent_id。没有中央吊销服务器。
- 本地吊销检查命令（例如 `dcp verify-revocation <signed_bundle> <revocation_record.json>`）是一种可能的工具；参考 CLI 中没有它。

<a id="jurisdictional-revocation-list"></a>

## 司法辖区吊销列表

司法辖区（政府、监管机构或经认可的签发方）可以发布一份**已签名的吊销列表**——一个列出该辖区内已被吊销智能体的 JSON 文件。

**建议的格式：**

```json
{
  "issuer": "authority-us-ai-registry",
  "jurisdiction": "US",
  "updated_at": "2026-02-07T00:00:00Z",
  "entries": [
    { "agent_id": "agent-abc-123", "revoked_at": "2026-01-15T12:00:00Z", "reason_hash": "sha256:..." }
  ],
  "signature": {
    "alg": "ed25519",
    "public_key_b64": "...",
    "sig_b64": "..."
  }
}
```

**发布：** 放在一个众所周知的 URL 上，例如 `https://<authority>/.well-known/dcp-revocations.json`。这不是强制的，而是一种约定。任何 URL 都可以。

上面的格式是一种建议的设计。本仓库中没有任何工具生成它或检查其签名。

**参考实现：** 本仓库中的 `services/revocation/`（Docker 镜像 `ghcr.io/dcp-ai-protocol/dcp-ai/revocation:latest`，Fly.io 配置位于 `deploy/fly/revocation.toml`）在 `/.well-known/dcp-revocations.json` 上提供另一种列表：`{ dcp_version, updated_at, revocations, kid_revocations }`，列表本身**没有签名**。读取它的验证者需要信任该 URL 的运营方以及传输渠道（HTTPS，以及准入吊销信息源发送的可选 `Authorization` 头）。准入配置把这种格式当作拒绝列表读取，无法获取时会失败，并且从不把缺失的回答视为“未吊销”（[ADMISSION.md](ADMISSION.md#revocation-sources)）。

**建议的集成方式：** 运营方为相关司法辖区选择一个受信任的机构和 URL；SDK 不会根据 RPR 的 `jurisdiction` 字段去发现机构。对于上文建议的已签名格式，应用必须用通过其他渠道获得信任的密钥来验证签发方的签名，而不是信任列表自身提供的密钥。然后，它在条目中查找 bundle 的 `agent_id` 或签名者，并拒绝已被吊销的 bundle。现有的准入信息源使用的则是上文描述的未签名参考拒绝列表。缓存列表的新近程度只到上一次获取为止：如果无法获取足够新的列表，就拒绝继续。

**需要什么：** 一个由 Web 服务器或 CDN 提供、由签发方保持更新的 JSON 文件。

<a id="jurisdictional-transparency-log"></a>

## 司法辖区透明度日志

司法辖区或经认可的运营方可以运营一个**透明度日志**——一个以 Merkle 树为基础、只追加的日志，记录在该辖区内经过验证的智能体的 `bundle_hash` 值。其灵感来自 Certificate Transparency（RFC 6962）。

**存储什么：** 每个条目只存储 `bundle_hash`（十六进制 SHA-256）和一个时间戳。没有 agent_id，没有 human_id，没有 bundle 内容。这限制了日志所透露的信息，但哈希并不是匿名的：任何持有某个 bundle 的人都可以检查它是否被记录，同一个哈希会把携带它的条目联系起来。

**建议的 API：**

- `POST /add` — 接收 `{ bundle_hash }`；返回 `{ log_index, timestamp }`。
- `GET /proof/:log_index` — 返回 Merkle 包含证明（兄弟哈希数组 + 当前根）。
- `GET /root` — 返回当前的 Merkle 根和日志大小。
- `GET /root/signed` — 返回由日志运营方签名的根（用于审计）。

**日志条目的验证：** 验证者（从智能体持有者或日志处）收到 `bundle_hash` + `log_index` + `merkle_proof`。验证者在本地对照已签名的根检查 Merkle 包含证明。如果验证者有一个较新的已签名根，就不需要实时调用日志的 API。

**锚定日志根：** 日志运营方可以定期把已签名的根锚定到 Bitcoin（通过 OP_RETURN）或 Ethereum（通过合约事件），以获得独立于运营方服务器的公开不可变性。

**日志的 anchor_receipt：** `{ log_url, log_index, merkle_proof, root_anchor: { chain, tx_id, block_height } }`。

**需要什么：** 一台带持久化存储（SQLite 或 PostgreSQL）的服务器、运营方的签名密钥，以及比对根的审计者。Google 的 [Trillian](https://github.com/google/trillian) 是这种模式的一个开源实现。

**参考实现：** 本仓库提供 `services/transparency-log/`（源码）以及对应的 Docker 镜像 `ghcr.io/dcp-ai-protocol/dcp-ai/transparency-log:latest`。它用 Ed25519 签署树头，并在兄弟日志之间提供 gossip，使分视图攻击可以被发现（DCP-03 §4）。它把日志保存在内存中，因此重启会清空日志。Fly.io 配置位于 `deploy/fly/transparency-log.toml`。

<a id="comparison-anchoring-methods"></a>

## 比较（锚定方式）

本仓库没有测量费用；费用随各条链的市场而变化，因此请在选择前核实。

1. **仅透明度日志**（无区块链）— 运营方签署根。没有链上费用。信任落在运营方 + 审计者身上。适用于运营方是受信任机构（例如政府）的情况。
2. **透明度日志 + Bitcoin 批量锚定** — 日志累积条目；每 N 小时把根锚定到 Bitcoin（一笔 OP_RETURN 交易）。费用按交易支付，而不是按条目支付，因此由整个批次分摊。为整个全国性日志提供公开的不可变性。
3. **每个哈希一笔 Bitcoin OP_RETURN** — 每个 bundle_hash 一笔交易，即每个哈希一笔费用。只适用于低交易量或高价值的 bundle。
4. **Ethereum L2（Arbitrum、Base、Optimism）** — 每个哈希或每个批次根一个事件，用 L2 的 gas 支付。可通过智能合约查询。
5. **Ethereum 主网** — 主网上每个事件的 gas。只有在需要从主网合约进行链上查询时才合理。

对于政府规模的日志，选项 2（日志 + Bitcoin 批量）为每个批次支付一笔费用，换取公开可验证性。

<a id="published-artefacts-current-state"></a>

## 已发布的构件（当前状态）

协议不需要以下任何一项——它们只是便利性的发行物，使运营方不必从源码构建。完全在仓库之外运行一切仍然得到充分支持。

- **仓库：** `github.com/dcp-ai-protocol/dcp-ai`（Apache-2.0）。任何人都可以镜像或分叉。
- **SDK：** 发布在各自的原生注册表上（npm、PyPI、crates.io、Go 模块）。它们的版本各不相同，可能落后于 `main`：参见 [README](../README.md) 以及各 SDK 的 *Release status*。
- **服务镜像：** 四个可选服务（验证、锚定、透明度日志、吊销注册表）以多架构 Docker 镜像的形式发布在 GHCR 上。它们是参考服务：把状态保存在内存中（吊销服务可以使用文件），锚定服务尚未向链上提交（[OPERATOR_GUIDE.md](OPERATOR_GUIDE.md#reference-services-keep-state-in-memory-only)）：
    - `ghcr.io/dcp-ai-protocol/dcp-ai/verification`
    - `ghcr.io/dcp-ai-protocol/dcp-ai/anchor`
    - `ghcr.io/dcp-ai-protocol/dcp-ai/transparency-log`
    - `ghcr.io/dcp-ai-protocol/dcp-ai/revocation`
- **智能合约：** `contracts/ethereum/DCPAnchor.sol` 是一个 Foundry 项目，可部署到 Base、Optimism 或 Arbitrum。参见 [`contracts/ethereum/DEPLOY.md`](../contracts/ethereum/DEPLOY.md)。
- **没有规范的注册中心：** DCP-AI 不运营任何中央“DCP 注册中心”或托管的验证端点。`dcp-ai.org` 提供落地页、文档、playground 以及用于 VC 的 JSON-LD 上下文（`/credentials/v2`）；它不为任何人验证 bundle。
- **总结：** 部署所需的每一块基础设施，要么是你嵌入的 SDK，要么是你自己运行的容器。锚定仍然使用现有的公共链；已发布的构件都不是协议的依赖。

---

<a id="v20-storage-extensions"></a>

## V2.0 存储扩展

DCP v2.0 引入了双哈希链、PQ 检查点和扩展的 bundle 清单，为后量子时代做好准备。

<a id="dual-hash-chains"></a>

### 双哈希链

V2.0 的审计轨迹维护两条并行的哈希链，实现纵深防御：

```
Entry N:
  primary_hash   = SHA-256(canonical(entry_N))
  secondary_hash = SHA3-256(canonical(entry_N))
  prev_hash      = SHA-256(canonical(entry_N-1))       // or "GENESIS"
  prev_hash_secondary = SHA3-256(canonical(entry_N-1)) // or "GENESIS"
```

次级链是可选的（审计条目模式中的 `prev_hash_secondary` 和 `intent_hash_secondary`）。规范要求在存在次级链时对其进行独立验证（[VERIFICATION.md，V2-11](../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present)）。这是一种纵深防御设计：其保护作用取决于实际检查两条链并保存受信任的承诺。

**实现缺口（2026 年 10 月 25 日）：** 当前的 TypeScript、Python、Go 和 Rust V2 bundle 验证器会检查主 `prev_hash` 链和主 Merkle 根，但不会重新计算次级链或 `audit_merkle_root_secondary`。不要把 bundle 验证成功解读为次级链一致的证据。实验性候选的路由复用这些验证检查；选择加入候选并不能弥补这一缺口。

Merkle 树基于主（SHA-256）链计算。基于 SHA3-256 哈希的次级 Merkle 根以 `audit_merkle_root_secondary` 的形式包含在 bundle 清单中。

<a id="pq-checkpoints"></a>

### PQ 检查点

V2.0 在审计轨迹之上引入了后量子检查点：覆盖一段审计条目、由智能体用复合签名（Ed25519 + ML-DSA-65）签署的记录。其结构见 [`schemas/v2/pq_checkpoint.schema.json`](../schemas/v2/pq_checkpoint.schema.json)：

```json
{
  "checkpoint_id": "ckpt:...",
  "session_nonce": "a1b2c3d4e5f67890...",
  "event_range": { "from_audit_id": "audit:...", "to_audit_id": "audit:...", "count": 10 },
  "merkle_root": "sha256:...",
  "composite_sig": {
    "classical": { "alg": "ed25519", "kid": "...", "sig_b64": "..." },
    "pq": { "alg": "ml-dsa-65", "kid": "...", "sig_b64": "..." },
    "binding": "pq_over_classical"
  }
}
```

bundle 在 `pq_checkpoints` 中携带其检查点，已签名的清单列出它们的 ID；验证者按照 `spec/VERIFICATION.md` V2-12 检查它们。

检查点频率取决于安全等级：

| 等级 | 检查点间隔 | 目的 |
|------|-------------------|---------|
| Routine | 每 50 个事件 | 轻量保证 |
| Standard | 每 10 个事件 | 定期 PQ 验证 |
| Elevated | 每个事件 | 持续的 PQ 完整性 |
| Maximum | 每个事件 + 验证 | 即时 PQ 验证 |

在使用受信任的 PQ 验证密钥且 PQ 签名有效的前提下，检查点可以认证其覆盖的审计条目的 Merkle 承诺，即使经典签名后来被攻破。检查点模式没有时间戳字段，该签名也不能证明事件发生的时间。

<a id="v20-bundle-manifest"></a>

### V2.0 bundle 清单

V2.0 bundle 包含一个预先计算了所有构件哈希的清单：

```json
{
  "dcp_bundle_version": "2.0",
  "manifest": {
    "session_nonce": "a1b2c3d4e5f67890...",
    "rpr_hash": "sha256:...",
    "passport_hash": "sha256:...",
    "intent_hash": "sha256:...",
    "policy_hash": "sha256:...",
    "audit_merkle_root": "sha256:...",
    "audit_merkle_root_secondary": "sha3-256:...",
    "audit_count": 50,
    "pq_checkpoints": ["ckpt:..."]
  }
}
```

字段与 [`schemas/v2/bundle_manifest.schema.json`](../schemas/v2/bundle_manifest.schema.json) 中的一致；它还有可选的 `session_issued_at`、`session_expires_at` 和 `intended_verifier`。`session_nonce`（256 位随机数）把所有构件绑定到单个会话，因此一个会话的构件不能混入另一个会话。它并不能阻止整个 bundle 被再次出示（[SECURITY_MODEL.md](SECURITY_MODEL.md#9-cross-artifact-replay)）。清单包含在 bundle 签名中，从而确保其完整性。

<a id="bundle-size-considerations-v20"></a>

### bundle 大小方面的考虑（V2.0）

由于复合签名和双哈希，V2.0 bundle 比 V1 更大：

| 组成部分 | V1 大小 | V2 大小 | 说明 |
|-----------|---------|---------|-------|
| Ed25519 签名 | 64 字节 | 64 字节 | 不变 |
| ML-DSA-65 签名 | — | 约 3,300 字节 | V2 新增 |
| SHA-256 哈希 | 每个约 32 字节 | 每个约 32 字节 | 不变 |
| SHA3-256 哈希 | — | 每个约 32 字节 | V2 新增 |
| PQ 检查点 | — | 约 3,500 字节 | V2 新增 |
| 清单 | — | 约 500 字节 | V2 新增 |
| **典型 bundle** | **约 1–2 KB** | **约 10–50 KB** | 估算值；取决于审计轨迹长度和等级（规范 §14.1） |

对于带宽受限的环境，V2.0 定义了比 JSON 更小的 CBOR 线上格式（RFC 8949）；本仓库尚未发布其节省幅度的测量结果。

<a id="anchoring-v20-bundles"></a>

### 锚定 V2.0 bundle

锚定模型保持不变（链上只有哈希），但 V2.0 增加了：
- **双哈希锚定**（设计）：可以在 SHA-256 哈希旁边再锚定 bundle 的 SHA3-256 哈希；本仓库中尚无任何构件或工具对其作出定义
- **PQ 签名的日志根**（设计）：透明度日志的根可以带有复合签名；参考日志只用 Ed25519 签名
- **OP_RETURN 格式**（建议的约定）：`dcp:v2:<sha256_hex>`（对应 V1 的 `dcp:v1:<sha256_hex>`）

后量子算法的符合性详情参见 [NIST_CONFORMITY.md](NIST_CONFORMITY.md)。
迁移现有的已锚定 V1 数据，参见 [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md)。

<a id="reference"></a>

## 参考资料

- 验证检查清单：[spec/VERIFICATION.md](../spec/VERIFICATION.md)
- bundle 格式：[spec/BUNDLE.md](../spec/BUNDLE.md)
- 技术架构：[TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md)
