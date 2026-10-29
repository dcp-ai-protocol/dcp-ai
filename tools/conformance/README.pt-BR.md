<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

<a id="dcp-ai-conformance-kit"></a>

# Kit de conformidade do DCP-AI

> Tradução informativa da [versão em inglês](README.md), atualizada em 29/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

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

<a id="go-rust-and-wasm-wrappers"></a>

### Wrappers de Go, Rust e WASM

Mais três wrappers executam os mesmos 38 casos e o mesmo contrato contra o SDK de Go, o SDK de Rust e a
compilação WASM do SDK de Rust, todos deste checkout. `build.mjs` os compila em `tools/conformance/wrappers/.build/`
(ignorado pelo Git); precisa do Go 1.25 ou posterior, do Cargo e do `wasm-pack` com o target
`wasm32-unknown-unknown`. Não instala nem publica nenhum pacote de DCP nem muda manifests ou lockfiles do SDK. Sem
`--offline`, o Cargo e o `wasm-pack` podem baixar ferramentas de compilação e as dependências fixadas para seus
caches; `--offline` usa `GOPROXY=off`, Cargo `--offline` e `wasm-pack --mode no-install`, e precisa desses caches
já preenchidos.

```bash
node tools/conformance/wrappers/build.mjs all
node tools/conformance/wrappers/build.mjs --offline go rust wasm
node tools/conformance-external.js -- tools/conformance/wrappers/.build/go-wrapper
node tools/conformance-external.js -- tools/conformance/wrappers/.build/rust-target/debug/dcp-ai-conformance-wrapper
node tools/conformance-external.js -- node tools/conformance/wrappers/wasm.mjs
DCP_EXTERNAL_REQUIRE_NATIVE=1 node --test tools/conformance/external-native.test.mjs
```

- **Compilação:** o Go compila com `-mod=readonly` contra o `go.mod` e o `go.sum` do wrapper, cujas versões são um
  subconjunto das do próprio SDK; o Cargo compila com `--locked`, o wrapper nativo com seu `Cargo.lock` (uma cópia
  do lock do SDK, resolvida sem rede, com as mesmas versões fixadas) e o artefato WASM com o `Cargo.lock` do SDK.
  `--offline` usa apenas os caches locais. Nenhum manifest ou lockfile do SDK muda.
- **Go** (`wrappers/go`): a entrada deve ser UTF-8 (verificado primeiro, porque `encoding/json` substituiria os
  bytes inválidos), depois `json.Unmarshal` em `interface{}`, como faz o próprio teste de interop do SDK, e uma
  única chamada a `v2.CanonicalizeV2`; só a rejeição documentada (`non-integer float at`, `non-finite float at`) é
  `rejected`/`profile`. Digests: `v2.SHA256Hex`, `v2.SHA3256Hex`. A versão é informada como o checkout local.
- **Rust** (`wrappers/rust`): decodificação UTF-8 fatal, `serde_json::from_str` e uma única chamada a
  `dcp_ai::v2::canonicalize::canonicalize_v2`; só a rejeição documentada (`Non-integer number in V2 canonical form:`, `Non-finite number in V2 canonical form:`, após prefixos de caminho) é `rejected`/`profile`. Digests:
  `sha256_hex`, `sha3_256_hex`. A versão é `DCP_SDK_VERSION`.
- **WASM** (`wrappers/wasm.mjs`): carrega o `.wasm` real que o `wasm-pack` compilou a partir de `sdks/rust` com a
  feature `wasm` (`--target web`) e informa seu SHA-256. O texto JSON cru vai para uma única chamada de
  `wasm_canonicalize_v2`, sem `JSON.parse` nem `JSON.stringify` em JavaScript antes da chamada;
  depois, a entrada e a saída só são inspecionadas para marcar a ambiguidade, sem recalcular bytes. Essa exportação informa os erros
  dentro do próprio resultado como `{"error": "…"}`, que uma entrada válida também pode produzir, então um resultado
  `{"error": string}` de uma única chave é um `error` ambíguo quando a entrada é ela mesma um objeto raiz cuja única chave é
  `error` (qualquer que seja seu valor), e caso contrário só é uma rejeição para as mensagens documentadas. As exportações de digest recebem
  texto: as 8 entradas de digest são texto, e bytes que não são UTF-8 são um `error`, nunca substituídos.
