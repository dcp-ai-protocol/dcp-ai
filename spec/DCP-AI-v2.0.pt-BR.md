<sub>[English](DCP-AI-v2.0.md) · [中文](DCP-AI-v2.0.zh-CN.md) · [Español](DCP-AI-v2.0.es.md) · [日本語](DCP-AI-v2.0.ja.md) · **Português**</sub>

<a id="dcp-ai-v20-normative-specification"></a>

# Especificação normativa do DCP-AI v2.0

> Tradução informativa da [especificação em inglês](DCP-AI-v2.0.md), atualizada em 25/10/2026. **A versão normativa é a inglesa**: esta tradução não tem valor normativo e, em caso de divergência, prevalece o inglês. Identificadores e blocos de código são mantidos sem tradução.

**Status:** Final  
**Versão:** 2.0.0  
**Data:** 2026-02-26  
**Autoria:** DCP-AI Protocol Governance  

---

<a id="1-introduction"></a>

## 1. Introdução

O Digital Citizenship Protocol for AI (DCP-AI) v2.0 define um arcabouço resistente à computação quântica para identidade de agentes, declaração de intenções, controle por políticas e trilhas de auditoria. Ele substitui a v1.0 e introduz assinaturas híbridas com vinculação composta, separação de domínio, vinculação de sessão e aplicação de políticas em que quem manda é o verificador.

<a id="11-design-goals"></a>

### 1.1 Objetivos de design

1. **Segurança pós-quântica**: todos os artefatos de identidade e de auditoria são protegidos contra adversários quânticos por assinaturas compostas híbridas.
2. **Não repúdio**: agentes e pessoas não podem negar as ações registradas em cadeias de auditoria assinadas.
3. **Detecção de adulterações**: cadeias de hashes, raízes de Merkle e ancoragem em blockchain oferecem várias camadas de detecção de adulterações.
4. **Agilidade criptográfica**: o registro de algoritmos e a abstração de provedores permitem migrar de algoritmo sem mudar o protocolo.
5. **Privacidade**: o modo de RPR cego protege os dados pessoais sem perder a verificabilidade.
6. **Interoperabilidade**: verificação entre SDKs, formato de transmissão CBOR e suporte a gRPC.

<a id="12-notation"></a>

### 1.2 Notação

- `||` denota a concatenação de bytes
- `UTF8(s)` denota a codificação UTF-8 da string `s`
- `canonical(obj)` denota a canonicalização segundo o perfil `dcp-jcs-v1` (§15), baseado na RFC 8785 JCS
- `SHA-256(m)` denota o hash SHA-256 da mensagem `m`
- `hex(b)[0:n]` denota os primeiros `n` caracteres hexadecimais da sequência de bytes `b`

---

<a id="2-algorithm-registry"></a>

## 2. Registro de algoritmos

<a id="21-signature-algorithms"></a>

### 2.1 Algoritmos de assinatura

| Identificador | Padrão | Tamanho da chave pública | Tamanho da assinatura | Nível de segurança | Status |
|---|---|---|---|---|---|
| `ed25519` | RFC 8032 | 32 B | 64 B | 128 bits clássico | ACTIVE |
| `ml-dsa-65` | FIPS 204 | 1952 B | 3309 B | NIST nível 3 PQ | ACTIVE (PQ principal) |
| `ml-dsa-87` | FIPS 204 | 2592 B | 4627 B | NIST nível 5 PQ | ACTIVE (alta garantia) |
| `slh-dsa-192f` | FIPS 205 | 48 B | 35664 B | NIST nível 3 PQ | ACTIVE (PQ de reserva) |
| `slh-dsa-256f` | FIPS 205 | 64 B | 49856 B | NIST nível 5 PQ | RESERVED |

> *Nota informativa (25/10/2026), não faz parte do texto normativo:* nenhum SDK do DCP-AI implementa ainda `ml-dsa-87`; os SDKs assinam e verificam com `ed25519`, `ml-dsa-65` e `slh-dsa-192f` ([docs/NIST_CONFORMITY.md](../docs/NIST_CONFORMITY.md)).

<a id="22-kem-algorithms"></a>

### 2.2 Algoritmos KEM

| Identificador | Padrão | Tamanho da chave pública | Tamanho do texto cifrado | Nível de segurança |
|---|---|---|---|---|
| `x25519` | RFC 7748 | 32 B | 32 B | 128 bits clássico |
| `ml-kem-768` | FIPS 203 | 1184 B | 1088 B | NIST nível 3 PQ |
| `x25519-ml-kem-768` | Híbrido | 1216 B | 1120 B | Híbrido nível 3 |

<a id="23-hash-algorithms"></a>

### 2.3 Algoritmos de hash

| Identificador | Saída | Uso |
|---|---|---|
| `sha256` | 32 B | PADRÃO em implantações de nível 3 |
| `sha3-256` | 32 B | Hash secundário do modo de hash duplo |
| `sha384` | 48 B | RECOMENDADO em implantações de nível 5 |

<a id="24-numeric-types"></a>

### 2.4 Tipos numéricos

