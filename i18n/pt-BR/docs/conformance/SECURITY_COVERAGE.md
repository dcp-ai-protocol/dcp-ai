<sub>[English](../../../../docs/conformance/SECURITY_COVERAGE.md) · [中文](../../../zh-CN/docs/conformance/SECURITY_COVERAGE.md) · [Español](../../../es/docs/conformance/SECURITY_COVERAGE.md) · [日本語](../../../ja/docs/conformance/SECURITY_COVERAGE.md) · **Português**</sub>

<a id="security-guarantees-and-conformance-coverage"></a>

# Garantias de segurança e cobertura de conformidade

> Tradução informativa da [versão em inglês](../../../../docs/conformance/SECURITY_COVERAGE.md), atualizada em 09/11/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são preservados sem tradução.

Este mapa informativo relaciona os requisitos normativos aos testes executáveis do repositório. Não é um novo perfil, uma certificação, uma alegação de que todas as entradas foram testadas ou evidência de aprovação de uma implantação específica. Um resultado se aplica à implementação, entradas, política, instante de verificação e versão da ferramenta exatos registrados naquela execução.

A [lista de verificação](../../spec/VERIFICATION.md), o [perfil de canonicalização](../../spec/CANONICALIZATION_PROFILE.md) e o [perfil de admissão](../../spec/profiles/admission/README.md) continuam sendo a autoridade. Tanto uma implementação de referência quanto o kit de testes podem conter defeitos. Resolva divergências com base na especificação e em um caso reproduzível; o acordo entre implementações não determina a correção.

<a id="what-the-guarantees-mean"></a>

## O significado das garantias

| Camada | O que suas verificações demonstram | O que não demonstram |
|---|---|---|
| Esquema | A entrada tem a estrutura e os valores permitidos | Assinaturas válidas, declarações honestas, identidade do principal ou autorização |
| Verificação criptográfica | As assinaturas, hashes e relações verificados satisfazem as regras aplicáveis às chaves, política e instante fornecidos | Que o principal nomeado seja confiável, que um evento registrado tenha ocorrido ou que uma ferramenta possa ser executada |
| Confiança no principal | Os componentes verificados da assinatura do principal correspondem ao conjunto de confiança fornecido fora de banda pelo operador | Identidade além daquela fonte de confiança ou permissão para realizar uma ação |
| Admissão `strict-v1` | Verificação, confiança no principal, restrições assinadas de audiência e sessão e estado de revogação suficientemente recente satisfazem o perfil | Uso único, revogações posteriores ao snapshot ou autorização de ações |
| Aplicação pelo adaptador | A integração aplica a decisão de admissão do operador antes de seu handler protegido | Uma propriedade fornecida pelo protocolo central ou demonstrada pelo kit externo de conformidade |

`action_authorized` permanece `false`. Um registro verificado ou admitido de uma ação bloqueada ou escalada é evidência daquela decisão registrada, não permissão para executá-la. A vinculação de sessão impede a combinação de sessões inconsistentes; não consome o bundle nem o torna de uso único.

<a id="reading-the-evidence"></a>

## Como ler as evidências

O [README do kit](../../tools/conformance/README.md) define comandos, contratos, campos do relatório e códigos de saída. Suas superfícies são distintas:

- **Referência:** `tools/conformance.js` chama helpers de referência e `lib/verify.js`; este último valida esquemas V2 e delega a verificação criptográfica ao TypeScript.
- **Primitivas externas:** o contrato `/1` exercita canonicalização e resumos criptográficos por meio de uma implementação fornecida.
- **Evidências externas:** o contrato `/2` exercita raízes Merkle, assinaturas compostas e verificação de bundles V2. O repositório fornece wrappers TypeScript, Python, Go, Rust e WASM.
- **Admissão externa:** o contrato `/3` exercita admissão combinada e carregamento de configuração. O repositório fornece wrappers TypeScript, Python, Go e Rust; WASM não tem API de admissão.
- **Delegação externa:** o contrato `/4` exercita veredictos de cadeias de mandatos do DCP-09 §3.5.2. O repositório fornece wrappers TypeScript, Python, Go e Rust; WASM não tem API de cadeias de mandatos.
- **Política efetiva externa:** o contrato `/5` (opt-in) exercita a verificação de bundles V2 com o modo de verificação e o tier de segurança que o verificador resolveu nessa mesma verificação. O repositório fornece wrappers TypeScript, Python, Go, Rust e WASM.
- **Suítes de SDKs e adaptadores:** são testes separados, com seus próprios pontos de entrada e escopos. Um item no inventário do kit não é um teste executado pelo kit.

Os contratos numerados são interfaces do executor, não versões do protocolo DCP. A identidade do wrapper é autodeclarada. Cinco wrappers não são cinco adotantes externos independentes: WASM compartilha código com Rust, e todos esses wrappers pertencem ao repositório.

Um resultado negativo só é útil com um controle positivo que funcione. Alterar conteúdo assinado sem atualizar a assinatura pode provocar falha por vários motivos. Uma etiqueta `spec_step` ou uma mensagem de erro correspondente não prova, por si só, qual verificação causou a rejeição. Pares válidos e inválidos que isolam uma regra oferecem evidências mais fortes que bundles rejeitados construídos separadamente e com apenas um controle positivo da suíte.

<a id="v2-verification-map"></a>

## Mapa de verificação V2

Os nomes abaixo se referem aos [vetores de bundles](../../../../tests/interop/v2/bundle_vectors.json). `M`, `R` e `A` significam `must_reject`, `must_reject_bundles` e `must_accept_bundles`; os IDs externos têm o prefixo `external.v2.bundle_vectors.`, seguido de `must_reject`, `must_reject_bundles` ou `must_accept`, respectivamente, e depois do nome do caso. `signed_bundle` é o positivo base. São amostras selecionadas e rastreáveis, não uma lista exaustiva ou classificação de completude.

