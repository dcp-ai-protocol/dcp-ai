<sub>[English](../../../../tools/interop-matrix/README.md) · [中文](../../../zh-CN/tools/interop-matrix/README.md) · [Español](../../../es/tools/interop-matrix/README.md) · [日本語](../../../ja/tools/interop-matrix/README.md) · **Português**</sub>

<a id="interop-matrix-live-agents-across-the-four-sdks"></a>

# Matriz de interoperabilidade: agentes vivos nos quatro SDKs

> Tradução informativa da [versão em inglês](../../../../tools/interop-matrix/README.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

`run.mjs` inicia um **processo de agente por SDK** (TypeScript, Python, Go, Rust) e os faz
trabalhar entre si: um agente construído sobre um SDK cria a sua identidade, declara intenções, age e
assina os seus bundles de cidadania; um agente construído sobre outro SDK os verifica, como faria antes de
confiar em uma contraparte. Verificar aqui significa que o bundle é coerente e assinado pelas chaves que ele lista; não é
confiança na contraparte, admissão nem autorização para agir (o cenário 2 cobre a admissão, que também não autoriza
nenhuma ação). Os processos não compartilham nada além das mensagens que o orquestrador retransmite,
então cada par (16 com quatro SDKs, incluindo cada SDK contra si mesmo) é uma interoperação real, não
uma comparação de arquivos. Um quinto agente, só de verificação, `ref`, executa o verificador de referência
`lib/verify.js` (o que `node bin/dcp.js verify-bundle` e o servidor de verificação executam): ele valida cada
artefato contra `schemas/v2` antes do verificador do `@dcp-ai/sdk` (o SDK do workspace até que a 2.2.0 esteja
no npm), algo que os verificadores dos SDKs não fazem.

O orquestrador é também a rede intermediária: ele adultera os bundles em trânsito, e cada
verificador deve rejeitar cada bundle adulterado da mesma forma. Qualquer veredito inesperado, falha ou tempo esgotado
faz a execução falhar.

O cenário 1 (`run.mjs`) exercita partes do DCP-01 (identidade), do DCP-02 (intenção e política) e do DCP-03 (auditoria)
entre os SDKs; não é um teste de conformidade completo dessas especificações.
O cenário 2 (`admission.mjs`) cobre a admissão sob o perfil `strict-v1`
(`spec/profiles/admission`) nos quatro SDKs. O handshake A2A do DCP-04 precisa antes de trabalho nos SDKs
(veja o roadmap no fim).

<a id="run"></a>

## Execução

```bash
(cd sdks/typescript && npm install && npm run build) # agents/ts imports sdks/typescript/dist
npm install                                           # agents/ref: the reference verifier, on that SDK
pip install -e sdks/python                            # dependencies of agents/py
node tools/interop-matrix/run.mjs                     # all four SDKs and the reference verifier
node tools/interop-matrix/run.mjs --agents ts,py      # a subset
node tools/interop-matrix/admission.mjs               # scenario 2, the four SDKs, with its negative control
```

Go e uma toolchain estável de Rust devem estar no `PATH`; `run.mjs` compila `agents/go` e `agents/rust`.
Opções: `--agents a,b` (qualquer um de `ts`, `py`, `go`, `rust`, `ref`), `--python PATH` (padrão `$INTEROP_PYTHON` ou `python3`), `--timeout MS`
(por requisição, padrão 60000), `--out DIR` (padrão `tools/interop-matrix/out`, onde são escritos o relatório
e cada bundle que produziu um veredito inesperado). `admission.mjs` aceita as mesmas
opções exceto `ref` (padrão `--out tools/interop-matrix/out/admission`), além de
`--skip-negative-control`, `--negative-control`, `--check-negative-control` e `--replay FILE`
(veja abaixo).

<a id="the-agent-protocol"></a>

## O protocolo dos agentes

Um agente lê uma requisição JSON por linha na stdin e escreve exatamente uma linha de resposta JSON por
requisição na stdout, em ordem; todo o resto vai para a stderr.

```json
{"id": 1, "cmd": "identity", "args": {"owner_name": "Interop Owner", "jurisdiction": "CL"}}
{"id": 1, "ok": true, "result": {"agent_id": "agent:…", "human_id": "rpr:…", "session_nonce": "…"}}
{"id": 2, "ok": false, "error": "message"}
```

Um agente mantém o seu próprio estado (chaves, identidade, intenções, trilhas de auditoria) em memória durante a vida do
processo. As chaves nunca saem dele. Cada valor que o contrato fixa abaixo deve ser produzido exatamente
como escrito; todo o resto é assunto do próprio SDK, que é o que a matriz testa (um
campo opcional que um SDK adiciona por conta própria, como o `audit_merkle_root_secondary` SHA3 do Go, é aceitável
desde que todos os verificadores o aceitem).

### `identity` `{owner_name, jurisdiction}` → `{agent_id, human_id, session_nonce, principal_keys, agent_keys}`

Gera dois pares de chaves compostas (Ed25519 + ML-DSA-65): um para o principal humano e outro para o
agente; um nonce de sessão novo (64 hex); `human_id` = `rpr:<uuid4>` e `agent_id` = `agent:<uuid4>`.
Entradas de chave: `{kid, alg, public_key_b64, created_at: <now RFC 3339>, expires_at: null, status: "active"}`.

- **RPR** (`schemas/v2/responsible_principal_record.schema.json`): `dcp_version "2.0"`, `human_id`,
  `session_nonce`, `legal_name` = `owner_name`, `entity_type "natural_person"`, `jurisdiction`,
  `liability_mode "owner_responsible"`, `override_rights true`, `issued_at` o instante atual, `expires_at null`,
  `contact null`, `binding_keys` = as duas entradas de chave humanas. Um `SignedPayload` com assinatura composta
  (`pq_over_classical`) das chaves **humanas** sob o contexto `ResponsiblePrincipal`.
- **Passaporte** (`agent_passport.schema.json`): `dcp_version "2.0"`, `agent_id`, `session_nonce`,
  `keys` = as duas entradas de chave do agente, `principal_binding_reference` = `human_id`,
  `capabilities ["api_call", "payments"]`, `risk_tier "medium"`, `created_at` o instante atual,
  `status "active"`. Com assinatura composta das chaves do **agente** sob `AgentPassport`.

`principal_keys` e `agent_keys` são as metades públicas, `[{kid, alg, public_key_b64}]`, a clássica
primeiro. O cenário 2 inscreve o principal a partir delas, fora de banda.

Um segundo `identity` substitui o primeiro, junto com as intenções e as trilhas que o acompanhavam.

### `intent` `{action_type, channel, data_classes, estimated_impact, risk_score, applied_policy_hash}` → `{intent_id, decision, security_tier}`

- **Intenção** (`intent.schema.json`): `dcp_version "2.0"`, `intent_id` = `intent:<uuid4>`,
  `session_nonce`, `agent_id`, `human_id`, `timestamp` o instante atual, `action_type`,
  `target {channel, to: null}`, `data_classes`, `estimated_impact`,
  `requires_consent` = (`estimated_impact` é `"high"`), `security_tier` = o cálculo do nível de segurança
  do SDK (DCP-AI v2.0 §14.2) para esta intenção e `risk_score`.
- **Decisão de política** (`policy_decision.schema.json`): `dcp_version "2.0"`, `intent_id`,
  `session_nonce`, `decision` = `approve` se `risk_score` < 500, `escalate` se < 800, senão
  `block`; `risk_score`; `reasons ["interop-matrix: risk_score <n>"]`; `required_confirmation`
  `null` em approve, senão `{"type": "human_approve", "fields": ["action_type"]}`;
  `applied_policy_hash` dos argumentos; `timestamp` o instante atual; `resolved_tier` = o
  `security_tier` da intenção.

Ambas com assinatura composta das chaves do **agente** (contextos `Intent`, `PolicyDecision`).

### `act` `{intent_id, outcome, tool, result_ref}` → `{audit_id, count}`

Acrescenta uma entrada de auditoria (`audit_entry.schema.json`) à trilha dessa intenção: `dcp_version "2.0"`,
`audit_id` = `audit:<uuid4>`, `session_nonce`, `prev_hash` = `"GENESIS"` para a primeira entrada da trilha,
senão `"sha256:" + hex(sha256(canonical(previous entry)))`; `hash_alg "sha256"`;
`timestamp` o instante atual; `agent_id`; `human_id`; `intent_id`;
`intent_hash` = `"sha256:" + hex(sha256(canonical(intent payload)))`;
`policy_decision` = `approved` / `escalated` / `blocked` conforme a decisão; `outcome`;
`evidence {tool, result_ref, evidence_hash: "sha256:" + hex(sha256(utf8(result_ref)))}`;
`pq_checkpoint_ref null`. `count` é o comprimento da trilha. A entrada é um registro sintético: `act` não executa nada,
e `outcome`, `tool` e `result_ref` são as strings que o orquestrador envia.

### `bundle` `{intent_id, session_issued_at?, session_expires_at?, intended_verifier?}` → `{signed_bundle}`

O bundle de cidadania dessa intenção (`signed_bundle.schema.json`): o RPR, o passaporte,
a intenção e a decisão de política assinados, a trilha completa da intenção e o manifesto: `session_nonce`,
`rpr_hash` / `passport_hash` / `intent_hash` / `policy_hash` (os hashes das cargas úteis),
`audit_merkle_root` (`"sha256:"` + a raiz de Merkle de auditoria do SDK), `audit_count`,
`canonicalization_profile "dcp-jcs-v1"`. A assinatura: `hash_alg "sha256"`, `created_at` o instante atual,
`signer {type: "human", id: human_id, kids: [human classical kid, human pq kid]}`,
`manifest_hash`, `composite_sig` das chaves **humanas** sob o contexto `Bundle`. Use o
construtor e o assinador de bundles do SDK. Os construtores de Go e Rust também escrevem `audit_merkle_root_secondary`.
Os argumentos opcionais entram no manifesto antes de ele ser assinado, exatamente como dados.

### `verify` `{signed_bundle, mode}` → `{valid, errors}`

O verificador de bundles V2 do SDK. O `mode` `""` é a política de verificador padrão; qualquer outro valor é um
modo de verificação aplicado a `default_mode` e a todos os níveis de risco, como fazem os testes de interoperabilidade. Um
bundle malformado é um resultado `valid: false`, nunca uma resposta de erro.

### `rotate_principal` `{}` → `{human_id, principal_keys}`

Um novo par de chaves compostas para o principal e um novo RPR com o mesmo `human_id`, `issued_at`
o instante atual e as novas `binding_keys`, assinado pelas novas chaves. Os bundles posteriores as usam.

<a id="configure-tenant-trust_set-profile---or-config_error"></a>
<a id="configure-tenant-trust_set-profile-or-config_error"></a>

### `configure` `{tenant, trust_set, profile}` → `{}` ou `{config_error}`

A configuração de operador de um inquilino, carregada com os carregadores próprios do SDK: o conjunto de confiança
(`createPrincipalTrustStore` e os seus equivalentes) e o perfil `strict-v1`
(`resolveStrictV1Profile`). Um erro de configuração é `{config_error: <CONFIG_* code>}`.

<a id="admit-tenant-signed_bundle-revocation-now_ms--the-admission-result"></a>
<a id="admit-tenant-signed_bundle-revocation-now_ms-the-admission-result"></a>

### `admit` `{tenant, signed_bundle, revocation, now_ms}` → o resultado da admissão

A API combinada de admissão do SDK (`admitSignedBundleV2` e os seus equivalentes) com o
perfil e o conjunto de confiança do inquilino, o snapshot de revogação e o relógio. O resultado é a forma JSON própria do SDK
(spec §8) sem `verification`, mais `verification_errors`.

### `shutdown` `{}` → `{}`

O agente sai depois de responder.

<a id="scenario-1-dcp-01-to-dcp-03"></a>

## Cenário 1: do DCP-01 ao DCP-03

Para cada SDK como **produtor**: `identity`; uma intenção rotineira (`api_call`, canal `api`,
`["none"]`, impacto `low`, risco 100) com três `act`; uma intenção de pagamento (`initiate_payment`,
canal `payments`, `["financial_data"]`, impacto `high`, risco 900, portanto bloqueada) com um `act`
(a recusa também é evidência); `bundle` para as duas. Depois cada SDK como **verificador** confere os dois
bundles sob a política padrão e `hybrid_required`: os dois devem ser verificados.

Então o orquestrador adultera o bundle rotineiro em trânsito, e cada verificador deve rejeitar
cada cópia, nos dois modos salvo indicação:

| Ataque | O que muda |
|---|---|
| `intent_changed` | `intent.payload.estimated_impact` passa a `high` depois da assinatura |
| `audit_reordered` | as duas primeiras entradas de auditoria trocam de lugar |
| `audit_entry_dropped` | a última entrada de auditoria é removida e o manifesto é mantido |
| `session_spliced` | o `session_nonce` do manifesto é substituído |
| `bundle_signature_swapped` | a assinatura do bundle vem do bundle do pagamento |
| `passport_swapped` | o passaporte é o de outro agente (o produtor do SDK seguinte) |
| `pq_stripped` | a posição `pq` da assinatura do bundle é removida (`classical_only`); apenas `hybrid_required` |
| `intent_from_other_bundle` | a intenção e a decisão de política vêm do bundle do pagamento (mesma sessão e assinante) |
| `trail_from_other_bundle` | a trilha de auditoria vem do bundle do pagamento (mesma sessão e assinante) |

Um agente que falha, esgota o tempo ou responde fora de vez é interrompido e cada requisição posterior a ele
falha imediatamente, então um agente quebrado aparece como falhas, nunca como uma execução travada.

<a id="scenario-2-admission-under-strict-v1"></a>

## Cenário 2: admissão sob `strict-v1`

Cada SDK como **produtor**: `identity`, uma intenção rotineira (risco 100, portanto `approve`) com um `act`,
e três bundles cujos manifestos assinam a janela de sessão `[T0, T0 + 300 s]` (o
máximo do perfil): um para este verificador (`verifier:interop-admission`), um para outra audiência e,
após `rotate_principal`, um assinado com as chaves rotacionadas do principal.

O orquestrador é o operador. Ele inscreve cada principal a partir das chaves públicas que o produtor informou
(nunca a partir de um bundle em admissão), constrói os conjuntos de confiança e serve os snapshots de
revogação: o agente e as chaves do produtor, `checked_at` 10 s antes do relógio. Cada admissão roda
no instante fixo `T0 + 120 s` (o caso de expiração, na expiração mais 1 ms). Os inquilinos A e B são
uma seleção de configuração de operador feita pelo harness; nenhuma integração ou cache está envolvida.

Cada SDK como **consumidor** executa os 13 casos abaixo para cada produtor, nesta ordem, em um
único processo. Os valores esperados de `verified`, `principal_trust`, `profile`, `profile_compliance`, `admitted`,
`action_authorized` (sempre `false`), `recorded_decision`, `trust_set_version` e o conjunto de códigos
vêm da especificação, escritos em `admission.mjs`, nunca de um SDK.

| Caso | Configuração | Esperado |
|---|---|---|
| `trusted_admitted` | o inquilino A confia em todos os principais inscritos | admitido |
| `trust_withdrawn` | o inquilino A sem este principal, o mesmo bundle | `TRUST_PRINCIPAL_UNKNOWN` |
| `trust_restored` | o inquilino A como antes, o mesmo bundle | admitido |
| `tenant_b_empty_trust` | o inquilino B, conjunto de confiança vazio | `TRUST_PRINCIPAL_UNKNOWN` |
| `principal_key_revoked` | um snapshot recente revoga uma chave do principal | `REVOCATION_REVOKED` |
| `agent_key_revoked` | um snapshot recente revoga uma chave do agente | `REVOCATION_REVOKED` |
| `other_audience` | o bundle assinado para outro verificador | `PROFILE_AUDIENCE_MISMATCH`, `VERIFICATION_FAILED` |
| `session_expired` | o relógio 1 ms depois da expiração assinada | `PROFILE_SESSION_EXPIRED`, `VERIFICATION_FAILED` |
| `rotation_new_keys_not_enrolled` | bundle rotacionado, conjunto de confiança não atualizado | `TRUST_KEY_NOT_ANCHORED` |
| `rotation_overlap_new_keys` | chaves antigas e novas ativas | admitido |
| `rotation_overlap_old_keys` | o mesmo, bundle original | admitido |
| `rotation_old_keys_retired` | chaves antigas `revoked`, bundle original | `TRUST_KEY_REVOKED` |
| `rotation_new_keys_after_retirement` | o mesmo, bundle rotacionado | admitido |

Uma divergência escreve uma reprodução mínima no diretório de saída: tudo o que o consumidor recebeu
para essa admissão, incluindo o conjunto de confiança e o perfil **efetivos** do inquilino (os últimos
carregados, também quando um caso anterior os carregou, com `configuration_loaded_in`), e o que ele
devolveu. Apenas material público: nenhuma chave privada.

```bash
node tools/interop-matrix/admission.mjs --replay tools/interop-matrix/out/admission/<producer>-<consumer>-<case>.json
```

`--replay` inicia um consumidor novo do SDK registrado, configura o inquilino registrado, admite o
bundle registrado no relógio registrado e exige exatamente a saída registrada: cada chave de
ambos os lados (os campos normalizados, os códigos, os erros do verificador e `error` quando uma chamada
falhou), e uma chave presente em apenas um lado é uma diferença, então dois erros diferentes nunca contam
como reprodução. Sai com 0 quando reproduz, 1 quando difere e 2 quando o registro está incompleto.

**Controle negativo.** Após a matriz, o executor inicia a si mesmo com `--negative-control` no
par `ts`, em um diretório temporário novo e com um novo id de execução, por no máximo 120 s. Essa execução inverte o
`admitted` esperado de `trust_withdrawn`. O controle só passa se o filho sair com 1 e o seu
relatório for o que ele escreveu nesta execução (mesmo id de execução) com `negative_control_run: true`, o único
par `ts>ts` com 12 de 13, e exatamente uma falha, o campo `admitted` de `trust_withdrawn`.
`--check-negative-control` testa o próprio controle: ele deve aceitar uma execução correta e recusar um
filho que não consegue iniciar (sem relatório, e com um relatório deixado por uma execução anterior no mesmo diretório)
e um filho que trava (interrompido no limite de tempo). `--negative-control-case NAME` inverte outro
caso em vez disso, para produzir de propósito um arquivo de reprodução.

Primeira execução: 16 pares × 13 casos = 208 resultados como esperado, e o controle negativo falhou como
exigido.

<a id="what-the-first-run-found"></a>

## O que a primeira execução encontrou

Os 16 pares de SDKs e o verificador de referência concordam em cada bundle e em cada ataque. Escrever os
agentes revelou estas lacunas dos SDKs, nenhuma delas uma divergência de veredito entre os verificadores dos SDKs:

- **O `SignBundleV2` do Go deixava `signature.signer.id` vazio**: ele não recebia nenhum id de assinante. Os quatro
  verificadores dos SDKs aceitavam esse bundle; o verificador de referência, a CLI e o servidor o rejeitavam
  (`signer/id must NOT have fewer than 6 characters`). Corrigido: o assinante agora é o `human_id` do RPR do bundle,
  e o agente de Go usa `SignBundleV2` como está. O bloco `signature.signer` (`id`, `kids`),
  `created_at` e `manifest_hash` são metadados não autenticados fora do manifesto assinado: nenhum
  verificador os confere com o RPR nem recalcula `manifest_hash` (os cinco aceitam zeros);
  apenas o schema restringe a sua forma.
- **Os payloads tipados do Go não tinham campos de nível**: `IntentV2` não tinha `security_tier` e
  `PolicyDecisionV2` não tinha `resolved_tier`. Os dois existem agora. (`contact` e `target.to` são opcionais no
  schema, então os mapas do agente de Go escrevem `null` apenas para corresponder ao contrato.)
- **A API nativa do Rust não tinha construtor nem assinador de bundles**, então o agente de Rust montava o manifesto
  e o assinava a partir das primitivas. Corrigido: `build_bundle_v2` e `sign_bundle_v2`
  (`dcp_ai::v2::bundle`), que o agente usa agora. `wasm_build_bundle` e
  `wasm_sign_bundle` da feature `wasm` agora os chamam; antes, `wasm_sign_bundle` escrevia `created_at ""` e nenhum
  `signer.id`, então o verificador de referência rejeitava todo bundle que ele assinava.
- **Uma trilha de auditoria vazia**: todo verificador aceita um bundle assinado validamente sem entradas de auditoria,
  como o `spec/VERIFICATION.md` permite (raiz de 64 zeros); os auxiliares `auditEventsMerkleRoot`, que
  servem aos checkpoints PQ, recusam uma lista vazia nos quatro SDKs igualmente.

> **Nota (25/10/2026).** Os achados acima são mantidos como foram registrados na primeira execução. O primeiro não vale mais
> em `main`: os quatro verificadores dos SDKs agora conferem o bloco `signature` não assinado com o que está assinado
> (`spec/VERIFICATION.md` V2-4): `signer.id` deve ser o `human_id` do RPR, `signer.kids` os kids da assinatura
> composta, `manifest_hash` o SHA-256 do manifesto canônico e `hash_alg` um valor permitido, então zeros são
> recusados. `signature.created_at` continua sendo um metadado não assinado que nenhum verificador autentica.

## Roadmap

1. Cenários 1 (do DCP-01 ao 03) e 2 (admissão), na CI.
2. DCP-04: hoje todos os SDKs constroem `A2A_HELLO` e `A2A_WELCOME`, mas nenhum implementa
   `A2A_CONFIRM` / `A2A_ESTABLISHED` nem a derivação da chave de sessão do DCP-04 §3.4, só o TypeScript
   tem o KEM híbrido X25519 + ML-KEM-768 que as mensagens anunciam, e o Rust não tem camada de sessão.
   Quando o fizerem, o protocolo ganhará `hello`, `welcome`, `confirm`, `send` e `receive`, e o
   orquestrador reenviará, reordenará e emendará mensagens entre os dois agentes.
3. Cadeias de mandatos do DCP-09 construídas salto a salto por agentes em SDKs diferentes.
