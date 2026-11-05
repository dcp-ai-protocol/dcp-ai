<sub>[English](../../../../tests/nist-kat/README.md) · **Español** · [Português](../../../pt-BR/tests/nist-kat/README.md) · [日本語](../../../ja/tests/nist-kat/README.md) · [中文](../../../zh-CN/tests/nist-kat/README.md)</sub>

<a id="nist-kat-known-answer-test-compliance"></a>

# Conformidad NIST KAT (pruebas de respuesta conocida)

> Traducción informativa de [la versión en inglés](../../../../tests/nist-kat/README.md), actualizada el 05/11/2026. Si hay diferencias, prevalece el original inglés. Los identificadores y los bloques de código, incluidos los comentarios, se conservan sin traducir.

Este directorio contiene vectores de respuesta conocida y pruebas de propiedades que utilizan los proveedores criptográficos de DCP-AI. Superar estas pruebas acredita el comportamiento cubierto, no la conformidad completa del algoritmo ni la validación NIST de un módulo criptográfico; consulta [conformidad NIST y alcance](../../../../docs/NIST_CONFORMITY.md).

<a id="structure"></a>

## Estructura

```
nist-kat/
  ed25519/
    vectors.json    -- RFC 8032 deterministic test vectors
  ml-dsa-65/
    vectors.json    -- FIPS 204 property test configuration
    acvp_sigver_tg3.json                  -- NIST ACVP sigVer test group 3 (ML-DSA-65, external, pure)
    wycheproof_mldsa_65_verify_test.json  -- C2SP Wycheproof ML-DSA-65 verification vectors
  ml-kem-768/
    vectors.json    -- FIPS 203 NIST ACVP decapsulation and key-check vectors
  slh-dsa-192f/
    vectors.json    -- FIPS 205 NIST ACVP signature-verification vectors
```

## Ed25519

Ed25519 (RFC 8032) utiliza firma determinista. `vectors.json` contiene vectores de prueba exactos de la sección 7.1 de RFC 8032. Todos los SDK DEBEN producir firmas idénticas para la clave secreta y el mensaje indicados.

## ML-DSA-65

