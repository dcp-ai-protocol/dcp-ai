<sub>[English](README.md) · [中文](README.zh-CN.md) · **Español** · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="documentation"></a>

# Documentación

**Publicación npm (26/10/2026).** Las 13 versiones de [NPM_RELEASES.md](NPM_RELEASES.md) están publicadas, incluidas las API candidatas TypeScript/WASM y la admisión TypeScript. Las entradas siguientes conservan su historial de desarrollo; `[Unreleased]` no significa que estas funciones npm no estén disponibles. Las publicaciones de Python, Go y Rust son independientes.

> Traducción informativa de [la versión en inglés](README.md), actualizada el 26/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

<a id="quick-start"></a>

## Inicio rápido

- [QUICKSTART.md](QUICKSTART.md) — Empezar en pocos minutos (paquetes publicados y copia del repositorio)
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
