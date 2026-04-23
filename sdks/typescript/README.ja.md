<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · **日本語** · [Português](README.pt-BR.md)</sub>

# @dcp-ai/sdk — DCP-AI v2.0 向け TypeScript SDK

デジタル市民権プロトコル (DCP-AI) 公式TypeScript SDKです。耐量子ハイブリッド暗号 (Ed25519 + ML-DSA-65)、複合署名、適応型セキュリティティア、エージェント間 (A2A) 通信、組み込みの可観測性、そして本番向けの堅牢化機能を備え、市民権バンドルの作成・署名・検証が行えます。

## インストール

```bash
npm install @dcp-ai/sdk
```

## クイックスタート (V1)

```typescript
import {
  BundleBuilder,
  signBundle,
  verifySignedBundle,
  generateKeypair,
} from '@dcp-ai/sdk';

const keys = generateKeypair();

const bundle = new BundleBuilder()
  .responsiblePrincipalRecord({ dcp_version: '1.0', human_id: 'human-001', /* ... */ })
  .agentPassport({ dcp_version: '1.0', agent_id: 'agent-001', /* ... */ })
  .intent({ dcp_version: '1.0', agent_id: 'agent-001', /* ... */ })
  .policyDecision({ dcp_version: '1.0', agent_id: 'agent-001', /* ... */ })
  .build();

const signed = signBundle(bundle, {
  secretKeyB64: keys.secretKeyB64,
  signerType: 'human',
  signerId: 'human-001',
});

const result = verifySignedBundle(signed, keys.publicKeyB64);
console.log(result); // { verified: true, errors: [] }
```

## クイックスタート (V2)

```typescript
import {
  BundleBuilderV2,
  signBundleV2,
  verifySignedBundleV2,
  generateKeypair,
  registerDefaultProviders,
  getDefaultRegistry,
  computeSecurityTier,
} from '@dcp-ai/sdk';

// Register PQ crypto providers
registerDefaultProviders();
const registry = getDefaultRegistry();

// Generate Ed25519 keypair (for classical signing)
const keys = generateKeypair();

// Build a V2 bundle with session nonce and security tier
const bundle = new BundleBuilderV2()
  .responsiblePrincipalRecord({ /* V2 RPR with keys[] */ })
  .agentPassport({ /* V2 passport with capabilities */ })
  .intent({ /* V2 intent with risk_score and security_tier */ })
  .policyDecision({ /* V2 policy with resolved_tier */ })
  .addAuditEntry({ /* V2 audit with dual-hash chain */ })
  .build();
```

## APIリファレンス

### コア暗号 (V1)

| 関数 | 説明 |
|----------|-------------|
| `generateKeypair()` | Ed25519の鍵ペアを生成 (`publicKeyB64`、`secretKeyB64`) |
| `signObject(obj, secretKeyB64)` | オブジェクトに署名し、base64署名を返す |
| `verifyObject(obj, signatureB64, publicKeyB64)` | 公開鍵に対して署名を検証 |
| `canonicalize(obj)` | 決定論的 (正規) なJSONシリアライゼーション |
| `publicKeyFromSecret(secretKeyB64)` | 秘密鍵から公開鍵を導出 |

### 暗号プロバイダ (V2)

| エクスポート | 説明 |
|--------|-------------|
| `Ed25519Provider` | 古典Ed25519署名プロバイダ |
| `MlDsa65Provider` | 耐量子ML-DSA-65署名プロバイダ |
| `SlhDsa192fProvider` | 耐量子SLH-DSA-192f署名プロバイダ |
| `AlgorithmRegistry` | 利用可能な暗号アルゴリズムプロバイダを管理するレジストリ |
| `getDefaultRegistry()` | シングルトンのアルゴリズムレジストリを返す |
| `registerDefaultProviders()` | Ed25519、ML-DSA-65、SLH-DSA-192f のプロバイダを登録 |
| `deriveKid(publicKey, algorithm)` | 公開鍵から鍵識別子を導出 |

### 複合署名 (V2)

