<sub>[English](../../../deploy/README.md) · **中文** · [Español](../../es/deploy/README.md) · [日本語](../../ja/deploy/README.md) · [Português](../../pt-BR/deploy/README.md)</sub>

<a id="deploying-dcp-ai-services"></a>

# 部署 DCP-AI 服务

> 本文是[英文版](../../../deploy/README.md)的参考译文，更新于 25/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

本仓库提供的四个服务——**verification**、**anchor**、**transparency-log**、
**revocation**——以预构建的 Docker 镜像形式发布在 GitHub Container Registry（GHCR）上。
你可以在任何容器主机上运行它们。下面是最常见的几种流程。

<a id="images"></a>

## 镜像

| 服务 | 镜像 | 默认端口 |
|---|---|---|
| 验证 | `ghcr.io/dcp-ai-protocol/dcp-ai/verification` | 3000 |
| 锚定 | `ghcr.io/dcp-ai-protocol/dcp-ai/anchor` | 3001 |
| 透明日志 | `ghcr.io/dcp-ai-protocol/dcp-ai/transparency-log` | 3002 |
| 撤销 | `ghcr.io/dcp-ai-protocol/dcp-ai/revocation` | 3003 |

标签（参见 [`publish-docker.yml`](../../../.github/workflows/publish-docker.yml)）：触发该工作流的 `main` 推送会发布 `:latest`、
`:main` 和 `:sha-xxxxxxx`；已发布的版本会添加其 semver 标签（`:<major>.<minor>.<patch>`、`:<major>.<minor>`、`:<major>`），
也可能移动可变的 `:latest`。`linux/amd64` 和 `linux/arm64` 都会构建。

在你的笔记本电脑上快速冒烟测试：

```bash
docker run --rm -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest
# in a second terminal, while the container runs in the foreground
curl http://localhost:3000/health
```

`/health` 只表明进程能响应 HTTP。它不能说明任何关于持久化、锚定、gossip 或生产就绪程度的情况。

---

<a id="option-1--docker-compose-self-host-simplest"></a>
<a id="option-1-docker-compose-self-host-simplest"></a>

## 方案 1 — Docker Compose（自托管，最简单）

仓库提供一个开箱即用的 compose 文件，用五个容器把四个服务连接起来，其中有两个透明日志。只有当每个日志都有固定的
`OPERATOR_KEY` 并固定了对方的公钥时，它们才会进行 gossip（参见 [`docker/README.md`](../../../docker/README.md)）；否则，双方会互相
轮询，但忽略对方的树头：

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai
cd dcp-ai/docker
docker compose up -d
```

服务公开的地址：

- `http://localhost:3000` — 验证
- `http://localhost:3001` — 锚定
- `http://localhost:3002` — 透明日志（log-alpha）
- `http://localhost:3012` — 透明日志（log-beta，gossip 对等节点）
- `http://localhost:3003` — 撤销

要使用 GHCR 上已发布的镜像而不是从源码构建，请编辑 `docker/docker-compose.yml`，把每个 `build:` 块替换为一行 `image:`，
例如：

```yaml
services:
  verification:
    image: ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest
```

---

<a id="option-2--flyio-managed"></a>
<a id="option-2-flyio-managed"></a>

## 方案 2 — Fly.io（托管）

```bash
# one-time setup
brew install flyctl
fly auth login
cd deploy/fly
```

部署每个服务（本目录中的 `.toml` 文件已预先配置为从 GHCR 拉取，无需从源码构建）：

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

每个服务都会得到一个公开的 HTTPS URL，例如 `https://dcp-ai-verification.fly.dev`。对验证应用而言，这也会公开其 DCP-05 至 DCP-09 端点，这些端点不需要令牌，也不验证签名（参见运维说明）。

没有 `#<public key>` 的 gossip 对等节点会被轮询，但其树头会被忽略。

状态保存在内存中。验证、撤销和透明日志的配置会让一台机器保持运行，以免空闲时清空其注册表；但部署或重启仍会从空状态开始。
锚定的配置允许其机器停止（`min_machines_running = 0`），这会丢弃其待处理的哈希和本地记录。只有撤销服务可以在重启之间保留
状态：按照 `revocation.toml` 中注释的说明，把 `REVOCATION_STATE_PATH` 放在卷上。透明日志没有持久化选项。
也请在撤销应用上设置 `OPERATOR_TOKEN`，因为在那里登记新的 `agent_id` 需要它；如果需要 `POST /flush` 或
`POST /gossip/peers`，也请在锚定和透明日志应用上设置。

