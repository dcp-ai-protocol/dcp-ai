<sub>[English](MIGRATION_V1_V2.md) · [中文](MIGRATION_V1_V2.zh-CN.md) · [Español](MIGRATION_V1_V2.es.md) · **日本語** · [Português](MIGRATION_V1_V2.pt-BR.md)</sub>

<a id="migration-guide-dcp-ai-v10-to-v20"></a>

# 移行ガイド：DCP-AI v1.0 から v2.0 へ

> [英語版](MIGRATION_V1_V2.md)の参考訳です（26/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

**仕様バージョン：** 2.0
**最終更新：** 2026 年 10 月
**対象：** `main` の SDK と公開済み `@dcp-ai/sdk` 2.2.0。npm バージョンは 2026 年 10 月 26 日に確認済みです。[NPM_RELEASES.md](NPM_RELEASES.md) と [SECURITY.md](../SECURITY.md#supported-versions) を参照してください。他の環境の公開は別です。

このガイドでは、既存の DCP-AI v1.0 の統合を v2.0 に移行する手順を説明します。移行によって、ポスト量子の複合署名、二重ハッシュチェーン、セッションバインディング、適応型のセキュリティティア、エージェント間通信が導入されます。一方で、有効な v1.0 のバンドルは、検証器のポリシーが許す範囲で引き続き検証できます（1.2 を参照）。

---

<a id="1-what-changed-in-v20"></a>

## 1. v2.0 で変わったこと

<a id="11-summary-of-changes"></a>

### 1.1 変更の概要

| 機能 | v1.0 | v2.0 |
|---------|------|------|
| **署名** | Ed25519 のみ | 複合：Ed25519 + ML-DSA-65（PQ） |
| **ハッシュチェーン** | SHA-256 のみ | 二重：SHA-256 + SHA3-256 |
| **セッションバインディング** | なし | すべてのアーティファクトに `session_nonce` |
| **セキュリティティア** | なし | 適応型：routine / standard / elevated / maximum |
| **バンドルのマニフェスト** | `bundle_hash` + `merkle_root` | アーティファクトごとのハッシュ、二次マークルルート、PQ チェックポイントを持つ完全なマニフェスト |
| **署名の形式** | `{ alg, public_key_b64, sig_b64 }` | `{ composite_sig: { classical, pq, binding } }` |
| **A2A 通信** | 規定なし | DCP-04：ディスカバリー、ハンドシェイク、暗号化セッション |
| **検証ポリシー** | エージェントが宣言 | 検証者が決定 |
| **ドメイン分離** | なし | すべての署名にコンテキストタグ |
| **kid の導出** | 実装依存 | 決定的：`hex(SHA-256(alg || 0x00 || pk))[0:32]` |
| **数値フィールド** | 混在（int/float） | 整数のみ（float は禁止） |
| **プライバシー** | 完全な RPR のみ | ブラインド化された RPR のモードあり |
| **鍵の回復** | 規定なし | M-of-N のソーシャルリカバリー（Shamir SSS） |
| **緊急失効** | 規定なし | 事前登録した失効トークン |
| **アルゴリズムのガバナンス** | 規定なし | 自動応答を伴う署名済みの勧告 |
| **ワイヤ形式** | JSON のみ | JSON（既定）+ CBOR（オプション） |

<a id="12-breaking-changes"></a>

### 1.2 互換性のない変更

v1.0 の形式は引き続き有効ですが、次の制限があります。

- 両方のバージョンを扱う検証器は、ポリシーが `allow_v1_bundles: true`（既定値）で、実効モードがクラシカルのみの署名を
  許容する場合（下記）に、有効な v1.0 のバンドルを受け入れます。`verifySignedBundleV2` 自体は
  v2.0 しか受け付けないので、v1.0 のバンドルは V1 の検証器に回してください（3.2 を参照）。
- 受け入れは以前のバージョンより厳しくなっています。たとえば、`S` が群の位数 `L` 未満でない Ed25519 署名は
  拒否されるようになりました（変更履歴の [`[Unreleased]`](../CHANGELOG.md#unreleased) を参照）。そのため、
  以前の検証器が受け入れていた保存済みの v1.0 のバンドルが、検証に通らなくなることがあります。
- v1.0 の検証器は v2.0 のバンドルを拒否します（`"unsupported dcp_version 2.0"`）。

v1.0 のバンドルには Ed25519 の署名が 1 つあるだけでポスト量子の署名がないため、検証ミドルウェア（`@dcp-ai/express`、`@dcp-ai/openclaw`、`dcp_ai.fastapi`）がそれを受け入れるのは、クラシカルのみの v2.0 のバンドルが通る場合に限られます（VERIFICATION.md V2-10）。つまり、V1 のパスポートの `risk_tier` に対するポリシーのモードと、V1 の意図とポリシー判断から計算したセキュリティティアのモード（V1 の `risk_score` は 0 から 1 で、1000 倍する。欠けていれば `elevated` として扱う）のうち厳しいほうが、`classical_only` か `hybrid_preferred` でなければなりません。既定のポリシーでは、意図が routine または standard の V1 バンドルは通り、支払い、機微なデータ、高い推定影響、0.5 以上のリスクスコアを伴うものは拒否されます。Express の `requireHybrid` は、すべての V1 バンドルを拒否します。

移行は**追加的**です。v2.0 は v1.0 の形式と並んで新しいフィールドと構造を導入します。生成側（エージェント）と利用側（検証器）は、それぞれ独立して移行できます。

---

<a id="2-step-by-step-migration"></a>

## 2. 段階的な移行

<a id="step-1-update-sdk"></a>

### ステップ 1：SDK を更新する

TypeScript の例は公開済み npm SDK で動作します。`main` に基づく Python、Go、Rust の機能については各 SDK README のリリース状況を確認し、未公開の機能にはチェックアウトを使ってください。

**TypeScript**（2026 年 10 月 26 日公開：2.2.0）：

```bash
npm install @dcp-ai/sdk@^2.2.0
```

**Python：**

```bash
pip install -e /path/to/dcp-ai/sdks/python     # main
# or the published version, with optional framework extras: pip install --upgrade 'dcp-ai[fastapi]'
```

**Go**（Go モジュールが要求するメジャーバージョンの接尾辞 v2 に注意）：

```bash
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@main
```

**Rust：**

```toml
dcp-ai = { git = "https://github.com/dcp-ai-protocol/dcp-ai", branch = "main" }
```

**WebAssembly：** チェックアウトから `sdks/wasm` をビルドし（`npm run build`）、その後 `npm install /path/to/dcp-ai/sdks/wasm` を実行します。

<a id="step-2-generate-hybrid-key-pairs"></a>

### ステップ 2：ハイブリッドな鍵ペアを生成する

このハイブリッド移行では、クラシカル（Ed25519）とポスト量子（ML-DSA-65）の両方の鍵ペアを使います。クラシカルのみの署名を受け入れるかどうかは、引き続き実効検証モードによって決まります（1.2）。

**TypeScript：**

```typescript
import { getDefaultRegistry, registerDefaultProviders } from '@dcp-ai/sdk';

registerDefaultProviders(); // Ed25519, ML-DSA-65, SLH-DSA-192f into the default registry
const registry = getDefaultRegistry();

const classicalKp = await registry.getSigner('ed25519').generateKeypair();
const pqKp = await registry.getSigner('ml-dsa-65').generateKeypair();
// each: { kid, publicKeyB64, secretKeyB64 }; kid = deriveKid(alg, publicKey)
```

**Python：**

```python
import asyncio
from dcp_ai.providers.ed25519_provider import Ed25519Provider
from dcp_ai.providers.ml_dsa_65_provider import MlDsa65Provider

async def generate_hybrid():
    return await Ed25519Provider().generate_keypair(), await MlDsa65Provider().generate_keypair()

classical, pq = asyncio.run(generate_hybrid())
# each: {"kid", "public_key_b64", "secret_key_b64"}
```

Python SDK は `dcp_ai.v2`（`BundleBuilderV2`、`sign_bundle_v2`、
`verify_signed_bundle_v2`。5.2 を参照）で V2 のバンドルを構築、署名、検証します。

**CLI**（チェックアウト内の `bin/dcp.js`）：

```bash
dcp keygen --hybrid ./keys/
# Creates: ed25519_{public_key,secret_key,kid}.txt and ml_dsa_65_{public_key,secret_key,kid}.txt
```

<a id="step-3-update-artifact-construction"></a>

### ステップ 3：アーティファクトの構築を更新する

V2 の RPR、パスポート、意図、ポリシー判断には `dcp_version: "2.0"` とバンドルの `session_nonce` が加わり、それぞれが
`SignedPayload` として個別に署名されます（ステップ 4）。鍵はアーティファクトの中に移ります。RPR は `binding_keys` にプリンシパルの鍵を、
パスポートは `keys` にエージェントの鍵を列挙し、それぞれに `kid`、`alg`、`public_key_b64`、`created_at`、
`expires_at`、`status` があります。

**変更前（v1.0 の RPR）：** `signature` を除いたオブジェクトに対する、分離された Ed25519 の `signature`。

```json
{
  "dcp_version": "1.0",
  "human_id": "human:example-001",
  "legal_name": "Example Principal",
  "entity_type": "natural_person",
  "jurisdiction": "ES",
  "liability_mode": "owner_responsible",
  "override_rights": true,
  "issued_at": "2026-10-25T00:00:00Z",
  "expires_at": null,
  "contact": null,
  "signature": "<base64 Ed25519 signature>"
}
```

**変更後（v2.0 の RPR のペイロード）：** `signature` フィールドはなく、複合署名はペイロードの横に置かれます（ステップ 4）。

```json
{
  "dcp_version": "2.0",
  "human_id": "human:example-001",
  "session_nonce": "<64 hex characters>",
  "legal_name": "Example Principal",
  "entity_type": "natural_person",
  "jurisdiction": "ES",
  "liability_mode": "owner_responsible",
  "override_rights": true,
  "issued_at": "2026-10-25T00:00:00Z",
  "expires_at": null,
  "contact": null,
  "binding_keys": [
    { "kid": "<32 hex>", "alg": "ed25519", "public_key_b64": "...", "created_at": "2026-01-01T00:00:00Z", "expires_at": null, "status": "active" },
    { "kid": "<32 hex>", "alg": "ml-dsa-65", "public_key_b64": "...", "created_at": "2026-01-01T00:00:00Z", "expires_at": null, "status": "active" }
  ]
}
```

主な違い：
- `dcp_version` は `"2.0"` で、`session_nonce`（16 進 64 文字、256 ビットの乱数）はバンドルのすべての
  アーティファクトで同じです。
- パスポートは `public_key` を `keys`（Ed25519 と ML-DSA-65 のエントリ）に置き換え、ポリシー判断の
  `risk_score` は 0 から 1000 の整数になります（仕様 §14.2）。
- 署名はペイロードの外に出ます。

<a id="step-4-switch-to-composite-signatures"></a>

### ステップ 4：複合署名に切り替える

これら 4 つの V2 アーティファクトはそれぞれ `SignedPayload` です。ペイロード、そのハッシュ、そしてアーティファクトのドメイン分離コンテキストのもとでの
複合署名です（RPR はプリンシパルの鍵で、パスポート、意図、ポリシー判断はエージェントの鍵で署名します）。

```json
{
  "payload": { "dcp_version": "2.0", "...": "..." },
  "payload_hash": "sha256:<hex of the canonical payload>",
  "composite_sig": {
    "classical": { "alg": "ed25519", "kid": "<32 hex>", "sig_b64": "..." },
    "pq": { "alg": "ml-dsa-65", "kid": "<32 hex>", "sig_b64": "..." },
    "binding": "pq_over_classical"
  }
}
```

主な違い：
- 各要素は公開鍵を持つ代わりに、`kid`（決定的、ステップ 2）で鍵を指定します。
- `binding: "pq_over_classical"`：PQ 署名がクラシカルな署名を覆うため、PQ 署名を無効にせずにクラシカルな署名を差し替える
  ことはできません。ただし、PQ 署名そのものは取り除き、バインディングを `classical_only` に付け替えることができます。検証器は
  これを `classical_only` と `hybrid_preferred` のモードでは受け入れ（後者では警告付き）、`hybrid_required` と `pq_only`
  では拒否します。PQ 署名が存在していても無効であれば、どのモードでも拒否されます。

**TypeScript SDK**（断片です。完全で実行可能な流れは TypeScript SDK の
[Quick Start (V2)](../sdks/typescript/README.md#quick-start-v2) にあります）：

```typescript
import { compositeSign, preparePayload, DCP_CONTEXTS } from '@dcp-ai/sdk';

// payload: a V2 artifact payload; registry and agentKeys (a CompositeKeyPair) as in Step 2
const { canonicalBytes, payloadHash } = preparePayload(payload);
const signedIntent = {
  payload,
  payload_hash: payloadHash,
  composite_sig: await compositeSign(registry, DCP_CONTEXTS.Intent, canonicalBytes, agentKeys),
};
```

<a id="step-5-add-domain-separation"></a>

### ステップ 5：ドメイン分離を加える

V2 のすべての署名は、アーティファクトのコンテキスト（`DCP-AI.v2.Intent`、`DCP-AI.v2.Bundle` など、`DCP_CONTEXTS`）を使って
`UTF8(context) || 0x00 || canonical_bytes` に対して計算されます。`compositeSign`、`signBundleV2`、およびほかの SDK の
同等の関数がこれを行います。メッセージを自分で組み立てる場合は、V2 の正規化
（`dcp-jcs-v1`）を使ってください。

```typescript
import { canonicalizeV2, domainSeparatedMessage, DCP_CONTEXTS } from '@dcp-ai/sdk';

// manifest: the bundle manifest (Step 7)
const message = domainSeparatedMessage(DCP_CONTEXTS.Bundle, new TextEncoder().encode(canonicalizeV2(manifest)));
// classical signature over `message`; the PQ signature over `message || classical signature bytes`
```

<a id="step-6-update-audit-entries"></a>

### ステップ 6：監査エントリを更新する

**変更前（v1.0）：**

```json
{
  "dcp_version": "1.0",
  "audit_id": "audit:example-001",
  "prev_hash": "GENESIS",
  "timestamp": "2026-10-25T00:01:00Z",
  "agent_id": "agent:example-001",
  "human_id": "human:example-001",
  "intent_id": "intent:example-001",
  "intent_hash": "<hex>",
  "policy_decision": "approved",
  "outcome": "call_completed",
  "evidence": { "tool": "http", "result_ref": null }
}
```

**変更後（v2.0）：**

```json
{
  "dcp_version": "2.0",
  "audit_id": "audit:example-001",
  "session_nonce": "<the bundle's nonce>",
  "prev_hash": "GENESIS",
  "hash_alg": "sha256",
  "timestamp": "2026-10-25T00:01:00Z",
  "agent_id": "agent:example-001",
  "human_id": "human:example-001",
  "intent_id": "intent:example-001",
  "intent_hash": "sha256:<hex of the canonical intent payload>",
  "policy_decision": "approved",
  "outcome": "call_completed",
  "evidence": { "tool": "http", "result_ref": null, "evidence_hash": null },
  "pq_checkpoint_ref": null
}
```

新しいフィールドは `session_nonce`、`hash_alg`、`evidence.evidence_hash`、`pq_checkpoint_ref` で、ハッシュには
`sha256:` の接頭辞が付きます。二重ハッシュチェーンでは `prev_hash_secondary`（SHA3-256）と `hash_alg: "sha256+sha3-256"` が加わります。
現在の V2 検証器は、実験的な候補も含め、二次チェーンも `audit_merkle_root_secondary` も再計算しません。これらのフィールドを
生成しても、追加の保護があることは示されません（[STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md#dual-hash-chains)）。
監査エントリは 1 件ずつ署名されるわけではありません。マニフェストが監査のマークルルートを通じてそれらにコミットし、PQ チェックポイントが
その範囲に署名します。

<a id="step-7-construct-bundle-manifest"></a>

### ステップ 7：バンドルのマニフェストを構築する

V1 はバンドル全体に署名します（`signature.bundle_hash`）。V2 は、各アーティファクトにコミットするマニフェストに署名します。

**変更前（v1.0 の署名済みバンドル）：**

```json
{
  "bundle": {
    "responsible_principal_record": { "...": "..." },
    "agent_passport": { "...": "..." },
    "intent": { "...": "..." },
    "policy_decision": { "...": "..." },
    "audit_entries": [{ "...": "..." }]
  },
  "signature": {
    "alg": "ed25519",
    "created_at": "2026-10-25T00:02:00Z",
    "signer": { "type": "human", "id": "human:example-001", "public_key_b64": "..." },
    "bundle_hash": "sha256:<hex>",
    "merkle_root": "sha256:<hex>",
    "sig_b64": "..."
  }
}
```

**変更後（v2.0 の署名済みバンドル）：**

```json
{
  "bundle": {
    "dcp_bundle_version": "2.0",
    "manifest": {
      "session_nonce": "<64 hex>",
      "rpr_hash": "sha256:...",
      "passport_hash": "sha256:...",
      "intent_hash": "sha256:...",
      "policy_hash": "sha256:...",
      "audit_merkle_root": "sha256:...",
      "audit_count": 1,
      "canonicalization_profile": "dcp-jcs-v1"
    },
    "responsible_principal_record": { "payload": { "...": "..." }, "payload_hash": "sha256:...", "composite_sig": { "...": "..." } },
    "agent_passport": { "payload": { "...": "..." }, "payload_hash": "sha256:...", "composite_sig": { "...": "..." } },
    "intent": { "payload": { "...": "..." }, "payload_hash": "sha256:...", "composite_sig": { "...": "..." } },
    "policy_decision": { "payload": { "...": "..." }, "payload_hash": "sha256:...", "composite_sig": { "...": "..." } },
    "audit_entries": [{ "...": "..." }]
  },
  "signature": {
    "hash_alg": "sha256",
    "created_at": "2026-10-25T00:02:00Z",
    "signer": { "type": "human", "id": "human:example-001", "kids": ["<classical kid>", "<pq kid>"] },
    "manifest_hash": "sha256:<hex of the canonical manifest>",
    "composite_sig": { "classical": { "...": "..." }, "pq": { "...": "..." }, "binding": "pq_over_classical" }
  }
}
```

マニフェストは：
- アーティファクトごとに 1 つのハッシュ（各アーティファクトの `payload_hash`）と、監査のマークルルートを持ちます。
- `audit_merkle_root_secondary`（SHA3-256）、`pq_checkpoints`、署名済みのセッションウィンドウ
  （`session_issued_at`、`session_expires_at`）、`intended_verifier`、`canonicalization_profile` を加えることができます。
- 責任あるプリンシパルが `DCP-AI.v2.Bundle` のもとで複合署名します。

<a id="step-8-update-verifier-configuration"></a>

### ステップ 8：検証器の設定を更新する

V2 の検証は、バンドルではなく検証器が決める検証器のポリシーを受け取ります。
`DEFAULT_VERIFIER_POLICY` から始めて、必要なところを変えてください。省略したフィールドは既定値で埋められません
（たとえば `max_key_age_days` がなければ鍵の古さの警告は出ません。このチェックは警告するだけで、拒否はしません）。

```typescript
import { DEFAULT_VERIFIER_POLICY, verifySignedBundleV2 } from '@dcp-ai/sdk';
import type { VerifierPolicy } from '@dcp-ai/sdk';

const policy: VerifierPolicy = {
  ...DEFAULT_VERIFIER_POLICY,
  default_mode: 'hybrid_required',
  risk_overrides: { high: 'hybrid_required', medium: 'hybrid_required', low: 'hybrid_preferred' },
  allow_v1_bundles: true,
};
// signedBundle and registry as in the TypeScript SDK's Quick Start (V2)
const result = await verifySignedBundleV2(signedBundle, registry, policy);
```

フィールドは [API リファレンス](API_REFERENCE.md#verifierpolicy)にあります。移行期間中は `allow_v1_bundles: true` を
保ってください。V1 のバンドルには引き続き、クラシカルのみの署名を許容するモードが必要です。このポリシー
（medium と high のティアでは `hybrid_required`）では、検証ミドルウェアが V1 のバンドルを受け入れるのは、
routine または standard の意図を持つ低リスクのパスポートからのものだけです。

<a id="step-9-add-security-tier-support-optional"></a>

### ステップ 9：セキュリティティアへの対応を加える（オプション）

意図と、`risk_score` を持つポリシー判断から、セキュリティティアを計算します。

```typescript
// Fragment: the intent and the policy decision are V2 payloads, shortened here.
import { computeSecurityTier } from '@dcp-ai/sdk';
import type { IntentV2, PolicyDecisionV2 } from '@dcp-ai/sdk';

const intent = {
  intent_id: 'intent:...',
  action_type: 'api_call',
  data_classes: ['pii'],
  estimated_impact: 'medium',
  // ...
} as IntentV2;
const policyDecision = { risk_score: 350 /* , ... */ } as PolicyDecisionV2;

const tier = computeSecurityTier(intent, policyDecision);
// tier = "elevated" (pii is sensitive data; risk_score 350 alone would give "standard")
```

<a id="step-10-run-conformance-tests"></a>

### ステップ 10：適合性テストを実行する

チェックアウトのルートから実行します（各コマンドはそれぞれのサブシェルで）。

```bash
# TypeScript
(cd sdks/typescript && npm test)

# Python
(cd sdks/python && pytest)

# NIST KAT compliance only
(cd sdks/typescript && npx vitest run src/__tests__/nist-kat.test.ts)

# Protocol conformance (V1 + V2)
npm run conformance
```

---

<a id="3-backward-compatibility"></a>

## 3. 後方互換性

<a id="31-compatibility-matrix"></a>

### 3.1 互換性のマトリクス

```
V1 Verifier + V1 Bundle  ->  PASS (unchanged)
V1 Verifier + V2 Bundle  ->  REJECT "unsupported dcp_version 2.0"
V2 Verifier + V1 Bundle  ->  PASS (when allow_v1_bundles=true and the effective mode
                                    for the bundle is classical_only or hybrid_preferred)
V2 Verifier + V2 Bundle  ->  PASS (full V2 verification)
```

<a id="32-coexistence-strategy"></a>

### 3.2 共存の戦略

移行中、システムはバージョンで振り分けることで、v1.0 と v2.0 の両方のバンドルを扱えます。

```typescript
// Fragment: signedBundle comes from the request; v1PublicKeyB64, registry and policy from configuration.
import { detectDcpVersion, verifySignedBundle, verifySignedBundleV2 } from '@dcp-ai/sdk';

const version = detectDcpVersion(signedBundle);  // '2.0', '1.0', or null for anything else
let result;
if (version === '2.0') {
  result = await verifySignedBundleV2(signedBundle, registry, policy);  // composite verification, tier enforcement
} else if (version === '1.0' && policy.allow_v1_bundles) {
  result = verifySignedBundle(signedBundle, v1PublicKeyB64);           // the Ed25519 signature, hashes and chain
} else {
  result = { verified: false, errors: ['unsupported or disallowed bundle version'] };
}
```

これは形式を振り分けるだけです。V1 の分岐は、V2 のポリシーのモードやセキュリティティアを V1 のバンドルに適用せず
（VERIFICATION.md V2-10）、どちらの分岐も信頼を決めません。前者は検証ミドルウェアが、後者は
[アドミッション](ADMISSION.md)が担います。`verifySignedBundleV2` は v2.0 のバンドルしか受け付けません。リファレンス CLI
（`dcp verify-bundle`）とミドルウェアは、自らバージョンで振り分けます。

<a id="33-schema-routing"></a>

### 3.3 スキーマの振り分け

検証器は、スキーマを確認する前にバンドルのバージョンで振り分けます。

- V2 の署名済みバンドルは `bundle.dcp_bundle_version: "2.0"` と `bundle.manifest` を持つ → `schemas/v2/*.schema.json`
- V1 のバンドルのアーティファクトは `dcp_version: "1.0"` を持つ → `schemas/v1/*.schema.json`

<a id="34-when-to-drop-v1-support"></a>

### 3.4 V1 のサポートをやめる時期

仕様上、V2 の検証器は V1 のバンドルを無期限にサポートしなければなりません（MUST）。ただし、個々のデプロイでは、移行期間の後に V1 のバンドルを拒否するポリシーを設定できます。

```json
{
  "verifier_policy": {
    "allow_v1_bundles": false
  }
}
```

これは、エコシステム内のすべてのエージェントが v2.0 に移行した後でのみ行うべきです。

---

<a id="4-bundle-format-changes-detailed"></a>

## 4. バンドル形式の変更（詳細）

<a id="41-signed-bundle-envelope"></a>

### 4.1 署名済みバンドルのエンベロープ

V1 と V2 の完全なエンベロープは[ステップ 7](#step-7-construct-bundle-manifest)にあります。構造上の主な違い：

- **アーティファクトごとの署名：** RPR、パスポート、意図、ポリシー判断はそれぞれ、自身のコンテキストのもとで署名された `SignedPayload`
  （`payload`、`payload_hash`、`composite_sig`）です。監査エントリは署名されないままで、
  監査のマークルルートを通じてコミットされます。
- **マニフェスト：** `bundle.manifest` は各アーティファクトのハッシュと監査のマークルルートにコミットし、V1 の
  `signature.bundle_hash` に代わるものです。
- **セッションの nonce：** すべてのアーティファクト、監査エントリ、マニフェストで同じ `session_nonce`。
- **バンドルの署名：** `signature.composite_sig` はバンドル全体ではなくマニフェスト（`signature.manifest_hash`）に署名します。
  `signature.signer.kids` は公開鍵を持つ代わりに鍵を指定します。
- **バージョンの目印：** `bundle.dcp_bundle_version: "2.0"`。

<a id="42-composite-signature-object"></a>

### 4.2 複合署名のオブジェクト

```json
{
  "composite_sig": {
    "classical": {
      "alg": "ed25519",
      "kid": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
      "sig_b64": "<base64-encoded Ed25519 signature>"
    },
    "pq": {
      "alg": "ml-dsa-65",
      "kid": "f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3",
      "sig_b64": "<base64-encoded ML-DSA-65 signature>"
    },
    "binding": "pq_over_classical"
  }
}
```

<a id="43-audit-entry-changes"></a>

### 4.3 監査エントリの変更

| フィールド | v1.0 | v2.0 |
|-------|------|------|
| `dcp_version` | `"1.0"` | `"2.0"` |
| `session_nonce` | なし | 必須 |
| `prev_hash` | 直前のエントリの 16 進の SHA-256、または `"GENESIS"` | 直前のエントリの `sha256:<hex>`、または `"GENESIS"` |
| `hash_alg` | なし | 必須：`sha256`、または二重ハッシュチェーンでは `sha256+sha3-256` |
| `prev_hash_secondary` | なし | オプション：`sha3-256:<hex>`（二重ハッシュチェーン） |
| `intent_hash` | 16 進の SHA-256 | `sha256:<hex>` |
| `intent_hash_secondary` | なし | オプション：`sha3-256:<hex>` |
| `evidence.evidence_hash` | なし | あり、`null` でもよい |
| `pq_checkpoint_ref` | なし | 必須、`null` でもよい |
| 署名 | エントリごとにはなし。バンドルの署名がそれらを覆う | エントリごとにはなし。マニフェストの監査のマークルルートがそれらにコミットし、PQ チェックポイントがその範囲に署名する |

---

<a id="5-sdk-api-changes"></a>

## 5. SDK の API の変更

### 5.1 TypeScript SDK

| v1.0 の API | v2.0 の API | 注記 |
|----------|----------|-------|
| `signBundle(bundle, secretKey)` | `signBundleV2(bundle, { registry, signerType, signerId, keys })` | マニフェストに対する複合署名 |
| `verifySignedBundle(sb, publicKey)` | `verifySignedBundleV2(sb, registry, policy?)` | ポリシーに基づく検証 |
| `new BundleBuilder()…build()` | `new BundleBuilderV2(sessionNonce)…build()` | セッションの nonce が必須。アーティファクトは `SignedPayload` |
| `hashObject(obj)` | `hashObject(obj)`（変更なし） | 引き続き SHA-256 + JCS |
| N/A | `dualHashCanonical(canonicalJson)` | SHA-256 + SHA3-256 |
| N/A | `registerDefaultProviders()` + `getDefaultRegistry()` | アルゴリズムレジストリ経由の Ed25519、ML-DSA-65、SLH-DSA-192f |
| N/A | `computeSecurityTier(intent, policyDecision?)` | 適応型のティアの計算（仕様 §14.2） |
| N/A | `deriveKid(alg, publicKeyBytes)` | 決定的な kid |
| N/A | `compositeSign(registry, context, payloadBytes, keys)` | 手動での複合署名 |
| N/A | `compositeVerify(registry, context, payloadBytes, sig, classicalPk, pqPk?)` | 手動での複合署名の検証 |

### 5.2 Python SDK

| v1.0 の API | v2.0 の API | 注記 |
|----------|----------|-------|
| `sign_bundle(bundle, secret_key)` | アーティファクトごとに `prepare_payload` + `await composite_sign(registry, context, payload_bytes, classical_key, pq_key)`、その後 `BundleBuilderV2(session_nonce)…build()` + `await sign_bundle_v2(bundle, registry, signer_type, signer_id, classical_key, pq_key)`（`dcp_ai.v2`） | 各アーティファクトとマニフェストに対する複合署名 |
| `verify_signed_bundle(sb, public_key)` | `await verify_signed_bundle_v2(signed_bundle, registry, policy=None)`（`dcp_ai.v2`） | ポリシーに基づく |
| N/A | `Ed25519Provider` / `MlDsa65Provider`（`dcp_ai.providers`）、非同期の `generate_keypair()` | ハイブリッド鍵 |
| N/A | `compute_security_tier(intent, policy_decision=None)`（`dcp_ai.v2`） | 適応型のティア（仕様 §14.2） |
| N/A | `derive_kid(alg, public_key_bytes)`（`dcp_ai.v2`） | 決定的な kid |

### 5.3 Go SDK

| v1.0 の API | v2.0 の API | 注記 |
|----------|----------|-------|
| `SignObject(bundle, secretKeyB64)` | アーティファクトごとに `v2.SignPayload(registry, context, payload, classicalKey, pqKey)`、その後 `v2.BuildBundleV2(input)` + `v2.SignBundleV2(registry, bundle, classicalKey, pqKey)` | 各アーティファクトとマニフェストに対する複合署名 |
| `VerifySignedBundle(sb, publicKeyB64)` | `v2.VerifySignedBundleV2(registry, signedBundleJSON)` | ポリシーに基づく |
| N/A | `providers.Ed25519Provider` / `providers.MlDsa65Provider` の `GenerateKeypair()` | ハイブリッド鍵 |
| N/A | `v2.ComputeSecurityTier(input)`、`v2.SecurityTierInputFromPayloads(intent, policyDecision)` | 適応型のティア（仕様 §14.2） |
| N/A | `v2.DeriveKid(alg, publicKey)` | 決定的な kid |

### 5.4 Rust SDK

| v1.0 の API | v2.0 の API | 注記 |
|----------|----------|-------|
| `sign_object(bundle, secret_key_b64)` | アーティファクトごとに `prepare_payload`（`dcp_ai::v2::signed_payload`）+ `composite_sign(ed, pq, context, payload_bytes, classical_key, pq_key)`（`dcp_ai::v2::composite_ops`）、その後 `build_bundle_v2(&rpr, &passport, &intent, &policy, &audit_entries, session_nonce)` + `sign_bundle_v2(bundle, &classical_key, &pq_key)`（`dcp_ai::v2::bundle`） | 各アーティファクトとマニフェストに対する複合署名 |
| `verify_signed_bundle(sb, public_key_b64)` | `verify_signed_bundle_v2_with_policy(&signed_bundle, &policy)`（`dcp_ai::v2::verify_bundle`） | ポリシーに基づく |

<a id="55-cli-changes"></a>

### 5.5 CLI の変更

| v1.0 のコマンド | v2.0 のコマンド | 注記 |
|-------------|-------------|-------|
| `dcp keygen [out_dir]` | `dcp keygen --hybrid [out_dir]` | 両方の種類の鍵を生成する |
| `dcp sign-bundle` | `dcp sign-bundle --composite <bundle_v2.json> <ed25519_sk> <ml_dsa_65_sk> [out]` | `@dcp-ai/sdk` による複合署名 |
| `dcp verify-bundle` | `dcp verify-bundle [--policy <mode>] <signed.json> [public_key.txt]` | V2 の完全な検証。`<mode>` は `classical_only`、`hybrid_preferred`、`hybrid_required`、`pq_only` のいずれか。鍵はクラシカルな署名者を固定する |
| N/A | `dcp kid <public_key_file> --alg <algorithm>` | kid を計算する |
| N/A | `dcp recovery-setup --threshold <M> --shares <N> [out]` | M-of-N のソーシャルリカバリー |
| N/A | `dcp emergency-revoke --agent <id> --token <secret>` | 非常ボタンによる失効 |
| N/A | `dcp rotate-key --old-kid <kid> --new-alg <alg>` | 所有証明（PoP）を伴う鍵のローテーション |
| N/A | `dcp capabilities <endpoint_url>` | エンドポイントの機能を照会する |
| N/A | `dcp advisory check [url]` | アルゴリズムの勧告を確認する |

---

<a id="6-testing-your-migration"></a>

## 6. 移行のテスト

<a id="61-verification-checklist"></a>

### 6.1 検証のチェックリスト

移行が完了したことを確認するために、このチェックリストを順に確認してください。

- [ ] **鍵の生成**：ハイブリッドな鍵ペア（Ed25519 + ML-DSA-65）が正しく生成される
- [ ] **kid の導出**：`deriveKid('ed25519', pk)` が期待値と一致する
- [ ] **kid の導出**：`deriveKid('ml-dsa-65', pk)` が期待値と一致する
- [ ] **RPR の構築**：v2.0 の RPR に `dcp_version`、`session_nonce`、両方の種類の鍵が含まれる
- [ ] **パスポートの構築**：v2.0 のパスポートに `dcp_version` と `session_nonce` が含まれる
- [ ] **意図の構築**：v2.0 の意図に `dcp_version` と `session_nonce`（およびオプションで、計算されたティアを上げることしかできない `security_tier`）が含まれる
- [ ] **複合署名**：`signBundleV2` が有効な複合署名を生成する
- [ ] **ドメイン分離**：署名にコンテキストタグが含まれる
- [ ] **複合バインディング**：PQ 署名がクラシカルな署名のバイト列を覆う
- [ ] **二重ハッシュチェーン**：監査エントリに `prev_hash_secondary`（SHA3-256）が含まれる。現在の V2 検証器はこれを再計算しない（ステップ 6）
- [ ] **マニフェスト**：バンドルのマニフェストにすべてのアーティファクトのハッシュが含まれ、二重ハッシュチェーンでは二次マークルルートも含まれる。現在の V2 検証器は二次マークルルートを再計算しない
- [ ] **セッションの nonce**：バンドル内のすべてのアーティファクトが同じ nonce を共有する
- [ ] **V2 の検証**：正しく署名された v2.0 のバンドルが `verifySignedBundleV2`（または `dcp verify-bundle`）に合格する
- [ ] **V1 との互換性**：v1.0 のバンドルが、V1 の関数 `verifySignedBundle`（v1.0 しか受け付けない）、`dcp verify-bundle`、または 3.2 のようなバージョンによるルーターで引き続き検証できる。V2 の関数 `verifySignedBundleV2` は v2.0 しか受け付けない
- [ ] **改ざんの検出**：アーティファクトのどのフィールドを変更しても検証が失敗する
- [ ] **除去の検出**：PQ 署名を取り除く（バインディングを `classical_only` に付け替える）と、`hybrid_required` と `pq_only` では失敗し、`classical_only` と `hybrid_preferred` では受け入れられる。存在するが無効な PQ 署名は、どのモードでも失敗する
- [ ] **NIST KAT**：すべての暗号処理が KAT による検証に合格する
- [ ] **SDK 間**：ある SDK で署名したバンドルが別の SDK で検証できる

<a id="62-common-migration-issues"></a>

### 6.2 よくある移行の問題

**問題：検証中の「kid mismatch」**

v2.0 の kid の導出は決定的です：`hex(SHA-256(UTF8(alg) || 0x00 || raw_pk))[0:32]`。v1.0 の実装が別の kid の方式を使っていた場合は、v2.0 の式で kid を作り直してください。SDK の `deriveKid` 関数がこれを処理します。

**問題：アーティファクト間の「session_nonce mismatch」**

1 つのバンドル内のすべてのアーティファクトは、同じ `session_nonce` を共有しなければなりません（MUST）。nonce はバンドルを作成するたびに 1 回だけ生成し、すべてのアーティファクトの構築関数に渡してください。

**問題：「composite_sig.pq verification failed」**

PQ 署名は `context || 0x00 || payload || classical_sig` に署名します。PQ で署名する前に、クラシカルな署名のバイト列（base64 ではなく生のバイト）が署名対象のメッセージに追加されていることを確認してください。

**問題：v1.0 の検証器からの「unsupported dcp_version 2.0」**

これは想定どおりです。v1.0 の検証器は v2.0 のバンドルを処理できません。上流の検証器を、v2.0 に対応した SDK にアップグレードする必要があります。

**問題：署名済みペイロード内の float 値**

v2.0 は、署名するすべてのペイロードで浮動小数点数を禁止しています（正規化があいまいになるため）。`risk_score: 0.75` を整数のスケール `risk_score: 750`（0-1000）に置き換えてください。

**問題：バンドルのサイズが大きい**

v2.0 のバンドルは、主に ML-DSA-65 の署名（1 つあたり 3309 B）のため大きくなります。検証器が実際に読む形式で最大のバンドルを
測定し、リクエストボディに明示的なサイズの上限を設けてください（[OPERATOR_GUIDE.md](OPERATOR_GUIDE.md#security-tiers-in-verification)を参照）。リファレンスの
検証サーバーは、ケイパビリティ文書に `application/cbor` を挙げていますが、JSON のボディしか読みません。また、CBOR の
エンコーダー（`cborEncode`）を持つのは TypeScript SDK だけで、このリポジトリはそれによるサイズ削減の測定値を公開していません。
`presentCompact` は PQ 署名を取り除く（バインディング `classical_only`）ため、そのバンドルが通るのは実効モードが
`classical_only` または `hybrid_preferred` の場合だけです。転送サイズは、セキュリティティアを下げる理由にはなりません。

<a id="63-validating-migrated-bundles"></a>

### 6.3 移行したバンドルの検証

CLI には、v1.0 から v2.0 への移行を確認するツールはありません。代わりに、移行した各バンドルを V2 の検証器で検証してください。

```bash
dcp verify-bundle --policy hybrid_required signed_bundle_v2.json
```

マニフェストのハッシュ、セッションバインディング、複合署名、監査チェーンを確認します。`risk_score` は 0 から 1000 の整数としてポリシー判断に属し、V2 の意図のスキーマはそれを許しません（仕様 §14.2）。

---

<a id="7-recommended-migration-order"></a>

## 7. 推奨する移行の順序

本番システムを移行するチームには、次の順序を推奨します。

1. v2.0 に対応した最新バージョンに **SDK を更新**します。
2. `allow_v1_bundles: true` で**まず検証器を更新**します。これにより、移行期間中も検証器が v1.0 と v2.0 の両方のバンドルを扱えます。
3. すべてのエージェントと人間のために**ハイブリッドな鍵ペアを生成**します。
4. `dcp_version: "2.0"`、`session_nonce`、二重の鍵エントリを含むように**アーティファクトの構築を更新**します。
5. v2.0 の署名 API を使って**複合署名に切り替え**ます。
6. 監査エントリに**二重ハッシュチェーンを加え**ます。
7. **バンドルのマニフェストの構造を実装**します。
8. **機微な意図にはハイブリッド署名で署名**します。V2 の検証器はセキュリティティアを強制します（仕様 §14.3）。支払い、機微なデータ、高い影響、またはポリシー判断の `risk_score` が 500 以上の場合、`classical_only` のバンドルは拒否されます。
9. NIST KAT による検証を含む、**完全な適合性テストを実行**します。
10. エコシステム内のすべてのエージェントが移行したら、**v1.0 のバンドルの受け入れを無効に**します。

---

<a id="8-timeline-and-support"></a>

## 8. スケジュールとサポート

| フェーズ | スケジュール | 作業 |
|-------|----------|---------|
| **準備** | 1〜2 週目 | SDK の更新、ハイブリッド鍵の生成、このガイドの確認 |
| **検証器のアップグレード** | 2〜3 週目 | v1 互換の v2.0 検証器のデプロイ |
| **エージェントの移行** | 3〜6 週目 | アーティファクトの構築の更新、複合署名への切り替え |
| **検証** | 6〜8 週目 | 適合性テストと SDK 間の相互運用テストの実行 |
| **切り替え** | 8 週目以降 | 準備ができたら `allow_v1_bundles: false` を設定 |

移行のサポート：
- GitHub の Issues または Discussions：[`dcp-ai-protocol/dcp-ai`](https://github.com/dcp-ai-protocol/dcp-ai)
- GitHub のセキュリティアドバイザリーの UI からの非公開の脆弱性報告
- [GOVERNANCE.md](../GOVERNANCE.md) に従ったメンテナーへのメール

現時点では、専用の Slack、Discord、オフィスアワーはありません。現在のサポート体制は [EARLY_ADOPTERS.md](EARLY_ADOPTERS.md) を参照してください。

---

<a id="references"></a>

## 参考資料

- [DCP-AI v2.0 の規範仕様](../spec/DCP-AI-v2.0.md)
- [DCP-04：エージェント間通信](../spec/DCP-04.md)
- [セキュリティモデル](SECURITY_MODEL.md)
- [NIST 適合性の声明](NIST_CONFORMITY.md)
- [NIST KAT のテストベクター](../tests/nist-kat/README.md)
- [技術アーキテクチャ](TECHNICAL_ARCHITECTURE.md)
