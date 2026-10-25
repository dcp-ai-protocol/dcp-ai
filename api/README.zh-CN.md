<sub>[English](README.md) · **中文** · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="api--openapi--protocol-buffers"></a>

# API — OpenAPI 与 Protocol Buffers

> 本文是[英文版](README.md)的参考译文，更新于 25/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

DCP API 的正式定义：用于 HTTP/REST 的 OpenAPI 3.1 规范，以及用于 gRPC 的 Protocol Buffers。可以用这些定义生成任何语言的客户端。

它们涵盖的内容（2026 年 10 月 25 日）：

- `openapi.yaml` 描述参考网关（`server/`）以及锚定、透明日志和撤销服务。它不涵盖 `POST /v2/admit`，也不涵盖网关的 DCP-05 至 DCP-09 端点；这些内容请参见 [server/README.md](../server/README.md) 和 [docs/OPERATOR_GUIDE.md](../docs/OPERATOR_GUIDE.md)。
- `proto/dcp.proto` 只是一份定义：本仓库中没有任何 gRPC 服务器或客户端实现它。
- 本仓库没有配置任何托管的 DCP-AI API。除了本地开发地址之外，`openapi.yaml` 还列出了 `https://api.dcp-ai.org`；在那里声明的 URL 并不能证明存在正在运行的服务，本说明既不检查也不调用它。本说明涵盖的是由运营方运行的服务。

<a id="files"></a>

## 文件

| 文件 | 格式 | 说明 |
|------|--------|-------------|
| `openapi.yaml` | OpenAPI 3.1.0 | REST 规范（V1 + V2 + 第 3 阶段），上面列出的排除项除外 |
| `proto/dcp.proto` | Protocol Buffers 3 | 包含 5 个服务的 gRPC 定义 |

<a id="openapi-spec"></a>

## OpenAPI 规范

<a id="servers"></a>

### 服务器

| 环境 | URL |
|-------------|-----|
| 网关（本地） | `http://localhost:3000` |
| 锚定服务（本地） | `http://localhost:3001` |
| 透明日志（本地） | `http://localhost:3002` |
| 撤销服务（本地） | `http://localhost:3003` |

<a id="endpoints"></a>

### 端点

<a id="health--discovery"></a>
<a id="health-discovery"></a>

#### 健康与发现

| 方法 | 路径 | 说明 |
|--------|------|-------------|
| `GET /health` | 健康检查 | 响应：`{ ok, service, supported_versions }` |
| `GET /.well-known/dcp-capabilities.json` | 能力发现 | 响应：支持的版本、算法和功能 |
| `GET /.well-known/algorithm-advisories.json` | 算法通告 | 响应：`{ advisories }` |
| `GET /.well-known/governance-keys.json` | 治理密钥 | 响应：治理密钥集 |

<a id="verification"></a>

#### 验证

| 方法 | 路径 | 说明 |
|--------|------|-------------|
| `POST /verify` | 验证 Signed Bundle（自动识别 V1/V2） | 请求：`{ signed_bundle, public_key_b64? }` → 响应：`{ verified, dcp_version, errors, warnings }` |
| `POST /v2/bundle/verify` | 按等级进行的完整 V2 验证（仅限规范性的 `SignedBundleV2`；V1 bundle 返回 400） | 响应增加 `resolved_tier`、`verification_mode`、`session_binding_valid` |

<a id="v2-passport--keys"></a>
<a id="v2-passport-keys"></a>

#### V2：护照与密钥

| 方法 | 路径 | 说明 |
|--------|------|-------------|
| `POST /v2/passport/register` | 登记智能体护照和密钥（新的 `agent_id` 需要运营方令牌） | 请求：`{ signed_passport }`；复合自签名必须能通过验证 |
| `GET /v2/keys/{kid}` | 查询密钥注册表 | 响应：`{ found, kid, key, agent_id }` |
| `POST /v2/keys/rotate` | 带持有证明的密钥轮换 | 请求：`KeyRotationRecord`（`{ old_kid, new_key, timestamp, proof_of_possession, authorization_sig }`） |

<a id="v2-intent--policy"></a>
<a id="v2-intent-policy"></a>

#### V2：意图与策略

