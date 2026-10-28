<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

<a id="dcp-ai-conformance-kit"></a>

# Kit de conformidade do DCP-AI

> Tradução informativa da [versão em inglês](README.md), atualizada em 28/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

`tools/conformance.js` executa as suítes declaradas em [`catalog.json`](catalog.json) contra os fixtures e
vetores do repositório. O catálogo é versionado (`kit_version`) e fixa, para cada suíte, os IDs exatos dos
casos que ela deve produzir. O kit só lê fixtures: não gera chaves nem fixtures no checkout e não altera a
canonicalização, as assinaturas, os perfis, os esquemas nem os vetores.

<a id="commands"></a>

## Comandos

```bash
npm run conformance                                    # every suite (same as node tools/conformance.js)
node tools/conformance.js --list                       # suites, pinned case counts and inventory
node tools/conformance.js --suite v1.integrity --suite v2.hashes
node tools/conformance.js --report /tmp/conformance.json
node --test tools/conformance/conformance.test.mjs     # runner self-tests (temporary copies only)
```

Os caminhos de fixtures, esquemas e catálogo são resolvidos a partir do script, não do diretório atual.
Execute os comandos acima a partir da raiz do repositório; a partir de outro diretório, invoque o script pelo
caminho absoluto (`node /path/to/dcp-ai/tools/conformance.js`). `--root <dir>` aponta o kit para outra cópia
dos fixtures (os autotestes o usam com cópias temporárias).

<a id="contract"></a>

## Contrato

| Saída | Significado |
|-------|-------------|
| 0 | Todos os casos selecionados passaram |
| 1 | Pelo menos uma discrepância (um valor ou veredito difere da sua expectativa) |
| 2 | Erro de uso: argumento desconhecido, ID de suíte desconhecido, duplicado ou vazio, `--list` com `--report` |
| 3 | Erro de infraestrutura: fixture ausente ou malformado, expectativa malformada, `kind` de configuração desconhecido, catálogo ausente ou malformado, exceção, um caso fixado que não foi produzido ou um não fixado que foi produzido, ou nenhuma verificação executada |

- Um caso faltante ou sobrando é um erro, então remover um vetor de uma coleção que ainda tem outros não pode
  reduzir a cobertura silenciosamente. Uma suíte que lança uma exceção falha mesmo depois de ter produzido
  todos os casos fixados.
- Com `--report`, um marcador `incomplete` é gravado antes da execução e substituído pelo relatório final;
  um erro de uso ou de catálogo também substitui o arquivo. Isso vale para os erros que o kit trata e um
  caminho de relatório gravável: se o Node não iniciar ou o arquivo não puder ser gravado, um arquivo anterior
  pode permanecer, então quem o consome deve verificar o código de saída e os campos `run.id` e `status` do
  relatório em vez de confiar em um arquivo existente.
- O relatório traz `kit` (nome, versão, SHA-256 do catálogo), `run` (uuid, carimbos de tempo, raiz, versão
  do Node), `selection`, `status`, `totals` (`cases`, `executed`, `pass`, `fail`, `error`), cada suíte com
  sua afirmação, limites e casos (`status`, e `kind`: `discrepancy`, `fixture`, `expectation`, `exception`
  ou `catalog`), o inventário e os limites globais.

<a id="suites"></a>

## Suítes de teste

| Suíte | Casos | Especificação | Esquemas / vetores | O que um resultado aprovado prova |
|-------|-------|---------------|--------------------|-----------------------------------|
| `v1.schema` | 7 | DCP-01, DCP-02, DCP-03, `BUNDLE.md` | `schemas/v1`, `tests/conformance/examples/*.json` | Apenas validade de esquema |
| `v1.integrity` | 9 | `VERIFICATION.md` (V1), DCP-03 | `citizenship_bundle.signed.json`, `keys/public_key.txt`, `golden_vectors.json#v1_bundle_verification` | Assinatura Ed25519, hash do bundle, raiz de Merkle, hash da intenção, hashes das entradas e cadeia `prev_hash` de um fixture, comparados com os valores golden; metadados de chave coerentes |
| `v2.canonicalization` | 11 | `CANONICALIZATION_PROFILE.md` | `golden_vectors.json#canonicalization`, `#v2_canonicalization`, `interop_vectors.json#canonicalization` | Bytes `dcp-jcs-v1` do canonicalizador de referência |
| `v2.hashes` | 9 | DCP-AI-v2.0 §2.3, §10.3 | `golden_vectors.json#hash_vectors`, `#dual_hash_vectors` | Valores SHA-256 / SHA3-256, hashes duplos e raízes de Merkle duplas |
| `v2.signed_bundle` | 10 | `VERIFICATION.md` (V2) | `lib/verify.js`, bundle construído em memória | Vereditos do verificador de referência para bundles válidos e adulterados; verificado não é admissão |
| `v2.secondary_sha3` | 51 | `VERIFICATION.md` V2-11 e sua errata | `secondary_sha3_vectors.json`, `lib/verify.js` | Vereditos do verificador de referência sobre os campos secundários SHA3-256 presentes, com um controle por caso rejeitado; não uma cadeia secundária completa |
| `v2.schema` | 4 | DCP-AI-v2.0 | `schemas/v2`, exemplos `*_v2.json` | Apenas validade de esquema |
| `ext.dcp05_09.schema` | 18 | DCP-05 a DCP-09 | `schemas/v2`, exemplos `<record>_v2.json` | Apenas validade de esquema |
| `ext.dcp05_09.wire` | 28 | DCP-05, DCP-08, DCP-09, `V2-WIRE-COMPATIBILITY.md` | `schemas/v2`, registros assinados em memória, `interop_vectors.json#domain_separation_all_contexts` | Representação, validade de esquema e assinatura destes registros como camadas separadas; não conformidade funcional |
| `admission.strict_v1` | 117 | `spec/profiles/admission` | `admission_vectors.json` | Resultado de admissão e códigos de erro esperados; `action_authorized` é sempre false |

