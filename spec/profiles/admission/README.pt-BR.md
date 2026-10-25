<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

<a id="admission-profile-principal-trust-and-strict-v1"></a>

# Perfil de admissão: confiança no principal e `strict-v1`

> Tradução informativa da [especificação em inglês](README.md), atualizada em 25/10/2026. **A versão normativa é a inglesa**: esta tradução não tem valor normativo e, em caso de divergência, prevalece o inglês. Identificadores e blocos de código são mantidos sem tradução.

**Estado:** Rascunho, v1
**Escopo:** Se um verificador admite um bundle V2 assinado como evidência vinda de um principal em que já confia, sob um perfil definido pelo operador

---

<a id="1-purpose-and-layering"></a>

## 1. Finalidade e camadas

O [VERIFICATION.md](../../VERIFICATION.md) (V2-1 a V2-14) decide se um bundle está **verificado**: os seus artefatos estão íntegros, coerentes e assinados pelas chaves que o próprio bundle lista. Qualquer pessoa pode criar um responsible principal record (RPR) com qualquer `human_id` e chaves próprias, então um bundle verificado prova integridade e assinatura, não quem é o principal.

A admissão acrescenta duas camadas opcionais acima da verificação, sem mudá-la:

1. **Confiança no principal** (§3): as chaves que assinaram pelo principal pertencem a um principal em que o operador já confia, segundo um conjunto de confiança fornecido pelo operador.
2. **O perfil `strict-v1`** (§4): requisitos fixos, escolhidos pelo operador (assinaturas híbridas, audiência, uma janela de sessão assinada e curta, estado de revogação recente), que uma requisição não pode enfraquecer.

Um verificador que não habilita nenhuma das duas se comporta exatamente como antes. A admissão nunca reimplementa um passo de verificação: ela lê o que o verificador informa (§2.3).

A admissão decide se uma **evidência** é admitida. Ela não autoriza uma ação: esta versão nunca vincula uma autorização externa a uma ferramenta, aos seus argumentos ou à sua execução (§7).

<a id="2-inputs"></a>

## 2. Entradas

<a id="21-clock"></a>

### 2.1 Relógio

Toda comparação de tempo na verificação e na admissão usa um único instante `now`, em milissegundos desde a época Unix. As implementações o recebem como parâmetro, com o relógio do sistema como padrão. Os carimbos de data/hora são RFC 3339 com um deslocamento `Z` ou `±hh:mm`, comparados com precisão de milissegundos, como no V2-4. A tolerância de diferença de relógio é de 30 segundos (`SKEW`), a mesma do V2-4 e do DCP-04.

<a id="22-trust-set"></a>

### 2.2 Conjunto de confiança

Fornecido apenas pelo operador: configuração local ou uma fonte escolhida pelo operador. Ele não deve (MUST NOT) ser derivado do bundle (das suas chaves, de `legal_name`, de `jurisdiction` ou de qualquer outro campo autodeclarado), de um parâmetro de requisição ou de ferramenta, nem de uma URL que o RPR nomeie. Schema: [`principal_trust_set.schema.json`](../../../schemas/v2/principal_trust_set.schema.json).

```json
{
  "trust_set_version": "2026-11-01.1",
  "principals": [
    {
      "human_id": "human:acme-ops",
      "keys": [
        { "kid": "…", "alg": "ed25519", "public_key_b64": "…", "status": "active",
          "not_before": null, "expires_at": "2027-06-01T00:00:00Z" },
        { "kid": "…", "alg": "ml-dsa-65", "public_key_b64": "…", "status": "active" }
      ]
    }
  ]
}
```

Um conjunto de confiança é validado quando é carregado. Ele é rejeitado, com o código de erro de configuração entre colchetes, quando:

