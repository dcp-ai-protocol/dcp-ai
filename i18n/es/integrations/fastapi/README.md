<sub>[English](../../../../integrations/fastapi/README.md) · [中文](../../../zh-CN/integrations/fastapi/README.md) · **Español** · [日本語](../../../ja/integrations/fastapi/README.md) · [Português](../../../pt-BR/integrations/fastapi/README.md)</sub>

<a id="dcp_aifastapi--fastapi-middleware"></a>
<a id="dcp_aifastapi-fastapi-middleware"></a>

# dcp_ai.fastapi — middleware para FastAPI

> Traducción informativa de [la versión en inglés](../../../../integrations/fastapi/README.md), actualizada el 28/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Middleware de verificación de DCP para FastAPI. Verifica automáticamente los Signed Bundles y proporciona inyección de dependencias para las rutas protegidas.

<a id="supported-dcp-specifications"></a>

## Especificaciones de DCP admitidas

De DCP-01 a DCP-09, de forma parcial: la verificación de bundles y la admisión tal como se describen abajo, y algunos campos de DCP-05 y DCP-09 (`lifecycle_state`, `mandate_id`); no es una implementación completa de esas especificaciones.

<a id="installation"></a>

## Instalación

**Publicado en PyPI (26/10/2026).** `dcp-ai` 2.10.0 incluye la implementación descrita aquí. Actualiza desde 2.9.0 y renueva tu entorno o archivo de bloqueo. Véanse las [notas de Python](../../../../docs/PYTHON_RELEASE.md).

La versión 2.9.0 no verifica las firmas V2; no la uses para verificar V2. La 2.10.0 incluye el verificador corregido, confianza en el principal, `strict-v1`, presupuestos de cuerpo, supervisión de fuentes de confianza/revocación y gestión de desconexiones. La admisión no autoriza una acción.

```bash
pip install "dcp-ai[fastapi]>=2.10.1,<3"
```

Para desarrollar desde el código fuente:

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
pip install -e "/path/to/dcp-ai/sdks/python[fastapi]"
```

<a id="quickstart"></a>

## Inicio rápido

```python
from fastapi import FastAPI, Depends
from dcp_ai.fastapi import DCPVerifyMiddleware, require_dcp, DCPAgentContext

app = FastAPI()

# Add verification middleware
app.add_middleware(DCPVerifyMiddleware, require_bundle=False)

# Public route (no bundle required)
@app.get("/health")
async def health():
    return {"ok": True}

# Protected route (requires a verified bundle)
@app.post("/api/action")
async def agent_action(agent: DCPAgentContext = Depends(require_dcp)):
    return {
        "agent_id": agent.agent_id,
        "human_id": agent.human_id,
        "capabilities": agent.capabilities,
        "risk_tier": agent.risk_tier,
    }
```

<a id="sending-a-bundle"></a>

### Enviar un bundle

Un bundle V2 híbrido ocupa unos 33 KB, más que los límites de cabeceras de la mayoría de servidores y proxies: envíalo en el cuerpo JSON. La cabecera es para los bundles que caben en todos los límites del camino. La petición con cuerpo de abajo es una plantilla: `{...}` representa un bundle firmado real.

```bash
# Via header
curl -X POST http://localhost:8000/api/action \
  -H "Content-Type: application/json" \
  -H "x-dcp-bundle: $(cat signed_bundle.json)" \
  -d '{}'

# Via JSON body
curl -X POST http://localhost:8000/api/action \
  -H "Content-Type: application/json" \
  -d '{"signed_bundle": {...}}'
