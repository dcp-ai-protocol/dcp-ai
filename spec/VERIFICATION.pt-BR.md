<sub>[English](VERIFICATION.md) · [中文](VERIFICATION.zh-CN.md) · [Español](VERIFICATION.es.md) · [日本語](VERIFICATION.ja.md) · **Português**</sub>

<a id="verification-checklist--signed-bundle"></a>
<a id="verification-checklist-signed-bundle"></a>

# Lista de verificação — Signed Bundle

> Tradução informativa da [especificação em inglês](VERIFICATION.md), atualizada em 25/10/2026. **A versão normativa é a inglesa**: esta tradução não tem valor normativo e, em caso de divergência, prevalece o inglês. Identificadores e blocos de código são mantidos sem tradução.

Todos os passos são **locais**; nenhuma chamada a uma API ou servidor é necessária. Um verificador precisa apenas do Signed Bundle (e, opcionalmente, de um conjunto de RevocationRecords assinados, vindos de um par, de um arquivo ou de uma lista ancorada).

<a id="normative-checklist"></a>

## Lista de verificação normativa

Ao verificar um Signed Bundle, faça o seguinte, nesta ordem:

1. **Valide contra o schema** o Signed Bundle e o Citizenship Bundle interno contra `schemas/v1/signed_bundle.schema.json` e `schemas/v1/citizenship_bundle.schema.json` (ou use `dcp validate-bundle` no bundle interno e valide contra o schema o envelope assinado).

2. **Verifique a assinatura:**  
   - Recalcule `bundle_hash` = SHA-256(canonical(bundle)); compare com `signature.bundle_hash` (devem coincidir, por exemplo `sha256:<hex>`).  
   - Verifique `signature.sig_b64` com `signature.signer.public_key_b64` sobre o bundle canônico (Ed25519 destacada).  
   - Use `dcp verify-bundle <signed.json> <public_key.txt>` para executar este passo.

3. **Verifique o RPR:** não expirado — `responsible_principal_record.expires_at` é `null` ou uma data e hora ISO 8601 futura. Opcional: verifique a assinatura do RPR se o registro for guardado assinado.

4. **Verifique o AP:** `agent_passport.status` = `"active"`. Opcional: confira o assinante ou o agent_id contra um **conjunto local de RevocationRecords assinados** (de um par, de um arquivo ou de uma lista ancorada), sem nenhuma API central.

5. **Verifique intent_hash:** Para cada AuditEntry em `bundle.audit_entries`, `intent_hash` deve (MUST) ser igual a SHA-256(canonical(intent)) (hex), onde a intenção é a do bundle identificada pelo `intent_id` dessa entrada (normalmente a única `intent` do bundle). Use `dcp intent-hash <intent.json>` ou o auxiliar de referência `intentHash()`.

6. **Verifique a cadeia de auditoria:**  
   - Primeira entrada: `prev_hash` = `"GENESIS"`.  
   - Para cada entrada seguinte no índice n (n ≥ 1): `prev_hash` deve (MUST) ser igual a SHA-256(canonical(entry_{n-1})) (hex).

7. **Opcional — merkle_root:** Se `signature.merkle_root` estiver presente (não null), verifique que ele é igual à raiz de Merkle de `bundle.audit_entries` (por exemplo, `dcp merkle-root` no bundle interno).

8. **Opcional — anchor_receipt:** Se um anchor_receipt for fornecido junto com o bundle (por exemplo, cadeia, tx_id, referência de bloco), verifique que `bundle_hash` aparece na cadeia ou no índice do log indicados usando **apenas dados públicos** (por exemplo, buscando a transação em um explorador de blocos público ou em um nó). Nenhum servidor central participa; a verificação usa apenas dados públicos.

9. **Opcional — lista de revogação jurisdicional:** Se o verificador tiver acesso a uma lista de revogação assinada para a jurisdição do agente (com base em `responsible_principal_record.jurisdiction`), busque a lista ou use a que estiver em cache, verifique a assinatura Ed25519 do emissor e confira o `agent_passport.agent_id` do bundle (ou o assinante) contra as entradas da lista. Se ele aparecer, o agente está revogado e a verificação falha. Veja [docs/STORAGE_AND_ANCHORING.md](../docs/STORAGE_AND_ANCHORING.md) para o formato da lista e a convenção de URL well-known.