| 方法 | 路径 | 说明 |
|--------|------|-------------|
| `POST /v2/intent/declare` | 声明意图并获取策略 | 请求：`{ signed_intent }`（其 `composite_sig` 不会被验证）→ 响应：`{ ok, policy_decision, security_tier, verification_mode, checkpoint_interval }` |
| `GET /v2/policy` | 当前的验证器策略 | 响应：`{ policy, policy_hash, mode }` |
| `POST /v2/policy/mode` | 切换验证器模式（运营方令牌） | 请求：`{ mode }`（pq_only、hybrid_required 等） |

<a id="v2-audit"></a>

#### V2：审计

| 方法 | 路径 | 说明 |
|--------|------|-------------|
| `POST /v2/audit/append` | 追加审计事件 | 请求：`{ audit_event }` |
| `POST /v2/audit/compact` | 压缩审计轨迹 | 请求：`{ compaction }` |

<a id="v2-revocation--emergency"></a>
<a id="v2-revocation-emergency"></a>

#### V2：撤销与紧急情况

| 方法 | 路径 | 说明 |
|--------|------|-------------|
| `POST /v2/emergency-revoke` | 紧急撤销（紧急按钮） | 有速率限制，并验证原像 |
| `POST /v2/multi-party/authorize` | M-of-N 多方授权 | 请求：`{ authorization }` |

<a id="v2-advisory--governance"></a>
<a id="v2-advisory-governance"></a>

#### V2：通告与治理

| 方法 | 路径 | 说明 |
|--------|------|-------------|
| `POST /v2/advisory/publish` | 发布算法通告（运营方令牌） | 请求：`{ advisory }` |
| `GET /v2/advisory/check` | 检查有效的通告 | 响应：`{ deprecated, warned, revoked }` |
| `POST /v2/advisory/auto-apply` | 把通告自动应用到策略（运营方令牌） | 移除已弃用的算法并加入替代算法 |
| `POST /v2/governance/register` | 登记治理密钥集（运营方令牌） | 请求：`{ governance_key_set }` |

<a id="anchoring"></a>

#### 锚定

| 方法 | 路径 | 说明 |
|--------|------|-------------|
| `POST /anchor` | 锚定 bundle 哈希 | 在锚定服务（`:3001`）上：请求 `{ bundle_hash }` → 响应 `{ anchored, chain, tx_hash }`（在实现链上提交之前 `tx_hash: null`），批量模式下返回 202。在网关（`:3000`）上：501 |

<a id="revocation-service-on-port-3003"></a>

#### 撤销（3003 端口上的服务）

`openapi.yaml` 把这些端点列在 `/revocations` 前缀之下，即代理该服务的网关会暴露的形式。参考网关不做代理：请用直接路径调用 3003 端口上的撤销服务。

| 方法 | 网关路径 | 直接路径（`:3003`） | 说明 |
|--------|-------------|----------------------|-------------|
| `GET` | `/revocations` | `/list` | 列出撤销 |
| `POST` | `/revocations` | `/revoke` | 发布撤销 |
| `GET` | `/revocations/{agent_id}` | `/check/{agent_id}` | 撤销状态 |

<a id="transparency-log-service-on-port-3002"></a>

#### 透明日志（3002 端口上的服务）

`openapi.yaml` 把这些端点列在 `/transparency-log` 前缀之下，即代理网关会暴露的形式。参考网关不做代理：请不带前缀调用 3002 端口上的服务。

| 方法 | 网关路径 | 直接路径（`:3002`） | 说明 |
|--------|-------------|----------------------|-------------|
| `POST` | `/transparency-log/add` | `/add` | 添加条目 |
| `GET` | `/transparency-log/root` | `/root` | 当前的 Merkle 根 |
| `GET` | `/transparency-log/proof/{index}` | `/proof/{index}` | 包含证明 |

<a id="main-schemas"></a>

### 主要 schema

- `SignedBundleV1` / `SignedBundleV2` — 已签名的 bundle（V1：Ed25519，V2：复合签名）
- `CitizenshipBundleV1` / `CitizenshipBundleV2` — Citizenship bundle；只有 V2 有清单和已签名载荷
- `CompositeSignature` — 带绑定模式的经典 + PQ 签名
- `SignedPayload` — 单独签名的构件信封
- `BundleManifest` — 带每个构件哈希和会话 nonce 的 V2 清单
- `VerificationResult` — 带 `verified`、`errors`、`warnings`、`verifier_policy_hash`、`resolved_tier` 的结果
- `KeyEntryV2` — 带 kid、alg 和状态的 V2 密钥条目
- `PolicyDecisionV2` — 带风险分数和安全等级的 V2 策略决定
- `VerifierPolicy` — 验证器策略配置
- `AlgorithmAdvisory` — 算法弃用或撤销通告
- `GovernanceKeySet` — 带阈值的治理密钥集
- `AnchorReceipt` — 锚定回执
- `RevocationRecord` — 撤销记录
- `InclusionProof` — 透明日志包含证明
- `ErrorResponse` — 标准错误响应