- **Erros:** nos três, uma requisição com um tipo errado (por exemplo `input_b64` numérico ou `null`, ou `cases`
  que não é um array) é inválida e o wrapper termina com 2; qualquer erro diferente da rejeição documentada é `error`. Em Rust e WASM, a rejeição documentada de
  números é reconhecida em uma única passada linear, sem expressões regulares com backtracking; uma mensagem de mais
  de 1 MiB em UTF-8 é um `error`, nunca uma rejeição (o limite se aplica a esse classificador, não aos erros de
  parse). Sem `DCP_EXTERNAL_REQUIRE_NATIVE=1`, `node --test` pula o que não está compilado e informa isso; com ela,
  a falta de uma ferramenta ou de um artefato é uma falha. A CI compila os três wrappers a partir do checkout e
  executa os 38 casos com cada um, então lá os cinco wrappers são obrigatórios.
- **Limites:** o wrapper WASM chama as exportações cruas do wasm-bindgen hospedadas no Node: não cobre a API
  JavaScript do pacote `@dcp-ai/wasm` (como `DcpClient`) nem um navegador. A classificação das rejeições depende do
  texto das mensagens, porque os SDKs não têm códigos de erro estáveis, e, via WASM, uma entrada raiz `{"error": …}` de uma única chave só é
  um erro ambíguo quando a exportação devolve o envelope `{"error": string}` (`{"error":5}` continua `ok`). Um sucesso mostra que estes 38 casos passam com cada wrapper, nada mais.

<a id="evidence-catalog-merkle-and-signature-verification"></a>

### Catálogo de evidência: Merkle e verificação de assinaturas

`--catalog evidence` seleciona um catálogo opcional, [`external-evidence-catalog.json`](external-evidence-catalog.json)
(contrato `dcp-ai-conformance-external/2`, 241 casos), executado contra o mesmo tipo de argv. O catálogo padrão,
o contrato `/1` e seus 38 casos não mudam; o `contract` do catálogo decide como ele é carregado e julgado. Os
cinco wrappers aceitam os dois contratos e respondem com o contrato da requisição. Só são usados fixtures
públicos versionados: nenhuma chave é gerada e nada é assinado.

```bash
node tools/conformance-external.js --catalog evidence --list
node tools/conformance-external.js --catalog evidence --report /tmp/evidence-ts.json -- node tools/conformance/wrappers/ts-sdk.mjs --sdk sdks/typescript/dist/index.js
node tools/conformance-external.js --catalog evidence -- /path/to/python -I tools/conformance/wrappers/python_sdk.py
node tools/conformance-external.js --catalog evidence -- tools/conformance/wrappers/.build/go-wrapper
node tools/conformance-external.js --catalog evidence -- tools/conformance/wrappers/.build/rust-target/debug/dcp-ai-conformance-wrapper
node tools/conformance-external.js --catalog evidence -- node tools/conformance/wrappers/wasm.mjs
DCP_EXTERNAL_PYTHON=/path/to/python DCP_EXTERNAL_REQUIRE_PYTHON=1 DCP_EXTERNAL_REQUIRE_NATIVE=1 node --test tools/conformance/external-evidence.test.mjs
```

| Suíte | Casos | Vetores |
|-------|-------|---------|
| `external.merkle.dual_root` | 6 | `tests/conformance/v2/merkle_vectors.json`: 1, 2, 3 e 5 folhas e folhas reordenadas (`spec/VERIFICATION.md` V2-11), geradas offline com a biblioteca padrão do Python |
| `external.signature.composite` | 24 | `interop_vectors.json`: assinaturas compostas e só clássicas, seus ataques versionados e alterações determinísticas de cada positivo |
| `external.v2.bundle_vectors` | 131 | `bundle_vectors.json`: o bundle assinado, suas 38 mutações versionadas, 9 bundles aceitos e 79 rejeitados construídos à parte, o bundle de rotina só clássico em 4 modos |
| `external.v2.secondary_sha3` | 80 | `secondary_sha3_vectors.json`: casos aceitos e rejeitados e o controle versionado de cada caso rejeitado |

