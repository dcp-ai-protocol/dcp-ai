<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

<a id="canonicalization-lab"></a>

# Laboratório de canonicalização

> Tradução informativa da [versão em inglês](README.md), atualizada em 27/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Um **modelo de design** executável do candidato não normativo `dcp-jcs-v2`, com o seu gerador de corpus e o seu
executor. Não é um SDK, nem um verificador, nem uma verificação de conformidade: calcula SHA-256 para os seus compromissos sintéticos,
mas não assina nada nem verifica nenhuma assinatura, e `dcp-jcs-v1` continua sendo o único perfil de canonicalização normativo e
padrão (as APIs candidatas dos SDKs são experimentais e de ativação explícita, veja [CI](#ci)). O
design, as regras e o que o modelo mostra e não mostra estão em [`docs/proposals/canonicalization-candidate/README.md`](../../docs/proposals/canonicalization-candidate/README.md).

| Arquivo | Papel |
|---|---|
| `model.py` | O modelo de design (importado apenas por `run.py`). O seu comportamento executável é o do modelo aprovado; as docstrings esclarecem os caminhos públicos e a regra assumida do último duplicado |
| `generate_corpus.py` | Escreve `docs/proposals/canonicalization-candidate/corpus.json`; as expectativas são escritas à mão e ele nunca importa o modelo |
| `run.py` | Verificações de integridade, atualidade, validade e cobertura, os 274 casos e 24 controles negativos |

Python 3.9 ou posterior no Linux ou macOS (o Windows não é suportado), apenas com a biblioteca padrão. Os comandos rodam
a partir da raiz de um checkout; de qualquer outro diretório, dê aos scripts os seus caminhos absolutos. As saídas vão para um
diretório temporário novo; o executor também recusa um caminho de saída existente.

```bash
out=$(mktemp -d)
python3 -I tools/canonicalization-lab/generate_corpus.py "$out/corpus.json"
cmp "$out/corpus.json" docs/proposals/canonicalization-candidate/corpus.json
python3 tools/canonicalization-lab/run.py --out "$out/run.json"
python3 tools/canonicalization-lab/run.py --controls --out "$out/controls.json"
```

## CI

[`.github/workflows/canonicalization-lab.yml`](../../.github/workflows/canonicalization-lab.yml) executa os mesmos
comandos no Ubuntu com Python 3.9 (o mínimo documentado) e 3.12, apenas com a biblioteca padrão, nos pushes em
`main` e nos pull requests que mudam o workflow, este diretório ou
`docs/proposals/canonicalization-candidate/`. Cada job escreve em um diretório temporário novo, regenera o
corpus e o compara byte a byte, executa os 274 casos e os 24 controles negativos, e confere as duas
contagens; qualquer falha faz o job falhar.

Ele verifica apenas o **modelo de design**. Não é conformidade dos SDKs: as APIs candidatas de ativação explícita dos SDKs
são testadas pelas suas próprias suítes e pela [matriz da fase 4](../../tests/interop/candidate/phase4/README.md); nenhum
perfil e nenhum verificador padrão executa o candidato, e `dcp-jcs-v1` não muda. Uma execução verde diz que o
modelo, o corpus e as suas expectativas concordam; não diz nada sobre nenhuma implementação.


As APIs opt-in de TypeScript e WASM estão disponíveis em `@dcp-ai/sdk` 2.2.0 e `@dcp-ai/wasm` 2.1.0; os demais SDKs têm publicações independentes.
