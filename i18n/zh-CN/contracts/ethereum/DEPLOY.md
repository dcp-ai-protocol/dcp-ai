<sub>[English](../../../../contracts/ethereum/DEPLOY.md) · **中文** · [Español](../../../es/contracts/ethereum/DEPLOY.md) · [日本語](../../../ja/contracts/ethereum/DEPLOY.md) · [Português](../../../pt-BR/contracts/ethereum/DEPLOY.md)</sub>

<a id="deploying-dcpanchorsol"></a>

# 部署 `DCPAnchor.sol`

> 本文是[英文版](../../../../contracts/ethereum/DEPLOY.md)的参考译文，更新于 25/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

`DCPAnchor.sol` 在兼容 EVM 的 L2 上记录 bundle 哈希：这是一份可发现篡改、任何人都可验证的记录，表明某个哈希最迟在某个区块之前已被提交。它不检查哈希背后的 bundle。本指南介绍如何在 **Base** 上部署它，并附有其他链的说明。

> **参考锚定服务目前还不使用该合约。** `services/anchor/` 在内存中保存本地记录（`tx_hash: null`）：它不读取任何 RPC URL、钱包密钥或合约地址。部署之后，由你自己的代码或 `cast` 向合约锚定，使用你保存在 keystore 或密钥管理器中的提交者密钥。本指南中发送交易的命令（`--broadcast`、`cast send`）会在主网上花费真实资金，编写本页时没有运行它们。

<a id="what-you-need"></a>

## 你需要什么

1. **Foundry**（Solidity 工具集）。安装：
   ```bash
   curl -L https://foundry.paradigm.xyz | bash
   foundryup
   ```
