# Deploying `DCPAnchor.sol`

The `anchor` service (`services/anchor/`) writes bundle hashes to an EVM-compatible L2 for tamper-evident, publicly-verifiable proof of existence. This guide walks through deploying the contract on **Base** (recommended — cheapest gas, ~$0.01-0.10 per anchor), with notes for other chains.

## What you need

1. **Foundry** (toolkit for Solidity). Install:
   ```bash
   curl -L https://foundry.paradigm.xyz | bash
   foundryup
   ```
2. **A wallet** with some gas on the target chain. For Base mainnet, ~$1 of ETH is plenty for the deployment plus a few hundred anchors.
3. **A block-explorer API key** (free) if you want the source auto-verified so the ABI shows on Basescan/Etherscan. Register at [basescan.org/apis](https://basescan.org/apis).

## Configure

```bash
cd contracts/ethereum
cp .env.example .env
# Edit .env with your PRIVATE_KEY, RPC URL, and BASESCAN_API_KEY
```

**For mainnet**, prefer a Foundry keystore over a raw private key:
```bash
cast wallet import my-deployer --interactive   # paste PK once; encrypted on disk
```
Then reference `--account my-deployer` in deploy commands instead of `PRIVATE_KEY`.

Install `forge-std`:
```bash
forge install foundry-rs/forge-std --no-commit
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
  --broadcast \
  --verify
```

You get a transaction on [sepolia.basescan.org](https://sepolia.basescan.org/) and a contract address. Test it by running an anchor from the CLI:

```bash
ADDR=0x...   # the deployed address

# Register yourself as a submitter (deployer is already authorised, skip if same)
# cast send $ADDR "addSubmitter(address)" 0xYOUR_SUBMITTER \
#   --rpc-url base_sepolia --private-key $PRIVATE_KEY

# Anchor a dummy bundle hash
cast send $ADDR "anchorBundle(bytes32)" 0x1234... \
  --rpc-url base_sepolia --private-key $PRIVATE_KEY

# Confirm
cast call $ADDR "isAnchored(bytes32)" 0x1234... --rpc-url base_sepolia
```

## Deploy to Base mainnet

When the testnet deploy is healthy:

```bash
source .env
forge script script/Deploy.s.sol \
  --rpc-url base \
  --broadcast \
  --verify \
  --priority-gas-price 1gwei
```

Expected cost: **~0.0001-0.0005 ETH** (single-digit USD cents on Base).

Save the address somewhere durable (README, ops wiki, and the `.well-known/dcp-capabilities.json` of your verification server).

## Wire the anchor service

Once deployed, point the running `anchor` service at the contract:

```bash
# Docker Compose
# Edit docker/docker-compose.yml under the anchor service:
environment:
  - ANCHOR_RPC_URL=https://mainnet.base.org
  - ANCHOR_PRIVATE_KEY=0x...      # submitter key, NOT the deployer
  - ANCHOR_CONTRACT=0xYOUR_DEPLOYED_ADDRESS
```

```bash
# Fly.io
fly secrets set --app dcp-ai-anchor \
  ANCHOR_RPC_URL="https://mainnet.base.org" \
  ANCHOR_PRIVATE_KEY="0x..." \
  ANCHOR_CONTRACT="0x..."
fly deploy --config deploy/fly/anchor.toml
```

Best practice: the address that holds `ANCHOR_PRIVATE_KEY` should be a **submitter**, not the owner. Owner sits in cold storage; submitter is a hot key with a modest balance that gets topped up periodically.

## Other chains

All the deploy commands above work unchanged on the other EVM L2s. Swap the `--rpc-url` alias (the list is in `foundry.toml` → `rpc_endpoints`):

| Chain | Typical cost per anchor | Notes |
|---|---|---|
| **Base** | $0.01-0.10 | Recommended. Coinbase L2, high uptime, cheapest among L2s. |
| Optimism | $0.05-0.30 | Similar tech to Base, slightly higher fees. |
| Arbitrum | $0.10-0.50 | Mature ecosystem, good tooling. |
| Sepolia | free (testnet) | Ethereum mainnet testnet. |
| Base Sepolia | free (testnet) | Base's testnet. Recommended dress rehearsal. |

## Upgrades / migrations

`DCPAnchor.sol` is **not upgradeable** by design — anchors need to be immutable for the security model to hold. If you need to change the contract (e.g. add a new event), deploy a fresh contract, point the anchor service at the new address, and leave the old contract as a historical reference. Downstream verifiers can read from both via their local registry of anchor contracts.

## Rollback plan

- Anchoring is optional in the DCP protocol. If a contract becomes unusable (compromised submitter, chain outage), disable anchoring in the anchor service (`ANCHOR_MODE=disabled`) and let verifiers fall through to the transparency log or plain audit chain.
- To rotate submitters: `cast send <ADDR> "removeSubmitter(address)" <OLD>` then add the new one.
- To pause all new anchors in an emergency: `cast send <ADDR> "pause()" --private-key $OWNER_KEY`.
