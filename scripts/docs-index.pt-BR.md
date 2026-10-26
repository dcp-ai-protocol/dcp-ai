---
hide:
  - navigation
  - toc
---

<sub>[English](docs-index.md) · [中文](docs-index.zh-CN.md) · [Español](docs-index.es.md) · [日本語](docs-index.ja.md) · **Português**</sub>

<a id="dcp-ai--digital-citizenship-protocol-for-ai-agents"></a>
<a id="dcp-ai-digital-citizenship-protocol-for-ai-agents"></a>

# DCP-AI — Digital Citizenship Protocol para agentes de IA

**Publicação Python (26/10/2026).** O `dcp-ai` 2.10.0 já está disponível no PyPI, incluindo as correções do verificador, a admissão e as APIs experimentais opt-in. As publicações de Go e Rust continuam independentes. Veja [Python 2.10.0](reference/docs/PYTHON_RELEASE.md).

> Tradução informativa da [versão em inglês](docs-index.md), atualizada em 26/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

> Uma camada portátil de prestação de contas para agentes de IA em redes abertas.

Identidade verificável criptograficamente, intenção legível por máquina, trilhas de auditoria que permitem detectar adulterações, comunicação autenticada entre agentes, governança do ciclo de vida, prestação de contas procedimental e representação delegada, numa única pilha de protocolo híbrida e pós-quântica.

