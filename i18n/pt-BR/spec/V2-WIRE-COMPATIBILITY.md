<sub>[English](../../../spec/V2-WIRE-COMPATIBILITY.md) · [中文](../../zh-CN/spec/V2-WIRE-COMPATIBILITY.md) · [Español](../../es/spec/V2-WIRE-COMPATIBILITY.md) · [日本語](../../ja/spec/V2-WIRE-COMPATIBILITY.md) · **Português**</sub>

<a id="dcp-ai-v20-wire-compatibility-errata-for-dcp-05-dcp-08-and-dcp-09"></a>

# Compatibilidade do formato de transmissão do DCP-AI v2.0: erratas do DCP-05, DCP-08 e DCP-09

> Tradução informativa da [especificação em inglês](../../../spec/V2-WIRE-COMPATIBILITY.md), atualizada em 25/10/2026. **A versão normativa é a inglesa**: esta tradução não tem valor normativo e, em caso de divergência, prevalece o inglês. Identificadores e blocos de código são mantidos sem tradução.

## Status

Publicado em 25/10/2026. **É normativo apenas para as erratas E1 a E8 a seguir e para as definições de camadas da
seção 2.** Todos os demais requisitos do DCP-AI v2.0, DCP-05, DCP-08 e DCP-09 mantêm sua força normativa sem
alteração. Os requisitos do perfil de canonicalização, as regras de assinatura, os schemas e a prosa de cada
especificação se aplicam em conjunto: nenhum deles anula outro, e nenhum é relaxado aqui.

Estas erratas corrigem como as especificações **nomeiam e mostram** os dados do formato de transmissão V2.0 (nomes de
campos, contextos de assinatura e o formato dos seus exemplos) para que coincidam com o formato que `schemas/v2/`, os
quatro SDKs que assinam e os vetores compartilhados já usam. Não alteram nenhum schema, contexto, perfil de
canonicalização, comportamento dos SDKs nem decisão de aceitação. Não acrescentam nenhum alias: um rótulo ou nome de
campo corrigido aqui não é aceito no lugar do nome do formato de transmissão, e os registros produzidos antes destas
erratas não são renomeados nem convertidos.

A compatibilidade aqui abrange o formato e o comportamento de aceitação dos schemas e SDKs atuais, não o comportamento
não verificado de implementações de terceiros. Uma implementação que tenha usado as antigas tags dos exemplos precisa
de uma decisão explícita de migração. Evidências já assinadas não devem ser renomeadas nem reescritas, e estas erratas
não autorizam tentar automaticamente outros contextos de assinatura como alternativa.

<a id="1-scope"></a>

## 1. Escopo

| Errata | Especificação e seções | Assunto |
|--------|------------------------|---------|
| E1 | DCP-AI v2.0 §4.1 | Linhas do registro de contextos já em uso |
| E2 | DCP-05 §2, §4.4 (última frase), §10.5, §11 item 7 | Contexto de assinatura dos registros do ciclo de vida |
| E3 | DCP-05 §5.1 e §6.2 | Nome do campo de vitalidade no relatório de vitalidade |
| E4 | DCP-08 §2, §9.5, §10 item 8 | Contexto de assinatura dos registros de direitos |
| E5 | DCP-09 §2, §10.6, §11 item 9 | Contextos de assinatura dos registros de delegação e de consciência |
| E6 | DCP-09 §3.6 | Campo que carrega a expiração de um mandato |
| E7 | DCP-05 §3.3, §4.2, §6.2, §8.2, §9.2; DCP-08 §4.2, §5.2, §6.2, §8.2; DCP-09 §3.2, §4.2, §5.2, §6.2, §7.2, §9.2 | Caráter dos exemplos JSON |
| E8 | DCP-05, DCP-08, DCP-09, "Notas de implementação (informativas)" | Frase de precedência das notas |

<a id="2-layers"></a>

## 2. Camadas

