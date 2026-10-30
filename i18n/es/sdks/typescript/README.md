<sub>[English](../../../../sdks/typescript/README.md) · [中文](../../../zh-CN/sdks/typescript/README.md) · **Español** · [日本語](../../../ja/sdks/typescript/README.md) · [Português](../../../pt-BR/sdks/typescript/README.md)</sub>

<a id="dcp-aisdk--typescript-sdk-for-dcp-ai-v20"></a>
<a id="dcp-aisdk-typescript-sdk-for-dcp-ai-v20"></a>

# @dcp-ai/sdk — SDK de TypeScript para DCP-AI v2.0

> Traducción informativa de [la versión en inglés](../../../../sdks/typescript/README.md), actualizada el 28/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

SDK oficial de TypeScript para el Digital Citizenship Protocol (DCP-AI). Crea, firma y verifica Citizenship Bundles con criptografía híbrida poscuántica (Ed25519 + ML-DSA-65), firmas compuestas, niveles de seguridad adaptativos, comunicación entre agentes (A2A), observabilidad integrada y refuerzo para producción.

<a id="installation"></a>

## Instalación

**Publicado en npm (26/10/2026).** `@dcp-ai/sdk` 2.2.0 se publicó como `latest` en esa fecha. Incluía las correcciones del verificador descritas en [SECURITY.md](../../../../SECURITY.md), confianza en el principal y `strict-v1`, cadenas de delegación, la ventana de recepción A2A y las API experimentales de `dcp-jcs-v2`. El candidato seguía siendo opt-in y no normativo, con `dcp-jcs-v1` como predeterminado. Los ejemplos siguientes usan API disponibles desde la 2.2.0.

