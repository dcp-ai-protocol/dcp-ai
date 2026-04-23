<sub>**English** · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

# @dcp-ai/wasm — WebAssembly SDK v2.0

Full-featured WebAssembly module for the Digital Citizenship Protocol (DCP) v2.0, compiled from the Rust SDK. Provides post-quantum composite signatures, hybrid key generation, ML-KEM-768 key encapsulation, dual hashing, bundle building/verification, and security tier computation — all running directly in the browser or Node.js, no server required.

## Installation

```bash
npm install @dcp-ai/wasm
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

## Quickstart — TypeScript Wrapper

The recommended way to use the SDK is through the ergonomic TypeScript wrapper:

```typescript
import { initDcp } from '@dcp-ai/wasm';

const dcp = await initDcp();

// Generate hybrid Ed25519 + ML-DSA-65 keypair
const keys = dcp.generateHybridKeypair();

// Build a V2 bundle
const bundle = dcp.buildBundle({
  rpr: { dcp_version: '2.0', human_id: 'alice', /* ... */ },
  passport: { dcp_version: '2.0', agent_id: 'agent-001', keys: [/* ... */] },
  intent: { action: 'read', risk_score: 100 },
  policy: { decision: 'allow', reason: 'low risk' },
  auditEntries: [],
});

// Sign the bundle with composite signature
const signed = dcp.signBundle(
  bundle,
  keys.classical.secret_key_b64, keys.classical.kid,
  keys.pq.secret_key_b64, keys.pq.kid,
);

// Verify the signed bundle
const result = dcp.verifyBundle(signed);
console.log(result.verified);       // true
console.log(result.classical_valid); // true
console.log(result.pq_valid);       // true
```

## API Reference

### Initialization

#### `initDcp(wasmUrl?: string): Promise<DcpWasm>`

Initialize the WASM module. Must be called once before using any API. Optionally pass a custom URL for the `.wasm` file.

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

| Method | Returns | Description |
|--------|---------|-------------|
| `compositeVerify(context, payload, sig, classicalPk, pqPk?)` | `CompositeVerifyResult` | Cryptographic verification of a composite signature |
| `verifyBundle(signedBundle)` | `V2VerificationResult` | Full V2 bundle verification (structure + crypto + hash chain) |

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
| `canonicalize(value)` | `string` | RFC 8785 JCS canonicalization |
| `domainSeparatedMessage(context, payloadHex)` | `string` | Domain-separated message (hex) |
| `deriveKid(alg, publicKeyB64)` | `string` | Deterministic key ID from algorithm + public key |

### Session & Security

| Method | Returns | Description |
|--------|---------|-------------|
| `generateSessionNonce()` | `string` | 256-bit random nonce (64 hex chars) |
| `verifySessionBinding(artifacts)` | `SessionBindingResult` | Verify nonce consistency across artifacts |
| `computeSecurityTier(intent)` | `SecurityTierResult` | Compute adaptive security tier (routine/standard/elevated/maximum) |

### Payload Preparation

| Method | Returns | Description |
|--------|---------|-------------|
| `preparePayload(payload)` | `PreparedPayload` | Canonicalize + hash a payload |

### Bundle Building & Signing

| Method | Returns | Description |
|--------|---------|-------------|
| `buildBundle(opts)` | `CitizenshipBundleV2` | Build a complete V2 bundle with manifest and hash cross-references |
| `signBundle(bundle, classicalSk, classicalKid, pqSk, pqKid)` | `SignedBundleV2` | Sign a bundle with composite signature |

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

The SDK computes adaptive security tiers based on intent risk profiles:

| Tier | Risk Score | Verification Mode | Checkpoint Interval |
|------|-----------|-------------------|-------------------|
| `routine` | < 200 | `classical_only` | 50 |
| `standard` | 200–499 | `hybrid_preferred` | 10 |
| `elevated` | 500–799 or PII/financial data | `hybrid_required` | 1 |
| `maximum` | ≥ 800 or credentials/biometric | `hybrid_required` | 1 |

## Algorithms Supported

| Category | Algorithm | Standard |
|----------|-----------|----------|
| Classical signing | Ed25519 | RFC 8032 |
| PQ signing | ML-DSA-65 | FIPS 204 |
| PQ signing (stateless) | SLH-DSA-192f | FIPS 205 |
| PQ key encapsulation | ML-KEM-768 | FIPS 203 |
| Hashing | SHA-256 + SHA3-256 | FIPS 180-4, FIPS 202 |
| Canonicalization | JCS | RFC 8785 |

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
