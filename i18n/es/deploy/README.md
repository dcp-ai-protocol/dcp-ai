<sub>[English](../../../deploy/README.md) · [中文](../../zh-CN/deploy/README.md) · **Español** · [日本語](../../ja/deploy/README.md) · [Português](../../pt-BR/deploy/README.md)</sub>

<a id="deploying-dcp-ai-services"></a>

# Desplegar los servicios de DCP-AI

> Traducción informativa de [la versión en inglés](../../../deploy/README.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Los cuatro servicios que incluye este repositorio —**verification**, **anchor**,
**transparency-log**, **revocation**— se distribuyen como imágenes Docker
precompiladas en GitHub Container Registry (GHCR). Puedes ejecutarlas en
cualquier host de contenedores. Abajo están los flujos más habituales.

<a id="images"></a>

## Imágenes

| Servicio | Imagen | Puerto por defecto |
|---|---|---|
| Verificación | `ghcr.io/dcp-ai-protocol/dcp-ai/verification` | 3000 |
| Anclaje | `ghcr.io/dcp-ai-protocol/dcp-ai/anchor` | 3001 |
| Registro de transparencia | `ghcr.io/dcp-ai-protocol/dcp-ai/transparency-log` | 3002 |
| Revocación | `ghcr.io/dcp-ai-protocol/dcp-ai/revocation` | 3003 |

Etiquetas (véase [`publish-docker.yml`](../../../.github/workflows/publish-docker.yml)): un push a `main` que dispara el
flujo publica `:latest`, `:main` y `:sha-xxxxxxx`; una versión publicada añade sus etiquetas semver
(`:<major>.<minor>.<patch>`, `:<major>.<minor>`, `:<major>`) y también puede mover `:latest`, que es mutable. Se
construyen tanto `linux/amd64` como `linux/arm64`.

Prueba rápida en tu portátil:

```bash
docker run --rm -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest
# in a second terminal, while the container runs in the foreground
curl http://localhost:3000/health
```

`/health` solo muestra que el proceso responde por HTTP. No dice nada de la persistencia, el anclaje, el gossip ni la
preparación para producción.

---

<a id="option-1--docker-compose-self-host-simplest"></a>
<a id="option-1-docker-compose-self-host-simplest"></a>

## Opción 1 — Docker Compose (autoalojado, lo más sencillo)

El repositorio incluye un archivo compose listo para usar que conecta los cuatro servicios en cinco contenedores, con
dos registros de transparencia. Los registros solo hacen gossip cuando cada uno tiene una `OPERATOR_KEY` fija y la
clave pública del otro fijada (véase [`docker/README.md`](../../../docker/README.md)); sin eso, cada uno consulta al otro e
ignora sus cabezas de árbol:

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai
cd dcp-ai/docker
docker compose up -d
```

Los servicios exponen:

- `http://localhost:3000` — verificación
- `http://localhost:3001` — anclaje
- `http://localhost:3002` — registro de transparencia (log-alpha)
- `http://localhost:3012` — registro de transparencia (log-beta, par de gossip)
- `http://localhost:3003` — revocación

Para usar las imágenes publicadas en GHCR en lugar de compilar desde el código fuente, edita
`docker/docker-compose.yml` y sustituye cada bloque `build:` por una línea `image:`, por ejemplo:

```yaml
services:
  verification:
    image: ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest
```

---

<a id="option-2--flyio-managed"></a>
<a id="option-2-flyio-managed"></a>

## Opción 2 — Fly.io (gestionado)

```bash
# one-time setup
brew install flyctl
fly auth login
cd deploy/fly
```

Despliega cada servicio (los `.toml` de este directorio ya están configurados para descargar de GHCR, sin compilar el código fuente):

```bash
fly launch --config verification.toml    --no-deploy
# admin endpoints and registering new agent_ids
fly secrets set --app dcp-ai-verification OPERATOR_TOKEN="$(openssl rand -hex 32)"
fly deploy --config verification.toml

fly launch --config anchor.toml          --no-deploy
# on-chain submission is not implemented: no RPC URL, wallet key or contract is read
fly secrets set --app dcp-ai-anchor OPERATOR_TOKEN="$(openssl rand -hex 32)"   # unlocks POST /flush
fly deploy --config anchor.toml

fly launch --config transparency-log.toml --no-deploy
fly secrets set --app dcp-ai-transparency-log \
  OPERATOR_KEY="$(openssl rand -hex 32)" \
  GOSSIP_PEERS="https://<your-second-log>.fly.dev#<its /health public_key>"
fly deploy --config transparency-log.toml

fly launch --config revocation.toml      --no-deploy
fly deploy --config revocation.toml
```

Cada servicio obtiene una URL HTTPS pública como `https://dcp-ai-verification.fly.dev`. En la aplicación de verificación, eso también hace públicos sus endpoints de DCP-05 a DCP-09, que no necesitan token y no verifican firmas (véanse las notas de operación).

Un par de gossip sin su `#<public key>` se consulta, pero sus cabezas de árbol se ignoran.

El estado está en memoria. Las configuraciones de verificación, revocación y registro de transparencia mantienen una
máquina en marcha para que la inactividad no borre sus registros; un despliegue o un reinicio sigue empezándolos
vacíos. La configuración del anclaje deja que su máquina se detenga (`min_machines_running = 0`), lo que descarta sus
hashes pendientes y sus registros locales. Solo el servicio de revocación puede conservar su estado entre reinicios:
pon `REVOCATION_STATE_PATH` en un volumen, como muestra el comentario de `revocation.toml`. El registro de
transparencia no tiene opción de persistencia.
Define también `OPERATOR_TOKEN` en la aplicación de revocación, porque registrar un `agent_id` nuevo allí lo necesita,
y en las aplicaciones de anclaje y de registro de transparencia si necesitas `POST /flush` o `POST /gossip/peers`.

Para producción conviene tener **dos** instancias del registro de transparencia en regiones distintas, cada una con su propia `OPERATOR_KEY` y apuntando a la otra mediante `GOSSIP_PEERS` con la clave pública de la otra fijada. El gossip compara sus cabezas de árbol firmadas y emite una alerta cuando dos cabezas del mismo tamaño tienen raíces distintas (DCP-03 §4). Eso solo revela una vista dividida si ambos registros deben contener las mismas entradas en el mismo orden: los registros no se replican las entradas entre sí, así que dos registros que recibieron legítimamente entradas distintas también generan alertas, y las cabezas de tamaños distintos no se comparan (no hay prueba de consistencia).

---

<a id="option-3--google-cloud-run-pay-per-request"></a>
<a id="option-3-google-cloud-run-pay-per-request"></a>

## Opción 3 — Google Cloud Run (pago por petición)

```bash
gcloud run deploy dcp-ai-verification \
  --image ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest \
  --port 3000 \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars="DCP_VERSION=2.0,VERIFIER_MODE=hybrid_required"
```

Repite para cada servicio. Cloud Run escala a cero cuando no hay actividad, y estos servicios guardan su estado en
memoria: una instancia que escala a cero o se reinicia empieza vacía (véanse las notas de operación).

---

<a id="option-4--railway-one-click-credit-card-required-for-deploy"></a>
<a id="option-4-railway-one-click-credit-card-required-for-deploy"></a>

## Opción 4 — Railway (un clic, requiere tarjeta de crédito para desplegar)

Crea un proyecto nuevo a partir de una imagen Docker. Para cada servicio, pega la URL de la imagen de GHCR y define las variables de entorno del `deploy/fly/*.toml` correspondiente.

---

<a id="operating-notes"></a>

## Notas de operación

- **Anclaje**: el envío on-chain no está implementado. Desplegar `contracts/ethereum/src/DCPAnchor.sol` y definir `ANCHOR_CONTRACT` no lo activa: `ANCHOR_RPC_URL`, `ANCHOR_PRIVATE_KEY` y `ANCHOR_CONTRACT` no se leen (definir `ANCHOR_RPC_URL` solo registra una advertencia), así que no le des al servicio ninguna clave de monedero. Guarda registros locales en memoria con `tx_hash: null` y `onchain: false`.
- **Registro de transparencia**: solo en memoria, sin opción de persistencia: un reinicio empieza un árbol nuevo y vacío, y un volumen no cambia eso. Una `OPERATOR_KEY` fija mantiene la misma clave de firma entre reinicios.
- **Revocación**: el registro solo es autoritativo si todos los verificadores de tu política apuntan a *esta* URL. Publica la URL en tu `.well-known/dcp-capabilities.json`. Sin `REVOCATION_STATE_PATH` en un almacenamiento persistente, un reinicio olvida todos los registros y revocaciones.
- **Verificación**: no es sin estado. Guarda pasaportes, claves, cadenas de auditoría y los registros de DCP-05–09 en memoria, y las instancias separadas no los comparten, así que varias instancias detrás de un balanceador de carga responderían de forma distinta. Ejecuta una sola instancia.
- **Verificación, endpoints de DCP-05 a DCP-09**: no necesitan token y no verifican firmas, y `OPERATOR_TOKEN` no los protege, así que cualquiera que llegue a un despliegue público (Fly, o Cloud Run con `--allow-unauthenticated`) puede cambiar el estado del ciclo de vida, de las disputas y de los mandatos. Pon tu propia autorización delante de ellos, o no los enrutes ([docs/OPERATOR_GUIDE.md](../../../docs/OPERATOR_GUIDE.md#dcp-0509-service-endpoints)).

---

## CI/CD

El flujo [`publish-docker.yml`](../../../.github/workflows/publish-docker.yml) del repositorio vuelve a construir y a subir estas imágenes en cada versión publicada, al lanzarlo manualmente y en cada push a `main` que toque `server/`, `services/`, `lib/`, `tools/`, `schemas/`, `docker/Dockerfile` o el propio flujo. Las imágenes también compilan el SDK del workspace (`sdks/typescript/`), pero un push que solo cambia el SDK no dispara una reconstrucción.

Antes de desplegar, rastrea el digest de la imagen que vas a ejecutar hasta una ejecución correcta del flujo de publicación para el commit elegido. `:latest` es mutable y no garantiza esa revisión. Si no existe imagen para el commit elegido, constrúyela desde ese checkout (`docker build -f docker/Dockerfile --target <service> .`, desde la raíz del repositorio).
