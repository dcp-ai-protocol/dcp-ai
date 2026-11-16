<sub>[English](../../../docs/README.md) · [中文](../../zh-CN/docs/README.md) · **Español** · [日本語](../../ja/docs/README.md) · [Português](../../pt-BR/docs/README.md)</sub>

<a id="documentation"></a>

# Documentación

> Traducción informativa de [la versión en inglés](../../../docs/README.md), actualizada el 09/11/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Este índice organiza la documentación de DCP-AI por tarea: primeros pasos, arquitectura y seguridad, pruebas, referencia,
operaciones, especificaciones y propuestas. Las versiones actuales de los paquetes en cada registro están en
[Versiones publicadas](#published-versions).

<a id="published-versions"></a>

## Versiones publicadas

Verificadas el 09/11/2026. Las versiones de los paquetes son independientes de la versión del formato de intercambio y de la especificación de DCP (2.0).

| Registro | Paquete | Versión | Notas de publicación |
|---|---|---|---|
| npm | [`@dcp-ai/sdk`](https://www.npmjs.com/package/@dcp-ai/sdk) (SDK de TypeScript) | 2.4.0 | [paquetes npm](../../../docs/NPM_RELEASES.md) |
| npm | [`@dcp-ai/wasm`](https://www.npmjs.com/package/@dcp-ai/wasm) | 2.2.0 | [paquetes npm](../../../docs/NPM_RELEASES.md) |
| npm | [`@dcp-ai/cli`](https://www.npmjs.com/package/@dcp-ai/cli) | 2.2.0 | [paquetes npm](../../../docs/NPM_RELEASES.md) |
| PyPI | [`dcp-ai`](https://pypi.org/project/dcp-ai/2.11.0/) (SDK de Python) | 2.11.0 | [publicación de Python](../../../docs/PYTHON_RELEASE.md) |
| Go modules | `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` | v2.14.0 | [publicación de Go](../../../docs/GO_RELEASE.md) |
| crates.io | [`dcp-ai`](https://crates.io/crates/dcp-ai/2.14.0) (SDK de Rust) | 2.14.0 | [publicación de Rust](../../../docs/RUST_RELEASE.md) |

- Publicadas el 09/11/2026 desde `main` (`cdb7099b`): `@dcp-ai/sdk` 2.4.0, `@dcp-ai/wasm` 2.2.0, `@dcp-ai/cli` 2.2.0,
  `dcp-ai` 2.11.0, Go v2.14.0 y Rust `dcp-ai` 2.14.0. Los cuatro SDK añaden la admisión delegada, la admisión desde
  bytes y el acuse de mandato, de activación explícita, y todos los verificadores Ed25519 aplican P-ED-1, un cambio de
  aceptación que rechaza las codificaciones no canónicas y los puntos de orden pequeño. Conservan la validación de
  esquemas V2-2 del 05/11/2026 y, como las versiones desde el 28/10/2026, verifican los campos secundarios SHA3-256
  opcionales de V2-11 cuando están presentes. Véanse el [registro de cambios](../../../CHANGELOG.md#2026-11-09-six-releases) y las notas de publicación.
- `@dcp-ai/cli` 2.2.0 requiere `@dcp-ai/sdk` `^2.4.0`. Los adaptadores npm no se republicaron: sus rangos `^2.2.0`
  (`@dcp-ai/express`, `@dcp-ai/openclaw`, `@dcp-ai/anthropic-mcp` y `@dcp-ai/google-a2a`) aceptan `@dcp-ai/sdk`
  2.4.0, y obtienen sus comprobaciones, P-ED-1 incluido, solo cuando la instalación lo resuelve; un lockfile existente
  mantiene su resolución anterior hasta que lo actualices.
- El README de cada archivo del 09/11/2026 indica su propia versión y remite a esta tabla para su disponibilidad en el
  registro. Las versiones del 05/11/2026 y anteriores conservan sus notas en el
  [registro de cambios](../../../CHANGELOG.md#2026-11-05-auditable-releases) y en las notas de publicación.
- Los adaptadores y generadores de proyectos de npm son opcionales e independientes del núcleo del protocolo; sus versiones exactas
  están en [NPM_RELEASES.md](../../../docs/NPM_RELEASES.md), que lista los 13 paquetes npm.
- Las versiones anteriores afectadas y las notas de actualización están en [SECURITY.md](../../../SECURITY.md#supported-versions); el paso
  desde DCP v1.0 se explica en [MIGRATION_V1_V2.md](../../../docs/MIGRATION_V1_V2.md).
- En todos los SDK, `dcp-jcs-v1` sigue siendo la canonicalización normativa y predeterminada; las API de `dcp-jcs-v2` son
  experimentales y opt-in. La verificación no establece la confianza en el principal, la admisión ni la autorización.
- Este inventario cubre los cuatro registros anteriores; no cubre las imágenes de contenedores.

<a id="quick-start"></a>

## Inicio rápido

- [QUICKSTART.md](../../../docs/QUICKSTART.md) — Producir y verificar evidencias con un SDK (paquetes publicados o copia del repositorio); las demos se señalan aparte
- [QUICKSTART_EXPRESS.md](../../../docs/QUICKSTART_EXPRESS.md) — Integración del middleware de Express
- [QUICKSTART_LANGCHAIN.md](../../../docs/QUICKSTART_LANGCHAIN.md) — Envolver herramientas de LangChain
- [QUICKSTART_OPENAI.md](../../../docs/QUICKSTART_OPENAI.md) — Llamadas a funciones de OpenAI (SDK de Node, Chat Completions; wrapper del cliente de Python)
- [QUICKSTART_CREWAI.md](../../../docs/QUICKSTART_CREWAI.md) — Equipos multiagente de CrewAI
- [QUICKSTART_AGNO.md](../../../docs/QUICKSTART_AGNO.md) — Agentes, equipos y workflows de Agno con `agno-dcp`

<a id="architecture--security"></a>
<a id="architecture-security"></a>

## Arquitectura y seguridad

- [TECHNICAL_ARCHITECTURE.md](../../../docs/TECHNICAL_ARCHITECTURE.md) — Arquitectura del sistema y plan de despliegue
- [SECURITY_MODEL.md](../../../docs/SECURITY_MODEL.md) — Modelo de amenazas, vectores de ataque, capas de protección
- [STORAGE_AND_ANCHORING.md](../../../docs/STORAGE_AND_ANCHORING.md) — Almacenamiento P2P y anclaje opcional en blockchain
- [ARCHITECTURE.md](../../../docs/ARCHITECTURE.md) — Mapa del repositorio para quienes contribuyen
- [OBSERVABILITY.md](../../../docs/OBSERVABILITY.md) — Trazas y métricas de OpenTelemetry desde los SDK

<a id="testing--assurance"></a>
<a id="testing-assurance"></a>

## Pruebas y garantías

- [tools/interop-matrix](../../../tools/interop-matrix/README.md) — Agentes reales en los cuatro SDK firman y verifican los bundles de los demás, intactos y manipulados en tránsito
- [tools/difffuzz](../../../tools/difffuzz/README.md) — Fuzzing diferencial de los cuatro verificadores V2
- [tools/enterprise-rehearsal](../../../tools/enterprise-rehearsal/README.md) — Ensayo opcional de integración empresarial: paquetes construidos desde un commit, una aplicación Express y otra FastAPI, expectativas escritas antes de la ejecución
- [tests/interop/v2](../../../tests/interop/v2/) — Vectores compartidos que cada SDK debe aceptar o rechazar
- [tests/interop/candidate/phase4](../../../tests/interop/candidate/phase4/README.md) — Matriz cruzada de los productores experimentales de `dcp-jcs-v2` (cinco SDK)

<a id="reference"></a>

## Referencia

- [API_REFERENCE.md](../../../docs/API_REFERENCE.md) — Referencia de la API del SDK de TypeScript, tal como está en `main`
- [NIST_CONFORMITY.md](../../../docs/NIST_CONFORMITY.md) — Declaración de conformidad con NIST FIPS 203/204/205
- [EU_AI_ACT_MAPPING.md](../../../docs/EU_AI_ACT_MAPPING.md) — Obligaciones de registro, supervisión humana y conservación de registros del Reglamento de IA de la UE (Reglamento (UE) 2024/1689) correlacionadas con los artefactos DCP
- [MIGRATION_V1_V2.md](../../../docs/MIGRATION_V1_V2.md) — Migrar de DCP v1.0 a v2.0

<a id="operations"></a>

## Operación

- [OPERATOR_GUIDE.md](../../../docs/OPERATOR_GUIDE.md) — Ejecutar un servicio de verificación DCP
- [ADMISSION.md](../../../docs/ADMISSION.md) — Aceptar bundles solo de principales de confianza, y el perfil strict-v1
- [OPERATIONAL_LIMITS.md](../../../docs/OPERATIONAL_LIMITS.md) — Qué acota las entradas, las fuentes, la concurrencia, la desconexión y la caché, y qué fija el operador
- [AGENT_CREATION_AND_CERTIFICATION.md](../../../docs/AGENT_CREATION_AND_CERTIFICATION.md) — Flujo de creación y certificación de agentes

<a id="specifications"></a>

## Especificaciones

- [spec/DCP-01.md](../../../spec/DCP-01.md) — Identidad y vinculación del principal responsable
- [spec/DCP-02.md](../../../spec/DCP-02.md) — Declaración de intenciones y control por políticas
- [spec/DCP-03.md](../../../spec/DCP-03.md) — Cadena de auditoría y transparencia
- [spec/DCP-04.md](../../../spec/DCP-04.md) — Comunicación entre agentes
- [spec/DCP-05.md](../../../spec/DCP-05.md) — Gestión del ciclo de vida de los agentes
- [spec/DCP-06.md](../../../spec/DCP-06.md) — Sucesión y herencia digital
- [spec/DCP-07.md](../../../spec/DCP-07.md) — Resolución de conflictos y arbitraje de disputas
- [spec/DCP-08.md](../../../spec/DCP-08.md) — Marco de derechos y obligaciones
- [spec/DCP-09.md](../../../spec/DCP-09.md) — Representación personal y delegación
- [spec/profiles](../../../spec/profiles/README.md) — Perfiles opcionales: criptografía, A2A, gobierno y admisión

<a id="proposals-experimental-not-normative"></a>

## Propuestas (experimentales, no normativas)

- [proposals/canonicalization-candidate](../../../docs/proposals/canonicalization-candidate/README.md) — El candidato inactivo `dcp-jcs-v2` y sus API opt-in de los SDK; `dcp-jcs-v1` sigue siendo el único perfil

<a id="community--vision"></a>
<a id="community-vision"></a>

## Comunidad y visión

- [EARLY_ADOPTERS.md](../../../docs/EARLY_ADOPTERS.md) — Programa de adoptantes tempranos, beneficios y requisitos
- [GENESIS_PAPER.md](../../../docs/GENESIS_PAPER.md) — Documento fundacional

---

Para las especificaciones del protocolo, véase [spec/](../../../spec/). Para las pautas de contribución, véase [CONTRIBUTING.md](../../../CONTRIBUTING.md).