| Condição | Código |
|---|---|
| Um campo fora do schema, em qualquer nível | `CONFIG_UNKNOWN_FIELD` |
| `trust_set_version` ausente ou que não é uma string não vazia; `principals` que não é um array; as `keys` de um principal que não são um array não vazio; `status` que não é `active`, `revoked` nem `expired`; `not_before` ou `expires_at` que não são nem null nem RFC 3339 | `CONFIG_INVALID_VALUE` |
| `human_id` ausente, que não é string ou vazio | `CONFIG_TRUST_EMPTY_ID` |
| `alg` que não é `ed25519`, `ml-dsa-65` nem `slh-dsa-192f`; `public_key_b64` que não está em base64 canônico (V2-5) ou que não tem 32, 1952 ou 48 bytes para esse algoritmo | `CONFIG_TRUST_MALFORMED_KEY` |
| `kid` que não é o kid derivado de `alg` e dos bytes da chave (V2-13) | `CONFIG_TRUST_KID_NOT_DERIVED` |
| Um `human_id` listado duas vezes, ou um `kid` listado duas vezes em todo o conjunto (sob um principal ou sob dois) | `CONFIG_TRUST_DUPLICATE` |

Qualquer duplicado é rejeitado, idêntico ou não: um operador que mescla fontes os resolve antes de carregá-las. Um conjunto de confiança sem principais é válido e não confia em ninguém.

O estado autoritativo de uma chave é o do conjunto de confiança. Um bundle que lista uma chave como `active` não pode restabelecer uma que o conjunto de confiança marca como `revoked` ou `expired`, ou cujo `expires_at` já passou.

A **rotação** é uma atualização explícita do conjunto de confiança (uma nova `trust_set_version`): o operador acrescenta a chave nova, mantém a antiga `active` durante uma sobreposição se necessário e depois a retira (`revoked`, `expired`, um `expires_at` ou removendo-a). Um bundle não pode autorizar a sua própria rotação, porque as suas chaves nunca são uma fonte de confiança.

As chaves do agente não são registradas no conjunto de confiança. O agente fica vinculado ao principal pela assinatura do principal sobre o manifesto, que cobre `passport_hash` (V2-6, V2-7).

<a id="23-signer-keys-reported-by-the-verifier"></a>

### 2.3 Chaves dos assinantes informadas pelo verificador

Para cada assinatura composta que verifica (a assinatura do bundle sobre o manifesto, os quatro artefatos, cada checkpoint PQ), o verificador informa, por componente, a entrada de chave que resolveu e se esse componente foi verificado:

```json
{ "signature": "bundle", "component": "classical", "kid": "…", "alg": "ed25519",
  "public_key_b64": "…", "verified": true }
```

`signature` é `bundle`, `responsible_principal_record`, `agent_passport`, `intent`, `policy_decision` ou `pq_checkpoints[<checkpoint_id>]`; `component` é `classical` ou `pq`. Um componente cuja chave o verificador não resolveu (uma chave clássica ausente sob `pq_only`) não é informado. Estas são as chaves que realmente verificaram as assinaturas, resolvidas exatamente como o verificador as resolveu; a admissão nunca resolve as chaves de outra forma. A lista é definida para um bundle verificado; para um que não foi verificado, as implementações podem parar na primeira falha ou continuar, e a admissão não a usa.

As **assinaturas do principal** são `bundle` e `responsible_principal_record`.

<a id="24-revocation-snapshot"></a>

### 2.4 Snapshot de revogação

Exigido pelo `strict-v1`. O adaptador do operador o obtém de uma fonte local ou remota configurada pelo operador (nenhum serviço central é necessário) para os **sujeitos de revogação** do bundle: o `agent_id` do passaporte e o kid de cada chave de assinante verificada (§2.3), incluindo todas as assinaturas. Schema: [`revocation_snapshot.schema.json`](../../../schemas/v2/revocation_snapshot.schema.json).

```json
{ "checked_at": "2026-11-01T00:00:20Z",
  "agents": { "agent:acme-bot": "not_revoked" },
  "keys": { "<kid>": "not_revoked", "<kid>": "not_revoked" } }
```

`checked_at` é quando a fonte estabeleceu esses estados, não quando o adaptador os leu. Cada estado é `revoked`, `not_revoked` ou `unknown`. Uma fonte que não consegue responder (tempo esgotado, erro, inalcançável) não produz nenhum snapshot; um adaptador não deve (MUST NOT) transformar uma falha em `not_revoked`.

<a id="3-principal-trust"></a>

## 3. Confiança no principal

