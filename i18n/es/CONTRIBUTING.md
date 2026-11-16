<sub>[English](../../CONTRIBUTING.md) · [中文](../zh-CN/CONTRIBUTING.md) · **Español** · [日本語](../ja/CONTRIBUTING.md) · [Português](../pt-BR/CONTRIBUTING.md)</sub>

<a id="contributing-to-dcp-ai"></a>

# Contribuir a DCP-AI

> Traducción informativa de [la versión en inglés](../../CONTRIBUTING.md), actualizada el 26/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Gracias por tu interés en contribuir al Digital Citizenship Protocol para agentes de IA. Esta guía te ayudará a empezar.

<a id="development-environment-setup"></a>

## Preparar el entorno de desarrollo

<a id="prerequisites"></a>

### Requisitos previos

- **Node.js** >= 20 (el protocolo central y el SDK de TypeScript; la CI usa 20 y 22)
- **Python** >= 3.10 (el SDK de Python; la CI usa 3.12)
- **Go** >= 1.25 (necesario para el SDK de Go)
- **Rust** (toolchain estable, necesario para el SDK de Rust)
- **Git**

<a id="getting-started"></a>

### Primeros pasos

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

### Preparar los SDK

Cada SDK vive en su propio directorio bajo `sdks/` y tiene dependencias independientes. Ejecuta estos comandos desde la raíz del repositorio; cada subshell vuelve a ella:

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

## Ejecutar las pruebas

<a id="core-protocol"></a>

### Protocolo central

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

### Entre SDK

Cada SDK lee los vectores compartidos de `tests/interop/v2/` desde su propia suite de pruebas. Dos herramientas comprueban los SDK entre sí (compila antes `sdks/typescript` e instala `sdks/python`; Go y Rust deben estar en el `PATH`):

```bash
node tools/interop-matrix/run.mjs   # agents on the four SDKs sign and verify each other's bundles
node tools/difffuzz/run.mjs         # the same mutated bundle through the four verifiers
```

Ambas se ejecutan en la CI en cada pull request, y cada noche.

<a id="documentation-and-translations"></a>

### Documentación y traducciones

Los documentos públicos tienen una fuente en inglés y cuatro traducciones, enumeradas en `scripts/docs-i18n.json`; si
difieren, prevalece el texto en inglés. La fuente en inglés conserva su ruta y cada traducción tiene la misma ruta
bajo `i18n/<locale>/` (`es`, `pt-BR`, `ja` o `zh-CN`): la traducción al español de `spec/DCP-01.md` es
`i18n/es/spec/DCP-01.md`. Antes, las traducciones estaban junto a su fuente como `<dir>/<name>.<locale>.md`. Esas rutas
ya no existen en `main` y no hay archivos de redirección; un commit o una etiqueta anteriores conservan cada archivo en
su ruta antigua. Las comprobaciones necesitan el conjunto de herramientas de documentación que instala la CI, que también aporta los módulos
`markdown` y `yaml`:

```bash
pip install 'mkdocs==1.6.*' 'mkdocs-material==9.5.*' 'pymdown-extensions==10.*'
python3 scripts/docs_i18n.py check                             # coverage, reviewed hashes, structure and links
python3 -m unittest discover -s scripts -p 'test_docs*.py' -v  # positive and negative controls of the gate
bash scripts/build-docs-site.sh                                 # builds and validates all five languages
```

`build-docs-site.sh` construye y valida el sitio; no ejecutes `mkdocs build` después. Para una vista previa local de
un idioma, que no es una construcción completa:

```bash
python3 scripts/docs_site.py preview --locale en
mkdocs serve -f docs-site/en/mkdocs.yml
```

Cuando cambies un documento, mantén completas sus cuatro traducciones, con su aviso, sus anclas y sus bloques de código
iguales a los del inglés. Solo después de leer las cuatro frente al nuevo texto en inglés, registra sus hashes:

```bash
python3 scripts/docs_i18n.py record <source.md> --reviewed
```

Esto registra hashes; no certifica la calidad de una traducción. No registres un documento cuyas
traducciones no hayas leído.

<a id="code-style"></a>

## Estilo de código