Todos os campos numéricos do DCP-AI v2.0 devem (MUST) ser inteiros. Valores de ponto flutuante são proibidos para eliminar a ambiguidade na canonicalização.

---

<a id="3-key-objects"></a>

## 3. Objetos de chave

<a id="31-key-entry"></a>

### 3.1 Entrada de chave

```json
{
  "kid": "<32 hex chars>",
  "alg": "<algorithm identifier>",
  "public_key_b64": "<base64-encoded public key>",
  "created_at": "<ISO 8601>",
  "expires_at": "<ISO 8601 | null>",
  "status": "active | revoked | expired"
}
```

<a id="32-deterministic-kid-derivation"></a>

### 3.2 Derivação determinística do kid

```
kid = hex(SHA-256(UTF8(alg) || 0x00 || raw_public_key_bytes))[0:32]
```

Propriedades: único, determinístico e resistente a colisões (128 bits do truncamento de SHA-256).

---

<a id="4-domain-separation"></a>

## 4. Separação de domínio

Toda assinatura deve (MUST) incluir uma tag de separação de domínio:

```
signed_bytes = UTF8(context_tag) || 0x00 || canonical_payload_bytes
```

<a id="41-context-tags"></a>

### 4.1 Tags de contexto

| Tag de contexto | Uso |
|---|---|
| `DCP-AI.v2.AgentPassport` | Autoassinatura do passaporte do agente |
| `DCP-AI.v2.ResponsiblePrincipal` | Assinatura do registro de vinculação à pessoa |
| `DCP-AI.v2.Intent` | Assinatura da declaração de intenção |
| `DCP-AI.v2.PolicyDecision` | Assinatura do mecanismo de políticas |
| `DCP-AI.v2.AuditEvent` | Assinatura de auditoria por evento |
| `DCP-AI.v2.Bundle` | Assinatura do bundle |
| `DCP-AI.v2.Revocation` | Assinatura do registro de revogação |
| `DCP-AI.v2.KeyRotation` | Prova de rotação de chaves |
| `DCP-AI.v2.ProofOfPossession` | Desafio e resposta de prova de posse |
| `DCP-AI.v2.JurisdictionAttestation` | Atestação de jurisdição |
| `DCP-AI.v2.HumanConfirmation` | Confirmação humana |
| `DCP-AI.v2.AlgorithmAdvisory` | Aviso de descontinuação de algoritmo |
| `DCP-AI.v2.Governance` | Operações de governança |
| `DCP-AI.v2.MultiPartyAuth` | Autorização de uma parte em uma autorização multipartes (`multi_party_authorization.schema.json`) |
| `DCP-AI.v2.Lifecycle` | Certificado de entrada em serviço, relatório de vitalidade e registro de desativação (DCP-05) |
| `DCP-AI.v2.Succession` | Testamento digital, manifesto de transferência de memória e registro de sucessão (DCP-06) |
| `DCP-AI.v2.Dispute` | Registro de disputa, objeção, resolução de arbitragem e pacote de jurisprudência (DCP-07) |
| `DCP-AI.v2.Rights` | Declaração de direitos, registro de obrigação e relatório de violação de direitos (DCP-08) |
| `DCP-AI.v2.Delegation` | Mandato de delegação raiz (assinatura da pessoa), espelhos do principal e registros de interação (DCP-09) |
| `DCP-AI.v2.Awareness` | Limiares de consciência e declarações de alerta (DCP-09) |
| `DCP-AI.v2.SubMandate` | Submandato assinado pelo agente que delega (DCP-09 §3.5) |

> **Errata E1 (25/10/2026, normativa):** as linhas `MultiPartyAuth`, `Lifecycle`, `Succession`, `Dispute`, `Rights` e `Awareness`, e os espelhos do principal na linha `Delegation`, documentam contextos já usados pelos SDKs e por `tests/interop/v2/interop_vectors.json#domain_separation_all_contexts`; não acrescentam nenhuma tag. Veja [V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md).

---

<a id="5-composite-signatures"></a>

## 5. Assinaturas compostas

<a id="51-binding-protocol"></a>

### 5.1 Protocolo de vinculação

```
Step 1: classical_sig = Classical.sign(context || 0x00 || payload)
Step 2: pq_sig = PQ.sign(context || 0x00 || payload || classical_sig)
```

A assinatura PQ cobre a assinatura clássica. Remover qualquer um dos componentes faz os dois falharem na verificação.

<a id="52-wire-format"></a>

### 5.2 Formato de transmissão

```json
{
  "composite_sig": {
    "classical": { "alg": "ed25519", "kid": "...", "sig_b64": "..." },
    "pq": { "alg": "ml-dsa-65", "kid": "...", "sig_b64": "..." },
    "binding": "pq_over_classical"
  }
}
```

<a id="53-binding-modes"></a>

### 5.3 Modos de vinculação

- `pq_over_classical`: OBRIGATÓRIO na v2.0. A assinatura PQ cobre a assinatura clássica.
- `classical_only`: permitido durante a transição. O campo PQ é `null`.

---

<a id="6-signedpayload-envelope"></a>

## 6. Envelope SignedPayload

