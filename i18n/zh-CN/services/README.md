<sub>[English](../../../services/README.md) · [Español](../../es/services/README.md) · [Português](../../pt-BR/services/README.md) · [日本語](../../ja/services/README.md) · **中文**</sub>

<a id="dcp-infrastructure-services"></a>

# DCP 基础设施服务

> 本文是[英文版本](../../../services/README.md)的参考译文，更新于2026年10月25日。如有差异，以英文原文为准。标识符和代码块（包括注释）均保留原文。

用于补充 DCP 参考网关的可选 HTTP 微服务。每个服务独立运行，可以单独部署，也可以通过 Docker Compose 一起部署。

<a id="architecture"></a>

## 架构

```
                        ┌─────────────────────┐
                        │  DCP Reference       │
                        │  Gateway (:3000)     │
                        │  Verification +      │
                        │  Key Registry +      │
                        │  Policy Engine       │
                        └──────────┬──────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                     │
    ┌─────────▼──────────┐  ┌─────▼──────────┐  ┌──────▼──────────┐
    │  Anchor Service    │  │ Transparency   │  │  Revocation     │
    │  (:3001)           │  │ Log (:3002)    │  │  Service (:3003)│
    │                    │  │                │  │                  │
    │  Bundle hash →     │  │ Append-only    │  │  V1: agent-level│
    │  Local records     │  │ Merkle tree +  │  │  V2: kid-level  │
    │  (L2 planned)      │  │ inclusion      │  │  + emergency    │
    │                    │  │ proofs         │  │  + short-lived  │
    └────────────────────┘  └────────────────┘  └─────────────────┘
```

<a id="services"></a>

## 服务

| 服务 | 端口 | 状态 | 描述 |
|---------|------|--------|-------------|
| [锚定](../../../services/anchor/README.md) | 3001 | 部分实现 | 本地记录 bundle 哈希，计划支持 L2 区块链锚定。Merkle 批处理在内存中运行；尚未实现链上提交，因此记录带有 `tx_hash: null`。 |
| [透明度日志](../../../services/transparency-log/README.md) | 3002 | 可运行 | CT 风格的仅追加日志：RFC 6962 Merkle 树、包含证明以及 Ed25519 签名的树头。使用内存存储。 |
| [吊销](../../../services/revocation/README.md) | 3003 | 可运行 | 智能体使用已签名的护照注册密钥；V1 智能体级和 V2 kid 级吊销必须由这些密钥签名；支持紧急按钮。默认使用内存存储，可选择文件持久化。 |

<a id="quick-start"></a>

## 快速开始

```bash
# Run all services with Docker Compose
(cd docker && docker compose up)

# Or run individually from the root of a checkout, after building the workspace SDK
# and installing the root package (the revocation service imports @dcp-ai/sdk):
#   (cd sdks/typescript && npm install && npm run build) && npm install
node services/anchor/index.js
node services/transparency-log/index.js
node services/revocation/index.js
```

<a id="data-flow"></a>

## 数据流

1. **智能体注册**：通过网关（`POST /v2/passport/register`）注册，运营方还将其注册到吊销服务（`POST /v2/register`，运营方令牌）；两处均使用其自签名护照
2. **声明意图**并评估策略（`POST /v2/intent/declare`）
3. **签署并验证 bundle**（`POST /v2/bundle/verify`）
4. **提交哈希**到锚定服务（`POST /anchor`），用于本地记录或批处理；尚未实现链上提交
5. **记录哈希**到透明度日志（`POST /add`）
6. 接受 bundle 前**检查吊销状态**：`GET /v2/check/kid/:kid` 检查通过 `POST /v2/register` 注册的每个 kid 的单独吊销、紧急吊销和过期状态；其他 kid 均返回404（`registered: false`，状态未知）；`GET /check/:agent_id` 检查智能体级吊销。

<a id="authentication"></a>

## 认证

- **吊销**写入带有签名：注册由护照自身的密钥签名，吊销由该智能体已注册的密钥签名。读取不带签名：服务提供的列表（`/list`、`/v2/list`、`/.well-known/dcp-revocations.json`）没有签名，验证器依赖服务 URL 和传输通道的可信性。注册新的 `agent_id` 还需要运营方令牌，以防他人抢先注册别人的 ID。紧急吊销需要已注册令牌的原像。
- **新的 `agent_id`** 由运营方在网关（`POST /v2/passport/register`）和吊销服务（`POST /v2/register`）注册；再次注册为自助操作，使用智能体密钥签名。
- **锚定**的 `POST /flush` 和**透明度日志**的 `POST /gossip/peers` 需要 `Authorization: Bearer <OPERATOR_TOKEN>`；未设置 `OPERATOR_TOKEN` 时保持锁定。日志会自行访问对等节点，因此开放的节点列表会让任何人把它指向内部 URL。
- 请求体上限为1 MB。速率限制（注册、紧急吊销以及网关的 POST）以套接字地址为键；仅在会将客户端 IP 追加到 `X-Forwarded-For` 的代理后面设置 `TRUST_PROXY=true`。
- 注册表满时拒绝新条目（507），而不是驱逐已有条目：吊销服务限制智能体数量（`MAX_AGENTS`），网关限制密钥数量（`MAX_REGISTERED_KEYS`、覆盖智能体整个生命周期的 `MAX_KEYS_PER_AGENT`），并为每个智能体保留4个已退役密钥。密钥和签名必须使用规范 base64，且长度与相应算法要求完全一致。透明度日志只信任由固定公钥的对等节点签署的树头（`GOSSIP_PEERS=<url>#<key>`）。

<a id="persistence"></a>

## 持久化

默认情况下，服务将状态保存在**内存中**。除非配置持久化，**这些状态无法跨重启保留**；部署、崩溃或机器停止也会导致状态丢失：

- **吊销**：丢失吊销记录会使智能体被视为未吊销。设置 `REVOCATION_STATE_PATH` 可将注册和吊销保存到文件中，使其跨重启保留（Compose 栈会在卷上这样做）；不设置时，`deploy/fly/revocation.toml` 只通过保持一台机器运行来防止空闲时丢失状态，部署仍会导致丢失。
- **透明度日志**：重启会创建一棵新的空树，之前的 STH 和证明不再与其匹配。其 Fly 配置已保持一台机器运行。
- **锚定**：待处理哈希和记录会丢失；其 Fly 配置仍会缩容到零，但在尚未进行任何链上锚定时，这不会影响链上记录。

用于生产时，请添加持久存储（SQLite、PostgreSQL），并在需要时使用 Fly 卷。其他限制：

- **锚定**：需要接入 ethers.js 和真实的 L2 RPC 端点。`DCPAnchor.sol` 合约位于 `contracts/ethereum/`。
- **吊销**：高可用部署可考虑 CRL（证书吊销列表）或 OCSP 风格的分发方式。

<a id="environment-variables"></a>

## 环境变量

配置详情请参阅各服务的 README：
- [锚定](../../../services/anchor/README.md#configuration)
- [透明度日志](../../../services/transparency-log/README.md#configuration)
- [吊销](../../../services/revocation/README.md#configuration)
