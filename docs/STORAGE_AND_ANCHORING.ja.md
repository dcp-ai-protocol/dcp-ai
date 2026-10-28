<sub>[English](STORAGE_AND_ANCHORING.md) · [中文](STORAGE_AND_ANCHORING.zh-CN.md) · [Español](STORAGE_AND_ANCHORING.es.md) · **日本語** · [Português](STORAGE_AND_ANCHORING.pt-BR.md)</sub>

<a id="storage-and-anchoring--p2p-verification-local"></a>
<a id="storage-and-anchoring-p2p-verification-local"></a>

# ストレージとアンカリング — P2P、ローカルでの検証

> [英語版](STORAGE_AND_ANCHORING.md)の参考訳です（28/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

プロトコルは中央のサービスに依存しません。検証はローカルで行い、オプションのアンカリングには**既存の**公開ブロックチェーンや**サードパーティー**のサービスを使います。プロトコルは、正規の「DCP レジストリ」や「dcp.ai」の URL を指し示しません。

<a id="design"></a>

## 設計

- **検証はローカルで行います。** 検証者に必要なのは、(1) Signed Bundle（または Citizenship Bundle + 署名）と、(2) オプションで署名済みの RevocationRecord のセット（ピア、ファイル、またはオンチェーンにアンカーされたもの）だけです。中央のサーバーへの API 呼び出しは不要です。
- **オプションのアンカリング：** ユーザー（または任意の第三者）が、**既存の**公開ブロックチェーン（Bitcoin、Ethereum）や**サードパーティー**の透明性ログにハッシュを公開します。
- **失効：** 1 つ以上の署名済みの RevocationRecord。P2P で配布する（保有者が検証者に渡す）か、ハッシュとしてオンチェーンやログに公開します。検証者は「既知の失効」のセット（ハッシュまたはレコード）を持ち、署名者や agent_id をそれと照合します。中央の失効サーバーはありません。

<a id="storage-options"></a>

## ストレージの選択肢

| 選択肢 | 保存するもの | 場所 |
|--------|----------------|--------|
| **持ち運びのみ** | バンドル全体を保有者が持ち、必要なとき（例：API の呼び出し時）に検証者に提示する。 | 保有者のデバイスやストレージ。検証者はやりとりの中でバンドルを受け取る。 |
| **アンカリング（ハッシュのみ）** | bundle_hash または merkle_root（とオプションで失効のハッシュ）だけを公開する。バンドル全体はオフチェーンに残る。 | 公開ブロックチェーン、透明性ログ、または DHT。検証者は公開データを使って「このハッシュは T の時点でアンカーされた」ことを確認する。ユーザーやサードパーティーのアンカーサービスは既存のチェーンやログを使う。 |
| **失効** | 1 つ以上の署名済みの RevocationRecord。P2P で配布するか、ハッシュとしてオンチェーンやログに公開する。 | ピア、ファイル、IPFS、ブロックチェーン（ハッシュのみ）、またはユーザーが提供するリスト。 |

<a id="optional-anchor-receipt"></a>

## オプションのアンカーレシート

アンカリングを使う場合、オプションの証明をバンドルと**一緒に**保存できます（スキーマに含める必要はありません）。

- `anchor_receipt`：`{ chain, tx_id, block_height }`（Bitcoin）、`{ chain, contract, tx_id, block_number, event_index }`（Ethereum）、または `{ log_url, log_index }`（透明性ログ）。

アンカリングは、ユーザーまたはサードパーティーのアンカーサービスが既存のチェーンやログに対して行います。

<a id="blockchain-anchoring"></a>

## ブロックチェーンへのアンカリング

DCP のハッシュをブロックチェーンにアンカーする方法です。ユーザー（または任意のサードパーティーのアンカーサービス）が、**既存の**公開チェーンにハッシュを公開します。

<a id="what-goes-on-chain-only-hashes"></a>

### オンチェーンに載せるもの（ハッシュのみ）

