<sub>[English](../../../../tools/difffuzz/README.md) · [中文](../../../zh-CN/tools/difffuzz/README.md) · [Español](../../../es/tools/difffuzz/README.md) · [日本語](../../../ja/tools/difffuzz/README.md) · **Português**</sub>

<a id="differential-fuzzer-for-the-v2-bundle-verifiers"></a>

# Fuzzer diferencial dos verificadores de bundles V2

> Tradução informativa da [versão em inglês](../../../../tools/difffuzz/README.md), atualizada em 05/11/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são preservados sem tradução.

`run.mjs` envia o mesmo bundle V2 assinado e mutado aos quatro verificadores SDK (`verifySignedBundleV2` no TypeScript, `verify_signed_bundle_v2` no Python, `VerifySignedBundleV2At` no Go e `verify_signed_bundle_v2_at` no Rust), sob uma política explícita e um mesmo instante de verificação. São achados: divergência, veredicto contrário ao declarado nos vetores compartilhados, reordenação de chaves que muda o veredicto e qualquer erro, queda ou timeout. A rodada de segurança encerrada em v2.10.0 consistiu quase toda em divergências entre os quatro verificadores; esta ferramenta permite encontrá-las antes de uma publicação. O controlador é `fuzz.mjs`, compartilhado por `run.mjs` e pelos autotestes. Com `--sdks five`, o SDK Rust compilado para WASM é um quinto verificador ([Cinco SDKs](#five-sdks-wasm)). Um segundo harness, `run-mandates.mjs`, faz o mesmo com as cadeias de mandatos do DCP-09 ([Cadeias de mandatos](#mandate-chains)).

<a id="setup"></a>

## Preparação

Cada SDK é executado deste checkout, nunca de um pacote publicado:

```bash
(cd sdks/typescript && npm install && npm run build) # shims/ts imports sdks/typescript/dist
pip install -e sdks/python                            # dependencies of shims/py (pynacl, pqcrypto>=1.0)
npm ci --ignore-scripts                               # root lock: tweetnacl and @noble/post-quantum for run-mandates.mjs
```

Go (versão de `sdks/go/go.mod`) e uma toolchain estável de Rust precisam estar em `PATH`. O controlador compila `shims/go` (módulo que usa `replace` para apontar o SDK para `../../../../sdks/go`) com `-mod=readonly`, e `shims/rust` (dependência local de `../../../../sdks/rust`) com `--locked`. Ambos usam um diretório temporário privado da execução, inclusive o `CARGO_TARGET_DIR` do Cargo, de modo que execuções concorrentes nunca compartilham um binário. Assim, o shim Rust é compilado do zero em cada execução. Nenhum manifesto ou lockfile é alterado. Com `--offline`, Go usa `GOPROXY=off` e Cargo `--offline`: os caches de módulos e crates já precisam conter as dependências. A compilação tem prazo próprio.

`build.artifacts` registra por conteúdo o que foi medido: quatro shims, dois binários compilados (hashes, nunca caminhos efêmeros), árvores `src` e `dist` do TypeScript, seu `package-lock.json` e o diretório de cada dependência direta de runtime resolvida pelo Node, fontes do SDK Python e o interpretador com cinco versões de distribuições, e fontes Go e Rust junto com o lock do Rust. `inputs` registra o controlador (`fuzz.mjs`, `run.mjs`) e os fixtures. Ambos são conferidos ao final; uma alteração gera saída 3. `provenance_limits` explica o que os hashes não demonstram: não se verifica se aquele `dist` foi compilado daquele `src`, nem as dependências transitivas.

<a id="usage"></a>

## Uso

```bash
node tools/difffuzz/run.mjs                       # 200 iterations, seed 1
node tools/difffuzz/run.mjs --iterations 2000 --seed 7 --report /tmp/difffuzz.json
node tools/difffuzz/run.mjs --replay tools/difffuzz/findings/<file>.json
node --test tools/difffuzz/difffuzz.test.mjs      # self-tests of the harness (no SDK)
node --test tools/difffuzz/real-shims.test.mjs    # bounded diagnostic tests with all four SDKs
node tools/difffuzz/run.mjs --sdks five --iterations 60 --report /tmp/difffuzz-five.json
```

| Opção | Padrão | Significado |
| --- | --- | --- |
| `--iterations N` | `200` | mutantes a gerar (0 a 1.000.000) |
| `--seed S` | `1` | semente do PRNG; mesma semente e fixtures produzem os mesmos mutantes |
| `--modes a,b` | `default,hybrid_required` | políticas de cada semente e mutante (ver Políticas) |
| `--sdks four\|five` | `four` | conjunto de SDKs da execução; `five` acrescenta o build WASM (veja Cinco SDKs) |
| `--timeout MS` | `60000` | prazo de um processo por lote (`--timeout-ms` é equivalente) |
| `--python PATH` | `$DIFFFUZZ_PYTHON` ou `python3` | interpretador com as dependências do SDK Python |
| `--out DIR` | `tools/difffuzz/findings` | onde os achados são escritos |
| `--report FILE` | nenhum | relatório completo (JSON): primeiro escreve `incomplete` e substitui em cada caminho, inclusive erro de uso; valor ausente, com forma de opção ou repetido não escreve nada |
| `--offline` | desativado | compilar somente de caches locais |
| `--build-timeout-ms MS` | `600000` | um prazo para compilar os shims |
| `--batch-cases N`, `--batch-bytes B`, `--case-bytes B` | `64`, 16 MiB, 4 MiB | casos por lote, tamanho UTF-8 exato da solicitação completa e bytes brutos de uma entrada; semente que não cabe: saída 3; mutante que não cabe: ignorado e contado |
| `--stdout-bytes B` | 8 MiB | limite de saída de um processo por lote |
| `--max-findings N` | `50` | achados registrados; ao atingir o limite, não executa mais lotes (baseline incluído) e a execução não pode passar |
| `--max-retries N` | `200` | novas execuções de casos individuais para isolar lotes falhos; esgotar o orçamento gera saída 3 |
| `--minimize-steps N`, `--minimize-total N` | `24`, `96` | orçamento de minimização por achado e por execução |

Cada valor é validado antes de compilar: argumento desconhecido, repetido, ausente ou fora do intervalo gera saída 2. Códigos: 0 sem achados ou lotes com falha e com baseline completo; 1 pelo menos um achado, lote com falha ou baseline incompleto; 2 uso; 3 falha de infraestrutura ou do executor (compilação falha, entradas alteradas durante a execução, shim que não inicia ou responde fora do protocolo ou como não suportado, em lote ou sozinho, orçamento de tentativas esgotado, ou nenhuma semente declarada válida no primeiro modo quando há iterações). Os comandos são sempre exatamente os shims do conjunto de SDKs da execução.

<a id="policies-and-time"></a>

### Políticas e tempo

Cada solicitação leva política e instante explícitos: `now_ms` é 2026-10-22T00:00:00Z, o instante do kit externo de conformidade; o veredicto não depende do dia da execução. `default` é a `default_verifier_policy` dos vetores (a `DEFAULT_VERIFIER_POLICY` do TypeScript) para todos os SDKs. Qualquer outro nome de modo é aplicado a `default_mode` e a cada nível de risco, como os vetores constroem a política de cada modo. Os `verifier_policy_overrides` da semente substituem esses campos em todos os modos. Antes deste protocolo, `default` era a política própria de cada SDK e cada shim lia seu relógio de sistema.

<a id="seeds-and-expectations"></a>

### Sementes e expectativas

As sementes são os bundles de `tests/interop/v2/bundle_vectors.json`, conforme `_description`: `signed_bundle` verifica; cada mutação `must_reject` e entrada `must_reject_bundles` é rejeitada em qualquer modo; cada `must_accept_bundles` verifica em todos os modos; `classical_only_routine_bundle` usa `verified_by_mode`, sem veredicto declarado para `default`. A política padrão resolve para um dos quatro modos, portanto «todos» e «qualquer» a incluem. Um veredicto contrário a uma expectativa declarada é achado `expectation` mesmo que os quatro SDKs concordem: o acordo nunca é o oráculo. Se a expectativa contradisser a própria especificação, preserve o reprodutor e deixe de usar essa interpretação; não a substitua pela maioria. Os bundles assinados de `tests/interop/v2/cross_sdk_vectors.json` e `tests/conformance/examples/` não declaram expectativas e servem apenas à comparação diferencial.

Cada iteração ímpar —pelo menos metade, arredondando para cima— começa em uma semente declarada válida no primeiro modo, escolhida ao acaso; as demais partem de qualquer semente. Se houver iterações sem tal semente, a execução termina com saída 3.

<a id="mutators"></a>

### Mutadores

Cada iteração aplica uma mutação (70%) ou duas (30%) em posição aleatória: excluir chave, atribuir `null`, trocar o tipo de um valor, trocar dois valores irmãos, alterar um caractere base64, substituir string enumerada por chave de protótipo (`constructor`, `__proto__`, `toString`, `valueOf`, ...), renomear uma chave para chave de protótipo, adicionar chave desconhecida, duplicar um artefato (ou `payload`, `payload_hash`, `composite_sig`) em outra posição, reescrever um número como `1.0`, `1e2`, `-0`, `0.1`, `2^64`, `1e400`, ..., reescrever timestamp RFC 3339 com outro deslocamento horário, malformado ou muito distante no passado ou futuro, string grande demais (64 KiB ou 1 MiB), valor aninhado com profundidade 100 e reordenação recursiva de chaves. A última nunca deve mudar o veredicto: cada SDK é comparado ao próprio baseline da semente. Números que JavaScript não representa são inseridos literalmente no texto serializado, para todos os parsers receberem os mesmos bytes. A reordenação preserva uma chave própria `__proto__`, antes descartada.

<a id="judgement"></a>

## Avaliação

Cada shim responde `verdict` (`verified` e `errors`), `parse_rejected` (seu parser JSON recusou o documento), `error` (o SDK lançou exceção ou panic) ou `unsupported`. O controlador acrescenta `crash` (saída diferente de 0 ou sinal), `timeout`, `output_limit` e `protocol` (resposta fora do protocolo). Os SDKs são comparados pela aceitação: `true` aceita; `false` ou rejeição do parser rejeitam, como antes; nenhuma outra categoria conta como voto. Um lote cujo processo falha é registrado, e cada caso é reexecutado sozinho para isolar a causa. O lote falho impede a aprovação independentemente dos resultados das tentativas; uma falha que nenhum caso individual reproduz também é achado (`batch_failure_not_reproduced`). Antes de terminar, espera-se cada execução de shim do lote, seja qual for a primeira a falhar.

<a id="findings"></a>

## Achados

Cada achado é escrito em `findings/<seed>-<iteration>-<mode>-<n>.json` (diretório ignorado pelo Git, exceto `.gitkeep`): classes, semente, modo, política explícita e `now_ms`, mutações, resultado de cada SDK e bytes exatos de entrada (`input_b64`, `input_sha256`). Um achado é uma pista, ainda não um defeito. Reproduza-o primeiro com `--replay`: bytes registrados e entrada minimizada, quando existir, passam pelos shims do conjunto de SDKs do achado com o `now_ms` e a política próprios do achado, em lote junto ao seu controle registrado. Este contém bytes originais da semente sem mutação, hash, política, expectativa e resultados de baseline; nunca o fixture atual com aquele nome. O achado é validado antes, com tipos completos: tipo, conjunto de classes conhecidas igual ao derivado dos resultados, um resultado tipado por SDK do seu conjunto, hashes e controle. Compilação, controlador, fixtures e semente atuais são comparados aos registrados e toda diferença é relatada como diferença de procedência. Saídas do replay: 0 decisões e baseline do controle reproduzidos; 1 não reproduzidos; 3 achado, controle ou infraestrutura não permitem avaliação.

Divergências, erros e quedas de mutantes são então minimizados dentro de um orçamento (achado de expectativa já é semente não mutada), somente com controle positivo: a semente sem mutação passou seu baseline naquele modo, verificada `true` por todos os SDKs do conjunto selecionado. Semente corretamente rejeitada não é controle. Reduzem-se as diferenças preservando a decisão de cada SDK e o baseline da semente, executada junto ao candidato. Tokens brutos como `1e400` são preservados como bytes; o texto nunca é analisado novamente. O resultado é mínimo para aquela busca e orçamento, não globalmente; achados de ordem de chaves e timeouts não são minimizados.

Decida qual SDK está correto pelos requisitos normativos (`spec/VERIFICATION.md`, perfil de canonicalização) e fixtures compartilhados (`tests/interop/v2/`). Se não resolverem o caso, registre uma questão aberta da especificação em vez de adotar a rejeição preventiva como padrão. Corrija o SDK errado começando por um teste unitário nele, sem enfraquecer um verificador para chegar a um acordo.

## Shims

`--batch` é o protocolo do controlador (`dcp-difffuzz/3`): um processo finito por lote, via `runProcess` em `tools/conformance/external.js`, com prazo, grupo de processos próprio, SIGTERM seguido de SIGKILL, saída limitada e limpeza. A solicitação em stdin é `{protocol, run_id, nonce, now_ms, cases: [{id, policy, bundle_b64}]}`, com IDs aleatórios e sem expectativa ou nome de semente. A resposta em stdout é um documento JSON `{protocol, run_id, nonce, results}` com um resultado por caso e saída 0 depois. Solicitação malformada sai com 2. O shim Go escreve `errors` nil como `[]`; o Rust decodifica base64 apenas com `std`.

Neste protocolo interno do harness, os diagnósticos de veredicto por lote conservam no máximo 8 `errors`, cada um como prefixo literal de até 256 pontos de código Unicode. Uma lista ou string cortada leva `truncated` com `original_count` (quantidade original), `kept` (quantidade conservada), `original_code_points` (total original) e `sha256` (digest da lista original). Diagnósticos dentro desses limites não mudam. Tipos de diagnóstico malformados continuam sendo falhas de protocolo; nunca se tornam rejeições válidas. Isso não altera os formatos de transmissão do DCP nem as decisões do verificador.

O digest processa cada diagnóstico original em ordem: primeiro seu comprimento em bytes UTF-8 como inteiro de 4 bytes big-endian, depois seus bytes UTF-8. TypeScript e Python substituem surrogates isolados por U+FFFD para esse hash; o próprio prefixo diagnóstico não é normalizado. Go substitui cada byte UTF-8 inválido por U+FFFD para o hash; as strings de Rust são UTF-8 válido. Os textos diferem entre SDKs, portanto esses digests identificam diagnósticos de um shim específico, não equivalência entre SDKs.

O controlador verifica os limites e a coerência do marcador, incluindo evidência de que algo foi realmente omitido. O marcador acompanha os resultados registrados. Não pode autenticar o texto original sem dispor dele, nem provar que um shim não encurtou silenciosamente uma mensagem curta que, de resto, é válida. Achados históricos de `dcp-difffuzz/2` continuam reproduzíveis, incluindo seus diagnósticos originais sem limite; respostas ao vivo devem usar `dcp-difffuzz/3` e respeitar seus limites. A saída manual e do loop conserva o comportamento anterior.

`stats.truncated_diagnostic_observations` conta observações de diagnósticos cortados por SDK, incluindo repetições durante tentativas de isolamento e minimização; não conta entradas distintas. As cotas limitam o transporte de diagnósticos, não o cálculo nem a memória interna do SDK. Os limites de saída existentes continuam aplicáveis: um `--stdout-bytes` configurado menor pode legitimamente produzir `output_limit`, e um lote falho continua impedindo uma execução aprovada.

Sem `--batch`, cada um dos quatro shims históricos mantém a forma anterior para uso manual (o shim WASM só aceita `--batch` ou `--bound-selftest`): um documento em stdin, ou um por linha com `--loop`, `{"valid": bool, "errors": [string]}` por documento, modo opcional como primeiro argumento, política padrão própria de cada SDK e relógio de sistema.

<a id="five-sdks-wasm"></a>

## Cinco SDKs: WASM

`--sdks five` acrescenta o SDK Rust compilado para WebAssembly como quinto verificador (`shims/wasm/verify.mjs`).

- **Build.** `wasm-pack build sdks/rust --target web -- --features wasm --locked` roda no diretório próprio da execução, dentro do mesmo prazo de build (`--offline`: `--mode no-install` e `--offline`). O `tools/conformance/wrappers/.build` compartilhado nunca é tocado. São registrados o `.wasm`, o seu código JavaScript de ligação e a versão do wasm-pack; não se verifica que o toolchain reproduza esses bytes.
- **Execução.** WebAssembly hospedado no Node, não um navegador. `wasm_verify_signed_bundle_v2` lê o relógio do host: cada chamada vê o `now_ms` da requisição por meio de `Date.now`, restaurado em `finally`.
- **Bytes.** O shim passa o texto UTF-8 decodificado exatamente como chega, incluída uma marca de ordem de bytes inicial (decodificado com `ignoreBOM`), sem analisá-lo nem reserializá-lo em JavaScript. Só a rejeição documentada do parser JSON do export (um erro que começa com `JSON parse error: `) é `parse_rejected`; bytes que não são UTF-8 são `parse_rejected`, como no shim TypeScript; qualquer outro erro em banda, uma política ilegível ou um trap é `error`.
- **Fronteira do shim TypeScript.** O shim TypeScript histórico decodifica com `TextDecoder` sem `ignoreBOM`, o que remove uma marca de ordem de bytes inicial antes de `JSON.parse`. Uma diferença de veredicto com essa entrada é uma fronteira do parser desse shim, não dos SDKs; os mutadores de bundles não acrescentam marcas de ordem de bytes.
- **Conjuntos.** Cada relatório e cada achado novo registra `sdks`. Um achado sem conjunto, como todo arquivo `/2` e `/3` escrito antes de existir five, é four e é reproduzido exatamente com os quatro shims. Um replay usa sempre o conjunto do próprio achado; um `--sdks` explícito que nomeia outro conjunto é recusado (saída 3), assim como um conjunto cujos resultados não são exatamente os seus SDKs. Nenhuma omissão reduz o conjunto em silêncio.

<a id="mandate-chains"></a>

## Cadeias de mandatos

`run-mandates.mjs` envia a mesma cadeia de mandatos DCP-09 assinada aos verificadores de cadeia de TypeScript, Python, Go e Rust, pelo contrato `/4` do kit externo (`verify_mandate_chain`) e pelos seus quatro wrappers, executados pelo runner de processos do kit (formato `dcp-mandatefuzz/1`). O WASM não exporta nenhuma função de cadeias de mandatos; essa fronteira é documentada e testada pelo kit (`tools/conformance/README.md`), não sondada aqui.

```bash
node tools/difffuzz/run-mandates.mjs --iterations 120 --seed 1 --report /tmp/mandates.json
node tools/difffuzz/run-mandates.mjs --replay tools/difffuzz/findings/mandates/<file>.json
node tools/difffuzz/run-mandates.mjs --transport-probe --report /tmp/mandates-transport.json
node --test tools/difffuzz/mandate-fuzz.test.mjs  # self-tests of the harness (no SDK)
```

- **Assinatura.** O harness assina as cadeias sem nenhum SDK: tweetnacl e `@noble/post-quantum` sobre `context || 0x00 || dcp-jcs-v1(mandate without its signature fields)`, `pq_over_classical`, ML-DSA-65 com `extraEntropy: false` (verificado determinístico com a biblioteca instalada). As chaves são TEST-ONLY, derivadas de rótulos fixos: um humano e um agente por mandato da cadeia mais profunda, mais um intruso. Antes de executar, o harness verifica todas as assinaturas de `mandate_chain_vectors.json` com a sua própria construção da mensagem. O seu canonizador de inteiros exatos (até 20 dígitos) é um limite deste signatário, não uma regra de `dcp-jcs-v1`.
- **Casos.** 73 variantes em 11 famílias: papéis e contextos, ligações, profundidade, atenuação, números crus, domínios, tempo, validade das chaves signatárias, nível mínimo, revogação e codificação JSON. A profundidade conta arestas (0 a 2). Cada execução faz primeiro a varredura de cobertura (cada variante em cada profundidade a que se aplica, uma vez: 167 casos) e depois `--iterations` mutantes aleatórios. A cobertura é garantida, não probabilística; uma execução cuja varredura não terminou nunca passa.
- **Categorias de assinatura.** Uma mudança semântica é reassinada com o signatário e o contexto normativos, de modo que uma assinatura errada nunca esconde a regra exercitada. Signatários ou contextos deliberadamente errados e assinaturas obsoletas são categorias à parte, cada uma verificada como foi construída.
- **Expectativas.** Só onde decidem o DCP-09 §3.5.2 (com o seu esclarecimento de 05/11/2026), o perfil de canonicalização ou a RFC 8259; caso contrário, o caso é uma observação. A atribuição é `isolated`, `masked_by_signature` (um valor que não pode ser assinado, como `0.5`) ou `representation_dependent` (2^53 e além: assinado exatamente, mas se cada parser reproduz os bytes assinados depende da sua representação numérica). Uma observação ou uma atribuição limitada nunca escondem uma discordância ou uma falha; o relatório conta a evidência de regra à parte da concordância sem expectativa e da concordância com atribuição limitada.
- **Controles.** Cada lote leva o controle positivo e o de assinatura obsoleta de cada base. Um mutante só conta se os controles da sua profundidade passaram no mesmo lote.
- **Limites.** São limitados os casos e bytes por lote, os bytes por caso, a saída, os prazos (o de build é verificado antes de cada passo), as novas tentativas, os achados escritos e os passos de minimização. Os achados além de `--max-findings` são contados, mas não escritos nem mantidos, e a execução continua a falhar. Os IDs de lote não mudam durante o isolamento.
- **Parada.** A execução para depois do lote que dá o primeiro achado ou falha, preservado para revisão, e o indica.
- **Minimização.** Só para mutantes semânticos reassinados: cada candidato é reassinado, verificado com primitivas, mantém as quatro decisões e roda com um controle positivo que passa. Nunca para assinaturas deliberadas ou obsoletas; é mínima só para essa busca e esse orçamento.
- **Replay.** Um achado registra a sua entrada, o seu controle positivo e qualquer entrada minimizada, cada uma ligada por um hash sobre os bytes da cadeia, os bytes das chaves, os IDs revogados e o relógio, com os seus quatro resultados e a proveniência do build. O replay verifica tudo antes (base64 canônico, UTF-8 fatal que mantém uma marca de ordem de bytes, relógio RFC 3339, decisões e classes derivadas de novo), executa cada entrada sozinha, exige a linha de base exata registrada do controle e informa as diferenças de proveniência.
- **Wrappers.** TypeScript e Python rodam a partir do checkout; Go e Rust são compilados no diretório da execução, ou fornecidos com `--go-wrapper` e `--rust-wrapper` e registrados só pelo conteúdo. Códigos de saída: 0 sem achados, com todos os controles aprovados e a varredura completa; 1 caso contrário; 2 uso; 3 infraestrutura.

**Sonda de transporte.** O contrato `/4` não leva cada entrada a todos os SDKs: cada wrapper lê primeiro a cadeia como JSON UTF-8 e sai com 2 diante do que não consegue ler. `--transport-probe` envia sozinhos a cada wrapper um controle assinado, um token `NaN`, uma marca de ordem de bytes inicial e o literal `1e400`, e registra o que cada componente fez. Medido em 05/11/2026: todos os wrappers recusam `NaN` e a marca de ordem de bytes; os SDKs de TypeScript e Python recebem `1e400` e rejeitam a cadeia, enquanto os wrappers de Go e Rust o recusam. É uma observação com limites declarados, nunca um resultado de conformidade; uma recusa do wrapper nunca conta como rejeição do SDK, e as campanhas nunca enviam essas entradas.

## CI

`.github/workflows/difffuzz.yml` executa os autotestes dos dois harnesses e os testes limitados de diagnóstico com os cinco shims; depois, em cada pull request, 300 iterações com quatro SDKs, 60 com cinco e a varredura de mandatos com 120 mutantes aleatórios; por noite, 3000, 1000 e 600. Aceita `iterations` e `seed` via `workflow_dispatch`. Se o job falhar, os achados e os relatórios são enviados como artefato `difffuzz-findings`.
