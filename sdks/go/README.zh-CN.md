<sub>[English](README.md) · **中文** · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

# dcp-ai-go — Go SDK

数字公民身份协议 (DCP) v1.0 和 v2.0 的官方 Go SDK。支持 Ed25519、ML-DSA-65、SLH-DSA-192f、ML-KEM-768、复合签名、双哈希链，以及完整的凭证包验证。

## 安装

```bash
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp
```

**需要：** Go 1.21+

## 特性

| 特性 | V1 | V2 |
|---------|----|----|
| Ed25519 签名 | 是 | 是 |
| ML-DSA-65 (FIPS 204) | — | 是 |
| SLH-DSA-192f (FIPS 205) | — | 是 |
| ML-KEM-768 (FIPS 203) | — | 是 |
| 复合签名（后量子覆盖经典） | — | 是 |
| 域分离 | — | 是 |
| 双哈希 (SHA-256 + SHA3-256) | — | 是 |
| 凭证包验证 | 是 | 是 |
| 凭证包构建与签名 | — | 是 |
| 安全等级计算 | — | 是 |
| 持有证明 | — | 是 |
| 密钥轮换 | — | 是 |
| DCP-04 A2A 发现 + 握手 + AES-256-GCM 会话（标准库） | — | 是 |
| DCP-05 代理生命周期（委任 / 活力 / 停用） | — | 是 |
| DCP-06 数字继承（数字遗嘱、记忆迁移、交接仪式） | — | 是 |
| DCP-07 争议解决 + 仲裁 + 判例 | — | 是 |
| DCP-08 权利与义务 + 合规 | — | 是 |
| DCP-09 委托 + 感知阈值 + 主体镜像 | — | 是 |
| 会话随机数助手、紧急撤销 | — | 是 |
| 惰性 PQ 检查点 + `PQCheckpointManager` | — | 是 |
| 盲化 RPR、多方授权、算法建议助手 | — | 是 |
| 规范错误码（38 项，跨所有 SDK 共享）+ `DetectWireFormat` | — | 是 |
| OpenTelemetry / OTLP 导出器（构建标签 `otlp`） | — | 是 |

## 快速开始 — V1

```go
package main

import (
    "fmt"
    "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp"
)

func main() {
    keys, _ := dcp.GenerateKeypair()
    obj := map[string]interface{}{"agent_id": "agent-001", "action": "api_call"}
    sig, _ := dcp.SignObject(obj, keys.SecretKeyB64)
    ok, _ := dcp.VerifyObject(obj, sig, keys.PublicKeyB64)
    fmt.Println("Verified:", ok) // true
}
```

## 快速开始 — V2

