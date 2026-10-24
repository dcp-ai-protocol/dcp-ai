<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · **日本語** · [Português](README.pt-BR.md)</sub>

# dcp-ai — Rust SDK

デジタル市民権プロトコル (DCP v2.0) 公式Rust SDKです。Serdeベースの型、ハイブリッド耐量子暗号 (Ed25519 + ML-DSA-65 + SLH-DSA-192f + ML-KEM-768)、`pq_over_classical` バインディングによる複合署名、デュアルハッシュチェーン、OpenTelemetryによるオブザーバビリティ、DCP-04..09の動作、およびオプションのWebAssemblyサポートを備えています。

## インストール

`Cargo.toml` に追加してください。

```toml
[dependencies]
dcp-ai = "2.10"
```

OpenTelemetry/OTLPエクスポートの場合:

```toml
[dependencies]
dcp-ai = { version = "2.10", features = ["otlp"] }
```

WebAssemblyサポートの場合:

```toml
[dependencies]
dcp-ai = { version = "2.10", features = ["wasm"] }
```

## 機能

| 領域 | 状態 |
|---|---|
| Ed25519 / ML-DSA-65 / SLH-DSA-192f / ML-KEM-768 プロバイダ | Yes |
| 複合署名 (`pq_over_classical`) + 検証 | Yes |
| 正規化JSON v2 + ドメイン分離 | Yes |
| デュアルハッシュ (SHA-256 + SHA3-256) + Merkleルート | Yes |
| バンドル検証 (V1 + V2。V2 は検証ポリシーとセキュリティティアを適用、`verify_signed_bundle_v2_with_policy`) | Yes |
| V2 バンドルの構築と署名（`dcp_ai::v2::bundle`: `build_bundle_v2`、`sign_bundle_v2`。`wasm` フィーチャーの `wasm_build_bundle` / `wasm_sign_bundle` はこれらを呼び出します。PQ チェックポイントは未対応） | はい |
| DCP-05 エージェントライフサイクル (コミッショニング / バイタリティ / デコミッショニング) | Yes |
| DCP-06 デジタル継承 (デジタル遺言、メモリ転送、セレモニー) | Yes |
| DCP-07 紛争解決 + 仲裁 + 判例 | Yes |
| DCP-08 権利と義務 + コンプライアンス | Yes |
| DCP-09 委任 + 検証可能な委任チェーン (`create_sub_mandate`、`verify_mandate_chain`、§3.5) + 認識しきい値 + プリンシパルミラー | Yes |
| DCP-04 A2A 発見 + ハンドシェイク + セッションID導出 | Yes |
| DCP-04 A2A AES-256-GCM セッション暗号化 | _後続リリースに延期_ |
| セッションノンスヘルパー、セキュリティティアエンジン（`compute_security_tier(&intent, Some(&policy_decision))`、spec §14.2。`compute_security_tier_with_floor` は委任チェーンのティアを加味する）、緊急失効 | Yes |
| 遅延PQチェックポイント + `PQCheckpointManager` | Yes |
| ブラインドRPR、マルチパーティ認可、アルゴリズムアドバイザリヘルパー | Yes |
| 正規エラーコード (全SDK共通の38種) + `detect_wire_format` | Yes |
| OpenTelemetry / OTLP エクスポーター (オプションの `otlp` フィーチャー) | Yes |

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

### バンドル (`dcp_ai::v2::bundle`)

| 関数 | 説明 |
|----------|-------------|
| `build_bundle_v2(&rpr, &passport, &intent, &policy, &audit_entries, session_nonce)` | 4 つの `SignedPayload` と監査証跡から V2 バンドルを構築します。各 `payload_hash` と、すべてのアーティファクトおよび監査エントリの `session_nonce` を検査し、2 つの監査 Merkle ルートを含むマニフェストを書き込みます。監査証跡が空の場合、ルートは 64 個のゼロです |
| `sign_bundle_v2(bundle, &classical, &pq)` | `CTX_BUNDLE` でマニフェストに複合署名し、`{bundle, signature}` を返します。`signer.id` は RPR の `human_id` です。`session_expires_at` や `intended_verifier` は署名前にマニフェストに入れてください。`session_expires_at` があり `session_issued_at` がなければ、`session_issued_at` に署名時刻を設定します |

