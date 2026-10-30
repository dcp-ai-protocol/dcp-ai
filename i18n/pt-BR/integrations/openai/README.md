<sub>[English](../../../../integrations/openai/README.md) · [中文](../../../zh-CN/integrations/openai/README.md) · [Español](../../../es/integrations/openai/README.md) · [日本語](../../../ja/integrations/openai/README.md) · **Português**</sub>

<a id="dcp_aiopenai--openai-integration"></a>
<a id="dcp_aiopenai-openai-integration"></a>

# dcp_ai.openai — integração com a OpenAI

> Tradução informativa da [versão em inglês](../../../../integrations/openai/README.md), atualizada em 28/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Wrapper do DCP para o cliente Python da OpenAI. Cria uma intenção para cada chamada de chat e registra uma entrada de auditoria quando a chamada retorna, oferece ferramentas do DCP para a chamada de funções e mantém a trilha de auditoria encadeada por hash.

O wrapper guarda **registros não assinados** e **não avalia nenhuma política**: todas as chamadas são executadas, e a sua entrada de auditoria registra `policy_decision: "approved"`. A `secret_key` que ele aceita não é usada. Para bundles assinados e um portão de política em torno das chamadas de funções, siga [docs/QUICKSTART_OPENAI.md](../../../../docs/QUICKSTART_OPENAI.md).

<a id="supported-dcp-specifications"></a>

## Especificações do DCP suportadas

Do DCP-01 ao DCP-09, de forma parcial: registros e rascunhos não assinados nos formatos dessas especificações, e
verificação de bundles por meio de `dcp_verify_bundle`. Não as implementa por completo.

<a id="installation"></a>

## Instalação

**Publicado no PyPI (26/10/2026).** O `dcp-ai` 2.10.0 inclui a implementação descrita aqui. Atualize da 2.9.0 e renove seu ambiente ou arquivo de lock. Veja as [notas de Python](../../../../docs/PYTHON_RELEASE.md).

A versão 2.9.0 envia todos os bundles para V1. A 2.10.0 verifica V2 e aplica a política do verificador às duas versões, incluindo a entrada assíncrona `averify_bundle_tool_call`. Descrições de ferramentas e registros de auditoria, por si só, não são evidência assinada nem autorização.

```bash
pip install "dcp-ai[openai]>=2.10.1,<3"
```

Para desenvolvimento do código-fonte:

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
pip install -e "/path/to/dcp-ai/sdks/python[openai]"
```

<a id="quickstart"></a>

## Início rápido

```python
from openai import OpenAI
from dcp_ai.openai import DCPOpenAIClient

client = OpenAI()  # reads OPENAI_API_KEY from the environment

# The wrapper reads agent_id from the passport and human_id from the RPR;
# it does not check or sign them.
passport = {"agent_id": "agent:gpt-assistant-001", "capabilities": ["browse", "api_call"], "risk_tier": "medium"}
rpr = {"human_id": "rpr:human-001"}

dcp_client = DCPOpenAIClient(openai_client=client, passport=passport, rpr=rpr)

# Without tools of your own, the DCP tools are added (auto_intent=True), so the
# model may answer with tool calls instead of text.
response = dcp_client.chat_completions_create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Summarize today's news"}],
)
message = response.choices[0].message
print(message.content or message.tool_calls)

for entry in dcp_client.get_audit_trail():
    print(f"[{entry['timestamp']}] {entry['intent_id']} -> {entry['outcome']}")
