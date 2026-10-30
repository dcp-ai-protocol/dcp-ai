<sub>[English](../../../../tools/difffuzz/README.md) · [中文](../../../zh-CN/tools/difffuzz/README.md) · [Español](../../../es/tools/difffuzz/README.md) · [日本語](../../../ja/tools/difffuzz/README.md) · **Português**</sub>

<a id="differential-fuzzer-for-the-v2-bundle-verifiers"></a>

# Fuzzer diferencial para os verificadores de bundles V2

> Tradução informativa da [versão em inglês](../../../../tools/difffuzz/README.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

`run.mjs` passa o mesmo bundle V2 assinado e mutado aos quatro verificadores dos SDKs
(`verifySignedBundleV2` em TypeScript, `verify_signed_bundle_v2` em Python,
`VerifySignedBundleV2WithPolicy` em Go, `verify_signed_bundle_v2_with_policy` em
Rust) e trata qualquer desacordo no veredito `valid`, qualquer falha e qualquer
tempo esgotado como um achado. A rodada de segurança encerrada pela v2.10.0 consistiu quase inteiramente em
desacordos entre os quatro verificadores; esta ferramenta é a forma de encontrá-los
antes de uma versão.

<a id="setup"></a>

## Preparação

Cada SDK é executado a partir deste checkout, nunca de um pacote publicado:

```bash
(cd sdks/typescript && npm install && npm run build) # shims/ts imports sdks/typescript/dist
pip install -e sdks/python                            # dependencies of shims/py (pynacl, pqcrypto>=1.0)
```

Go (a versão de `sdks/go/go.mod`) e uma toolchain estável de Rust devem estar no
`PATH`; o driver compila ele mesmo `shims/go` (um módulo que substitui com `replace` o SDK por
`../../../../sdks/go`) e `shims/rust` (um crate com uma dependência de caminho para
`../../../../sdks/rust`).

<a id="usage"></a>

## Uso

```bash
node tools/difffuzz/run.mjs                       # 200 iterations, seed 1
node tools/difffuzz/run.mjs --iterations 2000 --seed 7
```

| Opção            | Padrão                          | Significado                                                    |
| ---------------- | ------------------------------- | -------------------------------------------------------------- |
| `--iterations N` | `200`                           | mutantes a gerar                                               |
| `--seed S`       | `1`                             | semente do PRNG; a mesma semente e os mesmos arquivos de sementes dão os mesmos mutantes |
| `--modes a,b`    | `default,hybrid_required`       | políticas de verificador sob as quais cada mutante é executado |
| `--timeout MS`   | `30000`                         | tempo máximo por veredito; excedê-lo é um achado               |
| `--python PATH`  | `$DIFFFUZZ_PYTHON` or `python3` | interpretador com o SDK de Python instalado                    |
| `--out DIR`      | `tools/difffuzz/findings`       | onde os achados são escritos                                   |

O código de saída é 1 quando há pelo menos um achado. O resumo no fim
informa iterações, vereditos, concordâncias, achados e a mistura de mutadores.

<a id="policies"></a>

### Políticas

`default` é a política de verificador padrão de cada SDK (`DEFAULT_VERIFIER_POLICY`,
`DefaultVerifierPolicy()`, `VerifierPolicy::default()`), que mapeia o
nível de risco do passaporte para `classical_only` / `hybrid_preferred` /
`hybrid_required`. Qualquer outro nome de modo é aplicado a `default_mode` e a
todos os níveis de risco, como fazem os testes de interoperabilidade dos SDKs, então `hybrid_required` executa cada
bundle sob o modo estrito.

<a id="seeds"></a>

### Sementes

Todos os bundles V2 assinados encontrados em `tests/interop/v2/bundle_vectors.json`
(`signed_bundle`, `must_accept_bundles`, `classical_only_routine_bundle`,
`must_reject_bundles`), em `tests/interop/v2/cross_sdk_vectors.json` e em
`tests/conformance/examples/*.json` (vazio até que exemplos V2 assinados sejam
incluídos ali). Cada semente é primeiro verificada sem mutação sob todos os modos (a
linha de base); um desacordo na linha de base também é um achado. A maioria das sementes são
bundles `must_reject`, que todos os SDKs já rejeitam, então pelo menos metade das
iterações parte de uma semente cujo veredito de linha de base sob o primeiro modo
é válido; a linha de resumo informa a divisão.

<a id="mutators"></a>

### Mutadores

Cada iteração aplica uma mutação (70%) ou duas (30%) em uma posição aleatória:
apagar uma chave, definir um valor como `null`, trocar o tipo de um valor, trocar dois valores
irmãos, inverter um caractere de uma string base64, substituir uma string enumerada
por uma chave do protótipo (`constructor`, `__proto__`, `toString`, `valueOf`, ...),
renomear uma chave para uma chave do protótipo, adicionar uma chave desconhecida, duplicar um artefato (ou
o seu `payload`, `payload_hash` ou `composite_sig`) em outra posição, reescrever um
número como `1.0`, `1e2`, `-0`, `0.1`, `2^64`, `1e400`, ..., reescrever um carimbo de data/hora RFC 3339
com outro deslocamento, malformado ou muito no passado ou no futuro, uma
string grande demais (64 KiB ou 1 MiB), um valor aninhado em 100 níveis e uma reordenação recursiva
de chaves, que nunca deve mudar um veredito (é comparada com o veredito de
linha de base da semente). Números que o JavaScript não consegue representar são inseridos literalmente no
texto serializado, então todos os parsers veem os mesmos bytes.

<a id="findings"></a>

## Achados

Cada achado é escrito em `findings/<seed>-<iteration>.json` (o Git ignora o diretório,
exceto `.gitkeep`) com o nome da semente, o caminho da mutação,
o texto exato do mutante e os quatro vereditos por modo que discordaram:

```json
{
  "seed": "1",
  "iteration": 42,
  "seed_name": "bundle_vectors.signed_bundle",
  "mutations": [{ "mutator": "set_null", "detail": "bundle.audit_entries" }],
  "verdicts": {
    "default": {
      "ts": { "valid": false, "errors": ["..."] },
      "py": { "crash": "exit 1: ..." },
      "go": { "valid": false, "errors": ["..."] },
      "rust": { "valid": false, "errors": ["..."] }
    }
  },
  "mutant_json": "{...}"
}
```

Um achado é uma pista, ainda não um bug. Primeiro reproduza-o: um desacordo ou falha
que se reproduz com o mutante exato é uma divergência a resolver; um tempo esgotado, uma
falha da toolchain ou da máquina, ou um resultado que não se reproduz é
um problema de infraestrutura até prova em contrário. Minimize o reprodutor e
decida qual SDK está certo a partir dos requisitos normativos
(`spec/VERIFICATION.md`, o perfil de canonicalização) e dos fixtures compartilhados
(`tests/interop/v2/`). Quando eles não resolvem o caso, é uma questão em aberto
para a especificação, não uma correção a escolher: registre-a em vez de adotar
por padrão o veredito que falha fechado. Corrija o SDK errado começando por um teste unitário
nesse SDK, e nunca enfraqueça um verificador para chegar a um acordo. O mutante exato pode ser
reproduzido por meio de um shim:

```bash
node -e 'console.log(require("./tools/difffuzz/findings/1-42.json").mutant_json)' | node tools/difffuzz/shims/ts/verify.mjs
```

## Shims

Cada shim em `shims/` lê um documento JSON pela stdin e escreve uma linha JSON
na stdout, `{"valid": bool, "errors": [string]}`, com código de saída 0 para um
veredito e qualquer outro para uma falha. Com `--loop`, lê um documento compacto
por linha e responde a cada um, que é como o driver os executa (um
processo de longa duração por SDK e modo, reiniciado após uma falha ou tempo esgotado). Um
primeiro argumento posicional seleciona o modo, como descrito em Políticas. Um
documento que o parser JSON do SDK rejeita é um veredito `valid: false`.

## CI

`.github/workflows/difffuzz.yml` executa 300 iterações em cada pull request,
3000 todas as noites, e aceita as entradas `iterations` e `seed` no `workflow_dispatch`.
Os achados são enviados como o artefato `difffuzz-findings` quando o job falha.
