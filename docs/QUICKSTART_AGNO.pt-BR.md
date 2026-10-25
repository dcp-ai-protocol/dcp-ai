<sub>[English](QUICKSTART_AGNO.md) · [中文](QUICKSTART_AGNO.zh-CN.md) · [Español](QUICKSTART_AGNO.es.md) · [日本語](QUICKSTART_AGNO.ja.md) · **Português**</sub>

<a id="quickstart-agno--dcp-ai"></a>
<a id="quickstart-agno-dcp-ai"></a>

# Início rápido: Agno + DCP-AI

> Tradução informativa da [versão em inglês](QUICKSTART_AGNO.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

[Agno](https://www.agno.com/) é um framework e runtime Python para construir agentes de IA. A integração [`agno-dcp`](https://github.com/dcp-ai-protocol/agno-dcp) envolve as primitivas `Agent`, `Team`, `Workflow` e MCP do Agno com uma governança modelada no DCP-01 a DCP-04: um registro de identidade do agente assinado, decisões de política assinadas, uma cadeia de auditoria encadeada por hashes com checkpoints de raiz assinados e mensagens MCP assinadas.

> **▸ Veja funcionando:** [agno-dcp-demo.fly.dev](https://agno-dcp-demo.fly.dev) — um fluxo de cobrança bancária com cenários de um clique, um log de auditoria ao vivo via Server-Sent Events e exportação de um Compliance Bundle assinado. Código-fonte: [`dcp-ai-protocol/agno-dcp-demo`](https://github.com/dcp-ai-protocol/agno-dcp-demo).

Diferentemente das outras integrações Python (`dcp-ai[fastapi]`, `dcp-ai[langchain]`, ...), o `agno-dcp` é distribuído como um **pacote separado** porque depende do Agno como dependência par. Ele requer `dcp-ai>=2.8.1` e assina com o `sign_object` Ed25519 desse SDK (canonicalização `dcp-jcs-v1`), então cada assinatura que ele faz pode ser conferida com `verify_object` em qualquer SDK do DCP-AI.

> **O que o `agno-dcp` 0.1.0 produz (verificado contra o código-fonte em 25/10/2026).**
>
> * Seus registros (o registro de identidade `CitizenshipBundle`, as entradas e raízes de auditoria, o ZIP de conformidade) são formatos do `agno-dcp`. **Não** são bundles assinados DCP V1 ou V2, então `dcp verify-bundle` e `verifySignedBundleV2` não os aceitam. Para produzir bundles normativos, use os inícios rápidos dos SDKs ([QUICKSTART.md](QUICKSTART.md)).
> * Suas assinaturas (registro de identidade, intenções, decisões de política, mensagens MCP, raízes seladas, manifesto de conformidade) usam somente Ed25519, seja qual for o `dcp_security_tier`. `tier-3` e `tier-4` são registrados, mas o código 0.1.0 não faz nenhuma assinatura ML-DSA-65, embora o README dele descreva um híbrido Ed25519 + ML-DSA-65. As entradas de auditoria não são assinadas uma a uma: são encadeadas por hashes, e só as raízes seladas levam assinatura.

O código-fonte completo, as notas de projeto de ponta a ponta e a referência da API ficam no repositório dedicado: <https://github.com/dcp-ai-protocol/agno-dcp>. Esta página é uma porta de entrada de 60 segundos.

---

<a id="install"></a>

## Instalação

> **Estado do pacote (25/10/2026).** O PyPI tem uma única versão do `agno-dcp`, a 0.1.0. É uma versão de **acesso antecipado**: o README dela diz que ainda não é recomendada para implantações em produção que lidam com dados regulados. Os exemplos desta página foram conferidos estaticamente contra o código-fonte da 0.1.0 (nomes exportados, argumentos nomeados, opções da CLI). Eles não foram executados aqui, porque executá-los exige o Agno e um provedor de modelos.

```bash
pip install agno-dcp
```

Para produção com armazenamento baseado em Postgres:

```bash
pip install "agno-dcp[postgres]"
```

Requer Python 3.11+. O Agno é uma dependência par; instale à parte a versão do Agno que preferir.

---

<a id="wrap-an-agno-agent"></a>

## Envolver um agente do Agno

Isto é um fragmento: `crm_lookup` e `payment_plan_offer` são suas próprias funções de ferramenta do Agno, e `model` é passado ao Agno sem alterações, então informe um modelo que a sua versão do Agno aceite.

```python
import asyncio

from agno_dcp import (
    DCPAgent,
    PolicyEngine,
    MerkleAuditChain,
    SQLiteStorage,
)


async def main() -> None:
    # 1. Storage and audit chain (DCP-03)
    storage = SQLiteStorage("./agent.db")
    audit = MerkleAuditChain(storage=storage)

    # 2. Policy engine from a YAML file (DCP-02)
    policy = PolicyEngine.from_yaml("policies.yaml")

    # 3. Wrap an Agno Agent
    agent = DCPAgent(
        # Native Agno arguments (forwarded as-is)
        name="Collections Agent",
        model="claude:sonnet-4",
        tools=[crm_lookup, payment_plan_offer],
        instructions="You help customers reschedule overdue invoices.",
        # DCP-AI governance arguments
        dcp_human_principal="ops@example.com",
        dcp_security_tier="tier-3",
        dcp_audit_chain=audit,
        dcp_policy_engine=policy,
        dcp_strict_mode=True,
    )
    await agent.dcp_initialize()

    # 4. Run a tool through the full DCP-AI pipeline:
    #    intent + policy gate + tool execution + audit
    result = await agent.run_tool(
        crm_lookup,
        {"customer_id": 12345},
    )

    # 5. Periodically seal a signed root checkpoint
    root = await audit.seal_root()
    print(f"Sealed Merkle root: {root.root_hash}, entries: {root.entry_count}")


asyncio.run(main())
```

O `policies.yaml` correspondente:

```yaml
version: "1.0"
default: deny
rules:
  - name: "Allow CRM lookups"
    when:
      action_type: tool_call
      tool_name: crm_lookup
    then: allow

  - name: "Limit payment discounts"
    when:
      action_type: tool_call
      tool_name: payment_plan_offer
      payload.discount_pct:
        gt: 20
    then: deny
    reason: "Discounts above 20% require human approval"
```

O comparador aceita caminhos com pontos (`payload.discount_pct`) e os operadores `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `nin`. Vale a primeira regra que corresponder; se nenhuma corresponder, aplica-se o veredito `default`.

---

<a id="what-run_tool-does-under-the-hood"></a>

## O que `run_tool` faz por baixo dos panos

```
DCPAgent.run_tool(tool, args)
  ├── 1. Build and sign IntentDeclaration with the agent's keypair
  ├── 2. PolicyGate.evaluate
  │      ├── verify intent signature
  │      ├── PolicyEngine.evaluate -> signed PolicyDecision
  │      ├── persist intent + decision
  │      └── append INTENT_DECLARED + POLICY_DECISION audit events
  ├── 3. If deny + strict_mode -> raise PolicyDenied
  ├── 4. Execute tool (sync or async)
  ├── 5. Append TOOL_EXECUTED (or ERROR) audit event
  └── 6. Return tool result
```

Modo estrito versus modo de observação:

* `dcp_strict_mode=True`: um veredito de negação lança `PolicyDenied` e a ferramenta não roda.
* `dcp_strict_mode=False` (padrão): a negação é registrada e auditada, mas a ferramenta roda mesmo assim. Útil na integração inicial, quando você quer trilhas de auditoria antes de ter cobertura de políticas.

---

<a id="teams-and-workflows"></a>

## Equipes e fluxos de trabalho

Um fragmento que continua dentro da função `async` acima (`collections_agent`, `risk_agent` e `evaluate_credit_fn` são seus):

```python
from agno_dcp import DCPTeam, DCPWorkflow

team = DCPTeam(
    dcp_team_name="Collections + Risk",
    dcp_human_principal="ops@example.com",
    members=[collections_agent, risk_agent],
    dcp_audit_chain=audit,  # shared chain across the team
)
await team.dcp_initialize()

workflow = DCPWorkflow(
    dcp_workflow_id="escalation",
    dcp_human_principal="ops@example.com",
    dcp_audit_chain=audit,
    dcp_strict_mode=True,
)
await workflow.dcp_initialize()
result = await workflow.run_step("evaluate_credit", evaluate_credit_fn, {"amount": 5000})
```

Um `DCPTeam` faz com que seus membros `DCPAgent` gravem na cadeia de auditoria da equipe. Um `DCPWorkflow` usa a cadeia que você passar como `dcp_audit_chain`; sem ela, inicia a própria cadeia em memória. Passar a mesma cadeia aos dois dá a um auditor uma única ordenação das ações dos agentes e da coordenação da equipe.

---

<a id="verify-an-audit-chain-offline"></a>

## Verificar uma cadeia de auditoria offline

```bash
agno-dcp verify --sqlite ./agent.db
agno-dcp verify --postgres-url $DATABASE_URL --agent-id agent:abc123 --range 0:1000
```

A CLI recalcula cada `entry_hash`, confere o encadeamento `prev_hash` e confere a assinatura da raiz selada **mais recente** com a chave pública armazenada nessa raiz. Ela termina com código diferente de zero quando a cadeia de hashes se rompe ou essa assinatura é inválida.

Um código de saída 0 não é uma verificação completa das raízes na 0.1.0:

* só a raiz mais recente é examinada;
* um registro de raiz que não pode ser analisado é listado em `notes` e ignorado, e o código de saída ignora `notes`, então leia-as (ou use `--json`);
* a raiz não é comparada com as entradas, e a chave dela não é comparada com uma em que você confia. Assim, alguém que possa gravar no banco de dados pode reescrever entradas, recalcular os hashes e selar uma raiz nova com uma chave nova, e a verificação continua passando. Guarde a chave pública do assinante da auditoria e as raízes seladas fora do banco de dados, e compare-as você mesmo.

---

<a id="compliance-bundle-export"></a>

## Exportação do bundle de conformidade

Para entregar a um auditor, envie um ZIP assinado:

```python
from pathlib import Path
from agno_dcp import ComplianceBundleExporter

exporter = ComplianceBundleExporter(audit, storage)
zip_path = await exporter.export(
    framework="eu_ai_act",   # or "nist_ai_rmf"
    output_dir=Path("./bundles"),
)
```

O arquivo contém o log de auditoria na ordem do índice, todas as raízes de Merkle seladas, os Citizenship Bundles relevantes e o mapeamento para o marco (artigos 12, 13, 14, 15 e 50 do Regulamento de IA da UE, ou subcategorias Govern/Map/Measure/Manage do NIST AI RMF). O `manifest.json` dele traz um hash do conteúdo do arquivo e é assinado com a chave da cadeia de auditoria, de modo que um auditor pode detectar alterações feitas entre a exportação e a revisão.

---

<a id="production-deployment"></a>

## Implantação em produção

Troque `SQLiteStorage` por `PostgresStorage` e o código da aplicação continua idêntico:

```python
import os

from agno_dcp import PostgresStorage  # requires the [postgres] extra

# For example postgresql+psycopg://host/db, with credentials kept out of the code.
storage = PostgresStorage(os.environ["DATABASE_URL"])
await storage.initialize()
audit = MerkleAuditChain(storage=storage)
```

`PostgresStorage` é carregado no primeiro uso, então não consta em `agno_dcp.__all__`, mas `from agno_dcp import PostgresStorage` funciona depois que o extra é instalado. O esquema idempotente incluído (`agno_dcp/storage/schema.sql`) reutiliza o mesmo banco de dados que hospeda as tabelas próprias do Agno; o prefixo `dcp_*` em cada tabela evita colisões.

---

## Status

`agno-dcp v0.1.0` (abril de 2026) é uma versão de **acesso antecipado**, adequada para avaliação, demonstrações e pilotos internos. Seu contrato público é a lista em `agno_dcp/__init__.py`. O README do projeto lista DCP-05 a DCP-09 (ciclo de vida, sucessão, disputas, direitos, delegação) e a custódia de chaves baseada em hardware (AWS KMS, GCP Cloud KMS) como trabalho futuro.

Status do pacote nos registros:

* PyPI: <https://pypi.org/project/agno-dcp/>
* Código-fonte: <https://github.com/dcp-ai-protocol/agno-dcp>
* Status da CI: visível na aba GitHub Actions do repositório.

---

<a id="further-reading"></a>

## Leituras adicionais

* [README do agno-dcp](https://github.com/dcp-ai-protocol/agno-dcp#readme) para o início rápido completo e a tabela comparativa.
* [`docs/why.md` do agno-dcp](https://github.com/dcp-ai-protocol/agno-dcp/blob/main/docs/why.md) para a proposta (quando adotá-lo e quando não).
* [`docs/architecture.md` do agno-dcp](https://github.com/dcp-ai-protocol/agno-dcp/blob/main/docs/architecture.md) para o diagrama em camadas e a semântica dos hooks.
* [`docs/compliance_mapping.md` do agno-dcp](https://github.com/dcp-ai-protocol/agno-dcp/blob/main/docs/compliance_mapping.md) para os mapeamentos para o Regulamento de IA da UE e o NIST AI RMF.
* [Especificação DCP-AI v2.0](../spec/DCP-AI-v2.0.md) como referência normativa no nível do protocolo.
