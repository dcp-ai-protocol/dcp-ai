<a id="published-go-module"></a>

# Módulo Go publicado

> Traducción informativa de [la versión en inglés](../../../docs/GO_RELEASE.md), actualizada el 09/11/2026. Si difieren, prevalece la versión en inglés.

Verificado el 09/11/2026: el SDK de Go `v2.14.0` está publicado mediante la [etiqueta `sdks/go/v2.14.0`](https://github.com/dcp-ai-protocol/dcp-ai/tree/sdks/go/v2.14.0/sdks/go), y el proxy público de módulos y la base de datos de checksums lo sirven ([qué cambió](#what-changed-in-v2140)). Las versiones anteriores, `v2.13.0` ([`sdks/go/v2.13.0`](https://github.com/dcp-ai-protocol/dcp-ai/tree/sdks/go/v2.13.0/sdks/go)), verificada el 05/11/2026, `v2.11.1` ([`sdks/go/v2.11.1`](https://github.com/dcp-ai-protocol/dcp-ai/tree/sdks/go/v2.11.1/sdks/go)), verificada el 28/10/2026, y `v2.11.0` ([`sdks/go/v2.11.0`](https://github.com/dcp-ai-protocol/dcp-ai/tree/sdks/go/v2.11.0/sdks/go)), verificada el 26/10/2026, conservan sus notas más abajo. El módulo y sus rutas de importación conservan `/v2`. La versión del SDK es independiente de la versión del formato de intercambio y de la especificación de DCP. Go no necesita un token de registro aparte: los consumidores resuelven la etiqueta del repositorio mediante el sistema de módulos de Go.

<a id="install"></a>

## Instalar

Requiere Go 1.25+. Ejecuta desde el módulo de tu aplicación. Actualiza y guarda sus archivos `go.mod` y `go.sum`:

```bash
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.14.0
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

Para la v2.13.0, el módulo que el proxy público sirve para la etiqueta `sdks/go/v2.13.0` (commit `46b142bd`) contiene los mismos 92 archivos que el módulo probado antes de la publicación, y la base de datos de checksums registra el hash del módulo probado, `h1:bRkqSUWHQ/qTywPmKWRdzg2bBWI0RG1ZZAlb6IafnyU=`. Los consumidores que resolvieron la v2.13.0 mediante `proxy.golang.org`, con la base de datos de checksums activa y sin un `replace` local, superaron el kit de conformidad externo (697 casos en siete catálogos), las comprobaciones de las API que cambian en la v2.13.0 y la comprobación del perfil predeterminado.

Para la v2.11.1, los 84 archivos del zip del módulo que sirve el proxy son idénticos a `main` (Go añade al zip el `LICENSE` raíz del repositorio), y el proxy y la base de datos de checksums confirmaron la versión. Un consumidor externo que resuelve `v2.11.1` desde el proxy, sin `replace` local, pasó 189 pruebas.

Para la v2.11.0 (26/10/2026), la suite predeterminada y la suite `-race -tags otlp` pasaron 1.154 pruebas/subpruebas cada una; una prueba se reserva intencionalmente para la matriz en vivo de productores/consumidores. Pasaron `go mod tidy -diff`, compilación y vet. Un consumidor externo pasó 137 pruebas/subpruebas y su control negativo falló como debía. El módulo publicado se descargó en una caché nueva mediante el proxy público y verificación de checksums; sus fuentes coincidieron con el commit revisado. Después, el consumidor pasó sin ninguna directiva `replace` local. Para la publicación independiente de Rust, véase [Rust](../../../docs/RUST_RELEASE.md).

<a id="what-changed-in-v2130"></a>

## Qué cambió en v2.13.0

La v2.13.0 se publicó el 05/11/2026 mediante la etiqueta `sdks/go/v2.13.0` sobre `main` (`46b142bd`). Sustituye a la v2.12.0 de abajo, que nunca se etiquetó. Frente a v2.11.1, la v2.13.0:

- **Ejecuta la validación de esquemas V2-2 (cambio de aceptación).** `v2.VerifySignedBundleV2` y sus variantes validan el sobre del bundle firmado y los cuatro payloads contra `schemas/v2` antes de cualquier comprobación de hash, clave o firma. Los bundles inválidos por esquema que antes se aceptaban ahora fallan con diagnósticos `schema: <pointer> <keyword>`.
- **Corrige `v2.VerifyPayloadHash` (cambio de aceptación)**, como la v2.12.0 de abajo: `true` solo para `"sha256:"` seguido del SHA-256 del payload canónico, tal como lo escribe `SignPayload`; un digest sin prefijo es `false`.
- **Añade `v2.RawAuditEventV2`**, como la v2.12.0 de abajo.
- **Alinea las comprobaciones de mandatos.** `v2.VerifyMandateValidity` aplica un único contrato y `v2.VerifyMandateValidityAt` (nuevo) recibe el instante de verificación; una fecha ausente o mal formada, que antes se aceptaba, es inválida. `v2.VerifyMandateChain` lee todos los instantes de la misma manera y rechaza un mandato raíz que repite un dominio.

`SDKVersion` es `2.13.0`. No cambian el formato de transmisión, las firmas, los perfiles, `dcp-jcs-v1` como valor predeterminado normativo ni las API experimentales de activación explícita `dcp-jcs-v2`. Conserva la evidencia histórica en lugar de reescribirla: un bundle que las nuevas comprobaciones rechazan se queda como se recibió. El README del SDK en el módulo publicado es el que se preparó antes de la publicación: dice «prepared, not published», y su fila de `v2.VerifyPayloadHash` y su párrafo de `v2.RawAuditEventV2` todavía dicen «prepared for v2.12.0». Un módulo publicado no puede cambiar; el README del repositorio describe la v2.13.0. Véanse el [README del SDK](../../../sdks/go/README.md) y el [changelog](../../../CHANGELOG.md#unreleased).

<a id="prepared-not-published-v2120"></a>

## Preparada, no publicada: v2.12.0

La v2.12.0 está preparada en el repositorio desde el 30/10/2026, pero no publicada: la etiqueta `sdks/go/v2.12.0` no existe, así que el proxy de módulos no sirve esta versión y `go get` no puede resolverla. En el momento de la preparación, el comando de instalación seguía en v2.11.1; la versión actual está en [Versiones publicadas](../../../docs/README.md#published-versions). Respecto a la v2.11.1, la v2.12.0:

- **Corrige `v2.VerifyPayloadHash` (cambio de aceptación).** Devuelve `true` solo cuando `payload_hash` es exactamente `"sha256:"` seguido del SHA-256 en hex minúscula del payload canónico `dcp-jcs-v1`. Ahora acepta la salida de `v2.SignPayload` y rechaza un digest sin prefijo; la v2.11.1 hacía lo contrario. La función solo comprueba la consistencia del hash, no la firma, las claves, la política, la confianza en el principal ni la admisión. La verificación de bundles nunca la usó y no cambia.
- **Añade `v2.RawAuditEventV2`.** Conserva los bytes literales de una entrada de auditoría recibida, de modo que los miembros `null` explícitos y los desconocidos sobreviven al reenvío; `Typed()` es una vista con pérdida. `AuditEventV2` y los demás structs tipados siguen siendo tipos para producir y conservan su comportamiento.

Las demás API, la verificación de bundles, `dcp-jcs-v1` y las API experimentales opt-in `dcp-jcs-v2` no cambian; los nuevos tests del candidato experimental no cambian ningún valor predeterminado. La telemetría del SDK informa `2.12.0`. El módulo ya no contiene los README traducidos, que ahora están en el árbol `i18n/` del repositorio. Véanse el [README del SDK](../../../sdks/go/README.md) y el [changelog](../../../CHANGELOG.md).

> **Nota (05/11/2026).** La comparación anterior se escribió el 30/10/2026 para la v2.12.0 preparada, que sigue sin publicarse. Desde entonces `main` ha cambiado la verificación: todos los verificadores V2 ejecutan la validación de esquemas V2-2 (#116, 02/11/2026), y cambiaron la función auxiliar de validez de mandatos, las comprobaciones de tiempo de la cadena y la comprobación de dominios raíz repetidos (#117 a #119). Estos cambios no están en la v2.12.0 descrita arriba, que nunca se etiquetó; la v2.13.0 de arriba los contiene y la sustituye, y los manifiestos de `main` llevan v2.13.0. Véase el [expediente de auditoría](../../../docs/conformance/AUDIT_DOSSIER.md#artifacts).

<a id="what-changed-in-v2140"></a>

## Qué cambió en v2.14.0

La v2.14.0 se publicó el 09/11/2026 mediante la etiqueta `sdks/go/v2.14.0` en `main` (`cdb7099b`). El módulo que sirve el proxy tiene los mismos 106 archivos y el mismo hash, `h1:9O4n7vn3YqOhKlyUg/cm0OnouQi4QbU7mHbIh1BM5Z8=`, que el módulo probado antes de la publicación; solo difiere la compresión del zip. Consumidores que resolvieron la v2.14.0 mediante `proxy.golang.org`, con la base de datos de checksums activa, sin un `replace` local y con Go 1.26.10, instalaron ese módulo y dieron los mismos resultados de API que el probado. Frente a v2.13.0:

- **Añadido (activación explícita).** `v2.AdmitDelegatedBundleV2`, `v2.AdmitSignedBundleV2FromBytes`, `v2.CreateMandateAcknowledgment` y `v2.EvaluateDelegationActivationV2` ([registro de cambios](../../../CHANGELOG.md#unreleased)).
- **Cambio de aceptación.** P-ED-1 en la verificación de objetos V1 y en el proveedor Ed25519 V2 predeterminado.
- **Corrección.** El proveedor SLH-DSA-192f lee las claves sin pánico. `SDKVersion` es `2.14.0`.

<a id="related-releases"></a>

## Publicaciones relacionadas

Las versiones actuales en cada registro están en [Versiones publicadas](../../../docs/README.md#published-versions). Otras notas de publicación: [paquetes npm](../../../docs/NPM_RELEASES.md), [Python 2.11.0](../../../docs/PYTHON_RELEASE.md) y [Rust 2.14.0](../../../docs/RUST_RELEASE.md).
