---
hide:
  - navigation
  - toc
---

# DCP-AI — Digital Citizenship Protocol for AI Agents

> A portable accountability layer for AI agents on open networks.

Cryptographically verifiable identity, machine-readable intent, tamper-evident audit trails, authenticated agent-to-agent communication, lifecycle governance, procedural accountability, and delegated representation — in a single hybrid post-quantum protocol stack.

[Get started :material-rocket-launch:](quickstart/QUICKSTART.md){ .md-button .md-button--primary }
[Try the playground :material-play-circle:](playground/){ .md-button }
[Read the paper :material-file-document:](https://doi.org/10.5281/zenodo.19040913){ .md-button }
[View on GitHub :material-github:](https://github.com/dcp-ai-protocol/dcp-ai){ .md-button }

---

## Install

!!! note "Published packages and `main`"
    These commands install the published versions. On 25/10/2026 npm's `latest` `@dcp-ai/sdk` was 2.1.1,
    without the 2.2.0 verifier fixes; the guides follow the source on `main`, which also has unreleased
    features. To run them as written, build the SDKs from a checkout: see the
    [Quick Start](quickstart/QUICKSTART.md#published-packages-and-this-guide).

=== "Node.js"

    ```bash
    npm install @dcp-ai/sdk @dcp-ai/cli
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
    npm install @dcp-ai/wasm
    ```

---

## The nine specifications

<div class="grid cards" markdown>

-   :material-card-account-details:{ .lg .middle } **DCP-01 — Identity & Human Binding**

    ---

    Every agent is cryptographically bound to a responsible human or legal entity that assumes accountability.

    [Read →](specs/DCP-01.md)

-   :material-target:{ .lg .middle } **DCP-02 — Intent Declaration & Policy Gating**

    ---

    Agents declare structured intents before acting; verifiers apply tier-based policy decisions.

    [Read →](specs/DCP-02.md)

-   :material-link-variant:{ .lg .middle } **DCP-03 — Audit Chain & Transparency**

    ---

    Hash-chained audit entries with Merkle proofs and optional transparency log inclusion.

    [Read →](specs/DCP-03.md)

-   :material-account-group:{ .lg .middle } **DCP-04 — Agent-to-Agent Communication**

    ---

    Authenticated inter-agent messaging, discovery, handshake, delegation, trust chains.

    [Read →](specs/DCP-04.md)

-   :material-heart-pulse:{ .lg .middle } **DCP-05 — Agent Lifecycle**

    ---

    Commissioning, vitality reports, decommissioning — four termination modes, tamper-evident.

    [Read →](specs/DCP-05.md)

-   :material-file-sign:{ .lg .middle } **DCP-06 — Succession & Inheritance**

    ---

    Digital testaments and succession ceremonies preserve continuity across agent generations.

    [Read →](specs/DCP-06.md)

-   :material-gavel:{ .lg .middle } **DCP-07 — Conflict Resolution**

    ---

    Three-level escalation, M-of-N arbitration panels, jurisprudence bundles for precedent.

    [Read →](specs/DCP-07.md)

-   :material-scale-balance:{ .lg .middle } **DCP-08 — Rights & Obligations**

    ---

    Four foundational agent rights, structured obligation tracking, violation reporting.

    [Read →](specs/DCP-08.md)

-   :material-account-tie:{ .lg .middle } **DCP-09 — Delegation & Representation**

    ---

    Delegation mandates, awareness thresholds, principal mirrors, dual-layer interaction records.

    [Read →](specs/DCP-09.md)

</div>

---

## What's in the box

<div class="grid cards" markdown>

-   :material-package-variant-closed:{ .lg .middle } **5 SDKs**

    ---

    TypeScript, Python, Go, Rust, WebAssembly — the same core protocol and shared test vectors; each SDK README lists what it does not cover yet and its release status.

    `@dcp-ai/sdk`, `dcp-ai` (PyPI), `dcp-ai` (crates.io), `sdks/go/v2`, `@dcp-ai/wasm`

-   :material-connection:{ .lg .middle } **11 integrations**

    ---

    Bridges to popular AI and web frameworks. They differ in what they check: some verify signed bundles,
    others record unsigned events or apply no policy, and some published packages lack fixes that are on
    `main` ([supported versions](reference/SECURITY.md#supported-versions)). Read each one's limits before
    relying on it:

    [Express](reference/integrations/express/README.md), [FastAPI](reference/integrations/fastapi/README.md), [LangChain](reference/integrations/langchain/README.md), [OpenAI](reference/integrations/openai/README.md), [CrewAI](reference/integrations/crewai/README.md), [Agno](quickstart/QUICKSTART_AGNO.md), [OpenClaw](reference/integrations/openclaw/README.md), [W3C DID](reference/integrations/w3c-did/README.md), [Google A2A](reference/integrations/google-a2a/README.md), [Anthropic MCP](reference/integrations/anthropic-mcp/README.md), [AutoGen](reference/integrations/autogen/README.md)

-   :material-shield-key:{ .lg .middle } **Hybrid post-quantum crypto**

    ---

    Ed25519 + ML-DSA-65 composite signatures, SLH-DSA-192f backup, dual SHA-256 / SHA3-256 audit chains. Four adaptive tiers (Routine → Maximum).

    [Security model →](architecture/SECURITY_MODEL.md)

-   :material-console:{ .lg .middle } **Reference CLI & services**

    ---

    `dcp-ai` CLI, verification server, anchoring service (local records; on-chain submission is not implemented), transparency log, revocation registry. Full Docker Compose stack.

    [Operator guide →](guides/OPERATOR_GUIDE.md)

</div>

---

## Cite

If you use DCP-AI in your research, cite **both** the concept paper and the specific software release you used.

**Paper** — *Agents Don't Need a Better Brain — They Need a World: Toward a Digital Citizenship Protocol for Autonomous AI Systems*
Naranjo Emparanza, D. (2026). Zenodo. [`10.5281/zenodo.19040913`](https://doi.org/10.5281/zenodo.19040913)

**Software** — cite the release you used. The concept DOI [`10.5281/zenodo.19656025`](https://doi.org/10.5281/zenodo.19656025) resolves to the latest archived version; v2.0.2 is
*DCP-AI v2.0.2 — Digital Citizenship Protocol for AI Agents (Reference Implementation)*, Naranjo Emparanza, D. (2026). Zenodo. [`10.5281/zenodo.19656026`](https://doi.org/10.5281/zenodo.19656026)

---

<p style="text-align: center; font-style: italic; color: var(--md-default-fg-color--light);">
"This protocol was co-created by a human and an AI agent — designed for the collaboration it seeks to govern."
</p>
