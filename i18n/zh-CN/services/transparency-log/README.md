<sub>[English](../../../../services/transparency-log/README.md) · **中文** · [Español](../../../es/services/transparency-log/README.md) · [日本語](../../../ja/services/transparency-log/README.md) · [Português](../../../pt-BR/services/transparency-log/README.md)</sub>

<a id="transparency-log-service"></a>

# 透明日志服务

> 本文是[英文版](../../../../services/transparency-log/README.md)的参考译文，更新于 05/11/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

受 Certificate Transparency（CT）启发的 HTTP 透明日志服务。它把 bundle 哈希存储在只追加的 RFC 6962 Merkle 树中，提供可验证的包含证明和以 Ed25519 签名的树头。状态保存在内存中：重启后会从一棵新的空树开始（参见[持久化](../../../../services/README.md#persistence)）。

<a id="quickstart"></a>

## 快速开始

```bash
# Start the service, from the root of a checkout after `npm install` there
node services/transparency-log/index.js

# Or with Docker, from the repo root: the Compose stack runs two logs that gossip with each other
docker compose -f docker/docker-compose.yml up transparency-log-a transparency-log-b
```

该服务默认监听 `http://localhost:3002`。

<a id="endpoints"></a>

## 端点

### `GET /health`

服务健康检查。

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

向日志添加一个 bundle 哈希：`sha256:` 后跟 64 个小写十六进制字符。其他任何内容，或超过 1 MB 的请求体，都会返回 400。

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

获取日志当前的 Merkle 根。

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

获取已签名树头（Signed Tree Head，STH）：对 `{ log_id, root, size, timestamp }` 的规范化 JSON（键已排序，
`tools/crypto.js` 中的 `signObject`）所作的 Ed25519 签名（base64）。

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

请对照你通过带外方式固定的公钥（启动时打印，也显示在 `/health` 中）进行验证，绝不要只对照 STH 自带的 `public_key`：

```js
import { verifyObject } from "./tools/crypto.js";
const { log_id, root, size, timestamp, signature } = sth;
verifyObject({ log_id, root, size, timestamp }, signature, pinnedPublicKey); // true
```

`OPERATOR_KEY` 是密钥的 32 字节种子，因此签名密钥在重启后仍然保留；树不会保留，因为它在内存中。没有它时，日志在每次重启后
都会用一个新的临时密钥签名：如果你归档或固定了旧密钥，之前的 STH 仍可用旧密钥验证，但不能用新密钥验证。

### `GET /proof/:index`

按索引获取某个条目的 Merkle 包含证明。

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

借助该证明，无需下载整个日志即可验证某个条目包含在 Merkle 树中。

### `GET /entries`

列出日志的所有条目。

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

### Gossip

| 方法 | 路径 | 说明 |
|--------|------|-------------|
| GET | `/gossip/peers` | 已知的对等节点和最近 20 条告警 |
| POST | `/gossip/peers` | 添加一个对等节点 `{ peer_id, endpoint, public_key }`（http/https 端点，base64 Ed25519 密钥）。需要 `Authorization: Bearer <OPERATOR_TOKEN>`：日志会自行访问对等节点，因此开放的列表会导致 SSRF |
| POST | `/gossip/exchange` | 与已固定的对等节点交换 STH `{ sth }`；返回我方的 STH 以及任何分叉视图告警 |
| GET | `/gossip/alerts` | 分叉视图告警（最近 100 条） |

只有能用对等节点**已固定**的公钥验证的树头才算数：在 `GOSSIP_PEERS` 中以 `<endpoint>#<base64 Ed25519 public key>` 的形式给出，
或在 `POST /gossip/peers` 中作为 `public_key` 给出。来自未固定密钥的对等节点的树头、格式错误的树头以及签名错误的树头都会被
忽略。一次轮询最多读取 16 KB，超过一个间隔（最多 10 秒）就放弃，并且在上一次轮询仍在进行时不会开始。`/gossip/exchange`
是开放的，因此它只接受由已固定的对等节点签名、格式正确的 STH（64 位十六进制或 null 的 `root`，整数 `size`），请求体最多
16 KB（否则返回 400 或 403）。任何人都可以把别人给他看过的已固定对等节点的树头交给它。

**gossip 能检测什么。** 每个日志都是它所固定的日志的树头的见证者。一个日志由验证其树头所用的已固定密钥和其精确的
`log_id`（解码后的 JSON 字符串）来标识；对等节点 ID 或端点只是通往它的路径。**分叉视图**是指这样一个日志为同一树大小
签署了两个不同的根，无论是通过轮询、通过交换，还是通过同一日志的两个别名看到的。不同日志的树头无论大小或 `log_id`
如何都不会被比较：两个互相固定的独立日志不会告警。大小不同的树头在这里不能证明任何事：日志之间不互相复制，也没有一致性
证明。本地树只与本日志自身的密钥和 `LOG_ID` 的树头（如果其运营者固定了自己的密钥）在当前大小上进行比较。

**告警。** 告警指明日志（`peer_log_id`、`peer_public_key`）、`tree_size`、最先观察到的根（`observed_root`）和与之冲突的根
（`peer_root`）、树头经由的别名（`peer_id`）以及路径（`source`：`poll` 或 `exchange`）。`evidence` 保存观察到的两个树头
（四个已签名字段和 `signature`，不含任何 `public_key` 或其他成员）。审计者若已通过独立渠道将 `peer_public_key` 与自己
信任的密钥核对，而不是仅凭告警所述，就可以核实该密钥签署了两者。只有当冲突的树头与当前本地树比较时，`observed_root`
才是本地树的根；否则它是先前观察到的根。`local_root` 作为 `observed_root` 的已弃用名称保留给现有客户端，含义相同。告警
在保留的 100 条告警范围内按日志、树大小和根的组合去重，因此只要其告警仍在其中，通过任何别名或路径重放已签名的树头都
不会增加任何内容；告警被挤出后，同一分叉视图可能再次被报告。

**限制。** 对于它所见证的每个日志，日志为见过的最大的 256 个大小各保留第一个树头。之后重放的较旧、较小的树头不会把
较新的挤出去。每个已固定密钥最多跟踪 8 个 `log_id`；该密钥其他 `log_id` 的树头会被验证，但不会被记录，也不会与已保留
的内容比较，且不会提示（日志自身的树头仍会与其当前树比较）。这些限制是固定的：每个已固定密钥最多 256 × 8 个树头，因此
总量随运营者固定的密钥数量增长。

- **轮换与移除。** 为别名重新固定新密钥或移除别名时，会丢弃在不再被任何别名固定的密钥下观察到的内容。仍被其他别名固定
  的密钥，或被同一别名以新端点或同一密钥的另一种 base64 写法固定的密钥，会保留其历史。
- **进行中的轮询。** 在等待期间其别名被移除或重新配置的轮询，在应答时会被丢弃。
- **重启。** 历史和告警保存在内存中，重启后丢失，因此此前观察到的内容无法再比较。以相同的 `OPERATOR_KEY` 和 `LOG_ID`
  重启的日志会在同一身份下从空树开始。只有当对等节点仍保留先前树的某个树头，而新树在该大小上签署了不同的根时，它才会
  报告分叉视图；以相同顺序包含相同条目的新树具有相同的根，不会引发任何告警。新的 `LOG_ID`（未设置时是随机的）就是一个
  新日志：它不延续先前的日志，对等节点也不再把先前的历史与它关联。

<a id="configuration"></a>

## 配置

<a id="environment-variables"></a>

### 环境变量

| 变量 | 默认值 | 说明 |
|----------|---------|-------------|
| `PORT` | `3002` | HTTP 端口 |
| `LOG_ID` | 随机 | 此日志实例的标识符 |
| `OPERATOR_KEY` | — | 签署 STH 的密钥的 Ed25519 种子：64 个十六进制字符（`openssl rand -hex 32`）。任何其他值都会使服务停止；未设置时使用临时密钥 |
| `OPERATOR_TOKEN` | — | `POST /gossip/peers` 的 Bearer 令牌。未设置时锁定 |
| `GOSSIP_PEERS` | — | 以逗号分隔的对等节点，每个为 `<endpoint>#<base64 Ed25519 public key>`（对等节点 `/health` 中的 `public_key`，由其 `OPERATOR_KEY` 决定），每 `GOSSIP_INTERVAL_MS` 轮询一次 |
| `GOSSIP_INTERVAL_MS` | `30000` | Gossip 轮询间隔 |

<a id="ct-style-format"></a>

## CT 风格的格式

该日志遵循受 Certificate Transparency（RFC 6962）启发的格式：

1. **只追加：** 条目永远不会被删除或修改
2. **Merkle 树：** RFC 6962 §2.1。`leaf_hash = SHA-256(0x00 || UTF-8(entry.hash))`，内部节点为
   `SHA-256(0x01 || left || right)`，因此叶子永远无法冒充子树。`n` 片叶子的树在小于 `n` 的最大 2 的幂处分割；最后一个
   节点永远不会被复制。
3. **包含证明：** 任何人都可以用证明来验证某个条目存在于日志中
4. **已签名的根：** 以 Ed25519 签名的树头（`GET /root/signed`）

<a id="verifying-an-inclusion-proof"></a>

### 验证包含证明

要验证某个条目在日志中：

1. 用 `GET /proof/:index` 获取证明
2. 计算 `leaf_hash = SHA-256(0x00 || UTF-8(entry.hash))`
3. 按顺序以原始字节（解码后的十六进制字符串）重新组合证明节点：
   - 如果 `direction == "left"`：`hash = SHA-256(0x01 || proof_hash || current)`
   - 如果 `direction == "right"`：`hash = SHA-256(0x01 || current || proof_hash)`
4. 最终结果必须等于这样一个已签名树头的 `root`：它能用日志已固定的公钥验证，并且覆盖构建该证明时的那棵树（相同大小）。
   证明响应中的 `root` 本身只是自我声明，而一旦添加了条目，更新的根就不再匹配

<a id="development"></a>

## 开发

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

## 许可证

Apache-2.0
