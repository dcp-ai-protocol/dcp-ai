<sub>[English](../../../../services/transparency-log/README.md) · [中文](../../../zh-CN/services/transparency-log/README.md) · **Español** · [日本語](../../../ja/services/transparency-log/README.md) · [Português](../../../pt-BR/services/transparency-log/README.md)</sub>

<a id="transparency-log-service"></a>

# Servicio de registro de transparencia

> Traducción informativa de [la versión en inglés](../../../../services/transparency-log/README.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Servicio HTTP de registro de transparencia inspirado en Certificate Transparency (CT). Guarda hashes de bundles en un árbol de Merkle RFC 6962 de solo anexado, con pruebas de inclusión verificables y cabezas de árbol firmadas con Ed25519. El estado está en memoria: un reinicio empieza un árbol nuevo y vacío (véase [Persistencia](../../../../services/README.md#persistence)).

<a id="quickstart"></a>

## Inicio rápido

```bash
# Start the service, from the root of a checkout after `npm install` there
node services/transparency-log/index.js

# Or with Docker, from the repo root: the Compose stack runs two logs that gossip with each other
docker compose -f docker/docker-compose.yml up transparency-log-a transparency-log-b
```

El servicio escucha por defecto en `http://localhost:3002`.

## Endpoints

### `GET /health`

Comprobación de salud del servicio.

```bash
curl http://localhost:3002/health
```

```json
{
  "ok": true,
  "service": "dcp-transparency-log",
  "log_id": "log-alpha",
  "public_key": "base64 Ed25519 public key that signs STHs",
  "size": 42,
  "gossip_peers": 1,
  "alerts": 0
}
```

### `POST /add`

Añade un hash de bundle al registro: `sha256:` seguido de 64 caracteres hexadecimales en minúscula. Cualquier otra
cosa, o un cuerpo de más de 1 MB, da un 400.

```bash
curl -X POST http://localhost:3002/add \
  -H "Content-Type: application/json" \
  -d '{"bundle_hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"}'
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

Obtiene la raíz de Merkle actual del registro.

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

Obtiene la cabeza de árbol firmada (Signed Tree Head, STH): una firma Ed25519 (en base64) sobre el JSON canónico (claves
ordenadas, `signObject` en `tools/crypto.js`) de `{ log_id, root, size, timestamp }`.

```bash
curl http://localhost:3002/root/signed
```

```json
{
  "log_id": "log-alpha",
  "root": "d4e5f6...",
  "size": 43,
  "timestamp": "2025-01-01T00:00:00.000Z",
  "signature": "base64...",
  "public_key": "base64..."
}
```

Verifícala contra una clave pública fijada por otro canal (se imprime al arrancar y aparece en `/health`), nunca solo
contra la `public_key` que lleva la STH:

```js
import { verifyObject } from "./tools/crypto.js";
const { log_id, root, size, timestamp, signature } = sth;
verifyObject({ log_id, root, size, timestamp }, signature, pinnedPublicKey); // true
```

`OPERATOR_KEY` es la semilla de 32 bytes de la clave, así que la clave de firma sobrevive a los reinicios; el árbol no,
porque se queda en memoria. Sin ella, el registro firma con una clave efímera nueva tras cada reinicio: las STH
anteriores siguen verificándose con la clave antigua, si la archivaste o la fijaste, pero no con la nueva.

### `GET /proof/:index`

Obtiene la prueba de inclusión de Merkle de una entrada por su índice.

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

La prueba permite verificar que una entrada está incluida en el árbol de Merkle sin descargar el registro entero.

### `GET /entries`

Enumera todas las entradas del registro.

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

### Gossip

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/gossip/peers` | Pares conocidos y las 20 últimas alertas |
| POST | `/gossip/peers` | Añade un par `{ peer_id, endpoint, public_key }` (endpoint http/https, clave Ed25519 en base64). Requiere `Authorization: Bearer <OPERATOR_TOKEN>`: el registro consulta a los pares por sí mismo, así que una lista abierta permitiría SSRF |
| POST | `/gossip/exchange` | Intercambia STH con un par fijado `{ sth }`; devuelve la nuestra y cualquier alerta de vista dividida |
| GET | `/gossip/alerts` | Alertas de vista dividida (las 100 últimas) |

Las cabezas de árbol de un par solo cuentan cuando se verifican con su clave pública **fijada**: indícala como
`<endpoint>#<base64 Ed25519 public key>` en `GOSSIP_PEERS`, o como `public_key` en `POST /gossip/peers`. Se
ignoran las cabezas de árbol consultadas a un par sin clave fijada, las mal formadas y las que tienen una firma
incorrecta. Una consulta lee como máximo 16 KB, desiste tras un intervalo (10 s como máximo) y nunca empieza mientras
la anterior sigue en curso. `/gossip/exchange` está abierto, así que solo acepta una STH bien formada (`root` de 64
hexadecimales o nulo, `size` entero) firmada por un par fijado, en un cuerpo de 16 KB como máximo (si no, 400 o 403).
Las alertas se deduplican por par, tamaño del árbol y raíz, así que reenviar una cabeza de árbol firmada no añade
nada, y solo se conservan las 100 últimas.

<a id="configuration"></a>

## Configuración

<a id="environment-variables"></a>

### Variables de entorno

| Variable | Valor por defecto | Descripción |
|----------|---------|-------------|
| `PORT` | `3002` | Puerto HTTP |
| `LOG_ID` | aleatorio | Identificador de esta instancia del registro |
| `OPERATOR_KEY` | — | Semilla Ed25519 de la clave que firma las STH: 64 caracteres hexadecimales (`openssl rand -hex 32`). Cualquier otro valor detiene el servicio; sin definir, se usa una clave efímera |
| `OPERATOR_TOKEN` | — | Token Bearer para `POST /gossip/peers`. Sin definir: bloqueado |
| `GOSSIP_PEERS` | — | Pares separados por comas, cada uno `<endpoint>#<base64 Ed25519 public key>` (la `public_key` de `/health` del par, fijada por su `OPERATOR_KEY`), consultados cada `GOSSIP_INTERVAL_MS` |
| `GOSSIP_INTERVAL_MS` | `30000` | Intervalo de consulta del gossip |

<a id="ct-style-format"></a>

## Formato al estilo de CT

El registro sigue un formato inspirado en Certificate Transparency (RFC 6962):

1. **Solo anexado:** las entradas nunca se borran ni se modifican
2. **Árbol de Merkle:** RFC 6962 §2.1. `leaf_hash = SHA-256(0x00 || UTF-8(entry.hash))` y los nodos internos son
   `SHA-256(0x01 || left || right)`, así que una hoja nunca puede hacerse pasar por un subárbol. Un árbol de `n` hojas
   se divide en la mayor potencia de dos menor que `n`; el último nodo nunca se duplica.
3. **Pruebas de inclusión:** cualquiera puede verificar con la prueba que una entrada existe en el registro
4. **Raíz firmada:** cabezas de árbol firmadas con Ed25519 (`GET /root/signed`)

<a id="verifying-an-inclusion-proof"></a>

### Verificar una prueba de inclusión

Para verificar que una entrada está en el registro:

1. Obtén la prueba con `GET /proof/:index`
2. Calcula `leaf_hash = SHA-256(0x00 || UTF-8(entry.hash))`
3. Recombina los nodos de la prueba en orden, como bytes en bruto (las cadenas hexadecimales decodificadas):
   - Si `direction == "left"`: `hash = SHA-256(0x01 || proof_hash || current)`
   - Si `direction == "right"`: `hash = SHA-256(0x01 || current || proof_hash)`
4. El resultado final debe ser igual a la `root` de una cabeza de árbol firmada que se verifique con la clave pública
   fijada del registro y que cubra el árbol a partir del cual se construyó la prueba (el mismo tamaño). La `root` de la
   respuesta de la prueba es, por sí sola, una autodeclaración, y una raíz más reciente deja de coincidir en cuanto se
   añaden entradas

<a id="development"></a>

## Desarrollo

```bash
# Start in development mode, from the root of a checkout
PORT=3002 node services/transparency-log/index.js

# Test
curl http://localhost:3002/health
curl -X POST http://localhost:3002/add \
  -H "Content-Type: application/json" \
  -d '{"bundle_hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"}'
curl http://localhost:3002/root
curl http://localhost:3002/proof/0
```

<a id="license"></a>

## Licencia

Apache-2.0
