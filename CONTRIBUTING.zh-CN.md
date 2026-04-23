<sub>[English](CONTRIBUTING.md) · **中文** · [Español](CONTRIBUTING.es.md) · [日本語](CONTRIBUTING.ja.md) · [Português](CONTRIBUTING.pt-BR.md)</sub>

# 为 DCP-AI 做贡献

感谢你有兴趣为面向 AI 智能体的数字公民身份协议做出贡献。本指南将帮助你上手。

## 开发环境设置

### 先决条件

- **Node.js** >= 18（核心协议与 TypeScript SDK 必需）
- **Python** >= 3.12（Python SDK 必需）
- **Go** >= 1.21（Go SDK 必需）
- **Rust**（稳定工具链，Rust SDK 必需）
- **Git**

### 开始

```bash
# Clone the repository
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai

# Install root dependencies (core protocol + CLI)
npm install

# Run conformance tests to verify your setup (should print "DCP-AI CONFORMANCE PASS (V1 + V2)")
npm run conformance
```

### SDK 设置

每个 SDK 位于 `sdks/` 下的独立目录中，并具有独立的依赖：

```bash
# TypeScript SDK
cd sdks/typescript && npm install

# Python SDK
cd sdks/python && pip install -e ".[dev]"

# Go SDK
cd sdks/go && go mod download

# Rust SDK
cd sdks/rust && cargo build

# WASM SDK (requires Rust + wasm-pack + Node.js)
cd sdks/wasm && npm install
```

## 运行测试

### 核心协议

```bash
npm run conformance
```

### SDK

```bash
# TypeScript
cd sdks/typescript
npm run test              # Run tests
npm run test:coverage     # Run tests with coverage

# Python
cd sdks/python
pytest -v

# Go
cd sdks/go
go test ./...

# Rust
cd sdks/rust
cargo test

# WASM (build verification)
cd sdks/wasm
npm test
```

## 代码风格

本项目使用自动化工具执行一致的代码风格：

- **ESLint** 用于 JavaScript/TypeScript 代码检查（参见 `.eslintrc.json`）
- **Prettier** 用于代码格式化（参见 `.prettierrc.json`）
- **EditorConfig** 用于基础编辑器设置（参见 `.editorconfig`）

### 关键规则

- 默认使用 `const`；永远不要使用 `var`
- 字符串使用单引号
- 始终包含尾随逗号
- 最大行宽为 100 个字符
- 使用 2 空格缩进（Makefile 除外）

在提交之前格式化你的代码：

```bash
npx prettier --write .
npx eslint --fix .
```

## 提交 Pull Request

1. **Fork 仓库** 并从 `main` 创建一个特性分支。
2. **进行更改**，保持聚焦、逻辑清晰的提交。
3. **为任何新功能或 bug 修复编写或更新测试**。
4. **在打开 PR 之前，确保所有测试在本地通过**。
5. **针对 `main` 打开 Pull Request**，并清晰说明变更内容及原因。

### PR 清单

- [ ] 所有现有测试通过
- [ ] 为新功能添加了新测试
- [ ] 代码遵循项目风格指南
- [ ] 如适用，已更新文档
- [ ] 提交信息遵循下方格式

## 提交信息格式

使用 conventional commit 消息：

```
<type>(<scope>): <short summary>

<optional body>
```

### 类型

- **feat**：新功能
- **fix**：bug 修复
- **docs**：仅文档变更
- **style**：格式化、缺失的分号等（无代码变更）
- **refactor**：既不修复 bug 也不添加功能的代码变更
- **test**：添加或更新测试
- **chore**：构建流程、依赖更新、工具

### 范围

- **core**：核心协议、CLI、schema
- **sdk/ts**：TypeScript SDK
- **sdk/py**：Python SDK
- **sdk/go**：Go SDK
- **sdk/rust**：Rust SDK
- **sdk/wasm**：WASM SDK
- **integration/\***：框架集成
- **ci**：CI/CD 工作流

### 示例

```
feat(sdk/ts): add post-quantum signature support
fix(core): correct Merkle root computation for single-entry chains
docs(sdk/py): add installation instructions for extras
test(core): add conformance tests for expired bundles
chore(ci): add code coverage to TypeScript SDK workflow
```

## 测试要求

- 所有新特性必须包含相应的测试。
- bug 修复应包含一个若先前存在就能捕获该 bug 的回归测试。
- `tests/conformance/` 中的一致性测试在所有实现之间验证协议合规性。
- SDK 测试应涵盖凭证包创建、签名、验证以及错误情况。
- PR 合并前 CI 必须通过。测试失败不会被抑制 —— 测试失败则构建失败。

## 有问题？

如果你对贡献有疑问，欢迎提 GitHub issue 或发起讨论。我们乐于帮助你上手。
