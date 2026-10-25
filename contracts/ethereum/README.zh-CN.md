<sub>[English](README.md) · **中文** · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="dcpanchorsol--smart-contract"></a>
<a id="dcpanchorsol-smart-contract"></a>

# DCPAnchor.sol — 智能合约

> 本文是[英文版](README.md)的参考译文，更新于 25/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

用于在 EVM L2 区块链（Base、Arbitrum、Optimism）上锚定 DCP Citizenship Bundle 哈希的 Solidity 智能合约。支持单个锚定、提交-揭示（commit-reveal）锚定和批量锚定（批次的 Merkle 根）。

参考锚定服务（`services/anchor/`）目前还不会调用该合约；参见[与锚定服务集成](#integration-with-the-anchoring-service)。

<a id="layout"></a>

## 目录结构

```
contracts/ethereum/
  src/DCPAnchor.sol           the contract
  test/DCPAnchor.t.sol        forge tests (6 passing)
  script/Deploy.s.sol         deployment script
  foundry.toml                Foundry project config
  remappings.txt              import remappings
  .env.example                template for deployment secrets
  DEPLOY.md                   step-by-step deploy guide
```

<a id="quick-start"></a>

## 快速开始

```bash
cd contracts/ethereum
git clone --depth 1 https://github.com/foundry-rs/forge-std.git lib/forge-std
forge test -vv
```

<a id="deploy"></a>

## 部署

完整步骤（Base Sepolia → Base 主网、在 Basescan 上验证、连接 `anchor` 服务）参见 [DEPLOY.md](DEPLOY.md)。

简短版本，需在完成 DEPLOY.md 的 [Configure](DEPLOY.md#configure) 步骤（keystore 账户，从 `.env` 中删除 `PRIVATE_KEY` 行）之后
执行。它会发送交易并在主网上花费资金：
```bash
source .env
forge script script/Deploy.s.sol --rpc-url base --account my-deployer --broadcast --verify
```

<a id="overview"></a>

## 概述

`DCPAnchor` 合约提供一个不可变的链上 bundle 哈希注册表。哈希一经锚定就不能修改或删除，因此该记录表明提交者最迟在其所在区块的时间已对该哈希作出承诺。合约按提交者声明的原样存储 `bytes32`（对于批次还有 `count`）：它不检查该哈希是否属于有效的 bundle，不验证任何签名，也不能证明 bundle 所描述的事件确实发生过。

<a id="contract"></a>

## 合约

**Solidity：** `^0.8.20`  
**许可证头：** `src/DCPAnchor.sol` 和 `script/Deploy.s.sol` 中的 `SPDX-License-Identifier: MIT`（参见[许可证](#license)）  
**目标网络：** Base、Arbitrum、Optimism（或任何 EVM L2）

## API

下面的 Solidity 片段只是示意：`0xabc123...` 之类的值代表完整的 `bytes32` 哈希。

<a id="admin-functions"></a>

### 管理函数

#### `addSubmitter(address submitter)`

添加一个授权提交者。只有合约所有者可以调用。

#### `removeSubmitter(address submitter)`

移除一个授权提交者。只有合约所有者可以调用。

#### `pause()` / `unpause()`

紧急暂停机制。暂停时，所有锚定函数都会回滚。只有合约所有者可以调用。

#### `transferOwnership(address newOwner)`

转移合约所有权。它不会更改 `authorizedSubmitters`：构造函数作为部署者授权的前任所有者，在新所有者为其调用
`removeSubmitter` 之前，仍然是授权提交者。当前所有者总能通过提交者检查，即使在 `removeSubmitter(owner)` 之后也是如此。
轮换所有者时，也请移除前任所有者的提交者条目。

<a id="write-functions"></a>

### 写入函数

#### `anchorBundle(bytes32 bundleHash)`

在低风险场景下供受信任提交者直接锚定。

- **要求** 授权提交者或所有者
- **回滚** 如果 `bundleHash` 为零
- **回滚** 如果该哈希已被锚定
- **回滚** 如果合约已暂停
- **触发** `BundleAnchored(bundleHash, msg.sender, block.timestamp)`

```solidity
dcpAnchor.anchorBundle(0xabc123...);
```

<a id="commit-reveal-front-running-protection"></a>

<a id="commit-reveal-limited-front-running-protection"></a>

#### 提交-揭示（有限的防抢跑）

在需要担心抢跑的场景中，请使用两阶段的提交-揭示流程。提交会在揭示之前隐藏 bundle 哈希，并把揭示绑定到作出提交的地址。
它只预留 `commitHash`，而不预留 bundle 哈希：`anchorBundle` 仍对每个授权提交者开放，并且不查看承诺，因此另一个知道该哈希的
授权提交者可以在你揭示之前直接锚定它。这并不是排他的预留。

**阶段 1 — `commit(bytes32 commitHash)`**

提交 `keccak256(abi.encodePacked(bundleHash, salt, msg.sender))` 以预留一个位置。

**阶段 2 — `revealAndAnchorBundle(bytes32 bundleHash, bytes32 salt)`**

揭示原始哈希和盐以完成锚定。如果提交是在区块 `b` 中被打包的，揭示需要满足 `block.number > b + COMMIT_DELAY` 且 `block.number <= b + COMMIT_EXPIRY`：按下面的常量，即从区块 `b + 2` 到区块 `b + 256`（含两端）。示例中的 `keccak256("random-salt")` 是确定性的；实际使用时，盐必须随机且不可预测，并在揭示之前保密。

```solidity
bytes32 salt = keccak256("random-salt");
bytes32 commitHash = keccak256(abi.encodePacked(bundleHash, salt, msg.sender));
dcpAnchor.commit(commitHash);
// ... wait until block.number > commit block + COMMIT_DELAY (b + 2 or later, b + 256 at the latest) ...
dcpAnchor.revealAndAnchorBundle(bundleHash, salt);
```

#### `anchorBatch(bytes32 merkleRoot, uint256 count)`

锚定代表一批 bundle 的 Merkle 根。

- **要求** 授权提交者或所有者
- **回滚** 如果 `merkleRoot` 为零
- **回滚** 如果 `count` 为零或超过 `MAX_BATCH_SIZE`（10000）
- **回滚** 如果该 Merkle 根已被锚定
- **回滚** 如果合约已暂停
- **触发** `BatchAnchored(merkleRoot, count, msg.sender, block.timestamp)`

```solidity
dcpAnchor.anchorBatch(0xdef456..., 50);
```

<a id="read-functions"></a>

### 读取函数

#### `isAnchored(bytes32 bundleHash) → (bool exists, uint256 timestamp, address submitter)`

查询某个 bundle 哈希是否已被锚定。

```solidity
(bool exists, uint256 ts, address submitter) = dcpAnchor.isAnchored(0xabc123...);
```

#### `isBatchAnchored(bytes32 merkleRoot) → (bool exists, uint256 timestamp, uint256 count, address submitter)`

查询某个批次的 Merkle 根是否已被锚定。

```solidity
(bool exists, uint256 ts, uint256 count, address submitter) = dcpAnchor.isBatchAnchored(0xdef456...);
```

<a id="storage"></a>

### 存储

| 变量 | 类型 | 说明 |
|----------|------|-------------|
| `owner` | `address` | 合约所有者 |
| `paused` | `bool` | 紧急暂停状态 |
| `authorizedSubmitters` | `mapping(address => bool)` | 授权提交者 |
| `bundles` | `mapping(bytes32 => AnchorRecord)` | 单个 bundle 记录 |
| `batches` | `mapping(bytes32 => AnchorRecord)` | 批次 Merkle 根记录 |
| `commitments` | `mapping(bytes32 => Commitment)` | 提交-揭示的承诺 |
| `totalAnchors` | `uint256` | 单个锚定的总数 |
| `totalBatches` | `uint256` | 批量锚定的总数 |

<a id="structs"></a>

### 结构体

```solidity
struct AnchorRecord {
    address submitter;   // Who anchored the hash
    uint256 timestamp;   // When it was anchored (block.timestamp)
    uint256 count;       // Number of bundles (1 for individual, N for batch)
    bool exists;         // Whether the record exists
}

struct Commitment {
    address submitter;
    uint256 blockNumber;
    bool revealed;
}
```

<a id="constants"></a>

### 常量

| 常量 | 值 | 说明 |
|----------|-------|-------------|
| `MAX_BATCH_SIZE` | `10000` | 每批 bundle 的最大数量 |
| `COMMIT_DELAY` | `1` | 揭示需要 `block.number > b + COMMIT_DELAY`，`b` 为提交所在区块（即从 `b + 2` 开始） |
| `COMMIT_EXPIRY` | `256` | 揭示需要 `block.number <= b + COMMIT_EXPIRY`；超过之后承诺即过期 |

<a id="events"></a>

### 事件

```solidity
event BundleAnchored(bytes32 indexed bundleHash, address indexed submitter, uint256 timestamp);
event BatchAnchored(bytes32 indexed merkleRoot, uint256 bundleCount, address indexed submitter, uint256 timestamp);
event CommitSubmitted(bytes32 indexed commitHash, address indexed submitter);
event SubmitterAdded(address indexed submitter);
event SubmitterRemoved(address indexed submitter);
event Paused(address indexed by);
event Unpaused(address indexed by);
event OwnerTransferred(address indexed oldOwner, address indexed newOwner);
```

<a id="deploy-1"></a>
<a id="deploy_1"></a>

## 部署

<a id="with-hardhat"></a>

### 使用 Hardhat

本仓库没有 Hardhat 项目；在你自己的、源码中包含 `DCPAnchor.sol` 的 Hardhat 项目中：

```javascript
const { ethers } = require("hardhat");

async function main() {
  const DCPAnchor = await ethers.getContractFactory("DCPAnchor");
  const anchor = await DCPAnchor.deploy();
  await anchor.waitForDeployment();
  console.log("DCPAnchor deployed to:", await anchor.getAddress());
}

main();
```

<a id="with-foundry"></a>

### 使用 Foundry

从 `contracts/ethereum` 运行（或者像 [DEPLOY.md](DEPLOY.md) 中那样使用 `script/Deploy.s.sol`）。它会发送交易并花费资金；请优先使用 keystore 账户（`--account`），而不是原始密钥：

```bash
forge create --rpc-url base_sepolia \
  --account my-deployer \
  --broadcast \
  src/DCPAnchor.sol:DCPAnchor
```

<a id="recommended-l2-networks"></a>

### 推荐的 L2 网络

| 网络 | 类型 |
|---------|------|
| **Base** | Optimistic Rollup |
| **Arbitrum** | Optimistic Rollup |
| **Optimism** | Optimistic Rollup |

本仓库没有测量过各网络的手续费；选择之前请查看当前手续费。

<a id="full-example--anchor-and-verify"></a>
<a id="full-example-anchor-and-verify"></a>

## 完整示例 — 锚定与核查

该示例锚定一个你已经验证过的已签名 V1 bundle 的 `bundle_hash`。之后 `isAnchored` 只能显示该哈希何时、由谁锚定：它并不是对该
bundle 的 DCP 验证。

```javascript
// Fragment: CONTRACT_ADDRESS, ABI and signedBundle come from your deployment and application
const { ethers } = require("ethers");

// Connect
const provider = new ethers.JsonRpcProvider(process.env.ANCHOR_RPC_URL);
const wallet = new ethers.Wallet(process.env.ANCHOR_PRIVATE_KEY, provider);
const anchor = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

// Anchor the bundle's hash: the SHA-256 of its canonical form, as a signed V1 bundle carries it
// in signature.bundle_hash ("sha256:<hex>"), not a hash of JSON.stringify output
const bundleHash = "0x" + signedBundle.signature.bundle_hash.slice("sha256:".length);
const tx = await anchor.anchorBundle(bundleHash);
await tx.wait();
console.log("Anchored in tx:", tx.hash);

// Verify
const [exists, timestamp, submitter] = await anchor.isAnchored(bundleHash);
console.log("Exists:", exists);
console.log("Timestamp:", new Date(Number(timestamp) * 1000));
console.log("Submitter:", submitter);
```

<a id="integration-with-the-anchoring-service"></a>

## 与锚定服务集成

`services/anchor/` 中的 HTTP 服务本应调用该合约，但**链上提交尚未实现**。实现之后：

- **单个模式：** 会为每个哈希调用 `anchorBundle()`
- **批量模式：** 会累积哈希、计算 Merkle 根并调用 `anchorBatch()`

目前它在内存中保存本地记录（`tx_hash: null`），不读取 `ANCHOR_RPC_URL`、`ANCHOR_PRIVATE_KEY` 或 `ANCHOR_CONTRACT`；不要给它任何钱包密钥（[services/anchor/README.md](../../services/anchor/README.md)）。

<a id="development"></a>

## 开发

```bash
# From contracts/ethereum, with Foundry
forge build
forge test
```

<a id="license"></a>

## 许可证

本仓库采用 Apache-2.0 许可证。Solidity 文件带有各自的 `SPDX-License-Identifier: MIT` 许可证头；本页不会对它们重新许可。
