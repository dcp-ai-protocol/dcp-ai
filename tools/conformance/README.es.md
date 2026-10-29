<sub>[English](README.md) · [中文](README.zh-CN.md) · **Español** · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="dcp-ai-conformance-kit"></a>

# Kit de conformidad de DCP-AI

> Traducción informativa de [la versión en inglés](README.md), actualizada el 29/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

`tools/conformance.js` ejecuta las suites declaradas en [`catalog.json`](catalog.json) contra los fixtures y
vectores del repositorio. El catálogo está versionado (`kit_version`) y fija, para cada suite, los IDs exactos
de los casos que debe producir. El kit solo lee fixtures: no genera claves ni fixtures en el checkout, y no
cambia la canonicalización, las firmas, los perfiles, los esquemas ni los vectores.

<a id="commands"></a>

## Comandos

```bash
npm run conformance                                    # every suite (same as node tools/conformance.js)
node tools/conformance.js --list                       # suites, pinned case counts and inventory
node tools/conformance.js --suite v1.integrity --suite v2.hashes
node tools/conformance.js --report /tmp/conformance.json
node --test tools/conformance/conformance.test.mjs     # runner self-tests (temporary copies only)
```

Las rutas de fixtures, esquemas y catálogo se resuelven desde el script, no desde el directorio actual.
Ejecuta los comandos anteriores desde la raíz del repositorio; desde otro directorio, invoca el script por su
ruta absoluta (`node /path/to/dcp-ai/tools/conformance.js`). `--root <dir>` apunta el kit a otra copia de los
fixtures (las autopruebas lo usan con copias temporales).

<a id="contract"></a>

## Contrato

| Salida | Significado |
|--------|-------------|
| 0 | Todos los casos seleccionados pasaron |
| 1 | Al menos una discrepancia (un valor o veredicto difiere de su expectativa) |
| 2 | Error de uso: argumento desconocido, ID de suite desconocido, duplicado o vacío, `--list` con `--report` |
| 3 | Error de infraestructura: fixture ausente o mal formado, expectativa mal formada, `kind` de configuración desconocido, catálogo ausente o mal formado, excepción, un caso fijado que no se produjo o uno no fijado que se produjo, o ninguna comprobación ejecutada |

- Un caso que falta o sobra es un error, así que quitar un vector de una colección que aún tiene otros no
  puede reducir la cobertura en silencio. Una suite que lanza una excepción falla aunque ya haya producido
  todos los casos fijados.
- Con `--report`, se escribe un marcador `incomplete` antes de la ejecución y se sustituye por el informe
  final; un error de uso o de catálogo también sustituye el archivo. Esto vale para los errores que el kit
  gestiona y una ruta de informe escribible: si Node no arranca o el archivo no se puede escribir, puede quedar
  un archivo anterior, así que quien lo consuma debe comprobar el código de salida y los campos `run.id` y
  `status` del informe en lugar de fiarse de un archivo existente.
- El informe incluye `kit` (nombre, versión, SHA-256 del catálogo), `run` (uuid, marcas de tiempo, raíz,
  versión de Node), `selection`, `status`, `totals` (`cases`, `executed`, `pass`, `fail`, `error`), cada
  suite con su afirmación, límites y casos (`status`, y `kind`: `discrepancy`, `fixture`, `expectation`,
  `exception` o `catalog`), el inventario y los límites globales.

<a id="suites"></a>

## Suites de prueba