```

<a id="api-reference"></a>

## Referencia de la API

### `DCPVerifyMiddleware`

Middleware de Starlette/FastAPI que intercepta las peticiones y verifica los bundles de DCP.

```python
app.add_middleware(
    DCPVerifyMiddleware,
    require_bundle=False,       # If True, rejects requests without a bundle
    header_name="x-dcp-bundle", # Header where the bundle is sent
    verifier_policy={"default_mode": "hybrid_required"},  # Optional, over DEFAULT_VERIFIER_POLICY
)
```

<a id="constructor-parameters"></a>

#### Parámetros del constructor

| Parámetro | Tipo | Valor por defecto | Descripción |
|-----------|------|---------|-------------|
| `app` | `Any` | (obligatorio) | Aplicación ASGI |
| `require_bundle` | `bool` | `False` | Rechaza con 403 las peticiones sin bundle |
| `header_name` | `str` | `"x-dcp-bundle"` | Nombre de la cabecera HTTP |
| `verifier_policy` | `dict \| VerifierPolicy \| None` | `None` | Política del verificador. Un dict fija campos de `VerifierPolicy` sobre `DEFAULT_VERIFIER_POLICY`: un `default_mode` sin `risk_overrides` se aplica a todos los niveles de riesgo, un dict `risk_overrides` fija sus niveles por encima de los demás y `risk_overrides=None` conserva los niveles por defecto. Un `VerifierPolicy` se vuelve a validar, y un nivel de riesgo que su `risk_overrides` deja fuera (todos cuando es `None`) recibe su `default_mode`, tal como lo resuelve el verificador V2. Los campos, niveles de riesgo o modos desconocidos lanzan una excepción al construir el middleware. |
| `dcp_version` | `str` | `"2.0"` | Se guarda, pero no se impone. Que se acepten los bundles V1 depende de `verifier_policy` (véase abajo); `require_dcp_v2` restringe una ruta a V2. |
| `trusted_principals` | `dict \| callable \| None` | `None` | Solo por nombre. Los principales en los que confías y sus claves: un conjunto de confianza (`schemas/v2/principal_trust_set.schema.json`, validado al construir el middleware), o `(tenant) -> trust set` (síncrona o asíncrona) llamada en cada petición. Con él, solo los bundles V2 admitidos llegan a la ruta, y se exige `require_bundle=True` (véase [Principales de confianza y strict-v1](#trusted-principals-and-strict-v1)). |
| `profile` | `dict \| None` | `None` | Solo por nombre. El perfil strict-v1 (`schemas/v2/admission_profile.schema.json`), cargado al construir el middleware. Necesita `trusted_principals` y `revocation_source`; fija él mismo la política del verificador. |
| `revocation_source` | `callable \| None` | `None` | Solo por nombre, con `profile`. `(subjects, tenant) -> revocation snapshot \| None`, síncrona (se ejecuta en un hilo de trabajo) o asíncrona, llamada en cada admisión de un bundle verificado. `deny_list_revocation_source(url)` construye una. |
| `revocation_timeout` | `float` | `5.0` | Solo por nombre. Segundos que tiene la fuente de revocación para responder. Con `{"revocation": True}`, el plazo supervisado: más de 0 y hasta 2147483.647. |
| `tenant` | `callable \| None` | `None` | Solo por nombre. `(request) -> str`, síncrona o asíncrona, de tu propio código (por ejemplo, el inquilino del llamante que tu autenticación puso en `request.state`). Se pasa a las funciones de confianza y de revocación. Por defecto: siempre `""`. |
| `clock` | `callable \| None` | `None` | Solo por nombre, para pruebas: la hora en milisegundos desde la época. Por defecto: el reloj del sistema. |
| `source_supervisor` | `SourceSupervisor \| None` | `None` | Solo por nombre, con `supervise`. Véase [Supervisar la fuente de confianza](#supervising-the-trust-source). |
| `supervise` | `dict \| None` | `None` | Solo por nombre: `{"trust_timeout": seconds}`, más de 0 y hasta 2147483.647, para un `trusted_principals` asíncrono; `{"revocation": True}` para una `revocation_source` asíncrona, con `revocation_timeout`; o ambos. Véase [Supervisar la fuente de revocación](#supervising-the-revocation-source). |
| `cancel_on_disconnect` | `bool` | `False` | Solo por nombre. Cuando el cliente se va de verdad durante la admisión, cancela su invocación supervisada de la fuente; su respuesta termina con un 499 vacío que el servidor no entrega. Necesita `max_body_bytes`; véase [Un cliente que se va](#a-client-that-leaves). |
| `max_body_bytes` | `int \| None` | `None` | Solo por nombre. Un entero positivo (no un `bool`, un `float`, una cadena, `0` ni un negativo): los bytes del cuerpo de la petición que acepta el middleware. Necesita Starlette 0.28.0 o posterior. Por defecto: sin presupuesto, como antes. Véase [Presupuesto del cuerpo](#body-budget). |

<a id="behavior"></a>

#### Comportamiento

0. Con `max_body_bytes`, primero se lee el cuerpo, dentro del presupuesto (véase [Presupuesto del cuerpo](#body-budget)).
1. Extrae el bundle firmado de la cabecera o del cuerpo JSON (`signed_bundle`). Una cabecera que no es JSON, que contiene un entero por encima del límite de 4300 dígitos de Python o que está anidada demasiado profundamente cuenta como ausencia de bundle (`403` con `require_bundle=True`), nunca como un `500`.
2. Lo verifica con el SDK de Python:
   - **V2** (`bundle.dcp_bundle_version: "2.0"`): `await verify_signed_bundle_v2(signed_bundle, registry, policy)` de `dcp_ai.v2`, con un registro Ed25519 / ML-DSA-65 / SLH-DSA-192f y la política anterior. Comprueba los hashes de los payloads y el manifiesto, la vinculación y la caducidad de la sesión, la firma compuesta del bundle y de cada artefacto, el modo de verificación (el más estricto entre el modo de la política para el nivel de riesgo del pasaporte y el nivel de seguridad de la intención), la cadena de hash de auditoría (en `dcp-ai` 2.10.0, solo la SHA-256; 2.10.1 y posteriores también comprueban los campos secundarios SHA3-256 de V2-11 presentes) y la validez de las claves. `composite_sig_valid` es el resultado del verificador para la firma del bundle.
   - **V1** (`bundle.responsible_principal_record.dcp_version: "1.0"`): `verify_signed_bundle()`, solo donde VERIFICATION.md V2-10 aceptaría un bundle solo clásico, porque un bundle V1 no tiene firma poscuántica: `allow_v1_bundles` es verdadero, la política acepta ed25519 (en `accepted_classical_algs`, no en `advisory_rejected_algs`) y no exige vinculación de audiencia, caducidad de la sesión ni duración máxima de la sesión (un bundle V1 no tiene `intended_verifier` ni ventana de sesión), los `responsible_principal_record`, `agent_passport`, `intent` y `policy_decision` del bundle son objetos y sus `audit_entries` una lista de objetos, el `agent_id` del pasaporte y el `human_id` del RPR son cadenas (y la `public_key` y el `status` del pasaporte, si están, cadenas, y sus `capabilities` una lista de cadenas), porque van al contexto del agente, y el más estricto entre el modo de la política para el `risk_tier` del pasaporte V1 (`default_mode` si no tiene ninguno) y el modo del nivel de seguridad de la intención y la decisión de política V1 (el `risk_score` V1 va de 0 a 1, escalado por 1000; si falta, cuenta como `elevated`) es `classical_only` o `hybrid_preferred`. Con `DEFAULT_VERIFIER_POLICY`, una intención V1 routine o standard pasa; un pago, datos sensibles, un impacto estimado alto o una puntuación de riesgo de 0,5 o más se rechazan.
   - Un bundle cuya versión no puede detectarse se rechaza.
3. Si es válido: guarda `DCPAgentContext` en `request.state.dcp_agent`, con los `warnings` del verificador
4. Si falla: responde con `403` y los `errors` del verificador (y, para V2, los `warnings`): como máximo 20 de cada uno, de 500 caracteres como máximo, con los caracteres de control y de formato del texto aportado por el bundle escapados. Los `warnings` del contexto se acotan de la misma forma.
5. Si no hay bundle y `require_bundle=False`: continúa sin verificación

<a id="body-budget"></a>

#### Presupuesto del cuerpo

`max_body_bytes` es opcional; sin él, el middleware lee el cuerpo como antes, sin límite propio. Con él, el middleware lee el cuerpo completo de la petición antes que nada (la cabecera del bundle, el análisis del JSON, el inquilino y el conjunto de confianza, la verificación, la revocación, la ruta), también cuando el bundle llega en la cabecera y con `require_bundle=False`:

- Un `Content-Length` por encima del presupuesto recibe `413` `{"verified": false, "errors": ["Request body exceeds max_body_bytes"]}` antes de recibir ningún byte del cuerpo.
- También se cuentan los bytes realmente recibidos, así que una petición sin `Content-Length`, con un cuerpo por fragmentos o con un `Content-Length` demasiado pequeño recibe el mismo `413` en el primer mensaje ASGI que los lleva por encima del presupuesto (ese mensaje ya se ha entregado), y no se recibe nada después.
- Un `Content-Length` que no es una sola secuencia de dígitos ASCII (un signo, un punto decimal, espacios, una lista) o que aparece dos veces recibe `400` `["Invalid Content-Length"]`, y un cliente que se desconecta mientras envía el cuerpo recibe `400` `["Request body could not be read"]`. Ninguno llega a la ruta.
- Un cuerpo dentro del presupuesto, incluidos los vacíos o mal formados, se trata exactamente igual que sin la opción, y la ruta lo lee como siempre (`request.body()`, `request.json()`, `request.stream()`): el `BaseHTTPMiddleware` de Starlette transmite un cuerpo leído en el middleware desde Starlette 0.28.0.
- Por tanto, la opción necesita Starlette 0.28.0 o posterior: con un Starlette más antiguo, o uno cuya versión no puede leerse, `max_body_bytes` lanza `AdmissionConfigError` (`CONFIG_INVALID_VALUE`) al construir el middleware. Actualiza FastAPI/Starlette o déjala sin definir. Sin la opción no se comprueba nada, y las versiones mínimas propias del paquete no cambian.

Es un límite de los bytes del cuerpo recibidos, fijado por tu despliegue, no parte del protocolo DCP: no acota la descompresión (cuenta los bytes que entrega el servidor ASGI), la profundidad del JSON, el tiempo ni una desconexión tras la lectura. Defínelo junto con los límites propios de tu servidor.

<a id="supervising-the-trust-source"></a>

#### Supervisar la fuente de confianza

Sin estas opciones, un `trusted_principals` asíncrono o síncrono se ejecuta como antes, sin plazo. Con ellas, uno **asíncrono** recibe un plazo y un hueco de una capacidad:

```python
from dcp_ai.fastapi import DCPVerifyMiddleware, SourceSupervisor