| Regra normativa | Casos ou suíte existentes selecionados | Escopo e limites restantes |
|---|---|---|
| V2-1: selecionar a versão | M `dcp_bundle_version_1_0`, `dcp_bundle_version_3_0` | Rejeição no ponto de entrada V2; não exercita todos os requisitos V1 |
| V2-2: validar esquemas do envelope e dos artefatos | Referência `v2.signed_bundle.schema_invalid_payload_rejected`; suítes de esquemas; o catálogo opcional de validação de esquemas (57 casos) | Os verificadores dos SDKs executam a V2-2 por conta própria a partir de `@dcp-ai/sdk` 2.3.0, `@dcp-ai/wasm` 2.1.3, `dcp-ai` 2.10.2 (PyPI), Go v2.13.0 e Rust `dcp-ai` 2.13.0; as versões anteriores não. Veja o limite abaixo |
| V2-3: manifesto, hashes de payload e vinculação da auditoria | M `intent_payload_hash_wrong`, `audit_entries_truncated`; R `manifest_intent_hash_mismatch`, `audit_chain_hash_wrong`; A `empty_audit_trail` | Amostras de vinculação de hashes e cadeia; não cobertura isolada de cada campo e forma malformada |
| V2-4: sessão, tempo e consistência de metadados não assinados | R `intent_session_nonce_differs`, `session_expired_with_offset`, `session_longer_than_policy_max_with_late_created_at`; M `signature_signer_id_other`; A `session_duration_at_millisecond_precision` | Testes com instante fixo; distinguir política solicitada e modo efetivo |
| V2-5: estrutura de assinaturas e codificação canônica | M `bundle_classical_sig_b64_with_trailing_bits`, `intent_classical_sig_b64_unpadded`; R `classical_only_bundle_signature_without_pq` | As amostras de codificação não cobrem todas as posições de assinatura nem combinações de defeitos |
| V2-6: o principal assina o manifesto | R `bundle_signed_by_agent_keys`; referência `v2.signed_bundle.forged_classical_signature_rejected` | Amostras de assinaturas e vinculação de papéis; não estabelecem confiança em um principal autodeclarado |
| V2-7: verificar assinaturas PQ presentes | M `bundle_pq_signature_invalid`, `bundle_pq_slot_holds_ed25519` | O catálogo histórico de evidências as exercita com sua política selecionada; alegar todos os modos efetivos exige controles correspondentes |
| V2-8: verificar cada artefato com seu contexto e papel de signatário | M `rpr_classical_signature_invalid`, `intent_signed_by_principal`, `policy_decision_signed_under_intent_context` | Amostras de artefatos e papéis; não todas as combinações de componente, contexto e chave |
| V2-9: derivar o nível sem permitir que uma declaração o reduza | R `classical_only_intent_action_type_constructor`, `classical_only_intent_security_tier_constructor` | Amostras de veredictos; a operação de bundle de `/2` não avalia o nível resolvido informado; o catálogo de política efetiva de `/5` avalia |
| V2-10: exigir modo efetivo e política de algoritmos | R `classical_only_payment_from_low_risk_passport`; `classical_only_routine` em quatro modos | Amostras de modos; o catálogo histórico de evidências não tem matriz específica de listas de algoritmos permitidos e advisories |
| V2-11: verificar campos secundários presentes | `external.v2.secondary_sha3`, dos [vetores secundários](../../../../tests/interop/v2/secondary_sha3_vectors.json) | Controles positivos e campos malformados ou divergentes; vínculos ausentes são opcionais, portanto aceitação não implica cadeia secundária completa |
| V2-12: vincular e verificar checkpoints | A `pq_checkpoint_over_the_trail`; R `pq_checkpoint_listed_but_missing`, `pq_checkpoint_event_range_count_wrong`, `pq_checkpoint_pq_signature_invalid` | Amostras de pertinência, intervalo e assinaturas; não todas as combinações de intervalos ou componentes malformados |
| V2-13: derivar IDs de chave e exigir sua validade | R `passport_key_kid_not_derived`, `passport_key_public_key_with_trailing_bits`, `rpr_binding_key_revoked` | Amostras de chave, codificação e estado; não cobertura exaustiva de políticas de chaves |
| V2-14: consistência entre artefatos | R `passport_principal_binding_reference_other`, `audit_entry_policy_decision_other`; A `blocked_action_recorded`, `escalated_action_recorded` | Consistência das evidências é distinta de permissão para agir |

As expectativas do corpus devem ser interpretadas com a política declarada, os ajustes por caso e o instante de verificação. Um bundle híbrido positivo pode ser verificado sob `pq_only`; conter os bytes clássicos necessários à vinculação não o torna um controle negativo. Uma política solicitada `classical_only` pode resultar em um modo efetivo mais rigoroso devido ao nível da ação.

<a id="schema-and-cryptographic-api-boundary"></a>

### Limite entre esquema e API criptográfica

V2-2 exige validação de esquemas. A partir de `@dcp-ai/sdk` 2.3.0, `@dcp-ai/wasm` 2.1.3, `dcp-ai` 2.10.2 (PyPI), Go v2.13.0 e Rust `dcp-ai` 2.13.0, os verificadores V2 dos SDKs TypeScript, Python, Go, Rust e WASM a executam por conta própria: `verifySignedBundleV2` e seus equivalentes, a API combinada de admissão, que verifica primeiro, e o verificador experimental do candidato; avaliar a admissão a partir de um resultado de verificação anterior não a executa de novo. As versões anteriores dos SDKs não a incluem. A barreira valida o envelope do bundle assinado e os quatro payloads (`responsible_principal_record`, `agent_passport`, `intent`, `policy_decision`) contra `schemas/v2`. Ela roda depois das verificações de política e de relógio do verificador, e antes de o verificador conferir o manifesto, os hashes dos payloads, as chaves e as assinaturas. Todos os SDKs interpretam a mesma representação gerada a partir de `schemas/v2` (`tools/schema-ir/`); a CI a regenera e compara as cópias.

