# dcp-ai — Rust SDK

Official Rust SDK for the Digital Citizenship Protocol (DCP). Serde-based types, Ed25519 via ed25519-dalek, and optional WebAssembly support.

## Installation

Add to `Cargo.toml`:

```toml
[dependencies]
dcp-ai = "1.0"
```

For WebAssembly support:

```toml
[dependencies]
dcp-ai = { version = "1.0", features = ["wasm"] }
```

## Quickstart

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

### Verify a Signed Bundle

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

## API Reference

### Crypto (`dcp_ai::crypto`)

| Function | Signature | Description |
|----------|-----------|-------------|
| `generate_keypair()` | `() -> (String, String)` | Returns `(public_key_b64, secret_key_b64)` |
| `sign_object(obj, secret_key_b64)` | `(&Value, &str) -> Result<String, String>` | Signs, returns base64 |
| `verify_object(obj, sig_b64, pub_b64)` | `(&Value, &str, &str) -> Result<bool, String>` | Verifies signature |
| `canonicalize(obj)` | `(&Value) -> String` | Deterministic JSON |
| `hash_object(obj)` | `(&Value) -> String` | SHA-256 hex |
| `merkle_root_from_hex_leaves(leaves)` | `(&[String]) -> Option<String>` | Merkle root |

### Verification (`dcp_ai::verify`)

```rust
fn verify_signed_bundle(
    signed_bundle: &Value,
    public_key_b64: Option<&str>,
) -> VerificationResult
```

Verifies: Ed25519 signature, `bundle_hash`, `merkle_root`, `intent_hash` chain, `prev_hash` chain.

### Types (`dcp_ai::types`)

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

All structs implement `Serialize` + `Deserialize` (serde).

### Feature `wasm`

When the `wasm` feature is enabled, the crate exposes WebAssembly bindings:

```rust
// Available via wasm-bindgen
fn wasm_verify_signed_bundle(json: &str, pub_key: Option<String>) -> String;
fn wasm_hash_object(json: &str) -> String;
fn wasm_generate_keypair() -> String;
```

Compile for WASM:

```bash
cargo build --target wasm32-unknown-unknown --features wasm
```

## Development

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

### Dependencies

- `serde` + `serde_json` — Serialization
- `sha2` — SHA-256
- `ed25519-dalek` — Ed25519 cryptography
- `rand` — Random number generation
- `base64` — Base64 encoding
- `hex` — Hex encoding
- `wasm-bindgen` (optional) — WASM bindings

## License

Apache-2.0
