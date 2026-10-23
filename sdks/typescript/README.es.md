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
  .intent({ /* V2 intent with security_tier */ })
  .policyDecision({ /* V2 policy decision with risk_score and resolved_tier */ })
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
| `deriveKid(alg, publicKeyBytes)` | Deriva un identificador de clave a partir de una clave pública |

### Firmas Compuestas (V2)

| Función | Descripción |
|----------|-------------|
| `compositeSign(registry, context, canonicalPayloadBytes, keys)` | Crea una firma compuesta con algoritmos clásico + post-cuántico |
| `compositeVerify(registry, context, canonicalPayloadBytes, compositeSig, classicalPubkeyB64, pqPubkeyB64?, strategy?)` | Verifica una firma compuesta |
| `classicalOnlySign(registry, context, canonicalPayloadBytes, key)` | Firma solo con algoritmo clásico (modo fallback) |

### Niveles de Seguridad (V2)

| Función | Descripción |
|----------|-------------|
| `computeSecurityTier(intent, policyDecision?, mandateChainTier?)` | Calcula un `SecurityTier` (routine, standard, elevated, maximum) a partir de un intent y del `risk_score` de la decisión de política (spec §14.2); el `effective_tier` de una cadena de delegación verificada solo puede subirlo; los valores desconocidos fallan de forma segura a `elevated` |
| `maxTier(a, b)` | Devuelve el mayor de dos niveles de seguridad |
| `tierToVerificationMode(tier)` | Mapea un nivel al modo de verificación requerido |
| `tierToCheckpointInterval(tier)` | Mapea un nivel al intervalo de checkpoint post-cuántico |

### Construcción del Bundle

| Export | Versión | Descripción |
|--------|---------|-------------|
| `BundleBuilder` | V1 | Builder fluido para Citizenship Bundles V1 |
| `BundleBuilderV2` | V2 | Builder fluido para bundles V2 con niveles de seguridad y hash dual |
| `signBundle(bundle, options)` | V1 | Firma un bundle V1 con Ed25519 |
| `signBundleV2(bundle, options)` | V2 | Firma un bundle V2 con firmas compuestas |
| `signBundleV2ClassicalOnly(bundle, options)` | V2 | Firma un bundle V2 con firmas solo clásicas |
| `verifySignedBundle(signedBundle, publicKeyB64)` | V1 | Verifica un bundle firmado V1 |
| `verifySignedBundleV2(signedBundle, registry, policy?)` | V2 | Verifica un bundle firmado V2 (compuesto o clásico) con el modo más estricto entre el de la política y el del nivel de seguridad; informa `resolved_tier` |

### Optimización del Bundle (V2)

| Export | Descripción |
|--------|-------------|
| `suggestPresentationMode(tier, opts)` | Recomienda un modo de presentación según el nivel de seguridad y si es un primer contacto o una relación de confianza existente |
| `presentFull(bundle)` | Presentación completa del bundle (sin omisiones) |
| `presentCompact(bundle, pqCheckpointRef)` | Presentación compacta: omite la firma PQ y referencia en su lugar el checkpoint PQ más cercano |
| `presentReference(bundle, verificationEndpoint)` | Presentación solo por referencia: hash del bundle, nonce de sesión y un endpoint para verificar u obtener el bundle completo |
| `presentIncremental(baseBundle, updatedBundle, baseAuditCount)` | Presentación incremental respecto a un bundle base ya verificado: nuevas entradas de auditoría, checkpoints PQ, manifest actualizado y firma |
| `VerificationCache` | Cachea resultados de verificación para evitar trabajo criptográfico redundante |

### Checkpoints Post-Cuánticos (V2)

| Export | Descripción |
|--------|-------------|
| `PQCheckpointManager` | Gestiona la creación periódica de checkpoints post-cuánticos |
| `createPQCheckpoint(registry, events, sessionNonce, keys)` | Crea un checkpoint firmado post-cuánticamente sobre entradas de auditoría |
| `auditEventsMerkleRoot(events)` | Calcula una raíz de Merkle a partir de entradas de auditoría |

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
| `createAgentDirectory(organization, agents)` | Crea un directorio de agentes en memoria |
| `findAgentByCapability(directory, requiredCapabilities)` | Busca agentes por capacidad en un directorio |
| `findAgentById(directory, agentId)` | Busca un agente por ID |
| `createHello(initiatorBundle, kemPublicKeyB64, requestedCapabilities, securityTier)` | Crea un mensaje de handshake A2A Hello |
| `createWelcome(responderBundle, kemPublicKeyB64, kemCiphertextB64, resolvedTier)` | Crea un mensaje de respuesta A2A Welcome |
| `deriveSessionId(agentIdA, agentIdB, nonceA, nonceB, sessionKey)` | Deriva un ID de sesión a partir de los nonces del handshake |
| `createCloseMessage(sessionId, reason, finalSequence, auditSummaryHash)` | Crea un mensaje de cierre de sesión |
| `createSession(sessionId, sessionKey, localAgentId, remoteAgentId, securityTier, rekeyingInterval?)` | Crea una sesión A2A cifrada |
| `encryptMessage(session, payload)` | Cifra un mensaje dentro de una sesión A2A |
| `decryptMessage(session, message)` | Descifra un mensaje dentro de una sesión A2A; cada secuencia se acepta una sola vez dentro de la ventana de 1000 mensajes (DCP-04 §8.4) |
| `needsRekeying(session)` | Verifica si una sesión necesita rotación de claves |
| `generateResumeProof(session, lastSeenSequence)` | Genera una prueba para la reanudación de la sesión |
| `verifyResumeProof(session, lastSeenSequence, proof)` | Verifica una prueba de reanudación de sesión |

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
| `createDcpError(code, details?)` | Factory para crear errores DCP estructurados |
| `isDcpError(error)` | Type guard para `DcpProtocolError` |
| `RateLimiter` | Rate limiter de ventana fija |
| `AdaptiveRateLimiter` | Rate limiter que se ajusta según la carga |
| `CircuitBreaker` | Circuit breaker para llamadas externas |
| `withRetry(fn, config?)` | Reintenta una función asíncrona con backoff |

