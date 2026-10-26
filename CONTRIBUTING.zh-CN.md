<sub>[English](CONTRIBUTING.md) · **中文** · [Español](CONTRIBUTING.es.md) · [日本語](CONTRIBUTING.ja.md) · [Português](CONTRIBUTING.pt-BR.md)</sub>

<a id="contributing-to-dcp-ai"></a>

# 为 DCP-AI 做贡献

> 本文是[英文版](CONTRIBUTING.md)的参考译文，更新于 25/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

感谢你有兴趣为面向 AI 智能体的 Digital Citizenship Protocol 做贡献。本指南将帮助你入门。

<a id="development-environment-setup"></a>

## 搭建开发环境

<a id="prerequisites"></a>

### 前提条件

- **Node.js** >= 20（协议核心和 TypeScript SDK；CI 使用 20 和 22）
- **Python** >= 3.10（Python SDK；CI 使用 3.12）
- **Go** >= 1.25（Go SDK 需要）
- **Rust**（稳定版工具链，Rust SDK 需要）
- **Git**

<a id="getting-started"></a>

### 开始

```bash
# Clone the repository
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai

# The root package uses the workspace SDK to test the checked-out source: build it first
(cd sdks/typescript && npm install && npm run build)

# Install root dependencies (core protocol + reference CLI); reinstall after rebuilding the SDK
npm install

# Run conformance tests to verify your setup (should print "DCP-AI CONFORMANCE PASS (V1 + V2)")
npm run conformance
```

<a id="sdk-setup"></a>

### 设置各 SDK

每个 SDK 位于 `sdks/` 下各自的目录中，依赖相互独立。请在仓库根目录运行这些命令；每个子 shell 结束后都会回到根目录：

```bash
# TypeScript SDK
(cd sdks/typescript && npm install)

# Python SDK
(cd sdks/python && pip install -e ".[dev]")

# Go SDK
(cd sdks/go && go mod download)

# Rust SDK
(cd sdks/rust && cargo build)

# WASM SDK (requires Rust + wasm-pack + Node.js)
(cd sdks/wasm && npm install && npm run build:wasm)
```

<a id="running-tests"></a>

## 运行测试

<a id="core-protocol"></a>

### 协议核心

```bash
npm run conformance
```

<a id="sdks"></a>

### SDK

```bash
# TypeScript
(cd sdks/typescript && npm run test)           # Run tests
(cd sdks/typescript && npm run test:coverage)  # Run tests with coverage

# Python
(cd sdks/python && pytest -v)

# Go
(cd sdks/go && go test ./...)

# Rust
(cd sdks/rust && cargo test)

# WASM (build verification)
(cd sdks/wasm && npm test)
```

<a id="cross-sdk"></a>

### 跨 SDK

每个 SDK 都会在自己的测试套件中读取 `tests/interop/v2/` 中的共享向量。有两个工具对各 SDK 进行相互校验（先构建 `sdks/typescript` 并安装 `sdks/python`；Go 和 Rust 必须在 `PATH` 中）：

```bash
node tools/interop-matrix/run.mjs   # agents on the four SDKs sign and verify each other's bundles
node tools/difffuzz/run.mjs         # the same mutated bundle through the four verifiers
```

两者都会在每个 pull request 以及每晚的 CI 中运行。

<a id="documentation-and-translations"></a>

### 文档与翻译

公开文档有一份英文原文和四份翻译（`<name>.es.md`、`<name>.pt-BR.md`、
`<name>.ja.md`、`<name>.zh-CN.md`），列在 `scripts/docs-i18n.json` 中；如有出入，以英文原文
为准。这些检查需要 CI 所安装的文档工具链，它同时提供 `markdown` 和
`yaml` 模块：

```bash
pip install 'mkdocs==1.6.*' 'mkdocs-material==9.5.*' 'pymdown-extensions==10.*'
python3 scripts/docs_i18n.py check                             # coverage, reviewed hashes, structure and links
python3 -m unittest discover -s scripts -p 'test_docs*.py' -v  # positive and negative controls of the gate
bash scripts/build-docs-site.sh                                 # builds and validates all five languages
```

