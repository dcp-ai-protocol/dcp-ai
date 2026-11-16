<sub>[English](../../../../tools/release-validation/README.md) · [中文](../../../zh-CN/tools/release-validation/README.md) · **Español** · [日本語](../../../ja/tools/release-validation/README.md) · [Português](../../../pt-BR/tools/release-validation/README.md)</sub>

<a id="release-validation"></a>

# Validación de publicaciones

> Traducción informativa de [la versión en inglés](../../../../tools/release-validation/README.md), actualizada el 10/11/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Instala los paquetes DCP publicados desde sus registros oficiales en consumidores temporales, comprueba
su identidad y su origen, y ejecuta el kit externo de conformidad que ya existe
([`tools/conformance`](../../../../tools/conformance/README.md)) contra lo instalado. No añade ningún
catálogo, oráculo ni modelo de conformidad. La guía para lectores es
[docs/conformance/RELEASE_VALIDATION.md](../../../../docs/conformance/RELEASE_VALIDATION.md); este archivo
es la referencia para ejecutar y mantener la herramienta.

Un PASS afirma solo esto: estos artefactos, con estos hashes, obtenidos de estos registros, pasaron
estos catálogos con el kit en esta revisión y en este entorno. No es una certificación y no cubre nada
que no se haya ejecutado.

```
node tools/release-validation/run.mjs [--list] [--lane <id>]... [--catalog <id>]...
                                      [--resolution locked|fresh] [--work <dir>] [--clean]
                                      [--python <exe>] [--go <exe>] [--cargo <exe>] [--chrome <exe>]
node --test tools/release-validation/release-validation.test.mjs     # no external network
```

| Salida | Significado |
|---|---|
| 0 | PASS: todos los lanes, todas las celdas de catálogo (60), todos los bloques (3) y todos los controles |
| 1 | una discrepancia: un artefacto respondió y la expectativa versionada no coincide |
| 2 | uso |
| 3 | error: de infraestructura, de identidad, no soportado, incompleto o de implementación |
| 4 | PARTIAL: una selección sin fallos. Un diagnóstico, nunca una validación |

Un error nunca cuenta como un rechazo, y prevalece sobre una discrepancia. Instalar un paquete y
acreditar su origen no es conformidad: solo lo son las celdas y los bloques.

Las pruebas no usan red externa; una de ellas sirve un índice de paquetes desde un servidor HTTP de
loopback.

<a id="requirements"></a>

## Requisitos

Node 20 o posterior en un host POSIX, con el `npm` que está junto a `node`, `/bin/ps`, `/usr/bin/tar` y, para el lane de Go, `/usr/bin/unzip`. Solo módulos integrados de Node.

Python, Go, Rust y Chrome son herramientas del host: la ruta indicada con `--python`, `--go`, `--cargo` o `--chrome`, o el primer `python3`, `go` o `cargo` del `PATH` propio de la herramienta (el directorio de `node`, `/usr/bin`, `/bin`) y el Chrome habitual de la plataforma. No se instala, actualiza ni cambia nada: `GOTOOLCHAIN=local`, y un proxy de rustup se rechaza, así que hay que pasar el cargo propio del toolchain (`rustup which cargo`), que debe tener `rustc` al lado. Python debe ser 3.11 o posterior (el lane sdist en modo `fresh` lee `pyproject.toml` con `tomllib`); los locks versionados son para CPython
3.12.

## Lanes

| Lane | Artefacto publicado | Evidencia |
|---|---|---|
| `npm-sdk` | npm `@dcp-ai/sdk` 2.4.0 | 8 catálogos |
| `npm-wasm-node` | npm `@dcp-ai/wasm` 2.2.0, en Node | 6 catálogos |
| `npm-wasm-browser` | el mismo paquete, API pública en un Chrome real | 6 catálogos y el bloque `direct-sections` (103 casos) |
| `npm-cli` | npm `@dcp-ai/cli` 2.2.0 | sin catálogo: los bloques `cli-suites` (218 pruebas) y `cli-negative-control` |
| `pypi-wheel` | PyPI `dcp-ai` 2.11.0, wheel | 8 catálogos |
| `pypi-sdist` | PyPI `dcp-ai` 2.11.0, sdist, construido aquí | 8 catálogos |
| `go` | módulo Go `sdks/go/v2` v2.14.0 | 8 catálogos |
| `crates-default` | crates.io `dcp-ai` 2.14.0, features por defecto | 8 catálogos |
| `crates-otlp` | el mismo crate con la feature `otlp` | 8 catálogos |

