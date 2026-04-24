<sub>[English](README.md) · [中文](README.zh-CN.md) · **Español** · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

# dcp-ai — SDK Rust

SDK oficial de Rust para el Digital Citizenship Protocol (DCP v2.0). Tipos basados en Serde, criptografía híbrida post-cuántica (Ed25519 + ML-DSA-65 + SLH-DSA-192f + ML-KEM-768), firmas compuestas con enlace `pq_over_classical`, cadenas duales de hash, observabilidad con OpenTelemetry, comportamiento DCP-04..09 y soporte opcional para WebAssembly.

## Instalación

Agrega a `Cargo.toml`:

```toml
[dependencies]
dcp-ai = "2.7"
```

Con exportador OpenTelemetry/OTLP:

```toml
[dependencies]
dcp-ai = { version = "2.7", features = ["otlp"] }
```

Para soporte WebAssembly:

```toml
[dependencies]
dcp-ai = { version = "2.7", features = ["wasm"] }
```

## Características

| Área | Estado |
|---|---|
| Providers Ed25519 / ML-DSA-65 / SLH-DSA-192f / ML-KEM-768 | Sí |
| Firmas compuestas (`pq_over_classical`) + verificación | Sí |
| JSON canónico v2 + separación de dominio | Sí |
| Hash dual (SHA-256 + SHA3-256) + raíces de Merkle | Sí |
| Verificación de bundle (V1 + V2) | Sí |
| Ciclo de vida de agente DCP-05 (commissioning / vitalidad / decommissioning) | Sí |
| Sucesión digital DCP-06 (testamento, transferencia de memoria, ceremonia) | Sí |
| Resolución de disputas + arbitraje + jurisprudencia DCP-07 | Sí |
| Derechos + obligaciones + compliance DCP-08 | Sí |
| Delegación + umbral de conciencia + espejo del principal DCP-09 | Sí |
| Descubrimiento A2A DCP-04 + handshake + derivación de id de sesión | Sí |
| Cifrado de sesión A2A AES-256-GCM DCP-04 | _Diferido a una release posterior_ |
| Helpers de nonce de sesión, motor de nivel de seguridad, revocación de emergencia | Sí |
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

### Feature `wasm`

Cuando el feature `wasm` está habilitado, el crate expone bindings WebAssembly:

```rust
// Available via wasm-bindgen
fn wasm_verify_signed_bundle(json: &str, pub_key: Option<String>) -> String;
fn wasm_hash_object(json: &str) -> String;
fn wasm_generate_keypair() -> String;
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
- `ed25519-dalek` — Criptografía Ed25519
- `rand` — Generación de números aleatorios
- `base64` — Codificación Base64
- `hex` — Codificación Hex
- `wasm-bindgen` (opcional) — Bindings WASM

## Licencia

Apache-2.0
