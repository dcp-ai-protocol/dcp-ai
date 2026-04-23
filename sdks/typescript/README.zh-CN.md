<sub>[English](README.md) · **中文** · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

# @dcp-ai/sdk — DCP-AI v2.0 的 TypeScript SDK

数字公民身份协议 (DCP-AI) 的官方 TypeScript SDK。使用后量子混合 (经典 + 后量子) 密码学 (Ed25519 + ML-DSA-65)、复合签名、自适应安全等级、智能体间 (A2A) 通信、内置可观测性以及生产级加固来创建、签名和验证公民凭证包。

## 安装

```bash
npm install @dcp-ai/sdk
```

## 快速开始 (V1)

```typescript
import {
  BundleBuilder,
  signBundle,
  verifySignedBundle,
  generateKeypair,
} from '@dcp-ai/sdk';

const keys = generateKeypair();

const bundle = new BundleBuilder()
  .responsiblePrincipalRecord({ dcp_version: '1.0', human_id: 'human-001', /* ... */ })
  .agentPassport({ dcp_version: '1.0', agent_id: 'agent-001', /* ... */ })
  .intent({ dcp_version: '1.0', agent_id: 'agent-001', /* ... */ })
  .policyDecision({ dcp_version: '1.0', agent_id: 'agent-001', /* ... */ })
  .build();

const signed = signBundle(bundle, {
  secretKeyB64: keys.secretKeyB64,
  signerType: 'human',
  signerId: 'human-001',
});

const result = verifySignedBundle(signed, keys.publicKeyB64);
console.log(result); // { verified: true, errors: [] }
```

## 快速开始 (V2)

```typescript
import {
  BundleBuilderV2,
  signBundleV2,
  verifySignedBundleV2,
  generateKeypair,
  registerDefaultProviders,
  getDefaultRegistry,
  computeSecurityTier,
} from '@dcp-ai/sdk';

// Register PQ crypto providers
registerDefaultProviders();
const registry = getDefaultRegistry();

// Generate Ed25519 keypair (for classical signing)
const keys = generateKeypair();

// Build a V2 bundle with session nonce and security tier
const bundle = new BundleBuilderV2()
  .responsiblePrincipalRecord({ /* V2 RPR with keys[] */ })
  .agentPassport({ /* V2 passport with capabilities */ })
  .intent({ /* V2 intent with risk_score and security_tier */ })
  .policyDecision({ /* V2 policy with resolved_tier */ })
  .addAuditEntry({ /* V2 audit with dual-hash chain */ })
  .build();
```

## API 参考

### 核心加密 (V1)

| 函数 | 描述 |
|----------|-------------|
| `generateKeypair()` | 生成 Ed25519 密钥对 (`publicKeyB64`、`secretKeyB64`) |
| `signObject(obj, secretKeyB64)` | 对对象签名，返回 base64 签名 |
| `verifyObject(obj, signatureB64, publicKeyB64)` | 使用公钥验证签名 |
| `canonicalize(obj)` | 确定性（规范）JSON 序列化 |
| `publicKeyFromSecret(secretKeyB64)` | 从私钥派生公钥 |

### 加密 Provider (V2)

| 导出 | 描述 |
|--------|-------------|
| `Ed25519Provider` | 经典 Ed25519 签名 Provider |
| `MlDsa65Provider` | 后量子 ML-DSA-65 签名 Provider |
| `SlhDsa192fProvider` | 后量子 SLH-DSA-192f 签名 Provider |
| `AlgorithmRegistry` | 管理可用加密算法 Provider 的注册表 |
| `getDefaultRegistry()` | 返回单例算法注册表 |
| `registerDefaultProviders()` | 注册 Ed25519、ML-DSA-65 和 SLH-DSA-192f Provider |
| `deriveKid(publicKey, algorithm)` | 从公钥派生密钥标识符 |

### 复合签名 (V2)

