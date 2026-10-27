<sub>[English](MIGRATION_V1_V2.md) · **中文** · [Español](MIGRATION_V1_V2.es.md) · [日本語](MIGRATION_V1_V2.ja.md) · [Português](MIGRATION_V1_V2.pt-BR.md)</sub>

<a id="migration-guide-dcp-ai-v10-to-v20"></a>

# 迁移指南：从 DCP-AI v1.0 到 v2.0

**Rust 发布 (26/10/2026).** Rust `dcp-ai` 2.11.0 已在 crates.io 发布，包含验证器修复、准入和实验性显式启用 API。`dcp-jcs-v1` 仍是规范性默认配置。见 [Rust 2.11.0](RUST_RELEASE.md).

**Go 发布 (26/10/2026).** Go SDK `v2.11.0` 已通过模块标签 `sdks/go/v2.11.0` 发布，包含验证器修复、准入和实验性显式启用 API。Rust 仍独立发布。见 [Go v2.11.0](GO_RELEASE.md).

**Python 发布 (26/10/2026).** `dcp-ai` 2.10.0 已在 PyPI 发布，包含验证器修复、准入和实验性显式启用 API。Go 和 Rust 仍独立发布。见 [Python 2.10.0](PYTHON_RELEASE.md).

> 本文是[英文版](MIGRATION_V1_V2.md)的参考译文，更新于 26/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