Avaliada apenas quando um conjunto de confiança é fornecido e o bundle foi verificado (V2-1 a V2-14); caso contrário, o resultado é `not_evaluated`. Com `human_id` o `human_id` da carga útil do RPR:

- **T1.** `human_id` não é um principal do conjunto de confiança: `TRUST_PRINCIPAL_UNKNOWN`. Fim.
- **T2.** Para cada componente verificado de cada assinatura do principal (§2.3), a entrada do conjunto de confiança desse principal com o mesmo `kid`, com a primeira destas que se aplicar:
  - nenhuma, ou um `alg` diferente ou bytes de chave diferentes: `TRUST_KEY_NOT_ANCHORED`;
  - `status` `revoked`: `TRUST_KEY_REVOKED`;
  - `status` `expired`, ou `expires_at` anterior a `now`: `TRUST_KEY_EXPIRED`;
  - `not_before` posterior a `now`: `TRUST_KEY_NOT_YET_VALID`.

Um bundle verificado sem nenhum componente verificado do principal também recebe `TRUST_KEY_NOT_ANCHORED`. O principal é `trusted` quando T1 e T2 não acrescentam nenhum código, e `untrusted` caso contrário. Cada componente verificado conta: confiar apenas na chave Ed25519 de um principal não torna confiável a sua chave PQ nem qualquer outra chave do RPR.

<a id="4-the-strict-v1-profile"></a>

## 4. O perfil `strict-v1`

<a id="41-configuration"></a>

### 4.1 Configuração

Schema: [`admission_profile.schema.json`](../../../schemas/v2/admission_profile.schema.json).

```json
{ "profile": "strict-v1", "verifier_id": "api.acme.example",
  "max_session_duration_seconds": 300, "max_revocation_age_seconds": 300,
  "verifier_policy": { "advisory_rejected_algs": ["slh-dsa-192f"] } }
```

| Campo | Regra |
|---|---|
| `profile` | Obrigatório, `"strict-v1"` |
| `verifier_id` | Obrigatório, uma string não vazia; o `intended_verifier` assinado do bundle deve ser igual a ele |
| `max_session_duration_seconds` | Inteiro de 1 a 300, padrão 300 |
| `max_revocation_age_seconds` | Inteiro de 1 a 300, padrão 300 |
| `verifier_policy` | Campos opcionais de VerifierPolicy; cada um só pode manter ou endurecer a política do perfil (§4.2) |

O perfil define requisitos, não padrões. A sua política de verificador é:

| Campo | Valor | O que `verifier_policy` pode definir |
|---|---|---|
| `default_mode`, cada nível de `risk_overrides` | `hybrid_required` | Apenas `hybrid_required`. `pq_only` dispensa a assinatura clássica, então não satisfaz o perfil |
| `require_session_binding`, `require_composite_binding`, `require_session_expiry`, `require_audience_binding` | `true` | Apenas `true` |
| `allow_v1_bundles`, `allow_classical_fallback_disable` | `false` | Apenas `false` |
| `verifier_id` | o do perfil | Apenas o mesmo valor |
| `max_session_duration_seconds` | o do perfil | De 1 ao valor do perfil; aplica-se o menor |
| `min_classical`, `min_pq` | `1` | Apenas `1`: uma assinatura composta tem um componente clássico e um PQ |
| `accepted_hash_algs` | `["sha256", "sha384"]` | Apenas estes dois, em qualquer ordem: os verificadores conferem o `hash_alg` do bundle pelo V2-4 |
| `max_key_age_days` | `365` | Apenas `365`: os verificadores só avisam sobre a idade das chaves |
| `accepted_classical_algs` | `["ed25519"]` | Um subconjunto não vazio |
| `accepted_pq_algs` | `["ml-dsa-65", "slh-dsa-192f"]` | Um subconjunto não vazio |
| `advisory_rejected_algs` | `[]` | Qualquer lista de strings |
| `warn_classical_only_deprecated` | `false` | Qualquer booleano (apenas avisos) |

Cada campo que `verifier_policy` pode mudar é um que todos os verificadores aplicam da mesma forma, então um perfil nunca é carregado com um requisito que algum SDK ignoraria ou recusaria silenciosamente.