### Swagger UI

以交互方式查看规范：

```bash
# With Redocly CLI 1.x (downloads it)
npx @redocly/cli@1 preview-docs api/openapi.yaml

# Or with Docker
docker run -p 8080:8080 -e SWAGGER_JSON=/api/openapi.yaml \
  -v $(pwd)/api:/api swaggerapi/swagger-ui
```

<a id="protocol-buffers-grpc"></a>

## Protocol Buffers（gRPC）

<a id="package"></a>

### 包

```protobuf
package dcp.v1;
option go_package = "github.com/dcp-ai/dcp-ai-go/proto";
```

`go_package` 路径不是已发布的模块；生成代码时请设置你自己的路径。

<a id="services"></a>

### 服务

#### VerificationService

| RPC | 请求 | 响应 |
|-----|---------|----------|
| `VerifyBundle` | `VerifyBundleRequest` | `VerifyBundleResponse` |
| `ValidateBundle` | `ValidateBundleRequest` | `ValidateBundleResponse` |
| `VerifyBundleV2` | `VerifyBundleV2Request` | `VerifyBundleV2Response` |
| `HealthCheck` | `HealthCheckRequest` | `HealthCheckResponse` |

#### AnchorService

| RPC | 请求 | 响应 |
|-----|---------|----------|
| `AnchorHash` | `AnchorHashRequest` | `AnchorHashResponse` |
| `AnchorBatch` | `AnchorBatchRequest` | `AnchorBatchResponse` |
| `CheckAnchor` | `CheckAnchorRequest` | `CheckAnchorResponse` |

#### RevocationService

| RPC | 请求 | 响应 |
|-----|---------|----------|
| `Revoke` | `RevokeRequest` | `RevokeResponse` |
| `RevokeV2` | `RevokeV2Request` | `RevokeV2Response` |
| `EmergencyRevoke` | `EmergencyRevokeRequest` | `EmergencyRevokeResponse` |
| `CheckRevocation` | `CheckRevocationRequest` | `CheckRevocationResponse` |
| `CheckRevocationByKid` | `CheckRevocationByKidRequest` | `CheckRevocationByKidResponse` |
| `ListRevocations` | `ListRevocationsRequest` | `ListRevocationsResponse` |

#### TransparencyLogService

| RPC | 请求 | 响应 |
|-----|---------|----------|
| `AddEntry` | `AddEntryRequest` | `AddEntryResponse` |
| `GetRoot` | `GetRootRequest` | `GetRootResponse` |
| `GetProof` | `GetProofRequest` | `GetProofResponse` |

#### KeyService

| RPC | 请求 | 响应 |
|-----|---------|----------|
| `RegisterKeys` | `RegisterKeysRequest` | `RegisterKeysResponse` |
| `LookupKey` | `LookupKeyRequest` | `LookupKeyResponse` |
| `RotateKey` | `RotateKeyRequest` | `RotateKeyResponse` |

<a id="generate-clients"></a>

### 生成客户端

这些命令需要安装相应的工具（`protoc` 及其插件、`grpc_tools`、`tonic-build`）；编写本页时没有运行它们。

#### Go

```bash
protoc --go_out=. --go-grpc_out=. api/proto/dcp.proto
```

#### Python

```bash
python -m grpc_tools.protoc \
  -I api/proto \
  --python_out=. \
  --grpc_python_out=. \
  api/proto/dcp.proto
```

#### TypeScript

```bash
npx grpc_tools_node_protoc \
  --ts_out=. \
  --grpc_out=. \
  -I api/proto \
  api/proto/dcp.proto
```

#### Rust

在 `build.rs` 中使用 `tonic-build`：

```rust
fn main() {
    tonic_build::compile_protos("api/proto/dcp.proto").unwrap();
}
```

<a id="development"></a>

## 开发

```bash
# Validate OpenAPI spec
npx @redocly/cli lint api/openapi.yaml

# Generate clients with OpenAPI Generator
npx @openapitools/openapi-generator-cli generate \
  -i api/openapi.yaml \
  -g typescript-fetch \
  -o generated/ts-client
```

<a id="license"></a>

## 许可证

Apache-2.0
