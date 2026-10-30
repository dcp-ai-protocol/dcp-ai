<sub>[English](../../../../services/revocation/README.md) · [中文](../../../zh-CN/services/revocation/README.md) · **Español** · [日本語](../../../ja/services/revocation/README.md) · [Português](../../../pt-BR/services/revocation/README.md)</sub>

<a id="revocation-service"></a>

# Servicio de revocación

> Traducción informativa de [la versión en inglés](../../../../services/revocation/README.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Servicio HTTP para publicar y consultar revocaciones de agentes de DCP. Admite tanto V1 (a nivel de agente) como V2 (a nivel de kid, revocación de emergencia, seguimiento de certificados de corta duración). Expone un endpoint `.well-known` para consultas normalizadas.

Toda escritura está autenticada. El operador registra cada agente nuevo con su pasaporte V2 autofirmado
(`POST /v2/register` con el token del operador): la firma compuesta prueba la posesión de las claves firmantes, así que
el servicio registra esos kids como del agente, con su caducidad y el token de revocación de emergencia del pasaporte.
Volver a registrarse es autoservicio, y las revocaciones deben firmarlas las claves registradas. El estado está en
memoria salvo que `REVOCATION_STATE_PATH` indique un archivo (véase [Configuración](#configuration)).

Los ejemplos de escritura de abajo (`POST /revoke`, `POST /v2/register`, `POST /v2/revoke`, `POST /v2/emergency-revoke`)
son plantillas: sus firmas, pasaportes y secretos son marcadores (`...`), así que no funcionan tal cual, y no deben
rellenarse con valores inventados. `index.test.js` muestra cómo se construyen los reales.

<a id="quickstart"></a>

## Inicio rápido

```bash
# Start the service, from the root of a checkout: it imports @dcp-ai/sdk, so build the
# workspace SDK and install the root package first
(cd sdks/typescript && npm install && npm run build) && npm install
node services/revocation/index.js

# Or with Docker, from the repo root
docker compose -f docker/docker-compose.yml up revocation
```

El servicio escucha por defecto en `http://localhost:3003`.

<a id="v1-endpoints"></a>

## Endpoints V1

### `GET /health`

Comprobación de salud del servicio.

```bash
curl http://localhost:3003/health
```

```json
{
  "ok": true,
  "service": "dcp-revocation",
  "supported_versions": ["1.0", "2.0"],
  "registered_agents": 2,
  "total_revocations": 3,
  "total_kid_revocations": 1
}
```

### `POST /revoke`

Publica una revocación a nivel de agente (V1). `signature` es una firma Ed25519 (en base64) sobre el JSON canónico V1
de `{ dcp_version, agent_id, human_id, timestamp, reason }` tal como se envía (`signObject` en `tools/crypto.js`), hecha
con una de las claves `ed25519` activas del agente (registrada, no revocada, no caducada). El agente debe haberse
registrado antes con `POST /v2/register`, que exige una firma híbrida del pasaporte: un agente solo Ed25519 (V1) no
puede publicar revocaciones aquí.

```bash
curl -X POST http://localhost:3003/revoke \
  -H "Content-Type: application/json" \
  -d '{
    "dcp_version": "1.0",
    "agent_id": "agent:research-bot-001",
    "human_id": "human:alice-001",
    "timestamp": "2026-03-01T00:00:00Z",
    "reason": "Compromised credentials",
    "signature": "base64-signature..."
  }'
```

**Cuerpo de la petición:**

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|----------|-------------|
| `agent_id` | `string` | Sí | ID del agente que se revoca |
| `human_id` | `string` | No | ID de la persona responsable |
| `reason` | `string` | Sí | Motivo de la revocación |
| `signature` | `string` | Sí | Firma Ed25519 sobre los demás campos |
| `dcp_version` | `string` | No | Versión de DCP (por defecto: `"1.0"`) |
| `timestamp` | `string` | No | ISO 8601 (por defecto: ahora) |

Los campos que no se envían quedan fuera del objeto firmado; los valores por defecto se rellenan después.

**Respuesta (201):**

```json
{
  "ok": true,
  "agent_id": "agent-001",
  "revoked_at": "2026-03-01T00:00:00.000Z"
}
```

**Respuestas de error:** 400 (faltan campos), 403 (la firma no se verifica con las claves `ed25519` registradas del
agente), 409 (agente ya revocado: las revocaciones son definitivas, así que una revocación de emergencia no puede
sobrescribirse).

### `GET /check/:agent_id`

Comprueba si un agente está revocado.

```bash
curl http://localhost:3003/check/agent-001
```

**Agente revocado:**

```json
{
  "revoked": true,
  "record": {
    "dcp_version": "1.0",
    "agent_id": "agent-001",
    "human_id": "human-001",
    "timestamp": "2026-03-01T00:00:00.000Z",
    "reason": "Compromised credentials",
    "signature": "base64-signature..."
  }
}
```

**Agente no revocado:**

```json
{
  "revoked": false,
  "agent_id": "agent-001"
}
```

### `GET /list`

Enumera todas las revocaciones a nivel de agente.

```bash
curl http://localhost:3003/list
```

```json
{
  "revocations": [...],
  "total": 3
}
```

---

<a id="v2-endpoints"></a>

## Endpoints V2

### `POST /v2/register`

Registra las claves de un agente y su token de revocación de emergencia. El cuerpo es el pasaporte autofirmado del
agente, el `SignedPayload` de un `AgentPassportV2` firmado con `DCP-AI.v2.AgentPassport` por las claves que enumera (el
`agent_passport` de un bundle construido con el SDK). La firma compuesta debe ser `pq_over_classical`.

Registrar un `agent_id` **nuevo** requiere `Authorization: Bearer <OPERATOR_TOKEN>`. Un pasaporte solo está
autofirmado, y un RPR también, así que, sin un ancla de confianza, cualquiera podría reclamar primero el `agent_id` de
una víctima, colocar su propio token y revocarlo por emergencia. En su lugar, el operador responde por los agentes
nuevos, y sin un `OPERATOR_TOKEN` configurado nadie puede registrar uno. Volver a registrar un agente existente no
requiere token.

```bash
curl -X POST http://localhost:3003/v2/register \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "signed_passport": { "payload": { "dcp_version": "2.0", "agent_id": "...", "keys": [...], "emergency_revocation_token": "sha256:...", ... }, "payload_hash": "sha256:...", "composite_sig": { ... } } }'
```

- Solo se registran las dos claves firmantes (clásica + PQ): incluir la clave pública de otra persona no registra
  nada. Su `expires_at` determina la respuesta `expired` de `GET /v2/check/kid/:kid`.
- Volver a registrar un `agent_id` (por ejemplo, para sustituir el token) requiere un pasaporte cuyo `created_at` sea
  posterior al registrado, porque los pasaportes firmados son públicos y uno antiguo podría reenviarse, y que esté
  firmado exactamente por las claves clásica y PQ activas del agente (no revocadas, no caducadas). Las entradas de
  claves registradas se conservan, así que un pasaporte nuevo no puede ampliar el `expires_at` de una clave ni añadir
  claves, y un pasaporte sin token conserva el registrado.
- Un agente que ha perdido su clave clásica o PQ activa (caducada, o revocada por kid) queda bloqueado: si no, la clave
  que le queda podría emparejarse con una nueva clave compañera y apoderarse del agente. La recuperación pasa por el
  token de revocación de emergencia (revocar y después registrar un `agent_id` nuevo) o por el operador, que todavía no
  tiene ninguna API para ello.

**Respuesta (201):**

```json
{ "ok": true, "agent_id": "agent-001", "registered_kids": ["a1b2...", "c3d4..."] }
```

**Respuestas de error:** 400 (no es un pasaporte V2 firmado, no tiene un `created_at` válido, o un token o una
caducidad de clave mal formados), 401 (un `agent_id` nuevo sin el token del operador), 403 (firma no válida, o agente
revocado por emergencia), 409 (agente registrado con otras claves, pasaporte no posterior al registrado, agente sin
una clave clásica o PQ activa, o un kid revocado, caducado o de otro agente), 429 (más de `REGISTRATIONS_PER_HOUR`
llamadas de este cliente), 507 (se alcanzó `MAX_AGENTS`).

### `POST /v2/revoke`

Revocación a nivel de kid con firma compuesta. `composite_sig` firma el registro sin ella (`dcp_version`, `agent_id`,
`human_id`, `revoked_kid`, `timestamp`, `reason`, tal como se envían) con `DCP-AI.v2.Revocation`, con las claves activas
del agente; `revoked_kid` debe ser uno de sus kids registrados.

```bash
curl -X POST http://localhost:3003/v2/revoke \
  -H "Content-Type: application/json" \
  -d '{
    "dcp_version": "2.0",
    "agent_id": "agent-001",
    "human_id": "human-001",
    "revoked_kid": "a1b2c3d4e5f6...",
    "reason": "key_compromise",
    "composite_sig": {
      "classical": { "alg": "ed25519", "kid": "abc123", "sig_b64": "..." },
      "pq": { "alg": "ml-dsa-65", "kid": "def456", "sig_b64": "..." },
      "binding": "pq_over_classical"
    }
  }'
```

**Cuerpo de la petición:**

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|----------|-------------|
| `dcp_version` | `string` | Sí | Debe ser `"2.0"` |
| `agent_id` | `string` | Sí | ID del agente |
| `human_id` | `string` | No | ID de la persona responsable |
| `revoked_kid` | `string` | Sí | Identificador de la clave que se revoca |
| `reason` | `string` | Sí | Motivo de la revocación |
| `composite_sig` | `object` | Sí | Firma compuesta: clásica y PQ, ambas obligatorias (se rechaza una firma solo clásica) |

**Respuesta (201):**

```json
{
  "ok": true,
  "agent_id": "agent-001",
  "revoked_kid": "a1b2c3d4e5f6...",
  "revoked_at": "2026-03-01T00:00:00.000Z"
}
```

**Respuestas de error:** 400 (faltan campos o `dcp_version`), 403 (`revoked_kid` no es una clave registrada de
`agent_id`, o `composite_sig` no se verifica con las claves del agente).

### `POST /v2/emergency-revoke`

Revocación de emergencia (botón de pánico). Revoca TODAS las claves de un agente usando la preimagen del
`emergency_revocation_token` registrado con su pasaporte. Limitado a 5 intentos por minuto por IP de cliente
(dirección del socket, o el último salto de `X-Forwarded-For` con `TRUST_PROXY=true`).

```bash
curl -X POST http://localhost:3003/v2/emergency-revoke \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "agent-001",
    "revocation_secret": "a1b2c3d4e5f6..."
  }'
```

**Cuerpo de la petición:**

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|----------|-------------|
| `agent_id` | `string` | Sí | ID del agente que se revoca |
| `human_id` | `string` | No | ID de la persona responsable |
| `revocation_secret` | `string` | Sí | Preimagen del token registrado (64 caracteres hexadecimales) |
| `reason` | `string` | No | Motivo (por defecto: `"key_compromise_emergency"`) |
| `timestamp` | `string` | No | ISO 8601 (por defecto: ahora) |

**Respuesta (200):**

```json
{
  "ok": true,
  "agent_id": "agent-001",
  "revoked_at": "2026-03-01T00:00:00.000Z",
  "keys_revoked": 2
}
```

**Respuestas de error:** 400 (formato incorrecto), 403 (secreto no válido), 404 (no hay token registrado), 409 (token ya consumido), 429 (límite de tasa).

`POST /v2/register-emergency-token` y `POST /v2/register-key-expiry` se eliminaron: aceptaban peticiones sin firmar, así
que cualquiera podía sustituir un token o marcar como caducada cualquier clave. El token y la caducidad de las claves
proceden ahora del pasaporte firmado (`POST /v2/register`).

### `GET /v2/check/kid/:kid`

Comprueba si un identificador de clave registrado está revocado: una revocación explícita del kid, una revocación de
emergencia de su propietario o la caducidad. El servicio solo conoce los kids que firmaron el registro de un agente
(`POST /v2/register`). Cualquier otro kid obtiene **404** `{ "registered": false }`. Eso cubre los kids que aparecen en
un pasaporte sin firmarlo, los rotados en la pasarela o los de un agente que nunca se registró aquí: su estado aquí es
desconocido, no «no revocado». `?agent_id=` se ignora, así que quien llama no puede tomar prestado el veredicto de otro
agente para un kid.

```bash
curl "http://localhost:3003/v2/check/kid/a1b2c3d4e5f6"
```

**Clave revocada:**

```json
{
  "revoked": true,
  "kid": "a1b2c3d4e5f6",
  "agent_id": "agent-001",
  "reason": "key_compromise",
  "revoked_at": "2026-03-01T00:00:00.000Z"
}
```

**Clave activa:**

```json
{ "revoked": false, "kid": "a1b2c3d4e5f6" }
```

### `GET /v2/list`

Enumera todas las revocaciones, tanto a nivel de agente como de kid.

```bash
curl http://localhost:3003/v2/list
```

```json
{
  "dcp_version": "2.0",
  "agent_revocations": [...],
  "kid_revocations": [...],
  "total_agents": 2,
  "total_kids": 5
}
```

---

<a id="shared-endpoints"></a>

## Endpoints compartidos

### `GET /.well-known/dcp-revocations.json`

Endpoint normalizado para consultar todas las revocaciones (V1 + V2). Sigue la [RFC 8615](https://tools.ietf.org/html/rfc8615).

```bash
curl http://localhost:3003/.well-known/dcp-revocations.json
```

```json
{
  "dcp_version": "2.0",
  "updated_at": "2026-03-01T00:00:00.000Z",
  "revocations": [
    {
      "dcp_version": "2.0",
      "agent_id": "agent-001",
      "human_id": "human-001",
      "timestamp": "2026-03-01T00:00:00.000Z",
      "reason": "Compromised credentials",
      "signature": "composite:a1b2c3d4"
    }
  ],
  "kid_revocations": [
    {
      "dcp_version": "2.0",
      "agent_id": "agent-001",
      "revoked_kid": "a1b2c3d4e5f6...",
      "timestamp": "2026-03-01T00:00:00.000Z",
      "reason": "key_compromise"
    }
  ]
}
```

Este endpoint puede:

- Consultarlo cualquier verificador
- Almacenarse en caché en CDN
- Servirse como archivo estático en producción

La lista no lleva firma: un verificador confía en ella por la URL y el HTTPS de los que procede, así que una copia en una CDN o estática debe conservar esa confianza. Una copia en caché solo está tan al día como su última actualización: una revocación recién añadida no se refleja hasta que la copia se actualiza. Siguen aplicándose las demás comprobaciones de admisión y los requisitos de frescura. La fuente de revocación de la admisión lee este formato como una lista de denegación completa y falla cuando no puede obtenerla ([docs/ADMISSION.md](../../../../docs/ADMISSION.md#revocation-sources)).

<a id="configuration"></a>

## Configuración

<a id="environment-variables"></a>

### Variables de entorno

| Variable | Valor por defecto | Descripción |
|----------|---------|-------------|
| `PORT` | `3003` | Puerto HTTP |
| `OPERATOR_TOKEN` | — | Token Bearer para registrar un `agent_id` nuevo. Sin definir: no hay agentes nuevos |
| `REVOCATION_STATE_PATH` | — | Archivo que conserva registros y revocaciones entre reinicios. Sin definir: solo memoria. Cada escritura se añade como una línea JSON con fsync (un nuevo registro solo anota lo que cambió). Al arrancar, el archivo se reproduce y después se compacta a una línea por entrada mediante un archivo temporal y un renombrado atómico. El servicio se niega a arrancar si la ruta no admite escritura o el archivo supera 512 MB |
| `TRUST_PROXY` | — | `true` solo detrás de un proxy que añade la IP del cliente a `X-Forwarded-For` |
| `REGISTRATIONS_PER_HOUR` | `20` | Llamadas a `POST /v2/register` por cliente y hora; las demás reciben 429 |
| `MAX_AGENTS` | `10000` | Agentes registrados; a partir de ahí, los agentes nuevos reciben 507 (no se desaloja nada) |

Sin `REVOCATION_STATE_PATH`, el estado está en memoria y **no sobrevive a un reinicio**, un despliegue o un fallo: se
pierden los registros y todas las revocaciones, así que los agentes revocados vuelven a parecer válidos. En Fly, pon
el archivo en un volumen (véase `deploy/fly/revocation.toml`); la pila de Docker Compose lo guarda en el volumen
`revocation-data`. Los límites anteriores evitan que una avalancha de registros deje al servicio sin memoria. Los
registros también están acotados:
- `human_id`, `timestamp` y `reason` tienen como máximo 256 caracteres, y el `reason` de V2 es uno de
  `key_compromise`, `key_rotation`, `administrative`, `key_compromise_emergency`.
- `emergency_revocation_token` debe ser `sha256:<64 hex>`.
- De `composite_sig` solo se guardan los campos de firma.

<a id="integration"></a>

## Integración

<a id="querying-from-middleware"></a>

### Consultas desde un middleware

El `checkRevocation: true` del middleware de Express consulta `GET /check/:agent_id` y `GET /v2/check/kid/:kid` en cada petición. Deja pasar la petición cuando el servicio no responde, salvo con `revocationFailClosed: true`. La admisión (Express, FastAPI, OpenClaw y la pasarela de referencia, con el perfil strict-v1) lee en cambio `/.well-known/dcp-revocations.json` como lista de denegación y rechaza la petición cuando no puede.

<a id="v2-flow"></a>

### Flujo V2

1. El operador registra el pasaporte firmado del agente durante la configuración (`POST /v2/register` con el token del operador): las claves, su caducidad y el token de emergencia
2. Revoca claves concretas cuando haga falta, con la firma de las claves del agente (`POST /v2/revoke`)
3. Usa el botón de pánico en emergencias (`POST /v2/emergency-revoke`)
4. Comprueba el estado de las claves antes de aceptar bundles (`GET /v2/check/kid/:kid`)

<a id="development"></a>

## Desarrollo

```bash
PORT=3003 node services/revocation/index.js   # from the repo root, after npm install there

curl http://localhost:3003/health
curl http://localhost:3003/check/test-001
curl http://localhost:3003/v2/list
curl http://localhost:3003/.well-known/dcp-revocations.json

# Writes need signatures; index.test.js builds signed passports and revocations
node --test services/revocation/index.test.js   # from the repo root
```

<a id="license"></a>

## Licencia

Apache-2.0
