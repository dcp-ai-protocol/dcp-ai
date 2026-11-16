<sub>[English](../../../../contracts/ethereum/README.md) · [中文](../../../zh-CN/contracts/ethereum/README.md) · [Español](../../../es/contracts/ethereum/README.md) · **日本語** · [Português](../../../pt-BR/contracts/ethereum/README.md)</sub>

<a id="dcpanchorsol--smart-contract"></a>
<a id="dcpanchorsol-smart-contract"></a>

# DCPAnchor.sol — スマートコントラクト

> [英語版](../../../../contracts/ethereum/README.md)の参考訳です（25/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

EVM の L2 ブロックチェーン（Base、Arbitrum、Optimism）に DCP の Citizenship Bundle のハッシュをアンカーするための Solidity のスマートコントラクトです。個別のアンカリング、コミット・リビールによるアンカリング、バッチのアンカリング（バッチのマークルルート）をサポートします。

リファレンスのアンカーサービス（`services/anchor/`）は、まだこのコントラクトを呼び出しません。[アンカリングサービスとの統合](#integration-with-the-anchoring-service)を参照してください。

<a id="layout"></a>

## 構成

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

## クイックスタート

```bash
cd contracts/ethereum
git clone --depth 1 https://github.com/foundry-rs/forge-std.git lib/forge-std
forge test -vv
```

<a id="deploy"></a>

## デプロイ

完全な手順（Base Sepolia → Base メインネット、Basescan での検証、`anchor` サービスとの接続）は [DEPLOY.md](../../../../contracts/ethereum/DEPLOY.md) を参照してください。

短縮版です。DEPLOY.md の [Configure](../../../../contracts/ethereum/DEPLOY.md#configure) の手順（キーストアのアカウント、`.env` から `PRIVATE_KEY` の行を
削除）を済ませた後に行います。トランザクションを送信し、メインネットで資金を使います。
```bash
source .env
forge script script/Deploy.s.sol --rpc-url base --account my-deployer --broadcast --verify
```

<a id="overview"></a>

## 概要

`DCPAnchor` コントラクトは、バンドルのハッシュの変更できないオンチェーンのレジストリを提供します。一度アンカーされたハッシュは変更も削除もできないため、その記録は、送信者がそのブロックの時点までにそのハッシュにコミットしたことを示します。コントラクトは `bytes32`（バッチの場合は `count` も）を送信者が宣言したとおりに保存します。そのハッシュが有効なバンドルのものかどうかは確認せず、署名も検証せず、バンドルが記述する出来事が起きたことも証明しません。

<a id="contract"></a>

## コントラクト

**Solidity：** `^0.8.20`  
**ライセンスのヘッダー：** `src/DCPAnchor.sol` と `script/Deploy.s.sol` の `SPDX-License-Identifier: MIT`（[ライセンス](#license)を参照）  
**対象のネットワーク：** Base、Arbitrum、Optimism（または任意の EVM の L2）

## API

以下の Solidity の断片は例示です。`0xabc123...` のような値は、完全な `bytes32` のハッシュを表します。

<a id="admin-functions"></a>

### 管理用の関数

#### `addSubmitter(address submitter)`

認可された送信者を追加します。呼び出せるのはコントラクトの所有者だけです。

#### `removeSubmitter(address submitter)`

認可された送信者を削除します。呼び出せるのはコントラクトの所有者だけです。

#### `pause()` / `unpause()`

緊急停止の仕組みです。停止中は、すべてのアンカリングの関数がリバートします。呼び出せるのはコントラクトの所有者だけです。

#### `transferOwnership(address newOwner)`

コントラクトの所有権を移転します。`authorizedSubmitters` は変更しません。コンストラクターがデプロイヤーとして認可した以前の
所有者は、新しい所有者がそれに対して `removeSubmitter` を呼ぶまで、認可された送信者のままです。現在の所有者は、
`removeSubmitter(owner)` の後でも、常に送信者の確認を通ります。所有者を交代させるときは、以前の所有者の送信者のエントリも
削除してください。

<a id="write-functions"></a>

### 書き込みの関数

#### `anchorBundle(bytes32 bundleHash)`

リスクの低い場面での、信頼できる送信者による直接のアンカーです。

- **必要**：認可された送信者または所有者
- **リバート**：`bundleHash` がゼロの場合
- **リバート**：そのハッシュがすでにアンカーされている場合
- **リバート**：コントラクトが停止中の場合
- **発行**：`BundleAnchored(bundleHash, msg.sender, block.timestamp)`

```solidity
dcpAnchor.anchorBundle(0xabc123...);
```

<a id="commit-reveal-front-running-protection"></a>

<a id="commit-reveal-limited-front-running-protection"></a>

#### コミット・リビール（フロントランニングへの限定的な対策）

フロントランニングが懸念される場面では、2 段階のコミット・リビールの流れを使います。コミットは、リビールまでバンドルの
ハッシュを隠し、リビールをコミットしたアドレスに結び付けます。予約されるのは `commitHash` だけで、バンドルのハッシュでは
ありません。`anchorBundle` は認可されたすべての送信者に開かれたままで、コミットメントを参照しないため、そのハッシュを
知っているほかの認可された送信者は、あなたのリビールより前に直接それをアンカーできます。排他的な予約ではありません。

**フェーズ 1 — `commit(bytes32 commitHash)`**

`keccak256(abi.encodePacked(bundleHash, salt, msg.sender))` を送って枠を予約します。

**フェーズ 2 — `revealAndAnchorBundle(bytes32 bundleHash, bytes32 salt)`**

元のハッシュとソルトを明かしてアンカーを完了します。コミットがブロック `b` で採掘された場合、リビールには `block.number > b + COMMIT_DELAY` かつ `block.number <= b + COMMIT_EXPIRY` が必要です。以下の定数では、ブロック `b + 2` からブロック `b + 256` まで（両端を含む）となります。例の `keccak256("random-salt")` は決定的です。実際に使うときは、ソルトはランダムで予測できないものにし、リビールまで非公開にしておかなければなりません。

```solidity
bytes32 salt = keccak256("random-salt");
bytes32 commitHash = keccak256(abi.encodePacked(bundleHash, salt, msg.sender));
dcpAnchor.commit(commitHash);
// ... wait until block.number > commit block + COMMIT_DELAY (b + 2 or later, b + 256 at the latest) ...
dcpAnchor.revealAndAnchorBundle(bundleHash, salt);
```

#### `anchorBatch(bytes32 merkleRoot, uint256 count)`

バンドルのバッチを表すマークルルートをアンカーします。

- **必要**：認可された送信者または所有者
- **リバート**：`merkleRoot` がゼロの場合
- **リバート**：`count` がゼロ、または `MAX_BATCH_SIZE`（10000）を超える場合
- **リバート**：そのマークルルートがすでにアンカーされている場合
- **リバート**：コントラクトが停止中の場合
- **発行**：`BatchAnchored(merkleRoot, count, msg.sender, block.timestamp)`

```solidity
dcpAnchor.anchorBatch(0xdef456..., 50);
```

<a id="read-functions"></a>

### 読み取りの関数

#### `isAnchored(bytes32 bundleHash) → (bool exists, uint256 timestamp, address submitter)`

バンドルのハッシュがアンカーされているかどうかを照会します。

```solidity
(bool exists, uint256 ts, address submitter) = dcpAnchor.isAnchored(0xabc123...);
```

#### `isBatchAnchored(bytes32 merkleRoot) → (bool exists, uint256 timestamp, uint256 count, address submitter)`

バッチのマークルルートがアンカーされているかどうかを照会します。

```solidity
(bool exists, uint256 ts, uint256 count, address submitter) = dcpAnchor.isBatchAnchored(0xdef456...);
```

<a id="storage"></a>

### ストレージ

| 変数 | 型 | 説明 |
|----------|------|-------------|
| `owner` | `address` | コントラクトの所有者 |
| `paused` | `bool` | 緊急停止の状態 |
| `authorizedSubmitters` | `mapping(address => bool)` | 認可された送信者 |
| `bundles` | `mapping(bytes32 => AnchorRecord)` | 個別のバンドルの記録 |
| `batches` | `mapping(bytes32 => AnchorRecord)` | バッチのマークルルートの記録 |
| `commitments` | `mapping(bytes32 => Commitment)` | コミット・リビールのコミットメント |
| `totalAnchors` | `uint256` | 個別のアンカーの総数 |
| `totalBatches` | `uint256` | バッチのアンカーの総数 |

<a id="structs"></a>

### 構造体

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

### 定数

| 定数 | 値 | 説明 |
|----------|-------|-------------|
| `MAX_BATCH_SIZE` | `10000` | バッチあたりのバンドルの最大数 |
| `COMMIT_DELAY` | `1` | リビールには `block.number > b + COMMIT_DELAY` が必要（`b` はコミットのブロック。つまり `b + 2` から） |
| `COMMIT_EXPIRY` | `256` | リビールには `block.number <= b + COMMIT_EXPIRY` が必要。それを過ぎるとコミットメントは期限切れになる |

<a id="events"></a>

### イベント

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

## デプロイ

<a id="with-hardhat"></a>

### Hardhat を使う

このリポジトリには Hardhat のプロジェクトはありません。`DCPAnchor.sol` をソースに含めた、自分の Hardhat のプロジェクトで次のようにします。

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

### Foundry を使う

`contracts/ethereum` から実行します（または [DEPLOY.md](../../../../contracts/ethereum/DEPLOY.md) のとおり `script/Deploy.s.sol` を使います）。トランザクションを送信して資金を使うため、生の鍵よりもキーストアのアカウント（`--account`）を使ってください。

```bash
forge create --rpc-url base_sepolia \
  --account my-deployer \
  --broadcast \
  src/DCPAnchor.sol:DCPAnchor
```

<a id="recommended-l2-networks"></a>

### 推奨する L2 のネットワーク

| ネットワーク | 種類 |
|---------|------|
| **Base** | Optimistic Rollup |
| **Arbitrum** | Optimistic Rollup |
| **Optimism** | Optimistic Rollup |

このリポジトリはネットワークの手数料を測定していません。選ぶ前に現在の手数料を確認してください。

<a id="full-example--anchor-and-verify"></a>
<a id="full-example-anchor-and-verify"></a>

## 完全な例 — アンカーと確認

この例は、すでに検証した署名付きの V1 のバンドルの `bundle_hash` をアンカーします。その後の `isAnchored` が示すのは、その
ハッシュがいつ誰によってアンカーされたかだけで、バンドルの DCP による検証ではありません。

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

## アンカリングサービスとの統合

`services/anchor/` の HTTP サービスはこのコントラクトを呼び出すためのものですが、**オンチェーンへの送信はまだ実装されていません**。実装されれば、次のようになります。

- **個別モード：** ハッシュごとに `anchorBundle()` を呼ぶ
- **バッチモード：** ハッシュを集めてマークルルートを計算し、`anchorBatch()` を呼ぶ

現在は `tx_hash: null` でローカルのメモリに記録を保持し、`ANCHOR_RPC_URL`、`ANCHOR_PRIVATE_KEY`、`ANCHOR_CONTRACT` を読みません。ウォレットの鍵を渡さないでください（[services/anchor/README.md](../../../../services/anchor/README.md)）。

<a id="development"></a>

## 開発

```bash
# From contracts/ethereum, with Foundry
forge build
forge test
```

<a id="license"></a>

## ライセンス

リポジトリは Apache-2.0 でライセンスされています。Solidity のファイルには独自の `SPDX-License-Identifier: MIT` のヘッダーが
あり、このページはそれらのライセンスを変更しません。
