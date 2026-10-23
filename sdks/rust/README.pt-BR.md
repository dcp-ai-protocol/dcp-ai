<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

# dcp-ai — SDK Rust

SDK Rust oficial para o Digital Citizenship Protocol (DCP v2.0). Tipos baseados em Serde, criptografia híbrida pós-quântica (Ed25519 + ML-DSA-65 + SLH-DSA-192f + ML-KEM-768), assinaturas compostas com binding `pq_over_classical`, cadeias de hash duplas, observabilidade OpenTelemetry, comportamento DCP-04..09 e suporte opcional a WebAssembly.

## Instalação

Adicione ao `Cargo.toml`:

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

## Recursos

| Área | Status |
|---|---|
| Provedores Ed25519 / ML-DSA-65 / SLH-DSA-192f / ML-KEM-768 | Sim |
| Assinaturas compostas (`pq_over_classical`) + verificação | Sim |
| JSON canônico v2 + separação de domínio | Sim |
| Dual hash (SHA-256 + SHA3-256) + Merkle roots | Sim |
| Verificação de bundle (V1 + V2; V2 com política de verificador e nível de segurança, `verify_signed_bundle_v2_with_policy`) | Sim |
| Construção e assinatura de bundle V2 | Feature `wasm`: `wasm_build_bundle` / `wasm_sign_bundle`. API nativa: ainda não; monte o manifesto a partir de `prepare_payload`, `composite_sign` e `audit_events_merkle_root`, como faz `tools/interop-matrix/agents/rust` |
| DCP-05 ciclo de vida de agentes (commissioning / vitality / decommissioning) | Sim |
| DCP-06 sucessão digital (testamento digital, transferência de memória, cerimônia) | Sim |
| DCP-07 resolução de disputas + arbitragem + jurisprudência | Sim |
| DCP-08 direitos + obrigações + conformidade | Sim |
| DCP-09 delegação + cadeias de delegação verificáveis (`create_sub_mandate`, `verify_mandate_chain`, §3.5) + limiar de consciência + espelho do principal | Sim |
| DCP-04 descoberta A2A + handshake + derivação de session id | Sim |
| DCP-04 criptografia de sessão A2A AES-256-GCM | _Adiado para uma release subsequente_ |
| Helpers de nonce de sessão, motor de tier de segurança (`compute_security_tier(&intent, Some(&policy_decision))`, spec §14.2; `compute_security_tier_with_floor` acrescenta o nível de uma cadeia de delegação), revogação de emergência | Sim |
| Checkpoints PQ lazy + `PQCheckpointManager` | Sim |
| Helpers de RPR blindado, autorização multi-parte, advisory de algoritmo | Sim |
| Códigos de erro canônicos (38 compartilhados entre todos os SDKs) + `detect_wire_format` | Sim |
| Exportador OpenTelemetry / OTLP (feature opcional `otlp`) | Sim |

## Início Rápido

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

### Verificar um Signed Bundle

```rust
use dcp_ai::verify::verify_signed_bundle;
use serde_json;
use std::fs;

fn main() {
    let data = fs::read_to_string("citizenship_bundle.signed.json").unwrap();
    let signed_bundle: serde_json::Value = serde_json::from_str(&data).unwrap();

    let result = verify_signed_bundle(&signed_bundle, Some("BASE64_PUBLIC_KEY"));
    println!("Verified: {}", result.verified);
    if !result.errors.is_empty() {
        println!("Errors: {:?}", result.errors);
    }
}
```

## Referência de API

### Crypto (`dcp_ai::crypto`)

| Função | Assinatura | Descrição |
|--------|-----------|-----------|
| `generate_keypair()` | `() -> (String, String)` | Retorna `(public_key_b64, secret_key_b64)` |
| `sign_object(obj, secret_key_b64)` | `(&Value, &str) -> Result<String, String>` | Assina, retorna base64 |
| `verify_object(obj, sig_b64, pub_b64)` | `(&Value, &str, &str) -> Result<bool, String>` | Verifica assinatura |
| `canonicalize(obj)` | `(&Value) -> String` | JSON determinístico |
| `hash_object(obj)` | `(&Value) -> String` | SHA-256 em hex |
| `merkle_root_from_hex_leaves(leaves)` | `(&[String]) -> Option<String>` | Merkle root |