Seis versiones publicadas y nueve lanes. Seis lanes ejecutan 8 catálogos y los dos lanes de WebAssembly
ejecutan 6: 60 celdas de catálogo, más 3 bloques. `manifest.json` contiene las identidades esperadas (las del dossier de auditoría), los catálogos y los lanes; `expected-blocks.json`
contiene los identificadores que cada bloque debe informar.

<a id="what-a-run-does"></a>

## Qué hace una ejecución

1. **Directorio de trabajo.** Un directorio `mkdtemp` nuevo, o `--work <dir>`, que no debe existir y
   debe estar fuera del checkout. No se reutiliza nada.
2. **Entorno.** Cada subproceso recibe un entorno construido por la herramienta. `HOME`, `TMPDIR`, las cachés y los ajustes de cada gestor de paquetes están dentro del directorio de trabajo. `PATH` no: es la lista corta, propia de la herramienta, de directorios del host (el directorio de `node`, `/usr/bin`, `/bin` y el directorio de un toolchain indicado por opción). No se hereda nada: ni
   credenciales, ni proxy, ni configuración del usuario o del proyecto.
3. **Instalación, identidad y origen**, por ecosistema (más abajo). Para cada paquete deben coincidir
   tres valores: el del manifiesto, el hash que la herramienta calcula sobre los bytes descargados y el
   que registra el gestor de paquetes o el registro. El archivo descargado debe ser igual, archivo por
   archivo y en ambos sentidos, a lo que se instala o se compila, salvo los pocos archivos que un
   instalador escribe por sí mismo, que se nombran más abajo.
4. **Celdas.** Una ejecución del runner del kit por lane y catálogo, con el wrapper propio del kit
   apuntando al paquete instalado. Un informe solo cuenta si es de esta ejecución: una ruta que no
   existía, una ejecución dentro del intervalo observado con un identificador no visto antes, el argv,
   `kit.catalog_sha256`, los hashes de los fixtures, las suites y los identificadores de caso que se
   pidieron, y un estado acorde con el código de salida del runner. Cada caso debe tener un estado que
   su clase permita, y los recuentos de cada suite y del informe (incluido `executed`) deben ser los de
   los casos.
5. **Bloques.** La evidencia que no es una celda de catálogo (las suites de la CLI, su control negativo,
   las secciones directas del navegador) es un bloque de su lane. La campaña exige cada bloque
   exactamente una vez, como una celda: la instalación o el estado de un lane nunca lo sustituyen.
6. **Controles**, en la misma ejecución. Cada lane que aporta controles (`npm-sdk`, `npm-cli`, `npm-wasm-browser`) debe su propio conjunto fijo siempre que se selecciona: exactamente un resultado con `ok === true` para cada identificador y ningún otro, o la campaña es un error. Algunos son positivos que deben pasar. Los demás son copias alteradas de las salidas reales (resultados ausentes, duplicados y desconocidos, informes antiguos, recuentos incoherentes, identidades alteradas y orígenes locales) y ejecuciones reales (una expectativa invertida que debe fallar, fallos del wrapper y del arnés, plazos vencidos, un proceso que queda atrás, una ejecución del navegador detenida desde fuera), cada uno de los cuales debe rechazarse de la manera que se le exige.
7. **Informe.** `report.json` en el directorio de trabajo, con los informes del runner, las salidas de los bloques, los logs, los archivos descargados y los locks. Se conserva todo; `--clean` elimina solo
   los consumidores instalados y las cachés de esta ejecución.

Un proceso solo cuenta como ejecutado si todas sus observaciones están limpias (sin señal, sin plazo
vencido, sin límite de salida, sin dejar nada atrás); el código de salida 0 por sí solo no basta. Cada
fase tiene un plazo, y el supervisor detiene todo el árbol de procesos, sean cuales sean sus grupos de
procesos.

### npm (`npm-sdk`, `npm-wasm-node`, `npm-wasm-browser`, `npm-cli`)

Un solo consumidor (`consumers/npm`) con los tres paquetes en versiones exactas y un lock. Comprobación estática del consumidor y del lock (versiones exactas, todas las entradas de `registry.npmjs.org` con integridad sha512, sin enlaces, cada paquete DCP una sola vez); `npm pack` en una caché vacía, con el hash calculado por la herramienta; `npm ci --ignore-scripts` (`locked`) o `npm install --ignore-scripts` (`fresh`); y después el archivo contra el árbol instalado.

