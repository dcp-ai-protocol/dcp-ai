<sub>[English](../../../../templates/langchain/README.md) · [中文](../../../zh-CN/templates/langchain/README.md) · [Español](../../../es/templates/langchain/README.md) · [日本語](../../../ja/templates/langchain/README.md) · **Português**</sub>

<a id="dcp-ai--langchain-template"></a>
<a id="dcp-ai-langchain-template"></a>

# Template DCP-AI + LangChain

> Tradução informativa da [versão em inglês](../../../../templates/langchain/README.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Um roteiro do fluxo do DCP em torno de uma chamada do LangChain.

> **Um roteiro, não um assinador.** As chaves e assinaturas em `index.js` são marcadores de posição (`«generated»`, `«sig»`): o template mostra a forma do fluxo do DCP v2.0, mas não gera chaves, não assina nada e os seus bundles não são verificados. Não lê nada de `.dcp/`. Para chaves e assinaturas reais, siga [docs/QUICKSTART_LANGCHAIN.md](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/docs/QUICKSTART_LANGCHAIN.md).

O template fixa o LangChain.js 0.3 (`langchain` e `@langchain/openai` `^0.3.0`); o guia mostra a API atual do LangChain.js v1.

<a id="quick-start"></a>

## Início rápido

1. Instale as dependências:
   ```bash
   npm install
   ```

2. Execute-o. Com `OPENAI_API_KEY`, o template chama a API da OpenAI (cobrada pela OpenAI). Se a chamada falhar por qualquer motivo (sem chave, rede, cota, modelo), ele imprime uma resposta simulada e mesmo assim registra `outcome: "success"`, então a entrada de auditoria não mostra que a chamada teve sucesso. Defina a chave no seu ambiente:
   ```bash
   node index.js
   ```

<a id="what-this-template-does"></a>

## O que este template faz

- Envolve uma chamada do LangChain no fluxo do DCP
- Cada ação é declarada como uma Intent; a etapa de política é um esboço que sempre devolve `approve` (risco 50), então os
  ramos de escalonamento e bloqueio mostram o fluxo, mas não são alcançados
- Cada resposta recebe uma entrada de auditoria
- O Citizenship Bundle do agente traz assinaturas de marcador de posição

<a id="files"></a>

## Arquivos

- `index.js` — chamada do LangChain com o fluxo do DCP
- `package.json` — dependências
