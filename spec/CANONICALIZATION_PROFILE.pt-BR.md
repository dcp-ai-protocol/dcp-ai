<sub>[English](CANONICALIZATION_PROFILE.md) · [中文](CANONICALIZATION_PROFILE.zh-CN.md) · [Español](CANONICALIZATION_PROFILE.es.md) · [日本語](CANONICALIZATION_PROFILE.ja.md) · **Português**</sub>

<a id="dcp-ai-canonicalization-profile"></a>

# Perfil de canonicalização do DCP-AI

> Tradução informativa da [especificação em inglês](CANONICALIZATION_PROFILE.md), atualizada em 25/10/2026. **A versão normativa é a inglesa**: esta tradução não tem valor normativo e, em caso de divergência, prevalece o inglês. Identificadores e blocos de código são mantidos sem tradução.

**Identificador do perfil:** `dcp-jcs-v1`
**Estado:** Publicado — v2.0
**Incluído pela primeira vez em:** Python 2.8.0, Rust 2.8.0, Go v2.8.0, TypeScript 2.1.0

Este documento é a referência normativa da canonicalização JSON
exata byte a byte no DCP-AI. Ele substitui o resumo de cinco tópicos que
aparecia em `spec/DCP-AI-v2.0.md` § 15. Cada assinatura, cada hash e
cada folha de Merkle de um artefato do DCP são calculados sobre a saída do
algoritmo especificado aqui.

O perfil é **baseado na RFC 8785 (JCS)**. Ele restringe os números a
inteiros (regra 4) e dá tratamento explícito aos casos que o JCS deixa
definidos pela implementação. Não é um subconjunto estrito do JCS: a regra 1 ordena
as chaves dos objetos por ponto de código Unicode, enquanto a RFC 8785 §3.2.3 as ordena por
unidades de código UTF-16. As duas ordens só diferem quando as chaves de um objeto misturam
caracteres do plano suplementar (U+10000 em diante) com caracteres de
U+E000..U+FFFF. Os SDKs que afirmam cumprir o perfil devem (MUST) produzir
uma saída idêntica byte a byte para a tabela de casos-limite do §3.

---

<a id="1-why-a-profile-and-not-just-jcs"></a>

## 1. Por que um perfil e não simplesmente “JCS”

A RFC 8785 fixa as regras estruturais —chaves ordenadas, forma compacta, escape
de strings, representação de números— mas deixa algumas decisões à
linguagem hospedeira do produtor: como `undefined` é tratado, o que acontece com
floats que têm valor inteiro, se `1e2` é normalizado,
como os tipos do hospedeiro equivalentes a `null` são mapeados para JSON `null`. Em quatro SDKs
(TypeScript, Python, Rust, Go) esses padrões divergem e produzem
bytes diferentes para o mesmo objeto de origem. `dcp-jcs-v1` fixa cada uma
dessas decisões para que os quatro SDKs produzam uma saída idêntica.

---

<a id="2-normative-rules"></a>

## 2. Regras normativas

Um produtor que implementa `dcp-jcs-v1` deve (MUST) respeitar as regras 1 a 8.
Um verificador que consome `dcp-jcs-v1` deveria (SHOULD) rejeitar artefatos cuja
saída se desvie destas regras.

<a id="rule-1--sorted-keys"></a>
<a id="rule-1-sorted-keys"></a>

### Regra 1 — Chaves ordenadas

As chaves dos objetos são ordenadas lexicograficamente por ponto de código Unicode em
ordem crescente. A ordenação é feita em todos os níveis de aninhamento.

```
input    → {"z": 1, "a": 2, "é": 3, "e": 4}
output   → {"a":2,"e":4,"z":1,"é":3}
```

<a id="rule-2--compact-form"></a>
<a id="rule-2-compact-form"></a>

### Regra 2 — Forma compacta

Nenhum espaço em branco fora dos valores de string. O separador de pares é `,`,
o separador entre chave e valor é `:`. Sem vírgulas finais.