10. **Opcional — atestação de jurisdição:** Se o bundle incluir (ou vier acompanhado de) um objeto `JurisdictionAttestation`, verifique a assinatura da atestação sobre `rpr_hash` com a chave pública do atestador. A chave pública do atestador pode ser obtida de uma URL well-known publicada pela jurisdição (por exemplo, `https://<authority>/.well-known/dcp-attestation-keys.json`). Veja o [DCP-01.md](DCP-01.md) para o formato do objeto de atestação.

11. **Opcional — prova do log de transparência:** Se quem detém o bundle fornecer uma prova de inclusão em um log (`log_url`, `log_index`, `merkle_proof`), verifique a inclusão Merkle de `bundle_hash` na raiz assinada do log. Se a raiz do log estiver ancorada em cadeia, verifique opcionalmente a ancoragem. Veja [docs/STORAGE_AND_ANCHORING.md](../docs/STORAGE_AND_ANCHORING.md) para a API do log e o formato da prova.

---

<a id="v2-verification-checklist"></a>

## Lista de verificação V2

Ao verificar um Signed Bundle V2 (`dcp_bundle_version: "2.0"`), execute os passos a seguir. Eles estendem a lista de verificação V1 com a verificação de assinaturas compostas, a vinculação de sessão e a integridade do manifesto.

Implementação de referência: `dcp verify-bundle [--policy <mode>] <signed.json> [public_key.txt]` (ou `verifySignedBundle` em `lib/verify.js`), que valida os schemas e delega as verificações criptográficas a `verifySignedBundleV2` de `@dcp-ai/sdk`. A chave pública opcional fixa o assinante clássico.

<a id="step-v2-1-detect-version"></a>

### Passo V2-1: Detectar a versão

Inspecione `bundle.dcp_bundle_version`. Se for `"2.0"`, use esta lista V2. Se estiver ausente ou for `"1.0"`, use a lista V1 acima.

<a id="step-v2-2-schema-validate"></a>

### Passo V2-2: Validar contra o schema

Valide o Signed Bundle contra `schemas/v2/signed_bundle.schema.json`, que define o bundle interno e referencia `bundle_manifest`, `signed_payload`, `audit_entry` e `pq_checkpoint`. Valide cada `SignedPayload.payload` contra o schema do seu artefato: `responsible_principal_record`, `agent_passport`, `intent` e `policy_decision` em `schemas/v2/`.

<a id="step-v2-3-validate-manifest"></a>

### Passo V2-3: Validar o manifesto

O bundle deve (MUST) conter um objeto `manifest` com os seguintes campos obrigatórios:

- `session_nonce` — string hexadecimal de 64 caracteres
- `rpr_hash`, `passport_hash`, `intent_hash`, `policy_hash` — hashes SHA-256 dos respectivos artefatos
- `audit_merkle_root` — raiz de Merkle das entradas de auditoria
- `audit_count` — número inteiro de entradas de auditoria

Recalcule o hash de cada artefato a partir da representação canônica do `payload` correspondente e verifique que ele coincide com o valor do manifesto e com o `payload_hash` do próprio artefato. Um hash do manifesto ausente, ou uma carga útil ausente ou que não possa ser canonicalizada, faz a verificação falhar.

Ligue a trilha de auditoria ao manifesto: `audit_count` deve (MUST) ser igual ao número de `audit_entries`, `audit_merkle_root` deve (MUST) ser igual à raiz de Merkle recalculada a partir delas, o `prev_hash` da primeira entrada deve (MUST) ser `GENESIS`, e o `prev_hash` de cada entrada seguinte deve (MUST) ser o hash da entrada anterior. Uma trilha de auditoria vazia tem a raiz `sha256:` seguida de 64 zeros, que o padrão do schema do manifesto admite; um construtor de bundles que aceita zero entradas de auditoria escreve esse valor (o `BuildBundleV2` de Go e o `build_bundle_v2` de Rust, que o `wasm_build_bundle` da feature `wasm` chama, o fazem; os construtores de TypeScript e Python exigem pelo menos uma entrada). O auxiliar `auditEventsMerkleRoot` de todos os SDKs, que serve aos checkpoints PQ, recusa em vez disso uma lista vazia.

