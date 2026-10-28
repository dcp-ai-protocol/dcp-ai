<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

<a id="dcp_ailangchain--langchain-integration"></a>
<a id="dcp_ailangchain-langchain-integration"></a>

# dcp_ai.langchain — integração com o LangChain

> Tradução informativa da [versão em inglês](README.md), atualizada em 28/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Integração do DCP com o LangChain. Envolve um agente do LangChain para que cada chamada concluída deixe uma entrada em uma trilha de auditoria encadeada por hash no formato V2, e fornece uma ferramenta de verificação de bundles e um manipulador de callbacks.

O wrapper guarda **registros não assinados**: as intenções, as decisões de política e as entradas de auditoria não são assinadas, e a `secret_key` que ele aceita não é usada. Para bundles assinados e verificáveis de um agente do LangChain, use o SDK principal como em [docs/QUICKSTART_LANGCHAIN.md](../../docs/QUICKSTART_LANGCHAIN.md).

<a id="supported-dcp-specifications"></a>

## Especificações do DCP suportadas

Do DCP-01 ao DCP-09, de forma parcial: registros não assinados nos formatos dessas especificações e verificação de
bundles por meio do `DCPTool`. Não as implementa por completo.

<a id="installation"></a>

## Instalação

**Publicado no PyPI (26/10/2026).** O `dcp-ai` 2.10.0 inclui a implementação descrita aqui. Atualize da 2.9.0 e renove seu ambiente ou arquivo de lock. Veja as [notas de Python](../../docs/PYTHON_RELEASE.md).

A versão 2.9.0 envia todos os bundles para V1. A 2.10.0 verifica V2 com o verificador normativo e aplica a política configurada a V1 e V2; permanecem as limitações sobre registros não assinados e callbacks descritas abaixo.

```bash
pip install "dcp-ai[langchain]>=2.10.1,<3"
```

Para desenvolvimento do código-fonte:

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
pip install -e "/path/to/dcp-ai/sdks/python[langchain]"
```

<a id="quickstart"></a>

## Início rápido

```python
import asyncio

from dcp_ai.langchain import DCPAgentWrapper

# The wrapper reads agent_id from the passport and human_id from the RPR;
# it does not check or sign them.
passport = {"agent_id": "agent:research-assistant-001", "capabilities": ["browse", "api_call"]}
rpr = {"human_id": "rpr:human-001"}


async def main() -> None:
    wrapped = DCPAgentWrapper(
        agent=my_langchain_agent,  # Fragment: your LangChain agent (ainvoke or invoke)
        passport=passport,
        rpr=rpr,
    )

    # invoke is a coroutine: await it
    result = await wrapped.invoke({"input": "Search for information about AI"})

    for entry in wrapped.get_audit_trail():
        print(f"[{entry['timestamp']}] {entry['intent_id']}: {entry['policy_decision']} -> {entry['outcome']}")


