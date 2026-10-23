<sub>[English](README.md) · **中文** · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

# @dcp-ai/wasm — WebAssembly SDK v2.0

数字公民身份协议 (DCP) v2.0 的全功能 WebAssembly 模块，由 Rust SDK 编译而来。提供后量子复合签名、混合 (经典 + 后量子) 密钥生成、ML-KEM-768 密钥封装、双哈希、凭证包构建/验证以及安全等级计算 —— 全部可直接在浏览器或 Node.js 中运行，无需服务器。

## 安装

```bash
npm install @dcp-ai/wasm
```

## 构建

```bash
# Build WASM + TypeScript wrapper
npm run build

# WASM only (browser target)
npm run build:wasm

# WASM only (Node.js target)
npm run build:wasm:node
```

**需要：** [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/) 以及带 `wasm32-unknown-unknown` 目标的 Rust 工具链。

## 快速开始 — TypeScript 封装器

推荐通过人性化的 TypeScript 封装器使用 SDK：

```typescript
import { initDcp } from '@dcp-ai/wasm';

const dcp = await initDcp();

// Generate hybrid Ed25519 + ML-DSA-65 keypair (here it signs for both the principal and the agent)
const keys = dcp.generateHybridKeypair();
const keyEntries = [keys.classical, keys.pq].map((k) => ({
  kid: k.kid, alg: k.alg, public_key_b64: k.public_key_b64,
  created_at: new Date().toISOString(), expires_at: null, status: 'active',
}));
const sessionNonce = dcp.generateSessionNonce();

// Sign each artifact under its own context
const sign = (context: string, payload: object) =>
  dcp.signPayload(
    context, { ...payload, session_nonce: sessionNonce },
    keys.classical.secret_key_b64, keys.classical.kid!,
    keys.pq.secret_key_b64, keys.pq.kid!,
  );

// Build a V2 bundle from the signed artifacts
const bundle = dcp.buildBundle({
  rpr: sign('DCP-AI.v2.ResponsiblePrincipal', { dcp_version: '2.0', human_id: 'alice', binding_keys: keyEntries /* ... */ }),
  passport: sign('DCP-AI.v2.AgentPassport', { dcp_version: '2.0', agent_id: 'agent-001', keys: keyEntries /* ... */ }),
  intent: sign('DCP-AI.v2.Intent', { dcp_version: '2.0', intent_id: 'intent-001', action_type: 'browse', data_classes: ['none'], estimated_impact: 'low' /* ... */ }),
  policy: sign('DCP-AI.v2.PolicyDecision', { dcp_version: '2.0', intent_id: 'intent-001', decision: 'approve', risk_score: 100 /* ... */ }),
  auditEntries: [],
  sessionNonce,
});

// Sign the bundle with composite signature
const signed = dcp.signBundle(
  bundle,
  keys.classical.secret_key_b64, keys.classical.kid!,
  keys.pq.secret_key_b64, keys.pq.kid!,
);

// Verify the signed bundle
const result = dcp.verifyBundle(signed);
console.log(result.verified);       // true
console.log(result.classical_valid); // true
console.log(result.pq_valid);       // true
```

## API 参考

### 初始化

#### `initDcp(wasmUrl?: string): Promise<DcpWasm>`

初始化 WASM 模块。在使用任何 API 之前必须调用一次。可选择为 `.wasm` 文件传入自定义 URL。

### 密钥对生成

| 方法 | 返回值 | 描述 |
|--------|---------|-------------|
| `generateEd25519Keypair()` | `KeypairResult` | Ed25519 经典密钥对 |
| `generateMlDsa65Keypair()` | `KeypairResult` | ML-DSA-65 后量子签名密钥对 |
| `generateSlhDsa192fKeypair()` | `KeypairResult` | SLH-DSA-192f 无状态基于哈希的签名密钥对 |
| `generateHybridKeypair()` | `HybridKeypairResult` | 一次调用生成 Ed25519 + ML-DSA-65 混合密钥对 |

### ML-KEM-768 密钥封装

| 方法 | 返回值 | 描述 |
|--------|---------|-------------|
| `mlKem768Keygen()` | `KemKeypairResult` | 生成 ML-KEM-768 封装/解封装密钥对 |
| `mlKem768Encapsulate(pk)` | `KemEncapsulateResult` | 使用公钥封装共享密钥 |
| `mlKem768Decapsulate(ct, sk)` | `string` | 从密文解封装共享密钥（返回十六进制） |

