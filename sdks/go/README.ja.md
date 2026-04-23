<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · **日本語** · [Português](README.pt-BR.md)</sub>

# dcp-ai-go — Go SDK

デジタル市民権プロトコル (DCP) v1.0 および v2.0 の公式Go SDKです。Ed25519、ML-DSA-65、SLH-DSA-192f、ML-KEM-768、複合署名、デュアルハッシュチェーン、および完全なバンドル検証をサポートします。

## インストール

```bash
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp
```

**必要環境:** Go 1.21以上

## 機能

| 機能 | V1 | V2 |
|---------|----|----|
| Ed25519署名 | Yes | Yes |
| ML-DSA-65 (FIPS 204) | — | Yes |
| SLH-DSA-192f (FIPS 205) | — | Yes |
| ML-KEM-768 (FIPS 203) | — | Yes |
| 複合署名 (耐量子 over 古典) | — | Yes |
| ドメイン分離 | — | Yes |
| デュアルハッシュ (SHA-256 + SHA3-256) | — | Yes |
| バンドル検証 | Yes | Yes |
| バンドル構築と署名 | — | Yes |
| セキュリティティア計算 | — | Yes |
| 所有証明 | — | Yes |
| 鍵ローテーション | — | Yes |

## クイックスタート — V1

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

## クイックスタート — V2

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

### セキュリティティア

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

### ML-KEM-768 鍵カプセル化

```go
kem := &providers.MlKem768Provider{}
kp, _ := kem.GenerateKeypair()
result, _ := kem.Encapsulate(kp.PublicKeyB64)
sharedSecret, _ := kem.Decapsulate(result.CiphertextB64, kp.SecretKeyB64)
```

## V2 APIリファレンス

### バンドル構築と署名

| 関数 | 説明 |
|----------|-------------|
| `v2.BuildBundleV2(input)` | マニフェストハッシュとデュアルMerkleルート付きのV2バンドルを構築 |
| `v2.SignBundleV2(reg, bundle, classicalKey, pqKey)` | 複合または古典のみの署名でバンドルに署名 |
| `v2.VerifySignedBundleV2(reg, jsonBytes)` | V2バンドルの完全検証 (構造、ハッシュ、署名、監査チェーン) |

### セキュリティティア

| 関数 | 説明 |
|----------|-------------|
| `v2.ComputeSecurityTier(input)` | 適応型セキュリティティアを計算 (routine/standard/elevated/maximum) |

### 複合署名

| 関数 | 説明 |
|----------|-------------|
| `v2.CompositeSign(reg, ctx, payload, classicalKey, pqKey)` | 耐量子 over 古典の複合署名 |
| `v2.ClassicalOnlySign(reg, ctx, payload, key)` | 古典のみの移行モード |
| `v2.CompositeVerify(reg, ctx, payload, sig, classicalPK, pqPK)` | 複合署名を検証 |

### 暗号プロバイダ

| プロバイダ | アルゴリズム | 種別 | 標準 |
|----------|-----------|------|----------|
| `Ed25519Provider` | ed25519 | Signature | — |
| `MlDsa65Provider` | ml-dsa-65 | Signature | FIPS 204 |
| `SlhDsa192fProvider` | slh-dsa-192f | Signature | FIPS 205 |
| `MlKem768Provider` | ml-kem-768 | KEM | FIPS 203 |

### V1 API (変更なし)

| 関数 | 説明 |
|----------|-------------|
| `dcp.GenerateKeypair()` | Ed25519鍵ペア |
| `dcp.SignObject(obj, sk)` | オブジェクトに署名 |
| `dcp.VerifyObject(obj, sig, pk)` | 署名を検証 |
| `dcp.Canonicalize(obj)` | 決定論的JSON |
| `dcp.HashObject(obj)` | 正規化JSONのSHA-256 |
| `dcp.VerifySignedBundle(sb, pk)` | V1バンドル検証 |

### DCP-05–09 型

V2には、DCP-05からDCP-09までのすべての成果物のためのGo構造体が含まれます。

| Spec | 型 |
|------|-------|
| DCP-05 | `LifecycleState`、`CommissioningCertificate`、`VitalityReport`、`VitalityMetrics`、`DecommissioningRecord`、`TerminationMode`、`DataDisposition` |
| DCP-06 | `DigitalTestament`、`SuccessionRecord`、`MemoryTransferManifest`、`MemoryTransferEntry`、`SuccessorPreference`、`MemoryClassification`、`TransitionType`、`MemoryDisposition` |
| DCP-07 | `DisputeRecord`、`ArbitrationResolution`、`JurisprudenceBundle`、`ObjectionRecord`、`DisputeType`、`EscalationLevel`、`DisputeStatus`、`ObjectionType`、`AuthorityLevel` |
| DCP-08 | `RightsDeclaration`、`RightEntry`、`ObligationRecord`、`RightsViolationReport`、`RightType`、`ComplianceStatus` |
| DCP-09 | `DelegationMandate`、`AdvisoryDeclaration`、`PrincipalMirror`、`InteractionRecord`、`AwarenessThreshold`、`ThresholdRule`、`AuthorityScopeEntry` |

ドメイン分離コンテキスト: `CtxLifecycle`、`CtxSuccession`、`CtxDispute`、`CtxRights`、`CtxDelegation`、`CtxAwareness`

すべての構造体にはマーシャル/アンマーシャル用のJSONタグが付与されており、Goの命名規約に従います (オプションフィールドは `json:"field_name,omitempty"`)。

## 開発

```bash
go build ./...   # Build
go test ./...    # Tests (conformance + interop + unit)
go fmt ./...     # Format
go mod tidy      # Verify dependencies
```

### 依存関係

- `github.com/cloudflare/circl` — ML-DSA-65、SLH-DSA-192f、ML-KEM-768
- `golang.org/x/crypto` — SHA3-256

## ライセンス

Apache-2.0
