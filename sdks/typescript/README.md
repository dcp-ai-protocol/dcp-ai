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
  .intent({ /* V2 intent with security_tier */ })
  .policyDecision({ /* V2 policy decision with risk_score and resolved_tier */ })
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
| `deriveKid(alg, publicKeyBytes)` | Derives a key identifier from a public key |

### Composite Signatures (V2)

| Function | Description |
|----------|-------------|
| `compositeSign(registry, context, canonicalPayloadBytes, keys)` | Creates a composite signature with classical + PQ algorithms |
| `compositeVerify(registry, context, canonicalPayloadBytes, compositeSig, classicalPubkeyB64, pqPubkeyB64?, strategy?)` | Verifies a composite signature |
| `classicalOnlySign(registry, context, canonicalPayloadBytes, key)` | Signs with classical algorithm only (fallback mode) |

### Security Tiers (V2)

| Function | Description |
|----------|-------------|
| `computeSecurityTier(intent, policyDecision?, mandateChainTier?)` | Computes a `SecurityTier` (routine, standard, elevated, maximum) from an intent and the policy decision's `risk_score` (spec §14.2); a verified delegation chain's `effective_tier` can only raise it; unknown values fail closed to `elevated` |
| `maxTier(a, b)` | Returns the higher of two security tiers |
| `tierToVerificationMode(tier)` | Maps a tier to the required verification mode |
| `tierToCheckpointInterval(tier)` | Maps a tier to the PQ checkpoint interval |

### Bundle Building

| Export | Version | Description |
|--------|---------|-------------|
| `BundleBuilder` | V1 | Fluent builder for V1 Citizenship Bundles |
| `BundleBuilderV2` | V2 | Fluent builder for V2 bundles with security tiers and dual hashing |
| `signBundle(bundle, options)` | V1 | Signs a V1 bundle with Ed25519 |
| `signBundleV2(bundle, options)` | V2 | Signs a V2 bundle with composite signatures |
| `signBundleV2ClassicalOnly(bundle, options)` | V2 | Signs a V2 bundle with classical-only signatures |
| `verifySignedBundle(signedBundle, publicKeyB64)` | V1 | Verifies a V1 signed bundle |
| `verifySignedBundleV2(signedBundle, registry, policy?)` | V2 | Verifies a V2 signed bundle (composite or classical) against the stricter of the policy mode and the security tier's mode; reports `resolved_tier` |

### Bundle Optimization (V2)

| Export | Description |
|--------|-------------|
| `suggestPresentationMode(tier, opts)` | Recommends a presentation mode from the security tier and whether this is a first contact or an existing trust relationship |
| `presentFull(bundle)` | Full bundle presentation (no omissions) |
| `presentCompact(bundle, pqCheckpointRef)` | Compact presentation: drops the PQ signature and references the nearest PQ checkpoint instead |
| `presentReference(bundle, verificationEndpoint)` | Reference-only presentation: bundle hash, session nonce and an endpoint to verify or fetch the full bundle |
| `presentIncremental(baseBundle, updatedBundle, baseAuditCount)` | Incremental presentation against a verified base bundle: new audit entries, PQ checkpoints, updated manifest and signature |
| `VerificationCache` | Caches verification results to avoid redundant crypto work |

### PQ Checkpoints (V2)

| Export | Description |
|--------|-------------|
| `PQCheckpointManager` | Manages periodic post-quantum checkpoint creation |
| `createPQCheckpoint(registry, events, sessionNonce, keys)` | Creates a PQ-signed checkpoint over audit entries |
| `auditEventsMerkleRoot(events)` | Computes a Merkle root from audit entries |

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
| `createAgentDirectory(organization, agents)` | Creates an in-memory agent directory |
| `findAgentByCapability(directory, requiredCapabilities)` | Finds agents by capability in a directory |
| `findAgentById(directory, agentId)` | Finds an agent by ID |
| `createHello(initiatorBundle, kemPublicKeyB64, requestedCapabilities, securityTier)` | Creates an A2A Hello handshake message |
| `createWelcome(responderBundle, kemPublicKeyB64, kemCiphertextB64, resolvedTier)` | Creates an A2A Welcome response message |
| `deriveSessionId(agentIdA, agentIdB, nonceA, nonceB, sessionKey)` | Derives a session ID from handshake nonces |
| `createCloseMessage(sessionId, reason, finalSequence, auditSummaryHash)` | Creates a session close message |
| `createSession(sessionId, sessionKey, localAgentId, remoteAgentId, securityTier, rekeyingInterval?)` | Creates an encrypted A2A session |
| `encryptMessage(session, payload)` | Encrypts a message within an A2A session |
| `decryptMessage(session, message)` | Decrypts a message within an A2A session; each sequence is accepted once within the 1000-message window (DCP-04 §8.4) |
| `needsRekeying(session)` | Checks if a session needs key rotation |
| `generateResumeProof(session, lastSeenSequence)` | Generates a proof for session resumption |
| `verifyResumeProof(session, lastSeenSequence, proof)` | Verifies a session resumption proof |

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
| `createDcpError(code, details?)` | Factory for creating structured DCP errors |
| `isDcpError(error)` | Type guard for `DcpProtocolError` |
| `RateLimiter` | Fixed-window rate limiter |
| `AdaptiveRateLimiter` | Rate limiter that adjusts based on load |
| `CircuitBreaker` | Circuit breaker for external calls |
| `withRetry(fn, config?)` | Retries an async function with backoff |

