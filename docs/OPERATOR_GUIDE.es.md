<sub>[English](OPERATOR_GUIDE.md) · [中文](OPERATOR_GUIDE.zh-CN.md) · **Español** · [日本語](OPERATOR_GUIDE.ja.md) · [Português](OPERATOR_GUIDE.pt-BR.md)</sub>

<a id="operator-guide--running-a-verification-service"></a>
<a id="operator-guide-running-a-verification-service"></a>

# Guía del operador — ejecutar un servicio de verificación

**Publicación Rust (26/10/2026).** Rust `dcp-ai` 2.11.0 está publicado en crates.io, incluidas las correcciones del verificador, admisión y API experimentales opt-in. `dcp-jcs-v1` sigue siendo el perfil normativo predeterminado. Véase [Rust 2.11.0](RUST_RELEASE.md).

**Publicación Go (26/10/2026).** El SDK Go `v2.11.0` está disponible desde la etiqueta `sdks/go/v2.11.0`, incluidas las correcciones del verificador, admisión y API experimentales opt-in. La publicación Rust sigue siendo independiente. Véase [Go v2.11.0](GO_RELEASE.md).

> Traducción informativa de [la versión en inglés](OPERATOR_GUIDE.md), actualizada el 26/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Esta guía es para **terceros** que quieran ejecutar un servicio de «agente verificado»: una API HTTP que verifica Signed Bundles de DCP (y, opcionalmente, ancla hashes en una blockchain). El protocolo **no** exige ningún servidor central; la verificación siempre puede hacerse localmente con `dcp verify-bundle`. Este servicio es **opcional** y lo ejecuta quien opere a su elección.

<a id="what-is-an-agent-verified-service"></a>

## ¿Qué es un servicio de «agente verificado»?

Un **servicio de verificación de agentes** es una API HTTP que:

1. **Verifica** un Signed Bundle: ejecuta la misma lista de comprobación normativa que [spec/VERIFICATION.md](../spec/VERIFICATION.md) (validación de esquema, firma, intent_hash, cadena de auditoría, merkle_root opcional).
2. Opcionalmente **comprueba** un `anchor_receipt` contra una blockchain pública o un registro de transparencia (usando solo datos públicos).
3. Opcionalmente **ancla** un `bundle_hash` en una cadena existente y devuelve un `anchor_receipt` al cliente.

El servicio **no tiene estado**: cada solicitud recibe un bundle (y opcionalmente una clave pública), lo verifica y devuelve un resultado. No hay un registro central de agentes; el protocolo no define una URL canónica (p. ej., no hay ningún endpoint «dcp.ai» obligatorio).

`verified: true` significa que el bundle está intacto y firmado por las claves que nombra. No dice quién es el principal ni si debes actuar según el bundle: aceptar bundles solo de principales en los que confías es la admisión, un paso aparte (`POST /v2/admit` en el servidor de referencia, véase [ADMISSION.md](ADMISSION.md), sin publicar).

<a id="who-runs-it"></a>

## ¿Quién lo ejecuta?

**Terceros.** Cualquiera puede desplegar este servicio con este repositorio (esquemas + especificación + CLI o API programática). El autor del protocolo no opera ningún servidor central de verificación.

<a id="requirements"></a>

## Requisitos

- Una copia de este repositorio: esquemas en `schemas/v1/` y `schemas/v2/`, especificación en `spec/`, y la CLI de referencia y la
  biblioteca de verificación del paquete raíz, que no está publicado en npm.
- Capacidad de ejecutar la verificación: la CLI (`dcp verify-bundle [--policy <mode>] <signed.json> [public_key.txt]`) o la API programática del repositorio: `verifySignedBundle` (asíncrona) y `validateBundle` en `lib/verify.js`. Allí los bundles V2 se validan contra el esquema y después los verifica `@dcp-ai/sdk`.
- Opcional, para el anclaje: acceso RPC o a un explorador de bloques de una cadena existente (Bitcoin, Ethereum o un registro de transparencia). Véase [STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md).

<a id="suggested-api-contract"></a>

## Contrato de API sugerido

Para que clientes y operadores puedan interoperar, esta sección sugiere un contrato mínimo. Las implementaciones pueden ampliarlo.

### POST /verify

Verifica un Signed Bundle según la lista de comprobación normativa (esquema, firma, intent_hash, cadena de auditoría, merkle opcional).

