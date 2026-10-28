<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · **日本語** · [Português](README.pt-BR.md)</sub>

<a id="dcp-aisdk--typescript-sdk-for-dcp-ai-v20"></a>
<a id="dcp-aisdk-typescript-sdk-for-dcp-ai-v20"></a>

# @dcp-ai/sdk — DCP-AI v2.0 用 TypeScript SDK

> [英語版](README.md)の参考訳です（26/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

Digital Citizenship Protocol（DCP-AI）の公式 TypeScript SDK です。ポスト量子のハイブリッド暗号（Ed25519 + ML-DSA-65）、複合署名、適応型セキュリティティア、エージェント間（A2A）通信、組み込みのオブザーバビリティ、本番向けの堅牢化を備え、Citizenship Bundle の作成、署名、検証を行えます。

<a id="installation"></a>

## インストール

**npm 公開済み（2026 年 10 月 26 日）。** この日、`@dcp-ai/sdk` 2.2.0 が `latest` として公開されました。[SECURITY.md](../../SECURITY.md) に記載された検証器の修正、プリンシパルの信頼と `strict-v1`、委任チェーン、A2A 受信ウィンドウ、実験的な `dcp-jcs-v2` API を含んでいました。候補は明示的な選択が必要な非規範的機能のままで、既定は `dcp-jcs-v1` でした。以下の例は 2.2.0 以降で利用できる API を使います。

