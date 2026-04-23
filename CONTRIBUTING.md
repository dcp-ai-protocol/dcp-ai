<sub>**English** · [中文](CONTRIBUTING.zh-CN.md) · [Español](CONTRIBUTING.es.md) · [日本語](CONTRIBUTING.ja.md) · [Português](CONTRIBUTING.pt-BR.md)</sub>

# Contributing to DCP-AI

Thank you for your interest in contributing to the Digital Citizenship Protocol for AI Agents. This guide will help you get started.

## Development Environment Setup

### Prerequisites

- **Node.js** >= 18 (required for the core protocol and TypeScript SDK)
- **Python** >= 3.12 (required for the Python SDK)
- **Go** >= 1.21 (required for the Go SDK)
- **Rust** (stable toolchain, required for the Rust SDK)
- **Git**

### Getting Started

```bash
# Clone the repository
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai

# Install root dependencies (core protocol + CLI)
npm install

# Run conformance tests to verify your setup (should print "DCP-AI CONFORMANCE PASS (V1 + V2)")
npm run conformance
```

### SDK Setup

Each SDK lives in its own directory under `sdks/` and has independent dependencies:

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

## Running Tests

### Core Protocol

```bash
npm run conformance
```

### SDKs

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

## Code Style

This project uses automated tooling to enforce consistent code style:

- **ESLint** for JavaScript/TypeScript linting (see `.eslintrc.json`)
- **Prettier** for code formatting (see `.prettierrc.json`)
- **EditorConfig** for basic editor settings (see `.editorconfig`)

### Key Rules

- Use `const` by default; never use `var`
- Use single quotes for strings
- Always include trailing commas
- Maximum line width is 100 characters
- Use 2-space indentation (except Makefiles)

Format your code before committing:

```bash
npx prettier --write .
npx eslint --fix .
```

## Submitting Pull Requests

1. **Fork the repository** and create a feature branch from `main`.
2. **Make your changes** in focused, logical commits.
3. **Write or update tests** for any new functionality or bug fixes.
4. **Ensure all tests pass** locally before opening a PR.
5. **Open a pull request** against `main` with a clear description of what changed and why.

### PR Checklist

- [ ] All existing tests pass
- [ ] New tests added for new functionality
- [ ] Code follows the project style guidelines
- [ ] Documentation updated if applicable
- [ ] Commit messages follow the format below

## Commit Message Format

Use conventional commit messages:

```
<type>(<scope>): <short summary>

<optional body>
```

### Types

- **feat**: A new feature
- **fix**: A bug fix
- **docs**: Documentation changes only
- **style**: Formatting, missing semicolons, etc. (no code change)
- **refactor**: Code change that neither fixes a bug nor adds a feature
- **test**: Adding or updating tests
- **chore**: Build process, dependency updates, tooling

### Scopes

- **core**: Core protocol, CLI, schemas
- **sdk/ts**: TypeScript SDK
- **sdk/py**: Python SDK
- **sdk/go**: Go SDK
- **sdk/rust**: Rust SDK
- **sdk/wasm**: WASM SDK
- **integration/\***: Framework integrations
- **ci**: CI/CD workflows

### Examples

```
feat(sdk/ts): add post-quantum signature support
fix(core): correct Merkle root computation for single-entry chains
docs(sdk/py): add installation instructions for extras
test(core): add conformance tests for expired bundles
chore(ci): add code coverage to TypeScript SDK workflow
```

## Testing Requirements

- All new features must include corresponding tests.
- Bug fixes should include a regression test that would have caught the bug.
- Conformance tests in `tests/conformance/` verify protocol compliance across all implementations.
- SDK tests should cover bundle creation, signing, verification, and error cases.
- CI must pass before a PR can be merged. Test failures are not suppressed — if tests fail, the build fails.

## Questions?

If you have questions about contributing, open a GitHub issue or start a discussion. We're happy to help you get started.
