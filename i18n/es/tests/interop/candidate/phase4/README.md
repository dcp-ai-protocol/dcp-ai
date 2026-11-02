<sub>[English](../../../../../../tests/interop/candidate/phase4/README.md) · [中文](../../../../../zh-CN/tests/interop/candidate/phase4/README.md) · **Español** · [日本語](../../../../../ja/tests/interop/candidate/phase4/README.md) · [Português](../../../../../pt-BR/tests/interop/candidate/phase4/README.md)</sub>

<a id="phase-4-matrix-candidate-producers--consumers"></a>
<a id="phase-4-matrix-candidate-producers-consumers"></a>

# Matriz de la fase 4: productores × consumidores del candidato

> Traducción informativa de [la versión en inglés](../../../../../../tests/interop/candidate/phase4/README.md), actualizada el 02/11/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Experimental e inactiva. Estas pruebas son evidencia para
[el §18 del README del candidato](../../../../../../docs/proposals/canonicalization-candidate/README.md#18-experimental-sdk-producers-phase-4).
No activan `dcp-jcs-v2` ni cambian ningún valor predeterminado.

<a id="files"></a>

## Archivos

| Archivo | Propósito |
|---|---|
| [`run.mjs`](../../../../../../tests/interop/candidate/phase4/run.mjs) | El ejecutor: la matriz, `--cost` y `--self-test` |
| [`phase4-specs.json`](../../../../../../tests/interop/candidate/phase4/phase4-specs.json) | Las 12 especificaciones, los 16 negativos y las expectativas |
| `adapters/ts.mjs`, `adapters/wasm.mjs`, `adapters/py_adapter.py`, `adapters/common.mjs` | Los adaptadores de TypeScript, WASM y Python |
| `sdks/go/dcp/v2/experimental_candidate_phase4_matrix_test.go` | El adaptador de Go, una prueba que solo se ejecuta bajo el ejecutor |
| `sdks/rust/tests/experimental_candidate_phase4_matrix.rs` | El adaptador de Rust, una prueba que solo se ejecuta bajo el ejecutor |

<a id="what-a-run-does"></a>

## Qué hace una ejecución

1. El adaptador de TypeScript escribe las entradas de la ejecución:
   - claves sintéticas nuevas;
   - las piezas de entrada de cada especificación como texto JSON, los mismos bytes para todos los productores.
2. Cada productor firma cada especificación en los modos que esta indica (bytes y value para `S01` a `S10`, solo
   bytes para `S11`, solo value para `S12`) con su API pública de activación explícita. También
   deriva los ID de clave y los escribe para compararlos.
3. Cada productor monta el anillo: `S01` a partir de los artefactos que firmó el productor siguiente (ts, py, go, rust,
   wasm, ts).
4. El ejecutor escribe 16 negativos a nivel de bytes de la salida recién generada de cada productor.
5. Cada consumidor lo verifica todo con el verificador de la fase 3. Para cada elemento informa de la ruta, la
   clase, el verificador al que entró, el veredicto y las llamadas que observó a su decodificador histórico.

El veredicto es todo o nada. Espera:

- exactamente 975 resultados (115 unidades × 5 consumidores, y 16 × 5 × 5 negativos a nivel de bytes): 525 positivos y 450
  negativos, los 400 a nivel de bytes y los 50 resultados de `S09` que V2-2 rechaza (más abajo). Antes de V2-2 todas las
  unidades eran positivas: 575 y 400;
- todos los pasos, y cada resultado recién generado en esta ejecución;
- el mismo `manifest_hash` de todos los productores para cada especificación;
- la misma unidad de todos los productores, salvo los valores de las firmas ML-DSA, que se enmascaran solo en sus
  posiciones conocidas;
- los mismos ID de clave de todos los SDK;
- que la ejecución termine antes del plazo (`--deadline`, 1800 s por defecto). Al llegar al plazo se mata todo el grupo de procesos
  del paso: cada paso se inicia separado en su propio grupo de procesos POSIX, así que esto no está garantizado en
  Windows.

<a id="s09-under-v2-2"></a>

### `S09` bajo V2-2

V2-2 es la validación de esquema del verificador de cada SDK. En la ruta del candidato se ejecuta después del parser y de la
política de perfiles, y antes de que el verificador compruebe los hashes de los payloads y las firmas. Cierra la entrada de
auditoría, el checkpoint, el sobre `SignedPayload` y su `composite_sig`. `S09` pone en cada uno un miembro que el productor no conoce, así
que sus 50 resultados (5 productores × 2 modos × 5 consumidores) se rechazan en la ruta del candidato. La especificación y sus
bytes no cambian; la expectativa está en el ejecutor (`V2_2_CLOSED_MEMBERS` en `run.mjs`):

- ruta `candidate`, entrada en el verificador `dcp-jcs-v2`, `verified` falso, sin clase y sin llamadas al decodificador;
- estos cuatro diagnósticos, en este orden, que devuelven todos los SDK:
  - `schema: /bundle/audit_entries/1 additionalProperties x_entry_ext`
  - `schema: /bundle/intent additionalProperties x_artifact_ext`
  - `schema: /bundle/intent/composite_sig additionalProperties x_sig_ext`
  - `schema: /bundle/pq_checkpoints/0 additionalProperties x_checkpoint_ext`

  Los adaptadores registran solo los tres primeros errores de un resultado, así que la matriz compara exactamente esos tres.
  Las pruebas de los productores (generación de bundles) de cada SDK afirman los cuatro;
- cada rechazo cuenta solo cuando el mismo consumidor verifica la unidad `S04` (el checkpoint sin esos miembros) del mismo
  productor y modo.

El miembro que `S09` añade al target del intent es abierto y no genera ningún diagnóstico. La ejecución falla si algún resultado
de `S09` se acepta o se rechaza de otra forma, o si se rechaza cualquier otro positivo.

<a id="running-it"></a>

## Cómo ejecutarla

Compila primero: `sdks/typescript` (`npm run build`) y `sdks/wasm` (`npm run build:wasm` y `npm run build:ts`).
Python necesita las dependencias del SDK; Go y Cargo se usan tal como estén instalados. Desde la raíz de un checkout:

```bash
node tests/interop/candidate/phase4/run.mjs --self-test
DCP_PHASE4_PYTHON=python3 node tests/interop/candidate/phase4/run.mjs --deadline 900
DCP_PHASE4_PYTHON=python3 node tests/interop/candidate/phase4/run.mjs --cost
```

Cada ejecución escribe un directorio nuevo bajo el directorio temporal del sistema, o bajo `--out <dir>`. El directorio
contiene las claves, las salidas, los resultados, los registros y `summary.json` (o `cost-summary.json`). Es privado para quien
lo ejecuta: las claves son sintéticas, pero nada de lo que contiene está pensado para publicarse. El código de salida 0 significa que todas las comprobaciones
pasaron, 1 que algo falló, 2 una configuración inválida (un `--deadline` que no es un número positivo).

`--cost` mide la puerta 10 sobre un par equivalente por plataforma. Ambos lados usan las mismas claves, cargas útiles, sesión
y entradas de auditoría, y esto se comprueba en las salidas. Cada operación se ejecuta 20 veces tras 3 de calentamiento, con como
máximo 60 s por plataforma. Las compilaciones de Go y Rust se cronometran aparte, y Rust se mide con el perfil release.
Los límites de estas cifras están en el §18.3 del README del candidato.