### Otros V2

| Export | Descripción |
|--------|-------------|
| `generateSessionNonce()` | Genera un nonce de sesión criptográfico |
| `domainSeparatedMessage(context, canonicalPayloadBytes)` | Prefija un mensaje con un separador de dominio |
| `generateEmergencyRevocationToken()` | Genera un secreto de revocación y su compromiso de token `sha256:` |
| `buildEmergencyRevocation({ agentId, humanId, revocationSecret })` | Construye una solicitud de revocación de emergencia a partir del secreto de revocación |
| `shamirSplit(secret, threshold, totalShares)` | Divide un secreto en `totalShares` shares; cualquier grupo de `threshold` lo reconstruye |
| `shamirReconstruct(shares)` | Reconstruye un secreto a partir de al menos `threshold` shares |
| `generatePiiSalt()` | Genera un `pii_salt` (32 bytes aleatorios en hex). Se asigna al RPR antes de firmarlo y nunca se publica |
| `blindRpr(rpr)` | Sustituye los datos personales de un RPR (`legal_name`, `contact`) por un compromiso hash con sal; lanza un error si `rpr.pii_salt` falta o es inválido |
| `verifyBlindedRpr(fullRpr, blindedRpr)` | Comprueba que un RPR cegado corresponde al registro completo; `warnings` señala un compromiso heredado sin sal |
| `isBlindedRpr(rpr)` | Type guard para `BlindedResponsiblePrincipalRecordV2` |
| `computePiiHash(rpr)` | Calcula el compromiso hash sobre los campos de datos personales y el `pii_salt` de un RPR (sin `pii_salt`: el valor heredado sin sal, obsoleto) |
| `CborEncoder` | Clase encoder CBOR |
| `CborDecoder` | Clase decoder CBOR |
| `cborEncode(value)` | Codifica un valor a bytes CBOR |
| `cborDecode(data)` | Decodifica bytes CBOR a un valor |

### Cadenas de Delegación (DCP-09 §3.5)

Un humano delega en un agente mediante un mandato raíz; ese agente puede transferir parte de su autoridad a otro agente
mediante un submandato que firma él mismo, y así sucesivamente. Cada salto solo puede restringir lo que recibió, y toda la cadena
se verifica offline hasta llegar al humano.

| Función | Descripción |
|----------|-------------|
| `createDelegationMandate(registry, humanKeys, params)` | Mandato raíz firmado por el humano (`human_composite_sig`); `sub_delegation` y `minimum_security_tier` son opcionales |
| `createSubMandate(registry, delegatorKeys, parent, params)` | Submandato firmado por el agente del mandato padre (`delegator_composite_sig`, contexto `DCP-AI.v2.SubMandate`) |
| `verifyMandateChain(registry, chain, revokedIds, keys, now?)` | Verifica la cadena empezando por la raíz: firmas hasta el humano, enlaces al padre y profundidad, `sub_delegation`, ventanas de validez anidadas, atenuación (las acciones, `data_classes` y `limits` solo se restringen), el nivel de seguridad mínimo y la revocación; devuelve `{ valid, errors, depth, effective_tier }` |

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

## Tipos V2

Tipos clave exportados por el SDK:

- `SignedPayload` — Wrapper para datos firmados con metadatos de firma compuesta
- `CompositeSignature` — Contiene componentes de firma clásico + post-cuántico
- `KeyEntry` — Entrada de clave pública con algoritmo, kid y material de clave
- `SecurityTier` — `'routine' | 'standard' | 'elevated' | 'maximum'`
- `VerifierPolicy` — Política del verificador: modo por defecto y overrides por `risk_tier`; el nivel de seguridad solo puede hacer el modo más estricto
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
// The same message delivered again throws: each sequence is accepted once.
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
