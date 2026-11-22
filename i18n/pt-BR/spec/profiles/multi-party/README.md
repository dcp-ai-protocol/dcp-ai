<sub>[English](../../../../../spec/profiles/multi-party/README.md) · [中文](../../../../zh-CN/spec/profiles/multi-party/README.md) · [Español](../../../../es/spec/profiles/multi-party/README.md) · [日本語](../../../../ja/spec/profiles/multi-party/README.md) · **Português**</sub>

<a id="multi-party-authorization-profile-mpa-v1"></a>

# Perfil de autorização multipartes: `mpa-v1`

> Tradução informativa da [especificação em inglês](../../../../../spec/profiles/multi-party/README.md), atualizada em 18/11/2026. **A versão normativa é a inglesa**: esta tradução não tem valor normativo e, em caso de divergência, prevalece o inglês. Identificadores e blocos de código são mantidos sem tradução.

**Estado:** Rascunho, v1
**Escopo:** Se uma autorização multipartes autoriza uma operação sobre um alvo, para um verificador, sob uma política que o operador fixou

---

<a id="1-purpose-and-layering"></a>

## 1. Finalidade e camadas

Uma autorização multipartes ([`multi_party_authorization.schema.json`](../../../../../schemas/v2/multi_party_authorization.schema.json)) lista as assinaturas compostas de várias partes sobre uma operação. Sozinha, ela não decide nada: o seu `required_parties` não é assinado, cada papel é escrito pela parte que o assina, e nada nela diz quais partes podem falar pelo objeto da operação, onde a autorização pode ser usada nem até quando.

`mpa-v1` é um perfil opt-in que faz com que ela decida. Ele não muda o schema do registro nem o que uma parte assina. Ele acrescenta:

1. **Uma requisição assinada** (§2.2) dentro de `operation_payload`: o alvo, a audiência e a janela de validade, que cada parte assina porque fazem parte do que ela já assina.
2. **A política do operador** (§2.3): para cada alvo, as suas partes com os seus papéis, e para cada operação quantas partes ela exige e com quais papéis.
3. **As chaves que o operador tem das partes** (§2.4): o conjunto de confiança de principais do [perfil de admissão](../../../../../spec/profiles/admission/README.md).

Três perguntas são mantidas separadas, e só a terceira dá `authorized`:

| Camada | Pergunta | Lida de |
|---|---|---|
| Estrutura | O registro está bem formado? | Apenas o registro |
| Verificação | Quais partes assinaram exatamente esta requisição? | As chaves em que o operador confia para cada parte |
| Autorização | O executor pode realizar esta operação sobre este alvo agora? | A política do operador e o que o executor está prestes a fazer |

Uma verificação apenas da estrutura (§8) não verifica nenhuma assinatura e não autoriza nada.

Um registro sem a requisição continua sendo um registro v2.0 válido. Ele nunca é autorizado sob este perfil: não há modo legado.

<a id="2-inputs"></a>

## 2. Entradas

<a id="21-clock"></a>

### 2.1 Relógio

Um único instante `now`, em milissegundos desde a época Unix, recebido como parâmetro, com o relógio do sistema como padrão. Os carimbos de data/hora são RFC 3339 com um deslocamento `Z` ou `±hh:mm`, comparados com precisão de milissegundos, como no perfil de admissão. A tolerância de diferença de relógio é de 30 segundos e se aplica apenas a `issued_at`.

<a id="22-the-request"></a>

### 2.2 A requisição

Sob `mpa-v1`, `operation_payload` tem exatamente dois membros. Schema: [`multi_party_request.schema.json`](../../../../../schemas/v2/multi_party_request.schema.json).

```json
{
  "request": {
    "profile": "mpa-v1",
    "request_id": "mpa:6f1c0a52d3b84e7f9a1c2d3e4f506172",
    "target": "agent:acme-bot",
    "audience": "verifier:acme-gateway",
    "issued_at": "2026-11-18T00:00:00Z",
    "expires_at": "2026-11-18T00:30:00Z"
  },
  "parameters": { "reason": "key_compromise" }
}
```

- `request` tem exatamente estes seis membros. `request_id` tem de 1 a 128 caracteres; `target` e `audience`, de 1 a 256. Os comprimentos contam pontos de código Unicode.
- `target` nomeia o objeto da operação como a política do operador o nomeia. `audience` nomeia o verificador que pode agir com a autorização.
- `parameters` é um objeto: os parâmetros próprios da operação, vazio quando ela não tem nenhum.

