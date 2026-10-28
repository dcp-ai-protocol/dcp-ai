<a id="published-npm-packages"></a>

# 已发布的 npm 软件包

> [英文版](NPM_RELEASES.md)的参考译文，更新于 28/10/2026。如有差异，以英文版为准。

已于 2026 年 10 月 28 日核实：`@dcp-ai/sdk` 2.2.1、`@dcp-ai/wasm` 2.1.1 和 `@dcp-ai/cli` 2.1.1 已使用 `latest` 标签发布；表中其他十个软件包不变。软件包版本与 DCP 线格式/规范版本及仓库标签相互独立。

2026 年 10 月 26 日，13 个版本使用 `latest` 标签发布：`@dcp-ai/sdk` 2.2.0、`@dcp-ai/wasm` 2.1.0、`@dcp-ai/cli` 2.1.0 以及仍列在表中的十个软件包。注册表中的完整性值与经过测试的 tarball 一致，从 npm 全新安装后通过了 383 项检查。

| 软件包 | 版本 |
|---|---|
| [`@dcp-ai/sdk`](https://www.npmjs.com/package/@dcp-ai/sdk) | 2.2.1 |
| [`@dcp-ai/wasm`](https://www.npmjs.com/package/@dcp-ai/wasm) | 2.1.1 |
| [`@dcp-ai/cli`](https://www.npmjs.com/package/@dcp-ai/cli) | 2.1.1 |
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

<a id="what-changed-on-28102026"></a>

## 2026 年 10 月 28 日的更新内容

`@dcp-ai/sdk` 2.2.1 和 `@dcp-ai/wasm` 2.1.1 会在 [VERIFICATION.md 的 V2-11](../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) 中的可选二级 SHA3-256 字段存在时验证它们：不存在的字段不作要求，因此已验证的 bundle 可能没有完整的二级链；存在的字段如果是 `null`、不是字符串或不一致，则被拒绝。`@dcp-ai/cli` 2.1.1 需要 `@dcp-ai/sdk` `^2.2.1`，`--version` 显示 `2.1.1`。API、结果字段、`dcp-jcs-v1`、实验性且需显式启用的 `dcp-jcs-v2` API 以及 `hash_alg` 的处理均不变。 已发布的适配器 `@dcp-ai/express`、`@dcp-ai/openclaw`、`@dcp-ai/anthropic-mcp` 和 `@dcp-ai/google-a2a` 2.1.0 没有重新发布：它们依赖 `@dcp-ai/sdk` `^2.2.0`，当你的锁定文件解析到 `@dcp-ai/sdk` 2.2.1 或更高版本时即获得二级检查。

注册表中的三个 tarball 与审核过的产物逐字节一致，`sha512` 完整性值相符。一个不使用本地覆盖、从 npm 全新安装的使用方通过了 411 项二级 SHA3-256 判定和 87 项对照、340 项回归检查以及 80 项 CLI 检查（`--version` 2.1.1）；注册表中的 `@dcp-ai/wasm` 软件包在真实浏览器中通过了 167 项检查。

<a id="install-the-published-versions"></a>

## 安装已发布的版本

```bash
npm install @dcp-ai/sdk@^2.2.1
npm install @dcp-ai/wasm@^2.1.1
npm install @dcp-ai/express@^2.1.0 express
npx --package=@dcp-ai/cli@2.1.1 dcp-ai --help
```

每次 npm 发布仅涵盖 npm，不包括 PyPI 上的 Python 包、crates.io 上的 Rust crate、Go 模块标签或容器镜像。在这些生态中使用检出源码的示例前，请查看各 SDK 的发布状态。仓库根目录仍使用本地 SDK 测试检出的源码；这是开发上的选择，并非 npm 可用性限制。

自 2.2.0 起，`@dcp-ai/sdk` 包含委托人信任、`strict-v1`、验证器修复和候选方案的实验性 API。`@dcp-ai/express` 和 `@dcp-ai/openclaw` 2.1.0 包含修复后的 V2 签名验证和文档所述准入控制。其 2.0.0 版本仍受影响；见 [SECURITY.md](../SECURITY.md)。发布软件包并不会让已验证的 bundle 自动获得信任，也不会授权任何操作。

在 `@dcp-ai/sdk` 2.2.0 及更高版本和 `@dcp-ai/wasm` 2.1.0 及更高版本中，`dcp-jcs-v2` 仍是实验性、非规范性且需显式启用的功能。`dcp-jcs-v1` 仍是唯一的规范性默认配置。生成器和桥接辅助函数保留 README 中的限制；发布它们不会把演示流程变成生产验证器。

<a id="related-releases"></a>

## 相关发布

各注册表中的当前版本见[已发布版本](README.md#published-versions)。其他发布说明：[Python 2.10.1](PYTHON_RELEASE.md)、[Go v2.11.1](GO_RELEASE.md)、[Rust 2.11.1](RUST_RELEASE.md)。
