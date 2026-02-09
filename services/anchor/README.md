# Anchoring Service

Servicio HTTP para anclar hashes de Citizenship Bundles a blockchains L2 (Base, Arbitrum, Optimism). Soporta anclaje individual o por lotes (batch) con Merkle root.

## Quickstart

```bash
# Iniciar el servicio
node index.js

# O con Docker
docker compose up anchor
```

El servicio escucha en `http://localhost:3001` por defecto.

## Endpoints

### `GET /health`

Health check del servicio.

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

### `POST /anchor`

Enviar un bundle hash para anclar.

```bash
curl -X POST http://localhost:3001/anchor \
  -H "Content-Type: application/json" \
  -d '{"bundle_hash": "sha256:abc123..."}'
```

**Modo individual** — Ancla inmediatamente:

```json
{
  "anchored": true,
  "hash": "sha256:abc123...",
  "count": 1,
  "timestamp": "2025-01-01T00:00:00.000Z",
  "tx_hash": "0x...",
  "chain": "base"
}
```

**Modo batch** — Acepta y encola (HTTP 202):

```json
{
  "accepted": true,
  "bundle_hash": "sha256:abc123...",
  "position": 3,
  "hint": "Batch will flush in ~60s or POST /flush"
}
```

### `GET /status/:hash`

Consultar el estado de un hash anclado.

```bash
curl http://localhost:3001/status/sha256:abc123...
```

```json
{
  "anchored": true,
  "hash": "sha256:abc123...",
  "count": 1,
  "timestamp": "2025-01-01T00:00:00.000Z",
  "tx_hash": "0x...",
  "chain": "base"
}
```

Si no esta anclado pero esta pendiente:

```json
{
  "anchored": false,
  "pending": true
}
```

### `GET /anchored`

Listar todos los registros anclados.

```bash
curl http://localhost:3001/anchored
```

```json
{
  "records": [
    { "hash": "sha256:...", "count": 1, "timestamp": "...", "tx_hash": "0x...", "chain": "base" }
  ]
}
```

### `POST /flush`

Forzar el flush del batch pendiente (solo en modo batch).

```bash
curl -X POST http://localhost:3001/flush
```

```json
{ "flushed": true }
```

## Configuracion

### Variables de entorno

| Variable | Default | Descripcion |
|----------|---------|-------------|
| `PORT` | `3001` | Puerto HTTP |
| `ANCHOR_MODE` | `"batch"` | Modo de anclaje: `"individual"` o `"batch"` |
| `BATCH_INTERVAL_MS` | `60000` | Intervalo de flush automatico en ms (modo batch) |
| `ANCHOR_RPC_URL` | — | URL JSON-RPC del nodo L2 |
| `ANCHOR_PRIVATE_KEY` | — | Clave privada de la wallet para firmar transacciones |
| `ANCHOR_CONTRACT` | — | Direccion del contrato DCPAnchor desplegado |
| `ANCHOR_CHAIN` | `"base"` | Identificador de la cadena |

### Modos de operacion

**Individual (`ANCHOR_MODE=individual`):** Cada hash se ancla inmediatamente en una transaccion on-chain independiente.

**Batch (`ANCHOR_MODE=batch`):** Los hashes se acumulan y se anclan periodicamente como un Merkle root, reduciendo costos de gas. El flush ocurre cada `BATCH_INTERVAL_MS` milisegundos o manualmente via `POST /flush`.

## Integracion con DCPAnchor.sol

El servicio interactua con el smart contract `DCPAnchor.sol`:

- **Modo individual:** Llama a `anchorBundle(bytes32 bundleHash)`
- **Modo batch:** Calcula el Merkle root de los hashes pendientes y llama a `anchorBatch(bytes32 merkleRoot, uint256 count)`

Ver [contracts/ethereum/README.md](../../contracts/ethereum/README.md) para detalles del contrato.

## Desarrollo

```bash
# Iniciar en modo desarrollo
PORT=3001 ANCHOR_MODE=batch node index.js

# Test con curl
curl http://localhost:3001/health
curl -X POST http://localhost:3001/anchor \
  -H "Content-Type: application/json" \
  -d '{"bundle_hash": "sha256:test123"}'
```

## Licencia

Apache-2.0
