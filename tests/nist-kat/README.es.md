<sub>[English](README.md) · **Español** · [Português](README.pt-BR.md) · [日本語](README.ja.md) · [中文](README.zh-CN.md)</sub>

<a id="nist-kat-known-answer-test-compliance"></a>

# Conformidad NIST KAT (pruebas de respuesta conocida)

> Traducción informativa de [la versión en inglés](README.md), actualizada el 25/10/2026. Si hay diferencias, prevalece el original inglés. Los identificadores y los bloques de código, incluidos los comentarios, se conservan sin traducir.

Este directorio contiene vectores de respuesta conocida y pruebas de propiedades que utilizan los proveedores criptográficos de DCP-AI. Superar estas pruebas acredita el comportamiento cubierto, no la conformidad completa del algoritmo ni la validación NIST de un módulo criptográfico; consulta [conformidad NIST y alcance](../../docs/NIST_CONFORMITY.md).

<a id="structure"></a>

## Estructura

```
nist-kat/
  ed25519/
    vectors.json    -- RFC 8032 deterministic test vectors
  ml-dsa-65/
    vectors.json    -- FIPS 204 property test configuration
  ml-kem-768/
    vectors.json    -- FIPS 203 NIST ACVP decapsulation and key-check vectors
  slh-dsa-192f/
    vectors.json    -- FIPS 205 NIST ACVP signature-verification vectors
```

## Ed25519

Ed25519 (RFC 8032) utiliza firma determinista. `vectors.json` contiene vectores de prueba exactos de la sección 7.1 de RFC 8032. Todos los SDK DEBEN producir firmas idénticas para la clave secreta y el mensaje indicados.

## ML-DSA-65

La firma ML-DSA-65 (FIPS 204) es hedged (aleatorizada) en los proveedores TypeScript y Rust, y determinista en el proveedor Go; ambas variantes son válidas y se verifican de la misma manera. Los vectores KAT directos requieren controlar la semilla, lo que varía entre implementaciones. Estas comprobaciones cubren:

1. **Conformidad de tamaños** - clave pública (1952 B), firma (3309 B)
2. **Ciclo completo** - firmar y después verificar tiene éxito
3. **Rechazo de otra clave** - la verificación con una clave distinta falla
4. **Verificación entre SDK** - las firmas del SDK TypeScript se verifican en todos los demás SDK
5. **kid determinista** - la derivación del kid es reproducible entre SDK

## ML-KEM-768

La desencapsulación ML-KEM-768 (FIPS 203) es determinista, por lo que los casos `(dk, c) -> k` de NIST ACVP (`ML-KEM-encapDecap-FIPS203`) son KAT auténticos para cualquier implementación, incluido el rechazo implícito de un texto cifrado modificado. El archivo también contiene las comprobaciones de entrada de FIPS 203: deben rechazarse una clave de encapsulación con coeficientes >= q y una clave de desencapsulación con un `H(ek)` incorrecto.

## SLH-DSA-192f

La firma SLH-DSA-SHA2-192f (FIPS 205) es aleatorizada, así que los vectores son casos de verificación de firmas de NIST ACVP (`SLH-DSA-sigVer-FIPS205`, interfaz externa, modo puro). El caso válido solo se verifica cuando se aplica el prefijo `0x00 || len(ctx) || ctx` de FIPS 205, que SPHINCS+ anterior al estándar omite. DCP firma con un contexto vacío; estos casos llevan uno, así que las pruebas lo pasan explícitamente.

Ambos archivos registran la versión de ACVP-Server y el SHA-256 del archivo de origen. Los valores se copian literalmente: nunca los edites para que coincidan con un SDK.

<a id="phase-1-gate"></a>

## Criterio de aprobación de la fase 1

El trabajo de pruebas de cada SDK en CI ejecuta sus pruebas KAT: TypeScript `src/__tests__/nist-kat.test.ts`, Python `tests/test_nist_kat.py`, Go `dcp/nist_kat_test.go` (dentro de `go test ./...`) y Rust `tests/nist_kat.rs`. Un KAT fallido hace fallar ese trabajo.
