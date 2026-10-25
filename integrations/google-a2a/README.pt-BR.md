<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

<a id="dcp-ai--a2a-agent-to-agent-protocol-bridge"></a>
<a id="dcp-ai-a2a-agent-to-agent-protocol-bridge"></a>

# Ponte DCP-AI ↔ protocolo A2A (Agent-to-Agent)

> Tradução informativa da [versão em inglês](README.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Leva o Agent Passport assinado do DCP dentro da Agent Card do A2A, para que um consumidor do A2A possa verificar offline
o hash e a autoassinatura do passaporte antes de delegar uma tarefa. O passaporte nomeia um principal responsável; esta
ponte não verifica o RPR desse principal nem estabelece a admissão. Ela também mapeia as tarefas do A2A para intenções
e entradas de auditoria do DCP.

<a id="installation"></a>

## Instalação

> **Estado de publicação (25/10/2026).** O npm tem `@dcp-ai/google-a2a` 2.0.0, sem o passaporte na Agent Card (`attachPassportToAgentCard`, `agentCardPassport`, `verifyAgentCardPassport`): eles estão no código-fonte em `main` (versão 2.1.0, não publicada). A dependência `@dcp-ai/sdk` do pacote-fonte é `^2.0.0`; uma instalação comum com npm a resolve para 2.1.1. Portanto, compilar este checkout sem a substituição pelo SDK local abaixo usaria os provedores criptográficos mais antigos. `verifyAgentCardPassport` usa as funções de assinatura composta do SDK, não o seu verificador completo `verifySignedBundleV2`.

A partir de um checkout (a versão desta página, com o SDK de `main`):

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai/sdks/typescript && npm install && npm run build
cd ../../integrations/google-a2a && npm install
npm install --no-save --package-lock=false --ignore-scripts --install-links ../../sdks/typescript
npm run build
# then, in your project:
npm install /path/to/dcp-ai/integrations/google-a2a
```

A versão publicada (2.0.0):

```bash
npm install @dcp-ai/google-a2a
```

<a id="the-passport-inside-the-agent-card"></a>

## O passaporte dentro da Agent Card

O A2A permite que uma Agent Card declare extensões em `capabilities.extensions` (`AgentExtension`: `uri`,
`description`, `required`, `params`). A extensão do passaporte do DCP, com URI
`https://dcp-ai.org/a2a/extensions/passport/v2`, leva o `SignedPayload<AgentPassportV2>` (DCP-01) do agente em
`params.passport`: o passaporte que o agente assinou com as chaves Ed25519 + ML-DSA-65 que lista, com a sua
`principal_binding_reference` ao Responsible Principal Record. Nada de novo no formato de transmissão.

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

### O que a verificação prova e o que não prova

`verifyAgentCardPassport` checa se a extensão está presente, se o `payload_hash` coincide, se a assinatura composta é
`pq_over_classical` (Ed25519 mais ML-DSA-65 ou SLH-DSA-192f, cada posição fixada ao seu algoritmo) e é verificada no
contexto AgentPassport com chaves que o próprio passaporte lista (ativas, não expiradas, cada `kid` o hash da sua chave
pública), se os carimbos de data/hora seguem um padrão RFC 3339 e são interpretados com `Date.parse` (não é uma checagem completa do calendário: algumas datas impossíveis, como 30 de fevereiro, são normalizadas e passam), se o passaporte está `active`, e se `metadata.dcp_agent_id` e
`expectedAgentId`, quando informados, nomeiam o mesmo agente. Uma card que falha em alguma dessas checagens listadas é
recusada; isso não é uma validação completa do passaporte contra o JSON Schema, então os campos fora dessas checagens
não são validados.

Um passaporte é público, e qualquer pessoa pode copiá-lo para a sua própria card. Então um resultado `verified`
sozinho prova que o passaporte é **coerente consigo mesmo**: assinado pelas chaves que lista. Ele não prova que quem
serve a card tem essas chaves, nem que `url`, `name`, `provider` ou `skills` pertencem ao agente do passaporte. Para
transformá-lo em uma checagem de identidade:

- Passe `trustedKeys`: as chaves em que você já confia para esse agente (de um registro, de um passaporte anterior
  fixado, ou das `binding_keys` de um RPR cujo principal você ancora fora do bundle, quando o principal assina pelo
  agente; uma assinatura válida sobre um RPR não o torna, por si só, confiável) e
  `expectedAgentId`. As duas chaves signatárias devem estar entre elas, e as próprias entradas confiáveis devem estar
  `active` e não expiradas (o seu registro de uma chave prevalece sobre a cópia do passaporte); o resultado então diz
  `anchored: true`. `anchored` só indica que `trustedKeys` foi informado, mesmo quando a verificação falha: para uma
  checagem ancorada, exija `verified && anchored`.
- Use só `result.passport`, nunca os campos não assinados da card, como identidade do agente.
- Antes de delegar uma tarefa, exija do endpoint uma prova de posse: `generateRegistrationPoP` /
  `verifyRegistrationPoP` do SDK, ou uma sessão A2A do DCP-04.
  `verifyRegistrationPoP` só checa a assinatura sobre o desafio que recebe: o seu próprio protocolo deve emitir um nonce
  novo e imprevisível a partir do verificador, impor a sua expiração e o seu uso único, e vinculá-lo ao kid, ao agente e
  ao endpoint. Não confie em uma PoP que o endpoint envie por conta própria ou reutilize. O `AgentCard.signatures` do
  A2A 1.0 (JWS sobre a card) é a forma do próprio protocolo de vincular o resto da card; esta ponte não o implementa.

`attachPassportToAgentCard(card, signedPassport)` acrescenta a extensão a uma card que você já tem (substituindo um
passaporte do DCP anterior), `agentCardPassport(card)` a lê, e `agentCardToPassport(card)` retorna o passaporte que ela
traz, em vez de um esqueleto, quando a card tem um.

<a id="supported-dcp-specifications"></a>

## Especificações do DCP suportadas

Do DCP-01 ao DCP-09, como correspondências parciais (as funções abaixo); não é uma implementação completa dessas especificações.

<a id="overview"></a>

## Visão geral

O protocolo A2A do Google define um padrão para a descoberta e a comunicação entre agentes. Esta ponte mapeia os conceitos de identidade e auditoria do DCP para primitivas do A2A:

- **Agent Passports ↔ Agent Cards** — leva passaportes do DCP em Agent Cards do A2A detectáveis, com os limites de confiança e de prova de posse acima.
- **Tarefas A2A → intenções do DCP** — converte as requisições de tarefas A2A recebidas em intenções do DCP para a avaliação da política e o registro de auditoria.
- **Envolvimento de auditoria** — anexa entradas de auditoria do DCP às execuções de tarefas A2A para a rastreabilidade.

<a id="functions"></a>

## Funções

| Função | Sentido | Descrição |
|---|---|---|
| `passportToAgentCard(passport, endpoint)` | DCP → A2A | Converte um Agent Passport (assinado ou simples) em uma Agent Card do A2A; um assinado vai na extensão do DCP |
| `attachPassportToAgentCard(card, signedPassport)` | DCP → A2A | Coloca um passaporte assinado em `capabilities.extensions` de uma card existente |
| `agentCardPassport(card)` | A2A → DCP | O passaporte assinado que uma card traz, se houver |
| `verifyAgentCardPassport(card, options?)` | A2A → DCP | Verifica offline o passaporte que ela traz |
| `agentCardToPassport(card)` | A2A → DCP | O passaporte que ela traz, ou um esqueleto para uma card sem ele |
| `wrapA2ATaskWithAudit(task, agentId, intentId)` | A2A + DCP | Envolve uma tarefa com uma entrada de auditoria do DCP |
| `a2aTaskToIntent(task, agentId)` | A2A → DCP | Converte uma requisição de tarefa em uma intenção do DCP |
| `addMandateToA2AHandshake(handshake, mandate)` | DCP → A2A | Injeta um mandato do DCP-09 no handshake do A2A |
| `createLifecycleNotification(agentId, event, details)` | DCP → A2A | Cria uma notificação do A2A para eventos de ciclo de vida (DCP-05) |

<a id="agent-card-metadata"></a>

## Metadados da Agent Card

Os metadados do DCP são embutidos no campo `metadata` da Agent Card:

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

Esses campos são dados não assinados da card: `dcp_security_tier` é sempre `"standard"` (não é calculado), e `dcp_owner_rpr_hash` contém o `owner_rpr_hash` do passaporte ou, para um passaporte V2, a sua `principal_binding_reference` (o `human_id` do RPR, não um hash). Eles ajudam na descoberta; a identidade só vem do passaporte verificado (`result.passport`).

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

- O `authentication.schemes` da Agent Card é definido como `['dcp-bundle']` para sinalizar que este agente usa a autenticação baseada em bundles do DCP.
- As skills do passaporte são derivadas das capacidades do DCP, com os sublinhados substituídos por espaços para obter nomes legíveis.
- As conversões para esqueleto (A2A → DCP) de uma card sem a extensão do DCP produzem registros parciais que precisam de geração de chaves e assinatura antes do uso.
- Os campos da card que esta ponte escreve (`authentication`, `metadata`, …) são anteriores ao A2A 1.0, cuja card usa `supportedInterfaces` e `securitySchemes`; `capabilities.extensions` é válido nos dois. Alinhar o resto da card com o A2A 1.0 é uma mudança à parte.
