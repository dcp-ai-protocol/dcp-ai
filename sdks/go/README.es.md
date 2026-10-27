<sub>[English](README.md) · [中文](README.zh-CN.md) · **Español** · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="dcp-ai-go-go-sdk"></a>

<a id="dcp-ai-go--go-sdk"></a>

# dcp-ai-go — SDK de Go

**Publicación Go (26/10/2026).** El SDK Go `v2.11.0` está disponible desde la etiqueta `sdks/go/v2.11.0`, incluidas las correcciones del verificador, admisión y API experimentales opt-in. La publicación Rust sigue siendo independiente. Véase [Go v2.11.0](../../docs/GO_RELEASE.md).

> Traducción informativa del [README en inglés](README.md), actualizada el 27/10/2026. Los identificadores y los bloques de código, incluidos sus comentarios, se conservan en el idioma original para mantener los ejemplos verificados.

SDK oficial de Go para el Digital Citizenship Protocol (DCP) v1.0 y v2.0. Admite Ed25519, ML-DSA-65, SLH-DSA-192f, ML-KEM-768, firmas compuestas, cadenas de hash duales y verificación de bundles.

La verificación comprueba integridad y firmas; no establece confianza en el principal, admisión ni autorización para actuar. El verificador V2 actual comprueba la cadena de auditoría primaria, pero no recalcula la cadena SHA3-256 opcional ni su raíz Merkle secundaria. Consulta [la limitación documentada del verificador](../../docs/STORAGE_AND_ANCHORING.md#dual-hash-chains) y usa las API de admisión descritas más abajo cuando se requiera confianza.

<a id="installation"></a>

## Instalación

**Requiere:** Go 1.25+

**SDK Go v2.11.0.** Esta versión incluye las correcciones del verificador, confianza en el principal y `strict-v1`, cadenas de delegación, ventana de recepción A2A y API experimentales opt-in de `dcp-jcs-v2`. La etiqueta del módulo es `sdks/go/v2.11.0`; la ruta de importación conserva `/v2`. Los cambios siguen registrados en el [historial](../../CHANGELOG.md#unreleased).

```bash
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.11.0
```

Actualizar desde v2.10.0 hace más estricta la verificación: puede rechazarse evidencia malformada o inconsistente antes aceptada. Las longitudes inválidas de clave pública V1 devuelven un error en lugar de provocar un panic. Conserva la evidencia histórica. `dcp-jcs-v1` sigue siendo el predeterminado normativo; las API candidatas siguen experimentales y opt-in. La admisión requiere configurar confianza por el operador y no autoriza acciones.

Solo para desarrollar desde el código fuente:

```bash
go mod edit -replace github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2=/path/to/dcp-ai/sdks/go
```

<a id="features"></a>

## Funciones

| Función | V1 | V2 |
|---------|----|----|
| Firmas Ed25519 | Sí | Sí |
| ML-DSA-65 (FIPS 204) | — | Sí |
| SLH-DSA-192f (FIPS 205) | — | Sí |
| ML-KEM-768 (FIPS 203) | — | Sí |
| Firmas compuestas (PQ sobre clásica) | — | Sí |
| Separación de dominios | — | Sí |
| Hash dual (SHA-256 + SHA3-256) | — | Sí |
| Verificación de bundles | Sí | Sí |
| Admisión: conjunto de confianza del principal y perfil `strict-v1` (spec/profiles/admission) | — | Sí |
| Construcción y firma de bundles | — | Sí |
| Cálculo del nivel de seguridad | — | Sí |
| Prueba de posesión | — | Sí |
| Rotación de claves | — | Sí |
| Descubrimiento A2A DCP-04, handshake y sesión AES-256-GCM (biblioteca estándar; uso concurrente seguro, cada mensaje se acepta una sola vez dentro de la ventana) | — | Sí |
| Ciclo de vida de agentes DCP-05 (puesta en servicio / vitalidad / retirada de servicio) | — | Sí |
| Sucesión digital DCP-06 (testamento, transferencia de memoria, ceremonia) | — | Sí |
| Resolución de disputas, arbitraje y jurisprudencia DCP-07 | — | Sí |
| Derechos, obligaciones y cumplimiento DCP-08 | — | Sí |
| Delegación DCP-09 y cadenas de delegación verificables (`CreateSubMandate`, `VerifyMandateChain`), umbral de consciencia y espejo del principal | — | Sí |
| Funciones auxiliares del nonce de sesión, revocación de emergencia | — | Sí |
| Checkpoints PQ diferidos y `PQCheckpointManager` | — | Sí |
| RPR cegado, autorización multipartita y funciones auxiliares de avisos sobre algoritmos | — | Sí |
| Códigos de error canónicos (38 compartidos entre todos los SDK) y `DetectWireFormat` | — | Sí |
| Exportador OpenTelemetry / OTLP (etiqueta de compilación `otlp`) | — | Sí |
| Candidato de canonicalización `dcp-jcs-v2` (ingreso, router, verificador de bytes, productores) | — | Experimental y de activación explícita; no normativo |

<a id="quickstart-v1"></a>

<a id="quickstart--v1"></a>

## Inicio rápido — V1

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

## Inicio rápido — V2

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

### Niveles de seguridad

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

### Encapsulación de claves ML-KEM-768

```go
// Fragment, inside a function.
kem := &providers.MlKem768Provider{}
kp, _ := kem.GenerateKeypair()
result, _ := kem.Encapsulate(kp.PublicKeyB64)
sharedSecret, _ := kem.Decapsulate(result.CiphertextB64, kp.SecretKeyB64)
```

<a id="v2-api-reference"></a>

## Referencia de API V2

<a id="bundle-building-signing"></a>

<a id="bundle-building--signing"></a>

### Construcción y firma de bundles

| Función | Descripción |
|----------|-------------|
| `v2.SignPayload(reg, context, payload, classicalKey, pqKey)` | Firma un artefacto y lo convierte en un `SignedPayload` (firma compuesta, o solo clásica cuando `pqKey` es nil) |
| `v2.BuildBundleV2(input)` | Ensambla un bundle V2 a partir de artefactos firmados, con hashes del manifiesto y raíces Merkle duales |
| `v2.SignBundleV2(reg, bundle, classicalKey, pqKey)` | Firma un bundle con una firma compuesta o solo clásica; el firmante es el principal del bundle (`signer.id` = `human_id` de la RPR) |
| `v2.VerifySignedBundleV2(reg, jsonBytes)` | Verificación de bundles V2 (estructura, hashes, firmas, cadena de auditoría primaria) bajo `DefaultVerifierPolicy`, aplicando el más estricto entre el modo de la política y el modo del nivel de seguridad (especificación §14.3); informa `ResolvedTier` y `VerificationMode` |
| `v2.VerifySignedBundleV2WithPolicy(reg, jsonBytes, policy)` | Lo mismo con tu propia `VerifierPolicy`; solo `DefaultMode`, `RiskOverrides`, `AcceptedClassicalAlgs`, `AcceptedPQAlgs`, `AllowV1Bundles` (aquí nunca se verifica un bundle V1), `MaxSessionDurationSeconds`, `RequireSessionExpiry`, `RequireAudienceBinding`, `VerifierID` y los campos de la fase 3 (`AdvisoryRejectedAlgs`, `WarnClassicalOnlyDeprecated`, `AllowClassicalFallbackDisable`, como en TypeScript) pueden diferir de `DefaultVerifierPolicy()`; cualquier otro cambio hace fallar la verificación |
| `v2.VerifySignedBundleV2At(reg, jsonBytes, policy, now)` | Lo mismo en el instante `now`: la ventana de sesión, la caducidad de la RPR y la de las claves se comparan con ese instante, con precisión de milisegundos. Las dos funciones anteriores la llaman con `time.Now()` |

Cada resultado enumera en `SignerKeys` (JSON `signer_keys`), para cada firma compuesta comprobada (`bundle`, los cuatro artefactos y cada `pq_checkpoints[<id>]`), la entrada de clave que el verificador resolvió para cada componente (`classical`, `pq`) y si ese componente se verificó.

<a id="admission-principal-trust-and-strict-v1-unreleased"></a>

<a id="admission-principal-trust-and-strict-v1"></a>

### Admisión: confianza en el principal y strict-v1

Un bundle verificado demuestra integridad y firma, no quién es el principal. La admisión ([spec/profiles/admission](../../spec/profiles/admission/README.md)) añade, sobre la verificación, un conjunto de confianza del operador que fija las claves de cada principal y el perfil `strict-v1` fijado por el operador (firmas híbridas para todos los niveles, destinatario firmado, sesión firmada de como máximo 300 s e instantánea de revocación de como máximo 300 s de antigüedad). No realiza E/S de red ni autoriza jamás una acción: `ActionAuthorized` siempre es `false`.

| Función | Descripción |
|----------|-------------|
| `v2.NewPrincipalTrustStore(json)` | Valida un conjunto de confianza (`schemas/v2/principal_trust_set.schema.json`) |
| `v2.ResolveStrictV1Profile(json)` | Valida una configuración strict-v1 (`schemas/v2/admission_profile.schema.json`); los getters del perfil (`VerifierPolicy()`, `VerifierID()`, `MaxSessionDurationSeconds()`, `MaxRevocationAgeSeconds()`) devuelven copias |
| `v2.RevocationSubjects(json, verification)` | El `agent_id` del pasaporte y el kid de cada clave de firmante verificada, ordenados: los sujetos que debe cubrir la instantánea de revocación |
| `v2.EvaluateAdmissionV2(json, verification, v2.AdmissionOptions{...})` | Evalúa la admisión a partir del resultado del verificador en `Now`, sin criptografía |
| `v2.AdmitSignedBundleV2(reg, json, v2.AdmitOptions{...})` | Verifica (bajo la política del perfil, o `Policy` cuando no hay perfil) y evalúa |

Un conjunto de confianza o perfil que no pueda cargarse, un perfil sin conjunto de confianza o un perfil acompañado de una `Policy` del llamador devuelve un `*v2.AdmissionConfigError` cuyo `Code` es uno de los códigos `CONFIG_*`. Un `AdmissionResult` tiene `Verified`, `Verification`, `PrincipalTrust`, `Profile`, `ProfileCompliance`, `Admitted`, `ActionAuthorized`, `RecordedDecision`, `TrustSetVersion` y `Errors` (`{Code, Message}`), con los nombres de campo de la especificación en su forma JSON. Continúa solo cuando `Admitted` sea true.

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

### Niveles de seguridad

| Función | Descripción |
|----------|-------------|
| `v2.ComputeSecurityTier(input)` | Calcula el nivel de seguridad adaptativo (routine/standard/elevated/maximum), su modo de verificación y el intervalo de checkpoints (especificación §14.2); los valores desconocidos adoptan conservadoramente `elevated` |
| `v2.SecurityTierInputFromPayloads(intent, policyDecision)` | Construye la entrada del nivel a partir de los payloads decodificados de intención y PolicyDecision (`risk_score` procede de PolicyDecision; si falta o no es un entero entre 0 y 1000, pasa a ser `RiskScore: -1`, que indica valor desconocido) |
| `v2.EffectiveVerificationMode(policyMode, tier)` | El más estricto entre el modo de la política y el del nivel; `pq_only` permanece como `pq_only` |

<a id="delegation-chains-dcp-09-35-unreleased"></a>

<a id="delegation-chains-dcp-09-35"></a>

### Cadenas de delegación (DCP-09 §3.5)

| Función | Descripción |
|----------|-------------|
| `v2.CreateDelegationMandate(reg, humanClassical, humanPQ, params)` | Mandato raíz firmado por la persona; `SubDelegation` y `MinimumSecurityTier` son opcionales |
| `v2.CreateSubMandate(reg, delegatorClassical, delegatorPQ, parent, v2.SubMandateParams{...})` | Submandato firmado por el agente del mandato padre bajo el contexto `DCP-AI.v2.SubMandate` |
| `v2.VerifyMandateChain(reg, chain, revokedIDs, v2.MandateChainKeys{HumanKeys, AgentKeys}, now)` | Verifica la cadena sin conexión, empezando por la raíz (firmas hasta la persona, enlaces y profundidad, `sub_delegation`, vigencia anidada, restricción de acciones, `data_classes` y `limits`, nivel mínimo y revocación); devuelve `MandateChainResult{Valid, Errors, Depth, EffectiveTier}` |

`SecurityTierInput.MandateChainTier` toma el `EffectiveTier` de la cadena como un mínimo que solo puede elevar el nivel.

<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in-unreleased"></a>

<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in"></a>

### Experimental: candidato de canonicalización `dcp-jcs-v2` (activación explícita)

No es normativo ni está activo: `dcp-jcs-v1` sigue siendo el único perfil de canonicalización y no cambia ningún valor predeterminado, constructor, firmante ni verificador. Estas funciones están disponibles en v2.11.0 solo para llamadores que opten explícitamente por usarlas. Un bundle candidato verificado no otorga confianza ni admisión. Diseño y contrato: [`docs/proposals/canonicalization-candidate`](../../docs/proposals/canonicalization-candidate/README.md) (§15 ingreso, §16 router, §17 verificador, §18 productores).

| Función | Descripción |
|----------|-------------|
| `ExperimentalCandidateIngress(input []byte)` | `Accepted`, `Canonical`, `CanonicalSHA256`, o `Class` y `Offset` del rechazo |
| `NewExperimentalCandidateRouter(config)` | Enruta bytes: `reject`, `v1_path` o `candidate`; el decodificador histórico se identifica mediante el nombre cerrado `encoding_json` |
| `NewExperimentalCandidateVerifier(config)` y `VerifyAt(registry, input, policy, now)` | Verifica desde los bytes originales con como máximo un verificador |
| `ExperimentalCandidateSignPayload(registry, context, input, keys)` | Firma un artefacto a partir de `ExperimentalCandidateBytes(b)` o `ExperimentalCandidateHostValue(v)` (tipos exactos; se conserva `json.Number`) |
| `ExperimentalCandidateSignBundle(registry, parts, signer, options)` | Ensambla y firma un bundle cuyo manifiesto indica `dcp-jcs-v2` |
| `*ExperimentalCandidateProduceError`, `ErrExperimentalCandidateUsage` | Rechazo por el dominio o la forma de las entradas, antes de llamar a cualquier firmante; uso incorrecto de la API |

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

### Firmas compuestas

| Función | Descripción |
|----------|-------------|
| `v2.CompositeSign(reg, ctx, payload, classicalKey, pqKey)` | Firma compuesta PQ sobre clásica |
| `v2.ClassicalOnlySign(reg, ctx, payload, key)` | Modo de transición solo clásico |
| `v2.CompositeVerify(reg, ctx, payload, sig, classicalPK, pqPK)` | Verifica firmas compuestas |

<a id="crypto-providers"></a>

### Proveedores criptográficos

| Proveedor | Algoritmo | Tipo | Estándar |
|----------|-----------|------|----------|
| `Ed25519Provider` | ed25519 | Firma | — |
| `MlDsa65Provider` | ml-dsa-65 | Firma | FIPS 204 |
| `SlhDsa192fProvider` | slh-dsa-192f | Firma | FIPS 205 |
| `MlKem768Provider` | ml-kem-768 | KEM | FIPS 203 |

<a id="v1-api-unchanged"></a>

### API V1 (sin cambios)

| Función | Descripción |
|----------|-------------|
| `dcp.GenerateKeypair()` | Par de claves Ed25519 |
| `dcp.SignObject(obj, sk)` | Firma un objeto |
| `dcp.VerifyObject(obj, sig, pk)` | Verifica la firma |
| `dcp.Canonicalize(obj)` | JSON determinista |
| `dcp.HashObject(obj)` | SHA-256 del JSON canónico |
| `dcp.VerifySignedBundle(sb, pk)` | Verificación de bundles V1 |

<a id="dcp-0509-types"></a>

### Tipos DCP-05–09

V2 incluye estructuras Go para todos los artefactos de DCP-05 a DCP-09:

| Especificación | Tipos |
|------|-------|
| DCP-05 | `LifecycleState`, `CommissioningCertificate`, `VitalityReport`, `VitalityMetrics`, `DecommissioningRecord`, `TerminationMode`, `DataDisposition` |
| DCP-06 | `DigitalTestament`, `SuccessionRecord`, `MemoryTransferManifest`, `MemoryTransferEntry`, `SuccessorPreference`, `MemoryClassification`, `TransitionType`, `MemoryDisposition` |
| DCP-07 | `DisputeRecord`, `ArbitrationResolution`, `JurisprudenceBundle`, `ObjectionRecord`, `DisputeType`, `EscalationLevel`, `DisputeStatus`, `ObjectionType`, `AuthorityLevel` |
| DCP-08 | `RightsDeclaration`, `RightEntry`, `ObligationRecord`, `RightsViolationReport`, `RightType`, `ComplianceStatus` |
| DCP-09 | `DelegationMandate`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `AwarenessThreshold`, `ThresholdRule`, `AuthorityScopeEntry` |

Contextos de separación de dominios: `CtxLifecycle`, `CtxSuccession`, `CtxDispute`, `CtxRights`, `CtxDelegation`, `CtxAwareness`

Todas las estructuras incluyen etiquetas JSON para serialización y deserialización y siguen las convenciones de nombres de Go (`json:"field_name,omitempty"` para los campos opcionales).

<a id="development"></a>

## Desarrollo

```bash
go build ./...   # Build
go test ./...    # Tests (conformance + interop + unit)
go fmt ./...     # Format
go mod tidy      # Verify dependencies
```

<a id="dependencies"></a>

### Dependencias

- `github.com/cloudflare/circl` — ML-DSA-65, SLH-DSA-192f, ML-KEM-768
- `golang.org/x/crypto` — SHA3-256

<a id="license"></a>

## Licencia

Apache-2.0
