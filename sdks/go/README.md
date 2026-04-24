<sub>**English** · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

# dcp-ai-go — Go SDK

Official Go SDK for the Digital Citizenship Protocol (DCP) v1.0 and v2.0. Supports Ed25519, ML-DSA-65, SLH-DSA-192f, ML-KEM-768, composite signatures, dual hash chains, and full bundle verification.

## Installation

```bash
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp
```

**Requires:** Go 1.21+

## Features

| Feature | V1 | V2 |
|---------|----|----|
| Ed25519 signatures | Yes | Yes |
| ML-DSA-65 (FIPS 204) | — | Yes |
| SLH-DSA-192f (FIPS 205) | — | Yes |
| ML-KEM-768 (FIPS 203) | — | Yes |
| Composite signatures (PQ over classical) | — | Yes |
| Domain separation | — | Yes |
| Dual hash (SHA-256 + SHA3-256) | — | Yes |
| Bundle verification | Yes | Yes |
| Bundle building & signing | — | Yes |
| Security tier computation | — | Yes |
| Proof of possession | — | Yes |
| Key rotation | — | Yes |
| DCP-04 A2A discovery + handshake + AES-256-GCM session (stdlib) | — | Yes |
| DCP-05 agent lifecycle (commissioning / vitality / decommissioning) | — | Yes |
| DCP-06 digital succession (testament, memory transfer, ceremony) | — | Yes |
| DCP-07 dispute resolution + arbitration + jurisprudence | — | Yes |
| DCP-08 rights + obligations + compliance | — | Yes |
| DCP-09 delegation + awareness threshold + principal mirror | — | Yes |
| Session nonce helpers, emergency revocation | — | Yes |
| Lazy PQ checkpoints + `PQCheckpointManager` | — | Yes |
| Blinded RPR, multi-party authorization, algorithm advisory helpers | — | Yes |
| Canonical error codes (38 shared across all SDKs) + `DetectWireFormat` | — | Yes |
| OpenTelemetry / OTLP exporter (build tag `otlp`) | — | Yes |

## Quickstart — V1

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

## Quickstart — V2

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

### Security Tiers

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

### ML-KEM-768 Key Encapsulation

```go
kem := &providers.MlKem768Provider{}
kp, _ := kem.GenerateKeypair()
result, _ := kem.Encapsulate(kp.PublicKeyB64)
sharedSecret, _ := kem.Decapsulate(result.CiphertextB64, kp.SecretKeyB64)
```

## V2 API Reference

### Bundle Building & Signing

| Function | Description |
|----------|-------------|
| `v2.BuildBundleV2(input)` | Constructs a V2 bundle with manifest hashes and dual Merkle roots |
| `v2.SignBundleV2(reg, bundle, classicalKey, pqKey)` | Signs a bundle with composite or classical-only signature |
| `v2.VerifySignedBundleV2(reg, jsonBytes)` | Full V2 bundle verification (structure, hashes, signatures, audit chain) |

### Security Tiers

| Function | Description |
|----------|-------------|
| `v2.ComputeSecurityTier(input)` | Computes adaptive security tier (routine/standard/elevated/maximum) |

### Composite Signatures

| Function | Description |
|----------|-------------|
| `v2.CompositeSign(reg, ctx, payload, classicalKey, pqKey)` | PQ-over-classical composite signature |
| `v2.ClassicalOnlySign(reg, ctx, payload, key)` | Classical-only transition mode |
| `v2.CompositeVerify(reg, ctx, payload, sig, classicalPK, pqPK)` | Verify composite signatures |

### Crypto Providers

| Provider | Algorithm | Type | Standard |
|----------|-----------|------|----------|
| `Ed25519Provider` | ed25519 | Signature | — |
| `MlDsa65Provider` | ml-dsa-65 | Signature | FIPS 204 |
| `SlhDsa192fProvider` | slh-dsa-192f | Signature | FIPS 205 |
| `MlKem768Provider` | ml-kem-768 | KEM | FIPS 203 |

### V1 API (unchanged)

| Function | Description |
|----------|-------------|
| `dcp.GenerateKeypair()` | Ed25519 keypair |
| `dcp.SignObject(obj, sk)` | Sign object |
| `dcp.VerifyObject(obj, sig, pk)` | Verify signature |
| `dcp.Canonicalize(obj)` | Deterministic JSON |
| `dcp.HashObject(obj)` | SHA-256 of canonical JSON |
| `dcp.VerifySignedBundle(sb, pk)` | V1 bundle verification |

### DCP-05–09 Types

V2 includes Go structs for all DCP-05 through DCP-09 artifacts:

| Spec | Types |
|------|-------|
| DCP-05 | `LifecycleState`, `CommissioningCertificate`, `VitalityReport`, `VitalityMetrics`, `DecommissioningRecord`, `TerminationMode`, `DataDisposition` |
| DCP-06 | `DigitalTestament`, `SuccessionRecord`, `MemoryTransferManifest`, `MemoryTransferEntry`, `SuccessorPreference`, `MemoryClassification`, `TransitionType`, `MemoryDisposition` |
| DCP-07 | `DisputeRecord`, `ArbitrationResolution`, `JurisprudenceBundle`, `ObjectionRecord`, `DisputeType`, `EscalationLevel`, `DisputeStatus`, `ObjectionType`, `AuthorityLevel` |
| DCP-08 | `RightsDeclaration`, `RightEntry`, `ObligationRecord`, `RightsViolationReport`, `RightType`, `ComplianceStatus` |
| DCP-09 | `DelegationMandate`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `AwarenessThreshold`, `ThresholdRule`, `AuthorityScopeEntry` |

Domain separation contexts: `CtxLifecycle`, `CtxSuccession`, `CtxDispute`, `CtxRights`, `CtxDelegation`, `CtxAwareness`

All structs include JSON tags for marshaling/unmarshaling and follow Go naming conventions (`json:"field_name,omitempty"` for optional fields).

## Development

```bash
go build ./...   # Build
go test ./...    # Tests (conformance + interop + unit)
go fmt ./...     # Format
go mod tidy      # Verify dependencies
```

### Dependencies

- `github.com/cloudflare/circl` — ML-DSA-65, SLH-DSA-192f, ML-KEM-768
- `golang.org/x/crypto` — SHA3-256

## License

Apache-2.0
