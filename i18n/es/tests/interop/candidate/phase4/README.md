<sub>[English](../../../../../../tests/interop/candidate/phase4/README.md) · [中文](../../../../../zh-CN/tests/interop/candidate/phase4/README.md) · **Español** · [日本語](../../../../../ja/tests/interop/candidate/phase4/README.md) · [Português](../../../../../pt-BR/tests/interop/candidate/phase4/README.md)</sub>

<a id="phase-4-matrix-candidate-producers--consumers"></a>
<a id="phase-4-matrix-candidate-producers-consumers"></a>

# Matriz de la fase 4: productores × consumidores del candidato

> Traducción informativa de [la versión en inglés](../../../../../../tests/interop/candidate/phase4/README.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

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

- exactamente 975 resultados: 575 positivos (115 unidades × 5 consumidores) y 400 negativos (16 × 5 × 5);
- todos los pasos, y cada resultado recién generado en esta ejecución;
- el mismo `manifest_hash` de todos los productores para cada especificación;
- la misma unidad de todos los productores, salvo los valores de las firmas ML-DSA, que se enmascaran solo en sus
  posiciones conocidas;
- los mismos ID de clave de todos los SDK;
- que la ejecución termine antes del plazo (`--deadline`, 1800 s por defecto). Al llegar al plazo se mata todo el grupo de procesos
  del paso: cada paso se inicia separado en su propio grupo de procesos POSIX, así que esto no está garantizado en
  Windows.

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
