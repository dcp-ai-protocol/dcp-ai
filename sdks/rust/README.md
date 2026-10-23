<sub>**English** · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

# dcp-ai — Rust SDK

Official Rust SDK for the Digital Citizenship Protocol (DCP v2.0). Serde-based types, hybrid post-quantum cryptography (Ed25519 + ML-DSA-65 + SLH-DSA-192f + ML-KEM-768), composite signatures with `pq_over_classical` binding, dual hash chains, OpenTelemetry observability, DCP-04..09 behavior, and optional WebAssembly support.

## Installation

Add to `Cargo.toml`:

```toml
[dependencies]
dcp-ai = "2.10"
```

With OpenTelemetry/OTLP export:

```toml
[dependencies]
dcp-ai = { version = "2.10", features = ["otlp"] }
```

For WebAssembly support:

```toml
[dependencies]
dcp-ai = { version = "2.10", features = ["wasm"] }
```

## Features

| Area | Status |
|---|---|
| Ed25519 / ML-DSA-65 / SLH-DSA-192f / ML-KEM-768 providers | Yes |
| Composite signatures (`pq_over_classical`) + verification | Yes |
| Canonical JSON v2 + domain separation | Yes |
| Dual hash (SHA-256 + SHA3-256) + Merkle roots | Yes |
| Bundle verification (V1 + V2; V2 under a verifier policy and the security tier, `verify_signed_bundle_v2_with_policy`) | Yes |
| V2 bundle building & signing | `wasm` feature: `wasm_build_bundle` / `wasm_sign_bundle`. Native API: not yet; assemble the manifest from `prepare_payload`, `composite_sign` and `audit_events_merkle_root`, as `tools/interop-matrix/agents/rust` does |
| DCP-05 agent lifecycle (commissioning / vitality / decommissioning) | Yes |
| DCP-06 digital succession (testament, memory transfer, ceremony) | Yes |
| DCP-07 dispute resolution + arbitration + jurisprudence | Yes |
| DCP-08 rights + obligations + compliance | Yes |
| DCP-09 delegation + verifiable delegation chains (`create_sub_mandate`, `verify_mandate_chain`, §3.5) + awareness threshold + principal mirror | Yes |
| DCP-04 A2A discovery + handshake + session id derivation | Yes |
| DCP-04 A2A AES-256-GCM session encryption | _Deferred to a follow-up release_ |
| Session nonce helpers, security tier engine (`compute_security_tier(&intent, Some(&policy_decision))`, spec §14.2; `compute_security_tier_with_floor` adds a delegation chain's tier), emergency revocation | Yes |
| Lazy PQ checkpoints + `PQCheckpointManager` | Yes |
| Blinded RPR, multi-party authorization, algorithm advisory helpers | Yes |
| Canonical error codes (38 shared across all SDKs) + `detect_wire_format` | Yes |
| OpenTelemetry / OTLP exporter (optional `otlp` feature) | Yes |

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

All structs implement `Serialize` + `Deserialize` (serde).

### V2 Types (`dcp_ai::v2::types`)

V2 includes Serde-derived structs for all DCP-05 through DCP-09 artifacts:

| Spec | Types |
|------|-------|
| DCP-05 | `LifecycleState`, `CommissioningCertificate`, `VitalityReport`, `VitalityMetrics`, `DecommissioningRecord`, `TerminationMode`, `DataDisposition` |
| DCP-06 | `DigitalTestament`, `SuccessionRecord`, `MemoryTransferManifest`, `MemoryTransferEntry`, `SuccessorPreference`, `MemoryClassification`, `TransitionType`, `MemoryDisposition` |
| DCP-07 | `DisputeRecord`, `ArbitrationResolution`, `JurisprudenceBundle`, `ObjectionRecord`, `DisputeType`, `EscalationLevel`, `DisputeStatus`, `ObjectionType`, `AuthorityLevel` |
| DCP-08 | `RightsDeclaration`, `RightEntry`, `ObligationRecord`, `RightsViolationReport`, `RightType`, `ComplianceStatus` |
| DCP-09 | `DelegationMandate`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `AwarenessThreshold`, `ThresholdRule`, `AuthorityScopeEntry` |

Domain separation constants: `CTX_LIFECYCLE`, `CTX_SUCCESSION`, `CTX_DISPUTE`, `CTX_RIGHTS`, `CTX_DELEGATION`, `CTX_AWARENESS`

All structs derive `Debug`, `Clone`, `Serialize`, `Deserialize`. Enums use `#[serde(rename_all = "snake_case")]`. Optional fields use `Option<T>` with `#[serde(skip_serializing_if = "Option::is_none")]`.

### Delegation Chains (`dcp_ai::v2::delegation`, DCP-09 §3.5)

| Function | Description |
|----------|-------------|
| `create_delegation_mandate_with_options(ed, pq, human_classical, human_pq, params, &MandateChainOptions)` | Root mandate signed by the human, with optional `sub_delegation` and `minimum_security_tier` |
| `create_sub_mandate(ed, pq, classical, pq_key, &parent, SubMandateParams { .. })` | Sub-mandate signed by the parent's agent under the `DCP-AI.v2.SubMandate` context |
| `verify_mandate_chain(&chain, &revoked_ids, &MandateChainKeys { human_keys, agent_keys }, now_millis)` | Verifies the chain root first and offline (signatures back to the human, links and depth, `sub_delegation`, nested validity, attenuation of actions, `data_classes` and `limits`, tier floor, revocation); returns `MandateChainResult { valid, errors, depth, effective_tier }` |

### Feature `wasm`

When the `wasm` feature is enabled, the crate exposes WebAssembly bindings:

```rust
// Available via wasm-bindgen
fn wasm_verify_signed_bundle(json: &str, pub_key: Option<String>) -> String;
fn wasm_verify_signed_bundle_v2(json: &str, policy_json: Option<String>) -> String; // default policy when None; V1 bundles are rejected under a policy
fn wasm_hash_object(json: &str) -> String;
fn wasm_generate_keypair() -> String;
fn wasm_build_bundle(rpr_json: &str, passport_json: &str, intent_json: &str, policy_json: &str, audit_entries_json: &str, session_nonce: &str /* , … */) -> String;
fn wasm_sign_bundle(bundle_json: &str, classical_sk_b64: &str, classical_kid: &str, pq_sk_b64: &str, pq_kid: &str) -> String;
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
- `sha3` — SHA3-256 (dual hash chains)
- `ed25519-dalek` — Ed25519 cryptography
- `fips203` / `fips204` / `fips205` — ML-KEM-768, ML-DSA-65 and SLH-DSA-192f (FIPS 203 / 204 / 205)
- `rand` — Random number generation
- `base64` — Base64 encoding
- `hex` — Hex encoding
- `wasm-bindgen` (optional) — WASM bindings

## License

Apache-2.0
