<sub>[English](README.md) · [中文](README.zh-CN.md) · **Español** · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="dcp-ai--model-context-protocol-mcp-bridge"></a>
<a id="dcp-ai-model-context-protocol-mcp-bridge"></a>

# DCP-AI ↔ puente con Model Context Protocol (MCP)

> Traducción informativa de [la versión en inglés](README.md), actualizada el 26/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Recibos firmados de DCP para las llamadas a herramientas de MCP, además de herramientas y recursos de DCP para servidores MCP.

<a id="installation"></a>

## Instalación

**Publicado en npm (26/10/2026).** `@dcp-ai/anthropic-mcp` 2.1.0 es `latest` y depende de `@dcp-ai/sdk` `^2.2.0`. Las funciones descritas abajo están disponibles en npm.

Incluye recibos firmados (`withDcpReceipt`, `createReceiptIdentity`, `verifyDcpReceipt`). Los ejemplos también necesitan `@modelcontextprotocol/sdk` y `zod`; instálalos por separado.

```bash
npm install @dcp-ai/anthropic-mcp@^2.1.0
```

Consulta el [inventario de publicaciones npm](../../docs/NPM_RELEASES.md) para ver todas las versiones.

Para desarrollar con una copia del repositorio, compila e instala el paquete local:

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai/integrations/anthropic-mcp
npm ci && npm run build
# then, in your project:
npm install /path/to/dcp-ai/integrations/anthropic-mcp
```

<a id="signed-receipts-per-tool-call"></a>

## Recibos firmados por llamada a herramienta

`withDcpReceipt` envuelve cualquier manejador de herramienta de MCP para que cada llamada vuelva con un recibo: una
declaración firmada, hecha con las claves del servidor, de qué herramienta se llamó, bajo qué intención y
decisión de política, y de los hashes de lo que entró y salió. Muestra que quien tiene esas claves
declaró esto; no prueba por sí solo quién las tiene (véase [Qué prueba la verificación](#what-verification-proves-and-what-it-does-not))
ni que la herramienta hiciera lo que dice su resultado. Un recibo es un **bundle firmado de DCP v2.0** corriente: el Responsible Principal Record (DCP-01) y el Agent
Passport del agente, una Intent (DCP-02) con firma compuesta Ed25519 + ML-DSA-65 *antes* de que se ejecute la herramienta, la
Policy Decision y una entrada de auditoría (DCP-03) con el SHA-256 de los argumentos y del resultado.
Nada nuevo en el cable: cualquier verificador de DCP lo comprueba sin conexión.

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { withDcpReceipt, createReceiptIdentity, verifyDcpReceipt } from '@dcp-ai/anthropic-mcp';

// One identity per session: new keys and session nonce, signed RPR and passport.
// Production deployments pass their own signed RPR and passport instead.
const identity = await createReceiptIdentity({ legalName: 'Example Operator', jurisdiction: 'CL' });

const server = new McpServer({ name: 'weather', version: '1.0.0' });
server.registerTool(
  'get_weather',
  { description: 'Weather for a city', inputSchema: { city: z.string() } },
  withDcpReceipt('get_weather', async ({ city }) => ({ content: [{ type: 'text', text: `Sunny in ${city}` }] }), { identity }),
);
```

Ahora cada resultado lleva `_meta.dcp_receipt`. Quien llama, o cualquiera más tarde, lo verifica y comprueba
que es el recibo de *esta* llamada:

```typescript
// Fragment: `client` is an MCP client connected to the server above
const result = await client.callTool({ name: 'get_weather', arguments: { city: 'Santiago' } });
const { _meta, ...seen } = result;
const check = await verifyDcpReceipt(_meta.dcp_receipt, { tool: 'get_weather', arguments: { city: 'Santiago' }, result: seen });
check.verified; // false if the bundle, the tool name or the hash of { arguments, result } does not match
```

Qué ocurre en cada llamada:

| Decisión de política | Se ejecuta la herramienta | Se devuelve | Entrada de auditoría |
|---|---|---|---|
| `approve` | sí | el resultado del manejador + `_meta.dcp_receipt` | `outcome: "completed"`, `result_ref` = hash del resultado |
| `escalate` | no | `{ content, isError: true, _meta }` | `outcome: "escalated"`, `policy_decision: "escalated"`, `result_ref: null` |
| `block` | no | `{ content, isError: true, _meta }` | `outcome: "blocked"`, `policy_decision: "blocked"`, `result_ref: null` |
| el manejador lanza una excepción | sí | `{ content, isError: true, _meta }` | `outcome: "failed"`, `result_ref` = hash de ese resultado de error |

Un rechazo también es evidencia: el recibo de una llamada bloqueada muestra la intención que declaró el agente y
la decisión que la detuvo.

<a id="classification-and-policy"></a>

### Clasificación y política

Por defecto, cada llamada es una `api_call` de bajo impacto en el canal `api` con `data_classes: ["none"]`,
que la política predeterminada aprueba (riesgo 200). Indica al envoltorio lo que hace de verdad una herramienta, y
decide tú cuando los valores predeterminados no encajan:

```typescript
// Fragment: payInvoice is your tool handler, identity as above
withDcpReceipt('pay_invoice', payInvoice, {
  identity,
  classify: (tool, args) => ({
    action_type: 'initiate_payment',
    channel: 'payments',
    estimated_impact: 'high',
    data_classes: ['financial_data'],
  }),
  // Default policy: risk = impact (low 200 / medium 500 / high 900) + 150 per sensitive data class, capped at 1000;
  // approve < 500, escalate < 800, block >= 800. Replace it with your own:
  decide: (intent) => ({ decision: 'escalate', risk_score: 900, reasons: ['payments need a human'] }),
  appliedPolicyHash: 'sha256:…', // hash of the policy you applied (default: hash of the default rules)
});
```

El `'sha256:…'` de arriba es un marcador de posición: pasa el `sha256:` real y los 64 caracteres hexadecimales de tu política, u omite
`appliedPolicyHash`.

El `security_tier` de la intención (y el `resolved_tier` de la decisión) es el nivel que el SDK da a la intención
(DCP-AI v2.0 §14.2), nunca por debajo de lo que implica la puntuación de riesgo (200 standard, 500 elevated, 800
maximum), así que la llamada predeterminada es `standard`. `appliedPolicyHash` debe ser `sha256:<64 hex>` y
`createReceiptIdentity` solo acepta las capacidades del esquema del pasaporte (`browse`, `api_call`,
`email`, `calendar`, `payments`, `crm`, `file_write`, `code_exec`); ambos se rechazan de entrada
porque el verificador de referencia valida los esquemas.

<a id="evidence-hashes"></a>

### Hashes de evidencia

`evidence.evidence_hash` es `sha256:` sobre el texto JSON de `{ arguments, result }` con las claves ordenadas
a todos los niveles (`stableJson`), y `evidence.result_ref` lo mismo sobre el resultado solo, cuando la herramienta
se ejecutó. `arguments` son los argumentos tal como se recibieron, copiados antes de que se ejecute el manejador, así que un manejador que
reescribe su entrada no puede cambiar lo que atestigua el recibo. `result` es exactamente lo que devuelve el envoltorio
menos `_meta` (`resultSeen(result)`): el recibo viaja en `_meta`, y el `_meta` propio de un manejador
son metadatos de transporte, no evidencia. A un manejador que devuelve un valor desnudo se le envuelve como
`{ content: [{ type: "text", text }] }`, y ese envoltorio es lo que se resume con hash. Los argumentos se
toman como instantánea JSON, así que un `Date` se resume como su cadena ISO, las funciones se descartan y un
`AbortSignal` (como en el `extra` del SDK de MCP) se convierte en `{}`. Cuando el `extra` de MCP lleva un `requestId`, se registra
como `evidence.request_id`, y `verifyDcpReceipt(receipt, { requestId })` lo comprueba.

A diferencia del perfil de canonicalización, `stableJson` conserva cualquier número JSON, así que los argumentos y resultados
con decimales se resumen sin problema. Ordena las claves con `sort()` de JavaScript; un objeto cuyas claves son cadenas
enteras (`{ "10": 1, "9": 2 }`) se ordena como lo ordena V8, así que recalcula el hash en JavaScript
o evita esas claves cuando otro lenguaje deba comprobarlo.

