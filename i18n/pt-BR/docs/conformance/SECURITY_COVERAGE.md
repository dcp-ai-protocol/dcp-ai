<sub>[English](../../../../docs/conformance/SECURITY_COVERAGE.md) · [中文](../../../zh-CN/docs/conformance/SECURITY_COVERAGE.md) · [Español](../../../es/docs/conformance/SECURITY_COVERAGE.md) · [日本語](../../../ja/docs/conformance/SECURITY_COVERAGE.md) · **Português**</sub>

<a id="security-guarantees-and-conformance-coverage"></a>

# Garantias de segurança e cobertura de conformidade

> Tradução informativa da [versão em inglês](../../../../docs/conformance/SECURITY_COVERAGE.md), atualizada em 31/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são preservados sem tradução.

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
- **Suítes de SDKs e adaptadores:** são testes separados, com seus próprios pontos de entrada e escopos. Um item no inventário do kit não é um teste executado pelo kit.

Os contratos numerados são interfaces do executor, não versões do protocolo DCP. A identidade do wrapper é autodeclarada. Cinco wrappers não são cinco adotantes externos independentes: WASM compartilha código com Rust, e todos esses wrappers pertencem ao repositório.

Um resultado negativo só é útil com um controle positivo que funcione. Alterar conteúdo assinado sem atualizar a assinatura pode provocar falha por vários motivos. Uma etiqueta `spec_step` ou uma mensagem de erro correspondente não prova, por si só, qual verificação causou a rejeição. Pares válidos e inválidos que isolam uma regra oferecem evidências mais fortes que bundles rejeitados construídos separadamente e com apenas um controle positivo da suíte.

<a id="v2-verification-map"></a>

## Mapa de verificação V2

Os nomes abaixo se referem aos [vetores de bundles](../../../../tests/interop/v2/bundle_vectors.json). `M`, `R` e `A` significam `must_reject`, `must_reject_bundles` e `must_accept_bundles`; os IDs externos têm o prefixo `external.v2.bundle_vectors.`, seguido de `must_reject`, `must_reject_bundles` ou `must_accept`, respectivamente, e depois do nome do caso. `signed_bundle` é o positivo base. São amostras selecionadas e rastreáveis, não uma lista exaustiva ou classificação de completude.