<a id="step-v2-4-verify-session-nonce-consistency"></a>

### Passo V2-4: Verificar a coerência do nonce de sessão

Todos os artefatos (`responsible_principal_record.payload`, `agent_passport.payload`, `intent.payload`, `policy_decision.payload`) e todas as `audit_entries` que incluem um campo `session_nonce` devem (MUST) compartilhar o mesmo nonce que `manifest.session_nonce`.

Se `manifest.session_expires_at` estiver presente e já tiver passado, rejeite o bundle.

`manifest.session_issued_at`, quando presente, é o momento em que a sessão começou, assinado com o resto do manifesto. Rejeite o bundle quando ele não for um carimbo de data/hora RFC 3339, quando estiver mais de 30 segundos depois do momento da verificação (a diferença de relógio que o [DCP-04](DCP-04.md) também permite) ou quando for posterior a `session_expires_at`. O `max_session_duration_seconds` de uma política de verificador limita `session_expires_at` menos `session_issued_at`: sob essa política, um bundle sem algum dos dois é rejeitado, nunca medido a partir de um momento não assinado nem tratado como uma sessão que nunca termina. Bundles assinados antes de `session_issued_at` existir são verificados como antes sob uma política sem duração máxima de sessão; sob uma com máximo, são rejeitados e devem ser assinados de novo.

O bloco `signature` fora de `composite_sig` (`hash_alg`, `created_at`, `signer`, `manifest_hash`) não é assinado: qualquer pessoa pode mudá-lo sem quebrar uma assinatura. Ele não deve (MUST NOT) substituir dados assinados, como `created_at` já fez com o início da sessão. Também não deve (MUST NOT) contradizer o que está assinado: `signer.id` é o `human_id` do RPR, `signer.kids` são os kids de `composite_sig` (o clássico e depois o PQ, quando presente), `manifest_hash` é `sha256:` seguido do SHA-256 do manifesto canônico, e `hash_alg` é `sha256` ou `sha256+sha3-256`.

Os carimbos de data/hora destas verificações (`session_expires_at` aqui, o `expires_at` de uma chave no passo V2-13) são datas e horas RFC 3339 com um deslocamento `Z` ou `±hh:mm`, como `2026-10-22T06:05:03-05:00`. Compare-os como instantes, com precisão de milissegundos (dígitos além dos milissegundos são descartados), nunca como strings: a ordem de dois carimbos com deslocamentos diferentes como strings não é a sua ordem no tempo. Os anos de 0000 a 9999 são todos válidos. Ausente ou `null` significa sem expiração. Qualquer outro valor que não seja um carimbo assim (uma data sem hora, uma hora sem deslocamento, uma data ou hora impossível, algo que não é string) deve (MUST) ser rejeitado. A categoria `rfc3339` de `tests/interop/v2/interop_vectors.json` lista o instante de cada caso aceito e os rejeitados.

<a id="step-v2-5-verify-composite-signature-structure"></a>

### Passo V2-5: Verificar a estrutura da assinatura composta

A `signature` do bundle deve (MUST) conter um objeto `composite_sig` com:

- `classical` — objeto com `alg`, `kid`, `sig_b64`
- `binding` — um de `pq_over_classical`, `classical_only` (`schemas/v2/composite_signature.schema.json`)
- `pq` — (obrigatório se binding for `pq_over_classical`) objeto com `alg`, `kid`, `sig_b64`

Cada `sig_b64`, na assinatura do bundle, nas dos artefatos e nas dos checkpoints, deve (MUST) estar em base64 canônico (RFC 4648 § 4: com preenchimento, bits finais zerados, nenhum outro caractere), para que todos os verificadores decodifiquem os mesmos bytes e uma assinatura tenha uma única codificação. Caso contrário, rejeite o bundle.

