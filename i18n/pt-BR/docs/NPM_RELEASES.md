<a id="published-npm-packages"></a>

# Pacotes publicados no npm

> Tradução informativa da [versão em inglês](../../../docs/NPM_RELEASES.md), atualizada em 05/11/2026. Em caso de divergência, prevalece a versão em inglês.

Verificado em 05/11/2026: `@dcp-ai/sdk` 2.3.0 e `@dcp-ai/wasm` 2.1.3 estão publicados com a tag `latest`; os outros onze pacotes da tabela não mudam ([o que mudou](#what-changed-on-05112026)). Em 28/10/2026, `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1 e `@dcp-ai/cli` 2.1.1 foram publicados com a tag `latest`. As versões dos pacotes são independentes da versão do formato/especificação DCP e das tags do repositório.

Em 26/10/2026, 13 versões foram publicadas com a tag `latest`: `@dcp-ai/sdk` 2.2.0, `@dcp-ai/wasm` 2.1.0, `@dcp-ai/cli` 2.1.0 e os dez pacotes que continuam na tabela. A integridade no registro correspondeu aos tarballs testados, e uma instalação nova pelo npm passou em 383 verificações.

| Pacote | Versão |
|---|---|
| [`@dcp-ai/sdk`](https://www.npmjs.com/package/@dcp-ai/sdk) | 2.3.0 |
| [`@dcp-ai/wasm`](https://www.npmjs.com/package/@dcp-ai/wasm) | 2.1.3 |
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

`@dcp-ai/sdk` 2.2.1 e `@dcp-ai/wasm` 2.1.1 verificam os campos secundários SHA3-256 opcionais do [VERIFICATION.md V2-11](../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) quando estão presentes: os ausentes não são exigidos, então um bundle verificado pode não ter uma cadeia secundária completa, e um campo presente que seja `null`, não seja uma string ou seja inconsistente é rejeitado. `@dcp-ai/cli` 2.1.1 exige `@dcp-ai/sdk` `^2.2.1`, e `--version` informa `2.1.1`. Não mudam as APIs, os campos de resultado, `dcp-jcs-v1`, as APIs experimentais opt-in de `dcp-jcs-v2` nem o tratamento de `hash_alg`. Os adaptadores publicados `@dcp-ai/express`, `@dcp-ai/openclaw`, `@dcp-ai/anthropic-mcp` e `@dcp-ai/google-a2a` 2.1.0 não foram republicados: dependem de `@dcp-ai/sdk` `^2.2.0` e obtêm as verificações secundárias quando seu lockfile resolve `@dcp-ai/sdk` 2.2.1 ou posterior.

Os três tarballs do registro são idênticos byte a byte aos artefatos revisados, com integridade `sha512` correspondente. Um consumidor novo que instala pelo npm, sem substituições locais, passou em 411 vereditos secundários SHA3-256 e 87 controles, 340 verificações de regressão e 80 verificações da CLI (`--version` 2.1.1); o pacote `@dcp-ai/wasm` do registro passou em 167 verificações em um navegador real.

<a id="install-the-published-versions"></a>

## Instalar as versões publicadas

```bash
npm install @dcp-ai/sdk@^2.3.0
npm install @dcp-ai/wasm@^2.1.3
npm install @dcp-ai/express@^2.1.0 express
npx --package=@dcp-ai/cli@2.1.1 dcp-ai --help
```

Cada publicação npm abrange apenas o npm. Não publica um pacote Python no PyPI, um crate Rust no crates.io, uma tag de módulo Go nem uma imagem de contêiner. Confira o estado de publicação de cada SDK antes de usar exemplos do código-fonte nesses ecossistemas. A raiz do repositório continua usando um SDK local para testar o código do checkout; é uma escolha de desenvolvimento, não uma limitação de disponibilidade no npm.

Desde a 2.2.0, `@dcp-ai/sdk` inclui confiança no principal, `strict-v1`, as correções do verificador e as APIs experimentais do candidato. `@dcp-ai/express` e `@dcp-ai/openclaw` 2.1.0 incluem a verificação corrigida de assinaturas V2 e os controles de admissão documentados. Suas versões 2.0.0 continuam afetadas; veja [SECURITY.md](../../../SECURITY.md). Publicar os pacotes não torna um bundle verificado confiável nem autoriza uma ação.

Em `@dcp-ai/sdk` 2.2.0 e posteriores e em `@dcp-ai/wasm` 2.1.0 e posteriores, `dcp-jcs-v2` continua experimental, não normativo e opt-in. `dcp-jcs-v1` continua sendo o único padrão normativo. Os geradores e auxiliares de integração mantêm as limitações de seus READMEs; publicá-los não transforma demonstrações em verificadores de produção.

<a id="what-changed-on-05112026"></a>

## O que mudou em 05/11/2026

`@dcp-ai/sdk` 2.3.0 e `@dcp-ai/wasm` 2.1.3 foram publicados em 05/11/2026 a partir dos tarballs testados antes da publicação. Eles substituem o candidato `@dcp-ai/wasm` 2.1.2 de 30/10/2026 abaixo, que nunca foi publicado.

`@dcp-ai/sdk` 2.3.0, em comparação com a 2.2.1:

- **Validação de esquemas V2-2 (mudança de aceitação).** `verifySignedBundleV2`, a API combinada de admissão e o verificador candidato experimental validam o envelope do bundle assinado e os quatro payloads contra `schemas/v2` antes de qualquer verificação de hash, chave ou assinatura. Bundles inválidos pelo esquema que antes eram aceitos, como membros desconhecidos em objetos fechados ou horários de sessão `null` no manifesto, agora retornam `verified: false` com diagnósticos `schema: <pointer> <keyword>`.
- **Mandatos.** `verifyMandateValidity` aplica um único contrato e aceita um `now` opcional; uma data ausente ou malformada, antes aceita, é inválida. `verifyMandateChain` lê todos os instantes da mesma forma e rejeita um mandato raiz que repete um domínio.
- **`VerificationCache`.** Novas opções de adesão explícita `context` e `agentIds`. Opções inválidas lançam uma exceção, `set` e `get` copiam os resultados, uma entrada expira exatamente ao completar seu TTL no relógio monotônico, e `invalidateByAgent` agora remove entradas.

`@dcp-ai/wasm` 2.1.3, em comparação com a 2.1.1:

- **`dualMerkleRoot` segue a V2-11 (mudança de aceitação).** Ela e a exportação direta `wasm_dual_merkle_root` calculam a raiz Merkle dupla com a redução da [VERIFICATION.md V2-11](../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) que `verifyBundle` já usava (digests brutos de 32 bytes, com o último nó duplicado em uma camada ímpar). A 2.1.1 e anteriores fazem hash do texto hex e sobem um último nó ímpar sem mudança, então suas raízes de duas ou mais folhas diferem. Uma folha que não seja um digest hex de 32 bytes agora é um erro, e as raízes são retornadas em minúsculas.
- **Validação de esquemas V2-2 (mudança de aceitação).** `verifyBundle` e `wasm_verify_signed_bundle_v2` validam o envelope e os quatro payloads contra `schemas/v2` antes de qualquer verificação de hash, chave ou assinatura.
- **Nenhuma API JavaScript é adicionada.** O WebAssembly vem do código-fonte Rust `dcp-ai` 2.13.0, também publicado em 05/11/2026 (veja [Rust](../../../docs/RUST_RELEASE.md)).

Os dois pacotes mantêm o formato de transmissão, as assinaturas, os perfis, `dcp-jcs-v1` como padrão normativo e as APIs experimentais de adesão explícita `dcp-jcs-v2`, e ambos incluem o `LICENSE` Apache-2.0. O README de cada tarball publicado é o que foi preparado antes da publicação: diz "prepared, not published", e no README do WASM a linha de `dualMerkleRoot` da tabela de operações de hash ainda diz "Prepared for 2.1.2". Tarballs publicados não podem mudar; esta página e os READMEs do repositório descrevem as versões publicadas.

Os tarballs do registro de `@dcp-ai/sdk` 2.3.0 e `@dcp-ai/wasm` 2.1.3 são idênticos byte a byte aos artefatos testados, com a mesma integridade `sha512`. Um consumidor novo que os instalou pelo npm, sem overrides, passou no kit de conformidade externo (697 casos em sete catálogos para o SDK, 460 nos cinco catálogos que o `@dcp-ai/wasm` suporta), e o pacote WASM servido a partir dessa instalação passou em 14 verificações num navegador.

<a id="migrating-dualmerkleroot-results"></a>

### Migrar resultados de `dualMerkleRoot`

A correção muda as raízes que a função calcula, não a evidência que você já tem:

- **Mantenha a evidência histórica como está.** Raízes calculadas com `@dcp-ai/wasm` 2.1.1 ou anteriores, e qualquer bundle, assinatura, ancoragem ou entrada de log que as carregue, ficam como foram registradas. Não as recalcule com a 2.1.3 nem substitua os valores armazenados para que coincidam: isso reescreve evidência assinada ou ancorada e invalida suas assinaturas.
- **Registre qual versão calculou cada raiz.** Uma raiz de duas ou mais folhas da 2.1.1 ou anteriores não é a raiz V2-11 das mesmas folhas. Para conferi-la, recalcule-a com a versão que a produziu, ou calcule a raiz V2-11 ao lado dela e guarde os dois valores.
- **Raízes novas** vêm da 2.1.3 ou dos outros SDKs, que já seguem a V2-11. A redução Merkle usada pela verificação de bundles não muda; `verifyBundle` já usava a V2-11. As novas verificações de esquema V2-2 descritas acima mudam, sim, a aceitação.

<a id="cli-and-adapters"></a>

### CLI e adaptadores

`@dcp-ai/cli` e os adaptadores npm não recebem nova versão. Seus intervalos publicados (`^2.2.1` para a CLI, `^2.2.0` para os adaptadores) aceitam `@dcp-ai/sdk` 2.3.0. Foram verificados duas vezes: antes da publicação, instalados a partir do npm com `@dcp-ai/sdk` resolvido para o candidato por meio de um override; depois da publicação, instalados a partir do npm sem nenhum override, quando os próprios intervalos resolveram um único `@dcp-ai/sdk` 2.3.0 do registro, com a integridade testada. Nas duas vezes:

- **Verificados funcionalmente:** `@dcp-ai/cli` 2.1.1 (`--version`, um bundle V2 válido e um inválido pelo esquema, que a própria verificação de esquema da CLI rejeita antes de o SDK ser executado), e `@dcp-ai/express` e `@dcp-ai/openclaw` 2.1.0 (verificações de regressão de suas correções de admissão e verificação).
- **Verificados só na instalação:** `@dcp-ai/anthropic-mcp` e `@dcp-ai/google-a2a` (um único `@dcp-ai/sdk` 2.3.0 resolvido, o intervalo aceito e a importação do ponto de entrada), e os pacotes que não dependem do SDK (o ponto de entrada é analisado sem erros). Isso não é teste de integração.

<a id="prepared-not-published-dcp-aiwasm-212"></a>

## Preparada, não publicada: `@dcp-ai/wasm` 2.1.2

`@dcp-ai/wasm` 2.1.2 está preparada no repositório desde 30/10/2026, mas não publicada no npm. Na época da preparação, a tabela e os comandos de instalação continuavam nas versões do registro de então; os atuais estão acima.

Corrige `dualMerkleRoot` e a exportação bruta `wasm_dual_merkle_root`: agora calculam a raiz Merkle dupla com a redução da [VERIFICATION.md V2-11](../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) que `verifyBundle` já usava (digests brutos de 32 bytes; numa camada ímpar o último nó é duplicado). A 2.1.1 e anteriores fazem hash do texto hex e sobem sem alteração o último nó ímpar, então suas raízes de duas ou mais folhas diferem da V2-11. Folhas malformadas, que a 2.1.1 e anteriores aceitavam, agora são um erro: cada folha deve ser um digest hex de 32 bytes. Hex em maiúsculas é aceito e a raiz é devolvida em minúsculas. Um array vazio dá o mesmo erro de antes (`dualMerkleRoot` lança uma exceção), e o resultado mantém seus dois campos, `sha256` e `sha3_256`.

`verifyBundle`, as demais APIs, `dcp-jcs-v1` e as APIs experimentais opt-in `dcp-jcs-v2` não mudam, e nenhuma API JavaScript é adicionada. O tarball não contém mais os READMEs traduzidos, que agora ficam na árvore `i18n/` do repositório. O WebAssembly vem do Rust `dcp-ai` 2.12.0, também preparado e não publicado (veja [Rust](../../../docs/RUST_RELEASE.md)).

> **Nota (05/11/2026).** Os parágrafos acima foram escritos em 30/10/2026 para a 2.1.2 preparada, que nunca foi publicada. Desde o #116 (02/11/2026), `verifyBundle` na `main` executa a validação de esquemas V2-2 no núcleo Rust que encapsula; a 2.1.2 não contém essa mudança, e a 2.1.3 acima contém. A 2.1.3 substitui a 2.1.2, e os manifestos da `main` levam a 2.1.3. Textos e tabelas que citam a 2.1.2, inclusive a linha de `dualMerkleRoot` do README do WASM, são históricos. Veja o [dossiê de auditoria](../../../docs/conformance/AUDIT_DOSSIER.md#artifacts).

<a id="related-releases"></a>

## Publicações relacionadas

As versões atuais em cada registro estão em [Versões publicadas](../../../docs/README.md#published-versions). Outras notas de publicação: [Python 2.10.2](../../../docs/PYTHON_RELEASE.md), [Go v2.13.0](../../../docs/GO_RELEASE.md) e [Rust 2.13.0](../../../docs/RUST_RELEASE.md).
