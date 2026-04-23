<sub>[English](QUICKSTART.md) · [中文](QUICKSTART.zh-CN.md) · [Español](QUICKSTART.es.md) · **日本語** · [Português](QUICKSTART.pt-BR.md)</sub>

# DCP-AI クイックスタートガイド

デジタル市民権プロトコル (Digital Citizenship Protocol) を5分以内に動かし始めましょう。

---

## 前提条件

使用するSDKに応じて以下が必要です。

- **Node.js** 18以上 — TypeScript SDK、CLI、WASMパッケージ、および任意の `@dcp-ai/*` 統合に必要
- **Python** 3.10以上 — Python SDKに必要
- **Go** 1.22以上 — Go SDKに必要
- **Rust** stable — Rust crateに必要

ビルドに使う予定の言語だけが必要です。すべてのSDKは同じプロトコルを話すため、エージェントと検証者の間で言語を混在させる構成もそのまま動作します。

---

## ゼロインストールのショートカット

何もインストールする前にDCPを動かしてみたいですか?

- **対話型プレイグラウンド:** https://dcp-ai.org/playground/ — ブラウザ内でアイデンティティを生成し、バンドルを構築し、署名を検証できます。
- **スキャフォルド済みスターター:** `npm create @dcp-ai/langchain my-app` (または `/crewai`、`/openai`、`/express`) を実行すれば、約2分で動くプロジェクトが手に入ります。
- **Docker 1行:** `docker run -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest` を実行するだけで、何もクローンせずにリファレンス検証サーバーが起動します。

---

## 1. CLIをインストール

```bash
npm install -g @dcp-ai/cli
# または npx で直接実行
npx @dcp-ai/cli init
```

## 2. エージェントを初期化

```bash
npx @dcp-ai/cli init
```

これにより、プロジェクト内に以下のファイルが作成されます。

| ファイル | 用途 |
|------|---------|
| `.dcp/config.json` | エージェントの構成とメタデータ |
| `.dcp/keys/` | Ed25519 + ML-DSA-65 の鍵ペア |
| `.dcp/identity.json` | 責任主体記録 (Responsible Principal Record、RPR) |
| `.dcp/passport.json` | エージェントパスポート |

---

## 3. TypeScript SDK

```bash
npm install @dcp-ai/sdk
```

### バンドルを作成して署名する (V1 — Ed25519)

```typescript
import {
  generateKeypair,
  signObject,
  verifyObject,
  BundleBuilder,
  signBundle,
  verifySignedBundle,
} from '@dcp-ai/sdk';

// Generate an Ed25519 keypair
const keys = generateKeypair();

// Define artifacts
const hbr = {
  dcp_version: '1.0',
  human_id: 'human-001',
  legal_name: 'Alice Johnson',
  entity_type: 'natural_person',
  jurisdiction: 'US-CA',
  liability_mode: 'owner_responsible',
  override_rights: true,
  public_key: keys.publicKeyB64,
  issued_at: new Date().toISOString(),
  expires_at: null,
  contact: 'alice@example.com',
};

const passport = {
  dcp_version: '1.0',
  agent_id: 'agent-001',
  human_id: 'human-001',
  public_key: keys.publicKeyB64,
  capabilities: ['browse', 'api_call'],
  risk_tier: 'low',
  created_at: new Date().toISOString(),
  status: 'active',
};

const intent = {
  dcp_version: '1.0',
  intent_id: 'intent-001',
  agent_id: 'agent-001',
  human_id: 'human-001',
  timestamp: new Date().toISOString(),
  action_type: 'api_call',
  target: { channel: 'api', domain: 'api.example.com' },
  data_classes: ['none'],
  estimated_impact: 'low',
  requires_consent: false,
};

const policy = {
  dcp_version: '1.0',
  intent_id: 'intent-001',
  decision: 'approve',
  risk_score: 15,
  reasons: ['Low risk action'],
  required_confirmation: null,
  applied_policy_hash: 'sha256:abc123',
  timestamp: new Date().toISOString(),
};

const audit = {
  dcp_version: '1.0',
  audit_id: 'audit-001',
  prev_hash: '0'.repeat(64),
  timestamp: new Date().toISOString(),
  agent_id: 'agent-001',
  human_id: 'human-001',
  intent_id: 'intent-001',
  intent_hash: signObject(intent, keys.secretKeyB64),
  policy_decision: 'approved',
  outcome: 'API call completed successfully',
  evidence: { tool: 'fetch', result_ref: 'https://api.example.com/data' },
};

// Build the bundle
const bundle = new BundleBuilder()
  .responsiblePrincipalRecord(hbr)
  .agentPassport(passport)
  .intent(intent)
  .policyDecision(policy)
  .addAuditEntry(audit)
  .build();

// Sign the bundle
const signed = signBundle(bundle, keys.secretKeyB64);

// Verify the bundle
const result = verifySignedBundle(signed);
console.log('Verified:', result.verified); // true
```