supervisor = SourceSupervisor(max_in_flight=64, max_in_flight_per_tenant=8)  # one per event loop / worker

async def trust_set_for(tenant):
    return await load_trust_set(tenant)

app.add_middleware(DCPVerifyMiddleware, require_bundle=True, trusted_principals=trust_set_for,
                   source_supervisor=supervisor, supervise={"trust_timeout": 2.0})
```

- **Plazo.** La fuente se ejecuta como una Task propiedad del supervisor. Un conjunto de confianza que llega después de `trust_timeout`, medido con `loop.time()` cuando llega y otra vez cuando se usa, no se usa. La petición recibe el mismo `503` que una fuente que falla, y se pide la cancelación de la Task; nada espera a que coopere.
- **Capacidad.** Se ejecutan a la vez como máximo `max_in_flight` llamadas a fuentes, sin cola. `max_in_flight_per_tenant` limita a un inquilino; sin él, un solo inquilino puede quedarse con toda la capacidad. Una llamada que no encuentra hueco libre recibe el `503` de inmediato, sin llamar a la fuente. **Un hueco solo se libera cuando la Task de la fuente termina de verdad**, no cuando se responde a la petición: una fuente que ignora la cancelación conserva su hueco. Cuando todos los huecos están ocupados así, todas las peticiones reciben `503` hasta que esas fuentes terminen o se reinicie el proceso.
- **Fallos.** Una fuente que se cancela a sí misma, un llamante cancelado (cuya fuente conserva su hueco hasta que termina) y un conjunto de confianza no válido fallan cerrados. Un `trusted_principals` estático o síncrono con estas opciones lanza `AdmissionConfigError`: uno síncrono se ejecutaría en el bucle de eventos, donde ningún plazo se cumple.
- **Alcance.** La capacidad es por objeto `SourceSupervisor`, compartida por los middlewares a los que lo pases. Se vincula al primer bucle de eventos que lo usa, así que da a cada proceso de trabajo o bucle el suyo. Las llamadas desde otro bucle o hilo fallan cerradas, y un `close()` desde otro bucle lanza `RuntimeError` sin cambiar nada.
- **`await supervisor.close(drain_timeout=0)`** rechaza las llamadas nuevas, responde a las pendientes con `503`, pide la cancelación de todas las Task de las fuentes y espera como máximo `drain_timeout` segundos. Devuelve `{"in_flight": n}`; esos huecos siguen ocupados, y no puede reabrirse.
- **`supervisor.stats()`** devuelve contadores, sin inquilino: `open`, `in_flight`, `tenants`, `timeouts`, `saturated`, `closed`, `wrong_loop`, `late_results`, `late_errors`. Se detienen en 2**53 - 1.
- **Lo que no hace.** No detiene el trabajo que ignora la cancelación, no acota el trabajo que una fuente inicia por su cuenta ni aísla la CPU. Un `async def` que bloquea el bucle de eventos retrasa todos los plazos. Un servidor o un `asyncio.run` que se apagan pueden seguir esperando a una Task de una fuente que ignora la cancelación. Sin `{"revocation": True}`, la revocación mantiene `revocation_timeout` como antes. A la fuente de confianza se le sigue preguntando antes de verificar el bundle, como antes.

<a id="supervising-the-revocation-source"></a>

#### Supervisar la fuente de revocación

Con el perfil strict-v1, `supervise={"revocation": True}` ejecuta una `revocation_source` **asíncrona** como una Task del mismo tipo de supervisor, con `revocation_timeout` como plazo:

```python
app.add_middleware(DCPVerifyMiddleware, require_bundle=True, trusted_principals=TRUST_SET,  # static, or async with trust_timeout
                   profile={"profile": "strict-v1", "verifier_id": "verifier:acme-api"},
                   revocation_source=deny_list_revocation_source("https://revocations.example.com/.well-known/dcp-revocations.json"),
                   revocation_timeout=2.0, source_supervisor=supervisor,
                   supervise={"revocation": True})  # or {"trust_timeout": 2.0, "revocation": True}
