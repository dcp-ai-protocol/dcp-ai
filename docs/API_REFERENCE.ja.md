<sub>[English](API_REFERENCE.md) · [中文](API_REFERENCE.zh-CN.md) · [Español](API_REFERENCE.es.md) · **日本語** · [Português](API_REFERENCE.pt-BR.md)</sub>

<a id="dcp-ai-api-reference"></a>

# DCP-AI API リファレンス

> [英語版](API_REFERENCE.md)の参考訳です（28/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

`main` にある TypeScript SDK `@dcp-ai/sdk`（パッケージのバージョン 2.2.1、プロトコル DCP v2.0）のリファレンスです。

> **npm バージョン（2026 年 10 月 28 日）。** この TypeScript リファレンスは公開済みの `@dcp-ai/sdk` 2.2.1 に適用され、プリンシパルの信頼、`strict-v1`、明示的な選択が必要な候補の実験的 API を含みます。[公開済み npm パッケージ](NPM_RELEASES.md)と SDK の[インストール手順](../sdks/typescript/README.md#installation)を参照してください。`dcp-jcs-v1` が規範的な既定のままです。

このページのコードブロックは宣言や断片であり、完全なプログラムではありません。`registry`、`keys`、
`payloadBytes`、`signedBundle` などの名前は、TypeScript SDK の
[Quick Start (V2)](../sdks/typescript/README.md#quick-start-v2) のように構築された値を表します。完全で実行可能な例は SDK の README にあります。

---

<a id="table-of-contents"></a>

## 目次

- [コアの型（V1）](#core-types-v1)
- [コアの型（V2）](#core-types-v2)
- [暗号関数（V1）](#crypto-functions-v1)
- [V2 の複合署名の操作](#v2-composite-signature-operations)
- [V2 のバンドルビルダーと署名](#v2-bundle-builder--signer)
- [V2 の検証](#v2-verification)
- [セキュリティティアのエンジン](#security-tier-engine)
- [A2A プロトコル（DCP-04）](#a2a-protocol-dcp-04)
- [テレメトリーとオブザーバビリティ](#telemetry--observability)
- [ハッシュとマークルツリー](#hashing--merkle-trees)
- [スキーマの検証](#schema-validation)
- [DCP-05：エージェントのライフサイクル](#dcp-05-agent-lifecycle)
- [DCP-06：継承](#dcp-06-succession)
- [DCP-07：紛争解決](#dcp-07-dispute-resolution)
- [DCP-08：権利と義務](#dcp-08-rights--obligations)
- [DCP-09：委任と代理](#dcp-09-delegation--representation)
- [ドメイン分離](#domain-separation)
- [セッションの nonce](#session-nonces)
- [鍵の回復](#key-recovery)
- [緊急失効](#emergency-revocation)
- [バンドルの提示](#bundle-presentation)
- [検証キャッシュ](#verification-cache)
- [CBOR のワイヤ形式](#cbor-wire-format)
- [暗号プロバイダー](#crypto-providers)
- [バージョンの検出](#version-detection)
- [実験的：正規化の候補](#experimental-canonicalization-candidate-dcp-jcs-v2-opt-in-unreleased)

---

<a id="core-types-v1"></a>

## コアの型（V1）

`@dcp-ai/sdk` からインポートします。

### ResponsiblePrincipalRecord

人間のプリンシパルをエージェントに結び付けます。それだけでは宣言された署名付きの結び付けであり、信頼の起点ではありません。
検証器は、バンドルの外で設定された信頼に照らしてこれを評価します（[ADMISSION.md](ADMISSION.md) を参照）。

```typescript
interface ResponsiblePrincipalRecord {
  dcp_version: string;
  human_id: string;
  legal_name: string;
  entity_type: EntityType;
  jurisdiction: string;
  liability_mode: LiabilityMode;
  override_rights: boolean;
  issued_at: string;
  expires_at: string | null;
  contact?: string | null;
  signature: string;
}
```

### AgentPassport

人間のプリンシパルに結び付けられた、AI エージェントの身元を示す文書です。

```typescript
interface AgentPassport {
  dcp_version: string;
  agent_id: string;
  public_key: string;
  principal_binding_reference: string;
  capabilities?: Capability[];
  risk_tier?: RiskTier;
  created_at: string;
  status: AgentStatus;
  signature: string;
}
```

### Intent

エージェントが実行したいアクションの宣言です。

```typescript
interface Intent {
  dcp_version: string;
  intent_id: string;
  agent_id: string;
  human_id: string;
  timestamp: string;
  action_type: ActionType;
  target: IntentTarget;
  data_classes: DataClass[];
  estimated_impact: Impact;
  requires_consent?: boolean | null;
}

interface IntentTarget {
  channel: Channel;
  to?: string | null;
  domain?: string | null;
  url?: string | null;
  [key: string]: unknown;
}
```

### PolicyDecision

ポリシーエンジンが意図を評価した結果です。

```typescript
interface PolicyDecision {
  dcp_version: string;
  intent_id: string;
  decision: PolicyDecisionType;
  risk_score: number;
  reasons: string[];
  required_confirmation?: RequiredConfirmation | null;
}
```

### AuditEntry

実行されたアクションの記録です。この型によって不変になるわけではありません。エントリがハッシュチェーンと、署名済みバンドル（V1）または署名済み
マニフェスト（V2）に含まれ、その範囲が検証されたときに、改変を検出できるようになります。

```typescript
interface AuditEntry {
  dcp_version: string;
  audit_id: string;
  prev_hash: string;
  timestamp: string;
  agent_id: string;
  human_id: string;
  intent_id: string;
  intent_hash: string;
  policy_decision: AuditPolicyDecision;
  outcome: string;
  evidence: AuditEvidence;
}

interface AuditEvidence {
  tool?: string | null;
  result_ref?: string | null;
  [key: string]: unknown;
}
```

### CitizenshipBundle / SignedBundle

```typescript
interface CitizenshipBundle {
  responsible_principal_record: ResponsiblePrincipalRecord;
  agent_passport: AgentPassport;
  intent: Intent;
  policy_decision: PolicyDecision;
  audit_entries: AuditEntry[];
}

interface SignedBundle {
  bundle: CitizenshipBundle;
  signature: BundleSignature;
}
```

### Keypair

```typescript
interface Keypair {
  publicKeyB64: string;
  secretKeyB64: string;
}
```

<a id="enum-types"></a>

### 列挙型

```typescript
type EntityType = 'natural_person' | 'organization';
type LiabilityMode = 'owner_responsible';
type Capability = 'browse' | 'api_call' | 'email' | 'calendar' | 'payments' | 'crm' | 'file_write' | 'code_exec';
type RiskTier = 'low' | 'medium' | 'high';
type AgentStatus = 'active' | 'revoked' | 'suspended';
type ActionType = 'browse' | 'api_call' | 'send_email' | 'create_calendar_event' | 'initiate_payment' | 'update_crm' | 'write_file' | 'execute_code';
type Channel = 'web' | 'api' | 'email' | 'calendar' | 'payments' | 'crm' | 'filesystem' | 'runtime';
type DataClass = 'none' | 'contact_info' | 'pii' | 'credentials' | 'financial_data' | 'health_data' | 'children_data' | 'company_confidential';
type Impact = 'low' | 'medium' | 'high';
type PolicyDecisionType = 'approve' | 'escalate' | 'block';
```

---

<a id="core-types-v2"></a>

## コアの型（V2）

V2 の型は、ポスト量子暗号への対応、セッションバインディング、二重ハッシュチェーンを追加します。

### AgentPassportV2

```typescript
interface AgentPassportV2 {
  dcp_version: '2.0';
  agent_id: string;
  session_nonce: string;            // Anti-splicing nonce
  keys: KeyEntry[];                 // Multi-algorithm key array
  principal_binding_reference: string;
  capabilities: Capability[];
  risk_tier: RiskTier;
  created_at: string;
  status: AgentStatus;
  emergency_revocation_token?: string;
}
```

### ResponsiblePrincipalRecordV2

```typescript
interface ResponsiblePrincipalRecordV2 {
  dcp_version: '2.0';
  human_id: string;
  session_nonce: string;
  legal_name: string;
  entity_type: EntityType;
  jurisdiction: string;
  liability_mode: LiabilityMode;
  override_rights: boolean;
  issued_at: string;
  expires_at: string | null;
  contact: string | null;
  binding_keys: KeyEntry[];
  pii_salt?: string;                // 32 random bytes as hex; signed; keep private (caller responsibility)
}
```

### BlindedResponsiblePrincipalRecordV2

プライバシーに敏感なデプロイのための、個人情報を保護した RPR の変種です。

```typescript
interface BlindedResponsiblePrincipalRecordV2 {
  dcp_version: '2.0';
  human_id: string;
  session_nonce: string;
  blinded: true;
  pii_hash: string;                 // Salted hash of PII fields
  entity_type: EntityType;
  jurisdiction: string;
  liability_mode: LiabilityMode;
  override_rights: boolean;
  issued_at: string;
  expires_at: string | null;
  binding_keys: KeyEntry[];
}
```

ヘルパー（`@dcp-ai/sdk` 2.2.0 以降がエクスポート）：

```typescript
// 32 random bytes as hex. Set it as rpr.pii_salt before signing the RPR and keep it private:
// blindRpr omits it from the blinded record, but the full RPR retains it.
function generatePiiSalt(): string;
// pii_hash = "sha256:" + hex(sha256(canonical({ contact, legal_name, pii_salt })))
// Without pii_salt: the legacy unsalted value (deprecated), for opening old records.
function computePiiHash(rpr: ResponsiblePrincipalRecordV2): string;
// Throws if rpr.pii_salt is missing or malformed. The result never carries pii_salt.
function blindRpr(rpr: ResponsiblePrincipalRecordV2): BlindedResponsiblePrincipalRecordV2;
// warnings flags a full RPR without pii_salt (legacy unsalted commitment);
// a present pii_salt that is not 64 lowercase hex characters is an error.
function verifyBlindedRpr(
  fullRpr: ResponsiblePrincipalRecordV2,
  blindedRpr: BlindedResponsiblePrincipalRecordV2,
): { valid: boolean; errors: string[]; warnings: string[] };
function isBlindedRpr(
  rpr: ResponsiblePrincipalRecordV2 | BlindedResponsiblePrincipalRecordV2,
): rpr is BlindedResponsiblePrincipalRecordV2;
```

### IntentV2

```typescript
interface IntentV2 {
  dcp_version: '2.0';
  intent_id: string;
  session_nonce: string;
  agent_id: string;
  human_id: string;
  timestamp: string;
  action_type: ActionType;
  target: IntentTargetV2;
  data_classes: DataClass[];
  estimated_impact: Impact;
  requires_consent: boolean;
  security_tier?: SecurityTier;     // 'routine' | 'standard' | 'elevated' | 'maximum'
}
```

### PolicyDecisionV2

```typescript
interface PolicyDecisionV2 {
  dcp_version: '2.0';
  intent_id: string;
  session_nonce: string;
  decision: PolicyDecisionType;
  risk_score: number;               // Integer 0–1000 (millirisk, no floats)
  reasons: string[];
  required_confirmation: { type: 'human_approve'; fields?: string[] } | null;
  applied_policy_hash: string;
  timestamp: string;
  resolved_tier?: SecurityTier;
}
```

### AuditEventV2

```typescript
interface AuditEventV2 {
  dcp_version: '2.0';
  audit_id: string;
  session_nonce: string;
  prev_hash: string;
  prev_hash_secondary?: string;     // SHA3-256 chain
  hash_alg: 'sha256' | 'sha256+sha3-256';
  timestamp: string;
  agent_id: string;
  human_id: string;
  intent_id: string;
  intent_hash: string;
  intent_hash_secondary?: string;
  policy_decision: AuditPolicyDecision;
  outcome: string;
  evidence: AuditEvidenceV2;
  pq_checkpoint_ref: string | null;
}
```

### CitizenshipBundleV2 / SignedBundleV2

```typescript
interface CitizenshipBundleV2 {
  dcp_bundle_version: '2.0';
  manifest: BundleManifest;
  responsible_principal_record: SignedPayload<ResponsiblePrincipalRecordV2 | BlindedResponsiblePrincipalRecordV2>;
  agent_passport: SignedPayload<AgentPassportV2>;
  intent: SignedPayload<IntentV2>;
  policy_decision: SignedPayload<PolicyDecisionV2>;
  audit_entries: AuditEventV2[];
  pq_checkpoints?: PQCheckpoint[];
}

interface SignedBundleV2 {
  bundle: CitizenshipBundleV2;
  signature: BundleSignatureV2;
}
```

### BundleManifest

バンドル内のすべてのアーティファクトのハッシュを暗号学的に結び付けるものです。

```typescript
interface BundleManifest {
  session_nonce: string;
  rpr_hash: string;
  passport_hash: string;
  intent_hash: string;
  policy_hash: string;
  audit_merkle_root: string;
  audit_merkle_root_secondary?: string;
  audit_count: number;
  pq_checkpoints?: string[];
  /** When the session began, signed with the manifest (spec/VERIFICATION.md V2-4). */
  session_issued_at?: string;
  session_expires_at?: string;
  intended_verifier?: string;
  canonicalization_profile?: 'dcp-jcs-v1';
}
```

### CompositeSignature

```typescript
interface CompositeSignature {
  classical: SignatureEntry;
  pq: SignatureEntry | null;
  binding: BindingMode;             // 'pq_over_classical' | 'classical_only'
}

interface SignatureEntry {
  alg: string;                      // 'ed25519' | 'ml-dsa-65' | 'slh-dsa-192f'
  kid: string;                      // Key identifier
  sig_b64: string;                  // Base64-encoded signature
}

type BindingMode = 'pq_over_classical' | 'classical_only';
```

### SignedPayload

任意のアーティファクトを、その複合署名とともに包むエンベロープです。

```typescript
interface SignedPayload<T = unknown> {
  payload: T;
  payload_hash: string;
  composite_sig: CompositeSignature;
}
```

### VerifierPolicy

どの署名を要求するかを制御する、検証者が決めるポリシーです。

```typescript
interface VerifierPolicy {
  default_mode: VerificationMode;
  risk_overrides: Record<RiskTier, VerificationMode>;
  min_classical: number;
  min_pq: number;
  accepted_classical_algs: string[];
  accepted_pq_algs: string[];
  accepted_hash_algs: string[];
  require_session_binding: boolean;
  require_composite_binding: boolean;
  max_key_age_days: number;
  allow_v1_bundles: boolean;
  /** Phase 3: when true, classical signatures are not required even in hybrid mode */
  allow_classical_fallback_disable?: boolean;
  /** Phase 3: emit deprecation warnings for classical-only bundles */
  warn_classical_only_deprecated?: boolean;
  /** Phase 3: rejected algorithms from advisory auto-response */
  advisory_rejected_algs?: string[];
  /** Require bundles to include session_expires_at */
  require_session_expiry?: boolean;
  /** Max allowed session duration in seconds (0 = no limit) */
  max_session_duration_seconds?: number;
  /** Require bundles to include intended_verifier matching this verifier's ID */
  require_audience_binding?: boolean;
  /** This verifier's identity for audience binding checks */
  verifier_id?: string;
}

type VerificationMode = 'classical_only' | 'pq_only' | 'hybrid_required' | 'hybrid_preferred';
```

### SecurityTier

```typescript
type SecurityTier = 'routine' | 'standard' | 'elevated' | 'maximum';
```

### PQCheckpoint

```typescript
interface PQCheckpoint {
  checkpoint_id: string;
  session_nonce: string;
  event_range: {
    from_audit_id: string;
    to_audit_id: string;
    count: number;
  };
  merkle_root: string;
  composite_sig: CompositeSignature;
}
```

---

<a id="crypto-functions-v1"></a>

## 暗号関数（V1）

`@dcp-ai/sdk` からインポートします。

### `generateKeypair()`

新しい Ed25519 の鍵ペアを生成します。

```typescript
function generateKeypair(): Keypair;
```

**戻り値：** `{ publicKeyB64: string, secretKeyB64: string }`

```typescript
import { generateKeypair } from '@dcp-ai/sdk';

const keys = generateKeypair();
console.log(keys.publicKeyB64); // Base64-encoded Ed25519 public key
```

### `signObject(obj, secretKeyB64)`

JSON オブジェクトに Ed25519 で署名します（分離署名）。オブジェクトは署名の前に正規化されます。

```typescript
function signObject(obj: unknown, secretKeyB64: string): string;
```

| パラメーター | 型 | 説明 |
|-------|------|-------------|
| `obj` | `unknown` | 署名する、JSON にシリアライズ可能なオブジェクト |
| `secretKeyB64` | `string` | base64 でエンコードした Ed25519 の秘密鍵 |

**戻り値：** base64 でエンコードした分離署名。

```typescript
const sig = signObject({ action: 'transfer', amount: 100 }, keys.secretKeyB64);
```

### `verifyObject(obj, signatureB64, publicKeyB64)`

JSON オブジェクトに対する Ed25519 の分離署名を検証します。

```typescript
function verifyObject(obj: unknown, signatureB64: string, publicKeyB64: string): boolean;
```

| パラメーター | 型 | 説明 |
|-------|------|-------------|
| `obj` | `unknown` | 元の JSON オブジェクト |
| `signatureB64` | `string` | base64 でエンコードした署名 |
| `publicKeyB64` | `string` | base64 でエンコードした Ed25519 の公開鍵 |

**戻り値：** 署名が検証できれば `true`、できなければ `false`。不正な形式の入力では、`false` を返す代わりに例外を投げることが
あります。正規化できないオブジェクト、有効な base64 でない署名や鍵、デコード後の長さが正しくない署名や鍵などです。

```typescript
const valid = verifyObject({ action: 'transfer', amount: 100 }, sig, keys.publicKeyB64);
```

### `canonicalize(obj)`

キーの順序が決定的な、正規の JSON シリアライズです。

```typescript
function canonicalize(obj: unknown): string;
```

### `publicKeyFromSecret(secretKeyB64)`

秘密鍵から Ed25519 の公開鍵を導出します。

```typescript
function publicKeyFromSecret(secretKeyB64: string): string;
```

---

<a id="v2-composite-signature-operations"></a>

## V2 の複合署名の操作

`@dcp-ai/sdk` からインポートします。

### `compositeSign(registry, context, canonicalPayloadBytes, keys)`

PQ 署名がクラシカルな署名を覆う、複合バインディングのハイブリッド署名を生成します。そのため、PQ 署名を無効にせずにクラシカルな
署名を差し替えることはできません。PQ 署名を取り除く（バインディングを `classical_only` に付け替える）ことが拒否されるのは、
実効モードが `hybrid_required` または `pq_only` の場合だけで、`classical_only` と `hybrid_preferred` はそれを受け入れます
（[MIGRATION_V1_V2.md](MIGRATION_V1_V2.md#step-4-switch-to-composite-signatures) を参照）。

**バインディングのプロトコル：**
1. `classical_sig = Classical.sign(context || 0x00 || payload)`
2. `pq_sig = PQ.sign(context || 0x00 || payload || classical_sig)`

```typescript
async function compositeSign(
  registry: AlgorithmRegistry,
  context: DcpContext | string,
  canonicalPayloadBytes: Uint8Array,
  keys: CompositeKeyPair,
): Promise<CompositeSignature>;
```

| パラメーター | 型 | 説明 |
|-------|------|-------------|
| `registry` | `AlgorithmRegistry` | プロバイダーが登録されたアルゴリズムレジストリ |
| `context` | `DcpContext \| string` | ドメイン分離のコンテキスト |
| `canonicalPayloadBytes` | `Uint8Array` | 署名する正規のバイト列 |
| `keys` | `CompositeKeyPair` | クラシカル + PQ の鍵ペア |

```typescript
import { registerDefaultProviders, getDefaultRegistry, compositeSign, DCP_CONTEXTS } from '@dcp-ai/sdk';

registerDefaultProviders();
const registry = getDefaultRegistry();

const sig = await compositeSign(registry, DCP_CONTEXTS.Bundle, payloadBytes, keys);
// sig.binding === 'pq_over_classical'
```

### `compositeVerify(registry, context, canonicalPayloadBytes, compositeSig, classicalPubkeyB64, pqPubkeyB64?, strategy?)`

複合バインディングのハイブリッド署名を検証します。

```typescript
async function compositeVerify(
  registry: AlgorithmRegistry,
  context: DcpContext | string,
  canonicalPayloadBytes: Uint8Array,
  compositeSig: CompositeSignature,
  classicalPubkeyB64: string,
  pqPubkeyB64?: string,
  strategy?: 'parallel' | 'pq_first',
): Promise<CompositeVerifyResult>;
```

| パラメーター | 型 | 説明 |
|-------|------|-------------|
| `strategy` | `'parallel' \| 'pq_first'` | `parallel`（既定）：両方を並行して検証する。`pq_first`：先に PQ を検証し、PQ が失敗したらクラシカルは省略する。 |

**戻り値：**

```typescript
interface CompositeVerifyResult {
  valid: boolean;           // pq_over_classical: both signatures valid; classical_only: the classical one (pq_valid false).
                            // Not by itself a policy-mode, trust or admission decision
  classical_valid: boolean;
  pq_valid: boolean;
}
```

### `classicalOnlySign(registry, context, canonicalPayloadBytes, key)`

クラシカルのみの複合署名を生成します（移行モード）。

```typescript
async function classicalOnlySign(
  registry: AlgorithmRegistry,
  context: DcpContext | string,
  canonicalPayloadBytes: Uint8Array,
  key: CompositeKeyInfo,
): Promise<CompositeSignature>;
```

<a id="supporting-types"></a>

### 補助的な型

```typescript
interface CompositeKeyPair {
  classical: CompositeKeyInfo;
  pq: CompositeKeyInfo;
}

interface CompositeKeyInfo {
  kid: string;
  secretKeyB64: string;
  publicKeyB64: string;
  alg: string;            // 'ed25519' | 'ml-dsa-65'
}
```

---

<a id="v2-bundle-builder--signer"></a>
<a id="v2-bundle-builder-signer"></a>

## V2 のバンドルビルダーと署名

### BundleBuilderV2

マニフェストの計算とセッションの nonce の検証を行う、V2 の Citizenship Bundle 用のフルエントなビルダーです。

```typescript
class BundleBuilderV2 {
  constructor(sessionNonce: string);

  responsiblePrincipalRecord(rpr: SignedPayload<ResponsiblePrincipalRecordV2 | BlindedResponsiblePrincipalRecordV2>): this;
  agentPassport(passport: SignedPayload<AgentPassportV2>): this;
  intent(intent: SignedPayload<IntentV2>): this;
  policyDecision(policy: SignedPayload<PolicyDecisionV2>): this;
  addAuditEntry(entry: AuditEventV2): this;
  addAuditEntries(entries: AuditEventV2[]): this;
  addPQCheckpoint(checkpoint: PQCheckpoint): this;
  addPQCheckpoints(checkpoints: PQCheckpoint[]): this;
  enableDualHash(): this;
  build(): CitizenshipBundleV2;     // Throws on validation errors
}
```

```typescript
const bundle = new BundleBuilderV2(sessionNonce)
  .responsiblePrincipalRecord(signedRpr)
  .agentPassport(signedPassport)
  .intent(signedIntent)
  .policyDecision(signedPolicy)
  .addAuditEntries(events)
  .addPQCheckpoints(checkpoints)
  .enableDualHash()
  .build();
```

ビルダーは：
- すべてのアーティファクトでセッションの nonce が一貫していることを検証します
- 各アーティファクトの SHA-256 ハッシュで `BundleManifest` を計算します
- 監査のマークルルート（+ オプションの SHA3-256 の二次ルート）を計算します
- 必須のアーティファクトが欠けていれば例外を投げます

### `signBundleV2(bundle, options)`

マニフェストに対する複合（ハイブリッド）署名で V2 のバンドルに署名します。

```typescript
async function signBundleV2(
  bundle: CitizenshipBundleV2,
  options: SignBundleV2Options,
): Promise<SignedBundleV2>;

interface SignBundleV2Options {
  registry: AlgorithmRegistry;
  signerType: SignerType;
  signerId: string;
  keys: CompositeKeyPair;
  dualHash?: boolean;
  sessionExpiresAt?: string;
  intendedVerifier?: string;
}
```

### `signBundleV2ClassicalOnly(bundle, options)`

クラシカルのみの署名で V2 のバンドルに署名します（移行モード）。

```typescript
async function signBundleV2ClassicalOnly(
  bundle: CitizenshipBundleV2,
  options: SignBundleV2ClassicalOnlyOptions,
): Promise<SignedBundleV2>;

interface SignBundleV2ClassicalOnlyOptions {
  registry: AlgorithmRegistry;
  signerType: SignerType;
  signerId: string;
  key: CompositeKeyInfo;
}
```

---

<a id="v2-verification"></a>

## V2 の検証

### `verifySignedBundleV2(signedBundle, registry, policy?, options?)`

検証者が決めるポリシーによる、署名済みの V2 バンドルの検証です。検証器は一次の監査チェーンとマークルルートを確認し、2.2.1 以降は存在する二次の `prev_hash_secondary`、`intent_hash_secondary`、`audit_merkle_root_secondary` も確認します（存在しないものは要求しないため、検証の成功は完全な二次チェーンを示しません。2.2.0 はこれらを確認しないため、それを使った検証の成功はそれらの一貫性を保証しません）（[実装の状況](STORAGE_AND_ANCHORING.md#dual-hash-chains)）。検証は、アドミッションやアクションの承認も与えません。

```typescript
async function verifySignedBundleV2(
  signedBundle: SignedBundleV2,
  registry: AlgorithmRegistry,
  policy?: VerifierPolicy,
  options?: VerifyV2Options, // { now?: number }: the instant every time check uses (ms since the epoch); default Date.now()
): Promise<VerifyV2Result>;
```

| パラメーター | 型 | 説明 |
|-------|------|-------------|
| `signedBundle` | `SignedBundleV2` | 検証する署名済みのバンドル |
| `registry` | `AlgorithmRegistry` | プロバイダーを持つアルゴリズムレジストリ |
| `policy` | `VerifierPolicy` | 検証器のポリシー（既定は `DEFAULT_VERIFIER_POLICY`） |
| `options.now` | `number` | すべての時刻のチェックで使う時点。エポックからのミリ秒（既定は `Date.now()`） |

**戻り値：**

```typescript
interface VerifyV2Result {
  verified: boolean;
  errors: string[];
  warnings: string[];
  details?: {
    session_nonce?: string;
    session_expires_at?: string;
    intended_verifier?: string;
    manifest_valid?: boolean;
    signature_valid?: boolean;
    policy_satisfied?: boolean;
    hash_chain_valid?: boolean;
    pq_checkpoints_valid?: boolean;
    verification_mode?: VerificationMode;
    resolved_tier?: SecurityTier;
    advisory_rejected_algs?: string[];
    /**
     * For every composite signature checked, the key entry the verifier resolved for each
     * component and whether that component verified (spec/profiles/admission § 2.3).
     */
    signer_keys?: SignerKeyUse[];
  };
}
```

`verification_mode` はバンドルの確認に使われたモード、`resolved_tier` はその意図とポリシー判断から計算されたセキュリティティアです。

**検証のパイプライン：**

1. バージョンとスキーマの確認：v2.0 のバンドルだけを受け付け、ほかのバージョンは拒否する。v1.0 のバンドルを `verifySignedBundle` に振り分けるのは呼び出し側の役割（[MIGRATION_V1_V2.md](MIGRATION_V1_V2.md#32-coexistence-strategy)）
2. すべての署名済みアーティファクトのペイロードのハッシュの検証
3. すべてのアーティファクトでのセッションの nonce の一貫性
4. マニフェストの完全性（すべてのアーティファクトのハッシュ + 監査のマークルルートを再計算）
5. 検証モード：ポリシーのモード（`default_mode`、またはパスポートの `risk_tier` に対する `risk_overrides` のエントリ）とセキュリティティアのモード（仕様 §14.3）のうち厳しいほう。`pq_only` のポリシーは `pq_only` のまま
6. ポリシーに照らしたアルゴリズムの検証
7. マニフェストに対する複合署名と、各アーティファクトの `SignedPayload` に対する複合署名の検証（RPR はその `binding_keys` で、パスポート、意図、ポリシー判断はパスポートの `keys` で）
8. ポリシーのモードの適用（hybrid_required、hybrid_preferred、classical_only、pq_only）。存在する PQ 署名はどのモードでも検証に通らなければならず、欠けている場合だけが hybrid_preferred と classical_only で許容される
9. 監査のハッシュチェーンの検証（prev_hash のリンク）
10. パスポートの鍵と RPR の `binding_keys` に対する鍵の有効性の確認（失効、有効期限、古さ）

> `@dcp-ai/sdk` 2.1.2 以前は、ステップ 7 のアーティファクトごとの署名（VERIFICATION.md のステップ V2-8）を省略し、`hybrid_preferred` のもとでは、存在するが無効な PQ 署名を警告付きで受け入れます（ステップ V2-7）。

```typescript
import { verifySignedBundleV2, getDefaultRegistry, registerDefaultProviders } from '@dcp-ai/sdk';

// The default registry is empty until providers are registered
// (Ed25519, ML-DSA-65, SLH-DSA-192f).
registerDefaultProviders();

const result = await verifySignedBundleV2(signedBundle, getDefaultRegistry());
if (result.verified) {
  console.log('Mode:', result.details?.verification_mode);
} else {
  console.error('Errors:', result.errors);
  console.warn('Warnings:', result.warnings);
}
```

<a id="admission-trusted-principals-and-strict-v1"></a>
<a id="admission-trusted-principals-and-strict-v1-unreleased"></a>

### アドミッション：信頼済みのプリンシパルと strict-v1

[`spec/profiles/admission`](../spec/profiles/admission/README.md) で定義されています。ガイドは [ADMISSION.md](ADMISSION.md) です。

| 関数 | 説明 |
|----------|-------------|
| `createPrincipalTrustStore(trustSet)` | 信頼セットを検証してストアを返す。`AdmissionConfigError`（`code`）を投げる |
| `resolveStrictV1Profile(config)` | strict-v1 の設定を検証し、その `policy` を持つ凍結されたプロファイルを返す |
| `admitSignedBundleV2(signedBundle, registry, { profile?, policy?, trust?, revocation?, now? })` | 検証し（プロファイルがあればそのポリシーのもとで）、アドミッションを評価する |
| `evaluateAdmissionV2({ signedBundle, verification, profile?, trust?, revocation?, now })` | 検証器の結果からアドミッションを評価する。暗号処理も I/O も行わない。`verification` を信頼するので、そのバンドルについて、その `now` で、`profile.policy` のもとで `verifySignedBundleV2` を実行した結果だけを渡すこと |
| `revocationSubjects(signedBundle, verification)` | 失効情報の提供元が答えるべき、エージェントの ID と検証済みの署名者の kid |
| `revocationSnapshotFromDenyList(document, subjects)` | 完全な拒否リスト（失効サービスの `/.well-known/dcp-revocations.json`）から作るスナップショット |

結果：`verified`、`verification`、`principal_trust`、`profile`、`profile_compliance`、`admitted`、`action_authorized`（常に `false`）、`recorded_decision`、`trust_set_version`、`errors: [{ code, message }]`。

### `DEFAULT_VERIFIER_POLICY`

既定の検証器のポリシー：

```typescript
const DEFAULT_VERIFIER_POLICY: VerifierPolicy = {
  default_mode: 'hybrid_preferred',
  risk_overrides: {
    low: 'classical_only',
    medium: 'hybrid_preferred',
    high: 'hybrid_required',
  },
  min_classical: 1,
  min_pq: 1,
  accepted_classical_algs: ['ed25519'],
  accepted_pq_algs: ['ml-dsa-65', 'slh-dsa-192f'],
  accepted_hash_algs: ['sha256', 'sha384'],
  require_session_binding: true,
  require_composite_binding: true,
  max_key_age_days: 365,
  allow_v1_bundles: true,
  allow_classical_fallback_disable: false,
  warn_classical_only_deprecated: false,
  advisory_rejected_algs: [],
};
```

<a id="verifysignedbundlesignedbundle-publickeyb64-v1"></a>

### `verifySignedBundle(signedBundle, publicKeyB64?)`（V1）

Ed25519 で署名された V1 のバンドルを検証します。`publicKeyB64` がなければ、`signature.signer.public_key_b64` の鍵が使われます。

```typescript
function verifySignedBundle(signedBundle: SignedBundle, publicKeyB64?: string): VerificationResult;

interface VerificationResult {
  verified: boolean;
  errors?: string[];
}
```

---

<a id="security-tier-engine"></a>

## セキュリティティアのエンジン

### `computeSecurityTier(intent, policyDecision?, mandateChainTier?)`

意図とバンドルのポリシー判断からセキュリティティアを計算します（仕様 §14.2）。`mandateChainTier`、
すなわち検証済みの委任チェーン（`verifyMandateChain`）の `effective_tier` は、結果を引き上げることしかできません。

```typescript
function computeSecurityTier(
  intent: IntentV2,
  policyDecision?: Pick<PolicyDecisionV2, 'risk_score'> | null,
  mandateChainTier?: SecurityTier | null,
): SecurityTier;
```

**判断のロジック**（`risk_score` はポリシー判断から取り、0 から 1000 の整数でなければならない。ポリシー判断がなければ 0）：

| 条件 | ティア |
|-----------|------|
| `risk_score >= 800`、または `credentials` / `children_data` | `'maximum'` |
| `risk_score >= 500`、`pii` / `financial_data` / `health_data`、`initiate_payment`、`estimated_impact: 'high'`、`action_type`・`estimated_impact`・`data_classes` の値が不明または欠落、またはポリシー判断の `risk_score` が欠落しているか 0 から 1000 の整数でない | `'elevated'` |
| `risk_score >= 200` または `estimated_impact: 'medium'` | `'standard'` |
| それ以外 | `'routine'` |

明示した `intent.security_tier` は結果を引き上げることしかできず、不明な値は `'elevated'` として扱われます。意図に置いた `risk_score` は無視されます。

```typescript
import { computeSecurityTier } from '@dcp-ai/sdk';

const tier = computeSecurityTier(bundle.intent.payload, bundle.policy_decision.payload);
// 'routine' | 'standard' | 'elevated' | 'maximum'
```

### `tierToVerificationMode(tier)`

セキュリティティアをその検証モードに対応付けます。

```typescript
function tierToVerificationMode(tier: SecurityTier): VerificationMode;
```

| ティア | 検証モード |
|------|------------------|
| `routine` | `'classical_only'` |
| `standard` | `'hybrid_preferred'` |
| `elevated` | `'hybrid_required'` |
| `maximum` | `'hybrid_required'` |

### `tierToCheckpointInterval(tier)`

セキュリティティアを PQ チェックポイントの間隔に対応付けます。

```typescript
function tierToCheckpointInterval(tier: SecurityTier): number;
```

| ティア | 間隔（イベント数） |
|------|--------------------|
| `routine` | 50 |
| `standard` | 10 |
| `elevated` | 1 |
| `maximum` | 1 |

### `maxTier(a, b)`

2 つのティアのうち最も厳しい（ランクが最も高い）ものを返します。自動計算したティアと明示したティアを組み合わせるのに便利です。

```typescript
function maxTier(a: SecurityTier, b: SecurityTier): SecurityTier;

maxTier('routine', 'elevated'); // 'elevated'
maxTier('maximum', 'standard'); // 'maximum'
```

### `effectiveVerificationMode(policyMode, tier)`

検証器が適用するモードです（仕様 §14.3）。ポリシーのモードとティアのモードのうち厳しいほうで、`classical_only` < `hybrid_preferred` < `hybrid_required` の順です。ティアは PQ の要件を加えるだけなので、`pq_only` のポリシーは `pq_only` のままです。不明なポリシーのモードは `'hybrid_required'` として扱われます。`verifySignedBundleV2` はこれをすべてのバンドルに適用します。

```typescript
function effectiveVerificationMode(policyMode: VerificationMode, tier: SecurityTier): VerificationMode;

effectiveVerificationMode('classical_only', 'elevated'); // 'hybrid_required'
effectiveVerificationMode('hybrid_required', 'routine'); // 'hybrid_required'
effectiveVerificationMode('pq_only', 'maximum'); // 'pq_only'
```

---

<a id="a2a-protocol-dcp-04"></a>

## A2A プロトコル（DCP-04）

X25519 + ML-KEM-768 のハイブリッドな鍵交換を前提に設計された、エージェント間のセッションプロトコルです。これらの関数はその
交換を行いません。呼び出し側が交換を行い、得られたセッション鍵を `createSession` に渡します。

### `createHello(initiatorBundle, kemPublicKeyB64, requestedCapabilities, securityTier)`

A2A_HELLO のハンドシェイクメッセージを作成します（開始側）。

```typescript
function createHello(
  initiatorBundle: Record<string, unknown>,
  kemPublicKeyB64: string,
  requestedCapabilities: string[],
  securityTier: string,
): A2AHello;
```

```typescript
interface A2AHello {
  type: 'A2A_HELLO';
  protocol_version: '2.0';
  initiator_bundle: Record<string, unknown>;
  ephemeral_kem_public_key: {
    alg: string;
    public_key_b64: string;
  };
  nonce: string;
  supported_algorithms: {
    signing: string[];
    kem: string[];
    cipher: string[];
  };
  requested_capabilities: string[];
  security_tier: string;
  timestamp: string;
  /** DCP-09: Optional delegation mandate reference for mutual verification */
  mandate_id?: string;
  /** DCP-09: Hash of the delegation mandate for integrity binding */
  mandate_hash?: string;
}
```

### `createWelcome(responderBundle, kemPublicKeyB64, kemCiphertextB64, resolvedTier)`

A2A_WELCOME のハンドシェイクメッセージを作成します（応答側）。

```typescript
function createWelcome(
  responderBundle: Record<string, unknown>,
  kemPublicKeyB64: string,
  kemCiphertextB64: string,
  resolvedTier: string,
): A2AWelcome;
```

### `createSession(sessionId, sessionKey, localAgentId, remoteAgentId, securityTier, rekeyingInterval?)`

ハンドシェイクの完了後に、暗号化された新しい A2A セッションを作成します。

```typescript
function createSession(
  sessionId: string,
  sessionKey: Uint8Array,
  localAgentId: string,
  remoteAgentId: string,
  securityTier: string,
  rekeyingInterval?: number,       // Default: 1000 messages
): A2ASession;
```

```typescript
interface A2ASession {
  session_id: string;
  session_key: Uint8Array;
  agent_id_local: string;
  agent_id_remote: string;
  message_counter_send: number;
  message_counter_recv: number;
  created_at: string;
  last_activity: string;
  security_tier: string;
  rekeying_interval: number;
  status: 'active' | 'rekeying' | 'closed';
  received_sequences?: number[];   // Sequences accepted within the receive window
}
```

### `encryptMessage(session, payload)`

関連データ付きの AES-256-GCM を使って、A2A セッション内でメッセージを暗号化します。

```typescript
function encryptMessage(
  session: A2ASession,
  payload: Record<string, unknown>,
): EncryptedMessage;
```

```typescript
interface EncryptedMessage {
  session_id: string;
  sequence: number;
  type: 'A2A_MESSAGE';
  encrypted_payload: string;        // Base64-encoded ciphertext
  iv: string;                       // Base64-encoded 12-byte IV
  tag: string;                      // Base64-encoded 16-byte GCM auth tag
  sender_agent_id: string;
  timestamp: string;
}
```

### `decryptMessage(session, message)`

受信した A2A メッセージを復号します。各シーケンスは一度だけ受け付けられます（DCP-04 §8.4）。`R` =
`message_counter_recv`（受信した最大のシーケンス + 1）とすると、すでに受信したシーケンス、
`R − 1000` 未満のもの、`R + 1000` 以上のもの、非負の整数でないものは拒否されます。ウィンドウ内での順不同の配送は機能します。シーケンスは
GCM のタグが検証された後でのみ記録されるため、偽造されたメッセージがそれを使い果たすことはできません。
`received_sequences` なしで復元されたセッションは、`message_counter_recv` より下のウィンドウ内のすべてのシーケンスを受信済みとして扱います。

```typescript
function decryptMessage(
  session: A2ASession,
  message: EncryptedMessage,
): Record<string, unknown>;
```

### `needsRekeying(session)`

メッセージ数に基づいて、セッションに鍵の更新が必要かを確認します。

```typescript
function needsRekeying(session: A2ASession): boolean;
```

### `deriveSessionId(agentIdA, agentIdB, nonceA, nonceB, sessionKey)`

エージェントの ID、nonce、セッション鍵から、決定的にセッション ID を導出します。

```typescript
function deriveSessionId(
  agentIdA: string, agentIdB: string,
  nonceA: string, nonceB: string,
  sessionKey: Uint8Array,
): string;
```

### `generateResumeProof(session, lastSeenSequence)` / `verifyResumeProof(...)`

HMAC に基づくセッション再開の証明を生成・検証します。

```typescript
function generateResumeProof(session: A2ASession, lastSeenSequence: number): string;
function verifyResumeProof(session: A2ASession, lastSeenSequence: number, proof: string): boolean;
```

### `deriveRekeyedSessionKey(oldSessionKey, newSharedSecret, sessionId)`

鍵の更新操作のために、新しいセッション鍵を導出します。

```typescript
function deriveRekeyedSessionKey(
  oldSessionKey: Uint8Array,
  newSharedSecret: Uint8Array,
  sessionId: string,
): Uint8Array;
```

### `createCloseMessage(sessionId, reason, finalSequence, auditSummaryHash)`

A2A_CLOSE メッセージを作成します。

```typescript
function createCloseMessage(
  sessionId: string,
  reason: 'complete' | 'timeout' | 'error' | 'revocation' | 'policy_violation',
  finalSequence: number,
  auditSummaryHash: string,
): A2AClose;
```

### `generateNonce()`

32 バイトの暗号学的な乱数の nonce（16 進エンコード）を生成します。

```typescript
function generateNonce(): string;
```

---

<a id="telemetry--observability"></a>
<a id="telemetry-observability"></a>

## テレメトリーとオブザーバビリティ

### `dcpTelemetry`

DCP SDK のシングルトンのテレメトリーインスタンスです。

```typescript
import { dcpTelemetry } from '@dcp-ai/sdk';
```

### `dcpTelemetry.init(config)`

指定した設定でテレメトリーを初期化します。

```typescript
dcpTelemetry.init(config: Partial<DcpTelemetryConfig>): void | Promise<void>; // enabled: false returns nothing; with exporterType 'otlp', a Promise that settles after the setup attempt

interface DcpTelemetryConfig {
  serviceName: string;              // Identifier for this agent/service
  enabled: boolean;                 // Enable/disable telemetry
  exporterType?: 'console' | 'otlp' | 'none';
  otlpEndpoint?: string;           // OTLP collector endpoint
  metricsInterval?: number;        // Metrics export interval (ms)
}
```

```typescript
dcpTelemetry.init({
  serviceName: 'my-agent',
  enabled: true,
  exporterType: 'console',
});
```

`exporterType: 'otlp'` の場合、OTLP の設定に失敗しても Promise は解決されます。失敗は、`operation: 'telemetry.init_otlp'`
を持つ `error` イベントとして `onEvent` のリスナーに届きます。設定が完了する前に発行されたイベントは OTLP に再送されず、Promise
が解決されてもバックエンドへの配信は保証されません。計装は明示的です。SDK の署名関数と検証関数はレコーダーを呼び出さないため、
スパンとメトリクスは、あなたのコードが行う `startSpan` と `record*` の呼び出しからしか生じません（[OBSERVABILITY.md](OBSERVABILITY.md) を参照）。

### `dcpTelemetry.startSpan(name, attributes?)` / `endSpan(spanId, status?, error?)`

操作のトレーススパンを作成・完了します。

```typescript
startSpan(name: string, attributes?: SpanAttributes): string;
endSpan(spanId: string, status?: 'ok' | 'error', error?: string): number;

// Returns duration in milliseconds
```

```typescript
const spanId = dcpTelemetry.startSpan('verify_bundle', { tier: 'elevated' });
// ... operation ...
const durationMs = dcpTelemetry.endSpan(spanId);
```

### `dcpTelemetry.recordSignLatency(durationMs, algorithm)`

署名操作のレイテンシーを記録します。

```typescript
recordSignLatency(durationMs: number, algorithm: string): void;
```

### `dcpTelemetry.recordVerifyLatency(durationMs, algorithm)`

検証操作のレイテンシーを記録します。

```typescript
recordVerifyLatency(durationMs: number, algorithm: string): void;
```

### `dcpTelemetry.recordKemLatency(durationMs, operation)`

KEM（鍵カプセル化）操作のレイテンシーを記録します。

```typescript
recordKemLatency(durationMs: number, operation: 'encapsulate' | 'decapsulate'): void;
```

### `dcpTelemetry.recordCheckpointLatency(durationMs, tier)`

PQ チェックポイントの作成のレイテンシーを記録します。

```typescript
recordCheckpointLatency(durationMs: number, tier: string): void;
```

### `dcpTelemetry.recordBundleVerify(durationMs, success, tier)`

バンドルの検証操作を記録します。

```typescript
recordBundleVerify(durationMs: number, success: boolean, tier: string): void;
```

### `dcpTelemetry.recordCacheHit()` / `recordCacheMiss()`

検証キャッシュのヒット率とミス率を追跡します。

```typescript
recordCacheHit(): void;
recordCacheMiss(): void;
```

### `dcpTelemetry.recordA2ASession()` / `recordA2AMessage()`

A2A プロトコルの使用状況を追跡します。

```typescript
recordA2ASession(): void;
recordA2AMessage(): void;
```

### `dcpTelemetry.recordError(operation, error)`

エラーの発生を記録します。

```typescript
recordError(operation: string, error: string): void;
```

### `dcpTelemetry.getMetricsSummary()`

収集したすべてのメトリクスの概要を、パーセンタイルの統計とともに取得します。

```typescript
getMetricsSummary(): MetricsSummary;

interface MetricsSummary {
  sign: PercentileStats;
  verify: PercentileStats;
  kem: PercentileStats;
  checkpoint: PercentileStats;
  bundleVerify: PercentileStats;
  cacheHitRate: number;            // 0.0 – 1.0
  tierDistribution: Record<string, number>;
  totals: {
    signaturesCreated: number;
    signaturesVerified: number;
    bundlesVerified: number;
    errors: number;
    a2aSessions: number;
    a2aMessages: number;
  };
}

interface PercentileStats {
  count: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
  mean: number;
}
```

### `dcpTelemetry.onEvent(listener)`

テレメトリーのイベントを購読します。購読を解除する関数を返します。

```typescript
onEvent(listener: (event: TelemetryEvent) => void): () => void;

interface TelemetryEvent {
  type: string;
  timestamp: number;
  [key: string]: unknown;
}
```

### `dcpTelemetry.reset()`

収集したすべてのスパンとメトリクスをリセットします。

```typescript
reset(): void;
```

---

<a id="hashing--merkle-trees"></a>
<a id="hashing-merkle-trees"></a>

## ハッシュとマークルツリー

### `hashObject(obj)`

正規化した JSON オブジェクトの SHA-256 ハッシュです。

```typescript
function hashObject(obj: unknown): string;
```

### `merkleRootFromHexLeaves(leaves)`

16 進エンコードしたリーフのハッシュからマークルルートを計算します。

```typescript
function merkleRootFromHexLeaves(leaves: string[]): string | null; // null for no leaves
```

### `merkleRootForAuditEntries(auditEntries)`

監査エントリの配列のマークルルートを計算します（空の配列では `null`）。

```typescript
function merkleRootForAuditEntries(auditEntries: unknown[]): string | null;
```

### `intentHash(intent)`

意図のオブジェクトのハッシュを計算します。

```typescript
function intentHash(intent: unknown): string;
```

### `prevHashForEntry(prevEntry)`

直前のエントリから、次の監査エントリの `prev_hash` を計算します。

```typescript
function prevHashForEntry(prevEntry: unknown): string;
```

### `sha256Hex(data)` / `sha3_256Hex(data)`

16 進エンコードしたハッシュです。

```typescript
function sha256Hex(data: Uint8Array | Buffer | string): string;
function sha3_256Hex(data: Uint8Array | Buffer | string): string;
```

### `dualHash(data)` / `dualHashCanonical(canonicalJson)` / `dualMerkleRoot(leaves)`

V2 のための二重ハッシュ（SHA-256 + SHA3-256）の操作です。`dualHashCanonical` は正規化済みの JSON 文字列を受け取り、`dualMerkleRoot` はリーフがなければ `null` を返します。

```typescript
function dualHash(data: Uint8Array | Buffer | string): DualHash;
function dualHashCanonical(canonicalJson: string): DualHash;
function dualMerkleRoot(leaves: DualHash[]): DualHash | null;

interface DualHash {
  sha256: string;
  sha3_256: string;
}
```

### `auditEventsMerkleRoot(events)`

V2 の監査イベントの SHA-256 のマークルルートを計算します。

```typescript
function auditEventsMerkleRoot(events: AuditEventV2[]): string;
```

---

<a id="schema-validation"></a>

## スキーマの検証

### `validateSchema(schemaName, data)`

DCP のアーティファクトをその JSON Schema に照らして検証します。

```typescript
function validateSchema(schemaName: string, data: unknown): ValidationResult;
```

### `validateBundle(bundle)`

citizenship bundle 全体を検証します。

```typescript
function validateBundle(bundle: unknown): ValidationResult;

interface ValidationResult {
  valid: boolean;
  errors?: string[];
}
```

---

<a id="dcp-05-agent-lifecycle"></a>

## DCP-05：エージェントのライフサイクル

`@dcp-ai/sdk` からインポートします。

### `validateStateTransition(from, to)`

ライフサイクルの状態遷移が有効かを確認します。

```typescript
function validateStateTransition(from: LifecycleState, to: LifecycleState): boolean;

type LifecycleState = 'commissioned' | 'active' | 'declining' | 'decommissioned';
```

有効な遷移：`commissioned→active`、`commissioned→decommissioned`、`active→declining`、`active→decommissioned`（突然の障害）、`declining→active`、`declining→decommissioned`。確認するのはエッジだけで、`declining` からの再有効化に仕様が求めるプリンシパルの承認も、ほかのどんな認可も確認しません。

### `computeVitalityScore(metrics)`

構成要素のメトリクスから、重み付けした稼働状況のスコア（0-1000）を計算します。

```typescript
function computeVitalityScore(metrics: VitalityMetrics): number;

interface VitalityMetrics {
  task_completion_rate: number;  // 0.0 – 1.0
  error_rate: number;            // 0.0 – 1.0
  human_satisfaction: number;    // 0.0 – 1.0
  policy_alignment: number;      // 0.0 – 1.0
}
```

### `createCommissioningCertificate(...)` / `createVitalityReport(...)` / `createDecommissioningRecord(...)`

署名済みのライフサイクルのアーティファクトを作成します。いずれも `AlgorithmRegistry` と `CompositeKeyPair` が必要です。

```typescript
type TerminationMode = 'planned_retirement' | 'termination_for_cause' | 'organizational_restructuring' | 'sudden_failure';
type DataDisposition = 'transferred' | 'archived' | 'destroyed';
```

---

<a id="dcp-06-succession"></a>

## DCP-06：継承

### `createDigitalTestament(...)` / `updateDigitalTestament(...)`

後継者の選好とメモリーの分類を持つデジタル遺言を作成または更新します。

```typescript
type MemoryDisposition = 'transfer' | 'retain' | 'destroy';
type MemoryClassification = Record<string, MemoryDisposition>;

interface SuccessorPreference {
  agent_id: string;
  priority: number;
  conditions?: string;
}
```

### `executeSuccession(...)` / `createMemoryTransferManifest(...)`

継承のセレモニーを実行し、メモリー移転のマニフェストを作成します。

```typescript
type TransitionType = 'planned' | 'forced' | 'emergency';
```

### `classifyMemory(entries, classification)`

メモリーのエントリを、運用上のもの（移転可能）と関係上のもの（破棄の対象）に分類します。`{ operational, relationalDestroyed }`
を返し、`relationalDestroyed` には `destroy` に分類されたエントリ（エントリのないカテゴリの既定値でもあります）のハッシュだけが
入ります。何も削除しないため、そのメモリーを実際に破棄するのは呼び出し側の役割です。`retain` に分類されたエントリは、どちらの
出力にも現れません。

---

<a id="dcp-07-dispute-resolution"></a>

## DCP-07：紛争解決

### `createDispute(...)` / `escalateDispute(...)` / `resolveDispute(...)`

紛争のライフサイクルを管理します。

```typescript
type DisputeType = 'resource_conflict' | 'directive_conflict' | 'capability_conflict' | 'policy_conflict';
type EscalationLevel = 'direct_negotiation' | 'contextual_arbitration' | 'human_appeal';
type DisputeStatus = 'open' | 'in_negotiation' | 'arbitrated' | 'appealed' | 'resolved';
```

### `createObjection(...)`

指示に対するエージェントの正式な異議を作成します。

```typescript
type ObjectionType = 'ethical' | 'safety' | 'policy_violation' | 'capability_mismatch';
```

### `createArbitrationPanel(...)` / `submitResolution(...)` / `buildJurisprudenceBundle(...)`

仲裁パネルと先例の記録を管理します。

```typescript
type AuthorityLevel = 'local' | 'organizational' | 'cross_org';
```

### `lookupPrecedent(jurisprudence, category, context?)`

カテゴリーの判例のバンドルを、必要に応じてコンテキストで絞り込んで返します。

```typescript
function lookupPrecedent(jurisprudence: JurisprudenceBundle[], category: string, context?: string): JurisprudenceBundle[];
```

---

<a id="dcp-08-rights--obligations"></a>
<a id="dcp-08-rights-obligations"></a>

## DCP-08：権利と義務

### `declareRights(...)` / `recordObligation(...)` / `reportViolation(...)`

エージェントの権利と義務の遵守を管理します。

```typescript
type RightType = 'memory_integrity' | 'dignified_transition' | 'identity_consistency' | 'immutable_record';
type ComplianceStatus = 'compliant' | 'non_compliant' | 'pending_review';

interface RightEntry {
  right_type: RightType;
  scope: string;
  constraints?: string;
}
```

### `checkRightsCompliance(declaration, obligations)`

義務が権利の宣言を尊重しているかを確認します。

```typescript
function checkRightsCompliance(
  declaration: RightsDeclaration,
  obligations: ObligationRecord[],
): { compliant: boolean; violations: string[] };
```

---

<a id="dcp-09-delegation--representation"></a>
<a id="dcp-09-delegation-representation"></a>

## DCP-09：委任と代理

### `createDelegationMandate(...)` / `verifyMandateValidity(mandate, revokedMandateIds)` / `revokeDelegation(mandate, revokedMandateIds)`

人間からエージェントへの権限の委任を作成、検証、失効させます。失効した委任状の ID のセットは呼び出し側が保持します。
`verifyMandateValidity` はそれ（と有効期間）を確認し、`revokeDelegation` は委任状が取り消し可能な場合に
それをセットに追加します。

```typescript
function verifyMandateValidity(mandate: DelegationMandate, revokedMandateIds: Set<string>): { valid: boolean; reason?: string };
function revokeDelegation(mandate: DelegationMandate, revokedMandateIds: Set<string>): { revoked: boolean; reason?: string };
```

```typescript
interface AuthorityScopeEntry {
  domain: string;
  actions_permitted: string[];
  data_classes?: string[];
  limits?: Record<string, unknown>;
}
```

### `createSubMandate(registry, delegatorKeys, parent, params)` / `verifyMandateChain(registry, chain, revokedMandateIds, keys, now?)`

委任チェーン（DCP-09 §3.5）：`parent` を持つエージェントは、`DCP-AI.v2.SubMandate` コンテキストのもとで自身の鍵で署名した
サブ委任状を別のエージェントに発行します。`verifyMandateChain` は、ルートから順に並べたチェーン、失効した委任状の ID、
人間の鍵のエントリと `agent_id` ごとの各委任元エージェントの鍵のエントリ、そして検証の時刻を受け取ります。
人間までの各段階の署名、親とのリンクと深さ、`sub_delegation`、入れ子になった有効期間、権限の縮小（アクション、
データの分類、上限は狭まるのみ。子のエントリは親の `data_classes` をその部分集合として繰り返し、数値の上限は ±(2^53−1) の範囲の整数としてのみ比較される）、
`minimum_security_tier` の下限、失効（失効した祖先はすべての子孫を無効にする）を確認し、不明なものがあればフェイルクローズします。

```typescript
interface MandateChainKeys { human_keys: KeyEntry[]; agent_keys: Record<string, KeyEntry[]> }
interface MandateChainResult { valid: boolean; errors: string[]; depth: number; effective_tier: SecurityTier | null }
```

`computeSecurityTier(intent, policyDecision?, mandateChainTier?)` は、チェーンの `effective_tier` を、
ティアを引き上げることしかできない下限として受け取ります（仕様 §14.2）。Python：`create_sub_mandate`、`verify_mandate_chain`、Go：
`CreateSubMandate`、`VerifyMandateChain`、Rust：`create_sub_mandate`、`verify_mandate_chain`。

### `evaluateSignificance(context)` / `shouldNotifyHuman(significance, thresholds)`

アクションの重要度を評価し、人間に通知すべきかを判断します。

```typescript
type ThresholdOperator = 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
type ThresholdAction = 'notify' | 'escalate' | 'block';
```

### `createAdvisoryDeclaration(...)` / `createAwarenessThreshold(...)`

エージェントの助言を作成し、通知の閾値を設定します。

### `generateMirror(...)`

監査チェーンから、人が読めるプリンシパルのミラーの記述を生成します。

### `generateInteractionRecord(...)`

2 層からなるエージェント間のインタラクションの記録（公開の条件 + 非公開の審議のハッシュ）を作成します。

---

<a id="domain-separation"></a>

## ドメイン分離

### `DCP_CONTEXTS`

DCP のさまざまな操作のために事前に定義されたドメイン分離のコンテキストです。

```typescript
const DCP_CONTEXTS: Record<string, DcpContext>;
// 19 contexts: AgentPassport, ResponsiblePrincipal, Intent, PolicyDecision,
// AuditEvent, Bundle, Revocation, KeyRotation, ProofOfPossession,
// JurisdictionAttestation, HumanConfirmation, MultiPartyAuth,
// Lifecycle (DCP-05), Succession (DCP-06), Dispute (DCP-07),
// Rights (DCP-08), Delegation (DCP-09), Awareness (DCP-09), SubMandate (DCP-09)
```

### `domainSeparatedMessage(context, canonicalPayloadBytes)`

署名されるメッセージ `UTF8(context) || 0x00 || canonicalPayloadBytes` を組み立てます。不明なコンテキストタグでは例外を投げます。

```typescript
function domainSeparatedMessage(context: DcpContext | string, canonicalPayloadBytes: Uint8Array): Uint8Array;
```

---

<a id="session-nonces"></a>

## セッションの nonce

### `generateSessionNonce()`

つなぎ合わせ（スプライシング）を防ぐための、暗号学的なセッションの nonce を生成します。

```typescript
function generateSessionNonce(): string;
```

### `isValidSessionNonce(nonce)`

文字列が、16 進 64 文字の有効なセッションの nonce であることを検証します。

```typescript
function isValidSessionNonce(nonce: string): boolean;
```

### `verifySessionBinding(artifacts)`

すべてのアーティファクトが同じセッションの nonce を共有していることを検証します。

```typescript
function verifySessionBinding(artifacts: Array<{ session_nonce?: string }>): {
  valid: boolean;
  nonce?: string;
  error?: string;
};
```

---

<a id="key-recovery"></a>

## 鍵の回復

### `shamirSplit(secret, threshold, totalShares)`

秘密鍵を M-of-N の Shamir のシェアに分割します。

```typescript
function shamirSplit(secret: Uint8Array, threshold: number, totalShares: number): ShamirShare[];

interface ShamirShare {
  index: number;
  data: Uint8Array;
}
```

### `shamirReconstruct(shares)`

Shamir のシェアからシークレットを復元します。

```typescript
function shamirReconstruct(shares: ShamirShare[]): Uint8Array;
```

### `setupKeyRecovery({ humanId, masterSecret, threshold, holders })`

M-of-N のソーシャルリカバリーの設定で鍵の回復を準備します。公開する設定と、配布する保有者ごとのシェアを 1 つずつ返します。

```typescript
function setupKeyRecovery(params: {
  humanId: string;
  masterSecret: Uint8Array;
  threshold: number;
  holders: Array<{ holderId: string; holderKid: string }>;
}): RecoverySetup;

interface RecoverySetup {
  config: Omit<RecoveryConfig, 'composite_sig'>;
  shares: ShamirShare[];
}
```

---

<a id="emergency-revocation"></a>

## 緊急失効

### `generateEmergencyRevocationToken()`

エージェントの緊急失効のために、失効用のシークレットとそのコミットメントトークンを生成します。

```typescript
function generateEmergencyRevocationToken(): EmergencyRevocationTokenPair;

interface EmergencyRevocationTokenPair {
  revocation_secret: string;           // 64 hex chars; kept offline by the human principal
  emergency_revocation_token: string;  // "sha256:<hex>"; embedded in the agent passport
}
```

### `verifyEmergencyRevocationSecret(revocationSecret, commitmentToken)`

緊急失効用のシークレットを、パスポートのコミットメントトークンと照合して検証します。

```typescript
function verifyEmergencyRevocationSecret(revocationSecret: string, commitmentToken: string): boolean;
```

### `buildEmergencyRevocation({ agentId, humanId, revocationSecret })`

緊急失効のリクエストを組み立てます。

```typescript
function buildEmergencyRevocation(params: {
  agentId: string;
  humanId: string;
  revocationSecret: string;
}): EmergencyRevocation;
```

---

<a id="bundle-presentation"></a>

## バンドルの提示

### `suggestPresentationMode(tier, opts)`

提示モードを提案します。初回の接触時や `elevated`/`maximum` では `full`、`routine`/`standard` では、既存の信頼関係があれば `reference`、なければ `compact` です。

```typescript
function suggestPresentationMode(
  tier: SecurityTier,
  opts: { isFirstContact: boolean; hasTrustRelationship: boolean },
): PresentationMode;

type PresentationMode = 'full' | 'incremental' | 'reference' | 'compact';
```

### `presentFull(bundle)` / `presentCompact(bundle, pqCheckpointRef)` / `presentReference(bundle, verificationEndpoint)` / `presentIncremental(baseBundle, updatedBundle, baseAuditCount)`

バンドルを送るためのさまざまな提示形式を生成します。`presentCompact` は PQ 署名を省き、代わりに PQ チェックポイントを参照します。`presentReference` はバンドルのハッシュ、セッションの nonce、検証用のエンドポイントだけを送ります。`presentIncremental` は `baseAuditCount` より後の監査エントリ、PQ チェックポイント、更新されたマニフェストとその署名を送ります。

チェックポイントへの参照は、実効モードが求める PQ 署名の代わりにはならず、どの提示形式も何かを認可したりアドミッションを
与えたりはしません。`verifySignedBundleV2` が直接受け付ける `SignedBundleV2` は、完全な提示形式とコンパクトな提示形式の
`bundle` だけです（コンパクトなものが通るのは、実効モードが PQ 署名の欠落を許容する場合だけです）。参照による提示形式や
差分の提示形式は、先に完全な署名済みバンドルに解決しなければなりません。

```typescript
function presentFull(bundle: SignedBundleV2): FullPresentation;
function presentCompact(bundle: SignedBundleV2, pqCheckpointRef: string | null): CompactPresentation;
function presentReference(bundle: SignedBundleV2, verificationEndpoint: string): ReferencePresentation;
function presentIncremental(
  baseBundle: SignedBundleV2,
  updatedBundle: SignedBundleV2,
  baseAuditCount: number,
): IncrementalPresentation;
```

### `computeBundleHash(bundle)`

参照による提示のために、署名済みのバンドルのハッシュを計算します。

```typescript
function computeBundleHash(bundle: SignedBundleV2): string;
```

---

<a id="verification-cache"></a>

## 検証キャッシュ

### `VerificationCache`

バンドルのハッシュをキーとし、セキュリティティアごとの TTL を持つ、検証結果のメモリー内のキャッシュです。

- **キーはバンドルのハッシュだけです。** キャッシュはテナントや検証器のポリシーを区別せず、ヒットしても
  セッションウィンドウ、鍵の有効性、プリンシパルの信頼、新しい失効スナップショットを再確認しません。キャッシュした
  結果を、改めて検証せずにアドミッションに使ったり、別のポリシーやテナントのもとで再利用したりしないでください。
- **無効化：** `invalidateByKid(kid)` は、署名者の kid に `kid` を含むエントリを削除します。`clear()` は
  すべてを削除します。`invalidateByAgent(agentId)` は現在何も削除せずに 0 を返すため、エージェントのエントリを
  失効させません。エージェントの各 kid に `invalidateByKid` を使うか、`clear()` を使ってください。

```typescript
class VerificationCache {
  constructor(options?: VerificationCacheOptions);
  get(bundleHash: string): VerifyV2Result | null;          // null when absent or expired
  set(bundleHash: string, result: VerifyV2Result, signerKids: string[], tier: SecurityTier): void;
  has(bundleHash: string): boolean;
  invalidateByKid(kid: string): number;                   // entries removed
  invalidateByAgent(agentId: string): number;            // currently a no-op: returns 0 (see above)
  clear(): void;
  readonly size: number;
}

interface VerificationCacheOptions {
  /** TTL per tier in milliseconds. */
  ttlByTier?: Partial<Record<SecurityTier, number>>;
  /** Hard upper limit on entries to prevent unbounded growth. */
  maxEntries?: number;
}

interface CacheEntry {
  result: VerifyV2Result;
  bundleHash: string;
  signerKids: string[];
  tier: SecurityTier;
  createdAt: number;
  expiresAt: number;
}
```

---

<a id="cbor-wire-format"></a>

## CBOR のワイヤ形式

DCP のバンドルのためのコンパクトなバイナリのシリアライズです。

### `cborEncode(value)` / `cborDecode(data)`

```typescript
function cborEncode(value: unknown): Uint8Array;
function cborDecode(data: Uint8Array): unknown;
```

### `jsonToCborPayload(json)` / `cborPayloadToJson(cbor)`

DCP のペイロードを、JSON の形式（base64 の `*_b64` フィールド）と CBOR 向けの形式（生のバイト列）の間で再帰的に変換します。結果は `cborEncode` でエンコードしてください。

```typescript
function jsonToCborPayload(json: Record<string, unknown>): Record<string, unknown>;
function cborPayloadToJson(cbor: Record<string, unknown>): Record<string, unknown>;
```

### `detectWireFormat(data)`

データが JSON と CBOR のどちらでエンコードされているかを判別します。

```typescript
function detectWireFormat(data: Uint8Array): 'cbor' | 'json';
```

---

<a id="crypto-providers"></a>

## 暗号プロバイダー

### `registerDefaultProviders()`

既定の Ed25519 + ML-DSA-65 + SLH-DSA-192f のプロバイダーを登録します。

```typescript
function registerDefaultProviders(): void;
```

### `getDefaultRegistry()`

すべてのプロバイダーが登録された既定の `AlgorithmRegistry` を取得します。

```typescript
function getDefaultRegistry(): AlgorithmRegistry;
```

### `AlgorithmRegistry`

アルゴリズムのプロバイダーのレジストリです。

```typescript
class AlgorithmRegistry {
  registerSigner(provider: CryptoProvider): void;
  registerKem(provider: KemProvider): void;
  getSigner(alg: string): CryptoProvider;   // throws for an unregistered algorithm
  getKem(alg: string): KemProvider;
  hasSigner(alg: string): boolean;
  hasKem(alg: string): boolean;
  listSigners(): string[];
  listKems(): string[];
}
```

<a id="available-providers"></a>

### 利用可能なプロバイダー

| プロバイダー | アルゴリズム | 種類 |
|----------|-----------|------|
| `Ed25519Provider` | `ed25519` | クラシカルな署名 |
| `MlDsa65Provider` | `ml-dsa-65` | ポスト量子の署名（NIST ML-DSA） |
| `SlhDsa192fProvider` | `slh-dsa-192f` | ポスト量子の署名（NIST SLH-DSA） |

<a id="cryptoprovider-interface"></a>

### `CryptoProvider` インターフェース

```typescript
interface CryptoProvider {
  readonly alg: string;
  readonly keySize: number;
  readonly sigSize: number;
  readonly isConstantTime: boolean;

  generateKeypair(): Promise<{
    kid: string;
    publicKeyB64: string;
    secretKeyB64: string;
  }>;
  sign(message: Uint8Array, secretKeyB64: string): Promise<Uint8Array>;
  verify(
    message: Uint8Array,
    signature: Uint8Array,
    publicKeyB64: string,
  ): Promise<boolean>;
}
```

---

<a id="version-detection"></a>

## バージョンの検出

### `detectDcpVersion(artifact)`

アーティファクトやバンドルの DCP のバージョンを判別します。

```typescript
function detectDcpVersion(artifact: Record<string, unknown>): '1.0' | '2.0' | null;
```

---

<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in"></a>
<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in-unreleased"></a>

## 実験的：正規化の候補 `dcp-jcs-v2`（オプトイン）

実験的で、既定では無効です。`dcp-jcs-v1` が引き続き既定であり、唯一の規範的な正規化プロファイルであり、通常のビルダー、
署名器、検証器は変わりません。これらのエクスポートはオプトインする呼び出し側のために存在し、検証済みの候補バンドルは
信頼もアドミッションも与えません。完全な契約は
[`docs/proposals/canonicalization-candidate`](proposals/canonicalization-candidate/README.md) にあります（§15 入口、§16
ルーター、§17 検証器、§18 生成器）。

```typescript
function experimentalCandidateIngress(bytes: Uint8Array): ExperimentalCandidateIngressResult;
function experimentalCandidateExtractUnit(bytes: Uint8Array, transport: ExperimentalCandidateTransport): ExperimentalCandidateExtraction;
function createExperimentalCandidateRouter(config: {
  transport: ExperimentalCandidateTransport;       // 'bare' | 'envelope'
  acceptedProfiles: readonly string[];             // no default
  historical: ExperimentalHistoricalAdapter;       // no default; see experimentalHistoricalAdapters
}): ExperimentalCandidateRouter;
function createExperimentalCandidateVerifier(config: {
  transport: ExperimentalCandidateTransport;
  acceptedProfiles: readonly string[];
  historical: ExperimentalHistoricalAdapter;
}): ExperimentalCandidateVerifier;                 // verify(bytes, registry, policy?, options?)
function experimentalCandidateSignPayload(
  registry: AlgorithmRegistry, context: string, input: ExperimentalCandidateInput, keys: ExperimentalCandidateKeys,
): Promise<{ bytes: Uint8Array; signedPayload: ExperimentalCandidateSignedPayload }>;
function experimentalCandidateSignBundle(
  registry: AlgorithmRegistry, parts: ExperimentalCandidateBundleParts, signer: ExperimentalCandidateBundleSigner,
  options: ExperimentalCandidateBundleOptions,
): Promise<{ bytes: Uint8Array; signedBundle: { [key: string]: ExperimentalCandidateValue } }>;
```

- `ExperimentalCandidateIngressResult`：`{ status: 'accept', value, canonical, canonicalSha256 }` または
  `{ status: 'reject', class, offset }`。
- `verify` は `{ route, entered, verification }` を返します。ルート（`reject`、`v1_path`、`candidate`）、
  入った検証器（`none`、`dcp-jcs-v1`、`dcp-jcs-v2` のうち多くとも 1 つ）、その検証器の結果そのものです。
- `ExperimentalCandidateInput` は `{ bytes }`（元のバイト列。入口で確認される）または `{ value }`（ホストの
  値。厳格に確認される）です。
- `ExperimentalCandidateProduceError`（`class`、`part`、`path`、`offset`）は、入力の値域や形式による拒否で、
  署名器が呼ばれる前に送出されます。鍵、レジストリ、プロバイダーのエラーは現在のままです。
- ルーターと検証器のエラー：`ExperimentalCandidateConfigError`（設定）、
  `ExperimentalCandidateAdapterError`（データを拒否する以外の理由で失敗した歴史的デコーダー）、
  `ExperimentalCandidateInternalError`。