| Regra normativa | Casos ou suíte existentes selecionados | Escopo e limites restantes |
|---|---|---|
| V2-1: selecionar a versão | M `dcp_bundle_version_1_0`, `dcp_bundle_version_3_0` | Rejeição no ponto de entrada V2; não exercita todos os requisitos V1 |
| V2-2: validar esquemas do envelope e dos artefatos | Referência `v2.signed_bundle.schema_invalid_payload_rejected`; suítes de esquemas | A operação do verificador SDK externo não é uma validação completa de esquemas; veja o limite abaixo |
| V2-3: manifesto, hashes de payload e vinculação da auditoria | M `intent_payload_hash_wrong`, `audit_entries_truncated`; R `manifest_intent_hash_mismatch`, `audit_chain_hash_wrong`; A `empty_audit_trail` | Amostras de vinculação de hashes e cadeia; não cobertura isolada de cada campo e forma malformada |
| V2-4: sessão, tempo e consistência de metadados não assinados | R `intent_session_nonce_differs`, `session_expired_with_offset`, `session_longer_than_policy_max_with_late_created_at`; M `signature_signer_id_other`; A `session_duration_at_millisecond_precision` | Testes com instante fixo; distinguir política solicitada e modo efetivo |
| V2-5: estrutura de assinaturas e codificação canônica | M `bundle_classical_sig_b64_with_trailing_bits`, `intent_classical_sig_b64_unpadded`; R `classical_only_bundle_signature_without_pq` | As amostras de codificação não cobrem todas as posições de assinatura nem combinações de defeitos |
| V2-6: o principal assina o manifesto | R `bundle_signed_by_agent_keys`; referência `v2.signed_bundle.forged_classical_signature_rejected` | Amostras de assinaturas e vinculação de papéis; não estabelecem confiança em um principal autodeclarado |
| V2-7: verificar assinaturas PQ presentes | M `bundle_pq_signature_invalid`, `bundle_pq_slot_holds_ed25519` | O catálogo histórico de evidências as exercita com sua política selecionada; alegar todos os modos efetivos exige controles correspondentes |
| V2-8: verificar cada artefato com seu contexto e papel de signatário | M `rpr_classical_signature_invalid`, `intent_signed_by_principal`, `policy_decision_signed_under_intent_context` | Amostras de artefatos e papéis; não todas as combinações de componente, contexto e chave |
| V2-9: derivar o nível sem permitir que uma declaração o reduza | R `classical_only_intent_action_type_constructor`, `classical_only_intent_security_tier_constructor` | Amostras de veredictos; a operação externa de bundle não avalia o nível resolvido informado |
| V2-10: exigir modo efetivo e política de algoritmos | R `classical_only_payment_from_low_risk_passport`; `classical_only_routine` em quatro modos | Amostras de modos; o catálogo histórico de evidências não tem matriz específica de listas de algoritmos permitidos e advisories |
| V2-11: verificar campos secundários presentes | `external.v2.secondary_sha3`, dos [vetores secundários](../../../../tests/interop/v2/secondary_sha3_vectors.json) | Controles positivos e campos malformados ou divergentes; vínculos ausentes são opcionais, portanto aceitação não implica cadeia secundária completa |
| V2-12: vincular e verificar checkpoints | A `pq_checkpoint_over_the_trail`; R `pq_checkpoint_listed_but_missing`, `pq_checkpoint_event_range_count_wrong`, `pq_checkpoint_pq_signature_invalid` | Amostras de pertinência, intervalo e assinaturas; não todas as combinações de intervalos ou componentes malformados |
| V2-13: derivar IDs de chave e exigir sua validade | R `passport_key_kid_not_derived`, `passport_key_public_key_with_trailing_bits`, `rpr_binding_key_revoked` | Amostras de chave, codificação e estado; não cobertura exaustiva de políticas de chaves |
| V2-14: consistência entre artefatos | R `passport_principal_binding_reference_other`, `audit_entry_policy_decision_other`; A `blocked_action_recorded`, `escalated_action_recorded` | Consistência das evidências é distinta de permissão para agir |

As expectativas do corpus devem ser interpretadas com a política declarada, os ajustes por caso e o instante de verificação. Um bundle híbrido positivo pode ser verificado sob `pq_only`; conter os bytes clássicos necessários à vinculação não o torna um controle negativo. Uma política solicitada `classical_only` pode resultar em um modo efetivo mais rigoroso devido ao nível da ação.

<a id="schema-and-cryptographic-api-boundary"></a>

### Limite entre esquema e API criptográfica

V2-2 exige validação de esquemas. A API criptográfica do SDK e o ponto de entrada de referência que valida esquemas são superfícies diferentes. Por exemplo, acrescentar uma propriedade desconhecida ao envelope externo não assinado pode manter as assinaturas intactas: o esquema fecha esse objeto com `additionalProperties: false`, enquanto as APIs de verificação dos SDKs TypeScript, Python, Go, Rust e WASM, sozinhas, ainda podem retornar `verified: true`. É uma lacuna na fronteira de validação, não evidência de assinaturas forjadas nem de que uma aplicação protegida admitiu a entrada.

Quem alegar cumprir toda a lista V2 precisa contemplar V2-2 e as verificações criptográficas. Não enfraqueça o esquema nem descreva uma API parcial como uma validação completa para fazer um teste passar. O kit deve relatar essas camadas separadamente.

Membros desconhecidos não são universalmente proibidos. Alguns objetos do esquema são abertos. A aceitação pelo esquema de uma extensão em um objeto assinado não preserva a assinatura antiga: hashes e assinaturas devem ser recalculados quando o conteúdo assinado muda. Nenhum novo mecanismo de extensões obrigatórias é definido aqui.

O [catálogo diagnóstico de esquemas](../../../../tools/conformance/external-schema-catalog.json), de uso explícito, torna esse limite executável: a base e as extensões permitidas são controles positivos; extensões de objetos fechados e valores fora de uma enumeração preservam a rejeição normativa. Um caso SDK com falha continua sendo uma falha. O relatório separado de `tools/conformance/schema-boundary.js` distingue validação de esquemas, integridade do corpus finito e composição de esquema com SDK no instante do corpus. Essa composição não comprova que o SDK sozinho implemente V2-2, e o helper de integridade não é um verificador normativo geral.