### Other V2

| Export | Description |
|--------|-------------|
| `generateSessionNonce()` | Generates a cryptographic session nonce |
| `domainSeparatedMessage(context, canonicalPayloadBytes)` | Prefixes a message with a domain separator |
| `generateEmergencyRevocationToken()` | Generates a revocation secret and its `sha256:` token commitment |
| `buildEmergencyRevocation({ agentId, humanId, revocationSecret })` | Builds an emergency revocation request from the revocation secret |
| `shamirSplit(secret, threshold, totalShares)` | Splits a secret into `totalShares` shares; any `threshold` of them reconstruct it |
| `shamirReconstruct(shares)` | Reconstructs a secret from at least `threshold` shares |
| `generatePiiSalt()` | Generates a `pii_salt` (32 random bytes as hex). Set it on the RPR before signing it; it is never published |
| `blindRpr(rpr)` | Replaces an RPR's PII (`legal_name`, `contact`) with a salted hash commitment; throws if `rpr.pii_salt` is missing or malformed |
| `verifyBlindedRpr(fullRpr, blindedRpr)` | Checks that a blinded RPR matches the full record; `warnings` flags a legacy unsalted commitment |
| `isBlindedRpr(rpr)` | Type guard for `BlindedResponsiblePrincipalRecordV2` |
| `computePiiHash(rpr)` | Computes the hash commitment over an RPR's PII fields and `pii_salt` (without `pii_salt`: the deprecated unsalted value) |
| `CborEncoder` | CBOR encoder class |
| `CborDecoder` | CBOR decoder class |
| `cborEncode(value)` | Encodes a value to CBOR bytes |
| `cborDecode(data)` | Decodes CBOR bytes to a value |

### Delegation Chains (DCP-09 §3.5)

A human delegates to an agent with a root mandate; that agent may pass part of its authority to another agent
with a sub-mandate it signs itself, and so on. Every hop may only narrow what it received, and the whole chain
verifies offline back to the human.

| Function | Description |
|----------|-------------|
| `createDelegationMandate(registry, humanKeys, params)` | Root mandate signed by the human (`human_composite_sig`); `sub_delegation` and `minimum_security_tier` are optional |
| `createSubMandate(registry, delegatorKeys, parent, params)` | Sub-mandate signed by the parent's agent (`delegator_composite_sig`, `DCP-AI.v2.SubMandate` context) |
| `verifyMandateChain(registry, chain, revokedIds, keys, now?)` | Verifies the chain root first: signatures back to the human, parent links and depth, `sub_delegation`, nested validity windows, attenuation (actions, `data_classes` and `limits` only narrow), the security-tier floor and revocation; returns `{ valid, errors, depth, effective_tier }` |

```typescript
import { createSubMandate, verifyMandateChain, computeSecurityTier } from '@dcp-ai/sdk';

const sub = await createSubMandate(registry, orchestratorKeys, rootMandate, {
  mandate_id: 'mandate:sub-1',
  session_nonce: nonce,
  agent_id: 'agent:subagent',
  authority_scope: [{ domain: 'email', actions_permitted: ['read'], data_classes: ['contact_info'], limits: { max_messages_per_day: 10 } }],
  valid_from: '2026-03-01T00:00:00Z',
  valid_until: '2026-06-01T00:00:00Z',
  revocable: true,
});

const result = await verifyMandateChain(registry, [rootMandate, sub], new Set(), {
  human_keys: humanKeyEntries,
  agent_keys: { 'agent:orchestrator': orchestratorKeyEntries },
});
// The chain's tier floor can only raise the tier of an action taken under it.
const tier = computeSecurityTier(intent, policyDecision, result.valid ? result.effective_tier : null);
```

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

// Example: Delegation mandate (signed by the human)
import { createDelegationMandate } from '@dcp-ai/sdk';

const mandate = await createDelegationMandate(registry, humanKeys, {
  mandate_id: 'mandate-001',
  session_nonce: nonce,
  human_id: 'rpr:human-001',
  agent_id: 'agent:agent-001',
  authority_scope: [{ domain: 'email', actions_permitted: ['read', 'draft'], limits: { max_messages_per_day: 50 } }],
  valid_from: '2026-03-01T00:00:00Z',
  valid_until: '2026-06-01T00:00:00Z',
  revocable: true,
});
```

## V2 Types

Key types exported by the SDK:

- `SignedPayload` — Wrapper for signed data with composite signature metadata
- `CompositeSignature` — Contains classical + PQ signature components
- `KeyEntry` — Public key entry with algorithm, kid, and key material
- `SecurityTier` — `'routine' | 'standard' | 'elevated' | 'maximum'`
- `VerifierPolicy` — Verifier policy: default mode and per-`risk_tier` overrides; the security tier can only make the mode stricter
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
// The same message delivered again throws: each sequence is accepted once.
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
