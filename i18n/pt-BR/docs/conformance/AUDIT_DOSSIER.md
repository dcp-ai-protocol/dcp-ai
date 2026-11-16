<sub>[English](../../../../docs/conformance/AUDIT_DOSSIER.md) · [中文](../../../zh-CN/docs/conformance/AUDIT_DOSSIER.md) · [Español](../../../es/docs/conformance/AUDIT_DOSSIER.md) · [日本語](../../../ja/docs/conformance/AUDIT_DOSSIER.md) · **Português**</sub>

<a id="audit-dossier"></a>

# Dossiê de auditoria

> Tradução informativa da [versão em inglês](../../../../docs/conformance/AUDIT_DOSSIER.md), atualizada em 10/11/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são preservados sem tradução.

Este é o ponto de entrada para uma revisão de segurança independente do DCP-AI. Diz o que revisar, como reproduzir a evidência do repositório, o que essa evidência mostra e o que deixa de fora. Não é uma especificação, uma certificação nem um relatório de auditoria. O repositório não contém nenhum relatório de uma auditoria externa independente e não certifica trabalhos feitos fora dele.

- Os documentos normativos estão em [spec/](../../../../spec/README.md).
- O [mapa de cobertura de segurança](SECURITY_COVERAGE.md) relaciona cada requisito com os seus testes.
- O [guia do implementador](IMPLEMENTER_GUIDE.md) explica como relatar resultados.

<a id="review-baseline"></a>

## Base da revisão

