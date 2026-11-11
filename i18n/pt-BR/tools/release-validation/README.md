<sub>[English](../../../../tools/release-validation/README.md) · [中文](../../../zh-CN/tools/release-validation/README.md) · [Español](../../../es/tools/release-validation/README.md) · [日本語](../../../ja/tools/release-validation/README.md) · **Português**</sub>

<a id="release-validation"></a>

# Validação de publicações

> Tradução informativa da [versão em inglês](../../../../tools/release-validation/README.md), atualizada em 10/11/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Instala os pacotes DCP publicados a partir de seus registros oficiais em consumidores temporários,
verifica sua identidade e sua origem e executa o kit externo de conformidade já existente
([`tools/conformance`](../../../../tools/conformance/README.md)) contra o que foi instalado. Não
acrescenta nenhum catálogo, oráculo ou modelo de conformidade. O guia para leitores é
[docs/conformance/RELEASE_VALIDATION.md](../../../../docs/conformance/RELEASE_VALIDATION.md); este arquivo
é a referência para executar e manter a ferramenta.

Um PASS afirma apenas isto: estes artefatos, com estes hashes, obtidos destes registros, passaram
nestes catálogos com o kit nesta revisão e neste ambiente. Não é uma certificação e não cobre nada que
não tenha sido executado.

```
node tools/release-validation/run.mjs [--list] [--lane <id>]... [--catalog <id>]...
                                      [--resolution locked|fresh] [--work <dir>] [--clean]
                                      [--python <exe>] [--go <exe>] [--cargo <exe>] [--chrome <exe>]
node --test tools/release-validation/release-validation.test.mjs     # no external network
```

| Saída | Significado |
|---|---|
| 0 | PASS: todos os lanes, todas as células de catálogo (60), todos os blocos (3) e todos os controles |
| 1 | uma discrepância: um artefato respondeu e a expectativa versionada não coincide |
| 2 | uso |
| 3 | erro: de infraestrutura, de identidade, não suportado, incompleto ou de implementação |
| 4 | PARTIAL: uma seleção sem falhas. Um diagnóstico, nunca uma validação |

Um erro nunca conta como rejeição e prevalece sobre uma discrepância. Instalar um pacote e comprovar
sua origem não é conformidade: apenas as células e os blocos são.

Os testes não usam rede externa; um deles serve um índice de pacotes a partir de um servidor HTTP de
loopback.

<a id="requirements"></a>

## Requisitos

Node 20 ou posterior em um host POSIX, com o `npm` que está ao lado de `node`, `/bin/ps`, `/usr/bin/tar` e, para o lane de Go, `/usr/bin/unzip`. Apenas módulos integrados do Node.

Python, Go, Rust e Chrome são ferramentas do host: o caminho indicado com `--python`, `--go`, `--cargo` ou `--chrome`, ou o primeiro `python3`, `go` ou `cargo` no `PATH` próprio da ferramenta (o diretório de `node`, `/usr/bin`, `/bin`) e o Chrome habitual da plataforma. Nada é instalado, atualizado ou trocado: `GOTOOLCHAIN=local`, e um proxy do rustup é recusado; portanto, passe o cargo do próprio toolchain (`rustup which cargo`), que deve ter `rustc` ao lado. O Python deve ser 3.11 ou posterior (o lane sdist em modo `fresh` lê `pyproject.toml` com `tomllib`); os locks versionados são para CPython 3.12.

## Lanes

| Lane | Artefato publicado | Evidência |
|---|---|---|
| `npm-sdk` | npm `@dcp-ai/sdk` 2.4.0 | 8 catálogos |
| `npm-wasm-node` | npm `@dcp-ai/wasm` 2.2.0, no Node | 6 catálogos |
| `npm-wasm-browser` | o mesmo pacote, API pública em um Chrome real | 6 catálogos e o bloco `direct-sections` (103 casos) |
| `npm-cli` | npm `@dcp-ai/cli` 2.2.0 | sem catálogo: os blocos `cli-suites` (218 testes) e `cli-negative-control` |
| `pypi-wheel` | PyPI `dcp-ai` 2.11.0, wheel | 8 catálogos |
| `pypi-sdist` | PyPI `dcp-ai` 2.11.0, sdist, construído aqui | 8 catálogos |
| `go` | módulo Go `sdks/go/v2` v2.14.0 | 8 catálogos |
| `crates-default` | crates.io `dcp-ai` 2.14.0, features padrão | 8 catálogos |
| `crates-otlp` | o mesmo crate com a feature `otlp` | 8 catálogos |

