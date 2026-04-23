<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · **日本語** · [Português](README.pt-BR.md)</sub>

# dcp-ai — Rust SDK

デジタル市民権プロトコル (DCP) 公式Rust SDKです。Serdeベースの型、ed25519-dalekによるEd25519、オプションのWebAssemblyサポートを備えています。

## インストール

`Cargo.toml` に追加してください。

```toml
[dependencies]
dcp-ai = "1.0"
```

WebAssemblyサポートの場合:

```toml
[dependencies]
dcp-ai = { version = "1.0", features = ["wasm"] }
```

## クイックスタート

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

### 署名済みバンドルを検証する

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

## APIリファレンス

### 暗号 (`dcp_ai::crypto`)

| 関数 | シグネチャ | 説明 |
|----------|-----------|-------------|
| `generate_keypair()` | `() -> (String, String)` | `(public_key_b64, secret_key_b64)` を返す |
| `sign_object(obj, secret_key_b64)` | `(&Value, &str) -> Result<String, String>` | 署名し、base64を返す |
| `verify_object(obj, sig_b64, pub_b64)` | `(&Value, &str, &str) -> Result<bool, String>` | 署名を検証 |
| `canonicalize(obj)` | `(&Value) -> String` | 決定論的JSON |
| `hash_object(obj)` | `(&Value) -> String` | SHA-256のhex |
| `merkle_root_from_hex_leaves(leaves)` | `(&[String]) -> Option<String>` | Merkleルート |

### 検証 (`dcp_ai::verify`)

```rust
fn verify_signed_bundle(
    signed_bundle: &Value,
    public_key_b64: Option<&str>,
) -> VerificationResult
```

検証する内容: Ed25519署名、`bundle_hash`、`merkle_root`、`intent_hash` チェーン、`prev_hash` チェーン。

### 型 (`dcp_ai::types`)

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

すべての構造体は `Serialize` + `Deserialize` (serde) を実装しています。

### V2 型 (`dcp_ai::v2::types`)

V2には、DCP-05からDCP-09までのすべての成果物のためのSerde由来の構造体が含まれます。

| Spec | 型 |
|------|-------|
| DCP-05 | `LifecycleState`、`CommissioningCertificate`、`VitalityReport`、`VitalityMetrics`、`DecommissioningRecord`、`TerminationMode`、`DataDisposition` |
| DCP-06 | `DigitalTestament`、`SuccessionRecord`、`MemoryTransferManifest`、`MemoryTransferEntry`、`SuccessorPreference`、`MemoryClassification`、`TransitionType`、`MemoryDisposition` |
| DCP-07 | `DisputeRecord`、`ArbitrationResolution`、`JurisprudenceBundle`、`ObjectionRecord`、`DisputeType`、`EscalationLevel`、`DisputeStatus`、`ObjectionType`、`AuthorityLevel` |
| DCP-08 | `RightsDeclaration`、`RightEntry`、`ObligationRecord`、`RightsViolationReport`、`RightType`、`ComplianceStatus` |
| DCP-09 | `DelegationMandate`、`AdvisoryDeclaration`、`PrincipalMirror`、`InteractionRecord`、`AwarenessThreshold`、`ThresholdRule`、`AuthorityScopeEntry` |

ドメイン分離定数: `CTX_LIFECYCLE`、`CTX_SUCCESSION`、`CTX_DISPUTE`、`CTX_RIGHTS`、`CTX_DELEGATION`、`CTX_AWARENESS`

すべての構造体は `Debug`、`Clone`、`Serialize`、`Deserialize` を導出します。enumは `#[serde(rename_all = "snake_case")]` を使用します。オプションフィールドは `Option<T>` と `#[serde(skip_serializing_if = "Option::is_none")]` を使用します。

### フィーチャー `wasm`

`wasm` フィーチャーが有効化されている場合、crateはWebAssemblyバインディングを公開します。

```rust
// Available via wasm-bindgen
fn wasm_verify_signed_bundle(json: &str, pub_key: Option<String>) -> String;
fn wasm_hash_object(json: &str) -> String;
fn wasm_generate_keypair() -> String;
```

WASM向けにコンパイル:

```bash
cargo build --target wasm32-unknown-unknown --features wasm
```

## 開発

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

### 依存関係

- `serde` + `serde_json` — シリアライゼーション
- `sha2` — SHA-256
- `ed25519-dalek` — Ed25519暗号
- `rand` — 乱数生成
- `base64` — Base64エンコーディング
- `hex` — Hexエンコーディング
- `wasm-bindgen` (オプション) — WASMバインディング

## ライセンス

Apache-2.0
