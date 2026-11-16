<sub>[English](../../../../services/anchor/README.md) · [Español](../../../es/services/anchor/README.md) · [Português](../../../pt-BR/services/anchor/README.md) · [日本語](../../../ja/services/anchor/README.md) · **中文**</sub>

<a id="anchoring-service"></a>

# 锚定服务

> 本文是[英文版本](../../../../services/anchor/README.md)的参考译文，更新于2026年10月25日。如有差异，以英文原文为准。标识符和代码块（包括注释）均保留原文。

用于将 Citizenship Bundle 哈希锚定到 L2 区块链（Base、Arbitrum、Optimism）的 HTTP 服务，可单独锚定，也可在 Merkle 根下批量锚定。目前它只在本地记录这些哈希（见下方说明）。

> **尚未实现链上提交。** 哈希和批次根在本地记录，带有
> `tx_hash: null` 和 `onchain: false`；服务绝不会伪造交易哈希。
> `ANCHOR_RPC_URL`、`ANCHOR_PRIVATE_KEY` 和 `ANCHOR_CONTRACT` 尚未使用。状态保存在内存中
> （参见[持久化](../../../../services/README.md#persistence)）。

<a id="quickstart"></a>

## 快速开始

```bash
# Start the service, from the repo root after installing the root dependencies
node services/anchor/index.js

# Or with Docker, from the repo root
docker compose -f docker/docker-compose.yml up anchor
```

服务默认监听 `http://localhost:3001`。

<a id="endpoints"></a>

## 端点

### `GET /health`

服务健康检查。

```bash
curl http://localhost:3001/health
```

```json
{
  "ok": true,
  "service": "dcp-anchor",
  "mode": "batch",
  "pending": 0,
  "total_anchored": 5
}
```

`total_anchored` 统计本地记录，每批一条，而非哈希数量。健康响应并不说明存在任何链上操作。

### `POST /anchor`

提交待锚定的 bundle 哈希：`sha256:` 后接64个小写十六进制字符（前缀可选）。其他格式或超过1 MB的请求体会得到400响应。

```bash
curl -X POST http://localhost:3001/anchor \
  -H "Content-Type: application/json" \
  -d '{"bundle_hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"}'
```

**单独模式** — 立即在本地记录哈希：`anchored: true` 表示此服务已记录，并不表示已经上链（`onchain: false`、`tx_hash: null`）：

```json
{
  "anchored": true,
  "hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "count": 1,
  "timestamp": "2025-01-01T00:00:00.000Z",
  "tx_hash": null,
  "onchain": false,
  "chain": "base"
}
```

**批处理模式** — 接受并入队（HTTP 202）：

```json
{
  "accepted": true,
  "bundle_hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "position": 3,
  "hint": "Will be anchored in next batch (interval: 60000ms)"
}
```

### `GET /status/:hash`

查询已锚定哈希的状态。

```bash
curl http://localhost:3001/status/sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
```

```json
{
  "anchored": true,
  "hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "count": 1,
  "timestamp": "2025-01-01T00:00:00.000Z",
  "tx_hash": null,
  "onchain": false,
  "chain": "base"
}
```

尚未锚定但仍在等待时：

```json
{
  "anchored": false,
  "pending": true
}
```

只能按记录中保存的哈希查到该记录。在单独模式或仅含一个哈希的批次中，它就是提交的哈希（带 `sha256:` 前缀）。对于含多个哈希的批次，只保存其 Merkle 根，因此查询每个原始哈希会得到 `{"anchored": false, "pending": false}`；尚无针对每个哈希的包含证明。仍在等待时，哈希按提交时的形式匹配（带前缀或不带前缀）。记录保存在内存中，重启会丢失。

### `GET /anchored`

列出所有锚定记录。

```bash
curl http://localhost:3001/anchored
```

```json
{
  "records": [
    { "hash": "sha256:...", "count": 1, "timestamp": "...", "tx_hash": null, "onchain": false, "chain": "base" }
  ]
}
```

### `POST /flush`

强制处理待执行批次（仅限批处理模式）。需要运营方令牌；未配置 `OPERATOR_TOKEN` 时，此端点保持锁定（401）。

```bash
curl -X POST http://localhost:3001/flush -H "Authorization: Bearer $OPERATOR_TOKEN"
```

```json
{ "flushed": true }
```

<a id="configuration"></a>

## 配置

<a id="environment-variables"></a>

### 环境变量

| 变量 | 默认值 | 描述 |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP 端口 |
| `ANCHOR_MODE` | `"batch"` | 锚定模式：`"individual"` 或 `"batch"` |
| `BATCH_INTERVAL_MS` | `60000` | 自动处理间隔，单位为毫秒（批处理模式） |
| `ANCHOR_RPC_URL` | — | L2 节点的 JSON-RPC URL（尚未使用；设置时会记录警告） |
| `ANCHOR_PRIVATE_KEY` | — | 用于签署交易的钱包私钥（尚未使用） |
| `ANCHOR_CONTRACT` | — | 已部署 DCPAnchor 合约的地址（尚未使用） |
| `ANCHOR_CHAIN` | `"base"` | 链标识符 |
| `OPERATOR_TOKEN` | — | `POST /flush` 的 Bearer 令牌。未设置时锁定 |

<a id="operating-modes"></a>

### 运行模式

**单独模式（`ANCHOR_MODE=individual`）：** 每个哈希立即获得独立的本地记录。接入链上提交后，每个哈希预计对应一笔独立交易。

**批处理模式（`ANCHOR_MODE=batch`）：** 累积哈希，每隔 `BATCH_INTERVAL_MS` 毫秒将其记录为一个 Merkle 根，也可以通过 `POST /flush` 立即处理。接入链上提交后，每个批次预计对应一笔交易。

<a id="integration-with-dcpanchorsol"></a>

## 与 DCPAnchor.sol 集成

接入后，服务将与 `DCPAnchor.sol` 智能合约交互：

- **单独模式：** 调用 `anchorBundle(bytes32 bundleHash)`
- **批处理模式：** 计算待处理哈希的 Merkle 根，并调用 `anchorBatch(bytes32 merkleRoot, uint256 count)`

合约详情请参阅 [contracts/ethereum/README.md](../../../../contracts/ethereum/README.md)。

<a id="development"></a>

## 开发

```bash
# Start in development mode, from the repo root
PORT=3001 ANCHOR_MODE=batch node services/anchor/index.js

# Test with curl
curl http://localhost:3001/health
curl -X POST http://localhost:3001/anchor \
  -H "Content-Type: application/json" \
  -d '{"bundle_hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"}'
```

<a id="license"></a>

## 许可证

Apache-2.0
