# Deploying `DCPAnchor.sol`

`DCPAnchor.sol` records bundle hashes on an EVM-compatible L2: a tamper-evident, publicly verifiable record that a hash was submitted by a given block. It does not check the bundle behind the hash. This guide walks through deploying it on **Base**, with notes for other chains.

> **The reference anchor service does not use the contract yet.** `services/anchor/` keeps local records in memory with `tx_hash: null`: it reads no RPC URL, wallet key or contract address. Once deployed, the contract is anchored to by your own code or by `cast`, with a submitter key you keep in a keystore or secrets manager. This guide's commands that send transactions (`--broadcast`, `cast send`) spend real funds on mainnet and were not run for this page.

## What you need

1. **Foundry** (toolkit for Solidity). Install:
   ```bash
   curl -L https://foundry.paradigm.xyz | bash
   foundryup
   ```
2. **A wallet** with some gas on the target chain. Fees change with the network; check them before deploying.
3. **A block-explorer API key** (free) if you want the source auto-verified so the ABI shows on Basescan/Etherscan. Register at [basescan.org/apis](https://basescan.org/apis).

## Configure

```bash
cd contracts/ethereum
cp .env.example .env
# Edit .env with your RPC URL and BASESCAN_API_KEY, and remove or comment out its PRIVATE_KEY line
```

Keep the deployer key in a Foundry keystore, not in `.env`:
```bash
cast wallet import my-deployer --interactive   # paste the key once; stored encrypted on disk
```
The commands below sign with `--account my-deployer`.

How `script/Deploy.s.sol` picks the key: it reads `PRIVATE_KEY` with `vm.envOr("PRIVATE_KEY", uint256(0))`. A valid non-zero `uint256` there wins over the keystore and the script broadcasts with it. When `PRIVATE_KEY` is absent or `0`, it calls `vm.startBroadcast()` and the `--account` (or `--sender`) flags apply. A malformed placeholder, such as the `PRIVATE_KEY=0x` line that `.env.example` carries, may fail to parse. So, to use the keystore, remove or comment out the `PRIVATE_KEY` line in your copied `.env` before `source .env`. The script does not read `DEPLOYER_ACCOUNT`: pass `--account` yourself (for example `--account "$DEPLOYER_ACCOUNT"`).

Install `forge-std` if `lib/forge-std` is missing:
```bash
git clone --depth 1 https://github.com/foundry-rs/forge-std.git lib/forge-std
```

## Test locally

```bash
forge test -vv
```

Expected: 6 tests pass in a few seconds.

## Deploy to a testnet first (Base Sepolia)

```bash
source .env
forge script script/Deploy.s.sol \
  --rpc-url base_sepolia \
  --account my-deployer \
  --broadcast \
  --verify
```

You get a transaction on [sepolia.basescan.org](https://sepolia.basescan.org/) and a contract address. Test it by running an anchor from the CLI:

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

## Deploy to Base mainnet

When the testnet deploy is healthy:

```bash
source .env
forge script script/Deploy.s.sol \
  --rpc-url base \
  --account my-deployer \
  --broadcast \
  --verify \
  --priority-gas-price 1gwei
```

Save the address somewhere durable (README, ops wiki, and the `.well-known/dcp-capabilities.json` of your verification server).

## Anchoring to it

The anchor service is not wired to the contract: it does not read `ANCHOR_RPC_URL`, `ANCHOR_PRIVATE_KEY` or `ANCHOR_CONTRACT`, so do not give it a wallet key. Until it is, anchor from your own code or with `cast`, as in the testnet test above, using a submitter account from a Foundry keystore (`--account`) rather than a raw key on the command line.

Best practice: the submitter is not the owner. The owner key sits in cold storage and is used only for the owner's functions: `addSubmitter`, `removeSubmitter`, `pause`, `unpause` and `transferOwnership`. The submitter is a hot key with a modest balance that gets topped up periodically. The deployer is the owner and is also authorised to submit. Set `INITIAL_SUBMITTER` before deploying to authorise a separate submitter in the same run.

## Other chains

All the deploy commands above work unchanged on the other EVM L2s. Swap the `--rpc-url` alias (the list is in `foundry.toml` → `rpc_endpoints`):

| Chain | Alias | Notes |
|---|---|---|
| **Base** | `base` | Coinbase L2 |
| Optimism | `optimism` | Same OP Stack as Base |
| Arbitrum | `arbitrum` | Arbitrum One |
| Sepolia | `sepolia` | Ethereum testnet (no real funds) |
| Base Sepolia | `base_sepolia` | Base testnet (no real funds); the recommended dress rehearsal |

Each alias reads its RPC URL from the environment (`BASE_RPC_URL`, `OPTIMISM_RPC_URL`, …). This repository has not measured fees on any of them.

## Upgrades / migrations

`DCPAnchor.sol` is **not upgradeable** by design — anchors need to be immutable for the security model to hold. If you need to change the contract (e.g. add a new event), deploy a fresh contract, point your submitters at the new address, and leave the old contract as a historical reference. Downstream verifiers can read from both via their local registry of anchor contracts.

## Rollback plan

- Anchoring is optional in the DCP protocol, but a consumer's policy may require it. If a contract becomes unusable (compromised submitter, chain outage), stop submitting to it. Verifiers fall back to the transparency log or the plain audit chain only where their own policy explicitly allows it; this repository implements no such failover. (The anchor service has no `disabled` mode; its modes are `individual` and `batch`, and it submits nothing on chain anyway.)
- To rotate submitters: `cast send <ADDR> "removeSubmitter(address)" <OLD> --rpc-url <alias> --account <owner keystore>`, then add the new one the same way.
- To rotate the owner: `transferOwnership` does not touch `authorizedSubmitters`, so the previous owner (authorized at deployment) can still submit. After the transfer, the new owner removes it with `removeSubmitter`.
- To pause all new anchors in an emergency: `cast send <ADDR> "pause()" --rpc-url <alias> --account <owner keystore>` (`unpause()` resumes them).
