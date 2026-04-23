<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · **日本語** · [Português](README.pt-BR.md)</sub>

# @dcp-ai/wasm — WebAssembly SDK v2.0

デジタル市民権プロトコル (DCP) v2.0 向けのフル機能WebAssemblyモジュールで、Rust SDKからコンパイルされています。耐量子複合署名、ハイブリッド鍵生成、ML-KEM-768鍵カプセル化、デュアルハッシュ、バンドル構築/検証、セキュリティティア計算を提供し、すべてブラウザまたはNode.jsで直接実行されます。サーバーは不要です。

## インストール

```bash
npm install @dcp-ai/wasm
```

## ビルド

```bash
# Build WASM + TypeScript wrapper
npm run build

# WASM only (browser target)
npm run build:wasm

# WASM only (Node.js target)
npm run build:wasm:node
```

**必要環境:** [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/) と、`wasm32-unknown-unknown` ターゲットを備えたRustツールチェーン。

## クイックスタート — TypeScriptラッパー

SDKを使う推奨方法は、人間工学に優れたTypeScriptラッパー経由です。

```typescript
import { initDcp } from '@dcp-ai/wasm';

const dcp = await initDcp();

// Generate hybrid Ed25519 + ML-DSA-65 keypair
const keys = dcp.generateHybridKeypair();

// Build a V2 bundle
const bundle = dcp.buildBundle({
  rpr: { dcp_version: '2.0', human_id: 'alice', /* ... */ },
  passport: { dcp_version: '2.0', agent_id: 'agent-001', keys: [/* ... */] },
  intent: { action: 'read', risk_score: 100 },
  policy: { decision: 'allow', reason: 'low risk' },
  auditEntries: [],
});

// Sign the bundle with composite signature
const signed = dcp.signBundle(
  bundle,
  keys.classical.secret_key_b64, keys.classical.kid,
  keys.pq.secret_key_b64, keys.pq.kid,
);

// Verify the signed bundle
const result = dcp.verifyBundle(signed);
console.log(result.verified);       // true
console.log(result.classical_valid); // true
console.log(result.pq_valid);       // true
```

## APIリファレンス

### 初期化

#### `initDcp(wasmUrl?: string): Promise<DcpWasm>`

WASMモジュールを初期化します。APIを使用する前に1回呼び出してください。任意で `.wasm` ファイルのカスタムURLを渡すことができます。

### 鍵ペア生成

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `generateEd25519Keypair()` | `KeypairResult` | Ed25519の古典鍵ペア |
| `generateMlDsa65Keypair()` | `KeypairResult` | ML-DSA-65の耐量子署名鍵ペア |
| `generateSlhDsa192fKeypair()` | `KeypairResult` | SLH-DSA-192fのステートレスなハッシュベース署名鍵ペア |
| `generateHybridKeypair()` | `HybridKeypairResult` | Ed25519 + ML-DSA-65のハイブリッド鍵ペアを1回で生成 |

### ML-KEM-768 鍵カプセル化

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `mlKem768Keygen()` | `KemKeypairResult` | ML-KEM-768のカプセル化/復号鍵ペアを生成 |
| `mlKem768Encapsulate(pk)` | `KemEncapsulateResult` | 公開鍵を使って共有秘密をカプセル化 |
| `mlKem768Decapsulate(ct, sk)` | `string` | 暗号文から共有秘密を復号 (hexを返す) |

### 複合署名

| メソッド | 説明 |
|--------|-------------|
| `compositeSign(context, payload, classicalSk, classicalKid, pqSk, pqKid)` | `pq_over_classical` バインディング付きのフルハイブリッド署名 (Ed25519 + ML-DSA-65) |
| `classicalOnlySign(context, payload, sk, kid)` | 古典のみのEd25519署名 (移行モード) |
| `signPayload(context, payload, classicalSk, classicalKid, pqSk, pqKid)` | 署名して `SignedPayload` 封筒でラップ |

### 検証

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `compositeVerify(context, payload, sig, classicalPk, pqPk?)` | `CompositeVerifyResult` | 複合署名の暗号検証 |
| `verifyBundle(signedBundle)` | `V2VerificationResult` | V2バンドルの完全検証 (構造 + 暗号 + ハッシュチェーン) |

### ハッシュ操作

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `dualHash(data)` | `DualHash` | SHA-256 + SHA3-256のデュアルハッシュ |
| `sha3_256(data)` | `string` | SHA3-256ハッシュ (hex) |
| `hashObject(obj)` | `string` | JSONオブジェクトのSHA-256ハッシュ |
| `dualMerkleRoot(leaves)` | `DualHash` | `DualHash` リーフの配列からデュアルMerkleルート |