| Suite | Casos | Especificación | Esquemas / vectores | Qué prueba un resultado correcto |
|-------|-------|----------------|---------------------|----------------------------------|
| `v1.schema` | 7 | DCP-01, DCP-02, DCP-03, `BUNDLE.md` | `schemas/v1`, `tests/conformance/examples/*.json` | Solo validez de esquema |
| `v1.integrity` | 9 | `VERIFICATION.md` (V1), DCP-03 | `citizenship_bundle.signed.json`, `keys/public_key.txt`, `golden_vectors.json#v1_bundle_verification` | Firma Ed25519, hash del bundle, raíz de Merkle, hash de la intención, hashes de las entradas y cadena `prev_hash` de un fixture, comparados con los valores golden; metadatos de clave coherentes |
| `v2.canonicalization` | 11 | `CANONICALIZATION_PROFILE.md` | `golden_vectors.json#canonicalization`, `#v2_canonicalization`, `interop_vectors.json#canonicalization` | Bytes `dcp-jcs-v1` del canonicalizador de referencia |
| `v2.hashes` | 9 | DCP-AI-v2.0 §2.3, §10.3 | `golden_vectors.json#hash_vectors`, `#dual_hash_vectors` | Valores SHA-256 / SHA3-256, hashes duales y raíces de Merkle duales |
| `v2.signed_bundle` | 10 | `VERIFICATION.md` (V2) | `lib/verify.js`, bundle construido en memoria | Veredictos del verificador de referencia para bundles válidos y alterados; verificado no es admisión |
| `v2.secondary_sha3` | 51 | `VERIFICATION.md` V2-11 y su errata | `secondary_sha3_vectors.json`, `lib/verify.js` | Veredictos del verificador de referencia sobre los campos secundarios SHA3-256 presentes, con un control por caso rechazado; no una cadena secundaria completa |
| `v2.schema` | 4 | DCP-AI-v2.0 | `schemas/v2`, ejemplos `*_v2.json` | Solo validez de esquema |
| `ext.dcp05_09.schema` | 18 | DCP-05 a DCP-09 | `schemas/v2`, ejemplos `<record>_v2.json` | Solo validez de esquema |
| `ext.dcp05_09.wire` | 28 | DCP-05, DCP-08, DCP-09, `V2-WIRE-COMPATIBILITY.md` | `schemas/v2`, registros firmados en memoria, `interop_vectors.json#domain_separation_all_contexts` | Representación, validez de esquema y firma de estos registros como capas separadas; no conformidad funcional |
| `admission.strict_v1` | 117 | `spec/profiles/admission` | `admission_vectors.json` | Resultado de admisión y códigos de error esperados; `action_authorized` siempre es false |

<a id="limits"></a>

## Límites

- Pasar un subconjunto certifica esas comprobaciones sobre estos fixtures y nada más: no una implementación
  completa de DCP, otro SDK ni un despliegue. Las suites de esquema solo prueban validez de esquema; la suite
  de esquemas V2 no hace una implementación V2 sin las suites de canonicalización, hashes y firmas.
- `verified` y `admitted` nunca autorizan una acción.
- Los adaptadores (Express, FastAPI, OpenClaw, el servidor de verificación) no forman parte del kit.
- Puntos del protocolo, según `spec/V2-WIRE-COMPATIBILITY.md`: el campo de caducidad de DCP-09
  (`valid_until`) y los contextos de firma de DCP-05, DCP-08 y DCP-09 están corregidos por erratas y los prueba
  `ext.dcp05_09.wire`. Siguen pendientes de un diseño explícito y versionado, y el kit no los decide: las
  métricas fraccionarias de `vitality_report` de DCP-05 (con `dcp-jcs-v1` solo 0 y 1 son representables), los
  derechos con notación de dominio inverso de DCP-08 §4.3 (rechazados por el enum `right_type`) y los segundos
  firmantes o acuses (DCP-05 §4.4, DCP-09 §3.3 y §6.3). Los ejemplos de DCP-04, DCP-06 y DCP-07 quedan fuera de
  estas erratas.

<a id="inventory"></a>

## Inventario

Aparece en `--list` y en el informe, fuera de los totales: el kit no lo ejecuta, y su presencia no es una
prueba superada. Los vectores de ataque, los casos límite de canonicalización y las demás categorías de
`interop_vectors.json` y los vectores de bundles y mandatos se ejecutan en las suites de prueba de los SDK.
`tests/nist-kat/` contiene vectores de respuesta conocida y pruebas de propiedades, cada uno con su propio
alcance (véase [su README](../../tests/nist-kat/README.es.md)); también se ejecutan en las suites de los SDK. El candidato `dcp-jcs-v2` es experimental, queda fuera de `dcp-jcs-v1` y tiene su propia
suite (`tests/interop/candidate/`).

<a id="external-implementations"></a>

## Implementaciones externas