- **Base do código:** o commit `45ac32f07f004e858e11dcc23ff72c3e5c7762b8` da `main`, de 05/11/2026 (#123). Contém todas as correções listadas em [Artefatos](#artifacts) e os esclarecimentos dessa data ao passo V2-10 do [VERIFICATION.md](../../../../spec/VERIFICATION.md) e ao [DCP-09](../../../../spec/DCP-09.md) §3.5.2.
- **Commits posteriores:** o harness diferencial de cadeias de mandatos e a comparação de bundles com cinco SDKs (#124) vieram depois da base, assim como este dossiê. Um documento não pode nomear o seu próprio commit final. Registre o commit exato que revisa e use este arquivo como guia para ele, não como evidência sobre ele.
- **Fora da base:** imagens de contêiner, implantações e configuração do operador.

<a id="pilot-validation-freeze-mp-06"></a>

## Congelamento da validação para pilotos (MP-06)

Este retrato posterior é separado da base de revisão acima. **Fonte:** `7dd8293d6f6c3d328fc0ff3906978200e55139db` (PR #138); árvore `de40444aa1fc1bafef6ab7cf3b772664427b43dc`. É uma validação interna para pilotos delimitados, não uma auditoria externa, uma implantação ou uma nova publicação em registros. `dcp-jcs-v1` e os padrões existentes permanecem inalterados.

O escopo inclui verificação de evidência híbrida, confiança explícita no principal, admissão estrita, admissão delegada opt-in e o reconhecimento separado do mandato em TypeScript, Python, Go e Rust. WASM cobre verificação e primitivas pela API instalada no navegador; **não** oferece cadeias de mandatos, admissão ou ativação. Express e FastAPI são adaptadores opcionais. Autorização de ações, configuração de tenants, atualidade da revogação, TLS e custódia de chaves continuam sob responsabilidade da aplicação ou do operador. Os [limites operacionais](../OPERATIONAL_LIMITS.md) e o [ensaio opcional](../../../../tools/enterprise-rehearsal/README.md) descrevem essa separação.

<a id="evidence-and-artifact-identity"></a>

### Evidência e identidade dos artefatos

O [CI da revisão congelada](https://github.com/dcp-ai-protocol/dcp-ai/actions/runs/42539293814) aprovou os jobs selecionados. Os jobs de SDK e integrações omitidos por filtros de caminhos são cobertos pela revisão MP-03 aprovada `df2df0de103777bb9e28cf70cc64d52f8df7d4b4`, com subárvores de produção e entradas pertinentes de compilação e testes idênticas. São execuções reutilizadas, não novas. Os artefatos instalados localmente foram testados separadamente, incluindo o sdist Python e o tarball WASM no navegador. Os oito catálogos públicos passaram em cada SDK completo; WASM passou somente nos seis que suporta. Os controles específicos de composição, reconhecimento e ingresso de bytes, as regressões originais F1–F4 e de confiança no principal, e a evidência dos provedores mantêm o vínculo com os objetos realmente testados. O ensaio HTTP MP-05 inalterado (200/200 etapas) é reutilizado.

Os artefatos abaixo são **bytes locais não publicados**, embora suas versões internas coincidam com versões existentes. Os de TS, Express e Python vieram de `b3d41bd0`; os 256 arquivos-fonte registrados no manifesto de preparação coincidem com a revisão congelada. Go, Rust e WASM foram construídos a partir da exportação congelada. Não os substitua por pacotes do registro com o mesmo número de versão.

| Artefato | Versão local | SHA-256 |
|---|---|---|
| `Go module zip` | `v2.13.0` | `a2e113c663b791c3b0908e135f2a1e2433ffea1301b1be2540a2fa3539c6ca41` |
| `Rust .crate` | `2.13.0` | `192d58c182e9c115b5fa7e6af17dd790eaa37a68a4501e4985dc11ae5b157d39` |
| `@dcp-ai/wasm tarball` | `2.1.3` | `501d24d7ae9a2923931edf4e9e8df902f353a87ff911906901f34b33d1ac052d` |
| `@dcp-ai/sdk tarball` | `2.3.0` | `1e4b27bb82c70ab327227f5bb029eb2b01b0cdc643aeec206327bdaf5a94dd9c` |
| `@dcp-ai/express tarball` | `2.1.0` | `bf2b6de539b9e3687ffd272c7015d9ff0a6288fdd65f86ce7662838b50ead969` |
| `Python wheel` | `2.10.2` | `e20473aecf6f75ff6e01db4a9ce12bd33ef59000607b9cba47f197b4b2e8d317` |
| `Python sdist` | `2.10.2` | `ad0e17c7850916777a5df379c6217e16eb1fcc82b2b465b53624c9eb985919fa` |


Go foi consumido por um proxy local de arquivos sem `replace`; Rust por uma dependência de caminho ao `.crate` extraído; npm e Python por pacotes instalados. A validação Go usou o toolchain corrigido 1.26.10, sem alterar o módulo ou as dependências. Para um piloto, preserve os artefatos exatos, inventário de dependências, comandos e relatórios: um hash identifica bytes, mas não torna artefatos temporários disponíveis para download. Uma reconstrução exige verificação e novos testes; a reprodutibilidade dos bytes WASM não foi estabelecida. A reprodução pública começa no [kit de conformidade](../../../../tools/conformance/README.md) e nas [instruções do ensaio](../../../../tools/enterprise-rehearsal/README.md), com revisão explícita e caminhos dos pacotes instalados. Esta página resume evidência interna; não afirma que cada sonda local seja uma ferramenta de testes publicada.

<a id="limits-and-remaining-release-work"></a>

### Limites e trabalho antes da publicação

- O tarball Express congelado não contém `LICENSE`; inclua a licença antes de distribuí-lo. O binário WASM local contém um caminho do cache de compilação; remapeie os caminhos e revise os bytes reconstruídos antes da publicação. Nenhum dos dois é oferecido aqui como download de uma versão publicada.
- A revisão de dependências é um retrato datado, não uma garantia. O grafo OTLP opcional de Rust seleciona versões de `anyhow`/`tokio` com os avisos [RUSTSEC-2026-0190](https://osv.dev/vulnerability/RUSTSEC-2026-0190) e [RUSTSEC-2026-0386](https://osv.dev/vulnerability/RUSTSEC-2026-0386); as compilações padrão e WASM não selecionam esses crates. Este congelamento não valida OTLP, que exige correção separada das dependências antes do uso.
- Os alertas CodeQL #58/#59 continuam abertos em um autoteste de conformidade; a triagem encontrou interpolação de um hash hexadecimal de corpus fixo, não um caminho remoto de produção demonstrado. Dependabot não mostrou alertas abertos. A API de secret scanning estava indisponível: isso é falta de cobertura, não zero achados.
- As exclusões anteriores do dossiê permanecem: contradições não resolvidas da especificação, extensões opcionais, infraestrutura do operador e ambientes não testados não passam a ter suporte por este congelamento. Testes finitos não demonstram ausência de vulnerabilidades.
- Correções de empacotamento, novas versões, verificações de instalação pelos registros e autorização explícita de publicação ainda são necessárias para lançar as mudanças posteriores à base. Imagens e implantações exigem validação própria. Integrar documentação não publica pacotes.

> **Nota (09/11/2026).** Os itens acima descrevem o snapshot do MP-06 e seus artefatos locais, que não mudam. Para as versões publicadas em 09/11/2026, o remapeamento de caminhos do WASM, o `LICENSE` da CLI e os mínimos do OTLP já estão resolvidos; veja [Publicação de 09/11/2026](#publication-of-09112026). `@dcp-ai/express` 2.1.0 não foi republicado.

<a id="publication-of-09112026"></a>

## Publicação de 09/11/2026

**Fonte:** `main` em `cdb7099b8b6dc2a78b54928250752fd0bbd9c770` ([PR #140](https://github.com/dcp-ai-protocol/dcp-ai/pull/140)), árvore `af69307b663381ce776ad3115f76fe82f225a789`, a árvore do export revisado dos candidatos. A [CI desse commit](https://github.com/dcp-ai-protocol/dcp-ai/actions/runs/42557635924) passou, assim como os workflows de publicação que recompilaram e publicaram os arquivos do [PyPI](https://github.com/dcp-ai-protocol/dcp-ai/actions/runs/42559171389) e do [crates.io](https://github.com/dcp-ai-protocol/dcp-ai/actions/runs/42559174109); essas execuções são verificações do próprio projeto, não uma auditoria externa. A partir dele foram publicadas seis versões: `@dcp-ai/sdk` 2.4.0, `@dcp-ai/wasm` 2.2.0 e `@dcp-ai/cli` 2.2.0 no npm, `dcp-ai` 2.11.0 no PyPI, Rust `dcp-ai` 2.14.0 no crates.io e o módulo Go v2.14.0. É uma publicação em registros após validação interna, não uma auditoria externa nem uma certificação. `@dcp-ai/express` 2.1.0 e os outros adaptadores npm não foram republicados.

| Registro | Versão | Identificador |
|---|---|---|
| npm `@dcp-ai/sdk` | 2.4.0 | `sha512-4IsY/ctFqLf5vvOS6bWUdN63NCbMoi6N0qnAceYG8AINnqm7+cRyG5stO+P4ZM8ROM2uyhI09AlcQDhdJVhIeQ==` |
| npm `@dcp-ai/wasm` | 2.2.0 | `sha512-eu9NiNXl99hCKz/xpUPteaZGF+ea0+WTQ/6mZu2RIkuP2eTMsym0Bbp7gTbqB1LaaGMGuRFYAjK8wSVIGt/AAA==` |
| npm `@dcp-ai/cli` | 2.2.0 | `sha512-/UR5K7/PctZX8Do6CULz1ua1eEwt19Jo/Q/adkMq806uRjZ2gh10W0FnfrzJVJPjskadK/tma2aXisU+z1Hx7Q==` |
| PyPI `dcp-ai` | 2.11.0 | wheel `2e7776e1c3675f9f4a3c088d6115b728d6e33c72c69a2e624b1771ab9fa45f53`, sdist `9d4a545376e2a9a0afa61b0845ef5bf992b9c92ac5390da95a35333327397da7` (SHA-256) |
| crates.io `dcp-ai` | 2.14.0 | `704028282d977973fc84e6fbaa495159e43ecec5951cf2f1b5ea9d3e70515424` (checksum) |
| Módulo Go `sdks/go/v2` | v2.14.0 | tag `sdks/go/v2.14.0`, commit `cdb7099b8b6dc2a78b54928250752fd0bbd9c770`, `h1:9O4n7vn3YqOhKlyUg/cm0OnouQi4QbU7mHbIh1BM5Z8=` |

- **Identidade com os artefatos testados.** Os tarballs npm são os arquivos testados antes da publicação, com a mesma integridade `sha512`. O wheel e o sdist do PyPI e o crate foram recompilados a partir da `main` pelos workflows de publicação e contêm os mesmos arquivos-fonte que os artefatos testados; os arquivos Python diferem apenas nos metadados (Metadata-Version 2.5 e hatchling 1.33.0 em vez de 2.4 e 1.27.0, com o RECORD recalculado), e o crate adiciona `.cargo_vcs_info.json`, que indica a `main`. O módulo Go que o proxy serve tem os mesmos 106 arquivos e o mesmo `h1` que o módulo testado; só a compressão do zip difere.
- **Instalado a partir dos registros.** Consumidores novos instalaram cada pacote por nome e versão, sem `file:`, dependências por caminho, `replace`, `[patch]` nem overrides: o wheel e o sdist do PyPI (o sdist compilado pelo pip), o crate com suas features padrão e `otlp`, o SDK, a CLI e o WASM do npm com `@dcp-ai/express` 2.1.0, que resolveu o único `@dcp-ai/sdk` 2.4.0, e o módulo Go por `proxy.golang.org` com o banco de dados de checksums ativo e Go 1.26.10. As verificações de composição, confirmação, ingresso e P-ED-1, as suítes da CLI e as verificações do WASM deram os mesmos resultados que nos artefatos testados.
- **Validação de publicações.** [RELEASE_VALIDATION.md](../../../../docs/conformance/RELEASE_VALIDATION.md) descreve a ferramenta que repete esta instalação a partir dos registros e executa os catálogos externos contra os pacotes instalados, e registra as campanhas completas locais no macOS e do GitHub no Ubuntu 24.04 de 10/11/2026. É uma verificação do próprio projeto, não uma auditoria externa.
- **Itens de empacotamento do congelamento MP-06.** Para estas versões, o binário do WASM é compilado sem caminhos locais de compilação e uma barreira de publicação verifica os arquivos empacotados, `@dcp-ai/cli` inclui `LICENSE`, e a feature `otlp` do Rust exige `anyhow` 1.0.103 e `tokio` 1.53.3 ou posteriores; os builds padrão e `wasm` não selecionam nenhum dos dois. O `LICENSE` adicionado a `integrations/express` está apenas no repositório: o tarball publicado de `@dcp-ai/express` 2.1.0 continua sem ele.
- **Não coberto.** As exclusões do congelamento MP-06 acima e de [Limites e exclusões conhecidos](#known-limits-and-exclusions) continuam valendo, exceto os itens de empacotamento e dependências fechados aqui para estas versões: os caminhos de compilação do WASM, o `LICENSE` da CLI e os mínimos do OTLP. O snapshot do MP-06 acima é mantido como foi registrado. Verificações finitas não estabelecem a ausência de vulnerabilidades.

<a id="reproduce"></a>

## Reproduzir

A partir de um checkout do commit revisado, com Node 22, Python 3.10+, Go (a versão de `sdks/go/go.mod`) e um toolchain estável de Rust (com `wasm32-unknown-unknown` e wasm-pack para WASM). As instalações usam os locks versionados onde existem. O SDK de Python não tem nenhum: `pip install -e ".[dev]"` resolve as versões disponíveis no momento da instalação.

Na base:

```bash
(cd sdks/typescript && npm ci && npm run build && npm test) && npm ci --ignore-scripts
npm run conformance
(cd sdks/python && pip install -e ".[dev]" && pytest)
(cd sdks/go && go test ./...)
(cd sdks/rust && cargo test --locked)
(cd sdks/wasm && npm ci && npm run build && npm test)
node tools/conformance/wrappers/build.mjs all
node tools/conformance-external.js --catalog evidence --assessment verdict --report /tmp/evidence-ts.json -- node tools/conformance/wrappers/ts-sdk.mjs --sdk sdks/typescript/dist/index.js
node tools/conformance-external.js --catalog delegation --report /tmp/delegation-ts.json -- node tools/conformance/wrappers/ts-sdk.mjs --sdk sdks/typescript/dist/index.js
```

Só a partir do #124 (estes comandos não existem na base):

```bash
node tools/difffuzz/run.mjs --sdks five --iterations 60 --report /tmp/difffuzz-five.json
node tools/difffuzz/run-mandates.mjs --iterations 120 --report /tmp/mandates.json
```

- **O que um pass mostra.** Uma execução mostra que esses casos passam com o argv executado, nada mais.
- **WASM.** `npm test` em `sdks/wasm` compila só a camada TypeScript e precisa de `pkg/dcp_ai_bg.wasm`, que `npm run build` produz.
- **Mais comandos.** O [kit de conformidade](../../../../tools/conformance/README.md) lista todos os catálogos e os seus wrappers; os [harnesses diferenciais](../../../../tools/difffuzz/README.md) listam os seus limites.
- **Execuções de referência.** A CI executa as mesmas suítes em `.github/workflows/ci.yml` e `difffuzz.yml`.

<a id="record-what-you-ran"></a>

## Registre o que executou

- **Código.** O commit exato (`git rev-parse HEAD`) e se a árvore de trabalho difere dele (`git status --porcelain`, e `git diff` se diferir).
- **Toolchains e artefatos.** As versões dos toolchains, e as versões e hashes dos artefatos executados: o `dist` do TypeScript, os binários compilados, o pacote WASM e os pacotes de Python resolvidos (`python -m pip freeze`). O kit e os harnesses diferenciais registram a maioria nos seus relatórios.
- **Relatórios.** Guarde os arquivos de relatório com os seus hashes.
- **Proveniência.** O nome e a versão de `implementation` que um wrapper declara num relatório são a sua própria declaração, não uma proveniência autenticada; a evidência são os hashes do que você compilou e executou.

<a id="what-to-review"></a>

## O que revisar

| Camada | Caminhos | O que um pass não estabelece |
|---|---|---|
| Núcleo do protocolo e perfis | `spec/`, `schemas/`; canonicalização `dcp-jcs-v1` | Texto normativo; `dcp-jcs-v2` é experimental e opt-in, nunca padrão |
| Verificadores dos SDKs | `sdks/typescript`, `sdks/python`, `sdks/go`, `sdks/rust`, `sdks/wasm` | Um bundle verificado não é confiança no principal, admissão nem autorização; cada uma é uma API à parte ([ADMISSION.md](../../../../docs/ADMISSION.md)) |
| Ferramentas de conformidade e diferenciais | `tools/conformance`, `tools/difffuzz`, `tests/` | Infraestrutura de testes, não parte do protocolo |
| Serviços de referência | `server/`, `services/` (ancoragem, log de transparência, revogação) | Escolhas de implantação, não normativas; os verificadores funcionam sem eles |
| Adaptadores e geradores | `integrations/`, `packages/`, a integração FastAPI do SDK Python | Opcionais; algumas versões publicadas são afetadas ([SECURITY.md](../../../../SECURITY.md#supported-versions)) |
| Operador | Chaves, âncoras de confiança, configuração de admissão, tokens de serviço, implantações | O repositório não dá nenhuma garantia sobre eles |

<a id="requirements-to-tests"></a>

## Requisitos e testes

| Área | Onde é mapeada |
|---|---|
| Verificação V2, de V2-1 a V2-14 | [Mapa de verificação V2](SECURITY_COVERAGE.md#v2-verification-map), com a sua [fronteira de esquemas](SECURITY_COVERAGE.md#schema-and-cryptographic-api-boundary) |
| Política do verificador, incluindo o esclarecimento de V2-10 | [Amostras de política do verificador](SECURITY_COVERAGE.md#verifier-policy-samples) |
| Regras estruturais | [Amostras estruturais](SECURITY_COVERAGE.md#structural-samples) |
| Admissão e `strict-v1` | [Mapa de admissão](SECURITY_COVERAGE.md#admission-map) |
| Cadeias de mandatos DCP-09 | [Mapa de delegação](SECURITY_COVERAGE.md#delegation-map) |
| Concordância entre SDKs | [Amostras diferenciais](SECURITY_COVERAGE.md#differential-samples) |
| Algoritmos | [tests/nist-kat](../../../../tests/nist-kat/README.md): vetores RFC 8032 para Ed25519; testes de tamanho, ida e volta, chave errada e entre SDKs para ML-DSA-65, e 204 casos de verificação com contexto vazio (NIST ACVP tc39 e 203 casos do C2SP Wycheproof, que não é uma fonte NIST) nos quatro SDKs e em wasm32; vetores NIST ACVP, com o SHA-256 dos seus arquivos de origem, para ML-KEM-768 e SLH-DSA-192f. Passar neles não é uma validação NIST de um módulo criptográfico |

<a id="artifacts"></a>

## Artefatos

São três coisas distintas; nunca leia uma como outra.

| Artefato | Versões | O que contém |
|---|---|---|
| Código revisado | `main` na base | Todas as correções abaixo |
| Publicadas (09/11/2026) | `@dcp-ai/sdk` 2.4.0, `@dcp-ai/wasm` 2.2.0, `@dcp-ai/cli` 2.2.0, `dcp-ai` 2.11.0 (PyPI), Go v2.14.0, Rust `dcp-ai` 2.14.0 | Todas as mudanças dos SDKs abaixo, mais P-ED-1 e as APIs de admissão delegada de adesão explícita ([Publicação de 09/11/2026](#publication-of-09112026)) |
| Publicadas (05/11/2026) | `@dcp-ai/sdk` 2.3.0, `@dcp-ai/wasm` 2.1.3, `dcp-ai` 2.10.2 (PyPI), Go v2.13.0, Rust `dcp-ai` 2.13.0 | Todas as mudanças dos SDKs abaixo |
| Preparadas em 30/10/2026 (#114), nunca publicadas, substituídas | Go v2.12.0, Rust `dcp-ai` 2.12.0, `@dcp-ai/wasm` 2.1.2 | #106 (WASM), #107 e #112; não #103 nem #116 a #119 |
| Publicadas antes (28/10/2026) | `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1, `@dcp-ai/cli` 2.1.1, `dcp-ai` 2.10.1 (PyPI), Go v2.11.1, Rust `dcp-ai` 2.11.1 | As correções do verificador de 26/10/2026 e as verificações secundárias SHA3-256 de 28/10/2026; nenhuma das correções abaixo |

Um número de versão sozinho não identifica um artefato. Os manifestos da `main` levam os números publicados em 09/11/2026; o candidato de 30/10/2026 usou Go e Rust 2.12.0 e `@dcp-ai/wasm` 2.1.2 para menos mudanças, e esses números não são reutilizados. Use os identificadores dos registros abaixo ou os hashes do que você compilou. Para as versões de 05/11/2026, os tarballs npm são os arquivos testados antes da publicação; os arquivos do PyPI e o crate foram recompilados a partir da `main` e contêm os mesmos arquivos que os artefatos testados, exceto o `.cargo_vcs_info.json` do crate, que indica `main`. Depois da publicação, em 05/11/2026, os registros públicos foram lidos de novo com TLS normal: as últimas versões eram as acima, com os identificadores abaixo.

| Registro | Versão | Identificador |
|---|---|---|
| npm `@dcp-ai/sdk` | 2.3.0 | `sha512-5IsrDMKE3NM8e5jVLFIaigNFHIni/aIzD9Q4zNYZu6sTLfsPk/zqRxi9ccjtGSTiaftTba3LD/1JA4Gi0uS1bw==` |
| npm `@dcp-ai/wasm` | 2.1.3 | `sha512-ToL7ZE+8mEvKJCO5DXxJm+GS2nrQ2tInHYJn+cWqLWxT+eMss9ka9MVp30LNmopO+MTqgwBs1hmAy6TOI5wDIA==` |
| npm `@dcp-ai/cli` | 2.1.1 | `sha512-Qmuq5FiT+TUW3nZ4HCp/DUXdF6JVYB6vaCmNZL/qK8EWiSpP5gzgesSwK0zzlOQL20SJJditRR0h5YIQ7gxIMw==` |
| PyPI `dcp-ai` | 2.10.2 | wheel `825de9d6dce5ec2737d38534e7c3d357edbded437912605a549cde75518f198b`, sdist `6005f342a0a24bee331c30be2fb2bc89a1306a21de399051cd1cef3cc96297e4` (SHA-256) |
| crates.io `dcp-ai` | 2.13.0 | `579f070ad23c531147ef91287d610c6dc317bef997e2791a24a5070a4c0c13a1` (checksum) |
| Go module `sdks/go/v2` | v2.13.0 | tag `sdks/go/v2.13.0`, commit `46b142bd7e42601acd912f156bbfcd9f5204a4be` (05/11/2026), `h1:bRkqSUWHQ/qTywPmKWRdzg2bBWI0RG1ZZAlb6IafnyU=` |

Mudanças de SDK posteriores às versões de 28/10/2026, publicadas em 05/11/2026:

| Mudança | Commit | SDKs | Publicada |
|---|---|---|---|
| Chaves e isolamento do `VerificationCache` (#103) | `e711179a` | TypeScript | Sim, 05/11/2026 |
| `dualMerkleRoot` do WASM segue o V2-11 (#106) | `cac0a5f6` | Rust (feature `wasm`), WASM | Sim, 05/11/2026 (preparada em 30/10/2026) |
| `VerifyPayloadHash` verifica o hash normativo com prefixo (#107) | `24e70d56` | Go | Sim, 05/11/2026 (preparada em 30/10/2026) |
| `RawAuditEventV2` mantém as entradas de auditoria recebidas (#112) | `6dc97d59` | Go, Rust | Sim, 05/11/2026 (preparada em 30/10/2026) |
| Validação de esquemas V2-2 dentro de cada verificador V2 (#116) | `0ebd2849` | TypeScript, Python, Go, Rust, WASM | Sim, 05/11/2026 |
| Helpers de validade de mandatos alinhados (#117) | `614b1c56` | TypeScript, Python, Go, Rust | Sim, 05/11/2026 |
| Verificações de tempo das cadeias de mandatos alinhadas (#118) | `7619ff95` | TypeScript, Python, Go, Rust | Sim, 05/11/2026 |
| Domínios repetidos num mandato raiz isolado rejeitados (#119) | `c154192f` | TypeScript, Python, Go, Rust | Sim, 05/11/2026 |

Outras mudanças posteriores às versões de 28/10/2026:

- **Log de transparência de referência.** O #120 (`c59ce5ba`) vincula os alertas de gossip à identidade do log testemunhado, e o #122 (`d45c5a7b`) sonda os peers adicionados em execução. Este serviço não é distribuído como pacote.
- **Especificação e kit de conformidade.** O #121 (`0dcbd8dc`) acrescenta o catálogo de delegação. O #123 (`45ac32f0`) acrescenta os esclarecimentos de V2-10 e DCP-09 §3.5.2, o catálogo de políticas 2.0 e o catálogo de delegação 2.0.0. Sem mudanças nos SDKs.
- **Usuários dos registros.** As mudanças dos SDKs da tabela acima chegam a eles com as versões de 05/11/2026; as versões anteriores mantêm os limites indicados aqui. O log de transparência, a especificação e o kit de conformidade não fazem parte desses pacotes: são usados a partir do repositório.

<a id="known-limits-and-exclusions"></a>

## Limites e exclusões conhecidos

- **Registro de auditoria.** [AUDIT-v2.0-FINAL.md](../../../../spec/AUDIT-v2.0-FINAL.md) é um registro histórico interno de 26/02/2026, com uma nota de contexto atual. Não é uma auditoria externa.
- **Nenhum provedor HSM.** O `HsmCryptoProvider` simulado foi removido do código TypeScript em 06/11/2026; nenhum SDK tem um provedor HSM, o servidor de referência anuncia `hsm_provider: false` e `dcp audit gaps` mantém a lacuna nº 11 aberta ([NIST_CONFORMITY.md](../../../../docs/NIST_CONFORMITY.md)).
- **Recuperação de chaves.** As partes não são cifradas com o KEM híbrido.
- **Servidor de referência.** Verifica a estrutura da assinatura de um aviso, não a assinatura ([server/README.md](../../../../server/README.md)).
- **WASM.** Não exporta verificação de cadeias de mandatos.
- **Rust.** Falta-lhe a cifragem de sessão A2A AES-256-GCM e a sua janela de repetição ([RUST_RELEASE.md](../../../../docs/RUST_RELEASE.md)).
- **Versões publicadas antes de 05/11/2026.** Não contêm as mudanças de [Artefatos](#artifacts).
- **Versões publicadas antes de 09/11/2026.** Não contêm P-ED-1 (exceto onde a build oficial do PyNaCl usada pelo SDK Python já rejeitava essas assinaturas) nem as APIs de admissão delegada de adesão explícita.
- **Campanhas diferenciais e de fuzzing.** São finitas, não exaustivas. As entradas que o contrato `/4` não consegue levar a todos os SDKs são medidas à parte ([harnesses diferenciais](../../../../tools/difffuzz/README.md#mandate-chains)).
- **Desempenho.** Nenhum requisito de velocidade é verificado. A [linha de base de desempenho](../../../../tools/conformance/README.md#performance-baseline) e o [escalonamento limitado de cargas](../../../../tools/conformance/README.md#bounded-workload-scaling) são medições locais do método, adicionadas depois do commit de base; nenhuma delas é um resultado de auditoria.
- **Sem cobertura.** Imagens de contêiner, implantações, tokens de serviço e configuração do operador.

<a id="reporting"></a>

## Relato

Relate problemas de segurança como descreve o [SECURITY.md](../../../../SECURITY.md). Ele traz os contatos, o escopo (incluindo reproduções locais limitadas de esgotamento de recursos) e a política de recompensas: as recompensas são caso a caso, sem valor garantido nem fixo.
