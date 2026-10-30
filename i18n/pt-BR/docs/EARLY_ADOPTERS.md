<sub>[English](../../../docs/EARLY_ADOPTERS.md) · [中文](../../zh-CN/docs/EARLY_ADOPTERS.md) · [Español](../../es/docs/EARLY_ADOPTERS.md) · [日本語](../../ja/docs/EARLY_ADOPTERS.md) · **Português**</sub>

<a id="dcp-ai-early-adopter-program"></a>

# Programa de adotantes iniciais do DCP-AI

> Tradução informativa da [versão em inglês](../../../docs/EARLY_ADOPTERS.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

**Status:** Aberto — admissão contínua
**Licença:** Apache-2.0 (participar não tem custo)

---

<a id="what-it-is"></a>

## O que é

O DCP-AI é uma camada portátil de responsabilização para agentes de IA: identidade criptográfica, intenção legível por máquina, trilhas de auditoria que permitem detectar adulterações, comunicação entre agentes, governança do ciclo de vida e representação delegada. Toda a pilha é de código aberto e pode ser instalada a partir de todos os principais registros.

O programa de adotantes iniciais é um convite às equipes que implantam agentes de IA em sistemas reais para integrar o DCP-AI, trazer à tona os casos-limite que uma revisão baseada só na especificação não consegue encontrar e moldar diretamente a próxima iteração do protocolo.

Não é um teste beta. Os SDKs estão publicados e em uso. É uma parceria de codesign: a história da sua integração passa a fazer parte de como as próximas versões são projetadas.

---

<a id="who-should-apply"></a>

## Quem deve se candidatar

- **Equipes de plataformas de IA** que constroem frameworks ou orquestração de agentes
- **Equipes corporativas** que implantam agentes autônomos onde responsabilidade, auditoria ou conformidade regulatória importam
- **Equipes do setor financeiro, de saúde ou do setor público** que precisam de identidade de agente verificável
- **Pesquisadores** que trabalham com segurança de agentes, criptografia pós-quântica ou credenciais verificáveis
- **Desenvolvedores independentes** que lançam produtos de agentes inovadores e estão dispostos a compartilhar o que aprendem

---

<a id="what-you-get"></a>

## O que você recebe

<a id="everything-in-the-public-stack"></a>

### Tudo da pilha pública

Você não espera «acesso» a nada. Isto já está disponível:

| Artefato | Onde |
|---|---|
| 9 especificações do protocolo (DCP-01..09) | [docs.dcp-ai.org](https://docs.dcp-ai.org/) |
| 5 SDKs que implementam o mesmo protocolo principal (TypeScript, Python, Go, Rust, WASM); versões e cobertura diferem, veja a seção *Release status* de cada SDK | npm / PyPI / crates.io / módulos Go |
| 11 integrações com frameworks (LangChain, CrewAI, Agno, OpenAI, Express, FastAPI, Anthropic MCP, Google A2A, AutoGen, W3C DID, OpenClaw) | npm + dcp-ai[extras] + agno-dcp (PyPI) |
| 4 geradores `npm create @dcp-ai/*` | npm |
| Imagens Docker dos quatro serviços | `ghcr.io/dcp-ai-protocol/dcp-ai/*` |
| Playground interativo | [docs.dcp-ai.org/playground](https://docs.dcp-ai.org/playground/) |
| `@context` JSON-LD para credenciais verificáveis | [dcp-ai.org/credentials/v2](https://dcp-ai.org/credentials/v2) |

<a id="what-early-adopters-get-on-top"></a>

### O que os adotantes iniciais recebem a mais

- **Canal direto com os mantenedores** via Issues/Discussions do GitHub: respostas em até 2 dias úteis e triagem de prioridade máxima para bloqueios.
- **Participação no codesign** do roteiro das próximas versões: quais níveis de segurança, quais algoritmos, quais decisões sobre o formato de transmissão.
- **Validação de conformidade**: ajuda para montar suítes de testes que exercitem os seus caminhos de integração específicos; os resultados alimentam a suíte de conformidade pública.
- **Colaboração em estudo de caso** (opcional): um texto publicado sobre a sua integração — decisões de arquitetura, desafios, resultados — com a sua aprovação em cada parágrafo.
- **Caminho de governança**: colaboradores ativos são convidados a se tornar Reviewers ou Maintainers conforme o [GOVERNANCE.md](../../../GOVERNANCE.md).

---

<a id="what-we-ask"></a>

## O que pedimos

<a id="integration"></a>

### Integração

1. Integrar o SDK do DCP-AI em pelo menos um caminho de homologação ou de produção em até 90 dias após o início.
2. Implementar o fluxo principal de ponta a ponta: vinculação de identidade → declaração de intenção → decisão de política → entrada de auditoria → verificação do bundle.
3. Na v2.0, usar assinaturas híbridas compostas (Ed25519 + ML-DSA-65). Os SDKs fazem isso por você; nada de implementar à mão.
4. Executar a suíte de testes de conformidade contra a sua integração e compartilhar o resultado.

### Feedback

1. Uma nota de feedback estruturada por mês — Discussion do GitHub, e-mail ou uma ligação curta, o que for mais fácil.
2. Registrar bugs e casos-limite como issues do GitHub. Para achados sensíveis à segurança, usar o relato privado de vulnerabilidades do GitHub.
3. Participar de pelo menos uma discussão aberta em que decisões de projeto estejam sendo avaliadas.

<a id="testing"></a>

### Testes

1. Executar a validação NIST KAT das primitivas criptográficas das quais você depende (Ed25519, ML-DSA-65; ML-KEM-768 e SLH-DSA-192f, se aplicável).
2. Se você usa vários SDKs no mesmo sistema, executar os vetores de interoperabilidade entre SDKs (`tests/interop/v2/`).
3. Validar a compatibilidade com bundles v1.0, se houver algum no seu pipeline.
4. Tentar quebrar as coisas: adulteração de bundles, remoção de assinaturas, emenda de sessões, repetição. Se você quebrar, queremos saber.

---

<a id="timeline"></a>

## Cronograma

O programa funciona com admissão contínua. O seu relógio começa quando você aceita.

| Fase | Duração típica | O que acontece |
|---|---|---|
| Integração inicial | semana 1 | Chamada ou thread de início. Apresentação do protocolo voltada para a sua pilha. Rascunho do plano de integração. |
| Integração | semanas 2-8 | O fluxo principal é construído. Primeira execução de conformidade. Surge o primeiro bloqueio. Ciclo de desbloqueio com a ajuda dos mantenedores. |
| Endurecimento | semanas 9-12 | Ajuste dos níveis de segurança. Cobertura de NIST KAT. Interoperabilidade entre SDKs, se aplicável. Revisão da prontidão para produção. |
| Graduação | semana 13 em diante | Você é um participante pleno do ecossistema. Rascunho do estudo de caso, se você optou por ele. O caminho de governança se abre. |

Não há uma «data de término» formal. Você continua no programa enquanto estiver lançando e o ciclo de feedback estiver ativo.

---

<a id="how-to-apply"></a>

## Como se candidatar

<a id="process"></a>

### Processo

1. Abra uma Discussion do GitHub em [`dcp-ai-protocol/dcp-ai`](https://github.com/dcp-ai-protocol/dcp-ai/discussions) usando o modelo **Early Adopter Application** (ou abra uma issue com o rótulo `early-adopter` se as discussões não estiverem habilitadas para você).
2. Como alternativa, envie um e-mail aos mantenedores (veja o [GOVERNANCE.md](../../../GOVERNANCE.md) para os contatos atuais dos mantenedores).

<a id="what-to-include"></a>

### O que incluir

- Nome da organização ou da equipe, e uma breve descrição
- Caso de uso: que agentes você implanta, ou pretende implantar?
- Pilha técnica: linguagens, frameworks, infraestrutura
- Quais componentes do DCP são mais relevantes para você (identidade do DCP-01? auditoria do DCP-03? arbitragem do DCP-07? todos eles?)
- Cronograma: quando você pode começar?
- Tamanho da equipe: quantos engenheiros vão trabalhar na integração?

<a id="review"></a>

### Avaliação

As candidaturas são avaliadas de forma contínua, normalmente em até 7 dias úteis. Buscamos uma mistura de casos de uso — conformidade corporativa, pesquisa, desenvolvedores independentes — em vez de selecionar por tamanho.

---

<a id="selection-criteria"></a>

## Critérios de seleção

- **Diversidade de casos de uso**: buscamos ativamente aplicações incomuns, não só os caminhos corporativos esperados.
- **Intenção real de implantação**: prioridade para equipes que lançam em sistemas reais, não só para quem está avaliando.
- **Engajamento**: disposição para compartilhar o que você encontrar, tanto o positivo quanto o negativo.
- **Capacidade técnica**: a equipe tem experiência prévia com protocolos criptográficos, sistemas de agentes ou infraestrutura relevante para a segurança.

---

<a id="support-channels"></a>

## Canais de suporte

| Canal | Finalidade | Acesso |
|---|---|---|
| Issues do GitHub | Bugs, pedidos de recursos, problemas de conformidade | Público |
| Discussions do GitHub | Perguntas de projeto, threads de adotantes iniciais, padrões de integração | Público |
| Relatos privados de vulnerabilidades | Achados sensíveis à segurança | Relato privado do GitHub |
| E-mail | Trabalho sob NDA, conversas contratuais | Conforme o [GOVERNANCE.md](../../../GOVERNANCE.md) |

No momento não há Slack, Discord nem horários de atendimento dedicados. O programa é tocado de forma enxuta para que o tempo dos mantenedores vá para resolver de fato os seus problemas. Se a demanda crescer o bastante para justificar um canal de comunidade, vamos criá-lo e anunciá-lo aqui.

---

<a id="security-disclosure"></a>

## Divulgação de segurança

Os problemas de segurança do DCP-AI são divulgados de forma responsável pelo relato privado de vulnerabilidades do GitHub. Uma recompensa financeira por bugs pode ser oferecida, caso a caso, para achados de alto impacto; ela é decidida em cada relato com base na gravidade e na reprodutibilidade, não por uma faixa comprometida de antemão. Pesquisadores que preferem o reconhecimento público são citados nas notas de versão.

> **Nota (25/10/2026): os documentos divergem.** O [SECURITY.md](../../../SECURITY.md) lista faixas de recompensa fixas por gravidade, enquanto esta página e o [GOVERNANCE.md](../../../GOVERNANCE.md) dizem que as recompensas são decididas em cada relato. Os dois textos são mantidos até que um mantenedor confirme qual vale.

Veja [SECURITY_MODEL.md](../../../docs/SECURITY_MODEL.md) para o modelo de ameaças e as orientações de relato.

---

<a id="success-stories"></a>

## Histórias de sucesso

*Esta seção será preenchida à medida que os adotantes iniciais publicarem as suas integrações.*

<a id="your-organization-here"></a>

### [A sua organização aqui]

Se você integrar o DCP-AI e estiver disposto a compartilhar a história — decisões de arquitetura, surpresas, resultados —, queremos destacá-la. Entre em contato com os mantenedores para iniciar uma thread de estudo de caso.

---

<a id="faq"></a>

## Perguntas frequentes

**P: O DCP-AI está pronto para produção?**
R: A especificação v2.0 está completa e os 5 SDKs estão publicados e em uso. O DCP-04 ao DCP-09 trazem nos cabeçalhos o rótulo «Published — v2.0 (extension; revisions tracked via adopter feedback)»; o formato de transmissão é estável e testado, e as revisões de versões menores serão guiadas pelo feedback dos adotantes, não por mudanças incompatíveis. Se está pronto para a sua implantação depende das partes que você usa:

- os verificadores dos SDKs são o caminho de produção; os serviços de referência guardam o estado em memória, e os endpoints do DCP-05–09 do gateway de referência não têm autenticação ([OPERATOR_GUIDE.md](../../../docs/OPERATOR_GUIDE.md));
- o repositório não tem integração com HSM, e o assistente `@dcp-ai/cli init` é uma demonstração ([SECURITY_MODEL.md](../../../docs/SECURITY_MODEL.md), «Known Limitations and Mitigations»).

A auditoria de segurança final da v2.0 de 26/02/2026 ([spec/AUDIT-v2.0-FINAL.md](../../../spec/AUDIT-v2.0-FINAL.md)) é um registro datado: revisões posteriores encontraram limites que ela não relatou, como o fato de que a lacuna de HSM dela foi fechada apenas por um provedor simulado.

**P: Há custo para participar do programa de adotantes iniciais?**
R: Não. O programa é gratuito. Todo o projeto tem licença Apache-2.0.

**P: Preciso usar os recursos pós-quânticos?**
R: Depende do verificador. Um bundle V2 pode trazer uma assinatura somente clássica; os verificadores exigem a assinatura híbrida composta (Ed25519 + ML-DSA-65) no modo `hybrid_required`, que se aplica às ações de nível elevated e maximum e é o padrão do servidor de referência. Use chaves híbridas e o SDK assina com as duas para você; você não escreve criptografia à mão.

**P: Posso participar como desenvolvedor individual?**
R: Sim. Desenvolvedores individuais e equipes pequenas são bem-vindos e muitas vezes descobrem os casos-limite mais interessantes.

**P: O que acontece quando eu termino o programa?**
R: Você continua usando o DCP-AI. Colaboradores ativos são convidados a se tornar Reviewers ou Maintainers conforme o [GOVERNANCE.md](../../../GOVERNANCE.md).

**P: Posso executar a minha própria instância hospedada dos serviços?**
R: Sim, esse é o modelo previsto. O servidor de verificação, a ancoragem, o log de transparência e o registro de revogações são publicados como imagens Docker no GHCR, com configurações do Fly.io prontas em [`deploy/`](../../../deploy/). Não há SaaS próprio; cada operador executa os seus. São serviços de referência: acrescente armazenamento persistente, restrinja os endpoints do DCP-05–09 sem autenticação do gateway e leia o [OPERATOR_GUIDE.md](../../../docs/OPERATOR_GUIDE.md) antes de expô-los.

**P: Como cito o DCP-AI num artigo?**
R: Veja o [CITATION.cff](../../../CITATION.cff) para os DOIs do artigo e do software.

---

*O programa de adotantes iniciais do DCP-AI é um convite aberto para construir juntos a infraestrutura de responsabilização de que os sistemas de IA autônomos precisam.*
