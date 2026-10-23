<sub>[English](README.md) · [中文](README.zh-CN.md) · **Español** · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

# dcp-ai — SDK Rust

SDK oficial de Rust para el Digital Citizenship Protocol (DCP v2.0). Tipos basados en Serde, criptografía híbrida post-cuántica (Ed25519 + ML-DSA-65 + SLH-DSA-192f + ML-KEM-768), firmas compuestas con enlace `pq_over_classical`, cadenas duales de hash, observabilidad con OpenTelemetry, comportamiento DCP-04..09 y soporte opcional para WebAssembly.

## Instalación

Agrega a `Cargo.toml`:

```toml
[dependencies]
dcp-ai = "2.10"
```

Con exportador OpenTelemetry/OTLP:

```toml
[dependencies]
dcp-ai = { version = "2.10", features = ["otlp"] }
```

Para soporte WebAssembly:

```toml
[dependencies]
dcp-ai = { version = "2.10", features = ["wasm"] }
```

## Características

| Área | Estado |
|---|---|
| Providers Ed25519 / ML-DSA-65 / SLH-DSA-192f / ML-KEM-768 | Sí |
| Firmas compuestas (`pq_over_classical`) + verificación | Sí |
| JSON canónico v2 + separación de dominio | Sí |
| Hash dual (SHA-256 + SHA3-256) + raíces de Merkle | Sí |
| Verificación de bundle (V1 + V2; V2 con política de verificador y nivel de seguridad, `verify_signed_bundle_v2_with_policy`) | Sí |
| Construcción y firma de bundles V2 (`dcp_ai::v2::bundle`: `build_bundle_v2`, `sign_bundle_v2`; `wasm_build_bundle` / `wasm_sign_bundle` de la feature `wasm` las llaman; aún sin checkpoints PQ) | Sí |
| Ciclo de vida de agente DCP-05 (commissioning / vitalidad / decommissioning) | Sí |
| Sucesión digital DCP-06 (testamento, transferencia de memoria, ceremonia) | Sí |
| Resolución de disputas + arbitraje + jurisprudencia DCP-07 | Sí |
| Derechos + obligaciones + compliance DCP-08 | Sí |
| Delegación + cadenas de delegación verificables (`create_sub_mandate`, `verify_mandate_chain`, §3.5) + umbral de conciencia + espejo del principal DCP-09 | Sí |
| Descubrimiento A2A DCP-04 + handshake + derivación de id de sesión | Sí |
| Cifrado de sesión A2A AES-256-GCM DCP-04 | _Diferido a una release posterior_ |
| Helpers de nonce de sesión, motor de nivel de seguridad (`compute_security_tier(&intent, Some(&policy_decision))`, spec §14.2; `compute_security_tier_with_floor` añade el nivel de una cadena de delegación), revocación de emergencia | Sí |
| Checkpoints PQ perezosos + `PQCheckpointManager` | Sí |
| RPR blinded, autorización multi-parte, helpers de aviso de algoritmo | Sí |
| Códigos de error canónicos (38 compartidos entre todos los SDKs) + `detect_wire_format` | Sí |
| Exportador OpenTelemetry / OTLP (feature opcional `otlp`) | Sí |

## Inicio Rápido

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

### Verificar un Signed Bundle

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

## Referencia de API

### Crypto (`dcp_ai::crypto`)

| Función | Firma | Descripción |
|----------|-----------|-------------|
| `generate_keypair()` | `() -> (String, String)` | Devuelve `(public_key_b64, secret_key_b64)` |
| `sign_object(obj, secret_key_b64)` | `(&Value, &str) -> Result<String, String>` | Firma, devuelve base64 |
| `verify_object(obj, sig_b64, pub_b64)` | `(&Value, &str, &str) -> Result<bool, String>` | Verifica firma |
| `canonicalize(obj)` | `(&Value) -> String` | JSON determinístico |
| `hash_object(obj)` | `(&Value) -> String` | SHA-256 hex |
| `merkle_root_from_hex_leaves(leaves)` | `(&[String]) -> Option<String>` | Raíz de Merkle |

### Verificación (`dcp_ai::verify`)

```rust
fn verify_signed_bundle(
    signed_bundle: &Value,
    public_key_b64: Option<&str>,
) -> VerificationResult
```

Verifica: firma Ed25519, `bundle_hash`, `merkle_root`, cadena de `intent_hash`, cadena de `prev_hash`.

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

