<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

<a id="dcp-ai--express-api-server-template"></a>
<a id="dcp-ai-express-api-server-template"></a>

# Template DCP-AI + servidor de API Express

> Tradução informativa da [versão em inglês](README.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Uma API Express que mostra onde ficam as verificações de bundles do DCP em um servidor.

> **Não verifica assinaturas.** O `verifyBundle` do template só confere a estrutura de um bundle (versão, campos do manifesto, a presença de assinaturas compostas, nonces de sessão). Não verifica nenhuma assinatura, então um bundle falsificado ou alterado passa. Use-o para ver as rotas e o fluxo, não como verificador. Para verificar bundles, use [`@dcp-ai/express`](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/integrations/express/README.md) (a partir de um checkout até a sua próxima versão) ou o `verifySignedBundleV2` do SDK, como em [docs/QUICKSTART_EXPRESS.md](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/docs/QUICKSTART_EXPRESS.md).

<a id="quick-start"></a>

## Início rápido

1. Instale as dependências:
   ```bash
   npm install
   ```

2. Inicie o servidor:
   ```bash
   node index.js
   ```

O template não lê `.dcp/`, então `npx @dcp-ai/cli init` não é necessário (e esse assistente é uma demonstração: [Criação de agentes](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/docs/AGENT_CREATION_AND_CERTIFICATION.md#cli-wizard-demo-only)).

<a id="what-this-template-does"></a>

## O que este template faz

- Executa um servidor de API Express com um middleware do DCP que confere a **estrutura** dos bundles (veja acima)
- Os agentes apresentam um Citizenship Bundle para chegar às rotas protegidas
- Limita a taxa de requisições das rotas públicas e protegidas
- Mantém um registro em memória dos agentes nomeados pelos bundles que passaram na verificação estrutural: o seu `agent_id` e
  as suas capacidades são autodeclarados e não verificados, e o registro se perde ao reiniciar
- `/agents/action` não executa nada: confere a ação contra as capacidades autodeclaradas do bundle e devolve
  um `action_id`
- Fornece `/verify`, `/health`, `/agents/*` e `/.well-known/dcp-capabilities.json`

## Endpoints

| Método | Caminho            | Autenticação | Descrição                          |
|--------|--------------------|----------|------------------------------------|
| GET    | `/health`          | Nenhuma  | Verificação de saúde               |
| POST   | `/verify`          | Nenhuma  | Verificação estrutural de um bundle do DCP (sem verificação de assinaturas) |
| POST   | `/agents/action`   | DCP      | Confirmação simulada: verificação de capacidades contra o bundle, sem executar nenhuma ação (exige bundle) |
| GET    | `/agents/registry` | DCP      | Lista os agentes registrados       |
| GET    | `/.well-known/dcp-capabilities.json` | Nenhuma | Descoberta de capacidades |

<a id="files"></a>

## Arquivos

- `index.js` — servidor Express com o middleware do DCP
- `package.json` — dependências
