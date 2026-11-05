<a id="published-rust-crate"></a>

# Crate Rust publicado

> Tradução informativa do [original em inglês](../../../docs/RUST_RELEASE.md), revisada em 05/11/2026. Os identificadores e exemplos de código são preservados sem tradução.

Verificado em 05/11/2026: [`dcp-ai` 2.13.0](https://crates.io/crates/dcp-ai/2.13.0) está disponível no crates.io ([o que mudou](#what-changed-in-2130)). As publicações anteriores, [2.11.1](https://crates.io/crates/dcp-ai/2.11.1), verificada em 28/10/2026, e [2.11.0](https://crates.io/crates/dcp-ai/2.11.0), verificada em 26/10/2026, mantêm suas notas abaixo. A versão do crate é independente da versão do formato/especificação DCP. O crate Rust é publicado de forma independente de npm, Python, Go e contêineres.

<a id="install"></a>

## Instalação

Execute no crate da aplicação com uma versão estável atual do Rust. Registre as alterações em `Cargo.toml` e `Cargo.lock`. Estes exemplos permitem atualizações compatíveis 2.x; use `=2.13.0` no manifest se precisar fixar a versão exata.

```bash
cargo add dcp-ai@2.13.0
cargo check --locked
```

```toml
[dependencies]
dcp-ai = "2.13.0"
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

Para a 2.13.0, o workflow de publicação publicou o crate a partir da `main` (`46b142bd`). Todos os arquivos do crate do registro coincidem com o artefato testado antes da publicação, exceto `.cargo_vcs_info.json`, que registra esse commit em vez do commit de compilação do candidato. Um consumidor que resolveu a 2.13.0 pelo crates.io, num Cargo home novo e sem dependência por path nem patch, passou no kit de conformidade externo (697 casos em sete catálogos) e na verificação do perfil padrão: o bundle golden `dcp-jcs-v1` é verificado, e o mesmo bundle declarando `dcp-jcs-v2` é rejeitado.

Para a 2.11.1, o fluxo de publicação publicou o crate; todos os arquivos do crate do registro coincidem com os revisados, exceto `.cargo_vcs_info.json`, que registra o commit limpo de `main`. Um consumidor externo que resolve 2.11.1 pelo crates.io passou em 73 testes.

Para a 2.11.0 (26/10/2026), a suíte padrão passou em 261 testes e a de todas as funcionalidades, em 267, incluindo doctests. A biblioteca e os testes WASM compilaram para `wasm32-unknown-unknown`; isso não é um teste de execução no navegador. O Cargo empacotou e verificou 71 arquivos, e a simulação de publicação passou. Um consumidor externo passou em 72 testes do crate extraído: admissão, compatibilidade, entrada/roteador candidato e regressões do verificador; o controle negativo invertido falhou como esperado. Após publicar, um cache novo do registro resolveu exatamente 2.11.0 sem caminhos locais nem patches, e os mesmos 72 testes passaram. O checksum do arquivo público e os bytes das fontes empacotadas coincidiram com a versão revisada. As fixtures compartilhadas desses testes vêm do repositório; as aplicações não precisam delas.

<a id="what-changed-in-2130"></a>

## O que mudou na 2.13.0

A 2.13.0 foi publicada no crates.io em 05/11/2026 pelo workflow de publicação, a partir da `main` (`46b142bd`). Ela substitui a 2.12.0 abaixo, que nunca foi publicada. Em comparação com a 2.11.1, a 2.13.0:

- **Executa a validação de esquemas V2-2 (mudança de aceitação).** `verify_signed_bundle_v2`, `…_with_policy` e `…_at`, incluindo o build WASM, validam o envelope do bundle assinado e os quatro payloads contra `schemas/v2` antes de qualquer verificação de hash, chave ou assinatura. Bundles inválidos pelo esquema que antes eram aceitos agora falham com diagnósticos `schema: <pointer> <keyword>`.
- **Adiciona `RawAuditEventV2` e `RawAuditEventError`**, como a 2.12.0 abaixo.
- **Corrige `wasm_dual_merkle_root`** (com a feature `wasm`), como a 2.12.0 abaixo. Raízes calculadas com a função antiga ficam como foram registradas; veja [Migrar resultados de `dualMerkleRoot`](../../../docs/NPM_RELEASES.md#migrating-dualmerkleroot-results).
- **Alinha as verificações de mandatos.** `verify_mandate_validity` compara a janela como instantes, não mais como texto, e `verify_mandate_validity_at` (novo) recebe o instante da verificação. `verify_mandate_chain` rejeita um mandato raiz que repete um domínio.

A telemetria informa `2.13.0`. Não mudam o formato de transmissão, as assinaturas, os perfis, `dcp-jcs-v1` como padrão normativo nem as APIs experimentais de adesão explícita `dcp-jcs-v2`, e o crate agora inclui o `LICENSE` Apache-2.0. O pacote npm construído a partir deste código-fonte Rust é `@dcp-ai/wasm` 2.1.3, também publicado em 05/11/2026 (veja os [pacotes npm](../../../docs/NPM_RELEASES.md)). O README do crate publicado é o que foi preparado antes da publicação e diz "prepared, not published"; um crate publicado não pode mudar. Veja o [README do SDK](../../../sdks/rust/README.md) e o [changelog](../../../CHANGELOG.md#unreleased).

<a id="prepared-not-published-2120"></a>

## Preparada, não publicada: 2.12.0

A 2.12.0 está preparada no repositório desde 30/10/2026, mas não publicada no crates.io. Na época da preparação, os comandos de instalação continuavam na 2.11.1; os atuais, acima, indicam a 2.13.0. Em relação à 2.11.1, a 2.12.0:

- **Adiciona `dcp_ai::v2::types::RawAuditEventV2` e `RawAuditEventError`.** `RawAuditEventV2` guarda uma entrada de auditoria recebida como o `serde_json::Value` decodificado, de modo que cada membro mantém sua presença e sua condição de `null`, inclusive os desconhecidos. Ele mantém o valor decodificado, não o texto original: serializá-lo ou canonicalizá-lo com `dcp-jcs-v1` dá os bytes desse valor. `typed()` é uma visão com perda; `AuditEventV2` mantém seu comportamento. O parsing, a verificação e a canonicalização do bundle inteiro não mudam.
- **Corrige `wasm_dual_merkle_root` (com a feature `wasm`).** Agora calcula a raiz Merkle dupla com a redução da [VERIFICATION.md V2-11](../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) que o verificador de bundles usa (digests brutos de 32 bytes; numa camada ímpar o último nó é duplicado), e devolve um erro para uma folha que não é um digest hex de 32 bytes em vez de aceitar uma entrada malformada. O pacote npm construído a partir deste crate é `@dcp-ai/wasm` 2.1.2, também preparado e não publicado (veja os [pacotes npm](../../../docs/NPM_RELEASES.md)).

As demais APIs, `dcp-jcs-v1` e as APIs experimentais opt-in `dcp-jcs-v2` não mudam; os novos testes do candidato experimental não mudam nenhum padrão. A telemetria informa `2.12.0`. O crate não contém mais os READMEs traduzidos, que agora ficam na árvore `i18n/` do repositório. Veja o [README do SDK](../../../sdks/rust/README.md) e o [changelog](../../../CHANGELOG.md).

> **Nota (05/11/2026).** A comparação acima foi escrita em 30/10/2026 para a 2.12.0 preparada, que continua sem publicação. Desde então a `main` mudou a verificação: todos os verificadores V2, incluindo o build WASM, executam a validação de esquemas V2-2 (#116, 02/11/2026), e mudaram a função auxiliar de validade de mandatos, as verificações de tempo da cadeia e a verificação de domínios raiz repetidos (#117 a #119). Essas mudanças não estão na 2.12.0 descrita acima, que nunca foi publicada; a 2.13.0 acima as contém e a substitui, e os manifestos da `main` levam a 2.13.0. Veja o [dossiê de auditoria](../../../docs/conformance/AUDIT_DOSSIER.md#artifacts).

<a id="related-releases"></a>

## Publicações relacionadas

As versões atuais em cada registro estão em [Versões publicadas](../../../docs/README.md#published-versions). Outras notas de publicação: [pacotes npm](../../../docs/NPM_RELEASES.md), [Python 2.10.2](../../../docs/PYTHON_RELEASE.md) e [Go v2.13.0](../../../docs/GO_RELEASE.md).
