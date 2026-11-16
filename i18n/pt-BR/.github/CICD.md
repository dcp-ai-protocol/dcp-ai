<sub>[English](../../../.github/CICD.md) · [中文](../../zh-CN/.github/CICD.md) · [Español](../../es/.github/CICD.md) · [日本語](../../ja/.github/CICD.md) · **Português**</sub>

<a id="github-actions--ci"></a>
<a id="github-actions-ci"></a>

# GitHub Actions e CI

> Tradução informativa da [versão em inglês](../../../.github/CICD.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

As GitHub Actions e o fluxo de CI deste repositório: duas ações compostas em `.github/actions/` e o fluxo `ci.yml`.

> **Os fluxos deste repositório não exercitam as ações** (25/10/2026), e elas não foram testadas a partir de outro repositório. As duas executam código de um checkout deste repositório: `verify-bundle` carrega `lib/verify.js`, que precisa do SDK do workspace (`sdks/typescript`) compilado, e `conformance-test` executa `tools/conformance.js` do workspace, então só funciona em um checkout deste repositório. Para verificar bundles no seu próprio pipeline, veja [Verificar bundles no seu projeto](#verifying-bundles-in-your-project).

<a id="available-actions"></a>

## Ações disponíveis

### `verify-bundle`

Verifica um Signed Bundle do DCP em um fluxo do GitHub Actions com o verificador de referência (`lib/verify.js`). Os bundles V1 passam por checagens de schema, assinatura Ed25519, cadeia de auditoria e Merkle. Os bundles V2 normativos (`schemas/v2/signed_bundle.schema.json`) são validados contra o schema e depois verificados por `@dcp-ai/sdk`: manifesto, assinatura composta Ed25519 + ML-DSA-65, vinculação de sessão e cadeia de auditoria.

Ela instala o pacote raiz do checkout a partir do qual é executada (`npm install --production`, ignorando os erros de instalação) e não compila o SDK do workspace, então compile `sdks/typescript` em uma etapa anterior. Ela verifica com a política padrão: não há nenhuma entrada de política.

Use só entradas de caminho literais e confiáveis: a ação as interpola em shell e em JavaScript avaliado com `eval`, em vez de passá-las como dados. Aspas ou sintaxe de shell em um caminho podem mudar o comando. Não derive essas entradas de um pull request, issue ou nome de artefato não confiáveis. O exemplo com a CLI de referência abaixo passa o caminho como argumento.

```yaml
- uses: ./.github/actions/verify-bundle
  with:
    bundle-path: "path/to/signed_bundle.json"
    public-key-path: "keys/public_key.txt"  # Optional
    fail-on-invalid: "true"
    node-version: "20"
```

<a id="inputs"></a>

#### Entradas

| Entrada | Obrigatória | Padrão | Descrição |
|-------|----------|---------|-------------|
| `bundle-path` | Sim | — | Caminho do arquivo JSON do bundle assinado |
| `public-key-path` | Não | — | Caminho da chave pública Ed25519 esperada. V1: verifica contra ela (caso contrário, usa a chave embutida no bundle). V2: fixa o signatário clássico do bundle |
| `fail-on-invalid` | Não | `"true"` | Faz a etapa falhar se o bundle for inválido |
| `node-version` | Não | `"20"` | Versão do Node.js |

<a id="outputs"></a>

#### Saídas

| Saída | Descrição |
|--------|-------------|
| `verified` | `"true"` ou `"false"` |
| `errors` | Erros de verificação (se houver) |

<a id="usage-example"></a>

#### Exemplo de uso

Um esboço para um checkout deste repositório (não executado para esta página): a ação e `lib/verify.js` vêm do
checkout, e `agent/citizenship_bundle.signed.json` e `agent/public_key.txt` representam arquivos fornecidos pelo
operador.

```yaml
name: Verify Agent Bundle
on: [push]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Build the workspace SDK (the action does not)
        run: (cd sdks/typescript && npm ci && npm run build)

      - name: Verify DCP Bundle
        id: verify
        uses: ./.github/actions/verify-bundle
        with:
          bundle-path: "agent/citizenship_bundle.signed.json"
          public-key-path: "agent/public_key.txt"

      - name: Check result
        run: echo "Verified: ${{ steps.verify.outputs.verified }}"
```

### `conformance-test`

Executa `node tools/conformance.js` no workspace: a suíte de conformidade V1 + V2 do repositório, sobre os seus próprios exemplos. Só funciona em um checkout deste repositório, e a sua entrada `test-dir` não é usada.

```yaml
- uses: ./.github/actions/conformance-test
  with:
    node-version: "20"
    test-dir: "tests/conformance/examples"
```

<a id="inputs-1"></a>
<a id="inputs_1"></a>

#### Entradas

| Entrada | Obrigatória | Padrão | Descrição |
|-------|----------|---------|-------------|
| `node-version` | Não | `"20"` | Versão do Node.js |
| `test-dir` | Não | `"tests/conformance/examples"` | Não é usada pela ação |

<a id="outputs-1"></a>
<a id="outputs_1"></a>

#### Saídas

| Saída | Descrição |
|--------|-------------|
| `passed` | Se todos os testes passaram |
| `summary` | Resumo dos testes |

<a id="usage-example-1"></a>
<a id="usage-example_1"></a>

#### Exemplo de uso

Um esboço para um checkout deste repositório (não executado para esta página). `tools/conformance.js` importa
`@dcp-ai/sdk`, então o SDK do workspace é compilado antes:

```yaml
name: DCP Conformance
on: [push]

jobs:
  conformance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Build the workspace SDK (the action does not)
        run: (cd sdks/typescript && npm ci && npm run build)

      - name: Run Conformance Tests
        id: conform
        uses: ./.github/actions/conformance-test

      - name: Results
        run: echo "${{ steps.conform.outputs.summary }}"
```

<a id="ci-workflow"></a>

## Fluxo de CI

O fluxo `ci.yml` é executado nos pushes para `main` e nos pull requests contra qualquer branch base. Um job `changes` detecta quais partes mudaram (`dorny/paths-filter`), e os jobs abaixo são executados para essas partes:

| Job | O que executa |
|-----|--------------|
| `conformance` | Node.js 20 e 22: `npm install`, `npm run conformance`, os testes do intervalo do escalar S de `tools/crypto.js` e do playground, `npm run examples:generate:v2`, `dcp verify-bundle` nos exemplos V1 e V2 (V2 com `hybrid_required`) e `dcp integrity` |
| `typescript-sdk` | `sdks/typescript`: `npm install`, `npx tsc --noEmit`, `npm run build`, `npm run test`, cobertura |
| `integrations` | `anthropic-mcp`, `express`, `google-a2a`, `openclaw`: compila o SDK do workspace, `npm ci`, build, `vitest run` |
| `cli` | Node.js 20 e 22: compila o SDK do workspace, instala-o em `cli/`, os testes da CLI e o seu controle negativo, e uma checagem dos arquivos empacotados |
| `python-sdk` | Python 3.12: `pip install -e ".[dev]"`, `pytest` com cobertura |
| `go-sdk` | Go conforme `sdks/go/go.mod`: `go build ./...`, `go test` com cobertura |
| `rust-sdk` | Rust estável: `cargo build`, `cargo build --features otlp`, cobertura, `cargo test --all-features`, um build dos testes para `wasm32-unknown-unknown` |
| `wasm-sdk` | Rust estável e `wasm-pack`: `npm run build:wasm`, `npm test` em `sdks/wasm` |

Outros fluxos cobrem a matriz e o laboratório do candidato de canonicalização, os contratos, o fuzzing diferencial, a matriz de interoperabilidade, os rótulos e a publicação (npm, PyPI, imagens Docker, integrações, modelos). Dois cobrem a documentação, e nenhum traduz nada automaticamente: `i18n-sync.yml` («Documentation and i18n») checa, nos pull requests e nos pushes para `main` que mexem em Markdown ou nas ferramentas de documentação, a cobertura, os hashes revisados, a estrutura e os links dos cinco idiomas, executa os controles positivos e negativos dessa barreira e constrói o site nos cinco idiomas; `docs.yml` constrói o mesmo site em `main` e o implanta no GitHub Pages.

Para executar localmente as mesmas checagens de documentação, veja [Documentation and translations](../../../CONTRIBUTING.md#documentation-and-translations) no CONTRIBUTING.md:

```bash
pip install 'mkdocs==1.6.*' 'mkdocs-material==9.5.*' 'pymdown-extensions==10.*'
python3 scripts/docs_i18n.py check
python3 -m unittest discover -s scripts -p 'test_docs*.py' -v
bash scripts/build-docs-site.sh
```

<a id="verifying-bundles-in-your-project"></a>

## Verificar bundles no seu projeto

Um esboço que verifica um bundle com a CLI de referência de um checkout fixado (não executado para esta página). `dcp verify-bundle` sai com 0 quando o bundle é verificado e com um valor diferente de zero caso contrário, e só lê arquivos sob o diretório atual:

```yaml
# .github/workflows/dcp.yml
name: DCP Verification
on: [push, pull_request]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/checkout@v4
        with:
          repository: dcp-ai-protocol/dcp-ai
          ref: <full commit SHA you have reviewed>
          path: dcp-ai

      - uses: actions/setup-node@v4
        with:
          node-version: "22"

      - name: Build the reference verifier
        run: |
          (cd dcp-ai/sdks/typescript && npm ci && npm run build)
          (cd dcp-ai && npm install)

      - name: Verify the agent's bundle
        run: node dcp-ai/bin/dcp.js verify-bundle --policy hybrid_required my-agent/bundle.signed.json
```

Um bundle verificado está íntegro e assinado pelas chaves que nomeia; para aceitar bundles só de principais em que você confia, use a admissão (`dcp admit-bundle`, veja [docs/ADMISSION.md](../../../docs/ADMISSION.md)).

<a id="license"></a>

## Licença

Apache-2.0