- **Objetos fechados e abertos.** Um membro desconhecido de um objeto fechado (`additionalProperties: false`, por exemplo o envelope, `SignedPayload`, `composite_sig`, as entradas de auditoria e os checkpoints) é rejeitado mesmo quando hashes e assinaturas continuam válidos. Em um objeto aberto, como o `target` do intent ou a `evidence` de auditoria, os membros declarados mantêm suas restrições (`target.channel`, por exemplo, é obrigatório e enumerado); apenas os membros adicionais que o esquema não descreve deixam de ser inspecionados nesta camada, e os que estão sob um compromisso podem chegar à canonicalização. Um membro adicional do próprio objeto `bundle` é aceito: o esquema deixa `bundle` aberto, o membro não está sob nenhum compromisso (ao contrário dos artefatos assinados e do manifesto que o bundle contém) e nenhuma verificação posterior o lê.
- **Ausente e `null`.** São rejeitados tanto um membro obrigatório ausente quanto um `null` onde o esquema espera outro tipo, com diagnósticos diferentes (`required`, `type`). `session_issued_at` e `session_expires_at` do manifesto devem ser strings quando presentes: `null` é rejeitado.
- **Diagnósticos.** Uma falha de esquema retorna `verified: false` com erros da forma `schema: <JSON pointer> <keyword>[ <member>]`, no máximo 16 seguidos de `schema: further errors not listed`, nunca com valores da entrada e sem detalhes criptográficos. Uma rejeição que antes era relatada por uma verificação mais profunda pode agora trazer um diagnóstico de esquema; uma falha de esquema não mostra que a verificação profunda foi executada.
- **Sobreposição do candidato.** Na rota experimental `dcp-jcs-v2`, que quem chama seleciona explicitamente, a única diferença é o `canonicalization_profile` do manifesto, que deve ser `dcp-jcs-v2`. O perfil padrão e os bytes assinados não mudam.
- **`date-time`.** A verificação de formato é a que o verificador de referência aplica, ajv-formats 3.0.1 no modo full, com suas particularidades: qualquer espaço em branco ECMAScript ou `t` como separador, offsets `+hh` e `+hhmm`, e um segundo 60 quando o horário deslocado pelo seu offset é 23:59. É uma fronteira de compatibilidade da camada de esquema, não RFC 3339 estrito. Os parsers temporais de V2-4, V2-13 e V2-14 continuam sendo uma camada separada e posterior, e ainda podem rejeitar um horário que o esquema aceita.
- **Os parsers vêm primeiro.** O que um parser JSON recusa nunca chega à V2-2. O Go relata uma raiz que não é um objeto com seu erro de parsing histórico; a API do Rust recebe um `serde_json::Value` já parseado, então as recusas do serde_json (um surrogate isolado, `1e400`) cabem a quem chama; o binding WASM mantém antes da V2-2 seu erro de parsing da política, `JSON parse error` e a detecção de versão.
- **Mudança de aceitação.** Bundles inválidos pelo esquema que os verificadores dos SDKs aceitavam antes agora retornam `verified: false`. Nenhuma API só de esquema é adicionada, e nenhum esquema ou perfil muda.

Quem alegar cumprir toda a lista V2 precisa contemplar V2-2 e as verificações criptográficas. Não enfraqueça o esquema nem descreva uma API parcial como uma validação completa para fazer um teste passar. O kit relata essas camadas separadamente.

Membros desconhecidos não são universalmente proibidos. Alguns objetos do esquema são abertos. A aceitação pelo esquema de uma extensão em um objeto assinado não preserva a assinatura antiga: hashes e assinaturas devem ser recalculados quando o conteúdo assinado muda. Nenhum novo mecanismo de extensões obrigatórias é definido aqui.

O [catálogo de validação de esquemas](../../../../tools/conformance/external-schema-validation-catalog.json), de uso explícito, executa 57 casos assinados em uma implementação: 13 positivos e 44 negativos, cada um contado apenas quando o caso base é verificado na mesma execução. A CI o executa com os cinco wrappers de SDK. O [catálogo diagnóstico de esquemas](../../../../tools/conformance/external-schema-catalog.json), de uso explícito, mantém 15 casos de fechamento: a base e as extensões permitidas são controles positivos; extensões de objetos fechados e valores fora de uma enumeração preservam a rejeição normativa. Um caso SDK com falha continua sendo uma falha, e passar em qualquer um dos dois catálogos cobre apenas os seus casos. O relatório separado de `tools/conformance/schema-boundary.js` distingue validação de esquemas, integridade do corpus finito e composição de esquema com SDK no instante do corpus. Essa composição não comprova que o SDK sozinho implemente V2-2, e o helper de integridade não é um verificador normativo geral.

<a id="verifier-policy-samples"></a>

### Amostras de política do verificador

O [catálogo de políticas](../../../../tools/conformance/external-policy-catalog.json), de seleção explícita, versão 2.0, acrescenta 108 casos em duas suítes pelo contrato `/2` existente. A primeira suíte mantém os 74 casos da versão 1.1: 10 controles positivos, 24 casos de PQ presente inválida, 14 casos de listas de algoritmos e advisories e 26 casos de tier já versionados. A segunda executa os 34 casos do esclarecimento de V2-10 (abaixo). Cada solicitação leva sua política e seu instante de verificação exatos. O catálogo de evidências padrão permanece inalterado, e a versão 1.1 está arquivada byte a byte como [`external-policy-catalog-1.1.json`](../../../../tools/conformance/external-policy-catalog-1.1.json).

