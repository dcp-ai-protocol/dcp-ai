<sub>[English](README.md) · [中文](README.zh-CN.md) · **Español** · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

# @dcp-ai/wasm — SDK WebAssembly v2.0

Módulo WebAssembly con todas las funcionalidades para el Digital Citizenship Protocol (DCP) v2.0, compilado desde el SDK de Rust. Proporciona firmas compuestas post-cuánticas, generación de claves híbridas, encapsulación de clave ML-KEM-768, hashing dual, construcción y verificación de bundles, y cálculo del nivel de seguridad — todo ejecutándose directamente en el navegador o Node.js, sin servidor requerido.

## Instalación

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

**Requisitos:** [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/) y el toolchain de Rust con el target `wasm32-unknown-unknown`.

## Inicio Rápido — Wrapper TypeScript

La forma recomendada de usar el SDK es a través del wrapper ergonómico de TypeScript:

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

## Referencia de API

### Inicialización

#### `initDcp(wasmUrl?: string): Promise<DcpWasm>`

Inicializa el módulo WASM. Debe llamarse una vez antes de usar cualquier API. Opcionalmente se puede pasar una URL personalizada para el archivo `.wasm`.

### Generación de Pares de Claves

| Método | Devuelve | Descripción |
|--------|---------|-------------|
| `generateEd25519Keypair()` | `KeypairResult` | Par de claves clásico Ed25519 |
| `generateMlDsa65Keypair()` | `KeypairResult` | Par de claves post-cuántico de firma ML-DSA-65 |
| `generateSlhDsa192fKeypair()` | `KeypairResult` | Par de claves sin estado de firma basada en hash SLH-DSA-192f |
| `generateHybridKeypair()` | `HybridKeypairResult` | Par de claves híbrido Ed25519 + ML-DSA-65 en una sola llamada |

### Encapsulación de Clave ML-KEM-768

| Método | Devuelve | Descripción |
|--------|---------|-------------|
| `mlKem768Keygen()` | `KemKeypairResult` | Genera par de claves de encapsulación/desencapsulación ML-KEM-768 |
| `mlKem768Encapsulate(pk)` | `KemEncapsulateResult` | Encapsula un secreto compartido usando una clave pública |
| `mlKem768Decapsulate(ct, sk)` | `string` | Desencapsula el secreto compartido desde el ciphertext (devuelve hex) |

### Firma Compuesta

| Método | Descripción |
|--------|-------------|
| `compositeSign(context, payload, classicalSk, classicalKid, pqSk, pqKid)` | Firma híbrida completa (Ed25519 + ML-DSA-65) con vinculación `pq_over_classical` |
| `classicalOnlySign(context, payload, sk, kid)` | Firma Ed25519 solo clásica (modo de transición) |
| `signPayload(context, payload, classicalSk, classicalKid, pqSk, pqKid)` | Firma y envuelve en un sobre `SignedPayload` |

### Verificación

| Método | Devuelve | Descripción |
|--------|---------|-------------|
| `compositeVerify(context, payload, sig, classicalPk, pqPk?)` | `CompositeVerifyResult` | Verificación criptográfica de una firma compuesta |
| `verifyBundle(signedBundle)` | `V2VerificationResult` | Verificación completa de bundle V2 (estructura + cripto + cadena de hash) |

### Operaciones de Hash

| Método | Devuelve | Descripción |
|--------|---------|-------------|
| `dualHash(data)` | `DualHash` | Hash dual SHA-256 + SHA3-256 |
| `sha3_256(data)` | `string` | Hash SHA3-256 (hex) |
| `hashObject(obj)` | `string` | Hash SHA-256 de un objeto JSON |
| `dualMerkleRoot(leaves)` | `DualHash` | Raíz de Merkle dual desde un array de hojas `DualHash` |

### Canonicalización y Separación de Dominio

| Método | Devuelve | Descripción |
|--------|---------|-------------|
| `canonicalize(value)` | `string` | Canonicalización JCS según RFC 8785 |
| `domainSeparatedMessage(context, payloadHex)` | `string` | Mensaje separado por dominio (hex) |
| `deriveKid(alg, publicKeyB64)` | `string` | ID de clave determinístico a partir de algoritmo + clave pública |

### Sesión y Seguridad

| Método | Devuelve | Descripción |
|--------|---------|-------------|
| `generateSessionNonce()` | `string` | Nonce aleatorio de 256 bits (64 caracteres hex) |
| `verifySessionBinding(artifacts)` | `SessionBindingResult` | Verifica la consistencia del nonce a través de los artefactos |
| `computeSecurityTier(intent)` | `SecurityTierResult` | Calcula el nivel de seguridad adaptativo (routine/standard/elevated/maximum) |

