---
hide:
  - navigation
  - toc
---

<sub>[English](docs-index.md) · [中文](docs-index.zh-CN.md) · **Español** · [日本語](docs-index.ja.md) · [Português](docs-index.pt-BR.md)</sub>

<a id="dcp-ai--digital-citizenship-protocol-for-ai-agents"></a>
<a id="dcp-ai-digital-citizenship-protocol-for-ai-agents"></a>

# DCP-AI — Digital Citizenship Protocol para agentes de IA

> Traducción informativa de [la versión en inglés](docs-index.md), actualizada el 27/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

> Una capa portátil de rendición de cuentas para agentes de IA en redes abiertas.

Identidad verificable criptográficamente, intención legible por máquinas, trazas de auditoría que permiten detectar manipulaciones, comunicación autenticada entre agentes, gobierno del ciclo de vida, rendición de cuentas procedimental y representación delegada, en una sola pila de protocolo híbrida y poscuántica.

[Empezar :material-rocket-launch:](quickstart/QUICKSTART.md){ .md-button .md-button--primary }
[Probar el playground :material-play-circle:](playground/){ .md-button }
[Leer el artículo :material-file-document:](https://doi.org/10.5281/zenodo.19040913){ .md-button }
[Ver en GitHub :material-github:](https://github.com/dcp-ai-protocol/dcp-ai){ .md-button }

---

<a id="install"></a>

## Instalación

!!! note "Paquetes publicados y `main`"
    Las versiones actuales en npm, PyPI, módulos Go y crates.io están en [Versiones publicadas](reference/docs/README.md#published-versions). El [inicio rápido](quickstart/QUICKSTART.md#published-packages-and-this-guide) distingue ejemplos del registro y del checkout.

=== "Node.js"

    ```bash
    npm install @dcp-ai/sdk@^2.2.0 @dcp-ai/cli
    ```

=== "Python"

    ```bash
    pip install dcp-ai
    ```

=== "Go"

    ```bash
    go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.11.0
    ```

=== "Rust"

    ```bash
    cargo add dcp-ai@2.11.0
    ```

=== "WebAssembly"

    ```bash
    npm install @dcp-ai/wasm@^2.1.0
    ```

---

<a id="the-nine-specifications"></a>

## Las nueve especificaciones

<div class="grid cards" markdown>

-   :material-card-account-details:{ .lg .middle } **DCP-01 — Identidad y vinculación humana**

    ---

    Cada agente queda vinculado criptográficamente a una persona o entidad jurídica responsable que asume la rendición de cuentas.

    [Leer →](specs/DCP-01.md)

-   :material-target:{ .lg .middle } **DCP-02 — Declaración de intenciones y control por políticas**

    ---

    Los agentes declaran intenciones estructuradas antes de actuar; los verificadores aplican decisiones de política según el nivel.

    [Leer →](specs/DCP-02.md)

-   :material-link-variant:{ .lg .middle } **DCP-03 — Cadena de auditoría y transparencia**

    ---

    Entradas de auditoría encadenadas por hash, con pruebas de Merkle e inclusión opcional en un registro de transparencia.

    [Leer →](specs/DCP-03.md)

-   :material-account-group:{ .lg .middle } **DCP-04 — Comunicación entre agentes**

    ---

    Mensajería autenticada entre agentes, descubrimiento, handshake, delegación, cadenas de confianza.

    [Leer →](specs/DCP-04.md)

-   :material-heart-pulse:{ .lg .middle } **DCP-05 — Ciclo de vida de los agentes**

    ---

    Puesta en servicio, informes de vitalidad, retirada: cuatro modos de terminación, con registro que permite detectar manipulaciones.

    [Leer →](specs/DCP-05.md)

-   :material-file-sign:{ .lg .middle } **DCP-06 — Sucesión y herencia**

    ---

    Testamentos digitales y ceremonias de sucesión preservan la continuidad entre generaciones de agentes.

    [Leer →](specs/DCP-06.md)

-   :material-gavel:{ .lg .middle } **DCP-07 — Resolución de conflictos**

    ---

    Escalado en tres niveles, paneles de arbitraje M de N, paquetes de jurisprudencia como precedente.

    [Leer →](specs/DCP-07.md)

-   :material-scale-balance:{ .lg .middle } **DCP-08 — Derechos y obligaciones**

    ---

    Cuatro derechos fundamentales de los agentes, seguimiento estructurado de obligaciones, notificación de vulneraciones.

    [Leer →](specs/DCP-08.md)

-   :material-account-tie:{ .lg .middle } **DCP-09 — Delegación y representación**

    ---

    Mandatos de delegación, umbrales de alerta, espejos del principal, registros de interacción en dos capas.

    [Leer →](specs/DCP-09.md)

</div>

---

<a id="whats-in-the-box"></a>

## Qué incluye

<div class="grid cards" markdown>

-   :material-package-variant-closed:{ .lg .middle } **5 SDK**

    ---

    TypeScript, Python, Go, Rust, WebAssembly: el mismo protocolo central y vectores de prueba compartidos; el README de cada SDK indica lo que todavía no cubre y su estado de publicación.

    `@dcp-ai/sdk`, `dcp-ai` (PyPI), `dcp-ai` (crates.io), `sdks/go/v2`, `@dcp-ai/wasm`

-   :material-connection:{ .lg .middle } **11 integraciones**

    ---

    Puentes con frameworks web y de IA populares. Difieren en lo que comprueban: algunos verifican bundles firmados,
    otros registran eventos sin firmar o no aplican ninguna política, y las versiones publicadas anteriores pueden carecer de correcciones incluidas
    en las publicaciones actuales ([versiones admitidas](reference/SECURITY.md#supported-versions)). Lee los límites de cada uno antes de
    confiar en él:

    [Express](reference/integrations/express/README.md), [FastAPI](reference/integrations/fastapi/README.md), [LangChain](reference/integrations/langchain/README.md), [OpenAI](reference/integrations/openai/README.md), [CrewAI](reference/integrations/crewai/README.md), [Agno](quickstart/QUICKSTART_AGNO.md), [OpenClaw](reference/integrations/openclaw/README.md), [W3C DID](reference/integrations/w3c-did/README.md), [Google A2A](reference/integrations/google-a2a/README.md), [Anthropic MCP](reference/integrations/anthropic-mcp/README.md), [AutoGen](reference/integrations/autogen/README.md)

-   :material-shield-key:{ .lg .middle } **Criptografía híbrida poscuántica**

    ---

    Firmas compuestas Ed25519 + ML-DSA-65, SLH-DSA-192f como respaldo, cadenas de auditoría duales SHA-256 / SHA3-256. Cuatro niveles adaptativos (de Routine a Maximum).

    [Modelo de seguridad →](architecture/SECURITY_MODEL.md)

-   :material-console:{ .lg .middle } **CLI y servicios de referencia**

    ---

    CLI `dcp-ai`, servidor de verificación, servicio de anclaje (registros locales; el envío a la cadena no está implementado), registro de transparencia, registro de revocaciones. Pila completa con Docker Compose.

    [Guía del operador →](guides/OPERATOR_GUIDE.md)

</div>

---

<a id="cite"></a>

## Cómo citar

Si usas DCP-AI en tu investigación, cita **ambos**: el artículo conceptual y la versión concreta del software que usaste.

**Artículo** — *Agents Don't Need a Better Brain — They Need a World: Toward a Digital Citizenship Protocol for Autonomous AI Systems*
Naranjo Emparanza, D. (2026). Zenodo. [`10.5281/zenodo.19040913`](https://doi.org/10.5281/zenodo.19040913)

**Software** — cita la versión que usaste. El DOI de concepto [`10.5281/zenodo.19656025`](https://doi.org/10.5281/zenodo.19656025) apunta a la última versión archivada; la v2.0.2 es
*DCP-AI v2.0.2 — Digital Citizenship Protocol for AI Agents (Reference Implementation)*, Naranjo Emparanza, D. (2026). Zenodo. [`10.5281/zenodo.19656026`](https://doi.org/10.5281/zenodo.19656026)

---

<p style="text-align: center; font-style: italic; color: var(--md-default-fg-color--light);">
«Este protocolo lo crearon conjuntamente una persona y un agente de IA: diseñado para la colaboración que pretende gobernar».
</p>