O novo controle híbrido de tier routine exercita `classical_only` efetivo e os outros três modos. O controle híbrido de tier standard eleva uma solicitação `classical_only` a `hybrid_preferred`. O corpus registra essa derivação; `/2` avalia o veredicto, não o tier nem o modo efetivo informado pela implementação. O catálogo opt-in de política efetiva (abaixo) os avalia pelo contrato `/5`.

Os negativos PQ alteram somente a assinatura PQ do bundle, passaporte ou checkpoint; o componente clássico continua válido. Os casos de listas mantêm o mesmo bundle e alteram apenas a política. Os casos de tier reutilizam bundles versionados assinados separadamente e um controle routine sob o mesmo modo solicitado: não são pares de alteração única. Cada negativo exige que seu controle positivo passe na mesma execução.

O esclarecimento do passo V2-10 do [VERIFICATION.md](../../../../spec/VERIFICATION.md) (05/11/2026) resolve as três questões do corpus. [`verifier_policy_clarification_vectors.json`](../../../../tests/interop/v2/verifier_policy_clarification_vectors.json) contém os seus casos, com bases routine para que cada modo solicitado seja o efetivo:

- **Q1.** Sob `pq_only`, as exclusões de listas e advisories clássicos aceitam um bundle híbrido; sob `hybrid_required` as mesmas políticas o rejeitam.
- **Q2.** Na assinatura do bundle, no passaporte e no checkpoint, um componente clássico que falha enquanto o componente PQ verifica sobre esses bytes clássicos é aceito sob `pq_only` e rejeitado nos outros três modos. Um `sig_b64` clássico não canônico e um kid clássico desconhecido são rejeitados sob `pq_only`.
- **Q3.** As exclusões de listas e advisories PQ aceitam o bundle somente clássico sob `classical_only` e `hybrid_preferred`, e rejeitam o bundle híbrido sob a mesma política.

`verifier_policy_vectors.json` conserva como histórico os seus casos Q1 omitidos. Os casos são uma amostra dessas regras: não cobrem todas as localizações, algoritmos ou estados de chave. Uma combinação não testada não demonstra, por si só, uma contradição na especificação. São amostras de política: a validação de esquemas (V2-2) tem o seu próprio catálogo e roda dentro dos verificadores dos SDKs a partir das versões de 05/11/2026, não nas anteriores. As amostras não estabelecem conformidade V2 completa.

<a id="structural-samples"></a>

### Amostras estruturais

O [catálogo estrutural](../../../../tools/conformance/external-structural-catalog.json), de seleção explícita, acrescenta 16 casos por meio de `/2`: dois controles positivos e 14 negativos sobre codificação de assinaturas, componentes e intervalos de checkpoints, compromissos do manifesto, um payload com fração, ordem temporal da sessão e uma assinatura clássica do bundle invalidada com sua assinatura PQ recalculada corretamente. O modo efetivo é `hybrid_preferred`; esses negativos clássicos não fazem afirmações sobre `pq_only`.

Os quatro casos de codificação preservam os bytes decodificados da assinatura. Os intervalos dos checkpoints usam posições reais da trilha, com identificadores deliberadamente fora de ordem. As mutações do manifesto são assinadas novamente. A sessão invertida tem um gêmeo positivo separado dentro da tolerância do relógio. Cada negativo exige que seus controles passem na mesma execução.

O isolamento tem limites explícitos: uma fração não tem representação `dcp-jcs-v1`, portanto seus hashes e assinaturas anteriores ficam obsoletos; um intervalo invertido não tem raiz válida para esse intervalo. As verificações dos componentes documentam os defeitos previstos, mas não identificam qual verificação do SDK causou a rejeição. São amostras estruturais: a validação de esquemas (V2-2) tem o seu próprio catálogo e roda dentro dos verificadores dos SDKs a partir das versões de 05/11/2026, não nas anteriores. As amostras não provam conformidade completa.

<a id="effective-mode-and-tier"></a>

### Modo e tier efetivos

O [catálogo de política efetiva](../../../../tools/conformance/external-effective-policy-catalog.json), opt-in, executa 130 casos pelo contrato `/5`: o veredicto, e o modo de verificação e o tier de segurança que o verificador da implementação resolveu nessa mesma verificação, como são devolvidos e nunca recalculados pelo kit. 112 casos exigem os dois valores: os 94 casos de política do verificador e do esclarecimento cujos bundles passam em V2-2, 17 casos assinados que acrescentam positivos válidos nos tiers elevated e maximum em cada modo solicitado, limites de `risk_score`, pisos de `security_tier` explícito e declarado e overrides do passaporte que substituem o padrão, e um controle. Em 14 casos cujos bundles falham em V2-2, e em 4 rejeições anteriores, os valores podem faltar; os valores informados ainda devem ser conhecidos e coerentes. Os SDKs diferem em resolver ou não os valores depois de uma falha anterior, e as duas condutas são aceitas. Implementações controladas mostram que o juiz reprova um wrapper que informa o modo solicitado ou o modo padrão, só o piso do tier, um tier declarado ou o `resolved_tier` da decisão de política. O piso da cadeia DCP-09, a API JavaScript de `@dcp-ai/wasm` e os navegadores não são cobertos, e um pass cobre só estes casos.

<a id="admission-map"></a>

## Mapa de admissão

Os [vetores compartilhados de admissão](../../../../tests/interop/v2/admission_vectors.json) e o [catálogo externo de admissão](../../../../tools/conformance/external-admission-catalog.json) exercitam os grupos abaixo pela API de admissão combinada e pelos carregadores de configuração. Leia a `rule`, as entradas e os campos esperados exatos de cada caso; o nome do grupo não prova cobertura exaustiva.

