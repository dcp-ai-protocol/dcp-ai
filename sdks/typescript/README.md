<sub>**English** · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

# @dcp-ai/sdk — TypeScript SDK for DCP-AI v2.0

Official TypeScript SDK for the Digital Citizenship Protocol (DCP-AI). Create, sign, and verify Citizenship Bundles with post-quantum hybrid cryptography (Ed25519 + ML-DSA-65), composite signatures, adaptive security tiers, agent-to-agent (A2A) communication, built-in observability, and production hardening.

## Installation

```bash
npm install @dcp-ai/sdk
```

## Quick Start (V1)

```typescript
import {
  BundleBuilder,
  signBundle,
  verifySignedBundle,
  generateKeypair,
} from '@dcp-ai/sdk';

const keys = generateKeypair();

const bundle = new BundleBuilder()
  .responsiblePrincipalRecord({ dcp_version: '1.0', human_id: 'human-001', /* ... */ })
  .agentPassport({ dcp_version: '1.0', agent_id: 'agent-001', /* ... */ })
  .intent({ dcp_version: '1.0', agent_id: 'agent-001', /* ... */ })
  .policyDecision({ dcp_version: '1.0', agent_id: 'agent-001', /* ... */ })
  .build();

const signed = signBundle(bundle, {
  secretKeyB64: keys.secretKeyB64,
  signerType: 'human',
  signerId: 'human-001',
});

const result = verifySignedBundle(signed, keys.publicKeyB64);
console.log(result); // { verified: true, errors: [] }
```

## Quick Start (V2)

```typescript
import {
  BundleBuilderV2,
  signBundleV2,
  verifySignedBundleV2,
  generateKeypair,
  registerDefaultProviders,
  getDefaultRegistry,
  computeSecurityTier,
} from '@dcp-ai/sdk';

// Register PQ crypto providers
registerDefaultProviders();
const registry = getDefaultRegistry();

// Generate Ed25519 keypair (for classical signing)
const keys = generateKeypair();

// Build a V2 bundle with session nonce and security tier
const bundle = new BundleBuilderV2()
  .responsiblePrincipalRecord({ /* V2 RPR with keys[] */ })
  .agentPassport({ /* V2 passport with capabilities */ })
  .intent({ /* V2 intent with risk_score and security_tier */ })
  .policyDecision({ /* V2 policy with resolved_tier */ })
  .addAuditEntry({ /* V2 audit with dual-hash chain */ })
  .build();
```

## API Reference

### Core Crypto (V1)

| Function | Description |
|----------|-------------|
| `generateKeypair()` | Generates an Ed25519 key pair (`publicKeyB64`, `secretKeyB64`) |
| `signObject(obj, secretKeyB64)` | Signs an object, returns base64 signature |
| `verifyObject(obj, signatureB64, publicKeyB64)` | Verifies a signature against a public key |
| `canonicalize(obj)` | Deterministic (canonical) JSON serialization |
| `publicKeyFromSecret(secretKeyB64)` | Derives the public key from a secret key |

### Crypto Providers (V2)

| Export | Description |
|--------|-------------|
| `Ed25519Provider` | Classical Ed25519 signing provider |
| `MlDsa65Provider` | Post-quantum ML-DSA-65 signing provider |
| `SlhDsa192fProvider` | Post-quantum SLH-DSA-192f signing provider |
| `AlgorithmRegistry` | Registry managing available crypto algorithm providers |
| `getDefaultRegistry()` | Returns the singleton algorithm registry |
| `registerDefaultProviders()` | Registers Ed25519, ML-DSA-65, and SLH-DSA-192f providers |
| `deriveKid(publicKey, algorithm)` | Derives a key identifier from a public key |

### Composite Signatures (V2)

| Function | Description |
|----------|-------------|
| `compositeSign(payload, keys, registry)` | Creates a composite signature with classical + PQ algorithms |
| `compositeVerify(payload, signature, registry)` | Verifies a composite signature |
| `classicalOnlySign(payload, keys, registry)` | Signs with classical algorithm only (fallback mode) |

### Security Tiers (V2)

| Function | Description |
|----------|-------------|
| `computeSecurityTier(riskScore, flags)` | Computes a `SecurityTier` from a numeric risk score |
| `maxTier(a, b)` | Returns the higher of two security tiers |
| `tierToVerificationMode(tier)` | Maps a tier to the required verification mode |
| `tierToCheckpointInterval(tier)` | Maps a tier to the PQ checkpoint interval |

### Bundle Building

| Export | Version | Description |
|--------|---------|-------------|
| `BundleBuilder` | V1 | Fluent builder for V1 Citizenship Bundles |
| `BundleBuilderV2` | V2 | Fluent builder for V2 bundles with security tiers and dual hashing |
| `signBundle(bundle, options)` | V1 | Signs a V1 bundle with Ed25519 |
| `signBundleV2(bundle, keys, registry)` | V2 | Signs a V2 bundle with composite signatures |
| `signBundleV2ClassicalOnly(bundle, keys, registry)` | V2 | Signs a V2 bundle with classical-only signatures |
| `verifySignedBundle(signedBundle, publicKeyB64)` | V1 | Verifies a V1 signed bundle |
| `verifySignedBundleV2(signedBundle, registry)` | V2 | Verifies a V2 signed bundle (composite or classical) |

