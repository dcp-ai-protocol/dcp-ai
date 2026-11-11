<sub>[English](../../../cli/TESTING.md) · [中文](../../zh-CN/cli/TESTING.md) · **Español** · [日本語](../../ja/cli/TESTING.md) · [Português](../../pt-BR/cli/TESTING.md)</sub>

<a id="testing-dcp-aicli"></a>

# Pruebas de `@dcp-ai/cli`

> Traducción informativa de [la versión en inglés](../../../cli/TESTING.md), actualizada el 10/11/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

La CLI 2.2.0 requiere `@dcp-ai/sdk` `^2.4.0`. Estas pruebas del repositorio usan deliberadamente el SDK compilado desde el mismo checkout para cubrir los cambios de código antes de una publicación.

```bash
cd sdks/typescript && npm install && npm run build
cd ../../cli
npm install --no-save --package-lock=false --ignore-scripts --install-links ../sdks/typescript
npm test                        # the four suites
npm run test:negative-control   # must print "failed as required"
```

`--install-links` copia el SDK compilado en `cli/node_modules` en lugar de enlazarlo, y las demás opciones dejan intactos `package.json` y el lockfile y no ejecutan scripts de instalación. La CI hace lo mismo en el job `cli` de `.github/workflows/ci.yml`, en Node 20 y 22. Ese job no instala la raíz del repositorio, así que nada se resuelve a través de un `node_modules` de la raíz.

## Suites

- `__tests__/verify-s-range.test.mjs`: verificación V1, el rango S de Ed25519 (RFC 8032 §5.1.7), los códigos de salida y el rechazo del formato V2 histórico.
- `__tests__/verify-ped1.test.mjs`: verificación V1 bajo Ed25519 P-ED-1 contra el corpus congelado `tests/interop/v2/ed25519_ped1_vectors.json`.
- `__tests__/version.test.mjs`: `--version` imprime la versión de `package.json` desde otro directorio de trabajo.
- `__tests__/verify-v2-normative.test.mjs`: bundles V2 con el verificador normativo (los vectores entre SDK, el sobre prenormativo, la fijación de clave de `.dcp`), las copias de los esquemas en `lib/schemas/v2` y los archivos empaquetados ejecutados por sí solos. Sus procesos hijos se ejecutan con `Date.now` fijo, así que el resultado no depende de la fecha.

Cada caso ejecuta `bin/dcp-ai.js` en un proceso hijo, en un directorio temporal nuevo sin ningún `.dcp/` por encima.

<a id="negative-control"></a>

## Control negativo

Con `DCP_NEGATIVE_CONTROL=1`, cada suite invierte un caso positivo. `__tests__/negative-control.mjs` ejecuta las cuatro suites de ese modo. Solo pasa cuando la ejecución sale con 1 y fallan exactamente esos cuatro casos, cada uno en una aserción, y todas las demás pruebas pasan, ninguna cancelada ni omitida. Cualquier otro resultado lo hace fallar, incluida una suite que no se carga.

El verificador de referencia y el playground tienen sus propias pruebas del rango S (`tools/crypto-s-range.test.mjs`, `tools/playground-s-range.test.mjs`), que ejecuta el job `conformance`.

<a id="against-an-installed-package"></a>

## Contra un paquete instalado

`DCP_CLI_ROOT` dirige las mismas cuatro suites y el control negativo a un `@dcp-ai/cli` instalado, en lugar del `cli/` de este checkout:

```bash
cd cli
DCP_CLI_ROOT="/path/to/consumer/node_modules/@dcp-ai/cli" npm test
DCP_CLI_ROOT="/path/to/consumer/node_modules/@dcp-ai/cli" npm run test:negative-control
```

El binario, `lib/` y las dependencias salen entonces de ese paquete tal como se instaló: `__tests__/cli-under-test.mjs` los resuelve desde él y rechaza una ruta o una dependencia dentro de este checkout. Los fixtures y las expectativas siguen aquí. Dos casos se adaptan: la copia independiente toma las dependencias del directorio `node_modules` en el que se instaló el paquete, y la prueba de empaquetado comprueba que los dos archivos están en el paquete instalado en lugar de consultar `npm pack --dry-run`, que describe un árbol de código fuente. Sin la variable no cambia nada. La [validación de publicaciones](../../../tools/release-validation/README.md) ejecuta las suites de este modo contra el paquete publicado.
