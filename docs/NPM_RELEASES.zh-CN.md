<a id="published-npm-packages"></a>

# 已发布的 npm 软件包

**Python 发布 (26/10/2026).** `dcp-ai` 2.10.0 已在 PyPI 发布，包含验证器修复、准入和实验性显式启用 API。Go 和 Rust 仍独立发布。见 [Python 2.10.0](PYTHON_RELEASE.md).

> [英文版](NPM_RELEASES.md)的参考译文，更新于 26/10/2026。如有差异，以英文版为准。

已于 2026 年 10 月 26 日核实。以下 13 个确切版本均已使用 `latest` 标签发布。注册表中的完整性值与经过测试的 tarball 一致，从 npm 全新安装后通过了 383 项检查。软件包版本与 DCP 线格式/规范版本及仓库标签相互独立。

| 软件包 | 版本 |
|---|---|
| [`@dcp-ai/sdk`](https://www.npmjs.com/package/@dcp-ai/sdk) | 2.2.0 |
| [`@dcp-ai/wasm`](https://www.npmjs.com/package/@dcp-ai/wasm) | 2.1.0 |
| [`@dcp-ai/cli`](https://www.npmjs.com/package/@dcp-ai/cli) | 2.1.0 |
| [`@dcp-ai/anthropic-mcp`](https://www.npmjs.com/package/@dcp-ai/anthropic-mcp) | 2.1.0 |
| [`@dcp-ai/autogen`](https://www.npmjs.com/package/@dcp-ai/autogen) | 2.0.1 |
| [`@dcp-ai/express`](https://www.npmjs.com/package/@dcp-ai/express) | 2.1.0 |
| [`@dcp-ai/google-a2a`](https://www.npmjs.com/package/@dcp-ai/google-a2a) | 2.1.0 |
| [`@dcp-ai/openclaw`](https://www.npmjs.com/package/@dcp-ai/openclaw) | 2.1.0 |
| [`@dcp-ai/w3c-did`](https://www.npmjs.com/package/@dcp-ai/w3c-did) | 2.0.1 |
| [`@dcp-ai/create-crewai`](https://www.npmjs.com/package/@dcp-ai/create-crewai) | 2.0.1 |
| [`@dcp-ai/create-express`](https://www.npmjs.com/package/@dcp-ai/create-express) | 2.0.1 |
| [`@dcp-ai/create-langchain`](https://www.npmjs.com/package/@dcp-ai/create-langchain) | 2.0.1 |
| [`@dcp-ai/create-openai`](https://www.npmjs.com/package/@dcp-ai/create-openai) | 2.0.1 |

<a id="install-the-published-versions"></a>

## 安装已发布的版本

```bash
npm install @dcp-ai/sdk@^2.2.0
npm install @dcp-ai/wasm@^2.1.0
npm install @dcp-ai/express@^2.1.0 express
npx --package=@dcp-ai/cli@2.1.0 dcp-ai --help
```

本次发布仅涵盖 npm，不包括 PyPI 上的 Python 包、crates.io 上的 Rust crate、Go 模块标签或容器镜像。在这些生态中使用检出源码的示例前，请查看各 SDK 的发布状态。仓库根目录仍使用本地 SDK 测试检出的源码；这是开发上的选择，并非 npm 可用性限制。

`@dcp-ai/sdk` 2.2.0 包含委托人信任、`strict-v1`、验证器修复和候选方案的实验性 API。`@dcp-ai/express` 和 `@dcp-ai/openclaw` 2.1.0 包含修复后的 V2 签名验证和文档所述准入控制。其 2.0.0 版本仍受影响；见 [SECURITY.md](../SECURITY.md)。发布软件包并不会让已验证的 bundle 自动获得信任，也不会授权任何操作。

在 `@dcp-ai/sdk` 2.2.0 和 `@dcp-ai/wasm` 2.1.0 中，`dcp-jcs-v2` 仍是实验性、非规范性且需显式启用的功能。`dcp-jcs-v1` 仍是唯一的规范性默认配置。生成器和桥接辅助函数保留 README 中的限制；发布它们不会把演示流程变成生产验证器。