La firma ML-DSA-65 (FIPS 204) es hedged (aleatorizada) en los proveedores TypeScript y Rust, y determinista en el proveedor Go; ambas variantes son válidas y se verifican de la misma manera. Reproducir KAT de firma requiere controlar la aleatoriedad de la firma, que cada implementación expone de forma distinta, así que la firma se cubre con estas comprobaciones de propiedades; la verificación no necesita ese control y la cubren los [vectores de verificación](#ml-dsa-65-verification-vectors) de más abajo. Las comprobaciones de propiedades cubren:

1. **Conformidad de tamaños** - clave pública (1952 B), firma (3309 B)
2. **Ciclo completo** - firmar y después verificar tiene éxito
3. **Rechazo de otra clave** - la verificación con una clave distinta falla
4. **Verificación entre SDK** - las firmas del SDK TypeScript se verifican en todos los demás SDK
5. **kid determinista** - la derivación del kid es reproducible entre SDK

<a id="ml-dsa-65-verification-vectors"></a>
<a id="verification-vectors"></a>

### Vectores de verificación

Dos fuentes independientes de casos de verificación ML-DSA-65 pasan por el proveedor real de cada SDK:

| Archivo | Origen | Fijado en | SHA-256 |
|---|---|---|---|
| `acvp_sigver_tg3.json` | NIST ACVP-Server `gen-val/json-files/ML-DSA-sigVer-FIPS204/internalProjection.json`, grupo de pruebas 3 (ML-DSA-65, interfaz externa, modo puro, 15 casos) | commit `a7f283cdc87d2d6dd93c1bac59e5622c5f9f8324` | archivo de origen `47cdd6314c7f746d02421ffcba89d4dbc7bb875ac49e07a029fdfc26fba55437`; este archivo `bacf4ad8e55db0594d8bf2878ca3bd3cb80cfa680aaf05ca8e1788d896f63eb8` |
| `wycheproof_mldsa_65_verify_test.json` | C2SP Wycheproof `testvectors_v1/mldsa_65_verify_test.json` (210 casos), Apache-2.0; no es una fuente NIST | commit `20b256949ea8f21a11375619b1825027ca0668bd` | `1ca235f61928421a173a171780beb00264ae9155dc33c52a11e1766cc7979034` (el archivo es una copia byte a byte) |

`acvp_sigver_tg3.json` contiene el grupo de pruebas copiado sin cambios, con un objeto `_source` que indica la ruta, el commit y el SHA-256 del archivo de origen y el aviso de NIST que lo acompaña. Se fija un commit y no una etiqueta, porque las etiquetas pueden moverse. Los valores se copian literalmente: nunca los edites para que coincidan con un SDK.

Todos los proveedores de los SDK verifican con el contexto vacío de FIPS 204 (DCP pone su separación de dominio en el mensaje; consulta el [§3 de conformidad NIST](../../../../docs/NIST_CONFORMITY.md)), así que solo pasan por ellos los casos con contexto vacío:

- **Se ejecutan 204 casos, 77 válidos y 127 inválidos.** NIST tc39, el único caso del grupo de pruebas 3 con contexto vacío (inválido), y los 203 casos de Wycheproof sin contexto o con contexto vacío (77 válidos, 126 inválidos).
- **Excluidos, y comprobados por ID:** NIST tc31 a tc45 salvo tc39 (contextos no vacíos, incluidos los tres casos válidos tc33, tc43 y tc44), y Wycheproof tc3, tc4, tc5 y tc153 a tc156 (contextos no vacíos). No se usan los grupos de prehash ni de interfaz interna.
- **Veredictos:** un caso válido debe devolver `true`. Un caso inválido debe devolver `false`, salvo en Go y Rust, donde el proveedor devuelve un error para una clave o una firma de longitud incorrecta: ese error solo cuenta en esos casos (Go: Wycheproof tc69, tc70, tc158 y tc159; Rust: esos y tc6, tc7 y tc157) y solo con el error de longitud exacto del proveedor. Cualquier otro error o pánico hace fallar la prueba.

Cada SDK tiene tres pruebas: una comprueba el SHA-256 de ambos archivos, los conteos y los ID excluidos; otra comprueba que el proveedor es el del SDK; y la prueba de veredictos ejecuta los casos y falla si no se ejecutaron exactamente 204. El destino WASM es el proveedor Rust compilado a `wasm32-unknown-unknown` y ejecutado con `wasm-bindgen-test` (`sdks/rust/tests/wasm_mldsa65_vectors.rs` en Node, `wasm_mldsa65_vectors_browser.rs` en un navegador), con los archivos incrustados al compilar; comparte la implementación de Rust y no es una quinta biblioteca. El paquete npm `@dcp-ai/wasm` no expone una verificación ML-DSA en bruto, así que estos vectores no pasan por sus exports.

Límites: superar estos casos no es una validación NIST (CAVP ni CMVP) de ninguna biblioteca ni módulo. Los contextos no vacíos, ML-DSA con prehash, la interfaz interna y la firma no están cubiertos por vectores. Los nombres de los flags de Wycheproof y de las razones de ACVP se conservan tal como figuran en origen; no afirman qué condición de FIPS 204 ejercita cada caso.

## ML-KEM-768

La desencapsulación ML-KEM-768 (FIPS 203) es determinista, por lo que los casos `(dk, c) -> k` de NIST ACVP (`ML-KEM-encapDecap-FIPS203`) son KAT auténticos para cualquier implementación, incluido el rechazo implícito de un texto cifrado modificado. El archivo también contiene las comprobaciones de entrada de FIPS 203: deben rechazarse una clave de encapsulación con coeficientes >= q y una clave de desencapsulación con un `H(ek)` incorrecto.

## SLH-DSA-192f

La firma SLH-DSA-SHA2-192f (FIPS 205) es aleatorizada, así que los vectores son casos de verificación de firmas de NIST ACVP (`SLH-DSA-sigVer-FIPS205`, interfaz externa, modo puro). El caso válido solo se verifica cuando se aplica el prefijo `0x00 || len(ctx) || ctx` de FIPS 205, que SPHINCS+ anterior al estándar omite. DCP firma con un contexto vacío; estos casos llevan uno, así que las pruebas lo pasan explícitamente.

Ambos archivos registran la versión de ACVP-Server y el SHA-256 del archivo de origen. Los valores se copian literalmente: nunca los edites para que coincidan con un SDK.

<a id="phase-1-gate"></a>

## Criterio de aprobación de la fase 1

El trabajo de pruebas de cada SDK en CI ejecuta sus pruebas KAT: TypeScript `src/__tests__/nist-kat.test.ts`, Python `tests/test_nist_kat.py`, Go `dcp/nist_kat_test.go` (dentro de `go test ./...`) y Rust `tests/nist_kat.rs`. El trabajo WASM ejecuta `sdks/rust/tests/wasm_mldsa65_vectors.rs` en Node con `wasm-pack test` y falla si sus tres pruebas no pasan. Un KAT fallido hace fallar ese trabajo.
