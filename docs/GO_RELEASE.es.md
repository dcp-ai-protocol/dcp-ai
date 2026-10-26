<a id="published-go-module"></a>

# Módulo Go publicado

> Traducción informativa de [la versión en inglés](GO_RELEASE.md), actualizada el 26/10/2026. Si difieren, prevalece la versión en inglés.

Verificado el 26/10/2026: el SDK Go `v2.11.0` está publicado mediante la [etiqueta `sdks/go/v2.11.0`](https://github.com/dcp-ai-protocol/dcp-ai/tree/sdks/go/v2.11.0/sdks/go). El módulo y sus importaciones conservan `/v2`. La versión del SDK es independiente del formato/especificación DCP. Go no requiere un token de registro adicional: los consumidores resuelven la etiqueta del repositorio mediante el sistema de módulos Go.

<a id="install"></a>

## Instalar

Requiere Go 1.25+. Ejecuta desde el módulo de tu aplicación. Actualiza y guarda sus archivos `go.mod` y `go.sum`:

```bash
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.11.0
go mod verify
```

<a id="upgrade-and-compatibility"></a>

## Actualización y compatibilidad

Incluye gestión de errores de longitud de clave V1, verificación corregida de principal/claves/artefactos/checkpoints V2, confianza explícita en el principal y `strict-v1`, cadenas de delegación y sesiones A2A concurrentes con protección frente a replay. La telemetría del SDK informa `2.11.0`. Véanse el [README del SDK](../sdks/go/README.md), la [guía de admisión](ADMISSION.md) y la [política de seguridad](../SECURITY.md).

La verificación es más estricta que en v2.10.0: puede rechazarse evidencia malformada o inconsistente antes aceptada. Conserva la evidencia histórica sin reescribirla. `dcp-jcs-v1` sigue siendo el predeterminado normativo; las API `dcp-jcs-v2` siguen experimentales, no normativas y opt-in explícito. Verificación no equivale a confianza en el principal, admisión ni autorización. La cadena secundaria de auditoría SHA3-256 opcional sigue fuera de las comprobaciones documentadas del verificador.

<a id="validation"></a>

## Validación

La suite predeterminada y la suite `-race -tags otlp` pasaron 1.154 pruebas/subpruebas cada una; una prueba se reserva intencionalmente para la matriz en vivo de productores/consumidores. Pasaron `go mod tidy -diff`, compilación y vet. Un consumidor externo pasó 137 pruebas/subpruebas y su control negativo falló como debía. El módulo publicado se descargó en una caché nueva mediante el proxy público y verificación de checksums; sus fuentes coincidieron con el commit revisado. Después, el consumidor pasó sin ninguna directiva `replace` local. La publicación Rust sigue pendiente por separado; esta versión Go no vuelve a publicar npm, Python ni contenedores.
