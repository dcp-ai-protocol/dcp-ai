<sub>[English](DCP-01.md) · [中文](DCP-01.zh-CN.md) · [Español](DCP-01.es.md) · [日本語](DCP-01.ja.md) · **Português**</sub>

<a id="dcp-01--identity--principal-binding"></a>
<a id="dcp-01-identity-principal-binding"></a>

# DCP-01 — Identidade e vinculação ao principal

> Tradução informativa da [especificação em inglês](DCP-01.md), atualizada em 25/10/2026. **A versão normativa é a inglesa**: esta tradução não tem valor normativo e, em caso de divergência, prevalece o inglês. Identificadores e blocos de código são mantidos sem tradução.

As pessoas vêm antes dos agentes. Nenhum agente existe sem uma vinculação explícita a uma pessoa ou entidade jurídica que assume a responsabilidade. O DCP-01 define os artefatos que vinculam a identidade do agente à identidade humana.

<a id="normative-artifacts"></a>

## Artefatos normativos

| Artefato | Descrição | Schema |
|----------|-------------|--------|
| **Responsible Principal Record (RPR)** | Registro que declara quem é a pessoa ou organização, a jurisdição, o modo de responsabilidade e a validade. | `schemas/v1/responsible_principal_record.schema.json` |
| **Agent Passport (AP)** | Passaporte do agente: identidade, chave pública, referência ao RPR, estado (active/revoked/suspended). | `schemas/v1/agent_passport.schema.json` |
| **Revocation Record** | Registro da revogação de um agente: quem revoga, quando e por quê. | `schemas/v1/revocation_record.schema.json` |

**$id** dos schemas: `https://dcp-ai.org/schemas/v1/<name>.schema.json`

<a id="validation"></a>

## Validação

Valide um objeto contra o seu schema:

```bash
dcp validate schemas/v1/responsible_principal_record.schema.json <hbr.json>
dcp validate schemas/v1/agent_passport.schema.json <ap.json>
dcp validate schemas/v1/revocation_record.schema.json <revocation.json>
```

Um Citizenship Bundle (que inclui o RPR e o AP) é validado com:

```bash
dcp validate-bundle <citizenship_bundle.json>
```

<a id="examples"></a>

## Exemplos

- [tests/conformance/examples/responsible_principal_record.json](../tests/conformance/examples/responsible_principal_record.json)
- [tests/conformance/examples/agent_passport.json](../tests/conformance/examples/agent_passport.json)

A fonte da verdade para os campos e os enums é o JSON Schema; este documento é a especificação normativa que os referencia.

---

<a id="jurisdiction-attestation-optional"></a>

## Atestação de jurisdição (opcional)

Uma **atestação de jurisdição** é um objeto opcional que certifica que o Responsible Principal Record de um agente é válido em uma jurisdição específica. Ela é produzida por uma autoridade da jurisdição (governo, órgão regulador ou emissor credenciado) e pode ser incluída no Signed Bundle ou apresentada junto com ele.

<a id="object-format"></a>

### Formato do objeto

```json
{
  "type": "jurisdiction_attestation",
  "issuer": "authority-us-ai-registry",
  "jurisdiction": "US",
  "rpr_hash": "sha256:<hex>",
  "agent_id": "agent-uuid-here",
  "attested_at": "2026-02-07T00:00:00Z",
  "expires_at": "2027-02-07T00:00:00Z",
  "signature": {
    "alg": "ed25519",
    "public_key_b64": "...",
    "sig_b64": "..."
  }
}
```

<a id="fields"></a>

### Campos

| Campo | Tipo | Descrição |
|-------|------|-------------|
| `type` | string | Sempre `"jurisdiction_attestation"`. |
| `issuer` | string | Identificador da autoridade emissora. |
| `jurisdiction` | string | Código de país ISO 3166-1 alfa-2 (por exemplo, `"US"`, `"EU"`, `"JP"`). |
| `rpr_hash` | string | `sha256:<hex>` — SHA-256 do JSON canônico do Responsible Principal Record atestado. |
| `agent_id` | string | O agent_id do Agent Passport. |
| `attested_at` | string | Data e hora ISO 8601 em que a atestação foi emitida. |
| `expires_at` | string ou null | Data e hora ISO 8601 em que a atestação expira; `null` se não expira. |
| `signature` | object | Assinatura Ed25519 sobre o JSON canônico de todos os campos exceto o próprio `signature`. `alg`, `public_key_b64`, `sig_b64`. |