[Começar :material-rocket-launch:](quickstart/QUICKSTART.md){ .md-button .md-button--primary }
[Experimentar o playground :material-play-circle:](playground/){ .md-button }
[Ler o artigo :material-file-document:](https://doi.org/10.5281/zenodo.19040913){ .md-button }
[Ver no GitHub :material-github:](https://github.com/dcp-ai-protocol/dcp-ai){ .md-button }

---

<a id="install"></a>

## Instalação

!!! note "Pacotes publicados e `main`"
    O npm já oferece `@dcp-ai/sdk` 2.2.0, `@dcp-ai/wasm` e `@dcp-ai/cli` 2.1.0, além dos adaptadores e geradores atualizados. Veja o [inventário npm](reference/docs/NPM_RELEASES.md). A publicação de Python, Go e Rust é independente; o [início rápido](quickstart/QUICKSTART.md#published-packages-and-this-guide) distingue exemplos do registro e do checkout.

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
    go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@latest
    ```

=== "Rust"

    ```bash
    cargo add dcp-ai
    ```

=== "WebAssembly"

    ```bash
    npm install @dcp-ai/wasm@^2.1.0
    ```

---

<a id="the-nine-specifications"></a>

## As nove especificações

<div class="grid cards" markdown>

-   :material-card-account-details:{ .lg .middle } **DCP-01 — Identidade e vinculação humana**

    ---

    Cada agente é vinculado criptograficamente a uma pessoa ou entidade jurídica responsável que assume a prestação de contas.

    [Ler →](specs/DCP-01.md)

-   :material-target:{ .lg .middle } **DCP-02 — Declaração de intenção e controle por políticas**

    ---

    Os agentes declaram intenções estruturadas antes de agir; os verificadores aplicam decisões de política conforme o nível.

    [Ler →](specs/DCP-02.md)

-   :material-link-variant:{ .lg .middle } **DCP-03 — Cadeia de auditoria e transparência**

    ---

    Entradas de auditoria encadeadas por hash, com provas de Merkle e inclusão opcional num log de transparência.

    [Ler →](specs/DCP-03.md)

-   :material-account-group:{ .lg .middle } **DCP-04 — Comunicação entre agentes**

    ---

    Mensagens autenticadas entre agentes, descoberta, handshake, delegação, cadeias de confiança.

    [Ler →](specs/DCP-04.md)

-   :material-heart-pulse:{ .lg .middle } **DCP-05 — Ciclo de vida dos agentes**

    ---

    Comissionamento, relatórios de vitalidade, descomissionamento: quatro modos de encerramento, com registro que permite detectar adulterações.

    [Ler →](specs/DCP-05.md)

-   :material-file-sign:{ .lg .middle } **DCP-06 — Sucessão e herança**

    ---

    Testamentos digitais e cerimônias de sucessão preservam a continuidade entre gerações de agentes.

    [Ler →](specs/DCP-06.md)

-   :material-gavel:{ .lg .middle } **DCP-07 — Resolução de conflitos**

    ---

    Escalonamento em três níveis, painéis de arbitragem M de N, pacotes de jurisprudência como precedente.

    [Ler →](specs/DCP-07.md)

-   :material-scale-balance:{ .lg .middle } **DCP-08 — Direitos e obrigações**

    ---

    Quatro direitos fundamentais dos agentes, acompanhamento estruturado de obrigações, relato de violações.

    [Ler →](specs/DCP-08.md)

-   :material-account-tie:{ .lg .middle } **DCP-09 — Delegação e representação**

    ---

    Mandatos de delegação, limiares de alerta, espelhos do principal, registros de interação em duas camadas.

    [Ler →](specs/DCP-09.md)

</div>

---

<a id="whats-in-the-box"></a>

## O que vem incluído

<div class="grid cards" markdown>

-   :material-package-variant-closed:{ .lg .middle } **5 SDKs**

    ---

    TypeScript, Python, Go, Rust, WebAssembly: o mesmo protocolo central e vetores de teste compartilhados; o README de cada SDK lista o que ele ainda não cobre e seu status de publicação.

    `@dcp-ai/sdk`, `dcp-ai` (PyPI), `dcp-ai` (crates.io), `sdks/go/v2`, `@dcp-ai/wasm`

-   :material-connection:{ .lg .middle } **11 integrações**

    ---

    Pontes com frameworks web e de IA populares. Eles diferem no que verificam: alguns verificam bundles assinados,
    outros registram eventos não assinados ou não aplicam nenhuma política, e alguns pacotes publicados não têm correções que estão em
    `main` ([versões suportadas](reference/SECURITY.md#supported-versions)). Leia os limites de cada um antes de
    depender dele:

    [Express](reference/integrations/express/README.md), [FastAPI](reference/integrations/fastapi/README.md), [LangChain](reference/integrations/langchain/README.md), [OpenAI](reference/integrations/openai/README.md), [CrewAI](reference/integrations/crewai/README.md), [Agno](quickstart/QUICKSTART_AGNO.md), [OpenClaw](reference/integrations/openclaw/README.md), [W3C DID](reference/integrations/w3c-did/README.md), [Google A2A](reference/integrations/google-a2a/README.md), [Anthropic MCP](reference/integrations/anthropic-mcp/README.md), [AutoGen](reference/integrations/autogen/README.md)

-   :material-shield-key:{ .lg .middle } **Criptografia híbrida pós-quântica**

    ---

    Assinaturas compostas Ed25519 + ML-DSA-65, SLH-DSA-192f como reserva, cadeias de auditoria duplas SHA-256 / SHA3-256. Quatro níveis adaptativos (de Routine a Maximum).

    [Modelo de segurança →](architecture/SECURITY_MODEL.md)

-   :material-console:{ .lg .middle } **CLI e serviços de referência**

    ---

    CLI `dcp-ai`, servidor de verificação, serviço de ancoragem (registros locais; o envio à blockchain não está implementado), log de transparência, registro de revogações. Pilha completa com Docker Compose.

    [Guia do operador →](guides/OPERATOR_GUIDE.md)

</div>

---

<a id="cite"></a>

## Como citar

Se você usa o DCP-AI na sua pesquisa, cite **ambos**: o artigo conceitual e a versão específica do software que usou.

**Artigo** — *Agents Don't Need a Better Brain — They Need a World: Toward a Digital Citizenship Protocol for Autonomous AI Systems*
Naranjo Emparanza, D. (2026). Zenodo. [`10.5281/zenodo.19040913`](https://doi.org/10.5281/zenodo.19040913)

**Software** — cite a versão que usou. O DOI de conceito [`10.5281/zenodo.19656025`](https://doi.org/10.5281/zenodo.19656025) aponta para a versão arquivada mais recente; a v2.0.2 é
*DCP-AI v2.0.2 — Digital Citizenship Protocol for AI Agents (Reference Implementation)*, Naranjo Emparanza, D. (2026). Zenodo. [`10.5281/zenodo.19656026`](https://doi.org/10.5281/zenodo.19656026)

---

<p style="text-align: center; font-style: italic; color: var(--md-default-fg-color--light);">
«Este protocolo foi criado em conjunto por uma pessoa e um agente de IA: pensado para a colaboração que pretende governar.»
</p>
