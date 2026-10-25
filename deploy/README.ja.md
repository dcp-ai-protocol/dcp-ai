<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · **日本語** · [Português](README.pt-BR.md)</sub>

<a id="deploying-dcp-ai-services"></a>

# DCP-AI のサービスのデプロイ

> [英語版](README.md)の参考訳です（25/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

このリポジトリに含まれる 4 つのサービス — **verification**、**anchor**、
**transparency-log**、**revocation** — は、GitHub Container Registry（GHCR）上の
ビルド済みの Docker イメージとして配布されています。どのコンテナホストでも
実行できます。以下に、よく使われる流れを示します。

<a id="images"></a>

## イメージ

| サービス | イメージ | 既定のポート |
|---|---|---|
| 検証 | `ghcr.io/dcp-ai-protocol/dcp-ai/verification` | 3000 |
| アンカー | `ghcr.io/dcp-ai-protocol/dcp-ai/anchor` | 3001 |
| 透明性ログ | `ghcr.io/dcp-ai-protocol/dcp-ai/transparency-log` | 3002 |
| 失効 | `ghcr.io/dcp-ai-protocol/dcp-ai/revocation` | 3003 |

タグ（[`publish-docker.yml`](../.github/workflows/publish-docker.yml) を参照）：ワークフローを起動する `main` への push は
`:latest`、`:main`、`:sha-xxxxxxx` を公開します。公開されたリリースは、その semver のタグ（`:<major>.<minor>.<patch>`、
`:<major>.<minor>`、`:<major>`）を加え、可変の `:latest` を動かすこともあります。`linux/amd64` と `linux/arm64` の両方が
ビルドされます。

ノート PC での簡単な動作確認：

```bash
docker run --rm -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest
# in a second terminal, while the container runs in the foreground
curl http://localhost:3000/health
```

`/health` が示すのは、プロセスが HTTP に応答することだけです。永続化、アンカリング、ゴシップ、本番への準備状況については
何もわかりません。

---

<a id="option-1--docker-compose-self-host-simplest"></a>
<a id="option-1-docker-compose-self-host-simplest"></a>

## 方法 1 — Docker Compose（セルフホスト、最も簡単）

リポジトリには、4 つのサービスを 5 つのコンテナで、2 つの透明性ログとともにつなぐ、すぐに使える compose ファイルが
あります。ログがゴシップを行うのは、それぞれが固定の `OPERATOR_KEY` を持ち、相手の公開鍵を固定している場合だけです
（[`docker/README.md`](../docker/README.md) を参照）。そうでなければ、互いに問い合わせますが、相手のツリーヘッドは無視します。

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai
cd dcp-ai/docker
docker compose up -d
```

公開されるサービス：

- `http://localhost:3000` — 検証
- `http://localhost:3001` — アンカー
- `http://localhost:3002` — 透明性ログ（log-alpha）
- `http://localhost:3012` — 透明性ログ（log-beta、ゴシップのピア）
- `http://localhost:3003` — 失効

ソースからビルドする代わりに GHCR で公開されたイメージを使うには、`docker/docker-compose.yml` を編集し、各 `build:` の
ブロックを `image:` の行に置き換えます。たとえば：

```yaml
services:
  verification:
    image: ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest
```

---

<a id="option-2--flyio-managed"></a>
<a id="option-2-flyio-managed"></a>

## 方法 2 — Fly.io（マネージド）

```bash
# one-time setup
brew install flyctl
fly auth login
cd deploy/fly
```

各サービスをデプロイします（このディレクトリの `.toml` ファイルは GHCR から取得するように設定済みで、ソースのビルドは不要です）。

```bash
fly launch --config verification.toml    --no-deploy
# admin endpoints and registering new agent_ids
fly secrets set --app dcp-ai-verification OPERATOR_TOKEN="$(openssl rand -hex 32)"
fly deploy --config verification.toml

fly launch --config anchor.toml          --no-deploy
# on-chain submission is not implemented: no RPC URL, wallet key or contract is read
fly secrets set --app dcp-ai-anchor OPERATOR_TOKEN="$(openssl rand -hex 32)"   # unlocks POST /flush
fly deploy --config anchor.toml

fly launch --config transparency-log.toml --no-deploy
fly secrets set --app dcp-ai-transparency-log \
  OPERATOR_KEY="$(openssl rand -hex 32)" \
  GOSSIP_PEERS="https://<your-second-log>.fly.dev#<its /health public_key>"
fly deploy --config transparency-log.toml

fly launch --config revocation.toml      --no-deploy
fly deploy --config revocation.toml
```

各サービスには `https://dcp-ai-verification.fly.dev` のような公開の HTTPS の URL が割り当てられます。検証のアプリでは、これによりトークン不要で署名も検証しない DCP-05 から DCP-09 のエンドポイントも公開されます（運用上の注意を参照）。

`#<public key>` のないゴシップのピアは問い合わせを受けますが、そのツリーヘッドは無視されます。

