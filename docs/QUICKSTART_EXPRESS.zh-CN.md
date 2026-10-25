<sub>[English](QUICKSTART_EXPRESS.md) · **中文** · [Español](QUICKSTART_EXPRESS.es.md) · [日本語](QUICKSTART_EXPRESS.ja.md) · [Português](QUICKSTART_EXPRESS.pt-BR.md)</sub>

<a id="dcp-ai--express-quick-start"></a>
<a id="dcp-ai-express-quick-start"></a>

# DCP-AI + Express 快速开始

> 本文是[英文版](QUICKSTART_EXPRESS.md)的参考译文，更新于 25/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

使用 `@dcp-ai/express` 中间件，在你的 Express.js API 中验证 DCP 已签名 bundle。

---

<a id="installation"></a>

## 安装

> **版本。** 下面从注册表安装得到的是已发布的 `@dcp-ai/express` 和 `@dcp-ai/sdk`（2026 年 10 月 25 日 npm 上
> `@dcp-ai/sdk` 的 `latest` 为 2.1.1）。本指南以 `main` 为准，其中的中间件还具备
> 准入（受信任的委托人和 `strict-v1`，未发布）；要使用它，请从检出副本构建 `sdks/typescript` 和
> `integrations/express`（参见 [Express README](../integrations/express/README.md)）。

```bash
npm install @dcp-ai/express @dcp-ai/sdk express
```

<a id="zero-config-scaffold-alternative"></a>

### 零配置脚手架（替代方案）

```bash
npm create @dcp-ai/express my-api
cd my-api
npm install
```

生成一个可运行的 `index.js`，其中有发现端点，以及在一个示例路由上只检查 bundle
结构的中间件：它不验证任何签名，因此伪造或被篡改的 bundle 也能通过（参见
[templates/express](../templates/express/README.md)）。要验证已签名的 bundle，请按下文使用 `@dcp-ai/express`。

<a id="python-equivalent-fastapi"></a>

### Python 中的等效做法（FastAPI）

如果你的服务是 FastAPI 而不是 Express，请使用 Python 桥接。此示例以 `main` 为准：请从检出副本安装
Python SDK。PyPI 上 `dcp-ai` 2.9.0 的 FastAPI 中间件会检查 V2 bundle 的结构，但
不验证其签名，因此伪造的 V2 bundle 也能通过；对于 V2 bundle，不要依赖 2.9.0（参见
[FastAPI README](../integrations/fastapi/README.md)）。

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

## DCP 如何与 Express 集成

DCP Express 中间件从传入请求中提取并验证已签名的 bundle。验证后的智能体身份会附加到请求对象上，供后续处理使用。

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

## 完整的可运行示例

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

## 配置选项

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

在 `main` 上（未发布），`trustedPrincipals`、`profile`、`revocationSource` 和 `tenant` 加入了准入：只有为你所信任的委托人、
用其受信任的密钥签署的 bundle 才能到达路由。所有选项（包括缓存、监管和
断开连接选项）参见 [ADMISSION.md](ADMISSION.md) 和
[Express README](../integrations/express/README.md)。

---

<a id="sending-dcp-bundles-from-a-client"></a>

## 从客户端发送 DCP bundle

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

一个混合 V2 bundle（Ed25519 + ML-DSA-65）约 33 KB，而 Node 默认只接受 16 KiB 的请求
头：放在 `X-DCP-Bundle` 中会在 Express 运行之前以 `431` 被拒绝。不要为此提高
请求头限制；请把它放在请求体中发送。请求体解析器的 `limit` 是你的预算，是你的部署所做的选择，
而不是协议限制：测量你最大的 bundle，留出余量，并让前面的
任何代理至少同样宽松。更大的请求体会在中间件之前得到 `413`。
`integrations/express/examples/strict-v1-body.mjs` 通过真实的 HTTP，在
`strict-v1` 准入下运行完整路径。

---

<a id="v2-bundle-verification"></a>

## V2 bundle 验证

中间件会自动识别 V1 和 V2 bundle。只有当 `@dcp-ai/sdk` 的 `verifySignedBundleV2` 在中间件的验证器策略（在 SDK 的 `DEFAULT_VERIFIER_POLICY` 之上叠加 `verifierPolicy`，再应用 `requireHybrid`）下接受某个 V2 bundle 时，它才会被接受。验证内容包括：

- **复合签名** — 委托人使用 RPR 的 `binding_keys` 对清单所做的 Ed25519 + ML-DSA-65 签名，以及每个构件自身的签名，所用模式取护照风险等级对应的策略模式与意图安全等级模式中较严格者；存在的 PQ 签名必须通过验证
- **清单完整性** — 所有构件的哈希以及审计 Merkle 根一致
- **会话绑定** — 所有构件中会话 nonce 的一致性，以及会话过期
- **审计哈希链**和密钥有效性（已吊销或已过期的密钥）

V1 bundle 没有后量子签名，因此只有在仅经典签名的 bundle 可被接受的情况下才会被接受（VERIFICATION.md V2-10）：在默认策略下，意图为 routine 或 standard 的 V1 bundle 会通过，而涉及支付、敏感数据、高预估影响或风险分数 0.5 及以上的 V1 bundle 会被拒绝。`requireHybrid` 和 `allow_v1_bundles: false` 会拒绝所有 V1 bundle。

已验证的 bundle 在内部是一致的，并由它自己列出的密钥签署；这并不能证明委托人是谁。要只接受来自你所信任的委托人的 bundle，请配置准入（`trustedPrincipals`，未发布；参见 [ADMISSION.md](ADMISSION.md)）。关于防重放的受众绑定，参见该软件包的 README。

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

## DCPAgent 接口

附加到 `req.dcpAgent` 的已验证智能体身份：

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

## 后续步骤

- **[主快速开始](./QUICKSTART.md)** — SDK 的基本用法
- **[LangChain 集成](./QUICKSTART_LANGCHAIN.md)** — 包裹 LangChain 工具
- **[API 参考](./API_REFERENCE.md)** — 完整的 SDK 文档
