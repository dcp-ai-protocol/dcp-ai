<sub>[English](API_REFERENCE.md) · **中文** · [Español](API_REFERENCE.es.md) · [日本語](API_REFERENCE.ja.md) · [Português](API_REFERENCE.pt-BR.md)</sub>

<a id="dcp-ai-api-reference"></a>

# DCP-AI API 参考

> 本文是[英文版](API_REFERENCE.md)的参考译文，更新于 25/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

本文是 `main` 上的 TypeScript SDK `@dcp-ai/sdk`（软件包版本 2.2.0，协议 DCP v2.0）的参考文档。

> **npm 版本（2026 年 10 月 26 日）。** 本 TypeScript 参考文档适用于已发布的 `@dcp-ai/sdk` 2.2.0，包括委托人信任、`strict-v1` 和需显式启用的候选实验性 API。见[已发布的 npm 软件包](NPM_RELEASES.md)与 SDK [安装说明](../sdks/typescript/README.md#installation)。`dcp-jcs-v1` 仍是规范性默认配置。

本页的代码块是声明或片段，而不是完整的程序：`registry`、`keys`、
`payloadBytes` 或 `signedBundle` 等名称代表按照 TypeScript SDK 的
[Quick Start (V2)](../sdks/typescript/README.md#quick-start-v2) 构建的值。完整、可运行的示例在各 SDK 的 README 中。

---

<a id="table-of-contents"></a>

## 目录

- [核心类型（V1）](#core-types-v1)
- [核心类型（V2）](#core-types-v2)
- [密码学函数（V1）](#crypto-functions-v1)
- [V2 复合签名操作](#v2-composite-signature-operations)
- [V2 bundle 构建器与签名器](#v2-bundle-builder--signer)
- [V2 验证](#v2-verification)
- [安全等级引擎](#security-tier-engine)
- [A2A 协议（DCP-04）](#a2a-protocol-dcp-04)
- [遥测与可观测性](#telemetry--observability)
- [哈希与 Merkle 树](#hashing--merkle-trees)
- [模式验证](#schema-validation)
- [DCP-05：智能体生命周期](#dcp-05-agent-lifecycle)
- [DCP-06：继承](#dcp-06-succession)
- [DCP-07：争议解决](#dcp-07-dispute-resolution)
- [DCP-08：权利与义务](#dcp-08-rights--obligations)
- [DCP-09：委托与代理](#dcp-09-delegation--representation)
- [域分离](#domain-separation)
- [会话 nonce](#session-nonces)
- [密钥恢复](#key-recovery)
- [紧急吊销](#emergency-revocation)
- [bundle 呈现](#bundle-presentation)
- [验证缓存](#verification-cache)
- [CBOR 线上格式](#cbor-wire-format)
- [密码学提供者](#crypto-providers)
- [版本检测](#version-detection)
- [实验性：规范化候选](#experimental-canonicalization-candidate-dcp-jcs-v2-opt-in-unreleased)

---

<a id="core-types-v1"></a>

## 核心类型（V1）

从 `@dcp-ai/sdk` 导入：

### ResponsiblePrincipalRecord

把人类委托人绑定到智能体。它本身只是一项已声明、已签名的绑定，而不是信任根：验证器会对照在 bundle 之外配置的信任来评估它
（参见 [ADMISSION.md](ADMISSION.md)）。

```typescript
interface ResponsiblePrincipalRecord {
  dcp_version: string;
  human_id: string;
  legal_name: string;
  entity_type: EntityType;
  jurisdiction: string;
  liability_mode: LiabilityMode;
  override_rights: boolean;
  issued_at: string;
  expires_at: string | null;
  contact?: string | null;
  signature: string;
}
```

### AgentPassport

AI 智能体的身份文件，绑定到一个人类委托人。

```typescript
interface AgentPassport {
  dcp_version: string;
  agent_id: string;
  public_key: string;
  principal_binding_reference: string;
  capabilities?: Capability[];
  risk_tier?: RiskTier;
  created_at: string;
  status: AgentStatus;
  signature: string;
}
```

### Intent

对智能体想要执行的操作的声明。

```typescript
interface Intent {
  dcp_version: string;
  intent_id: string;
  agent_id: string;
  human_id: string;
  timestamp: string;
  action_type: ActionType;
  target: IntentTarget;
  data_classes: DataClass[];
  estimated_impact: Impact;
  requires_consent?: boolean | null;
}

interface IntentTarget {
  channel: Channel;
  to?: string | null;
  domain?: string | null;
  url?: string | null;
  [key: string]: unknown;
}
```

### PolicyDecision

策略引擎评估意图的结果。

```typescript
interface PolicyDecision {
  dcp_version: string;
  intent_id: string;
  decision: PolicyDecisionType;
  risk_score: number;
  reasons: string[];
  required_confirmation?: RequiredConfirmation | null;
}
```

### AuditEntry

对已执行操作的记录。该类型本身并不使其不可变：当条目被哈希链以及已签名 bundle（V1）或已签名清单（V2）覆盖、并且这种覆盖经过验证时，篡改才可被发现。

```typescript
interface AuditEntry {
  dcp_version: string;
  audit_id: string;
  prev_hash: string;
  timestamp: string;
  agent_id: string;
  human_id: string;
  intent_id: string;
  intent_hash: string;
  policy_decision: AuditPolicyDecision;
  outcome: string;
  evidence: AuditEvidence;
}

interface AuditEvidence {
  tool?: string | null;
  result_ref?: string | null;
  [key: string]: unknown;
}
```

### CitizenshipBundle / SignedBundle

```typescript
interface CitizenshipBundle {
  responsible_principal_record: ResponsiblePrincipalRecord;
  agent_passport: AgentPassport;
  intent: Intent;
  policy_decision: PolicyDecision;
  audit_entries: AuditEntry[];
}

interface SignedBundle {
  bundle: CitizenshipBundle;
  signature: BundleSignature;
}
```

### Keypair

```typescript
interface Keypair {
  publicKeyB64: string;
  secretKeyB64: string;
}
```

<a id="enum-types"></a>

### 枚举类型

```typescript
type EntityType = 'natural_person' | 'organization';
type LiabilityMode = 'owner_responsible';
type Capability = 'browse' | 'api_call' | 'email' | 'calendar' | 'payments' | 'crm' | 'file_write' | 'code_exec';
type RiskTier = 'low' | 'medium' | 'high';
type AgentStatus = 'active' | 'revoked' | 'suspended';
type ActionType = 'browse' | 'api_call' | 'send_email' | 'create_calendar_event' | 'initiate_payment' | 'update_crm' | 'write_file' | 'execute_code';
type Channel = 'web' | 'api' | 'email' | 'calendar' | 'payments' | 'crm' | 'filesystem' | 'runtime';
type DataClass = 'none' | 'contact_info' | 'pii' | 'credentials' | 'financial_data' | 'health_data' | 'children_data' | 'company_confidential';
type Impact = 'low' | 'medium' | 'high';
type PolicyDecisionType = 'approve' | 'escalate' | 'block';
```

---

<a id="core-types-v2"></a>

## 核心类型（V2）

V2 类型增加了后量子密码学支持、会话绑定和双哈希链。

### AgentPassportV2

```typescript
interface AgentPassportV2 {
  dcp_version: '2.0';
  agent_id: string;
  session_nonce: string;            // Anti-splicing nonce
  keys: KeyEntry[];                 // Multi-algorithm key array
  principal_binding_reference: string;
  capabilities: Capability[];
  risk_tier: RiskTier;
  created_at: string;
  status: AgentStatus;
  emergency_revocation_token?: string;
}
```

### ResponsiblePrincipalRecordV2

```typescript
interface ResponsiblePrincipalRecordV2 {
  dcp_version: '2.0';
  human_id: string;
  session_nonce: string;
  legal_name: string;
  entity_type: EntityType;
  jurisdiction: string;
  liability_mode: LiabilityMode;
  override_rights: boolean;
  issued_at: string;
  expires_at: string | null;
  contact: string | null;
  binding_keys: KeyEntry[];
  pii_salt?: string;                // 32 random bytes as hex; signed; keep private (caller responsibility)
}
```

### BlindedResponsiblePrincipalRecordV2

保护个人信息的 RPR 变体，用于对隐私敏感的部署。

```typescript
interface BlindedResponsiblePrincipalRecordV2 {
  dcp_version: '2.0';
  human_id: string;
  session_nonce: string;
  blinded: true;
  pii_hash: string;                 // Salted hash of PII fields
  entity_type: EntityType;
  jurisdiction: string;
  liability_mode: LiabilityMode;
  override_rights: boolean;
  issued_at: string;
  expires_at: string | null;
  binding_keys: KeyEntry[];
}
```

辅助函数（由 `@dcp-ai/sdk` 2.2.0 及更高版本导出）：

```typescript
// 32 random bytes as hex. Set it as rpr.pii_salt before signing the RPR and keep it private:
// blindRpr omits it from the blinded record, but the full RPR retains it.
function generatePiiSalt(): string;
// pii_hash = "sha256:" + hex(sha256(canonical({ contact, legal_name, pii_salt })))
// Without pii_salt: the legacy unsalted value (deprecated), for opening old records.
function computePiiHash(rpr: ResponsiblePrincipalRecordV2): string;
// Throws if rpr.pii_salt is missing or malformed. The result never carries pii_salt.
function blindRpr(rpr: ResponsiblePrincipalRecordV2): BlindedResponsiblePrincipalRecordV2;
// warnings flags a full RPR without pii_salt (legacy unsalted commitment);
// a present pii_salt that is not 64 lowercase hex characters is an error.
function verifyBlindedRpr(
  fullRpr: ResponsiblePrincipalRecordV2,
  blindedRpr: BlindedResponsiblePrincipalRecordV2,
): { valid: boolean; errors: string[]; warnings: string[] };
function isBlindedRpr(
  rpr: ResponsiblePrincipalRecordV2 | BlindedResponsiblePrincipalRecordV2,
): rpr is BlindedResponsiblePrincipalRecordV2;
```

### IntentV2

```typescript
interface IntentV2 {
  dcp_version: '2.0';
  intent_id: string;
  session_nonce: string;
  agent_id: string;
  human_id: string;
  timestamp: string;
  action_type: ActionType;
  target: IntentTargetV2;
  data_classes: DataClass[];
  estimated_impact: Impact;
  requires_consent: boolean;
  security_tier?: SecurityTier;     // 'routine' | 'standard' | 'elevated' | 'maximum'
}
```

### PolicyDecisionV2

```typescript
interface PolicyDecisionV2 {
  dcp_version: '2.0';
  intent_id: string;
  session_nonce: string;
  decision: PolicyDecisionType;
  risk_score: number;               // Integer 0–1000 (millirisk, no floats)
  reasons: string[];
  required_confirmation: { type: 'human_approve'; fields?: string[] } | null;
  applied_policy_hash: string;
  timestamp: string;
  resolved_tier?: SecurityTier;
}
```

### AuditEventV2

```typescript
interface AuditEventV2 {
  dcp_version: '2.0';
  audit_id: string;
  session_nonce: string;
  prev_hash: string;
  prev_hash_secondary?: string;     // SHA3-256 chain
  hash_alg: 'sha256' | 'sha256+sha3-256';
  timestamp: string;
  agent_id: string;
  human_id: string;
  intent_id: string;
  intent_hash: string;
  intent_hash_secondary?: string;
  policy_decision: AuditPolicyDecision;
  outcome: string;
  evidence: AuditEvidenceV2;
  pq_checkpoint_ref: string | null;
}
```

### CitizenshipBundleV2 / SignedBundleV2

```typescript
interface CitizenshipBundleV2 {
  dcp_bundle_version: '2.0';
  manifest: BundleManifest;
  responsible_principal_record: SignedPayload<ResponsiblePrincipalRecordV2 | BlindedResponsiblePrincipalRecordV2>;
  agent_passport: SignedPayload<AgentPassportV2>;
  intent: SignedPayload<IntentV2>;
  policy_decision: SignedPayload<PolicyDecisionV2>;
  audit_entries: AuditEventV2[];
  pq_checkpoints?: PQCheckpoint[];
}

interface SignedBundleV2 {
  bundle: CitizenshipBundleV2;
  signature: BundleSignatureV2;
}
```

### BundleManifest

对 bundle 中所有构件哈希的密码学绑定。

```typescript
interface BundleManifest {
  session_nonce: string;
  rpr_hash: string;
  passport_hash: string;
  intent_hash: string;
  policy_hash: string;
  audit_merkle_root: string;
  audit_merkle_root_secondary?: string;
  audit_count: number;
  pq_checkpoints?: string[];
  /** When the session began, signed with the manifest (spec/VERIFICATION.md V2-4). */
  session_issued_at?: string;
  session_expires_at?: string;
  intended_verifier?: string;
  canonicalization_profile?: 'dcp-jcs-v1';
}
```

### CompositeSignature

```typescript
interface CompositeSignature {
  classical: SignatureEntry;
  pq: SignatureEntry | null;
  binding: BindingMode;             // 'pq_over_classical' | 'classical_only'
}

interface SignatureEntry {
  alg: string;                      // 'ed25519' | 'ml-dsa-65' | 'slh-dsa-192f'
  kid: string;                      // Key identifier
  sig_b64: string;                  // Base64-encoded signature
}

type BindingMode = 'pq_over_classical' | 'classical_only';
```

### SignedPayload

用其复合签名包裹任意构件的信封。

```typescript
interface SignedPayload<T = unknown> {
  payload: T;
  payload_hash: string;
  composite_sig: CompositeSignature;
}
```

### VerifierPolicy

由验证器决定、控制需要哪些签名的策略。

```typescript
interface VerifierPolicy {
  default_mode: VerificationMode;
  risk_overrides: Record<RiskTier, VerificationMode>;
  min_classical: number;
  min_pq: number;
  accepted_classical_algs: string[];
  accepted_pq_algs: string[];
  accepted_hash_algs: string[];
  require_session_binding: boolean;
  require_composite_binding: boolean;
  max_key_age_days: number;
  allow_v1_bundles: boolean;
  /** Phase 3: when true, classical signatures are not required even in hybrid mode */
  allow_classical_fallback_disable?: boolean;
  /** Phase 3: emit deprecation warnings for classical-only bundles */
  warn_classical_only_deprecated?: boolean;
  /** Phase 3: rejected algorithms from advisory auto-response */
  advisory_rejected_algs?: string[];
  /** Require bundles to include session_expires_at */
  require_session_expiry?: boolean;
  /** Max allowed session duration in seconds (0 = no limit) */
  max_session_duration_seconds?: number;
  /** Require bundles to include intended_verifier matching this verifier's ID */
  require_audience_binding?: boolean;
  /** This verifier's identity for audience binding checks */
  verifier_id?: string;
}

type VerificationMode = 'classical_only' | 'pq_only' | 'hybrid_required' | 'hybrid_preferred';
```

### SecurityTier

```typescript
type SecurityTier = 'routine' | 'standard' | 'elevated' | 'maximum';
```

### PQCheckpoint

```typescript
interface PQCheckpoint {
  checkpoint_id: string;
  session_nonce: string;
  event_range: {
    from_audit_id: string;
    to_audit_id: string;
    count: number;
  };
  merkle_root: string;
  composite_sig: CompositeSignature;
}
```

---

<a id="crypto-functions-v1"></a>

## 密码学函数（V1）

从 `@dcp-ai/sdk` 导入：

### `generateKeypair()`

生成一个新的 Ed25519 密钥对。

```typescript
function generateKeypair(): Keypair;
```

**返回：** `{ publicKeyB64: string, secretKeyB64: string }`

```typescript
import { generateKeypair } from '@dcp-ai/sdk';

const keys = generateKeypair();
console.log(keys.publicKeyB64); // Base64-encoded Ed25519 public key
```

### `signObject(obj, secretKeyB64)`

用 Ed25519 对 JSON 对象签名（分离式签名）。签名前会先对对象做规范化。

```typescript
function signObject(obj: unknown, secretKeyB64: string): string;
```

| 参数 | 类型 | 说明 |
|-------|------|-------------|
| `obj` | `unknown` | 要签名的可序列化为 JSON 的对象 |
| `secretKeyB64` | `string` | base64 编码的 Ed25519 私钥 |

**返回：** base64 编码的分离式签名。

```typescript
const sig = signObject({ action: 'transfer', amount: 100 }, keys.secretKeyB64);
```

### `verifyObject(obj, signatureB64, publicKeyB64)`

验证 JSON 对象上的 Ed25519 分离式签名。

```typescript
function verifyObject(obj: unknown, signatureB64: string, publicKeyB64: string): boolean;
```

| 参数 | 类型 | 说明 |
|-------|------|-------------|
| `obj` | `unknown` | 原始 JSON 对象 |
| `signatureB64` | `string` | base64 编码的签名 |
| `publicKeyB64` | `string` | base64 编码的 Ed25519 公钥 |

**返回：** 签名验证通过时为 `true`，未通过时为 `false`。对于格式错误的输入，它可能抛出异常而不是返回 `false`：无法规范化的对象、
不是有效 base64 的签名或密钥，或者解码后长度不正确的签名或密钥。

```typescript
const valid = verifyObject({ action: 'transfer', amount: 100 }, sig, keys.publicKeyB64);
```

### `canonicalize(obj)`

键顺序确定的规范 JSON 序列化。

```typescript
function canonicalize(obj: unknown): string;
```

### `publicKeyFromSecret(secretKeyB64)`

从私钥导出 Ed25519 公钥。

```typescript
function publicKeyFromSecret(secretKeyB64: string): string;
```

---

<a id="v2-composite-signature-operations"></a>

## V2 复合签名操作

从 `@dcp-ai/sdk` 导入：

### `compositeSign(registry, context, canonicalPayloadBytes, keys)`

生成复合绑定的混合签名，其中 PQ 签名覆盖经典签名，因此无法在不使 PQ 签名失效的情况下替换经典签名。移除 PQ 签名（并把绑定改标为
`classical_only`）只在有效模式为 `hybrid_required` 或 `pq_only` 时被拒绝；`classical_only` 和 `hybrid_preferred` 会接受它
（参见 [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md#step-4-switch-to-composite-signatures)）。

**绑定协议：**
1. `classical_sig = Classical.sign(context || 0x00 || payload)`
2. `pq_sig = PQ.sign(context || 0x00 || payload || classical_sig)`

```typescript
async function compositeSign(
  registry: AlgorithmRegistry,
  context: DcpContext | string,
  canonicalPayloadBytes: Uint8Array,
  keys: CompositeKeyPair,
): Promise<CompositeSignature>;
```

| 参数 | 类型 | 说明 |
|-------|------|-------------|
| `registry` | `AlgorithmRegistry` | 已注册提供者的算法注册表 |
| `context` | `DcpContext \| string` | 域分离上下文 |
| `canonicalPayloadBytes` | `Uint8Array` | 要签名的规范字节 |
| `keys` | `CompositeKeyPair` | 经典 + PQ 密钥对 |

```typescript
import { registerDefaultProviders, getDefaultRegistry, compositeSign, DCP_CONTEXTS } from '@dcp-ai/sdk';

registerDefaultProviders();
const registry = getDefaultRegistry();

const sig = await compositeSign(registry, DCP_CONTEXTS.Bundle, payloadBytes, keys);
// sig.binding === 'pq_over_classical'
```

### `compositeVerify(registry, context, canonicalPayloadBytes, compositeSig, classicalPubkeyB64, pqPubkeyB64?, strategy?)`

验证复合绑定的混合签名。

```typescript
async function compositeVerify(
  registry: AlgorithmRegistry,
  context: DcpContext | string,
  canonicalPayloadBytes: Uint8Array,
  compositeSig: CompositeSignature,
  classicalPubkeyB64: string,
  pqPubkeyB64?: string,
  strategy?: 'parallel' | 'pq_first',
): Promise<CompositeVerifyResult>;
```

| 参数 | 类型 | 说明 |
|-------|------|-------------|
| `strategy` | `'parallel' \| 'pq_first'` | `parallel`（默认）：两者并发验证。`pq_first`：先验证 PQ，PQ 失败时跳过经典签名。 |

**返回：**

```typescript
interface CompositeVerifyResult {
  valid: boolean;           // pq_over_classical: both signatures valid; classical_only: the classical one (pq_valid false).
                            // Not by itself a policy-mode, trust or admission decision
  classical_valid: boolean;
  pq_valid: boolean;
}
```

### `classicalOnlySign(registry, context, canonicalPayloadBytes, key)`

生成仅经典的复合签名（过渡模式）。

```typescript
async function classicalOnlySign(
  registry: AlgorithmRegistry,
  context: DcpContext | string,
  canonicalPayloadBytes: Uint8Array,
  key: CompositeKeyInfo,
): Promise<CompositeSignature>;
```

<a id="supporting-types"></a>

### 辅助类型

```typescript
interface CompositeKeyPair {
  classical: CompositeKeyInfo;
  pq: CompositeKeyInfo;
}

interface CompositeKeyInfo {
  kid: string;
  secretKeyB64: string;
  publicKeyB64: string;
  alg: string;            // 'ed25519' | 'ml-dsa-65'
}
```

---

<a id="v2-bundle-builder--signer"></a>
<a id="v2-bundle-builder-signer"></a>

## V2 bundle 构建器与签名器

### BundleBuilderV2

V2 Citizenship Bundle 的链式构建器，会计算清单并验证会话 nonce。

```typescript
class BundleBuilderV2 {
  constructor(sessionNonce: string);

  responsiblePrincipalRecord(rpr: SignedPayload<ResponsiblePrincipalRecordV2 | BlindedResponsiblePrincipalRecordV2>): this;
  agentPassport(passport: SignedPayload<AgentPassportV2>): this;
  intent(intent: SignedPayload<IntentV2>): this;
  policyDecision(policy: SignedPayload<PolicyDecisionV2>): this;
  addAuditEntry(entry: AuditEventV2): this;
  addAuditEntries(entries: AuditEventV2[]): this;
  addPQCheckpoint(checkpoint: PQCheckpoint): this;
  addPQCheckpoints(checkpoints: PQCheckpoint[]): this;
  enableDualHash(): this;
  build(): CitizenshipBundleV2;     // Throws on validation errors
}
```

```typescript
const bundle = new BundleBuilderV2(sessionNonce)
  .responsiblePrincipalRecord(signedRpr)
  .agentPassport(signedPassport)
  .intent(signedIntent)
  .policyDecision(signedPolicy)
  .addAuditEntries(events)
  .addPQCheckpoints(checkpoints)
  .enableDualHash()
  .build();
```

构建器会：
- 验证所有构件中会话 nonce 的一致性
- 用每个构件的 SHA-256 哈希计算 `BundleManifest`
- 计算审计 Merkle 根（+ 可选的 SHA3-256 次级根）
- 缺少任何必需构件时抛出异常

### `signBundleV2(bundle, options)`

用针对清单的复合（混合）签名签署 V2 bundle。

```typescript
async function signBundleV2(
  bundle: CitizenshipBundleV2,
  options: SignBundleV2Options,
): Promise<SignedBundleV2>;

interface SignBundleV2Options {
  registry: AlgorithmRegistry;
  signerType: SignerType;
  signerId: string;
  keys: CompositeKeyPair;
  dualHash?: boolean;
  sessionExpiresAt?: string;
  intendedVerifier?: string;
}
```

### `signBundleV2ClassicalOnly(bundle, options)`

用仅经典签名签署 V2 bundle（过渡模式）。

```typescript
async function signBundleV2ClassicalOnly(
  bundle: CitizenshipBundleV2,
  options: SignBundleV2ClassicalOnlyOptions,
): Promise<SignedBundleV2>;

interface SignBundleV2ClassicalOnlyOptions {
  registry: AlgorithmRegistry;
  signerType: SignerType;
  signerId: string;
  key: CompositeKeyInfo;
}
```

---

<a id="v2-verification"></a>

## V2 验证

### `verifySignedBundleV2(signedBundle, registry, policy?, options?)`

使用由验证器决定的策略对已签名的 V2 bundle 进行验证。当前验证器会检查主审计链和主 Merkle 根，但不会重新计算可选的次级链或 `audit_merkle_root_secondary`；验证成功并不能证明它们一致（[实现缺口](STORAGE_AND_ANCHORING.md#dual-hash-chains)）。验证也不授予准入或操作授权。

```typescript
async function verifySignedBundleV2(
  signedBundle: SignedBundleV2,
  registry: AlgorithmRegistry,
  policy?: VerifierPolicy,
  options?: VerifyV2Options, // { now?: number }: the instant every time check uses (ms since the epoch); default Date.now()
): Promise<VerifyV2Result>;
```

| 参数 | 类型 | 说明 |
|-------|------|-------------|
| `signedBundle` | `SignedBundleV2` | 要验证的已签名 bundle |
| `registry` | `AlgorithmRegistry` | 带提供者的算法注册表 |
| `policy` | `VerifierPolicy` | 验证器策略（默认为 `DEFAULT_VERIFIER_POLICY`） |
| `options.now` | `number` | 所有时间检查使用的时刻，以自纪元起的毫秒数表示（默认为 `Date.now()`） |

**返回：**

```typescript
interface VerifyV2Result {
  verified: boolean;
  errors: string[];
  warnings: string[];
  details?: {
    session_nonce?: string;
    session_expires_at?: string;
    intended_verifier?: string;
    manifest_valid?: boolean;
    signature_valid?: boolean;
    policy_satisfied?: boolean;
    hash_chain_valid?: boolean;
    pq_checkpoints_valid?: boolean;
    verification_mode?: VerificationMode;
    resolved_tier?: SecurityTier;
    advisory_rejected_algs?: string[];
    /**
     * For every composite signature checked, the key entry the verifier resolved for each
     * component and whether that component verified (spec/profiles/admission § 2.3).
     */
    signer_keys?: SignerKeyUse[];
  };
}
```

`verification_mode` 是检查该 bundle 所用的模式，`resolved_tier` 是根据其意图和策略决定计算出的安全等级。

**验证流水线：**

1. 版本和 schema 检查：只接受 v2.0 bundle，其他版本一律拒绝；把 v1.0 bundle 分流给 `verifySignedBundle` 是调用方的工作（[MIGRATION_V1_V2.md](MIGRATION_V1_V2.md#32-coexistence-strategy)）
2. 验证所有已签名构件的载荷哈希
3. 所有构件中会话 nonce 的一致性
4. 清单完整性（重新计算所有构件哈希 + 审计 Merkle 根）
5. 验证模式：策略模式（`default_mode`，或护照 `risk_tier` 对应的 `risk_overrides` 条目）与安全等级模式（规范 §14.3）中较严格者；`pq_only` 策略保持为 `pq_only`
6. 按策略验证算法
7. 验证针对清单以及针对每个构件 `SignedPayload` 的复合签名（RPR 用其 `binding_keys`，护照、意图和策略决定用护照的 `keys`）
8. 执行策略模式（hybrid_required、hybrid_preferred、classical_only、pq_only）；存在的 PQ 签名在所有模式下都必须通过验证，只有缺失的 PQ 签名才会被 hybrid_preferred 和 classical_only 容忍
9. 审计哈希链验证（prev_hash 链接）
10. 针对护照密钥和 RPR `binding_keys` 的密钥有效性检查（吊销、过期、年龄）

> `@dcp-ai/sdk` 2.1.2 及更早版本会跳过步骤 7 中的逐构件签名（VERIFICATION.md 步骤 V2-8），并且在 `hybrid_preferred` 下，会带着警告接受存在但无效的 PQ 签名（步骤 V2-7）。

```typescript
import { verifySignedBundleV2, getDefaultRegistry, registerDefaultProviders } from '@dcp-ai/sdk';

// The default registry is empty until providers are registered
// (Ed25519, ML-DSA-65, SLH-DSA-192f).
registerDefaultProviders();

const result = await verifySignedBundleV2(signedBundle, getDefaultRegistry());
if (result.verified) {
  console.log('Mode:', result.details?.verification_mode);
} else {
  console.error('Errors:', result.errors);
  console.warn('Warnings:', result.warnings);
}
```

<a id="admission-trusted-principals-and-strict-v1"></a>
<a id="admission-trusted-principals-and-strict-v1-unreleased"></a>

### 准入：受信任的委托人与 strict-v1

定义见 [`spec/profiles/admission`](../spec/profiles/admission/README.md)；指南见 [ADMISSION.md](ADMISSION.md)。

| 函数 | 说明 |
|----------|-------------|
| `createPrincipalTrustStore(trustSet)` | 验证信任集合并返回一个存储；抛出 `AdmissionConfigError`（`code`） |
| `resolveStrictV1Profile(config)` | 验证 strict-v1 配置，并返回带其 `policy` 的冻结配置 |
| `admitSignedBundleV2(signedBundle, registry, { profile?, policy?, trust?, revocation?, now? })` | 进行验证（有配置时按该配置的策略）并评估准入 |
| `evaluateAdmissionV2({ signedBundle, verification, profile?, trust?, revocation?, now })` | 根据验证器结果评估准入；不做密码学运算，也没有 I/O。它信任 `verification`：只传入在该 `now`、按 `profile.policy` 对该 bundle 运行 `verifySignedBundleV2` 得到的结果 |
| `revocationSubjects(signedBundle, verification)` | 吊销信息源必须回答的智能体 ID 和已验证的签名者 kid |
| `revocationSnapshotFromDenyList(document, subjects)` | 根据完整的拒绝列表（吊销服务的 `/.well-known/dcp-revocations.json`）生成的快照 |

结果包括：`verified`、`verification`、`principal_trust`、`profile`、`profile_compliance`、`admitted`、`action_authorized`（始终为 `false`）、`recorded_decision`、`trust_set_version`、`errors: [{ code, message }]`。

### `DEFAULT_VERIFIER_POLICY`

默认的验证器策略：

```typescript
const DEFAULT_VERIFIER_POLICY: VerifierPolicy = {
  default_mode: 'hybrid_preferred',
  risk_overrides: {
    low: 'classical_only',
    medium: 'hybrid_preferred',
    high: 'hybrid_required',
  },
  min_classical: 1,
  min_pq: 1,
  accepted_classical_algs: ['ed25519'],
  accepted_pq_algs: ['ml-dsa-65', 'slh-dsa-192f'],
  accepted_hash_algs: ['sha256', 'sha384'],
  require_session_binding: true,
  require_composite_binding: true,
  max_key_age_days: 365,
  allow_v1_bundles: true,
  allow_classical_fallback_disable: false,
  warn_classical_only_deprecated: false,
  advisory_rejected_algs: [],
};
```

<a id="verifysignedbundlesignedbundle-publickeyb64-v1"></a>

### `verifySignedBundle(signedBundle, publicKeyB64?)`（V1）

验证用 Ed25519 签名的 V1 bundle。不提供 `publicKeyB64` 时，使用 `signature.signer.public_key_b64` 中的密钥。

```typescript
function verifySignedBundle(signedBundle: SignedBundle, publicKeyB64?: string): VerificationResult;

interface VerificationResult {
  verified: boolean;
  errors?: string[];
}
```

---

<a id="security-tier-engine"></a>

## 安全等级引擎

### `computeSecurityTier(intent, policyDecision?, mandateChainTier?)`

根据意图和 bundle 的策略决定计算安全等级（规范 §14.2）。`mandateChainTier`，
即已验证委托链（`verifyMandateChain`）的 `effective_tier`，只能提高结果。

```typescript
function computeSecurityTier(
  intent: IntentV2,
  policyDecision?: Pick<PolicyDecisionV2, 'risk_score'> | null,
  mandateChainTier?: SecurityTier | null,
): SecurityTier;
```

**决策逻辑**（`risk_score` 来自策略决定，必须是 0 到 1000 的整数；没有策略决定时为 0）：

| 条件 | 等级 |
|-----------|------|
| `risk_score >= 800`，或 `credentials` / `children_data` | `'maximum'` |
| `risk_score >= 500`、`pii` / `financial_data` / `health_data`、`initiate_payment`、`estimated_impact: 'high'`，或 `action_type`、`estimated_impact`、`data_classes` 存在未知或缺失的值，或策略决定的 `risk_score` 缺失或不是 0 到 1000 的整数 | `'elevated'` |
| `risk_score >= 200` 或 `estimated_impact: 'medium'` | `'standard'` |
| 其他情况 | `'routine'` |

显式给出的 `intent.security_tier` 只能提高结果；未知值按 `'elevated'` 计。放在意图上的 `risk_score` 会被忽略。

```typescript
import { computeSecurityTier } from '@dcp-ai/sdk';

const tier = computeSecurityTier(bundle.intent.payload, bundle.policy_decision.payload);
// 'routine' | 'standard' | 'elevated' | 'maximum'
```

### `tierToVerificationMode(tier)`

把安全等级映射为其验证模式。

```typescript
function tierToVerificationMode(tier: SecurityTier): VerificationMode;
```

| 等级 | 验证模式 |
|------|------------------|
| `routine` | `'classical_only'` |
| `standard` | `'hybrid_preferred'` |
| `elevated` | `'hybrid_required'` |
| `maximum` | `'hybrid_required'` |

### `tierToCheckpointInterval(tier)`

把安全等级映射为 PQ 检查点间隔。

```typescript
function tierToCheckpointInterval(tier: SecurityTier): number;
```

| 等级 | 间隔（事件数） |
|------|--------------------|
| `routine` | 50 |
| `standard` | 10 |
| `elevated` | 1 |
| `maximum` | 1 |

### `maxTier(a, b)`

返回两个等级中最严格（级别最高）的那个。可用于把自动计算的等级与显式覆盖的等级结合起来。

```typescript
function maxTier(a: SecurityTier, b: SecurityTier): SecurityTier;

maxTier('routine', 'elevated'); // 'elevated'
maxTier('maximum', 'standard'); // 'maximum'
```

### `effectiveVerificationMode(policyMode, tier)`

验证器执行的模式（规范 §14.3）：其策略模式与等级模式中较严格者，顺序为 `classical_only` < `hybrid_preferred` < `hybrid_required`。等级只会增加 PQ 要求，因此 `pq_only` 策略保持为 `pq_only`；未知的策略模式按 `'hybrid_required'` 计。`verifySignedBundleV2` 会对每个 bundle 应用它。

```typescript
function effectiveVerificationMode(policyMode: VerificationMode, tier: SecurityTier): VerificationMode;

effectiveVerificationMode('classical_only', 'elevated'); // 'hybrid_required'
effectiveVerificationMode('hybrid_required', 'routine'); // 'hybrid_required'
effectiveVerificationMode('pq_only', 'maximum'); // 'pq_only'
```

---

<a id="a2a-protocol-dcp-04"></a>

## A2A 协议（DCP-04）

围绕 X25519 + ML-KEM-768 混合密钥交换设计的智能体间会话协议。这些函数并不执行该交换：由调用方执行交换，并把得到的会话密钥传给
`createSession`。

### `createHello(initiatorBundle, kemPublicKeyB64, requestedCapabilities, securityTier)`

创建 A2A_HELLO 握手消息（发起方）。

```typescript
function createHello(
  initiatorBundle: Record<string, unknown>,
  kemPublicKeyB64: string,
  requestedCapabilities: string[],
  securityTier: string,
): A2AHello;
```

```typescript
interface A2AHello {
  type: 'A2A_HELLO';
  protocol_version: '2.0';
  initiator_bundle: Record<string, unknown>;
  ephemeral_kem_public_key: {
    alg: string;
    public_key_b64: string;
  };
  nonce: string;
  supported_algorithms: {
    signing: string[];
    kem: string[];
    cipher: string[];
  };
  requested_capabilities: string[];
  security_tier: string;
  timestamp: string;
  /** DCP-09: Optional delegation mandate reference for mutual verification */
  mandate_id?: string;
  /** DCP-09: Hash of the delegation mandate for integrity binding */
  mandate_hash?: string;
}
```

### `createWelcome(responderBundle, kemPublicKeyB64, kemCiphertextB64, resolvedTier)`

创建 A2A_WELCOME 握手消息（响应方）。

```typescript
function createWelcome(
  responderBundle: Record<string, unknown>,
  kemPublicKeyB64: string,
  kemCiphertextB64: string,
  resolvedTier: string,
): A2AWelcome;
```

### `createSession(sessionId, sessionKey, localAgentId, remoteAgentId, securityTier, rekeyingInterval?)`

握手完成后创建一个新的加密 A2A 会话。

```typescript
function createSession(
  sessionId: string,
  sessionKey: Uint8Array,
  localAgentId: string,
  remoteAgentId: string,
  securityTier: string,
  rekeyingInterval?: number,       // Default: 1000 messages
): A2ASession;
```

```typescript
interface A2ASession {
  session_id: string;
  session_key: Uint8Array;
  agent_id_local: string;
  agent_id_remote: string;
  message_counter_send: number;
  message_counter_recv: number;
  created_at: string;
  last_activity: string;
  security_tier: string;
  rekeying_interval: number;
  status: 'active' | 'rekeying' | 'closed';
  received_sequences?: number[];   // Sequences accepted within the receive window
}
```

### `encryptMessage(session, payload)`

在 A2A 会话中用带关联数据的 AES-256-GCM 加密消息。

```typescript
function encryptMessage(
  session: A2ASession,
  payload: Record<string, unknown>,
): EncryptedMessage;
```

```typescript
interface EncryptedMessage {
  session_id: string;
  sequence: number;
  type: 'A2A_MESSAGE';
  encrypted_payload: string;        // Base64-encoded ciphertext
  iv: string;                       // Base64-encoded 12-byte IV
  tag: string;                      // Base64-encoded 16-byte GCM auth tag
  sender_agent_id: string;
  timestamp: string;
}
```

### `decryptMessage(session, message)`

解密收到的 A2A 消息。每个序号只接受一次（DCP-04 §8.4）：设 `R` =
`message_counter_recv`（收到的最大序号加一），则已收到的序号、低于
`R − 1000` 的序号、大于或等于 `R + 1000` 的序号，或不是非负整数的序号都会被拒绝。窗口内的乱序送达可以正常工作。只有在 GCM 标签验证通过之后
才会记录序号，因此伪造的消息无法消耗它。不带
`received_sequences` 恢复的会话会把窗口内低于 `message_counter_recv` 的所有序号都视为已收到。

```typescript
function decryptMessage(
  session: A2ASession,
  message: EncryptedMessage,
): Record<string, unknown>;
```

### `needsRekeying(session)`

根据消息数量检查会话是否需要更换密钥。

```typescript
function needsRekeying(session: A2ASession): boolean;
```

### `deriveSessionId(agentIdA, agentIdB, nonceA, nonceB, sessionKey)`

根据智能体 ID、nonce 和会话密钥确定性地导出会话 ID。

```typescript
function deriveSessionId(
  agentIdA: string, agentIdB: string,
  nonceA: string, nonceB: string,
  sessionKey: Uint8Array,
): string;
```

### `generateResumeProof(session, lastSeenSequence)` / `verifyResumeProof(...)`

生成并验证基于 HMAC 的会话恢复证明。

```typescript
function generateResumeProof(session: A2ASession, lastSeenSequence: number): string;
function verifyResumeProof(session: A2ASession, lastSeenSequence: number, proof: string): boolean;
```

### `deriveRekeyedSessionKey(oldSessionKey, newSharedSecret, sessionId)`

为更换密钥操作导出新的会话密钥。

```typescript
function deriveRekeyedSessionKey(
  oldSessionKey: Uint8Array,
  newSharedSecret: Uint8Array,
  sessionId: string,
): Uint8Array;
```

### `createCloseMessage(sessionId, reason, finalSequence, auditSummaryHash)`

创建 A2A_CLOSE 消息。

```typescript
function createCloseMessage(
  sessionId: string,
  reason: 'complete' | 'timeout' | 'error' | 'revocation' | 'policy_violation',
  finalSequence: number,
  auditSummaryHash: string,
): A2AClose;
```

### `generateNonce()`

生成 32 字节的密码学随机 nonce（十六进制编码）。

```typescript
function generateNonce(): string;
```

---

<a id="telemetry--observability"></a>
<a id="telemetry-observability"></a>

## 遥测与可观测性

### `dcpTelemetry`

DCP SDK 的单例遥测实例。

```typescript
import { dcpTelemetry } from '@dcp-ai/sdk';
```

### `dcpTelemetry.init(config)`

用给定配置初始化遥测。

```typescript
dcpTelemetry.init(config: Partial<DcpTelemetryConfig>): void | Promise<void>; // enabled: false returns nothing; with exporterType 'otlp', a Promise that settles after the setup attempt

interface DcpTelemetryConfig {
  serviceName: string;              // Identifier for this agent/service
  enabled: boolean;                 // Enable/disable telemetry
  exporterType?: 'console' | 'otlp' | 'none';
  otlpEndpoint?: string;           // OTLP collector endpoint
  metricsInterval?: number;        // Metrics export interval (ms)
}
```

```typescript
dcpTelemetry.init({
  serviceName: 'my-agent',
  enabled: true,
  exporterType: 'console',
});
```

使用 `exporterType: 'otlp'` 时，即使 OTLP 设置失败，Promise 也会 resolve：失败会以带 `operation: 'telemetry.init_otlp'`
的 `error` 事件送达 `onEvent` 监听器。设置完成之前发出的事件不会重新转发到 OTLP，Promise 已 resolve 也不保证送达后端。插桩是显式的：
SDK 的签名和验证函数不会调用记录器，因此 span 和指标只来自你的代码对 `startSpan` 和 `record*` 的调用（参见 [OBSERVABILITY.md](OBSERVABILITY.md)）。

### `dcpTelemetry.startSpan(name, attributes?)` / `endSpan(spanId, status?, error?)`

为操作创建并完成追踪 span。

```typescript
startSpan(name: string, attributes?: SpanAttributes): string;
endSpan(spanId: string, status?: 'ok' | 'error', error?: string): number;

// Returns duration in milliseconds
```

```typescript
const spanId = dcpTelemetry.startSpan('verify_bundle', { tier: 'elevated' });
// ... operation ...
const durationMs = dcpTelemetry.endSpan(spanId);
```

### `dcpTelemetry.recordSignLatency(durationMs, algorithm)`

记录签名操作的延迟。

```typescript
recordSignLatency(durationMs: number, algorithm: string): void;
```

### `dcpTelemetry.recordVerifyLatency(durationMs, algorithm)`

记录验证操作的延迟。

```typescript
recordVerifyLatency(durationMs: number, algorithm: string): void;
```

### `dcpTelemetry.recordKemLatency(durationMs, operation)`

记录 KEM（密钥封装）操作的延迟。

```typescript
recordKemLatency(durationMs: number, operation: 'encapsulate' | 'decapsulate'): void;
```

### `dcpTelemetry.recordCheckpointLatency(durationMs, tier)`

记录 PQ 检查点创建的延迟。

```typescript
recordCheckpointLatency(durationMs: number, tier: string): void;
```

### `dcpTelemetry.recordBundleVerify(durationMs, success, tier)`

记录一次 bundle 验证操作。

```typescript
recordBundleVerify(durationMs: number, success: boolean, tier: string): void;
```

### `dcpTelemetry.recordCacheHit()` / `recordCacheMiss()`

跟踪验证缓存的命中率和未命中率。

```typescript
recordCacheHit(): void;
recordCacheMiss(): void;
```

### `dcpTelemetry.recordA2ASession()` / `recordA2AMessage()`

跟踪 A2A 协议的使用情况。

```typescript
recordA2ASession(): void;
recordA2AMessage(): void;
```

### `dcpTelemetry.recordError(operation, error)`

记录一次错误的发生。

```typescript
recordError(operation: string, error: string): void;
```

### `dcpTelemetry.getMetricsSummary()`

获取所有已收集指标的摘要及百分位统计。

```typescript
getMetricsSummary(): MetricsSummary;

interface MetricsSummary {
  sign: PercentileStats;
  verify: PercentileStats;
  kem: PercentileStats;
  checkpoint: PercentileStats;
  bundleVerify: PercentileStats;
  cacheHitRate: number;            // 0.0 – 1.0
  tierDistribution: Record<string, number>;
  totals: {
    signaturesCreated: number;
    signaturesVerified: number;
    bundlesVerified: number;
    errors: number;
    a2aSessions: number;
    a2aMessages: number;
  };
}

interface PercentileStats {
  count: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
  mean: number;
}
```

### `dcpTelemetry.onEvent(listener)`

订阅遥测事件。返回一个用于取消订阅的函数。

```typescript
onEvent(listener: (event: TelemetryEvent) => void): () => void;

interface TelemetryEvent {
  type: string;
  timestamp: number;
  [key: string]: unknown;
}
```

### `dcpTelemetry.reset()`

重置所有已收集的 span 和指标。

```typescript
reset(): void;
```

---

<a id="hashing--merkle-trees"></a>
<a id="hashing-merkle-trees"></a>

## 哈希与 Merkle 树

### `hashObject(obj)`

规范化 JSON 对象的 SHA-256 哈希。

```typescript
function hashObject(obj: unknown): string;
```

### `merkleRootFromHexLeaves(leaves)`

根据十六进制编码的叶子哈希计算 Merkle 根。

```typescript
function merkleRootFromHexLeaves(leaves: string[]): string | null; // null for no leaves
```

### `merkleRootForAuditEntries(auditEntries)`

为审计条目数组计算 Merkle 根（空数组时为 `null`）。

```typescript
function merkleRootForAuditEntries(auditEntries: unknown[]): string | null;
```

### `intentHash(intent)`

计算意图对象的哈希。

```typescript
function intentHash(intent: unknown): string;
```

### `prevHashForEntry(prevEntry)`

根据前一条目计算下一条审计条目的 `prev_hash`。

```typescript
function prevHashForEntry(prevEntry: unknown): string;
```

### `sha256Hex(data)` / `sha3_256Hex(data)`

十六进制编码的哈希。

```typescript
function sha256Hex(data: Uint8Array | Buffer | string): string;
function sha3_256Hex(data: Uint8Array | Buffer | string): string;
```

### `dualHash(data)` / `dualHashCanonical(canonicalJson)` / `dualMerkleRoot(leaves)`

V2 的双哈希（SHA-256 + SHA3-256）操作。`dualHashCanonical` 接受已经规范化的 JSON 字符串；没有叶子时 `dualMerkleRoot` 返回 `null`。

```typescript
function dualHash(data: Uint8Array | Buffer | string): DualHash;
function dualHashCanonical(canonicalJson: string): DualHash;
function dualMerkleRoot(leaves: DualHash[]): DualHash | null;

interface DualHash {
  sha256: string;
  sha3_256: string;
}
```

### `auditEventsMerkleRoot(events)`

计算 V2 审计事件的 SHA-256 Merkle 根。

```typescript
function auditEventsMerkleRoot(events: AuditEventV2[]): string;
```

---

<a id="schema-validation"></a>

## 模式验证

### `validateSchema(schemaName, data)`

按 JSON Schema 验证一个 DCP 构件。

```typescript
function validateSchema(schemaName: string, data: unknown): ValidationResult;
```

### `validateBundle(bundle)`

验证整个 citizenship bundle。

```typescript
function validateBundle(bundle: unknown): ValidationResult;

interface ValidationResult {
  valid: boolean;
  errors?: string[];
}
```

---

<a id="dcp-05-agent-lifecycle"></a>

## DCP-05：智能体生命周期

从 `@dcp-ai/sdk` 导入：

### `validateStateTransition(from, to)`

检查生命周期状态转换是否有效。

```typescript
function validateStateTransition(from: LifecycleState, to: LifecycleState): boolean;

type LifecycleState = 'commissioned' | 'active' | 'declining' | 'decommissioned';
```

有效的转换：`commissioned→active`、`commissioned→decommissioned`、`active→declining`、`active→decommissioned`（突然故障）、`declining→active`、`declining→decommissioned`。它只检查边，不检查规范要求的从 `declining` 重新激活所需的委托人批准，也不检查任何其他授权。

### `computeVitalityScore(metrics)`

根据各项指标计算加权的活力分数（0-1000）。

```typescript
function computeVitalityScore(metrics: VitalityMetrics): number;

interface VitalityMetrics {
  task_completion_rate: number;  // 0.0 – 1.0
  error_rate: number;            // 0.0 – 1.0
  human_satisfaction: number;    // 0.0 – 1.0
  policy_alignment: number;      // 0.0 – 1.0
}
```

### `createCommissioningCertificate(...)` / `createVitalityReport(...)` / `createDecommissioningRecord(...)`

创建已签名的生命周期构件。它们都需要 `AlgorithmRegistry` 和 `CompositeKeyPair`。

```typescript
type TerminationMode = 'planned_retirement' | 'termination_for_cause' | 'organizational_restructuring' | 'sudden_failure';
type DataDisposition = 'transferred' | 'archived' | 'destroyed';
```

---

<a id="dcp-06-succession"></a>

## DCP-06：继承

### `createDigitalTestament(...)` / `updateDigitalTestament(...)`

创建或更新带继任者偏好和记忆分类的数字遗嘱。

```typescript
type MemoryDisposition = 'transfer' | 'retain' | 'destroy';
type MemoryClassification = Record<string, MemoryDisposition>;

interface SuccessorPreference {
  agent_id: string;
  priority: number;
  conditions?: string;
}
```

### `executeSuccession(...)` / `createMemoryTransferManifest(...)`

执行继承仪式并创建记忆转移清单。

```typescript
type TransitionType = 'planned' | 'forced' | 'emergency';
```

### `classifyMemory(entries, classification)`

把记忆条目分为操作性的（可转移）和关系性的（待销毁）。它返回 `{ operational, relationalDestroyed }`，其中 `relationalDestroyed`
只列出被归类为 `destroy` 的条目（也是没有对应项的类别的默认值）的哈希；它不会删除任何东西，真正销毁这些记忆是调用方的工作。被归类为
`retain` 的条目不会出现在这两个输出中。

---

<a id="dcp-07-dispute-resolution"></a>

## DCP-07：争议解决

### `createDispute(...)` / `escalateDispute(...)` / `resolveDispute(...)`

管理争议的生命周期。

```typescript
type DisputeType = 'resource_conflict' | 'directive_conflict' | 'capability_conflict' | 'policy_conflict';
type EscalationLevel = 'direct_negotiation' | 'contextual_arbitration' | 'human_appeal';
type DisputeStatus = 'open' | 'in_negotiation' | 'arbitrated' | 'appealed' | 'resolved';
```

### `createObjection(...)`

创建智能体对某项指令的正式异议。

```typescript
type ObjectionType = 'ethical' | 'safety' | 'policy_violation' | 'capability_mismatch';
```

### `createArbitrationPanel(...)` / `submitResolution(...)` / `buildJurisprudenceBundle(...)`

管理仲裁小组和判例记录。

```typescript
type AuthorityLevel = 'local' | 'organizational' | 'cross_org';
```

### `lookupPrecedent(jurisprudence, category, context?)`

返回某一类别的判例 bundle，可选择按上下文缩小范围。

```typescript
function lookupPrecedent(jurisprudence: JurisprudenceBundle[], category: string, context?: string): JurisprudenceBundle[];
```

---

<a id="dcp-08-rights--obligations"></a>
<a id="dcp-08-rights-obligations"></a>

## DCP-08：权利与义务

### `declareRights(...)` / `recordObligation(...)` / `reportViolation(...)`

管理智能体的权利和义务履行情况。

```typescript
type RightType = 'memory_integrity' | 'dignified_transition' | 'identity_consistency' | 'immutable_record';
type ComplianceStatus = 'compliant' | 'non_compliant' | 'pending_review';

interface RightEntry {
  right_type: RightType;
  scope: string;
  constraints?: string;
}
```

### `checkRightsCompliance(declaration, obligations)`

检查义务是否尊重权利声明。

```typescript
function checkRightsCompliance(
  declaration: RightsDeclaration,
  obligations: ObligationRecord[],
): { compliant: boolean; violations: string[] };
```

---

<a id="dcp-09-delegation--representation"></a>
<a id="dcp-09-delegation-representation"></a>

## DCP-09：委托与代理

### `createDelegationMandate(...)` / `verifyMandateValidity(mandate, revokedMandateIds)` / `revokeDelegation(mandate, revokedMandateIds)`

创建、验证和吊销人类对智能体的权限委托。已吊销委托书 ID 的集合由调用方维护：
`verifyMandateValidity` 会检查它（以及有效期窗口），当委托书可吊销时，`revokeDelegation` 会把委托书
加入该集合。

```typescript
function verifyMandateValidity(mandate: DelegationMandate, revokedMandateIds: Set<string>): { valid: boolean; reason?: string };
function revokeDelegation(mandate: DelegationMandate, revokedMandateIds: Set<string>): { revoked: boolean; reason?: string };
```

```typescript
interface AuthorityScopeEntry {
  domain: string;
  actions_permitted: string[];
  data_classes?: string[];
  limits?: Record<string, unknown>;
}
```

### `createSubMandate(registry, delegatorKeys, parent, params)` / `verifyMandateChain(registry, chain, revokedMandateIds, keys, now?)`

委托链（DCP-09 §3.5）：持有 `parent` 的智能体向另一个智能体签发子委托书，在 `DCP-AI.v2.SubMandate` 上下文下用
自己的密钥签名。`verifyMandateChain` 接收从根开始的链、已吊销的委托书 ID、
人类的密钥条目和按 `agent_id` 给出的每个委托方智能体的密钥条目，以及验证
时刻；它检查直到人类的每一跳签名、与父级的链接和深度、`sub_delegation`、嵌套的
有效期窗口、权限收窄（操作、数据类别和限额只能缩小：子条目以子集形式重述父级的
`data_classes`，数值限额只作为 ±(2^53−1) 范围内的整数进行比较）、`minimum_security_tier`
下限以及吊销（被吊销的祖先会使所有后代失效），遇到任何未知情况都以失败即关闭方式处理。

```typescript
interface MandateChainKeys { human_keys: KeyEntry[]; agent_keys: Record<string, KeyEntry[]> }
interface MandateChainResult { valid: boolean; errors: string[]; depth: number; effective_tier: SecurityTier | null }
```

`computeSecurityTier(intent, policyDecision?, mandateChainTier?)` 把链的 `effective_tier` 作为
只能提高等级的下限（规范 §14.2）。Python：`create_sub_mandate`、`verify_mandate_chain`；Go：
`CreateSubMandate`、`VerifyMandateChain`；Rust：`create_sub_mandate`、`verify_mandate_chain`。

### `evaluateSignificance(context)` / `shouldNotifyHuman(significance, thresholds)`

评估操作的重要性，并确定是否应通知人类。

```typescript
type ThresholdOperator = 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
type ThresholdAction = 'notify' | 'escalate' | 'block';
```

### `createAdvisoryDeclaration(...)` / `createAwarenessThreshold(...)`

创建智能体咨询声明并配置通知阈值。

### `generateMirror(...)`

根据审计链生成人类可读的委托人镜像叙述。

### `generateInteractionRecord(...)`

创建双层的智能体间交互记录（公开条款 + 私下审议的哈希）。

---

<a id="domain-separation"></a>

## 域分离

### `DCP_CONTEXTS`

为不同 DCP 操作预定义的域分离上下文。

```typescript
const DCP_CONTEXTS: Record<string, DcpContext>;
// 19 contexts: AgentPassport, ResponsiblePrincipal, Intent, PolicyDecision,
// AuditEvent, Bundle, Revocation, KeyRotation, ProofOfPossession,
// JurisdictionAttestation, HumanConfirmation, MultiPartyAuth,
// Lifecycle (DCP-05), Succession (DCP-06), Dispute (DCP-07),
// Rights (DCP-08), Delegation (DCP-09), Awareness (DCP-09), SubMandate (DCP-09)
```

### `domainSeparatedMessage(context, canonicalPayloadBytes)`

构建要签名的消息：`UTF8(context) || 0x00 || canonicalPayloadBytes`。遇到未知的上下文标签时抛出异常。

```typescript
function domainSeparatedMessage(context: DcpContext | string, canonicalPayloadBytes: Uint8Array): Uint8Array;
```

---

<a id="session-nonces"></a>

## 会话 nonce

### `generateSessionNonce()`

生成用于防拼接（splicing）的密码学会话 nonce。

```typescript
function generateSessionNonce(): string;
```

### `isValidSessionNonce(nonce)`

验证字符串是否为有效的 64 字符十六进制会话 nonce。

```typescript
function isValidSessionNonce(nonce: string): boolean;
```

### `verifySessionBinding(artifacts)`

验证所有构件共享同一个会话 nonce。

```typescript
function verifySessionBinding(artifacts: Array<{ session_nonce?: string }>): {
  valid: boolean;
  nonce?: string;
  error?: string;
};
```

---

<a id="key-recovery"></a>

## 密钥恢复

### `shamirSplit(secret, threshold, totalShares)`

把私钥拆分为 M-of-N 的 Shamir 份额。

```typescript
function shamirSplit(secret: Uint8Array, threshold: number, totalShares: number): ShamirShare[];

interface ShamirShare {
  index: number;
  data: Uint8Array;
}
```

### `shamirReconstruct(shares)`

用 Shamir 份额重建秘密值。

```typescript
function shamirReconstruct(shares: ShamirShare[]): Uint8Array;
```

### `setupKeyRecovery({ humanId, masterSecret, threshold, holders })`

用 M-of-N 社交恢复配置设置密钥恢复。返回要公布的配置，以及要分发给每位持有人的一个份额。

```typescript
function setupKeyRecovery(params: {
  humanId: string;
  masterSecret: Uint8Array;
  threshold: number;
  holders: Array<{ holderId: string; holderKid: string }>;
}): RecoverySetup;

interface RecoverySetup {
  config: Omit<RecoveryConfig, 'composite_sig'>;
  shares: ShamirShare[];
}
```

---

<a id="emergency-revocation"></a>

## 紧急吊销

### `generateEmergencyRevocationToken()`

为智能体紧急吊销生成吊销秘密值及其承诺令牌。

```typescript
function generateEmergencyRevocationToken(): EmergencyRevocationTokenPair;

interface EmergencyRevocationTokenPair {
  revocation_secret: string;           // 64 hex chars; kept offline by the human principal
  emergency_revocation_token: string;  // "sha256:<hex>"; embedded in the agent passport
}
```

### `verifyEmergencyRevocationSecret(revocationSecret, commitmentToken)`

对照护照中的承诺令牌验证紧急吊销秘密值。

```typescript
function verifyEmergencyRevocationSecret(revocationSecret: string, commitmentToken: string): boolean;
```

### `buildEmergencyRevocation({ agentId, humanId, revocationSecret })`

构建紧急吊销请求。

```typescript
function buildEmergencyRevocation(params: {
  agentId: string;
  humanId: string;
  revocationSecret: string;
}): EmergencyRevocation;
```

---

<a id="bundle-presentation"></a>

## bundle 呈现

### `suggestPresentationMode(tier, opts)`

建议一种呈现模式：首次接触或在 `elevated`/`maximum` 时为 `full`；在 `routine`/`standard` 时，已有信任关系则为 `reference`，否则为 `compact`。

```typescript
function suggestPresentationMode(
  tier: SecurityTier,
  opts: { isFirstContact: boolean; hasTrustRelationship: boolean },
): PresentationMode;

type PresentationMode = 'full' | 'incremental' | 'reference' | 'compact';
```

### `presentFull(bundle)` / `presentCompact(bundle, pqCheckpointRef)` / `presentReference(bundle, verificationEndpoint)` / `presentIncremental(baseBundle, updatedBundle, baseAuditCount)`

生成用于传输 bundle 的不同呈现格式。`presentCompact` 去掉 PQ 签名，改为引用一个 PQ 检查点；`presentReference` 只发送 bundle 哈希、会话 nonce 和一个验证端点；`presentIncremental` 发送 `baseAuditCount` 之后的审计条目、PQ 检查点、更新后的清单及其签名。

检查点引用不能替代有效模式所要求的 PQ 签名，任何呈现形式都不授权或准入任何东西。只有完整呈现和紧凑呈现中的 `bundle`
是 `verifySignedBundleV2` 可以直接接受的 `SignedBundleV2`（紧凑呈现只有在有效模式容许缺少 PQ 签名时才能通过）；引用呈现或增量呈现
必须先解析为完整的已签名 bundle。

```typescript
function presentFull(bundle: SignedBundleV2): FullPresentation;
function presentCompact(bundle: SignedBundleV2, pqCheckpointRef: string | null): CompactPresentation;
function presentReference(bundle: SignedBundleV2, verificationEndpoint: string): ReferencePresentation;
function presentIncremental(
  baseBundle: SignedBundleV2,
  updatedBundle: SignedBundleV2,
  baseAuditCount: number,
): IncrementalPresentation;
```

### `computeBundleHash(bundle)`

为引用式呈现计算已签名 bundle 的哈希。

```typescript
function computeBundleHash(bundle: SignedBundleV2): string;
```

---

<a id="verification-cache"></a>

## 验证缓存

### `VerificationCache`

内存中的验证结果缓存，以 bundle 哈希为键，并按安全等级设置 TTL。

- **键只是 bundle 哈希。** 缓存不区分租户或验证器策略，命中时也不会
  重新检查会话窗口、密钥有效性、委托人信任或新近的吊销快照。不要在没有重新验证的情况下，
  把缓存的结果用于准入，或在其他策略、其他租户下重用。
- **失效：** `invalidateByKid(kid)` 删除签名者 kid 中包含 `kid` 的条目；`clear()` 删除
  全部内容。`invalidateByAgent(agentId)` 目前不删除任何内容并返回 0，因此它不会吊销某个
  智能体的条目：请对该智能体的每个 kid 使用 `invalidateByKid`，或使用 `clear()`。

```typescript
class VerificationCache {
  constructor(options?: VerificationCacheOptions);
  get(bundleHash: string): VerifyV2Result | null;          // null when absent or expired
  set(bundleHash: string, result: VerifyV2Result, signerKids: string[], tier: SecurityTier): void;
  has(bundleHash: string): boolean;
  invalidateByKid(kid: string): number;                   // entries removed
  invalidateByAgent(agentId: string): number;            // currently a no-op: returns 0 (see above)
  clear(): void;
  readonly size: number;
}

interface VerificationCacheOptions {
  /** TTL per tier in milliseconds. */
  ttlByTier?: Partial<Record<SecurityTier, number>>;
  /** Hard upper limit on entries to prevent unbounded growth. */
  maxEntries?: number;
}

interface CacheEntry {
  result: VerifyV2Result;
  bundleHash: string;
  signerKids: string[];
  tier: SecurityTier;
  createdAt: number;
  expiresAt: number;
}
```

---

<a id="cbor-wire-format"></a>

## CBOR 线上格式

DCP bundle 的紧凑二进制序列化。

### `cborEncode(value)` / `cborDecode(data)`

```typescript
function cborEncode(value: unknown): Uint8Array;
function cborDecode(data: Uint8Array): unknown;
```

### `jsonToCborPayload(json)` / `cborPayloadToJson(cbor)`

在 DCP 载荷的 JSON 形式（base64 的 `*_b64` 字段）与适合 CBOR 的形式（原始字节串）之间递归转换。用 `cborEncode` 对结果进行编码。

```typescript
function jsonToCborPayload(json: Record<string, unknown>): Record<string, unknown>;
function cborPayloadToJson(cbor: Record<string, unknown>): Record<string, unknown>;
```

### `detectWireFormat(data)`

检测数据是 JSON 编码还是 CBOR 编码。

```typescript
function detectWireFormat(data: Uint8Array): 'cbor' | 'json';
```

---

<a id="crypto-providers"></a>

## 密码学提供者

### `registerDefaultProviders()`

注册默认的 Ed25519 + ML-DSA-65 + SLH-DSA-192f 提供者。

```typescript
function registerDefaultProviders(): void;
```

### `getDefaultRegistry()`

获取注册了所有提供者的默认 `AlgorithmRegistry`。

```typescript
function getDefaultRegistry(): AlgorithmRegistry;
```

### `AlgorithmRegistry`

算法提供者的注册表。

```typescript
class AlgorithmRegistry {
  registerSigner(provider: CryptoProvider): void;
  registerKem(provider: KemProvider): void;
  getSigner(alg: string): CryptoProvider;   // throws for an unregistered algorithm
  getKem(alg: string): KemProvider;
  hasSigner(alg: string): boolean;
  hasKem(alg: string): boolean;
  listSigners(): string[];
  listKems(): string[];
}
```

<a id="available-providers"></a>

### 可用的提供者

| 提供者 | 算法 | 类型 |
|----------|-----------|------|
| `Ed25519Provider` | `ed25519` | 经典签名 |
| `MlDsa65Provider` | `ml-dsa-65` | 后量子签名（NIST ML-DSA） |
| `SlhDsa192fProvider` | `slh-dsa-192f` | 后量子签名（NIST SLH-DSA） |

<a id="cryptoprovider-interface"></a>

### `CryptoProvider` 接口

```typescript
interface CryptoProvider {
  readonly alg: string;
  readonly keySize: number;
  readonly sigSize: number;
  readonly isConstantTime: boolean;

  generateKeypair(): Promise<{
    kid: string;
    publicKeyB64: string;
    secretKeyB64: string;
  }>;
  sign(message: Uint8Array, secretKeyB64: string): Promise<Uint8Array>;
  verify(
    message: Uint8Array,
    signature: Uint8Array,
    publicKeyB64: string,
  ): Promise<boolean>;
}
```

---

<a id="version-detection"></a>

## 版本检测

### `detectDcpVersion(artifact)`

检测构件或 bundle 的 DCP 版本。

```typescript
function detectDcpVersion(artifact: Record<string, unknown>): '1.0' | '2.0' | null;
```

---

<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in"></a>
<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in-unreleased"></a>

## 实验性：规范化候选 `dcp-jcs-v2`（选择加入）

实验性，默认不启用：`dcp-jcs-v1` 仍是默认且唯一的规范性规范化配置，
常规的构建器、签名器和验证器都不变。这些导出只为选择加入的调用方提供；已验证的候选 bundle 不授予
信任或准入。完整契约见
[`docs/proposals/canonicalization-candidate`](proposals/canonicalization-candidate/README.md)（§15 入口、§16
路由器、§17 验证器、§18 生成器）。

```typescript
function experimentalCandidateIngress(bytes: Uint8Array): ExperimentalCandidateIngressResult;
function experimentalCandidateExtractUnit(bytes: Uint8Array, transport: ExperimentalCandidateTransport): ExperimentalCandidateExtraction;
function createExperimentalCandidateRouter(config: {
  transport: ExperimentalCandidateTransport;       // 'bare' | 'envelope'
  acceptedProfiles: readonly string[];             // no default
  historical: ExperimentalHistoricalAdapter;       // no default; see experimentalHistoricalAdapters
}): ExperimentalCandidateRouter;
function createExperimentalCandidateVerifier(config: {
  transport: ExperimentalCandidateTransport;
  acceptedProfiles: readonly string[];
  historical: ExperimentalHistoricalAdapter;
}): ExperimentalCandidateVerifier;                 // verify(bytes, registry, policy?, options?)
function experimentalCandidateSignPayload(
  registry: AlgorithmRegistry, context: string, input: ExperimentalCandidateInput, keys: ExperimentalCandidateKeys,
): Promise<{ bytes: Uint8Array; signedPayload: ExperimentalCandidateSignedPayload }>;
function experimentalCandidateSignBundle(
  registry: AlgorithmRegistry, parts: ExperimentalCandidateBundleParts, signer: ExperimentalCandidateBundleSigner,
  options: ExperimentalCandidateBundleOptions,
): Promise<{ bytes: Uint8Array; signedBundle: { [key: string]: ExperimentalCandidateValue } }>;
```

- `ExperimentalCandidateIngressResult`：`{ status: 'accept', value, canonical, canonicalSha256 }` 或
  `{ status: 'reject', class, offset }`。
- `verify` 返回 `{ route, entered, verification }`：路由（`reject`、`v1_path` 或 `candidate`）、
  所进入的验证器（`none`、`dcp-jcs-v1` 或 `dcp-jcs-v2`，至多一个），以及该验证器的原样结果。
- `ExperimentalCandidateInput` 为 `{ bytes }`（原始字节，由入口检查）或 `{ value }`（宿主
  值，严格检查）。
- `ExperimentalCandidateProduceError`（`class`、`part`、`path`、`offset`）表示因输入的取值域或形式而产生的拒绝，
  在调用任何签名器之前抛出；密钥、注册表和提供者的错误保持现状。
- 路由器和验证器的错误：`ExperimentalCandidateConfigError`（配置）、
  `ExperimentalCandidateAdapterError`（某个历史解码器因拒绝数据以外的原因而失败）以及
  `ExperimentalCandidateInternalError`。