| 函数 | 描述 |
|----------|-------------|
| `compositeSign(payload, keys, registry)` | 使用经典 + 后量子算法创建复合签名 |
| `compositeVerify(payload, signature, registry)` | 验证复合签名 |
| `classicalOnlySign(payload, keys, registry)` | 仅使用经典算法签名（回退模式） |

### 安全等级 (V2)

| 函数 | 描述 |
|----------|-------------|
| `computeSecurityTier(riskScore, flags)` | 从数值风险分数计算 `SecurityTier` |
| `maxTier(a, b)` | 返回两个安全等级中较高的一个 |
| `tierToVerificationMode(tier)` | 将等级映射为所需的验证模式 |
| `tierToCheckpointInterval(tier)` | 将等级映射为后量子检查点间隔 |

### 凭证包构建

| 导出 | 版本 | 描述 |
|--------|---------|-------------|
| `BundleBuilder` | V1 | V1 公民凭证包的流式构建器 |
| `BundleBuilderV2` | V2 | 带安全等级与双哈希的 V2 凭证包流式构建器 |
| `signBundle(bundle, options)` | V1 | 使用 Ed25519 签名 V1 凭证包 |
| `signBundleV2(bundle, keys, registry)` | V2 | 使用复合签名签名 V2 凭证包 |
| `signBundleV2ClassicalOnly(bundle, keys, registry)` | V2 | 以仅经典签名方式签名 V2 凭证包 |
| `verifySignedBundle(signedBundle, publicKeyB64)` | V1 | 验证 V1 已签名凭证包 |
| `verifySignedBundleV2(signedBundle, registry)` | V2 | 验证 V2 已签名凭证包（复合或经典） |

### 凭证包优化 (V2)

| 导出 | 描述 |
|--------|-------------|
| `suggestPresentationMode(context)` | 根据上下文推荐呈现模式 |
| `presentFull(bundle)` | 完整凭证包呈现（无省略） |
| `presentCompact(bundle)` | 精简呈现，裁剪审计轨迹 |
| `presentReference(bundle)` | 仅引用呈现（哈希，无负载） |
| `presentIncremental(bundle, since)` | 增量呈现（自某检查点以来的差异） |
| `VerificationCache` | 缓存验证结果以避免冗余加密工作 |

### 后量子检查点 (V2)

| 导出 | 描述 |
|--------|-------------|
| `PQCheckpointManager` | 管理周期性的后量子检查点创建 |
| `createPQCheckpoint(entries, keys, registry)` | 对审计条目创建后量子签名的检查点 |
| `auditEventsMerkleRoot(entries)` | 从审计条目计算 Merkle 根 |

### 双哈希 (V2)

| 函数 | 描述 |
|----------|-------------|
| `sha256Hex(data)` | SHA-256 哈希（十六进制字符串） |
| `sha3_256Hex(data)` | SHA3-256 哈希（十六进制字符串） |
| `dualHash(data)` | 返回 `{ sha256, sha3_256 }` 以用于抗量子双哈希 |
| `dualMerkleRoot(leaves)` | 使用双哈希叶子计算 Merkle 根 |

### A2A 协议 (DCP-04)

| 函数 | 描述 |
|----------|-------------|
| `createAgentDirectory()` | 创建一个内存中的智能体目录 |
| `findAgentByCapability(dir, cap)` | 在目录中按能力查找智能体 |
| `findAgentById(dir, id)` | 按 ID 查找智能体 |
| `createHello(agentId, capabilities)` | 创建 A2A Hello 握手消息 |
| `createWelcome(agentId, capabilities)` | 创建 A2A Welcome 响应消息 |
| `deriveSessionId(helloNonce, welcomeNonce)` | 从握手随机数派生会话 ID |
| `createCloseMessage(sessionId, reason)` | 创建会话关闭消息 |
| `createSession(id, key, local, remote, tier)` | 创建加密的 A2A 会话 |
| `encryptMessage(session, payload)` | 在 A2A 会话内加密消息 |
| `decryptMessage(session, encrypted)` | 在 A2A 会话内解密消息 |
| `needsRekeying(session)` | 检查会话是否需要密钥轮换 |
| `generateResumeProof(session)` | 为会话恢复生成证明 |
| `verifyResumeProof(session, proof)` | 验证会话恢复证明 |

