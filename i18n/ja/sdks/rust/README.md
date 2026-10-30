<sub>[English](../../../../sdks/rust/README.md) · [中文](../../../zh-CN/sdks/rust/README.md) · [Español](../../../es/sdks/rust/README.md) · **日本語** · [Português](../../../pt-BR/sdks/rust/README.md)</sub>

# dcp-ai — Rust SDK

**Rust の公開 (26/10/2026).** Rust `dcp-ai` 2.11.0 は crates.io で公開済みで、検証器の修正、受け入れ、実験的なオプトイン API を含みます。`dcp-jcs-v1` は引き続き規範かつデフォルトです。参照： [Rust 2.11.0](../../../../docs/RUST_RELEASE.md).

> [英語版 README](../../../../sdks/rust/README.md)の参考訳です。更新日：2026年10月25日。検証済みの例を維持するため、識別子とコードブロック（コメントを含む）は原文のままにしています。

Digital Citizenship Protocol（DCP v2.0）向けの公式 Rust SDK。Serde ベースの型、ハイブリッド耐量子暗号（Ed25519 + ML-DSA-65 + SLH-DSA-192f + ML-KEM-768）、`pq_over_classical` による結合を持つ複合署名、二重ハッシュチェーン、OpenTelemetry による可観測性、DCP-04..09 の動作、オプションの WebAssembly サポートを提供します。