| 関数 | 説明 |
|----------|-------------|
| `compositeSign(payload, keys, registry)` | 古典 + 耐量子アルゴリズムによる複合署名を作成 |
| `compositeVerify(payload, signature, registry)` | 複合署名を検証 |
| `classicalOnlySign(payload, keys, registry)` | 古典アルゴリズムのみで署名 (フォールバックモード) |

### セキュリティティア (V2)

| 関数 | 説明 |
|----------|-------------|
| `computeSecurityTier(riskScore, flags)` | 数値のリスクスコアから `SecurityTier` を計算 |
| `maxTier(a, b)` | 2つのセキュリティティアのうち高い方を返す |
| `tierToVerificationMode(tier)` | ティアから必要な検証モードへのマッピング |
| `tierToCheckpointInterval(tier)` | ティアから耐量子チェックポイント間隔へのマッピング |

### バンドル構築

| エクスポート | バージョン | 説明 |
|--------|---------|-------------|
| `BundleBuilder` | V1 | V1市民権バンドル用の流暢なビルダー |
| `BundleBuilderV2` | V2 | セキュリティティアとデュアルハッシュに対応したV2バンドル用ビルダー |
| `signBundle(bundle, options)` | V1 | V1バンドルにEd25519で署名 |
| `signBundleV2(bundle, keys, registry)` | V2 | V2バンドルに複合署名で署名 |
| `signBundleV2ClassicalOnly(bundle, keys, registry)` | V2 | V2バンドルに古典のみの署名で署名 |
| `verifySignedBundle(signedBundle, publicKeyB64)` | V1 | V1署名済みバンドルを検証 |
| `verifySignedBundleV2(signedBundle, registry)` | V2 | V2署名済みバンドルを検証 (複合または古典) |

### バンドル最適化 (V2)

| エクスポート | 説明 |
|--------|-------------|
| `suggestPresentationMode(context)` | コンテキストに基づいてプレゼンテーションモードを推奨 |
| `presentFull(bundle)` | 完全なバンドルプレゼンテーション (省略なし) |
| `presentCompact(bundle)` | 監査トレイルを刈り込んだコンパクトなプレゼンテーション |
| `presentReference(bundle)` | 参照のみのプレゼンテーション (ハッシュのみ、ペイロードなし) |
| `presentIncremental(bundle, since)` | インクリメンタルプレゼンテーション (チェックポイント以降の差分) |
| `VerificationCache` | 冗長な暗号処理を避けるため検証結果をキャッシュ |

### 耐量子チェックポイント (V2)

| エクスポート | 説明 |
|--------|-------------|
| `PQCheckpointManager` | 定期的な耐量子チェックポイント作成を管理 |
| `createPQCheckpoint(entries, keys, registry)` | 監査エントリに対する耐量子署名付きチェックポイントを作成 |
| `auditEventsMerkleRoot(entries)` | 監査エントリからMerkleルートを計算 |

### デュアルハッシュ (V2)

| 関数 | 説明 |
|----------|-------------|
| `sha256Hex(data)` | SHA-256ハッシュ (hex文字列) |
| `sha3_256Hex(data)` | SHA3-256ハッシュ (hex文字列) |
| `dualHash(data)` | 耐量子デュアルハッシュ用に `{ sha256, sha3_256 }` を返す |
| `dualMerkleRoot(leaves)` | デュアルハッシュのリーフからMerkleルートを計算 |

### A2Aプロトコル (DCP-04)

| 関数 | 説明 |
|----------|-------------|
| `createAgentDirectory()` | メモリ内のエージェントディレクトリを作成 |
| `findAgentByCapability(dir, cap)` | ディレクトリ内の能力でエージェントを検索 |
| `findAgentById(dir, id)` | IDでエージェントを検索 |
| `createHello(agentId, capabilities)` | A2A Helloハンドシェイクメッセージを作成 |
| `createWelcome(agentId, capabilities)` | A2A Welcome応答メッセージを作成 |
| `deriveSessionId(helloNonce, welcomeNonce)` | ハンドシェイクノンスからセッションIDを導出 |
| `createCloseMessage(sessionId, reason)` | セッションクローズメッセージを作成 |
| `createSession(id, key, local, remote, tier)` | 暗号化されたA2Aセッションを作成 |
| `encryptMessage(session, payload)` | A2Aセッション内でメッセージを暗号化 |
| `decryptMessage(session, encrypted)` | A2Aセッション内でメッセージを復号 |
| `needsRekeying(session)` | セッションが鍵ローテーションを必要とするかチェック |
| `generateResumeProof(session)` | セッション再開のための証明を生成 |
| `verifyResumeProof(session, proof)` | セッション再開証明を検証 |

