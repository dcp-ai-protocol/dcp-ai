<a id="published-npm-packages"></a>

# Pacotes publicados no npm

> Tradução informativa da [versão em inglês](NPM_RELEASES.md), atualizada em 28/10/2026. Em caso de divergência, prevalece a versão em inglês.

Verificado em 28/10/2026: `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1 e `@dcp-ai/cli` 2.1.1 estão publicados com a tag `latest`; os outros dez pacotes da tabela não mudam. As versões dos pacotes são independentes da versão do formato/especificação DCP e das tags do repositório.

Em 26/10/2026, 13 versões foram publicadas com a tag `latest`: `@dcp-ai/sdk` 2.2.0, `@dcp-ai/wasm` 2.1.0, `@dcp-ai/cli` 2.1.0 e os dez pacotes que continuam na tabela. A integridade no registro correspondeu aos tarballs testados, e uma instalação nova pelo npm passou em 383 verificações.

| Pacote | Versão |
|---|---|
| [`@dcp-ai/sdk`](https://www.npmjs.com/package/@dcp-ai/sdk) | 2.2.1 |
| [`@dcp-ai/wasm`](https://www.npmjs.com/package/@dcp-ai/wasm) | 2.1.1 |
| [`@dcp-ai/cli`](https://www.npmjs.com/package/@dcp-ai/cli) | 2.1.1 |
| [`@dcp-ai/anthropic-mcp`](https://www.npmjs.com/package/@dcp-ai/anthropic-mcp) | 2.1.0 |
| [`@dcp-ai/autogen`](https://www.npmjs.com/package/@dcp-ai/autogen) | 2.0.1 |
| [`@dcp-ai/express`](https://www.npmjs.com/package/@dcp-ai/express) | 2.1.0 |
| [`@dcp-ai/google-a2a`](https://www.npmjs.com/package/@dcp-ai/google-a2a) | 2.1.0 |
| [`@dcp-ai/openclaw`](https://www.npmjs.com/package/@dcp-ai/openclaw) | 2.1.0 |
| [`@dcp-ai/w3c-did`](https://www.npmjs.com/package/@dcp-ai/w3c-did) | 2.0.1 |
| [`@dcp-ai/create-crewai`](https://www.npmjs.com/package/@dcp-ai/create-crewai) | 2.0.1 |
| [`@dcp-ai/create-express`](https://www.npmjs.com/package/@dcp-ai/create-express) | 2.0.1 |
| [`@dcp-ai/create-langchain`](https://www.npmjs.com/package/@dcp-ai/create-langchain) | 2.0.1 |
| [`@dcp-ai/create-openai`](https://www.npmjs.com/package/@dcp-ai/create-openai) | 2.0.1 |

<a id="what-changed-on-28102026"></a>

## O que mudou em 28/10/2026

`@dcp-ai/sdk` 2.2.1 e `@dcp-ai/wasm` 2.1.1 verificam os campos secundários SHA3-256 opcionais do [VERIFICATION.md V2-11](../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) quando estão presentes: os ausentes não são exigidos, então um bundle verificado pode não ter uma cadeia secundária completa, e um campo presente que seja `null`, não seja uma string ou seja inconsistente é rejeitado. `@dcp-ai/cli` 2.1.1 exige `@dcp-ai/sdk` `^2.2.1`, e `--version` informa `2.1.1`. Não mudam as APIs, os campos de resultado, `dcp-jcs-v1`, as APIs experimentais opt-in de `dcp-jcs-v2` nem o tratamento de `hash_alg`. Os adaptadores publicados `@dcp-ai/express`, `@dcp-ai/openclaw`, `@dcp-ai/anthropic-mcp` e `@dcp-ai/google-a2a` 2.1.0 não foram republicados: dependem de `@dcp-ai/sdk` `^2.2.0` e obtêm as verificações secundárias quando seu lockfile resolve `@dcp-ai/sdk` 2.2.1 ou posterior.

Os três tarballs do registro são idênticos byte a byte aos artefatos revisados, com integridade `sha512` correspondente. Um consumidor novo que instala pelo npm, sem substituições locais, passou em 411 vereditos secundários SHA3-256 e 87 controles, 340 verificações de regressão e 80 verificações da CLI (`--version` 2.1.1); o pacote `@dcp-ai/wasm` do registro passou em 167 verificações em um navegador real.

<a id="install-the-published-versions"></a>

## Instalar as versões publicadas

```bash
npm install @dcp-ai/sdk@^2.2.1
npm install @dcp-ai/wasm@^2.1.1
npm install @dcp-ai/express@^2.1.0 express
npx --package=@dcp-ai/cli@2.1.1 dcp-ai --help
```

Cada publicação npm abrange apenas o npm. Não publica um pacote Python no PyPI, um crate Rust no crates.io, uma tag de módulo Go nem uma imagem de contêiner. Confira o estado de publicação de cada SDK antes de usar exemplos do código-fonte nesses ecossistemas. A raiz do repositório continua usando um SDK local para testar o código do checkout; é uma escolha de desenvolvimento, não uma limitação de disponibilidade no npm.

Desde a 2.2.0, `@dcp-ai/sdk` inclui confiança no principal, `strict-v1`, as correções do verificador e as APIs experimentais do candidato. `@dcp-ai/express` e `@dcp-ai/openclaw` 2.1.0 incluem a verificação corrigida de assinaturas V2 e os controles de admissão documentados. Suas versões 2.0.0 continuam afetadas; veja [SECURITY.md](../SECURITY.md). Publicar os pacotes não torna um bundle verificado confiável nem autoriza uma ação.

Em `@dcp-ai/sdk` 2.2.0 e posteriores e em `@dcp-ai/wasm` 2.1.0 e posteriores, `dcp-jcs-v2` continua experimental, não normativo e opt-in. `dcp-jcs-v1` continua sendo o único padrão normativo. Os geradores e auxiliares de integração mantêm as limitações de seus READMEs; publicá-los não transforma demonstrações em verificadores de produção.

<a id="related-releases"></a>

## Publicações relacionadas

As versões atuais em cada registro estão em [Versões publicadas](README.md#published-versions). Outras notas de publicação: [Python 2.10.1](PYTHON_RELEASE.md), [Go v2.11.1](GO_RELEASE.md) e [Rust 2.11.1](RUST_RELEASE.md).
