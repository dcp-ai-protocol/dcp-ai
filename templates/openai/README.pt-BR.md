<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

<a id="dcp-ai--openai-function-calling-template"></a>
<a id="dcp-ai-openai-function-calling-template"></a>

# Template DCP-AI + chamada de funções da OpenAI

> Tradução informativa da [versão em inglês](README.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Um roteiro do fluxo do DCP em torno da chamada de funções da OpenAI.

> **Um roteiro, não um assinador.** As chaves e assinaturas em `index.js` são marcadores de posição (`«generated»`, `«sig»`): o template mostra a forma do fluxo do DCP v2.0, mas não gera chaves, não assina nada e os seus bundles não são verificados. Não lê nada de `.dcp/`. Para chaves e assinaturas reais, siga [docs/QUICKSTART_OPENAI.md](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/docs/QUICKSTART_OPENAI.md).

<a id="quick-start"></a>

## Início rápido

1. Instale as dependências:
   ```bash
   npm install
   ```

2. Execute-o. Com `OPENAI_API_KEY`, o template chama a API da OpenAI (cobrada pela OpenAI). Se essa primeira chamada falhar por qualquer motivo (sem chave, rede, cota, modelo), ele recorre a chamadas de funções simuladas; a mensagem que imprime sobre a falta da chave não diagnostica a causa. Defina a chave no seu ambiente, não no comando:
   ```bash
   node index.js
   ```

<a id="what-this-template-does"></a>

## O que este template faz

- Registra ferramentas que conhecem o DCP como funções da OpenAI
- Cada chamada de função cria uma Intent do DCP antes da execução; a etapa de política é um esboço que sempre devolve `approve`
  (risco 120), então o ramo "blocked by policy" não é alcançado
- As ferramentas (`lookupWeather`, `sendEmail`, `searchWeb`) sempre devolvem dados simulados, mesmo quando o modelo é chamado de
  verdade: os seus resultados e entradas de auditoria não mostram que alguma ação externa aconteceu
- Cada resposta recebe uma entrada de auditoria, encadeada por hash à anterior
- Um Citizenship Bundle com assinaturas de marcador de posição é impresso após a conversa

<a id="files"></a>

## Arquivos

- `index.js` — chamada de funções da OpenAI com o fluxo do DCP
- `package.json` — dependências
