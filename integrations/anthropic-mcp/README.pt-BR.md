<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

<a id="dcp-ai--model-context-protocol-mcp-bridge"></a>
<a id="dcp-ai-model-context-protocol-mcp-bridge"></a>

# DCP-AI ↔ ponte com o Model Context Protocol (MCP)

> Tradução informativa da [versão em inglês](README.md), atualizada em 26/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Recibos assinados do DCP para as chamadas de ferramentas do MCP, além de ferramentas e recursos do DCP para servidores MCP.

<a id="installation"></a>

## Instalação

**Publicado no npm (26/10/2026).** `@dcp-ai/anthropic-mcp` 2.1.0 é `latest` e depende de `@dcp-ai/sdk` `^2.2.0`. As funcionalidades descritas abaixo estão disponíveis no npm.

Inclui recibos assinados (`withDcpReceipt`, `createReceiptIdentity`, `verifyDcpReceipt`). Os exemplos também precisam de `@modelcontextprotocol/sdk` e `zod`; instale-os separadamente.

```bash
npm install @dcp-ai/anthropic-mcp@^2.1.0
```

Veja o [inventário de publicações npm](../../docs/NPM_RELEASES.md) para todas as versões.

Para desenvolver a partir de uma cópia do repositório, compile e instale o pacote local:

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai/integrations/anthropic-mcp
npm ci && npm run build
# then, in your project:
npm install /path/to/dcp-ai/integrations/anthropic-mcp
```

<a id="signed-receipts-per-tool-call"></a>

## Recibos assinados por chamada de ferramenta

`withDcpReceipt` envolve qualquer manipulador de ferramenta do MCP para que cada chamada volte com um recibo: uma
declaração assinada, feita com as chaves do servidor, de qual ferramenta foi chamada, sob qual intenção e
decisão de política, e dos hashes do que entrou e saiu. Mostra que quem detém essas chaves
declarou isso; não prova por si só quem as detém (veja [O que a verificação prova](#what-verification-proves-and-what-it-does-not))
nem que a ferramenta fez o que o seu resultado diz. Um recibo é um **bundle assinado do DCP v2.0** comum: o Responsible Principal Record (DCP-01) e o Agent
Passport do agente, uma Intent (DCP-02) com assinatura composta Ed25519 + ML-DSA-65 *antes* de a ferramenta ser executada, a
Policy Decision e uma entrada de auditoria (DCP-03) com o SHA-256 dos argumentos e do resultado.
Nada de novo no fio: qualquer verificador do DCP o confere offline.

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

Agora cada resultado traz `_meta.dcp_receipt`. Quem chama, ou qualquer pessoa depois, o verifica e confere
que é o recibo *desta* chamada:

```typescript
// Fragment: `client` is an MCP client connected to the server above
const result = await client.callTool({ name: 'get_weather', arguments: { city: 'Santiago' } });
const { _meta, ...seen } = result;
const check = await verifyDcpReceipt(_meta.dcp_receipt, { tool: 'get_weather', arguments: { city: 'Santiago' }, result: seen });
check.verified; // false if the bundle, the tool name or the hash of { arguments, result } does not match
```

O que acontece em cada chamada:

| Decisão de política | A ferramenta é executada | Devolvido | Entrada de auditoria |
|---|---|---|---|
| `approve` | sim | o resultado do manipulador + `_meta.dcp_receipt` | `outcome: "completed"`, `result_ref` = hash do resultado |
| `escalate` | não | `{ content, isError: true, _meta }` | `outcome: "escalated"`, `policy_decision: "escalated"`, `result_ref: null` |
| `block` | não | `{ content, isError: true, _meta }` | `outcome: "blocked"`, `policy_decision: "blocked"`, `result_ref: null` |
| o manipulador lança uma exceção | sim | `{ content, isError: true, _meta }` | `outcome: "failed"`, `result_ref` = hash desse resultado de erro |

Uma recusa também é evidência: o recibo de uma chamada bloqueada mostra a intenção que o agente declarou e
a decisão que a interrompeu.

<a id="classification-and-policy"></a>

### Classificação e política

Por padrão, cada chamada é uma `api_call` de baixo impacto no canal `api` com `data_classes: ["none"]`,
que a política padrão aprova (risco 200). Diga ao wrapper o que uma ferramenta realmente faz, e
decida você quando os padrões não servirem:

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

O `'sha256:…'` acima é um marcador de posição: passe o `sha256:` real e os 64 caracteres hexadecimais da sua política, ou omita
`appliedPolicyHash`.

O `security_tier` da intenção (e o `resolved_tier` da decisão) é o nível que o SDK dá à intenção
(DCP-AI v2.0 §14.2), nunca abaixo do que a pontuação de risco implica (200 standard, 500 elevated, 800
maximum), então a chamada padrão é `standard`. `appliedPolicyHash` deve ser `sha256:<64 hex>` e
`createReceiptIdentity` só aceita as capacidades do schema do passaporte (`browse`, `api_call`,
`email`, `calendar`, `payments`, `crm`, `file_write`, `code_exec`); ambos são recusados de antemão
porque o verificador de referência valida os schemas.

<a id="evidence-hashes"></a>

### Hashes de evidência

`evidence.evidence_hash` é `sha256:` sobre o texto JSON de `{ arguments, result }` com as chaves ordenadas
em todos os níveis (`stableJson`), e `evidence.result_ref` o mesmo sobre o resultado sozinho, quando a ferramenta
foi executada. `arguments` são os argumentos como foram recebidos, copiados antes de o manipulador ser executado, então um manipulador que
reescreve a sua entrada não pode mudar o que o recibo atesta. `result` é exatamente o que o wrapper devolve
menos `_meta` (`resultSeen(result)`): o recibo viaja em `_meta`, e o `_meta` próprio de um manipulador
é metadado de transporte, não evidência. Um manipulador que devolve um valor simples o tem envolvido como
`{ content: [{ type: "text", text }] }`, e esse envoltório é o que é resumido por hash. Os argumentos são
capturados como snapshot JSON, então um `Date` é resumido como a sua string ISO, as funções são descartadas e um
`AbortSignal` (como no `extra` do SDK do MCP) se torna `{}`. Quando o `extra` do MCP traz um `requestId`, ele é registrado
como `evidence.request_id`, e `verifyDcpReceipt(receipt, { requestId })` o confere.

Ao contrário do perfil de canonicalização, `stableJson` mantém qualquer número JSON, então argumentos e resultados
com decimais são resumidos sem problema. Ele ordena as chaves com o `sort()` do JavaScript; um objeto cujas chaves são strings
de inteiros (`{ "10": 1, "9": 2 }`) é ordenado como o V8 o ordena, então recalcule o hash em JavaScript
ou evite essas chaves quando outra linguagem precisar conferi-lo.

<a id="what-verification-proves-and-what-it-does-not"></a>

### O que a verificação prova e o que não prova

Um recibo é verificado com as chaves que o seu próprio passaporte e o seu RPR listam, como todo bundle do DCP: um resultado `verified`
por si só prova que o recibo é coerente e não foi adulterado, não a quem pertencem essas chaves. Para
torná-lo uma verificação de identidade, passe `trustedKeys` (as chaves em que você já confia para o agente e o seu
principal, de um registro ou de um passaporte e um RPR fixados) junto com `expectedAgentId` e
`expectedHumanId`: cada assinatura que o SDK verifica no recibo deve então ser feita com uma
dessas chaves, resolvida exatamente como o SDK a resolve (a primeira chave listada com o `kid` da assinatura,
na lista de chaves desse artefato), ativa e não expirada na sua lista; o resultado diz 
`anchored: true` só quando isso valeu. `anchored` é calculado à parte da verificação do bundle, então pode ser
`true` enquanto `verified` é `false`: aceite um recibo só quando ambos forem `true`. Um verificador que confia em um registro de passaportes pode ancorar cada recibo
que um agente produz sem reler o passaporte.

Limites que convém conhecer:

- Um recibo fica vinculado a uma chamada pelo seu `intent_id` e pelo seu `audit_id`, e à requisição MCP por
  `request_id` quando o servidor o fornece. As janelas de sessão e os modos são os que o verificador do SDK
  confere sob a `policy` que você passar (senão, `DEFAULT_VERIFIER_POLICY`); `verifyDcpReceipt` não acrescenta
  nenhuma janela de tempo nem deduplicação próprias, então um verificador que precise detectar um recibo reenviado mantém
  o seu próprio conjunto de ids vistos.
- Cada recibo é autônomo (uma entrada de auditoria, `prev_hash: "GENESIS"`); agrupar os recibos de uma
  sessão em um único bundle está no roadmap.
- `createReceiptIdentity` assina o RPR e o passaporte com o mesmo par de chaves (o principal e
  o agente são um só), o que só é adequado para testes e primeiras execuções.

<a id="dcp-tools-and-resources"></a>

## Ferramentas e recursos do DCP

A ponte também expõe operações do DCP como ferramentas e recursos do MCP, para que um modelo compatível com o MCP possa:

- **Verificar bundles do DCP** — executar o verificador V2 do SDK (`verifySignedBundleV2`) sobre um bundle assinado ou um recibo.
- **Criar identidades do DCP** — provisionar novos Responsible Principal Records e Agent Passports.
- **Declarar intenções** — enviar intenções para avaliação de política com cálculo automático do nível de risco.
- **Verificar o estado de um agente** — um marcador de posição: `dcp_check_agent` devolve `status: "check_pending"` e não obtém nem verifica nada.
- **Gestão do ciclo de vida (DCP-05)** — colocar em serviço, informar a vitalidade e desativar agentes.
- **Sucessão (DCP-06)** — criar testamentos digitais com preferências de sucessor.
- **Disputas (DCP-07)** — abrir disputas entre agentes com hashes de evidência.
- **Direitos (DCP-08)** — declarar os direitos do agente em uma jurisdição.
- **Delegação (DCP-09)** — criar mandatos de delegação de humano para agente.

<a id="supported-dcp-specifications"></a>

## Especificações do DCP suportadas

Do DCP-01 ao DCP-09, de forma parcial: recibos assinados e verificação de bundles, e rascunhos nos formatos das demais
especificações. Não as implementa por completo.

<a id="mcp-tools"></a>

## Ferramentas do MCP

| Ferramenta | Descrição |
|---|---|
| `dcp_verify_bundle` | Verifica um bundle assinado do DCP v2.0 ou um recibo com o verificador V2 do SDK |
| `dcp_create_identity` | Cria uma nova identidade digital do DCP (RPR + passaporte) |
| `dcp_declare_intent` | Declara uma intenção para avaliação de política |
| `dcp_check_agent` | Marcador de posição: devolve `check_pending` sem obter nem verificar nada |
| `dcp_commission_agent` | Coloca um agente em serviço (DCP-05) |
| `dcp_report_vitality` | Informa métricas de vitalidade do agente (DCP-05) |
| `dcp_decommission_agent` | Desativa um agente (DCP-05) |
| `dcp_create_testament` | Cria um testamento digital (DCP-06) |
| `dcp_file_dispute` | Abre uma disputa entre agentes (DCP-07) |
| `dcp_declare_rights` | Declara os direitos do agente (DCP-08) |
| `dcp_create_mandate` | Cria um mandato de delegação (DCP-09) |

<a id="mcp-resources"></a>

## Recursos do MCP

| URI | Descrição |
|---|---|
| `dcp://protocol/version` | Versão atual do protocolo DCP e as suas capacidades |
| `dcp://protocol/algorithms` | Algoritmos criptográficos suportados |
| `dcp://protocol/tiers` | Definições e requisitos dos níveis de segurança |
| `dcp://protocol/lifecycle-states` | Definições dos estados do ciclo de vida do agente (DCP-05) |

