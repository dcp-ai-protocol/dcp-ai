<sub>[English](../../../../contracts/ethereum/DEPLOY.md) · [中文](../../../zh-CN/contracts/ethereum/DEPLOY.md) · [Español](../../../es/contracts/ethereum/DEPLOY.md) · **日本語** · [Português](../../../pt-BR/contracts/ethereum/DEPLOY.md)</sub>

<a id="deploying-dcpanchorsol"></a>

# `DCPAnchor.sol` のデプロイ

> [英語版](../../../../contracts/ethereum/DEPLOY.md)の参考訳です（25/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

`DCPAnchor.sol` は、EVM 互換の L2 にバンドルのハッシュを記録します。これは、あるハッシュが特定のブロックまでに送信されたことを示す、改ざんを検出でき、誰でも検証できる記録です。ハッシュの背後にあるバンドルは確認しません。このガイドでは、**Base** へのデプロイを、ほかのチェーンについての注記とともに説明します。

> **リファレンスのアンカーサービスは、まだこのコントラクトを使いません。** `services/anchor/` は `tx_hash: null` でローカルのメモリに記録を保持し、RPC の URL、ウォレットの鍵、コントラクトのアドレスのいずれも読みません。デプロイ後のコントラクトへのアンカーは、あなた自身のコードか `cast` から、キーストアまたはシークレットマネージャーに保管した送信者の鍵で行います。このガイドのうちトランザクションを送信するコマンド（`--broadcast`、`cast send`）は、メインネットで実際の資金を使うもので、このページのためには実行していません。

<a id="what-you-need"></a>

## 必要なもの

1. **Foundry**（Solidity 用のツールキット）。インストール：
   ```bash
   curl -L https://foundry.paradigm.xyz | bash
   foundryup
   ```