### Verificação (`dcp_ai::verify`)

```rust
fn verify_signed_bundle(
    signed_bundle: &Value,
    public_key_b64: Option<&str>,
) -> VerificationResult
```

Verifica: assinatura Ed25519, `bundle_hash`, `merkle_root`, cadeia de `intent_hash`, cadeia de `prev_hash`.

### Tipos (`dcp_ai::types`)

```rust
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

Todas as structs implementam `Serialize` + `Deserialize` (serde).

### Tipos V2 (`dcp_ai::v2::types`)

V2 inclui structs derivadas de Serde para todos os artefatos de DCP-05 a DCP-09:

| Spec | Tipos |
|------|-------|
| DCP-05 | `LifecycleState`, `CommissioningCertificate`, `VitalityReport`, `VitalityMetrics`, `DecommissioningRecord`, `TerminationMode`, `DataDisposition` |
| DCP-06 | `DigitalTestament`, `SuccessionRecord`, `MemoryTransferManifest`, `MemoryTransferEntry`, `SuccessorPreference`, `MemoryClassification`, `TransitionType`, `MemoryDisposition` |
| DCP-07 | `DisputeRecord`, `ArbitrationResolution`, `JurisprudenceBundle`, `ObjectionRecord`, `DisputeType`, `EscalationLevel`, `DisputeStatus`, `ObjectionType`, `AuthorityLevel` |
| DCP-08 | `RightsDeclaration`, `RightEntry`, `ObligationRecord`, `RightsViolationReport`, `RightType`, `ComplianceStatus` |
| DCP-09 | `DelegationMandate`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `AwarenessThreshold`, `ThresholdRule`, `AuthorityScopeEntry` |

Constantes de separação de domínio: `CTX_LIFECYCLE`, `CTX_SUCCESSION`, `CTX_DISPUTE`, `CTX_RIGHTS`, `CTX_DELEGATION`, `CTX_AWARENESS`

Todas as structs derivam `Debug`, `Clone`, `Serialize`, `Deserialize`. Enums usam `#[serde(rename_all = "snake_case")]`. Campos opcionais usam `Option<T>` com `#[serde(skip_serializing_if = "Option::is_none")]`.

### Cadeias de Delegação (`dcp_ai::v2::delegation`, DCP-09 §3.5)

| Função | Descrição |
|--------|-----------|
| `create_delegation_mandate_with_options(ed, pq, human_classical, human_pq, params, &MandateChainOptions)` | Mandato raiz assinado pelo humano, com `sub_delegation` e `minimum_security_tier` opcionais |
| `create_sub_mandate(ed, pq, classical, pq_key, &parent, SubMandateParams { .. })` | Submandato assinado pelo agente do mandato pai sob o contexto `DCP-AI.v2.SubMandate` |
| `verify_mandate_chain(&chain, &revoked_ids, &MandateChainKeys { human_keys, agent_keys }, now_millis)` | Verifica a cadeia começando pela raiz e offline (assinaturas até o humano, vínculos e profundidade, `sub_delegation`, validade aninhada, atenuação de ações, `data_classes` e `limits`, piso de nível, revogação); retorna `MandateChainResult { valid, errors, depth, effective_tier }` |

### Feature `wasm`

Quando a feature `wasm` está habilitada, a crate expõe bindings WebAssembly:

```rust
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

### Dependências

- `serde` + `serde_json` — Serialização
- `sha2` — SHA-256
- `sha3` — SHA3-256 (cadeias de hash duplas)
- `ed25519-dalek` — Criptografia Ed25519
- `fips203` / `fips204` / `fips205` — ML-KEM-768, ML-DSA-65 e SLH-DSA-192f (FIPS 203 / 204 / 205)
- `rand` — Geração de números aleatórios
- `base64` — Codificação Base64
- `hex` — Codificação Hex
- `wasm-bindgen` (opcional) — Bindings WASM

## Licença

Apache-2.0
