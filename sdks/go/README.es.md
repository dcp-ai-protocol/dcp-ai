<sub>[English](README.md) · [中文](README.zh-CN.md) · **Español** · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

# dcp-ai-go — SDK Go

SDK oficial de Go para el Digital Citizenship Protocol (DCP) v1.0 y v2.0. Soporta Ed25519, ML-DSA-65, SLH-DSA-192f, ML-KEM-768, firmas compuestas, cadenas duales de hash y verificación completa de bundles.

## Instalación

```bash
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp
```

**Requiere:** Go 1.21+

## Características

| Característica | V1 | V2 |
|---------|----|----|
| Firmas Ed25519 | Sí | Sí |
| ML-DSA-65 (FIPS 204) | — | Sí |
| SLH-DSA-192f (FIPS 205) | — | Sí |
| ML-KEM-768 (FIPS 203) | — | Sí |
| Firmas compuestas (post-cuántico sobre clásico) | — | Sí |
| Separación de dominio | — | Sí |
| Hash dual (SHA-256 + SHA3-256) | — | Sí |
| Verificación de bundle | Sí | Sí |
| Construcción y firma de bundle | — | Sí |
| Cálculo del nivel de seguridad | — | Sí |
| Proof of possession | — | Sí |
| Rotación de claves | — | Sí |
| Descubrimiento A2A DCP-04 + handshake + sesión AES-256-GCM (stdlib) | — | Sí |
| Ciclo de vida de agente DCP-05 (commissioning / vitalidad / decommissioning) | — | Sí |
| Sucesión digital DCP-06 (testamento, transferencia de memoria, ceremonia) | — | Sí |
| Resolución de disputas + arbitraje + jurisprudencia DCP-07 | — | Sí |
| Derechos + obligaciones + compliance DCP-08 | — | Sí |
| Delegación + umbral de conciencia + espejo del principal DCP-09 | — | Sí |
| Helpers de nonce de sesión, revocación de emergencia | — | Sí |
| Checkpoints PQ perezosos + `PQCheckpointManager` | — | Sí |
| RPR blinded, autorización multi-parte, helpers de aviso de algoritmo | — | Sí |
| Códigos de error canónicos (38 compartidos entre todos los SDKs) + `DetectWireFormat` | — | Sí |
| Exportador OpenTelemetry / OTLP (build tag `otlp`) | — | Sí |

## Inicio Rápido — V1

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

## Inicio Rápido — V2

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

### Niveles de Seguridad

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

### Encapsulación de Clave ML-KEM-768

```go
kem := &providers.MlKem768Provider{}
kp, _ := kem.GenerateKeypair()
result, _ := kem.Encapsulate(kp.PublicKeyB64)
sharedSecret, _ := kem.Decapsulate(result.CiphertextB64, kp.SecretKeyB64)
```

## Referencia de API V2

### Construcción y Firma del Bundle

| Función | Descripción |
|----------|-------------|
| `v2.BuildBundleV2(input)` | Construye un bundle V2 con hashes del manifiesto y raíces duales de Merkle |
| `v2.SignBundleV2(reg, bundle, classicalKey, pqKey)` | Firma un bundle con firma compuesta o solo clásica |
| `v2.VerifySignedBundleV2(reg, jsonBytes)` | Verificación completa de bundle V2 (estructura, hashes, firmas, cadena de auditoría) |

### Niveles de Seguridad

| Función | Descripción |
|----------|-------------|
| `v2.ComputeSecurityTier(input)` | Calcula el nivel de seguridad adaptativo (routine/standard/elevated/maximum) |

### Firmas Compuestas

| Función | Descripción |
|----------|-------------|
| `v2.CompositeSign(reg, ctx, payload, classicalKey, pqKey)` | Firma compuesta post-cuántico sobre clásico |
| `v2.ClassicalOnlySign(reg, ctx, payload, key)` | Modo de transición solo clásico |
| `v2.CompositeVerify(reg, ctx, payload, sig, classicalPK, pqPK)` | Verifica firmas compuestas |

### Crypto Providers

| Provider | Algoritmo | Tipo | Estándar |
|----------|-----------|------|----------|
| `Ed25519Provider` | ed25519 | Firma | — |
| `MlDsa65Provider` | ml-dsa-65 | Firma | FIPS 204 |
| `SlhDsa192fProvider` | slh-dsa-192f | Firma | FIPS 205 |
| `MlKem768Provider` | ml-kem-768 | KEM | FIPS 203 |

### API V1 (sin cambios)

| Función | Descripción |
|----------|-------------|
| `dcp.GenerateKeypair()` | Par de claves Ed25519 |
| `dcp.SignObject(obj, sk)` | Firma objeto |
| `dcp.VerifyObject(obj, sig, pk)` | Verifica firma |
| `dcp.Canonicalize(obj)` | JSON determinístico |
| `dcp.HashObject(obj)` | SHA-256 del JSON canónico |
| `dcp.VerifySignedBundle(sb, pk)` | Verificación de bundle V1 |

### Tipos DCP-05–09

V2 incluye structs Go para todos los artefactos de DCP-05 a DCP-09:

| Spec | Tipos |
|------|-------|
| DCP-05 | `LifecycleState`, `CommissioningCertificate`, `VitalityReport`, `VitalityMetrics`, `DecommissioningRecord`, `TerminationMode`, `DataDisposition` |
| DCP-06 | `DigitalTestament`, `SuccessionRecord`, `MemoryTransferManifest`, `MemoryTransferEntry`, `SuccessorPreference`, `MemoryClassification`, `TransitionType`, `MemoryDisposition` |
| DCP-07 | `DisputeRecord`, `ArbitrationResolution`, `JurisprudenceBundle`, `ObjectionRecord`, `DisputeType`, `EscalationLevel`, `DisputeStatus`, `ObjectionType`, `AuthorityLevel` |
| DCP-08 | `RightsDeclaration`, `RightEntry`, `ObligationRecord`, `RightsViolationReport`, `RightType`, `ComplianceStatus` |
| DCP-09 | `DelegationMandate`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `AwarenessThreshold`, `ThresholdRule`, `AuthorityScopeEntry` |

Contextos de separación de dominio: `CtxLifecycle`, `CtxSuccession`, `CtxDispute`, `CtxRights`, `CtxDelegation`, `CtxAwareness`

Todos los structs incluyen tags JSON para marshal/unmarshal y siguen las convenciones de nombres de Go (`json:"field_name,omitempty"` para campos opcionales).

## Desarrollo

```bash
go build ./...   # Build
go test ./...    # Tests (conformance + interop + unit)
go fmt ./...     # Format
go mod tidy      # Verify dependencies
```

### Dependencias

- `github.com/cloudflare/circl` — ML-DSA-65, SLH-DSA-192f, ML-KEM-768
- `golang.org/x/crypto` — SHA3-256

## Licencia

Apache-2.0
