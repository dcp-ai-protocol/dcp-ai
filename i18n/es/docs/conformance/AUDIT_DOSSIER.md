<sub>[English](../../../../docs/conformance/AUDIT_DOSSIER.md) · [中文](../../../zh-CN/docs/conformance/AUDIT_DOSSIER.md) · **Español** · [日本語](../../../ja/docs/conformance/AUDIT_DOSSIER.md) · [Português](../../../pt-BR/docs/conformance/AUDIT_DOSSIER.md)</sub>

<a id="audit-dossier"></a>

# Expediente de auditoría

> Traducción informativa de [la versión en inglés](../../../../docs/conformance/AUDIT_DOSSIER.md), actualizada el 09/11/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Este es el punto de entrada para una revisión de seguridad independiente de DCP-AI. Indica qué revisar, cómo reproducir la evidencia del repositorio, qué muestra esa evidencia y qué deja fuera. No es una especificación, ni una certificación, ni un informe de auditoría. El repositorio no contiene ningún informe de una auditoría externa independiente, y no certifica trabajos hechos fuera de él.

- Los documentos normativos están en [spec/](../../../../spec/README.md).
- El [mapa de cobertura de seguridad](SECURITY_COVERAGE.md) relaciona cada requisito con sus pruebas.
- La [guía del implementador](IMPLEMENTER_GUIDE.md) explica cómo informar de los resultados.

<a id="review-baseline"></a>

## Base de la revisión