### Bundle Optimization (V2)

| Export | Description |
|--------|-------------|
| `suggestPresentationMode(context)` | Recommends a presentation mode based on context |
| `presentFull(bundle)` | Full bundle presentation (no omissions) |
| `presentCompact(bundle)` | Compact presentation with pruned audit trail |
| `presentReference(bundle)` | Reference-only presentation (hashes, no payloads) |
| `presentIncremental(bundle, since)` | Incremental presentation (delta since a checkpoint) |
| `VerificationCache` | Caches verification results to avoid redundant crypto work |

### PQ Checkpoints (V2)

| Export | Description |
|--------|-------------|
| `PQCheckpointManager` | Manages periodic post-quantum checkpoint creation |
| `createPQCheckpoint(entries, keys, registry)` | Creates a PQ-signed checkpoint over audit entries |
| `auditEventsMerkleRoot(entries)` | Computes a Merkle root from audit entries |

### Dual Hash (V2)

| Function | Description |
|----------|-------------|
| `sha256Hex(data)` | SHA-256 hash (hex string) |
| `sha3_256Hex(data)` | SHA3-256 hash (hex string) |
| `dualHash(data)` | Returns `{ sha256, sha3_256 }` for quantum-resistant dual hashing |
| `dualMerkleRoot(leaves)` | Computes a Merkle root using dual-hash leaves |

### A2A Protocol (DCP-04)

| Function | Description |
|----------|-------------|
| `createAgentDirectory()` | Creates an in-memory agent directory |
| `findAgentByCapability(dir, cap)` | Finds agents by capability in a directory |
| `findAgentById(dir, id)` | Finds an agent by ID |
| `createHello(agentId, capabilities)` | Creates an A2A Hello handshake message |
| `createWelcome(agentId, capabilities)` | Creates an A2A Welcome response message |
| `deriveSessionId(helloNonce, welcomeNonce)` | Derives a session ID from handshake nonces |
| `createCloseMessage(sessionId, reason)` | Creates a session close message |
| `createSession(id, key, local, remote, tier)` | Creates an encrypted A2A session |
| `encryptMessage(session, payload)` | Encrypts a message within an A2A session |
| `decryptMessage(session, encrypted)` | Decrypts a message within an A2A session |
| `needsRekeying(session)` | Checks if a session needs key rotation |
| `generateResumeProof(session)` | Generates a proof for session resumption |
| `verifyResumeProof(session, proof)` | Verifies a session resumption proof |

### Observability

| Export | Description |
|--------|-------------|
| `dcpTelemetry` | Singleton telemetry instance |
| `dcpTelemetry.init(config)` | Initializes telemetry with service name and exporter |
| `dcpTelemetry.startSpan(name)` | Starts a named trace span |
| `dcpTelemetry.endSpan(span)` | Ends a trace span |
| `dcpTelemetry.recordSignLatency(ms)` | Records signing latency metric |
| `dcpTelemetry.getMetricsSummary()` | Returns aggregated metrics summary |

### Production Hardening

| Export | Description |
|--------|-------------|
| `DcpErrorCode` | Enum of structured error codes |
| `DcpProtocolError` | Typed error class for protocol-level failures |
| `createDcpError(code, message, context)` | Factory for creating structured DCP errors |
| `isDcpError(err)` | Type guard for `DcpProtocolError` |
| `RateLimiter` | Fixed-window rate limiter |
| `AdaptiveRateLimiter` | Rate limiter that adjusts based on load |
| `CircuitBreaker` | Circuit breaker for external calls |
| `withRetry(fn, options)` | Retries an async function with backoff |

### Other V2

| Export | Description |
|--------|-------------|
| `generateSessionNonce()` | Generates a cryptographic session nonce |
| `domainSeparatedMessage(domain, message)` | Prefixes a message with a domain separator |
| `generateEmergencyRevocationToken(keys)` | Generates a pre-signed emergency revocation token |
| `buildEmergencyRevocation(token)` | Builds a full revocation record from a token |
| `shamirSplit(secret, n, k)` | Splits a secret into `n` shares (threshold `k`) |
| `shamirReconstruct(shares)` | Reconstructs a secret from `k` shares |
| `CborEncoder` | CBOR encoder class |
| `CborDecoder` | CBOR decoder class |
| `cborEncode(value)` | Encodes a value to CBOR bytes |
| `cborDecode(bytes)` | Decodes CBOR bytes to a value |

### DCP-05–09: Extended Protocol Modules

