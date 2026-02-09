# @dcp-ai/express — Express Middleware

DCP verification middleware for Express.js. Automatically verifies Signed Bundles on each request and injects the verified agent data.

## Installation

```bash
npm install @dcp-ai/express @dcp-ai/sdk
```

**Peer dependency:** Express 4.18+ or 5.x

## Quickstart

```typescript
import express from "express";
import { dcpVerify } from "@dcp-ai/express";

const app = express();
app.use(express.json());

// Verify DCP on all routes
app.use(dcpVerify());

app.post("/api/action", (req, res) => {
  // The verified agent is available at req.dcpAgent
  const agent = req.dcpAgent;
  console.log(`Agent ${agent.agentId} (human: ${agent.humanId})`);
  console.log(`Capabilities: ${agent.capabilities}`);
  console.log(`Risk tier: ${agent.riskTier}`);

  res.json({ ok: true, agent_id: agent.agentId });
});

app.listen(3000);
```

### Sending a bundle from the client

The bundle is sent as JSON in the `X-DCP-Bundle` header or in `req.body.signed_bundle`:

```bash
# Via header
curl -X POST http://localhost:3000/api/action \
  -H "Content-Type: application/json" \
  -H "X-DCP-Bundle: $(cat signed_bundle.json)" \
  -d '{"action": "test"}'

# Via body
curl -X POST http://localhost:3000/api/action \
  -H "Content-Type: application/json" \
  -d '{"signed_bundle": {...}, "action": "test"}'
```

## API Reference

### `dcpVerify(options?)`

Factory function that returns an Express middleware.

```typescript
import { dcpVerify } from "@dcp-ai/express";

app.use(dcpVerify({
  requireBundle: true,
  checkRevocation: false,
  cacheTtlSeconds: 300,
  headerName: "x-dcp-bundle",
  onFailure: (req, res, errors) => {
    res.status(403).json({ error: "DCP verification failed", details: errors });
  },
}));
```

### Options (`DCPVerifyOptions`)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `requireBundle` | `boolean` | `true` | Require a bundle on every request. If `false`, requests without a bundle pass through without verification. |
| `checkRevocation` | `boolean` | `false` | Check if the agent is revoked (placeholder). |
| `cacheTtlSeconds` | `number` | `0` | Seconds to cache verification results. `0` disables caching. |
| `headerName` | `string` | `"x-dcp-bundle"` | Name of the HTTP header where the bundle is sent. |
| `onFailure` | `function` | `undefined` | Custom handler for verification errors. Receives `(req, res, errors)`. |

### `req.dcpAgent`

After successful verification, `req.dcpAgent` contains:

```typescript
interface DCPAgent {
  agentId: string;      // Agent ID
  humanId: string;      // ID of the responsible human
  publicKey: string;    // Ed25519 public key
  capabilities: string[];  // Declared capabilities
  riskTier: string;     // Risk level (low/medium/high)
  status: string;       // Status (active/suspended/revoked)
}
```

### Behavior

1. Extracts the signed bundle from the `X-DCP-Bundle` header (JSON) or from `req.body.signed_bundle`
2. Verifies using `verifySignedBundle()` from `@dcp-ai/sdk`
3. If valid: injects `req.dcpAgent` and calls `next()`
4. If it fails: responds with `403` and errors (or uses `onFailure` if configured)
5. If an internal error occurs: responds with `500`

### Cache

When `cacheTtlSeconds > 0`, results are cached using `signature.sig_b64` as the key. This avoids re-verifying the same bundle on consecutive requests.

## Advanced Example — Selectively Protected Routes

```typescript
import express from "express";
import { dcpVerify } from "@dcp-ai/express";

const app = express();
app.use(express.json());

// Public routes (no verification)
app.get("/health", (req, res) => res.json({ ok: true }));

// Protected routes (require DCP)
const protected = express.Router();
protected.use(dcpVerify({ cacheTtlSeconds: 60 }));

protected.post("/agent/action", (req, res) => {
  res.json({ agent: req.dcpAgent.agentId });
});

protected.get("/agent/profile", (req, res) => {
  res.json(req.dcpAgent);
});

app.use("/api", protected);
app.listen(3000);
```

## Development

```bash
# Install dependencies
npm install

# Build (ESM + CJS)
npx tsup src/index.ts --format esm,cjs --dts

# Type check
npx tsc --noEmit
```

### Dependencies

- `@dcp-ai/sdk` — DCP verification SDK
- `express` (peer) — HTTP framework

## License

Apache-2.0
