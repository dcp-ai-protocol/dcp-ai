<a id="published-python-package"></a>

# Paquete Python publicado

> Traducción informativa de [la versión en inglés](../../../docs/PYTHON_RELEASE.md), actualizada el 28/10/2026. Si difieren, prevalece la versión en inglés.

Verificado el 28/10/2026: [`dcp-ai` 2.10.1](https://pypi.org/project/dcp-ai/2.10.1/) está disponible en PyPI. La versión de este paquete Python es independiente de la versión del formato/especificación DCP. El paquete Python se publica de forma independiente de Go, Rust, los paquetes npm y los contenedores. La publicación anterior, [2.10.0](https://pypi.org/project/dcp-ai/2.10.0/), se verificó el 26/10/2026; sus notas se conservan abajo.

<a id="install"></a>

## Instalar

Requiere Python 3.10 o posterior. Actualiza tu entorno o archivo de bloqueo. Los extras opcionales de integración siguen separados del núcleo del protocolo:

```bash
pip install --upgrade "dcp-ai>=2.10.1,<3"
pip install "dcp-ai[fastapi]>=2.10.1,<3"
pip install "dcp-ai[langchain]>=2.10.1,<3"
pip install "dcp-ai[openai]>=2.10.1,<3"
pip install "dcp-ai[crewai]>=2.10.1,<3"
pip install "dcp-ai[otlp]>=2.10.1,<3"
```

<a id="what-changed-in-2101"></a>

## Qué cambió en 2.10.1

Verifica los campos secundarios SHA3-256 de [VERIFICATION.md V2-11](../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) cuando están presentes: `audit_merkle_root_secondary` (el árbol SHA3-256 construido como el primario; `sha3-256:` seguido de 64 ceros para una traza vacía), cada `prev_hash_secondary` (`"GENESIS"` en la primera entrada y, después, el SHA3-256 de la entrada anterior tal como figura) y cada `intent_hash_secondary` (el SHA3-256 del payload de la intención). Los campos ausentes no se exigen, así que un bundle verificado puede no tener una cadena secundaria completa. Un campo presente que sea `null`, no sea una cadena o sea incoherente se rechaza: es un cambio de aceptación para la evidencia que lleva esos campos, que 2.10.0 aceptaba. No cambian las API, los campos de resultado, `dcp-jcs-v1`, las API experimentales opt-in de `dcp-jcs-v2` ni el tratamiento de `hash_alg`. La verificación sigue sin ser confianza en el principal, admisión ni autorización.

<a id="what-changed"></a>

## Qué cambió

Lo que cambió en 2.10.0 (26/10/2026), que la 2.10.1 conserva:

Incluye las correcciones del verificador V2, confianza en el principal y `strict-v1`, plazos/cupos opt-in para fuentes, presupuestos de cuerpo y desconexión en FastAPI, correcciones de verificación en los puentes y las API experimentales de canonicalización. También corrige una carrera de cancelación de Python 3.10 en la espera del worker de la lista de revocación: cancelar una petición no debe liberar el cupo antes de que termine su worker.

FastAPI en 2.9.0 acepta bundles V2 con estructura válida sin verificar sus firmas. Actualiza a 2.10.0 antes de usarlo para verificar V2. Véanse [SECURITY](../../../SECURITY.md), [admisión](../../../docs/ADMISSION.md) y el [README del SDK Python](../../../sdks/python/README.md).

<a id="compatibility-and-verification"></a>

## Compatibilidad y verificación

`dcp-jcs-v1` sigue siendo el único predeterminado normativo. `dcp-jcs-v2` sigue siendo experimental, no normativo y opt-in explícito. Verificación, confianza, admisión y autorización son distintas; instalar esta versión no configura tu política de confianza. La verificación más estricta puede rechazar evidencia aceptada por 2.9.0. Conserva la evidencia histórica sin reescribirla.

Para la 2.10.1, el wheel y la distribución fuente publicados en PyPI por el flujo de publicación son idénticos byte a byte a los artefactos revisados antes de publicar, y se confirmaron sus checksums en el registro. Antes de publicar, esos artefactos, instalados en entornos nuevos fuera del checkout, pasaron los vectores secundarios SHA3-256 compartidos (103 pruebas cada uno) y una suite de consumidor independiente (86 pruebas cada uno).

Tras publicar, instalaciones nuevas desde PyPI del wheel y de la distribución fuente pasaron las 86 comprobaciones independientes cada una; el wheel del registro también pasó las 103 pruebas de vectores compartidos.

Para la 2.10.0 (26/10/2026), el wheel instalado pasó 1.866 pruebas en Python 3.12; la distribución fuente instalada pasó 1.863 pruebas en Python 3.10 con tres omisiones esperadas de fábricas de tareas exclusivas de Python 3.12. Ambas distribuciones pasaron los controles de metadatos y coincidieron en los 59 módulos fuente Python. CI cubre Python 3.10 y 3.12.

La dependencia ML-DSA puede lanzar `ValueError` si agota sus intentos acotados de firma. Un fixture de CI encontró este fallo al crear una firma; no se eludió la verificación. Los llamadores deben tratar el fallo como un error, nunca como evidencia firmada.

<a id="related-releases"></a>

## Publicaciones relacionadas

Las versiones actuales en cada registro están en [Versiones publicadas](../../../docs/README.md#published-versions). Otras notas de publicación: [paquetes npm](../../../docs/NPM_RELEASES.md), [Go v2.11.1](../../../docs/GO_RELEASE.md) y [Rust 2.11.1](../../../docs/RUST_RELEASE.md).
