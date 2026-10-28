<a id="published-npm-packages"></a>

# Paquetes publicados en npm

> Traducción informativa de [la versión en inglés](NPM_RELEASES.md), actualizada el 28/10/2026. Si difieren, prevalece la versión en inglés.

Verificado el 28/10/2026: `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1 y `@dcp-ai/cli` 2.1.1 están publicados con la etiqueta `latest`; los otros diez paquetes de la tabla no cambian. Las versiones de los paquetes son independientes de la versión del formato/especificación DCP y de las etiquetas del repositorio.

El 26/10/2026 se publicaron 13 versiones con la etiqueta `latest`: `@dcp-ai/sdk` 2.2.0, `@dcp-ai/wasm` 2.1.0, `@dcp-ai/cli` 2.1.0 y los diez paquetes que siguen en la tabla. Su integridad en el registro coincidió con los tarballs probados y una instalación nueva desde npm pasó 383 comprobaciones.

| Paquete | Versión |
|---|---|
| [`@dcp-ai/sdk`](https://www.npmjs.com/package/@dcp-ai/sdk) | 2.2.1 |
| [`@dcp-ai/wasm`](https://www.npmjs.com/package/@dcp-ai/wasm) | 2.1.1 |
| [`@dcp-ai/cli`](https://www.npmjs.com/package/@dcp-ai/cli) | 2.1.1 |
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

<a id="what-changed-on-28102026"></a>

## Qué cambió el 28/10/2026

`@dcp-ai/sdk` 2.2.1 y `@dcp-ai/wasm` 2.1.1 verifican los campos secundarios SHA3-256 opcionales de [VERIFICATION.md V2-11](../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) cuando están presentes: los ausentes no se exigen, así que un bundle verificado puede no tener una cadena secundaria completa, y un campo presente que sea `null`, no sea una cadena o sea incoherente se rechaza. `@dcp-ai/cli` 2.1.1 requiere `@dcp-ai/sdk` `^2.2.1`, y `--version` informa `2.1.1`. No cambian las API, los campos de resultado, `dcp-jcs-v1`, las API experimentales opt-in de `dcp-jcs-v2` ni el tratamiento de `hash_alg`. Los adaptadores publicados `@dcp-ai/express`, `@dcp-ai/openclaw`, `@dcp-ai/anthropic-mcp` y `@dcp-ai/google-a2a` 2.1.0 no se volvieron a publicar: dependen de `@dcp-ai/sdk` `^2.2.0` y obtienen las comprobaciones secundarias cuando tu lockfile resuelve `@dcp-ai/sdk` 2.2.1 o posterior.

Los tres tarballs del registro son idénticos byte a byte a los artefactos revisados, con integridad `sha512` coincidente. Un consumidor nuevo que instala desde npm, sin sustituciones locales, pasó 411 veredictos secundarios SHA3-256 y 87 controles, 340 comprobaciones de regresión y 80 comprobaciones de la CLI (`--version` 2.1.1); el paquete `@dcp-ai/wasm` del registro pasó 167 comprobaciones en un navegador real.

<a id="install-the-published-versions"></a>

## Instalar las versiones publicadas

```bash
npm install @dcp-ai/sdk@^2.2.1
npm install @dcp-ai/wasm@^2.1.1
npm install @dcp-ai/express@^2.1.0 express
npx --package=@dcp-ai/cli@2.1.1 dcp-ai --help
```

Cada publicación npm cubre solo npm. No publica un paquete Python en PyPI, un crate Rust en crates.io, una etiqueta de módulo Go ni una imagen de contenedor. Revisa el estado de publicación de cada SDK antes de usar ejemplos del código fuente en esos ecosistemas. La raíz del repositorio sigue usando un SDK local para probar el código del checkout; es una decisión de desarrollo, no una limitación de disponibilidad en npm.

Desde la 2.2.0, `@dcp-ai/sdk` incluye confianza en el principal, `strict-v1`, las correcciones del verificador y las API experimentales del candidato. `@dcp-ai/express` y `@dcp-ai/openclaw` 2.1.0 incluyen la verificación corregida de firmas V2 y los controles de admisión documentados. Sus versiones 2.0.0 siguen afectadas; véase [SECURITY.md](../SECURITY.md). Publicar los paquetes no convierte un bundle verificado en confiable ni autoriza una acción.

En `@dcp-ai/sdk` 2.2.0 y posteriores y en `@dcp-ai/wasm` 2.1.0 y posteriores, `dcp-jcs-v2` sigue siendo experimental, no normativo y opt-in. `dcp-jcs-v1` sigue siendo el único predeterminado normativo. Los generadores y auxiliares de integración conservan las limitaciones de sus README; publicarlos no convierte las demostraciones en verificadores de producción.

<a id="related-releases"></a>

## Publicaciones relacionadas

Las versiones actuales en cada registro están en [Versiones publicadas](README.md#published-versions). Otras notas de publicación: [Python 2.10.1](PYTHON_RELEASE.md), [Go v2.11.1](GO_RELEASE.md) y [Rust 2.11.1](RUST_RELEASE.md).