Erros de configuração, lançados quando o perfil é carregado:

| Condição | Código |
|---|---|
| Um campo fora do schema, no nível superior ou em `verifier_policy` | `CONFIG_UNKNOWN_FIELD` |
| Um valor de tipo errado; `profile` que não é `"strict-v1"` | `CONFIG_INVALID_VALUE` |
| `verifier_id` ausente ou vazio; um máximo abaixo de 1 ou acima de 300; um valor de `verifier_policy` que a tabela acima não permite | `CONFIG_PROFILE_CONTRADICTION` |

Quando uma configuração tem vários problemas, o código de qualquer um deles pode ser informado.

Um adaptador que habilita o perfil também rejeita, com `CONFIG_PROFILE_CONTRADICTION`, a falta de um conjunto de confiança ou de uma fonte de revogação, e qualquer uma das suas próprias opções que enfraqueceria o perfil (aceitar requisições sem bundle, a sua própria política de verificador, uma verificação de revogação que falha em aberto).

<a id="42-profile-checks"></a>

### 4.2 Verificações do perfil

Com `max` a duração máxima efetiva da sessão e `m` o manifesto do bundle:

- **P1.** `bundle.dcp_bundle_version` não é `"2.0"`: `PROFILE_V2_REQUIRED`. Fim: nada mais é avaliado.
- **P2.** `m.intended_verifier` ausente, null, que não é string ou vazio: `PROFILE_AUDIENCE_MISSING`; qualquer outro valor diferente de `verifier_id`: `PROFILE_AUDIENCE_MISMATCH`.
- **P3.** `m.session_issued_at` ausente ou null: `PROFILE_SESSION_START_MISSING`. `m.session_expires_at` ausente ou null: `PROFILE_SESSION_EXPIRY_MISSING`. Qualquer um dos dois presente mas que não é RFC 3339, ou o início posterior à expiração: `PROFILE_SESSION_TIME_INVALID`. Caso contrário:
  - o início posterior a `now + SKEW`: `PROFILE_SESSION_NOT_STARTED`;
  - a expiração anterior a `now`: `PROFILE_SESSION_EXPIRED`;
  - a expiração menos o início maior que `max` segundos: `PROFILE_SESSION_TOO_LONG`.
- **P4.** O `composite_sig` da assinatura do bundle ou do RPR não é `pq_over_classical` com um componente `pq`: `PROFILE_HYBRID_REQUIRED`. Após a verificação, também quando falta a alguma assinatura do principal um componente clássico ou PQ verificado, ou o modo de verificação não é `hybrid_required`.

P2 e P3 repetem, com códigos, o que a política do perfil faz o V2-4 aplicar, para que um bundle rejeitado diga qual requisito falhou. Eles leem o manifesto antes de ele estar autenticado; apenas um bundle verificado é admitido.

<a id="43-revocation-checks"></a>

### 4.3 Verificações de revogação

Avaliadas quando o bundle foi verificado, com os sujeitos do §2.4:

- **R1.** Nenhum snapshot: `REVOCATION_UNAVAILABLE`. Fim.
- **R2.** Um snapshot fora do schema (um campo ausente ou extra, `checked_at` que não é RFC 3339, um estado diferente dos três), ou `checked_at` posterior a `now + SKEW`: `REVOCATION_INVALID`. Fim.
- **R3.** `now - checked_at` maior que `max_revocation_age_seconds`: `REVOCATION_STALE`.
- **R4.** Um sujeito `revoked`: `REVOCATION_REVOKED`.
- **R5.** Um sujeito ausente do snapshot ou `unknown`: `REVOCATION_UNKNOWN`.

Um snapshot desatualizado que marca um sujeito como revogado informa os dois códigos. Nenhum destes resultados conta como `not_revoked`.

<a id="5-admission"></a>

## 5. Admissão

<a id="51-procedure"></a>

### 5.1 Procedimento

Dados o bundle assinado, um perfil opcional, um conjunto de confiança opcional (obrigatório com o perfil), um snapshot de revogação (avaliado apenas sob o perfil) e `now`:

1. Sob o perfil, P1; depois P2, P3 e a parte estrutural de P4.
2. Verifique o bundle (V2-1 a V2-14) em `now`, sob a política do perfil, ou sob a política de quem chama sem perfil. Não verificado: `VERIFICATION_FAILED`.
3. Se verificado: confiança no principal (§3) quando um conjunto de confiança é fornecido; sob o perfil, a parte verificada de P4 e as verificações de revogação (§4.3).

Uma implementação pode expor o passo 3 sozinho (`evaluateAdmissionV2` e os seus equivalentes) para que quem chama reutilize uma verificação que já tem. Essa função confia no resultado de verificação que recebe e não verifica de novo: ele deve ser o resultado do passo 2 para o mesmo bundle, no mesmo `now`, sob a política do perfil quando há perfil. Um resultado inventado, de outro bundle ou sob uma política mais fraca dá uma resposta errada; a função combinada (`admitSignedBundleV2`) faz os dois passos.

<a id="52-result"></a>

### 5.2 Resultado

| Campo | Valor |
|---|---|
| `verified` | O veredito do verificador, com o seu significado inalterado |
| `verification` | O resultado completo do verificador (erros, avisos, detalhes, chaves dos assinantes) |
| `principal_trust` | `trusted`, `untrusted` ou `not_evaluated` (sem conjunto de confiança, ou não verificado) |
| `profile` | `"strict-v1"` ou null |
| `profile_compliance` | `compliant`, `non_compliant` ou `not_evaluated` (sem perfil) |
| `admitted` | `verified`, e `principal_trust` é `trusted` quando um conjunto de confiança é fornecido, e `profile_compliance` é `compliant` sob o perfil |
| `action_authorized` | Sempre `false` nesta versão (§7) |
| `recorded_decision` | O `decision` da decisão de política (`approve`, `escalate`, `block`) de um bundle verificado; caso contrário, null |
| `trust_set_version` | A versão do conjunto de confiança, ou null |
| `errors` | `{ code, message }` para cada código acrescentado, na ordem do §5.1 |

`profile_compliance` é `compliant` quando o bundle foi verificado e nenhum código `PROFILE_*` ou `REVOCATION_*` foi acrescentado. Um bundle que registra uma decisão `block` ou `escalate` pode ser admitido como evidência dessa decisão; `action_authorized` continua `false`.

Um bundle coerente consigo mesmo de um principal desconhecido continua verificado, e não é admitido quando um conjunto de confiança é fornecido.

<a id="53-codes"></a>

### 5.3 Códigos

| Código | Passo |
|---|---|
| `VERIFICATION_FAILED` | §5.1 passo 2 |
| `TRUST_PRINCIPAL_UNKNOWN`, `TRUST_KEY_NOT_ANCHORED`, `TRUST_KEY_REVOKED`, `TRUST_KEY_EXPIRED`, `TRUST_KEY_NOT_YET_VALID` | §3 |
| `PROFILE_V2_REQUIRED`, `PROFILE_AUDIENCE_MISSING`, `PROFILE_AUDIENCE_MISMATCH`, `PROFILE_SESSION_START_MISSING`, `PROFILE_SESSION_EXPIRY_MISSING`, `PROFILE_SESSION_TIME_INVALID`, `PROFILE_SESSION_NOT_STARTED`, `PROFILE_SESSION_EXPIRED`, `PROFILE_SESSION_TOO_LONG`, `PROFILE_HYBRID_REQUIRED` | §4.2 |
| `REVOCATION_UNAVAILABLE`, `REVOCATION_INVALID`, `REVOCATION_STALE`, `REVOCATION_REVOKED`, `REVOCATION_UNKNOWN` | §4.3 |
| `CONFIG_UNKNOWN_FIELD`, `CONFIG_INVALID_VALUE`, `CONFIG_PROFILE_CONTRADICTION`, `CONFIG_TRUST_EMPTY_ID`, `CONFIG_TRUST_MALFORMED_KEY`, `CONFIG_TRUST_KID_NOT_DERIVED`, `CONFIG_TRUST_DUPLICATE` | Lançados quando um conjunto de confiança ou um perfil é carregado |

