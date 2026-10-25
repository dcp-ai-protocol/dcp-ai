<sub>[English](README.md) · **中文** · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="dcp-reference-gateway"></a>

# DCP 参考网关

> 本文是[英文版](README.md)的参考译文，更新于 25/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

实现 Digital Citizenship Protocol 的 V1、V2 和第 3 阶段（PQ 优先）的 HTTP 验证服务。**内存存储**：不需要外部数据库，重启后什么都不会保留（参见[持久化](#persistence)）。设计为可由任何第三方运行；协议不需要中央服务器。

<a id="quick-start"></a>

## 快速开始

从检出代码的根目录运行。在 `@dcp-ai/sdk` 2.2.0 发布到 npm 之前，根包依赖工作区中的 SDK，因此请先构建它：

```bash
(cd sdks/typescript && npm install && npm run build)
npm install
node server/index.js
# or: npm run server
```

默认端口：`3000`。用 `PORT=4000 node server/index.js` 覆盖。要使用管理端点并登记新智能体，请设置 `OPERATOR_TOKEN`。

<a id="endpoints"></a>

## 端点

<a id="core"></a>

### 核心

| 方法 | 路径 | 说明 |
|--------|------|-------------|
| GET | `/` , `/health` | 健康检查：`{ ok, service, supported_versions, registered_agents, registered_keys }` |
| GET | `/.well-known/dcp-capabilities.json` | 协议能力发现（算法、功能、线上格式）。这是服务器声明的内容，并非经过检查的保证：它列出了 `hsm_provider: true` 和 `application/cbor`，但并没有 HSM，请求体也只按 JSON 读取 |
| POST | `/verify` | 验证已签名的 bundle（自动识别 V1 或 V2；V2 按 `VERIFIER_POLICY` 检查） |
| POST | `/v2/admit` | 依据运营方信任的委托人进行准入，配置后还会执行 strict-v1（`docs/ADMISSION.md`）。只读取请求体中的 `signed_bundle`。未配置时返回 501 |
| POST | `/anchor` | 桩实现：返回 501（由各运营方实现） |

<a id="v2-identity--intent"></a>
<a id="v2-identity-intent"></a>

### V2：身份与意图

| 方法 | 路径 | 说明 |
|--------|------|-------------|
| POST | `/v2/passport/register` | 登记自签名的智能体护照；新的 `agent_id` 需要运营方令牌（参见[信任模型](#trust-model)） |
| POST | `/v2/intent/declare` | 声明已登记智能体的意图，并获得服务器的（未签名的）策略决定；意图的 `composite_sig` 不会被验证 |
| POST | `/v2/audit/append` | 向智能体的链追加审计事件 |
| POST | `/v2/audit/compact` | 用 Merkle 摘要压缩审计链 |
| POST | `/v2/bundle/verify` | 完整的 V2 bundle 验证：schema、清单、Ed25519 + ML-DSA-65 复合签名、会话绑定和审计链（通过 `lib/verify.js` 和 `@dcp-ai/sdk`），依据 `VERIFIER_POLICY`。V1 bundle 返回 400 |

<a id="v2-key-management"></a>

### V2：密钥管理

| 方法 | 路径 | 说明 |
|--------|------|-------------|
| GET | `/v2/keys/:kid` | 按确定性的密钥 ID 查找密钥 |
| POST | `/v2/keys/rotate` | 密钥轮换：由新密钥证明持有，由旧密钥授权 |
| POST | `/v2/emergency-revoke` | 紧急撤销（紧急按钮） |

<a id="v2-multi-party--governance"></a>
<a id="v2-multi-party-governance"></a>

### V2：多方与治理

| 方法 | 路径 | 说明 |
|--------|------|-------------|
| POST | `/v2/multi-party/authorize` | M-of-N 多方授权，签名对照各方已登记的密钥检查 |
| POST | `/v2/governance/register` | 登记治理密钥集（**运营方**） |
| GET | `/.well-known/governance-keys.json` | 已发布的治理密钥 |

<a id="phase-3-policy--advisories"></a>
<a id="phase-3-policy-advisories"></a>

### 第 3 阶段：策略与通告

| 方法 | 路径 | 说明 |
|--------|------|-------------|
| GET | `/v2/policy` | 当前的验证器策略（模式、算法、约束） |
| POST | `/v2/policy/mode` | 切换验证器模式（`classical_only`、`hybrid_preferred`、`hybrid_required`、`pq_only`）（**运营方**） |
| GET | `/.well-known/algorithm-advisories.json` | 已发布的算法通告 |
| POST | `/v2/advisory/publish` | 发布算法通告，按其 schema 校验；最多 1000 条（**运营方**） |
| GET | `/v2/advisory/check` | 检查特定算法是否受影响 |
| POST | `/v2/advisory/auto-apply` | 把通告自动应用到验证器策略（**运营方**） |

**运营方**端点会更改验证器的信任配置。它们需要 `Authorization: Bearer <OPERATOR_TOKEN>`，否则返回 401；未配置
`OPERATOR_TOKEN` 时它们保持锁定。

<a id="dcp-05-to-dcp-09"></a>

### DCP-05 至 DCP-09

用于生命周期、继承、争议、权利和委托记录的 31 个端点；它们列在 [docs/OPERATOR_GUIDE.md](../docs/OPERATOR_GUIDE.md#dcp-0509-service-endpoints) 中。它们会按 schema 校验每条记录，但**不验证任何签名，也不需要令牌**，`OPERATOR_TOKEN` 也不保护它们：任何能访问服务器的人都可以让智能体停用或重新投入使用、撤销可撤销的委托授权书，或把争议标记为已解决。不要把它们暴露给不受信任的客户端。

<a id="environment-variables"></a>

## 环境变量

| 变量 | 默认值 | 说明 |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP 监听端口 |
| `OPERATOR_TOKEN` | — | 用于运营方端点和登记新 `agent_id` 的 Bearer 令牌。未设置：两者都保持锁定 |
| `VERIFIER_MODE` | `hybrid_required` | 启动时的验证模式：`classical_only`、`hybrid_preferred`、`hybrid_required` 或 `pq_only`。无效值会使服务器停止 |
| `ALLOW_V1_BUNDLES` | `true` | 设为 `false` 时 `POST /verify` 拒绝 V1 bundle（`pq_only` 总是拒绝） |
| `TRUST_PROXY` | — | 仅在会把客户端 IP 追加到 `X-Forwarded-For` 的代理（Fly、nginx）之后设为 `true`。此时限流以其最后一跳为准；否则以套接字地址为准，因为客户端可以伪造该请求头 |
| `REGISTRATIONS_PER_HOUR` | `20` | 每个客户端每小时的 `POST /v2/passport/register` 调用次数；超出的会得到 429 |
| `MAX_REGISTERED_KEYS` | `10000` | 注册表中的密钥数；达到后新智能体和轮换会得到 507（不会逐出任何内容） |
| `DCP_TRUSTED_PRINCIPALS_FILE` | — | `POST /v2/admit` 的信任集（`schemas/v2/principal_trust_set.schema.json`），每次准入时读取，内容变化时重新加载。无效的文件会使服务器在启动时停止；如果之后损坏，则拒绝准入（503）。任何准入变量被设为空值都会使服务器停止 |
| `DCP_ADMISSION_PROFILE_FILE` | — | strict-v1 配置（`schemas/v2/admission_profile.schema.json`）。需要与其相邻的两个变量；存在矛盾时服务器会停止 |
| `DCP_REVOCATION_LIST_URL` | — | 用于 strict-v1 的、采用撤销服务 `/.well-known/dcp-revocations.json` 格式的完整拒绝列表：`https`（明文 `http` 仅限回环主机），不跟随重定向，最多 16 MiB。`DCP_REVOCATION_LIST_AUTHORIZATION` 设置 `Authorization` 请求头；`DCP_REVOCATION_TIMEOUT_MS`（默认 5000）限制请求时长 |
| `MAX_KEYS_PER_AGENT` | `64` | 一个智能体在其生命周期内可登记的密钥数；之后的轮换会得到 409。对于经常轮换的智能体请调高它（每个退役密钥占用约 100 字节的墓碑） |

`REQUIRE_SESSION_BINDING`、`REQUIRE_COMPOSITE_BINDING`、`MAX_KEY_AGE_DAYS`、`PQ_CHECKPOINT_INTERVAL` 和
`ADVISORY_POLL_INTERVAL_MS` 出现在 Docker 和 Fly 的配置中，但目前还不会被读取：适用的是内置策略（`server/index.js` 中的
`VERIFIER_POLICY`：要求会话绑定和复合绑定，密钥年龄阈值为 365 天），可以通过 `GET /v2/policy` 查看。

<a id="trust-model"></a>

## 信任模型

- **护照登记**会对照护照所列的密钥验证其复合自签名（`DCP-AI.v2.AgentPassport`，Ed25519 + ML-DSA-65；仅经典签名只在
  `classical_only` / `hybrid_preferred` 模式下接受）。该签名证明了对生成它的密钥（经典密钥，以及存在时的 PQ 密钥）的持有，并且只登记这些密钥：列出他人的
  公钥不会登记任何东西。密钥和签名必须是与其算法大小完全相符的规范 base64。
- 登记**新的** `agent_id` 需要 `Authorization: Bearer <OPERATOR_TOKEN>`（否则返回 401）。护照只是自签名的，委托人的 RPR
  也是如此，因此如果没有信任锚，任何人都可以抢先认领受害者的 `agent_id` 并对其执行紧急撤销：由运营方为新智能体担保。再次
  登记它（例如为了替换紧急撤销令牌）需要一份 `created_at` 晚于已登记护照的护照，因为已签名的护照是公开的，旧护照可能被重放；
  并且该护照必须恰好由该智能体当前有效的密钥（登记在其名下、未撤销、未过期）签名，无论 `VERIFIER_MODE` 对新智能体允许什么；
  否则返回 409。已登记的密钥条目会被保留，因此新护照不能延长某个密钥的 `expires_at`，不带令牌的护照会保留已登记的令牌。
- 失去其所登记某一类别全部有效密钥的智能体（例如其 ML-DSA-65 密钥已过期）不能重新登记：它剩下的密钥不应单独替换令牌。
  恢复需要通过紧急撤销令牌（先撤销，再登记新的 `agent_id`）或通过运营方进行，而运营方目前还没有相应的 API。登记在另一个
  智能体名下的 kid 同样返回 409，已被紧急撤销的智能体也不能重新登记。
- **密钥轮换**接收由 `@dcp-ai/sdk` 中的 `createKeyRotation` 构建的 `KeyRotationRecord`：新密钥在 `DCP-AI.v2.KeyRotation`
  下对 `{old_kid, new_kid, timestamp}` 签名（持有证明），旧密钥对其进行会签。旧密钥必须有效（未撤销、未过期）；之后它会被
  标记为已撤销。
- **多方授权**：每一方在 `DCP-AI.v2.MultiPartyAuth` 下对 `{operation, operation_payload, party_id, role}` 签名
  （`sdks/typescript/src/core/multi-party-auth.ts` 中的 `createPartyAuthorization`，`@dcp-ai/sdk` 2.1.1 未导出）。一方是
  通过 `/v2/passport/register` 登记的身份，其签名 kid 必须是登记在其 `party_id` 名下的有效（未撤销、未过期）密钥。无论以
  哪些角色签名，每一方对 `required_parties` 只计一次。角色由签名者自行声明，不会在任何地方查证。
- **运营方端点**只由 `OPERATOR_TOKEN` 保护。通告的 `composite_sig` 只做结构检查：`@dcp-ai/sdk` 目前还没有
  `AlgorithmAdvisory` 上下文标签，因此由运营方为通告担保。
- 密钥注册表在达到 `MAX_REGISTERED_KEYS` 个密钥（10,000）后会拒绝新智能体和轮换（507），而不是逐出旧密钥，因为被逐出的
  `agent_id` 会失去保护它的历史记录（重新登记它仍需要运营方令牌，但可以使用任意密钥）。为了不让单个智能体占满注册表，轮换只保留该智能体最近的 4 个退役密钥，并在检查上限之前
  丢弃最旧的一个，这样即使注册表已满也仍能完成一次轮换。被丢弃的密钥会以墓碑形式保留：`GET /v2/keys/:kid` 返回
  `revoked: true, retired: true` 以及 `key: null`，任何人都永远不能再登记该密钥。一个智能体在其生命周期内最多可登记
  `MAX_KEYS_PER_AGENT` 个密钥（64），因此其墓碑数量也有上限；超过之后轮换会得到 409。登记按客户端限流
  （`REGISTRATIONS_PER_HOUR`），并且对已登记的护照只保留 `created_at`，而不保留整份已签名护照。

<a id="usage-examples"></a>

## 使用示例

除健康检查、模式切换和能力发现外，下面的请求都是模板：其中的 bundle、签名和密钥都是占位符（`...`、`<64 hex>`），因此不能
按原样运行，也不应填入编造的值。

<a id="health-check"></a>

### 健康检查

```bash
curl -s http://localhost:3000/health | jq .
```

<a id="v1-bundle-verification"></a>

### V1 bundle 验证

```bash
curl -s -X POST http://localhost:3000/verify \
  -H "Content-Type: application/json" \
  -d '{
    "signed_bundle": {
      "bundle": { ... },
      "signature": { "alg": "ed25519", "sig_b64": "...", "signer": { "public_key_b64": "..." } }
    }
  }'
```

<a id="v2-passport-registration"></a>

### V2 护照登记

请求体是 `AgentPassportV2` 的 `SignedPayload`，由其所列的密钥用
`compositeSign(registry, DCP_CONTEXTS.AgentPassport, canonicalBytes, keys)` 签名（SDK 构建的 bundle 中的
`agent_passport` 就是这种形态）。

```bash
curl -s -X POST http://localhost:3000/v2/passport/register \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "signed_passport": {
      "payload": {
        "dcp_version": "2.0",
        "agent_id": "agent:research-bot-001",
        "session_nonce": "<64 hex>",
        "keys": [
          { "kid": "<32 hex>", "alg": "ed25519", "public_key_b64": "...", "created_at": "...", "expires_at": null, "status": "active" },
          { "kid": "<32 hex>", "alg": "ml-dsa-65", "public_key_b64": "...", "created_at": "...", "expires_at": null, "status": "active" }
        ],
        "principal_binding_reference": "human:alice-001",
        "capabilities": ["browse"],
        "risk_tier": "low",
        "created_at": "...",
        "status": "active",
        "emergency_revocation_token": "sha256:<64 hex>"
      },
      "payload_hash": "sha256:...",
      "composite_sig": {
        "classical": { "alg": "ed25519", "kid": "<32 hex>", "sig_b64": "..." },
        "pq": { "alg": "ml-dsa-65", "kid": "<32 hex>", "sig_b64": "..." },
        "binding": "pq_over_classical"
      }
    }
  }'
```

响应：201 `{ ok, agent_id, registered_kids }`、400（schema 或 kid 不匹配，或密钥不是规范 base64）、401（新的 `agent_id`
没有运营方令牌）、403（签名无效，或智能体已被撤销）、409（智能体已用其他密钥登记、护照不晚于已登记的护照、智能体没有某个
已登记类别的有效密钥，或某个 kid 已退役或属于另一个智能体）、429（超出速率限制）、507（注册表已满）。

<a id="key-rotation"></a>

### 密钥轮换

```bash
# body = createKeyRotation(registry, { oldKid, oldAlg, oldSecretKeyB64, newKid, newAlg,
#                                      newSecretKeyB64, newPublicKeyB64, timestamp, expiresAt })
curl -s -X POST http://localhost:3000/v2/keys/rotate \
  -H "Content-Type: application/json" \
  -d '{
    "old_kid": "<32 hex>",
    "new_key": { "kid": "<32 hex>", "alg": "ed25519", "public_key_b64": "...", "created_at": "...", "expires_at": null, "status": "active" },
    "timestamp": "2026-03-01T00:00:00Z",
    "proof_of_possession": { "alg": "ed25519", "kid": "<new kid>", "sig_b64": "..." },
    "authorization_sig": { "alg": "ed25519", "kid": "<old kid>", "sig_b64": "..." }
  }'
```

<a id="switching-the-verifier-mode-operator"></a>

### 切换验证器模式（运营方）

```bash
curl -s -X POST http://localhost:3000/v2/policy/mode \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "mode": "pq_only" }'
```

<a id="v2-intent-declaration"></a>

### V2 意图声明

请求体是已登记智能体的 `IntentV2` 的 `SignedPayload`。其 `composite_sig` 必须存在，但不会被验证。服务器自行为意图打分，并返回 `{ ok, policy_decision, security_tier, verification_mode, checkpoint_interval }`；策略决定未签名（风险达到 800 时为 `block`，达到 500 时为 `escalate`）。

下面的请求只用于说明形态：发送前请把省略号和占位符替换为你的已签名载荷。字面上的 `{ ... }` 片段不是有效的 JSON。

```bash
curl -s -X POST http://localhost:3000/v2/intent/declare \
  -H "Content-Type: application/json" \
  -d '{
    "signed_intent": {
      "payload": {
        "dcp_version": "2.0",
        "intent_id": "intent:...",
        "session_nonce": "<64 hex>",
        "agent_id": "agent:research-bot-001",
        "human_id": "human:alice-001",
        "timestamp": "...",
        "action_type": "api_call",
        "target": { "channel": "api" },
        "data_classes": ["pii"],
        "estimated_impact": "medium",
        "requires_consent": false
      },
      "payload_hash": "sha256:...",
      "composite_sig": { "classical": { ... }, "pq": { ... }, "binding": "pq_over_classical" }
    }
  }'
```

<a id="v2-bundle-verification"></a>

### V2 bundle 验证

```bash
curl -s -X POST http://localhost:3000/v2/bundle/verify \
  -H "Content-Type: application/json" \
  -d '{
    "signed_bundle": {
      "bundle": {
        "dcp_bundle_version": "2.0",
        "manifest": { "session_nonce": "...", "rpr_hash": "sha256:...", ... },
        "responsible_principal_record": { "payload": { ... }, "payload_hash": "sha256:...", "composite_sig": { ... } },
        "agent_passport": { ... },
        "intent": { ... },
        "policy_decision": { ... },
        "audit_entries": [ ... ]
      },
      "signature": {
        "hash_alg": "sha256",
        "created_at": "...",
        "signer": { "type": "human", "id": "...", "kids": ["..."] },
        "manifest_hash": "sha256:...",
        "composite_sig": {
          "classical": { "alg": "ed25519", "kid": "...", "sig_b64": "..." },
          "pq": { "alg": "ml-dsa-65", "kid": "...", "sig_b64": "..." },
          "binding": "pq_over_classical"
        }
      }
    },
    "public_key_b64": "..."
  }'
```

格式为 `schemas/v2/signed_bundle.schema.json`；请用 `@dcp-ai/sdk` 的 `BundleBuilderV2` + `signBundleV2` 或 `dcp sign-bundle --composite` 构建。`public_key_b64` 是可选的，用于固定经典签名者。规范化之前的信封（顶层的 `dcp_version` / `bundle_manifest`）会被拒绝。

<a id="emergency-revocation"></a>

### 紧急撤销

秘密值是随护照登记的 `emergency_revocation_token` 的原像。每个客户端 IP 每分钟最多 5 次尝试。

```bash
curl -s -X POST http://localhost:3000/v2/emergency-revoke \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "agent:research-bot-001",
    "revocation_secret": "<64 hex>"
  }'
```

<a id="capability-discovery"></a>

### 能力发现

```bash
curl -s http://localhost:3000/.well-known/dcp-capabilities.json | jq .
```

<a id="architecture"></a>

## 架构

```
                    ┌──────────────────────────┐
                    │    DCP Reference Gateway  │
                    ├──────────────────────────┤
                    │  V1 Verification          │
                    │  V2 Composite Verification│
                    │  Key Registry (in-memory) │
                    │  Audit Chains (in-memory) │
                    │  Policy Engine (Phase 3)  │
                    │  Advisory System           │
                    │  Governance Keys           │
                    └──────────────────────────┘
```

<a id="limitations"></a>

## 限制

- **内存存储**：所有状态（护照、密钥、审计链、通告）在重启后都会丢失。参见[持久化](#persistence)。
- **bundle 验证之外的签名**：bundle 验证、护照登记、密钥轮换和多方授权会检查真实的 Ed25519 和 ML-DSA-65 / SLH-DSA 签名。`/v2/advisory/publish` 和 `/v2/governance/register` 不检查（运营方令牌是它们唯一的保护），`/v2/intent/declare`、`/v2/audit/*` 以及 DCP-05 至 DCP-09 端点也不检查，而且后者还不需要令牌（参见 [DCP-05 至 DCP-09](#dcp-05-to-dcp-09)）。
- **锚定**：`POST /anchor` 返回 501。请用你的区块链（Ethereum、Bitcoin）或透明日志来实现。

<a id="persistence"></a>

## 持久化

不会向磁盘写入任何内容。重启、部署或机器停止都会清空护照和密钥注册表，因此清空之后登记历史就不复存在：持有运营方令牌的人可以用其他密钥重新登记任何
`agent_id`，紧急撤销也会被遗忘。因此 `deploy/fly/verification.toml` 让一台机器保持运行（`min_machines_running = 1`），而不是缩容到
零；部署和重启仍然会从空状态开始。生产部署需要持久存储。

<a id="deployment"></a>

## 部署

- 在生产中，请在带 TLS 的反向代理（nginx、Caddy）之后运行，并且只有在它会把客户端 IP 追加到 `X-Forwarded-For` 时才设置 `TRUST_PROXY=true`。
- 使用进程管理器（systemd、PM2）实现自动重启。
- 容器化部署请参见 [Docker 设置](../docker/README.md)。

<a id="reference"></a>

## 参考

- [spec/VERIFICATION.md](../spec/VERIFICATION.md) — 规范性的验证检查清单
- [spec/DCP-AI-v2.0.md](../spec/DCP-AI-v2.0.md) — V2 协议规范
- [docs/OPERATOR_GUIDE.md](../docs/OPERATOR_GUIDE.md) — 运营方指南
