<sub>[English](AGENT_CREATION_AND_CERTIFICATION.md) · [中文](AGENT_CREATION_AND_CERTIFICATION.zh-CN.md) · **Español** · [日本語](AGENT_CREATION_AND_CERTIFICATION.ja.md) · [Português](AGENT_CREATION_AND_CERTIFICATION.pt-BR.md)</sub>

<a id="agent-creation-and-certification--p2p-no-central-service"></a>
<a id="agent-creation-and-certification-p2p-no-central-service"></a>

# Creación y certificación de agentes — P2P, sin servicio central

> Traducción informativa de [la versión en inglés](AGENT_CREATION_AND_CERTIFICATION.md), actualizada el 26/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Un sistema que crea agentes puede producir por defecto agentes **certificados DCP**: vinculados a una persona, con pasaporte emitido y bundle firmado. **Sin registro en ningún servicio central.** La verificación es local. Opcional: anclar bundle_hash en un registro o cadena pública (usando una blockchain existente o un servicio de terceros).

En esta página, «certificado DCP» significa que un bundle supera las comprobaciones locales definidas abajo. No es un certificado emitido por una autoridad, no confirma quién es realmente el principal y no decide si un verificador debe aceptar al agente: eso es la admisión, un paso aparte ([ADMISSION.md](ADMISSION.md)).

