<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

# dcp-ai-go — SDK Go

SDK Go oficial para o Digital Citizenship Protocol (DCP) v1.0 e v2.0. Suporta Ed25519, ML-DSA-65, SLH-DSA-192f, ML-KEM-768, assinaturas compostas, cadeias de hash duplas e verificação completa de bundles (pacotes de cidadania).

## Instalação

```bash
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp
```

**Requer:** Go 1.21+

## Funcionalidades

| Funcionalidade | V1 | V2 |
|----------------|----|----|
| Assinaturas Ed25519 | Sim | Sim |
| ML-DSA-65 (FIPS 204) | — | Sim |
| SLH-DSA-192f (FIPS 205) | — | Sim |
| ML-KEM-768 (FIPS 203) | — | Sim |
| Assinaturas compostas (PQ sobre clássica) | — | Sim |
| Separação de domínio | — | Sim |
| Dual hash (SHA-256 + SHA3-256) | — | Sim |
| Verificação de bundle | Sim | Sim |
| Construção e assinatura de bundle | — | Sim |
| Cálculo de nível de segurança | — | Sim |
| Prova de posse | — | Sim |
| Rotação de chaves | — | Sim |
| DCP-04 descoberta A2A + handshake + sessão AES-256-GCM (stdlib) | — | Sim |
| DCP-05 ciclo de vida de agentes (commissioning / vitality / decommissioning) | — | Sim |
| DCP-06 sucessão digital (testamento digital, transferência de memória, cerimônia) | — | Sim |
| DCP-07 resolução de disputas + arbitragem + jurisprudência | — | Sim |
| DCP-08 direitos + obrigações + conformidade | — | Sim |
| DCP-09 delegação + limiar de consciência + espelho do principal | — | Sim |
| Helpers de nonce de sessão, revogação de emergência | — | Sim |
| Checkpoints PQ lazy + `PQCheckpointManager` | — | Sim |
| Helpers de RPR blindado, autorização multi-parte, advisory de algoritmo | — | Sim |
| Códigos de erro canônicos (38 compartilhados entre todos os SDKs) + `DetectWireFormat` | — | Sim |
| Exportador OpenTelemetry / OTLP (build tag `otlp`) | — | Sim |

## Início Rápido — V1

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

## Início Rápido — V2

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

### Níveis de Segurança

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

### Encapsulamento de Chave ML-KEM-768

```go
kem := &providers.MlKem768Provider{}
kp, _ := kem.GenerateKeypair()
result, _ := kem.Encapsulate(kp.PublicKeyB64)
sharedSecret, _ := kem.Decapsulate(result.CiphertextB64, kp.SecretKeyB64)
```

## Referência de API V2

### Construção e Assinatura de Bundle

| Função | Descrição |
|--------|-----------|
| `v2.BuildBundleV2(input)` | Constrói um bundle V2 com hashes de manifesto e Merkle roots duplos |
| `v2.SignBundleV2(reg, bundle, classicalKey, pqKey)` | Assina um bundle com assinatura composta ou apenas clássica |
| `v2.VerifySignedBundleV2(reg, jsonBytes)` | Verificação completa de bundle V2 (estrutura, hashes, assinaturas, cadeia de auditoria) |

### Níveis de Segurança

| Função | Descrição |
|--------|-----------|
| `v2.ComputeSecurityTier(input)` | Calcula o nível de segurança adaptativo (routine/standard/elevated/maximum) |

### Assinaturas Compostas

| Função | Descrição |
|--------|-----------|
| `v2.CompositeSign(reg, ctx, payload, classicalKey, pqKey)` | Assinatura composta PQ-sobre-clássico |
| `v2.ClassicalOnlySign(reg, ctx, payload, key)` | Modo de transição apenas clássico |
| `v2.CompositeVerify(reg, ctx, payload, sig, classicalPK, pqPK)` | Verifica assinaturas compostas |

### Provedores de Criptografia

| Provedor | Algoritmo | Tipo | Padrão |
|----------|-----------|------|--------|
| `Ed25519Provider` | ed25519 | Assinatura | — |
| `MlDsa65Provider` | ml-dsa-65 | Assinatura | FIPS 204 |
| `SlhDsa192fProvider` | slh-dsa-192f | Assinatura | FIPS 205 |
| `MlKem768Provider` | ml-kem-768 | KEM | FIPS 203 |

### API V1 (inalterada)

| Função | Descrição |
|--------|-----------|
| `dcp.GenerateKeypair()` | Par de chaves Ed25519 |
| `dcp.SignObject(obj, sk)` | Assina objeto |
| `dcp.VerifyObject(obj, sig, pk)` | Verifica assinatura |
| `dcp.Canonicalize(obj)` | JSON determinístico |
| `dcp.HashObject(obj)` | SHA-256 do JSON canônico |
| `dcp.VerifySignedBundle(sb, pk)` | Verificação de bundle V1 |

### Tipos DCP-05–09

V2 inclui structs Go para todos os artefatos de DCP-05 a DCP-09:

| Spec | Tipos |
|------|-------|
| DCP-05 | `LifecycleState`, `CommissioningCertificate`, `VitalityReport`, `VitalityMetrics`, `DecommissioningRecord`, `TerminationMode`, `DataDisposition` |
| DCP-06 | `DigitalTestament`, `SuccessionRecord`, `MemoryTransferManifest`, `MemoryTransferEntry`, `SuccessorPreference`, `MemoryClassification`, `TransitionType`, `MemoryDisposition` |
| DCP-07 | `DisputeRecord`, `ArbitrationResolution`, `JurisprudenceBundle`, `ObjectionRecord`, `DisputeType`, `EscalationLevel`, `DisputeStatus`, `ObjectionType`, `AuthorityLevel` |
| DCP-08 | `RightsDeclaration`, `RightEntry`, `ObligationRecord`, `RightsViolationReport`, `RightType`, `ComplianceStatus` |
| DCP-09 | `DelegationMandate`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `AwarenessThreshold`, `ThresholdRule`, `AuthorityScopeEntry` |

Contextos de separação de domínio: `CtxLifecycle`, `CtxSuccession`, `CtxDispute`, `CtxRights`, `CtxDelegation`, `CtxAwareness`

Todas as structs incluem tags JSON para marshaling/unmarshaling e seguem as convenções de nomenclatura do Go (`json:"field_name,omitempty"` para campos opcionais).

## Desenvolvimento

```bash
go build ./...   # Build
go test ./...    # Tests (conformance + interop + unit)
go fmt ./...     # Format
go mod tidy      # Verify dependencies
```

### Dependências

- `github.com/cloudflare/circl` — ML-DSA-65, SLH-DSA-192f, ML-KEM-768
- `golang.org/x/crypto` — SHA3-256

## Licença

Apache-2.0
