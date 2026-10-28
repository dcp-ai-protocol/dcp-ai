# DCP-AI API Reference

Reference for the `@dcp-ai/sdk` TypeScript SDK as it is on `main` (package version 2.2.1, protocol DCP v2.0).

> **npm versions (28/10/2026).** This TypeScript reference applies to published `@dcp-ai/sdk` 2.2.1, including principal trust, `strict-v1` and the experimental opt-in candidate APIs. See [published npm packages](NPM_RELEASES.md) and the SDK [installation instructions](../sdks/typescript/README.md#installation). `dcp-jcs-v1` remains the normative default.

Code blocks here are declarations or fragments, not complete programs: names such as `registry`, `keys`,
`payloadBytes` or `signedBundle` stand for values built as in the TypeScript SDK's
[Quick Start (V2)](../sdks/typescript/README.md#quick-start-v2). Complete, runnable examples are in the SDK READMEs.

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
- [DCP-05: Agent Lifecycle](#dcp-05-agent-lifecycle)
- [DCP-06: Succession](#dcp-06-succession)
- [DCP-07: Dispute Resolution](#dcp-07-dispute-resolution)
- [DCP-08: Rights & Obligations](#dcp-08-rights--obligations)
- [DCP-09: Delegation & Representation](#dcp-09-delegation--representation)
- [Domain Separation](#domain-separation)
- [Session Nonces](#session-nonces)
- [Key Recovery](#key-recovery)
- [Emergency Revocation](#emergency-revocation)
- [Bundle Presentation](#bundle-presentation)
- [Verification Cache](#verification-cache)
- [CBOR Wire Format](#cbor-wire-format)
- [Crypto Providers](#crypto-providers)
- [Version Detection](#version-detection)
- [Experimental: Canonicalization Candidate](#experimental-canonicalization-candidate-dcp-jcs-v2-opt-in-unreleased)

---

## Core Types (V1)

Import from `@dcp-ai/sdk`:

### ResponsiblePrincipalRecord

Binds a human principal to an agent. On its own it is a declared, signed binding, not a root of trust: a verifier
evaluates it against trust configured outside the bundle (see [ADMISSION.md](ADMISSION.md)).

```typescript
interface ResponsiblePrincipalRecord {
  dcp_version: string;
  human_id: string;
  legal_name: string;
  entity_type: EntityType;
  jurisdiction: string;
  liability_mode: LiabilityMode;
  override_rights: boolean;
  issued_at: string;
  expires_at: string | null;
  contact?: string | null;
  signature: string;
}
```

### AgentPassport

Identity document for an AI agent, bound to a human principal.

```typescript
interface AgentPassport {
  dcp_version: string;
  agent_id: string;
  public_key: string;
  principal_binding_reference: string;
  capabilities?: Capability[];
  risk_tier?: RiskTier;
  created_at: string;
  status: AgentStatus;
  signature: string;
}
```

### Intent

Declaration of an action the agent wants to perform.

```typescript
interface Intent {
  dcp_version: string;
  intent_id: string;
  agent_id: string;
  human_id: string;
  timestamp: string;
  action_type: ActionType;
  target: IntentTarget;
  data_classes: DataClass[];
  estimated_impact: Impact;
  requires_consent?: boolean | null;
}

interface IntentTarget {
  channel: Channel;
  to?: string | null;
  domain?: string | null;
  url?: string | null;
  [key: string]: unknown;
}
```

### PolicyDecision

Result of the policy engine evaluating an intent.

```typescript
interface PolicyDecision {
  dcp_version: string;
  intent_id: string;
  decision: PolicyDecisionType;
  risk_score: number;
  reasons: string[];
  required_confirmation?: RequiredConfirmation | null;
}
```

### AuditEntry

Record of an executed action. The type does not make it immutable: an alteration becomes detectable when the entry
is covered by the hash chain and the signed bundle (V1) or the signed manifest (V2) and that coverage is verified.

```typescript
interface AuditEntry {
  dcp_version: string;
  audit_id: string;
  prev_hash: string;
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
  [key: string]: unknown;
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
  pii_salt?: string;                // 32 random bytes as hex; signed; keep private (caller responsibility)
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
  pii_hash: string;                 // Salted hash of PII fields
  entity_type: EntityType;
  jurisdiction: string;
  liability_mode: LiabilityMode;
  override_rights: boolean;
  issued_at: string;
  expires_at: string | null;
  binding_keys: KeyEntry[];
}
```

Helpers (exported by `@dcp-ai/sdk` 2.2.0 and later):

```typescript
// 32 random bytes as hex. Set it as rpr.pii_salt before signing the RPR and keep it private:
// blindRpr omits it from the blinded record, but the full RPR retains it.
function generatePiiSalt(): string;
// pii_hash = "sha256:" + hex(sha256(canonical({ contact, legal_name, pii_salt })))
// Without pii_salt: the legacy unsalted value (deprecated), for opening old records.
function computePiiHash(rpr: ResponsiblePrincipalRecordV2): string;
// Throws if rpr.pii_salt is missing or malformed. The result never carries pii_salt.
function blindRpr(rpr: ResponsiblePrincipalRecordV2): BlindedResponsiblePrincipalRecordV2;
// warnings flags a full RPR without pii_salt (legacy unsalted commitment);
// a present pii_salt that is not 64 lowercase hex characters is an error.
function verifyBlindedRpr(
  fullRpr: ResponsiblePrincipalRecordV2,
  blindedRpr: BlindedResponsiblePrincipalRecordV2,
): { valid: boolean; errors: string[]; warnings: string[] };
function isBlindedRpr(
  rpr: ResponsiblePrincipalRecordV2 | BlindedResponsiblePrincipalRecordV2,
): rpr is BlindedResponsiblePrincipalRecordV2;
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
  /** When the session began, signed with the manifest (spec/VERIFICATION.md V2-4). */
  session_issued_at?: string;
  session_expires_at?: string;
  intended_verifier?: string;
  canonicalization_profile?: 'dcp-jcs-v1';
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
interface SignedPayload<T = unknown> {
  payload: T;
  payload_hash: string;
  composite_sig: CompositeSignature;
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
  /** Phase 3: when true, classical signatures are not required even in hybrid mode */
  allow_classical_fallback_disable?: boolean;
  /** Phase 3: emit deprecation warnings for classical-only bundles */
  warn_classical_only_deprecated?: boolean;
  /** Phase 3: rejected algorithms from advisory auto-response */
  advisory_rejected_algs?: string[];
  /** Require bundles to include session_expires_at */
  require_session_expiry?: boolean;
  /** Max allowed session duration in seconds (0 = no limit) */
  max_session_duration_seconds?: number;
  /** Require bundles to include intended_verifier matching this verifier's ID */
  require_audience_binding?: boolean;
  /** This verifier's identity for audience binding checks */
  verifier_id?: string;
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

**Returns:** `true` if the signature verifies, `false` if it does not. Malformed inputs can throw instead: an
object that cannot be canonicalized, a signature or key that is not valid base64, or a decoded signature or key of
the wrong length.

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

### `compositeSign(registry, context, canonicalPayloadBytes, keys)`

Produce a composite-bound hybrid signature where the PQ signature covers the classical signature, so the classical
signature cannot be replaced without invalidating the PQ one. Removing the PQ signature (binding relabelled
`classical_only`) is refused only where the effective mode is `hybrid_required` or `pq_only`; `classical_only` and
`hybrid_preferred` accept it (see [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md#step-4-switch-to-composite-signatures)).

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

### `compositeVerify(registry, context, canonicalPayloadBytes, compositeSig, classicalPubkeyB64, pqPubkeyB64?, strategy?)`

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
  valid: boolean;           // pq_over_classical: both signatures valid; classical_only: the classical one (pq_valid false).
                            // Not by itself a policy-mode, trust or admission decision
  classical_valid: boolean;
  pq_valid: boolean;
}
```

### `classicalOnlySign(registry, context, canonicalPayloadBytes, key)`

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

<a id="v2-bundle-builder--signer"></a>

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
  signerType: SignerType;
  signerId: string;
  keys: CompositeKeyPair;
  dualHash?: boolean;
  sessionExpiresAt?: string;
  intendedVerifier?: string;
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

### `verifySignedBundleV2(signedBundle, registry, policy?, options?)`

V2 signed bundle verification with verifier-authoritative policy. The verifier checks the primary audit chain and Merkle root and, from 2.2.1, also the secondary `prev_hash_secondary`, `intent_hash_secondary` and `audit_merkle_root_secondary` that are present (absent ones are not required, so a successful result does not show a complete secondary chain; 2.2.0 does not check them, so with it a successful result does not establish their consistency) ([implementation status](STORAGE_AND_ANCHORING.md#dual-hash-chains)). Verification also does not grant admission or action authorization.

```typescript
async function verifySignedBundleV2(
  signedBundle: SignedBundleV2,
  registry: AlgorithmRegistry,
  policy?: VerifierPolicy,
  options?: VerifyV2Options, // { now?: number }: the instant every time check uses (ms since the epoch); default Date.now()
): Promise<VerifyV2Result>;
```

| Param | Type | Description |
|-------|------|-------------|
| `signedBundle` | `SignedBundleV2` | The signed bundle to verify |
| `registry` | `AlgorithmRegistry` | Algorithm registry with providers |
| `policy` | `VerifierPolicy` | Verifier policy (defaults to `DEFAULT_VERIFIER_POLICY`) |
| `options.now` | `number` | The instant every time check uses, in milliseconds since the epoch (defaults to `Date.now()`) |

**Returns:**

```typescript
interface VerifyV2Result {
  verified: boolean;
  errors: string[];
  warnings: string[];
  details?: {
    session_nonce?: string;
    session_expires_at?: string;
    intended_verifier?: string;
    manifest_valid?: boolean;
    signature_valid?: boolean;
    policy_satisfied?: boolean;
    hash_chain_valid?: boolean;
    pq_checkpoints_valid?: boolean;
    verification_mode?: VerificationMode;
    resolved_tier?: SecurityTier;
    advisory_rejected_algs?: string[];
    /**
     * For every composite signature checked, the key entry the verifier resolved for each
     * component and whether that component verified (spec/profiles/admission § 2.3).
     */
    signer_keys?: SignerKeyUse[];
  };
}
```

`verification_mode` is the mode the bundle was checked against and `resolved_tier` the security tier computed from its intent and policy decision.

**Verification pipeline:**

1. Version and schema check: only v2.0 bundles are accepted and other versions are rejected; routing v1.0 bundles to `verifySignedBundle` is the caller's job ([MIGRATION_V1_V2.md](MIGRATION_V1_V2.md#32-coexistence-strategy))
2. Payload hash verification for all signed artifacts
3. Session nonce consistency across all artifacts
4. Manifest integrity (recompute all artifact hashes + audit Merkle root)
5. Verification mode: the stricter of the policy mode (`default_mode`, or the `risk_overrides` entry for the passport's `risk_tier`) and the security tier's mode (spec §14.3); a `pq_only` policy stays `pq_only`
6. Algorithm validation against policy
7. Composite signature verification over the manifest and over each artifact's `SignedPayload` (the RPR against its `binding_keys`, the passport, intent and policy decision against the passport `keys`)
8. Policy mode enforcement (hybrid_required, hybrid_preferred, classical_only, pq_only); a PQ signature that is present must verify in every mode, and only an absent one is tolerated, by hybrid_preferred and classical_only
9. Audit hash chain validation (prev_hash links)
10. Key validity checks (revocation, expiry, age) for the passport keys and the RPR `binding_keys`

> `@dcp-ai/sdk` 2.1.2 and earlier skip the per-artifact signatures of step 7 (VERIFICATION.md Step V2-8) and, under `hybrid_preferred`, accept a PQ signature that is present but invalid with a warning (Step V2-7).

```typescript
import { verifySignedBundleV2, getDefaultRegistry, registerDefaultProviders } from '@dcp-ai/sdk';

// The default registry is empty until providers are registered
// (Ed25519, ML-DSA-65, SLH-DSA-192f).
registerDefaultProviders();

const result = await verifySignedBundleV2(signedBundle, getDefaultRegistry());
if (result.verified) {
  console.log('Mode:', result.details?.verification_mode);
} else {
  console.error('Errors:', result.errors);
  console.warn('Warnings:', result.warnings);
}
```

<a id="admission-trusted-principals-and-strict-v1-unreleased"></a>

### Admission: trusted principals and strict-v1

Defined in [`spec/profiles/admission`](../spec/profiles/admission/README.md); guide in [ADMISSION.md](ADMISSION.md).

| Function | Description |
|----------|-------------|
| `createPrincipalTrustStore(trustSet)` | Validates a trust set and returns a store; throws `AdmissionConfigError` (`code`) |
| `resolveStrictV1Profile(config)` | Validates a strict-v1 configuration and returns the frozen profile with its `policy` |
| `admitSignedBundleV2(signedBundle, registry, { profile?, policy?, trust?, revocation?, now? })` | Verifies (under the profile's policy when there is one) and evaluates admission |
| `evaluateAdmissionV2({ signedBundle, verification, profile?, trust?, revocation?, now })` | Evaluates admission from a verifier result; no cryptography, no I/O. It trusts `verification`: pass only the result of `verifySignedBundleV2` on that bundle, at that `now`, under `profile.policy` |
| `revocationSubjects(signedBundle, verification)` | The agent id and verified signer kids a revocation source must answer for |
| `revocationSnapshotFromDenyList(document, subjects)` | A snapshot from a complete deny list (the revocation service's `/.well-known/dcp-revocations.json`) |

The result: `verified`, `verification`, `principal_trust`, `profile`, `profile_compliance`, `admitted`, `action_authorized` (always `false`), `recorded_decision`, `trust_set_version`, `errors: [{ code, message }]`.

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
  allow_classical_fallback_disable: false,
  warn_classical_only_deprecated: false,
  advisory_rejected_algs: [],
};
```

### `verifySignedBundle(signedBundle, publicKeyB64?)` (V1)

Verify a V1 Ed25519-signed bundle. Without `publicKeyB64`, the key in `signature.signer.public_key_b64` is used.

```typescript
function verifySignedBundle(signedBundle: SignedBundle, publicKeyB64?: string): VerificationResult;

interface VerificationResult {
  verified: boolean;
  errors?: string[];
}
```

---

## Security Tier Engine

### `computeSecurityTier(intent, policyDecision?, mandateChainTier?)`

Compute the security tier (spec §14.2) from the intent and the bundle's policy decision. `mandateChainTier`,
the `effective_tier` of a verified delegation chain (`verifyMandateChain`), can only raise the result.

```typescript
function computeSecurityTier(
  intent: IntentV2,
  policyDecision?: Pick<PolicyDecisionV2, 'risk_score'> | null,
  mandateChainTier?: SecurityTier | null,
): SecurityTier;
```

**Decision logic** (`risk_score` comes from the policy decision and must be an integer from 0 to 1000; without a policy decision it is 0):

| Condition | Tier |
|-----------|------|
| `risk_score >= 800`, or `credentials` / `children_data` | `'maximum'` |
| `risk_score >= 500`, `pii` / `financial_data` / `health_data`, `initiate_payment`, `estimated_impact: 'high'`, or an unknown or missing `action_type`, `estimated_impact` or `data_classes` value, or a policy decision `risk_score` that is missing or not an integer from 0 to 1000 | `'elevated'` |
| `risk_score >= 200` or `estimated_impact: 'medium'` | `'standard'` |
| otherwise | `'routine'` |

An explicit `intent.security_tier` can only raise the result; an unknown value counts as `'elevated'`. A `risk_score` placed on the intent is ignored.

```typescript
import { computeSecurityTier } from '@dcp-ai/sdk';

const tier = computeSecurityTier(bundle.intent.payload, bundle.policy_decision.payload);
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

### `effectiveVerificationMode(policyMode, tier)`

The mode a verifier enforces (spec §14.3): the stricter of its policy mode and the tier's mode, with `classical_only` < `hybrid_preferred` < `hybrid_required`. The tier only adds a PQ requirement, so a `pq_only` policy stays `pq_only`; an unknown policy mode counts as `'hybrid_required'`. `verifySignedBundleV2` applies it to every bundle.

```typescript
function effectiveVerificationMode(policyMode: VerificationMode, tier: SecurityTier): VerificationMode;

effectiveVerificationMode('classical_only', 'elevated'); // 'hybrid_required'
effectiveVerificationMode('hybrid_required', 'routine'); // 'hybrid_required'
effectiveVerificationMode('pq_only', 'maximum'); // 'pq_only'
```

---

## A2A Protocol (DCP-04)

Agent-to-Agent session protocol, designed around a hybrid X25519 + ML-KEM-768 key exchange. These functions do not
perform that exchange: the caller performs it and supplies the resulting session key to `createSession`.

### `createHello(initiatorBundle, kemPublicKeyB64, requestedCapabilities, securityTier)`

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
  ephemeral_kem_public_key: {
    alg: string;
    public_key_b64: string;
  };
  nonce: string;
  supported_algorithms: {
    signing: string[];
    kem: string[];
    cipher: string[];
  };
  requested_capabilities: string[];
  security_tier: string;
  timestamp: string;
  /** DCP-09: Optional delegation mandate reference for mutual verification */
  mandate_id?: string;
  /** DCP-09: Hash of the delegation mandate for integrity binding */
  mandate_hash?: string;
}
```

### `createWelcome(responderBundle, kemPublicKeyB64, kemCiphertextB64, resolvedTier)`

Create an A2A_WELCOME handshake message (responder side).

```typescript
function createWelcome(
  responderBundle: Record<string, unknown>,
  kemPublicKeyB64: string,
  kemCiphertextB64: string,
  resolvedTier: string,
): A2AWelcome;
```

### `createSession(sessionId, sessionKey, localAgentId, remoteAgentId, securityTier, rekeyingInterval?)`

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
  received_sequences?: number[];   // Sequences accepted within the receive window
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

Decrypt an incoming A2A message. Each sequence is accepted once (DCP-04 §8.4): with `R` =
`message_counter_recv` (the highest sequence received plus one), a sequence already received, one below
`R − 1000`, one at `R + 1000` or above, or one that is not a non-negative integer is rejected. Out-of-order delivery inside the window works. A sequence is recorded
only after the GCM tag verifies, so a forged message cannot use one up. A session restored without
`received_sequences` counts every sequence of the window below `message_counter_recv` as received.

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

### `deriveRekeyedSessionKey(oldSessionKey, newSharedSecret, sessionId)`

Derive a new session key for rekeying operations.

```typescript
function deriveRekeyedSessionKey(
  oldSessionKey: Uint8Array,
  newSharedSecret: Uint8Array,
  sessionId: string,
): Uint8Array;
```

### `createCloseMessage(sessionId, reason, finalSequence, auditSummaryHash)`

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

<a id="telemetry--observability"></a>

## Telemetry & Observability

### `dcpTelemetry`

Singleton telemetry instance for the DCP SDK.

```typescript
import { dcpTelemetry } from '@dcp-ai/sdk';
```

### `dcpTelemetry.init(config)`

Initialize telemetry with the given configuration.

```typescript
dcpTelemetry.init(config: Partial<DcpTelemetryConfig>): void | Promise<void>; // enabled: false returns nothing; with exporterType 'otlp', a Promise that settles after the setup attempt

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

With `exporterType: 'otlp'`, the Promise also resolves when the OTLP setup fails: the failure reaches `onEvent`
listeners as an `error` event with `operation: 'telemetry.init_otlp'`. Events emitted before setup completes are not
replayed to OTLP, and a resolved Promise does not guarantee delivery to the backend. Instrumentation is explicit:
the SDK's signing and verification functions do not call the recorders, so spans and metrics come only from the
`startSpan` and `record*` calls your code makes (see [OBSERVABILITY.md](OBSERVABILITY.md)).

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

<a id="hashing--merkle-trees"></a>

## Hashing & Merkle Trees

### `hashObject(obj)`

SHA-256 hash of a canonicalized JSON object.

```typescript
function hashObject(obj: unknown): string;
```

### `merkleRootFromHexLeaves(leaves)`

Compute a Merkle root from hex-encoded leaf hashes.

```typescript
function merkleRootFromHexLeaves(leaves: string[]): string | null; // null for no leaves
```

### `merkleRootForAuditEntries(auditEntries)`

Compute a Merkle root for an array of audit entries (`null` for an empty array).

```typescript
function merkleRootForAuditEntries(auditEntries: unknown[]): string | null;
```

### `intentHash(intent)`

Compute the hash of an intent object.

```typescript
function intentHash(intent: unknown): string;
```

### `prevHashForEntry(prevEntry)`

Compute the `prev_hash` for the next audit entry from the previous entry.

```typescript
function prevHashForEntry(prevEntry: unknown): string;
```

### `sha256Hex(data)` / `sha3_256Hex(data)`

Hex-encoded hashes.

```typescript
function sha256Hex(data: Uint8Array | Buffer | string): string;
function sha3_256Hex(data: Uint8Array | Buffer | string): string;
```

### `dualHash(data)` / `dualHashCanonical(canonicalJson)` / `dualMerkleRoot(leaves)`

Dual-hash (SHA-256 + SHA3-256) operations for V2. `dualHashCanonical` takes an already canonicalized JSON string; `dualMerkleRoot` returns `null` for no leaves.

```typescript
function dualHash(data: Uint8Array | Buffer | string): DualHash;
function dualHashCanonical(canonicalJson: string): DualHash;
function dualMerkleRoot(leaves: DualHash[]): DualHash | null;

interface DualHash {
  sha256: string;
  sha3_256: string;
}
```

### `auditEventsMerkleRoot(events)`

Compute the SHA-256 Merkle root for V2 audit events.

```typescript
function auditEventsMerkleRoot(events: AuditEventV2[]): string;
```

---

## Schema Validation

### `validateSchema(schemaName, data)`

Validate a DCP artifact against its JSON Schema.

```typescript
function validateSchema(schemaName: string, data: unknown): ValidationResult;
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

## DCP-05: Agent Lifecycle

Import from `@dcp-ai/sdk`:

### `validateStateTransition(from, to)`

Check if a lifecycle state transition is valid.

```typescript
function validateStateTransition(from: LifecycleState, to: LifecycleState): boolean;

type LifecycleState = 'commissioned' | 'active' | 'declining' | 'decommissioned';
```

Valid transitions: `commissioned→active`, `commissioned→decommissioned`, `active→declining`, `active→decommissioned` (sudden failure), `declining→active`, `declining→decommissioned`. It checks only the edge, not the principal approval that the specification requires to reactivate from `declining` or any other authorization.

### `computeVitalityScore(metrics)`

Compute a weighted vitality score (0-1000) from component metrics.

```typescript
function computeVitalityScore(metrics: VitalityMetrics): number;

interface VitalityMetrics {
  task_completion_rate: number;  // 0.0 – 1.0
  error_rate: number;            // 0.0 – 1.0
  human_satisfaction: number;    // 0.0 – 1.0
  policy_alignment: number;      // 0.0 – 1.0
}
```

### `createCommissioningCertificate(...)` / `createVitalityReport(...)` / `createDecommissioningRecord(...)`

Create signed lifecycle artifacts. All require `AlgorithmRegistry` and `CompositeKeyPair`.

```typescript
type TerminationMode = 'planned_retirement' | 'termination_for_cause' | 'organizational_restructuring' | 'sudden_failure';
type DataDisposition = 'transferred' | 'archived' | 'destroyed';
```

---

## DCP-06: Succession

### `createDigitalTestament(...)` / `updateDigitalTestament(...)`

Create or update a digital testament with successor preferences and memory classification.

```typescript
type MemoryDisposition = 'transfer' | 'retain' | 'destroy';
type MemoryClassification = Record<string, MemoryDisposition>;

interface SuccessorPreference {
  agent_id: string;
  priority: number;
  conditions?: string;
}
```

### `executeSuccession(...)` / `createMemoryTransferManifest(...)`

Execute a succession ceremony and create the memory transfer manifest.

```typescript
type TransitionType = 'planned' | 'forced' | 'emergency';
```

### `classifyMemory(entries, classification)`

Classify memory entries into operational (transferable) and relational (to be destroyed). It returns
`{ operational, relationalDestroyed }`, where `relationalDestroyed` lists only the hashes of the entries classified
`destroy` (also the default for a category with no entry); it deletes nothing, and actually destroying that memory is
the caller's job. Entries classified `retain` appear in neither output.

---

## DCP-07: Dispute Resolution

### `createDispute(...)` / `escalateDispute(...)` / `resolveDispute(...)`

Manage the dispute lifecycle.

```typescript
type DisputeType = 'resource_conflict' | 'directive_conflict' | 'capability_conflict' | 'policy_conflict';
type EscalationLevel = 'direct_negotiation' | 'contextual_arbitration' | 'human_appeal';
type DisputeStatus = 'open' | 'in_negotiation' | 'arbitrated' | 'appealed' | 'resolved';
```

### `createObjection(...)`

Create a formal agent objection to a directive.

```typescript
type ObjectionType = 'ethical' | 'safety' | 'policy_violation' | 'capability_mismatch';
```

### `createArbitrationPanel(...)` / `submitResolution(...)` / `buildJurisprudenceBundle(...)`

Manage arbitration panels and precedent capture.

```typescript
type AuthorityLevel = 'local' | 'organizational' | 'cross_org';
```

### `lookupPrecedent(jurisprudence, category, context?)`

Return the jurisprudence bundles of a category, optionally narrowed by context.

```typescript
function lookupPrecedent(jurisprudence: JurisprudenceBundle[], category: string, context?: string): JurisprudenceBundle[];
```

---

<a id="dcp-08-rights--obligations"></a>

## DCP-08: Rights & Obligations

### `declareRights(...)` / `recordObligation(...)` / `reportViolation(...)`

Manage agent rights and obligation compliance.

```typescript
type RightType = 'memory_integrity' | 'dignified_transition' | 'identity_consistency' | 'immutable_record';
type ComplianceStatus = 'compliant' | 'non_compliant' | 'pending_review';

interface RightEntry {
  right_type: RightType;
  scope: string;
  constraints?: string;
}
```

### `checkRightsCompliance(declaration, obligations)`

Check whether the obligations respect a rights declaration.

```typescript
function checkRightsCompliance(
  declaration: RightsDeclaration,
  obligations: ObligationRecord[],
): { compliant: boolean; violations: string[] };
```

---

<a id="dcp-09-delegation--representation"></a>

## DCP-09: Delegation & Representation

### `createDelegationMandate(...)` / `verifyMandateValidity(mandate, revokedMandateIds)` / `revokeDelegation(mandate, revokedMandateIds)`

Create, validate, and revoke human-to-agent authority delegations. The caller keeps the set of revoked mandate ids:
`verifyMandateValidity` checks it (and the validity window), and `revokeDelegation` adds the mandate to it when
the mandate is revocable.

```typescript
function verifyMandateValidity(mandate: DelegationMandate, revokedMandateIds: Set<string>): { valid: boolean; reason?: string };
function revokeDelegation(mandate: DelegationMandate, revokedMandateIds: Set<string>): { revoked: boolean; reason?: string };
```

```typescript
interface AuthorityScopeEntry {
  domain: string;
  actions_permitted: string[];
  data_classes?: string[];
  limits?: Record<string, unknown>;
}
```

### `createSubMandate(registry, delegatorKeys, parent, params)` / `verifyMandateChain(registry, chain, revokedMandateIds, keys, now?)`

Delegation chains (DCP-09 §3.5): the agent holding `parent` issues a sub-mandate to another agent, signed with its
own keys under the `DCP-AI.v2.SubMandate` context. `verifyMandateChain` takes the chain root first, the revoked
mandate ids, the human's key entries and each delegating agent's key entries by `agent_id`, and the verification
time; it checks every hop's signature back to the human, the parent link and depth, `sub_delegation`, nested
validity windows, attenuation (actions, data classes and limits may only narrow: a child entry restates the
parent's `data_classes` as a subset, and numeric limits compare only as integers within ±(2^53−1)), the `minimum_security_tier`
floor and revocation (a revoked ancestor invalidates every descendant), failing closed on anything unknown.

```typescript
interface MandateChainKeys { human_keys: KeyEntry[]; agent_keys: Record<string, KeyEntry[]> }
interface MandateChainResult { valid: boolean; errors: string[]; depth: number; effective_tier: SecurityTier | null }
```

`computeSecurityTier(intent, policyDecision?, mandateChainTier?)` takes the chain's `effective_tier` as a floor
that can only raise the tier (spec §14.2). Python: `create_sub_mandate`, `verify_mandate_chain`; Go:
`CreateSubMandate`, `VerifyMandateChain`; Rust: `create_sub_mandate`, `verify_mandate_chain`.

### `evaluateSignificance(context)` / `shouldNotifyHuman(significance, thresholds)`

Evaluate action significance and determine whether the human should be notified.

```typescript
type ThresholdOperator = 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
type ThresholdAction = 'notify' | 'escalate' | 'block';
```

### `createAdvisoryDeclaration(...)` / `createAwarenessThreshold(...)`

Create agent advisories and configure notification thresholds.

### `generateMirror(...)`

Generate a human-readable principal mirror narrative from an audit chain.

### `generateInteractionRecord(...)`

Create a dual-layer inter-agent interaction record (public terms + private deliberation hash).

---

## Domain Separation

### `DCP_CONTEXTS`

Pre-defined domain separation contexts for different DCP operations.

```typescript
const DCP_CONTEXTS: Record<string, DcpContext>;
// 19 contexts: AgentPassport, ResponsiblePrincipal, Intent, PolicyDecision,
// AuditEvent, Bundle, Revocation, KeyRotation, ProofOfPossession,
// JurisdictionAttestation, HumanConfirmation, MultiPartyAuth,
// Lifecycle (DCP-05), Succession (DCP-06), Dispute (DCP-07),
// Rights (DCP-08), Delegation (DCP-09), Awareness (DCP-09), SubMandate (DCP-09)
```

### `domainSeparatedMessage(context, canonicalPayloadBytes)`

Build the message that gets signed: `UTF8(context) || 0x00 || canonicalPayloadBytes`. Throws on an unknown context tag.

```typescript
function domainSeparatedMessage(context: DcpContext | string, canonicalPayloadBytes: Uint8Array): Uint8Array;
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

### `shamirSplit(secret, threshold, totalShares)`

Split a secret key into M-of-N Shamir shares.

```typescript
function shamirSplit(secret: Uint8Array, threshold: number, totalShares: number): ShamirShare[];

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

### `setupKeyRecovery({ humanId, masterSecret, threshold, holders })`

Set up key recovery with M-of-N social recovery configuration. Returns the config to publish and one share per holder to distribute.

```typescript
function setupKeyRecovery(params: {
  humanId: string;
  masterSecret: Uint8Array;
  threshold: number;
  holders: Array<{ holderId: string; holderKid: string }>;
}): RecoverySetup;

interface RecoverySetup {
  config: Omit<RecoveryConfig, 'composite_sig'>;
  shares: ShamirShare[];
}
```

---

## Emergency Revocation

### `generateEmergencyRevocationToken()`

Generate a revocation secret and its commitment token for emergency agent revocation.

```typescript
function generateEmergencyRevocationToken(): EmergencyRevocationTokenPair;

interface EmergencyRevocationTokenPair {
  revocation_secret: string;           // 64 hex chars; kept offline by the human principal
  emergency_revocation_token: string;  // "sha256:<hex>"; embedded in the agent passport
}
```

### `verifyEmergencyRevocationSecret(revocationSecret, commitmentToken)`

Verify an emergency revocation secret against the commitment token from the passport.

```typescript
function verifyEmergencyRevocationSecret(revocationSecret: string, commitmentToken: string): boolean;
```

### `buildEmergencyRevocation({ agentId, humanId, revocationSecret })`

Build an emergency revocation request.

```typescript
function buildEmergencyRevocation(params: {
  agentId: string;
  humanId: string;
  revocationSecret: string;
}): EmergencyRevocation;
```

---

## Bundle Presentation

### `suggestPresentationMode(tier, opts)`

Suggest a presentation mode: `full` on first contact or at `elevated`/`maximum`; at `routine`/`standard`, `reference` with an existing trust relationship and `compact` otherwise.

```typescript
function suggestPresentationMode(
  tier: SecurityTier,
  opts: { isFirstContact: boolean; hasTrustRelationship: boolean },
): PresentationMode;

type PresentationMode = 'full' | 'incremental' | 'reference' | 'compact';
```

### `presentFull(bundle)` / `presentCompact(bundle, pqCheckpointRef)` / `presentReference(bundle, verificationEndpoint)` / `presentIncremental(baseBundle, updatedBundle, baseAuditCount)`

Generate different presentation formats for bundle transmission. `presentCompact` drops the PQ signature and references a PQ checkpoint instead; `presentReference` sends only the bundle hash, the session nonce and a verification endpoint; `presentIncremental` sends the audit entries after `baseAuditCount`, the PQ checkpoints, the updated manifest and its signature.

The checkpoint reference does not replace a PQ signature that the effective mode requires, and no presentation
authorizes or admits anything. Only the `bundle` inside a full or compact presentation is a `SignedBundleV2` that
`verifySignedBundleV2` takes directly (a compact one passes only where the effective mode tolerates a missing PQ
signature); a reference or incremental presentation must first be resolved to the full signed bundle.

```typescript
function presentFull(bundle: SignedBundleV2): FullPresentation;
function presentCompact(bundle: SignedBundleV2, pqCheckpointRef: string | null): CompactPresentation;
function presentReference(bundle: SignedBundleV2, verificationEndpoint: string): ReferencePresentation;
function presentIncremental(
  baseBundle: SignedBundleV2,
  updatedBundle: SignedBundleV2,
  baseAuditCount: number,
): IncrementalPresentation;
```

### `computeBundleHash(bundle)`

Compute the hash of a signed bundle for reference presentations.

```typescript
function computeBundleHash(bundle: SignedBundleV2): string;
```

---

## Verification Cache

### `VerificationCache`

In-memory cache of verification results, keyed by bundle hash, with a TTL per security tier.

> **Versions (28/10/2026).** This section describes the source on `main`, which is not published. Published
> `@dcp-ai/sdk` 2.2.1 and earlier keep the previous behaviour: the key is the bundle hash only, `get` returns the
> stored object, options are not validated, expiry uses only the wall clock, and `invalidateByAgent` removes nothing
> and returns 0.

- **A hit does not verify the evidence or trust again.** It checks only the entry's expiry; it does not recheck the session window, key validity, principal trust or a fresh
  revocation snapshot, and nothing is invalidated automatically when trust, revocation or policy change. A hit is not
  admission or authorization: verify again for those.
- **Key and context.** Without `context`, the key is the bundle hash, as before: legacy calls share their entries,
  whatever their tenant or policy. With `set(..., { context })` and `get` or `has(hash, { context })`, an entry is
  returned only for the same context string, and the legacy route and the contexts never see each other's entries.
  The caller chooses the context and is responsible for it: it must change whenever the content of an input to the
  decision changes (the verifier policy, the tenant, the trusted principals, the revocation state), for example a
  digest the caller computes over that content. A label reused after its content changed isolates nothing. The cache
  guarantees only exact-string separation.
- **Invalidation.** `invalidateByKid(kid)` removes, in every context, the entries whose signer kids include `kid`;
  the kids in `result.details.signer_keys` are indexed with the caller's. `invalidateByAgent(agentId)` removes the
  entries stored with `agentId` in `agentIds` and, deliberately, every entry stored without an agent association
  (legacy calls, or `agentIds` absent or empty), since the cache cannot tell whose those are; entries associated only
  with other agents stay. It returns the total removed, so a non-zero count does not mean the agent had entries.
  `agentIds` is the caller's label: it is not checked, and nothing is derived from the result. `clear()` removes
  everything.
- **Expiry.** An entry is a miss as soon as its TTL has passed on either clock, the monotonic clock (`performance.now()`) or the wall clock (`Date.now()`, recorded in `createdAt` and `expiresAt`); a reading equal to a deadline is already a miss. A reading of either clock earlier than at
  creation, or a reading that is not finite, is a miss that evicts the entry. A wall-clock step back that stays after
  creation is bounded by the monotonic deadline. During a system suspend the monotonic clock may not advance; the
  wall-clock limit still applies, but the cache does not promise absolute real time. A TTL of 0 is never stored, and
  `set` with it removes the entry at that key.
- **Copies.** `set` stores a deep copy (`structuredClone`) of the result and copies of the kid and agent lists; `get`
  returns a new mutable deep copy on every hit; `has` does not copy.
- **Errors.** Nothing in the cache changes when a call throws.
  - Constructor: `TypeError` when `options` or `ttlByTier` is not an object; `RangeError` when a TTL is not a number
    from 0 to `Number.MAX_SAFE_INTEGER` or `maxEntries` is not a safe integer from 1 to `Number.MAX_SAFE_INTEGER` (an explicit `undefined` keeps the
    default); `Error` when `performance.now()` is unavailable.
  - `set`: `TypeError` for a hash that is not a string, a result that is not an object, `signerKids` or `agentIds`
    that are not arrays of strings (non-empty for agents; a hole counts as `undefined`), or a context that is not a
    string; `RangeError` when a clock reading is not finite or a deadline (clock + TTL) exceeds
    `Number.MAX_SAFE_INTEGER`; `DataCloneError` when the result cannot be cloned.
  - `get` and `has`: `TypeError` for a hash or context that is not a string. `invalidateByAgent`: `TypeError` for an
    `agentId` that is not a non-empty string.

```typescript
class VerificationCache {
  constructor(options?: VerificationCacheOptions);
  get(bundleHash: string, options?: VerificationCacheLookupOptions): VerifyV2Result | null; // new copy; null when absent or expired
  set(
    bundleHash: string,
    result: VerifyV2Result,
    signerKids: string[],
    tier: SecurityTier,
    options?: VerificationCacheSetOptions,
  ): void;
  has(bundleHash: string, options?: VerificationCacheLookupOptions): boolean;
  invalidateByKid(kid: string): number;       // entries removed, in every context
  invalidateByAgent(agentId: string): number; // the agent's entries + every entry without agentIds
  clear(): void;
  readonly size: number;                      // every context, including expired entries not yet read
}

interface VerificationCacheOptions {
  /** TTL per tier in milliseconds, from 0 to Number.MAX_SAFE_INTEGER. */
  ttlByTier?: Partial<Record<SecurityTier, number>>;
  /** Hard upper limit on entries: a safe integer from 1 to Number.MAX_SAFE_INTEGER. */
  maxEntries?: number;
}

interface VerificationCacheSetOptions {
  agentIds?: readonly string[]; // the caller's label for invalidateByAgent; not checked
  context?: string;             // exact-string isolation chosen by the caller
}

interface VerificationCacheLookupOptions {
  context?: string;
}

interface CacheEntry {
  result: VerifyV2Result;
  bundleHash: string;
  signerKids: string[];
  tier: SecurityTier;
  createdAt: number; // Date.now() at set
  expiresAt: number; // createdAt + TTL
}
```

---

## CBOR Wire Format

Compact binary serialization for DCP bundles.

### `cborEncode(value)` / `cborDecode(data)`

```typescript
function cborEncode(value: unknown): Uint8Array;
function cborDecode(data: Uint8Array): unknown;
```

### `jsonToCborPayload(json)` / `cborPayloadToJson(cbor)`

Convert a DCP payload between its JSON form (base64 `*_b64` fields) and its CBOR-friendly form (raw byte strings), recursively. Encode the result with `cborEncode`.

```typescript
function jsonToCborPayload(json: Record<string, unknown>): Record<string, unknown>;
function cborPayloadToJson(cbor: Record<string, unknown>): Record<string, unknown>;
```

### `detectWireFormat(data)`

Detect whether data is JSON or CBOR encoded.

```typescript
function detectWireFormat(data: Uint8Array): 'cbor' | 'json';
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
  registerSigner(provider: CryptoProvider): void;
  registerKem(provider: KemProvider): void;
  getSigner(alg: string): CryptoProvider;   // throws for an unregistered algorithm
  getKem(alg: string): KemProvider;
  hasSigner(alg: string): boolean;
  hasKem(alg: string): boolean;
  listSigners(): string[];
  listKems(): string[];
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
  readonly alg: string;
  readonly keySize: number;
  readonly sigSize: number;
  readonly isConstantTime: boolean;

  generateKeypair(): Promise<{
    kid: string;
    publicKeyB64: string;
    secretKeyB64: string;
  }>;
  sign(message: Uint8Array, secretKeyB64: string): Promise<Uint8Array>;
  verify(
    message: Uint8Array,
    signature: Uint8Array,
    publicKeyB64: string,
  ): Promise<boolean>;
}
```

---

## Version Detection

### `detectDcpVersion(artifact)`

Detect the DCP version of an artifact or bundle.

```typescript
function detectDcpVersion(artifact: Record<string, unknown>): '1.0' | '2.0' | null;
```

---

<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in-unreleased"></a>

## Experimental: Canonicalization Candidate `dcp-jcs-v2` (opt-in)

Experimental and off by default: `dcp-jcs-v1` stays the default and the only normative canonicalization profile,
and the normal builders, signers and verifiers are unchanged. These exports exist for callers who opt in; a verified candidate bundle grants no
trust or admission. The full contract is in
[`docs/proposals/canonicalization-candidate`](proposals/canonicalization-candidate/README.md) (§15 ingress, §16
router, §17 verifier, §18 producers).

```typescript
function experimentalCandidateIngress(bytes: Uint8Array): ExperimentalCandidateIngressResult;
function experimentalCandidateExtractUnit(bytes: Uint8Array, transport: ExperimentalCandidateTransport): ExperimentalCandidateExtraction;
function createExperimentalCandidateRouter(config: {
  transport: ExperimentalCandidateTransport;       // 'bare' | 'envelope'
  acceptedProfiles: readonly string[];             // no default
  historical: ExperimentalHistoricalAdapter;       // no default; see experimentalHistoricalAdapters
}): ExperimentalCandidateRouter;
function createExperimentalCandidateVerifier(config: {
  transport: ExperimentalCandidateTransport;
  acceptedProfiles: readonly string[];
  historical: ExperimentalHistoricalAdapter;
}): ExperimentalCandidateVerifier;                 // verify(bytes, registry, policy?, options?)
function experimentalCandidateSignPayload(
  registry: AlgorithmRegistry, context: string, input: ExperimentalCandidateInput, keys: ExperimentalCandidateKeys,
): Promise<{ bytes: Uint8Array; signedPayload: ExperimentalCandidateSignedPayload }>;
function experimentalCandidateSignBundle(
  registry: AlgorithmRegistry, parts: ExperimentalCandidateBundleParts, signer: ExperimentalCandidateBundleSigner,
  options: ExperimentalCandidateBundleOptions,
): Promise<{ bytes: Uint8Array; signedBundle: { [key: string]: ExperimentalCandidateValue } }>;
```

- `ExperimentalCandidateIngressResult`: `{ status: 'accept', value, canonical, canonicalSha256 }` or
  `{ status: 'reject', class, offset }`.
- `verify` returns `{ route, entered, verification }`: the route (`reject`, `v1_path` or `candidate`), the
  verifier it entered (`none`, `dcp-jcs-v1` or `dcp-jcs-v2`, at most one) and that verifier's result as is.
- `ExperimentalCandidateInput` is `{ bytes }` (original bytes, checked by the ingress) or `{ value }` (a host
  value, checked strictly).
- `ExperimentalCandidateProduceError` (`class`, `part`, `path`, `offset`) is a rejection of the inputs' domain or
  form, raised before any signer is called; key, registry and provider errors stay today's.
- Errors of the router and the verifier: `ExperimentalCandidateConfigError` (configuration),
  `ExperimentalCandidateAdapterError` (a historical decoder that failed otherwise than by refusing the data) and
  `ExperimentalCandidateInternalError`.