| Module | Spec | Key Exports |
|--------|------|-------------|
| `lifecycle` | DCP-05 | `LifecycleState`, `CommissioningCertificate`, `VitalityReport`, `DecommissioningRecord`, `VitalityMetrics`, `TerminationMode`, `DataDisposition` |
| `succession` | DCP-06 | `DigitalTestament`, `SuccessionRecord`, `MemoryTransferManifest`, `MemoryTransferEntry`, `MemoryClassification`, `SuccessorPreference`, `TransitionType`, `MemoryDisposition` |
| `conflict-resolution` | DCP-07 | `DisputeRecord`, `ObjectionRecord`, `DisputeType`, `DisputeStatus`, `EscalationLevel`, `ObjectionType` |
| `arbitration` | DCP-07 | `ArbitrationResolution`, `JurisprudenceBundle`, `AuthorityLevel` |
| `rights` | DCP-08 | `RightsDeclaration`, `RightEntry`, `ObligationRecord`, `RightsViolationReport`, `RightType`, `ComplianceStatus` |
| `delegation` | DCP-09 | `DelegationMandate`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `AuthorityScopeEntry` |
| `awareness-threshold` | DCP-09 | `AwarenessThreshold`, `ThresholdRule`, `ThresholdOperator`, `ThresholdAction` |
| `principal-mirror` | DCP-09 | `PrincipalMirror` (re-export with builder utilities) |

```typescript
// Example: Lifecycle management
import { CommissioningCertificate, LifecycleState } from '@dcp-ai/sdk';

const cert: CommissioningCertificate = {
  certificate_id: 'cert-001',
  agent_id: 'agent-001',
  commissioned_by: 'human-001',
  commissioned_at: '2026-03-01T00:00:00Z',
  initial_state: 'commissioned',
  conditions: ['Must complete onboarding within 30 days'],
};

// Example: Delegation mandate
import { DelegationMandate, AwarenessThreshold } from '@dcp-ai/sdk';

const mandate: DelegationMandate = {
  mandate_id: 'mandate-001',
  principal_id: 'human-001',
  delegate_id: 'agent-001',
  authority_scope: [{ domain: 'email', actions: ['read', 'draft'], constraints: {} }],
  valid_from: '2026-03-01T00:00:00Z',
  valid_until: '2026-06-01T00:00:00Z',
};
```

## V2 Types

Key types exported by the SDK:

- `SignedPayload` — Wrapper for signed data with composite signature metadata
- `CompositeSignature` — Contains classical + PQ signature components
- `KeyEntry` — Public key entry with algorithm, kid, and key material
- `SecurityTier` — `'basic' | 'elevated' | 'critical'`
- `VerifierPolicy` — Policy specifying required verification mode per tier
- `PQCheckpoint` — Post-quantum checkpoint over audit entries
- `A2ASession` — Encrypted agent-to-agent session state
- `A2AMessage` — Encrypted A2A message envelope
- `TelemetryConfig` — Configuration for the observability subsystem

**DCP-05–09 Types:**

- `LifecycleState` — `'commissioned' | 'active' | 'declining' | 'decommissioned'`
- `CommissioningCertificate` — Agent commissioning record with conditions
- `VitalityReport` — Periodic health and performance metrics
- `DecommissioningRecord` — End-of-life record with data disposition
- `DigitalTestament` — Succession planning with memory disposition
- `SuccessionRecord` — Record of completed succession
- `MemoryTransferManifest` — Classified memory transfer manifest
- `DisputeRecord` — Conflict record with escalation levels
- `ArbitrationResolution` — Arbitration outcome with binding authority
- `JurisprudenceBundle` — Precedent collection for dispute resolution
- `RightsDeclaration` — Agent rights with compliance tracking
- `ObligationRecord` — Obligation with enforcement status
- `RightsViolationReport` — Violation report with severity
- `DelegationMandate` — Scoped authority delegation
- `AwarenessThreshold` — Human-in-the-loop trigger rules
- `PrincipalMirror` — Principal preference snapshot

## A2A Protocol

Agent-to-agent encrypted communication:

```typescript
import { createSession, encryptMessage, decryptMessage } from '@dcp-ai/sdk';

// Create encrypted A2A session
const session = createSession(sessionId, sessionKey, 'agent:a', 'agent:b', 'elevated');
const encrypted = encryptMessage(session, { action: 'negotiate', data: {...} });
const decrypted = decryptMessage(remoteSession, encrypted);
```

## Observability

All crypto operations are automatically instrumented:

```typescript
import { dcpTelemetry } from '@dcp-ai/sdk';

dcpTelemetry.init({ serviceName: 'my-agent', enabled: true, exporterType: 'console' });

// All crypto operations are automatically instrumented
const summary = dcpTelemetry.getMetricsSummary();
```

## Dependencies

- `ajv` + `ajv-formats` — JSON Schema validation
- `tweetnacl` + `tweetnacl-util` — Ed25519 cryptography
- `json-stable-stringify` — Deterministic JSON
- `@noble/post-quantum` — ML-DSA-65 and SLH-DSA post-quantum signatures

## Development

```bash
# Install dependencies
npm install

# Build (ESM + CJS + types)
npm run build

# Tests with Vitest
npm test
npm run test:watch
npm run test:coverage

# Type check
npm run lint
```

## License

Apache-2.0