asyncio.run(main())
```

<a id="api-reference"></a>

## Referência da API

### `DCPAgentWrapper`

```python
DCPAgentWrapper(
    agent: Any,                         # LangChain agent: ainvoke is used when present, else invoke
    passport: dict[str, Any],           # agent_id is read
    rpr: dict[str, Any],                # human_id is read
    secret_key: str = "",               # Accepted but not used: nothing is signed
    session_nonce: str = "",            # A fresh one when empty
    auto_intent: bool = True,           # Stored, not used: invoke always creates an intent
    policy_engine: Any = None,          # Object with evaluate(intent) -> PolicyDecisionV2
    pq_checkpoint_interval: int = 10,   # Stored, not used: no PQ checkpoints are made
)
```

<a id="methods"></a>

#### Métodos

| Método | Descrição |
|--------|-------------|
| `await invoke(inputs, **kwargs)` | Cria uma intenção e uma decisão de política (locais, não mantidas como listas), executa o agente e, se ele retornar, registra uma entrada de auditoria (veja abaixo). Devolve um dict de erro, sem entrada de auditoria, quando o agente está desativado ou a decisão é `block`; uma exceção do agente se propaga e não deixa entrada de auditoria. |
| `get_audit_trail()` | As entradas de auditoria, encadeadas por hash: a própria lista em memória, não uma cópia, então alterá-la altera a trilha. |
| `get_session_nonce()` | O nonce de sessão. |
| `commission(purpose, capabilities, risk_tier)` | Coloca o agente em serviço (DCP-05 §3.1). |
| `report_vitality(metrics_dict)` | Informa métricas de vitalidade e calcula a pontuação (DCP-05 §4.1). |
| `decommission(termination_mode, reason)` | Desativa o agente (DCP-05 §5.1). |
| `declare_rights(rights, jurisdiction)` | Declara direitos (DCP-08 §3.1). |

<a id="what-invoke-does-on-main-25102026"></a>

#### O que `invoke` faz (em `main`, 25/10/2026)

1. Cria uma intenção: sempre `action_type: "api_call"`, canal `api`, `estimated_impact: "low"`, `data_classes: ["none"]`.
2. Obtém uma decisão de política. Sem `policy_engine`, a decisão é sempre `approve`. Com um, o seu `evaluate(intent)` deve devolver um `PolicyDecisionV2` (de `dcp_ai.v2.models`); um dict simples lança `AttributeError`.
3. Executa o agente a menos que a decisão seja `block`; uma chamada bloqueada devolve um dict de erro e **não deixa entrada de auditoria**. Uma decisão `escalate` **não** interrompe o agente: ele é executado, e a sua entrada de auditoria registra `policy_decision: "blocked"` com `outcome: "completed"`. Use `block` para tudo o que não deva ser executado até que uma pessoa aprove.
4. Se o agente retornar, registra uma entrada de auditoria e a encadeia: `intent_hash`, e `prev_hash` desde `GENESIS` até o hash da entrada anterior.

`evidence.result_ref` guarda os primeiros 100 caracteres do resultado do agente como texto, não como hash, então pode conter dados pessoais da saída. Trate a trilha de auditoria como dados que precisam da mesma proteção que a saída, ou não a guarde.

### `DCPTool`

Ferramenta no estilo do LangChain para verificar bundles do DCP de dentro de um agente. É uma classe simples (`name`, `description`, `run`, `arun`), não um `BaseTool` do LangChain; envolva-a para a sua versão do LangChain, por exemplo:

```python
from langchain_core.tools import StructuredTool
from dcp_ai.langchain import DCPTool

dcp = DCPTool()
verify_tool = StructuredTool.from_function(
    func=dcp.run, coroutine=dcp.arun, name=dcp.name, description=dcp.description,
)
```

<a id="attributes"></a>

#### Atributos

| Atributo | Valor |
|-----------|-------|
| `name` | `"dcp_verify_bundle"` |
| `description` | `"Verify a DCP signed bundle..."` |

<a id="methods-1"></a>
<a id="methods_1"></a>

#### Métodos

| Método | Assinatura | Descrição |
|--------|-----------|-------------|
| `run(signed_bundle_json)` | `(str \| dict) -> str` | Verificação síncrona, com ou sem um loop de eventos em execução |
| `arun(signed_bundle_json)` | `(str \| dict) -> str` | Verificação assíncrona |

Um bundle V2 é verificado com `verify_signed_bundle_v2` de `dcp_ai.v2` (assinaturas compostas, vinculação de sessão,
manifesto, coerência entre artefatos, a cadeia de auditoria SHA-256 — e, a partir de 2.10.1 mas não no 2.10.0, os campos secundários SHA3-256 do V2-11 presentes — e validade das chaves) sob `DCPTool(verifier_policy=...)`: um dict de campos de `VerifierPolicy` definidos
sobre `DEFAULT_VERIFIER_POLICY` (um `default_mode` sem `risk_overrides` se aplica a todos os níveis de risco), ou uma
`VerifierPolicy` completa; o padrão é `DEFAULT_VERIFIER_POLICY`. Um bundle V1, que só tem uma assinatura Ed25519, sem
intended_verifier nem janela de sessão, só é aceito quando a política tem `allow_v1_bundles`, aceita ed25519
(`accepted_classical_algs`, sem entrada em `advisory_rejected_algs`), não exige vinculação de audiência, expiração de
sessão nem duração máxima de sessão, e aceitaria um bundle apenas clássico para o seu nível de risco e o seu nível de
segurança (`spec/VERIFICATION.md` V2-10); os seus artefatos devem ser objetos, e o `agent_id` do passaporte e o
`human_id` do RPR, strings. O resultado é `Bundle VERIFIED (v<version>) for agent <agent_id>` ou
`Bundle INVALID: <errors>`, com os erros do verificador. O texto é limitado (no máximo 20 erros de 500 caracteres, um
`agent_id` de 200) e as partes que vêm do bundle têm os seus caracteres de controle e de formatação escapados
(`\u000a` para uma quebra de linha), porque chegam ao contexto do modelo.

`DCPTool` é uma verificação criptográfica sob a política que o seu código define ao construir a ferramenta
(`DCPTool(verifier_policy=...)`), nunca tirada do bundle nem do modelo. Não é admissão de um principal
ancorado e não autoriza nenhuma ação (veja [docs/ADMISSION.md](../../docs/ADMISSION.md)).

### `DCPCallback`

Registra os eventos de cadeia do LangChain como entradas de auditoria no formato V2 (não assinadas, encadeadas por hash). É uma classe simples, não um `BaseCallbackHandler` do LangChain: o LangChain 1.x a recusa como callback (`AttributeError`, verificado com `langchain-core` 1.7), e ela precisa de `run_id` como string enquanto o LangChain passa um `UUID`. Chame-a a partir de um manipulador próprio:

```python
from langchain_core.callbacks import BaseCallbackHandler
from dcp_ai.langchain import DCPCallback