**`@dcp-ai/sdk` 2.2.1.** Esta versión también verifica los campos secundarios SHA3-256 de [VERIFICATION.md V2-11](../../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) cuando están presentes: `audit_merkle_root_secondary`, cada `prev_hash_secondary` y cada `intent_hash_secondary`. Los campos ausentes no se exigen, así que un bundle verificado puede no tener una cadena secundaria completa; un campo presente que sea `null`, no sea una cadena o sea incoherente se rechaza. No cambian las API, los campos de resultado, `dcp-jcs-v1` ni el tratamiento de `hash_alg`. La versión 2.2.0 no comprueba estos campos. Los comandos de instalación siguientes indican esta versión; para su disponibilidad en el registro, véase [Versiones publicadas](../../../../docs/README.md#published-versions).

```bash
npm install @dcp-ai/sdk@^2.2.1
```

Consulta el [inventario de publicaciones npm](../../../../docs/NPM_RELEASES.md) para ver todas las versiones.

Para desarrollar con una copia del repositorio, compila e instala el paquete local:

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai/sdks/typescript && npm install && npm run build
cd /path/to/your-project && npm install /path/to/dcp-ai/sdks/typescript
```

<a id="quick-start-v1"></a>

## Inicio rápido (V1)

Un bundle V1 firmado con Ed25519. El RPR se firma con la clave del principal y el pasaporte con la del agente,
cada uno sobre el JSON canónico del objeto sin su campo `signature`; `createAuditEntry` calcula
`intent_hash` y la cadena `prev_hash`. `verifySignedBundle` comprueba la firma del bundle, sus hashes y la
cadena, no estas firmas internas: compruébalas tú, como se muestra abajo.

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

<a id="quick-start-v2"></a>

## Inicio rápido (V2)

Un bundle V2 con firmas híbridas (Ed25519 + ML-DSA-65): cada artefacto es un `SignedPayload`
(`{ payload, payload_hash, composite_sig }`) firmado en su contexto de separación de dominio; el principal firma
el RPR y el manifiesto, y el agente, el pasaporte, la intención y la decisión de política.

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

<a id="api-reference"></a>

## Referencia de la API

<a id="core-crypto-v1"></a>

### Criptografía básica (V1)

| Función | Descripción |
|----------|-------------|
| `generateKeypair()` | Genera un par de claves Ed25519 (`publicKeyB64`, `secretKeyB64`) |
| `signObject(obj, secretKeyB64)` | Firma un objeto y devuelve la firma en base64 |
| `verifyObject(obj, signatureB64, publicKeyB64)` | Verifica una firma con una clave pública |
| `canonicalize(obj)` | Serialización JSON determinista (canónica) |
| `publicKeyFromSecret(secretKeyB64)` | Deriva la clave pública a partir de una clave secreta |

<a id="crypto-providers-v2"></a>

### Proveedores criptográficos (V2)

| Exportación | Descripción |
|--------|-------------|
| `Ed25519Provider` | Proveedor de firma clásica Ed25519 |
| `MlDsa65Provider` | Proveedor de firma poscuántica ML-DSA-65 |
| `SlhDsa192fProvider` | Proveedor de firma poscuántica SLH-DSA-192f |
| `AlgorithmRegistry` | Registro que gestiona los proveedores de algoritmos criptográficos disponibles |
| `getDefaultRegistry()` | Devuelve el registro de algoritmos único (singleton) |
| `registerDefaultProviders()` | Registra los proveedores Ed25519, ML-DSA-65 y SLH-DSA-192f |
| `deriveKid(alg, publicKeyBytes)` | Deriva un identificador de clave a partir de una clave pública |

<a id="composite-signatures-v2"></a>

### Firmas compuestas (V2)

| Función | Descripción |
|----------|-------------|
| `compositeSign(registry, context, canonicalPayloadBytes, keys)` | Crea una firma compuesta con algoritmos clásico + PQ |
| `compositeVerify(registry, context, canonicalPayloadBytes, compositeSig, classicalPubkeyB64, pqPubkeyB64?, strategy?)` | Verifica una firma compuesta |
| `classicalOnlySign(registry, context, canonicalPayloadBytes, key)` | Firma solo con el algoritmo clásico (modo de respaldo) |

<a id="security-tiers-v2"></a>

### Niveles de seguridad (V2)

| Función | Descripción |
|----------|-------------|
| `computeSecurityTier(intent, policyDecision?, mandateChainTier?)` | Calcula un `SecurityTier` (routine, standard, elevated, maximum) a partir de una intención y del `risk_score` de la decisión de política (spec §14.2); el `effective_tier` de una cadena de delegación verificada solo puede elevarlo; los valores desconocidos fallan cerrados a `elevated` |
| `maxTier(a, b)` | Devuelve el más alto de dos niveles de seguridad |
| `tierToVerificationMode(tier)` | Asigna a un nivel el modo de verificación exigido |
| `tierToCheckpointInterval(tier)` | Asigna a un nivel el intervalo de checkpoints PQ |

<a id="bundle-building"></a>

### Construcción de bundles

| Exportación | Versión | Descripción |
|--------|---------|-------------|
| `BundleBuilder` | V1 | Constructor fluido de Citizenship Bundles V1 |
| `BundleBuilderV2` | V2 | Constructor fluido de bundles V2 con niveles de seguridad y doble hash |
| `signBundle(bundle, options)` | V1 | Firma un bundle V1 con Ed25519 |
| `signBundleV2(bundle, options)` | V2 | Firma un bundle V2 con firmas compuestas |
| `signBundleV2ClassicalOnly(bundle, options)` | V2 | Firma un bundle V2 solo con firmas clásicas |
| `verifySignedBundle(signedBundle, publicKeyB64)` | V1 | Verifica un bundle V1 firmado |
| `verifySignedBundleV2(signedBundle, registry, policy?)` | V2 | Verifica un bundle V2 firmado (compuesto o clásico) según el más estricto entre el modo de la política y el modo del nivel de seguridad; informa de `resolved_tier` |

<a id="bundle-optimization-v2"></a>

### Optimización de bundles (V2)

| Exportación | Descripción |
|--------|-------------|
| `suggestPresentationMode(tier, opts)` | Recomienda un modo de presentación según el nivel de seguridad y si se trata de un primer contacto o de una relación de confianza ya existente |
| `presentFull(bundle)` | Presentación completa del bundle (sin omisiones) |
| `presentCompact(bundle, pqCheckpointRef)` | Presentación compacta: elimina la firma PQ y, en su lugar, hace referencia al checkpoint PQ más cercano |
| `presentReference(bundle, verificationEndpoint)` | Presentación solo por referencia: hash del bundle, nonce de sesión y un endpoint para verificar u obtener el bundle completo |
| `presentIncremental(baseBundle, updatedBundle, baseAuditCount)` | Presentación incremental respecto de un bundle base verificado: nuevas entradas de auditoría, checkpoints PQ, manifiesto y firma actualizados |
| `VerificationCache` | Guarda en caché resultados de verificación por hash del bundle. Un acierto no vuelve a comprobar la confianza, la revocación ni la sesión, y nada se invalida automáticamente, así que verifica de nuevo para la admisión. En el código fuente de `main` (no publicado), un `context` opcional elegido por quien llama separa inquilinos o políticas, `get` devuelve una copia e `invalidateByAgent` elimina las entradas del agente y todas las guardadas sin `agentIds`; en la 2.2.1 publicada la clave es solo el hash e `invalidateByAgent` no elimina nada, así que usa `invalidateByKid` o `clear()` ([detalles](../../../../docs/API_REFERENCE.md#verificationcache)) |

<a id="pq-checkpoints-v2"></a>

### Checkpoints PQ (V2)

| Exportación | Descripción |
|--------|-------------|
| `PQCheckpointManager` | Gestiona la creación periódica de checkpoints poscuánticos |
| `createPQCheckpoint(registry, events, sessionNonce, keys)` | Crea un checkpoint con firma PQ sobre entradas de auditoría |
| `auditEventsMerkleRoot(events)` | Calcula una raíz de Merkle a partir de entradas de auditoría |

<a id="dual-hash-v2"></a>

### Doble hash (V2)

| Función | Descripción |
|----------|-------------|
| `sha256Hex(data)` | Hash SHA-256 (cadena hexadecimal) |
| `sha3_256Hex(data)` | Hash SHA3-256 (cadena hexadecimal) |
| `dualHash(data)` | Devuelve `{ sha256, sha3_256 }` para un doble hash resistente a la computación cuántica |
| `dualMerkleRoot(leaves)` | Calcula una raíz de Merkle con hojas de doble hash |

<a id="a2a-protocol-dcp-04"></a>

### Protocolo A2A (DCP-04)

| Función | Descripción |
|----------|-------------|
| `createAgentDirectory(organization, agents)` | Crea un directorio de agentes en memoria |
| `findAgentByCapability(directory, requiredCapabilities)` | Busca agentes por capacidad en un directorio |
| `findAgentById(directory, agentId)` | Busca un agente por ID |
| `createHello(initiatorBundle, kemPublicKeyB64, requestedCapabilities, securityTier)` | Crea un mensaje Hello del handshake A2A |
| `createWelcome(responderBundle, kemPublicKeyB64, kemCiphertextB64, resolvedTier)` | Crea un mensaje de respuesta Welcome A2A |
| `deriveSessionId(agentIdA, agentIdB, nonceA, nonceB, sessionKey)` | Deriva un ID de sesión a partir de los nonces del handshake |
| `createCloseMessage(sessionId, reason, finalSequence, auditSummaryHash)` | Crea un mensaje de cierre de sesión |
| `createSession(sessionId, sessionKey, localAgentId, remoteAgentId, securityTier, rekeyingInterval?)` | Crea una sesión A2A cifrada |
| `encryptMessage(session, payload)` | Cifra un mensaje dentro de una sesión A2A |
| `decryptMessage(session, message)` | Descifra un mensaje dentro de una sesión A2A; cada secuencia se acepta una sola vez dentro de la ventana de 1000 mensajes (DCP-04 §8.4) |
| `needsRekeying(session)` | Comprueba si una sesión necesita rotación de claves |
| `generateResumeProof(session, lastSeenSequence)` | Genera una prueba para reanudar la sesión |
| `verifyResumeProof(session, lastSeenSequence, proof)` | Verifica una prueba de reanudación de sesión |

<a id="observability"></a>

### Observabilidad

| Exportación | Descripción |
|--------|-------------|
| `dcpTelemetry` | Instancia única de telemetría |
| `dcpTelemetry.init(config)` | Inicializa la telemetría con el nombre del servicio y el exportador |
| `dcpTelemetry.startSpan(name)` | Inicia un span de traza con nombre |
| `dcpTelemetry.endSpan(span)` | Termina un span de traza |
| `dcpTelemetry.recordSignLatency(ms)` | Registra la métrica de latencia de firma |
| `dcpTelemetry.getMetricsSummary()` | Devuelve un resumen agregado de las métricas |

<a id="production-hardening"></a>

### Refuerzo para producción

| Exportación | Descripción |
|--------|-------------|
| `DcpErrorCode` | Enumeración de códigos de error estructurados |
| `DcpProtocolError` | Clase de error tipada para fallos a nivel de protocolo |
| `createDcpError(code, details?)` | Fábrica para crear errores DCP estructurados |
| `isDcpError(error)` | Guarda de tipo para `DcpProtocolError` |
| `RateLimiter` | Limitador de tasa de ventana fija |
| `AdaptiveRateLimiter` | Limitador de tasa que se ajusta según la carga |
| `CircuitBreaker` | Cortocircuito (circuit breaker) para llamadas externas |
| `withRetry(fn, config?)` | Reintenta una función asíncrona con espera progresiva |

<a id="other-v2"></a>

### Otras de V2

| Exportación | Descripción |
|--------|-------------|
| `generateSessionNonce()` | Genera un nonce de sesión criptográfico |
| `domainSeparatedMessage(context, canonicalPayloadBytes)` | Antepone un separador de dominio a un mensaje |
| `generateEmergencyRevocationToken()` | Genera un secreto de revocación y su compromiso de token `sha256:` |
| `buildEmergencyRevocation({ agentId, humanId, revocationSecret })` | Construye una solicitud de revocación de emergencia a partir del secreto de revocación |
| `shamirSplit(secret, threshold, totalShares)` | Divide un secreto en `totalShares` partes; cualquier `threshold` de ellas lo reconstruye |
| `shamirReconstruct(shares)` | Reconstruye un secreto a partir de al menos `threshold` partes |
| `generatePiiSalt()` | Genera un `pii_salt` (32 bytes aleatorios en hexadecimal). Asígnalo al RPR antes de firmarlo y mantenlo privado: `blindRpr` lo omite del registro cegado, pero el RPR completo lo conserva |
| `blindRpr(rpr)` | Sustituye los datos personales de un RPR (`legal_name`, `contact`) por un compromiso de hash con sal; lanza una excepción si falta `rpr.pii_salt` o está mal formado |
| `verifyBlindedRpr(fullRpr, blindedRpr)` | Comprueba que un RPR cegado corresponde al registro completo; `warnings` señala un compromiso heredado sin sal |
| `isBlindedRpr(rpr)` | Guarda de tipo para `BlindedResponsiblePrincipalRecordV2` |
| `computePiiHash(rpr)` | Calcula el compromiso de hash sobre los campos de datos personales de un RPR y `pii_salt` (sin `pii_salt`: el valor sin sal, obsoleto) |
| `CborEncoder` | Clase codificadora CBOR |
| `CborDecoder` | Clase decodificadora CBOR |
| `cborEncode(value)` | Codifica un valor en bytes CBOR |
| `cborDecode(data)` | Decodifica bytes CBOR a un valor |

<a id="admission-trusted-principals-and-strict-v1"></a>
<a id="admission-trusted-principals-and-strict-v1-unreleased"></a>

### Admisión: Trusted Principals y strict-v1

Un bundle verificado está firmado por las claves que enumera; no prueba quién es el principal. La admisión acepta un bundle solo cuando sus firmas de principal se hicieron con claves de un principal que figura en tu conjunto de confianza y, opcionalmente, bajo el perfil `strict-v1` fijado por el operador (firmas híbridas, audiencia firmada, una sesión de 300 s como máximo, una instantánea de revocación reciente).

```typescript
// Fragment, not a complete program: trustSetJson and the strict-v1 settings come from operator configuration, signedBundle from the request, snapshot from your revocation source, registry as in the V2 Quick Start.
import { admitSignedBundleV2, createPrincipalTrustStore, resolveStrictV1Profile } from '@dcp-ai/sdk';

const trust = createPrincipalTrustStore(trustSetJson); // AdmissionConfigError on a bad trust set
const profile = resolveStrictV1Profile({ profile: 'strict-v1', verifier_id: 'api.acme.example' });
const result = await admitSignedBundleV2(signedBundle, registry, { profile, trust, revocation: snapshot });
// result.verified, result.principal_trust, result.profile_compliance, result.admitted,
// result.action_authorized (always false), result.errors [{ code, message }]
```

- `verifySignedBundleV2(bundle, registry, policy, { now })` acepta un reloj opcional e informa de `details.signer_keys`; sin ellos se comporta como antes.
- `evaluateAdmissionV2` evalúa un resultado de verificación que ya tienes (sin criptografía ni E/S); `revocationSubjects` enumera aquello por lo que debe responder una fuente de revocación.
- Guía: [`docs/ADMISSION.md`](../../../../docs/ADMISSION.md). Especificación y códigos: [`spec/profiles/admission`](../../../../spec/profiles/admission/README.md).

<a id="delegation-chains-dcp-09-35"></a>
<a id="delegation-chains-dcp-09-35-unreleased"></a>

### Cadenas de delegación (DCP-09 §3.5)

Una persona delega en un agente con un mandato raíz; ese agente puede pasar parte de su autoridad a otro agente
con un submandato que firma él mismo, y así sucesivamente. Cada salto solo puede restringir lo que recibió, y toda la cadena
se verifica sin conexión hasta llegar a la persona.

| Función | Descripción |
|----------|-------------|
| `createDelegationMandate(registry, humanKeys, params)` | Mandato raíz firmado por la persona (`human_composite_sig`); `sub_delegation` y `minimum_security_tier` son opcionales |
| `createSubMandate(registry, delegatorKeys, parent, params)` | Submandato firmado por el agente del padre (`delegator_composite_sig`, contexto `DCP-AI.v2.SubMandate`) |
| `verifyMandateChain(registry, chain, revokedIds, keys, now?)` | Verifica la cadena empezando por la raíz: firmas hasta la persona, enlaces con el padre y profundidad, `sub_delegation`, ventanas de validez anidadas, atenuación (acciones, `data_classes` y `limits` solo se restringen), el nivel de seguridad mínimo y la revocación; devuelve `{ valid, errors, depth, effective_tier }` |

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

<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in"></a>
<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in-unreleased"></a>

### Experimental: candidato de canonicalización `dcp-jcs-v2` (opt-in)

No es normativo ni está activo: `dcp-jcs-v1` sigue siendo el único perfil de canonicalización, y no cambia ningún valor por defecto,
constructor, firmante ni verificador. Estas API existen solo para quien opte por usarlas, también en npm SDK 2.2.0. Un bundle candidato verificado no otorga confianza ni admisión. Diseño, reglas y contrato
completo: [`docs/proposals/canonicalization-candidate`](../../../../docs/proposals/canonicalization-candidate/README.md)
(§15 entrada, §16 enrutador, §17 verificador, §18 productores).

| Exportación | Descripción |
|--------|-------------|
| `experimentalCandidateIngress(bytes)` | Comprueba los bytes originales de una unidad: `{ status: 'accept', value, canonical, canonicalSha256 }` o `{ status: 'reject', class, offset }` |
| `experimentalCandidateExtractUnit(bytes, transport)` | Extrae la unidad de un transporte `bare` o `envelope` |
| `createExperimentalCandidateRouter(config)` | Enruta bytes: `reject`, `v1_path` (a través de un decodificador histórico con nombre) o `candidate` |
| `createExperimentalCandidateVerifier(config).verify(bytes, registry, policy?, options?)` | Verifica a partir de los bytes originales con un verificador como máximo: el actual para `dcp-jcs-v1` y, para el candidato, el actual aceptando exactamente `dcp-jcs-v2` |
| `experimentalHistoricalAdapters` | Los decodificadores medidos (`bufferUtf8JsonParse`, `textDecoderJsonParse`); ninguno es el predeterminado |
| `experimentalCandidateSignPayload(registry, context, input, keys)` | Firma un artefacto a partir de `{ bytes }` o `{ value }`; sin perfil |
| `experimentalCandidateSignBundle(registry, parts, signer, options)` | Ensambla y firma un bundle cuyo manifiesto nombra `dcp-jcs-v2` |
| `ExperimentalCandidateProduceError` | Un rechazo por el dominio o la forma de las entradas, lanzado antes de llamar a cualquier firmante (`class`, `part`, `path`, `offset`); los errores de clave, registro y proveedor siguen siendo los actuales |

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

<a id="dcp-0509-extended-protocol-modules"></a>

### DCP-05–09: módulos ampliados del protocolo

| Módulo | Especificación | Exportaciones principales |
|--------|------|-------------|
| `lifecycle` | DCP-05 | `LifecycleState`, `CommissioningCertificate`, `VitalityReport`, `DecommissioningRecord`, `VitalityMetrics`, `TerminationMode`, `DataDisposition` |
| `succession` | DCP-06 | `DigitalTestament`, `SuccessionRecord`, `MemoryTransferManifest`, `MemoryTransferEntry`, `MemoryClassification`, `SuccessorPreference`, `TransitionType`, `MemoryDisposition` |
| `conflict-resolution` | DCP-07 | `DisputeRecord`, `ObjectionRecord`, `DisputeType`, `DisputeStatus`, `EscalationLevel`, `ObjectionType` |
| `arbitration` | DCP-07 | `ArbitrationResolution`, `JurisprudenceBundle`, `AuthorityLevel` |
| `rights` | DCP-08 | `RightsDeclaration`, `RightEntry`, `ObligationRecord`, `RightsViolationReport`, `RightType`, `ComplianceStatus` |
| `delegation` | DCP-09 | `DelegationMandate`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `AuthorityScopeEntry` |
| `awareness-threshold` | DCP-09 | `AwarenessThreshold`, `ThresholdRule`, `ThresholdOperator`, `ThresholdAction` |
| `principal-mirror` | DCP-09 | `PrincipalMirror` (reexportación con utilidades de construcción) |

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

<a id="v2-types"></a>

## Tipos V2

Tipos principales que exporta el SDK:

- `SignedPayload` — Envoltorio de datos firmados con metadatos de firma compuesta
- `CompositeSignature` — Contiene los componentes de firma clásico + PQ
- `KeyEntry` — Entrada de clave pública con algoritmo, kid y material de clave
- `SecurityTier` — `'routine' | 'standard' | 'elevated' | 'maximum'`
- `VerifierPolicy` — Política del verificador: modo por defecto y modos específicos por `risk_tier`; el nivel de seguridad solo puede hacer el modo más estricto
- `PQCheckpoint` — Checkpoint poscuántico sobre entradas de auditoría
- `A2ASession` — Estado de una sesión cifrada entre agentes
- `A2AMessage` — Sobre de mensaje A2A cifrado
- `TelemetryConfig` — Configuración del subsistema de observabilidad

**Tipos de DCP-05–09:**

- `LifecycleState` — `'commissioned' | 'active' | 'declining' | 'decommissioned'`
- `CommissioningCertificate` — Registro de puesta en servicio del agente con condiciones
- `VitalityReport` — Métricas periódicas de salud y rendimiento
- `DecommissioningRecord` — Registro de fin de vida con disposición de los datos
- `DigitalTestament` — Planificación de la sucesión con disposición de la memoria
- `SuccessionRecord` — Registro de una sucesión completada
- `MemoryTransferManifest` — Manifiesto clasificado de transferencia de memoria
- `DisputeRecord` — Registro de conflicto con niveles de escalado
- `ArbitrationResolution` — Resultado de un arbitraje con autoridad vinculante
- `JurisprudenceBundle` — Colección de precedentes para resolver disputas
- `RightsDeclaration` — Derechos del agente con seguimiento del cumplimiento
- `ObligationRecord` — Obligación con estado de aplicación
- `RightsViolationReport` — Informe de vulneración con gravedad
- `DelegationMandate` — Delegación de autoridad con alcance definido
- `AwarenessThreshold` — Reglas que activan la intervención humana (human-in-the-loop)
- `PrincipalMirror` — Instantánea de las preferencias del principal

<a id="a2a-protocol"></a>

## Protocolo A2A

Comunicación cifrada entre agentes:

```typescript
// Fragment, not a complete program: sessionId and sessionKey come from the A2A handshake, remoteSession is the peer's session.
import { createSession, encryptMessage, decryptMessage } from '@dcp-ai/sdk';

// Create encrypted A2A session
const session = createSession(sessionId, sessionKey, 'agent:a', 'agent:b', 'elevated');
const encrypted = encryptMessage(session, { action: 'negotiate', data: { offer: 10 } });
const decrypted = decryptMessage(remoteSession, encrypted);
// The same message delivered again throws: each sequence is accepted once.
```

<a id="observability-1"></a>
<a id="observability_1"></a>

## Observabilidad

La telemetría requiere instrumentación explícita: llama a los métodos de spans y métricas alrededor de las operaciones que quieras observar. La inicialización por sí sola no instrumenta las operaciones criptográficas. Este ejemplo solo inicializa la telemetría y lee el resumen actual:

```typescript
import { dcpTelemetry } from '@dcp-ai/sdk';

dcpTelemetry.init({ serviceName: 'my-agent', enabled: true, exporterType: 'console' });

// Read metrics explicitly recorded so far; initialization alone records no crypto operations
const summary = dcpTelemetry.getMetricsSummary();
```

<a id="dependencies"></a>

## Dependencias

- `ajv` + `ajv-formats` — Validación de JSON Schema
- `tweetnacl` + `tweetnacl-util` — Criptografía Ed25519
- `json-stable-stringify` — JSON determinista
- `@noble/post-quantum` — Firmas poscuánticas ML-DSA-65 y SLH-DSA

<a id="development"></a>

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

<a id="license"></a>

## Licencia

Apache-2.0