### 可观测性

| 导出 | 描述 |
|--------|-------------|
| `dcpTelemetry` | 单例遥测实例 |
| `dcpTelemetry.init(config)` | 使用服务名与导出器初始化遥测 |
| `dcpTelemetry.startSpan(name)` | 启动一个命名的追踪跨度 (OpenTelemetry 跨度) |
| `dcpTelemetry.endSpan(span)` | 结束一个追踪跨度 (OpenTelemetry 跨度) |
| `dcpTelemetry.recordSignLatency(ms)` | 记录签名延迟指标 |
| `dcpTelemetry.getMetricsSummary()` | 返回聚合的指标摘要 |

### 生产级加固

| 导出 | 描述 |
|--------|-------------|
| `DcpErrorCode` | 结构化错误码枚举 |
| `DcpProtocolError` | 协议级故障的类型化错误类 |
| `createDcpError(code, message, context)` | 创建结构化 DCP 错误的工厂 |
| `isDcpError(err)` | `DcpProtocolError` 的类型守卫 |
| `RateLimiter` | 固定窗口限流器 |
| `AdaptiveRateLimiter` | 根据负载自适应调整的限流器 |
| `CircuitBreaker` | 用于外部调用的熔断器 |
| `withRetry(fn, options)` | 以退避重试异步函数 |

### 其他 V2

| 导出 | 描述 |
|--------|-------------|
| `generateSessionNonce()` | 生成加密的会话随机数 |
| `domainSeparatedMessage(domain, message)` | 为消息添加域分离前缀 |
| `generateEmergencyRevocationToken(keys)` | 生成预签名的紧急撤销令牌 |
| `buildEmergencyRevocation(token)` | 从令牌构建完整撤销记录 |
| `shamirSplit(secret, n, k)` | 将秘密分割为 `n` 份（阈值 `k`） |
| `shamirReconstruct(shares)` | 从 `k` 份秘密碎片重建秘密 |
| `CborEncoder` | CBOR 编码器类 |
| `CborDecoder` | CBOR 解码器类 |
| `cborEncode(value)` | 将值编码为 CBOR 字节 |
| `cborDecode(bytes)` | 将 CBOR 字节解码为值 |

### DCP-05–09：扩展协议模块

| 模块 | 规范 | 关键导出 |
|--------|------|-------------|
| `lifecycle` | DCP-05 | `LifecycleState`、`CommissioningCertificate`、`VitalityReport`、`DecommissioningRecord`、`VitalityMetrics`、`TerminationMode`、`DataDisposition` |
| `succession` | DCP-06 | `DigitalTestament`、`SuccessionRecord`、`MemoryTransferManifest`、`MemoryTransferEntry`、`MemoryClassification`、`SuccessorPreference`、`TransitionType`、`MemoryDisposition` |
| `conflict-resolution` | DCP-07 | `DisputeRecord`、`ObjectionRecord`、`DisputeType`、`DisputeStatus`、`EscalationLevel`、`ObjectionType` |
| `arbitration` | DCP-07 | `ArbitrationResolution`、`JurisprudenceBundle`、`AuthorityLevel` |
| `rights` | DCP-08 | `RightsDeclaration`、`RightEntry`、`ObligationRecord`、`RightsViolationReport`、`RightType`、`ComplianceStatus` |
| `delegation` | DCP-09 | `DelegationMandate`、`AdvisoryDeclaration`、`PrincipalMirror`、`InteractionRecord`、`AuthorityScopeEntry` |
| `awareness-threshold` | DCP-09 | `AwarenessThreshold`、`ThresholdRule`、`ThresholdOperator`、`ThresholdAction` |
| `principal-mirror` | DCP-09 | `PrincipalMirror`（带构建器工具的重新导出） |

