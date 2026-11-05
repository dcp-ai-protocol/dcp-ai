<sub>[English](../../../../docs/conformance/AUDIT_DOSSIER.md) · [中文](../../../zh-CN/docs/conformance/AUDIT_DOSSIER.md) · [Español](../../../es/docs/conformance/AUDIT_DOSSIER.md) · [日本語](../../../ja/docs/conformance/AUDIT_DOSSIER.md) · **Português**</sub>

<a id="audit-dossier"></a>

# Dossiê de auditoria

> Tradução informativa da [versão em inglês](../../../../docs/conformance/AUDIT_DOSSIER.md), atualizada em 05/11/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são preservados sem tradução.

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
| Algoritmos | [tests/nist-kat](../../../../tests/nist-kat/README.md): vetores RFC 8032 para Ed25519; testes de tamanho, ida e volta, chave errada e entre SDKs para ML-DSA-65; vetores NIST ACVP, com o SHA-256 dos seus arquivos de origem, para ML-KEM-768 e SLH-DSA-192f. Passar neles não é uma validação NIST de um módulo criptográfico |

<a id="artifacts"></a>

## Artefatos

São três coisas distintas; nunca leia uma como outra.

| Artefato | Versões | O que contém |
|---|---|---|
| Código revisado | `main` na base | Todas as correções abaixo |
| Preparadas, não publicadas (30/10/2026, #114) | Go v2.12.0, Rust `dcp-ai` 2.12.0, `@dcp-ai/wasm` 2.1.2 | #106 (WASM), #107 e #112; não #116 a #119 |
| Publicadas | `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1, `@dcp-ai/cli` 2.1.1, `dcp-ai` 2.10.1 (PyPI), Go v2.11.1, Rust `dcp-ai` 2.11.1 | As correções do verificador de 26/10/2026 e as verificações secundárias SHA3-256 de 28/10/2026; nenhuma das correções abaixo |

Um número de versão sozinho não identifica um artefato. Os manifestos da `main` levam `@dcp-ai/sdk` 2.2.1 e `dcp-ai` 2.10.1, os números publicados, e Go e Rust 2.12.0 e `@dcp-ai/wasm` 2.1.2, os números preparados, junto com mudanças posteriores. Use os identificadores dos registros abaixo ou os hashes do que você compilou. Os registros públicos foram lidos em 05/11/2026 com TLS normal, sem publicar nada; as últimas versões eram as acima.

| Registro | Versão | Identificador |
|---|---|---|
| npm `@dcp-ai/sdk` | 2.2.1 | `sha512-HsT/4BMomZ2QVDfxLWhejoZDzSo8OH8cLT6i6fBTAejt078SyTJRKoLVeIgZp0G29I5JIyoeOPfhebfa7+W9Lw==` |
| npm `@dcp-ai/wasm` | 2.1.1 | `sha512-YUFEAMBnT0J0hZvg1MUS1yvXV0HPotijoj32kIhGDoMVaBhqZKTZvE8iV5h90WRv4duRzJav+PtlQ4fl3NcyQQ==` |
| npm `@dcp-ai/cli` | 2.1.1 | `sha512-Qmuq5FiT+TUW3nZ4HCp/DUXdF6JVYB6vaCmNZL/qK8EWiSpP5gzgesSwK0zzlOQL20SJJditRR0h5YIQ7gxIMw==` |
| PyPI `dcp-ai` | 2.10.1 | wheel `30a1e35bc275b20118ec3e786f3c58336fd72bd21849995bc44ac2e702400a9c`, sdist `e254091491867f122deaff6d6ccc6db6f021d721ff30b1182a4944902b8f2fc5` (SHA-256) |
| crates.io `dcp-ai` | 2.11.1 | `dfb8440a50351491fd7aa81cb5585d8d4f7c130986e504210175b62251f1bc73` (checksum) |
| Go module `sdks/go/v2` | v2.11.1 | tag `sdks/go/v2.11.1`, commit `6f9b453fbaaeb53ead225f77390bf683472be5fa` (28/10/2026) |

Mudanças de SDK na `main` posteriores às versões publicadas:

| Mudança | Commit | SDKs | Publicada |
|---|---|---|---|
| Chaves e isolamento do `VerificationCache` (#103) | `e711179a` | TypeScript | Não |
| `dualMerkleRoot` do WASM segue o V2-11 (#106) | `cac0a5f6` | Rust (feature `wasm`), WASM | Não; preparada |
| `VerifyPayloadHash` verifica o hash normativo com prefixo (#107) | `24e70d56` | Go | Não; preparada |
| `RawAuditEventV2` mantém as entradas de auditoria recebidas (#112) | `6dc97d59` | Go, Rust | Não; preparada |
| Validação de esquemas V2-2 dentro de cada verificador V2 (#116) | `0ebd2849` | TypeScript, Python, Go, Rust, WASM | Não |
| Helpers de validade de mandatos alinhados (#117) | `614b1c56` | TypeScript, Python, Go, Rust | Não |
| Verificações de tempo das cadeias de mandatos alinhadas (#118) | `7619ff95` | TypeScript, Python, Go, Rust | Não |
| Domínios repetidos num mandato raiz isolado rejeitados (#119) | `c154192f` | TypeScript, Python, Go, Rust | Não |

Outras mudanças posteriores às versões publicadas:

- **Log de transparência de referência.** O #120 (`c59ce5ba`) vincula os alertas de gossip à identidade do log testemunhado, e o #122 (`d45c5a7b`) sonda os peers adicionados em execução. Este serviço não é distribuído como pacote.
- **Especificação e kit de conformidade.** O #121 (`0dcbd8dc`) acrescenta o catálogo de delegação. O #123 (`45ac32f0`) acrescenta os esclarecimentos de V2-10 e DCP-09 §3.5.2, o catálogo de políticas 2.0 e o catálogo de delegação 2.0.0. Sem mudanças nos SDKs.
- **Usuários dos registros.** Não recebem nenhuma dessas mudanças até que se publique uma versão que as contenha.

<a id="known-limits-and-exclusions"></a>

## Limites e exclusões conhecidos

- **Registro de auditoria.** [AUDIT-v2.0-FINAL.md](../../../../spec/AUDIT-v2.0-FINAL.md) é um registro histórico interno de 26/02/2026, com uma nota de contexto atual. Não é uma auditoria externa.
- **Provedor HSM simulado.** `HsmCryptoProvider` é um padrão simulado e não deve ser usado para evidência real ([NIST_CONFORMITY.md](../../../../docs/NIST_CONFORMITY.md)).
- **Recuperação de chaves.** As partes não são cifradas com o KEM híbrido.
- **Servidor de referência.** Verifica a estrutura da assinatura de um aviso, não a assinatura ([server/README.md](../../../../server/README.md)).
- **WASM.** Não exporta verificação de cadeias de mandatos.
- **Rust.** Falta-lhe a cifragem de sessão A2A AES-256-GCM e a sua janela de repetição ([RUST_RELEASE.md](../../../../docs/RUST_RELEASE.md)).
- **Versões publicadas.** Não contêm as mudanças de [Artefatos](#artifacts).
- **Campanhas diferenciais e de fuzzing.** São finitas, não exaustivas. As entradas que o contrato `/4` não consegue levar a todos os SDKs são medidas à parte ([harnesses diferenciais](../../../../tools/difffuzz/README.md#mandate-chains)).
- **Desempenho.** Nenhum requisito de velocidade é verificado. A [linha de base de desempenho](../../../../tools/conformance/README.md#performance-baseline) é uma medição local.
- **Sem cobertura.** Imagens de contêiner, implantações, tokens de serviço e configuração do operador.

<a id="reporting"></a>

## Relato

Relate problemas de segurança como descreve o [SECURITY.md](../../../../SECURITY.md). Ele traz os contatos, o escopo (incluindo reproduções locais limitadas de esgotamento de recursos) e a política de recompensas: as recompensas são caso a caso, sem valor garantido nem fixo.
