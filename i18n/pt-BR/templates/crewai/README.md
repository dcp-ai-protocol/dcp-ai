<sub>[English](../../../../templates/crewai/README.md) · [中文](../../../zh-CN/templates/crewai/README.md) · [Español](../../../es/templates/crewai/README.md) · [日本語](../../../ja/templates/crewai/README.md) · **Português**</sub>

<a id="dcp-ai--crewai-template"></a>
<a id="dcp-ai-crewai-template"></a>

# Template DCP-AI + CrewAI

> Tradução informativa da [versão em inglês](../../../../templates/crewai/README.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Mostra o fluxo do protocolo DCP v2.0 para equipes multiagente. Este template simula um fluxo de trabalho multiagente no estilo do CrewAI em que cada agente recebe um passaporte do DCP e todas as ações são auditadas.

> **Nota:** Este template mostra as estruturas de dados e o ciclo de vida do DCP sem depender em tempo de execução das bibliotecas do CrewAI nem do dcp-ai. É uma simulação autônoma em Python pensada como referência para integrar o DCP nos seus próprios projetos do CrewAI. Para chaves e assinaturas reais, siga [docs/QUICKSTART_CREWAI.md](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/docs/QUICKSTART_CREWAI.md).

<a id="quick-start"></a>

## Início rápido

1. Instale as dependências (opcional — o template roda sem elas):
   ```bash
   pip install -r requirements.txt
   ```

2. Execute a simulação:
   ```bash
   python main.py
   ```

<a id="what-this-template-does"></a>

## O que este template faz

- Simula uma equipe multiagente em que cada agente tem um passaporte do DCP v2.0
- Cada ação de um agente gera uma Intent → PolicyDecision → AuditEntry. A etapa de política é um esboço: `evaluate_policy`
  sempre devolve `approve` (risco 75)
- A execução da equipe produz um Citizenship Bundle com chaves e assinaturas de **marcador de posição** (`«generated»`, `«sig»`): nada é assinado e o bundle não é verificado
- Mostra o fluxo de dados do DCP v2.0: nonce de sessão, entradas de chaves, manifesto, campos de assinatura composta

<a id="files"></a>

## Arquivos

- `main.py` — simulação do fluxo do DCP multiagente (Python autônomo)
- `requirements.txt` — dependências Python (para uma integração real com o CrewAI e o SDK do DCP)

<a id="integrating-with-real-crewai"></a>

## Integração com o CrewAI real

Para integrar o DCP com uma equipe real do CrewAI, envolva a execução da tarefa de cada agente com o ciclo de vida do DCP mostrado em `main.py`:

```python
# Fragment: agent and task are your CrewAI objects; DCPCrewMember comes from main.py
from crewai import Agent, Task, Crew

# Use the DCP helpers from main.py to wrap agent actions
member = DCPCrewMember(name="researcher", role="analyst")

# Before each task: declare intent + get policy
intent = member.declare_intent("api_call", "api", "api.openai.com")
policy = member.evaluate_policy(intent)
if policy["decision"] != "approve":
    raise RuntimeError(f"DCP policy decision: {policy['decision']}")  # do not run the task

# Execute the CrewAI task
crew = Crew(agents=[agent], tasks=[task])
result = crew.kickoff()

# After each task: log audit entry
member.log_action(intent, policy, str(result), "crewai.task")
```
