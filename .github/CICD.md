# GitHub Actions & CI

Reusable GitHub Actions and CI workflow for the DCP ecosystem. Includes actions to verify bundles and run conformance tests in CI/CD pipelines.

## Available Actions

### `verify-bundle`

Verifies a DCP Signed Bundle in a GitHub Actions workflow.

```yaml
- uses: ./.github/actions/verify-bundle
  with:
    bundle-path: "path/to/signed_bundle.json"
    public-key-path: "keys/public_key.txt"  # Optional
    fail-on-invalid: "true"
    node-version: "20"
```

#### Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `bundle-path` | Yes | — | Path to the signed bundle JSON file |
| `public-key-path` | No | — | Path to the Ed25519 public key |
| `fail-on-invalid` | No | `"true"` | Fail the step if the bundle is invalid |
| `node-version` | No | `"20"` | Node.js version |

#### Outputs

| Output | Description |
|--------|-------------|
| `verified` | `"true"` or `"false"` |
| `errors` | Verification errors (if any) |

#### Usage Example

```yaml
name: Verify Agent Bundle
on: [push]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Verify DCP Bundle
        id: verify
        uses: ./.github/actions/verify-bundle
        with:
          bundle-path: "agent/citizenship_bundle.signed.json"
          public-key-path: "agent/public_key.txt"

      - name: Check result
        run: echo "Verified: ${{ steps.verify.outputs.verified }}"
```

### `conformance-test`

Runs DCP conformance tests against a directory of examples.

```yaml
- uses: ./.github/actions/conformance-test
  with:
    node-version: "20"
    test-dir: "tests/conformance/examples"
```

#### Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `node-version` | No | `"20"` | Node.js version |
| `test-dir` | No | `"tests/conformance/examples"` | Directory with test examples |

#### Outputs

| Output | Description |
|--------|-------------|
| `passed` | Whether all tests passed |
| `summary` | Test summary |

#### Usage Example

```yaml
name: DCP Conformance
on: [push]

jobs:
  conformance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run Conformance Tests
        id: conform
        uses: ./.github/actions/conformance-test

      - name: Results
        run: echo "${{ steps.conform.outputs.summary }}"
```

## CI Workflow

The `ci.yml` workflow runs on push and pull requests to `main`. It includes 5 jobs:

### Jobs

#### 1. `conformance`

Protocol conformance tests with a Node.js matrix.

- **Matrix:** Node.js 18, 20, 22
- **Steps:**
  1. Checkout
  2. Setup Node.js
  3. `npm install`
  4. `npm run conformance` — Run conformance tests
  5. Verify example signed bundle (if it exists)
  6. `node bin/dcp.js integrity` — Verify protocol integrity

#### 2. `typescript-sdk`

Build and type-check of the TypeScript SDK.

- **Directory:** `sdks/typescript/`
- **Steps:**
  1. `npm install`
  2. `npx tsc --noEmit` — Type check
  3. `npm run build` — Build ESM + CJS

#### 3. `python-sdk`

Python SDK tests.

- **Directory:** `sdks/python/`
- **Python:** 3.12
- **Steps:**
  1. `pip install -e ".[dev]"`
  2. `pytest -v`

#### 4. `go-sdk`

Build and tests for the Go SDK.

- **Directory:** `sdks/go/`
- **Go:** 1.21
- **Steps:**
  1. `go build ./...`
  2. `go test ./...`

#### 5. `rust-sdk`

Build, tests, and WASM for the Rust SDK.

- **Directory:** `sdks/rust/`
- **Rust:** stable
- **Steps:**
  1. `cargo build`
  2. `cargo test`
  3. `cargo build --target wasm32-unknown-unknown --features wasm`

### Using the CI in Your Project

```yaml
# .github/workflows/dcp.yml
name: DCP Verification
on: [push, pull_request]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # Verify your agent's bundle
      - uses: ./.github/actions/verify-bundle
        with:
          bundle-path: "my-agent/bundle.signed.json"

      # Run conformance
      - uses: ./.github/actions/conformance-test
        with:
          test-dir: "my-agent/test-fixtures"
```

## License

Apache-2.0
