<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

# dcp-ai-go — SDK Go

SDK Go oficial para o Digital Citizenship Protocol (DCP) v1.0 e v2.0. Suporta Ed25519, ML-DSA-65, SLH-DSA-192f, ML-KEM-768, assinaturas compostas, cadeias de hash duplas e verificação completa de bundles (pacotes de cidadania).

## Instalação

```bash
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp
```

**Requer:** Go 1.25+

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
| DCP-04 descoberta A2A + handshake + sessão AES-256-GCM (stdlib; segura para uso concorrente, cada mensagem é aceita uma única vez dentro da janela) | — | Sim |
| DCP-05 ciclo de vida de agentes (commissioning / vitality / decommissioning) | — | Sim |
| DCP-06 sucessão digital (testamento digital, transferência de memória, cerimônia) | — | Sim |
| DCP-07 resolução de disputas + arbitragem + jurisprudência | — | Sim |
| DCP-08 direitos + obrigações + conformidade | — | Sim |
| DCP-09 delegação + cadeias de delegação verificáveis (`CreateSubMandate`, `VerifyMandateChain`) + limiar de consciência + espelho do principal | — | Sim |
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
        Passport:     sign(v2.CtxAgentPassport, map[string]interface{}{"agent_id": "a-1", "session_nonce": "nonce-1", "keys": keys, "status": "active", "principal_binding_reference": "rpr:alice"}),
        Intent:       sign(v2.CtxIntent, map[string]interface{}{"intent_id": "i-1", "session_nonce": "nonce-1", "agent_id": "a-1", "human_id": "rpr:alice"}),
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

### Níveis de Segurança

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
| `v2.SignPayload(reg, context, payload, classicalKey, pqKey)` | Assina um artefato como `SignedPayload` (composta, ou apenas clássica quando `pqKey` é nil) |
| `v2.BuildBundleV2(input)` | Constrói um bundle V2 a partir de artefatos assinados, com hashes de manifesto e Merkle roots duplos |
| `v2.SignBundleV2(reg, bundle, classicalKey, pqKey)` | Assina um bundle com assinatura composta ou apenas clássica; o signatário é o principal do bundle (`signer.id` = o `human_id` do RPR) |
| `v2.VerifySignedBundleV2(reg, jsonBytes)` | Verificação completa de bundle V2 (estrutura, hashes, assinaturas, cadeia de auditoria) com `DefaultVerifierPolicy`, contra o modo mais estrito entre o da política e o do nível de segurança (spec §14.3); informa `ResolvedTier` e `VerificationMode` |
| `v2.VerifySignedBundleV2WithPolicy(reg, jsonBytes, policy)` | O mesmo, com a sua própria `VerifierPolicy`; só `DefaultMode`, `RiskOverrides`, `MaxSessionDurationSeconds` e os campos da Fase 3 (`AdvisoryRejectedAlgs`, `WarnClassicalOnlyDeprecated`, `AllowClassicalFallbackDisable`, como no TypeScript) podem diferir de `DefaultVerifierPolicy()`, qualquer outra mudança faz a verificação falhar |

### Níveis de Segurança

| Função | Descrição |
|--------|-----------|
| `v2.ComputeSecurityTier(input)` | Calcula o nível de segurança adaptativo (routine/standard/elevated/maximum), seu modo de verificação e intervalo de checkpoint (spec §14.2); valores desconhecidos resultam em `elevated` |
| `v2.SecurityTierInputFromPayloads(intent, policyDecision)` | Monta a entrada do nível a partir dos payloads decodificados do intent e da PolicyDecision (`risk_score` vem da PolicyDecision; se faltar ou não for um inteiro de 0 a 1000, vira `RiskScore: -1`, que é desconhecido) |
| `v2.EffectiveVerificationMode(policyMode, tier)` | O modo mais estrito entre o da política e o do nível; `pq_only` não muda |

### Cadeias de Delegação (DCP-09 §3.5)

| Função | Descrição |
|--------|-----------|
| `v2.CreateDelegationMandate(reg, humanClassical, humanPQ, params)` | Mandato raiz assinado pelo humano; `SubDelegation` e `MinimumSecurityTier` são opcionais |
| `v2.CreateSubMandate(reg, delegatorClassical, delegatorPQ, parent, v2.SubMandateParams{...})` | Submandato assinado pelo agente do mandato pai sob o contexto `DCP-AI.v2.SubMandate` |
| `v2.VerifyMandateChain(reg, chain, revokedIDs, v2.MandateChainKeys{HumanKeys, AgentKeys}, now)` | Verifica a cadeia começando pela raiz e offline (assinaturas até o humano, vínculos e profundidade, `sub_delegation`, validade aninhada, atenuação de ações, `data_classes` e `limits`, piso de nível, revogação); retorna `MandateChainResult{Valid, Errors, Depth, EffectiveTier}` |

`SecurityTierInput.MandateChainTier` recebe o `EffectiveTier` da cadeia como um piso que só pode elevar o nível.

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
