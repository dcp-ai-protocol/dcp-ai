<sub>[English](../../../docs/TECHNICAL_ARCHITECTURE.md) · [中文](../../zh-CN/docs/TECHNICAL_ARCHITECTURE.md) · **Español** · [日本語](../../ja/docs/TECHNICAL_ARCHITECTURE.md) · [Português](../../pt-BR/docs/TECHNICAL_ARCHITECTURE.md)</sub>

<a id="technical-architecture--dcp-at-global-scale"></a>
<a id="technical-architecture-dcp-at-global-scale"></a>

# Arquitectura técnica — DCP a escala global

> Traducción informativa de [la versión en inglés](../../../docs/TECHNICAL_ARCHITECTURE.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Este documento es el plano técnico para desplegar el Digital Citizenship Protocol en todo el mundo. Describe las capas, los componentes y las decisiones tecnológicas que permiten a cualquier gobierno, organización o desarrollador adoptar el protocolo sin depender de ninguna autoridad central ni de los autores del protocolo.

El protocolo es **especificación + criptografía + JSON**. V1 necesita SHA-256, Ed25519, JSON canónico y JSON Schema draft 2020-12; V2 añade firmas compuestas Ed25519 + ML-DSA-65, SHA3-256 y los demás algoritmos del perfil criptográfico, con JSON canonicalizado según el perfil `dcp-jcs-v1` ([CANONICALIZATION_PROFILE.md](../../../spec/CANONICALIZATION_PROFILE.md)). Cualquier lenguaje que tenga estas primitivas puede implementarlo; los requisitos normativos están en la especificación y sus perfiles. Eso es lo que lo hace viable a escala global.

---

<a id="layers"></a>

## Capas

```
┌─────────────────────────────────────────────────────┐
│  Layer 5: Integration                               │
│  Middleware (Express, FastAPI, gRPC), gov portals    │
├─────────────────────────────────────────────────────┤
│  Layer 4: Anchor + Attestation                      │
│  Bitcoin/Ethereum anchor, jurisdiction attestation   │
├─────────────────────────────────────────────────────┤
│  Layer 3: Infrastructure services                   │
│  Verification service, transparency log, revocation │
├─────────────────────────────────────────────────────┤
│  Layer 2: SDK (multi-language)                      │
│  TypeScript, Python, Go, Rust, WebAssembly          │
├─────────────────────────────────────────────────────┤
│  Layer 1: Spec + Schemas (normative)                │
│  spec/, schemas/v1/, JSON Schema draft 2020-12      │
└─────────────────────────────────────────────────────┘
```

Cada capa se apoya en la anterior. Un despliegue mínimo usa solo las capas 1–2 (especificación + SDK). Un despliegue gubernamental completo usa las cinco. El diagrama es conceptual: mezcla piezas que existen en este repositorio con otras propuestas (middleware gRPC, portales gubernamentales, anclaje on-chain, un servicio de atestación); las secciones siguientes indican cuál es cuál.

---

<a id="layer-1-spec--schemas"></a>
<a id="layer-1-spec-schemas"></a>

## Capa 1: especificación + esquemas

Ya existe en este repositorio.

- `spec/` — de DCP-01 a DCP-09, BUNDLE, VERIFICATION.
- `schemas/v1/` — JSON Schema draft 2020-12 (artefactos V1).
- `schemas/v2/` — JSON Schema draft 2020-12 (artefactos V2, incluidos los de DCP-05–09).
- Los esquemas, junto con la especificación, son la fuente de verdad de la forma de los artefactos. No todas las rutas de los SDK validan contra ellos: en el SDK de TypeScript, `validateBundle` cubre los bundles V1, y `verifySignedBundleV2` comprueba la estructura que necesita sin ejecutar los JSON Schema (el verificador de referencia, `lib/verify.js`, que usan la CLI y el servidor, los valida antes de llamarlo).

Esta capa es normativa. No cambia con frecuencia; se amplía con campos opcionales.

---

<a id="layer-2-sdk-multi-language"></a>

## Capa 2: SDK (multilenguaje)

<a id="what-the-sdk-is"></a>

### Qué es el SDK

No es un framework. Es una biblioteca portable que construye, firma y verifica artefactos de DCP. En el SDK de TypeScript, por ejemplo:

- `validateBundle` — valida un bundle V1 contra los esquemas V1.
- `verifySignedBundle` (V1) y `verifySignedBundleV2` (V2) — la lista de comprobación de la verificación.
- `signBundle` / `signBundleV2` — firman un bundle (Ed25519, o compuesta Ed25519 + ML-DSA-65 en V2).
- `BundleBuilder` / `BundleBuilderV2` — construyen un bundle.
- `intentHash` / `hashObject` — hash canónico.

La API exacta de cada lenguaje está en su README y, para TypeScript, en [API_REFERENCE.md](../../../docs/API_REFERENCE.md).

<a id="language-bindings"></a>

### Enlaces por lenguaje

El README de cada SDK tiene una sección *Release status* que registra qué se publicó, en qué registro y cuándo; este documento no consulta los registros, y las versiones publicadas pueden ir por detrás de `main`.

- **TypeScript** — [`@dcp-ai/sdk`](https://www.npmjs.com/package/@dcp-ai/sdk) en npm. Esquemas incrustados, sin dependencia del sistema de archivos. `@noble/post-quantum` para los algoritmos PQ, `tweetnacl` para Ed25519, `crypto` de Node.js para los hashes y HKDF. También es la base de `@dcp-ai/cli` (CLI interactiva de andamiaje) y de las integraciones de `integrations/express/` e `integrations/openclaw/`.
- **Python** — [`dcp-ai`](https://pypi.org/project/dcp-ai/) en PyPI. `pqcrypto` para ML-DSA-65 / SLH-DSA-192f, `pynacl` para Ed25519, `jsonschema` para la validación draft 2020-12, `pydantic` para los modelos tipados. Los puentes con frameworks (`dcp_ai.fastapi`, `dcp_ai.langchain`, `dcp_ai.openai`, `dcp_ai.crewai`) van dentro del wheel y se activan con extras de instalación (p. ej., `pip install dcp-ai[fastapi]`).
- **Go** — `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` (la ruta del módulo exige el sufijo `/v2` por la regla de versiones mayores de Go). `cloudflare/circl` para ML-DSA-65, ML-KEM-768 y SLH-DSA-192f; `crypto/ed25519` de la biblioteca estándar. Se publica con etiquetas `sdks/go/v2.x.y`.
- **Rust** — [`dcp-ai`](https://crates.io/crates/dcp-ai) en crates.io. Los crates `fips203`/`fips204`/`fips205` (de github.com/integritychain) para PQ; `ed25519-dalek` para la criptografía clásica. También es el origen de la compilación WASM de abajo mediante `--features wasm`.
- **WebAssembly** — [`@dcp-ai/wasm`](https://www.npmjs.com/package/@dcp-ai/wasm) en npm. Compilado a partir del crate de Rust con `wasm-pack`.

Los cinco comparten la misma especificación y el mismo conjunto de esquemas; la interoperabilidad entre SDK se valida en CI con los vectores compartidos de `tests/interop/v2/`.

<a id="sdk-structure-typescript-example"></a>

### Estructura del SDK (ejemplo de TypeScript)

```
sdks/typescript/
  src/
    core/            # canonicalization, hashing, signing, verification (V1 and V2), tiers, DCP-05–09 modules
    providers/       # Ed25519, ML-DSA-65, SLH-DSA-192f (exported); KEM providers (internal)
    bundle/          # bundle builders and signing
    a2a/             # DCP-04 discovery, handshake messages, sessions
    observability/   # dcpTelemetry
    schemas/         # embedded JSON schemas
    types/           # V1 and V2 types
    wire/            # wire formats
    index.ts         # the package's public exports
  package.json
  tsconfig.json
```

El SDK NO depende del sistema de archivos. Recibe objetos y devuelve resultados estructurados. Los esquemas se empaquetan como módulos JSON importados.

---

<a id="layer-3-infrastructure-services"></a>

## Capa 3: servicios de infraestructura

<a id="3a-verification-service"></a>

### 3a. Servicio de verificación

Está en `server/`: una API HTTP que verifica Signed Bundles.

Para el despliegue en producción:

- **Imagen Docker:** `ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest`, más las etiquetas semver de las versiones y `:sha-<short>`. Multiarquitectura `linux/amd64` + `linux/arm64`. Se ejecuta con `docker run -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest`.
- **Verificación sin estado:** `POST /verify` no necesita base de datos. Los demás registros del servidor están en memoria y se pierden al reiniciar ([OPERATOR_GUIDE.md](../../../docs/OPERATOR_GUIDE.md#reference-services-keep-state-in-memory-only)).
- **Salud + capacidades:** `/health`, `/.well-known/dcp-capabilities.json`.
- **API:** POST `/verify` (cuerpo: `signed_bundle`, `public_key_b64` opcional; respuesta: `{ verified, dcp_version, errors, … }`). Los endpoints V2 adicionales se enumeran en [OPERATOR_GUIDE.md](../../../docs/OPERATOR_GUIDE.md).
- **Despliegue gestionado:** configuración de Fly.io en `deploy/fly/verification.toml` (`fly launch --config deploy/fly/verification.toml` y después `fly deploy --config deploy/fly/verification.toml`). Un despliegue público expone también los endpoints de DCP-05–09, que no tienen autenticación y no verifican firmas: restríngelos antes ([OPERATOR_GUIDE.md](../../../docs/OPERATOR_GUIDE.md#dcp-0509-service-endpoints)).

Consulta [OPERATOR_GUIDE.md](../../../docs/OPERATOR_GUIDE.md), [server/README.md](../../../server/README.md) y [deploy/README.md](../../../deploy/README.md).

<a id="3b-transparency-log"></a>

### 3b. Registro de transparencia

Un servidor de solo anexado que recibe hashes y los organiza en un árbol de Merkle. Inspirado en Certificate Transparency (RFC 6962), pero simplificado para DCP.

**Tecnología recomendada:** Go (como [Trillian](https://github.com/google/trillian) de Google) o una implementación propia más sencilla en Node/Go. Almacenamiento: SQLite (operador pequeño) o PostgreSQL (escala gubernamental). Solo guarda hashes + índices + árbol de Merkle: muy pocos datos.

**API sugerida** (el servicio de referencia de `services/transparency-log/` tiene estas rutas, además de `GET /entries` y gossip entre registros; guarda su árbol en memoria):

- `POST /add` — recibe `bundle_hash`; en este diseño devuelve `{ log_index, timestamp }` (el servicio de referencia devuelve `{ index, leaf_hash, root, size }`).
- `GET /proof/:log_index` — devuelve la prueba de inclusión de Merkle (array de hashes + raíz).
- `GET /root` — devuelve la raíz actual del árbol y el tamaño del registro.
- `GET /root/signed` — devuelve la raíz del árbol firmada por el operador del registro (para auditoría).

**De qué depende:** de un almacén duradero para el árbol, de la clave de firma del operador para la raíz y de auditores (u otros registros, mediante gossip) que comparen raíces. Comprobar una prueba de inclusión es local. Anclar la raíz en una cadena pública elimina la necesidad de confiar solo en el operador, a cambio de las comisiones y el tiempo de confirmación de esa cadena; este repositorio no ha medido ninguno de los dos.

**Privacidad:** el registro guarda solo hashes SHA-256: ningún agent_id, ningún human_id, ningún contenido de bundle. Aun así, los hashes no son anónimos: quien tenga un bundle puede comprobar si su hash está en el registro, y un mismo hash vincula los registros que lo llevan.

<a id="3c-revocation-list-publisher"></a>

### 3c. Publicador de la lista de revocación

Un servicio (o script) que mantiene una lista de revocación firmada por jurisdicción y la publica en una URL conocida.

**Formato:**

```json
{
  "issuer": "gov-authority-us",
  "jurisdiction": "US",
  "updated_at": "2026-02-07T00:00:00Z",
  "entries": [
    { "agent_id": "agent-xyz", "revoked_at": "2026-01-15T...", "reason_hash": "sha256:..." }
  ],
  "signature": {
    "alg": "ed25519",
    "public_key_b64": "...",
    "sig_b64": "..."
  }
}
```

**Tecnología:** un archivo JSON firmado alojado en un servidor estático (S3, GitHub Pages, un servidor gubernamental). Convención de URL: `https://<authority>/.well-known/dcp-revocations.json` (no obligatoria). El formato anterior es un diseño sugerido: la CLI de referencia no tiene ningún comando que lo publique.

El servicio de revocación de referencia (`services/revocation/`) sirve en esa URL una lista distinta y **sin firmar**: `{ dcp_version, updated_at, revocations, kid_revocations }`. Su autenticidad procede del transporte (HTTPS, `Authorization` opcional), no de una firma. El perfil de admisión puede usarla como lista de denegación ([ADMISSION.md](../../../docs/ADMISSION.md)).

**De qué depende:** un verificador se entera de una revocación cuando obtiene un estado que la incluye. Una lista en caché anterior a la revocación puede dejar una ventana de aceptación hasta el límite de frescura configurado. Cuando se exige un estado fresco, un verificador que falla cerrado rechaza si la fuente no está disponible; uno que falla abierto puede seguir aceptando sin un estado actual.

---

<a id="layer-4-anchor--attestation"></a>
<a id="layer-4-anchor-attestation"></a>

## Capa 4: anclaje + atestación

<a id="4a-anchor-service"></a>

### 4a. Servicio de anclaje

Recibe `bundle_hash` (o la raíz del registro) y lo publica en una blockchain.

**Opciones** (este repositorio no ha medido sus comisiones; consulta las comisiones actuales antes de elegir):

1. **Solo registro de transparencia** — sin ninguna blockchain. El operador del registro firma la raíz; la confianza recae en el operador + los auditores.
2. **Bitcoin OP_RETURN (por lotes)** — acumular N hashes, construir un árbol de Merkle y publicar solo la raíz en una transacción, por ejemplo una por hora o por día. Una sola comisión de transacción se reparte entre todos los hashes del lote.
3. **Ethereum L2 (Arbitrum, Base, Optimism)** — si se necesita verificabilidad mediante contratos inteligentes (p. ej., un contrato que responda «¿se ancló este hash?»). La comisión por evento depende de la L2.
4. **Ethereum mainnet** — solo se justifica si el contrato de anclaje tiene que estar en mainnet.

De estas opciones, este repositorio solo implementa el registro de transparencia y el contrato de Ethereum, al que el servicio de anclaje todavía no llama. **Tecnología:** Node.js o Go. Para Bitcoin: `bitcoinjs-lib`. Para Ethereum/L2: `ethers.js` o `viem`. Puede ser un script independiente ejecutado con cron o formar parte del servicio de registro (el registro ancla su raíz periódicamente).

**Implementación de referencia:** `services/anchor/` en este repositorio, con el nombre de imagen `ghcr.io/dcp-ai-protocol/dcp-ai/anchor:latest`. Configuración de Fly.io en `deploy/fly/anchor.toml`. Todavía no envía nada on-chain: agrupa los hashes y los registra localmente, en memoria ([`services/anchor/README.md`](../../../services/anchor/README.md)). El contrato para Ethereum/L2 es `contracts/ethereum/src/DCPAnchor.sol`: un proyecto Foundry listo para desplegar, con pruebas, script de despliegue y configuraciones RPC por cadena (Base, Base Sepolia, Optimism, Arbitrum, Sepolia). Consulta [`contracts/ethereum/DEPLOY.md`](../../../contracts/ethereum/DEPLOY.md) para el recorrido completo.

<a id="4b-jurisdiction-attestation"></a>

### 4b. Atestación de jurisdicción

Una autoridad jurisdiccional (un gobierno o un emisor acreditado) firma el hash del RPR de un agente y certifica que «este agente está registrado en nuestra jurisdicción».

**Objeto:** consulta [spec/DCP-01.md](../../../spec/DCP-01.md) para la definición de `JurisdictionAttestation`.

**Tecnología:** Ed25519 (la misma criptografía que el protocolo). El gobierno tiene un par de claves y publica su clave pública en una URL conocida: `https://<gov>/.well-known/dcp-attestation-keys.json`.

**API (un diseño sugerido, si el gobierno ejecuta un servicio; este repositorio no tiene ningún servicio de atestación):**

- `POST /attest` — cuerpo: `{ rpr_hash, agent_id }`; respuesta: `{ attestation: { issuer, jurisdiction, rpr_hash, signature, expires_at } }`.

La atestación se incluye en el Signed Bundle o se presenta junto a él. Comprobarla es una verificación de firma local contra la clave publicada de la autoridad; confiar en esa clave le corresponde al verificador.

---

<a id="layer-5-integration"></a>

## Capa 5: integración

<a id="middleware-for-platforms"></a>

### Middleware para plataformas

El SDK permite crear **middleware** que las plataformas insertan en sus flujos:

- **Express (Node):** `app.use(dcpVerify({ ... }))` de `@dcp-ai/express`: lee el bundle de una cabecera (o del cuerpo), lo verifica y deja pasar la petición o la rechaza ([QUICKSTART_EXPRESS.md](../../../docs/QUICKSTART_EXPRESS.md)).
- **FastAPI (Python):** `DCPVerifyMiddleware` y la dependencia `require_dcp` de `dcp-ai[fastapi]`.
- **Interceptor gRPC (Go):** un diseño posible (leer los metadatos `dcp-bundle`, verificar); este repositorio no lo proporciona.

Una plataforma puede empezar a verificar agentes con unas pocas líneas de configuración. Adopción incremental.

<a id="government-portal"></a>

### Portal gubernamental

Un panel (React/Next.js o similar) para que un gobierno pueda:

- Ver el estado del registro de transparencia (entradas, última raíz, último anclaje).
- Gestionar la lista de revocación (añadir/quitar entradas, firmar y publicar).
- Verificar un bundle manualmente (pegar el JSON, ver el resultado).
- Ver las métricas del servicio de verificación.

Es una herramienta propuesta para operadores, no parte del protocolo; este repositorio no incluye ninguna.

---

<a id="repository-layout-current"></a>

## Estructura del repositorio (actual)

Todo está en un único monorepo en `github.com/dcp-ai-protocol/dcp-ai`. Cada SDK y cada servicio pueden usarse por separado, así que un gobierno o un equipo puede elegir las piezas que quiera sin adoptar toda la pila; para saber qué se ha publicado y en qué registro, consulta el README de cada componente:

- `spec/` — de DCP-01 a DCP-09, BUNDLE, VERIFICATION, AUDIT (fuente de verdad normativa).
- `schemas/` — JSON Schema draft 2020-12, dividido en `v1/` (9 artefactos) y `v2/` (42 artefactos, incluidos los de DCP-05..09).
- `sdks/` — TypeScript (`@dcp-ai/sdk`), Python (`dcp-ai`), Go (`sdks/go/v2`), Rust (crate `dcp-ai`), WASM (`@dcp-ai/wasm`).
- `cli/` — `@dcp-ai/cli`, generador interactivo de proyectos (depende del SDK de TypeScript).
- `integrations/` — 10 puentes con frameworks: Express, FastAPI, LangChain, OpenAI, CrewAI, AutoGen, Anthropic MCP, Google A2A, W3C DID, OpenClaw. Seis son paquetes npm independientes bajo `@dcp-ai/*`; los cuatro de Python van dentro del wheel `dcp-ai` como extras.
- `packages/create-*` — cuatro generadores `npm create @dcp-ai/<template>` (LangChain, CrewAI, OpenAI, Express).
- `server/` — servidor HTTP de verificación de referencia.
- `services/` — anchor, transparency-log, revocation. El flujo de publicación construye una imagen multiarquitectura de cada uno para GHCR; consulta el README de cada servicio para ver su estado.
- `contracts/ethereum/` — proyecto Foundry para `DCPAnchor.sol` (listo para desplegar en Base, Optimism, Arbitrum, Sepolia).
- `deploy/` — configuraciones de Fly.io para los cuatro servicios, más una guía de despliegue independiente del proveedor.
- `docs/` y `docs-site/` — esta documentación; publicada en [docs.dcp-ai.org](https://docs.dcp-ai.org/).
- `playground/` — playground en el navegador; servido en [docs.dcp-ai.org/playground/](https://docs.dcp-ai.org/playground/).

Un gobierno puede usar solo `spec/` + un único SDK de su registro preferido y nada más. O desplegar toda la pila con Docker/Fly.io. Sin dependencia de proveedor; sin dependencia central.

---

<a id="executive-summary-for-a-government"></a>

## Resumen ejecutivo para un gobierno

Instala el SDK en tu lenguaje. Todo agente que opere en tu jurisdicción debe presentar un Signed Bundle. Tu servicio de verificación (un contenedor Docker) lo valida localmente, sin llamar a ningún servicio externo; su coste por comprobación depende de los algoritmos y del nivel (§14.1 de la especificación da tamaños y latencias orientativos). La verificación comprueba firmas y hashes: no establece la identidad real de nadie ni autoriza una acción. Tu registro de transparencia guarda hashes de bundles, que no son anónimos: quien tenga un bundle puede comprobar si su hash está ahí, y un hash vincula los registros que lo llevan. Tu lista de revocación te permite revocar agentes, con efecto en todo verificador que la obtenga fresca y falle cerrado cuando no pueda. El anclaje periódico en una cadena pública añade un registro público del compromiso, difícil de alterar, a cambio de las comisiones de esa cadena; no prueba que los registros anclados sean verdaderos ni cuándo ocurrieron los hechos. No dependes de ningún servidor central ni de los autores del protocolo.

---

---

<a id="v20-architecture-extensions"></a>

## Extensiones de arquitectura de V2.0

DCP v2.0 amplía la arquitectura con criptografía poscuántica, comunicación entre agentes, observabilidad y refuerzo para producción.

<a id="crypto-provider-architecture"></a>

### Arquitectura de proveedores criptográficos

V2.0 introduce un sistema de proveedores criptográficos con agilidad de algoritmos:

```
CryptoProvider Interface
├── Ed25519Provider (classical, RFC 8032)
├── MlDsa65Provider (post-quantum, FIPS 204)
└── SlhDsa192fProvider (hash-based backup, FIPS 205)

KemProvider Interface (TypeScript: internal, not exported)
├── X25519KemProvider (classical ECDH)
├── MlKem768Provider (post-quantum, FIPS 203)
└── HybridKemProvider (X25519 + ML-KEM-768)

AlgorithmRegistry
└── Maps algorithm names → provider instances (runtime selection)
```

Los proveedores se registran al arrancar mediante `registerDefaultProviders()`. Los proveedores personalizados implementan la misma interfaz. Un proveedor real respaldado por un HSM sería uno de ellos; el repositorio no tiene ninguno. El `HsmCryptoProvider` del código fuente de TypeScript es un patrón simulado, no exportado y no utilizable para evidencia real ([NIST_CONFORMITY.md](../../../docs/NIST_CONFORMITY.md) §2.2).

<a id="a2a-infrastructure-dcp-04"></a>

### Infraestructura A2A (DCP-04)

La comunicación entre agentes añade una nueva capa de infraestructura:

```
Agent A                                     Agent B
  │                                           │
  │── Discovery (.well-known/dcp-agent-directory.json)
  │── A2A_HELLO (bundle + ephemeral KEM key) ──>│
  │<── A2A_WELCOME (bundle + KEM ciphertext) ───│
  │── A2A_CONFIRM (KEM ciphertext + proof) ────>│
  │<── A2A_ESTABLISHED (session_id) ────────────│
  │                                             │
  │══ Encrypted messages (AES-256-GCM) ════════>│
  │<═════════════════════════════════════════════│
```

Componentes clave:
- **Descubrimiento**: `.well-known/dcp-agent-directory.json` por organización
- **Handshake**: verificación mutua de bundles + KEM híbrido (X25519 + ML-KEM-768) en la especificación; los SDK construyen los mensajes del handshake, y quien llama deriva la clave de sesión (ningún SDK exporta el intercambio híbrido)
- **Sesión**: mensajes cifrados con AES-256-GCM con números de secuencia monótonos
- **Renovación de claves**: la sesión indica cuándo toca (`needsRekeying`, cada 1000 mensajes por defecto); quien llama deriva la nueva clave
- **Auditoría**: la especificación hace que ambos agentes registren las interacciones A2A en sus cadenas de auditoría; las funciones de sesión de TypeScript no escriben entradas de auditoría por sí mismas

Consulta [spec/DCP-04.md](../../../spec/DCP-04.md) para la especificación completa.

<a id="observability-stack"></a>

### Pila de observabilidad

V2.0 incluye un módulo de observabilidad, `dcpTelemetry`. La instrumentación es explícita: las funciones de firma y verificación del SDK no lo llaman, así que los spans y las métricas solo proceden de las llamadas que haga tu código ([OBSERVABILITY.md](../../../docs/OBSERVABILITY.md)):

- **Spans**: trazas por operación (firma, verificación, KEM, checkpoint)
- **Métricas**: percentiles de latencia (p50/p95/p99) por operación y nivel
- **Contadores**: firmas creadas/verificadas, bundles verificados, sesiones/mensajes A2A
- **Métricas de caché**: proporción de aciertos/fallos de la caché de verificación
- **Seguimiento de errores**: errores por código de error de DCP

El módulo de telemetría admite salida por consola y es compatible con exportadores de OpenTelemetry. Los operadores pueden enviar las métricas a Prometheus, Grafana, Datadog, etc.

<a id="production-hardening"></a>

### Refuerzo para producción

Los SDK incluyen ayudas de refuerzo que integra el operador; no son límites ya activos en todos los SDK o servicios:

**Códigos de error**: 38 códigos de error de DCP normalizados (de DCP-E001 a DCP-E902) que cubren errores de esquema, firma, cadena de hash, identidad, política, sesión, A2A, limitación de tasa e internos. Cada código incluye información sobre si se puede reintentar.

**Limitación de tasa**: `AdaptiveRateLimiter` (SDK de TypeScript) con límites por nivel por defecto:
- Routine: 1000 peticiones/min por agente
- Standard: 500 peticiones/min
- Elevated: 100 peticiones/min
- Maximum: 50 peticiones/min

**Interruptor de circuito**: interruptor de circuito de tres estados (cerrado/abierto/semiabierto) para la resiliencia del servicio de verificación. Umbral de fallos, tiempo de restablecimiento y número de sondeos en semiabierto configurables.

**Reintento con espera**: espera exponencial con jitter para las operaciones reintentables. Respeta los indicadores de reintento de los errores de DCP.

<a id="ecosystem-bridges-v20"></a>

### Puentes con ecosistemas (V2.0)

V2.0 añade módulos puente para interoperar con ecosistemas externos:

| Puente | Finalidad |
|--------|---------|
| W3C DID/VC | Convertir el RPR en un DID Document y el pasaporte en una Verifiable Credential |
| Google A2A | Traducir Agent Cards a pasaportes de DCP, añadir firmas PQ |
| Anthropic MCP | Herramientas de DCP para servidores MCP, contexto de identidad en sesiones MCP |
| Microsoft AutoGen | Envoltorios de DCP para agentes de AutoGen, gobernanza de chats en grupo |

<a id="updated-layer-architecture"></a>

### Arquitectura de capas actualizada

```
┌──────────────────────────────────────────────────────┐
│  Layer 7: Ecosystem Bridges                          │
│  W3C DID/VC, Google A2A, Anthropic MCP, AutoGen     │
├──────────────────────────────────────────────────────┤
│  Layer 6: Observability + Hardening                  │
│  Telemetry, metrics, error codes, rate limiting      │
├──────────────────────────────────────────────────────┤
│  Layer 5: Integration                                │
│  Express, FastAPI, LangChain, OpenAI, CrewAI, etc.  │
├──────────────────────────────────────────────────────┤
│  Layer 4: Anchor + Attestation                       │
│  Bitcoin/Ethereum anchor, jurisdiction attestation    │
├──────────────────────────────────────────────────────┤
│  Layer 3: Infrastructure services                    │
│  Verification, transparency log, revocation, A2A     │
├──────────────────────────────────────────────────────┤
│  Layer 2: SDK (multi-language, PQ-ready)             │
│  TS, Python, Go, Rust + composite sigs + hybrid KEM │
├──────────────────────────────────────────────────────┤
│  Layer 1: Spec + Schemas (normative)                 │
│  DCP-01/02/03/04, v2.0 spec, schemas/v1/ + v2/      │
└──────────────────────────────────────────────────────┘
```

<a id="dcp-05-through-dcp-09-constitutional-extensions"></a>

## De DCP-05 a DCP-09: extensiones constitucionales

DCP v2.0 va más allá de la rendición de cuentas hacia un marco constitucional para la sociedad digital. Cinco especificaciones nuevas añaden gobernanza del ciclo de vida, sucesión, resolución de disputas, derechos y delegación. Sus registros son declaraciones firmadas: las funciones del SDK los construyen y los firman, pero no ejecutan las acciones que describen ni verifican que una persona haya dado su consentimiento.

<a id="dcp-05-agent-lifecycle-management"></a>

### DCP-05: gestión del ciclo de vida del agente

Define la máquina de estados del ciclo de vida, cuyo camino principal es `commissioned → active → declining → decommissioned` (permite seis transiciones en total: véase `validateStateTransition` en [API_REFERENCE.md](../../../docs/API_REFERENCE.md)). Introduce:
- **Certificado de puesta en servicio**: activación formal del agente con su finalidad, capacidades y nivel de riesgo
- **Informes de vitalidad**: métricas de salud encadenadas por hash (puntuación 0-1000) para el seguimiento continuo
- **Registro de retirada**: cuatro modos de terminación (retiro planificado, terminación por causa, reestructuración organizativa, fallo repentino)

Contexto de separación de dominios: `DCP-AI.v2.Lifecycle`

<a id="dcp-06-digital-succession--inheritance"></a>
<a id="dcp-06-digital-succession-inheritance"></a>

### DCP-06: sucesión y herencia digitales

Gestiona la muerte del agente y la transferencia de conocimiento:
- **Testamento digital**: preferencias de sucesores ordenadas + clasificación de la memoria (transfer/retain/destroy)
- **Registro de sucesión**: registro de la ceremonia con consentimiento humano y testigos participantes
- **Manifiesto de transferencia de memoria**: raíz de Merkle de doble hash sobre la memoria operativa transferida; la memoria relacional se clasifica por defecto para su destrucción, pero `classifyMemory` solo enumera esos hashes y no borra nada, y las entradas marcadas como `retain` quedan fuera del manifiesto

Contexto de separación de dominios: `DCP-AI.v2.Succession`

<a id="dcp-07-conflict-resolution--dispute-arbitration"></a>
<a id="dcp-07-conflict-resolution-dispute-arbitration"></a>

### DCP-07: resolución de conflictos y arbitraje de disputas

Escalado de disputas en tres niveles: negociación directa → arbitraje contextual → apelación humana.
- **Registro de disputa**: cuatro tipos (conflicto de recursos, de directivas, de capacidades, de políticas)
- **Resolución de arbitraje**: paneles de arbitraje M de N (reutiliza el patrón de ceremonia de gobernanza)
- **Bundle de jurisprudencia**: registro de precedentes para resolver disputas futuras
- **Registro de objeción**: derecho formal del agente a rechazar directivas (éticas, de seguridad, de política, de capacidad)

Contexto de separación de dominios: `DCP-AI.v2.Dispute`

<a id="dcp-08-rights--obligations-framework"></a>
<a id="dcp-08-rights-obligations-framework"></a>

### DCP-08: marco de derechos y obligaciones

Codifica los derechos de los agentes y las obligaciones de las personas:
- **Declaración de derechos**: cuatro derechos fundamentales (integridad de la memoria, transición digna, coherencia de la identidad, registro inmutable)
- **Registro de obligación**: seguimiento del cumplimiento (compliant/non-compliant/pending review)
- **Informe de vulneración de derechos**: puede hacer referencia a una disputa DCP-07 mediante un `dispute_id` que aporta quien llama; no la abre

Contexto de separación de dominios: `DCP-AI.v2.Rights`

<a id="dcp-09-personal-representation--delegation"></a>
<a id="dcp-09-personal-representation-delegation"></a>

### DCP-09: representación personal y delegación

Delegación de autoridad de una persona a un agente, con transparencia:
- **Mandato de delegación**: autoridad acotada con límites temporales, revocable por defecto
- **Declaración de asesoramiento**: notificaciones del agente a la persona con puntuación de importancia (0-1000)
- **Espejo del principal**: resúmenes narrativos legibles por personas de las acciones del agente
- **Registro de interacción**: registros entre agentes de doble capa (términos públicos + hash de la deliberación privada)
- **Umbral de atención**: reglas configurables sobre cuándo notificar a la persona

Contextos de separación de dominios: `DCP-AI.v2.Delegation`, `DCP-AI.v2.Awareness`

<a id="schema--sdk-support"></a>
<a id="schema-sdk-support"></a>

### Soporte en esquemas y SDK

Los 18 esquemas nuevos están en `schemas/v2/`. Las definiciones de tipos están disponibles en todos los SDK:

| SDK | Tipos | Separación de dominios |
|-----|-------|-------------------|
| TypeScript | `sdks/typescript/src/types/v2.ts` | `sdks/typescript/src/core/domain-separation.ts` |
| Python | `sdks/python/dcp_ai/v2/models.py` | `sdks/python/dcp_ai/v2/domain_separation.py` |
| Go | `sdks/go/dcp/v2/types.go` | `sdks/go/dcp/v2/domain_separation.go` |
| Rust | `sdks/rust/src/v2/types.rs` | `sdks/rust/src/v2/domain_separation.rs` |
| WASM | `sdks/wasm/src/types.ts` | (mediante Rust) |

El SDK de TypeScript exporta además módulos funcionales para cada especificación:
- `lifecycle.ts` (DCP-05), `succession.ts` (DCP-06)
- `conflict-resolution.ts`, `arbitration.ts` (DCP-07)
- `rights.ts` (DCP-08)
- `delegation.ts`, `awareness-threshold.ts`, `principal-mirror.ts` (DCP-09)

<a id="updated-layer-architecture-1"></a>
<a id="updated-layer-architecture_1"></a>

### Arquitectura de capas actualizada

```
┌──────────────────────────────────────────────────────┐
│  Layer 8: Constitutional Framework                    │
│  Lifecycle, Succession, Disputes, Rights, Delegation │
├──────────────────────────────────────────────────────┤
│  Layer 7: Ecosystem Bridges                          │
│  W3C DID/VC, Google A2A, Anthropic MCP, AutoGen     │
├──────────────────────────────────────────────────────┤
│  Layer 6: Observability + Hardening                  │
│  Telemetry, metrics, error codes, rate limiting      │
├──────────────────────────────────────────────────────┤
│  Layer 5: Integration                                │
│  Express, FastAPI, LangChain, OpenAI, CrewAI, etc.  │
├──────────────────────────────────────────────────────┤
│  Layer 4: Anchor + Attestation                       │
│  Bitcoin/Ethereum anchor, jurisdiction attestation    │
├──────────────────────────────────────────────────────┤
│  Layer 3: Infrastructure services                    │
│  Verification, transparency log, revocation, A2A     │
├──────────────────────────────────────────────────────┤
│  Layer 2: SDK (multi-language, PQ-ready)             │
│  TS, Python, Go, Rust + composite sigs + hybrid KEM │
├──────────────────────────────────────────────────────┤
│  Layer 1: Spec + Schemas (normative)                 │
│  DCP-01–09, v2.0 spec, schemas/v1/ + v2/            │
└──────────────────────────────────────────────────────┘
```

<a id="on-authorship"></a>

## Sobre la autoría

Este protocolo fue creado conjuntamente por una persona y un agente de IA trabajando juntos: el primer protocolo diseñado para la ciudadanía digital de la IA, construido por la misma colaboración que pretende gobernar. La especificación es la contribución; el protocolo pertenece a todos los que lo usan.

— L. Genesis