dcp_log = DCPCallback(agent_id="agent:research-assistant-001", human_id="rpr:human-001")


class DCPHandler(BaseCallbackHandler):
    """Hands LangChain's chain events to DCPCallback."""

    # LangChain passes run_id as a UUID; DCPCallback records it as the entry's intent_id, a string
    def on_chain_start(self, serialized, inputs, *, run_id, **kwargs):
        dcp_log.on_chain_start(serialized or {}, inputs, run_id=str(run_id))

    def on_chain_end(self, outputs, *, run_id, **kwargs):
        dcp_log.on_chain_end(outputs, run_id=str(run_id))


# Fragment: chain is your LangChain chain or agent
chain.invoke({"input": "..."}, config={"callbacks": [DCPHandler()]})
entries = dcp_log.get_entries()
```

`on_chain_end` guarda os primeiros 200 caracteres das saídas como `evidence.result_ref`, que podem conter dados pessoais.

<a id="methods-2"></a>
<a id="methods_2"></a>

#### Métodos

| Método | Descrição |
|--------|-------------|
| `on_chain_start(serialized, inputs, **kwargs)` | Registra o início da cadeia |
| `on_chain_end(outputs, **kwargs)` | Registra o fim da cadeia |
| `on_lifecycle_event(event_type, details)` | Registra eventos de ciclo de vida (DCP-05) |
| `get_entries()` | Devolve a lista de entradas de auditoria |

<a id="advanced-example--agent-with-a-custom-policy-engine"></a>
<a id="advanced-example-agent-with-a-custom-policy-engine"></a>

## Exemplo avançado — agente com um motor de políticas próprio

As intenções do wrapper são sempre `api_call` de baixo impacto, então um motor de políticas decide sobre outra coisa. Aqui, um interruptor de parada controlado por uma pessoa:

```python
from datetime import datetime, timezone

from dcp_ai.langchain import DCPAgentWrapper
from dcp_ai.v2.models import PolicyDecisionV2


class StopSwitch:
    """Approves until a human stops the agent; then blocks every call."""

    def __init__(self) -> None:
        self.stopped = False

    def evaluate(self, intent):
        return PolicyDecisionV2(
            dcp_version="2.0",
            intent_id=intent.intent_id,
            session_nonce=intent.session_nonce,
            decision="block" if self.stopped else "approve",
            risk_score=1000 if self.stopped else 100,
            reasons=["stopped by a human" if self.stopped else "default-allow"],
            timestamp=datetime.now(timezone.utc).isoformat(),
        )


switch = StopSwitch()
wrapped = DCPAgentWrapper(
    agent=my_agent,  # Fragment: your LangChain agent
    passport=passport,
    rpr=rpr,
    policy_engine=switch,
)
# switch.stopped = True  ->  the next await wrapped.invoke(...) returns an error dict and does not run the agent
```

<a id="development"></a>

## Desenvolvimento

A partir de um checkout:

```bash
cd sdks/python
pip install -e ".[langchain,dev]"
pytest -v
```

<a id="dependencies"></a>

### Dependências

- `dcp-ai` — SDK do DCP (crypto, merkle, verify, models)
- `langchain` + `langchain-core` — framework de agentes

<a id="license"></a>

## Licença

Apache-2.0
