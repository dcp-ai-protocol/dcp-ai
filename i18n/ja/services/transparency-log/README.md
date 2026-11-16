<sub>[English](../../../../services/transparency-log/README.md) · [中文](../../../zh-CN/services/transparency-log/README.md) · [Español](../../../es/services/transparency-log/README.md) · **日本語** · [Português](../../../pt-BR/services/transparency-log/README.md)</sub>

<a id="transparency-log-service"></a>

# 透明性ログのサービス

> [英語版](../../../../services/transparency-log/README.md)の参考訳です（05/11/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

Certificate Transparency（CT）に着想を得た、HTTP の透明性ログのサービスです。バンドルのハッシュを、追記専用の RFC 6962 のマークルツリーに、検証可能な包含証明と Ed25519 で署名したツリーヘッドとともに保存します。状態はメモリ上にあり、再起動すると新しい空のツリーから始まります（[永続化](../../../../services/README.md#persistence)を参照）。

<a id="quickstart"></a>

## クイックスタート

```bash
# Start the service, from the root of a checkout after `npm install` there
node services/transparency-log/index.js

# Or with Docker, from the repo root: the Compose stack runs two logs that gossip with each other
docker compose -f docker/docker-compose.yml up transparency-log-a transparency-log-b
```

サービスは既定で `http://localhost:3002` で待ち受けます。

<a id="endpoints"></a>

## エンドポイント

### `GET /health`

サービスのヘルスチェック。

```bash
curl http://localhost:3002/health
```

```json
{
  "ok": true,
  "service": "dcp-transparency-log",
  "log_id": "log-alpha",
  "public_key": "base64 Ed25519 public key that signs STHs",
  "size": 42,
  "gossip_peers": 1,
  "alerts": 0
}
```

### `POST /add`

バンドルのハッシュをログに追加します。`sha256:` の後に小文字の 16 進数 64 文字が続く形式です。それ以外のもの、または
1 MB を超えるボディは 400 になります。

```bash
curl -X POST http://localhost:3002/add \
  -H "Content-Type: application/json" \
  -d '{"bundle_hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"}'
```

```json
{
  "index": 42,
  "leaf_hash": "a1b2c3...",
  "root": "d4e5f6...",
  "size": 43
}
```

### `GET /root`

ログの現在のマークルルートを取得します。

```bash
curl http://localhost:3002/root
```

```json
{
  "root": "d4e5f6...",
  "size": 43
}
```

### `GET /root/signed`

署名付きツリーヘッド（Signed Tree Head、STH）を取得します。`{ log_id, root, size, timestamp }` の正規化した JSON
（キーを整列、`tools/crypto.js` の `signObject`）に対する Ed25519 の署名（base64）です。

```bash
curl http://localhost:3002/root/signed
```

```json
{
  "log_id": "log-alpha",
  "root": "d4e5f6...",
  "size": 43,
  "timestamp": "2025-01-01T00:00:00.000Z",
  "signature": "base64...",
  "public_key": "base64..."
}
```

STH が持つ `public_key` だけでなく、必ず別の経路で固定した公開鍵（起動時に表示され、`/health` にも出ます）に照らして
検証してください。

```js
import { verifyObject } from "./tools/crypto.js";
const { log_id, root, size, timestamp, signature } = sth;
verifyObject({ log_id, root, size, timestamp }, signature, pinnedPublicKey); // true
```

`OPERATOR_KEY` は鍵の 32 バイトのシードなので、署名鍵は再起動後も残ります。ツリーはメモリ上にあるため残りません。
これがない場合、ログは再起動のたびに新しい一時的な鍵で署名します。以前の STH は、古い鍵をアーカイブまたは固定していれば
その鍵で引き続き検証できますが、新しい鍵では検証できません。

### `GET /proof/:index`

インデックスを指定して、エントリのマークル包含証明を取得します。

```bash
curl http://localhost:3002/proof/5
```

```json
{
  "index": 5,
  "leaf_hash": "a1b2c3...",
  "entry": {
    "hash": "sha256:abc123...",
    "leaf_hash": "a1b2c3...",
    "timestamp": "2025-01-01T00:00:00.000Z",
    "index": 5
  },
  "root": "d4e5f6...",
  "proof": [
    { "hash": "x1y2z3...", "direction": "left" },
    { "hash": "m4n5o6...", "direction": "right" }
  ]
}
```

この証明により、ログ全体をダウンロードせずに、エントリがマークルツリーに含まれていることを検証できます。

### `GET /entries`

ログのすべてのエントリを一覧します。

```bash
curl http://localhost:3002/entries
```

```json
{
  "entries": [
    { "hash": "sha256:...", "leaf_hash": "...", "timestamp": "...", "index": 0 },
    { "hash": "sha256:...", "leaf_hash": "...", "timestamp": "...", "index": 1 }
  ],
  "size": 2
}
```

<a id="gossip"></a>

### ゴシップ

| メソッド | パス | 説明 |
|--------|------|-------------|
| GET | `/gossip/peers` | 既知のピアと直近 20 件のアラート |
| POST | `/gossip/peers` | ピア `{ peer_id, endpoint, public_key }` を追加する（http/https のエンドポイント、base64 の Ed25519 鍵）。`Authorization: Bearer <OPERATOR_TOKEN>` が必要です。ログが自らピアに問い合わせるため、開かれたリストは SSRF を許してしまいます |
| POST | `/gossip/exchange` | 固定したピアと STH を交換する `{ sth }`。こちらの STH と、スプリットビューのアラートがあればそれを返す |
| GET | `/gossip/alerts` | スプリットビューのアラート（直近 100 件） |

ピアのツリーヘッドが意味を持つのは、そのピアの**固定した**公開鍵で検証できる場合だけです。`GOSSIP_PEERS` で
`<endpoint>#<base64 Ed25519 public key>` として、または `POST /gossip/peers` の `public_key` として指定してください。
鍵を固定していないピアから取得したツリーヘッド、不正な形式のもの、署名の誤ったものは無視されます。1 回の取得は最大
16 KB を読み、1 間隔（最大 10 秒）で打ち切り、前回の取得が続いている間は開始しません。取得は、`GOSSIP_PEERS` にピアがあればサービスの起動時に、そうでなければ受け付けられた `POST /gossip/peers` が最初のピアを追加した時点で始まります（拒否されたリクエストは何も始めません）。その後は `GOSSIP_INTERVAL_MS` ごとの 1 つの周期的なサイクルがピアを順に取得します。前のサイクルが続いている間はその回を飛ばすため、サイクルが遅い場合やピアが多い場合、各ピアが毎回の間隔で取得されるとは限りません。`/gossip/exchange` は開かれて
いるため、固定したピアが署名した正しい形式の STH（64 桁の 16 進数または null の `root`、整数の `size`）だけを、最大
16 KB のボディで受け付けます（そうでなければ 400 または 403）。固定したピアの
ヘッドを見せられた人は、誰でもそれをここに渡せます。

**ゴシップが検出するもの。** 各ログは、自分が固定したログのヘッドの証人になります。ログは、そのヘッドを検証できる
固定した鍵と、正確な `log_id`（デコードした JSON の文字列）で識別されます。ピア ID やエンドポイントは、そこへの経路
にすぎません。**スプリットビュー**とは、そのようなログが同じツリーのサイズに対して 2 つの異なるルートに署名すること
で、取得、交換、または同じログの 2 つの別名を通じて見つかります。異なるログのヘッドは、サイズや `log_id` にかかわらず
比較されません。互いを固定する 2 つの独立したログはアラートを出しません。サイズの異なるヘッドはここでは何も証明しません。
ログは互いを複製せず、一貫性の証明もありません。ローカルのツリーは、このログ自身の鍵と `LOG_ID` のヘッド（オペレーター
が自分の鍵を固定した場合）とだけ、現在のサイズで比較されます。

**アラート。** アラートは、ログ（`peer_log_id`、`peer_public_key`）、`tree_size`、最初に観測したルート（`observed_root`）
と食い違うルート（`peer_root`）、ヘッドが届いた別名（`peer_id`）、経路（`source`：`poll` または `exchange`）を示します。
`evidence` には、観測したとおりの 2 つのヘッド（署名された 4 つのフィールドと `signature`。`public_key` やほかのメンバー
は含まない）が入ります。アラートの記載を鵜呑みにせず、独立した経路で信頼する鍵と `peer_public_key` を照合した監査者は、
その鍵が両方に署名したことを確認できます。`observed_root` がローカルのツリーのルートになるのは、食い違うヘッドを現在の
ローカルのツリーと比較した場合だけで、それ以外は以前に観測したルートです。`local_root` は既存のクライアントのために、
同じ意味で `observed_root` の非推奨の名前として残ります。アラートは保持している 100 件に対してログ、ツリーのサイズ、
ルートの組で重複が除かれるため、署名付きツリーヘッドをどの別名や経路から再送しても、そのアラートが 100 件の中にある間は
何も増えません。押し出された後は、同じスプリットビューが再び報告されることがあります。

**上限。** ログは、証人となる各ログについて、見たサイズのうち大きい 256 個の各サイズで最初のヘッドを保持します。後から
再送された古い小さなヘッドが新しいものを押し出すことはありません。固定した鍵ごとに追跡する `log_id` は最大 8 個で、その
鍵のそれ以外の `log_id` のヘッドは検証されますが、記録されず、保持したものとも比較されず、通知もありません（ログ自身の
ヘッドは引き続き現在のツリーと比較されます）。これらの上限は固定で、固定した鍵ごとに最大 256 × 8 個のヘッドです。その
ため合計は、オペレーターが固定する鍵の数に応じて増えます。

- **ローテーションと削除。** 別名に新しい鍵を固定し直すか別名を削除すると、どの別名も固定しなくなった鍵で観測したものは
  破棄されます。ほかの別名がまだ固定している鍵や、同じ別名が新しいエンドポイントや同じ鍵の別の base64 表記で固定している
  鍵は、履歴を保ちます。
- **実行中の取得。** 待っている間に別名が削除または再設定された取得は、応答した時点で破棄されます。
- **再起動。** 履歴とアラートはメモリーにあり、再起動で失われるため、それ以前に観測したものはもう比較できません。同じ
  `OPERATOR_KEY` と `LOG_ID` で再起動したログは、同じ識別のもとで空のツリーから始まります。ピアがスプリットビューを報告
  するのは、以前のツリーのヘッドをまだ保持していて、新しいツリーがそのサイズで別のルートに署名した場合だけです。同じ
  エントリを同じ順序で持つ新しいツリーは同じルートになり、何も起こしません。新しい `LOG_ID`（未設定ならランダム）は新しい
  ログです。以前のログを引き継がず、ピアはその履歴をこのログに結びつけません。

<a id="configuration"></a>

## 設定

<a id="environment-variables"></a>

### 環境変数

| 変数 | 既定値 | 説明 |
|----------|---------|-------------|
| `PORT` | `3002` | HTTP のポート |
| `LOG_ID` | ランダム | このログのインスタンスの識別子 |
| `OPERATOR_KEY` | — | STH に署名する鍵の Ed25519 のシード：16 進数 64 文字（`openssl rand -hex 32`）。それ以外の値ではサービスが停止します。未設定なら一時的な鍵を使います |
| `OPERATOR_TOKEN` | — | `POST /gossip/peers` の Bearer トークン。未設定ならロックされます |
| `GOSSIP_PEERS` | — | カンマ区切りのピア。それぞれ `<endpoint>#<base64 Ed25519 public key>`（そのピアの `/health` の `public_key` で、その `OPERATOR_KEY` で決まります）で、`GOSSIP_INTERVAL_MS` ごとに取得します |
| `GOSSIP_INTERVAL_MS` | `30000` | ゴシップの取得間隔 |

<a id="ct-style-format"></a>

## CT 風の形式

このログは Certificate Transparency（RFC 6962）に着想を得た形式に従います。

1. **追記専用：** エントリが削除されたり変更されたりすることはありません
2. **マークルツリー：** RFC 6962 §2.1。`leaf_hash = SHA-256(0x00 || UTF-8(entry.hash))`、内部ノードは
   `SHA-256(0x01 || left || right)` なので、葉が部分木になりすますことはできません。`n` 枚の葉を持つツリーは、`n`
   より小さい最大の 2 のべき乗で分割され、最後のノードが複製されることはありません。
3. **包含証明：** 誰でも証明を使って、エントリがログに存在することを検証できます
4. **署名付きルート：** Ed25519 で署名したツリーヘッド（`GET /root/signed`）

<a id="verifying-an-inclusion-proof"></a>

### 包含証明の検証

エントリがログにあることを検証するには：

1. `GET /proof/:index` で証明を取得する
2. `leaf_hash = SHA-256(0x00 || UTF-8(entry.hash))` を計算する
3. 証明のノードを順に、生のバイト列（16 進数の文字列をデコードしたもの）として組み合わせる：
   - `direction == "left"` なら：`hash = SHA-256(0x01 || proof_hash || current)`
   - `direction == "right"` なら：`hash = SHA-256(0x01 || current || proof_hash)`
4. 最終的な結果は、ログの固定した公開鍵で検証でき、証明の元になったツリー（同じサイズ）を対象とする署名付きツリーヘッドの
   `root` と一致しなければなりません。証明のレスポンスにある `root` だけでは自己申告にすぎず、新しいルートはエントリが
   追加されると一致しなくなります

<a id="development"></a>

## 開発

```bash
# Start in development mode, from the root of a checkout
PORT=3002 node services/transparency-log/index.js

# Test
curl http://localhost:3002/health
curl -X POST http://localhost:3002/add \
  -H "Content-Type: application/json" \
  -d '{"bundle_hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"}'
curl http://localhost:3002/root
curl http://localhost:3002/proof/0
```

<a id="license"></a>

## ライセンス

Apache-2.0
