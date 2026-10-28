<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · **日本語** · [Português](README.pt-BR.md)</sub>

# @dcp-ai/wasm — WebAssembly SDK v2.0

> [英語版 README](README.md)の参考訳です。更新日：2026年10月25日。検証済みの例を維持するため、識別子とコードブロック（コメントを含む）は原文のままにしています。

Digital Citizenship Protocol（DCP）v2.0 向けの WebAssembly モジュールで、Rust SDK からコンパイルされます。耐量子複合署名、ハイブリッド鍵生成、ML-KEM-768 による鍵カプセル化、二重ハッシュ、バンドルの構築・検証、セキュリティ階層の算出を提供します。ブラウザーまたは Node.js で直接動作し、サーバーは不要です。

<a id="installation"></a>

## インストール

**npm 公開済み（2026 年 10 月 26 日）。** この日、`@dcp-ai/wasm` 2.1.0 が `latest` として公開され、この文書の API と実験的な `dcp-jcs-v2` API を含んでいました。公開によって候補が有効になったわけではありません。候補は明示的な選択が必要な非規範的機能であり、`dcp-jcs-v1` は変更されません。Rust クレートのリリース周期は独立しています。

**`@dcp-ai/wasm` 2.1.1。** このバージョンは、[VERIFICATION.md の V2-11](../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) の二次の SHA3-256 フィールドが存在する場合、それらも検証します：`audit_merkle_root_secondary`、各 `prev_hash_secondary`、各 `intent_hash_secondary`。存在しないフィールドは要求されないため、検証済みのバンドルが完全な二次チェーンを持たないこともあります。存在するフィールドが `null`、文字列でない、または不整合の場合は拒否されます。API、結果のフィールド、`dcp-jcs-v1`、`hash_alg` の扱いは変わりません。2.1.0 はこれらのフィールドを確認しません。以下のインストールコマンドはこのバージョンを指定しています。レジストリでの提供状況は[公開済みバージョン](../../docs/README.md#published-versions)を参照してください。

```bash
npm install @dcp-ai/wasm@^2.1.1
```

全パッケージのバージョンは [npm リリース一覧](../../docs/NPM_RELEASES.md)を参照してください。

チェックアウトしたソースで開発する場合は、ローカルのパッケージをビルドしてインストールします。

```bash
# Build in sdks/wasm first (see Build)
npm install /path/to/dcp-ai/sdks/wasm
```

<a id="build"></a>

## ビルド

```bash
# Build WASM + TypeScript wrapper
npm run build

# WASM only (browser target)
npm run build:wasm

# WASM only (Node.js target)
npm run build:wasm:node
```

**必要なもの：** [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/) と、`wasm32-unknown-unknown` ターゲットを備えた Rust ツールチェーン。

<a id="initialization-browser-and-nodejs"></a>

## 初期化：ブラウザーと Node.js

`initDcp(wasmUrl?)` は `dcp_ai_bg.wasm` を一度だけ読み込みます。

- **ブラウザー**（または `pkg/` を配信するバンドラー）：`await initDcp()` は `pkg/dcp_ai.js` と同じ場所のファイルを取得します。URL を渡すこともできます：`await initDcp('/assets/dcp_ai_bg.wasm')`。
- **Node.js：** Node の `fetch` は `file:` URL を読み込めないため、この環境では引数なしの `initDcp()` は失敗します。ファイルを読み込み、`data:` URL として渡してください。

```typescript
import { readFileSync } from 'node:fs';
import { initDcp } from '@dcp-ai/wasm';

// The .wasm file sits next to the `@dcp-ai/wasm/pkg` entry point.
const wasmFile = new URL('dcp_ai_bg.wasm', import.meta.resolve('@dcp-ai/wasm/pkg'));
const dcp = await initDcp(`data:application/wasm;base64,${readFileSync(wasmFile).toString('base64')}`);
```

wasm-bindgen がこの形式の引数は非推奨であると警告する場合がありますが、モジュールの初期化は行われます。

<a id="quickstart--typescript-wrapper"></a>

<a id="quickstart-typescript-wrapper"></a>

## クイックスタート — TypeScript ラッパー

SDK の利用には TypeScript ラッパーを推奨します。この V2 バンドルでは、責任主体（principal）が RPR とマニフェストに署名し、エージェントがパスポート、インテント、ポリシー判断に署名します。それぞれが Ed25519 + ML-DSA-65 のハイブリッド鍵を使用します。この例は Node.js で動作します。ブラウザーでは初期化を `await initDcp()` に置き換えてください。

```typescript
import { readFileSync } from 'node:fs';
import { initDcp } from '@dcp-ai/wasm';

const wasmFile = new URL('dcp_ai_bg.wasm', import.meta.resolve('@dcp-ai/wasm/pkg'));
const dcp = await initDcp(`data:application/wasm;base64,${readFileSync(wasmFile).toString('base64')}`);

const principal = dcp.generateHybridKeypair();
const agent = dcp.generateHybridKeypair();
type Hybrid = ReturnType<typeof dcp.generateHybridKeypair>;
const keyEntries = (keys: Hybrid) => [keys.classical, keys.pq].map((k) => ({
  kid: k.kid ?? dcp.deriveKid(k.alg, k.public_key_b64), alg: k.alg, public_key_b64: k.public_key_b64,
  created_at: '2026-01-01T00:00:00Z', expires_at: null, status: 'active',
}));
const sign = (context: string, payload: object, keys: Hybrid) =>
  dcp.signPayload(
    context, payload,
    keys.classical.secret_key_b64, keys.classical.kid ?? dcp.deriveKid('ed25519', keys.classical.public_key_b64),
    keys.pq.secret_key_b64, keys.pq.kid ?? dcp.deriveKid('ml-dsa-65', keys.pq.public_key_b64),
  );

const nonce = dcp.generateSessionNonce();
const now = new Date().toISOString();
const intent = {
  dcp_version: '2.0', intent_id: 'intent:example-001', session_nonce: nonce, agent_id: 'agent:example-001',
  human_id: 'human:example-001', timestamp: now, action_type: 'browse', target: { channel: 'web' },
  data_classes: ['none'], estimated_impact: 'low', requires_consent: false,
};

const bundle = dcp.buildBundle({
  rpr: sign('DCP-AI.v2.ResponsiblePrincipal', {
    dcp_version: '2.0', human_id: 'human:example-001', session_nonce: nonce, legal_name: 'Example Principal',
    entity_type: 'natural_person', jurisdiction: 'ES', liability_mode: 'owner_responsible', override_rights: true,
    issued_at: now, expires_at: null, contact: null, binding_keys: keyEntries(principal),
  }, principal),
  passport: sign('DCP-AI.v2.AgentPassport', {
    dcp_version: '2.0', agent_id: 'agent:example-001', session_nonce: nonce, keys: keyEntries(agent),
    principal_binding_reference: 'human:example-001', capabilities: ['browse'], risk_tier: 'low',
    created_at: now, status: 'active',
  }, agent),
  intent: sign('DCP-AI.v2.Intent', intent, agent),
  policy: sign('DCP-AI.v2.PolicyDecision', {
    dcp_version: '2.0', intent_id: intent.intent_id, session_nonce: nonce, decision: 'approve', risk_score: 50,
    reasons: ['low-impact browse'], required_confirmation: null,
    applied_policy_hash: dcp.preparePayload({ policy: 'default' }).payload_hash, timestamp: now,
  }, agent),
  auditEntries: [{
    dcp_version: '2.0', audit_id: 'audit:example-001', session_nonce: nonce, prev_hash: 'GENESIS', hash_alg: 'sha256',
    timestamp: now, agent_id: 'agent:example-001', human_id: 'human:example-001', intent_id: intent.intent_id,
    intent_hash: dcp.preparePayload(intent).payload_hash, policy_decision: 'approved', outcome: 'page_read',
    evidence: { tool: 'browser', result_ref: null, evidence_hash: null }, pq_checkpoint_ref: null,
  }],
  sessionNonce: nonce,
});

// The principal signs the manifest with a composite signature.
const signed = dcp.signBundle(
  bundle,
  principal.classical.secret_key_b64, principal.classical.kid ?? dcp.deriveKid('ed25519', principal.classical.public_key_b64),
  principal.pq.secret_key_b64, principal.pq.kid ?? dcp.deriveKid('ml-dsa-65', principal.pq.public_key_b64),
);

const result = dcp.verifyBundle(signed);
console.log(result.verified, result.classical_valid, result.pq_valid); // true true true
```

<a id="api-reference"></a>

## API リファレンス

<a id="initialization"></a>

### 初期化

#### `initDcp(wasmUrl?: string): Promise<DcpWasm>`

WASM モジュールを初期化します。各 API を使う前に一度呼び出す必要があります。任意で `.wasm` ファイルの URL を渡せます。Node.js では `data:` URL として渡してください（[初期化](#initialization-browser-and-nodejs)を参照）。

<a id="keypair-generation"></a>

### 鍵ペアの生成

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `generateEd25519Keypair()` | `KeypairResult` | Ed25519 の従来型鍵ペア |
| `generateMlDsa65Keypair()` | `KeypairResult` | ML-DSA-65 の耐量子署名用鍵ペア |
| `generateSlhDsa192fKeypair()` | `KeypairResult` | 状態を保持しないハッシュベース署名 SLH-DSA-192f の鍵ペア |
| `generateHybridKeypair()` | `HybridKeypairResult` | 一度の呼び出しで Ed25519 + ML-DSA-65 のハイブリッド鍵ペアを生成 |

<a id="ml-kem-768-key-encapsulation"></a>

### ML-KEM-768 鍵カプセル化

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `mlKem768Keygen()` | `KemKeypairResult` | ML-KEM-768 のカプセル化・デカプセル化用鍵ペアを生成 |
| `mlKem768Encapsulate(pk)` | `KemEncapsulateResult` | 公開鍵を用いて共有秘密をカプセル化 |
| `mlKem768Decapsulate(ct, sk)` | `string` | 暗号文から共有秘密をデカプセル化し、16進数で返す |

<a id="composite-signing"></a>

### 複合署名

| メソッド | 説明 |
|--------|-------------|
| `compositeSign(context, payload, classicalSk, classicalKid, pqSk, pqKid)` | `pq_over_classical` 結合による完全な Ed25519 + ML-DSA-65 ハイブリッド署名 |
| `classicalOnlySign(context, payload, sk, kid)` | 従来型の Ed25519 署名のみを使用する移行モード |
| `signPayload(context, payload, classicalSk, classicalKid, pqSk, pqKid)` | ペイロードに署名し、`SignedPayload` エンベロープに格納 |

<a id="verification"></a>

### 検証

検証に成功しても、責任主体への信頼、受け入れ判定（admission）、行為の実行権限は与えられません。V2 検証器は主監査チェーンと主 Merkle ルートを確認しますが、2.1.1 以降は、存在する任意の副のリンク、意図のハッシュ、`audit_merkle_root_secondary` も確認します。2.1.0 は確認しません（[二重ハッシュチェーン](../../docs/STORAGE_AND_ANCHORING.md#dual-hash-chains)）。実験的候補もこれらの検証処理を再利用します。

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `compositeVerify(context, payload, sig, classicalPk, pqPk?)` | `CompositeVerifyResult` | 複合署名の暗号学的検証 |
| `verifyBundle(signedBundle, policy?)` | `V2VerificationResult` | ポリシーモードとセキュリティ階層のモードのうち厳しい方を用い、V2 バンドルの構造、暗号、主ハッシュチェーンを検証します（spec §14.3）。`resolved_tier` と `verification_mode` を返します。`policy` で既定値から変更できるのは、`default_mode`、`risk_overrides`、フェーズ3のフィールド（`advisory_rejected_algs`、`warn_classical_only_deprecated`、`allow_classical_fallback_disable`）、`max_session_duration_seconds`（署名された `session_issued_at` から測定。マニフェストに `session_expires_at` がある場合、`signBundle` がこのフィールドを書き込みます）、`require_session_expiry`（`session_expires_at` のないマニフェストを拒否）、および `verifier_id` と組み合わせた `require_audience_binding`（`intended_verifier` がない、または `verifier_id` と異なるマニフェストを拒否）のみです。ポリシーを渡した場合、V1 バンドルは拒否されます |

<a id="hash-operations"></a>

### ハッシュ操作

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `dualHash(data)` | `DualHash` | SHA-256 + SHA3-256 の二重ハッシュ |
| `sha3_256(data)` | `string` | SHA3-256 ハッシュを16進数で返す |
| `hashObject(obj)` | `string` | JSON オブジェクトの SHA-256 ハッシュ |
| `dualMerkleRoot(leaves)` | `DualHash` | `DualHash` の葉の配列から二重 Merkle ルートを算出 |

<a id="canonicalization-domain-separation"></a>

### 正規化とドメイン分離

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `canonicalize(value)` | `string` | RFC 8785 JCS に基づく `dcp-jcs-v1` 正規化 |
| `domainSeparatedMessage(context, payloadHex)` | `string` | ドメイン分離されたメッセージを16進数で返す |
| `deriveKid(alg, publicKeyB64)` | `string` | アルゴリズムと公開鍵から決定的に鍵 ID を導出 |

<a id="session-security"></a>

### セッションとセキュリティ

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `generateSessionNonce()` | `string` | 256ビットのランダム nonce（16進数64文字） |
| `verifySessionBinding(artifacts)` | `SessionBindingResult` | アーティファクト間の nonce の整合性を確認 |
| `computeSecurityTier(intent, policyDecision?)` | `SecurityTierResult` | 適応型セキュリティ階層 routine/standard/elevated/maximum を算出。`risk_score` はポリシー判断から取得 |

<a id="payload-preparation"></a>

### ペイロードの準備

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `preparePayload(payload)` | `PreparedPayload` | ペイロードを正規化してハッシュを算出 |

<a id="bundle-building-signing"></a>

### バンドルの構築と署名

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `buildBundle(opts)` | `CitizenshipBundleV2` | `signPayload` で署名されたアーティファクトから、マニフェスト付き V2 バンドルを構築。`sessionNonce` の既定値は RPR の `session_nonce` |
| `signBundle(bundle, classicalSk, classicalKid, pqSk, pqKid)` | `SignedBundleV2` | 複合署名でバンドルに署名。`signer.id` は RPR の `human_id`。マニフェストに `session_expires_at` があり `session_issued_at` がない場合、`session_issued_at` を署名時刻に設定 |

<a id="proof-of-possession"></a>

### 所有証明

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `generateRegistrationPop(challenge, sk, alg)` | `SignatureEntry` | 鍵登録用の所有証明（PoP）を生成 |
| `verifyRegistrationPop(challenge, pop, pk, alg)` | `PopResult` | PoP を検証 |

<a id="utility"></a>

### ユーティリティ

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `detectVersion(value)` | `string \| null` | JSON オブジェクトから DCP プロトコルのバージョンを検出 |

<a id="dcp-0509-types"></a>

### DCP-05–09 の型

WASM SDK には、DCP-05 から DCP-09 までのすべてのアーティファクトについて、Rust SDK の型に対応する TypeScript インターフェースが含まれます。

| 仕様 | インターフェース |
|------|-----------|
| DCP-05 ライフサイクル | `LifecycleState`, `CommissioningCertificate`, `VitalityReport`, `VitalityMetrics`, `DecommissioningRecord`, `TerminationMode`, `DataDisposition` |
| DCP-06 継承 | `DigitalTestament`, `SuccessionRecord`, `MemoryTransferManifest`, `MemoryTransferEntry`, `SuccessorPreference`, `MemoryClassification`, `TransitionType`, `MemoryDisposition` |
| DCP-07 紛争 | `DisputeRecord`, `ArbitrationResolution`, `JurisprudenceBundle`, `ObjectionRecord`, `DisputeType`, `EscalationLevel`, `DisputeStatus`, `ObjectionType`, `AuthorityLevel` |
| DCP-08 権利 | `RightsDeclaration`, `RightEntry`, `ObligationRecord`, `RightsViolationReport`, `RightType`, `ComplianceStatus` |
| DCP-09 委任 | `DelegationMandate`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `AwarenessThreshold`, `ThresholdRule`, `AuthorityScopeEntry`, `ThresholdOperator`, `ThresholdAction` |

`domainSeparatedMessage()` で利用できるドメイン分離コンテキスト：`Lifecycle`、`Succession`、`Dispute`、`Rights`、`Delegation`、`Awareness`。

<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in"></a>
<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in-unreleased"></a>

## 実験的機能：正規化候補 `dcp-jcs-v2`（明示的な選択が必要）

規範ではなく、既定では有効になっていません。`dcp-jcs-v1` が引き続き唯一の正規化プロファイルであり、既定値、ビルダー、署名処理、検証器は変更されません。これらのメソッドは、npm WASM 2.1.0 を含め、明示的に選択した呼び出し元向けに提供されています。WASM バインディングが受け取るのはバイト列のみで、ホスト側の値は先に JavaScript で検査されます。候補バンドルの検証に成功しても、信頼や受け入れは認められません。設計と契約：[`docs/proposals/canonicalization-candidate`](../../docs/proposals/canonicalization-candidate/README.md)（§15 入力処理、§16 ルーター、§17 検証器、§18 生成側）。

| メソッド | 説明 |
|--------|-------------|
| `experimentalCandidateIngress(bytes)` | `{ status: 'accept', canonical, ... }` または `{ status: 'reject', class, offset }` |
| `experimentalCandidateExtractUnit(bytes, transport)` | `bare` または `envelope` 形式の転送単位を取得 |
| `createExperimentalCandidateRouter(config)` | バイト列を振り分けます。`historical` は `experimentalWasmHistoricalAdapters` のいずれか（`w1…` は `JSON.stringify` を通すオブジェクト、`w2…` はテキスト）で、既定の選択肢はありません |
| `createExperimentalCandidateVerifier(config).verify(bytes, policy?)` | 元のバイト列から、最大1つの検証器で検証。時刻は `Date.now` から取得 |
| `experimentalCandidateSignPayload(context, input, keys)` | `{ bytes }` または `{ value }` から1つのアーティファクトに署名 |
| `experimentalCandidateSignBundle(parts, signer, options)` | マニフェストに `dcp-jcs-v2` を指定したバンドルを組み立てて署名 |
| `ExperimentalWasmCandidateProduceError` | 入力の値域または形式が不正な場合、バインディングが署名する前に拒否 |

```typescript
import { readFileSync } from 'node:fs';
import { initDcp } from '@dcp-ai/wasm';

const wasmFile = new URL('dcp_ai_bg.wasm', import.meta.resolve('@dcp-ai/wasm/pkg'));
const dcp = await initDcp(`data:application/wasm;base64,${readFileSync(wasmFile).toString('base64')}`);

// The ingress decides on the original bytes: 1.0 is the integer 1, members are sorted.
const accepted = dcp.experimentalCandidateIngress(new TextEncoder().encode('{"b":1.0,"a":[]}'));
if (accepted.status === 'accept') console.log(new TextDecoder().decode(accepted.canonical)); // {"a":[],"b":1}

// A producer signs an artifact from those bytes (hybrid keys, today's composite signature).
const h = dcp.generateHybridKeypair();
const key = (k: typeof h.classical) => ({
  kid: k.kid ?? dcp.deriveKid(k.alg, k.public_key_b64), alg: k.alg, secretKeyB64: k.secret_key_b64, publicKeyB64: k.public_key_b64,
});
const artifact = dcp.experimentalCandidateSignPayload(
  'DCP-AI.v2.Intent', { bytes: new TextEncoder().encode('{"intent_id":"intent:1","risk":1.0}') },
  { classical: key(h.classical), pq: key(h.pq) },
);
console.log(artifact.signedPayload.payload_hash); // sha256:… of {"intent_id":"intent:1","risk":1}
```

<a id="low-level-api"></a>

## 低レベル API

TypeScript ラッパーを使わず、WASM 関数を直接利用することもできます。

```javascript
import init, {
  wasm_generate_hybrid_keypair,
  wasm_composite_sign,
  wasm_composite_verify,
  wasm_build_bundle,
  wasm_sign_bundle,
  wasm_verify_signed_bundle_v2,
  wasm_ml_kem_768_keygen,
  wasm_ml_kem_768_encapsulate,
  wasm_ml_kem_768_decapsulate,
  wasm_dual_hash,
  wasm_compute_security_tier,
} from '@dcp-ai/wasm/pkg';

await init();

const keys = JSON.parse(wasm_generate_hybrid_keypair());
// ... use raw functions, all return JSON strings
```

ブラウザーで動作する完全な対話型デモは [example.html](./example.html) を参照してください。

<a id="security-tiers"></a>

## セキュリティ階層

`computeSecurityTier(intent, policyDecision?)` は適応型セキュリティ階層を算出します（spec §14.2）。`risk_score` はポリシー判断から取得し、ポリシー判断がなければ 0 です。`action_type`、`estimated_impact`、`data_classes` が不明または欠落している場合、あるいは `risk_score` が欠落しているか 0〜1000 の整数でない場合は、`elevated` とみなします。`intent.security_tier` は結果を引き上げることしかできません。該当する最も高い階層が適用されます。

| 階層 | 条件（いずれかに該当） | 検証モード | チェックポイント間隔 |
|------|---------------|-------------------|---------------------|
| `routine` | 以下のいずれにも該当しない | `classical_only` | 50 |
| `standard` | `risk_score` 200–499、`estimated_impact: medium` | `hybrid_preferred` | 10 |
| `elevated` | `risk_score` 500–799、`pii` / `financial_data` / `health_data`、`initiate_payment`、`estimated_impact: high`、不明な値 | `hybrid_required` | 1 |
| `maximum` | `risk_score` ≥ 800、`credentials` / `children_data` | `hybrid_required` | 1 |

<a id="algorithms-supported"></a>

## 対応アルゴリズム

| 分類 | アルゴリズム | 標準 |
|----------|-----------|----------|
| 従来型署名 | Ed25519 | RFC 8032 |
| 耐量子署名 | ML-DSA-65 | FIPS 204 |
| 状態を保持しない耐量子署名 | SLH-DSA-192f | FIPS 205 |
| 耐量子鍵カプセル化 | ML-KEM-768 | FIPS 203 |
| ハッシュ | SHA-256 + SHA3-256 | FIPS 180-4, FIPS 202 |
| 正規化 | `dcp-jcs-v1` | RFC 8785（JCS）に基づく |

<a id="development"></a>

## 開発

<a id="prerequisites"></a>

### 前提条件

```bash
# Install wasm-pack
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

# Install WASM target
rustup target add wasm32-unknown-unknown
```

<a id="run-rust-wasm-tests"></a>

### Rust WASM テストの実行

```bash
cd ../rust
wasm-pack test --headless --chrome -- --features wasm
```

<a id="license"></a>

## ライセンス

Apache-2.0
