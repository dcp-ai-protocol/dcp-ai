# GitHub Actions & CI

GitHub Actions and the CI workflow of this repository: two composite actions in `.github/actions/`, and the `ci.yml` workflow.

> **The actions are not exercised by this repository's workflows** (25/10/2026), and they were not tested from another repository. Both run code from a checkout of this repository: `verify-bundle` loads `lib/verify.js`, which needs the workspace SDK (`sdks/typescript`) built, and `conformance-test` runs `tools/conformance.js` from the workspace, so it only works in a checkout of this repository. To verify bundles in your own pipeline, see [Verifying bundles in your project](#verifying-bundles-in-your-project).

## Available Actions

### `verify-bundle`

Verifies a DCP Signed Bundle in a GitHub Actions workflow, using the reference verifier (`lib/verify.js`). V1 bundles get schema, Ed25519 signature, audit-chain and Merkle checks. Normative V2 bundles (`schemas/v2/signed_bundle.schema.json`) are schema-validated and then verified by `@dcp-ai/sdk`: manifest, composite Ed25519 + ML-DSA-65 signature, session binding and audit chain.

It installs the root package of the checkout it runs from (`npm install --production`, with install errors ignored) and does not build the workspace SDK, so build `sdks/typescript` in an earlier step. It verifies under the default policy: there is no policy input.

Use only trusted, literal path inputs: the action interpolates them into shell and JavaScript evaluated with `eval`, rather than passing them as data. Quotes or shell syntax in a path can change the command. Do not derive these inputs from an untrusted pull request, issue or artifact name. The reference CLI example below passes the path as an argument instead.

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
| `public-key-path` | No | — | Path to the expected Ed25519 public key. V1: verify against it (otherwise the key embedded in the bundle is used). V2: pins the bundle's classical signer |
| `fail-on-invalid` | No | `"true"` | Fail the step if the bundle is invalid |
| `node-version` | No | `"20"` | Node.js version |

#### Outputs

| Output | Description |
|--------|-------------|
| `verified` | `"true"` or `"false"` |
| `errors` | Verification errors (if any) |

#### Usage Example

A sketch for a checkout of this repository (not run for this page): the action and `lib/verify.js` come from the
checkout, and `agent/citizenship_bundle.signed.json` and `agent/public_key.txt` stand for files the operator provides.

```yaml
name: Verify Agent Bundle
on: [push]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Build the workspace SDK (the action does not)
        run: (cd sdks/typescript && npm ci && npm run build)

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

Runs `node tools/conformance.js` in the workspace: the repository's V1 + V2 conformance suite, on its own examples. It works only in a checkout of this repository, and its `test-dir` input is not used.

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
| `test-dir` | No | `"tests/conformance/examples"` | Not used by the action |

#### Outputs

| Output | Description |
|--------|-------------|
| `passed` | Whether all tests passed |
| `summary` | Test summary |

#### Usage Example

A sketch for a checkout of this repository (not run for this page). `tools/conformance.js` imports `@dcp-ai/sdk`, so
the workspace SDK is built first:

```yaml
name: DCP Conformance
on: [push]

jobs:
  conformance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Build the workspace SDK (the action does not)
        run: (cd sdks/typescript && npm ci && npm run build)

      - name: Run Conformance Tests
        id: conform
        uses: ./.github/actions/conformance-test

      - name: Results
        run: echo "${{ steps.conform.outputs.summary }}"
```

## CI Workflow

The `ci.yml` workflow runs on pushes to `main` and on pull requests against any base branch. A `changes` job detects which parts changed (`dorny/paths-filter`), and the jobs below run for those parts:

| Job | What it runs |
|-----|--------------|
| `conformance` | Node.js 20 and 22: `npm install`, `npm run conformance`, the S-range tests of `tools/crypto.js` and the playground, `npm run examples:generate:v2`, `dcp verify-bundle` on the V1 and V2 examples (V2 under `hybrid_required`), and `dcp integrity` |
| `typescript-sdk` | `sdks/typescript`: `npm install`, `npx tsc --noEmit`, `npm run build`, `npm run test`, coverage |
| `integrations` | `anthropic-mcp`, `express`, `google-a2a`, `openclaw`: build the workspace SDK, `npm ci`, build, `vitest run` |
| `cli` | Node.js 20 and 22: build the workspace SDK, install it into `cli/`, the CLI tests and their negative control, and a check of the packed files |
| `python-sdk` | Python 3.12: `pip install -e ".[dev]"`, `pytest` with coverage |
| `go-sdk` | Go from `sdks/go/go.mod`: `go build ./...`, `go test` with coverage |
| `rust-sdk` | Rust stable: `cargo build`, `cargo build --features otlp`, coverage, `cargo test --all-features`, a `wasm32-unknown-unknown` build of the tests |
| `wasm-sdk` | Rust stable and `wasm-pack`: `npm run build:wasm`, `npm test` in `sdks/wasm` |

Other workflows cover the canonicalization candidate matrix and lab, the contracts, differential fuzzing, the interop matrix, labels, and publishing (npm, PyPI, Docker images, integrations, templates). Two cover the documentation, and neither translates anything automatically: `i18n-sync.yml` ("Documentation and i18n") checks, on pull requests and on pushes to `main` that touch Markdown or the documentation tooling, the coverage, reviewed hashes, structure and links of the five languages, runs the positive and negative controls of that gate and builds the site in the five languages; `docs.yml` builds the same site on `main` and deploys it to GitHub Pages.

To run the same documentation checks locally, see [Documentation and translations](../CONTRIBUTING.md#documentation-and-translations) in CONTRIBUTING.md:

```bash
pip install 'mkdocs==1.6.*' 'mkdocs-material==9.5.*' 'pymdown-extensions==10.*'
python3 scripts/docs_i18n.py check
python3 -m unittest discover -s scripts -p 'test_docs*.py' -v
bash scripts/build-docs-site.sh
```

## Verifying bundles in your project

A sketch that verifies a bundle with the reference CLI of a pinned checkout (not run for this page). `dcp verify-bundle` exits 0 when the bundle verifies and non-zero otherwise, and reads files only under the current directory:

```yaml
# .github/workflows/dcp.yml
name: DCP Verification
on: [push, pull_request]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/checkout@v4
        with:
          repository: dcp-ai-protocol/dcp-ai
          ref: <full commit SHA you have reviewed>
          path: dcp-ai

      - uses: actions/setup-node@v4
        with:
          node-version: "22"

      - name: Build the reference verifier
        run: |
          (cd dcp-ai/sdks/typescript && npm ci && npm run build)
          (cd dcp-ai && npm install)

      - name: Verify the agent's bundle
        run: node dcp-ai/bin/dcp.js verify-bundle --policy hybrid_required my-agent/bundle.signed.json
```

A verified bundle is intact and signed by the keys it names; to accept bundles only from principals you trust, use admission (`dcp admit-bundle`, see [docs/ADMISSION.md](../docs/ADMISSION.md)).

## License

Apache-2.0