Seis versões publicadas e nove lanes. Seis lanes executam 8 catálogos e os dois lanes de WebAssembly
executam 6: 60 células de catálogo, mais 3 blocos. `manifest.json` contém as identidades esperadas (as do dossiê de auditoria), os catálogos e os lanes; `expected-blocks.json`
contém os identificadores que cada bloco deve informar.

<a id="what-a-run-does"></a>

## O que uma execução faz

1. **Diretório de trabalho.** Um diretório `mkdtemp` novo, ou `--work <dir>`, que não deve existir e
   deve estar fora do checkout. Nada é reutilizado.
2. **Ambiente.** Cada subprocesso recebe um ambiente construído pela ferramenta. `HOME`, `TMPDIR`, os
   caches e as configurações de cada gerenciador de pacotes ficam dentro do diretório de trabalho. O
   `PATH` não: é a lista curta, própria da ferramenta, de diretórios do host (o diretório de `node`, `/usr/bin`, `/bin` e o diretório de um toolchain indicado por opção). Nada é herdado: nem
   credenciais, nem proxy, nem configuração do usuário ou do projeto.
3. **Instalação, identidade e origem**, por ecossistema (abaixo). Para cada pacote, três valores devem
   coincidir: o do manifesto, o hash que a ferramenta calcula sobre os bytes baixados e o que o
   gerenciador de pacotes ou o registro grava. O arquivo baixado deve ser igual, arquivo por arquivo e
   nos dois sentidos, ao que é instalado ou compilado, exceto os poucos arquivos que um instalador
   escreve por conta própria, nomeados abaixo.
4. **Células.** Uma execução do runner do kit por lane e catálogo, com o wrapper do próprio kit
   apontando para o pacote instalado. Um relatório só conta se for desta execução: um caminho que não
   existia, uma execução dentro do intervalo observado com um identificador ainda não visto, o argv,
   `kit.catalog_sha256`, os hashes dos fixtures, as suítes e os identificadores de caso que foram
   pedidos, e um status coerente com o código de saída do runner. Cada caso deve ter um status que sua
   classe permita, e as contagens de cada suíte e do relatório (incluindo `executed`) devem ser as dos
   casos.
5. **Blocos.** A evidência que não é uma célula de catálogo (as suítes da CLI, seu controle negativo, as
   seções diretas do navegador) é um bloco do seu lane. A campanha exige cada bloco exatamente uma vez,
   como uma célula: a instalação ou o status de um lane nunca o substituem.
6. **Controles**, na mesma execução. Cada lane que traz controles (`npm-sdk`, `npm-cli`, `npm-wasm-browser`) deve o seu próprio conjunto fixo sempre que é selecionado: exatamente um resultado com `ok === true` para cada identificador e nenhum outro, ou a campanha é um erro. Alguns são positivos que devem passar. Os demais são cópias alteradas das saídas reais (resultados ausentes, duplicados e desconhecidos, relatórios antigos, contagens incoerentes, identidades alteradas e origens locais) e execuções reais (uma expectativa invertida que deve falhar, falhas do wrapper e do harness, prazos esgotados, um processo deixado para trás, uma execução do navegador interrompida de fora), cada um dos quais deve ser recusado da maneira que lhe é exigida.
7. **Relatório.** `report.json` no diretório de trabalho, com os relatórios do runner, as saídas dos blocos, os logs, os arquivos baixados e os locks. Tudo é mantido; `--clean` remove apenas os
   consumidores instalados e os caches desta execução.

Um processo só conta como executado se todas as suas observações estiverem limpas (sem sinal, sem
prazo esgotado, sem limite de saída, sem deixar nada para trás); o código de saída 0 sozinho não basta.
Cada fase tem um prazo, e o supervisor interrompe toda a árvore de processos, quaisquer que sejam seus
grupos de processos.

### npm (`npm-sdk`, `npm-wasm-node`, `npm-wasm-browser`, `npm-cli`)

Um único consumidor (`consumers/npm`) com os três pacotes em versões exatas e um lock. Verificação estática do consumidor e do lock (versões exatas, todas as entradas de `registry.npmjs.org` com integridade sha512, sem links, cada pacote DCP uma única vez); `npm pack` em um cache vazio, com o hash calculado pela ferramenta; `npm ci --ignore-scripts` (`locked`) ou `npm install --ignore-scripts` (`fresh`); e depois o arquivo contra a árvore instalada.