<a id="limits"></a>

## Limites

- Passar em um subconjunto certifica essas verificações sobre estes fixtures e nada mais: não uma
  implementação completa do DCP, outro SDK nem uma implantação. As suítes de esquema provam apenas validade
  de esquema; a suíte de esquemas V2 não faz uma implementação V2 sem as suítes de canonicalização, hashes e
  assinaturas.
- `verified` e `admitted` nunca autorizam uma ação.
- Os adaptadores (Express, FastAPI, OpenClaw, o servidor de verificação) não fazem parte do kit.
- Pontos do protocolo, segundo `spec/V2-WIRE-COMPATIBILITY.md`: o campo de expiração do DCP-09
  (`valid_until`) e os contextos de assinatura do DCP-05, DCP-08 e DCP-09 estão corrigidos por erratas e são
  testados por `ext.dcp05_09.wire`. Continuam pendentes de um projeto explícito e versionado, e o kit não os
  decide: as métricas fracionárias de `vitality_report` do DCP-05 (com `dcp-jcs-v1` só 0 e 1 são
  representáveis), os direitos em notação de domínio reverso do DCP-08 §4.3 (recusados pelo enum `right_type`)
  e os segundos signatários ou confirmações (DCP-05 §4.4, DCP-09 §3.3 e §6.3). Os exemplos do DCP-04, DCP-06 e
  DCP-07 ficam fora destas erratas.

<a id="inventory"></a>

## Inventário

Aparece em `--list` e no relatório, fora dos totais: o kit não o executa, e sua presença não é um teste
aprovado. Os vetores de ataque, os casos-limite de canonicalização e as demais categorias de
`interop_vectors.json` e os vetores de bundles e mandatos rodam nas suítes de teste dos SDKs.
`tests/nist-kat/` contém vetores de resposta conhecida e testes de propriedades, cada um com seu próprio
escopo (veja [seu README](../../tests/nist-kat/README.pt-BR.md)); eles também rodam nas suítes dos SDKs. O candidato `dcp-jcs-v2` é experimental, fica fora do `dcp-jcs-v1` e tem sua própria suíte
(`tests/interop/candidate/`).

<a id="external-implementations"></a>

## Implementações externas

`tools/conformance-external.js` executa um catálogo separado, [`external-catalog.json`](external-catalog.json)
(contrato `dcp-ai-conformance-external/1`), contra uma implementação que você indica como argv depois de `--`. A
implementação pode ser escrita em qualquer linguagem: ela lê uma requisição JSON pelo stdin e escreve uma resposta
JSON pelo stdout. O runner precisa do Node 20 ou posterior e usa apenas módulos nativos. O comando, o catálogo e o
relatório acima não mudam.

```bash
node tools/conformance-external.js --list
node tools/conformance-external.js --report /tmp/external.json -- node tools/conformance/wrappers/ts-sdk.mjs
node tools/conformance-external.js -- /path/to/python -I tools/conformance/wrappers/python_sdk.py
node tools/conformance-external.js --suite external.digest -- ./my-implementation --its-own-flag
node --test tools/conformance/external.test.mjs
DCP_EXTERNAL_PYTHON=/path/to/python DCP_EXTERNAL_REQUIRE_PYTHON=1 node --test tools/conformance/external.test.mjs
```

Sem `DCP_EXTERNAL_PYTHON`, `node --test` pula o wrapper de Python e informa isso; com
`DCP_EXTERNAL_REQUIRE_PYTHON=1`, a falta do interpretador é uma falha. O último comando executa todos os testes.

| Suíte | Casos | Vetores |
|-------|-------|---------|
| `external.dcp-jcs-v1.canonicalize` | 30 | `golden_vectors.json#canonicalization`, `#v2_canonicalization`; `interop_vectors.json#canonicalization` e seus 19 `edge_cases`, 3 dos quais devem ser rejeitados |
| `external.digest` | 8 | `golden_vectors.json#hash_vectors`; `#dual_hash_vectors` raw e intent, SHA-256 e SHA3-256 |

