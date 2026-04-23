<sub>[English](CONTRIBUTING.md) · [中文](CONTRIBUTING.zh-CN.md) · **Español** · [日本語](CONTRIBUTING.ja.md) · [Português](CONTRIBUTING.pt-BR.md)</sub>

# Contribuir a DCP-AI

Gracias por tu interés en contribuir al Digital Citizenship Protocol for AI Agents. Esta guía te ayudará a empezar.

## Configuración del Entorno de Desarrollo

### Prerrequisitos

- **Node.js** >= 18 (requerido para el protocolo core y el SDK TypeScript)
- **Python** >= 3.12 (requerido para el SDK Python)
- **Go** >= 1.21 (requerido para el SDK Go)
- **Rust** (toolchain stable, requerido para el SDK Rust)
- **Git**

### Primeros Pasos

```bash
# Clone the repository
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai

# Install root dependencies (core protocol + CLI)
npm install

# Run conformance tests to verify your setup (should print "DCP-AI CONFORMANCE PASS (V1 + V2)")
npm run conformance
```

### Setup de los SDKs

Cada SDK vive en su propio directorio bajo `sdks/` y tiene dependencias independientes:

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

## Ejecutar Tests

### Protocolo Core

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

## Estilo de Código

Este proyecto usa herramientas automatizadas para aplicar un estilo de código consistente:

- **ESLint** para linting de JavaScript/TypeScript (consulta `.eslintrc.json`)
- **Prettier** para formateo de código (consulta `.prettierrc.json`)
- **EditorConfig** para configuraciones básicas del editor (consulta `.editorconfig`)

### Reglas Clave

- Usa `const` por defecto; nunca uses `var`
- Usa comillas simples para strings
- Incluye siempre comas finales (trailing commas)
- Ancho máximo de línea de 100 caracteres
- Usa indentación de 2 espacios (excepto Makefiles)

Formatea tu código antes de hacer commit:

```bash
npx prettier --write .
npx eslint --fix .
```

## Enviar Pull Requests

1. **Haz fork del repositorio** y crea una rama de feature desde `main`.
2. **Haz tus cambios** en commits enfocados y lógicos.
3. **Escribe o actualiza tests** para cualquier funcionalidad nueva o corrección de bugs.
4. **Asegúrate de que todos los tests pasen** localmente antes de abrir un PR.
5. **Abre un pull request** contra `main` con una descripción clara de qué cambió y por qué.

### Checklist del PR

- [ ] Todos los tests existentes pasan
- [ ] Se agregaron nuevos tests para la funcionalidad nueva
- [ ] El código sigue las pautas de estilo del proyecto
- [ ] Documentación actualizada si aplica
- [ ] Los mensajes de commit siguen el formato a continuación

## Formato de Mensajes de Commit

Usa mensajes de commit convencionales:

```
<type>(<scope>): <short summary>

<optional body>
```

### Tipos

- **feat**: Una nueva funcionalidad
- **fix**: Una corrección de bug
- **docs**: Cambios solo de documentación
- **style**: Formateo, punto y coma faltantes, etc. (sin cambio de código)
- **refactor**: Cambio de código que ni corrige un bug ni agrega una funcionalidad
- **test**: Agregar o actualizar tests
- **chore**: Proceso de build, actualizaciones de dependencias, tooling

### Scopes

- **core**: Protocolo core, CLI, schemas
- **sdk/ts**: SDK TypeScript
- **sdk/py**: SDK Python
- **sdk/go**: SDK Go
- **sdk/rust**: SDK Rust
- **sdk/wasm**: SDK WASM
- **integration/\***: Integraciones con frameworks
- **ci**: Workflows CI/CD

### Ejemplos

```
feat(sdk/ts): add post-quantum signature support
fix(core): correct Merkle root computation for single-entry chains
docs(sdk/py): add installation instructions for extras
test(core): add conformance tests for expired bundles
chore(ci): add code coverage to TypeScript SDK workflow
```

## Requisitos de Testing

- Todas las nuevas funcionalidades deben incluir tests correspondientes.
- Las correcciones de bugs deben incluir un test de regresión que hubiese atrapado el bug.
- Los tests de conformidad en `tests/conformance/` verifican el cumplimiento del protocolo en todas las implementaciones.
- Los tests de los SDKs deben cubrir la creación de bundles, firma, verificación y casos de error.
- CI debe pasar antes de que un PR pueda ser mergeado. Los fallos de tests no se suprimen — si los tests fallan, el build falla.

## ¿Preguntas?

Si tienes preguntas sobre cómo contribuir, abre un issue en GitHub o inicia una discusión. Estaremos encantados de ayudarte a empezar.