Os artefatos nunca contêm dados de assinatura. As assinaturas ficam em um campo irmão:

```json
{
  "payload": { /* pure artifact */ },
  "payload_hash": "sha256:...",
  "composite_sig": { /* ... */ }
}
```

Bytes assinados: `context_tag || 0x00 || canonical(payload)`

---

<a id="7-verification-modes"></a>

## 7. Modos de verificação

<a id="71-modes"></a>

### 7.1 Modos

| Modo | Clássica exigida | PQ exigida | Bundles V1 |
|---|---|---|---|
| `classical_only` | Sim | Não | Sim |
| `pq_only` | Não | Sim | Não |
| `hybrid_required` | Sim | Sim | Configurável |
| `hybrid_preferred` | Sim | Não (alerta) | Configurável |

Em todos os modos, uma assinatura PQ presente (`pq_over_classical`) deve (MUST) ser verificada. `hybrid_preferred` e `classical_only` só toleram que ela esteja ausente.

<a id="72-verifier-authoritative-policy"></a>

### 7.2 Política definida pelo verificador

A política de assinaturas é definida pela configuração do verificador, NÃO pelo agente. O verificador carrega a política da sua própria configuração:

```json
{
  "verifier_policy": {
    "default_mode": "hybrid_required",
    "risk_overrides": { "high": "hybrid_required", "medium": "hybrid_required", "low": "hybrid_preferred" },
    "min_classical": 1,
    "min_pq": 1,
    "accepted_classical_algs": ["ed25519"],
    "accepted_pq_algs": ["ml-dsa-65", "slh-dsa-192f"],
    "require_session_binding": true,
    "require_composite_binding": true,
    "allow_classical_fallback_disable": false,
    "warn_classical_only_deprecated": false,
    "advisory_rejected_algs": []
  }
}
```

O nível de segurança (§14.3) só pode tornar mais rigoroso o modo que essa política seleciona.

<a id="73-pq-only-mode-phase-3"></a>

### 7.3 Modo somente PQ (fase 3)

Quando `default_mode` é `pq_only`:

- As assinaturas clássicas são aceitas, mas não exigidas
- `min_classical` é 0 e `min_pq` é 1
- A vinculação composta não é exigida
- Os bundles V1 são rejeitados
- Os bundles somente clássicos emitem alertas de descontinuação

---

<a id="8-session-binding"></a>

## 8. Vinculação de sessão

Um `session_nonce` aleatório de 256 bits (64 caracteres hexadecimais) liga todos os artefatos de uma sessão:

```
session_nonce = hex(random(32))
```

Todo artefato V2 inclui `session_nonce`. O verificador deve (MUST) verificar se todos os artefatos de um bundle compartilham o mesmo nonce.

---

<a id="9-bundle-manifest"></a>

## 9. Manifesto do bundle

O manifesto do bundle vincula criptograficamente os hashes de todos os artefatos:

```json
{
  "manifest": {
    "session_nonce": "...",
    "rpr_hash": "sha256:...",
    "passport_hash": "sha256:...",
    "intent_hash": "sha256:...",
    "policy_hash": "sha256:...",
    "audit_merkle_root": "sha256:...",
    "audit_merkle_root_secondary": "sha3-256:...",
    "audit_count": 5,
    "pq_checkpoints": ["ckpt-uuid-1"],
    "canonicalization_profile": "dcp-jcs-v1"
  }
}
```

`canonicalization_profile` é OPCIONAL (hoje só `"dcp-jcs-v1"` está definido; veja § 15 e [`CANONICALIZATION_PROFILE.md`](CANONICALIZATION_PROFILE.md)). Um verificador que encontre um bundle sem o campo deve (MUST) presumir `dcp-jcs-v1`. Perfis futuros tornarão o campo OBRIGATÓRIO.

A assinatura composta do bundle assina `canonical(manifest)`.

---

<a id="10-audit-trail"></a>

## 10. Trilha de auditoria

<a id="101-per-event-signing"></a>

### 10.1 Assinatura por evento

Cada evento de auditoria é assinado com Ed25519 (latência de microssegundos). Os eventos formam uma cadeia de hashes por meio de `prev_hash`.

<a id="102-pq-checkpoints-lazy-model"></a>

### 10.2 Checkpoints PQ (modelo preguiçoso)

A cada N eventos (configurável, padrão 10), é produzido um checkpoint PQ: uma assinatura composta sobre a raiz de Merkle dos últimos N eventos.

<a id="103-dual-hash-chains"></a>

### 10.3 Cadeias de hash duplo

As cadeias SHA-256 e SHA3-256 rodam em paralelo desde o lançamento da v2.0. Se uma família de hash for quebrada, a outra garante a continuidade.

<a id="104-audit-compaction"></a>

### 10.4 Compactação da auditoria

Após N eventos (padrão 1000), é produzido um checkpoint de compactação. Os eventos compactados podem (MAY) ser arquivados enquanto o checkpoint permanece na cadeia ativa.

---

<a id="11-key-management"></a>

## 11. Gerenciamento de chaves

<a id="111-key-rotation"></a>

### 11.1 Rotação de chaves