As mensagens são limitadas e nunca contêm chaves privadas, tokens ou a configuração do operador além dos identificadores que estão sendo comparados.

<a id="6-adapters-and-caching"></a>

## 6. Adaptadores e cache

As funções do núcleo são determinísticas e não fazem nenhuma chamada de rede. Os adaptadores (middleware, ferramentas, servidores) resolvem a configuração do operador, chamam as fontes de confiança e de revogação e aplicam a decisão:

- **A1.** Uma requisição chega ao manipulador protegido apenas quando `admitted` é verdadeiro. Um adaptador nunca prossegue apenas com `verified` depois de configurados a confiança ou um perfil, e recusa na configuração (`CONFIG_PROFILE_CONTRADICTION`) uma opção que deixaria uma requisição sem bundle chegar ao manipulador. Quando o operador configurou uma fonte de confiança, cada resposta é carregada como um conjunto de confiança (§2.2): uma fonte que falha, ou que não responde nada (`undefined`, `null`) ou algo que não é um conjunto de confiança válido, recusa a requisição. Isso nunca equivale a “sem conjunto de confiança”, que a avaliação do §5.1 lê como admissão sem confiança no principal.
- **A2.** O perfil, o conjunto de confiança ou a sua fonte, a fonte de revogação, a sua URL e as suas credenciais, e o inquilino vêm do código e da configuração do operador. Nenhum campo, cabeçalho ou parâmetro de ferramenta de uma requisição os seleciona ou muda. Uma fonte remota é obtida por TLS (HTTP simples apenas para um host de loopback), sem seguir redirecionamentos, com tamanho e tempo limitados.
- **A3.** Um cache pode (MAY) guardar o resultado do verificador (passo 2 do §5.1), com a chave do SHA-256 do bundle assinado canônico, do SHA-256 da política de verificador efetiva canônica e do inquilino derivado pelo operador, e mantido no máximo até o primeiro entre o seu TTL, `session_expires_at`, o `expires_at` do RPR e o `expires_at` de cada chave. A confiança no principal, as verificações do perfil e a revogação são avaliadas em cada admissão, no `now` atual, com o conjunto de confiança atual e um snapshot de revogação recente. Portanto, uma aceitação em cache nunca sobrevive a uma mudança do conjunto de confiança, a uma revogação, a uma política diferente ou a um inquilino diferente.

<a id="7-guarantees-and-limits"></a>

## 7. Garantias e limites

Sob `strict-v1`, um bundle admitido:

- foi verificado segundo V2-1 a V2-14 com os dois componentes de assinatura válidos em cada assinatura;
- foi assinado para o principal (RPR e manifesto, os dois componentes) com chaves que o conjunto de confiança do operador lista para esse `human_id`, ativas e dentro do seu período de validade em `now`;
- nomeia este verificador no seu `intended_verifier` assinado;
- tem uma janela de sessão assinada de no máximo `max_session_duration_seconds`, iniciada (dentro de `SKEW`) e não expirada em `now`;
- tem um agente e chaves de assinante verificadas que um snapshot de revogação com no máximo `max_revocation_age_seconds` de idade informa como não revogados.

Ele **não** garante:

- **Uso único.** Um nonce de sessão compartilhado, a audiência e a expiração limitam onde e por quanto tempo um bundle pode ser reenviado; não o tornam de uso único. Um verificador que precise de uso único mantém o seu próprio registro de nonces ou hashes de bundle consumidos; a verificação e a admissão não os consomem.
- **Autorização de uma ação.** `action_authorized` é sempre `false`. A admissão diz que a evidência é autêntica e vem de um principal confiável; se uma ferramenta pode ser executada com dados argumentos é uma fase posterior.
- **Identidade além do conjunto de confiança.** A confiança é exatamente tão boa quanto o conjunto de confiança do operador e a sua fonte.
- **Revogação mais recente que o snapshot.** Uma revogação feita depois de `checked_at` não é vista até o próximo snapshot.

<a id="8-api-correspondence"></a>

## 8. Correspondência de API

