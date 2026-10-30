<sub>[English](../../../../sdks/go/README.md) · [中文](../../../zh-CN/sdks/go/README.md) · [Español](../../../es/sdks/go/README.md) · **日本語** · [Português](../../../pt-BR/sdks/go/README.md)</sub>

<a id="dcp-ai-go--go-sdk"></a>

# dcp-ai-go — Go SDK

**Go の公開 (26/10/2026).** Go SDK `v2.11.0` はモジュールタグ `sdks/go/v2.11.0` から利用でき、検証器の修正、受け入れ、実験的なオプトイン API を含みます。Rust の公開は別です。参照： [Go v2.11.0](../../../../docs/GO_RELEASE.md).

> [英語版 README](../../../../sdks/go/README.md)の参考訳です。更新日：2026年10月29日。検証済みの例を維持するため、識別子とコードブロック（コメントを含む）は原文のままにしています。

Digital Citizenship Protocol（DCP）v1.0 および v2.0 向けの公式 Go SDK。Ed25519、ML-DSA-65、SLH-DSA-192f、ML-KEM-768、複合署名、二重ハッシュチェーン、バンドル検証をサポートします。

検証では完全性と署名を確認しますが、責任主体への信頼、受け入れ、行動の許可は確立しません。V2 検証器は主監査チェーンを確認し、v2.11.1 以降は、存在するオプションの SHA3-256 の副のリンク、意図のハッシュ、副 Merkle ルートも確認します（存在しないものは要求しません）。v2.11.0 は副フィールドを確認しません。[文書化された検証上の制限](../../../../docs/STORAGE_AND_ANCHORING.md#dual-hash-chains)を参照し、信頼の確認が必要な場合は以下の受け入れ API を使用してください。

<a id="installation"></a>

## インストール

**要件：** Go 1.25+

**Go SDK。** v2.11.0 以降、検証器の修正、責任主体への信頼と `strict-v1`、委任チェーン、A2A 受信ウィンドウ、実験的なオプトイン `dcp-jcs-v2` API を含みます。v2.11.0 のモジュールのタグは `sdks/go/v2.11.0`、インポートパスは引き続き `/v2` です。変更は[変更履歴](../../../../CHANGELOG.md#unreleased)に残しています。

**Go SDK v2.11.1。** このバージョンは、[VERIFICATION.md の V2-11](../../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) の二次の SHA3-256 フィールドが存在する場合、それらも検証します：`audit_merkle_root_secondary`、各 `prev_hash_secondary`、各 `intent_hash_secondary`。存在しないフィールドは要求されないため、検証済みのバンドルが完全な二次チェーンを持たないこともあります。存在するフィールドが `null`、文字列でない、または不整合の場合は拒否されます。API、結果のフィールド、`dcp-jcs-v1`、`hash_alg` の扱いは変わりません。v2.11.0 はこれらのフィールドを確認しません。以下のインストールコマンドはこのバージョンを指定しています。レジストリでの提供状況は[公開済みバージョン](../../../../docs/README.md#published-versions)を参照してください。

```bash
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.11.1
```

v2.10.0 から更新すると検証が厳密になり、以前受け入れられた不正形式や不整合の証拠が拒否される場合があります。V1 公開鍵の長さが不正な場合は panic せずエラーを返します。過去の証拠は保存してください。`dcp-jcs-v1` は規範的な既定値のままで、候補 API は実験的かつオプトインです。受け入れにはオペレーターの信頼設定が必要であり、行為を認可しません。

ソース開発専用：

```bash
go mod edit -replace github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2=/path/to/dcp-ai/sdks/go
```

<a id="features"></a>

## 機能

| 機能 | V1 | V2 |
|---------|----|----|
| Ed25519 署名 | 対応 | 対応 |
| ML-DSA-65（FIPS 204） | — | 対応 |
| SLH-DSA-192f（FIPS 205） | — | 対応 |
| ML-KEM-768（FIPS 203） | — | 対応 |
| 複合署名（古典署名を PQ で署名） | — | 対応 |
| ドメイン分離 | — | 対応 |
| 二重ハッシュ（SHA-256 + SHA3-256） | — | 対応 |
| バンドル検証 | 対応 | 対応 |
| 受け入れ：責任主体の信頼集合と `strict-v1` プロファイル（spec/profiles/admission） | — | 対応 |
| バンドルの構築と署名 | — | 対応 |
| セキュリティ階層の算出 | — | 対応 |
| 所有証明 | — | 対応 |
| 鍵のローテーション | — | 対応 |
| DCP-04 A2A 探索、ハンドシェイク、AES-256-GCM セッション（標準ライブラリ。並行利用が安全で、ウィンドウ内の各メッセージは1回だけ受け入れる） | — | 対応 |
| DCP-05 エージェントのライフサイクル（稼働開始 / 活力 / 稼働終了） | — | 対応 |
| DCP-06 デジタル継承（遺言、記憶移転、セレモニー） | — | 対応 |
| DCP-07 紛争解決、仲裁、判例 | — | 対応 |
| DCP-08 権利、義務、遵守 | — | 対応 |
| DCP-09 委任と検証可能な委任チェーン（`CreateSubMandate`、`VerifyMandateChain`）、認識しきい値、責任主体のミラー | — | 対応 |
| セッション nonce の補助関数、緊急失効 | — | 対応 |
| 遅延 PQ チェックポイントと `PQCheckpointManager` | — | 対応 |
| ブラインド化 RPR、複数当事者による承認、アルゴリズム勧告の補助関数 | — | 対応 |
| 共通のエラーコード（全 SDK で共有する 38 個）と `DetectWireFormat` | — | 対応 |
| OpenTelemetry / OTLP エクスポーター（ビルドタグ `otlp`） | — | 対応 |
| 正規化候補 `dcp-jcs-v2`（入力処理、ルーター、バイト列検証器、生成器） | — | 実験的かつ明示的な選択が必要。規範ではない |

<a id="quickstart-v1"></a>

<a id="quickstart--v1"></a>

## クイックスタート — V1

```go
package main

import (
    "fmt"
    "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp"
)

func main() {
    keys, _ := dcp.GenerateKeypair()
    obj := map[string]interface{}{"agent_id": "agent-001", "action": "api_call"}
    sig, _ := dcp.SignObject(obj, keys.SecretKeyB64)
    ok, _ := dcp.VerifyObject(obj, sig, keys.PublicKeyB64)
    fmt.Println("Verified:", ok) // true
}
```

<a id="quickstart-v2"></a>

<a id="quickstart--v2"></a>

## クイックスタート — V2

```go
package main

import (
    "encoding/json"
    "fmt"

    v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
    "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/providers"
)

func main() {
    // Set up algorithm registry
    reg := v2.NewAlgorithmRegistry()
    reg.RegisterSigner(&providers.Ed25519Provider{})
    reg.RegisterSigner(&providers.MlDsa65Provider{})
    reg.RegisterKem(&providers.MlKem768Provider{})

    // Generate keypairs (here one pair signs for both the principal and the agent)
    edKeys, _ := (&providers.Ed25519Provider{}).GenerateKeypair()
    pqKeys, _ := (&providers.MlDsa65Provider{}).GenerateKeypair()
    classicalKey := v2.CompositeKeyInfo{Kid: edKeys.Kid, Alg: "ed25519", SecretKeyB64: edKeys.SecretKeyB64, PublicKeyB64: edKeys.PublicKeyB64}
    pqKey := v2.CompositeKeyInfo{Kid: pqKeys.Kid, Alg: "ml-dsa-65", SecretKeyB64: pqKeys.SecretKeyB64, PublicKeyB64: pqKeys.PublicKeyB64}
    keys := []interface{}{
        map[string]interface{}{"kid": edKeys.Kid, "alg": "ed25519", "public_key_b64": edKeys.PublicKeyB64, "status": "active"},
        map[string]interface{}{"kid": pqKeys.Kid, "alg": "ml-dsa-65", "public_key_b64": pqKeys.PublicKeyB64, "status": "active"},
    }

    // Sign each artifact under its own context (Ed25519 + ML-DSA-65)
    sign := func(context string, payload map[string]interface{}) v2.SignedPayload {
        sp, _ := v2.SignPayload(reg, context, payload, classicalKey, &pqKey)
        return sp
    }

    // Build a V2 bundle from the signed artifacts
    nonce := v2.GenerateSessionNonce()
    bundle, _ := v2.BuildBundleV2(v2.BundleBuildInput{
        RPR:          sign(v2.CtxResponsiblePrincipal, map[string]interface{}{"human_id": "rpr:alice", "session_nonce": nonce, "binding_keys": keys}),
        Passport:     sign(v2.CtxAgentPassport, map[string]interface{}{"agent_id": "a-1", "session_nonce": nonce, "keys": keys, "status": "active", "principal_binding_reference": "rpr:alice"}),
        Intent:       sign(v2.CtxIntent, map[string]interface{}{"intent_id": "i-1", "session_nonce": nonce, "agent_id": "a-1", "human_id": "rpr:alice"}),
        Policy:       sign(v2.CtxPolicyDecision, map[string]interface{}{"intent_id": "i-1", "session_nonce": nonce, "risk_score": 200}),
        AuditEntries: []v2.AuditEventV2{},
        SessionNonce: nonce,
    })

    // Sign the manifest with a composite signature
    signed, _ := v2.SignBundleV2(reg, bundle, classicalKey, &pqKey)

    // Verify
    data, _ := json.Marshal(signed)
    result := v2.VerifySignedBundleV2(reg, data)
    fmt.Println("Verified:", result.Verified)
    fmt.Println("Classical:", result.ClassicalValid, "PQ:", result.PQValid)
}
```

<a id="security-tiers"></a>

### セキュリティ階層

```go
// Fragment, inside a function: intentPayload and policyPayload are decoded V2 payloads.
tier := v2.ComputeSecurityTier(v2.SecurityTierInput{
    RiskScore:       600, // from the bundle's PolicyDecision, never the intent
    DataClasses:     []string{"financial_data"},
    ActionType:      "initiate_payment",
    EstimatedImpact: "high",
})
fmt.Println(tier.Tier)               // "elevated"
fmt.Println(tier.VerificationMode)   // "hybrid_required"
fmt.Println(tier.CheckpointInterval) // 1

// From decoded intent and PolicyDecision payloads (map[string]interface{}):
tier = v2.ComputeSecurityTier(v2.SecurityTierInputFromPayloads(intentPayload, policyPayload))
```

<a id="ml-kem-768-key-encapsulation"></a>

### ML-KEM-768 鍵カプセル化

```go
// Fragment, inside a function.
kem := &providers.MlKem768Provider{}
kp, _ := kem.GenerateKeypair()
result, _ := kem.Encapsulate(kp.PublicKeyB64)
sharedSecret, _ := kem.Decapsulate(result.CiphertextB64, kp.SecretKeyB64)
```

<a id="v2-api-reference"></a>

## V2 API リファレンス

<a id="bundle-building-signing"></a>

<a id="bundle-building--signing"></a>

### バンドルの構築と署名

| 関数 | 説明 |
|----------|-------------|
| `v2.SignPayload(reg, context, payload, classicalKey, pqKey)` | アーティファクトに署名して `SignedPayload` を生成する（複合署名。`pqKey` が nil の場合は古典署名のみ） |
| `v2.PreparePayload(payload)` | `dcp-jcs-v1` の正規バイト列と、その SHA-256（接頭辞なしの小文字 16 進数）を返す。`payload_hash` フィールドは `"sha256:"` の後にそのダイジェストを続けたもの |
| `v2.VerifyPayloadHash(signed)` | `payload_hash` が `"sha256:"` の後に正規ペイロードの SHA-256 を続けた値と完全に一致する場合にだけ `true`。接頭辞のないダイジェストを含め、それ以外の値は `false`。確認するのはハッシュの整合性だけで、署名、鍵、ポリシー、受け入れは確認しない。`main` のソースコードで未公開。v2.11.1 は接頭辞のないダイジェストと比較するため、`SignPayload` の出力を拒否し、接頭辞のない形を受け入れる |
| `v2.BuildBundleV2(input)` | 署名済みアーティファクトから V2 バンドルを組み立て、マニフェストのハッシュと二重 Merkle ルートを含める |
| `v2.SignBundleV2(reg, bundle, classicalKey, pqKey)` | バンドルに複合署名または古典署名のみで署名する。署名者はバンドルの責任主体（`signer.id` = RPR の `human_id`） |
| `v2.VerifySignedBundleV2(reg, jsonBytes)` | `DefaultVerifierPolicy` の下で V2 バンドルを検証する（構造、ハッシュ、署名、主監査チェーン）。ポリシーモードとセキュリティ階層のモードのうち厳しい方を適用する（仕様 §14.3）。`ResolvedTier` と `VerificationMode` を報告する |
| `v2.VerifySignedBundleV2WithPolicy(reg, jsonBytes, policy)` | 独自の `VerifierPolicy` を使う同等の処理。`DefaultVerifierPolicy()` から変更できるのは `DefaultMode`、`RiskOverrides`、`AcceptedClassicalAlgs`、`AcceptedPQAlgs`、`AllowV1Bundles`（ここでは V1 バンドルは検証に成功しない）、`MaxSessionDurationSeconds`、`RequireSessionExpiry`、`RequireAudienceBinding`、`VerifierID`、およびフェーズ3のフィールド（`AdvisoryRejectedAlgs`、`WarnClassicalOnlyDeprecated`、`AllowClassicalFallbackDisable`。TypeScript と同様）のみ。それ以外の変更は検証失敗となる |
| `v2.VerifySignedBundleV2At(reg, jsonBytes, policy, now)` | 時刻 `now` での同等の処理。セッションウィンドウ、RPR の有効期限、鍵の有効期限を、その時刻とミリ秒精度で比較する。上の2関数は `time.Now()` を指定してこの関数を呼び出す |

各結果の `SignerKeys`（JSON では `signer_keys`）には、検査した複合署名（`bundle`、4つのアーティファクト、各 `pq_checkpoints[<id>]`）ごとに、検証器が各コンポーネント（`classical`、`pq`）用に解決した鍵エントリーと、そのコンポーネントの検証結果が列挙されます。

**型付きの構造体と受信したバンドル。** `AuditEventV2`、`CitizenshipBundleV2`、`SignedBundleV2` はバンドルを生成するためのものです。監査の証拠では、これらの構造体は明示的な `null` のメンバーと認識されないメンバー（`tool`、`result_ref`、`evidence_hash` 以外）を失います。認識される文字列値のメンバーと空の `evidence` オブジェクトは値を保ちます。エントリー自体では、`null` または空の `prev_hash_secondary` や `intent_hash_secondary` と未知のメンバーが失われ、存在しない `pq_checkpoint_ref` は `null` になります。こうしたメンバーの喪失は正規化された証拠を変え、`prev_hash` のチェーンまたは監査のマークルルートを無効にすることがあります。これらの構造体は、署名済みの証拠を転送するための損失のない表現ではありません。受信した監査エントリーを保持するには `v2.RawAuditEventV2`（未公開）を使用してください。エントリーのバイト列をそのまま、入力時と出力時にコピーして保持し、`Bytes()` と `MarshalJSON()` を直接呼べばそのまま返します（それを包む `json.Marshal` は、デコードされる値を変えずに空白を詰め、`<`、`>`、`&`、U+2028、U+2029 をエスケープすることがあります）。そのため、未知のメンバーも含め、各メンバーの有無と `null` が保たれます。厳密に 1 つの JSON オブジェクトでない入力（`null` を含む）だけを拒否し、修復や再署名は決して行わず、無効な証拠もそのまま保持するため、検証器は同じ理由でそれを拒否します。`json.Unmarshal` のエラーは必ず確認してください。失敗した場合、`RawAuditEventV2` は以前の内容を保ちますが、それは失敗した入力を表しません。複数の goroutine から読むのは、その値に対して `UnmarshalJSON` が実行されていない間だけにしてください。ゼロ値はエントリーを持たず、`MarshalJSON()` と `Typed()` はエラーを返し、`Bytes()` は `nil` を返します。nil の `*RawAuditEventV2` は、`MarshalJSON` を呼ばずに `encoding/json` 自身が `null` としてエンコードします。`Typed()` はフィールドを読むための、損失のあるビューです。受信したバンドルを保持するには、受信したバイト列を保持し、そのバイト列を検証してください。上の検証関数はバイト列を受け取ります。受信した証拠を検証に通すために自動で修復、再計算、再署名しないでください。明示的な移行は、元のデータを保持する別の手順として行います。

<a id="admission-principal-trust-and-strict-v1-unreleased"></a>

<a id="admission-principal-trust-and-strict-v1"></a>

### 受け入れ：責任主体への信頼と strict-v1

検証済みバンドルが証明するのは完全性と署名であり、責任主体が誰であるかではありません。受け入れ（[spec/profiles/admission](../../../../spec/profiles/admission/README.md)）では、検証に加えて、各責任主体の鍵を固定する運用者の信頼集合と、運用者が固定した `strict-v1` プロファイルを使用します（全階層でハイブリッド署名、署名された宛先、最大300秒の署名されたセッション、最大300秒前までの失効スナップショット）。ネットワーク I/O は行わず、行動を許可することもありません。`ActionAuthorized` は常に `false` です。

| 関数 | 説明 |
|----------|-------------|
| `v2.NewPrincipalTrustStore(json)` | 信頼集合（`schemas/v2/principal_trust_set.schema.json`）を検証する |
| `v2.ResolveStrictV1Profile(json)` | strict-v1 設定（`schemas/v2/admission_profile.schema.json`）を検証する。プロファイルの getter（`VerifierPolicy()`、`VerifierID()`、`MaxSessionDurationSeconds()`、`MaxRevocationAgeSeconds()`）はコピーを返す |
| `v2.RevocationSubjects(json, verification)` | パスポートの `agent_id` と、検証済み署名者鍵すべての kid をソートしたもの。失効スナップショットが回答すべき対象 |
| `v2.EvaluateAdmissionV2(json, verification, v2.AdmissionOptions{...})` | 検証器の結果から `Now` 時点の受け入れを評価する。暗号処理は行わない |
| `v2.AdmitSignedBundleV2(reg, json, v2.AdmitOptions{...})` | プロファイルのポリシー、またはプロファイルがなければ `Policy` に従って検証し、評価する |

信頼集合またはプロファイルを読み込めない場合、プロファイルに信頼集合がない場合、プロファイルと呼び出し元の `Policy` を併用した場合は、`*v2.AdmissionConfigError` を返し、その `Code` は `CONFIG_*` コードのいずれかです。`AdmissionResult` には `Verified`、`Verification`、`PrincipalTrust`、`Profile`、`ProfileCompliance`、`Admitted`、`ActionAuthorized`、`RecordedDecision`、`TrustSetVersion`、`Errors`（`{Code, Message}`）があり、JSON 形式では仕様のフィールド名を使用します。`Admitted` が true の場合だけ先に進んでください。

```go
// Fragment, inside a function: trustSetJSON, signedBundleJSON, reg (the algorithm registry) and lookupRevocation come from your application.
trust, err := v2.NewPrincipalTrustStore(trustSetJSON) // operator configuration, never the bundle
if err != nil {
    log.Fatal(err) // *v2.AdmissionConfigError
}
profile, err := v2.ResolveStrictV1Profile([]byte(`{"profile":"strict-v1","verifier_id":"api.acme.example"}`))
if err != nil {
    log.Fatal(err)
}

now := time.Now()
verification := v2.VerifySignedBundleV2At(reg, signedBundleJSON, profile.VerifierPolicy(), now)
subjects := v2.RevocationSubjects(signedBundleJSON, verification)
snapshot := lookupRevocation(subjects) // your source: a JSON snapshot, or nil when it cannot answer

result, err := v2.EvaluateAdmissionV2(signedBundleJSON, verification, v2.AdmissionOptions{
    Profile: profile, Trust: trust, Revocation: snapshot, Now: now,
})
if err != nil {
    log.Fatal(err)
}
if !result.Admitted {
    for _, e := range result.Errors {
        fmt.Println(e.Code, e.Message) // e.g. TRUST_PRINCIPAL_UNKNOWN, REVOCATION_STALE
    }
}
```

<a id="security-tiers_1"></a>

<a id="security-tiers-1"></a>

### セキュリティ階層

| 関数 | 説明 |
|----------|-------------|
| `v2.ComputeSecurityTier(input)` | 適応型セキュリティ階層（routine/standard/elevated/maximum）、その検証モードとチェックポイント間隔を算出する（仕様 §14.2）。不明な値では安全側の `elevated` を採用する |
| `v2.SecurityTierInputFromPayloads(intent, policyDecision)` | デコード済みのインテントと PolicyDecision のペイロードから階層への入力を構築する（`risk_score` は PolicyDecision 由来。欠落している場合や0〜1000の整数でない場合は、不明を表す `RiskScore: -1` になる） |
| `v2.EffectiveVerificationMode(policyMode, tier)` | ポリシーモードと階層のモードの厳しい方。`pq_only` は `pq_only` のまま |

<a id="delegation-chains-dcp-09-35-unreleased"></a>

<a id="delegation-chains-dcp-09-35"></a>

### 委任チェーン（DCP-09 §3.5）

| 関数 | 説明 |
|----------|-------------|
| `v2.CreateDelegationMandate(reg, humanClassical, humanPQ, params)` | 人間が署名したルート委任状。`SubDelegation` と `MinimumSecurityTier` はオプション |
| `v2.CreateSubMandate(reg, delegatorClassical, delegatorPQ, parent, v2.SubMandateParams{...})` | 親委任状のエージェントが `DCP-AI.v2.SubMandate` コンテキストの下で署名した下位委任状 |
| `v2.VerifyMandateChain(reg, chain, revokedIDs, v2.MandateChainKeys{HumanKeys, AgentKeys}, now)` | ルートから順にオフラインでチェーンを検証する（人間に遡る署名、リンクと深さ、`sub_delegation`、入れ子の有効期間、行動・`data_classes`・`limits` の制限、最低階層、失効）。`MandateChainResult{Valid, Errors, Depth, EffectiveTier}` を返す |

`SecurityTierInput.MandateChainTier` はチェーンの `EffectiveTier` を最低値として扱い、階層を上げることしかできません。

<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in-unreleased"></a>

<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in"></a>

### 実験的機能：正規化候補 `dcp-jcs-v2`（明示的な選択が必要）

規範ではなく、有効化もされていません。`dcp-jcs-v1` が引き続き唯一の正規化プロファイルであり、デフォルト設定、ビルダー、署名器、検証器は変更されません。これらの関数は v2.11.0 で明示的にオプトインする呼び出し元だけが利用できます。検証済みの候補バンドルも、信頼や受け入れを与えるものではありません。設計と契約：[`docs/proposals/canonicalization-candidate`](../../../../docs/proposals/canonicalization-candidate/README.md)（§15 入力処理、§16 ルーター、§17 検証器、§18 生成器）。

| 関数 | 説明 |
|----------|-------------|
| `ExperimentalCandidateIngress(input []byte)` | `Accepted`、`Canonical`、`CanonicalSHA256`、または拒否の `Class` と `Offset` |
| `NewExperimentalCandidateRouter(config)` | バイト列を振り分ける：`reject`、`v1_path`、`candidate`。履歴形式のデコーダーは固定の識別名 `encoding_json` で指定する |
| `NewExperimentalCandidateVerifier(config)` と `VerifyAt(registry, input, policy, now)` | 元のバイト列から、最大1つの検証器で検証する |
| `ExperimentalCandidateSignPayload(registry, context, input, keys)` | `ExperimentalCandidateBytes(b)` または `ExperimentalCandidateHostValue(v)` から1つのアーティファクトに署名する（厳密な型。`json.Number` を保持） |
| `ExperimentalCandidateSignBundle(registry, parts, signer, options)` | マニフェストで `dcp-jcs-v2` を指定するバンドルを組み立て、署名する |
| `*ExperimentalCandidateProduceError`、`ErrExperimentalCandidateUsage` | 署名器の呼び出し前に行う、入力のドメインまたは形式による拒否。または API の誤用 |

```go
package main

import (
    "fmt"

    "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/providers"
    v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

func main() {
    // The ingress decides on the original bytes: 1.0 is the integer 1, members are sorted.
    ok, _ := v2.ExperimentalCandidateIngress([]byte(`{"b":1.0,"a":[]}`))
    fmt.Println(string(ok.Canonical)) // {"a":[],"b":1}
    bad, _ := v2.ExperimentalCandidateIngress([]byte(`{"a":1,"a":2}`))
    fmt.Println(bad.Class, bad.Offset) // DUPLICATE_KEY 7

    // A producer signs an artifact from those bytes (hybrid keys, today's composite signature).
    reg := v2.NewAlgorithmRegistry()
    reg.RegisterSigner(&providers.Ed25519Provider{})
    reg.RegisterSigner(&providers.MlDsa65Provider{})
    ed, _ := (&providers.Ed25519Provider{}).GenerateKeypair()
    pq, _ := (&providers.MlDsa65Provider{}).GenerateKeypair()
    keys := v2.ExperimentalCandidateKeys{
        Classical: v2.CompositeKeyInfo{Kid: ed.Kid, Alg: "ed25519", SecretKeyB64: ed.SecretKeyB64, PublicKeyB64: ed.PublicKeyB64},
        PQ:        &v2.CompositeKeyInfo{Kid: pq.Kid, Alg: "ml-dsa-65", SecretKeyB64: pq.SecretKeyB64, PublicKeyB64: pq.PublicKeyB64},
    }
    artifact, err := v2.ExperimentalCandidateSignPayload(reg, v2.CtxIntent, v2.ExperimentalCandidateBytes([]byte(`{"intent_id":"intent:1","risk":1.0}`)), keys)
    if err != nil {
        panic(err)
    }
    fmt.Println(artifact.SignedPayload["payload_hash"]) // sha256:... of {"intent_id":"intent:1","risk":1}
}
```

<a id="composite-signatures"></a>

### 複合署名

| 関数 | 説明 |
|----------|-------------|
| `v2.CompositeSign(reg, ctx, payload, classicalKey, pqKey)` | 古典署名を PQ で署名する複合署名 |
| `v2.ClassicalOnlySign(reg, ctx, payload, key)` | 古典署名のみの移行モード |
| `v2.CompositeVerify(reg, ctx, payload, sig, classicalPK, pqPK)` | 複合署名を検証する |

<a id="crypto-providers"></a>

### 暗号プロバイダー

| プロバイダー | アルゴリズム | 種類 | 標準 |
|----------|-----------|------|----------|
| `Ed25519Provider` | ed25519 | 署名 | — |
| `MlDsa65Provider` | ml-dsa-65 | 署名 | FIPS 204 |
| `SlhDsa192fProvider` | slh-dsa-192f | 署名 | FIPS 205 |
| `MlKem768Provider` | ml-kem-768 | KEM | FIPS 203 |

<a id="v1-api-unchanged"></a>

### V1 API（変更なし）

| 関数 | 説明 |
|----------|-------------|
| `dcp.GenerateKeypair()` | Ed25519 鍵ペア |
| `dcp.SignObject(obj, sk)` | オブジェクトに署名する |
| `dcp.VerifyObject(obj, sig, pk)` | 署名を検証する |
| `dcp.Canonicalize(obj)` | 決定的な JSON |
| `dcp.HashObject(obj)` | 正規化 JSON の SHA-256 |
| `dcp.VerifySignedBundle(sb, pk)` | V1 バンドル検証 |

<a id="dcp-0509-types"></a>

### DCP-05–09 の型

V2 には DCP-05 から DCP-09 までのすべてのアーティファクトに対応する Go 構造体が含まれます。

| 仕様 | 型 |
|------|-------|
| DCP-05 | `LifecycleState`, `CommissioningCertificate`, `VitalityReport`, `VitalityMetrics`, `DecommissioningRecord`, `TerminationMode`, `DataDisposition` |
| DCP-06 | `DigitalTestament`, `SuccessionRecord`, `MemoryTransferManifest`, `MemoryTransferEntry`, `SuccessorPreference`, `MemoryClassification`, `TransitionType`, `MemoryDisposition` |
| DCP-07 | `DisputeRecord`, `ArbitrationResolution`, `JurisprudenceBundle`, `ObjectionRecord`, `DisputeType`, `EscalationLevel`, `DisputeStatus`, `ObjectionType`, `AuthorityLevel` |
| DCP-08 | `RightsDeclaration`, `RightEntry`, `ObligationRecord`, `RightsViolationReport`, `RightType`, `ComplianceStatus` |
| DCP-09 | `DelegationMandate`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `AwarenessThreshold`, `ThresholdRule`, `AuthorityScopeEntry` |

ドメイン分離コンテキスト：`CtxLifecycle`、`CtxSuccession`、`CtxDispute`、`CtxRights`、`CtxDelegation`、`CtxAwareness`

すべての構造体はシリアライズとデシリアライズ用の JSON タグを持ち、Go の命名規則に従います（オプションのフィールドは `json:"field_name,omitempty"`）。

<a id="development"></a>

## 開発

```bash
go build ./...   # Build
go test ./...    # Tests (conformance + interop + unit)
go fmt ./...     # Format
go mod tidy      # Verify dependencies
```

<a id="dependencies"></a>

### 依存関係

- `github.com/cloudflare/circl` — ML-DSA-65、SLH-DSA-192f、ML-KEM-768
- `golang.org/x/crypto` — SHA3-256

<a id="license"></a>

## ライセンス

Apache-2.0
