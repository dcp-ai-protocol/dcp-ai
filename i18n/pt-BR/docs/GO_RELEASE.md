<a id="published-go-module"></a>

# Módulo Go publicado

> Tradução informativa da [versão em inglês](../../../docs/GO_RELEASE.md), atualizada em 05/11/2026. Em caso de divergência, prevalece a versão em inglês.

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

Verifica os campos secundários SHA3-256 do [VERIFICATION.md V2-11](../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) quando estão presentes: `audit_merkle_root_secondary` (a árvore SHA3-256 construída como a primária; `sha3-256:` seguido de 64 zeros para uma trilha vazia), cada `prev_hash_secondary` (`"GENESIS"` na primeira entrada e, depois, o SHA3-256 da entrada anterior tal como consta) e cada `intent_hash_secondary` (o SHA3-256 do payload da intenção). Os campos ausentes não são exigidos, então um bundle verificado pode não ter uma cadeia secundária completa. Um campo presente que seja `null`, não seja uma string ou seja inconsistente é rejeitado: é uma mudança de aceitação para evidências que trazem esses campos, que a v2.11.0 aceitava. Não mudam as APIs, os campos de resultado, `dcp-jcs-v1`, as APIs experimentais opt-in de `dcp-jcs-v2` nem o tratamento de `hash_alg`. A verificação continua não sendo confiança no principal, admissão nem autorização. A telemetria do SDK informa `2.11.1`.

<a id="upgrade-and-compatibility"></a>

## Atualização e compatibilidade

A v2.11.0 (26/10/2026) incluía, e a v2.11.1 mantém, tratamento de erros de comprimento de chave V1, verificação corrigida de principal/chaves/artefatos/checkpoints V2, confiança explícita no principal e `strict-v1`, cadeias de delegação e sessões A2A concorrentes com proteção contra replay. Na v2.11.0, a telemetria do SDK informava `2.11.0`. Veja o [README do SDK](../../../sdks/go/README.md), o [guia de admissão](../../../docs/ADMISSION.md) e a [política de segurança](../../../SECURITY.md).

A verificação é mais rigorosa que na v2.10.0: evidências malformadas ou inconsistentes antes aceitas podem ser rejeitadas. Preserve evidências históricas sem reescrevê-las. `dcp-jcs-v1` continua como padrão normativo; as APIs `dcp-jcs-v2` continuam experimentais, não normativas e opt-in explícito. Verificação não equivale a confiança no principal, admissão ou autorização. Na v2.11.0, os campos secundários SHA3-256 opcionais ficavam fora das verificações do verificador; a v2.11.1 os verifica quando presentes.

<a id="validation"></a>

## Validação

Para a v2.11.1, os 84 arquivos do zip do módulo servido pelo proxy são idênticos a `main` (o Go acrescenta ao zip o `LICENSE` raiz do repositório), e o proxy e a base de dados de checksums confirmaram a versão. Um consumidor externo que resolve `v2.11.1` pelo proxy, sem `replace` local, passou em 189 testes.

Para a v2.11.0 (26/10/2026), a suíte padrão e a suíte `-race -tags otlp` passaram em 1.154 testes/subtestes cada; um teste é reservado intencionalmente para a matriz ao vivo de produtores/consumidores. Passaram `go mod tidy -diff`, compilação e vet. Um consumidor externo passou em 137 testes/subtestes e seu controle negativo falhou como esperado. O módulo publicado foi baixado em cache novo pelo proxy público com verificação de checksums; as fontes coincidiram com o commit revisado. Depois, o consumidor passou sem diretiva `replace` local. Para a publicação independente do Rust, veja [Rust](../../../docs/RUST_RELEASE.md).

<a id="prepared-not-published-v2130"></a>

## Preparada, não publicada: v2.13.0

A v2.13.0 está preparada no repositório em 05/11/2026, mas não publicada: a tag `sdks/go/v2.13.0` não existe, então o proxy de módulos não serve esta versão e `go get` não consegue resolvê-la. O comando de instalação acima continua na v2.11.1. Ela substitui a v2.12.0 abaixo, que nunca recebeu tag. Em comparação com a v2.11.1, a v2.13.0:

- **Executa a validação de esquemas V2-2 (mudança de aceitação).** `v2.VerifySignedBundleV2` e suas variantes validam o envelope do bundle assinado e os quatro payloads contra `schemas/v2` antes de qualquer verificação de hash, chave ou assinatura. Bundles inválidos pelo esquema que antes eram aceitos agora falham com diagnósticos `schema: <pointer> <keyword>`.
- **Corrige `v2.VerifyPayloadHash` (mudança de aceitação)**, como a v2.12.0 abaixo: `true` somente para `"sha256:"` seguido do SHA-256 do payload canônico, como `SignPayload` o escreve; um digest sem prefixo é `false`.
- **Adiciona `v2.RawAuditEventV2`**, como a v2.12.0 abaixo.
- **Alinha as verificações de mandatos.** `v2.VerifyMandateValidity` aplica um único contrato e `v2.VerifyMandateValidityAt` (novo) recebe o instante da verificação; uma data ausente ou malformada, antes aceita, é inválida. `v2.VerifyMandateChain` lê todos os instantes da mesma forma e rejeita um mandato raiz que repete um domínio.

`SDKVersion` é `2.13.0`. Não mudam o formato de transmissão, as assinaturas, os perfis, `dcp-jcs-v1` como padrão normativo nem as APIs experimentais de adesão explícita `dcp-jcs-v2`. Preserve a evidência histórica em vez de reescrevê-la: um bundle que as novas verificações rejeitam fica como foi recebido. No README do SDK empacotado com esta versão, a linha de `v2.VerifyPayloadHash` e o parágrafo de `v2.RawAuditEventV2` ainda dizem "prepared for v2.12.0": essas menções são históricas, e os dois estão na v2.13.0. Veja o [README do SDK](../../../sdks/go/README.md) e o [changelog](../../../CHANGELOG.md#unreleased).

<a id="prepared-not-published-v2120"></a>

## Preparada, não publicada: v2.12.0

A v2.12.0 está preparada no repositório desde 30/10/2026, mas não publicada: a tag `sdks/go/v2.12.0` não existe, então o proxy de módulos não serve esta versão e o `go get` não consegue resolvê-la. O comando de instalação acima continua na v2.11.1. Em relação à v2.11.1, a v2.12.0:

- **Corrige `v2.VerifyPayloadHash` (mudança de aceitação).** Retorna `true` somente quando `payload_hash` é exatamente `"sha256:"` seguido do SHA-256 em hex minúsculo do payload canônico `dcp-jcs-v1`. A saída de `v2.SignPayload` passa a ser aceita e um digest sem prefixo passa a ser rejeitado; a v2.11.1 fazia o contrário. A função só confere a consistência do hash, não a assinatura, as chaves, a política, a confiança no principal nem a admissão. A verificação de bundles nunca a usou e não muda.
- **Adiciona `v2.RawAuditEventV2`.** Ele mantém os bytes literais de uma entrada de auditoria recebida, de modo que membros `null` explícitos e membros desconhecidos sobrevivem ao reenvio; `Typed()` é uma visão com perda. `AuditEventV2` e os demais structs tipados continuam sendo tipos para produzir e mantêm seu comportamento.

As demais APIs, a verificação de bundles, `dcp-jcs-v1` e as APIs experimentais opt-in `dcp-jcs-v2` não mudam; os novos testes do candidato experimental não mudam nenhum padrão. A telemetria do SDK informa `2.12.0`. O módulo não contém mais os READMEs traduzidos, que agora ficam na árvore `i18n/` do repositório. Veja o [README do SDK](../../../sdks/go/README.md) e o [changelog](../../../CHANGELOG.md).

> **Nota (05/11/2026).** A comparação acima foi escrita em 30/10/2026 para a v2.12.0 preparada, que continua sem publicação. Desde então a `main` mudou a verificação: todos os verificadores V2 executam a validação de esquemas V2-2 (#116, 02/11/2026), e mudaram a função auxiliar de validade de mandatos, as verificações de tempo da cadeia e a verificação de domínios raiz repetidos (#117 a #119). Essas mudanças não estão na v2.12.0 descrita acima, que nunca recebeu tag; a v2.13.0 acima as contém e a substitui, e os manifestos da `main` levam a v2.13.0. Veja o [dossiê de auditoria](../../../docs/conformance/AUDIT_DOSSIER.md#artifacts).

<a id="related-releases"></a>

## Publicações relacionadas

As versões atuais em cada registro estão em [Versões publicadas](../../../docs/README.md#published-versions). Outras notas de publicação: [pacotes npm](../../../docs/NPM_RELEASES.md), [Python 2.10.1](../../../docs/PYTHON_RELEASE.md) e [Rust 2.11.1](../../../docs/RUST_RELEASE.md).