- **bundle_hash**（例：`sha256:<hex>`）または audit_entries の **merkle_root**。アンカーごとに 1 つのハッシュ。
- オプションで、**RevocationRecord のハッシュ**（検証者がチェーンから失効のハッシュのリストを取得し、ローカルで確認できるようにするため）。
- **それ以外は何も載せない：** バンドル全体、agent_id、human_id、RPR や AP のペイロードは載せません。チェーンに見えるのはハッシュだけです。ハッシュは匿名ではありません。バンドルを持っている人はチェーン上でそのハッシュを見つけられ、同じハッシュはそれを持つすべての記録を結び付けます。

<a id="implementation-options"></a>

### 実装の選択肢

| チェーン / システム | 方法 | 形式 | 注記 |
|----------------|--------|--------|--------|
| **Bitcoin** | OP_RETURN の出力（または taproot のコミットメント）。ハッシュごとに 1 つのトランザクションか、多数のハッシュをマークルツリーにまとめてルートをコミットする。 | 出力に 32 バイト（SHA-256）。 | 安価で不変。トランザクションあたりのペイロードのサイズは限られる。バッチの場合、トランザクションごとに 1 つのルート、証明はオフチェーン。 |
| **Ethereum（または L2）** | `bytes32 bundleHash`（とオプションのタイムスタンプ）を持つイベントを発行するコントラクト。 | イベント：`Anchored(bytes32 bundleHash, uint256 timestamp)`。 | 検証者はイベントを読む。中央のサーバーを信頼する必要はない。ガスのコストがかかる。 |
| **透明性ログ（例：CT 方式）** | 追記専用のログ：各エントリ = ハッシュ（+ オプションのタイムスタンプ）。エントリに対するマークルツリー。ルートは定期的に Bitcoin/Ethereum に公開できる。 | ログのエントリ = 32 バイトのハッシュ。包含証明 = マークルのパス。 | 追記は非常に安価。検証者は包含証明を確認する。第三者が運用できる。 |
| **IPFS** | ハッシュだけをコンテンツとして公開する（例：DAG ノード）。複数のノードからピン留めする。 | CID または生のハッシュ。 | ブロックチェーンではないが分散型。検証者は CID を解決してハッシュを取得し、照合する。 |

<a id="concrete-flow-bitcoin-op_return"></a>

### 具体的な流れ（Bitcoin の OP_RETURN）

1. 保有者は Signed Bundle を持っており、`bundle_hash` はすでに `signature.bundle_hash` にあります。
2. 保有者（または任意の第三者）が、32 バイトの 16 進値（またはプロトコルを識別するために `dcp:v1:` + hex のような接頭辞を付けたもの）を含む OP_RETURN の出力を持つ Bitcoin のトランザクションを作ります。
3. 保有者は **anchor_receipt** を保存します：`{ chain: "bitcoin", network: "mainnet", tx_id: "<txid>", block_height: N }`（バッチにする場合は、オプションでマークル証明も）。
4. 検証者：Signed Bundle と anchor_receipt を受け取り、(a) バンドルから bundle_hash を計算し、(b) チェーン（または公開のブロックエクスプローラーや自分のノード）からトランザクションを取得し、(c) OP_RETURN の出力が bundle_hash と一致することを確認します。検証はローカル + チェーンの公開データで行います。

<a id="anchoring-by-users-or-third-parties"></a>

### ユーザーや第三者によるアンカリング

アンカリングは、**ユーザー**または**サードパーティーのアンカーサービス**が既存のチェーンに対して行います。リファレンス CLI にはアンカーのコマンドがなく、リファレンスのアンカーサービス（`services/anchor/`）もまだチェーンに送信しません。ハッシュをバッチにまとめ、ローカルのメモリーに記録するだけです。`contracts/ethereum/` には、Ethereum や L2 にデプロイするためのコントラクトがあります。

<a id="revocation-p2p"></a>

## 失効（P2P）

- 署名済みの **RevocationRecord**（[spec/DCP-01.md](../spec/DCP-01.md) を参照）は、エージェント（または署名者）が失効していることを宣言します。
- 検証者は、署名済みの RevocationRecord の**ローカルのセット**（ファイル、ピア、IPFS、またはハッシュでオンチェーンにアンカーされたもの）を保持します。バンドルの署名者や agent_id をこのセットと照合します。中央の失効サーバーはありません。
- ローカルで失効を確認するコマンド（例：`dcp verify-revocation <signed_bundle> <revocation_record.json>`）はありうるツールですが、リファレンス CLI にはありません。