### バンドルを検証する

```typescript
import { verifySignedBundle } from '@dcp-ai/sdk';

const result = verifySignedBundle(signedBundle);

if (result.verified) {
  console.log('Bundle is valid');
} else {
  console.error('Verification failed:', result.errors);
}
```

### V2 — 耐量子ハイブリッド署名

```typescript
import {
  registerDefaultProviders,
  getDefaultRegistry,
  compositeSign,
  compositeVerify,
  BundleBuilderV2,
  computeSecurityTier,
  type CompositeKeyPair,
} from '@dcp-ai/sdk';

// Register Ed25519 + ML-DSA-65 providers
registerDefaultProviders();
const registry = getDefaultRegistry();

// Generate composite keypair
const ed = await registry.getSigner('ed25519').generateKeyPair();
const pq = await registry.getSigner('ml-dsa-65').generateKeyPair();

const keys: CompositeKeyPair = {
  classical: { kid: 'ed-01', alg: 'ed25519', ...ed },
  pq: { kid: 'pq-01', alg: 'ml-dsa-65', ...pq },
};

// Compute the security tier for your intent
const tier = computeSecurityTier(intentV2);
console.log('Security tier:', tier); // 'routine' | 'standard' | 'elevated' | 'maximum'

// Build a V2 bundle with the fluent builder
const bundle = new BundleBuilderV2(sessionNonce)
  .responsiblePrincipalRecord(signedHbr)
  .agentPassport(signedPassport)
  .intent(signedIntent)
  .policyDecision(signedPolicy)
  .addAuditEntries(auditEvents)
  .enableDualHash()
  .build();
```

---

## 4. Python SDK

```bash
pip install dcp-ai
```

### バンドルを作成して検証する

```python
from dcp_ai import (
    generate_keypair,
    sign_object,
    verify_object,
    build_bundle,
    sign_bundle,
    verify_signed_bundle,
)

# Generate Ed25519 keypair
keys = generate_keypair()

# Define artifacts
hbr = {
    "dcp_version": "1.0",
    "human_id": "human-001",
    "legal_name": "Alice Johnson",
    "entity_type": "natural_person",
    "jurisdiction": "US-CA",
    "liability_mode": "owner_responsible",
    "override_rights": True,
    "public_key": keys["public_key_b64"],
    "issued_at": "2025-01-01T00:00:00Z",
    "expires_at": None,
    "contact": "alice@example.com",
}

passport = {
    "dcp_version": "1.0",
    "agent_id": "agent-001",
    "human_id": "human-001",
    "public_key": keys["public_key_b64"],
    "capabilities": ["browse", "api_call"],
    "risk_tier": "low",
    "created_at": "2025-01-01T00:00:00Z",
    "status": "active",
}

# Sign and build
signed = sign_bundle(
    build_bundle(hbr, passport, intent, policy, [audit]),
    keys["secret_key_b64"],
)

# Verify
result = verify_signed_bundle(signed)
assert result["verified"] is True
```

