<sub>[English](README.md) · **中文** · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

# dcp-ai — Rust SDK

数字公民身份协议 (DCP v2.0) 的官方 Rust SDK。基于 Serde 的类型、混合后量子密码学 (Ed25519 + ML-DSA-65 + SLH-DSA-192f + ML-KEM-768)、带 `pq_over_classical` 绑定的复合签名、双哈希链、OpenTelemetry 可观测性、DCP-04..09 行为，以及可选的 WebAssembly 支持。

## 安装

添加到 `Cargo.toml`：

```toml
[dependencies]
dcp-ai = "2.7"
```

启用 OpenTelemetry/OTLP 导出：

```toml
[dependencies]
dcp-ai = { version = "2.7", features = ["otlp"] }
```

启用 WebAssembly 支持：

```toml
[dependencies]
dcp-ai = { version = "2.7", features = ["wasm"] }
```

## 功能

| 范畴 | 状态 |
|---|---|
| Ed25519 / ML-DSA-65 / SLH-DSA-192f / ML-KEM-768 provider | 是 |
| 复合签名 (`pq_over_classical`) + 验证 | 是 |
| 规范 JSON v2 + 域分离 | 是 |
| 双哈希 (SHA-256 + SHA3-256) + Merkle 根 | 是 |
| 凭证包验证 (V1 + V2) | 是 |
| DCP-05 代理生命周期（委任 / 活力 / 停用） | 是 |
| DCP-06 数字继承（数字遗嘱、记忆迁移、交接仪式） | 是 |
| DCP-07 争议解决 + 仲裁 + 判例 | 是 |
| DCP-08 权利与义务 + 合规 | 是 |
| DCP-09 委托 + 感知阈值 + 主体镜像 | 是 |
| DCP-04 A2A 发现 + 握手 + 会话 ID 派生 | 是 |
| DCP-04 A2A AES-256-GCM 会话加密 | _延后至后续版本_ |
| 会话随机数助手、安全等级引擎、紧急撤销 | 是 |
| 惰性 PQ 检查点 + `PQCheckpointManager` | 是 |
| 盲化 RPR、多方授权、算法建议助手 | 是 |
| 规范错误码（38 项，跨所有 SDK 共享）+ `detect_wire_format` | 是 |
| OpenTelemetry / OTLP 导出器（可选 `otlp` 特性） | 是 |

## 快速开始

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

### 验证已签名凭证包

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

## API 参考

### 加密 (`dcp_ai::crypto`)

| 函数 | 签名 | 描述 |
|----------|-----------|-------------|
| `generate_keypair()` | `() -> (String, String)` | 返回 `(public_key_b64, secret_key_b64)` |
| `sign_object(obj, secret_key_b64)` | `(&Value, &str) -> Result<String, String>` | 签名，返回 base64 |
| `verify_object(obj, sig_b64, pub_b64)` | `(&Value, &str, &str) -> Result<bool, String>` | 验证签名 |
| `canonicalize(obj)` | `(&Value) -> String` | 确定性 JSON |
| `hash_object(obj)` | `(&Value) -> String` | SHA-256 十六进制 |
| `merkle_root_from_hex_leaves(leaves)` | `(&[String]) -> Option<String>` | Merkle 根 |

### 验证 (`dcp_ai::verify`)

```rust
fn verify_signed_bundle(
    signed_bundle: &Value,
    public_key_b64: Option<&str>,
) -> VerificationResult
```

验证项：Ed25519 签名、`bundle_hash`、`merkle_root`、`intent_hash` 链、`prev_hash` 链。

### 类型 (`dcp_ai::types`)

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

所有 struct 均实现 `Serialize` + `Deserialize` (serde)。

### V2 类型 (`dcp_ai::v2::types`)

V2 包含针对 DCP-05 至 DCP-09 全部工件的 Serde 派生 struct：

| 规范 | 类型 |
|------|-------|
| DCP-05 | `LifecycleState`、`CommissioningCertificate`、`VitalityReport`、`VitalityMetrics`、`DecommissioningRecord`、`TerminationMode`、`DataDisposition` |
| DCP-06 | `DigitalTestament`、`SuccessionRecord`、`MemoryTransferManifest`、`MemoryTransferEntry`、`SuccessorPreference`、`MemoryClassification`、`TransitionType`、`MemoryDisposition` |
| DCP-07 | `DisputeRecord`、`ArbitrationResolution`、`JurisprudenceBundle`、`ObjectionRecord`、`DisputeType`、`EscalationLevel`、`DisputeStatus`、`ObjectionType`、`AuthorityLevel` |
| DCP-08 | `RightsDeclaration`、`RightEntry`、`ObligationRecord`、`RightsViolationReport`、`RightType`、`ComplianceStatus` |
| DCP-09 | `DelegationMandate`、`AdvisoryDeclaration`、`PrincipalMirror`、`InteractionRecord`、`AwarenessThreshold`、`ThresholdRule`、`AuthorityScopeEntry` |

域分离常量：`CTX_LIFECYCLE`、`CTX_SUCCESSION`、`CTX_DISPUTE`、`CTX_RIGHTS`、`CTX_DELEGATION`、`CTX_AWARENESS`

所有 struct 派生 `Debug`、`Clone`、`Serialize`、`Deserialize`。枚举使用 `#[serde(rename_all = "snake_case")]`。可选字段使用 `Option<T>` 并带 `#[serde(skip_serializing_if = "Option::is_none")]`。

### `wasm` 特性

启用 `wasm` 特性后，crate 会暴露 WebAssembly 绑定：

```rust
// Available via wasm-bindgen
fn wasm_verify_signed_bundle(json: &str, pub_key: Option<String>) -> String;
fn wasm_hash_object(json: &str) -> String;
fn wasm_generate_keypair() -> String;
```

为 WASM 编译：

```bash
cargo build --target wasm32-unknown-unknown --features wasm
```

## 开发

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

### 依赖

- `serde` + `serde_json` — 序列化
- `sha2` — SHA-256
- `ed25519-dalek` — Ed25519 密码学
- `rand` — 随机数生成
- `base64` — Base64 编码
- `hex` — 十六进制编码
- `wasm-bindgen`（可选）— WASM 绑定

## 许可证

Apache-2.0