<a id="jurisdictional-revocation-list"></a>

## 管轄の失効リスト

管轄（政府、規制当局、または認定された発行者）は、**署名済みの失効リスト**、つまりその管轄内で失効したエージェントを列挙する JSON ファイルを公開できます。

**推奨する形式：**

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

**公開：** 既知の URL で行います。例：`https://<authority>/.well-known/dcp-revocations.json`。必須ではなく、慣例です。どの URL でもかまいません。

上の形式は推奨する設計です。このリポジトリには、それを生成したり、その署名を確認したりするツールはありません。

**リファレンス実装：** このリポジトリの `services/revocation/`（Docker イメージ `ghcr.io/dcp-ai-protocol/dcp-ai/revocation:latest`、Fly.io の設定は `deploy/fly/revocation.toml`）は、`/.well-known/dcp-revocations.json` で別のリストを配信します：`{ dcp_version, updated_at, revocations, kid_revocations }`。リストに対する**署名はありません**。それを読む検証者は、その URL のオペレーターと転送路（HTTPS と、アドミッションの失効情報の提供元が送るオプションの `Authorization` ヘッダー）を信頼することになります。アドミッションのプロファイルはこの形式を拒否リストとして読み、取得できなければ失敗し、応答がないことを「失効していない」として扱うことは決してありません（[ADMISSION.md](ADMISSION.md#revocation-sources)）。

**提案する統合：** オペレーターは、該当する管轄について信頼できる機関と URL を選びます。SDK が RPR の `jurisdiction` フィールドから機関を見つけ出すことはありません。上で提案した署名付きの形式では、アプリケーションは、リスト自体が示す鍵を信頼するのではなく、別の経路で信頼した鍵で発行者の署名を検証しなければなりません。その後、バンドルの `agent_id` や署名者をエントリの中から探し、失効したバンドルを拒否します。既存のアドミッションの提供元は、代わりに上で説明した署名のないリファレンスの拒否リストを使います。キャッシュしたリストの新しさは最後に取得した時点までです。十分に新しいリストを取得できないときは、処理を進めないでください。

**必要なもの：** Web サーバーや CDN から配信され、発行者が最新の状態に保つ JSON ファイル。

<a id="jurisdictional-transparency-log"></a>

## 管轄の透明性ログ

管轄または認定されたオペレーターは、**透明性ログ**、つまりその管轄で検証されたエージェントの `bundle_hash` の値を記録する、マークルツリーを基盤とした追記専用のログを運用できます。Certificate Transparency（RFC 6962）に着想を得ています。

**保存するもの：** エントリごとに `bundle_hash`（16 進の SHA-256）とタイムスタンプだけです。agent_id、human_id、バンドルの内容は保存しません。これでログが明かす内容は限られますが、ハッシュは匿名ではありません。バンドルを持っている人はそれが記録されたかどうかを確認でき、同じハッシュはそれを持つエントリを結び付けます。

**推奨する API：**

- `POST /add` — `{ bundle_hash }` を受け取り、`{ log_index, timestamp }` を返す。
- `GET /proof/:log_index` — マークルの包含証明（兄弟ハッシュの配列 + 現在のルート）を返す。
- `GET /root` — 現在のマークルルートとログのサイズを返す。
- `GET /root/signed` — ログのオペレーターが署名したルートを返す（監査用）。

**ログのエントリの検証：** 検証者は `bundle_hash` + `log_index` + `merkle_proof` を（エージェントの保有者から、またはログから）受け取ります。検証者は、署名済みのルートに対するマークルの包含証明をローカルで確認します。検証者が最近の署名済みのルートを持っていれば、ログの API をその場で呼び出す必要はありません。

**ログのルートのアンカリング：** ログのオペレーターは、オペレーターのサーバーから独立した公開の不変性を得るために、署名済みのルートを定期的に Bitcoin（OP_RETURN 経由）や Ethereum（コントラクトのイベント経由）にアンカーできます。

**ログの anchor_receipt：** `{ log_url, log_index, merkle_proof, root_anchor: { chain, tx_id, block_height } }`。

**必要なもの：** 永続的なストア（SQLite または PostgreSQL）を持つサーバー、オペレーターの署名鍵、ルートを照合する監査人。Google の [Trillian](https://github.com/google/trillian) は、このパターンのオープンソース実装です。

**リファレンス実装：** このリポジトリには `services/transparency-log/`（ソース）と、対応する Docker イメージ `ghcr.io/dcp-ai-protocol/dcp-ai/transparency-log:latest` があります。ツリーヘッドに Ed25519 で署名し、分割ビューの攻撃を検出できるように兄弟ログ間のゴシップを備えています（DCP-03 §4）。ログはメモリーに保持されるため、再起動すると空になります。Fly.io の設定は `deploy/fly/transparency-log.toml` にあります。

<a id="comparison-anchoring-methods"></a>

## 比較（アンカリングの方法）

このリポジトリでは手数料を測定していません。手数料は各チェーンの市場によって変わるので、選ぶ前に確認してください。

1. **透明性ログのみ**（ブロックチェーンなし）— オペレーターがルートに署名します。チェーンの手数料はかかりません。信頼はオペレーター + 監査人に置かれます。オペレーターが信頼できる機関（例：政府）である場合に適しています。
2. **透明性ログ + Bitcoin へのバッチのアンカー** — ログがエントリを蓄積し、N 時間ごとにルートを Bitcoin にアンカーします（OP_RETURN のトランザクション 1 件）。手数料はエントリごとではなくトランザクションごとに支払うので、バッチ全体で分担します。国全体のログに公開の不変性を与えられます。
3. **ハッシュごとの Bitcoin の OP_RETURN** — bundle_hash ごとに 1 つのトランザクション、つまりハッシュごとに 1 つの手数料がかかります。少量または高価値のバンドルでのみ実用的です。
4. **Ethereum の L2（Arbitrum、Base、Optimism）** — ハッシュごと、またはバッチのルートごとのイベントで、L2 のガスで支払います。スマートコントラクトから照会できます。
5. **Ethereum のメインネット** — メインネットでのイベントごとのガス。メインネットのコントラクトからオンチェーンで照会できることが必要な場合にのみ妥当です。

政府規模のログでは、選択肢 2（ログ + Bitcoin へのバッチ）が、公開での検証可能性のためにバッチごとに 1 つの手数料を支払う形になります。

<a id="published-artefacts-current-state"></a>

## 公開済みの成果物（現在の状態）

プロトコルは以下のどれも必要としません。オペレーターがソースからビルドしなくて済むようにするための便宜的な配布物です。すべてをリポジトリの外で動かすことも、引き続き完全にサポートされています。

- **リポジトリ：** `github.com/dcp-ai-protocol/dcp-ai`（Apache-2.0）。誰でもミラーやフォークができます。
- **SDK：** それぞれのネイティブなレジストリ（npm、PyPI、crates.io、Go モジュール）で公開されています。バージョンはそれぞれ異なり、`main` より遅れていることがあります。[README](../README.md) と各 SDK の *Release status* を参照してください。
- **サービスのイメージ：** 4 つのオプションのサービス（検証、アンカー、透明性ログ、失効レジストリ）は、GHCR のマルチアーキテクチャの Docker イメージとして配布されています。これらはリファレンスサービスで、状態をメモリーに保持し（失効サービスはファイルを使える）、アンカーサービスはまだチェーンに送信しません（[OPERATOR_GUIDE.md](OPERATOR_GUIDE.md#reference-services-keep-state-in-memory-only)）。
    - `ghcr.io/dcp-ai-protocol/dcp-ai/verification`
    - `ghcr.io/dcp-ai-protocol/dcp-ai/anchor`
    - `ghcr.io/dcp-ai-protocol/dcp-ai/transparency-log`
    - `ghcr.io/dcp-ai-protocol/dcp-ai/revocation`
- **スマートコントラクト：** `contracts/ethereum/DCPAnchor.sol` は Foundry のプロジェクトで、Base、Optimism、Arbitrum にデプロイできます。[`contracts/ethereum/DEPLOY.md`](../contracts/ethereum/DEPLOY.md) を参照してください。
- **正規のレジストリはない：** DCP-AI は、中央の「DCP レジストリ」もホスト型の検証エンドポイントも運用していません。`dcp-ai.org` が配信するのはランディングページ、ドキュメント、プレイグラウンド、VC 用の JSON-LD のコンテキスト（`/credentials/v2`）で、誰かのためにバンドルを検証することはありません。
- **まとめ：** デプロイに必要なインフラはすべて、組み込む SDK か、自分で動かすコンテナーとして利用できます。アンカリングは引き続き既存の公開チェーンを使い、公開済みの成果物のどれもプロトコルの依存関係ではありません。

---

<a id="v20-storage-extensions"></a>

## V2.0 のストレージの拡張

DCP v2.0 は、ポスト量子への備えとして、二重ハッシュチェーン、PQ チェックポイント、拡張されたバンドルのマニフェストを導入します。

<a id="dual-hash-chains"></a>

### 二重ハッシュチェーン

V2.0 の監査証跡は、多層防御のために 2 つの並行したハッシュチェーンを保持します。

```
Entry N:
  primary_hash   = SHA-256(canonical(entry_N))
  secondary_hash = SHA3-256(canonical(entry_N))
  prev_hash      = SHA-256(canonical(entry_N-1))       // or "GENESIS"
  prev_hash_secondary = SHA3-256(canonical(entry_N-1)) // or "GENESIS"
```

二次チェーンはオプションです（監査エントリのスキーマの `prev_hash_secondary` と `intent_hash_secondary`）。仕様は、二次チェーンが存在する場合はそれを独立に検証することを要求しています（[VERIFICATION.md、V2-11](../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present)）。これは多層防御の設計であり、その保護は、実際に両方のチェーンを確認し、信頼できるコミットメントを保持することにかかっています。

**実装の状況（2026 年 10 月 28 日）：** 履歴として残す以下の 2026 年 10 月 27 日の状況で説明している確認は、`@dcp-ai/sdk` 2.2.1、`@dcp-ai/wasm` 2.1.1、`dcp-ai` 2.10.1（PyPI）、Go v2.11.1、Rust `dcp-ai` 2.11.1 以降で公開されています（[公開済みバージョン](README.md#published-versions)）。存在しないフィールドは引き続き要求されないため、検証に成功しても完全な二次チェーンは示されません。それより前のバージョンは二次フィールドを確認しません。公開済みのアダプター `@dcp-ai/express`、`@dcp-ai/openclaw`、`@dcp-ai/anthropic-mcp`、`@dcp-ai/google-a2a` 2.1.0 は再公開していません。これらは `@dcp-ai/sdk` `^2.2.0` に依存しており、ロックファイルが `@dcp-ai/sdk` 2.2.1 以降を解決すると二次の確認が行われます。

**実装の状況（2026 年 10 月 27 日）：** 未公開のソースコードでは、TypeScript、Python、Go、Rust の V2 バンドルの検証器と、Rust SDK からの WASM ビルドが、存在するすべての二次フィールドを確認します（[VERIFICATION.md の V2-11 とその正誤](../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present)）。各 `prev_hash_secondary` を直前のエントリーと、各 `intent_hash_secondary` を意図と、`audit_merkle_root_secondary` をエントリーと照合します。存在しないフィールドは要求されないため、検証に成功しても、バンドルが完全な二次チェーンを持つことは示されません。実験的な候補の経路もこれらの確認を再利用します。[公開済みバージョン](README.md#published-versions)に載っている公開済みのパッケージはこの変更より前のもので、二次フィールドを確認しません。この変更を含むリリースが出るまでは、それらによる検証の成功を、二次チェーンが一貫していることの証拠と解釈しないでください。

マークルツリーは一次（SHA-256）のチェーンに対して計算されます。SHA3-256 のハッシュに対する二次のマークルルートは、`audit_merkle_root_secondary` としてバンドルのマニフェストに含まれます。

<a id="pq-checkpoints"></a>

### PQ チェックポイント

V2.0 は、監査証跡に対するポスト量子のチェックポイントを導入します。一連の監査エントリを対象とし、エージェントが複合署名（Ed25519 + ML-DSA-65）で署名する記録です。その形は [`schemas/v2/pq_checkpoint.schema.json`](../schemas/v2/pq_checkpoint.schema.json) です。

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

バンドルはチェックポイントを `pq_checkpoints` に持ち、署名済みのマニフェストはその ID を列挙します。検証者は `spec/VERIFICATION.md` の V2-12 のとおりにそれらを確認します。

チェックポイントの頻度はセキュリティティアによります。

| ティア | チェックポイントの間隔 | 目的 |
|------|-------------------|---------|
| Routine | 50 イベントごと | 軽量な保証 |
| Standard | 10 イベントごと | 定期的な PQ の検証 |
| Elevated | すべてのイベント | 継続的な PQ の完全性 |
| Maximum | すべてのイベント + 検証 | 即時の PQ の検証 |

信頼できる PQ 検証鍵と有効な PQ 署名があれば、チェックポイントは、後にクラシカルな署名が破られた場合でも、対象の監査エントリに対するマークルのコミットメントを認証します。チェックポイントのスキーマにはタイムスタンプのフィールドがなく、この署名はイベントがいつ発生したかを証明するものではありません。

<a id="v20-bundle-manifest"></a>

### V2.0 のバンドルのマニフェスト

V2.0 のバンドルには、すべてのアーティファクトのハッシュをあらかじめ計算したマニフェストが含まれます。

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

フィールドは [`schemas/v2/bundle_manifest.schema.json`](../schemas/v2/bundle_manifest.schema.json) のものです。オプションの `session_issued_at`、`session_expires_at`、`intended_verifier` もあります。`session_nonce`（256 ビットの乱数）はすべてのアーティファクトを 1 つのセッションに結び付けるため、あるセッションのアーティファクトを別のセッションに混ぜることはできません。ただし、バンドル全体が再び提示されることは防ぎません（[SECURITY_MODEL.md](SECURITY_MODEL.md#9-cross-artifact-replay)）。マニフェストはバンドルの署名に含まれるため、その完全性が保証されます。

<a id="bundle-size-considerations-v20"></a>

### バンドルのサイズに関する考慮事項（V2.0）

V2.0 のバンドルは、複合署名と二重ハッシュのため V1 より大きくなります。

| 要素 | V1 のサイズ | V2 のサイズ | 注記 |
|-----------|---------|---------|-------|
| Ed25519 の署名 | 64 バイト | 64 バイト | 変更なし |
| ML-DSA-65 の署名 | — | 約 3,300 バイト | V2 で新規 |
| SHA-256 のハッシュ | それぞれ約 32 バイト | それぞれ約 32 バイト | 変更なし |
| SHA3-256 のハッシュ | — | それぞれ約 32 バイト | V2 で新規 |
| PQ チェックポイント | — | 約 3,500 バイト | V2 で新規 |
| マニフェスト | — | 約 500 バイト | V2 で新規 |
| **典型的なバンドル** | **約 1〜2 KB** | **約 10〜50 KB** | 推定値。監査証跡の長さとティアによる（仕様 §14.1） |

帯域幅が限られた環境のために、V2.0 は JSON より小さい CBOR のワイヤ形式（RFC 8949）を定義しています。このリポジトリは、その削減量の測定結果を公開していません。

<a id="anchoring-v20-bundles"></a>

### V2.0 のバンドルのアンカリング

アンカリングのモデルは同じまま（オンチェーンにはハッシュのみ）ですが、V2.0 は次のものを加えます。
- **二重ハッシュのアンカリング**（設計）：バンドルの SHA3-256 のハッシュを SHA-256 のものと並べてアンカーできる可能性がある。このリポジトリには、それを定義する成果物やツールはまだない
- **PQ で署名したログのルート**（設計）：透明性ログのルートに複合署名を付けられる可能性がある。リファレンスのログは Ed25519 だけで署名している
- **OP_RETURN の形式**（推奨する慣例）：`dcp:v2:<sha256_hex>`（V1 の `dcp:v1:<sha256_hex>` に対して）

ポスト量子のアルゴリズムへの適合の詳細は [NIST_CONFORMITY.md](NIST_CONFORMITY.md) を参照してください。
既存の V1 のアンカー済みデータの移行については [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md) を参照してください。

<a id="reference"></a>

## 参考資料

- 検証のチェックリスト：[spec/VERIFICATION.md](../spec/VERIFICATION.md)
- バンドルの形式：[spec/BUNDLE.md](../spec/BUNDLE.md)
- 技術アーキテクチャ：[TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md)
