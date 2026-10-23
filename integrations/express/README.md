# @dcp-ai/express — Express Middleware

DCP verification middleware for Express.js. Automatically verifies Signed Bundles on each request and injects the verified agent data.

## Supported DCP Specifications

DCP-01 through DCP-09.

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
| `checkRevocation` | `boolean` | `false` | After verification, ask the revocation service whether the agent (and, for V2, each key) is revoked. Fails open if the service is unreachable. |
| `revocationServiceUrl` | `string` | `"http://localhost:3003"` | Base URL of the revocation service. |
| `cacheTtlSeconds` | `number` | `0` | Seconds to cache verification results. `0` disables caching. |
| `headerName` | `string` | `"x-dcp-bundle"` | Name of the HTTP header where the bundle is sent. |
| `onFailure` | `function` | `undefined` | Custom handler for verification errors. Receives `(req, res, errors)`. |
| `verifierPolicy` | `object` | `undefined` | V2 verifier policy fields, merged over the SDK's `DEFAULT_VERIFIER_POLICY` and passed to `verifySignedBundleV2`. A `default_mode` given without `risk_overrides` applies to every risk tier. An unknown verification mode throws when the middleware is created. |
| `requireHybrid` | `boolean` | `false` | V2: every risk tier whose mode is `classical_only` or `hybrid_preferred` becomes `hybrid_required`. |
| `requireActiveLifecycle` | `boolean` | `false` | Reject decommissioned agents (DCP-05 §5.1). |

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
  dcpVersion: "1.0" | "2.0";
  kids?: string[];          // V2: key identifiers of the passport keys
  sessionNonce?: string;    // V2: session nonce of the bundle
  lifecycleState?: string;  // DCP-05 lifecycle state
  mandateId?: string;       // DCP-09 delegation mandate ID
  warnings?: string[];      // V2: warnings of the SDK verifier (e.g. classical-only signature)
}
```

### Behavior

1. Extracts the signed bundle from the `X-DCP-Bundle` header (JSON) or from `req.body.signed_bundle`
2. Verifies it with `@dcp-ai/sdk`:
   - **V2** (`bundle.dcp_bundle_version: "2.0"`): `verifySignedBundleV2()` with an Ed25519 / ML-DSA-65 / SLH-DSA-192f registry and the policy above. It checks the artifact payload hashes and the manifest, session binding and expiry, the bundle's composite signature over the manifest against the passport or RPR keys, the verification mode for the passport's risk tier, the audit hash chain and key validity. The middleware also rejects a bundle whose PQ signature is present but does not verify (VERIFICATION.md V2-7), which `@dcp-ai/sdk` 2.1.x accepts with a warning under `hybrid_preferred`. A malformed bundle is rejected with `403`, never accepted on its structure alone.
   - **V1**: `verifySignedBundle()`.
3. If valid: injects `req.dcpAgent` and calls `next()`
4. If it fails: responds with `403`, the verifier's `errors` and `warnings` (or uses `onFailure` if configured)
5. If an internal error occurs: responds with `500`

`@dcp-ai/sdk` 2.1.x does not check the per-artifact signatures (VERIFICATION.md V2-8); see the note in [`docs/API_REFERENCE.md`](../../docs/API_REFERENCE.md). The bundle signature still covers every artifact through the manifest hashes.

### Cache

When `cacheTtlSeconds > 0`, each middleware keeps its own cache of verified bundles, keyed by the SHA-256 of the whole signed bundle: a cached verdict is only reused for the identical bundle, under the same middleware options. Within the TTL a cached bundle is not re-verified, so session or key expiry and revocation are not checked again until the entry expires.

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