### 可観測性

| エクスポート | 説明 |
|--------|-------------|
| `dcpTelemetry` | シングルトンのテレメトリーインスタンス |
| `dcpTelemetry.init(config)` | サービス名とエクスポーターでテレメトリーを初期化 |
| `dcpTelemetry.startSpan(name)` | 名前付きトレーススパンを開始 |
| `dcpTelemetry.endSpan(span)` | トレーススパンを終了 |
| `dcpTelemetry.recordSignLatency(ms)` | 署名レイテンシーメトリックを記録 |
| `dcpTelemetry.getMetricsSummary()` | 集約されたメトリックサマリーを返す |

### 本番向け堅牢化

| エクスポート | 説明 |
|--------|-------------|
| `DcpErrorCode` | 構造化されたエラーコードのenum |
| `DcpProtocolError` | プロトコルレベル障害のための型付きエラークラス |
| `createDcpError(code, message, context)` | 構造化されたDCPエラーを作成するファクトリー |
| `isDcpError(err)` | `DcpProtocolError` のための型ガード |
| `RateLimiter` | 固定ウィンドウのレート制限 |
| `AdaptiveRateLimiter` | 負荷に応じて調整するレート制限 |
| `CircuitBreaker` | 外部呼び出しのためのサーキットブレーカー |
| `withRetry(fn, options)` | バックオフ付きで非同期関数をリトライ |

### その他のV2

| エクスポート | 説明 |
|--------|-------------|
| `generateSessionNonce()` | 暗号的セッションノンスを生成 |
| `domainSeparatedMessage(domain, message)` | メッセージにドメイン分離子をプレフィックス |
| `generateEmergencyRevocationToken(keys)` | 事前署名済みの緊急失効トークンを生成 |
| `buildEmergencyRevocation(token)` | トークンから完全な失効レコードを構築 |
| `shamirSplit(secret, n, k)` | 秘密を `n` 個のシェアに分割 (閾値 `k`) |
| `shamirReconstruct(shares)` | `k` 個のシェアから秘密を復元 |
| `CborEncoder` | CBORエンコーダークラス |
| `CborDecoder` | CBORデコーダークラス |
| `cborEncode(value)` | 値をCBORバイト列にエンコード |
| `cborDecode(bytes)` | CBORバイト列を値にデコード |

### DCP-05–09: 拡張プロトコルモジュール

| モジュール | Spec | 主なエクスポート |
|--------|------|-------------|
| `lifecycle` | DCP-05 | `LifecycleState`、`CommissioningCertificate`、`VitalityReport`、`DecommissioningRecord`、`VitalityMetrics`、`TerminationMode`、`DataDisposition` |
| `succession` | DCP-06 | `DigitalTestament`、`SuccessionRecord`、`MemoryTransferManifest`、`MemoryTransferEntry`、`MemoryClassification`、`SuccessorPreference`、`TransitionType`、`MemoryDisposition` |
| `conflict-resolution` | DCP-07 | `DisputeRecord`、`ObjectionRecord`、`DisputeType`、`DisputeStatus`、`EscalationLevel`、`ObjectionType` |
| `arbitration` | DCP-07 | `ArbitrationResolution`、`JurisprudenceBundle`、`AuthorityLevel` |
| `rights` | DCP-08 | `RightsDeclaration`、`RightEntry`、`ObligationRecord`、`RightsViolationReport`、`RightType`、`ComplianceStatus` |
| `delegation` | DCP-09 | `DelegationMandate`、`AdvisoryDeclaration`、`PrincipalMirror`、`InteractionRecord`、`AuthorityScopeEntry` |
| `awareness-threshold` | DCP-09 | `AwarenessThreshold`、`ThresholdRule`、`ThresholdOperator`、`ThresholdAction` |
| `principal-mirror` | DCP-09 | `PrincipalMirror` (ビルダーユーティリティ付きで再エクスポート) |

