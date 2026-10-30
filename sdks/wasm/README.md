<sub>**English** · [中文](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/i18n/zh-CN/sdks/wasm/README.md) · [Español](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/i18n/es/sdks/wasm/README.md) · [日本語](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/i18n/ja/sdks/wasm/README.md) · [Português](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/i18n/pt-BR/sdks/wasm/README.md)</sub>

# @dcp-ai/wasm — WebAssembly SDK v2.0

Full-featured WebAssembly module for the Digital Citizenship Protocol (DCP) v2.0, compiled from the Rust SDK. Provides post-quantum composite signatures, hybrid key generation, ML-KEM-768 key encapsulation, dual hashing, bundle building/verification, and security tier computation — all running directly in the browser or Node.js, no server required.

## Installation

**Published on npm (26/10/2026).** `@dcp-ai/wasm` 2.1.0 was published as `latest` on that date and included the APIs described here, including the experimental `dcp-jcs-v2` APIs. Publishing them did not activate the candidate: it remained opt-in and non-normative, with `dcp-jcs-v1` unchanged. The Rust crate has a separate release lifecycle.

**`@dcp-ai/wasm` 2.1.1.** This version also verifies the secondary SHA3-256 fields of [VERIFICATION.md V2-11](../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) when they are present: `audit_merkle_root_secondary`, each `prev_hash_secondary` and each `intent_hash_secondary`. Absent fields are not required, so a verified bundle may lack a complete secondary chain; a present field that is `null`, not a string or inconsistent is rejected. APIs, result fields, `dcp-jcs-v1` and `hash_alg` handling are unchanged. 2.1.0 does not check these fields. The installation commands below name this version; for its registry availability, see [Published versions](../../docs/README.md#published-versions).

```bash
npm install @dcp-ai/wasm@^2.1.1
```

See the [npm release inventory](../../docs/NPM_RELEASES.md) for all package versions.

For development against a source checkout, build and install the local package instead:

```bash
# Build in sdks/wasm first (see Build)
npm install /path/to/dcp-ai/sdks/wasm
```

## Build

```bash
# Build WASM + TypeScript wrapper
npm run build

# WASM only (browser target)
npm run build:wasm

# WASM only (Node.js target)
npm run build:wasm:node
```

**Requirements:** [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/) and the Rust toolchain with `wasm32-unknown-unknown` target.

## Initialization: browser and Node.js

`initDcp(wasmUrl?)` loads `dcp_ai_bg.wasm` once.

- **Browser** (or a bundler that serves `pkg/`): `await initDcp()` fetches the file next to `pkg/dcp_ai.js`, or
  pass its URL: `await initDcp('/assets/dcp_ai_bg.wasm')`.
- **Node.js:** Node's `fetch` cannot read a `file:` URL, so `initDcp()` without an argument fails there. Read the
  file and pass it as a `data:` URL:

```typescript
import { readFileSync } from 'node:fs';
import { initDcp } from '@dcp-ai/wasm';

// The .wasm file sits next to the `@dcp-ai/wasm/pkg` entry point.
const wasmFile = new URL('dcp_ai_bg.wasm', import.meta.resolve('@dcp-ai/wasm/pkg'));
const dcp = await initDcp(`data:application/wasm;base64,${readFileSync(wasmFile).toString('base64')}`);
```

wasm-bindgen may log that this form of the parameter is deprecated; it still initializes the module.

<a id="quickstart--typescript-wrapper"></a>

## Quickstart — TypeScript Wrapper

The recommended way to use the SDK is through the ergonomic TypeScript wrapper. In this V2 bundle the principal
signs the RPR and the manifest, the agent signs the passport, intent and policy decision, each with hybrid
Ed25519 + ML-DSA-65 keys. The example runs in Node.js; in a browser, replace the initialization with
`await initDcp()`.

```typescript
import { readFileSync } from 'node:fs';
import { initDcp } from '@dcp-ai/wasm';

const wasmFile = new URL('dcp_ai_bg.wasm', import.meta.resolve('@dcp-ai/wasm/pkg'));
const dcp = await initDcp(`data:application/wasm;base64,${readFileSync(wasmFile).toString('base64')}`);

const principal = dcp.generateHybridKeypair();
const agent = dcp.generateHybridKeypair();
type Hybrid = ReturnType<typeof dcp.generateHybridKeypair>;
const keyEntries = (keys: Hybrid) => [keys.classical, keys.pq].map((k) => ({
  kid: k.kid ?? dcp.deriveKid(k.alg, k.public_key_b64), alg: k.alg, public_key_b64: k.public_key_b64,
  created_at: '2026-01-01T00:00:00Z', expires_at: null, status: 'active',
}));
const sign = (context: string, payload: object, keys: Hybrid) =>
  dcp.signPayload(
    context, payload,
    keys.classical.secret_key_b64, keys.classical.kid ?? dcp.deriveKid('ed25519', keys.classical.public_key_b64),
    keys.pq.secret_key_b64, keys.pq.kid ?? dcp.deriveKid('ml-dsa-65', keys.pq.public_key_b64),
  );

const nonce = dcp.generateSessionNonce();
const now = new Date().toISOString();
const intent = {
  dcp_version: '2.0', intent_id: 'intent:example-001', session_nonce: nonce, agent_id: 'agent:example-001',
  human_id: 'human:example-001', timestamp: now, action_type: 'browse', target: { channel: 'web' },
  data_classes: ['none'], estimated_impact: 'low', requires_consent: false,
};

const bundle = dcp.buildBundle({
  rpr: sign('DCP-AI.v2.ResponsiblePrincipal', {
    dcp_version: '2.0', human_id: 'human:example-001', session_nonce: nonce, legal_name: 'Example Principal',
    entity_type: 'natural_person', jurisdiction: 'ES', liability_mode: 'owner_responsible', override_rights: true,
    issued_at: now, expires_at: null, contact: null, binding_keys: keyEntries(principal),
  }, principal),
  passport: sign('DCP-AI.v2.AgentPassport', {
    dcp_version: '2.0', agent_id: 'agent:example-001', session_nonce: nonce, keys: keyEntries(agent),
    principal_binding_reference: 'human:example-001', capabilities: ['browse'], risk_tier: 'low',
    created_at: now, status: 'active',
  }, agent),
  intent: sign('DCP-AI.v2.Intent', intent, agent),
  policy: sign('DCP-AI.v2.PolicyDecision', {
    dcp_version: '2.0', intent_id: intent.intent_id, session_nonce: nonce, decision: 'approve', risk_score: 50,
    reasons: ['low-impact browse'], required_confirmation: null,
    applied_policy_hash: dcp.preparePayload({ policy: 'default' }).payload_hash, timestamp: now,
  }, agent),
  auditEntries: [{
    dcp_version: '2.0', audit_id: 'audit:example-001', session_nonce: nonce, prev_hash: 'GENESIS', hash_alg: 'sha256',
    timestamp: now, agent_id: 'agent:example-001', human_id: 'human:example-001', intent_id: intent.intent_id,
    intent_hash: dcp.preparePayload(intent).payload_hash, policy_decision: 'approved', outcome: 'page_read',
    evidence: { tool: 'browser', result_ref: null, evidence_hash: null }, pq_checkpoint_ref: null,
  }],
  sessionNonce: nonce,
});

// The principal signs the manifest with a composite signature.
const signed = dcp.signBundle(
  bundle,
  principal.classical.secret_key_b64, principal.classical.kid ?? dcp.deriveKid('ed25519', principal.classical.public_key_b64),
  principal.pq.secret_key_b64, principal.pq.kid ?? dcp.deriveKid('ml-dsa-65', principal.pq.public_key_b64),
);

const result = dcp.verifyBundle(signed);
console.log(result.verified, result.classical_valid, result.pq_valid); // true true true
```

## API Reference

### Initialization

#### `initDcp(wasmUrl?: string): Promise<DcpWasm>`

Initialize the WASM module. Must be called once before using any API. Optionally pass a URL for the `.wasm`
file; in Node.js, pass it as a `data:` URL (see [Initialization](#initialization-browser-and-nodejs)).

### Keypair Generation

| Method | Returns | Description |
|--------|---------|-------------|
| `generateEd25519Keypair()` | `KeypairResult` | Ed25519 classical keypair |
| `generateMlDsa65Keypair()` | `KeypairResult` | ML-DSA-65 post-quantum signing keypair |
| `generateSlhDsa192fKeypair()` | `KeypairResult` | SLH-DSA-192f stateless hash-based signing keypair |
| `generateHybridKeypair()` | `HybridKeypairResult` | Ed25519 + ML-DSA-65 hybrid keypair in one call |

### ML-KEM-768 Key Encapsulation

| Method | Returns | Description |
|--------|---------|-------------|
| `mlKem768Keygen()` | `KemKeypairResult` | Generate ML-KEM-768 encapsulation/decapsulation keypair |
| `mlKem768Encapsulate(pk)` | `KemEncapsulateResult` | Encapsulate a shared secret using a public key |
| `mlKem768Decapsulate(ct, sk)` | `string` | Decapsulate shared secret from ciphertext (returns hex) |

### Composite Signing

| Method | Description |
|--------|-------------|
| `compositeSign(context, payload, classicalSk, classicalKid, pqSk, pqKid)` | Full hybrid signature (Ed25519 + ML-DSA-65) with `pq_over_classical` binding |
| `classicalOnlySign(context, payload, sk, kid)` | Classical-only Ed25519 signature (transition mode) |
| `signPayload(context, payload, classicalSk, classicalKid, pqSk, pqKid)` | Sign and wrap in a `SignedPayload` envelope |

### Verification

Verification does not grant principal trust, admission or action authorization. The V2 verifier checks the primary audit chain and primary Merkle root; from 2.1.1 it also checks the optional secondary links, intent hashes and `audit_merkle_root_secondary` that are present, while 2.1.0 does not ([dual-hash chains](../../docs/STORAGE_AND_ANCHORING.md#dual-hash-chains)). The experimental candidate reuses these checks.

| Method | Returns | Description |
|--------|---------|-------------|
| `compositeVerify(context, payload, sig, classicalPk, pqPk?)` | `CompositeVerifyResult` | Cryptographic verification of a composite signature |
| `verifyBundle(signedBundle, policy?)` | `V2VerificationResult` | V2 bundle verification (structure + crypto + primary hash chain) against the stricter of the policy mode and the security tier's mode (spec §14.3); reports `resolved_tier` and `verification_mode`. `policy` may differ from the default only in `default_mode`, `risk_overrides`, the Phase 3 fields (`advisory_rejected_algs`, `warn_classical_only_deprecated`, `allow_classical_fallback_disable`), `max_session_duration_seconds` (measured from the signed `session_issued_at`, which `signBundle` writes when the manifest has `session_expires_at`), `require_session_expiry` (a manifest without `session_expires_at` is rejected) and `require_audience_binding` with `verifier_id` (a manifest without `intended_verifier`, or with one other than `verifier_id`, is rejected); with a policy V1 bundles are rejected |

### Hash Operations

| Method | Returns | Description |
|--------|---------|-------------|
| `dualHash(data)` | `DualHash` | SHA-256 + SHA3-256 dual hash |
| `sha3_256(data)` | `string` | SHA3-256 hash (hex) |
| `hashObject(obj)` | `string` | SHA-256 hash of a JSON object |
| `dualMerkleRoot(leaves)` | `DualHash` | Dual Merkle root from an array of `DualHash` leaves |

### Canonicalization & Domain Separation

| Method | Returns | Description |
|--------|---------|-------------|
| `canonicalize(value)` | `string` | `dcp-jcs-v1` canonicalization (based on RFC 8785 JCS) |
| `domainSeparatedMessage(context, payloadHex)` | `string` | Domain-separated message (hex) |
| `deriveKid(alg, publicKeyB64)` | `string` | Deterministic key ID from algorithm + public key |

### Session & Security

| Method | Returns | Description |
|--------|---------|-------------|
| `generateSessionNonce()` | `string` | 256-bit random nonce (64 hex chars) |
| `verifySessionBinding(artifacts)` | `SessionBindingResult` | Verify nonce consistency across artifacts |
| `computeSecurityTier(intent, policyDecision?)` | `SecurityTierResult` | Compute the adaptive security tier (routine/standard/elevated/maximum); `risk_score` comes from the policy decision |

### Payload Preparation

| Method | Returns | Description |
|--------|---------|-------------|
| `preparePayload(payload)` | `PreparedPayload` | Canonicalize + hash a payload |

### Bundle Building & Signing

| Method | Returns | Description |
|--------|---------|-------------|
| `buildBundle(opts)` | `CitizenshipBundleV2` | Build a V2 bundle with manifest from artifacts signed with `signPayload`; `sessionNonce` defaults to the RPR's `session_nonce` |
| `signBundle(bundle, classicalSk, classicalKid, pqSk, pqKid)` | `SignedBundleV2` | Sign a bundle with composite signature; `signer.id` is the RPR's `human_id`, and a manifest with `session_expires_at` and no `session_issued_at` gets `session_issued_at` set to the signing time |

### Proof of Possession

| Method | Returns | Description |
|--------|---------|-------------|
| `generateRegistrationPop(challenge, sk, alg)` | `SignatureEntry` | Generate PoP for key registration |
| `verifyRegistrationPop(challenge, pop, pk, alg)` | `PopResult` | Verify a PoP |

### Utility

| Method | Returns | Description |
|--------|---------|-------------|
| `detectVersion(value)` | `string \| null` | Detect DCP protocol version from a JSON object |

### DCP-05–09 Types

The WASM SDK includes TypeScript interfaces for all DCP-05 through DCP-09 artifacts, mirroring the Rust SDK types:

| Spec | Interfaces |
|------|-----------|
| DCP-05 Lifecycle | `LifecycleState`, `CommissioningCertificate`, `VitalityReport`, `VitalityMetrics`, `DecommissioningRecord`, `TerminationMode`, `DataDisposition` |
| DCP-06 Succession | `DigitalTestament`, `SuccessionRecord`, `MemoryTransferManifest`, `MemoryTransferEntry`, `SuccessorPreference`, `MemoryClassification`, `TransitionType`, `MemoryDisposition` |
| DCP-07 Disputes | `DisputeRecord`, `ArbitrationResolution`, `JurisprudenceBundle`, `ObjectionRecord`, `DisputeType`, `EscalationLevel`, `DisputeStatus`, `ObjectionType`, `AuthorityLevel` |
| DCP-08 Rights | `RightsDeclaration`, `RightEntry`, `ObligationRecord`, `RightsViolationReport`, `RightType`, `ComplianceStatus` |
| DCP-09 Delegation | `DelegationMandate`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `AwarenessThreshold`, `ThresholdRule`, `AuthorityScopeEntry`, `ThresholdOperator`, `ThresholdAction` |

Domain separation contexts available via `domainSeparatedMessage()`: `Lifecycle`, `Succession`, `Dispute`, `Rights`, `Delegation`, `Awareness`

<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in-unreleased"></a>

## Experimental: Canonicalization Candidate `dcp-jcs-v2` (opt-in)

Not normative and not active: `dcp-jcs-v1` stays the only canonicalization profile, and no default, builder,
signer or verifier changes. These methods exist for callers who opt in, npm WASM 2.1.0 included. The bindings receive only bytes; host values are checked in JavaScript first. A verified candidate
bundle grants no trust or admission. Design and contract:
[`docs/proposals/canonicalization-candidate`](../../docs/proposals/canonicalization-candidate/README.md)
(§15 ingress, §16 router, §17 verifier, §18 producers).

| Method | Description |
|--------|-------------|
| `experimentalCandidateIngress(bytes)` | `{ status: 'accept', canonical, ... }` or `{ status: 'reject', class, offset }` |
| `experimentalCandidateExtractUnit(bytes, transport)` | The unit of a `bare` or `envelope` transport |
| `createExperimentalCandidateRouter(config)` | Routes bytes; `historical` is one of `experimentalWasmHistoricalAdapters` (`w1…` objects through `JSON.stringify`, `w2…` text), none a default |
| `createExperimentalCandidateVerifier(config).verify(bytes, policy?)` | Verifies from the original bytes with at most one verifier; reads the clock from `Date.now` |
| `experimentalCandidateSignPayload(context, input, keys)` | Signs one artifact from `{ bytes }` or `{ value }` |
| `experimentalCandidateSignBundle(parts, signer, options)` | Assembles and signs a bundle whose manifest names `dcp-jcs-v2` |
| `ExperimentalWasmCandidateProduceError` | A rejection of the inputs' domain or form, before any binding signs |

```typescript
import { readFileSync } from 'node:fs';
import { initDcp } from '@dcp-ai/wasm';

const wasmFile = new URL('dcp_ai_bg.wasm', import.meta.resolve('@dcp-ai/wasm/pkg'));
const dcp = await initDcp(`data:application/wasm;base64,${readFileSync(wasmFile).toString('base64')}`);

// The ingress decides on the original bytes: 1.0 is the integer 1, members are sorted.
const accepted = dcp.experimentalCandidateIngress(new TextEncoder().encode('{"b":1.0,"a":[]}'));
if (accepted.status === 'accept') console.log(new TextDecoder().decode(accepted.canonical)); // {"a":[],"b":1}

// A producer signs an artifact from those bytes (hybrid keys, today's composite signature).
const h = dcp.generateHybridKeypair();
const key = (k: typeof h.classical) => ({
  kid: k.kid ?? dcp.deriveKid(k.alg, k.public_key_b64), alg: k.alg, secretKeyB64: k.secret_key_b64, publicKeyB64: k.public_key_b64,
});
const artifact = dcp.experimentalCandidateSignPayload(
  'DCP-AI.v2.Intent', { bytes: new TextEncoder().encode('{"intent_id":"intent:1","risk":1.0}') },
  { classical: key(h.classical), pq: key(h.pq) },
);
console.log(artifact.signedPayload.payload_hash); // sha256:… of {"intent_id":"intent:1","risk":1}
```

## Low-Level API

You can also use the raw WASM functions directly (without the TypeScript wrapper):

```javascript
import init, {
  wasm_generate_hybrid_keypair,
  wasm_composite_sign,
  wasm_composite_verify,
  wasm_build_bundle,
  wasm_sign_bundle,
  wasm_verify_signed_bundle_v2,
  wasm_ml_kem_768_keygen,
  wasm_ml_kem_768_encapsulate,
  wasm_ml_kem_768_decapsulate,
  wasm_dual_hash,
  wasm_compute_security_tier,
} from '@dcp-ai/wasm/pkg';

await init();

const keys = JSON.parse(wasm_generate_hybrid_keypair());
// ... use raw functions, all return JSON strings
```

See [example.html](./example.html) for a complete interactive browser demo.

## Security Tiers

`computeSecurityTier(intent, policyDecision?)` computes the adaptive security tier (spec §14.2). `risk_score` comes from the policy decision (0 without one); an unknown or missing `action_type`, `estimated_impact` or `data_classes` value, or a `risk_score` that is missing or not an integer from 0 to 1000, counts as `elevated`, and `intent.security_tier` can only raise the result. The highest matching tier applies.

| Tier | When (any of) | Verification Mode | Checkpoint Interval |
|------|---------------|-------------------|---------------------|
| `routine` | none of the below | `classical_only` | 50 |
| `standard` | `risk_score` 200–499, `estimated_impact: medium` | `hybrid_preferred` | 10 |
| `elevated` | `risk_score` 500–799, `pii` / `financial_data` / `health_data`, `initiate_payment`, `estimated_impact: high`, unknown values | `hybrid_required` | 1 |
| `maximum` | `risk_score` ≥ 800, `credentials` / `children_data` | `hybrid_required` | 1 |

## Algorithms Supported

| Category | Algorithm | Standard |
|----------|-----------|----------|
| Classical signing | Ed25519 | RFC 8032 |
| PQ signing | ML-DSA-65 | FIPS 204 |
| PQ signing (stateless) | SLH-DSA-192f | FIPS 205 |
| PQ key encapsulation | ML-KEM-768 | FIPS 203 |
| Hashing | SHA-256 + SHA3-256 | FIPS 180-4, FIPS 202 |
| Canonicalization | `dcp-jcs-v1` | Based on RFC 8785 (JCS) |

## Development

### Prerequisites

```bash
# Install wasm-pack
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

# Install WASM target
rustup target add wasm32-unknown-unknown
```

### Run Rust WASM tests

```bash
cd ../rust
wasm-pack test --headless --chrome -- --features wasm
```

## License

Apache-2.0