**规范版本：** 2.0
**最后更新：** 2026 年 10 月
**适用于：** `main` 上的 SDK 和已发布的 `@dcp-ai/sdk` 2.2.0。npm 版本已于 2026 年 10 月 26 日核实；见 [NPM_RELEASES.md](NPM_RELEASES.md) 和 [SECURITY.md](../SECURITY.md#supported-versions)。其他生态有独立的发布周期。

本指南带你把现有的 DCP-AI v1.0 集成迁移到 v2.0。迁移会引入后量子复合签名、双哈希链、会话绑定、自适应安全等级和智能体间通信；同时，有效的 v1.0 bundle 在验证器策略允许的情况下仍可通过验证（参见 1.2）。

---

<a id="1-what-changed-in-v20"></a>

## 1. v2.0 的变化

<a id="11-summary-of-changes"></a>

### 1.1 变化概要

| 功能 | v1.0 | v2.0 |
|---------|------|------|
| **签名** | 仅 Ed25519 | 复合：Ed25519 + ML-DSA-65（PQ） |
| **哈希链** | 仅 SHA-256 | 双链：SHA-256 + SHA3-256 |
| **会话绑定** | 无 | 每个构件都带 `session_nonce` |
| **安全等级** | 无 | 自适应：routine / standard / elevated / maximum |
| **bundle 清单** | `bundle_hash` + `merkle_root` | 完整清单，包含每个构件的哈希、次级 Merkle 根和 PQ 检查点 |
| **签名格式** | `{ alg, public_key_b64, sig_b64 }` | `{ composite_sig: { classical, pq, binding } }` |
| **A2A 通信** | 未规定 | DCP-04：发现、握手、加密会话 |
| **验证策略** | 由智能体声明 | 由验证器决定 |
| **域分离** | 无 | 所有签名都带上下文标签 |
| **kid 导出** | 依实现而定 | 确定性：`hex(SHA-256(alg || 0x00 || pk))[0:32]` |
| **数值字段** | 混合（int/float） | 仅整数（禁止 float） |
| **隐私** | 仅完整 RPR | 提供盲化 RPR 模式 |
| **密钥恢复** | 未规定 | M-of-N 社交恢复（Shamir SSS） |
| **紧急吊销** | 未规定 | 预先登记的吊销令牌 |
| **算法治理** | 未规定 | 带自动响应的已签名公告 |
| **线上格式** | 仅 JSON | JSON（默认）+ CBOR（可选） |

<a id="12-breaking-changes"></a>

### 1.2 不兼容的变更

v1.0 格式仍然有效，但有以下限制：

- 同时处理两个版本的验证器，在其策略为 `allow_v1_bundles: true`（默认值）且实际生效的模式能容忍仅经典签名时
  （见下文），会接受有效的 v1.0 bundle。`verifySignedBundleV2` 本身
  只接受 v2.0：请把 v1.0 bundle 交给 V1 验证器（参见 3.2）。
- 接受条件比以前的版本更严格：例如，`S` 不小于群阶 `L` 的 Ed25519 签名现在会被拒绝
  （参见变更日志的 [`[Unreleased]`](../CHANGELOG.md#unreleased)），因此以前的验证器接受过的
  已存储 v1.0 bundle 可能不再通过验证。
- v1.0 验证器会拒绝 v2.0 bundle（`"unsupported dcp_version 2.0"`）。

v1.0 bundle 只有一个 Ed25519 签名，没有后量子签名，因此验证中间件（`@dcp-ai/express`、`@dcp-ai/openclaw`、`dcp_ai.fastapi`）只有在仅经典签名的 v2.0 bundle 能通过的情况下才接受它（VERIFICATION.md V2-10）：V1 护照 `risk_tier` 对应的策略模式，与根据 V1 意图和策略决定计算出的安全等级模式（V1 的 `risk_score` 取值 0 到 1，乘以 1000；缺失时按 `elevated` 计）两者中较严格者，必须是 `classical_only` 或 `hybrid_preferred`。在默认策略下，意图为 routine 或 standard 的 V1 bundle 会通过，而涉及支付、敏感数据、高预估影响或风险分数 0.5 及以上的 V1 bundle 会被拒绝；Express 的 `requireHybrid` 会拒绝所有 V1 bundle。

迁移是**增量式的**：v2.0 在 v1.0 格式旁边引入新的字段和结构。你可以分别独立地迁移生产方（智能体）和消费方（验证器）。

---

<a id="2-step-by-step-migration"></a>

## 2. 分步迁移

<a id="step-1-update-sdk"></a>

### 步骤 1：更新 SDK

示例适用于已发布的 TypeScript SDK 2.2.0、Python `dcp-ai` 2.10.0、Go `v2.11.0` 和 Rust `dcp-ai` 2.11.0。见 [Python](PYTHON_RELEASE.md)、[Go](GO_RELEASE.md)、[Rust](RUST_RELEASE.md) 发布说明及各 SDK README 中记录的限制。

**TypeScript**（2026 年 10 月 26 日已发布：2.2.0）：

```bash
npm install @dcp-ai/sdk@^2.2.0
```

**Python：**

```bash
pip install -e /path/to/dcp-ai/sdks/python     # main
# or the published version, with optional framework extras: pip install --upgrade 'dcp-ai[fastapi]'
```

**Go**（注意 Go 模块要求的主版本后缀 v2）：

```bash
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.11.0
```

**Rust：**

```toml
dcp-ai = "2.11.0"
```

**WebAssembly：** 从检出副本构建 `sdks/wasm`（`npm run build`），然后执行 `npm install /path/to/dcp-ai/sdks/wasm`。

<a id="step-2-generate-hybrid-key-pairs"></a>

### 步骤 2：生成混合密钥对

本次混合迁移使用经典（Ed25519）和后量子（ML-DSA-65）两种密钥对。是否接受仅经典签名，仍取决于实际生效的验证模式（1.2）。

**TypeScript：**

```typescript
import { getDefaultRegistry, registerDefaultProviders } from '@dcp-ai/sdk';

registerDefaultProviders(); // Ed25519, ML-DSA-65, SLH-DSA-192f into the default registry
const registry = getDefaultRegistry();

const classicalKp = await registry.getSigner('ed25519').generateKeypair();
const pqKp = await registry.getSigner('ml-dsa-65').generateKeypair();
// each: { kid, publicKeyB64, secretKeyB64 }; kid = deriveKid(alg, publicKey)
```

**Python：**

```python
import asyncio
from dcp_ai.providers.ed25519_provider import Ed25519Provider
from dcp_ai.providers.ml_dsa_65_provider import MlDsa65Provider

async def generate_hybrid():
    return await Ed25519Provider().generate_keypair(), await MlDsa65Provider().generate_keypair()

classical, pq = asyncio.run(generate_hybrid())
# each: {"kid", "public_key_b64", "secret_key_b64"}
```

Python SDK 使用 `dcp_ai.v2`（`BundleBuilderV2`、`sign_bundle_v2`、
`verify_signed_bundle_v2`；参见 5.2）构建、签署和验证 V2 bundle。

**CLI**（检出副本中的 `bin/dcp.js`）：

```bash
dcp keygen --hybrid ./keys/
# Creates: ed25519_{public_key,secret_key,kid}.txt and ml_dsa_65_{public_key,secret_key,kid}.txt
```

<a id="step-3-update-artifact-construction"></a>

### 步骤 3：更新构件的构建方式

V2 的 RPR、护照、意图和策略决定都增加了 `dcp_version: "2.0"` 和 bundle 的 `session_nonce`，并作为一个
`SignedPayload` 单独签名（步骤 4）。密钥移到了构件内部：RPR 在 `binding_keys` 中列出委托人的密钥，
护照在 `keys` 中列出智能体的密钥，每个密钥都带有 `kid`、`alg`、`public_key_b64`、`created_at`、
`expires_at` 和 `status`。

**之前（v1.0 RPR）：** 一个针对去掉自身后的对象所做的分离式 Ed25519 `signature`。

```json
{
  "dcp_version": "1.0",
  "human_id": "human:example-001",
  "legal_name": "Example Principal",
  "entity_type": "natural_person",
  "jurisdiction": "ES",
  "liability_mode": "owner_responsible",
  "override_rights": true,
  "issued_at": "2026-10-25T00:00:00Z",
  "expires_at": null,
  "contact": null,
  "signature": "<base64 Ed25519 signature>"
}
```

**之后（v2.0 RPR 载荷）：** 没有 `signature` 字段；复合签名位于载荷旁边（步骤 4）。

```json
{
  "dcp_version": "2.0",
  "human_id": "human:example-001",
  "session_nonce": "<64 hex characters>",
  "legal_name": "Example Principal",
  "entity_type": "natural_person",
  "jurisdiction": "ES",
  "liability_mode": "owner_responsible",
  "override_rights": true,
  "issued_at": "2026-10-25T00:00:00Z",
  "expires_at": null,
  "contact": null,
  "binding_keys": [
    { "kid": "<32 hex>", "alg": "ed25519", "public_key_b64": "...", "created_at": "2026-01-01T00:00:00Z", "expires_at": null, "status": "active" },
    { "kid": "<32 hex>", "alg": "ml-dsa-65", "public_key_b64": "...", "created_at": "2026-01-01T00:00:00Z", "expires_at": null, "status": "active" }
  ]
}
```

主要区别：
- `dcp_version` 为 `"2.0"`，`session_nonce`（64 个十六进制字符，256 位随机数）在 bundle 的所有
  构件中都相同。
- 护照用 `keys`（Ed25519 和 ML-DSA-65 条目）取代 `public_key`，策略决定中的
  `risk_score` 变为 0 到 1000 的整数（规范 §14.2）。
- 签名从载荷中移出。

<a id="step-4-switch-to-composite-signatures"></a>

### 步骤 4：改用复合签名

这四个 V2 构件各自都是一个 `SignedPayload`：载荷、载荷的哈希，以及在该构件的域分离上下文下所做的
复合签名（RPR 用委托人的密钥，护照、意图和策略决定用智能体的密钥）。

```json
{
  "payload": { "dcp_version": "2.0", "...": "..." },
  "payload_hash": "sha256:<hex of the canonical payload>",
  "composite_sig": {
    "classical": { "alg": "ed25519", "kid": "<32 hex>", "sig_b64": "..." },
    "pq": { "alg": "ml-dsa-65", "kid": "<32 hex>", "sig_b64": "..." },
    "binding": "pq_over_classical"
  }
}
```

主要区别：
- 每个分量通过 `kid`（确定性的，见步骤 2）指明其密钥，而不是携带公钥。
- `binding: "pq_over_classical"`：PQ 签名覆盖经典签名，因此无法在不使 PQ 签名失效的情况下替换经典签名。但 PQ
  签名本身仍可被移除，并把绑定改标为 `classical_only`：验证器在 `classical_only` 和 `hybrid_preferred` 模式下接受这种签名
  （后者附带警告），在 `hybrid_required` 和 `pq_only` 模式下拒绝。存在但无效的 PQ 签名在任何模式下都会被拒绝。

**TypeScript SDK**（这是一个片段；TypeScript SDK 的
[Quick Start (V2)](../sdks/typescript/README.md#quick-start-v2) 是完整、可运行的流程）：

```typescript
import { compositeSign, preparePayload, DCP_CONTEXTS } from '@dcp-ai/sdk';

// payload: a V2 artifact payload; registry and agentKeys (a CompositeKeyPair) as in Step 2
const { canonicalBytes, payloadHash } = preparePayload(payload);
const signedIntent = {
  payload,
  payload_hash: payloadHash,
  composite_sig: await compositeSign(registry, DCP_CONTEXTS.Intent, canonicalBytes, agentKeys),
};
```

<a id="step-5-add-domain-separation"></a>

### 步骤 5：加入域分离

每个 V2 签名都针对 `UTF8(context) || 0x00 || canonical_bytes` 计算，其中 context 是该构件的上下文
（`DCP-AI.v2.Intent`、`DCP-AI.v2.Bundle` 等，见 `DCP_CONTEXTS`）。`compositeSign`、`signBundleV2` 以及其他 SDK 中的
对应函数会替你完成这一步。如果你自己构建消息，请使用 V2 规范化
（`dcp-jcs-v1`）：

```typescript
import { canonicalizeV2, domainSeparatedMessage, DCP_CONTEXTS } from '@dcp-ai/sdk';

// manifest: the bundle manifest (Step 7)
const message = domainSeparatedMessage(DCP_CONTEXTS.Bundle, new TextEncoder().encode(canonicalizeV2(manifest)));
// classical signature over `message`; the PQ signature over `message || classical signature bytes`
```

<a id="step-6-update-audit-entries"></a>

### 步骤 6：更新审计条目

**之前（v1.0）：**

```json
{
  "dcp_version": "1.0",
  "audit_id": "audit:example-001",
  "prev_hash": "GENESIS",
  "timestamp": "2026-10-25T00:01:00Z",
  "agent_id": "agent:example-001",
  "human_id": "human:example-001",
  "intent_id": "intent:example-001",
  "intent_hash": "<hex>",
  "policy_decision": "approved",
  "outcome": "call_completed",
  "evidence": { "tool": "http", "result_ref": null }
}
```

**之后（v2.0）：**

```json
{
  "dcp_version": "2.0",
  "audit_id": "audit:example-001",
  "session_nonce": "<the bundle's nonce>",
  "prev_hash": "GENESIS",
  "hash_alg": "sha256",
  "timestamp": "2026-10-25T00:01:00Z",
  "agent_id": "agent:example-001",
  "human_id": "human:example-001",
  "intent_id": "intent:example-001",
  "intent_hash": "sha256:<hex of the canonical intent payload>",
  "policy_decision": "approved",
  "outcome": "call_completed",
  "evidence": { "tool": "http", "result_ref": null, "evidence_hash": null },
  "pq_checkpoint_ref": null
}
```

新字段：`session_nonce`、`hash_alg`、`evidence.evidence_hash` 和 `pq_checkpoint_ref`；哈希带有
`sha256:` 前缀。双哈希链会增加 `prev_hash_secondary`（SHA3-256）和 `hash_alg: "sha256+sha3-256"`。
当前的 V2 验证器（包括实验性候选）不会重新计算次级链或 `audit_merkle_root_secondary`：生成这些字段并不能证明存在这种额外保护
（[STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md#dual-hash-chains)）。
审计条目不逐条签名：清单通过审计 Merkle 根对它们作出承诺，PQ
检查点则对其中的区间签名。

<a id="step-7-construct-bundle-manifest"></a>

### 步骤 7：构建 bundle 清单

V1 对整个 bundle 签名（`signature.bundle_hash`）；V2 对一个承诺每个构件的清单签名。

**之前（v1.0 已签名 bundle）：**

```json
{
  "bundle": {
    "responsible_principal_record": { "...": "..." },
    "agent_passport": { "...": "..." },
    "intent": { "...": "..." },
    "policy_decision": { "...": "..." },
    "audit_entries": [{ "...": "..." }]
  },
  "signature": {
    "alg": "ed25519",
    "created_at": "2026-10-25T00:02:00Z",
    "signer": { "type": "human", "id": "human:example-001", "public_key_b64": "..." },
    "bundle_hash": "sha256:<hex>",
    "merkle_root": "sha256:<hex>",
    "sig_b64": "..."
  }
}
```

**之后（v2.0 已签名 bundle）：**

```json
{
  "bundle": {
    "dcp_bundle_version": "2.0",
    "manifest": {
      "session_nonce": "<64 hex>",
      "rpr_hash": "sha256:...",
      "passport_hash": "sha256:...",
      "intent_hash": "sha256:...",
      "policy_hash": "sha256:...",
      "audit_merkle_root": "sha256:...",
      "audit_count": 1,
      "canonicalization_profile": "dcp-jcs-v1"
    },
    "responsible_principal_record": { "payload": { "...": "..." }, "payload_hash": "sha256:...", "composite_sig": { "...": "..." } },
    "agent_passport": { "payload": { "...": "..." }, "payload_hash": "sha256:...", "composite_sig": { "...": "..." } },
    "intent": { "payload": { "...": "..." }, "payload_hash": "sha256:...", "composite_sig": { "...": "..." } },
    "policy_decision": { "payload": { "...": "..." }, "payload_hash": "sha256:...", "composite_sig": { "...": "..." } },
    "audit_entries": [{ "...": "..." }]
  },
  "signature": {
    "hash_alg": "sha256",
    "created_at": "2026-10-25T00:02:00Z",
    "signer": { "type": "human", "id": "human:example-001", "kids": ["<classical kid>", "<pq kid>"] },
    "manifest_hash": "sha256:<hex of the canonical manifest>",
    "composite_sig": { "classical": { "...": "..." }, "pq": { "...": "..." }, "binding": "pq_over_classical" }
  }
}
```

清单：
- 每个构件有一个哈希（各构件的 `payload_hash`），外加审计 Merkle 根；
- 可以增加 `audit_merkle_root_secondary`（SHA3-256）、`pq_checkpoints`、已签名的会话窗口
  （`session_issued_at`、`session_expires_at`）、`intended_verifier` 和 `canonicalization_profile`；
- 由责任委托人在 `DCP-AI.v2.Bundle` 上下文下用复合签名签署。

<a id="step-8-update-verifier-configuration"></a>

### 步骤 8：更新验证器配置

V2 验证接受一个由验证器而非 bundle 决定的验证器策略。从
`DEFAULT_VERIFIER_POLICY` 开始，修改你需要的部分：你省略的字段不会用默认值填充
（例如，没有 `max_key_age_days` 时就不会产生密钥年龄警告；该检查只警告，不拒绝）。

```typescript
import { DEFAULT_VERIFIER_POLICY, verifySignedBundleV2 } from '@dcp-ai/sdk';
import type { VerifierPolicy } from '@dcp-ai/sdk';

const policy: VerifierPolicy = {
  ...DEFAULT_VERIFIER_POLICY,
  default_mode: 'hybrid_required',
  risk_overrides: { high: 'hybrid_required', medium: 'hybrid_required', low: 'hybrid_preferred' },
  allow_v1_bundles: true,
};
// signedBundle and registry as in the TypeScript SDK's Quick Start (V2)
const result = await verifySignedBundleV2(signedBundle, registry, policy);
```

字段说明见 [API 参考](API_REFERENCE.md#verifierpolicy)。在过渡期间请保持 `allow_v1_bundles: true`。
V1 bundle 仍需要一种能容忍仅经典签名的模式：在此策略下
（medium 和 high 等级为 `hybrid_required`），验证中间件只接受来自
低风险护照、意图为 routine 或 standard 的 V1 bundle。

<a id="step-9-add-security-tier-support-optional"></a>

### 步骤 9：加入安全等级支持（可选）

根据意图以及携带 `risk_score` 的策略决定计算安全等级：

```typescript
// Fragment: the intent and the policy decision are V2 payloads, shortened here.
import { computeSecurityTier } from '@dcp-ai/sdk';
import type { IntentV2, PolicyDecisionV2 } from '@dcp-ai/sdk';

const intent = {
  intent_id: 'intent:...',
  action_type: 'api_call',
  data_classes: ['pii'],
  estimated_impact: 'medium',
  // ...
} as IntentV2;
const policyDecision = { risk_score: 350 /* , ... */ } as PolicyDecisionV2;

const tier = computeSecurityTier(intent, policyDecision);
// tier = "elevated" (pii is sensitive data; risk_score 350 alone would give "standard")
```

<a id="step-10-run-conformance-tests"></a>

### 步骤 10：运行一致性测试

在检出副本的根目录运行（每条命令在各自的子 shell 中）：

```bash
# TypeScript
(cd sdks/typescript && npm test)

# Python
(cd sdks/python && pytest)

# NIST KAT compliance only
(cd sdks/typescript && npx vitest run src/__tests__/nist-kat.test.ts)

# Protocol conformance (V1 + V2)
npm run conformance
```

---

<a id="3-backward-compatibility"></a>

## 3. 向后兼容

<a id="31-compatibility-matrix"></a>

### 3.1 兼容性矩阵

```
V1 Verifier + V1 Bundle  ->  PASS (unchanged)
V1 Verifier + V2 Bundle  ->  REJECT "unsupported dcp_version 2.0"
V2 Verifier + V1 Bundle  ->  PASS (when allow_v1_bundles=true and the effective mode
                                    for the bundle is classical_only or hybrid_preferred)
V2 Verifier + V2 Bundle  ->  PASS (full V2 verification)
```

<a id="32-coexistence-strategy"></a>

### 3.2 共存策略

在迁移期间，你的系统可以按版本分流，同时处理 v1.0 和 v2.0 bundle：

```typescript
// Fragment: signedBundle comes from the request; v1PublicKeyB64, registry and policy from configuration.
import { detectDcpVersion, verifySignedBundle, verifySignedBundleV2 } from '@dcp-ai/sdk';

const version = detectDcpVersion(signedBundle);  // '2.0', '1.0', or null for anything else
let result;
if (version === '2.0') {
  result = await verifySignedBundleV2(signedBundle, registry, policy);  // composite verification, tier enforcement
} else if (version === '1.0' && policy.allow_v1_bundles) {
  result = verifySignedBundle(signedBundle, v1PublicKeyB64);           // the Ed25519 signature, hashes and chain
} else {
  result = { verified: false, errors: ['unsupported or disallowed bundle version'] };
}
```

这只是按格式分流。V1 分支不会对 V1 bundle 应用 V2 策略模式或安全等级
（VERIFICATION.md V2-10），两个分支也都不决定信任：前者由验证中间件负责，
后者由[准入](ADMISSION.md)负责。`verifySignedBundleV2` 只接受 v2.0 bundle；参考 CLI
（`dcp verify-bundle`）和中间件会自行按版本分流。

<a id="33-schema-routing"></a>

### 3.3 模式选择

验证器在检查模式之前，先按 bundle 的版本分流：

- V2 已签名 bundle 带有 `bundle.dcp_bundle_version: "2.0"` 和 `bundle.manifest` → `schemas/v2/*.schema.json`；
- V1 bundle 的构件带有 `dcp_version: "1.0"` → `schemas/v1/*.schema.json`。

<a id="34-when-to-drop-v1-support"></a>

### 3.4 何时停止支持 V1

按照规范，V2 验证器必须（MUST）无限期支持 V1 bundle。不过，各个部署可以在过渡期之后设置拒绝 V1 bundle 的策略：

```json
{
  "verifier_policy": {
    "allow_v1_bundles": false
  }
}
```

只有在你的生态系统中所有智能体都已迁移到 v2.0 之后，才应这样做。

---

<a id="4-bundle-format-changes-detailed"></a>

## 4. bundle 格式的变化（详细）

<a id="41-signed-bundle-envelope"></a>

### 4.1 已签名 bundle 的封装

完整的 V1 和 V2 封装见[步骤 7](#step-7-construct-bundle-manifest)。主要的结构差异：

- **构件单独签名：** RPR、护照、意图和策略决定各自是一个 `SignedPayload`
  （`payload`、`payload_hash`、`composite_sig`），在各自的上下文下签名。审计条目保持不签名，
  通过审计 Merkle 根被承诺。
- **清单：** `bundle.manifest` 对每个构件的哈希以及审计 Merkle 根作出承诺；它取代了 V1 的
  `signature.bundle_hash`。
- **会话 nonce：** 每个构件、每条审计条目和清单中都是同一个 `session_nonce`。
- **bundle 签名：** `signature.composite_sig` 签署的是清单（`signature.manifest_hash`），而不是整个
  bundle；`signature.signer.kids` 指明密钥，而不是携带公钥。
- **版本标记：** `bundle.dcp_bundle_version: "2.0"`。

<a id="42-composite-signature-object"></a>

### 4.2 复合签名对象

```json
{
  "composite_sig": {
    "classical": {
      "alg": "ed25519",
      "kid": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
      "sig_b64": "<base64-encoded Ed25519 signature>"
    },
    "pq": {
      "alg": "ml-dsa-65",
      "kid": "f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3",
      "sig_b64": "<base64-encoded ML-DSA-65 signature>"
    },
    "binding": "pq_over_classical"
  }
}
```

<a id="43-audit-entry-changes"></a>

### 4.3 审计条目的变化

| 字段 | v1.0 | v2.0 |
|-------|------|------|
| `dcp_version` | `"1.0"` | `"2.0"` |
| `session_nonce` | 不存在 | 必需 |
| `prev_hash` | 前一条目的十六进制 SHA-256，或 `"GENESIS"` | 前一条目的 `sha256:<hex>`，或 `"GENESIS"` |
| `hash_alg` | 不存在 | 必需：`sha256`，或在双哈希链下为 `sha256+sha3-256` |
| `prev_hash_secondary` | 不存在 | 可选：`sha3-256:<hex>`（双哈希链） |
| `intent_hash` | 十六进制 SHA-256 | `sha256:<hex>` |
| `intent_hash_secondary` | 不存在 | 可选：`sha3-256:<hex>` |
| `evidence.evidence_hash` | 不存在 | 存在，可以为 `null` |
| `pq_checkpoint_ref` | 不存在 | 必需，可以为 `null` |
| 签名 | 不逐条签名；由 bundle 签名覆盖 | 不逐条签名；由清单中的审计 Merkle 根承诺，PQ 检查点对其中的区间签名 |

---

<a id="5-sdk-api-changes"></a>

## 5. SDK API 的变化

### 5.1 TypeScript SDK

| v1.0 API | v2.0 API | 说明 |
|----------|----------|-------|
| `signBundle(bundle, secretKey)` | `signBundleV2(bundle, { registry, signerType, signerId, keys })` | 对清单的复合签名 |
| `verifySignedBundle(sb, publicKey)` | `verifySignedBundleV2(sb, registry, policy?)` | 由策略驱动的验证 |
| `new BundleBuilder()…build()` | `new BundleBuilderV2(sessionNonce)…build()` | 必须提供会话 nonce；构件为 `SignedPayload` |
| `hashObject(obj)` | `hashObject(obj)`（不变） | 仍为 SHA-256 + JCS |
| N/A | `dualHashCanonical(canonicalJson)` | SHA-256 + SHA3-256 |
| N/A | `registerDefaultProviders()` + `getDefaultRegistry()` | 通过算法注册表提供 Ed25519、ML-DSA-65、SLH-DSA-192f |
| N/A | `computeSecurityTier(intent, policyDecision?)` | 自适应等级计算（规范 §14.2） |
| N/A | `deriveKid(alg, publicKeyBytes)` | 确定性 kid |
| N/A | `compositeSign(registry, context, payloadBytes, keys)` | 手动复合签名 |
| N/A | `compositeVerify(registry, context, payloadBytes, sig, classicalPk, pqPk?)` | 手动复合验证 |

### 5.2 Python SDK

| v1.0 API | v2.0 API | 说明 |
|----------|----------|-------|
| `sign_bundle(bundle, secret_key)` | 每个构件执行 `prepare_payload` + `await composite_sign(registry, context, payload_bytes, classical_key, pq_key)`，然后 `BundleBuilderV2(session_nonce)…build()` + `await sign_bundle_v2(bundle, registry, signer_type, signer_id, classical_key, pq_key)`（`dcp_ai.v2`） | 对每个构件和清单的复合签名 |
| `verify_signed_bundle(sb, public_key)` | `await verify_signed_bundle_v2(signed_bundle, registry, policy=None)`（`dcp_ai.v2`） | 由策略驱动 |
| N/A | `Ed25519Provider` / `MlDsa65Provider`（`dcp_ai.providers`），异步的 `generate_keypair()` | 混合密钥 |
| N/A | `compute_security_tier(intent, policy_decision=None)`（`dcp_ai.v2`） | 自适应等级（规范 §14.2） |
| N/A | `derive_kid(alg, public_key_bytes)`（`dcp_ai.v2`） | 确定性 kid |

### 5.3 Go SDK

| v1.0 API | v2.0 API | 说明 |
|----------|----------|-------|
| `SignObject(bundle, secretKeyB64)` | 每个构件执行 `v2.SignPayload(registry, context, payload, classicalKey, pqKey)`，然后 `v2.BuildBundleV2(input)` + `v2.SignBundleV2(registry, bundle, classicalKey, pqKey)` | 对每个构件和清单的复合签名 |
| `VerifySignedBundle(sb, publicKeyB64)` | `v2.VerifySignedBundleV2(registry, signedBundleJSON)` | 由策略驱动 |
| N/A | `providers.Ed25519Provider` / `providers.MlDsa65Provider` 上的 `GenerateKeypair()` | 混合密钥 |
| N/A | `v2.ComputeSecurityTier(input)`、`v2.SecurityTierInputFromPayloads(intent, policyDecision)` | 自适应等级（规范 §14.2） |
| N/A | `v2.DeriveKid(alg, publicKey)` | 确定性 kid |

### 5.4 Rust SDK

| v1.0 API | v2.0 API | 说明 |
|----------|----------|-------|
| `sign_object(bundle, secret_key_b64)` | 每个构件执行 `prepare_payload`（`dcp_ai::v2::signed_payload`）+ `composite_sign(ed, pq, context, payload_bytes, classical_key, pq_key)`（`dcp_ai::v2::composite_ops`），然后 `build_bundle_v2(&rpr, &passport, &intent, &policy, &audit_entries, session_nonce)` + `sign_bundle_v2(bundle, &classical_key, &pq_key)`（`dcp_ai::v2::bundle`） | 对每个构件和清单的复合签名 |
| `verify_signed_bundle(sb, public_key_b64)` | `verify_signed_bundle_v2_with_policy(&signed_bundle, &policy)`（`dcp_ai::v2::verify_bundle`） | 由策略驱动 |

<a id="55-cli-changes"></a>

### 5.5 CLI 的变化

| v1.0 命令 | v2.0 命令 | 说明 |
|-------------|-------------|-------|
| `dcp keygen [out_dir]` | `dcp keygen --hybrid [out_dir]` | 生成两种类型的密钥 |
| `dcp sign-bundle` | `dcp sign-bundle --composite <bundle_v2.json> <ed25519_sk> <ml_dsa_65_sk> [out]` | 通过 `@dcp-ai/sdk` 进行复合签名 |
| `dcp verify-bundle` | `dcp verify-bundle [--policy <mode>] <signed.json> [public_key.txt]` | 完整的 V2 验证；`<mode>` 为 `classical_only`、`hybrid_preferred`、`hybrid_required` 或 `pq_only`；密钥用于固定经典签名者 |
| N/A | `dcp kid <public_key_file> --alg <algorithm>` | 计算 kid |
| N/A | `dcp recovery-setup --threshold <M> --shares <N> [out]` | M-of-N 社交恢复 |
| N/A | `dcp emergency-revoke --agent <id> --token <secret>` | 紧急按钮式吊销 |
| N/A | `dcp rotate-key --old-kid <kid> --new-alg <alg>` | 带持有证明（PoP）的密钥轮换 |
| N/A | `dcp capabilities <endpoint_url>` | 查询端点能力 |
| N/A | `dcp advisory check [url]` | 检查算法公告 |

---

<a id="6-testing-your-migration"></a>

## 6. 测试你的迁移

<a id="61-verification-checklist"></a>

### 6.1 验证检查清单

逐项检查以下清单，确认迁移已完成：

- [ ] **密钥生成**：混合密钥对（Ed25519 + ML-DSA-65）成功生成
- [ ] **kid 导出**：`deriveKid('ed25519', pk)` 与期望值一致
- [ ] **kid 导出**：`deriveKid('ml-dsa-65', pk)` 与期望值一致
- [ ] **RPR 构建**：v2.0 RPR 包含 `dcp_version`、`session_nonce` 和两种类型的密钥
- [ ] **护照构建**：v2.0 护照包含 `dcp_version` 和 `session_nonce`
- [ ] **意图构建**：v2.0 意图包含 `dcp_version` 和 `session_nonce`（以及可选的、只能提高计算所得等级的 `security_tier`）
- [ ] **复合签名**：`signBundleV2` 生成有效的复合签名
- [ ] **域分离**：签名包含上下文标签
- [ ] **复合绑定**：PQ 签名覆盖经典签名的字节
- [ ] **双哈希链**：审计条目包含 `prev_hash_secondary`（SHA3-256）；当前的 V2 验证器不会重新计算它（步骤 6）
- [ ] **清单**：bundle 清单包含所有构件的哈希，使用双哈希链时还包含次级 Merkle 根，当前的 V2 验证器不会重新计算该根
- [ ] **会话 nonce**：bundle 中的所有构件共享同一个 nonce
- [ ] **V2 验证**：正确签名的 v2.0 bundle 能通过 `verifySignedBundleV2`（或 `dcp verify-bundle`）
- [ ] **V1 兼容性**：v1.0 bundle 仍能通过 V1 函数 `verifySignedBundle`（只接受 v1.0）、`dcp verify-bundle` 或 3.2 中那样的按版本分流的路由器验证；V2 函数 `verifySignedBundleV2` 只接受 v2.0
- [ ] **篡改检测**：修改任何构件字段都会导致验证失败
- [ ] **剥离检测**：移除 PQ 签名（并把绑定改标为 `classical_only`）在 `hybrid_required` 和 `pq_only` 下失败，在 `classical_only` 和 `hybrid_preferred` 下被接受；存在但无效的 PQ 签名在任何模式下都会失败
- [ ] **NIST KAT**：所有密码学操作都通过 KAT 验证
- [ ] **跨 SDK**：由一个 SDK 签署的 bundle 能在另一个 SDK 中通过验证

<a id="62-common-migration-issues"></a>

### 6.2 常见的迁移问题

**问题：验证时出现“kid mismatch”**

v2.0 的 kid 导出是确定性的：`hex(SHA-256(UTF8(alg) || 0x00 || raw_pk))[0:32]`。如果你的 v1.0 实现使用了其他 kid 方案，请用 v2.0 的公式重新生成 kid。SDK 的 `deriveKid` 函数会处理这一点。

**问题：构件之间“session_nonce mismatch”**

同一个 bundle 中的所有构件都必须（MUST）共享同一个 `session_nonce`。每创建一个 bundle 只生成一次 nonce，并把它传给所有构件的构造函数。

**问题：“composite_sig.pq verification failed”**

PQ 签名签署的是 `context || 0x00 || payload || classical_sig`。请确保在进行 PQ 签名之前，把经典签名的字节（原始字节，而非 base64）追加到被签名的消息中。

**问题：v1.0 验证器报告“unsupported dcp_version 2.0”**

这是预期行为。v1.0 验证器无法处理 v2.0 bundle。上游验证器需要升级到支持 v2.0 的 SDK。

**问题：已签名载荷中的 float 值**

v2.0 禁止在所有已签名载荷中使用浮点数（规范化存在歧义）。请把 `risk_score: 0.75` 换成整数刻度：`risk_score: 750`（0-1000）。

**问题：bundle 体积较大**

v2.0 bundle 更大，主要是由于 ML-DSA-65 签名（每个 3309 B）。请以验证器实际读取的格式测量你最大的 bundle，并为请求体设定明确的
大小预算（参见 [OPERATOR_GUIDE.md](OPERATOR_GUIDE.md#security-tiers-in-verification)）。参考验证服务器只读取 JSON 请求体，尽管其能力文档列出了
`application/cbor`；只有 TypeScript SDK 有 CBOR 编码器（`cborEncode`），本仓库没有公布它的实测体积缩减数据。
`presentCompact` 会移除 PQ 签名（绑定为 `classical_only`），因此这样的 bundle 只在有效模式为 `classical_only` 或
`hybrid_preferred` 时才能通过。传输大小不是降低安全等级的理由。

<a id="63-validating-migrated-bundles"></a>

### 6.3 验证迁移后的 bundle

CLI 没有从 v1.0 到 v2.0 的迁移检查工具。请改用 V2 验证器验证每个迁移后的 bundle：

```bash
dcp verify-bundle --policy hybrid_required signed_bundle_v2.json
```

它会检查清单哈希、会话绑定、复合签名和审计链。`risk_score` 属于策略决定，是 0 到 1000 的整数；V2 意图模式不允许包含它（规范 §14.2）。

---

<a id="7-recommended-migration-order"></a>

## 7. 推荐的迁移顺序

对于迁移生产系统的团队，推荐的顺序是：

1. **更新 SDK** 到支持 v2.0 的最新版本。
2. **先更新验证器**，并设置 `allow_v1_bundles: true`。这能确保你的验证器在过渡期间同时处理 v1.0 和 v2.0 bundle。
3. 为所有智能体和人类**生成混合密钥对**。
4. **更新构件的构建方式**，加入 `dcp_version: "2.0"`、`session_nonce` 和双密钥条目。
5. 使用 v2.0 签名 API **改用复合签名**。
6. 为审计条目**加入双哈希链**。
7. **实现 bundle 清单**结构。
8. **用混合签名签署敏感意图。** V2 验证器会执行安全等级（规范 §14.3）：对于支付、敏感数据、高影响或策略决定 `risk_score` 为 500 及以上的情况，`classical_only` bundle 会被拒绝。
9. **运行完整的一致性测试**，包括 NIST KAT 验证。
10. 当生态系统中所有智能体都已迁移后，**停止接受 v1.0 bundle**。

---

<a id="8-timeline-and-support"></a>

## 8. 时间表与支持

| 阶段 | 时间 | 工作 |
|-------|----------|---------|
| **准备** | 第 1-2 周 | 更新 SDK、生成混合密钥、阅读本指南 |
| **验证器升级** | 第 2-3 周 | 部署兼容 v1 的 v2.0 验证器 |
| **智能体迁移** | 第 3-6 周 | 更新构件构建方式，改用复合签名 |
| **验证** | 第 6-8 周 | 运行一致性测试和跨 SDK 互操作测试 |
| **切换** | 第 8 周及以后 | 准备就绪后设置 `allow_v1_bundles: false` |

迁移支持：
- GitHub Issues 或 Discussions：[`dcp-ai-protocol/dcp-ai`](https://github.com/dcp-ai-protocol/dcp-ai)
- 通过 GitHub 的安全公告界面私下报告漏洞
- 按照 [GOVERNANCE.md](../GOVERNANCE.md) 给维护者发邮件

目前没有专门的 Slack、Discord 或答疑时间。当前的支持模式参见 [EARLY_ADOPTERS.md](EARLY_ADOPTERS.md)。

---

<a id="references"></a>

## 参考资料

- [DCP-AI v2.0 规范性规范](../spec/DCP-AI-v2.0.md)
- [DCP-04：智能体间通信](../spec/DCP-04.md)
- [安全模型](SECURITY_MODEL.md)
- [NIST 符合性声明](NIST_CONFORMITY.md)
- [NIST KAT 测试向量](../tests/nist-kat/README.md)
- [技术架构](TECHNICAL_ARCHITECTURE.md)