> **Herramientas de esta página.** `dcp` es la CLI de referencia de una copia del repositorio, `node /path/to/dcp-ai/bin/dcp.js`; solo lee y escribe dentro del directorio actual. El asistente interactivo `@dcp-ai/cli init` es una demo que no crea una identidad V2 válida: véase [Asistente de la CLI (solo demo)](#cli-wizard-demo-only).

<a id="certification-flow-p2p-no-registry"></a>

## Flujo de certificación (P2P, sin registro)

```
Human → Onboard (identity / pseudonymous, jurisdiction)
     → System: keygen human, build RPR, sign RPR

Human → Create agent (capabilities, risk_tier)
     → System: keygen agent, build AP, build bundle, sign bundle
     → Optional: publish bundle_hash only to existing chain/log (user or third party)
     → System: issue signed bundle + keys (+ optional anchor_receipt)

Agent → On each action: build Intent, PolicyDecision, AuditEntry (intent_hash, prev_hash chain)
      → append to audit trail; present signed bundle to verifier
      → Optional: anchor new bundle_hash for audit trail (user or third party)
```

- **La verificación es local; no hace falta ningún servidor central.** El anclaje opcional lo hacen los usuarios o servicios de anclaje de terceros sobre cadenas o registros existentes.

<a id="definition-of-dcp-certified"></a>

## Definición de «certificado DCP»

- **Certificado (local):** Citizenship Bundle válido (conforme al esquema), Signed Bundle (firma válida), RPR y AP con firmas válidas, AP.status = active, RPR no caducado. El verificador puede verificar sin conexión. **Sin servidor.**
- **Certificado + anclado (opcional):** lo anterior + bundle_hash (o merkle_root) anclado en un registro o cadena pública; el verificador puede comprobar opcionalmente que el hash se ancló en un momento dado. Sigue sin haber una API central que conozca agent_id/human_id. El anclaje usa una blockchain **existente** o un registro **de terceros**.

Qué herramienta comprueba qué:

- **V1:** `dcp verify-bundle` y `verifySignedBundle` comprueban los esquemas, la firma del bundle, `bundle_hash`, `merkle_root` y la cadena de auditoría. Las firmas del RPR y del pasaporte, el `status` del pasaporte y el `expires_at` del RPR quedan a cargo de quien llama; los inicios rápidos muestran las comprobaciones de firma.
- **V2:** `verifySignedBundleV2` comprueba además la firma compuesta de cada artefacto, el estado del pasaporte (acepta `active` y `declining`) y la caducidad del RPR. Véase [spec/VERIFICATION.md](../spec/VERIFICATION.md).

<a id="integration-points-no-registry"></a>

## Puntos de integración (sin registro)

<a id="on-human-onboarding"></a>

### Al incorporar a la persona

- Generar o aceptar el par de claves de la persona (p. ej., `dcp keygen keys/human`).
- Construir el RPR (human_id puede ser seudónimo: hash, UUID o DID).
- Firmar el RPR con la clave secreta de la persona, sobre el RPR sin su campo `signature` (p. ej., `signObject(rprBody, humanSecretKeyB64)`).
- Guardarlo localmente; no enviarlo por POST a ningún servidor central.

<a id="on-agent-creation"></a>

### Al crear el agente

- Generar el par de claves del agente (p. ej., `dcp keygen keys/agent` o un segundo par de claves).
- Construir el AP: principal_binding_reference = RPR.human_id, public_key = clave pública del agente (Ed25519 en base64). Firmar el AP con la clave secreta del agente, sobre el AP sin su campo `signature`.
- Construir un bundle mínimo: RPR + AP + intent + policy_decision + audit_entries (al menos una; usar intent_hash reales y la cadena prev_hash según [spec/DCP-03.md](../spec/DCP-03.md)).
- Firmar el bundle con la clave secreta de la **persona** (p. ej., `dcp sign-bundle bundle.json keys/human/secret_key.txt out.signed.json`).
- Opcionalmente, anclar bundle_hash en un registro o cadena pública (OP_RETURN de Bitcoin, evento de Ethereum o registro de transparencia de terceros). Si se usa, guardar anchor_receipt junto al bundle.
- Devolver al usuario: el bundle firmado, la clave secreta del agente y, opcionalmente, anchor_receipt.

<a id="at-runtime-agent-execution"></a>

### En tiempo de ejecución (ejecución del agente)

- Antes de cada acción: construir Intent → PolicyDecision → AuditEntry (intent_hash real = SHA-256(canonical(intent)), cadena prev_hash: GENESIS y luego SHA-256(canonical(entrada anterior))).
- Añadir al rastro de auditoría; opcionalmente, volver a firmar el bundle o producir un nuevo bundle firmado para el rastro de auditoría actualizado.
- Presentar el bundle firmado al verificador (p. ej., en la cabecera o el cuerpo de una solicitud de API). El verificador ejecuta la verificación local (véase [spec/VERIFICATION.md](../spec/VERIFICATION.md)); opcionalmente comprueba el conjunto de revocaciones (lista P2P o anclada por hash) y el anclaje opcional.

<a id="reference-implementation"></a>

## Implementación de referencia

- **Script:** [scripts/generate-production-examples.js](../scripts/generate-production-examples.js) — genera un RPR, un AP, una intención, una política, dos entradas de auditoría (con intent_hash reales y cadena prev_hash) y un bundle firmado reales, sin servidor y sin registro. Regenera los propios ejemplos V1 del repositorio (`npm run examples:generate`) y lee la clave de la persona de `keys/secret_key.txt`, que no está en el repositorio (solo está `keys/public_key.txt`), así que en una copia recién clonada se detiene ahí. Léelo como referencia del orden de los pasos. La clave del agente procede de `keys/agent_secret_key.txt` / `keys/agent_public_key.txt`, que se generan si faltan.
- **CLI:** `dcp keygen`, `dcp sign-bundle`, `dcp verify-bundle`, `dcp intent-hash`, `dcp bundle-hash`, `dcp merkle-root`. El paso opcional de anclaje no está en la CLI génesis; los usuarios o herramientas de terceros publican los hashes en cadenas existentes.

<a id="checklist-for-agent-creation-systems"></a>

## Lista de comprobación para sistemas de creación de agentes

1. Generar claves de la persona y del agente (o aceptar claves).
2. Construir y firmar el RPR (clave de la persona).
3. Construir y firmar el AP (clave del agente; public_key = clave pública del agente).
4. Construir intent, policy_decision y audit_entries (intent_hash reales, cadena prev_hash).
5. Construir el Citizenship Bundle; firmarlo con la clave de la persona → Signed Bundle.
6. Opcionalmente, anclar bundle_hash (cadena existente o registro de terceros); guardar anchor_receipt.
7. Entregar el bundle firmado y la clave secreta del agente al agente o a su entorno de ejecución.
8. En tiempo de ejecución: construir intent → policy → entrada de auditoría; añadirla; presentar el bundle firmado a los verificadores. Los verificadores verifican localmente; sin llamadas a un servidor central.

---

<a id="v20-agent-creation"></a>

## Creación de agentes en V2.0

DCP v2.0 introduce criptografía híbrida poscuántica y niveles de seguridad adaptativos.

<a id="recommended-path-the-sdks"></a>

### Ruta recomendada: los SDK

Crea identidades y bundles V2 con un SDK, como en los inicios rápidos probados:

- TypeScript: [Quick Start (V2)](../sdks/typescript/README.md#quick-start-v2) del SDK de TypeScript, y [QUICKSTART.md](QUICKSTART.md)
- Python: [V2 Bundles](../sdks/python/README.md#v2-bundles) en el README del SDK de Python

Siguen `main`: compila el SDK desde una copia del repositorio como explica la sección *Release status* de cada README.

Para generar claves híbridas reales desde una copia del repositorio, `dcp keygen --hybrid <out_dir>` escribe un par de claves Ed25519 y uno ML-DSA-65 (ML-DSA-65 de `@noble/post-quantum`) con sus kids, y escribe los archivos de claves secretas con modo `0600`.

<a id="cli-wizard-demo-only"></a>

### Asistente de la CLI (solo demo)

`npx @dcp-ai/cli init` (el `@dcp-ai/cli` publicado era la 2.1.0 el 26/10/2026, y sus archivos de `init` eran idénticos a los de este repositorio) hace unas cuantas preguntas y escribe:

- `.dcp/config.json` — Configuración del agente
- `.dcp/keys/` — un par de claves Ed25519, más un par de claves «ML-DSA-65» si eliges claves híbridas
- `.dcp/identity.json` — un registro con forma de RPR
- `.dcp/passport.json` — un registro con forma de pasaporte

Úsalo para explorar, no para crear la identidad de un agente:

- **Las claves «ML-DSA-65» están simuladas.** Son bytes aleatorios de la longitud correcta, no claves ML-DSA; el asistente lo dice cuando se ejecuta. No firmes con ellas ni las publiques como claves poscuánticas.
- **`identity.json` y `passport.json` no son artefactos V2.** No están firmados y no cumplen los esquemas V2: el RPR tiene `entity_name` y `keys` donde el esquema exige `legal_name`, `binding_keys`, `liability_mode`, `override_rights`, `issued_at` y `expires_at`; el pasaporte tiene `owner_rpr_hash` donde el esquema exige `principal_binding_reference` y `risk_tier`. Un bundle construido con ellos no supera la validación.
- **Sus tokens de revocación no se pueden usar.** El `revocation_token` del RPR es el hash de un secreto que no se conserva, y el `emergency_revocation_token` del pasaporte es aleatorio, no el hash de ningún secreto que tengas.
- **Los archivos de claves secretas reciben los permisos por defecto** (`0644` con la umask habitual `022`). Ejecuta `chmod 600 .dcp/keys/*_secret.key` y mantén `.dcp/keys/` fuera del control de versiones.
- **`dcp-ai sign` no es una firma de bundle DCP.** Firma el `JSON.stringify` del archivo, no su forma canónica `dcp-jcs-v1`, y la añade a un array `signatures`.

<a id="v2-certification-flow"></a>

### Flujo de certificación V2

```
Human → Onboard (identity, jurisdiction)
     → System: generate hybrid keypair (Ed25519 + ML-DSA-65)
     → System: build RPR with binding_keys[] (KeyEntry array), sign with composite signature
     → Optional: recovery configuration (Shamir SSS, spec §11.2)

Human → Create agent (capabilities, risk_tier)
     → System: generate agent hybrid keypair
     → System: build AgentPassport with keys[], principal_binding_reference (the RPR's human_id),
               capabilities and risk_tier; optional emergency_revocation_token (spec §11.3)
     → System: build bundle with session_nonce and manifest
     → System: composite-sign bundle (Ed25519 + ML-DSA-65, pq_over_classical binding)
     → Optional: anchor bundle_hash

Agent → On each action:
      → Build IntentV2 (with action_type, data_classes, estimated_impact; optional security_tier)
      → Evaluate PolicyDecisionV2 (with risk_score; optional resolved_tier)
      → Compute the security tier (routine/standard/elevated/maximum) of the action
      → Build AuditEventV2 (SHA-256 prev_hash chain; optional SHA3-256 secondary chain)
      → Generate PQ checkpoint every N events (tier-dependent)
      → Present signed bundle to verifier

Agent → Lifecycle management (DCP-05):
      → Initial state: commissioned → active (via lifecycle transition)
      → Submit periodic VitalityReport (health metrics, performance)
      → On decline: active → declining (time to prepare succession, DCP-06); declining → active on recovery
      → On end-of-life: → decommissioned (DecommissioningRecord with data_disposition)
```

<a id="v2-key-structure"></a>

### Estructura de claves V2

Los agentes V2 usan pares de claves híbridos con identificadores de clave deterministas:

```json
{
  "keys": [
    {
      "kid": "a1b2c3d4e5f6...",
      "alg": "ed25519",
      "public_key_b64": "...",
      "created_at": "2026-02-28T00:00:00Z",
      "expires_at": null,
      "status": "active"
    },
    {
      "kid": "f6e5d4c3b2a1...",
      "alg": "ml-dsa-65",
      "public_key_b64": "...",
      "created_at": "2026-02-28T00:00:00Z",
      "expires_at": null,
      "status": "active"
    }
  ]
}
```

Derivación del ID de clave: `kid = hex(SHA-256(UTF8(alg) || 0x00 || raw_public_key))[0:32]`

<a id="v2-security-tier-selection"></a>

### Selección del nivel de seguridad V2

El nivel de seguridad se calcula automáticamente a partir del `risk_score` de la decisión de política y de los `data_classes`, `action_type` y `estimated_impact` de la intención (spec §14.2):

| Condición | Nivel |
|-----------|------|
| risk_score >= 800 O data_classes incluye credentials/children_data | Maximum |
| risk_score >= 500 O data_classes incluye pii/financial_data/health_data O initiate_payment O estimated_impact high O un valor desconocido o ausente | Elevated |
| risk_score >= 200 O estimated_impact medium | Standard |
| Por defecto | Routine |

Un `security_tier` explícito en la intención solo puede elevar el nivel.

El nivel determina: el modo de verificación, la frecuencia de los checkpoints PQ y el modo de presentación del bundle sugerido.

<a id="v2-checklist-for-agent-creation-systems"></a>

### Lista de comprobación V2 para sistemas de creación de agentes

1. Generar un par de claves híbrido: Ed25519 + ML-DSA-65 (proveedores de los SDK, o `dcp keygen --hybrid` desde una copia del repositorio; no `@dcp-ai/cli init`, cuyas claves ML-DSA están simuladas)
2. Construir el RPR con el array `binding_keys[]` (formato KeyEntry) y firmarlo con firma compuesta
3. Opcionalmente, poner un `emergency_revocation_token` en el pasaporte (spec §11.3): `generateEmergencyRevocationToken()` devuelve el token y su secreto, que guardas sin conexión; opcionalmente, configurar la recuperación Shamir SSS (`RecoveryConfig`, spec §11.2)
4. Construir el AgentPassport con `keys[]`, `principal_binding_reference`, `capabilities` y `risk_tier`
5. Construir el IntentV2 con `action_type`, `data_classes` y `estimated_impact`, y calcular `security_tier`
6. Construir el PolicyDecisionV2 con `risk_score` (entero de 0 a 1000) y, opcionalmente, `resolved_tier`
7. Construir las entradas AuditEventV2 con la cadena `prev_hash` (SHA-256; cadena secundaria SHA3-256 opcional)
8. Generar checkpoints PQ según el intervalo del nivel
9. Construir el CitizenshipBundleV2 con `session_nonce` y el manifiesto (todos los hashes de los artefactos)
10. Firmar el bundle con firma compuesta: Ed25519 + ML-DSA-65 con vinculación `pq_over_classical`
11. Opcionalmente, anclar bundle_hash
12. Inicializar el estado del ciclo de vida: crear un `CommissioningCertificate` con `commissioning_authority`, `purpose` e `initial_capabilities` (DCP-05)
13. Configurar la sucesión: opcionalmente, crear un `DigitalTestament` con `successor_preferences` y `memory_classification` (DCP-06)
14. Declarar derechos: crear una `RightsDeclaration` con los elementos `RightEntry` aplicables y un `ObligationRecord` (DCP-08)
15. Configurar la delegación: si el agente actúa como delegado, crear un `DelegationMandate` con `authority_scope` (DCP-09)
16. Configurar los umbrales de atención: establecer un `AwarenessThreshold` con `threshold_rules` para los desencadenantes de intervención humana (DCP-09)

Véase [QUICKSTART.md](QUICKSTART.md) para ejemplos de código y [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md) para actualizar desde V1.

<a id="reference"></a>

## Referencias

- Almacenamiento y anclaje: [STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md)
- Lista de comprobación de la verificación: [spec/VERIFICATION.md](../spec/VERIFICATION.md)
