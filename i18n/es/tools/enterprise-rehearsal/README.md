<sub>[English](../../../../tools/enterprise-rehearsal/README.md) · [中文](../../../zh-CN/tools/enterprise-rehearsal/README.md) · **Español** · [日本語](../../../ja/tools/enterprise-rehearsal/README.md) · [Português](../../../pt-BR/tools/enterprise-rehearsal/README.md)</sub>

<a id="enterprise-integration-rehearsal"></a>

# Ensayo de integración empresarial

> Traducción informativa de [la versión en inglés](../../../../tools/enterprise-rehearsal/README.md), actualizada el 08/11/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Esta aplicación opcional y sintética ejercita DCP con paquetes instalados y HTTP real en loopback. Está fuera del núcleo del protocolo, los SDK y los adaptadores de producción. **Verificación, admisión, activación de delegaciones y autorización de aplicación son decisiones separadas.** Una firma válida no autoriza una acción ni garantiza una ejecución única.

El ensayo usa TypeScript/Express y Python/FastAPI. La admisión directa usa los adaptadores instalados; la admisión delegada y la activación usan las API públicas de los SDK dentro de la aplicación. No se afirma que los adaptadores implementen la composición de delegaciones. La interoperabilidad Go/Rust corresponde al [kit de conformidad](../conformance/README.md); WASM no expone cadenas de delegación compuestas.

<a id="prerequisites"></a>

## Prerrequisitos

Probado en macOS arm64 con Node 22.15.0, npm 11.3.0 y CPython 3.12.2. Se necesitan Git, soporte de venv de Python, grupos de procesos POSIX, `/bin/ps` y acceso a los registros públicos npm/PyPI. Otras plataformas requieren validación. No se necesitan credenciales de cuenta, datos de principales reales, servicios en ejecución ni paquetes de desarrollo publicados.

Usa un checkout que contenga este kit y las API necesarias de los SDK. Las fuentes de los paquetes no deben tener modificaciones en archivos versionados. La fuente de paquetes revisada fue el commit `b3d41bd062ce035b537f8d3acd3e96e5b2ce310c`; el kit es una entrega adicional de código fuente. Las versiones por sí solas no identifican estas compilaciones: registra el commit fuente y los hashes de los artefactos. No supongas que las versiones ya publicadas contienen los cambios que se prueban aquí.

<a id="prepare-and-install"></a>

## Preparar e instalar

Ejecuta los siguientes bloques en la misma shell, desde la raíz del repositorio. Cada subdirectorio de salida debe ser nuevo. El directorio temporal padre se resuelve físicamente para evitar alias de plataforma como `/tmp`.

```sh
MP05_ROOT="$(pwd -P)"
MP05_TMP="$(mktemp -d)"
MP05_TMP="$(cd "$MP05_TMP" && pwd -P)"
python3 tools/enterprise-rehearsal/prepare.py \
  --source "$MP05_ROOT" --revision "$(git rev-parse HEAD)" \
  --work "$MP05_TMP/build"
python3 tools/enterprise-rehearsal/install.py \
  --manifest "$MP05_TMP/build/artifacts.json" \
  --work "$MP05_TMP/consumer"
```

`prepare.py` exporta desde Git los tres directorios de paquetes, construye tarballs de TypeScript y Express, además de wheel/sdist de Python, y registra fuentes, herramientas, comandos y hashes. No modifica las fuentes de los paquetes ni publica nada. El lock de Express descarga primero su dependencia SDK 2.2.0 publicada; el script la reemplaza por el tarball local del SDK y comprueba su contenido **antes de compilar**. Al empaquetar conserva los manifiestos y locks originales.

`install.py` crea consumidores aislados. Las dependencias de terceros de Node quedan fijadas por el lock del kit; solo cambian los valores de integridad de los tarballs locales. Las dependencias de terceros y herramientas de construcción de Python tienen locks de versiones/hashes; DCP se instala desde el wheel local con `--no-deps`. Los locks incluyen hashes de wheels del registro, pero su disponibilidad en otras plataformas requiere validación. No se usan instalaciones editables ni imports del SDK desde el checkout.

<a id="run-the-rehearsal"></a>

## Ejecutar el ensayo

```sh
node tools/enterprise-rehearsal/node/rehearse.mjs \
  --manifest "$MP05_TMP/build/artifacts.json" \
  --consumer "$MP05_TMP/consumer" --work "$MP05_TMP/run"
```

El lanzador ejecuta primero la guarda de instalación sin conexión: hashes de artefactos/contenido, locks, resolución de imports, copias anidadas del SDK, rutas/distribuciones de Python y API necesarias. Luego copia el kit al consumidor Node con un inventario de hashes `STAGED.json`. Python usa el intérprete del consumidor con `-I`. Los servidores comprueban ese inventario, el origen del SDK y el registro de la guarda; no repiten una auditoría completa de instalación en cada petición. Estas comprobaciones no auditan todas las dependencias de terceros.