```

- **Opcional.** `supervise` admite `trust_timeout`, `"revocation": True` o ambos. `"revocation": True` necesita una `revocation_source` asíncrona (un `async def`, un objeto con un `__call__` asíncrono, o cualquiera de los dos dentro de `functools.partial`) y funciona con un conjunto de confianza estático. Una síncrona lanza `AdmissionConfigError`, porque se ejecutaría en un hilo de trabajo que el supervisor no controla. Sin la opción no cambia nada: una fuente síncrona sigue ejecutándose en un hilo de trabajo, con `asyncio.wait_for`.
- **Las mismas respuestas.** Cada respuesta da la misma contestación que sin supervisión. Una instantánea se evalúa como antes. `None`, una excepción, un tiempo agotado, una fuente que se cancela a sí misma, la falta de hueco libre, un supervisor cerrado y un supervisor vinculado a otro bucle dan `403` con `codes: ["REVOCATION_UNAVAILABLE"]`, nunca no revocado. Una excepción cuyo `code` es `REVOCATION_INVALID` da `REVOCATION_INVALID` solo cuando llega antes del plazo.
- **Un caso que cambia.** Sin la opción, `asyncio.wait_for` espera a una fuente que suprime su cancelación y usa la instantánea que devuelve entonces. Con la opción, la petición recibe `REVOCATION_UNAVAILABLE` en el plazo, y esa instantánea tardía nunca se usa.
- **Una sola capacidad.** Las llamadas de confianza y de revocación ocupan huecos del mismo supervisor, cada uno retenido hasta que su Task termina de verdad.
- **Un límite de `deny_list_revocation_source`.** Por defecto descarga en `asyncio.to_thread`. Cancelar su Task termina la Task y libera su hueco, pero no el hilo de trabajo: ese hilo conserva su conexión hasta que urllib devuelve. El supervisor no acota esos hilos ni cancela su E/S. Para acotarlos, da a la fuente un presupuesto `DenyListWorkers` (véase [Acotar las descargas de la lista de denegación](#bounding-deny-list-downloads)).

<a id="a-client-that-leaves"></a>

#### Un cliente que se va

Con `cancel_on_disconnect=True`, un cliente que se va mientras se admite su petición detiene el trabajo de esa petición.

- **Cómo se detecta.** El middleware lee primero el cuerpo completo: la opción necesita `max_body_bytes` y, por tanto, Starlette 0.28 o posterior. Después mantiene un `receive()` pendiente mientras se admite la petición: una vez leído el cuerpo, el servidor solo puede enviar ahí `http.disconnect`.
- **Cuando el cliente se va:**
  - La admisión se cancela. Su invocación supervisada también: `SourceSupervisor` cancela su Task sin esperarla, y el hueco sigue ocupado hasta que termina de verdad. Un hilo de `DenyListWorkers` conserva su hueco de la misma forma.
  - No se ejecuta ninguna ruta, y no se publica nada de esa admisión en `request.state`: su `dcp_agent` solo se fija cuando se sabe que el cliente sigue ahí, y un valor que haya fijado tu propio código no se toca.
  - La respuesta ASGI de esa petición termina con un `499` vacío (el «client closed request» de nginx; no registrado y no es un estado de DCP), con `Content-Length: 0` y `Cache-Control: no-store`. Son dos mensajes ASGI que la respuesta de DCP envía a la capa exterior, no una contestación: solo se envían después de recibir `http.disconnect`, nunca a un cliente que sigue ahí, y permiten que un `BaseHTTPMiddleware` exterior a DCP, que espera una respuesta, termine con normalidad. Así, DCP funciona en **cualquier orden** de middlewares.
  - Lo que llega a la red depende del servidor. Uvicorn no escribe nada, no registra nada y no envía ningún `500` para una conexión que ya no existe (medido con uvicorn 0.54 y h11). Según la especificación ASGI, otro servidor puede lanzar en cambio una subclase de `OSError` cuando se envía una respuesta por una conexión cerrada.
  - Las capas exteriores a DCP ven ese 499: una capa de registro anota un cliente que cerró su petición, nunca un éxito. Una capa que transforma las respuestas, o que incumple ASGI, puede cambiarlo; eso queda fuera de esta garantía. Los errores reales de cualquier capa se siguen propagando.
  - Un cliente que se va a mitad de su cuerpo recibe el mismo final con 499, en lugar del 400 que se envía sin la opción.
- **No se le quita nada a la ruta.** Lee el mismo cuerpo, y ese `receive()` pendiente se entrega a quien lea a continuación (la ruta, `request.is_disconnected()`, Starlette), nunca se lee dos veces ni se pierde. Solo se interpretan las lecturas que ocurren durante la admisión: el `http.disconnect` que un servidor envía tras una respuesta completa no se toma como un cliente que se ha ido.
- **Requisitos.** Se comprueban al construir el middleware:
  - `max_body_bytes`;
  - toda función de fuente supervisada (`trust_timeout` para un `trusted_principals` invocable, `{"revocation": True}` para `revocation_source`);
  - una función `tenant` síncrona, porque una asíncrona podría dejar esperando a una petición que ya se ha ido.

  Si no, `AdmissionConfigError` (`CONFIG_PROFILE_CONTRADICTION`). Con la opción, una función `tenant` que devuelve un awaitable recibe el `503` de un inquilino que no puede resolverse, sin que se espere. Sin la opción no cambia nada.
- **Lo que no hace.** No interrumpe la verificación del bundle ni la función del tenant, y no detiene una fuente que ignora la cancelación. Solo se salta las etapas que empiezan después de haber visto la desconexión: detrás de capas exteriores, la desconexión le llega unas vueltas del bucle más tarde, así que una fuente puede haber empezado ya (entonces se cancela y conserva su hueco hasta que termina). Solo funciona con asyncio. Necesita un servidor que envíe `http.disconnect` cuando se pierde la conexión: uvicorn lo hace; el transporte httpx en proceso solo lo envía cuando la respuesta está completa.

<a id="what-verified-means"></a>

#### Qué significa «verificado»

Un bundle verificado es coherente internamente y está firmado por las claves que él mismo enumera (las claves del pasaporte y las claves de vinculación del RPR). No prueba quién es el principal: cualquiera puede crear claves y un RPR que nombre cualquier `human_id`. Para eso, define `trusted_principals` (siguiente sección). Un bundle verificado también puede reenviarse hasta que caduque su sesión; `verifier_policy={"require_audience_binding": True, "verifier_id": "my-service"}` (el `manifest.intended_verifier` del bundle debe nombrar a este verificador), `require_session_expiry` y `max_session_duration_seconds` lo limitan, igual que el perfil strict-v1. Nada de esto hace que un bundle sea de un solo uso: lleva tu propio registro de nonces consumidos si lo necesitas.

<a id="trusted-principals-and-strict-v1"></a>

### Principales de confianza y strict-v1

Con `trusted_principals`, una petición llega a la ruta solo cuando su bundle está **admitido** (`docs/ADMISSION.md`, `spec/profiles/admission`): un bundle V2 cuyas firmas del principal (el RPR y el manifiesto del bundle, clásica y poscuántica) se hicieron con claves que tu conjunto de confianza enumera para ese `human_id`, activas y dentro de su ventana de validez. Con `profile` se aplican además los requisitos de strict-v1: firmas híbridas para todos los niveles de riesgo, un `intended_verifier` firmado igual a tu `verifier_id`, una sesión firmada de 300 s como máximo y una instantánea de revocación de 300 s como máximo que indique que el agente y todas las claves firmantes no están revocados.

```python
import os

