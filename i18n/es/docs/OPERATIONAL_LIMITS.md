<sub>[English](../../../docs/OPERATIONAL_LIMITS.md) · [中文](../../zh-CN/docs/OPERATIONAL_LIMITS.md) · **Español** · [日本語](../../ja/docs/OPERATIONAL_LIMITS.md) · [Português](../../pt-BR/docs/OPERATIONAL_LIMITS.md)</sub>

<a id="operational-limits"></a>

# Límites operacionales

> Traducción informativa de [la versión en inglés](../../../docs/OPERATIONAL_LIMITS.md), actualizada el 08/11/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Qué acota las entradas, las fuentes de confianza y de revocación, la concurrencia, la desconexión del cliente y la caché de veredictos de los SDK de TypeScript, Python, Go y Rust y de los adaptadores Express y FastAPI, y qué tienes que fijar tú como operador. Describe la fuente de este repositorio; un paquete publicado tiene lo que incluye su propia versión (véase [Versiones publicadas](../../../docs/README.md#published-versions)).

Nada de esta página cambia el formato de wire, `dcp-jcs-v1`, un perfil ni una firma. Cuatro capas fijan límites y se mantienen separadas:

- **El protocolo** fija longitudes por campo y las ventanas de frescura de strict-v1.
- **Los SDK** verifican, admiten y componen. Esas API no reciben plazo ni señal de cancelación; el helper de lista de denegación de Python tiene un plazo de descarga propio, separado de la criptografía.
- **Los adaptadores** añaden presupuestos, plazos, capacidad y cancelación, todos opcionales (opt-in).
- **Tú** eliges sus valores, el inquilino, la limitación de tasa y la infraestructura que va delante.

La [configuración de muestra](#a-sample-configuration) del final es un punto de partida, no un valor por defecto ni una regla.

<a id="who-sets-what"></a>

## Quién fija qué

| Límite | De dónde sale |
|---|---|
| Duración de la sesión y antigüedad del snapshot de revocación en strict-v1: como máximo 300 s | El [perfil de admisión](../../../docs/ADMISSION.md#the-strict-v1-profile) (normativo) |
| `sig_b64` de 66 476 caracteres como máximo, una clave pública de 3456 como máximo, `intended_verifier` de 256 como máximo | Los esquemas V2 (normativo, por campo) |
| Número de entradas de auditoría, checkpoints PQ, claves, principales de confianza, entradas de la lista de denegación, mandatos de una cadena, bundles de delegadores | Ningún límite de esquema ni de SDK: solo lo acota lo que tú dejas entrar. El coste de verificación crece con ellos |
| Profundidad de anidamiento | Ningún presupuesto común. El parser y la pila de cada runtime rechazan en su propio nivel; la API opcional `admitSignedBundleV2FromBytes` rechaza más de 64 niveles |
| Cuerpo de la petición | Express: el `limit` de tu parser de cuerpo. FastAPI: `max_body_bytes`, opcional y sin valor por defecto. Servidor de referencia: 1 MiB |
| Bundle en una cabecera | Los límites de cabecera de tu servidor y de cada proxy (el valor por defecto de Node es 16 KiB); `max_body_bytes` no cubre las cabeceras |
| Descarga de la lista de denegación | Los helpers de lista de denegación: 16 MiB como máximo, sin redirecciones, con un plazo que fijas tú |
| Plazos y capacidad de las fuentes | El supervisor de fuentes, opcional y sin capacidad por defecto |
| Caché de veredictos de Express | Desactivada por defecto (`cacheTtlSeconds` 0); como máximo `cacheMaxEntries` (1000 por defecto) cuando está activada |
| Inquilino | Tu propia autenticación, nunca una cabecera que elija el cliente |
| Tasa de peticiones | Tú (el ejemplo de Express usa `express-rate-limit`) |

<a id="inputs"></a>

## Entradas

- **Envía el bundle en el cuerpo**, con un presupuesto de cuerpo que se comprueba antes de parsear. Un bundle V2 típico con firmas híbridas es mayor que el límite de cabeceras por defecto de Node.
- **El presupuesto de cuerpo es un presupuesto de entrada que fijas tú.** Cada firma, entrada de auditoría y checkpoint PQ añade trabajo, y los esquemas no limitan cuántos hay. Junto con las cardinalidades que aceptas, tu política de verificación y la CPU y la concurrencia que permites fuera del adaptador, acota cuánto trabajo puede traer una petición. No es un plazo de CPU, y no acota las API que tu código llama con objetos construidos fuera de HTTP. Dimensiónalo para los bundles que esperas, no para el mayor posible.
- **Profundidad.** En el código actual y en las muestras locales de los mantenedores, un cuerpo más anidado de lo que el runtime admite se rechazó, no se admitió, en un sitio distinto en cada adaptador: Express informó de un fallo de verificación (`Malformed signed bundle: Maximum call stack size exceeded`); FastAPI respondió 403 `Missing DCP signed bundle`, porque no pudo leer el cuerpo como JSON. Los límites de profundidad varían entre runtimes y no forman parte del protocolo.

<a id="trust-and-revocation-sources"></a>

## Fuentes de confianza y de revocación

Cuando una fuente es lenta o nunca responde hay cuatro acciones distintas. Un adaptador puede hacer las tres primeras; solo la propia fuente puede hacer la cuarta.

1. **Dejar de esperar.** La petición recibe una respuesta de fallo.
2. **Rechazar el resultado tardío.** Un valor que llega después del plazo nunca se usa.
3. **Pedir la cancelación.** Se aborta una `AbortSignal` (Express) o se cancela la tarea (FastAPI).
4. **Detener el trabajo.** Solo lo hace una fuente que coopera.

**Con un supervisor de fuentes** (`sourceSupervisor` y `supervise`, o `source_supervisor` y `supervise`):

- Una fuente de confianza que no responde a tiempo da 503, y una fuente de revocación, 403 `REVOCATION_UNAVAILABLE`.
- El resultado tardío nunca se usa.
- El plazo se mide con un reloj monotónico, pero solo vence cuando el bucle de eventos está libre: una CPU ocupada o una fuente que bloquea el bucle retrasa la respuesta.
- El supervisor cuenta la invocación que posee hasta que esa invocación termina de verdad. Una fuente que ignora la cancelación conserva su plaza después de la respuesta, hasta que termina.
- El trabajo que una fuente lanza por su cuenta (hilos, procesos, tareas que no devuelve) el adaptador no lo cuenta ni lo acota.

**Sin supervisor:**

| Fuente | Express | FastAPI |
|---|---|---|
| Confianza | Sin plazo: la petición espera a la fuente | Sin plazo. Una fuente síncrona se ejecuta en el bucle de eventos y lo bloquea |
| Revocación | `revocationTimeoutMs`: la respuesta se envía, la fuente sigue en marcha y no se cuenta | `revocation_timeout` usa `asyncio.wait_for`, que espera a que la fuente termine de cancelarse. Una fuente que suprime la cancelación retrasa la respuesta, y su snapshot tardío se usa. Una fuente síncrona sigue en marcha en su hilo |

En producción, usa un supervisor. La opción antigua `checkRevocation` de Express no tiene plazo ni límite de tamaño, strict-v1 la rechaza, y queda fuera de esta guía.

**Listas de denegación:**

- **TypeScript.** El helper de Express `denyListRevocationSource` aborta su descarga al vencer su plazo o con la señal del supervisor, también mientras se lee el cuerpo.
- **Python.** El helper `deny_list_revocation_source` comprueba su plazo entre lecturas, así que no acota la resolución DNS ni una línea de estado y unas cabeceras que llegan despacio. Dale un presupuesto `DenyListWorkers`: acota los hilos de descarga, que son una reserva distinta de la plaza del supervisor. `DenyListWorkers` cuenta una descarga hasta que su fetch vuelve; su hilo puede tardar un instante más en terminar.
- **Go y Rust** no tienen fuente de lista de denegación: tú construyes el snapshot de revocación y se lo pasas a la admisión.

Cada invocación de un helper de lista de denegación vuelve a descargar la lista (una petición rechazada antes de la etapa de revocación no la descarga). Una lista grande descargada a la vez por muchas peticiones usa buffers y objetos para cada una: mantén las listas pequeñas. Si sirves snapshots desde una caché propia, mantenla por inquilino y dentro de la ventana de frescura del perfil: las reglas de admisión no cambian.

<a id="concurrency-and-tenants"></a>

## Concurrencia y inquilinos

- **La capacidad pertenece al objeto supervisor, no al proceso.** Comparte un supervisor para compartir una capacidad. Las fuentes de confianza y de revocación de una petición toman plazas del mismo supervisor.
- **Qué etapa rechaza primero depende de lo que se supervisa.** Con una función `trustedPrincipals` supervisada (como en la configuración de muestra, que supervisa ambas fuentes), una petición necesita primero una plaza de confianza: mientras las plazas están ocupadas, por llamadas de confianza o de revocación, una petición nueva se rechaza en la etapa de confianza con 503, antes de llamar a ninguna fuente. Con un conjunto de confianza estático y solo la fuente de revocación supervisada, no hay plaza de confianza que tomar, y una petición sin plaza libre se rechaza en la etapa de revocación con 403 `REVOCATION_UNAVAILABLE`.
- **Sin `maxInFlightPerTenant` / `max_in_flight_per_tenant`, no hay aislamiento entre inquilinos:** un inquilino puede ocupar todas las plazas.
- **El inquilino tiene que salir de tu autenticación.** Nunca lo tomes de una cabecera que fija el cliente.
- **La verificación usa la CPU.** En TypeScript y Python se ejecuta en el bucle de eventos; en Go y Rust, en el hilo de quien llama. Con concurrencia, las peticiones hacen cola para ella. La capacidad limita las fuentes, no la CPU ni la concurrencia HTTP: acótalas con tu limitación de tasa, tus workers y tu infraestructura.

<a id="client-disconnection"></a>

## Desconexión del cliente

Con `cancelOnDisconnect` (Express) o `cancel_on_disconnect` (FastAPI, que además necesita `max_body_bytes`):

- **Qué cuenta como irse.** El cliente se va de verdad cuando la respuesta se cierra antes de enviarse, o cuando la subida se corta. Express no toma como abandono el propio `close` de una petición después de su cuerpo.
- **Qué pasa.** Solo se cancela la invocación supervisada de la fuente de esa petición. No se hace nada más por ella: ni handler, ni escritura en la caché, ni `onFailure`, ni respuesta.
- **Qué no hace.** Una verificación que ya está en marcha no se interrumpe. Una fuente que ignora la cancelación conserva su plaza hasta que termina.

<a id="no-cancellation-in-the-sdks"></a>

## Sin cancelación en los SDK

Ninguna API de verificación, admisión o composición de los SDK (admisión delegada y activación incluidas) recibe un plazo, una `AbortSignal` ni un `context.Context`. El plazo de descarga del helper de lista de denegación de Python es aparte, y no se aplica a la criptografía:

- TypeScript y Python verifican en el bucle de eventos.
- Go y Rust son síncronos.
- WASM es síncrono.

Una verificación que empezó se ejecuta hasta el final. Acota su coste con el presupuesto de entrada, y su concurrencia fuera del SDK.

<a id="the-verdict-cache-express"></a>

## La caché de veredictos (Express)

- **Desactivada por defecto.** Mantenla desactivada salvo que tus propias mediciones lo justifiquen.
- **Qué guarda en la ruta de admisión** (`trustedPrincipals`, con o sin strict-v1): solo el resultado de la verificación criptográfica, bajo una clave hash; no el bundle, un snapshot ni ninguna autorización. La confianza del principal se evalúa en cada petición, esté en caché o no, y también las comprobaciones del perfil y la revocación cuando están configuradas. Un conjunto de confianza sin perfil no adquiere las comprobaciones de revocación de strict-v1.
- **En la ruta de solo verificación** (sin `trustedPrincipals`) guarda además el agente extraído y los identificadores de sus claves. Las comprobaciones de confianza y de perfil necesitan la ruta de admisión, que entonces deja de ser de solo verificación; `checkRevocation`, si está activada, se evalúa en cada petición.
- **La clave.** Cubre el bundle canónico, la política de verificación y el inquilino.
- **Caducidad y desalojo.** Una entrada caduca con su TTL, con la sesión del bundle o con sus claves. Cuando la caché está llena, se desaloja la entrada usada hace más tiempo.
- **Memoria.** La memoria del proceso no es solo la caché, y el tamaño del bundle no se traduce en el tamaño de una entrada.
- **Otros adaptadores y el SDK.** FastAPI no tiene caché. `VerificationCache` del SDK de TypeScript es una utilidad aparte que los adaptadores no usan.

<a id="delegation-in-the-adapters"></a>

## Delegación en los adaptadores

- **Dónde está la admisión delegada.** Los SDK de TypeScript, Python, Go y Rust ofrecen la admisión delegada (`admitDelegatedBundleV2` y sus equivalentes), la activación (`evaluateDelegationActivationV2`) y la admisión desde bytes (`admitSignedBundleV2FromBytes`).
- **Dónde no está.** WASM no las expone, y ningún adaptador las llama.
- **`mandateId` y `require_dcp_mandated`.** `req.dcpAgent.mandateId` de Express se copia del manifiesto del bundle y no verifica ninguna cadena de mandatos. `require_dcp_mandated` de FastAPI solo comprueba un `mandate_id` que el middleware nunca rellena para bundles V2, y tampoco verifica ninguna cadena.
- **Qué hace tu aplicación.** Llama ella misma a la API del SDK, acota la evidencia que acepta (longitud de la cadena, número de bundles de delegadores, bytes) y decide la autorización y la repetición.

<a id="other-surfaces"></a>

## Otras superficies

| Superficie | Límites |
|---|---|
| OpenClaw (`@dcp-ai/openclaw`) | El mismo plazo, la misma capacidad y el mismo helper de lista de denegación que Express. Su entrada es el objeto que el anfitrión ya parseó, sin presupuesto propio, y no tiene `cancelOnDisconnect` |
| Servidor de referencia (`/v2/admit`) | Cuerpos de 1 MiB como máximo. Un plazo de inactividad del socket de 30 s que responde 408 sin cancelar el trabajo. Revocación en 5000 ms por defecto, abortando la descarga. El archivo de confianza se lee en cada admisión. Estado en memoria, una sola instancia. Para reproducción, no para producción |
| CLI (`dcp-ai`) | Una invocación por proceso, sin plazo ni presupuesto propios: los tiene que imponer quien la llama |

<a id="a-sample-configuration"></a>

## Una configuración de muestra

Un punto de partida para un piloto, usado para ejercitar los adaptadores. **No es un valor por defecto, ni una recomendación para cualquier despliegue, ni parte del protocolo.** Dimensiona cada valor para tus bundles, tus fuentes y tu hardware.

| Ajuste | Valor de muestra |
|---|---|
| Presupuesto de cuerpo | 64 KiB (`limit` del parser en Express; `max_body_bytes=65536` en FastAPI) |
| Transporte | Cuerpo, no cabecera |
| Supervisor | 32 invocaciones a la vez, 8 por inquilino |
| Plazo de confianza | Express: `supervise.trustTimeoutMs: 2000` (milisegundos). FastAPI: `supervise={"trust_timeout": 2.0}` (segundos) |
| Plazo de revocación, supervisado | Express: `revocationTimeoutMs: 2000` con `supervise.revocation: true`. FastAPI: `revocation_timeout=2.0` con `supervise={"revocation": True}` |
| Descarga de la lista de denegación | Helper de Express: `timeoutMs: 1500`. Helper de Python: `timeout=1.5`. Dentro del plazo de revocación: pide a la descarga que termine antes, no garantiza que su trabajo termine |
| Descargas de Python a la vez | `DenyListWorkers(max_workers=8, max_workers_per_tenant=2)`: cuenta descargas activas, no el número exacto de hilos |
| Desconexión del cliente | Activada |
| Caché de veredictos de Express | Desactivada |
| Evidencia delegada (tu aplicación) | Como máximo 4 mandatos en una cadena, cada bundle dentro del presupuesto de cuerpo |

**Lo que esta página no afirma:**

- Cifras de capacidad, latencia o memoria para tu despliegue.
- La ausencia de fugas.
- La aceptación de evidencia más allá de lo que documenta cada API.

Mide en tu propio entorno.
