<sub>[English](../../../../docs/conformance/AUDIT_DOSSIER.md) · [中文](../../../zh-CN/docs/conformance/AUDIT_DOSSIER.md) · [Español](../../../es/docs/conformance/AUDIT_DOSSIER.md) · [日本語](../../../ja/docs/conformance/AUDIT_DOSSIER.md) · **Português**</sub>

<a id="audit-dossier"></a>

# Dossiê de auditoria

> Tradução informativa da [versão em inglês](../../../../docs/conformance/AUDIT_DOSSIER.md), atualizada em 06/11/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são preservados sem tradução.

Este é o ponto de entrada para uma revisão de segurança independente do DCP-AI. Diz o que revisar, como reproduzir a evidência do repositório, o que essa evidência mostra e o que deixa de fora. Não é uma especificação, uma certificação nem um relatório de auditoria. O repositório não contém nenhum relatório de uma auditoria externa independente e não certifica trabalhos feitos fora dele.

- Os documentos normativos estão em [spec/](../../../../spec/README.md).
- O [mapa de cobertura de segurança](SECURITY_COVERAGE.md) relaciona cada requisito com os seus testes.
- O [guia do implementador](IMPLEMENTER_GUIDE.md) explica como relatar resultados.

<a id="review-baseline"></a>

## Base da revisão

- **Base do código:** o commit `45ac32f07f004e858e11dcc23ff72c3e5c7762b8` da `main`, de 05/11/2026 (#123). Contém todas as correções listadas em [Artefatos](#artifacts) e os esclarecimentos dessa data ao passo V2-10 do [VERIFICATION.md](../../../../spec/VERIFICATION.md) e ao [DCP-09](../../../../spec/DCP-09.md) §3.5.2.
- **Commits posteriores:** o harness diferencial de cadeias de mandatos e a comparação de bundles com cinco SDKs (#124) vieram depois da base, assim como este dossiê. Um documento não pode nomear o seu próprio commit final. Registre o commit exato que revisa e use este arquivo como guia para ele, não como evidência sobre ele.
- **Fora da base:** imagens de contêiner, implantações e configuração do operador.

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
| Publicadas (05/11/2026) | `@dcp-ai/sdk` 2.3.0, `@dcp-ai/wasm` 2.1.3, `dcp-ai` 2.10.2 (PyPI), Go v2.13.0, Rust `dcp-ai` 2.13.0 | Todas as mudanças dos SDKs abaixo |
| Preparadas em 30/10/2026 (#114), nunca publicadas, substituídas | Go v2.12.0, Rust `dcp-ai` 2.12.0, `@dcp-ai/wasm` 2.1.2 | #106 (WASM), #107 e #112; não #103 nem #116 a #119 |
| Publicadas antes (28/10/2026) | `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1, `@dcp-ai/cli` 2.1.1, `dcp-ai` 2.10.1 (PyPI), Go v2.11.1, Rust `dcp-ai` 2.11.1 | As correções do verificador de 26/10/2026 e as verificações secundárias SHA3-256 de 28/10/2026; nenhuma das correções abaixo |

Um número de versão sozinho não identifica um artefato. Os manifestos da `main` levam os números publicados em 05/11/2026; o candidato de 30/10/2026 usou Go e Rust 2.12.0 e `@dcp-ai/wasm` 2.1.2 para menos mudanças, e esses números não são reutilizados. Use os identificadores dos registros abaixo ou os hashes do que você compilou. Os tarballs npm são os arquivos testados antes da publicação; os arquivos do PyPI e o crate foram recompilados a partir da `main` e contêm os mesmos arquivos que os artefatos testados, exceto o `.cargo_vcs_info.json` do crate, que indica `main`. Depois da publicação, em 05/11/2026, os registros públicos foram lidos de novo com TLS normal: as últimas versões eram as acima, com os identificadores abaixo.

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
- **Campanhas diferenciais e de fuzzing.** São finitas, não exaustivas. As entradas que o contrato `/4` não consegue levar a todos os SDKs são medidas à parte ([harnesses diferenciais](../../../../tools/difffuzz/README.md#mandate-chains)).
- **Desempenho.** Nenhum requisito de velocidade é verificado. A [linha de base de desempenho](../../../../tools/conformance/README.md#performance-baseline) e o [escalonamento limitado de cargas](../../../../tools/conformance/README.md#bounded-workload-scaling) são medições locais do método, adicionadas depois do commit de base; nenhuma delas é um resultado de auditoria.
- **Sem cobertura.** Imagens de contêiner, implantações, tokens de serviço e configuração do operador.

<a id="reporting"></a>

## Relato

Relate problemas de segurança como descreve o [SECURITY.md](../../../../SECURITY.md). Ele traz os contatos, o escopo (incluindo reproduções locais limitadas de esgotamento de recursos) e a política de recompensas: as recompensas são caso a caso, sem valor garantido nem fixo.
