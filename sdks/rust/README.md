# dcp-ai — Rust SDK

SDK oficial de Rust para el Digital Citizenship Protocol (DCP). Tipos con serde, Ed25519 con ed25519-dalek, y soporte opcional para WebAssembly.

## Instalacion

Agregar a `Cargo.toml`:

```toml
[dependencies]
dcp-ai = "1.0"
```

Para soporte WebAssembly:

```toml
[dependencies]
dcp-ai = { version = "1.0", features = ["wasm"] }
```

## Quickstart

```rust
use dcp_ai::crypto::{generate_keypair, sign_object, verify_object, hash_object};
use serde_json::json;

fn main() {
    // 1. Generar keypair Ed25519
    let (public_key_b64, secret_key_b64) = generate_keypair();
    println!("Public Key: {}", public_key_b64);

    // 2. Firmar un objeto
    let obj = json!({
        "agent_id": "agent-001",
        "action": "api_call"
    });
    let signature = sign_object(&obj, &secret_key_b64).unwrap();

    // 3. Verificar firma
    let valid = verify_object(&obj, &signature, &public_key_b64).unwrap();
    println!("Verificado: {}", valid); // true

    // 4. Hash SHA-256
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
    println!("Verificado: {}", result.verified);
    if !result.errors.is_empty() {
        println!("Errores: {:?}", result.errors);
    }
}
```

## API Reference

### Crypto (`dcp_ai::crypto`)

| Funcion | Firma | Descripcion |
|---------|-------|-------------|
| `generate_keypair()` | `() -> (String, String)` | Retorna `(public_key_b64, secret_key_b64)` |
| `sign_object(obj, secret_key_b64)` | `(&Value, &str) -> Result<String, String>` | Firma, retorna base64 |
| `verify_object(obj, sig_b64, pub_b64)` | `(&Value, &str, &str) -> Result<bool, String>` | Verifica firma |
| `canonicalize(obj)` | `(&Value) -> String` | JSON deterministico |
| `hash_object(obj)` | `(&Value) -> String` | SHA-256 hex |
| `merkle_root_from_hex_leaves(leaves)` | `(&[String]) -> Option<String>` | Raiz Merkle |

### Verificacion (`dcp_ai::verify`)

```rust
fn verify_signed_bundle(
    signed_bundle: &Value,
    public_key_b64: Option<&str>,
) -> VerificationResult
```

Verifica: firma Ed25519, `bundle_hash`, `merkle_root`, cadena `intent_hash`, cadena `prev_hash`.

### Tipos (`dcp_ai::types`)

```rust
pub struct HumanBindingRecord { ... }
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

### Feature `wasm`

Cuando se activa el feature `wasm`, el crate expone bindings para WebAssembly:

```rust
// Disponibles via wasm-bindgen
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

# Build con WASM
cargo build --features wasm

# Build para WASM target
cargo build --target wasm32-unknown-unknown --features wasm
```

### Dependencias

- `serde` + `serde_json` — Serializacion
- `sha2` — SHA-256
- `ed25519-dalek` — Criptografia Ed25519
- `rand` — Generacion de numeros aleatorios
- `base64` — Codificacion base64
- `hex` — Codificacion hexadecimal
- `wasm-bindgen` (opcional) — Bindings WASM

## Licencia

Apache-2.0