### 正規化とドメイン分離

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `canonicalize(value)` | `string` | RFC 8785 JCSの正規化 |
| `domainSeparatedMessage(context, payloadHex)` | `string` | ドメイン分離されたメッセージ (hex) |
| `deriveKid(alg, publicKeyB64)` | `string` | アルゴリズム + 公開鍵からの決定論的鍵ID |

### セッションとセキュリティ

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `generateSessionNonce()` | `string` | 256ビットのランダムノンス (64hex文字) |
| `verifySessionBinding(artifacts)` | `SessionBindingResult` | 成果物間でのノンス整合性を検証 |
| `computeSecurityTier(intent)` | `SecurityTierResult` | 適応型セキュリティティアを計算 (routine/standard/elevated/maximum) |

### ペイロード準備

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `preparePayload(payload)` | `PreparedPayload` | ペイロードを正規化してハッシュ化 |

### バンドル構築と署名

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `buildBundle(opts)` | `CitizenshipBundleV2` | マニフェストとハッシュ相互参照を含む完全なV2バンドルを構築 |
| `signBundle(bundle, classicalSk, classicalKid, pqSk, pqKid)` | `SignedBundleV2` | 複合署名でバンドルに署名 |

### 所有証明

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `generateRegistrationPop(challenge, sk, alg)` | `SignatureEntry` | 鍵登録用のPoPを生成 |
| `verifyRegistrationPop(challenge, pop, pk, alg)` | `PopResult` | PoPを検証 |

### ユーティリティ

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `detectVersion(value)` | `string \| null` | JSONオブジェクトからDCPプロトコルのバージョンを検出 |

### DCP-05–09 型

WASM SDKには、Rust SDKの型を反映したDCP-05からDCP-09のすべての成果物用のTypeScriptインターフェイスが含まれます。

| Spec | インターフェイス |
|------|-----------|
| DCP-05 Lifecycle | `LifecycleState`、`CommissioningCertificate`、`VitalityReport`、`VitalityMetrics`、`DecommissioningRecord`、`TerminationMode`、`DataDisposition` |
| DCP-06 Succession | `DigitalTestament`、`SuccessionRecord`、`MemoryTransferManifest`、`MemoryTransferEntry`、`SuccessorPreference`、`MemoryClassification`、`TransitionType`、`MemoryDisposition` |
| DCP-07 Disputes | `DisputeRecord`、`ArbitrationResolution`、`JurisprudenceBundle`、`ObjectionRecord`、`DisputeType`、`EscalationLevel`、`DisputeStatus`、`ObjectionType`、`AuthorityLevel` |
| DCP-08 Rights | `RightsDeclaration`、`RightEntry`、`ObligationRecord`、`RightsViolationReport`、`RightType`、`ComplianceStatus` |
| DCP-09 Delegation | `DelegationMandate`、`AdvisoryDeclaration`、`PrincipalMirror`、`InteractionRecord`、`AwarenessThreshold`、`ThresholdRule`、`AuthorityScopeEntry`、`ThresholdOperator`、`ThresholdAction` |

`domainSeparatedMessage()` 経由で利用可能なドメイン分離コンテキスト: `Lifecycle`、`Succession`、`Dispute`、`Rights`、`Delegation`、`Awareness`

## 低レベルAPI

TypeScriptラッパーを使わずに、生のWASM関数を直接使用することもできます。

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

完全な対話型ブラウザデモについては [example.html](./example.html) を参照してください。

## セキュリティティア

SDKは意図のリスクプロファイルに基づいて適応型セキュリティティアを計算します。

| ティア | リスクスコア | 検証モード | チェックポイント間隔 |
|------|-----------|-------------------|-------------------|
| `routine` | < 200 | `classical_only` | 50 |
| `standard` | 200–499 | `hybrid_preferred` | 10 |
| `elevated` | 500–799 または PII/金融データ | `hybrid_required` | 1 |
| `maximum` | ≥ 800 または認証情報/生体情報 | `hybrid_required` | 1 |

## サポートされるアルゴリズム

| カテゴリ | アルゴリズム | 標準 |
|----------|-----------|----------|
| 古典署名 | Ed25519 | RFC 8032 |
| 耐量子署名 | ML-DSA-65 | FIPS 204 |
| 耐量子署名 (ステートレス) | SLH-DSA-192f | FIPS 205 |
| 耐量子鍵カプセル化 | ML-KEM-768 | FIPS 203 |
| ハッシュ | SHA-256 + SHA3-256 | FIPS 180-4, FIPS 202 |
| 正規化 | JCS | RFC 8785 |

## 開発

### 前提条件

```bash
# Install wasm-pack
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

# Install WASM target
rustup target add wasm32-unknown-unknown
```

### Rust WASMテストを実行

```bash
cd ../rust
wasm-pack test --headless --chrome -- --features wasm
```

## ライセンス

Apache-2.0
