<sub>[English](ARCHITECTURE.md) · [中文](ARCHITECTURE.zh-CN.md) · **Español** · [日本語](ARCHITECTURE.ja.md) · [Português](ARCHITECTURE.pt-BR.md)</sub>

<a id="architecture-map"></a>

# Mapa de la arquitectura

> Traducción informativa de [la versión en inglés](ARCHITECTURE.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Este documento es una orientación de 2 minutos para nuevos colaboradores. Explica **dónde vive cada pieza y por qué**: lo suficiente para encaminar un PR o un informe de error sin tener que adivinar.

Para la especificación normativa del protocolo, véase [`spec/`](../spec/README.md). Para ejecutar las pruebas y compilar, véase [`CONTRIBUTING.md`](../CONTRIBUTING.md).

<a id="mental-model"></a>

## Modelo mental

DCP-AI es una **capa portable de rendición de cuentas** para agentes de IA. Las capas del repositorio, de la más normativa a la más operativa:

```
┌───────────────────────────────────────────────────────────────────┐
│  spec/ + schemas/           ← source of truth (what IS DCP)        │
│  ─────────────────────                                             │
│  tests/                     ← conformance + interop + NIST KAT     │
│  ─────────────────────                                             │
│  sdks/{ts,py,rust,go,wasm}  ← reference implementations            │
│  ─────────────────────                                             │
│  integrations/              ← bindings for popular frameworks      │
│  cli/                       ← interactive CLI (@dcp-ai/cli)        │
│  packages/create-*          ← npm create scaffolders               │
│  ─────────────────────                                             │
│  services/                  ← operational infra (anchor, log, …)   │
│  contracts/                 ← on-chain artifacts (DCPAnchor.sol)   │
│  ─────────────────────                                             │
│  docs/ + docs-site/ + site/ ← hand-written docs + generated site   │
│  playground/                ← in-browser interactive demo          │
└───────────────────────────────────────────────────────────────────┘
```

Cuanto más arriba de esa pila estés, más estricta es la revisión del cambio:
las modificaciones de la especificación exigen que los cinco SDK sigan sincronizados; una modificación de la documentación es autónoma.

<a id="top-level-directories"></a>

## Directorios de primer nivel

| Ruta | Qué es | Destino de publicación |
|---|---|---|
| [`spec/`](../spec/) | Especificaciones normativas DCP-01 a DCP-09, más las extensiones de perfil (criptografía, A2A, gobernanza, admisión). El texto en inglés es el normativo; las traducciones son informativas. | — |
| [`schemas/`](../schemas/) | Definiciones JSON Schema (draft 2020-12) de cada artefacto del protocolo. v1 (9 esquemas) + v2 (42 esquemas). | — |
| [`tests/conformance/`](../tests/conformance/) | Suite de conformidad entre SDK que todos los SDK deben superar. Es la barrera que mantiene honesta la compatibilidad del formato de transmisión. | — |
| [`tests/interop/`](../tests/interop/) | Vectores de interoperabilidad: canonicalización, separación de dominio, firma compuesta, empalme de sesiones, ataques de eliminación. | — |
| [`tests/nist-kat/`](../tests/nist-kat/) | Vectores Ed25519 de la RFC 8032, pruebas de propiedades de ML-DSA-65 y vectores ACVP del NIST para SLH-DSA-192f / ML-KEM-768. | — |
| [`sdks/typescript/`](../sdks/typescript/) | SDK de TypeScript de referencia. | npm `@dcp-ai/sdk` |
| [`sdks/python/`](../sdks/python/) | SDK de Python de referencia. | PyPI `dcp-ai` |
| [`sdks/rust/`](../sdks/rust/) | SDK de Rust de referencia (también compilado a WASM). | crates.io `dcp-ai` |
| [`sdks/go/`](../sdks/go/) | SDK de Go de referencia. | Módulos de Go `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` |
| [`sdks/wasm/`](../sdks/wasm/) | Bundle WebAssembly del SDK de Rust para navegador + Node. | npm `@dcp-ai/wasm` |
| [`integrations/`](../integrations/) | 10 vinculaciones con frameworks: Express, FastAPI, LangChain, OpenAI, CrewAI, OpenClaw, W3C DID, Google A2A, Anthropic MCP, AutoGen. | npm `@dcp-ai/<name>` (seis paquetes); PyPI `dcp-ai[<extra>]` (FastAPI, LangChain, OpenAI, CrewAI) |
| [`packages/create-*`](../packages/) | Generadores invocados mediante `npm create @dcp-ai/<framework>`. Uno por cada framework principal. | npm `@dcp-ai/create-<name>` |
| [`cli/`](../cli/) | CLI con asistente interactivo, alternativa a `bin/dcp.js` para nuevos usuarios. | npm `@dcp-ai/cli` |
| [`bin/`](../bin/) | CLI de referencia en JavaScript que usa la suite de conformidad. | Paquete raíz (no publicado en npm); se ejecuta desde una copia del repositorio. |
| [`services/`](../services/) | Servicios operativos de referencia: anchor (agrupa hashes en memoria; todavía no hay envío on-chain), transparency-log (registro en árbol de Merkle con cabezas de árbol firmadas y gossip), revocation. | Imágenes Docker → GHCR |
| [`contracts/ethereum/`](../contracts/ethereum/) | `DCPAnchor.sol` + pruebas de Foundry. | Despliegue on-chain |
| [`api/`](../api/) | Artefactos del formato de transmisión: OpenAPI (`openapi.yaml`) + Protocol Buffers (`proto/`). | — |
| [`lib/`](../lib/) | La biblioteca de verificación de referencia (`lib/verify.js`) y utilidades que usan el paquete raíz, el servidor y los servicios. | Paquete raíz (no publicado en npm). |
| [`tools/`](../tools/) | CLI internas del repositorio (`validate.js`, `conformance.js`, `crypto.js`, `merkle.js`). No se publican. | — |
| [`scripts/`](../scripts/) | Utilidades de compilación puntuales (generadores de ejemplos, emisión de las huellas del protocolo). | — |
| [`docs/`](../docs/) | Documentación escrita a mano: QUICKSTART, OBSERVABILITY, ARCHITECTURE (este archivo), notas de SECURITY, guías de migración. | La consume MkDocs. |
| `docs-site/` | Generado y no versionado (`.gitignore`): el árbol de preparación por idioma que `scripts/docs_site.py` escribe para la construcción con MkDocs. La configuración del sitio es [`mkdocs.yml`](../mkdocs.yml). | — |
| `site/` | Generado y no versionado (`.gitignore`): el sitio de documentación en cinco idiomas que construye `bash scripts/build-docs-site.sh`. | GitHub Pages, mediante `.github/workflows/docs.yml`. |
| [`playground/`](../playground/) | Playground interactivo en el navegador (JavaScript simple; Ed25519 con `tweetnacl`, SHA-256 con WebCrypto; sus firmas ML-DSA / SLH-DSA están simuladas, como indica la página). | Alojado en docs.dcp-ai.org/playground/. |
| [`templates/`](../templates/) | Plantillas de origen que consumen los generadores `packages/create-*`. | — |
| [`deploy/`](../deploy/) | Configuraciones de Fly.io y de despliegue de los servicios. | — |
| [`keys/`](../keys/) | Claves de demostración que usan las pruebas de conformidad y los ejemplos. **No las uses en producción.** | — |
| [`credentials/`](../credentials/) | Archivos @context JSON-LD servidos en dcp-ai.org/credentials/v2. | GitHub Pages. |

<a id="how-the-pieces-talk-to-each-other"></a>

## Cómo se comunican las piezas

- **Especificación → SDK.** `spec/` y `schemas/` los leen personas; los SDK los implementan. Cada SDK vuelve a implementar la canonicalización, el hash, la firma y la verificación para producir artefactos compatibles en el formato de transmisión. La suite de conformidad de `tests/conformance/` ejecuta los mismos vectores contra todos los SDK en la CI.
- **SDK → integraciones.** Cada paquete `integrations/*` usa el SDK de su lenguaje como dependencia; p. ej., `@dcp-ai/express` depende de `@dcp-ai/sdk`. Ninguna integración vuelve a implementar la criptografía.
- **Integraciones → generadores.** Los `packages/create-*` distribuyen el código mínimo que un usuario necesita para empezar un proyecto sobre una integración concreta.
- **SDK → servicios.** El servidor de verificación y el servicio de revocación verifican mediante `lib/verify.js` y `@dcp-ai/sdk`. El registro de transparencia firma sus cabezas de árbol directamente con `tweetnacl`, y el servicio de anclaje solo calcula hashes.
- **Paquete raíz (`dcp-ai`, no publicado en npm).** El `package.json` de primer nivel contiene la CLI de referencia + la biblioteca de verificación (`bin/dcp.js`, `lib/verify.js`) y el arnés de conformidad. V1 se verifica allí mismo; V2 se valida allí contra el esquema y después lo verifica `@dcp-ai/sdk`, de modo que hay una única implementación de V2. Es el punto de entrada original; la mayoría de los nuevos usuarios llegan en cambio a través de un SDK o de un generador.

<a id="where-to-change-what"></a>

## Dónde cambiar qué

| Quieres… | Edita |
|---|---|
| Proponer un artefacto nuevo o endurecer un esquema | `spec/` + `schemas/`; después actualiza todos los SDK de forma sincronizada y añade un vector de conformidad en `tests/conformance/`. |
| Corregir un error criptográfico en un lenguaje | `sdks/<language>/`. Añade una prueba de regresión. Si el error pudiera afectar a otros lenguajes, añade un vector de interoperabilidad compartido en `tests/interop/`. |
| Añadir una integración con un framework | `integrations/<framework>/`. Usa como dependencia el SDK del lenguaje correspondiente. Añade un generador en `packages/create-<framework>/` si es un framework principal. |
| Cambiar el sitio de marketing | No está en este repositorio (véase [Límite del alcance](#scope-boundary)). |
| Cambiar el sitio de documentación | Las fuentes Markdown y sus cuatro traducciones, `mkdocs.yml` y la lista de documentos publicados en `scripts/docs-i18n.json`; `docs-site/` y `site/` se generan. Véase [CONTRIBUTING.md](../CONTRIBUTING.md#documentation-and-translations). |
| Cambiar la demo interactiva | `playground/`. |
| Desplegar o volver a desplegar un servicio | `services/<name>/` + `deploy/fly/`. |
| Publicar una nueva versión de un SDK | Sube la versión en el `package.json` / `Cargo.toml` / `pyproject.toml` correspondiente o en la etiqueta de git; la CI lo detecta y publica mediante `.github/workflows/publish*.yml`. Omitir lo ya publicado está integrado. |

<a id="scope-boundary"></a>

## Límite del alcance

El monorepositorio contiene el **protocolo y sus implementaciones de referencia**: especificación, esquemas, los cinco SDK, integraciones con frameworks, generadores, CLI, servicios operativos, contratos inteligentes, documentación y el playground interactivo. Es todo lo que un tercero necesita para adoptar DCP-AI.

Las aplicaciones para usuarios finales (paneles, agentes, demos) y las superficies de marketing **no** están en este repositorio de forma intencionada. Pertenecen al código base que las aloje: son aplicaciones sobre el protocolo, no parte de él.

<a id="why-monorepo-today"></a>

## Por qué un monorepositorio hoy

Un protocolo con cinco SDK vive o muere por mantenerlos compatibles en el formato de transmisión. Revisar un PR que toca los cinco a la vez —y ejecutar la suite de conformidad contra los cinco en cada PR— es la forma más ligera de imponer ese invariante. En el momento en que un SDK o un componente concreto desarrolle su propia comunidad y su propio ritmo, separarlo será una respuesta razonable. Hasta entonces, el coste de coordinar varios repositorios supera los beneficios.

Lecturas adicionales: el modelo de gobernanza en [`GOVERNANCE.md`](../GOVERNANCE.md) y la dirección futura en [`ROADMAP.md`](../ROADMAP.md).