Todos los structs implementan `Serialize` + `Deserialize` (serde).

### Tipos V2 (`dcp_ai::v2::types`)

V2 incluye structs derivados con Serde para todos los artefactos de DCP-05 a DCP-09:

| Spec | Tipos |
|------|-------|
| DCP-05 | `LifecycleState`, `CommissioningCertificate`, `VitalityReport`, `VitalityMetrics`, `DecommissioningRecord`, `TerminationMode`, `DataDisposition` |
| DCP-06 | `DigitalTestament`, `SuccessionRecord`, `MemoryTransferManifest`, `MemoryTransferEntry`, `SuccessorPreference`, `MemoryClassification`, `TransitionType`, `MemoryDisposition` |
| DCP-07 | `DisputeRecord`, `ArbitrationResolution`, `JurisprudenceBundle`, `ObjectionRecord`, `DisputeType`, `EscalationLevel`, `DisputeStatus`, `ObjectionType`, `AuthorityLevel` |
| DCP-08 | `RightsDeclaration`, `RightEntry`, `ObligationRecord`, `RightsViolationReport`, `RightType`, `ComplianceStatus` |
| DCP-09 | `DelegationMandate`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `AwarenessThreshold`, `ThresholdRule`, `AuthorityScopeEntry` |

Constantes de separación de dominio: `CTX_LIFECYCLE`, `CTX_SUCCESSION`, `CTX_DISPUTE`, `CTX_RIGHTS`, `CTX_DELEGATION`, `CTX_AWARENESS`

Todos los structs derivan `Debug`, `Clone`, `Serialize`, `Deserialize`. Los enums usan `#[serde(rename_all = "snake_case")]`. Los campos opcionales usan `Option<T>` con `#[serde(skip_serializing_if = "Option::is_none")]`.

### Bundles (`dcp_ai::v2::bundle`)

| Función | Descripción |
|----------|-------------|
| `build_bundle_v2(&rpr, &passport, &intent, &policy, &audit_entries, session_nonce)` | Construye el bundle V2 con los cuatro `SignedPayload` y la auditoría. Comprueba cada `payload_hash` y el `session_nonce` de cada artefacto y entrada de auditoría, y escribe el manifiesto con las dos raíces Merkle de la auditoría; una auditoría vacía lleva raíces de 64 ceros |
| `sign_bundle_v2(bundle, &classical, &pq)` | Firma el manifiesto con firma compuesta bajo `CTX_BUNDLE` y devuelve `{bundle, signature}`, con `signer.id` igual al `human_id` del RPR. Pon `session_expires_at` o `intended_verifier` en el manifiesto antes de firmar; con `session_expires_at` y sin `session_issued_at`, fija `session_issued_at` al momento de la firma |

### Cadenas de Delegación (`dcp_ai::v2::delegation`, DCP-09 §3.5)

| Función | Descripción |
|----------|-------------|
| `create_delegation_mandate_with_options(ed, pq, human_classical, human_pq, params, &MandateChainOptions)` | Mandato raíz firmado por el humano, con `sub_delegation` y `minimum_security_tier` opcionales |
| `create_sub_mandate(ed, pq, classical, pq_key, &parent, SubMandateParams { .. })` | Submandato firmado por el agente del mandato padre bajo el contexto `DCP-AI.v2.SubMandate` |
| `verify_mandate_chain(&chain, &revoked_ids, &MandateChainKeys { human_keys, agent_keys }, now_millis)` | Verifica la cadena empezando por la raíz y offline (firmas hasta el humano, enlaces y profundidad, `sub_delegation`, validez anidada, atenuación de acciones, `data_classes` y `limits`, nivel mínimo, revocación); devuelve `MandateChainResult { valid, errors, depth, effective_tier }` |

### Feature `wasm`

Cuando el feature `wasm` está habilitado, el crate expone bindings WebAssembly:

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

## Desarrollo

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

### Dependencias

- `serde` + `serde_json` — Serialización
- `sha2` — SHA-256
- `sha3` — SHA3-256 (cadenas de hash dobles)
- `ed25519-dalek` — Criptografía Ed25519
- `fips203` / `fips204` / `fips205` — ML-KEM-768, ML-DSA-65 y SLH-DSA-192f (FIPS 203 / 204 / 205)
- `rand` — Generación de números aleatorios
- `base64` — Codificación Base64
- `hex` — Codificación Hex
- `wasm-bindgen` (opcional) — Bindings WASM

## Licencia

Apache-2.0
