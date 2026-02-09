# Transparency Log Service

Servicio HTTP de log de transparencia estilo Certificate Transparency (CT). Almacena hashes de bundles en un Merkle tree append-only con inclusion proofs verificables.

## Quickstart

```bash
# Iniciar el servicio
node index.js

# O con Docker
docker compose up transparency-log
```

El servicio escucha en `http://localhost:3002` por defecto.

## Endpoints

### `GET /health`

Health check del servicio.

```bash
curl http://localhost:3002/health
```

```json
{
  "ok": true,
  "service": "dcp-transparency-log",
  "size": 42
}
```

### `POST /add`

Agregar un bundle hash al log.

```bash
curl -X POST http://localhost:3002/add \
  -H "Content-Type: application/json" \
  -d '{"bundle_hash": "sha256:abc123..."}'
```

```json
{
  "index": 42,
  "leaf_hash": "a1b2c3...",
  "root": "d4e5f6...",
  "size": 43
}
```

### `GET /root`

Obtener el Merkle root actual del log.

```bash
curl http://localhost:3002/root
```

```json
{
  "root": "d4e5f6...",
  "size": 43
}
```

### `GET /root/signed`

Obtener el Merkle root firmado (placeholder para firma del operador).

```bash
curl http://localhost:3002/root/signed
```

```json
{
  "root": "d4e5f6...",
  "size": 43,
  "timestamp": "2025-01-01T00:00:00.000Z",
  "signature": "placeholder"
}
```

### `GET /proof/:index`

Obtener el Merkle inclusion proof para una entrada por indice.

```bash
curl http://localhost:3002/proof/5
```

```json
{
  "index": 5,
  "leaf_hash": "a1b2c3...",
  "entry": {
    "hash": "sha256:abc123...",
    "leaf_hash": "a1b2c3...",
    "timestamp": "2025-01-01T00:00:00.000Z",
    "index": 5
  },
  "root": "d4e5f6...",
  "proof": [
    { "hash": "x1y2z3...", "direction": "left" },
    { "hash": "m4n5o6...", "direction": "right" }
  ]
}
```

El proof permite verificar que la entrada esta incluida en el Merkle tree sin descargar todo el log.

### `GET /entries`

Listar todas las entradas del log.

```bash
curl http://localhost:3002/entries
```

```json
{
  "entries": [
    { "hash": "sha256:...", "leaf_hash": "...", "timestamp": "...", "index": 0 },
    { "hash": "sha256:...", "leaf_hash": "...", "timestamp": "...", "index": 1 }
  ],
  "size": 2
}
```

## Configuracion

### Variables de entorno

| Variable | Default | Descripcion |
|----------|---------|-------------|
| `PORT` | `3002` | Puerto HTTP |

## Formato CT-style

El log sigue un formato inspirado en Certificate Transparency (RFC 6962):

1. **Append-only:** Las entradas nunca se eliminan ni modifican
2. **Merkle tree:** Cada entrada genera un `leaf_hash` (SHA-256) que se incorpora al arbol
3. **Inclusion proofs:** Cualquiera puede verificar que una entrada existe en el log usando el proof
4. **Signed root:** El root puede firmarse por el operador (placeholder actual)

### Verificar un inclusion proof

Para verificar que una entrada esta en el log:

1. Obtener el proof con `GET /proof/:index`
2. Calcular `leaf_hash = SHA-256(entry.hash)`
3. Recombinar los nodos del proof:
   - Si `direction == "left"`: `hash = SHA-256(proof_hash + current)`
   - Si `direction == "right"`: `hash = SHA-256(current + proof_hash)`
4. El resultado final debe coincidir con el `root` actual

## Desarrollo

```bash
# Iniciar en modo desarrollo
PORT=3002 node index.js

# Test
curl http://localhost:3002/health
curl -X POST http://localhost:3002/add \
  -H "Content-Type: application/json" \
  -d '{"bundle_hash": "sha256:test123"}'
curl http://localhost:3002/root
curl http://localhost:3002/proof/0
```

## Licencia

Apache-2.0