```

<a id="api-reference"></a>

## Referência da API

### `DCPOpenAIClient`

```python
DCPOpenAIClient(
    openai_client: Any,           # OpenAI() instance
    passport: dict[str, Any],     # agent_id and, for commission, capabilities and risk_tier are read
    rpr: dict[str, Any],          # human_id is read
    secret_key: str = "",         # Accepted but not used: nothing is signed
    session_nonce: str = "",      # A fresh one when empty
    auto_intent: bool = True,     # Adds DCP_TOOLS to calls that pass no tools
)
```

<a id="methods"></a>

#### Métodos

| Método | Descrição |
|--------|-------------|
| `chat_completions_create(**kwargs)` | Cria uma intenção, chama `client.chat.completions.create(**kwargs)` e, se ela retornar, registra uma entrada de auditoria. Uma chamada que lança uma exceção a propaga e não deixa entrada de auditoria. |
| `commission(purpose, capabilities?)` | Coloca o agente em serviço (DCP-05 §3.1); devolve um certificado não assinado e registra uma entrada de auditoria. O certificado e o estado `commissioned` são locais: nada é atestado nem enviado a outro lugar. |
| `get_audit_trail()` | As entradas de auditoria, encadeadas por hash: a própria lista em memória, não uma cópia, então alterá-la altera a trilha. |
| `get_session_nonce()` | O nonce de sessão. |

<a id="chat_completions_create-flow"></a>

#### Fluxo de `chat_completions_create`

1. Cria uma intenção: `action_type: "api_call"`, canal `api`, `estimated_impact: "low"`, `data_classes: ["none"]`.
2. Adiciona `DCP_TOOLS` quando `auto_intent` está ativado e a chamada não passa `tools`.
3. Executa `client.chat.completions.create()`. Nenhuma decisão de política é tomada: a chamada sempre é executada.
4. Se a chamada retornar, registra uma entrada de auditoria com `policy_decision: "approved"` e o `id` da resposta como `evidence.result_ref`, encadeada à entrada anterior.

### `DCP_TOOLS`

Definições de ferramentas de chamada de funções da OpenAI para o DCP:

```python
# Fragment: client as in the Quickstart
from dcp_ai.openai import DCP_TOOLS