from dcp_ai.fastapi import DCPVerifyMiddleware, deny_list_revocation_source

app.add_middleware(
    DCPVerifyMiddleware,
    require_bundle=True,
    trusted_principals=trust_set,  # or a callable: lambda tenant: trust_sets[tenant]
    profile={"profile": "strict-v1", "verifier_id": "api.acme.example"},
    revocation_source=deny_list_revocation_source(
        "https://revocation.acme.example/.well-known/dcp-revocations.json",
        headers={"Authorization": f"Bearer {os.environ['REVOCATION_TOKEN']}"},
    ),
    tenant=lambda request: request.state.tenant,  # set by your own authentication
)
```

- **Las peticiones rechazadas** reciben `403` con `{"verified", "admitted": false, "principal_trust", "profile", "profile_compliance", "codes", "errors"}` (`codes` ordenados, `errors` como `"CODE: message"`, acotados y escapados) y nunca llegan a la ruta. Los bundles V1 se rechazan: no llevan ninguna firma del principal que anclar. Si la función del inquilino o la fuente del conjunto de confianza fallan, o devuelven algo no válido, la petición recibe `503` y tampoco llega a la ruta.
- **Las peticiones admitidas** reciben `request.state.dcp_agent` como arriba, con `admitted=True`, `principal_trust`, `profile`, `profile_compliance`, `recorded_decision` (el `approve`, `escalate` o `block` del bundle) y `trust_set_version`. `action_authorized` siempre es `False`: la admisión dice que la evidencia es auténtica y procede de un principal de confianza, no que una acción pueda ejecutarse.
- **Cada petición se evalúa de nuevo**: la función de confianza y la fuente de revocación se llaman en cada admisión, así que un principal eliminado del conjunto de confianza, una clave marcada como `revoked` ahí o una revocación que enumera la fuente rechazan el mismo bundle en la petición siguiente.
- **La revocación falla cerrada.** Una fuente que lanza una excepción, agota el tiempo (`revocation_timeout`) o devuelve `None` da `REVOCATION_UNAVAILABLE`; una excepción cuyo `code` es `REVOCATION_INVALID`, o una instantánea fuera de `schemas/v2/revocation_snapshot.schema.json`, da `REVOCATION_INVALID`. Ninguna se toma como no revocado.
- **`deny_list_revocation_source(url, *, headers=None, timeout=5.0, workers=None)`** lee una lista de denegación completa en el formato del `/.well-known/dcp-revocations.json` del servicio de revocación de referencia (`updated_at`, `revocations[].agent_id`, `kid_revocations[].revoked_kid`) con la biblioteca estándar: el `checked_at` de la instantánea es `updated_at`, un agente o una clave enumerados están revocados y todos los demás sujetos no lo están. Un error de red, un tiempo agotado o una respuesta que no es 2xx es `REVOCATION_UNAVAILABLE`, y un cuerpo con otra forma, `REVOCATION_INVALID`. No sigue redirecciones (tus cabeceras solo van a tu URL), y HTTPS necesita TLS 1.2 o posterior. Usa `https` y guarda las credenciales en variables de entorno o en un vault. `timeout` acota cada operación de socket, la lectura del cuerpo y cuánto espera una llamada; no acota la resolución DNS, ni una línea de estado y unas cabeceras que llegan gota a gota. `workers` se describe abajo.
- **La configuración solo procede de tu código.** El conjunto de confianza, el perfil, la política, la fuente de revocación y el inquilino nunca se leen de una cabecera, una consulta o un cuerpo de la petición: una petición que nombre otro inquilino no cambia nada.
- **Los errores de configuración** lanzan `AdmissionConfigError` (con un `code`) al construir el middleware: `trusted_principals` o `profile` sin `require_bundle=True`, un perfil sin `trusted_principals` o sin `revocation_source`, o con `verifier_policy` (`CONFIG_PROFILE_CONTRADICTION`); un conjunto de confianza o un perfil no válidos (su propio código); un argumento de tipo incorrecto, o `revocation_source` sin `profile` (`CONFIG_INVALID_VALUE`). Starlette construye la pila de middlewares en la primera petición, no en `add_middleware`, así que un error así aparece primero como un `500` en todas las peticiones (nunca se llega a la ruta). Para que falle al arrancar, carga tú el conjunto de confianza y el perfil (`create_principal_trust_store`, `resolve_strict_v1_profile`) y pasa los objetos cargados.
- **Una fuente de revocación síncrona** se ejecuta en un hilo de trabajo; cuando agota el tiempo, la petición se rechaza de inmediato, pero el hilo sigue hasta que la fuente devuelve. Prefiere una fuente asíncrona, o una con su propio tiempo de espera, como `deny_list_revocation_source(url, timeout=...)`: no usa ningún proxy del entorno, no sigue redirecciones y rechaza una lista de más de 16 MiB. Su `timeout` acota cada operación de socket y la lectura del cuerpo, no la resolución DNS ni una línea de estado que llega gota a gota.

Ejecutable, sin conexión, con los vectores de admisión compartidos: `python integrations/fastapi/examples/strict_v1.py`.

<a id="bounding-deny-list-downloads"></a>

#### Acotar las descargas de la lista de denegación

Por defecto, cada llamada de `deny_list_revocation_source` descarga en `asyncio.to_thread`, y nada cuenta esos hilos una vez que su llamada ha dejado de esperar. Con un presupuesto `DenyListWorkers`, los cuenta:

```python
from dcp_ai.v2 import DenyListWorkers, deny_list_revocation_source

