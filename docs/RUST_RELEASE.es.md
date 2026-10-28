<a id="published-rust-crate"></a>

# Crate Rust publicado

> Traducción informativa del [original en inglés](RUST_RELEASE.md), revisada el 28/10/2026. Los identificadores y ejemplos de código se conservan sin traducir.

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

Verifica los campos secundarios SHA3-256 de [VERIFICATION.md V2-11](../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) cuando están presentes: `audit_merkle_root_secondary` (el árbol SHA3-256 construido como el primario; `sha3-256:` seguido de 64 ceros para una traza vacía), cada `prev_hash_secondary` (`"GENESIS"` en la primera entrada y, después, el SHA3-256 de la entrada anterior tal como figura) y cada `intent_hash_secondary` (el SHA3-256 del payload de la intención). Los campos ausentes no se exigen, así que un bundle verificado puede no tener una cadena secundaria completa. Un campo presente que sea `null`, no sea una cadena o sea incoherente se rechaza: es un cambio de aceptación para la evidencia que lleva esos campos, que 2.11.0 aceptaba. No cambian las API, los campos de resultado, `dcp-jcs-v1`, las API experimentales opt-in de `dcp-jcs-v2` ni el tratamiento de `hash_alg`. La verificación sigue sin ser confianza en el principal, admisión ni autorización. La telemetría informa `2.11.1`.

<a id="upgrade-and-compatibility"></a>

## Actualización y compatibilidad

La 2.11.0 (26/10/2026) incluía, y la 2.11.1 conserva, correcciones de verificación V2 de principal, claves, artefactos y checkpoints, confianza explícita y `strict-v1`, cadenas de delegación, construcción/firma V2 y API candidatas experimentales. Se conserva la compatibilidad de `V2VerificationResult` con sus diez campos; los detalles de firmantes se ofrecen por separado. En la 2.11.0, la telemetría indicaba `2.11.0`. Véanse el [README del SDK](../sdks/rust/README.md), la [guía de admisión](ADMISSION.md) y la [política de seguridad](../SECURITY.md).

La verificación es más estricta que en 2.10.0: puede rechazar evidencia malformada o inconsistente antes aceptada. Conserva la evidencia histórica en lugar de reescribirla. `dcp-jcs-v1` sigue siendo el perfil normativo predeterminado; `dcp-jcs-v2` es experimental, no normativo y opt-in. Verificar no otorga confianza en el principal, admisión ni autorización. Rust aún no implementa el cifrado de sesiones A2A AES-256-GCM ni su ventana de replay, y el constructor V2 no genera checkpoints PQ. En la 2.11.0, el verificador comprobaba la cadena de auditoría primaria, pero no los campos secundarios SHA3-256 opcionales; la 2.11.1 los comprueba cuando están presentes.

<a id="validation"></a>

## Validación

Para la 2.11.1, el flujo de publicación publicó el crate; todos los archivos del crate del registro coinciden con los revisados salvo `.cargo_vcs_info.json`, que registra el commit limpio de `main`. Un consumidor externo que resuelve 2.11.1 desde crates.io pasó 73 pruebas.

Para la 2.11.0 (26/10/2026), la suite predeterminada pasó 261 pruebas y la de todas las funciones, 267, incluidos doctests. La biblioteca y las pruebas WASM compilaron para `wasm32-unknown-unknown`; esto no es una prueba de ejecución en navegador. Cargo empaquetó y verificó 71 archivos, y pasó la simulación de publicación. Un consumidor externo pasó 72 pruebas contra el crate extraído: admisión, compatibilidad, ingreso/router candidato y regresiones del verificador; el control negativo invertido falló como se esperaba. Tras publicar, una caché nueva del registro resolvió exactamente 2.11.0 sin rutas locales ni parches y pasaron las mismas 72 pruebas. El checksum del archivo público y los bytes de las fuentes empaquetadas coincidieron con la versión revisada. Los fixtures compartidos de estas pruebas provienen del repositorio; las aplicaciones no los necesitan.

<a id="related-releases"></a>

## Publicaciones relacionadas

Las versiones actuales en cada registro están en [Versiones publicadas](README.md#published-versions). Otras notas de publicación: [paquetes npm](NPM_RELEASES.md), [Python 2.10.1](PYTHON_RELEASE.md) y [Go v2.11.1](GO_RELEASE.md).