El lanzador controla el runner y los servidores mediante IPC, de modo que un runner bloqueado no impide la limpieza gestionada. Los servidores escuchan únicamente en `127.0.0.1`, en puertos efímeros. Hay un plazo de 900 segundos para el runner, timeouts de 10 segundos por petición y una comprobación de 60 segundos transcurridos al terminar cada grupo; esta comprobación **no** es un plazo duro de cancelación. Durante el ensayo no se contactan endpoints de aplicaciones remotas.

La salida `0` exige completar el plan seleccionado, obtener los resultados esperados, aprobar el escaneo de secretos y cerrar limpiamente. Los errores, observaciones ausentes, códigos inesperados, efectos adicionales, procesos retenidos o fallos de limpieza hacen fallar el comando. Cada invocación exige un directorio de trabajo nuevo; un reporte exitoso anterior no satisface una nueva ejecución. `--lanes node` o `--lanes python` selecciona un subconjunto de diagnóstico, no la aceptación completa de ambos carriles.

<a id="scenarios-and-expected-decisions"></a>

## Escenarios y decisiones esperadas

El plan completo tiene 100 pasos por carril, 200 en total. Las expectativas se escriben antes de las peticiones e incluyen estado HTTP, códigos DCP/de aplicación, tenant autenticado, resultados DCP reales, llamadas a fuentes, reservas y efectos. Cada grupo incluye controles positivos y negativos.

| Grupo | Qué se ejercita |
|---|---|
| G1 | Incorporación del principal con huella recibida fuera de banda; rechazo de huellas incorrectas y documentos de claves alterados |
| G2 | Admisión directa, expiración de sesión, audiencia, acción de aplicación y argumentos firmados |
| G3 | Tenant obtenido de un bearer sintético; otro tenant, confianza ausente, cabeceras falsificadas y campos extra del sobre |
| G4 | Retirada y restauración de confianza sin reiniciar |
| G5 | Agente/clave revocados, lista de denegación no disponible o realmente antigua, fecha mal formada y restauración |
| G6 | Rotación de claves de principal/agente, solapamiento y retirada; mandatos y acuses reemitidos |
| G7 | Composición y activación de delegaciones, revocación/ventanas temporales de mandatos, acuses ausentes o incorrectos y fallo independiente de la lista de mandatos |
| G8 | Política de aplicación intersectada con cada mandato; acción, dominio, clases de datos, límites y argumentos firmados |
| G9 | Reserva local de un solo uso, replay con otro ID de petición/serialización y ocho peticiones HTTP concurrentes |
| G10 | Ingreso desde bytes en ambas rutas: claves duplicadas a varias profundidades, formas numéricas, Unicode/UTF-8 y presupuestos de cuerpo declarados y durante recepción |

Con evidencia admitida/activa, el resultado real de DCP sigue teniendo `action_authorized=false`. La aplicación devuelve por separado `application_authorized` y registra su efecto. Un acuse ausente puede dejar la evidencia admitida, pero la delegación inactiva; no se produce ningún efecto. Una lista antigua se sirve con su fecha original, sin renovarla silenciosamente al recibirla. El operador publica explícitamente instantáneas frescas.

La aplicación autentica el tenant, selecciona su conjunto de confianza fuera de banda y acepta el bundle solo en el cuerpo JSON. Rechaza `X-DCP-Bundle` para evitar autorizar un cuerpo distinto de la evidencia admitida mediante una cabecera. Es una decisión del kit, no una eliminación del soporte de cabeceras de los adaptadores. Los campos desconocidos del sobre se rechazan antes de llamar a fuentes; ese rechazo no demuestra por sí solo un fallo de confianza en el SDK.

<a id="evidence-and-retention"></a>

## Evidencia y retención

Conserva `build/artifacts.json`, `consumer/installed.json` y `run/verify.json`, `stage.json`, `supervision.json`, además de `run-*/report.json`/`plan.json` de la nueva ejecución. La evidencia por carril registra observaciones, consultas a fuentes, reservas y efectos. Los reportes contienen rutas locales del sistema de archivos. Conserva la fuente del kit o sus hashes junto al commit de los paquetes; las versiones de los artefactos pueden coincidir con las del registro y contener fuentes diferentes.

Los fixtures generan claves privadas y bearer tokens **TEST ONLY** en directorios restringidos. El runner busca en la evidencia representaciones conocidas en bytes/hex/base64 y luego elimina sus directorios de secretos. El supervisor externo también escanea y elimina los secretos que deje un runner terminado forzosamente, dentro de su nuevo directorio de trabajo. Conserva la evidencia y rechaza borrar mediante enlaces que salgan de ese directorio. El escáner no es DLP de propósito general. Nunca sustituyas los datos de prueba por claves, tokens o datos personales reales.

Se cubren timeouts e interrupciones gestionadas; un `SIGKILL` al propio lanzador, una pérdida de energía o la manipulación concurrente del sistema de archivos impiden garantizar la limpieza. Tras una interrupción así, inspecciona el directorio de trabajo y elimina los secretos sintéticos restantes según tu política de retención. El ensayo HTTP elimina sus directorios de secretos. Las pruebas enfocadas de fixtures que aparecen abajo conservan material TEST ONLY bajo `$MP05_TMP/helper-tests` hasta ejecutar su último comando de limpieza.

