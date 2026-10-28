<sub>[English](README.md) · [中文](README.zh-CN.md) · **Español** · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="documentation"></a>

# Documentación

> Traducción informativa de [la versión en inglés](README.md), actualizada el 28/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Este índice organiza la documentación de DCP-AI por tarea: primeros pasos, arquitectura y seguridad, pruebas, referencia,
operaciones, especificaciones y propuestas. Las versiones actuales de los paquetes en cada registro están en
[Versiones publicadas](#published-versions).

<a id="published-versions"></a>

## Versiones publicadas

Verificadas el 28/10/2026. Las versiones de los paquetes son independientes de la versión del formato de intercambio y de la especificación de DCP (2.0).

| Registro | Paquete | Versión | Notas de publicación |
|---|---|---|---|
| npm | [`@dcp-ai/sdk`](https://www.npmjs.com/package/@dcp-ai/sdk) (SDK de TypeScript) | 2.2.1 | [paquetes npm](NPM_RELEASES.md) |
| npm | [`@dcp-ai/wasm`](https://www.npmjs.com/package/@dcp-ai/wasm) | 2.1.1 | [paquetes npm](NPM_RELEASES.md) |
| npm | [`@dcp-ai/cli`](https://www.npmjs.com/package/@dcp-ai/cli) | 2.1.1 | [paquetes npm](NPM_RELEASES.md) |
| PyPI | [`dcp-ai`](https://pypi.org/project/dcp-ai/2.10.1/) (SDK de Python) | 2.10.1 | [publicación de Python](PYTHON_RELEASE.md) |
| Go modules | `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` | v2.11.1 | [publicación de Go](GO_RELEASE.md) |
| crates.io | [`dcp-ai`](https://crates.io/crates/dcp-ai/2.11.1) (SDK de Rust) | 2.11.1 | [publicación de Rust](RUST_RELEASE.md) |

- Estas versiones verifican los campos secundarios SHA3-256 opcionales de V2-11 cuando están presentes; los ausentes no se exigen, así que un bundle verificado puede no tener una cadena secundaria completa, y un campo presente incoherente se rechaza. Las versiones anteriores no los comprueban. Los adaptadores publicados `@dcp-ai/express`, `@dcp-ai/openclaw`, `@dcp-ai/anthropic-mcp` y `@dcp-ai/google-a2a` 2.1.0 no se volvieron a publicar: dependen de `@dcp-ai/sdk` `^2.2.0` y obtienen las comprobaciones secundarias cuando tu lockfile resuelve `@dcp-ai/sdk` 2.2.1 o posterior.
- Los adaptadores y generadores de proyectos de npm son opcionales e independientes del núcleo del protocolo; sus versiones exactas
  están en [NPM_RELEASES.md](NPM_RELEASES.md), que lista los 13 paquetes npm.
- Las versiones anteriores afectadas y las notas de actualización están en [SECURITY.md](../SECURITY.md#supported-versions); el paso
  desde DCP v1.0 se explica en [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md).
- En todos los SDK, `dcp-jcs-v1` sigue siendo la canonicalización normativa y predeterminada; las API de `dcp-jcs-v2` son
  experimentales y opt-in. La verificación no establece la confianza en el principal, la admisión ni la autorización.
- Este inventario cubre los cuatro registros anteriores; no cubre las imágenes de contenedores.

<a id="quick-start"></a>

## Inicio rápido

- [QUICKSTART.md](QUICKSTART.md) — Producir y verificar evidencias con un SDK (paquetes publicados o copia del repositorio); las demos se señalan aparte
- [QUICKSTART_EXPRESS.md](QUICKSTART_EXPRESS.md) — Integración del middleware de Express
- [QUICKSTART_LANGCHAIN.md](QUICKSTART_LANGCHAIN.md) — Envolver herramientas de LangChain
- [QUICKSTART_OPENAI.md](QUICKSTART_OPENAI.md) — Llamadas a funciones de OpenAI (SDK de Node, Chat Completions; wrapper del cliente de Python)
- [QUICKSTART_CREWAI.md](QUICKSTART_CREWAI.md) — Equipos multiagente de CrewAI
- [QUICKSTART_AGNO.md](QUICKSTART_AGNO.md) — Agentes, equipos y workflows de Agno con `agno-dcp`

<a id="architecture--security"></a>
<a id="architecture-security"></a>

## Arquitectura y seguridad

- [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) — Arquitectura del sistema y plan de despliegue
- [SECURITY_MODEL.md](SECURITY_MODEL.md) — Modelo de amenazas, vectores de ataque, capas de protección
- [STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md) — Almacenamiento P2P y anclaje opcional en blockchain
- [ARCHITECTURE.md](ARCHITECTURE.md) — Mapa del repositorio para quienes contribuyen
- [OBSERVABILITY.md](OBSERVABILITY.md) — Trazas y métricas de OpenTelemetry desde los SDK

<a id="testing--assurance"></a>
<a id="testing-assurance"></a>

## Pruebas y garantías

- [tools/interop-matrix](../tools/interop-matrix/README.md) — Agentes reales en los cuatro SDK firman y verifican los bundles de los demás, intactos y manipulados en tránsito
- [tools/difffuzz](../tools/difffuzz/README.md) — Fuzzing diferencial de los cuatro verificadores V2
- [tests/interop/v2](../tests/interop/v2/) — Vectores compartidos que cada SDK debe aceptar o rechazar
- [tests/interop/candidate/phase4](../tests/interop/candidate/phase4/README.md) — Matriz cruzada de los productores experimentales de `dcp-jcs-v2` (cinco SDK)

<a id="reference"></a>

## Referencia

- [API_REFERENCE.md](API_REFERENCE.md) — Referencia de la API del SDK de TypeScript, tal como está en `main`
- [NIST_CONFORMITY.md](NIST_CONFORMITY.md) — Declaración de conformidad con NIST FIPS 203/204/205
- [EU_AI_ACT_MAPPING.md](EU_AI_ACT_MAPPING.md) — Obligaciones de registro, supervisión humana y conservación de registros del Reglamento de IA de la UE (Reglamento (UE) 2024/1689) correlacionadas con los artefactos DCP
- [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md) — Migrar de DCP v1.0 a v2.0

<a id="operations"></a>

## Operación

- [OPERATOR_GUIDE.md](OPERATOR_GUIDE.md) — Ejecutar un servicio de verificación DCP
- [ADMISSION.md](ADMISSION.md) — Aceptar bundles solo de principales de confianza, y el perfil strict-v1
- [AGENT_CREATION_AND_CERTIFICATION.md](AGENT_CREATION_AND_CERTIFICATION.md) — Flujo de creación y certificación de agentes

<a id="specifications"></a>

## Especificaciones

- [spec/DCP-01.md](../spec/DCP-01.md) — Identidad y vinculación del principal responsable
- [spec/DCP-02.md](../spec/DCP-02.md) — Declaración de intenciones y control por políticas
- [spec/DCP-03.md](../spec/DCP-03.md) — Cadena de auditoría y transparencia
- [spec/DCP-04.md](../spec/DCP-04.md) — Comunicación entre agentes
- [spec/DCP-05.md](../spec/DCP-05.md) — Gestión del ciclo de vida de los agentes
- [spec/DCP-06.md](../spec/DCP-06.md) — Sucesión y herencia digital
- [spec/DCP-07.md](../spec/DCP-07.md) — Resolución de conflictos y arbitraje de disputas
- [spec/DCP-08.md](../spec/DCP-08.md) — Marco de derechos y obligaciones
- [spec/DCP-09.md](../spec/DCP-09.md) — Representación personal y delegación
- [spec/profiles](../spec/profiles/README.md) — Perfiles opcionales: criptografía, A2A, gobierno y admisión

<a id="proposals-experimental-not-normative"></a>

## Propuestas (experimentales, no normativas)

- [proposals/canonicalization-candidate](proposals/canonicalization-candidate/README.md) — El candidato inactivo `dcp-jcs-v2` y sus API opt-in de los SDK; `dcp-jcs-v1` sigue siendo el único perfil

<a id="community--vision"></a>
<a id="community-vision"></a>

## Comunidad y visión

- [EARLY_ADOPTERS.md](EARLY_ADOPTERS.md) — Programa de adoptantes tempranos, beneficios y requisitos
- [GENESIS_PAPER.md](GENESIS_PAPER.md) — Documento fundacional

---

Para las especificaciones del protocolo, véase [spec/](../spec/). Para las pautas de contribución, véase [CONTRIBUTING.md](../CONTRIBUTING.md).