`@dcp-ai/wasm` 2.2.0 contém `pkg/package.json` com o nome e a versão do crate Rust a partir do qual foi compilado (`dcp-ai` 2.14.0). O relatório registra as duas identidades e nunca espera que sejam iguais.

- **`npm-cli`.** As quatro suítes de `cli/__tests__` e o `negative-control.mjs` do kit são executados contra a CLI instalada (`DCP_CLI_ROOT`): seu binário, seu `lib/` e suas dependências tal como o npm as instalou. Antes, a ferramenta verifica que a CLI instalada carregaria o único `@dcp-ai/sdk`
  verificado. O veredito do próprio controle negativo não é aceito sem verificação: sua saída deve
  mostrar exatamente os quatro casos invertidos falhando, cada um em uma asserção, e os outros 214
  passando.
- **`npm-wasm-browser`.** O `wasm-browser.mjs` do kit aciona a API pública `DcpWasm` em um Chrome real com um perfil temporário. Os arquivos que ele serve ficam fixados a um `SHA256SUMS` que a ferramenta
  escreve a partir da árvore instalada. Cada célula e as seções diretas devem vir com o registro de
  navegador que o próprio wrapper escreve daquela execução: novo, com o identificador da execução,
  dentro do intervalo observado, servindo os arquivos instalados, com um navegador que respondeu,
  encerrou e cujo perfil foi removido.

### Python (`pypi-wheel`, `pypi-sdist`)

Cada lane tem seus próprios ambientes virtuais. O Python é executado com `-I -B`, e o pip com `--isolated`, sem cache, sem arquivo de configuração e com `https://pypi.org/simple/` como único índice.

- **Wheel.** `pip download`; o SHA-256 é verificado antes de instalar qualquer coisa; `pip install --only-binary :all:`; o relatório do próprio pip dá o hash que ele instalou e mostra que todos os
  arquivos vieram de `files.pythonhosted.org`. O wheel e a distribuição instalada são comparados nos
  dois sentidos: cada arquivo de módulo deve ser igual e nada mais pode estar instalado. Ficam de fora
  apenas os arquivos que o pip escreve por conta própria em `*.dist-info`: `RECORD` (reescrito), `INSTALLER` e `REQUESTED`; um `direct_url.json` é um problema aqui. Não existe bytecode quando as árvores são comparadas (`--no-compile`, `-B`). `import dcp_ai` deve carregar daquele site-packages,
  sem user site e sem nenhum caminho fora do diretório de trabalho e do interpretador.
- **Sdist.** O arquivo é primeiro baixado como bytes por `fetch-pypi.mjs`, que não desempacota nem
  executa nada, e seu SHA-256 é comparado com o manifesto; o que o índice declara sobre ele é registrado
  à parte e não é dado como confiável. Só então ele é desempacotado, as dependências de build são
  instaladas e o wheel é construído a partir do arquivo local com `--no-index --no-build-isolation`. O
  wheel construído é um artefato separado no relatório; seus arquivos de módulo devem ser exatamente os
  do sdist, nos dois sentidos. Ele é instalado em um ambiente limpo e comparado como no lane do wheel,
  exceto que ali `direct_url.json` é o esperado (um wheel local foi instalado) e deve apontar para
  dentro do diretório de trabalho.
- **Locks.** `consumers/python/<platform>/` contém `wheel.txt` (o wheel e suas dependências de execução), `sdist.txt` e `build.txt` (as dependências de build), todos fixados com hashes, e `platform.json`. Há um diretório por plataforma, escolhido pelo interpretador em execução: `cpython-3.12-darwin-arm64` e `cpython-3.12-linux-x86_64`. Em qualquer outro interpretador ou plataforma, `locked` é recusado como não suportado em vez de ser tentado.

### Go (`go`)

O `main.go` do kit, byte a byte, com os `go.mod` e `go.sum` versionados (`consumers/go`, sem `replace`), compilado com `-mod=readonly`, `GOPROXY=https://proxy.golang.org`, `GOSUMDB=sum.golang.org`, `GOENV=off` e `GOWORK=off`. O módulo é primeiro baixado fora de qualquer módulo, de modo que o go o verifica contra o banco de dados de checksums. A ferramenta calcula `h1` por
conta própria sobre os arquivos do zip baixado, compara o zip com o diretório a partir do qual o go
compila e lê as informações de build do binário: o módulo, sua versão e seu `h1`, sem nada substituído.
O relatório registra a arquitetura para a qual a ferramenta go compila, que não precisa ser a do host.

### Rust (`crates-default`, `crates-otlp`)

