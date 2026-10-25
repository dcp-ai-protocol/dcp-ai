<sub>[English](DCP-03.md) · [中文](DCP-03.zh-CN.md) · **Español** · [日本語](DCP-03.ja.md) · [Português](DCP-03.pt-BR.md)</sub>

<a id="dcp-03--audit-chain--transparency"></a>
<a id="dcp-03-audit-chain-transparency"></a>

# DCP-03 — Cadena de auditoría y transparencia

> Traducción informativa de [la especificación en inglés](DCP-03.md), actualizada el 25/10/2026. **La versión normativa es la inglesa**: esta traducción no tiene valor normativo y, si difieren, prevalece el inglés. Los identificadores y bloques de código se conservan sin traducir.

Cada decisión y cada resultado se registran. La cadena de auditoría enlaza las entradas con un hash anterior (GENESIS para la primera); opcionalmente puede calcularse una raíz de Merkle sobre las entradas. Así, la trazabilidad es verificable.

<a id="normative-artifacts"></a>

## Artefactos normativos

| Artefacto | Descripción | Esquema |
|----------|-------------|--------|
| **AuditEntry** | Una entrada de auditoría: prev_hash, timestamp, agent_id, human_id, intent_id, intent_hash, policy_decision (approved/escalated/blocked), outcome, evidence. | `schemas/v1/audit_entry.schema.json` |

**$id:** `https://dcp-ai.org/schemas/v1/audit_entry.schema.json`

**intent_hash:** Para cada AuditEntry, `intent_hash` debe (MUST) ser igual al hash SHA-256 de la forma JSON canónica de la Intent a la que se refiere la entrada. Formalmente: `intent_hash = SHA-256(canonical(intent))` (cadena hexadecimal). La intención se identifica por `intent_id`; la forma canónica es la misma que se usa para el hash del bundle (p. ej., `json-stable-stringify`). Usa `dcp intent-hash <intent.json>` o la ayuda `intentHash()` de la implementación de referencia para calcularlo.

**Encadenamiento (prev_hash):** La primera entrada de auditoría debe (MUST) tener `prev_hash = "GENESIS"` (la cadena literal). Para la entrada en el índice n (n ≥ 1), `prev_hash` debe (MUST) ser igual al hash SHA-256 de la forma JSON canónica de la entrada anterior: `prev_hash = SHA-256(canonical(entry_{n-1}))` (cadena hexadecimal). Esto enlaza las entradas en una cadena inmutable.

**Merkle (opcional):** Dado un array de `audit_entries`, puede calcularse una raíz de Merkle. El Signed Bundle puede incluir `signature.merkle_root` como `sha256:<hex>` o `null`.

<a id="validation"></a>

## Validación

Valida una entrada de auditoría:

```bash
dcp validate schemas/v1/audit_entry.schema.json <audit_entry.json>
```

Valida un bundle completo (incluye todas las audit_entries):

```bash
dcp validate-bundle <citizenship_bundle.json>
```

Obtén la raíz de Merkle de las audit_entries de un bundle:

```bash
dcp merkle-root <citizenship_bundle.json>
```

<a id="examples"></a>

## Ejemplos

- [tests/conformance/examples/audit_entry.json](../tests/conformance/examples/audit_entry.json)
- El bundle [tests/conformance/examples/citizenship_bundle.json](../tests/conformance/examples/citizenship_bundle.json) incluye `audit_entries`.

La fuente de verdad para los campos y los enums es el JSON Schema; este documento es la especificación normativa que los referencia.

<a id="implementation-notes-informative"></a>

## Notas de implementación (informativas)

> **Añadidas el 25/10/2026. No normativas.** Estas notas no añaden ningún requisito ni cambian nada de lo anterior: describen cómo
> se relaciona el código de referencia de `main` con este texto. Donde difieren, prevalece el texto normativo anterior.

- Este documento y sus comandos describen la entrada de auditoría **V1** (`schemas/v1/audit_entry.schema.json`), cuyo
  `intent_hash` y el `prev_hash` de cada entrada posterior a la primera son cadenas hexadecimales sin prefijo. En V2 (`schemas/v2/audit_entry.schema.json`, especificada en
  [DCP-AI v2.0](DCP-AI-v2.0.md)) se escriben `sha256:<hex>`; en ambas versiones, el `prev_hash` de la primera entrada sigue siendo el literal
  `"GENESIS"`. Las entradas V2 llevan además `session_nonce`, `hash_alg` y
  `pq_checkpoint_ref`, y las entradas se comprometen mediante la raíz de Merkle del manifiesto en lugar de firmarse una a una.
- La forma canónica usada para estos hashes es el perfil `dcp-jcs-v1`
  ([CANONICALIZATION_PROFILE.md](CANONICALIZATION_PROFILE.md)); `json-stable-stringify` arriba es un ejemplo de
  serializador con claves ordenadas, no un perfil distinto.
- La cadena permite detectar una entrada alterada, eliminada o reordenada; no hace que las entradas
  sean imposibles de cambiar, y no dice nada sobre si su contenido es verdadero.
- `<audit_entry.json>` y los demás nombres entre ángulos son marcadores de posición para tus propios archivos.