1. Gerar um novo par de chaves
2. A nova chave assina um desafio de prova de posse (old_kid + new_kid + carimbo de data/hora) sob o contexto `DCP-AI.v2.KeyRotation`
3. A chave antiga referenda a rotação para autorizá-la
4. Janela de carência: 30 dias em que as duas chaves são aceitas

<a id="112-key-recovery-m-of-n-social-recovery"></a>

### 11.2 Recuperação de chaves (recuperação social M de N)

O segredo mestre é dividido com o compartilhamento de segredos de Shamir. As partes são cifradas com KEM híbrido para os contatos de recuperação.

> *Nota informativa (25/10/2026), não faz parte do texto normativo:* a recuperação de chaves do SDK de TypeScript e `dcp recovery-setup` produzem as partes, mas não as cifram; cifrá-las para os contatos de recuperação fica a cargo de quem implementa.

<a id="113-emergency-revocation"></a>

### 11.3 Revogação de emergência

`revocation_token = SHA-256(revocation_secret)` registrado previamente. Revelar a pré-imagem revoga todas as chaves do agente sem assinatura criptográfica.

<a id="114-hsmtpm-support"></a>

### 11.4 Suporte a HSM/TPM

As chaves privadas deveriam (SHOULD) ser armazenadas em módulos de segurança de hardware. A interface `CryptoProvider` aceita `HsmCryptoProvider`, que delega todas as operações ao HSM via PKCS#11.

> *Nota informativa (25/10/2026), não faz parte do texto normativo:* o `HsmCryptoProvider` do código-fonte do SDK de TypeScript é um padrão simulado, não uma integração com HSM: não é exportado, não tem vínculo PKCS#11 e não deve ser usado para assinar ou verificar evidências reais. Este repositório não implementa nenhum backend de hardware nem declara nenhuma validação FIPS 140 ([docs/NIST_CONFORMITY.md](../docs/NIST_CONFORMITY.md) §2.2).

---

<a id="12-privacy"></a>

## 12. Privacidade

<a id="121-blinded-rpr"></a>

### 12.1 RPR cego

Um RPR cego (`schemas/v2/blinded_rpr.schema.json`) substitui os campos de dados pessoais do RPR completo (`legal_name`, `contact`) por um compromisso com sal, de modo que os bundles possam ser publicados em logs de transparência e âncoras sem os dados pessoais. Os campos que não são dados pessoais (`human_id`, `session_nonce`, `entity_type`, `jurisdiction`, `liability_mode`, `override_rights`, `issued_at`, `expires_at`, `binding_keys`) são copiados sem alteração e comparados com o RPR completo na divulgação.

```
pii_salt = hex(random(32))
pii_hash = "sha256:" || hex(SHA-256(UTF8(canonical({ contact, legal_name, pii_salt }))))
```

Um `contact` ausente entra no hash como `null`.

- **Sal.** `pii_salt` é um campo do RPR completo: 32 bytes de um CSPRNG em hexadecimal minúsculo, novos para cada RPR. Ele é coberto pela assinatura do RPR completo e não deve (MUST NOT) ser publicado; nunca aparece no RPR cego. Reutilizar um sal dá o mesmo `pii_hash` a registros com os mesmos dados pessoais, o que permite ligá-los. Com 32 bytes, uma busca por adivinhação e confirmação continua custando 2^128 operações mesmo com o algoritmo de Grover.
- **O cegamento falha de forma fechada.** As implementações devem (MUST) se recusar a cegar um RPR que não tenha um `pii_salt` válido, e os verificadores devem (MUST) rejeitar um RPR completo cujo `pii_salt` esteja presente mas não tenha 64 caracteres hexadecimais minúsculos. O sal é assinado com o RPR completo, então precisa ser definido quando o RPR é criado: um RPR que possa ser cegado depois deveria (SHOULD) ter um `pii_salt` desde o início.
- **Divulgação.** O sal só é divulgado junto com o RPR completo, por exemplo a um regulador, que recalcula `pii_hash` a partir do RPR completo e compara os campos que não são dados pessoais.
- **Eliminação.** Apagar o RPR completo, e com ele o sal, torna o compromisso publicado impossível de abrir: ninguém consegue confirmar com ele um nome e um contato adivinhados. Isso proporciona a eliminação (artigo 17 do RGPD) para registros em logs e âncoras imutáveis, que não podem ser reescritos. É preciso apagar todas as cópias do RPR completo, inclusive as divulgadas.
- **`human_id`.** O RPR cego publica `human_id`, então `human_id` deve (MUST) ser opaco e não deve (MUST NOT) conter dados pessoais nem ser derivado deles, como um endereço de e-mail, um nome ou o hash de qualquer um deles.
- **Compromissos legados.** Um `pii_hash` calculado a partir de um RPR completo sem `pii_salt` (a fórmula acima sem o membro `pii_salt`) está descontinuado. As implementações não devem (MUST NOT) cegar novos registros dessa forma. Os verificadores podem (MAY) continuar verificando um compromisso legado com um RPR completo divulgado e deveriam (SHOULD) sinalizá-lo como descontinuado: quem adivinhar os dados pessoais pode confirmá-los, e em um log imutável isso continua verdadeiro para sempre.

