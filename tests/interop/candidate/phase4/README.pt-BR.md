<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

<a id="phase-4-matrix-candidate-producers--consumers"></a>
<a id="phase-4-matrix-candidate-producers-consumers"></a>

# Matriz da fase 4: produtores × consumidores do candidato

> Tradução informativa da [versão em inglês](README.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Experimental e inativa. Estes testes são evidência para
[o §18 do README do candidato](../../../../docs/proposals/canonicalization-candidate/README.md#18-experimental-sdk-producers-phase-4).
Não ativam `dcp-jcs-v2` nem mudam nenhum padrão.

<a id="files"></a>

## Arquivos

| Arquivo | Finalidade |
|---|---|
| [`run.mjs`](run.mjs) | O executor: a matriz, `--cost` e `--self-test` |
| [`phase4-specs.json`](phase4-specs.json) | As 12 especificações, os 16 negativos e as expectativas |
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

- exatamente 975 resultados: 575 positivos (115 unidades × 5 consumidores) e 400 negativos (16 × 5 × 5);
- todas as etapas, e cada resultado recém-gerado nesta execução;
- o mesmo `manifest_hash` de todos os produtores para cada especificação;
- a mesma unidade de todos os produtores, exceto os valores das assinaturas ML-DSA, que são mascarados apenas nas suas
  posições conhecidas;
- os mesmos IDs de chave de todos os SDKs;
- que a execução termine antes do prazo (`--deadline`, 1800 s por padrão). No prazo, todo o grupo de processos
  da etapa é encerrado: cada etapa começa destacada no seu próprio grupo de processos POSIX, então isso não é garantido no
  Windows.

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
