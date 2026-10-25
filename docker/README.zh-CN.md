<sub>[English](README.md) · **中文** · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="docker--dcp-infrastructure"></a>
<a id="docker-dcp-infrastructure"></a>

# Docker — DCP 基础设施

> 本文是[英文版](README.md)的参考译文，更新于 25/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

用于把所有 DCP 服务部署为容器的 Docker Compose 配置。包括验证、锚定、透明日志和撤销。

<a id="quickstart"></a>

## 快速开始

```bash
cd docker
docker compose up
```

`docker compose up` 会停留在前台：请在第二个终端中运行下面的检查，或者用 `docker compose up -d` 启动整个栈。这会在五个容器
中启动四个服务（两个透明日志）：

| 容器 | 端口 | 说明 |
|---------|------|-------------|
| **verification** | `3000` | bundle 验证服务器 |
| **anchor** | `3001` | 锚定服务：只有本地记录，链上提交尚未实现 |
| **transparency-log-a** | `3002` | 透明日志 `log-alpha`，带 Merkle 证明 |
| **transparency-log-b** | `3012` | 透明日志 `log-beta`，`log-alpha` 的 gossip 对等节点 |
| **revocation** | `3003` | 智能体撤销服务 |

<a id="verify-everything-is-running"></a>

### 检查一切都在运行

```bash
curl http://localhost:3000/health
curl http://localhost:3001/health
curl http://localhost:3002/health
curl http://localhost:3012/health
curl http://localhost:3003/health
```

健康的应答只表示进程能响应 HTTP。它不检查持久化、锚定或 gossip（日志的 `gossip_peers` 统计的是已配置的对等节点，无论是否已
固定）。

<a id="services"></a>

## 服务

### verification (`:3000`)

DCP（V1 + V2 + 第 3 阶段）的 Signed Bundle 验证服务器。下面两个验证请求是模板：`{...}` 和 `...` 代表一个真实的已签名
bundle，因此不能按原样运行。本页末尾的完整示例改用一个测试夹具。

```bash
# V1 verification
curl -X POST http://localhost:3000/verify \
  -H "Content-Type: application/json" \
  -d '{"signed_bundle": {"bundle": {...}, "signature": {...}}, "public_key_b64": "..."}'

# V2 composite verification
curl -X POST http://localhost:3000/v2/bundle/verify \
  -H "Content-Type: application/json" \
  -d '{"signed_bundle": {"bundle": {"dcp_bundle_version":"2.0","manifest":{...},...}, "signature": {"composite_sig":{...},...}}}'

# Capability discovery
curl http://localhost:3000/.well-known/dcp-capabilities.json
```

### anchor (`:3001`)

面向区块链的 bundle 哈希锚定服务。参见 [services/anchor/README.md](../services/anchor/README.md)。

### transparency-log (`:3002`)

带包含证明的只追加透明日志。参见 [services/transparency-log/README.md](../services/transparency-log/README.md)。

### revocation (`:3003`)

撤销的发布与查询服务。参见 [services/revocation/README.md](../services/revocation/README.md)。

<a id="configuration"></a>

## 配置

<a id="environment-variables"></a>

### 环境变量

每个服务都通过 `docker-compose.yml` 中的环境变量配置：

#### verification

| 变量 | 默认值 | 说明 |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP 端口 |
| `VERIFIER_MODE` | `hybrid_required` | V2 验证模式 |
| `ALLOW_V1_BUNDLES` | `true` | 接受 V1 格式的 bundle |
| `REQUIRE_SESSION_BINDING`、`REQUIRE_COMPOSITE_BINDING`、`MAX_KEY_AGE_DAYS`、`PQ_CHECKPOINT_INTERVAL`、`ADVISORY_POLL_INTERVAL_MS` | 在镜像中和此处设置 | **服务器目前还不会读取。** 适用的是其内置策略（要求会话绑定和复合绑定，密钥年龄阈值为 365 天）；可以通过 `GET /v2/policy` 查看 |