- **Solicitud (JSON):**
  - `signed_bundle` (objeto): el Signed Bundle que se va a verificar.
  - `public_key_b64` (cadena, opcional): en V1, la clave pública del firmante cuando el bundle no la incluye; si no, se usa `signature.signer.public_key_b64` del bundle. En V2, fija el firmante clásico (se rechaza en el modo `pq_only`).

- **Respuesta (JSON):**
  - `verified` (booleano): `true` si todas las comprobaciones pasan.
  - `errors` (array de cadenas, opcional): si `verified` es `false`, mensajes de error legibles.

Ejemplo:

```json
// Request
{ "signed_bundle": { "bundle": { ... }, "signature": { ... } } }

// Response (success)
{ "verified": true }

// Response (failure)
{ "verified": false, "errors": ["SIGNATURE INVALID", "Hint: Check that the public key ..."] }
```

El servidor de referencia (`server/`) lo implementa como `POST /verify`. Su respuesta siempre lleva `dcp_version` y `errors`; en V2 añade `warnings`, `verifier_policy_hash` y `resolved_tier`. Los cuerpos de las solicitudes son JSON.

<a id="post-anchor-optional"></a>

### POST /anchor (opcional)

Ancla un `bundle_hash` en una cadena y devuelve un `anchor_receipt`. El operador configura la cadena y las credenciales (p. ej., monedero, URL de RPC). Véase [STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md) para el formato del recibo.

- **Solicitud (JSON):**
  - `bundle_hash` (cadena): p. ej., `sha256:<hex>`.
  - `chain` (cadena): p. ej., `"bitcoin"`, `"ethereum"`.

- **Respuesta (JSON):**
  - `anchor_receipt` (objeto): p. ej., `{ "chain": "bitcoin", "tx_id": "...", "block_height": N }` o campos al estilo de Ethereum.

La implementación de `/anchor` depende de la cadena y las herramientas del operador (OP_RETURN de Bitcoin, evento de contrato de Ethereum, etc.). El servicio de anclaje de referencia (`services/anchor`) todavía no la implementa: registra los hashes localmente, en memoria, con `tx_hash: null` y `onchain: false`, y no devuelve ningún `anchor_receipt`. El servidor de verificación de referencia responde a `POST /anchor` con 501.

<a id="deployment"></a>

## Despliegue

El servidor de verificación de referencia, el servicio de anclaje, el registro de transparencia y el registro de revocaciones se **publican como imágenes Docker** en GitHub Container Registry. En la mayoría de los casos no necesitas clonar el repositorio: basta con `docker run`.

<a id="option-1--pull-the-reference-image-fastest"></a>
<a id="option-1-pull-the-reference-image-fastest"></a>

### Opción 1 — descargar la imagen de referencia (lo más rápido)

```bash
docker run -d -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest
curl http://localhost:3000/health
```

Multiarquitectura (`linux/amd64` + `linux/arm64`). Etiquetas: `:latest`, las etiquetas semver de cada versión (`:<major>.<minor>.<patch>`, `:<major>.<minor>`, `:<major>`) y `:sha-<short>`. La pila completa (verificación + anclaje + dos registros de transparencia + revocación, cinco contenedores) puede levantarse con un solo `docker compose up -d` ejecutado en `docker/`, o con `docker compose -f docker/docker-compose.yml up -d` desde la raíz del repositorio.

<a id="option-2--managed-paas"></a>
<a id="option-2-managed-paas"></a>

### Opción 2 — PaaS gestionado

Hay configuraciones listas para Fly.io en [`deploy/fly/`](../deploy/fly/); la [guía de despliegue](../deploy/README.md) también cubre patrones para Google Cloud Run y Railway.

<a id="option-3--embed-the-verifier-in-your-own-service"></a>
<a id="option-3-embed-the-verifier-in-your-own-service"></a>

### Opción 3 — integrar el verificador en tu propio servicio

Si quieres la verificación dentro de tu aplicación actual (sin un servicio HTTP aparte), instala el SDK de tu lenguaje y llama directamente a su verificador (`verifySignedBundleV2` en TypeScript, `verify_signed_bundle_v2` en Python y Rust, `v2.VerifySignedBundleV2` en Go). Estos comandos instalan las versiones publicadas:

```bash
npm install @dcp-ai/sdk        # TypeScript / Node.js
pip install dcp-ai             # Python
cargo add dcp-ai@2.11.0
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.11.0
```