`tools/conformance-external.js` ejecuta un catálogo aparte, [`external-catalog.json`](external-catalog.json)
(contrato `dcp-ai-conformance-external/1`), contra una implementación que indicas como argv después de `--`. La
implementación puede estar escrita en cualquier lenguaje: lee una petición JSON por stdin y escribe una respuesta
JSON por stdout. El runner necesita Node 20 o posterior y solo usa módulos integrados. El comando, el catálogo y el
informe anteriores no cambian.

```bash
node tools/conformance-external.js --list
node tools/conformance-external.js --report /tmp/external.json -- node tools/conformance/wrappers/ts-sdk.mjs
node tools/conformance-external.js -- /path/to/python -I tools/conformance/wrappers/python_sdk.py
node tools/conformance-external.js --suite external.digest -- ./my-implementation --its-own-flag
node --test tools/conformance/external.test.mjs
DCP_EXTERNAL_PYTHON=/path/to/python DCP_EXTERNAL_REQUIRE_PYTHON=1 node --test tools/conformance/external.test.mjs
```

Sin `DCP_EXTERNAL_PYTHON`, `node --test` omite el wrapper de Python y lo indica; con
`DCP_EXTERNAL_REQUIRE_PYTHON=1`, la falta de intérprete es un fallo. El último comando ejecuta todas las pruebas.

| Suite | Casos | Vectores |
|-------|-------|----------|
| `external.dcp-jcs-v1.canonicalize` | 30 | `golden_vectors.json#canonicalization`, `#v2_canonicalization`; `interop_vectors.json#canonicalization` y sus 19 `edge_cases`, 3 de los cuales deben rechazarse |
| `external.digest` | 8 | `golden_vectors.json#hash_vectors`; `#dual_hash_vectors` raw e intent, SHA-256 y SHA3-256 |

Un intercambio mínimo, el SHA-256 de cero bytes, que puedes ejecutar contra el wrapper de TypeScript:

```bash
printf '%s' '{"contract":"dcp-ai-conformance-external/1","run_id":"00000000-0000-4000-8000-000000000000","nonce":"00000000000000000000000000000000","cases":[{"id":"c1","op":"digest","alg":"sha256","input_b64":""}]}' | node tools/conformance/wrappers/ts-sdk.mjs
```

Una respuesta válida a esa petición (el wrapper añade además `resolved_from` y `runtime`):

```json
{"contract":"dcp-ai-conformance-external/1","run_id":"00000000-0000-4000-8000-000000000000","nonce":"00000000000000000000000000000000","implementation":{"name":"example","version":"0.0.1"},"results":[{"id":"c1","status":"ok","hex":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}]}
```

- **Sobres:** la petición y la respuesta son JSON en UTF-8. La respuesta es exactamente un documento JSON en stdout,
  y el proceso termina con código 0.
- **Petición:** `contract`, `run_id`, `nonce` y `cases`, cada uno con `id`, `op` (`canonicalize` con `profile`
  `dcp-jcs-v1`, o `digest` con `alg` `sha256` o `sha3-256`) e `input_b64`. Los IDs son aleatorios en cada corrida y
  no se envía ninguna expectativa. La entrada de canonicalize es texto JSON: un vector `input_json` exactamente como
  está en el repositorio, y un valor `input` tal como lo escribe `JSON.stringify`.
- **Respuesta:** los mismos `contract`, `run_id` y `nonce`; `implementation` (`name`, `version`, y opcionalmente
  `resolved_from` y `runtime`, todos declarados por la implementación); y `results`, un array con exactamente un
  objeto por caso, cada uno con el `id` de ese caso y un `status`: `ok` con `output_b64` (los bytes canónicos) o
  `hex`, `rejected` con `code` `parse` o `profile`, `error` con `message`, o `unsupported`. No se acepta ningún otro
  campo.
- **Codificaciones:** `input_b64` y `output_b64` son base64 RFC 4648 con el alfabeto estándar, padding y sin saltos
  de línea, en forma canónica; `hex` son exactamente 64 caracteres hexadecimales en minúsculas.
