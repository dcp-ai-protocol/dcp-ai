<sub>[English](CHANGELOG.md) · [中文](CHANGELOG.zh-CN.md) · **Español** · [日本語](CHANGELOG.ja.md) · [Português](CHANGELOG.pt-BR.md)</sub>

<a id="changelog"></a>

# Registro de cambios

> Traducción informativa de [la versión en inglés](CHANGELOG.md), actualizada el 29/10/2026. Cada entrada, también las de `[Unreleased]`, describe un cambio en su momento y no garantiza el comportamiento actual; las versiones publicadas son **registro histórico con fecha**. Si difieren, prevalece la versión en inglés.

**Versiones publicadas (26/10/2026).** Están publicados npm (13 paquetes, incluido `@dcp-ai/sdk` 2.2.0), Python `dcp-ai` 2.10.0, Go `v2.11.0` y Rust `dcp-ai` 2.11.0, con las correcciones del verificador, la admisión y las API experimentales opt-in; `dcp-jcs-v1` sigue siendo el valor normativo predeterminado. Véase [Versiones publicadas](docs/README.md#published-versions). Las entradas siguientes conservan su historial de desarrollo; `[Unreleased]` no significa que estas funciones no estén publicadas. Las seis publicaciones de corrección del 28/10/2026 están en [su propia sección](#2026-10-28-sha3-patch-releases).

Todos los cambios relevantes de este proyecto se documentarán en este archivo.

El formato se basa en [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

> **Nota informativa (26/10/2026).** Cada entrada describe un cambio tal como se hizo, también las entradas sucesivas
> de `[Unreleased]`, donde una entrada posterior puede precisar o sustituir a una anterior. Una entrada no garantiza
> el comportamiento actual ni que una versión de un paquete esté disponible en un registro. Para el comportamiento
> actual, consulta el [README](README.md), la [documentación](docs/README.md), las [especificaciones](spec/README.md)
> y la [referencia de la API](docs/API_REFERENCE.md).

<a id="2026-10-28-sha3-patch-releases"></a>

## [2026-10-28] Publicaciones de corrección SHA3

Publicado el 28/10/2026: `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1 y `@dcp-ai/cli` 2.1.1 en npm, `dcp-ai` 2.10.1 en PyPI, el módulo Go `v2.11.1` (etiqueta `sdks/go/v2.11.1`) y Rust `dcp-ai` 2.11.1 en crates.io. Los otros diez paquetes npm no cambian. Véanse [Versiones publicadas](docs/README.md#published-versions) y las notas de publicación de [npm](docs/NPM_RELEASES.md), [Python](docs/PYTHON_RELEASE.md), [Go](docs/GO_RELEASE.md) y [Rust](docs/RUST_RELEASE.md).

<a id="secondary-sha3-256-verification"></a>

### Verificación secundaria SHA3-256

- **Cambio de aceptación: los campos secundarios SHA3-256 se verifican cuando están presentes** (desarrollado el
  27/10/2026). Los verificadores V2 de TypeScript, Python, Go y Rust, y la compilación WASM a partir del SDK
  de Rust, comprueban ahora `audit_merkle_root_secondary` (el árbol SHA3-256 construido como el primario; `sha3-256:`
  seguido de 64 ceros para una traza vacía), cada `prev_hash_secondary` (`"GENESIS"` en la primera entrada y, después, el
  SHA3-256 de la entrada anterior tal como figura) y cada `intent_hash_secondary` (el SHA3-256 del payload de la
  intención), como indican `spec/VERIFICATION.md` V2-11 y su errata del 27/10/2026. Los campos ausentes no se exigen, así
  que un bundle verificado puede no contener una cadena secundaria completa; un campo presente que sea `null`, no sea una
  cadena o sea incorrecto se rechaza. La admisión y las rutas del candidato experimental reutilizan estas comprobaciones;
  no cambia ninguna API, campo de resultado, canonicalización ni el tratamiento de `hash_alg`. El patrón del esquema de
  `prev_hash_secondary` acepta también `"GENESIS"`, que OpenClaw escribe en la primera entrada. Vectores compartidos:
  `tests/interop/v2/secondary_sha3_vectors.json`. Las versiones anteriores no comprueban estos campos. Los adaptadores publicados `@dcp-ai/express`, `@dcp-ai/openclaw`, `@dcp-ai/anthropic-mcp` y `@dcp-ai/google-a2a` 2.1.0 no se volvieron a publicar: dependen de `@dcp-ai/sdk` `^2.2.0` y obtienen las comprobaciones secundarias cuando tu lockfile resuelve `@dcp-ai/sdk` 2.2.1 o posterior.

<a id="package-metadata"></a>

### Metadatos de los paquetes

- `@dcp-ai/cli` 2.1.1 requiere `@dcp-ai/sdk` `^2.2.1`, y `dcp-ai --version` informa `2.1.1` en lugar del obsoleto `1.0.0`.
- La telemetría informa las versiones nuevas: Go `SDKVersion` `2.11.1`; los SDK de TypeScript, Python y Rust leen la versión de su paquete.

## [Unreleased]

<a id="security"></a>

### Seguridad

- **`VerificationCache` de TypeScript (código fuente de `main`, no publicado; `@dcp-ai/sdk` 2.2.1
  mantiene el comportamiento anterior).** La clave de la caché sigue siendo el hash del bundle para
  las llamadas existentes, y un `context` opcional elegido por quien llama separa los resultados con
  claves internas etiquetadas con las que un hash legacy no puede colisionar. `invalidateByAgent`,
  que no eliminaba nada, ahora elimina las entradas guardadas con ese agente en la nueva opción
  `agentIds` y todas las guardadas sin ella. Reemplazar una entrada ya no deja sus kids antiguos en
  el índice (con el límite predeterminado el índice crecía sin límite) ni expulsa otra entrada;
  también se indexan los kids de `result.details.signer_keys`; `''` como hash ya no desactiva
  `maxEntries`. **Cambios de aceptación:** las opciones inválidas (TTL `NaN`, `Infinity`, negativos
  o no numéricos, TTL por encima de `Number.MAX_SAFE_INTEGER`, un `maxEntries` que no sea un entero seguro de 1 a `Number.MAX_SAFE_INTEGER`) lanzan un error en lugar de desactivar la expiración o el límite; `set` copia el resultado y
  `get` devuelve una copia nueva en cada acierto; una entrada expira exactamente al cumplirse su
  TTL, medido con el reloj monotónico además del reloj de pared, así que un retroceso del reloj ya
  no la prolonga; un TTL de 0 nunca se guarda; `set` valida sus argumentos (un hueco en `signerKids`
  o `agentIds` cuenta como `undefined`) y no cambia nada cuando lanza un error. Un acierto sigue sin volver a verificar la evidencia ni la confianza y no es admisión, y nada se invalida automáticamente. Véase
  [API_REFERENCE.md](docs/API_REFERENCE.md#verificationcache).
- **Cambio de aceptación: las firmas Ed25519 con S >= L ahora se rechazan** en el SDK de TypeScript
  (`Ed25519Provider.verify`, y por tanto toda firma V2 y compuesta, `@dcp-ai/express` y
  `@dcp-ai/openclaw`; y `verifyObject`, y por tanto `verifySignedBundle` V1) y en el verificador
  de referencia (`tools/crypto.js`, y por tanto `lib/verify.js` V1, `bin/dcp.js`, la conformidad y el
  gossip del registro de transparencia). RFC 8032 §5.1.7 exige 0 <= S < L, y TweetNaCl no lo comprueba,
  así que aceptaba S + k·L, otra codificación de una firma válida (§8.4, maleabilidad). Python, Go
  y Rust ya las rechazaban. TweetNaCl sigue siendo el verificador: el rango solo se comprueba en una
  entrada que acepta, así que sus errores por tipos, tamaños y base64 incorrectos no cambian, como
  tampoco la decodificación de claves y de R ni la aceptación de claves débiles. Los firmantes producen
  S < L, así que ninguna firma generada de nuevo cambia de veredicto; una firma almacenada con S >= L
  que una versión anterior aceptó ya no se verifica. El inventario del repositorio solo encontró firmas
  así en el corpus negativo de revisión, intencionado; no cubre evidencias almacenadas externas. Las
  evidencias verificadas antes de este cambio no se vuelven a firmar automáticamente: consérvalas como
  históricas, con su hash y la versión que las verificó, o fírmalas de nuevo.
- **El mismo cambio de aceptación en `dcp-ai verify` (`@dcp-ai/cli`) y en el playground**, que
  llamaban directamente a TweetNaCl. `dcp-ai verify` comprueba S < L en su propia comprobación V1 de
  `signature.sig_b64`, y los bundles V2 la reciben de `@dcp-ai/sdk`, cuyo verificador usa ahora (véase
  Cambiado). La ruta histórica `signature.classical.value` también tuvo la comprobación cuando se añadió;
  esa ruta se ha eliminado después y su formato se rechaza. El playground la comprueba en
  `verifyDetached`. La comprobación es la del SDK, hecha solo sobre entradas que TweetNaCl acepta, así que
  sus errores no cambian.
- Los cuatro verificadores V2 discrepaban ante codificaciones no canónicas de una firma válida: con basura
  tras el relleno, relleno de más, un salto de línea dentro, bits finales activados o sin relleno,
  TypeScript aceptaba todas las variantes, Python y Go algunas, Rust ninguna. Todo `sig_b64` debe ser ahora
  base64 canónico (`spec/VERIFICATION.md` V2-5), de modo que una firma tiene una única codificación y todos
  los SDK decodifican los mismos bytes; lo cubren 13 nuevos vectores `must_reject`.
- Los verificadores V2 de los cuatro SDK aceptaban bundles que las firmas por sí solas permitían, pero el
  protocolo no. Lo informó una revisión externa y lo confirmó la nuestra; el verificador de referencia
  `lib/verify.js` ejecuta el verificador corregido a través del SDK del workspace hasta que 2.2.0 esté en npm
  (véase Cambiado).
  - **Cualquier agente podía atribuirse cualquier principal.** La firma del bundle se verificaba con las
    claves del pasaporte además de con las `binding_keys` del RPR, y el agente firma su propio pasaporte.
    Emparejar un RPR publicado y firmado con un pasaporte y claves nuevos daba un bundle verificado sin la
    clave privada del principal. La firma del bundle ahora solo se verifica con las `binding_keys` del RPR
    (`spec/VERIFICATION.md` V2-6), de modo que lo que vincula al agente es la firma del principal sobre el
    manifiesto, que se compromete con `passport_hash`.
  - **Los kids no se comprobaban frente a sus claves.** Una lista de claves podía atribuirse el kid de otra
    parte para una clave propia. Todo kid que verifica una firma debe derivarse ahora de su clave, y la clave
    debe estar en base64 canónico para que todos los SDK decodifiquen los mismos bytes (V2-13).
  - **Se verificaban bundles firmados pero incoherentes.** Un pasaporte revocado o retirado, un RPR caducado,
    una decisión de política para otra intención, y entradas de auditoría de otra intención, agente o
    principal, con otro `intent_hash` o sin registrar la decisión de política. Las comprobaciones V1 son ahora
    V2-14: el pasaporte está `active` o `declining`, el RPR no ha caducado y todos los artefactos nombran el
    mismo principal, agente e intención. Una acción escalada o bloqueada sigue siendo una evidencia válida.
  - **El límite de duración de la sesión leía un campo sin firmar.** `max_session_duration_seconds` se medía
    desde `signature.created_at`, fuera del manifiesto firmado. El manifiesto tiene un nuevo
    `session_issued_at`, que `signBundleV2` y `sign_bundle_v2` escriben junto con `session_expires_at`;
    el máximo se mide desde él y, con un máximo, un bundle sin él se rechaza (V2-4).
    No debe adelantarse más de 30 segundos al reloj del verificador, y un máximo también rechaza un
    bundle sin `session_expires_at`. Las marcas de tiempo se comparan con precisión de milisegundos en todos
    los SDK. Los bundles firmados antes de este cambio se verifican como antes con una política sin duración
    máxima de sesión.
  - **El bloque de firma sin firmar podía contradecir a la firma.** `signature.signer.id` debe ser ahora el
    `human_id` del RPR, `signature.signer.kids` los kids de la firma compuesta,
    `manifest_hash` el hash del manifiesto y `hash_alg` uno de los dos que permite el esquema.
    `signBundleV2` y `sign_bundle_v2` rechazan un id de firmante distinto del `human_id` del RPR; `SignBundleV2`
    de Go y `sign_bundle_v2` de Rust ya lo toman del RPR.
  - **Los checkpoints PQ no se verificaban.** Un checkpoint con una raíz de Merkle o una firma PQ cambiadas,
    o uno ausente que el manifiesto enumera, se verificaba. El bundle debe llevar ahora exactamente los
    checkpoints enumerados, cada uno sobre sus entradas de auditoría y firmado por el agente con ambos
    algoritmos (V2-12).
  - Los verificadores de Go y Rust aceptaban un artefacto o una entrada de auditoría sin `session_nonce`;
    ahora todos deben llevar el del manifiesto, como en TypeScript y Python.
  - Nuevos vectores en `tests/interop/v2/bundle_vectors.json`, cada uno firmado sobre un único defecto: 35
    casos `must_reject_bundles`, 4 mutaciones `must_reject` del bloque de firma sin firmar y 8 controles
    `must_accept_bundles`. Un caso puede llevar `verifier_policy_overrides`.
  - `lib/verify.js` fija una clave de `dcp verify-bundle` entre las `binding_keys` del RPR, y toda entrada con
    el kid firmante debe llevar la clave fijada, de modo que la fijación también se mantiene con el SDK
    publicado 2.1.1, que busca primero al firmante en el pasaporte.
- `@dcp-ai/express` (`dcpVerify`), `@dcp-ai/openclaw` (`dcp_verify_bundle`) y el middleware de FastAPI de
  Python (`dcp_ai.fastapi.DCPVerifyMiddleware`) aceptaban bundles firmados V2 sin verificar ninguna
  firma: solo comprobaban la estructura del bundle y los nonces de sesión (el middleware de FastAPI
  además fijaba `composite_sig_valid` a partir del campo `binding`), así que un bundle sin firmar o falsificado,
  o uno cuya intención se cambió después de firmarlo, se daba por verificado. Los tres verifican ahora todo
  bundle V2 con el verificador del SDK (`verifySignedBundleV2` de `@dcp-ai/sdk`, `verify_signed_bundle_v2`
  de `dcp_ai.v2`) y un registro Ed25519 / ML-DSA-65 / SLH-DSA-192f, con la política configurada sobre
  `DEFAULT_VERIFIER_POLICY` (`verifierPolicy`; `verifier_policy`, un argumento nuevo de
  `DCPVerifyMiddleware`; la política del operador de OpenClaw que se describe abajo). `requireHybrid` eleva a
  `hybrid_required` todo nivel de riesgo que esté por debajo (un `pq_only` del operador sigue siendo
  `pq_only`), y un `default_mode` sin `risk_overrides` se aplica a todos los niveles. Se devuelven los errores y
  advertencias del verificador, y `composite_sig_valid` sale de él. Hasta que `@dcp-ai/sdk` 2.2.0 esté en
  npm, ambos paquetes de TypeScript dependen del SDK del workspace
  (`"@dcp-ai/sdk": "file:../../sdks/typescript"`), cuyo verificador tiene las correcciones anteriores; la CI lo
  construye antes de probarlos, y los tres superan todos los casos de `tests/interop/v2/bundle_vectors.json`
  con sus `verifier_policy_overrides`. Para publicarlos hay que subir antes la dependencia a `^2.2.0`:
  `publish-integrations.yml` rechaza ahora un paquete que dependa de una ruta local.
- Esos mismos tres verificadores enviaban al verificador V1 todo bundle que no se detectaba como V2, fuera cual
  fuera la política del verificador: un bundle V1 (una firma Ed25519, ninguna poscuántica) pasaba
  `requireHybrid` o una política `hybrid_required`, y un bundle de versión indetectable se probaba como
  V1. Ahora un bundle V1 solo se acepta donde VERIFICATION.md V2-10 aceptaría un bundle solo clásico:
  `allow_v1_bundles` es verdadero, `requireHybrid` está desactivado, y el más estricto entre el modo de la
  política para el `risk_tier` del pasaporte V1 y el modo del nivel de seguridad de la intención y la decisión
  de política V1 (`risk_score` V1, de 0 a 1, multiplicado por 1000; si falta, cuenta como `elevated`) es
  `classical_only` o `hybrid_preferred`. Con `DEFAULT_VERIFIER_POLICY`, el bundle de conformidad V1
  (un `send_email` de nivel estándar) pasa y el mismo bundle con una intención `initiate_payment` se
  rechaza. Un bundle de versión indetectable se rechaza.
- `@dcp-ai/openclaw`: `dcp_verify_bundle` tomaba su política de verificación del parámetro de herramienta
  `verifier_policy`, que controla el modelo que llama, y devolvía el `agent_id` y el `human_id` del bundle sin
  verificar junto con un resultado fallido. La política es ahora la del operador (`register(api,
  { verifierPolicy })` o el nuevo `configureVerifier`, sobre `DEFAULT_VERIFIER_POLICY`); el
  parámetro solo puede hacerla más estricta (un modo más estricto por nivel, donde combinar `pq_only` con cualquier otro
  modo da `hybrid_required` para que el modelo no pueda prescindir de la firma clásica que exige el operador,
  `require_*` solo se activa, `allow_v1_bundles` solo se desactiva, cualquier otro campo es un
  error). El resultado repite
  `verification_mode`, y nombra al agente, al principal y la sesión solo cuando el bundle se verificó.
- `@dcp-ai/express`: la caché de veredictos usaba como clave `signature.composite_sig` y la compartían todos los
  middlewares, así que un bundle distinto que llevara una firma en caché, o un middleware con una política más
  estricta, reutilizaba un veredicto de «verificado»; además crecía sin límite y conservaba un veredicto todo el
  TTL después de que la sesión o una clave hubieran caducado o el agente hubiera sido revocado. Cada middleware
  tiene ahora su propia caché, con clave en el SHA-256 de la forma canónica del bundle (`canonicalizeV2`; un
  bundle sin ella, como uno que contiene `1e999`, que `JSON.stringify` imprimía como `null`, se verifica
  pero no se almacena en caché), con un máximo de `cacheMaxEntries` (nuevo, 1000 de forma predeterminada) bundles,
  expulsando primero el usado menos recientemente; una entrada caduca en el primero de estos momentos: el TTL, el
  `session_expires_at` del manifiesto, el `expires_at` del RPR y el `expires_at` de cada clave del pasaporte y de
  cada clave de vinculación del RPR. Un bundle muy anidado ya no da un 500.
- `@dcp-ai/express`: `checkRevocation` solo preguntaba por el agente y por las claves de su pasaporte, y fallaba
  en abierto sin avisar. Ahora pregunta también por cada clave de vinculación del RPR y por los kids clásico y
  PQ de la firma del bundle, en cada petición, incluidos los aciertos de caché. Una consulta que no da respuesta
  (servicio inalcanzable, una respuesta que no es 2xx, un cuerpo que no es JSON o no tiene `revoked`) sigue
  dejando pasar la petición de forma predeterminada; el nuevo `revocationFailClosed: true` la rechaza.
- `@dcp-ai/express`: una opción o un campo de `verifierPolicy` desconocidos (`defaultMode`) y un valor del
  tipo incorrecto (`allow_v1_bundles: "false"`) se ignoraban, y quedaba en vigor el valor predeterminado. Ahora
  lanzan una excepción al crear el middleware.
- `dcp_ai.fastapi`: una cabecera `X-DCP-Bundle` con un entero que supera el límite de 4300 dígitos de Python o
  demasiado anidada, y un bundle demasiado profundo para el verificador, daban un 500; ahora reciben un 403.
  Un `pq_checkpoints` que no es una lista se rechaza (se leía como ningún checkpoint).
  `verifier_policy={"risk_overrides": None}` conserva ahora los niveles predeterminados en lugar de aplicar
  `default_mode` a todos, y un nivel de riesgo desconocido lanza una excepción. Se documenta que `dcp_version`
  no se hace cumplir.
- Los tres README dicen ahora qué significa «verificado»: el bundle es coherente internamente y está firmado
  por las claves que él mismo enumera, lo que no prueba quién es el principal salvo que el verificador fije
  las claves del principal (ninguno de los middlewares puede hacerlo todavía), y `require_audience_binding` con un
  `verifier_id` limita la reproducción al verificador previsto.
- Los verificadores de Go y Rust aceptaban una entrada de auditoría (o un checkpoint PQ) cuyo `session_nonce`
  difería del del manifiesto, aunque el manifiesto se comprometía con él (`spec/VERIFICATION.md` V2-4: todo
  artefacto y toda entrada de auditoría que lleva un nonce comparte el del manifiesto). Ambos comprueban ahora
  la pista y los checkpoints como lo hacen TypeScript y Python, con el error `Session nonce mismatch in
  audit_entries[i]`. Vector compartido `audit_entry_session_nonce_differs`.
- El verificador de Rust no comprobaba en absoluto `manifest.canonicalization_profile`, y el de Go
  ignoraba un valor que no fuera una cadena, así que un bundle podía declarar un perfil que ningún verificador
  implementa (`spec/CANONICALIZATION_PROFILE.md` § 4, V2-3). Ambos rechazan ahora cualquier valor distinto de
  `"dcp-jcs-v1"`, como hacen TypeScript y Python. Vectores compartidos `canonicalization_profile_unknown`
  y `canonicalization_profile_not_a_string`.

<a id="added"></a>

### Añadido

- **Catálogo de evidencia para el runner de conformidad externo: Merkle y verificación de firmas.**
  `--catalog evidence` ejecuta un catálogo opcional (`tools/conformance/external-evidence-catalog.json`,
  contrato `dcp-ai-conformance-external/2`, 241 casos) sobre fixtures públicos versionados: raíces
  Merkle duales exactas para 1, 2, 3 y 5 hojas, verificación de firmas compuestas y solo clásicas con
  los ataques versionados y alteraciones deterministas, verificación normativa V2 de bundles firmados de
  `bundle_vectors.json` con `default_verifier_policy` y los overrides versionados de cada caso, y los
  vectores secundarios SHA3-256, todo con un `verification_time` fijado. Un caso negativo solo cuenta si
  su control pasó; `verified: true` con errores, `error` y `unsupported` nunca son un pase. Los cinco
  wrappers aceptan ambos contratos; el catálogo por defecto, el contrato `/1` y sus 38 casos no cambian.
  CI ejecuta los 241 casos y los self-tests con los cinco wrappers. Un pase no es admisión, confianza ni
  autorización. Aparte de la corrección de `wasm_dual_merkle_root` en Corregido, no hay cambios en los
  SDK; no se publica ningún paquete. Véase
  [tools/conformance/README.md](tools/conformance/README.md#evidence-catalog-merkle-and-signature-verification).
- **Wrappers de Go, Rust y WASM para el runner de conformidad externo.**
  `tools/conformance/wrappers/build.mjs` compila desde este checkout wrappers para el SDK de Go, el
  SDK de Rust y la compilación WASM del SDK de Rust (`-mod=readonly`, `--locked`; no cambia ningún
  manifest ni lockfile del SDK), y cada uno ejecuta los mismos 38 casos con la API real, con una
  sola llamada al canonicalizador y clasificando como rechazo solo el documentado. El wrapper WASM
  ejecuta el `.wasm` real alojado en Node, no en un navegador, y trata de forma conservadora la
  colisión del `{"error": …}` que la exportación devuelve dentro del resultado. La CI compila los
  tres y los ejecuta como jobs obligatorios. No se publica ningún paquete. Véase
  [tools/conformance/README.md](tools/conformance/README.md#go-rust-and-wasm-wrappers).
- **Runner de conformidad externo (`tools/conformance-external.js`).** Ejecuta un catálogo aparte y
  versionado (`tools/conformance/external-catalog.json`, contrato `dcp-ai-conformance-external/1`)
  contra cualquier implementación indicada como argv, mediante una petición JSON por stdin y una
  respuesta JSON por stdout: 30 casos de canonicalización `dcp-jcs-v1` (incluidos los 19
  `edge_cases` del repositorio, 3 de los cuales deben rechazarse) y 8 digests SHA-256 / SHA3-256,
  todos con expectativas ya comprometidas. Incluye wrappers para `@dcp-ai/sdk` y para `dcp_ai` de
  Python, y la CI ejecuta los dos. El comando, el catálogo y el informe de conformidad existentes no
  cambian. Un pase muestra que pasan estos 38 casos, nada más. Véase
  [tools/conformance/README.md](tools/conformance/README.md#external-implementations).
- `cancel_on_disconnect` en FastAPI funciona con cualquier orden de middlewares. La respuesta ASGI a un cliente
  que se fue termina ahora con un `499` vacío («client closed request»: no registrado, no es un estado de
  DCP), con `Content-Length: 0` y `Cache-Control: no-store`, en lugar de sin ningún mensaje.
  - Son dos mensajes ASGI de la respuesta de DCP, enviados solo después de recibir `http.disconnect`,
    nunca para un cliente que sigue conectado. Un `BaseHTTPMiddleware` externo a DCP necesita `http.response.start`,
    y antes fallaba con «No response returned.»; ahora termina con normalidad y registra un
    499.
  - Lo que llega a la red depende del servidor: uvicorn (medido, 0.54 con h11) no escribe ni registra
    nada para una conexión que ya no existe; con ASGI, otro servidor puede lanzar una subclase de `OSError`.
  - El `request.state.dcp_agent` de la admisión se publica ahora solo cuando se sabe que el cliente sigue
    ahí, de modo que un cliente que se fue no deja ningún contexto admitido. Un valor que fija el propio código
    del operador no se toca.
  - Un cliente que se va a mitad de su cuerpo recibe el mismo final (en lugar de nada).
  - Los errores reales de cualquier capa se siguen propagando. No cambia nada más: las opciones, los valores
    predeterminados, el presupuesto del cuerpo, el supervisor y `DenyListWorkers`.
- Desconexión del cliente, opt-in: `cancelOnDisconnect` en `@dcp-ai/express`,
  `cancel_on_disconnect=True` en `dcp_ai.fastapi.DCPVerifyMiddleware`.
  - **Qué hace.** Cuando el cliente se va realmente durante la admisión, se cancela la invocación supervisada
    de la fuente de esa petición, y solo de esa. Su hueco sigue ocupado hasta que la fuente termina realmente.
    No se hace ni se envía nada más para la petición: ni el manejador, ni `next`, ni escritura en caché, ni
    `onFailure`, ni respuesta.
  - **Express.** Irse significa que la respuesta se cierra antes de enviarse, o que la petición se cierra con
    el cuerpo incompleto; el propio `close` de una petición sana no lo es.
    - Necesita que todas las funciones de fuente estén supervisadas, ningún `checkRevocation` y un supervisor que
      admita la cancelación: la nueva capacidad `runWithSignal` de los supervisores de esta versión (ESM y CJS,
      ambos paquetes).
    - `run`, sus cuatro argumentos y `version: 1` no cambian, y un supervisor de un paquete anterior sigue
      funcionando sin la opción.
    - La decisión de una invocación supervisada se toma ahora una sola vez, antes de abortar su señal: un
      listener de aborto que vuelve a entrar en `close()` no cambia nada.
    - Nuevo resultado `cancelled`, contador (`stats().cancelled`, opcional en el tipo) y motivo de
      telemetría.
  - **FastAPI.** Necesita `max_body_bytes`, todos los callables de fuente supervisados y un callable `tenant`
    síncrono.
    - El middleware vigila un único `receive()` pendiente durante la admisión y se lo pasa al siguiente
      lector: nada se lee dos veces ni se pierde, y el `http.disconnect` que se envía tras una respuesta
      completa no se toma como que el cliente se fue.
    - Con la opción, un cliente que se va a mitad de su cuerpo no recibe nada en lugar del
      400.
    - En su primera forma, el middleware tenía que envolver las demás capas `BaseHTTPMiddleware` de la
      aplicación; ese requisito ha desaparecido (véase la entrada anterior).
    - `SourceSupervisor` y `DenyListWorkers` no cambian. OpenClaw no tiene esa opción.
  - Sin la opción no cambia nada.
- `dcp_ai.v2.DenyListWorkers` y `deny_list_revocation_source(..., workers=...)`, opt-in: un presupuesto
  de hilos de descarga reales para la función auxiliar de lista de denegación de Python (`max_workers` de 1 a 64,
  `max_workers_per_tenant` opcional, por objeto). Cada descarga se ejecuta en un hilo no daemon propio,
  iniciado después de reservar su hueco y que solo lo libera cuando la descarga ha terminado realmente,
  también tras un tiempo de espera agotado, una llamada cancelada, el plazo del supervisor de C3 o un bucle de
  eventos cerrado; una llamada que no encuentra hueco libre recibe `REVOCATION_UNAVAILABLE` de inmediato, sin cola
  ni conexión. La descarga, las comprobaciones del cuerpo, el análisis y los errores son los mismos que sin la
  opción; un resultado que llega o se usa después de `timeout` es `REVOCATION_UNAVAILABLE`. `close()` rechaza nuevas
  descargas sin esperar a las que están en curso ni detenerlas; `stats()` no incluye URL, tenant ni cabecera. En un
  proceso bifurcado, rechaza sin tocar el bloqueo del padre. La salida del proceso espera a una descarga
  que siga en curso, como ocurre con `asyncio.to_thread`; nada detiene DNS, TLS ni urllib. Sin
  `workers` no cambia nada. Se corrige la documentación de `timeout`: limita cada operación de socket
  y la lectura del cuerpo, no la resolución DNS ni una línea de estado que llega poco a poco.
- Revocación bajo el supervisor de fuentes (C3), opt-in, en `@dcp-ai/express`, `@dcp-ai/openclaw`
  y `dcp_ai.fastapi.DCPVerifyMiddleware`: `supervise: { revocation: true }` /
  `supervise={"revocation": True}`, rechazado hasta ahora, ejecuta la fuente de revocación de strict-v1 bajo
  el supervisor con `revocationTimeoutMs` / `revocation_timeout` como plazo, que queda limitado
  al rango de los temporizadores (un entero de 1 a 2147483647 ms; hasta 2147483.647 s). `supervise` acepta
  el plazo de confianza, `revocation` o ambos, de modo que la revocación puede supervisarse con un conjunto de
  confianza estático; las llamadas de confianza y de revocación comparten la capacidad del supervisor, y un hueco
  solo se libera cuando su fuente termina realmente. Las respuestas no cambian: un tiempo agotado, la falta de hueco
  libre o un supervisor cerrado dan el `REVOCATION_UNAVAILABLE` que da una fuente que falla (403 en Express y
  FastAPI), y un error `REVOCATION_INVALID` solo cuenta antes del plazo. Las fuentes de TypeScript
  reciben `(subjects, { tenant, signal })`, `denyListRevocationSource` también aborta su fetch con esa
  señal, y la telemetría informa `source: 'revocation'`; `configureVerifier` de OpenClaw se niega a
  sustituir un supervisor con llamadas en curso, sea cual sea la fuente que supervise. FastAPI necesita una
  `revocation_source` asíncrona. Cambio de comportamiento solo con la opción: una fuente de FastAPI que suprime su
  cancelación da `REVOCATION_UNAVAILABLE` al vencer el plazo en lugar de su instantánea tardía. No
  queda limitado: el trabajo que una fuente inicia por su cuenta, como el worker `asyncio.to_thread` de
  `deny_list_revocation_source`, cuya E/S no se cancela. Sin la opción no cambia nada.
- `dcp_ai.fastapi.DCPVerifyMiddleware`: un plazo y una capacidad para un `trusted_principals` asíncrono,
  opt-in. `SourceSupervisor(max_in_flight=..., max_in_flight_per_tenant=None)`, exportado solo desde
  `dcp_ai.fastapi`, y `source_supervisor` con `supervise={"trust_timeout": seconds}` (ambos
  juntos). La fuente se ejecuta como una Task que pertenece al supervisor. Un conjunto de confianza que llega
  después del plazo (`loop.time()`, comprobado al llegar y al usarse), una llamada sin hueco libre (sin cola), un
  supervisor cerrado o uno vinculado a otro bucle de eventos dan el mismo 503 que una fuente que falla. Un
  hueco solo se libera cuando la Task termina realmente. Se proporcionan `close(drain_timeout)` y `stats()`.
  Un `trusted_principals` estático o síncrono con estas opciones lanza
  `AdmissionConfigError`; también lo hacía `{"revocation": True}` en este primer paso, ahora aceptado (véase la
  entrada de revocación anterior). Un supervisor por bucle de eventos; no
  detiene una fuente que ignora la cancelación ni aísla la CPU. Sin estas opciones no cambia nada.
- `@dcp-ai/express` y `@dcp-ai/openclaw`: un plazo y una capacidad para una función `trustedPrincipals`,
  opt-in. `createSourceSupervisor({ maxInFlight, maxInFlightPerTenant?, onSourceEvent? })`
  crea un supervisor, y `sourceSupervisor` con `supervise: { trustTimeoutMs }` lo aplica (ambos
  juntos, con `trustedPrincipals` como función). La función recibe entonces `{ tenant, signal }`.
  Un conjunto de confianza que llega después del plazo, medido con un reloj monótono en el momento de llegar, no
  se usa, ni tampoco una llamada que no encuentra hueco libre (sin cola) o un supervisor cerrado: el
  resultado es el mismo que el de una fuente que falla (`TRUST_SOURCE_FAILED`, 503 en Express). Un hueco solo
  se libera cuando la función termina realmente. La capacidad es por objeto supervisor y puede compartirse
  entre ambos paquetes y sus compilaciones ESM y CJS. Se proporcionan `close({ drainMs })` y `stats()`;
  los contadores se detienen en `Number.MAX_SAFE_INTEGER`. `configureVerifier` de OpenClaw se niega a
  sustituir o quitar un supervisor mientras está en curso una llamada que empezó bajo él (también antes de que
  llame a su fuente) o su fuente sigue ejecutándose, incluso después de `close()`. No detiene el trabajo de una
  fuente ni aísla la CPU. Sin estas opciones no cambia nada. En este primer paso,
  `supervise.revocation: true` se rechazaba y la revocación mantenía `revocationTimeoutMs`; ahora se
  acepta (véase la entrada de revocación anterior).
- `dcp_ai.fastapi.DCPVerifyMiddleware(max_body_bytes=...)`: un presupuesto opt-in, en bytes, para el
  cuerpo de la petición (predeterminado `None`, sin presupuesto, como antes; un entero positivo, o si no
  `AdmissionConfigError` `CONFIG_INVALID_VALUE`). El middleware lee entonces primero el cuerpo, también
  con el bundle en la cabecera o con `require_bundle=False`: un `Content-Length` por encima del presupuesto, o
  bytes recibidos por encima de él (sin `Content-Length`, fragmentado o con uno erróneo), reciben `413` sin
  recibir el resto, analizar, resolver la confianza, verificar ni llegar a la ruta; un `Content-Length` no válido
  o repetido o una desconexión durante el envío reciben `400`. Un cuerpo dentro del presupuesto se
  trata como antes y sigue llegando a la ruta. Limita los bytes recibidos, no la
  descompresión, la profundidad del JSON ni el tiempo, y es un límite de despliegue, no parte del protocolo.
  La opción necesita Starlette 0.28.0 o posterior, que pasa a la ruta un cuerpo leído en el middleware;
  con un Starlette más antiguo o no identificado lanza `AdmissionConfigError`
  `CONFIG_INVALID_VALUE` al construir el middleware. Las versiones mínimas del paquete no
  cambian, y sin la opción no se comprueba nada.
- Admisión: principales de confianza y el perfil `strict-v1` (`spec/profiles/admission`,
  `docs/ADMISSION.md`). Un bundle verificado prueba la integridad y la firma con las claves que enumera; un
  conjunto de confianza del operador (`schemas/v2/principal_trust_set.schema.json`) permite ahora que un verificador
  admita un bundle solo cuando las claves que verificaron las firmas de su principal (RPR y manifiesto, clásica
  y PQ) son claves activas y de confianza de ese `human_id`. `strict-v1`
  (`schemas/v2/admission_profile.schema.json`) añade requisitos fijados por el operador: solo V2, firmas
  híbridas en todos los niveles, vinculación de sesión, un `intended_verifier` firmado igual al
  `verifier_id` del operador, una sesión firmada de 300 s como máximo y una instantánea de revocación
  (`schemas/v2/revocation_snapshot.schema.json`) de 300 s de antigüedad como máximo que cubra al agente y a toda
  clave de firmante verificada. Su configuración solo puede endurecerlo; un valor que lo debilita es un
  `CONFIG_PROFILE_CONTRADICTION`. Los resultados conservan `verified` y añaden `principal_trust`,
  `profile_compliance`, `admitted`, `recorded_decision`, `trust_set_version`, `errors` con código, y
  `action_authorized`, siempre `false`: la admisión no autoriza una acción.
  - SDK: TypeScript (`admitSignedBundleV2`, `evaluateAdmissionV2`, `createPrincipalTrustStore`,
    `resolveStrictV1Profile`, `revocationSubjects`, `revocationSnapshotFromDenyList`), con las mismas
    funciones en Python, Go y Rust. Los cuatro verificadores aceptan un reloj opcional e informan de la
    clave con la que se verificó cada componente de la firma (`signer_keys`). En Rust, `V2VerificationResult`
    conserva sus diez campos y `verify_signed_bundle_v2` / `verify_signed_bundle_v2_with_policy`
    sus tipos, de modo que el código compilado contra ellos sigue compilando: las claves vienen del nuevo
    `verify_signed_bundle_v2_at`, que devuelve `V2VerificationDetails` (`#[non_exhaustive]`; el
    resultado como `result`, y `signer_keys`, de la misma verificación). La admisión lo recibe y lo devuelve;
    su JSON son los campos del resultado seguidos de `signer_keys`.
  - Integraciones: `dcpVerify` de `@dcp-ai/express`, `DCPVerifyMiddleware` de `dcp_ai.fastapi` y
    `configureVerifier` de `@dcp-ai/openclaw` aceptan `trustedPrincipals`, `profile`,
    `revocationSource` y, en los middlewares, una función `tenant` del operador. Una petición llega a
    la ruta solo cuando se admite. Una función de confianza que lanza una excepción o no devuelve un conjunto de
    confianza válido (`undefined`, `null`, un conjunto no válido) rechaza la petición: `503` en los middlewares,
    `admitted: false` en OpenClaw. La caché de Express solo conserva la verificación criptográfica,
    con clave en el bundle, la política y el tenant; la confianza, el perfil y la revocación se
    evalúan en cada petición. `denyListRevocationSource` lee una lista de denegación completa; una fuente
    que falla o agota su tiempo rechaza la petición.
  - Verificador de referencia, servidor y CLI: `admitSignedBundle` en `lib/verify.js`, `POST /v2/admit`
    configurado por `DCP_TRUSTED_PRINCIPALS_FILE`, `DCP_ADMISSION_PROFILE_FILE` y
    `DCP_REVOCATION_LIST_URL`, y `dcp admit-bundle`.
  - `tests/interop/v2/admission_vectors.json`: 65 casos con resultados esperados escritos a mano y la
    regla que comprueba cada uno, y 49 casos de configuración, que ejecutan los cuatro SDK y `npm run
    conformance`.
- SDK de Rust: construcción y firma nativas de bundles V2, `dcp_ai::v2::bundle`. `build_bundle_v2(&rpr,
  &passport, &intent, &policy, &audit_entries, session_nonce)` comprueba cada `payload_hash` y el
  `session_nonce` de cada artefacto y entrada de auditoría, y escribe el manifiesto con ambas raíces de
  Merkle de auditoría (una pista vacía recibe raíces de 64 ceros, como en Go); `sign_bundle_v2(bundle,
  &classical, &pq)` firma el manifiesto de forma compuesta, con `signer.id` igual al `human_id` del RPR, como hace
  `SignBundleV2` de Go. Como el de Go, el constructor todavía no acepta checkpoints PQ. El agente de Rust de la
  matriz de interoperabilidad los usa en lugar de ensamblar el bundle a mano.
- `tools/interop-matrix`: interoperabilidad en vivo entre los cuatro SDK. Un proceso de agente por SDK
  (TypeScript, Python, Go, Rust) crea su identidad, declara intenciones, actúa y firma sus
  bundles de ciudadanía (DCP-01 a DCP-03); todos los demás agentes, y el verificador de referencia
  `lib/verify.js`, los verifican con la política predeterminada y con `hybrid_required`, intactos y
  tras siete manipulaciones en tránsito (intención cambiada, entradas de auditoría reordenadas o eliminadas, sesión
  empalmada, firma del bundle o pasaporte intercambiados, firma PQ eliminada). Los agentes solo comparten los
  mensajes que retransmite el orquestador. `.github/workflows/interop-matrix.yml` la ejecuta en cada pull
  request y cada noche.
- `@dcp-ai/google-a2a` 2.1.0: el Agent Passport DCP firmado viaja dentro de la Agent Card de A2A.
  `passportToAgentCard(signedPassport, url)` (o `attachPassportToAgentCard(card, signedPassport)`)
  coloca el `SignedPayload<AgentPassportV2>` en `capabilities.extensions` de la tarjeta, bajo
  `https://dcp-ai.org/a2a/extensions/passport/v2`, el mecanismo de extensión propio de A2A;
  `verifyAgentCardPassport(card)` lo verifica sin conexión (hash del payload, firma compuesta
  `pq_over_classical` con el contexto AgentPassport y las claves activas y no caducadas que enumera el
  pasaporte, `status: active`, y `metadata.dcp_agent_id` que nombre al mismo agente), y falla de forma
  cerrada ante cualquier cosa mal formada; `agentCardToPassport` devuelve ese pasaporte en lugar de un
  esqueleto cuando la tarjeta lo lleva. El paquete es ahora TypeScript (compilación en `dist/`, suite de vitest
  en la CI).
- `@dcp-ai/anthropic-mcp` 2.1.0: recibos firmados para las llamadas a herramientas MCP. `withDcpReceipt(name, handler,
  { identity })` envuelve cualquier manejador de herramienta MCP: la llamada se clasifica en una Intent (DCP-02) y
  se firma de forma compuesta antes de que se ejecute la herramienta, la política decide (approve ejecuta la
  herramienta; escalate y block devuelven un resultado `isError` sin ejecutarla; un manejador que lanza una
  excepción produce `outcome:
  "failed"`), y una entrada de auditoría (DCP-03) registra el SHA-256 de los argumentos y del resultado.
  El recibo en `_meta.dcp_receipt` es un bundle firmado DCP v2.0 corriente, así que cualquier verificador DCP
  lo comprueba sin conexión; `verifyDcpReceipt` además recalcula el hash de la evidencia a partir de los argumentos y
  el resultado que vio quien llama y comprueba el nombre de la herramienta. `createReceiptIdentity` emite una
  identidad de sesión (claves Ed25519 + ML-DSA-65, RPR y pasaporte firmados) para pruebas y primeras ejecuciones.
  El paquete es ahora TypeScript (compilación en `dist/`, suite de vitest en la CI) y `dcp_verify_bundle` ejecuta el
  `verifySignedBundleV2` real en lugar de una comprobación estructural; su entrada `security_tier`, que no se usaba,
  ha desaparecido.
- `tests/interop/v2/bundle_vectors.json`: 28 casos de rechazo más (5 mutaciones `must_reject`, 23 `must_reject_bundles`),
  uno por cada vulnerabilidad de la ronda v2.10, que los cuatro verificadores de los SDK (incluido Python) ejecutan en
  todos los modos de verificación: artefactos sin ninguna `composite_sig` (V2-8); `dcp_bundle_version` `1.0` y `3.0`
  (V2-1); una clave caducada con un desfase distinto de UTC, valores `expires_at` de clave mal formados (fecha
  imposible, solo fecha, sin desfase) en el pasaporte y una fecha imposible en el RPR (V2-13); bundles solo clásicos
  cuya intención o decisión de política implica `elevated` mientras la intención declara `security_tier: "routine"` o
  `estimated_impact: "high"` (V2-10); claves del prototipo (`constructor`, `__proto__`, `toString`,
  `hasOwnProperty`) en el `risk_tier` del pasaporte y `constructor` en `action_type`,
  `estimated_impact` y `security_tier` (V2-9); un `canonicalization_profile` desconocido o que no es una
  cadena (V2-3); una intención, una entrada de auditoría o el manifiesto con otro
  `session_nonce` (V2-4); un hash del manifiesto, una raíz de auditoría o un hash de cadena que no coinciden (V2-3).
- `tools/difffuzz`: un fuzzer diferencial que hace pasar el mismo bundle firmado V2 mutado por los verificadores de
  TypeScript, Python, Go y Rust (un adaptador por SDK, compilado desde este checkout) y falla
  ante cualquier discrepancia, cierre inesperado o tiempo agotado, guardando cada hallazgo en `tools/difffuzz/findings/`.
  Las semillas son los bundles firmados V2 de `tests/interop/v2/`; los mutadores cubren campos borrados y nulos,
  intercambios de tipo, intercambios entre hermanos, cambios de caracteres base64, claves del prototipo, claves
  desconocidas, artefactos duplicados, variantes de números y de RFC 3339, cadenas demasiado largas, anidamiento
  profundo y reordenación de claves (que nunca debe cambiar un veredicto).
- `.github/workflows/difffuzz.yml` ejecuta el fuzzer en cada pull request (300 iteraciones), con
  `workflow_dispatch` y cada noche (3000 iteraciones).
- Cadenas de delegación verificables (DCP-09 §3.5) en los cuatro SDK. `schemas/v2/delegation_mandate.schema.json`
  gana los campos opcionales `parent_mandate_id`, `delegation_depth`, `sub_delegation`
  (`{ permitted, max_depth }`), `minimum_security_tier` y `delegator_composite_sig`; un mandato raíz
  conserva `human_composite_sig` y no cambia ni un byte, un submandato lleva en su lugar
  `delegator_composite_sig`, firmada por el agente que delega con el nuevo contexto de separación de dominio
  `DCP-AI.v2.SubMandate` (`domain-separation.{ts,py,go,rs}`, `interop_vectors.json`).
  `verifyMandateChain` / `verify_mandate_chain` / `VerifyMandateChain` verifica una cadena ordenada
  sin conexión hasta la persona: la firma raíz con las claves de la persona, la firma de cada salto con las
  claves del agente padre, el enlace con el padre y la profundidad, `sub_delegation.permitted` y el menor `max_depth`
  de los ancestros, el mismo `human_id`, ventanas de validez anidadas comparadas como instantes RFC 3339,
  la atenuación (subconjuntos de `actions_permitted` y `data_classes`, `limits` nunca más laxos, un hijo no puede añadir
  `data_classes` si su padre no tiene ninguna, y `limits` numéricos solo como enteros dentro de ±(2^53 − 1): más allá
  de ellos, un verificador que lee los números JSON como dobles y otro que conserva todas las cifras discrepan sobre lo
  que dice un mandato, así que un límite así es `not comparable` a cualquier profundidad), un `minimum_security_tier`
  que nunca baja del del padre, y la revocación, donde un ancestro revocado invalida a todos sus descendientes. El
  resultado lleva el nivel efectivo de la cadena (el mayor `minimum_security_tier` a lo largo de ella). Todo lo que sea
  desconocido, falte para la profundidad o no sea comparable falla de forma cerrada. Las claves de firma deben estar
  `active` y no caducadas en el momento de la verificación, y la firma de un mandato debe ser `pq_over_classical`.
- Constructores de submandatos junto al constructor raíz: `createSubMandate` / `create_sub_mandate` /
  `CreateSubMandate`, y `sub_delegation` / `minimum_security_tier` en el constructor raíz
  (`create_delegation_mandate_with_options` y `MandateChainOptions` en Rust).
- `computeSecurityTier` / `compute_security_tier` / `SecurityTierInput.MandateChainTier` /
  `compute_security_tier_with_floor`, y la copia raíz `lib/security-tier.js` (`computeSecurityTier(intent,
  policyDecision, mandateChainTier)`), aceptan el nivel efectivo de una cadena verificada como entrada opcional
  que solo puede elevar el nivel (especificación §14.2); en Go, un `MandateChainTier` vacío significa que no hay
  cadena, y cualquier otro nombre que no sea un nivel cuenta como `elevated`. Los verificadores de bundles todavía no
  lo leen: un bundle no tiene ningún campo que lleve su cadena de mandatos.
- `tests/interop/v2/mandate_chain_vectors.json` (generado por
  `sdks/typescript/src/__tests__/generate-mandate-chain-vectors.ts`): cadenas de profundidad 1 y 2 que todo
  SDK debe aceptar con su profundidad y su nivel efectivo, cadenas que todo SDK debe rechazar (acciones ampliadas,
  clases de datos añadidas, límites relajados, un límite de 2^53 o de 2^53 + 1 escrito como el entero del formato de
  intercambio que un doble no puede representar, validez fuera de la del padre, profundidad más allá de `max_depth`,
  `parent_mandate_id` ausente o erróneo, nivel rebajado, raíz o intermedio revocados, un submandato
  firmado por el agente equivocado, ambas firmas presentes, `delegation_depth` errónea, y más) y los
  casos del nivel mínimo. Las cuatro suites de los SDK lo ejecutan.
- API experimentales y opt-in para el candidato de canonicalización `dcp-jcs-v2`
  (`docs/proposals/canonicalization-candidate`, §15–§18). El candidato no es normativo ni está
  activo: `dcp-jcs-v1` sigue siendo el único perfil de canonicalización normativo y predeterminado, y no cambia ningún
  valor predeterminado, constructor, firmante ni verificador. Solo quienes llaman y optan por ellas llegan a estas
  API, en TypeScript, Python, Go, Rust y WASM.
  - **Ingreso:** comprueba los bytes originales de una unidad (UTF-8, BOM, duplicados, enteros exactos en
    ±(2^53−1), profundidad 64) y da sus bytes canónicos o una clase y un desplazamiento.
  - **Enrutador:** extrae la unidad de su transporte, lee el perfil y decide: rechazar,
    delegar en `dcp-jcs-v1` mediante un decodificador histórico con nombre, o seleccionar el candidato.
  - **Verificador:** verifica a partir de los bytes originales con un único verificador como máximo: el actual para
    `dcp-jcs-v1`, y el actual aceptando exactamente `dcp-jcs-v2` para el candidato. Un bundle verificado
    no concede confianza ni admisión.
  - **Productores:** firman artefactos (`experimentalCandidateSignPayload` y sus equivalentes) y
    bundles cuyo manifiesto nombra `dcp-jcs-v2` (`experimentalCandidateSignBundle`), a partir de bytes
    originales o de valores del host comprobados de forma estricta. Un rechazo por el dominio o la forma de las
    entradas se produce antes de llamar a ningún firmante; un error de clave, de registro o de proveedor todavía puede
    llegar después de que se haya hecho una firma.
  - **Pruebas:** una matriz cruzada de cinco productores × cinco consumidores
    (`tests/interop/candidate/phase4`, 975 resultados con un veredicto de todo o nada) y su medición de
    coste, que ejecuta el nuevo flujo de trabajo `canonicalization-candidate-matrix`, que no publica
    nada. Los vectores están en `tests/interop/candidate/`.

<a id="changed"></a>

### Cambiado

- `dcp-ai verify` (`@dcp-ai/cli`) verifica los bundles V2 (`bundle.dcp_bundle_version` "2.0" o un
  `bundle.manifest`) con el verificador normativo: el sobre y los cuatro payloads firmados se
  validan con `schemas/v2`, cuyas copias se distribuyen en el paquete, y después se ejecuta `verifySignedBundleV2`
  de `@dcp-ai/sdk` con `DEFAULT_VERIFIER_POLICY` y los proveedores Ed25519, ML-DSA-65 y
  SLH-DSA-192f. El sobre prenormativo (`dcp_version` "2.0" o `bundle_manifest` en el nivel superior, o
  `signature.binding: "composite"`) se rechaza antes que nada, también cuando esas marcas están en un bundle V1 o
  V2, y su comprobación de `signature.classical.value` ha desaparecido, sin recurso a la firma clásica. Cuando existe
  `.dcp/keys/ed25519_public.key`, fija la clave de firma del principal entre las `binding_keys` del RPR (un archivo
  vacío se rechaza); sin él se usan las propias claves del bundle, lo que comprueba las firmas, no la confianza ni la
  admisión. La verificación V1 no cambia. `dcp-ai sign` tampoco cambia: añade a `signatures[]`, un formato que
  `verify` no lee; los bundles V2 se firman con `signBundleV2` o `dcp sign-bundle --composite`. El
  paquete exige ahora `@dcp-ai/sdk` `^2.2.0` y declara `ajv` y `ajv-formats`.
- `dcp-ai verify` (`@dcp-ai/cli`) sale con 0 solo cuando imprime VALID. Con archivos V1 sale ahora con 1,
  donde antes salía con 0, cuando la firma Ed25519 es INVALID, cuando falta la clave o falta una firma utilizable (imprime
  «No public key available», también cuando la clave está y la firma falta o está vacía) y cuando el archivo no es un
  bundle firmado (un objeto sin un `bundle` verdadero, un array o un valor primitivo). Esos mensajes no cambian, y
  la falta de un argumento o de un archivo, un JSON no válido, el base64 o un tamaño erróneo siguen saliendo con 1 y su
  error. Un script que tomaba la salida 0 como «se ejecutó» debe esperar ahora 1 en esos casos. Con un archivo V1, la
  salida 0 significa que la firma Ed25519 sobre el bundle canónico se verificó, nada más; con un bundle V2 significa que
  los esquemas y el verificador normativo pasaron (véase arriba). Ninguna de las dos es una decisión de admisión.
- Verificadores V2 de Go y Rust: una política que restringe `accepted_classical_algs` o `accepted_pq_algs`
  se rechazaba como un campo que no aplicaban, así que todo bundle fallaba con ella; ahora aplican
  ambas listas como hacen TypeScript y Python (la lista clásica salvo con `pq_only`), y una
  firma con un algoritmo fuera de ellas falla por no estar aceptada por la política del verificador. También
  aceptan `allow_v1_bundles: false`, que fija strict-v1: solo verifican bundles V2, así que
  el campo no cambia nada para ellos. Las políticas que verificaban antes se comportan igual.
- El verificador de referencia (`lib/verify.js`, `dcp verify-bundle`, el servidor de verificación y su
  imagen Docker) depende del `@dcp-ai/sdk` del workspace (`file:sdks/typescript`, empaquetado mediante
  `install-links` en `.npmrc`) hasta que 2.2.0 esté en npm, de modo que ejecuta las correcciones del verificador de esta
  versión en lugar del 2.1.1 publicado, que aceptaba 39 de los 79 vectores `must_reject_bundles`. Hay que compilar
  `sdks/typescript` antes de `npm install` en la raíz; la CI y `docker/Dockerfile` lo hacen. Para publicar
  hay que volver a subir la dependencia a `^2.2.0`.
- `lib/verify.js`: la validación de esquemas construye un Ajv por cada raíz de esquemas y compila cada esquema una
  sola vez, en el primer uso, en lugar de cargar y compilar todos los esquemas en cada llamada a `validateOne` (cinco
  por bundle V2). Validar los esquemas de un bundle V2 pasó de unos 34 ms a 0.14 ms (mediana de 20 ejecuciones
  después de la primera, que sigue compilando).

<a id="fixed"></a>

### Corregido

- **Cambio de aceptación: `v2.VerifyPayloadHash` de Go comprueba ahora el `payload_hash` normativo**
  (código fuente de `main`, no publicado; Go v2.11.1 conserva el defecto). Comparaba el SHA-256 en hex
  sin prefijo con `payload_hash`, así que devolvía `false` para la salida de `SignPayload` y para todo
  valor válido según el schema (`sha256:<hex>`), y `true` para el digest sin prefijo. Ahora devuelve
  `true` solo cuando `payload_hash` es exactamente `"sha256:"` seguido del SHA-256 en hex en
  minúsculas de los bytes `dcp-jcs-v1`, el valor que usan `SignPayload`,
  `schemas/v2/signed_payload.schema.json` y los helpers de TypeScript, Python y Rust. Un digest sin
  prefijo, hex en mayúsculas, espacios alrededor o cualquier otra forma devuelve ahora `false, nil`.
  Migración: pasa `payload_hash` tal como se recibió; para construirlo a partir de `PreparePayload`,
  escribe `"sha256:" + hash`. `PreparePayload` sigue devolviendo el digest sin prefijo (su comentario
  ahora lo dice), los errores de `nil` y de canonicalización no cambian, y el verificador de bundles,
  que nunca usó este helper, no cambia. El helper solo comprueba la consistencia del hash, no la
  firma, las claves, la política ni la admisión. Nuevo `sdks/go/dcp/v2/signed_payload_test.go`. El
  README de Go y el comentario de `AuditEvidenceV2` indican ahora también que decodificar un bundle
  recibido en los structs tipados descarta los miembros `null` y desconocidos de `evidence`, así que
  los bytes recibidos son los que hay que conservar y verificar.
- **Cambio de aceptación: `wasm_dual_merkle_root` de WASM y `dualMerkleRoot` de `@dcp-ai/wasm`
  calculan ahora la raíz Merkle dual de V2-11** (código fuente de `main`, no publicado;
  `@dcp-ai/wasm` 2.1.1 y anteriores mantienen el helper antiguo). El helper hasheaba el texto
  hexadecimal de dos digests concatenados y promovía el nodo impar, así que con 2 o más hojas sus
  raíces no coincidían ni con `spec/VERIFICATION.md` V2-11 (digests de 32 bytes en bruto
  concatenados, el último nodo duplicado en una capa impar) ni con los SDK de TypeScript, Python, Go
  y Rust. Ahora delega en el núcleo de Rust `v2::dual_hash::dual_merkle_root`. El cambio no se
  limita a las raíces multihoja: estas cambian porque eran incompatibles con V2-11; una hoja que no
  es un digest hexadecimal de 32 bytes es ahora un error en lugar de hashearse como texto; y las
  raíces son siempre hex en minúsculas, así que una sola hoja dada en mayúsculas vuelve ahora en
  minúsculas. Una sola hoja válida en minúsculas, el formato del resultado y los errores para un
  array vacío y para una entrada que no es JSON no cambian. La verificación de bundles, incluido el
  verificador WASM, ya usaba la reducción correcta y no cambia; los bundles anteriores y su
  evidencia no se reescriben ni se vuelven a firmar, porque el cambio se limita a este helper. Los nuevos vectores públicos
  `tests/conformance/v2/merkle_vectors.json` (raíces exactas para 1, 2, 3 y 5 hojas y para hojas
  reordenadas, generadas sin conexión con la biblioteca estándar de Python y ancladas en las raíces
  golden de 2 hojas) se comprueban con `sdks/wasm/test/dual-merkle-root.mjs` y
  `sdks/rust/tests/dual_merkle_vectors.rs`.
- `denyListRevocationSource` (`@dcp-ai/express`, `@dcp-ai/openclaw`) dejaba respuestas abiertas. Una respuesta
  que no era 2xx o un `Content-Length` declarado de más de 16 MiB se rechazaba sin leer ni cerrar su
  cuerpo: la respuesta seguía abierta después de que la llamada terminara y se liberara su hueco, fuera del alcance del
  tiempo de espera y de la señal de quien llamaba. Y con Node 22.15 (undici 6.21.2), una recolección de basura tras
  las cabeceras impedía que la señal del fetch llegara a un cuerpo que se estaba leyendo: su propio tiempo de espera y
  el plazo del supervisor ya no detenían un cuerpo que seguía llegando, y la llamada nunca terminaba,
  reteniendo su hueco. Ahora aborta su fetch y cancela el cuerpo en todas las salidas, detiene su propia lectura
  con su señal y libera el lector. Los códigos, los valores predeterminados y las capacidades no cambian; no se drena
  nada y no se espera al cierre remoto.
- CLI de referencia (`bin/dcp.js`): las rutas se limitaban al directorio de trabajo tal como estaban escritas, no
  adonde llevaban, y varias lecturas y escrituras se saltaban la comprobación. Un enlace simbólico dentro del
  directorio de trabajo, o una ruta a otro directorio (`keys rotate --key-dir`, `governance sign-advisory
  --key-dir`, `governance verify-advisory --sigs`), permitía que un comando leyera archivos de fuera, incluidas
  las claves secretas; un enlace simbólico o duro en una ruta de salida (`keygen`, `keys rotate`,
  `recovery-setup`, los comandos de gobernanza, la salida de `sign-bundle` V1) hacía que escribiera fuera;
  un archivo de clave secreta existente conservaba unos permisos más amplios; y `dcp validate`, `conformance` y
  `sign-bundle` V1 ejecutaban `tools/*.js` desde el directorio de trabajo, así que se ejecutaba un script colocado
  allí. Ahora toda ruta se resuelve con sus enlaces simbólicos (uno colgante se rechaza) y se comprueba, toda lectura
  y escritura de una ruta del usuario pasa por esa comprobación, los archivos se escriben en un archivo nuevo
  (`O_EXCL`, permisos exactos) que se renombra sobre el destino, y la CLI ejecuta sus propias herramientas. La CLI
  supone que nada más cambia el directorio de trabajo mientras se ejecuta un comando; en Windows, donde
  `O_NOFOLLOW` no existe, el renombrado sigue sustituyendo un enlace en lugar de escribir a través de él.
- `@dcp-ai/anthropic-mcp` y `@dcp-ai/google-a2a`: la condición de exportación `"types"` iba primero, así que
  un consumidor CommonJS recibía las declaraciones ESM (`dist/index.d.ts`) y TypeScript rechazaba
  `require()` con `node16` con TS1471. Se elimina la condición, de modo que `require` recibe
  `dist/index.d.cts` e `import` recibe `dist/index.d.ts`. `@dcp-ai/sdk`, `@dcp-ai/express` y
  `@dcp-ai/openclaw` quitan la misma condición, que iba después de `"import"` y `"require"`, nunca
  coincidía y hacía que tsup advirtiera en cada compilación. En `@dcp-ai/wasm`, cuyas exportaciones no tienen
  `"require"`, daba a un consumidor CommonJS tipos con `nodenext` para un `require()` que Node rechaza con
  `ERR_PACKAGE_PATH_NOT_EXPORTED`. TypeScript informa ahora TS2307 también ahí.
- SDK de Go: `VerifySignedBundleV2WithPolicy` hacía fallar todo bundle con una política que fijaba
  `require_session_expiry`, `require_audience_binding` o `verifier_id`, campos que
  `verifier_policy.schema.json` enumera y que los verificadores de TypeScript y Python aplican. `VerifierPolicy`
  los tiene ahora (`RequireSessionExpiry`, `RequireAudienceBinding`, `VerifierID`, desactivados en su valor cero) y
  el verificador los aplica como TypeScript: un manifiesto sin `session_expires_at`, sin
  `intended_verifier` o destinado a otro verificador distinto de `verifier_id` se rechaza.
- SDK de Rust y `@dcp-ai/wasm`: `VerifierPolicy` rechazaba `require_session_expiry`,
  `require_audience_binding` y `verifier_id`, que `schemas/v2/verifier_policy.schema.json`
  enumera y que los verificadores de TypeScript y Python aplican, así que una política que fijara cualquiera de ellos
  hacía fallar toda verificación. Ahora se aplican como en TypeScript: con `require_session_expiry`, un
  manifiesto sin `session_expires_at` se rechaza, y con `require_audience_binding`, uno
  sin `intended_verifier` o, con `verifier_id` fijado, con otro distinto. El `BundleManifest` de Rust
  gana `intended_verifier`.
- SDK de Python, `dcp_ai.langchain` (`DCPTool.run`, `DCPTool.arun`) y `dcp_ai.openai`
  (`dcp_verify_bundle` en `handle_dcp_tool_call`): ambos enviaban todo bundle al verificador V1, así que
  todo bundle V2 se rechazaba y un bundle V1 se aceptaba sin ninguna política de verificación. Ahora
  verifican los bundles V2 con `verify_signed_bundle_v2` y un registro Ed25519 / ML-DSA-65 / SLH-DSA-192f
  construido una sola vez, con una política de verificación que fija quien llama (`DCPTool(verifier_policy=...)`,
  `handle_dcp_tool_call(..., verifier_policy=...)`, sobre `DEFAULT_VERIFIER_POLICY`), y devuelven los
  errores del verificador, como máximo 20 errores y 20 advertencias de 500 caracteres cada uno, con los caracteres de
  control y de formato del texto aportado por el bundle (un `agent_id`, una marca de tiempo no válida) escapados, de
  modo que un bundle no pueda meter megabytes ni saltos de línea en el contexto del modelo. Un bundle V1 solo se acepta
  con la regla V2-10 del middleware de FastAPI, ahora compartida por los tres puntos de entrada
  (`dcp_ai._verify_any`) y ampliada a toda la política: la política permite bundles V1, acepta
  ed25519 (en `accepted_classical_algs`, no en `advisory_rejected_algs`), no exige vinculación de audiencia,
  caducidad de sesión ni duración máxima de sesión (un bundle V1 no tiene `intended_verifier` ni
  ventana de sesión), y aceptaría un bundle solo clásico para su nivel de riesgo y su nivel de seguridad; el
  middleware de FastAPI aplica también las condiciones añadidas. Un bundle V1 cuyos artefactos no son
  objetos, o cuyo `audit_entries` no es una lista de objetos, se rechaza en los tres (el
  middleware de FastAPI respondía 500 para un `agent_passport` que no era un objeto, ahora 403), y
  `dcp_ai.verify.verify_signed_bundle` devuelve un error en lugar de lanzar una excepción ante un bloque de firma,
  una clave o una pista de auditoría mal formados. Un bundle V1 cuyo `agent_id` del pasaporte o `human_id` del RPR
  no sea una cadena (o cuyo `public_key`, `status` o `capabilities` del pasaporte tenga el tipo incorrecto) también se
  rechaza, en lugar de llegar al contexto del agente de FastAPI. Las respuestas 403 del middleware de FastAPI y los
  `warnings` de su contexto se limitan y se escapan igual que la salida de los puentes. Una instancia de
  `VerifierPolicy` se valida como un dict, de modo que una construida con `model_construct` o
  modificada por asignación no puede llevar un valor no válido, y un nivel de riesgo que sus `risk_overrides` omiten
  recibe su `default_mode`, como lo resuelven el verificador V2 y `resolveMode` del SDK de TypeScript
  (un bundle V1 para ese nivel se rechazaba con «is not low, medium or high»). Los puntos de entrada
  síncronos funcionan dentro de un bucle de eventos en ejecución (la verificación se ejecuta en un hilo de trabajo)
  y usan un bucle privado, dejando el bucle de eventos actual del hilo como estaba; `DCPTool.arun`
  espera la verificación, y el nuevo `averify_bundle_tool_call` es la forma asíncrona de la llamada a herramienta de
  OpenAI. Ambos superan todos los casos de `tests/interop/v2/bundle_vectors.json`.
- SDK de Go: `BundleManifest` no tenía `intended_verifier`, así que un manifiesto decodificado en él y codificado
  de nuevo perdía el campo y su firma dejaba de verificarse. El campo está ahora
  (`IntendedVerifier`, omitido cuando está vacío); una prueba hace el viaje de ida y vuelta de un manifiesto con todos
  los campos del esquema.
- SDK de Python, `dcp_ai.crewai`: los agentes de un `DCPCrew` nunca compartían el nonce de sesión del crew.
  `DCPCrewAgent` siempre generaba el suyo, así que la comprobación del crew de un agente sin nonce nunca se
  aplicaba, y las entradas de auditoría de cada agente llevaban un `session_nonce` distinto. Ahora un crew da
  su nonce a todo agente que siga teniendo el nonce que generó para sí mismo y que todavía no haya registrado
  nada; un nonce dado al agente, o fijado en él más tarde, se mantiene.
- Característica `wasm` de Rust y `@dcp-ai/wasm`: `wasm_sign_bundle` (`signBundle`) escribía
  `created_at ""` y ningún `signer.id`, así que el verificador de referencia, la CLI y el servidor rechazaban
  todo bundle que firmaba (`created_at must match format "date-time"`, `signer must have required
  property 'id'`). `wasm_build_bundle` (`buildBundle`) unía las hojas de auditoría SHA3-256 con
  SHA-256, a diferencia de todos los demás SDK, y se saltaba una entrada de auditoría que no podía canonicalizar
  aunque la seguía contando. Ambos llaman ahora a `build_bundle_v2` y `sign_bundle_v2`, así que `buildBundle` también
  rechaza un `payload_hash` que no coincide con su payload y un artefacto o una entrada de otra
  sesión. Sin `sessionNonce`, `buildBundle` generaba un nonce que ningún artefacto llevaba, así que incluso
  `verifyBundle` rechazaba el bundle; ahora toma el `session_nonce` del RPR. La demostración `example.html`
  pasaba payloads en bruto a `wasm_build_bundle`, que nunca los aceptó; ahora firma primero cada
  artefacto. El tipo `SignedBundleV2` declara `signer.id`.
- SDK de Rust: `Ed25519Provider::sign` entraba en pánico con una clave secreta de menos de 32 bytes (en wasm, una
  trampa en lugar de un error JSON); ahora devuelve `invalid secret key length`.
- Cadenas de mandatos (los cuatro SDK): una entrada de submandato sin `data_classes` bajo una entrada del padre
  que las tiene pasaba la atenuación, aunque entonces nada la ataba a las clases de datos del padre.
  Ahora se rechaza (`data_classes for domain "<d>" missing`), como ya ocurría con una clave de `limits` ausente;
  DCP-09 §3.5.2, regla 5, así lo dice. Vector compartido `dropped_data_classes`.
- SDK de Go: un `A2ASession` usado desde varias goroutines hacía caer el proceso (`fatal error:
  concurrent map writes` en `DecryptMessage`). La sesión tiene ahora un mutex, así que
  `EncryptMessage`, `DecryptMessage` y `NeedsRekeying` pueden ejecutarse a la vez; las secuencias siguen siendo
  únicas y cada mensaje se sigue aceptando una sola vez. `IntentV2` gana `SecurityTier` y
  `PolicyDecisionV2` gana `ResolvedTier` (ambos opcionales en el esquema y omitidos cuando están vacíos), de modo que
  quien integre en Go usando los payloads tipados puede declararlos.
- `tools/difffuzz`: `prototype_key_as_key` asignaba `__proto__` como una propiedad normal, lo que fija el
  prototipo en lugar de añadir una clave, así que esos mutantes nunca llevaban la clave que decían (y un
  ciclo podía hacer caer la ejecución); ahora define una clave propia. Un adaptador que no puede arrancar o que murió
  entre veredictos se informa como cierre inesperado en lugar de como un error no gestionado. `spec/VERIFICATION.md`
  nombra ahora correctamente el constructor de bundles de Rust (`wasm_build_bundle`, solo con la característica `wasm`).
- SDK de Go: `SignBundleV2` dejaba vacío `signature.signer.id`, lo que `signed_bundle.schema.json`
  prohíbe, así que el verificador de referencia, la CLI y el servidor rechazaban todo bundle que firmaba mientras
  los cuatro verificadores de los SDK lo aceptaban (lo encontró `tools/interop-matrix`). El firmante es ahora el
  principal responsable del bundle (`signer.id` = el `human_id` del RPR), y un bundle cuyo RPR no tiene
  `human_id` se rechaza antes de firmar.
- Sesiones A2A (TypeScript, Python, Go): `decryptMessage` / `decrypt_message` / `DecryptMessage`
  guardan las secuencias aceptadas dentro de la ventana de recepción y aceptan cada una una sola vez, también fuera
  de orden; una secuencia que no es un entero no negativo se rechaza, y una secuencia solo se
  registra después de verificar su etiqueta de autenticación. Una secuencia que va una ventana completa o más por
  delante del contador de recepción se rechaza (DCP-04 §8.4). Una sesión restaurada sin el nuevo campo (TypeScript
  `undefined`, Go `nil`, Python `None`, el valor predeterminado del constructor) cuenta como recibidas todas las
  secuencias de la ventana por debajo de su contador de recepción. `verifyResumeProof`
  (TypeScript) compara en tiempo constante, como ya hacían Python y Go. Se documenta que la sesión de Go
  no es segura para uso concurrente.

- SDK de Rust: `serde_json` tiene ahora `float_roundtrip`. Su analizador rápido de números en coma flotante se
  equivoca en un ULP con literales decimales largos, así que `9007199254740991.0` (que `dcp-jcs-v1` lee como el entero
  9007199254740991, como hacen todos los demás SDK) se convertía en 9007199254740990 y `2251799813685247.0`
  en un no entero, y el verificador de Rust rechazaba firmas y límites que los verificadores de TypeScript, Python y
  Go aceptan. Vector compartido `limits_written_in_decimal_form`.
- `@dcp-ai/wasm`: el paquete npm incluye `pkg/` (el binario `.wasm` y su código de enlace). wasm-pack escribe
  `pkg/.gitignore` = `*`, npm respeta los archivos `.gitignore` anidados, y `@dcp-ai/wasm@2.0.0` se publicó
  sin `pkg/`, así que su importación en tiempo de ejecución de `../pkg/dcp_ai.js` fallaba. La compilación elimina ese
  archivo y la suite de pruebas comprueba el tarball.
- `@dcp-ai/sdk`: la versión de telemetría incluida se lee de `package.json` en tiempo de compilación (`tsup.config.ts`)
  en lugar de un literal del script de compilación; 2.2.0 se habría identificado como 2.1.2.
- `verify_signed_bundle_v2` de Python informaba de un artefacto sin `composite_sig` como
  `Malformed signed bundle: KeyError('composite_sig')`; el error nombra ahora el artefacto
  (`intent: Missing composite signature`), como en los demás SDK.
- `verifySignedBundleV2` de TypeScript devuelve un veredicto fallido (`Malformed signed bundle: ...`) para un
  bundle firmado estructuralmente mal formado en lugar de lanzar una excepción: un `bundle`, `signature`,
  `manifest` o `audit_entries` ausente, `null` o que no es un objeto, una entrada de auditoría `null`, o un número
  no entero (`0.5`, `1e400`) en un objeto canonicalizado (`spec/VERIFICATION.md` V2-3, V2-5). Los
  verificadores de Python, Go y Rust ya los rechazaban; lo encontró `tools/difffuzz`.
- `VerifyObject` V1 de Go entraba en pánico con una clave pública que no se decodificaba a 32 bytes (`ed25519.Verify`
  entra en pánico con cualquier otra longitud). Ahora comprueba la longitud decodificada y devuelve un error.
  `VerifySignedBundle` mantiene su comportamiento alrededor: una clave pública vacía recurre a la
  incrustada en la firma, si faltan ambas da `missing public key`, y un error de
  `VerifyObject` se informa como `SIGNATURE INVALID`.
- El decodificador CBOR de TypeScript (`sdks/typescript/src/wire/cbor.ts`, opcional) rechaza claves de mapa
  duplicadas, UTF-8 no válido, y enteros y longitudes fuera del rango de enteros seguros. Conserva U+FEFF como
  dato de texto, define una clave `__proto__` como propiedad propia en lugar de invocar el setter, y el
  codificador rechaza los sustitutos (surrogates) aislados en lugar de reemplazarlos. Esto refuerza el tratamiento de
  la entrada del decodificador; no es un decodificador CBOR canónico completo ni añade ningún perfil de
  canonicalización.

<a id="documentation"></a>

### Documentación

- `docs/QUICKSTART_CREWAI.md`: ninguno de los dos ejemplos funcionaba. El V1 importaba `build_bundle`, que el
  SDK de Python no tiene, y escribía firmas donde `intent_hash` y `prev_hash` llevan hashes;
  el V2 usaba una API que nunca se publicó y decía que el SDK de Python no tenía constructor, firmante ni
  verificador de bundles V2, aunque `dcp_ai.v2` los incluye (desde 2.9.0). Ambos usan ahora el SDK
  tal como es: un control de política decide antes de que se ejecute la herramienta, la consulta de búsqueda queda
  fuera del registro, cada llamada a herramienta sella su propio bundle, y la verificación fija al operador (V1: su
  clave pública; V2: el hash de su RPR y sus kids con `hybrid_required`, y que cada kid se derive de su clave,
  porque las propias claves del bundle solo lo hacen coherente consigo mismo). Los bundles se verifican en Python y con
  `dcp verify-bundle`, y los V2 también con los SDK de TypeScript, Go y Rust. La guía importa `tool` de
  `crewai.tools`, como lo documenta CrewAI, y describe el andamiaje de `npm create @dcp-ai/crewai` como el
  recorrido con marcadores que es.
- `integrations/crewai/README.md`: los ejemplos usaban payloads V1 con valores que los esquemas rechazan
  (`liability_mode: "full"`, la capacidad `write_file`) e imprimían un campo `action_type` que las entradas de
  auditoría no tienen. Ahora funcionan; el README dice que `DCPCrewAgent` y `DCPCrew` guardan
  registros sin firmar y no ejecutan CrewAI, y enumera los parámetros `session_nonce`.
- Documentación en inglés y en las traducciones es, zh-CN, ja y pt-BR puesta al día:
  cadenas de delegación en el README de cada SDK, la ventana de recepción A2A, Testing & Assurance (matriz de
  interoperabilidad, fuzzer diferencial, vectores compartidos), hechos corregidos (Go 1.25, los crates FIPS de Rust,
  un ejemplo de DCP-09 en TypeScript que usaba campos fuera del esquema) y las filas del README que les faltaban a
  las traducciones.
- `docs/EU_AI_ACT_MAPPING.md`: cómo apoyan los artefactos de DCP-AI las obligaciones de registro, supervisión
  humana, conservación de registros, explicación y evidencia de incidentes del Reglamento (UE) 2024/1689 (Ley de IA
  de la UE), modificado por el Reglamento (UE) 2026/1744, con el calendario de aplicación, una lista de comprobación
  para quien implementa y las carencias que DCP no cubre. Artículos verificados en EUR-Lex el 22 de octubre de 2026.
- `spec/DCP-09.md` §3.5 especifica ahora la subdelegación sobre los campos reales del formato de intercambio, con
  reglas normativas de verificación de la cadena; §2, §10.3 y §10.6 enumeran el contexto `DCP-AI.v2.SubMandate`.
  `spec/DCP-AI-v2.0.md` §4.1 enumera las etiquetas de contexto `DCP-AI.v2.Delegation` y `DCP-AI.v2.SubMandate`,
  y §14.2 establece que el nivel efectivo de una cadena de delegación es una entrada que solo puede elevar el nivel.


## [2.10.0] - 2026-10-22

<a id="package-versions"></a>

### Versiones de paquetes

- `dcp-ai` (PyPI) 2.8.2 → 2.9.0: pqcrypto 1.x, SLH-DSA de FIPS 205, ML-KEM-768, bundles V2 y un verificador
  V2; incompatible para `blind_rpr` (exige `pii_salt`) y para instalaciones con `pqcrypto<1.0`.
- `@dcp-ai/sdk` (npm) 2.1.2 → 2.2.0: correcciones de seguridad en `verifySignedBundleV2`, aplicación del nivel de
  seguridad, exportaciones de RPR cegado; incompatible para `blindRpr` (exige `pii_salt`).
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` v2.9.0 → v2.10.0: refuerzo del verificador V2 y
  aplicación del nivel; incompatible para `BundleBuildInput` (artefactos firmados) y `BlindRPR`.
- `dcp-ai` (crates.io) 2.9.0 → 2.10.0: verificador V2 nativo, aplicación del nivel, análisis de la caducidad
  RFC 3339; incompatible para `blind_rpr` y el constructor de bundles de `wasm`.
- `@dcp-ai/wasm` 2.0.0 → 2.1.0: `buildBundle` acepta artefactos firmados; `verifyBundle` acepta una
  política de verificación completa.
- `@dcp-ai/openclaw` 2.0.0 → 2.1.0: nivel mínimo de seguridad y `pii_salt` en los RPR firmados.
- Sin cambios: `@dcp-ai/cli` 2.0.0 y los demás paquetes de integración.

<a id="security-1"></a>
<a id="security_1"></a>

### Seguridad

- Los compromisos de los RPR cegados llevan sal, en los cuatro SDK. `pii_hash` era
  `sha256(canonical({ contact, legal_name }))`, así que cualquiera que adivinara el nombre y el contacto de un
  principal podía confirmar su suposición con un RPR cegado publicado, y en un log o anclaje inmutable eso
  sigue siendo cierto para siempre. El RPR completo lleva ahora `pii_salt` (32 bytes de un CSPRNG, hexadecimal en
  minúsculas), que se firma con él y nunca se publica, y `pii_hash` es
  `sha256(canonical({ contact, legal_name, pii_salt }))`. Borrar el RPR completo, y con él la
  sal, deja el compromiso publicado sin poder abrirse (`spec/DCP-AI-v2.0.md` §12.1). Un `contact` o `legal_name`
  ausente se incluye en el hash como `null` en todos los SDK; TypeScript omitía antes la clave. La nueva
  categoría `blinded_rpr` de `tests/interop/v2/interop_vectors.json` (`pii_hash` con sal y heredado,
  registro cegado esperado) se ejecuta en las cuatro suites de los SDK, y `generate-interop-vectors.ts` la emite.
- La verificación de RPR cegados (`verifyBlindedRpr`, `verify_blinded_rpr`, `VerifyBlindedRPR`) compara ahora
  también `session_nonce` y `binding_keys`, en los cuatro SDK. Antes, un RPR completo con otras claves de
  vinculación o con otro nonce de sesión seguía coincidiendo con el registro cegado. En Go, los campos de lista
  decodificados de JSON ya no dejan de coincidir con la misma lista construida como `[]string`.
- Servidor de verificación: `POST /v2/passport/register` verifica la autofirma compuesta del pasaporte y
  registra solo sus claves de firmante; volver a registrar un `agent_id` exige un pasaporte más reciente
  firmado por todas sus claves activas. Cualquiera podía volver a registrar un agente con sus propias
  claves, colocar su token de emergencia y revocarlo de emergencia. `POST /v2/keys/rotate` verifica la
  prueba de posesión y la autorización de la clave antigua (`verifyKeyRotation`), y
  `POST /v2/multi-party/authorize` verifica la firma de cada parte con sus claves registradas,
  contando cada parte una sola vez.
- Servidor de verificación: `/v2/policy/mode`, `/v2/governance/register`, `/v2/advisory/publish` y
  `/v2/advisory/auto-apply` exigen `Authorization: Bearer $OPERATOR_TOKEN` (bloqueados si no está fijado).
  Los avisos se validan con el esquema y se limitan a 1000. Los límites de tasa usan como clave la dirección del
  socket, no la cabecera `X-Forwarded-For` que aporta el cliente (`TRUST_PROXY=true` detrás de un proxy), y
  `VERIFIER_MODE` / `ALLOW_V1_BUNDLES` se leen del entorno; `allow_v1_bundles` se aplica ahora.
- Servicio de revocación: los agentes se registran con su pasaporte firmado (`POST /v2/register`), que
  registra la propiedad de los kids, la caducidad de las claves y el token de emergencia; volver a registrarse exige
  un pasaporte más reciente firmado por las claves clásica y PQ activas del agente, y `/revoke` y `/v2/revoke` deben
  estar firmados por sus claves activas. `GET /v2/check/kid/:kid` informa de las revocaciones de emergencia de los
  kids registrados sin `?agent_id=`.
- Servicio de anclaje: ya no hay `tx_hash` aleatorio (los registros llevan `tx_hash: null`, `onchain: false`),
  los cuerpos se limitan a 1 MB, `POST /flush` necesita el token del operador y una entrada mal formada es un 400
  en lugar de un cierre inesperado. Registro de transparencia: las cabeceras del árbol se firman con Ed25519 en lugar
  de un HMAC que nadie más podía verificar; `OPERATOR_KEY` debe ser la semilla de 64 caracteres hexadecimales (se
  eliminaron los marcadores públicos del compose), el árbol de Merkle usa los prefijos de hoja y nodo de RFC 6962, y
  `POST /gossip/peers` (un vector de SSRF) necesita el token del operador.
- Servidor de verificación y servicio de revocación: las claves caducadas ya no pueden volver a registrar un
  pasaporte, autorizar una rotación de claves ni firmar por una parte o una revocación, y volver a registrarse
  conserva las entradas de clave registradas, de modo que un pasaporte nuevo no puede ampliar el `expires_at` de una
  clave.
- Las configuraciones de Fly mantienen en ejecución una máquina de verificación y una de revocación: escalar a cero
  borraba sus registros en memoria cada vez que la máquina quedaba inactiva.
- SDK de TypeScript: `verifySignedBundleV2` implementa los pasos V2-7 y V2-8 de `spec/VERIFICATION.md`. Una
  firma PQ presente (`pq_over_classical`) debe verificarse en todos los modos; `hybrid_preferred`
  (el predeterminado para riesgo medio) aceptaba una no válida con una advertencia y `classical_only`
  la ignoraba. Solo se tolera que falte (vinculación `classical_only`), y no con
  `hybrid_required` ni `pq_only`. La `composite_sig` propia de cada artefacto se verifica ahora con las
  mismas reglas y su etiqueta de contexto: el RPR con sus `binding_keys`, y el pasaporte, la intención y la
  decisión de política con las `keys` del pasaporte. Antes solo se comprobaba `payload_hash`, así que una firma
  falsificada del agente en la intención se verificaba incluso con `hybrid_required`. El verificador de
  referencia, `dcp verify-bundle` y el servidor lo reciben con la próxima versión de `@dcp-ai/sdk`.
- SDK de TypeScript: `verifySignedBundleV2` falla de forma cerrada ante un modo de verificación que no reconoce,
  y rechaza una política de verificación cuyo modo no sea `classical_only`, `hybrid_preferred`,
  `hybrid_required` ni `pq_only`.
- SDK de Go (`v2.VerifySignedBundleV2`) y de Rust: la `composite_sig` de cada artefacto se verifica del
  mismo modo (V2-8), y las claves del firmante se buscan por `kid` (V2-6), el firmante del bundle en las `keys` del
  pasaporte y en las `binding_keys` del RPR. Antes tomaban por algoritmo las claves Ed25519 y
  ML-DSA-65 del pasaporte, así que rechazaban bundles firmados con las claves del principal y
  daban por verificado, con una advertencia, un bundle cuyo pasaporte no enumeraba ninguna clave Ed25519, sin
  comprobar su firma.
- SDK de TypeScript, Go y Rust: en toda firma compuesta, en todos los modos de verificación, el hueco
  clásico debe contener Ed25519 y el hueco PQ ML-DSA-65 o SLH-DSA-192f, de una clave cuyo
  `alg` sea el mismo. Go rechaza también un bundle cuyo RPR, pasaporte, intención o decisión de política sea
  null o no sea un objeto, donde antes se saltaba todas las comprobaciones de ese artefacto, y TypeScript devuelve
  `verified: false` para un bundle así en lugar de lanzar una excepción.
- Nivel de seguridad (especificación §14.2): el SDK de Go y el binding de `@dcp-ai/wasm` (`wasm_compute_security_tier`)
  reconocían `payment`/`transfer`, `financial`, `health`, `legal` y `biometric`, que el esquema de la intención
  no permite, así que intenciones válidas según el esquema `initiate_payment`, `financial_data` y `health_data` eran
  `routine` ahí y `elevated` en los SDK de TypeScript, Python y Rust. Los cuatro SDK y el binding
  calculan ahora el mismo nivel, comprobado por los nuevos vectores `security_tier` de
  `tests/interop/v2/interop_vectors.json`.
- Servidor de verificación: `resolved_tier` en `POST /verify` y `POST /v2/bundle/verify`, y la comprobación del
  nivel de `/v2/bundle/verify`, tomaban `intent.security_tier` tal cual, así que un agente que declaraba
  `routine` rebajaba su propio nivel, y leían `risk_score` de la intención, cosa que el esquema no
  permite. Ahora usan la regla de §14.2 (`lib/security-tier.js`): `risk_score` de la decisión de política del
  bundle, `estimated_impact`, valores desconocidos a `elevated` y un nivel explícito que solo puede
  elevar el resultado. `/v2/intent/declare` calcula `resolved_tier` del mismo modo.
- Integración de OpenClaw: `dcp_verify_bundle` y `dcp_log_action` usaban `intent.security_tier` tal cual
  (`security_tier ?? computeSecurityTier(intent)`), así que un nivel declarado podía rebajar el calculado, y no
  pasaban ninguna decisión de política. El nivel explícito ahora solo eleva el nivel. También se pasa la decisión de
  política, de modo que `risk_score` cuenta en cuanto `@dcp-ai/sdk` la lea (la versión posterior a 2.1.2).
- Denegación de servicio en los servicios de referencia, cuyo estado vive en memoria y no sobrevive a un
  reinicio:
  - Servidor de verificación: los registros tienen un límite de tasa por cliente (`REGISTRATIONS_PER_HOUR`,
    20 por hora de forma predeterminada), la rotación solo conserva las 4 claves retiradas más recientes de un agente,
    y de un pasaporte registrado solo se almacena `created_at`. Un agente que rotaba una y otra vez, o una
    avalancha de registros, llenaba el registro de 10 000 claves (507 hasta un reinicio), y cada
    pasaporte firmado almacenado podía ocupar hasta 1 MB. Las claves descartadas siguen revocadas como lápidas y
    nunca pueden volver a registrarse, y un agente puede registrar como máximo `MAX_KEYS_PER_AGENT` claves (64)
    en toda su vida. Una rotación descarta una clave retirada antes de comprobar el límite, así que sigue cabiendo en
    un registro lleno. La comprobación de la familia de claves al volver a registrarse ya no recorre el registro de
    forma cuadrática.
  - Registro de transparencia: `POST /gossip/exchange` solo acepta una cabecera de árbol bien formada y firmada por
    un par fijado, en un cuerpo de 16 KB como máximo, y conserva las últimas 100 alertas distintas, de modo que una
    cabecera de árbol reproducida no puede desplazar a las anteriores. Las cabeceras de árbol obtenidas por sondeo
    deben verificarse con la clave fijada del par, y un sondeo lee como máximo 16 KB, agota su tiempo tras un
    intervalo y nunca se solapa con el anterior. Antes, cualquiera podía llenar la lista de alertas con cadenas de
    1 MB, nunca se verificaba ninguna cabecera de árbol de un par, y un par que no respondía acumulaba sondeos.
  - Servicio de revocación: `POST /v2/register` tiene un límite de tasa por cliente y un tope de
    `MAX_AGENTS` (10 000 de forma predeterminada), y los campos almacenados están acotados, así que una avalancha de
    registros o de registros demasiado grandes ya no puede dejarlo sin memoria y borrar todas las revocaciones.
- Servidor de verificación y servicio de revocación: registrar un `agent_id` nuevo necesita el token del
  operador. Un pasaporte solo está autofirmado, así que cualquiera podía registrar primero el `agent_id` de una
  víctima, con sus propias claves y token, y después revocarlo de emergencia o dejar fuera al agente real con un 409.
  Cada reinicio volvía a exponer a ello todos los `agent_id`. `GET /v2/check/kid/:kid` responde 404
  (`registered: false`) para un kid que nunca registró, en lugar del veredicto de cualquier agente que quien llama
  nombrara en `?agent_id=`.
- Servidor de verificación y servicio de revocación: las claves públicas y las firmas deben ser el base64
  canónico de exactamente el tamaño de su algoritmo, y los esquemas V2 restringen `public_key_b64` y
  `sig_b64` al alfabeto base64 y limitan su longitud. Los decodificadores permisivos se saltaban los espacios en
  blanco, así que una clave ML-DSA rellenada con 900 KB de espacios se registraba y se devolvía, y las firmas
  rellenadas se almacenaban y publicaba `/v2/list`.
- `verifySignedBundleV2` del SDK de TypeScript aplica el nivel de seguridad (especificación §14.3): verifica con
  el más estricto entre el modo de la política y el modo del nivel calculado a partir de la intención y la decisión
  de política firmadas, y lo informa en `details.resolved_tier`. Antes, el modo salía solo del
  `passport.risk_tier` del propio agente, así que con `DEFAULT_VERIFIER_POLICY` un pasaporte que declaraba
  `risk_tier: "low"` obtenía `classical_only` incluso para una intención de pago.
- SDK de TypeScript: `AdaptiveRateLimiter.check`, `generateSessionExpiry` y `VerificationCache.set`
  cuentan un nombre de nivel desconocido, o una clave del prototipo como `constructor`, como `elevated`. El limitador
  de tasa daba a cada nombre inventado su propio contenedor, `generateSessionExpiry` lanzaba una excepción con
  `constructor`, y la caché nunca hacía caducar esas entradas.
- Integración de OpenClaw: `dcp_declare_intent` calculaba el nivel que firma en la intención y en la
  decisión de política antes de puntuar la intención. Ahora pasa la puntuación de riesgo, que cuenta en cuanto
  `@dcp-ai/sdk` la lea (la versión posterior a 2.1.2).
- Los verificadores de Go (`v2.VerifySignedBundleV2`), Rust (`v2::verify_bundle::verify_signed_bundle_v2` y el
  binding `wasm_verify_signed_bundle_v2` que hay tras `verifyBundle` en `@dcp-ai/wasm`) y Python
  (`verify_signed_bundle_v2`) aplican el nivel de seguridad como el de TypeScript: el modo es
  el más estricto entre el modo de la política y el del nivel, aplicado a la firma del bundle y a la firma de cada
  artefacto; un modo de política desconocido falla de forma cerrada; y el resultado informa del nivel y del
  modo. Los verificadores de Go y Rust no tenían política de verificación y aceptaban firmas `classical_only` para
  cualquier intención.
- `verify_signed_bundle_v2` del SDK de Python: en toda firma compuesta, en todos los modos, el hueco clásico
  debe contener Ed25519 y el hueco PQ ML-DSA-65 o SLH-DSA-192f, de una clave cuyo `alg` sea el
  mismo, como en los SDK de TypeScript, Go y Rust. Con `pq_only` aceptaba ML-DSA-65 en el
  hueco clásico.
- SDK de Go y de Rust: una firma compuesta debe llevar su miembro `pq`, `null` en el caso de `classical_only`
  (`schemas/v2/composite_signature.schema.json`). Decodificaban un `pq` ausente como `null` y
  verificaban una firma `classical_only` así, que los verificadores de TypeScript y Python rechazan.
  `bundle_vectors.json` lo fija con `classical_only_bundle_signature_without_pq`.
- Los verificadores V2 de Go y Rust atan la pista de auditoría al manifiesto firmado, como hacen los de TypeScript y
  Python: recalculan `audit_merkle_root`, comprueban `audit_count` y exigen que la cadena empiece en
  `GENESIS`. Antes, cualquiera podía sustituir las entradas de auditoría de un bundle firmado válidamente por una
  cadena fabricada y coherente consigo misma, y ambos seguían dándolo por verificado.
- Los verificadores V2 de Go y Rust fallan de forma cerrada cuando no puede ejecutarse una comprobación del
  manifiesto: un hash de artefacto ausente, como `rpr_hash`, o un payload que falta o no puede canonicalizarse, es
  un error en lugar de una comprobación omitida.
- Los verificadores V2 de Go y Rust comprueban el `payload_hash` de cada artefacto frente a su payload, como hacen
  los de TypeScript y Python; antes lo ignoraban.
- Los verificadores V2 de Go y Rust rechazan un bundle cuyo `manifest.session_expires_at` ha pasado, de modo que
  ya no se les puede reproducir una sesión caducada. El verificador de `@dcp-ai/wasm` lee el
  reloj desde JavaScript, porque `SystemTime::now()` entra en pánico en `wasm32-unknown-unknown`.
- SDK de Rust: `is_session_expired` comparaba lexicográficamente las cadenas RFC 3339 con el reloj UTC,
  así que una marca de tiempo con desfase se juzgaba mal hasta en 14 horas: una sesión que terminaba en una hora,
  escrita `-05:00`, contaba como caducada, y una que terminó hace una hora, escrita `+05:00`, como todavía
  válida. Ahora analiza la marca de tiempo (`parse_rfc3339_millis`) y compara instantes, para la caducidad de la
  sesión y de las claves y en las funciones auxiliares de avisos.
- Marcas de tiempo de caducidad en los cuatro verificadores: un `session_expires_at` o un `expires_at` de clave
  presente pero que no sea una marca de tiempo RFC 3339 con un desfase `Z` o `±hh:mm` se rechaza; ausente o
  `null` sigue significando que no caduca. TypeScript aceptaba cualquier cosa que `Date` no pudiera analizar
  (`"n/a"`) o que analizara de forma permisiva (`"2099-12-31"`), y se saltaba un `session_expires_at` vacío; Rust
  aceptaba `"n/a"`; Go se saltaba un `expires_at` de clave que no fuera una cadena; Python lanzaba una excepción.
  `isSessionExpired` e `is_session_expired` cuentan un valor mal formado como caducado.
- La validez de las claves cubre toda clave que puede firmar. Los cuatro verificadores rechazan una clave revocada o
  caducada en las `binding_keys` del RPR del principal, que firman el RPR y pueden firmar el bundle; TypeScript y
  Python solo comprobaban las claves del pasaporte. Los verificadores de Go y Rust no comprobaban en absoluto el
  estado de las claves y ahora rechazan también las claves del pasaporte revocadas o caducadas.
- Los cuatro verificadores rechazan una clave cuyo `status` es `expired`, como `revoked`. El esquema de entrada de
  clave permite `expired`, pero solo se comprobaba `revoked`, así que una clave marcada como caducada sin
  `expires_at` seguía firmando.
- Una pista de auditoría vacía debe tener la raíz de Merkle `sha256:` seguida de 64 ceros, que los constructores
  de Go y Rust ya escribían. Los cuatro verificadores se saltaban `audit_merkle_root` cuando un bundle no tenía
  entradas de auditoría, así que podía contener cualquier valor.

<a id="changed-breaking"></a>

### Cambiado (incompatible)

- Servidor de verificación (`POST /v2/passport/register`) y servicio de revocación (`POST /v2/register`):
  un `agent_id` nuevo necesita `Authorization: Bearer $OPERATOR_TOKEN` (401 si no); volver a registrarse
  sigue siendo autoservicio. `GET /v2/check/kid/:kid` del servicio de revocación ignora `?agent_id=` y
  devuelve 404 para los kids no registrados.
- Servidor de verificación: un agente puede registrar como máximo `MAX_KEYS_PER_AGENT` claves (64 de forma
  predeterminada) en toda su vida; las rotaciones posteriores reciben 409, y el agente tiene que registrar un
  `agent_id` nuevo.
- Esquemas: `key_entry.public_key_b64` y el `sig_b64` de `composite_signature` deben coincidir con
  `^[A-Za-z0-9+/]+={0,2}$` y se limitan a 3456 y 66 476 caracteres.
- Registro de transparencia: cada entrada de `GOSSIP_PEERS` es `<url>#<base64 Ed25519 public key>`. Las cabeceras
  de árbol de pares sin clave fijada se ignoran, y `/gossip/exchange` las rechaza (403); los logs de
  Docker Compose solo hacen gossip una vez fijadas sus claves (véase `docker/README.md`).
- SDK de Go: `BundleBuildInput` acepta artefactos firmados (`SignedPayload`, véase `v2.SignPayload`) y
  entradas de auditoría `[]AuditEventV2`. `BuildBundleV2` envolvía payloads sin firmar, que los verificadores
  rechazan ahora (V2-8), y llenaba el bundle con entradas de auditoría vacías.
- WASM (`wasm_build_bundle`, y `buildBundle` en `@dcp-ai/wasm`): cada artefacto es un
  `SignedPayload` de `wasm_sign_payload` / `signPayload`, no un payload en bruto. Los bundles construidos con
  payloads en bruto no llevaban firmas de artefacto y ya no se verifican.
- Servicio de revocación: se eliminaron `POST /v2/register-emergency-token` y `POST /v2/register-key-expiry`
  en favor de `POST /v2/register`. `/revoke` V1 necesita un agente registrado ahí, lo que
  exige una firma híbrida del pasaporte (Ed25519 + ML-DSA-65 o SLH-DSA-192f), así que los agentes solo Ed25519
  (V1) ya no pueden publicar revocaciones. Un agente revocado ya no puede revocarse de nuevo (409).
- Servidor de verificación y servicio de revocación: volver a registrar un `agent_id` (por ejemplo, para sustituir
  el token de revocación de emergencia) necesita un pasaporte cuyo `created_at` sea más reciente que el
  registrado, firmado por todas las claves activas del agente; un pasaporte sin token conserva el
  registrado. Un agente que ha perdido todas las claves activas de una familia (clásica o PQ) no puede volver a
  registrarse: la recuperación pasa por el token de revocación de emergencia o por el operador.
- Registro de transparencia: los hashes de las hojas, las raíces y las pruebas de inclusión cambian con los
  prefijos de RFC 6962, y `signature` / `public_key` de la STH son ahora Ed25519 en base64. `/add` solo acepta
  hashes `sha256:<64 hex>`, y `/anchor` del anclaje 64 caracteres hexadecimales con un prefijo `sha256:` opcional.
- Servidor de verificación: `/v2/keys/rotate` exige `authorization_sig` y `timestamp`
  (`KeyRotationRecord`). `dcp rotate-key` y `dcp keys certify` siguen enviando una prueba de posesión simulada,
  que el servidor rechaza ahora.
- SDK de Python: SLH-DSA-192f implementa ahora FIPS 205 (SLH-DSA puro, contexto vacío), como los
  SDK de TypeScript, Go y Rust. Se basaba en el SPHINCS+ prenormativo de PQClean, que firma el
  mensaje sin más en lugar de `0x00 || 0x00 || message`, así que las firmas SLH-DSA no se verificaban entre
  SDK en ninguna dirección. Las firmas hechas por `SlhDsa192fProvider` en `dcp-ai` 2.8.2 y anteriores
  ya no se verifican.
- SDK de Python: exige `pqcrypto>=1.0,<2`, que ahora se usa para ML-DSA-65, SLH-DSA-192f y ML-KEM-768,
  en lugar del tope `<1.0` de 2.8.2 (`pqcrypto` 1.0 cambió su API y eliminó SPHINCS+).
  `dcp_ai.providers` ya no se traga un `ImportError`, y las pruebas de interoperabilidad PQ ya no se omiten
  cuando falta un proveedor.
- SDK de Python: `VerifierPolicy` rechaza los campos desconocidos en lugar de descartarlos, y gana los
  campos que le faltaban (`allow_classical_fallback_disable`, `warn_classical_only_deprecated`,
  `advisory_rejected_algs`, `require_session_expiry`, `max_session_duration_seconds`,
  `require_audience_binding`, `verifier_id`). Antes, `VerifierPolicy(require_audience_binding=True,
  verifier_id=...)` perdía ambos campos sin avisar. En `verify_signed_bundle_v2`, una política en forma de dict se
  valida como un `VerifierPolicy` (las claves desconocidas lanzan una excepción), y los campos que omite toman los
  valores predeterminados del modelo (`hybrid_required` para todos los niveles de riesgo), no el `low` →
  `classical_only` de la política predeterminada. Solo `risk_overrides=None` hace que `default_mode` se aplique a
  todos los niveles.
- El cegado exige `pii_salt`, en los cuatro SDK. `blindRpr` (TypeScript) y `blind_rpr` (Python,
  `ValueError`) lanzan una excepción, y `BlindRPR` (Go) y `blind_rpr` (Rust) devuelven un error, cuando el RPR
  completo no tiene `pii_salt` o no tiene 64 caracteres hexadecimales en minúsculas. Hay que fijarla con la nueva
  función auxiliar antes de firmar el RPR: un RPR firmado sin ella tiene que volver a firmarse antes de poder
  cegarse.
- La verificación de RPR cegados rechaza un RPR completo cuya `pii_salt` está presente pero no es una cadena de
  64 caracteres hexadecimales en minúsculas, en los cuatro SDK. Antes, un registro cegado en otro lugar con una sal
  vacía o corta se verificaba sin ninguna advertencia, mientras que los registros sin sal se señalaban.
- Resultados de la verificación de RPR cegados: `verify_blinded_rpr` (Python) devuelve una nueva clave `warnings`
  y `BlindedRprCheck` de Go tiene un nuevo campo `Warnings`, así que el código que compara resultados completos o
  construye `BlindedRprCheck` con literales sin nombres de campo debe cambiar.
- `schemas/v2/responsible_principal_record.schema.json` acepta `pii_salt`. El esquema tiene
  `additionalProperties: false`, así que los verificadores que validan con el esquema anterior rechazan los
  RPR que llevan una sal: actualiza los verificadores antes de que los productores empiecen a fijarla.
- SDK de Rust: `ResponsiblePrincipalRecordV2` tiene un nuevo campo público, `pii_salt: Option<String>`, así que
  los literales de estructura deben fijarlo.
- Cálculo del nivel de seguridad (especificación §14.2), todos los SDK: `risk_score` se lee de la decisión de
  política del bundle, nunca de la intención (el esquema de la intención no lo permite, así que el nivel nunca era
  `standard` para una intención válida). `estimated_impact` `medium` eleva el nivel a `standard` y `high`
  a `elevated`; un valor de `action_type`, `estimated_impact` o `data_classes` ausente, de tipo incorrecto o
  desconocido da como mínimo `elevated`; un `intent.security_tier` explícito solo puede elevar el resultado.
  - TypeScript: `computeSecurityTier(intent, policyDecision?)`.
  - Python: `compute_security_tier(intent, policy_decision=None)`; `compute_security_tier({})` es ahora
    `elevated`. Las integraciones de LangChain y CrewAI lo usan en lugar de sus propias copias.
  - Go: `SecurityTierInput` gana `EstimatedImpact` y `SecurityTier`, y su valor cero (o un
    `DataClasses` nil) es ahora `elevated`. `v2.SecurityTierInputFromPayloads(intent, policyDecision)` construye
    la entrada a partir de payloads decodificados.
  - Rust: `compute_security_tier(intent, policy_decision: Option<&Value>)`. `wasm_compute_security_tier`
    y `computeSecurityTier` en `@dcp-ai/wasm` aceptan una decisión de política opcional.
- Cálculo del nivel de seguridad, todos los SDK y el servidor de referencia: una `risk_score` de la decisión de
  política que falta o no es un entero de 0 a 1000 cuenta como desconocida, así que el nivel es como mínimo
  `elevated`, como un valor desconocido de la intención. Un valor no numérico contaba antes como 0, y los demás
  números se comparaban tal cual, así que `-1` daba `routine` y `1e30` daba `maximum` (ahora `elevated`, con el
  mismo modo `hybrid_required`). Sin decisión de política la puntuación sigue siendo 0. En Go,
  `SecurityTierInputFromPayloads` fija `RiskScore` a -1 para un valor así, y `ComputeSecurityTier`
  trata cualquier `RiskScore` fuera de 0..1000 como desconocido.
- `verifySignedBundleV2` del SDK de TypeScript: los bundles que hoy pasan con una firma `classical_only`
  se rechazan cuando su intención es sensible: `initiate_payment`, `pii`, `financial_data`,
  `health_data`, `credentials` o `children_data`, `estimated_impact: "high"`, una `risk_score` de la decisión de
  política de 500 o más, o un valor fuera del esquema de la intención. Fírmalos con una firma híbrida
  (`pq_over_classical`). El verificador raíz (`lib/verify.js`, `dcp verify-bundle`, el
  servidor) lo recibe con la próxima versión de `@dcp-ai/sdk`.
- Los verificadores de Go, Rust y Python rechazan los mismos bundles `classical_only`. `VerifySignedBundleV2` de Go
  y `verify_signed_bundle_v2` de Rust aplican el `DEFAULT_VERIFIER_POLICY` de TypeScript en lugar de ninguna
  política; `wasm_verify_signed_bundle_v2` acepta un JSON de política opcional (un `VerifierPolicy`) y,
  con él, rechaza los bundles V1. Su política solo puede diferir de la predeterminada en `default_mode`,
  `risk_overrides` y los campos de la fase 3 (`advisory_rejected_algs`, `warn_classical_only_deprecated`,
  `allow_classical_fallback_disable`, aplicados como en TypeScript): cualquier otro cambio, o un campo desconocido
  en el JSON del `VerifierPolicy` de Rust, hace fallar la verificación en lugar de ignorarse.
- `verify_signed_bundle_v2` del SDK de Python: los errores y advertencias sobre la firma del bundle empiezan por
  `bundle: `, un artefacto null o que no es un objeto se informa como `<name>: not a SignedPayload object`, y
  un modo de política desconocido falla con `Unknown verification mode in verifier policy` antes de comprobar
  ninguna firma, como en TypeScript.

<a id="added-1"></a>
<a id="added_1"></a>

### Añadido

- `generatePiiSalt` (TypeScript), `generate_pii_salt` (Python, Rust) y `GeneratePIISalt` (Go).
  Los tipos RPR de los cuatro SDK, `schemas/v2/responsible_principal_record.schema.json` y
  `api/proto/dcp.proto` llevan `pii_salt`. `ResponsiblePrincipalRecordV2` de Python omite una
  `pii_salt` sin fijar al serializarse, porque el esquema no tiene null para ella.
- Los RPR cegados heredados sin sal siguen verificándose, con una advertencia de obsolescencia: los resultados de
  `verifyBlindedRpr` (TypeScript), `verify_blinded_rpr` (Python) y `VerifyBlindedRPR` (Go) llevan
  una lista `warnings`. `BlindedRprCheck` de Rust conserva sus dos campos, porque un campo público nuevo
  rompería a quienes lo construyen o desestructuran; ahí, una `pii_salt` ausente o null en el
  RPR completo marca un registro heredado.
- `@dcp-ai/openclaw`: `dcp_identity_setup` firma su RPR con una `pii_salt`, de modo que el registro pueda
  cegarse más adelante sin volver a firmarlo.
- Servicio de revocación: `REVOCATION_STATE_PATH` conserva los registros y las revocaciones en un archivo
  (predeterminado: solo en memoria). Las escrituras se añaden como líneas JSON con fsync, y el archivo se reproduce
  y compacta mediante un renombrado atómico al arrancar; el servicio se niega a arrancar si la ruta no tiene
  permiso de escritura o el archivo supera 512 MB. La pila de Docker Compose lo fija, en un volumen.
- Servidor de verificación: `MAX_REGISTERED_KEYS` y `MAX_KEYS_PER_AGENT` dimensionan el registro de claves.
- `effectiveVerificationMode` (TS), `effective_verification_mode` (Python, Rust) y
  `EffectiveVerificationMode` (Go): el más estricto entre un modo de política y el modo de un nivel, con `pq_only`
  sin cambios (especificación §14.3). Vectores compartidos en `security_tier.effective_mode`.
- SDK de Go: `v2.VerifySignedBundleV2WithPolicy(registry, json, policy)` y `v2.DefaultVerifierPolicy()`.
  SDK de Rust: `verify_signed_bundle_v2_with_policy` e `impl Default for VerifierPolicy` (la política
  predeterminada de TypeScript). Los `VerifierPolicy` de Go y Rust ganan los campos de la fase 3 de
  `schemas/v2/verifier_policy.schema.json`, de modo que el `DEFAULT_VERIFIER_POLICY` de TypeScript se decodifica en
  ellos tal cual. `@dcp-ai/wasm`: `verifyBundle(signedBundle, policy?)` y el tipo `VerifierPolicy`.
  Los `details` del resultado de Python ganan `resolved_tier`.
- `tests/interop/v2/bundle_vectors.json`: `must_reject_bundles`, bundles solo clásicos con
  intenciones sensibles desde un pasaporte de riesgo bajo que todo verificador debe rechazar en todos los modos, y
  un control rutinario solo clásico con su veredicto esperado por modo. Las pruebas de TS, Go, Rust y Python
  los ejecutan, y Python ejecuta ahora el archivo completo. `default_verifier_policy` lleva el
  `DEFAULT_VERIFIER_POLICY` de TypeScript, que todo SDK debe aceptar como política.
- `tests/interop/v2/bundle_vectors.json`: casos de rechazo para un `payload_hash` erróneo, entradas de auditoría
  sustituidas o truncadas, una cadena de auditoría que no empieza en `GENESIS`, un manifiesto sin
  `rpr_hash`, una sesión caducada, y claves de pasaporte y de vinculación revocadas o caducadas.
- `@dcp-ai/wasm`: `npm test` ejecuta `verifyBundle` desde el paquete compilado sobre
  `tests/interop/v2/bundle_vectors.json` en Node, y la CI lo ejecuta. Antes solo comprobaba los tipos, y
  las pruebas wasm32 de Rust solo se compilan, así que el verificador wasm nunca se ejecutaba en la CI.
- `tests/interop/v2/interop_vectors.json` `rfc3339`: el instante de marcas de tiempo RFC 3339 con
  desfases y fracciones, y los valores mal formados que todo verificador rechaza. `bundle_vectors.json`
  añade caducidades mal formadas y con desfase, y su bundle firmado lleva caducidades en un futuro lejano escritas
  con desfases. `parseRfc3339` de TypeScript, `parse_rfc3339` de Python y `parse_rfc3339_millis` de Rust
  son los analizadores que usan los verificadores.
- SDK de TypeScript: `blindRpr`, `verifyBlindedRpr`, `isBlindedRpr` y `computePiiHash` se exportan
  desde el punto de entrada del paquete. Estaban implementadas pero eran inaccesibles desde `@dcp-ai/sdk` 2.1.2 y
  anteriores; Python, Go y Rust ya las exportaban.
- `lib/verify.js` exporta `verifyCompositeSig` (una firma compuesta sobre un payload, con las claves del firmante
  buscadas por kid derivado) y su `v2Registry`; `lib/http.js` contiene las funciones auxiliares de análisis del
  cuerpo, IP del cliente y token del operador que comparten `server/` y `services/`. Los servicios de anclaje y de
  registro de transparencia tienen suites `node:test`, que se ejecutan en la CI con las existentes.
- SDK de Rust: el verificador de bundles V2 salió de la característica `wasm` y pasó a
  `dcp_ai::v2::verify_bundle::verify_signed_bundle_v2`, de modo que las compilaciones nativas y `cargo test` lo
  ejecutan; `wasm_verify_signed_bundle_v2` delega en él.
- `tests/interop/v2/bundle_vectors.json`: un bundle firmado que todo verificador V2 debe aceptar, y
  mutaciones (firma PQ del bundle falsificada, firmas de artefacto falsificadas o mal atribuidas, algoritmos en el
  hueco equivocado, artefactos null o que no son objetos) tras las cuales debe rechazarlo con un error que nombre
  el bundle o el artefacto, comprobadas por las suites de TypeScript, Go y Rust. Se regeneran con
  `sdks/typescript/src/__tests__/generate-bundle-vectors.ts`.
- SDK de Go: `v2.SignPayload` firma un artefacto en un `SignedPayload`: una firma compuesta, o una
  solo clásica cuando no se da ninguna clave PQ.
- SDK de Python: `MlKem768Provider` (FIPS 203), la primitiva ML-KEM-768 que los demás SDK ya tenían.
  El handshake DCP-04 de Python todavía no ejecuta el intercambio de claves híbrido X25519 + ML-KEM-768.
- SDK de Python: bundles V2. `BundleBuilderV2`, `sign_bundle_v2`, `sign_bundle_v2_classical_only`,
  `verify_signed_bundle_v2`, `DEFAULT_VERIFIER_POLICY` y `PQ_ONLY_VERIFIER_POLICY` portan
  `builder-v2.ts`, `signer-v2.ts` y `verify-v2.ts` de TypeScript. El verificador también comprueba la firma
  compuesta de cada artefacto (VERIFICATION.md V2-8), rechaza una firma PQ presente pero no válida
  en todos los modos (V2-7) y falla de forma cerrada ante un modo de verificación desconocido. A diferencia del
  verificador de TypeScript, ata los checkpoints PQ del bundle a los ID de `pq_checkpoints` del manifiesto, y en
  la comprobación de `max_session_duration_seconds` limita el `signature.created_at` sin firmar al
  momento de la verificación: un valor reescrito puede acortar esa comprobación hasta la vida restante de la
  sesión, no hasta cero. Cerrarlo necesita un inicio de sesión firmado, que el manifiesto no
  lleva. El contenido de los checkpoints (V2-12) y `audit_merkle_root_secondary` siguen sin verificarse.
- `tests/nist-kat/ml-kem-768` y `tests/nist-kat/slh-dsa-192f`: vectores ACVP del NIST (decapsulación y
  comprobaciones de claves de ML-KEM-768, verificación de firmas SLH-DSA-SHA2-192f).
- `tests/interop/v2/cross_sdk_vectors.json`: vectores de SLH-DSA-192f, ML-KEM-768 y bundles V2 firmados
  producidos por los SDK de TypeScript y Python, cada uno verificado por el otro.

<a id="fixed-1"></a>
<a id="fixed_1"></a>

### Corregido

- Los ejemplos de conformidad V2 (`scripts/generate-v2-examples.js`) usan un `human_id` opaco en lugar de
  uno derivado del nombre legal, que §12.1 prohíbe ahora, y su RPR lleva una `pii_salt`.
- SDK de Python: `BundleManifest.pq_checkpoints` contiene los ID de los checkpoints, como en
  `schemas/v2/bundle_manifest.schema.json`, y el modelo gana `session_expires_at` e
  `intended_verifier`.

<a id="documentation-1"></a>
<a id="documentation_1"></a>

### Documentación

- `spec/DCP-AI-v2.0.md` §12.1 especifica el compromiso con sal, la sal privada que solo se divulga con
  el RPR completo, la supresión mediante el borrado del RPR completo, un `human_id` opaco que no debe (MUST NOT)
  contener datos personales ni derivarse de ellos, y la obsolescencia de los compromisos sin sal.
- `spec/CANONICALIZATION_PROFILE.md`, `spec/DCP-AI-v2.0.md`, el README del SDK de WASM (todos los idiomas),
  `docs/NIST_CONFORMITY.md` y los comentarios de los canonicalizadores de TypeScript, Python y Rust describen
  `dcp-jcs-v1` como basado en RFC 8785, no como un subconjunto estricto de él ni como RFC 8785 sin más: la regla 1
  ordena las claves por punto de código, RFC 8785 por unidades de código UTF-16. El perfil no cambia.
- El README del SDK de TypeScript (todos los idiomas) y `docs/API_REFERENCE.md` enumeran las firmas reales de
  las funciones de firma compuesta, bundle, presentación, checkpoint PQ, A2A, errores, revocación de emergencia,
  recuperación de claves, hash y CBOR.
- `docs/API_REFERENCE.md`: el proceso de verificación V2 enumera las comprobaciones de firma por artefacto,
  y la nota de limitaciones conocidas sobre V2-7 y V2-8 se aplica ahora solo a `@dcp-ai/sdk` 2.1.2 y
  anteriores.
- Los README de los SDK de Go y WASM (todos los idiomas) y `docs/MIGRATION_V1_V2.md` firman cada artefacto
  antes de construir el bundle, y enumeran las claves de firma en el pasaporte y en el RPR.
- `spec/DCP-AI-v2.0.md` §14.2 describe el cálculo del nivel anterior, §14.3 y §14.4 describen
  `resolved_tier` como informativo (§14.2 no lo lee), y `spec/VERIFICATION.md` calcula
  el nivel como en §14.2. Los README de los SDK (todos los idiomas), `docs/API_REFERENCE.md`, las guías de
  inicio rápido, de migración y de creación de agentes, y `sdks/wasm/example.html` pasan la decisión de
  política a la función del nivel y usan los valores del esquema de la intención.
- `spec/VERIFICATION.md` V2-7 y `spec/DCP-AI-v2.0.md` §7.1 establecen que una firma PQ
  presente debe verificarse en todos los modos, como ya hacen los verificadores. `docs/API_REFERENCE.md` documenta
  `details.resolved_tier` y el modo de `verifySignedBundleV2` que tiene en cuenta el nivel, y el README del SDK de
  TypeScript (todos los idiomas) lo describe.
- `docs/MIGRATION_V1_V2.md` §6.3 ya no muestra un comando `dcp migrate-check`, que la CLI no
  tiene, ni una `risk_score` en la intención; valida los bundles migrados con
  `dcp verify-bundle --policy hybrid_required`.
- `spec/DCP-AI-v2.0.md` §14.3 convierte la aplicación del nivel en un MUST para los verificadores V2 (§20.1): el
  modo es el más estricto entre el modo de la política y el modo del nivel. `spec/VERIFICATION.md` calcula el nivel
  y el modo efectivo en el paso V2-9 y aplica con él la política en el paso V2-10, donde la comprobación del nivel
  era antes opcional. `docs/OPERATOR_GUIDE.md` y `docs/SECURITY_MODEL.md` describen el modo que tiene en cuenta el
  nivel, y los README de los SDK de Go, Python, Rust y WASM (todos los idiomas) describen la política de
  verificación.
- La §18 de la especificación (proceso de verificación), `docs/OPERATOR_GUIDE.md` y el paso 8 de la guía de
  migración describen la aplicación del nivel tal como la implementan los verificadores. La guía del operador ya no
  dice que el nivel máximo verifique los checkpoints PQ, cosa que todavía no hace ningún verificador (V2-12), y dice
  lo que aplica el servidor de referencia hasta que se actualice su dependencia de `@dcp-ai/sdk`.
- `spec/VERIFICATION.md` V2-3, V2-4 y V2-13 detallan estas comprobaciones: `payload_hash`, hashes del manifiesto
  que fallan de forma cerrada, la pista de auditoría atada al manifiesto, la caducidad de la sesión y la validez de
  las `binding_keys` del RPR. `docs/API_REFERENCE.md` enumera las claves de vinculación en el paso de validez de las
  claves.

## [2.9.0] - 2026-10-21

<a id="package-versions-1"></a>
<a id="package-versions_1"></a>

### Versiones de paquetes

- `dcp-ai` (PyPI) 2.8.1 → 2.8.2: solo correcciones.
- `@dcp-ai/sdk` (npm) 2.1.1 → 2.1.2: solo correcciones.
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` v2.8.1 → v2.9.0: añade `v2.MarshalCanonical`.
- `dcp-ai` (crates.io) 2.8.1 → 2.9.0: OpenTelemetry 0.32, incompatible para la característica opcional `otlp`
  (véase «Cambiado (incompatible)»).
- Sin cambios: `@dcp-ai/wasm` 2.0.0, `@dcp-ai/cli` 2.0.0 y los paquetes de integración.

<a id="security-2"></a>
<a id="security_2"></a>

### Seguridad

- El verificador de referencia (`lib/verify.js`), `dcp verify-bundle` y el servidor de verificación verifican ahora
  los bundles V2 normativos (`schemas/v2/signed_bundle.schema.json`) delegando en
  `verifySignedBundleV2` de `@dcp-ai/sdk`, tras la validación con JSON Schema. Antes, los bundles producidos
  por cualquier SDK se rechazaban como «Invalid signed bundle format», `dcp verify-bundle` imprimía
  `V2 BUNDLE STRUCTURE VALID` (salida 0) para bundles falsificados, y el servidor solo comprobaba la estructura.
  El sobre prenormativo (`dcp_version` / `bundle_manifest` en el nivel superior) se rechaza. El servidor
  verifica con el `VERIFIER_POLICY` que anuncia (modo, algoritmos aceptados y rechazados por avisos), y la fijación
  de una clave pública se rechaza en el modo `pq_only`, que omite el firmante clásico.
- `dcp sign-bundle --composite` emite un `SignedBundleV2` normativo; el kid de ML-DSA-65 se derivaba antes de un
  hash de la clave secreta. Se eliminó `tools/bundle_sign.js --v2`.
- Servicio de revocación: una revocación de emergencia ya no informa de que todos los kids de todos los agentes
  están revocados (`GET /v2/check/kid/:kid` acepta ahora `?agent_id=`), y una codificación porcentual mal formada
  devuelve 400 en lugar de hacer caer el proceso.
<a id="changed-breaking-1"></a>
<a id="changed-breaking_1"></a>

### Cambiado (incompatible)

- `lib/verify.js` (el `main` del paquete raíz): `verifySignedBundle` es ahora `async` y acepta un
  cuarto argumento `options` (`{ policy, mode }`); los resultados llevan siempre un array `errors`. Se actualizaron
  la GitHub Action compuesta `verify-bundle`, `bin/dcp.js`, `server/` y `tools/bundle_verify.js`.
  `tools/bundle_verify.js` ya no acepta un argumento de clave pública PQ.
- SDK de Rust, característica opcional `otlp`: OpenTelemetry 0.24 → 0.32.
  - `OtlpHandles.tracer_provider` es ahora `SdkTracerProvider` y `OtlpHandles.tracer` es
    `SdkTracer`, siguiendo los cambios de nombre del proyecto original.
  - La característica ya no arrastra `tokio`: el puente exporta desde los hilos en segundo plano del SDK
    con el cliente bloqueante de `reqwest`.
  - Los errores con el prefijo `tracer install:` dicen ahora `trace exporter:`.

<a id="added-2"></a>
<a id="added_2"></a>

### Añadido

- SDK de Go: `v2.MarshalCanonical(obj)`, el codificador `dcp-jcs-v1` sin la regla de solo enteros. El
  `Canonicalize` V1 y el codificador de prueba de posesión lo usan ahora.

<a id="fixed-2"></a>
<a id="fixed_2"></a>

### Corregido

- SDK de Go: la canonicalización ya no escapa `<`, `>`, `&` ni U+2028/U+2029, y emite `-0` como `0`
  (reglas 3 y 4 de `dcp-jcs-v1`) en las rutas V2, de prueba de posesión y V1.
- SDK de TypeScript: las claves de los objetos se ordenan por punto de código Unicode (regla 1), no por unidades de
  código UTF-16.
- SDK de Python: `pqcrypto` se limita por debajo de 1.0. La versión 1.0 eliminó los módulos
  `pqcrypto.sign.ml_dsa_*`, así que las instalaciones nuevas de `dcp-ai` 2.8.1 no pueden importar el proveedor
  ML-DSA-65.
- `tests/interop/v2/interop_vectors.json`: vectores de casos límite para el cero negativo, caracteres HTML,
  U+2028/U+2029, escapes de caracteres de control y ordenación de claves con caracteres de los planos suplementarios de Unicode.
- `tools/conformance.js`: la entrada `edge_cases` ya no pasa sin comprobar nada, se eliminó el bloque de
  separación de dominio que nunca se ejecutaba, y los bundles firmados V2 (válidos, manipulados, falsificados, sin
  firma PQ, con clave fijada, heredados) se comprueban con el verificador de referencia.

<a id="dependencies"></a>

### Dependencias

- Se cerraron las 95 alertas abiertas de Dependabot (11 críticas, 54 altas). #22 sustituyó a las 15 PR de
  Dependabot (#5–#21); #24 actualizó grpc.
- SDK de TypeScript, `@dcp-ai/express`, `@dcp-ai/openclaw` (desarrollo):
  - vitest y `@vitest/coverage-v8` 4.1.12, actualizados juntos.
  - vite 7.3.7, fijado mediante `overrides`.
  - postcss 8.5.31, nanoid 3.3.20, source-map-js 1.2.2, esbuild 0.28.2, fast-uri 3.1.9.
  - Lockfile de ejecución de Express: proxy-addr 2.0.8, qs 6.16.1, body-parser 2.3.0.
- Arnés raíz: fast-uri 3.1.9 y la nueva dependencia `@dcp-ai/sdk`.
- SDK de Go: `golang.org/x/crypto` v0.55.0, `golang.org/x/net` v0.58.0, `google.golang.org/grpc`
  v1.83.2, `go.opentelemetry.io/otel/*` v1.46.0.
- SDK de Rust: opentelemetry, opentelemetry_sdk y opentelemetry-otlp 0.32. `opentelemetry_sdk`
  0.32.1 corrige una asignación de memoria sin límite en la propagación de W3C Baggage.
- CI:
  - Nuevo trabajo de pruebas de integración para express y openclaw.
  - El trabajo de Rust compila y prueba `--features otlp`.
  - El trabajo de Go lee su versión de `go.mod`.
  - El bundle V2 generado se verifica con la CLI.
  - Se ejecutan las pruebas del servidor y de la revocación.

<a id="documentation-2"></a>
<a id="documentation_2"></a>

### Documentación

- `spec/VERIFICATION.md`:
  - La lista de comprobación V2 apunta ahora a `schemas/v2/signed_bundle.schema.json` (los esquemas `*_v2` citados nunca existieron).
  - Se eliminó la vinculación inexistente `independent`.
  - Se nombra la implementación de referencia.
- `spec/CANONICALIZATION_PROFILE.md` §3 ganó filas para el escapado de cadenas y el orden de las claves por punto de código. Esto aclara las reglas 1 y 3; el perfil no cambia.
- La documentación del servidor, del operador, de migración, de referencia de la API, de CI y de bundles describe ahora la verificación V2 real, la sintaxis real de la CLI y las API del SDK que existen:
  - Las tablas de API de la guía de migración nombraban varias funciones que no existen.
  - El README del servidor mostraba el sobre prenormativo.
- El README del SDK de Python (todos los idiomas) ya no afirma que admita ML-KEM-768 ni bundles V2, y la guía de inicio rápido de CrewAI marca su fragmento V2 como API prevista.
- Traducciones y documentos del proyecto:
  - 11 integraciones, incluida Agno; enlaces al perfil de canonicalización y a la guía de inicio rápido de Agno.
  - Fragmentos de instalación de Rust para esta versión y fijaciones `@latest` de Go.
  - Versiones admitidas por paquete en `SECURITY.md`, y las versiones v2.8.x y v2.9.0 en `ROADMAP.md`.
  - El DOI de concepto de Zenodo en `CITATION.cff`.

## [2.8.1] - 2026-04-26

<a id="wired-the-canonicalization_profile-field-across-the-four-sdks"></a>

### Integración del campo `canonicalization_profile` en los cuatro SDK

`v2.8.0` declaró el campo `canonicalization_profile` en
`schemas/v2/bundle_manifest.schema.json` y lo describió en
`spec/CANONICALIZATION_PROFILE.md` § 4, pero ningún SDK escribía ni leía realmente el campo: las estructuras
tipadas `BundleManifest` se distribuyeron sin él, y los verificadores lo ignoraban. `v2.8.1` cierra ese hueco de
principio a fin.

- **TypeScript (`@dcp-ai/sdk` 2.1.0 → 2.1.1)**: la interfaz `BundleManifest`
  de `sdks/typescript/src/types/v2.ts` gana
  `canonicalization_profile?: 'dcp-jcs-v1'`. `BundleBuilderV2.build()`
  de `sdks/typescript/src/bundle/builder-v2.ts` emite ahora
  `canonicalization_profile: "dcp-jcs-v1"` en cada manifiesto que produce.
  `verifyV2Bundle` de `sdks/typescript/src/core/verify-v2.ts` acepta
  el campo ausente (supone `dcp-jcs-v1`), acepta `"dcp-jcs-v1"`
  de forma explícita y rechaza cualquier otro valor con
  `"Unknown canonicalization_profile: <value>"`.
- **Python (`dcp-ai` 2.8.0 → 2.8.1)**: `BundleManifest` de
  `sdks/python/dcp_ai/v2/models.py` gana
  `canonicalization_profile: Literal["dcp-jcs-v1"] | None = "dcp-jcs-v1"`.
  Pydantic impone el rechazo de valores desconocidos al analizar; la ausencia
  activa el valor predeterminado. No hace falta un cambio aparte en el verificador
  porque la validación está en el modelo.
- **Go (`sdks/go/v2.8.0` → `v2.8.1`)**: la estructura `BundleManifest` de
  `sdks/go/dcp/v2/types.go` gana `CanonicalizationProfile string` con
  `json:"canonicalization_profile,omitempty"`. `BuildBundleV2` de
  `sdks/go/dcp/v2/bundle_builder.go` lo fija a `"dcp-jcs-v1"` en cada
  manifiesto que produce. `VerifySignedBundleV2` de
  `sdks/go/dcp/v2/verify_bundle.go` rechaza ahora los bundles cuyo manifiesto
  lleve un valor de `canonicalization_profile` distinto de `"dcp-jcs-v1"`.
- **Rust (`dcp-ai` en crates.io 2.8.0 → 2.8.1)**:
  `BundleManifest` de `sdks/rust/src/v2/types.rs` gana
  `pub canonicalization_profile: Option<String>` con
  `#[serde(skip_serializing_if = "Option::is_none")]`. `wasm_build_bundle`
  de `sdks/rust/src/lib.rs` fija `"canonicalization_profile":
  "dcp-jcs-v1"` en el manifiesto que emite.

<a id="spec--profile-document"></a>
<a id="spec-profile-document"></a>

### Especificación y documento del perfil

- `spec/DCP-AI-v2.0.md` § 9 (manifiesto del bundle) enumera ahora
  `canonicalization_profile` junto a los demás campos del manifiesto, con
  una nota en línea según la cual un campo ausente debe (MUST) suponerse equivalente a
  `"dcp-jcs-v1"`.
- `spec/CANONICALIZATION_PROFILE.md` § 2: la regla 6 (tratamiento de undefined / null)
  se reescribe como una tabla entre lenguajes que enumera explícitamente
  cómo se corresponden los valores del host de TypeScript, Python, Go y Rust con el
  formato de intercambio JSON, tanto en las posiciones de objeto como en las de array.
- `spec/CANONICALIZATION_PROFILE.md` § 2: una nueva regla 9 deja explícitamente fuera de alcance la
  normalización Unicode (NFC, NFD, NFKC, NFKD): el
  canonicalizador emite las cadenas byte a byte tal como las entrega el analizador del host, y un perfil futuro
  (`dcp-jcs-v2` o posterior) puede (MAY) fijar una forma de normalización. Se cita RFC 8259 § 8.1 como la
  opción convencional (NFC) para la normalización en la capa de aplicación.
- La regla 9 de `spec/CANONICALIZATION_PROFILE.md` fija también el motivo
  para no distribuir fixtures de interoperabilidad con `NaN` / `±Infinity`: esos valores
  no forman parte del formato de intercambio de RFC 8259, así que la mayoría de los analizadores los rechazan
  antes de llegar al canonicalizador. El rechazo se verifica con pruebas unitarias de cada SDK
  en lugar de con fixtures compartidos.

<a id="behavioural-compatibility"></a>

### Compatibilidad de comportamiento

El nuevo campo es **aditivo y opcional en la serialización**:

- Un bundle producido por `v2.8.1` lleva `canonicalization_profile:
  "dcp-jcs-v1"` en su manifiesto. Los verificadores anteriores que no conocen
  el campo lo tratarán como una propiedad desconocida, lo cual es correcto
  porque el JSON Schema declara el campo compatible con `additionalProperties`
  (está entre las `properties` y es `optional`).
- Un bundle producido por `v2.8.0` o anterior no tiene el campo
  `canonicalization_profile`. Los verificadores `v2.8.1` lo aceptan: según
  `spec/CANONICALIZATION_PROFILE.md` § 4, un campo ausente debe (MUST)
  suponerse equivalente a `"dcp-jcs-v1"`.
- Un bundle que lleva `canonicalization_profile` con un valor desconocido
  (p. ej., `"dcp-jcs-v2"`) lo rechazan todos los SDK `v2.8.1`. Este
  es el punto de enganche de compatibilidad futura para perfiles futuros: un verificador
  que no se ha actualizado a un perfil nuevo debe (MUST) rechazarlo en lugar de
  aceptar sin avisar un manifiesto que no puede validar.

La firma del bundle cubre `canonical(manifest)`, así que añadir el
campo cambia el hash del manifiesto de cualquier bundle producido de nuevo respecto
al que se habría producido con `v2.8.0`. Los bundles producidos
con `v2.8.0` y anteriores, y sus firmas almacenadas, siguen siendo válidos
con los verificadores `v2.8.1`.

<a id="versions-bumped"></a>

### Versiones actualizadas

- `dcp-ai` (PyPI) 2.8.0 → 2.8.1
- `dcp-ai` (crates.io) 2.8.0 → 2.8.1
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` v2.8.0 → v2.8.1
- `@dcp-ai/sdk` (npm) 2.1.0 → 2.1.1: primer cambio de código de TypeScript
  desde 2.1.0 (la versión 2.8.0 fue solo una edición de docstrings)

## [2.8.0] - 2026-04-26

<a id="added--canonicalization-profile-dcp-jcs-v1"></a>
<a id="added-canonicalization-profile-dcp-jcs-v1"></a>

### Añadido — Perfil de canonicalización `dcp-jcs-v1`

Una comparación pública con otro protocolo sacó a la luz tres asimetrías reales
en cómo canonicalizaban JSON los cuatro SDK: `1.0`/`1.00`
los rechazaban Python y Rust pero los aceptaban TypeScript y Go;
`1e2` lo rechazaba solo Rust; y `undefined` no tenía tratamiento formal
en la especificación. El resumen «RFC 8785 + solo enteros» de
`spec/DCP-AI-v2.0.md` § 15 era correcto hasta donde llegaba, pero no
fijaba los casos que JCS deja a criterio de la implementación. Esta versión los cierra
todos.

- **Nuevo documento normativo**: [`spec/CANONICALIZATION_PROFILE.md`](spec/CANONICALIZATION_PROFILE.md)
  formaliza el perfil `dcp-jcs-v1` con ocho reglas numeradas, una
  tabla de aceptación de casos límite que cubre 22 entradas, un contrato de tratamiento de undefined
  que documenta la asimetría propia de TypeScript (se omite en
  los objetos y se serializa como `null` en los arrays), y una política de versiones
  para perfiles futuros.
- **Campo del manifiesto del bundle**: `canonicalization_profile: "dcp-jcs-v1"`
  se añade a `schemas/v2/bundle_manifest.schema.json` como campo
  opcional. Los verificadores que encuentren un bundle sin él deben (MUST) suponer
  `dcp-jcs-v1`. Los perfiles futuros harán el campo obligatorio.
- **Python (`dcp-ai` 2.7.1 → 2.8.0)**: `assert_no_floats` acepta ahora
  números en coma flotante cuyo valor es un entero finito (`1.0`, `1e2`, `1.00`); se
  normalizan a la forma entera antes de `json.dumps`. Los números no enteros
  (`0.1`), `NaN` y los infinitos siguen rechazándose.
- **Rust (`dcp-ai` 2.7.0 → 2.8.0)**: `assert_no_floats` acepta ahora
  `Number(f64)` cuyo `fract()` es cero. Una nueva función auxiliar `format_number`
  en `canonical_recurse` emite los números en coma flotante de valor entero sin punto decimal
  ni exponente, igual byte a byte que los demás SDK.
- **Go (`sdks/go/v2.7.0` → `v2.8.0`)**: el comportamiento ya estaba alineado
  (comprobación `v != math.Trunc(v)`). Solo cambio de versión.
- **TypeScript (`@dcp-ai/sdk` sigue en 2.1.0)**: el comportamiento ya estaba
  alineado. El docstring de `sdks/typescript/src/core/canonicalize.ts`
  formaliza la asimetría entre undefined y null.

<a id="added--interop-edge-case-fixtures"></a>
<a id="added-interop-edge-case-fixtures"></a>

### Añadido — fixtures de interoperabilidad para casos límite

`tests/interop/v2/interop_vectors.json` incluye ahora
`canonicalization.edge_cases` con 14 vectores que cubren la conservación de null
(con clave, dentro de arrays), números en coma flotante de valor entero,
ceros finales, notación científica, rechazo de fracciones, rechazo de valores no finitos,
ordenación de claves por punto de código (incluida `é`), nulls anidados,
contenedores vacíos, objetos muy anidados y arrays con null. La prueba de
interoperabilidad de cada SDK carga el mismo bloque y comprueba una salida idéntica byte a byte
(o el mismo error) para cada vector. La CI ejecuta los cuatro en
paralelo en cada PR; una divergencia bloquea la publicación.

<a id="versions-bumped-1"></a>
<a id="versions-bumped_1"></a>

### Versiones actualizadas

- `dcp-ai` (PyPI) 2.7.1 → 2.8.0
- `dcp-ai` (crates.io) 2.7.0 → 2.8.0
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` → v2.8.0
- `@dcp-ai/sdk` (npm) sigue en 2.1.0: TypeScript ya implementaba
  el perfil; esta versión solo añade la formalización en el docstring.

<a id="behavioural-compatibility-1"></a>
<a id="behavioural-compatibility_1"></a>

### Compatibilidad de comportamiento

Los bundles producidos por versiones anteriores siguen siendo válidos. El cambio es
**aditivo** para los SDK que antes rechazaban `1.0`/`1.00`/`1e2`:
las entradas que antes lanzaban `TypeError`/`Err` ahora tienen éxito y producen
la misma salida canónica que los demás SDK ya producían. Ninguna
entrada que antes se canonicalizaba con éxito se canonicaliza
de otra forma en 2.8.0.

<a id="271---2026-04-23-python-only"></a>
<a id="271-2026-04-23-python-only"></a>

## [2.7.1] - 2026-04-23 (solo Python)

<a id="fixed-3"></a>
<a id="fixed_3"></a>

### Corregido

- A `dcp-ai` (PyPI) 2.7.0 le faltaba `cryptography` como dependencia obligatoria. El
  paquete lo necesita la capa de sesión A2A de DCP-04 introducida en 2.5.0
  para el cifrado AES-256-GCM. Las instalaciones nuevas con `pip install dcp-ai==2.7.0`
  no traían `cryptography`, así que tres pruebas de sesión A2A fallaban en un entorno
  limpio (`test_encrypt_decrypt_round_trip`, `test_tamper_ciphertext_rejected`,
  `test_session_id_mismatch`). 2.7.1 añade `cryptography>=41.0` a las dependencias
  obligatorias del wheel.

Rust (`dcp-ai` en crates.io) y Go (`sdks/go/v2`) no se ven afectados y siguen en
2.7.0: el paquete `cryptography` de Python solo importa para el wheel de Python.

## [2.7.0] - 2026-04-23

<a id="added--canonical-error-codes--wire-format-detection-in-py--go--rs"></a>
<a id="added-canonical-error-codes-wire-format-detection-in-py-go-rs"></a>

### Añadido — Códigos de error canónicos + detección del formato de intercambio en PY / GO / RS

Porta el enum `DcpErrorCode` y la maquinaria asociada `DcpError` / `DcpProtocolError`
de TS a Python, Rust y Go, además de la función auxiliar ligera
`detect_wire_format`, que encamina un flujo de bytes entrante a
"json" o "cbor" según el primer byte.

**Todos los SDK coinciden ahora en los mismos 38 códigos de error canónicos**, que cubren:
errores de esquema (E001-E099), errores de firma (E100-E199), errores de hash y cadena
(E200-E299), errores de identidad (E300-E399), errores de política (E400-E499),
errores de sesión (E500-E599), errores A2A (E600-E699), limitación de tasa
(E700-E799) y errores internos (E900-E999). Cada código lleva un mensaje canónico
y un indicador `retryable`, para que los clientes puedan implementar una lógica de reintento
que coincida con la política de forma coherente en todos los SDK.

**Python (`dcp-ai` 2.6.0 -> 2.7.0)**: nuevo módulo `dcp_ai.v2.error_codes`
con `DcpErrorCode` (str-enum), la dataclass `DcpError`,
la excepción `DcpProtocolError`, `create_dcp_error`, `is_dcp_error`,
`detect_wire_format` y la correspondencia `ERROR_DESCRIPTIONS`.

**Rust (`dcp-ai` 2.6.0 -> 2.7.0)**: `dcp_ai::v2::error_codes` con el
enum `DcpErrorCode` (`Display` → el identificador estable `DCP-E###`),
la estructura `DcpError`, `create_dcp_error` y `detect_wire_format`.

**Go (`sdks/go/v2.6.0 -> v2.7.0`)**: el tipo cadena `v2.DcpErrorCode` con
37 constantes `Err*`, la estructura `v2.DcpError` que implementa la interfaz
`error`, `CreateDcpError`, `IsDcpError`, `DetectWireFormat`.

<a id="cbor-encoderdecoder-scope-decision"></a>

### Decisión sobre el alcance del codificador/decodificador CBOR

El codificador/decodificador CBOR completo sigue siendo solo de TypeScript en 2.x. Portar una
implementación determinista de RFC 8949 a tres SDK más es un proyecto considerable
que merece su propio hito; `detect_wire_format` es la
única función auxiliar que todo SDK necesita hoy para encaminar payloads CBOR hacia una
biblioteca existente del ecosistema (p. ej., `cbor2` en Python,
`github.com/fxamacker/cbor/v2` en Go, `ciborium` en Rust). Una versión
v3.x dedicada añadirá un port canónico.

<a id="test-counts"></a>

### Recuento de pruebas

- Python: 231/231 superadas (sin cambios; superficie de importación verificada)
- Rust: 152/152 superadas (+5 nuevas)
- Go: 115/115 superadas (+8 nuevas)

<a id="versions-bumped-2"></a>
<a id="versions-bumped_2"></a>

### Versiones actualizadas

- `dcp-ai` (PyPI) 2.6.0 -> 2.7.0
- `dcp-ai` (crates.io) 2.6.0 -> 2.7.0
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` -> v2.7.0

## [2.6.0] - 2026-04-23

<a id="added--blinded-rpr-multi-party-auth-advisory-helpers-in-rust--go"></a>
<a id="added-blinded-rpr-multi-party-auth-advisory-helpers-in-rust-go"></a>

### Añadido — RPR cegado, autorización multiparte y funciones auxiliares de avisos en Rust + Go

Porta a Rust y Go tres funcionalidades exclusivas de Python, y cierra la diferencia
señalada en la comparación, donde Python iba por delante de los demás SDK que no son TS.

- **RPR cegado (Gap #2)**: `compute_pii_hash`, `blind_rpr`,
  `verify_blinded_rpr`, `is_blinded_rpr`.
- **Autorización multiparte (Gap #5)**: `verify_multi_party_authorization`
  + `MultiPartyPolicy` con las cuatro políticas de operación predeterminadas
  (`revoke_agent`, `rotate_org_key`, `change_jurisdiction`,
  `modify_recovery_config`).
- **Funciones auxiliares de avisos sobre algoritmos (Gap #4)**: `check_advisory`,
  `evaluate_advisories`, `apply_advisories_to_policy`,
  `build_algorithm_advisory`.

Los tres módulos coinciden con la semántica de Python: compromiso SHA-256 de los datos personales,
validación estructural M de N (la verificación criptográfica queda en la pasarela)
y encaminamiento por acción (`revoke` / `deprecate` / `warn`) con tratamiento del
periodo de gracia.

Python (`dcp-ai` 2.5.0 -> 2.6.0): sin cambios de código, solo cambio de versión para
mantener sincronizado el conjunto de SDK.

<a id="test-counts-1"></a>
<a id="test-counts_1"></a>

### Recuento de pruebas

- Rust: 147/147 (+14 nuevas)
- Go: 106/106 (+12 nuevas)
- Python: 231/231 (sin cambios)

## [2.5.0] - 2026-04-23

<a id="added--dcp-04-agent-to-agent-protocol-parity"></a>
<a id="added-dcp-04-agent-to-agent-protocol-parity"></a>

### Añadido — Paridad del protocolo entre agentes de DCP-04

Porta a los SDK restantes la estructura básica de DCP-04 (comunicación entre agentes).

**Python (`dcp-ai` 2.4.0 -> 2.5.0)**: paridad completa con TS, incluida la
capa de sesión simétrica (AES-256-GCM mediante el paquete `cryptography`).

- Descubrimiento: `create_agent_directory`, `find_agent_by_capability`,
  `find_agent_by_id`, `validate_directory_entry`.
- Handshake: `generate_nonce`, `create_hello`, `create_welcome`,
  `derive_session_id`, `create_close_message`.
- Sesión: `A2ASession`, `create_session`, `encrypt_message`,
  `decrypt_message`, `needs_rekeying`, `generate_resume_proof`,
  `verify_resume_proof`, `derive_rekeyed_session_key`.

**Go (`sdks/go/v2.4.0 -> v2.5.0`)**: paridad completa con TS, usando
`crypto/aes` + `crypto/cipher` de la biblioteca estándar de Go para AES-256-GCM (sin dependencias nuevas).

**Rust (`dcp-ai` 2.4.0 -> 2.5.0)**: estructura básica de descubrimiento + handshake.
La capa de sesión AES-256-GCM está prevista para una versión posterior; quienes usan Rust
pueden construir directorios y mensajes HELLO/WELCOME, y derivar
ID de sesión.

Recuento de pruebas: Python 231/231, Rust 133/133, Go 94/94.

## [2.4.0] - 2026-04-23

<a id="added--production-hardening-primitives-in-python-rust-go"></a>
<a id="added-production-hardening-primitives-in-python-rust-go"></a>

### Añadido — Primitivas de refuerzo para producción en Python, Rust y Go

Porta desde el núcleo de TS las cuatro primitivas de refuerzo críticas para el protocolo:

- Funciones auxiliares de **nonce de sesión**: `generate_session_nonce`, `is_valid_session_nonce`,
  `verify_session_binding`, `generate_session_expiry`, `is_session_expired`.
- **Nivel de seguridad adaptativo**: `compute_security_tier`, `max_tier`,
  `tier_to_verification_mode`, `tier_to_checkpoint_interval` (Go ya tenía
  `ComputeSecurityTier`; v2.4 añade las tres funciones auxiliares).
- **Revocación de emergencia** (Gap #13): `generate_emergency_revocation_token`,
  `verify_emergency_revocation_secret`, `build_emergency_revocation`.
- **Checkpoints PQ diferidos**: `audit_events_merkle_root`, `create_pq_checkpoint`,
  y la clase `PQCheckpointManager`, con selección del intervalo según el nivel y
  vaciado automático.

Los cuatro módulos coinciden exactamente con la semántica de TS: verificación del secreto en tiempo
constante para la revocación de emergencia, intervalos de checkpoint según el nivel,
expresión regular de validación del nonce de sesión y payloads de checkpoint firmados con el
contexto de separación de dominio `DCP-AI.v2.AuditEvent`.

<a id="whats-not-in-v24"></a>

### Lo que no incluye v2.4

Se dejó fuera deliberadamente (se publicará en versiones posteriores si hay demanda):

- Compartición de secretos de Shamir (Gap #1): requiere una revisión criptográfica cuidadosa; solo TS.
- Caché de verificación: cuestión de la aplicación, no del protocolo.
- Limitación de tasa / disyuntor / reintentos: patrones de la aplicación que conviene
  delegar en bibliotecas existentes del ecosistema.

<a id="test-counts-2"></a>
<a id="test-counts_2"></a>

### Recuento de pruebas

- Python: 214/214 superadas (+24 nuevas)
- Rust: 126/126 superadas (+10 nuevas)
- Go: 81/81 superadas (+9 nuevas)

<a id="versions-bumped-3"></a>
<a id="versions-bumped_3"></a>

### Versiones actualizadas

- `dcp-ai` (PyPI) 2.3.0 -> 2.4.0
- `dcp-ai` (crates.io) 2.3.0 -> 2.4.0
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` -> v2.4.0

## [2.3.0] - 2026-04-23

<a id="added--dispute--rights--delegation-parity-across-sdks"></a>
<a id="added-dispute-rights-delegation-parity-across-sdks"></a>

### Añadido — Paridad de disputas, derechos y delegación entre SDK

Python, Rust y Go implementan ahora el comportamiento de DCP-07 (resolución de disputas + arbitraje),
DCP-08 (derechos y obligaciones) y DCP-09 (delegación, umbral de conciencia,
espejo del principal), en línea con el conjunto de funcionalidades de TypeScript.

**Nuevos grupos de funciones (semántica idéntica en PY/RS/GO, en línea con TS):**

Resolución de conflictos de DCP-07:

- `create_dispute` · `escalate_dispute` · `resolve_dispute` · `create_objection`
- Arbitraje: `create_arbitration_panel` · `submit_resolution` ·
  `build_jurisprudence_bundle` · `lookup_precedent`

Derechos y obligaciones de DCP-08:

- `declare_rights` · `record_obligation` · `report_violation` ·
  `check_rights_compliance`

Delegación y representación de DCP-09:

- Delegación: `create_delegation_mandate` · `verify_mandate_validity` ·
  `revoke_delegation` · `generate_interaction_record`
- Umbral de conciencia: `evaluate_significance` · `should_notify_human` ·
  `create_awareness_threshold` · `create_advisory_declaration`
- Espejo del principal: `generate_mirror`

Todas las nuevas fábricas usan la ruta de firma compuesta existente con los
contextos de separación de dominio `DCP-AI.v2.Dispute`, `DCP-AI.v2.Rights`, `DCP-AI.v2.Delegation` y
`DCP-AI.v2.Awareness`. El artefacto del mandato de delegación
lleva la firma del principal humano en el campo `human_composite_sig`,
en línea con el formato de intercambio de TS.

<a id="test-counts-3"></a>
<a id="test-counts_3"></a>

### Recuento de pruebas

- Python: 190/190 superadas (+21 nuevas)
- Rust: 116/116 superadas (+12 nuevas)
- Go: 72/72 superadas (+12 nuevas en el paquete externo `dcp_test`)
- TypeScript: 460/460 superadas (sin cambios)

<a id="versions-bumped-4"></a>
<a id="versions-bumped_4"></a>

### Versiones actualizadas

- `dcp-ai` (PyPI) 2.2.0 -> 2.3.0
- `dcp-ai` (crates.io) 2.2.0 -> 2.3.0
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` -> v2.3.0
- `@dcp-ai/sdk` (npm) sigue en 2.1.0

## [2.2.0] - 2026-04-23

<a id="added--lifecycle--succession-parity-across-sdks"></a>
<a id="added-lifecycle-succession-parity-across-sdks"></a>

### Añadido — Paridad de ciclo de vida y sucesión entre SDK

Los SDK de Python, Rust y Go implementan ahora el comportamiento de DCP-05 (ciclo de vida del agente) y DCP-06
(sucesión digital). TypeScript ya los incluía en 2.0.x; la
versión 2.2.0 cierra la primera diferencia de paridad de comportamiento identificada en la
comparación entre SDK.

**Nuevas funciones (semántica idéntica en Python/Rust/Go, en línea con TS):**

Ciclo de vida del agente de DCP-05:

- `validate_state_transition` / `ValidateStateTransition`
- `compute_vitality_score` / `ComputeVitalityScore`
- `create_commissioning_certificate` / `CreateCommissioningCertificate`
- `create_vitality_report` / `CreateVitalityReport`
- `hash_vitality_report` / `HashVitalityReport`
- `create_decommissioning_record` / `CreateDecommissioningRecord`

Sucesión digital de DCP-06:

- `create_digital_testament` / `CreateDigitalTestament`
- `update_digital_testament` / `UpdateDigitalTestament`
- `classify_memory` / `ClassifyMemory`
- `create_memory_transfer_manifest` / `CreateMemoryTransferManifest`
- `execute_succession` / `ExecuteSuccession`

Todas las nuevas fábricas usan la ruta de firma compuesta existente con los
contextos de separación de dominio `DCP-AI.v2.Lifecycle` y `DCP-AI.v2.Succession`,
de modo que los artefactos producidos por cualquier SDK son compatibles en el formato de intercambio y verificables
entre SDK.

<a id="test-counts-after-this-release"></a>

### Recuento de pruebas tras esta versión

- Python: 169/169 superadas (+24 nuevas)
- Rust: 104/104 superadas (+10 nuevas)
- Go: 60/60 superadas (+13 nuevas en el paquete externo `dcp`; el paquete v2 no cambia)
- TypeScript: 460/460 superadas (sin cambios)

<a id="known-protocol-level-note"></a>

### Nota conocida en el nivel del protocolo

La canonicalización de DCP v2.0 prohíbe los números en coma flotante para el determinismo entre SDK, pero
el esquema del informe de vitalidad expresa los valores de cada métrica como `number`
(0.0..1.0). Las fábricas de los cuatro SDK aceptan ahora métricas en el límite de la
API, pero los firmantes exigen representaciones enteras en el formato de intercambio. Esto
está documentado en las pruebas de cada SDK. Una versión futura puede endurecer el
esquema a enteros (o puntos básicos) para eliminar del todo la diferencia.

<a id="versions-bumped-5"></a>
<a id="versions-bumped_5"></a>

### Versiones actualizadas

- `dcp-ai` (PyPI) 2.1.0 -> 2.2.0
- `dcp-ai` (crates.io) 2.1.0 -> 2.2.0
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` -> v2.2.0
- `@dcp-ai/sdk` (npm) sigue en 2.1.0 (TS ya tenía estas funciones)

<a id="210---2026-04-22"></a>

## [2.1.0] - 2026-04-22

<a id="added-3"></a>
<a id="added_3"></a>

### Añadido

**Exportador de OpenTelemetry (OTLP) para los cuatro SDK principales**: TypeScript, Python, **Rust y Go**. Quienes adoptan el protocolo pueden enviar ahora la observabilidad de DCP a cualquier backend compatible con OTel (Grafana, Jaeger, Honeycomb, Datadog, New Relic, Collectors autoalojados) sin puentes hechos a mano. Todo SDK que realiza criptografía DCP informa ahora de los mismos nombres de métricas, contadores y formas de spans.

- **Rust (`dcp-ai` 2.0.0 → 2.1.0)**
    - Nuevo módulo `dcp_ai::observability` con un singleton `DcpTelemetry` seguro entre hilos, métodos de registro, ciclo de vida de los spans, bus de listeners `on_event` y `MetricsSummary` con p50/p95/p99.
    - Característica opcional de Cargo `otlp` (`cargo add dcp-ai --features otlp`), que arrastra `opentelemetry`, `opentelemetry_sdk`, `opentelemetry-otlp` y `tokio`. Sin la característica, pedir `ExporterType::Otlp` emite un evento de error claro en lugar de entrar en pánico.
    - Rutas críticas instrumentadas: `crypto::sign_object` y `crypto::verify_object` emiten telemetría de latencia y errores cuando está activada. Sin sobrecarga cuando está desactivada (predeterminado).
    - 10 pruebas unitarias que cubren el comportamiento desactivado de forma predeterminada, los percentiles, el ciclo de vida de los spans, la distribución de niveles, la tasa de aciertos de caché y el aislamiento de pánicos de los listeners.

- **Go (`sdks/go/v2.0.0 → v2.1.0`)**
    - Nuevo paquete `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/observability` con un tipo `Telemetry` protegido por mutex, el singleton `Default()`, métodos de registro, suscriptores con recuperación de pánicos y cálculo de percentiles igual que en los demás SDK.
    - El puente OTLP está condicionado a la etiqueta de compilación `otlp` (`go build -tags otlp`). Sin la etiqueta, pedir `ExporterOTLP` emite un evento de error `otlp_init` claro por el bus de listeners. Las dependencias de `go.opentelemetry.io/otel` figuran en `go.mod`, pero las compilaciones predeterminadas no las necesitan en tiempo de ejecución.
    - Rutas críticas instrumentadas: `dcp.SignObject` y `dcp.VerifyObject` emiten telemetría de latencia y errores cuando está activada. Sin sobrecarga cuando está desactivada (predeterminado).
    - 10 pruebas unitarias del paquete de observabilidad + 2 pruebas de integración con `dcp.SignObject` que cubren las rutas activada y desactivada.

- **TypeScript (`@dcp-ai/sdk` 2.0.0 → 2.1.0)**
    - `dcpTelemetry.init({ exporterType: 'otlp' })` funciona ahora de verdad (el campo de configuración estaba declarado en 2.0.x pero no conectado).
    - El SDK de OTel se importa **de forma diferida**: las instalaciones predeterminadas no cambian. Los paquetes `@opentelemetry/*` se declaran como dependencias peer opcionales; cuando faltan, `init()` emite un evento de error claro por el bus de listeners y la aplicación sigue funcionando.
    - Nuevo `dcpTelemetry.shutdown()` para vaciar las exportaciones pendientes.
    - Resolución del endpoint: configuración `otlpEndpoint` → variable de entorno `OTEL_EXPORTER_OTLP_ENDPOINT` → `http://localhost:4318`.
    - Atributos de recurso `service.name` + `service.version` rellenados automáticamente.
    - Correspondencia de métricas: los registradores de DCP se corresponden con histogramas de OTel (`dcp.sign.latency_ms`, `dcp.verify.latency_ms`, `dcp.kem.latency_ms`, `dcp.checkpoint.latency_ms`, `dcp.bundle_verify.latency_ms`) y contadores (`dcp.signatures.created`, `dcp.signatures.verified`, `dcp.bundles.verified`, `dcp.a2a.sessions`, `dcp.errors`).
    - 2 casos nuevos de vitest; 460/460 pruebas superadas.

- **Python (`dcp-ai` 2.0.2 → 2.1.0)**
    - Nuevo módulo `dcp_ai.observability` que proporciona el singleton `dcp_telemetry` con la misma superficie de API que la versión de TypeScript: spans, registradores de métricas (`record_sign_latency`, `record_verify_latency`, `record_kem_latency`, `record_checkpoint_latency`, `record_bundle_verify`, `record_cache_hit/miss`, `record_a2a_*`, `record_error`), bus de listeners `on_event` y `get_metrics_summary` con p50/p95/p99.
    - Modos del exportador: `none` (predeterminado) / `console` / `otlp`.
    - Nuevo extra de instalación: `pip install 'dcp-ai[otlp]'` arrastra `opentelemetry-sdk` + `opentelemetry-exporter-otlp-proto-http`. Sin el extra, `init(exporter_type="otlp")` muestra una indicación clara de instalación sin fallar.
    - Rutas críticas instrumentadas: `sign_object` y `verify_object` emiten ahora telemetría de latencia y errores cuando está activada. Sin sobrecarga cuando está desactivada (predeterminado).
    - Exportación pública: `from dcp_ai import dcp_telemetry` funciona.
    - 15 casos nuevos de pytest; 145/145 pruebas superadas.

<a id="documentation-3"></a>
<a id="documentation_3"></a>

### Documentación

- Nuevo `docs/OBSERVABILITY.md` con tres recetas de backend listas para copiar y pegar (Jaeger local con Docker, endpoint OTLP de Grafana Cloud, Honeycomb).

<a id="backward-compatibility"></a>

### Compatibilidad con versiones anteriores

- Totalmente compatible con versiones anteriores en los cuatro SDK. Los valores predeterminados no cambian: la telemetría se distribuye desactivada y los registradores no hacen nada. Quien no quiera observabilidad no necesita cambiar código.
- Semver sincronizado: `@dcp-ai/sdk` (npm), `dcp-ai` (PyPI), `dcp-ai` (crates.io) y `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` pasan todos a 2.1.0. Los demás paquetes publicables (CLI, WASM, integraciones, andamiajes create-*) se quedan en sus versiones actuales.
- La observabilidad del SDK de WASM se pospone a una versión menor futura; la telemetría en el navegador tiene requisitos de transporte distintos.

<a id="template-packages---2026-04-21"></a>
<a id="template-packages-2026-04-21"></a>

## Paquetes de plantillas - 2026-04-21

Primera publicación de cuatro andamiajes `npm create @dcp-ai/*`, todos en `v2.0.0`:

- `@dcp-ai/create-langchain`
- `@dcp-ai/create-crewai`
- `@dcp-ai/create-openai`
- `@dcp-ai/create-express`

Uso: `npm create @dcp-ai/langchain my-app` (o cualquiera de los cuatro). Cada andamiaje incluye una plantilla inicial autónoma, con el mismo contenido que el `templates/<name>/` existente en el repositorio, más un `bin.js` mínimo de 35 líneas sin dependencias de ejecución.

<a id="infrastructure"></a>

## Infraestructura

- El **contexto JSON-LD** se sirve ahora en [`https://dcp-ai.org/credentials/v2`](https://dcp-ai.org/credentials/v2) (Content-Type `application/ld+json`, CORS `*`, caché de 24 h). Lo exige `@dcp-ai/w3c-did` para que toda Verifiable Credential/Presentation emitida sea desreferenciable por procesadores JSON-LD estrictos (Veramo, SpruceID, Trinsic).
- **Informes de cobertura de Codecov** agregados de los cuatro SDK (TypeScript, Python, Go, Rust) con indicadores por SDK. Insignia activa en el README.
- **Flujos de publicación reforzados**: cada trabajo (npm / PyPI / crates.io) comprueba antes el registro y termina en verde con un aviso de omisión si la versión del manifiesto ya está publicada. Se acabaron los trabajos en rojo en las publicaciones rutinarias.

<a id="go-sdk-v200---2026-04-19"></a>
<a id="go-sdk-v200-2026-04-19"></a>

## SDK de Go v2.0.0 - 2026-04-19

Primera versión del SDK de Go que se puede instalar con `go get`. La ruta de módulo anterior (`github.com/dcp-ai/dcp-ai-go`) apuntaba a un repositorio que no existía, así que nadie de fuera podía instalarlo. El módulo vive ahora como módulo de subdirectorio dentro de este monorepo:

- **Nueva ruta de módulo**: `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` (Go exige el sufijo `/v2` para las versiones mayores ≥ 2)
- **Formato de las etiquetas**: `sdks/go/v2.0.0` (con el prefijo del subdirectorio, como exige el proxy de módulos de Go para repositorios con varios módulos)
- **Instalación**: `go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.0.0`

El código no cambia: solo se reescribieron la ruta del módulo y las importaciones internas. Todas las pruebas siguen superándose.

## [2.0.2] - 2026-04-18

<a id="python-sdk"></a>

### SDK de Python

- **Corregido**: `dcp_ai.__version__` refleja ahora de forma dinámica la versión instalada mediante `importlib.metadata`, en lugar de una cadena fija. En 2.0.1 el atributo seguía informando `"1.0.0"` aunque el wheel fuera `2.0.1`.

<a id="ci--publish-workflows"></a>
<a id="ci-publish-workflows"></a>

### CI / flujos de publicación

- Cada trabajo de publicación (`publish.yml`, `publish-pypi.yml`, `publish-integrations.yml`) comprueba ahora antes si la versión del manifiesto ya está en el registro y, si es así, termina en verde con un aviso de omisión. Antes, cada ejecución desencadenada por una versión volvía a intentar publicar versiones ya publicadas y dejaba cuatro trabajos en rojo en la pestaña Actions. Se acabaron los fantasmas rojos cosméticos en las publicaciones rutinarias.
- Se corrigieron dos nombres de paquete desactualizados en la tabla de integraciones del README: `@dcp-ai/a2a` → `@dcp-ai/google-a2a`, `@dcp-ai/mcp` → `@dcp-ai/anthropic-mcp`.
- Se añadieron insignias de versión de npm / PyPI en vivo en cada fila de la tabla de integraciones.

## [2.0.1] - 2026-04-18

<a id="python-sdk-1"></a>
<a id="python-sdk_1"></a>

### SDK de Python

Los puentes con frameworks se incluyen ahora dentro del paquete. Antes de 2.0.1
vivían en `integrations/<name>/` en el repositorio y solo podían cargarse
mediante un truco de pytest; quien ejecutaba `pip install dcp-ai[fastapi]`
obtenía la biblioteca `fastapi` original, pero no el middleware `dcp_ai.fastapi`.
2.0.1 lo corrige: los cuatro módulos viven ahora en
`dcp_ai/` y se incluyen en el wheel publicado.

- **Añadido**: `dcp_ai.fastapi` (middleware, inyección de dependencias, comprobaciones de estructura V2)
- **Añadido**: `dcp_ai.langchain` (envoltorio de agente, callback, puntuación de riesgo)
- **Añadido**: `dcp_ai.openai` (cliente, esquema de herramientas, constructor de la pista de auditoría)
- **Añadido**: `dcp_ai.crewai` (agente de crew, pista de auditoría combinada, comprobaciones de coherencia de la sesión)
- **Eliminado**: el cargador dinámico de módulos de `tests/conftest.py` (ya no hace falta)

<a id="installation"></a>

### Instalación

```bash
pip install dcp-ai[fastapi]     # brings fastapi + uvicorn
pip install dcp-ai[langchain]   # brings langchain + langchain-core
pip install dcp-ai[openai]      # brings openai
pip install dcp-ai[crewai]      # brings crewai
```

<a id="backward-compatibility-1"></a>
<a id="backward-compatibility_1"></a>

### Compatibilidad con versiones anteriores

Totalmente compatible con las importaciones de 2.0.0. Los nuevos módulos solo añaden superficie
de API; las llamadas existentes `from dcp_ai import ...` no se ven afectadas.

## [npm integrations] - 2026-04-18

Primera publicación de los seis puentes con frameworks como paquetes npm
independientes, todos en `v2.0.0`:

- `@dcp-ai/anthropic-mcp`: puente con Anthropic MCP
- `@dcp-ai/autogen`: puente con Microsoft AutoGen
- `@dcp-ai/google-a2a`: puente con Google Agent-to-Agent
- `@dcp-ai/w3c-did`: puente con W3C DID/VC
- `@dcp-ai/express`: middleware de Express
- `@dcp-ai/openclaw`: plugin de OpenClaw

`@dcp-ai/express` y `@dcp-ai/openclaw` dependen de `@dcp-ai/sdk ^2.0.0`.

## [2.0.0] - 2026-04-18

Primera versión pública de los paquetes. Publicada a la vez en npm (`@dcp-ai/sdk`, `@dcp-ai/cli`, `@dcp-ai/wasm`), PyPI (`dcp-ai`) y crates.io (`dcp-ai`).

<a id="added-4"></a>
<a id="added_4"></a>

### Añadido

**Pila del protocolo (DCP-01 a DCP-09)**

- **DCP-01** Identidad y vinculación con la persona: identidad del agente, atestación del operador, vinculación de claves
- **DCP-02** Declaración de intenciones y control por políticas: intenciones declaradas, aplicación de niveles, evaluación de políticas
- **DCP-03** Cadena de auditoría y transparencia: entradas de auditoría encadenadas por hash, pruebas de Merkle, registros de transparencia
- **DCP-04** Comunicación entre agentes: descubrimiento, handshake, sesiones cifradas
- **DCP-05** Ciclo de vida del agente: puesta en servicio, informes de vitalidad, registros de retirada, máquina de estados con cuatro modos de terminación
- **DCP-06** Sucesión y herencia digitales: testamentos digitales, ceremonias de sucesión (planificada/forzada/de emergencia), manifiestos de transferencia selectiva de memoria
- **DCP-07** Resolución de conflictos y arbitraje: registros de disputa tipados, escalado en tres niveles, paneles de arbitraje M de N, paquetes de jurisprudencia, registros de objeción
- **DCP-08** Marco de derechos y obligaciones: cuatro derechos del agente (integridad de la memoria, transición digna, coherencia de la identidad, registro inmutable), seguimiento de obligaciones, informes de vulneración vinculados a DCP-07
- **DCP-09** Representación personal y delegación: mandatos de delegación, umbrales de conciencia, declaraciones de aviso, espejos del principal, registros de interacción de doble capa; extiende el handshake de DCP-04 con la verificación del mandato

**Criptografía (4 niveles: Routine / Standard / Elevated / Maximum)**

- Firmas compuestas poscuánticas: Ed25519 + ML-DSA-65 con vinculación `pq_over_classical`
- SLH-DSA-192f (FIPS 205) como firma de respaldo basada en hash
- Cadenas de auditoría de doble hash: SHA-256 + SHA3-256 para la integridad a largo plazo
- Vinculación de sesión: `session_nonce` en cada artefacto para impedir empalmes
- Manifiesto del bundle: hashes por artefacto, raíz de Merkle secundaria, seguimiento de los checkpoints PQ
- Gobernanza de algoritmos: avisos firmados con políticas de respuesta automática
- Recuperación de claves: recuperación social M de N mediante Shamir Secret Sharing
- Revocación de emergencia: tokens de revocación de emergencia registrados de antemano
- Modo de RPR cegado: registros del principal responsable que preservan la privacidad
- Separación de dominio: etiquetas de contexto en todas las firmas
- Derivación determinista del kid: `hex(SHA-256(alg || 0x00 || pk))[0:32]`
- Opciones de formato de intercambio: JSON (predeterminado) + CBOR (opcional, entre un 30 y un 40 % más pequeño)

**SDK, integraciones y herramientas**

- 5 SDK: TypeScript, Python, Go, Rust, WASM
- 10 integraciones: Express, FastAPI, LangChain, OpenAI, CrewAI, OpenClaw, W3C DID, Google A2A, Anthropic MCP, AutoGen (cobertura de DCP-01..09)
- JSON Schemas V2: conjunto completo de esquemas en `schemas/v2/`
- Vectores de prueba KAT del NIST: Known Answer Tests para la conformidad con FIPS 203/204/205
- Pruebas de interoperabilidad: verificación de bundles entre SDK
- Pila de Docker Compose: servicios de verificación, anclaje, registro de transparencia y revocación
- Pipelines de CI/CD: pruebas de conformidad, compilaciones de varios SDK, flujos de publicación
- Playground: creación y verificación de bundles en el navegador, con pestañas modulares de DCP-01..09, adaptado a móviles
- Plantillas de proyecto: proyectos iniciales para Express, LangChain, OpenAI y CrewAI
- CLI: `@dcp-ai/cli` interactiva con los comandos `dcp-init` y `dcp-ai`
- Refuerzo del servidor: autenticación y limitación de tasa de nivel de producción para los endpoints de DCP-05..09

**Documentación y citas**

- Artículo complementario en Zenodo: [doi.org/10.5281/zenodo.19040913](https://doi.org/10.5281/zenodo.19040913)
- `CITATION.cff`: metadatos de cita legibles por máquina

<a id="changed-1"></a>
<a id="changed_1"></a>

### Cambiado

- `human_binding_record` pasa a llamarse `responsible_principal_record` (RPR)
- El formato de firma cambia de `{ alg, public_key_b64, sig_b64 }` a `{ composite_sig: { classical, pq, binding } }`
- El sobre del bundle cambia de un `bundle_hash` plano a un `manifest` estructurado
- Los campos numéricos son ahora solo enteros (los números en coma flotante están prohibidos en los payloads firmados)
- La verificación pasa a estar dirigida por el verificador (basada en políticas)

<a id="fixed-4"></a>
<a id="fixed_4"></a>

### Corregido

- Proveedores PQ de `sdk/py`: importación del módulo ML-DSA-65 y firma de `pqc_verify` (`pk`, `sig`, `msg` separados)
- Proveedores PQ de `sdk/py`: importación del módulo SLH-DSA-192f y firma de `pqc_verify`
- Proveedores PQ de `sdk/py`: capturar el valor de retorno de `pqc_verify` (siempre devolvía True porque `pqcrypto.verify` devuelve un bool en lugar de lanzar una excepción)
- Criptografía de `sdk/py`: codificar en base64 la clave secreta Ed25519 en `generate_keypair`
- CI: fallos de las pruebas de conformidad, de criptografía y de varios SDK

<a id="backward-compatibility-2"></a>
<a id="backward-compatibility_2"></a>

### Compatibilidad con versiones anteriores

- Los verificadores V2 aceptan bundles V1 cuando `allow_v1_bundles: true` (predeterminado)
- Los verificadores V1 rechazan los bundles V2 con un mensaje de error claro

---

<a id="pre-release-milestones"></a>

## Hitos previos a la publicación

Las fechas siguientes marcan la evolución de la especificación antes de la primera publicación de paquetes. En esos momentos no se publicó ningún paquete.

- **2026-01-15**: especificación Genesis congelada (DCP-01, DCP-02, DCP-03)
- **2026-02-28**: especificación normativa V2.0 finalizada (criptografía híbrida poscuántica, modelo de seguridad de 4 niveles, A2A de DCP-04)
- **2026-03-16**: preprint del artículo en Zenodo
- **2026-04-15**: marco constitucional DCP-05..09 incorporado a `main`
- **2026-04-18**: v2.0.0 publicada en npm, PyPI y crates.io

[2.0.0]: https://github.com/dcp-ai-protocol/dcp-ai/releases/tag/v2.0.0
