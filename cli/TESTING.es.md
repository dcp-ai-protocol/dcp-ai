<sub>[English](TESTING.md) · [中文](TESTING.zh-CN.md) · **Español** · [日本語](TESTING.ja.md) · [Português](TESTING.pt-BR.md)</sub>

<a id="testing-dcp-aicli"></a>

# Pruebas de `@dcp-ai/cli`

> Traducción informativa de [la versión en inglés](TESTING.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

El CLI 2.1.0 publicado requiere `@dcp-ai/sdk` `^2.2.0`, disponible en npm. Estas pruebas del repositorio usan deliberadamente el SDK compilado desde el mismo checkout para cubrir los cambios de código antes de una publicación futura.

```bash
cd sdks/typescript && npm install && npm run build
cd ../../cli
npm install --no-save --package-lock=false --ignore-scripts --install-links ../sdks/typescript
npm test                        # both suites
npm run test:negative-control   # must print "failed as required"
```

`--install-links` copia el SDK compilado en `cli/node_modules` en lugar de enlazarlo, y las demás opciones dejan intactos `package.json` y el lockfile y no ejecutan scripts de instalación. La CI hace lo mismo en el job `cli` de `.github/workflows/ci.yml`, en Node 20 y 22. Ese job no instala la raíz del repositorio, así que nada se resuelve a través de un `node_modules` de la raíz.

## Suites

- `__tests__/verify-s-range.test.mjs`: verificación V1, el rango S de Ed25519 (RFC 8032 §5.1.7), los códigos de salida y el rechazo del formato V2 histórico.
- `__tests__/verify-v2-normative.test.mjs`: bundles V2 con el verificador normativo (los vectores entre SDK, el sobre prenormativo, la fijación de clave de `.dcp`), las copias de los esquemas en `lib/schemas/v2` y los archivos empaquetados ejecutados por sí solos. Sus procesos hijos se ejecutan con `Date.now` fijo, así que el resultado no depende de la fecha.

Cada caso ejecuta `bin/dcp-ai.js` en un proceso hijo, en un directorio temporal nuevo sin ningún `.dcp/` por encima.

<a id="negative-control"></a>

## Control negativo

Con `DCP_NEGATIVE_CONTROL=1`, cada suite invierte un caso positivo. `__tests__/negative-control.mjs` ejecuta ambas suites de ese modo. Solo pasa cuando la ejecución sale con 1 y fallan exactamente esos dos casos, cada uno en una aserción, y todas las demás pruebas pasan, ninguna cancelada ni omitida. Cualquier otro resultado lo hace fallar, incluida una suite que no se carga.

El verificador de referencia y el playground tienen sus propias pruebas del rango S (`tools/crypto-s-range.test.mjs`, `tools/playground-s-range.test.mjs`), que ejecuta el job `conformance`.