<a id="step-v2-6-verify-classical-signature"></a>

### Passo V2-6: Verificar a assinatura clássica

Reconstrua a mensagem assinada: `context_tag || 0x00 || canonical(manifest)`, onde `context_tag` é `"DCP-AI.v2.Bundle"`. Verifique `composite_sig.classical.sig_b64` contra a chave pública identificada por `composite_sig.classical.kid` usando o algoritmo especificado em `composite_sig.classical.alg` (normalmente Ed25519).

O assinante do bundle é o principal responsável: procure o kid apenas nas `binding_keys` do RPR. A assinatura do principal sobre o manifesto, que se compromete com `passport_hash`, é o que vincula este agente e as suas chaves ao principal; o agente assina o seu próprio passaporte, então uma chave que só o passaporte lista não deve (MUST NOT) verificar a assinatura do bundle. Caso contrário, qualquer pessoa poderia juntar um RPR publicado e assinado a um passaporte e chaves próprios.

Isso vincula o agente a quem detém as `binding_keys` do RPR. Não prova quem é: qualquer pessoa pode criar um RPR com qualquer `human_id` e chaves próprias. Um verificador que precisa da identidade do principal fixa as suas chaves (como `dcp verify-bundle` faz com uma chave pública), confere uma atestação de jurisdição ou as resolve a partir de uma fonte em que confia.

<a id="step-v2-7-verify-pq-signature-if-present"></a>

### Passo V2-7: Verificar a assinatura PQ (se presente)

Se `composite_sig.binding` for `pq_over_classical`:

1. Reconstrua a mensagem assinada PQ: `context_tag || 0x00 || canonical(manifest) || classical_sig_bytes`
2. Verifique `composite_sig.pq.sig_b64` contra a chave pública identificada por `composite_sig.pq.kid` nas `binding_keys` do RPR, usando o algoritmo PQ (por exemplo, ML-DSA-65).

Uma assinatura PQ presente deve (MUST) ser verificada em todos os modos, incluindo `hybrid_preferred` e `classical_only`; uma inválida faz a verificação falhar.

Se binding for `classical_only`, a assinatura PQ está ausente. Isso pode (MAY) ser aceitável dependendo do modo efetivo (passo V2-9): `hybrid_preferred` o aceita com um aviso; `hybrid_required` e `pq_only` o rejeitam.

<a id="step-v2-8-verify-per-artifact-composite-signatures"></a>

### Passo V2-8: Verificar as assinaturas compostas de cada artefato

Cada artefato (`responsible_principal_record`, `agent_passport`, `intent`, `policy_decision`) é envolvido em um envelope `SignedPayload` com o seu próprio `composite_sig`. Verifique a assinatura composta de cada artefato com o mesmo processo dos passos V2-6 e V2-7, com a etiqueta de contexto adequada a cada tipo de artefato. O principal assina o RPR com as suas `binding_keys`; o agente assina o passaporte, a intenção e a decisão de política com as `keys` do passaporte.

<a id="step-v2-9-compute-the-security-tier-and-the-effective-mode"></a>

### Passo V2-9: Calcular o nível de segurança e o modo efetivo

Calcule o nível de segurança a partir de `intent.payload` e `policy_decision.payload` como em [DCP-AI-v2.0.md § 14.2](DCP-AI-v2.0.md): `risk_score` vem da decisão de política, nunca da intenção; um valor de `action_type`, `estimated_impact` ou `data_classes` ausente, de tipo errado ou desconhecido, ou um `risk_score` da decisão de política ausente ou que não seja um inteiro de 0 a 1000, falha de forma fechada para `elevated`; `intent.security_tier` só pode elevar o nível.

O modo efetivo é o mais estrito entre o modo da política (`default_mode`, ou a entrada de `risk_overrides` para o `risk_tier` do passaporte) e o modo do nível: `routine` → `classical_only`, `standard` → `hybrid_preferred`, `elevated` e `maximum` → `hybrid_required`, com `classical_only` < `hybrid_preferred` < `hybrid_required`. Uma política `pq_only` continua `pq_only`. Informe o nível resolvido com o resultado.