2. 一个在目标链上有一些 gas 的**钱包**。手续费随网络而变化；部署前请先查看。
3. 如果你希望源码自动验证、让 ABI 显示在 Basescan/Etherscan 上，需要一个**区块浏览器 API 密钥**（免费）。在 [basescan.org/apis](https://basescan.org/apis) 注册。

<a id="configure"></a>

## 配置

```bash
cd contracts/ethereum
cp .env.example .env
# Edit .env with your RPC URL and BASESCAN_API_KEY, and remove or comment out its PRIVATE_KEY line
```

把部署者密钥保存在 Foundry 的 keystore 中，而不是 `.env` 中：
```bash
cast wallet import my-deployer --interactive   # paste the key once; stored encrypted on disk
```
下面的命令使用 `--account my-deployer` 签名。

`script/Deploy.s.sol` 如何选择密钥：它用 `vm.envOr("PRIVATE_KEY", uint256(0))` 读取 `PRIVATE_KEY`。那里一个有效的非零 `uint256` 优先于 keystore，脚本会用它广播。当 `PRIVATE_KEY` 不存在或为 `0` 时，它调用 `vm.startBroadcast()`，此时 `--account`（或 `--sender`）参数生效。格式错误的占位符，例如 `.env.example` 中的 `PRIVATE_KEY=0x` 这一行，可能无法解析。因此，要使用 keystore，请在 `source .env` 之前删除或注释掉你复制的 `.env` 中的 `PRIVATE_KEY` 行。脚本不读取 `DEPLOYER_ACCOUNT`：请自行传入 `--account`（例如 `--account "$DEPLOYER_ACCOUNT"`）。

如果缺少 `lib/forge-std`，请安装 `forge-std`：
```bash
git clone --depth 1 https://github.com/foundry-rs/forge-std.git lib/forge-std
```

<a id="test-locally"></a>

## 本地测试

```bash
forge test -vv
```

预期结果：6 个测试在几秒内通过。

<a id="deploy-to-a-testnet-first-base-sepolia"></a>

## 先部署到测试网（Base Sepolia）

```bash
source .env
forge script script/Deploy.s.sol \
  --rpc-url base_sepolia \
  --account my-deployer \
  --broadcast \
  --verify
```

你会在 [sepolia.basescan.org](https://sepolia.basescan.org/) 上得到一笔交易和一个合约地址。通过从 CLI 执行一次锚定来测试它：

```bash
ADDR=0x...   # the deployed address

# Register a separate submitter (the deployer is already authorised; skip if it submits)
# cast send $ADDR "addSubmitter(address)" 0xYOUR_SUBMITTER \
#   --rpc-url base_sepolia --account my-deployer

# Anchor a dummy bundle hash (a full bytes32: 0x and 64 hex digits)
HASH=0x1111111111111111111111111111111111111111111111111111111111111111
cast send $ADDR "anchorBundle(bytes32)" $HASH \
  --rpc-url base_sepolia --account my-deployer

# Confirm: (exists, timestamp, submitter)
cast call $ADDR "isAnchored(bytes32)(bool,uint256,address)" $HASH --rpc-url base_sepolia
```

<a id="deploy-to-base-mainnet"></a>

## 部署到 Base 主网

当测试网部署运行正常时：

```bash
source .env
forge script script/Deploy.s.sol \
  --rpc-url base \
  --account my-deployer \
  --broadcast \
  --verify \
  --priority-gas-price 1gwei
```

把地址保存在持久的地方（README、运维 wiki，以及你的验证服务器的 `.well-known/dcp-capabilities.json`）。

<a id="anchoring-to-it"></a>

## 向它锚定

锚定服务没有连接到该合约：它不读取 `ANCHOR_RPC_URL`、`ANCHOR_PRIVATE_KEY` 或 `ANCHOR_CONTRACT`，因此不要给它任何钱包密钥。在连接之前，请像上面的测试网测试那样，从你自己的代码或用 `cast` 进行锚定，并使用 Foundry keystore 中的提交者账户（`--account`），而不是在命令行中使用原始密钥。

最佳做法：提交者不是所有者。所有者密钥放在冷存储中，只用于所有者的函数：`addSubmitter`、`removeSubmitter`、`pause`、`unpause` 和 `transferOwnership`。提交者是一个余额不多、定期充值的热密钥。部署者就是所有者，同时也被授权提交。在部署前设置 `INITIAL_SUBMITTER`，即可在同一次运行中授权一个单独的提交者。

<a id="other-chains"></a>

## 其他链

上面所有的部署命令在其他 EVM L2 上都可以原样使用。替换 `--rpc-url` 的别名即可（列表在 `foundry.toml` → `rpc_endpoints` 中）：

| 链 | 别名 | 说明 |
|---|---|---|
| **Base** | `base` | Coinbase 的 L2 |
| Optimism | `optimism` | 与 Base 相同的 OP Stack |
| Arbitrum | `arbitrum` | Arbitrum One |
| Sepolia | `sepolia` | Ethereum 测试网（没有真实资金） |
| Base Sepolia | `base_sepolia` | Base 测试网（没有真实资金）；推荐的预演环境 |

每个别名都从环境中读取其 RPC URL（`BASE_RPC_URL`、`OPTIMISM_RPC_URL`、…）。本仓库没有测量过其中任何一条链的手续费。

<a id="upgrades--migrations"></a>
<a id="upgrades-migrations"></a>

## 升级 / 迁移

`DCPAnchor.sol` 在设计上**不可升级**：锚定必须不可变，安全模型才能成立。如果需要更改合约（例如增加新事件），请部署一个新合约，把提交者指向新地址，并把旧合约保留为历史参考。下游验证者可以通过其本地的锚定合约注册表同时读取两者。

<a id="rollback-plan"></a>

## 回退计划

- 在 DCP 协议中，锚定是可选的，但使用方的策略可能要求锚定。如果某个合约无法再使用（提交者被攻破、链故障），就停止向它提交。只有在验证者自己的策略明确允许时，它们才会转而使用透明日志或普通的审计链；本仓库没有实现这样的故障切换。（锚定服务没有 `disabled` 模式；它的模式是 `individual` 和 `batch`，而且它本来就不向链上提交任何内容。）
- 轮换提交者：`cast send <ADDR> "removeSubmitter(address)" <OLD> --rpc-url <alias> --account <owner keystore>`，然后用同样的方式添加新的提交者。
- 轮换所有者：`transferOwnership` 不会更改 `authorizedSubmitters`，因此前任所有者（部署时被授权）仍然可以提交。转移之后，由新所有者用 `removeSubmitter` 将其移除。
- 在紧急情况下暂停所有新的锚定：`cast send <ADDR> "pause()" --rpc-url <alias> --account <owner keystore>`（`unpause()` 恢复锚定）。
