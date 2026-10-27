<a id="published-rust-crate"></a>

# Crate Rust publicado

> Tradução informativa do [original em inglês](RUST_RELEASE.md), revisada em 26/10/2026. Os identificadores e exemplos de código são preservados sem tradução.

Verificado em 26/10/2026: [`dcp-ai` 2.11.0](https://crates.io/crates/dcp-ai/2.11.0) está disponível no crates.io. A versão do crate é independente da versão do formato/especificação DCP. Esta publicação atualiza apenas Rust; npm, Python, Go e contêineres têm publicações independentes.

<a id="install"></a>

## Instalação

Execute no crate da aplicação com uma versão estável atual do Rust. Registre as alterações em `Cargo.toml` e `Cargo.lock`. Estes exemplos permitem atualizações compatíveis 2.x; use `=2.11.0` no manifest se precisar fixar a versão exata.

```bash
cargo add dcp-ai@2.11.0
cargo check --locked
```

```toml
[dependencies]
dcp-ai = "2.11.0"
```

A exportação OTLP e os bindings WebAssembly opcionais são selecionados com `otlp` e `wasm`. Ative apenas as funcionalidades necessárias ao destino. Esta versão Rust não republica o pacote WASM separado do npm.

<a id="upgrade-and-compatibility"></a>

## Atualização e compatibilidade

Esta versão inclui correções na verificação V2 de principal, chaves, artefatos e checkpoints, confiança explícita e `strict-v1`, cadeias de delegação, construção/assinatura V2 e APIs candidatas experimentais. A compatibilidade de `V2VerificationResult` com seus dez campos é preservada; os detalhes dos signatários ficam separados. A telemetria informa `2.11.0`. Veja o [README do SDK](../sdks/rust/README.md), o [guia de admissão](ADMISSION.md) e a [política de segurança](../SECURITY.md).

A verificação é mais estrita que em 2.10.0: pode rejeitar evidências malformadas ou inconsistentes antes aceitas. Preserve as evidências históricas em vez de reescrevê-las. `dcp-jcs-v1` continua normativo e padrão; `dcp-jcs-v2` é experimental, não normativo e opt-in. Verificar não concede confiança no principal, admissão nem autorização. Rust ainda não implementa criptografia de sessões A2A AES-256-GCM nem sua janela de replay, e o construtor V2 não gera checkpoints PQ. O verificador confere a cadeia de auditoria primária, mas não recalcula a cadeia/raiz secundária SHA3-256 opcional.

<a id="validation"></a>

## Validação

A suíte padrão passou em 261 testes e a de todas as funcionalidades, em 267, incluindo doctests. A biblioteca e os testes WASM compilaram para `wasm32-unknown-unknown`; isso não é um teste de execução no navegador. O Cargo empacotou e verificou 71 arquivos, e a simulação de publicação passou. Um consumidor externo passou em 72 testes do crate extraído: admissão, compatibilidade, entrada/roteador candidato e regressões do verificador; o controle negativo invertido falhou como esperado. Após publicar, um cache novo do registro resolveu exatamente 2.11.0 sem caminhos locais nem patches, e os mesmos 72 testes passaram. O checksum do arquivo público e os bytes das fontes empacotadas coincidiram com a versão revisada. As fixtures compartilhadas desses testes vêm do repositório; as aplicações não precisam delas.