<a id="rule-3--string-escaping"></a>
<a id="rule-3-string-escaping"></a>

### Regra 3 — Escape de strings

As strings são codificadas em UTF-8. O escape segue a RFC 8785 §3.2: só são escapados os
caracteres que o JSON exige escapar (caracteres de controle U+0000
a U+001F, `"`, `\`). A barra, os caracteres
não ASCII, os emoji, os kanji etc. são emitidos literalmente como a sua sequência de bytes
UTF-8.

```
input    → {"emoji": "🔑", "kanji": "鍵"}
output   → {"emoji":"🔑","kanji":"鍵"}
```

<a id="rule-4--numeric-values-integer-only"></a>
<a id="rule-4-numeric-values-integer-only"></a>

### Regra 4 — Valores numéricos: apenas inteiros

O formato de transmissão só aceita números cujo valor é um inteiro exato.
“Inteiro exato” é decidido **depois da análise**:

- Um `Number` JSON é válido se e somente se (a) for finito e (b) o seu valor não tiver
  parte fracionária (`floor(n) == n`).
- Um `Number` cujo literal de origem era `1.0`, `1.00`, `1e2`, `100` ou
  `-0` é válido porque todos esses literais são decodificados para um valor inteiro
  após a análise.
- Um `Number` cujo valor é `0.1`, `1.5`, `1e-1`, `NaN` ou `±Infinity`
  não é válido e o canonicalizador deve (MUST) lançar um erro antes de produzir qualquer
  saída.

Normalização da saída: todo número válido é emitido em forma de inteiro simples,
sem ponto decimal, sem expoente, sem zeros à esquerda (exceto
`0`) e sem zeros finais.

```
{"n": 1.0}    → {"n":1}
{"n": 1e2}    → {"n":100}
{"n": -0}     → {"n":0}
{"n": 0.1}    → ERROR
{"n": NaN}    → ERROR
```

Esta regra é o que faz os quatro SDKs convergirem: um produtor JavaScript
pode passar `1.0` como literal (não tem tipo inteiro), um produtor Python
pode passar `int(100)`, um produtor Go pode passar `1e2` analisado a partir de
JSON, e os quatro emitem os mesmos bytes.

<a id="rule-5--null-preservation"></a>
<a id="rule-5-null-preservation"></a>

### Regra 5 — Preservação de null

Um valor JSON `null` deve (MUST) ser preservado com a sua chave:

```
input    → {"x": null, "y": 1}
output   → {"x":null,"y":1}
```

Um null dentro de um array preserva a sua posição:

```
input    → [1, null, 3]
output   → [1,null,3]
```

<a id="rule-6--null-and-undefined-handling-cross-language"></a>
<a id="rule-6-null-and-undefined-handling-cross-language"></a>

### Regra 6 — Tratamento de null e undefined (entre linguagens)

O JSON tem um único canal de valor ausente (`null`). As linguagens hospedeiras têm mais.
O TypeScript é a única linguagem hospedeira que distingue `undefined`
de `null`; Python, Go e Rust não. O canonicalizador deve (MUST) tratar
cada valor do hospedeiro assim:

| Linguagem hospedeira | Valor do hospedeiro                                 | Em uma chave de objeto | Em uma posição de array |
|---------------|-----------------------------------------------------|------------------|------------------|
| TypeScript    | `undefined`                                         | **omitir a chave** | emitir `null`      |
| TypeScript    | `null`                                              | emitir `null`      | emitir `null`      |
| Python        | chave ausente                                       | **omitir a chave** | n/a              |
| Python        | `None`                                              | emitir `null`      | emitir `null`      |
| Go            | entrada de mapa ausente                             | **omitir a chave** | n/a              |
| Go            | interface `nil` / null JSON explícito               | emitir `null`      | emitir `null`      |
| Rust          | campo de struct ausente com `skip_serializing_if=None` | **omitir a chave** | n/a              |
| Rust          | `Option::None` serializado sem skip                 | emitir `null`      | emitir `null`      |
| Rust          | `Value::Null`                                       | emitir `null`      | emitir `null`      |

```
input    → { a: 1, b: undefined, c: 3 }   (TS)
output   → {"a":1,"c":3}

input    → [1, undefined, 3]              (TS)
output   → [1,null,3]

input    → {"a": 1, "b": None, "c": 3}    (Python)
output   → {"a":1,"b":null,"c":3}
```

Isso é assimétrico de propósito: no TypeScript, um objeto com uma
chave ausente e um objeto com `b: undefined` produzem a mesma saída,
de acordo com a incapacidade do JSON de expressar separadamente “ausente versus valor
undefined”. Dentro de um array a posição tem significado, então
`undefined` se materializa como `null`.

Os SDKs não devem (MUST NOT) inventar um canal `undefined` onde a linguagem hospedeira não tem
nenhum. `None` do Python, `nil` do Go de um tipo interface que produziu um null JSON
na análise, e `Value::Null` do Rust são todos mapeados para JSON `null`.

<a id="rule-7--booleans"></a>
<a id="rule-7-booleans"></a>

### Regra 7 — Booleanos

Os booleanos são emitidos como os literais `true` e `false`.

```
input    → {"t": true, "f": false}
output   → {"f":false,"t":true}
```

<a id="rule-8--empty-containers"></a>
<a id="rule-8-empty-containers"></a>

### Regra 8 — Contêineres vazios

Um objeto vazio emite `{}`. Um array vazio emite `[]`. Nenhum dos dois é
omitido.

```
input    → {}
output   → {}

input    → []
output   → []
```

<a id="rule-9--unicode-normalization-is-out-of-scope"></a>
<a id="rule-9-unicode-normalization-is-out-of-scope"></a>

### Regra 9 — A normalização Unicode está FORA DO ESCOPO

As strings são emitidas como a sua sequência de bytes UTF-8 com as regras de
escape da regra 3, **sem** nenhuma normalização Unicode (NFC, NFD,
NFKC, NFKD). Um produtor que fornece a string pré-composta `"é"`
(U+00E9) e um produtor que fornece a sequência decomposta
`"e"` + `U+0301` produzirão **bytes diferentes**, embora as
duas strings sejam exibidas da mesma forma e sejam iguais sob a equivalência
canônica.

É uma não decisão deliberada: exigir uma forma de normalização na
camada de canonicalização obrigaria todo SDK a trazer uma dependência equivalente a ICU ou a
tabelas Unicode, e ainda deixaria em aberto
qual forma (NFC ou NFKC) vence. As aplicações que se preocupam com
a resistência a homógrafos devem (MUST) normalizar as suas strings **antes** de
entregar o valor ao canonicalizador (NFC é a escolha convencional
para o intercâmbio de JSON no fio — RFC 8259 § 8.1).

Um perfil futuro (`dcp-jcs-v2` ou posterior) pode (MAY) fixar uma forma de normalização;
essa decisão ficará no seu próprio documento de perfil.

> Nota sobre `NaN` / `±Infinity`: esses valores não fazem parte do formato
> de transmissão JSON da RFC 8259. A maioria dos parsers JSON os rejeita na análise, então
> o canonicalizador nunca os vê. Onde um parser os aceita
> (por exemplo, `json.loads("NaN")` do Python, que os aceita por padrão, ou valores
> construídos à mão em JavaScript), a regra 4 continua a rejeitá-los após a análise. Os fixtures de
> interoperabilidade deliberadamente não trazem um vetor NaN/Infinity porque nenhuma sintaxe JSON
> portátil consegue expressá-los; a rejeição é verificada por testes unitários de cada SDK
> (por exemplo, `sdks/rust/src/v2/canonicalize.rs` `test_rejects_non_finite`).

---

<a id="3-edge-case-acceptance-table"></a>

## 3. Tabela de aceitação de casos-limite

Estes são os casos que divergiam entre SDKs antes de o perfil ser formalizado.
Um SDK que cumpre o perfil deve (MUST) coincidir com cada célula desta
tabela.

| Entrada (literal JSON) | Saída | Notas |
|---|---|---|
| `null` | `null` | Regra 5 |
| `true` | `true` | Regra 7 |
| `false` | `false` | Regra 7 |
| `0` | `0` | Regra 4 |
| `-0` | `0` | Regra 4, sinal normalizado |
| `1` | `1` | Regra 4 |
| `1.0` | `1` | Regra 4, float de valor inteiro |
| `1.00` | `1` | Regra 4, zeros finais |
| `1e2` | `100` | Regra 4, notação científica com valor inteiro |
| `100` | `100` | Regra 4 |
| `-42` | `-42` | Regra 4 |
| `0.1` | ERROR | Regra 4, valor fracionário |
| `1.5` | ERROR | Regra 4, valor fracionário |
| `1.0e-1` | ERROR | Regra 4, valor fracionário |
| `NaN` | ERROR | Regra 4, não finito |
| `Infinity` | ERROR | Regra 4, não finito |
| `{}` | `{}` | Regra 8 |
| `[]` | `[]` | Regra 8 |
| `{"x": null, "y": 1}` | `{"x":null,"y":1}` | Regra 5 |
| `[1, null, 3]` | `[1,null,3]` | Regra 5 |
| `{"é": 1, "e": 2, "z": 3}` | `{"e":2,"z":3,"é":1}` | Regra 1, ordem por ponto de código |
| `{"a": {"b": {"c": 42}}}` | `{"a":{"b":{"c":42}}}` | Regra 1, recursivo |
| `{"ﬁ": 1, "😀": 2, "a": 3}` | `{"a":3,"ﬁ":1,"😀":2}` | Regra 1, ordem por ponto de código: U+FB01 < U+1F600 (a ordem por unidades de código UTF-16 poria o emoji primeiro) |
| `{"s": "<a href='/x?y=1&z=2'>"}` | `{"s":"<a href='/x?y=1&z=2'>"}` | Regra 3, `<`, `>` e `&` não são escapados |
| `{"s": "a b c"}` | `{"s":"a` U+2028 `b` U+2029 `c"}` como UTF-8 sem escape | Regra 3, os separadores de linha e de parágrafo não são escapados |
| `{"s": "\u0000\u0008\t\n\u000b\f\r\u001f\"\\"}` | `{"s":"\u0000\b\t\n\u000b\f\r\u001f\"\\"}` | Regra 3, escapes curtos da RFC 8785 §3.2, `\u00xx` em minúsculas para os demais controles de C0 |

---

<a id="4-bundle-manifest-declaration"></a>

## 4. Declaração no manifesto do bundle

Os bundles produzidos sob este perfil deveriam (SHOULD) incluir um campo de nível superior
`canonicalization_profile` no manifesto:

```json
{
  "manifest": {
    "canonicalization_profile": "dcp-jcs-v1",
    "session_nonce": "...",
    "rpr_hash": "sha256:...",
    ...
  }
}
```

O campo é opcional por compatibilidade com os bundles produzidos
antes de o perfil existir. Os verificadores que encontram um bundle sem
o campo devem (MUST) assumir `dcp-jcs-v1` (porque ainda não existe nenhum outro
perfil). Quando perfis futuros forem publicados (`dcp-jcs-v2`, ...), o campo passará
a ser obrigatório para desambiguar.

O campo é acrescentado a `schemas/v2/bundle_manifest.schema.json`:

```json
"canonicalization_profile": {
  "type": "string",
  "const": "dcp-jcs-v1",
  "description": "Identifier of the canonicalization profile under which this bundle was produced."
}
```

---

<a id="5-versioning"></a>

## 5. Versionamento

Este documento define o perfil `dcp-jcs-v1`, que está **congelado**: qualquer
mudança nas regras acima exige um novo identificador de perfil. A
governança para acrescentar um perfil novo:

- Uma mudança que admite entradas novas ou normaliza de outra forma → perfil
  novo (por exemplo, `dcp-jcs-v2`).
- Uma mudança que só endurece a validação (rejeitando entradas que antes
  eram aceitas) → avalie se os verificadores a jusante podem
  se atualizar ao mesmo tempo; se não, exige um perfil novo.
- Um esclarecimento que documenta o comportamento existente sem mudá-lo
  → atualização no local, registrada no CHANGELOG com o mesmo identificador de perfil.

Quando um perfil futuro for publicado:

1. O perfil novo terá o seu próprio documento em `spec/`
   (por exemplo, `CANONICALIZATION_PROFILE_V2.md`).
2. Os SDKs publicarão a sua matriz de suporte nos seus README.
3. O `canonicalization_profile` do manifesto do bundle passará a ser um campo
   obrigatório, e os verificadores roteiam para o canonicalizador adequado conforme
   o seu valor.

---

<a id="6-conformance-vectors"></a>

## 6. Vetores de conformidade

O arquivo compartilhado `tests/interop/v2/interop_vectors.json` contém um
bloco `canonicalization.edge_cases` que materializa o §3 como um conjunto de
fixtures de teste. Os quatro SDKs (TypeScript, Python, Rust, Go) devem (MUST) passar
neste bloco para afirmar que cumprem o perfil.

Os vetores são consumidos pelos testes de interoperabilidade de cada SDK:

- `sdks/typescript/src/__tests__/interop.test.ts`
- `sdks/python/tests/test_interop.py`
- `sdks/rust/tests/interop.rs`
- `sdks/go/dcp/interop_test.go`

A CI executa os quatro em paralelo em cada PR. Uma divergência entre SDKs
bloqueia uma versão.

---

<a id="7-references"></a>

## 7. Referências

- RFC 8785 — JSON Canonicalization Scheme (JCS) — especificação de base.
- RFC 8259 — JSON Data Interchange Format — gramática em nível de fio.
- `spec/DCP-AI-v2.0.md` § 15 — resumo em nível de protocolo.
- `schemas/v2/bundle_manifest.schema.json` — declaração do campo do manifesto.
- `tests/interop/v2/interop_vectors.json#canonicalization.edge_cases` — fixtures de teste.

<a id="implementation-notes-informative"></a>

## Notas de implementação (informativas)

> **Acrescentadas em 25/10/2026. Não normativas.** Estas notas não acrescentam nenhum requisito nem mudam nada do que está acima: descrevem como
> o código de referência em `main` se relaciona com este texto. Onde divergem, prevalece o texto normativo acima.

- `dcp-jcs-v1` continua congelado (§5) e continua sendo o único perfil de canonicalização normativo e o padrão. O
  identificador `dcp-jcs-v2` nomeia um candidato não normativo, descrito em
  [docs/proposals/canonicalization-candidate](../docs/proposals/canonicalization-candidate/README.md), com
  APIs experimentais de ativação explícita nos SDKs que nenhum caminho padrão chama. O schema do manifesto continua fixando
  `canonicalization_profile` em `dcp-jcs-v1`, e os verificadores V2 existentes rejeitam o identificador do candidato.
- A regra 4 é decidida sobre o valor analisado, então o que um produtor ou um verificador canonicaliza depende do seu parser JSON.
  Os parsers divergem em entradas que este perfil não fixa: nomes de membro repetidos, escapes de surrogates isolados, uma marca
  de ordem de bytes inicial e literais numéricos que um parser binary64 arredonda (por exemplo, `1.0000000000000001` é lido como `1`).
  Portanto, dois parsers podem canonicalizar o mesmo texto de forma diferente; a proposta do candidato registra esses casos.
- O exemplo da nota sob a regra 9 foi corrigido em 25/10/2026: `json.loads` não tem nenhum argumento `allow_nan` (ele aceita
  `NaN` por padrão); `allow_nan` pertence a `json.dumps`. Nenhuma regra mudou.