Um registro V2.0 é verificado em quatro camadas. As verificações não são intercambiáveis; passar em uma só não prova
a conformidade completa. A verificação (camada 3) canonicaliza o registro e, portanto, requer a camada 1, e a camada
4 requer as camadas 1 a 3 para os registros envolvidos.

1. **Representável**: o perfil de canonicalização `dcp-jcs-v1` aceita o registro
   ([CANONICALIZATION_PROFILE.md](../../../spec/CANONICALIZATION_PROFILE.md)). Um número não inteiro não é representável.
2. **Válido segundo o schema**: o registro valida contra o seu schema em `schemas/v2/`. Um registro válido segundo o
   schema pode não ser representável (por exemplo, uma métrica de vitalidade de `0.5`), e um schema verifica formas e
   intervalos, não significado.
3. **Verificado criptograficamente**: a assinatura composta verifica como define o DCP-AI v2.0 §5, sob o contexto que
   o registro de contextos atribui: a assinatura clássica sobre a mensagem com separação de domínio `UTF8(context) || 0x00 || canonical bytes` (§4) e, com o vínculo `pq_over_classical`, a assinatura pós-quântica sobre essa mensagem seguida
   da assinatura clássica. Autentica uma declaração de quem detém as chaves; não mostra que o que o registro afirma
   seja verdadeiro nem que tenha sido calculado como exigido.
4. **Funcionalmente conforme**: a implementação cumpre os requisitos da própria especificação (os cálculos,
   signatários, cerimônias, intervalos e a aplicação de cada seção de "Conformidade"). As camadas 1 a 3 são
   necessárias para os registros envolvidos e não bastam para esta camada.

<a id="3-errata"></a>

## 3. Erratas

<a id="e1-context-registry-dcp-ai-v20-41"></a>

### E1. Registro de contextos (DCP-AI v2.0 §4.1)

A tabela de §4.1 ganha as linhas `DCP-AI.v2.MultiPartyAuth`, `DCP-AI.v2.Lifecycle`, `DCP-AI.v2.Succession`,
`DCP-AI.v2.Dispute`, `DCP-AI.v2.Rights` e `DCP-AI.v2.Awareness`, e a linha `DCP-AI.v2.Delegation` também passa a
nomear os espelhos do principal. Esses contextos já são definidos pelos quatro SDKs que assinam e cobertos byte a byte
por `tests/interop/v2/interop_vectors.json#domain_separation_all_contexts`; as linhas os documentam e não acrescentam
nenhuma tag. As demais linhas não mudam.

<a id="e2-lifecycle-signatures-dcp-05"></a>

### E2. Assinaturas do ciclo de vida (DCP-05)

Onde o DCP-05 nomeia a tag de separação de domínio `DCP-LIFECYCLE-SIG-v2`, o contexto do formato de transmissão V2.0
é `DCP-AI.v2.Lifecycle`, aplicado como definem o DCP-AI v2.0 §4 e §5 à `composite_sig` de cada registro do ciclo de
vida (`commissioning_certificate`, `vitality_report`, `decommissioning_record` em `schemas/v2/`). O rótulo
`DCP-LIFECYCLE-SIG-v2` não é um contexto V2.0. O requisito de §4.4 de que um certificado de entrada em serviço tenha
uma assinatura da autoridade e uma referenda do principal não muda (veja a seção 4).

<a id="e3-vitality-field-dcp-05"></a>

### E3. Campo de vitalidade (DCP-05)

O relatório de vitalidade V2.0 carrega a vitalidade composta de §5.1 no campo `vitality_score` (inteiro de 0 a 1000,
`schemas/v2/vitality_report.schema.json`); o campo chamado `vitality` no exemplo de §6.2 é esse valor. A definição,
os componentes, os pesos e o `floor` de §5.1 e os limiares de §5.2 não mudam. O schema verifica o intervalo e a
assinatura autentica o valor declarado; nenhum dos dois mostra que o valor foi calculado como §5.1 exige. O objeto
`metrics` do schema V2.0 contém grandezas diferentes das quatro pontuações de componentes de §5.1, e os helpers dos
SDKs que calculam uma pontuação a partir dessas métricas usam outras entradas e arredondam em vez de truncar: não
mostram conformidade com §5.1.

