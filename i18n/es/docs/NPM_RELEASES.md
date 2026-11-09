<a id="published-npm-packages"></a>

# Paquetes publicados en npm

> Traducción informativa de [la versión en inglés](../../../docs/NPM_RELEASES.md), actualizada el 09/11/2026. Si difieren, prevalece la versión en inglés.

Verificado el 05/11/2026: `@dcp-ai/sdk` 2.3.0 y `@dcp-ai/wasm` 2.1.3 están publicados con la etiqueta `latest`; los otros once paquetes de la tabla no cambian ([qué cambió](#what-changed-on-05112026)). El 28/10/2026 se publicaron `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1 y `@dcp-ai/cli` 2.1.1 con la etiqueta `latest`. Las versiones de los paquetes son independientes de la versión del formato/especificación DCP y de las etiquetas del repositorio.

El 26/10/2026 se publicaron 13 versiones con la etiqueta `latest`: `@dcp-ai/sdk` 2.2.0, `@dcp-ai/wasm` 2.1.0, `@dcp-ai/cli` 2.1.0 y los diez paquetes que siguen en la tabla. Su integridad en el registro coincidió con los tarballs probados y una instalación nueva desde npm pasó 383 comprobaciones.

| Paquete | Versión |
|---|---|
| [`@dcp-ai/sdk`](https://www.npmjs.com/package/@dcp-ai/sdk) | 2.3.0 |
| [`@dcp-ai/wasm`](https://www.npmjs.com/package/@dcp-ai/wasm) | 2.1.3 |
| [`@dcp-ai/cli`](https://www.npmjs.com/package/@dcp-ai/cli) | 2.1.1 |
| [`@dcp-ai/anthropic-mcp`](https://www.npmjs.com/package/@dcp-ai/anthropic-mcp) | 2.1.0 |
| [`@dcp-ai/autogen`](https://www.npmjs.com/package/@dcp-ai/autogen) | 2.0.1 |
| [`@dcp-ai/express`](https://www.npmjs.com/package/@dcp-ai/express) | 2.1.0 |
| [`@dcp-ai/google-a2a`](https://www.npmjs.com/package/@dcp-ai/google-a2a) | 2.1.0 |
| [`@dcp-ai/openclaw`](https://www.npmjs.com/package/@dcp-ai/openclaw) | 2.1.0 |
| [`@dcp-ai/w3c-did`](https://www.npmjs.com/package/@dcp-ai/w3c-did) | 2.0.1 |
| [`@dcp-ai/create-crewai`](https://www.npmjs.com/package/@dcp-ai/create-crewai) | 2.0.1 |
| [`@dcp-ai/create-express`](https://www.npmjs.com/package/@dcp-ai/create-express) | 2.0.1 |
| [`@dcp-ai/create-langchain`](https://www.npmjs.com/package/@dcp-ai/create-langchain) | 2.0.1 |
| [`@dcp-ai/create-openai`](https://www.npmjs.com/package/@dcp-ai/create-openai) | 2.0.1 |

<a id="what-changed-on-28102026"></a>

## Qué cambió el 28/10/2026

`@dcp-ai/sdk` 2.2.1 y `@dcp-ai/wasm` 2.1.1 verifican los campos secundarios SHA3-256 opcionales de [VERIFICATION.md V2-11](../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) cuando están presentes: los ausentes no se exigen, así que un bundle verificado puede no tener una cadena secundaria completa, y un campo presente que sea `null`, no sea una cadena o sea incoherente se rechaza. `@dcp-ai/cli` 2.1.1 requiere `@dcp-ai/sdk` `^2.2.1`, y `--version` informa `2.1.1`. No cambian las API, los campos de resultado, `dcp-jcs-v1`, las API experimentales opt-in de `dcp-jcs-v2` ni el tratamiento de `hash_alg`. Los adaptadores publicados `@dcp-ai/express`, `@dcp-ai/openclaw`, `@dcp-ai/anthropic-mcp` y `@dcp-ai/google-a2a` 2.1.0 no se volvieron a publicar: dependen de `@dcp-ai/sdk` `^2.2.0` y obtienen las comprobaciones secundarias cuando tu lockfile resuelve `@dcp-ai/sdk` 2.2.1 o posterior.

Los tres tarballs del registro son idénticos byte a byte a los artefactos revisados, con integridad `sha512` coincidente. Un consumidor nuevo que instala desde npm, sin sustituciones locales, pasó 411 veredictos secundarios SHA3-256 y 87 controles, 340 comprobaciones de regresión y 80 comprobaciones de la CLI (`--version` 2.1.1); el paquete `@dcp-ai/wasm` del registro pasó 167 comprobaciones en un navegador real.

<a id="install-the-published-versions"></a>

## Instalar las versiones publicadas

```bash
npm install @dcp-ai/sdk@^2.3.0
npm install @dcp-ai/wasm@^2.1.3
npm install @dcp-ai/express@^2.1.0 express
npx --package=@dcp-ai/cli@2.1.1 dcp-ai --help
```

Cada publicación npm cubre solo npm. No publica un paquete Python en PyPI, un crate Rust en crates.io, una etiqueta de módulo Go ni una imagen de contenedor. Revisa el estado de publicación de cada SDK antes de usar ejemplos del código fuente en esos ecosistemas. La raíz del repositorio sigue usando un SDK local para probar el código del checkout; es una decisión de desarrollo, no una limitación de disponibilidad en npm.

Desde la 2.2.0, `@dcp-ai/sdk` incluye confianza en el principal, `strict-v1`, las correcciones del verificador y las API experimentales del candidato. `@dcp-ai/express` y `@dcp-ai/openclaw` 2.1.0 incluyen la verificación corregida de firmas V2 y los controles de admisión documentados. Sus versiones 2.0.0 siguen afectadas; véase [SECURITY.md](../../../SECURITY.md). Publicar los paquetes no convierte un bundle verificado en confiable ni autoriza una acción.

En `@dcp-ai/sdk` 2.2.0 y posteriores y en `@dcp-ai/wasm` 2.1.0 y posteriores, `dcp-jcs-v2` sigue siendo experimental, no normativo y opt-in. `dcp-jcs-v1` sigue siendo el único predeterminado normativo. Los generadores y auxiliares de integración conservan las limitaciones de sus README; publicarlos no convierte las demostraciones en verificadores de producción.

<a id="what-changed-on-05112026"></a>

## Qué cambió el 05/11/2026

`@dcp-ai/sdk` 2.3.0 y `@dcp-ai/wasm` 2.1.3 se publicaron el 05/11/2026 a partir de los tarballs probados antes de la publicación. Sustituyen al candidato `@dcp-ai/wasm` 2.1.2 del 30/10/2026 de abajo, que nunca se publicó.

`@dcp-ai/sdk` 2.3.0, frente a 2.2.1:

- **Validación de esquemas V2-2 (cambio de aceptación).** `verifySignedBundleV2`, la API combinada de admisión y el verificador candidato experimental validan el sobre del bundle firmado y los cuatro payloads contra `schemas/v2` antes de cualquier comprobación de hash, clave o firma. Los bundles inválidos por esquema que antes se aceptaban, como miembros desconocidos en objetos cerrados o tiempos de sesión `null` en el manifiesto, ahora devuelven `verified: false` con diagnósticos `schema: <pointer> <keyword>`.
- **Mandatos.** `verifyMandateValidity` aplica un único contrato y acepta un `now` opcional; una fecha ausente o mal formada, que antes se aceptaba, es inválida. `verifyMandateChain` lee todos los instantes de la misma manera y rechaza un mandato raíz que repite un dominio.
- **`VerificationCache`.** Nuevas opciones de activación explícita `context` y `agentIds`. Las opciones inválidas lanzan una excepción, `set` y `get` copian los resultados, una entrada caduca exactamente al cumplirse su TTL en el reloj monotónico, e `invalidateByAgent` ahora elimina entradas.

`@dcp-ai/wasm` 2.1.3, frente a 2.1.1:

- **`dualMerkleRoot` sigue V2-11 (cambio de aceptación).** Esta función y la exportación directa `wasm_dual_merkle_root` calculan la raíz Merkle dual con la reducción de [VERIFICATION.md V2-11](../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) que ya usaba `verifyBundle` (digests crudos de 32 bytes, con el último nodo duplicado en una capa impar). 2.1.1 y anteriores hashean el texto hex y suben sin cambios un último nodo impar, así que sus raíces de dos o más hojas difieren. Una hoja que no es un digest hex de 32 bytes es ahora un error, y las raíces se devuelven en minúsculas.
- **Validación de esquemas V2-2 (cambio de aceptación).** `verifyBundle` y `wasm_verify_signed_bundle_v2` validan el sobre y los cuatro payloads contra `schemas/v2` antes de cualquier comprobación de hash, clave o firma.
- **No se añade ninguna API de JavaScript.** El WebAssembly procede del código fuente de Rust `dcp-ai` 2.13.0, también publicado el 05/11/2026 (véase [Rust](../../../docs/RUST_RELEASE.md)).

Los dos paquetes mantienen el formato de transmisión, las firmas, los perfiles, `dcp-jcs-v1` como valor predeterminado normativo y las API experimentales de activación explícita `dcp-jcs-v2`, y ambos incluyen el `LICENSE` Apache-2.0. El README de cada tarball publicado es el que se preparó antes de la publicación: dice «prepared, not published», y en el README de WASM la fila de `dualMerkleRoot` de la tabla de operaciones de hash todavía dice «Prepared for 2.1.2». Los tarballs publicados no pueden cambiar; esta página y los README del repositorio describen las versiones publicadas.

Los tarballs del registro de `@dcp-ai/sdk` 2.3.0 y `@dcp-ai/wasm` 2.1.3 son idénticos byte a byte a los artefactos probados, con la misma integridad `sha512`. Un consumidor nuevo que los instaló desde npm, sin overrides, superó el kit de conformidad externo (697 casos en siete catálogos para el SDK, 460 en los cinco catálogos que admite `@dcp-ai/wasm`), y el paquete WASM servido desde esa instalación superó 14 comprobaciones en un navegador.

<a id="migrating-dualmerkleroot-results"></a>

### Migrar resultados de `dualMerkleRoot`

La corrección cambia las raíces que calcula la función, no la evidencia que ya tienes:

- **Conserva la evidencia histórica tal como está.** Las raíces calculadas con `@dcp-ai/wasm` 2.1.1 o anteriores, y cualquier bundle, firma, anclaje o entrada de registro que las lleve, se quedan como se registraron. No las recalcules con 2.1.3 ni sustituyas los valores almacenados para que coincidan: eso reescribe evidencia firmada o anclada e invalida sus firmas.
- **Registra qué versión calculó cada raíz.** Una raíz de dos o más hojas de 2.1.1 o anteriores no es la raíz V2-11 de las mismas hojas. Para comprobarla, recalcúlala con la versión que la produjo, o calcula la raíz V2-11 junto a ella y conserva los dos valores.
- **Las raíces nuevas** salen de 2.1.3 o de los otros SDK, que ya siguen V2-11. La reducción Merkle que usa la verificación de bundles no cambia; `verifyBundle` ya usaba V2-11. Las nuevas comprobaciones de esquema V2-2 descritas arriba sí cambian la aceptación.

<a id="cli-and-adapters"></a>

### CLI y adaptadores

`@dcp-ai/cli` y los adaptadores npm no reciben versión nueva. Sus rangos publicados (`^2.2.1` para la CLI, `^2.2.0` para los adaptadores) aceptan `@dcp-ai/sdk` 2.3.0. Se comprobaron dos veces: antes de la publicación, instalados desde npm con `@dcp-ai/sdk` resuelto al candidato mediante un override; después de la publicación, instalados desde npm sin ningún override, cuando sus propios rangos resolvieron un único `@dcp-ai/sdk` 2.3.0 del registro, con la integridad probada. Las dos veces:

- **Comprobados funcionalmente:** `@dcp-ai/cli` 2.1.1 (`--version`, un bundle V2 válido y uno inválido por esquema, que rechaza la propia comprobación de esquema de la CLI antes de que se ejecute el SDK), y `@dcp-ai/express` y `@dcp-ai/openclaw` 2.1.0 (comprobaciones de regresión de sus correcciones de admisión y verificación).
- **Comprobados solo en la instalación:** `@dcp-ai/anthropic-mcp` y `@dcp-ai/google-a2a` (un único `@dcp-ai/sdk` 2.3.0 resuelto, el rango aceptado y la importación de su punto de entrada), y los paquetes que no dependen del SDK (su punto de entrada se analiza sin errores). Esto no son pruebas de integración.

<a id="prepared-not-published-dcp-aiwasm-212"></a>

## Preparada, no publicada: `@dcp-ai/wasm` 2.1.2

`@dcp-ai/wasm` 2.1.2 está preparada en el repositorio desde el 30/10/2026, pero no publicada en npm. En el momento de la preparación, la tabla y los comandos de instalación seguían en las versiones del registro de entonces; los actuales están arriba.

Corrige `dualMerkleRoot` y la exportación cruda `wasm_dual_merkle_root`: ahora calculan la raíz Merkle dual con la reducción de [VERIFICATION.md V2-11](../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) que ya usaba `verifyBundle` (digests crudos de 32 bytes; en una capa impar se duplica el último nodo). La 2.1.1 y anteriores hashean el texto hex y suben sin cambios el último nodo impar, así que sus raíces de dos o más hojas difieren de V2-11. Las hojas malformadas, que la 2.1.1 y anteriores aceptaban, son ahora un error: cada hoja debe ser un digest hex de 32 bytes. El hex en mayúsculas se acepta y la raíz se devuelve en minúsculas. Un arreglo vacío da el mismo error que antes (`dualMerkleRoot` lanza una excepción) y el resultado conserva sus dos campos, `sha256` y `sha3_256`.

`verifyBundle`, las demás API, `dcp-jcs-v1` y las API experimentales opt-in `dcp-jcs-v2` no cambian, y no se añade ninguna API JavaScript. El tarball ya no contiene los README traducidos, que ahora están en el árbol `i18n/` del repositorio. El WebAssembly procede de Rust `dcp-ai` 2.12.0, también preparado y sin publicar (véase [Rust](../../../docs/RUST_RELEASE.md)).

> **Nota (05/11/2026).** Los párrafos anteriores se escribieron el 30/10/2026 para la 2.1.2 preparada, que nunca se publicó. Desde #116 (02/11/2026), `verifyBundle` en `main` ejecuta la validación de esquemas V2-2 en el núcleo Rust que envuelve; la 2.1.2 no contiene ese cambio, y la 2.1.3 de arriba sí. La 2.1.3 sustituye a la 2.1.2, y los manifiestos de `main` llevan 2.1.3. Los textos y tablas que nombran 2.1.2, incluida la fila de `dualMerkleRoot` del README de WASM, son históricos. Véase el [expediente de auditoría](../../../docs/conformance/AUDIT_DOSSIER.md#artifacts).

<a id="prepared-not-published-dcp-aisdk-240-dcp-aiwasm-220-and-dcp-aicli-220"></a>

## Preparadas, no publicadas: `@dcp-ai/sdk` 2.4.0, `@dcp-ai/wasm` 2.2.0 y `@dcp-ai/cli` 2.2.0

Preparadas el 08/11/2026 y no publicadas; las versiones de arriba siguen siendo las del registro hasta que cada paquete se publique y se compruebe.

- **`@dcp-ai/sdk` 2.4.0:** admisión delegada, admisión desde bytes y acuse de mandato, de activación explícita; el cambio de aceptación Ed25519 P-ED-1 ([registro de cambios](../../../CHANGELOG.md#unreleased)).
- **`@dcp-ai/wasm` 2.2.0:** errores distinguidos de los valores (`canonicalize`, `hashObject`, `deriveKid`), P-ED-1 en el proveedor de Rust y un binario compilado sin las rutas locales de quien compila; sin API de admisión ni de cadenas de mandatos.
- **`@dcp-ai/cli` 2.2.0:** P-ED-1 en `dcp-ai verify`, `@dcp-ai/sdk` `^2.4.0`, `LICENSE` en el paquete y la versión leída de `package.json`; véase [la guía de la CLI](../cli/README.md).
- Los adaptadores no reciben versión nueva; sus rangos `^2.2.0` resuelven `@dcp-ai/sdk` 2.4.0 en una instalación nueva, y con él P-ED-1.

<a id="related-releases"></a>

## Publicaciones relacionadas

Las versiones actuales en cada registro están en [Versiones publicadas](../../../docs/README.md#published-versions). Otras notas de publicación: [Python 2.10.2](../../../docs/PYTHON_RELEASE.md), [Go v2.13.0](../../../docs/GO_RELEASE.md) y [Rust 2.13.0](../../../docs/RUST_RELEASE.md).
