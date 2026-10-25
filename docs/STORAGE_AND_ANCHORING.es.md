<sub>[English](STORAGE_AND_ANCHORING.md) · [中文](STORAGE_AND_ANCHORING.zh-CN.md) · **Español** · [日本語](STORAGE_AND_ANCHORING.ja.md) · [Português](STORAGE_AND_ANCHORING.pt-BR.md)</sub>

<a id="storage-and-anchoring--p2p-verification-local"></a>
<a id="storage-and-anchoring-p2p-verification-local"></a>

# Almacenamiento y anclaje — P2P, verificación local

> Traducción informativa de [la versión en inglés](STORAGE_AND_ANCHORING.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

El protocolo no depende de ningún servicio central. La verificación es local; el anclaje opcional usa blockchains públicas **existentes** o servicios **de terceros**. El protocolo no apunta a ningún «registro DCP» canónico ni a ninguna URL «dcp.ai».

<a id="design"></a>

## Diseño

- **La verificación es local.** Un verificador solo necesita: (1) el Signed Bundle (o el Citizenship Bundle + la firma) y (2), opcionalmente, un conjunto de RevocationRecords firmados (de un par, de un archivo o anclados on-chain). No hace falta ninguna llamada a la API de un servidor central.
- **Anclaje opcional:** los usuarios (o cualquier tercero) publican hashes en blockchains públicas **existentes** (Bitcoin, Ethereum) o en un registro de transparencia **de terceros**.
- **Revocación:** uno o varios RevocationRecords firmados. Se distribuyen P2P (el titular se los da al verificador) o se publican como hash on-chain o en un registro; el verificador tiene un conjunto de «revocaciones conocidas» (hashes o registros) y comprueba contra ellas el firmante o el agent_id. No hay servidor central de revocación.

<a id="storage-options"></a>

## Opciones de almacenamiento

| Opción | Qué se almacena | Dónde |
|--------|----------------|--------|
| **Solo portable** | El bundle completo lo guarda el titular y lo presenta al verificador cuando hace falta (p. ej., en una llamada a una API). | Dispositivo o almacenamiento del titular; el verificador recibe el bundle dentro de la propia comunicación. |
| **Anclaje (solo hashes)** | Solo se publica el bundle_hash o el merkle_root (y, opcionalmente, hashes de revocación). El bundle completo queda fuera de la cadena. | Blockchain pública, registro de transparencia o DHT. El verificador comprueba «este hash se ancló en T» con datos públicos. Los usuarios o servicios de anclaje de terceros usan cadenas o registros existentes. |
| **Revocación** | Uno o varios RevocationRecords firmados. Se distribuyen P2P o se publican como hash on-chain o en un registro. | Un par, un archivo, IPFS, una blockchain (solo el hash) o una lista aportada por el usuario. |

<a id="optional-anchor-receipt"></a>

## Recibo de anclaje opcional

Si se usa el anclaje, puede guardarse una prueba opcional **junto** al bundle (no necesariamente en el esquema):

- `anchor_receipt`: `{ chain, tx_id, block_height }` (Bitcoin) o `{ chain, contract, tx_id, block_number, event_index }` (Ethereum) o `{ log_url, log_index }` (registro de transparencia).

El anclaje lo hacen los usuarios o servicios de anclaje de terceros sobre cadenas o registros existentes.

<a id="blockchain-anchoring"></a>

## Anclaje en blockchain

Cómo anclar hashes DCP en una blockchain. Los usuarios (o cualquier servicio de anclaje de terceros) publican hashes en cadenas públicas **existentes**.

<a id="what-goes-on-chain-only-hashes"></a>

### Qué va on-chain (solo hashes)

- **bundle_hash** (p. ej., `sha256:<hex>`) o **merkle_root** de las audit_entries. Un hash por anclaje.
- Opcionalmente: **el hash de un RevocationRecord** (para que los verificadores puedan obtener de la cadena una lista de hashes de revocación y comprobarla localmente).
- **Nada más:** ni el bundle completo, ni el agent_id, ni el human_id, ni el payload del RPR o del AP. La cadena solo ve hashes. Los hashes no son anónimos: quien tenga el bundle puede encontrar su hash en la cadena, y el mismo hash vincula todos los registros que lo llevan.

<a id="implementation-options"></a>

### Opciones de implementación

| Cadena / sistema | Método | Formato | Notas |
|----------------|--------|--------|--------|
| **Bitcoin** | Salida OP_RETURN (o compromiso taproot). Una transacción por hash, o muchos hashes agrupados en un árbol de Merkle y comprometiendo la raíz. | 32 bytes (SHA-256) en la salida. | Barato e inmutable; tamaño de payload limitado por transacción. En lote: una raíz por transacción, pruebas fuera de la cadena. |
| **Ethereum (o L2)** | Contrato que emite un evento con `bytes32 bundleHash` (y una marca de tiempo opcional). | Evento: `Anchored(bytes32 bundleHash, uint256 timestamp)`. | El verificador lee los eventos; no hace falta confiar en un servidor central. Coste en gas. |
| **Registro de transparencia (p. ej., al estilo CT)** | Registro de solo anexado: cada entrada = hash (+ marca de tiempo opcional). Árbol de Merkle sobre las entradas; la raíz puede publicarse periódicamente en Bitcoin/Ethereum. | Entrada del registro = hash de 32 bytes. Prueba de inclusión = ruta de Merkle. | Añadir entradas es muy barato; el verificador comprueba la prueba de inclusión. Puede gestionarlo un tercero. |
| **IPFS** | Publicar solo el hash como contenido (p. ej., un nodo DAG). Fijarlo desde varios nodos. | CID o hash en bruto. | No es una blockchain, pero es descentralizado; el verificador resuelve el CID para obtener el hash y lo compara. |

<a id="concrete-flow-bitcoin-op_return"></a>

### Flujo concreto (OP_RETURN de Bitcoin)

1. El titular tiene el Signed Bundle; el `bundle_hash` ya está en `signature.bundle_hash`.
2. El titular (o cualquier tercero) crea una transacción de Bitcoin con una salida OP_RETURN que contiene los 32 bytes en hexadecimal (o un prefijo como `dcp:v1:` + hex para identificar el protocolo).
3. El titular guarda el **anchor_receipt**: `{ chain: "bitcoin", network: "mainnet", tx_id: "<txid>", block_height: N }` (y, opcionalmente, la prueba de Merkle si se agrupa en lotes).
4. Verificador: dados un Signed Bundle y un anchor_receipt, (a) calcula el bundle_hash a partir del bundle, (b) obtiene la transacción de la cadena (o de un explorador de bloques público o de su propio nodo) y (c) comprueba que la salida OP_RETURN coincide con el bundle_hash. La verificación es local + datos públicos de la cadena.

<a id="anchoring-by-users-or-third-parties"></a>

### Anclaje por usuarios o terceros

El anclaje lo hacen **usuarios** o **servicios de anclaje de terceros** sobre cadenas existentes. La CLI de referencia no tiene ningún comando de anclaje, y el servicio de anclaje de referencia (`services/anchor/`) todavía no envía a ninguna cadena: agrupa hashes en lotes y los registra localmente, en memoria. `contracts/ethereum/` tiene un contrato para desplegar en Ethereum o en una L2.

<a id="revocation-p2p"></a>

## Revocación (P2P)

- Un **RevocationRecord** firmado (véase [spec/DCP-01.md](../spec/DCP-01.md)) declara que un agente (o un firmante) está revocado.
- Los verificadores mantienen un **conjunto local** de RevocationRecords firmados (de un archivo, de un par, de IPFS o anclados on-chain por hash). Comprueban el firmante o el agent_id del bundle contra ese conjunto. No hay servidor central de revocación.
- Un comando local de comprobación de revocaciones (por ejemplo, `dcp verify-revocation <signed_bundle> <revocation_record.json>`) es una herramienta posible; la CLI de referencia no lo tiene.

<a id="jurisdictional-revocation-list"></a>

## Lista de revocaciones jurisdiccional

Una jurisdicción (un gobierno, una autoridad reguladora o un emisor acreditado) puede publicar una **lista de revocaciones firmada**: un archivo JSON que enumera los agentes revocados en esa jurisdicción.

**Formato sugerido:**

```json
{
  "issuer": "authority-us-ai-registry",
  "jurisdiction": "US",
  "updated_at": "2026-02-07T00:00:00Z",
  "entries": [
    { "agent_id": "agent-abc-123", "revoked_at": "2026-01-15T12:00:00Z", "reason_hash": "sha256:..." }
  ],
  "signature": {
    "alg": "ed25519",
    "public_key_b64": "...",
    "sig_b64": "..."
  }
}
```

**Publicación:** en una URL conocida, p. ej., `https://<authority>/.well-known/dcp-revocations.json`. No es obligatorio; es una convención. Cualquier URL sirve.

El formato anterior es un diseño sugerido. Ninguna herramienta de este repositorio lo produce ni comprueba su firma.

**Implementación de referencia:** `services/revocation/` de este repositorio (imagen Docker `ghcr.io/dcp-ai-protocol/dcp-ai/revocation:latest`, configuración de Fly.io en `deploy/fly/revocation.toml`) sirve otra lista en `/.well-known/dcp-revocations.json`: `{ dcp_version, updated_at, revocations, kid_revocations }`, **sin firma** sobre la lista. Un verificador que la lee confía en el operador de esa URL y en el transporte (HTTPS, y la cabecera `Authorization` opcional que envía la fuente de revocación de la admisión). El perfil de admisión lee este formato como lista de denegación, falla cuando no puede descargarla y nunca trata una respuesta ausente como «no revocado» ([ADMISSION.md](ADMISSION.md#revocation-sources)).

**Integración propuesta:** el operador elige una autoridad y una URL de confianza para la jurisdicción pertinente; el SDK no descubre ninguna autoridad a partir del campo `jurisdiction` del RPR. Con el formato firmado propuesto arriba, la aplicación debe verificar la firma del emisor con una clave de confianza obtenida por otro canal, en lugar de confiar en la clave que aporta la propia lista. Después busca el `agent_id` o el firmante del bundle entre las entradas y rechaza los bundles revocados. La fuente de admisión existente consume, en cambio, la lista de denegación de referencia sin firmar descrita arriba. Una lista en caché solo es tan reciente como su última descarga: niégate a continuar cuando no puedas descargar una lista lo bastante reciente.

**Qué hace falta:** un archivo JSON servido desde un servidor web o una CDN, que el emisor mantenga al día.

<a id="jurisdictional-transparency-log"></a>

## Registro de transparencia jurisdiccional

Una jurisdicción o un operador acreditado puede gestionar un **registro de transparencia**: un registro de solo anexado, respaldado por un árbol de Merkle, de valores `bundle_hash` de los agentes verificados en esa jurisdicción. Inspirado en Certificate Transparency (RFC 6962).

**Qué se almacena:** solo el `bundle_hash` (SHA-256 en hexadecimal) y una marca de tiempo por entrada. Ni agent_id, ni human_id, ni contenido del bundle. Esto limita lo que revela el registro, pero los hashes no son anónimos: quien tenga un bundle puede comprobar si se registró, y el mismo hash vincula las entradas que lo llevan.

**API sugerida:**

- `POST /add` — recibe `{ bundle_hash }`; devuelve `{ log_index, timestamp }`.
- `GET /proof/:log_index` — devuelve una prueba de inclusión de Merkle (array de hashes hermanos + raíz actual).
- `GET /root` — devuelve la raíz de Merkle actual y el tamaño del registro.
- `GET /root/signed` — devuelve la raíz firmada por el operador del registro (para auditoría).

**Verificación de las entradas del registro:** un verificador recibe `bundle_hash` + `log_index` + `merkle_proof` (del titular del agente o del registro). El verificador comprueba localmente la prueba de inclusión de Merkle contra la raíz firmada. No hace falta ninguna llamada en vivo a la API del registro si el verificador tiene una raíz firmada reciente.

**Anclaje de la raíz del registro:** el operador del registro puede anclar periódicamente la raíz firmada en Bitcoin (mediante OP_RETURN) o en Ethereum (mediante un evento de contrato) para lograr una inmutabilidad pública independiente del servidor del operador.

**anchor_receipt para el registro:** `{ log_url, log_index, merkle_proof, root_anchor: { chain, tx_id, block_height } }`.

**Qué hace falta:** un servidor con un almacén duradero (SQLite o PostgreSQL), la clave de firma del operador y auditores que comparen las raíces. [Trillian](https://github.com/google/trillian) de Google es una implementación de código abierto de este patrón.

**Implementación de referencia:** este repositorio incluye `services/transparency-log/` (código fuente) y la imagen Docker correspondiente en `ghcr.io/dcp-ai-protocol/dcp-ai/transparency-log:latest`. Firma sus cabezas de árbol con Ed25519 e incluye gossip entre registros hermanos para que los ataques de vista dividida sean detectables (DCP-03 §4). Guarda el registro en memoria, así que un reinicio lo vacía. Hay una configuración de Fly.io en `deploy/fly/transparency-log.toml`.

<a id="comparison-anchoring-methods"></a>

## Comparación (métodos de anclaje)

Este repositorio no ha medido las comisiones; cambian con el mercado de cada cadena, así que compruébalas antes de elegir.

1. **Solo registro de transparencia** (sin blockchain): el operador firma la raíz. Sin comisiones de cadena. La confianza recae en el operador + los auditores. Adecuado cuando el operador es una autoridad de confianza (p. ej., un gobierno).
2. **Registro de transparencia + anclaje en lote en Bitcoin**: el registro acumula entradas y ancla la raíz en Bitcoin cada N horas (una transacción OP_RETURN). La comisión se paga por transacción, no por entrada, así que la comparte todo el lote. Inmutabilidad pública para todo un registro nacional.
3. **OP_RETURN de Bitcoin por hash**: una transacción por bundle_hash, es decir, una comisión por hash. Solo es práctico para bundles de bajo volumen o de alto valor.
4. **L2 de Ethereum (Arbitrum, Base, Optimism)**: un evento por hash o por raíz de lote, pagado en gas de la L2. Consultable desde contratos inteligentes.
5. **Red principal de Ethereum**: gas por evento en la red principal. Solo se justifica si hace falta poder consultarlo on-chain desde contratos de la red principal.

Para un registro a escala gubernamental, la opción 2 (registro + lote en Bitcoin) paga una comisión por lote a cambio de verificabilidad pública.

<a id="published-artefacts-current-state"></a>

## Artefactos publicados (estado actual)

El protocolo no exige nada de lo siguiente: son distribuciones de conveniencia para que los operadores no tengan que compilar desde el código fuente. Ejecutarlo todo fuera del repositorio sigue estando totalmente admitido.

- **Repositorio:** `github.com/dcp-ai-protocol/dcp-ai` (Apache-2.0). Cualquiera puede crear un espejo o una bifurcación.
- **SDK:** publicados en sus registros nativos (npm, PyPI, crates.io, módulos de Go). Sus versiones difieren y pueden ir por detrás de `main`: véanse el [README](../README.md) y la sección *Release status* de cada SDK.
- **Imágenes de servicios:** los cuatro servicios opcionales (verificación, anclaje, registro de transparencia, registro de revocaciones) se distribuyen como imágenes Docker multiarquitectura en GHCR. Son servicios de referencia: guardan su estado en memoria (el servicio de revocación puede usar un archivo), y el servicio de anclaje todavía no envía a ninguna cadena ([OPERATOR_GUIDE.md](OPERATOR_GUIDE.md#reference-services-keep-state-in-memory-only)):
    - `ghcr.io/dcp-ai-protocol/dcp-ai/verification`
    - `ghcr.io/dcp-ai-protocol/dcp-ai/anchor`
    - `ghcr.io/dcp-ai-protocol/dcp-ai/transparency-log`
    - `ghcr.io/dcp-ai-protocol/dcp-ai/revocation`
- **Contrato inteligente:** `contracts/ethereum/DCPAnchor.sol` es un proyecto de Foundry, listo para desplegarse en Base, Optimism o Arbitrum. Véase [`contracts/ethereum/DEPLOY.md`](../contracts/ethereum/DEPLOY.md).
- **Ningún registro canónico:** DCP-AI no opera ningún «registro DCP» central ni ningún endpoint de verificación alojado. `dcp-ai.org` sirve la página de inicio, la documentación, el playground y el contexto JSON-LD para las VC (`/credentials/v2`); no verifica bundles para nadie.
- **Resumen:** cada pieza de infraestructura que necesita un despliegue está disponible como un SDK que integras o como un contenedor que ejecutas tú mismo. El anclaje sigue usando cadenas públicas existentes; ninguno de los artefactos publicados es una dependencia del protocolo.

---

<a id="v20-storage-extensions"></a>

## Extensiones de almacenamiento de V2.0

DCP v2.0 introduce cadenas de doble hash, checkpoints PQ y un manifiesto del bundle ampliado para estar preparado para la era poscuántica.

<a id="dual-hash-chains"></a>

### Cadenas de doble hash

Los rastros de auditoría de V2.0 mantienen dos cadenas de hash paralelas como defensa en profundidad:

```
Entry N:
  primary_hash   = SHA-256(canonical(entry_N))
  secondary_hash = SHA3-256(canonical(entry_N))
  prev_hash      = SHA-256(canonical(entry_N-1))       // or "GENESIS"
  prev_hash_secondary = SHA3-256(canonical(entry_N-1)) // or "GENESIS"
```

La cadena secundaria es opcional (`prev_hash_secondary` e `intent_hash_secondary` en el esquema de la entrada de auditoría). La especificación exige verificar de forma independiente la cadena secundaria cuando está presente ([VERIFICATION.md, V2-11](../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present)). Es un diseño de defensa en profundidad: su protección depende de comprobar realmente ambas cadenas y de conservar compromisos de confianza.

**Carencia de implementación (25/10/2026):** los verificadores actuales de bundles V2 de TypeScript, Python, Go y Rust comprueban la cadena `prev_hash` primaria y la raíz de Merkle primaria, pero no recalculan la cadena secundaria ni `audit_merkle_root_secondary`. No interpretes una verificación satisfactoria del bundle como evidencia de que la cadena secundaria es coherente. Las rutas del candidato experimental reutilizan esas comprobaciones de verificación; optar por el candidato no cierra esta carencia.

El árbol de Merkle se calcula sobre la cadena primaria (SHA-256). En el manifiesto del bundle se incluye, como `audit_merkle_root_secondary`, una raíz de Merkle secundaria sobre los hashes SHA3-256.

<a id="pq-checkpoints"></a>

### Checkpoints PQ

V2.0 introduce checkpoints poscuánticos sobre el rastro de auditoría: registros que cubren una serie de entradas de auditoría, firmados por el agente con una firma compuesta (Ed25519 + ML-DSA-65). Su forma es [`schemas/v2/pq_checkpoint.schema.json`](../schemas/v2/pq_checkpoint.schema.json):

```json
{
  "checkpoint_id": "ckpt:...",
  "session_nonce": "a1b2c3d4e5f67890...",
  "event_range": { "from_audit_id": "audit:...", "to_audit_id": "audit:...", "count": 10 },
  "merkle_root": "sha256:...",
  "composite_sig": {
    "classical": { "alg": "ed25519", "kid": "...", "sig_b64": "..." },
    "pq": { "alg": "ml-dsa-65", "kid": "...", "sig_b64": "..." },
    "binding": "pq_over_classical"
  }
}
```

El bundle lleva sus checkpoints en `pq_checkpoints`, y el manifiesto firmado enumera sus ids; los verificadores los comprueban como se indica en `spec/VERIFICATION.md` V2-12.

La frecuencia de los checkpoints depende del nivel de seguridad:

| Nivel | Intervalo de checkpoints | Propósito |
|------|-------------------|---------|
| Routine | Cada 50 eventos | Garantía ligera |
| Standard | Cada 10 eventos | Validación PQ periódica |
| Elevated | Cada evento | Integridad PQ continua |
| Maximum | Cada evento + verificación | Verificación PQ inmediata |

Con una clave de verificación PQ de confianza y una firma PQ válida, un checkpoint autentica el compromiso de Merkle de las entradas de auditoría que cubre, incluso si las firmas clásicas se rompen más adelante. El esquema del checkpoint no tiene un campo de marca de tiempo, y la firma no establece cuándo ocurrieron los eventos.

<a id="v20-bundle-manifest"></a>

### Manifiesto del bundle de V2.0

Los bundles V2.0 incluyen un manifiesto que precalcula los hashes de todos los artefactos:

```json
{
  "dcp_bundle_version": "2.0",
  "manifest": {
    "session_nonce": "a1b2c3d4e5f67890...",
    "rpr_hash": "sha256:...",
    "passport_hash": "sha256:...",
    "intent_hash": "sha256:...",
    "policy_hash": "sha256:...",
    "audit_merkle_root": "sha256:...",
    "audit_merkle_root_secondary": "sha3-256:...",
    "audit_count": 50,
    "pq_checkpoints": ["ckpt:..."]
  }
}
```

Los campos son los de [`schemas/v2/bundle_manifest.schema.json`](../schemas/v2/bundle_manifest.schema.json); además tiene `session_issued_at`, `session_expires_at` e `intended_verifier` opcionales. El `session_nonce` (aleatorio de 256 bits) vincula todos los artefactos a una única sesión, de modo que los artefactos de una sesión no pueden mezclarse en otra. No impide que el bundle completo vuelva a presentarse ([SECURITY_MODEL.md](SECURITY_MODEL.md#9-cross-artifact-replay)). El manifiesto está incluido en la firma del bundle, lo que garantiza su integridad.

<a id="bundle-size-considerations-v20"></a>

### Consideraciones sobre el tamaño del bundle (V2.0)

Los bundles V2.0 son más grandes que los V1 por las firmas compuestas y los dobles hashes:

| Componente | Tamaño V1 | Tamaño V2 | Notas |
|-----------|---------|---------|-------|
| Firma Ed25519 | 64 bytes | 64 bytes | Sin cambios |
| Firma ML-DSA-65 | — | ~3.300 bytes | Nuevo en V2 |
| Hashes SHA-256 | ~32 bytes cada uno | ~32 bytes cada uno | Sin cambios |
| Hashes SHA3-256 | — | ~32 bytes cada uno | Nuevo en V2 |
| Checkpoint PQ | — | ~3.500 bytes | Nuevo en V2 |
| Manifiesto | — | ~500 bytes | Nuevo en V2 |
| **Bundle típico** | **~1–2 KB** | **~10–50 KB** | Estimaciones; depende de la longitud del rastro de auditoría y del nivel (spec §14.1) |

Para entornos con ancho de banda limitado, V2.0 define un formato de transmisión CBOR (RFC 8949), más pequeño que JSON; este repositorio no ha publicado una medición del ahorro.

<a id="anchoring-v20-bundles"></a>

### Anclaje de bundles V2.0

El modelo de anclaje sigue siendo el mismo (solo hashes on-chain), pero V2.0 añade:
- **Anclaje de doble hash** (diseño): podría anclarse un hash SHA3-256 del bundle junto al SHA-256; ningún artefacto ni herramienta de este repositorio lo define todavía
- **Raíces de registro firmadas con PQ** (diseño): las raíces del registro de transparencia podrían llevar firmas compuestas; el registro de referencia las firma solo con Ed25519
- **Formato OP_RETURN** (convención sugerida): `dcp:v2:<sha256_hex>` (frente al `dcp:v1:<sha256_hex>` de V1)

Véase [NIST_CONFORMITY.md](NIST_CONFORMITY.md) para los detalles de conformidad de los algoritmos poscuánticos.
Véase [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md) para migrar los datos V1 anclados existentes.

<a id="reference"></a>

## Referencias

- Lista de comprobación de la verificación: [spec/VERIFICATION.md](../spec/VERIFICATION.md)
- Formato del bundle: [spec/BUNDLE.md](../spec/BUNDLE.md)
- Arquitectura técnica: [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md)