Consulta el README de cada SDK para la ruta de importación exacta y la superficie de la API, y su *Release status* para lo que le falta a la versión publicada. En `main`, los SDK de TypeScript, Python, Go y Rust verifican de forma nativa bundles V1 y V2, y `@dcp-ai/wasm` expone el verificador V2 de Rust. Sus verificadores V2 siguen la lista de comprobación de [VERIFICATION.md](../spec/VERIFICATION.md), incluida la firma de cada artefacto (paso V2-8) y los checkpoints PQ (paso V2-12), con una carencia: comprueban la cadena de auditoría primaria y la raíz de Merkle, pero no recalculan la cadena secundaria opcional ni `audit_merkle_root_secondary` (paso V2-11; véase [STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md#dual-hash-chains)).

<a id="stateless-by-design"></a>

### Sin estado por diseño

- **No hace falta base de datos** para la verificación: cada solicitud es autónoma.
- **La persistencia** hace falta para todo lo demás: los registros de pasaportes y claves de la pasarela, la cola de anclaje, el registro de transparencia y el registro de revocaciones.

<a id="reference-services-keep-state-in-memory-only"></a>

### Los servicios de referencia guardan el estado solo en memoria

La pasarela de referencia (`server/`) y los servicios (`services/`) no tienen almacén persistente, salvo que el servicio de revocación puede guardar su estado en un archivo (`REVOCATION_STATE_PATH`: desactivado por defecto en el servicio, activado en el archivo compose de `docker/`, que lo pone en un volumen). **Un reinicio, un despliegue o una caída borran su estado**, incluida una caída por quedarse sin memoria. Ese estado es:

- los pasaportes, claves y tokens de emergencia registrados;
- las revocaciones;
- el registro de transparencia;
- los anclajes pendientes y los registros locales de anclaje.

La única excepción es el servicio de revocación con `REVOCATION_STATE_PATH` en almacenamiento persistente (un volumen): sus registros y revocaciones sobreviven a un reinicio.

Tras un borrado, lo registrado desaparece, pero los controles se mantienen:

- **Registro.** Registrar un `agent_id` sigue necesitando el token del operador, también para un `agent_id` registrado antes del borrado, porque todos vuelven a ser nuevos.
- **Consultas de revocación.** El servicio de revocación deja de conocer las revocaciones que registró:
  - `GET /check/<agent_id>` responde `revoked: false` para un agente revocado antes del borrado;
  - `/.well-known/dcp-revocations.json` deja de incluirlo, así que una fuente de revocación basada en lista de denegación lo interpreta como no revocado;
  - `GET /v2/check/kid/<kid>` responde 404 (estado desconocido) para sus claves.
- **La pasarela** olvida sus pasaportes, claves (incluidas las revocadas y retiradas) y tokens de emergencia.
- **No se gana confianza.** Un borrado por sí solo no hace que un principal sea de confianza ni que un bundle sea admitido: la admisión sigue necesitando el conjunto de confianza del operador y, con strict-v1, una instantánea de revocación.

Añade almacenamiento persistente antes de confiar en estos servicios en producción.

Para mantener la memoria acotada, los registros de identidades, claves y revocaciones rechazan trabajo en lugar de desalojar estado:

| Servicio | Límite | Ajuste |
|---------|-------|---------|
| Pasarela | Registrar un `agent_id` nuevo necesita el token del operador (401) | `OPERATOR_TOKEN` |
| Pasarela | 20 registros de pasaportes por cliente y hora (429) | `REGISTRATIONS_PER_HOUR` |
| Pasarela | 10.000 claves registradas; a partir de ahí los agentes nuevos reciben 507 (una rotación elimina antes una clave retirada, así que sigue cabiendo) | `MAX_REGISTERED_KEYS` |
| Pasarela | 4 claves rotadas conservadas por agente; las más antiguas siguen revocadas como lápidas | — |
| Pasarela | 64 claves por agente a lo largo de su vida; las rotaciones posteriores reciben 409 (súbelo para agentes que rotan a menudo) | `MAX_KEYS_PER_AGENT` |
| Pasarela | 100 solicitudes POST por cliente y minuto, 5 revocaciones de emergencia por minuto | — |
| Revocación | Registrar un `agent_id` nuevo necesita el token del operador (401) | `OPERATOR_TOKEN` |
| Revocación | 20 registros por cliente y hora (429) | `REGISTRATIONS_PER_HOUR` |
| Revocación | 10.000 agentes registrados; a partir de ahí los nuevos reciben 507 | `MAX_AGENTS` |
| Revocación | Campos de texto de 256 caracteres como máximo; 5 revocaciones de emergencia por cliente y minuto | — |
| Registro de transparencia | Los intercambios de gossip necesitan una cabeza de árbol firmada por un par fijado (`GOSSIP_PEERS=<url>#<key>`); cuerpos de 16 KB; las últimas 100 alertas distintas; los sondeos leen 16 KB como máximo, agotan el tiempo tras un intervalo y nunca se solapan | `GOSSIP_PEERS` |
| Endpoints que leen un cuerpo | Cuerpos de solicitud de 1 MB (413); `POST /v2/disputes/:id/escalate` y `POST /v2/delegation/mandate/:id/revoke` no leen el suyo | — |

Dos partes de la pasarela se comportan de otra manera:

- **Los almacenes de registros de DCP-05–09 desalojan.** Son los almacenes de ciclo de vida, vitalidad, testamentos, sucesión, disputas, jurisprudencia, objeciones, derechos, obligaciones, vulneraciones, mandatos, declaraciones de asesoramiento, espejos, interacciones y umbrales de atención. Cada uno guarda como máximo 10.000 entradas, y 10.000 por agente en sus listas por agente, y desaloja las más antiguas (FIFO): un registro desalojado desaparece, sin error.
- **Las cadenas de auditoría no tienen límite propio** (`POST /v2/audit/append`). Solo se les aplican los límites de las solicitudes.

Los límites cuentan por IP de cliente. Detrás de un proxy que añade la IP del cliente a `X-Forwarded-For`, define `TRUST_PROXY=true`; si no, todos los clientes comparten la dirección del proxy.

<a id="environment-variables-verification-service"></a>

### Variables de entorno (servicio de verificación)

- `PORT` — puerto HTTP (por defecto `3000`)
- `OPERATOR_TOKEN` — token bearer para los endpoints de administración (política, avisos, gobernanza) y para registrar `agent_id` nuevos; si no se define, siguen bloqueados
- `VERIFIER_MODE` — `classical_only` | `hybrid_preferred` | `hybrid_required` | `pq_only`
- `ALLOW_V1_BUNDLES` — `false` rechaza los bundles V1
- `TRUST_PROXY`, `REGISTRATIONS_PER_HOUR`, `MAX_REGISTERED_KEYS`, `MAX_KEYS_PER_AGENT` — véase arriba
- `DCP_TRUSTED_PRINCIPALS_FILE`, `DCP_ADMISSION_PROFILE_FILE`, `DCP_REVOCATION_LIST_URL`, `DCP_REVOCATION_LIST_AUTHORIZATION`, `DCP_REVOCATION_TIMEOUT_MS` — admisión para `POST /v2/admit`, véase [ADMISSION.md](ADMISSION.md)
- `REQUIRE_SESSION_BINDING`, `REQUIRE_COMPOSITE_BINDING`, `MAX_KEY_AGE_DAYS` y `PQ_CHECKPOINT_INTERVAL` aparecen en las configuraciones de despliegue, pero todavía no se leen

Para las variables de entorno de `anchor`, `transparency-log` y `revocation`, véanse sus respectivos README en [`services/`](../services/) o el `fly.toml` de cada servicio en [`deploy/fly/`](../deploy/fly/).

<a id="blockchain-and-verification"></a>

## Blockchain y verificación

- **Solo verificación:** el servicio puede limitarse a POST `/verify`, aplicando la lista de comprobación de [VERIFICATION.md](../spec/VERIFICATION.md) (esquema, firma, intent_hash, cadena de auditoría, merkle; los verificadores de los SDK todavía no recalculan la cadena secundaria opcional). No hace falta blockchain.
- **Verificar anchor_receipt:** si el cliente envía un `anchor_receipt` con el bundle, el servicio puede comprobar opcionalmente que `bundle_hash` aparece en la cadena o en el índice del registro indicados usando **solo datos públicos** (p. ej., obteniendo la transacción de un explorador de bloques). No interviene ningún servidor central del protocolo.
- **Anclar (escritura):** el operador ejecuta un nodo o usa RPC y escribe hashes en una cadena existente; el servicio devuelve `anchor_receipt` al cliente. Es opcional y específico de cada operador, y el servicio de anclaje de referencia todavía no lo hace (véase [`services/anchor/README.md`](../services/anchor/README.md)).

---

<a id="v20-verification-service"></a>

## Servicio de verificación V2.0

DCP v2.0 introduce criptografía híbrida poscuántica, niveles de seguridad adaptativos y firmas compuestas. Los operadores que ejecutan servicios de verificación deben actualizar su configuración para admitir V2.

<a id="verifier-policy-configuration"></a>

### Configuración de la política del verificador

Los verificadores toman una `VerifierPolicy` ([`schemas/v2/verifier_policy.schema.json`](../schemas/v2/verifier_policy.schema.json)). El servidor de referencia arranca con esta:

```json
{
  "default_mode": "hybrid_required",
  "risk_overrides": { "high": "hybrid_required", "medium": "hybrid_required", "low": "hybrid_required" },
  "min_classical": 1,
  "min_pq": 1,
  "accepted_classical_algs": ["ed25519"],
  "accepted_pq_algs": ["ml-dsa-65", "slh-dsa-192f"],
  "accepted_hash_algs": ["sha256", "sha384"],
  "require_session_binding": true,
  "require_composite_binding": true,
  "max_key_age_days": 365,
  "allow_v1_bundles": true,
  "allow_classical_fallback_disable": false,
  "warn_classical_only_deprecated": false,
  "advisory_rejected_algs": []
}
```

`risk_overrides` se indexa por el `risk_tier` del pasaporte. El servidor no tiene archivo de política: `VERIFIER_MODE` y `ALLOW_V1_BUNDLES` la fijan al arrancar, `POST /v2/policy/mode` con `{ "mode": "<mode>" }` (token del operador) cambia el modo en tiempo de ejecución, los avisos aceptados se añaden a `advisory_rejected_algs` y `GET /v2/policy` devuelve la política actual y su hash. Un cambio de modo fija `default_mode` y todas las entradas de `risk_overrides` a ese modo. Para integrar un verificador con tu propia política, pasa una política completa al SDK: se acepta una parcial, pero los campos que omitas no se rellenan con valores por defecto (véase [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md), paso 8).

Modos de verificación:
- `classical_only` — Solo se exigen firmas Ed25519 (compatibilidad con V1)
- `hybrid_preferred` — Se exige Ed25519, y ML-DSA-65 se comprueba si está presente
- `hybrid_required` — Se exige la firma compuesta con Ed25519 y ML-DSA-65
- `pq_only` — Solo se exige y comprueba la firma poscuántica; un bundle firmado `classical_only` se rechaza, y una clave clásica fijada (`public_key_b64`) se rechaza. En el servidor de referencia, este modo también desactiva los bundles V1.

En todos los modos, una firma PQ (ML-DSA-65 o SLH-DSA-192f) presente debe verificarse; una inválida se rechaza.

### POST /verify (V2)

Los bundles V2 incluyen `composite_sig` con los componentes clásico y poscuántico:

```json
{
  "signed_bundle": {
    "bundle": {
      "dcp_bundle_version": "2.0",
      "manifest": {
        "session_nonce": "a1b2c3...",
        "rpr_hash": "sha256:...",
        "passport_hash": "sha256:...",
        "intent_hash": "sha256:...",
        "policy_hash": "sha256:...",
        "audit_merkle_root": "sha256:...",
        "audit_merkle_root_secondary": "sha3-256:...",
        "audit_count": 1
      },
      "responsible_principal_record": { "payload": {...}, "payload_hash": "sha256:...", "composite_sig": {...} },
      "agent_passport": { "payload": {...}, "payload_hash": "sha256:...", "composite_sig": {...} },
      "intent": { "payload": {...}, "payload_hash": "sha256:...", "composite_sig": {...} },
      "policy_decision": { "payload": {...}, "payload_hash": "sha256:...", "composite_sig": {...} },
      "audit_entries": [ {...} ]
    },
    "signature": {
      "composite_sig": {
        "classical": { "alg": "ed25519", "kid": "...", "sig_b64": "..." },
        "pq": { "alg": "ml-dsa-65", "kid": "...", "sig_b64": "..." },
        "binding": "pq_over_classical"
      }
    }
  }
}
```

La respuesta V2 del servidor de referencia incluye el nivel de seguridad resuelto. `POST /v2/bundle/verify` (solo V2; también acepta el bundle firmado como cuerpo completo) responde:

```json
{
  "verified": true,
  "dcp_version": "2.0",
  "errors": [],
  "warnings": [],
  "verifier_policy_hash": "sha256:...",
  "resolved_tier": "elevated",
  "verification_mode": "hybrid_required",
  "session_binding_valid": true,
  "manifest_valid": true
}
```

`POST /verify` da los mismos campos hasta `resolved_tier`. `session_binding_valid` y `manifest_valid` se deducen de los mensajes de error, así que usa `verified` y `errors` para decidir.

<a id="security-tiers-in-verification"></a>

### Niveles de seguridad en la verificación

Cada nivel de seguridad se corresponde con un modo de verificación y un intervalo de checkpoints PQ (spec §14.1):

| Nivel | Modo de verificación | Checkpoint PQ |
|------|------------------|---------------|
| Routine | `classical_only` | Cada 50 eventos |
| Standard | `hybrid_preferred` | Cada 10 eventos |
| Elevated | `hybrid_required` | Cada evento |
| Maximum | `hybrid_required` | Cada evento |

No hay un presupuesto de tamaño por nivel. El tamaño de un bundle depende de sus algoritmos, de sus entradas de auditoría y checkpoints PQ
y de su codificación JSON: mide tus bundles más grandes. Por ejemplo, el bundle híbrido sintético
`signed_bundles.base` de `tests/interop/v2/admission_vectors.json` ocupa 32.996 bytes como JSON compacto; es una
observación, no un límite. Envía los bundles en un cuerpo de solicitud JSON con un presupuesto de tamaño explícito, no en una cabecera (véase
[QUICKSTART_EXPRESS.md](QUICKSTART_EXPRESS.md#sending-dcp-bundles-from-a-client)).

El verificador puede **subir** un nivel (p. ej., forzar `elevated` en operaciones financieras), pero NO DEBE **bajarlo**. En `main`, los verificadores de los SDK (TypeScript, Go, Rust, WASM y Python) comprueban la firma del bundle y la de cada artefacto según el más estricto entre el modo de la política (la entrada de `risk_overrides` para el `risk_tier` del pasaporte, o `default_mode`) y el modo del nivel (spec §14.3), así que un pasaporte que declara `risk_tier: "low"` sigue necesitando una firma híbrida para una intención de pago. También comprueban los checkpoints PQ que lleva el bundle (`spec/VERIFICATION.md` V2-12). Las versiones publicadas pueden ir por detrás: véase el *Release status* de cada SDK.

El servidor de referencia verifica los bundles V2 mediante `lib/verify.js`, que los entrega al SDK de TypeScript de la misma copia con la política del servidor; las imágenes Docker compilan ese SDK desde el código fuente (véase [`docker/Dockerfile`](../docker/Dockerfile)). Su campo `verification_mode` es el modo del nivel, no el modo efectivo.

<a id="capabilities-endpoint-v2"></a>

### Endpoint de capacidades (V2)

Los servicios V2 exponen `GET /.well-known/dcp-capabilities.json`. El servidor de referencia responde:

```json
{
  "supported_versions": ["1.0", "2.0"],
  "supported_algs": {
    "signing": ["ed25519", "ml-dsa-65", "slh-dsa-192f"],
    "kem": ["x25519", "ml-kem-768", "x25519-ml-kem-768"],
    "hash": ["sha256", "sha3-256", "sha384"]
  },
  "supported_wire_formats": ["application/json", "application/cbor"],
  "features": {
    "composite_signatures": true,
    "session_binding": true,
    "blinded_rpr": true,
    "dual_hash_chains": true,
    "pq_checkpoints": true,
    "emergency_revocation": true,
    "multi_party_auth": true,
    "pq_only_mode": true,
    "advisory_auto_response": true,
    "governance_keys": true,
    "hsm_provider": true,
    "agent_lifecycle": true,
    "succession": true,
    "dispute_resolution": true,
    "rights_obligations": true,
    "delegation": true
  },
  "verifier_policy_hash": "sha256:...",
  "min_accepted_version": "1.0"
}
```

Esto es lo que el servidor anuncia, no una lista de garantías comprobadas. Sus endpoints solo leen cuerpos JSON, aunque se enumera `application/cbor`. Se anuncia `hsm_provider: true`, pero el proveedor HSM del repositorio es una simulación sin respaldo de hardware ([SECURITY_MODEL.md](SECURITY_MODEL.md)).

<a id="observability"></a>

### Observabilidad

Los servicios V2 deberían exponer métricas para su supervisión:

- **Latencia**: latencia de verificación p50/p95/p99 por nivel de seguridad
- **Rendimiento**: bundles verificados por segundo
- **Caché**: proporción de aciertos y fallos de la caché de verificación
- **Checkpoints PQ**: número de checkpoints PQ verificados
- **Errores**: recuento de errores por código de error DCP (DCP-E001 a DCP-E902)
- **Niveles**: distribución de las solicitudes de verificación por nivel de seguridad

Recomendado: usa el módulo `dcpTelemetry` integrado en el SDK con exportadores compatibles con OpenTelemetry ([OBSERVABILITY.md](OBSERVABILITY.md)). El servidor de referencia no emite estas métricas por sí mismo.

<a id="migration-for-existing-v1-operators"></a>

### Migración para operadores V1 existentes

Los operadores V1 existentes pueden actualizar de forma incremental:

1. Actualizar al SDK de DCP v2.0
2. Fijar `default_mode: 'classical_only'` (`VERIFIER_MODE=classical_only` en el servidor de referencia); el nivel de seguridad sigue subiendo el modo a `hybrid_required` para las acciones elevated y maximum
3. Activar gradualmente `hybrid_preferred` para los agentes nuevos
4. Pasar a `hybrid_required` cuando la adopción de PQ sea suficiente

Véase [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md) para los pasos detallados de migración.

<a id="dcp-0509-service-endpoints"></a>

## Endpoints de servicio de DCP-05–09

DCP v2.0 amplía el servidor de verificación con 31 endpoints para la gestión del ciclo de vida, la sucesión digital, la resolución de disputas, el marco de derechos y la representación personal.

> **Sin autenticación y sin verificación.** Estos endpoints comprueban cada registro contra su esquema y el formato de sus ID. No verifican ningún `composite_sig` y no necesitan token del operador. Cualquiera que pueda llegar al servidor puede, por ejemplo, retirar o volver a poner en servicio un agente, revocar un mandato revocable o marcar una disputa como resuelta. Definir `OPERATOR_TOKEN` no los protege: solo protege las rutas de administración y los registros de `agent_id` nuevos. No los expongas a clientes que no sean de confianza: ponlos detrás de tu propia autorización, o no los expongas en absoluto, y trata lo que almacenan como registros no verificados.

Cada POST recibe el registro bajo la clave indicada en la tabla (por ejemplo, `{ "commissioning_certificate": { ... } }`). `:agent_id` e `:id` van codificados para URL.

<a id="dcp-05-agent-lifecycle-management"></a>

### DCP-05: gestión del ciclo de vida del agente

| Método | Endpoint | Clave del cuerpo | Descripción |
|--------|----------|----------|-------------|
| POST | `/v2/lifecycle/commission` | `commissioning_certificate` | Pone al agente en estado `commissioned`; para un agente ya conocido, restablece su estado y su historial |
| POST | `/v2/lifecycle/vitality` | `vitality_report` | Guarda un informe de vitalidad; un `state` distinto en el informe es una transición del ciclo de vida |
| POST | `/v2/lifecycle/decommission` | `decommissioning_record` | Pasa el agente a `decommissioned` y marca como `decommissioned` un pasaporte registrado |
| GET | `/v2/lifecycle/:agent_id` | — | Estado actual, historial y número de informes de vitalidad |

Transiciones del ciclo de vida que acepta el servidor: `commissioned → active`, `active → declining`, `active → decommissioned`, `declining → decommissioned`. La máquina de estados del SDK también permite `commissioned → decommissioned` y `declining → active`.

<a id="dcp-06-digital-succession--inheritance"></a>
<a id="dcp-06-digital-succession-inheritance"></a>

### DCP-06: sucesión digital y herencia

| Método | Endpoint | Clave del cuerpo | Descripción |
|--------|----------|----------|-------------|
| POST | `/v2/succession/testament` | `digital_testament` | Guarda el testamento del agente (uno por agente) |
| GET | `/v2/succession/testament/:agent_id` | — | El testamento del agente |
| POST | `/v2/succession/execute` | `succession_record` | Registra una sucesión; el predecesor debe estar en `declining` o `decommissioned` cuando el servidor conoce su estado |
| POST | `/v2/succession/memory-transfer` | `memory_transfer_manifest` | Valida el manifiesto y responde con recuentos; no se guarda |
| GET | `/v2/succession/:agent_id` | — | Sucesiones registradas para un predecesor |

<a id="dcp-07-conflict-resolution--dispute-arbitration"></a>
<a id="dcp-07-conflict-resolution-dispute-arbitration"></a>

### DCP-07: resolución de conflictos y arbitraje de disputas

| Método | Endpoint | Clave del cuerpo | Descripción |
|--------|----------|----------|-------------|
| POST | `/v2/disputes/create` | `dispute_record` | Guarda una disputa |
| POST | `/v2/disputes/:id/escalate` | — | Pasa la disputa al siguiente nivel de escalado |
| POST | `/v2/disputes/:id/resolve` | `arbitration_resolution` (opcional) | Marca la disputa como resuelta; la resolución, si se da, se guarda tal cual |
| GET | `/v2/disputes/:id` | — | La disputa |
| POST | `/v2/objections/create` | `objection_record` | Guarda una objeción |
| POST | `/v2/jurisprudence` | `jurisprudence_bundle` | Guarda un bundle de jurisprudencia |
| GET | `/v2/jurisprudence` | — | Todos los bundles de jurisprudencia guardados |

<a id="dcp-08-rights--obligations-framework"></a>
<a id="dcp-08-rights-obligations-framework"></a>

### DCP-08: marco de derechos y obligaciones

| Método | Endpoint | Clave del cuerpo | Descripción |
|--------|----------|----------|-------------|
| POST | `/v2/rights/declare` | `rights_declaration` | Guarda la declaración de derechos del agente (una por agente) |
| GET | `/v2/rights/:agent_id` | — | La declaración de derechos del agente |
| POST | `/v2/obligations/record` | `obligation_record` | Añade un registro de obligación |
| GET | `/v2/obligations/:agent_id` | — | Los registros de obligaciones del agente |
| POST | `/v2/rights/violation` | `violation_report` | Guarda un informe de vulneración de derechos |

<a id="dcp-09-personal-representation--delegation"></a>
<a id="dcp-09-personal-representation-delegation"></a>

### DCP-09: representación personal y delegación

| Método | Endpoint | Clave del cuerpo | Descripción |
|--------|----------|----------|-------------|
| POST | `/v2/delegation/mandate` | `delegation_mandate` | Guarda un mandato |
| GET | `/v2/delegation/mandate/:id` | — | El mandato, con `revoked` |
| POST | `/v2/delegation/mandate/:id/revoke` | — | Revoca un mandato cuyo `revocable` es true |
| POST | `/v2/agent-advisory/declare` | `advisory_declaration` | Guarda una declaración de asesoramiento |
| GET | `/v2/agent-advisory/:id` | — | La declaración de asesoramiento |
| POST | `/v2/mirror/generate` | `principal_mirror` | Añade un espejo del principal |
| GET | `/v2/mirror/:agent_id` | — | Los espejos del principal del agente |
| POST | `/v2/interactions/record` | `interaction_record` | Guarda un registro de interacción |
| POST | `/v2/awareness/threshold` | `awareness_threshold` | Guarda el umbral de atención del agente (uno por agente) |
| GET | `/v2/awareness/threshold/:agent_id` | — | El umbral de atención del agente |

Un registro guardado por ID, o uno por agente, se sustituye por un POST posterior para el mismo ID o agente. Las objeciones, los informes de vulneración y los registros de interacción no tienen endpoint GET.

<a id="production-hardening"></a>

### Refuerzo para producción

Los endpoints de DCP-05–09 tienen:

- **Validación con JSON Schema** — Cada POST que envía un registro se valida contra su esquema antes de guardarlo. `escalate` y `revoke` no reciben registro; `resolve` recibe un `arbitration_resolution` opcional, que guarda sin validarlo
- **Limitación de tasa** — 100 solicitudes/minuto/IP en todos los endpoints POST
- **Límites de tamaño del cuerpo** — cuerpo de solicitud de 1 MB como máximo (devuelve 413) donde se lee el cuerpo; `escalate` y `revoke` no lo leen
- **Validación de los ID de entrada** — Los ID que el servidor usa como clave deben coincidir con `^[\w:.\-]{1,256}$`; se rechazan otros caracteres
- **Almacenamiento acotado** — cada almacén en memoria guarda como máximo 10.000 entradas y desaloja las más antiguas (FIFO): un registro desalojado desaparece. Los registros de identidades, en cambio, rechazan (507); véase [Los servicios de referencia guardan el estado solo en memoria](#reference-services-keep-state-in-memory-only)
- **Cabeceras de seguridad** — X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security, Cache-Control

**No** incluyen la verificación de firmas de los registros ni ninguna autenticación (véase la nota al principio de esta sección).

<a id="reference"></a>

## Referencias

- Lista de comprobación de la verificación: [spec/VERIFICATION.md](../spec/VERIFICATION.md)
- Almacenamiento y anclaje: [STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md)
- Formato del bundle: [spec/BUNDLE.md](../spec/BUNDLE.md)
