<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

<a id="dcp-ai-go-go-sdk"></a>

<a id="dcp-ai-go--go-sdk"></a>

# dcp-ai-go — SDK Go

**Publicação Go (26/10/2026).** O SDK Go `v2.11.0` está disponível pela tag `sdks/go/v2.11.0`, incluindo correções do verificador, admissão e APIs experimentais opt-in. A publicação Rust continua independente. Veja [Go v2.11.0](../../docs/GO_RELEASE.md).

> Tradução informativa do [README em inglês](README.md), atualizada em 29/10/2026. Identificadores e blocos de código, incluindo comentários, são preservados no idioma original para manter os exemplos verificados.

SDK oficial em Go para o Digital Citizenship Protocol (DCP) v1.0 e v2.0. Suporta Ed25519, ML-DSA-65, SLH-DSA-192f, ML-KEM-768, assinaturas compostas, cadeias de hash duplas e verificação de bundles.

A verificação confere a integridade e as assinaturas; não estabelece confiança no principal, admissão nem autorização para agir. O verificador V2 confere a cadeia de auditoria primária e, desde a v2.11.1, os elos, hashes de intenção e raiz Merkle secundários SHA3-256 opcionais que estejam presentes (os ausentes não são exigidos); a versão v2.11.0 não verifica os campos secundários. Consulte [a limitação documentada do verificador](../../docs/STORAGE_AND_ANCHORING.md#dual-hash-chains) e use as APIs de admissão abaixo quando for necessário estabelecer confiança.

<a id="installation"></a>

## Instalação

**Requer:** Go 1.25+

**SDK Go.** Desde a v2.11.0, este SDK inclui as correções do verificador, confiança no principal e `strict-v1`, cadeias de delegação, janela de recepção A2A e APIs experimentais opt-in de `dcp-jcs-v2`. A tag do módulo da v2.11.0 é `sdks/go/v2.11.0`; o caminho de importação mantém `/v2`. As mudanças continuam registradas no [histórico](../../CHANGELOG.md#unreleased).

**SDK Go v2.11.1.** Esta versão também verifica os campos secundários SHA3-256 do [VERIFICATION.md V2-11](../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) quando estão presentes: `audit_merkle_root_secondary`, cada `prev_hash_secondary` e cada `intent_hash_secondary`. Os campos ausentes não são exigidos, então um bundle verificado pode não ter uma cadeia secundária completa; um campo presente que seja `null`, não seja uma string ou seja inconsistente é rejeitado. Não mudam as APIs, os campos de resultado, `dcp-jcs-v1` nem o tratamento de `hash_alg`. A versão v2.11.0 não verifica esses campos. Os comandos de instalação abaixo indicam esta versão; para a disponibilidade dela no registro, veja [Versões publicadas](../../docs/README.md#published-versions).

```bash
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.11.1
```

Atualizar da v2.10.0 torna a verificação mais rigorosa: evidências malformadas ou inconsistentes antes aceitas podem ser rejeitadas. Comprimentos inválidos de chave pública V1 retornam erro em vez de provocar panic. Preserve as evidências históricas. `dcp-jcs-v1` continua como padrão normativo; as APIs candidatas continuam experimentais e opt-in. A admissão exige configuração de confiança pelo operador e não autoriza ações.

Somente para desenvolvimento do código-fonte:

```bash
go mod edit -replace github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2=/path/to/dcp-ai/sdks/go
```

<a id="features"></a>

## Funcionalidades

| Funcionalidade | V1 | V2 |
|---------|----|----|
| Assinaturas Ed25519 | Sim | Sim |
| ML-DSA-65 (FIPS 204) | — | Sim |
| SLH-DSA-192f (FIPS 205) | — | Sim |
| ML-KEM-768 (FIPS 203) | — | Sim |
| Assinaturas compostas (PQ sobre clássica) | — | Sim |
| Separação de domínios | — | Sim |
| Hash duplo (SHA-256 + SHA3-256) | — | Sim |
| Verificação de bundles | Sim | Sim |
| Admissão: conjunto de confiança do principal e perfil `strict-v1` (spec/profiles/admission) | — | Sim |
| Construção e assinatura de bundles | — | Sim |
| Cálculo do nível de segurança | — | Sim |
| Prova de posse | — | Sim |
| Rotação de chaves | — | Sim |
| Descoberta A2A DCP-04, handshake e sessão AES-256-GCM (biblioteca padrão; uso concorrente seguro, cada mensagem é aceita uma única vez dentro da janela) | — | Sim |
| Ciclo de vida dos agentes DCP-05 (comissionamento / vitalidade / descomissionamento) | — | Sim |
| Sucessão digital DCP-06 (testamento, transferência de memória, cerimônia) | — | Sim |
| Resolução de disputas, arbitragem e jurisprudência DCP-07 | — | Sim |
| Direitos, obrigações e conformidade DCP-08 | — | Sim |
| Delegação DCP-09 e cadeias de delegação verificáveis (`CreateSubMandate`, `VerifyMandateChain`), limiar de consciência e espelho do principal | — | Sim |
| Funções auxiliares de nonce de sessão, revogação de emergência | — | Sim |
| Checkpoints PQ adiados e `PQCheckpointManager` | — | Sim |
| RPR ocultado, autorização multipartes e funções auxiliares de avisos sobre algoritmos | — | Sim |
| Códigos de erro canônicos (38 compartilhados entre todos os SDKs) e `DetectWireFormat` | — | Sim |
| Exportador OpenTelemetry / OTLP (tag de compilação `otlp`) | — | Sim |
| Candidato de canonicalização `dcp-jcs-v2` (entrada, roteador, verificador de bytes, produtores) | — | Experimental e de adesão explícita; não normativo |

<a id="quickstart-v1"></a>

<a id="quickstart--v1"></a>

## Início rápido — V1

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

<a id="quickstart-v2"></a>

<a id="quickstart--v2"></a>

## Início rápido — V2

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
    nonce := v2.GenerateSessionNonce()
    bundle, _ := v2.BuildBundleV2(v2.BundleBuildInput{
        RPR:          sign(v2.CtxResponsiblePrincipal, map[string]interface{}{"human_id": "rpr:alice", "session_nonce": nonce, "binding_keys": keys}),
        Passport:     sign(v2.CtxAgentPassport, map[string]interface{}{"agent_id": "a-1", "session_nonce": nonce, "keys": keys, "status": "active", "principal_binding_reference": "rpr:alice"}),
        Intent:       sign(v2.CtxIntent, map[string]interface{}{"intent_id": "i-1", "session_nonce": nonce, "agent_id": "a-1", "human_id": "rpr:alice"}),
        Policy:       sign(v2.CtxPolicyDecision, map[string]interface{}{"intent_id": "i-1", "session_nonce": nonce, "risk_score": 200}),
        AuditEntries: []v2.AuditEventV2{},
        SessionNonce: nonce,
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

<a id="security-tiers"></a>

### Níveis de segurança

```go
// Fragment, inside a function: intentPayload and policyPayload are decoded V2 payloads.
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

<a id="ml-kem-768-key-encapsulation"></a>

### Encapsulamento de chaves ML-KEM-768

```go
// Fragment, inside a function.
kem := &providers.MlKem768Provider{}
kp, _ := kem.GenerateKeypair()
result, _ := kem.Encapsulate(kp.PublicKeyB64)
sharedSecret, _ := kem.Decapsulate(result.CiphertextB64, kp.SecretKeyB64)
```

<a id="v2-api-reference"></a>

## Referência da API V2

<a id="bundle-building-signing"></a>

<a id="bundle-building--signing"></a>

### Construção e assinatura de bundles

| Função | Descrição |
|----------|-------------|
| `v2.SignPayload(reg, context, payload, classicalKey, pqKey)` | Assina um artefato, produzindo um `SignedPayload` (assinatura composta, ou somente clássica quando `pqKey` é nil) |
| `v2.PreparePayload(payload)` | Devolve os bytes canônicos `dcp-jcs-v1` e seu SHA-256 em hex minúsculo, sem prefixo; o campo `payload_hash` é `"sha256:"` seguido desse digest |
| `v2.VerifyPayloadHash(signed)` | `true` somente quando `payload_hash` é exatamente `"sha256:"` seguido do SHA-256 do payload canônico; qualquer outro valor, inclusive um digest sem prefixo, é `false`. Só confere a consistência do hash, não a assinatura, as chaves, a política nem a admissão. Código-fonte em `main`, não publicado: a v2.11.1 compara o digest sem prefixo, então rejeita a saída de `SignPayload` e aceita a forma sem prefixo |
| `v2.BuildBundleV2(input)` | Monta um bundle V2 a partir de artefatos assinados, com hashes do manifesto e raízes Merkle duplas |
| `v2.SignBundleV2(reg, bundle, classicalKey, pqKey)` | Assina um bundle com assinatura composta ou somente clássica; o signatário é o principal do bundle (`signer.id` = `human_id` da RPR) |
| `v2.VerifySignedBundleV2(reg, jsonBytes)` | Verificação de bundles V2 (estrutura, hashes, assinaturas, cadeia de auditoria primária) sob `DefaultVerifierPolicy`, aplicando o mais estrito entre o modo da política e o modo do nível de segurança (especificação §14.3); informa `ResolvedTier` e `VerificationMode` |
| `v2.VerifySignedBundleV2WithPolicy(reg, jsonBytes, policy)` | O mesmo com sua própria `VerifierPolicy`; apenas `DefaultMode`, `RiskOverrides`, `AcceptedClassicalAlgs`, `AcceptedPQAlgs`, `AllowV1Bundles` (um bundle V1 nunca é verificado aqui), `MaxSessionDurationSeconds`, `RequireSessionExpiry`, `RequireAudienceBinding`, `VerifierID` e os campos da fase 3 (`AdvisoryRejectedAlgs`, `WarnClassicalOnlyDeprecated`, `AllowClassicalFallbackDisable`, como em TypeScript) podem diferir de `DefaultVerifierPolicy()`; qualquer outra mudança faz a verificação falhar |
| `v2.VerifySignedBundleV2At(reg, jsonBytes, policy, now)` | O mesmo no instante `now`: a janela da sessão, a expiração da RPR e das chaves são comparadas a ele, com precisão de milissegundos. As duas funções acima a chamam com `time.Now()` |

Cada resultado lista em `SignerKeys` (JSON `signer_keys`), para cada assinatura composta conferida (`bundle`, os quatro artefatos e cada `pq_checkpoints[<id>]`), a entrada de chave resolvida pelo verificador para cada componente (`classical`, `pq`) e se esse componente foi verificado.

**Structs tipados e bundles recebidos.** `AuditEventV2`, `CitizenshipBundleV2` e `SignedBundleV2` servem para produzir bundles. Na evidência de auditoria, esses structs perdem os membros com `null` explícito e os membros não reconhecidos (diferentes de `tool`, `result_ref` e `evidence_hash`); os membros reconhecidos com valor string e um objeto `evidence` vazio mantêm seus valores. Essas perdas de membros mudam a evidência canônica e podem invalidar a cadeia `prev_hash` ou a raiz Merkle de auditoria. Esses structs não são uma representação sem perdas para encaminhar evidência assinada. Guarde os bytes recebidos e verifique esses bytes: as funções de verificação acima recebem bytes. Não repare, recalcule nem assine de novo automaticamente a evidência recebida para que ela seja verificada; uma migração explícita é uma etapa separada que preserva o original.

<a id="admission-principal-trust-and-strict-v1-unreleased"></a>

<a id="admission-principal-trust-and-strict-v1"></a>

### Admissão: confiança no principal e strict-v1

Um bundle verificado comprova integridade e assinatura, não quem é o principal. A admissão ([spec/profiles/admission](../../spec/profiles/admission/README.md)) acrescenta à verificação um conjunto de confiança do operador que fixa as chaves de cada principal e o perfil `strict-v1` fixado pelo operador (assinaturas híbridas para todos os níveis, destinatário assinado, sessão assinada de no máximo 300 s e snapshot de revogação com no máximo 300 s de idade). Não faz E/S de rede e nunca autoriza uma ação: `ActionAuthorized` é sempre `false`.

| Função | Descrição |
|----------|-------------|
| `v2.NewPrincipalTrustStore(json)` | Valida um conjunto de confiança (`schemas/v2/principal_trust_set.schema.json`) |
| `v2.ResolveStrictV1Profile(json)` | Valida uma configuração strict-v1 (`schemas/v2/admission_profile.schema.json`); os getters do perfil (`VerifierPolicy()`, `VerifierID()`, `MaxSessionDurationSeconds()`, `MaxRevocationAgeSeconds()`) retornam cópias |
| `v2.RevocationSubjects(json, verification)` | O `agent_id` do passaporte e o kid de cada chave verificada de signatário, ordenados: os sujeitos que o snapshot de revogação deve cobrir |
| `v2.EvaluateAdmissionV2(json, verification, v2.AdmissionOptions{...})` | Avalia a admissão a partir do resultado do verificador em `Now`, sem criptografia |
| `v2.AdmitSignedBundleV2(reg, json, v2.AdmitOptions{...})` | Verifica (sob a política do perfil, ou `Policy` sem um perfil) e avalia |

Um conjunto de confiança ou perfil que não pode ser carregado, um perfil sem conjunto de confiança, ou um perfil junto com uma `Policy` do chamador retorna um `*v2.AdmissionConfigError` cujo `Code` é um dos códigos `CONFIG_*`. Um `AdmissionResult` tem `Verified`, `Verification`, `PrincipalTrust`, `Profile`, `ProfileCompliance`, `Admitted`, `ActionAuthorized`, `RecordedDecision`, `TrustSetVersion` e `Errors` (`{Code, Message}`), com os nomes de campos da especificação em sua forma JSON. Prossiga somente quando `Admitted` for true.

```go
// Fragment, inside a function: trustSetJSON, signedBundleJSON, reg (the algorithm registry) and lookupRevocation come from your application.
trust, err := v2.NewPrincipalTrustStore(trustSetJSON) // operator configuration, never the bundle
if err != nil {
    log.Fatal(err) // *v2.AdmissionConfigError
}
profile, err := v2.ResolveStrictV1Profile([]byte(`{"profile":"strict-v1","verifier_id":"api.acme.example"}`))
if err != nil {
    log.Fatal(err)
}

now := time.Now()
verification := v2.VerifySignedBundleV2At(reg, signedBundleJSON, profile.VerifierPolicy(), now)
subjects := v2.RevocationSubjects(signedBundleJSON, verification)
snapshot := lookupRevocation(subjects) // your source: a JSON snapshot, or nil when it cannot answer

result, err := v2.EvaluateAdmissionV2(signedBundleJSON, verification, v2.AdmissionOptions{
    Profile: profile, Trust: trust, Revocation: snapshot, Now: now,
})
if err != nil {
    log.Fatal(err)
}
if !result.Admitted {
    for _, e := range result.Errors {
        fmt.Println(e.Code, e.Message) // e.g. TRUST_PRINCIPAL_UNKNOWN, REVOCATION_STALE
    }
}
```

<a id="security-tiers_1"></a>

<a id="security-tiers-1"></a>

### Níveis de segurança

| Função | Descrição |
|----------|-------------|
| `v2.ComputeSecurityTier(input)` | Calcula o nível de segurança adaptativo (routine/standard/elevated/maximum), seu modo de verificação e intervalo de checkpoints (especificação §14.2); valores desconhecidos adotam conservadoramente `elevated` |
| `v2.SecurityTierInputFromPayloads(intent, policyDecision)` | Constrói a entrada do nível a partir dos payloads decodificados de intenção e PolicyDecision (`risk_score` vem da PolicyDecision; se faltar ou não for um inteiro de 0 a 1000, torna-se `RiskScore: -1`, que representa um valor desconhecido) |
| `v2.EffectiveVerificationMode(policyMode, tier)` | O mais estrito entre o modo da política e o modo do nível; `pq_only` permanece `pq_only` |

<a id="delegation-chains-dcp-09-35-unreleased"></a>

<a id="delegation-chains-dcp-09-35"></a>

### Cadeias de delegação (DCP-09 §3.5)

| Função | Descrição |
|----------|-------------|
| `v2.CreateDelegationMandate(reg, humanClassical, humanPQ, params)` | Mandato raiz assinado pela pessoa; `SubDelegation` e `MinimumSecurityTier` são opcionais |
| `v2.CreateSubMandate(reg, delegatorClassical, delegatorPQ, parent, v2.SubMandateParams{...})` | Submandato assinado pelo agente do mandato pai sob o contexto `DCP-AI.v2.SubMandate` |
| `v2.VerifyMandateChain(reg, chain, revokedIDs, v2.MandateChainKeys{HumanKeys, AgentKeys}, now)` | Verifica a cadeia offline, começando pela raiz (assinaturas até a pessoa, vínculos e profundidade, `sub_delegation`, validade aninhada, restrição de ações, `data_classes` e `limits`, nível mínimo e revogação); retorna `MandateChainResult{Valid, Errors, Depth, EffectiveTier}` |

`SecurityTierInput.MandateChainTier` usa o `EffectiveTier` da cadeia como um piso que só pode elevar o nível.

<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in-unreleased"></a>

<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in"></a>

### Experimental: candidato de canonicalização `dcp-jcs-v2` (adesão explícita)

Não é normativo nem está ativo: `dcp-jcs-v1` continua sendo o único perfil de canonicalização, e nenhum padrão, construtor, assinante ou verificador muda. Essas funções estão disponíveis na v2.11.0 somente para chamadores que optem explicitamente por usá-las. Um bundle candidato verificado não concede confiança nem admissão. Projeto e contrato: [`docs/proposals/canonicalization-candidate`](../../docs/proposals/canonicalization-candidate/README.md) (§15 entrada, §16 roteador, §17 verificador, §18 produtores).

| Função | Descrição |
|----------|-------------|
| `ExperimentalCandidateIngress(input []byte)` | `Accepted`, `Canonical`, `CanonicalSHA256`, ou `Class` e `Offset` da rejeição |
| `NewExperimentalCandidateRouter(config)` | Roteia bytes: `reject`, `v1_path` ou `candidate`; o decodificador histórico é identificado pelo nome fechado `encoding_json` |
| `NewExperimentalCandidateVerifier(config)` e `VerifyAt(registry, input, policy, now)` | Verifica a partir dos bytes originais com no máximo um verificador |
| `ExperimentalCandidateSignPayload(registry, context, input, keys)` | Assina um artefato a partir de `ExperimentalCandidateBytes(b)` ou `ExperimentalCandidateHostValue(v)` (tipos exatos; `json.Number` preservado) |
| `ExperimentalCandidateSignBundle(registry, parts, signer, options)` | Monta e assina um bundle cujo manifesto indica `dcp-jcs-v2` |
| `*ExperimentalCandidateProduceError`, `ErrExperimentalCandidateUsage` | Rejeição pelo domínio ou pela forma das entradas, antes de chamar qualquer assinante; uso incorreto da API |

```go
package main

import (
    "fmt"

    "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/providers"
    v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

func main() {
    // The ingress decides on the original bytes: 1.0 is the integer 1, members are sorted.
    ok, _ := v2.ExperimentalCandidateIngress([]byte(`{"b":1.0,"a":[]}`))
    fmt.Println(string(ok.Canonical)) // {"a":[],"b":1}
    bad, _ := v2.ExperimentalCandidateIngress([]byte(`{"a":1,"a":2}`))
    fmt.Println(bad.Class, bad.Offset) // DUPLICATE_KEY 7

    // A producer signs an artifact from those bytes (hybrid keys, today's composite signature).
    reg := v2.NewAlgorithmRegistry()
    reg.RegisterSigner(&providers.Ed25519Provider{})
    reg.RegisterSigner(&providers.MlDsa65Provider{})
    ed, _ := (&providers.Ed25519Provider{}).GenerateKeypair()
    pq, _ := (&providers.MlDsa65Provider{}).GenerateKeypair()
    keys := v2.ExperimentalCandidateKeys{
        Classical: v2.CompositeKeyInfo{Kid: ed.Kid, Alg: "ed25519", SecretKeyB64: ed.SecretKeyB64, PublicKeyB64: ed.PublicKeyB64},
        PQ:        &v2.CompositeKeyInfo{Kid: pq.Kid, Alg: "ml-dsa-65", SecretKeyB64: pq.SecretKeyB64, PublicKeyB64: pq.PublicKeyB64},
    }
    artifact, err := v2.ExperimentalCandidateSignPayload(reg, v2.CtxIntent, v2.ExperimentalCandidateBytes([]byte(`{"intent_id":"intent:1","risk":1.0}`)), keys)
    if err != nil {
        panic(err)
    }
    fmt.Println(artifact.SignedPayload["payload_hash"]) // sha256:... of {"intent_id":"intent:1","risk":1}
}
```

<a id="composite-signatures"></a>

### Assinaturas compostas

| Função | Descrição |
|----------|-------------|
| `v2.CompositeSign(reg, ctx, payload, classicalKey, pqKey)` | Assinatura composta PQ sobre clássica |
| `v2.ClassicalOnlySign(reg, ctx, payload, key)` | Modo de transição somente clássico |
| `v2.CompositeVerify(reg, ctx, payload, sig, classicalPK, pqPK)` | Verifica assinaturas compostas |

<a id="crypto-providers"></a>

### Provedores criptográficos

| Provedor | Algoritmo | Tipo | Padrão |
|----------|-----------|------|----------|
| `Ed25519Provider` | ed25519 | Assinatura | — |
| `MlDsa65Provider` | ml-dsa-65 | Assinatura | FIPS 204 |
| `SlhDsa192fProvider` | slh-dsa-192f | Assinatura | FIPS 205 |
| `MlKem768Provider` | ml-kem-768 | KEM | FIPS 203 |

<a id="v1-api-unchanged"></a>

### API V1 (sem mudanças)

| Função | Descrição |
|----------|-------------|
| `dcp.GenerateKeypair()` | Par de chaves Ed25519 |
| `dcp.SignObject(obj, sk)` | Assina um objeto |
| `dcp.VerifyObject(obj, sig, pk)` | Verifica a assinatura |
| `dcp.Canonicalize(obj)` | JSON determinístico |
| `dcp.HashObject(obj)` | SHA-256 do JSON canônico |
| `dcp.VerifySignedBundle(sb, pk)` | Verificação de bundles V1 |

<a id="dcp-0509-types"></a>

### Tipos DCP-05–09

A V2 inclui estruturas Go para todos os artefatos de DCP-05 a DCP-09:

| Especificação | Tipos |
|------|-------|
| DCP-05 | `LifecycleState`, `CommissioningCertificate`, `VitalityReport`, `VitalityMetrics`, `DecommissioningRecord`, `TerminationMode`, `DataDisposition` |
| DCP-06 | `DigitalTestament`, `SuccessionRecord`, `MemoryTransferManifest`, `MemoryTransferEntry`, `SuccessorPreference`, `MemoryClassification`, `TransitionType`, `MemoryDisposition` |
| DCP-07 | `DisputeRecord`, `ArbitrationResolution`, `JurisprudenceBundle`, `ObjectionRecord`, `DisputeType`, `EscalationLevel`, `DisputeStatus`, `ObjectionType`, `AuthorityLevel` |
| DCP-08 | `RightsDeclaration`, `RightEntry`, `ObligationRecord`, `RightsViolationReport`, `RightType`, `ComplianceStatus` |
| DCP-09 | `DelegationMandate`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `AwarenessThreshold`, `ThresholdRule`, `AuthorityScopeEntry` |

Contextos de separação de domínios: `CtxLifecycle`, `CtxSuccession`, `CtxDispute`, `CtxRights`, `CtxDelegation`, `CtxAwareness`

Todas as estruturas incluem tags JSON para serialização e desserialização e seguem as convenções de nomes do Go (`json:"field_name,omitempty"` para campos opcionais).

<a id="development"></a>

## Desenvolvimento

```bash
go build ./...   # Build
go test ./...    # Tests (conformance + interop + unit)
go fmt ./...     # Format
go mod tidy      # Verify dependencies
```

<a id="dependencies"></a>

### Dependências

- `github.com/cloudflare/circl` — ML-DSA-65, SLH-DSA-192f, ML-KEM-768
- `golang.org/x/crypto` — SHA3-256

<a id="license"></a>

## Licença

Apache-2.0