O `src/main.rs` do kit, byte a byte, em dois consumidores com seus próprios `Cargo.toml` e `Cargo.lock` (`consumers/rust-default`, `consumers/rust-otlp`), `CARGO_HOME` e diretório target. O `Cargo.toml` do consumidor deve ser, linha a linha, o único manifesto que a ferramenta espera. Depois de `cargo fetch --locked`, o `.crate` tem seu hash calculado e comparado com o manifesto e com o lock antes de qualquer compilação; `cargo metadata` deve dizer que `dcp-ai` vem de crates.io, de um diretório dentro do diretório de trabalho, com as features do lane; o `.crate` é comparado nos dois sentidos com esse diretório, exceto o marcador `.cargo-ok` do próprio cargo; e depois `cargo build --locked`.

<a id="locked-and-fresh"></a>

## `locked` e `fresh`

- `locked` (o padrão): as dependências de terceiros vêm dos locks versionados. A seleção é
  reproduzível; as ferramentas do host (npm, pip, Go, cargo, rustc, o compilador C, Chrome) não são
  fixadas, apenas registradas.
- `fresh`: resolvidas agora, como um consumidor novo as obteria. Os locks resultantes são mantidos no diretório de trabalho: `package-lock.fresh.json` na raiz e os demais em `locks/`. No lane sdist, as
  dependências de build ficam então registradas, mas não fixadas.

As seis identidades DCP são exigidas nos dois modos.

## CI

`.github/workflows/release-validation.yml` executa a ferramenta em `ubuntu-24.04`, manualmente (`workflow_dispatch`) ou em PRs que alterem esta ferramenta ou as entradas do kit de conformidade. Os PRs executam a campanha completa (`all`, `locked`), com acesso de leitura ao repositório, sem segredos e sem nenhuma etapa de publicação. Suas entradas são um lane (`all` ou um lane) e a resolução. `ci.mjs` decide o resultado: PASS apenas para `all` com saída 0; PARTIAL, informado como diagnóstico, apenas para um lane com saída
4; qualquer outra combinação faz o job falhar. O diretório de trabalho é enviado como artefato em todos
os casos.

<a id="updating-for-another-release"></a>

## Atualização para outra publicação

Esta ferramenta não publica nada. Depois que uma versão tiver sido publicada e seus identificadores
registrados no dossiê de auditoria:

1. Coloque as novas versões e os novos identificadores em `manifest.json` e no teste que os congela. Os nomes de arquivo de um pacote (`file`) e a versão interna do crate de `@dcp-ai/wasm` mudam junto.
2. Atualize os consumidores: as versões em `consumers/npm/package.json`, `consumers/go/go.mod` e nos dois `Cargo.toml`, e as linhas DCP dos locks de Python.
3. Regenere os locks com `--resolution fresh` em cada plataforma que tenha um, e copie-os do diretório de trabalho: `package-lock.fresh.json`, que fica na raiz, e `locks/python/<platform>/`, `locks/go/`, `locks/rust-default/` e `locks/rust-otlp/`. Um lock de Python só é produzido executando naquela
   plataforma.
4. Se as suítes da CLI ou as seções diretas do kit mudaram, atualize `expected-blocks.json`.
5. Execute os testes e depois a campanha completa em modo `locked`.

<a id="limits"></a>

## Limites

- Uma campanha é um ambiente. O que foi executado está no guia; nada além disso é afirmado.
- Os wrappers e o runner são os do checkout; o pacote em teste é o do registro. A resolução de módulos
  não é instrumentada: a verificação de origem é o lock, a árvore instalada e o caminho que o wrapper
  informa.
- Os locks de Python cobrem duas plataformas. Os hashes que um lock contém não dizem nada sobre
  nenhuma outra.
- A versão e o user agent do navegador são registrados como o navegador os informa. O user agent é
  reduzido e não indica qual arquitetura foi executada.
- A limpeza de processos lê a tabela de processos. Um processo desvinculado por um pai que morre dentro
  de um intervalo de sondagem (250 ms) não é visto, nada é limpo se a própria ferramenta for morta com
  SIGKILL e, se `ps` falhar, nenhum sinal é enviado e o relatório diz que a limpeza não foi confirmada.
  Uma execução do navegador interrompida de fora deixa seu perfil temporário no diretório de trabalho.
- Sem proxy: o ambiente construído para os subprocessos não tem nenhuma variável de proxy.
- O relatório contém caminhos absolutos do host e nenhum valor de ambiente além dos que a ferramenta
  construiu.
