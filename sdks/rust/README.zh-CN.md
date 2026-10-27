<sub>[English](README.md) · **中文** · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

# dcp-ai — Rust SDK

**Rust 发布 (26/10/2026).** Rust `dcp-ai` 2.11.0 已在 crates.io 发布，包含验证器修复、准入和实验性显式启用 API。`dcp-jcs-v1` 仍是规范性默认配置。见 [Rust 2.11.0](../../docs/RUST_RELEASE.md).

> 本文是[英文 README](README.md)的参考译文，更新于2026年10月25日。为保留经过验证的示例，标识符和代码块（包括注释）均保持原文。

Digital Citizenship Protocol（DCP v2.0）的官方 Rust SDK。提供基于 Serde 的类型、混合后量子密码学（Ed25519 + ML-DSA-65 + SLH-DSA-192f + ML-KEM-768）、使用 `pq_over_classical` 绑定的复合签名、双哈希链、OpenTelemetry 可观测性、DCP-04..09 行为以及可选的 WebAssembly 支持。

验证检查完整性和签名，不会建立对责任主体的信任、准入资格或行动授权。尚未发布的源代码中的 V2 验证器检查主审计链，以及存在的可选 SHA3-256 次级链接、意图哈希和次级 Merkle 根（不存在的不作要求）；已发布的 2.11.0 不检查次级字段。请参阅[已记录的验证限制](../../docs/STORAGE_AND_ANCHORING.md#dual-hash-chains)；需要检查信任时，请使用下文的准入 API。

<a id="installation"></a>

## 安装

**Rust SDK 2.11.0。** 本版本包含 V2 bundle 构建与签名、基于显式责任主体信任和 `strict-v1` 的准入、委托链、验证器修复以及实验性显式启用的 `dcp-jcs-v2` API。`dcp-jcs-v1` 仍是规范性默认配置。旧版本接受的无效证据现在可能被拒绝。Rust 尚未实现 A2A 会话加密及其重放窗口；发现和握手辅助功能仍可用。

```toml
[dependencies]
dcp-ai = "2.11.0"
```

启用 OpenTelemetry/OTLP 导出：

```toml
[dependencies]
dcp-ai = { version = "2.11.0", features = ["otlp"] }
```

启用 WebAssembly 支持：

```toml
[dependencies]
dcp-ai = { version = "2.11.0", features = ["wasm"] }
```

<a id="features"></a>

## 功能

| 领域 | 状态 |
|---|---|
| Ed25519 / ML-DSA-65 / SLH-DSA-192f / ML-KEM-768 提供程序 | 支持 |
| 复合签名（`pq_over_classical`）及验证 | 支持 |
| 规范化 JSON v2 与域分离 | 支持 |
| 双哈希（SHA-256 + SHA3-256）与 Merkle 根 | 支持 |
| Bundle 验证（V1 + V2；V2 遵循验证器策略和安全等级，`verify_signed_bundle_v2_with_policy`） | 支持 |
| V2 bundle 构建与签名（`dcp_ai::v2::bundle`：`build_bundle_v2`、`sign_bundle_v2`；`wasm` 功能的 `wasm_build_bundle` / `wasm_sign_bundle` 调用它们；尚无 PQ 检查点） | 支持 |
| DCP-05 智能体生命周期（启用 / 活力 / 停用） | 支持 |
| DCP-06 数字继承（遗嘱、记忆转移、仪式） | 支持 |
| DCP-07 争议解决、仲裁与判例 | 支持 |
| DCP-08 权利、义务与合规 | 支持 |
| DCP-09 委托与可验证委托链（`create_sub_mandate`、`verify_mandate_chain`、§3.5）、认知阈值与责任主体镜像 | 支持 |
| DCP-04 A2A 发现、握手与会话 ID 派生 | 支持 |
| DCP-04 A2A AES-256-GCM 会话加密 | _推迟到后续版本_ |
| 会话 nonce 辅助函数、安全等级引擎（`compute_security_tier(&intent, Some(&policy_decision))`，规范 §14.2；`compute_security_tier_with_floor` 纳入委托链的等级）、紧急撤销 | 支持 |
| 延迟 PQ 检查点与 `PQCheckpointManager` | 支持 |
| 盲化 RPR、多方授权、算法通告辅助函数 | 支持 |
| 通用错误码（所有 SDK 共享 38 个）与 `detect_wire_format` | 支持 |
| OpenTelemetry / OTLP 导出器（可选 `otlp` 功能） | 支持 |
| 准入：可信责任主体与 `strict-v1` 配置 | 支持 |
| 规范化候选方案 `dcp-jcs-v2`（入口处理、路由器、字节验证器、生成器） | 实验性，须显式选择；非规范性 |

<a id="quickstart"></a>

## 快速入门

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

### 验证已签名的 bundle

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

## API 参考

<a id="crypto-dcp_aicrypto"></a>

### 密码学（`dcp_ai::crypto`）

| 函数 | 签名 | 说明 |
|----------|-----------|-------------|
| `generate_keypair()` | `() -> (String, String)` | 返回 `(public_key_b64, secret_key_b64)` |
| `sign_object(obj, secret_key_b64)` | `(&Value, &str) -> Result<String, String>` | 签名并返回 base64 |
| `verify_object(obj, sig_b64, pub_b64)` | `(&Value, &str, &str) -> Result<bool, String>` | 验证签名 |
| `canonicalize(obj)` | `(&Value) -> String` | 确定性 JSON |
| `hash_object(obj)` | `(&Value) -> String` | SHA-256 十六进制表示 |
| `merkle_root_from_hex_leaves(leaves)` | `(&[String]) -> Option<String>` | Merkle 根 |

<a id="verification-dcp_aiverify"></a>

### 验证（`dcp_ai::verify`）

```rust
// Signature (not runnable)
fn verify_signed_bundle(
    signed_bundle: &Value,
    public_key_b64: Option<&str>,
) -> VerificationResult
```

验证内容：Ed25519 签名、`bundle_hash`、`merkle_root`、`intent_hash` 链与 `prev_hash` 链。

<a id="types-dcp_aitypes"></a>

### 类型（`dcp_ai::types`）

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

所有结构体均实现 `Serialize` + `Deserialize`（serde）。

<a id="v2-types-dcp_aiv2types"></a>

### V2 类型（`dcp_ai::v2::types`）

V2 为 DCP-05 至 DCP-09 的所有产物提供派生了 Serde trait 的结构体：

| 规范 | 类型 |
|------|-------|
| DCP-05 | `LifecycleState`, `CommissioningCertificate`, `VitalityReport`, `VitalityMetrics`, `DecommissioningRecord`, `TerminationMode`, `DataDisposition` |
| DCP-06 | `DigitalTestament`, `SuccessionRecord`, `MemoryTransferManifest`, `MemoryTransferEntry`, `SuccessorPreference`, `MemoryClassification`, `TransitionType`, `MemoryDisposition` |
| DCP-07 | `DisputeRecord`, `ArbitrationResolution`, `JurisprudenceBundle`, `ObjectionRecord`, `DisputeType`, `EscalationLevel`, `DisputeStatus`, `ObjectionType`, `AuthorityLevel` |
| DCP-08 | `RightsDeclaration`, `RightEntry`, `ObligationRecord`, `RightsViolationReport`, `RightType`, `ComplianceStatus` |
| DCP-09 | `DelegationMandate`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `AwarenessThreshold`, `ThresholdRule`, `AuthorityScopeEntry` |

域分离常量：`CTX_LIFECYCLE`、`CTX_SUCCESSION`、`CTX_DISPUTE`、`CTX_RIGHTS`、`CTX_DELEGATION`、`CTX_AWARENESS`

所有结构体均派生 `Debug`、`Clone`、`Serialize`、`Deserialize`。枚举使用 `#[serde(rename_all = "snake_case")]`。可选字段使用 `Option<T>` 并配合 `#[serde(skip_serializing_if = "Option::is_none")]`。

<a id="bundles-dcp_aiv2bundle-unreleased"></a>
<a id="bundles-dcp_aiv2bundle"></a>

### Bundles（`dcp_ai::v2::bundle`）

| 函数 | 说明 |
|----------|-------------|
| `build_bundle_v2(&rpr, &passport, &intent, &policy, &audit_entries, session_nonce)` | 从四个 `SignedPayload` 和审计轨迹构建 V2 bundle。检查每个 `payload_hash` 以及每个产物和审计条目的 `session_nonce`，并将两个审计 Merkle 根写入清单；空轨迹的根为64个零 |
| `sign_bundle_v2(bundle, &classical, &pq)` | 在 `CTX_BUNDLE` 域下对清单进行复合签名，返回 `{bundle, signature}`，其中 `signer.id` 为 RPR 的 `human_id`。在签名前将 `session_expires_at` 或 `intended_verifier` 放入清单；若存在 `session_expires_at` 而缺少 `session_issued_at`，则将 `session_issued_at` 设为签名时刻 |

<a id="delegation-chains-dcp_aiv2delegation-dcp-09-35-unreleased"></a>
<a id="delegation-chains-dcp_aiv2delegation-dcp-09-35"></a>

### 委托链（`dcp_ai::v2::delegation`，DCP-09 §3.5）

| 函数 | 说明 |
|----------|-------------|
| `create_delegation_mandate_with_options(ed, pq, human_classical, human_pq, params, &MandateChainOptions)` | 由人类签署的根委托，带有可选的 `sub_delegation` 和 `minimum_security_tier` |
| `create_sub_mandate(ed, pq, classical, pq_key, &parent, SubMandateParams { .. })` | 由父委托的智能体在 `DCP-AI.v2.SubMandate` 域下签署的子委托 |
| `verify_mandate_chain(&chain, &revoked_ids, &MandateChainKeys { human_keys, agent_keys }, now_millis)` | 从根开始离线验证委托链（追溯至人类的签名、链接与深度、`sub_delegation`、嵌套有效期、行动及 `data_classes` 和 `limits` 的权限收窄、最低等级、撤销状态）；返回 `MandateChainResult { valid, errors, depth, effective_tier }` |

<a id="admission-dcp_aiv2-specprofilesadmission-unreleased"></a>
<a id="admission-dcp_aiv2-specprofilesadmission"></a>

### 准入（`dcp_ai::v2`，spec/profiles/admission）

判断是否将已验证的 V2 bundle 接受为来自运营方已信任责任主体的证据，可选择遵循 `strict-v1` 配置。信任集合、配置和撤销信息源由运营方指定，绝不从 bundle 或请求中获取。

| 函数 | 说明 |
|----------|-------------|
| `verify_signed_bundle_v2_at(&b, &policy, now_ms)` | 在 `now_ms`（自 Unix 纪元起的毫秒数）运行 `verify_signed_bundle_v2_with_policy`，所有时间检查均使用该值；其他两个验证函数使用系统时钟。返回 `V2VerificationDetails`：`result` 中包含相同的 `V2VerificationResult`，`signer_keys` 列出每个已检查复合签名中各组件解析得到的密钥及其验证结果。`V2VerificationResult` 保持十字段结构，其他两个函数保持原有签名 |
| `PrincipalTrustStore::from_json(&json)` | 加载信任集合（`schemas/v2/principal_trust_set.schema.json`） |
| `resolve_strict_v1_profile(&json)` | 加载 `strict-v1` 配置（`schemas/v2/admission_profile.schema.json`）；`policy()`、`verifier_id()`、`max_session_duration_seconds()` 和 `max_revocation_age_seconds()` 均为只读 |
| `revocation_subjects(&b, &verification)` | 护照中的 `agent_id` 和已验证签名者密钥的已排序 kid，供运营方的撤销信息源使用 |
| `evaluate_admission_v2(&b, &verification, &AdmissionOptions { .. })` | 根据验证结果评估准入，不执行密码学运算或 I/O |
| `admit_signed_bundle_v2(&b, &AdmitOptions { .. })` | 在 `now_ms`（为 `None` 时使用系统时钟）遵循配置中的策略验证；无配置时使用 `policy`，之后进行评估 |

信任集合或配置无法加载、配置没有信任集合、配置与调用方策略同时使用时，均返回 `AdmissionConfigError { code, message }`。`AdmissionResult` 使用 §5.2 中的键序列化（`verified`、`verification`、`principal_trust`、`profile`、`profile_compliance`、`admitted`、`action_authorized`、`recorded_decision`、`trust_set_version`、`errors`）；`action_authorized` 始终为 `false`。配置中的 `verifier_policy` 可以缩小 `accepted_classical_algs` 和 `accepted_pq_algs` 的范围，验证器会执行这些限制；`min_classical`、`min_pq`、`accepted_hash_algs` 和 `max_key_age_days` 固定为默认值。

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
<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in"></a>

### 实验性功能：规范化候选方案 `dcp-jcs-v2`（须显式选择）

非规范性且未激活：`dcp-jcs-v1` 仍是唯一的规范化配置，默认设置、构建器、签名器和验证器均不改变。这些模块在 2.11.0 中仅供调用方显式启用。验证通过的候选 bundle 也不赋予信任或准入资格。设计与契约：[`docs/proposals/canonicalization-candidate`](../../docs/proposals/canonicalization-candidate/README.md)（§15 入口处理、§16 路由器、§17 验证器、§18 生成器）。

| 模块 | API |
|---|---|
| `dcp_ai::v2::experimental_candidate_ingress` | `experimental_candidate_ingress(&[u8])`：`CandidateIngressOutcome::Accept { value, canonical, canonical_sha256 }` 或 `Reject { class, offset }` |
| `dcp_ai::v2::experimental_candidate_router` | `CandidateRouter::new(CandidateRouterConfig { transport, accepted_profiles, historical })`；解码器 `HistoricalAdapter::serde_json_from_slice()`，均不是默认选项 |
| `dcp_ai::v2::experimental_candidate_verify` | `CandidateVerifier::new(config)` 和 `verify_at(input, policy, now_ms)` |
| `dcp_ai::v2::experimental_candidate_produce` | `sign_payload(context, &CandidateInput, &CandidateKeys)` 和 `sign_bundle(&BundleParts, &BundleSigner, &BundleOptions)`；输入的域或形式问题返回 `ProduceError::Reject`（在任何签名器运行之前），另有 `Usage`、`Provider` |

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

### `wasm` 功能

启用 `wasm` 功能后，crate 会暴露 WebAssembly 绑定：

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

为 WASM 编译：

```bash
cargo build --target wasm32-unknown-unknown --features wasm
```

<a id="development"></a>

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

<a id="dependencies"></a>

### 依赖

- `serde` + `serde_json` — 序列化
- `sha2` — SHA-256
- `sha3` — SHA3-256（双哈希链）
- `ed25519-dalek` — Ed25519 密码学
- `fips203` / `fips204` / `fips205` — ML-KEM-768、ML-DSA-65 和 SLH-DSA-192f（FIPS 203 / 204 / 205）
- `rand` — 随机数生成
- `base64` — Base64 编码
- `hex` — 十六进制编码
- `wasm-bindgen`（可选）— WASM 绑定

<a id="license"></a>

## 许可证

Apache-2.0
