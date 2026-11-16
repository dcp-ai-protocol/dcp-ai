<sub>[English](../../../../integrations/autogen/README.md) · [中文](../../../zh-CN/integrations/autogen/README.md) · **Español** · [日本語](../../../ja/integrations/autogen/README.md) · [Português](../../../pt-BR/integrations/autogen/README.md)</sub>

<a id="dcp-ai--microsoft-autogen-bridge"></a>
<a id="dcp-ai-microsoft-autogen-bridge"></a>

# Puente DCP-AI ↔ Microsoft AutoGen

> Traducción informativa de [la versión en inglés](../../../../integrations/autogen/README.md), actualizada el 26/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Construye registros con forma de DCP para conversaciones de Microsoft AutoGen: configuraciones de agentes con una identidad DCP, entradas de auditoría para los mensajes, intenciones para las llamadas a funciones y mandatos de delegación.

Los registros son objetos simples: **sin firmar, y sin hashes de contenido ni cadena de hash**. El puente no hace criptografía y no importa AutoGen. Son borradores que hay que adaptar a los esquemas de DCP: por ejemplo, una intención tiene `action_type: "function_call"`, que no está en el enum del esquema, y no tiene `session_nonce`, `human_id`, `estimated_impact` ni `requires_consent`. Firmarlos y encadenarlos con un SDK de DCP (por ejemplo, `BundleBuilderV2` y `signBundleV2` del SDK de TypeScript) no los convierte por sí solo en un bundle normativo: adáptalos antes a los esquemas.

<a id="installation"></a>

## Instalación

```bash
npm install @dcp-ai/autogen
```

La 2.0.1 de npm (26/10/2026) tiene el mismo `index.js` que el código fuente de `main`. No tiene dependencias.

<a id="supported-dcp-specifications"></a>

## Especificaciones de DCP admitidas

De DCP-01 a DCP-09, como correspondencias parciales: los registros siguen formas de estas especificaciones, pero el puente no las implementa por completo.

<a id="overview"></a>

## Descripción general

Este puente integra DCP-AI con el framework AutoGen de Microsoft para la orquestación multiagente. Proporciona:

- **Configuraciones de agentes con DCP** — amplían las definiciones de agentes de AutoGen con identidad, capacidades y niveles de seguridad de DCP.
- **Auditoría de mensajes** — construye una entrada de auditoría con forma de DCP para un mensaje que le pases.
- **Sesiones de GroupChat** — copia los agentes de un chat en grupo con un nonce de sesión de DCP compartido, para rastros de auditoría correlacionados.
- **Intenciones de llamadas a funciones** — convierte las llamadas a funciones de AutoGen en borradores de intención; la evaluación de la política y el control antes de la ejecución te corresponden.

<a id="functions"></a>

## Funciones

| Función | Descripción |
|---|---|
| `createDcpAutoGenAgent(config)` | Crea una configuración de agente de AutoGen con DCP |
| `auditAutoGenMessage(message, sender, recipient)` | Genera una entrada de auditoría de DCP para un mensaje |
| `createDcpGroupChat(agents, config)` | Crea un GroupChat de DCP con un nonce de sesión compartido |
| `autoGenFunctionToIntent(functionCall, agentConfig)` | Convierte una llamada a función en una intención de DCP |
| `delegateGroupChatRole(groupChat, agentConfig, authorityScope)` | Delega un ámbito de autoridad a un agente de un GroupChat (DCP-09) |

<a id="usage"></a>

## Uso

```javascript
import {
  createDcpAutoGenAgent,
  auditAutoGenMessage,
  createDcpGroupChat,
  autoGenFunctionToIntent,
} from '@dcp-ai/autogen';

// Create DCP-aware agents
const coder = createDcpAutoGenAgent({
  name: 'Coder',
  system_message: 'You write code.',
  capabilities: ['code_generation', 'code_review'],
  security_tier: 'standard',
});

const reviewer = createDcpAutoGenAgent({
  name: 'Reviewer',
  system_message: 'You review code.',
  capabilities: ['code_review'],
  security_tier: 'elevated',
});

// Set up a group chat with shared session nonce
const chat = createDcpGroupChat([coder, reviewer], {
  security_tier: 'elevated',
  max_rounds: 20,
});

// Audit a message exchange
const auditEntry = auditAutoGenMessage(
  { role: 'assistant', content: 'Here is the code...' },
  coder,
  reviewer,
);

// Create an intent before executing a function
const intent = autoGenFunctionToIntent(
  { name: 'execute_code', arguments: { code: 'print("hello")' } },
  coder,
);
```

En este ejemplo, `auditAutoGenMessage` recibe los `coder` y `reviewer` originales, que no llevan el nonce de sesión del
chat en grupo: `createDcpGroupChat` devuelve copias de los agentes, con el nonce, en `chat.agents`. La función solo
devuelve una entrada; no añade el nonce ni guarda la entrada en ningún sitio.

<a id="security-tier-resolution"></a>

## Resolución del nivel de seguridad

Cuando se comunican dos agentes con niveles de seguridad distintos, la entrada de auditoría usa el **más alto** de los dos. Un nivel desconocido cuenta como `standard`.

<a id="notes"></a>

## Notas

- El campo `content_hash` de las entradas de auditoría vale `null` por defecto; intégralo con la capa criptográfica de DCP para calcular hashes SHA-256 del contenido de los mensajes.
- Los nonces de sesión son cadenas hexadecimales aleatorias de 256 bits compartidas por todos los agentes de un GroupChat.
- Las configuraciones son objetos simples que lee tu propio código de AutoGen (o de Semantic Kernel); el puente no depende de ninguno de los dos.
