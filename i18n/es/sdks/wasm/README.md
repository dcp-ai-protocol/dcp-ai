<sub>[English](../../../../sdks/wasm/README.md) · [中文](../../../zh-CN/sdks/wasm/README.md) · **Español** · [日本語](../../../ja/sdks/wasm/README.md) · [Português](../../../pt-BR/sdks/wasm/README.md)</sub>

<a id="dcp-aiwasm-webassembly-sdk-v20"></a>

# @dcp-ai/wasm — SDK WebAssembly v2.0

> Traducción informativa del [README en inglés](../../../../sdks/wasm/README.md), actualizada el 09/11/2026. Los identificadores y los bloques de código, incluidos sus comentarios, se conservan para mantener los ejemplos probados.

Módulo WebAssembly para el Digital Citizenship Protocol (DCP) v2.0, compilado a partir del SDK de Rust. Ofrece firmas compuestas poscuánticas, generación de claves híbridas, encapsulación de claves ML-KEM-768, hashes duales, construcción y verificación de bundles y cálculo del nivel de seguridad. Se ejecuta directamente en el navegador o en Node.js, sin servidor.

<a id="installation"></a>

## Instalación

**Publicado en npm (26/10/2026).** `@dcp-ai/wasm` 2.1.0 se publicó como `latest` en esa fecha e incluía las API descritas aquí, incluidas las experimentales de `dcp-jcs-v2`. Publicarlas no activó el candidato: siguió siendo opt-in y no normativo, sin cambios en `dcp-jcs-v1`. El crate de Rust tiene un ciclo de publicación independiente.

**`@dcp-ai/wasm` 2.1.1.** Esta versión también verifica los campos secundarios SHA3-256 de [VERIFICATION.md V2-11](../../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) cuando están presentes: `audit_merkle_root_secondary`, cada `prev_hash_secondary` y cada `intent_hash_secondary`. Los campos ausentes no se exigen, así que un bundle verificado puede no tener una cadena secundaria completa; un campo presente que sea `null`, no sea una cadena o sea incoherente se rechaza. No cambian las API, los campos de resultado, `dcp-jcs-v1` ni el tratamiento de `hash_alg`. La versión 2.1.0 no comprueba estos campos.

```bash
npm install @dcp-ai/wasm@^2.2.0
```

Consulta el [inventario de publicaciones npm](../../../../docs/NPM_RELEASES.md) para ver todas las versiones.

**`@dcp-ai/wasm` 2.1.3.** Publicada en npm el 05/11/2026. La 2.1.2 preparada el 30/10/2026 nunca se publicó y queda sustituida. Frente a 2.1.1:

- **`dualMerkleRoot`** calcula la raíz Merkle dual de V2-11 (digests crudos de 32 bytes, con el último nodo duplicado en una capa impar); 2.1.1 y anteriores dan otras raíces con dos o más hojas (véase Operaciones de hash más abajo). Una hoja que no es un digest hex de 32 bytes, que antes se aceptaba, es un error.
- **Validación de esquemas V2-2.** `verifyBundle` y `wasm_verify_signed_bundle_v2` validan el sobre del bundle firmado y los cuatro payloads contra `schemas/v2` antes de cualquier comprobación de hash, clave o firma. Los bundles inválidos por esquema que antes se aceptaban ahora fallan con diagnósticos `schema: <pointer> <keyword>`.

La 2.1.3 no añade ninguna API de JavaScript. No cambian el formato de transmisión, las firmas, los perfiles, `dcp-jcs-v1` ni las API experimentales de activación explícita `dcp-jcs-v2`. El WebAssembly procede del código fuente de Rust `dcp-ai` 2.13.0, también publicado el 05/11/2026. Véanse los [paquetes npm](../../../../docs/NPM_RELEASES.md). El README del tarball de la 2.1.3 es el que se preparó antes de su publicación y dice «prepared, not published»; los tarballs publicados no pueden cambiar.