### 复合签名

| 方法 | 描述 |
|--------|-------------|
| `compositeSign(context, payload, classicalSk, classicalKid, pqSk, pqKid)` | 带 `pq_over_classical` 绑定的完整混合签名 (Ed25519 + ML-DSA-65) |
| `classicalOnlySign(context, payload, sk, kid)` | 仅经典 Ed25519 签名（过渡模式） |
| `signPayload(context, payload, classicalSk, classicalKid, pqSk, pqKid)` | 签名并包装为 `SignedPayload` 信封 |

### 验证

| 方法 | 返回值 | 描述 |
|--------|---------|-------------|
| `compositeVerify(context, payload, sig, classicalPk, pqPk?)` | `CompositeVerifyResult` | 复合签名的密码学验证 |
| `verifyBundle(signedBundle, policy?)` | `V2VerificationResult` | 完整的 V2 凭证包验证（结构 + 加密 + 哈希链），按策略模式与安全等级模式中更严格的一个验证（spec §14.3）；返回 `resolved_tier` 和 `verification_mode`。`policy` 只能在 `default_mode`、`risk_overrides` 和 Phase 3 字段（`advisory_rejected_algs`、`warn_classical_only_deprecated`、`allow_classical_fallback_disable`）上与默认值不同，传入策略时 V1 凭证包会被拒绝 |

### 哈希操作

| 方法 | 返回值 | 描述 |
|--------|---------|-------------|
| `dualHash(data)` | `DualHash` | SHA-256 + SHA3-256 双哈希 |
| `sha3_256(data)` | `string` | SHA3-256 哈希（十六进制） |
| `hashObject(obj)` | `string` | JSON 对象的 SHA-256 哈希 |
| `dualMerkleRoot(leaves)` | `DualHash` | 从 `DualHash` 叶子数组计算的双 Merkle 根 |

### 规范化与域分离

| 方法 | 返回值 | 描述 |
|--------|---------|-------------|
| `canonicalize(value)` | `string` | `dcp-jcs-v1` 规范化（基于 RFC 8785 JCS） |
| `domainSeparatedMessage(context, payloadHex)` | `string` | 域分离消息（十六进制） |
| `deriveKid(alg, publicKeyB64)` | `string` | 从算法 + 公钥派生的确定性密钥 ID |

### 会话与安全

| 方法 | 返回值 | 描述 |
|--------|---------|-------------|
| `generateSessionNonce()` | `string` | 256 位随机随机数（64 个十六进制字符） |
| `verifySessionBinding(artifacts)` | `SessionBindingResult` | 验证工件间的随机数一致性 |
| `computeSecurityTier(intent, policyDecision?)` | `SecurityTierResult` | 计算自适应安全等级 (routine/standard/elevated/maximum)；`risk_score` 取自策略决策 |

### 负载准备

| 方法 | 返回值 | 描述 |
|--------|---------|-------------|
| `preparePayload(payload)` | `PreparedPayload` | 规范化 + 对负载进行哈希 |

### 凭证包构建与签名

| 方法 | 返回值 | 描述 |
|--------|---------|-------------|
| `buildBundle(opts)` | `CitizenshipBundleV2` | 由 `signPayload` 签名的工件构建带清单的 V2 凭证包；`sessionNonce` 默认为 RPR 的 `session_nonce` |
| `signBundle(bundle, classicalSk, classicalKid, pqSk, pqKid)` | `SignedBundleV2` | 使用复合签名签名凭证包；`signer.id` 为 RPR 的 `human_id` |

### 持有证明

| 方法 | 返回值 | 描述 |
|--------|---------|-------------|
| `generateRegistrationPop(challenge, sk, alg)` | `SignatureEntry` | 为密钥注册生成 PoP |
| `verifyRegistrationPop(challenge, pop, pk, alg)` | `PopResult` | 验证 PoP |

### 工具

| 方法 | 返回值 | 描述 |
|--------|---------|-------------|
| `detectVersion(value)` | `string \| null` | 从 JSON 对象检测 DCP 协议版本 |

### DCP-05–09 类型

