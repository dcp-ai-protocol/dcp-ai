<sub>[English](../../../../../../tests/interop/candidate/phase4/README.md) · [中文](../../../../../zh-CN/tests/interop/candidate/phase4/README.md) · [Español](../../../../../es/tests/interop/candidate/phase4/README.md) · [日本語](../../../../../ja/tests/interop/candidate/phase4/README.md) · **Português**</sub>

<a id="phase-4-matrix-candidate-producers--consumers"></a>
<a id="phase-4-matrix-candidate-producers-consumers"></a>

# Matriz da fase 4: produtores × consumidores do candidato

> Tradução informativa da [versão em inglês](../../../../../../tests/interop/candidate/phase4/README.md), atualizada em 02/11/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Experimental e inativa. Estes testes são evidência para
[o §18 do README do candidato](../../../../../../docs/proposals/canonicalization-candidate/README.md#18-experimental-sdk-producers-phase-4).
Não ativam `dcp-jcs-v2` nem mudam nenhum padrão.

<a id="files"></a>

## Arquivos

| Arquivo | Finalidade |
|---|---|
| [`run.mjs`](../../../../../../tests/interop/candidate/phase4/run.mjs) | O executor: a matriz, `--cost` e `--self-test` |
| [`phase4-specs.json`](../../../../../../tests/interop/candidate/phase4/phase4-specs.json) | As 12 especificações, os 16 negativos e as expectativas |
| `adapters/ts.mjs`, `adapters/wasm.mjs`, `adapters/py_adapter.py`, `adapters/common.mjs` | Os adaptadores de TypeScript, WASM e Python |
| `sdks/go/dcp/v2/experimental_candidate_phase4_matrix_test.go` | O adaptador de Go, um teste que só roda sob o executor |
| `sdks/rust/tests/experimental_candidate_phase4_matrix.rs` | O adaptador de Rust, um teste que só roda sob o executor |

<a id="what-a-run-does"></a>

## O que uma execução faz

1. O adaptador de TypeScript escreve as entradas da execução:
   - chaves sintéticas novas;
   - as peças de entrada de cada especificação como texto JSON, os mesmos bytes para todos os produtores.
2. Cada produtor assina cada especificação nos modos que ela lista (bytes e value para `S01` a `S10`, apenas
   bytes para `S11`, apenas value para `S12`) com a sua API pública de ativação explícita. Ele também
   deriva os IDs de chave e os escreve para comparação.
3. Cada produtor monta o anel: `S01` a partir dos artefatos que o produtor seguinte assinou (ts, py, go, rust,
   wasm, ts).
4. O executor escreve 16 negativos em nível de bytes da saída recém-gerada de cada produtor.
5. Cada consumidor verifica tudo com o verificador da fase 3. Para cada item, ele informa a rota, a
   classe, o verificador em que entrou, o veredito e as chamadas que observou ao seu decodificador histórico.

O veredito é tudo ou nada. Ele espera:

- exatamente 975 resultados (115 unidades × 5 consumidores, e 16 × 5 × 5 negativos no nível de bytes): 525 positivos e 450
  negativos, os 400 no nível de bytes e os 50 resultados de `S09` que a V2-2 rejeita (abaixo). Antes da V2-2 todas as
  unidades eram positivas: 575 e 400;
- todas as etapas, e cada resultado recém-gerado nesta execução;
- o mesmo `manifest_hash` de todos os produtores para cada especificação;
- a mesma unidade de todos os produtores, exceto os valores das assinaturas ML-DSA, que são mascarados apenas nas suas
  posições conhecidas;
- os mesmos IDs de chave de todos os SDKs;
- que a execução termine antes do prazo (`--deadline`, 1800 s por padrão). No prazo, todo o grupo de processos
  da etapa é encerrado: cada etapa começa destacada no seu próprio grupo de processos POSIX, então isso não é garantido no
  Windows.

<a id="s09-under-v2-2"></a>

### `S09` sob a V2-2

A V2-2 é a validação de esquema do verificador de cada SDK. Na rota do candidato ela roda depois do parser e da política de
perfis, e antes de o verificador conferir os hashes dos payloads e as assinaturas. Ela fecha a entrada de auditoria, o
checkpoint, o envelope `SignedPayload` e o seu `composite_sig`. `S09` põe em cada um deles um membro que o produtor não conhece,
então os seus 50 resultados (5 produtores × 2 modos × 5 consumidores) são rejeitados na rota do candidato. A especificação e os
seus bytes não mudam; a expectativa está no executor (`V2_2_CLOSED_MEMBERS` em `run.mjs`):

- rota `candidate`, entrada no verificador `dcp-jcs-v2`, `verified` falso, sem classe e sem chamadas ao decodificador;
- estes quatro diagnósticos, nesta ordem, que todos os SDKs retornam:
  - `schema: /bundle/audit_entries/1 additionalProperties x_entry_ext`
  - `schema: /bundle/intent additionalProperties x_artifact_ext`
  - `schema: /bundle/intent/composite_sig additionalProperties x_sig_ext`
  - `schema: /bundle/pq_checkpoints/0 additionalProperties x_checkpoint_ext`

  Os adaptadores registram apenas os três primeiros erros de um resultado, então a matriz compara exatamente esses três. Os
  testes dos produtores (geração de bundles) de cada SDK afirmam os quatro;
- cada rejeição só conta quando o mesmo consumidor verifica a unidade `S04` (o checkpoint sem esses membros) do mesmo
  produtor e modo.

O membro que `S09` adiciona ao target do intent é aberto e não gera nenhum diagnóstico. A execução falha se algum resultado de
`S09` for aceito ou rejeitado de outra forma, ou se qualquer outro positivo for rejeitado.

<a id="running-it"></a>

## Como executá-la

Compile primeiro: `sdks/typescript` (`npm run build`) e `sdks/wasm` (`npm run build:wasm` e `npm run build:ts`).
O Python precisa das dependências do SDK; Go e Cargo são usados como estiverem instalados. A partir da raiz de um checkout:

```bash
node tests/interop/candidate/phase4/run.mjs --self-test
DCP_PHASE4_PYTHON=python3 node tests/interop/candidate/phase4/run.mjs --deadline 900
DCP_PHASE4_PYTHON=python3 node tests/interop/candidate/phase4/run.mjs --cost
```

Cada execução escreve um diretório novo sob o diretório temporário do sistema, ou sob `--out <dir>`. O diretório
contém as chaves, as saídas, os resultados, os logs e o `summary.json` (ou `cost-summary.json`). Ele é privado de quem
o executa: as chaves são sintéticas, mas nada nele se destina a ser publicado. O código de saída 0 significa que todas as verificações
passaram, 1 que algo falhou, 2 uma configuração inválida (um `--deadline` que não é um número positivo).

`--cost` mede o portão 10 sobre um par equivalente por plataforma. Os dois lados usam as mesmas chaves, cargas úteis, sessão
e entradas de auditoria, e isso é conferido nas saídas. Cada operação roda 20 vezes após 3 de aquecimento, com no
máximo 60 s por plataforma. As compilações de Go e Rust são cronometradas à parte, e o Rust é medido no perfil release.
Os limites desses números estão no §18.3 do README do candidato.
