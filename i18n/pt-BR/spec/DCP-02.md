<sub>[English](../../../spec/DCP-02.md) · [中文](../../zh-CN/spec/DCP-02.md) · [Español](../../es/spec/DCP-02.md) · [日本語](../../ja/spec/DCP-02.md) · **Português**</sub>

<a id="dcp-02--intent-declaration--policy-gating"></a>
<a id="dcp-02-intent-declaration-policy-gating"></a>

# DCP-02 — Declaração de intenção e controle por política

> Tradução informativa da [especificação em inglês](../../../spec/DCP-02.md), atualizada em 25/10/2026. **A versão normativa é a inglesa**: esta tradução não tem valor normativo e, em caso de divergência, prevalece o inglês. Identificadores e blocos de código são mantidos sem tradução.

Nenhuma ação silenciosa. Um agente declara o que pretende fazer antes de fazê-lo; uma camada de política decide se aprova, escala ou bloqueia. O DCP-02 define a intenção declarada e a decisão de política.

<a id="normative-artifacts"></a>

## Artefatos normativos

| Artefato | Descrição | Schema |
|----------|-------------|--------|
| **Intent** | Declaração de intenção: agente, pessoa, ação, canal, classes de dados, impacto estimado. | `schemas/v1/intent.schema.json` |
| **PolicyDecision** | Decisão sobre uma intenção: approve / escalate / block, pontuação de risco, motivos. Opcional: exigir confirmação humana. | `schemas/v1/policy_decision.schema.json` |
| **HumanConfirmation** | (Opcional) Confirmação humana explícita sobre uma intenção: aprovar ou negar. | `schemas/v1/human_confirmation.schema.json` |

**$id** dos schemas: `https://dcp-ai.org/schemas/v1/<name>.schema.json`

<a id="validation"></a>

## Validação

Valide um objeto contra o seu schema:

```bash
dcp validate schemas/v1/intent.schema.json <intent.json>
dcp validate schemas/v1/policy_decision.schema.json <policy_decision.json>
dcp validate schemas/v1/human_confirmation.schema.json <human_confirmation.json>
```

Um Citizenship Bundle inclui Intent e PolicyDecision; valide-o com:

```bash
dcp validate-bundle <citizenship_bundle.json>
```

<a id="examples"></a>

## Exemplos

- [tests/conformance/examples/intent.json](../../../tests/conformance/examples/intent.json)
- [tests/conformance/examples/policy_decision.json](../../../tests/conformance/examples/policy_decision.json)
- [tests/conformance/examples/human_confirmation.json](../../../tests/conformance/examples/human_confirmation.json)

A fonte da verdade para os campos e os enums é o JSON Schema; este documento é a especificação normativa que os referencia.

<a id="implementation-notes-informative"></a>

## Notas de implementação (informativas)

> **Acrescentadas em 25/10/2026. Não normativas.** Estas notas não acrescentam nenhum requisito nem mudam nada do que está acima: descrevem como
> o código de referência em `main` se relaciona com este texto. Onde divergem, prevalece o texto normativo acima.

- Este documento e os seus comandos descrevem os artefatos **V1** (`schemas/v1/`). Os seus equivalentes V2
  (`schemas/v2/intent.schema.json`, `policy_decision.schema.json`, `human_confirmation.schema.json`) acrescentam, entre
  outros, `session_nonce` e `requires_consent` à intenção, e `session_nonce`, `applied_policy_hash`,
  `required_confirmation` e `timestamp` à decisão de política; eles são especificados no
  [DCP-AI v2.0](../../../spec/DCP-AI-v2.0.md).
- `<intent.json>` e os demais nomes entre sinais de menor e maior são marcadores de posição para os seus próprios arquivos.
- Uma decisão de política é um registro do que uma camada de política decidiu. Verificar um bundle confere que ele é coerente e
  assinado; não aplica a decisão, e os verificadores de referência não recusam um bundle porque a sua decisão é
  `block`. Aplicá-la antes da ação é tarefa da aplicação.
