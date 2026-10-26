<sub>[English](QUICKSTART.md) · [中文](QUICKSTART.zh-CN.md) · [Español](QUICKSTART.es.md) · **日本語** · [Português](QUICKSTART.pt-BR.md)</sub>

<a id="dcp-ai-quick-start-guide"></a>

# DCP-AI クイックスタートガイド

> [英語版](QUICKSTART.md)の参考訳です（26/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

5 分以内で Digital Citizenship Protocol を使い始められます。

---

<a id="prerequisites"></a>

## 前提条件

使用する SDK に応じて次が必要です。

- **Node.js** 18 以上 — TypeScript SDK、CLI、WASM パッケージ、`@dcp-ai/*` の統合に必要です。[QUICKSTART_LANGCHAIN.md](QUICKSTART_LANGCHAIN.md) の現行の LangChain.js（v1）には Node.js 22 以上が必要です
- **Python** 3.10 以上 — Python SDK に必要です。[QUICKSTART_AGNO.md](QUICKSTART_AGNO.md) の別パッケージ `agno-dcp` には 3.11 以上が必要です
- **Go** 1.25 以上 — Go SDK に必要です
- **Rust** 安定版 — Rust のクレートに必要です

必要なのは、実際に使う言語だけです。すべての SDK が同じプロトコルを話すので、エージェントや検証器で言語が混在していてもそのまま動きます。

---

<a id="published-packages-and-this-guide"></a>

## 公開パッケージとこのガイド

