<sub>[English](../../../../docs/conformance/RELEASE_VALIDATION.md) · [中文](../../../zh-CN/docs/conformance/RELEASE_VALIDATION.md) · [Español](../../../es/docs/conformance/RELEASE_VALIDATION.md) · [日本語](../../../ja/docs/conformance/RELEASE_VALIDATION.md) · **Português**</sub>

<a id="release-validation"></a>

# Validação de publicações

> Tradução informativa da [versão em inglês](../../../../docs/conformance/RELEASE_VALIDATION.md), atualizada em 10/11/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Depois que uma versão é publicada, [`tools/release-validation`](../../../../tools/release-validation/README.md) instala os pacotes publicados a partir de seus registros oficiais, como um consumidor novo faria, e executa os catálogos externos de conformidade contra o que foi instalado. Esta página explica o que isso demonstra, o que foi executado até agora e o que não é coberto. O README da ferramenta é a referência para executá-la.

<a id="what-it-covers"></a>

## O que cobre

As seis versões publicadas em 09/11/2026 ([dossiê de auditoria](../../../../docs/conformance/AUDIT_DOSSIER.md#publication-of-09112026)), por meio de nove lanes:

| Versão publicada | Lanes |
|---|---|
| npm `@dcp-ai/sdk` 2.4.0 | `npm-sdk` |
| npm `@dcp-ai/wasm` 2.2.0 | `npm-wasm-node` (Node) e `npm-wasm-browser` (um Chrome real) |
| npm `@dcp-ai/cli` 2.2.0 | `npm-cli` |
| PyPI `dcp-ai` 2.11.0 | `pypi-wheel` (o wheel) e `pypi-sdist` (o sdist, construído a partir do código-fonte) |
| Módulo Go `sdks/go/v2` v2.14.0 | `go` |
| crates.io `dcp-ai` 2.14.0 | `crates-default` e `crates-otlp` (com a feature `otlp`) |

Cada lane instala seu pacote em um diretório temporário com um ambiente construído para ele, verifica que os bytes baixados são os publicados e que o que é instalado ou compilado são esses bytes, e só então executa a evidência:

- **60 células de catálogo.** Os oito catálogos externos do [kit de conformidade](../../../../tools/conformance/README.md) em seis lanes (o SDK, os dois lanes de Python, Go e os dois lanes de Rust), e os seis que se aplicam à API de WebAssembly em seus dois lanes. O lane da CLI não tem catálogo. São 6142 casos com os catálogos desta revisão.
- **103 casos diretos** da API pública `DcpWasm` no navegador.
- **As quatro suítes da CLI** (218 testes) contra a CLI instalada, e seu controle negativo.
- **58 controles** na mesma execução. Alguns são positivos que devem passar; os demais são cópias alteradas dos relatórios reais, expectativas invertidas, falhas injetadas, prazos esgotados e origens locais, cada um dos quais deve ser recusado da maneira que lhe é exigida.

Não acrescenta nenhum catálogo nem nenhuma expectativa própria. As expectativas são as do kit, versionadas neste repositório.

<a id="what-a-result-means"></a>

## O que um resultado significa

- **PASS** exige tudo o que está acima em uma única execução. Afirma que estes artefatos, com estes hashes, obtidos destes registros, passaram nestes catálogos com o kit nesta revisão e neste ambiente. Não é uma certificação e não diz nada sobre um ambiente que não foi executado.
- **PARTIAL** é uma seleção de lanes ou catálogos sem falhas. É um diagnóstico e nunca é informado como um pass.
- **Uma discrepância** significa que um artefato instalado respondeu e a expectativa versionada não coincide.
- **Um erro** significa que não houve uma resposta válida para julgar: o registro, a rede, um toolchain, uma identidade que não coincide, um relatório incompleto ou que não é desta execução. Um erro nunca conta como uma rejeição do protocolo, nem como um pass.

Instalar um pacote e comprovar de onde ele veio não é conformidade. Apenas as células de catálogo e os blocos são evidência sobre o comportamento.

A ferramenta não muda nada no protocolo: o perfil de canonicalização `dcp-jcs-v1`, o núcleo, os SDKs e os catálogos são usados como estão.

<a id="what-has-been-run"></a>

## O que foi executado

Uma campanha completa, em 10/11/2026, a partir de uma cópia do repositório apenas com seus arquivos públicos:

| Item | Observado |
|---|---|
| Resultado | PASS: 60 células (6142 de 6142 casos), 103 casos diretos, 218 testes da CLI, o controle negativo, 58 controles |
| Modo | `locked` (os locks versionados) |
| Host | macOS em Apple silicon (arm64), Node 22.15.0, npm 11.3.0 |
| Python | CPython 3.12.2, arm64 |
| Go | go1.26.10, que neste host compila `darwin/amd64`: o binário Go validado é amd64 |
| Rust | cargo e rustc 1.93.1, aarch64 |
| Navegador | Google Chrome 157.0.8103.50. Seu user agent é reduzido e não indica qual arquitetura foi executada |
| Relatório | execução `dfeaa975-f449-4947-8238-32bb3f372d87`, SHA-256 de `report.json` `2b5c4c109b76038c693c73ab6485a3a3634949790fd57648637deaf9a23b7ee7` |

O relatório e seus arquivos são mantidos pelos mantenedores; não estão no repositório.

Também foi executado, e não é uma campanha: os dois lanes de Python com o primeiro catálogo em um contêiner Linux x86_64 (Ubuntu 24.04, CPython 3.12.3, emulado no mesmo host), em modo `fresh` e em modo `locked`. É daí que vem o lock de Linux.

**O workflow de CI não foi executado.** `.github/workflows/release-validation.yml` executa a mesma campanha em `ubuntu-24.04` sob demanda; ainda não existe nenhuma execução dele, e nada aqui afirma uma campanha em Linux.

<a id="running-it"></a>

## Como executar

```bash
node --test tools/release-validation/release-validation.test.mjs
node tools/release-validation/run.mjs --python "/path/to/python3.12" --go "/path/to/go" --cargo "$(rustup which cargo)"
```

O primeiro comando não usa rede externa (um teste serve um índice a partir de um servidor HTTP de loopback). O segundo baixa do npm, do PyPI, do proxy do Go e do crates.io, e precisa do Chrome. `--lane` e `--catalog` selecionam uma parte, que termina como PARTIAL. Na CI, inicie manualmente o workflow *Release validation*. Os requisitos, as opções e a estrutura do relatório estão no [README da ferramenta](../../../../tools/release-validation/README.md).

As dependências de terceiros vêm de locks versionados (`locked`, o padrão) ou são resolvidas naquele momento (`fresh`). Os locks de Python existem para CPython 3.12 em macOS arm64 e em Linux x86_64; em qualquer outro interpretador ou plataforma, os lanes de Python precisam de `fresh`.

<a id="not-covered"></a>

## O que não é coberto

- Nenhuma versão além das seis acima, nem nada que não esteja publicado nesses registros: as integrações com frameworks, as imagens Docker, os templates de projeto, os serviços e os contratos.
- Sistemas operacionais, arquiteturas, interpretadores e navegadores que não foram executados. Em particular: nem Windows, nem uma campanha completa em Linux, nem um binário Go para arm64, nem nenhum navegador além do Chrome.
- As ferramentas do próprio host. npm, pip, Go, cargo, rustc, o compilador C e o Chrome são usados como estão e registrados, não fixados.
- As propriedades que os próprios catálogos não cobrem. Seus limites estão no [kit de conformidade](../../../../tools/conformance/README.md) e no [dossiê de auditoria](../../../../docs/conformance/AUDIT_DOSSIER.md#known-limits-and-exclusions).
