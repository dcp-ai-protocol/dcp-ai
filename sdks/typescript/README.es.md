<sub>[English](README.md) · [中文](README.zh-CN.md) · **Español** · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

# @dcp-ai/sdk — SDK TypeScript para DCP-AI v2.0

SDK oficial de TypeScript para el Digital Citizenship Protocol (DCP-AI). Crea, firma y verifica Citizenship Bundles (paquetes de ciudadanía) con criptografía híbrida post-cuántica (Ed25519 + ML-DSA-65), firmas compuestas, niveles de seguridad adaptativos, comunicación entre agentes (A2A), observabilidad integrada y hardening para producción.

## Instalación

```bash
npm install @dcp-ai/sdk
```

## Inicio Rápido (V1)

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

## Inicio Rápido (V2)

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

## Referencia de API

### Crypto Core (V1)

| Función | Descripción |
|----------|-------------|
| `generateKeypair()` | Genera un par de claves Ed25519 (`publicKeyB64`, `secretKeyB64`) |
| `signObject(obj, secretKeyB64)` | Firma un objeto, devuelve firma en base64 |
| `verifyObject(obj, signatureB64, publicKeyB64)` | Verifica una firma contra una clave pública |
| `canonicalize(obj)` | Serialización JSON determinística (canónica) |
| `publicKeyFromSecret(secretKeyB64)` | Deriva la clave pública a partir de una clave secreta |

### Crypto Providers (V2)

| Export | Descripción |
|--------|-------------|
| `Ed25519Provider` | Provider clásico de firma Ed25519 |
| `MlDsa65Provider` | Provider post-cuántico de firma ML-DSA-65 |
| `SlhDsa192fProvider` | Provider post-cuántico de firma SLH-DSA-192f |
| `AlgorithmRegistry` | Registry que gestiona los providers de algoritmos criptográficos disponibles |
| `getDefaultRegistry()` | Devuelve el registry singleton de algoritmos |
| `registerDefaultProviders()` | Registra los providers Ed25519, ML-DSA-65 y SLH-DSA-192f |
| `deriveKid(publicKey, algorithm)` | Deriva un identificador de clave a partir de una clave pública |

### Firmas Compuestas (V2)

| Función | Descripción |
|----------|-------------|
| `compositeSign(payload, keys, registry)` | Crea una firma compuesta con algoritmos clásico + post-cuántico |
| `compositeVerify(payload, signature, registry)` | Verifica una firma compuesta |
| `classicalOnlySign(payload, keys, registry)` | Firma solo con algoritmo clásico (modo fallback) |

### Niveles de Seguridad (V2)

| Función | Descripción |
|----------|-------------|
| `computeSecurityTier(riskScore, flags)` | Calcula un `SecurityTier` a partir de un risk score numérico |
| `maxTier(a, b)` | Devuelve el mayor de dos niveles de seguridad |
| `tierToVerificationMode(tier)` | Mapea un nivel al modo de verificación requerido |
| `tierToCheckpointInterval(tier)` | Mapea un nivel al intervalo de checkpoint post-cuántico |

### Construcción del Bundle

| Export | Versión | Descripción |
|--------|---------|-------------|
| `BundleBuilder` | V1 | Builder fluido para Citizenship Bundles V1 |
| `BundleBuilderV2` | V2 | Builder fluido para bundles V2 con niveles de seguridad y hash dual |
| `signBundle(bundle, options)` | V1 | Firma un bundle V1 con Ed25519 |
| `signBundleV2(bundle, keys, registry)` | V2 | Firma un bundle V2 con firmas compuestas |
| `signBundleV2ClassicalOnly(bundle, keys, registry)` | V2 | Firma un bundle V2 con firmas solo clásicas |
| `verifySignedBundle(signedBundle, publicKeyB64)` | V1 | Verifica un bundle firmado V1 |
| `verifySignedBundleV2(signedBundle, registry)` | V2 | Verifica un bundle firmado V2 (compuesto o clásico) |

### Optimización del Bundle (V2)

| Export | Descripción |
|--------|-------------|
| `suggestPresentationMode(context)` | Recomienda un modo de presentación según el contexto |
| `presentFull(bundle)` | Presentación completa del bundle (sin omisiones) |
| `presentCompact(bundle)` | Presentación compacta con pista de auditoría podada |
| `presentReference(bundle)` | Presentación solo por referencia (hashes, sin payloads) |
| `presentIncremental(bundle, since)` | Presentación incremental (delta desde un checkpoint) |
| `VerificationCache` | Cachea resultados de verificación para evitar trabajo criptográfico redundante |