- **Operações:** `dual_merkle_root` recebe `leaves`, um array não vazio de `{sha256, sha3_256}` com strings
  hexadecimais de 64 caracteres em minúsculas, e responde `ok` com `sha256` e `sha3_256` (64 hex em minúsculas).
  `composite_verify` recebe `context`, `payload_b64` (os bytes canônicos do payload), `composite_sig` como está
  versionada, `classical_public_key_b64` e `pq_public_key_b64` (ou `null`), e responde `ok` com `valid` e
  `classical_valid` (booleanos) e `pq_valid` (booleano ou `null`). `verify_signed_bundle_v2` recebe `bundle_b64`
  (o JSON do bundle assinado), `policy` (um objeto de política do verificador) e `verification_time` (RFC 3339
  com `Z` ou um deslocamento), e responde `ok` com `verified` (booleano) e `errors` (um array de strings). Uma
  requisição com formato errado (uma folha vazia ou em maiúsculas, uma folha que não é string, um horário sem
  fuso, um campo desconhecido) faz o wrapper sair com 2.
- **Julgamento:** os casos compostos comparam só os campos que o fixture fixa; o veredito de um bundle deve
  coincidir, e uma rejeição deve conter o `error_contains` versionado (sem diferenciar maiúsculas, sobre os erros
  unidos). `verified: true` com erros é um erro `contradictory_result`. `rejected` com `code` `parse` falha,
  porque toda entrada versionada pode ser analisada; `error` e `unsupported` nunca são um sucesso.
- **Controles:** um caso negativo só conta se seu controle passou; caso contrário, é `control_failed`, um erro. O
  bundle assinado base controla suas 38 mutações; o positivo do mesmo payload controla suas alterações e os
  ataques versionados; um modo válido do bundle só clássico controla seus modos que rejeitam; cada caso secundário
  rejeitado tem seu controle versionado. Os 79 `must_reject_bundles` não têm controle por caso: só contam se a base
  e os 9 bundles aceitos passam (um controle no nível da suíte, uma garantia mais fraca) e são julgados pelo seu
  `error_contains` versionado. O relatório dá para cada caso seu `source`, seu `input_sha256` e seus `controls`.
- **Assinatura PQ ausente:** diante de uma assinatura `pq_over_classical` sem parte PQ, `composite_verify` do Rust
  devolve um erro e a exportação WASM o erro em banda
  `Signature error: pq_over_classical binding requires PQ signature`. Esses dois wrappers o reportam como
  `rejected` com `code` `missing_pq_signature`, só para esse erro exato e só quando a entrada tem esse binding e `pq: null`. O runner só o aceita onde o fixture fixa apenas
  `valid: false` (`stripping_pq_removal`) e seu controle positivo passou; o mesmo código diante de uma assinatura
  válida ou de qualquer outro negativo falha. TypeScript, Python e Go respondem a esse caso com booleanos.
- **As alterações do payload** mudam o último caractere do primeiro valor string do payload canônico, de modo que
  o payload continua sendo JSON canônico válido (a exportação WASM recebe o JSON do payload) e um erro do
  analisador nunca é contado como uma falha criptográfica.
