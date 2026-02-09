# @dcp-ai/sdk — TypeScript SDK

Official TypeScript SDK for the Digital Citizenship Protocol (DCP). Create, sign, and verify Citizenship Bundles with Ed25519, SHA-256, and Merkle trees.

## Installation

```bash
npm install @dcp-ai/sdk
```

## Quickstart

```typescript
import {
  BundleBuilder,
  signBundle,
  verifySignedBundle,
  generateKeypair,
} from "@dcp-ai/sdk";

// 1. Generate Ed25519 keypair
const keys = generateKeypair();

// 2. Build a Citizenship Bundle
const bundle = new BundleBuilder()
  .humanBindingRecord({
    dcp_version: "1.0",
    human_id: "human-001",
    entity_type: "natural_person",
    jurisdiction: "ES",
    liability_mode: "full",
    created_at: new Date().toISOString(),
    expires_at: null,
  })
  .agentPassport({
    dcp_version: "1.0",
    agent_id: "agent-001",
    human_id: "human-001",
    agent_name: "MyAgent",
    capabilities: ["browse", "api_call"],
    risk_tier: "medium",
    status: "active",
    created_at: new Date().toISOString(),
    expires_at: null,
  })
  .intent({
    dcp_version: "1.0",
    agent_id: "agent-001",
    human_id: "human-001",
    timestamp: new Date().toISOString(),
    action_type: "api_call",
    target: { channel: "api", endpoint: "https://api.example.com/data" },
    data_classes: ["public"],
    estimated_impact: "low",
  })
  .policyDecision({
    dcp_version: "1.0",
    agent_id: "agent-001",
    human_id: "human-001",
    timestamp: new Date().toISOString(),
    decision: "allow",
    matched_rules: ["default-allow"],
  })
  .build();

// 3. Sign the bundle
const signed = signBundle(bundle, {
  secretKeyB64: keys.secretKeyB64,
  signerType: "human",
  signerId: "human-001",
});

// 4. Verify
const result = verifySignedBundle(signed, keys.publicKeyB64);
console.log(result); // { verified: true, errors: [] }
```

## API Reference

### Crypto

| Function | Signature | Description |
|----------|-----------|-------------|
| `generateKeypair()` | `() => Keypair` | Generates an Ed25519 key pair (`publicKeyB64`, `secretKeyB64`) |
| `publicKeyFromSecret(secretKeyB64)` | `(string) => string` | Derives the public key from the secret key |
| `signObject(obj, secretKeyB64)` | `(unknown, string) => string` | Signs an object, returns base64 |
| `verifyObject(obj, signatureB64, publicKeyB64)` | `(unknown, string, string) => boolean` | Verifies a signature |
| `canonicalize(obj)` | `(unknown) => string` | Deterministic (canonical) JSON |

### Merkle & Hashing

| Function | Signature | Description |
|----------|-----------|-------------|
| `hashObject(obj)` | `(unknown) => string` | SHA-256 of the canonicalized JSON (hex) |
| `merkleRootFromHexLeaves(leaves)` | `(string[]) => string \| null` | Merkle root from hex leaves |
| `merkleRootForAuditEntries(entries)` | `(unknown[]) => string \| null` | Merkle root of audit entries |
| `intentHash(intent)` | `(unknown) => string` | Intent hash (SHA-256 canonical) |
| `prevHashForEntry(prevEntry)` | `(unknown) => string` | Hash of the previous entry for chaining |

### Schema Validation

| Function | Signature | Description |
|----------|-----------|-------------|
| `validateSchema(schemaName, data)` | `(string, unknown) => ValidationResult` | Validates against a DCP v1 schema |
| `validateBundle(bundle)` | `(any) => ValidationResult` | Validates a complete Citizenship Bundle |

### Bundle Builder

```typescript
const bundle = new BundleBuilder()
  .humanBindingRecord(hbr)  // HumanBindingRecord
  .agentPassport(passport)   // AgentPassport
  .intent(intent)            // Intent
  .policyDecision(policy)    // PolicyDecision
  .addAuditEntry(entry)      // Manual AuditEntry
  .createAuditEntry(fields)  // Auto-computes intent_hash and prev_hash
  .build();                  // => CitizenshipBundle
```

### Bundle Signing

```typescript
signBundle(bundle: CitizenshipBundle, options: SignOptions): SignedBundle
```

`SignOptions`:
- `secretKeyB64: string` — Ed25519 secret key (base64)
- `signerType: string` — `"human"` or `"agent"`
- `signerId?: string` — Signer ID

### Bundle Verification

```typescript
verifySignedBundle(signedBundle: SignedBundle, publicKeyB64?: string): VerificationResult
```

Verifies:
1. JSON schema validity
2. Ed25519 signature
3. `bundle_hash` (SHA-256 of the bundle)
4. `merkle_root` of audit entries
5. `intent_hash` chain in audit entries
6. `prev_hash` chain (GENESIS → hash(previous entry))

### Exported Types

Enums: `EntityType`, `LiabilityMode`, `Capability`, `RiskTier`, `AgentStatus`, `ActionType`, `Channel`, `DataClass`, `Impact`, `PolicyDecisionType`, `SignerType`, `ConfirmationDecision`

Interfaces: `HumanBindingRecord`, `AgentPassport`, `Intent`, `IntentTarget`, `PolicyDecision`, `AuditEntry`, `AuditEvidence`, `CitizenshipBundle`, `SignedBundle`, `BundleSignature`, `Signer`, `RevocationRecord`, `HumanConfirmation`, `ValidationResult`, `VerificationResult`, `Keypair`

## Development

```bash
# Install dependencies
npm install

# Build (ESM + CJS + types)
npm run build

# Tests with Vitest
npm test
npm run test:watch

# Type check
npm run lint
```

### Dependencies

- `ajv` + `ajv-formats` — JSON Schema validation
- `tweetnacl` + `tweetnacl-util` — Ed25519 cryptography
- `json-stable-stringify` — Deterministic JSON

## License

Apache-2.0
