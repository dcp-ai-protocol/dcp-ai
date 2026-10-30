<sub>[English](../../../../integrations/autogen/README.md) · [中文](../../../zh-CN/integrations/autogen/README.md) · [Español](../../../es/integrations/autogen/README.md) · [日本語](../../../ja/integrations/autogen/README.md) · **Português**</sub>

<a id="dcp-ai--microsoft-autogen-bridge"></a>
<a id="dcp-ai-microsoft-autogen-bridge"></a>

# Ponte DCP-AI ↔ Microsoft AutoGen

> Tradução informativa da [versão em inglês](../../../../integrations/autogen/README.md), atualizada em 26/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Constrói registros no formato do DCP para conversas do Microsoft AutoGen: configurações de agentes com uma identidade DCP, entradas de auditoria para as mensagens, intenções para as chamadas de funções e mandatos de delegação.

Os registros são objetos simples: **não assinados, e sem hashes de conteúdo nem cadeia de hash**. A ponte não faz criptografia e não importa o AutoGen. São rascunhos que precisam ser adaptados aos schemas do DCP: por exemplo, uma intenção tem `action_type: "function_call"`, que não está no enum do schema, e não tem `session_nonce`, `human_id`, `estimated_impact` nem `requires_consent`. Assiná-los e encadeá-los com um SDK do DCP (por exemplo, `BundleBuilderV2` e `signBundleV2` do SDK TypeScript) não os transforma, por si só, em um bundle normativo: adapte-os antes aos schemas.

<a id="installation"></a>

## Instalação

```bash
npm install @dcp-ai/autogen
```

A 2.0.1 do npm (26/10/2026) tem o mesmo `index.js` que o código-fonte em `main`. Não tem dependências.

<a id="supported-dcp-specifications"></a>

## Especificações do DCP suportadas

Do DCP-01 ao DCP-09, como correspondências parciais: os registros seguem formatos dessas especificações, mas a ponte não as implementa por completo.

<a id="overview"></a>

## Visão geral

Esta ponte integra o DCP-AI ao framework AutoGen da Microsoft para orquestração multiagente. Ela oferece:

- **Configurações de agentes com DCP** — estendem as definições de agentes do AutoGen com identidade, capacidades e níveis de segurança do DCP.
- **Auditoria de mensagens** — constrói uma entrada de auditoria no formato do DCP para uma mensagem que você lhe passar.
- **Sessões de GroupChat** — copia os agentes de um chat em grupo com um nonce de sessão do DCP compartilhado, para trilhas de auditoria correlacionadas.
- **Intenções de chamadas de funções** — converte as chamadas de funções do AutoGen em rascunhos de intenção; a avaliação da política e o controle antes da execução cabem a você.

<a id="functions"></a>

## Funções

| Função | Descrição |
|---|---|
| `createDcpAutoGenAgent(config)` | Cria uma configuração de agente do AutoGen com DCP |
| `auditAutoGenMessage(message, sender, recipient)` | Gera uma entrada de auditoria do DCP para uma mensagem |
| `createDcpGroupChat(agents, config)` | Cria um GroupChat do DCP com um nonce de sessão compartilhado |
| `autoGenFunctionToIntent(functionCall, agentConfig)` | Converte uma chamada de função em uma intenção do DCP |
| `delegateGroupChatRole(groupChat, agentConfig, authorityScope)` | Delega um escopo de autoridade a um agente de um GroupChat (DCP-09) |

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

Neste exemplo, `auditAutoGenMessage` recebe os `coder` e `reviewer` originais, que não trazem o nonce de sessão do chat
em grupo: `createDcpGroupChat` retorna cópias dos agentes, com o nonce, em `chat.agents`. A função só retorna uma
entrada; ela não acrescenta o nonce nem guarda a entrada em lugar nenhum.

<a id="security-tier-resolution"></a>

## Resolução do nível de segurança

Quando dois agentes com níveis de segurança diferentes se comunicam, a entrada de auditoria usa o **mais alto** dos dois. Um nível desconhecido conta como `standard`.

<a id="notes"></a>

## Notas

- O campo `content_hash` das entradas de auditoria vale `null` por padrão; integre-o com a camada criptográfica do DCP para calcular hashes SHA-256 do conteúdo das mensagens.
- Os nonces de sessão são strings hexadecimais aleatórias de 256 bits compartilhadas por todos os agentes de um GroupChat.
- As configurações são objetos simples que o seu próprio código do AutoGen (ou do Semantic Kernel) lê; a ponte não depende de nenhum dos dois.