### Checkpoints Post-Cuánticos (V2)

| Export | Descripción |
|--------|-------------|
| `PQCheckpointManager` | Gestiona la creación periódica de checkpoints post-cuánticos |
| `createPQCheckpoint(entries, keys, registry)` | Crea un checkpoint firmado post-cuánticamente sobre entradas de auditoría |
| `auditEventsMerkleRoot(entries)` | Calcula una raíz de Merkle a partir de entradas de auditoría |

### Hash Dual (V2)

| Función | Descripción |
|----------|-------------|
| `sha256Hex(data)` | Hash SHA-256 (string hex) |
| `sha3_256Hex(data)` | Hash SHA3-256 (string hex) |
| `dualHash(data)` | Devuelve `{ sha256, sha3_256 }` para hash dual resistente a lo cuántico |
| `dualMerkleRoot(leaves)` | Calcula una raíz de Merkle usando hojas de hash dual |

### Protocolo A2A (DCP-04)

| Función | Descripción |
|----------|-------------|
| `createAgentDirectory()` | Crea un directorio de agentes en memoria |
| `findAgentByCapability(dir, cap)` | Busca agentes por capacidad en un directorio |
| `findAgentById(dir, id)` | Busca un agente por ID |
| `createHello(agentId, capabilities)` | Crea un mensaje de handshake A2A Hello |
| `createWelcome(agentId, capabilities)` | Crea un mensaje de respuesta A2A Welcome |
| `deriveSessionId(helloNonce, welcomeNonce)` | Deriva un ID de sesión a partir de los nonces del handshake |
| `createCloseMessage(sessionId, reason)` | Crea un mensaje de cierre de sesión |
| `createSession(id, key, local, remote, tier)` | Crea una sesión A2A cifrada |
| `encryptMessage(session, payload)` | Cifra un mensaje dentro de una sesión A2A |
| `decryptMessage(session, encrypted)` | Descifra un mensaje dentro de una sesión A2A |
| `needsRekeying(session)` | Verifica si una sesión necesita rotación de claves |
| `generateResumeProof(session)` | Genera una prueba para la reanudación de la sesión |
| `verifyResumeProof(session, proof)` | Verifica una prueba de reanudación de sesión |

### Observabilidad

| Export | Descripción |
|--------|-------------|
| `dcpTelemetry` | Instancia singleton de telemetría |
| `dcpTelemetry.init(config)` | Inicializa la telemetría con nombre de servicio y exporter |
| `dcpTelemetry.startSpan(name)` | Inicia un span de traza con nombre |
| `dcpTelemetry.endSpan(span)` | Finaliza un span de traza |
| `dcpTelemetry.recordSignLatency(ms)` | Registra la métrica de latencia de firma |
| `dcpTelemetry.getMetricsSummary()` | Devuelve un resumen agregado de métricas |

### Hardening para Producción

| Export | Descripción |
|--------|-------------|
| `DcpErrorCode` | Enum de códigos de error estructurados |
| `DcpProtocolError` | Clase de error tipada para fallos a nivel de protocolo |
| `createDcpError(code, message, context)` | Factory para crear errores DCP estructurados |
| `isDcpError(err)` | Type guard para `DcpProtocolError` |
| `RateLimiter` | Rate limiter de ventana fija |
| `AdaptiveRateLimiter` | Rate limiter que se ajusta según la carga |
| `CircuitBreaker` | Circuit breaker para llamadas externas |
| `withRetry(fn, options)` | Reintenta una función asíncrona con backoff |

### Otros V2

| Export | Descripción |
|--------|-------------|
| `generateSessionNonce()` | Genera un nonce de sesión criptográfico |
| `domainSeparatedMessage(domain, message)` | Prefija un mensaje con un separador de dominio |
| `generateEmergencyRevocationToken(keys)` | Genera un token de revocación de emergencia prefirmado |
| `buildEmergencyRevocation(token)` | Construye un registro completo de revocación a partir de un token |
| `shamirSplit(secret, n, k)` | Divide un secreto en `n` shares (umbral `k`) |
| `shamirReconstruct(shares)` | Reconstruye un secreto a partir de `k` shares |
| `CborEncoder` | Clase encoder CBOR |
| `CborDecoder` | Clase decoder CBOR |
| `cborEncode(value)` | Codifica un valor a bytes CBOR |
| `cborDecode(bytes)` | Decodifica bytes CBOR a un valor |

### DCP-05–09: Módulos Extendidos del Protocolo

