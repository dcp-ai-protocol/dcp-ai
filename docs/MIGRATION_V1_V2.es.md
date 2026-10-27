<sub>[English](MIGRATION_V1_V2.md) · [中文](MIGRATION_V1_V2.zh-CN.md) · **Español** · [日本語](MIGRATION_V1_V2.ja.md) · [Português](MIGRATION_V1_V2.pt-BR.md)</sub>

<a id="migration-guide-dcp-ai-v10-to-v20"></a>

# Guía de migración: de DCP-AI v1.0 a v2.0

> Traducción informativa de [la versión en inglés](MIGRATION_V1_V2.md), actualizada el 27/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

**Versión de la especificación:** 2.0
**Última actualización:** octubre de 2026
**Se aplica a:** los SDK de `main` y `@dcp-ai/sdk` 2.2.0 publicado. Las versiones npm se verificaron el 26/10/2026; véanse [NPM_RELEASES.md](NPM_RELEASES.md) y [SECURITY.md](../SECURITY.md#supported-versions). Las versiones de los demás SDK están en [Versiones publicadas](README.md#published-versions).

Esta guía te acompaña en la migración de una integración existente de DCP-AI v1.0 a v2.0. La migración introduce firmas compuestas poscuánticas, cadenas de doble hash, vinculación de sesión, niveles de seguridad adaptativos y comunicación entre agentes, mientras que los bundles v1.0 válidos siguen verificándose donde la política del verificador los permita (véase 1.2).

---

<a id="1-what-changed-in-v20"></a>

## 1. Qué cambió en v2.0

<a id="11-summary-of-changes"></a>

### 1.1 Resumen de los cambios

| Funcionalidad | v1.0 | v2.0 |
|---------|------|------|
| **Firmas** | Solo Ed25519 | Compuestas: Ed25519 + ML-DSA-65 (PQ) |
| **Cadenas de hash** | Solo SHA-256 | Dobles: SHA-256 + SHA3-256 |
| **Vinculación de sesión** | Ninguna | `session_nonce` en cada artefacto |
| **Niveles de seguridad** | Ninguno | Adaptativos: routine / standard / elevated / maximum |
| **Manifiesto del bundle** | `bundle_hash` + `merkle_root` | Manifiesto completo con hashes por artefacto, raíz de Merkle secundaria y checkpoints PQ |
| **Formato de firma** | `{ alg, public_key_b64, sig_b64 }` | `{ composite_sig: { classical, pq, binding } }` |
| **Comunicación A2A** | No especificada | DCP-04: descubrimiento, handshake, sesiones cifradas |
| **Política de verificación** | Declarada por el agente | Decidida por el verificador |
| **Separación de dominio** | Ninguna | Etiquetas de contexto en todas las firmas |
| **Derivación del kid** | Específica de cada implementación | Determinista: `hex(SHA-256(alg || 0x00 || pk))[0:32]` |
| **Campos numéricos** | Mixtos (int/float) | Solo enteros (float prohibido) |
| **Privacidad** | Solo RPR completo | Modo de RPR cegado disponible |
| **Recuperación de claves** | No especificada | Recuperación social M de N (Shamir SSS) |
| **Revocación de emergencia** | No especificada | Token de revocación registrado de antemano |
| **Gobernanza de algoritmos** | No especificada | Avisos firmados con respuesta automática |
| **Formato de transmisión** | Solo JSON | JSON (por defecto) + CBOR (opcional) |

<a id="12-breaking-changes"></a>

### 1.2 Cambios incompatibles

El formato v1.0 sigue siendo válido, con estos límites:

- Un verificador que maneja ambas versiones acepta un bundle v1.0 válido cuando su política tiene `allow_v1_bundles: true`
  (el valor por defecto) y el modo efectivo tolera una firma solo clásica (más abajo). `verifySignedBundleV2` en sí
  acepta solo v2.0: dirige los bundles v1.0 al verificador V1 (véase 3.2).
- La aceptación es más estricta que en versiones anteriores: por ejemplo, ahora se rechaza una firma Ed25519 cuyo `S` no es menor que el
  orden del grupo `L` (véase [`[Unreleased]`](../CHANGELOG.md#unreleased) del registro de cambios), así que un
  bundle v1.0 almacenado que un verificador anterior aceptaba puede dejar de verificarse.
- Los verificadores v1.0 rechazan los bundles v2.0 (`"unsupported dcp_version 2.0"`).

Un bundle v1.0 tiene una firma Ed25519 y ninguna poscuántica, así que los middlewares de verificación (`@dcp-ai/express`, `@dcp-ai/openclaw`, `dcp_ai.fastapi`) lo aceptan solo donde pasaría un bundle v2.0 solo clásico (VERIFICATION.md V2-10): el más estricto entre el modo de la política para el `risk_tier` del pasaporte V1 y el modo del nivel de seguridad calculado a partir de la intención y la decisión de política V1 (el `risk_score` V1, de 0 a 1, multiplicado por 1000; si falta, cuenta como `elevated`) debe ser `classical_only` o `hybrid_preferred`. Con la política por defecto, un bundle V1 con una intención routine o standard pasa, y uno con un pago, datos sensibles, un impacto estimado alto o una puntuación de riesgo de 0.5 o más se rechaza; `requireHybrid` de Express rechaza todos los bundles V1.

La migración es **aditiva**: v2.0 introduce campos y estructuras nuevos junto al formato v1.0. Puedes migrar productores (agentes) y consumidores (verificadores) de forma independiente.

---

<a id="2-step-by-step-migration"></a>

## 2. Migración paso a paso

<a id="step-1-update-sdk"></a>

### Paso 1: actualizar el SDK

Los ejemplos funcionan con TypeScript SDK 2.2.0, Python `dcp-ai` 2.10.0, Go `v2.11.0` y Rust `dcp-ai` 2.11.0 publicados. Véanse las notas de [Python](PYTHON_RELEASE.md), [Go](GO_RELEASE.md) y [Rust](RUST_RELEASE.md), y los límites documentados en el README de cada SDK.

**TypeScript** (publicado: 2.2.0 el 26/10/2026):

```bash
npm install @dcp-ai/sdk@^2.2.0
```

**Python:**

```bash
pip install -e /path/to/dcp-ai/sdks/python     # main
# or the published version, with optional framework extras: pip install --upgrade 'dcp-ai[fastapi]'
```

**Go** (fíjate en el sufijo de versión mayor v2 que exigen los módulos de Go):

```bash
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.11.0
```

**Rust:**

```toml
dcp-ai = "2.11.0"
```

**WebAssembly:** compila `sdks/wasm` desde una copia del repositorio (`npm run build`) y después `npm install /path/to/dcp-ai/sdks/wasm`.

<a id="step-2-generate-hybrid-key-pairs"></a>

### Paso 2: generar pares de claves híbridos

Esta migración híbrida usa pares de claves clásicos (Ed25519) y poscuánticos (ML-DSA-65). La aceptación de firmas solo clásicas sigue dependiendo del modo efectivo de verificación (1.2).

**TypeScript:**

```typescript
import { getDefaultRegistry, registerDefaultProviders } from '@dcp-ai/sdk';

registerDefaultProviders(); // Ed25519, ML-DSA-65, SLH-DSA-192f into the default registry
const registry = getDefaultRegistry();

const classicalKp = await registry.getSigner('ed25519').generateKeypair();
const pqKp = await registry.getSigner('ml-dsa-65').generateKeypair();
// each: { kid, publicKeyB64, secretKeyB64 }; kid = deriveKid(alg, publicKey)
```

**Python:**

```python
import asyncio
from dcp_ai.providers.ed25519_provider import Ed25519Provider
from dcp_ai.providers.ml_dsa_65_provider import MlDsa65Provider

async def generate_hybrid():
    return await Ed25519Provider().generate_keypair(), await MlDsa65Provider().generate_keypair()

classical, pq = asyncio.run(generate_hybrid())
# each: {"kid", "public_key_b64", "secret_key_b64"}
```

El SDK de Python construye, firma y verifica bundles V2 con `dcp_ai.v2` (`BundleBuilderV2`, `sign_bundle_v2`,
`verify_signed_bundle_v2`; véase 5.2).

**CLI** (`bin/dcp.js` en una copia del repositorio):

```bash
dcp keygen --hybrid ./keys/
# Creates: ed25519_{public_key,secret_key,kid}.txt and ml_dsa_65_{public_key,secret_key,kid}.txt
```

<a id="step-3-update-artifact-construction"></a>

### Paso 3: actualizar la construcción de los artefactos

Cada uno de los cuatro artefactos V2 (RPR, pasaporte, intención y decisión de política) incorpora `dcp_version: "2.0"` y el `session_nonce` del bundle, y se firma por separado como un
`SignedPayload` (paso 4). Las claves pasan a estar dentro de los artefactos: el RPR enumera las claves del principal en `binding_keys`,
y el pasaporte enumera las del agente en `keys`, cada una con `kid`, `alg`, `public_key_b64`, `created_at`,
`expires_at` y `status`.

**Antes (RPR v1.0):** una `signature` Ed25519 separada sobre el objeto sin ella.

```json
{
  "dcp_version": "1.0",
  "human_id": "human:example-001",
  "legal_name": "Example Principal",
  "entity_type": "natural_person",
  "jurisdiction": "ES",
  "liability_mode": "owner_responsible",
  "override_rights": true,
  "issued_at": "2026-10-25T00:00:00Z",
  "expires_at": null,
  "contact": null,
  "signature": "<base64 Ed25519 signature>"
}
```

**Después (payload del RPR v2.0):** sin campo `signature`; la firma compuesta va junto al payload (paso 4).

```json
{
  "dcp_version": "2.0",
  "human_id": "human:example-001",
  "session_nonce": "<64 hex characters>",
  "legal_name": "Example Principal",
  "entity_type": "natural_person",
  "jurisdiction": "ES",
  "liability_mode": "owner_responsible",
  "override_rights": true,
  "issued_at": "2026-10-25T00:00:00Z",
  "expires_at": null,
  "contact": null,
  "binding_keys": [
    { "kid": "<32 hex>", "alg": "ed25519", "public_key_b64": "...", "created_at": "2026-01-01T00:00:00Z", "expires_at": null, "status": "active" },
    { "kid": "<32 hex>", "alg": "ml-dsa-65", "public_key_b64": "...", "created_at": "2026-01-01T00:00:00Z", "expires_at": null, "status": "active" }
  ]
}
```

Diferencias principales:
- `dcp_version` es `"2.0"`, y `session_nonce` (64 caracteres hexadecimales, 256 bits aleatorios) es el mismo en todos los
  artefactos del bundle.
- El pasaporte sustituye `public_key` por `keys` (entradas Ed25519 y ML-DSA-65), y el `risk_score` de la decisión de política
  pasa a ser un entero de 0 a 1000 (spec §14.2).
- Las firmas salen de los payloads.

<a id="step-4-switch-to-composite-signatures"></a>

### Paso 4: pasar a firmas compuestas

Cada uno de estos cuatro artefactos V2 es un `SignedPayload`: el payload, su hash y una firma compuesta en el contexto de separación de dominio
del artefacto (el RPR con las claves del principal; el pasaporte, la intención y la decisión de política con las del
agente).

```json
{
  "payload": { "dcp_version": "2.0", "...": "..." },
  "payload_hash": "sha256:<hex of the canonical payload>",
  "composite_sig": {
    "classical": { "alg": "ed25519", "kid": "<32 hex>", "sig_b64": "..." },
    "pq": { "alg": "ml-dsa-65", "kid": "<32 hex>", "sig_b64": "..." },
    "binding": "pq_over_classical"
  }
}
```

Diferencias principales:
- Cada componente nombra su clave por `kid` (determinista, paso 2) en lugar de llevar la clave pública.
- `binding: "pq_over_classical"`: la firma PQ cubre la firma clásica, así que la firma clásica no puede sustituirse
  sin invalidar la PQ. La propia firma PQ sí puede quitarse y reetiquetarse la vinculación como `classical_only`: los
  verificadores lo aceptan en los modos `classical_only` y `hybrid_preferred` (en este último, con una advertencia) y lo
  rechazan en `hybrid_required` y `pq_only`. Una firma PQ presente pero inválida se rechaza en todos los modos.

**SDK de TypeScript** (un fragmento; el
[Quick Start (V2)](../sdks/typescript/README.md#quick-start-v2) del SDK de TypeScript es el flujo completo y ejecutable):

```typescript
import { compositeSign, preparePayload, DCP_CONTEXTS } from '@dcp-ai/sdk';

// payload: a V2 artifact payload; registry and agentKeys (a CompositeKeyPair) as in Step 2
const { canonicalBytes, payloadHash } = preparePayload(payload);
const signedIntent = {
  payload,
  payload_hash: payloadHash,
  composite_sig: await compositeSign(registry, DCP_CONTEXTS.Intent, canonicalBytes, agentKeys),
};
```

<a id="step-5-add-domain-separation"></a>

### Paso 5: añadir la separación de dominio

Cada firma V2 se calcula sobre `UTF8(context) || 0x00 || canonical_bytes`, con el contexto del artefacto
(`DCP-AI.v2.Intent`, `DCP-AI.v2.Bundle`, etc., `DCP_CONTEXTS`). `compositeSign`, `signBundleV2` y sus
equivalentes en los demás SDK lo hacen por ti. Si construyes el mensaje tú mismo, usa la canonicalización V2
(`dcp-jcs-v1`):

```typescript
import { canonicalizeV2, domainSeparatedMessage, DCP_CONTEXTS } from '@dcp-ai/sdk';

// manifest: the bundle manifest (Step 7)
const message = domainSeparatedMessage(DCP_CONTEXTS.Bundle, new TextEncoder().encode(canonicalizeV2(manifest)));
// classical signature over `message`; the PQ signature over `message || classical signature bytes`
```

<a id="step-6-update-audit-entries"></a>

### Paso 6: actualizar las entradas de auditoría

**Antes (v1.0):**

```json
{
  "dcp_version": "1.0",
  "audit_id": "audit:example-001",
  "prev_hash": "GENESIS",
  "timestamp": "2026-10-25T00:01:00Z",
  "agent_id": "agent:example-001",
  "human_id": "human:example-001",
  "intent_id": "intent:example-001",
  "intent_hash": "<hex>",
  "policy_decision": "approved",
  "outcome": "call_completed",
  "evidence": { "tool": "http", "result_ref": null }
}
```

**Después (v2.0):**

```json
{
  "dcp_version": "2.0",
  "audit_id": "audit:example-001",
  "session_nonce": "<the bundle's nonce>",
  "prev_hash": "GENESIS",
  "hash_alg": "sha256",
  "timestamp": "2026-10-25T00:01:00Z",
  "agent_id": "agent:example-001",
  "human_id": "human:example-001",
  "intent_id": "intent:example-001",
  "intent_hash": "sha256:<hex of the canonical intent payload>",
  "policy_decision": "approved",
  "outcome": "call_completed",
  "evidence": { "tool": "http", "result_ref": null, "evidence_hash": null },
  "pq_checkpoint_ref": null
}
```

Campos nuevos: `session_nonce`, `hash_alg`, `evidence.evidence_hash` y `pq_checkpoint_ref`; los hashes llevan el
prefijo `sha256:`. Una cadena de doble hash añade `prev_hash_secondary` (SHA3-256) y `hash_alg: "sha256+sha3-256"`.
En el código fuente aún no publicado, los verificadores V2, incluido el candidato experimental, comprueban los enlaces secundarios, los hashes de intención y `audit_merkle_root_secondary` que estén presentes; los ausentes no se exigen y los paquetes publicados son anteriores a esta comprobación, así que producir estos campos solo acredita la protección adicional cuando tanto el productor como el verificador la incluyen
([STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md#dual-hash-chains)).
Las entradas de auditoría no se firman una a una: el manifiesto se compromete con ellas mediante la raíz de Merkle de la auditoría, y los checkpoints
PQ firman rangos de ellas.

<a id="step-7-construct-bundle-manifest"></a>

### Paso 7: construir el manifiesto del bundle

V1 firma el bundle completo (`signature.bundle_hash`); V2 firma un manifiesto que se compromete con cada artefacto.

**Antes (bundle firmado v1.0):**

```json
{
  "bundle": {
    "responsible_principal_record": { "...": "..." },
    "agent_passport": { "...": "..." },
    "intent": { "...": "..." },
    "policy_decision": { "...": "..." },
    "audit_entries": [{ "...": "..." }]
  },
  "signature": {
    "alg": "ed25519",
    "created_at": "2026-10-25T00:02:00Z",
    "signer": { "type": "human", "id": "human:example-001", "public_key_b64": "..." },
    "bundle_hash": "sha256:<hex>",
    "merkle_root": "sha256:<hex>",
    "sig_b64": "..."
  }
}
```

**Después (bundle firmado v2.0):**

```json
{
  "bundle": {
    "dcp_bundle_version": "2.0",
    "manifest": {
      "session_nonce": "<64 hex>",
      "rpr_hash": "sha256:...",
      "passport_hash": "sha256:...",
      "intent_hash": "sha256:...",
      "policy_hash": "sha256:...",
      "audit_merkle_root": "sha256:...",
      "audit_count": 1,
      "canonicalization_profile": "dcp-jcs-v1"
    },
    "responsible_principal_record": { "payload": { "...": "..." }, "payload_hash": "sha256:...", "composite_sig": { "...": "..." } },
    "agent_passport": { "payload": { "...": "..." }, "payload_hash": "sha256:...", "composite_sig": { "...": "..." } },
    "intent": { "payload": { "...": "..." }, "payload_hash": "sha256:...", "composite_sig": { "...": "..." } },
    "policy_decision": { "payload": { "...": "..." }, "payload_hash": "sha256:...", "composite_sig": { "...": "..." } },
    "audit_entries": [{ "...": "..." }]
  },
  "signature": {
    "hash_alg": "sha256",
    "created_at": "2026-10-25T00:02:00Z",
    "signer": { "type": "human", "id": "human:example-001", "kids": ["<classical kid>", "<pq kid>"] },
    "manifest_hash": "sha256:<hex of the canonical manifest>",
    "composite_sig": { "classical": { "...": "..." }, "pq": { "...": "..." }, "binding": "pq_over_classical" }
  }
}
```

El manifiesto:
- tiene un hash por artefacto (el `payload_hash` de cada artefacto) y la raíz de Merkle de la auditoría;
- puede añadir `audit_merkle_root_secondary` (SHA3-256), `pq_checkpoints`, la ventana de sesión firmada
  (`session_issued_at`, `session_expires_at`), `intended_verifier` y `canonicalization_profile`;
- lo firma el principal responsable con una firma compuesta en el contexto `DCP-AI.v2.Bundle`.

<a id="step-8-update-verifier-configuration"></a>

### Paso 8: actualizar la configuración del verificador

La verificación V2 usa una política de verificador que decide el verificador, no el bundle. Parte de
`DEFAULT_VERIFIER_POLICY` y cambia lo que necesites: los campos que omitas no se rellenan con los valores por defecto
(sin `max_key_age_days`, por ejemplo, no se produce ningún aviso por antigüedad de clave; esa comprobación avisa, no rechaza).

```typescript
import { DEFAULT_VERIFIER_POLICY, verifySignedBundleV2 } from '@dcp-ai/sdk';
import type { VerifierPolicy } from '@dcp-ai/sdk';

const policy: VerifierPolicy = {
  ...DEFAULT_VERIFIER_POLICY,
  default_mode: 'hybrid_required',
  risk_overrides: { high: 'hybrid_required', medium: 'hybrid_required', low: 'hybrid_preferred' },
  allow_v1_bundles: true,
};
// signedBundle and registry as in the TypeScript SDK's Quick Start (V2)
const result = await verifySignedBundleV2(signedBundle, registry, policy);
```

Los campos están en la [referencia de la API](API_REFERENCE.md#verifierpolicy). Mantén `allow_v1_bundles: true` durante el
periodo de transición. Los bundles V1 siguen necesitando un modo que tolere una firma solo clásica: con esta política
(`hybrid_required` para los niveles medium y high), los middlewares de verificación aceptan bundles V1 solo de
pasaportes de bajo riesgo con intenciones routine o standard.

<a id="step-9-add-security-tier-support-optional"></a>

### Paso 9: añadir compatibilidad con los niveles de seguridad (opcional)

Calcula el nivel de seguridad a partir de la intención y de la decisión de política, que lleva el `risk_score`:

```typescript
// Fragment: the intent and the policy decision are V2 payloads, shortened here.
import { computeSecurityTier } from '@dcp-ai/sdk';
import type { IntentV2, PolicyDecisionV2 } from '@dcp-ai/sdk';

const intent = {
  intent_id: 'intent:...',
  action_type: 'api_call',
  data_classes: ['pii'],
  estimated_impact: 'medium',
  // ...
} as IntentV2;
const policyDecision = { risk_score: 350 /* , ... */ } as PolicyDecisionV2;

const tier = computeSecurityTier(intent, policyDecision);
// tier = "elevated" (pii is sensitive data; risk_score 350 alone would give "standard")
```

<a id="step-10-run-conformance-tests"></a>

### Paso 10: ejecutar las pruebas de conformidad

Desde la raíz de una copia del repositorio (cada comando en su propia subshell):

```bash
# TypeScript
(cd sdks/typescript && npm test)

# Python
(cd sdks/python && pytest)

# NIST KAT compliance only
(cd sdks/typescript && npx vitest run src/__tests__/nist-kat.test.ts)

# Protocol conformance (V1 + V2)
npm run conformance
```

---

<a id="3-backward-compatibility"></a>

## 3. Compatibilidad con versiones anteriores

<a id="31-compatibility-matrix"></a>

### 3.1 Matriz de compatibilidad

```
V1 Verifier + V1 Bundle  ->  PASS (unchanged)
V1 Verifier + V2 Bundle  ->  REJECT "unsupported dcp_version 2.0"
V2 Verifier + V1 Bundle  ->  PASS (when allow_v1_bundles=true and the effective mode
                                    for the bundle is classical_only or hybrid_preferred)
V2 Verifier + V2 Bundle  ->  PASS (full V2 verification)
```

<a id="32-coexistence-strategy"></a>

### 3.2 Estrategia de coexistencia

Durante la migración, tu sistema puede manejar bundles v1.0 y v2.0 dirigiéndolos según la versión:

```typescript
// Fragment: signedBundle comes from the request; v1PublicKeyB64, registry and policy from configuration.
import { detectDcpVersion, verifySignedBundle, verifySignedBundleV2 } from '@dcp-ai/sdk';

const version = detectDcpVersion(signedBundle);  // '2.0', '1.0', or null for anything else
let result;
if (version === '2.0') {
  result = await verifySignedBundleV2(signedBundle, registry, policy);  // composite verification, tier enforcement
} else if (version === '1.0' && policy.allow_v1_bundles) {
  result = verifySignedBundle(signedBundle, v1PublicKeyB64);           // the Ed25519 signature, hashes and chain
} else {
  result = { verified: false, errors: ['unsupported or disallowed bundle version'] };
}
```

Esto solo dirige formatos. La rama V1 no aplica al bundle V1 los modos de la política V2 ni el nivel de seguridad
(VERIFICATION.md V2-10), y ninguna de las dos ramas decide la confianza: lo primero lo hacen los middlewares de verificación, y
lo segundo, la [admisión](ADMISSION.md). `verifySignedBundleV2` solo acepta bundles v2.0; la CLI de referencia
(`dcp verify-bundle`) y los middlewares dirigen por versión por sí mismos.

<a id="33-schema-routing"></a>

### 3.3 Selección de esquemas

Un verificador dirige según la versión del bundle antes de comprobar su esquema:

- un bundle firmado V2 tiene `bundle.dcp_bundle_version: "2.0"` y un `bundle.manifest` → `schemas/v2/*.schema.json`;
- los artefactos de un bundle V1 llevan `dcp_version: "1.0"` → `schemas/v1/*.schema.json`.

<a id="34-when-to-drop-v1-support"></a>

### 3.4 Cuándo dejar de admitir V1

Según la especificación, los verificadores V2 DEBEN admitir bundles V1 indefinidamente. Sin embargo, cada despliegue puede fijar una política que rechace los bundles V1 tras un periodo de transición:

```json
{
  "verifier_policy": {
    "allow_v1_bundles": false
  }
}
```

Solo debería hacerse cuando todos los agentes de tu ecosistema hayan migrado a v2.0.

---

<a id="4-bundle-format-changes-detailed"></a>

## 4. Cambios en el formato del bundle (en detalle)

<a id="41-signed-bundle-envelope"></a>

### 4.1 Sobre del bundle firmado

Los sobres V1 y V2 completos están en el [paso 7](#step-7-construct-bundle-manifest). Diferencias estructurales principales:

- **Firma individual de los artefactos:** el RPR, el pasaporte, la intención y la decisión de política son cada uno un `SignedPayload`
  (`payload`, `payload_hash`, `composite_sig`) firmado en su propio contexto. Las entradas de auditoría siguen sin firmar y
  quedan comprometidas mediante la raíz de Merkle de la auditoría.
- **Manifiesto:** `bundle.manifest` se compromete con el hash de cada artefacto y con la raíz de Merkle de la auditoría; sustituye al
  `signature.bundle_hash` de V1.
- **Nonce de sesión:** el mismo `session_nonce` en cada artefacto, cada entrada de auditoría y el manifiesto.
- **Firma del bundle:** `signature.composite_sig` firma el manifiesto (`signature.manifest_hash`), no el bundle
  completo; `signature.signer.kids` nombra las claves en lugar de llevar una clave pública.
- **Marcador de versión:** `bundle.dcp_bundle_version: "2.0"`.

<a id="42-composite-signature-object"></a>

### 4.2 Objeto de firma compuesta

```json
{
  "composite_sig": {
    "classical": {
      "alg": "ed25519",
      "kid": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
      "sig_b64": "<base64-encoded Ed25519 signature>"
    },
    "pq": {
      "alg": "ml-dsa-65",
      "kid": "f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3",
      "sig_b64": "<base64-encoded ML-DSA-65 signature>"
    },
    "binding": "pq_over_classical"
  }
}
```

<a id="43-audit-entry-changes"></a>

### 4.3 Cambios en las entradas de auditoría

| Campo | v1.0 | v2.0 |
|-------|------|------|
| `dcp_version` | `"1.0"` | `"2.0"` |
| `session_nonce` | No presente | Obligatorio |
| `prev_hash` | SHA-256 en hexadecimal de la entrada anterior, o `"GENESIS"` | `sha256:<hex>` de la entrada anterior, o `"GENESIS"` |
| `hash_alg` | No presente | Obligatorio: `sha256`, o `sha256+sha3-256` con una cadena de doble hash |
| `prev_hash_secondary` | No presente | Opcional: `sha3-256:<hex>` (cadena de doble hash) |
| `intent_hash` | SHA-256 en hexadecimal | `sha256:<hex>` |
| `intent_hash_secondary` | No presente | Opcional: `sha3-256:<hex>` |
| `evidence.evidence_hash` | No presente | Presente, puede ser `null` |
| `pq_checkpoint_ref` | No presente | Obligatorio, puede ser `null` |
| Firma | Ninguna por entrada; la firma del bundle las cubre | Ninguna por entrada; la raíz de Merkle de la auditoría del manifiesto se compromete con ellas, y los checkpoints PQ firman rangos de ellas |

---

<a id="5-sdk-api-changes"></a>

## 5. Cambios en la API de los SDK

<a id="51-typescript-sdk"></a>

### 5.1 SDK de TypeScript

| API v1.0 | API v2.0 | Notas |
|----------|----------|-------|
| `signBundle(bundle, secretKey)` | `signBundleV2(bundle, { registry, signerType, signerId, keys })` | Firma compuesta sobre el manifiesto |
| `verifySignedBundle(sb, publicKey)` | `verifySignedBundleV2(sb, registry, policy?)` | Verificación guiada por la política |
| `new BundleBuilder()…build()` | `new BundleBuilderV2(sessionNonce)…build()` | Nonce de sesión obligatorio; los artefactos son `SignedPayload` |
| `hashObject(obj)` | `hashObject(obj)` (sin cambios) | Sigue siendo SHA-256 + JCS |
| N/A | `dualHashCanonical(canonicalJson)` | SHA-256 + SHA3-256 |
| N/A | `registerDefaultProviders()` + `getDefaultRegistry()` | Ed25519, ML-DSA-65 y SLH-DSA-192f mediante el registro de algoritmos |
| N/A | `computeSecurityTier(intent, policyDecision?)` | Cálculo adaptativo del nivel (spec §14.2) |
| N/A | `deriveKid(alg, publicKeyBytes)` | kid determinista |
| N/A | `compositeSign(registry, context, payloadBytes, keys)` | Firma compuesta manual |
| N/A | `compositeVerify(registry, context, payloadBytes, sig, classicalPk, pqPk?)` | Verificación compuesta manual |

<a id="52-python-sdk"></a>

### 5.2 SDK de Python

| API v1.0 | API v2.0 | Notas |
|----------|----------|-------|
| `sign_bundle(bundle, secret_key)` | `prepare_payload` + `await composite_sign(registry, context, payload_bytes, classical_key, pq_key)` por artefacto, después `BundleBuilderV2(session_nonce)…build()` + `await sign_bundle_v2(bundle, registry, signer_type, signer_id, classical_key, pq_key)` (`dcp_ai.v2`) | Firmas compuestas sobre cada artefacto y sobre el manifiesto |
| `verify_signed_bundle(sb, public_key)` | `await verify_signed_bundle_v2(signed_bundle, registry, policy=None)` (`dcp_ai.v2`) | Guiada por la política |
| N/A | `Ed25519Provider` / `MlDsa65Provider` (`dcp_ai.providers`), `generate_keypair()` asíncrono | Claves híbridas |
| N/A | `compute_security_tier(intent, policy_decision=None)` (`dcp_ai.v2`) | Nivel adaptativo (spec §14.2) |
| N/A | `derive_kid(alg, public_key_bytes)` (`dcp_ai.v2`) | kid determinista |

<a id="53-go-sdk"></a>

### 5.3 SDK de Go

| API v1.0 | API v2.0 | Notas |
|----------|----------|-------|
| `SignObject(bundle, secretKeyB64)` | `v2.SignPayload(registry, context, payload, classicalKey, pqKey)` por artefacto, después `v2.BuildBundleV2(input)` + `v2.SignBundleV2(registry, bundle, classicalKey, pqKey)` | Firmas compuestas sobre cada artefacto y sobre el manifiesto |
| `VerifySignedBundle(sb, publicKeyB64)` | `v2.VerifySignedBundleV2(registry, signedBundleJSON)` | Guiada por la política |
| N/A | `GenerateKeypair()` en `providers.Ed25519Provider` / `providers.MlDsa65Provider` | Claves híbridas |
| N/A | `v2.ComputeSecurityTier(input)`, `v2.SecurityTierInputFromPayloads(intent, policyDecision)` | Nivel adaptativo (spec §14.2) |
| N/A | `v2.DeriveKid(alg, publicKey)` | kid determinista |

<a id="54-rust-sdk"></a>

### 5.4 SDK de Rust

| API v1.0 | API v2.0 | Notas |
|----------|----------|-------|
| `sign_object(bundle, secret_key_b64)` | `prepare_payload` (`dcp_ai::v2::signed_payload`) + `composite_sign(ed, pq, context, payload_bytes, classical_key, pq_key)` (`dcp_ai::v2::composite_ops`) por artefacto, después `build_bundle_v2(&rpr, &passport, &intent, &policy, &audit_entries, session_nonce)` + `sign_bundle_v2(bundle, &classical_key, &pq_key)` (`dcp_ai::v2::bundle`) | Firmas compuestas sobre cada artefacto y sobre el manifiesto |
| `verify_signed_bundle(sb, public_key_b64)` | `verify_signed_bundle_v2_with_policy(&signed_bundle, &policy)` (`dcp_ai::v2::verify_bundle`) | Guiada por la política |

<a id="55-cli-changes"></a>

### 5.5 Cambios en la CLI

| Comando v1.0 | Comando v2.0 | Notas |
|-------------|-------------|-------|
| `dcp keygen [out_dir]` | `dcp keygen --hybrid [out_dir]` | Genera ambos tipos de claves |
| `dcp sign-bundle` | `dcp sign-bundle --composite <bundle_v2.json> <ed25519_sk> <ml_dsa_65_sk> [out]` | Firma compuesta mediante `@dcp-ai/sdk` |
| `dcp verify-bundle` | `dcp verify-bundle [--policy <mode>] <signed.json> [public_key.txt]` | Verificación V2 completa; `<mode>` es `classical_only`, `hybrid_preferred`, `hybrid_required` o `pq_only`; la clave fija el firmante clásico |
| N/A | `dcp kid <public_key_file> --alg <algorithm>` | Calcula el kid |
| N/A | `dcp recovery-setup --threshold <M> --shares <N> [out]` | Recuperación social M de N |
| N/A | `dcp emergency-revoke --agent <id> --token <secret>` | Revocación de botón de pánico |
| N/A | `dcp rotate-key --old-kid <kid> --new-alg <alg>` | Rotación de claves con prueba de posesión |
| N/A | `dcp capabilities <endpoint_url>` | Consulta las capacidades de un endpoint |
| N/A | `dcp advisory check [url]` | Comprueba los avisos sobre algoritmos |

---

<a id="6-testing-your-migration"></a>

## 6. Probar la migración

<a id="61-verification-checklist"></a>

### 6.1 Lista de comprobación de la verificación

Recorre esta lista para confirmar que la migración está completa:

- [ ] **Generación de claves**: los pares de claves híbridos (Ed25519 + ML-DSA-65) se generan correctamente
- [ ] **Derivación del kid**: `deriveKid('ed25519', pk)` coincide con el valor esperado
- [ ] **Derivación del kid**: `deriveKid('ml-dsa-65', pk)` coincide con el valor esperado
- [ ] **Construcción del RPR**: el RPR v2.0 incluye `dcp_version`, `session_nonce` y ambos tipos de claves
- [ ] **Construcción del pasaporte**: el pasaporte v2.0 incluye `dcp_version` y `session_nonce`
- [ ] **Construcción de la intención**: la intención v2.0 incluye `dcp_version` y `session_nonce` (y, opcionalmente, un `security_tier` que solo puede elevar el nivel calculado)
- [ ] **Firma compuesta**: `signBundleV2` produce firmas compuestas válidas
- [ ] **Separación de dominio**: las firmas incluyen etiquetas de contexto
- [ ] **Vinculación compuesta**: la firma PQ cubre los bytes de la firma clásica
- [ ] **Cadena de doble hash**: las entradas de auditoría incluyen `prev_hash_secondary` (SHA3-256); los verificadores del código fuente aún no publicado comprueban cada enlace presente (paso 6); los paquetes publicados no
- [ ] **Manifiesto**: el manifiesto del bundle contiene todos los hashes de los artefactos y, con una cadena de doble hash, la raíz de Merkle secundaria, que los verificadores del código fuente aún no publicado comprueban cuando está presente
- [ ] **Nonce de sesión**: todos los artefactos de un bundle comparten el mismo nonce
- [ ] **Verificación V2**: `verifySignedBundleV2` (o `dcp verify-bundle`) pasa con bundles v2.0 firmados correctamente
- [ ] **Compatibilidad V1**: los bundles v1.0 siguen verificándose con la función V1 `verifySignedBundle` (que solo acepta v1.0), con `dcp verify-bundle` o con un enrutador por versión como el de 3.2; la función V2 `verifySignedBundleV2` solo acepta v2.0
- [ ] **Detección de manipulaciones**: modificar cualquier campo de un artefacto hace fallar la verificación
- [ ] **Detección de eliminación**: quitar la firma PQ (con la vinculación reetiquetada como `classical_only`) falla con `hybrid_required` y `pq_only` y se acepta con `classical_only` y `hybrid_preferred`; una firma PQ presente pero inválida falla en todos los modos
- [ ] **NIST KAT**: todas las operaciones criptográficas superan la validación KAT
- [ ] **Entre SDK**: los bundles firmados por un SDK se verifican en otro

<a id="62-common-migration-issues"></a>

### 6.2 Problemas habituales de migración

**Problema: «kid mismatch» durante la verificación**

La derivación del kid en v2.0 es determinista: `hex(SHA-256(UTF8(alg) || 0x00 || raw_pk))[0:32]`. Si tu implementación v1.0 usaba otro esquema de kid, regenera los kid con la fórmula de v2.0. La función `deriveKid` del SDK se encarga de ello.

**Problema: «session_nonce mismatch» entre artefactos**

Todos los artefactos de un mismo bundle DEBEN compartir el mismo `session_nonce`. Genera el nonce una vez por cada bundle creado y pásalo a todos los constructores de artefactos.

**Problema: «composite_sig.pq verification failed»**

La firma PQ firma `context || 0x00 || payload || classical_sig`. Asegúrate de que los bytes de la firma clásica (en bruto, no en base64) se añadan al mensaje firmado antes de la firma PQ.

**Problema: «unsupported dcp_version 2.0» de un verificador v1.0**

Es lo esperado. Los verificadores v1.0 no pueden procesar bundles v2.0. El verificador de origen tiene que actualizarse a un SDK compatible con v2.0.

**Problema: valores float en payloads firmados**

v2.0 prohíbe los números de coma flotante en todos los payloads firmados (ambigüedad de canonicalización). Sustituye `risk_score: 0.75` por una escala entera: `risk_score: 750` (0-1000).

**Problema: bundles de gran tamaño**

Los bundles v2.0 son más grandes, sobre todo por las firmas ML-DSA-65 (3309 B cada una). Mide tus bundles más
grandes en el formato que tu verificador lee realmente y da al cuerpo de la petición un presupuesto de tamaño explícito
(véase [OPERATOR_GUIDE.md](OPERATOR_GUIDE.md#security-tiers-in-verification)). El servidor de verificación de referencia solo lee cuerpos JSON, aunque su
documento de capacidades enumere `application/cbor`, y solo el SDK de TypeScript tiene un codificador CBOR
(`cborEncode`); este repositorio no publica ninguna reducción de tamaño medida para él. `presentCompact` quita la firma
PQ (vinculación `classical_only`), así que ese bundle solo pasa donde el modo efectivo es `classical_only` o
`hybrid_preferred`. El tamaño en el transporte no es motivo para bajar un nivel de seguridad.

<a id="63-validating-migrated-bundles"></a>

### 6.3 Validar los bundles migrados

La CLI no tiene un comprobador de migración de v1.0 a v2.0. En su lugar, verifica cada bundle migrado con el verificador V2:

```bash
dcp verify-bundle --policy hybrid_required signed_bundle_v2.json
```

Comprueba los hashes del manifiesto, la vinculación de sesión, las firmas compuestas y la cadena de auditoría. `risk_score` pertenece a la decisión de política, como entero de 0 a 1000; el esquema de intención V2 no lo admite (spec §14.2).

---

<a id="7-recommended-migration-order"></a>

## 7. Orden de migración recomendado

Para equipos que migran un sistema en producción, el orden recomendado es:

1. **Actualizar el SDK** a la última versión compatible con v2.0.
2. **Actualizar primero los verificadores** con `allow_v1_bundles: true`. Así tus verificadores pueden manejar bundles v1.0 y v2.0 durante la transición.
3. **Generar pares de claves híbridos** para todos los agentes y las personas.
4. **Actualizar la construcción de los artefactos** para incluir `dcp_version: "2.0"`, `session_nonce` y entradas de claves dobles.
5. **Pasar a firmas compuestas** con las API de firma de v2.0.
6. **Añadir cadenas de doble hash** a las entradas de auditoría.
7. **Implementar la estructura del manifiesto del bundle**.
8. **Firmar las intenciones sensibles con firmas híbridas.** Los verificadores V2 aplican el nivel de seguridad (spec §14.3): un bundle `classical_only` se rechaza para un pago, datos sensibles, un impacto alto o un `risk_score` de la decisión de política de 500 o más.
9. **Ejecutar las pruebas de conformidad completas**, incluida la validación con NIST KAT.
10. **Desactivar la aceptación de bundles v1.0** cuando todos los agentes de tu ecosistema hayan migrado.

---

<a id="8-timeline-and-support"></a>

## 8. Calendario y soporte

| Fase | Calendario | Acciones |
|-------|----------|---------|
| **Preparación** | Semanas 1-2 | Actualizar el SDK, generar claves híbridas, revisar esta guía |
| **Actualización de verificadores** | Semanas 2-3 | Desplegar verificadores v2.0 compatibles con v1 |
| **Migración de agentes** | Semanas 3-6 | Actualizar la construcción de los artefactos, pasar a firmas compuestas |
| **Validación** | Semanas 6-8 | Ejecutar pruebas de conformidad y de interoperabilidad entre SDK |
| **Corte** | Semana 8 en adelante | Fijar `allow_v1_bundles: false` cuando estés listo |

Para obtener soporte con la migración:
- Issues o Discussions de GitHub: [`dcp-ai-protocol/dcp-ai`](https://github.com/dcp-ai-protocol/dcp-ai)
- Informes privados de vulnerabilidades mediante la interfaz de avisos de seguridad de GitHub
- Correo a los mantenedores según [GOVERNANCE.md](../GOVERNANCE.md)

Por ahora no hay un Slack, un Discord ni sesiones de consulta dedicados. Véase [EARLY_ADOPTERS.md](EARLY_ADOPTERS.md) para el modelo de soporte actual.

---

<a id="references"></a>

## Referencias

- [Especificación normativa DCP-AI v2.0](../spec/DCP-AI-v2.0.md)
- [DCP-04: comunicación entre agentes](../spec/DCP-04.md)
- [Modelo de seguridad](SECURITY_MODEL.md)
- [Declaración de conformidad con el NIST](NIST_CONFORMITY.md)
- [Vectores de prueba NIST KAT](../tests/nist-kat/README.md)
- [Arquitectura técnica](TECHNICAL_ARCHITECTURE.md)
