<sub>[English](../../../spec/DCP-02.md) · [中文](../../zh-CN/spec/DCP-02.md) · **Español** · [日本語](../../ja/spec/DCP-02.md) · [Português](../../pt-BR/spec/DCP-02.md)</sub>

<a id="dcp-02--intent-declaration--policy-gating"></a>
<a id="dcp-02-intent-declaration-policy-gating"></a>

# DCP-02 — Declaración de intención y control por política

> Traducción informativa de [la especificación en inglés](../../../spec/DCP-02.md), actualizada el 25/10/2026. **La versión normativa es la inglesa**: esta traducción no tiene valor normativo y, si difieren, prevalece el inglés. Los identificadores y bloques de código se conservan sin traducir.

Ninguna acción silenciosa. Un agente declara lo que pretende hacer antes de hacerlo; una capa de política decide si aprobar, escalar o bloquear. DCP-02 define la intención declarada y la decisión de política.

<a id="normative-artifacts"></a>

## Artefactos normativos

| Artefacto | Descripción | Esquema |
|----------|-------------|--------|
| **Intent** | Declaración de intención: agente, persona, acción, canal, clases de datos, impacto estimado. | `schemas/v1/intent.schema.json` |
| **PolicyDecision** | Decisión sobre una intención: approve / escalate / block, puntuación de riesgo, motivos. Opcional: exigir confirmación humana. | `schemas/v1/policy_decision.schema.json` |
| **HumanConfirmation** | (Opcional) Confirmación humana explícita sobre una intención: aprobar o denegar. | `schemas/v1/human_confirmation.schema.json` |

**$id** de los esquemas: `https://dcp-ai.org/schemas/v1/<name>.schema.json`

<a id="validation"></a>

## Validación

Valida un objeto contra su esquema:

```bash
dcp validate schemas/v1/intent.schema.json <intent.json>
dcp validate schemas/v1/policy_decision.schema.json <policy_decision.json>
dcp validate schemas/v1/human_confirmation.schema.json <human_confirmation.json>
```

Un Citizenship Bundle incluye Intent y PolicyDecision; valídalo con:

```bash
dcp validate-bundle <citizenship_bundle.json>
```

<a id="examples"></a>

## Ejemplos

- [tests/conformance/examples/intent.json](../../../tests/conformance/examples/intent.json)
- [tests/conformance/examples/policy_decision.json](../../../tests/conformance/examples/policy_decision.json)
- [tests/conformance/examples/human_confirmation.json](../../../tests/conformance/examples/human_confirmation.json)

La fuente de verdad para los campos y los enums es el JSON Schema; este documento es la especificación normativa que los referencia.

<a id="implementation-notes-informative"></a>

## Notas de implementación (informativas)

> **Añadidas el 25/10/2026. No normativas.** Estas notas no añaden ningún requisito ni cambian nada de lo anterior: describen cómo
> se relaciona el código de referencia de `main` con este texto. Donde difieren, prevalece el texto normativo anterior.

- Este documento y sus comandos describen los artefactos **V1** (`schemas/v1/`). Sus equivalentes V2
  (`schemas/v2/intent.schema.json`, `policy_decision.schema.json`, `human_confirmation.schema.json`) añaden, entre
  otros, `session_nonce` y `requires_consent` a la intención, y `session_nonce`, `applied_policy_hash`,
  `required_confirmation` y `timestamp` a la decisión de política; se especifican en
  [DCP-AI v2.0](../../../spec/DCP-AI-v2.0.md).
- `<intent.json>` y los demás nombres entre ángulos son marcadores de posición para tus propios archivos.
- Una decisión de política es un registro de lo que decidió una capa de política. Verificar un bundle comprueba que es coherente y
  está firmado; no aplica la decisión, y los verificadores de referencia no rechazan un bundle porque su decisión sea
  `block`. Aplicarla antes de la acción es tarea de la aplicación.