| Conceito | TypeScript (`@dcp-ai/sdk`) | Python (`dcp_ai.v2`) | Go (`dcp/v2`) | Rust (`dcp_ai::v2`) |
|---|---|---|---|---|
| Verificar em `now` | `verifySignedBundleV2(b, registry, policy, { now })` | `verify_signed_bundle_v2(b, registry, policy, now_ms=…)` | `VerifySignedBundleV2At(registry, json, policy, now)` | `verify_signed_bundle_v2_at(&b, &policy, now_ms)` |
| Chaves dos assinantes (§2.3) | `details.signer_keys` | `details["signer_keys"]` | `SignerKeys` | `V2VerificationDetails.signer_keys` |
| Carregar um conjunto de confiança | `createPrincipalTrustStore(json)` | `create_principal_trust_store(json)` | `NewPrincipalTrustStore(json)` | `PrincipalTrustStore::from_json(&json)` |
| Carregar um perfil | `resolveStrictV1Profile(json)` | `resolve_strict_v1_profile(json)` | `ResolveStrictV1Profile(json)` | `resolve_strict_v1_profile(&json)` |
| Sujeitos de revogação | `revocationSubjects(b, verification)` | `revocation_subjects(b, verification)` | `RevocationSubjects(b, verification)` | `revocation_subjects(&b, &verification)` |
| Avaliar (sem criptografia) | `evaluateAdmissionV2(input)` | `evaluate_admission_v2(…)` | `EvaluateAdmissionV2(…)` | `evaluate_admission_v2(…)` |
| Verificar e avaliar | `admitSignedBundleV2(b, registry, options)` | `admit_signed_bundle_v2(b, registry, …)` | `AdmitSignedBundleV2(registry, json, options)` | `admit_signed_bundle_v2(&b, &options)` |
| Erro de configuração | `AdmissionConfigError` (`code`) | `AdmissionConfigError` (`code`) | `*AdmissionConfigError` (`Code`) | `AdmissionConfigError` (`code`) |

Os campos do resultado mantêm os nomes do §5.2 na forma JSON de cada SDK.

<a id="9-test-vectors"></a>

## 9. Vetores de teste

[`tests/interop/v2/admission_vectors.json`](../../../tests/interop/v2/admission_vectors.json) contém os casos compartilhados: bundles assinados, conjuntos de confiança, perfis, snapshots de revogação, `now` e, para cada caso, os valores esperados de `verified`, `principal_trust`, `profile_compliance`, `admitted` e o conjunto de códigos, com a regra que ele verifica. Os casos de configuração dão a configuração e o código de erro esperado. Todos os SDKs os executam; o critério não é a concordância entre os SDKs, mas os valores esperados.

<a id="implementation-notes-informative"></a>

## Notas de implementação (informativas)

> **Acrescentadas em 25/10/2026. Não normativas.** Estas notas não acrescentam nenhum requisito nem mudam nada do que está acima: descrevem como
> o código de referência em `main` se relaciona com este texto. Onde divergem, prevalece o texto normativo acima.

- As referências a V2-1 a V2-14 remetem à lista de verificação normativa do [VERIFICATION.md](../../VERIFICATION.md). Em
  `main` os verificadores dos SDKs não recalculam a cadeia nem a raiz secundárias SHA3-256 do V2-11, então “foi verificado segundo V2-1 a
  V2-14” (§7) vale com esse limite: para um bundle que traz uma cadeia secundária, as verificações de hash da cadeia de auditoria realizadas
  são as da cadeia e da raiz SHA-256. Todas as demais verificações, a confiança no principal e todas as verificações do
  `strict-v1` continuam valendo; a cadeia SHA-256 sozinha nunca admite um bundle.
- O JSON dos §2.2, §2.3, §2.4 e §4.1 ilustra as formas, com marcadores de posição (`…`, `<kid>`) para chaves e
  identificadores; não é um fixture e não é carregado como está. As duas entradas `<kid>` do §2.4 representam dois kids reais
  diferentes: um snapshot adaptado não tem chaves JSON duplicadas. Os casos compartilhados e executáveis estão em
  [`tests/interop/v2/admission_vectors.json`](../../../tests/interop/v2/admission_vectors.json) (§9).
- As APIs do §8 estão nos SDKs em `main` e ainda não estão em uma versão publicada.
