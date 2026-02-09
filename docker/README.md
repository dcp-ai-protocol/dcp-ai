# Docker — DCP Infrastructure

Configuracion Docker Compose para desplegar todos los servicios DCP como contenedores. Incluye verificacion, anclaje, transparency log y revocacion.

## Quickstart

```bash
cd docker
docker compose up
```

Esto levanta 4 servicios:

| Servicio | Puerto | Descripcion |
|----------|--------|-------------|
| **verification** | `3000` | Servidor de verificacion de bundles |
| **anchor** | `3001` | Servicio de anclaje a blockchain L2 |
| **transparency-log** | `3002` | Log de transparencia con Merkle proofs |
| **revocation** | `3003` | Servicio de revocacion de agentes |

### Verificar que todo funciona

```bash
curl http://localhost:3000/health
curl http://localhost:3001/health
curl http://localhost:3002/health
curl http://localhost:3003/health
```

## Servicios

### verification (`:3000`)

Servidor de verificacion de Signed Bundles DCP.

```bash
# Verificar un bundle
curl -X POST http://localhost:3000/verify \
  -H "Content-Type: application/json" \
  -d @signed_bundle.json
```

### anchor (`:3001`)

Servicio de anclaje de bundle hashes a blockchain. Ver [services/anchor/README.md](../services/anchor/README.md).

### transparency-log (`:3002`)

Log de transparencia append-only con inclusion proofs. Ver [services/transparency-log/README.md](../services/transparency-log/README.md).

### revocation (`:3003`)

Servicio de publicacion y consulta de revocaciones. Ver [services/revocation/README.md](../services/revocation/README.md).

## Configuracion

### Variables de entorno

Cada servicio se configura via variables de entorno en `docker-compose.yml`:

#### verification

| Variable | Default | Descripcion |
|----------|---------|-------------|
| `PORT` | `3000` | Puerto HTTP |

#### anchor

| Variable | Default | Descripcion |
|----------|---------|-------------|
| `PORT` | `3001` | Puerto HTTP |
| `ANCHOR_MODE` | `batch` | `"individual"` o `"batch"` |
| `BATCH_INTERVAL_MS` | `60000` | Intervalo de flush (ms) |
| `ANCHOR_RPC_URL` | — | URL JSON-RPC del nodo L2 |
| `ANCHOR_PRIVATE_KEY` | — | Clave privada de la wallet |
| `ANCHOR_CONTRACT` | — | Direccion del contrato DCPAnchor |

#### transparency-log

| Variable | Default | Descripcion |
|----------|---------|-------------|
| `PORT` | `3002` | Puerto HTTP |

#### revocation

| Variable | Default | Descripcion |
|----------|---------|-------------|
| `PORT` | `3003` | Puerto HTTP |

### Configurar anclaje blockchain

Descomentar y configurar en `docker-compose.yml`:

```yaml
anchor:
  environment:
    - ANCHOR_RPC_URL=https://mainnet.base.org
    - ANCHOR_PRIVATE_KEY=0x...
    - ANCHOR_CONTRACT=0x...
```

## Dockerfile

El `Dockerfile` usa un build multi-stage con targets independientes:

```
Base: node:20-alpine
├── verification  → node server/index.js        (port 3000)
├── anchor        → node services/anchor/index.js      (port 3001)
├── transparency-log → node services/transparency-log/index.js (port 3002)
└── revocation    → node services/revocation/index.js  (port 3003)
```

### Build individual

```bash
# Build un servicio especifico
docker build -f docker/Dockerfile --target anchor -t dcp-anchor ..

# Ejecutar
docker run -p 3001:3001 -e ANCHOR_MODE=batch dcp-anchor
```

### Build todos

```bash
docker compose build
```

## Health Checks

Todos los servicios tienen health checks configurados:

- **Intervalo:** 30 segundos
- **Timeout:** 5 segundos
- **Reintentos:** 3
- **Comando:** `wget -qO- http://localhost:PORT/health`
- **Restart policy:** `unless-stopped`

## Ejemplo completo — Verificar un bundle

```bash
# 1. Levantar servicios
cd docker
docker compose up -d

# 2. Verificar un signed bundle
curl -X POST http://localhost:3000/verify \
  -H "Content-Type: application/json" \
  -d @tests/conformance/examples/citizenship_bundle.signed.json

# 3. Anclar el hash
HASH=$(curl -s http://localhost:3000/verify \
  -H "Content-Type: application/json" \
  -d @tests/conformance/examples/citizenship_bundle.signed.json \
  | jq -r '.bundle_hash')
curl -X POST http://localhost:3001/anchor \
  -H "Content-Type: application/json" \
  -d "{\"bundle_hash\": \"$HASH\"}"

# 4. Agregar al transparency log
curl -X POST http://localhost:3002/add \
  -H "Content-Type: application/json" \
  -d "{\"bundle_hash\": \"$HASH\"}"

# 5. Detener
docker compose down
```

## Licencia

Apache-2.0