---

<a id="13-governance"></a>

## 13. Governança

<a id="131-governance-key-set"></a>

### 13.1 Conjunto de chaves de governança

Chaves multipartes M de N usadas para assinar avisos sobre algoritmos e decisões do protocolo. Publicadas em `/.well-known/governance-keys.json`.

<a id="132-algorithm-advisory-system"></a>

### 13.2 Sistema de avisos sobre algoritmos

Avisos assinados com as ações `warn`, `deprecate` e `revoke`. A resposta automatizada do verificador remove os algoritmos afetados e acrescenta os substitutos.

<a id="133-advisory-auto-response"></a>

### 13.3 Resposta automática aos avisos

Os verificadores, automaticamente:

- Removem das listas aceitas os algoritmos descontinuados ou revogados
- Acrescentam os algoritmos substitutos
- Passam para pq_only se todos os algoritmos clássicos forem removidos
- Mantêm uma trilha de auditoria das mudanças de política

---

<a id="14-adaptive-security-tiers"></a>

## 14. Níveis de segurança adaptativos

O sistema de níveis de segurança adaptativos seleciona os níveis de proteção criptográfica a partir da pontuação de risco da decisão de política e das classes de dados, do tipo de ação e do impacto estimado da intenção. Os níveis determinam o modo de verificação, o intervalo dos checkpoints PQ e os modos de apresentação do bundle.

<a id="141-tier-definitions"></a>

### 14.1 Definição dos níveis

| Nível | Nome | Modo de verificação | Intervalo de checkpoint PQ | Tamanho do bundle | Latência criptográfica |
|---|---|---|---|---|---|
| 0 | `routine` | `classical_only` | A cada 50 eventos | ~1-2 KB | ~2 ms |
| 1 | `standard` | `hybrid_preferred` | A cada 10 eventos | ~2-5 KB | ~2 ms + 5 ms de checkpoint |
| 2 | `elevated` | `hybrid_required` | A cada evento | ~10-15 KB | ~11 ms |
| 3 | `maximum` | `hybrid_required` | A cada evento + verificação imediata | ~15-25 KB | ~15 ms |

<a id="142-tier-selection-algorithm"></a>

### 14.2 Algoritmo de seleção do nível

O nível é calculado somente a partir de campos assinados que os schemas definem: `action_type`, `data_classes`, `estimated_impact` e o opcional `security_tier` da intenção, e a `risk_score` (inteiro 0..1000) do `PolicyDecisionV2` do bundle. O schema da intenção não tem `risk_score`; uma implementação não deve (MUST NOT) lê-la da intenção.

```
function computeSecurityTier(intent, policy_decision):
  if policy_decision is absent or null:
    score = 0
  else if policy_decision.risk_score is an integer from 0 to 1000:
    score = policy_decision.risk_score
  else:
    score = unknown
  dc = intent.data_classes
  unknown = score is unknown
         OR intent.action_type ∉ ACTION_TYPES
         OR intent.estimated_impact ∉ {low, medium, high}
         OR dc is not an array
         OR some element of dc ∉ DATA_CLASSES

  if score >= 800 OR dc ∩ {credentials, children_data} ≠ ∅:
    tier = "maximum"
  else if score >= 500 OR dc ∩ {pii, financial_data, health_data} ≠ ∅
       OR intent.action_type == "initiate_payment"
       OR intent.estimated_impact == "high" OR unknown:
    tier = "elevated"
  else if score >= 200 OR intent.estimated_impact == "medium":
    tier = "standard"
  else:
    tier = "routine"

  explicit = intent.security_tier
  if explicit is present and not null:
    tier = max(tier, explicit if it is a tier name else "elevated")
  if a verified mandate chain (DCP-09 §3.5) applies and has an effective tier:
    tier = max(tier, that tier if it is a tier name else "elevated")
  return tier
```

O nível efetivo de uma cadeia de delegação verificada, o maior `minimum_security_tier` ao longo dela, é uma entrada opcional desse cálculo que só pode elevar o resultado, nunca rebaixá-lo. Nenhum campo do bundle carrega a cadeia ainda, então o piso se aplica quando o verificador recebe uma cadeia verificada junto com o bundle; os verificadores de bundles de §18 não a leem.

`ACTION_TYPES` e `DATA_CLASSES` são os enums `action_type` e `data_classes` de `schemas/v2/intent.schema.json`. Um valor ausente, de tipo errado ou desconhecido falha de forma fechada para, no mínimo, `elevated`, de modo que um valor que o verificador não conhece nunca reduz o escrutínio que um bundle recebe, com ou sem validação de schema. Sem decisão de política, a pontuação é 0. Em uma decisão de política, uma `risk_score` ausente ou que não seja um inteiro de 0 a 1000 (uma string, uma fração, um número negativo, um número acima de 1000) é desconhecida da mesma forma, e as comparações de pontuação acima a tratam como 0. Um número sem parte fracionária, como `200.0`, conta como esse inteiro.

