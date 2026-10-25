<sub>[English](README.md) · [中文](README.zh-CN.md) · **Español** · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="dcp-aiopenclaw--dcp-integration-for-openclaw"></a>
<a id="dcp-aiopenclaw-dcp-integration-for-openclaw"></a>

# @dcp-ai/openclaw — integración de DCP para OpenClaw

> Traducción informativa de [la versión en inglés](README.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Plugin de [OpenClaw](https://github.com/openclaw/openclaw) que añade herramientas del **Digital Citizenship Protocol (DCP)** a los agentes de IA. Una acción se declara, se puntúa por riesgo y
se registra en un registro de auditoría encadenado por hash y vinculado a un propietario humano cuando el agente llama a estas herramientas: el plugin no
intercepta las demás herramientas del agente. Para controlar cada acción sensible, el anfitrión debe interceptar él mismo esas llamadas a herramientas
y llamar a `dcp_declare_intent` / `dcp_log_action` alrededor de ellas. El estado de la sesión vive en un `Map` en memoria y se pierde
cuando el proceso se reinicia.

<a id="supported-dcp-specifications"></a>

## Especificaciones de DCP admitidas

De DCP-01 a DCP-09, de forma parcial: las herramientas de abajo crean registros con las formas de esas especificaciones, y
`dcp_verify_bundle` verifica bundles. No las implementa por completo.

<a id="features"></a>

## Funcionalidades

- **Identidad (DCP-01)** — generación de pares de claves Ed25519, Responsible Principal Record, Agent Passport
- **Declaración de intención (DCP-02)** — puntuación de riesgo y una decisión de política antes de las acciones sensibles, que aplica el anfitrión
- **Registro de auditoría (DCP-03)** — registro de acciones encadenado por hash con referencias a evidencias: permite detectar manipulaciones (una entrada alterada rompe la cadena), no es inmutable y se guarda en memoria
- **Ciclo de vida (DCP-05)** — puesta en servicio, informes de vitalidad y baja de agentes
- **Sucesión (DCP-06)** — testamento digital con preferencias de sucesor y clasificación de la memoria
- **Delegación (DCP-09)** — creación de mandatos de delegación para transferir autoridad de humano a agente
- **Verificación de bundles** — los Signed Bundles V2 los verifica `verifySignedBundleV2` del SDK (firmas, hashes, vinculación de sesión, cadena de auditoría, validez de las claves) bajo la política de verificador del operador
- **Firma de bundles** — construye y firma un CitizenshipBundle al final de la sesión: una intención y su decisión de política, con las entradas de auditoría de la sesión (véase la nota en [Puntuación de riesgo](#risk-scoring))
- **Registros de DCP-05 a DCP-09** — los registros de puesta en servicio, vitalidad, baja, testamento y mandato se guardan en el estado de la sesión; `dcp_sign_bundle` no los añade al bundle y el plugin no los envía a ninguna parte
- **SKILL.md** — skill complementaria que enseña al agente a usar las herramientas de DCP

<a id="installation"></a>

## Instalación

> **Estado de publicación (25/10/2026).** npm solo tiene `@dcp-ai/openclaw` 2.0.0; este README sigue el código fuente de `main` (versión 2.1.0, no publicada). La 2.0.0 publicada **no verifica las firmas de los bundles V2** en `dcp_verify_bundle`: solo comprueba su estructura, así que un bundle V2 falsificado o alterado pasa (corregido en `main`, véase la sección `[Unreleased]` de [CHANGELOG.md](../../CHANGELOG.md)). No confíes en la 2.0.0 para bundles V2; tampoco incluye la política del operador, los principales de confianza ni el supervisor de fuentes. Hasta que `@dcp-ai/sdk` 2.2.0 esté en npm, este paquete depende del SDK del workspace (`"@dcp-ai/sdk": "file:../../sdks/typescript"`); para publicarlo hay que subir la dependencia a `^2.2.0`, y el flujo de publicación rechaza un paquete que dependa de una ruta local.

Para usar la versión que describe esta página, compílala desde un checkout e instálala desde allí:

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai/sdks/typescript && npm install && npm run build       # the SDK of main
cd ../../integrations/openclaw && npm install && npm run build  # this package
# then, in your OpenClaw plugins directory:
npm install /path/to/dcp-ai/integrations/openclaw
```

La versión publicada (2.0.0), sin esas correcciones y funcionalidades:

```bash
# In your OpenClaw plugins directory
npm install @dcp-ai/openclaw
```

Añade a la configuración de OpenClaw:

```yaml
plugins:
  - "@dcp-ai/openclaw"
```

<a id="tools-registered"></a>

## Herramientas registradas

| Herramienta | Descripción | Especificación de DCP |
|------|-------------|----------|
| `dcp_identity_setup` | Genera el par de claves + RPR + AgentPassport | DCP-01 |
| `dcp_declare_intent` | Declara la intención y obtiene la decisión de política (approve/escalate/block) | DCP-02 |
| `dcp_verify_bundle` | Verifica un Signed Bundle con el verificador del SDK (firma + hashes + vinculación de sesión) | VERIFICATION |
| `dcp_log_action` | Registra la acción como AuditEntry con encadenamiento por hash | DCP-03 |
| `dcp_get_audit_trail` | Recupera el registro de auditoría de la sesión | DCP-03 |
| `dcp_commission_agent` | Pone en servicio a un agente (ciclo de vida → commissioned) | DCP-05 |
| `dcp_report_vitality` | Informa de métricas de vitalidad y obtiene la puntuación calculada | DCP-05 |
| `dcp_decommission_agent` | Da de baja a un agente (graceful/immediate/emergency) | DCP-05 |
| `dcp_create_testament` | Crea un testamento digital con preferencias de sucesor | DCP-06 |
| `dcp_create_mandate` | Crea un mandato de delegación de humano a agente | DCP-09 |
| `dcp_sign_bundle` | Construye y firma el CitizenshipBundle a partir del estado de la sesión | BUNDLE |

<a id="usage-flow"></a>

## Flujo de uso

```
┌─────────────────────────────────────────────────────┐
│                  Session Start                       │
│  dcp_identity_setup(owner, jurisdiction, caps)       │
└──────────────────────┬──────────────────────────────┘
                       │
          ┌────────────▼─────────────┐
          │   For each sensitive      │
          │   action:                 │
          │                           │
          │  1. dcp_declare_intent()  │
          │     → approve/escalate/   │
          │       block               │
          │                           │
          │  2. [perform action]      │
          │                           │
          │  3. dcp_log_action()      │
          └────────────┬─────────────┘
                       │ (repeat)
          ┌────────────▼─────────────┐
          │     Session End           │
          │  dcp_sign_bundle()        │
          │  → SignedBundle           │
          └───────────────────────────┘
```

<a id="architecture"></a>

## Arquitectura

```
integrations/openclaw/
├── package.json               # Dependencies: @dcp-ai/sdk, @sinclair/typebox
├── tsconfig.json
├── SKILL.md                   # Companion skill with agent instructions
├── README.md                  # This file
└── src/
    ├── index.ts               # Plugin entry — registerTool() calls
    ├── tools/
    │   ├── identity.ts        # dcp_identity_setup
    │   ├── intent.ts          # dcp_declare_intent
    │   ├── verify.ts          # dcp_verify_bundle
    │   ├── audit.ts           # dcp_log_action + dcp_get_audit_trail
    │   ├── lifecycle.ts       # dcp_commission_agent + dcp_report_vitality + dcp_decommission_agent
    │   ├── succession.ts      # dcp_create_testament
    │   └── delegation.ts      # dcp_create_mandate
    └── state/
        └── agent-state.ts     # Per-session DCP state management
```

<a id="bundle-verification"></a>

## Verificación de bundles

<a id="policy-set-by-the-operator-tightened-by-the-model"></a>

### Política: la fija el operador, la endurece el modelo

La política de verificador de `dcp_verify_bundle` es la del operador: la `DEFAULT_VERIFIER_POLICY` del SDK salvo que el anfitrión fije otra, con `register(api, { verifierPolicy })` o `configureVerifier({ verifierPolicy })` (campos sobre la política predeterminada; un `default_mode` sin `risk_overrides` se aplica a todos los niveles de riesgo; un campo desconocido o un tipo erróneo lanza una excepción).

```typescript
import register, { configureVerifier } from '@dcp-ai/openclaw';

configureVerifier({ verifierPolicy: { default_mode: 'hybrid_required', require_audience_binding: true, verifier_id: 'my-service' } });
```

El parámetro `verifier_policy` de la herramienta lo fija el modelo que llama, así que solo puede hacer esa política más estricta: `default_mode` eleva cada nivel de riesgo al menos a ese modo (`classical_only` < `hybrid_preferred` < `hybrid_required`; `pq_only` combinado con cualquier otro modo da `hybrid_required`, porque `pq_only` prescinde de la firma clásica que exigen los demás modos), `require_session_binding` y `require_composite_binding` solo pueden activarse, y `allow_v1_bundles` solo puede desactivarse. Cualquier otro campo es un error.

<a id="what-is-checked"></a>

### Qué se comprueba

- **V2**: `verifySignedBundleV2` de `@dcp-ai/sdk`, con un registro Ed25519 / ML-DSA-65 / SLH-DSA-192f y la política anterior. Comprueba los hashes de las cargas útiles de los artefactos y el manifiesto; la vinculación de sesión, la caducidad y el inicio de sesión firmado (`session_issued_at`); la firma del bundle sobre el manifiesto, hecha por el principal con las `binding_keys` del RPR, y el bloque `signature` sin firmar que debe coincidir con ella; la firma propia de cada artefacto; el modo de verificación, el más estricto entre el modo de la política para el `risk_tier` del pasaporte y el modo del nivel de seguridad de la intención y de la decisión de política (spec §14.2); los checkpoints PQ; la coherencia entre artefactos (estado del pasaporte, caducidad del RPR, un único agente, principal e intención en los artefactos y en las entradas de auditoría); la cadena de hash de auditoría (SHA-256: no se recalculan la cadena ni la raíz secundarias SHA3-256 de V2-11); y la validez de las claves, la derivación de los kid y las claves en base64 canónico (`spec/VERIFICATION.md` V2-1 a V2-14).
- **V1** (una firma Ed25519): se verifica con `verifySignedBundle` solo donde VERIFICATION.md V2-10 aceptaría un bundle solo clásico: `allow_v1_bundles` es true y el más estricto entre el modo de la política para el `risk_tier` del pasaporte V1 y el modo del nivel de seguridad de la intención y la decisión de política V1 (el `risk_score` V1 va de 0 a 1 y se multiplica por 1000; si falta, cuenta como `elevated`) es `classical_only` o `hybrid_preferred`. Con la política predeterminada pasa una intención V1 routine o standard; se rechazan un pago, datos sensibles, un impacto estimado alto o una puntuación de riesgo de 0,5 o más.
- Un bundle cuya versión no puede detectarse se rechaza.

A un bundle V1 solo se aplican `allow_v1_bundles`, el modo y el nivel: la vinculación de audiencia, la caducidad y los límites
de duración de la sesión, un `accepted_classical_algs` sin Ed25519 y los avisos que rechazan Ed25519 son comprobaciones de V2,
y un bundle V1 que supera la comprobación del modo se acepta aunque estén fijados. Si necesitas esos controles, fija
`allow_v1_bundles: false`, o usa principales de confianza con el perfil strict-v1.

El resultado incluye los `errors` y `warnings` del verificador, `resolved_tier` (el nivel de seguridad) y, para V2, `verification_mode`. `agent_id`, `human_id` y `session_nonce` solo se devuelven para un bundle verificado.

<a id="what-verified-means"></a>

### Qué significa «verificado»

Un bundle verificado es coherente internamente y está firmado por las claves que él mismo enumera: las `binding_keys` del RPR para la firma del bundle y las claves del pasaporte para los artefactos del agente. No prueba quién es el principal: cualquiera puede crear claves y un RPR que nombre cualquier `human_id`. Para eso, configura principales de confianza (siguiente sección). Un bundle verificado también puede reenviarse hasta que caduque su sesión; `require_audience_binding` de la política del operador con un `verifier_id` (el `manifest.intended_verifier` del bundle debe nombrarlo) y `require_session_expiry` / `max_session_duration_seconds` lo limitan, sin hacerlo de un solo uso.

<a id="trusted-principals-and-strict-v1"></a>

### Principales de confianza y strict-v1

```typescript
import { configureVerifier, denyListRevocationSource } from '@dcp-ai/openclaw';

configureVerifier({
  trustedPrincipals: trustSet,                     // or () => trust set, read on every call
  profile: { profile: 'strict-v1', verifier_id: 'agent-gateway' },
  revocationSource: denyListRevocationSource({ url: 'https://revocation.acme.example/.well-known/dcp-revocations.json' }),
});
```

Con `trustedPrincipals`, el resultado añade `admitted`, `principal_trust`, `profile`, `profile_compliance`, `codes`, `recorded_decision`, `trust_set_version` y `action_authorized` (siempre `false`), y nombra al agente y al principal solo para un bundle admitido (`docs/ADMISSION.md`, `spec/profiles/admission`). `verified` conserva su significado, el veredicto del verificador. Bajo el perfil, el parámetro `verifier_policy` del modelo se rechaza, incluso uno más estricto, y los parámetros que la herramienta no define (un conjunto de confianza, una audiencia, una instantánea de revocación) se ignoran. `configureVerifier` lanza `AdmissionConfigError` ante una contradicción (un perfil con `verifierPolicy`, o sin principales de confianza o sin fuente de revocación) y conserva la configuración anterior. Una función `trustedPrincipals` que lanza una excepción, o devuelve `undefined`, `null` o un conjunto de confianza inválido, da `admitted: false` con el motivo en `errors`; la herramienta no lanza. Ejecutable: `examples/strict-v1.mjs`.

Las pruebas ejecutan todos los casos de `tests/interop/v2/bundle_vectors.json`, cada uno bajo la política del operador con sus `verifier_policy_overrides`.

<a id="supervising-the-trust-source"></a>

### Supervisar la fuente de confianza

```typescript
import { configureVerifier, createSourceSupervisor } from '@dcp-ai/openclaw';

const supervisor = createSourceSupervisor({ maxInFlight: 16 });
configureVerifier({
  trustedPrincipals: ({ tenant, signal }) => loadTrustSet(tenant, { signal }),
  sourceSupervisor: supervisor,
  supervise: { trustTimeoutMs: 2000 },
});
```

**Plazo, capacidad y alcance.**

- La función recibe `{ tenant, signal }`. Un conjunto de confianza que llega después de `trustTimeoutMs` (un entero de 1 a 2147483647), medido con un reloj monotónico cuando llega, no se usa. La llamada da entonces el mismo `admitted: false` que una fuente que falla (`The trusted principals are unavailable (TRUST_SOURCE_FAILED)`).
- Se ejecutan como máximo `maxInFlight` llamadas a la vez, sin cola. **Un hueco solo se libera cuando la función se resuelve de verdad**: una fuente que nunca se resuelve conserva su hueco hasta que el proceso se reinicia.
- La capacidad es por objeto supervisor, y puede compartirse un supervisor creado por `@dcp-ai/express`, ESM o CJS.
- Un proceso de Node sin nada más pendiente sigue vivo hasta que responde el plazo.
- Con el perfil strict-v1, `supervise: { revocation: true }` ejecuta la `revocationSource` bajo el mismo supervisor, con `revocationTimeoutMs` como plazo (entonces un entero de 1 a 2147483647). `supervise` acepta `trustTimeoutMs`, `revocation: true` o ambos, y `revocation: true` funciona con un conjunto de confianza estático.
  - La fuente recibe `(subjects, { tenant, signal })`, y cada respuesta da el resultado que da sin supervisión.
  - `null`, un fallo, un tiempo agotado, la falta de hueco libre y un supervisor cerrado dan `admitted: false` con `codes: ["REVOCATION_UNAVAILABLE"]`. `REVOCATION_INVALID` solo cuenta antes del plazo.
  - Las llamadas de confianza y de revocación comparten los huecos del supervisor.
  - `denyListRevocationSource` también aborta su fetch cuando se aborta la `signal` del supervisor.
  - Sin ella, la revocación mantiene `revocationTimeoutMs` como antes.

**Reconfiguración.**

- `configureVerifier` puede mantener el mismo supervisor con un conjunto de confianza, un perfil, un plazo o una elección de fuentes nuevos: sus contadores se mantienen, y una llamada conserva el plazo con el que empezó.
- Lanza `AdmissionConfigError` (`CONFIG_PROFILE_CONTRADICTION`), conservando la configuración anterior, cuando reemplazaría o quitaría un supervisor que todavía tiene llamadas en curso, sea cual sea la fuente que supervisa. Una llamada cuenta desde el momento en que empieza `executeVerifyBundle`, así que también mientras todavía verifica el bundle y aún no ha llamado a su fuente, y su hueco cuenta hasta que su fuente se resuelve. Eso se mantiene incluso después de que `supervisor.close({ drainMs })` haya vuelto con llamadas todavía en curso: cerrar rechaza las llamadas nuevas pero no libera ningún hueco. Reemplázalo cuando `supervisor.stats().inFlight` sea 0, o reinicia el proceso.
- Los parámetros del modelo no pueden fijar nada de esto.

**Cancelación.**

- Los supervisores de esta versión ofrecen también una capacidad de cancelación, que usa `cancelOnDisconnect` de `@dcp-ai/express`.
- `dcp_verify_bundle` no tiene esa opción: su anfitrión no da ninguna señal de que quien llama se haya ido, y `configureVerifier({ cancelOnDisconnect })` lanza una excepción como opción desconocida.
- `stats().cancelled` es opcional en el tipo, por los supervisores de paquetes anteriores: léelo como `?? 0`.

**Lo que no hace.** Los mismos límites que en `@dcp-ai/express`:

- no detiene el trabajo de una función, no limita el trabajo que inicia por su cuenta y no aísla la CPU de un observador o de una fuente;
- `onSourceEvent` debe ser rápido; una llamada cada vez, y el resto se descarta y se cuenta. Una promesa o un thenable que devuelva se asimila como lo hace `Promise.resolve`, así que un thenable resuelto con una promesa pendiente lo mantiene ocupado. Las promesas que un thenable inicia y no devuelve quedan fuera de alcance.
- Los contadores se detienen en `Number.MAX_SAFE_INTEGER`.

<a id="concept-mapping-openclaw--dcp"></a>
<a id="concept-mapping-openclaw-dcp"></a>

## Correspondencia de conceptos: OpenClaw → DCP

| Concepto de OpenClaw | Equivalente en DCP |
|---|---|
| Propietario (humano) | `ResponsiblePrincipalRecord` |
| Sesión del agente | `AgentPassport` (capacidades a partir de las herramientas permitidas) |
| Llamada a herramienta | `Intent` (action_type derivado del nombre de la herramienta) |
| Lista de herramientas permitidas/denegadas | `PolicyDecision` |
| Emparejamiento por DM | `HumanConfirmation` |
| Acciones del agente | `AuditEntry` con encadenamiento por hash |

<a id="openclaw-tool--dcp-action-type-mapping"></a>
<a id="openclaw-tool-dcp-action-type-mapping"></a>

## Correspondencia de herramientas de OpenClaw → tipo de acción de DCP

| Herramienta de OpenClaw | `action_type` de DCP | `channel` de DCP |
|---|---|---|
| `browser.*` | `browse` | `web` |
| `exec`, `bash` | `execute_code` | `runtime` |
| `web.fetch`, `web.search` | `api_call` | `api` |
| `write`, `edit`, `apply_patch` | `write_file` | `filesystem` |
| `sessions_send` | `api_call` | `api` |
| `cron`, `webhook` | `api_call` | `api` |

<a id="risk-scoring"></a>

## Puntuación de riesgo

La herramienta de declaración de intención calcula una puntuación de riesgo a partir de:

- **Tipo de acción** — los pagos y la ejecución de código puntúan más alto que la navegación
- **Impacto estimado** — bajo / medio / alto
- **Clases de datos** — los datos personales, las credenciales y los datos financieros aumentan la puntuación

Decisiones de política:

- **approve** (riesgo < 500) — continuar con normalidad
- **escalate** (500 ≤ riesgo < 800) — pedir confirmación a una persona
- **block** (riesgo ≥ 800) — acción denegada, requiere una anulación explícita

La puntuación es un entero en milirriesgo, de 0 a 1000 (`risk: 650/1000` en la respuesta de la herramienta). La decisión es un consejo para el agente: nada en el plugin detiene una acción que se escaló o
se bloqueó, ni una que nunca se declaró.

`dcp_sign_bundle` toma una intención (su `intent_id`, o la más reciente) y **todas** las entradas de auditoría de la
sesión. El verificador exige que cada entrada de auditoría lleve el `intent_id` del bundle, así que una sesión que registró
acciones bajo más de una intención produce un bundle que `verifySignedBundleV2` rechaza; la herramienta no separa un bundle
por intención.

<a id="programmatic-usage"></a>

## Uso programático

Las herramientas también pueden usarse directamente, sin el sistema de plugins de OpenClaw:

```typescript
import {
  executeIdentitySetup,
  executeDeclareIntent,
  executeLogAction,
  executeGetAuditTrail,
} from '@dcp-ai/openclaw';

// Set up identity
const identity = await executeIdentitySetup({
  session_id: 'my-session',
  owner_name: 'Alice',
  jurisdiction: 'US',
});

// Declare intent
const intent = await executeDeclareIntent({
  session_id: 'my-session',
  action_type: 'api_call',
  target_channel: 'api',
  estimated_impact: 'low',
});

// Log action
await executeLogAction({
  session_id: 'my-session',
  intent_id: intent.intent_id,
  outcome: 'API call succeeded',
  evidence_tool: 'web.fetch',
});

// Get audit trail
const trail = await executeGetAuditTrail({ session_id: 'my-session' });
console.log(trail.entries);
```

<a id="dependencies"></a>

## Dependencias

- [`@dcp-ai/sdk`](../../sdks/typescript/README.md) — SDK de TypeScript de DCP (tipos, criptografía, constructor, firmante, verificador)
- [`@sinclair/typebox`](https://github.com/sinclairzx81/typebox) — constructor de tipos de JSON Schema (lo usa OpenClaw para los parámetros de las herramientas)

<a id="license"></a>

## Licencia

Apache-2.0
