---
hide:
  - navigation
  - toc
---

<sub>[English](docs-index.md) · **中文** · [Español](docs-index.es.md) · [日本語](docs-index.ja.md) · [Português](docs-index.pt-BR.md)</sub>

<a id="dcp-ai--digital-citizenship-protocol-for-ai-agents"></a>
<a id="dcp-ai-digital-citizenship-protocol-for-ai-agents"></a>

# DCP-AI — 面向 AI 智能体的 Digital Citizenship Protocol

> 本文是[英文版](docs-index.md)的参考译文，更新于 28/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

> 面向开放网络上 AI 智能体的可移植问责层。

可通过密码学验证的身份、机器可读的意图、可检测篡改的审计轨迹、经认证的智能体间通信、生命周期治理、程序性问责以及委托代理——集成在一个混合后量子协议栈中。

[开始使用 :material-rocket-launch:](quickstart/QUICKSTART.md){ .md-button .md-button--primary }
[试用 playground :material-play-circle:](playground/){ .md-button }
[阅读论文 :material-file-document:](https://doi.org/10.5281/zenodo.19040913){ .md-button }
[在 GitHub 上查看 :material-github:](https://github.com/dcp-ai-protocol/dcp-ai){ .md-button }

---

<a id="install"></a>

## 安装

!!! note "已发布的软件包与 `main`"
    npm、PyPI、Go 模块和 crates.io 上的当前版本见[已发布版本](reference/docs/README.md#published-versions)。[快速入门](quickstart/QUICKSTART.md#published-packages-and-this-guide)区分了注册表与源码检出的示例。

=== "Node.js"

    ```bash
    npm install @dcp-ai/sdk@^2.2.1 @dcp-ai/cli
    ```

=== "Python"

    ```bash
    pip install dcp-ai
    ```

=== "Go"

    ```bash
    go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.11.1
    ```

=== "Rust"

    ```bash
    cargo add dcp-ai@2.11.1
    ```

=== "WebAssembly"

    ```bash
    npm install @dcp-ai/wasm@^2.1.1
    ```

---

<a id="the-nine-specifications"></a>

## 九份规范

<div class="grid cards" markdown>

-   :material-card-account-details:{ .lg .middle } **DCP-01 — 身份与人的绑定**

    ---

    每个智能体都通过密码学绑定到一个承担问责的责任人或法律实体。

    [阅读 →](specs/DCP-01.md)

-   :material-target:{ .lg .middle } **DCP-02 — 意图声明与策略管控**

    ---

    智能体在行动前声明结构化意图；验证器按等级应用策略决定。

    [阅读 →](specs/DCP-02.md)

-   :material-link-variant:{ .lg .middle } **DCP-03 — 审计链与透明度**

    ---

    以哈希链接的审计条目，带 Merkle 证明，并可选择记入透明度日志。

    [阅读 →](specs/DCP-03.md)

-   :material-account-group:{ .lg .middle } **DCP-04 — 智能体间通信**

    ---

    经认证的智能体间消息、发现、握手、委托、信任链。

    [阅读 →](specs/DCP-04.md)

-   :material-heart-pulse:{ .lg .middle } **DCP-05 — 智能体生命周期**

    ---

    启用、活力报告、停用——四种终止模式，均以可检测篡改的方式记录。

    [阅读 →](specs/DCP-05.md)

-   :material-file-sign:{ .lg .middle } **DCP-06 — 继承与传承**

    ---

    数字遗嘱和继承仪式在各代智能体之间保持连续性。

    [阅读 →](specs/DCP-06.md)

-   :material-gavel:{ .lg .middle } **DCP-07 — 冲突解决**

    ---

    三级升级、M-of-N 仲裁小组、作为先例的判例 bundle。

    [阅读 →](specs/DCP-07.md)

-   :material-scale-balance:{ .lg .middle } **DCP-08 — 权利与义务**

    ---

    智能体的四项基本权利、结构化的义务跟踪、违规报告。

    [阅读 →](specs/DCP-08.md)

-   :material-account-tie:{ .lg .middle } **DCP-09 — 委托与代理**

    ---

    委托授权书、感知阈值、委托人镜像、双层交互记录。

    [阅读 →](specs/DCP-09.md)

</div>

---

<a id="whats-in-the-box"></a>

## 包含的内容

<div class="grid cards" markdown>

-   :material-package-variant-closed:{ .lg .middle } **5 个 SDK**

    ---

    TypeScript、Python、Go、Rust、WebAssembly——相同的核心协议和共享的测试向量；每个 SDK 的 README 都列出了尚未覆盖的内容及其发布状态。

    `@dcp-ai/sdk`、`dcp-ai`（PyPI）、`dcp-ai`（crates.io）、`sdks/go/v2`、`@dcp-ai/wasm`

-   :material-connection:{ .lg .middle } **11 个集成**

    ---

    与流行的 AI 和 Web 框架之间的桥接。它们检查的内容各不相同：有的验证已签名的 bundle，
    有的只记录未签名的事件或不应用任何策略，而早期发布的版本可能缺少当前发布中已包含的修复
    （[支持的版本](reference/SECURITY.md#supported-versions)）。在依赖之前，
    请阅读每个集成的限制：

    [Express](reference/integrations/express/README.md)、[FastAPI](reference/integrations/fastapi/README.md)、[LangChain](reference/integrations/langchain/README.md)、[OpenAI](reference/integrations/openai/README.md)、[CrewAI](reference/integrations/crewai/README.md)、[Agno](quickstart/QUICKSTART_AGNO.md)、[OpenClaw](reference/integrations/openclaw/README.md)、[W3C DID](reference/integrations/w3c-did/README.md)、[Google A2A](reference/integrations/google-a2a/README.md)、[Anthropic MCP](reference/integrations/anthropic-mcp/README.md)、[AutoGen](reference/integrations/autogen/README.md)

-   :material-shield-key:{ .lg .middle } **混合后量子密码学**

    ---

    Ed25519 + ML-DSA-65 复合签名，SLH-DSA-192f 作为备用，SHA-256 / SHA3-256 双审计链。四个自适应等级（从 Routine 到 Maximum）。

    [安全模型 →](architecture/SECURITY_MODEL.md)

-   :material-console:{ .lg .middle } **参考 CLI 与服务**

    ---

    `dcp-ai` CLI、验证服务器、锚定服务（仅本地记录；未实现上链提交）、透明度日志、吊销注册表。完整的 Docker Compose 栈。

    [运营方指南 →](guides/OPERATOR_GUIDE.md)

</div>

---

<a id="cite"></a>

## 引用

如果你在研究中使用了 DCP-AI，请**同时**引用概念论文和你所使用的具体软件版本。

**论文** — *Agents Don't Need a Better Brain — They Need a World: Toward a Digital Citizenship Protocol for Autonomous AI Systems*
Naranjo Emparanza, D. (2026). Zenodo. [`10.5281/zenodo.19040913`](https://doi.org/10.5281/zenodo.19040913)

**软件** — 请引用你使用的版本。概念 DOI [`10.5281/zenodo.19656025`](https://doi.org/10.5281/zenodo.19656025) 指向最新的存档版本；v2.0.2 为
*DCP-AI v2.0.2 — Digital Citizenship Protocol for AI Agents (Reference Implementation)*, Naranjo Emparanza, D. (2026). Zenodo. [`10.5281/zenodo.19656026`](https://doi.org/10.5281/zenodo.19656026)

---

<p style="text-align: center; font-style: italic; color: var(--md-default-fg-color--light);">
“本协议由一个人和一个 AI 智能体共同创作——为它所要治理的那种协作而设计。”
</p>