O que uma parte assina não muda: `UTF8("DCP-AI.v2.MultiPartyAuth") || 0x00 || dcp-jcs-v1({operation, operation_payload, party_id, role})`. A assinatura clássica cobre esses bytes e a pós-quântica os cobre seguidos da assinatura clássica.

<a id="23-policy-set"></a>

### 2.3 Conjunto de políticas

Fornecido apenas pelo operador: configuração local ou uma fonte escolhida pelo operador. Ele não deve (MUST NOT) ser derivado do registro, de um parâmetro de requisição ou de ferramenta, nem de um registro em que as requisições possam escrever. Schema: [`multi_party_policy_set.schema.json`](../../../../../schemas/v2/multi_party_policy_set.schema.json).

```json
{
  "policy_set_version": "2026-11-18.1",
  "profile": "mpa-v1",
  "audience": "verifier:acme-gateway",
  "max_validity_seconds": 1800,
  "subjects": [
    {
      "target": "agent:acme-bot",
      "parties": [
        { "party_id": "human:alice", "role": "owner" },
        { "party_id": "human:bob", "role": "org_admin" },
        { "party_id": "human:carol", "role": "recovery_contact" }
      ],
      "operations": {
        "revoke_agent": {
          "required_parties": 2,
          "allowed_roles": ["owner", "org_admin", "recovery_contact"],
          "required_roles": ["owner"]
        }
      }
    }
  ]
}
```

Um conjunto de políticas é validado ao ser carregado. Ele é rejeitado, com o código de configuração da tabela, quando:

| Condição | Código |
|---|---|
| Um campo fora do schema em qualquer nível | `CONFIG_UNKNOWN_FIELD` |
| `policy_set_version` ausente ou vazio; `profile` diferente de `mpa-v1`; `audience` que não é uma string de 1 a 256 caracteres; `max_validity_seconds` que não é um inteiro de 1 a 86400; um papel ou uma operação fora das listas; `parties` vazio; `allowed_roles` vazio ou com um papel repetido; `required_parties` menor que 2; `required_roles` que não está entre os `allowed_roles` | `CONFIG_INVALID_VALUE` |
| Um alvo listado duas vezes, ou uma parte listada duas vezes para um mesmo alvo | `CONFIG_MPA_DUPLICATE` |
| `required_parties` maior que o número de partes com um papel permitido, ou um papel obrigatório que nenhuma dessas partes tem | `CONFIG_MPA_UNSATISFIABLE` |

Quando um conjunto de políticas tem vários desses problemas, o código de qualquer um deles pode ser informado.

Não há valores padrão. Uma operação que o operador não lista para um alvo não é autorizada, e um conjunto de políticas sem sujeitos é válido e não autoriza nada. Uma parte tem um papel por alvo.

<a id="24-trust-set"></a>

### 2.4 Conjunto de confiança

