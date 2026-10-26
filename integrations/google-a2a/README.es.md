<sub>[English](README.md) · [中文](README.zh-CN.md) · **Español** · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="dcp-ai--a2a-agent-to-agent-protocol-bridge"></a>
<a id="dcp-ai-a2a-agent-to-agent-protocol-bridge"></a>

# Puente DCP-AI ↔ protocolo A2A (Agent-to-Agent)

> Traducción informativa de [la versión en inglés](README.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Lleva el Agent Passport firmado de DCP dentro de la Agent Card de A2A, para que un consumidor de A2A pueda verificar
sin conexión el hash y la autofirma del pasaporte antes de delegar una tarea. El pasaporte nombra a un principal
responsable; este puente no verifica el RPR de ese principal ni establece la admisión. También asigna las tareas de A2A
a intenciones y entradas de auditoría de DCP.

<a id="installation"></a>

## Instalación

**Publicado en npm (26/10/2026).** `@dcp-ai/google-a2a` 2.1.0 es `latest` y depende de `@dcp-ai/sdk` `^2.2.0`. Las funciones descritas abajo están disponibles en npm.

`verifyAgentCardPassport` usa auxiliares de firma compuesta, no el verificador completo `verifySignedBundleV2`; no establece confianza en el principal ni admisión.

```bash
npm install @dcp-ai/google-a2a@^2.1.0
```

Consulta el [inventario de publicaciones npm](../../docs/NPM_RELEASES.md) para ver todas las versiones.

Para desarrollar con una copia del repositorio, compila e instala el paquete local:

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai/integrations/google-a2a
npm ci && npm run build
# then, in your project:
npm install /path/to/dcp-ai/integrations/google-a2a
```

<a id="the-passport-inside-the-agent-card"></a>

## El pasaporte dentro de la Agent Card

A2A permite que una Agent Card declare extensiones en `capabilities.extensions` (`AgentExtension`: `uri`,
`description`, `required`, `params`). La extensión del pasaporte de DCP, con URI
`https://dcp-ai.org/a2a/extensions/passport/v2`, lleva el `SignedPayload<AgentPassportV2>` (DCP-01) del agente en
`params.passport`: el pasaporte que el agente firmó con las claves Ed25519 + ML-DSA-65 que enumera, con su
`principal_binding_reference` al Responsible Principal Record. Nada nuevo en el formato de transmisión.

```typescript
// Fragment: signedPassport is your agent's SignedPayload<AgentPassportV2>
import { passportToAgentCard, verifyAgentCardPassport, agentCardToPassport } from '@dcp-ai/google-a2a';

// Publisher: the signed passport (as produced by the DCP SDK or @dcp-ai/openclaw) goes into the card.
const card = passportToAgentCard(signedPassport, 'https://my-agent.example.com/a2a');

// Consumer: check passport consistency; trust and endpoint possession require the steps below.
const check = await verifyAgentCardPassport(card);
if (!check.verified) throw new Error(check.errors.join('; '));
check.passport.agent_id; // the verified DCP agent
```

<a id="what-verification-proves-and-what-it-does-not"></a>

### Qué prueba la verificación y qué no

`verifyAgentCardPassport` comprueba que la extensión está presente, que el `payload_hash` coincide, que la firma
compuesta es `pq_over_classical` (Ed25519 más ML-DSA-65 o SLH-DSA-192f, cada hueco fijado a su algoritmo) y se verifica
en el contexto AgentPassport con claves que el propio pasaporte enumera (activas, no caducadas, cada `kid` el hash de su
clave pública), que las marcas de tiempo siguen un patrón RFC 3339 y se interpretan con `Date.parse` (no es una comprobación completa del calendario: algunas fechas imposibles, como el 30 de febrero, se normalizan y pasan), que el pasaporte está `active`, y que `metadata.dcp_agent_id` y
`expectedAgentId`, si se dan, nombran al mismo agente. Una tarjeta que no supera alguna de estas comprobaciones
enumeradas se rechaza; no es una validación completa del pasaporte contra el JSON Schema, así que los campos que quedan
fuera de estas comprobaciones no se validan.

Un pasaporte es público, y cualquiera puede copiarlo en su propia tarjeta. Así que un resultado `verified` por sí solo
prueba que el pasaporte es **coherente consigo mismo**: firmado por las claves que enumera. No prueba que quien sirve
la tarjeta tenga esas claves, ni que `url`, `name`, `provider` o `skills` pertenezcan al agente del pasaporte. Para
convertirlo en una comprobación de identidad:

- Pasa `trustedKeys`: las claves en las que ya confías para ese agente (de un registro, de un pasaporte anterior
  fijado, o de las `binding_keys` de un RPR cuyo principal anclas fuera del bundle, cuando el principal firma por el
  agente; una firma válida sobre un RPR no lo hace, por sí sola, de confianza) y
  `expectedAgentId`. Las dos claves firmantes deben estar entre ellas, y las propias entradas de confianza deben estar
  `active` y no caducadas (tu registro de una clave prevalece sobre la copia del pasaporte); el resultado dice entonces
  `anchored: true`. `anchored` solo indica que se pasó `trustedKeys`, incluso cuando la verificación falla: para una
  comprobación anclada, exige `verified && anchored`.
- Usa solo `result.passport`, nunca los campos sin firmar de la tarjeta, como identidad del agente.
- Antes de delegar una tarea, exige al endpoint una prueba de posesión: `generateRegistrationPoP` /
  `verifyRegistrationPoP` del SDK, o una sesión A2A de DCP-04.
  `verifyRegistrationPoP` solo comprueba la firma sobre el reto que recibe: tu propio protocolo debe emitir un nonce
  fresco e impredecible desde el verificador, imponer su caducidad y su uso único, y vincularlo al kid, al agente y al
  endpoint. No confíes en una PoP que el endpoint envíe por su cuenta o reutilice. El `AgentCard.signatures` de A2A 1.0
  (JWS sobre la tarjeta) es la forma propia del protocolo de vincular el resto de la tarjeta; este puente no lo
  implementa.

`attachPassportToAgentCard(card, signedPassport)` añade la extensión a una tarjeta que ya tienes (sustituyendo un
pasaporte de DCP anterior), `agentCardPassport(card)` la lee, y `agentCardToPassport(card)` devuelve el pasaporte que
lleva, en lugar de un esqueleto, cuando la tarjeta tiene uno.

<a id="supported-dcp-specifications"></a>

## Especificaciones de DCP admitidas

De DCP-01 a DCP-09, como correspondencias parciales (las funciones de abajo); no es una implementación completa de esas especificaciones.

<a id="overview"></a>

## Descripción general

El protocolo A2A de Google define un estándar para el descubrimiento y la comunicación entre agentes. Este puente asigna los conceptos de identidad y auditoría de DCP a primitivas de A2A:

- **Agent Passports ↔ Agent Cards** — lleva pasaportes de DCP en Agent Cards de A2A descubribles, con los límites de confianza y de prueba de posesión de arriba.
- **Tareas A2A → intenciones de DCP** — convierte las peticiones de tareas A2A entrantes en intenciones de DCP para la evaluación de la política y el registro de auditoría.
- **Envoltura de auditoría** — adjunta entradas de auditoría de DCP a las ejecuciones de tareas A2A para la trazabilidad.

<a id="functions"></a>

## Funciones

| Función | Sentido | Descripción |
|---|---|---|
| `passportToAgentCard(passport, endpoint)` | DCP → A2A | Convierte un Agent Passport (firmado o simple) en una Agent Card de A2A; uno firmado va en la extensión de DCP |
| `attachPassportToAgentCard(card, signedPassport)` | DCP → A2A | Pone un pasaporte firmado en `capabilities.extensions` de una tarjeta existente |
| `agentCardPassport(card)` | A2A → DCP | El pasaporte firmado que lleva una tarjeta, si lo hay |
| `verifyAgentCardPassport(card, options?)` | A2A → DCP | Verifica sin conexión el pasaporte que lleva |
| `agentCardToPassport(card)` | A2A → DCP | El pasaporte que lleva, o un esqueleto para una tarjeta sin él |
| `wrapA2ATaskWithAudit(task, agentId, intentId)` | A2A + DCP | Envuelve una tarea con una entrada de auditoría de DCP |
| `a2aTaskToIntent(task, agentId)` | A2A → DCP | Convierte una petición de tarea en una intención de DCP |
| `addMandateToA2AHandshake(handshake, mandate)` | DCP → A2A | Inyecta un mandato de DCP-09 en el handshake de A2A |
| `createLifecycleNotification(agentId, event, details)` | DCP → A2A | Crea una notificación de A2A para los eventos de ciclo de vida (DCP-05) |

<a id="agent-card-metadata"></a>

## Metadatos de la Agent Card

Los metadatos de DCP se incrustan en el campo `metadata` de la Agent Card:

```json
{
  "dcp_agent_id": "agent:uuid",
  "dcp_version": "2.0",
  "dcp_security_tier": "standard",
  "dcp_owner_rpr_hash": "sha256:...",
  "dcp_lifecycle_state": "active",
  "dcp_mandate_id": null
}
```

Estos campos son datos de la tarjeta sin firmar: `dcp_security_tier` siempre es `"standard"` (no se calcula), y `dcp_owner_rpr_hash` contiene el `owner_rpr_hash` del pasaporte o, para un pasaporte V2, su `principal_binding_reference` (el `human_id` del RPR, no un hash). Ayudan al descubrimiento; la identidad solo procede del pasaporte verificado (`result.passport`).

<a id="usage"></a>

## Uso

```javascript
// Fragment: myPassport and incomingTask come from your application
import { passportToAgentCard, a2aTaskToIntent } from '@dcp-ai/google-a2a';

// Publish a DCP agent as an A2A Agent Card
const card = passportToAgentCard(myPassport, 'https://my-agent.example.com/a2a');

// Convert an incoming A2A task to a DCP Intent
const intent = a2aTaskToIntent(incomingTask, 'agent:my-agent-id');
```

<a id="notes"></a>

## Notas

- El `authentication.schemes` de la Agent Card se fija en `['dcp-bundle']` para señalar que este agente usa la autenticación basada en bundles de DCP.
- Las skills del pasaporte se derivan de las capacidades de DCP, con los guiones bajos sustituidos por espacios para obtener nombres legibles.
- Las conversiones a esqueleto (A2A → DCP) de una tarjeta sin la extensión de DCP producen registros parciales que necesitan generación de claves y firma antes de usarse.
- Los campos de la tarjeta que escribe este puente (`authentication`, `metadata`, …) son anteriores a A2A 1.0, cuya tarjeta usa `supportedInterfaces` y `securitySchemes`; `capabilities.extensions` es válido en ambos. Alinear el resto de la tarjeta con A2A 1.0 es un cambio aparte.