WASM SDK 包含针对 DCP-05 至 DCP-09 全部工件的 TypeScript 接口，与 Rust SDK 类型一致：

| 规范 | 接口 |
|------|-----------|
| DCP-05 生命周期 | `LifecycleState`、`CommissioningCertificate`、`VitalityReport`、`VitalityMetrics`、`DecommissioningRecord`、`TerminationMode`、`DataDisposition` |
| DCP-06 继任 | `DigitalTestament`、`SuccessionRecord`、`MemoryTransferManifest`、`MemoryTransferEntry`、`SuccessorPreference`、`MemoryClassification`、`TransitionType`、`MemoryDisposition` |
| DCP-07 争议 | `DisputeRecord`、`ArbitrationResolution`、`JurisprudenceBundle`、`ObjectionRecord`、`DisputeType`、`EscalationLevel`、`DisputeStatus`、`ObjectionType`、`AuthorityLevel` |
| DCP-08 权利 | `RightsDeclaration`、`RightEntry`、`ObligationRecord`、`RightsViolationReport`、`RightType`、`ComplianceStatus` |
| DCP-09 委派 | `DelegationMandate`、`AdvisoryDeclaration`、`PrincipalMirror`、`InteractionRecord`、`AwarenessThreshold`、`ThresholdRule`、`AuthorityScopeEntry`、`ThresholdOperator`、`ThresholdAction` |

通过 `domainSeparatedMessage()` 可用的域分离上下文：`Lifecycle`、`Succession`、`Dispute`、`Rights`、`Delegation`、`Awareness`

## 底层 API

你也可以直接使用原始 WASM 函数（不经 TypeScript 封装器）：

```javascript
import init, {
  wasm_generate_hybrid_keypair,
  wasm_composite_sign,
  wasm_composite_verify,
  wasm_build_bundle,
  wasm_sign_bundle,
  wasm_verify_signed_bundle_v2,
  wasm_ml_kem_768_keygen,
  wasm_ml_kem_768_encapsulate,
  wasm_ml_kem_768_decapsulate,
  wasm_dual_hash,
  wasm_compute_security_tier,
} from '@dcp-ai/wasm/pkg';

await init();

const keys = JSON.parse(wasm_generate_hybrid_keypair());
// ... use raw functions, all return JSON strings
```

完整的交互式浏览器演示参见 [example.html](./example.html)。

## 安全等级

`computeSecurityTier(intent, policyDecision?)` 计算自适应安全等级（spec §14.2）。`risk_score` 取自策略决策（没有则为 0）；未知或缺失的 `action_type`、`estimated_impact` 或 `data_classes` 值，以及缺失或不是 0 到 1000 之间整数的 `risk_score`，按 `elevated` 处理，`intent.security_tier` 只能提高结果。取匹配的最高等级。

| 等级 | 条件（任一） | 验证模式 | 检查点间隔 |
|------|---------------|-------------------|---------------------|
| `routine` | 不满足以下任何条件 | `classical_only` | 50 |
| `standard` | `risk_score` 200–499, `estimated_impact: medium` | `hybrid_preferred` | 10 |
| `elevated` | `risk_score` 500–799, `pii` / `financial_data` / `health_data`, `initiate_payment`, `estimated_impact: high`, 未知值 | `hybrid_required` | 1 |
| `maximum` | `risk_score` ≥ 800, `credentials` / `children_data` | `hybrid_required` | 1 |

## 支持的算法

| 类别 | 算法 | 标准 |
|----------|-----------|----------|
| 经典签名 | Ed25519 | RFC 8032 |
| 后量子签名 | ML-DSA-65 | FIPS 204 |
| 后量子签名（无状态） | SLH-DSA-192f | FIPS 205 |
| 后量子密钥封装 | ML-KEM-768 | FIPS 203 |
| 哈希 | SHA-256 + SHA3-256 | FIPS 180-4、FIPS 202 |
| 规范化 | `dcp-jcs-v1` | 基于 RFC 8785（JCS） |

## 开发

### 先决条件

```bash
# Install wasm-pack
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

# Install WASM target
rustup target add wasm32-unknown-unknown
```

### 运行 Rust WASM 测试

```bash
cd ../rust
wasm-pack test --headless --chrome -- --features wasm
```

## 许可证

Apache-2.0
