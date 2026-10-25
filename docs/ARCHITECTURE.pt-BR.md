<sub>[English](ARCHITECTURE.md) · [中文](ARCHITECTURE.zh-CN.md) · [Español](ARCHITECTURE.es.md) · [日本語](ARCHITECTURE.ja.md) · **Português**</sub>

<a id="architecture-map"></a>

# Mapa da arquitetura

> Tradução informativa da [versão em inglês](ARCHITECTURE.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Este documento é uma orientação de 2 minutos para novos colaboradores. Ele explica **onde cada peça fica e por quê**: o suficiente para encaminhar um PR ou um relatório de bug sem precisar adivinhar.

Para a especificação normativa do protocolo, veja [`spec/`](../spec/README.md). Para executar os testes e compilar, veja [`CONTRIBUTING.md`](../CONTRIBUTING.md).

<a id="mental-model"></a>

## Modelo mental

O DCP-AI é uma **camada portátil de responsabilização** para agentes de IA. As camadas do repositório, da mais normativa à mais operacional:

```
┌───────────────────────────────────────────────────────────────────┐
│  spec/ + schemas/           ← source of truth (what IS DCP)        │
│  ─────────────────────                                             │
│  tests/                     ← conformance + interop + NIST KAT     │
│  ─────────────────────                                             │
│  sdks/{ts,py,rust,go,wasm}  ← reference implementations            │
│  ─────────────────────                                             │
│  integrations/              ← bindings for popular frameworks      │
│  cli/                       ← interactive CLI (@dcp-ai/cli)        │
│  packages/create-*          ← npm create scaffolders               │
│  ─────────────────────                                             │
│  services/                  ← operational infra (anchor, log, …)   │
│  contracts/                 ← on-chain artifacts (DCPAnchor.sol)   │
│  ─────────────────────                                             │
│  docs/ + docs-site/ + site/ ← hand-written docs + generated site   │
│  playground/                ← in-browser interactive demo          │
└───────────────────────────────────────────────────────────────────┘
```

Quanto mais acima nessa pilha você estiver, mais estrita é a revisão da mudança:
alterações na especificação exigem que os cinco SDKs continuem sincronizados; uma alteração na documentação é autocontida.

<a id="top-level-directories"></a>

## Diretórios de primeiro nível

| Caminho | O que é | Destino de publicação |
|---|---|---|
| [`spec/`](../spec/) | Especificações normativas DCP-01 a DCP-09, mais as extensões de perfil (criptografia, A2A, governança, admissão). O texto em inglês é o normativo; as traduções são informativas. | — |
| [`schemas/`](../schemas/) | Definições JSON Schema (draft 2020-12) de cada artefato do protocolo. v1 (9 esquemas) + v2 (42 esquemas). | — |
| [`tests/conformance/`](../tests/conformance/) | Suíte de conformidade entre SDKs na qual todo SDK precisa passar. É a barreira que mantém honesta a compatibilidade do formato de transmissão. | — |
| [`tests/interop/`](../tests/interop/) | Vetores de interoperabilidade: canonicalização, separação de domínio, assinatura composta, emenda de sessões, ataques de remoção. | — |
| [`tests/nist-kat/`](../tests/nist-kat/) | Vetores Ed25519 da RFC 8032, testes de propriedades do ML-DSA-65 e vetores ACVP do NIST para SLH-DSA-192f / ML-KEM-768. | — |
| [`sdks/typescript/`](../sdks/typescript/) | SDK TypeScript de referência. | npm `@dcp-ai/sdk` |
| [`sdks/python/`](../sdks/python/) | SDK Python de referência. | PyPI `dcp-ai` |
| [`sdks/rust/`](../sdks/rust/) | SDK Rust de referência (também compilado para WASM). | crates.io `dcp-ai` |
| [`sdks/go/`](../sdks/go/) | SDK Go de referência. | Módulos Go `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` |
| [`sdks/wasm/`](../sdks/wasm/) | Bundle WebAssembly do SDK Rust para navegador + Node. | npm `@dcp-ai/wasm` |
| [`integrations/`](../integrations/) | 10 vinculações com frameworks: Express, FastAPI, LangChain, OpenAI, CrewAI, OpenClaw, W3C DID, Google A2A, Anthropic MCP, AutoGen. | npm `@dcp-ai/<name>` (seis pacotes); PyPI `dcp-ai[<extra>]` (FastAPI, LangChain, OpenAI, CrewAI) |
| [`packages/create-*`](../packages/) | Geradores invocados via `npm create @dcp-ai/<framework>`. Um por framework principal. | npm `@dcp-ai/create-<name>` |
| [`cli/`](../cli/) | CLI com assistente interativo, alternativa ao `bin/dcp.js` para novos usuários. | npm `@dcp-ai/cli` |
| [`bin/`](../bin/) | CLI de referência em JavaScript usada pela suíte de conformidade. | Pacote raiz (não publicado no npm); executado a partir de uma cópia do repositório. |
| [`services/`](../services/) | Serviços operacionais de referência: anchor (agrupa hashes em memória; ainda sem envio on-chain), transparency-log (log em árvore de Merkle com cabeças de árvore assinadas e gossip), revocation. | Imagens Docker → GHCR |
| [`contracts/ethereum/`](../contracts/ethereum/) | `DCPAnchor.sol` + testes Foundry. | Implantação on-chain |
| [`api/`](../api/) | Artefatos do formato de transmissão: OpenAPI (`openapi.yaml`) + Protocol Buffers (`proto/`). | — |
| [`lib/`](../lib/) | A biblioteca de verificação de referência (`lib/verify.js`) e utilitários usados pelo pacote raiz, pelo servidor e pelos serviços. | Pacote raiz (não publicado no npm). |
| [`tools/`](../tools/) | CLIs internas do repositório (`validate.js`, `conformance.js`, `crypto.js`, `merkle.js`). Não publicadas. | — |
| [`scripts/`](../scripts/) | Utilitários de build pontuais (geradores de exemplos, emissão das impressões digitais do protocolo). | — |
| [`docs/`](../docs/) | Documentação escrita à mão: QUICKSTART, OBSERVABILITY, ARCHITECTURE (este arquivo), notas de SECURITY, guias de migração. | Consumida pelo MkDocs. |
| `docs-site/` | Gerado e não versionado (`.gitignore`): a árvore de preparação por idioma que `scripts/docs_site.py` grava para o build com MkDocs. A configuração do site é [`mkdocs.yml`](../mkdocs.yml). | — |
| `site/` | Gerado e não versionado (`.gitignore`): o site de documentação em cinco idiomas que `bash scripts/build-docs-site.sh` constrói. | GitHub Pages, via `.github/workflows/docs.yml`. |
| [`playground/`](../playground/) | Playground interativo no navegador (JavaScript simples; Ed25519 com `tweetnacl`, SHA-256 com WebCrypto; suas assinaturas ML-DSA / SLH-DSA são simuladas, como a página informa). | Hospedado em docs.dcp-ai.org/playground/. |
| [`templates/`](../templates/) | Templates de origem consumidos pelos geradores `packages/create-*`. | — |
| [`deploy/`](../deploy/) | Configurações do Fly.io e de implantação dos serviços. | — |
| [`keys/`](../keys/) | Chaves de demonstração usadas pelos testes de conformidade e pelos exemplos. **Não as use em produção.** | — |
| [`credentials/`](../credentials/) | Arquivos @context JSON-LD servidos em dcp-ai.org/credentials/v2. | GitHub Pages. |

<a id="how-the-pieces-talk-to-each-other"></a>

## Como as peças se comunicam

- **Especificação → SDKs.** `spec/` e `schemas/` são lidos por pessoas; os SDKs os implementam. Cada SDK reimplementa a canonicalização, o hash, a assinatura e a verificação para produzir artefatos compatíveis no formato de transmissão. A suíte de conformidade em `tests/conformance/` executa os mesmos vetores contra todos os SDKs na CI.
- **SDKs → integrações.** Cada pacote `integrations/*` usa o SDK da sua linguagem como dependência; por exemplo, `@dcp-ai/express` depende de `@dcp-ai/sdk`. Nenhuma integração reimplementa a criptografia.
- **Integrações → geradores.** Os `packages/create-*` distribuem o código mínimo de que um usuário precisa para começar um projeto sobre uma integração específica.
- **SDKs → serviços.** O servidor de verificação e o serviço de revogação verificam por meio de `lib/verify.js` e `@dcp-ai/sdk`. O log de transparência assina as cabeças de árvore diretamente com `tweetnacl`, e o serviço de ancoragem só calcula hashes.
- **Pacote raiz (`dcp-ai`, não publicado no npm).** O `package.json` de primeiro nível contém a CLI de referência + a biblioteca de verificação (`bin/dcp.js`, `lib/verify.js`) e o harness de conformidade. A V1 é verificada ali mesmo; a V2 é validada ali contra o esquema e depois verificada pelo `@dcp-ai/sdk`, de modo que há uma única implementação da V2. É o ponto de entrada original; a maioria dos novos usuários chega, em vez disso, por um SDK ou por um gerador.

<a id="where-to-change-what"></a>

## Onde mudar o quê

| Você quer… | Edite |
|---|---|
| Propor um artefato novo ou endurecer um esquema | `spec/` + `schemas/`; depois atualize todos os SDKs de forma sincronizada e adicione um vetor de conformidade em `tests/conformance/`. |
| Corrigir um bug criptográfico numa linguagem | `sdks/<language>/`. Adicione um teste de regressão. Se o bug puder afetar outras linguagens, adicione um vetor de interoperabilidade compartilhado em `tests/interop/`. |
| Adicionar uma integração com um framework | `integrations/<framework>/`. Use como dependência o SDK da linguagem correspondente. Adicione um gerador em `packages/create-<framework>/` se for um framework principal. |
| Mudar o site de marketing | Não está neste repositório (veja [Limite do escopo](#scope-boundary)). |
| Mudar o site de documentação | As fontes Markdown e as quatro traduções delas, `mkdocs.yml` e a lista de documentos publicados em `scripts/docs-i18n.json`; `docs-site/` e `site/` são gerados. Veja [CONTRIBUTING.md](../CONTRIBUTING.md#documentation-and-translations). |
| Mudar a demonstração interativa | `playground/`. |
| Implantar ou reimplantar um serviço | `services/<name>/` + `deploy/fly/`. |
| Lançar uma nova versão de um SDK | Aumente a versão no `package.json` / `Cargo.toml` / `pyproject.toml` correspondente ou na tag do git; a CI detecta e publica via `.github/workflows/publish*.yml`. Pular o que já foi publicado está embutido. |

<a id="scope-boundary"></a>

## Limite do escopo

O monorrepositório contém o **protocolo e suas implementações de referência**: especificação, esquemas, os cinco SDKs, integrações com frameworks, geradores, CLI, serviços operacionais, contratos inteligentes, documentação e o playground interativo. É tudo de que um terceiro precisa para adotar o DCP-AI.

Aplicações para usuários finais (painéis, agentes, demonstrações) e superfícies de marketing **não** estão neste repositório, de propósito. Elas pertencem à base de código que as hospeda: são aplicações sobre o protocolo, não parte dele.

<a id="why-monorepo-today"></a>

## Por que um monorrepositório hoje

Um protocolo com cinco SDKs vive ou morre por mantê-los compatíveis no formato de transmissão. Revisar um PR que mexe nos cinco ao mesmo tempo — e executar a suíte de conformidade contra os cinco em cada PR — é a forma mais leve de impor essa invariante. No momento em que um SDK ou um componente específico desenvolver a própria comunidade e o próprio ritmo, separá-lo será uma resposta razoável. Até lá, o custo de coordenar vários repositórios supera os benefícios.

Leituras adicionais: o modelo de governança em [`GOVERNANCE.md`](../GOVERNANCE.md) e a direção futura em [`ROADMAP.md`](../ROADMAP.md).
