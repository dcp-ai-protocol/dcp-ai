<a id="published-go-module"></a>

# Módulo Go publicado

> Tradução informativa da [versão em inglês](GO_RELEASE.md), atualizada em 28/10/2026. Em caso de divergência, prevalece a versão em inglês.

Verificado em 28/10/2026: o SDK Go `v2.11.1` está publicado pela [tag `sdks/go/v2.11.1`](https://github.com/dcp-ai-protocol/dcp-ai/tree/sdks/go/v2.11.1/sdks/go), e o proxy público de módulos e a base de dados de checksums o servem. A publicação anterior, `v2.11.0` ([`sdks/go/v2.11.0`](https://github.com/dcp-ai-protocol/dcp-ai/tree/sdks/go/v2.11.0/sdks/go)), foi verificada em 26/10/2026; suas notas são mantidas abaixo. O módulo e suas importações mantêm `/v2`. A versão do SDK é independente do formato/especificação DCP. Go não exige token adicional de registro: os consumidores resolvem a tag do repositório pelo sistema de módulos Go.

<a id="install"></a>

## Instalar

Requer Go 1.25+. Execute no módulo da sua aplicação. Atualize e versione seus arquivos `go.mod` e `go.sum`:

```bash
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.11.1
go mod verify
```

<a id="what-changed-in-v2111"></a>

## O que mudou na v2.11.1

Verifica os campos secundários SHA3-256 do [VERIFICATION.md V2-11](../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) quando estão presentes: `audit_merkle_root_secondary` (a árvore SHA3-256 construída como a primária; `sha3-256:` seguido de 64 zeros para uma trilha vazia), cada `prev_hash_secondary` (`"GENESIS"` na primeira entrada e, depois, o SHA3-256 da entrada anterior tal como consta) e cada `intent_hash_secondary` (o SHA3-256 do payload da intenção). Os campos ausentes não são exigidos, então um bundle verificado pode não ter uma cadeia secundária completa. Um campo presente que seja `null`, não seja uma string ou seja inconsistente é rejeitado: é uma mudança de aceitação para evidências que trazem esses campos, que a v2.11.0 aceitava. Não mudam as APIs, os campos de resultado, `dcp-jcs-v1`, as APIs experimentais opt-in de `dcp-jcs-v2` nem o tratamento de `hash_alg`. A verificação continua não sendo confiança no principal, admissão nem autorização. A telemetria do SDK informa `2.11.1`.

<a id="upgrade-and-compatibility"></a>

## Atualização e compatibilidade

A v2.11.0 (26/10/2026) incluía, e a v2.11.1 mantém, tratamento de erros de comprimento de chave V1, verificação corrigida de principal/chaves/artefatos/checkpoints V2, confiança explícita no principal e `strict-v1`, cadeias de delegação e sessões A2A concorrentes com proteção contra replay. Na v2.11.0, a telemetria do SDK informava `2.11.0`. Veja o [README do SDK](../sdks/go/README.md), o [guia de admissão](ADMISSION.md) e a [política de segurança](../SECURITY.md).

A verificação é mais rigorosa que na v2.10.0: evidências malformadas ou inconsistentes antes aceitas podem ser rejeitadas. Preserve evidências históricas sem reescrevê-las. `dcp-jcs-v1` continua como padrão normativo; as APIs `dcp-jcs-v2` continuam experimentais, não normativas e opt-in explícito. Verificação não equivale a confiança no principal, admissão ou autorização. Na v2.11.0, os campos secundários SHA3-256 opcionais ficavam fora das verificações do verificador; a v2.11.1 os verifica quando presentes.

<a id="validation"></a>

## Validação

Para a v2.11.1, os 84 arquivos do zip do módulo servido pelo proxy são idênticos a `main` (o Go acrescenta ao zip o `LICENSE` raiz do repositório), e o proxy e a base de dados de checksums confirmaram a versão. Um consumidor externo que resolve `v2.11.1` pelo proxy, sem `replace` local, passou em 189 testes.

Para a v2.11.0 (26/10/2026), a suíte padrão e a suíte `-race -tags otlp` passaram em 1.154 testes/subtestes cada; um teste é reservado intencionalmente para a matriz ao vivo de produtores/consumidores. Passaram `go mod tidy -diff`, compilação e vet. Um consumidor externo passou em 137 testes/subtestes e seu controle negativo falhou como esperado. O módulo publicado foi baixado em cache novo pelo proxy público com verificação de checksums; as fontes coincidiram com o commit revisado. Depois, o consumidor passou sem diretiva `replace` local. Para a publicação independente do Rust, veja [Rust](RUST_RELEASE.md).

<a id="related-releases"></a>

## Publicações relacionadas

As versões atuais em cada registro estão em [Versões publicadas](README.md#published-versions). Outras notas de publicação: [pacotes npm](NPM_RELEASES.md), [Python 2.10.1](PYTHON_RELEASE.md) e [Rust 2.11.1](RUST_RELEASE.md).