| Requisito | Superfície exercitada | Limite |
|---|---|---|
| T1–T2: principal e chaves dos componentes ancorados na confiança do operador | `external.admission.outcomes` | A confiança é fornecida fora de banda; o kit não estabelece uma identidade do mundo real |
| P1–P4: V2, audiência assinada, janela de sessão assinada e assinaturas híbridas do principal | Resultados e casos compostos | Verificações estruturais e verificadas são diferentes; nem todas as combinações de valores malformados são enumeradas |
| R1–R5: disponibilidade, forma e idade dos snapshots, e estado do sujeito | Resultados | Um snapshot recente não comprova eventos de revogação posteriores ao seu `checked_at` |
| Configuração: rejeitar campos desconhecidos, confiança malformada e enfraquecimento do perfil | `external.admission.config` | Casos com vários defeitos podem permitir mais de um erro normativo; a redação incidental da mensagem não é a regra |
| Procedimento combinado e resultado | Resultados e casos compostos | Avaliam-se `action_authorized:false`, decisões registradas e resultados de confiança e perfil; a saída completa de `signer_keys` não é comparada diretamente |
| A1–A3: handler protegido, configuração do operador, fontes, tenant e cache | Testes separados de adaptadores | Fora deste kit externo; um resultado SDK não comprova a aplicação das regras pela integração |

Um avaliador que aceita um resultado de verificação pré-calculado confia que seu chamador fornece o resultado para o mesmo bundle, política e instante. A operação externa de admissão usa a API combinada. Um teste combinado aprovado não torna seguro qualquer objeto de verificação fornecido por um chamador.

<a id="delegation-map"></a>

## Mapa de delegação

O [catálogo externo de delegação](../../../../tools/conformance/external-delegation-catalog.json), versão 2.0.0, executa os vetores versionados de [cadeias de mandatos](../../../../tests/interop/v2/mandate_chain_vectors.json), [tempos de cadeia](../../../../tests/interop/v2/mandate_chain_time_vectors.json) e [domínios repetidos](../../../../tests/interop/v2/mandate_domain_vectors.json) por meio de `verify_mandate_chain`. Cada caso normativo nomeia a sua regra do [DCP-09 §3.5.2](../../../../spec/DCP-09.md); são julgados o veredicto e, para uma cadeia aceita, o nível efetivo.

| Requisito | Superfície exercitada | Limite |
|---|---|---|
| Regras 1–2: assinaturas da raiz e do submandato, papéis e contextos dos signatários, vínculos com o pai, profundidade e `human_id` | `external.delegation.chain` | As chaves são dadas na requisição; o kit não estabelece que sejam as do principal ou dos agentes |
| Regra 3: permissão de subdelegação e profundidade máxima | `external.delegation.chain` | As cadeias versionadas, não todas as profundidades |
| Regra 4: janelas de validade, seu aninhamento e o horário de verificação como instantes RFC 3339, comparados em milissegundos | `external.delegation.chain`, `external.delegation.chain_time` | A precisão de milissegundos é normativa desde o esclarecimento do §3.5.2 (05/11/2026); a versão 1.0.0 do catálogo, arquivada, mantinha esses três casos informativos |
| Regras 1–2: cada chave signatária ativa, com o seu `expires_at` ausente, `null` ou não anterior ao horário de verificação (esclarecimento de 05/11/2026) | `external.delegation.chain_time` | Sete casos sobre `expires_at`; nenhum caso tem uma chave cujo `status` não seja `active`. A versão 1.0.0 mantinha esses sete informativos |
| Regra 5: atenuação de ações, classes de dados e limites; limites dentro de ±(2^53 − 1); um domínio repetido no mesmo mandato | `external.delegation.chain`, `external.delegation.domains` | Os textos de erro são diagnósticos; uma rejeição é julgada pelo seu veredicto |
| Regra 6: piso de nível e nível efetivo | `external.delegation.chain` | O nível efetivo é julgado nas cadeias aceitas; `tier_floor` (`computeSecurityTier`) fica fora do catálogo |
| Regra 7: revogação da raiz ou de um mandato intermediário | `external.delegation.chain` | A revogação é o conjunto local de ids revogados da requisição, não uma fonte de revogação |

Uma rejeição só conta com o seu controle, uma cadeia aceita normativa cuja relação com ela (`same_chain`, `single_mandate`, `same_shape` ou `suite`) é verificada sobre os bytes. Nenhuma dessas relações mostra que os dois casos diferem por um único defeito. Uma cadeia verificada não é admissão nem autorização.

A versão 1.0.0 do catálogo, arquivada byte a byte como [`external-delegation-catalog-1.0.0.json`](../../../../tools/conformance/external-delegation-catalog-1.0.0.json), julga 87 casos e informa à parte dez informativos; a versão 2.0.0 julga os 97. O runner fixa a classificação de cada versão, então um relatório 1.0.0 é evidência só da 1.0.0.

<a id="differential-samples"></a>

### Amostras diferenciais

Os [harnesses diferenciais](../../../../tools/difffuzz/README.md) comparam os SDKs sobre os mesmos bytes; a concordância nunca é o oráculo.

- **Cadeias de mandatos.** `run-mandates.mjs` envia cadeias DCP-09 reassinadas aos quatro verificadores de cadeia pelo contrato `/4`: cada execução cobre 73 variantes em cada profundidade a que se aplicam (167 casos) e depois mutantes aleatórios limitados. Só os casos ancorados no §3.5.2, no perfil de canonicalização ou na RFC 8259 contam como evidência de regra. As observações e os casos cuja atribuição é limitada por um valor não assinável ou pela representação numérica são informados à parte; uma discordância entre eles continua a ser um achado.
- **Bundles com WASM.** `run.mjs --sdks five` acrescenta aos quatro verificadores de bundles o SDK Rust compilado para WASM, executado pelo Node. Os achados de quatro SDKs nunca são lidos como evidência de cinco.