`build-docs-site.sh` 会构建并验证站点；之后不要再运行 `mkdocs build`。要在本地预览
单一语言（这不是完整构建）：

```bash
python3 scripts/docs_site.py preview --locale en
mkdocs serve -f docs-site/en/mkdocs.yml
```

修改某个文档时，请保持其四份翻译完整，且通知、锚点和代码块
与英文一致。只有在对照新的英文原文读完全部四份翻译之后，才记录其哈希：

```bash
python3 scripts/docs_i18n.py record <source.md> --reviewed
```

这只是记录哈希；它并不证明翻译的质量。不要记录你没有读过其
翻译的文档。

<a id="code-style"></a>

## 代码风格

本项目使用自动化工具来保持一致的代码风格：

- **ESLint** 用于 JavaScript/TypeScript 的静态检查（见 `.eslintrc.json`）
- **Prettier** 用于代码格式化（见 `.prettierrc.json`）
- **EditorConfig** 用于基本的编辑器设置（见 `.editorconfig`）

<a id="key-rules"></a>

### 主要规则

- 默认使用 `const`；不要使用 `var`
- 字符串使用单引号
- 始终保留尾随逗号
- 每行最大宽度为 100 个字符
- 使用 2 个空格缩进（Makefile 除外）

提交前请格式化代码（根软件包不会安装 Prettier 或 ESLint，因此在未安装时 `npx` 会下载它们）：

```bash
npx prettier --write .
npx eslint --fix .
```

<a id="submitting-pull-requests"></a>

## 提交 pull request

1. **Fork 仓库**，并基于 `main` 创建功能分支。
2. 以聚焦、合乎逻辑的提交**进行修改**。
3. 为任何新功能或缺陷修复**编写或更新测试**。
4. 在打开 PR 之前，**确保所有测试在本地通过**。
5. 针对 `main` **打开 pull request**，清楚说明改了什么以及原因。

<a id="pr-checklist"></a>

### PR 检查清单

- [ ] 所有现有测试通过
- [ ] 为新功能添加了新测试
- [ ] 代码遵循项目的风格规范
- [ ] 如适用，已更新文档，并覆盖该文档已有的所有语言
- [ ] 涉及签名、哈希、规范化或验证的更改：已更新共享向量，且互操作矩阵通过
- [ ] 提交信息遵循下面的格式

<a id="commit-message-format"></a>

## 提交信息格式

使用约定式提交信息：

```
<type>(<scope>): <short summary>

<optional body>
```

<a id="types"></a>

### 类型

- **feat**：新功能
- **fix**：缺陷修复
- **docs**：仅文档更改
- **style**：格式、缺少分号等（不改代码）
- **refactor**：既不修复缺陷也不添加功能的代码更改
- **test**：添加或更新测试
- **chore**：构建流程、依赖更新、工具

<a id="scopes"></a>

### 范围

- **core**：协议核心、CLI、模式
- **sdk/ts**：TypeScript SDK
- **sdk/py**：Python SDK
- **sdk/go**：Go SDK
- **sdk/rust**：Rust SDK
- **sdk/wasm**：WASM SDK
- **integration/\***：框架集成
- **ci**：CI/CD 工作流

<a id="examples"></a>

### 示例

```
feat(sdk/ts): add post-quantum signature support
fix(core): correct Merkle root computation for single-entry chains
docs(sdk/py): add installation instructions for extras
test(core): add conformance tests for expired bundles
chore(ci): add code coverage to TypeScript SDK workflow
```

<a id="testing-requirements"></a>

## 测试要求

- 所有新功能都必须包含相应的测试。
- 缺陷修复应包含一个本可以发现该缺陷的回归测试。
- `tests/conformance/` 中的一致性测试会验证所有实现对协议的遵循情况。
- 每个 SDK 都执行的规则会在 `tests/interop/v2/` 中获得一个共享向量，使四个 SDK 针对同一案例进行测试。
- SDK 测试应覆盖 bundle 的创建、签名、验证以及错误情况。
- PR 合并前 CI 必须通过。测试失败不会被掩盖：测试失败，构建就失败。

<a id="questions"></a>

## 有问题？

如果你对贡献有疑问，请在 GitHub 上提 issue 或发起讨论。我们很乐意帮助你入门。
