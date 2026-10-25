<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

<a id="dcp-ai-rust-sdk"></a>

# dcp-ai — SDK Rust

> Tradução informativa do [README em inglês](README.md), atualizada em 25/10/2026. Identificadores e blocos de código, incluindo comentários, são preservados no idioma original para manter os exemplos verificados.

SDK oficial em Rust para o Digital Citizenship Protocol (DCP v2.0). Oferece tipos baseados em Serde, criptografia pós-quântica híbrida (Ed25519 + ML-DSA-65 + SLH-DSA-192f + ML-KEM-768), assinaturas compostas com vinculação `pq_over_classical`, cadeias de hash duplas, observabilidade com OpenTelemetry, comportamento DCP-04..09 e suporte opcional a WebAssembly.

A verificação confere a integridade e as assinaturas; não estabelece confiança no principal, admissão nem autorização para agir. O verificador V2 atual confere a cadeia de auditoria primária, mas não recalcula a cadeia SHA3-256 opcional nem sua raiz Merkle secundária. Consulte [a limitação documentada do verificador](../../docs/STORAGE_AND_ANCHORING.md#dual-hash-chains) e use as APIs de admissão abaixo quando for necessário estabelecer confiança.

<a id="installation"></a>

## Instalação

**Estado da publicação.** Este README descreve o código em `main`. A última versão com tag, `v2.10.0`, contém `dcp-ai` 2.10.0. O que o histórico lista em [`[Unreleased]`](../../CHANGELOG.md#unreleased) ainda não está em uma versão com tag: construção e assinatura de bundles V2 (`dcp_ai::v2::bundle`), admissão, cadeias de delegação, janela de recepção A2A e APIs experimentais de `dcp-jcs-v2`. Para executar os exemplos abaixo, use o repositório ou um checkout como dependência:

```toml
[dependencies]
dcp-ai = { git = "https://github.com/dcp-ai-protocol/dcp-ai", branch = "main" }
# or, from a checkout:
# dcp-ai = { path = "/path/to/dcp-ai/sdks/rust" }
```

O crate publicado, sem as funcionalidades ainda não publicadas:

```toml
[dependencies]
dcp-ai = "2.10"
```

Com exportação OpenTelemetry/OTLP:

```toml
[dependencies]
dcp-ai = { version = "2.10", features = ["otlp"] }
```

Para suporte a WebAssembly:

```toml
[dependencies]
dcp-ai = { version = "2.10", features = ["wasm"] }
```

<a id="features"></a>

## Funcionalidades

| Área | Estado |
|---|---|
| Provedores Ed25519 / ML-DSA-65 / SLH-DSA-192f / ML-KEM-768 | Sim |
| Assinaturas compostas (`pq_over_classical`) e verificação | Sim |
| JSON canônico v2 e separação de domínios | Sim |
| Hash duplo (SHA-256 + SHA3-256) e raízes Merkle | Sim |
| Verificação de bundles (V1 + V2; V2 sob uma política do verificador e o nível de segurança, `verify_signed_bundle_v2_with_policy`) | Sim |
| Construção e assinatura de bundles V2 (`dcp_ai::v2::bundle`: `build_bundle_v2`, `sign_bundle_v2`; `wasm_build_bundle` / `wasm_sign_bundle` da funcionalidade `wasm` as chamam; ainda sem checkpoints PQ) | Sim, não publicada |
| Ciclo de vida dos agentes DCP-05 (comissionamento / vitalidade / descomissionamento) | Sim |
| Sucessão digital DCP-06 (testamento, transferência de memória, cerimônia) | Sim |
| Resolução de disputas, arbitragem e jurisprudência DCP-07 | Sim |
| Direitos, obrigações e conformidade DCP-08 | Sim |
| Delegação DCP-09 e cadeias de delegação verificáveis (`create_sub_mandate`, `verify_mandate_chain`, §3.5), limiar de consciência e espelho do principal | Sim |
| Descoberta A2A DCP-04, handshake e derivação do identificador de sessão | Sim |
| Criptografia de sessão A2A DCP-04 com AES-256-GCM | _Adiada para uma versão posterior_ |
| Funções auxiliares de nonce de sessão, mecanismo de níveis de segurança (`compute_security_tier(&intent, Some(&policy_decision))`, especificação §14.2; `compute_security_tier_with_floor` acrescenta o nível de uma cadeia de delegação), revogação de emergência | Sim |
| Checkpoints PQ adiados e `PQCheckpointManager` | Sim |
| RPR ocultado, autorização multipartes e funções auxiliares de avisos sobre algoritmos | Sim |
| Códigos de erro canônicos (38 compartilhados entre todos os SDKs) e `detect_wire_format` | Sim |
| Exportador OpenTelemetry / OTLP (funcionalidade opcional `otlp`) | Sim |
| Admissão: principais confiáveis e perfil `strict-v1` | Sim, não publicada |
| Candidato de canonicalização `dcp-jcs-v2` (entrada, roteador, verificador de bytes, produtores) | Experimental e de adesão explícita, não publicado; não normativo |

<a id="quickstart"></a>

## Início rápido

```rust
use dcp_ai::crypto::{generate_keypair, sign_object, verify_object, hash_object};
use serde_json::json;

fn main() {
    // 1. Generate Ed25519 keypair
    let (public_key_b64, secret_key_b64) = generate_keypair();
    println!("Public Key: {}", public_key_b64);

    // 2. Sign an object
    let obj = json!({
        "agent_id": "agent-001",
        "action": "api_call"
    });
    let signature = sign_object(&obj, &secret_key_b64).unwrap();

    // 3. Verify signature
    let valid = verify_object(&obj, &signature, &public_key_b64).unwrap();
    println!("Verified: {}", valid); // true

    // 4. SHA-256 hash
    let hash = hash_object(&obj);
    println!("SHA-256: {}", hash);
}
```

<a id="verify-a-signed-bundle"></a>

### Verificar um bundle assinado

```rust
// Needs citizenship_bundle.signed.json in the working directory and the signer's public key in place of BASE64_PUBLIC_KEY.
use dcp_ai::verify::verify_signed_bundle;
use serde_json;
use std::fs;

fn main() {
    let data = fs::read_to_string("citizenship_bundle.signed.json").unwrap();
    let signed_bundle: serde_json::Value = serde_json::from_str(&data).unwrap();

    let result = verify_signed_bundle(&signed_bundle, Some("BASE64_PUBLIC_KEY"));
    println!("Verified: {}", result.verified);
    if let Some(errors) = &result.errors {
        println!("Errors: {:?}", errors);
    }
}
```

<a id="api-reference"></a>

## Referência da API

<a id="crypto-dcp_aicrypto"></a>

### Criptografia (`dcp_ai::crypto`)

| Função | Assinatura | Descrição |
|----------|-----------|-------------|
| `generate_keypair()` | `() -> (String, String)` | Retorna `(public_key_b64, secret_key_b64)` |
| `sign_object(obj, secret_key_b64)` | `(&Value, &str) -> Result<String, String>` | Assina e retorna base64 |
| `verify_object(obj, sig_b64, pub_b64)` | `(&Value, &str, &str) -> Result<bool, String>` | Verifica a assinatura |
| `canonicalize(obj)` | `(&Value) -> String` | JSON determinístico |
| `hash_object(obj)` | `(&Value) -> String` | SHA-256 hexadecimal |
| `merkle_root_from_hex_leaves(leaves)` | `(&[String]) -> Option<String>` | Raiz Merkle |

<a id="verification-dcp_aiverify"></a>

### Verificação (`dcp_ai::verify`)

```rust
// Signature (not runnable)
fn verify_signed_bundle(
    signed_bundle: &Value,
    public_key_b64: Option<&str>,
) -> VerificationResult
```

Verifica: assinatura Ed25519, `bundle_hash`, `merkle_root`, cadeia de `intent_hash` e cadeia de `prev_hash`.

<a id="types-dcp_aitypes"></a>

### Tipos (`dcp_ai::types`)

```rust
// Declarations, fields elided (not runnable)
pub struct ResponsiblePrincipalRecord { ... }
pub struct AgentPassport { ... }
pub struct Intent { ... }
pub struct IntentTarget { ... }
pub struct PolicyDecision { ... }
pub struct AuditEntry { ... }
pub struct AuditEvidence { ... }
pub struct CitizenshipBundle { ... }
pub struct SignedBundle { ... }
pub struct BundleSignature { ... }
pub struct Signer { ... }
pub struct VerificationResult {
    pub verified: bool,
    pub errors: Vec<String>,
}
```

Todas as estruturas implementam `Serialize` + `Deserialize` (serde).

<a id="v2-types-dcp_aiv2types"></a>

### Tipos V2 (`dcp_ai::v2::types`)

A V2 inclui estruturas derivadas de Serde para todos os artefatos de DCP-05 a DCP-09:

| Especificação | Tipos |
|------|-------|
| DCP-05 | `LifecycleState`, `CommissioningCertificate`, `VitalityReport`, `VitalityMetrics`, `DecommissioningRecord`, `TerminationMode`, `DataDisposition` |
| DCP-06 | `DigitalTestament`, `SuccessionRecord`, `MemoryTransferManifest`, `MemoryTransferEntry`, `SuccessorPreference`, `MemoryClassification`, `TransitionType`, `MemoryDisposition` |
| DCP-07 | `DisputeRecord`, `ArbitrationResolution`, `JurisprudenceBundle`, `ObjectionRecord`, `DisputeType`, `EscalationLevel`, `DisputeStatus`, `ObjectionType`, `AuthorityLevel` |
| DCP-08 | `RightsDeclaration`, `RightEntry`, `ObligationRecord`, `RightsViolationReport`, `RightType`, `ComplianceStatus` |
| DCP-09 | `DelegationMandate`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `AwarenessThreshold`, `ThresholdRule`, `AuthorityScopeEntry` |

Constantes de separação de domínios: `CTX_LIFECYCLE`, `CTX_SUCCESSION`, `CTX_DISPUTE`, `CTX_RIGHTS`, `CTX_DELEGATION`, `CTX_AWARENESS`

Todas as estruturas derivam `Debug`, `Clone`, `Serialize` e `Deserialize`. As enumerações usam `#[serde(rename_all = "snake_case")]`. Campos opcionais usam `Option<T>` com `#[serde(skip_serializing_if = "Option::is_none")]`.

<a id="bundles-dcp_aiv2bundle-unreleased"></a>

### Bundles (`dcp_ai::v2::bundle`, não publicados)

| Função | Descrição |
|----------|-------------|
| `build_bundle_v2(&rpr, &passport, &intent, &policy, &audit_entries, session_nonce)` | Constrói o bundle V2 a partir dos quatro `SignedPayload` e da trilha de auditoria. Confere cada `payload_hash` e o `session_nonce` de cada artefato e entrada de auditoria e escreve o manifesto com ambas as raízes Merkle de auditoria; uma trilha vazia recebe raízes de 64 zeros |
| `sign_bundle_v2(bundle, &classical, &pq)` | Aplica uma assinatura composta ao manifesto sob `CTX_BUNDLE` e retorna `{bundle, signature}`, com `signer.id` igual ao `human_id` da RPR. Coloque `session_expires_at` ou `intended_verifier` no manifesto antes de assinar; com `session_expires_at` e sem `session_issued_at`, define `session_issued_at` como o instante da assinatura |

<a id="delegation-chains-dcp_aiv2delegation-dcp-09-35-unreleased"></a>

### Cadeias de delegação (`dcp_ai::v2::delegation`, DCP-09 §3.5, não publicadas)

| Função | Descrição |
|----------|-------------|
| `create_delegation_mandate_with_options(ed, pq, human_classical, human_pq, params, &MandateChainOptions)` | Mandato raiz assinado pela pessoa, com `sub_delegation` e `minimum_security_tier` opcionais |
| `create_sub_mandate(ed, pq, classical, pq_key, &parent, SubMandateParams { .. })` | Submandato assinado pelo agente do mandato pai sob o contexto `DCP-AI.v2.SubMandate` |
| `verify_mandate_chain(&chain, &revoked_ids, &MandateChainKeys { human_keys, agent_keys }, now_millis)` | Verifica a cadeia offline, começando pela raiz (assinaturas até a pessoa, vínculos e profundidade, `sub_delegation`, validade aninhada, restrição de ações, `data_classes` e `limits`, nível mínimo e revogação); retorna `MandateChainResult { valid, errors, depth, effective_tier }` |

<a id="admission-dcp_aiv2-specprofilesadmission-unreleased"></a>

### Admissão (`dcp_ai::v2`, spec/profiles/admission, não publicada)

Determina se um bundle V2 verificado é admitido como evidência de um principal no qual o operador já confia, opcionalmente sob o perfil `strict-v1`. O conjunto de confiança, o perfil e a fonte de revogação vêm do operador, nunca do bundle nem da requisição.

| Função | Descrição |
|----------|-------------|
| `verify_signed_bundle_v2_at(&b, &policy, now_ms)` | `verify_signed_bundle_v2_with_policy` em `now_ms` (milissegundos desde a época Unix), usado em todas as verificações temporais; as outras duas funções de verificação usam o relógio do sistema. Retorna `V2VerificationDetails`: o mesmo `V2VerificationResult` em `result`, e `signer_keys`, que lista, para cada assinatura composta conferida, a chave resolvida de cada componente e se ela foi verificada. `V2VerificationResult` mantém sua forma de dez campos, e as outras duas funções mantêm suas assinaturas |
| `PrincipalTrustStore::from_json(&json)` | Carrega um conjunto de confiança (`schemas/v2/principal_trust_set.schema.json`) |
| `resolve_strict_v1_profile(&json)` | Carrega um perfil `strict-v1` (`schemas/v2/admission_profile.schema.json`); `policy()`, `verifier_id()`, `max_session_duration_seconds()` e `max_revocation_age_seconds()` são somente leitura |
| `revocation_subjects(&b, &verification)` | O `agent_id` do passaporte e os kids ordenados das chaves verificadas dos signatários, para a fonte de revogação do operador |
| `evaluate_admission_v2(&b, &verification, &AdmissionOptions { .. })` | Admissão a partir de um resultado de verificação, sem criptografia nem E/S |
| `admit_signed_bundle_v2(&b, &AdmitOptions { .. })` | Verifica em `now_ms` (relógio do sistema quando `None`) sob a política do perfil, ou sob `policy` sem um perfil, e então avalia |

Um conjunto de confiança ou perfil que não pode ser carregado, um perfil sem conjunto de confiança e um perfil com política do chamador retornam `AdmissionConfigError { code, message }`. `AdmissionResult` é serializado com as chaves de §5.2 (`verified`, `verification`, `principal_trust`, `profile`, `profile_compliance`, `admitted`, `action_authorized`, `recorded_decision`, `trust_set_version`, `errors`); `action_authorized` é sempre `false`. A `verifier_policy` de um perfil pode restringir `accepted_classical_algs` e `accepted_pq_algs`, o que é aplicado pelo verificador; ela fixa `min_classical`, `min_pq`, `accepted_hash_algs` e `max_key_age_days` nos valores padrão.

```rust
// Fragment, inside a function returning a Result: profile_json, trust_set_json, signed_bundle, now_ms and revocation_source come from your application.
use dcp_ai::v2::{
    evaluate_admission_v2, resolve_strict_v1_profile, revocation_subjects, verify_signed_bundle_v2_at,
    AdmissionOptions, PrincipalTrustStore,
};

let profile = resolve_strict_v1_profile(&profile_json)?;
let trust = PrincipalTrustStore::from_json(&trust_set_json)?;
let verification = verify_signed_bundle_v2_at(&signed_bundle, profile.policy(), now_ms);
// Ask the operator's revocation source about these; None when it cannot answer.
let snapshot: Option<serde_json::Value> = revocation_source(&revocation_subjects(&signed_bundle, &verification));
let result = evaluate_admission_v2(
    &signed_bundle,
    &verification,
    &AdmissionOptions { profile: Some(&profile), trust: Some(&trust), revocation: snapshot.as_ref(), now_ms },
)?;
if result.admitted {
    // Authentic evidence from a trusted principal; not an authorization to act.
}
```

<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in-unreleased"></a>

### Experimental: candidato de canonicalização `dcp-jcs-v2` (adesão explícita, não publicado)

Não é normativo nem está ativo: `dcp-jcs-v1` continua sendo o único perfil de canonicalização, e nenhum padrão, construtor, assinante ou verificador muda. Esses módulos estão disponíveis para chamadores que optem por usá-los a partir de um checkout do código (consulte o estado da publicação). Um bundle candidato verificado não concede confiança nem admissão. Projeto e contrato: [`docs/proposals/canonicalization-candidate`](../../docs/proposals/canonicalization-candidate/README.md) (§15 entrada, §16 roteador, §17 verificador, §18 produtores).

| Módulo | API |
|---|---|
| `dcp_ai::v2::experimental_candidate_ingress` | `experimental_candidate_ingress(&[u8])`: `CandidateIngressOutcome::Accept { value, canonical, canonical_sha256 }` ou `Reject { class, offset }` |
| `dcp_ai::v2::experimental_candidate_router` | `CandidateRouter::new(CandidateRouterConfig { transport, accepted_profiles, historical })`; decodificador `HistoricalAdapter::serde_json_from_slice()`, nenhum padrão |
| `dcp_ai::v2::experimental_candidate_verify` | `CandidateVerifier::new(config)` e `verify_at(input, policy, now_ms)` |
| `dcp_ai::v2::experimental_candidate_produce` | `sign_payload(context, &CandidateInput, &CandidateKeys)` e `sign_bundle(&BundleParts, &BundleSigner, &BundleOptions)`; `ProduceError::Reject` para o domínio ou a forma das entradas (antes de executar qualquer assinante), `Usage`, `Provider` |

```rust
use dcp_ai::providers::{ed25519::Ed25519Provider, ml_dsa_65::MlDsa65Provider};
use dcp_ai::v2::composite_ops::CompositeKeyInfo;
use dcp_ai::v2::crypto_provider::CryptoProvider;
use dcp_ai::v2::experimental_candidate_ingress::{experimental_candidate_ingress, CandidateIngressOutcome};
use dcp_ai::v2::experimental_candidate_produce::{sign_payload, CandidateInput, CandidateKeys};

fn main() {
    // The ingress decides on the original bytes: 1.0 is the integer 1, members are sorted.
    if let Ok(CandidateIngressOutcome::Accept { canonical, .. }) = experimental_candidate_ingress(br#"{"b":1.0,"a":[]}"#) {
        println!("{}", String::from_utf8(canonical).unwrap()); // {"a":[],"b":1}
    }
    if let Ok(CandidateIngressOutcome::Reject { class, offset }) = experimental_candidate_ingress(br#"{"a":1,"a":2}"#) {
        println!("{} {}", class.as_str(), offset); // DUPLICATE_KEY 7
    }

    // A producer signs an artifact from those bytes (hybrid keys, today's composite signature).
    let key = |p: &dyn CryptoProvider| {
        let k = p.generate_keypair().unwrap();
        CompositeKeyInfo { kid: k.kid, alg: p.alg().to_string(), secret_key_b64: k.secret_key_b64, public_key_b64: k.public_key_b64 }
    };
    let keys = CandidateKeys { classical: key(&Ed25519Provider), pq: Some(key(&MlDsa65Provider)) };
    let input = CandidateInput::Bytes(br#"{"intent_id":"intent:1","risk":1.0}"#.to_vec());
    let artifact = sign_payload("DCP-AI.v2.Intent", &input, &keys).unwrap();
    println!("{}", artifact.signed_payload["payload_hash"]); // "sha256:..." of {"intent_id":"intent:1","risk":1}
}
```

<a id="feature-wasm"></a>

### Funcionalidade `wasm`

Quando a funcionalidade `wasm` está habilitada, o crate expõe bindings WebAssembly:

```rust
// Declarations of the wasm-bindgen exports, bodies elided (not runnable)
// Available via wasm-bindgen
fn wasm_verify_signed_bundle(json: &str, pub_key: Option<String>) -> String;
fn wasm_verify_signed_bundle_v2(json: &str, policy_json: Option<String>) -> String; // default policy when None; V1 bundles are rejected under a policy
fn wasm_hash_object(json: &str) -> String;
fn wasm_generate_keypair() -> String;
fn wasm_build_bundle(rpr_json: &str, passport_json: &str, intent_json: &str, policy_json: &str, audit_entries_json: &str, session_nonce: &str) -> String;
fn wasm_sign_bundle(bundle_json: &str, classical_sk_b64: &str, classical_kid: &str, pq_sk_b64: &str, pq_kid: &str) -> String;
```

Compilar para WASM:

```bash
cargo build --target wasm32-unknown-unknown --features wasm
```

<a id="development"></a>

## Desenvolvimento

```bash
# Build
cargo build

# Tests
cargo test

# Build with WASM
cargo build --features wasm

# Build for WASM target
cargo build --target wasm32-unknown-unknown --features wasm
```

<a id="dependencies"></a>

### Dependências

- `serde` + `serde_json` — Serialização
- `sha2` — SHA-256
- `sha3` — SHA3-256 (cadeias de hash duplas)
- `ed25519-dalek` — Criptografia Ed25519
- `fips203` / `fips204` / `fips205` — ML-KEM-768, ML-DSA-65 e SLH-DSA-192f (FIPS 203 / 204 / 205)
- `rand` — Geração de números aleatórios
- `base64` — Codificação Base64
- `hex` — Codificação hexadecimal
- `wasm-bindgen` (opcional) — Bindings WASM

<a id="license"></a>

## Licença

Apache-2.0
