<sub>[English](README.md) · [中文](README.zh-CN.md) · **Español** · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="dcp-reference-gateway"></a>

# Pasarela de referencia de DCP

> Traducción informativa de [la versión en inglés](README.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Servicio HTTP de verificación que implementa V1, V2 y la fase 3 (PQ primero) del Digital Citizenship Protocol. **Almacenamiento en memoria**: no necesita ninguna base de datos externa, y nada sobrevive a un reinicio (véase [Persistencia](#persistence)). Pensado para que lo ejecute cualquier tercero; el protocolo no exige un servidor central.

<a id="quick-start"></a>

## Inicio rápido

Desde la raíz de un checkout. El paquete raíz depende del SDK del workspace hasta que `@dcp-ai/sdk` 2.2.0 esté en npm, así que compílalo primero:

```bash
(cd sdks/typescript && npm install && npm run build)
npm install
node server/index.js
# or: npm run server
```

Puerto por defecto: `3000`. Se cambia con `PORT=4000 node server/index.js`. Define `OPERATOR_TOKEN` para usar los endpoints de administración y registrar agentes nuevos.

## Endpoints

<a id="core"></a>

### Núcleo

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/` , `/health` | Comprobación de salud: `{ ok, service, supported_versions, registered_agents, registered_keys }` |
| GET | `/.well-known/dcp-capabilities.json` | Descubrimiento de las capacidades del protocolo (algoritmos, funciones, formatos de transmisión). Es lo que el servidor anuncia, no garantías comprobadas: enumera `hsm_provider: true` y `application/cbor`, pero no hay ningún HSM y los cuerpos solo se leen como JSON |
| POST | `/verify` | Verifica un bundle firmado (detecta V1 o V2; V2 se comprueba contra `VERIFIER_POLICY`) |
| POST | `/v2/admit` | Admisión frente a los principales de confianza del operador, y strict-v1 cuando está configurado (`docs/ADMISSION.md`). Del cuerpo solo lee `signed_bundle`. 501 si no está configurada |
| POST | `/anchor` | Esbozo: devuelve 501 (cada operador lo implementa) |

<a id="v2-identity--intent"></a>
<a id="v2-identity-intent"></a>

### V2: identidad e intención

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/v2/passport/register` | Registra un pasaporte de agente autofirmado; un `agent_id` nuevo necesita el token del operador (véase [Modelo de confianza](#trust-model)) |
| POST | `/v2/intent/declare` | Declara una intención de un agente registrado y recibe la decisión de política del servidor (sin firmar); la `composite_sig` de la intención no se verifica |
| POST | `/v2/audit/append` | Añade un evento de auditoría a la cadena del agente |
| POST | `/v2/audit/compact` | Compacta la cadena de auditoría con un resumen de Merkle |
| POST | `/v2/bundle/verify` | Verificación completa de un bundle V2: esquema, manifiesto, firma compuesta Ed25519 + ML-DSA-65, vinculación de sesión y cadena de auditoría (mediante `lib/verify.js` y `@dcp-ai/sdk`), contra `VERIFIER_POLICY`. Los bundles V1 reciben 400 |

<a id="v2-key-management"></a>

### V2: gestión de claves

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/v2/keys/:kid` | Busca una clave por su ID determinista |
| POST | `/v2/keys/rotate` | Rotación de claves: prueba de posesión por la clave nueva, autorización por la antigua |
| POST | `/v2/emergency-revoke` | Revocación de emergencia (botón de pánico) |

<a id="v2-multi-party--governance"></a>
<a id="v2-multi-party-governance"></a>

### V2: multiparte y gobernanza

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/v2/multi-party/authorize` | Autorización multiparte M de N, con las firmas comprobadas contra las claves registradas de las partes |
| POST | `/v2/governance/register` | Registra el conjunto de claves de gobernanza (**operador**) |
| GET | `/.well-known/governance-keys.json` | Claves de gobernanza publicadas |

<a id="phase-3-policy--advisories"></a>
<a id="phase-3-policy-advisories"></a>

### Fase 3: política y avisos

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/v2/policy` | Política actual del verificador (modo, algoritmos, restricciones) |
| POST | `/v2/policy/mode` | Cambia el modo del verificador (`classical_only`, `hybrid_preferred`, `hybrid_required`, `pq_only`) (**operador**) |
| GET | `/.well-known/algorithm-advisories.json` | Avisos de algoritmos publicados |
| POST | `/v2/advisory/publish` | Publica un aviso de algoritmo, validado contra su esquema; como máximo 1000 (**operador**) |
| GET | `/v2/advisory/check` | Comprueba si determinados algoritmos están afectados |
| POST | `/v2/advisory/auto-apply` | Aplica automáticamente los avisos a la política del verificador (**operador**) |

Los endpoints de **operador** cambian la configuración de confianza del verificador. Requieren
`Authorization: Bearer <OPERATOR_TOKEN>` y, si no, responden 401; sin un `OPERATOR_TOKEN` configurado permanecen
bloqueados.

<a id="dcp-05-to-dcp-09"></a>

### De DCP-05 a DCP-09

31 endpoints para registros de ciclo de vida, sucesión, disputas, derechos y delegación; se enumeran en [docs/OPERATOR_GUIDE.md](../docs/OPERATOR_GUIDE.md#dcp-0509-service-endpoints). Validan cada registro contra su esquema, pero **no verifican ninguna firma ni necesitan token**, y `OPERATOR_TOKEN` no los protege: cualquiera que pueda llegar al servidor puede retirar o volver a poner en servicio un agente, revocar un mandato revocable o marcar una disputa como resuelta. No los expongas a clientes que no sean de confianza.

<a id="environment-variables"></a>

## Variables de entorno

| Variable | Valor por defecto | Descripción |
|----------|---------|-------------|
| `PORT` | `3000` | Puerto HTTP de escucha |
| `OPERATOR_TOKEN` | — | Token Bearer para los endpoints de operador y para registrar `agent_id` nuevos. Sin definir: ambos quedan bloqueados |
| `VERIFIER_MODE` | `hybrid_required` | Modo de verificación al arrancar: `classical_only`, `hybrid_preferred`, `hybrid_required` o `pq_only`. Un valor no válido detiene el servidor |
| `ALLOW_V1_BUNDLES` | `true` | `false` hace que `POST /verify` rechace los bundles V1 (`pq_only` siempre lo hace) |
| `TRUST_PROXY` | — | `true` solo detrás de un proxy que añade la IP del cliente a `X-Forwarded-For` (Fly, nginx). Los límites de tasa se basan entonces en su último salto; si no, en la dirección del socket, porque los clientes pueden falsificar la cabecera |
| `REGISTRATIONS_PER_HOUR` | `20` | Llamadas a `POST /v2/passport/register` por cliente y hora; las demás reciben 429 |
| `MAX_REGISTERED_KEYS` | `10000` | Claves del registro; a partir de ahí, los agentes nuevos y las rotaciones reciben 507 (no se desaloja nada) |
| `DCP_TRUSTED_PRINCIPALS_FILE` | — | Conjunto de confianza para `POST /v2/admit` (`schemas/v2/principal_trust_set.schema.json`), leído en cada admisión y recargado cuando cambia su contenido. Un archivo no válido detiene el servidor al arrancar y rechaza la admisión (503) si se estropea después. Cualquier variable de admisión definida con un valor vacío detiene el servidor |
| `DCP_ADMISSION_PROFILE_FILE` | — | Perfil strict-v1 (`schemas/v2/admission_profile.schema.json`). Necesita las dos variables que lo rodean; una contradicción detiene el servidor |
| `DCP_REVOCATION_LIST_URL` | — | Lista de denegación completa en el formato `/.well-known/dcp-revocations.json` del servicio de revocación, para strict-v1: `https` (`http` simple solo hacia un host de loopback), sin redirecciones, 16 MiB como máximo. `DCP_REVOCATION_LIST_AUTHORIZATION` define una cabecera `Authorization`; `DCP_REVOCATION_TIMEOUT_MS` (por defecto 5000) limita la petición |
| `MAX_KEYS_PER_AGENT` | `64` | Claves que un agente puede registrar a lo largo de su vida; las rotaciones siguientes reciben 409. Súbelo para agentes que rotan a menudo (cada clave retirada cuesta una lápida de unos 100 bytes) |

`REQUIRE_SESSION_BINDING`, `REQUIRE_COMPOSITE_BINDING`, `MAX_KEY_AGE_DAYS`,
`PQ_CHECKPOINT_INTERVAL` y `ADVISORY_POLL_INTERVAL_MS` aparecen en las configuraciones de Docker y Fly, pero todavía no
se leen: se aplica la política integrada (`VERIFIER_POLICY` en `server/index.js`: vinculación de sesión y vinculación
compuesta obligatorias, antigüedad de clave de 365 días), y `GET /v2/policy` la muestra.

<a id="trust-model"></a>

## Modelo de confianza

- El **registro de pasaportes** verifica la autofirma compuesta del pasaporte (`DCP-AI.v2.AgentPassport`, Ed25519 +
  ML-DSA-65; la solo clásica se acepta únicamente en los modos `classical_only` / `hybrid_preferred`) contra las claves
  que enumera. Esa firma prueba la posesión de las claves que la hicieron (la clave clásica y, si la hay, la PQ), y solo esas se registran: incluir la clave
  pública de otra persona no registra nada. Las claves y las firmas deben ser base64 canónico del tamaño exacto de su
  algoritmo.
- Registrar un `agent_id` **nuevo** requiere `Authorization: Bearer <OPERATOR_TOKEN>` (si no, 401). Un pasaporte solo
  está autofirmado, y el RPR de un principal también, así que, sin un ancla de confianza, cualquiera podría reclamar
  primero el `agent_id` de una víctima y revocarlo por emergencia: el operador responde por los agentes nuevos.
  Volver a registrarlo (por ejemplo, para sustituir el token de revocación de emergencia) requiere un pasaporte cuyo
  `created_at` sea posterior al registrado, porque los pasaportes firmados son públicos y uno antiguo podría
  reenviarse, y que esté firmado exactamente por las claves activas del agente (registradas a su nombre, no revocadas,
  no caducadas), con independencia de lo que `VERIFIER_MODE` permita para agentes nuevos; si no, 409. Las entradas de
  claves registradas se conservan, así que un pasaporte nuevo no puede ampliar el `expires_at` de una clave, y un
  pasaporte sin token conserva el registrado.
- Un agente que ha perdido todas las claves activas de una familia que registró (por ejemplo, porque caducó su clave
  ML-DSA-65) no puede volver a registrarse: la clave que le queda no debe sustituir por sí sola el token. La
  recuperación pasa por el token de revocación de emergencia (revocar y después registrar un `agent_id` nuevo) o por el
  operador, que todavía no tiene ninguna API para ello. Un kid registrado a nombre de otro agente también da 409, y un
  agente revocado por emergencia no puede volver a registrarse.
- La **rotación de claves** recibe un `KeyRotationRecord` tal como lo construye `createKeyRotation` en `@dcp-ai/sdk`: la
  clave nueva firma `{old_kid, new_kid, timestamp}` con `DCP-AI.v2.KeyRotation` (prueba de posesión) y la antigua la
  refrenda. La clave antigua debe estar activa (no revocada, no caducada); después se marca como revocada.
- **Autorización multiparte**: cada parte firma `{operation, operation_payload, party_id, role}` con
  `DCP-AI.v2.MultiPartyAuth` (`createPartyAuthorization` en `sdks/typescript/src/core/multi-party-auth.ts`, que
  `@dcp-ai/sdk` 2.1.1 no exporta). Una parte es una identidad registrada mediante `/v2/passport/register`, y sus kids de
  firma deben ser claves activas (no revocadas, no caducadas) registradas a nombre de su `party_id`. Cada parte cuenta
  una sola vez para `required_parties`, firme por los roles que firme. Los roles los afirma quien firma; no se buscan en
  ningún sitio.
- Los **endpoints de operador** solo están protegidos por `OPERATOR_TOKEN`. La `composite_sig` de los avisos se
  comprueba solo estructuralmente: `@dcp-ai/sdk` todavía no tiene etiqueta de contexto para `AlgorithmAdvisory`, así que
  el operador responde por los avisos.
- El registro de claves rechaza agentes nuevos y rotaciones (507) cuando llega a `MAX_REGISTERED_KEYS` claves (10 000),
  en lugar de desalojar las antiguas, porque un `agent_id` desalojado perdería el historial que lo protege (volver a registrarlo sigue necesitando el token del operador, pero con cualquier clave). Para que un
  solo agente no lo llene, la rotación conserva solo las 4 claves retiradas más recientes del agente y descarta la más
  antigua antes de comprobar el límite, de modo que una rotación sigue cabiendo en un registro lleno. Las claves
  descartadas quedan como lápidas: `GET /v2/keys/:kid` responde `revoked: true, retired: true` con `key: null`, y nadie
  puede volver a registrar esa clave nunca. Un agente puede registrar como máximo `MAX_KEYS_PER_AGENT` claves (64) a lo
  largo de su vida, así que sus lápidas siguen acotadas; a partir de ahí, la rotación recibe 409. Los registros están
  limitados por cliente (`REGISTRATIONS_PER_HOUR`), y de un pasaporte registrado solo se conserva `created_at`, no el
  pasaporte firmado completo.

<a id="usage-examples"></a>

## Ejemplos de uso

Salvo la comprobación de salud, el cambio de modo y el descubrimiento de capacidades, las peticiones de abajo son
plantillas: sus bundles, firmas y claves son marcadores (`...`, `<64 hex>`), así que no funcionan tal cual, y no deben
rellenarse con valores inventados.

<a id="health-check"></a>

### Comprobación de salud

```bash
curl -s http://localhost:3000/health | jq .
```

<a id="v1-bundle-verification"></a>

### Verificación de un bundle V1

```bash
curl -s -X POST http://localhost:3000/verify \
  -H "Content-Type: application/json" \
  -d '{
    "signed_bundle": {
      "bundle": { ... },
      "signature": { "alg": "ed25519", "sig_b64": "...", "signer": { "public_key_b64": "..." } }
    }
  }'
```

<a id="v2-passport-registration"></a>

### Registro de un pasaporte V2

El cuerpo es el `SignedPayload` de un `AgentPassportV2`, firmado con
`compositeSign(registry, DCP_CONTEXTS.AgentPassport, canonicalBytes, keys)` por las claves que enumera (el
`agent_passport` de un bundle construido con el SDK tiene esta forma).

```bash
curl -s -X POST http://localhost:3000/v2/passport/register \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "signed_passport": {
      "payload": {
        "dcp_version": "2.0",
        "agent_id": "agent:research-bot-001",
        "session_nonce": "<64 hex>",
        "keys": [
          { "kid": "<32 hex>", "alg": "ed25519", "public_key_b64": "...", "created_at": "...", "expires_at": null, "status": "active" },
          { "kid": "<32 hex>", "alg": "ml-dsa-65", "public_key_b64": "...", "created_at": "...", "expires_at": null, "status": "active" }
        ],
        "principal_binding_reference": "human:alice-001",
        "capabilities": ["browse"],
        "risk_tier": "low",
        "created_at": "...",
        "status": "active",
        "emergency_revocation_token": "sha256:<64 hex>"
      },
      "payload_hash": "sha256:...",
      "composite_sig": {
        "classical": { "alg": "ed25519", "kid": "<32 hex>", "sig_b64": "..." },
        "pq": { "alg": "ml-dsa-65", "kid": "<32 hex>", "sig_b64": "..." },
        "binding": "pq_over_classical"
      }
    }
  }'
```

Respuestas: 201 `{ ok, agent_id, registered_kids }`, 400 (discrepancia de esquema o de kid, o claves que no son base64
canónico), 401 (un `agent_id` nuevo sin el token del operador), 403 (firma no válida, o agente revocado), 409 (agente
registrado con otras claves, pasaporte no posterior al registrado, agente sin una clave activa de una familia
registrada, o un kid retirado o de otro agente), 429 (límite de tasa), 507 (registro lleno).

<a id="key-rotation"></a>

### Rotación de claves

```bash
# body = createKeyRotation(registry, { oldKid, oldAlg, oldSecretKeyB64, newKid, newAlg,
#                                      newSecretKeyB64, newPublicKeyB64, timestamp, expiresAt })
curl -s -X POST http://localhost:3000/v2/keys/rotate \
  -H "Content-Type: application/json" \
  -d '{
    "old_kid": "<32 hex>",
    "new_key": { "kid": "<32 hex>", "alg": "ed25519", "public_key_b64": "...", "created_at": "...", "expires_at": null, "status": "active" },
    "timestamp": "2026-03-01T00:00:00Z",
    "proof_of_possession": { "alg": "ed25519", "kid": "<new kid>", "sig_b64": "..." },
    "authorization_sig": { "alg": "ed25519", "kid": "<old kid>", "sig_b64": "..." }
  }'
```

<a id="switching-the-verifier-mode-operator"></a>

### Cambio del modo del verificador (operador)

```bash
curl -s -X POST http://localhost:3000/v2/policy/mode \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "mode": "pq_only" }'
```

<a id="v2-intent-declaration"></a>

### Declaración de una intención V2

El cuerpo es el `SignedPayload` de una `IntentV2` de un agente registrado. Su `composite_sig` debe estar presente, pero no se verifica. El servidor puntúa la intención por sí mismo y responde `{ ok, policy_decision, security_tier, verification_mode, checkpoint_interval }`; la decisión de política no está firmada (`block` desde un riesgo de 800, `escalate` desde 500).

La petición de abajo solo ilustra la forma: sustituye los puntos suspensivos y los marcadores por tu payload firmado antes de enviarla. Los fragmentos literales `{ ... }` no son JSON válido.

```bash
curl -s -X POST http://localhost:3000/v2/intent/declare \
  -H "Content-Type: application/json" \
  -d '{
    "signed_intent": {
      "payload": {
        "dcp_version": "2.0",
        "intent_id": "intent:...",
        "session_nonce": "<64 hex>",
        "agent_id": "agent:research-bot-001",
        "human_id": "human:alice-001",
        "timestamp": "...",
        "action_type": "api_call",
        "target": { "channel": "api" },
        "data_classes": ["pii"],
        "estimated_impact": "medium",
        "requires_consent": false
      },
      "payload_hash": "sha256:...",
      "composite_sig": { "classical": { ... }, "pq": { ... }, "binding": "pq_over_classical" }
    }
  }'