<a id="focused-tests"></a>

## Pruebas enfocadas

Estos controles usan fixtures temporales y consumidores instalados. Los dos primeros comandos cubren fallos de preparación y alteraciones de la instalación; las alteraciones solo ocurren en una copia desechable. Un SDK sintético sin API se rechaza por su contenido antes de ejecutarlo, no únicamente por una comprobación de API.

```sh
python3 -B -m unittest discover -s tools/enterprise-rehearsal -p test_prepare.py -v
python3 tools/enterprise-rehearsal/negative_controls.py \
  --manifest "$MP05_TMP/build/artifacts.json" --work "$MP05_TMP/consumer"
node --test tools/enterprise-rehearsal/process.test.mjs tools/enterprise-rehearsal/secrets.test.mjs
REHEARSAL_PYTHON="$MP05_TMP/consumer/python/bin/python" \
REHEARSAL_WORK="$MP05_TMP/helper-tests" \
  node --test "$MP05_TMP/consumer/node/rehearsal/node/test/"*.test.mjs
"$MP05_TMP/consumer/python/bin/python" -I -m unittest discover \
  -s "$MP05_TMP/consumer/node/rehearsal/python" -p 'test_*.py' -v
rm -rf -- "$MP05_TMP/helper-tests"
```

El corpus de ingreso crudo también se ejecuta independientemente de HTTP. Copia estos helpers de prueba junto a los paquetes Node instalados; no los ejecutes contra un SDK del checkout.

```sh
mkdir "$MP05_TMP/consumer/node/ingress-controls"
for name in ingress-node.mjs ingress_python.py ingress-cases.json test-ingress.mjs test_ingress.py; do
  cp "$MP05_ROOT/tools/enterprise-rehearsal/$name" "$MP05_TMP/consumer/node/ingress-controls/$name"
done
node "$MP05_TMP/consumer/node/ingress-controls/test-ingress.mjs" \
  "$MP05_TMP/consumer/node/ingress-controls/ingress-cases.json"
"$MP05_TMP/consumer/python/bin/python" -I \
  "$MP05_TMP/consumer/node/ingress-controls/test_ingress.py" \
  "$MP05_TMP/consumer/node/ingress-controls/ingress-cases.json"
```

Los controles del runner rechazan expectativas invertidas, observaciones/grupos ausentes, duplicados, errores de infraestructura y reutilización de reportes viejos. Los controles del supervisor cubren runners bloqueados/terminados abruptamente, servidores no cooperativos, peticiones mal formadas, fallos de arranque, fallos al consultar procesos y secretos restantes, junto con una ejecución positiva limpia.

<a id="boundaries-for-a-real-integration"></a>

## Límites para una integración real

- **Protocolo:** evidencia de identidad, verificación, admisión y activación opt-in. `dcp-jcs-v1` permanece intacto. La aplicación reutiliza el scanner experimental para su política de ingreso de bytes; no activa un perfil nuevo de canonicalización.
- **Adaptadores:** admisión directa strict-v1 con presupuestos opt-in de cuerpo/fuentes, cancelación y supervisión por tenant. Las rutas delegadas usan fuentes HTTP acotadas propias de la aplicación; no demuestran los cupos de fuentes de los adaptadores para cadenas compuestas.
- **Aplicación:** autenticación del tenant, administración de confianza, política de acción/argumentos y ledger local. La semántica de SKU, moneda y `max_amount` pertenece a la aplicación; la atenuación entre mandatos sigue siendo una regla del protocolo.
- **Operador:** incorporación real, autenticación, TLS, custodia de claves/HSM/KMS, publicación de revocaciones, retención y controles de despliegue. Los bearers/huellas sintéticos no son OIDC, una PKI humana ni prueba de que un agente esté conectado. Loopback no es una prueba de TLS de producción.
- **Ledger:** la reserva local atómica permite como mucho un intento. No garantiza ejecución exactamente una vez, una transacción con un servicio externo, coordinación distribuida ni durabilidad física tras un crash. Los cambios administrativos se serializan. Ocho peticiones HTTP concurrentes no implican ocho verificaciones criptográficas paralelas; los timeouts de fuentes no cancelan criptografía síncrona.

El ensayo revisado pasó 200/200 pasos en una copia independiente que solo contenía archivos públicos, con cuatro servidores cerrados limpiamente y secretos sintéticos eliminados. Los cuatro artefactos construidos independientemente fueron idénticos byte por byte a los de la primera preparación. Es evidencia de integración reproducible, no una certificación de preparación para producción ni una auditoría de seguridad externa. Consulta [admisión](../../docs/ADMISSION.md) y [límites operacionales](../../docs/OPERATIONAL_LIMITS.md) para conocer las fronteras soportadas. Publicar paquetes y validar un despliegue piloto son pasos separados.