El proyecto usa herramientas automáticas para mantener un estilo de código coherente:

- **ESLint** para el análisis de JavaScript/TypeScript (véase `.eslintrc.json`)
- **Prettier** para el formato del código (véase `.prettierrc.json`)
- **EditorConfig** para la configuración básica del editor (véase `.editorconfig`)

<a id="key-rules"></a>

### Reglas principales

- Usa `const` por defecto; nunca uses `var`
- Usa comillas simples para las cadenas
- Incluye siempre comas finales
- El ancho máximo de línea es de 100 caracteres
- Usa sangría de 2 espacios (salvo en los Makefiles)

Da formato al código antes de hacer commit (el paquete raíz no instala Prettier ni ESLint, así que `npx` los descarga si no están instalados):

```bash
npx prettier --write .
npx eslint --fix .
```

<a id="submitting-pull-requests"></a>

## Enviar pull requests

1. **Haz un fork del repositorio** y crea una rama de trabajo a partir de `main`.
2. **Haz tus cambios** en commits acotados y lógicos.
3. **Escribe o actualiza las pruebas** de toda funcionalidad nueva o corrección.
4. **Asegúrate de que todas las pruebas pasan** en local antes de abrir un PR.
5. **Abre un pull request** contra `main` con una descripción clara de qué cambió y por qué.

<a id="pr-checklist"></a>

### Lista de comprobación del PR

- [ ] Todas las pruebas existentes pasan
- [ ] Se añadieron pruebas para la funcionalidad nueva
- [ ] El código sigue las pautas de estilo del proyecto
- [ ] La documentación se actualizó si corresponde, en todos los idiomas que tiene el documento
- [ ] Cambios en firma, hashing, canonicalización o verificación: vectores compartidos actualizados y la matriz de interoperabilidad pasa
- [ ] Los mensajes de commit siguen el formato siguiente

<a id="commit-message-format"></a>

## Formato de los mensajes de commit

Usa mensajes de commit convencionales:

```
<type>(<scope>): <short summary>

<optional body>
```

<a id="types"></a>

### Tipos

- **feat**: una funcionalidad nueva
- **fix**: una corrección de errores
- **docs**: solo cambios de documentación
- **style**: formato, puntos y coma que faltan, etc. (sin cambios de código)
- **refactor**: un cambio de código que no corrige errores ni añade funcionalidades
- **test**: añadir o actualizar pruebas
- **chore**: proceso de build, actualización de dependencias, herramientas

<a id="scopes"></a>

### Ámbitos

- **core**: protocolo central, CLI, esquemas
- **sdk/ts**: SDK de TypeScript
- **sdk/py**: SDK de Python
- **sdk/go**: SDK de Go
- **sdk/rust**: SDK de Rust
- **sdk/wasm**: SDK de WASM
- **integration/\***: integraciones con frameworks
- **ci**: workflows de CI/CD

<a id="examples"></a>

### Ejemplos

```
feat(sdk/ts): add post-quantum signature support
fix(core): correct Merkle root computation for single-entry chains
docs(sdk/py): add installation instructions for extras
test(core): add conformance tests for expired bundles
chore(ci): add code coverage to TypeScript SDK workflow
```

<a id="testing-requirements"></a>

## Requisitos de las pruebas

- Toda funcionalidad nueva debe incluir sus pruebas.
- Las correcciones deben incluir una prueba de regresión que habría detectado el error.
- Las pruebas de conformidad de `tests/conformance/` verifican el cumplimiento del protocolo en todas las implementaciones.
- Una regla que aplican todos los SDK recibe un vector compartido en `tests/interop/v2/`, para que los cuatro SDK se prueben con el mismo caso.
- Las pruebas de los SDK deben cubrir la creación de bundles, la firma, la verificación y los casos de error.
- La CI debe pasar antes de poder fusionar un PR. Los fallos de las pruebas no se ocultan: si las pruebas fallan, el build falla.

<a id="questions"></a>

## ¿Preguntas?

Si tienes preguntas sobre cómo contribuir, abre un issue en GitHub o inicia una discusión. Estaremos encantados de ayudarte a empezar.