A categoria `security_tier` de `tests/interop/v2/interop_vectors.json` lista o nível, o modo de verificação e o intervalo de checkpoint esperados para cada caso. Os quatro SDKs a executam.

<a id="143-tier-enforcement-never-downgrade"></a>

### 14.3 Aplicação do nível (nunca para baixo)

Um verificador V2 deve (MUST) calcular o nível de cada bundle e verificar o bundle com o mais rigoroso de dois modos:

1. o modo da política: o `default_mode` do verificador, ou a sua entrada de `risk_overrides` para o `risk_tier` do passaporte (§7.2);
2. o modo do nível (§14.1).

A ordem de rigor é `classical_only` < `hybrid_preferred` < `hybrid_required`. O nível só pode acrescentar um requisito PQ, então uma política `pq_only` continua `pq_only`. O agente verificado assina o passaporte e a intenção, então seu `risk_tier` e seu `security_tier` podem elevar o modo, mas não levá-lo abaixo do modo do nível. Os verificadores informam o nível resolvido junto com o resultado.

O verificador pode (MAY) elevar o nível calculado, mas não deve (MUST NOT) rebaixá-lo. O campo `resolved_tier` em `PolicyDecisionV2` registra o nível que o mecanismo de políticas resolveu. Ele é informativo: o cálculo de §14.2 não o lê.

<a id="144-intent-and-policy-decision-fields"></a>

### 14.4 Campos da intenção e da decisão de política

`IntentV2` inclui um campo opcional `security_tier` (calculado automaticamente ou definido de forma explícita). `PolicyDecisionV2` inclui um campo opcional `resolved_tier`, o nível que o mecanismo de políticas resolveu, a título informativo; §14.2 não o lê.

<a id="145-verification-cache"></a>

### 14.5 Cache de verificação

Os resultados de bundles verificados podem (MAY) ser mantidos em cache com um TTL definido pelo nível resolvido:

| Nível | TTL do cache |
|---|---|
| `routine` | 5 minutos |
| `standard` | 2 minutos |
| `elevated` | 30 segundos |
| `maximum` | 10 segundos |

As entradas do cache devem (MUST) ser invalidadas quando o kid de qualquer signatário for revogado.

<a id="146-bundle-presentation-modes"></a>

### 14.6 Modos de apresentação do bundle

Os níveis influenciam o modo de apresentação sugerido para otimizar a largura de banda:

- **Níveis 0-1 (sessão estabelecida)**: `compact` ou `reference`: a assinatura PQ é omitida e a referência ao checkpoint é incluída
- **Níveis 2-3**: `full`: o bundle completo com todas as assinaturas
- **Primeiro contato (qualquer nível)**: `full`

---

<a id="15-canonicalization"></a>

## 15. Canonicalização

O DCP-AI v2.0 usa o perfil de canonicalização **`dcp-jcs-v1`**, baseado na RFC 8785 (JCS). O perfil fixa os casos que o JCS deixa a critério da implementação (tratamento de undefined, números de ponto flutuante com valor inteiro, notação científica, preservação de null, contêineres vazios) para que os quatro SDKs produzam saída idêntica byte a byte. Ele não é um subconjunto estrito do JCS: as chaves são ordenadas por ponto de código Unicode (item 1), enquanto a RFC 8785 as ordena por unidades de código UTF-16. As duas ordens só diferem em chaves que misturam caracteres dos planos suplementares com caracteres do intervalo U+E000..U+FFFF.

Resumo:

1. Chaves ordenadas lexicograficamente por ponto de código Unicode
2. Forma compacta (sem espaços em branco)
3. Somente números inteiros, decidido após a análise (`1.0`, `1e2`, `1.00` são aceitos; `0.1`, `NaN`, `Infinity` são rejeitados)
4. `null` é preservado com sua chave; os arrays preservam `null` na posição
5. `undefined` (somente TypeScript): omitido em objetos, serializado como `null` em arrays
6. Nenhuma exclusão de campos (envelope SignedPayload)
7. Bytes assinados: `UTF8(context_tag) || 0x00 || canonical(payload)`

O perfil normativo completo, com a tabela de aceitação dos casos-limite e os fixtures de teste que os quatro SDKs precisam passar, está em [`spec/CANONICALIZATION_PROFILE.md`](CANONICALIZATION_PROFILE.md). Os bundles produzidos com esse perfil o declaram pelo campo opcional `canonicalization_profile: "dcp-jcs-v1"` do manifesto do bundle.

---

<a id="16-wire-formats"></a>

## 16. Formatos de transmissão

<a id="161-json-default"></a>

### 16.1 JSON (padrão)

`Content-Type: application/json`

<a id="162-cbor-optional"></a>

### 16.2 CBOR (opcional)

`Content-Type: application/cbor`: codificação determinística da RFC 8949. De 30 a 40% menor que JSON.

---

<a id="17-backward-compatibility"></a>

## 17. Compatibilidade com versões anteriores

```
V1 Verifier + V1 Bundle  ->  PASS (unchanged)
V1 Verifier + V2 Bundle  ->  REJECT "unsupported dcp_version 2.0"
V2 Verifier + V1 Bundle  ->  PASS (when allow_v1_bundles=true)
V2 Verifier + V2 Bundle  ->  PASS (full V2 verification)
```

