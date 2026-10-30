<sub>[English](../../../spec/DCP-03.md) · [中文](../../zh-CN/spec/DCP-03.md) · [Español](../../es/spec/DCP-03.md) · [日本語](../../ja/spec/DCP-03.md) · **Português**</sub>

<a id="dcp-03--audit-chain--transparency"></a>
<a id="dcp-03-audit-chain-transparency"></a>

# DCP-03 — Cadeia de auditoria e transparência

> Tradução informativa da [especificação em inglês](../../../spec/DCP-03.md), atualizada em 25/10/2026. **A versão normativa é a inglesa**: esta tradução não tem valor normativo e, em caso de divergência, prevalece o inglês. Identificadores e blocos de código são mantidos sem tradução.

Cada decisão e cada resultado são registrados. A cadeia de auditoria liga as entradas com um hash anterior (GENESIS para a primeira); opcionalmente, uma raiz de Merkle pode ser calculada sobre as entradas. Assim, a rastreabilidade é verificável.

<a id="normative-artifacts"></a>

## Artefatos normativos

| Artefato | Descrição | Schema |
|----------|-------------|--------|
| **AuditEntry** | Uma entrada de auditoria: prev_hash, timestamp, agent_id, human_id, intent_id, intent_hash, policy_decision (approved/escalated/blocked), outcome, evidence. | `schemas/v1/audit_entry.schema.json` |

**$id:** `https://dcp-ai.org/schemas/v1/audit_entry.schema.json`

**intent_hash:** Para cada AuditEntry, `intent_hash` deve (MUST) ser igual ao hash SHA-256 da forma JSON canônica da Intent à qual a entrada se refere. Formalmente: `intent_hash = SHA-256(canonical(intent))` (string hexadecimal). A intenção é identificada por `intent_id`; a forma canônica é a mesma usada para o hash do bundle (por exemplo, `json-stable-stringify`). Use `dcp intent-hash <intent.json>` ou o auxiliar `intentHash()` da implementação de referência para calculá-lo.

**Encadeamento (prev_hash):** A primeira entrada de auditoria deve (MUST) ter `prev_hash = "GENESIS"` (a string literal). Para a entrada no índice n (n ≥ 1), `prev_hash` deve (MUST) ser igual ao hash SHA-256 da forma JSON canônica da entrada anterior: `prev_hash = SHA-256(canonical(entry_{n-1}))` (string hexadecimal). Isso liga as entradas em uma cadeia imutável.

**Merkle (opcional):** Dado um array de `audit_entries`, uma raiz de Merkle pode ser calculada. O Signed Bundle pode incluir `signature.merkle_root` como `sha256:<hex>` ou `null`.

<a id="validation"></a>

## Validação

Valide uma entrada de auditoria:

```bash
dcp validate schemas/v1/audit_entry.schema.json <audit_entry.json>
```

Valide um bundle completo (inclui todas as audit_entries):

```bash
dcp validate-bundle <citizenship_bundle.json>
```

Obtenha a raiz de Merkle das audit_entries de um bundle:

```bash
dcp merkle-root <citizenship_bundle.json>
```

<a id="examples"></a>

## Exemplos

- [tests/conformance/examples/audit_entry.json](../../../tests/conformance/examples/audit_entry.json)
- O bundle [tests/conformance/examples/citizenship_bundle.json](../../../tests/conformance/examples/citizenship_bundle.json) inclui `audit_entries`.

A fonte da verdade para os campos e os enums é o JSON Schema; este documento é a especificação normativa que os referencia.

<a id="implementation-notes-informative"></a>

## Notas de implementação (informativas)

> **Acrescentadas em 25/10/2026. Não normativas.** Estas notas não acrescentam nenhum requisito nem mudam nada do que está acima: descrevem como
> o código de referência em `main` se relaciona com este texto. Onde divergem, prevalece o texto normativo acima.

- Este documento e os seus comandos descrevem a entrada de auditoria **V1** (`schemas/v1/audit_entry.schema.json`), cujo
  `intent_hash` e o `prev_hash` de cada entrada após a primeira são strings hexadecimais sem prefixo. No V2 (`schemas/v2/audit_entry.schema.json`, especificada no
  [DCP-AI v2.0](../../../spec/DCP-AI-v2.0.md)) eles são escritos `sha256:<hex>`; nas duas versões, o `prev_hash` da primeira entrada continua sendo o literal
  `"GENESIS"`. As entradas V2 trazem também `session_nonce`, `hash_alg` e
  `pq_checkpoint_ref`, e as entradas são comprometidas pela raiz de Merkle do manifesto em vez de serem assinadas uma a uma.
- A forma canônica usada para esses hashes é o perfil `dcp-jcs-v1`
  ([CANONICALIZATION_PROFILE.md](../../../spec/CANONICALIZATION_PROFILE.md)); `json-stable-stringify` acima é um exemplo de
  serializador com chaves ordenadas, não um perfil à parte.
- A cadeia permite detectar uma entrada alterada, removida ou reordenada; ela não torna as entradas
  impossíveis de mudar, e não diz nada sobre se o seu conteúdo é verdadeiro.
- `<audit_entry.json>` e os demais nomes entre sinais de menor e maior são marcadores de posição para os seus próprios arquivos.
