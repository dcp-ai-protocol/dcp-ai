<sub>[English](../../../../services/anchor/README.md) · **Español** · [Português](../../../pt-BR/services/anchor/README.md) · [日本語](../../../ja/services/anchor/README.md) · [中文](../../../zh-CN/services/anchor/README.md)</sub>

<a id="anchoring-service"></a>

# Servicio de anclaje

> Traducción informativa de [la versión en inglés](../../../../services/anchor/README.md), actualizada el 25/10/2026. Si hay diferencias, prevalece el original inglés. Los identificadores y los bloques de código, incluidos los comentarios, se conservan sin traducir.

Servicio HTTP destinado a anclar hashes de Citizenship Bundles en blockchains L2 (Base, Arbitrum, Optimism), individualmente o en lotes bajo una raíz Merkle. Actualmente solo los registra de forma local (consulta la nota siguiente).

> **El envío on-chain todavía no está implementado.** Los hashes y las raíces de lotes se registran localmente con
> `tx_hash: null` y `onchain: false`; el servicio nunca inventa un hash de transacción.
> `ANCHOR_RPC_URL`, `ANCHOR_PRIVATE_KEY` y `ANCHOR_CONTRACT` todavía no se utilizan. El estado está en memoria
> (consulta [Persistencia](../../../../services/README.md#persistence)).

<a id="quickstart"></a>

## Inicio rápido

```bash
# Start the service, from the repo root after installing the root dependencies
node services/anchor/index.js

# Or with Docker, from the repo root
docker compose -f docker/docker-compose.yml up anchor
```

Por defecto, el servicio escucha en `http://localhost:3001`.

## Endpoints

### `GET /health`

Comprobación del estado del servicio.

```bash
curl http://localhost:3001/health
```

```json
{
  "ok": true,
  "service": "dcp-anchor",
  "mode": "batch",
  "pending": 0,
  "total_anchored": 5
}
```

`total_anchored` cuenta registros locales, uno por lote, no hashes. Una respuesta de estado saludable no acredita ninguna operación on-chain.

### `POST /anchor`

Envía un hash de bundle para anclarlo: `sha256:` seguido de 64 caracteres hexadecimales en minúscula (el prefijo es opcional). Cualquier otro formato, o un cuerpo mayor de 1 MB, devuelve 400.

```bash
curl -X POST http://localhost:3001/anchor \
  -H "Content-Type: application/json" \
  -d '{"bundle_hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"}'
```

**Modo individual** — Registra el hash inmediatamente, de forma local: `anchored: true` significa que este servicio lo registró, no que esté on-chain (`onchain: false`, `tx_hash: null`):

```json
{
  "anchored": true,
  "hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "count": 1,
  "timestamp": "2025-01-01T00:00:00.000Z",
  "tx_hash": null,
  "onchain": false,
  "chain": "base"
}
```

**Modo por lotes** — Acepta y encola (HTTP 202):

```json
{
  "accepted": true,
  "bundle_hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "position": 3,
  "hint": "Will be anchored in next batch (interval: 60000ms)"
}
```

### `GET /status/:hash`

Consulta el estado de un hash anclado.

```bash
curl http://localhost:3001/status/sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
```

```json
{
  "anchored": true,
  "hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "count": 1,
  "timestamp": "2025-01-01T00:00:00.000Z",
  "tx_hash": null,
  "onchain": false,
  "chain": "base"
}
```

Si todavía no está anclado pero está pendiente:

```json
{
  "anchored": false,
  "pending": true
}
```

Un registro solo se encuentra por el hash que almacena. En modo individual, y para un lote de un solo hash, es el hash enviado (con el prefijo `sha256:`). Para un lote de varios hashes, es únicamente su raíz Merkle, de modo que cada uno de esos hashes pasa a responder `{"anchored": false, "pending": false}`; todavía no hay pruebas de inclusión por hash. Mientras está pendiente, el hash se compara tal como se envió (con o sin prefijo). Los registros están en memoria y se pierden al reiniciar.

### `GET /anchored`

Enumera todos los registros anclados.

```bash
curl http://localhost:3001/anchored
```

```json
{
  "records": [
    { "hash": "sha256:...", "count": 1, "timestamp": "...", "tx_hash": null, "onchain": false, "chain": "base" }
  ]
}
```

### `POST /flush`

Fuerza el procesamiento del lote pendiente (solo en modo por lotes). Requiere el token del operador; sin `OPERATOR_TOKEN` configurado, el endpoint permanece bloqueado (401).

```bash
curl -X POST http://localhost:3001/flush -H "Authorization: Bearer $OPERATOR_TOKEN"
```

```json
{ "flushed": true }
```

<a id="configuration"></a>

## Configuración

<a id="environment-variables"></a>

### Variables de entorno

| Variable | Valor predeterminado | Descripción |
|----------|---------|-------------|
| `PORT` | `3001` | Puerto HTTP |
| `ANCHOR_MODE` | `"batch"` | Modo de anclaje: `"individual"` o `"batch"` |
| `BATCH_INTERVAL_MS` | `60000` | Intervalo de procesamiento automático en ms (modo por lotes) |
| `ANCHOR_RPC_URL` | — | URL JSON-RPC del nodo L2 (todavía no se usa; si se configura, se registra una advertencia) |
| `ANCHOR_PRIVATE_KEY` | — | Clave privada de la cartera para firmar transacciones (todavía no se usa) |
| `ANCHOR_CONTRACT` | — | Dirección del contrato DCPAnchor desplegado (todavía no se usa) |
| `ANCHOR_CHAIN` | `"base"` | Identificador de la cadena |
| `OPERATOR_TOKEN` | — | Token Bearer para `POST /flush`. Sin configurar: bloqueado |

<a id="operating-modes"></a>

### Modos de funcionamiento

**Individual (`ANCHOR_MODE=individual`):** Cada hash obtiene su propio registro local de inmediato. Cuando se conecte el envío on-chain, cada uno sería una transacción separada.

**Por lotes (`ANCHOR_MODE=batch`):** Los hashes se acumulan y se registran como una única raíz Merkle cada `BATCH_INTERVAL_MS` milisegundos, o inmediatamente mediante `POST /flush`. Cuando se conecte el envío on-chain, cada lote sería una transacción.

<a id="integration-with-dcpanchorsol"></a>

## Integración con DCPAnchor.sol

Una vez conectado, el servicio interactuará con el contrato inteligente `DCPAnchor.sol`:

- **Modo individual:** Llamará a `anchorBundle(bytes32 bundleHash)`
- **Modo por lotes:** Calculará la raíz Merkle de los hashes pendientes y llamará a `anchorBatch(bytes32 merkleRoot, uint256 count)`

Consulta [contracts/ethereum/README.md](../../../../contracts/ethereum/README.md) para conocer los detalles del contrato.

<a id="development"></a>

## Desarrollo

```bash
# Start in development mode, from the repo root
PORT=3001 ANCHOR_MODE=batch node services/anchor/index.js

# Test with curl
curl http://localhost:3001/health
curl -X POST http://localhost:3001/anchor \
  -H "Content-Type: application/json" \
  -d '{"bundle_hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"}'
```

<a id="license"></a>

## Licencia

Apache-2.0
