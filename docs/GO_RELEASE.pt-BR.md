<a id="published-go-module"></a>

# Módulo Go publicado

**Publicação Rust (26/10/2026).** Rust `dcp-ai` 2.11.0 está publicado no crates.io, incluindo correções do verificador, admissão e APIs experimentais opt-in. `dcp-jcs-v1` continua sendo o perfil normativo padrão. Veja [Rust 2.11.0](RUST_RELEASE.md).

> Tradução informativa da [versão em inglês](GO_RELEASE.md), atualizada em 26/10/2026. Em caso de divergência, prevalece a versão em inglês.

Verificado em 26/10/2026: o SDK Go `v2.11.0` está publicado pela [tag `sdks/go/v2.11.0`](https://github.com/dcp-ai-protocol/dcp-ai/tree/sdks/go/v2.11.0/sdks/go). O módulo e suas importações mantêm `/v2`. A versão do SDK é independente do formato/especificação DCP. Go não exige token adicional de registro: os consumidores resolvem a tag do repositório pelo sistema de módulos Go.

<a id="install"></a>

## Instalar

Requer Go 1.25+. Execute no módulo da sua aplicação. Atualize e versione seus arquivos `go.mod` e `go.sum`:

```bash
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.11.0
go mod verify
```

<a id="upgrade-and-compatibility"></a>

## Atualização e compatibilidade

Inclui tratamento de erros de comprimento de chave V1, verificação corrigida de principal/chaves/artefatos/checkpoints V2, confiança explícita no principal e `strict-v1`, cadeias de delegação e sessões A2A concorrentes com proteção contra replay. A telemetria do SDK informa `2.11.0`. Veja o [README do SDK](../sdks/go/README.md), o [guia de admissão](ADMISSION.md) e a [política de segurança](../SECURITY.md).

A verificação é mais rigorosa que na v2.10.0: evidências malformadas ou inconsistentes antes aceitas podem ser rejeitadas. Preserve evidências históricas sem reescrevê-las. `dcp-jcs-v1` continua como padrão normativo; as APIs `dcp-jcs-v2` continuam experimentais, não normativas e opt-in explícito. Verificação não equivale a confiança no principal, admissão ou autorização. A cadeia secundária opcional de auditoria SHA3-256 continua fora das verificações documentadas do verificador.

<a id="validation"></a>

## Validação

A suíte padrão e a suíte `-race -tags otlp` passaram em 1.154 testes/subtestes cada; um teste é reservado intencionalmente para a matriz ao vivo de produtores/consumidores. Passaram `go mod tidy -diff`, compilação e vet. Um consumidor externo passou em 137 testes/subtestes e seu controle negativo falhou como esperado. O módulo publicado foi baixado em cache novo pelo proxy público com verificação de checksums; as fontes coincidiram com o commit revisado. Depois, o consumidor passou sem diretiva `replace` local. Para a publicação independente do Rust, veja [Rust 2.11.0](RUST_RELEASE.md).