Os verificadores V2 devem (MUST) oferecer suporte à V1 indefinidamente. A migração é gradual.

---

<a id="18-verification-pipeline"></a>

## 18. Pipeline de verificação

1. Decodificação do formato de transmissão (JSON ou CBOR)
2. Validação de schema (roteamento V1/V2)
3. Consistência do nonce de sessão
4. Integridade do manifesto (recalcular os hashes dos artefatos) e janela de sessão a partir dos campos assinados `session_issued_at` e `session_expires_at`
5. Consistência entre artefatos: status do passaporte, expiração do RPR, um único principal, agente e intenção em todos os artefatos e na trilha de auditoria (VERIFICATION.md V2-14)
6. Cálculo do nível de segurança a partir da intenção e da decisão de política assinadas (§14.2)
7. Rejeição de algoritmos com base nos avisos
8. Verificação das assinaturas compostas (em paralelo): a assinatura do bundle com as `binding_keys` do RPR, os artefatos do agente com as `keys` do passaporte, cada kid derivado da sua chave
9. Aplicação da política do verificador com o modo efetivo, o mais rigoroso entre o modo da política e o do nível (§14.3), à assinatura do bundle e a cada assinatura de artefato
10. Validação da cadeia de hashes de auditoria
11. Validação dos checkpoints PQ: exatamente os checkpoints listados, cada um sobre suas entradas de auditoria e assinado pelo agente
12. Verificações de validade das chaves (expiração, revogação, derivação do kid)
13. Consulta e armazenamento no cache de verificação (§14.5)

---

<a id="19-threat-model"></a>

## 19. Modelo de ameaças

| Ameaça | Mitigação |
|---|---|
| Adversário quântico (algoritmo de Shor) | ML-DSA-65 na assinatura composta |
| Coletar agora e decifrar depois | Assinaturas híbridas compostas (a PQ continua válida mesmo que a clássica seja quebrada) |
| Ataque de remoção | Vinculação composta (a PQ assina sobre a assinatura clássica) |
| Repetição entre artefatos | Tags de contexto de separação de domínio |
| Emenda de sessões | session_nonce + manifesto do bundle |
| Rebaixamento da política | Política definida pelo verificador + regra de nível que nunca baixa |
| Confusão ou apropriação de chaves | kid determinístico + prova de posse |
| Quebra de algoritmo (PQ) | Agilidade criptográfica + reserva SLH-DSA-192f + sistema de avisos |
| Exploração da canonicalização | Schemas somente com inteiros, proibição de ponto flutuante |
| Roubo de chaves | HSM/TPM, certificados de curta duração, rotação de chaves com prova de posse |
| Adulteração do banco de dados | Cadeias de hashes + raízes de Merkle + ancoragem em blockchain |
| Exposição de dados pessoais | Modo de RPR cego |
| Perda de chaves | Recuperação social M de N (Shamir SSS) |
| Evasão do nível | Elevação do nível pelo verificador; o agente não pode rebaixá-lo |
| Agente que reivindica um principal (reutilizando um RPR publicado e assinado) | Assinatura do bundle somente com as `binding_keys` do RPR; ela se compromete com o hash do passaporte. Um RPR emitido com o `human_id` de outra pessoa só é barrado por um verificador que fixe ou ateste as chaves do principal |
| Artefatos inconsistentes, mas assinados validamente | Verificações de consistência entre artefatos (VERIFICATION.md V2-14) |
| Metadados não assinados que orientam uma verificação | Início da sessão assinado no manifesto; o bloco do signatário não pode contradizer a assinatura |

---

<a id="20-conformance-requirements"></a>

## 20. Requisitos de conformidade

### 20.1 MUST

- Assinaturas híbridas com vinculação composta em todos os artefatos V2
- Separação de domínio em cada assinatura
- Nonce de sessão em cada artefato de um bundle
- Campos numéricos somente inteiros
- Derivação determinística do kid
- Validação com os KATs do NIST para todos os provedores PQ
- Cálculo do nível de segurança (§14.2) e sua aplicação com a regra de nunca rebaixar (§14.3) para cada bundle V2

### 20.2 SHOULD

- HSM/TPM para o armazenamento de chaves privadas em produção
- Cadeias de hash duplo (SHA-256 + SHA3-256)
- Formato de transmissão CBOR para implantações de alta vazão
- Certificados de curta duração (TTL de 24 h) em vez de listas de revogação
- Consulta periódica de avisos (diária)

### 20.3 MAY

- CBOR + compressão gzip
- Verificação de assinaturas em paralelo
- Estratégia de verificação que falha rápido checando primeiro a PQ
- Compactação da trilha de auditoria
- Cache dos resultados de verificação com TTL por nível (§14.5)

---

<a id="21-references"></a>

## 21. Referências

- FIPS 203: ML-KEM (mecanismo de encapsulamento de chaves baseado em reticulados modulares)
- FIPS 204: ML-DSA (algoritmo de assinatura digital baseado em reticulados modulares)
- FIPS 205: SLH-DSA (algoritmo de assinatura digital baseado em hash sem estado)
- RFC 8032: Edwards-Curve Digital Signature Algorithm (EdDSA)
- RFC 8785: JSON Canonicalization Scheme (JCS)
- RFC 8949: Concise Binary Object Representation (CBOR)