TypeScript の例は公開済みの `@dcp-ai/sdk` 2.2.0、npm CLI は `@dcp-ai/cli` 2.1.0、Python は PyPI の `dcp-ai` 2.10.0 を使います。[npm](NPM_RELEASES.md)、[Python](PYTHON_RELEASE.md)、[SECURITY.md](../SECURITY.md#supported-versions) を参照してください。Go と Rust の公開は別です。ソース開発には次を使います。

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai/sdks/typescript && npm install && npm run build                  # TypeScript SDK of main
cd ../../cli && npm install --no-save --package-lock=false --ignore-scripts --install-links ../sdks/typescript
pip install -e /path/to/dcp-ai/sdks/python                                  # Python SDK of main
```

このガイドのレジストリのコマンドは、公開済みのバージョンをインストールします。

---

<a id="zero-install-shortcuts"></a>

## インストール不要の近道

何かをインストールする前に DCP の動作を見たい場合は、次を使えます。いずれも `main` ではなく、公開済みのパッケージとイメージを使います。

- **インタラクティブなプレイグラウンド：** https://docs.dcp-ai.org/playground/ — ブラウザーでアイデンティティを生成し、バンドルを構築し、署名を検証できます。
- **雛形のスターター：** `npm create @dcp-ai/langchain my-app`（または `/crewai`、`/openai`、`/express`）を実行すると、約 2 分で動くプロジェクトが手に入ります。
- **Docker の 1 行コマンド：** `docker run -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest` で、何もクローンせずにリファレンス検証サーバーを起動できます。

[プレイグラウンド](../playground/README.md)はデモです。PQ 署名はシミュレーションで、正規化と Merkle の処理も簡略化されているため、そのバンドルは SDK で検証するための証拠にはなりません。[スターターテンプレート](../templates/README.md)にも制限があります。LangChain、CrewAI、OpenAI はプレースホルダーの鍵と署名を使い、Express は構造だけを確認します。検証可能なバンドルには、以下の SDK の例を使ってください。

---

<a id="1-install-the-cli"></a>

## 1. CLI をインストールする

CLI のウィザードは試しに見て回るためのデモです。その「ML-DSA-65」鍵はシミュレーション（ランダムなバイト列）で、書き出される RPR とパスポートは署名されておらず、V2 スキーマにも合いません。検証できるアイデンティティとバンドルを作るには [§3](#3-typescript-sdk) か [§4](#4-python-sdk) に進んでください。制限の一覧は[エージェントの作成](AGENT_CREATION_AND_CERTIFICATION.md#cli-wizard-demo-only)にあります。

公開済みのバージョンを、インストールするか直接実行します。

```bash
npm install -g @dcp-ai/cli
```

```bash
npx @dcp-ai/cli init
```

チェックアウト（上記）からは、プロジェクトのディレクトリでリポジトリのウィザードを実行します：`node /path/to/dcp-ai/cli/bin/dcp-ai.js init`。

<a id="2-initialize-your-agent"></a>

## 2. エージェントを初期化する

```bash
npx @dcp-ai/cli init   # or: node /path/to/dcp-ai/cli/bin/dcp-ai.js init
```

これにより、プロジェクトに次のデモ用ファイルが作成されます。

| ファイル | 目的 |
|------|---------|
| `.dcp/config.json` | エージェントの設定とメタデータ |
| `.dcp/keys/ed25519_public.key`、`.dcp/keys/ed25519_secret.key` | Ed25519 の鍵ペア |
| `.dcp/keys/ml_dsa_65_public.key`、`.dcp/keys/ml_dsa_65_secret.key` | ポスト量子鍵を選んだ場合の、シミュレーションの「ML-DSA-65」鍵ペア（ランダムなバイト列） |
| `.dcp/identity.json` | RPR に似たレコード（未署名で、スキーマに合わない） |
| `.dcp/passport.json` | パスポートに似たレコード（未署名で、スキーマに合わない） |

秘密鍵のファイルは既定の権限（通常の umask `022` では `0644`）で書き出されます。`chmod 600 .dcp/keys/*_secret.key` を実行し、`.dcp/keys/` を `.gitignore` に追加してバージョン管理から外してください。

---

## 3. TypeScript SDK

以下の TypeScript の例は npm SDK 2.2.0 または開発用チェックアウトで動作します（[公開パッケージとこのガイド](#published-packages-and-this-guide)を参照）。

次のどちらかをインストールします。

- ソース開発用にチェックアウトからビルドした `main` の SDK：

  ```bash
  npm install /path/to/dcp-ai/sdks/typescript
  ```

- または、これらの修正と機能を含む公開済み SDK 2.2.0：

  ```bash
  npm install @dcp-ai/sdk@^2.2.0
  ```

<a id="create-and-sign-a-bundle-v1--ed25519"></a>
<a id="create-and-sign-a-bundle-v1-ed25519"></a>

### バンドルを作成して署名する（V1 — Ed25519）

RPR とパスポートは、それぞれ `signature` フィールドを除いたオブジェクトに対して署名されます。`verifySignedBundle` はバンドルの署名、ハッシュ、チェーンを確認し、内部の署名は別に確認します。

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

<a id="verify-a-bundle"></a>

### バンドルを検証する

```typescript
import { readFileSync } from 'node:fs';
import { getDefaultRegistry, registerDefaultProviders, verifySignedBundleV2 } from '@dcp-ai/sdk';

registerDefaultProviders();
const signedBundle = JSON.parse(readFileSync('bundle.signed.json', 'utf8'));
const result = await verifySignedBundleV2(signedBundle, getDefaultRegistry());
console.log(result.verified, result.errors);
```

<a id="v2--post-quantum-hybrid-signatures"></a>
<a id="v2-post-quantum-hybrid-signatures"></a>

### V2 — ポスト量子のハイブリッド署名

各アーティファクトは、そのドメイン分離コンテキストのもとで Ed25519 + ML-DSA-65 により署名された `SignedPayload` です。プリンシパルは RPR とマニフェストに、エージェントはパスポート、意図、ポリシー判断に署名します。

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

---

## 4. Python SDK

次のどちらかをインストールします。

- SDK 開発用のチェックアウト：

  ```bash
  pip install -e /path/to/dcp-ai/sdks/python
  ```

- または、ここで説明する修正と API を含む公開済みの 2.10.0：

  ```bash
  pip install "dcp-ai>=2.10.0,<3"
  ```

<a id="create-and-verify-a-bundle"></a>

### バンドルを作成して検証する

```python
from datetime import datetime, timezone

from dcp_ai import (
    AgentPassport,
    AuditEvidence,
    BundleBuilder,
    Intent,
    PolicyDecision,
    ResponsiblePrincipalRecord,
    generate_keypair,
    sign_bundle,
    sign_object,
    verify_object,
    verify_signed_bundle,
)

now = datetime.now(timezone.utc).isoformat()
principal_keys = generate_keypair()
agent_keys = generate_keypair()

# 1. The responsible principal, signed with the principal's key (the object without "signature")
rpr_body = {
    "dcp_version": "1.0", "human_id": "human:example-001", "legal_name": "Example Principal",
    "entity_type": "natural_person", "jurisdiction": "ES", "liability_mode": "owner_responsible",
    "override_rights": True, "issued_at": now, "expires_at": None, "contact": None,
}
rpr = {**rpr_body, "signature": sign_object(rpr_body, principal_keys["secret_key_b64"])}

# 2. The agent passport, signed with the agent's key (the object without "signature")
passport_body = {
    "dcp_version": "1.0", "agent_id": "agent:example-001", "public_key": agent_keys["public_key_b64"],
    "principal_binding_reference": "human:example-001", "capabilities": ["browse", "api_call"],
    "risk_tier": "low", "created_at": now, "status": "active",
}
passport = {**passport_body, "signature": sign_object(passport_body, agent_keys["secret_key_b64"])}

# 3. Intent, policy decision and one audit entry
intent = Intent(
    intent_id="intent:example-001", agent_id="agent:example-001", human_id="human:example-001",
    timestamp=now, action_type="api_call", target={"channel": "api", "domain": "api.example.com"},
    data_classes=["none"], estimated_impact="low", requires_consent=False,
)
policy = PolicyDecision(
    intent_id="intent:example-001", decision="approve", risk_score=0.05, reasons=["low-impact call"],
)
bundle = (
    BundleBuilder()
    .responsible_principal_record(ResponsiblePrincipalRecord(**rpr))
    .agent_passport(AgentPassport(**passport))
    .intent(intent)
    .policy_decision(policy)
    .create_audit_entry(
        audit_id="audit:example-001", timestamp=now, agent_id="agent:example-001",
        human_id="human:example-001", intent_id="intent:example-001", policy_decision="approved",
        outcome="call_completed", evidence=AuditEvidence(tool="http", result_ref=None),
    )
    .build()
)

# 4. Sign with the principal's key and verify against the principal's public key
signed = sign_bundle(bundle, principal_keys["secret_key_b64"])
print(verify_signed_bundle(signed, principal_keys["public_key_b64"]))  # {'verified': True}

# 5. The inner signatures, over the same objects without "signature"
print(verify_object(rpr_body, rpr["signature"], principal_keys["public_key_b64"]))  # True
print(verify_object(passport_body, passport["signature"], agent_keys["public_key_b64"]))  # True
```

Python での V2 バンドルについては [V2 Bundles](../sdks/python/README.md#v2-bundles) を参照してください。

---

<a id="5-security-tiers"></a>

## 5. セキュリティティア

DCP は、意図のリスクプロファイルに基づいて暗号上のセキュリティティアを自動的に選びます。

| ティア | 名前 | 検証モード | PQ チェックポイントの間隔 | 条件 |
|------|------|------------------|----------------------|---------|
| 0 | **Routine** | クラシカルのみ（Ed25519） | 50 イベントごと | 以下のどの条件にも当てはまらない |
| 1 | **Standard** | ハイブリッド推奨 | 10 イベントごと | リスクスコア 200〜499、`estimated_impact: medium` |
| 2 | **Elevated** | ハイブリッド必須 | すべてのイベント | リスクスコア 500〜799、個人情報・金融・健康データ、支払い、`estimated_impact: high`、未知の値 |
| 3 | **Maximum** | ハイブリッド必須 | すべてのイベント | リスクスコア 800 以上、認証情報、子どものデータ |

リスクスコアはポリシー判断の `risk_score` です（仕様 §14.2）。

```typescript
import { computeSecurityTier, tierToVerificationMode } from '@dcp-ai/sdk';

const tier = computeSecurityTier(intent, policyDecision);
const mode = tierToVerificationMode(tier);
// tier: 'elevated', mode: 'hybrid_required'
```

---

<a id="6-telemetry--observability"></a>
<a id="6-telemetry-observability"></a>

## 6. テレメトリーとオブザーバビリティ

```typescript
import { dcpTelemetry } from '@dcp-ai/sdk';

dcpTelemetry.init({
  serviceName: 'my-agent',
  enabled: true,
  exporterType: 'console', // or 'otlp'
});

// Automatic span tracking
const spanId = dcpTelemetry.startSpan('sign_bundle', { tier: 'elevated' });
// ... perform operation ...
dcpTelemetry.endSpan(spanId);

// Record metrics
dcpTelemetry.recordSignLatency(12.5, 'ed25519');

// Get summary
const summary = dcpTelemetry.getMetricsSummary();
console.log(summary.sign.p95); // p95 sign latency in ms
```

---

<a id="7-agent-to-agent-a2a-communication"></a>

## 7. エージェント間（A2A）通信

```typescript
import { createHello, createWelcome, createSession, encryptMessage } from '@dcp-ai/sdk';

// Agent A initiates
const hello = createHello(bundleA, kemPublicKeyB64, ['api_call'], 'standard');

// Agent B responds
const welcome = createWelcome(bundleB, kemPubB, kemCiphertextB64, 'standard');

// Establish encrypted session
const session = createSession(sessionId, sessionKey, 'agent-a', 'agent-b', 'standard');

// Send encrypted messages
const encrypted = encryptMessage(session, { action: 'transfer', amount: 100 });
```

---

<a id="other-sdks"></a>

## ほかの SDK

### Go

```bash
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@latest   # the latest tagged version; @main for main
```

```go
import dcp "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp"

canonical, _ := dcp.Canonicalize(map[string]string{"b": "2", "a": "1"})
// produces {"a":"1","b":"2"}
```

### Rust

```bash
cargo add dcp-ai   # the published crate; for main, see the Rust SDK's Release status
```

ML-DSA-65、ML-KEM-768、SLH-DSA-192f、Ed25519 のプロバイダーは `dcp_ai::providers::*` にあります。すべての API は [docs.rs の `dcp-ai` クレートのドキュメント](https://docs.rs/dcp-ai)を参照してください。

<a id="webassembly-browser"></a>

### WebAssembly（ブラウザー）

```bash
npm install @dcp-ai/wasm@^2.1.0   # the published version; for main, see the WASM SDK's Release status
```

Rust SDK の基本機能をブラウザーと Node.js に公開します。Node.js では、`initDcp()` は `.wasm` ファイルを `data:` URL として必要とします。[初期化](../sdks/wasm/README.md#initialization-browser-and-nodejs)を参照してください。

---

<a id="run-the-reference-services"></a>

## リファレンスサービスを実行する

仕様が参照する 4 つのサービス（検証サーバー、anchor、透明性ログ、失効レジストリ）はすべて Docker イメージとして提供されています。空のディレクトリから次を実行します。

```bash
docker run -d -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest
docker run -d -p 3001:3001 ghcr.io/dcp-ai-protocol/dcp-ai/anchor:latest
docker run -d -p 3002:3002 ghcr.io/dcp-ai-protocol/dcp-ai/transparency-log:latest
docker run -d -p 3003:3003 ghcr.io/dcp-ai-protocol/dcp-ai/revocation:latest
```

マネージドなホスティングについては、[`deploy/fly/` の Fly.io の設定](../deploy/)と、Cloud Run / Railway / Compose という選択肢を扱う[デプロイガイド](../deploy/README.md)を参照してください。

---

<a id="next-steps"></a>

## 次のステップ

- **[LangChain との統合](./QUICKSTART_LANGCHAIN.md)** — LangChain のエージェントに DCP を追加する
- **[CrewAI との統合](./QUICKSTART_CREWAI.md)** — CrewAI のクルーに DCP を追加する
- **[OpenAI との統合](./QUICKSTART_OPENAI.md)** — OpenAI の関数呼び出しに DCP を追加する
- **[Express ミドルウェア](./QUICKSTART_EXPRESS.md)** — Express の API で DCP バンドルを検証する
- **[API リファレンス](./API_REFERENCE.md)** — SDK の完全なドキュメント
- **[プロトコル仕様](../spec/)** — DCP v2.0 の完全な仕様
- **[セキュリティモデル](./SECURITY_MODEL.md)** — 脅威モデルとセキュリティアーキテクチャ
- **[オペレーターガイド](./OPERATOR_GUIDE.md)** — 本番環境での検証サービスとアンカリングサービスの運用