```go
package main

import (
    "encoding/json"
    "fmt"

    v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
    "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/providers"
)

func main() {
    // Set up algorithm registry
    reg := v2.NewAlgorithmRegistry()
    reg.RegisterSigner(&providers.Ed25519Provider{})
    reg.RegisterSigner(&providers.MlDsa65Provider{})
    reg.RegisterKem(&providers.MlKem768Provider{})

    // Generate keypairs (here one pair signs for both the principal and the agent)
    edKeys, _ := (&providers.Ed25519Provider{}).GenerateKeypair()
    pqKeys, _ := (&providers.MlDsa65Provider{}).GenerateKeypair()
    classicalKey := v2.CompositeKeyInfo{Kid: edKeys.Kid, Alg: "ed25519", SecretKeyB64: edKeys.SecretKeyB64, PublicKeyB64: edKeys.PublicKeyB64}
    pqKey := v2.CompositeKeyInfo{Kid: pqKeys.Kid, Alg: "ml-dsa-65", SecretKeyB64: pqKeys.SecretKeyB64, PublicKeyB64: pqKeys.PublicKeyB64}
    keys := []interface{}{
        map[string]interface{}{"kid": edKeys.Kid, "alg": "ed25519", "public_key_b64": edKeys.PublicKeyB64, "status": "active"},
        map[string]interface{}{"kid": pqKeys.Kid, "alg": "ml-dsa-65", "public_key_b64": pqKeys.PublicKeyB64, "status": "active"},
    }

    // Sign each artifact under its own context (Ed25519 + ML-DSA-65)
    sign := func(context string, payload map[string]interface{}) v2.SignedPayload {
        sp, _ := v2.SignPayload(reg, context, payload, classicalKey, &pqKey)
        return sp
    }

    // Build a V2 bundle from the signed artifacts
    bundle, _ := v2.BuildBundleV2(v2.BundleBuildInput{
        RPR:          sign(v2.CtxResponsiblePrincipal, map[string]interface{}{"human_id": "rpr:alice", "session_nonce": "nonce-1", "binding_keys": keys}),
        Passport:     sign(v2.CtxAgentPassport, map[string]interface{}{"agent_id": "a-1", "session_nonce": "nonce-1", "keys": keys}),
        Intent:       sign(v2.CtxIntent, map[string]interface{}{"intent_id": "i-1", "session_nonce": "nonce-1"}),
        Policy:       sign(v2.CtxPolicyDecision, map[string]interface{}{"intent_id": "i-1", "session_nonce": "nonce-1", "risk_score": 200}),
        AuditEntries: []v2.AuditEventV2{},
        SessionNonce: "nonce-1",
    })

    // Sign the manifest with a composite signature
    signed, _ := v2.SignBundleV2(reg, bundle, classicalKey, &pqKey)

    // Verify
    data, _ := json.Marshal(signed)
    result := v2.VerifySignedBundleV2(reg, data)
    fmt.Println("Verified:", result.Verified)
    fmt.Println("Classical:", result.ClassicalValid, "PQ:", result.PQValid)
}
```

### 安全等级

```go
tier := v2.ComputeSecurityTier(v2.SecurityTierInput{
    RiskScore:       600, // from the bundle's PolicyDecision, never the intent
    DataClasses:     []string{"financial_data"},
    ActionType:      "initiate_payment",
    EstimatedImpact: "high",
})
fmt.Println(tier.Tier)               // "elevated"
fmt.Println(tier.VerificationMode)   // "hybrid_required"
fmt.Println(tier.CheckpointInterval) // 1

// From decoded intent and PolicyDecision payloads (map[string]interface{}):
tier = v2.ComputeSecurityTier(v2.SecurityTierInputFromPayloads(intentPayload, policyPayload))
```

### ML-KEM-768 密钥封装

```go
kem := &providers.MlKem768Provider{}
kp, _ := kem.GenerateKeypair()
result, _ := kem.Encapsulate(kp.PublicKeyB64)
sharedSecret, _ := kem.Decapsulate(result.CiphertextB64, kp.SecretKeyB64)
```

## V2 API 参考

### 凭证包构建与签名

| 函数 | 描述 |
|----------|-------------|
| `v2.SignPayload(reg, context, payload, classicalKey, pqKey)` | 将工件签名为 `SignedPayload`（复合签名；`pqKey` 为 nil 时仅经典签名） |
| `v2.BuildBundleV2(input)` | 由已签名的工件构建 V2 凭证包，含清单哈希和双 Merkle 根 |
| `v2.SignBundleV2(reg, bundle, classicalKey, pqKey)` | 使用复合或仅经典签名签名凭证包 |
| `v2.VerifySignedBundleV2(reg, jsonBytes)` | 完整的 V2 凭证包验证（结构、哈希、签名、审计链），使用 `DefaultVerifierPolicy`，按策略模式与安全等级模式中更严格的一个验证（spec §14.3）；返回 `ResolvedTier` 和 `VerificationMode` |
| `v2.VerifySignedBundleV2WithPolicy(reg, jsonBytes, policy)` | 相同，但使用自定义 `VerifierPolicy`；只有 `DefaultMode`、`RiskOverrides` 和 Phase 3 字段（`AdvisoryRejectedAlgs`、`WarnClassicalOnlyDeprecated`、`AllowClassicalFallbackDisable`，语义与 TypeScript 相同）可以与 `DefaultVerifierPolicy()` 不同，其他任何改动都会使验证失败 |

### 安全等级