```typescript
// Example: Lifecycle management
import { CommissioningCertificate, LifecycleState } from '@dcp-ai/sdk';

const cert: CommissioningCertificate = {
  certificate_id: 'cert-001',
  agent_id: 'agent-001',
  commissioned_by: 'human-001',
  commissioned_at: '2026-03-01T00:00:00Z',
  initial_state: 'commissioned',
  conditions: ['Must complete onboarding within 30 days'],
};

// Example: Delegation mandate
import { DelegationMandate, AwarenessThreshold } from '@dcp-ai/sdk';

const mandate: DelegationMandate = {
  mandate_id: 'mandate-001',
  principal_id: 'human-001',
  delegate_id: 'agent-001',
  authority_scope: [{ domain: 'email', actions: ['read', 'draft'], constraints: {} }],
  valid_from: '2026-03-01T00:00:00Z',
  valid_until: '2026-06-01T00:00:00Z',
};
```

## V2 类型

SDK 导出的关键类型：

- `SignedPayload` — 带复合签名元数据的已签名数据封装
- `CompositeSignature` — 包含经典 + 后量子签名组件
- `KeyEntry` — 带算法、kid 和密钥材料的公钥条目
- `SecurityTier` — `'basic' | 'elevated' | 'critical'`
- `VerifierPolicy` — 指定每个等级所需验证模式的策略
- `PQCheckpoint` — 针对审计条目的后量子检查点
- `A2ASession` — 加密的智能体间 (A2A) 会话状态
- `A2AMessage` — 加密的 A2A 消息信封
- `TelemetryConfig` — 可观测性子系统的配置

**DCP-05–09 类型：**

- `LifecycleState` — `'commissioned' | 'active' | 'declining' | 'decommissioned'`
- `CommissioningCertificate` — 带条件的智能体委任记录
- `VitalityReport` — 周期性健康与性能指标
- `DecommissioningRecord` — 带数据处置的生命终止记录
- `DigitalTestament` — 带记忆处置的继承规划
- `SuccessionRecord` — 已完成继任的记录
- `MemoryTransferManifest` — 分类记忆转移清单
- `DisputeRecord` — 带升级层级的冲突记录
- `ArbitrationResolution` — 带约束权威的仲裁结果
- `JurisprudenceBundle` — 争议解决的判例集合
- `RightsDeclaration` — 带合规跟踪的智能体权利
- `ObligationRecord` — 带执行状态的义务
- `RightsViolationReport` — 带严重程度的违规报告
- `DelegationMandate` — 范围化权威委派
- `AwarenessThreshold` — 人在回路的触发规则
- `PrincipalMirror` — 主体偏好快照

## A2A 协议

智能体间加密通信：

```typescript
import { createSession, encryptMessage, decryptMessage } from '@dcp-ai/sdk';

// Create encrypted A2A session
const session = createSession(sessionId, sessionKey, 'agent:a', 'agent:b', 'elevated');
const encrypted = encryptMessage(session, { action: 'negotiate', data: {...} });
const decrypted = decryptMessage(remoteSession, encrypted);
```

## 可观测性

所有加密操作都会被自动埋点：

```typescript
import { dcpTelemetry } from '@dcp-ai/sdk';

dcpTelemetry.init({ serviceName: 'my-agent', enabled: true, exporterType: 'console' });

// All crypto operations are automatically instrumented
const summary = dcpTelemetry.getMetricsSummary();
```

## 依赖

- `ajv` + `ajv-formats` — JSON Schema 验证
- `tweetnacl` + `tweetnacl-util` — Ed25519 密码学
- `json-stable-stringify` — 确定性 JSON
- `@noble/post-quantum` — ML-DSA-65 和 SLH-DSA 后量子签名

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

## 许可证

Apache-2.0