---

*Fim da especificação normativa do DCP-AI v2.0*

<a id="implementation-notes-informative"></a>

## Notas de implementação (informativas)

> **Acrescentadas em 25/10/2026. Não normativas.** Estas notas não acrescentam nenhum requisito nem mudam nada do que está acima: descrevem como
> o código de referência em `main` se relaciona com este texto. Onde divergem, prevalece o texto normativo acima.

- **§5.1 e §7.1, remoção.** Nos verificadores dos SDKs, uma assinatura PQ presente que não é verificada é rejeitada em
  todos os modos. Um bundle do qual a assinatura PQ foi removida e cuja vinculação foi reetiquetada como
  `classical_only` é aceito quando o modo efetivo é `classical_only` ou `hybrid_preferred` (com um alerta em
  `hybrid_preferred`), e rejeitado com `hybrid_required` e `pq_only` ([VERIFICATION.md](VERIFICATION.md) V2-7 a V2-9).
- **§7.3, `pq_only`.** Os verificadores dos SDKs continuam esperando a vinculação `pq_over_classical` com os bytes da
  assinatura clássica: a assinatura PQ os cobre, então `pq_only` não permite dispensar o componente clássico.
- **§6, SignedPayload.** O envelope envolve os quatro artefatos principais de um bundle (passaporte, RPR, intenção,
  decisão de política). Os registros do DCP-05 ao DCP-09 têm suas assinaturas dentro do objeto, normalmente como
  `composite_sig`; um mandato de delegação raiz tem `human_composite_sig` e um submandato
  `delegator_composite_sig` (DCP-09 §3.5).
- **§9 e §15, canonicalização.** `dcp-jcs-v1` é o único perfil normativo e o padrão. O perfil candidato de
  [docs/proposals/canonicalization-candidate](../docs/proposals/canonicalization-candidate/README.md) só é acessível por
  APIs experimentais e opt-in, e não muda o que um verificador padrão aceita.
- **§10, trilha de auditoria.** As entradas de auditoria não são assinadas uma a uma: são cobertas pela assinatura do
  bundle por meio do manifesto. O contexto `DCP-AI.v2.AuditEvent` é usado nos checkpoints PQ e na compactação da
  auditoria, que quem chama produz com funções auxiliares do SDK; nada os assina automaticamente. Os verificadores
  checam os checkpoints listados e a cadeia SHA-256, mas não recalculam a cadeia secundária SHA3-256.
- **§11.3, revogação de emergência.** Os schemas do RPR não têm `revocation_token`; o passaporte V2 tem um
  `emergency_revocation_token` opcional.
- **§12.1, eliminação.** O texto descreve o efeito criptográfico de apagar o sal. Não é uma avaliação de conformidade
  com o RGPD nem com nenhuma outra lei; consulte [docs/EU_AI_ACT_MAPPING.md](../docs/EU_AI_ACT_MAPPING.md).
- **§13, avisos.** O servidor de referência aplica os avisos publicados à sua política somente quando um operador chama
  `POST /v2/advisory/auto-apply`; ele verifica a `composite_sig` do aviso apenas quanto à estrutura, e não há consulta
  periódica automática.
- **§14.1, tamanhos e latências.** As colunas de tamanho do bundle e de latência são ilustrativas, não medições do
  código em `main`; [docs/OPERATOR_GUIDE.md](../docs/OPERATOR_GUIDE.md) explica como medi-las.
- **§1.1 e §19, ancoragem.** O serviço de ancoragem de referência mantém seus registros localmente e não envia nada para
  a cadeia ([docker/README.md](../docker/README.md)).
- **§16, formatos de transmissão.** CBOR é um codificador e decodificador opcional apenas do SDK de TypeScript, e o
  servidor de referência só lê corpos JSON. O número de 30–40% de redução de tamanho não é respaldado por nenhuma
  medição neste repositório. `api/proto/dcp.proto` é uma definição: nenhum servidor ou cliente gRPC deste repositório a
  implementa.
- **§17, compatibilidade com versões anteriores.** A tabela descreve resultados, não um único ponto de entrada.
  `verifySignedBundleV2` dos SDKs só verifica bundles V2. `allow_v1_bundles` é lido pelo servidor de referência e pelo
  perfil de admissão; o `verifySignedBundle` raiz (`lib/verify.js`) envia os bundles V1 para as verificações V1 sem
  lê-lo.
- **§18, pipeline.** `verifySignedBundleV2` não executa a validação com JSON Schema (passo 2): `lib/verify.js` e o
  servidor a fazem antes de chamá-lo. Ele não usa o cache de verificação que o SDK de TypeScript exporta (passo 13), e
  o passo 12 lê o status das chaves que está no bundle; consultar um serviço de revogação cabe à admissão
  ([docs/ADMISSION.md](../docs/ADMISSION.md)). Verificar não é admitir, confiar nem autorizar.
