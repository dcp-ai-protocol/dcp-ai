<a id="published-go-module"></a>

# Módulo Go publicado

> Traducción informativa de [la versión en inglés](../../../docs/GO_RELEASE.md), actualizada el 28/10/2026. Si difieren, prevalece la versión en inglés.

Verificado el 28/10/2026: el SDK Go `v2.11.1` está publicado mediante la [etiqueta `sdks/go/v2.11.1`](https://github.com/dcp-ai-protocol/dcp-ai/tree/sdks/go/v2.11.1/sdks/go), y el proxy público de módulos y la base de datos de checksums lo sirven. La publicación anterior, `v2.11.0` ([`sdks/go/v2.11.0`](https://github.com/dcp-ai-protocol/dcp-ai/tree/sdks/go/v2.11.0/sdks/go)), se verificó el 26/10/2026; sus notas se conservan abajo. El módulo y sus importaciones conservan `/v2`. La versión del SDK es independiente del formato/especificación DCP. Go no requiere un token de registro adicional: los consumidores resuelven la etiqueta del repositorio mediante el sistema de módulos Go.

<a id="install"></a>

## Instalar

Requiere Go 1.25+. Ejecuta desde el módulo de tu aplicación. Actualiza y guarda sus archivos `go.mod` y `go.sum`:

```bash
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.11.1
go mod verify
```

<a id="what-changed-in-v2111"></a>

## Qué cambió en v2.11.1

Verifica los campos secundarios SHA3-256 de [VERIFICATION.md V2-11](../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) cuando están presentes: `audit_merkle_root_secondary` (el árbol SHA3-256 construido como el primario; `sha3-256:` seguido de 64 ceros para una traza vacía), cada `prev_hash_secondary` (`"GENESIS"` en la primera entrada y, después, el SHA3-256 de la entrada anterior tal como figura) y cada `intent_hash_secondary` (el SHA3-256 del payload de la intención). Los campos ausentes no se exigen, así que un bundle verificado puede no tener una cadena secundaria completa. Un campo presente que sea `null`, no sea una cadena o sea incoherente se rechaza: es un cambio de aceptación para la evidencia que lleva esos campos, que v2.11.0 aceptaba. No cambian las API, los campos de resultado, `dcp-jcs-v1`, las API experimentales opt-in de `dcp-jcs-v2` ni el tratamiento de `hash_alg`. La verificación sigue sin ser confianza en el principal, admisión ni autorización. La telemetría del SDK informa `2.11.1`.

<a id="upgrade-and-compatibility"></a>

## Actualización y compatibilidad

La v2.11.0 (26/10/2026) incluía, y la v2.11.1 conserva, gestión de errores de longitud de clave V1, verificación corregida de principal/claves/artefactos/checkpoints V2, confianza explícita en el principal y `strict-v1`, cadenas de delegación y sesiones A2A concurrentes con protección frente a replay. En la v2.11.0, la telemetría del SDK informaba `2.11.0`. Véanse el [README del SDK](../../../sdks/go/README.md), la [guía de admisión](../../../docs/ADMISSION.md) y la [política de seguridad](../../../SECURITY.md).

La verificación es más estricta que en v2.10.0: puede rechazarse evidencia malformada o inconsistente antes aceptada. Conserva la evidencia histórica sin reescribirla. `dcp-jcs-v1` sigue siendo el predeterminado normativo; las API `dcp-jcs-v2` siguen experimentales, no normativas y opt-in explícito. Verificación no equivale a confianza en el principal, admisión ni autorización. En la v2.11.0, los campos secundarios SHA3-256 opcionales quedaban fuera de las comprobaciones del verificador; la v2.11.1 los comprueba cuando están presentes.

<a id="validation"></a>

## Validación

Para la v2.11.1, los 84 archivos del zip del módulo que sirve el proxy son idénticos a `main` (Go añade al zip el `LICENSE` raíz del repositorio), y el proxy y la base de datos de checksums confirmaron la versión. Un consumidor externo que resuelve `v2.11.1` desde el proxy, sin `replace` local, pasó 189 pruebas.

Para la v2.11.0 (26/10/2026), la suite predeterminada y la suite `-race -tags otlp` pasaron 1.154 pruebas/subpruebas cada una; una prueba se reserva intencionalmente para la matriz en vivo de productores/consumidores. Pasaron `go mod tidy -diff`, compilación y vet. Un consumidor externo pasó 137 pruebas/subpruebas y su control negativo falló como debía. El módulo publicado se descargó en una caché nueva mediante el proxy público y verificación de checksums; sus fuentes coincidieron con el commit revisado. Después, el consumidor pasó sin ninguna directiva `replace` local. Para la publicación independiente de Rust, véase [Rust](../../../docs/RUST_RELEASE.md).

<a id="related-releases"></a>

## Publicaciones relacionadas

Las versiones actuales en cada registro están en [Versiones publicadas](../../../docs/README.md#published-versions). Otras notas de publicación: [paquetes npm](../../../docs/NPM_RELEASES.md), [Python 2.10.1](../../../docs/PYTHON_RELEASE.md) y [Rust 2.11.1](../../../docs/RUST_RELEASE.md).
