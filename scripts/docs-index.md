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
    go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.0.0
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

    TypeScript, Python, Go, Rust, WebAssembly — all at feature parity, all published to their registries.

    `@dcp-ai/sdk`, `dcp-ai` (PyPI), `dcp-ai` (crates.io), `sdks/go/v2`, `@dcp-ai/wasm`

-   :material-connection:{ .lg .middle } **10 integrations**

    ---

    Drop-in governance for the popular AI and web frameworks.

    Express, FastAPI, LangChain, OpenAI, CrewAI, OpenClaw, W3C DID, Google A2A, Anthropic MCP, AutoGen

-   :material-shield-key:{ .lg .middle } **Hybrid post-quantum crypto**

    ---

    Ed25519 + ML-DSA-65 composite signatures, SLH-DSA-192f backup, dual SHA-256 / SHA3-256 audit chains. Four adaptive tiers (Routine → Maximum).

    [Security model →](architecture/SECURITY_MODEL.md)

-   :material-console:{ .lg .middle } **Reference CLI & services**

    ---

    `dcp-ai` CLI, verification server, anchoring service, transparency log, revocation registry. Full Docker Compose stack.

    [Operator guide →](guides/OPERATOR_GUIDE.md)

</div>

---

## Cite

If you use DCP-AI in your research, cite **both** the concept paper and the specific software release you used.

**Paper** — *Agents Don't Need a Better Brain — They Need a World: Toward a Digital Citizenship Protocol for Autonomous AI Systems*
Naranjo Emparanza, D. (2026). Zenodo. [`10.5281/zenodo.19040913`](https://doi.org/10.5281/zenodo.19040913)

**Software** (v2.0.2) — *DCP-AI v2.0.2 — Digital Citizenship Protocol for AI Agents (Reference Implementation)*
Naranjo Emparanza, D. (2026). Zenodo. [`10.5281/zenodo.19656026`](https://doi.org/10.5281/zenodo.19656026)

---

<p style="text-align: center; font-style: italic; color: var(--md-default-fg-color--light);">
"This protocol was co-created by a human and an AI agent — designed for the collaboration it seeks to govern."
</p>
