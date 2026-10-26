<sub>[English](CONTRIBUTING.md) · [中文](CONTRIBUTING.zh-CN.md) · [Español](CONTRIBUTING.es.md) · [日本語](CONTRIBUTING.ja.md) · **Português**</sub>

<a id="contributing-to-dcp-ai"></a>

# Contribuir com o DCP-AI

> Tradução informativa da [versão em inglês](CONTRIBUTING.md), atualizada em 26/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Obrigado pelo interesse em contribuir com o Digital Citizenship Protocol para agentes de IA. Este guia ajuda você a começar.

<a id="development-environment-setup"></a>

## Configurar o ambiente de desenvolvimento

<a id="prerequisites"></a>

### Pré-requisitos

- **Node.js** >= 20 (o protocolo central e o SDK TypeScript; a CI usa 20 e 22)
- **Python** >= 3.10 (o SDK Python; a CI usa 3.12)
- **Go** >= 1.25 (necessário para o SDK Go)
- **Rust** (toolchain estável, necessário para o SDK Rust)
- **Git**

<a id="getting-started"></a>

### Primeiros passos

```bash
# Clone the repository
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai

# The root package uses the workspace SDK to test the checked-out source: build it first
(cd sdks/typescript && npm install && npm run build)

# Install root dependencies (core protocol + reference CLI); reinstall after rebuilding the SDK
npm install

# Run conformance tests to verify your setup (should print "DCP-AI CONFORMANCE PASS (V1 + V2)")
npm run conformance
```

<a id="sdk-setup"></a>

### Configurar os SDKs

Cada SDK fica no próprio diretório em `sdks/` e tem dependências independentes. Execute estes comandos a partir da raiz do repositório; cada subshell volta para ela:

```bash
# TypeScript SDK
(cd sdks/typescript && npm install)

# Python SDK
(cd sdks/python && pip install -e ".[dev]")

# Go SDK
(cd sdks/go && go mod download)

# Rust SDK
(cd sdks/rust && cargo build)

# WASM SDK (requires Rust + wasm-pack + Node.js)
(cd sdks/wasm && npm install && npm run build:wasm)
```

<a id="running-tests"></a>

## Executar os testes

<a id="core-protocol"></a>

### Protocolo central

```bash
npm run conformance
```

### SDKs

```bash
# TypeScript
(cd sdks/typescript && npm run test)           # Run tests
(cd sdks/typescript && npm run test:coverage)  # Run tests with coverage

# Python
(cd sdks/python && pytest -v)

# Go
(cd sdks/go && go test ./...)

# Rust
(cd sdks/rust && cargo test)

# WASM (build verification)
(cd sdks/wasm && npm test)
```

<a id="cross-sdk"></a>

### Entre SDKs

Cada SDK lê os vetores compartilhados de `tests/interop/v2/` na própria suíte de testes. Duas ferramentas verificam os SDKs uns contra os outros (compile antes `sdks/typescript` e instale `sdks/python`; Go e Rust devem estar no `PATH`):

```bash
node tools/interop-matrix/run.mjs   # agents on the four SDKs sign and verify each other's bundles
node tools/difffuzz/run.mjs         # the same mutated bundle through the four verifiers
```

As duas rodam na CI em cada pull request, e todas as noites.

<a id="documentation-and-translations"></a>

### Documentação e traduções

Os documentos públicos têm uma fonte em inglês e quatro traduções (`<name>.es.md`, `<name>.pt-BR.md`,
`<name>.ja.md`, `<name>.zh-CN.md`), listadas em `scripts/docs-i18n.json`; se divergirem, prevalece o texto
em inglês. As verificações exigem o conjunto de ferramentas de documentação que a CI instala, que também fornece os módulos
`markdown` e `yaml`:

```bash
pip install 'mkdocs==1.6.*' 'mkdocs-material==9.5.*' 'pymdown-extensions==10.*'
python3 scripts/docs_i18n.py check                             # coverage, reviewed hashes, structure and links
python3 -m unittest discover -s scripts -p 'test_docs*.py' -v  # positive and negative controls of the gate
bash scripts/build-docs-site.sh                                 # builds and validates all five languages
```

`build-docs-site.sh` constrói e valida o site; não execute `mkdocs build` depois dele. Para uma pré-visualização local de
um idioma, que não é uma construção completa:

```bash
python3 scripts/docs_site.py preview --locale en
mkdocs serve -f docs-site/en/mkdocs.yml
```

