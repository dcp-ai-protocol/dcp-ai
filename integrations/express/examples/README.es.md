<sub>[English](README.md) · [中文](README.zh-CN.md) · **Español** · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="examples"></a>

# Ejemplos

> Traducción informativa de [la versión en inglés](README.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Los dos se ejecutan sin conexión con los vectores de admisión compartidos (`tests/interop/v2/admission_vectors.json`):
claves y bundles sintéticos, el conjunto de confianza del operador y el perfil `strict-v1`, y un reloj fijado en la hora
de los vectores.

Desde la raíz del repositorio, compila primero el SDK del workspace en una subshell para que el comando siguiente siga empezando en esa raíz:

```bash
(cd sdks/typescript && npm install && npm run build)
cd integrations/express && npm install && npm run build
node examples/strict-v1-body.mjs      # the recommended transport, checked over real HTTP
node examples/strict-v1.mjs           # the shortest strict-v1 setup
```

<a id="strict-v1-bodymjs-the-bundle-in-the-json-body"></a>

## `strict-v1-body.mjs`: el bundle en el cuerpo JSON

Envía peticiones HTTP reales a un servidor en `127.0.0.1`, comprueba cada resultado, cierra el servidor y sale con 1 si
algún resultado no es el esperado. `--report FILE` escribe los resultados como JSON.

| Petición | Resultado esperado |
|---|---|
| Bundle híbrido de confianza en el `signed_bundle` del cuerpo | `200`; la ruta se ejecuta con `req.dcpAgent.admission`, `actionAuthorized: false` |
| Bundle de un principal desconocido | `403`, `TRUST_PRINCIPAL_UNKNOWN`; la ruta no se ejecuta |
| Bundle firmado para otro verificador | `403`, `PROFILE_AUDIENCE_MISMATCH` y `VERIFICATION_FAILED`; la ruta no se ejecuta |
| Cuerpo por encima del presupuesto | `413` del analizador del cuerpo: el middleware, la verificación, la confianza y la revocación no llegan a ejecutarse |
| El mismo bundle híbrido en `X-DCP-Bundle` | `431` de Node antes de que Express vea la petición (solo cuando el bundle supera `http.maxHeaderSize`) |

Unos contadores registran hasta dónde llegó cada petición (Express, después del analizador del cuerpo, la fuente de
confianza, la fuente de revocación, la ruta), así que se muestra que el `413` se detiene antes de la verificación, no
solo antes de la ruta.

Un bundle admitido es **evidencia**: auténtico y firmado para un principal en el que confías. No es un permiso para
ejecutar la acción; `actionAuthorized` siempre es `false`, y tu propia autorización decide qué puede hacer la petición.

<a id="why-the-body"></a>

### Por qué el cuerpo

Un bundle V2 híbrido lleva claves y firmas Ed25519 y ML-DSA-65: el bundle base de los vectores ocupa 32.996 bytes
(33.014 en `{"signed_bundle": …}`). El límite por defecto de Node para todas las cabeceras de una petición juntas es de
16 KiB (`http.maxHeaderSize`), así que el bundle en `X-DCP-Bundle` se rechaza con `431` antes de que se ejecute ningún
middleware. Los proxies y los balanceadores de carga tienen sus propios límites de cabeceras. La cabecera sigue
admitida para los bundles que caben en todos los límites del camino; este ejemplo no aumenta `maxHeaderSize`, y tú
tampoco deberías hacerlo para que quepa un bundle híbrido.

<a id="the-body-budget"></a>

### El presupuesto del cuerpo

`BODY_BUDGET_BYTES` (64 KiB) es una elección de este ejemplo, no un límite del protocolo: unas dos veces su bundle más
grande. Define el tuyo para tu despliegue:

- Mide el bundle más grande que aceptes. Crece con el rastro de auditoría (cada entrada del bundle de los vectores ocupa
  unos 530 bytes) y con los checkpoints PQ, y los demás campos del cuerpo de tu petición se suman.
- Pasa el presupuesto al analizador del cuerpo antes de `dcpVerify` (`express.json({ limit })`), y mantén el mismo
  límite, o uno mayor, en todos los proxies delante del servidor.
- Todo lo que supere el presupuesto recibe `413` antes de la verificación. Un presupuesto demasiado pequeño rechaza
  evidencia válida; uno demasiado grande permite a un cliente hacer que el servidor analice cuerpos grandes.
