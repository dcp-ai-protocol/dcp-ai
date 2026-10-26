<sub>[English](README.md) · [中文](README.zh-CN.md) · **Español** · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="dcp-ai-conformance-kit"></a>

# Kit de conformidad de DCP-AI

> Traducción informativa de [la versión en inglés](README.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

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