<a id="e4-rights-signatures-dcp-08"></a>

### E4. Assinaturas de direitos (DCP-08)

Onde o DCP-08 nomeia a tag `DCP-RIGHTS-SIG-v2`, o contexto do formato de transmissão V2.0 é `DCP-AI.v2.Rights`,
aplicado à `composite_sig` de `rights_declaration`, `obligation_record` e `rights_violation_report`. O requisito de
§9.1 de verificar uma declaração de direitos contra a chave da autoridade de entrada em serviço não muda.

<a id="e5-delegation-and-awareness-signatures-dcp-09"></a>

### E5. Assinaturas de delegação e de consciência (DCP-09)

Onde o DCP-09 nomeia as tags `DCP-DELEGATION-SIG-v2` e `DCP-AWARENESS-SIG-v2`, os contextos do formato de transmissão
V2.0 são:

| Registro | Campo de assinatura | Contexto |
|----------|---------------------|----------|
| Mandato de delegação raiz | `human_composite_sig` | `DCP-AI.v2.Delegation` (como §3.5.1 já indica) |
| Submandato | `delegator_composite_sig` | `DCP-AI.v2.SubMandate` (como §3.5.1 já indica) |
| Espelho do principal, registro de interação | `composite_sig` | `DCP-AI.v2.Delegation` |
| Limiar de consciência, declaração de alerta | `composite_sig` | `DCP-AI.v2.Awareness` |

As regras da cadeia de mandatos de §3.5 não mudam.

<a id="e6-mandate-expiry-dcp-09-36"></a>

### E6. Expiração do mandato (DCP-09 §3.6)

"O carimbo de data/hora `effective_until` é atingido" passa a ser lido como "o instante `valid_until` já passou". A
janela de um mandato V2.0 é `valid_from` / `valid_until` (`schemas/v2/delegation_mandate.schema.json`, obrigatórios),
comparados como instantes RFC 3339 como exige §3.5.2; `effective_from` / `effective_until` no exemplo de §3.2 são
esses campos. Um mandato que traz `effective_until` em vez de `valid_until` é recusado pelo schema e, tal como o kit o
exercita, pelo verificador de cadeias do TypeScript.

<a id="e7-examples"></a>

### E7. Exemplos

Os exemplos JSON das seções listadas na seção 1 ilustram o conteúdo de cada registro; não são o formato de
transmissão V2.0 nem fixtures e, como estão escritos, não são registros V2.0 válidos, por dois motivos distintos. Os
blocos `signature` / `countersignature` / `agent_acknowledgment` com `alg`, `kid`, `sig_b64` e `domain_sep`, os campos
`record_type`, `prev_hash_secondary` e `merkle_root` onde o schema não os tem, e outros nomes de campo diferentes do
schema tornam um registro inválido segundo o schema, mesmo quando ele é canonicalizável. Os valores não inteiros (por
exemplo `error_rate_percent: 0.3`, `capacity_threshold: 0.80`, `threshold: 0.3`, `confidence: 0.95`) não são
representáveis com `dcp-jcs-v1`. Para um registro que tem um schema publicado em `schemas/v2/`, o seu formato de
transmissão é esse schema junto com a canonicalização `dcp-jcs-v1`, assinado como indicam E2, E4 e E5. Alguns dos
exemplos listados não têm um schema publicado próprio: o registro de transição do DCP-05 §3.3 e as entradas de
auditoria do DCP-05 §9.2, DCP-08 §8.2 e DCP-09 §9.2, que também não se ajustam a `schemas/v2/audit_entry.schema.json`.
Um exemplo assim não define um schema, e estas erratas não o tornam um registro válido do formato de transmissão. Os
requisitos estabelecidos na prosa dessas seções não mudam.

<a id="e8-implementation-notes"></a>

### E8. Notas de implementação

