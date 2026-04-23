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

    // Generate keypairs
    edKeys, _ := (&providers.Ed25519Provider{}).GenerateKeypair()
    pqKeys, _ := (&providers.MlDsa65Provider{}).GenerateKeypair()

    // Build a V2 bundle
    bundle, _ := v2.BuildBundleV2(v2.BundleBuildInput{
        RPR:          map[string]interface{}{"human_id": "h-1", "session_nonce": "nonce-1"},
        Passport:     map[string]interface{}{"agent_id": "a-1", "session_nonce": "nonce-1"},
        Intent:       map[string]interface{}{"intent_id": "i-1", "session_nonce": "nonce-1"},
        Policy:       map[string]interface{}{"intent_id": "i-1", "session_nonce": "nonce-1", "risk_score": 200},
        AuditEntries: []interface{}{},
        SessionNonce: "nonce-1",
    })

    // Sign with composite (Ed25519 + ML-DSA-65)
    pqKey := v2.CompositeKeyInfo{Kid: pqKeys.Kid, Alg: "ml-dsa-65", SecretKeyB64: pqKeys.SecretKeyB64}
    signed, _ := v2.SignBundleV2(reg, bundle, v2.CompositeKeyInfo{
        Kid: edKeys.Kid, Alg: "ed25519", SecretKeyB64: edKeys.SecretKeyB64,
    }, &pqKey)

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
    RiskScore:   600,
    DataClasses: []string{"financial"},
    ActionType:  "payment",
})
fmt.Println(tier.Tier)               // "elevated"
fmt.Println(tier.VerificationMode)   // "hybrid_required"
fmt.Println(tier.CheckpointInterval) // 1
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
| `v2.BuildBundleV2(input)` | 构建带清单哈希和双 Merkle 根的 V2 凭证包 |
| `v2.SignBundleV2(reg, bundle, classicalKey, pqKey)` | 使用复合或仅经典签名签名凭证包 |
| `v2.VerifySignedBundleV2(reg, jsonBytes)` | 完整的 V2 凭证包验证（结构、哈希、签名、审计链） |

### 安全等级

| 函数 | 描述 |
|----------|-------------|
| `v2.ComputeSecurityTier(input)` | 计算自适应安全等级 (routine/standard/elevated/maximum) |

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