### 委任チェーン (`dcp_ai::v2::delegation`、DCP-09 §3.5)

| 関数 | 説明 |
|----------|-------------|
| `create_delegation_mandate_with_options(ed, pq, human_classical, human_pq, params, &MandateChainOptions)` | 人間が署名するルートマンデート。`sub_delegation` と `minimum_security_tier` は任意 |
| `create_sub_mandate(ed, pq, classical, pq_key, &parent, SubMandateParams { .. })` | 親マンデートのエージェントが `DCP-AI.v2.SubMandate` コンテキストで署名するサブマンデート |
| `verify_mandate_chain(&chain, &revoked_ids, &MandateChainKeys { human_keys, agent_keys }, now_millis)` | チェーンをルートから順に、オフラインで検証 (人間まで遡る署名、リンクと深さ、`sub_delegation`、入れ子になった有効期間、アクション・`data_classes`・`limits` の権限の減衰、ティアの下限、失効)。`MandateChainResult { valid, errors, depth, effective_tier }` を返す |

### アドミッション: プリンシパルの信頼と strict-v1

検証済みのバンドルが証明するのは完全性と署名であり、プリンシパルが誰かではありません。アドミッション ([spec/profiles/admission](../../spec/profiles/admission/README.md)、ガイドは [docs/ADMISSION.md](../../docs/ADMISSION.md)) は、各プリンシパルの鍵を固定するオペレーターの信頼セットと、オペレーターが固定する `strict-v1` プロファイル (ハイブリッド署名、署名済みの宛先、最大 300 秒の署名済みセッション、最大 300 秒前の失効スナップショット) を追加します。ネットワーク I/O は行わず、アクションを許可することもありません: `action_authorized` は常に `false` です。読み込めない信頼セットやプロファイルは `AdmissionConfigError { code, message }` を返します。

| 関数 | 説明 |
|---|---|
| `verify_signed_bundle_v2_at(&b, &policy, now_ms)` | 指定した時刻で検証し、署名鍵 (`signer_keys`) を報告します |
| `PrincipalTrustStore::from_json(&json)` | 信頼セットを読み込んで検証します |
| `resolve_strict_v1_profile(&json)` | `strict-v1` プロファイルを読み込んで検証します (読み取り専用) |
| `revocation_subjects(&b, &verification)` | 失効ソースが答えるべき `agent_id` と検証済みの kid |
| `evaluate_admission_v2(&b, &verification, &opts)` | 検証結果からアドミッションを評価します (暗号処理も I/O もありません) |
| `admit_signed_bundle_v2(&b, &opts)` | プロファイルのポリシーで検証して評価します |

例を含む完全な説明は[英語の README](README.md#admission-dcp_aiv2-specprofilesadmission)にあります。

### フィーチャー `wasm`

`wasm` フィーチャーが有効化されている場合、crateはWebAssemblyバインディングを公開します。

```rust
// Available via wasm-bindgen
fn wasm_verify_signed_bundle(json: &str, pub_key: Option<String>) -> String;
fn wasm_verify_signed_bundle_v2(json: &str, policy_json: Option<String>) -> String; // default policy when None; V1 bundles are rejected under a policy
fn wasm_hash_object(json: &str) -> String;
fn wasm_generate_keypair() -> String;
fn wasm_build_bundle(rpr_json: &str, passport_json: &str, intent_json: &str, policy_json: &str, audit_entries_json: &str, session_nonce: &str) -> String;
fn wasm_sign_bundle(bundle_json: &str, classical_sk_b64: &str, classical_kid: &str, pq_sk_b64: &str, pq_kid: &str) -> String;
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
- `sha3` — SHA3-256（二重ハッシュチェーン）
- `ed25519-dalek` — Ed25519暗号
- `fips203` / `fips204` / `fips205` — ML-KEM-768、ML-DSA-65、SLH-DSA-192f（FIPS 203 / 204 / 205）
- `rand` — 乱数生成
- `base64` — Base64エンコーディング
- `hex` — Hexエンコーディング
- `wasm-bindgen` (オプション) — WASMバインディング

## ライセンス

Apache-2.0
