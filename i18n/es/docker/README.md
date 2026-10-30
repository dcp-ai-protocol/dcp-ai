<sub>[English](../../../docker/README.md) · [中文](../../zh-CN/docker/README.md) · **Español** · [日本語](../../ja/docker/README.md) · [Português](../../pt-BR/docker/README.md)</sub>

<a id="docker--dcp-infrastructure"></a>
<a id="docker-dcp-infrastructure"></a>

# Docker — infraestructura de DCP

> Traducción informativa de [la versión en inglés](../../../docker/README.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Configuración de Docker Compose para desplegar todos los servicios de DCP como contenedores. Incluye verificación, anclaje, registro de transparencia y revocación.

<a id="quickstart"></a>

## Inicio rápido

```bash
cd docker
docker compose up
```

`docker compose up` se queda en primer plano: ejecuta las comprobaciones de abajo en una segunda terminal, o arranca la
pila con `docker compose up -d`. Esto arranca los cuatro servicios en cinco contenedores (dos registros de transparencia):

| Contenedor | Puerto | Descripción |
|---------|------|-------------|
| **verification** | `3000` | Servidor de verificación de bundles |
| **anchor** | `3001` | Servicio de anclaje: solo registros locales; el envío on-chain no está implementado |
| **transparency-log-a** | `3002` | Registro de transparencia `log-alpha`, con pruebas de Merkle |
| **transparency-log-b** | `3012` | Registro de transparencia `log-beta`, par de gossip de `log-alpha` |
| **revocation** | `3003` | Servicio de revocación de agentes |

<a id="verify-everything-is-running"></a>

### Comprobar que todo está en marcha

```bash
curl http://localhost:3000/health
curl http://localhost:3001/health
curl http://localhost:3002/health
curl http://localhost:3012/health
curl http://localhost:3003/health
```

Una respuesta sana solo significa que el proceso responde por HTTP. No comprueba la persistencia, el anclaje ni el
gossip (el `gossip_peers` de un registro cuenta los pares configurados, estén fijados o no).

<a id="services"></a>

## Servicios

### verification (`:3000`)

Servidor de verificación de Signed Bundles para DCP (V1 + V2 + fase 3). Las dos peticiones de verificación de abajo son
plantillas: `{...}` y `...` representan un bundle firmado real, así que no funcionan tal cual. El ejemplo completo del
final de esta página usa en cambio un fixture de pruebas.

```bash
# V1 verification
curl -X POST http://localhost:3000/verify \
  -H "Content-Type: application/json" \
  -d '{"signed_bundle": {"bundle": {...}, "signature": {...}}, "public_key_b64": "..."}'

# V2 composite verification
curl -X POST http://localhost:3000/v2/bundle/verify \
  -H "Content-Type: application/json" \
  -d '{"signed_bundle": {"bundle": {"dcp_bundle_version":"2.0","manifest":{...},...}, "signature": {"composite_sig":{...},...}}}'

# Capability discovery
curl http://localhost:3000/.well-known/dcp-capabilities.json
```

### anchor (`:3001`)

Servicio de anclaje de hashes de bundles en blockchain. Véase [services/anchor/README.md](../../../services/anchor/README.md).

### transparency-log (`:3002`)

Registro de transparencia de solo anexado con pruebas de inclusión. Véase [services/transparency-log/README.md](../../../services/transparency-log/README.md).

### revocation (`:3003`)

Servicio de publicación y consulta de revocaciones. Véase [services/revocation/README.md](../../../services/revocation/README.md).

<a id="configuration"></a>

## Configuración

<a id="environment-variables"></a>

### Variables de entorno

Cada servicio se configura mediante variables de entorno en `docker-compose.yml`:

#### verification

| Variable | Valor por defecto | Descripción |
|----------|---------|-------------|
| `PORT` | `3000` | Puerto HTTP |
| `VERIFIER_MODE` | `hybrid_required` | Modo de verificación V2 |
| `ALLOW_V1_BUNDLES` | `true` | Acepta bundles en formato V1 |
| `REQUIRE_SESSION_BINDING`, `REQUIRE_COMPOSITE_BINDING`, `MAX_KEY_AGE_DAYS`, `PQ_CHECKPOINT_INTERVAL`, `ADVISORY_POLL_INTERVAL_MS` | definidas en la imagen y aquí | **El servidor todavía no las lee.** Se aplica su política integrada (vinculación de sesión y compuesta obligatorias, antigüedad de clave de 365 días); `GET /v2/policy` la muestra |

Los endpoints de DCP-05 a DCP-09 de la pasarela no necesitan token y no verifican firmas; no publiques el puerto 3000 a clientes que no sean de confianza sin tu propia autorización delante ([docs/OPERATOR_GUIDE.md](../../../docs/OPERATOR_GUIDE.md#dcp-0509-service-endpoints)).

#### anchor

| Variable | Valor por defecto | Descripción |
|----------|---------|-------------|
| `PORT` | `3001` | Puerto HTTP |
| `ANCHOR_MODE` | `batch` | `"individual"` o `"batch"` |
| `BATCH_INTERVAL_MS` | `60000` | Intervalo de vaciado (ms) |
| `ANCHOR_RPC_URL` | — | URL JSON-RPC del nodo L2 |
| `ANCHOR_PRIVATE_KEY` | — | Clave privada del monedero |
| `ANCHOR_CONTRACT` | — | Dirección del contrato DCPAnchor |
| `OPERATOR_TOKEN` | — | Token Bearer para `POST /flush` (se toma del entorno del host) |

El envío on-chain todavía no está implementado, así que los tres ajustes de cadena `ANCHOR_*` no se usan.

#### transparency-log

| Variable | Valor por defecto | Descripción |
|----------|---------|-------------|
| `PORT` | `3002` | Puerto HTTP |
| `LOG_ID` | generado automáticamente | Identificador único de esta instancia del registro |
| `OPERATOR_KEY` | efímera | Semilla Ed25519 de la clave que firma las STH: 64 caracteres hexadecimales (`openssl rand -hex 32`), una por registro. Cualquier otra cosa detiene el servicio |
| `OPERATOR_TOKEN` | — | Token Bearer para `POST /gossip/peers` (se toma del entorno del host) |
| `GOSSIP_PEERS` | — | Pares separados por comas, cada uno `<endpoint>#<base64 Ed25519 public key>` (p. ej., `http://log-b:3002#q1w2...`); se ignoran las cabezas de árbol de los pares sin fijar |
| `GOSSIP_INTERVAL_MS` | `30000` | Intervalo de consulta del gossip, en milisegundos |

Para que los dos registros de Compose hagan gossip, da a cada uno una clave fija y fija la del otro. Ejecuta esto desde
la raíz del repositorio, con las dependencias de la raíz instaladas (usa `tweetnacl` del `node_modules` de la raíz). No
hay ningún archivo compose en la raíz, así que indica este con `-f`:

```bash
export TLOG_ALPHA_OPERATOR_KEY=$(openssl rand -hex 32) TLOG_BETA_OPERATOR_KEY=$(openssl rand -hex 32)
pub() { node -e 'const n = require("tweetnacl"); console.log(Buffer.from(n.sign.keyPair.fromSeed(Buffer.from(process.argv[1], "hex")).publicKey).toString("base64"))' "$1"; }
export TLOG_ALPHA_PUBLIC_KEY=$(pub $TLOG_ALPHA_OPERATOR_KEY) TLOG_BETA_PUBLIC_KEY=$(pub $TLOG_BETA_OPERATOR_KEY)
docker compose -f docker/docker-compose.yml up
```

Los registros guardan su árbol en memoria: una `OPERATOR_KEY` fija mantiene la misma clave de firma entre reinicios,
pero un reinicio sigue empezando un árbol vacío.

#### revocation

| Variable | Valor por defecto | Descripción |
|----------|---------|-------------|
| `PORT` | `3003` | Puerto HTTP |
| `TRUST_PROXY` | — | `true` solo detrás de un proxy que añade la IP del cliente a `X-Forwarded-For` |
| `REVOCATION_STATE_PATH` | solo memoria | Archivo de estado de solo anexado. Este archivo compose define `/data/revocation-state.jsonl` en el volumen `revocation-data` |

Los servicios de verificación y de revocación también leen `OPERATOR_TOKEN`: para los endpoints de administración de la
pasarela y para registrar `agent_id` nuevos en ambos. Desde la raíz del repositorio, ejecuta
`OPERATOR_TOKEN=$(openssl rand -hex 32) docker compose -f docker/docker-compose.yml up` para desbloquearlos; sin él,
responden 401.

Estado: todos los servicios guardan su estado en memoria y empiezan vacíos tras un reinicio o un
`docker compose down`, **salvo revocation**. Aquí sus registros y revocaciones van al volumen `revocation-data`, así que
sobreviven a un reinicio y a `docker compose down`; `docker compose down -v` borra el volumen y, con él, esos datos.

<a id="blockchain-anchoring-is-not-implemented"></a>

### El anclaje en blockchain no está implementado

El servicio de anclaje no envía nada on-chain. Los ajustes `ANCHOR_RPC_URL`, `ANCHOR_PRIVATE_KEY` y `ANCHOR_CONTRACT`
comentados en `docker-compose.yml` no se leen (definir `ANCHOR_RPC_URL` solo registra una advertencia), así que no
pongas ahí ninguna clave de monedero. Los registros se quedan en local, en memoria, con `tx_hash: null` y
`onchain: false`.

## Dockerfile

El `Dockerfile` usa una construcción en varias etapas con objetivos independientes:

```
Base: node:20-alpine
├── verification  → node server/index.js        (port 3000)
├── anchor        → node services/anchor/index.js      (port 3001)
├── transparency-log → node services/transparency-log/index.js (port 3002)
└── revocation    → node services/revocation/index.js  (port 3003)
```

<a id="individual-build"></a>

### Construcción individual

```bash
# Build a specific service (from the repo root: the build context is the repo)
docker build -f docker/Dockerfile --target anchor -t dcp-anchor .

# Run
docker run -p 3001:3001 -e ANCHOR_MODE=batch dcp-anchor
```

<a id="build-all"></a>

### Construir todo

```bash
# from the repo root
docker compose -f docker/docker-compose.yml build
```

<a id="health-checks"></a>

## Comprobaciones de salud

Todos los servicios tienen configuradas comprobaciones de salud:

- **Intervalo:** 30 segundos
- **Tiempo de espera:** 5 segundos
- **Reintentos:** 3
- **Comando:** `wget -qO- http://localhost:PORT/health`
- **Política de reinicio:** `unless-stopped`

Que una comprobación pase solo significa que el proceso responde por HTTP; no es evidencia de persistencia, anclaje,
gossip ni preparación para producción.

<a id="full-example--verify-a-bundle"></a>
<a id="full-example-verify-a-bundle"></a>

## Ejemplo completo — verificar un bundle

```bash
# Run from the repo root: the example files are under tests/.
# 1. Start services
docker compose -f docker/docker-compose.yml up -d

# 2. Verify a signed bundle (note: body must wrap in signed_bundle key)
curl -X POST http://localhost:3000/verify \
  -H "Content-Type: application/json" \
  -d "{\"signed_bundle\": $(cat tests/conformance/examples/citizenship_bundle.signed.json)}"

# 3. Take the bundle_hash the signature carries (computed over the canonical bundle) and anchor it
HASH=$(node -e 'console.log(require("./tests/conformance/examples/citizenship_bundle.signed.json").signature.bundle_hash)')
curl -X POST http://localhost:3001/anchor \
  -H "Content-Type: application/json" \
  -d "{\"bundle_hash\": \"$HASH\"}"

# 4. Add to transparency log (service on port 3002, route is /add)
curl -X POST http://localhost:3002/add \
  -H "Content-Type: application/json" \
  -d "{\"bundle_hash\": \"$HASH\"}"

# 5. Stop
docker compose -f docker/docker-compose.yml down
```

<a id="license"></a>

## Licencia

Apache-2.0