<a id="what-verification-proves-and-what-it-does-not"></a>

### Qué prueba la verificación y qué no

Un recibo se verifica con las claves que enumeran su propio pasaporte y su RPR, como todo bundle de DCP: un resultado `verified`
por sí solo prueba que el recibo es coherente y no ha sido alterado, no a quién pertenecen esas claves. Para
convertirlo en una comprobación de identidad, pasa `trustedKeys` (las claves en las que ya confías para el agente y su
principal, de un registro o de un pasaporte y un RPR fijados) junto con `expectedAgentId` y
`expectedHumanId`: cada firma que el SDK verifica en el recibo debe hacerse entonces con una de
esas claves, resuelta exactamente como la resuelve el SDK (la primera clave listada con el `kid` de la firma,
en la lista de claves de ese artefacto), activa y no caducada en tu lista; el resultado dice 
`anchored: true` solo cuando eso se cumplió. `anchored` se calcula aparte de la verificación del bundle, así que puede ser
`true` mientras `verified` es `false`: acepta un recibo solo cuando ambos son `true`. Un verificador que confía en un registro de pasaportes puede anclar cada recibo
que produce un agente sin volver a leer el pasaporte.

Límites que conviene conocer:

- Un recibo queda vinculado a una llamada por su `intent_id` y su `audit_id`, y a la petición MCP por
  `request_id` cuando el servidor lo proporciona. Las ventanas de sesión y los modos son los que comprueba el verificador del SDK
  bajo la `policy` que pases (si no, `DEFAULT_VERIFIER_POLICY`); `verifyDcpReceipt` no añade
  ninguna ventana de tiempo ni deduplicación propias, así que un verificador que deba detectar un recibo reenviado mantiene
  su propio conjunto de ids vistos.
- Cada recibo es autónomo (una entrada de auditoría, `prev_hash: "GENESIS"`); agrupar los recibos de una
  sesión en un solo bundle está en la hoja de ruta.
- `createReceiptIdentity` firma el RPR y el pasaporte con el mismo par de claves (el principal y
  el agente son uno), lo que solo es adecuado para pruebas y primeras ejecuciones.

<a id="dcp-tools-and-resources"></a>

## Herramientas y recursos de DCP

El puente también expone operaciones de DCP como herramientas y recursos de MCP, para que un modelo compatible con MCP pueda:

- **Verificar bundles de DCP** — ejecutar el verificador V2 del SDK (`verifySignedBundleV2`) sobre un bundle firmado o un recibo.
- **Crear identidades de DCP** — aprovisionar nuevos Responsible Principal Records y Agent Passports.
- **Declarar intenciones** — enviar intenciones para su evaluación de política con cálculo automático del nivel de riesgo.
- **Comprobar el estado de un agente** — un marcador de posición: `dcp_check_agent` devuelve `status: "check_pending"` y no obtiene ni verifica nada.
- **Gestión del ciclo de vida (DCP-05)** — poner en servicio, informar de la vitalidad y dar de baja a agentes.
- **Sucesión (DCP-06)** — crear testamentos digitales con preferencias de sucesor.
- **Disputas (DCP-07)** — presentar disputas entre agentes con hashes de evidencia.
- **Derechos (DCP-08)** — declarar los derechos del agente en una jurisdicción.
- **Delegación (DCP-09)** — crear mandatos de delegación de humano a agente.

<a id="supported-dcp-specifications"></a>

## Especificaciones de DCP admitidas

De DCP-01 a DCP-09, de forma parcial: recibos firmados y verificación de bundles, y borradores con las formas de las demás
especificaciones. No las implementa por completo.

<a id="mcp-tools"></a>

## Herramientas de MCP

