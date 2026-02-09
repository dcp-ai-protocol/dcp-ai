# Revocation Service

Servicio HTTP para publicar y consultar revocaciones de agentes DCP. Permite revocar el pasaporte de un agente y exponer un endpoint `.well-known` para consulta estandarizada.

## Quickstart

```bash
# Iniciar el servicio
node index.js

# O con Docker
docker compose up revocation
```

El servicio escucha en `http://localhost:3003` por defecto.

## Endpoints

### `GET /health`

Health check del servicio.

```bash
curl http://localhost:3003/health
```

```json
{
  "ok": true,
  "service": "dcp-revocation",
  "total_revocations": 3
}
```

### `POST /revoke`

Publicar una revocacion de agente.

```bash
curl -X POST http://localhost:3003/revoke \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "agent-001",
    "human_id": "human-001",
    "reason": "Compromised credentials",
    "signature": "base64-signature..."
  }'
```

**Request body:**

| Campo | Tipo | Requerido | Descripcion |
|-------|------|-----------|-------------|
| `agent_id` | `string` | Si | ID del agente a revocar |
| `human_id` | `string` | No | ID del humano responsable |
| `reason` | `string` | Si | Motivo de la revocacion |
| `signature` | `string` | Si | Firma de la revocacion |
| `dcp_version` | `string` | No | Version DCP (default: `"1.0"`) |
| `timestamp` | `string` | No | ISO 8601 (default: ahora) |

**Response (201):**

```json
{
  "ok": true,
  "agent_id": "agent-001",
  "revoked_at": "2025-01-01T00:00:00.000Z"
}
```

### `GET /check/:agent_id`

Verificar si un agente esta revocado.

```bash
curl http://localhost:3003/check/agent-001
```

**Agente revocado:**

```json
{
  "revoked": true,
  "agent_id": "agent-001",
  "record": {
    "dcp_version": "1.0",
    "agent_id": "agent-001",
    "human_id": "human-001",
    "timestamp": "2025-01-01T00:00:00.000Z",
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

### `GET /.well-known/dcp-revocations.json`

Endpoint estandarizado para consultar todas las revocaciones. Puede ser servido como archivo estatico o consumido por otros servicios.

```bash
curl http://localhost:3003/.well-known/dcp-revocations.json
```

```json
{
  "dcp_version": "1.0",
  "updated_at": "2025-01-01T00:00:00.000Z",
  "revocations": [
    {
      "dcp_version": "1.0",
      "agent_id": "agent-001",
      "human_id": "human-001",
      "timestamp": "2025-01-01T00:00:00.000Z",
      "reason": "Compromised credentials",
      "signature": "base64-signature..."
    }
  ]
}
```

### `GET /list`

Listar todas las revocaciones.

```bash
curl http://localhost:3003/list
```

```json
{
  "revocations": [...],
  "total": 3
}
```

## Configuracion

### Variables de entorno

| Variable | Default | Descripcion |
|----------|---------|-------------|
| `PORT` | `3003` | Puerto HTTP |

## Formato de revocacion

Un `RevocationRecord` DCP contiene:

```json
{
  "dcp_version": "1.0",
  "agent_id": "agent-001",
  "human_id": "human-001",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "reason": "Motivo de la revocacion",
  "signature": "base64-ed25519-signature"
}
```

La revocacion debe estar firmada por el humano responsable (clave privada Ed25519). El campo `signature` permite verificar la autenticidad de la revocacion.

## Integracion

### Consultar desde middleware

Los middlewares Express y FastAPI pueden usar `checkRevocation: true` para verificar automaticamente contra este servicio antes de aceptar un bundle.

### Endpoint `.well-known`

El endpoint `/.well-known/dcp-revocations.json` sigue la convencion de [RFC 8615](https://tools.ietf.org/html/rfc8615) y puede ser:

- Consultado por cualquier verificador
- Cacheado por CDNs
- Servido como archivo estatico en produccion

## Desarrollo

```bash
# Iniciar en modo desarrollo
PORT=3003 node index.js

# Test
curl http://localhost:3003/health
curl -X POST http://localhost:3003/revoke \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"test-001","reason":"test","signature":"sig"}'
curl http://localhost:3003/check/test-001
```

## Licencia

Apache-2.0
