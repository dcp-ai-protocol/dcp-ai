<sub>[English](README.md) · **中文** · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="revocation-service"></a>

# 撤销服务

> 本文是[英文版](README.md)的参考译文，更新于 25/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

用于发布和查询 DCP 智能体撤销的 HTTP 服务。同时支持 V1（智能体级）和 V2（kid 级、紧急撤销、短期证书跟踪）。提供一个用于标准化查询的 `.well-known` 端点。

每次写入都经过身份验证。运营方用每个新智能体的自签名 V2 护照为其登记（带运营方令牌的 `POST /v2/register`）：复合签名证明了
对签名密钥的持有，因此服务会把这些 kid 记录为该智能体的 kid，连同其有效期和护照中的紧急撤销令牌。重新登记是自助的，撤销
必须由已登记的密钥签名。除非 `REVOCATION_STATE_PATH` 指定了一个文件，否则状态保存在内存中（参见[配置](#configuration)）。

下面的写入示例（`POST /revoke`、`POST /v2/register`、`POST /v2/revoke`、`POST /v2/emergency-revoke`）是模板：其中的签名、
护照和秘密值都是占位符（`...`），因此不能按原样运行，也不应填入编造的值。`index.test.js` 展示了如何构建真实的值。

<a id="quickstart"></a>

## 快速开始

```bash
# Start the service, from the root of a checkout: it imports @dcp-ai/sdk, so build the
# workspace SDK and install the root package first
(cd sdks/typescript && npm install && npm run build) && npm install
node services/revocation/index.js

# Or with Docker, from the repo root
docker compose -f docker/docker-compose.yml up revocation
```

该服务默认监听 `http://localhost:3003`。

<a id="v1-endpoints"></a>

## V1 端点

### `GET /health`

服务健康检查。

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

发布一项智能体级撤销（V1）。`signature` 是对按发送原样的 `{ dcp_version, agent_id, human_id, timestamp, reason }` 的 V1
规范化 JSON（`tools/crypto.js` 中的 `signObject`）所作的 Ed25519 签名（base64），使用该智能体的某个有效（已登记、未撤销、
未过期）`ed25519` 密钥生成。该智能体必须先用 `POST /v2/register` 登记，而登记需要护照的混合签名：仅有 Ed25519 的（V1）
智能体无法在这里发布撤销。

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

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|-------|------|----------|-------------|
| `agent_id` | `string` | 是 | 要撤销的智能体的 ID |
| `human_id` | `string` | 否 | 负责人的 ID |
| `reason` | `string` | 是 | 撤销原因 |
| `signature` | `string` | 是 | 对其他字段的 Ed25519 签名 |
| `dcp_version` | `string` | 否 | DCP 版本（默认：`"1.0"`） |
| `timestamp` | `string` | 否 | ISO 8601（默认：当前时间） |

请求中省略的字段也不在被签名的对象中；默认值会在之后补上。

**响应（201）：**

```json
{
  "ok": true,
  "agent_id": "agent-001",
  "revoked_at": "2026-03-01T00:00:00.000Z"
}
```

**错误响应：** 400（缺少字段）、403（签名无法用该智能体已登记的 `ed25519` 密钥验证）、409（智能体已被撤销：撤销是最终的，
因此紧急撤销不能被覆盖）。

### `GET /check/:agent_id`

检查某个智能体是否已被撤销。

```bash
curl http://localhost:3003/check/agent-001
```

**已撤销的智能体：**

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

**未撤销的智能体：**

```json
{
  "revoked": false,
  "agent_id": "agent-001"
}
```

### `GET /list`

列出所有智能体级撤销。

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

## V2 端点

### `POST /v2/register`

登记智能体的密钥及其紧急撤销令牌。请求体是该智能体的自签名护照，即由其所列密钥在 `DCP-AI.v2.AgentPassport` 下签名的
`AgentPassportV2` 的 `SignedPayload`（SDK 构建的 bundle 中的 `agent_passport`）。复合签名必须是 `pq_over_classical`。

登记一个**新的** `agent_id` 需要 `Authorization: Bearer <OPERATOR_TOKEN>`。护照只是自签名的，RPR 也是如此，因此如果没有
信任锚，任何人都可以抢先认领受害者的 `agent_id`，植入自己的令牌并对其执行紧急撤销。因此改由运营方为新智能体担保；如果没有
配置 `OPERATOR_TOKEN`，任何人都无法登记新智能体。重新登记已有的智能体不需要令牌。

```bash
curl -X POST http://localhost:3003/v2/register \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "signed_passport": { "payload": { "dcp_version": "2.0", "agent_id": "...", "keys": [...], "emergency_revocation_token": "sha256:...", ... }, "payload_hash": "sha256:...", "composite_sig": { ... } } }'
```

- 只登记两个签名密钥（经典 + PQ）：列出他人的公钥不会登记任何东西。它们的 `expires_at` 决定 `GET /v2/check/kid/:kid` 的
  `expired` 结果。
- 再次登记某个 `agent_id`（例如为了替换令牌）需要一份 `created_at` 晚于已登记护照的护照，因为已签名的护照是公开的，旧护照
  可能被重放；并且该护照必须恰好由该智能体当前有效的经典密钥和 PQ 密钥（未撤销、未过期）签名。已登记的密钥条目会被保留，
  因此新护照既不能延长某个密钥的 `expires_at`，也不能添加密钥；不带令牌的护照会保留已登记的令牌。
- 失去有效经典密钥或 PQ 密钥（已过期，或已按 kid 撤销）的智能体会保持锁定：否则，它剩下的那个密钥就可以与一个新的搭档密钥
  配对并接管该智能体。恢复需要通过紧急撤销令牌（先撤销，再登记新的 `agent_id`）或通过运营方进行，而运营方目前还没有相应的
  API。

**响应（201）：**

```json
{ "ok": true, "agent_id": "agent-001", "registered_kids": ["a1b2...", "c3d4..."] }
```

**错误响应：** 400（不是 V2 已签名护照、没有有效的 `created_at`，或令牌、密钥有效期格式错误）、401（新的 `agent_id` 没有
运营方令牌）、403（签名无效，或智能体已被紧急撤销）、409（智能体已用其他密钥登记、护照不晚于已登记的护照、智能体没有有效的
经典或 PQ 密钥，或某个 kid 已被撤销、已过期或属于另一个智能体）、429（此客户端的调用次数超过 `REGISTRATIONS_PER_HOUR`）、
507（已达到 `MAX_AGENTS`）。

### `POST /v2/revoke`

带复合签名的 kid 级撤销。`composite_sig` 在 `DCP-AI.v2.Revocation` 下，用该智能体的有效密钥，对不含它本身的记录（按发送
原样的 `dcp_version`、`agent_id`、`human_id`、`revoked_kid`、`timestamp`、`reason`）签名；`revoked_kid` 必须是其已登记的
kid 之一。

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

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|-------|------|----------|-------------|
| `dcp_version` | `string` | 是 | 必须为 `"2.0"` |
| `agent_id` | `string` | 是 | 智能体的 ID |
| `human_id` | `string` | 否 | 负责人的 ID |
| `revoked_kid` | `string` | 是 | 要撤销的密钥标识符 |
| `reason` | `string` | 是 | 撤销原因 |
| `composite_sig` | `object` | 是 | 复合签名：经典签名和 PQ 签名都是必需的（仅经典签名会被拒绝） |

**响应（201）：**

```json
{
  "ok": true,
  "agent_id": "agent-001",
  "revoked_kid": "a1b2c3d4e5f6...",
  "revoked_at": "2026-03-01T00:00:00.000Z"
}
```

**错误响应：** 400（缺少字段或 `dcp_version`）、403（`revoked_kid` 不是 `agent_id` 的已登记密钥，或 `composite_sig` 无法用
该智能体的密钥验证）。

### `POST /v2/emergency-revoke`

紧急撤销（紧急按钮）。使用随护照登记的 `emergency_revocation_token` 的原像，撤销某个智能体的所有密钥。每个客户端 IP（套接字
地址，或在 `TRUST_PROXY=true` 时为 `X-Forwarded-For` 的最后一跳）每分钟最多 5 次尝试。

```bash
curl -X POST http://localhost:3003/v2/emergency-revoke \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "agent-001",
    "revocation_secret": "a1b2c3d4e5f6..."
  }'
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|-------|------|----------|-------------|
| `agent_id` | `string` | 是 | 要撤销的智能体的 ID |
| `human_id` | `string` | 否 | 负责人的 ID |
| `revocation_secret` | `string` | 是 | 已登记令牌的原像（64 个十六进制字符） |
| `reason` | `string` | 否 | 原因（默认：`"key_compromise_emergency"`） |
| `timestamp` | `string` | 否 | ISO 8601（默认：当前时间） |

**响应（200）：**

```json
{
  "ok": true,
  "agent_id": "agent-001",
  "revoked_at": "2026-03-01T00:00:00.000Z",
  "keys_revoked": 2
}
```

**错误响应：** 400（格式错误）、403（秘密值无效）、404（未登记令牌）、409（令牌已被使用）、429（超出速率限制）。

`POST /v2/register-emergency-token` 和 `POST /v2/register-key-expiry` 已被移除：它们接受未签名的请求，因此任何人都可以替换
令牌或把任意密钥标记为过期。令牌和密钥有效期现在来自已签名的护照（`POST /v2/register`）。

### `GET /v2/check/kid/:kid`

检查某个已登记的密钥标识符是否已被撤销：显式的 kid 撤销、其所有者的紧急撤销，或过期。服务只知道为智能体登记
（`POST /v2/register`）签名的那些 kid。任何其他 kid 都会得到 **404** `{ "registered": false }`。这包括在护照中列出但未签名
的 kid、在网关处轮换的 kid，或从未在此登记的智能体的 kid：它们在此处的状态是未知的，而不是“未撤销”。`?agent_id=` 会被
忽略，因此调用方无法为某个 kid 借用另一个智能体的判定结果。

```bash
curl "http://localhost:3003/v2/check/kid/a1b2c3d4e5f6"
```

**已撤销的密钥：**

```json
{
  "revoked": true,
  "kid": "a1b2c3d4e5f6",
  "agent_id": "agent-001",
  "reason": "key_compromise",
  "revoked_at": "2026-03-01T00:00:00.000Z"
}
```

**有效的密钥：**

```json
{ "revoked": false, "kid": "a1b2c3d4e5f6" }
```

### `GET /v2/list`

列出所有撤销，包括智能体级和 kid 级。

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

## 共用端点

### `GET /.well-known/dcp-revocations.json`

用于查询所有撤销（V1 + V2）的标准化端点。遵循 [RFC 8615](https://tools.ietf.org/html/rfc8615)。

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

该端点可以：

- 由任何验证器查询
- 由 CDN 缓存
- 在生产中作为静态文件提供

该列表不带签名：验证器之所以信任它，是因为它来自的 URL 和 HTTPS，因此 CDN 或静态副本必须保持这种信任。缓存副本的时效只到其最后一次刷新为止：新增的撤销要等到副本刷新后才会体现。其他准入检查和新鲜度要求仍然适用。准入的撤销来源把这一格式当作完整的拒绝列表读取，无法获取时会失败（[docs/ADMISSION.md](../../docs/ADMISSION.md#revocation-sources)）。

<a id="configuration"></a>

## 配置

<a id="environment-variables"></a>

### 环境变量

| 变量 | 默认值 | 说明 |
|----------|---------|-------------|
| `PORT` | `3003` | HTTP 端口 |
| `OPERATOR_TOKEN` | — | 用于登记新 `agent_id` 的 Bearer 令牌。未设置：不能登记新智能体 |
| `REVOCATION_STATE_PATH` | — | 在重启之间保存登记和撤销的文件。未设置：仅内存。每次写入都以一行经过 fsync 的 JSON 追加（重新登记只记录变化的部分）。启动时会重放该文件，然后通过临时文件和原子重命名把它压缩为每个条目一行。如果路径不可写或文件超过 512 MB，服务会拒绝启动 |
| `TRUST_PROXY` | — | 仅在会把客户端 IP 追加到 `X-Forwarded-For` 的代理之后设为 `true` |
| `REGISTRATIONS_PER_HOUR` | `20` | 每个客户端每小时的 `POST /v2/register` 调用次数；超出的会得到 429 |
| `MAX_AGENTS` | `10000` | 已登记的智能体数；达到后新智能体会得到 507（不会逐出任何内容） |

没有 `REVOCATION_STATE_PATH` 时，状态保存在内存中，并且**不会在重启**、部署或崩溃后保留：登记和所有撤销都会丢失，因此已撤销
的智能体看起来又是有效的。在 Fly 上，请把该文件放在卷上（参见 `deploy/fly/revocation.toml`）；Docker Compose 栈把它保存在
`revocation-data` 卷上。上述限制可以防止大量登记耗尽服务的内存。记录也有上限：
- `human_id`、`timestamp` 和 `reason` 最多 256 个字符，V2 的 `reason` 必须是 `key_compromise`、`key_rotation`、
  `administrative`、`key_compromise_emergency` 之一。
- `emergency_revocation_token` 必须为 `sha256:<64 hex>`。
- `composite_sig` 只存储签名字段。

<a id="integration"></a>

## 集成

<a id="querying-from-middleware"></a>

### 从中间件查询

Express 中间件的 `checkRevocation: true` 会在每个请求上查询 `GET /check/:agent_id` 和 `GET /v2/check/kid/:kid`。服务没有响应时，除非设置了 `revocationFailClosed: true`，否则会放行请求。准入（Express、FastAPI、OpenClaw 和参考网关，使用 strict-v1 配置）则把 `/.well-known/dcp-revocations.json` 读作拒绝列表，无法读取时拒绝请求。

<a id="v2-flow"></a>

### V2 流程

1. 运营方在设置阶段登记智能体的已签名护照（带运营方令牌的 `POST /v2/register`）：密钥、其有效期和紧急令牌
2. 根据需要撤销单个密钥，由智能体的密钥签名（`POST /v2/revoke`）
3. 在紧急情况下使用紧急按钮（`POST /v2/emergency-revoke`）
4. 在接受 bundle 之前检查密钥状态（`GET /v2/check/kid/:kid`）

<a id="development"></a>

## 开发

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

## 许可证

Apache-2.0
