<sub>[English](README.md) · [中文](README.zh-CN.md) · **Español** · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="differential-fuzzer-for-the-v2-bundle-verifiers"></a>

# Fuzzer diferencial para los verificadores de bundles V2

> Traducción informativa de [la versión en inglés](README.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

`run.mjs` pasa el mismo bundle V2 firmado y mutado a los cuatro verificadores de los SDK
(`verifySignedBundleV2` en TypeScript, `verify_signed_bundle_v2` en Python,
`VerifySignedBundleV2WithPolicy` en Go, `verify_signed_bundle_v2_with_policy` en
Rust) y trata cualquier desacuerdo en el veredicto `valid`, cualquier fallo y cualquier
tiempo agotado como un hallazgo. La ronda de seguridad que cerró la v2.10.0 consistió casi por completo en
desacuerdos entre los cuatro verificadores; esta herramienta es la forma de encontrarlos
antes de una versión.

<a id="setup"></a>

## Preparación

Cada SDK se ejecuta desde este checkout, nunca desde un paquete publicado:

```bash
(cd sdks/typescript && npm install && npm run build) # shims/ts imports sdks/typescript/dist
pip install -e sdks/python                            # dependencies of shims/py (pynacl, pqcrypto>=1.0)
```

Go (la versión de `sdks/go/go.mod`) y una toolchain estable de Rust deben estar en el
`PATH`; el driver compila él mismo `shims/go` (un módulo que sustituye con `replace` el SDK por
`../../../../sdks/go`) y `shims/rust` (un crate con una dependencia de ruta a
`../../../../sdks/rust`).

<a id="usage"></a>

## Uso

```bash
node tools/difffuzz/run.mjs                       # 200 iterations, seed 1
node tools/difffuzz/run.mjs --iterations 2000 --seed 7
```

| Opción           | Predeterminado                  | Significado                                                    |
| ---------------- | ------------------------------- | -------------------------------------------------------------- |
| `--iterations N` | `200`                           | mutantes que generar                                           |
| `--seed S`       | `1`                             | semilla del PRNG; la misma semilla y los mismos archivos de semillas dan los mismos mutantes |
| `--modes a,b`    | `default,hybrid_required`       | políticas de verificador bajo las que se ejecuta cada mutante  |
| `--timeout MS`   | `30000`                         | tiempo máximo por veredicto; superarlo es un hallazgo          |
| `--python PATH`  | `$DIFFFUZZ_PYTHON` or `python3` | intérprete con el SDK de Python instalado                      |
| `--out DIR`      | `tools/difffuzz/findings`       | dónde se escriben los hallazgos                                |

El código de salida es 1 cuando hay al menos un hallazgo. El resumen final
informa de iteraciones, veredictos, acuerdos, hallazgos y la mezcla de mutadores.

<a id="policies"></a>

### Políticas

`default` es la política de verificador predeterminada de cada SDK (`DEFAULT_VERIFIER_POLICY`,
`DefaultVerifierPolicy()`, `VerifierPolicy::default()`), que asigna el
nivel de riesgo del pasaporte a `classical_only` / `hybrid_preferred` /
`hybrid_required`. Cualquier otro nombre de modo se aplica a `default_mode` y a
todos los niveles de riesgo, como hacen las pruebas de interoperabilidad de los SDK, así que `hybrid_required` ejecuta cada
bundle bajo el modo estricto.

<a id="seeds"></a>

### Semillas

Todos los bundles V2 firmados que hay en `tests/interop/v2/bundle_vectors.json`
(`signed_bundle`, `must_accept_bundles`, `classical_only_routine_bundle`,
`must_reject_bundles`), en `tests/interop/v2/cross_sdk_vectors.json` y en
`tests/conformance/examples/*.json` (vacío hasta que se incorporen allí
ejemplos V2 firmados). Cada semilla se verifica primero sin mutar bajo todos los modos (la
línea base); un desacuerdo en la línea base también es un hallazgo. La mayoría de las semillas son
bundles `must_reject`, que todos los SDK ya rechazan, así que al menos la mitad de
las iteraciones parten de una semilla cuyo veredicto de línea base bajo el primer modo
es válido; la línea de resumen informa del reparto.

<a id="mutators"></a>

### Mutadores

Cada iteración aplica una mutación (70 %) o dos (30 %) en una posición aleatoria:
borrar una clave, fijar un valor a `null`, cambiar el tipo de un valor, intercambiar dos valores
hermanos, cambiar un carácter de una cadena base64, sustituir una cadena enumerada
por una clave del prototipo (`constructor`, `__proto__`, `toString`, `valueOf`, ...),
renombrar una clave a una clave del prototipo, añadir una clave desconocida, duplicar un artefacto (o
su `payload`, `payload_hash` o `composite_sig`) en otra posición, reescribir un
número como `1.0`, `1e2`, `-0`, `0.1`, `2^64`, `1e400`, ..., reescribir una marca de tiempo RFC 3339
con otro desfase, malformada o muy en el pasado o el futuro, una
cadena sobredimensionada (64 KiB o 1 MiB), un valor anidado 100 niveles y una reordenación recursiva
de claves, que nunca debe cambiar un veredicto (se compara con el veredicto
de línea base de la semilla). Los números que JavaScript no puede representar se insertan tal cual en el
texto serializado, así que todos los analizadores ven los mismos bytes.

<a id="findings"></a>

## Hallazgos

Cada hallazgo se escribe en `findings/<seed>-<iteration>.json` (Git ignora el directorio
salvo `.gitkeep`) con el nombre de la semilla, la ruta de la mutación,
el texto exacto del mutante y los cuatro veredictos por modo que discreparon:

```json
{
  "seed": "1",
  "iteration": 42,
  "seed_name": "bundle_vectors.signed_bundle",
  "mutations": [{ "mutator": "set_null", "detail": "bundle.audit_entries" }],
  "verdicts": {
    "default": {
      "ts": { "valid": false, "errors": ["..."] },
      "py": { "crash": "exit 1: ..." },
      "go": { "valid": false, "errors": ["..."] },
      "rust": { "valid": false, "errors": ["..."] }
    }
  },
  "mutant_json": "{...}"
}
```

Un hallazgo es una pista, todavía no un bug. Primero reprodúcelo: un desacuerdo o fallo
que se reproduce con el mutante exacto es una divergencia que resolver; un tiempo agotado, un
fallo de la toolchain o de la máquina, o un resultado que no se reproduce es
un problema de infraestructura mientras no se demuestre lo contrario. Minimiza el reproductor y
decide qué SDK tiene razón a partir de los requisitos normativos
(`spec/VERIFICATION.md`, el perfil de canonicalización) y de los fixtures compartidos
(`tests/interop/v2/`). Cuando no zanjan el caso, es una cuestión abierta
para la especificación, no una corrección que elegir: regístrala en lugar de adoptar
por defecto el veredicto que falla cerrado. Corrige el SDK equivocado empezando por una prueba unitaria en
ese SDK, y nunca debilites un verificador para alcanzar el acuerdo. El mutante exacto puede
reproducirse a través de un shim:

```bash
node -e 'console.log(require("./tools/difffuzz/findings/1-42.json").mutant_json)' | node tools/difffuzz/shims/ts/verify.mjs
```

## Shims

Cada shim de `shims/` lee un documento JSON por stdin y escribe una línea JSON
por stdout, `{"valid": bool, "errors": [string]}`, con código de salida 0 para un
veredicto y cualquier otro para un fallo. Con `--loop` lee un documento compacto
por línea y responde a cada uno, que es como los ejecuta el driver (un
proceso de larga duración por SDK y modo, que se reinicia tras un fallo o un tiempo agotado). Un
primer argumento posicional selecciona el modo, como se describe en Políticas. Un
documento que el analizador JSON del SDK rechaza es un veredicto `valid: false`.

## CI

`.github/workflows/difffuzz.yml` ejecuta 300 iteraciones en cada pull request,
3000 cada noche, y acepta las entradas `iterations` y `seed` en `workflow_dispatch`.
Los hallazgos se suben como el artefacto `difffuzz-findings` cuando el job falla.