- **Horário:** cada caso de bundle envia `verification_time`: 2026-10-22T00:00:00Z, dentro da janela de validade
  do bundle base e de cada bundle que deve ser verificado (alguns negativos estão expirados ou ainda não são
  válidos nesse instante de propósito), ou o horário versionado dos vetores secundários. TypeScript passa `{ now }`, Python
  `now_ms`, Go `VerifySignedBundleV2At` e Rust `verify_signed_bundle_v2_at`. A exportação WASM lê `Date.now`,
  então o wrapper WASM substitui `Date.now` por esse instante só durante a chamada síncrona e o restaura em
  `finally`, também quando a chamada lança uma exceção; seu `runtime` informa isso. Os self-tests mostram que cada
  wrapper rejeita o bundle base em 2020-01-01, o aceita em 2026-10-22 e o rejeita em 2100-01-01, e a restauração
  após uma exceção.
- **Merkle via WASM:** o wrapper usa o `wasm_dual_merkle_root` compilado a partir deste checkout, que delega ao
  núcleo de Rust; o helper publicado no `@dcp-ai/wasm` 2.1.1 e anteriores falha nos casos de várias folhas (veja o
  CHANGELOG).
- **Self-tests:** `external-evidence.test.mjs` executa os 241 casos com os cinco wrappers, a prova do relógio,
  requisições malformadas e uma implementação falsa construída a partir das respostas reais do wrapper de
  TypeScript: verificar tudo, rejeitar tudo, resultados contraditórios, um texto de erro errado, uma redução Merkle
  que ignora a ordem ou que faz o hash do texto hexadecimal, uma base que falha, `missing_pq_signature` no lugar
  certo e fora dele, e erros ou `unsupported` nos negativos. Fixtures e catálogos adulterados são erros de
  infraestrutura (saída 3). O tempo limite padrão deste catálogo é de 300 000 ms (`--timeout-ms`). Com as duas
  variáveis `REQUIRE`, um wrapper ausente falha em vez de ser pulado; a CI executa os cinco.
- **Limites:** um sucesso mostra que o argv executado passa nestes 241 casos, nada mais. A política é
  `default_verifier_policy` com os `verifier_policy_overrides` versionados de cada caso, mais os 4 modos do
  bundle só clássico; nenhuma outra política é testada. `composite_verify` é uma primitiva com o binding e as
  chaves dados, e o veredito de um bundle não é admissão, confiança no principal nem autorização de uma ação.
  `stripping_pq_with_downgrade` é julgado por `classical_valid` e `pq_valid`; rejeitá-lo cabe a uma política
  `hybrid_required`. Os campos secundários são verificados onde estão presentes, então um sucesso não mostra uma
  cadeia secundária completa. Via WASM, o horário é o relógio do host substituído. As strings `error_contains` são a
  redação de diagnóstico dos SDKs, não são normativas: `spec/VERIFICATION.md` não define códigos de erro. Um sucesso
  nesses 146 casos mostra concordância com essa redação; um verificador com os mesmos veredictos e outras mensagens
  falha neles, e essa falha por si só não mostra um veredito errado.

<a id="admission-catalog-strict-v1-admission"></a>

### Catálogo de admissão: admissão strict-v1

`--catalog admission` seleciona um segundo catálogo opt-in, [`external-admission-catalog.json`](external-admission-catalog.json)
(contrato `dcp-ai-conformance-external/3`, 140 casos), executado contra o mesmo tipo de argv. Ele julga a decisão de
admissão de [`spec/profiles/admission`](../../spec/profiles/admission/README.md) sobre o
[`admission_vectors.json`](../../tests/interop/v2/admission_vectors.json) versionado, que o catálogo fixa por SHA-256
junto com `bundle_vectors.json`. Os contratos `/1` e `/2` e seus catálogos não mudam. Os wrappers de TypeScript, Python,
Go e Rust respondem a `/3` por meio do seu SDK; o build WASM não tem API de admissão, então o seu wrapper recusa `/3`
(exit 2) e nada o emula.