<a id="verifier-policy-samples"></a>

### Amostras de política do verificador

O [catálogo de políticas](../../../../tools/conformance/external-policy-catalog.json), de seleção explícita, acrescenta 74 casos pelo contrato `/2` existente: 10 controles positivos, 24 casos de PQ presente inválida, 14 casos de listas de algoritmos e advisories e 26 casos de tier já versionados. Cada solicitação leva sua política e seu instante de verificação exatos. O catálogo de evidências padrão permanece inalterado.

O novo controle híbrido de tier routine exercita `classical_only` efetivo e os outros três modos. O controle híbrido de tier standard eleva uma solicitação `classical_only` a `hybrid_preferred`. O corpus registra essa derivação; `/2` avalia o veredicto, não o tier nem o modo efetivo informado pela implementação.

Os negativos PQ alteram somente a assinatura PQ do bundle, passaporte ou checkpoint; o componente clássico continua válido. Os casos de listas mantêm o mesmo bundle e alteram apenas a política. Os casos de tier reutilizam bundles versionados assinados separadamente e um controle routine sob o mesmo modo solicitado: não são pares de alteração única. Cada negativo exige que seu controle positivo passe na mesma execução.

As exclusões de algoritmos clássicos sob `pq_only` continuam omitidas até esclarecer sua interpretação, sem veredicto esperado. O corpus registra casos adiados e questões de interpretação; uma combinação não testada não demonstra, por si só, uma contradição na especificação. Essas amostras não fecham a lacuna de esquemas nem estabelecem conformidade V2 completa.

<a id="structural-samples"></a>

### Amostras estruturais

O [catálogo estrutural](../../../../tools/conformance/external-structural-catalog.json), de seleção explícita, acrescenta 16 casos por meio de `/2`: dois controles positivos e 14 negativos sobre codificação de assinaturas, componentes e intervalos de checkpoints, compromissos do manifesto, um payload com fração, ordem temporal da sessão e uma assinatura clássica do bundle invalidada com sua assinatura PQ recalculada corretamente. O modo efetivo é `hybrid_preferred`; esses negativos clássicos não fazem afirmações sobre `pq_only`.

Os quatro casos de codificação preservam os bytes decodificados da assinatura. Os intervalos dos checkpoints usam posições reais da trilha, com identificadores deliberadamente fora de ordem. As mutações do manifesto são assinadas novamente. A sessão invertida tem um gêmeo positivo separado dentro da tolerância do relógio. Cada negativo exige que seus controles passem na mesma execução.

O isolamento tem limites explícitos: uma fração não tem representação `dcp-jcs-v1`, portanto seus hashes e assinaturas anteriores ficam obsoletos; um intervalo invertido não tem raiz válida para esse intervalo. As verificações dos componentes documentam os defeitos previstos, mas não identificam qual verificação do SDK causou a rejeição. Essas amostras não fecham a lacuna dos esquemas nem provam conformidade completa.

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
| DCP-05 a DCP-09 | As verificações declaradas das suítes internas de esquemas e intercâmbio | Semântica completa de ciclo de vida, direitos ou delegação |
| `dcp-jcs-v2` experimental | Seus testes experimentais selecionados separadamente | Status normativo ou padrão; `dcp-jcs-v1` permanece inalterado |

O resultado de um subconjunto deve identificá-lo e explicar seus limites. Não transforme `unsupported`, um caso ausente, uma queda, um timeout ou uma matriz ignorada em um caso aprovado. Um teste SDK reservado que retorna sem executar sua matriz não comprova que a matriz foi executada.

<a id="further-validation"></a>

## Validação adicional

O [guia do implementador](IMPLEMENTER_GUIDE.md) descreve como reproduzir e relatar resultados de forma independente. Implementação externa e revisão independente de segurança são marcos adicionais; os testes deste repositório não os substituem.

As medições de desempenho usam seu próprio [executor documentado](../../tools/conformance/README.md#performance-baseline). Medir o tempo de ponta a ponta não atribui custo a uma primitiva criptográfica nem comprova a ausência de saídas antecipadas. Otimize somente após medir um custo específico, preservando as decisões de verificação e a compatibilidade.
