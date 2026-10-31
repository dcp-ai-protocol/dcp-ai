<sub>[English](../../../../tools/difffuzz/README.md) · [中文](../../../zh-CN/tools/difffuzz/README.md) · [Español](../../../es/tools/difffuzz/README.md) · [日本語](../../../ja/tools/difffuzz/README.md) · **Português**</sub>

<a id="differential-fuzzer-for-the-v2-bundle-verifiers"></a>

# Fuzzer diferencial dos verificadores de bundles V2

> Tradução informativa da [versão em inglês](../../../../tools/difffuzz/README.md), atualizada em 31/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são preservados sem tradução.

`run.mjs` envia o mesmo bundle V2 assinado e mutado aos quatro verificadores SDK (`verifySignedBundleV2` no TypeScript, `verify_signed_bundle_v2` no Python, `VerifySignedBundleV2At` no Go e `verify_signed_bundle_v2_at` no Rust), sob uma política explícita e um mesmo instante de verificação. São achados: divergência, veredicto contrário ao declarado nos vetores compartilhados, reordenação de chaves que muda o veredicto e qualquer erro, queda ou timeout. A rodada de segurança encerrada em v2.10.0 consistiu quase toda em divergências entre os quatro verificadores; esta ferramenta permite encontrá-las antes de uma publicação. O controlador é `fuzz.mjs`, compartilhado por `run.mjs` e pelos autotestes.

<a id="setup"></a>

## Preparação

Cada SDK é executado deste checkout, nunca de um pacote publicado:

```bash
(cd sdks/typescript && npm install && npm run build) # shims/ts imports sdks/typescript/dist
pip install -e sdks/python                            # dependencies of shims/py (pynacl, pqcrypto>=1.0)
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
```

| Opção | Padrão | Significado |
| --- | --- | --- |
| `--iterations N` | `200` | mutantes a gerar (0 a 1.000.000) |
| `--seed S` | `1` | semente do PRNG; mesma semente e fixtures produzem os mesmos mutantes |
| `--modes a,b` | `default,hybrid_required` | políticas de cada semente e mutante (ver Políticas) |
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

Cada valor é validado antes de compilar: argumento desconhecido, repetido, ausente ou fora do intervalo gera saída 2. Códigos: 0 sem achados ou lotes com falha e com baseline completo; 1 pelo menos um achado, lote com falha ou baseline incompleto; 2 uso; 3 falha de infraestrutura ou do executor (compilação falha, entradas alteradas durante a execução, shim que não inicia ou responde fora do protocolo ou como não suportado, em lote ou sozinho, orçamento de tentativas esgotado, ou nenhuma semente declarada válida no primeiro modo quando há iterações). Os comandos são sempre exatamente os quatro shims.

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

Cada achado é escrito em `findings/<seed>-<iteration>-<mode>-<n>.json` (diretório ignorado pelo Git, exceto `.gitkeep`): classes, semente, modo, política explícita e `now_ms`, mutações, resultado de cada SDK e bytes exatos de entrada (`input_b64`, `input_sha256`). Um achado é uma pista, ainda não um defeito. Reproduza-o primeiro com `--replay`: bytes registrados e entrada minimizada, quando existir, passam pelos quatro shims com o `now_ms` e a política próprios do achado, em lote junto ao seu controle registrado. Este contém bytes originais da semente sem mutação, hash, política, expectativa e resultados de baseline; nunca o fixture atual com aquele nome. O achado é validado antes, com tipos completos: tipo, conjunto de classes conhecidas igual ao derivado dos resultados, quatro resultados tipados, hashes e controle. Compilação, controlador, fixtures e semente atuais são comparados aos registrados e toda diferença é relatada como diferença de procedência. Saídas do replay: 0 decisões e baseline do controle reproduzidos; 1 não reproduzidos; 3 achado, controle ou infraestrutura não permitem avaliação.

Divergências, erros e quedas de mutantes são então minimizados dentro de um orçamento (achado de expectativa já é semente não mutada), somente com controle positivo: a semente sem mutação passou seu baseline naquele modo, verificada `true` pelos quatro SDKs. Semente corretamente rejeitada não é controle. Reduzem-se as diferenças preservando a decisão de cada SDK e o baseline da semente, executada junto ao candidato. Tokens brutos como `1e400` são preservados como bytes; o texto nunca é analisado novamente. O resultado é mínimo para aquela busca e orçamento, não globalmente; achados de ordem de chaves e timeouts não são minimizados.

Decida qual SDK está correto pelos requisitos normativos (`spec/VERIFICATION.md`, perfil de canonicalização) e fixtures compartilhados (`tests/interop/v2/`). Se não resolverem o caso, registre uma questão aberta da especificação em vez de adotar a rejeição preventiva como padrão. Corrija o SDK errado começando por um teste unitário nele, sem enfraquecer um verificador para chegar a um acordo.

## Shims

`--batch` é o protocolo do controlador (`dcp-difffuzz/2`): um processo finito por lote, via `runProcess` em `tools/conformance/external.js`, com prazo, grupo de processos próprio, SIGTERM seguido de SIGKILL, saída limitada e limpeza. A solicitação em stdin é `{protocol, run_id, nonce, now_ms, cases: [{id, policy, bundle_b64}]}`, com IDs aleatórios e sem expectativa ou nome de semente. A resposta em stdout é um documento JSON `{protocol, run_id, nonce, results}` com um resultado por caso e saída 0 depois. Solicitação malformada sai com 2. O shim Go escreve `errors` nil como `[]`; o Rust decodifica base64 apenas com `std`.

Sem `--batch`, cada shim mantém a forma anterior para uso manual: um documento em stdin, ou um por linha com `--loop`, `{"valid": bool, "errors": [string]}` por documento, modo opcional como primeiro argumento, política padrão própria de cada SDK e relógio de sistema.

## CI

`.github/workflows/difffuzz.yml` executa autotestes e depois 300 iterações em cada pull request, 3000 por noite, e aceita `iterations` e `seed` em `workflow_dispatch`. Se o job falhar, achados e relatório são enviados como artefato `difffuzz-findings`.