```bash
node tools/conformance-external.js --catalog admission --list
node tools/conformance-external.js --catalog admission --report /tmp/admission-ts.json -- node tools/conformance/wrappers/ts-sdk.mjs --sdk sdks/typescript/dist/index.js
node tools/conformance-external.js --catalog admission -- /path/to/python -I tools/conformance/wrappers/python_sdk.py
node tools/conformance-external.js --catalog admission -- tools/conformance/wrappers/.build/go-wrapper
node tools/conformance-external.js --catalog admission -- tools/conformance/wrappers/.build/rust-target/debug/dcp-ai-conformance-wrapper
node --test tools/conformance/external-admission.test.mjs
DCP_EXTERNAL_PYTHON=/path/to/python DCP_EXTERNAL_REQUIRE_PYTHON=1 DCP_EXTERNAL_REQUIRE_NATIVE=1 node --test tools/conformance/external-admission-wrappers.test.mjs
```

| Suíte | Casos | Origem |
|-------|-------|--------|
| `external.admission.outcomes` | 65 | Os vetores de resultado de `admission_vectors.json` |
| `external.admission.config` | 71 | As suas 49 configurações rejeitadas, os seus 2 perfis aceitos com seus máximos, e o carregamento dos 14 conjuntos de confiança e 6 perfis que os vetores usam |
| `external.admission.composed` | 4 | Escritos no catálogo a partir das entradas dos vetores: um perfil sem conjunto de confiança, um perfil com uma política de verificador de quem chama, e duas composições cujos códigos uma ordem alfabética deslocaria |

- **Operações:** `admit_signed_bundle_v2` recebe `bundle_b64`, `now`, `profile`, `trust_set`, `verifier_policy` e
  `revocation`, sempre os seis; `load_admission_config` recebe `kind` (`trust_set` ou `profile`) e `config`.
  - `now` é exatamente `YYYY-MM-DDTHH:mm:ss.sssZ`, uma data real dos anos 0001 a 9999. É só o intervalo deste
    transporte: não muda nenhum timestamp do protocolo.
  - `revocation` é `null` sem perfil, `{"state": "unavailable"}` (sem snapshot, R1) ou
    `{"state": "snapshot", "snapshot": {…}}` com um objeto, completo ou não, que o SDK julga. Ela é dada exatamente
    quando há perfil.
  - `profile`, `trust_set` e `verifier_policy` são objetos ou `null`. O conjunto de confiança e o perfil são a
    configuração do operador, dada fora de banda na requisição, nunca tirada do bundle. Sem perfil, a requisição leva uma
    política de verificador completa: os 14 campos de `default_verifier_policy`, mais `require_session_expiry: false`,
    `require_audience_binding: false` e `max_session_duration_seconds: 0`. Com perfil não leva nenhuma, exceto no caso
    que verifica a sua recusa.
  - Uma requisição de outra forma faz o wrapper sair com 2 antes de chamar o SDK.
- **Respostas:** `ok` com exatamente `verified`, `principal_trust`, `profile`, `profile_compliance`, `admitted`,
  `action_authorized`, `recorded_decision`, `trust_set_version`, `codes` (os códigos de `errors`, na ordem emitida, com
  as repetições) e `verification_verified`; para uma configuração, `accepted: true`, e para um perfil os seus dois
  máximos. `rejected` leva um código `CONFIG_*`, somente quando o SDK lançou o seu erro de configuração tipado. `error` e
  `unsupported` nunca são um sucesso.
- **Julgamento**, nesta ordem:
  - os tipos dos campos (`malformed_result`);
  - as regras que decorrem de spec/profiles/admission (`contradictory_result`): `action_authorized` é `false`;
    `admitted` vale exatamente quando nenhum código foi acrescentado; a confiança no principal só é avaliada com um
    conjunto de confiança e um bundle verificado;
  - os campos exatos e o conjunto de códigos;
  - a ordem da sequência bruta pelas fases dos §5.1 e §5.2, com as paradas de P1, T1, R1 e R2 (`order`);
  - as repetições (`cardinality`): só P4, T2, R4 e R5, que se aplicam a vários componentes ou sujeitos, podem repetir o
    seu código.

  Uma configuração rejeitada passa com um dos seus `allowed_codes`: o seu próprio código, ou qualquer um dos dois
  aplicáveis nos três conjuntos de confiança com dois problemas (§2.2). Os perfis são julgados pelos seus máximos
  efetivos (§4.1).
