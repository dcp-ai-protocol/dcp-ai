<a id="published-npm-packages"></a>

# Pacotes publicados no npm

> Tradução informativa da [versão em inglês](NPM_RELEASES.md), atualizada em 26/10/2026. Em caso de divergência, prevalece a versão em inglês.

Verificado em 26/10/2026. Estas 13 versões exatas estão publicadas com a tag `latest`. A integridade no registro correspondeu aos tarballs testados, e uma instalação nova pelo npm passou em 383 verificações. As versões dos pacotes são independentes da versão do formato/especificação DCP e das tags do repositório.

| Pacote | Versão |
|---|---|
| [`@dcp-ai/sdk`](https://www.npmjs.com/package/@dcp-ai/sdk) | 2.2.0 |
| [`@dcp-ai/wasm`](https://www.npmjs.com/package/@dcp-ai/wasm) | 2.1.0 |
| [`@dcp-ai/cli`](https://www.npmjs.com/package/@dcp-ai/cli) | 2.1.0 |
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

<a id="install-the-published-versions"></a>

## Instalar as versões publicadas

```bash
npm install @dcp-ai/sdk@^2.2.0
npm install @dcp-ai/wasm@^2.1.0
npm install @dcp-ai/express@^2.1.0 express
npx --package=@dcp-ai/cli@2.1.0 dcp-ai --help
```

Esta publicação abrange apenas o npm. Não publica um pacote Python no PyPI, um crate Rust no crates.io, uma tag de módulo Go nem uma imagem de contêiner. Confira o estado de publicação de cada SDK antes de usar exemplos do código-fonte nesses ecossistemas. A raiz do repositório continua usando um SDK local para testar o código do checkout; é uma escolha de desenvolvimento, não uma limitação de disponibilidade no npm.

`@dcp-ai/sdk` 2.2.0 inclui confiança no principal, `strict-v1`, as correções do verificador e as APIs experimentais do candidato. `@dcp-ai/express` e `@dcp-ai/openclaw` 2.1.0 incluem a verificação corrigida de assinaturas V2 e os controles de admissão documentados. Suas versões 2.0.0 continuam afetadas; veja [SECURITY.md](../SECURITY.md). Publicar os pacotes não torna um bundle verificado confiável nem autoriza uma ação.

Tanto em `@dcp-ai/sdk` 2.2.0 quanto em `@dcp-ai/wasm` 2.1.0, `dcp-jcs-v2` continua experimental, não normativo e opt-in. `dcp-jcs-v1` continua sendo o único padrão normativo. Os geradores e auxiliares de integração mantêm as limitações de seus READMEs; publicá-los não transforma demonstrações em verificadores de produção.