**`@dcp-ai/sdk` 2.2.1。** このバージョンは、[VERIFICATION.md の V2-11](../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) の二次の SHA3-256 フィールドが存在する場合、それらも検証します：`audit_merkle_root_secondary`、各 `prev_hash_secondary`、各 `intent_hash_secondary`。存在しないフィールドは要求されないため、検証済みのバンドルが完全な二次チェーンを持たないこともあります。存在するフィールドが `null`、文字列でない、または不整合の場合は拒否されます。API、結果のフィールド、`dcp-jcs-v1`、`hash_alg` の扱いは変わりません。2.2.0 はこれらのフィールドを確認しません。以下のインストールコマンドはこのバージョンを指定しています。レジストリでの提供状況は[公開済みバージョン](../../docs/README.md#published-versions)を参照してください。

```bash
npm install @dcp-ai/sdk@^2.2.1
```

全パッケージのバージョンは [npm リリース一覧](../../docs/NPM_RELEASES.md)を参照してください。

チェックアウトしたソースで開発する場合は、ローカルのパッケージをビルドしてインストールします。

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai/sdks/typescript && npm install && npm run build
cd /path/to/your-project && npm install /path/to/dcp-ai/sdks/typescript
```

<a id="quick-start-v1"></a>

## クイックスタート（V1）

Ed25519 で署名した V1 バンドルです。RPR はプリンシパルの鍵で、パスポートはエージェントの鍵で署名され、
いずれも `signature` フィールドを除いたオブジェクトの正規 JSON が対象です。`createAuditEntry` は
`intent_hash` と `prev_hash` のチェーンを計算します。`verifySignedBundle` が確認するのはバンドルの署名、ハッシュ、
チェーンであり、これらの内部の署名ではありません。内部の署名は以下のように自分で確認してください。

```typescript
import { BundleBuilder, generateKeypair, signBundle, signObject, verifyObject, verifySignedBundle } from '@dcp-ai/sdk';
import type { AgentPassport, ResponsiblePrincipalRecord } from '@dcp-ai/sdk';

const now = new Date().toISOString();
const principalKeys = generateKeypair();
const agentKeys = generateKeypair();

// Each artifact is signed over the object without its `signature` field.
const rprBody: Omit<ResponsiblePrincipalRecord, 'signature'> = {
  dcp_version: '1.0', human_id: 'human:example-001', legal_name: 'Example Principal',
  entity_type: 'natural_person', jurisdiction: 'ES', liability_mode: 'owner_responsible',
  override_rights: true, issued_at: now, expires_at: null, contact: null,
};
const rpr: ResponsiblePrincipalRecord = { ...rprBody, signature: signObject(rprBody, principalKeys.secretKeyB64) };

const passportBody: Omit<AgentPassport, 'signature'> = {
  dcp_version: '1.0', agent_id: 'agent:example-001', public_key: agentKeys.publicKeyB64,
  principal_binding_reference: rpr.human_id, capabilities: ['browse', 'api_call'],
  risk_tier: 'low', created_at: now, status: 'active',
};
const passport: AgentPassport = { ...passportBody, signature: signObject(passportBody, agentKeys.secretKeyB64) };

const bundle = new BundleBuilder()
  .responsiblePrincipalRecord(rpr)
  .agentPassport(passport)
  .intent({
    dcp_version: '1.0', intent_id: 'intent:example-001', agent_id: passport.agent_id, human_id: rpr.human_id,
    timestamp: now, action_type: 'api_call', target: { channel: 'api', domain: 'api.example.com' },
    data_classes: ['none'], estimated_impact: 'low', requires_consent: false,
  })
  .policyDecision({
    dcp_version: '1.0', intent_id: 'intent:example-001', decision: 'approve', risk_score: 0.05,
    reasons: ['low-impact call'], required_confirmation: null,
  })
  .createAuditEntry({
    dcp_version: '1.0', audit_id: 'audit:example-001', timestamp: now, agent_id: passport.agent_id,
    human_id: rpr.human_id, intent_id: 'intent:example-001', policy_decision: 'approved',
    outcome: 'call_completed', evidence: { tool: 'http', result_ref: null },
  })
  .build();

const signed = signBundle(bundle, { secretKeyB64: principalKeys.secretKeyB64, signerType: 'human', signerId: rpr.human_id });
console.log(verifySignedBundle(signed, principalKeys.publicKeyB64)); // { verified: true }

// The inner signatures, over the same objects without `signature`
console.log(verifyObject(rprBody, rpr.signature, principalKeys.publicKeyB64)); // true
console.log(verifyObject(passportBody, passport.signature, agentKeys.publicKeyB64)); // true
```

<a id="quick-start-v2"></a>

## クイックスタート（V2）

ハイブリッド署名（Ed25519 + ML-DSA-65）の V2 バンドルです。各アーティファクトは `SignedPayload`
（`{ payload, payload_hash, composite_sig }`）で、そのドメイン分離コンテキストのもとで署名されます。プリンシパルは
RPR とマニフェストに、エージェントはパスポート、意図、ポリシー判断に署名します。

```typescript
import {
  AlgorithmRegistry, BundleBuilderV2, DCP_CONTEXTS, Ed25519Provider, MlDsa65Provider, compositeSign,
  generateSessionNonce, preparePayload, sha256Hex, canonicalizeV2, signBundleV2, verifySignedBundleV2,
} from '@dcp-ai/sdk';
import type {
  AgentPassportV2, AuditEventV2, CompositeKeyPair, DcpContext, IntentV2, KeyEntry, PolicyDecisionV2,
  ResponsiblePrincipalRecordV2, SignedPayload,
} from '@dcp-ai/sdk';

const registry = new AlgorithmRegistry();
const ed25519 = new Ed25519Provider();
const mlDsa65 = new MlDsa65Provider();
registry.registerSigner(ed25519);
registry.registerSigner(mlDsa65);

async function hybridKeys(): Promise<CompositeKeyPair> {
  const c = await ed25519.generateKeypair();
  const p = await mlDsa65.generateKeypair();
  return {
    classical: { kid: c.kid, alg: 'ed25519', secretKeyB64: c.secretKeyB64, publicKeyB64: c.publicKeyB64 },
    pq: { kid: p.kid, alg: 'ml-dsa-65', secretKeyB64: p.secretKeyB64, publicKeyB64: p.publicKeyB64 },
  };
}
const keyEntries = (keys: CompositeKeyPair): KeyEntry[] => [keys.classical, keys.pq].map((k) => ({
  kid: k.kid, alg: k.alg, public_key_b64: k.publicKeyB64, created_at: '2026-01-01T00:00:00Z', expires_at: null, status: 'active',
}));
const sha256Of = (value: unknown) => `sha256:${sha256Hex(new TextEncoder().encode(canonicalizeV2(value)))}`;
async function signed<T>(payload: T, context: DcpContext, keys: CompositeKeyPair): Promise<SignedPayload<T>> {
  const { canonicalBytes, payloadHash } = preparePayload(payload);
  return { payload, payload_hash: payloadHash, composite_sig: await compositeSign(registry, context, canonicalBytes, keys) };
}

const principal = await hybridKeys();
const agent = await hybridKeys();
const nonce = generateSessionNonce();
const now = new Date().toISOString();

const rpr: ResponsiblePrincipalRecordV2 = {
  dcp_version: '2.0', human_id: 'human:example-001', session_nonce: nonce, legal_name: 'Example Principal',
  entity_type: 'natural_person', jurisdiction: 'ES', liability_mode: 'owner_responsible', override_rights: true,
  issued_at: now, expires_at: null, contact: null, binding_keys: keyEntries(principal),
};
const passport: AgentPassportV2 = {
  dcp_version: '2.0', agent_id: 'agent:example-001', session_nonce: nonce, keys: keyEntries(agent),
  principal_binding_reference: rpr.human_id, capabilities: ['browse', 'api_call'], risk_tier: 'low',
  created_at: now, status: 'active',
};
const intent: IntentV2 = {
  dcp_version: '2.0', intent_id: 'intent:example-001', session_nonce: nonce, agent_id: passport.agent_id,
  human_id: rpr.human_id, timestamp: now, action_type: 'api_call', target: { channel: 'api', domain: 'api.example.com' },
  data_classes: ['none'], estimated_impact: 'low', requires_consent: false,
};
const policy: PolicyDecisionV2 = {
  dcp_version: '2.0', intent_id: intent.intent_id, session_nonce: nonce, decision: 'approve', risk_score: 50,
  reasons: ['low-impact call'], required_confirmation: null, applied_policy_hash: sha256Of({ policy: 'default' }), timestamp: now,
};
const audit: AuditEventV2 = {
  dcp_version: '2.0', audit_id: 'audit:example-001', session_nonce: nonce, prev_hash: 'GENESIS', hash_alg: 'sha256',
  timestamp: now, agent_id: passport.agent_id, human_id: rpr.human_id, intent_id: intent.intent_id,
  intent_hash: sha256Of(intent), policy_decision: 'approved', outcome: 'call_completed',
  evidence: { tool: 'http', result_ref: null, evidence_hash: null }, pq_checkpoint_ref: null,
};

const bundle = new BundleBuilderV2(nonce)
  .responsiblePrincipalRecord(await signed(rpr, DCP_CONTEXTS.ResponsiblePrincipal, principal))
  .agentPassport(await signed(passport, DCP_CONTEXTS.AgentPassport, agent))
  .intent(await signed(intent, DCP_CONTEXTS.Intent, agent))
  .policyDecision(await signed(policy, DCP_CONTEXTS.PolicyDecision, agent))
  .addAuditEntry(audit)
  .build();

const signedBundle = await signBundleV2(bundle, { registry, signerType: 'human', signerId: rpr.human_id, keys: principal });
const result = await verifySignedBundleV2(signedBundle, registry);
console.log(result.verified, result.errors); // true []
```

<a id="api-reference"></a>

## API リファレンス

<a id="core-crypto-v1"></a>

### コア暗号（V1）

| 関数 | 説明 |
|----------|-------------|
| `generateKeypair()` | Ed25519 の鍵ペア（`publicKeyB64`、`secretKeyB64`）を生成する |
| `signObject(obj, secretKeyB64)` | オブジェクトに署名し、base64 の署名を返す |
| `verifyObject(obj, signatureB64, publicKeyB64)` | 公開鍵で署名を検証する |
| `canonicalize(obj)` | 決定的（正規）な JSON シリアライズ |
| `publicKeyFromSecret(secretKeyB64)` | 秘密鍵から公開鍵を導出する |

<a id="crypto-providers-v2"></a>

### 暗号プロバイダー（V2）

| エクスポート | 説明 |
|--------|-------------|
| `Ed25519Provider` | クラシカルな Ed25519 署名プロバイダー |
| `MlDsa65Provider` | ポスト量子 ML-DSA-65 署名プロバイダー |
| `SlhDsa192fProvider` | ポスト量子 SLH-DSA-192f 署名プロバイダー |
| `AlgorithmRegistry` | 利用可能な暗号アルゴリズムのプロバイダーを管理するレジストリ |
| `getDefaultRegistry()` | シングルトンのアルゴリズムレジストリを返す |
| `registerDefaultProviders()` | Ed25519、ML-DSA-65、SLH-DSA-192f のプロバイダーを登録する |
| `deriveKid(alg, publicKeyBytes)` | 公開鍵から鍵識別子を導出する |

<a id="composite-signatures-v2"></a>

### 複合署名（V2）

| 関数 | 説明 |
|----------|-------------|
| `compositeSign(registry, context, canonicalPayloadBytes, keys)` | クラシカル + PQ のアルゴリズムで複合署名を作成する |
| `compositeVerify(registry, context, canonicalPayloadBytes, compositeSig, classicalPubkeyB64, pqPubkeyB64?, strategy?)` | 複合署名を検証する |
| `classicalOnlySign(registry, context, canonicalPayloadBytes, key)` | クラシカルなアルゴリズムのみで署名する（フォールバックモード） |

<a id="security-tiers-v2"></a>

### セキュリティティア（V2）

| 関数 | 説明 |
|----------|-------------|
| `computeSecurityTier(intent, policyDecision?, mandateChainTier?)` | 意図とポリシー判断の `risk_score`（仕様 §14.2）から `SecurityTier`（routine、standard、elevated、maximum）を計算する。検証済みの委任チェーンの `effective_tier` はティアを上げることしかできない。未知の値はフェイルクローズで `elevated` になる |
| `maxTier(a, b)` | 2 つのセキュリティティアのうち高いほうを返す |
| `tierToVerificationMode(tier)` | ティアを必要な検証モードに対応付ける |
| `tierToCheckpointInterval(tier)` | ティアを PQ チェックポイントの間隔に対応付ける |

<a id="bundle-building"></a>

### バンドルの構築

| エクスポート | バージョン | 説明 |
|--------|---------|-------------|
| `BundleBuilder` | V1 | V1 の Citizenship Bundle 用のフルエントなビルダー |
| `BundleBuilderV2` | V2 | セキュリティティアと二重ハッシュを備えた V2 バンドル用のフルエントなビルダー |
| `signBundle(bundle, options)` | V1 | V1 バンドルに Ed25519 で署名する |
| `signBundleV2(bundle, options)` | V2 | V2 バンドルに複合署名で署名する |
| `signBundleV2ClassicalOnly(bundle, options)` | V2 | V2 バンドルにクラシカルな署名のみで署名する |
| `verifySignedBundle(signedBundle, publicKeyB64)` | V1 | 署名済みの V1 バンドルを検証する |
| `verifySignedBundleV2(signedBundle, registry, policy?)` | V2 | 署名済みの V2 バンドル（複合またはクラシカル）を、ポリシーのモードとセキュリティティアのモードのうち厳しいほうで検証し、`resolved_tier` を報告する |

<a id="bundle-optimization-v2"></a>

### バンドルの最適化（V2）

| エクスポート | 説明 |
|--------|-------------|
| `suggestPresentationMode(tier, opts)` | セキュリティティアと、初回の接触か既存の信頼関係かに応じて提示モードを推奨する |
| `presentFull(bundle)` | バンドルの完全な提示（省略なし） |
| `presentCompact(bundle, pqCheckpointRef)` | コンパクトな提示：PQ 署名を省き、代わりに最も近い PQ チェックポイントを参照する |
| `presentReference(bundle, verificationEndpoint)` | 参照のみの提示：バンドルのハッシュ、セッションの nonce、バンドル全体を検証または取得するためのエンドポイント |
| `presentIncremental(baseBundle, updatedBundle, baseAuditCount)` | 検証済みのベースバンドルに対する増分の提示：新しい監査エントリ、PQ チェックポイント、更新されたマニフェストと署名 |
| `VerificationCache` | 検証結果をバンドルのハッシュだけをキーにキャッシュする。テナントやポリシーを区別せず、ヒット時に信頼、失効、セッションを再確認しないため、アドミッションや別のコンテキストでは改めて検証すること。`invalidateByAgent` は現在何も削除しないので、`invalidateByKid` か `clear()` を使う（[詳細](../../docs/API_REFERENCE.md#verificationcache)） |

<a id="pq-checkpoints-v2"></a>

### PQ チェックポイント（V2）

| エクスポート | 説明 |
|--------|-------------|
| `PQCheckpointManager` | ポスト量子チェックポイントの定期的な作成を管理する |
| `createPQCheckpoint(registry, events, sessionNonce, keys)` | 監査エントリに対する PQ 署名付きチェックポイントを作成する |
| `auditEventsMerkleRoot(events)` | 監査エントリからマークルルートを計算する |

<a id="dual-hash-v2"></a>

### 二重ハッシュ（V2）

| 関数 | 説明 |
|----------|-------------|
| `sha256Hex(data)` | SHA-256 ハッシュ（16 進文字列） |
| `sha3_256Hex(data)` | SHA3-256 ハッシュ（16 進文字列） |
| `dualHash(data)` | 量子耐性のある二重ハッシュとして `{ sha256, sha3_256 }` を返す |
| `dualMerkleRoot(leaves)` | 二重ハッシュのリーフを使ってマークルルートを計算する |

<a id="a2a-protocol-dcp-04"></a>

### A2A プロトコル（DCP-04）

| 関数 | 説明 |
|----------|-------------|
| `createAgentDirectory(organization, agents)` | メモリー内のエージェントディレクトリを作成する |
| `findAgentByCapability(directory, requiredCapabilities)` | ディレクトリ内で機能によってエージェントを探す |
| `findAgentById(directory, agentId)` | ID でエージェントを探す |
| `createHello(initiatorBundle, kemPublicKeyB64, requestedCapabilities, securityTier)` | A2A ハンドシェイクの Hello メッセージを作成する |
| `createWelcome(responderBundle, kemPublicKeyB64, kemCiphertextB64, resolvedTier)` | A2A の Welcome 応答メッセージを作成する |
| `deriveSessionId(agentIdA, agentIdB, nonceA, nonceB, sessionKey)` | ハンドシェイクの nonce からセッション ID を導出する |
| `createCloseMessage(sessionId, reason, finalSequence, auditSummaryHash)` | セッション終了メッセージを作成する |
| `createSession(sessionId, sessionKey, localAgentId, remoteAgentId, securityTier, rekeyingInterval?)` | 暗号化された A2A セッションを作成する |
| `encryptMessage(session, payload)` | A2A セッション内でメッセージを暗号化する |
| `decryptMessage(session, message)` | A2A セッション内でメッセージを復号する。各シーケンスは 1000 メッセージのウィンドウ内で一度だけ受け付けられる（DCP-04 §8.4） |
| `needsRekeying(session)` | セッションに鍵の更新が必要かを確認する |
| `generateResumeProof(session, lastSeenSequence)` | セッション再開のための証明を生成する |
| `verifyResumeProof(session, lastSeenSequence, proof)` | セッション再開の証明を検証する |

<a id="observability"></a>

### オブザーバビリティ

| エクスポート | 説明 |
|--------|-------------|
| `dcpTelemetry` | シングルトンのテレメトリーインスタンス |
| `dcpTelemetry.init(config)` | サービス名とエクスポーターでテレメトリーを初期化する |
| `dcpTelemetry.startSpan(name)` | 名前付きのトレーススパンを開始する |
| `dcpTelemetry.endSpan(span)` | トレーススパンを終了する |
| `dcpTelemetry.recordSignLatency(ms)` | 署名レイテンシーのメトリクスを記録する |
| `dcpTelemetry.getMetricsSummary()` | 集計したメトリクスの概要を返す |

<a id="production-hardening"></a>

### 本番向けの堅牢化

| エクスポート | 説明 |
|--------|-------------|
| `DcpErrorCode` | 構造化されたエラーコードの列挙型 |
| `DcpProtocolError` | プロトコルレベルの失敗を表す型付きのエラークラス |
| `createDcpError(code, details?)` | 構造化された DCP エラーを作成するファクトリー |
| `isDcpError(error)` | `DcpProtocolError` の型ガード |
| `RateLimiter` | 固定ウィンドウのレートリミッター |
| `AdaptiveRateLimiter` | 負荷に応じて調整されるレートリミッター |
| `CircuitBreaker` | 外部呼び出し用のサーキットブレーカー |
| `withRetry(fn, config?)` | 非同期関数をバックオフ付きで再試行する |

<a id="other-v2"></a>

### その他の V2

| エクスポート | 説明 |
|--------|-------------|
| `generateSessionNonce()` | 暗号学的なセッション nonce を生成する |
| `domainSeparatedMessage(context, canonicalPayloadBytes)` | メッセージの先頭にドメイン区切りを付ける |
| `generateEmergencyRevocationToken()` | 失効用のシークレットと、その `sha256:` トークンのコミットメントを生成する |
| `buildEmergencyRevocation({ agentId, humanId, revocationSecret })` | 失効用のシークレットから緊急失効リクエストを組み立てる |
| `shamirSplit(secret, threshold, totalShares)` | シークレットを `totalShares` 個のシェアに分割する。そのうち任意の `threshold` 個で復元できる |
| `shamirReconstruct(shares)` | 少なくとも `threshold` 個のシェアからシークレットを復元する |
| `generatePiiSalt()` | `pii_salt`（ランダムな 32 バイトの 16 進表現）を生成する。RPR に署名する前に設定し、非公開に保つこと。`blindRpr` はブラインド化されたレコードからこれを除外するが、完全な RPR には残る |
| `blindRpr(rpr)` | RPR の個人情報（`legal_name`、`contact`）をソルト付きのハッシュコミットメントに置き換える。`rpr.pii_salt` がないか不正な形式の場合は例外を投げる |
| `verifyBlindedRpr(fullRpr, blindedRpr)` | ブラインド化された RPR が完全なレコードと一致するかを確認する。`warnings` はソルトなしの旧来のコミットメントを示す |
| `isBlindedRpr(rpr)` | `BlindedResponsiblePrincipalRecordV2` の型ガード |
| `computePiiHash(rpr)` | RPR の個人情報フィールドと `pii_salt` に対するハッシュコミットメントを計算する（`pii_salt` がない場合は、非推奨のソルトなしの値） |
| `CborEncoder` | CBOR エンコーダークラス |
| `CborDecoder` | CBOR デコーダークラス |
| `cborEncode(value)` | 値を CBOR バイト列にエンコードする |
| `cborDecode(data)` | CBOR バイト列を値にデコードする |

<a id="admission-trusted-principals-and-strict-v1"></a>
<a id="admission-trusted-principals-and-strict-v1-unreleased"></a>

### アドミッション：Trusted Principals と strict-v1

検証済みのバンドルは、そこに列挙された鍵で署名されています。それはプリンシパルが誰であるかを証明しません。アドミッションは、プリンシパルの署名が信頼セットに載っているプリンシパルの鍵で行われている場合にのみバンドルを受け入れます。オプションで、オペレーターが固定する `strict-v1` プロファイル（ハイブリッド署名、署名されたオーディエンス、最長 300 秒のセッション、新しい失効スナップショット）も適用できます。

```typescript
// Fragment, not a complete program: trustSetJson and the strict-v1 settings come from operator configuration, signedBundle from the request, snapshot from your revocation source, registry as in the V2 Quick Start.
import { admitSignedBundleV2, createPrincipalTrustStore, resolveStrictV1Profile } from '@dcp-ai/sdk';

const trust = createPrincipalTrustStore(trustSetJson); // AdmissionConfigError on a bad trust set
const profile = resolveStrictV1Profile({ profile: 'strict-v1', verifier_id: 'api.acme.example' });
const result = await admitSignedBundleV2(signedBundle, registry, { profile, trust, revocation: snapshot });
// result.verified, result.principal_trust, result.profile_compliance, result.admitted,
// result.action_authorized (always false), result.errors [{ code, message }]
```

- `verifySignedBundleV2(bundle, registry, policy, { now })` はオプションのクロックを受け取り、`details.signer_keys` を報告します。それらがなければ従来どおりに動作します。
- `evaluateAdmissionV2` は、手元にある検証結果を評価します（暗号処理も I/O も行いません）。`revocationSubjects` は、失効情報の提供元が答えるべき対象を列挙します。
- ガイド：[`docs/ADMISSION.md`](../../docs/ADMISSION.md)。仕様とコード：[`spec/profiles/admission`](../../spec/profiles/admission/README.md)。

<a id="delegation-chains-dcp-09-35"></a>
<a id="delegation-chains-dcp-09-35-unreleased"></a>

### 委任チェーン（DCP-09 §3.5）

人間はルートの委任状でエージェントに委任します。そのエージェントは、自ら署名するサブ委任状によって権限の一部を別のエージェントに渡すことができ、
これを繰り返せます。各段階は受け取ったものを狭めることしかできず、チェーン全体は
オフラインで人間までさかのぼって検証されます。

| 関数 | 説明 |
|----------|-------------|
| `createDelegationMandate(registry, humanKeys, params)` | 人間が署名するルートの委任状（`human_composite_sig`）。`sub_delegation` と `minimum_security_tier` は省略可能 |
| `createSubMandate(registry, delegatorKeys, parent, params)` | 親のエージェントが署名するサブ委任状（`delegator_composite_sig`、`DCP-AI.v2.SubMandate` コンテキスト） |
| `verifyMandateChain(registry, chain, revokedIds, keys, now?)` | ルートから順にチェーンを検証する：人間までの署名、親とのリンクと深さ、`sub_delegation`、入れ子になった有効期間、権限の縮小（アクション、`data_classes`、`limits` は狭まるのみ）、セキュリティティアの下限、失効。`{ valid, errors, depth, effective_tier }` を返す |

```typescript
// Fragment, not a complete program: registry and nonce as in the V2 Quick Start; rootMandate, orchestratorKeys and the key entries come from your delegation setup; intent and policyDecision are the V2 payloads.
import { createSubMandate, verifyMandateChain, computeSecurityTier } from '@dcp-ai/sdk';

const sub = await createSubMandate(registry, orchestratorKeys, rootMandate, {
  mandate_id: 'mandate:sub-1',
  session_nonce: nonce,
  agent_id: 'agent:subagent',
  authority_scope: [{ domain: 'email', actions_permitted: ['read'], data_classes: ['contact_info'], limits: { max_messages_per_day: 10 } }],
  valid_from: '2026-03-01T00:00:00Z',
  valid_until: '2026-06-01T00:00:00Z',
  revocable: true,
});

const result = await verifyMandateChain(registry, [rootMandate, sub], new Set(), {
  human_keys: humanKeyEntries,
  agent_keys: { 'agent:orchestrator': orchestratorKeyEntries },
});
// The chain's tier floor can only raise the tier of an action taken under it.
const tier = computeSecurityTier(intent, policyDecision, result.valid ? result.effective_tier : null);
```

<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in"></a>
<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in-unreleased"></a>

### 実験的：正規化の候補 `dcp-jcs-v2`（オプトイン）

規範ではなく、有効でもありません。`dcp-jcs-v1` が唯一の正規化プロファイルであり続け、既定値、
ビルダー、署名器、検証器はいずれも変わりません。これらの API は、npm SDK 2.2.0 を含め、明示的に選択する呼び出し側のためだけに存在します。検証済みの候補バンドルは、信頼もアドミッションも与えません。設計、ルール、完全な
契約：[`docs/proposals/canonicalization-candidate`](../../docs/proposals/canonicalization-candidate/README.md)
（§15 入口、§16 ルーター、§17 検証器、§18 生成器）。

| エクスポート | 説明 |
|--------|-------------|
| `experimentalCandidateIngress(bytes)` | 1 つの単位の元のバイト列を確認する：`{ status: 'accept', value, canonical, canonicalSha256 }` または `{ status: 'reject', class, offset }` |
| `experimentalCandidateExtractUnit(bytes, transport)` | `bare` または `envelope` のトランスポートから単位を取り出す |
| `createExperimentalCandidateRouter(config)` | バイト列を振り分ける：`reject`、`v1_path`（名前付きの歴史的デコーダーを経由）、`candidate` |
| `createExperimentalCandidateVerifier(config).verify(bytes, registry, policy?, options?)` | 元のバイト列から、多くとも 1 つの検証器で検証する：`dcp-jcs-v1` には現在の検証器、候補には `dcp-jcs-v2` だけを受け入れる現在の検証器 |
| `experimentalHistoricalAdapters` | 計測済みのデコーダー（`bufferUtf8JsonParse`、`textDecoderJsonParse`）。いずれも既定ではない |
| `experimentalCandidateSignPayload(registry, context, input, keys)` | `{ bytes }` または `{ value }` から 1 つのアーティファクトに署名する。プロファイルなし |
| `experimentalCandidateSignBundle(registry, parts, signer, options)` | マニフェストが `dcp-jcs-v2` を指定するバンドルを組み立てて署名する |
| `ExperimentalCandidateProduceError` | 入力の値域や形式による拒否で、署名器が呼ばれる前に送出される（`class`、`part`、`path`、`offset`）。鍵、レジストリ、プロバイダーのエラーは現在のまま |

```typescript
import {
  AlgorithmRegistry, DCP_CONTEXTS, Ed25519Provider, MlDsa65Provider, experimentalCandidateIngress,
  experimentalCandidateSignPayload,
} from '@dcp-ai/sdk';

// The ingress decides on the original bytes: 1.0 is the integer 1, members are sorted.
const accepted = experimentalCandidateIngress(new TextEncoder().encode('{"b":1.0,"a":[]}'));
if (accepted.status === 'accept') console.log(new TextDecoder().decode(accepted.canonical)); // {"a":[],"b":1}
const refused = experimentalCandidateIngress(new TextEncoder().encode('{"a":1,"a":2}'));
if (refused.status === 'reject') console.log(refused.class, refused.offset); // DUPLICATE_KEY 7

// A producer signs an artifact from those bytes (hybrid keys, today's composite signature).
const registry = new AlgorithmRegistry();
const ed25519 = new Ed25519Provider();
const mlDsa65 = new MlDsa65Provider();
registry.registerSigner(ed25519);
registry.registerSigner(mlDsa65);
const c = await ed25519.generateKeypair();
const p = await mlDsa65.generateKeypair();
const keys = {
  classical: { kid: c.kid, alg: 'ed25519', secretKeyB64: c.secretKeyB64, publicKeyB64: c.publicKeyB64 },
  pq: { kid: p.kid, alg: 'ml-dsa-65', secretKeyB64: p.secretKeyB64, publicKeyB64: p.publicKeyB64 },
};
const artifact = await experimentalCandidateSignPayload(
  registry, DCP_CONTEXTS.Intent, { bytes: new TextEncoder().encode('{"intent_id":"intent:1","risk":1.0}') }, keys,
);
console.log(artifact.signedPayload.payload_hash); // sha256:… of {"intent_id":"intent:1","risk":1}
```

<a id="dcp-0509-extended-protocol-modules"></a>

### DCP-05–09：拡張プロトコルモジュール

| モジュール | 仕様 | 主なエクスポート |
|--------|------|-------------|
| `lifecycle` | DCP-05 | `LifecycleState`, `CommissioningCertificate`, `VitalityReport`, `DecommissioningRecord`, `VitalityMetrics`, `TerminationMode`, `DataDisposition` |
| `succession` | DCP-06 | `DigitalTestament`, `SuccessionRecord`, `MemoryTransferManifest`, `MemoryTransferEntry`, `MemoryClassification`, `SuccessorPreference`, `TransitionType`, `MemoryDisposition` |
| `conflict-resolution` | DCP-07 | `DisputeRecord`, `ObjectionRecord`, `DisputeType`, `DisputeStatus`, `EscalationLevel`, `ObjectionType` |
| `arbitration` | DCP-07 | `ArbitrationResolution`, `JurisprudenceBundle`, `AuthorityLevel` |
| `rights` | DCP-08 | `RightsDeclaration`, `RightEntry`, `ObligationRecord`, `RightsViolationReport`, `RightType`, `ComplianceStatus` |
| `delegation` | DCP-09 | `DelegationMandate`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `AuthorityScopeEntry` |
| `awareness-threshold` | DCP-09 | `AwarenessThreshold`, `ThresholdRule`, `ThresholdOperator`, `ThresholdAction` |
| `principal-mirror` | DCP-09 | `PrincipalMirror`（ビルダーのユーティリティ付きの再エクスポート） |

```typescript
// Fragment, not a complete program: registry, humanKeys (the principal's CompositeKeyPair) and nonce as in the V2 Quick Start.
// Example: Lifecycle management (DCP-05), signed with the commissioning human's composite keys
import { createCommissioningCertificate, validateStateTransition } from '@dcp-ai/sdk';
import type { CommissioningCertificate } from '@dcp-ai/sdk';

const cert: CommissioningCertificate = await createCommissioningCertificate(registry, humanKeys, {
  agent_id: 'agent:agent-001',
  session_nonce: nonce,
  human_id: 'human:human-001',
  commissioning_authority: 'human:human-001',
  purpose: 'Customer support triage',
  initial_capabilities: ['browse', 'api_call'],
  risk_tier: 'low',
  principal_binding_reference: 'human:human-001',
});
validateStateTransition('commissioned', 'active'); // true

// Example: Delegation mandate (signed by the human)
import { createDelegationMandate } from '@dcp-ai/sdk';

const mandate = await createDelegationMandate(registry, humanKeys, {
  mandate_id: 'mandate-001',
  session_nonce: nonce,
  human_id: 'rpr:human-001',
  agent_id: 'agent:agent-001',
  authority_scope: [{ domain: 'email', actions_permitted: ['read', 'draft'], limits: { max_messages_per_day: 50 } }],
  valid_from: '2026-03-01T00:00:00Z',
  valid_until: '2026-06-01T00:00:00Z',
  revocable: true,
});
```

<a id="v2-types"></a>

## V2 の型

SDK がエクスポートする主な型：

- `SignedPayload` — 複合署名のメタデータを伴う署名済みデータのラッパー
- `CompositeSignature` — クラシカル + PQ の署名要素を含む
- `KeyEntry` — アルゴリズム、kid、鍵の素材を持つ公開鍵エントリ
- `SecurityTier` — `'routine' | 'standard' | 'elevated' | 'maximum'`
- `VerifierPolicy` — 検証器のポリシー：既定のモードと `risk_tier` ごとの上書き。セキュリティティアはモードを厳しくすることしかできない
- `PQCheckpoint` — 監査エントリに対するポスト量子チェックポイント
- `A2ASession` — 暗号化されたエージェント間セッションの状態
- `A2AMessage` — 暗号化された A2A メッセージのエンベロープ
- `TelemetryConfig` — オブザーバビリティのサブシステムの設定

**DCP-05–09 の型：**

- `LifecycleState` — `'commissioned' | 'active' | 'declining' | 'decommissioned'`
- `CommissioningCertificate` — 条件付きのエージェントの稼働開始記録
- `VitalityReport` — 定期的な健全性とパフォーマンスのメトリクス
- `DecommissioningRecord` — データの処分を含む稼働終了の記録
- `DigitalTestament` — メモリーの処分を含む継承計画
- `SuccessionRecord` — 完了した継承の記録
- `MemoryTransferManifest` — 分類済みのメモリー移転マニフェスト
- `DisputeRecord` — エスカレーションレベルを持つ紛争の記録
- `ArbitrationResolution` — 拘束力のある権限を伴う仲裁の結果
- `JurisprudenceBundle` — 紛争解決のための先例の集合
- `RightsDeclaration` — 遵守状況の追跡を伴うエージェントの権利
- `ObligationRecord` — 履行状況を伴う義務
- `RightsViolationReport` — 重大度を伴う違反報告
- `DelegationMandate` — 範囲を定めた権限の委任
- `AwarenessThreshold` — 人間の関与（human-in-the-loop）を発動するルール
- `PrincipalMirror` — プリンシパルの選好のスナップショット

<a id="a2a-protocol"></a>

## A2A プロトコル

暗号化されたエージェント間通信：

```typescript
// Fragment, not a complete program: sessionId and sessionKey come from the A2A handshake, remoteSession is the peer's session.
import { createSession, encryptMessage, decryptMessage } from '@dcp-ai/sdk';

// Create encrypted A2A session
const session = createSession(sessionId, sessionKey, 'agent:a', 'agent:b', 'elevated');
const encrypted = encryptMessage(session, { action: 'negotiate', data: { offer: 10 } });
const decrypted = decryptMessage(remoteSession, encrypted);
// The same message delivered again throws: each sequence is accepted once.
```

<a id="observability-1"></a>
<a id="observability_1"></a>

## オブザーバビリティ

テレメトリには明示的な計測処理が必要です。観測したい処理の前後でスパンやメトリクスのメソッドを呼び出してください。初期化だけでは暗号処理は計測されません。この例はテレメトリの初期化と現在の集計結果の取得のみを行います。

```typescript
import { dcpTelemetry } from '@dcp-ai/sdk';

dcpTelemetry.init({ serviceName: 'my-agent', enabled: true, exporterType: 'console' });

// Read metrics explicitly recorded so far; initialization alone records no crypto operations
const summary = dcpTelemetry.getMetricsSummary();
```

<a id="dependencies"></a>

## 依存関係

- `ajv` + `ajv-formats` — JSON Schema の検証
- `tweetnacl` + `tweetnacl-util` — Ed25519 暗号
- `json-stable-stringify` — 決定的な JSON
- `@noble/post-quantum` — ML-DSA-65 と SLH-DSA のポスト量子署名

<a id="development"></a>

## 開発

```bash
# Install dependencies
npm install

# Build (ESM + CJS + types)
npm run build

# Tests with Vitest
npm test
npm run test:watch
npm run test:coverage

# Type check
npm run lint
```

<a id="license"></a>

## ライセンス

Apache-2.0
