<sub>[English](QUICKSTART_EXPRESS.md) · [中文](QUICKSTART_EXPRESS.zh-CN.md) · [Español](QUICKSTART_EXPRESS.es.md) · **日本語** · [Português](QUICKSTART_EXPRESS.pt-BR.md)</sub>

<a id="dcp-ai--express-quick-start"></a>
<a id="dcp-ai-express-quick-start"></a>

# DCP-AI + Express クイックスタート

> [英語版](QUICKSTART_EXPRESS.md)の参考訳です（25/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

`@dcp-ai/express` ミドルウェアを使って、Express.js の API で DCP の署名済みバンドルを検証します。

---

<a id="installation"></a>

## インストール

> **バージョン。** 以下のレジストリからのインストールでは、公開済みの `@dcp-ai/express` と `@dcp-ai/sdk` が入ります（2026 年 10 月 25 日時点で npm の
> `@dcp-ai/sdk` の `latest` は 2.1.1）。このガイドは `main` に従っており、そこではミドルウェアに
> アドミッション（信頼済みのプリンシパルと `strict-v1`、未リリース）も備わっています。これを使うには、`sdks/typescript` と
> `integrations/express` をチェックアウトからビルドしてください（[Express の README](../integrations/express/README.md) を参照）。

```bash
npm install @dcp-ai/express @dcp-ai/sdk express
```

<a id="zero-config-scaffold-alternative"></a>

### 設定不要の雛形（代替手段）

```bash
npm create @dcp-ai/express my-api
cd my-api
npm install
```

ディスカバリーのエンドポイントと、サンプルのルートでバンドルの構造だけを確認するミドルウェアを備えた、実行可能な `index.js` を生成します。
このミドルウェアは署名を一切検証しないため、偽造または改変されたバンドルも通ります（
[templates/express](../templates/express/README.md) を参照）。署名済みのバンドルを検証するには、以下のように `@dcp-ai/express` を使ってください。

<a id="python-equivalent-fastapi"></a>

### Python での同等の方法（FastAPI）

サービスが Express ではなく FastAPI の場合は、Python のブリッジを使います。この例は `main` に従っているので、
Python SDK はチェックアウトからインストールしてください。PyPI の `dcp-ai` 2.9.0 の FastAPI ミドルウェアは V2 バンドルの構造を確認しますが、
署名は検証しないため、偽造された V2 バンドルも通ってしまいます。V2 バンドルについては 2.9.0 に頼らないでください（
[FastAPI の README](../integrations/fastapi/README.md) を参照）。

```bash
pip install "/path/to/dcp-ai/sdks/python[fastapi]"
```

```python
from fastapi import FastAPI, Depends
from dcp_ai.fastapi import DCPVerifyMiddleware, require_dcp

app = FastAPI()
app.add_middleware(DCPVerifyMiddleware, require_bundle=True)

@app.post("/agent/action")
async def agent_action(agent=Depends(require_dcp)):
    # agent.passport / agent.intent / agent.session_nonce are populated
    return {"ok": True, "agent": agent.agent_id}
```

---

<a id="how-dcp-integrates-with-express"></a>

## DCP と Express の統合のしかた

DCP の Express ミドルウェアは、受信したリクエストから署名済みのバンドルを取り出して検証します。検証されたエージェントのアイデンティティは、後続の処理で使えるようにリクエストオブジェクトに付加されます。

```
Client (AI Agent)                    Express Server
  │                                      │
  │─── Request + DCP Bundle ────────────►│
  │    (body.signed_bundle, recommended; │
  │     or X-DCP-Bundle if it fits)      │
  │                                      ├─ dcpVerify() middleware
  │                                      │  ├─ Parse bundle (V1 or V2)
  │                                      │  ├─ Verify signatures
  │                                      │  ├─ Check session binding
  │                                      │  ├─ Optional revocation check
  │                                      │  └─ Attach req.dcpAgent
  │                                      │
  │◄── Response ────────────────────────│
```

---

<a id="complete-working-example"></a>

## 動作する完全な例

