<sub>**English** · [中文](QUICKSTART.zh-CN.md) · [Español](QUICKSTART.es.md) · [日本語](QUICKSTART.ja.md) · [Português](QUICKSTART.pt-BR.md)</sub>

# DCP-AI Quick Start Guide

Get up and running with the Digital Citizenship Protocol in under 5 minutes.

---

## Prerequisites

Depending on which SDK you use:

- **Node.js** 18+ — for the TypeScript SDK, CLI, WASM package, and the `@dcp-ai/*` integrations; the current LangChain.js (v1) in [QUICKSTART_LANGCHAIN.md](QUICKSTART_LANGCHAIN.md) needs Node.js 22+
- **Python** 3.10+ — for the Python SDK; the separate `agno-dcp` package in [QUICKSTART_AGNO.md](QUICKSTART_AGNO.md) needs 3.11+
- **Go** 1.25+ — for the Go SDK
- **Rust** stable — for the Rust crate

You only need the language you plan to build with. All SDKs speak the same protocol, so mixing languages across agents/verifiers works out of the box.

---

## Published packages and this guide

The TypeScript examples use published `@dcp-ai/sdk` 2.2.0, the npm CLI is `@dcp-ai/cli` 2.1.0, and Python is `dcp-ai` 2.10.0 on PyPI. See [npm](NPM_RELEASES.md), [Python](PYTHON_RELEASE.md) and [SECURITY.md](../SECURITY.md#supported-versions). Go and Rust releases are separate. For source development, use:

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai/sdks/typescript && npm install && npm run build                  # TypeScript SDK of main
cd ../../cli && npm install --no-save --package-lock=false --ignore-scripts --install-links ../sdks/typescript
pip install -e /path/to/dcp-ai/sdks/python                                  # Python SDK of main
```

The registry commands in this guide install the published versions.

---

## Zero-install shortcuts

Want to see DCP running before installing anything? These use published packages and images, not `main`:

- **Interactive playground:** https://docs.dcp-ai.org/playground/ — generate identities, build bundles, verify signatures in the browser.
- **Scaffolded starter:** run `npm create @dcp-ai/langchain my-app` (or `/crewai`, `/openai`, `/express`) to get a working project in ~2 minutes.
- **Docker one-liner:** `docker run -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest` starts the reference verification server without cloning anything.

The [playground](../playground/README.md) is a demo: its PQ signatures are simulated and its canonicalization and Merkle handling are simplified, so its bundles are not SDK verification evidence. The [starter templates](../templates/README.md) also have limits: LangChain, CrewAI and OpenAI use placeholder keys/signatures; Express checks structure only. Use the SDK examples below for verifiable bundles.

---

## 1. Install the CLI

The CLI wizard is a demo for looking around: its "ML-DSA-65" keys are simulated (random bytes), and the RPR and
passport it writes are unsigned and do not match the V2 schemas. To create an identity and bundles that verify,
skip to [§3](#3-typescript-sdk) or [§4](#4-python-sdk); the limits are listed in
[Agent creation](AGENT_CREATION_AND_CERTIFICATION.md#cli-wizard-demo-only).

The published version, installed or run directly:

```bash
npm install -g @dcp-ai/cli
```

```bash
npx @dcp-ai/cli init
```

From a checkout (above), run the repository's wizard in your project's directory:
`node /path/to/dcp-ai/cli/bin/dcp-ai.js init`.

## 2. Initialize Your Agent

```bash
npx @dcp-ai/cli init   # or: node /path/to/dcp-ai/cli/bin/dcp-ai.js init
```

This creates the following demo files in your project:

| File | Purpose |
|------|---------|
| `.dcp/config.json` | Agent configuration and metadata |
| `.dcp/keys/ed25519_public.key`, `.dcp/keys/ed25519_secret.key` | Ed25519 keypair |
| `.dcp/keys/ml_dsa_65_public.key`, `.dcp/keys/ml_dsa_65_secret.key` | Simulated "ML-DSA-65" keypair (random bytes), when post-quantum keys are chosen |
| `.dcp/identity.json` | RPR-like record (unsigned, not schema-valid) |
| `.dcp/passport.json` | Passport-like record (unsigned, not schema-valid) |

The secret key files are written with default permissions (`0644` with the usual umask `022`): run
`chmod 600 .dcp/keys/*_secret.key`, and keep them out of version control by adding `.dcp/keys/` to your
`.gitignore`.

---

## 3. TypeScript SDK

The TypeScript examples below work with npm SDK 2.2.0 or a development checkout (see [Published packages and this guide](#published-packages-and-this-guide)).

Install one of the two:

- the SDK of `main`, built from a checkout, for source development:

  ```bash
  npm install /path/to/dcp-ai/sdks/typescript
  ```

- or the published SDK 2.2.0, which includes these fixes and features:

  ```bash
  npm install @dcp-ai/sdk@^2.2.0
  ```

### Create and Sign a Bundle (V1 — Ed25519)

The RPR and the passport are each signed over the object without its `signature` field. `verifySignedBundle`
checks the bundle signature, its hashes and the chain; the inner signatures are checked apart.

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

### Verify a Bundle

```typescript
import { readFileSync } from 'node:fs';
import { getDefaultRegistry, registerDefaultProviders, verifySignedBundleV2 } from '@dcp-ai/sdk';

registerDefaultProviders();
const signedBundle = JSON.parse(readFileSync('bundle.signed.json', 'utf8'));
const result = await verifySignedBundleV2(signedBundle, getDefaultRegistry());
console.log(result.verified, result.errors);
```

### V2 — Post-Quantum Hybrid Signatures

Every artifact is a `SignedPayload` signed under its domain-separation context with Ed25519 + ML-DSA-65; the
principal signs the RPR and the manifest, the agent the passport, intent and policy decision.

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

Install one of the two:

- a checkout for SDK development:

  ```bash
  pip install -e /path/to/dcp-ai/sdks/python
  ```

- or the published version 2.10.0, including the fixes and APIs described here:

  ```bash
  pip install "dcp-ai>=2.10.0,<3"
  ```

### Create and Verify a Bundle

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

For V2 bundles in Python, see [V2 Bundles](../sdks/python/README.md#v2-bundles).

---

## 5. Security Tiers

DCP automatically selects a cryptographic security tier based on the intent's risk profile:

| Tier | Name | Verification Mode | PQ Checkpoint Interval | Trigger |
|------|------|------------------|----------------------|---------|
| 0 | **Routine** | Classical only (Ed25519) | Every 50 events | None of the triggers below |
| 1 | **Standard** | Hybrid preferred | Every 10 events | Risk score 200–499, `estimated_impact: medium` |
| 2 | **Elevated** | Hybrid required | Every event | Risk score 500–799, PII, financial or health data, payments, `estimated_impact: high`, unknown values |
| 3 | **Maximum** | Hybrid required | Every event | Risk score ≥ 800, credentials, children's data |

The risk score is the policy decision's `risk_score` (spec §14.2).

```typescript
import { computeSecurityTier, tierToVerificationMode } from '@dcp-ai/sdk';

const tier = computeSecurityTier(intent, policyDecision);
const mode = tierToVerificationMode(tier);
// tier: 'elevated', mode: 'hybrid_required'
```

---

<a id="6-telemetry--observability"></a>

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

Providers for ML-DSA-65, ML-KEM-768, SLH-DSA-192f, Ed25519 live under `dcp_ai::providers::*`. See the [`dcp-ai` crate docs on docs.rs](https://docs.rs/dcp-ai) for the full surface.

### WebAssembly (browser)

```bash
npm install @dcp-ai/wasm@^2.1.0   # the published version; for main, see the WASM SDK's Release status
```

Exposes the Rust SDK's primitives to browsers and Node.js. In Node.js, `initDcp()` needs the `.wasm` file as a `data:` URL: see [Initialization](../sdks/wasm/README.md#initialization-browser-and-nodejs).

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
