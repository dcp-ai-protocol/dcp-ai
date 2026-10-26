# DCP-AI + Express Quick Start

Verify DCP signed bundles in your Express.js APIs using the `@dcp-ai/express` middleware.

---

## Installation

> **Versions (26/10/2026).** Use published `@dcp-ai/express` 2.1.0 with `@dcp-ai/sdk` 2.2.0. They include the corrected verifier and admission with trusted principals and `strict-v1`; building a checkout is not required. See the [Express README](../integrations/express/README.md).

```bash
npm install @dcp-ai/express@^2.1.0 @dcp-ai/sdk@^2.2.0 express
```

### Zero-config scaffold (alternative)

```bash
npm create @dcp-ai/express my-api
cd my-api
npm install
```

Produces a runnable `index.js` with discovery endpoints and a middleware on a sample route that checks the
structure of a bundle only: it verifies no signature, so a forged or altered bundle passes (see
[templates/express](../templates/express/README.md)). To verify signed bundles, use `@dcp-ai/express` as below.

### Python equivalent (FastAPI)

If your service is FastAPI rather than Express, use the Python bridge. This example follows `main`: install the
Python SDK from a checkout. The FastAPI middleware of `dcp-ai` 2.9.0 on PyPI checks the structure of V2 bundles but
does not verify their signatures, so a forged V2 bundle passes it; do not rely on 2.9.0 for V2 bundles (see the
[FastAPI README](../integrations/fastapi/README.md)).

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

## How DCP Integrates with Express

The DCP Express middleware extracts and verifies signed bundles from incoming requests. Verified agent identity is attached to the request object for downstream use.

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

## Complete Working Example

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

## Configuration Options

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

On `main`, `trustedPrincipals`, `profile`, `revocationSource` and `tenant` add admission: only bundles
signed for a principal you trust, with its trusted keys, reach the route. See [ADMISSION.md](ADMISSION.md) and the
[Express README](../integrations/express/README.md) for every option, including the cache, supervision and
disconnect options.

---

## Sending DCP Bundles from a Client

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

A hybrid V2 bundle (Ed25519 + ML-DSA-65) is about 33 KB, while Node accepts 16 KiB of request
headers by default: in `X-DCP-Bundle` it is refused with `431` before Express runs. Do not raise
the header limit for it; send it in the body. The body parser's `limit` is your budget, a choice
for your deployment and not a protocol limit: measure your largest bundle, leave margin, and keep
any proxy in front at least as permissive. A larger body gets `413` before the middleware.
`integrations/express/examples/strict-v1-body.mjs` runs the whole path over real HTTP with
`strict-v1` admission.

---

## V2 Bundle Verification

The middleware auto-detects V1 and V2 bundles. A V2 bundle is accepted only if `verifySignedBundleV2` from `@dcp-ai/sdk` accepts it under the middleware's verifier policy (`verifierPolicy` over the SDK's `DEFAULT_VERIFIER_POLICY`, then `requireHybrid`). It verifies:

- **Composite signatures** — the principal's Ed25519 + ML-DSA-65 signature over the manifest, with the RPR `binding_keys`, and each artifact's own signature, in the stricter of the policy mode for the passport's risk tier and the mode of the intent's security tier; a PQ signature that is present must verify
- **Manifest integrity** — All artifact hashes and the audit Merkle root match
- **Session binding** — Session nonce consistency across all artifacts, and session expiry
- **Audit hash chain** and key validity (revoked or expired keys)

A V1 bundle has no post-quantum signature, so it is accepted only where a classical-only bundle would be (VERIFICATION.md V2-10): under the default policy a V1 bundle with a routine or standard intent passes, and one with a payment, sensitive data, a high estimated impact or a risk score of 0.5 or more is refused. `requireHybrid` and `allow_v1_bundles: false` refuse every V1 bundle.

A verified bundle is internally consistent and signed by the keys it lists itself; it does not prove who the principal is. To accept bundles only from principals you trust, configure admission (`trustedPrincipals`; see [ADMISSION.md](ADMISSION.md)). See the package README for audience binding against replay.

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

## DCPAgent Interface

The verified agent identity attached to `req.dcpAgent`:

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

## Next Steps

- **[Main Quick Start](./QUICKSTART.md)** — Core SDK usage
- **[LangChain Integration](./QUICKSTART_LANGCHAIN.md)** — Wrap LangChain tools
- **[API Reference](./API_REFERENCE.md)** — Complete SDK documentation