2. 対象のチェーンにいくらかのガスがある**ウォレット**。手数料はネットワークによって変わるため、デプロイの前に確認してください。
3. ソースを自動で検証して Basescan/Etherscan に ABI を表示させたい場合は、**ブロックエクスプローラーの API キー**（無料）。[basescan.org/apis](https://basescan.org/apis) で登録してください。

<a id="configure"></a>

## 設定

```bash
cd contracts/ethereum
cp .env.example .env
# Edit .env with your RPC URL and BASESCAN_API_KEY, and remove or comment out its PRIVATE_KEY line
```

デプロイヤーの鍵は、`.env` ではなく Foundry のキーストアに保管してください。
```bash
cast wallet import my-deployer --interactive   # paste the key once; stored encrypted on disk
```
以下のコマンドは `--account my-deployer` で署名します。

`script/Deploy.s.sol` が鍵を選ぶ方法：`vm.envOr("PRIVATE_KEY", uint256(0))` で `PRIVATE_KEY` を読みます。そこにゼロでない有効な `uint256` があれば、キーストアより優先され、スクリプトはその鍵でブロードキャストします。`PRIVATE_KEY` がないか `0` のときは `vm.startBroadcast()` を呼び、`--account`（または `--sender`）のフラグが適用されます。`.env.example` にある `PRIVATE_KEY=0x` の行のような不正な形式のプレースホルダーは、解析に失敗することがあります。そのため、キーストアを使うには、`source .env` の前に、コピーした `.env` の `PRIVATE_KEY` の行を削除するかコメントアウトしてください。スクリプトは `DEPLOYER_ACCOUNT` を読まないため、`--account` は自分で渡してください（例：`--account "$DEPLOYER_ACCOUNT"`）。

`lib/forge-std` がない場合は `forge-std` をインストールします。
```bash
git clone --depth 1 https://github.com/foundry-rs/forge-std.git lib/forge-std
```

<a id="test-locally"></a>

## ローカルでのテスト

```bash
forge test -vv
```

想定される結果：数秒で 6 つのテストが合格します。

<a id="deploy-to-a-testnet-first-base-sepolia"></a>

## まずテストネットにデプロイする（Base Sepolia）

```bash
source .env
forge script script/Deploy.s.sol \
  --rpc-url base_sepolia \
  --account my-deployer \
  --broadcast \
  --verify
```

[sepolia.basescan.org](https://sepolia.basescan.org/) 上のトランザクションと、コントラクトのアドレスが得られます。CLI からアンカーを実行して試してください。

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

## Base メインネットへのデプロイ

テストネットへのデプロイが問題なければ：

```bash
source .env
forge script script/Deploy.s.sol \
  --rpc-url base \
  --account my-deployer \
  --broadcast \
  --verify \
  --priority-gas-price 1gwei
```

アドレスは、永続的な場所（README、運用の wiki、検証サーバーの `.well-known/dcp-capabilities.json`）に保存してください。

<a id="anchoring-to-it"></a>

## このコントラクトへのアンカー

アンカーサービスはこのコントラクトにつながっていません。`ANCHOR_RPC_URL`、`ANCHOR_PRIVATE_KEY`、`ANCHOR_CONTRACT` を読まないので、ウォレットの鍵を渡さないでください。つながるまでは、上のテストネットでの確認のように、あなた自身のコードか `cast` からアンカーし、コマンドラインに生の鍵を書くのではなく、Foundry のキーストアの送信者アカウント（`--account`）を使ってください。

ベストプラクティス：送信者は所有者ではありません。所有者の鍵はコールドストレージに置き、所有者の関数（`addSubmitter`、`removeSubmitter`、`pause`、`unpause`、`transferOwnership`）にだけ使います。送信者は、残高を控えめにして定期的に補充するホットな鍵です。デプロイヤーが所有者であり、送信も認可されています。同じ実行で別の送信者を認可するには、デプロイの前に `INITIAL_SUBMITTER` を設定してください。

<a id="other-chains"></a>

## ほかのチェーン

上のデプロイのコマンドは、ほかの EVM の L2 でもそのまま動きます。`--rpc-url` のエイリアスを替えてください（一覧は `foundry.toml` → `rpc_endpoints` にあります）。

| チェーン | エイリアス | 注記 |
|---|---|---|
| **Base** | `base` | Coinbase の L2 |
| Optimism | `optimism` | Base と同じ OP Stack |
| Arbitrum | `arbitrum` | Arbitrum One |
| Sepolia | `sepolia` | Ethereum のテストネット（実際の資金なし） |
| Base Sepolia | `base_sepolia` | Base のテストネット（実際の資金なし）。推奨する予行演習 |

各エイリアスは、RPC の URL を環境（`BASE_RPC_URL`、`OPTIMISM_RPC_URL`、…）から読みます。このリポジトリは、いずれの手数料も測定していません。

<a id="upgrades--migrations"></a>
<a id="upgrades-migrations"></a>

## アップグレード／移行

`DCPAnchor.sol` は設計上**アップグレードできません**。セキュリティモデルが成り立つには、アンカーが変更できないものでなければならないからです。コントラクトを変更する必要がある場合（例：新しいイベントの追加）は、新しいコントラクトをデプロイし、送信者を新しいアドレスに向け、古いコントラクトは過去の参照として残してください。下流の検証者は、アンカーのコントラクトのローカルのレジストリを通じて両方を読めます。

<a id="rollback-plan"></a>

## ロールバックの計画

- DCP のプロトコルでは、アンカリングは任意ですが、利用者のポリシーがそれを求めることがあります。コントラクトが使えなくなった場合（送信者の侵害、チェーンの障害）は、それへの送信をやめてください。検証者が透明性ログか通常の監査チェーンに切り替えるのは、自らのポリシーがそれを明示的に許す場合だけで、このリポジトリはそのようなフェイルオーバーを実装していません。（アンカーサービスに `disabled` モードはなく、モードは `individual` と `batch` で、いずれにせよオンチェーンには何も送信しません。）
- 送信者を交代させるには：`cast send <ADDR> "removeSubmitter(address)" <OLD> --rpc-url <alias> --account <owner keystore>`、その後、同じ方法で新しい送信者を追加します。
- 所有者を交代させるには：`transferOwnership` は `authorizedSubmitters` を変更しないため、以前の所有者（デプロイ時に認可されたもの）は引き続き送信できます。移転の後、新しい所有者が `removeSubmitter` でそれを削除します。
- 緊急時にすべての新しいアンカーを停止するには：`cast send <ADDR> "pause()" --rpc-url <alias> --account <owner keystore>`（`unpause()` で再開します）。
