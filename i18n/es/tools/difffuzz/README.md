<sub>[English](../../../../tools/difffuzz/README.md) · [中文](../../../zh-CN/tools/difffuzz/README.md) · **Español** · [日本語](../../../ja/tools/difffuzz/README.md) · [Português](../../../pt-BR/tools/difffuzz/README.md)</sub>

<a id="differential-fuzzer-for-the-v2-bundle-verifiers"></a>

# Fuzzer diferencial para los verificadores de bundles V2

> Traducción informativa de [la versión en inglés](../../../../tools/difffuzz/README.md), actualizada el 05/11/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

`run.mjs` envía el mismo bundle V2 firmado y mutado a los cuatro verificadores SDK (`verifySignedBundleV2` en TypeScript, `verify_signed_bundle_v2` en Python, `VerifySignedBundleV2At` en Go y `verify_signed_bundle_v2_at` en Rust), con una política explícita y un mismo instante de verificación. Son hallazgos un desacuerdo, un veredicto contrario a lo declarado por los vectores compartidos, un reordenamiento de claves que cambie el veredicto y cualquier error, caída o tiempo agotado. La ronda de seguridad cerrada en v2.10.0 consistió casi por completo en desacuerdos entre los cuatro verificadores; esta herramienta permite encontrarlos antes de una publicación. El controlador es `fuzz.mjs`, compartido por `run.mjs` y las autopruebas. Con `--sdks five`, el SDK de Rust compilado a WASM es un quinto verificador ([Cinco SDK](#five-sdks-wasm)). Un segundo arnés, `run-mandates.mjs`, hace lo mismo con las cadenas de mandatos de DCP-09 ([Cadenas de mandatos](#mandate-chains)).

<a id="setup"></a>

## Preparación

Cada SDK se ejecuta desde este checkout, nunca desde un paquete publicado:

```bash
(cd sdks/typescript && npm install && npm run build) # shims/ts imports sdks/typescript/dist
pip install -e sdks/python                            # dependencies of shims/py (pynacl, pqcrypto>=1.0)
npm ci --ignore-scripts                               # root lock: tweetnacl and @noble/post-quantum for run-mandates.mjs
```

Go (la versión de `sdks/go/go.mod`) y una cadena de herramientas estable de Rust deben estar en `PATH`. El controlador compila `shims/go` (módulo que usa `replace` para apuntar el SDK a `../../../../sdks/go`) con `-mod=readonly`, y `shims/rust` (dependencia local de `../../../../sdks/rust`) con `--locked`. Ambos se construyen en un directorio temporal privado de la ejecución, incluido `CARGO_TARGET_DIR` de Cargo. Las ejecuciones concurrentes no comparten un binario; por ello, el shim Rust se compila desde cero cada vez. No cambia ningún manifiesto ni lockfile. Con `--offline`, Go usa `GOPROXY=off` y Cargo `--offline`: las cachés de módulos y crates ya deben contener las dependencias. La compilación tiene su propio plazo.

`build.artifacts` registra por contenido lo medido: los cuatro shims, los dos binarios compilados (sus hashes, nunca sus rutas efímeras), los árboles TypeScript `src` y `dist`, su `package-lock.json` y el directorio de cada dependencia directa de ejecución resuelta por Node, las fuentes del SDK Python y el intérprete con cinco versiones de distribuciones, y las fuentes Go y Rust junto con el lock de Rust. `inputs` registra el controlador (`fuzz.mjs`, `run.mjs`) y los fixtures. Ambos se comprueban de nuevo al terminar; un cambio produce salida 3. `provenance_limits` aclara lo que los hashes no prueban: no se verifica que ese `dist` se compilara desde ese `src`, ni las dependencias transitivas.

<a id="usage"></a>

## Uso

```bash
node tools/difffuzz/run.mjs                       # 200 iterations, seed 1
node tools/difffuzz/run.mjs --iterations 2000 --seed 7 --report /tmp/difffuzz.json
node tools/difffuzz/run.mjs --replay tools/difffuzz/findings/<file>.json
node --test tools/difffuzz/difffuzz.test.mjs      # self-tests of the harness (no SDK)
node --test tools/difffuzz/real-shims.test.mjs    # bounded diagnostic tests with all four SDKs
node tools/difffuzz/run.mjs --sdks five --iterations 60 --report /tmp/difffuzz-five.json
```

| Opción | Predeterminado | Significado |
| --- | --- | --- |
| `--iterations N` | `200` | mutantes a generar (0 a 1.000.000) |
| `--seed S` | `1` | semilla del PRNG; con la misma semilla y fixtures se obtienen los mismos mutantes |
| `--modes a,b` | `default,hybrid_required` | políticas de cada semilla y mutante (véase Políticas) |
| `--sdks four\|five` | `four` | conjunto de SDK de la ejecución; `five` añade la compilación WASM (véase Cinco SDK) |
| `--timeout MS` | `60000` | plazo de un proceso por lote (`--timeout-ms` es equivalente) |
| `--python PATH` | `$DIFFFUZZ_PYTHON` o `python3` | intérprete con las dependencias del SDK Python |
| `--out DIR` | `tools/difffuzz/findings` | directorio donde se escriben hallazgos |
| `--report FILE` | ninguno | informe completo (JSON): primero se escribe `incomplete` y se reemplaza en cada ruta, incluido error de uso; un valor ausente, con forma de opción o repetido no escribe nada |
| `--offline` | desactivado | compilar solo desde cachés locales |
| `--build-timeout-ms MS` | `600000` | un plazo para compilar los shims |
| `--batch-cases N`, `--batch-bytes B`, `--case-bytes B` | `64`, 16 MiB, 4 MiB | casos por lote, tamaño UTF-8 exacto de toda la solicitud y bytes crudos de una entrada; semilla que no cabe: salida 3; mutante que no cabe: omitido y contado |
| `--stdout-bytes B` | 8 MiB | límite de salida de un proceso por lote |
| `--max-findings N` | `50` | hallazgos registrados; al alcanzarlo no se ejecutan más lotes (incluida línea base) y la ejecución no puede aprobar |
| `--max-retries N` | `200` | reintentos individuales para aislar lotes fallidos; agotarlos produce salida 3 |
| `--minimize-steps N`, `--minimize-total N` | `24`, `96` | presupuesto de minimización por hallazgo y por ejecución |

Se valida cada valor antes de compilar: un argumento desconocido, repetido, ausente o fuera de rango produce salida 2. Códigos de salida: 0 sin hallazgos ni lotes fallidos y con línea base completa; 1 al menos un hallazgo, un lote fallido o una línea base incompleta; 2 uso; 3 fallo de infraestructura o del ejecutor (compilación fallida, entradas que cambian durante la ejecución, shim que no arranca o responde fuera del protocolo o como no compatible, en lote o solo, presupuesto de reintentos agotado o ninguna semilla declarada válida en el primer modo cuando hay iteraciones). Los comandos siempre son exactamente los shims del conjunto de SDK de la ejecución.

<a id="policies-and-time"></a>

### Políticas y tiempo

Cada solicitud incluye política e instante explícitos: `now_ms` es 2026-10-22T00:00:00Z, el instante del kit externo, de modo que el veredicto no depende del día de ejecución. `default` es la `default_verifier_policy` de los vectores (la `DEFAULT_VERIFIER_POLICY` de TypeScript) para cada SDK. Cualquier otro nombre de modo se aplica a `default_mode` y a cada nivel de riesgo, como hacen los vectores al construir la política de cada modo. Los `verifier_policy_overrides` de una semilla reemplazan esos campos en todos los modos. Antes de este protocolo, `default` era la política propia de cada SDK y cada shim leía su reloj del sistema.

<a id="seeds-and-expectations"></a>

### Semillas y expectativas

Las semillas son los bundles de `tests/interop/v2/bundle_vectors.json`, con lo declarado en `_description`: `signed_bundle` verifica; cada mutación `must_reject` y entrada `must_reject_bundles` se rechaza en cualquier modo; cada entrada `must_accept_bundles` verifica en todos los modos; `classical_only_routine_bundle` usa `verified_by_mode`, que no declara veredicto para `default`. La política predeterminada se resuelve a uno de los cuatro modos, por lo que «todos» y «cualquiera» la incluyen. Un veredicto contrario a una expectativa declarada es un hallazgo `expectation` aunque coincidan los cuatro SDK: el acuerdo nunca es el oráculo. Si esa expectativa contradice la propia especificación, conserva el reproductor y deja de usar esa interpretación; no la reemplaces por la mayoría. Los bundles firmados de `tests/interop/v2/cross_sdk_vectors.json` y `tests/conformance/examples/` no declaran expectativas y se usan solo para comparación diferencial.

Cada iteración impar —al menos la mitad, redondeando hacia arriba— parte de una semilla declarada válida en el primer modo, elegida al azar; las demás parten de cualquier semilla. Si hay iteraciones y no existe tal semilla, la ejecución termina con salida 3.

<a id="mutators"></a>

### Mutadores

Cada iteración aplica una mutación (70 %) o dos (30 %) en una posición aleatoria: borrar una clave, asignar `null`, cambiar el tipo de un valor, intercambiar dos valores hermanos, alterar un carácter de base64, reemplazar una cadena enumerada por una clave de prototipo (`constructor`, `__proto__`, `toString`, `valueOf`, ...), renombrar una clave a una de prototipo, agregar una desconocida, duplicar un artefacto (o su `payload`, `payload_hash` o `composite_sig`) en otra posición, reescribir un número como `1.0`, `1e2`, `-0`, `0.1`, `2^64`, `1e400`, ..., reescribir un timestamp RFC 3339 con otro desplazamiento horario, malformado o muy lejano en el pasado o futuro, una cadena sobredimensionada (64 KiB o 1 MiB), un valor anidado a profundidad 100 y un reordenamiento recursivo de claves. Este último nunca debe cambiar el veredicto: se compara el resultado de cada SDK con su propia línea base de esa semilla. Los números que JavaScript no puede representar se insertan literalmente en el texto serializado, para que todos los parsers reciban los mismos bytes. El reordenamiento conserva una clave propia `__proto__`, que antes se eliminaba.

<a id="judgement"></a>

## Evaluación

Cada shim responde con `verdict` (`verified` y `errors`), `parse_rejected` (su parser JSON rechazó el documento), `error` (el SDK lanzó una excepción o panic) o `unsupported`. El controlador añade `crash` (salida distinta de 0 o señal), `timeout`, `output_limit` y `protocol` (respuesta ajena al protocolo). Se comparan los SDK por aceptación: `true` acepta; `false` o rechazo del parser rechazan, como antes; ninguna otra categoría cuenta como voto. Un lote cuyo proceso falla se registra y se vuelve a ejecutar cada caso por separado para identificar el causante. El lote fallido impide aprobar la ejecución sea cual sea el resultado de los reintentos; un fallo que ningún caso individual reproduce también es hallazgo (`batch_failure_not_reproduced`). Antes de finalizar se espera cada ejecución de shim del lote, independientemente de cuál falle primero.

<a id="findings"></a>

## Hallazgos

Cada hallazgo se escribe en `findings/<seed>-<iteration>-<mode>-<n>.json` (directorio ignorado por Git salvo `.gitkeep`): clases, semilla, modo, política explícita y `now_ms`, mutaciones, resultado de cada SDK y bytes exactos de entrada (`input_b64`, `input_sha256`). Un hallazgo es una pista, no todavía un defecto. Reprodúcelo primero con `--replay`: los bytes registrados y la entrada minimizada, si existe, se ejecutan en los shims del conjunto de SDK del hallazgo con el `now_ms` y la política propios del hallazgo, en un lote junto a su control registrado. Este contiene los bytes originales de la semilla sin mutar, hash, política, expectativa y resultados de línea base; nunca se sustituye por el fixture actual del mismo nombre. Primero se valida el hallazgo con tipos completos: clase de hallazgo, conjunto de clases conocidas igual al derivado de sus resultados, un resultado tipado por cada SDK de su conjunto, hashes y control. La compilación, controlador, fixtures y semilla actuales se comparan con los registrados y cada diferencia se informa como diferencia de procedencia. Salidas de replay: 0 se reproducen las decisiones y la línea base del control; 1 no se reproducen; 3 el hallazgo, el control o la infraestructura no permiten evaluar.

Después se minimizan desacuerdos, errores o caídas de un mutante dentro de un presupuesto (un hallazgo de expectativa ya es una semilla sin mutar), solo con control positivo: la semilla sin mutar aprobó su línea base en ese modo, verificada `true` por todos los SDK del conjunto seleccionado. Una semilla correctamente rechazada no sirve de control. Se reducen las diferencias manteniendo la decisión de cada SDK y la línea base de la semilla, ejecutada junto al candidato. Los tokens crudos como `1e400` se conservan como bytes; nunca se vuelve a parsear el texto. El resultado es mínimo para esa búsqueda y presupuesto, no globalmente; no se minimizan hallazgos de orden de claves ni tiempos agotados.

Decide qué SDK es correcto a partir de los requisitos normativos (`spec/VERIFICATION.md` y perfil de canonicalización) y los fixtures compartidos (`tests/interop/v2/`). Cuando no resuelven el caso, es una pregunta abierta de especificación: regístrala en vez de adoptar por defecto el rechazo preventivo. Corrige el SDK equivocado empezando por una prueba unitaria en ese SDK y nunca debilites un verificador para alcanzar acuerdo.

## Shims

`--batch` es el protocolo del controlador (`dcp-difffuzz/3`): un proceso finito por lote, mediante `runProcess` de `tools/conformance/external.js`, con un plazo, grupo de procesos propio, SIGTERM seguido de SIGKILL, salida limitada y limpieza. La solicitud en stdin es `{protocol, run_id, nonce, now_ms, cases: [{id, policy, bundle_b64}]}`, con IDs aleatorios y sin expectativa ni nombre de semilla. La respuesta en stdout es un documento JSON `{protocol, run_id, nonce, results}` con un resultado por caso y después salida 0. Una solicitud malformada sale con 2. El shim Go escribe `errors` nil como `[]`; el de Rust decodifica base64 solo con `std`.

En este protocolo interno del arnés, los diagnósticos de veredicto por lote conservan como máximo 8 `errors`, cada uno como prefijo literal de hasta 256 puntos de código Unicode. Una lista o cadena recortada lleva `truncated` con `original_count` (cantidad original), `kept` (cantidad conservada), `original_code_points` (total original) y `sha256` (digest de la lista original). Los diagnósticos dentro de esos límites no cambian. Los tipos de diagnóstico malformados siguen siendo fallos de protocolo; nunca se convierten en rechazos válidos. Esto no cambia los formatos de intercambio de DCP ni las decisiones del verificador.

El digest procesa cada diagnóstico original en orden: primero su longitud en bytes UTF-8 como entero de 4 bytes big-endian y después sus bytes UTF-8. TypeScript y Python reemplazan los sustitutos aislados por U+FFFD para este hash; el prefijo diagnóstico no se normaliza. Go reemplaza cada byte UTF-8 inválido por U+FFFD para el hash; las cadenas de Rust son UTF-8 válido. Los textos difieren entre SDK, por lo que estos digests identifican diagnósticos de un shim concreto, no equivalencia entre SDK.

El controlador comprueba los límites y la coherencia del marcador, incluida evidencia de que realmente se omitió algo. El marcador acompaña los resultados registrados. No puede autenticar el texto original sin disponer de él, ni demostrar que un shim no recortó silenciosamente un mensaje corto que por lo demás es válido. Los hallazgos históricos de `dcp-difffuzz/2` siguen siendo reproducibles, incluidos sus diagnósticos originales sin cota; las respuestas en vivo deben usar `dcp-difffuzz/3` y cumplir sus límites. La salida manual y del bucle conserva su comportamiento anterior.

`stats.truncated_diagnostic_observations` cuenta observaciones de diagnósticos recortados por SDK, incluidas las repetidas durante los reintentos de aislamiento y la minimización; no cuenta entradas distintas. Las cotas limitan el transporte de diagnósticos, no el cálculo ni la memoria interna del SDK. Siguen aplicándose los límites de salida existentes: un `--stdout-bytes` configurado más pequeño puede producir legítimamente `output_limit`, y un lote fallido sigue impidiendo aprobar la ejecución.

Sin `--batch`, cada uno de los cuatro shims históricos conserva su forma anterior para uso manual (el shim WASM solo admite `--batch` o `--bound-selftest`): un documento en stdin, o uno por línea con `--loop`, `{"valid": bool, "errors": [string]}` por documento, modo opcional como primer argumento, la política predeterminada propia de cada SDK y el reloj del sistema.

<a id="five-sdks-wasm"></a>

## Cinco SDK: WASM

`--sdks five` añade el SDK de Rust compilado a WebAssembly como quinto verificador (`shims/wasm/verify.mjs`).

- **Compilación.** `wasm-pack build sdks/rust --target web -- --features wasm --locked` se ejecuta en el directorio propio de la ejecución, dentro del mismo plazo de compilación (`--offline`: `--mode no-install` y `--offline`). Nunca se toca el `tools/conformance/wrappers/.build` compartido. Se registran el `.wasm`, su código JavaScript de enlace y la versión de wasm-pack; no se verifica que el toolchain reproduzca esos bytes.
- **Ejecución.** WebAssembly alojado en Node, no un navegador. `wasm_verify_signed_bundle_v2` lee el reloj del host: cada llamada ve el `now_ms` de la solicitud a través de `Date.now`, que se restaura en `finally`.
- **Bytes.** El shim pasa el texto UTF-8 decodificado exactamente como llega, incluida una marca de orden de bytes inicial (decodificado con `ignoreBOM`), sin parsearlo ni reserializarlo en JavaScript. Solo el rechazo documentado del parser JSON del export (un error que empieza por `JSON parse error: `) es `parse_rejected`; los bytes que no son UTF-8 son `parse_rejected`, como en el shim TypeScript; cualquier otro error en banda, una política ilegible o un trap es `error`.
- **Frontera del shim TypeScript.** El shim TypeScript histórico decodifica con `TextDecoder` sin `ignoreBOM`, lo que elimina una marca de orden de bytes inicial antes de `JSON.parse`. Una diferencia de veredicto con esa entrada es una frontera del parser de ese shim, no de los SDK; los mutadores de bundles no añaden marcas de orden de bytes.
- **Conjuntos.** Cada informe y cada hallazgo nuevo registra `sdks`. Un hallazgo sin conjunto, como todo fichero `/2` y `/3` escrito antes de que existiera five, es four y se reproduce exactamente con los cuatro shims. Un replay usa siempre el conjunto del propio hallazgo; un `--sdks` explícito que nombra otro conjunto se rechaza (salida 3), igual que un conjunto cuyos resultados no son exactamente sus SDK. Ninguna omisión reduce el conjunto en silencio.

<a id="mandate-chains"></a>

## Cadenas de mandatos

`run-mandates.mjs` envía la misma cadena de mandatos DCP-09 firmada a los verificadores de cadenas de TypeScript, Python, Go y Rust, mediante el contrato `/4` del kit externo (`verify_mandate_chain`) y sus cuatro wrappers, ejecutados por el runner de procesos del kit (formato `dcp-mandatefuzz/1`). WASM no exporta ninguna función de cadenas de mandatos; esa frontera la documenta y la prueba el kit (`tools/conformance/README.md`), no se sondea aquí.

```bash
node tools/difffuzz/run-mandates.mjs --iterations 120 --seed 1 --report /tmp/mandates.json
node tools/difffuzz/run-mandates.mjs --replay tools/difffuzz/findings/mandates/<file>.json
node tools/difffuzz/run-mandates.mjs --transport-probe --report /tmp/mandates-transport.json
node --test tools/difffuzz/mandate-fuzz.test.mjs  # self-tests of the harness (no SDK)
```

- **Firma.** El arnés firma las cadenas sin ningún SDK: tweetnacl y `@noble/post-quantum` sobre `context || 0x00 || dcp-jcs-v1(mandate without its signature fields)`, `pq_over_classical`, ML-DSA-65 con `extraEntropy: false` (comprobado determinista con la biblioteca instalada). Las claves son TEST-ONLY, derivadas de etiquetas fijas: un humano y un agente por mandato de la cadena más profunda, más un intruso. Antes de ejecutar, el arnés verifica todas las firmas de `mandate_chain_vectors.json` con su propia construcción del mensaje. Su canonizador de enteros exactos (hasta 20 dígitos) es un límite de este firmante, no una regla de `dcp-jcs-v1`.
- **Casos.** 73 variantes en 11 familias: roles y contextos, enlaces, profundidad, atenuación, números crudos, dominios, tiempo, validez de las claves firmantes, nivel mínimo, revocación y codificación JSON. La profundidad cuenta aristas (0 a 2). Cada ejecución hace primero el barrido de cobertura (cada variante en cada profundidad a la que se aplica, una vez: 167 casos) y después `--iterations` mutantes aleatorios. La cobertura está garantizada, no es probabilística; una ejecución cuyo barrido no terminó nunca aprueba.
- **Categorías de firma.** Un cambio semántico se vuelve a firmar con el firmante y el contexto normativos, de modo que una firma incorrecta nunca oculta la regla ejercitada. Los firmantes o contextos deliberadamente erróneos y las firmas obsoletas son categorías aparte, cada una comprobada tal como se construyó.
- **Expectativas.** Solo donde decide DCP-09 §3.5.2 (con su aclaración del 05/11/2026), el perfil de canonicalización o RFC 8259; en otro caso, el caso es una observación. La atribución es `isolated`, `masked_by_signature` (un valor que no se puede firmar, como `0.5`) o `representation_dependent` (2^53 y más: firmado exactamente, pero que cada parser reproduzca los bytes firmados depende de su representación numérica). Una observación o una atribución limitada nunca ocultan un desacuerdo o un fallo; el informe cuenta la evidencia de regla aparte del acuerdo sin expectativa y del acuerdo con atribución limitada.
- **Controles.** Cada lote lleva el control positivo y el de firma obsoleta de cada base. Un mutante cuenta solo si los controles de su profundidad aprobaron en el mismo lote.
- **Límites.** Están acotados los casos y bytes por lote, los bytes por caso, la salida, los plazos (el de compilación se comprueba antes de cada paso), los reintentos, los hallazgos escritos y los pasos de minimización. Los hallazgos por encima de `--max-findings` se cuentan, pero no se escriben ni se conservan, y la ejecución sigue fallando. Los IDs de lote no cambian durante el aislamiento.
- **Parada.** La ejecución se detiene tras el lote que da el primer hallazgo o fallo, que se conserva para revisión, y lo indica.
- **Minimización.** Solo para mutantes semánticos re-firmados: cada candidato se vuelve a firmar, se comprueba con primitivas, mantiene las cuatro decisiones y se ejecuta con un control positivo que aprueba. Nunca para firmas deliberadas u obsoletas; es mínima solo para esa búsqueda y ese presupuesto.
- **Replay.** Un hallazgo registra su entrada, su control positivo y cualquier entrada minimizada, cada una ligada por un hash sobre los bytes de la cadena, los bytes de las claves, los IDs revocados y el reloj, con sus cuatro resultados y la procedencia de la compilación. El replay lo comprueba todo primero (base64 canónico, UTF-8 fatal que conserva una marca de orden de bytes, reloj RFC 3339, decisiones y clases derivadas de nuevo), ejecuta cada entrada por separado, exige la línea base exacta registrada del control e informa de las diferencias de procedencia.
- **Wrappers.** TypeScript y Python se ejecutan desde el checkout; Go y Rust se compilan en el directorio de la ejecución, o se dan con `--go-wrapper` y `--rust-wrapper` y se registran solo por contenido. Códigos de salida: 0 sin hallazgos, con todos los controles aprobados y el barrido completo; 1 en otro caso; 2 uso; 3 infraestructura.

**Sonda de transporte.** El contrato `/4` no lleva cada entrada a todos los SDK: cada wrapper lee primero la cadena como JSON UTF-8 y sale con 2 ante lo que no puede leer. `--transport-probe` envía por separado a cada wrapper un control firmado, un token `NaN`, una marca de orden de bytes inicial y el literal `1e400`, y registra qué hizo cada componente. Medido el 05/11/2026: todos los wrappers rechazan `NaN` y la marca de orden de bytes; los SDK de TypeScript y Python reciben `1e400` y rechazan la cadena, mientras que los wrappers de Go y Rust lo rechazan. Es una observación con límites declarados, nunca un resultado de conformidad; un rechazo del wrapper nunca cuenta como rechazo del SDK, y las campañas nunca envían estas entradas.

## CI

`.github/workflows/difffuzz.yml` ejecuta las autopruebas de ambos arneses y las pruebas acotadas de diagnóstico con los cinco shims; después, en cada pull request, 300 iteraciones con cuatro SDK, 60 con cinco y el barrido de mandatos con 120 mutantes aleatorios; cada noche, 3000, 1000 y 600. Acepta `iterations` y `seed` mediante `workflow_dispatch`. Si falla el job, se suben los hallazgos y los informes como artefacto `difffuzz-findings`.