- **Evaluación:** los bytes se comparan exactamente, y un vector que debe rechazarse solo pasa si se rechaza. Un
  resultado `error` o `unsupported`, un resultado mal formado, ausente, duplicado o extra, un `run_id` o `nonce`
  obsoleto, una salida inválida, un código de salida distinto de cero o una señal, un timeout y un stdout de más de
  4 MiB son errores, nunca un pase. Los códigos de salida son los del [contrato](#contract).
- **Proceso:** se arranca sin shell, en su propio grupo de procesos en POSIX. Un único plazo (`--timeout-ms`, 30 000
  por defecto) se mide con un reloj monotónico; después, SIGTERM, SIGKILL 2 s más tarde y una espera acotada de 2 s
  a que se cierren los pipes (si no, `cleanup_incomplete`). stderr se conserva hasta 64 KiB y nunca se interpreta.
- **El catálogo y los fixtures** se validan antes: IDs únicos, punteros existentes, expectativas coherentes con los
  vectores, y cada miembro de cada colección fijado una vez por operación y algoritmo. Un defecto da exit 3. El
  informe registra los hashes del catálogo, de los fixtures y de la petición, y la identidad que declara la
  implementación separada de lo que observa el runner.
- **Informe:** un valor de `--report` ausente, que parezca una opción o repetido es un error de uso (exit 2) y no se
  escribe ningún informe, porque la ruta es ambigua. Como con el comando anterior, también puede quedar un informe
  antiguo si Node no arranca, no se puede escribir el informe o se mata el runner. Comprueba siempre el código de
  salida y, después, el `run.id` y el `status` del informe.
- **Wrappers:** `wrappers/ts-sdk.mjs` (`@dcp-ai/sdk`; `--sdk <path>` es opcional) y `wrappers/python_sdk.py` (el
  `dcp_ai` instalado; ejecútalo con `-I`). Cada uno llama una vez al canonicalizador real y solo informa
  `rejected`/`profile` para el rechazo de números no enteros documentado del SDK. Los SDK no tienen códigos de error
  estables, así que se reconoce por su tipo y su mensaje: si cambian, un rechazo correcto aparece como error, nunca
  como pase. La CI ejecuta los dos wrappers.
- **Límites:** un pase muestra que el argv ejecutado pasa estos 38 casos, a través del parser que usa; no es una
  implementación completa de `dcp-jcs-v1` ni conformidad DCP, y la identidad es declarada por la implementación. No
  es un sandbox: la implementación se ejecuta con tus privilegios y tu entorno, los descendientes que salen del grupo
  de procesos (`setsid`) no se ven, y en Windows solo se mata al hijo directo.

<a id="go-rust-and-wasm-wrappers"></a>

### Wrappers de Go, Rust y WASM

Tres wrappers más ejecutan los mismos 38 casos y el mismo contrato contra el SDK de Go, el SDK de Rust y la
compilación WASM del SDK de Rust, todos de este checkout. `build.mjs` los compila en
`tools/conformance/wrappers/.build/` (ignorado por Git); necesita Go 1.25 o posterior, Cargo y `wasm-pack` con el
target `wasm32-unknown-unknown`. No instala ni publica ningún paquete de DCP ni cambia manifests ni lockfiles
del SDK. Sin `--offline`, Cargo y `wasm-pack` pueden descargar herramientas de compilación y las dependencias
fijadas a sus cachés; `--offline` usa `GOPROXY=off`, Cargo `--offline` y `wasm-pack --mode no-install`, y
necesita esas cachés ya llenas.

```bash
node tools/conformance/wrappers/build.mjs all
node tools/conformance/wrappers/build.mjs --offline go rust wasm
node tools/conformance-external.js -- tools/conformance/wrappers/.build/go-wrapper
node tools/conformance-external.js -- tools/conformance/wrappers/.build/rust-target/debug/dcp-ai-conformance-wrapper
node tools/conformance-external.js -- node tools/conformance/wrappers/wasm.mjs
DCP_EXTERNAL_REQUIRE_NATIVE=1 node --test tools/conformance/external-native.test.mjs
```

- **Compilación:** Go compila con `-mod=readonly` contra el `go.mod` y el `go.sum` del wrapper, cuyas versiones son
  un subconjunto de las del propio SDK; Cargo compila con `--locked`, el wrapper nativo con su `Cargo.lock` (una
  copia del lock del SDK, resuelta sin red, con las mismas versiones fijadas) y el artefacto WASM con el
  `Cargo.lock` del SDK. `--offline` usa solo las cachés locales. No cambia ningún manifest ni lockfile del SDK.
- **Go** (`wrappers/go`): la entrada debe ser UTF-8 (se comprueba primero, porque `encoding/json` reemplazaría los
  bytes inválidos), después `json.Unmarshal` en `interface{}`, como hace el propio test de interop del SDK, y una
  sola llamada a `v2.CanonicalizeV2`; solo su rechazo documentado (`non-integer float at`, `non-finite float at`)
  es `rejected`/`profile`. Digests: `v2.SHA256Hex`, `v2.SHA3256Hex`. La versión se informa como el checkout local.
- **Rust** (`wrappers/rust`): decodificación UTF-8 fatal, `serde_json::from_str` y una sola llamada a
  `dcp_ai::v2::canonicalize::canonicalize_v2`; solo su rechazo documentado (`Non-integer number in V2 canonical form:`, `Non-finite number in V2 canonical form:`, tras prefijos de ruta) es `rejected`/`profile`. Digests:
  `sha256_hex`, `sha3_256_hex`. La versión es `DCP_SDK_VERSION`.
- **WASM** (`wrappers/wasm.mjs`): carga el `.wasm` real que `wasm-pack` compiló desde `sdks/rust` con la feature
  `wasm` (`--target web`) e informa su SHA-256. El texto JSON crudo va a una sola llamada de `wasm_canonicalize_v2`,
  sin `JSON.parse` ni `JSON.stringify` en JavaScript antes de la llamada;
  después, la entrada y la salida solo se inspeccionan para marcar la ambigüedad, sin recalcular bytes. Esa exportación informa los errores dentro del propio
  resultado como `{"error": "…"}`, que una entrada válida también puede producir, así que un resultado
  `{"error": string}` de una sola clave es un `error` ambiguo cuando la entrada es a su vez un objeto raíz cuya única clave es `error`
  (sea cual sea su valor), y en otro caso solo es un rechazo para los mensajes documentados. Las exportaciones de digest reciben
  texto: las 8 entradas de digest son texto, y los bytes que no son UTF-8 son un `error`, nunca se sustituyen.
- **Errores:** en los tres, una petición con un tipo erróneo (por ejemplo `input_b64` numérico o `null`, o `cases`
  que no es un array) es inválida y el wrapper termina con 2; cualquier error distinto del rechazo documentado es `error`. En Rust y WASM, el rechazo documentado de
  números se reconoce en una sola pasada lineal, sin expresiones regulares con backtracking; un mensaje de más de
  1 MiB en UTF-8 es un `error`, nunca un rechazo (el límite se aplica a ese clasificador, no a los errores de
  parseo). Sin `DCP_EXTERNAL_REQUIRE_NATIVE=1`, `node --test` omite lo que no está compilado y lo indica; con ella,
  la falta de una herramienta o de un artefacto es un fallo. La CI compila los tres wrappers desde el checkout y
  ejecuta los 38 casos con cada uno, así que allí los cinco wrappers son obligatorios.
- **Límites:** el wrapper WASM llama a las exportaciones crudas de wasm-bindgen alojadas en Node: no cubre la API
  JavaScript del paquete `@dcp-ai/wasm` (como `DcpClient`) ni un navegador. La clasificación de los rechazos depende del
  texto de los mensajes, porque los SDK no tienen códigos de error estables, y, a través de WASM, una entrada raíz `{"error": …}` de una
  sola clave solo es un error ambiguo cuando la exportación devuelve el sobre `{"error": string}`
  (`{"error":5}` sigue siendo `ok`). Un pase muestra que estos 38 casos pasan con cada wrapper, nada más.

<a id="evidence-catalog-merkle-and-signature-verification"></a>

### Catálogo de evidencia: Merkle y verificación de firmas

`--catalog evidence` selecciona un catálogo opcional, [`external-evidence-catalog.json`](external-evidence-catalog.json)
(contrato `dcp-ai-conformance-external/2`, 241 casos), que se ejecuta contra el mismo tipo de argv. El catálogo
por defecto, el contrato `/1` y sus 38 casos no cambian; el `contract` del catálogo decide cómo se carga y se
juzga. Los cinco wrappers aceptan ambos contratos y responden con el contrato de la petición. Solo se usan
fixtures públicos versionados: no se genera ninguna clave ni se firma nada.

```bash
node tools/conformance-external.js --catalog evidence --list
node tools/conformance-external.js --catalog evidence --report /tmp/evidence-ts.json -- node tools/conformance/wrappers/ts-sdk.mjs --sdk sdks/typescript/dist/index.js
node tools/conformance-external.js --catalog evidence -- /path/to/python -I tools/conformance/wrappers/python_sdk.py
node tools/conformance-external.js --catalog evidence -- tools/conformance/wrappers/.build/go-wrapper
node tools/conformance-external.js --catalog evidence -- tools/conformance/wrappers/.build/rust-target/debug/dcp-ai-conformance-wrapper
node tools/conformance-external.js --catalog evidence -- node tools/conformance/wrappers/wasm.mjs
DCP_EXTERNAL_PYTHON=/path/to/python DCP_EXTERNAL_REQUIRE_PYTHON=1 DCP_EXTERNAL_REQUIRE_NATIVE=1 node --test tools/conformance/external-evidence.test.mjs
```

| Suite | Casos | Vectores |
|-------|-------|----------|
| `external.merkle.dual_root` | 6 | `tests/conformance/v2/merkle_vectors.json`: 1, 2, 3 y 5 hojas y hojas reordenadas (`spec/VERIFICATION.md` V2-11), generadas sin conexión con la biblioteca estándar de Python |
| `external.signature.composite` | 24 | `interop_vectors.json`: firmas compuestas y solo clásicas, sus ataques versionados y alteraciones deterministas de cada positivo |
| `external.v2.bundle_vectors` | 131 | `bundle_vectors.json`: el bundle firmado, sus 38 mutaciones versionadas, 9 bundles aceptados y 79 rechazados construidos aparte, el bundle de rutina solo clásico en 4 modos |
| `external.v2.secondary_sha3` | 80 | `secondary_sha3_vectors.json`: casos aceptados y rechazados y el control versionado de cada caso rechazado |

- **Operaciones:** `dual_merkle_root` recibe `leaves`, un array no vacío de `{sha256, sha3_256}` con cadenas
  hexadecimales de 64 caracteres en minúsculas, y responde `ok` con `sha256` y `sha3_256` (64 hex en minúsculas).
  `composite_verify` recibe `context`, `payload_b64` (los bytes canónicos del payload), `composite_sig` tal como
  está versionada, `classical_public_key_b64` y `pq_public_key_b64` (o `null`), y responde `ok` con `valid` y
  `classical_valid` (booleanos) y `pq_valid` (booleano o `null`). `verify_signed_bundle_v2` recibe `bundle_b64`
  (el JSON del bundle firmado), `policy` (un objeto de política del verificador) y `verification_time` (RFC 3339
  con `Z` o un desfase), y responde `ok` con `verified` (booleano) y `errors` (un array de cadenas). Una petición
  con una forma incorrecta (una hoja vacía o en mayúsculas, una hoja que no es una cadena, una hora sin zona, un
  campo desconocido) hace que el wrapper salga con 2.
- **Juicio:** los casos compuestos comparan solo los campos que el fixture fija; el veredicto de un bundle debe
  coincidir, y un rechazo debe contener el `error_contains` versionado (sin distinguir mayúsculas, sobre los
  errores unidos). `verified: true` con errores es un error `contradictory_result`. `rejected` con `code` `parse`
  falla, porque toda entrada versionada se puede analizar; `error` y `unsupported` nunca son un pase.
- **Controles:** un caso negativo solo cuenta si su control pasó; si no, es `control_failed`, un error. El bundle
  firmado base controla sus 38 mutaciones; el positivo del mismo payload controla sus alteraciones y los ataques
  versionados; un modo válido del bundle solo clásico controla sus modos que rechazan; cada caso secundario
  rechazado tiene su control versionado. Los 79 `must_reject_bundles` no tienen control por caso: solo cuentan si
  la base y los 9 bundles aceptados pasan (un control a nivel de suite, una garantía más débil) y se juzgan por su
  `error_contains` versionado. El informe da para cada caso su `source`, su `input_sha256` y sus `controls`.
- **Firma PQ ausente:** ante una firma `pq_over_classical` sin parte PQ, `composite_verify` de Rust devuelve un
  error y la exportación WASM el error en banda
  `Signature error: pq_over_classical binding requires PQ signature`. Esos dos wrappers lo informan como
  `rejected` con `code` `missing_pq_signature`, solo para ese error exacto y solo cuando la entrada tiene ese binding y `pq: null`. El runner solo lo acepta donde el fixture fija
  únicamente `valid: false` (`stripping_pq_removal`) y su control positivo pasó; el mismo código ante una firma
  válida o ante cualquier otro negativo falla. TypeScript, Python y Go responden a ese caso con booleanos.
- **Las alteraciones del payload** cambian el último carácter del primer valor de cadena del payload canónico, de
  modo que el payload sigue siendo JSON canónico válido (la exportación WASM recibe el JSON del payload) y un error
  del analizador nunca se cuenta como un fallo criptográfico.
- **Hora:** cada caso de bundle envía `verification_time`: 2026-10-22T00:00:00Z, dentro de la ventana de validez
  del bundle base y de cada bundle que debe verificarse (algunos negativos están caducados o aún no son válidos
  en ese instante a propósito), o la hora versionada de los vectores secundarios. TypeScript pasa `{ now }`, Python
  `now_ms`, Go `VerifySignedBundleV2At` y Rust `verify_signed_bundle_v2_at`. La exportación WASM lee `Date.now`,
  así que el wrapper WASM sustituye `Date.now` por ese instante solo durante la llamada síncrona y lo restaura en
  `finally`, también cuando la llamada lanza una excepción; su `runtime` lo indica. Los self-tests muestran que
  cada wrapper rechaza el bundle base en 2020-01-01, lo acepta en 2026-10-22 y lo rechaza en 2100-01-01, y la
  restauración tras una excepción.
- **Merkle a través de WASM:** el wrapper usa el `wasm_dual_merkle_root` compilado desde este checkout, que delega
  en el núcleo de Rust; el helper publicado en `@dcp-ai/wasm` 2.1.1 y anteriores falla los casos multihoja (véase
  el CHANGELOG).
- **Self-tests:** `external-evidence.test.mjs` ejecuta los 241 casos con los cinco wrappers, la prueba del reloj,
  peticiones malformadas y una implementación falsa construida a partir de las respuestas reales del wrapper de
  TypeScript: verificarlo todo, rechazarlo todo, resultados contradictorios, un texto de error incorrecto, una
  reducción Merkle que ignora el orden o que hashea el texto hexadecimal, una base que falla,
  `missing_pq_signature` en su sitio y fuera de él, y errores o `unsupported` en los negativos. Los fixtures y
  catálogos manipulados son errores de infraestructura (salida 3). El tiempo límite por defecto de este catálogo
  es de 300 000 ms (`--timeout-ms`). Con las dos variables `REQUIRE`, un wrapper ausente falla en lugar de
  omitirse; CI ejecuta los cinco.
- **Límites:** un pase muestra que el argv ejecutado pasa estos 241 casos, nada más. La política es
  `default_verifier_policy` con los `verifier_policy_overrides` versionados de cada caso, más los 4 modos del
  bundle solo clásico; no se prueba ninguna otra política. `composite_verify` es una primitiva con el
  binding y las claves dados, y el veredicto de un bundle no es admisión, confianza en el principal ni
  autorización de una acción. `stripping_pq_with_downgrade` se juzga por `classical_valid` y `pq_valid`;
  rechazarlo corresponde a una política `hybrid_required`. Los campos secundarios se comprueban donde están
  presentes, así que un pase no muestra una cadena secundaria completa. A través de WASM, la hora es el reloj del
  host sustituido.
