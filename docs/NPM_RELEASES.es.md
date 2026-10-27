<a id="published-npm-packages"></a>

# Paquetes publicados en npm

**Publicación Rust (26/10/2026).** Rust `dcp-ai` 2.11.0 está publicado en crates.io, incluidas las correcciones del verificador, admisión y API experimentales opt-in. `dcp-jcs-v1` sigue siendo el perfil normativo predeterminado. Véase [Rust 2.11.0](RUST_RELEASE.md).

**Publicación Go (26/10/2026).** El SDK Go `v2.11.0` está disponible desde la etiqueta `sdks/go/v2.11.0`, incluidas las correcciones del verificador, admisión y API experimentales opt-in. La publicación Rust sigue siendo independiente. Véase [Go v2.11.0](GO_RELEASE.md).

**Publicación Python (26/10/2026).** `dcp-ai` 2.10.0 ya está disponible en PyPI, incluidas las correcciones del verificador, la admisión y las API experimentales opt-in. Las publicaciones de Go y Rust siguen siendo independientes. Véase [Python 2.10.0](PYTHON_RELEASE.md).

> Traducción informativa de [la versión en inglés](NPM_RELEASES.md), actualizada el 26/10/2026. Si difieren, prevalece la versión en inglés.

Verificado el 26/10/2026. Estas 13 versiones exactas están publicadas con la etiqueta `latest`. Su integridad en el registro coincidió con los tarballs probados y una instalación nueva desde npm pasó 383 comprobaciones. Las versiones de los paquetes son independientes de la versión del formato/especificación DCP y de las etiquetas del repositorio.

| Paquete | Versión |
|---|---|
| [`@dcp-ai/sdk`](https://www.npmjs.com/package/@dcp-ai/sdk) | 2.2.0 |
| [`@dcp-ai/wasm`](https://www.npmjs.com/package/@dcp-ai/wasm) | 2.1.0 |
| [`@dcp-ai/cli`](https://www.npmjs.com/package/@dcp-ai/cli) | 2.1.0 |
| [`@dcp-ai/anthropic-mcp`](https://www.npmjs.com/package/@dcp-ai/anthropic-mcp) | 2.1.0 |
| [`@dcp-ai/autogen`](https://www.npmjs.com/package/@dcp-ai/autogen) | 2.0.1 |
| [`@dcp-ai/express`](https://www.npmjs.com/package/@dcp-ai/express) | 2.1.0 |
| [`@dcp-ai/google-a2a`](https://www.npmjs.com/package/@dcp-ai/google-a2a) | 2.1.0 |
| [`@dcp-ai/openclaw`](https://www.npmjs.com/package/@dcp-ai/openclaw) | 2.1.0 |
| [`@dcp-ai/w3c-did`](https://www.npmjs.com/package/@dcp-ai/w3c-did) | 2.0.1 |
| [`@dcp-ai/create-crewai`](https://www.npmjs.com/package/@dcp-ai/create-crewai) | 2.0.1 |
| [`@dcp-ai/create-express`](https://www.npmjs.com/package/@dcp-ai/create-express) | 2.0.1 |
| [`@dcp-ai/create-langchain`](https://www.npmjs.com/package/@dcp-ai/create-langchain) | 2.0.1 |
| [`@dcp-ai/create-openai`](https://www.npmjs.com/package/@dcp-ai/create-openai) | 2.0.1 |

<a id="install-the-published-versions"></a>

## Instalar las versiones publicadas

```bash
npm install @dcp-ai/sdk@^2.2.0
npm install @dcp-ai/wasm@^2.1.0
npm install @dcp-ai/express@^2.1.0 express
npx --package=@dcp-ai/cli@2.1.0 dcp-ai --help
```

Esta publicación cubre solo npm. No publica un paquete Python en PyPI, un crate Rust en crates.io, una etiqueta de módulo Go ni una imagen de contenedor. Revisa el estado de publicación de cada SDK antes de usar ejemplos del código fuente en esos ecosistemas. La raíz del repositorio sigue usando un SDK local para probar el código del checkout; es una decisión de desarrollo, no una limitación de disponibilidad en npm.

`@dcp-ai/sdk` 2.2.0 incluye confianza en el principal, `strict-v1`, las correcciones del verificador y las API experimentales del candidato. `@dcp-ai/express` y `@dcp-ai/openclaw` 2.1.0 incluyen la verificación corregida de firmas V2 y los controles de admisión documentados. Sus versiones 2.0.0 siguen afectadas; véase [SECURITY.md](../SECURITY.md). Publicar los paquetes no convierte un bundle verificado en confiable ni autoriza una acción.

Tanto en `@dcp-ai/sdk` 2.2.0 como en `@dcp-ai/wasm` 2.1.0, `dcp-jcs-v2` sigue siendo experimental, no normativo y opt-in. `dcp-jcs-v1` sigue siendo el único predeterminado normativo. Los generadores y auxiliares de integración conservan las limitaciones de sus README; publicarlos no convierte las demostraciones en verificadores de producción.