workers = DenyListWorkers(max_workers=8, max_workers_per_tenant=2)  # one per process
source = deny_list_revocation_source(
    "https://revocations.example.com/.well-known/dcp-revocations.json",
    timeout=5.0,
    workers=workers,
)
```

- **Capacidad.** Se ejecutan a la vez como máximo `max_workers` descargas (un entero de 1 a 64), y como máximo `max_workers_per_tenant` para un inquilino; sin él, un solo inquilino puede quedárselas todas.
  - Cada descarga se ejecuta en su propio hilo, que se inicia solo después de reservar su hueco.
  - Una llamada que no encuentra hueco libre recibe `REVOCATION_UNAVAILABLE` de inmediato, sin conectarse. No hay cola.
  - La capacidad es por objeto: da el mismo a todas las fuentes que deban compartirla.
- **El hueco se retiene hasta que la descarga termina de verdad,** no cuando su llamada deja de esperar: un tiempo agotado, una petición cancelada, el plazo del supervisor de C3 y un bucle de eventos cerrado no lo liberan.
  - El presupuesto cuenta las descargas en curso. El hilo que acaba de terminar una sigue existiendo un momento mientras entrega su resultado y sale.
- **Las mismas respuestas.**
  - La descarga es el mismo GET, con las mismas reglas de TLS, proxy, redirecciones y tamaño.
  - El cuerpo se sigue comprobando y analizando en el bucle de eventos.
  - Los errores son los mismos que sin la opción.
  - Un resultado que llega, o se usa, después de `timeout` es `REVOCATION_UNAVAILABLE`, incluso cuando el bucle estaba demasiado ocupado para ejecutar el temporizador.
- **`workers.close()`** rechaza las descargas nuevas y devuelve `{"in_flight": n}`. Ni espera ni detiene las que están en curso, cuyos huecos siguen ocupados hasta que terminan; no puede reabrirse.
- **`workers.stats()`** devuelve contadores sin URL, inquilino ni cabecera: `open`, `in_flight`, `tenants`, `saturated`, `closed`, `start_failed`, `late_results`, `dropped`.
- **La salida del proceso espera.** Los hilos no son hilos daemon, así que el intérprete espera, cuando el proceso sale, a una descarga que siga en curso. Es lo que ya ocurre con `asyncio.to_thread`, y puede tardar: nada de esto detiene DNS, TLS ni urllib, y cancelar una llamada solo deja de esperarla. Para terminar un proceso que espera, recurre a la terminación forzosa de tu gestor de procesos tras un periodo de gracia.
- **Uno por proceso.** En un proceso bifurcado después de crearlo, `stats()` y `close()` lanzan `RuntimeError` y la fuente da `REVOCATION_UNAVAILABLE`, sin tocar el bloqueo ni los contadores del padre: crea uno en cada proceso de trabajo.
- **Lo que no hace.** Acota cuántas descargas se ejecutan, no cuánto tarda una. El plazo del cuerpo se comprueba entre lecturas bloqueantes; una lectura ya en curso puede sobrepasarlo.

### `require_dcp(request)`

Dependencia de FastAPI que exige un agente de DCP verificado.

```python
from fastapi import Depends
from dcp_ai.fastapi import require_dcp, DCPAgentContext

