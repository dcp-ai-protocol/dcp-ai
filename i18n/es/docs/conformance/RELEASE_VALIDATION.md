<sub>[English](../../../../docs/conformance/RELEASE_VALIDATION.md) · [中文](../../../zh-CN/docs/conformance/RELEASE_VALIDATION.md) · **Español** · [日本語](../../../ja/docs/conformance/RELEASE_VALIDATION.md) · [Português](../../../pt-BR/docs/conformance/RELEASE_VALIDATION.md)</sub>

<a id="release-validation"></a>

# Validación de publicaciones

> Traducción informativa de [la versión en inglés](../../../../docs/conformance/RELEASE_VALIDATION.md), actualizada el 10/11/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Después de publicar una versión, [`tools/release-validation`](../../../../tools/release-validation/README.md) instala los paquetes publicados desde sus registros oficiales, como lo haría un consumidor nuevo, y ejecuta los catálogos externos de conformidad contra lo instalado. Esta página explica qué demuestra eso, qué se ha ejecutado hasta ahora y qué no cubre. El README de la herramienta es la referencia para ejecutarla.

<a id="what-it-covers"></a>

## Qué cubre

Las seis versiones publicadas el 09/11/2026 ([dossier de auditoría](../../../../docs/conformance/AUDIT_DOSSIER.md#publication-of-09112026)), a través de nueve lanes:

| Versión publicada | Lanes |
|---|---|
| npm `@dcp-ai/sdk` 2.4.0 | `npm-sdk` |
| npm `@dcp-ai/wasm` 2.2.0 | `npm-wasm-node` (Node) y `npm-wasm-browser` (un Chrome real) |
| npm `@dcp-ai/cli` 2.2.0 | `npm-cli` |
| PyPI `dcp-ai` 2.11.0 | `pypi-wheel` (el wheel) y `pypi-sdist` (el sdist, construido desde el código fuente) |
| Módulo Go `sdks/go/v2` v2.14.0 | `go` |
| crates.io `dcp-ai` 2.14.0 | `crates-default` y `crates-otlp` (con la feature `otlp`) |

Cada lane instala su paquete en un directorio temporal con un entorno construido para él, comprueba que los bytes descargados son los publicados y que lo que se instala o se compila son esos bytes, y solo entonces ejecuta la evidencia:

- **60 celdas de catálogo.** Los ocho catálogos externos del [kit de conformidad](../../../../tools/conformance/README.md) en seis lanes (el SDK, los dos lanes de Python, Go y los dos lanes de Rust), y los seis que se aplican a la API de WebAssembly en sus dos lanes. El lane de la CLI no tiene catálogo. Son 6142 casos con los catálogos de esta revisión.
- **103 casos directos** de la API pública `DcpWasm` en el navegador.
- **Las cuatro suites de la CLI** (218 pruebas) contra la CLI instalada, y su control negativo.
- **58 controles** en la misma ejecución. Algunos son positivos que deben pasar; los demás son copias alteradas de los informes reales, expectativas invertidas, fallos inyectados, plazos vencidos y orígenes locales, cada uno de los cuales debe rechazarse de la manera que se le exige.

No añade ningún catálogo ni ninguna expectativa propia. Las expectativas son las del kit, versionadas en este repositorio.

<a id="what-a-result-means"></a>

## Qué significa un resultado

- **PASS** exige todo lo anterior en una sola ejecución. Afirma que estos artefactos, con estos hashes, obtenidos de estos registros, pasaron estos catálogos con el kit en esta revisión y en este entorno. No es una certificación y no dice nada sobre un entorno que no se ejecutó.
- **PARTIAL** es una selección de lanes o catálogos sin fallos. Es un diagnóstico y nunca se informa como un pass.
- **Una discrepancia** significa que un artefacto instalado respondió y la expectativa versionada no coincide.
- **Un error** significa que no hubo una respuesta válida que juzgar: el registro, la red, un toolchain, una identidad que no coincide, un informe incompleto o que no es de esta ejecución. Un error nunca cuenta como un rechazo del protocolo, ni como un pass.

Instalar un paquete y acreditar de dónde vino no es conformidad. Solo las celdas de catálogo y los bloques son evidencia sobre el comportamiento.

La herramienta no cambia nada en el protocolo: el perfil de canonicalización `dcp-jcs-v1`, el núcleo, los SDK y los catálogos se usan tal como están.

<a id="what-has-been-run"></a>

## Qué se ha ejecutado

Una campaña completa, el 10/11/2026, desde una copia del repositorio con solo sus archivos públicos:

| Elemento | Observado |
|---|---|
| Resultado | PASS: 60 celdas (6142 de 6142 casos), 103 casos directos, 218 pruebas de la CLI, el control negativo, 58 controles |
| Modo | `locked` (los locks versionados) |
| Host | macOS en Apple silicon (arm64), Node 22.15.0, npm 11.3.0 |
| Python | CPython 3.12.2, arm64 |
| Go | go1.26.10, que en este host compila `darwin/amd64`: el binario de Go validado es amd64 |
| Rust | cargo y rustc 1.93.1, aarch64 |
| Navegador | Google Chrome 157.0.8103.50. Su user agent es reducido y no indica qué arquitectura se ejecutó |
| Informe | ejecución `dfeaa975-f449-4947-8238-32bb3f372d87`, SHA-256 de `report.json` `2b5c4c109b76038c693c73ab6485a3a3634949790fd57648637deaf9a23b7ee7` |

El informe y sus archivos los conservan los mantenedores; no están en el repositorio.

También se ejecutó, y no es una campaña: los dos lanes de Python con el primer catálogo en un contenedor Linux x86_64 (Ubuntu 24.04, CPython 3.12.3, emulado en el mismo host), en modo `fresh` y en modo `locked`. De ahí sale el lock de Linux.

**La campaña completa en GitHub pasó.** El 10/11/2026 (America/Santiago), el workflow ejecutó los nueve lanes en modo `locked` en un runner de GitHub con Ubuntu 24.04 x86_64. La evidencia conservada se contrastó independientemente: pasaron las 60 celdas (6142 casos), 103 casos directos de navegador, 218 pruebas CLI, el control negativo con exactamente cuatro fallos y los 58 controles; las pruebas de la herramienta pasaron 37/37 sin omisiones.

| Elemento | Observado |
|---|---|
| GitHub | [Release validation #42936377966](https://github.com/dcp-ai-protocol/dcp-ai/actions/runs/42936377966) |
| Run | `29adf7d3-14a9-4ad8-b57b-d3f3e5bcc628` |
| UTC | `2026-11-11T01:06:03.656Z` – `2026-11-11T01:12:52.962Z` |
| Node / npm | 22.23.4 / 10.9.9 |
| Python / pip | CPython 3.12.16 x86_64 / 25.0.1 |
| Go | 1.26.10 linux/amd64 |
| Rust | cargo / rustc 1.99.1, x86_64-unknown-linux-gnu |
| Chrome | Google Chrome 156.0.8078.79 |
| `report.json` SHA-256 | `d0b5da90f06b204ae46677a8fbaeb54d6f3b1620c204f8aea2d33a7efedac84f` |

El workflow se ejecuta en los PR pertinentes y bajo demanda, con acceso de lectura al repositorio y sin pasos de publicación. Sus artefactos se conservan 30 días. Se recalcularon independientemente los hashes de los archivos descargados y los de sus árboles fuente coincidieron con las comprobaciones de los árboles instalados registradas antes de que `--clean` eliminara los consumidores; esto no afirma una segunda inspección de esos archivos eliminados.

<a id="running-it"></a>

## Cómo ejecutarla

```bash
node --test tools/release-validation/release-validation.test.mjs
node tools/release-validation/run.mjs --python "/path/to/python3.12" --go "/path/to/go" --cargo "$(rustup which cargo)"
```

El primer comando no usa red externa (una prueba sirve un índice desde un servidor HTTP de loopback). El segundo descarga de npm, PyPI, el proxy de Go y crates.io, y necesita Chrome. `--lane` y `--catalog` seleccionan una parte, que termina como PARTIAL. En CI, hay que iniciar a mano el workflow *Release validation*. Los requisitos, las opciones y la estructura del informe están en el [README de la herramienta](../../../../tools/release-validation/README.md).

Las dependencias de terceros salen de locks versionados (`locked`, el valor por defecto) o se resuelven en ese momento (`fresh`). Los locks de Python existen para CPython 3.12 en macOS arm64 y en Linux x86_64; en cualquier otro intérprete o plataforma, los lanes de Python necesitan `fresh`.

<a id="not-covered"></a>

## Qué no cubre

- Ninguna versión distinta de las seis anteriores, ni nada que no esté publicado en esos registros: las integraciones con frameworks, las imágenes Docker, las plantillas de proyecto, los servicios y los contratos.
- Sistemas operativos, arquitecturas, intérpretes y navegadores que no se ejecutaron. En particular: ni Windows, ni un binario de Go para arm64, ni ningún navegador distinto de Chrome.
- Las herramientas propias del host. npm, pip, Go, cargo, rustc, el compilador de C y Chrome se usan tal como están y se registran, no se fijan.
- Las propiedades que los propios catálogos no cubren. Sus límites están en el [kit de conformidad](../../../../tools/conformance/README.md) y en el [dossier de auditoría](../../../../docs/conformance/AUDIT_DOSSIER.md#known-limits-and-exclusions).