| 函数 | 描述 |
|----------|-------------|
| `v2.ComputeSecurityTier(input)` | 计算自适应安全等级（routine/standard/elevated/maximum）及其验证模式和检查点间隔（spec §14.2）；未知值按 `elevated` 处理 |
| `v2.SecurityTierInputFromPayloads(intent, policyDecision)` | 根据解码后的 intent 和 PolicyDecision 载荷构建等级输入（`risk_score` 取自 PolicyDecision；缺失或不是 0 到 1000 之间的整数时为 `RiskScore: -1`，即未知） |
| `v2.EffectiveVerificationMode(policyMode, tier)` | 策略模式与等级模式中更严格的一个；`pq_only` 不变 |

### 复合签名

| 函数 | 描述 |
|----------|-------------|
| `v2.CompositeSign(reg, ctx, payload, classicalKey, pqKey)` | 后量子覆盖经典的复合签名 |
| `v2.ClassicalOnlySign(reg, ctx, payload, key)` | 仅经典签名过渡模式 |
| `v2.CompositeVerify(reg, ctx, payload, sig, classicalPK, pqPK)` | 验证复合签名 |

### 加密 Provider

| Provider | 算法 | 类型 | 标准 |
|----------|-----------|------|----------|
| `Ed25519Provider` | ed25519 | 签名 | — |
| `MlDsa65Provider` | ml-dsa-65 | 签名 | FIPS 204 |
| `SlhDsa192fProvider` | slh-dsa-192f | 签名 | FIPS 205 |
| `MlKem768Provider` | ml-kem-768 | KEM | FIPS 203 |

### V1 API（未变）

| 函数 | 描述 |
|----------|-------------|
| `dcp.GenerateKeypair()` | Ed25519 密钥对 |
| `dcp.SignObject(obj, sk)` | 对对象签名 |
| `dcp.VerifyObject(obj, sig, pk)` | 验证签名 |
| `dcp.Canonicalize(obj)` | 确定性 JSON |
| `dcp.HashObject(obj)` | 规范 JSON 的 SHA-256 |
| `dcp.VerifySignedBundle(sb, pk)` | V1 凭证包验证 |

### DCP-05–09 类型

V2 包含针对 DCP-05 至 DCP-09 全部工件的 Go struct：

| 规范 | 类型 |
|------|-------|
| DCP-05 | `LifecycleState`、`CommissioningCertificate`、`VitalityReport`、`VitalityMetrics`、`DecommissioningRecord`、`TerminationMode`、`DataDisposition` |
| DCP-06 | `DigitalTestament`、`SuccessionRecord`、`MemoryTransferManifest`、`MemoryTransferEntry`、`SuccessorPreference`、`MemoryClassification`、`TransitionType`、`MemoryDisposition` |
| DCP-07 | `DisputeRecord`、`ArbitrationResolution`、`JurisprudenceBundle`、`ObjectionRecord`、`DisputeType`、`EscalationLevel`、`DisputeStatus`、`ObjectionType`、`AuthorityLevel` |
| DCP-08 | `RightsDeclaration`、`RightEntry`、`ObligationRecord`、`RightsViolationReport`、`RightType`、`ComplianceStatus` |
| DCP-09 | `DelegationMandate`、`AdvisoryDeclaration`、`PrincipalMirror`、`InteractionRecord`、`AwarenessThreshold`、`ThresholdRule`、`AuthorityScopeEntry` |

域分离上下文：`CtxLifecycle`、`CtxSuccession`、`CtxDispute`、`CtxRights`、`CtxDelegation`、`CtxAwareness`

所有 struct 包含 JSON 标签用于序列化/反序列化，并遵循 Go 命名约定（可选字段使用 `json:"field_name,omitempty"`）。

## 开发

```bash
go build ./...   # Build
go test ./...    # Tests (conformance + interop + unit)
go fmt ./...     # Format
go mod tidy      # Verify dependencies
```

### 依赖

- `github.com/cloudflare/circl` — ML-DSA-65、SLH-DSA-192f、ML-KEM-768
- `golang.org/x/crypto` — SHA3-256

## 许可证

Apache-2.0
