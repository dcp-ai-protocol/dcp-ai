<a id="published-python-package"></a>

# Paquete Python publicado

> Traducción informativa de [la versión en inglés](../../../docs/PYTHON_RELEASE.md), actualizada el 05/11/2026. Si difieren, prevalece la versión en inglés.

Verificado el 05/11/2026: [`dcp-ai` 2.10.2](https://pypi.org/project/dcp-ai/2.10.2/) está disponible en PyPI ([qué cambió](#what-changed-in-2102)). La versión de este paquete Python es independiente de la versión del formato/especificación DCP. El paquete Python se publica de forma independiente de Go, Rust, los paquetes npm y los contenedores. Las publicaciones anteriores, [2.10.1](https://pypi.org/project/dcp-ai/2.10.1/), verificada el 28/10/2026, y [2.10.0](https://pypi.org/project/dcp-ai/2.10.0/), verificada el 26/10/2026, conservan sus notas abajo.

<a id="install"></a>

## Instalar

Requiere Python 3.10 o posterior. Actualiza tu entorno o archivo de bloqueo. Los extras opcionales de integración siguen separados del núcleo del protocolo:

```bash
pip install --upgrade "dcp-ai>=2.10.2,<3"
pip install "dcp-ai[fastapi]>=2.10.2,<3"
pip install "dcp-ai[langchain]>=2.10.2,<3"
pip install "dcp-ai[openai]>=2.10.2,<3"
pip install "dcp-ai[crewai]>=2.10.2,<3"
pip install "dcp-ai[otlp]>=2.10.2,<3"
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

Para la 2.10.2, el wheel y la distribución de código fuente que el workflow de publicación publicó en PyPI desde `main` (`46b142bd`) contienen los mismos archivos, byte a byte, que los artefactos probados antes de la publicación. Instalaciones nuevas desde PyPI del wheel y de la distribución de código fuente, fuera del checkout, superaron cada una el kit de conformidad externo (697 casos en siete catálogos) y las comprobaciones de la 2.10.2 sobre el conjunto de IDs revocados y el instante de verificación; los archivos del paquete instalados desde la distribución de código fuente son, byte a byte, los del wheel probado.

`dcp-jcs-v1` sigue siendo el único predeterminado normativo. `dcp-jcs-v2` sigue siendo experimental, no normativo y opt-in explícito. Verificación, confianza, admisión y autorización son distintas; instalar esta versión no configura tu política de confianza. La verificación más estricta puede rechazar evidencia aceptada por 2.9.0. Conserva la evidencia histórica sin reescribirla.

Para la 2.10.1, el wheel y la distribución fuente publicados en PyPI por el flujo de publicación son idénticos byte a byte a los artefactos revisados antes de publicar, y se confirmaron sus checksums en el registro. Antes de publicar, esos artefactos, instalados en entornos nuevos fuera del checkout, pasaron los vectores secundarios SHA3-256 compartidos (103 pruebas cada uno) y una suite de consumidor independiente (86 pruebas cada uno).

Tras publicar, instalaciones nuevas desde PyPI del wheel y de la distribución fuente pasaron las 86 comprobaciones independientes cada una; el wheel del registro también pasó las 103 pruebas de vectores compartidos.

Para la 2.10.0 (26/10/2026), el wheel instalado pasó 1.866 pruebas en Python 3.12; la distribución fuente instalada pasó 1.863 pruebas en Python 3.10 con tres omisiones esperadas de fábricas de tareas exclusivas de Python 3.12. Ambas distribuciones pasaron los controles de metadatos y coincidieron en los 59 módulos fuente Python. CI cubre Python 3.10 y 3.12.

La dependencia ML-DSA puede lanzar `ValueError` si agota sus intentos acotados de firma. Un fixture de CI encontró este fallo al crear una firma; no se eludió la verificación. Los llamadores deben tratar el fallo como un error, nunca como evidencia firmada.

<a id="what-changed-in-2102"></a>

## Qué cambió en 2.10.2

La 2.10.2 se publicó en PyPI el 05/11/2026 mediante el workflow de publicación, desde `main` (`46b142bd`). Frente a 2.10.1, la 2.10.2:

- **Ejecuta la validación de esquemas V2-2 (cambio de aceptación).** `verify_signed_bundle_v2` y las demás funciones de verificación V2, y por tanto el middleware de FastAPI y los puentes, validan el sobre del bundle firmado y los cuatro payloads contra `schemas/v2` antes de cualquier comprobación de hash, clave o firma. Los bundles inválidos por esquema que antes se aceptaban ahora fallan con diagnósticos `schema: <pointer> <keyword>`.
- **Alinea las comprobaciones de mandatos.** `verify_mandate_validity` aplica un único contrato y devuelve un resultado en lugar de lanzar una excepción; `now=` debe ser un `datetime` con zona horaria. Los IDs revocados, anotados como `set[str]`, ahora se comprueban como `collections.abc.Set` (un `set`, un `frozenset` o una vista de claves de un dict): una lista o una cadena, toleradas antes, se rechazan. `verify_mandate_chain` lee todos los instantes de la misma manera y rechaza un mandato raíz que repite un dominio.

No cambian el formato de transmisión, las firmas, los perfiles, `dcp-jcs-v1` como valor predeterminado normativo ni las API experimentales de activación explícita `dcp-jcs-v2`, y el wheel y el sdist incluyen ahora el `LICENSE` Apache-2.0. Conserva la evidencia histórica en lugar de reescribirla. El README del wheel y del sdist publicados es el que se preparó antes de la publicación y dice «prepared, not published»; los archivos publicados no pueden cambiar. Véanse el [README del SDK](../../../sdks/python/README.md) y el [changelog](../../../CHANGELOG.md#unreleased).

<a id="related-releases"></a>

## Publicaciones relacionadas

Las versiones actuales en cada registro están en [Versiones publicadas](../../../docs/README.md#published-versions). Otras notas de publicación: [paquetes npm](../../../docs/NPM_RELEASES.md), [Go v2.13.0](../../../docs/GO_RELEASE.md) y [Rust 2.13.0](../../../docs/RUST_RELEASE.md).