| Herramienta | Descripción |
|---|---|
| `dcp_verify_bundle` | Verifica un bundle firmado de DCP v2.0 o un recibo con el verificador V2 del SDK |
| `dcp_create_identity` | Crea una nueva identidad digital de DCP (RPR + pasaporte) |
| `dcp_declare_intent` | Declara una intención para su evaluación de política |
| `dcp_check_agent` | Marcador de posición: devuelve `check_pending` sin obtener ni verificar nada |
| `dcp_commission_agent` | Pone en servicio a un agente (DCP-05) |
| `dcp_report_vitality` | Informa de métricas de vitalidad del agente (DCP-05) |
| `dcp_decommission_agent` | Da de baja a un agente (DCP-05) |
| `dcp_create_testament` | Crea un testamento digital (DCP-06) |
| `dcp_file_dispute` | Presenta una disputa entre agentes (DCP-07) |
| `dcp_declare_rights` | Declara los derechos del agente (DCP-08) |
| `dcp_create_mandate` | Crea un mandato de delegación (DCP-09) |

<a id="mcp-resources"></a>

## Recursos de MCP

| URI | Descripción |
|---|---|
| `dcp://protocol/version` | Versión actual del protocolo DCP y sus capacidades |
| `dcp://protocol/algorithms` | Algoritmos criptográficos admitidos |
| `dcp://protocol/tiers` | Definiciones y requisitos de los niveles de seguridad |
| `dcp://protocol/lifecycle-states` | Definiciones de los estados del ciclo de vida del agente (DCP-05) |

<a id="usage"></a>

## Uso

<a id="registering-with-an-mcp-server"></a>

### Registro en un servidor MCP

`DCP_MCP_TOOLS` son descriptores de herramientas (`name`, `description`, `inputSchema` como JSON Schema) y `DCP_MCP_RESOURCES` descriptores de recursos (`uri`, `name`, `description`, `mimeType`); el paquete no proporciona el contenido de los recursos. Un esbozo con el `Server` de bajo nivel del SDK de TypeScript de MCP, que acepta descriptores de herramientas en JSON Schema tal cual (no se ejecuta aquí: necesita el SDK de MCP):

```javascript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { DCP_MCP_TOOLS, DCP_MCP_RESOURCES, handleDcpToolCall } from '@dcp-ai/anthropic-mcp';

const server = new Server({ name: 'dcp', version: '1.0.0' }, { capabilities: { tools: {}, resources: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: DCP_MCP_TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const result = await handleDcpToolCall(request.params.name, request.params.arguments ?? {});
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});
server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: DCP_MCP_RESOURCES }));
// Serving a resource's contents (resources/read) is up to your server.
```

<a id="tool-call-examples"></a>

### Ejemplos de llamadas a herramientas

```javascript
import { handleDcpToolCall } from '@dcp-ai/anthropic-mcp';

// Fragment: myBundle is a signed bundle or receipt you hold
// Verify a bundle or a receipt
const result = await handleDcpToolCall('dcp_verify_bundle', {
  bundle_json: JSON.stringify(myBundle),
}); // { verified, errors, warnings, details, timestamp }

// Declare an intent
const intent = await handleDcpToolCall('dcp_declare_intent', {
  agent_id: 'agent:my-agent',
  action_type: 'api_call',
  description: 'Fetch weather data from external API',
  risk_score: 150,
});
```

<a id="notes"></a>

## Notas

- `dcp_verify_bundle` ejecuta `verifySignedBundleV2` de `@dcp-ai/sdk` bajo `DEFAULT_VERIFIER_POLICY` (hashes, manifiesto, firma compuesta, vinculación de sesión, la cadena de auditoría SHA-256). No valida los JSON Schemas (lo hace el verificador de referencia `lib/verify.js`) ni recalcula la cadena secundaria SHA3-256 de V2-11, y un resultado `verified` no es admisión ni autorización.
- Aparte de `dcp_verify_bundle` y los recibos, los manejadores de herramientas devuelven borradores: identificadores y campos para firmar, nunca claves ni firmas (`next_step` dice lo que falta).
- `dcp_create_identity` devuelve solo identificadores — la generación de claves y la firma son pasos aparte.
- El nivel de riesgo se calcula automáticamente a partir de la puntuación de riesgo: routine (<200), standard (200-499), elevated (500-799), maximum (800+).
