# DCP-AI Quick Start Guide

Get up and running with the Digital Citizenship Protocol in under 5 minutes.

---

## Prerequisites

Depending on which SDK you use:

- **Node.js** 18+ — for the TypeScript SDK, CLI, WASM package, and any `@dcp-ai/*` integration
- **Python** 3.10+ — for the Python SDK
- **Go** 1.22+ — for the Go SDK
- **Rust** stable — for the Rust crate

You only need the language you plan to build with. All SDKs speak the same protocol, so mixing languages across agents/verifiers works out of the box.

---

## Zero-install shortcuts

Want to see DCP running before installing anything?

- **Interactive playground:** https://dcp-ai.org/playground/ — generate identities, build bundles, verify signatures in the browser.
- **Scaffolded starter:** run `npm create @dcp-ai/langchain my-app` (or `/crewai`, `/openai`, `/express`) to get a working project in ~2 minutes.
- **Docker one-liner:** `docker run -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest` starts the reference verification server without cloning anything.

---

## 1. Install the CLI

```bash
npm install -g @dcp-ai/cli
# or run directly with npx
npx @dcp-ai/cli init
```

## 2. Initialize Your Agent

```bash
npx @dcp-ai/cli init
```

This creates the following files in your project:

| File | Purpose |
|------|---------|
| `.dcp/config.json` | Agent configuration and metadata |
| `.dcp/keys/` | Ed25519 + ML-DSA-65 keypairs |
| `.dcp/identity.json` | Responsible Principal Record (RPR) |
| `.dcp/passport.json` | Agent Passport |

---

## 3. TypeScript SDK

```bash
npm install @dcp-ai/sdk
```

### Create and Sign a Bundle (V1 — Ed25519)

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

### Verify a Bundle

```typescript
import { verifySignedBundle } from '@dcp-ai/sdk';

const result = verifySignedBundle(signedBundle);

if (result.verified) {
  console.log('Bundle is valid');
} else {
  console.error('Verification failed:', result.errors);
}
```

### V2 — Post-Quantum Hybrid Signatures

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

### Create and Verify a Bundle

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

## 5. Security Tiers

DCP automatically selects a cryptographic security tier based on the intent's risk profile:

| Tier | Name | Verification Mode | PQ Checkpoint Interval | Trigger |
|------|------|------------------|----------------------|---------|
| 0 | **Routine** | Classical only (Ed25519) | Every 50 events | Risk score < 200 |
| 1 | **Standard** | Hybrid preferred | Every 10 events | Risk score 200–499 |
| 2 | **Elevated** | Hybrid required | Every event | Risk score 500–799, PII, payments |
| 3 | **Maximum** | Hybrid required + immediate verify | Every event | Risk score ≥ 800, credentials |

```typescript
import { computeSecurityTier, tierToVerificationMode } from '@dcp-ai/sdk';

const tier = computeSecurityTier(intent);
const mode = tierToVerificationMode(tier);
// tier: 'elevated', mode: 'hybrid_required'
```

---

## 6. Telemetry & Observability

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

## 7. Agent-to-Agent (A2A) Communication

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

## Other SDKs

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

Providers for ML-DSA-65, ML-KEM-768, SLH-DSA-192f, Ed25519 live under `dcp_ai::providers::*`. See the [`dcp-ai` crate docs on docs.rs](https://docs.rs/dcp-ai) for the full surface.

### WebAssembly (browser)

```bash
npm install @dcp-ai/wasm
```

Exposes the same Rust crypto primitives to any browser JS context. The [playground](https://dcp-ai.org/playground/) is a reference consumer of this package.

---

## Run the reference services

All four services the spec references (verification server, anchor, transparency log, revocation registry) ship as Docker images. From an empty directory:

```bash
docker run -d -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest
docker run -d -p 3001:3001 ghcr.io/dcp-ai-protocol/dcp-ai/anchor:latest
docker run -d -p 3002:3002 ghcr.io/dcp-ai-protocol/dcp-ai/transparency-log:latest
docker run -d -p 3003:3003 ghcr.io/dcp-ai-protocol/dcp-ai/revocation:latest
```

For managed hosting, see the [Fly.io configs in `deploy/fly/`](../deploy/) and the [deployment guide](../deploy/README.md) for Cloud Run / Railway / Compose alternatives.

---

## Next Steps

- **[LangChain Integration](./QUICKSTART_LANGCHAIN.md)** — Add DCP to LangChain agents
- **[CrewAI Integration](./QUICKSTART_CREWAI.md)** — Add DCP to CrewAI crews
- **[OpenAI Integration](./QUICKSTART_OPENAI.md)** — Add DCP to OpenAI function calling
- **[Express Middleware](./QUICKSTART_EXPRESS.md)** — Verify DCP bundles in Express APIs
- **[API Reference](./API_REFERENCE.md)** — Complete SDK documentation
- **[Protocol Specification](../spec/)** — Full DCP v2.0 specification
- **[Security Model](./SECURITY_MODEL.md)** — Threat model and security architecture
- **[Operator Guide](./OPERATOR_GUIDE.md)** — Running verification and anchoring services in production