在生产中，你需要在不同区域部署**两个**透明日志实例，每个都有自己的 `OPERATOR_KEY`，并通过 `GOSSIP_PEERS` 指向对方、固定对方的公钥。gossip 会比较它们的已签名树头，当两个大小相同的树头根不同时发出告警（DCP-03 §4）。只有当两个日志本应以相同顺序保存相同条目时，这才能揭示分叉视图：日志之间不会互相复制条目，因此两个合法地收到不同条目的日志也会告警，而大小不同的树头不会被比较（没有一致性证明）。

---

<a id="option-3--google-cloud-run-pay-per-request"></a>
<a id="option-3-google-cloud-run-pay-per-request"></a>

## 方案 3 — Google Cloud Run（按请求付费）

```bash
gcloud run deploy dcp-ai-verification \
  --image ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest \
  --port 3000 \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars="DCP_VERSION=2.0,VERIFIER_MODE=hybrid_required"
```

对每个服务重复此操作。Cloud Run 在空闲时会缩容到零，而这些服务把状态保存在内存中：缩容到零或重启的实例会从空状态开始
（参见运维说明）。

---

<a id="option-4--railway-one-click-credit-card-required-for-deploy"></a>
<a id="option-4-railway-one-click-credit-card-required-for-deploy"></a>

## 方案 4 — Railway（一键部署，部署需要信用卡）

从 Docker 镜像创建一个新项目。为每个服务粘贴 GHCR 镜像 URL，并设置对应的 `deploy/fly/*.toml` 中的环境变量。

---

<a id="operating-notes"></a>

## 运维说明

- **锚定**：链上提交尚未实现。部署 `contracts/ethereum/src/DCPAnchor.sol` 并设置 `ANCHOR_CONTRACT` 并不会启用它：`ANCHOR_RPC_URL`、`ANCHOR_PRIVATE_KEY` 和 `ANCHOR_CONTRACT` 都不会被读取（设置 `ANCHOR_RPC_URL` 只会记录一条警告），因此不要给该服务任何钱包密钥。它在内存中保存本地记录，`tx_hash: null`、`onchain: false`。
- **透明日志**：仅在内存中，没有持久化选项：重启会从一棵新的空树开始，使用卷也改变不了这一点。固定的 `OPERATOR_KEY` 可以在重启之间保持同一个签名密钥。
- **撤销**：只有当你策略中的每个验证器都指向*这个* URL 时，该注册表才具有权威性。请在你的 `.well-known/dcp-capabilities.json` 中公布该 URL。如果没有把 `REVOCATION_STATE_PATH` 放在持久存储上，重启会遗忘所有登记和撤销。
- **验证**：并非无状态。它在内存中保存护照、密钥、审计链以及 DCP-05–09 的记录，而且不同实例之间不共享这些内容，因此负载均衡器后面的多个实例会给出不同的应答。请只运行一个实例。
- **验证，DCP-05 至 DCP-09 端点**：它们不需要令牌，也不验证签名，`OPERATOR_TOKEN` 也不保护它们，因此任何能访问公开部署（Fly，或带 `--allow-unauthenticated` 的 Cloud Run）的人都可以更改生命周期、争议和委托授权书的状态。请在它们前面加上你自己的授权，或者不要路由它们（[docs/OPERATOR_GUIDE.md](../../../docs/OPERATOR_GUIDE.md#dcp-0509-service-endpoints)）。

---

## CI/CD

仓库的 [`publish-docker.yml`](../../../.github/workflows/publish-docker.yml) 工作流会在每次发布版本、手动触发，以及每次推送到 `main` 且涉及 `server/`、`services/`、`lib/`、`tools/`、`schemas/`、`docker/Dockerfile` 或该工作流本身时，重新构建并推送这些镜像。镜像也会构建工作区中的 SDK（`sdks/typescript/`），但只修改 SDK 的推送不会触发重新构建。

部署之前，请把你要运行的镜像的摘要追溯到针对所选提交的一次成功的发布工作流运行。`:latest` 是可变的，不能保证对应该版本。如果所选提交没有镜像，请从该检出代码构建（在仓库根目录运行 `docker build -f docker/Dockerfile --target <service> .`）。
