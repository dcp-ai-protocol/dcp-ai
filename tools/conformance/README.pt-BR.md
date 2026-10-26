<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

<a id="dcp-ai-conformance-kit"></a>

# Kit de conformidade do DCP-AI

> Tradução informativa da [versão em inglês](README.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

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
| `v2.schema` | 4 | DCP-AI-v2.0 | `schemas/v2`, exemplos `*_v2.json` | Apenas validade de esquema |
| `ext.dcp05_09.schema` | 18 | DCP-05 a DCP-09 | `schemas/v2`, exemplos `<record>_v2.json` | Apenas validade de esquema |
| `admission.strict_v1` | 117 | `spec/profiles/admission` | `admission_vectors.json` | Resultado de admissão e códigos de erro esperados; `action_authorized` é sempre false |

<a id="limits"></a>

## Limites

- Passar em um subconjunto certifica essas verificações sobre estes fixtures e nada mais: não uma
  implementação completa do DCP, outro SDK nem uma implantação. As suítes de esquema provam apenas validade
  de esquema; a suíte de esquemas V2 não faz uma implementação V2 sem as suítes de canonicalização, hashes e
  assinaturas.
- `verified` e `admitted` nunca autorizam uma ação.
- Os adaptadores (Express, FastAPI, OpenClaw, o servidor de verificação) não fazem parte do kit.
- Pontos do protocolo não resolvidos, listados por `ext.dcp05_09.schema` e que o kit não decide:
  as métricas de `vitality_report` do DCP-05 são números em [0, 1], enquanto `dcp-jcs-v1` só canonicaliza
  inteiros; o enum `right_type` recusa os direitos em notação de domínio reverso do DCP-08 §4.3; o DCP-09 usa
  `effective_until` onde o esquema e os SDKs usam `valid_until`; os exemplos do DCP-04 ao DCP-09 usam tags de
  assinatura e campos que diferem dos esquemas e dos contextos dos SDKs.

<a id="inventory"></a>

## Inventário

Aparece em `--list` e no relatório, fora dos totais: o kit não o executa, e sua presença não é um teste
aprovado. Os vetores de ataque, os casos-limite de canonicalização e as demais categorias de
`interop_vectors.json` e os vetores de bundles e mandatos rodam nas suítes de teste dos SDKs.
`tests/nist-kat/` contém vetores de resposta conhecida e testes de propriedades, cada um com seu próprio
escopo (veja [seu README](../../tests/nist-kat/README.pt-BR.md)); eles também rodam nas suítes dos SDKs. O candidato `dcp-jcs-v2` é experimental, fica fora do `dcp-jcs-v1` e tem sua própria suíte
(`tests/interop/candidate/`).