<a id="step-v2-10-enforce-verifier-policy"></a>

### Passo V2-10: Aplicar a política do verificador

Aplique o modo efetivo (passo V2-9) e a configuração da política do verificador à assinatura do bundle e a cada assinatura de artefato (passos V2-6 a V2-8):

- Se o modo efetivo for `hybrid_required`, rejeite bundles com binding `classical_only`.
- Se o modo efetivo for `pq_only`, rejeite bundles sem assinatura PQ.
- Confira `accepted_classical_algs` e `accepted_pq_algs`: rejeite se o bundle usar um algoritmo que não esteja nessas listas.
- Confira `advisory_rejected_algs`: rejeite se o bundle usar um algoritmo bloqueado por um aviso ativo.

Portanto, um bundle `classical_only` com uma intenção `initiate_payment` é rejeitado mesmo quando o seu passaporte declara `risk_tier: "low"`.

<a id="step-v2-11-verify-dual-hash-audit-chain-if-present"></a>

### Passo V2-11: Verificar a cadeia de auditoria de hash duplo (se presente)

Se as entradas de auditoria incluírem `prev_hash_secondary`, verifique a cadeia de hash secundária:

- Primeira entrada: `prev_hash_secondary` = `"GENESIS"`
- Entradas seguintes: `prev_hash_secondary` = SHA3-256(canonical(previous_entry))

> **Errata (27/10/2026, normativa).** Esclarece o passo acima e os campos secundários; não altera nenhum hash, nenhuma
> canonicalização nem nenhum outro passo.
>
> - Cada campo secundário é OPCIONAL e só é verificado quando presente; `hash_alg` não torna nenhum deles obrigatório.
> - `prev_hash_secondary`: na primeira entrada, se presente, DEVE ser o literal `"GENESIS"`. Em qualquer entrada
>   posterior, se presente, DEVE ser `sha3-256:` seguido do SHA3-256 em hexadecimal minúsculo dos bytes `dcp-jcs-v1` da
>   entrada imediatamente anterior tal como consta no bundle, tenha ou não essa entrada seu próprio campo secundário. Uma
>   entrada que o omite não é incoerente; um bundle que omite alguns elos não contém uma cadeia secundária completa.
> - `intent_hash_secondary`, se presente, DEVE ser `sha3-256:` seguido do SHA3-256 dos bytes `dcp-jcs-v1` do payload
>   da intenção.
> - `audit_merkle_root_secondary`, se presente no manifesto, DEVE ser `sha3-256:` seguido da raiz de Merkle SHA3-256 das
>   entradas de auditoria, calculada como `audit_merkle_root` (folhas sobre os bytes `dcp-jcs-v1` de cada entrada, pares
>   sobre os digests de 32 bytes concatenados, o último nó duplicado em uma camada ímpar, ordem do bundle); para uma
>   trilha vazia é `sha3-256:` seguido de 64 zeros.
> - Um valor presente que seja `null` ou não seja uma string faz a verificação falhar. Onde se espera um hash, o valor DEVE
>   ser `sha3-256:` seguido de 64 dígitos hexadecimais minúsculos e igual ao calculado; o único outro valor admitido é o
>   literal `"GENESIS"` para `prev_hash_secondary` na primeira entrada.

<a id="step-v2-12-verify-pq-checkpoints-if-present"></a>

### Passo V2-12: Verificar os checkpoints PQ (se presentes)

Se o manifesto listar `pq_checkpoints` ou o bundle trouxer algum, verifique-os:

1. O bundle deve (MUST) trazer exatamente os checkpoints que o manifesto lista, uma vez cada, por `checkpoint_id`. Um checkpoint listado que esteja ausente, ou um trazido que o manifesto não liste, faz a verificação falhar: o manifesto é assinado; os corpos dos checkpoints, não.
2. O `event_range` de um checkpoint nomeia uma sequência contígua de `audit_entries`, da entrada cujo `audit_id` é `from_audit_id` até aquela cujo `audit_id` é `to_audit_id`, com `count` entradas. O seu `merkle_root` deve (MUST) ser `sha256:` seguido da raiz de Merkle dessas entradas, calculada como `auditEventsMerkleRoot` a calcula.
3. O seu `composite_sig` é do agente: verifique-o com as `keys` do passaporte, sob o contexto `DCP-AI.v2.AuditEvent`, sobre o checkpoint canônico sem `composite_sig`. Tanto a assinatura clássica quanto a PQ devem (MUST) estar presentes e ser válidas (no modo `pq_only`, a PQ); um checkpoint existe para trazer a assinatura PQ.
4. O seu `session_nonce` deve (MUST) ser o do manifesto.

<a id="step-v2-13-key-validity-checks"></a>

### Passo V2-13: Verificações de validade das chaves

Para cada identificador de chave (`kid`) referenciado em assinaturas compostas (a do bundle, a de cada artefato e a de cada checkpoint):

- O kid deve (MUST) ser derivado da chave que verifica a assinatura: `kid = hex(SHA-256(UTF8(alg) || 0x00 || raw_public_key))[0:32]`, com `alg` e `raw_public_key` dessa entrada de chave. Caso contrário, rejeite o bundle. Assim um kid nomeia uma única chave, em qualquer lista que a contenha; sem esta verificação, uma lista de chaves pode reivindicar o kid de outra parte para uma chave própria.
- O `public_key_b64` dessa chave deve (MUST) estar em base64 canônico (RFC 4648 § 4, com preenchimento e bits finais zerados), para que todos os verificadores decodifiquem os mesmos bytes.
- Opcionalmente, confira o estado da chave contra um serviço de revogação ou uma lista local de revogação.

Rejeite o bundle se alguma chave que possa assiná-lo, nas `keys` do passaporte ou nas `binding_keys` do RPR, tiver `status` `"revoked"` ou `"expired"` (`schemas/v2/key_entry.schema.json` permite ambos), ou um `expires_at` que já passou ou que não é um carimbo de data/hora RFC 3339 (passo V2-4).

<a id="step-v2-14-cross-artifact-consistency"></a>

### Passo V2-14: Coerência entre artefatos

As assinaturas provam quem assinou cada artefato; estas verificações fazem os artefatos descreverem uma ação, de um agente, para um principal. Elas levam ao V2 as verificações V1 sobre o RPR, o passaporte e `intent_hash`. Rejeite o bundle quando:

- `agent_passport.status` não for nem `active` nem `declining`: um agente `commissioned`, `suspended`, `revoked` ou `decommissioned` não realiza nenhuma ação ([DCP-05](DCP-05.md) § 3.1);
- o `expires_at` do RPR já tiver passado ou não for um carimbo de data/hora RFC 3339 (passo V2-4); `null` nunca expira;
- `agent_passport.principal_binding_reference` não for o `human_id` do RPR;
- `intent.agent_id` não for o `agent_id` do passaporte, ou `intent.human_id` não for o `human_id` do RPR;
- `policy_decision.intent_id` não for `intent.intent_id`;
- o `intent_id` de uma entrada de auditoria não for `intent.intent_id`, o seu `intent_hash` não for o hash da carga útil da intenção (o `intent_hash` do manifesto), o seu `agent_id` não for o do passaporte ou o seu `human_id` não for o do RPR;
- o `policy_decision` de uma entrada de auditoria não registrar a decisão de política: `approved` para `approve`, `escalated` para `escalate`, `blocked` para `block`.

Um bundle que registra uma ação escalada ou bloqueada é evidência válida dela: nada aqui exige que a decisão seja `approve`. As verificações de estado e de expiração, como as de chaves do passo V2-13, se aplicam no momento da verificação; verificar evidência arquivada em relação a um momento anterior ainda não está definido.

<a id="verification-time-and-signer-keys"></a>

### Momento da verificação e chaves dos assinantes