- **Base de código:** el commit `45ac32f07f004e858e11dcc23ff72c3e5c7762b8` de `main`, del 05/11/2026 (#123). Contiene todas las correcciones de [Artefactos](#artifacts) y las aclaraciones de esa fecha al paso V2-10 de [VERIFICATION.md](../../../../spec/VERIFICATION.md) y a [DCP-09](../../../../spec/DCP-09.md) §3.5.2.
- **Commits posteriores:** el arnés diferencial de cadenas de mandatos y la comparación de bundles con cinco SDK (#124) llegaron después de la base, igual que este expediente. Un documento no puede nombrar su propio commit final. Registra el commit exacto que revisas y usa este archivo como guía de ese commit, no como evidencia sobre él.
- **Fuera de la base:** las imágenes de contenedor, los despliegues y la configuración del operador.

<a id="pilot-validation-freeze-mp-06"></a>

## Congelación de validación para pilotos (MP-06)

Esta instantánea posterior se mantiene separada de la base de revisión anterior. **Fuente:** `7dd8293d6f6c3d328fc0ff3906978200e55139db` (PR #138); árbol `de40444aa1fc1bafef6ab7cf3b772664427b43dc`. Es una validación interna para pilotos acotados, no una auditoría externa, un despliegue ni una nueva publicación en registros. `dcp-jcs-v1` y los valores predeterminados existentes se conservan.

El alcance incluye verificación de evidencia híbrida, confianza explícita en el principal, admisión estricta, admisión delegada opt-in y el acuse de mandato separado en TypeScript, Python, Go y Rust. WASM cubre verificación y primitivas mediante su API instalada en navegador; **no** admite cadenas de mandatos, admisión ni activación. Express y FastAPI son adaptadores opcionales. La autorización de acciones, configuración de tenants, frescura de revocación, TLS y custodia de claves siguen siendo responsabilidad de la aplicación u operador. Los [límites operacionales](../OPERATIONAL_LIMITS.md) y el [ensayo opcional](../../../../tools/enterprise-rehearsal/README.md) explican esa separación.

<a id="evidence-and-artifact-identity"></a>

### Evidencia e identidad de los artefactos

El [CI de la revisión congelada](https://github.com/dcp-ai-protocol/dcp-ai/actions/runs/42539293814) aprobó los jobs seleccionados. Los jobs de SDK e integraciones omitidos por filtros de rutas quedan cubiertos por la revisión MP-03 aprobada `df2df0de103777bb9e28cf70cc64d52f8df7d4b4`, con subárboles de producción e insumos pertinentes de compilación y pruebas idénticos. Son ejecuciones reutilizadas, no nuevas. Los artefactos instalados localmente se probaron por separado, incluidos el sdist de Python y el tarball WASM en navegador. Los ocho catálogos públicos pasaron en cada SDK completo; WASM pasó únicamente los seis que soporta. Los controles focalizados de composición, acuse e ingreso desde bytes, las regresiones originales F1–F4 y de confianza en el principal, y la evidencia de proveedores conservan el vínculo con los objetos realmente probados. Se reutiliza el ensayo HTTP MP-05 sin cambios (200/200 pasos).

Los artefactos siguientes son **bytes locales no publicados**, aunque sus versiones internas coincidan con publicaciones existentes. Los de TS, Express y Python proceden de `b3d41bd0`; los 256 archivos fuente de su manifiesto de preparación coinciden con la revisión congelada. Go, Rust y WASM se construyeron desde el export congelado. No sustituirlos por paquetes del registro que tengan el mismo número de versión.

| Artefacto | Versión local | SHA-256 |
|---|---|---|
| `Go module zip` | `v2.13.0` | `a2e113c663b791c3b0908e135f2a1e2433ffea1301b1be2540a2fa3539c6ca41` |
| `Rust .crate` | `2.13.0` | `192d58c182e9c115b5fa7e6af17dd790eaa37a68a4501e4985dc11ae5b157d39` |
| `@dcp-ai/wasm tarball` | `2.1.3` | `501d24d7ae9a2923931edf4e9e8df902f353a87ff911906901f34b33d1ac052d` |
| `@dcp-ai/sdk tarball` | `2.3.0` | `1e4b27bb82c70ab327227f5bb029eb2b01b0cdc643aeec206327bdaf5a94dd9c` |
| `@dcp-ai/express tarball` | `2.1.0` | `bf2b6de539b9e3687ffd272c7015d9ff0a6288fdd65f86ce7662838b50ead969` |
| `Python wheel` | `2.10.2` | `e20473aecf6f75ff6e01db4a9ce12bd33ef59000607b9cba47f197b4b2e8d317` |
| `Python sdist` | `2.10.2` | `ad0e17c7850916777a5df379c6217e16eb1fcc82b2b465b53624c9eb985919fa` |


Go se consumió mediante un proxy local de archivos sin `replace`; Rust mediante una dependencia de ruta al `.crate` extraído; npm y Python mediante paquetes instalados. Go se validó con el toolchain parcheado 1.26.10, sin cambiar el módulo ni las dependencias. Para un piloto, conservar artefactos exactos, inventario de dependencias, comandos e informes: un hash identifica bytes, pero no hace descargables los artefactos temporales. Una reconstrucción exige comprobación y nuevas pruebas; no se estableció la reproducibilidad de bytes de WASM. La reproducción pública parte del [kit de conformidad](../../../../tools/conformance/README.md) y las [instrucciones del ensayo](../../../../tools/enterprise-rehearsal/README.md), con revisión explícita y rutas de paquetes instalados. Esta página resume evidencia interna; no afirma que cada sonda local sea una herramienta de pruebas publicada.

<a id="limits-and-remaining-release-work"></a>

### Límites y trabajo previo a publicación

- El tarball congelado de Express carece de `LICENSE`; incluir la licencia antes de distribuirlo. El binario WASM local contiene una ruta de caché de compilación; remapear rutas y revisar los bytes reconstruidos antes de publicar. Ninguno se ofrece aquí como descarga de una versión publicada.
- La revisión de dependencias es una instantánea fechada, no una garantía. El grafo opcional OTLP de Rust selecciona versiones de `anyhow`/`tokio` con los avisos [RUSTSEC-2026-0190](https://osv.dev/vulnerability/RUSTSEC-2026-0190) y [RUSTSEC-2026-0386](https://osv.dev/vulnerability/RUSTSEC-2026-0386); las compilaciones predeterminada y WASM no seleccionan esos crates. Esta congelación no valida OTLP, que requiere remediación separada de dependencias antes de usarlo.
- Las alertas CodeQL #58/#59 siguen abiertas en una autoprueba de conformidad; el triage encontró interpolación de un hash hexadecimal de un corpus fijo, no una ruta remota de producción demostrada. Dependabot no mostró alertas abiertas. La API de secret scanning no estuvo disponible: es cobertura faltante, no cero hallazgos.
- Se mantienen las exclusiones previas del expediente: contradicciones de especificación sin resolver, extensiones opcionales, infraestructura del operador y entornos sin probar no pasan a estar soportados por esta congelación. Las pruebas finitas no demuestran ausencia de vulnerabilidades.
- Antes de publicar los cambios posteriores a la base, faltan corregir el empaquetado, asignar nuevas versiones, comprobar instalaciones desde registros y obtener autorización explícita de publicación. Imágenes y despliegues requieren validación propia. Integrar documentación no publica paquetes.

> **Nota (09/11/2026).** Los puntos anteriores describen la instantánea de MP-06 y sus artefactos locales, que no cambian. Para las versiones publicadas el 09/11/2026, el remapeo de rutas de WASM, el `LICENSE` de la CLI y los mínimos de OTLP ya están resueltos; véase [Publicación del 09/11/2026](#publication-of-09112026). `@dcp-ai/express` 2.1.0 no se republicó.

<a id="publication-of-09112026"></a>

## Publicación del 09/11/2026

**Fuente:** `main` en `cdb7099b8b6dc2a78b54928250752fd0bbd9c770` ([PR #140](https://github.com/dcp-ai-protocol/dcp-ai/pull/140)), árbol `af69307b663381ce776ad3115f76fe82f225a789`, el árbol del export revisado de los candidatos. El [CI de ese commit](https://github.com/dcp-ai-protocol/dcp-ai/actions/runs/42557635924) pasó, y también los workflows de publicación que reconstruyeron y publicaron los archivos de [PyPI](https://github.com/dcp-ai-protocol/dcp-ai/actions/runs/42559171389) y de [crates.io](https://github.com/dcp-ai-protocol/dcp-ai/actions/runs/42559174109); estas ejecuciones son comprobaciones propias del proyecto, no una auditoría externa. Desde él se publicaron seis versiones: `@dcp-ai/sdk` 2.4.0, `@dcp-ai/wasm` 2.2.0 y `@dcp-ai/cli` 2.2.0 en npm, `dcp-ai` 2.11.0 en PyPI, Rust `dcp-ai` 2.14.0 en crates.io y el módulo Go v2.14.0. Es una publicación en registros tras una validación interna, no una auditoría externa ni una certificación. `@dcp-ai/express` 2.1.0 y los demás adaptadores npm no se republicaron.

| Registro | Versión | Identificador |
|---|---|---|
| npm `@dcp-ai/sdk` | 2.4.0 | `sha512-4IsY/ctFqLf5vvOS6bWUdN63NCbMoi6N0qnAceYG8AINnqm7+cRyG5stO+P4ZM8ROM2uyhI09AlcQDhdJVhIeQ==` |
| npm `@dcp-ai/wasm` | 2.2.0 | `sha512-eu9NiNXl99hCKz/xpUPteaZGF+ea0+WTQ/6mZu2RIkuP2eTMsym0Bbp7gTbqB1LaaGMGuRFYAjK8wSVIGt/AAA==` |
| npm `@dcp-ai/cli` | 2.2.0 | `sha512-/UR5K7/PctZX8Do6CULz1ua1eEwt19Jo/Q/adkMq806uRjZ2gh10W0FnfrzJVJPjskadK/tma2aXisU+z1Hx7Q==` |
| PyPI `dcp-ai` | 2.11.0 | wheel `2e7776e1c3675f9f4a3c088d6115b728d6e33c72c69a2e624b1771ab9fa45f53`, sdist `9d4a545376e2a9a0afa61b0845ef5bf992b9c92ac5390da95a35333327397da7` (SHA-256) |
| crates.io `dcp-ai` | 2.14.0 | `704028282d977973fc84e6fbaa495159e43ecec5951cf2f1b5ea9d3e70515424` (checksum) |
| Módulo Go `sdks/go/v2` | v2.14.0 | etiqueta `sdks/go/v2.14.0`, commit `cdb7099b8b6dc2a78b54928250752fd0bbd9c770`, `h1:9O4n7vn3YqOhKlyUg/cm0OnouQi4QbU7mHbIh1BM5Z8=` |

- **Identidad con los artefactos probados.** Los tarballs de npm son los archivos probados antes de la publicación, con la misma integridad `sha512`. El wheel y el sdist de PyPI y el crate los reconstruyeron desde `main` los workflows de publicación y contienen los mismos archivos fuente que los artefactos probados; los archivos de Python solo difieren en metadatos (Metadata-Version 2.5 y hatchling 1.33.0 en lugar de 2.4 y 1.27.0, con el RECORD recalculado), y el crate añade `.cargo_vcs_info.json`, que nombra `main`. El módulo Go que sirve el proxy tiene los mismos 106 archivos y el mismo `h1` que el módulo probado; solo difiere la compresión del zip.
- **Instalado desde los registros.** Consumidores nuevos instalaron cada paquete por nombre y versión, sin `file:`, dependencias por ruta, `replace`, `[patch]` ni overrides: el wheel y el sdist de PyPI (el sdist compilado por pip), el crate con sus features predeterminada y `otlp`, el SDK, la CLI y el WASM de npm con `@dcp-ai/express` 2.1.0, que resolvió el único `@dcp-ai/sdk` 2.4.0, y el módulo Go mediante `proxy.golang.org` con la base de datos de checksums activa y Go 1.26.10. Las comprobaciones de composición, acuse, ingreso y P-ED-1, las suites de la CLI y las comprobaciones de WASM dieron los mismos resultados que sobre los artefactos probados.
- **Puntos de empaquetado de la congelación MP-06.** Para estas versiones, el binario de WASM se compila sin rutas de compilación locales y una puerta de publicación revisa los archivos empaquetados, `@dcp-ai/cli` incluye `LICENSE`, y la feature `otlp` de Rust exige `anyhow` 1.0.103 y `tokio` 1.53.3 o posteriores; los builds predeterminado y `wasm` no seleccionan ninguno de los dos. El `LICENSE` añadido a `integrations/express` está solo en el repositorio: el tarball publicado de `@dcp-ai/express` 2.1.0 sigue sin él.
- **No cubierto.** Siguen vigentes las exclusiones de la congelación MP-06 de arriba y de [Límites y exclusiones conocidos](#known-limits-and-exclusions), salvo los puntos de empaquetado y dependencias cerrados aquí para estas versiones: las rutas de compilación de WASM, el `LICENSE` de la CLI y los mínimos de OTLP. La instantánea de MP-06 de arriba se conserva tal como se registró. Las comprobaciones finitas no establecen la ausencia de vulnerabilidades.

<a id="reproduce"></a>

## Reproducir

Desde un checkout del commit que se revisa, con Node 22, Python 3.10+, Go (la versión de `sdks/go/go.mod`) y un toolchain estable de Rust (con `wasm32-unknown-unknown` y wasm-pack para WASM). Las instalaciones usan los locks versionados donde existen. El SDK de Python no tiene ninguno: `pip install -e ".[dev]"` resuelve las versiones disponibles en el momento de instalar.

En la base:

```bash
(cd sdks/typescript && npm ci && npm run build && npm test) && npm ci --ignore-scripts
npm run conformance
(cd sdks/python && pip install -e ".[dev]" && pytest)
(cd sdks/go && go test ./...)
(cd sdks/rust && cargo test --locked)
(cd sdks/wasm && npm ci && npm run build && npm test)
node tools/conformance/wrappers/build.mjs all
node tools/conformance-external.js --catalog evidence --assessment verdict --report /tmp/evidence-ts.json -- node tools/conformance/wrappers/ts-sdk.mjs --sdk sdks/typescript/dist/index.js
node tools/conformance-external.js --catalog delegation --report /tmp/delegation-ts.json -- node tools/conformance/wrappers/ts-sdk.mjs --sdk sdks/typescript/dist/index.js
```

Solo desde #124 (estos comandos no existen en la base):

```bash
node tools/difffuzz/run.mjs --sdks five --iterations 60 --report /tmp/difffuzz-five.json
node tools/difffuzz/run-mandates.mjs --iterations 120 --report /tmp/mandates.json
```

- **Qué muestra un pase.** Una ejecución muestra que estos casos pasan con el argv que se ejecutó, nada más.
- **WASM.** `npm test` en `sdks/wasm` solo compila la capa TypeScript y necesita `pkg/dcp_ai_bg.wasm`, que produce `npm run build`.
- **Más comandos.** El [kit de conformidad](../../../../tools/conformance/README.md) lista todos los catálogos y sus wrappers; los [arneses diferenciales](../../../../tools/difffuzz/README.md) listan sus límites.
- **Ejecuciones de referencia.** La CI ejecuta las mismas suites en `.github/workflows/ci.yml` y `difffuzz.yml`.

<a id="record-what-you-ran"></a>

## Registra lo que ejecutaste

- **Código.** El commit exacto (`git rev-parse HEAD`) y si el árbol de trabajo difiere de él (`git status --porcelain`, y `git diff` si difiere).
- **Toolchains y artefactos.** Las versiones de los toolchains, y las versiones y hashes de los artefactos ejecutados: el `dist` de TypeScript, los binarios compilados, el paquete WASM y los paquetes de Python resueltos (`python -m pip freeze`). El kit y los arneses diferenciales registran la mayoría en sus informes.
- **Informes.** Conserva los ficheros de informe con sus hashes.
- **Procedencia.** El nombre y la versión de `implementation` que un wrapper declara en un informe son su propia declaración, no una procedencia autenticada; la evidencia son los hashes de lo que compilaste y ejecutaste.

<a id="what-to-review"></a>

## Qué revisar

| Capa | Rutas | Lo que un pase no establece |
|---|---|---|
| Núcleo del protocolo y perfiles | `spec/`, `schemas/`; canonicalización `dcp-jcs-v1` | Texto normativo; `dcp-jcs-v2` es experimental y opt-in, nunca predeterminado |
| Verificadores de los SDK | `sdks/typescript`, `sdks/python`, `sdks/go`, `sdks/rust`, `sdks/wasm` | Un bundle verificado no es confianza en el principal, admisión ni autorización; cada una es una API aparte ([ADMISSION.md](../../../../docs/ADMISSION.md)) |
| Herramientas de conformidad y diferenciales | `tools/conformance`, `tools/difffuzz`, `tests/` | Infraestructura de pruebas, no parte del protocolo |
| Servicios de referencia | `server/`, `services/` (anclaje, log de transparencia, revocación) | Decisiones de despliegue, no normativas; los verificadores funcionan sin ellos |
| Adaptadores y generadores | `integrations/`, `packages/`, la integración FastAPI del SDK de Python | Opcionales; algunas versiones publicadas están afectadas ([SECURITY.md](../../../../SECURITY.md#supported-versions)) |
| Operador | Claves, anclas de confianza, configuración de admisión, tokens de servicio, despliegues | El repositorio no da ninguna garantía sobre ellos |

<a id="requirements-to-tests"></a>

## Requisitos y pruebas

| Área | Dónde se mapea |
|---|---|
| Verificación V2, de V2-1 a V2-14 | [Mapa de verificación V2](SECURITY_COVERAGE.md#v2-verification-map), con su [frontera de esquemas](SECURITY_COVERAGE.md#schema-and-cryptographic-api-boundary) |
| Política del verificador, incluida la aclaración de V2-10 | [Muestras de política del verificador](SECURITY_COVERAGE.md#verifier-policy-samples) |
| Reglas estructurales | [Muestras estructurales](SECURITY_COVERAGE.md#structural-samples) |
| Admisión y `strict-v1` | [Mapa de admisión](SECURITY_COVERAGE.md#admission-map) |
| Cadenas de mandatos DCP-09 | [Mapa de delegación](SECURITY_COVERAGE.md#delegation-map) |
| Acuerdo entre SDK | [Muestras diferenciales](SECURITY_COVERAGE.md#differential-samples) |
| Algoritmos | [tests/nist-kat](../../../../tests/nist-kat/README.md): vectores RFC 8032 para Ed25519; pruebas de tamaño, ida y vuelta, clave incorrecta y entre SDK para ML-DSA-65, y 204 casos de verificación con contexto vacío (NIST ACVP tc39 y 203 casos de C2SP Wycheproof, que no es una fuente NIST) en los cuatro SDK y en wasm32; vectores NIST ACVP, con el SHA-256 de sus archivos de origen, para ML-KEM-768 y SLH-DSA-192f. Superarlas no es una validación NIST de un módulo criptográfico |

<a id="artifacts"></a>

## Artefactos

Son tres cosas distintas; nunca leas una como otra.

| Artefacto | Versiones | Qué contiene |
|---|---|---|
| Código revisado | `main` en la base | Todas las correcciones de abajo |
| Publicadas (09/11/2026) | `@dcp-ai/sdk` 2.4.0, `@dcp-ai/wasm` 2.2.0, `@dcp-ai/cli` 2.2.0, `dcp-ai` 2.11.0 (PyPI), Go v2.14.0, Rust `dcp-ai` 2.14.0 | Todos los cambios de los SDK de abajo, más P-ED-1 y las API de admisión delegada de activación explícita ([Publicación del 09/11/2026](#publication-of-09112026)) |
| Publicadas (05/11/2026) | `@dcp-ai/sdk` 2.3.0, `@dcp-ai/wasm` 2.1.3, `dcp-ai` 2.10.2 (PyPI), Go v2.13.0, Rust `dcp-ai` 2.13.0 | Todos los cambios de los SDK de abajo |
| Preparadas el 30/10/2026 (#114), nunca publicadas, sustituidas | Go v2.12.0, Rust `dcp-ai` 2.12.0, `@dcp-ai/wasm` 2.1.2 | #106 (WASM), #107 y #112; no #103 ni #116 a #119 |
| Publicadas antes (28/10/2026) | `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1, `@dcp-ai/cli` 2.1.1, `dcp-ai` 2.10.1 (PyPI), Go v2.11.1, Rust `dcp-ai` 2.11.1 | Las correcciones del verificador del 26/10/2026 y las comprobaciones secundarias SHA3-256 del 28/10/2026; ninguna de las correcciones de abajo |

Un número de versión por sí solo no identifica un artefacto. Los manifiestos de `main` llevan los números publicados el 09/11/2026; el candidato del 30/10/2026 usó Go y Rust 2.12.0 y `@dcp-ai/wasm` 2.1.2 para menos cambios, y esos números no se reutilizan. Usa los identificadores de los registros de abajo o los hashes de lo que compilaste. Para las versiones del 05/11/2026, los tarballs de npm son los archivos probados antes de la publicación; los archivos de PyPI y el crate se reconstruyeron desde `main` y contienen los mismos archivos que los artefactos probados, salvo el `.cargo_vcs_info.json` del crate, que nombra `main`. Tras la publicación, el 05/11/2026, se volvieron a leer los registros públicos con TLS normal: las últimas versiones eran las de arriba, con los identificadores de abajo.

| Registro | Versión | Identificador |
|---|---|---|
| npm `@dcp-ai/sdk` | 2.3.0 | `sha512-5IsrDMKE3NM8e5jVLFIaigNFHIni/aIzD9Q4zNYZu6sTLfsPk/zqRxi9ccjtGSTiaftTba3LD/1JA4Gi0uS1bw==` |
| npm `@dcp-ai/wasm` | 2.1.3 | `sha512-ToL7ZE+8mEvKJCO5DXxJm+GS2nrQ2tInHYJn+cWqLWxT+eMss9ka9MVp30LNmopO+MTqgwBs1hmAy6TOI5wDIA==` |
| npm `@dcp-ai/cli` | 2.1.1 | `sha512-Qmuq5FiT+TUW3nZ4HCp/DUXdF6JVYB6vaCmNZL/qK8EWiSpP5gzgesSwK0zzlOQL20SJJditRR0h5YIQ7gxIMw==` |
| PyPI `dcp-ai` | 2.10.2 | wheel `825de9d6dce5ec2737d38534e7c3d357edbded437912605a549cde75518f198b`, sdist `6005f342a0a24bee331c30be2fb2bc89a1306a21de399051cd1cef3cc96297e4` (SHA-256) |
| crates.io `dcp-ai` | 2.13.0 | `579f070ad23c531147ef91287d610c6dc317bef997e2791a24a5070a4c0c13a1` (checksum) |
| Go module `sdks/go/v2` | v2.13.0 | tag `sdks/go/v2.13.0`, commit `46b142bd7e42601acd912f156bbfcd9f5204a4be` (05/11/2026), `h1:bRkqSUWHQ/qTywPmKWRdzg2bBWI0RG1ZZAlb6IafnyU=` |

Cambios de SDK posteriores a las versiones del 28/10/2026, publicados el 05/11/2026:

| Cambio | Commit | SDK | Publicado |
|---|---|---|---|
| Claves y aislamiento de `VerificationCache` (#103) | `e711179a` | TypeScript | Sí, 05/11/2026 |
| `dualMerkleRoot` de WASM sigue V2-11 (#106) | `cac0a5f6` | Rust (feature `wasm`), WASM | Sí, 05/11/2026 (preparado el 30/10/2026) |
| `VerifyPayloadHash` comprueba el hash normativo con prefijo (#107) | `24e70d56` | Go | Sí, 05/11/2026 (preparado el 30/10/2026) |
| `RawAuditEventV2` conserva las entradas de auditoría recibidas (#112) | `6dc97d59` | Go, Rust | Sí, 05/11/2026 (preparado el 30/10/2026) |
| Validación de esquemas V2-2 dentro de cada verificador V2 (#116) | `0ebd2849` | TypeScript, Python, Go, Rust, WASM | Sí, 05/11/2026 |
| Helpers de validez de mandatos alineados (#117) | `614b1c56` | TypeScript, Python, Go, Rust | Sí, 05/11/2026 |
| Comprobaciones de tiempo de las cadenas de mandatos alineadas (#118) | `7619ff95` | TypeScript, Python, Go, Rust | Sí, 05/11/2026 |
| Dominios repetidos en un mandato raíz aislado rechazados (#119) | `c154192f` | TypeScript, Python, Go, Rust | Sí, 05/11/2026 |

Otros cambios posteriores a las versiones del 28/10/2026:

- **Log de transparencia de referencia.** #120 (`c59ce5ba`) liga las alertas de gossip a la identidad del log observado, y #122 (`d45c5a7b`) sondea los peers añadidos en ejecución. Este servicio no se distribuye como paquete.
- **Especificación y kit de conformidad.** #121 (`0dcbd8dc`) añade el catálogo de delegación. #123 (`45ac32f0`) añade las aclaraciones de V2-10 y DCP-09 §3.5.2, el catálogo de políticas 2.0 y el catálogo de delegación 2.0.0. Sin cambios en los SDK.
- **Usuarios de los registros.** Los cambios de los SDK de la tabla de arriba les llegan con las versiones del 05/11/2026; las versiones anteriores mantienen los límites indicados aquí. El registro de transparencia, la especificación y el kit de conformidad no forman parte de esos paquetes: se usan desde el repositorio.

<a id="known-limits-and-exclusions"></a>

## Límites y exclusiones conocidos

- **Registro de auditoría.** [AUDIT-v2.0-FINAL.md](../../../../spec/AUDIT-v2.0-FINAL.md) es un registro histórico interno del 26/02/2026, con una nota de contexto actual. No es una auditoría externa.
- **Sin proveedor HSM.** El `HsmCryptoProvider` simulado se retiró del código TypeScript el 06/11/2026; ningún SDK tiene un proveedor HSM, el servidor de referencia anuncia `hsm_provider: false` y `dcp audit gaps` mantiene abierta la carencia n.º 11 ([NIST_CONFORMITY.md](../../../../docs/NIST_CONFORMITY.md)).
- **Recuperación de claves.** Las partes no se cifran con el KEM híbrido.
- **Servidor de referencia.** Comprueba la estructura de la firma de un aviso, no la firma ([server/README.md](../../../../server/README.md)).
- **WASM.** No exporta verificación de cadenas de mandatos.
- **Rust.** Le falta el cifrado de sesión A2A AES-256-GCM y su ventana de repetición ([RUST_RELEASE.md](../../../../docs/RUST_RELEASE.md)).
- **Versiones publicadas antes del 05/11/2026.** No contienen los cambios de [Artefactos](#artifacts).
- **Versiones publicadas antes del 09/11/2026.** No contienen P-ED-1 (salvo donde la compilación oficial de PyNaCl que usa el SDK de Python ya rechazaba esas firmas) ni las API de admisión delegada de activación explícita.
- **Campañas diferenciales y de fuzzing.** Son finitas, no exhaustivas. Las entradas que el contrato `/4` no puede llevar a todos los SDK se miden aparte ([arneses diferenciales](../../../../tools/difffuzz/README.md#mandate-chains)).
- **Rendimiento.** No se comprueba ningún requisito de velocidad. La [línea base de rendimiento](../../../../tools/conformance/README.md#performance-baseline) y el [escalado acotado de cargas](../../../../tools/conformance/README.md#bounded-workload-scaling) son mediciones locales del método, añadidas después del commit de base; ninguna de las dos es un resultado de auditoría.
- **Sin cubrir.** Las imágenes de contenedor, los despliegues, los tokens de servicio y la configuración del operador.

<a id="reporting"></a>

## Notificación

Notifica los problemas de seguridad como describe [SECURITY.md](../../../../SECURITY.md). Recoge los contactos, el alcance (incluidas las reproducciones locales acotadas de agotamiento de recursos) y la política de recompensas: las recompensas son caso por caso, sin importe garantizado ni fijo.
