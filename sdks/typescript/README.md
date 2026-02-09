# @dcp-ai/sdk — TypeScript SDK

SDK oficial de TypeScript para el Digital Citizenship Protocol (DCP). Crea, firma y verifica Citizenship Bundles con Ed25519, SHA-256 y Merkle trees.

## Instalacion

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

// 1. Generar keypair Ed25519
const keys = generateKeypair();

// 2. Construir un Citizenship Bundle
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
    agent_name: "MiAgente",
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

// 3. Firmar el bundle
const signed = signBundle(bundle, {
  secretKeyB64: keys.secretKeyB64,
  signerType: "human",
  signerId: "human-001",
});

// 4. Verificar
const result = verifySignedBundle(signed, keys.publicKeyB64);
console.log(result); // { verified: true, errors: [] }
```

## API Reference

### Crypto

| Funcion | Firma | Descripcion |
|---------|-------|-------------|
| `generateKeypair()` | `() => Keypair` | Genera un par de claves Ed25519 (`publicKeyB64`, `secretKeyB64`) |
| `publicKeyFromSecret(secretKeyB64)` | `(string) => string` | Deriva la clave publica desde la clave secreta |
| `signObject(obj, secretKeyB64)` | `(unknown, string) => string` | Firma un objeto, retorna base64 |
| `verifyObject(obj, signatureB64, publicKeyB64)` | `(unknown, string, string) => boolean` | Verifica una firma |
| `canonicalize(obj)` | `(unknown) => string` | JSON deterministico (canonical) |

### Merkle & Hashing

| Funcion | Firma | Descripcion |
|---------|-------|-------------|
| `hashObject(obj)` | `(unknown) => string` | SHA-256 del JSON canonicalizado (hex) |
| `merkleRootFromHexLeaves(leaves)` | `(string[]) => string \| null` | Raiz Merkle desde hojas hex |
| `merkleRootForAuditEntries(entries)` | `(unknown[]) => string \| null` | Raiz Merkle de audit entries |
| `intentHash(intent)` | `(unknown) => string` | Hash del intent (SHA-256 canonical) |
| `prevHashForEntry(prevEntry)` | `(unknown) => string` | Hash de la entrada anterior para encadenar |

### Schema Validation

| Funcion | Firma | Descripcion |
|---------|-------|-------------|
| `validateSchema(schemaName, data)` | `(string, unknown) => ValidationResult` | Valida contra un schema DCP v1 |
| `validateBundle(bundle)` | `(any) => ValidationResult` | Valida un Citizenship Bundle completo |

### Bundle Builder

```typescript
const bundle = new BundleBuilder()
  .humanBindingRecord(hbr)  // HumanBindingRecord
  .agentPassport(passport)   // AgentPassport
  .intent(intent)            // Intent
  .policyDecision(policy)    // PolicyDecision
  .addAuditEntry(entry)      // AuditEntry manual
  .createAuditEntry(fields)  // Auto-computa intent_hash y prev_hash
  .build();                  // => CitizenshipBundle
```

### Bundle Signing

```typescript
signBundle(bundle: CitizenshipBundle, options: SignOptions): SignedBundle
```

`SignOptions`:
- `secretKeyB64: string` — Clave secreta Ed25519 (base64)
- `signerType: string` — `"human"` o `"agent"`
- `signerId?: string` — ID del firmante

### Bundle Verification

```typescript
verifySignedBundle(signedBundle: SignedBundle, publicKeyB64?: string): VerificationResult
```

Verifica:
1. Validez del schema JSON
2. Firma Ed25519
3. `bundle_hash` (SHA-256 del bundle)
4. `merkle_root` de las audit entries
5. Cadena de `intent_hash` en audit entries
6. Cadena de `prev_hash` (GENESIS → hash(entry anterior))

### Tipos exportados

Enums: `EntityType`, `LiabilityMode`, `Capability`, `RiskTier`, `AgentStatus`, `ActionType`, `Channel`, `DataClass`, `Impact`, `PolicyDecisionType`, `SignerType`, `ConfirmationDecision`

Interfaces: `HumanBindingRecord`, `AgentPassport`, `Intent`, `IntentTarget`, `PolicyDecision`, `AuditEntry`, `AuditEvidence`, `CitizenshipBundle`, `SignedBundle`, `BundleSignature`, `Signer`, `RevocationRecord`, `HumanConfirmation`, `ValidationResult`, `VerificationResult`, `Keypair`

## Desarrollo

```bash
# Instalar dependencias
npm install

# Build (ESM + CJS + tipos)
npm run build

# Tests con Vitest
npm test
npm run test:watch

# Type check
npm run lint
```

### Dependencias

- `ajv` + `ajv-formats` — Validacion JSON Schema
- `tweetnacl` + `tweetnacl-util` — Criptografia Ed25519
- `json-stable-stringify` — JSON deterministico

## Licencia

Apache-2.0