<a id="how-it-works"></a>

### Como funciona

1. O criador do agente (ou quem o detém) calcula `rpr_hash` = SHA-256(canonical(responsible_principal_record)).
2. O criador envia `rpr_hash` + `agent_id` ao serviço de atestação da jurisdição (ou a um processo presencial ou offline).
3. A autoridade verifica o RPR (identidade, jurisdição, validade) e assina a atestação.
4. A atestação é devolvida a quem detém o agente e guardada junto ao Signed Bundle ou dentro dele.

<a id="verification"></a>

### Verificação

Um verificador confere a atestação:

1. Calculando `rpr_hash` a partir do `responsible_principal_record` do bundle e comparando-o com o `rpr_hash` da atestação.
2. Verificando a assinatura Ed25519 com a chave pública do emissor (obtida da URL well-known da jurisdição ou de um conjunto confiável de chaves de emissores).
3. Conferindo que `attested_at` está no passado e que `expires_at` é `null` ou está no futuro.

Veja o passo 10 do [VERIFICATION.md](VERIFICATION.md).

<a id="issuer-public-keys"></a>

### Chaves públicas dos emissores

O protocolo sugere (mas não impõe) que as jurisdições publiquem as suas chaves públicas de atestação em uma URL well-known:

`https://<authority>/.well-known/dcp-attestation-keys.json`

Formato:

```json
{
  "issuer": "authority-us-ai-registry",
  "jurisdiction": "US",
  "keys": [
    { "key_id": "key-2026-01", "public_key_b64": "...", "valid_from": "2026-01-01T...", "valid_until": "2027-01-01T..." }
  ]
}
```

É uma convenção; qualquer método de distribuição das chaves dos emissores é aceitável (entre pares, registro, URL well-known etc.).

---

<a id="jurisdictional-revocation-list"></a>

## Lista de revogação jurisdicional

Uma jurisdição pode publicar uma **lista de revogação assinada**: um arquivo JSON que lista os agentes revogados nessa jurisdição. Veja [docs/STORAGE_AND_ANCHORING.md](../docs/STORAGE_AND_ANCHORING.md) para o formato, a convenção de publicação e como os verificadores a usam.

---

<a id="reference"></a>

## Referência

- Lista de verificação: [VERIFICATION.md](VERIFICATION.md)
- Armazenamento e ancoragem (listas de revogação, log de transparência): [docs/STORAGE_AND_ANCHORING.md](../docs/STORAGE_AND_ANCHORING.md)

<a id="implementation-notes-informative"></a>

## Notas de implementação (informativas)

> **Acrescentadas em 25/10/2026. Não normativas.** Estas notas não acrescentam nenhum requisito nem mudam nada do que está acima: descrevem como
> o código de referência em `main` se relaciona com este texto. Onde divergem, prevalece o texto normativo acima.

- Os artefatos e os comandos acima são os **V1** (`schemas/v1/`). O RPR e o passaporte V2
  (`schemas/v2/`, especificados no [DCP-AI v2.0](DCP-AI-v2.0.md)) trazem listas de chaves (`binding_keys`, `keys`), um
  `session_nonce` e assinaturas compostas em envelopes `SignedPayload`; o passaporte V2 acrescenta os estados de ciclo de vida do
  DCP-05 e um `emergency_revocation_token` opcional.
- `<hbr.json>`, `<ap.json>` e os demais nomes entre sinais de menor e maior são marcadores de posição para os seus próprios arquivos.
- O objeto de atestação de jurisdição mostrado acima não tem JSON Schema V1.
  `schemas/v2/jurisdiction_attestation.schema.json` define uma forma V2 que exige `dcp_version` e um `composite_sig`
  e, com `additionalProperties: false`, não permite o membro `signature` mostrado acima. Os verificadores de referência
  (`lib/verify.js`, os verificadores dos SDKs, `dcp verify-bundle`) não conferem atestações; um verificador que as usa executa
  ele mesmo as verificações desta seção.
- Tanto `schemas/v1/signed_bundle.schema.json` quanto `schemas/v2/signed_bundle.schema.json` só permitem `bundle` e
  `signature` (`additionalProperties: false`). Com as formas atuais, uma atestação viaja junto com o Signed
  Bundle, apresentada separadamente; acrescentá-la como membro extra faz o Signed Bundle falhar na validação contra o schema.