検証では完全性と署名を確認しますが、責任主体への信頼、受け入れ、行動の許可は確立しません。V2 検証器は主監査チェーンを確認し、2.11.1 以降は、存在するオプションの SHA3-256 の副のリンク、意図のハッシュ、副 Merkle ルートも確認します（存在しないものは要求しません）。2.11.0 は副フィールドを確認しません。[文書化された検証上の制限](../../../../docs/STORAGE_AND_ANCHORING.md#dual-hash-chains)を参照し、信頼の確認が必要な場合は以下の受け入れ API を使用してください。

<a id="installation"></a>

## インストール

**Rust SDK。** 2.11.0 以降、V2 バンドルの構築と署名、責任主体への明示的な信頼と `strict-v1` による受け入れ、委任チェーン、検証器の修正、実験的なオプトイン `dcp-jcs-v2` API を含みます。`dcp-jcs-v1` は引き続き規範かつデフォルトです。旧版で受理された不正な証拠が拒否される場合があります。Rust では A2A セッション暗号化とそのリプレイウィンドウは未実装です。検出とハンドシェイクの補助機能は利用できます。

**Rust SDK 2.11.1。** このバージョンは、[VERIFICATION.md の V2-11](../../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) の二次の SHA3-256 フィールドが存在する場合、それらも検証します：`audit_merkle_root_secondary`、各 `prev_hash_secondary`、各 `intent_hash_secondary`。存在しないフィールドは要求されないため、検証済みのバンドルが完全な二次チェーンを持たないこともあります。存在するフィールドが `null`、文字列でない、または不整合の場合は拒否されます。API、結果のフィールド、`dcp-jcs-v1`、`hash_alg` の扱いは変わりません。2.11.0 はこれらのフィールドを確認しません。以下のインストールコマンドはこのバージョンを指定しています。レジストリでの提供状況は[公開済みバージョン](../../../../docs/README.md#published-versions)を参照してください。

```toml
[dependencies]
dcp-ai = "2.11.1"
```

OpenTelemetry/OTLP エクスポートを使用する場合：

```toml
[dependencies]
dcp-ai = { version = "2.11.1", features = ["otlp"] }
```

WebAssembly サポートを使用する場合：

```toml
[dependencies]
dcp-ai = { version = "2.11.1", features = ["wasm"] }
```

<a id="features"></a>

## 機能

| 分野 | 対応状況 |
|---|---|
| Ed25519 / ML-DSA-65 / SLH-DSA-192f / ML-KEM-768 プロバイダー | 対応 |
| 複合署名（`pq_over_classical`）と検証 | 対応 |
| 正規化 JSON v2 とドメイン分離 | 対応 |
| 二重ハッシュ（SHA-256 + SHA3-256）と Merkle ルート | 対応 |
| バンドル検証（V1 + V2。V2 は検証器ポリシーとセキュリティ階層に従う：`verify_signed_bundle_v2_with_policy`） | 対応 |
| V2 バンドルの構築と署名（`dcp_ai::v2::bundle`：`build_bundle_v2`、`sign_bundle_v2`。`wasm` 機能の `wasm_build_bundle` / `wasm_sign_bundle` がこれらを呼び出す。PQ チェックポイントは未対応） | 対応 |
| DCP-05 エージェントのライフサイクル（稼働開始 / 活力 / 稼働終了） | 対応 |
| DCP-06 デジタル継承（遺言、記憶移転、セレモニー） | 対応 |
| DCP-07 紛争解決、仲裁、判例 | 対応 |
| DCP-08 権利、義務、遵守 | 対応 |
| DCP-09 委任と検証可能な委任チェーン（`create_sub_mandate`、`verify_mandate_chain`、§3.5）、認識しきい値、責任主体のミラー | 対応 |
| DCP-04 A2A 探索、ハンドシェイク、セッション ID の導出 | 対応 |
| DCP-04 A2A AES-256-GCM セッション暗号化 | _後続リリースに延期_ |
| セッション nonce の補助関数、セキュリティ階層エンジン（`compute_security_tier(&intent, Some(&policy_decision))`、仕様 §14.2。`compute_security_tier_with_floor` は委任チェーンの階層を加味する）、緊急失効 | 対応 |
| 遅延 PQ チェックポイントと `PQCheckpointManager` | 対応 |
| ブラインド化 RPR、複数当事者による承認、アルゴリズム勧告の補助関数 | 対応 |
| 共通のエラーコード（全 SDK で共有する 38 個）と `detect_wire_format` | 対応 |
| OpenTelemetry / OTLP エクスポーター（オプションの `otlp` 機能） | 対応 |
| 受け入れ：信頼する責任主体と `strict-v1` プロファイル | 対応 |
| 正規化候補 `dcp-jcs-v2`（入力処理、ルーター、バイト列検証器、生成器） | 実験的かつ明示的な選択が必要。規範ではない |

<a id="quickstart"></a>

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

<a id="verify-a-signed-bundle"></a>

### 署名済みバンドルの検証

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

## API リファレンス

<a id="crypto-dcp_aicrypto"></a>

### 暗号（`dcp_ai::crypto`）

| 関数 | シグネチャ | 説明 |
|----------|-----------|-------------|
| `generate_keypair()` | `() -> (String, String)` | `(public_key_b64, secret_key_b64)` を返す |
| `sign_object(obj, secret_key_b64)` | `(&Value, &str) -> Result<String, String>` | 署名し、base64 を返す |
| `verify_object(obj, sig_b64, pub_b64)` | `(&Value, &str, &str) -> Result<bool, String>` | 署名を検証する |
| `canonicalize(obj)` | `(&Value) -> String` | 決定的な JSON |
| `hash_object(obj)` | `(&Value) -> String` | SHA-256 の16進表記 |
| `merkle_root_from_hex_leaves(leaves)` | `(&[String]) -> Option<String>` | Merkle ルート |

<a id="verification-dcp_aiverify"></a>

### 検証（`dcp_ai::verify`）

```rust
// Signature (not runnable)
fn verify_signed_bundle(
    signed_bundle: &Value,
    public_key_b64: Option<&str>,
) -> VerificationResult
```

検証対象：Ed25519 署名、`bundle_hash`、`merkle_root`、`intent_hash` チェーン、`prev_hash` チェーン。

<a id="types-dcp_aitypes"></a>

### 型（`dcp_ai::types`）

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

すべての構造体は `Serialize` + `Deserialize`（serde）を実装しています。

<a id="v2-types-dcp_aiv2types"></a>

### V2 の型（`dcp_ai::v2::types`）

V2 には、DCP-05 から DCP-09 までのすべてのアーティファクトについて、Serde のトレイトを導出した構造体が含まれます。

| 仕様 | 型 |
|------|-------|
| DCP-05 | `LifecycleState`, `CommissioningCertificate`, `VitalityReport`, `VitalityMetrics`, `DecommissioningRecord`, `TerminationMode`, `DataDisposition` |
| DCP-06 | `DigitalTestament`, `SuccessionRecord`, `MemoryTransferManifest`, `MemoryTransferEntry`, `SuccessorPreference`, `MemoryClassification`, `TransitionType`, `MemoryDisposition` |
| DCP-07 | `DisputeRecord`, `ArbitrationResolution`, `JurisprudenceBundle`, `ObjectionRecord`, `DisputeType`, `EscalationLevel`, `DisputeStatus`, `ObjectionType`, `AuthorityLevel` |
| DCP-08 | `RightsDeclaration`, `RightEntry`, `ObligationRecord`, `RightsViolationReport`, `RightType`, `ComplianceStatus` |
| DCP-09 | `DelegationMandate`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `AwarenessThreshold`, `ThresholdRule`, `AuthorityScopeEntry` |

ドメイン分離定数：`CTX_LIFECYCLE`、`CTX_SUCCESSION`、`CTX_DISPUTE`、`CTX_RIGHTS`、`CTX_DELEGATION`、`CTX_AWARENESS`

すべての構造体は `Debug`、`Clone`、`Serialize`、`Deserialize` を導出します。列挙型は `#[serde(rename_all = "snake_case")]` を使用します。オプションのフィールドは `Option<T>` と `#[serde(skip_serializing_if = "Option::is_none")]` を使用します。

<a id="bundles-dcp_aiv2bundle-unreleased"></a>
<a id="bundles-dcp_aiv2bundle"></a>

### バンドル（`dcp_ai::v2::bundle`）

| 関数 | 説明 |
|----------|-------------|
| `build_bundle_v2(&rpr, &passport, &intent, &policy, &audit_entries, session_nonce)` | 4 つの `SignedPayload` と監査証跡から V2 バンドルを構築する。各 `payload_hash` と、すべてのアーティファクトおよび監査エントリーの `session_nonce` を確認し、両方の監査 Merkle ルートをマニフェストに書き込む。証跡が空の場合、ルートは64個のゼロになる |
| `sign_bundle_v2(bundle, &classical, &pq)` | `CTX_BUNDLE` の下でマニフェストに複合署名し、`{bundle, signature}` を返す。`signer.id` は RPR の `human_id`。署名前に `session_expires_at` または `intended_verifier` をマニフェストに設定する。`session_expires_at` があり `session_issued_at` がない場合、`session_issued_at` を署名時刻に設定する |

<a id="delegation-chains-dcp_aiv2delegation-dcp-09-35-unreleased"></a>
<a id="delegation-chains-dcp_aiv2delegation-dcp-09-35"></a>

### 委任チェーン（`dcp_ai::v2::delegation`、DCP-09 §3.5）

| 関数 | 説明 |
|----------|-------------|
| `create_delegation_mandate_with_options(ed, pq, human_classical, human_pq, params, &MandateChainOptions)` | 人間が署名したルート委任状。オプションで `sub_delegation` と `minimum_security_tier` を指定する |
| `create_sub_mandate(ed, pq, classical, pq_key, &parent, SubMandateParams { .. })` | 親委任状のエージェントが `DCP-AI.v2.SubMandate` コンテキストの下で署名した下位委任状 |
| `verify_mandate_chain(&chain, &revoked_ids, &MandateChainKeys { human_keys, agent_keys }, now_millis)` | ルートから順にオフラインでチェーンを検証する（人間に遡る署名、リンクと深さ、`sub_delegation`、入れ子の有効期間、行動・`data_classes`・`limits` の制限、最低階層、失効）。`MandateChainResult { valid, errors, depth, effective_tier }` を返す |

<a id="admission-dcp_aiv2-specprofilesadmission-unreleased"></a>
<a id="admission-dcp_aiv2-specprofilesadmission"></a>

### 受け入れ（`dcp_ai::v2`、spec/profiles/admission）

検証済み V2 バンドルを、運用者がすでに信頼する責任主体からの証拠として受け入れるかを判定します。オプションで `strict-v1` プロファイルを使用できます。信頼集合、プロファイル、失効情報源は運用者が指定し、バンドルやリクエストから取得することはありません。

| 関数 | 説明 |
|----------|-------------|
| `verify_signed_bundle_v2_at(&b, &policy, now_ms)` | `verify_signed_bundle_v2_with_policy` を `now_ms`（Unix エポックからのミリ秒）で実行し、すべての時刻チェックでその値を使用する。他の2つの検証関数はシステムクロックを使用する。`V2VerificationDetails` を返し、`result` に同じ `V2VerificationResult` を格納する。さらに `signer_keys` が、検査した複合署名ごとに各コンポーネントで解決した鍵と検証結果を列挙する。`V2VerificationResult` の10フィールド構造と、他の2関数のシグネチャは変わらない |
| `PrincipalTrustStore::from_json(&json)` | 信頼集合（`schemas/v2/principal_trust_set.schema.json`）を読み込む |
| `resolve_strict_v1_profile(&json)` | `strict-v1` プロファイル（`schemas/v2/admission_profile.schema.json`）を読み込む。`policy()`、`verifier_id()`、`max_session_duration_seconds()`、`max_revocation_age_seconds()` は読み取り専用 |
| `revocation_subjects(&b, &verification)` | 運用者の失効情報源に渡す、パスポートの `agent_id` と検証済み署名者鍵のソート済み kid |
| `evaluate_admission_v2(&b, &verification, &AdmissionOptions { .. })` | 検証結果から受け入れを判定する。暗号処理も I/O も行わない |
| `admit_signed_bundle_v2(&b, &AdmitOptions { .. })` | `now_ms`（`None` の場合はシステムクロック）で、プロファイルのポリシー、またはプロファイルがなければ `policy` に従って検証し、その後評価する |

信頼集合またはプロファイルを読み込めない場合、プロファイルに信頼集合がない場合、プロファイルと呼び出し元のポリシーを併用した場合は、`AdmissionConfigError { code, message }` を返します。`AdmissionResult` は §5.2 のキー（`verified`、`verification`、`principal_trust`、`profile`、`profile_compliance`、`admitted`、`action_authorized`、`recorded_decision`、`trust_set_version`、`errors`）でシリアライズされ、`action_authorized` は常に `false` です。プロファイルの `verifier_policy` は `accepted_classical_algs` と `accepted_pq_algs` を絞り込むことができ、検証器はそれを適用します。`min_classical`、`min_pq`、`accepted_hash_algs`、`max_key_age_days` はデフォルト値に固定されます。

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

### 実験的機能：正規化候補 `dcp-jcs-v2`（明示的な選択が必要）

規範ではなく、有効化もされていません。`dcp-jcs-v1` が引き続き唯一の正規化プロファイルであり、デフォルト設定、ビルダー、署名器、検証器は変更されません。これらのモジュールは 2.11.0 で明示的に選択した場合にのみ利用できます。検証済みの候補バンドルも、信頼や受け入れを与えるものではありません。設計と契約：[`docs/proposals/canonicalization-candidate`](../../../../docs/proposals/canonicalization-candidate/README.md)（§15 入力処理、§16 ルーター、§17 検証器、§18 生成器）。

| モジュール | API |
|---|---|
| `dcp_ai::v2::experimental_candidate_ingress` | `experimental_candidate_ingress(&[u8])`：`CandidateIngressOutcome::Accept { value, canonical, canonical_sha256 }` または `Reject { class, offset }` |
| `dcp_ai::v2::experimental_candidate_router` | `CandidateRouter::new(CandidateRouterConfig { transport, accepted_profiles, historical })`。デコーダーは `HistoricalAdapter::serde_json_from_slice()`。いずれもデフォルトではない |
| `dcp_ai::v2::experimental_candidate_verify` | `CandidateVerifier::new(config)` と `verify_at(input, policy, now_ms)` |
| `dcp_ai::v2::experimental_candidate_produce` | `sign_payload(context, &CandidateInput, &CandidateKeys)` と `sign_bundle(&BundleParts, &BundleSigner, &BundleOptions)`。入力のドメインまたは形式については `ProduceError::Reject`（署名器の実行前）、その他に `Usage`、`Provider` |

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

### `wasm` 機能

`wasm` 機能を有効にすると、crate は WebAssembly バインディングを公開します。

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

WASM 向けにコンパイル：

```bash
cargo build --target wasm32-unknown-unknown --features wasm
```

<a id="development"></a>

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

<a id="dependencies"></a>

### 依存関係

- `serde` + `serde_json` — シリアライズ
- `sha2` — SHA-256
- `sha3` — SHA3-256（二重ハッシュチェーン）
- `ed25519-dalek` — Ed25519 暗号
- `fips203` / `fips204` / `fips205` — ML-KEM-768、ML-DSA-65、SLH-DSA-192f（FIPS 203 / 204 / 205）
- `rand` — 乱数生成
- `base64` — Base64 エンコーディング
- `hex` — 16進エンコーディング
- `wasm-bindgen`（オプション）— WASM バインディング

<a id="license"></a>

## ライセンス

Apache-2.0
