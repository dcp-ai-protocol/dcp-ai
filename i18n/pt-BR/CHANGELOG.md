<sub>[English](../../CHANGELOG.md) · [中文](../zh-CN/CHANGELOG.md) · [Español](../es/CHANGELOG.md) · [日本語](../ja/CHANGELOG.md) · **Português**</sub>

<a id="changelog"></a>

# Registro de alterações

> Tradução informativa da [versão em inglês](../../CHANGELOG.md), atualizada em 29/10/2026. Cada entrada, inclusive as de `[Unreleased]`, descreve uma mudança no momento em que foi feita e não garante o comportamento atual; as versões publicadas são **registro histórico datado**. Em caso de divergência, prevalece a versão em inglês.

**Versões publicadas (26/10/2026).** Estão publicados npm (13 pacotes, incluindo `@dcp-ai/sdk` 2.2.0), Python `dcp-ai` 2.10.0, Go `v2.11.0` e Rust `dcp-ai` 2.11.0, com as correções do verificador, a admissão e as APIs experimentais opt-in; `dcp-jcs-v1` continua sendo o padrão normativo. Veja [Versões publicadas](../../docs/README.md#published-versions). As entradas abaixo mantêm seu histórico de desenvolvimento; `[Unreleased]` não significa que essas funcionalidades não estejam publicadas. As seis publicações de correção de 28/10/2026 estão em [sua própria seção](#2026-10-28-sha3-patch-releases).

Todas as alterações relevantes deste projeto serão documentadas neste arquivo.

O formato se baseia no [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

> **Nota informativa (26/10/2026).** Cada entrada descreve uma mudança como ela foi feita, inclusive as entradas
> sucessivas de `[Unreleased]`, em que uma entrada posterior pode precisar ou substituir uma anterior. Uma entrada não
> garante o comportamento atual nem que uma versão de um pacote esteja disponível em um registro. Para o comportamento
> atual, consulte o [README](../../README.md), a [documentação](../../docs/README.md), as [especificações](../../spec/README.md) e a
> [referência da API](../../docs/API_REFERENCE.md).

<a id="2026-10-28-sha3-patch-releases"></a>

## [2026-10-28] Publicações de correção SHA3

Publicado em 28/10/2026: `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1 e `@dcp-ai/cli` 2.1.1 no npm, `dcp-ai` 2.10.1 no PyPI, o módulo Go `v2.11.1` (tag `sdks/go/v2.11.1`) e Rust `dcp-ai` 2.11.1 no crates.io. Os outros dez pacotes npm não mudam. Veja [Versões publicadas](../../docs/README.md#published-versions) e as notas de publicação de [npm](../../docs/NPM_RELEASES.md), [Python](../../docs/PYTHON_RELEASE.md), [Go](../../docs/GO_RELEASE.md) e [Rust](../../docs/RUST_RELEASE.md).

<a id="secondary-sha3-256-verification"></a>

### Verificação secundária SHA3-256

- **Mudança de aceitação: os campos secundários SHA3-256 são verificados quando presentes** (desenvolvido em
  27/10/2026). Os verificadores V2 de TypeScript, Python, Go e Rust, e a compilação WASM a partir do
  SDK de Rust, agora verificam `audit_merkle_root_secondary` (a árvore SHA3-256 construída como a primária; `sha3-256:`
  seguido de 64 zeros para uma trilha vazia), cada `prev_hash_secondary` (`"GENESIS"` na primeira entrada e, depois, o
  SHA3-256 da entrada anterior tal como consta) e cada `intent_hash_secondary` (o SHA3-256 do payload da intenção), como
  indicam `spec/VERIFICATION.md` V2-11 e sua errata de 27/10/2026. Os campos ausentes não são exigidos, então um bundle
  verificado pode não conter uma cadeia secundária completa; um campo presente que seja `null`, não seja uma string ou
  esteja errado é rejeitado. A admissão e as rotas do candidato experimental reutilizam essas verificações; não muda
  nenhuma API, campo de resultado, canonicalização nem o tratamento de `hash_alg`. O padrão do schema de
  `prev_hash_secondary` também aceita `"GENESIS"`, que o OpenClaw escreve na primeira entrada. Vetores compartilhados:
  `tests/interop/v2/secondary_sha3_vectors.json`. As versões anteriores não verificam esses campos. Os adaptadores publicados `@dcp-ai/express`, `@dcp-ai/openclaw`, `@dcp-ai/anthropic-mcp` e `@dcp-ai/google-a2a` 2.1.0 não foram republicados: dependem de `@dcp-ai/sdk` `^2.2.0` e obtêm as verificações secundárias quando seu lockfile resolve `@dcp-ai/sdk` 2.2.1 ou posterior.

<a id="package-metadata"></a>

### Metadados dos pacotes

- `@dcp-ai/cli` 2.1.1 exige `@dcp-ai/sdk` `^2.2.1`, e `dcp-ai --version` informa `2.1.1` em vez do desatualizado `1.0.0`.
- A telemetria informa as novas versões: Go `SDKVersion` `2.11.1`; os SDKs TypeScript, Python e Rust leem a versão do seu pacote.

## [Unreleased]

<a id="security"></a>

### Segurança

- **`VerificationCache` do TypeScript (código-fonte de `main`, não publicado; o `@dcp-ai/sdk` 2.2.1
  mantém o comportamento anterior).** A chave do cache continua sendo o hash do bundle para as
  chamadas existentes, e um `context` opcional escolhido por quem chama separa os resultados com
  chaves internas etiquetadas com as quais um hash legado não pode colidir. `invalidateByAgent`, que
  não removia nada, agora remove as entradas armazenadas com esse agente na nova opção `agentIds` e
  todas as armazenadas sem ela. Substituir uma entrada não deixa mais seus kids antigos no índice
  (com o limite padrão o índice crescia sem limite) nem remove outra entrada; os kids de
  `result.details.signer_keys` também são indexados; `''` como hash não desativa mais `maxEntries`.
  **Mudanças de aceitação:** opções inválidas (TTL `NaN`, `Infinity`, negativos ou não numéricos,
  TTL acima de `Number.MAX_SAFE_INTEGER`, um `maxEntries` que não seja um inteiro seguro de 1 a `Number.MAX_SAFE_INTEGER`) lançam um
  erro em vez de desativar a expiração ou o limite; `set` copia o resultado e `get` retorna uma nova
  cópia a cada acerto; uma entrada expira exatamente ao completar seu TTL, medido no relógio
  monotônico além do relógio de parede, então um recuo do relógio não a prolonga mais; um TTL de 0
  nunca é armazenado; `set` valida seus argumentos (um buraco em `signerKids` ou `agentIds` conta
  como `undefined`) e não muda nada quando lança um erro. Um acerto continua sem verificar de novo a evidência nem a confiança e não é admissão, e nada é invalidado automaticamente. Veja
  [API_REFERENCE.md](../../docs/API_REFERENCE.md#verificationcache).
- **Mudança de aceitação: assinaturas Ed25519 com S >= L agora são rejeitadas** pelo SDK de TypeScript
  (`Ed25519Provider.verify`, e portanto toda assinatura V2 e composta, `@dcp-ai/express` e
  `@dcp-ai/openclaw`; e `verifyObject`, e portanto `verifySignedBundle` V1) e pelo verificador de
  referência (`tools/crypto.js`, e portanto `lib/verify.js` V1, `bin/dcp.js`, a conformidade e o
  gossip do log de transparência). A RFC 8032 §5.1.7 exige 0 <= S < L, e o TweetNaCl não verifica isso,
  então aceitava S + k·L, outra codificação de uma assinatura válida (§8.4, maleabilidade). Python, Go
  e Rust já as rejeitavam. O TweetNaCl continua sendo o verificador: o intervalo só é verificado em entradas
  que ele aceita, então seus erros para tipos, tamanhos e base64 errados não mudam, assim como a
  decodificação de chaves e de R e a aceitação de chaves fracas. Os signatários produzem S < L, então nenhuma
  assinatura gerada de novo muda de veredito; uma assinatura armazenada com S >= L que uma versão anterior
  aceitou deixa de ser verificada. O inventário do repositório só encontrou assinaturas assim no corpus
  negativo de revisão, intencional; ele não cobre evidências armazenadas externas. As evidências verificadas
  antes desta mudança não são reassinadas automaticamente: mantenha-as como históricas, com seu hash e a
  versão que as verificou, ou assine-as novamente.
- **A mesma mudança de aceitação em `dcp-ai verify` (`@dcp-ai/cli`) e no playground**, que
  chamavam o TweetNaCl diretamente. `dcp-ai verify` verifica S < L na sua própria checagem V1 de
  `signature.sig_b64`, e os bundles V2 a recebem do `@dcp-ai/sdk`, cujo verificador ele agora usa (veja
  Alterado). O caminho histórico `signature.classical.value` também teve a verificação quando foi adicionado;
  esse caminho foi removido depois e seu formato é rejeitado. O playground a faz em
  `verifyDetached`. A verificação é a do SDK, feita só em entradas que o TweetNaCl aceita, então seus erros
  não mudam.
- Os quatro verificadores V2 divergiam diante de codificações não canônicas de uma assinatura válida: com lixo
  após o preenchimento, preenchimento a mais, uma quebra de linha no meio, bits finais ativados ou sem
  preenchimento, o TypeScript aceitava todas as variantes, Python e Go algumas, Rust nenhuma. Todo `sig_b64`
  agora precisa ser base64 canônico (`spec/VERIFICATION.md` V2-5), de modo que uma assinatura tem uma única
  codificação e todos os SDKs decodificam os mesmos bytes; 13 novos vetores `must_reject` cobrem isso.
- Os verificadores V2 dos quatro SDKs aceitavam bundles que as assinaturas sozinhas permitiam, mas o
  protocolo não. Relatado por uma revisão externa e confirmado pela nossa; o verificador de referência
  `lib/verify.js` executa o verificador corrigido por meio do SDK do workspace até que a 2.2.0 esteja no npm
  (veja Alterado).
  - **Qualquer agente podia reivindicar qualquer principal.** A assinatura do bundle era verificada com as chaves
    do passaporte além das `binding_keys` do RPR, e o agente assina o próprio passaporte. Combinar um RPR
    publicado e assinado com um passaporte e chaves novos dava um bundle verificado sem a chave privada do
    principal. A assinatura do bundle agora só é verificada com as `binding_keys` do RPR
    (`spec/VERIFICATION.md` V2-6), de modo que o que vincula o agente é a assinatura do principal sobre o
    manifesto, que se compromete com `passport_hash`.
  - **Os kids não eram verificados em relação às suas chaves.** Uma lista de chaves podia reivindicar o kid de
    outra parte para uma chave própria. Todo kid que verifica uma assinatura agora precisa ser derivado da sua
    chave, e a chave precisa estar em base64 canônico para que todos os SDKs decodifiquem os mesmos bytes (V2-13).
  - **Bundles assinados, mas inconsistentes, eram verificados.** Um passaporte revogado ou desativado, um RPR
    expirado, uma decisão de política para outra intenção, e entradas de auditoria de outra intenção, agente ou
    principal, com outro `intent_hash` ou sem registrar a decisão de política. As verificações V1 agora são
    V2-14: o passaporte está `active` ou `declining`, o RPR não expirou e todos os artefatos nomeiam o mesmo
    principal, agente e intenção. Uma ação escalonada ou bloqueada continua sendo evidência válida.
  - **O limite de duração da sessão lia um campo não assinado.** `max_session_duration_seconds` era medido a
    partir de `signature.created_at`, fora do manifesto assinado. O manifesto tem um novo
    `session_issued_at`, que `signBundleV2` e `sign_bundle_v2` escrevem junto com `session_expires_at`;
    o máximo é medido a partir dele e, com um máximo, um bundle sem ele é rejeitado (V2-4).
    Ele não pode estar mais de 30 segundos adiantado em relação ao relógio do verificador, e um máximo também
    rejeita um bundle sem `session_expires_at`. Os carimbos de data/hora são comparados com precisão de
    milissegundos em todos os SDKs. Os bundles assinados antes desta mudança são verificados como antes sob uma
    política sem duração máxima de sessão.
  - **O bloco de assinatura não assinado podia contradizer a assinatura.** `signature.signer.id` agora precisa
    ser o `human_id` do RPR, `signature.signer.kids` os kids da assinatura composta,
    `manifest_hash` o hash do manifesto e `hash_alg` um dos dois que o schema permite.
    `signBundleV2` e `sign_bundle_v2` recusam um id de signatário diferente do `human_id` do RPR; `SignBundleV2`
    do Go e `sign_bundle_v2` do Rust já o tiram do RPR.
  - **Os checkpoints PQ não eram verificados.** Um checkpoint com raiz de Merkle ou assinatura PQ alteradas, ou
    um ausente que o manifesto lista, era verificado. O bundle agora precisa ter exatamente os checkpoints
    listados, cada um sobre suas entradas de auditoria e assinado pelo agente com os dois algoritmos (V2-12).
  - Os verificadores de Go e Rust aceitavam um artefato ou uma entrada de auditoria sem `session_nonce`; agora
    todos precisam ter o do manifesto, como em TypeScript e Python.
  - Novos vetores em `tests/interop/v2/bundle_vectors.json`, cada um assinado sobre um único defeito: 35
    casos `must_reject_bundles`, 4 mutações `must_reject` do bloco de assinatura não assinado e 8 controles
    `must_accept_bundles`. Um caso pode ter `verifier_policy_overrides`.
  - `lib/verify.js` fixa uma chave de `dcp verify-bundle` entre as `binding_keys` do RPR, e toda entrada com o
    kid signatário precisa ter a chave fixada, de modo que a fixação também vale com o SDK publicado 2.1.1, que
    procura o signatário primeiro no passaporte.
- `@dcp-ai/express` (`dcpVerify`), `@dcp-ai/openclaw` (`dcp_verify_bundle`) e o middleware FastAPI do
  Python (`dcp_ai.fastapi.DCPVerifyMiddleware`) aceitavam bundles assinados V2 sem verificar nenhuma
  assinatura: verificavam só a estrutura do bundle e os nonces de sessão (o middleware FastAPI
  também definia `composite_sig_valid` a partir do campo `binding`), então um bundle não assinado ou forjado,
  ou um cuja intenção foi alterada depois da assinatura, era dado como verificado. Os três agora verificam todo
  bundle V2 com o verificador do SDK (`verifySignedBundleV2` do `@dcp-ai/sdk`, `verify_signed_bundle_v2`
  do `dcp_ai.v2`) e um registro Ed25519 / ML-DSA-65 / SLH-DSA-192f, com a política configurada sobre
  `DEFAULT_VERIFIER_POLICY` (`verifierPolicy`; `verifier_policy`, um novo argumento de
  `DCPVerifyMiddleware`; a política do operador do OpenClaw descrita abaixo). `requireHybrid` eleva a
  `hybrid_required` todo nível de risco que esteja abaixo (um `pq_only` do operador continua `pq_only`), e um
  `default_mode` sem `risk_overrides` se aplica a todos os níveis. Os erros e alertas do verificador são
  retornados, e `composite_sig_valid` vem dele. Até que o `@dcp-ai/sdk` 2.2.0 esteja no
  npm, os dois pacotes de TypeScript dependem do SDK do workspace
  (`"@dcp-ai/sdk": "file:../../sdks/typescript"`), cujo verificador tem as correções acima; a CI o constrói
  antes de testá-los, e os três passam em todos os casos de `tests/interop/v2/bundle_vectors.json`
  com seus `verifier_policy_overrides`. Publicá-los exige antes elevar a dependência para `^2.2.0`:
  `publish-integrations.yml` agora recusa um pacote que dependa de um caminho local.
- Os mesmos três verificadores enviavam ao verificador V1 todo bundle não detectado como V2, qualquer que fosse
  a política do verificador: um bundle V1 (uma assinatura Ed25519, nenhuma pós-quântica) passava por
  `requireHybrid` ou por uma política `hybrid_required`, e um bundle de versão indetectável era testado como
  V1. Um bundle V1 agora só é aceito onde VERIFICATION.md V2-10 aceitaria um bundle somente clássico:
  `allow_v1_bundles` é verdadeiro, `requireHybrid` está desligado, e o mais rigoroso entre o modo da política
  para o `risk_tier` do passaporte V1 e o modo do nível de segurança da intenção e da decisão de política V1
  (`risk_score` V1, de 0 a 1, multiplicado por 1000; ausente conta como `elevated`) é
  `classical_only` ou `hybrid_preferred`. Com `DEFAULT_VERIFIER_POLICY`, o bundle de conformidade V1
  (um `send_email` de nível padrão) passa e o mesmo bundle com uma intenção `initiate_payment` é
  recusado. Um bundle de versão indetectável é rejeitado.
- `@dcp-ai/openclaw`: `dcp_verify_bundle` tomava sua política de verificação do parâmetro de ferramenta
  `verifier_policy`, que o modelo chamador controla, e retornava o `agent_id` e o `human_id` do bundle não
  verificado junto com um resultado de falha. A política agora é a do operador (`register(api,
  { verifierPolicy })` ou o novo `configureVerifier`, sobre `DEFAULT_VERIFIER_POLICY`); o
  parâmetro só pode torná-la mais rigorosa (um modo mais rigoroso por nível, em que combinar `pq_only` com qualquer outro
  modo dá `hybrid_required` para que o modelo não possa dispensar a assinatura clássica que o operador exige,
  `require_*` só pode ser ligado, `allow_v1_bundles` só pode ser desligado, qualquer outro campo é um
  erro). O resultado repete
  `verification_mode`, e nomeia o agente, o principal e a sessão somente quando o bundle foi verificado.
- `@dcp-ai/express`: o cache de veredictos usava como chave `signature.composite_sig` e era compartilhado por todos
  os middlewares, então um bundle diferente com uma assinatura em cache, ou um middleware com uma política mais
  rigorosa, reutilizava um veredito «verificado»; ele também crescia sem limite e mantinha um veredito por todo o
  TTL depois que a sessão ou uma chave tinham expirado ou o agente tinha sido revogado. Cada middleware agora tem
  o seu próprio cache, com chave no SHA-256 da forma canônica do bundle (`canonicalizeV2`; um bundle
  sem ela, como um que contém `1e999`, que `JSON.stringify` imprimia como `null`, é verificado
  mas não vai para o cache), com no máximo `cacheMaxEntries` (novo, padrão 1000) bundles, removendo
  primeiro o usado há mais tempo; uma entrada expira no primeiro destes momentos: o TTL, o
  `session_expires_at` do manifesto, o `expires_at` do RPR e o `expires_at` de cada chave do passaporte e de cada
  chave de vinculação do RPR. Um bundle muito aninhado não dá mais um 500.
- `@dcp-ai/express`: `checkRevocation` só perguntava sobre o agente e as chaves do seu passaporte, e falhava
  aberto em silêncio. Agora também pergunta sobre cada chave de vinculação do RPR e os kids clássico e
  PQ da assinatura do bundle, em toda requisição, inclusive os acertos de cache. Uma consulta que não dá resposta
  (serviço inacessível, uma resposta que não é 2xx, um corpo que não é JSON ou não tem `revoked`) continua
  deixando a requisição passar por padrão; o novo `revocationFailClosed: true` a rejeita.
- `@dcp-ai/express`: uma opção ou um campo de `verifierPolicy` desconhecidos (`defaultMode`) e um valor do
  tipo errado (`allow_v1_bundles: "false"`) eram ignorados, mantendo o padrão em vigor. Agora eles
  lançam uma exceção quando o middleware é criado.
- `dcp_ai.fastapi`: um cabeçalho `X-DCP-Bundle` com um inteiro acima do limite de 4300 dígitos do Python ou
  aninhado demais, e um bundle profundo demais para o verificador, davam um 500; agora recebem um 403.
  Um `pq_checkpoints` que não é uma lista é rejeitado (era lido como nenhum checkpoint).
  `verifier_policy={"risk_overrides": None}` agora mantém os níveis padrão em vez de aplicar
  `default_mode` a todos, e um nível de risco desconhecido lança uma exceção. `dcp_version` é documentado como
  não aplicado.
- Os três README agora dizem o que «verificado» significa: o bundle é internamente consistente e assinado
  pelas chaves que ele mesmo lista, o que não prova quem é o principal a menos que o verificador fixe
  as chaves do principal (nenhum dos middlewares consegue fazer isso ainda), e `require_audience_binding` com um
  `verifier_id` limita a repetição ao verificador pretendido.
- Os verificadores de Go e Rust aceitavam uma entrada de auditoria (ou um checkpoint PQ) cujo `session_nonce`
  diferia do do manifesto, embora o manifesto se comprometesse com ele (`spec/VERIFICATION.md` V2-4: todo
  artefato e toda entrada de auditoria que tem um nonce compartilha o do manifesto). Os dois agora verificam a
  trilha e os checkpoints como TypeScript e Python fazem, com o erro `Session nonce mismatch in
  audit_entries[i]`. Vetor compartilhado `audit_entry_session_nonce_differs`.
- O verificador de Rust não verificava `manifest.canonicalization_profile` de forma alguma, e o de Go
  ignorava um valor que não fosse uma string, então um bundle podia declarar um perfil que nenhum verificador
  implementa (`spec/CANONICALIZATION_PROFILE.md` § 4, V2-3). Os dois agora rejeitam qualquer valor diferente de
  `"dcp-jcs-v1"`, como TypeScript e Python fazem. Vetores compartilhados `canonicalization_profile_unknown`
  e `canonicalization_profile_not_a_string`.

<a id="added"></a>

### Adicionado

- `RawAuditEventV2` nos SDKs de Rust (`dcp_ai::v2::types`) e Go (`v2`): uma entrada de auditoria V2 recebida,
  mantida como foi decodificada, com cada membro em qualquer profundidade, sua presença e seu `null`, inclusive os
  desconhecidos, de modo que, sempre que o canonicalizador dcp-jcs-v1 a aceitar, seus bytes canônicos, seu
  `prev_hash` e sua folha de Merkle continuam sendo os da entrada. Rust guarda o `serde_json::Value` decodificado
  (`RawAuditEventError` para tudo o que não é um objeto); Go guarda os bytes literais, copiados na entrada e na
  saída, e rejeita tudo o que não seja exatamente um objeto JSON. Nenhum dos dois repara nem assina de novo: a
  evidência inválida continua inválida, pelo mesmo motivo. `AuditEventV2` e `AuditEvidenceV2` não mudam e agora são
  documentados como com perdas para encaminhar (um `null` explícito, um membro desconhecido, um `pq_checkpoint_ref`
  ausente que vira `null`). Os novos vetores compartilhados, `tests/interop/v2/audit_entry_roundtrip_vectors.json`,
  trazem 14 entradas com seu texto dcp-jcs-v1 escrito à mão, que os canonicalizadores de TypeScript, Python, Go e
  Rust reproduzem, e um bundle assinado cujas mutações o tipo novo mantém rejeitadas com os mesmos erros. O builder
  de bundles do Go, os tipos V1 e o modelo `AuditEventV2` do Python não mudam.
- `--assessment verdict` para o catálogo de evidência (contrato `/2`) do kit de conformidade externa: as 146
  rejeições que trazem um `error_contains` são julgadas apenas por `verified: false`, com todas as demais regras,
  controles e códigos de saída inalterados, para que uma implementação com vereditos corretos e mensagens próprias
  possa demonstrá-lo. A redação é informada como diagnóstico: `matched`, `differs`, `no_message`, ou
  `not_evaluated` com seu motivo. Cada um desses casos indica seu passo de `spec/VERIFICATION.md`, e antes da
  execução o runner verifica essas âncoras e que todo controle seja um positivo simples. O relatório declara
  `dcp-ai-conformance-assessment/1`, à parte do contrato do wire `/2`, e mantém a prosa do catálogo em
  `catalog_claim` e `catalog_limits`. Sem a opção, ou com `--assessment legacy`, o julgamento e o relatório não
  mudam, e os catálogos `/1` e `/3` a recusam. O catálogo, os fixtures e os wrappers não mudam; a CI executa a
  avaliação com os cinco wrappers, todos obrigatórios.
- Kit de conformidade externa: um catálogo de admissão opt-in, `--catalog admission` (contrato
  `dcp-ai-conformance-external/3`, `tools/conformance/external-admission-catalog.json`, 140 casos:
  os 65 vetores de resultado de `admission_vectors.json`, 71 casos de configuração e 4 casos
  compostos a partir das entradas dos vetores). Os wrappers de TypeScript, Python, Go e Rust
  respondem por meio da função combinada de admissão e dos carregadores do seu SDK, com o `now` da
  requisição. O juiz verifica os tipos dos campos, as regras de spec/profiles/admission
  (`action_authorized` é `false`; `admitted` exatamente quando nenhum código foi acrescentado), os
  campos exatos, a ordem dos códigos brutos por fase e a sua repetição; um negativo só conta se os
  seus controles passaram. A resposta é uma projeção: a verificação incluída não é julgada. O build
  WASM não tem API de admissão e não é emulado. A CI executa os autotestes do juiz (60), os testes
  dos wrappers (26, com os quatro wrappers obrigatórios) e os 140 casos com cada um dos quatro
  wrappers. O fake dos autotestes de evidência agora chega ao wrapper de TypeScript por um spawn
  assíncrono, com prazo e verificação da sua saída: um spawn síncrono com a requisição de 9 MB foi
  observado esperando até o prazo. `/1` e `/2` não mudam.
- **Candidato de canonicalização: o portão 7 medido no lado de `dcp-jcs-v1`.** O novo fixture público
  `tests/interop/candidate/gate7-v1-negatives.json` injeta um defeito de cada uma das 8 classes de unidade, em 18
  posições de bytes, em duas bases congeladas de `dcp-jcs-v1`: 38 casos, com as 2 bases incluídas como controles.
  Ele registra uma expectativa raciocinada para 10 configurações de cinco implementações: os SDKs de TypeScript,
  Python, Go e Rust, e o pacote WASM hospedado no Node. Novos testes em cada uma executam as 380 comparações: o
  verificador experimental deve dar o resultado do caminho atual da mesma implementação com os mesmos bytes, relógio
  e política, e ambos devem coincidir com a expectativa. Três casos com envelope (30 verificações) ficam como uma
  fronteira à parte, sem afirmar equivalência. Um verificador estrito com a biblioteca padrão e seus controles
  negativos rodam no job de conformidade da CI. O registro marca o portão 7 como cumprido, sobre amostras. Apenas
  testes e documentação: nenhuma mudança em API de SDK, perfis, valores padrão nem `dcp-jcs-v1`; o candidato continua
  experimental e de ativação explícita, e nada é publicado. Veja
  [docs/proposals/canonicalization-candidate/README.md](docs/proposals/canonicalization-candidate/README.md#185-gate-7-on-the-dcp-jcs-v1-side-testsinteropcandidategate7-v1-negativesjson).
- **Catálogo de evidência para o runner de conformidade externo: Merkle e verificação de assinaturas.**
  `--catalog evidence` executa um catálogo opcional (`tools/conformance/external-evidence-catalog.json`,
  contrato `dcp-ai-conformance-external/2`, 241 casos) sobre fixtures públicos versionados: raízes
  Merkle duplas exatas para 1, 2, 3 e 5 folhas, verificação de assinaturas compostas e só clássicas com
  os ataques versionados e alterações determinísticas, verificação normativa V2 de bundles assinados de
  `bundle_vectors.json` com `default_verifier_policy` e os overrides versionados de cada caso, e os
  vetores secundários SHA3-256, tudo com um `verification_time` fixado. Um caso negativo só conta se seu
  controle passou; `verified: true` com erros, `error` e `unsupported` nunca são um sucesso. Os cinco
  wrappers aceitam os dois contratos; o catálogo padrão, o contrato `/1` e seus 38 casos não mudam. A CI
  executa os 241 casos e os self-tests com os cinco wrappers. Um sucesso não é admissão, confiança nem
  autorização. Além da correção de `wasm_dual_merkle_root` em Corrigido, não há mudanças nos SDKs;
  nenhum pacote é publicado. Veja
  [tools/conformance/README.md](../../tools/conformance/README.md#evidence-catalog-merkle-and-signature-verification).
- **Wrappers de Go, Rust e WASM para o runner de conformidade externo.**
  `tools/conformance/wrappers/build.mjs` compila a partir deste checkout wrappers para o SDK de Go,
  o SDK de Rust e a compilação WASM do SDK de Rust (`-mod=readonly`, `--locked`; nenhum manifest ou
  lockfile do SDK muda), e cada um executa os mesmos 38 casos com a API real, com uma única chamada
  ao canonicalizador e classificando como rejeição apenas a documentada. O wrapper WASM executa o
  `.wasm` real hospedado no Node, não em um navegador, e trata de forma conservadora a colisão do
  `{"error": …}` que a exportação devolve dentro do resultado. A CI compila os três e os executa
  como jobs obrigatórios. Nenhum pacote é publicado. Veja
  [tools/conformance/README.md](../../tools/conformance/README.md#go-rust-and-wasm-wrappers).
- **Runner de conformidade externo (`tools/conformance-external.js`).** Executa um catálogo separado
  e versionado (`tools/conformance/external-catalog.json`, contrato `dcp-ai-conformance-external/1`)
  contra qualquer implementação indicada como argv, por meio de uma requisição JSON pelo stdin e uma
  resposta JSON pelo stdout: 30 casos de canonicalização `dcp-jcs-v1` (incluindo os 19 `edge_cases`
  do repositório, 3 dos quais devem ser rejeitados) e 8 digests SHA-256 / SHA3-256, todos com
  expectativas já comprometidas. Inclui wrappers para `@dcp-ai/sdk` e para o `dcp_ai` de Python, e a
  CI executa os dois. O comando, o catálogo e o relatório de conformidade existentes não mudam. Um sucesso mostra que estes 38 casos passam, nada mais. Veja
  [tools/conformance/README.md](../../tools/conformance/README.md#external-implementations).
- `cancel_on_disconnect` no FastAPI funciona em qualquer ordem de middlewares. A resposta ASGI a um cliente
  que saiu agora termina com um `499` vazio («client closed request»: não registrado, não é um status do
  DCP), com `Content-Length: 0` e `Cache-Control: no-store`, em vez de nenhuma mensagem.
  - São duas mensagens ASGI da resposta do DCP, enviadas só depois de receber `http.disconnect`,
    nunca para um cliente que permanece. Um `BaseHTTPMiddleware` fora do DCP precisa de `http.response.start`,
    e antes disso falhava com «No response returned.»; agora termina normalmente e registra um
    499.
  - O que chega à rede depende do servidor: o uvicorn (medido, 0.54 com h11) não escreve nem registra
    nada para uma conexão que já não existe; sob ASGI, outro servidor pode lançar uma subclasse de `OSError`.
  - O `request.state.dcp_agent` da admissão agora só é publicado quando se sabe que o cliente ainda está
    lá, de modo que um cliente que saiu não deixa nenhum contexto admitido. Um valor definido pelo próprio código
    do operador não é alterado.
  - Um cliente que sai no meio do corpo recebe o mesmo final (em vez de nada).
  - Erros genuínos de qualquer camada continuam sendo propagados. Nada mais muda: opções, padrões, o
    orçamento do corpo, o supervisor e `DenyListWorkers`.
- Desconexão do cliente, opt-in: `cancelOnDisconnect` no `@dcp-ai/express`,
  `cancel_on_disconnect=True` no `dcp_ai.fastapi.DCPVerifyMiddleware`.
  - **O que faz.** Quando o cliente realmente sai durante a admissão, a invocação supervisionada da fonte
    dessa requisição, e somente dela, é cancelada. Sua vaga continua ocupada até que a fonte realmente termine.
    Nada mais é feito ou enviado para a requisição: nem handler, nem `next`, nem escrita no cache, nem
    `onFailure`, nem resposta.
  - **Express.** Sair significa a resposta se fechar antes de ser enviada, ou a requisição se fechar com
    o corpo incompleto; o próprio `close` de uma requisição saudável não conta.
    - Exige todas as funções de fonte supervisionadas, nenhum `checkRevocation` e um supervisor que ofereça
      cancelamento: a nova capacidade `runWithSignal` dos supervisores desta versão (ESM e CJS,
      os dois pacotes).
    - `run`, seus quatro argumentos e `version: 1` não mudam, e um supervisor de um pacote mais antigo continua
      funcionando sem a opção.
    - A decisão de uma invocação supervisionada agora é tomada uma única vez, antes de seu sinal ser abortado: um
      listener de aborto que reentra em `close()` não muda nada.
    - Novo resultado `cancelled`, contador (`stats().cancelled`, opcional no tipo) e motivo de
      telemetria.
  - **FastAPI.** Exige `max_body_bytes`, todos os callables de fonte supervisionados e um callable `tenant`
    síncrono.
    - O middleware observa um único `receive()` pendente durante a admissão e o repassa ao próximo
      leitor: nada é lido duas vezes nem perdido, e o `http.disconnect` enviado após uma resposta
      completa não é tomado como saída do cliente.
    - Com a opção, um cliente que sai no meio do corpo não recebe nada em vez do
      400.
    - Na sua primeira forma, o middleware precisava envolver as outras camadas `BaseHTTPMiddleware` da
      aplicação; esse requisito deixou de existir (veja a entrada acima).
    - `SourceSupervisor` e `DenyListWorkers` não mudam. O OpenClaw não tem essa opção.
  - Sem a opção, nada muda.
- `dcp_ai.v2.DenyListWorkers` e `deny_list_revocation_source(..., workers=...)`, opt-in: um orçamento
  de threads de download reais para o auxiliar de lista de negação do Python (`max_workers` de 1 a 64,
  `max_workers_per_tenant` opcional, por objeto). Cada download roda em uma thread não daemon
  própria, iniciada depois que sua vaga é reservada e que só a libera quando o download realmente terminou,
  também após um timeout, uma chamada cancelada, o prazo do supervisor do C3 ou um event loop fechado; uma chamada
  que não encontra vaga livre recebe `REVOCATION_UNAVAILABLE` imediatamente, sem fila e sem conexão.
  O download, as verificações do corpo, a análise e os erros são os mesmos sem a opção; um resultado
  que chega ou é usado depois do `timeout` é `REVOCATION_UNAVAILABLE`. `close()` recusa novos
  downloads sem esperar nem parar os que estão em andamento; `stats()` não tem URL, tenant nem cabeçalho. Em
  um processo bifurcado, recusa sem tocar no lock do pai. A saída do processo espera por um download
  ainda em andamento, como acontece com `asyncio.to_thread`; nada interrompe DNS, TLS ou urllib. Sem
  `workers`, nada muda. A documentação de `timeout` foi corrigida: ele limita cada operação de socket
  e a leitura do corpo, não a resolução DNS nem uma linha de status que chega aos poucos.
- Revogação sob o supervisor de fontes (C3), opt-in, no `@dcp-ai/express`, no `@dcp-ai/openclaw`
  e no `dcp_ai.fastapi.DCPVerifyMiddleware`: `supervise: { revocation: true }` /
  `supervise={"revocation": True}`, recusado até agora, executa a fonte de revogação do strict-v1 sob
  o supervisor com `revocationTimeoutMs` / `revocation_timeout` como prazo, então limitado
  ao intervalo dos temporizadores (um inteiro de 1 a 2147483647 ms; até 2147483.647 s). `supervise` aceita
  o prazo de confiança, `revocation` ou ambos, de modo que a revogação pode ser supervisionada com um conjunto de
  confiança estático; as chamadas de confiança e de revogação compartilham a capacidade do supervisor, e uma vaga
  só é liberada quando sua fonte realmente termina. As respostas não mudam: um timeout, a falta de vaga livre
  ou um supervisor fechado dão o `REVOCATION_UNAVAILABLE` que uma fonte com falha dá (403 no Express e no
  FastAPI), e um erro `REVOCATION_INVALID` só conta antes do prazo. As fontes de TypeScript
  recebem `(subjects, { tenant, signal })`, `denyListRevocationSource` também aborta seu fetch nesse
  sinal, e a telemetria informa `source: 'revocation'`; `configureVerifier` do OpenClaw se recusa a
  substituir um supervisor com chamadas em andamento, qualquer que seja a fonte que ele supervisione. O FastAPI
  exige uma `revocation_source` assíncrona. Mudança de comportamento só com a opção: uma fonte do FastAPI que
  suprime o próprio cancelamento dá `REVOCATION_UNAVAILABLE` no prazo em vez do seu snapshot tardio. Não
  limitado: o trabalho que uma fonte inicia por conta própria, como o worker `asyncio.to_thread` de
  `deny_list_revocation_source`, cuja E/S não é cancelada. Sem a opção, nada muda.
- `dcp_ai.fastapi.DCPVerifyMiddleware`: um prazo e uma capacidade para um `trusted_principals` assíncrono,
  opt-in. `SourceSupervisor(max_in_flight=..., max_in_flight_per_tenant=None)`, exportado somente de
  `dcp_ai.fastapi`, e `source_supervisor` com `supervise={"trust_timeout": seconds}` (os dois
  juntos). A fonte roda como uma Task de propriedade do supervisor. Um conjunto de confiança que chega depois do
  prazo (`loop.time()`, verificado na chegada e no uso), uma chamada sem vaga livre (sem fila), um
  supervisor fechado ou ligado a outro event loop dão o mesmo 503 que uma fonte com falha. Uma
  vaga só é liberada quando a Task realmente termina. São fornecidos `close(drain_timeout)` e `stats()`.
  Um `trusted_principals` estático ou síncrono com essas opções lança
  `AdmissionConfigError`; o mesmo acontecia com `{"revocation": True}` nesta primeira etapa, agora aceito (veja a
  entrada de revogação acima). Um supervisor por event loop; ele não
  interrompe uma fonte que ignora o cancelamento nem isola a CPU. Sem essas opções, nada muda.
- `@dcp-ai/express` e `@dcp-ai/openclaw`: um prazo e uma capacidade para uma função `trustedPrincipals`,
  opt-in. `createSourceSupervisor({ maxInFlight, maxInFlightPerTenant?, onSourceEvent? })`
  cria um supervisor, e `sourceSupervisor` com `supervise: { trustTimeoutMs }` o aplica (os dois
  juntos, com `trustedPrincipals` como função). A função passa então a receber `{ tenant, signal }`.
  Um conjunto de confiança que chega depois do prazo, medido em um relógio monotônico na chegada, não
  é usado, assim como uma chamada que não encontra vaga livre (sem fila) ou um supervisor fechado: o
  resultado é o mesmo de uma fonte com falha (`TRUST_SOURCE_FAILED`, 503 no Express). Uma vaga só é
  liberada quando a função realmente termina. A capacidade é por objeto supervisor e pode ser compartilhada
  entre os dois pacotes e seus builds ESM e CJS. São fornecidos `close({ drainMs })` e `stats()`;
  os contadores param em `Number.MAX_SAFE_INTEGER`. `configureVerifier` do OpenClaw se recusa a
  substituir ou remover um supervisor enquanto uma chamada iniciada sob ele está em andamento (também antes de ela
  chamar sua fonte) ou sua fonte ainda roda, mesmo depois de `close()`. Ele não interrompe o trabalho de uma fonte
  nem isola a CPU. Sem essas opções, nada muda. Nesta primeira etapa,
  `supervise.revocation: true` era recusado e a revogação mantinha `revocationTimeoutMs`; agora é
  aceito (veja a entrada de revogação acima).
- `dcp_ai.fastapi.DCPVerifyMiddleware(max_body_bytes=...)`: um orçamento opt-in, em bytes, para o
  corpo da requisição (padrão `None`, sem orçamento, como antes; um inteiro positivo, senão
  `AdmissionConfigError` `CONFIG_INVALID_VALUE`). O middleware então lê o corpo primeiro, também
  com o bundle no cabeçalho ou `require_bundle=False`: um `Content-Length` acima do orçamento, ou
  bytes recebidos acima dele (sem `Content-Length`, em chunks, ou com um errado), recebem `413` sem
  receber o restante, analisar, resolver a confiança, verificar nem chegar à rota; um `Content-Length` inválido
  ou repetido ou uma desconexão durante o envio recebem `400`. Um corpo dentro do orçamento é
  tratado como antes e ainda chega à rota. Ele limita os bytes recebidos, não a
  descompressão, a profundidade do JSON nem o tempo, e é um limite de implantação, não parte do protocolo.
  A opção exige Starlette 0.28.0 ou posterior, que repassa à rota um corpo lido no middleware;
  com um Starlette mais antigo ou não identificado, ela lança `AdmissionConfigError`
  `CONFIG_INVALID_VALUE` quando o middleware é construído. As versões mínimas do pacote não
  mudam, e sem a opção nada é verificado.
- Admissão: principais confiáveis e o perfil `strict-v1` (`spec/profiles/admission`,
  `docs/ADMISSION.md`). Um bundle verificado prova a integridade e a assinatura pelas chaves que lista; um
  conjunto de confiança do operador (`schemas/v2/principal_trust_set.schema.json`) agora permite que um verificador
  admita um bundle somente quando as chaves que verificaram as assinaturas do seu principal (RPR e manifesto,
  clássica e PQ) são chaves ativas e confiáveis desse `human_id`. O `strict-v1`
  (`schemas/v2/admission_profile.schema.json`) acrescenta requisitos fixados pelo operador: somente V2, assinaturas
  híbridas para todos os níveis, vinculação de sessão, um `intended_verifier` assinado igual ao
  `verifier_id` do operador, uma sessão assinada de no máximo 300 s e um snapshot de revogação
  (`schemas/v2/revocation_snapshot.schema.json`) de no máximo 300 s de idade cobrindo o agente e toda
  chave de signatário verificada. Sua configuração só pode endurecê-lo; um valor que o enfraquece é um
  `CONFIG_PROFILE_CONTRADICTION`. Os resultados mantêm `verified` e acrescentam `principal_trust`,
  `profile_compliance`, `admitted`, `recorded_decision`, `trust_set_version`, `errors` com código e
  `action_authorized`, sempre `false`: a admissão não autoriza uma ação.
  - SDKs: TypeScript (`admitSignedBundleV2`, `evaluateAdmissionV2`, `createPrincipalTrustStore`,
    `resolveStrictV1Profile`, `revocationSubjects`, `revocationSnapshotFromDenyList`), com as mesmas
    funções em Python, Go e Rust. Os quatro verificadores aceitam um relógio opcional e informam a
    chave com que cada componente da assinatura foi verificado (`signer_keys`). No Rust, `V2VerificationResult`
    mantém seus dez campos e `verify_signed_bundle_v2` / `verify_signed_bundle_v2_with_policy`
    seus tipos, então o código compilado contra eles continua compilando: as chaves vêm do novo
    `verify_signed_bundle_v2_at`, que retorna `V2VerificationDetails` (`#[non_exhaustive]`; o
    resultado como `result`, e `signer_keys`, da mesma verificação). A admissão o recebe e o retorna;
    seu JSON são os campos do resultado seguidos de `signer_keys`.
  - Integrações: `dcpVerify` do `@dcp-ai/express`, `DCPVerifyMiddleware` do `dcp_ai.fastapi` e
    `configureVerifier` do `@dcp-ai/openclaw` aceitam `trustedPrincipals`, `profile`,
    `revocationSource` e, nos middlewares, uma função `tenant` do operador. Uma requisição chega
    à rota somente quando admitida. Uma função de confiança que lança uma exceção ou não retorna um conjunto de
    confiança válido (`undefined`, `null`, um conjunto inválido) recusa a requisição: `503` nos middlewares,
    `admitted: false` no OpenClaw. O cache do Express guarda só a verificação criptográfica,
    com chave no bundle, na política e no tenant; a confiança, o perfil e a revogação são
    avaliados em toda requisição. `denyListRevocationSource` lê uma lista de negação completa; uma fonte
    que falha ou esgota o tempo recusa a requisição.
  - Verificador de referência, servidor e CLI: `admitSignedBundle` em `lib/verify.js`, `POST /v2/admit`
    configurado por `DCP_TRUSTED_PRINCIPALS_FILE`, `DCP_ADMISSION_PROFILE_FILE` e
    `DCP_REVOCATION_LIST_URL`, e `dcp admit-bundle`.
  - `tests/interop/v2/admission_vectors.json`: 65 casos com resultados esperados escritos à mão e a
    regra que cada um verifica, e 49 casos de configuração, executados pelos quatro SDKs e por `npm run
    conformance`.
- SDK de Rust: construção e assinatura nativas de bundles V2, `dcp_ai::v2::bundle`. `build_bundle_v2(&rpr,
  &passport, &intent, &policy, &audit_entries, session_nonce)` verifica cada `payload_hash` e o
  `session_nonce` de cada artefato e entrada de auditoria, e escreve o manifesto com as duas raízes de
  Merkle da auditoria (uma trilha vazia recebe raízes de 64 zeros, como no Go); `sign_bundle_v2(bundle,
  &classical, &pq)` assina o manifesto de forma composta, com `signer.id` igual ao `human_id` do RPR, como faz o
  `SignBundleV2` do Go. Como o do Go, o construtor ainda não aceita checkpoints PQ. O agente Rust da
  matriz de interoperabilidade os usa em vez de montar o bundle à mão.
- `tools/interop-matrix`: interoperabilidade ao vivo entre os quatro SDKs. Um processo de agente por SDK
  (TypeScript, Python, Go, Rust) cria sua identidade, declara intenções, age e assina seus
  bundles de cidadania (DCP-01 a DCP-03); todos os demais agentes, e o verificador de referência
  `lib/verify.js`, os verificam sob a política padrão e sob `hybrid_required`, intactos e
  após sete adulterações em trânsito (intenção alterada, entradas de auditoria reordenadas ou removidas, sessão
  emendada, assinatura do bundle ou passaporte trocados, assinatura PQ removida). Os agentes compartilham apenas as
  mensagens que o orquestrador retransmite. `.github/workflows/interop-matrix.yml` a executa em todo pull
  request e todas as noites.
- `@dcp-ai/google-a2a` 2.1.0: o Agent Passport DCP assinado viaja dentro do Agent Card do A2A.
  `passportToAgentCard(signedPassport, url)` (ou `attachPassportToAgentCard(card, signedPassport)`)
  coloca o `SignedPayload<AgentPassportV2>` em `capabilities.extensions` do card, sob
  `https://dcp-ai.org/a2a/extensions/passport/v2`, o mecanismo de extensão do próprio A2A;
  `verifyAgentCardPassport(card)` o verifica off-line (hash do payload, assinatura composta
  `pq_over_classical` sob o contexto AgentPassport com as chaves ativas e não expiradas que o
  passaporte lista, `status: active`, e `metadata.dcp_agent_id` nomeando o mesmo agente), falhando de forma
  fechada diante de qualquer coisa malformada; `agentCardToPassport` retorna esse passaporte em vez de um
  esqueleto quando o card o tem. O pacote agora é TypeScript (build em `dist/`, suíte vitest
  na CI).
- `@dcp-ai/anthropic-mcp` 2.1.0: recibos assinados para chamadas de ferramentas MCP. `withDcpReceipt(name, handler,
  { identity })` envolve qualquer handler de ferramenta MCP: a chamada é classificada em uma Intent (DCP-02) e
  assinada de forma composta antes de a ferramenta rodar, a política decide (approve executa a ferramenta; escalate e
  block retornam um resultado `isError` sem executá-la; um handler que lança uma exceção produz `outcome:
  "failed"`), e uma entrada de auditoria (DCP-03) registra o SHA-256 dos argumentos e do resultado.
  O recibo em `_meta.dcp_receipt` é um bundle assinado DCP v2.0 comum, então qualquer verificador DCP
  o confere off-line; `verifyDcpReceipt` também recalcula o hash da evidência a partir dos argumentos e do
  resultado que quem chamou viu e confere o nome da ferramenta. `createReceiptIdentity` emite uma identidade de
  sessão (chaves Ed25519 + ML-DSA-65, RPR e passaporte assinados) para testes e primeiras execuções. O pacote agora é
  TypeScript (build em `dist/`, suíte vitest na CI) e `dcp_verify_bundle` executa o
  `verifySignedBundleV2` real em vez de uma verificação estrutural; sua entrada `security_tier`, que não era usada,
  foi removida.
- `tests/interop/v2/bundle_vectors.json`: mais 28 casos de rejeição (5 mutações `must_reject`, 23 `must_reject_bundles`),
  um por vulnerabilidade da rodada v2.10, que os quatro verificadores dos SDKs (Python incluído) executam em todos
  os modos de verificação: artefatos sem nenhuma `composite_sig` (V2-8); `dcp_bundle_version` `1.0` e `3.0`
  (V2-1); uma chave expirada com um deslocamento diferente de UTC, valores `expires_at` de chave malformados (data
  impossível, só data, sem deslocamento) no passaporte e uma data impossível no RPR (V2-13); bundles somente clássicos
  cuja intenção ou decisão de política implica `elevated` enquanto a intenção declara `security_tier: "routine"` ou
  `estimated_impact: "high"` (V2-10); chaves do protótipo (`constructor`, `__proto__`, `toString`,
  `hasOwnProperty`) no `risk_tier` do passaporte e `constructor` em `action_type`,
  `estimated_impact` e `security_tier` (V2-9); um `canonicalization_profile` desconhecido ou que não é
  string (V2-3); uma intenção, uma entrada de auditoria ou o manifesto com outro
  `session_nonce` (V2-4); um hash do manifesto, uma raiz de auditoria ou um hash de cadeia que não coincide (V2-3).
- `tools/difffuzz`: um fuzzer diferencial que passa o mesmo bundle assinado V2 mutado pelos verificadores de
  TypeScript, Python, Go e Rust (um adaptador por SDK, compilado a partir deste checkout) e falha
  diante de qualquer divergência, travamento ou timeout, salvando cada achado em `tools/difffuzz/findings/`.
  As sementes são os bundles assinados V2 de `tests/interop/v2/`; os mutadores cobrem campos removidos e nulos,
  trocas de tipo, trocas entre irmãos, trocas de caracteres base64, chaves do protótipo, chaves desconhecidas,
  artefatos duplicados, variantes de números e de RFC 3339, strings grandes demais, aninhamento profundo e
  reordenação de chaves (que nunca deve mudar um veredito).
- `.github/workflows/difffuzz.yml` executa o fuzzer em todo pull request (300 iterações), em
  `workflow_dispatch` e todas as noites (3000 iterações).
- Cadeias de delegação verificáveis (DCP-09 §3.5) nos quatro SDKs. `schemas/v2/delegation_mandate.schema.json`
  ganha os campos opcionais `parent_mandate_id`, `delegation_depth`, `sub_delegation`
  (`{ permitted, max_depth }`), `minimum_security_tier` e `delegator_composite_sig`; um mandato raiz
  mantém `human_composite_sig` e não muda nem um byte, um submandato tem em seu lugar
  `delegator_composite_sig`, assinada pelo agente que delega sob o novo contexto de separação de domínio
  `DCP-AI.v2.SubMandate` (`domain-separation.{ts,py,go,rs}`, `interop_vectors.json`).
  `verifyMandateChain` / `verify_mandate_chain` / `VerifyMandateChain` verifica uma cadeia ordenada
  off-line até a pessoa: a assinatura raiz com as chaves da pessoa, a assinatura de cada salto com as chaves
  do agente pai, o elo com o pai e a profundidade, `sub_delegation.permitted` e o menor `max_depth`
  dos ancestrais, o mesmo `human_id`, janelas de validade aninhadas comparadas como instantes RFC 3339,
  a atenuação (subconjuntos de `actions_permitted` e `data_classes`, `limits` nunca mais frouxos, um filho não pode
  acrescentar `data_classes` se o pai não tem nenhuma, e `limits` numéricos só como inteiros dentro de ±(2^53 − 1):
  além disso, um verificador que lê números JSON como doubles e outro que mantém todos os dígitos discordam sobre o
  que um mandato diz, então um limite assim é `not comparable` em qualquer profundidade), um `minimum_security_tier`
  que nunca fica abaixo do do pai, e a revogação, em que um ancestral revogado invalida todos os descendentes. O
  resultado traz o nível efetivo da cadeia (o maior `minimum_security_tier` ao longo dela). Tudo o que for
  desconhecido, faltar para a profundidade ou não for comparável falha de forma fechada. As chaves de assinatura
  precisam estar `active` e não expiradas no momento da verificação, e a assinatura de um mandato precisa ser
  `pq_over_classical`.
- Construtores de submandatos ao lado do construtor raiz: `createSubMandate` / `create_sub_mandate` /
  `CreateSubMandate`, e `sub_delegation` / `minimum_security_tier` no construtor raiz
  (`create_delegation_mandate_with_options` e `MandateChainOptions` no Rust).
- `computeSecurityTier` / `compute_security_tier` / `SecurityTierInput.MandateChainTier` /
  `compute_security_tier_with_floor`, e a cópia raiz `lib/security-tier.js` (`computeSecurityTier(intent,
  policyDecision, mandateChainTier)`), aceitam o nível efetivo de uma cadeia verificada como entrada opcional
  que só pode elevar o nível (especificação §14.2); no Go, um `MandateChainTier` vazio significa nenhuma cadeia, e
  qualquer outro nome que não seja um nível conta como `elevated`. Os verificadores de bundles ainda não o leem:
  um bundle não tem nenhum campo que carregue sua cadeia de mandatos.
- `tests/interop/v2/mandate_chain_vectors.json` (gerado por
  `sdks/typescript/src/__tests__/generate-mandate-chain-vectors.ts`): cadeias de profundidade 1 e 2 que todo
  SDK precisa aceitar com sua profundidade e seu nível efetivo, cadeias que todo SDK precisa rejeitar (ações
  ampliadas, classes de dados acrescentadas, limites afrouxados, um limite de 2^53 ou de 2^53 + 1 escrito como o
  inteiro do formato de transmissão que um double não consegue representar, validade fora da do pai, profundidade
  além de `max_depth`, `parent_mandate_id` ausente ou errado, nível rebaixado, raiz ou intermediário revogados, um
  submandato assinado pelo agente errado, as duas assinaturas presentes, `delegation_depth` errada, e mais) e os
  casos do piso de nível. As quatro suítes dos SDKs o executam.
- APIs experimentais e opt-in para o candidato de canonicalização `dcp-jcs-v2`
  (`docs/proposals/canonicalization-candidate`, §15–§18). O candidato não é normativo nem está
  ativo: `dcp-jcs-v1` continua sendo o único perfil de canonicalização normativo e padrão, e nenhum padrão,
  construtor, signatário ou verificador muda. Só quem chama e opta por elas chega a essas APIs, em TypeScript,
  Python, Go, Rust e WASM.
  - **Ingresso:** verifica os bytes originais de uma unidade (UTF-8, BOM, duplicatas, inteiros exatos em
    ±(2^53−1), profundidade 64) e dá seus bytes canônicos ou uma classe e um deslocamento.
  - **Roteador:** extrai a unidade do seu transporte, lê o perfil e decide: rejeitar,
    delegar ao `dcp-jcs-v1` por meio de um decodificador histórico nomeado, ou selecionar o candidato.
  - **Verificador:** verifica a partir dos bytes originais com no máximo um verificador: o atual para
    `dcp-jcs-v1`, e o atual aceitando exatamente `dcp-jcs-v2` para o candidato. Um bundle verificado
    não concede confiança nem admissão.
  - **Produtores:** assinam artefatos (`experimentalCandidateSignPayload` e seus equivalentes) e
    bundles cujo manifesto nomeia `dcp-jcs-v2` (`experimentalCandidateSignBundle`), a partir de bytes
    originais ou de valores do host verificados de forma estrita. Uma rejeição pelo domínio ou pela forma das entradas
    é lançada antes de qualquer signatário ser chamado; um erro de chave, de registro ou de provedor ainda pode vir
    depois de uma assinatura ter sido feita.
  - **Testes:** uma matriz cruzada de cinco produtores × cinco consumidores
    (`tests/interop/candidate/phase4`, 975 resultados com um veredito tudo ou nada) e sua medição de
    custo, executada pelo novo workflow `canonicalization-candidate-matrix`, que não publica
    nada. Os vetores estão em `tests/interop/candidate/`.

<a id="changed"></a>

### Alterado

- As traduções agora ficam em `i18n/<locale>/`, no mesmo caminho da fonte em inglês, que não muda de lugar:
  `<dir>/<name>.<locale>.md` passa a ser `i18n/<locale>/<dir>/<name>.md` para `es`, `pt-BR`, `ja` e `zh-CN` (388
  arquivos). A mudança alterou apenas caminhos de links: os dos arquivos movidos e os links de idioma de dez
  documentos em inglês. O README em inglês de cada SDK aponta para as traduções com URL absoluta, para que seus
  links de idioma não dependam de caminhos fora do pacote. O site de documentação mantém as URLs, as âncoras e o
  seletor de idioma nos cinco idiomas. Os caminhos antigos não existem mais em `main` e não há arquivos de
  redirecionamento; um commit ou uma tag anteriores mantêm cada arquivo no caminho antigo. As versões futuras dos
  pacotes npm dos SDKs e das integrações, empacotadas a partir desta árvore, não incluem mais os READMEs
  traduzidos; os pacotes já publicados não são modificados, e seus links para os caminhos antigos no GitHub podem
  ficar desatualizados. A verificação de documentação (`scripts/docs_i18n.py`) também rejeita arquivos em `i18n/`
  que não sejam uma tradução registrada, links para `i18n/` que não cheguem a uma e avisos de tradução que não
  apontem para a fonte exata em inglês, e verifica os links para a branch `main` deste repositório como links
  locais.
- `dcp-ai verify` (`@dcp-ai/cli`) verifica bundles V2 (`bundle.dcp_bundle_version` "2.0" ou um
  `bundle.manifest`) com o verificador normativo: o envelope e os quatro payloads assinados são
  validados com `schemas/v2`, cujas cópias vêm no pacote, e então `verifySignedBundleV2`
  do `@dcp-ai/sdk` roda sob `DEFAULT_VERIFIER_POLICY` com os provedores Ed25519, ML-DSA-65 e
  SLH-DSA-192f. O envelope pré-normativo (`dcp_version` "2.0" ou `bundle_manifest` no nível superior, ou
  `signature.binding: "composite"`) é rejeitado antes de qualquer outra coisa, também quando essas marcas estão em
  um bundle V1 ou V2, e sua verificação de `signature.classical.value` foi removida, sem recurso à assinatura
  clássica. Quando `.dcp/keys/ed25519_public.key` existe, ele fixa a chave de assinatura do principal entre as
  `binding_keys` do RPR (um arquivo vazio é rejeitado); sem ele, são usadas as próprias chaves do bundle, o que
  verifica as assinaturas, não a confiança nem a admissão. A verificação V1 não muda. `dcp-ai sign` também não muda:
  ele acrescenta a `signatures[]`, um formato que `verify` não lê; bundles V2 são assinados com `signBundleV2` ou
  `dcp sign-bundle --composite`. O pacote agora exige `@dcp-ai/sdk` `^2.2.0` e declara `ajv` e `ajv-formats`.
- `dcp-ai verify` (`@dcp-ai/cli`) sai com 0 somente quando imprime VALID. Em arquivos V1 ele agora sai com 1,
  onde saía com 0, quando a assinatura Ed25519 é INVALID, quando falta a chave ou falta uma assinatura utilizável (ele imprime
  «No public key available», também quando a chave existe e a assinatura está ausente ou vazia) e quando o arquivo não
  é um bundle assinado (um objeto sem um `bundle` verdadeiro, um array ou um valor primitivo). Essas mensagens não
  mudam, e um argumento ou arquivo ausente, JSON inválido, base64 ou um tamanho errado continuam saindo com 1 e seu
  erro. Um script que tomava a saída 0 como «rodou» agora precisa esperar 1 nesses casos. Em um arquivo V1, a saída 0
  significa que a assinatura Ed25519 sobre o bundle canônico foi verificada, nada mais; em um bundle V2, significa que
  os schemas e o verificador normativo passaram (acima). Nenhuma das duas é uma decisão de admissão.
- Verificadores V2 de Go e Rust: uma política que restringe `accepted_classical_algs` ou `accepted_pq_algs`
  era recusada como um campo que eles não aplicavam, então todo bundle falhava sob ela; agora eles aplicam
  as duas listas como TypeScript e Python fazem (a lista clássica exceto sob `pq_only`), e uma
  assinatura com um algoritmo fora delas falha como não aceita pela política do verificador. Eles também
  aceitam `allow_v1_bundles: false`, que o strict-v1 define: verificam somente bundles V2, então
  o campo não muda nada para eles. As políticas que verificavam antes se comportam da mesma forma.
- O verificador de referência (`lib/verify.js`, `dcp verify-bundle`, o servidor de verificação e sua
  imagem Docker) depende do `@dcp-ai/sdk` do workspace (`file:sdks/typescript`, empacotado por meio de
  `install-links` em `.npmrc`) até que a 2.2.0 esteja no npm, de modo que executa as correções do verificador desta
  versão em vez da 2.1.1 publicada, que aceitava 39 dos 79 vetores `must_reject_bundles`. Compile
  `sdks/typescript` antes de `npm install` na raiz; a CI e o `docker/Dockerfile` fazem isso. Publicar
  exige elevar a dependência de volta para `^2.2.0`.
- `lib/verify.js`: a validação de schemas constrói um Ajv por raiz de schemas e compila cada schema uma única vez,
  no primeiro uso, em vez de carregar e compilar todos os schemas a cada chamada de `validateOne` (cinco por
  bundle V2). Validar os schemas de um bundle V2 passou de cerca de 34 ms para 0.14 ms (mediana de 20 execuções
  após a primeira, que ainda compila).

<a id="fixed"></a>

### Corrigido

- **Mudança de aceitação: `v2.VerifyPayloadHash` do Go agora confere o `payload_hash` normativo**
  (código-fonte de `main`, não publicado; o Go v2.11.1 mantém o defeito). Ele comparava o SHA-256 em
  hex sem prefixo com `payload_hash`, então devolvia `false` para a saída de `SignPayload` e para todo
  valor válido segundo o schema (`sha256:<hex>`), e `true` para o digest sem prefixo. Agora devolve
  `true` somente quando `payload_hash` é exatamente `"sha256:"` seguido do SHA-256 em hex minúsculo
  dos bytes `dcp-jcs-v1`, o valor usado por `SignPayload`, `schemas/v2/signed_payload.schema.json` e
  pelos helpers de TypeScript, Python e Rust. Um digest sem prefixo, hex em maiúsculas, espaços ao
  redor ou qualquer outra forma agora devolve `false, nil`. Migração: passe `payload_hash` como foi
  recebido; para construí-lo a partir de `PreparePayload`, escreva `"sha256:" + hash`.
  `PreparePayload` continua devolvendo o digest sem prefixo (seu comentário agora diz isso), os erros
  de `nil` e de canonicalização não mudam, e o verificador de bundles, que nunca usou este helper, não
  muda. O helper só confere a consistência do hash, não a assinatura, as chaves, a política nem a
  admissão. Novo `sdks/go/dcp/v2/signed_payload_test.go`. O README do Go e o comentário de
  `AuditEvidenceV2` agora também dizem que decodificar um bundle recebido nos structs tipados descarta
  os membros `null` e desconhecidos de `evidence`, então os bytes recebidos são os que devem ser
  guardados e verificados.
- **Mudança de aceitação: `wasm_dual_merkle_root` do WASM e `dualMerkleRoot` do `@dcp-ai/wasm` agora
  calculam a raiz Merkle dupla do V2-11** (código-fonte de `main`, não publicado; o `@dcp-ai/wasm`
  2.1.1 e anteriores mantêm o helper antigo). O helper fazia o hash do texto hexadecimal de dois
  digests concatenados e promovia o nó ímpar, então com 2 ou mais folhas suas raízes não coincidiam
  nem com `spec/VERIFICATION.md` V2-11 (digests de 32 bytes brutos concatenados, o último nó
  duplicado em uma camada ímpar) nem com os SDKs de TypeScript, Python, Go e Rust. Agora delega ao
  núcleo de Rust `v2::dual_hash::dual_merkle_root`. A mudança não se limita às raízes de várias
  folhas: estas mudam porque eram incompatíveis com o V2-11; uma folha que não é um digest
  hexadecimal de 32 bytes agora é um erro em vez de ter o hash calculado como texto; e as raízes são
  sempre hex em minúsculas, então uma única folha dada em maiúsculas agora volta em minúsculas. Uma
  única folha válida em minúsculas, o formato do resultado e os erros para um array vazio e para uma
  entrada que não é JSON não mudam. A verificação de bundles, incluindo o verificador WASM, já usava
  a redução correta e não muda; os bundles anteriores e sua evidência não são reescritos nem
  assinados de novo, porque a mudança se limita a este helper. Os
  novos vetores públicos `tests/conformance/v2/merkle_vectors.json` (raízes exatas para 1, 2, 3 e 5
  folhas e para folhas reordenadas, geradas offline com a biblioteca padrão do Python e ancoradas
  nas raízes golden de 2 folhas) são verificados por `sdks/wasm/test/dual-merkle-root.mjs` e
  `sdks/rust/tests/dual_merkle_vectors.rs`.
- `denyListRevocationSource` (`@dcp-ai/express`, `@dcp-ai/openclaw`) deixava respostas abertas. Uma resposta
  que não era 2xx ou um `Content-Length` declarado acima de 16 MiB era recusado sem ler nem fechar seu
  corpo: a resposta continuava aberta depois que a chamada terminava e sua vaga era liberada, fora do alcance do
  timeout e do sinal de quem chamou. E com Node 22.15 (undici 6.21.2), uma coleta de lixo depois dos
  cabeçalhos impedia que o sinal do fetch chegasse a um corpo em leitura: seu próprio timeout e o
  prazo do supervisor já não paravam um corpo que ainda chegava, e a chamada nunca terminava,
  segurando sua vaga. Agora ele aborta seu fetch e cancela o corpo em toda saída, para a própria leitura
  no seu sinal e libera o leitor. Códigos, padrões e capacidades não mudam; nada é
  drenado, e o fechamento remoto não é aguardado.
- CLI de referência (`bin/dcp.js`): os caminhos eram limitados ao diretório de trabalho como estavam escritos, não
  para onde levavam, e várias leituras e escritas pulavam a verificação. Um link simbólico dentro do diretório de
  trabalho, ou um caminho para outro diretório (`keys rotate --key-dir`, `governance sign-advisory
  --key-dir`, `governance verify-advisory --sigs`), permitia que um comando lesse arquivos fora dele, incluindo
  chaves secretas; um link simbólico ou físico em um caminho de saída (`keygen`, `keys rotate`,
  `recovery-setup`, os comandos de governança, a saída do `sign-bundle` V1) fazia com que ele escrevesse fora;
  um arquivo de chave secreta existente mantinha permissões mais amplas; e `dcp validate`, `conformance` e o
  `sign-bundle` V1 executavam `tools/*.js` a partir do diretório de trabalho, então um script plantado ali era
  executado. Todo caminho agora é resolvido com seus links simbólicos (um pendente é recusado) e verificado, toda
  leitura e escrita de um caminho do usuário passa por essa verificação, os arquivos são escritos em um arquivo novo
  (`O_EXCL`, permissões exatas) renomeado sobre o destino, e a CLI executa suas próprias ferramentas. A CLI supõe que
  nada mais muda o diretório de trabalho enquanto um comando roda; no Windows, onde `O_NOFOLLOW` não existe, a
  renomeação continua substituindo um link em vez de escrever através dele.
- `@dcp-ai/anthropic-mcp` e `@dcp-ai/google-a2a`: a condição de exportação `"types"` vinha primeiro, então
  um consumidor CommonJS recebia as declarações ESM (`dist/index.d.ts`) e o TypeScript recusava
  `require()` sob `node16` com TS1471. A condição foi removida, então `require` recebe
  `dist/index.d.cts` e `import` recebe `dist/index.d.ts`. `@dcp-ai/sdk`, `@dcp-ai/express` e
  `@dcp-ai/openclaw` removem a mesma condição, que vinha depois de `"import"` e `"require"`, nunca
  correspondia e fazia o tsup emitir um aviso em todo build. No `@dcp-ai/wasm`, cujas exportações não têm
  `"require"`, ela dava a um consumidor CommonJS tipos sob `nodenext` para um `require()` que o Node recusa com
  `ERR_PACKAGE_PATH_NOT_EXPORTED`. O TypeScript agora informa TS2307 também ali.
- SDK de Go: `VerifySignedBundleV2WithPolicy` reprovava todo bundle sob uma política que definia
  `require_session_expiry`, `require_audience_binding` ou `verifier_id`, campos que
  `verifier_policy.schema.json` lista e que os verificadores de TypeScript e Python aplicam. `VerifierPolicy`
  agora os tem (`RequireSessionExpiry`, `RequireAudienceBinding`, `VerifierID`, desligados no valor zero) e
  o verificador os aplica como o TypeScript: um manifesto sem `session_expires_at`, sem
  `intended_verifier` ou destinado a outro verificador que não o `verifier_id` é rejeitado.
- SDK de Rust e `@dcp-ai/wasm`: `VerifierPolicy` recusava `require_session_expiry`,
  `require_audience_binding` e `verifier_id`, que `schemas/v2/verifier_policy.schema.json`
  lista e que os verificadores de TypeScript e Python aplicam, então uma política que definisse qualquer um deles
  reprovava toda verificação. Agora eles são aplicados como no TypeScript: sob `require_session_expiry`, um
  manifesto sem `session_expires_at` é rejeitado, e sob `require_audience_binding`, um
  sem `intended_verifier` ou, com `verifier_id` definido, com outro. O `BundleManifest` do Rust
  ganha `intended_verifier`.
- SDK de Python, `dcp_ai.langchain` (`DCPTool.run`, `DCPTool.arun`) e `dcp_ai.openai`
  (`dcp_verify_bundle` em `handle_dcp_tool_call`): os dois enviavam todo bundle ao verificador V1, então
  todo bundle V2 era rejeitado e um bundle V1 era aceito sem nenhuma política de verificação. Agora eles
  verificam bundles V2 com `verify_signed_bundle_v2` e um registro Ed25519 / ML-DSA-65 / SLH-DSA-192f
  construído uma única vez, sob uma política de verificação definida por quem chama (`DCPTool(verifier_policy=...)`,
  `handle_dcp_tool_call(..., verifier_policy=...)`, sobre `DEFAULT_VERIFIER_POLICY`), e retornam os
  erros do verificador, no máximo 20 erros e 20 alertas de 500 caracteres cada, com os caracteres de controle e
  de formatação do texto fornecido pelo bundle (um `agent_id`, um carimbo de data/hora inválido) escapados, de modo
  que um bundle não consiga colocar megabytes ou quebras de linha no contexto do modelo. Um bundle V1 só é aceito
  sob a regra V2-10 do middleware FastAPI, agora compartilhada pelos três pontos de entrada
  (`dcp_ai._verify_any`) e estendida a toda a política: a política permite bundles V1, aceita
  ed25519 (em `accepted_classical_algs`, não em `advisory_rejected_algs`), não exige vinculação de audiência,
  expiração de sessão nem duração máxima de sessão (um bundle V1 não tem `intended_verifier` nem
  janela de sessão), e aceitaria um bundle somente clássico para o seu nível de risco e o seu nível de segurança;
  o middleware FastAPI também aplica as condições acrescentadas. Um bundle V1 cujos artefatos não são
  objetos, ou cujo `audit_entries` não é uma lista de objetos, é recusado nos três (o
  middleware FastAPI respondia 500 para um `agent_passport` que não era objeto, agora 403), e
  `dcp_ai.verify.verify_signed_bundle` retorna um erro em vez de lançar uma exceção diante de um bloco de assinatura,
  uma chave ou uma trilha de auditoria malformados. Um bundle V1 cujo `agent_id` do passaporte ou `human_id` do RPR
  não é uma string (ou cujo `public_key`, `status` ou `capabilities` do passaporte tem o tipo errado) também é
  recusado, em vez de chegar ao contexto do agente do FastAPI. As respostas 403 do middleware FastAPI e os `warnings`
  do seu contexto são limitados e escapados como a saída das pontes. Uma instância de
  `VerifierPolicy` é validada como um dict, então uma construída com `model_construct` ou
  alterada por atribuição não pode ter um valor inválido, e um nível de risco que seus `risk_overrides` deixam de fora
  recebe o seu `default_mode`, como o verificador V2 e o `resolveMode` do SDK de TypeScript o resolvem
  (um bundle V1 para esse nível era recusado com «is not low, medium or high»). Os pontos de entrada
  síncronos funcionam dentro de um event loop em execução (a verificação roda em uma thread de trabalho)
  e rodam em um loop privado, deixando o event loop atual da thread como estava; `DCPTool.arun`
  aguarda a verificação, e o novo `averify_bundle_tool_call` é a forma assíncrona da chamada de ferramenta da
  OpenAI. Os dois passam em todos os casos de `tests/interop/v2/bundle_vectors.json`.
- SDK de Go: `BundleManifest` não tinha `intended_verifier`, então um manifesto decodificado nele e codificado
  de novo perdia o campo e sua assinatura deixava de ser verificada. O campo agora existe
  (`IntendedVerifier`, omitido quando vazio); um teste faz a ida e volta de um manifesto com todos os campos do schema.
- SDK de Python, `dcp_ai.crewai`: os agentes de um `DCPCrew` nunca compartilhavam o nonce de sessão da crew.
  `DCPCrewAgent` sempre gerava o próprio, então a verificação da crew para um agente sem nonce nunca se
  aplicava, e as entradas de auditoria de cada agente tinham um `session_nonce` diferente. Agora uma crew dá
  o seu nonce a todo agente que ainda tem o nonce que gerou para si e ainda não registrou
  nada; um nonce dado ao agente, ou definido nele depois, permanece.
- Feature `wasm` do Rust e `@dcp-ai/wasm`: `wasm_sign_bundle` (`signBundle`) escrevia
  `created_at ""` e nenhum `signer.id`, então o verificador de referência, a CLI e o servidor rejeitavam
  todo bundle que ele assinava (`created_at must match format "date-time"`, `signer must have required
  property 'id'`). `wasm_build_bundle` (`buildBundle`) juntava as folhas de auditoria SHA3-256 com
  SHA-256, ao contrário de todos os outros SDKs, e pulava uma entrada de auditoria que não conseguia canonicalizar,
  embora continuasse a contá-la. Os dois agora chamam `build_bundle_v2` e `sign_bundle_v2`, então `buildBundle` também
  rejeita um `payload_hash` que não corresponde ao seu payload e um artefato ou entrada de outra
  sessão. Sem `sessionNonce`, `buildBundle` gerava um nonce que nenhum artefato tinha, então até
  `verifyBundle` rejeitava o bundle; agora ele usa o `session_nonce` do RPR. A demonstração `example.html`
  passava payloads brutos para `wasm_build_bundle`, que nunca os aceitou; agora ela assina cada
  artefato primeiro. O tipo `SignedBundleV2` declara `signer.id`.
- SDK de Rust: `Ed25519Provider::sign` entrava em pânico com uma chave secreta menor que 32 bytes (no wasm, uma
  trap em vez de um erro JSON); agora retorna `invalid secret key length`.
- Cadeias de mandatos (os quatro SDKs): uma entrada de submandato sem `data_classes` sob uma entrada do pai
  que as tem passava na atenuação, embora nada a prendesse então às classes de dados do pai.
  Agora ela é rejeitada (`data_classes for domain "<d>" missing`), como uma chave de `limits` ausente já era;
  o DCP-09 §3.5.2, regra 5, diz isso. Vetor compartilhado `dropped_data_classes`.
- SDK de Go: um `A2ASession` usado a partir de várias goroutines derrubava o processo (`fatal error:
  concurrent map writes` em `DecryptMessage`). A sessão agora tem um mutex, então
  `EncryptMessage`, `DecryptMessage` e `NeedsRekeying` podem rodar concorrentemente; as sequências continuam
  únicas e cada mensagem continua sendo aceita uma única vez. `IntentV2` ganha `SecurityTier` e
  `PolicyDecisionV2` ganha `ResolvedTier` (ambos opcionais no schema e omitidos quando vazios), então quem
  integra em Go usando os payloads tipados pode declará-los.
- `tools/difffuzz`: `prototype_key_as_key` atribuía `__proto__` como uma propriedade comum, o que define o
  protótipo em vez de acrescentar uma chave, então esses mutantes nunca tinham a chave que diziam ter (e um
  ciclo podia derrubar a execução); agora ele define uma chave própria. Um adaptador que não consegue iniciar ou que
  morreu entre vereditos é relatado como travamento em vez de como erro não tratado. `spec/VERIFICATION.md` agora
  nomeia corretamente o construtor de bundles do Rust (`wasm_build_bundle`, somente na feature `wasm`).
- SDK de Go: `SignBundleV2` deixava `signature.signer.id` vazio, o que `signed_bundle.schema.json`
  proíbe, então o verificador de referência, a CLI e o servidor rejeitavam todo bundle que ele assinava enquanto
  os quatro verificadores dos SDKs o aceitavam (encontrado pelo `tools/interop-matrix`). O signatário agora é o
  principal responsável do bundle (`signer.id` = o `human_id` do RPR), e um bundle cujo RPR não tem
  `human_id` é recusado antes da assinatura.
- Sessões A2A (TypeScript, Python, Go): `decryptMessage` / `decrypt_message` / `DecryptMessage`
  guardam as sequências aceitas dentro da janela de recepção e aceitam cada uma uma única vez, inclusive fora de
  ordem; uma sequência que não é um inteiro não negativo é rejeitada, e uma sequência só é
  registrada depois que sua tag de autenticação é verificada. Uma sequência uma janela inteira ou mais à frente do
  contador de recepção é rejeitada (DCP-04 §8.4). Uma sessão restaurada sem o novo campo (TypeScript
  `undefined`, Go `nil`, Python `None`, o padrão do construtor) conta como recebidas todas as sequências da janela
  abaixo do seu contador de recepção. `verifyResumeProof`
  (TypeScript) compara em tempo constante, como Python e Go já faziam. A sessão do Go é
  documentada como não segura para uso concorrente.

- SDK de Rust: `serde_json` agora tem `float_roundtrip`. Seu analisador rápido de ponto flutuante erra por um ULP
  em literais decimais longos, então `9007199254740991.0` (que o `dcp-jcs-v1` lê como o inteiro
  9007199254740991, como todos os outros SDKs fazem) virava 9007199254740990 e `2251799813685247.0`
  um não inteiro, e o verificador de Rust rejeitava assinaturas e limites que os verificadores de TypeScript, Python
  e Go aceitam. Vetor compartilhado `limits_written_in_decimal_form`.
- `@dcp-ai/wasm`: o pacote npm inclui `pkg/` (o binário `.wasm` e o seu código de ligação). O wasm-pack escreve
  `pkg/.gitignore` = `*`, o npm respeita arquivos `.gitignore` aninhados, e `@dcp-ai/wasm@2.0.0` foi publicado
  sem `pkg/`, então sua importação em tempo de execução de `../pkg/dcp_ai.js` falhava. O build remove esse arquivo e
  a suíte de testes verifica o tarball.
- `@dcp-ai/sdk`: a versão de telemetria embutida é lida de `package.json` em tempo de build (`tsup.config.ts`)
  em vez de um literal no script de build; a 2.2.0 teria se identificado como 2.1.2.
- `verify_signed_bundle_v2` do Python relatava um artefato sem `composite_sig` como
  `Malformed signed bundle: KeyError('composite_sig')`; o erro agora nomeia o artefato
  (`intent: Missing composite signature`), como nos outros SDKs.
- `verifySignedBundleV2` do TypeScript retorna um veredito de falha (`Malformed signed bundle: ...`) para um
  bundle assinado estruturalmente malformado em vez de lançar uma exceção: um `bundle`, `signature`, `manifest` ou
  `audit_entries` ausente, `null` ou que não é objeto, uma entrada de auditoria `null`, ou um número não
  inteiro (`0.5`, `1e400`) em um objeto canonicalizado (`spec/VERIFICATION.md` V2-3, V2-5). Os
  verificadores de Python, Go e Rust já os rejeitavam; encontrado pelo `tools/difffuzz`.
- `VerifyObject` V1 do Go entrava em pânico com uma chave pública que não decodificava para 32 bytes (`ed25519.Verify`
  entra em pânico com qualquer outro comprimento). Agora ele verifica o comprimento decodificado e retorna um erro.
  `VerifySignedBundle` mantém o seu comportamento em volta: uma chave pública vazia recorre à
  embutida na assinatura, a falta das duas dá `missing public key`, e um erro de
  `VerifyObject` é relatado como `SIGNATURE INVALID`.
- O decodificador CBOR do TypeScript (`sdks/typescript/src/wire/cbor.ts`, opcional) rejeita chaves de mapa
  duplicadas, UTF-8 inválido, e inteiros e comprimentos fora do intervalo de inteiros seguros. Ele mantém U+FEFF como
  dado de texto, define uma chave `__proto__` como propriedade própria em vez de invocar o setter, e o
  codificador rejeita surrogates isolados em vez de substituí-los. Isso reforça o tratamento da entrada do
  decodificador; não é um decodificador CBOR canônico completo e não acrescenta nenhum perfil de canonicalização.

<a id="documentation"></a>

### Documentação

- `spec/profiles/admission/README.md` (perfil de admissão): precisões editoriais, sem mudar nenhum
  vetor, schema ou comportamento dos SDKs; os quatro SDKs já se comportam como elas dizem. O passo 2
  do §5.1 verifica o bundle como um bundle V2 assinado: um bundle que não é V2 não é verificado,
  seja qual for o valor de `allow_v1_bundles`, e sob o perfil P1 para antes da verificação e informa
  o bundle como não verificado. Um perfil exige um conjunto de confiança: a função combinada e o
  passo 3 sozinho recusam um perfil sem ele com `CONFIG_PROFILE_CONTRADICTION`, e a função combinada
  recusa com o mesmo código um perfil junto com uma política de verificador de quem chama; não se
  fixa se isso acontece antes ou depois da verificação. No §4.1, um modo fora da enumeração dos
  quatro modos é `CONFIG_INVALID_VALUE`, como um valor de tipo errado, enquanto um modo dessa
  enumeração diferente de `hybrid_required`, ou um algoritmo fora do subconjunto permitido, é
  `CONFIG_PROFILE_CONTRADICTION`. §2.2: quando um conjunto de confiança tem vários problemas, o
  código de qualquer um deles pode ser informado; ele é rejeitado seja qual for o informado, sem
  precedência definida. §5.2: `errors` segue a ordem das fases do §5.1, uma verificação pode
  acrescentar o seu código uma vez por componente ou sujeito, e nenhuma ordem é fixada dentro de uma
  fase. `tools/conformance/README.md`: as strings `error_contains` que o catálogo de evidência julga
  (146 dos seus 241 casos) são a redação de diagnóstico dos SDKs, não são normativas.
- `docs/QUICKSTART_CREWAI.md`: nenhum dos dois exemplos rodava. O V1 importava `build_bundle`, que o
  SDK de Python não tem, e escrevia assinaturas onde `intent_hash` e `prev_hash` recebem hashes;
  o V2 usava uma API que nunca foi lançada e dizia que o SDK de Python não tinha construtor, signatário nem
  verificador de bundles V2, embora `dcp_ai.v2` os inclua (desde a 2.9.0). Os dois agora usam o SDK
  como ele é: um controle de política decide antes de a ferramenta rodar, a consulta de busca fica fora do
  registro, cada chamada de ferramenta sela o próprio bundle, e a verificação fixa o operador (V1: sua chave
  pública; V2: o hash do seu RPR e os seus kids sob `hybrid_required`, e que cada kid seja derivado da sua chave,
  já que as próprias chaves do bundle só o tornam consistente consigo mesmo). Os bundles são verificados em Python e
  com `dcp verify-bundle`, e os V2 também com os SDKs de TypeScript, Go e Rust. O guia importa `tool` de
  `crewai.tools`, como o CrewAI documenta, e descreve o scaffold de `npm create @dcp-ai/crewai` como o
  passo a passo com marcadores que ele é.
- `integrations/crewai/README.md`: os exemplos usavam payloads V1 com valores que os schemas recusam
  (`liability_mode: "full"`, a capacidade `write_file`) e imprimiam um campo `action_type` que as entradas de
  auditoria não têm. Agora eles rodam; o README diz que `DCPCrewAgent` e `DCPCrew` guardam
  registros não assinados e não executam o CrewAI, e lista os parâmetros `session_nonce`.
- Documentação em inglês e nas traduções es, zh-CN, ja e pt-BR atualizada:
  cadeias de delegação no README de cada SDK, a janela de recepção A2A, Testing & Assurance (matriz de
  interoperabilidade, fuzzer diferencial, vetores compartilhados), fatos corrigidos (Go 1.25, os crates FIPS do Rust,
  um exemplo de DCP-09 em TypeScript que usava campos fora do schema) e as linhas do README que faltavam nas
  traduções.
- `docs/EU_AI_ACT_MAPPING.md`: como os artefatos do DCP-AI apoiam as obrigações de registro, supervisão
  humana, manutenção de registros, explicação e evidência de incidentes do Regulamento (UE) 2024/1689 (Lei de IA
  da UE), alterado pelo Regulamento (UE) 2026/1744, com o cronograma de aplicação, uma lista de verificação para
  quem implementa e as lacunas que o DCP não cobre. Artigos verificados no EUR-Lex em 22 de outubro de 2026.
- `spec/DCP-09.md` §3.5 agora especifica a subdelegação sobre os campos reais do formato de transmissão, com
  regras normativas de verificação da cadeia; §2, §10.3 e §10.6 listam o contexto `DCP-AI.v2.SubMandate`.
  `spec/DCP-AI-v2.0.md` §4.1 lista as tags de contexto `DCP-AI.v2.Delegation` e `DCP-AI.v2.SubMandate`,
  e §14.2 afirma que o nível efetivo de uma cadeia de delegação é uma entrada que só pode elevar o nível.


## [2.10.0] - 2026-10-22

<a id="package-versions"></a>

### Versões de pacotes

- `dcp-ai` (PyPI) 2.8.2 → 2.9.0: pqcrypto 1.x, SLH-DSA do FIPS 205, ML-KEM-768, bundles V2 e um verificador
  V2; incompatível para `blind_rpr` (exige `pii_salt`) e para instalações com `pqcrypto<1.0`.
- `@dcp-ai/sdk` (npm) 2.1.2 → 2.2.0: correções de segurança em `verifySignedBundleV2`, aplicação do nível de
  segurança, exportações de RPR cego; incompatível para `blindRpr` (exige `pii_salt`).
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` v2.9.0 → v2.10.0: reforço do verificador V2 e
  aplicação do nível; incompatível para `BundleBuildInput` (artefatos assinados) e `BlindRPR`.
- `dcp-ai` (crates.io) 2.9.0 → 2.10.0: verificador V2 nativo, aplicação do nível, análise da expiração
  RFC 3339; incompatível para `blind_rpr` e o construtor de bundles do `wasm`.
- `@dcp-ai/wasm` 2.0.0 → 2.1.0: `buildBundle` aceita artefatos assinados; `verifyBundle` aceita uma
  política de verificação completa.
- `@dcp-ai/openclaw` 2.0.0 → 2.1.0: piso de nível de segurança e `pii_salt` nos RPRs assinados.
- Sem mudanças: `@dcp-ai/cli` 2.0.0 e os demais pacotes de integração.

<a id="security-1"></a>
<a id="security_1"></a>

### Segurança

- Os compromissos de RPR cego têm sal, nos quatro SDKs. `pii_hash` era
  `sha256(canonical({ contact, legal_name }))`, então quem adivinhasse o nome e o contato de um principal
  podia confirmar o palpite com um RPR cego publicado, e em um log ou âncora imutável isso continua
  verdadeiro para sempre. O RPR completo agora tem `pii_salt` (32 bytes de um CSPRNG, hexadecimal minúsculo),
  que é assinado com ele e nunca publicado, e `pii_hash` é
  `sha256(canonical({ contact, legal_name, pii_salt }))`. Apagar o RPR completo, e com ele o
  sal, deixa o compromisso publicado impossível de abrir (`spec/DCP-AI-v2.0.md` §12.1). Um `contact` ou `legal_name`
  ausente entra no hash como `null` em todos os SDKs; o TypeScript omitia a chave. A nova
  categoria `blinded_rpr` em `tests/interop/v2/interop_vectors.json` (`pii_hash` com sal e legado,
  registro cego esperado) roda nas quatro suítes dos SDKs, e `generate-interop-vectors.ts` a emite.
- A verificação de RPR cego (`verifyBlindedRpr`, `verify_blinded_rpr`, `VerifyBlindedRPR`) agora também
  compara `session_nonce` e `binding_keys`, nos quatro SDKs. Antes, um RPR completo com outras chaves de
  vinculação ou outro nonce de sessão ainda correspondia ao registro cego. No Go, campos de lista
  decodificados de JSON não deixam mais de corresponder à mesma lista construída como `[]string`.
- Servidor de verificação: `POST /v2/passport/register` verifica a autoassinatura composta do passaporte e
  registra só as chaves do signatário; registrar de novo um `agent_id` exige um passaporte mais recente
  assinado por todas as suas chaves ativas. Qualquer um podia registrar de novo um agente com as próprias
  chaves, plantar seu token de emergência e revogá-lo em emergência. `POST /v2/keys/rotate` verifica a
  prova de posse e a autorização da chave antiga (`verifyKeyRotation`), e
  `POST /v2/multi-party/authorize` verifica a assinatura de cada parte com suas chaves registradas,
  contando cada parte uma única vez.
- Servidor de verificação: `/v2/policy/mode`, `/v2/governance/register`, `/v2/advisory/publish` e
  `/v2/advisory/auto-apply` exigem `Authorization: Bearer $OPERATOR_TOKEN` (bloqueados quando não definido).
  Os avisos são validados pelo schema e limitados a 1000. Os limites de taxa usam como chave o endereço do socket,
  não o `X-Forwarded-For` fornecido pelo cliente (`TRUST_PROXY=true` atrás de um proxy), e `VERIFIER_MODE` /
  `ALLOW_V1_BUNDLES` são lidos do ambiente; `allow_v1_bundles` agora é aplicado.
- Serviço de revogação: os agentes se registram com seu passaporte assinado (`POST /v2/register`), que
  registra a posse dos kids, a expiração das chaves e o token de emergência; registrar de novo exige um passaporte
  mais recente assinado pelas chaves clássica e PQ ativas do agente, e `/revoke` e `/v2/revoke` precisam ser
  assinados pelas suas chaves ativas. `GET /v2/check/kid/:kid` informa revogações de emergência de kids
  registrados sem `?agent_id=`.
- Serviço de ancoragem: não há mais `tx_hash` aleatório (os registros têm `tx_hash: null`, `onchain: false`),
  os corpos são limitados a 1 MB, `POST /flush` precisa do token do operador e uma entrada malformada é um 400
  em vez de um travamento. Log de transparência: as cabeças da árvore são assinadas com Ed25519 em vez de um HMAC
  que mais ninguém podia verificar; `OPERATOR_KEY` precisa ser a semente de 64 caracteres hexadecimais (os
  marcadores públicos do compose foram removidos), a árvore de Merkle usa os prefixos de folha e nó da RFC 6962, e
  `POST /gossip/peers` (um vetor de SSRF) precisa do token do operador.
- Servidor de verificação e serviço de revogação: chaves expiradas não podem mais registrar de novo um passaporte,
  autorizar uma rotação de chaves nem assinar por uma parte ou uma revogação, e registrar de novo mantém as
  entradas de chave registradas, de modo que um passaporte novo não pode estender o `expires_at` de uma chave.
- As configurações do Fly mantêm em execução uma máquina de verificação e uma de revogação: escalar a zero
  apagava os registros em memória delas sempre que a máquina ficava ociosa.
- SDK de TypeScript: `verifySignedBundleV2` implementa os passos V2-7 e V2-8 de `spec/VERIFICATION.md`. Uma
  assinatura PQ presente (`pq_over_classical`) precisa ser verificada em todos os modos; `hybrid_preferred`
  (o padrão para risco médio) aceitava uma inválida com um alerta e `classical_only`
  a ignorava. Só a ausência (vinculação `classical_only`) é tolerada, e não sob
  `hybrid_required` nem `pq_only`. A `composite_sig` de cada artefato agora é verificada com as
  mesmas regras e sua tag de contexto: o RPR com suas `binding_keys`, e o passaporte, a intenção e a
  decisão de política com as `keys` do passaporte. Antes, só o `payload_hash` era verificado, então uma assinatura
  forjada do agente na intenção era verificada mesmo sob `hybrid_required`. O verificador de
  referência, `dcp verify-bundle` e o servidor recebem isso com o próximo lançamento do `@dcp-ai/sdk`.
- SDK de TypeScript: `verifySignedBundleV2` falha de forma fechada diante de um modo de verificação que não
  reconhece, e rejeita uma política de verificação cujo modo não seja `classical_only`, `hybrid_preferred`,
  `hybrid_required` ou `pq_only`.
- SDKs de Go (`v2.VerifySignedBundleV2`) e Rust: a `composite_sig` de cada artefato é verificada da
  mesma forma (V2-8), e as chaves do signatário são procuradas por `kid` (V2-6), o signatário do bundle nas `keys` do
  passaporte e nas `binding_keys` do RPR. Antes, eles pegavam por algoritmo as chaves Ed25519 e
  ML-DSA-65 do passaporte, então rejeitavam bundles assinados com as chaves do principal e
  davam como verificado, com um alerta, um bundle cujo passaporte não listava nenhuma chave Ed25519, sem
  verificar sua assinatura.
- SDKs de TypeScript, Go e Rust: em toda assinatura composta, em todos os modos de verificação, a vaga
  clássica precisa conter Ed25519 e a vaga PQ ML-DSA-65 ou SLH-DSA-192f, de uma chave cujo
  `alg` seja o mesmo. O Go também rejeita um bundle cujo RPR, passaporte, intenção ou decisão de política seja
  null ou não seja objeto, onde antes pulava todas as verificações desse artefato, e o TypeScript retorna
  `verified: false` para um bundle assim em vez de lançar uma exceção.
- Nível de segurança (especificação §14.2): o SDK de Go e o binding do `@dcp-ai/wasm` (`wasm_compute_security_tier`)
  reconheciam `payment`/`transfer`, `financial`, `health`, `legal` e `biometric`, que o schema da intenção
  não permite, então intenções válidas pelo schema `initiate_payment`, `financial_data` e `health_data` eram
  `routine` ali e `elevated` nos SDKs de TypeScript, Python e Rust. Os quatro SDKs e o binding
  agora calculam o mesmo nível, verificado pelos novos vetores `security_tier` em
  `tests/interop/v2/interop_vectors.json`.
- Servidor de verificação: `resolved_tier` em `POST /verify` e `POST /v2/bundle/verify`, e a verificação do nível
  de `/v2/bundle/verify`, tomavam `intent.security_tier` como dado, então um agente que declarava
  `routine` rebaixava o próprio nível, e liam `risk_score` da intenção, o que o schema não
  permite. Agora eles usam a regra de §14.2 (`lib/security-tier.js`): `risk_score` da decisão de política do
  bundle, `estimated_impact`, valores desconhecidos para `elevated` e um nível explícito que só pode
  elevar o resultado. `/v2/intent/declare` calcula `resolved_tier` da mesma forma.
- Integração OpenClaw: `dcp_verify_bundle` e `dcp_log_action` usavam `intent.security_tier` como dado
  (`security_tier ?? computeSecurityTier(intent)`), então um nível declarado podia rebaixar o calculado, e não
  passavam nenhuma decisão de política. O nível explícito agora só eleva o nível. A decisão de política também é
  passada, de modo que `risk_score` conta assim que o `@dcp-ai/sdk` o ler (o lançamento após a 2.1.2).
- Negação de serviço nos serviços de referência, cujo estado vive em memória e não sobrevive a uma
  reinicialização:
  - Servidor de verificação: os registros têm limite de taxa por cliente (`REGISTRATIONS_PER_HOUR`,
    padrão 20 por hora), a rotação mantém só as 4 chaves aposentadas mais recentes de um agente, e de um
    passaporte registrado só `created_at` é armazenado. Um agente rodando chaves sem parar, ou uma
    enxurrada de registros, enchia o registro de 10.000 chaves (507 até uma reinicialização), e cada
    passaporte assinado armazenado podia ocupar até 1 MB. As chaves descartadas continuam revogadas como lápides e
    nunca podem ser registradas de novo, e um agente pode registrar no máximo `MAX_KEYS_PER_AGENT` chaves (64)
    ao longo da vida. Uma rotação descarta uma chave aposentada antes da verificação do limite, então ela ainda cabe
    em um registro cheio. A verificação da família de chaves ao registrar de novo não percorre mais o registro de
    forma quadrática.
  - Log de transparência: `POST /gossip/exchange` só aceita uma cabeça de árvore bem formada e assinada por um
    par fixado, em um corpo de no máximo 16 KB, e mantém os últimos 100 alertas distintos, de modo que uma
    cabeça de árvore repetida não pode empurrar os anteriores para fora. As cabeças de árvore obtidas por sondagem
    precisam ser verificadas com a chave fixada do par, e uma sondagem lê no máximo 16 KB, expira após um intervalo e
    nunca se sobrepõe à anterior. Antes, qualquer um podia encher a lista de alertas com strings de 1 MB, nenhuma
    cabeça de árvore de par era verificada, e um par travado empilhava sondagens.
  - Serviço de revogação: `POST /v2/register` tem limite de taxa por cliente e teto de
    `MAX_AGENTS` (padrão 10.000), e os campos armazenados são limitados, então uma enxurrada de registros ou
    registros grandes demais não podem mais esgotar sua memória e apagar todas as revogações.
- Servidor de verificação e serviço de revogação: registrar um `agent_id` novo exige o token do
  operador. Um passaporte é só autoassinado, então qualquer um podia registrar primeiro o `agent_id` de uma vítima,
  com as próprias chaves e token, e depois revogá-lo em emergência ou trancar o agente real do lado de fora com 409.
  Toda reinicialização reabria isso para todos os `agent_id`. `GET /v2/check/kid/:kid` responde 404
  (`registered: false`) para um kid que nunca registrou, em vez do veredito de qualquer agente que quem chamou
  indicasse em `?agent_id=`.
- Servidor de verificação e serviço de revogação: chaves públicas e assinaturas precisam ser o base64
  canônico de exatamente o tamanho do seu algoritmo, e os schemas V2 restringem `public_key_b64` e
  `sig_b64` ao alfabeto base64 e limitam seu comprimento. Decodificadores permissivos pulavam espaços em branco,
  então uma chave ML-DSA preenchida com 900 KB de espaços era registrada e devolvida, e assinaturas
  preenchidas eram armazenadas e publicadas por `/v2/list`.
- `verifySignedBundleV2` do SDK de TypeScript aplica o nível de segurança (especificação §14.3): verifica com
  o mais rigoroso entre o modo da política e o modo do nível calculado a partir da intenção e da decisão de
  política assinadas, e o informa em `details.resolved_tier`. Antes, o modo vinha só do
  `passport.risk_tier` do próprio agente, então sob `DEFAULT_VERIFIER_POLICY` um passaporte que declarava
  `risk_tier: "low"` recebia `classical_only` até para uma intenção de pagamento.
- SDK de TypeScript: `AdaptiveRateLimiter.check`, `generateSessionExpiry` e `VerificationCache.set`
  contam um nome de nível desconhecido, ou uma chave do protótipo como `constructor`, como `elevated`. O limitador de
  taxa dava a cada nome inventado o próprio balde, `generateSessionExpiry` lançava uma exceção com `constructor`,
  e o cache nunca expirava essas entradas.
- Integração OpenClaw: `dcp_declare_intent` calculava o nível que assina na intenção e na
  decisão de política antes de pontuar a intenção. Agora passa a pontuação de risco, que conta assim que o
  `@dcp-ai/sdk` a ler (o lançamento após a 2.1.2).
- Os verificadores de Go (`v2.VerifySignedBundleV2`), Rust (`v2::verify_bundle::verify_signed_bundle_v2` e o
  binding `wasm_verify_signed_bundle_v2` por trás de `verifyBundle` no `@dcp-ai/wasm`) e Python
  (`verify_signed_bundle_v2`) aplicam o nível de segurança como o de TypeScript: o modo é
  o mais rigoroso entre o modo da política e o modo do nível, aplicado à assinatura do bundle e à assinatura de cada
  artefato; um modo de política desconhecido falha de forma fechada; e o resultado informa o nível e o
  modo. Os verificadores de Go e Rust não tinham política de verificação e aceitavam assinaturas `classical_only`
  para qualquer intenção.
- `verify_signed_bundle_v2` do SDK de Python: em toda assinatura composta, em todos os modos, a vaga clássica
  precisa conter Ed25519 e a vaga PQ ML-DSA-65 ou SLH-DSA-192f, de uma chave cujo `alg` seja o
  mesmo, como nos SDKs de TypeScript, Go e Rust. Sob `pq_only`, ele aceitava ML-DSA-65 na
  vaga clássica.
- SDKs de Go e Rust: uma assinatura composta precisa ter seu membro `pq`, `null` para `classical_only`
  (`schemas/v2/composite_signature.schema.json`). Eles decodificavam um `pq` ausente como `null` e
  verificavam uma assinatura `classical_only` assim, que os verificadores de TypeScript e Python rejeitam.
  `bundle_vectors.json` fixa isso com `classical_only_bundle_signature_without_pq`.
- Os verificadores V2 de Go e Rust ligam a trilha de auditoria ao manifesto assinado, como os de TypeScript e
  Python: recalculam `audit_merkle_root`, verificam `audit_count` e exigem que a cadeia comece em
  `GENESIS`. Antes, qualquer um podia substituir as entradas de auditoria de um bundle assinado validamente por uma
  cadeia fabricada e consistente consigo mesma, e os dois ainda a davam como verificada.
- Os verificadores V2 de Go e Rust falham de forma fechada quando uma verificação do manifesto não pode rodar: um
  hash de artefato ausente, como `rpr_hash`, ou um payload ausente ou que não pode ser canonicalizado, é um erro em
  vez de uma verificação pulada.
- Os verificadores V2 de Go e Rust verificam o `payload_hash` de cada artefato em relação ao seu payload, como os
  de TypeScript e Python; antes o ignoravam.
- Os verificadores V2 de Go e Rust rejeitam um bundle cujo `manifest.session_expires_at` já passou, então uma
  sessão expirada não pode mais ser repetida contra eles. O verificador do `@dcp-ai/wasm` lê o
  relógio do JavaScript, já que `SystemTime::now()` entra em pânico em `wasm32-unknown-unknown`.
- SDK de Rust: `is_session_expired` comparava lexicograficamente strings RFC 3339 com o relógio UTC,
  então um carimbo de data/hora com deslocamento era mal avaliado em até 14 horas: uma sessão que terminava em uma
  hora, escrita `-05:00`, contava como expirada, e uma que terminou uma hora antes, escrita `+05:00`, como ainda
  válida. Agora ele analisa o carimbo de data/hora (`parse_rfc3339_millis`) e compara instantes, para a expiração
  da sessão e das chaves e nos auxiliares de avisos.
- Carimbos de data/hora de expiração nos quatro verificadores: um `session_expires_at` ou um `expires_at` de chave
  presente, mas que não seja um carimbo RFC 3339 com deslocamento `Z` ou `±hh:mm`, é rejeitado; ausente ou
  `null` continua significando sem expiração. O TypeScript aceitava qualquer coisa que `Date` não conseguisse
  analisar (`"n/a"`) ou analisasse de forma permissiva (`"2099-12-31"`), e pulava um `session_expires_at` vazio; o
  Rust aceitava `"n/a"`; o Go pulava um `expires_at` de chave que não fosse string; o Python lançava uma exceção.
  `isSessionExpired` e `is_session_expired` contam um valor malformado como expirado.
- A validade das chaves cobre toda chave que pode assinar. Os quatro verificadores rejeitam uma chave revogada ou
  expirada nas `binding_keys` do RPR do principal, que assinam o RPR e podem assinar o bundle; TypeScript e
  Python verificavam só as chaves do passaporte. Os verificadores de Go e Rust não verificavam o status de nenhuma
  chave e agora também rejeitam chaves do passaporte revogadas ou expiradas.
- Os quatro verificadores rejeitam uma chave cujo `status` é `expired`, como `revoked`. O schema de entrada de
  chave permite `expired`, mas só `revoked` era verificado, então uma chave marcada como expirada sem
  `expires_at` ainda assinava.
- Uma trilha de auditoria vazia precisa ter a raiz de Merkle `sha256:` seguida de 64 zeros, que os construtores de
  Go e Rust já escreviam. Os quatro verificadores pulavam `audit_merkle_root` quando um bundle não tinha
  entradas de auditoria, então ela podia ter qualquer valor.

<a id="changed-breaking"></a>

### Alterado (incompatível)

- Servidor de verificação (`POST /v2/passport/register`) e serviço de revogação (`POST /v2/register`):
  um `agent_id` novo exige `Authorization: Bearer $OPERATOR_TOKEN` (401 caso contrário); registrar de novo
  continua sendo autoatendimento. `GET /v2/check/kid/:kid` do serviço de revogação ignora `?agent_id=` e
  retorna 404 para kids não registrados.
- Servidor de verificação: um agente pode registrar no máximo `MAX_KEYS_PER_AGENT` chaves (padrão 64) ao longo
  da vida; rotações posteriores recebem 409, e o agente precisa registrar um `agent_id` novo.
- Schemas: `key_entry.public_key_b64` e o `sig_b64` de `composite_signature` precisam corresponder a
  `^[A-Za-z0-9+/]+={0,2}$` e são limitados a 3.456 e 66.476 caracteres.
- Log de transparência: cada entrada de `GOSSIP_PEERS` é `<url>#<base64 Ed25519 public key>`. As cabeças de árvore
  de pares sem chave fixada são ignoradas, e `/gossip/exchange` as rejeita (403); os logs do
  Docker Compose só fazem gossip depois que suas chaves são definidas (veja `docker/README.md`).
- SDK de Go: `BundleBuildInput` aceita artefatos assinados (`SignedPayload`, veja `v2.SignPayload`) e
  entradas de auditoria `[]AuditEventV2`. `BuildBundleV2` envolvia payloads não assinados, que os verificadores
  agora rejeitam (V2-8), e preenchia o bundle com entradas de auditoria vazias.
- WASM (`wasm_build_bundle`, e `buildBundle` no `@dcp-ai/wasm`): cada artefato é um
  `SignedPayload` de `wasm_sign_payload` / `signPayload`, não um payload bruto. Bundles construídos a partir de
  payloads brutos não tinham assinaturas de artefato e não são mais verificados.
- Serviço de revogação: `POST /v2/register-emergency-token` e `POST /v2/register-key-expiry` foram
  removidos em favor de `POST /v2/register`. O `/revoke` V1 exige um agente registrado ali, o que
  exige uma assinatura híbrida do passaporte (Ed25519 + ML-DSA-65 ou SLH-DSA-192f), então agentes somente Ed25519
  (V1) não podem mais publicar revogações. Um agente revogado não pode mais ser revogado de novo (409).
- Servidor de verificação e serviço de revogação: registrar de novo um `agent_id` (por exemplo, para substituir
  o token de revogação de emergência) exige um passaporte cujo `created_at` seja mais recente que o
  registrado, assinado por todas as chaves ativas do agente; um passaporte sem token mantém o
  registrado. Um agente que perdeu todas as chaves ativas de uma família (clássica ou PQ) não pode se registrar de
  novo: a recuperação passa pelo token de revogação de emergência ou pelo operador.
- Log de transparência: hashes de folhas, raízes e provas de inclusão mudam com os prefixos da RFC 6962, e
  `signature` / `public_key` da STH agora são Ed25519 em base64. `/add` só aceita hashes
  `sha256:<64 hex>`, e o `/anchor` da ancoragem 64 caracteres hexadecimais com um prefixo `sha256:` opcional.
- Servidor de verificação: `/v2/keys/rotate` exige `authorization_sig` e `timestamp`
  (`KeyRotationRecord`). `dcp rotate-key` e `dcp keys certify` ainda enviam uma prova de posse simulada,
  que o servidor agora rejeita.
- SDK de Python: SLH-DSA-192f agora implementa o FIPS 205 (SLH-DSA puro, contexto vazio), como os
  SDKs de TypeScript, Go e Rust. Ele era baseado no SPHINCS+ pré-padrão do PQClean, que assina a
  mensagem pura em vez de `0x00 || 0x00 || message`, então as assinaturas SLH-DSA não eram verificadas entre
  SDKs em nenhuma direção. As assinaturas feitas por `SlhDsa192fProvider` no `dcp-ai` 2.8.2 e anteriores
  não são mais verificadas.
- SDK de Python: exige `pqcrypto>=1.0,<2`, agora usado para ML-DSA-65, SLH-DSA-192f e ML-KEM-768,
  em vez do teto `<1.0` da 2.8.2 (o `pqcrypto` 1.0 mudou sua API e removeu o SPHINCS+).
  `dcp_ai.providers` não engole mais um `ImportError`, e os testes de interoperabilidade PQ não são mais pulados
  quando falta um provedor.
- SDK de Python: `VerifierPolicy` rejeita campos desconhecidos em vez de descartá-los, e ganha os
  campos que lhe faltavam (`allow_classical_fallback_disable`, `warn_classical_only_deprecated`,
  `advisory_rejected_algs`, `require_session_expiry`, `max_session_duration_seconds`,
  `require_audience_binding`, `verifier_id`). Antes, `VerifierPolicy(require_audience_binding=True,
  verifier_id=...)` perdia os dois campos em silêncio. Em `verify_signed_bundle_v2`, uma política em dict é
  validada como um `VerifierPolicy` (chaves desconhecidas lançam uma exceção), e os campos que ela omite recebem os
  padrões do modelo (`hybrid_required` para todo nível de risco), não o `low` → `classical_only` da política padrão.
  Só `risk_overrides=None` faz `default_mode` se aplicar a todos os níveis.
- O cegamento exige `pii_salt`, nos quatro SDKs. `blindRpr` (TypeScript) e `blind_rpr` (Python,
  `ValueError`) lançam uma exceção, e `BlindRPR` (Go) e `blind_rpr` (Rust) retornam um erro, quando o RPR
  completo não tem `pii_salt` ou ele não tem 64 caracteres hexadecimais minúsculos. Defina-o com o novo auxiliar
  antes de assinar o RPR: um RPR assinado sem ele precisa ser reassinado antes de poder ser cegado.
- A verificação de RPR cego rejeita um RPR completo cujo `pii_salt` está presente, mas não é uma string de
  64 caracteres hexadecimais minúsculos, nos quatro SDKs. Antes, um registro cegado em outro lugar com um sal vazio
  ou curto era verificado sem nenhum alerta, enquanto registros sem sal eram sinalizados.
- Resultados da verificação de RPR cego: `verify_blinded_rpr` (Python) retorna uma nova chave `warnings`
  e o `BlindedRprCheck` do Go tem um novo campo `Warnings`, então o código que compara resultados inteiros ou
  constrói `BlindedRprCheck` com literais sem nomes de campo precisa mudar.
- `schemas/v2/responsible_principal_record.schema.json` aceita `pii_salt`. O schema tem
  `additionalProperties: false`, então verificadores que validam com o schema anterior rejeitam
  RPRs que têm sal: atualize os verificadores antes de os produtores começarem a defini-lo.
- SDK de Rust: `ResponsiblePrincipalRecordV2` tem um novo campo público, `pii_salt: Option<String>`, então
  os literais de struct precisam defini-lo.
- Cálculo do nível de segurança (especificação §14.2), todos os SDKs: `risk_score` é lido da decisão de política
  do bundle, nunca da intenção (o schema da intenção não o permite, então o nível nunca era
  `standard` para uma intenção válida). `estimated_impact` `medium` eleva o nível para `standard` e `high`
  para `elevated`; um valor de `action_type`, `estimated_impact` ou `data_classes` ausente, de tipo errado ou
  desconhecido dá no mínimo `elevated`; um `intent.security_tier` explícito só pode elevar o resultado.
  - TypeScript: `computeSecurityTier(intent, policyDecision?)`.
  - Python: `compute_security_tier(intent, policy_decision=None)`; `compute_security_tier({})` agora é
    `elevated`. As integrações LangChain e CrewAI o usam em vez das próprias cópias.
  - Go: `SecurityTierInput` ganha `EstimatedImpact` e `SecurityTier`, e seu valor zero (ou um
    `DataClasses` nil) agora é `elevated`. `v2.SecurityTierInputFromPayloads(intent, policyDecision)` constrói
    a entrada a partir de payloads decodificados.
  - Rust: `compute_security_tier(intent, policy_decision: Option<&Value>)`. `wasm_compute_security_tier`
    e `computeSecurityTier` no `@dcp-ai/wasm` aceitam uma decisão de política opcional.
- Cálculo do nível de segurança, todos os SDKs e o servidor de referência: uma `risk_score` da decisão de política
  ausente ou que não seja um inteiro de 0 a 1000 conta como desconhecida, então o nível é no mínimo `elevated`,
  como um valor desconhecido da intenção. Um valor não numérico contava como 0, e os outros números eram
  comparados como estavam, então `-1` dava `routine` e `1e30` dava `maximum` (agora `elevated`, com o
  mesmo modo `hybrid_required`). Sem decisão de política, a pontuação continua sendo 0. No Go,
  `SecurityTierInputFromPayloads` define `RiskScore` como -1 para um valor assim, e `ComputeSecurityTier`
  trata qualquer `RiskScore` fora de 0..1000 como desconhecido.
- `verifySignedBundleV2` do SDK de TypeScript: bundles que hoje passam com uma assinatura `classical_only`
  são rejeitados quando sua intenção é sensível: `initiate_payment`, `pii`, `financial_data`,
  `health_data`, `credentials` ou `children_data`, `estimated_impact: "high"`, uma `risk_score` da decisão de
  política de 500 ou mais, ou um valor fora do schema da intenção. Assine-os com uma assinatura híbrida
  (`pq_over_classical`). O verificador raiz (`lib/verify.js`, `dcp verify-bundle`, o
  servidor) recebe isso com o próximo lançamento do `@dcp-ai/sdk`.
- Os verificadores de Go, Rust e Python rejeitam os mesmos bundles `classical_only`. `VerifySignedBundleV2` do Go
  e `verify_signed_bundle_v2` do Rust aplicam o `DEFAULT_VERIFIER_POLICY` do TypeScript em vez de nenhuma
  política; `wasm_verify_signed_bundle_v2` aceita um JSON de política opcional (um `VerifierPolicy`) e,
  com ele, rejeita bundles V1. Sua política só pode diferir da padrão em `default_mode`,
  `risk_overrides` e nos campos da fase 3 (`advisory_rejected_algs`, `warn_classical_only_deprecated`,
  `allow_classical_fallback_disable`, aplicados como no TypeScript): qualquer outra mudança, ou um campo
  desconhecido no JSON do `VerifierPolicy` do Rust, reprova a verificação em vez de ser ignorado.
- `verify_signed_bundle_v2` do SDK de Python: erros e alertas sobre a assinatura do bundle começam com
  `bundle: `, um artefato null ou que não é objeto é relatado como `<name>: not a SignedPayload object`, e
  um modo de política desconhecido falha com `Unknown verification mode in verifier policy` antes de qualquer
  assinatura ser verificada, como no TypeScript.

<a id="added-1"></a>
<a id="added_1"></a>

### Adicionado

- `generatePiiSalt` (TypeScript), `generate_pii_salt` (Python, Rust) e `GeneratePIISalt` (Go).
  Os tipos RPR dos quatro SDKs, `schemas/v2/responsible_principal_record.schema.json` e
  `api/proto/dcp.proto` têm `pii_salt`. O `ResponsiblePrincipalRecordV2` do Python omite um
  `pii_salt` não definido na serialização, já que o schema não tem null para ele.
- RPRs cegos legados sem sal continuam sendo verificados, com um alerta de descontinuação: os resultados de
  `verifyBlindedRpr` (TypeScript), `verify_blinded_rpr` (Python) e `VerifyBlindedRPR` (Go) têm
  uma lista `warnings`. O `BlindedRprCheck` do Rust mantém seus dois campos, porque um novo campo público
  quebraria quem o constrói ou desestrutura; ali, um `pii_salt` ausente ou null no
  RPR completo marca um registro legado.
- `@dcp-ai/openclaw`: `dcp_identity_setup` assina seu RPR com um `pii_salt`, para que o registro possa ser
  cegado depois sem reassinatura.
- Serviço de revogação: `REVOCATION_STATE_PATH` mantém registros e revogações em um arquivo
  (padrão: só em memória). As escritas são acrescentadas como linhas JSON com fsync, e o arquivo é reproduzido e
  compactado por meio de uma renomeação atômica na inicialização; o serviço se recusa a iniciar se o caminho não
  tiver permissão de escrita ou se o arquivo passar de 512 MB. A pilha do Docker Compose o define, em um volume.
- Servidor de verificação: `MAX_REGISTERED_KEYS` e `MAX_KEYS_PER_AGENT` dimensionam o registro de chaves.
- `effectiveVerificationMode` (TS), `effective_verification_mode` (Python, Rust) e
  `EffectiveVerificationMode` (Go): o mais rigoroso entre um modo de política e o modo de um nível, com `pq_only`
  inalterado (especificação §14.3). Vetores compartilhados em `security_tier.effective_mode`.
- SDK de Go: `v2.VerifySignedBundleV2WithPolicy(registry, json, policy)` e `v2.DefaultVerifierPolicy()`.
  SDK de Rust: `verify_signed_bundle_v2_with_policy` e `impl Default for VerifierPolicy` (a política
  padrão do TypeScript). Os `VerifierPolicy` do Go e do Rust ganham os campos da fase 3 de
  `schemas/v2/verifier_policy.schema.json`, então o `DEFAULT_VERIFIER_POLICY` do TypeScript é decodificado neles
  como está. `@dcp-ai/wasm`: `verifyBundle(signedBundle, policy?)` e o tipo `VerifierPolicy`.
  Os `details` do resultado do Python ganham `resolved_tier`.
- `tests/interop/v2/bundle_vectors.json`: `must_reject_bundles`, bundles somente clássicos com
  intenções sensíveis a partir de um passaporte de baixo risco que todo verificador precisa rejeitar em todos os
  modos, e um controle rotineiro somente clássico com seu veredito esperado por modo. Os testes de TS, Go, Rust e
  Python os executam, e o Python agora executa o arquivo inteiro. `default_verifier_policy` traz o
  `DEFAULT_VERIFIER_POLICY` do TypeScript, que todo SDK precisa aceitar como política.
- `tests/interop/v2/bundle_vectors.json`: casos de rejeição para um `payload_hash` errado, entradas de auditoria
  substituídas ou truncadas, uma cadeia de auditoria que não começa em `GENESIS`, um manifesto sem
  `rpr_hash`, uma sessão expirada, e chaves de passaporte e de vinculação revogadas ou expiradas.
- `@dcp-ai/wasm`: `npm test` executa `verifyBundle` a partir do pacote compilado sobre
  `tests/interop/v2/bundle_vectors.json` no Node, e a CI o executa. Antes ele só verificava tipos, e
  os testes wasm32 do Rust só são compilados, então o verificador wasm nunca rodava na CI.
- `tests/interop/v2/interop_vectors.json` `rfc3339`: o instante de carimbos de data/hora RFC 3339 com
  deslocamentos e frações, e os valores malformados que todo verificador rejeita. `bundle_vectors.json`
  acrescenta expirações malformadas e com deslocamento, e seu bundle assinado tem expirações em um futuro distante
  escritas com deslocamentos. `parseRfc3339` do TypeScript, `parse_rfc3339` do Python e `parse_rfc3339_millis` do
  Rust são os analisadores que os verificadores usam.
- SDK de TypeScript: `blindRpr`, `verifyBlindedRpr`, `isBlindedRpr` e `computePiiHash` são exportados
  pelo ponto de entrada do pacote. Eles estavam implementados, mas inacessíveis a partir do `@dcp-ai/sdk` 2.1.2 e
  anteriores; Python, Go e Rust já os exportavam.
- `lib/verify.js` exporta `verifyCompositeSig` (uma assinatura composta sobre um payload, com as chaves do
  signatário procuradas por kid derivado) e seu `v2Registry`; `lib/http.js` contém os auxiliares de análise do
  corpo, IP do cliente e token do operador compartilhados por `server/` e `services/`. Os serviços de ancoragem e de
  log de transparência têm suítes `node:test`, executadas na CI junto com as existentes.
- SDK de Rust: o verificador de bundles V2 saiu da feature `wasm` e foi para
  `dcp_ai::v2::verify_bundle::verify_signed_bundle_v2`, então builds nativos e `cargo test` o executam;
  `wasm_verify_signed_bundle_v2` delega a ele.
- `tests/interop/v2/bundle_vectors.json`: um bundle assinado que todo verificador V2 precisa aceitar, e
  mutações (assinatura PQ do bundle forjada, assinaturas de artefato forjadas ou mal atribuídas, algoritmos na
  vaga errada, artefatos null ou que não são objeto) depois das quais ele precisa rejeitá-lo com um erro que nomeie
  o bundle ou o artefato, verificadas pelas suítes de TypeScript, Go e Rust. Regenere com
  `sdks/typescript/src/__tests__/generate-bundle-vectors.ts`.
- SDK de Go: `v2.SignPayload` assina um artefato em um `SignedPayload`: uma assinatura composta, ou uma
  somente clássica quando nenhuma chave PQ é fornecida.
- SDK de Python: `MlKem768Provider` (FIPS 203), a primitiva ML-KEM-768 que os outros SDKs já tinham.
  O handshake DCP-04 do Python ainda não executa a troca de chaves híbrida X25519 + ML-KEM-768.
- SDK de Python: bundles V2. `BundleBuilderV2`, `sign_bundle_v2`, `sign_bundle_v2_classical_only`,
  `verify_signed_bundle_v2`, `DEFAULT_VERIFIER_POLICY` e `PQ_ONLY_VERIFIER_POLICY` portam
  `builder-v2.ts`, `signer-v2.ts` e `verify-v2.ts` do TypeScript. O verificador também verifica a assinatura
  composta de cada artefato (VERIFICATION.md V2-8), rejeita uma assinatura PQ presente, mas inválida,
  em todos os modos (V2-7) e falha de forma fechada diante de um modo de verificação desconhecido. Ao contrário do
  verificador de TypeScript, ele liga os checkpoints PQ do bundle aos IDs de `pq_checkpoints` do manifesto, e na
  verificação de `max_session_duration_seconds` limita o `signature.created_at` não assinado ao
  momento da verificação: um valor reescrito pode encurtar essa verificação até o tempo de vida restante da
  sessão, não até zero. Fechar isso exige um início de sessão assinado, que o manifesto não
  tem. O conteúdo dos checkpoints (V2-12) e `audit_merkle_root_secondary` ainda não são verificados.
- `tests/nist-kat/ml-kem-768` e `tests/nist-kat/slh-dsa-192f`: vetores ACVP do NIST (decapsulação e
  verificações de chave do ML-KEM-768, verificação de assinaturas SLH-DSA-SHA2-192f).
- `tests/interop/v2/cross_sdk_vectors.json`: vetores de SLH-DSA-192f, ML-KEM-768 e bundles V2 assinados
  produzidos pelos SDKs de TypeScript e Python, cada um verificado pelo outro.

<a id="fixed-1"></a>
<a id="fixed_1"></a>

### Corrigido

- Os exemplos de conformidade V2 (`scripts/generate-v2-examples.js`) usam um `human_id` opaco em vez de
  um derivado do nome legal, que §12.1 agora proíbe, e seu RPR tem um `pii_salt`.
- SDK de Python: `BundleManifest.pq_checkpoints` contém IDs de checkpoints, como em
  `schemas/v2/bundle_manifest.schema.json`, e o modelo ganha `session_expires_at` e
  `intended_verifier`.

<a id="documentation-1"></a>
<a id="documentation_1"></a>

### Documentação

- `spec/DCP-AI-v2.0.md` §12.1 especifica o compromisso com sal, o sal privado divulgado somente com
  o RPR completo, a eliminação por meio do apagamento do RPR completo, um `human_id` opaco que não deve (MUST NOT)
  conter dados pessoais nem ser derivado deles, e a descontinuação dos compromissos sem sal.
- `spec/CANONICALIZATION_PROFILE.md`, `spec/DCP-AI-v2.0.md`, o README do SDK de WASM (todos os idiomas),
  `docs/NIST_CONFORMITY.md` e os comentários dos canonicalizadores de TypeScript, Python e Rust descrevem o
  `dcp-jcs-v1` como baseado na RFC 8785, não como um subconjunto estrito dela nem como a RFC 8785 pura: a regra 1
  ordena as chaves por ponto de código, a RFC 8785 por unidades de código UTF-16. O perfil não muda.
- O README do SDK de TypeScript (todos os idiomas) e `docs/API_REFERENCE.md` listam as assinaturas reais das
  funções de assinatura composta, bundle, apresentação, checkpoint PQ, A2A, erros, revogação de emergência,
  recuperação de chaves, hash e CBOR.
- `docs/API_REFERENCE.md`: o pipeline de verificação V2 lista as verificações de assinatura por artefato,
  e a nota de limitações conhecidas sobre V2-7 e V2-8 agora se aplica só ao `@dcp-ai/sdk` 2.1.2 e
  anteriores.
- Os READMEs dos SDKs de Go e WASM (todos os idiomas) e `docs/MIGRATION_V1_V2.md` assinam cada artefato
  antes de construir o bundle, e listam as chaves de assinatura no passaporte e no RPR.
- `spec/DCP-AI-v2.0.md` §14.2 descreve o cálculo do nível acima, §14.3 e §14.4 descrevem
  `resolved_tier` como informativo (§14.2 não o lê), e `spec/VERIFICATION.md` calcula
  o nível como em §14.2. Os READMEs dos SDKs (todos os idiomas), `docs/API_REFERENCE.md`, os guias de
  início rápido, de migração e de criação de agentes e `sdks/wasm/example.html` passam a decisão de
  política para a função do nível e usam os valores do schema da intenção.
- `spec/VERIFICATION.md` V2-7 e `spec/DCP-AI-v2.0.md` §7.1 afirmam que uma assinatura PQ
  presente precisa ser verificada em todos os modos, como os verificadores já fazem. `docs/API_REFERENCE.md`
  documenta `details.resolved_tier` e o modo de `verifySignedBundleV2` que leva em conta o nível, e o README do SDK
  de TypeScript (todos os idiomas) o descreve.
- `docs/MIGRATION_V1_V2.md` §6.3 não mostra mais um comando `dcp migrate-check`, que a CLI não
  tem, nem uma `risk_score` na intenção; ele valida os bundles migrados com
  `dcp verify-bundle --policy hybrid_required`.
- `spec/DCP-AI-v2.0.md` §14.3 torna a aplicação do nível um MUST para verificadores V2 (§20.1): o modo é o
  mais rigoroso entre o modo da política e o modo do nível. `spec/VERIFICATION.md` calcula o nível e o
  modo efetivo no passo V2-9 e aplica a política com ele no passo V2-10, onde a verificação do nível
  era opcional. `docs/OPERATOR_GUIDE.md` e `docs/SECURITY_MODEL.md` descrevem o modo que leva em conta o nível, e
  os READMEs dos SDKs de Go, Python, Rust e WASM (todos os idiomas) descrevem a política de verificação.
- A §18 da especificação (pipeline de verificação), `docs/OPERATOR_GUIDE.md` e o passo 8 do guia de migração
  descrevem a aplicação do nível como os verificadores a implementam. O guia do operador não diz mais que
  o nível máximo verifica checkpoints PQ, o que nenhum verificador faz ainda (V2-12), e diz o que o
  servidor de referência aplica até que sua dependência do `@dcp-ai/sdk` seja atualizada.
- `spec/VERIFICATION.md` V2-3, V2-4 e V2-13 detalham essas verificações: `payload_hash`, hashes do manifesto
  que falham de forma fechada, a trilha de auditoria ligada ao manifesto, a expiração da sessão e a validade das
  `binding_keys` do RPR. `docs/API_REFERENCE.md` lista as chaves de vinculação no passo de validade das chaves.

## [2.9.0] - 2026-10-21

<a id="package-versions-1"></a>
<a id="package-versions_1"></a>

### Versões de pacotes

- `dcp-ai` (PyPI) 2.8.1 → 2.8.2: somente correções.
- `@dcp-ai/sdk` (npm) 2.1.1 → 2.1.2: somente correções.
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` v2.8.1 → v2.9.0: acrescenta `v2.MarshalCanonical`.
- `dcp-ai` (crates.io) 2.8.1 → 2.9.0: OpenTelemetry 0.32, incompatível para a feature opcional `otlp`
  (veja «Alterado (incompatível)»).
- Sem mudanças: `@dcp-ai/wasm` 2.0.0, `@dcp-ai/cli` 2.0.0 e os pacotes de integração.

<a id="security-2"></a>
<a id="security_2"></a>

### Segurança

- O verificador de referência (`lib/verify.js`), `dcp verify-bundle` e o servidor de verificação agora
  verificam bundles V2 normativos (`schemas/v2/signed_bundle.schema.json`) delegando ao
  `verifySignedBundleV2` do `@dcp-ai/sdk`, após a validação com JSON Schema. Antes, os bundles produzidos
  por qualquer SDK eram rejeitados como «Invalid signed bundle format», `dcp verify-bundle` imprimia
  `V2 BUNDLE STRUCTURE VALID` (saída 0) para bundles forjados, e o servidor só verificava a estrutura.
  O envelope pré-normativo (`dcp_version` / `bundle_manifest` no nível superior) é rejeitado. O servidor
  verifica com o `VERIFIER_POLICY` que anuncia (modo, algoritmos aceitos e rejeitados por avisos), e a fixação de
  uma chave pública é recusada no modo `pq_only`, que pula o signatário clássico.
- `dcp sign-bundle --composite` emite um `SignedBundleV2` normativo; o kid de ML-DSA-65 era derivado de um
  hash da chave secreta. `tools/bundle_sign.js --v2` foi removido.
- Serviço de revogação: uma revogação de emergência não informa mais todos os kids de todos os agentes como
  revogados (`GET /v2/check/kid/:kid` agora aceita `?agent_id=`), e uma codificação percentual malformada retorna
  400 em vez de derrubar o processo.
<a id="changed-breaking-1"></a>
<a id="changed-breaking_1"></a>

### Alterado (incompatível)

- `lib/verify.js` (o `main` do pacote raiz): `verifySignedBundle` agora é `async` e aceita um
  quarto argumento `options` (`{ policy, mode }`); os resultados sempre têm um array `errors`. A GitHub Action
  composta `verify-bundle`, `bin/dcp.js`, `server/` e `tools/bundle_verify.js`
  foram atualizados. `tools/bundle_verify.js` não aceita mais um argumento de chave pública PQ.
- SDK de Rust, feature opcional `otlp`: OpenTelemetry 0.24 → 0.32.
  - `OtlpHandles.tracer_provider` agora é `SdkTracerProvider` e `OtlpHandles.tracer` é
    `SdkTracer`, seguindo as renomeações do projeto original.
  - A feature não puxa mais o `tokio`: a ponte exporta a partir das threads em segundo plano do SDK
    pelo cliente bloqueante do `reqwest`.
  - Os erros com o prefixo `tracer install:` agora dizem `trace exporter:`.

<a id="added-2"></a>
<a id="added_2"></a>

### Adicionado

- SDK de Go: `v2.MarshalCanonical(obj)`, o codificador `dcp-jcs-v1` sem a regra de somente inteiros. O
  `Canonicalize` V1 e o codificador de prova de posse agora o usam.

<a id="fixed-2"></a>
<a id="fixed_2"></a>

### Corrigido

- SDK de Go: a canonicalização não escapa mais `<`, `>`, `&` nem U+2028/U+2029, e emite `-0` como `0`
  (regras 3 e 4 do `dcp-jcs-v1`) nos caminhos V2, de prova de posse e V1.
- SDK de TypeScript: as chaves dos objetos são ordenadas por ponto de código Unicode (regra 1), não por unidades de
  código UTF-16.
- SDK de Python: `pqcrypto` é limitado abaixo de 1.0. A versão 1.0 removeu os módulos
  `pqcrypto.sign.ml_dsa_*`, então instalações novas do `dcp-ai` 2.8.1 não conseguem importar o provedor ML-DSA-65.
- `tests/interop/v2/interop_vectors.json`: vetores de casos-limite para zero negativo, caracteres HTML,
  U+2028/U+2029, escapes de caracteres de controle e ordenação de chaves com caracteres dos planos suplementares do Unicode.
- `tools/conformance.js`: a entrada `edge_cases` não passa mais sem verificar nada, o bloco de
  separação de domínio que nunca era executado foi removido, e bundles assinados V2 (válidos, adulterados, forjados,
  sem assinatura PQ, com chave fixada, legados) são verificados com o verificador de referência.

<a id="dependencies"></a>

### Dependências

- Todos os 95 alertas abertos do Dependabot foram fechados (11 críticos, 54 altos). O #22 substituiu os 15 PRs do
  Dependabot (#5–#21); o #24 atualizou o grpc.
- SDK de TypeScript, `@dcp-ai/express`, `@dcp-ai/openclaw` (desenvolvimento):
  - vitest e `@vitest/coverage-v8` 4.1.12, atualizados juntos.
  - vite 7.3.7, fixado por meio de `overrides`.
  - postcss 8.5.31, nanoid 3.3.20, source-map-js 1.2.2, esbuild 0.28.2, fast-uri 3.1.9.
  - Lockfile de execução do Express: proxy-addr 2.0.8, qs 6.16.1, body-parser 2.3.0.
- Harness raiz: fast-uri 3.1.9 e a nova dependência `@dcp-ai/sdk`.
- SDK de Go: `golang.org/x/crypto` v0.55.0, `golang.org/x/net` v0.58.0, `google.golang.org/grpc`
  v1.83.2, `go.opentelemetry.io/otel/*` v1.46.0.
- SDK de Rust: opentelemetry, opentelemetry_sdk e opentelemetry-otlp 0.32. O `opentelemetry_sdk`
  0.32.1 corrige uma alocação de memória sem limite na propagação do W3C Baggage.
- CI:
  - Novo job de testes de integração para express e openclaw.
  - O job de Rust compila e testa `--features otlp`.
  - O job de Go lê sua versão do `go.mod`.
  - O bundle V2 gerado é verificado com a CLI.
  - Os testes do servidor e da revogação são executados.

<a id="documentation-2"></a>
<a id="documentation_2"></a>

### Documentação

- `spec/VERIFICATION.md`:
  - O checklist V2 agora aponta para `schemas/v2/signed_bundle.schema.json` (os schemas `*_v2` citados nunca existiram).
  - A vinculação inexistente `independent` foi removida.
  - A implementação de referência é nomeada.
- `spec/CANONICALIZATION_PROFILE.md` §3 ganhou linhas para o escape de strings e a ordem das chaves por ponto de código. Isso esclarece as regras 1 e 3; o perfil não muda.
- A documentação do servidor, do operador, de migração, de referência da API, de CI e de bundles agora descreve a verificação V2 real, a sintaxe real da CLI e as APIs do SDK que existem:
  - As tabelas de API do guia de migração nomeavam várias funções que não existem.
  - O README do servidor mostrava o envelope pré-normativo.
- O README do SDK de Python (todos os idiomas) não afirma mais suporte a ML-KEM-768 nem a bundles V2, e o guia de início rápido do CrewAI marca seu trecho V2 como API planejada.
- Traduções e documentos do projeto:
  - 11 integrações, incluindo Agno; links para o perfil de canonicalização e para o guia de início rápido do Agno.
  - Trechos de instalação do Rust para esta versão e fixações `@latest` do Go.
  - Versões suportadas por pacote em `SECURITY.md`, e as versões v2.8.x e v2.9.0 em `ROADMAP.md`.
  - O DOI de conceito do Zenodo em `CITATION.cff`.

## [2.8.1] - 2026-04-26

<a id="wired-the-canonicalization_profile-field-across-the-four-sdks"></a>

### Integração do campo `canonicalization_profile` nos quatro SDKs

A `v2.8.0` declarou o campo `canonicalization_profile` em
`schemas/v2/bundle_manifest.schema.json` e o descreveu em
`spec/CANONICALIZATION_PROFILE.md` § 4, mas nenhum SDK de fato escrevia nem lia o campo: as estruturas tipadas
`BundleManifest` foram distribuídas sem ele, e os verificadores o ignoravam. A `v2.8.1` fecha essa lacuna de ponta
a ponta.

- **TypeScript (`@dcp-ai/sdk` 2.1.0 → 2.1.1)**: a interface `BundleManifest`
  em `sdks/typescript/src/types/v2.ts` ganha
  `canonicalization_profile?: 'dcp-jcs-v1'`. `BundleBuilderV2.build()`
  em `sdks/typescript/src/bundle/builder-v2.ts` agora emite
  `canonicalization_profile: "dcp-jcs-v1"` em todo manifesto que produz.
  `verifyV2Bundle` em `sdks/typescript/src/core/verify-v2.ts` aceita
  o campo ausente (presume `dcp-jcs-v1`), aceita `"dcp-jcs-v1"`
  explicitamente e rejeita qualquer outro valor com
  `"Unknown canonicalization_profile: <value>"`.
- **Python (`dcp-ai` 2.8.0 → 2.8.1)**: `BundleManifest` em
  `sdks/python/dcp_ai/v2/models.py` ganha
  `canonicalization_profile: Literal["dcp-jcs-v1"] | None = "dcp-jcs-v1"`.
  O Pydantic impõe a rejeição de valores desconhecidos na análise; a ausência
  aciona o valor padrão. Não é necessária nenhuma mudança separada no verificador,
  porque a validação fica no modelo.
- **Go (`sdks/go/v2.8.0` → `v2.8.1`)**: a struct `BundleManifest` em
  `sdks/go/dcp/v2/types.go` ganha `CanonicalizationProfile string` com
  `json:"canonicalization_profile,omitempty"`. `BuildBundleV2` em
  `sdks/go/dcp/v2/bundle_builder.go` o define como `"dcp-jcs-v1"` em todo
  manifesto que produz. `VerifySignedBundleV2` em
  `sdks/go/dcp/v2/verify_bundle.go` agora rejeita bundles cujo manifesto
  tenha um valor de `canonicalization_profile` diferente de `"dcp-jcs-v1"`.
- **Rust (`dcp-ai` no crates.io 2.8.0 → 2.8.1)**:
  `BundleManifest` em `sdks/rust/src/v2/types.rs` ganha
  `pub canonicalization_profile: Option<String>` com
  `#[serde(skip_serializing_if = "Option::is_none")]`. `wasm_build_bundle`
  em `sdks/rust/src/lib.rs` define `"canonicalization_profile":
  "dcp-jcs-v1"` no manifesto que emite.

<a id="spec--profile-document"></a>
<a id="spec-profile-document"></a>

### Especificação e documento do perfil

- `spec/DCP-AI-v2.0.md` § 9 (manifesto do bundle) agora lista
  `canonicalization_profile` junto com os outros campos do manifesto, com
  uma nota em linha de que um campo ausente deve (MUST) ser presumido equivalente a
  `"dcp-jcs-v1"`.
- `spec/CANONICALIZATION_PROFILE.md` § 2: a regra 6 (tratamento de undefined / null)
  foi reescrita como uma tabela entre linguagens que lista explicitamente
  como os valores do host de TypeScript, Python, Go e Rust correspondem ao
  formato de transmissão JSON, tanto nas posições de objeto quanto nas de array.
- `spec/CANONICALIZATION_PROFILE.md` § 2: uma nova regra 9 deixa explicitamente fora do escopo a
  normalização Unicode (NFC, NFD, NFKC, NFKD): o
  canonicalizador emite as strings byte a byte como o analisador do host as entrega, e um perfil futuro
  (`dcp-jcs-v2` ou posterior) pode (MAY) fixar uma forma de normalização. A RFC 8259 § 8.1 é citada como a
  escolha convencional (NFC) para a normalização na camada de aplicação.
- A regra 9 de `spec/CANONICALIZATION_PROFILE.md` também fixa o motivo
  para não distribuir fixtures de interoperabilidade com `NaN` / `±Infinity`: esses valores
  não fazem parte do formato de transmissão da RFC 8259, então a maioria dos analisadores os rejeita
  antes de chegar ao canonicalizador. A rejeição é verificada por testes unitários de cada SDK
  em vez de fixtures compartilhados.

<a id="behavioural-compatibility"></a>

### Compatibilidade de comportamento

O novo campo é **aditivo e opcional na serialização**:

- Um bundle produzido pela `v2.8.1` tem `canonicalization_profile:
  "dcp-jcs-v1"` no seu manifesto. Verificadores mais antigos que não conhecem
  o campo o tratarão como uma propriedade desconhecida, o que não é problema,
  porque o JSON Schema declara o campo compatível com `additionalProperties`
  (ele está entre as `properties` e é `optional`).
- Um bundle produzido pela `v2.8.0` ou anterior não tem o campo
  `canonicalization_profile`. Os verificadores `v2.8.1` o aceitam: segundo
  `spec/CANONICALIZATION_PROFILE.md` § 4, um campo ausente deve (MUST) ser
  presumido equivalente a `"dcp-jcs-v1"`.
- Um bundle que tem `canonicalization_profile` com um valor desconhecido
  (por exemplo, `"dcp-jcs-v2"`) é rejeitado por todos os SDKs `v2.8.1`. Esse
  é o gancho de compatibilidade futura para perfis futuros: um verificador
  que não foi atualizado para um perfil novo deve (MUST) recusá-lo em vez de
  aceitar em silêncio um manifesto que não consegue validar.

A assinatura do bundle cobre `canonical(manifest)`, então acrescentar o
campo muda o hash do manifesto de qualquer bundle recém-produzido em relação
a um que teria sido produzido sob a `v2.8.0`. Os bundles produzidos
sob a `v2.8.0` e anteriores, e suas assinaturas armazenadas, continuam válidos
sob os verificadores `v2.8.1`.

<a id="versions-bumped"></a>

### Versões atualizadas

- `dcp-ai` (PyPI) 2.8.0 → 2.8.1
- `dcp-ai` (crates.io) 2.8.0 → 2.8.1
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` v2.8.0 → v2.8.1
- `@dcp-ai/sdk` (npm) 2.1.0 → 2.1.1: primeira mudança de código TypeScript
  desde a 2.1.0 (a versão 2.8.0 foi só uma edição de docstrings)

## [2.8.0] - 2026-04-26

<a id="added--canonicalization-profile-dcp-jcs-v1"></a>
<a id="added-canonicalization-profile-dcp-jcs-v1"></a>

### Adicionado — Perfil de canonicalização `dcp-jcs-v1`

Uma comparação pública com outro protocolo revelou três assimetrias reais
na forma como os quatro SDKs canonicalizavam JSON: `1.0`/`1.00`
eram rejeitados por Python e Rust, mas aceitos por TypeScript e Go;
`1e2` era rejeitado só pelo Rust; e `undefined` não tinha tratamento formal
na especificação. O resumo «RFC 8785 + somente inteiros» de
`spec/DCP-AI-v2.0.md` § 15 estava correto até onde ia, mas não
fixava os casos que o JCS deixa a critério da implementação. Esta versão fecha
todos eles.

- **Novo documento normativo**: [`spec/CANONICALIZATION_PROFILE.md`](../../spec/CANONICALIZATION_PROFILE.md)
  formaliza o perfil `dcp-jcs-v1` com oito regras numeradas, uma
  tabela de aceitação de casos-limite cobrindo 22 entradas, um contrato de tratamento de undefined
  que documenta a assimetria exclusiva do TypeScript (omitido em
  objetos, serializado como `null` em arrays), e uma política de versionamento
  para perfis futuros.
- **Campo do manifesto do bundle**: `canonicalization_profile: "dcp-jcs-v1"`
  acrescentado a `schemas/v2/bundle_manifest.schema.json` como campo
  opcional. Verificadores que encontrarem um bundle sem ele devem (MUST) presumir
  `dcp-jcs-v1`. Perfis futuros tornarão o campo obrigatório.
- **Python (`dcp-ai` 2.7.1 → 2.8.0)**: `assert_no_floats` agora aceita
  números de ponto flutuante cujo valor é um inteiro finito (`1.0`, `1e2`, `1.00`); eles
  são normalizados para a forma inteira antes de `json.dumps`. Números não inteiros
  (`0.1`), `NaN` e infinitos continuam rejeitados.
- **Rust (`dcp-ai` 2.7.0 → 2.8.0)**: `assert_no_floats` agora aceita
  `Number(f64)` cujo `fract()` é zero. Um novo auxiliar `format_number`
  em `canonical_recurse` emite números de ponto flutuante de valor inteiro sem ponto decimal
  nem expoente, igual byte a byte aos outros SDKs.
- **Go (`sdks/go/v2.7.0` → `v2.8.0`)**: o comportamento já estava alinhado
  (verificação `v != math.Trunc(v)`). Só mudança de versão.
- **TypeScript (`@dcp-ai/sdk` continua em 2.1.0)**: o comportamento já estava
  alinhado. O docstring em `sdks/typescript/src/core/canonicalize.ts`
  formaliza a assimetria entre undefined e null.

<a id="added--interop-edge-case-fixtures"></a>
<a id="added-interop-edge-case-fixtures"></a>

### Adicionado — fixtures de interoperabilidade para casos-limite

`tests/interop/v2/interop_vectors.json` agora inclui
`canonicalization.edge_cases` com 14 vetores cobrindo a preservação de null
(com chave, dentro de arrays), números de ponto flutuante de valor inteiro,
zeros à direita, notação científica, rejeição de frações, rejeição de valores não finitos,
ordenação de chaves por ponto de código (incluindo `é`), nulls aninhados,
contêineres vazios, objetos profundamente aninhados e arrays com null. O teste de
interoperabilidade de cada SDK carrega o mesmo bloco e verifica uma saída idêntica byte a byte
(ou o mesmo erro) para cada vetor. A CI executa os quatro em
paralelo em todo PR; uma divergência bloqueia o lançamento.

<a id="versions-bumped-1"></a>
<a id="versions-bumped_1"></a>

### Versões atualizadas

- `dcp-ai` (PyPI) 2.7.1 → 2.8.0
- `dcp-ai` (crates.io) 2.7.0 → 2.8.0
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` → v2.8.0
- `@dcp-ai/sdk` (npm) continua em 2.1.0: o TypeScript já implementava
  o perfil; esta versão acrescenta só a formalização no docstring.

<a id="behavioural-compatibility-1"></a>
<a id="behavioural-compatibility_1"></a>

### Compatibilidade de comportamento

Os bundles produzidos por versões anteriores continuam válidos. A mudança é
**aditiva** para os SDKs que antes rejeitavam `1.0`/`1.00`/`1e2`:
entradas que antes lançavam `TypeError`/`Err` agora têm sucesso e produzem
a mesma saída canônica que os outros SDKs já produziam. Nenhuma
entrada que antes era canonicalizada com sucesso é canonicalizada
de outra forma na 2.8.0.

<a id="271---2026-04-23-python-only"></a>
<a id="271-2026-04-23-python-only"></a>

## [2.7.1] - 2026-04-23 (somente Python)

<a id="fixed-3"></a>
<a id="fixed_3"></a>

### Corrigido

- O `dcp-ai` (PyPI) 2.7.0 não tinha `cryptography` como dependência obrigatória. O
  pacote é exigido pela camada de sessão A2A do DCP-04 introduzida na 2.5.0
  para a cifragem AES-256-GCM. Instalações novas com `pip install dcp-ai==2.7.0`
  não traziam `cryptography`, então três testes de sessão A2A falhavam em um ambiente
  limpo (`test_encrypt_decrypt_round_trip`, `test_tamper_ciphertext_rejected`,
  `test_session_id_mismatch`). A 2.7.1 acrescenta `cryptography>=41.0` às dependências
  obrigatórias do wheel.

Rust (`dcp-ai` no crates.io) e Go (`sdks/go/v2`) não são afetados e continuam na
2.7.0: o pacote `cryptography` do Python só importa para o wheel do Python.

## [2.7.0] - 2026-04-23

<a id="added--canonical-error-codes--wire-format-detection-in-py--go--rs"></a>
<a id="added-canonical-error-codes-wire-format-detection-in-py-go-rs"></a>

### Adicionado — Códigos de erro canônicos + detecção do formato de transmissão em PY / GO / RS

Porta o enum `DcpErrorCode` e o mecanismo associado `DcpError` / `DcpProtocolError`
do TS para Python, Rust e Go, além do auxiliar leve
`detect_wire_format`, que encaminha um fluxo de bytes de entrada para
"json" ou "cbor" com base no primeiro byte.

**Todos os SDKs agora concordam com os mesmos 38 códigos de erro canônicos**, cobrindo:
erros de schema (E001-E099), erros de assinatura (E100-E199), erros de hash e cadeia
(E200-E299), erros de identidade (E300-E399), erros de política (E400-E499),
erros de sessão (E500-E599), erros A2A (E600-E699), limitação de taxa
(E700-E799) e erros internos (E900-E999). Cada código tem uma mensagem canônica
e um indicador `retryable`, para que os clientes possam implementar uma lógica de nova tentativa
que corresponda à política de forma consistente entre os SDKs.

**Python (`dcp-ai` 2.6.0 -> 2.7.0)**: novo módulo `dcp_ai.v2.error_codes`
com `DcpErrorCode` (str-enum), a dataclass `DcpError`,
a exceção `DcpProtocolError`, `create_dcp_error`, `is_dcp_error`,
`detect_wire_format` e o mapeamento `ERROR_DESCRIPTIONS`.

**Rust (`dcp-ai` 2.6.0 -> 2.7.0)**: `dcp_ai::v2::error_codes` com o
enum `DcpErrorCode` (`Display` → o identificador estável `DCP-E###`),
a struct `DcpError`, `create_dcp_error` e `detect_wire_format`.

**Go (`sdks/go/v2.6.0 -> v2.7.0`)**: o tipo string `v2.DcpErrorCode` com
37 constantes `Err*`, a struct `v2.DcpError` que implementa a interface
`error`, `CreateDcpError`, `IsDcpError`, `DetectWireFormat`.

<a id="cbor-encoderdecoder-scope-decision"></a>

### Decisão sobre o escopo do codificador/decodificador CBOR

O codificador/decodificador CBOR completo continua exclusivo do TypeScript na 2.x. Portar uma
implementação determinística da RFC 8949 para mais três SDKs é um projeto considerável
que merece um marco próprio; `detect_wire_format` é o
único auxiliar de que todo SDK precisa hoje para encaminhar payloads CBOR a uma
biblioteca existente do ecossistema (por exemplo, `cbor2` no Python,
`github.com/fxamacker/cbor/v2` no Go, `ciborium` no Rust). Uma versão
v3.x dedicada acrescentará um port canônico.

<a id="test-counts"></a>

### Contagem de testes

- Python: 231/231 aprovados (sem mudança; superfície de importação verificada)
- Rust: 152/152 aprovados (+5 novos)
- Go: 115/115 aprovados (+8 novos)

<a id="versions-bumped-2"></a>
<a id="versions-bumped_2"></a>

### Versões atualizadas

- `dcp-ai` (PyPI) 2.6.0 -> 2.7.0
- `dcp-ai` (crates.io) 2.6.0 -> 2.7.0
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` -> v2.7.0

## [2.6.0] - 2026-04-23

<a id="added--blinded-rpr-multi-party-auth-advisory-helpers-in-rust--go"></a>
<a id="added-blinded-rpr-multi-party-auth-advisory-helpers-in-rust-go"></a>

### Adicionado — RPR cego, autorização multipartes e auxiliares de avisos em Rust + Go

Porta para Rust e Go três funcionalidades exclusivas do Python, fechando a diferença
apontada na comparação, em que o Python estava à frente dos outros SDKs que não são TS.

- **RPR cego (Gap #2)**: `compute_pii_hash`, `blind_rpr`,
  `verify_blinded_rpr`, `is_blinded_rpr`.
- **Autorização multipartes (Gap #5)**: `verify_multi_party_authorization`
  + `MultiPartyPolicy` com as quatro políticas de operação padrão
  (`revoke_agent`, `rotate_org_key`, `change_jurisdiction`,
  `modify_recovery_config`).
- **Auxiliares de avisos sobre algoritmos (Gap #4)**: `check_advisory`,
  `evaluate_advisories`, `apply_advisories_to_policy`,
  `build_algorithm_advisory`.

Os três módulos correspondem à semântica do Python: compromisso SHA-256 dos dados pessoais,
validação estrutural M de N (a verificação criptográfica fica no gateway)
e roteamento por ação (`revoke` / `deprecate` / `warn`) com tratamento do
período de carência.

Python (`dcp-ai` 2.5.0 -> 2.6.0): nenhuma mudança de código, só mudança de versão para
manter o conjunto de SDKs sincronizado.

<a id="test-counts-1"></a>
<a id="test-counts_1"></a>

### Contagem de testes

- Rust: 147/147 (+14 novos)
- Go: 106/106 (+12 novos)
- Python: 231/231 (sem mudança)

## [2.5.0] - 2026-04-23

<a id="added--dcp-04-agent-to-agent-protocol-parity"></a>
<a id="added-dcp-04-agent-to-agent-protocol-parity"></a>

### Adicionado — Paridade do protocolo entre agentes do DCP-04

Porta para os SDKs restantes a estrutura básica do DCP-04 (comunicação entre agentes).

**Python (`dcp-ai` 2.4.0 -> 2.5.0)**: paridade completa com o TS, incluindo a
camada de sessão simétrica (AES-256-GCM por meio do pacote `cryptography`).

- Descoberta: `create_agent_directory`, `find_agent_by_capability`,
  `find_agent_by_id`, `validate_directory_entry`.
- Handshake: `generate_nonce`, `create_hello`, `create_welcome`,
  `derive_session_id`, `create_close_message`.
- Sessão: `A2ASession`, `create_session`, `encrypt_message`,
  `decrypt_message`, `needs_rekeying`, `generate_resume_proof`,
  `verify_resume_proof`, `derive_rekeyed_session_key`.

**Go (`sdks/go/v2.4.0 -> v2.5.0`)**: paridade completa com o TS, usando
`crypto/aes` + `crypto/cipher` da biblioteca padrão do Go para AES-256-GCM (sem novas dependências).

**Rust (`dcp-ai` 2.4.0 -> 2.5.0)**: estrutura básica de descoberta + handshake.
A camada de sessão AES-256-GCM está prevista para uma versão posterior; quem usa Rust
ainda pode construir diretórios e mensagens HELLO/WELCOME, e derivar
IDs de sessão.

Contagem de testes: Python 231/231, Rust 133/133, Go 94/94.

## [2.4.0] - 2026-04-23

<a id="added--production-hardening-primitives-in-python-rust-go"></a>
<a id="added-production-hardening-primitives-in-python-rust-go"></a>

### Adicionado — Primitivas de reforço para produção em Python, Rust e Go

Porta do núcleo TS as quatro primitivas de reforço críticas para o protocolo:

- Auxiliares de **nonce de sessão**: `generate_session_nonce`, `is_valid_session_nonce`,
  `verify_session_binding`, `generate_session_expiry`, `is_session_expired`.
- **Nível de segurança adaptativo**: `compute_security_tier`, `max_tier`,
  `tier_to_verification_mode`, `tier_to_checkpoint_interval` (o Go já tinha
  `ComputeSecurityTier`; a v2.4 acrescenta as três funções auxiliares).
- **Revogação de emergência** (Gap #13): `generate_emergency_revocation_token`,
  `verify_emergency_revocation_secret`, `build_emergency_revocation`.
- **Checkpoints PQ preguiçosos**: `audit_events_merkle_root`, `create_pq_checkpoint`,
  e a classe `PQCheckpointManager`, com seleção do intervalo pelo nível e
  descarga automática.

Os quatro módulos correspondem exatamente à semântica do TS: verificação do segredo em tempo
constante para a revogação de emergência, intervalos de checkpoint pelo nível,
regex de validação do nonce de sessão e payloads de checkpoint assinados sob o
contexto de separação de domínio `DCP-AI.v2.AuditEvent`.

<a id="whats-not-in-v24"></a>

### O que não está na v2.4

Deixado de fora deliberadamente (será lançado em versões posteriores se houver demanda):

- Compartilhamento de segredos de Shamir (Gap #1): exige uma revisão criptográfica cuidadosa; somente TS.
- Cache de verificação: questão da aplicação, não do protocolo.
- Limitação de taxa / disjuntor / nova tentativa: padrões da aplicação que é melhor
  delegar a bibliotecas existentes do ecossistema.

<a id="test-counts-2"></a>
<a id="test-counts_2"></a>

### Contagem de testes

- Python: 214/214 aprovados (+24 novos)
- Rust: 126/126 aprovados (+10 novos)
- Go: 81/81 aprovados (+9 novos)

<a id="versions-bumped-3"></a>
<a id="versions-bumped_3"></a>

### Versões atualizadas

- `dcp-ai` (PyPI) 2.3.0 -> 2.4.0
- `dcp-ai` (crates.io) 2.3.0 -> 2.4.0
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` -> v2.4.0

## [2.3.0] - 2026-04-23

<a id="added--dispute--rights--delegation-parity-across-sdks"></a>
<a id="added-dispute-rights-delegation-parity-across-sdks"></a>

### Adicionado — Paridade de disputas, direitos e delegação entre SDKs

Python, Rust e Go agora implementam o comportamento do DCP-07 (resolução de disputas + arbitragem),
do DCP-08 (direitos e obrigações) e do DCP-09 (delegação, limiar de consciência,
espelho do principal), correspondendo ao conjunto de funcionalidades do TypeScript.

**Novos grupos de funções (semântica idêntica em PY/RS/GO, correspondendo ao TS):**

Resolução de conflitos do DCP-07:

- `create_dispute` · `escalate_dispute` · `resolve_dispute` · `create_objection`
- Arbitragem: `create_arbitration_panel` · `submit_resolution` ·
  `build_jurisprudence_bundle` · `lookup_precedent`

Direitos e obrigações do DCP-08:

- `declare_rights` · `record_obligation` · `report_violation` ·
  `check_rights_compliance`

Delegação e representação do DCP-09:

- Delegação: `create_delegation_mandate` · `verify_mandate_validity` ·
  `revoke_delegation` · `generate_interaction_record`
- Limiar de consciência: `evaluate_significance` · `should_notify_human` ·
  `create_awareness_threshold` · `create_advisory_declaration`
- Espelho do principal: `generate_mirror`

Todas as novas fábricas usam o caminho de assinatura composta existente sob os
contextos de separação de domínio `DCP-AI.v2.Dispute`, `DCP-AI.v2.Rights`, `DCP-AI.v2.Delegation` e
`DCP-AI.v2.Awareness`. O artefato do mandato de delegação
tem a assinatura do principal humano no campo `human_composite_sig`,
correspondendo ao formato de transmissão do TS.

<a id="test-counts-3"></a>
<a id="test-counts_3"></a>

### Contagem de testes

- Python: 190/190 aprovados (+21 novos)
- Rust: 116/116 aprovados (+12 novos)
- Go: 72/72 aprovados (+12 novos no pacote externo `dcp_test`)
- TypeScript: 460/460 aprovados (sem mudanças)

<a id="versions-bumped-4"></a>
<a id="versions-bumped_4"></a>

### Versões atualizadas

- `dcp-ai` (PyPI) 2.2.0 -> 2.3.0
- `dcp-ai` (crates.io) 2.2.0 -> 2.3.0
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` -> v2.3.0
- `@dcp-ai/sdk` (npm) continua em 2.1.0

## [2.2.0] - 2026-04-23

<a id="added--lifecycle--succession-parity-across-sdks"></a>
<a id="added-lifecycle-succession-parity-across-sdks"></a>

### Adicionado — Paridade de ciclo de vida e sucessão entre SDKs

Os SDKs de Python, Rust e Go agora implementam o comportamento do DCP-05 (ciclo de vida do agente) e do DCP-06
(sucessão digital). O TypeScript já os incluía na 2.0.x; a
versão 2.2.0 fecha a primeira diferença de paridade de comportamento identificada na
comparação entre SDKs.

**Novas funções (semântica idêntica em Python/Rust/Go, correspondendo ao TS):**

Ciclo de vida do agente do DCP-05:

- `validate_state_transition` / `ValidateStateTransition`
- `compute_vitality_score` / `ComputeVitalityScore`
- `create_commissioning_certificate` / `CreateCommissioningCertificate`
- `create_vitality_report` / `CreateVitalityReport`
- `hash_vitality_report` / `HashVitalityReport`
- `create_decommissioning_record` / `CreateDecommissioningRecord`

Sucessão digital do DCP-06:

- `create_digital_testament` / `CreateDigitalTestament`
- `update_digital_testament` / `UpdateDigitalTestament`
- `classify_memory` / `ClassifyMemory`
- `create_memory_transfer_manifest` / `CreateMemoryTransferManifest`
- `execute_succession` / `ExecuteSuccession`

Todas as novas fábricas usam o caminho de assinatura composta existente sob os
contextos de separação de domínio `DCP-AI.v2.Lifecycle` e `DCP-AI.v2.Succession`,
então os artefatos produzidos por qualquer SDK são compatíveis no formato de transmissão e verificáveis entre SDKs.

<a id="test-counts-after-this-release"></a>

### Contagem de testes após esta versão

- Python: 169/169 aprovados (+24 novos)
- Rust: 104/104 aprovados (+10 novos)
- Go: 60/60 aprovados (+13 novos no pacote externo `dcp`; o pacote v2 não muda)
- TypeScript: 460/460 aprovados (sem mudanças)

<a id="known-protocol-level-note"></a>

### Nota conhecida no nível do protocolo

A canonicalização do DCP v2.0 proíbe números de ponto flutuante para o determinismo entre SDKs, mas
o schema do relatório de vitalidade expressa os valores de cada métrica como `number`
(0.0..1.0). As fábricas dos quatro SDKs agora aceitam métricas no limite da
API, mas os signatários exigem representações inteiras no formato de transmissão. Isso
está documentado nos testes de cada SDK. Uma versão futura pode endurecer o
schema para inteiros (ou pontos-base) para eliminar a diferença por completo.

<a id="versions-bumped-5"></a>
<a id="versions-bumped_5"></a>

### Versões atualizadas

- `dcp-ai` (PyPI) 2.1.0 -> 2.2.0
- `dcp-ai` (crates.io) 2.1.0 -> 2.2.0
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` -> v2.2.0
- `@dcp-ai/sdk` (npm) continua em 2.1.0 (o TS já tinha essas funções)

<a id="210---2026-04-22"></a>

## [2.1.0] - 2026-04-22

<a id="added-3"></a>
<a id="added_3"></a>

### Adicionado

**Exportador OpenTelemetry (OTLP) para os quatro SDKs principais**: TypeScript, Python, **Rust e Go**. Quem adota o protocolo agora pode enviar a observabilidade do DCP para qualquer backend compatível com OTel (Grafana, Jaeger, Honeycomb, Datadog, New Relic, Collectors auto-hospedados) sem pontes feitas à mão. Todo SDK que executa criptografia DCP agora informa os mesmos nomes de métricas, contadores e formatos de spans.

- **Rust (`dcp-ai` 2.0.0 → 2.1.0)**
    - Novo módulo `dcp_ai::observability` com um singleton `DcpTelemetry` seguro entre threads, métodos de registro, ciclo de vida de spans, barramento de listeners `on_event` e `MetricsSummary` com p50/p95/p99.
    - Feature opcional do Cargo `otlp` (`cargo add dcp-ai --features otlp`), que puxa `opentelemetry`, `opentelemetry_sdk`, `opentelemetry-otlp` e `tokio`. Sem a feature, pedir `ExporterType::Otlp` emite um evento de erro claro em vez de entrar em pânico.
    - Caminhos críticos instrumentados: `crypto::sign_object` e `crypto::verify_object` emitem telemetria de latência e erros quando ativada. Sem sobrecarga quando desativada (padrão).
    - 10 testes unitários cobrindo o comportamento desativado por padrão, percentis, ciclo de vida de spans, distribuição de níveis, taxa de acerto de cache e isolamento de pânico dos listeners.

- **Go (`sdks/go/v2.0.0 → v2.1.0`)**
    - Novo pacote `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/observability` com um tipo `Telemetry` protegido por mutex, o singleton `Default()`, métodos de registro, assinantes com recuperação de pânico e cálculo de percentis igual aos outros SDKs.
    - A ponte OTLP é condicionada à build tag `otlp` (`go build -tags otlp`). Sem a tag, pedir `ExporterOTLP` emite um evento de erro `otlp_init` claro pelo barramento de listeners. As dependências de `go.opentelemetry.io/otel` constam em `go.mod`, mas não são exigidas em tempo de execução pelos builds padrão.
    - Caminhos críticos instrumentados: `dcp.SignObject` e `dcp.VerifyObject` emitem telemetria de latência e erros quando ativada. Sem sobrecarga quando desativada (padrão).
    - 10 testes unitários do pacote de observabilidade + 2 testes de integração com `dcp.SignObject` cobrindo os caminhos ativado e desativado.

- **TypeScript (`@dcp-ai/sdk` 2.0.0 → 2.1.0)**
    - `dcpTelemetry.init({ exporterType: 'otlp' })` agora funciona de fato (o campo de configuração estava declarado na 2.0.x, mas não conectado).
    - O SDK do OTel é importado **sob demanda**: as instalações padrão não mudam. Os pacotes `@opentelemetry/*` são declarados como dependências peer opcionais; quando ausentes, `init()` emite um evento de erro claro pelo barramento de listeners e a aplicação continua rodando.
    - Novo `dcpTelemetry.shutdown()` para descarregar as exportações pendentes.
    - Resolução do endpoint: configuração `otlpEndpoint` → variável de ambiente `OTEL_EXPORTER_OTLP_ENDPOINT` → `http://localhost:4318`.
    - Atributos de recurso `service.name` + `service.version` preenchidos automaticamente.
    - Mapeamento de métricas: os registradores do DCP correspondem a histogramas do OTel (`dcp.sign.latency_ms`, `dcp.verify.latency_ms`, `dcp.kem.latency_ms`, `dcp.checkpoint.latency_ms`, `dcp.bundle_verify.latency_ms`) e contadores (`dcp.signatures.created`, `dcp.signatures.verified`, `dcp.bundles.verified`, `dcp.a2a.sessions`, `dcp.errors`).
    - 2 novos casos de vitest; 460/460 testes aprovados.

- **Python (`dcp-ai` 2.0.2 → 2.1.0)**
    - Novo módulo `dcp_ai.observability` que fornece o singleton `dcp_telemetry` com a mesma superfície de API da versão TypeScript: spans, registradores de métricas (`record_sign_latency`, `record_verify_latency`, `record_kem_latency`, `record_checkpoint_latency`, `record_bundle_verify`, `record_cache_hit/miss`, `record_a2a_*`, `record_error`), barramento de listeners `on_event` e `get_metrics_summary` com p50/p95/p99.
    - Modos do exportador: `none` (padrão) / `console` / `otlp`.
    - Novo extra de instalação: `pip install 'dcp-ai[otlp]'` puxa `opentelemetry-sdk` + `opentelemetry-exporter-otlp-proto-http`. Sem o extra, `init(exporter_type="otlp")` mostra uma dica clara de instalação sem falhar.
    - Caminhos críticos instrumentados: `sign_object` e `verify_object` agora emitem telemetria de latência e erros quando ativada. Sem sobrecarga quando desativada (padrão).
    - Exportação pública: `from dcp_ai import dcp_telemetry` funciona.
    - 15 novos casos de pytest; 145/145 testes aprovados.

<a id="documentation-3"></a>
<a id="documentation_3"></a>

### Documentação

- Novo `docs/OBSERVABILITY.md` com três receitas de backend prontas para copiar e colar (Jaeger local via Docker, endpoint OTLP do Grafana Cloud, Honeycomb).

<a id="backward-compatibility"></a>

### Compatibilidade com versões anteriores

- Totalmente compatível com versões anteriores nos quatro SDKs. Os padrões não mudam: a telemetria vem desativada e os registradores não fazem nada. Quem não quer observabilidade não precisa mudar código.
- Semver sincronizado: `@dcp-ai/sdk` (npm), `dcp-ai` (PyPI), `dcp-ai` (crates.io) e `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` passam todos para 2.1.0. Os demais pacotes publicáveis (CLI, WASM, integrações, scaffolders create-*) permanecem nas versões atuais.
- A observabilidade do SDK de WASM fica para uma versão menor futura; a telemetria no navegador tem requisitos de transporte diferentes.

<a id="template-packages---2026-04-21"></a>
<a id="template-packages-2026-04-21"></a>

## Pacotes de templates - 2026-04-21

Primeira publicação de quatro scaffolders `npm create @dcp-ai/*`, todos em `v2.0.0`:

- `@dcp-ai/create-langchain`
- `@dcp-ai/create-crewai`
- `@dcp-ai/create-openai`
- `@dcp-ai/create-express`

Uso: `npm create @dcp-ai/langchain my-app` (ou qualquer um dos quatro). Cada scaffolder inclui um template inicial autocontido, com o mesmo conteúdo do `templates/<name>/` existente no repositório, mais um pequeno `bin.js` de 35 linhas sem dependências de execução.

<a id="infrastructure"></a>

## Infraestrutura

- O **contexto JSON-LD** agora é servido em [`https://dcp-ai.org/credentials/v2`](https://dcp-ai.org/credentials/v2) (Content-Type `application/ld+json`, CORS `*`, cache de 24 h). Exigido pelo `@dcp-ai/w3c-did` para que toda Verifiable Credential/Presentation emitida possa ser desreferenciada por processadores JSON-LD estritos (Veramo, SpruceID, Trinsic).
- **Relatórios de cobertura do Codecov** agregados entre os quatro SDKs (TypeScript, Python, Go, Rust) com flags por SDK. Badge ativo no README.
- **Workflows de publicação reforçados**: todo job (npm / PyPI / crates.io) agora verifica antes o registro e termina em verde com um aviso de pulo se a versão do manifesto já estiver publicada. Chega de jobs vermelhos em lançamentos rotineiros.

<a id="go-sdk-v200---2026-04-19"></a>
<a id="go-sdk-v200-2026-04-19"></a>

## SDK de Go v2.0.0 - 2026-04-19

Primeira versão do SDK de Go que pode ser instalada com `go get`. O caminho de módulo anterior (`github.com/dcp-ai/dcp-ai-go`) apontava para um repositório que não existia, então ninguém de fora conseguia instalá-lo. O módulo agora vive como módulo de subdiretório dentro deste monorepo:

- **Novo caminho de módulo**: `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` (o Go exige o sufixo `/v2` para versões principais ≥ 2)
- **Formato das tags**: `sdks/go/v2.0.0` (com o prefixo do subdiretório, como exige o proxy de módulos do Go para repositórios com vários módulos)
- **Instalação**: `go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.0.0`

O código não muda: só o caminho do módulo e as importações internas foram reescritos. Todos os testes continuam passando.

## [2.0.2] - 2026-04-18

<a id="python-sdk"></a>

### SDK de Python

- **Corrigido**: `dcp_ai.__version__` agora reflete dinamicamente a versão instalada por meio de `importlib.metadata`, em vez de uma string fixa. Na 2.0.1, o atributo ainda informava `"1.0.0"`, embora o wheel fosse `2.0.1`.

<a id="ci--publish-workflows"></a>
<a id="ci-publish-workflows"></a>

### CI / workflows de publicação

- Todo job de publicação (`publish.yml`, `publish-pypi.yml`, `publish-integrations.yml`) agora verifica antes se a versão do manifesto já está no registro e, se estiver, termina em verde com um aviso de pulo. Antes, toda execução disparada por um lançamento tentava publicar de novo versões já publicadas e deixava quatro jobs vermelhos na aba Actions. Chega de fantasmas vermelhos cosméticos em lançamentos rotineiros.
- Corrigidos dois nomes de pacote desatualizados na tabela de integrações do README: `@dcp-ai/a2a` → `@dcp-ai/google-a2a`, `@dcp-ai/mcp` → `@dcp-ai/anthropic-mcp`.
- Badges de versão do npm / PyPI ao vivo acrescentados em cada linha da tabela de integrações.

## [2.0.1] - 2026-04-18

<a id="python-sdk-1"></a>
<a id="python-sdk_1"></a>

### SDK de Python

As pontes com frameworks agora vêm dentro do pacote. Antes da 2.0.1,
elas ficavam em `integrations/<name>/` no repositório e só podiam ser
carregadas por um truque do pytest; quem executava `pip install dcp-ai[fastapi]`
recebia a biblioteca `fastapi` original, mas não o middleware `dcp_ai.fastapi`.
A 2.0.1 corrige isso: os quatro módulos agora ficam em
`dcp_ai/` e são incluídos no wheel publicado.

- **Adicionado**: `dcp_ai.fastapi` (middleware, injeção de dependências, verificações de estrutura V2)
- **Adicionado**: `dcp_ai.langchain` (wrapper de agente, callback, pontuação de risco)
- **Adicionado**: `dcp_ai.openai` (cliente, schema de ferramentas, construtor da trilha de auditoria)
- **Adicionado**: `dcp_ai.crewai` (agente de crew, trilha de auditoria combinada, verificações de consistência da sessão)
- **Removido**: o carregador dinâmico de módulos de `tests/conftest.py` (não é mais necessário)

<a id="installation"></a>

### Instalação

```bash
pip install dcp-ai[fastapi]     # brings fastapi + uvicorn
pip install dcp-ai[langchain]   # brings langchain + langchain-core
pip install dcp-ai[openai]      # brings openai
pip install dcp-ai[crewai]      # brings crewai
```

<a id="backward-compatibility-1"></a>
<a id="backward-compatibility_1"></a>

### Compatibilidade com versões anteriores

Totalmente compatível com as importações da 2.0.0. Os novos módulos só acrescentam superfície
de API; as chamadas existentes `from dcp_ai import ...` não são afetadas.

## [npm integrations] - 2026-04-18

Primeira publicação das seis pontes com frameworks como pacotes npm
independentes, todos em `v2.0.0`:

- `@dcp-ai/anthropic-mcp`: ponte com o Anthropic MCP
- `@dcp-ai/autogen`: ponte com o Microsoft AutoGen
- `@dcp-ai/google-a2a`: ponte com o Google Agent-to-Agent
- `@dcp-ai/w3c-did`: ponte com o W3C DID/VC
- `@dcp-ai/express`: middleware do Express
- `@dcp-ai/openclaw`: plugin do OpenClaw

`@dcp-ai/express` e `@dcp-ai/openclaw` dependem de `@dcp-ai/sdk ^2.0.0`.

## [2.0.0] - 2026-04-18

Primeira versão pública dos pacotes. Publicada simultaneamente no npm (`@dcp-ai/sdk`, `@dcp-ai/cli`, `@dcp-ai/wasm`), no PyPI (`dcp-ai`) e no crates.io (`dcp-ai`).

<a id="added-4"></a>
<a id="added_4"></a>

### Adicionado

**Pilha do protocolo (DCP-01 a DCP-09)**

- **DCP-01** Identidade e vinculação à pessoa: identidade do agente, atestação do operador, vinculação de chaves
- **DCP-02** Declaração de intenção e controle por políticas: intenções declaradas, aplicação de níveis, avaliação de políticas
- **DCP-03** Cadeia de auditoria e transparência: entradas de auditoria encadeadas por hash, provas de Merkle, logs de transparência
- **DCP-04** Comunicação entre agentes: descoberta, handshake, sessões cifradas
- **DCP-05** Ciclo de vida do agente: entrada em serviço, relatórios de vitalidade, registros de desativação, máquina de estados com quatro modos de encerramento
- **DCP-06** Sucessão e herança digitais: testamentos digitais, cerimônias de sucessão (planejada/forçada/de emergência), manifestos de transferência seletiva de memória
- **DCP-07** Resolução de conflitos e arbitragem: registros de disputa tipados, escalonamento em três níveis, painéis de arbitragem M de N, pacotes de jurisprudência, registros de objeção
- **DCP-08** Arcabouço de direitos e obrigações: quatro direitos do agente (integridade da memória, transição digna, consistência da identidade, registro imutável), acompanhamento de obrigações, relatórios de violação ligados ao DCP-07
- **DCP-09** Representação pessoal e delegação: mandatos de delegação, limiares de consciência, declarações de alerta, espelhos do principal, registros de interação de duas camadas; estende o handshake do DCP-04 com a verificação do mandato

**Criptografia (4 níveis: Routine / Standard / Elevated / Maximum)**

- Assinaturas compostas pós-quânticas: Ed25519 + ML-DSA-65 com vinculação `pq_over_classical`
- SLH-DSA-192f (FIPS 205) como assinatura de reserva baseada em hash
- Cadeias de auditoria de hash duplo: SHA-256 + SHA3-256 para a integridade de longo prazo
- Vinculação de sessão: `session_nonce` em todo artefato para impedir emendas
- Manifesto do bundle: hashes por artefato, raiz de Merkle secundária, acompanhamento dos checkpoints PQ
- Governança de algoritmos: avisos assinados com políticas de resposta automática
- Recuperação de chaves: recuperação social M de N por meio do Shamir Secret Sharing
- Revogação de emergência: tokens de revogação de emergência registrados previamente
- Modo de RPR cego: registros do principal responsável que preservam a privacidade
- Separação de domínio: tags de contexto em todas as assinaturas
- Derivação determinística do kid: `hex(SHA-256(alg || 0x00 || pk))[0:32]`
- Opções de formato de transmissão: JSON (padrão) + CBOR (opcional, de 30 a 40% menor)

**SDKs, integrações e ferramentas**

- 5 SDKs: TypeScript, Python, Go, Rust, WASM
- 10 integrações: Express, FastAPI, LangChain, OpenAI, CrewAI, OpenClaw, W3C DID, Google A2A, Anthropic MCP, AutoGen (cobertura do DCP-01..09)
- JSON Schemas V2: conjunto completo de schemas em `schemas/v2/`
- Vetores de teste KAT do NIST: Known Answer Tests para a conformidade com FIPS 203/204/205
- Testes de interoperabilidade: verificação de bundles entre SDKs
- Pilha do Docker Compose: serviços de verificação, ancoragem, log de transparência e revogação
- Pipelines de CI/CD: testes de conformidade, builds de vários SDKs, workflows de publicação
- Playground: criação e verificação de bundles no navegador, com abas modulares do DCP-01..09, responsivo para celular
- Templates de projeto: projetos iniciais para Express, LangChain, OpenAI e CrewAI
- CLI: `@dcp-ai/cli` interativa com os comandos `dcp-init` e `dcp-ai`
- Reforço do servidor: autenticação e limitação de taxa de nível de produção para os endpoints do DCP-05..09

**Documentação e citação**

- Artigo complementar no Zenodo: [doi.org/10.5281/zenodo.19040913](https://doi.org/10.5281/zenodo.19040913)
- `CITATION.cff`: metadados de citação legíveis por máquina

<a id="changed-1"></a>
<a id="changed_1"></a>

### Alterado

- `human_binding_record` passa a se chamar `responsible_principal_record` (RPR)
- O formato de assinatura muda de `{ alg, public_key_b64, sig_b64 }` para `{ composite_sig: { classical, pq, binding } }`
- O envelope do bundle muda de um `bundle_hash` plano para um `manifest` estruturado
- Os campos numéricos agora são somente inteiros (números de ponto flutuante são proibidos em payloads assinados)
- A verificação passa a ser definida pelo verificador (baseada em políticas)

<a id="fixed-4"></a>
<a id="fixed_4"></a>

### Corrigido

- Provedores PQ do `sdk/py`: importação do módulo ML-DSA-65 e assinatura de `pqc_verify` (`pk`, `sig`, `msg` separados)
- Provedores PQ do `sdk/py`: importação do módulo SLH-DSA-192f e assinatura de `pqc_verify`
- Provedores PQ do `sdk/py`: capturar o valor de retorno de `pqc_verify` (sempre retornava True porque `pqcrypto.verify` retorna um bool em vez de lançar uma exceção)
- Criptografia do `sdk/py`: codificar em base64 a chave secreta Ed25519 em `generate_keypair`
- CI: falhas nos testes de conformidade, de criptografia e de vários SDKs

<a id="backward-compatibility-2"></a>
<a id="backward-compatibility_2"></a>

### Compatibilidade com versões anteriores

- Os verificadores V2 aceitam bundles V1 quando `allow_v1_bundles: true` (padrão)
- Os verificadores V1 rejeitam bundles V2 com uma mensagem de erro clara

---

<a id="pre-release-milestones"></a>

## Marcos anteriores ao lançamento

As datas a seguir marcam a evolução da especificação antes do primeiro lançamento de pacotes. Nenhum pacote foi publicado nesses momentos.

- **2026-01-15**: especificação Genesis congelada (DCP-01, DCP-02, DCP-03)
- **2026-02-28**: especificação normativa V2.0 finalizada (criptografia híbrida pós-quântica, modelo de segurança de 4 níveis, A2A do DCP-04)
- **2026-03-16**: preprint do artigo no Zenodo
- **2026-04-15**: arcabouço constitucional DCP-05..09 incorporado ao `main`
- **2026-04-18**: v2.0.0 lançada no npm, no PyPI e no crates.io

[2.0.0]: https://github.com/dcp-ai-protocol/dcp-ai/releases/tag/v2.0.0
