# DCPAnchor.sol — Smart Contract

Solidity smart contract for anchoring DCP Citizenship Bundle hashes on EVM L2 blockchains (Base, Arbitrum, Optimism). Supports individual anchoring and batch anchoring (batch Merkle root).

## Layout

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

## Quick start

```bash
cd contracts/ethereum
git clone --depth 1 https://github.com/foundry-rs/forge-std.git lib/forge-std
forge test -vv
```

## Deploy

See [DEPLOY.md](DEPLOY.md) for the full walk-through (Base Sepolia → Base mainnet, verification on Basescan, wiring the `anchor` service).

Short version:
```bash
source .env
forge script script/Deploy.s.sol --rpc-url base --broadcast --verify
```

## Overview

The `DCPAnchor` contract provides an immutable on-chain registry of bundle hashes. Once anchored, a hash cannot be modified or deleted, providing cryptographic evidence that a bundle existed at a given point in time.

## Contract

**Solidity:** `^0.8.20`  
**License:** Apache-2.0  
**Target networks:** Base, Arbitrum, Optimism (or any EVM L2)

## API

### Admin Functions

#### `addSubmitter(address submitter)`

Adds an authorized submitter. Only the contract owner can call this.

#### `removeSubmitter(address submitter)`

Removes an authorized submitter. Only the contract owner can call this.

#### `pause()` / `unpause()`

Emergency pause mechanism. When paused, all anchoring functions revert. Only the contract owner can call these.

#### `transferOwnership(address newOwner)`

Transfers contract ownership.

### Write Functions

#### `anchorBundle(bytes32 bundleHash)`

Direct anchor for trusted submitters in low-risk scenarios.

- **Requires** authorized submitter or owner
- **Reverts** if `bundleHash` is zero
- **Reverts** if the hash has already been anchored
- **Reverts** if the contract is paused
- **Emits** `BundleAnchored(bundleHash, msg.sender, block.timestamp)`

```solidity
dcpAnchor.anchorBundle(0xabc123...);
```

#### Commit-Reveal (front-running protection)

For scenarios where front-running is a concern, use the two-phase commit-reveal flow:

**Phase 1 — `commit(bytes32 commitHash)`**

Submit `keccak256(abi.encodePacked(bundleHash, salt, msg.sender))` to reserve a slot.

**Phase 2 — `revealAndAnchorBundle(bytes32 bundleHash, bytes32 salt)`**

Reveal the original hash and salt to complete the anchor. Must wait at least `COMMIT_DELAY` blocks and at most `COMMIT_EXPIRY` blocks after the commit.

```solidity
bytes32 salt = keccak256("random-salt");
bytes32 commitHash = keccak256(abi.encodePacked(bundleHash, salt, msg.sender));
dcpAnchor.commit(commitHash);
// ... wait at least COMMIT_DELAY blocks ...
dcpAnchor.revealAndAnchorBundle(bundleHash, salt);
```

#### `anchorBatch(bytes32 merkleRoot, uint256 count)`

Anchors a Merkle root representing a batch of bundles.

- **Requires** authorized submitter or owner
- **Reverts** if `merkleRoot` is zero
- **Reverts** if `count` is zero or exceeds `MAX_BATCH_SIZE` (10000)
- **Reverts** if the Merkle root has already been anchored
- **Reverts** if the contract is paused
- **Emits** `BatchAnchored(merkleRoot, count, msg.sender, block.timestamp)`

```solidity
dcpAnchor.anchorBatch(0xdef456..., 50);
```

### Read Functions

#### `isAnchored(bytes32 bundleHash) → (bool exists, uint256 timestamp, address submitter)`

Queries whether a bundle hash is anchored.

```solidity
(bool exists, uint256 ts, address submitter) = dcpAnchor.isAnchored(0xabc123...);
```

#### `isBatchAnchored(bytes32 merkleRoot) → (bool exists, uint256 timestamp, uint256 count, address submitter)`

Queries whether a batch Merkle root is anchored.

```solidity
(bool exists, uint256 ts, uint256 count, address submitter) = dcpAnchor.isBatchAnchored(0xdef456...);
```

### Storage

| Variable | Type | Description |
|----------|------|-------------|
| `owner` | `address` | Contract owner |
| `paused` | `bool` | Emergency pause state |
| `authorizedSubmitters` | `mapping(address => bool)` | Authorized submitters |
| `bundles` | `mapping(bytes32 => AnchorRecord)` | Individual bundle records |
| `batches` | `mapping(bytes32 => AnchorRecord)` | Batch Merkle root records |
| `commitments` | `mapping(bytes32 => Commitment)` | Commit-reveal commitments |
| `totalAnchors` | `uint256` | Total individual anchors |
| `totalBatches` | `uint256` | Total batch anchors |

### Structs

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

### Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `MAX_BATCH_SIZE` | `10000` | Maximum bundles per batch |
| `COMMIT_DELAY` | `1` | Minimum blocks between commit and reveal |
| `COMMIT_EXPIRY` | `256` | Maximum blocks before a commitment expires |

### Events

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
  contracts/ethereum/DCPAnchor.sol:DCPAnchor
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

// Anchor a bundle hash (DCP uses SHA-256 for bundle hashes)
const bundleContent = JSON.stringify(bundle);
const bundleHash = "0x" + require("crypto").createHash("sha256").update(bundleContent).digest("hex");
const tx = await anchor.anchorBundle(bundleHash);
await tx.wait();
console.log("Anchored in tx:", tx.hash);

// Verify
const [exists, timestamp, submitter] = await anchor.isAnchored(bundleHash);
console.log("Exists:", exists);
console.log("Timestamp:", new Date(Number(timestamp) * 1000));
console.log("Submitter:", submitter);
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

Apache-2.0