状態はメモリ上にあります。検証、失効、透明性ログの設定は、アイドル時にレジストリが消えないよう 1 台のマシンを動かし
続けますが、デプロイや再起動では引き続き空の状態から始まります。アンカーの設定はマシンの停止を許す
（`min_machines_running = 0`）ため、保留中のハッシュとローカルの記録は失われます。再起動をまたいで状態を保持できるのは
失効サービスだけで、`revocation.toml` のコメントのとおり `REVOCATION_STATE_PATH` をボリュームに置きます。透明性ログには
永続化の選択肢はありません。
失効のアプリにも `OPERATOR_TOKEN` を設定してください。そこで新しい `agent_id` を登録するのに必要だからです。また、
`POST /flush` や `POST /gossip/peers` が必要なら、アンカーと透明性ログのアプリにも設定してください。

本番では、異なるリージョンに**2 つ**の透明性ログのインスタンスを置き、それぞれに独自の `OPERATOR_KEY` を持たせ、相手の公開鍵を固定したうえで `GOSSIP_PEERS` で互いを指すようにします。ゴシップは署名付きのツリーヘッドを比較し、同じサイズの 2 つのヘッドのルートが異なるとアラートを出します（DCP-03 §4）。これがスプリットビューを明らかにするのは、両方のログが同じエントリを同じ順序で持つはずの場合だけです。ログどうしはエントリを複製しないため、正当に異なるエントリを受け取った 2 つのログでもアラートが出ます。また、サイズの異なるヘッドは比較されません（一貫性の証明はありません）。

---

<a id="option-3--google-cloud-run-pay-per-request"></a>
<a id="option-3-google-cloud-run-pay-per-request"></a>

## 方法 3 — Google Cloud Run（リクエストごとの課金）

```bash
gcloud run deploy dcp-ai-verification \
  --image ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest \
  --port 3000 \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars="DCP_VERSION=2.0,VERIFIER_MODE=hybrid_required"
```

各サービスについて繰り返します。Cloud Run はアイドル時にゼロまで縮小し、これらのサービスは状態をメモリに保持するため、
ゼロまで縮小したり再起動したりしたインスタンスは空の状態から始まります（運用上の注意を参照）。

---

<a id="option-4--railway-one-click-credit-card-required-for-deploy"></a>
<a id="option-4-railway-one-click-credit-card-required-for-deploy"></a>

## 方法 4 — Railway（ワンクリック、デプロイにはクレジットカードが必要）

Docker イメージから新しいプロジェクトを作成します。各サービスについて、GHCR のイメージの URL を貼り付け、対応する `deploy/fly/*.toml` の環境変数を設定します。

---

<a id="operating-notes"></a>

## 運用上の注意

- **アンカー**：オンチェーンへの送信は実装されていません。`contracts/ethereum/src/DCPAnchor.sol` をデプロイして `ANCHOR_CONTRACT` を設定しても有効にはなりません。`ANCHOR_RPC_URL`、`ANCHOR_PRIVATE_KEY`、`ANCHOR_CONTRACT` は読まれない（`ANCHOR_RPC_URL` を設定しても警告がログに出るだけ）ため、サービスにウォレットの鍵を渡さないでください。`tx_hash: null` と `onchain: false` でローカルのメモリに記録を保持します。
- **透明性ログ**：メモリ上のみで、永続化の選択肢はありません。再起動すると新しい空のツリーから始まり、ボリュームを使っても変わりません。固定の `OPERATOR_KEY` を使えば、再起動をまたいで同じ署名鍵を保てます。
- **失効**：レジストリが権威を持つのは、あなたのポリシーのすべての検証器が*この* URL を指す場合だけです。その URL を `.well-known/dcp-capabilities.json` で公開してください。永続的なストレージ上の `REVOCATION_STATE_PATH` がなければ、再起動ですべての登録と失効が忘れられます。
- **検証**：ステートレスではありません。パスポート、鍵、監査チェーン、DCP-05–09 の記録をメモリに保持し、別々のインスタンスはそれらを共有しないため、ロードバランサーの背後に複数のインスタンスを置くと応答が食い違います。インスタンスは 1 つだけで動かしてください。
- **検証、DCP-05 から DCP-09 のエンドポイント**：トークン不要で署名も検証せず、`OPERATOR_TOKEN` でも保護されないため、公開デプロイ（Fly、または `--allow-unauthenticated` を付けた Cloud Run）に到達できる人なら誰でも、ライフサイクル、紛争、マンデートの状態を変更できます。その前段に独自の認可を置くか、ルーティングしないでください（[docs/OPERATOR_GUIDE.md](../docs/OPERATOR_GUIDE.md#dcp-0509-service-endpoints)）。

---

## CI/CD

リポジトリの [`publish-docker.yml`](../.github/workflows/publish-docker.yml) ワークフローは、公開されたリリースのたび、手動での起動時、そして `server/`、`services/`、`lib/`、`tools/`、`schemas/`、`docker/Dockerfile`、またはワークフロー自体に触れる `main` への push のたびに、これらのイメージをビルドし直して push します。イメージはワークスペースの SDK（`sdks/typescript/`）もビルドしますが、SDK だけを変更する push では再ビルドは起動しません。

デプロイの前に、実行するイメージのダイジェストを、選んだコミットに対する公開ワークフローの成功した実行までたどってください。`:latest` は可変で、そのリビジョンであることを保証しません。選んだコミットのイメージがない場合は、そのチェックアウトからビルドしてください（リポジトリのルートから `docker build -f docker/Dockerfile --target <service> .`）。
