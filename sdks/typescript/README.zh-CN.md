<sub>[English](README.md) · **中文** · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="dcp-aisdk--typescript-sdk-for-dcp-ai-v20"></a>
<a id="dcp-aisdk-typescript-sdk-for-dcp-ai-v20"></a>

# @dcp-ai/sdk — DCP-AI v2.0 的 TypeScript SDK

> 本文是[英文版](README.md)的参考译文，更新于 26/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

Digital Citizenship Protocol（DCP-AI）的官方 TypeScript SDK。使用后量子混合密码学（Ed25519 + ML-DSA-65）、复合签名、自适应安全等级、智能体间（A2A）通信、内置可观测性和面向生产的加固，创建、签署并验证 Citizenship Bundle。

<a id="installation"></a>

## 安装

**已发布到 npm（2026 年 10 月 26 日）。** `@dcp-ai/sdk` 2.2.0 于该日以 `latest` 标签发布。它包含了 [SECURITY.md](../../SECURITY.md) 中的验证器修复、委托人信任与 `strict-v1`、委托链、A2A 接收窗口，以及实验性的 `dcp-jcs-v2` API。候选方案当时仍需显式启用且不具规范性，默认为 `dcp-jcs-v1`。以下示例使用自 2.2.0 起提供的 API。

