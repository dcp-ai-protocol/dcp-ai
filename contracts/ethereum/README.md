# DCPAnchor.sol — Smart Contract

Solidity smart contract for anchoring DCP Citizenship Bundle hashes on EVM L2 blockchains (Base, Arbitrum, Optimism). Supports individual anchoring and batch anchoring (batch Merkle root).

## Overview

The `DCPAnchor` contract provides an immutable on-chain registry of bundle hashes. Once anchored, a hash cannot be modified or deleted, providing cryptographic evidence that a bundle existed at a given point in time.

## Contract

**Solidity:** `^0.8.20`  
**License:** MIT  
**Target networks:** Base, Arbitrum, Optimism (or any EVM L2)

## API

### Write Functions

#### `anchorBundle(bytes32 bundleHash)`

Anchors an individual bundle hash.

- **Reverts** if `bundleHash` is zero
- **Reverts** if the hash has already been anchored
- **Emits** `BundleAnchored(bundleHash, msg.sender, block.timestamp)`

```solidity
// Example
dcpAnchor.anchorBundle(0xabc123...);
```

#### `anchorBatch(bytes32 merkleRoot, uint256 count)`

Anchors a Merkle root representing a batch of bundles.

- **Reverts** if `merkleRoot` is zero
- **Reverts** if `count` is zero
- **Reverts** if the Merkle root has already been anchored
- **Emits** `BatchAnchored(merkleRoot, count, msg.sender, block.timestamp)`

```solidity
// Example: anchor a batch of 50 bundles
dcpAnchor.anchorBatch(0xdef456..., 50);
```

### Read Functions

#### `isAnchored(bytes32 bundleHash) → (bool exists, uint256 timestamp)`

Queries whether a bundle hash is anchored.

```solidity
(bool exists, uint256 ts) = dcpAnchor.isAnchored(0xabc123...);
```

#### `isBatchAnchored(bytes32 merkleRoot) → (bool exists, uint256 timestamp)`

Queries whether a batch Merkle root is anchored.

```solidity
(bool exists, uint256 ts) = dcpAnchor.isBatchAnchored(0xdef456...);
```

### Storage

| Variable | Type | Description |
|----------|------|-------------|
| `bundles` | `mapping(bytes32 => AnchorRecord)` | Individual bundle records |
| `batches` | `mapping(bytes32 => AnchorRecord)` | Batch Merkle root records |
| `totalAnchors` | `uint256` | Total individual anchors |
| `totalBatches` | `uint256` | Total batch anchors |

### Structs

```solidity
struct AnchorRecord {
    address submitter;   // Who anchored the hash
    uint256 timestamp;   // When it was anchored (block.timestamp)
    bool exists;         // Whether the record exists
}
```

### Events

```solidity
event BundleAnchored(
    bytes32 indexed bundleHash,
    address indexed submitter,
    uint256 timestamp
);

event BatchAnchored(
    bytes32 indexed merkleRoot,
    uint256 bundleCount,
    address indexed submitter,
    uint256 timestamp
);
```

## Deploy

### With Hardhat

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

### With Foundry

```bash
forge create --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY \
  src/DCPAnchor.sol:DCPAnchor
```

### Recommended L2 Networks

| Network | Type | Estimated cost per tx |
|---------|------|----------------------|
| **Base** | Optimistic Rollup | ~$0.001-0.01 |
| **Arbitrum** | Optimistic Rollup | ~$0.001-0.01 |
| **Optimism** | Optimistic Rollup | ~$0.001-0.01 |

Using L2 reduces gas costs >100x compared to Ethereum mainnet, while maintaining L1 security.

## Full Example — Anchor and Verify

```javascript
const { ethers } = require("ethers");

// Connect
const provider = new ethers.JsonRpcProvider(process.env.ANCHOR_RPC_URL);
const wallet = new ethers.Wallet(process.env.ANCHOR_PRIVATE_KEY, provider);
const anchor = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

// Anchor a bundle hash
const bundleHash = ethers.keccak256(ethers.toUtf8Bytes("bundle-content"));
const tx = await anchor.anchorBundle(bundleHash);
await tx.wait();
console.log("Anchored in tx:", tx.hash);

// Verify
const [exists, timestamp] = await anchor.isAnchored(bundleHash);
console.log("Exists:", exists);
console.log("Timestamp:", new Date(Number(timestamp) * 1000));
```

## Integration with the Anchoring Service

The HTTP service at `services/anchor/` interacts with this contract automatically:

- **Individual mode:** Calls `anchorBundle()` for each hash
- **Batch mode:** Accumulates hashes, computes the Merkle root, and calls `anchorBatch()`

Configure via environment variables:
```bash
ANCHOR_RPC_URL=https://mainnet.base.org
ANCHOR_PRIVATE_KEY=0x...
ANCHOR_CONTRACT=0x...
```

## Development

```bash
# With Hardhat
npx hardhat compile
npx hardhat test

# With Foundry
forge build
forge test
```

## License

MIT
