<sub>[English](../../../../sdks/wasm/README.md) · **中文** · [Español](../../../es/sdks/wasm/README.md) · [日本語](../../../ja/sdks/wasm/README.md) · [Português](../../../pt-BR/sdks/wasm/README.md)</sub>

# @dcp-ai/wasm — WebAssembly SDK v2.0

> 本文是[英文 README](../../../../sdks/wasm/README.md)的参考译文，更新于 2026年10月25日。为保留已测试的示例，标识符和代码块（包括注释）保持原样。

这是用于 Digital Citizenship Protocol（DCP）v2.0 的 WebAssembly 模块，由 Rust SDK 编译而成。它提供后量子复合签名、混合密钥生成、ML-KEM-768 密钥封装、双哈希、bundle 构建与验证以及安全等级计算。所有功能都可直接在浏览器或 Node.js 中运行，无需服务器。

<a id="installation"></a>

## 安装

**已发布到 npm（2026 年 10 月 26 日）。** `@dcp-ai/wasm` 2.1.0 于该日以 `latest` 标签发布，包含本文描述的 API 及实验性的 `dcp-jcs-v2` API。发布这些 API 并未启用候选方案：它当时仍需显式启用且不具规范性，`dcp-jcs-v1` 保持不变。Rust crate 有独立的发布周期。