```typescript
import express from 'express';
import { dcpVerify, type DCPAgent } from '@dcp-ai/express';

const app = express();
// Bundles travel in the JSON body: a budget sized for them (see "Sending DCP Bundles").
app.use(express.json({ limit: '64kb' }));

// 1. Basic DCP verification — require a valid bundle on /api and every route under it
//    (a path prefix: works on Express 4 and 5, unlike a '/api/*' pattern, which Express 5 rejects)
app.use('/api', dcpVerify({ requireBundle: true }));

// 2. Access verified agent identity in your handlers (POST: the bundle comes in the body)
app.post('/api/data', (req: express.Request & { dcpAgent?: DCPAgent }, res) => {
  const agent = req.dcpAgent!;
  
  res.json({
    message: `Hello, agent ${agent.agentId}`,
    humanPrincipal: agent.humanId,
    capabilities: agent.capabilities,
    riskTier: agent.riskTier,
    dcpVersion: agent.dcpVersion,
  });
});

// 3. Capability-based access control
app.post('/api/payments', (req: express.Request & { dcpAgent?: DCPAgent }, res) => {
  const agent = req.dcpAgent!;

  if (!agent.capabilities.includes('payments')) {
    return res.status(403).json({
      error: 'Agent lacks payments capability',
      agentId: agent.agentId,
    });
  }

  // Process payment...
  res.json({ status: 'ok' });
});

app.listen(3000, () => console.log('DCP-protected API on :3000'));
```

---

<a id="configuration-options"></a>

## 設定オプション

```typescript
// Fragment: `app` as in the Complete Working Example
import { dcpVerify } from '@dcp-ai/express';

app.use(dcpVerify({
  // Require a DCP bundle (403 if missing). Default: true
  requireBundle: true,

  // Header the bundle may be sent in, read before body.signed_bundle. Default: 'x-dcp-bundle'.
  // Only for bundles within the header limits (Node: 16 KiB for all headers); hybrid ones go in the body.
  headerName: 'x-dcp-bundle',

  // Check agent revocation status against a service. Default: false
  checkRevocation: true,
  revocationServiceUrl: 'http://localhost:3003',
  // Refuse the request (403) when the status cannot be read. Default: false, which lets it through (fail open)
  revocationFailClosed: true,

  // Cache verification results (seconds). Default: 0 (no cache)
  cacheTtlSeconds: 60,

  // V2: Require hybrid composite signatures
  requireHybrid: true,

  // V2: Fine-grained verifier policy
  verifierPolicy: {
    default_mode: 'hybrid_required',
    require_session_binding: true,
    require_composite_binding: true,
  },

  // Custom failure handler
  onFailure: (req, res, errors) => {
    res.status(403).json({ verified: false, errors, hint: 'Send the bundle in body.signed_bundle' });
  },
}));
```

`main`（未リリース）では、`trustedPrincipals`、`profile`、`revocationSource`、`tenant` がアドミッションを加えます。ルートに届くのは、
信頼するプリンシパルのために、その信頼済みの鍵で署名されたバンドルだけです。キャッシュ、監視、切断のオプションを含むすべてのオプションについては、
[ADMISSION.md](ADMISSION.md) と [Express の README](../integrations/express/README.md) を
参照してください。

---

<a id="sending-dcp-bundles-from-a-client"></a>

## クライアントから DCP バンドルを送る

```typescript
// Fragment: `signed` is a signed V1 or V2 bundle, built as in the TypeScript SDK's Quick Start
// (../sdks/typescript/README.md).

// Send via body (recommended, and the way for hybrid V2 bundles)
const response = await fetch('http://localhost:3000/api/data', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    signed_bundle: signed,
    // ... other body fields
  }),
});

// Or via header, only for a bundle that fits the header limits of the server and every proxy
const response2 = await fetch('http://localhost:3000/api/data', {
  method: 'POST',
  headers: {
    'X-DCP-Bundle': JSON.stringify(signed),
    'Content-Type': 'application/json',
  },
});
```

ハイブリッドな V2 バンドル（Ed25519 + ML-DSA-65）は約 33 KB ですが、Node が既定で受け付けるリクエストヘッダーは
16 KiB です。`X-DCP-Bundle` に入れると、Express が動く前に `431` で拒否されます。そのためにヘッダーの上限を
引き上げないでください。ボディで送ります。ボディパーサーの `limit` はあなたの予算であり、デプロイ上の選択であって
プロトコルの上限ではありません。最大のバンドルを測り、余裕を持たせ、前段のプロキシも少なくとも同じだけ
許容するようにしてください。それより大きいボディは、ミドルウェアの前に `413` になります。
`integrations/express/examples/strict-v1-body.mjs` は、`strict-v1` のアドミッションを使って、実際の HTTP で
全体の経路を実行します。

---

<a id="v2-bundle-verification"></a>

