<sub>[English](CONTRIBUTING.md) · [中文](CONTRIBUTING.zh-CN.md) · [Español](CONTRIBUTING.es.md) · [日本語](CONTRIBUTING.ja.md) · **Português**</sub>

# Contribuindo para o DCP-AI

Obrigado pelo seu interesse em contribuir para o Digital Citizenship Protocol for AI Agents. Este guia vai ajudar você a começar.

## Configuração do Ambiente de Desenvolvimento

### Pré-requisitos

- **Node.js** >= 18 (obrigatório para o protocolo core e o TypeScript SDK)
- **Python** >= 3.12 (obrigatório para o Python SDK)
- **Go** >= 1.21 (obrigatório para o Go SDK)
- **Rust** (toolchain stable, obrigatório para o Rust SDK)
- **Git**

### Primeiros Passos

```bash
# Clone the repository
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai

# Install root dependencies (core protocol + CLI)
npm install

# Run conformance tests to verify your setup (should print "DCP-AI CONFORMANCE PASS (V1 + V2)")
npm run conformance
```

### Configuração dos SDKs

Cada SDK reside em seu próprio diretório em `sdks/` e tem dependências independentes:

```bash
# TypeScript SDK
cd sdks/typescript && npm install

# Python SDK
cd sdks/python && pip install -e ".[dev]"

# Go SDK
cd sdks/go && go mod download

# Rust SDK
cd sdks/rust && cargo build

# WASM SDK (requires Rust + wasm-pack + Node.js)
cd sdks/wasm && npm install
```

## Executando Testes

### Protocolo Core

```bash
npm run conformance
```

### SDKs

```bash
# TypeScript
cd sdks/typescript
npm run test              # Run tests
npm run test:coverage     # Run tests with coverage

# Python
cd sdks/python
pytest -v

# Go
cd sdks/go
go test ./...

# Rust
cd sdks/rust
cargo test

# WASM (build verification)
cd sdks/wasm
npm test
```

## Estilo de Código

Este projeto usa ferramentas automatizadas para garantir estilo de código consistente:

- **ESLint** para linting de JavaScript/TypeScript (veja `.eslintrc.json`)
- **Prettier** para formatação de código (veja `.prettierrc.json`)
- **EditorConfig** para configurações básicas de editor (veja `.editorconfig`)

### Regras Principais

- Use `const` por padrão; nunca use `var`
- Use aspas simples para strings
- Sempre inclua trailing commas
- Largura máxima da linha é 100 caracteres
- Use indentação de 2 espaços (exceto em Makefiles)

Formate seu código antes de fazer commit:

```bash
npx prettier --write .
npx eslint --fix .
```

## Enviando Pull Requests

1. **Faça um fork do repositório** e crie uma feature branch a partir de `main`.
2. **Faça suas alterações** em commits focados e lógicos.
3. **Escreva ou atualize testes** para qualquer nova funcionalidade ou correção de bug.
4. **Garanta que todos os testes passam** localmente antes de abrir um PR.
5. **Abra um pull request** contra `main` com uma descrição clara do que mudou e por quê.

### Checklist do PR

- [ ] Todos os testes existentes passam
- [ ] Novos testes adicionados para nova funcionalidade
- [ ] Código segue as diretrizes de estilo do projeto
- [ ] Documentação atualizada, se aplicável
- [ ] Mensagens de commit seguem o formato abaixo

## Formato da Mensagem de Commit

Use mensagens de commit convencionais:

```
<type>(<scope>): <short summary>

<optional body>
```

### Tipos

- **feat**: Uma nova funcionalidade
- **fix**: Uma correção de bug
- **docs**: Apenas alterações de documentação
- **style**: Formatação, ponto e vírgula ausente, etc. (sem alteração de código)
- **refactor**: Alteração de código que não corrige bug nem adiciona funcionalidade
- **test**: Adicionar ou atualizar testes
- **chore**: Processo de build, atualizações de dependências, ferramentas

### Escopos

- **core**: Protocolo core, CLI, schemas
- **sdk/ts**: TypeScript SDK
- **sdk/py**: Python SDK
- **sdk/go**: Go SDK
- **sdk/rust**: Rust SDK
- **sdk/wasm**: WASM SDK
- **integration/\***: Integrações com frameworks
- **ci**: Workflows de CI/CD

### Exemplos

```
feat(sdk/ts): add post-quantum signature support
fix(core): correct Merkle root computation for single-entry chains
docs(sdk/py): add installation instructions for extras
test(core): add conformance tests for expired bundles
chore(ci): add code coverage to TypeScript SDK workflow
```

## Requisitos de Teste

- Toda nova funcionalidade deve incluir testes correspondentes.
- Correções de bug devem incluir um teste de regressão que teria capturado o bug.
- Testes de conformance em `tests/conformance/` verificam a aderência ao protocolo em todas as implementações.
- Testes de SDK devem cobrir criação, assinatura, verificação de bundle e casos de erro.
- O CI precisa passar antes de um PR poder ser mesclado. Falhas de teste não são suprimidas — se os testes falham, o build falha.

## Perguntas?

Se você tem perguntas sobre como contribuir, abra uma issue no GitHub ou inicie uma discussão. Ficamos felizes em ajudar você a começar.