**`@dcp-ai/sdk` 2.2.1。** 此版本还会在 [VERIFICATION.md 的 V2-11](../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) 中的二级 SHA3-256 字段存在时验证它们：`audit_merkle_root_secondary`、每个 `prev_hash_secondary` 和每个 `intent_hash_secondary`。不存在的字段不作要求，因此已验证的 bundle 可能没有完整的二级链；存在的字段如果是 `null`、不是字符串或不一致，则被拒绝。API、结果字段、`dcp-jcs-v1` 和 `hash_alg` 的处理均不变。2.2.0 不检查这些字段。下面的安装命令指定的是此版本；它在注册表中的可用情况见[已发布版本](../../docs/README.md#published-versions)。

```bash
npm install @dcp-ai/sdk@^2.2.1
```

所有软件包版本见 [npm 发布清单](../../docs/NPM_RELEASES.md)。

如需使用检出源码进行开发，请构建并安装本地软件包：

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai/sdks/typescript && npm install && npm run build
cd /path/to/your-project && npm install /path/to/dcp-ai/sdks/typescript
```

<a id="quick-start-v1"></a>

## 快速开始（V1）

用 Ed25519 签名的 V1 bundle。RPR 用委托人的密钥签名，护照用智能体的密钥签名，
二者都针对去掉 `signature` 字段后对象的规范 JSON；`createAuditEntry` 计算
`intent_hash` 和 `prev_hash` 链。`verifySignedBundle` 检查 bundle 签名、其哈希和
链，而不检查这些内部签名：请像下面这样自行检查。

```typescript
import { BundleBuilder, generateKeypair, signBundle, signObject, verifyObject, verifySignedBundle } from '@dcp-ai/sdk';
import type { AgentPassport, ResponsiblePrincipalRecord } from '@dcp-ai/sdk';

const now = new Date().toISOString();
const principalKeys = generateKeypair();
const agentKeys = generateKeypair();

// Each artifact is signed over the object without its `signature` field.
const rprBody: Omit<ResponsiblePrincipalRecord, 'signature'> = {
  dcp_version: '1.0', human_id: 'human:example-001', legal_name: 'Example Principal',
  entity_type: 'natural_person', jurisdiction: 'ES', liability_mode: 'owner_responsible',
  override_rights: true, issued_at: now, expires_at: null, contact: null,
};
const rpr: ResponsiblePrincipalRecord = { ...rprBody, signature: signObject(rprBody, principalKeys.secretKeyB64) };

const passportBody: Omit<AgentPassport, 'signature'> = {
  dcp_version: '1.0', agent_id: 'agent:example-001', public_key: agentKeys.publicKeyB64,
  principal_binding_reference: rpr.human_id, capabilities: ['browse', 'api_call'],
  risk_tier: 'low', created_at: now, status: 'active',
};
const passport: AgentPassport = { ...passportBody, signature: signObject(passportBody, agentKeys.secretKeyB64) };

const bundle = new BundleBuilder()
  .responsiblePrincipalRecord(rpr)
  .agentPassport(passport)
  .intent({
    dcp_version: '1.0', intent_id: 'intent:example-001', agent_id: passport.agent_id, human_id: rpr.human_id,
    timestamp: now, action_type: 'api_call', target: { channel: 'api', domain: 'api.example.com' },
    data_classes: ['none'], estimated_impact: 'low', requires_consent: false,
  })
  .policyDecision({
    dcp_version: '1.0', intent_id: 'intent:example-001', decision: 'approve', risk_score: 0.05,
    reasons: ['low-impact call'], required_confirmation: null,
  })
  .createAuditEntry({
    dcp_version: '1.0', audit_id: 'audit:example-001', timestamp: now, agent_id: passport.agent_id,
    human_id: rpr.human_id, intent_id: 'intent:example-001', policy_decision: 'approved',
    outcome: 'call_completed', evidence: { tool: 'http', result_ref: null },
  })
  .build();

const signed = signBundle(bundle, { secretKeyB64: principalKeys.secretKeyB64, signerType: 'human', signerId: rpr.human_id });
console.log(verifySignedBundle(signed, principalKeys.publicKeyB64)); // { verified: true }

// The inner signatures, over the same objects without `signature`
console.log(verifyObject(rprBody, rpr.signature, principalKeys.publicKeyB64)); // true
console.log(verifyObject(passportBody, passport.signature, agentKeys.publicKeyB64)); // true
```

<a id="quick-start-v2"></a>

## 快速开始（V2）

使用混合签名（Ed25519 + ML-DSA-65）的 V2 bundle：每个构件都是一个 `SignedPayload`
（`{ payload, payload_hash, composite_sig }`），在其域分离上下文下签名；委托人签署
RPR 和清单，智能体签署护照、意图和策略决定。

```typescript
import {
  AlgorithmRegistry, BundleBuilderV2, DCP_CONTEXTS, Ed25519Provider, MlDsa65Provider, compositeSign,
  generateSessionNonce, preparePayload, sha256Hex, canonicalizeV2, signBundleV2, verifySignedBundleV2,
} from '@dcp-ai/sdk';
import type {
  AgentPassportV2, AuditEventV2, CompositeKeyPair, DcpContext, IntentV2, KeyEntry, PolicyDecisionV2,
  ResponsiblePrincipalRecordV2, SignedPayload,
} from '@dcp-ai/sdk';

const registry = new AlgorithmRegistry();
const ed25519 = new Ed25519Provider();
const mlDsa65 = new MlDsa65Provider();
registry.registerSigner(ed25519);
registry.registerSigner(mlDsa65);

async function hybridKeys(): Promise<CompositeKeyPair> {
  const c = await ed25519.generateKeypair();
  const p = await mlDsa65.generateKeypair();
  return {
    classical: { kid: c.kid, alg: 'ed25519', secretKeyB64: c.secretKeyB64, publicKeyB64: c.publicKeyB64 },
    pq: { kid: p.kid, alg: 'ml-dsa-65', secretKeyB64: p.secretKeyB64, publicKeyB64: p.publicKeyB64 },
  };
}
const keyEntries = (keys: CompositeKeyPair): KeyEntry[] => [keys.classical, keys.pq].map((k) => ({
  kid: k.kid, alg: k.alg, public_key_b64: k.publicKeyB64, created_at: '2026-01-01T00:00:00Z', expires_at: null, status: 'active',
}));
const sha256Of = (value: unknown) => `sha256:${sha256Hex(new TextEncoder().encode(canonicalizeV2(value)))}`;
async function signed<T>(payload: T, context: DcpContext, keys: CompositeKeyPair): Promise<SignedPayload<T>> {
  const { canonicalBytes, payloadHash } = preparePayload(payload);
  return { payload, payload_hash: payloadHash, composite_sig: await compositeSign(registry, context, canonicalBytes, keys) };
}

const principal = await hybridKeys();
const agent = await hybridKeys();
const nonce = generateSessionNonce();
const now = new Date().toISOString();

const rpr: ResponsiblePrincipalRecordV2 = {
  dcp_version: '2.0', human_id: 'human:example-001', session_nonce: nonce, legal_name: 'Example Principal',
  entity_type: 'natural_person', jurisdiction: 'ES', liability_mode: 'owner_responsible', override_rights: true,
  issued_at: now, expires_at: null, contact: null, binding_keys: keyEntries(principal),
};
const passport: AgentPassportV2 = {
  dcp_version: '2.0', agent_id: 'agent:example-001', session_nonce: nonce, keys: keyEntries(agent),
  principal_binding_reference: rpr.human_id, capabilities: ['browse', 'api_call'], risk_tier: 'low',
  created_at: now, status: 'active',
};
const intent: IntentV2 = {
  dcp_version: '2.0', intent_id: 'intent:example-001', session_nonce: nonce, agent_id: passport.agent_id,
  human_id: rpr.human_id, timestamp: now, action_type: 'api_call', target: { channel: 'api', domain: 'api.example.com' },
  data_classes: ['none'], estimated_impact: 'low', requires_consent: false,
};
const policy: PolicyDecisionV2 = {
  dcp_version: '2.0', intent_id: intent.intent_id, session_nonce: nonce, decision: 'approve', risk_score: 50,
  reasons: ['low-impact call'], required_confirmation: null, applied_policy_hash: sha256Of({ policy: 'default' }), timestamp: now,
};
const audit: AuditEventV2 = {
  dcp_version: '2.0', audit_id: 'audit:example-001', session_nonce: nonce, prev_hash: 'GENESIS', hash_alg: 'sha256',
  timestamp: now, agent_id: passport.agent_id, human_id: rpr.human_id, intent_id: intent.intent_id,
  intent_hash: sha256Of(intent), policy_decision: 'approved', outcome: 'call_completed',
  evidence: { tool: 'http', result_ref: null, evidence_hash: null }, pq_checkpoint_ref: null,
};

const bundle = new BundleBuilderV2(nonce)
  .responsiblePrincipalRecord(await signed(rpr, DCP_CONTEXTS.ResponsiblePrincipal, principal))
  .agentPassport(await signed(passport, DCP_CONTEXTS.AgentPassport, agent))
  .intent(await signed(intent, DCP_CONTEXTS.Intent, agent))
  .policyDecision(await signed(policy, DCP_CONTEXTS.PolicyDecision, agent))
  .addAuditEntry(audit)
  .build();

const signedBundle = await signBundleV2(bundle, { registry, signerType: 'human', signerId: rpr.human_id, keys: principal });
const result = await verifySignedBundleV2(signedBundle, registry);
console.log(result.verified, result.errors); // true []
```

<a id="api-reference"></a>

## API 参考

<a id="core-crypto-v1"></a>

### 核心密码学（V1）

| 函数 | 说明 |
|----------|-------------|
| `generateKeypair()` | 生成 Ed25519 密钥对（`publicKeyB64`、`secretKeyB64`） |
| `signObject(obj, secretKeyB64)` | 对对象签名，返回 base64 签名 |
| `verifyObject(obj, signatureB64, publicKeyB64)` | 用公钥验证签名 |
| `canonicalize(obj)` | 确定性（规范）JSON 序列化 |
| `publicKeyFromSecret(secretKeyB64)` | 从私钥导出公钥 |

<a id="crypto-providers-v2"></a>

### 密码学提供者（V2）

| 导出 | 说明 |
|--------|-------------|
| `Ed25519Provider` | 经典 Ed25519 签名提供者 |
| `MlDsa65Provider` | 后量子 ML-DSA-65 签名提供者 |
| `SlhDsa192fProvider` | 后量子 SLH-DSA-192f 签名提供者 |
| `AlgorithmRegistry` | 管理可用密码算法提供者的注册表 |
| `getDefaultRegistry()` | 返回单例算法注册表 |
| `registerDefaultProviders()` | 注册 Ed25519、ML-DSA-65 和 SLH-DSA-192f 提供者 |
| `deriveKid(alg, publicKeyBytes)` | 从公钥导出密钥标识符 |

<a id="composite-signatures-v2"></a>

### 复合签名（V2）

| 函数 | 说明 |
|----------|-------------|
| `compositeSign(registry, context, canonicalPayloadBytes, keys)` | 用经典 + PQ 算法创建复合签名 |
| `compositeVerify(registry, context, canonicalPayloadBytes, compositeSig, classicalPubkeyB64, pqPubkeyB64?, strategy?)` | 验证复合签名 |
| `classicalOnlySign(registry, context, canonicalPayloadBytes, key)` | 仅用经典算法签名（回退模式） |

<a id="security-tiers-v2"></a>

### 安全等级（V2）

| 函数 | 说明 |
|----------|-------------|
| `computeSecurityTier(intent, policyDecision?, mandateChainTier?)` | 根据意图和策略决定中的 `risk_score`（规范 §14.2）计算 `SecurityTier`（routine、standard、elevated、maximum）；已验证的委托链的 `effective_tier` 只能提高它；未知值以失败即关闭方式定为 `elevated` |
| `maxTier(a, b)` | 返回两个安全等级中较高的一个 |
| `tierToVerificationMode(tier)` | 将等级映射为所需的验证模式 |
| `tierToCheckpointInterval(tier)` | 将等级映射为 PQ 检查点间隔 |

<a id="bundle-building"></a>

### 构建 bundle

| 导出 | 版本 | 说明 |
|--------|---------|-------------|
| `BundleBuilder` | V1 | V1 Citizenship Bundle 的链式构建器 |
| `BundleBuilderV2` | V2 | 带安全等级和双哈希的 V2 bundle 链式构建器 |
| `signBundle(bundle, options)` | V1 | 用 Ed25519 签署 V1 bundle |
| `signBundleV2(bundle, options)` | V2 | 用复合签名签署 V2 bundle |
| `signBundleV2ClassicalOnly(bundle, options)` | V2 | 仅用经典签名签署 V2 bundle |
| `verifySignedBundle(signedBundle, publicKeyB64)` | V1 | 验证已签名的 V1 bundle |
| `verifySignedBundleV2(signedBundle, registry, policy?)` | V2 | 按策略模式与安全等级模式中较严格者验证已签名的 V2 bundle（复合或经典）；报告 `resolved_tier` |

<a id="bundle-optimization-v2"></a>

### bundle 优化（V2）

| 导出 | 说明 |
|--------|-------------|
| `suggestPresentationMode(tier, opts)` | 根据安全等级以及是首次接触还是已有信任关系，推荐一种呈现模式 |
| `presentFull(bundle)` | 完整呈现 bundle（无省略） |
| `presentCompact(bundle, pqCheckpointRef)` | 紧凑呈现：去掉 PQ 签名，改为引用最近的 PQ 检查点 |
| `presentReference(bundle, verificationEndpoint)` | 仅引用的呈现：bundle 哈希、会话 nonce，以及用于验证或获取完整 bundle 的端点 |
| `presentIncremental(baseBundle, updatedBundle, baseAuditCount)` | 相对于已验证基础 bundle 的增量呈现：新的审计条目、PQ 检查点、更新后的清单和签名 |
| `VerificationCache` | 仅按 bundle 哈希缓存验证结果：不区分租户或策略，命中时也不重新检查信任、吊销或会话，因此在准入或其他上下文中请重新验证。`invalidateByAgent` 目前不会删除任何内容；请使用 `invalidateByKid` 或 `clear()`（[详情](../../docs/API_REFERENCE.md#verificationcache)） |

<a id="pq-checkpoints-v2"></a>

### PQ 检查点（V2）

| 导出 | 说明 |
|--------|-------------|
| `PQCheckpointManager` | 管理后量子检查点的定期创建 |
| `createPQCheckpoint(registry, events, sessionNonce, keys)` | 针对审计条目创建 PQ 签名的检查点 |
| `auditEventsMerkleRoot(events)` | 根据审计条目计算 Merkle 根 |

<a id="dual-hash-v2"></a>

### 双哈希（V2）

| 函数 | 说明 |
|----------|-------------|
| `sha256Hex(data)` | SHA-256 哈希（十六进制字符串） |
| `sha3_256Hex(data)` | SHA3-256 哈希（十六进制字符串） |
| `dualHash(data)` | 返回 `{ sha256, sha3_256 }`，用于抗量子的双哈希 |
| `dualMerkleRoot(leaves)` | 使用双哈希叶子计算 Merkle 根 |

<a id="a2a-protocol-dcp-04"></a>

### A2A 协议（DCP-04）

| 函数 | 说明 |
|----------|-------------|
| `createAgentDirectory(organization, agents)` | 创建内存中的智能体目录 |
| `findAgentByCapability(directory, requiredCapabilities)` | 在目录中按能力查找智能体 |
| `findAgentById(directory, agentId)` | 按 ID 查找智能体 |
| `createHello(initiatorBundle, kemPublicKeyB64, requestedCapabilities, securityTier)` | 创建 A2A 握手的 Hello 消息 |
| `createWelcome(responderBundle, kemPublicKeyB64, kemCiphertextB64, resolvedTier)` | 创建 A2A Welcome 响应消息 |
| `deriveSessionId(agentIdA, agentIdB, nonceA, nonceB, sessionKey)` | 根据握手 nonce 导出会话 ID |
| `createCloseMessage(sessionId, reason, finalSequence, auditSummaryHash)` | 创建会话关闭消息 |
| `createSession(sessionId, sessionKey, localAgentId, remoteAgentId, securityTier, rekeyingInterval?)` | 创建加密的 A2A 会话 |
| `encryptMessage(session, payload)` | 在 A2A 会话中加密消息 |
| `decryptMessage(session, message)` | 在 A2A 会话中解密消息；在 1000 条消息的窗口内，每个序号只接受一次（DCP-04 §8.4） |
| `needsRekeying(session)` | 检查会话是否需要密钥轮换 |
| `generateResumeProof(session, lastSeenSequence)` | 生成会话恢复证明 |
| `verifyResumeProof(session, lastSeenSequence, proof)` | 验证会话恢复证明 |

<a id="observability"></a>

### 可观测性

| 导出 | 说明 |
|--------|-------------|
| `dcpTelemetry` | 单例遥测实例 |
| `dcpTelemetry.init(config)` | 用服务名和导出器初始化遥测 |
| `dcpTelemetry.startSpan(name)` | 开始一个具名的追踪 span |
| `dcpTelemetry.endSpan(span)` | 结束追踪 span |
| `dcpTelemetry.recordSignLatency(ms)` | 记录签名延迟指标 |
| `dcpTelemetry.getMetricsSummary()` | 返回汇总的指标摘要 |

<a id="production-hardening"></a>

### 面向生产的加固

| 导出 | 说明 |
|--------|-------------|
| `DcpErrorCode` | 结构化错误码枚举 |
| `DcpProtocolError` | 用于协议层面失败的类型化错误类 |
| `createDcpError(code, details?)` | 创建结构化 DCP 错误的工厂函数 |
| `isDcpError(error)` | `DcpProtocolError` 的类型守卫 |
| `RateLimiter` | 固定窗口的限流器 |
| `AdaptiveRateLimiter` | 根据负载调整的限流器 |
| `CircuitBreaker` | 用于外部调用的熔断器 |
| `withRetry(fn, config?)` | 以退避方式重试异步函数 |

<a id="other-v2"></a>

### 其他 V2

| 导出 | 说明 |
|--------|-------------|
| `generateSessionNonce()` | 生成密码学会话 nonce |
| `domainSeparatedMessage(context, canonicalPayloadBytes)` | 为消息加上域分隔前缀 |
| `generateEmergencyRevocationToken()` | 生成吊销秘密值及其 `sha256:` 令牌承诺 |
| `buildEmergencyRevocation({ agentId, humanId, revocationSecret })` | 根据吊销秘密值构建紧急吊销请求 |
| `shamirSplit(secret, threshold, totalShares)` | 将秘密值拆分为 `totalShares` 份；其中任意 `threshold` 份即可重建 |
| `shamirReconstruct(shares)` | 用至少 `threshold` 份重建秘密值 |
| `generatePiiSalt()` | 生成 `pii_salt`（32 个随机字节的十六进制表示）。在签署 RPR 之前设置它并将其保密：`blindRpr` 会从盲化记录中省略它，但完整 RPR 仍保留它 |
| `blindRpr(rpr)` | 用加盐的哈希承诺替换 RPR 的个人信息（`legal_name`、`contact`）；如果 `rpr.pii_salt` 缺失或格式错误则抛出异常 |
| `verifyBlindedRpr(fullRpr, blindedRpr)` | 检查盲化的 RPR 是否与完整记录相符；`warnings` 会标出旧的未加盐承诺 |
| `isBlindedRpr(rpr)` | `BlindedResponsiblePrincipalRecordV2` 的类型守卫 |
| `computePiiHash(rpr)` | 计算 RPR 个人信息字段和 `pii_salt` 的哈希承诺（没有 `pii_salt` 时为已弃用的未加盐值） |
| `CborEncoder` | CBOR 编码器类 |
| `CborDecoder` | CBOR 解码器类 |
| `cborEncode(value)` | 将值编码为 CBOR 字节 |
| `cborDecode(data)` | 将 CBOR 字节解码为值 |

<a id="admission-trusted-principals-and-strict-v1"></a>
<a id="admission-trusted-principals-and-strict-v1-unreleased"></a>

### 准入：Trusted Principals 与 strict-v1

已验证的 bundle 是由其列出的密钥签署的；这并不能证明委托人是谁。只有当委托人签名是用你的信任集合中列出的某个委托人的密钥做出时，准入才会接受该 bundle；还可以选择在由运营方固定的 `strict-v1` 配置下进行（混合签名、已签名的受众、最长 300 秒的会话、新近的吊销快照）。

```typescript
// Fragment, not a complete program: trustSetJson and the strict-v1 settings come from operator configuration, signedBundle from the request, snapshot from your revocation source, registry as in the V2 Quick Start.
import { admitSignedBundleV2, createPrincipalTrustStore, resolveStrictV1Profile } from '@dcp-ai/sdk';

const trust = createPrincipalTrustStore(trustSetJson); // AdmissionConfigError on a bad trust set
const profile = resolveStrictV1Profile({ profile: 'strict-v1', verifier_id: 'api.acme.example' });
const result = await admitSignedBundleV2(signedBundle, registry, { profile, trust, revocation: snapshot });
// result.verified, result.principal_trust, result.profile_compliance, result.admitted,
// result.action_authorized (always false), result.errors [{ code, message }]
```

- `verifySignedBundleV2(bundle, registry, policy, { now })` 接受一个可选的时钟，并报告 `details.signer_keys`；不提供时行为与以前相同。
- `evaluateAdmissionV2` 评估你已有的验证结果（不做密码学运算，也没有 I/O）；`revocationSubjects` 列出吊销信息源必须回答的对象。
- 指南：[`docs/ADMISSION.md`](../../docs/ADMISSION.md)。规范和代码：[`spec/profiles/admission`](../../spec/profiles/admission/README.md)。

<a id="delegation-chains-dcp-09-35"></a>
<a id="delegation-chains-dcp-09-35-unreleased"></a>

### 委托链（DCP-09 §3.5）

人类通过根委托书委托给一个智能体；该智能体可以用它自己签署的子委托书，将部分权限转交给另一个智能体，
如此继续。每一跳只能缩小它所收到的权限，整条链
都可以离线一直验证到人类。

| 函数 | 说明 |
|----------|-------------|
| `createDelegationMandate(registry, humanKeys, params)` | 由人类签署的根委托书（`human_composite_sig`）；`sub_delegation` 和 `minimum_security_tier` 为可选 |
| `createSubMandate(registry, delegatorKeys, parent, params)` | 由父级的智能体签署的子委托书（`delegator_composite_sig`，`DCP-AI.v2.SubMandate` 上下文） |
| `verifyMandateChain(registry, chain, revokedIds, keys, now?)` | 从根开始验证链：直到人类的签名、与父级的链接和深度、`sub_delegation`、嵌套的有效期窗口、权限收窄（操作、`data_classes` 和 `limits` 只能缩小）、安全等级下限以及吊销；返回 `{ valid, errors, depth, effective_tier }` |

```typescript
// Fragment, not a complete program: registry and nonce as in the V2 Quick Start; rootMandate, orchestratorKeys and the key entries come from your delegation setup; intent and policyDecision are the V2 payloads.
import { createSubMandate, verifyMandateChain, computeSecurityTier } from '@dcp-ai/sdk';

const sub = await createSubMandate(registry, orchestratorKeys, rootMandate, {
  mandate_id: 'mandate:sub-1',
  session_nonce: nonce,
  agent_id: 'agent:subagent',
  authority_scope: [{ domain: 'email', actions_permitted: ['read'], data_classes: ['contact_info'], limits: { max_messages_per_day: 10 } }],
  valid_from: '2026-03-01T00:00:00Z',
  valid_until: '2026-06-01T00:00:00Z',
  revocable: true,
});

const result = await verifyMandateChain(registry, [rootMandate, sub], new Set(), {
  human_keys: humanKeyEntries,
  agent_keys: { 'agent:orchestrator': orchestratorKeyEntries },
});
// The chain's tier floor can only raise the tier of an action taken under it.
const tier = computeSecurityTier(intent, policyDecision, result.valid ? result.effective_tier : null);
```

<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in"></a>
<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in-unreleased"></a>

### 实验性：规范化候选 `dcp-jcs-v2`（选择加入）

非规范性，也未启用：`dcp-jcs-v1` 仍是唯一的规范化配置，任何默认值、
构建器、签名器或验证器都不变。这些 API 只为显式选择使用它们的调用方提供，npm SDK 2.2.0 也是如此。已验证的候选 bundle 不授予信任或准入。设计、规则和完整
契约：[`docs/proposals/canonicalization-candidate`](../../docs/proposals/canonicalization-candidate/README.md)
（§15 入口、§16 路由器、§17 验证器、§18 生成器）。

| 导出 | 说明 |
|--------|-------------|
| `experimentalCandidateIngress(bytes)` | 检查一个单元的原始字节：`{ status: 'accept', value, canonical, canonicalSha256 }` 或 `{ status: 'reject', class, offset }` |
| `experimentalCandidateExtractUnit(bytes, transport)` | 从 `bare` 或 `envelope` 传输中提取单元 |
| `createExperimentalCandidateRouter(config)` | 对字节进行路由：`reject`、`v1_path`（通过一个具名的历史解码器）或 `candidate` |
| `createExperimentalCandidateVerifier(config).verify(bytes, registry, policy?, options?)` | 从原始字节出发，至多用一个验证器验证：`dcp-jcs-v1` 用当前的验证器，候选用只接受 `dcp-jcs-v2` 的当前验证器 |
| `experimentalHistoricalAdapters` | 经过测量的解码器（`bufferUtf8JsonParse`、`textDecoderJsonParse`）；都不是默认值 |
| `experimentalCandidateSignPayload(registry, context, input, keys)` | 根据 `{ bytes }` 或 `{ value }` 签署一个构件；不带配置 |
| `experimentalCandidateSignBundle(registry, parts, signer, options)` | 组装并签署一个清单中指定 `dcp-jcs-v2` 的 bundle |
| `ExperimentalCandidateProduceError` | 因输入的取值域或形式而产生的拒绝，在调用任何签名器之前抛出（`class`、`part`、`path`、`offset`）；密钥、注册表和提供者的错误保持现状 |

```typescript
import {
  AlgorithmRegistry, DCP_CONTEXTS, Ed25519Provider, MlDsa65Provider, experimentalCandidateIngress,
  experimentalCandidateSignPayload,
} from '@dcp-ai/sdk';

// The ingress decides on the original bytes: 1.0 is the integer 1, members are sorted.
const accepted = experimentalCandidateIngress(new TextEncoder().encode('{"b":1.0,"a":[]}'));
if (accepted.status === 'accept') console.log(new TextDecoder().decode(accepted.canonical)); // {"a":[],"b":1}
const refused = experimentalCandidateIngress(new TextEncoder().encode('{"a":1,"a":2}'));
if (refused.status === 'reject') console.log(refused.class, refused.offset); // DUPLICATE_KEY 7

// A producer signs an artifact from those bytes (hybrid keys, today's composite signature).
const registry = new AlgorithmRegistry();
const ed25519 = new Ed25519Provider();
const mlDsa65 = new MlDsa65Provider();
registry.registerSigner(ed25519);
registry.registerSigner(mlDsa65);
const c = await ed25519.generateKeypair();
const p = await mlDsa65.generateKeypair();
const keys = {
  classical: { kid: c.kid, alg: 'ed25519', secretKeyB64: c.secretKeyB64, publicKeyB64: c.publicKeyB64 },
  pq: { kid: p.kid, alg: 'ml-dsa-65', secretKeyB64: p.secretKeyB64, publicKeyB64: p.publicKeyB64 },
};
const artifact = await experimentalCandidateSignPayload(
  registry, DCP_CONTEXTS.Intent, { bytes: new TextEncoder().encode('{"intent_id":"intent:1","risk":1.0}') }, keys,
);
console.log(artifact.signedPayload.payload_hash); // sha256:… of {"intent_id":"intent:1","risk":1}
```

<a id="dcp-0509-extended-protocol-modules"></a>

### DCP-05–09：扩展协议模块

| 模块 | 规范 | 主要导出 |
|--------|------|-------------|
| `lifecycle` | DCP-05 | `LifecycleState`, `CommissioningCertificate`, `VitalityReport`, `DecommissioningRecord`, `VitalityMetrics`, `TerminationMode`, `DataDisposition` |
| `succession` | DCP-06 | `DigitalTestament`, `SuccessionRecord`, `MemoryTransferManifest`, `MemoryTransferEntry`, `MemoryClassification`, `SuccessorPreference`, `TransitionType`, `MemoryDisposition` |
| `conflict-resolution` | DCP-07 | `DisputeRecord`, `ObjectionRecord`, `DisputeType`, `DisputeStatus`, `EscalationLevel`, `ObjectionType` |
| `arbitration` | DCP-07 | `ArbitrationResolution`, `JurisprudenceBundle`, `AuthorityLevel` |
| `rights` | DCP-08 | `RightsDeclaration`, `RightEntry`, `ObligationRecord`, `RightsViolationReport`, `RightType`, `ComplianceStatus` |
| `delegation` | DCP-09 | `DelegationMandate`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `AuthorityScopeEntry` |
| `awareness-threshold` | DCP-09 | `AwarenessThreshold`, `ThresholdRule`, `ThresholdOperator`, `ThresholdAction` |
| `principal-mirror` | DCP-09 | `PrincipalMirror`（带构建工具的重新导出） |

```typescript
// Fragment, not a complete program: registry, humanKeys (the principal's CompositeKeyPair) and nonce as in the V2 Quick Start.
// Example: Lifecycle management (DCP-05), signed with the commissioning human's composite keys
import { createCommissioningCertificate, validateStateTransition } from '@dcp-ai/sdk';
import type { CommissioningCertificate } from '@dcp-ai/sdk';

const cert: CommissioningCertificate = await createCommissioningCertificate(registry, humanKeys, {
  agent_id: 'agent:agent-001',
  session_nonce: nonce,
  human_id: 'human:human-001',
  commissioning_authority: 'human:human-001',
  purpose: 'Customer support triage',
  initial_capabilities: ['browse', 'api_call'],
  risk_tier: 'low',
  principal_binding_reference: 'human:human-001',
});
validateStateTransition('commissioned', 'active'); // true

// Example: Delegation mandate (signed by the human)
import { createDelegationMandate } from '@dcp-ai/sdk';

const mandate = await createDelegationMandate(registry, humanKeys, {
  mandate_id: 'mandate-001',
  session_nonce: nonce,
  human_id: 'rpr:human-001',
  agent_id: 'agent:agent-001',
  authority_scope: [{ domain: 'email', actions_permitted: ['read', 'draft'], limits: { max_messages_per_day: 50 } }],
  valid_from: '2026-03-01T00:00:00Z',
  valid_until: '2026-06-01T00:00:00Z',
  revocable: true,
});
```

<a id="v2-types"></a>

## V2 类型

SDK 导出的主要类型：

- `SignedPayload` — 带复合签名元数据的已签名数据包装
- `CompositeSignature` — 包含经典 + PQ 签名分量
- `KeyEntry` — 带算法、kid 和密钥材料的公钥条目
- `SecurityTier` — `'routine' | 'standard' | 'elevated' | 'maximum'`
- `VerifierPolicy` — 验证器策略：默认模式和按 `risk_tier` 的覆盖；安全等级只能让模式更严格
- `PQCheckpoint` — 针对审计条目的后量子检查点
- `A2ASession` — 加密的智能体间会话状态
- `A2AMessage` — 加密的 A2A 消息信封
- `TelemetryConfig` — 可观测性子系统的配置

**DCP-05–09 类型：**

- `LifecycleState` — `'commissioned' | 'active' | 'declining' | 'decommissioned'`
- `CommissioningCertificate` — 带条件的智能体启用记录
- `VitalityReport` — 定期的健康和性能指标
- `DecommissioningRecord` — 包含数据处置的停用记录
- `DigitalTestament` — 包含记忆处置的继承规划
- `SuccessionRecord` — 已完成继承的记录
- `MemoryTransferManifest` — 分类后的记忆转移清单
- `DisputeRecord` — 带升级级别的冲突记录
- `ArbitrationResolution` — 带约束性权威的仲裁结果
- `JurisprudenceBundle` — 用于解决争议的判例集合
- `RightsDeclaration` — 带合规跟踪的智能体权利
- `ObligationRecord` — 带履行状态的义务
- `RightsViolationReport` — 带严重程度的违规报告
- `DelegationMandate` — 有范围限定的权限委托
- `AwarenessThreshold` — 触发人工介入（human-in-the-loop）的规则
- `PrincipalMirror` — 委托人偏好的快照

<a id="a2a-protocol"></a>

## A2A 协议

智能体间的加密通信：

```typescript
// Fragment, not a complete program: sessionId and sessionKey come from the A2A handshake, remoteSession is the peer's session.
import { createSession, encryptMessage, decryptMessage } from '@dcp-ai/sdk';

// Create encrypted A2A session
const session = createSession(sessionId, sessionKey, 'agent:a', 'agent:b', 'elevated');
const encrypted = encryptMessage(session, { action: 'negotiate', data: { offer: 10 } });
const decrypted = decryptMessage(remoteSession, encrypted);
// The same message delivered again throws: each sequence is accepted once.
```

<a id="observability-1"></a>
<a id="observability_1"></a>

## 可观测性

遥测需要显式埋点：在要观测的操作前后调用 span 和指标方法。仅初始化遥测并不会自动为密码学操作埋点。此示例只初始化遥测并读取当前汇总：

```typescript
import { dcpTelemetry } from '@dcp-ai/sdk';

dcpTelemetry.init({ serviceName: 'my-agent', enabled: true, exporterType: 'console' });

// Read metrics explicitly recorded so far; initialization alone records no crypto operations
const summary = dcpTelemetry.getMetricsSummary();
```

<a id="dependencies"></a>

## 依赖

- `ajv` + `ajv-formats` — JSON Schema 验证
- `tweetnacl` + `tweetnacl-util` — Ed25519 密码学
- `json-stable-stringify` — 确定性 JSON
- `@noble/post-quantum` — ML-DSA-65 和 SLH-DSA 后量子签名

<a id="development"></a>

## 开发

```bash
# Install dependencies
npm install

# Build (ESM + CJS + types)
npm run build

# Tests with Vitest
npm test
npm run test:watch
npm run test:coverage

# Type check
npm run lint
```

<a id="license"></a>

## 许可证

Apache-2.0