- **Controles:** um negativo só conta se os seus controles passaram, de forma transitiva; caso contrário é
  `control_failed`, um erro.
  - 29 negativos de resultado são controlados pelo positivo do seu próprio bundle.
  - 19 não têm positivo no seu bundle e são controlados no nível da suíte, uma garantia mais fraca.
  - As rejeições de configuração são controladas pelo carregamento de um conjunto de confiança ou de um perfil válido.
  - Os casos compostos são controlados pelos vetores que compõem.

  `--suite` executa também os controles de que um caso selecionado precisa e os informa (`controls_included`,
  `included_for_controls`).
- **Processo e erros:** como em `/1` e `/2` (run id, nonce, ids de caso aleatórios, grupo de processos e limites); o
  timeout padrão deste catálogo é de 300 000 ms. Uma falha ao iniciar, um exit diferente de zero, um sinal, um timeout,
  ids obsoletos, ou um resultado malformado, ausente, duplicado ou extra é um erro, nunca uma rejeição nem um “não
  admitido”. O catálogo e as suas fixtures são validados ao carregar (hashes fixados, chaves e tipos exatos, cada
  expectativa coerente com o texto); um defeito é exit 3.
- **Wrappers:** uma chamada por caso à função combinada ou aos carregadores do SDK, com o `now` da requisição, nunca o
  relógio do sistema: `admitSignedBundleV2`, `createPrincipalTrustStore` e `resolveStrictV1Profile` (TypeScript);
  `admit_signed_bundle_v2`, `create_principal_trust_store` e `resolve_strict_v1_profile` (Python);
  `AdmitSignedBundleV2`, `NewPrincipalTrustStore` e `ResolveStrictV1Profile` (Go); `admit_signed_bundle_v2`,
  `PrincipalTrustStore::from_json` e `resolve_strict_v1_profile` (Rust), com os provedores Ed25519 e ML-DSA-65. Só o erro
  tipado é uma rejeição: `AdmissionConfigError` (TypeScript, Python, Rust) ou `*AdmissionConfigError` por meio de
  `errors.As` (Go). `DCP_CONFORMANCE_WRAPPER_FAULT` serve só aos autotestes e só pode transformar uma resposta em erro.
- **Autotestes:**
  - `external-admission.test.mjs` julga respostas sintéticas construídas a partir das expectativas do próprio catálogo,
    sem SDK: decisões erradas, ordem, cardinalidade, códigos de configuração, falhas de infraestrutura, e catálogos e
    fixtures adulterados.
  - `external-admission-wrappers.test.mjs` executa os quatro wrappers com os seus SDKs: os 140 casos de cada um, o
    relógio da requisição (um caso em três instantes), requisições malformadas, falhas injetadas, uma implementação que
    não consegue carregar, a recusa do WASM, e um SDK que tira a confiança do bundle, por meio do TypeScript.

  A CI executa os dois, com os quatro wrappers obrigatórios.
- **Limites:**
  - **O que um sucesso mostra.** O argv executado passa nestes 140 casos, nada mais. A admissão nunca é uma autorização:
    `action_authorized` é sempre `false`.
  - **Uma projeção.** A resposta é uma projeção do resultado de admissão. A verificação incluída (os seus erros, avisos,
    detalhes, `signer_keys`, modo e nível) não é julgada; `verification_verified` é informado pela própria implementação.
  - **Erros tipados.** Uma rejeição é julgada pelo seu código. Se ela veio do erro tipado do SDK, quem vê é o wrapper,
    não o runner.
  - **Garantias mais fracas.** Os 19 controles no nível da suíte, e as 4 expectativas compostas, que estão escritas no
    catálogo e não nos vetores.
  - **Fora deste catálogo.** Os adaptadores, as fontes de confiança e de revogação, TLS, os inquilinos, o cache e o uso
    único. O corpus são os vetores versionados e estas quatro composições, não qualquer entrada.