**`@dcp-ai/wasm` 2.2.0.** El comando de instalación de arriba indica esta versión; para su disponibilidad en el registro, véase [Versiones publicadas](../../../../docs/README.md#published-versions). Frente a 2.1.3:

- **Errores distinguidos de los valores.** `canonicalize` lee la nueva exportación cruda `wasm_canonicalize_v2_result`, así que un valor como `{ error: 'x' }` se canonicaliza en lugar de lanzar un error; `hashObject` y `deriveKid` lanzan un `Error` en lugar de devolver un sobre de error como hash o como identificador de clave; el `{"error": …}` de las exportaciones crudas es JSON escapado.
- **Cambio de aceptación: Ed25519 P-ED-1.** `compositeVerify` y `verifyBundle` usan el proveedor de Rust, que rechaza además una clave pública o una R que no sea una codificación canónica o que sea de orden divisor de 8.
- **Empaquetado.** `pkg/dcp_ai_bg.wasm` se compila sin las rutas locales de quien compila, y una puerta de publicación revisa los archivos empaquetados.

No se añade ninguna API de admisión, de cadena de mandatos ni de activación. No cambian el formato de transmisión, las firmas, los perfiles, `dcp-jcs-v1` ni las API experimentales de activación explícita `dcp-jcs-v2`. El WebAssembly procede del código fuente de Rust `dcp-ai` 2.14.0.

Para desarrollar con una copia del repositorio, compila e instala el paquete local:

```bash
# Build in sdks/wasm first (see Build)
npm install /path/to/dcp-ai/sdks/wasm
```

<a id="build"></a>

## Compilación

```bash
# Build WASM + TypeScript wrapper
npm run build

# WASM only (browser target)
npm run build:wasm

# WASM only (Node.js target)
npm run build:wasm:node
```

**Requisitos:** [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/) y la cadena de herramientas de Rust con el destino `wasm32-unknown-unknown`.

<a id="initialization-browser-and-nodejs"></a>

## Inicialización: navegador y Node.js

`initDcp(wasmUrl?)` carga `dcp_ai_bg.wasm` una sola vez.

- **Navegador** (o un empaquetador que sirva `pkg/`): `await initDcp()` obtiene el archivo situado junto a `pkg/dcp_ai.js`. También puedes pasar su URL: `await initDcp('/assets/dcp_ai_bg.wasm')`.
- **Node.js:** su implementación de `fetch` no puede leer una URL `file:`, por lo que `initDcp()` sin argumentos falla en ese entorno. Lee el archivo y pásalo como URL `data:`:

```typescript
import { readFileSync } from 'node:fs';
import { initDcp } from '@dcp-ai/wasm';

// The .wasm file sits next to the `@dcp-ai/wasm/pkg` entry point.
const wasmFile = new URL('dcp_ai_bg.wasm', import.meta.resolve('@dcp-ai/wasm/pkg'));
const dcp = await initDcp(`data:application/wasm;base64,${readFileSync(wasmFile).toString('base64')}`);
```

wasm-bindgen puede advertir que esta forma del parámetro está obsoleta; aun así, inicializa el módulo.

<a id="quickstart--typescript-wrapper"></a>

<a id="quickstart-typescript-wrapper"></a>

## Inicio rápido — Envoltorio de TypeScript

Se recomienda utilizar el SDK mediante su envoltorio de TypeScript. En este bundle V2, el principal firma el RPR y el manifiesto; el agente firma el pasaporte, la intención y la decisión de política. Cada uno utiliza claves híbridas Ed25519 + ML-DSA-65. El ejemplo se ejecuta en Node.js; en un navegador, sustituye la inicialización por `await initDcp()`.

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

<a id="api-reference"></a>

## Referencia de la API

<a id="initialization"></a>

### Inicialización

#### `initDcp(wasmUrl?: string): Promise<DcpWasm>`

Inicializa el módulo WASM. Debe llamarse una vez antes de utilizar cualquier API. Opcionalmente acepta la URL del archivo `.wasm`; en Node.js, pásala como URL `data:` (véase [Inicialización](#initialization-browser-and-nodejs)). El argumento va al inicializador de wasm-bindgen. Un string sigue funcionando, pero el inicializador de esta build registra un aviso de que esa forma está obsoleta. También acepta `{ module_or_path }` con una URL o los bytes del `.wasm`, como lo pasan las pruebas del repositorio; el tipo de TypeScript solo declara un string.

<a id="keypair-generation"></a>

### Generación de pares de claves

| Método | Devuelve | Descripción |
|--------|---------|-------------|
| `generateEd25519Keypair()` | `KeypairResult` | Par de claves clásicas Ed25519 |
| `generateMlDsa65Keypair()` | `KeypairResult` | Par de claves de firma poscuántica ML-DSA-65 |
| `generateSlhDsa192fKeypair()` | `KeypairResult` | Par de claves de firma SLH-DSA-192f basada en hashes y sin estado |
| `generateHybridKeypair()` | `HybridKeypairResult` | Par de claves híbridas Ed25519 + ML-DSA-65 en una sola llamada |

<a id="ml-kem-768-key-encapsulation"></a>

### Encapsulación de claves ML-KEM-768

| Método | Devuelve | Descripción |
|--------|---------|-------------|
| `mlKem768Keygen()` | `KemKeypairResult` | Genera un par de claves de encapsulación y desencapsulación ML-KEM-768 |
| `mlKem768Encapsulate(pk)` | `KemEncapsulateResult` | Encapsula un secreto compartido mediante una clave pública |
| `mlKem768Decapsulate(ct, sk)` | `string` | Desencapsula el secreto compartido a partir del texto cifrado; devuelve hexadecimal |

<a id="composite-signing"></a>

### Firma compuesta

| Método | Descripción |
|--------|-------------|
| `compositeSign(context, payload, classicalSk, classicalKid, pqSk, pqKid)` | Firma híbrida completa Ed25519 + ML-DSA-65 con enlace `pq_over_classical` |
| `classicalOnlySign(context, payload, sk, kid)` | Firma únicamente clásica Ed25519, para el modo de transición |
| `signPayload(context, payload, classicalSk, classicalKid, pqSk, pqKid)` | Firma y envuelve el contenido en un sobre `SignedPayload` |

<a id="verification"></a>

### Verificación

La verificación no otorga confianza en el principal, admisión ni autorización para actuar. El verificador V2 comprueba la cadena de auditoría primaria y la raíz Merkle primaria; desde la 2.1.1 también comprueba los enlaces secundarios opcionales, los hashes de intención y `audit_merkle_root_secondary` que estén presentes, mientras que la 2.1.0 no ([cadenas de doble hash](../../../../docs/STORAGE_AND_ANCHORING.md#dual-hash-chains)). El candidato experimental reutiliza estas comprobaciones.

| Método | Devuelve | Descripción |
|--------|---------|-------------|
| `compositeVerify(context, payload, sig, classicalPk, pqPk?)` | `CompositeVerifyResult` | Verificación criptográfica de una firma compuesta |
| `verifyBundle(signedBundle, policy?)` | `V2VerificationResult` | Verifica un bundle V2 —estructura, criptografía y cadena de hashes primaria— con el más estricto de los modos de la política y del nivel de seguridad (spec §14.3); informa `resolved_tier` y `verification_mode`. `policy` solo puede diferir de los valores predeterminados en `default_mode`, `risk_overrides`, los campos de la fase 3 (`advisory_rejected_algs`, `warn_classical_only_deprecated`, `allow_classical_fallback_disable`), `max_session_duration_seconds` (medida desde el `session_issued_at` firmado, que `signBundle` escribe cuando el manifiesto contiene `session_expires_at`), `require_session_expiry` (rechaza un manifiesto sin `session_expires_at`) y `require_audience_binding` con `verifier_id` (rechaza un manifiesto sin `intended_verifier` o con un valor distinto de `verifier_id`). Cuando se proporciona una política, se rechazan los bundles V1 |

**Validación de esquemas (V2-2; desde la 2.1.3).** `verifyBundle` y `wasm_verify_signed_bundle_v2` validan primero el sobre del bundle firmado y los cuatro payloads contra `schemas/v2`, después de las comprobaciones de política y reloj y antes de que el verificador compruebe el manifiesto, los hashes de los payloads, las claves y las firmas; las exportaciones experimentales del candidato pasan por la misma puerta. Un bundle que falla devuelve `verified: false` con errores `schema: <JSON pointer> <keyword>[ <member>]` (como mucho 16, y luego `schema: further errors not listed`) y sin detalles criptográficos. Los miembros desconocidos de los objetos cerrados se rechazan; en los objetos abiertos, como el `target` del intent, los miembros declarados conservan sus restricciones y solo los adicionales quedan sin inspeccionar. `session_issued_at` y `session_expires_at` del manifiesto deben ser cadenas cuando están presentes, no `null`. `date-time` sigue la comprobación de ajv-formats 3.0.1 del verificador de referencia, que no es RFC 3339 estricto. El error de parseo de la política, `JSON parse error` y la detección de versión (`Unknown DCP version`) del binding siguen yendo antes de V2-2. **Cambio de aceptación:** los bundles inválidos por esquema que antes verificaban ahora se rechazan. No hay ninguna API solo de esquema. Véase el [mapa de cobertura](../../docs/conformance/SECURITY_COVERAGE.md#schema-and-cryptographic-api-boundary).

<a id="hash-operations"></a>

### Operaciones de hash

| Método | Devuelve | Descripción |
|--------|---------|-------------|
| `dualHash(data)` | `DualHash` | Hash dual SHA-256 + SHA3-256 |
| `sha3_256(data)` | `string` | Hash SHA3-256 en hexadecimal |
| `hashObject(obj)` | `string` | Hash SHA-256 de un objeto JSON, siempre de 64 caracteres hexadecimales en minúsculas. Desde la 2.2.0 lanza un `Error` cuando el binding no puede leer el valor, por ejemplo un surrogate solitario, donde 2.1.3 devuelve el sobre de error como si fuera el hash |
| `dualMerkleRoot(leaves)` | `DualHash` | Raíz Merkle dual de [VERIFICATION.md V2-11](../../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) a partir de un arreglo no vacío de hojas `DualHash`, cada una un digest hex de 32 bytes; lanza una excepción con un arreglo vacío o con una hoja no válida. La raíz va en hex en minúsculas. Desde la 2.1.3: 2.1.1 y anteriores hashean el texto hex, así que sus raíces de dos o más hojas difieren |

<a id="canonicalization-domain-separation"></a>

### Canonicalización y separación de dominios

| Método | Devuelve | Descripción |
|--------|---------|-------------|
| `canonicalize(value)` | `string` | Canonicalización `dcp-jcs-v1` (basada en JCS de RFC 8785) del valor tal como lo escribe `JSON.stringify`, así que `NaN` y `±Infinity` pasan a `null`, y un `BigInt` o un ciclo hacen que `JSON.stringify` lance su propio `TypeError`. Lanza un `Error` (`canonicalize: …`) ante una fracción o un valor que el binding no puede leer, como un surrogate solitario. Desde la 2.2.0 lee el export etiquetado, así que un valor cuya forma canónica empieza por un miembro `error`, como `{ error: 'x' }`, se canonicaliza; 2.1.3 lanza un error para él |
| `domainSeparatedMessage(context, payloadHex)` | `string` | Mensaje con separación de dominios, en hexadecimal |
| `deriveKid(alg, publicKeyB64)` | `string` | Identificador de clave determinista a partir del algoritmo y la clave pública, siempre de 32 caracteres hexadecimales en minúsculas. Desde la 2.2.0 lanza un `Error` ante base64 inválido, donde 2.1.3 devuelve el sobre de error como si fuera el id de clave |

<a id="session-security"></a>

### Sesión y seguridad

| Método | Devuelve | Descripción |
|--------|---------|-------------|
| `generateSessionNonce()` | `string` | Nonce aleatorio de 256 bits, representado por 64 caracteres hexadecimales |
| `verifySessionBinding(artifacts)` | `SessionBindingResult` | Comprueba la coherencia del nonce entre artefactos |
| `computeSecurityTier(intent, policyDecision?)` | `SecurityTierResult` | Calcula el nivel de seguridad adaptativo: routine/standard/elevated/maximum; `risk_score` procede de la decisión de política |

<a id="payload-preparation"></a>

### Preparación del contenido

| Método | Devuelve | Descripción |
|--------|---------|-------------|
| `preparePayload(payload)` | `PreparedPayload` | Canonicaliza el contenido y calcula su hash |

<a id="bundle-building-signing"></a>

### Construcción y firma de bundles

| Método | Devuelve | Descripción |
|--------|---------|-------------|
| `buildBundle(opts)` | `CitizenshipBundleV2` | Construye un bundle V2 con manifiesto a partir de artefactos firmados con `signPayload`; `sessionNonce` usa por defecto el `session_nonce` del RPR |
| `signBundle(bundle, classicalSk, classicalKid, pqSk, pqKid)` | `SignedBundleV2` | Firma un bundle con firma compuesta; `signer.id` es el `human_id` del RPR. Si el manifiesto tiene `session_expires_at` pero no `session_issued_at`, establece `session_issued_at` en el instante de firma |

<a id="proof-of-possession"></a>

### Prueba de posesión

| Método | Devuelve | Descripción |
|--------|---------|-------------|
| `generateRegistrationPop(challenge, sk, alg)` | `SignatureEntry` | Genera una prueba de posesión (PoP) para registrar una clave |
| `verifyRegistrationPop(challenge, pop, pk, alg)` | `PopResult` | Verifica una PoP |

<a id="utility"></a>

### Utilidades

| Método | Devuelve | Descripción |
|--------|---------|-------------|
| `detectVersion(value)` | `string \| null` | Detecta la versión del protocolo DCP en un objeto JSON |

<a id="dcp-0509-types"></a>

### Tipos DCP-05–09

El SDK WASM incluye interfaces de TypeScript para todos los artefactos DCP-05 a DCP-09, equivalentes a los tipos del SDK de Rust:

| Especificación | Interfaces |
|------|-----------|
| DCP-05 Ciclo de vida | `LifecycleState`, `CommissioningCertificate`, `VitalityReport`, `VitalityMetrics`, `DecommissioningRecord`, `TerminationMode`, `DataDisposition` |
| DCP-06 Sucesión | `DigitalTestament`, `SuccessionRecord`, `MemoryTransferManifest`, `MemoryTransferEntry`, `SuccessorPreference`, `MemoryClassification`, `TransitionType`, `MemoryDisposition` |
| DCP-07 Disputas | `DisputeRecord`, `ArbitrationResolution`, `JurisprudenceBundle`, `ObjectionRecord`, `DisputeType`, `EscalationLevel`, `DisputeStatus`, `ObjectionType`, `AuthorityLevel` |
| DCP-08 Derechos | `RightsDeclaration`, `RightEntry`, `ObligationRecord`, `RightsViolationReport`, `RightType`, `ComplianceStatus` |
| DCP-09 Delegación | `DelegationMandate`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `AwarenessThreshold`, `ThresholdRule`, `AuthorityScopeEntry`, `ThresholdOperator`, `ThresholdAction` |

`domainSeparatedMessage()`, `compositeSign()` y `compositeVerify()` reciben el nombre completo de un contexto que conoce
el registro de Rust a partir del cual se compila el paquete. Son 20: los 19 de los vectores de interop, entre ellos
`DCP-AI.v2.Lifecycle`, `…Succession`, `…Dispute`, `…Rights`, `…Delegation` y `…Awareness`, y
`DCP-AI.v2.MandateAcknowledgment`. Dos contextos de la tabla de [v2.0 § 4.1](../../../../spec/DCP-AI-v2.0.md) no están entre
ellos: `DCP-AI.v2.AlgorithmAdvisory` y `DCP-AI.v2.Governance`. Firmar o verificar con el contexto del acuse no evalúa
ningún acuse ni ninguna activación.

Son solo tipos. El paquete no exporta ninguna función de vigencia, de cadena de mandatos, de admisión ni de activación. Es el alcance del piloto, no un límite de los navegadores: el backend de una aplicación de navegador usa uno de los cuatro SDK, y una admisión calculada en un navegador a partir de entradas que controla el cliente no autoriza nada en un servidor. `verify_mandate_validity_at` y `verify_mandate_chain` están en el crate de Rust a partir del cual se compila el paquete, y los demás SDK tienen los suyos.

<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in"></a>
<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in-unreleased"></a>

## Experimental: candidato de canonicalización `dcp-jcs-v2` (activación explícita)

No es normativo ni está activado: `dcp-jcs-v1` sigue siendo el único perfil de canonicalización y no cambian los valores predeterminados, constructores, firmantes ni verificadores. Estos métodos están disponibles para quien opte explícitamente por ellos también en npm WASM 2.1.0. Los enlaces WASM reciben únicamente bytes; los valores del entorno anfitrión se comprueban primero en JavaScript. Un bundle verificado mediante el candidato no otorga confianza ni admisión. Diseño y contrato: [`docs/proposals/canonicalization-candidate`](../../../../docs/proposals/canonicalization-candidate/README.md) (§15 entrada, §16 enrutador, §17 verificador, §18 productores).

| Método | Descripción |
|--------|-------------|
| `experimentalCandidateIngress(bytes)` | `{ status: 'accept', canonical, ... }` o `{ status: 'reject', class, offset }` |
| `experimentalCandidateExtractUnit(bytes, transport)` | Unidad de un transporte `bare` o `envelope` |
| `createExperimentalCandidateRouter(config)` | Enruta bytes; `historical` es uno de los `experimentalWasmHistoricalAdapters` (`w1…` para objetos mediante `JSON.stringify`, `w2…` para texto); ninguno se elige por defecto |
| `createExperimentalCandidateVerifier(config).verify(bytes, policy?)` | Verifica desde los bytes originales con un máximo de un verificador; obtiene la hora de `Date.now` |
| `experimentalCandidateSignPayload(context, input, keys)` | Firma un artefacto a partir de `{ bytes }` o `{ value }` |
| `experimentalCandidateSignBundle(parts, signer, options)` | Ensambla y firma un bundle cuyo manifiesto identifica `dcp-jcs-v2` |
| `ExperimentalWasmCandidateProduceError` | Rechazo del dominio o de la forma de las entradas, antes de que cualquier enlace WASM firme |

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

<a id="low-level-api"></a>

## API de bajo nivel

También puedes utilizar directamente las funciones WASM, sin el envoltorio de TypeScript:

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
// ... raw functions return JSON text, or a plain string for a hash, a key id, a nonce,
// a domain-separated message (hex) or a canonical form
```

Las funciones crudas informan de los errores en banda, como `{"error": "<message>"}`. Desde la 2.2.0 ese sobre es JSON escapado. Antes, un mensaje con una barra invertida o un carácter de control, por ejemplo de
un nombre de clave, podía ser JSON inválido o decodificarse como otro texto. `wasm_canonicalize_v2` devuelve la forma
canónica o ese sobre, así que no puede distinguir su error de un valor cuya forma canónica es `{"error": …}`. La 2.2.0 añade `wasm_canonicalize_v2_result`, que devuelve `{"ok": true, "canonical": …}` o
`{"ok": false, "error": …}`; `canonicalize()` lo usa.

Véase [example.html](../../../../sdks/wasm/example.html) para una demostración interactiva completa en el navegador.

<a id="security-tiers"></a>

## Niveles de seguridad

`computeSecurityTier(intent, policyDecision?)` calcula el nivel de seguridad adaptativo (spec §14.2). `risk_score` procede de la decisión de política (0 si no se proporciona una); un valor desconocido o ausente de `action_type`, `estimated_impact` o `data_classes`, o un `risk_score` ausente o que no sea un entero entre 0 y 1000, se considera `elevated`. `intent.security_tier` solo puede elevar el resultado. Se aplica el nivel más alto que coincida.

| Nivel | Condición (cualquiera de ellas) | Modo de verificación | Intervalo de checkpoints |
|------|---------------|-------------------|---------------------|
| `routine` | Ninguna de las condiciones siguientes | `classical_only` | 50 |
| `standard` | `risk_score` 200–499, `estimated_impact: medium` | `hybrid_preferred` | 10 |
| `elevated` | `risk_score` 500–799, `pii` / `financial_data` / `health_data`, `initiate_payment`, `estimated_impact: high`, valores desconocidos | `hybrid_required` | 1 |
| `maximum` | `risk_score` ≥ 800, `credentials` / `children_data` | `hybrid_required` | 1 |

<a id="algorithms-supported"></a>

## Algoritmos compatibles

| Categoría | Algoritmo | Estándar |
|----------|-----------|----------|
| Firma clásica | Ed25519 | RFC 8032 |
| Firma poscuántica | ML-DSA-65 | FIPS 204 |
| Firma poscuántica sin estado | SLH-DSA-192f | FIPS 205 |
| Encapsulación de claves poscuántica | ML-KEM-768 | FIPS 203 |
| Hashes | SHA-256 + SHA3-256 | FIPS 180-4, FIPS 202 |
| Canonicalización | `dcp-jcs-v1` | Basada en RFC 8785 (JCS) |

<a id="development"></a>

## Desarrollo

<a id="prerequisites"></a>

### Requisitos previos

```bash
# Install wasm-pack
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

# Install WASM target
rustup target add wasm32-unknown-unknown
```

<a id="run-rust-wasm-tests"></a>

### Ejecutar las pruebas WASM de Rust

```bash
cd ../rust
wasm-pack test --headless --chrome -- --features wasm
```

<a id="conformance-in-a-browser"></a>

### Conformidad en un navegador

El [wrapper de navegador](../../tools/conformance/README.md#browser-wrapper-dcpwasm-in-chrome) del kit ejecuta en Chrome
los catálogos de conformidad, y llamadas directas de `DcpWasm`, contra una build de este paquete. El
[mapa de cobertura](../../docs/conformance/SECURITY_COVERAGE.md#public-interfaces-mp-03-08112026) indica qué cubre cada
corrida.

<a id="license"></a>

## Licencia

Apache-2.0
