<sub>[English](../../../spec/BUNDLE.md) · [中文](../../zh-CN/spec/BUNDLE.md) · [Español](../../es/spec/BUNDLE.md) · [日本語](../../ja/spec/BUNDLE.md) · **Português**</sub>

<a id="bundle--citizenship-bundle--signed-bundle"></a>
<a id="bundle-citizenship-bundle-signed-bundle"></a>

# Bundle — Citizenship Bundle e Signed Bundle

> Tradução informativa da [especificação em inglês](../../../spec/BUNDLE.md), atualizada em 25/10/2026. **A versão normativa é a inglesa**: esta tradução não tem valor normativo e, em caso de divergência, prevalece o inglês. Identificadores e blocos de código são mantidos sem tradução.

Um agente não opera no vácuo: ele opera com uma identidade, uma intenção declarada, uma decisão de política e um registro auditável. O **Citizenship Bundle** é o pacote portátil que reúne tudo isso. O **Signed Bundle** o torna verificável criptograficamente.

<a id="citizenship-bundle-l3-bundle"></a>

## Citizenship Bundle (bundle L3)

Um Citizenship Bundle é um objeto JSON que contém exatamente:

- `responsible_principal_record` — DCP-01 (RPR)
- `agent_passport` — DCP-01 (AP)
- `intent` — DCP-02
- `policy_decision` — DCP-02
- `audit_entries` — DCP-03 (array, pelo menos um elemento)

**Schema normativo:** `schemas/v1/citizenship_bundle.schema.json`  
**$id:** `https://dcp-ai.org/schemas/v1/citizenship_bundle.schema.json`

**Validação:**

```bash
dcp validate-bundle <bundle.json>
```

Ou valide o objeto diretamente contra o schema do bundle:

```bash
dcp validate schemas/v1/citizenship_bundle.schema.json <bundle.json>
```

**Exemplo:** [tests/conformance/examples/citizenship_bundle.json](../../../tests/conformance/examples/citizenship_bundle.json)

---

## Signed Bundle

Um Signed Bundle envolve um Citizenship Bundle com uma assinatura Ed25519 e hashes determinísticos:

- `bundle` — o objeto Citizenship Bundle completo
- `signature` — objeto com:
  - `alg`: `"ed25519"`
  - `created_at`: data e hora ISO 8601
  - `signer`: `{ type: "human"|"organization", id, public_key_b64 }`
  - `bundle_hash`: `sha256:<hex>` — SHA-256 do JSON canonicalizado do bundle
  - `merkle_root`: `sha256:<hex>` ou `null` — raiz de Merkle de `audit_entries` (opcional)
  - `sig_b64`: assinatura em Base64

**Schema normativo:** `schemas/v1/signed_bundle.schema.json`  
**$id:** `https://dcp-ai.org/schemas/v1/signed_bundle.schema.json`

**Validação (schema + assinatura):**

```bash
dcp verify-bundle <bundle.signed.json> <public_key.txt>
```

**Comandos auxiliares:**

```bash
dcp bundle-hash <bundle.json>        # Prints bundle_hash (sha256:...)
dcp merkle-root <bundle.json>       # Prints merkle_root of audit_entries or null
dcp sign-bundle <bundle.json> <secret_key.txt> [out.json]
dcp keygen [out_dir]
```

**Exemplo:** [tests/conformance/examples/citizenship_bundle.signed.json](../../../tests/conformance/examples/citizenship_bundle.signed.json)

**Bundles V2** (`bundle.dcp_bundle_version: "2.0"`) usam `schemas/v2/signed_bundle.schema.json`: cada artefato é um `SignedPayload`, e a assinatura composta Ed25519 + ML-DSA-65 cobre o `manifest` do bundle. Veja a lista de verificação V2 em [VERIFICATION.md](../../../spec/VERIFICATION.md).

```bash
dcp sign-bundle --composite <bundle_v2.json> <ed25519_secret_key.txt> <ml_dsa_65_secret_key.txt> [out.json]
dcp verify-bundle [--policy <mode>] <signed_bundle_v2.json> [public_key.txt]   # key pins the classical signer
```

---

<a id="verification-checklist"></a>

## Lista de verificação

Para uma lista de verificação normativa passo a passo (schema, assinatura, expiração, revogação, intent_hash, cadeia de auditoria, Merkle, ancoragem opcional), veja [VERIFICATION.md](../../../spec/VERIFICATION.md). Todos os passos são locais; nenhuma chamada a servidor é necessária.

<a id="implementation-notes-informative"></a>

## Notas de implementação (informativas)

> **Acrescentadas em 25/10/2026. Não normativas.** Estas notas não acrescentam nenhum requisito nem mudam nada do que está acima: descrevem como
> o código de referência em `main` se relaciona com este texto. Onde divergem, prevalece o texto normativo acima.

- No V2 apenas os quatro artefatos principais (RPR, passaporte, intenção e decisão de política) são envelopes `SignedPayload`; as
  entradas de auditoria são objetos simples, comprometidos pela raiz de Merkle do manifesto e cobertos pela assinatura do bundle sobre
  o manifesto, não assinados um a um.
- Um Citizenship Bundle V1 precisa de pelo menos uma entrada de auditoria; um bundle V2 pode ter uma trilha de auditoria vazia (a sua raiz de Merkle são
  64 zeros), como o [VERIFICATION.md](../../../spec/VERIFICATION.md) permite.
- Um bundle que é verificado é coerente e assinado pelas chaves que lista; isso por si só não estabelece quem é o
  principal, não admite o bundle nem autoriza uma ação ([docs/ADMISSION.md](../../../docs/ADMISSION.md)).
- `<bundle.json>` e os demais nomes entre sinais de menor e maior são marcadores de posição para os seus próprios arquivos.