```

<a id="v2-bundle-verification"></a>

### Verificación de un bundle V2

```bash
curl -s -X POST http://localhost:3000/v2/bundle/verify \
  -H "Content-Type: application/json" \
  -d '{
    "signed_bundle": {
      "bundle": {
        "dcp_bundle_version": "2.0",
        "manifest": { "session_nonce": "...", "rpr_hash": "sha256:...", ... },
        "responsible_principal_record": { "payload": { ... }, "payload_hash": "sha256:...", "composite_sig": { ... } },
        "agent_passport": { ... },
        "intent": { ... },
        "policy_decision": { ... },
        "audit_entries": [ ... ]
      },
      "signature": {
        "hash_alg": "sha256",
        "created_at": "...",
        "signer": { "type": "human", "id": "...", "kids": ["..."] },
        "manifest_hash": "sha256:...",
        "composite_sig": {
          "classical": { "alg": "ed25519", "kid": "...", "sig_b64": "..." },
          "pq": { "alg": "ml-dsa-65", "kid": "...", "sig_b64": "..." },
          "binding": "pq_over_classical"
        }
      }
    },
    "public_key_b64": "..."
  }'
```

El formato es `schemas/v2/signed_bundle.schema.json`; constrúyelo con `BundleBuilderV2` + `signBundleV2` de `@dcp-ai/sdk` o con `dcp sign-bundle --composite`. `public_key_b64` es opcional y fija el firmante clásico. Se rechaza el sobre prenormativo (`dcp_version` / `bundle_manifest` en el nivel superior).

<a id="emergency-revocation"></a>

### Revocación de emergencia

El secreto es la preimagen del `emergency_revocation_token` registrado con el pasaporte. Limitada a 5 intentos por
minuto por IP de cliente.

```bash
curl -s -X POST http://localhost:3000/v2/emergency-revoke \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "agent:research-bot-001",
    "revocation_secret": "<64 hex>"
  }'
