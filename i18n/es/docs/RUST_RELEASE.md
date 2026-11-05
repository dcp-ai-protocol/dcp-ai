<a id="published-rust-crate"></a>

# Crate Rust publicado

> Traducción informativa del [original en inglés](../../../docs/RUST_RELEASE.md), revisada el 05/11/2026. Los identificadores y ejemplos de código se conservan sin traducir.

Verificado el 28/10/2026: [`dcp-ai` 2.11.1](https://crates.io/crates/dcp-ai/2.11.1) está disponible en crates.io. La publicación anterior, [2.11.0](https://crates.io/crates/dcp-ai/2.11.0), se verificó el 26/10/2026; sus notas se conservan abajo. La versión del crate es independiente de la versión del formato/especificación DCP. El crate Rust se publica de forma independiente de npm, Python, Go y los contenedores.

<a id="install"></a>

## Instalación

Ejecuta desde el crate de tu aplicación con una herramienta Rust estable actual. Guarda los cambios en `Cargo.toml` y `Cargo.lock`. Estos ejemplos permiten actualizaciones compatibles 2.x; usa `=2.11.1` en el manifest si necesitas fijar la versión exacta.

```bash
cargo add dcp-ai@2.11.1
cargo check --locked
```

```toml
[dependencies]
dcp-ai = "2.11.1"
```

La exportación OTLP y los bindings WebAssembly opcionales se seleccionan con `otlp` y `wasm`. Activa solo lo que necesite tu destino. Esta versión Rust no vuelve a publicar el paquete WASM independiente de npm.

<a id="what-changed-in-2111"></a>

## Qué cambió en 2.11.1

Verifica los campos secundarios SHA3-256 de [VERIFICATION.md V2-11](../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) cuando están presentes: `audit_merkle_root_secondary` (el árbol SHA3-256 construido como el primario; `sha3-256:` seguido de 64 ceros para una traza vacía), cada `prev_hash_secondary` (`"GENESIS"` en la primera entrada y, después, el SHA3-256 de la entrada anterior tal como figura) y cada `intent_hash_secondary` (el SHA3-256 del payload de la intención). Los campos ausentes no se exigen, así que un bundle verificado puede no tener una cadena secundaria completa. Un campo presente que sea `null`, no sea una cadena o sea incoherente se rechaza: es un cambio de aceptación para la evidencia que lleva esos campos, que 2.11.0 aceptaba. No cambian las API, los campos de resultado, `dcp-jcs-v1`, las API experimentales opt-in de `dcp-jcs-v2` ni el tratamiento de `hash_alg`. La verificación sigue sin ser confianza en el principal, admisión ni autorización. La telemetría informa `2.11.1`.

<a id="upgrade-and-compatibility"></a>

## Actualización y compatibilidad

La 2.11.0 (26/10/2026) incluía, y la 2.11.1 conserva, correcciones de verificación V2 de principal, claves, artefactos y checkpoints, confianza explícita y `strict-v1`, cadenas de delegación, construcción/firma V2 y API candidatas experimentales. Se conserva la compatibilidad de `V2VerificationResult` con sus diez campos; los detalles de firmantes se ofrecen por separado. En la 2.11.0, la telemetría indicaba `2.11.0`. Véanse el [README del SDK](../../../sdks/rust/README.md), la [guía de admisión](../../../docs/ADMISSION.md) y la [política de seguridad](../../../SECURITY.md).

La verificación es más estricta que en 2.10.0: puede rechazar evidencia malformada o inconsistente antes aceptada. Conserva la evidencia histórica en lugar de reescribirla. `dcp-jcs-v1` sigue siendo el perfil normativo predeterminado; `dcp-jcs-v2` es experimental, no normativo y opt-in. Verificar no otorga confianza en el principal, admisión ni autorización. Rust aún no implementa el cifrado de sesiones A2A AES-256-GCM ni su ventana de replay, y el constructor V2 no genera checkpoints PQ. En la 2.11.0, el verificador comprobaba la cadena de auditoría primaria, pero no los campos secundarios SHA3-256 opcionales; la 2.11.1 los comprueba cuando están presentes.

<a id="validation"></a>

## Validación

Para la 2.11.1, el flujo de publicación publicó el crate; todos los archivos del crate del registro coinciden con los revisados salvo `.cargo_vcs_info.json`, que registra el commit limpio de `main`. Un consumidor externo que resuelve 2.11.1 desde crates.io pasó 73 pruebas.

Para la 2.11.0 (26/10/2026), la suite predeterminada pasó 261 pruebas y la de todas las funciones, 267, incluidos doctests. La biblioteca y las pruebas WASM compilaron para `wasm32-unknown-unknown`; esto no es una prueba de ejecución en navegador. Cargo empaquetó y verificó 71 archivos, y pasó la simulación de publicación. Un consumidor externo pasó 72 pruebas contra el crate extraído: admisión, compatibilidad, ingreso/router candidato y regresiones del verificador; el control negativo invertido falló como se esperaba. Tras publicar, una caché nueva del registro resolvió exactamente 2.11.0 sin rutas locales ni parches y pasaron las mismas 72 pruebas. El checksum del archivo público y los bytes de las fuentes empaquetadas coincidieron con la versión revisada. Los fixtures compartidos de estas pruebas provienen del repositorio; las aplicaciones no los necesitan.

<a id="prepared-not-published-2130"></a>

## Preparada, no publicada: 2.13.0

La 2.13.0 está preparada en el repositorio el 05/11/2026, pero no publicada en crates.io. Los comandos de instalación de arriba siguen en 2.11.1. Sustituye a la 2.12.0 de abajo, que nunca se publicó. Frente a 2.11.1, la 2.13.0:

- **Ejecuta la validación de esquemas V2-2 (cambio de aceptación).** `verify_signed_bundle_v2`, `…_with_policy` y `…_at`, incluida la compilación WASM, validan el sobre del bundle firmado y los cuatro payloads contra `schemas/v2` antes de cualquier comprobación de hash, clave o firma. Los bundles inválidos por esquema que antes se aceptaban ahora fallan con diagnósticos `schema: <pointer> <keyword>`.
- **Añade `RawAuditEventV2` y `RawAuditEventError`**, como la 2.12.0 de abajo.
- **Corrige `wasm_dual_merkle_root`** (con la feature `wasm`), como la 2.12.0 de abajo. Las raíces calculadas con la función anterior se conservan tal como se registraron; véase [Migrar resultados de `dualMerkleRoot`](../../../docs/NPM_RELEASES.md#migrating-dualmerkleroot-results).
- **Alinea las comprobaciones de mandatos.** `verify_mandate_validity` compara la ventana como instantes, ya no como texto, y `verify_mandate_validity_at` (nuevo) recibe el instante de verificación. `verify_mandate_chain` rechaza un mandato raíz que repite un dominio.

La telemetría informa `2.13.0`. No cambian el formato de transmisión, las firmas, los perfiles, `dcp-jcs-v1` como valor predeterminado normativo ni las API experimentales de activación explícita `dcp-jcs-v2`, y el crate incluye ahora el `LICENSE` Apache-2.0. El paquete npm construido a partir de este código fuente de Rust es `@dcp-ai/wasm` 2.1.3, también preparado y no publicado (véanse los [paquetes npm](../../../docs/NPM_RELEASES.md)). Véanse el [README del SDK](../../../sdks/rust/README.md) y el [changelog](../../../CHANGELOG.md#unreleased).

<a id="prepared-not-published-2120"></a>

## Preparada, no publicada: 2.12.0

La 2.12.0 está preparada en el repositorio desde el 30/10/2026, pero no publicada en crates.io. Los comandos de instalación de arriba siguen en 2.11.1. Respecto a la 2.11.1, la 2.12.0:

- **Añade `dcp_ai::v2::types::RawAuditEventV2` y `RawAuditEventError`.** `RawAuditEventV2` guarda una entrada de auditoría recibida como el `serde_json::Value` decodificado, de modo que cada miembro conserva su presencia y su condición de `null`, incluidos los desconocidos. Conserva el valor decodificado, no el texto original: serializarlo o canonicalizarlo con `dcp-jcs-v1` da los bytes de ese valor. `typed()` es una vista con pérdida; `AuditEventV2` conserva su comportamiento. El parseo, la verificación y la canonicalización del bundle completo no cambian.
- **Corrige `wasm_dual_merkle_root` (con la feature `wasm`).** Ahora calcula la raíz Merkle dual con la reducción de [VERIFICATION.md V2-11](../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) que usa el verificador de bundles (digests crudos de 32 bytes; en una capa impar se duplica el último nodo), y devuelve un error para una hoja que no es un digest hex de 32 bytes en lugar de aceptar una entrada malformada. El paquete npm construido a partir de este crate es `@dcp-ai/wasm` 2.1.2, también preparado y sin publicar (véanse los [paquetes npm](../../../docs/NPM_RELEASES.md)).

Las demás API, `dcp-jcs-v1` y las API experimentales opt-in `dcp-jcs-v2` no cambian; los nuevos tests del candidato experimental no cambian ningún valor predeterminado. La telemetría informa `2.12.0`. El crate ya no contiene los README traducidos, que ahora están en el árbol `i18n/` del repositorio. Véanse el [README del SDK](../../../sdks/rust/README.md) y el [changelog](../../../CHANGELOG.md).

> **Nota (05/11/2026).** La comparación anterior se escribió el 30/10/2026 para la 2.12.0 preparada, que sigue sin publicarse. Desde entonces `main` ha cambiado la verificación: todos los verificadores V2, incluida la compilación WASM, ejecutan la validación de esquemas V2-2 (#116, 02/11/2026), y cambiaron la función auxiliar de validez de mandatos, las comprobaciones de tiempo de la cadena y la comprobación de dominios raíz repetidos (#117 a #119). Estos cambios no están en la 2.12.0 descrita arriba, que nunca se publicó; la 2.13.0 de arriba los contiene y la sustituye, y los manifiestos de `main` llevan 2.13.0. Véase el [expediente de auditoría](../../../docs/conformance/AUDIT_DOSSIER.md#artifacts).

<a id="related-releases"></a>

## Publicaciones relacionadas

Las versiones actuales en cada registro están en [Versiones publicadas](../../../docs/README.md#published-versions). Otras notas de publicación: [paquetes npm](../../../docs/NPM_RELEASES.md), [Python 2.10.1](../../../docs/PYTHON_RELEASE.md) y [Go v2.11.1](../../../docs/GO_RELEASE.md).
