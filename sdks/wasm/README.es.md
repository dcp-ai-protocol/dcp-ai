<sub>[English](README.md) · [中文](README.zh-CN.md) · **Español** · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="dcp-aiwasm-webassembly-sdk-v20"></a>

# @dcp-ai/wasm — SDK WebAssembly v2.0

> Traducción informativa del [README en inglés](README.md), actualizada el 26/10/2026. Los identificadores y los bloques de código, incluidos sus comentarios, se conservan para mantener los ejemplos probados.

Módulo WebAssembly para el Digital Citizenship Protocol (DCP) v2.0, compilado a partir del SDK de Rust. Ofrece firmas compuestas poscuánticas, generación de claves híbridas, encapsulación de claves ML-KEM-768, hashes duales, construcción y verificación de bundles y cálculo del nivel de seguridad. Se ejecuta directamente en el navegador o en Node.js, sin servidor.

<a id="installation"></a>

## Instalación

**Publicado en npm (26/10/2026).** `@dcp-ai/wasm` 2.1.0 se publicó como `latest` en esa fecha e incluía las API descritas aquí, incluidas las experimentales de `dcp-jcs-v2`. Publicarlas no activó el candidato: siguió siendo opt-in y no normativo, sin cambios en `dcp-jcs-v1`. El crate de Rust tiene un ciclo de publicación independiente.

**`@dcp-ai/wasm` 2.1.1.** Esta versión también verifica los campos secundarios SHA3-256 de [VERIFICATION.md V2-11](../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) cuando están presentes: `audit_merkle_root_secondary`, cada `prev_hash_secondary` y cada `intent_hash_secondary`. Los campos ausentes no se exigen, así que un bundle verificado puede no tener una cadena secundaria completa; un campo presente que sea `null`, no sea una cadena o sea incoherente se rechaza. No cambian las API, los campos de resultado, `dcp-jcs-v1` ni el tratamiento de `hash_alg`. La versión 2.1.0 no comprueba estos campos. Los comandos de instalación siguientes indican esta versión; para su disponibilidad en el registro, véase [Versiones publicadas](../../docs/README.md#published-versions).

```bash
npm install @dcp-ai/wasm@^2.1.1
```

Consulta el [inventario de publicaciones npm](../../docs/NPM_RELEASES.md) para ver todas las versiones.

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

Inicializa el módulo WASM. Debe llamarse una vez antes de utilizar cualquier API. Opcionalmente acepta la URL del archivo `.wasm`; en Node.js, pásala como URL `data:` (véase [Inicialización](#initialization-browser-and-nodejs)).

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

La verificación no otorga confianza en el principal, admisión ni autorización para actuar. El verificador V2 comprueba la cadena de auditoría primaria y la raíz Merkle primaria; desde la 2.1.1 también comprueba los enlaces secundarios opcionales, los hashes de intención y `audit_merkle_root_secondary` que estén presentes, mientras que la 2.1.0 no ([cadenas de doble hash](../../docs/STORAGE_AND_ANCHORING.md#dual-hash-chains)). El candidato experimental reutiliza estas comprobaciones.

| Método | Devuelve | Descripción |
|--------|---------|-------------|
| `compositeVerify(context, payload, sig, classicalPk, pqPk?)` | `CompositeVerifyResult` | Verificación criptográfica de una firma compuesta |
| `verifyBundle(signedBundle, policy?)` | `V2VerificationResult` | Verifica un bundle V2 —estructura, criptografía y cadena de hashes primaria— con el más estricto de los modos de la política y del nivel de seguridad (spec §14.3); informa `resolved_tier` y `verification_mode`. `policy` solo puede diferir de los valores predeterminados en `default_mode`, `risk_overrides`, los campos de la fase 3 (`advisory_rejected_algs`, `warn_classical_only_deprecated`, `allow_classical_fallback_disable`), `max_session_duration_seconds` (medida desde el `session_issued_at` firmado, que `signBundle` escribe cuando el manifiesto contiene `session_expires_at`), `require_session_expiry` (rechaza un manifiesto sin `session_expires_at`) y `require_audience_binding` con `verifier_id` (rechaza un manifiesto sin `intended_verifier` o con un valor distinto de `verifier_id`). Cuando se proporciona una política, se rechazan los bundles V1 |

<a id="hash-operations"></a>

### Operaciones de hash

| Método | Devuelve | Descripción |
|--------|---------|-------------|
| `dualHash(data)` | `DualHash` | Hash dual SHA-256 + SHA3-256 |
| `sha3_256(data)` | `string` | Hash SHA3-256 en hexadecimal |
| `hashObject(obj)` | `string` | Hash SHA-256 de un objeto JSON |
| `dualMerkleRoot(leaves)` | `DualHash` | Raíz Merkle dual a partir de un arreglo de hojas `DualHash` |

<a id="canonicalization-domain-separation"></a>

### Canonicalización y separación de dominios

| Método | Devuelve | Descripción |
|--------|---------|-------------|
| `canonicalize(value)` | `string` | Canonicalización `dcp-jcs-v1`, basada en RFC 8785 JCS |
| `domainSeparatedMessage(context, payloadHex)` | `string` | Mensaje con separación de dominios, en hexadecimal |
| `deriveKid(alg, publicKeyB64)` | `string` | Identificador de clave determinista a partir del algoritmo y la clave pública |

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

Contextos de separación de dominios disponibles mediante `domainSeparatedMessage()`: `Lifecycle`, `Succession`, `Dispute`, `Rights`, `Delegation`, `Awareness`.

<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in"></a>
<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in-unreleased"></a>

## Experimental: candidato de canonicalización `dcp-jcs-v2` (activación explícita)

No es normativo ni está activado: `dcp-jcs-v1` sigue siendo el único perfil de canonicalización y no cambian los valores predeterminados, constructores, firmantes ni verificadores. Estos métodos están disponibles para quien opte explícitamente por ellos también en npm WASM 2.1.0. Los enlaces WASM reciben únicamente bytes; los valores del entorno anfitrión se comprueban primero en JavaScript. Un bundle verificado mediante el candidato no otorga confianza ni admisión. Diseño y contrato: [`docs/proposals/canonicalization-candidate`](../../docs/proposals/canonicalization-candidate/README.md) (§15 entrada, §16 enrutador, §17 verificador, §18 productores).

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
// ... use raw functions, all return JSON strings
```

Véase [example.html](./example.html) para una demostración interactiva completa en el navegador.

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

<a id="license"></a>

## Licencia

Apache-2.0
