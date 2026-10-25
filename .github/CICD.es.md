<sub>[English](CICD.md) · [中文](CICD.zh-CN.md) · **Español** · [日本語](CICD.ja.md) · [Português](CICD.pt-BR.md)</sub>

<a id="github-actions--ci"></a>
<a id="github-actions-ci"></a>

# GitHub Actions y CI

> Traducción informativa de [la versión en inglés](CICD.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Las GitHub Actions y el flujo de CI de este repositorio: dos acciones compuestas en `.github/actions/` y el flujo `ci.yml`.

> **Los flujos de este repositorio no ejercitan las acciones** (25/10/2026), y no se probaron desde otro repositorio. Las dos ejecutan código de un checkout de este repositorio: `verify-bundle` carga `lib/verify.js`, que necesita compilado el SDK del workspace (`sdks/typescript`), y `conformance-test` ejecuta `tools/conformance.js` del workspace, así que solo funciona en un checkout de este repositorio. Para verificar bundles en tu propio pipeline, véase [Verificar bundles en tu proyecto](#verifying-bundles-in-your-project).

<a id="available-actions"></a>

## Acciones disponibles

### `verify-bundle`

Verifica un Signed Bundle de DCP en un flujo de GitHub Actions con el verificador de referencia (`lib/verify.js`). Los bundles V1 pasan comprobaciones de esquema, firma Ed25519, cadena de auditoría y Merkle. Los bundles V2 normativos (`schemas/v2/signed_bundle.schema.json`) se validan contra el esquema y después los verifica `@dcp-ai/sdk`: manifiesto, firma compuesta Ed25519 + ML-DSA-65, vinculación de sesión y cadena de auditoría.

Instala el paquete raíz del checkout desde el que se ejecuta (`npm install --production`, ignorando los errores de instalación) y no compila el SDK del workspace, así que compila `sdks/typescript` en un paso anterior. Verifica con la política por defecto: no hay ninguna entrada de política.

Usa solo entradas de ruta literales y de confianza: la acción las interpola en shell y en JavaScript evaluado con `eval`, en lugar de pasarlas como datos. Las comillas o la sintaxis de shell en una ruta pueden cambiar el comando. No obtengas estas entradas de un pull request, una incidencia o un nombre de artefacto que no sean de confianza. El ejemplo con la CLI de referencia de abajo pasa la ruta como argumento.

```yaml
- uses: ./.github/actions/verify-bundle
  with:
    bundle-path: "path/to/signed_bundle.json"
    public-key-path: "keys/public_key.txt"  # Optional
    fail-on-invalid: "true"
    node-version: "20"
```

<a id="inputs"></a>

#### Entradas

| Entrada | Obligatoria | Valor por defecto | Descripción |
|-------|----------|---------|-------------|
| `bundle-path` | Sí | — | Ruta al archivo JSON del bundle firmado |
| `public-key-path` | No | — | Ruta a la clave pública Ed25519 esperada. V1: verifica contra ella (si no, se usa la clave incluida en el bundle). V2: fija el firmante clásico del bundle |
| `fail-on-invalid` | No | `"true"` | Hace fallar el paso si el bundle no es válido |
| `node-version` | No | `"20"` | Versión de Node.js |

<a id="outputs"></a>

#### Salidas

| Salida | Descripción |
|--------|-------------|
| `verified` | `"true"` o `"false"` |
| `errors` | Errores de verificación (si los hay) |

<a id="usage-example"></a>

#### Ejemplo de uso

Un esbozo para un checkout de este repositorio (no se ejecutó para esta página): la acción y `lib/verify.js` proceden del
checkout, y `agent/citizenship_bundle.signed.json` y `agent/public_key.txt` representan archivos que aporta el operador.

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

Ejecuta `node tools/conformance.js` en el workspace: la suite de conformidad V1 + V2 del repositorio, sobre sus propios ejemplos. Solo funciona en un checkout de este repositorio, y su entrada `test-dir` no se usa.

```yaml
- uses: ./.github/actions/conformance-test
  with:
    node-version: "20"
    test-dir: "tests/conformance/examples"
```

<a id="inputs-1"></a>
<a id="inputs_1"></a>

#### Entradas

| Entrada | Obligatoria | Valor por defecto | Descripción |
|-------|----------|---------|-------------|
| `node-version` | No | `"20"` | Versión de Node.js |
| `test-dir` | No | `"tests/conformance/examples"` | La acción no la usa |

<a id="outputs-1"></a>
<a id="outputs_1"></a>

#### Salidas

| Salida | Descripción |
|--------|-------------|
| `passed` | Si pasaron todas las pruebas |
| `summary` | Resumen de las pruebas |

<a id="usage-example-1"></a>
<a id="usage-example_1"></a>

#### Ejemplo de uso

Un esbozo para un checkout de este repositorio (no se ejecutó para esta página). `tools/conformance.js` importa
`@dcp-ai/sdk`, así que primero se compila el SDK del workspace:

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

<a id="ci-workflow"></a>

## Flujo de CI

El flujo `ci.yml` se ejecuta en los pushes a `main` y en los pull requests contra cualquier rama base. Un trabajo `changes` detecta qué partes cambiaron (`dorny/paths-filter`), y los trabajos de abajo se ejecutan para esas partes:

| Trabajo | Qué ejecuta |
|-----|--------------|
| `conformance` | Node.js 20 y 22: `npm install`, `npm run conformance`, las pruebas del rango del escalar S de `tools/crypto.js` y del playground, `npm run examples:generate:v2`, `dcp verify-bundle` sobre los ejemplos V1 y V2 (V2 con `hybrid_required`) y `dcp integrity` |
| `typescript-sdk` | `sdks/typescript`: `npm install`, `npx tsc --noEmit`, `npm run build`, `npm run test`, cobertura |
| `integrations` | `anthropic-mcp`, `express`, `google-a2a`, `openclaw`: compila el SDK del workspace, `npm ci`, compilación, `vitest run` |
| `cli` | Node.js 20 y 22: compila el SDK del workspace, lo instala en `cli/`, las pruebas de la CLI y su control negativo, y una comprobación de los archivos empaquetados |
| `python-sdk` | Python 3.12: `pip install -e ".[dev]"`, `pytest` con cobertura |
| `go-sdk` | Go según `sdks/go/go.mod`: `go build ./...`, `go test` con cobertura |
| `rust-sdk` | Rust estable: `cargo build`, `cargo build --features otlp`, cobertura, `cargo test --all-features`, una compilación de las pruebas para `wasm32-unknown-unknown` |
| `wasm-sdk` | Rust estable y `wasm-pack`: `npm run build:wasm`, `npm test` en `sdks/wasm` |

Otros flujos cubren la matriz y el laboratorio del candidato de canonicalización, los contratos, el fuzzing diferencial, la matriz de interoperabilidad, las etiquetas y la publicación (npm, PyPI, imágenes Docker, integraciones, plantillas). Dos cubren la documentación, y ninguno traduce nada automáticamente: `i18n-sync.yml` («Documentation and i18n») comprueba, en los pull requests y en los pushes a `main` que tocan Markdown o las herramientas de documentación, la cobertura, los hashes revisados, la estructura y los enlaces de los cinco idiomas, ejecuta los controles positivos y negativos de esa puerta y construye el sitio en los cinco idiomas; `docs.yml` construye el mismo sitio en `main` y lo despliega en GitHub Pages.

Para ejecutar en local las mismas comprobaciones de documentación, véase [Documentation and translations](../CONTRIBUTING.md#documentation-and-translations) en CONTRIBUTING.md:

```bash
pip install 'mkdocs==1.6.*' 'mkdocs-material==9.5.*' 'pymdown-extensions==10.*'
python3 scripts/docs_i18n.py check
python3 -m unittest discover -s scripts -p 'test_docs*.py' -v
bash scripts/build-docs-site.sh
```

<a id="verifying-bundles-in-your-project"></a>

## Verificar bundles en tu proyecto

Un esbozo que verifica un bundle con la CLI de referencia de un checkout fijado (no se ejecutó para esta página). `dcp verify-bundle` sale con 0 cuando el bundle se verifica y con un valor distinto de cero en caso contrario, y solo lee archivos bajo el directorio actual:

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

Un bundle verificado está íntegro y firmado por las claves que nombra; para aceptar bundles solo de principales en los que confías, usa la admisión (`dcp admit-bundle`, véase [docs/ADMISSION.md](../docs/ADMISSION.md)).

<a id="license"></a>

## Licencia

Apache-2.0
