<sub>[English](../../../../docs/conformance/AUDIT_DOSSIER.md) · [中文](../../../zh-CN/docs/conformance/AUDIT_DOSSIER.md) · **Español** · [日本語](../../../ja/docs/conformance/AUDIT_DOSSIER.md) · [Português](../../../pt-BR/docs/conformance/AUDIT_DOSSIER.md)</sub>

<a id="audit-dossier"></a>

# Expediente de auditoría

> Traducción informativa de [la versión en inglés](../../../../docs/conformance/AUDIT_DOSSIER.md), actualizada el 05/11/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Este es el punto de entrada para una revisión de seguridad independiente de DCP-AI. Indica qué revisar, cómo reproducir la evidencia del repositorio, qué muestra esa evidencia y qué deja fuera. No es una especificación, ni una certificación, ni un informe de auditoría. El repositorio no contiene ningún informe de una auditoría externa independiente, y no certifica trabajos hechos fuera de él.

- Los documentos normativos están en [spec/](../../../../spec/README.md).
- El [mapa de cobertura de seguridad](SECURITY_COVERAGE.md) relaciona cada requisito con sus pruebas.
- La [guía del implementador](IMPLEMENTER_GUIDE.md) explica cómo informar de los resultados.

<a id="review-baseline"></a>

## Base de la revisión

- **Base de código:** el commit `45ac32f07f004e858e11dcc23ff72c3e5c7762b8` de `main`, del 05/11/2026 (#123). Contiene todas las correcciones de [Artefactos](#artifacts) y las aclaraciones de esa fecha al paso V2-10 de [VERIFICATION.md](../../../../spec/VERIFICATION.md) y a [DCP-09](../../../../spec/DCP-09.md) §3.5.2.
- **Commits posteriores:** el arnés diferencial de cadenas de mandatos y la comparación de bundles con cinco SDK (#124) llegaron después de la base, igual que este expediente. Un documento no puede nombrar su propio commit final. Registra el commit exacto que revisas y usa este archivo como guía de ese commit, no como evidencia sobre él.
- **Fuera de la base:** las imágenes de contenedor, los despliegues y la configuración del operador.

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
| Publicadas (05/11/2026) | `@dcp-ai/sdk` 2.3.0, `@dcp-ai/wasm` 2.1.3, `dcp-ai` 2.10.2 (PyPI), Go v2.13.0, Rust `dcp-ai` 2.13.0 | Todos los cambios de los SDK de abajo |
| Preparadas el 30/10/2026 (#114), nunca publicadas, sustituidas | Go v2.12.0, Rust `dcp-ai` 2.12.0, `@dcp-ai/wasm` 2.1.2 | #106 (WASM), #107 y #112; no #103 ni #116 a #119 |
| Publicadas antes (28/10/2026) | `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1, `@dcp-ai/cli` 2.1.1, `dcp-ai` 2.10.1 (PyPI), Go v2.11.1, Rust `dcp-ai` 2.11.1 | Las correcciones del verificador del 26/10/2026 y las comprobaciones secundarias SHA3-256 del 28/10/2026; ninguna de las correcciones de abajo |

Un número de versión por sí solo no identifica un artefacto. Los manifiestos de `main` llevan los números publicados el 05/11/2026; el candidato del 30/10/2026 usó Go y Rust 2.12.0 y `@dcp-ai/wasm` 2.1.2 para menos cambios, y esos números no se reutilizan. Usa los identificadores de los registros de abajo o los hashes de lo que compilaste. Los tarballs de npm son los archivos probados antes de la publicación; los archivos de PyPI y el crate se reconstruyeron desde `main` y contienen los mismos archivos que los artefactos probados, salvo el `.cargo_vcs_info.json` del crate, que nombra `main`. Tras la publicación, el 05/11/2026, se volvieron a leer los registros públicos con TLS normal: las últimas versiones eran las de arriba, con los identificadores de abajo.

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
- **Proveedor HSM simulado.** `HsmCryptoProvider` es un patrón simulado y no debe usarse para evidencia real ([NIST_CONFORMITY.md](../../../../docs/NIST_CONFORMITY.md)).
- **Recuperación de claves.** Las partes no se cifran con el KEM híbrido.
- **Servidor de referencia.** Comprueba la estructura de la firma de un aviso, no la firma ([server/README.md](../../../../server/README.md)).
- **WASM.** No exporta verificación de cadenas de mandatos.
- **Rust.** Le falta el cifrado de sesión A2A AES-256-GCM y su ventana de repetición ([RUST_RELEASE.md](../../../../docs/RUST_RELEASE.md)).
- **Versiones publicadas antes del 05/11/2026.** No contienen los cambios de [Artefactos](#artifacts).
- **Campañas diferenciales y de fuzzing.** Son finitas, no exhaustivas. Las entradas que el contrato `/4` no puede llevar a todos los SDK se miden aparte ([arneses diferenciales](../../../../tools/difffuzz/README.md#mandate-chains)).
- **Rendimiento.** No se comprueba ningún requisito de velocidad. La [línea base de rendimiento](../../../../tools/conformance/README.md#performance-baseline) y el [escalado acotado de cargas](../../../../tools/conformance/README.md#bounded-workload-scaling) son mediciones locales del método, añadidas después del commit de base; ninguna de las dos es un resultado de auditoría.
- **Sin cubrir.** Las imágenes de contenedor, los despliegues, los tokens de servicio y la configuración del operador.

<a id="reporting"></a>

## Notificación

Notifica los problemas de seguridad como describe [SECURITY.md](../../../../SECURITY.md). Recoge los contactos, el alcance (incluidas las reproducciones locales acotadas de agotamiento de recursos) y la política de recompensas: las recompensas son caso por caso, sin importe garantizado ni fijo.