@app.post("/protected")
async def protected_route(agent: DCPAgentContext = Depends(require_dcp)):
    return {"agent_id": agent.agent_id}
```

- **Devuelve:** `DCPAgentContext`
- **Lanza:** `HTTPException(403)` si no hay ningún agente verificado

### `DCPAgentContext`

Dataclass con los datos del agente verificado:

```python
@dataclass
class DCPAgentContext:
    dcp_version: str = "1.0"
    agent_id: str = ""
    human_id: str = ""
    session_nonce: str = ""                # V2: verified session nonce
    public_key: str = ""
    capabilities: list[str] = field(default_factory=list)
    risk_tier: str = "medium"
    status: str = "active"
    passport: dict[str, Any] = field(default_factory=dict)
    rpr: dict[str, Any] = field(default_factory=dict)
    intent: dict[str, Any] = field(default_factory=dict)
    policy_decision: dict[str, Any] = field(default_factory=dict)
    composite_sig_valid: bool = False      # V2: the bundle signature verified
    session_binding_valid: bool = False    # V2: session binding verified
    blinded_rpr: bool = False
    lifecycle_state: str = "active"        # DCP-05
    mandate_id: str = ""                   # DCP-09
    mandate_valid: bool = False            # DCP-09
    warnings: list[str] = field(default_factory=list)  # V2: verifier warnings
    # Admission: set only with trusted_principals (admitted stays False otherwise)
    admitted: bool = False
    principal_trust: str = "not_evaluated" # "trusted" when admitted with trusted_principals
    profile: str | None = None             # "strict-v1" under the profile
    profile_compliance: str = "not_evaluated"
    recorded_decision: str | None = None   # approve, escalate or block
    trust_set_version: str | None = None
    action_authorized: bool = False        # always False