Todas as comparações de tempo de V2-1 a V2-14 usam um único instante de verificação. As implementações o recebem como parâmetro opcional, com o relógio do sistema como padrão, para que um veredito possa ser reproduzido em um dado momento. Para cada assinatura composta que verificam, os verificadores informam a entrada de chave que resolveram para cada componente e se ela foi verificada (`signer_keys`); é isso que o perfil de admissão lê.

<a id="beyond-verification-admission"></a>

### Além da verificação: admissão

Os passos V2-1 a V2-14 decidem se um bundle está verificado: íntegro, coerente e assinado pelas chaves que lista. Eles não decidem quem é o principal. Se um bundle verificado vem de um principal em que o verificador já confia, e os requisitos `strict-v1` definidos pelo operador, são definidos pelo perfil de admissão, [`profiles/admission`](profiles/admission/README.md), acima destes passos e sem mudá-los.

---

<a id="protocol-integrity"></a>

## Integridade do protocolo

Antes de verificar bundles, um verificador deveria (SHOULD) verificar se os seus próprios schemas coincidem com o protocolo canônico:

```bash
dcp integrity
```

Isso confere o hash SHA-256 de cada schema local contra as impressões digitais canônicas em [`protocol_fingerprints.json`](../protocol_fingerprints.json) (na raiz do repositório). Se algum schema tiver sido modificado (por exemplo, em um fork do protocolo), a verificação falha. Veja [docs/SECURITY_MODEL.md](../docs/SECURITY_MODEL.md) para o modelo de segurança completo.

<a id="reference"></a>

## Referência

- Formato do bundle: [BUNDLE.md](BUNDLE.md)
- Cadeia de auditoria e intent_hash: [DCP-03.md](DCP-03.md)
- Modelo de segurança: [docs/SECURITY_MODEL.md](../docs/SECURITY_MODEL.md)
- Armazenamento, ancoragem, listas de revogação, logs de transparência: [docs/STORAGE_AND_ANCHORING.md](../docs/STORAGE_AND_ANCHORING.md)
- Guia do operador: [docs/OPERATOR_GUIDE.md](../docs/OPERATOR_GUIDE.md)

<a id="implementation-notes-informative"></a>

## Notas de implementação (informativas)

> **Acrescentadas em 25/10/2026. Não normativas.** Estas notas não acrescentam nenhum requisito nem mudam nada do que está acima: descrevem como
> o código de referência em `main` se relaciona com este texto. Onde divergem, prevalece o texto normativo acima.

- Passar por estes passos mostra que um bundle está verificado como definido aqui: íntegro, coerente e assinado pelas chaves que
  lista. Isso não certifica o agente nem a identidade do principal, não mostra conformidade com nenhuma regulação nem
  autoriza uma ação; a confiança no principal cabe ao perfil de admissão ([docs/ADMISSION.md](../docs/ADMISSION.md)).
- Os passos V1 opcionais 8 a 11 (recibo de ancoragem, lista de revogação jurisdicional, atestação de jurisdição,
  prova do log de transparência) não são executados por `dcp verify-bundle`, `lib/verify.js` nem pelos verificadores dos SDKs; um verificador que
  os queira os executa ele mesmo. Os snapshots de revogação são lidos pelo perfil de admissão, não por estes passos.
- Passo V2-11: no código-fonte ainda não publicado (27/10/2026), os verificadores dos SDKs verificam os campos secundários presentes, como indica a errata, e `lib/verify.js` também quando usa o SDK compilado desse código-fonte; os pacotes publicados são anteriores e não o fazem: com eles, um bundle que traz os campos secundários é verificado apenas pela cadeia e pela raiz SHA-256, e um verificador que precise da cadeia secundária a confere ele mesmo.
- O passo 10 descreve a assinatura da atestação como feita “sobre `rpr_hash`”, enquanto o [DCP-01](DCP-01.md) a descreve sobre
  o JSON canônico de todos os campos exceto `signature`, e o schema V2 usa um `composite_sig`. Esta nota registra
  a diferença; ela não decide qual se aplica.