```

<a id="capability-discovery"></a>

### Descubrimiento de capacidades

```bash
curl -s http://localhost:3000/.well-known/dcp-capabilities.json | jq .
```

<a id="architecture"></a>

## Arquitectura

```
                    ┌──────────────────────────┐
                    │    DCP Reference Gateway  │
                    ├──────────────────────────┤
                    │  V1 Verification          │
                    │  V2 Composite Verification│
                    │  Key Registry (in-memory) │
                    │  Audit Chains (in-memory) │
                    │  Policy Engine (Phase 3)  │
                    │  Advisory System           │
                    │  Governance Keys           │
                    └──────────────────────────┘
```

<a id="limitations"></a>

## Limitaciones

- **Almacenamiento en memoria**: todo el estado (pasaportes, claves, cadenas de auditoría, avisos) se pierde al reiniciar. Véase [Persistencia](#persistence).
- **Firmas fuera de la verificación de bundles**: la verificación de bundles, el registro de pasaportes, la rotación de claves y la autorización multiparte comprueban firmas Ed25519 y ML-DSA-65 / SLH-DSA reales. `/v2/advisory/publish` y `/v2/governance/register` no lo hacen (el token del operador es su única protección), ni tampoco `/v2/intent/declare`, `/v2/audit/*` ni los endpoints de DCP-05 a DCP-09, que además no necesitan token (véase [De DCP-05 a DCP-09](#dcp-05-to-dcp-09)).
- **Anclaje**: `POST /anchor` devuelve 501. Impleméntalo con tu blockchain (Ethereum, Bitcoin) o tu registro de transparencia.

<a id="persistence"></a>

## Persistencia

No se escribe nada en disco. Un reinicio, un despliegue o una máquina detenida borran los registros de pasaportes y de
claves, así que, tras un borrado, el historial de registros desaparece: quien tenga el token del operador puede volver a registrar cualquier `agent_id` con otras claves, y las
revocaciones de emergencia se olvidan. Por eso `deploy/fly/verification.toml` mantiene una máquina en marcha
(`min_machines_running = 1`) en lugar de escalar a cero; los despliegues y los reinicios siguen empezando vacíos. Los
despliegues de producción necesitan un almacén persistente.

<a id="deployment"></a>

## Despliegue

- En producción, ejecútalo detrás de un proxy inverso (nginx, Caddy) con TLS, y define `TRUST_PROXY=true` solo si añade la IP del cliente a `X-Forwarded-For`.
- Usa un gestor de procesos (systemd, PM2) para los reinicios automáticos.
- Consulta la [configuración de Docker](../docker/README.md) para el despliegue en contenedores.

<a id="reference"></a>

## Referencia

- [spec/VERIFICATION.md](../spec/VERIFICATION.md) — Lista de comprobación normativa de la verificación
- [spec/DCP-AI-v2.0.md](../spec/DCP-AI-v2.0.md) — Especificación del protocolo V2
- [docs/OPERATOR_GUIDE.md](../docs/OPERATOR_GUIDE.md) — Guía del operador