### Preparación del Payload

| Método | Devuelve | Descripción |
|--------|---------|-------------|
| `preparePayload(payload)` | `PreparedPayload` | Canonicaliza + hashea un payload |

### Construcción y Firma del Bundle

| Método | Devuelve | Descripción |
|--------|---------|-------------|
| `buildBundle(opts)` | `CitizenshipBundleV2` | Construye un bundle V2 completo con manifiesto y referencias cruzadas de hash |
| `signBundle(bundle, classicalSk, classicalKid, pqSk, pqKid)` | `SignedBundleV2` | Firma un bundle con firma compuesta |

### Proof of Possession

| Método | Devuelve | Descripción |
|--------|---------|-------------|
| `generateRegistrationPop(challenge, sk, alg)` | `SignatureEntry` | Genera un PoP para el registro de clave |
| `verifyRegistrationPop(challenge, pop, pk, alg)` | `PopResult` | Verifica un PoP |

### Utilitario

| Método | Devuelve | Descripción |
|--------|---------|-------------|
| `detectVersion(value)` | `string \| null` | Detecta la versión del protocolo DCP desde un objeto JSON |

### Tipos DCP-05–09

El SDK WASM incluye interfaces TypeScript para todos los artefactos de DCP-05 a DCP-09, reflejando los tipos del SDK Rust:

| Spec | Interfaces |
|------|-----------|
| DCP-05 Ciclo de Vida | `LifecycleState`, `CommissioningCertificate`, `VitalityReport`, `VitalityMetrics`, `DecommissioningRecord`, `TerminationMode`, `DataDisposition` |
| DCP-06 Sucesión | `DigitalTestament`, `SuccessionRecord`, `MemoryTransferManifest`, `MemoryTransferEntry`, `SuccessorPreference`, `MemoryClassification`, `TransitionType`, `MemoryDisposition` |
| DCP-07 Disputas | `DisputeRecord`, `ArbitrationResolution`, `JurisprudenceBundle`, `ObjectionRecord`, `DisputeType`, `EscalationLevel`, `DisputeStatus`, `ObjectionType`, `AuthorityLevel` |
| DCP-08 Derechos | `RightsDeclaration`, `RightEntry`, `ObligationRecord`, `RightsViolationReport`, `RightType`, `ComplianceStatus` |
| DCP-09 Delegación | `DelegationMandate`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `AwarenessThreshold`, `ThresholdRule`, `AuthorityScopeEntry`, `ThresholdOperator`, `ThresholdAction` |

Contextos de separación de dominio disponibles vía `domainSeparatedMessage()`: `Lifecycle`, `Succession`, `Dispute`, `Rights`, `Delegation`, `Awareness`

## API de Bajo Nivel

También puedes usar las funciones WASM crudas directamente (sin el wrapper TypeScript):

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

Consulta [example.html](./example.html) para una demo interactiva completa en navegador.

## Niveles de Seguridad

El SDK calcula niveles de seguridad adaptativos basándose en los perfiles de riesgo de la intención:

| Nivel | Risk Score | Modo de Verificación | Intervalo de Checkpoint |
|------|-----------|-------------------|-------------------|
| `routine` | < 200 | `classical_only` | 50 |
| `standard` | 200–499 | `hybrid_preferred` | 10 |
| `elevated` | 500–799 o datos PII/financieros | `hybrid_required` | 1 |
| `maximum` | ≥ 800 o credenciales/biométricos | `hybrid_required` | 1 |

## Algoritmos Soportados

| Categoría | Algoritmo | Estándar |
|----------|-----------|----------|
| Firma clásica | Ed25519 | RFC 8032 |
| Firma post-cuántica | ML-DSA-65 | FIPS 204 |
| Firma post-cuántica (sin estado) | SLH-DSA-192f | FIPS 205 |
| Encapsulación de clave post-cuántica | ML-KEM-768 | FIPS 203 |
| Hashing | SHA-256 + SHA3-256 | FIPS 180-4, FIPS 202 |
| Canonicalización | JCS | RFC 8785 |

## Desarrollo

### Prerrequisitos

```bash
# Install wasm-pack
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

# Install WASM target
rustup target add wasm32-unknown-unknown
```

### Ejecutar tests Rust WASM

```bash
cd ../rust
wasm-pack test --headless --chrome -- --features wasm
```

## Licencia

Apache-2.0
