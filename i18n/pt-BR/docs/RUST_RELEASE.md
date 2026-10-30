<a id="published-rust-crate"></a>

# Crate Rust publicado

> Tradução informativa do [original em inglês](../../../docs/RUST_RELEASE.md), revisada em 28/10/2026. Os identificadores e exemplos de código são preservados sem tradução.

Verificado em 28/10/2026: [`dcp-ai` 2.11.1](https://crates.io/crates/dcp-ai/2.11.1) está disponível no crates.io. A publicação anterior, [2.11.0](https://crates.io/crates/dcp-ai/2.11.0), foi verificada em 26/10/2026; suas notas são mantidas abaixo. A versão do crate é independente da versão do formato/especificação DCP. O crate Rust é publicado de forma independente de npm, Python, Go e contêineres.

<a id="install"></a>

## Instalação

Execute no crate da aplicação com uma versão estável atual do Rust. Registre as alterações em `Cargo.toml` e `Cargo.lock`. Estes exemplos permitem atualizações compatíveis 2.x; use `=2.11.1` no manifest se precisar fixar a versão exata.

```bash
cargo add dcp-ai@2.11.1
cargo check --locked
```

```toml
[dependencies]
dcp-ai = "2.11.1"
```

A exportação OTLP e os bindings WebAssembly opcionais são selecionados com `otlp` e `wasm`. Ative apenas as funcionalidades necessárias ao destino. Esta versão Rust não republica o pacote WASM separado do npm.

<a id="what-changed-in-2111"></a>

## O que mudou na 2.11.1

Verifica os campos secundários SHA3-256 do [VERIFICATION.md V2-11](../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) quando estão presentes: `audit_merkle_root_secondary` (a árvore SHA3-256 construída como a primária; `sha3-256:` seguido de 64 zeros para uma trilha vazia), cada `prev_hash_secondary` (`"GENESIS"` na primeira entrada e, depois, o SHA3-256 da entrada anterior tal como consta) e cada `intent_hash_secondary` (o SHA3-256 do payload da intenção). Os campos ausentes não são exigidos, então um bundle verificado pode não ter uma cadeia secundária completa. Um campo presente que seja `null`, não seja uma string ou seja inconsistente é rejeitado: é uma mudança de aceitação para evidências que trazem esses campos, que a 2.11.0 aceitava. Não mudam as APIs, os campos de resultado, `dcp-jcs-v1`, as APIs experimentais opt-in de `dcp-jcs-v2` nem o tratamento de `hash_alg`. A verificação continua não sendo confiança no principal, admissão nem autorização. A telemetria informa `2.11.1`.

<a id="upgrade-and-compatibility"></a>

## Atualização e compatibilidade

A 2.11.0 (26/10/2026) incluía, e a 2.11.1 mantém, correções na verificação V2 de principal, chaves, artefatos e checkpoints, confiança explícita e `strict-v1`, cadeias de delegação, construção/assinatura V2 e APIs candidatas experimentais. A compatibilidade de `V2VerificationResult` com seus dez campos é preservada; os detalhes dos signatários ficam separados. Na 2.11.0, a telemetria informava `2.11.0`. Veja o [README do SDK](../../../sdks/rust/README.md), o [guia de admissão](../../../docs/ADMISSION.md) e a [política de segurança](../../../SECURITY.md).

A verificação é mais estrita que em 2.10.0: pode rejeitar evidências malformadas ou inconsistentes antes aceitas. Preserve as evidências históricas em vez de reescrevê-las. `dcp-jcs-v1` continua normativo e padrão; `dcp-jcs-v2` é experimental, não normativo e opt-in. Verificar não concede confiança no principal, admissão nem autorização. Rust ainda não implementa criptografia de sessões A2A AES-256-GCM nem sua janela de replay, e o construtor V2 não gera checkpoints PQ. Na 2.11.0, o verificador conferia a cadeia de auditoria primária, mas não os campos secundários SHA3-256 opcionais; a 2.11.1 os verifica quando presentes.

<a id="validation"></a>

## Validação

Para a 2.11.1, o fluxo de publicação publicou o crate; todos os arquivos do crate do registro coincidem com os revisados, exceto `.cargo_vcs_info.json`, que registra o commit limpo de `main`. Um consumidor externo que resolve 2.11.1 pelo crates.io passou em 73 testes.

Para a 2.11.0 (26/10/2026), a suíte padrão passou em 261 testes e a de todas as funcionalidades, em 267, incluindo doctests. A biblioteca e os testes WASM compilaram para `wasm32-unknown-unknown`; isso não é um teste de execução no navegador. O Cargo empacotou e verificou 71 arquivos, e a simulação de publicação passou. Um consumidor externo passou em 72 testes do crate extraído: admissão, compatibilidade, entrada/roteador candidato e regressões do verificador; o controle negativo invertido falhou como esperado. Após publicar, um cache novo do registro resolveu exatamente 2.11.0 sem caminhos locais nem patches, e os mesmos 72 testes passaram. O checksum do arquivo público e os bytes das fontes empacotadas coincidiram com a versão revisada. As fixtures compartilhadas desses testes vêm do repositório; as aplicações não precisam delas.

<a id="related-releases"></a>

## Publicações relacionadas

As versões atuais em cada registro estão em [Versões publicadas](../../../docs/README.md#published-versions). Outras notas de publicação: [pacotes npm](../../../docs/NPM_RELEASES.md), [Python 2.10.1](../../../docs/PYTHON_RELEASE.md) e [Go v2.11.1](../../../docs/GO_RELEASE.md).
