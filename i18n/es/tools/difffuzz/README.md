<sub>[English](../../../../tools/difffuzz/README.md) · [中文](../../../zh-CN/tools/difffuzz/README.md) · **Español** · [日本語](../../../ja/tools/difffuzz/README.md) · [Português](../../../pt-BR/tools/difffuzz/README.md)</sub>

<a id="differential-fuzzer-for-the-v2-bundle-verifiers"></a>

# Fuzzer diferencial para los verificadores de bundles V2

> Traducción informativa de [la versión en inglés](../../../../tools/difffuzz/README.md), actualizada el 31/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

`run.mjs` envía el mismo bundle V2 firmado y mutado a los cuatro verificadores SDK (`verifySignedBundleV2` en TypeScript, `verify_signed_bundle_v2` en Python, `VerifySignedBundleV2At` en Go y `verify_signed_bundle_v2_at` en Rust), con una política explícita y un mismo instante de verificación. Son hallazgos un desacuerdo, un veredicto contrario a lo declarado por los vectores compartidos, un reordenamiento de claves que cambie el veredicto y cualquier error, caída o tiempo agotado. La ronda de seguridad cerrada en v2.10.0 consistió casi por completo en desacuerdos entre los cuatro verificadores; esta herramienta permite encontrarlos antes de una publicación. El controlador es `fuzz.mjs`, compartido por `run.mjs` y las autopruebas.

<a id="setup"></a>

## Preparación

Cada SDK se ejecuta desde este checkout, nunca desde un paquete publicado:

```bash
(cd sdks/typescript && npm install && npm run build) # shims/ts imports sdks/typescript/dist
pip install -e sdks/python                            # dependencies of shims/py (pynacl, pqcrypto>=1.0)
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
```

| Opción | Predeterminado | Significado |
| --- | --- | --- |
| `--iterations N` | `200` | mutantes a generar (0 a 1.000.000) |
| `--seed S` | `1` | semilla del PRNG; con la misma semilla y fixtures se obtienen los mismos mutantes |
| `--modes a,b` | `default,hybrid_required` | políticas de cada semilla y mutante (véase Políticas) |
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

Se valida cada valor antes de compilar: un argumento desconocido, repetido, ausente o fuera de rango produce salida 2. Códigos de salida: 0 sin hallazgos ni lotes fallidos y con línea base completa; 1 al menos un hallazgo, un lote fallido o una línea base incompleta; 2 uso; 3 fallo de infraestructura o del ejecutor (compilación fallida, entradas que cambian durante la ejecución, shim que no arranca o responde fuera del protocolo o como no compatible, en lote o solo, presupuesto de reintentos agotado o ninguna semilla declarada válida en el primer modo cuando hay iteraciones). Los comandos siempre son exactamente los cuatro shims.

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

Cada hallazgo se escribe en `findings/<seed>-<iteration>-<mode>-<n>.json` (directorio ignorado por Git salvo `.gitkeep`): clases, semilla, modo, política explícita y `now_ms`, mutaciones, resultado de cada SDK y bytes exactos de entrada (`input_b64`, `input_sha256`). Un hallazgo es una pista, no todavía un defecto. Reprodúcelo primero con `--replay`: los bytes registrados y la entrada minimizada, si existe, se ejecutan en los cuatro shims con el `now_ms` y la política propios del hallazgo, en un lote junto a su control registrado. Este contiene los bytes originales de la semilla sin mutar, hash, política, expectativa y resultados de línea base; nunca se sustituye por el fixture actual del mismo nombre. Primero se valida el hallazgo con tipos completos: clase de hallazgo, conjunto de clases conocidas igual al derivado de sus resultados, cuatro resultados tipados, hashes y control. La compilación, controlador, fixtures y semilla actuales se comparan con los registrados y cada diferencia se informa como diferencia de procedencia. Salidas de replay: 0 se reproducen las decisiones y la línea base del control; 1 no se reproducen; 3 el hallazgo, el control o la infraestructura no permiten evaluar.

Después se minimizan desacuerdos, errores o caídas de un mutante dentro de un presupuesto (un hallazgo de expectativa ya es una semilla sin mutar), solo con control positivo: la semilla sin mutar aprobó su línea base en ese modo, verificada `true` por los cuatro SDK. Una semilla correctamente rechazada no sirve de control. Se reducen las diferencias manteniendo la decisión de cada SDK y la línea base de la semilla, ejecutada junto al candidato. Los tokens crudos como `1e400` se conservan como bytes; nunca se vuelve a parsear el texto. El resultado es mínimo para esa búsqueda y presupuesto, no globalmente; no se minimizan hallazgos de orden de claves ni tiempos agotados.

Decide qué SDK es correcto a partir de los requisitos normativos (`spec/VERIFICATION.md` y perfil de canonicalización) y los fixtures compartidos (`tests/interop/v2/`). Cuando no resuelven el caso, es una pregunta abierta de especificación: regístrala en vez de adoptar por defecto el rechazo preventivo. Corrige el SDK equivocado empezando por una prueba unitaria en ese SDK y nunca debilites un verificador para alcanzar acuerdo.

## Shims

`--batch` es el protocolo del controlador (`dcp-difffuzz/2`): un proceso finito por lote, mediante `runProcess` de `tools/conformance/external.js`, con un plazo, grupo de procesos propio, SIGTERM seguido de SIGKILL, salida limitada y limpieza. La solicitud en stdin es `{protocol, run_id, nonce, now_ms, cases: [{id, policy, bundle_b64}]}`, con IDs aleatorios y sin expectativa ni nombre de semilla. La respuesta en stdout es un documento JSON `{protocol, run_id, nonce, results}` con un resultado por caso y después salida 0. Una solicitud malformada sale con 2. El shim Go escribe `errors` nil como `[]`; el de Rust decodifica base64 solo con `std`.

Sin `--batch`, cada shim conserva su forma anterior para uso manual: un documento en stdin, o uno por línea con `--loop`, `{"valid": bool, "errors": [string]}` por documento, modo opcional como primer argumento, la política predeterminada propia de cada SDK y el reloj del sistema.

## CI

`.github/workflows/difffuzz.yml` ejecuta las autopruebas y después 300 iteraciones en cada pull request, 3000 cada noche, y acepta `iterations` y `seed` mediante `workflow_dispatch`. Si falla el job, se suben los hallazgos y el informe como artefacto `difffuzz-findings`.