`@dcp-ai/wasm` 2.2.0 contiene `pkg/package.json` con el nombre y la versión del crate de Rust del que se compiló (`dcp-ai` 2.14.0). El informe registra las dos identidades y nunca espera que sean iguales.

- **`npm-cli`.** Las cuatro suites de `cli/__tests__` y el `negative-control.mjs` del kit se ejecutan contra la CLI instalada (`DCP_CLI_ROOT`): su binario, su `lib/` y sus dependencias tal como npm las instaló. La herramienta comprueba antes que la CLI instalada cargaría el único `@dcp-ai/sdk`
  verificado. El veredicto del propio control negativo no se acepta sin más: su salida debe mostrar
  exactamente los cuatro casos invertidos fallando, cada uno en una aserción, y los otros 214 pasando.
- **`npm-wasm-browser`.** El `wasm-browser.mjs` del kit maneja la API pública `DcpWasm` en un Chrome real con un perfil temporal. Los archivos que sirve quedan fijados a un `SHA256SUMS` que la
  herramienta escribe a partir del árbol instalado. Cada celda y las secciones directas deben venir con
  el registro de navegador que el propio wrapper escribe de esa ejecución: nuevo, con el identificador
  de la ejecución, dentro del intervalo observado, sirviendo los archivos instalados, con un navegador
  que respondió, terminó y cuyo perfil se eliminó.

### Python (`pypi-wheel`, `pypi-sdist`)

Cada lane tiene sus propios entornos virtuales. Python se ejecuta con `-I -B`, y pip con `--isolated`, sin caché, sin archivo de configuración y con `https://pypi.org/simple/` como único índice.

- **Wheel.** `pip download`; el SHA-256 se comprueba antes de instalar nada; `pip install --only-binary :all:`; el informe del propio pip da el hash que instaló y muestra que todos los archivos vinieron de
  `files.pythonhosted.org`. El wheel y la distribución instalada se comparan en ambos sentidos: cada
  archivo de módulo debe ser igual y no puede haber nada más instalado. Solo quedan fuera los archivos
  que pip escribe por sí mismo en `*.dist-info`: `RECORD` (reescrito), `INSTALLER` y `REQUESTED`; un `direct_url.json` es aquí un problema. No existe bytecode cuando se comparan los árboles (`--no-compile`, `-B`). `import dcp_ai` debe cargar desde ese site-packages, sin user site y sin
  ninguna ruta fuera del directorio de trabajo y del intérprete.
- **Sdist.** El archivo se descarga primero como bytes con `fetch-pypi.mjs`, que no desempaqueta ni
  ejecuta nada, y su SHA-256 se compara con el manifiesto; lo que el índice declara sobre él se
  registra aparte y no se da por bueno. Solo entonces se desempaqueta, se instalan las dependencias de
  construcción y se construye el wheel desde el archivo local con `--no-index --no-build-isolation`. El
  wheel construido es un artefacto aparte en el informe; sus archivos de módulo deben ser exactamente
  los del sdist, en ambos sentidos. Se instala en un entorno limpio y se compara como en el lane del
  wheel, salvo que allí `direct_url.json` es lo esperado (se instaló un wheel local) y debe apuntar
  dentro del directorio de trabajo.
- **Locks.** `consumers/python/<platform>/` contiene `wheel.txt` (el wheel y sus dependencias de ejecución), `sdist.txt` y `build.txt` (las dependencias de construcción), todos fijados con hashes, y `platform.json`. Hay un directorio por plataforma, elegido por el intérprete que se ejecuta: `cpython-3.12-darwin-arm64` y `cpython-3.12-linux-x86_64`. En cualquier otro intérprete o plataforma, `locked` se rechaza como no soportado en lugar de intentarse.

### Go (`go`)

El `main.go` del kit, byte a byte, con los `go.mod` y `go.sum` versionados (`consumers/go`, sin `replace`), compilado con `-mod=readonly`, `GOPROXY=https://proxy.golang.org`, `GOSUMDB=sum.golang.org`, `GOENV=off` y `GOWORK=off`. El módulo se descarga primero fuera de cualquier módulo, de modo que go lo comprueba contra la base de datos de checksums. La herramienta calcula `h1` por sí misma sobre los
archivos del zip descargado, compara el zip con el directorio desde el que go compila y lee la
información de compilación del binario: el módulo, su versión y su `h1`, sin nada reemplazado. El
informe registra la arquitectura para la que compila la herramienta go, que no tiene por qué ser la del
host.

### Rust (`crates-default`, `crates-otlp`)