| Módulo | Spec | Exports Clave |
|--------|------|-------------|
| `lifecycle` | DCP-05 | `LifecycleState`, `CommissioningCertificate`, `VitalityReport`, `DecommissioningRecord`, `VitalityMetrics`, `TerminationMode`, `DataDisposition` |
| `succession` | DCP-06 | `DigitalTestament`, `SuccessionRecord`, `MemoryTransferManifest`, `MemoryTransferEntry`, `MemoryClassification`, `SuccessorPreference`, `TransitionType`, `MemoryDisposition` |
| `conflict-resolution` | DCP-07 | `DisputeRecord`, `ObjectionRecord`, `DisputeType`, `DisputeStatus`, `EscalationLevel`, `ObjectionType` |
| `arbitration` | DCP-07 | `ArbitrationResolution`, `JurisprudenceBundle`, `AuthorityLevel` |
| `rights` | DCP-08 | `RightsDeclaration`, `RightEntry`, `ObligationRecord`, `RightsViolationReport`, `RightType`, `ComplianceStatus` |
| `delegation` | DCP-09 | `DelegationMandate`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `AuthorityScopeEntry` |
| `awareness-threshold` | DCP-09 | `AwarenessThreshold`, `ThresholdRule`, `ThresholdOperator`, `ThresholdAction` |
| `principal-mirror` | DCP-09 | `PrincipalMirror` (re-export con utilidades builder) |

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

## Tipos V2

Tipos clave exportados por el SDK:

- `SignedPayload` — Wrapper para datos firmados con metadatos de firma compuesta
- `CompositeSignature` — Contiene componentes de firma clásico + post-cuántico
- `KeyEntry` — Entrada de clave pública con algoritmo, kid y material de clave
- `SecurityTier` — `'basic' | 'elevated' | 'critical'`
- `VerifierPolicy` — Política que especifica el modo de verificación requerido por nivel
- `PQCheckpoint` — Checkpoint post-cuántico sobre entradas de auditoría
- `A2ASession` — Estado de sesión entre agentes cifrada
- `A2AMessage` — Sobre de mensaje A2A cifrado
- `TelemetryConfig` — Configuración del subsistema de observabilidad

**Tipos DCP-05–09:**

- `LifecycleState` — `'commissioned' | 'active' | 'declining' | 'decommissioned'`
- `CommissioningCertificate` — Registro de comisionamiento del agente con condiciones
- `VitalityReport` — Métricas periódicas de salud y desempeño
- `DecommissioningRecord` — Registro de fin de vida con disposición de datos
- `DigitalTestament` — Planeación de sucesión con disposición de memoria
- `SuccessionRecord` — Registro de sucesión completada
- `MemoryTransferManifest` — Manifiesto de transferencia de memoria clasificada
- `DisputeRecord` — Registro de conflicto con niveles de escalamiento
- `ArbitrationResolution` — Resultado del arbitraje con autoridad vinculante
- `JurisprudenceBundle` — Colección de precedentes para resolución de disputas
- `RightsDeclaration` — Derechos del agente con seguimiento de cumplimiento
- `ObligationRecord` — Obligación con estado de aplicación
- `RightsViolationReport` — Reporte de violación con severidad
- `DelegationMandate` — Delegación de autoridad con alcance
- `AwarenessThreshold` — Reglas de disparo human-in-the-loop
- `PrincipalMirror` — Snapshot de preferencias del principal

## Protocolo A2A

Comunicación cifrada entre agentes:

```typescript
import { createSession, encryptMessage, decryptMessage } from '@dcp-ai/sdk';

// Create encrypted A2A session
const session = createSession(sessionId, sessionKey, 'agent:a', 'agent:b', 'elevated');
const encrypted = encryptMessage(session, { action: 'negotiate', data: {...} });
const decrypted = decryptMessage(remoteSession, encrypted);
```

## Observabilidad

Todas las operaciones criptográficas se instrumentan automáticamente:

```typescript
import { dcpTelemetry } from '@dcp-ai/sdk';

dcpTelemetry.init({ serviceName: 'my-agent', enabled: true, exporterType: 'console' });

// All crypto operations are automatically instrumented
const summary = dcpTelemetry.getMetricsSummary();
```

## Dependencias

- `ajv` + `ajv-formats` — Validación JSON Schema
- `tweetnacl` + `tweetnacl-util` — Criptografía Ed25519
- `json-stable-stringify` — JSON determinístico
- `@noble/post-quantum` — Firmas post-cuánticas ML-DSA-65 y SLH-DSA

## Desarrollo

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

## Licencia

Apache-2.0