网关的 DCP-05 至 DCP-09 端点不需要令牌，也不验证签名；在前面没有你自己的授权时，不要把 3000 端口暴露给不受信任的客户端（[docs/OPERATOR_GUIDE.md](../docs/OPERATOR_GUIDE.md#dcp-0509-service-endpoints)）。

#### anchor

| 变量 | 默认值 | 说明 |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP 端口 |
| `ANCHOR_MODE` | `batch` | `"individual"` 或 `"batch"` |
| `BATCH_INTERVAL_MS` | `60000` | 刷出间隔（毫秒） |
| `ANCHOR_RPC_URL` | — | L2 节点的 JSON-RPC URL |
| `ANCHOR_PRIVATE_KEY` | — | 钱包私钥 |
| `ANCHOR_CONTRACT` | — | DCPAnchor 合约地址 |
| `OPERATOR_TOKEN` | — | `POST /flush` 的 Bearer 令牌（从主机环境传入） |

链上提交尚未实现，因此这三个 `ANCHOR_*` 链设置都不会被使用。

#### transparency-log

| 变量 | 默认值 | 说明 |
|----------|---------|-------------|
| `PORT` | `3002` | HTTP 端口 |
| `LOG_ID` | 自动生成 | 此日志实例的唯一标识符 |
| `OPERATOR_KEY` | 临时 | 签署 STH 的密钥的 Ed25519 种子：64 个十六进制字符（`openssl rand -hex 32`），每个日志一个。其他任何值都会使服务停止 |
| `OPERATOR_TOKEN` | — | `POST /gossip/peers` 的 Bearer 令牌（从主机环境传入） |
| `GOSSIP_PEERS` | — | 以逗号分隔的对等节点，每个为 `<endpoint>#<base64 Ed25519 public key>`（例如 `http://log-b:3002#q1w2...`）；未固定的对等节点的树头会被忽略 |
| `GOSSIP_INTERVAL_MS` | `30000` | Gossip 轮询间隔（毫秒） |

要让 Compose 中的两个日志进行 gossip，请给每个日志一个固定的密钥，并固定对方的密钥。请在安装了根目录依赖的情况下，从仓库根目录
运行以下命令（它使用根目录 `node_modules` 中的 `tweetnacl`）。根目录下没有 compose 文件，因此请用 `-f` 指定这个文件：

```bash
export TLOG_ALPHA_OPERATOR_KEY=$(openssl rand -hex 32) TLOG_BETA_OPERATOR_KEY=$(openssl rand -hex 32)
pub() { node -e 'const n = require("tweetnacl"); console.log(Buffer.from(n.sign.keyPair.fromSeed(Buffer.from(process.argv[1], "hex")).publicKey).toString("base64"))' "$1"; }
export TLOG_ALPHA_PUBLIC_KEY=$(pub $TLOG_ALPHA_OPERATOR_KEY) TLOG_BETA_PUBLIC_KEY=$(pub $TLOG_BETA_OPERATOR_KEY)
docker compose -f docker/docker-compose.yml up
```

日志把树保存在内存中：固定的 `OPERATOR_KEY` 可以在重启之间保持同一个签名密钥，但重启后仍会从一棵空树开始。

#### revocation

| 变量 | 默认值 | 说明 |
|----------|---------|-------------|
| `PORT` | `3003` | HTTP 端口 |
| `TRUST_PROXY` | — | 仅在会把客户端 IP 追加到 `X-Forwarded-For` 的代理之后设为 `true` |
| `REVOCATION_STATE_PATH` | 仅内存 | 只追加的状态文件。此 compose 文件把它设为 `revocation-data` 卷上的 `/data/revocation-state.jsonl` |

验证和撤销服务也会读取 `OPERATOR_TOKEN`：用于网关的管理端点，以及在两者上登记新的 `agent_id`。在仓库根目录运行
`OPERATOR_TOKEN=$(openssl rand -hex 32) docker compose -f docker/docker-compose.yml up` 即可解锁它们；没有它时，它们返回
401。

状态：所有服务都把状态保存在内存中，在重启或 `docker compose down` 之后从空状态开始，**revocation 除外**。这里它的登记和撤销
会写入 `revocation-data` 卷，因此能在重启和 `docker compose down` 之后保留；`docker compose down -v` 会删除该卷，这些数据也随之
删除。

<a id="blockchain-anchoring-is-not-implemented"></a>

### 区块链锚定尚未实现

锚定服务不会向链上提交任何内容。`docker-compose.yml` 中被注释掉的 `ANCHOR_RPC_URL`、`ANCHOR_PRIVATE_KEY` 和
`ANCHOR_CONTRACT` 设置不会被读取（设置 `ANCHOR_RPC_URL` 只会记录一条警告），因此不要在那里放任何钱包密钥。记录保留在本地
内存中，`tx_hash: null`、`onchain: false`。

## Dockerfile

`Dockerfile` 使用带有独立目标的多阶段构建：

```
Base: node:20-alpine
├── verification  → node server/index.js        (port 3000)
├── anchor        → node services/anchor/index.js      (port 3001)
├── transparency-log → node services/transparency-log/index.js (port 3002)
└── revocation    → node services/revocation/index.js  (port 3003)
```

<a id="individual-build"></a>

### 单独构建

```bash
# Build a specific service (from the repo root: the build context is the repo)
docker build -f docker/Dockerfile --target anchor -t dcp-anchor .

# Run
docker run -p 3001:3001 -e ANCHOR_MODE=batch dcp-anchor
```

<a id="build-all"></a>

### 全部构建

```bash
# from the repo root
docker compose -f docker/docker-compose.yml build
```

<a id="health-checks"></a>

## 健康检查

所有服务都配置了健康检查：

- **间隔：** 30 秒
- **超时：** 5 秒
- **重试：** 3 次
- **命令：** `wget -qO- http://localhost:PORT/health`
- **重启策略：** `unless-stopped`

检查通过只表示进程能响应 HTTP；它不能证明持久化、锚定、gossip 或生产就绪程度。

<a id="full-example--verify-a-bundle"></a>
<a id="full-example-verify-a-bundle"></a>

## 完整示例 — 验证一个 bundle

```bash
# Run from the repo root: the example files are under tests/.
# 1. Start services
docker compose -f docker/docker-compose.yml up -d

# 2. Verify a signed bundle (note: body must wrap in signed_bundle key)
curl -X POST http://localhost:3000/verify \
  -H "Content-Type: application/json" \
  -d "{\"signed_bundle\": $(cat tests/conformance/examples/citizenship_bundle.signed.json)}"

# 3. Take the bundle_hash the signature carries (computed over the canonical bundle) and anchor it
HASH=$(node -e 'console.log(require("./tests/conformance/examples/citizenship_bundle.signed.json").signature.bundle_hash)')
curl -X POST http://localhost:3001/anchor \
  -H "Content-Type: application/json" \
  -d "{\"bundle_hash\": \"$HASH\"}"

# 4. Add to transparency log (service on port 3002, route is /add)
curl -X POST http://localhost:3002/add \
  -H "Content-Type: application/json" \
  -d "{\"bundle_hash\": \"$HASH\"}"

# 5. Stop
docker compose -f docker/docker-compose.yml down
```

<a id="license"></a>

## 许可证

Apache-2.0