```typescript
// Example: Lifecycle management
import { CommissioningCertificate, LifecycleState } from '@dcp-ai/sdk';

const cert: CommissioningCertificate = {
  certificate_id: 'cert-001',
  agent_id: 'agent-001',
  commissioned_by: 'human-001',
  commissioned_at: '2026-03-01T00:00:00Z',
  initial_state: 'commissioned',
  conditions: ['Must complete onboarding within 30 days'],
};

// Example: Delegation mandate
import { DelegationMandate, AwarenessThreshold } from '@dcp-ai/sdk';

const mandate: DelegationMandate = {
  mandate_id: 'mandate-001',
  principal_id: 'human-001',
  delegate_id: 'agent-001',
  authority_scope: [{ domain: 'email', actions: ['read', 'draft'], constraints: {} }],
  valid_from: '2026-03-01T00:00:00Z',
  valid_until: '2026-06-01T00:00:00Z',
};
```

## V2 型

SDKがエクスポートする主要な型:

- `SignedPayload` — 複合署名メタデータを伴う署名データのラッパー
- `CompositeSignature` — 古典 + 耐量子署名コンポーネントを含む
- `KeyEntry` — アルゴリズム、kid、鍵素材を含む公開鍵エントリ
- `SecurityTier` — `'basic' | 'elevated' | 'critical'`
- `VerifierPolicy` — ティアごとに必要な検証モードを指定するポリシー
- `PQCheckpoint` — 監査エントリに対する耐量子チェックポイント
- `A2ASession` — 暗号化されたエージェント間セッション状態
- `A2AMessage` — 暗号化されたA2Aメッセージ封筒
- `TelemetryConfig` — 可観測性サブシステムの構成

**DCP-05–09 型:**

- `LifecycleState` — `'commissioned' | 'active' | 'declining' | 'decommissioned'`
- `CommissioningCertificate` — 条件付きのエージェント運用開始レコード
- `VitalityReport` — 定期的な健全性とパフォーマンスのメトリック
- `DecommissioningRecord` — データ処理を伴うエンドオブライフレコード
- `DigitalTestament` — 記憶処理を含む継承計画
- `SuccessionRecord` — 完了した継承の記録
- `MemoryTransferManifest` — 分類された記憶移行マニフェスト
- `DisputeRecord` — エスカレーションレベル付き紛争レコード
- `ArbitrationResolution` — 拘束力を伴う仲裁結果
- `JurisprudenceBundle` — 紛争解決のための判例集
- `RightsDeclaration` — コンプライアンス追跡付きエージェント権利
- `ObligationRecord` — 実施状況付き義務
- `RightsViolationReport` — 重大度付き違反報告
- `DelegationMandate` — スコープ付き権限委任
- `AwarenessThreshold` — ヒューマンインザループのトリガールール
- `PrincipalMirror` — 責任主体の選好スナップショット

## A2Aプロトコル

エージェント間の暗号化通信:

```typescript
import { createSession, encryptMessage, decryptMessage } from '@dcp-ai/sdk';

// Create encrypted A2A session
const session = createSession(sessionId, sessionKey, 'agent:a', 'agent:b', 'elevated');
const encrypted = encryptMessage(session, { action: 'negotiate', data: {...} });
const decrypted = decryptMessage(remoteSession, encrypted);
```

## 可観測性

すべての暗号操作は自動的に計装されます。

```typescript
import { dcpTelemetry } from '@dcp-ai/sdk';

dcpTelemetry.init({ serviceName: 'my-agent', enabled: true, exporterType: 'console' });

// All crypto operations are automatically instrumented
const summary = dcpTelemetry.getMetricsSummary();
```

## 依存関係

- `ajv` + `ajv-formats` — JSONスキーマ検証
- `tweetnacl` + `tweetnacl-util` — Ed25519暗号
- `json-stable-stringify` — 決定論的JSON
- `@noble/post-quantum` — ML-DSA-65とSLH-DSA耐量子署名

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

## ライセンス

Apache-2.0