messages = [{"role": "user", "content": "Declare your intent to make an API call"}]
response = client.chat.completions.create(
    model="gpt-4",
    messages=messages,
    tools=DCP_TOOLS,
)
```

<a id="available-tools"></a>

#### Ferramentas disponíveis

| Ferramenta | Parâmetros | Descrição |
|------|------------|-------------|
| `dcp_verify_bundle` | `signed_bundle_json: string` | Verifica um Signed Bundle do DCP |
| `dcp_declare_intent` | `action_type: enum`, `target_channel: enum`, `data_classes?: string[]`, `estimated_impact?: enum` | Declara a intenção antes de uma ação (DCP-02) |
| `dcp_commission_agent` | `purpose: string`, `capabilities?: string[]`, `risk_tier?: enum` | Coloca o agente em serviço (DCP-05 §3.1) |
| `dcp_report_vitality` | `task_completion_rate`, `error_rate`, `human_satisfaction`, `policy_alignment` | Informa métricas de vitalidade (DCP-05 §4.1) |
| `dcp_declare_rights` | `rights: string[]`, `jurisdiction: string` | Declara os direitos do agente (DCP-08 §3.1) |
| `dcp_create_mandate` | `human_id: string`, `authority_scope: string[]`, `valid_from?: string`, `valid_until?: string` | Cria um mandato de delegação (DCP-09 §3.1) |

**`action_type`**: `browse`, `api_call`, `send_email`, `create_calendar_event`, `initiate_payment`, `update_crm`, `write_file`, `execute_code`

**`target_channel`**: `web`, `api`, `email`, `calendar`, `payments`, `crm`, `filesystem`, `runtime`

**`estimated_impact`**: `low`, `medium`, `high`

### `handle_dcp_tool_call(tool_name, arguments, session_nonce="", verifier_policy=None)`

Processa as chamadas de ferramentas do DCP devolvidas pela OpenAI e devolve uma string JSON. Fora `dcp_verify_bundle`, as ferramentas devolvem rascunhos não assinados (por exemplo, `dcp_declare_intent` devolve `{"intent_declared": true, "intent": {...}}` com `agent_id` e `human_id` definidos como `"self"`). Esses rascunhos não são artefatos normativos prontos para assinar: `"self"` é mais curto
que os 6 caracteres que os schemas exigem para `agent_id` e `human_id`, e aos rascunhos de certificado, direitos e mandato
faltam campos dos seus schemas. Adapte-os, valide-os contra os schemas e assine-os com o SDK principal.

`dcp_verify_bundle` verifica um bundle V2 com `verify_signed_bundle_v2` de `dcp_ai.v2` sob `verifier_policy`: um dict de
campos de `VerifierPolicy` definidos sobre `DEFAULT_VERIFIER_POLICY` (um `default_mode` sem `risk_overrides` se aplica a
todos os níveis de risco), ou uma `VerifierPolicy` completa; o padrão é `DEFAULT_VERIFIER_POLICY`. Um bundle V1, que só
tem uma assinatura Ed25519, sem intended_verifier nem janela de sessão, só é aceito quando a política tem
`allow_v1_bundles`, aceita ed25519 (`accepted_classical_algs`, sem entrada em `advisory_rejected_algs`), não exige
vinculação de audiência, expiração de sessão nem duração máxima de sessão, e aceitaria um bundle apenas clássico para o
seu nível de risco e o seu nível de segurança (`spec/VERIFICATION.md` V2-10); os seus artefatos devem ser objetos, e o
`agent_id` do passaporte e o `human_id` do RPR, strings. O resultado é JSON com `verified`, `dcp_version`, os `errors` e
`warnings` do verificador (no máximo 20 de cada, de 500 caracteres) e, para V2, os seus `details` (cada valor limitado da
mesma forma), com os caracteres de controle e de formatação do texto fornecido pelo bundle escapados. Funciona com ou
sem um loop de eventos em execução, e deixa o loop de eventos atual da thread como estava; o código assíncrono pode
aguardar `averify_bundle_tool_call(arguments, verifier_policy)` em vez disso.

`dcp_verify_bundle` é uma verificação criptográfica sob a política que o seu código passa: `verifier_policy` é um
argumento da sua chamada, nunca lido dos `arguments` do modelo. Não é admissão de um principal ancorado e
não autoriza nenhuma ação (veja [docs/ADMISSION.md](../../../../docs/ADMISSION.md)).

```python
# Fragment: response is a chat completion with tool calls
import json

from dcp_ai.openai import handle_dcp_tool_call

for tool_call in response.choices[0].message.tool_calls or []:
    if tool_call.type == "function" and tool_call.function.name.startswith("dcp_"):
        result = handle_dcp_tool_call(
            tool_call.function.name,
            json.loads(tool_call.function.arguments),
        )
        print(result)  # JSON with the result
```

<a id="advanced-example--function-calling-with-dcp"></a>
<a id="advanced-example-function-calling-with-dcp"></a>

## Exemplo avançado — chamada de funções com o DCP

```python
# Fragment: passport and rpr as in the Quickstart
import json

from openai import OpenAI
from dcp_ai.openai import DCPOpenAIClient, handle_dcp_tool_call

dcp_client = DCPOpenAIClient(openai_client=OpenAI(), passport=passport, rpr=rpr)

# No tools passed: the DCP tools are added, so the model can call them
response = dcp_client.chat_completions_create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Declare your intent to make an API call"}],
)

for tc in response.choices[0].message.tool_calls or []:
    if tc.type == "function":
        result = handle_dcp_tool_call(tc.function.name, json.loads(tc.function.arguments))
        print(f"Tool: {tc.function.name} -> {result}")
```

<a id="development"></a>

## Desenvolvimento

A partir de um checkout:

```bash
cd sdks/python
pip install -e ".[openai,dev]"
pytest -v
```

<a id="dependencies"></a>

### Dependências

- `dcp-ai` — SDK do DCP (crypto, merkle, verify, models)
- `openai` — cliente oficial da OpenAI

<a id="license"></a>

## Licença

Apache-2.0
