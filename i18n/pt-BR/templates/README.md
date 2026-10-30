<sub>[English](../../../templates/README.md) · [中文](../../zh-CN/templates/README.md) · [Español](../../es/templates/README.md) · [日本語](../../ja/templates/README.md) · **Português**</sub>

# Templates

> Tradução informativa da [versão em inglês](../../../templates/README.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Templates iniciais que mostram onde o DCP se encaixa em frameworks de IA e servidores web populares: identidade, declaração de intenção, controle por política, registro de auditoria e selagem do bundle.

> **Roteiros, não assinadores.** Os templates usam chaves e assinaturas de marcador de posição (`«generated»`, `«sig»`): não geram chaves, não assinam nada e os seus bundles não são verificados. O middleware do template de Express só confere a estrutura do bundle, não as assinaturas. Para chaves, assinaturas e verificação reais, siga os guias de início rápido em [docs/](../../../docs/README.md). Os mesmos templates são distribuídos como `npm create @dcp-ai/<name>` (`packages/create-*`).

<a id="available-templates"></a>

## Templates disponíveis

| Template | Linguagem | Descrição |
|----------|----------|-------------|
| [express/](../../../templates/express/) | Node.js | Servidor Express com uma verificação estrutural do DCP (sem verificação de assinaturas) e endpoints de descoberta |
| [openai/](../../../templates/openai/) | Node.js | Chamada de funções da OpenAI envolvida com intenção/política/auditoria do DCP |
| [langchain/](../../../templates/langchain/) | Node.js | Chamada do LangChain.js 0.3 envolvida no fluxo do DCP |
| [crewai/](../../../templates/crewai/) | Python | Simulação de uma equipe multiagente com passaportes e trilha de auditoria do DCP |

<a id="quick-start"></a>

## Início rápido

Cada template pode ser executado separadamente, a partir da raiz do repositório (cada comando roda em uma subshell, então o próximo
começa de novo na raiz). O servidor Express fica em primeiro plano: pare-o com Ctrl+C antes do próximo.

```bash
# Express
(cd templates/express && npm install && npm start)

# OpenAI (requires OPENAI_API_KEY for live calls, simulates without it)
(cd templates/openai && npm install && npm start)

# LangChain (requires OPENAI_API_KEY for live calls, simulates without it)
(cd templates/langchain && npm install && npm start)

# CrewAI (standalone Python)
(cd templates/crewai && python main.py)
```

<a id="dcp-lifecycle"></a>

## Ciclo de vida do DCP

Em conjunto, os templates ilustram este fluxo conceitual do DCP v2.0; cada um cobre apenas uma parte (o template de
Express, por exemplo, não cria nenhuma identidade, não sela nenhum bundle e não executa nenhuma ação):

1. **Iniciar a sessão** — gerar um nonce de sessão de 256 bits; os pares de chaves duplos (Ed25519 + ML-DSA-65) são marcadores de posição
2. **Criar o RPR** — vincular o agente de IA a um principal humano responsável
3. **Emitir o passaporte** — declarar as capacidades e o nível de risco do agente
4. **Declarar a intenção** — antes de cada ação, declarar o que o agente quer fazer
5. **Controlar por política** — avaliar a pontuação de risco e obter uma decisão approve/escalate/block. Nos templates esta etapa é um
   esboço que sempre devolve `approve`; o template de Express não tem etapa de política e só confere as capacidades
   autodeclaradas do bundle
6. **Executar a ação** — só prosseguir se a política aprovar
7. **Registrar a auditoria** — registrar a ação em uma trilha de auditoria encadeada por hash
8. **Selar o bundle** — reunir todos os artefatos em um Citizenship Bundle, com assinaturas compostas de marcador de posição

<a id="see-also"></a>

## Veja também

- [Guia de início rápido](../../../docs/QUICKSTART.md)
- [Referência da API](../../../docs/API_REFERENCE.md)
- [Guia de migração (V1 para V2)](../../../docs/MIGRATION_V1_V2.md)
