<a id="published-rust-crate"></a>

# Crate Rust publicado

> Traducción informativa del [original en inglés](RUST_RELEASE.md), revisada el 26/10/2026. Los identificadores y ejemplos de código se conservan sin traducir.

Verificado el 26/10/2026: [`dcp-ai` 2.11.0](https://crates.io/crates/dcp-ai/2.11.0) está disponible en crates.io. La versión del crate es independiente de la versión del formato/especificación DCP. Esta publicación actualiza solo Rust; npm, Python, Go y contenedores tienen publicaciones independientes.

<a id="install"></a>

## Instalación

Ejecuta desde el crate de tu aplicación con una herramienta Rust estable actual. Guarda los cambios en `Cargo.toml` y `Cargo.lock`. Estos ejemplos permiten actualizaciones compatibles 2.x; usa `=2.11.0` en el manifest si necesitas fijar la versión exacta.

```bash
cargo add dcp-ai@2.11.0
cargo check --locked
```

```toml
[dependencies]
dcp-ai = "2.11.0"
```

La exportación OTLP y los bindings WebAssembly opcionales se seleccionan con `otlp` y `wasm`. Activa solo lo que necesite tu destino. Esta versión Rust no vuelve a publicar el paquete WASM independiente de npm.

<a id="upgrade-and-compatibility"></a>

## Actualización y compatibilidad

Esta versión incluye correcciones de verificación V2 de principal, claves, artefactos y checkpoints, confianza explícita y `strict-v1`, cadenas de delegación, construcción/firma V2 y API candidatas experimentales. Se conserva la compatibilidad de `V2VerificationResult` con sus diez campos; los detalles de firmantes se ofrecen por separado. La telemetría indica `2.11.0`. Véanse el [README del SDK](../sdks/rust/README.md), la [guía de admisión](ADMISSION.md) y la [política de seguridad](../SECURITY.md).

La verificación es más estricta que en 2.10.0: puede rechazar evidencia malformada o inconsistente antes aceptada. Conserva la evidencia histórica en lugar de reescribirla. `dcp-jcs-v1` sigue siendo el perfil normativo predeterminado; `dcp-jcs-v2` es experimental, no normativo y opt-in. Verificar no otorga confianza en el principal, admisión ni autorización. Rust aún no implementa el cifrado de sesiones A2A AES-256-GCM ni su ventana de replay, y el constructor V2 no genera checkpoints PQ. El verificador comprueba la cadena de auditoría primaria, pero no recalcula la cadena/raíz secundaria SHA3-256 opcional.

<a id="validation"></a>

## Validación

La suite predeterminada pasó 261 pruebas y la de todas las funciones, 267, incluidos doctests. La biblioteca y las pruebas WASM compilaron para `wasm32-unknown-unknown`; esto no es una prueba de ejecución en navegador. Cargo empaquetó y verificó 71 archivos, y pasó la simulación de publicación. Un consumidor externo pasó 72 pruebas contra el crate extraído: admisión, compatibilidad, ingreso/router candidato y regresiones del verificador; el control negativo invertido falló como se esperaba. Tras publicar, una caché nueva del registro resolvió exactamente 2.11.0 sin rutas locales ni parches y pasaron las mismas 72 pruebas. El checksum del archivo público y los bytes de las fuentes empaquetadas coincidieron con la versión revisada. Los fixtures compartidos de estas pruebas provienen del repositorio; las aplicaciones no los necesitan.
