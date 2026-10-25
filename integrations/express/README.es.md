<sub>[English](README.md) · [中文](README.zh-CN.md) · **Español** · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="dcp-aiexpress--express-middleware"></a>
<a id="dcp-aiexpress-express-middleware"></a>

# @dcp-ai/express — middleware para Express

> Traducción informativa de [la versión en inglés](README.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Middleware de verificación de DCP para Express.js. Verifica automáticamente los Signed Bundles en cada petición e inyecta los datos del agente verificado.

<a id="supported-dcp-specifications"></a>

## Especificaciones de DCP admitidas

De DCP-01 a DCP-09, de forma parcial: la verificación de bundles y la admisión tal como se describen abajo, y algunos campos de DCP-05 y DCP-09 (`requireActiveLifecycle`, `lifecycleState`, `mandateId`); no es una implementación completa de esas especificaciones.

<a id="installation"></a>

## Instalación

> **Estado de publicación (25/10/2026).** npm solo tiene `@dcp-ai/express` 2.0.0. Se publicó antes que la mayor parte de esta página y **no verifica las firmas de los bundles V2**: solo comprueba su estructura, así que un bundle V2 falsificado o alterado pasa (corregido en `main`, véase la sección `[Unreleased]` de [CHANGELOG.md](../../CHANGELOG.md)). No confíes en la 2.0.0 para bundles V2. Tampoco incluye la admisión (`trustedPrincipals`, `profile`, `revocationSource`), `revocationFailClosed`, la supervisión de fuentes ni `cancelOnDisconnect`. Este README sigue el código fuente de `main`. Hasta que `@dcp-ai/sdk` 2.2.0 esté en npm, este paquete depende del SDK del workspace (`"@dcp-ai/sdk": "file:../../sdks/typescript"`); para publicarlo hay que subir la dependencia a `^2.2.0`, y el flujo de publicación rechaza un paquete que dependa de una ruta local.

Para usar la versión que describe esta página, compílala desde un checkout e instálala desde ahí:

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai/sdks/typescript && npm install && npm run build      # the SDK of main
cd ../../integrations/express && npm install && npm run build  # this package
cd /path/to/your-app && npm install /path/to/dcp-ai/integrations/express express
```

La versión publicada (2.0.0), sin las funciones enumeradas arriba:

```bash
npm install @dcp-ai/express @dcp-ai/sdk
```

**Dependencia par:** Express 4.18+ o 5.x

<a id="quickstart"></a>

## Inicio rápido

```typescript
import express from "express";
import { dcpVerify, type DCPAgent } from "@dcp-ai/express";

// The middleware sets req.dcpAgent; the package does not augment Express's Request type
type DCPRequest = express.Request & { dcpAgent?: DCPAgent };

const app = express();
// The bundle travels in the JSON body: give the parser a budget sized for your bundles.
app.use(express.json({ limit: "64kb" }));

// Verify DCP on all routes
app.use(dcpVerify());

app.post("/api/action", (req: DCPRequest, res) => {
  // The verified agent is available at req.dcpAgent
  const agent = req.dcpAgent!;
  console.log(`Agent ${agent.agentId} (human: ${agent.humanId})`);
  console.log(`Capabilities: ${agent.capabilities}`);
  console.log(`Risk tier: ${agent.riskTier}`);

  res.json({ ok: true, agent_id: agent.agentId });
});

app.listen(3000);
```

<a id="sending-a-bundle-from-the-client"></a>

### Enviar un bundle desde el cliente

Envía el bundle en `signed_bundle` del cuerpo JSON. Es la forma recomendada para los bundles V2 híbridos, y el
middleware también lee la cabecera `X-DCP-Bundle` (primero) para los bundles que caben en una. La primera petición de
abajo es una plantilla: `{...}` representa un bundle firmado real.

```bash
# Via body (recommended)
curl -X POST http://localhost:3000/api/action \
  -H "Content-Type: application/json" \
  -d '{"signed_bundle": {...}, "action": "test"}'

# Via header: only for bundles that fit the header limits of the server and every proxy
curl -X POST http://localhost:3000/api/action \
  -H "Content-Type: application/json" \
  -H "X-DCP-Bundle: $(cat signed_bundle.json)" \
  -d '{"action": "test"}'
```

Un bundle híbrido (Ed25519 + ML-DSA-65) ocupa unos 33 KB: el bundle base de los vectores de admisión tiene 32.996
bytes. El límite por defecto de Node para todas las cabeceras de la petición es de 16 KiB, así que en `X-DCP-Bundle`
recibe `431` antes de que se ejecute Express; no subas el límite para que quepa. En el cuerpo, el `limit` del analizador
es tu presupuesto: un cuerpo mayor recibe `413` antes del middleware. El presupuesto es una elección para tu
despliegue, no un límite del protocolo: mide tu bundle más grande (crece con el rastro de auditoría y los checkpoints
PQ), deja margen y mantén los proxies de delante al menos igual de permisivos. `examples/strict-v1-body.mjs` comprueba
todo esto con HTTP real (véase `examples/README.md`).

<a id="api-reference"></a>

## Referencia de la API

### `dcpVerify(options?)`

Función fábrica que devuelve un middleware de Express.

```typescript
import { dcpVerify } from "@dcp-ai/express";

app.use(dcpVerify({
  requireBundle: true,
  checkRevocation: false,
  cacheTtlSeconds: 300,
  headerName: "x-dcp-bundle",
  onFailure: (req, res, errors) => {
    res.status(403).json({ error: "DCP verification failed", details: errors });
  },
}));
```

<a id="options-dcpverifyoptions"></a>

### Opciones (`DCPVerifyOptions`)

Una opción desconocida, un campo de `verifierPolicy` desconocido o un valor del tipo equivocado (por ejemplo, `allow_v1_bundles: "false"`) lanza una excepción al crear el middleware: una opción mal escrita no debe desactivar una comprobación.

| Opción | Tipo | Valor por defecto | Descripción |
|--------|------|---------|-------------|
| `requireBundle` | `boolean` | `true` | Exige un bundle en cada petición. Si es `false`, las peticiones sin bundle pasan sin verificación. |
| `checkRevocation` | `boolean` | `false` | En cada petición, haya veredicto en caché o no, pregunta al servicio de revocación si están revocados el agente (`GET /check/<agent_id>`) o, para V2, alguna clave con la que pueda firmarse el bundle (`GET /v2/check/kid/<kid>` para cada clave del pasaporte, cada clave de vinculación del RPR y los kids clásico y PQ de la firma del bundle). Una respuesta JSON con un `revoked` que se evalúe como verdadero rechaza la petición. |
| `revocationFailClosed` | `boolean` | `false` | Con `checkRevocation`: qué pasa cuando una consulta no da respuesta, es decir, cuando `fetch` lanza una excepción (servicio inalcanzable), la respuesta no es 2xx, el cuerpo no es JSON o su `revoked` falta o ni se evalúa como verdadero ni es `false`. `false` (por defecto) deja pasar la petición (falla abierto); `true` la rechaza con `403`. |
| `revocationServiceUrl` | `string` | `"http://localhost:3003"` | URL base del servicio de revocación. |
| `cacheTtlSeconds` | `number` | `0` | Segundos que se guardan en caché los resultados de verificación. `0` desactiva la caché. |
| `cacheMaxEntries` | `number` | `1000` | Máximo de bundles verificados que guarda la caché; se desaloja primero el usado menos recientemente. |
| `headerName` | `string` | `"x-dcp-bundle"` | Nombre de la cabecera HTTP en la que puede enviarse el bundle; se lee antes que `req.body.signed_bundle`. Solo para bundles dentro de los límites de cabeceras del servidor y de todos los proxies (el de Node, por defecto, es de 16 KiB para todas las cabeceras): envía los bundles híbridos en el cuerpo. |
| `onFailure` | `function` | `undefined` | Gestor propio para los errores de verificación. Recibe `(req, res, errors)` y, para una admisión rechazada, el resultado de la admisión como cuarto argumento. |
| `verifierPolicy` | `object` | `undefined` | Campos de la política del verificador (`VerifierPolicy` de `@dcp-ai/sdk`), combinados sobre `DEFAULT_VERIFIER_POLICY` del SDK. Un `default_mode` sin `risk_overrides` se aplica a todos los niveles de riesgo; las entradas de `risk_overrides` fijan sus niveles por encima de los demás. |
| `requireHybrid` | `boolean` | `false` | Todo modo por debajo de `hybrid_required` pasa a ser `hybrid_required`, y se rechazan los bundles V1. |
| `requireActiveLifecycle` | `boolean` | `false` | Rechaza un agente cuyo `status` del pasaporte es `decommissioned`. Lee el estado del pasaporte, no un certificado de puesta en servicio ni un registro de ciclo de vida de DCP-05. Solo V2. |
| `trustedPrincipals` | `object` o `function` | `undefined` | Los principales en los que confías y sus claves: un conjunto de confianza (`schemas/v2/principal_trust_set.schema.json`), o `({ tenant }) => trust set` llamada en cada petición. Con ella, solo los bundles V2 admitidos llegan a la ruta (véase abajo). Una función que lanza una excepción, o que devuelve `undefined`, `null` o un conjunto de confianza no válido, rechaza la petición con `503`. |
| `profile` | `object` | `undefined` | El perfil strict-v1 (`schemas/v2/admission_profile.schema.json`). Necesita `trustedPrincipals` y `revocationSource`. |
| `revocationSource` | `function` | `undefined` | `(subjects, { tenant }) => snapshot`, la fuente de revocación del perfil, p. ej., `denyListRevocationSource({ url, headers })`. |
| `revocationTimeoutMs` | `number` | `5000` | Cuánto puede tardar la fuente de revocación antes de rechazar la petición. Con `supervise.revocation`, el plazo supervisado: un entero de 1 a 2147483647. |
| `sourceSupervisor` | `object` | `undefined` | Un supervisor de `createSourceSupervisor`, junto con `supervise` (véase [Supervisar la fuente de confianza](#supervising-the-trust-source)). |
| `supervise` | `object` | `undefined` | `{ trustTimeoutMs?, revocation? }`, al menos uno: `trustTimeoutMs`, un entero de 1 a 2147483647, el plazo de una función `trustedPrincipals` con `sourceSupervisor`; `revocation: true` ejecuta bajo él la `revocationSource` del perfil, con `revocationTimeoutMs` (véase [Supervisar la fuente de revocación](#supervising-the-revocation-source)). |
| `cancelOnDisconnect` | `boolean` | `false` | Cuando el cliente se va de verdad durante la admisión, cancela su invocación supervisada de la fuente (véase [Un cliente que se va](#a-client-that-leaves)). |
| `tenant` | `function` | un solo inquilino | `(req) => string`, a partir de tu propio contexto autenticado, nunca de una cabecera que defina el cliente. Selecciona el conjunto de confianza y separa los veredictos en caché. |
| `clock` | `function` | `Date.now` | Para las pruebas. |

### `req.dcpAgent`

Tras una verificación correcta, `req.dcpAgent` contiene:

```typescript
interface DCPAgent {
  agentId: string;      // Agent ID
  humanId: string;      // ID of the responsible human
  publicKey: string;    // Ed25519 public key
  capabilities: string[];  // Declared capabilities
  riskTier: string;     // Risk level (low/medium/high)
  status: string;       // Status (active/suspended/revoked)
  dcpVersion: "1.0" | "2.0";
  kids?: string[];          // V2: key identifiers of the passport keys
  sessionNonce?: string;    // V2: session nonce of the bundle
  lifecycleState?: string;  // DCP-05 lifecycle state
  mandateId?: string;       // DCP-09 delegation mandate ID
  warnings?: string[];      // V2: warnings of the SDK verifier (e.g. classical-only signature)
  verificationMode?: string; // V2: the mode the bundle was verified in
  securityTier?: string;     // V2: security tier of its intent and policy decision (spec §14.2)
  admission?: {              // with trustedPrincipals
    admitted: true;
    principalTrust: "trusted";
    profile: "strict-v1" | null;
    profileCompliance: "compliant" | "not_evaluated";
    recordedDecision: string | null; // approve, escalate, block: evidence, not a permission
    trustSetVersion: string | null;
    actionAuthorized: false;         // always: admission does not authorize an action
  };
}
```

<a id="behavior"></a>

### Comportamiento

1. Extrae el bundle firmado de la cabecera `X-DCP-Bundle` (JSON) o de `req.body.signed_bundle`
2. Lo verifica:
   - **V2** (`bundle.dcp_bundle_version: "2.0"`): `verifySignedBundleV2()` de `@dcp-ai/sdk`, con un registro Ed25519 / ML-DSA-65 / SLH-DSA-192f y la política anterior. Comprueba los hashes de los payloads de los artefactos y el manifiesto; la vinculación de sesión, la caducidad y el inicio de sesión firmado (`session_issued_at`); la firma del bundle sobre el manifiesto, hecha por el principal con las `binding_keys` del RPR, y el bloque `signature` sin firmar, que debe coincidir con ella; la firma propia de cada artefacto; el modo de verificación, el más estricto entre el modo de la política para el `risk_tier` del pasaporte y el modo del nivel de seguridad de la intención y la decisión de política (§14.2 de la especificación); los checkpoints PQ; la coherencia entre artefactos (estado del pasaporte, caducidad del RPR, un solo agente, principal e intención en los artefactos y las entradas de auditoría); la cadena de hash de auditoría; y la validez de las claves, la derivación de los kids y las claves en base64 canónico (`spec/VERIFICATION.md` de V2-1 a V2-14). La cadena de auditoría y la raíz de Merkle que comprueba son las SHA-256: no recalcula la cadena ni la raíz secundarias SHA3-256 de V2-11, así que la referencia a VERIFICATION.md no significa que se compruebe cada uno de sus pasos. Un bundle mal formado se rechaza con `403`, nunca se acepta solo por su estructura.
   - **V1** (`bundle.responsible_principal_record.dcp_version: "1.0"`): `verifySignedBundle()`, solo donde VERIFICATION.md V2-10 aceptaría un bundle solo clásico, porque un bundle V1 no tiene firma poscuántica: `allow_v1_bundles` es `true`, `requireHybrid` está desactivado, y el más estricto entre el modo de la política para el `risk_tier` del pasaporte V1 (`default_mode` si no tiene ninguno) y el modo del nivel de seguridad de la intención y la decisión de política V1 (el `risk_score` V1 va de 0 a 1, escalado por 1000; si falta, cuenta como `elevated`) es `classical_only` o `hybrid_preferred`. Con la política por defecto, una intención V1 routine o standard pasa, mientras que un pago, datos sensibles, un impacto estimado alto o una puntuación de riesgo de 0,5 o más se rechazan. A un bundle V1 solo se le aplican `allow_v1_bundles`, el modo y el nivel: la vinculación de audiencia, los límites de caducidad y duración de la sesión, un `accepted_classical_algs` sin Ed25519 y los avisos que rechazan Ed25519 son comprobaciones de V2, y un bundle V1 que supera la comprobación de modo se acepta aunque estén definidos. Si necesitas esos controles, define `allow_v1_bundles: false` o `requireHybrid: true`, o usa `trustedPrincipals` con el perfil strict-v1.
   - Un bundle cuya versión no puede detectarse se rechaza con `403`.
3. Si es válido: inyecta `req.dcpAgent` y llama a `next()`
4. Si falla: responde con `403`, los `errors` y `warnings` del verificador (o usa `onFailure` si está configurado)
5. Si se produce un error interno: responde con `500`

<a id="what-verified-means"></a>

### Qué significa «verificado»

Un bundle verificado es coherente internamente y está firmado por las claves que él mismo enumera: las `binding_keys` del RPR para la firma del bundle, las claves del pasaporte para los artefactos del agente. No prueba quién es el principal: cualquiera puede crear claves y un RPR que nombre cualquier `human_id`. Para eso, define `trustedPrincipals` (siguiente sección).

Quien tenga un bundle verificado puede reenviarlo hasta que caduque su sesión. Contra el reenvío de bundles V2 (estas comprobaciones no se aplican a los bundles V1, véase Comportamiento), define `verifierPolicy.require_audience_binding: true` con tu `verifier_id` (el `manifest.intended_verifier` del bundle debe nombrar a este verificador), y `require_session_expiry` / `max_session_duration_seconds` para acotar la sesión, o usa el perfil strict-v1. Nada de esto hace que un bundle sea de un solo uso: lleva tu propio registro de nonces consumidos si lo necesitas.

<a id="trusted-principals-and-strict-v1"></a>

### Principales de confianza y strict-v1

Con `trustedPrincipals`, una petición llega a la ruta solo cuando su bundle está **admitido** (`docs/ADMISSION.md`, `spec/profiles/admission`): un bundle V2 cuyas firmas del principal (el RPR y el manifiesto del bundle, clásica y poscuántica) se hicieron con claves que tu conjunto de confianza enumera para ese `human_id`, activas y dentro de su ventana de validez. Con `profile` se aplican además los requisitos de strict-v1: firmas híbridas para todos los niveles de riesgo, un `intended_verifier` firmado igual a tu `verifier_id`, una sesión firmada de 300 s como máximo y una instantánea de revocación reciente.

```typescript
import { dcpVerify, denyListRevocationSource } from "@dcp-ai/express";

app.use("/api/agents", dcpVerify({
  trustedPrincipals: trustSet,
  profile: { profile: "strict-v1", verifier_id: "api.acme.example" },
  revocationSource: denyListRevocationSource({ url: "https://revocation.acme.example/.well-known/dcp-revocations.json" }),
  tenant: (req) => req.auth.tenant,
  cacheTtlSeconds: 60,
}));
```

Una petición rechazada recibe `403` con `{ verified, admitted: false, principal_trust, profile, profile_compliance, codes, errors }` y nunca llega a la ruta. `denyListRevocationSource` necesita una URL `https` (`http` simple solo hacia un host de loopback), no sigue redirecciones y lee 16 MiB como máximo. Una fuente de revocación que falla, agota el tiempo o no devuelve nada rechaza la petición (`REVOCATION_UNAVAILABLE`). Con principales de confianza, `requireBundle: false` lanza `AdmissionConfigError` al crear el middleware: si no, una petición sin bundle llegaría a la ruta. Con el perfil, `verifierPolicy`, `requireHybrid: false` y las opciones de `checkRevocation` también lanzan una excepción. Con principales de confianza, los bundles V1 se rechazan: no llevan ninguna firma del principal que anclar. Ejecutables: `examples/strict-v1.mjs` y, con HTTP real, el bundle en el cuerpo y un presupuesto del cuerpo, `examples/strict-v1-body.mjs`.

Las pruebas ejecutan todos los casos de `tests/interop/v2/bundle_vectors.json`, cada uno con sus `verifier_policy_overrides`.

<a id="supervising-the-trust-source"></a>

### Supervisar la fuente de confianza

Sin estas opciones, una función `trustedPrincipals` no tiene plazo, como antes. Con ellas, tiene uno, y una parte de una capacidad:

```typescript
import { createSourceSupervisor, dcpVerify } from "@dcp-ai/express";

// One object per process, shared by every middleware (and by @dcp-ai/openclaw) that should share one capacity.
const supervisor = createSourceSupervisor({ maxInFlight: 64, maxInFlightPerTenant: 8 });

app.use("/api/agents", dcpVerify({
  trustedPrincipals: ({ tenant, signal }) => loadTrustSet(tenant, { signal }),
  sourceSupervisor: supervisor,
  supervise: { trustTimeoutMs: 2000 },
  tenant: (req) => req.auth.tenant,
}));
```

- **Plazo.** La función recibe `{ tenant, signal }`. Un conjunto de confianza que llega después de `trustTimeoutMs` no se usa, tampoco cuando el bucle de eventos estaba demasiado ocupado para ejecutar el temporizador: el plazo se mide con un reloj monotónico cuando llega el resultado. La petición recibe entonces el mismo `503` que una fuente que falla (`TRUST_SOURCE_FAILED`), y `signal` se aborta.
- **Capacidad.** `maxInFlight` cuenta las llamadas que el middleware inició y que todavía no se han resuelto, en todos los inquilinos; `maxInFlightPerTenant` limita a un inquilino, y sin él un solo inquilino puede quedarse con toda la capacidad. Una llamada que no encuentra hueco libre recibe el mismo `503` de inmediato; no hay cola. **Un hueco solo se libera cuando la función se resuelve de verdad**, no cuando la petición agota el tiempo: una fuente que nunca se resuelve conserva su hueco, y cuando todos los huecos están ocupados el middleware rechaza todas las peticiones hasta que reinicies el proceso o crees otro supervisor.
- **Alcance.** La capacidad es por objeto supervisor. Dos supervisores son dos capacidades, así que el límite de un proceso es la suma de los supervisores que crea. Un supervisor creado por `@dcp-ai/openclaw`, desde su compilación ESM o CJS, funciona también aquí, y al revés.
- **`supervisor.close({ drainMs })`** rechaza las llamadas nuevas, responde a las pendientes con `503`, aborta todos los `signal` y espera como máximo `drainMs` (por defecto, 0) a las llamadas en curso. Se resuelve con cuántas siguen en curso; sus huecos siguen ocupados.
- **`supervisor.stats()`** devuelve contadores: `open`, `inFlight`, `tenants`, `timeouts`, `saturated`, `closed`, `lateResults`, `lateErrors`, `droppedEvents`. `onSourceEvent` en `createSourceSupervisor` recibe `{ source, reason, inFlight }`, nunca un inquilino. Debe ser rápido, porque se ejecuta en el mismo bucle de eventos: una llamada cada vez, y los eventos que llegan mientras hay una en cola o con su promesa pendiente se descartan y se cuentan. Una promesa o un thenable devueltos se asimilan como lo hace `Promise.resolve`: un thenable resuelto con una promesa pendiente lo mantiene ocupado, y un resolvedor llamado otra vez más tarde no libera nada. Sus errores y rechazos se ignoran. Los contadores se detienen en `Number.MAX_SAFE_INTEGER`.
- **Lo que no hace.** No detiene el trabajo de una fuente: una función que ignora `signal` se ejecuta hasta el final. No limita el trabajo que una función inicia por su cuenta y no devuelve. No ayuda a una función que bloquea el bucle de eventos, lo que retrasa todos los plazos. La verificación de un bundle sigue ejecutándose antes que la fuente de confianza. Sin `supervise.revocation`, la revocación mantiene `revocationTimeoutMs` como antes.

<a id="supervising-the-revocation-source"></a>

#### Supervisar la fuente de revocación

Con el perfil strict-v1, `supervise: { revocation: true }` ejecuta la `revocationSource` bajo el mismo tipo de supervisor, con `revocationTimeoutMs` como plazo (entonces, un entero de 1 a 2147483647):

```typescript
app.use("/api/agents", dcpVerify({
  trustedPrincipals: trustSet, // a static trust set, or a function supervised with trustTimeoutMs
  profile: { profile: "strict-v1", verifier_id: "verifier:acme-api" },
  revocationSource: denyListRevocationSource({ url: "https://revocations.example.com/.well-known/dcp-revocations.json" }),
  revocationTimeoutMs: 2000,
  sourceSupervisor: supervisor,
  supervise: { revocation: true }, // or { trustTimeoutMs: 2000, revocation: true }
}));
```

- **Opcional.** `supervise` admite `trustTimeoutMs`, `revocation: true` o ambos. `revocation: true` necesita una `revocationSource` y funciona con un conjunto de confianza estático. Sin ella, la revocación mantiene `revocationTimeoutMs` como antes.
- **Las mismas respuestas.** La fuente recibe `(subjects, { tenant, signal })`, y cada respuesta da la misma contestación que sin supervisión. Una instantánea se evalúa como antes. `null`, un fallo, un tiempo agotado, una llamada sin hueco libre y un supervisor cerrado dan `403` con `codes: ["REVOCATION_UNAVAILABLE"]`, nunca no revocado. Un error cuyo `code` es `REVOCATION_INVALID` da `REVOCATION_INVALID` solo cuando llega antes del plazo; después, es un tiempo agotado.
- **Una sola capacidad.** Las llamadas de confianza y de revocación ocupan huecos del mismo supervisor, cada uno retenido hasta que su fuente se resuelve de verdad. Una instantánea tardía nunca se usa, ni para su petición ni para ninguna otra, y la caché de veredictos nunca guarda una.
- **`denyListRevocationSource`** aborta su fetch, y la lectura de su cuerpo, cuando se aborta el `signal` del supervisor, además de en su propio `timeoutMs`.
- **Telemetría.** Sus eventos llevan `source: 'revocation'`.
- **Límites.** Los mismos que para la fuente de confianza. La ruta heredada `checkRevocation` / `revocationServiceUrl` no está supervisada.

<a id="a-client-that-leaves"></a>

#### Un cliente que se va

Con `cancelOnDisconnect: true`, un cliente que se va de verdad mientras se admite su petición detiene el trabajo de esa petición:

```typescript
app.use("/api/agents", dcpVerify({
  trustedPrincipals: ({ tenant, signal }) => loadTrustSet(tenant, { signal }),
  sourceSupervisor: supervisor,
  supervise: { trustTimeoutMs: 2000 },
  cancelOnDisconnect: true,
}));
```

- **Qué cuenta como irse.** La respuesta se cierra antes de enviarse, o la petición se cierra antes de completar su cuerpo. El propio `close` de una petición una vez leído su cuerpo, que también ocurre en peticiones sanas, no cuenta.
- **Qué cancela.**
  - Solo la invocación supervisada de la fuente de esa petición: su `signal` se aborta y la invocación se cuenta en `stats().cancelled`, con la razón `'cancelled'` en `onSourceEvent`.
  - Ni el supervisor ni ninguna otra petición.
  - Su hueco sigue ocupado hasta que la fuente se resuelve de verdad, como tras un plazo: una fuente que ignora `signal` sigue ejecutándose.
- **Qué le pasa a la petición.** Nada más:
  - ni gestor ni `next()`;
  - ni escritura en la caché ni `onFailure`;
  - no se escribe ninguna respuesta.
  - La verificación del bundle no se interrumpe; el middleware comprueba después de ella.
- **Requisitos.** Se comprueban al crear el middleware:
  - Toda función de fuente debe estar supervisada: `trustTimeoutMs` para una función `trustedPrincipals`, y `revocation: true` para `revocationSource`. No se permiten ni `checkRevocation` ni un `cancelOnDisconnect` sin una fuente supervisada (`AdmissionConfigError`, `CONFIG_PROFILE_CONTRADICTION`).
  - El supervisor debe admitir la cancelación (si no, `CONFIG_INVALID_VALUE`). Los supervisores de esta versión de `@dcp-ai/express` o `@dcp-ai/openclaw`, ESM o CJS, la admiten; uno de un paquete más antiguo no, y sin la opción sigue funcionando como antes.
- **Leer `cancelled`.** `stats().cancelled` es opcional en el tipo, para que un supervisor de un paquete más antiguo siga compilando: léelo como `stats().cancelled ?? 0`.

### Caché

Cuando `cacheTtlSeconds > 0`, cada middleware mantiene su propia caché de bundles verificados, con la clave formada por el SHA-256 de la forma canónica del bundle firmado (`canonicalizeV2`), la huella de la política del verificador y el inquilino: un veredicto en caché solo se reutiliza para el mismo bundle, con la misma política y para el mismo inquilino, y un bundle sin forma canónica (un número no entero como `1e999`, o un anidamiento demasiado profundo) se verifica pero no se guarda en caché. Una entrada caduca tras `cacheTtlSeconds`, o antes cuando caducan la sesión del bundle (`manifest.session_expires_at`), el RPR, una clave del pasaporte o una clave de vinculación del RPR; un bundle con una marca de tiempo de caducidad que no es RFC 3339 no se guarda en caché. La caché guarda como máximo `cacheMaxEntries` bundles, desalojando primero las entradas caducadas y después las usadas menos recientemente. Con `checkRevocation`, la revocación se vuelve a comprobar en cada acierto de la caché. Con `trustedPrincipals`, la caché solo guarda la verificación criptográfica: la confianza en el principal, las comprobaciones del perfil y la revocación se evalúan en cada petición, así que un principal eliminado del conjunto de confianza o una clave revocada se rechazan en la petición siguiente.

<a id="advanced-example--selectively-protected-routes"></a>
<a id="advanced-example-selectively-protected-routes"></a>

## Ejemplo avanzado — rutas protegidas de forma selectiva

```typescript
import express from "express";
import { dcpVerify, type DCPAgent } from "@dcp-ai/express";

type DCPRequest = express.Request & { dcpAgent?: DCPAgent };

const app = express();
app.use(express.json());

// Public routes (no verification)
app.get("/health", (req, res) => res.json({ ok: true }));

// Protected routes (require DCP)
const protectedRoutes = express.Router();
protectedRoutes.use(dcpVerify({ cacheTtlSeconds: 60 }));

protectedRoutes.post("/agent/action", (req: DCPRequest, res) => {
  res.json({ agent: req.dcpAgent!.agentId });
});

protectedRoutes.get("/agent/profile", (req: DCPRequest, res) => {
  res.json(req.dcpAgent);
});

app.use("/api", protectedRoutes);
app.listen(3000);
```

<a id="development"></a>

## Desarrollo

```bash
# Build the workspace SDK first (see Installation), then:
npm install

# Build (ESM + CJS + types)
npm run build

# Tests
npm test
```

<a id="dependencies"></a>

### Dependencias

- `@dcp-ai/sdk` — SDK de verificación de DCP
- `express` (par) — framework HTTP

<a id="license"></a>

## Licencia

Apache-2.0