As chaves das partes vêm do conjunto de confiança de principais do operador ([perfil de admissão, §2.2](../../../../../spec/profiles/admission/README.md#22-trust-set)), carregado pelo mesmo validador: uma parte é um `human_id` desse conjunto. Um kid é derivado da sua chave, e um kid listado duas vezes é rejeitado quando o conjunto é carregado (`CONFIG_TRUST_DUPLICATE`). Assim, uma chave não pode ser atribuída a duas partes, e um assinante não pode contar duas vezes. A avaliação aceita apenas um conjunto de confiança que foi carregado.

Os dois são carregados separadamente. Uma parte da política que o conjunto de confiança não tem não é um erro de configuração: as suas assinaturas recebem `MPA_KEY_NOT_ANCHORED`.

<a id="3-what-the-executor-states"></a>

## 3. O que o executor declara

O executor dá a operação, o alvo e os parâmetros que está prestes a realizar. Eles têm de ser uma operação da lista, um alvo de 1 a 256 caracteres e um objeto representável em `dcp-jcs-v1`. Caso contrário, a chamada é recusada como erro de configuração (`CONFIG_INVALID_VALUE`) e não dá nenhum resultado. A autorização tem de ser exatamente para isso.

<a id="4-evaluation"></a>

## 4. Avaliação

Cinco fases. Uma fase que acrescenta um código interrompe as seguintes, então nenhuma assinatura de uma requisição malformada, alheia ou expirada é verificada. A primeira fase para na sua primeira falha, na ordem abaixo; as demais acrescentam todos os códigos que se aplicam. A avaliação é estrita: uma autorização que falha faz o registro ser recusado, mesmo que as outras atinjam o limiar.

| Fase | Verificação | Código |
|---|---|---|
| 1. Estrutura | O registro está em conformidade com o seu schema | `MPA_SCHEMA_INVALID` |
| | `operation_payload` tem um membro `request` | `MPA_REQUEST_MISSING` |
| | `operation_payload` está em conformidade com o §2.2, com instantes RFC 3339 | `MPA_REQUEST_INVALID` |
| | `operation_payload` é representável em `dcp-jcs-v1` | `MPA_NOT_REPRESENTABLE` |
| | No máximo 16 autorizações | `MPA_TOO_MANY_AUTHORIZATIONS` |
| 2. Vínculo | `operation` é a que o executor declara | `MPA_OPERATION_MISMATCH` |
| | `request.target` é o que o executor declara | `MPA_TARGET_MISMATCH` |
| | `parameters` são os que o executor declara, comparados em forma canônica | `MPA_PARAMETERS_MISMATCH` |
| | `request.audience` é a `audience` do conjunto de políticas | `MPA_AUDIENCE_MISMATCH` |
| | `issued_at` não é posterior a `now` mais a tolerância | `MPA_NOT_YET_VALID` |
| | `expires_at` é posterior a `now` | `MPA_EXPIRED` |
| | `expires_at` é posterior a `issued_at`, em no máximo `max_validity_seconds` | `MPA_VALIDITY_INVALID` |
| | O conjunto de políticas tem um sujeito para `request.target` | `MPA_TARGET_UNKNOWN` |
| | Esse sujeito lista a operação | `MPA_OPERATION_NOT_ALLOWED` |
| 3. Partes | Cada `party_id` é uma parte do sujeito | `MPA_PARTY_UNKNOWN` |
| | Cada `party_id` aparece uma vez | `MPA_PARTY_DUPLICATE` |
| | O papel assinado é o que o operador dá à parte | `MPA_ROLE_MISMATCH` |
| | Esse papel é permitido para a operação | `MPA_ROLE_NOT_ALLOWED` |
| 4. Verificação | Vínculo `pq_over_classical`, um algoritmo clássico na posição clássica e um pós-quântico na outra | `MPA_HYBRID_REQUIRED` |
| | Cada kid é uma chave dessa parte no conjunto de confiança, com esse algoritmo | `MPA_KEY_NOT_ANCHORED` |
| | Essa chave não está revogada, não está expirada e já é válida em `now` | `MPA_KEY_REVOKED`, `MPA_KEY_EXPIRED`, `MPA_KEY_NOT_YET_VALID` |
| | As duas assinaturas estão em base64 canônico e verificam sobre os bytes do §2.2 | `MPA_SIGNATURE_INVALID` |
| 5. Decisão | Autorizaram pelo menos as `required_parties` da política | `MPA_THRESHOLD_NOT_MET` |
| | Cada papel de `required_roles` é de uma parte que autorizou | `MPA_REQUIRED_ROLE_MISSING` |

- `required_parties` do registro não é assinado e nunca é lido.
- Na fase 3 o papel que conta é o do operador: `MPA_ROLE_MISMATCH` quando o assinado é outro, `MPA_ROLE_NOT_ALLOWED` quando o do operador não é permitido para a operação. Os dois podem se aplicar. Uma parte desconhecida recebe `MPA_PARTY_UNKNOWN` e nada mais.
- Na fase 4 cada chave recebe o primeiro que se aplicar entre não ancorada, revogada, expirada (`status` `expired`, ou `expires_at` anterior a `now`) e ainda não válida (`not_before` posterior a `now`). Uma assinatura é verificada apenas quando as duas chaves podem contar.

<a id="5-result"></a>

## 5. Resultado

<a id="51-verdicts"></a>

### 5.1 Veredictos

`structure` é `valid` ou `invalid`. `verification` é `verified`, `failed`, ou `not_evaluated` quando a fase 4 não foi alcançada. `authorized` é verdadeiro apenas quando nenhuma fase acrescentou um código.

<a id="52-fields"></a>

### 5.2 Campos

| Campo | Valor |
|---|---|
| `profile` | `"mpa-v1"` |
| `structure`, `verification`, `authorized` | §5.1 |
| `operation`, `target`, `request_id`, `expires_at` | Os assinados de um registro bem formado; caso contrário, null |
| `parties` | Um por autorização: `party_id`, `role` (o assinado) e `verified` (null quando a fase 4 não foi alcançada) |
| `parties_counted` | As autorizações sem nenhum código na fase 4; null quando ela não foi alcançada |
| `required_parties` | O limiar do operador; null quando nenhuma regra foi encontrada para a operação sobre o alvo |
| `policy_set_version`, `trust_set_version` | As versões da configuração usada |
| `errors` | `{ code, message }` na ordem das fases; dentro de uma fase nenhuma ordem é fixada |

<a id="53-codes"></a>

### 5.3 Códigos

| Código | Fase |
|---|---|
| `MPA_SCHEMA_INVALID`, `MPA_REQUEST_MISSING`, `MPA_REQUEST_INVALID`, `MPA_NOT_REPRESENTABLE`, `MPA_TOO_MANY_AUTHORIZATIONS` | 1 |
| `MPA_OPERATION_MISMATCH`, `MPA_TARGET_MISMATCH`, `MPA_PARAMETERS_MISMATCH`, `MPA_AUDIENCE_MISMATCH`, `MPA_NOT_YET_VALID`, `MPA_EXPIRED`, `MPA_VALIDITY_INVALID`, `MPA_TARGET_UNKNOWN`, `MPA_OPERATION_NOT_ALLOWED` | 2 |
| `MPA_PARTY_UNKNOWN`, `MPA_PARTY_DUPLICATE`, `MPA_ROLE_MISMATCH`, `MPA_ROLE_NOT_ALLOWED` | 3 |
| `MPA_HYBRID_REQUIRED`, `MPA_KEY_NOT_ANCHORED`, `MPA_KEY_REVOKED`, `MPA_KEY_EXPIRED`, `MPA_KEY_NOT_YET_VALID`, `MPA_SIGNATURE_INVALID` | 4 |
| `MPA_THRESHOLD_NOT_MET`, `MPA_REQUIRED_ROLE_MISSING` | 5 |
| `CONFIG_UNKNOWN_FIELD`, `CONFIG_INVALID_VALUE`, `CONFIG_MPA_DUPLICATE`, `CONFIG_MPA_UNSATISFIABLE` | Lançados quando um conjunto de políticas é carregado, ou pelo que o executor declara (§3) |
| `CONFIG_TRUST_*` | Lançados quando o conjunto de confiança é carregado (perfil de admissão, §2.2) |

As mensagens têm no máximo 300 caracteres e nunca contêm chaves privadas, tokens nem a configuração do operador além dos identificadores que estão sendo comparados.

<a id="6-adapters"></a>

## 6. Adaptadores

As funções do núcleo são determinísticas, não fazem nenhuma chamada de rede e não guardam estado. Um adaptador (um servidor, uma ferramenta, um middleware) resolve a configuração do operador e aplica a decisão:

- **A1.** A operação é executada apenas quando `authorized` é verdadeiro, e é a operação, sobre o alvo e com os parâmetros que foram dados à avaliação.
- **A2.** O conjunto de políticas, o conjunto de confiança, as suas fontes, a audiência e o inquilino vêm do código e da configuração do operador. Nenhum campo, cabeçalho ou parâmetro de ferramenta de uma requisição os seleciona ou muda.
- **A3.** Uma operação que não é idempotente é de uso único, e fazer isso valer cabe ao adaptador (§7).

<a id="7-guarantees-and-limits"></a>

## 7. Garantias e limites

Com `authorized` verdadeiro:

- cada autorização foi assinada, com os dois componentes, por uma parte diferente com chaves que o conjunto de confiança do operador lista para ela, utilizáveis em `now`;
- cada parte tem sobre esse alvo o papel que assinou, e o operador permite esse papel para a operação;
- pelo menos tantas partes quantas o operador exige para essa operação sobre esse alvo a autorizaram, e os papéis obrigatórios estão entre elas;
- todas assinaram a operação, o alvo e os parâmetros que o executor declarou, para este verificador, dentro de uma janela que o operador aceita.

Ele **não** garante:

- **Uso único.** A avaliação não guarda estado e não consome `request_id`: duas avaliações da mesma requisição, inclusive simultâneas, dão ambas `authorized`. Um executor cuja operação não é idempotente registra o `request_id` que consumiu até `expires_at`, e consome e executa de forma atômica: em uma transação, ou reservando o identificador antes de executar e não executando quando a reserva já existia. Verificar primeiro e registrar depois deixa passar duas execuções concorrentes.
- **Que o que foi autorizado é o que é executado.** O executor declara o que está prestes a fazer; fazer exatamente isso cabe a ele.
- **Identidade além da configuração.** A decisão é exatamente tão boa quanto o conjunto de confiança do operador, o conjunto de políticas e as suas fontes.
- **Competência ou independência das partes.** Duas chaves não são duas pessoas, e uma assinatura não mostra que algo foi revisado.
- **Revogação mais recente que o conjunto de confiança que foi carregado.**

<a id="8-api-correspondence"></a>

## 8. Correspondência de API

| Conceito | TypeScript (`@dcp-ai/sdk`) | Python (`dcp_ai.v2`) | Go (`dcp/v2`) | Rust (`dcp_ai::v2::multi_party_auth`) |
|---|---|---|---|---|
| Verificar a estrutura | `checkMultiPartyAuthorizationStructure(record, policy?)` | `check_multi_party_authorization_structure(record, policy=None)` | `CheckMultiPartyAuthorizationStructure(record, policy)` | `check_multi_party_authorization_structure(&record, policy)` |
| Carregar um conjunto de políticas | `createMultiPartyPolicyStore(json)` | `create_multi_party_policy_store(json)` | `NewMultiPartyPolicyStore(json)` | `MultiPartyPolicyStore::from_json(&json)` |
| Avaliar | `evaluateMultiPartyAuthorization(record, registry, { policy, trust, expected, now? })` | `evaluate_multi_party_authorization(record, registry, policy=…, trust=…, expected=…, now_ms=…)` | `EvaluateMultiPartyAuthorization(registry, json, options)` | `evaluate_multi_party_authorization(&record, &options)` |
| Construir a requisição | `createMultiPartyRequest(input)` | `create_multi_party_request(…)` | `NewMultiPartyRequest(input)` | `create_multi_party_request(&input)` |
| Assinar como parte | `createPartyAuthorization(…)` | `create_party_authorization(…)` | `CreatePartyAuthorization(…)` | `create_party_authorization(…)` |
| Erro de configuração | `MultiPartyConfigError` (`code`) | `MultiPartyConfigError` (`code`) | `*MultiPartyConfigError` (`Code`) | `MultiPartyConfigError` (`code`) |

Os campos do resultado mantêm os nomes do §5.2 na forma JSON de cada SDK.

A verificação da estrutura olha o número de autorizações, os seus papéis e a presença de um `composite_sig`, contra uma política de forma própria. Ela não verifica nenhuma assinatura, não conhece nenhuma parte e não lê nenhuma política do operador. Em Python, Go e Rust ela foi publicada como `verify_multi_party_authorization` / `VerifyMultiPartyAuthorization`; esse nome está obsoleto e dá o mesmo resultado.

<a id="9-test-vectors"></a>

## 9. Vetores de teste

[`tests/interop/v2/multi_party_vectors.json`](../../../../../tests/interop/v2/multi_party_vectors.json) contém os casos compartilhados: registros, conjuntos de confiança, um conjunto de políticas, o que o executor declara, `now`, e para cada caso os valores esperados de `authorized`, `structure`, `verification`, `parties_counted`, `required_parties` e o conjunto de códigos, com a regra que ele verifica. Os casos de configuração dão um conjunto de políticas, ou um conjunto de confiança, e o código esperado. Todos os SDKs os executam; o critério não é a concordância entre os SDKs, e sim os valores esperados. [`generate-multi-party-vectors.mjs`](../../../../../tests/interop/v2/generate-multi-party-vectors.mjs) escreve o arquivo e verifica cada expectativa contra um avaliador próprio, escrito sem código dos SDKs.

<a id="implementation-notes-informative"></a>

## Notas de implementação (informativas)

> **Acrescentadas em 18/11/2026. Não normativas.** Estas notas não acrescentam nenhum requisito nem mudam nada do que está acima: descrevem como
> o código de referência em `main` se relaciona com este texto. Onde houver diferença, vale o texto normativo acima.

- **Onde está implementado.** Os quatro SDKs em `main` implementam este perfil. Nenhuma versão publicada o tem: o SDK de TypeScript publicado exporta apenas os tipos do registro, e os SDKs de Python, Go e Rust publicados têm somente a verificação da estrutura, com o seu nome anterior.
- **O servidor de referência.** `POST /v2/multi-party/authorize` não aplica este perfil: veja [server/README.md](../../../../../server/README.md).
- **Nenhuma operação consome uma autorização.** Nada neste repositório realiza `revoke_agent`, `rotate_org_key`, `change_jurisdiction` ou `modify_recovery_config` a partir de uma autorização multipartes. O perfil decide; um adaptador executa.
- **Quem revisou os vetores.** O avaliador do gerador e as quatro implementações têm o mesmo autor. A concordância entre eles não é uma revisão independente.