Ao alterar um documento, mantenha completas as quatro traduções dele, com o aviso, as âncoras e os blocos de código
iguais aos do inglês. Só depois de ler as quatro diante do novo texto em inglês, registre os hashes dele:

```bash
python3 scripts/docs_i18n.py record <source.md> --reviewed
```

Isso registra hashes; não certifica a qualidade de uma tradução. Não registre um documento cujas
traduções você não leu.

<a id="code-style"></a>

## Estilo de código

O projeto usa ferramentas automáticas para manter um estilo de código consistente:

- **ESLint** para o lint de JavaScript/TypeScript (veja `.eslintrc.json`)
- **Prettier** para a formatação do código (veja `.prettierrc.json`)
- **EditorConfig** para as configurações básicas do editor (veja `.editorconfig`)

<a id="key-rules"></a>

### Regras principais

- Use `const` por padrão; nunca use `var`
- Use aspas simples para strings
- Inclua sempre vírgulas finais
- A largura máxima de linha é de 100 caracteres
- Use indentação de 2 espaços (exceto em Makefiles)

Formate o código antes do commit (o pacote raiz não instala o Prettier nem o ESLint, então o `npx` os baixa quando não estão instalados):

```bash
npx prettier --write .
npx eslint --fix .
```

<a id="submitting-pull-requests"></a>

## Enviar pull requests

1. **Faça um fork do repositório** e crie um branch de trabalho a partir de `main`.
2. **Faça as alterações** em commits focados e lógicos.
3. **Escreva ou atualize os testes** de qualquer funcionalidade nova ou correção.
4. **Garanta que todos os testes passam** localmente antes de abrir um PR.
5. **Abra um pull request** contra `main` com uma descrição clara do que mudou e por quê.

<a id="pr-checklist"></a>

### Checklist do PR

- [ ] Todos os testes existentes passam
- [ ] Novos testes adicionados para a funcionalidade nova
- [ ] O código segue as diretrizes de estilo do projeto
- [ ] Documentação atualizada, se for o caso, em todos os idiomas que o documento tem
- [ ] Mudanças em assinatura, hashing, canonicalização ou verificação: vetores compartilhados atualizados e a matriz de interoperabilidade passa
- [ ] As mensagens de commit seguem o formato abaixo

<a id="commit-message-format"></a>

## Formato das mensagens de commit

Use mensagens de commit convencionais:

```
<type>(<scope>): <short summary>

<optional body>
```

<a id="types"></a>

### Tipos

- **feat**: uma funcionalidade nova
- **fix**: uma correção de bug
- **docs**: apenas mudanças de documentação
- **style**: formatação, ponto e vírgula ausente etc. (sem mudança de código)
- **refactor**: mudança de código que não corrige bug nem adiciona funcionalidade
- **test**: adicionar ou atualizar testes
- **chore**: processo de build, atualização de dependências, ferramentas

<a id="scopes"></a>

### Escopos

- **core**: protocolo central, CLI, esquemas
- **sdk/ts**: SDK TypeScript
- **sdk/py**: SDK Python
- **sdk/go**: SDK Go
- **sdk/rust**: SDK Rust
- **sdk/wasm**: SDK WASM
- **integration/\***: integrações com frameworks
- **ci**: workflows de CI/CD

<a id="examples"></a>

### Exemplos

```
feat(sdk/ts): add post-quantum signature support
fix(core): correct Merkle root computation for single-entry chains
docs(sdk/py): add installation instructions for extras
test(core): add conformance tests for expired bundles
chore(ci): add code coverage to TypeScript SDK workflow
```

<a id="testing-requirements"></a>

## Requisitos de teste

- Toda funcionalidade nova deve incluir os testes correspondentes.
- Correções de bugs devem incluir um teste de regressão que teria detectado o bug.
- Os testes de conformidade em `tests/conformance/` verificam a aderência ao protocolo em todas as implementações.
- Uma regra que todos os SDKs aplicam recebe um vetor compartilhado em `tests/interop/v2/`, para que os quatro SDKs sejam testados com o mesmo caso.
- Os testes dos SDKs devem cobrir a criação de bundles, a assinatura, a verificação e os casos de erro.
- A CI deve passar antes que um PR possa ser mesclado. Falhas de teste não são suprimidas: se os testes falham, o build falha.

<a id="questions"></a>

## Dúvidas?

Se tiver dúvidas sobre como contribuir, abra uma issue no GitHub ou inicie uma discussão. Teremos prazer em ajudar você a começar.
