<sub>**English** · [中文](CONTRIBUTING.zh-CN.md) · [Español](CONTRIBUTING.es.md) · [日本語](CONTRIBUTING.ja.md) · [Português](CONTRIBUTING.pt-BR.md)</sub>

# Contributing to DCP-AI

Thank you for your interest in contributing to the Digital Citizenship Protocol for AI Agents. This guide will help you get started.

## Development Environment Setup

### Prerequisites

- **Node.js** >= 20 (the core protocol and TypeScript SDK; CI runs 20 and 22)
- **Python** >= 3.10 (the Python SDK; CI runs 3.12)
- **Go** >= 1.25 (required for the Go SDK)
- **Rust** (stable toolchain, required for the Rust SDK)
- **Git**

### Getting Started

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

### SDK Setup

Each SDK lives in its own directory under `sdks/` and has independent dependencies. Run these commands from the repository root; each subshell returns there:

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

## Running Tests

### Core Protocol

```bash
npm run conformance
```

### SDKs

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

### Cross-SDK

Every SDK reads the shared vectors in `tests/interop/v2/` from its own test suite. Two tools check the SDKs
against each other (build `sdks/typescript` and install `sdks/python` first; Go and Rust must be on `PATH`):

```bash
node tools/interop-matrix/run.mjs   # agents on the four SDKs sign and verify each other's bundles
node tools/difffuzz/run.mjs         # the same mutated bundle through the four verifiers
```

Both run in CI on every pull request, and nightly.

### Documentation and translations

Public documents have an English source and four translations (`<name>.es.md`, `<name>.pt-BR.md`,
`<name>.ja.md`, `<name>.zh-CN.md`), listed in `scripts/docs-i18n.json`; where they differ, the English text
prevails. The checks need the documentation toolchain that CI installs, which also provides the `markdown` and
`yaml` modules:

```bash
pip install 'mkdocs==1.6.*' 'mkdocs-material==9.5.*' 'pymdown-extensions==10.*'
python3 scripts/docs_i18n.py check                             # coverage, reviewed hashes, structure and links
python3 -m unittest discover -s scripts -p 'test_docs*.py' -v  # positive and negative controls of the gate
bash scripts/build-docs-site.sh                                 # builds and validates all five languages
```

`build-docs-site.sh` builds and validates the site; do not run `mkdocs build` after it. For a local preview of
one language, which is not a complete build:

```bash
python3 scripts/docs_site.py preview --locale en
mkdocs serve -f docs-site/en/mkdocs.yml
```

When you change a document, keep its four translations complete, with their notice, anchors and code blocks
matching the English. Only after reading all four against the new English, record its hashes:

```bash
python3 scripts/docs_i18n.py record <source.md> --reviewed
```

This records hashes; it does not certify the quality of a translation. Do not record a document whose
translations you have not read.

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

Format your code before committing (the root package does not install Prettier or ESLint, so `npx` fetches them when they are not installed):

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
- [ ] Documentation updated if applicable, in every language the document has
- [ ] Changes to signing, hashing, canonicalization or verification: shared vectors updated and the interop matrix passes
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
- A rule every SDK enforces gets a shared vector in `tests/interop/v2/`, so the four SDKs are tested against the same case.
- SDK tests should cover bundle creation, signing, verification, and error cases.
- CI must pass before a PR can be merged. Test failures are not suppressed — if tests fail, the build fails.

## Questions?

If you have questions about contributing, open a GitHub issue or start a discussion. We're happy to help you get started.
