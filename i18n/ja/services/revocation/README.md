<sub>[English](../../../../services/revocation/README.md) · [中文](../../../zh-CN/services/revocation/README.md) · [Español](../../../es/services/revocation/README.md) · **日本語** · [Português](../../../pt-BR/services/revocation/README.md)</sub>

<a id="revocation-service"></a>

# 失効サービス

> [英語版](../../../../services/revocation/README.md)の参考訳です（25/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

DCP のエージェントの失効を公開・照会するための HTTP サービスです。V1（エージェント単位）と V2（kid 単位、緊急失効、短期間の証明書の追跡）の両方をサポートします。標準化された照会のための `.well-known` エンドポイントを公開します。

すべての書き込みは認証されます。オペレーターは、新しいエージェントをそれぞれ自己署名の V2 パスポートで登録します
（オペレーターのトークンを付けた `POST /v2/register`）。複合署名が署名鍵の保有を証明するため、サービスはそれらの kid を、
その有効期限とパスポートの緊急失効トークンとともに、そのエージェントのものとして記録します。再登録はセルフサービスで、
失効は登録された鍵で署名されていなければなりません。`REVOCATION_STATE_PATH` でファイルを指定しない限り、状態はメモリ上に
あります（[設定](#configuration)を参照）。

以下の書き込みの例（`POST /revoke`、`POST /v2/register`、`POST /v2/revoke`、`POST /v2/emergency-revoke`）はテンプレート
です。署名、パスポート、秘密値はプレースホルダー（`...`）なので、そのままでは動かず、作り出した値で埋めてはなりません。
本物の値の作り方は `index.test.js` にあります。

<a id="quickstart"></a>

## クイックスタート

```bash
# Start the service, from the root of a checkout: it imports @dcp-ai/sdk, so build the
# workspace SDK and install the root package first
(cd sdks/typescript && npm install && npm run build) && npm install
node services/revocation/index.js

# Or with Docker, from the repo root
docker compose -f docker/docker-compose.yml up revocation
```

サービスは既定で `http://localhost:3003` で待ち受けます。

<a id="v1-endpoints"></a>

## V1 のエンドポイント

### `GET /health`

サービスのヘルスチェック。

```bash
curl http://localhost:3003/health
```

```json
{
  "ok": true,
  "service": "dcp-revocation",
  "supported_versions": ["1.0", "2.0"],
  "registered_agents": 2,
  "total_revocations": 3,
  "total_kid_revocations": 1
}
```

### `POST /revoke`

エージェント単位の失効（V1）を公開します。`signature` は、送られたとおりの `{ dcp_version, agent_id, human_id, timestamp, reason }`
の V1 正規化 JSON（`tools/crypto.js` の `signObject`）に対する Ed25519 の署名（base64）で、エージェントの有効な（登録済みで、
失効しておらず、期限切れでない）`ed25519` 鍵のいずれかで作られたものです。エージェントは先に `POST /v2/register` で登録して
いなければならず、それにはパスポートのハイブリッド署名が必要です。Ed25519 だけの（V1）エージェントは、ここで失効を公開でき
ません。

```bash
curl -X POST http://localhost:3003/revoke \
  -H "Content-Type: application/json" \
  -d '{
    "dcp_version": "1.0",
    "agent_id": "agent:research-bot-001",
    "human_id": "human:alice-001",
    "timestamp": "2026-03-01T00:00:00Z",
    "reason": "Compromised credentials",
    "signature": "base64-signature..."
  }'
```

**リクエストボディ：**

| フィールド | 型 | 必須 | 説明 |
|-------|------|----------|-------------|
| `agent_id` | `string` | はい | 失効させるエージェントの ID |
| `human_id` | `string` | いいえ | 責任を負う人間の ID |
| `reason` | `string` | はい | 失効の理由 |
| `signature` | `string` | はい | ほかのフィールドに対する Ed25519 の署名 |
| `dcp_version` | `string` | いいえ | DCP のバージョン（既定：`"1.0"`） |
| `timestamp` | `string` | いいえ | ISO 8601（既定：現在時刻） |

リクエストに含めなかったフィールドは、署名対象のオブジェクトにも含まれません。既定値は後から補われます。

**レスポンス（201）：**

```json
{
  "ok": true,
  "agent_id": "agent-001",
  "revoked_at": "2026-03-01T00:00:00.000Z"
}
```

**エラーレスポンス：** 400（フィールドの欠落）、403（署名がエージェントの登録済みの `ed25519` 鍵で検証できない）、409（エージェントは
すでに失効済み。失効は最終的なものなので、緊急失効を上書きすることはできません）。

### `GET /check/:agent_id`

エージェントが失効しているかどうかを確認します。

```bash
curl http://localhost:3003/check/agent-001
```

**失効したエージェント：**

```json
{
  "revoked": true,
  "record": {
    "dcp_version": "1.0",
    "agent_id": "agent-001",
    "human_id": "human-001",
    "timestamp": "2026-03-01T00:00:00.000Z",
    "reason": "Compromised credentials",
    "signature": "base64-signature..."
  }
}
```

**失効していないエージェント：**

```json
{
  "revoked": false,
  "agent_id": "agent-001"
}
```

### `GET /list`

エージェント単位の失効をすべて一覧します。

```bash
curl http://localhost:3003/list
```

```json
{
  "revocations": [...],
  "total": 3
}
```

---

<a id="v2-endpoints"></a>

## V2 のエンドポイント

### `POST /v2/register`

エージェントの鍵と緊急失効トークンを登録します。ボディはエージェントの自己署名のパスポートで、それが列挙する鍵によって
`DCP-AI.v2.AgentPassport` のもとで署名された `AgentPassportV2` の `SignedPayload`（SDK で作ったバンドルの `agent_passport`）
です。複合署名は `pq_over_classical` でなければなりません。

**新しい** `agent_id` の登録には `Authorization: Bearer <OPERATOR_TOKEN>` が必要です。パスポートは自己署名にすぎず、RPR も
同じなので、信頼のアンカーがなければ、誰でも被害者の `agent_id` を先に名乗り、自分のトークンを仕込んで緊急失効させることが
できてしまいます。そこで、新しいエージェントについてはオペレーターが保証し、`OPERATOR_TOKEN` が設定されていなければ誰も
登録できません。既存のエージェントの再登録にはトークンは不要です。

```bash
curl -X POST http://localhost:3003/v2/register \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "signed_passport": { "payload": { "dcp_version": "2.0", "agent_id": "...", "keys": [...], "emergency_revocation_token": "sha256:...", ... }, "payload_hash": "sha256:...", "composite_sig": { ... } } }'
```

- 登録されるのは 2 つの署名鍵（クラシカル + PQ）だけです。他人の公開鍵を列挙しても何も登録されません。それらの
  `expires_at` が、`GET /v2/check/kid/:kid` の `expired` の回答を決めます。
- `agent_id` を再登録する（たとえばトークンを差し替える）には、署名済みのパスポートは公開されており古いものを再送できる
  ため、`created_at` が登録済みのものより新しく、かつエージェントの有効なクラシカル鍵と PQ 鍵（失効しておらず、期限切れでない
  もの）だけで署名されたパスポートが必要です。登録済みの鍵のエントリはそのまま保持されるため、新しいパスポートで鍵の
  `expires_at` を延ばしたり鍵を追加したりはできず、トークンのないパスポートでは登録済みのトークンが残ります。
- 有効なクラシカル鍵または PQ 鍵を失った（期限切れ、または kid 単位で失効した）エージェントはロックされたままです。そうで
  なければ、残った鍵が新しい相方の鍵と組んでエージェントを乗っ取れてしまうからです。復旧は、緊急失効トークン（失効させて
  から新しい `agent_id` を登録する）か、オペレーターを通じて行いますが、オペレーター向けの API はまだありません。

**レスポンス（201）：**

```json
{ "ok": true, "agent_id": "agent-001", "registered_kids": ["a1b2...", "c3d4..."] }
```

**エラーレスポンス：** 400（V2 の署名付きパスポートでない、有効な `created_at` がない、トークンや鍵の有効期限の形式が
不正）、401（オペレーターのトークンのない新しい `agent_id`）、403（署名が無効、またはエージェントが緊急失効済み）、
409（エージェントがほかの鍵で登録済み、パスポートが登録済みのものより新しくない、エージェントに有効なクラシカル鍵または
PQ 鍵がない、または kid が失効済み・期限切れ・ほかのエージェントのもの）、429（このクライアントからの呼び出しが
`REGISTRATIONS_PER_HOUR` を超えた）、507（`MAX_AGENTS` に達した）。

### `POST /v2/revoke`

複合署名による kid 単位の失効です。`composite_sig` は、それを除いた記録（送られたとおりの `dcp_version`、`agent_id`、
`human_id`、`revoked_kid`、`timestamp`、`reason`）に、`DCP-AI.v2.Revocation` のもとで、エージェントの有効な鍵で署名します。
`revoked_kid` はその登録済みの kid のいずれかでなければなりません。

```bash
curl -X POST http://localhost:3003/v2/revoke \
  -H "Content-Type: application/json" \
  -d '{
    "dcp_version": "2.0",
    "agent_id": "agent-001",
    "human_id": "human-001",
    "revoked_kid": "a1b2c3d4e5f6...",
    "reason": "key_compromise",
    "composite_sig": {
      "classical": { "alg": "ed25519", "kid": "abc123", "sig_b64": "..." },
      "pq": { "alg": "ml-dsa-65", "kid": "def456", "sig_b64": "..." },
      "binding": "pq_over_classical"
    }
  }'
```

**リクエストボディ：**

| フィールド | 型 | 必須 | 説明 |
|-------|------|----------|-------------|
| `dcp_version` | `string` | はい | `"2.0"` でなければならない |
| `agent_id` | `string` | はい | エージェントの ID |
| `human_id` | `string` | いいえ | 責任を負う人間の ID |
| `revoked_kid` | `string` | はい | 失効させる鍵の識別子 |
| `reason` | `string` | はい | 失効の理由 |
| `composite_sig` | `object` | はい | 複合署名：クラシカルと PQ の両方が必須（クラシカルだけの署名は拒否されます） |

**レスポンス（201）：**

```json
{
  "ok": true,
  "agent_id": "agent-001",
  "revoked_kid": "a1b2c3d4e5f6...",
  "revoked_at": "2026-03-01T00:00:00.000Z"
}
```

**エラーレスポンス：** 400（フィールドまたは `dcp_version` の欠落）、403（`revoked_kid` が `agent_id` の登録済みの鍵でない、
または `composite_sig` がエージェントの鍵で検証できない）。

### `POST /v2/emergency-revoke`

緊急失効（パニックボタン）。パスポートとともに登録された `emergency_revocation_token` の原像を使って、エージェントの
すべての鍵を失効させます。クライアントの IP（ソケットのアドレス、または `TRUST_PROXY=true` のときは `X-Forwarded-For` の
最後のホップ）ごとに、1 分あたり 5 回までに制限されています。

```bash
curl -X POST http://localhost:3003/v2/emergency-revoke \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "agent-001",
    "revocation_secret": "a1b2c3d4e5f6..."
  }'
```

**リクエストボディ：**

| フィールド | 型 | 必須 | 説明 |
|-------|------|----------|-------------|
| `agent_id` | `string` | はい | 失効させるエージェントの ID |
| `human_id` | `string` | いいえ | 責任を負う人間の ID |
| `revocation_secret` | `string` | はい | 登録済みのトークンの原像（16 進数 64 文字） |
| `reason` | `string` | いいえ | 理由（既定：`"key_compromise_emergency"`） |
| `timestamp` | `string` | いいえ | ISO 8601（既定：現在時刻） |

**レスポンス（200）：**

```json
{
  "ok": true,
  "agent_id": "agent-001",
  "revoked_at": "2026-03-01T00:00:00.000Z",
  "keys_revoked": 2
}
```

**エラーレスポンス：** 400（形式の誤り）、403（秘密値が無効）、404（トークンが未登録）、409（トークンは使用済み）、429（レート制限）。

`POST /v2/register-emergency-token` と `POST /v2/register-key-expiry` は削除されました。署名のないリクエストを受け付けて
いたため、誰でもトークンを差し替えたり、任意の鍵を期限切れにしたりできたからです。トークンと鍵の有効期限は、現在は署名付きの
パスポート（`POST /v2/register`）から取得します。

### `GET /v2/check/kid/:kid`

登録済みの鍵識別子が失効しているかどうかを確認します。kid の明示的な失効、その所有者の緊急失効、または期限切れです。
サービスが知っているのは、エージェントの登録（`POST /v2/register`）に署名した kid だけです。それ以外の kid には **404**
`{ "registered": false }` が返ります。これには、パスポートに列挙されているが署名していない kid、ゲートウェイでローテーション
された kid、ここで登録されたことのないエージェントの kid が含まれ、それらのここでの状態は「失効していない」ではなく不明です。
`?agent_id=` は無視されるため、呼び出し側がある kid についてほかのエージェントの判定を借りることはできません。

```bash
curl "http://localhost:3003/v2/check/kid/a1b2c3d4e5f6"
```

**失効した鍵：**

```json
{
  "revoked": true,
  "kid": "a1b2c3d4e5f6",
  "agent_id": "agent-001",
  "reason": "key_compromise",
  "revoked_at": "2026-03-01T00:00:00.000Z"
}
```

**有効な鍵：**

```json
{ "revoked": false, "kid": "a1b2c3d4e5f6" }
```

### `GET /v2/list`

エージェント単位と kid 単位を含む、すべての失効を一覧します。

```bash
curl http://localhost:3003/v2/list
```

```json
{
  "dcp_version": "2.0",
  "agent_revocations": [...],
  "kid_revocations": [...],
  "total_agents": 2,
  "total_kids": 5
}
```

---

<a id="shared-endpoints"></a>

## 共通のエンドポイント

### `GET /.well-known/dcp-revocations.json`

すべての失効（V1 + V2）を照会するための標準化されたエンドポイントです。[RFC 8615](https://tools.ietf.org/html/rfc8615) に従います。

```bash
curl http://localhost:3003/.well-known/dcp-revocations.json
```

```json
{
  "dcp_version": "2.0",
  "updated_at": "2026-03-01T00:00:00.000Z",
  "revocations": [
    {
      "dcp_version": "2.0",
      "agent_id": "agent-001",
      "human_id": "human-001",
      "timestamp": "2026-03-01T00:00:00.000Z",
      "reason": "Compromised credentials",
      "signature": "composite:a1b2c3d4"
    }
  ],
  "kid_revocations": [
    {
      "dcp_version": "2.0",
      "agent_id": "agent-001",
      "revoked_kid": "a1b2c3d4e5f6...",
      "timestamp": "2026-03-01T00:00:00.000Z",
      "reason": "key_compromise"
    }
  ]
}
```

このエンドポイントは次のように使えます。

- どの検証器からも照会できる
- CDN でキャッシュできる
- 本番では静的ファイルとして提供できる

このリストには署名がありません。検証器がそれを信頼するのは、取得元の URL と HTTPS のためなので、CDN や静的なコピーもその信頼を保たなければなりません。キャッシュしたコピーは、最後に更新した時点までの内容でしかなく、新しく追加された失効はコピーが更新されるまで反映されません。ほかのアドミッションの確認と鮮度の要件は引き続き適用されます。アドミッションの失効ソースは、この形式を完全な拒否リストとして読み、取得できない場合は失敗します（[docs/ADMISSION.md](../../../../docs/ADMISSION.md#revocation-sources)）。

<a id="configuration"></a>

## 設定

<a id="environment-variables"></a>

### 環境変数

| 変数 | 既定値 | 説明 |
|----------|---------|-------------|
| `PORT` | `3003` | HTTP のポート |
| `OPERATOR_TOKEN` | — | 新しい `agent_id` を登録するための Bearer トークン。未設定なら新しいエージェントは登録できません |
| `REVOCATION_STATE_PATH` | — | 再起動をまたいで登録と失効を保持するファイル。未設定ならメモリのみ。各書き込みは、fsync した 1 行の JSON として追記されます（再登録では変わった部分だけを記録します）。起動時にファイルを再生し、一時ファイルとアトミックなリネームによって、エントリごとに 1 行へと圧縮します。パスに書き込めない場合やファイルが 512 MB を超える場合、サービスは起動を拒否します |
| `TRUST_PROXY` | — | クライアントの IP を `X-Forwarded-For` に付け加えるプロキシの背後でだけ `true` |
| `REGISTRATIONS_PER_HOUR` | `20` | クライアントごと 1 時間あたりの `POST /v2/register` の呼び出し回数。超えると 429 |
| `MAX_AGENTS` | `10000` | 登録済みのエージェント数。それ以降の新しいエージェントには 507 が返ります（何も追い出されません） |

`REVOCATION_STATE_PATH` がない場合、状態はメモリ上にあり、再起動、デプロイ、クラッシュの後には**残りません**。登録とすべての
失効が失われるため、失効したエージェントがふたたび有効に見えます。Fly では、ファイルをボリュームに置いてください
（`deploy/fly/revocation.toml` を参照）。Docker Compose のスタックは、それを `revocation-data` ボリュームに保持します。上の
制限は、大量の登録によってサービスがメモリ不足になるのを防ぎます。記録にも上限があります。
- `human_id`、`timestamp`、`reason` は最大 256 文字で、V2 の `reason` は `key_compromise`、`key_rotation`、`administrative`、
  `key_compromise_emergency` のいずれかです。
- `emergency_revocation_token` は `sha256:<64 hex>` でなければなりません。
- `composite_sig` は署名のフィールドだけが保存されます。

<a id="integration"></a>

## 統合

<a id="querying-from-middleware"></a>

### ミドルウェアからの照会

Express のミドルウェアの `checkRevocation: true` は、リクエストのたびに `GET /check/:agent_id` と `GET /v2/check/kid/:kid` を照会します。サービスが応答しないときは、`revocationFailClosed: true` でない限りリクエストを通します。アドミッション（Express、FastAPI、OpenClaw、リファレンスのゲートウェイで、strict-v1 プロファイルを使う場合）は、代わりに `/.well-known/dcp-revocations.json` を拒否リストとして読み、読めないときはリクエストを拒否します。

<a id="v2-flow"></a>

### V2 の流れ

1. オペレーターが、セットアップ時にエージェントの署名付きパスポートを登録する（オペレーターのトークンを付けた `POST /v2/register`）：鍵、その有効期限、緊急トークン
2. 必要に応じて、エージェントの鍵で署名して個別の鍵を失効させる（`POST /v2/revoke`）
3. 緊急時にはパニックボタンを使う（`POST /v2/emergency-revoke`）
4. バンドルを受け入れる前に鍵の状態を確認する（`GET /v2/check/kid/:kid`）

<a id="development"></a>

## 開発

```bash
PORT=3003 node services/revocation/index.js   # from the repo root, after npm install there

curl http://localhost:3003/health
curl http://localhost:3003/check/test-001
curl http://localhost:3003/v2/list
curl http://localhost:3003/.well-known/dcp-revocations.json

# Writes need signatures; index.test.js builds signed passports and revocations
node --test services/revocation/index.test.js   # from the repo root
```

<a id="license"></a>

## ライセンス

Apache-2.0
