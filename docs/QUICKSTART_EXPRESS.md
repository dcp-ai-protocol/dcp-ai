# DCP-AI + Express Quick Start

Verify DCP signed bundles in your Express.js APIs using the `@dcp-ai/express` middleware.

---

## Installation

```bash
npm install @dcp-ai/express @dcp-ai/sdk express
```

### Zero-config scaffold (alternative)

```bash
npm create @dcp-ai/express my-api
cd my-api
npm install
```

Produces a runnable `index.js` with the DCP verify middleware already wired to a sample route.

### Python equivalent (FastAPI)

If your service is FastAPI rather than Express, use the Python bridge:

```bash
pip install 'dcp-ai[fastapi]'
```

```python
from fastapi import FastAPI, Depends
from dcp_ai.fastapi import DCPVerifyMiddleware, require_dcp

app = FastAPI()
app.add_middleware(DCPVerifyMiddleware, require_bundle=True, dcp_version="2.0")

@app.post("/agent/action")
async def agent_action(agent=Depends(require_dcp)):
    # agent.passport / agent.intent / agent.session_nonce are populated
    return {"ok": True, "agent": agent.passport.agent_name}
```

---

## How DCP Integrates with Express

The DCP Express middleware extracts and verifies signed bundles from incoming requests. Verified agent identity is attached to the request object for downstream use.

```
Client (AI Agent)                    Express Server
  │                                      │
  │─── Request + DCP Bundle ────────────►│
  │    (X-DCP-Bundle header              │
  │     or body.signed_bundle)           │
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
app.use(express.json());

// 1. Basic DCP verification — require a valid bundle on all /api routes
app.use('/api/*', dcpVerify({ requireBundle: true }));

// 2. Access verified agent identity in your handlers
app.get('/api/data', (req: express.Request & { dcpAgent?: DCPAgent }, res) => {
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
import { dcpVerify } from '@dcp-ai/express';

app.use(dcpVerify({
  // Require a DCP bundle (403 if missing). Default: true
  requireBundle: true,

  // Header name for the bundle. Default: 'x-dcp-bundle'
  headerName: 'x-dcp-bundle',

  // Check agent revocation status against a service. Default: false
  checkRevocation: true,
  revocationServiceUrl: 'http://localhost:3003',

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
    res.status(403).json({ verified: false, errors, hint: 'Include X-DCP-Bundle header' });
  },
}));
```

---

## Sending DCP Bundles from a Client

```typescript
import { generateKeypair, BundleBuilder, signBundle } from '@dcp-ai/sdk';

// Build and sign a bundle (see QUICKSTART.md for full example)
const signed = signBundle(bundle, keys.secretKeyB64);

// Send via header
const response = await fetch('http://localhost:3000/api/data', {
  headers: {
    'X-DCP-Bundle': JSON.stringify(signed),
    'Content-Type': 'application/json',
  },
});

// Or send via body
const response2 = await fetch('http://localhost:3000/api/data', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    signed_bundle: signed,
    // ... other body fields
  }),
});
```

---

## V2 Bundle Verification

The middleware auto-detects V1 and V2 bundles. For V2 bundles, it additionally verifies:

- **Composite signatures** — Ed25519 + ML-DSA-65 hybrid validation
- **Manifest integrity** — All artifact hashes match
- **Session binding** — Session nonce consistency across all artifacts
- **PQ checkpoint** integrity (when present)

```typescript
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
  agentId: string;        // Unique agent identifier
  humanId: string;        // Bound human principal
  publicKey: string;      // Primary public key (base64)
  capabilities: string[]; // ['browse', 'api_call', 'payments', ...]
  riskTier: string;       // 'low' | 'medium' | 'high'
  status: string;         // 'active' | 'revoked' | 'suspended'
  dcpVersion: '1.0' | '2.0';

  // V2-only fields
  kids?: string[];        // Key identifiers for all keys
  sessionNonce?: string;  // Session nonce from bundle manifest
}
```

---

## Next Steps

- **[Main Quick Start](./QUICKSTART.md)** — Core SDK usage
- **[LangChain Integration](./QUICKSTART_LANGCHAIN.md)** — Wrap LangChain tools
- **[API Reference](./API_REFERENCE.md)** — Complete SDK documentation