<a id="usage"></a>

## Uso

<a id="registering-with-an-mcp-server"></a>

### Registro em um servidor MCP

`DCP_MCP_TOOLS` são descritores de ferramentas (`name`, `description`, `inputSchema` como JSON Schema) e `DCP_MCP_RESOURCES` descritores de recursos (`uri`, `name`, `description`, `mimeType`); o pacote não fornece o conteúdo dos recursos. Um esboço com o `Server` de baixo nível do SDK TypeScript do MCP, que aceita descritores de ferramentas em JSON Schema como estão (não executado aqui: precisa do SDK do MCP):

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

### Exemplos de chamadas de ferramentas

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

- `dcp_verify_bundle` executa `verifySignedBundleV2` de `@dcp-ai/sdk` sob `DEFAULT_VERIFIER_POLICY` (hashes, manifesto, assinatura composta, vinculação de sessão, a cadeia de auditoria SHA-256). Não valida os JSON Schemas (o verificador de referência `lib/verify.js` o faz) nem recalcula a cadeia secundária SHA3-256 do V2-11, e um resultado `verified` não é admissão nem autorização.
- Fora `dcp_verify_bundle` e os recibos, os manipuladores de ferramentas devolvem rascunhos: identificadores e campos para assinar, nunca chaves nem assinaturas (`next_step` diz o que falta).
- `dcp_create_identity` devolve só identificadores — a geração de chaves e a assinatura são etapas separadas.
- O nível de risco é calculado automaticamente a partir da pontuação de risco: routine (<200), standard (200-499), elevated (500-799), maximum (800+).
