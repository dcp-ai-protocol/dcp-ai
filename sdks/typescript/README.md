<sub>**English** · [中文](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/i18n/zh-CN/sdks/typescript/README.md) · [Español](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/i18n/es/sdks/typescript/README.md) · [日本語](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/i18n/ja/sdks/typescript/README.md) · [Português](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/i18n/pt-BR/sdks/typescript/README.md)</sub>

# @dcp-ai/sdk — TypeScript SDK for DCP-AI v2.0

Official TypeScript SDK for the Digital Citizenship Protocol (DCP-AI). Create, sign, and verify Citizenship Bundles with post-quantum hybrid cryptography (Ed25519 + ML-DSA-65), composite signatures, adaptive security tiers, agent-to-agent (A2A) communication, built-in observability, and production hardening.

## Installation

**Published on npm (26/10/2026).** `@dcp-ai/sdk` 2.2.0 was published as `latest` on that date. It included the verifier fixes described in [SECURITY.md](../../SECURITY.md), principal trust and `strict-v1`, delegation chains, the A2A receive window and the experimental `dcp-jcs-v2` APIs. The candidate remained opt-in and non-normative, with `dcp-jcs-v1` as the default. The examples below use APIs available since 2.2.0.

**`@dcp-ai/sdk` 2.2.1.** This version also verifies the secondary SHA3-256 fields of [VERIFICATION.md V2-11](../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) when they are present: `audit_merkle_root_secondary`, each `prev_hash_secondary` and each `intent_hash_secondary`. Absent fields are not required, so a verified bundle may lack a complete secondary chain; a present field that is `null`, not a string or inconsistent is rejected. APIs, result fields, `dcp-jcs-v1` and `hash_alg` handling are unchanged. 2.2.0 does not check these fields. The installation commands below name this version; for its registry availability, see [Published versions](../../docs/README.md#published-versions).

```bash
npm install @dcp-ai/sdk@^2.2.1
```

See the [npm release inventory](../../docs/NPM_RELEASES.md) for all package versions.

For development against a source checkout, build and install the local package instead:

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai/sdks/typescript && npm install && npm run build
cd /path/to/your-project && npm install /path/to/dcp-ai/sdks/typescript
```

## Quick Start (V1)

A V1 bundle signed with Ed25519. The RPR is signed with the principal's key and the passport with the agent's,
each over the canonical JSON of the object without its `signature` field; `createAuditEntry` computes
`intent_hash` and the `prev_hash` chain. `verifySignedBundle` checks the bundle signature, its hashes and the
chain, not these inner signatures: check those yourself, as below.

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

## Quick Start (V2)

A V2 bundle with hybrid signatures (Ed25519 + ML-DSA-65): every artifact is a `SignedPayload`
(`{ payload, payload_hash, composite_sig }`) signed under its domain-separation context, the principal signs
the RPR and the manifest, the agent signs the passport, intent and policy decision.

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
| `VerificationCache` | Caches verification results by bundle hash. A hit does not recheck trust, revocation or the session, and nothing is invalidated automatically, so verify again for admission. In the source on `main` (not published), an opt-in `context` chosen by the caller separates tenants or policies, `get` returns a copy, and `invalidateByAgent` removes the agent's entries and every entry stored without `agentIds`; in published 2.2.1 the key is the hash only and `invalidateByAgent` removes nothing, so use `invalidateByKid` or `clear()` ([details](../../docs/API_REFERENCE.md#verificationcache)) |

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
| `generatePiiSalt()` | Generates a `pii_salt` (32 random bytes as hex). Set it on the RPR before signing and keep it private: `blindRpr` omits it from the blinded record, but the full RPR retains it |
| `blindRpr(rpr)` | Replaces an RPR's PII (`legal_name`, `contact`) with a salted hash commitment; throws if `rpr.pii_salt` is missing or malformed |
| `verifyBlindedRpr(fullRpr, blindedRpr)` | Checks that a blinded RPR matches the full record; `warnings` flags a legacy unsalted commitment |
| `isBlindedRpr(rpr)` | Type guard for `BlindedResponsiblePrincipalRecordV2` |
| `computePiiHash(rpr)` | Computes the hash commitment over an RPR's PII fields and `pii_salt` (without `pii_salt`: the deprecated unsalted value) |
| `CborEncoder` | CBOR encoder class |
| `CborDecoder` | CBOR decoder class |
| `cborEncode(value)` | Encodes a value to CBOR bytes |
| `cborDecode(data)` | Decodes CBOR bytes to a value |

<a id="admission-trusted-principals-and-strict-v1-unreleased"></a>

### Admission: Trusted Principals and strict-v1

A verified bundle is signed by the keys it lists; it does not prove who the principal is. Admission accepts a bundle only when its principal signatures were made with keys of a principal your trust set lists, and optionally under the operator-fixed `strict-v1` profile (hybrid signatures, signed audience, a session of at most 300 s, a fresh revocation snapshot).

```typescript
// Fragment, not a complete program: trustSetJson and the strict-v1 settings come from operator configuration, signedBundle from the request, snapshot from your revocation source, registry as in the V2 Quick Start.
import { admitSignedBundleV2, createPrincipalTrustStore, resolveStrictV1Profile } from '@dcp-ai/sdk';

const trust = createPrincipalTrustStore(trustSetJson); // AdmissionConfigError on a bad trust set
const profile = resolveStrictV1Profile({ profile: 'strict-v1', verifier_id: 'api.acme.example' });
const result = await admitSignedBundleV2(signedBundle, registry, { profile, trust, revocation: snapshot });
// result.verified, result.principal_trust, result.profile_compliance, result.admitted,
// result.action_authorized (always false), result.errors [{ code, message }]
```

- `verifySignedBundleV2(bundle, registry, policy, { now })` takes an optional clock and reports `details.signer_keys`; without them it behaves as before.
- `evaluateAdmissionV2` evaluates a verifier result you already have (no cryptography, no I/O); `revocationSubjects` lists what a revocation source must answer for.
- Guide: [`docs/ADMISSION.md`](../../docs/ADMISSION.md). Spec and codes: [`spec/profiles/admission`](../../spec/profiles/admission/README.md).

<a id="delegation-chains-dcp-09-35-unreleased"></a>

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
// Fragment, not a complete program: registry and nonce as in the V2 Quick Start; rootMandate, orchestratorKeys and the key entries come from your delegation setup; intent and policyDecision are the V2 payloads.
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

<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in-unreleased"></a>

### Experimental: Canonicalization Candidate `dcp-jcs-v2` (opt-in)

Not normative and not active: `dcp-jcs-v1` stays the only canonicalization profile, and no default,
builder, signer or verifier changes. These APIs exist only for callers who opt in, npm SDK 2.2.0 included. A verified candidate bundle grants no trust or admission. Design, rules and the full
contract: [`docs/proposals/canonicalization-candidate`](../../docs/proposals/canonicalization-candidate/README.md)
(§15 ingress, §16 router, §17 verifier, §18 producers).

| Export | Description |
|--------|-------------|
| `experimentalCandidateIngress(bytes)` | Checks the original bytes of one unit: `{ status: 'accept', value, canonical, canonicalSha256 }` or `{ status: 'reject', class, offset }` |
| `experimentalCandidateExtractUnit(bytes, transport)` | Extracts the unit from a `bare` or `envelope` transport |
| `createExperimentalCandidateRouter(config)` | Routes bytes: `reject`, `v1_path` (through a named historical decoder) or `candidate` |
| `createExperimentalCandidateVerifier(config).verify(bytes, registry, policy?, options?)` | Verifies from the original bytes with at most one verifier: today's for `dcp-jcs-v1`, today's accepting exactly `dcp-jcs-v2` for the candidate |
| `experimentalHistoricalAdapters` | The measured decoders (`bufferUtf8JsonParse`, `textDecoderJsonParse`); none is a default |
| `experimentalCandidateSignPayload(registry, context, input, keys)` | Signs one artifact from `{ bytes }` or `{ value }`; no profile |
| `experimentalCandidateSignBundle(registry, parts, signer, options)` | Assembles and signs a bundle whose manifest names `dcp-jcs-v2` |
| `ExperimentalCandidateProduceError` | A rejection for the domain or form of the inputs, raised before any signer is called (`class`, `part`, `path`, `offset`); key, registry and provider errors stay today's |

```typescript
import {
  AlgorithmRegistry, DCP_CONTEXTS, Ed25519Provider, MlDsa65Provider, experimentalCandidateIngress,
  experimentalCandidateSignPayload,
} from '@dcp-ai/sdk';

// The ingress decides on the original bytes: 1.0 is the integer 1, members are sorted.
const accepted = experimentalCandidateIngress(new TextEncoder().encode('{"b":1.0,"a":[]}'));
if (accepted.status === 'accept') console.log(new TextDecoder().decode(accepted.canonical)); // {"a":[],"b":1}
const refused = experimentalCandidateIngress(new TextEncoder().encode('{"a":1,"a":2}'));
if (refused.status === 'reject') console.log(refused.class, refused.offset); // DUPLICATE_KEY 7

// A producer signs an artifact from those bytes (hybrid keys, today's composite signature).
const registry = new AlgorithmRegistry();
const ed25519 = new Ed25519Provider();
const mlDsa65 = new MlDsa65Provider();
registry.registerSigner(ed25519);
registry.registerSigner(mlDsa65);
const c = await ed25519.generateKeypair();
const p = await mlDsa65.generateKeypair();
const keys = {
  classical: { kid: c.kid, alg: 'ed25519', secretKeyB64: c.secretKeyB64, publicKeyB64: c.publicKeyB64 },
  pq: { kid: p.kid, alg: 'ml-dsa-65', secretKeyB64: p.secretKeyB64, publicKeyB64: p.publicKeyB64 },
};
const artifact = await experimentalCandidateSignPayload(
  registry, DCP_CONTEXTS.Intent, { bytes: new TextEncoder().encode('{"intent_id":"intent:1","risk":1.0}') }, keys,
);
console.log(artifact.signedPayload.payload_hash); // sha256:… of {"intent_id":"intent:1","risk":1}
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
// Fragment, not a complete program: registry, humanKeys (the principal's CompositeKeyPair) and nonce as in the V2 Quick Start.
// Example: Lifecycle management (DCP-05), signed with the commissioning human's composite keys
import { createCommissioningCertificate, validateStateTransition } from '@dcp-ai/sdk';
import type { CommissioningCertificate } from '@dcp-ai/sdk';

const cert: CommissioningCertificate = await createCommissioningCertificate(registry, humanKeys, {
  agent_id: 'agent:agent-001',
  session_nonce: nonce,
  human_id: 'human:human-001',
  commissioning_authority: 'human:human-001',
  purpose: 'Customer support triage',
  initial_capabilities: ['browse', 'api_call'],
  risk_tier: 'low',
  principal_binding_reference: 'human:human-001',
});
validateStateTransition('commissioned', 'active'); // true

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
// Fragment, not a complete program: sessionId and sessionKey come from the A2A handshake, remoteSession is the peer's session.
import { createSession, encryptMessage, decryptMessage } from '@dcp-ai/sdk';

// Create encrypted A2A session
const session = createSession(sessionId, sessionKey, 'agent:a', 'agent:b', 'elevated');
const encrypted = encryptMessage(session, { action: 'negotiate', data: { offer: 10 } });
const decrypted = decryptMessage(remoteSession, encrypted);
// The same message delivered again throws: each sequence is accepted once.
```

## Observability

Telemetry requires explicit instrumentation: call the span and metric methods around the operations you want to observe. Initialization alone does not instrument crypto operations. This example only initializes telemetry and reads the current summary:

```typescript
import { dcpTelemetry } from '@dcp-ai/sdk';

dcpTelemetry.init({ serviceName: 'my-agent', enabled: true, exporterType: 'console' });

// Read metrics explicitly recorded so far; initialization alone records no crypto operations
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
