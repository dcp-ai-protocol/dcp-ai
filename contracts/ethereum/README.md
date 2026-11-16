# DCPAnchor.sol — Smart Contract

Solidity smart contract for anchoring DCP Citizenship Bundle hashes on EVM L2 blockchains (Base, Arbitrum, Optimism). Supports individual anchoring, commit-reveal anchoring and batch anchoring (batch Merkle root).

The reference anchor service (`services/anchor/`) does not call this contract yet; see [Integration with the Anchoring Service](#integration-with-the-anchoring-service).

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

Short version, after the [Configure](DEPLOY.md#configure) step of DEPLOY.md (keystore account, `PRIVATE_KEY` line removed
from `.env`). It sends a transaction and spends funds on mainnet:
```bash
source .env
forge script script/Deploy.s.sol --rpc-url base --account my-deployer --broadcast --verify
```

## Overview

The `DCPAnchor` contract provides an immutable on-chain registry of bundle hashes. Once anchored, a hash cannot be modified or deleted, so the record shows that the submitter committed to that hash by the time of its block. The contract stores the `bytes32` (and, for a batch, the `count`) as the submitter declares them: it does not check that the hash belongs to a valid bundle, verify any signature, or prove that the events a bundle describes happened.

## Contract

**Solidity:** `^0.8.20`  
**License header:** `SPDX-License-Identifier: MIT` in `src/DCPAnchor.sol` and `script/Deploy.s.sol` (see [License](#license))  
**Target networks:** Base, Arbitrum, Optimism (or any EVM L2)

## API

The Solidity snippets below are illustrations: values such as `0xabc123...` stand for full `bytes32` hashes.

### Admin Functions

#### `addSubmitter(address submitter)`

Adds an authorized submitter. Only the contract owner can call this.

#### `removeSubmitter(address submitter)`

Removes an authorized submitter. Only the contract owner can call this.

#### `pause()` / `unpause()`

Emergency pause mechanism. When paused, all anchoring functions revert. Only the contract owner can call these.

#### `transferOwnership(address newOwner)`

Transfers contract ownership. It does not change `authorizedSubmitters`: the previous owner, which the constructor
authorized as the deployer, stays an authorized submitter until the new owner calls `removeSubmitter` for it. The
current owner always passes the submitter check, even after `removeSubmitter(owner)`. When you rotate the owner, also
remove the old owner's submitter entry.

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

<a id="commit-reveal-front-running-protection"></a>

#### Commit-Reveal (limited front-running protection)

For scenarios where front-running is a concern, use the two-phase commit-reveal flow. The commit hides the bundle
hash until the reveal and ties the reveal to the committing address. It reserves only the `commitHash`, not the bundle
hash: `anchorBundle` stays open to every authorized submitter and does not look at commitments, so another authorized
submitter who knows the hash can anchor it directly before your reveal. It is not an exclusive reservation.

**Phase 1 — `commit(bytes32 commitHash)`**

Submit `keccak256(abi.encodePacked(bundleHash, salt, msg.sender))` to reserve a slot.

**Phase 2 — `revealAndAnchorBundle(bytes32 bundleHash, bytes32 salt)`**

Reveal the original hash and salt to complete the anchor. If the commit was mined in block `b`, the reveal needs `block.number > b + COMMIT_DELAY` and `block.number <= b + COMMIT_EXPIRY`: with the constants below, from block `b + 2` through block `b + 256`, inclusive. `keccak256("random-salt")` in the example is deterministic; in real use the salt must be random and unpredictable, and stay private until the reveal.

```solidity
bytes32 salt = keccak256("random-salt");
bytes32 commitHash = keccak256(abi.encodePacked(bundleHash, salt, msg.sender));
dcpAnchor.commit(commitHash);
// ... wait until block.number > commit block + COMMIT_DELAY (b + 2 or later, b + 256 at the latest) ...
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
| `COMMIT_DELAY` | `1` | The reveal needs `block.number > b + COMMIT_DELAY`, `b` being the commit's block (so from `b + 2`) |
| `COMMIT_EXPIRY` | `256` | The reveal needs `block.number <= b + COMMIT_EXPIRY`; later, the commitment has expired |

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

This repository has no Hardhat project; in a Hardhat project of your own, with `DCPAnchor.sol` among its sources:

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

From `contracts/ethereum` (or use `script/Deploy.s.sol`, as in [DEPLOY.md](DEPLOY.md)). It sends a transaction and spends funds; prefer a keystore account (`--account`) to a raw key:

```bash
forge create --rpc-url base_sepolia \
  --account my-deployer \
  --broadcast \
  src/DCPAnchor.sol:DCPAnchor
```

### Recommended L2 Networks

| Network | Type |
|---------|------|
| **Base** | Optimistic Rollup |
| **Arbitrum** | Optimistic Rollup |
| **Optimism** | Optimistic Rollup |

This repository has not measured network fees; check current fees before choosing.

## Full Example — Anchor and Verify

The example anchors the `bundle_hash` of a signed V1 bundle that you have already verified. `isAnchored` then only
shows that this hash was anchored, when and by whom: it is not a DCP verification of the bundle.

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

## Integration with the Anchoring Service

The HTTP service at `services/anchor/` is meant to call this contract, but **on-chain submission is not implemented yet**. Once it is:

- **Individual mode:** would call `anchorBundle()` for each hash
- **Batch mode:** would accumulate hashes, compute the Merkle root, and call `anchorBatch()`

Today it keeps local records in memory with `tx_hash: null` and does not read `ANCHOR_RPC_URL`, `ANCHOR_PRIVATE_KEY` or `ANCHOR_CONTRACT`; do not give it a wallet key ([services/anchor/README.md](../../services/anchor/README.md)).

## Development

```bash
# From contracts/ethereum, with Foundry
forge build
forge test
```

## License

The repository is licensed under Apache-2.0. The Solidity files carry their own `SPDX-License-Identifier: MIT` header;
this page does not relicense them.