## V2 バンドルの検証

ミドルウェアは V1 と V2 のバンドルを自動的に判別します。V2 バンドルが受け入れられるのは、ミドルウェアの検証器のポリシー（SDK の `DEFAULT_VERIFIER_POLICY` に `verifierPolicy` を重ね、次に `requireHybrid` を適用したもの）のもとで、`@dcp-ai/sdk` の `verifySignedBundleV2` が受け入れた場合だけです。検証内容は次のとおりです。

- **複合署名** — RPR の `binding_keys` を使った、マニフェストに対するプリンシパルの Ed25519 + ML-DSA-65 署名と、各アーティファクト自身の署名。モードは、パスポートのリスクティアに対するポリシーのモードと、意図のセキュリティティアのモードのうち厳しいほう。存在する PQ 署名は検証に通らなければならない
- **マニフェストの完全性** — すべてのアーティファクトのハッシュと監査のマークルルートが一致する
- **セッションバインディング** — すべてのアーティファクトでのセッション nonce の一貫性と、セッションの有効期限
- **監査のハッシュチェーン**と鍵の有効性（失効した鍵や期限切れの鍵）

V1 バンドルにはポスト量子署名がないため、受け入れられるのはクラシカルのみのバンドルが受け入れられる場合に限られます（VERIFICATION.md V2-10）。既定のポリシーでは、意図が routine または standard の V1 バンドルは通り、支払い、機微なデータ、高い推定影響、0.5 以上のリスクスコアを伴うものは拒否されます。`requireHybrid` と `allow_v1_bundles: false` は、すべての V1 バンドルを拒否します。

検証済みのバンドルは内部的に一貫しており、それ自身が列挙する鍵で署名されています。それはプリンシパルが誰であるかを証明しません。信頼するプリンシパルからのバンドルだけを受け入れるには、アドミッションを設定してください（`trustedPrincipals`、未リリース。[ADMISSION.md](ADMISSION.md) を参照）。リプレイに対するオーディエンスのバインディングについては、パッケージの README を参照してください。

```typescript
// Fragment: continues the Complete Working Example (`app`, `express`, `DCPAgent`)
// V2-specific agent properties
app.get('/api/secure', (req: express.Request & { dcpAgent?: DCPAgent }, res) => {
  const agent = req.dcpAgent!;

  if (agent.dcpVersion === '2.0') {
    console.log('Key IDs:', agent.kids);
    console.log('Session:', agent.sessionNonce);
  }

  res.json({ verified: true, version: agent.dcpVersion });
});
```

---

<a id="dcpagent-interface"></a>

## DCPAgent インターフェース

`req.dcpAgent` に付加される、検証済みのエージェントのアイデンティティ：

```typescript
interface DCPAgent {
  agentId: string;
  humanId: string;
  publicKey: string;
  capabilities: string[];
  riskTier: string;
  status: string;
  dcpVersion: '1.0' | '2.0';
  /** V2: Key identifiers of the passport keys. */
  kids?: string[];
  /** V2: Session nonce for the bundle. */
  sessionNonce?: string;
  /** DCP-05: Agent lifecycle state. */
  lifecycleState?: string;
  /** DCP-09: Active delegation mandate ID. */
  mandateId?: string;
  /** V2: Warnings of the SDK verifier for an accepted bundle (e.g. a classical-only signature). */
  warnings?: string[];
  /** V2: The verification mode the bundle was verified in. */
  verificationMode?: VerificationMode;
  /** V2: The security tier of the bundle's intent and policy decision (spec §14.2). */
  securityTier?: SecurityTier;
  /** With trustedPrincipals: the admission of the bundle (spec/profiles/admission § 5.2). */
  admission?: {
    admitted: true;
    principalTrust: PrincipalTrust;
    profile: 'strict-v1' | null;
    profileCompliance: ProfileCompliance;
    /** The decision the bundle records (approve, escalate, block): evidence, not a permission. */
    recordedDecision: string | null;
    trustSetVersion: string | null;
    /** Always false: admitting the evidence does not authorize an action. */
    actionAuthorized: false;
  };
}
```

---

<a id="next-steps"></a>

## 次のステップ

- **[メインのクイックスタート](./QUICKSTART.md)** — SDK の基本的な使い方
- **[LangChain との統合](./QUICKSTART_LANGCHAIN.md)** — LangChain のツールを包む
- **[API リファレンス](./API_REFERENCE.md)** — SDK の完全なドキュメント