Uma troca mínima, o SHA-256 de zero bytes, que você pode executar contra o wrapper de TypeScript:

```bash
printf '%s' '{"contract":"dcp-ai-conformance-external/1","run_id":"00000000-0000-4000-8000-000000000000","nonce":"00000000000000000000000000000000","cases":[{"id":"c1","op":"digest","alg":"sha256","input_b64":""}]}' | node tools/conformance/wrappers/ts-sdk.mjs
```

Uma resposta válida para essa requisição (o wrapper também adiciona `resolved_from` e `runtime`):

```json
{"contract":"dcp-ai-conformance-external/1","run_id":"00000000-0000-4000-8000-000000000000","nonce":"00000000000000000000000000000000","implementation":{"name":"example","version":"0.0.1"},"results":[{"id":"c1","status":"ok","hex":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}]}
```

- **Envelopes:** a requisição e a resposta são JSON em UTF-8. A resposta é exatamente um documento JSON no stdout, e
  o processo termina com código 0.
- **Requisição:** `contract`, `run_id`, `nonce` e `cases`, cada um com `id`, `op` (`canonicalize` com `profile`
  `dcp-jcs-v1`, ou `digest` com `alg` `sha256` ou `sha3-256`) e `input_b64`. Os IDs são aleatórios a cada execução e
  nenhuma expectativa é enviada. A entrada de canonicalize é texto JSON: um vetor `input_json` exatamente como está no
  repositório, e um valor `input` como `JSON.stringify` o escreve.
- **Resposta:** os mesmos `contract`, `run_id` e `nonce`; `implementation` (`name`, `version`, e opcionalmente
  `resolved_from` e `runtime`, todos declarados pela implementação); e `results`, um array com exatamente um objeto
  por caso, cada um com o `id` desse caso e um `status`: `ok` com `output_b64` (os bytes canônicos) ou `hex`,
  `rejected` com `code` `parse` ou `profile`, `error` com `message`, ou `unsupported`. Nenhum outro campo é aceito.
- **Codificações:** `input_b64` e `output_b64` são base64 RFC 4648 com o alfabeto padrão, padding e sem quebras de
  linha, na forma canônica; `hex` tem exatamente 64 caracteres hexadecimais minúsculos.
- **Avaliação:** os bytes são comparados exatamente, e um vetor que deve ser rejeitado só passa se for rejeitado. Um
  resultado `error` ou `unsupported`, um resultado malformado, ausente, duplicado ou extra, um `run_id` ou `nonce`
  obsoleto, uma saída inválida, um código de saída diferente de zero ou um sinal, um timeout e um stdout acima de
  4 MiB são erros, nunca um sucesso. Os códigos de saída são os do [contrato](#contract).
- **Processo:** iniciado sem shell, em seu próprio grupo de processos em POSIX. Um único prazo (`--timeout-ms`,
  padrão 30 000) é medido com um relógio monotônico; depois, SIGTERM, SIGKILL 2 s depois e uma espera limitada de 2 s
  pelo fechamento dos pipes (senão, `cleanup_incomplete`). O stderr é mantido até 64 KiB e nunca é interpretado.
- **O catálogo e os fixtures** são validados antes: IDs únicos, ponteiros existentes, expectativas coerentes com os
  vetores, e cada membro de cada coleção fixado uma vez por operação e algoritmo. Um defeito dá exit 3. O relatório
  registra os hashes do catálogo, dos fixtures e da requisição, e a identidade declarada pela implementação separada
  do que o runner observou.
- **Relatório:** um valor de `--report` ausente, que pareça uma opção ou repetido é um erro de uso (exit 2) e nenhum
  relatório é escrito, porque o caminho é ambíguo. Como no comando acima, um relatório antigo também pode permanecer
  se o Node não iniciar, o relatório não puder ser escrito ou o runner for encerrado. Verifique sempre o código de
  saída e, depois, o `run.id` e o `status` do relatório.
- **Wrappers:** `wrappers/ts-sdk.mjs` (`@dcp-ai/sdk`; `--sdk <path>` é opcional) e `wrappers/python_sdk.py` (o
  `dcp_ai` instalado; execute-o com `-I`). Cada um chama o canonicalizador real uma vez e só informa
  `rejected`/`profile` para a rejeição de números não inteiros documentada do SDK. Os SDKs não têm códigos de erro
  estáveis, então ela é reconhecida pelo tipo e pela mensagem: se mudarem, uma rejeição correta aparece como erro,
  nunca como sucesso. A CI executa os dois wrappers.
- **Limites:** um sucesso mostra que o argv executado passa nestes 38 casos, através do parser que ele usa; não é uma
  implementação completa de `dcp-jcs-v1` nem conformidade DCP, e a identidade é declarada pela implementação. Não é
  um sandbox: a implementação roda com seus privilégios e seu ambiente, descendentes que saem do grupo de processos
  (`setsid`) não são vistos, e no Windows só o filho direto é encerrado.