El `src/main.rs` del kit, byte a byte, en dos consumidores con sus propios `Cargo.toml` y `Cargo.lock` (`consumers/rust-default`, `consumers/rust-otlp`), `CARGO_HOME` y directorio target. El `Cargo.toml` del consumidor debe ser, línea a línea, el único manifiesto que la herramienta espera. Tras `cargo fetch --locked`, el `.crate` se hashea y se compara con el manifiesto y con el lock antes de compilar nada; `cargo metadata` debe decir que `dcp-ai` viene de crates.io, de un directorio dentro del directorio de trabajo, con las features del lane; el `.crate` se compara en ambos sentidos con ese directorio, salvo el marcador `.cargo-ok` propio de cargo; y después `cargo build --locked`.

<a id="locked-and-fresh"></a>

## `locked` y `fresh`

- `locked` (el valor por defecto): las dependencias de terceros salen de los locks versionados. La
  selección es reproducible; las herramientas del host (npm, pip, Go, cargo, rustc, el compilador de C,
  Chrome) no se fijan, solo se registran.
- `fresh`: se resuelven ahora, como las obtendría un consumidor nuevo. Los locks resultantes se conservan en el directorio de trabajo: `package-lock.fresh.json` en su raíz y los demás bajo `locks/`. En el lane sdist, las dependencias de construcción quedan entonces registradas pero no
  fijadas.

Las seis identidades DCP se exigen en los dos modos.

## CI

`.github/workflows/release-validation.yml` ejecuta la herramienta en `ubuntu-24.04`, manualmente (`workflow_dispatch`) o en PR que cambien esta herramienta o las entradas del kit de conformidad. Los PR ejecutan la campaña completa (`all`, `locked`), con acceso de lectura al repositorio, sin secretos y sin ningún paso de publicación. Sus entradas son un lane (`all` o un lane) y la resolución. `ci.mjs` decide el resultado: PASS solo para `all` con salida 0; PARTIAL, informado como diagnóstico, solo para un lane con salida 4;
cualquier otra combinación hace fallar el job. El directorio de trabajo se sube como artefacto en todos
los casos.

<a id="updating-for-another-release"></a>

## Actualización para otra publicación

Esta herramienta no publica nada. Después de que una versión se haya publicado y sus identificadores
se hayan registrado en el dossier de auditoría:

1. Poner las versiones y los identificadores nuevos en `manifest.json` y en la prueba que los congela. Los nombres de archivo de un paquete (`file`) y la versión interna del crate de `@dcp-ai/wasm`
   cambian con ello.
2. Actualizar los consumidores: las versiones en `consumers/npm/package.json`, `consumers/go/go.mod` y los dos `Cargo.toml`, y las líneas DCP de los locks de Python.
3. Regenerar los locks con `--resolution fresh` en cada plataforma que tenga uno, y copiarlos desde el directorio de trabajo: `package-lock.fresh.json`, que está en su raíz, y `locks/python/<platform>/`, `locks/go/`, `locks/rust-default/` y `locks/rust-otlp/`. Un lock de
   Python solo se produce ejecutando en esa plataforma.
4. Si cambiaron las suites de la CLI o las secciones directas del kit, actualizar
   `expected-blocks.json`.
5. Ejecutar las pruebas y después la campaña completa en modo `locked`.

<a id="limits"></a>

## Límites

- Una campaña es un entorno. Lo que se ha ejecutado está en la guía; no se afirma nada más.
- Los wrappers y el runner son los del checkout; el paquete que se prueba es el del registro. La
  resolución de módulos no está instrumentada: la comprobación de origen es el lock, el árbol instalado
  y la ruta que informa el wrapper.
- Los locks de Python cubren dos plataformas. Los hashes que contiene un lock no dicen nada sobre
  ninguna otra.
- La versión y el user agent del navegador se registran tal como el navegador los informa. El user
  agent es reducido y no indica qué arquitectura se ejecutó.
- La limpieza de procesos lee la tabla de procesos. Un proceso desligado por un padre que muere dentro
  de un intervalo de sondeo (250 ms) no se ve, no se limpia nada si la propia herramienta muere por
  SIGKILL, y si `ps` falla no se envía ninguna señal y el informe dice que la limpieza no se confirmó.
  Una ejecución del navegador detenida desde fuera deja su perfil temporal en el directorio de trabajo.
- Sin proxy: el entorno construido para los subprocesos no tiene ninguna variable de proxy.
- El informe contiene rutas absolutas del host y ningún valor de entorno distinto de los que construyó
  la herramienta.