---

## 5. セキュリティティア

DCPは意図のリスクプロファイルに基づいて、暗号セキュリティティアを自動的に選択します。

| ティア | 名前 | 検証モード | 耐量子チェックポイント間隔 | トリガー |
|------|------|------------------|----------------------|---------|
| 0 | **Routine** | 古典のみ (Ed25519) | 50イベントごと | リスクスコア < 200 |
| 1 | **Standard** | ハイブリッド推奨 | 10イベントごと | リスクスコア 200–499 |
| 2 | **Elevated** | ハイブリッド必須 | 毎イベント | リスクスコア 500–799、PII、支払い |
| 3 | **Maximum** | ハイブリッド必須 + 即時検証 | 毎イベント | リスクスコア ≥ 800、認証情報 |

```typescript
import { computeSecurityTier, tierToVerificationMode } from '@dcp-ai/sdk';

const tier = computeSecurityTier(intent);
const mode = tierToVerificationMode(tier);
// tier: 'elevated', mode: 'hybrid_required'
```

---

## 6. テレメトリーと可観測性

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

## 7. エージェント間 (A2A) 通信

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

## 他のSDK

### Go

```bash
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.0.0
```

```go
import dcp "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp"

canonical, _ := dcp.Canonicalize(map[string]string{"b": "2", "a": "1"})
// produces {"a":"1","b":"2"}
```

### Rust

```bash
cargo add dcp-ai
```

ML-DSA-65、ML-KEM-768、SLH-DSA-192f、Ed25519 のプロバイダは `dcp_ai::providers::*` にあります。完全なAPIについては [`dcp-ai` crateのdocs.rsドキュメント](https://docs.rs/dcp-ai) を参照してください。

### WebAssembly (ブラウザ)

```bash
npm install @dcp-ai/wasm
```

同じRust暗号プリミティブを任意のブラウザJSコンテキストに公開します。[プレイグラウンド](https://dcp-ai.org/playground/) はこのパッケージのリファレンス利用例です。

---

## リファレンスサービスを実行する

仕様で参照される4つのサービス (検証サーバー、アンカー、透明性ログ、失効レジストリ) はすべてDockerイメージとして提供されています。空のディレクトリから以下を実行します。

```bash
docker run -d -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest
docker run -d -p 3001:3001 ghcr.io/dcp-ai-protocol/dcp-ai/anchor:latest
docker run -d -p 3002:3002 ghcr.io/dcp-ai-protocol/dcp-ai/transparency-log:latest
docker run -d -p 3003:3003 ghcr.io/dcp-ai-protocol/dcp-ai/revocation:latest
```

マネージドホスティングについては、[`deploy/fly/` のFly.io構成](../deploy/) と、Cloud Run / Railway / Composeの代替方法については [デプロイガイド](../deploy/README.md) を参照してください。

---

## 次のステップ

- **[LangChain統合](./QUICKSTART_LANGCHAIN.md)** — LangChainエージェントにDCPを追加
- **[CrewAI統合](./QUICKSTART_CREWAI.md)** — CrewAIクルーにDCPを追加
- **[OpenAI統合](./QUICKSTART_OPENAI.md)** — OpenAI関数呼び出しにDCPを追加
- **[Expressミドルウェア](./QUICKSTART_EXPRESS.md)** — Express APIでDCPバンドルを検証
- **[APIリファレンス](./API_REFERENCE.md)** — 完全なSDKドキュメント
- **[プロトコル仕様](../spec/)** — DCP v2.0完全仕様
- **[セキュリティモデル](./SECURITY_MODEL.md)** — 脅威モデルとセキュリティアーキテクチャ
- **[オペレータガイド](./OPERATOR_GUIDE.md)** — 本番環境で検証サービスとアンカリングサービスを運用する方法
