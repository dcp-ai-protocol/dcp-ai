# DCP-AI API Reference

Complete reference for the `@dcp-ai/sdk` TypeScript SDK (v2.0).

---

## Table of Contents

- [Core Types (V1)](#core-types-v1)
- [Core Types (V2)](#core-types-v2)
- [Crypto Functions (V1)](#crypto-functions-v1)
- [V2 Composite Signature Operations](#v2-composite-signature-operations)
- [V2 Bundle Builder & Signer](#v2-bundle-builder--signer)
- [V2 Verification](#v2-verification)
- [Security Tier Engine](#security-tier-engine)
- [A2A Protocol (DCP-04)](#a2a-protocol-dcp-04)
- [Telemetry & Observability](#telemetry--observability)
- [Hashing & Merkle Trees](#hashing--merkle-trees)
- [Schema Validation](#schema-validation)
- [Domain Separation](#domain-separation)
- [Session Nonces](#session-nonces)
- [Key Recovery](#key-recovery)
- [Emergency Revocation](#emergency-revocation)
- [Bundle Presentation](#bundle-presentation)
- [Verification Cache](#verification-cache)
- [CBOR Wire Format](#cbor-wire-format)

---

## Core Types (V1)

Import from `@dcp-ai/sdk`:

### ResponsiblePrincipalRecord

Binds a human principal to an agent. The root of trust in DCP.

```typescript
interface ResponsiblePrincipalRecord {
  dcp_version: '1.0';
  human_id: string;
  legal_name: string;
  entity_type: EntityType;          // 'natural_person' | 'organization'
  jurisdiction: string;             // ISO jurisdiction code (e.g. 'US-CA')
  liability_mode: LiabilityMode;    // 'owner_responsible'
  override_rights: boolean;
  public_key: string;               // Base64-encoded Ed25519 public key
  issued_at: string;                // ISO 8601 timestamp
  expires_at: string | null;
  contact: string | null;
}
```

### AgentPassport

Identity document for an AI agent, bound to a human principal.

```typescript
interface AgentPassport {
  dcp_version: '1.0';
  agent_id: string;
  human_id: string;
  public_key: string;
  capabilities: Capability[];       // ['browse', 'api_call', 'email', ...]
  risk_tier: RiskTier;              // 'low' | 'medium' | 'high'
  created_at: string;
  status: AgentStatus;              // 'active' | 'revoked' | 'suspended'
}
```

### Intent

Declaration of an action the agent wants to perform.

```typescript
interface Intent {
  dcp_version: '1.0';
  intent_id: string;
  agent_id: string;
  human_id: string;
  timestamp: string;
  action_type: ActionType;
  target: IntentTarget;
  data_classes: DataClass[];
  estimated_impact: Impact;         // 'low' | 'medium' | 'high'
  requires_consent: boolean;
}

interface IntentTarget {
  channel: Channel;                 // 'web' | 'api' | 'email' | ...
  to?: string | null;
  domain?: string | null;
  url?: string | null;
}
```

### PolicyDecision

Result of the policy engine evaluating an intent.

```typescript
interface PolicyDecision {
  dcp_version: '1.0';
  intent_id: string;
  decision: PolicyDecisionType;     // 'approve' | 'escalate' | 'block'
  risk_score: number;
  reasons: string[];
  required_confirmation: { type: 'human_approve'; fields?: string[] } | null;
  applied_policy_hash: string;
  timestamp: string;
}
```

### AuditEntry

Immutable record of an executed action.

```typescript
interface AuditEntry {
  dcp_version: '1.0';
  audit_id: string;
  prev_hash: string;                // Hash chain link
  timestamp: string;
  agent_id: string;
  human_id: string;
  intent_id: string;
  intent_hash: string;
  policy_decision: AuditPolicyDecision;
  outcome: string;
  evidence: AuditEvidence;
}

interface AuditEvidence {
  tool?: string | null;
  result_ref?: string | null;
  evidence_hash?: string | null;
}
```

### CitizenshipBundle / SignedBundle

```typescript
interface CitizenshipBundle {
  responsible_principal_record: ResponsiblePrincipalRecord;
  agent_passport: AgentPassport;
  intent: Intent;
  policy_decision: PolicyDecision;
  audit_entries: AuditEntry[];
}

interface SignedBundle {
  bundle: CitizenshipBundle;
  signature: BundleSignature;
}
```

### Keypair

```typescript
interface Keypair {
  publicKeyB64: string;
  secretKeyB64: string;
}
```

### Enum Types

```typescript
type EntityType = 'natural_person' | 'organization';
type LiabilityMode = 'owner_responsible';
type Capability = 'browse' | 'api_call' | 'email' | 'calendar' | 'payments' | 'crm' | 'file_write' | 'code_exec';
type RiskTier = 'low' | 'medium' | 'high';
type AgentStatus = 'active' | 'revoked' | 'suspended';
type ActionType = 'browse' | 'api_call' | 'send_email' | 'create_calendar_event' | 'initiate_payment' | 'update_crm' | 'write_file' | 'execute_code';
type Channel = 'web' | 'api' | 'email' | 'calendar' | 'payments' | 'crm' | 'filesystem' | 'runtime';
type DataClass = 'none' | 'contact_info' | 'pii' | 'credentials' | 'financial_data' | 'health_data' | 'children_data' | 'company_confidential';
type Impact = 'low' | 'medium' | 'high';
type PolicyDecisionType = 'approve' | 'escalate' | 'block';
```

---

## Core Types (V2)

V2 types add post-quantum cryptographic support, session binding, and dual-hash chains.

### AgentPassportV2

```typescript
interface AgentPassportV2 {
  dcp_version: '2.0';
  agent_id: string;
  session_nonce: string;            // Anti-splicing nonce
  keys: KeyEntry[];                 // Multi-algorithm key array
  principal_binding_reference: string;
  capabilities: Capability[];
  risk_tier: RiskTier;
  created_at: string;
  status: AgentStatus;
  emergency_revocation_token?: string;
}
```

### ResponsiblePrincipalRecordV2

```typescript
interface ResponsiblePrincipalRecordV2 {
  dcp_version: '2.0';
  human_id: string;
  session_nonce: string;
  legal_name: string;
  entity_type: EntityType;
  jurisdiction: string;
  liability_mode: LiabilityMode;
  override_rights: boolean;
  issued_at: string;
  expires_at: string | null;
  contact: string | null;
  binding_keys: KeyEntry[];
}
```

### BlindedResponsiblePrincipalRecordV2

PII-protected variant of RPR for privacy-sensitive deployments.

```typescript
interface BlindedResponsiblePrincipalRecordV2 {
  dcp_version: '2.0';
  human_id: string;
  session_nonce: string;
  blinded: true;
  pii_hash: string;                 // Hash of PII fields
  entity_type: EntityType;
  jurisdiction: string;
  liability_mode: LiabilityMode;
  override_rights: boolean;
  issued_at: string;
  expires_at: string | null;
  binding_keys: KeyEntry[];
}
```

### IntentV2

```typescript
interface IntentV2 {
  dcp_version: '2.0';
  intent_id: string;
  session_nonce: string;
  agent_id: string;
  human_id: string;
  timestamp: string;
  action_type: ActionType;
  target: IntentTargetV2;
  data_classes: DataClass[];
  estimated_impact: Impact;
  requires_consent: boolean;
  security_tier?: SecurityTier;     // 'routine' | 'standard' | 'elevated' | 'maximum'
}
```

### PolicyDecisionV2

```typescript
interface PolicyDecisionV2 {
  dcp_version: '2.0';
  intent_id: string;
  session_nonce: string;
  decision: PolicyDecisionType;
  risk_score: number;               // Integer 0–1000 (millirisk, no floats)
  reasons: string[];
  required_confirmation: { type: 'human_approve'; fields?: string[] } | null;
  applied_policy_hash: string;
  timestamp: string;
  resolved_tier?: SecurityTier;
}
```

### AuditEventV2

```typescript
interface AuditEventV2 {
  dcp_version: '2.0';
  audit_id: string;
  session_nonce: string;
  prev_hash: string;
  prev_hash_secondary?: string;     // SHA3-256 chain
  hash_alg: 'sha256' | 'sha256+sha3-256';
  timestamp: string;
  agent_id: string;
  human_id: string;
  intent_id: string;
  intent_hash: string;
  intent_hash_secondary?: string;
  policy_decision: AuditPolicyDecision;
  outcome: string;
  evidence: AuditEvidenceV2;
  pq_checkpoint_ref: string | null;
}
```

### CitizenshipBundleV2 / SignedBundleV2

```typescript
interface CitizenshipBundleV2 {
  dcp_bundle_version: '2.0';
  manifest: BundleManifest;
  responsible_principal_record: SignedPayload<ResponsiblePrincipalRecordV2 | BlindedResponsiblePrincipalRecordV2>;
  agent_passport: SignedPayload<AgentPassportV2>;
  intent: SignedPayload<IntentV2>;
  policy_decision: SignedPayload<PolicyDecisionV2>;
  audit_entries: AuditEventV2[];
  pq_checkpoints?: PQCheckpoint[];
}

interface SignedBundleV2 {
  bundle: CitizenshipBundleV2;
  signature: BundleSignatureV2;
}
```

### BundleManifest

Cryptographic binding of all artifact hashes within a bundle.

```typescript
interface BundleManifest {
  session_nonce: string;
  rpr_hash: string;
  passport_hash: string;
  intent_hash: string;
  policy_hash: string;
  audit_merkle_root: string;
  audit_merkle_root_secondary?: string;
  audit_count: number;
  pq_checkpoints?: string[];
}
```

### CompositeSignature

```typescript
interface CompositeSignature {
  classical: SignatureEntry;
  pq: SignatureEntry | null;
  binding: BindingMode;             // 'pq_over_classical' | 'classical_only'
}

interface SignatureEntry {
  alg: string;                      // 'ed25519' | 'ml-dsa-65' | 'slh-dsa-192f'
  kid: string;                      // Key identifier
  sig_b64: string;                  // Base64-encoded signature
}

type BindingMode = 'pq_over_classical' | 'classical_only';
```

### SignedPayload

Envelope wrapping any artifact with its composite signature.

```typescript
interface SignedPayload<T> {
  payload: T;
  payload_hash: string;
  composite_sig: CompositeSignature;
  canonicalBytes?: Uint8Array;
}
```

### VerifierPolicy

Verifier-authoritative policy controlling what signatures are required.

```typescript
interface VerifierPolicy {
  default_mode: VerificationMode;
  risk_overrides: Record<RiskTier, VerificationMode>;
  min_classical: number;
  min_pq: number;
  accepted_classical_algs: string[];
  accepted_pq_algs: string[];
  accepted_hash_algs: string[];
  require_session_binding: boolean;
  require_composite_binding: boolean;
  max_key_age_days: number;
  allow_v1_bundles: boolean;
  allow_classical_fallback_disable?: boolean;
  warn_classical_only_deprecated?: boolean;
  advisory_rejected_algs?: string[];
}

type VerificationMode = 'classical_only' | 'pq_only' | 'hybrid_required' | 'hybrid_preferred';
```

### SecurityTier

```typescript
type SecurityTier = 'routine' | 'standard' | 'elevated' | 'maximum';
```

### PQCheckpoint

```typescript
interface PQCheckpoint {
  checkpoint_id: string;
  session_nonce: string;
  event_range: {
    from_audit_id: string;
    to_audit_id: string;
    count: number;
  };
  merkle_root: string;
  composite_sig: CompositeSignature;
}
```

---

## Crypto Functions (V1)

Import from `@dcp-ai/sdk`:

### `generateKeypair()`

Generate a new Ed25519 keypair.

```typescript
function generateKeypair(): Keypair;
```

**Returns:** `{ publicKeyB64: string, secretKeyB64: string }`

```typescript
import { generateKeypair } from '@dcp-ai/sdk';

const keys = generateKeypair();
console.log(keys.publicKeyB64); // Base64-encoded Ed25519 public key
```

### `signObject(obj, secretKeyB64)`

Sign a JSON object with Ed25519 (detached signature). The object is canonicalized before signing.

```typescript
function signObject(obj: unknown, secretKeyB64: string): string;
```

| Param | Type | Description |
|-------|------|-------------|
| `obj` | `unknown` | JSON-serializable object to sign |
| `secretKeyB64` | `string` | Base64-encoded Ed25519 secret key |

**Returns:** Base64-encoded detached signature.

```typescript
const sig = signObject({ action: 'transfer', amount: 100 }, keys.secretKeyB64);
```

### `verifyObject(obj, signatureB64, publicKeyB64)`

Verify an Ed25519 detached signature on a JSON object.

```typescript
function verifyObject(obj: unknown, signatureB64: string, publicKeyB64: string): boolean;
```

| Param | Type | Description |
|-------|------|-------------|
| `obj` | `unknown` | Original JSON object |
| `signatureB64` | `string` | Base64-encoded signature |
| `publicKeyB64` | `string` | Base64-encoded Ed25519 public key |

**Returns:** `true` if valid, `false` otherwise.

```typescript
const valid = verifyObject({ action: 'transfer', amount: 100 }, sig, keys.publicKeyB64);
```

### `canonicalize(obj)`

Canonical JSON serialization with deterministic key ordering.

```typescript
function canonicalize(obj: unknown): string;
```

### `publicKeyFromSecret(secretKeyB64)`

Derive the Ed25519 public key from a secret key.

```typescript
function publicKeyFromSecret(secretKeyB64: string): string;
```

---

## V2 Composite Signature Operations

Import from `@dcp-ai/sdk`:

### `compositeSign(registry, context, payload, keys)`

Produce a composite-bound hybrid signature where the PQ signature covers the classical signature, preventing stripping attacks.

**Binding protocol:**
1. `classical_sig = Classical.sign(context || 0x00 || payload)`
2. `pq_sig = PQ.sign(context || 0x00 || payload || classical_sig)`

```typescript
async function compositeSign(
  registry: AlgorithmRegistry,
  context: DcpContext | string,
  canonicalPayloadBytes: Uint8Array,
  keys: CompositeKeyPair,
): Promise<CompositeSignature>;
```

| Param | Type | Description |
|-------|------|-------------|
| `registry` | `AlgorithmRegistry` | Algorithm registry with registered providers |
| `context` | `DcpContext \| string` | Domain separation context |
| `canonicalPayloadBytes` | `Uint8Array` | Canonical bytes to sign |
| `keys` | `CompositeKeyPair` | Classical + PQ key pair |

```typescript
import { registerDefaultProviders, getDefaultRegistry, compositeSign, DCP_CONTEXTS } from '@dcp-ai/sdk';

registerDefaultProviders();
const registry = getDefaultRegistry();

const sig = await compositeSign(registry, DCP_CONTEXTS.Bundle, payloadBytes, keys);
// sig.binding === 'pq_over_classical'
```

### `compositeVerify(registry, context, payload, sig, classicalPub, pqPub?, strategy?)`

Verify a composite-bound hybrid signature.

```typescript
async function compositeVerify(
  registry: AlgorithmRegistry,
  context: DcpContext | string,
  canonicalPayloadBytes: Uint8Array,
  compositeSig: CompositeSignature,
  classicalPubkeyB64: string,
  pqPubkeyB64?: string,
  strategy?: 'parallel' | 'pq_first',
): Promise<CompositeVerifyResult>;
```

| Param | Type | Description |
|-------|------|-------------|
| `strategy` | `'parallel' \| 'pq_first'` | `parallel` (default): both verified concurrently. `pq_first`: PQ verified first, skip classical if PQ fails. |

**Returns:**

```typescript
interface CompositeVerifyResult {
  valid: boolean;           // Both signatures valid
  classical_valid: boolean;
  pq_valid: boolean;
}
```

### `classicalOnlySign(registry, context, payload, key)`

Produce a classical-only composite signature (transition mode).

```typescript
async function classicalOnlySign(
  registry: AlgorithmRegistry,
  context: DcpContext | string,
  canonicalPayloadBytes: Uint8Array,
  key: CompositeKeyInfo,
): Promise<CompositeSignature>;
```

### Supporting Types

```typescript
interface CompositeKeyPair {
  classical: CompositeKeyInfo;
  pq: CompositeKeyInfo;
}

interface CompositeKeyInfo {
  kid: string;
  secretKeyB64: string;
  publicKeyB64: string;
  alg: string;            // 'ed25519' | 'ml-dsa-65'
}
```

---

## V2 Bundle Builder & Signer

### BundleBuilderV2

Fluent builder for V2 Citizenship Bundles with manifest computation and session nonce validation.

```typescript
class BundleBuilderV2 {
  constructor(sessionNonce: string);

  responsiblePrincipalRecord(rpr: SignedPayload<ResponsiblePrincipalRecordV2 | BlindedResponsiblePrincipalRecordV2>): this;
  agentPassport(passport: SignedPayload<AgentPassportV2>): this;
  intent(intent: SignedPayload<IntentV2>): this;
  policyDecision(policy: SignedPayload<PolicyDecisionV2>): this;
  addAuditEntry(entry: AuditEventV2): this;
  addAuditEntries(entries: AuditEventV2[]): this;
  addPQCheckpoint(checkpoint: PQCheckpoint): this;
  addPQCheckpoints(checkpoints: PQCheckpoint[]): this;
  enableDualHash(): this;
  build(): CitizenshipBundleV2;     // Throws on validation errors
}
```

```typescript
const bundle = new BundleBuilderV2(sessionNonce)
  .responsiblePrincipalRecord(signedRpr)
  .agentPassport(signedPassport)
  .intent(signedIntent)
  .policyDecision(signedPolicy)
  .addAuditEntries(events)
  .addPQCheckpoints(checkpoints)
  .enableDualHash()
  .build();
```

The builder:
- Validates session nonce consistency across all artifacts
- Computes the `BundleManifest` with SHA-256 hashes of each artifact
- Computes the audit Merkle root (+ optional SHA3-256 secondary root)
- Throws if any required artifact is missing

### `signBundleV2(bundle, options)`

Sign a V2 bundle with a composite (hybrid) signature over the manifest.

```typescript
async function signBundleV2(
  bundle: CitizenshipBundleV2,
  options: SignBundleV2Options,
): Promise<SignedBundleV2>;

interface SignBundleV2Options {
  registry: AlgorithmRegistry;
  signerType: SignerType;       // 'human' | 'organization'
  signerId: string;
  keys: CompositeKeyPair;
  dualHash?: boolean;
}
```

### `signBundleV2ClassicalOnly(bundle, options)`

Sign a V2 bundle with a classical-only signature (transition mode).

```typescript
async function signBundleV2ClassicalOnly(
  bundle: CitizenshipBundleV2,
  options: SignBundleV2ClassicalOnlyOptions,
): Promise<SignedBundleV2>;

interface SignBundleV2ClassicalOnlyOptions {
  registry: AlgorithmRegistry;
  signerType: SignerType;
  signerId: string;
  key: CompositeKeyInfo;
}
```

---

## V2 Verification

### `verifySignedBundleV2(signedBundle, registry, policy?)`

Full V2 signed bundle verification with verifier-authoritative policy.

```typescript
async function verifySignedBundleV2(
  signedBundle: SignedBundleV2,
  registry: AlgorithmRegistry,
  policy?: VerifierPolicy,
): Promise<VerifyV2Result>;
```

| Param | Type | Description |
|-------|------|-------------|
| `signedBundle` | `SignedBundleV2` | The signed bundle to verify |
| `registry` | `AlgorithmRegistry` | Algorithm registry with providers |
| `policy` | `VerifierPolicy` | Verifier policy (defaults to `DEFAULT_VERIFIER_POLICY`) |

**Returns:**

```typescript
interface VerifyV2Result {
  verified: boolean;
  errors: string[];
  warnings: string[];
  details?: {
    session_nonce?: string;
    manifest_valid?: boolean;
    signature_valid?: boolean;
    policy_satisfied?: boolean;
    hash_chain_valid?: boolean;
    pq_checkpoints_valid?: boolean;
    verification_mode?: VerificationMode;
    advisory_rejected_algs?: string[];
  };
}
```

**Verification pipeline:**

1. Schema detection (V1 vs V2)
2. Payload hash verification for all signed artifacts
3. Session nonce consistency across all artifacts
4. Manifest integrity (recompute all artifact hashes + audit Merkle root)
5. Verifier policy mode resolution (based on risk tier)
6. Algorithm validation against policy
7. Composite signature verification over manifest
8. Policy mode enforcement (hybrid_required, hybrid_preferred, classical_only, pq_only)
9. Audit hash chain validation (prev_hash links)
10. Key validity checks (revocation, expiry, age)

```typescript
import { verifySignedBundleV2, getDefaultRegistry, DEFAULT_VERIFIER_POLICY } from '@dcp-ai/sdk';

const result = await verifySignedBundleV2(signedBundle, registry);
if (result.verified) {
  console.log('Mode:', result.details?.verification_mode);
} else {
  console.error('Errors:', result.errors);
  console.warn('Warnings:', result.warnings);
}
```

### `DEFAULT_VERIFIER_POLICY`

The default verifier policy:

```typescript
const DEFAULT_VERIFIER_POLICY: VerifierPolicy = {
  default_mode: 'hybrid_preferred',
  risk_overrides: {
    low: 'classical_only',
    medium: 'hybrid_preferred',
    high: 'hybrid_required',
  },
  min_classical: 1,
  min_pq: 1,
  accepted_classical_algs: ['ed25519'],
  accepted_pq_algs: ['ml-dsa-65', 'slh-dsa-192f'],
  accepted_hash_algs: ['sha256', 'sha384'],
  require_session_binding: true,
  require_composite_binding: true,
  max_key_age_days: 365,
  allow_v1_bundles: true,
};
```

### `verifySignedBundle(signedBundle)` (V1)

Verify a V1 Ed25519-signed bundle.

```typescript
function verifySignedBundle(signedBundle: SignedBundle): VerificationResult;

interface VerificationResult {
  verified: boolean;
  errors?: string[];
}
```

---

## Security Tier Engine

### `computeSecurityTier(intent)`

Compute the appropriate security tier based on the intent's risk profile.

```typescript
function computeSecurityTier(intent: IntentV2): SecurityTier;
```

**Decision logic:**

| Condition | Tier |
|-----------|------|
| `risk_score >= 800` or credentials/children's data | `'maximum'` |
| `risk_score >= 500` or PII/financial/payment data | `'elevated'` |
| `risk_score >= 200` | `'standard'` |
| `risk_score < 200` | `'routine'` |

```typescript
import { computeSecurityTier } from '@dcp-ai/sdk';

const tier = computeSecurityTier(intent);
// 'routine' | 'standard' | 'elevated' | 'maximum'
```

### `tierToVerificationMode(tier)`

Map a security tier to its verification mode.

```typescript
function tierToVerificationMode(tier: SecurityTier): VerificationMode;
```

| Tier | Verification Mode |
|------|------------------|
| `routine` | `'classical_only'` |
| `standard` | `'hybrid_preferred'` |
| `elevated` | `'hybrid_required'` |
| `maximum` | `'hybrid_required'` |

### `tierToCheckpointInterval(tier)`

Map a security tier to the PQ checkpoint interval.

```typescript
function tierToCheckpointInterval(tier: SecurityTier): number;
```

| Tier | Interval (events) |
|------|--------------------|
| `routine` | 50 |
| `standard` | 10 |
| `elevated` | 1 |
| `maximum` | 1 |

### `maxTier(a, b)`

Return the strictest (highest-rank) of two tiers. Useful for combining an auto-computed tier with an explicit override.

```typescript
function maxTier(a: SecurityTier, b: SecurityTier): SecurityTier;

maxTier('routine', 'elevated'); // 'elevated'
maxTier('maximum', 'standard'); // 'maximum'
```

---

## A2A Protocol (DCP-04)

Agent-to-Agent secure communication protocol with post-quantum key exchange.

### `createHello(bundle, kemPubKey, capabilities, tier)`

Create an A2A_HELLO handshake message (initiator side).

```typescript
function createHello(
  initiatorBundle: Record<string, unknown>,
  kemPublicKeyB64: string,
  requestedCapabilities: string[],
  securityTier: string,
): A2AHello;
```

```typescript
interface A2AHello {
  type: 'A2A_HELLO';
  protocol_version: '2.0';
  initiator_bundle: Record<string, unknown>;
  ephemeral_kem_public_key: { alg: string; public_key_b64: string };
  nonce: string;
  supported_algorithms: {
    signing: string[];   // ['ed25519', 'ml-dsa-65']
    kem: string[];       // ['x25519-ml-kem-768']
    cipher: string[];    // ['aes-256-gcm']
  };
  requested_capabilities: string[];
  security_tier: string;
  timestamp: string;
}
```

### `createWelcome(bundle, kemPubKey, kemCiphertext, tier)`

Create an A2A_WELCOME handshake message (responder side).

```typescript
function createWelcome(
  responderBundle: Record<string, unknown>,
  kemPublicKeyB64: string,
  kemCiphertextB64: string,
  resolvedTier: string,
): A2AWelcome;
```

### `createSession(sessionId, key, localId, remoteId, tier, rekeyInterval?)`

Create a new encrypted A2A session after handshake completion.

```typescript
function createSession(
  sessionId: string,
  sessionKey: Uint8Array,
  localAgentId: string,
  remoteAgentId: string,
  securityTier: string,
  rekeyingInterval?: number,       // Default: 1000 messages
): A2ASession;
```

```typescript
interface A2ASession {
  session_id: string;
  session_key: Uint8Array;
  agent_id_local: string;
  agent_id_remote: string;
  message_counter_send: number;
  message_counter_recv: number;
  created_at: string;
  last_activity: string;
  security_tier: string;
  rekeying_interval: number;
  status: 'active' | 'rekeying' | 'closed';
}
```

### `encryptMessage(session, payload)`

Encrypt a message within an A2A session using AES-256-GCM with associated data.

```typescript
function encryptMessage(
  session: A2ASession,
  payload: Record<string, unknown>,
): EncryptedMessage;
```

```typescript
interface EncryptedMessage {
  session_id: string;
  sequence: number;
  type: 'A2A_MESSAGE';
  encrypted_payload: string;        // Base64-encoded ciphertext
  iv: string;                       // Base64-encoded 12-byte IV
  tag: string;                      // Base64-encoded 16-byte GCM auth tag
  sender_agent_id: string;
  timestamp: string;
}
```

### `decryptMessage(session, message)`

Decrypt an incoming A2A message.

```typescript
function decryptMessage(
  session: A2ASession,
  message: EncryptedMessage,
): Record<string, unknown>;
```

### `needsRekeying(session)`

Check whether the session needs rekeying based on message count.

```typescript
function needsRekeying(session: A2ASession): boolean;
```

### `deriveSessionId(agentIdA, agentIdB, nonceA, nonceB, sessionKey)`

Deterministically derive a session ID from agent IDs, nonces, and session key.

```typescript
function deriveSessionId(
  agentIdA: string, agentIdB: string,
  nonceA: string, nonceB: string,
  sessionKey: Uint8Array,
): string;
```

### `generateResumeProof(session, lastSeenSequence)` / `verifyResumeProof(...)`

Generate and verify HMAC-based session resume proofs.

```typescript
function generateResumeProof(session: A2ASession, lastSeenSequence: number): string;
function verifyResumeProof(session: A2ASession, lastSeenSequence: number, proof: string): boolean;
```

### `deriveRekeyedSessionKey(oldKey, newSecret, sessionId)`

Derive a new session key for rekeying operations.

```typescript
function deriveRekeyedSessionKey(
  oldSessionKey: Uint8Array,
  newSharedSecret: Uint8Array,
  sessionId: string,
): Uint8Array;
```

### `createCloseMessage(sessionId, reason, finalSequence, auditHash)`

Create an A2A_CLOSE message.

```typescript
function createCloseMessage(
  sessionId: string,
  reason: 'complete' | 'timeout' | 'error' | 'revocation' | 'policy_violation',
  finalSequence: number,
  auditSummaryHash: string,
): A2AClose;
```

### `generateNonce()`

Generate a 32-byte cryptographic random nonce (hex-encoded).

```typescript
function generateNonce(): string;
```

---

## Telemetry & Observability

### `dcpTelemetry`

Singleton telemetry instance for the DCP SDK.

```typescript
import { dcpTelemetry } from '@dcp-ai/sdk';
```

### `dcpTelemetry.init(config)`

Initialize telemetry with the given configuration.

```typescript
dcpTelemetry.init(config: Partial<DcpTelemetryConfig>): void;

interface DcpTelemetryConfig {
  serviceName: string;              // Identifier for this agent/service
  enabled: boolean;                 // Enable/disable telemetry
  exporterType?: 'console' | 'otlp' | 'none';
  otlpEndpoint?: string;           // OTLP collector endpoint
  metricsInterval?: number;        // Metrics export interval (ms)
}
```

```typescript
dcpTelemetry.init({
  serviceName: 'my-agent',
  enabled: true,
  exporterType: 'console',
});
```

### `dcpTelemetry.startSpan(name, attributes?)` / `endSpan(spanId, status?, error?)`

Create and complete tracing spans for operations.

```typescript
startSpan(name: string, attributes?: SpanAttributes): string;
endSpan(spanId: string, status?: 'ok' | 'error', error?: string): number;

// Returns duration in milliseconds
```

```typescript
const spanId = dcpTelemetry.startSpan('verify_bundle', { tier: 'elevated' });
// ... operation ...
const durationMs = dcpTelemetry.endSpan(spanId);
```

### `dcpTelemetry.recordSignLatency(durationMs, algorithm)`

Record a signing operation latency.

```typescript
recordSignLatency(durationMs: number, algorithm: string): void;
```

### `dcpTelemetry.recordVerifyLatency(durationMs, algorithm)`

Record a verification operation latency.

```typescript
recordVerifyLatency(durationMs: number, algorithm: string): void;
```

### `dcpTelemetry.recordKemLatency(durationMs, operation)`

Record a KEM (key encapsulation) operation latency.

```typescript
recordKemLatency(durationMs: number, operation: 'encapsulate' | 'decapsulate'): void;
```

### `dcpTelemetry.recordCheckpointLatency(durationMs, tier)`

Record a PQ checkpoint creation latency.

```typescript
recordCheckpointLatency(durationMs: number, tier: string): void;
```

### `dcpTelemetry.recordBundleVerify(durationMs, success, tier)`

Record a bundle verification operation.

```typescript
recordBundleVerify(durationMs: number, success: boolean, tier: string): void;
```

### `dcpTelemetry.recordCacheHit()` / `recordCacheMiss()`

Track verification cache hit/miss rates.

```typescript
recordCacheHit(): void;
recordCacheMiss(): void;
```

### `dcpTelemetry.recordA2ASession()` / `recordA2AMessage()`

Track A2A protocol usage.

```typescript
recordA2ASession(): void;
recordA2AMessage(): void;
```

### `dcpTelemetry.recordError(operation, error)`

Record an error occurrence.

```typescript
recordError(operation: string, error: string): void;
```

### `dcpTelemetry.getMetricsSummary()`

Get a summary of all collected metrics with percentile statistics.

```typescript
getMetricsSummary(): MetricsSummary;

interface MetricsSummary {
  sign: PercentileStats;
  verify: PercentileStats;
  kem: PercentileStats;
  checkpoint: PercentileStats;
  bundleVerify: PercentileStats;
  cacheHitRate: number;            // 0.0 – 1.0
  tierDistribution: Record<string, number>;
  totals: {
    signaturesCreated: number;
    signaturesVerified: number;
    bundlesVerified: number;
    errors: number;
    a2aSessions: number;
    a2aMessages: number;
  };
}

interface PercentileStats {
  count: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
  mean: number;
}
```

### `dcpTelemetry.onEvent(listener)`

Subscribe to telemetry events. Returns an unsubscribe function.

```typescript
onEvent(listener: (event: TelemetryEvent) => void): () => void;

interface TelemetryEvent {
  type: string;
  timestamp: number;
  [key: string]: unknown;
}
```

### `dcpTelemetry.reset()`

Reset all collected spans and metrics.

```typescript
reset(): void;
```

---

## Hashing & Merkle Trees

### `hashObject(obj)`

SHA-256 hash of a canonicalized JSON object.

```typescript
function hashObject(obj: unknown): string;
```

### `merkleRootFromHexLeaves(leaves)`

Compute a Merkle root from hex-encoded leaf hashes.

```typescript
function merkleRootFromHexLeaves(leaves: string[]): string;
```

### `merkleRootForAuditEntries(entries)`

Compute a Merkle root for an array of audit entries.

```typescript
function merkleRootForAuditEntries(entries: AuditEntry[]): string;
```

### `intentHash(intent)`

Compute the hash of an intent object.

```typescript
function intentHash(intent: unknown): string;
```

### `prevHashForEntry(entry)`

Compute the prev_hash chain link for an audit entry.

```typescript
function prevHashForEntry(entry: unknown): string;
```

### `sha256Hex(data)` / `sha3_256Hex(data)`

Hex-encoded hashes.

```typescript
function sha256Hex(data: Uint8Array | Buffer): string;
function sha3_256Hex(data: Uint8Array | Buffer): string;
```

### `dualHash(data)` / `dualHashCanonical(obj)` / `dualMerkleRoot(entries)`

Dual-hash (SHA-256 + SHA3-256) operations for V2.

```typescript
function dualHash(data: Uint8Array): DualHash;
function dualHashCanonical(obj: unknown): DualHash;
function dualMerkleRoot(entries: unknown[]): DualHash;

interface DualHash {
  sha256: string;
  sha3_256: string;
}
```

### `auditEventsMerkleRoot(entries)`

Compute the SHA-256 Merkle root for V2 audit events.

```typescript
function auditEventsMerkleRoot(entries: AuditEventV2[]): string;
```

---

## Schema Validation

### `validateSchema(type, data)`

Validate a DCP artifact against its JSON Schema.

```typescript
function validateSchema(type: string, data: unknown): ValidationResult;
```

### `validateBundle(bundle)`

Validate an entire citizenship bundle.

```typescript
function validateBundle(bundle: unknown): ValidationResult;

interface ValidationResult {
  valid: boolean;
  errors?: string[];
}
```

---

## Domain Separation

### `DCP_CONTEXTS`

Pre-defined domain separation contexts for different DCP operations.

```typescript
const DCP_CONTEXTS: Record<string, DcpContext>;
// Includes: RPR, AgentPassport, Intent, PolicyDecision, AuditEvent, Bundle, PQCheckpoint, etc.
```

### `domainSeparatedMessage(context, payload)`

Prepend a domain separation context to a message before signing.

```typescript
function domainSeparatedMessage(context: DcpContext | string, payload: Uint8Array): Uint8Array;
```

---

## Session Nonces

### `generateSessionNonce()`

Generate a cryptographic session nonce for anti-splicing protection.

```typescript
function generateSessionNonce(): string;
```

### `isValidSessionNonce(nonce)`

Validate that a string is a valid 64-character hex session nonce.

```typescript
function isValidSessionNonce(nonce: string): boolean;
```

### `verifySessionBinding(artifacts)`

Verify that all artifacts share the same session nonce.

```typescript
function verifySessionBinding(artifacts: Array<{ session_nonce?: string }>): {
  valid: boolean;
  nonce?: string;
  error?: string;
};
```

---

## Key Recovery

### `shamirSplit(secret, totalShares, threshold)`

Split a secret key into M-of-N Shamir shares.

```typescript
function shamirSplit(secret: Uint8Array, totalShares: number, threshold: number): ShamirShare[];

interface ShamirShare {
  index: number;
  data: Uint8Array;
}
```

### `shamirReconstruct(shares)`

Reconstruct a secret from Shamir shares.

```typescript
function shamirReconstruct(shares: ShamirShare[]): Uint8Array;
```

### `setupKeyRecovery(humanId, secretKey, holders, threshold)`

Set up key recovery with M-of-N social recovery configuration.

```typescript
function setupKeyRecovery(
  humanId: string,
  secretKey: Uint8Array,
  holders: RecoveryShareHolder[],
  threshold: number,
): RecoverySetup;
```

---

## Emergency Revocation

### `generateEmergencyRevocationToken()`

Generate a token pair for emergency agent revocation.

```typescript
function generateEmergencyRevocationToken(): EmergencyRevocationTokenPair;

interface EmergencyRevocationTokenPair {
  token: string;      // Stored in agent passport (public)
  secret: string;     // Kept by human principal (secret)
}
```

### `verifyEmergencyRevocationSecret(token, secret)`

Verify an emergency revocation secret against its public token.

```typescript
function verifyEmergencyRevocationSecret(token: string, secret: string): boolean;
```

### `buildEmergencyRevocation(agentId, humanId, secret)`

Build an emergency revocation record.

```typescript
function buildEmergencyRevocation(
  agentId: string,
  humanId: string,
  secret: string,
): EmergencyRevocation;
```

---

## Bundle Presentation

### `suggestPresentationMode(bundle, context?)`

Suggest the optimal presentation mode for a bundle.

```typescript
function suggestPresentationMode(bundle: SignedBundleV2, context?: Record<string, unknown>): PresentationMode;

type PresentationMode = 'full' | 'compact' | 'reference' | 'incremental';
```

### `presentFull(bundle)` / `presentCompact(bundle)` / `presentReference(bundle)` / `presentIncremental(bundle, delta)`

Generate different presentation formats for bundle transmission.

```typescript
function presentFull(bundle: SignedBundleV2): FullPresentation;
function presentCompact(bundle: SignedBundleV2): CompactPresentation;
function presentReference(bundle: SignedBundleV2): ReferencePresentation;
function presentIncremental(bundle: SignedBundleV2, delta: IncrementalDelta): IncrementalPresentation;
```

### `computeBundleHash(bundle)`

Compute the hash of a signed bundle for reference presentations.

```typescript
function computeBundleHash(bundle: SignedBundleV2): string;
```

---

## Verification Cache

### `VerificationCache`

In-memory LRU cache for verification results to avoid redundant cryptographic operations.

```typescript
class VerificationCache {
  constructor(options?: VerificationCacheOptions);
  get(key: string): CacheEntry | undefined;
  set(key: string, entry: CacheEntry): void;
  has(key: string): boolean;
  clear(): void;
}

interface VerificationCacheOptions {
  maxSize?: number;         // Default: 1000
  ttlMs?: number;           // Default: 300000 (5 minutes)
}

interface CacheEntry {
  verified: boolean;
  timestamp: number;
  details?: unknown;
}
```

---

## CBOR Wire Format

Compact binary serialization for DCP bundles.

### `cborEncode(data)` / `cborDecode(bytes)`

```typescript
function cborEncode(data: unknown): Uint8Array;
function cborDecode(bytes: Uint8Array): unknown;
```

### `jsonToCborPayload(json)` / `cborPayloadToJson(bytes)`

Convert between JSON objects and CBOR payloads.

```typescript
function jsonToCborPayload(json: unknown): Uint8Array;
function cborPayloadToJson(bytes: Uint8Array): unknown;
```

### `detectWireFormat(data)`

Detect whether data is JSON or CBOR encoded.

```typescript
function detectWireFormat(data: Uint8Array | string): 'json' | 'cbor';
```

---

## Crypto Providers

### `registerDefaultProviders()`

Register the default Ed25519 + ML-DSA-65 + SLH-DSA-192f providers.

```typescript
function registerDefaultProviders(): void;
```

### `getDefaultRegistry()`

Get the default `AlgorithmRegistry` with all registered providers.

```typescript
function getDefaultRegistry(): AlgorithmRegistry;
```

### `AlgorithmRegistry`

Registry for algorithm providers.

```typescript
class AlgorithmRegistry {
  register(provider: CryptoProvider): void;
  getSigner(alg: string): CryptoProvider;
  has(alg: string): boolean;
}
```

### Available Providers

| Provider | Algorithm | Type |
|----------|-----------|------|
| `Ed25519Provider` | `ed25519` | Classical signing |
| `MlDsa65Provider` | `ml-dsa-65` | Post-quantum signing (NIST ML-DSA) |
| `SlhDsa192fProvider` | `slh-dsa-192f` | Post-quantum signing (NIST SLH-DSA) |

### `CryptoProvider` Interface

```typescript
interface CryptoProvider {
  readonly algorithm: string;
  generateKeyPair(): Promise<{ publicKeyB64: string; secretKeyB64: string }>;
  sign(message: Uint8Array, secretKeyB64: string): Promise<Uint8Array>;
  verify(message: Uint8Array, signature: Uint8Array, publicKeyB64: string): Promise<boolean>;
}
```

---

## Version Detection

### `detectDcpVersion(artifact)`

Detect the DCP version of an artifact or bundle.

```typescript
function detectDcpVersion(artifact: Record<string, unknown>): '1.0' | '2.0' | null;
```
