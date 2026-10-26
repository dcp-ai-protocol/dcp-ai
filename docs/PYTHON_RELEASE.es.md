<a id="published-python-package"></a>

# Paquete Python publicado

**Publicación Go (26/10/2026).** El SDK Go `v2.11.0` está disponible desde la etiqueta `sdks/go/v2.11.0`, incluidas las correcciones del verificador, admisión y API experimentales opt-in. La publicación Rust sigue siendo independiente. Véase [Go v2.11.0](GO_RELEASE.md).

> Traducción informativa de [la versión en inglés](PYTHON_RELEASE.md), actualizada el 26/10/2026. Si difieren, prevalece la versión en inglés.

Verificado el 26/10/2026: [`dcp-ai` 2.10.0](https://pypi.org/project/dcp-ai/2.10.0/) está disponible en PyPI. La versión de este paquete Python es independiente de la versión del formato/especificación DCP. Esta publicación no publica Go, Rust, paquetes npm ni contenedores.

<a id="install"></a>

## Instalar

Requiere Python 3.10 o posterior. Actualiza tu entorno o archivo de bloqueo. Los extras opcionales de integración siguen separados del núcleo del protocolo:

```bash
pip install --upgrade "dcp-ai>=2.10.0,<3"
pip install "dcp-ai[fastapi]>=2.10.0,<3"
pip install "dcp-ai[langchain]>=2.10.0,<3"
pip install "dcp-ai[openai]>=2.10.0,<3"
pip install "dcp-ai[crewai]>=2.10.0,<3"
pip install "dcp-ai[otlp]>=2.10.0,<3"
```

<a id="what-changed"></a>

## Qué cambió

Incluye las correcciones del verificador V2, confianza en el principal y `strict-v1`, plazos/cupos opt-in para fuentes, presupuestos de cuerpo y desconexión en FastAPI, correcciones de verificación en los puentes y las API experimentales de canonicalización. También corrige una carrera de cancelación de Python 3.10 en la espera del worker de la lista de revocación: cancelar una petición no debe liberar el cupo antes de que termine su worker.

FastAPI en 2.9.0 acepta bundles V2 con estructura válida sin verificar sus firmas. Actualiza a 2.10.0 antes de usarlo para verificar V2. Véanse [SECURITY](../SECURITY.md), [admisión](ADMISSION.md) y el [README del SDK Python](../sdks/python/README.md).

<a id="compatibility-and-verification"></a>

## Compatibilidad y verificación

`dcp-jcs-v1` sigue siendo el único predeterminado normativo. `dcp-jcs-v2` sigue siendo experimental, no normativo y opt-in explícito. Verificación, confianza, admisión y autorización son distintas; instalar esta versión no configura tu política de confianza. La verificación más estricta puede rechazar evidencia aceptada por 2.9.0. Conserva la evidencia histórica sin reescribirla.

El wheel instalado pasó 1.866 pruebas en Python 3.12; la distribución fuente instalada pasó 1.863 pruebas en Python 3.10 con tres omisiones esperadas de fábricas de tareas exclusivas de Python 3.12. Ambas distribuciones pasaron los controles de metadatos y coincidieron en los 59 módulos fuente Python. CI cubre Python 3.10 y 3.12.

La dependencia ML-DSA puede lanzar `ValueError` si agota sus intentos acotados de firma. Un fixture de CI encontró este fallo al crear una firma; no se eludió la verificación. Los llamadores deben tratar el fallo como un error, nunca como evidencia firmada.