**`@dcp-ai/wasm` 2.1.1。** 此版本还会在 [VERIFICATION.md 的 V2-11](../../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) 中的二级 SHA3-256 字段存在时验证它们：`audit_merkle_root_secondary`、每个 `prev_hash_secondary` 和每个 `intent_hash_secondary`。不存在的字段不作要求，因此已验证的 bundle 可能没有完整的二级链；存在的字段如果是 `null`、不是字符串或不一致，则被拒绝。API、结果字段、`dcp-jcs-v1` 和 `hash_alg` 的处理均不变。2.1.0 不检查这些字段。下面的安装命令指定的是此版本；它在注册表中的可用情况见[已发布版本](../../../../docs/README.md#published-versions)。

```bash
npm install @dcp-ai/wasm@^2.1.1
```

所有软件包版本见 [npm 发布清单](../../../../docs/NPM_RELEASES.md)。

如需使用检出源码进行开发，请构建并安装本地软件包：

```bash
# Build in sdks/wasm first (see Build)
npm install /path/to/dcp-ai/sdks/wasm
```

<a id="build"></a>

## 构建

```bash
# Build WASM + TypeScript wrapper
npm run build

# WASM only (browser target)
npm run build:wasm

# WASM only (Node.js target)
npm run build:wasm:node
```

**要求：** [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/) 和包含 `wasm32-unknown-unknown` 目标的 Rust 工具链。

<a id="initialization-browser-and-nodejs"></a>

## 初始化：浏览器与 Node.js

`initDcp(wasmUrl?)` 只加载一次 `dcp_ai_bg.wasm`。

- **浏览器**（或能够提供 `pkg/` 文件的打包工具）：`await initDcp()` 会获取与 `pkg/dcp_ai.js` 位于同一目录的文件，也可以传入 URL：`await initDcp('/assets/dcp_ai_bg.wasm')`。
- **Node.js：** Node 的 `fetch` 无法读取 `file:` URL，因此不带参数的 `initDcp()` 会在该环境中失败。请读取文件，并将其作为 `data:` URL 传入：

```typescript
import { readFileSync } from 'node:fs';
import { initDcp } from '@dcp-ai/wasm';

// The .wasm file sits next to the `@dcp-ai/wasm/pkg` entry point.
const wasmFile = new URL('dcp_ai_bg.wasm', import.meta.resolve('@dcp-ai/wasm/pkg'));
const dcp = await initDcp(`data:application/wasm;base64,${readFileSync(wasmFile).toString('base64')}`);
```

wasm-bindgen 可能会提示这种参数形式已弃用，但仍会完成模块初始化。

<a id="quickstart--typescript-wrapper"></a>

<a id="quickstart-typescript-wrapper"></a>

## 快速入门 — TypeScript 封装层

推荐通过 TypeScript 封装层使用 SDK。在这个 V2 bundle 中，责任主体（principal）签署 RPR 和清单，代理签署护照、意图和策略决策，各自使用 Ed25519 + ML-DSA-65 混合密钥。此示例在 Node.js 中运行；在浏览器中，请将初始化方式替换为 `await initDcp()`。

```typescript
import { readFileSync } from 'node:fs';
import { initDcp } from '@dcp-ai/wasm';

const wasmFile = new URL('dcp_ai_bg.wasm', import.meta.resolve('@dcp-ai/wasm/pkg'));
const dcp = await initDcp(`data:application/wasm;base64,${readFileSync(wasmFile).toString('base64')}`);

const principal = dcp.generateHybridKeypair();
const agent = dcp.generateHybridKeypair();
type Hybrid = ReturnType<typeof dcp.generateHybridKeypair>;
const keyEntries = (keys: Hybrid) => [keys.classical, keys.pq].map((k) => ({
  kid: k.kid ?? dcp.deriveKid(k.alg, k.public_key_b64), alg: k.alg, public_key_b64: k.public_key_b64,
  created_at: '2026-01-01T00:00:00Z', expires_at: null, status: 'active',
}));
const sign = (context: string, payload: object, keys: Hybrid) =>
  dcp.signPayload(
    context, payload,
    keys.classical.secret_key_b64, keys.classical.kid ?? dcp.deriveKid('ed25519', keys.classical.public_key_b64),
    keys.pq.secret_key_b64, keys.pq.kid ?? dcp.deriveKid('ml-dsa-65', keys.pq.public_key_b64),
  );

const nonce = dcp.generateSessionNonce();
const now = new Date().toISOString();
const intent = {
  dcp_version: '2.0', intent_id: 'intent:example-001', session_nonce: nonce, agent_id: 'agent:example-001',
  human_id: 'human:example-001', timestamp: now, action_type: 'browse', target: { channel: 'web' },
  data_classes: ['none'], estimated_impact: 'low', requires_consent: false,
};

const bundle = dcp.buildBundle({
  rpr: sign('DCP-AI.v2.ResponsiblePrincipal', {
    dcp_version: '2.0', human_id: 'human:example-001', session_nonce: nonce, legal_name: 'Example Principal',
    entity_type: 'natural_person', jurisdiction: 'ES', liability_mode: 'owner_responsible', override_rights: true,
    issued_at: now, expires_at: null, contact: null, binding_keys: keyEntries(principal),
  }, principal),
  passport: sign('DCP-AI.v2.AgentPassport', {
    dcp_version: '2.0', agent_id: 'agent:example-001', session_nonce: nonce, keys: keyEntries(agent),
    principal_binding_reference: 'human:example-001', capabilities: ['browse'], risk_tier: 'low',
    created_at: now, status: 'active',
  }, agent),
  intent: sign('DCP-AI.v2.Intent', intent, agent),
  policy: sign('DCP-AI.v2.PolicyDecision', {
    dcp_version: '2.0', intent_id: intent.intent_id, session_nonce: nonce, decision: 'approve', risk_score: 50,
    reasons: ['low-impact browse'], required_confirmation: null,
    applied_policy_hash: dcp.preparePayload({ policy: 'default' }).payload_hash, timestamp: now,
  }, agent),
  auditEntries: [{
    dcp_version: '2.0', audit_id: 'audit:example-001', session_nonce: nonce, prev_hash: 'GENESIS', hash_alg: 'sha256',
    timestamp: now, agent_id: 'agent:example-001', human_id: 'human:example-001', intent_id: intent.intent_id,
    intent_hash: dcp.preparePayload(intent).payload_hash, policy_decision: 'approved', outcome: 'page_read',
    evidence: { tool: 'browser', result_ref: null, evidence_hash: null }, pq_checkpoint_ref: null,
  }],
  sessionNonce: nonce,
});

// The principal signs the manifest with a composite signature.
const signed = dcp.signBundle(
  bundle,
  principal.classical.secret_key_b64, principal.classical.kid ?? dcp.deriveKid('ed25519', principal.classical.public_key_b64),
  principal.pq.secret_key_b64, principal.pq.kid ?? dcp.deriveKid('ml-dsa-65', principal.pq.public_key_b64),
);

const result = dcp.verifyBundle(signed);
console.log(result.verified, result.classical_valid, result.pq_valid); // true true true
```

<a id="api-reference"></a>

## API 参考

<a id="initialization"></a>

### 初始化

#### `initDcp(wasmUrl?: string): Promise<DcpWasm>`

初始化 WASM 模块。使用任何 API 前必须调用一次。可选传入 `.wasm` 文件的 URL；在 Node.js 中应传入 `data:` URL（参见[初始化](#initialization-browser-and-nodejs)）。

<a id="keypair-generation"></a>

### 密钥对生成

| 方法 | 返回值 | 描述 |
|--------|---------|-------------|
| `generateEd25519Keypair()` | `KeypairResult` | Ed25519 传统密钥对 |
| `generateMlDsa65Keypair()` | `KeypairResult` | ML-DSA-65 后量子签名密钥对 |
| `generateSlhDsa192fKeypair()` | `KeypairResult` | SLH-DSA-192f 无状态哈希签名密钥对 |
| `generateHybridKeypair()` | `HybridKeypairResult` | 一次调用生成 Ed25519 + ML-DSA-65 混合密钥对 |

<a id="ml-kem-768-key-encapsulation"></a>

### ML-KEM-768 密钥封装

| 方法 | 返回值 | 描述 |
|--------|---------|-------------|
| `mlKem768Keygen()` | `KemKeypairResult` | 生成 ML-KEM-768 封装与解封装密钥对 |
| `mlKem768Encapsulate(pk)` | `KemEncapsulateResult` | 使用公钥封装共享秘密 |
| `mlKem768Decapsulate(ct, sk)` | `string` | 从密文中解封装共享秘密，返回十六进制字符串 |

<a id="composite-signing"></a>

### 复合签名

| 方法 | 描述 |
|--------|-------------|
| `compositeSign(context, payload, classicalSk, classicalKid, pqSk, pqKid)` | 采用 `pq_over_classical` 绑定的完整 Ed25519 + ML-DSA-65 混合签名 |
| `classicalOnlySign(context, payload, sk, kid)` | 仅使用传统 Ed25519 签名的过渡模式 |
| `signPayload(context, payload, classicalSk, classicalKid, pqSk, pqKid)` | 对载荷签名并包装为 `SignedPayload` 信封 |

<a id="verification"></a>

### 验证

验证成功不会赋予对责任主体的信任、准入资格或操作授权。V2 验证器检查主审计链和主 Merkle 根，自 2.1.1 起也会检查存在的可选次级链接、意图哈希和 `audit_merkle_root_secondary`，而 2.1.0 不检查（[双哈希链](../../../../docs/STORAGE_AND_ANCHORING.md#dual-hash-chains)）。实验性候选方案复用这些检查。

| 方法 | 返回值 | 描述 |
|--------|---------|-------------|
| `compositeVerify(context, payload, sig, classicalPk, pqPk?)` | `CompositeVerifyResult` | 对复合签名进行密码学验证 |
| `verifyBundle(signedBundle, policy?)` | `V2VerificationResult` | 使用策略模式与安全等级模式中较严格的一个，验证 V2 bundle 的结构、密码学内容和主哈希链（spec §14.3）；返回 `resolved_tier` 和 `verification_mode`。`policy` 只有以下字段可不同于默认值：`default_mode`、`risk_overrides`、阶段3字段（`advisory_rejected_algs`、`warn_classical_only_deprecated`、`allow_classical_fallback_disable`）、`max_session_duration_seconds`（从已签名的 `session_issued_at` 起算；清单含有 `session_expires_at` 时，`signBundle` 会写入该字段）、`require_session_expiry`（拒绝缺少 `session_expires_at` 的清单），以及与 `verifier_id` 配合使用的 `require_audience_binding`（拒绝缺少 `intended_verifier` 或其值与 `verifier_id` 不同的清单）。提供策略时，V1 bundle 会被拒绝 |

<a id="hash-operations"></a>

### 哈希操作

| 方法 | 返回值 | 描述 |
|--------|---------|-------------|
| `dualHash(data)` | `DualHash` | SHA-256 + SHA3-256 双哈希 |
| `sha3_256(data)` | `string` | SHA3-256 哈希，返回十六进制字符串 |
| `hashObject(obj)` | `string` | JSON 对象的 SHA-256 哈希 |
| `dualMerkleRoot(leaves)` | `DualHash` | 根据 `DualHash` 叶节点数组计算双 Merkle 根 |

<a id="canonicalization-domain-separation"></a>

### 规范化与域分离

| 方法 | 返回值 | 描述 |
|--------|---------|-------------|
| `canonicalize(value)` | `string` | 基于 RFC 8785 JCS 的 `dcp-jcs-v1` 规范化 |
| `domainSeparatedMessage(context, payloadHex)` | `string` | 域分离后的消息，返回十六进制字符串 |
| `deriveKid(alg, publicKeyB64)` | `string` | 根据算法和公钥确定性地派生密钥 ID |

<a id="session-security"></a>

### 会话与安全

| 方法 | 返回值 | 描述 |
|--------|---------|-------------|
| `generateSessionNonce()` | `string` | 256位随机 nonce，表示为64个十六进制字符 |
| `verifySessionBinding(artifacts)` | `SessionBindingResult` | 检查各工件之间 nonce 的一致性 |
| `computeSecurityTier(intent, policyDecision?)` | `SecurityTierResult` | 计算自适应安全等级 routine/standard/elevated/maximum；`risk_score` 来自策略决策 |

<a id="payload-preparation"></a>

### 载荷准备

| 方法 | 返回值 | 描述 |
|--------|---------|-------------|
| `preparePayload(payload)` | `PreparedPayload` | 对载荷进行规范化并计算哈希 |

<a id="bundle-building-signing"></a>

### Bundle 构建与签名

| 方法 | 返回值 | 描述 |
|--------|---------|-------------|
| `buildBundle(opts)` | `CitizenshipBundleV2` | 从使用 `signPayload` 签名的工件构建带清单的 V2 bundle；`sessionNonce` 默认取 RPR 的 `session_nonce` |
| `signBundle(bundle, classicalSk, classicalKid, pqSk, pqKid)` | `SignedBundleV2` | 使用复合签名签署 bundle；`signer.id` 为 RPR 的 `human_id`。若清单有 `session_expires_at` 而没有 `session_issued_at`，则将 `session_issued_at` 设为签名时刻 |

<a id="proof-of-possession"></a>

### 持有证明

| 方法 | 返回值 | 描述 |
|--------|---------|-------------|
| `generateRegistrationPop(challenge, sk, alg)` | `SignatureEntry` | 为密钥注册生成持有证明（PoP） |
| `verifyRegistrationPop(challenge, pop, pk, alg)` | `PopResult` | 验证 PoP |

<a id="utility"></a>

### 实用工具

| 方法 | 返回值 | 描述 |
|--------|---------|-------------|
| `detectVersion(value)` | `string \| null` | 从 JSON 对象检测 DCP 协议版本 |

<a id="dcp-0509-types"></a>

### DCP-05–09 类型

WASM SDK 为 DCP-05 到 DCP-09 的所有工件提供 TypeScript 接口，与 Rust SDK 的类型对应：

| 规范 | 接口 |
|------|-----------|
| DCP-05 生命周期 | `LifecycleState`, `CommissioningCertificate`, `VitalityReport`, `VitalityMetrics`, `DecommissioningRecord`, `TerminationMode`, `DataDisposition` |
| DCP-06 继承 | `DigitalTestament`, `SuccessionRecord`, `MemoryTransferManifest`, `MemoryTransferEntry`, `SuccessorPreference`, `MemoryClassification`, `TransitionType`, `MemoryDisposition` |
| DCP-07 争议 | `DisputeRecord`, `ArbitrationResolution`, `JurisprudenceBundle`, `ObjectionRecord`, `DisputeType`, `EscalationLevel`, `DisputeStatus`, `ObjectionType`, `AuthorityLevel` |
| DCP-08 权利 | `RightsDeclaration`, `RightEntry`, `ObligationRecord`, `RightsViolationReport`, `RightType`, `ComplianceStatus` |
| DCP-09 委托 | `DelegationMandate`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `AwarenessThreshold`, `ThresholdRule`, `AuthorityScopeEntry`, `ThresholdOperator`, `ThresholdAction` |

可通过 `domainSeparatedMessage()` 使用的域分离上下文：`Lifecycle`、`Succession`、`Dispute`、`Rights`、`Delegation`、`Awareness`。

<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in"></a>
<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in-unreleased"></a>

## 实验性功能：规范化候选方案 `dcp-jcs-v2`（需显式启用）

该方案不具有规范效力，也未默认启用：`dcp-jcs-v1` 仍是唯一的规范化配置文件，默认值、构建器、签名器和验证器均不改变。这些方法供显式选择使用它们的调用方使用，npm WASM 2.1.0 也是如此。WASM 绑定只接收字节；宿主环境的值先在 JavaScript 中接受检查。候选 bundle 通过验证不会赋予信任或准入资格。设计与契约：[`docs/proposals/canonicalization-candidate`](../../../../docs/proposals/canonicalization-candidate/README.md)（§15 输入处理、§16 路由器、§17 验证器、§18 生成端）。

| 方法 | 描述 |
|--------|-------------|
| `experimentalCandidateIngress(bytes)` | `{ status: 'accept', canonical, ... }` 或 `{ status: 'reject', class, offset }` |
| `experimentalCandidateExtractUnit(bytes, transport)` | 提取 `bare` 或 `envelope` 传输格式的单元 |
| `createExperimentalCandidateRouter(config)` | 对字节进行路由；`historical` 是 `experimentalWasmHistoricalAdapters` 之一（`w1…` 用于经过 `JSON.stringify` 的对象，`w2…` 用于文本），没有默认选项 |
| `createExperimentalCandidateVerifier(config).verify(bytes, policy?)` | 从原始字节进行验证，最多调用一个验证器；从 `Date.now` 读取时间 |
| `experimentalCandidateSignPayload(context, input, keys)` | 根据 `{ bytes }` 或 `{ value }` 签署一个工件 |
| `experimentalCandidateSignBundle(parts, signer, options)` | 组装并签署清单中标明 `dcp-jcs-v2` 的 bundle |
| `ExperimentalWasmCandidateProduceError` | 在任何绑定执行签名前，拒绝值域或形式不符合要求的输入 |

```typescript
import { readFileSync } from 'node:fs';
import { initDcp } from '@dcp-ai/wasm';

const wasmFile = new URL('dcp_ai_bg.wasm', import.meta.resolve('@dcp-ai/wasm/pkg'));
const dcp = await initDcp(`data:application/wasm;base64,${readFileSync(wasmFile).toString('base64')}`);

// The ingress decides on the original bytes: 1.0 is the integer 1, members are sorted.
const accepted = dcp.experimentalCandidateIngress(new TextEncoder().encode('{"b":1.0,"a":[]}'));
if (accepted.status === 'accept') console.log(new TextDecoder().decode(accepted.canonical)); // {"a":[],"b":1}

// A producer signs an artifact from those bytes (hybrid keys, today's composite signature).
const h = dcp.generateHybridKeypair();
const key = (k: typeof h.classical) => ({
  kid: k.kid ?? dcp.deriveKid(k.alg, k.public_key_b64), alg: k.alg, secretKeyB64: k.secret_key_b64, publicKeyB64: k.public_key_b64,
});
const artifact = dcp.experimentalCandidateSignPayload(
  'DCP-AI.v2.Intent', { bytes: new TextEncoder().encode('{"intent_id":"intent:1","risk":1.0}') },
  { classical: key(h.classical), pq: key(h.pq) },
);
console.log(artifact.signedPayload.payload_hash); // sha256:… of {"intent_id":"intent:1","risk":1}
```

<a id="low-level-api"></a>

## 底层 API

也可以直接使用原始 WASM 函数，而不经过 TypeScript 封装层：

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

完整的浏览器交互演示请参见 [example.html](../../../../sdks/wasm/example.html)。

<a id="security-tiers"></a>

## 安全等级

`computeSecurityTier(intent, policyDecision?)` 计算自适应安全等级（spec §14.2）。`risk_score` 来自策略决策，未提供策略决策时为 0。如果 `action_type`、`estimated_impact` 或 `data_classes` 的值未知或缺失，或者 `risk_score` 缺失或不是 0 到 1000 之间的整数，则按 `elevated` 处理。`intent.security_tier` 只能提高结果。最终采用所有匹配条件中最高的等级。

| 等级 | 条件（满足任意一项） | 验证模式 | 检查点间隔 |
|------|---------------|-------------------|---------------------|
| `routine` | 不满足以下任何条件 | `classical_only` | 50 |
| `standard` | `risk_score` 200–499，`estimated_impact: medium` | `hybrid_preferred` | 10 |
| `elevated` | `risk_score` 500–799，`pii` / `financial_data` / `health_data`，`initiate_payment`，`estimated_impact: high`，未知值 | `hybrid_required` | 1 |
| `maximum` | `risk_score` ≥ 800，`credentials` / `children_data` | `hybrid_required` | 1 |

<a id="algorithms-supported"></a>

## 支持的算法

| 类别 | 算法 | 标准 |
|----------|-----------|----------|
| 传统签名 | Ed25519 | RFC 8032 |
| 后量子签名 | ML-DSA-65 | FIPS 204 |
| 无状态后量子签名 | SLH-DSA-192f | FIPS 205 |
| 后量子密钥封装 | ML-KEM-768 | FIPS 203 |
| 哈希 | SHA-256 + SHA3-256 | FIPS 180-4, FIPS 202 |
| 规范化 | `dcp-jcs-v1` | 基于 RFC 8785（JCS） |

<a id="development"></a>

## 开发

<a id="prerequisites"></a>

### 前置条件

```bash
# Install wasm-pack
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

# Install WASM target
rustup target add wasm32-unknown-unknown
```

<a id="run-rust-wasm-tests"></a>

### 运行 Rust WASM 测试

```bash
cd ../rust
wasm-pack test --headless --chrome -- --features wasm
```

<a id="license"></a>

## 许可证

Apache-2.0