Uma campanha finita mostra que esses casos concordam ou registra onde não concordam; não é exaustiva. O WASM não verifica cadeias de mandatos, e as entradas que o contrato `/4` não leva a todos os SDKs (um token `NaN`, uma marca de ordem de bytes, `1e400`) são medidas por uma sonda de transporte à parte: a recusa de um wrapper nunca conta como rejeição do SDK, e a rejeição que os SDKs de TypeScript e Python devolvem para `1e400` não credita nenhuma regra semântica.

<a id="local-source-additions-07112026"></a>

## Acréscimos do código-fonte local (07/11/2026)

Estas linhas foram escritas para o código-fonte local de 07/11/2026; estão publicadas, sem mudanças, em `@dcp-ai/sdk` 2.4.0, `dcp-ai` 2.11.0, Go v2.14.0 e Rust `dcp-ai` 2.14.0 (09/11/2026). Cada uma é
exercitada por vetores compartilhados que as quatro suítes dos SDKs executam; o kit externo ainda não tem um contrato para
elas, então um resultado do kit não diz nada sobre estas regras. Nenhuma é uma afirmação de conformidade completa nem de
prontidão empresarial.

**Superfícies opcionais.** Só são usadas pelo código que as chama.

| Requisito | Superfície exercitada | Limite |
|---|---|---|
| Admissão delegada ([perfil de admissão § 10](../../../../spec/profiles/admission/README.md#10-delegated-admission-opt-in)) | [`delegated_admission_vectors.json`](../../../../tests/interop/v2/delegated_admission_vectors.json): 71 casos e 6 casos de configuração | Verificada só em `now`; `delegation_active` e `action_authorized` são `false`; sem API no WASM |
| Admissão a partir de bytes (§ 11) | [`v1_ingress_vectors.json`](../../../../tests/interop/v2/v1_ingress_vectors.json): 26 casos e 30 diferenças de domínio | Os orçamentos de tamanho e de tempo ficam fora; as funções sobre valores já analisados não podem recuperar o que seu parser perdeu |
| Confirmação de mandato e ativação ([DCP-09 § 3.3.1](../../../../spec/DCP-09.md#331-mandate-acknowledgment-opt-in), § 12) | [`mandate_acknowledgment_vectors.json`](../../../../tests/interop/v2/mandate_acknowledgment_vectors.json): 93 casos em TypeScript e Python; 89 em Go e Rust, que excluem explicitamente os 4 casos cujos contêineres não são listas, porque sua API tipada não pode carregá-los | Declarações assinadas, não prova de cronologia nem de compreensão; sem autorização; sem verificação global contra repetição; sem ativação a partir de bytes; sem API no WASM |

**Verificação Ed25519 (perfil criptográfico).** Aplica-se a toda assinatura Ed25519 que os verificadores dos SDKs verificam.

| Requisito | Superfície exercitada | Limite |
|---|---|---|
| [P-ED-1](../../../../spec/profiles/crypto/README.md#p-ed-1-ed25519-acceptance-criterion) em objetos V1 e no provedor V2 padrão | [`ed25519_ped1_vectors.json`](../../../../tests/interop/v2/ed25519_ped1_vectors.json) e seu verificador, nas quatro suítes dos SDKs; o provedor de Rust executado em `wasm32` | Desde 08/11/2026, também o verificador de referência, o caminho V1 da CLI e o playground, e WASM no Node e no Chrome: veja [Interfaces públicas](#public-interfaces-mp-03-08112026), que indica quem o herda de um SDK instalado. Um provedor próprio é responsabilidade do operador |

<a id="public-interfaces-mp-03-08112026"></a>

## Interfaces públicas (MP-03, 08/11/2026)

Foi escrita para o código-fonte local de 08/11/2026: os SDKs, `@dcp-ai/wasm` 2.2.0 e `@dcp-ai/cli` 2.2.0 publicados em 09/11/2026 contêm o que ela descreve, enquanto o verificador de referência, o servidor, o playground e o kit são usados a partir do repositório. Para cada capacidade, nomeia a função pública
pela qual ela passa e a evidência que a alcança ali.

- **WASM** é a classe `DcpWasm` de `@dcp-ai/wasm`.
- **Cru** se refere aos seus exports do wasm-bindgen (`@dcp-ai/wasm/pkg`), executados no Node.
- As execuções no **Chrome** passam pelo [wrapper de navegador](../../tools/conformance/README.md#browser-wrapper-dcpwasm-in-chrome) do kit.

| Capacidade | TypeScript, Python, Go, Rust | WASM | Não se afirma |
|---|---|---|---|
| Bytes canônicos `dcp-jcs-v1` e digests | Kit `/1` (38) | `/1` cru (38). No Chrome, `/1` (38): a canonicalização por `DcpWasm.canonicalize` após `JSON.parse`, os digests por `dualHash` e `sha3_256` sobre o texto | Bytes que um parser já mudou (veja a tabela de parsing abaixo) |
| Verificação V2: bundles, raízes Merkle, assinaturas compostas | Kit `/2` (241: 211 casos de bundle, 24 compostos e 6 Merkle), política (108), estrutura (16), esquema (57), `/5` (130) | Os mesmos catálogos crus (552 casos; 590 com `/1`). No Chrome, cada um pelo seu próprio método de `DcpWasm`: os bundles por `verifyBundle`, os casos compostos por `compositeVerify`, os casos Merkle por `dualMerkleRoot` | Admissão, confiança, autorização |
| Assinaturas compostas, separação de domínio, nível de segurança | Casos compostos do kit `/2` (24); vetores de interop nas suítes dos SDKs | Chamadas diretas no Chrome (103): `domainSeparatedMessage` 20 (os 19 contextos dos vetores de interop e `MandateAcknowledgment`), `computeSecurityTier` 79, 2 ciclos híbridos de assinatura e verificação com negativos de payload, contexto e assinatura, e as 2 pré-imagens compostas de P-ED-1 | `/5` não exercita `computeSecurityTier`: lê o modo e o nível que `verifyBundle` informa |
| P-ED-1 | O corpus nas quatro suítes dos SDKs | O provedor de Rust em `wasm32` no Node: 67 casos de provedor, 4 objetos V1 e 2 casos compostos com uma chave ML-DSA-65 real. No Chrome: as 2 pré-imagens compostas por `compositeVerify`, com um binding `classical_only` | O corpus completo por `DcpWasm`, que não tem um método Ed25519 cru |
| Admissão `strict-v1` | Kit `/3` (140) | Sem suporte | — |
| Cadeias de mandatos | Kit `/4` (97) | Sem suporte | — |
| Admissão delegada, admissão a partir de bytes, ativação | As suítes dos SDKs acima, e os erros de configuração das funções de bytes e de ativação | Sem suporte | Um contrato do kit |

WASM não tem API de cadeias de mandatos, de admissão ou de ativação. É o escopo do piloto (D-04), não um limite dos
navegadores: o backend de uma aplicação de navegador verifica as delegações e admite com um dos quatro SDKs. Uma
admissão calculada num navegador a partir de entradas que o cliente controla não autoriza nada num servidor.

**P-ED-1 fora dos SDKs.** Um verificador que calcula Ed25519 ele mesmo com o TweetNaCl verifica primeiro P-ED-1. Usa
uma de três cópias idênticas de um helper de bytes: `tools/`, `cli/lib/` e `playground/js/core/ed25519-ped1.js`. Todos os
outros verificadores obtêm P-ED-1 apenas do SDK que carregam.

| Verificador | Caminho Ed25519 | P-ED-1 |
|---|---|---|
| V1 de referência (`verifyObject` de `tools/crypto.js`): V1 de `lib/verify.js` e `bin/dcp.js`, gossip do transparency log, serviço de revogação | Sua própria verificação e depois o TweetNaCl | No código-fonte; `tools/ed25519-ped1-consumers.test.mjs` |
| `dcp-ai verify` sobre arquivos V1 | Sua própria verificação (`cli/lib/ed25519-ped1.js`) | No código-fonte e em `@dcp-ai/cli` 2.2.0; não em 2.1.1 nem anteriores |
| `dcp-ai verify` sobre arquivos V2, V2 de referência, servidor | O `@dcp-ai/sdk` instalado | Somente com um SDK que o tenha: `@dcp-ai/sdk` 2.4.0, não 2.3.0 nem anteriores nem as cópias instaladas a partir delas. A CI compila e instala o SDK do workspace |
| Playground (uma demo cujas assinaturas PQ são simuladas) | Sua própria verificação | No código-fonte |
| Express, OpenClaw | `@dcp-ai/sdk` fixado em 2.2.0 | Não com o lock; a CI também executa seus testes com o SDK do workspace |
| Anthropic MCP, Google A2A | `@dcp-ai/sdk` fixado em 2.2.0 | Não se aplica (um limite registrado) |
| FastAPI, LangChain, OpenAI, CrewAI | O SDK de Python desta árvore | Aplica-se |

Os locks acima são os do repositório. Uma instalação dos adaptadores publicados a partir do npm resolve `@dcp-ai/sdk` 2.4.0 pelo intervalo `^2.2.0` deles, a menos que um lockfile mantenha uma versão anterior, e recebe P-ED-1 com ele; essa resolução foi verificada para `@dcp-ai/express` 2.1.0.

**Erros, rejeições e resultados ausentes.** Cada função pública mantém seu próprio contrato de erros; nenhum é
normalizado. P-ED-1 só rejeita entradas que passaram pelas verificações anteriores de tipo, tamanho e decodificação da
função: o que era um erro continua sendo. No kit e no harness de navegador, um `error`, `unsupported`, um caso
ausente, uma queda ou um prazo esgotado nunca satisfazem uma rejeição esperada.

| Função | Rejeitado | Erro |
|---|---|---|
| Provedor Ed25519, `verifyObject` de V1 (SDKs, referência, CLI, playground) | `false`: S >= L, P-ED-1 ou a equação | Cada um o seu, e base64 inválido só onde a função decodifica base64 (a chave de um provedor, a assinatura e a chave de `verifyObject`). TypeScript e o verificador de referência lançam um erro diante de base64 inválido e de uma assinatura ou chave decodificadas de tamanho incorreto; o `verifyDetached` do playground recebe bytes e lança um erro diante de um tamanho incorreto ou de um valor que não é um `Uint8Array`. Python lança o `ValueError` do PyNaCl diante de um tamanho incorreto. Go devolve `false` diante de um comprimento de assinatura incorreto e um erro diante de um comprimento de chave incorreto. Rust devolve erros diante de qualquer um dos dois comprimentos e de uma chave que não se descomprime. A CLI sai com 1 diante de INVALID e de erros, e com 0 só diante de VALID |
| `compositeVerify` | `valid: false`, com o veredito de cada componente | A falta de assinatura PQ com `pq_over_classical` é um erro em Rust e por WASM; TypeScript, Python e Go devolvem booleanos |
| Verificação de bundles | `verified: false` com diagnósticos, também para entradas malformadas | O `verifyBundle` de WASM informa da mesma forma seus próprios erros de parsing do JSON e da política |
| Admissão `strict-v1` (`admitSignedBundleV2`) | `admitted: false` e códigos; `action_authorized` é sempre `false` | `AdmissionConfigError` (em Go, `*AdmissionConfigError`). Um perfil inválido, ou um perfil passado junto com uma política de verificador, é recusado antes de verificar o bundle. Onde os demais erros de configuração são detectados depende do SDK: um perfil sem trust set, por exemplo, durante a admissão após a verificação em TypeScript (`evaluateAdmissionV2`), e antes dela em Rust. Em qualquer caso, um erro e nenhum resultado |
| Admissão delegada, ativação | Admissão delegada: `admitted: false` e códigos. Ativação: `composition` (o resultado da admissão delegada), `activation`, `delegation_active` e os códigos `ACK_*`. `action_authorized` é sempre `false` | `AdmissionConfigError` diante de uma configuração do operador inválida, antes de ler qualquer evidência |
| Admissão a partir de bytes | A rejeição do ingresso é um resultado: `ingress.accepted: false`, com sua camada e sua classe, e sem admissão | O ingresso decide primeiro, e os bytes aceitos são depois admitidos como em `admitSignedBundleV2`, com seus erros de configuração (em Rust, `IngressError::Config`). Uma entrada que não são bytes é um `TypeError` em TypeScript e Python |
| Métodos de `DcpWasm` | Conforme o binding informa | `Error('<method>: …')`. `canonicalize` lê o `wasm_canonicalize_v2_result` rotulado; `hashObject` e `deriveKid` só devolvem seu formato hexadecimal. Os exports crus mantêm `{"error": …}` em banda, e `wasm_canonicalize_v2` não consegue distingui-lo de um valor cuja forma canônica é esse objeto |

Os testes que sustentam esta tabela:

- os testes do corpus P-ED-1 de cada SDK;
- `sdks/wasm/test/interface-errors.mjs` e `sdks/wasm/test/schema-v2.mjs`;
- os testes de erros de configuração `e5-config-errors.test.ts`, `test_e5_config_errors.py`, `e5_config_errors_test.go` e
  `tests/e5_config_errors.rs`.

**Quem faz o parsing.** Nenhuma função repara a entrada de outra: cada uma lê o que seu parser produziu.

| Função | Parser | Verificações antes do parser |
|---|---|---|
| `verifySignedBundleV2`, `admitSignedBundleV2` e seus equivalentes de Python e Rust | O de quem chama (`JSON.parse`, `json.loads`, `serde_json`) | Nenhuma |
| `VerifySignedBundleV2At` e `AdmitSignedBundleV2` de Go | O `encoding/json` do SDK, sobre `[]byte` | Nenhuma: receber bytes não é o ingresso da [admissão § 11](../../../../spec/profiles/admission/README.md#11-admission-from-bytes-opt-in) |
| A função de admissão `FromBytes` de cada SDK | O SDK | O ingresso: scanner, domínio portável e depois a comparação do parser, antes da admissão |
| Métodos de `DcpWasm` | O `JSON.parse` de quem chama, e depois `serde_json` sobre o que `JSON.stringify` escreve | Nenhuma, e nenhuma é possível: o valor de JavaScript já passou pelo parsing |
| Exports crus de WASM | `serde_json` sobre o texto | Nenhuma |
| `experimentalCandidateIngress` e seus equivalentes | O do próprio candidato experimental | Seu scanner. Não é o ingresso do § 11 e não muda nada em `dcp-jcs-v1` |

<a id="claims-for-core-and-profiles"></a>

## Alegações sobre o núcleo e os perfis

| Superfície | O que pode ser relatado a partir do kit | O que deve permanecer separado |
|---|---|---|
| Representação de dados do núcleo | Bytes canônicos e resumos `dcp-jcs-v1` exatos que foram testados | Entradas não testadas e o candidato experimental |
| Verificação de evidências V2 | Resultados dos casos selecionados de bundle, Merkle e assinaturas | Conformidade V2 completa, especialmente cobertura de esquemas, salvo comprovação separada |
| Primitivas criptográficas | Separação de domínios, verificação de componentes e vinculação testadas | Política do verificador, confiança no principal e admissão |
| Admissão `strict-v1` | Resultados dos casos selecionados de admissão e configuração | Aplicação das regras na implantação e autorização de ações |
| V1 | Verificações de esquema e integridade de referência sobre fixtures versionados | Conformidade V1 independente de terceiros |
| A2A e governança | Somente as regras específicas exercitadas por uma suíte identificada | Conformidade funcional completa de qualquer um dos perfis |
| DCP-05 a DCP-08 | As verificações declaradas das suítes internas de esquemas e intercâmbio | Semântica completa de ciclo de vida, direitos ou outra destes documentos |
| DCP-09 | As verificações declaradas das suítes internas de esquemas e intercâmbio, e os veredictos dos casos selecionados de cadeias de mandatos do catálogo externo de delegação | Semântica completa de delegação, a função auxiliar de validade, a confiança nas chaves, a admissão ou a autorização de ações |
| `dcp-jcs-v2` experimental | Seus testes experimentais selecionados separadamente | Status normativo ou padrão; `dcp-jcs-v1` permanece inalterado |

O resultado de um subconjunto deve identificá-lo e explicar seus limites. Não transforme `unsupported`, um caso ausente, uma queda, um timeout ou uma matriz ignorada em um caso aprovado. Um teste SDK reservado que retorna sem executar sua matriz não comprova que a matriz foi executada.

<a id="further-validation"></a>

## Validação adicional

O [dossiê de auditoria](AUDIT_DOSSIER.md) dá a base da revisão, os comandos de reprodução, a proveniência dos artefatos e os limites conhecidos. O [guia do implementador](IMPLEMENTER_GUIDE.md) descreve como reproduzir e relatar resultados de forma independente. Implementação externa e revisão independente de segurança são marcos adicionais; os testes deste repositório não os substituem.

As medições de desempenho usam seu próprio [executor documentado](../../tools/conformance/README.md#performance-baseline). Medir o tempo de ponta a ponta não atribui custo a uma primitiva criptográfica nem comprova a ausência de saídas antecipadas. Otimize somente após medir um custo específico, preservando as decisões de verificação e a compatibilidade.
