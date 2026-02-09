# GitHub Actions & CI

GitHub Actions reutilizables y workflow CI para el ecosistema DCP. Incluye acciones para verificar bundles y ejecutar tests de conformidad en pipelines de CI/CD.

## Actions disponibles

### `verify-bundle`

Verifica un Signed Bundle DCP en un workflow de GitHub Actions.

```yaml
- uses: ./.github/actions/verify-bundle
  with:
    bundle-path: "path/to/signed_bundle.json"
    public-key-path: "keys/public_key.txt"  # Opcional
    fail-on-invalid: "true"
    node-version: "20"
```

#### Inputs

| Input | Requerido | Default | Descripcion |
|-------|-----------|---------|-------------|
| `bundle-path` | Si | — | Ruta al archivo JSON del signed bundle |
| `public-key-path` | No | — | Ruta a la clave publica Ed25519 |
| `fail-on-invalid` | No | `"true"` | Falla el step si el bundle es invalido |
| `node-version` | No | `"20"` | Version de Node.js |

#### Outputs

| Output | Descripcion |
|--------|-------------|
| `verified` | `"true"` o `"false"` |
| `errors` | Errores de verificacion (si los hay) |

#### Ejemplo de uso

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

Ejecuta los tests de conformidad DCP contra un directorio de ejemplos.

```yaml
- uses: ./.github/actions/conformance-test
  with:
    node-version: "20"
    test-dir: "tests/conformance/examples"
```

#### Inputs

| Input | Requerido | Default | Descripcion |
|-------|-----------|---------|-------------|
| `node-version` | No | `"20"` | Version de Node.js |
| `test-dir` | No | `"tests/conformance/examples"` | Directorio con ejemplos de test |

#### Outputs

| Output | Descripcion |
|--------|-------------|
| `passed` | Si todos los tests pasaron |
| `summary` | Resumen de los tests |

#### Ejemplo de uso

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

El workflow `ci.yml` se ejecuta en push y pull requests a `main`. Incluye 5 jobs:

### Jobs

#### 1. `conformance`

Tests de conformidad del protocolo con matrix de Node.js.

- **Matrix:** Node.js 18, 20, 22
- **Steps:**
  1. Checkout
  2. Setup Node.js
  3. `npm install`
  4. `npm run conformance` — Ejecuta tests de conformidad
  5. Verifica signed bundle de ejemplo (si existe)
  6. `node bin/dcp.js integrity` — Verifica integridad del protocolo

#### 2. `typescript-sdk`

Build y type-check del SDK TypeScript.

- **Directorio:** `sdks/typescript/`
- **Steps:**
  1. `npm install`
  2. `npx tsc --noEmit` — Type check
  3. `npm run build` — Build ESM + CJS

#### 3. `python-sdk`

Tests del SDK Python.

- **Directorio:** `sdks/python/`
- **Python:** 3.12
- **Steps:**
  1. `pip install -e ".[dev]"`
  2. `pytest -v`

#### 4. `go-sdk`

Build y tests del SDK Go.

- **Directorio:** `sdks/go/`
- **Go:** 1.21
- **Steps:**
  1. `go build ./...`
  2. `go test ./...`

#### 5. `rust-sdk`

Build, tests y WASM del SDK Rust.

- **Directorio:** `sdks/rust/`
- **Rust:** stable
- **Steps:**
  1. `cargo build`
  2. `cargo test`
  3. `cargo build --target wasm32-unknown-unknown --features wasm`

### Usar el CI en tu proyecto

```yaml
# .github/workflows/dcp.yml
name: DCP Verification
on: [push, pull_request]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # Verificar bundle de tu agente
      - uses: ./.github/actions/verify-bundle
        with:
          bundle-path: "my-agent/bundle.signed.json"

      # Ejecutar conformance
      - uses: ./.github/actions/conformance-test
        with:
          test-dir: "my-agent/test-fixtures"
```

## Licencia

Apache-2.0