```

### `require_dcp_commissioned(request)`

Dependencia de FastAPI que rechaza un agente cuyo `lifecycle_state` es `decommissioned`. El middleware rellena `lifecycle_state` a partir del `status` del pasaporte; no lee un certificado de puesta en servicio ni un registro de ciclo de vida de DCP-05.

```python
@app.post("/active-only")
async def active_only(agent: DCPAgentContext = Depends(require_dcp_commissioned)):
    return {"agent_id": agent.agent_id}
```

### `require_dcp_mandated(request)`

Dependencia de FastAPI que exige un mandato de delegación (DCP-09 §3.1), pero solo comprueba que `mandate_id` no esté vacío: no obtiene el mandato, no verifica su firma ni comprueba `mandate_valid`. El middleware no rellena `mandate_id` por sí mismo, así que todas las peticiones reciben `403` salvo que tu propio código lo fije (y entonces te corresponde comprobar el mandato).

```python
@app.post("/delegated")
async def delegated(agent: DCPAgentContext = Depends(require_dcp_mandated)):
    return {"agent_id": agent.agent_id, "mandate_id": agent.mandate_id}
```

<a id="advanced-example--global-middleware--selective-routes"></a>
<a id="advanced-example-global-middleware-selective-routes"></a>

## Ejemplo avanzado — middleware global + rutas selectivas

```python
from fastapi import FastAPI, Depends, HTTPException, Request
from dcp_ai.fastapi import DCPVerifyMiddleware, require_dcp, DCPAgentContext

app = FastAPI()

# Global middleware (non-blocking, only verifies if a bundle is present)
app.add_middleware(DCPVerifyMiddleware, require_bundle=False)

# Public route
@app.get("/health")
async def health():
    return {"ok": True}

# Route that REQUIRES a verified agent
@app.post("/agent/execute")
async def execute(agent: DCPAgentContext = Depends(require_dcp)):
    if "api_call" not in agent.capabilities:
        raise HTTPException(403, "Capability 'api_call' required")
    return {"executed_by": agent.agent_id, "risk": agent.risk_tier}

# Route that uses the agent if available
@app.get("/info")
async def info(request: Request):
    agent = getattr(request.state, "dcp_agent", None)
    if agent:
        return {"mode": "verified", "agent": agent.agent_id}
    return {"mode": "anonymous"}
```

<a id="development"></a>

## Desarrollo

Desde un checkout:

```bash
cd sdks/python
pip install -e ".[fastapi,dev]"
pytest tests/test_fastapi_*.py -v
```

<a id="dependencies"></a>

### Dependencias

- `dcp-ai` — SDK de verificación de DCP
- `fastapi` — framework web
- `starlette` — conjunto de herramientas ASGI (incluido con FastAPI)

<a id="license"></a>

## Licencia

Apache-2.0