A frase "Onde divergem, prevalece o texto normativo acima." das notas informativas do DCP-05, DCP-08 e DCP-09 passa a
ser lida como "Onde divergem, prevalece o texto normativo acima, com as correções das erratas de
[V2-WIRE-COMPATIBILITY.md](../../../spec/V2-WIRE-COMPATIBILITY.md)."

<a id="4-requirements-the-v20-structures-do-not-represent-directly"></a>

## 4. Requisitos que as estruturas V2.0 não representam diretamente

Estes requisitos continuam normativos. Os schemas V2.0 dos registros listados abaixo têm uma única assinatura por
registro ou um conjunto fechado de valores, então esses registros não representam diretamente estes requisitos, e os
helpers dos SDKs, por si sós, não os cumprem. Se um mecanismo externo a esses registros pode cumpri-los depende de
demonstrar os próprios requisitos funcionais; estas erratas não o estabelecem nem o pressupõem. Representá-los dentro
dos registros requer um projeto explícito e versionado (uma nova versão de schema ou um perfil); estas erratas não
definem nem ativam nenhum.

| Requisito | Por que o registro V2.0 não o carrega |
|-----------|---------------------------------------|
| DCP-05 §4.4: assinatura da autoridade e referenda do principal | Uma única `composite_sig`; nenhum campo para um segundo signatário |
| Pontuações de componentes do DCP-05 §5.1 | As `metrics` do schema são outras grandezas; só `vitality_score` é carregado |
| Métricas fracionárias do DCP-05 §6 | `dcp-jcs-v1` só aceita inteiros, então as métricas [0, 1] do schema só são representáveis como 0 ou 1 |
| Direitos da organização em notação de domínio reverso do DCP-08 §4.3 | `right_type` é um enum fechado dos quatro direitos fundamentais |
| DCP-08 §9.1: assinatura da autoridade de entrada em serviço | O registro não identifica o papel de quem assina; os helpers não o verificam |
| DCP-09 §3.3: confirmação do agente; §6.3: assinatura do principal em um espelho | Uma assinatura por registro |

Os helpers de pontuação de vitalidade dos SDKs também diferem entre si nos empates quando recebem entradas
fracionárias (para `task_completion_rate` 0, `error_rate` 1, `human_satisfaction` 0.002 e `policy_alignment` 0, o
helper do TypeScript retorna 1 e o do Python 0). Essas entradas não são representáveis em um relatório assinado; a
divergência é uma pendência separada e não é um requisito do protocolo.

<a id="5-evidence"></a>

## 5. Evidências

| Errata | Referências |
|--------|-------------|
| E1 | `sdks/typescript/src/core/domain-separation.ts`; `interop_vectors.json#domain_separation_all_contexts`; caso do kit `ext.wire.contexts.registry_documented` |
| E2, E4, E5 | `schemas/v2/{commissioning_certificate,vitality_report,decommissioning_record,rights_declaration,obligation_record,rights_violation_report,delegation_mandate,principal_mirror,interaction_record,awareness_threshold,advisory_declaration}.schema.json`; casos do kit `ext.wire.dcp0*.*.signed`, `ext.wire.context.*` |
| E3 | `schemas/v2/vitality_report.schema.json#/properties/vitality_score`; casos do kit `ext.wire.dcp05.vitality_field_name.schema_rejected`, `ext.wire.tamper.vitality_score_changed` |
| E6 | `schemas/v2/delegation_mandate.schema.json#/required`; `tests/interop/v2/mandate_chain_vectors.json` (`expired_at_verification_time`, `validity_*`); casos do kit `ext.wire.dcp09.effective_until.*` |
| E7, seção 4 | casos do kit `ext.wire.dcp05.fractional_metric.*`, `ext.wire.dcp08.extension_signed_but_schema_invalid`, `ext.wire.dcp05.countersignature.schema_rejected`, `ext.wire.fixture.*` |

Os casos do kit pertencem à suíte `ext.dcp05_09.wire` de [`tools/conformance`](../../../tools/conformance/README.md).
