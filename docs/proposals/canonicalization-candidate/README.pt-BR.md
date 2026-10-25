<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

<a id="canonicalization-candidate-dcp-jcs-v2"></a>

# Candidato de canonicalização `dcp-jcs-v2`

> Tradução informativa da [versão em inglês](README.md), atualizada em 25/10/2026. Proposta experimental e não normativa; em caso de divergência, prevalece a versão em inglês. Identificadores e blocos de código são mantidos sem tradução.

| | |
|---|---|
| **Data** | 25/10/2026 |
| **Versão** | 1.1 |
| **Classificação** | Pública |
| **Estado** | **Não normativo, experimental e inativo.** `dcp-jcs-v1` continua sendo o único perfil de canonicalização normativo e o padrão; as APIs candidatas dos SDKs (§15 a §18) são experimentais e de ativação explícita |
| **Corpus** | [`corpus.json`](corpus.json) (revisão `design-2`, 187 casos) e [`baseline-corpus.json`](baseline-corpus.json) (87 casos, mais 10 de seleção e 3 de política) |
| **Ferramenta de laboratório** | [`tools/canonicalization-lab/`](../../../tools/canonicalization-lab/): modelo de design, gerador de corpus e executor |

> **Aviso.** Este documento propõe um perfil candidato e registra o seu design. Ele não muda
> `dcp-jcs-v1` nem [`spec/CANONICALIZATION_PROFILE.md`](../../../spec/CANONICALIZATION_PROFILE.md), que
> continuam sendo a única referência normativa. Nenhum verificador, assinador, schema, verificação de conformidade ou padrão existente
> usa o identificador `dcp-jcs-v2`. As APIs experimentais e de ativação explícita de §15 a §18 o reconhecem
> sem ativá-lo: nenhum caminho existente ou padrão as chama, apenas quem as ativa explicitamente. As de §15
> e §16 não verificam nada; o verificador de §17 verifica bundles candidatos a partir dos seus bytes originais, e
> um bundle verificado não concede confiança nem admissão. Os produtores de §18 geram nova evidência candidata
> apenas para esses chamadores; os vetores da fase 3 são assinados por um gerador exclusivo de testes. Estas APIs não são
> publicadas como parte deste trabalho: os exemplos visam o checkout do código-fonte. O job de CI da ferramenta de laboratório executa
> o modelo de design, os jobs de teste dos SDKs executam essas APIs sobre o corpus e os vetores da fase 3, e a
> matriz da fase 4 tem o seu próprio workflow. Os
> verificadores V2 existentes, como o do SDK de TypeScript
> ([`verify-v2.ts`](../../../sdks/typescript/src/core/verify-v2.ts)), continuam rejeitando o perfil como
> desconhecido quando recebem um objeto analisado ou um texto, que é o comportamento pretendido. Nada disto é um requisito de conformidade. A ferramenta
> de laboratório é um modelo executável do design, não uma implementação: calcula SHA-256 para os seus
> compromissos sintéticos, mas não assina nada nem verifica nenhuma assinatura.

<a id="1-why-a-candidate"></a>

## 1. Por que um candidato

`dcp-jcs-v1` canonicaliza o valor que um parser JSON devolve. Nem todos os parsers JSON devolvem o mesmo
valor para o mesmo texto: a RFC 8259 deixa à implementação os nomes de membro duplicados (§4), os surrogates isolados em escapes (§8.2)
e uma marca de ordem de bytes inicial (§8.1), e um parser que lê números como binary64
pode transformar literais diferentes no mesmo valor. Dois leitores de um mesmo texto podem então calcular bytes
canônicos, hashes e entradas de assinatura diferentes, e um valor que o assinador nunca viu (um membro duplicado
anterior, por exemplo) pode viajar com evidência assinada.

O candidato mantém as regras de saída de `dcp-jcs-v1` e decide a aceitação sobre os bytes originais,
antes que qualquer parser repare, arredonde ou perca informação.

<a id="2-principles"></a>

## 2. Princípios

1. **Os mesmos bytes que `dcp-jcs-v1` para os mesmos valores.** O candidato não muda nenhuma regra de saída; ele apenas
   restringe quais entradas são aceitas. Para qualquer valor exato do seu domínio, os dois canonicalizadores produzem os
   mesmos bytes.
2. **A aceitação é decidida sobre os bytes originais.**
3. **O perfil é escolhido uma única vez, a partir do campo assinado do manifesto.** Um perfil desconhecido é rejeitado; nenhum
   outro perfil é tentado novamente após uma falha.
4. **Não é JCS.** As chaves são ordenadas por ponto de código Unicode, como em `dcp-jcs-v1`; a RFC 8785 §3.2.3 ordena por
   unidades de código UTF-16. O perfil não afirma compatibilidade com JCS.
5. **Sem rebaixamento silencioso.** Um verificador que não conhece o candidato o rejeita.

<a id="3-rules"></a>

## 3. Regras

<a id="31-ingress-bytes"></a>

### 3.1 Ingresso (bytes)

| Regra | Requisito | Classe |
|---|---|---|
| I1 | UTF-8 bem formado: sem bytes inválidos, sem formas longas demais, sem surrogates codificados (`ED A0 80`), nada acima de U+10FFFF | `UTF8_INVALID` |
| I2 | Sem U+FEFF inicial (`EF BB BF`) | `BOM` |
| I3 | Exatamente um texto JSON RFC 8259: apenas espaço, tabulação, LF e CR como espaço em branco, nada depois do valor, sem `NaN`, `Infinity`, `+1`, `01`, `1.` nem vírgulas finais | `SYNTAX` |
| I4 | No máximo 64 arrays e objetos aninhados, contados a partir da raiz da unidade validada (§5) | `DEPTH_EXCEEDED` |

<a id="32-strings-and-keys"></a>

### 3.2 Strings e chaves

- **S1. Valores escalares.** Toda string, chaves incluídas, é uma sequência de valores escalares Unicode. Um
  escape `\uD800`–`\uDBFF` deve ser seguido imediatamente por um escape `\uDC00`–`\uDFFF`, e o par
  representa um único valor escalar. Qualquer outro escape de surrogate é `SURROGATE_UNPAIRED`.
- **S2. Sem reparo.** U+FFFD é um caractere legítimo, escapado ou literal. O que se rejeita são dados que um
  parser *transformaria em* U+FFFD.
- **S3. Não caracteres são aceitos** (D2).
- **S4. Sem normalização.** Como na regra 9 de `dcp-jcs-v1`, `"é"` (U+00E9) e `"e\u0301"` são strings e chaves
  diferentes.
- **S5. Chaves únicas.** Dois membros de um mesmo objeto não podem ter a mesma chave depois de desfeitos os escapes
  (`DUPLICATE_KEY`), mesmo com valores iguais, em qualquer profundidade, sem casos especiais (`__proto__` é uma chave
  como qualquer outra).

<a id="33-numbers"></a>

### 3.3 Números

- **N1. Valor exato do literal.** A aceitação é decidida sobre o valor decimal exato do literal,
  não sobre a sua conversão em binary64. Um valor que não é inteiro é `NUMBER_NOT_INTEGER`; um inteiro
  fora de `[-(2^53-1), 2^53-1]` é `NUMBER_OUT_OF_RANGE`.
- **N2. Formas mantidas.** Um literal cujo valor decimal exato é um inteiro dentro do intervalo é aceito, qualquer que seja
  a sua forma: `1.0` é `1`, `1e2` e `1E+2` são `100`, `100e-2` é `1`, `1.5e1` é `15`, e `-0`, `-0.0`
  e `0e-400` são `0`. Não são todos os literais que `dcp-jcs-v1` aceita: um que um parser binary64
  arredonda para um inteiro, como `1.0000000000000001`, é rejeitado (N3).
- **N3. Rejeitados porque não são inteiros exatos dentro do intervalo:** `0.5`, `2^53`, `1e-400`,
  `0.99999999999999999`, `1.0000000000000001`, `4503599627370497.5`, `9007199254740993`, `1e21`.
- **N4. Algoritmo sem aritmética grande.** Para um literal `-?E(.F)?(e[+-]?X)?`:
  1. `D` = os dígitos de `E` e `F` sem zeros à esquerda, e `s = X − len(F)`. Um `D` vazio é `0`.
  2. Remova os zeros finais de `D` e some a quantidade deles a `s`.
  3. Se `s < 0`, o valor não é inteiro.
  4. Se `len(D) + s > 16`, o valor é pelo menos 10^16 e está fora do intervalo.
  5. Caso contrário, compare `D·10^s` com `2^53-1`.

  `X` é lido com saturação em `len(literal) + 17`; além desse limite o resultado não pode mudar. Um literal
  que é ao mesmo tempo fracionário e fora do intervalo é `NUMBER_NOT_INTEGER` (o passo 3 vem antes do passo 4).
- **N5. Inteiros grandes de aplicação** ficam em strings decimais, declaradas como tais no seu schema.
- **N6. O valor vem do literal.** Sob o candidato, o número que é canonicalizado é o
  que N4 calcula, nunca o que um parser binary64 devolve. O caminho de `dcp-jcs-v1` não muda.

<a id="34-output"></a>

### 3.4 Saída

As regras de saída de `dcp-jcs-v1` (regras 1–3 e 5–8): chaves ordenadas por ponto de código em todos os níveis; forma
compacta; os escapes da RFC 8785 §3.2 (`\b \t \n \f \r`, `\u00xx` em minúsculas para o resto de C0, `\"` e
`\\`) e todo o resto como UTF-8 literal, incluindo `/`, U+007F, U+2028 e U+2029; inteiros sem
fração nem expoente, `-0` como `0`; `null`, `true` e `false` literais; `{}` e `[]` mantidos.

<a id="4-design-decisions"></a>

## 4. Decisões de design

| # | Decisão | Justificativa | Compatibilidade |
|---|---|---|---|
| D1 | **Rejeitar um BOM inicial** na unidade (`BOM`, deslocamento 0). Um BOM antes de um envelope de transporte é um defeito do transporte | A RFC 8259 §8.1 permite que os receptores o ignorem, e os leitores divergem: alguns o removem, outros o rejeitam. Rejeitá-lo elimina a diferença. U+FEFF dentro de uma string é conteúdo | O caminho de `dcp-jcs-v1` não muda (§7) |
| D2 | **Aceitar não caracteres** (U+FFFE, U+FFFF e os demais) | São valores escalares com uma única codificação UTF-8 e uma única forma canônica. Rejeitá-los seria uma política de conteúdo, não uma regra de canonicalização | O perfil não é I-JSON (a RFC 7493 §2.1 os proíbe) nem afirma ser |
| D3 | **No máximo 64 níveis de aninhamento, contados a partir da raiz da unidade validada** (os bytes do bundle assinado), **nunca sobre um envelope de transporte** (§5) | A validade não deve depender de um transporte acrescentar um envelope. 64 fica abaixo do limite de recursão padrão do `serde_json` (128). Isso não é uma garantia sobre outros parsers, sobre números ou outros limites, nem sobre os orçamentos do operador, que podem ser menores | Afeta apenas as unidades que selecionam o candidato |
| D4 | **Valor exato do literal** (N1–N6) | O critério é um inteiro exato em `[-(2^53-1), 2^53-1]`. Todo o resto é rejeitado: literais que o binary64 representa exatamente mas que estão fora do domínio (`0.5`, `2^53`) e literais que o binary64 leria como outro valor (`1e-400` como 0). O custo é linear; o comprimento de um literal é um orçamento do transporte, não uma regra do perfil | Afeta apenas as unidades que selecionam o candidato |
| D5 | **Fora do escopo de ativação:** artefatos sem manifesto (revogações, rotações de chaves, mandatos) e A2A | O perfil é declarado no campo assinado do manifesto; esses artefatos não têm esse campo. Um design posterior pode dar a cada tipo o seu próprio campo assinado, e ao A2A um na transcrição do handshake | Continuam em `dcp-jcs-v1`. Um verificador pode aplicar-lhes o ingresso estrito por política, mas não pode afirmar que o produtor se comprometeu com o candidato |
| D6 | **O nome candidato `dcp-jcs-v2` está reservado.** Apenas os produtores experimentais e de ativação explícita de §18 o emitem, quando um chamador pede; nenhum caminho padrão e nenhum pacote publicado o faz. Continua sendo um nome candidato até que um documento normativo seja aprovado. (Revisado na fase 4: antes de §18 não havia nenhum produtor de SDK de ativação explícita; os vetores da fase 3 vinham de um gerador exclusivo de testes.) | Um sufixo de rascunho no fio seria mais um identificador a manter. Os verificadores só o habilitam por meio de uma política explícita (§7) | A evidência emitida sob o candidato é experimental. Se as regras mudassem após uma publicação externa, seria necessário um novo identificador (`dcp-jcs-v1` §5) |
| D7 | **Avisos opcionais de `dcp-jcs-v1`.** Com os bytes disponíveis, um verificador pode acrescentar a um resultado de `dcp-jcs-v1` um aviso com a classe e o deslocamento do defeito principal (§6) | Permite encontrar produtores a corrigir antes de migrar | Nunca muda um veredito de `dcp-jcs-v1`. Uma API baseada em objetos não pode emiti-lo |

<a id="5-the-validated-unit-and-the-transport"></a>

## 5. A unidade validada e o transporte

**A unidade** são os bytes exatos do valor do bundle assinado (`{"bundle": …, "signature": …}`). A sua raiz é a
profundidade 1; uma carga útil começa na profundidade 4 (raiz, `bundle`, artefato, `payload`), então o seu próprio aninhamento pode chegar a
61 níveis. Os deslocamentos são relativos ao primeiro byte da unidade.

**Os transportes** são definidos pela configuração do endpoint, nunca inferidos do conteúdo:

| Transporte | Unidade |
|---|---|
| `bare` | Toda a entrada: um corpo HTTP, um arquivo ou o valor de um cabeçalho após a sua própria decodificação |
| `envelope` | O valor do único membro `signed_bundle` de um objeto de nível superior |

**Extração sem reserializar.** O envelope é percorrido com uma gramática em nível de bytes que delimita
as strings sem decodificá-las. O nome do membro é comparado depois de desfeitos os escapes, então `"signed\u005fbundle"`
nomeia a unidade. A unidade é o trecho `[start, end)` do valor, passado sem alterações: os seus duplicados,
literais numéricos e escapes chegam intactos ao scanner. Os demais membros do envelope não são interpretados;
os orçamentos de tamanho e profundidade do transporte são separados.

**Limite.** Dentro de um envelope, uma unidade cuja gramática está quebrada não pode ser delimitada e é
`TRANSPORT_INVALID`; a mesma unidade enviada sem envelope é `SYNTAX`. Ambas são rejeitadas. Para defeitos dentro de strings,
duplicados, números e profundidade, o envelope não muda nem a classe nem o deslocamento relativo à unidade.

**Um contrato novo, de ativação explícita.** A extração em nível de bytes rejeita envelopes que a análise atual baseada em objetos
aceita (um membro `signed_bundle` repetido, um BOM antes do envelope). Ela pertence a uma nova API de bytes ou
a uma opção explícita, com a sua própria nota de compatibilidade, e não pode ser instalada silenciosamente sobre o
caminho de `dcp-jcs-v1`.

**Por que não contar o envelope.** Contar a profundidade sobre o documento de transporte faz a validade depender do
transporte: o mesmo bundle de 64 níveis seria válido sem envelope e inválido dentro de `{"signed_bundle": …}`, e um
proxy que reembala um corpo mudaria o veredito. A ferramenta de laboratório pode avaliar essa regra para comparação
(`depth_scope: "transport"`, casos `d-unit-64-envelope-v03-rule` e
`b-v2-unit-depth-64-envelope-v03-rule`).

<a id="6-precedence"></a>

## 6. Precedência

<a id="61-the-scanners-diagnosis-by-layers"></a>

### 6.1 O diagnóstico do scanner, por camadas

Dentro do diagnóstico do scanner da unidade, uma camada anterior sempre vence, quaisquer que sejam os deslocamentos. As camadas
escolhem **qual violação é a principal**; se ela rejeita ou não é decidido pelo pipeline (§6.4).

| Camada | Classes | Deslocamento | Dentro da camada |
|---|---|---|---|
| 1. Codificação | `BOM`, `UTF8_INVALID` | `BOM`: 0. `UTF8_INVALID`: primeiro byte da primeira subsequência malformada | O BOM está no deslocamento 0 e vence |
| 2. Gramática | `SYNTAX` | O primeiro byte que não pode estender um prefixo de nenhum texto JSON; o comprimento da entrada se ela termina antes do tempo | Apenas um: o primeiro |
| 3. Valores | `SURROGATE_UNPAIRED`, `DUPLICATE_KEY`, `NUMBER_NOT_INTEGER`, `NUMBER_OUT_OF_RANGE`, `DEPTH_EXCEEDED` | §6.2 | **O deslocamento mais cedo** |

<a id="62-offsets-of-the-value-layer"></a>

### 6.2 Deslocamentos da camada de valores

| Classe | Deslocamento |
|---|---|
| `SURROGATE_UNPAIRED` | A barra invertida do escape que não faz parte de um par |
| `DUPLICATE_KEY` | A aspa de abertura da **segunda** ocorrência da chave |
| `NUMBER_NOT_INTEGER`, `NUMBER_OUT_OF_RANGE` | O primeiro byte do literal |
| `DEPTH_EXCEEDED` | O colchete ou a chave que abre o nível 65 |

Um defeito em uma chave precede um defeito no seu valor, porque a chave vem primeiro nos bytes. As chaves são
comparadas depois de desfeitos os escapes, como sequências de unidades: um par válido é um valor escalar e um surrogate isolado
continua sendo uma unidade. Em uma única passada, duas violações nunca compartilham um deslocamento; por completude, deslocamentos iguais
seguiriam a ordem da tabela. Além do nível 64 o scanner continua verificando a gramática até o fim
da unidade; um defeito da camada de valores ali já não pode vencer, porque o seu deslocamento vem depois do colchete
que abriu o nível 65. O scanner é iterativo: vinte mil níveis dão `DEPTH_EXCEEDED` sem um
limite de recursão.

<a id="63-transport-phases"></a>

### 6.3 Fases do transporte

Em um envelope decide a fase, não o deslocamento:

| Fase | Verifica | Classe / detalhe | Deslocamento (a partir do início da entrada) |
|---|---|---|---|
| T1 | BOM antes do envelope | `TRANSPORT_INVALID` / `BOM` | 0 |
| T2 | Gramática em nível de bytes de **todo** o envelope, unidade incluída | `TRANSPORT_INVALID` / `SYNTAX` | Como na camada 2 |
| T3 | A raiz é um objeto | `TRANSPORT_INVALID` / `NOT_AN_OBJECT` | O da raiz |
| T4 | Exatamente um membro `signed_bundle` | `TRANSPORT_INVALID` / `NO_SIGNED_BUNDLE`, ou `TRANSPORT_AMBIGUOUS` / `SIGNED_BUNDLE_REPEATED` | Nenhum, ou o nome do segundo membro |
| T5 | UTF-8 bem formado **fora** da unidade, primeiro antes dela, depois após ela | `TRANSPORT_INVALID` / `UTF8_INVALID` | Primeiro byte da subsequência malformada |

A codificação do envelope só pode ser julgada fora da unidade, que só existe depois de T2–T4; a unidade é
escaneada depois das cinco fases. Por exemplo, `{"bad":"<FF>","signed_bundle":{},"signed_bundle":{}}` é
`TRANSPORT_AMBIGUOUS` no deslocamento 30, embora o UTF-8 inválido esteja no deslocamento 8.

<a id="64-the-complete-pipeline"></a>

### 6.4 O pipeline completo

1. **Configuração** (apenas bundles): `POLICY_INVALID`, antes de a entrada ser lida.
2. **Transporte** (apenas com envelope): fases T1–T5.
3. **Scanner da unidade:** o diagnóstico principal, ou nenhum.
4. **Documento:** um diagnóstico rejeita com a sua classe; caso contrário, os bytes canônicos são produzidos.
5. **Bundle que o scanner consegue percorrer** (sem diagnóstico de codificação nem de gramática):
   1. uma leitura `unknown` é `PROFILE_UNKNOWN`, **mesmo com um diagnóstico da camada de valores**;
   2. um perfil fora da política é `PROFILE_NOT_ACCEPTED`, também com um diagnóstico;
   3. `absent` ou `dcp-jcs-v1` é **delegado ao caminho de `dcp-jcs-v1`**, e o diagnóstico é apenas um aviso (D7);
   4. `dcp-jcs-v2` com um diagnóstico é rejeitado com a sua classe;
   5. `dcp-jcs-v2` sem diagnóstico passa pelas verificações do bundle sintético, nesta ordem: a sua
      estrutura, `payload_hash`, `intent_hash`, `audit_chain`, `manifest_hash`. A primeira falha é
      `COMMITMENT_MISMATCH` com esse detalhe; caso contrário, o bundle é aceito.
6. **Bundle que o scanner não consegue percorrer** (um diagnóstico de codificação ou de gramática):
   - se o parser atual falha, ou lê `dcp-jcs-v2` ou outro valor, a classe do diagnóstico;
   - se ele lê `absent` ou `dcp-jcs-v1`, a política (sem `dcp-jcs-v1`, `PROFILE_NOT_ACCEPTED`) e depois a delegação com um aviso.

<a id="7-profile-selection-and-policy"></a>

## 7. Seleção do perfil e política

**Leitura.**

- **Caminho exato.** Apenas `bundle.manifest.canonicalization_profile`, a partir da raiz da unidade, seleciona. O mesmo
  campo em outro lugar são dados: na raiz, em `bundle`, em `signature`, em uma carga útil ou em um manifesto que é
  um array.
- **Duplicados.** Quando uma chave do caminho se repete (`bundle`, `manifest`, o campo), o **último** valor é
  lido, como os parsers JSON comuns o mantêm.
- **Comparação depois de desfeitos os escapes.** `"dcp-jcs-v\u0032"` e `"canonicalization\u005fprofile"` contam.
- **Resultado:** `absent`, `dcp-jcs-v1`, `dcp-jcs-v2` ou `unknown` (qualquer outra string, variante de maiúsculas ou
  espaços, `""`, `null`, um número, um array, um objeto ou uma string com um surrogate isolado).

**Apenas para uma unidade que o scanner não consegue percorrer** o parser atual é consultado, e apenas para decidir se o
caminho de `dcp-jcs-v1` prossegue. Um reparo do parser nunca admite o candidato, e as classes de rejeição são as
mesmas em todos os lugares.

**Delegação.** `v1_path` entrega a unidade, sem alterações, ao verificador atual de `dcp-jcs-v1`. Para uma unidade que o
scanner consegue percorrer, o scanner lê o campo como o faz um parser que mantém o último duplicado; para uma que ele
não consegue percorrer, decide o parser atual. Que os vereditos de `dcp-jcs-v1` sejam preservados é um **argumento de design**,
baseado em como os parsers leem o caminho; o modelo de design do laboratório não o mede. O que as fases dos SDKs mediram
está em §16 a §18 (por exemplo, as leituras de decodificadores de §16 e a matriz de §18.1).

**Política.** `accepted_canonicalization_profiles` é uma lista não vazia de identificadores conhecidos sem
repetições. Qualquer outra coisa (uma lista vazia, uma string solta, `null`, entradas que não são strings como `[[]]`, `[{}]`
ou `[1]`, repetições, identificadores desconhecidos) é `POLICY_INVALID`, um erro de configuração, não uma rejeição dos
dados. Uma política apenas restringe; nunca seleciona, e a sua ordem não importa. A ferramenta de laboratório não tem
política padrão: cada caso declara a sua, e o candidato só é habilitado explicitamente
(`["dcp-jcs-v1", "dcp-jcs-v2"]`). Um futuro padrão de produção seria `["dcp-jcs-v1"]`.

**Sem nova tentativa.** Um perfil, um caminho. Uma falha do caminho do candidato é definitiva: nada é
canonicalizado novamente com `dcp-jcs-v1`, e o perfil nunca é inferido do conteúdo, dos cabeçalhos ou dos parâmetros.

<a id="8-signed-profile-inner-signatures-audit-chain-and-migration"></a>

## 8. Perfil assinado, assinaturas internas, cadeia de auditoria e migração

- **O campo é assinado.** Ele faz parte do manifesto, que a assinatura do bundle cobre. Sob o
  candidato não há duplicados, então o compromisso não é ambíguo. Sob `dcp-jcs-v1` apenas o último
  dos campos repetidos entra nos bytes canônicos assinados, então um campo repetido colocado antes do assinado
  não quebra a assinatura; o candidato elimina isso, e D7 pode sinalizá-lo.
- **As assinaturas internas não trazem perfil.** Dentro do domínio, os bytes dos artefatos são os mesmos sob os dois
  perfis, então o compromisso com o candidato vem apenas do manifesto: uma assinatura interna por si só
  não diz qual perfil a produziu. Os artefatos fora de um bundle continuam em `dcp-jcs-v1` (D5).
- **A cadeia de auditoria começa em `GENESIS`.** O verificador atual exige `prev_hash == "GENESIS"` na
  primeira entrada ([`verify-v2.ts`](../../../sdks/typescript/src/core/verify-v2.ts)). Um hash de `dcp-jcs-v1`
  copiado como primeiro `prev_hash` de um bundle candidato não é um elo verificável entre perfis:
  ele quebra a cadeia (caso `mig-copied-v1-hash`). A evidência candidata começa a sua própria cadeia; uma referência a
  evidência anterior dentro de uma carga útil a identifica, mas não a verifica (`mig-reference-is-data`).
  A continuidade de uma cadeia entre perfis precisa de um mecanismo que não é projetado aqui.
- **Rerrotulagens.** `dcp-jcs-v1` rerrotulado como o candidato falha no hash do manifesto e não é tentado novamente com
  `dcp-jcs-v1` (`mig-relabel-v1-to-v2`). O candidato rerrotulado como `dcp-jcs-v1`, ou com o campo
  removido, é delegado a `dcp-jcs-v1`, cujo verificador então resume por hash um manifesto que o produtor não assinou;
  a ferramenta de laboratório não calcula esse veredito. Um literal fora do domínio em um bundle candidato é
  rejeitado no ingresso, mesmo que um leitor binary64 visse um valor coincidente: não há alternativa.
- **Nada é rerrotulado nem assinado novamente de forma automática.** A evidência sob o candidato é evidência nova com
  assinaturas novas; o que deve ser arquivado são os bytes recebidos, não objetos reserializados.

<a id="9-phases-and-acceptance-gates"></a>

## 9. Fases e portões de aceitação

Nada aqui é ativado. Apenas o ingresso experimental de unidades (§15), o roteador (§16), o verificador de bytes (§17) e os produtores (§18) estão implementados. Passar a uma fase posterior exige uma decisão explícita, tomada
à parte deste documento, e uma mudança de padrão exige a sua própria decisão.

**Fases.**

1. Proposta, corpus e modelo de design (este documento).
2. Verificadores capazes de verificar o candidato atrás de uma opção explícita, com os produtores ainda em
   `dcp-jcs-v1`.
3. Produtores com uma opção explícita, quando a matriz cruzada de assinatura abaixo passar.
4. Uma mudança de padrão, em um ciclo posterior, com notas de descontinuação.

A verificação de `dcp-jcs-v1` permanece para a evidência histórica o tempo todo: introduzir o candidato não
faz nenhuma evidência de `dcp-jcs-v1` deixar de ser verificada nem passar a ser verificada. As correções de segurança de `dcp-jcs-v1` são
avaliadas por si mesmas.

**Portões antes da fase 2 ou 3** (requisitos; o seu estado está no registro de §18.4):

1. **Paridade do corpus.** Os casos que fixam o ingresso são os 87 casos brutos de referência e os casos de design
   aplicáveis. Sobre eles, todos os SDKs e o WASM, por meio de uma API de bytes, dão o mesmo `canonical_sha256` nos casos de
   aceitação e a mesma classe, com a precedência e os deslocamentos de §6, nos casos de rejeição. Os casos que
   avaliam a regra de profundidade obsoleta da v0.3 (`depth_scope: "transport"`) demonstram o modelo e não são
   requisitos de aceitação. Os casos de bundles sintéticos devem se tornar bundles assinados reais com expectativas
   explícitas, e o seu parâmetro `historical` deve ser substituído por uma observação real do parser de cada SDK;
   ele nunca é evidência.
2. **Escopo da API de objetos.** Uma API que recebe objetos analisados rejeita os casos de rejeição marcados
   `needs_original_bytes: false`, e documenta os casos de rejeição marcados `true` como fora do seu alcance.
3. **Equivalência de saída sobre valores.** Para cada valor exato do domínio, construído diretamente ou por meio do
   ingresso do candidato (nunca por meio de um parser de `dcp-jcs-v1` a partir de um literal), os dois canonicalizadores dão os
   mesmos bytes em todos os SDKs.
4. **Paridade do ingresso a partir de bytes.** Todos os SDKs materializam o mesmo valor e os mesmos bytes a partir dos casos de aceitação.
5. **As leituras históricas continuam sendo diagnósticos.** Um parser histórico que lê um literal de forma diferente do
   seu valor exato é uma questão de `dcp-jcs-v1` com a sua própria análise de compatibilidade, não um portão.
6. **Matriz cruzada de assinatura.** Cada produtor assina bundles candidatos com cargas úteis de fronteira (`±(2^53-1)`,
   chaves com U+E000 e U+1F600, U+FEFF no início de uma string, U+FFFD, U+2028, `\u0000`, uma unidade aninhada
   até a profundidade 64), e todos os verificadores os aceitam; a matriz de interoperabilidade existente de `dcp-jcs-v1` continua verde.
7. **Matriz negativa.** Um defeito de cada classe, injetado em nível de bytes em um bundle candidato válido, é
   rejeitado com essa classe antes de as assinaturas serem verificadas; o mesmo defeito em um bundle de `dcp-jcs-v1`
   mantém o veredito atual.
8. **Seleção, precedência e política.** Os testes de §6 e §7 rodam em todos os SDKs, com uma verificação
   instrumentada de que cada verificação usa um perfil e um caminho.
9. **Histórico.** Com o novo ingresso instalado, o caminho de `dcp-jcs-v1` dá em cada SDK o veredito atual sobre
   os vetores e as suítes de conformidade existentes.
10. **Custo.** Medido antes e depois, sem relaxar nada para compensar.

<a id="10-corpus-and-lab-tool"></a>

## 10. Corpus e ferramenta de laboratório

| Arquivo | Conteúdo |
|---|---|
| [`baseline-corpus.json`](baseline-corpus.json) | 87 casos de um único defeito (42 de aceitação, 45 de rejeição, 6 deles com bytes que não são UTF-8), 10 casos de seleção de perfil e 3 de política. Uma cópia da revisão 2 aprovada: apenas `proposal` e um campo `provenance` diferem. O seu `domain.max_depth_scope` mantém a redação histórica (profundidade sobre toda a entrada, envelope incluído); I4 a substitui (profundidade a partir da raiz da unidade), como o `corpus.json` registra em `scope_revisions`. Nenhum caso muda: todo caso de referência é uma unidade sem envelope |
| [`corpus.json`](corpus.json) | 187 casos de design: permutações com vários defeitos (54), números exatos (20), profundidade com e sem envelope (12), transporte (19) e fases do transporte (12), seleção (23), ingresso (3), parsers históricos (8), política (5), configuração (9), migração (9), e os 10 + 3 casos de seleção e política de referência sobre bundles sintéticos. Ele faz referência aos 87 casos de referência por ID e hash de entrada |
| [`tools/canonicalization-lab/model.py`](../../../tools/canonicalization-lab/model.py) | O modelo de design: extração do transporte, um scanner iterativo de bytes com a precedência de §6, N4, as regras de saída, a seleção e a política, e um caminho de bundles sintéticos cujas verificações de hash substituem os hashes das cargas úteis, a cadeia de auditoria e a assinatura do manifesto. O seu comportamento executável é o do modelo aprovado (SHA-256 do arquivo aprovado `ab172c5f…`); as suas docstrings esclarecem os caminhos públicos e a regra assumida do último duplicado. Ele calcula SHA-256 para os compromissos sintéticos e não assina nem verifica nada |
| [`tools/canonicalization-lab/generate_corpus.py`](../../../tools/canonicalization-lab/generate_corpus.py) | Escreve o `corpus.json`. As expectativas são escritas à mão com a regra que cada uma aplica (`why`); ele nunca importa o modelo |
| [`tools/canonicalization-lab/run.py`](../../../tools/canonicalization-lab/run.py) | Verifica integridade, atualidade, validade e cobertura, executa o modelo sobre os 274 casos e executa 24 controles negativos |

**Os casos de bundles** usam um schema sintético mínimo (manifesto, `intent`, `audit_entries` e
`signature.manifest_hash`), cujo `manifest_hash` substitui a assinatura composta. Para as unidades que o
scanner não consegue percorrer, o que o parser atual de um SDK faz é um parâmetro de cada caso (`historical`), não uma
medição.

**O executor verifica** o hash de referência e as suas 87 referências de casos, o hash de entrada de cada caso, que
o corpus se regenera byte a byte, estados e classes válidos, IDs únicos (também em relação à referência),
a ausência de entradas repetidas não declaradas, a cobertura dos 20 pares ordenados da camada de valores, de cada classe e grupo, e
de cada caso de seleção e política de referência. Todo resultado real é validado (estado, classe, formato e
modo) na execução do corpus e em cada controle; uma falha do modelo é informada como `MODEL_ERROR`, nunca como uma
rejeição.

**Controles negativos** (todos devem ser detectados): três expectativas alteradas; 14 corrupções de dados, cada uma detectada
pela sua própria regra; um corpus desatualizado; um modelo que falha em todos os casos; quatro mutantes de design (ordem de classes
em vez de deslocamento, camada de valores antes da gramática, alternativa para `dcp-jcs-v1`, profundidade sobre o envelope), cada um
quebrando exatamente os seus próprios casos; duas falhas injetadas apenas sob mutação e um mutante que quebra
exatamente os casos esperados com uma classe desconhecida, os três devendo invalidar a campanha em vez
de contar como detectados.

<a id="11-reproduce"></a>

## 11. Reproduzir

Python 3.9 ou posterior no Linux ou macOS (o executor usa `signal.SIGALRM` e `pathlib.Path.is_relative_to`;
o Windows não é suportado), apenas com a biblioteca padrão. Os comandos rodam a partir da raiz de um checkout; de
qualquer outro diretório, dê aos scripts os seus caminhos absolutos. As saídas vão para um diretório temporário novo, então
nada é sobrescrito: o executor também recusa um caminho de saída existente, e o gerador escreve
onde lhe for indicado.

```bash
out=$(mktemp -d)
python3 -I tools/canonicalization-lab/generate_corpus.py "$out/corpus.json"
cmp "$out/corpus.json" docs/proposals/canonicalization-candidate/corpus.json
python3 tools/canonicalization-lab/run.py --out "$out/run.json"
python3 tools/canonicalization-lab/run.py --controls --out "$out/controls.json"
```

Esperado: `274/274 cases as expected (87 r2 + 187 design)`, cada controle `CAUGHT` e código de saída 0.
O código de saída 1 significa que um caso, um resultado ou um controle difere; 2, que os dados são inválidos.

<a id="12-what-this-shows-and-what-it-does-not"></a>

## 12. O que isto mostra e o que não mostra

| Mostrado pelo modelo de design | Não feito |
|---|---|
| A precedência total, com deslocamentos, sobre 54 documentos com vários defeitos e 12 envelopes com vários defeitos | Uma mudança de fase ou de padrão: os produtores de §18 são experimentais e de ativação explícita |
| A unidade, o transporte e a independência do envelope | Uma API de bytes nas integrações ou no servidor |
| A seleção, a política e a ausência de novas tentativas, sobre bundles sintéticos | Uma prova de equivalência de saída sobre todo o domínio (§18.4, portão 3, é mostrado sobre amostras) |
| Que o caminho do candidato não depende de reparos do parser | Leituras históricas além das unidades medidas: `tests/interop/candidate/phase2-adapter-expectations.json` registra 160 leituras de decodificadores reais (16 unidades × 10 adaptadores) onde decide o adaptador histórico; isso é evidência apenas para essas unidades |
| As verificações de hash do bundle sintético | Uma matriz negativa por classe de bundles de `dcp-jcs-v1` (§18.4, portão 7) |
| | Que a delegação preserve o veredito de `dcp-jcs-v1` de cada SDK além dos casos de §16 e §17 |

<a id="13-open-questions"></a>

## 13. Questões em aberto

- A preservação dos vereditos de `dcp-jcs-v1` depende de os parsers históricos lerem o caminho do perfil com
  a regra do último duplicado; isso deve ser medido em cada caminho de entrada real do verificador antes da implementação.
  Um decodificador de construção tipado não é necessariamente o decodificador usado por um verificador. Para as APIs de objetos,
  o decodificador de bytes para objeto de quem chama ou da integração faz parte desse caminho: ele pode descartar um BOM,
  reparar UTF-8 inválido, perder membros duplicados ou rejeitar o corpo antes da verificação. Um adaptador deve preservar esse
  caminho existente de forma explícita; substituí-lo por um decodificador comum não estabelece a paridade histórica.
- O contrato de transporte em nível de bytes muda o resultado para envelopes ambíguos e precisa da sua própria
  nota de compatibilidade.
- A continuidade da cadeia de auditoria entre perfis, o perfil dos artefatos sem manifesto e o A2A ficam
  fora deste design.

<a id="14-references"></a>

## 14. Referências

- [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259) §4 (nomes únicos), §6 (intervalo numérico interoperável), §8.1 (BOM), §8.2 (surrogates isolados).
- [RFC 7493](https://www.rfc-editor.org/rfc/rfc7493) (I-JSON) §2.1–§2.3.
- [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) §3.1, §3.2.2 e §3.2.3 (ordem de chaves por UTF-16, que este perfil não usa).
- [`spec/CANONICALIZATION_PROFILE.md`](../../../spec/CANONICALIZATION_PROFILE.md) (`dcp-jcs-v1`, sem alterações).

<a id="15-experimental-sdk-ingress-phase-1"></a>

## 15. Ingresso experimental nos SDKs (fase 1)

A fase 1 do plano de implementação nos SDKs (não uma fase de §9) adiciona a cada SDK um ingresso experimental e de ativação explícita de uma
unidade. Ele não é normativo, e nenhum caminho existente ou padrão o chama: apenas quem o ativa explicitamente.
Ele não muda nenhuma função, padrão, assinador nem verificador de `dcp-jcs-v1`. O ingresso em si não lê o
perfil (o roteador de §16 o faz) e não emite nada; os produtores chegaram na fase 4 (§18).

| SDK | API |
|---|---|
| TypeScript | `experimentalCandidateIngress(bytes: Uint8Array)`, exportada por `@dcp-ai/sdk` |
| Python | `dcp_ai.v2.experimental_candidate_ingress.experimental_candidate_ingress(data)`, não reexportada por `dcp_ai.v2` |
| Go | `v2.ExperimentalCandidateIngress(input []byte)` |
| Rust | `dcp_ai::v2::experimental_candidate_ingress::experimental_candidate_ingress(&[u8])` |
| WASM | `wasm_experimental_candidate_ingress` nos bindings de Rust, e `DcpWasm.experimentalCandidateIngress(bytes)` em `@dcp-ai/wasm` |

**O que ele faz.** Recebe os bytes originais de uma unidade e aplica §3.1–§3.3, com a precedência
e os deslocamentos de §6.1–§6.2. Ao aceitar, devolve o valor exato, os seus bytes canônicos (§3.4) e o seu
SHA-256; o wrapper de WASM devolve os bytes e o hash, não o valor. Uma rejeição é um resultado, com
a sua classe e o seu deslocamento em bytes. Um tipo de argumento errado e um erro interno são informados à parte, nunca como uma
rejeição.

**O que ele não faz:**

- extrair uma unidade de um transporte (§5, §6.3);
- selecionar um perfil nem aplicar uma política (§6.4 passos 1, 5 e 6; §7);
- delegar para `dcp-jcs-v1`;
- verificar, assinar nem admitir nada.

**Testes.** Cada um dos quatro SDKs (TypeScript, Python, Go e Rust) executa estes casos contra as
expectativas armazenadas (a classe e o deslocamento, ou o hash canônico):

- as 87 unidades de referência;
- os 81 casos de documentos sem envelope de `corpus.json`.

Cada um dos quatro também verifica que o seu canonicalizador de `dcp-jcs-v1` dá os mesmos bytes sobre cada
valor aceito, e acrescenta exemplos específicos: UTF-8 inválido, BOM, duplicados por meio de escapes,
`__proto__`, literais numéricos longos e saturados, pares de surrogates, e 20 000 níveis com e sem um
erro de gramática tardio.

O teste de WASM executa o binding real de Rust por meio do wrapper `@dcp-ai/wasm` sobre os mesmos 168 casos,
comparando classe e deslocamento ou bytes canônicos e hash; ele não obtém nenhum valor, então não faz nenhuma comparação com
`dcp-jcs-v1`. Ele também verifica a fronteira JS/WASM:

- os bytes chegam ao Rust sem alterações (um byte inválido, um BOM, um escape NUL, uma visão de um buffer maior);
- uma unidade de 20 000 níveis retorna;
- um argumento que não é um `Uint8Array` é um `TypeError`.

Em todos os SDKs, os 77 casos de bundles e os 29 casos de envelopes, entre eles a regra de profundidade obsoleta, pertencem
a fases posteriores: são contados, não executados.

**Portões.** Isto é evidência para os portões 1, 3 e 4 de §9 apenas para os casos de unidades. Nenhum dos dez portões é
cumprido por ele, e o candidato continua inativo.

<a id="16-experimental-sdk-router-phase-2"></a>

## 16. Roteador experimental nos SDKs (fase 2)

A fase 2 do plano de implementação nos SDKs adiciona a cada SDK um roteador experimental e de ativação explícita. Ele extrai a unidade
(§5, §6.3), lê o perfil (§7) e aplica §6.4 até a decisão: rejeitar, delegar para `dcp-jcs-v1` ou
selecionar o caminho do candidato. Ele não é normativo, e nenhum caminho existente ou padrão o chama: apenas quem
o ativa explicitamente. `dcp-jcs-v1`, os seus verificadores e todos os padrões não mudam. `candidate` nunca é uma aceitação: a fase 3 o verificaria. Nada verifica nem assina
um candidato.

| SDK | API |
|---|---|
| TypeScript | `createExperimentalCandidateRouter(config).route(bytes)`, `experimentalCandidateExtractUnit`, `experimentalHistoricalAdapters` |
| Python | `dcp_ai.v2.experimental_candidate_router`: `create_router`, `extract_unit`, `JSON_LOADS_BYTES`, `JSON_LOADS_STRICT_DECODE` |
| Go | `NewExperimentalCandidateRouter(cfg)` e `Route`, `ExperimentalCandidateExtractUnit`, `ExperimentalHistoricalEncodingJSON` |
| Rust | `v2::experimental_candidate_router`: `CandidateRouter::new` e `route`, `extract_unit`, `HistoricalAdapter::serde_json_from_slice` |
| WASM | `DcpWasm.createExperimentalCandidateRouter` sobre os bindings `wasm_experimental_candidate_route` e `_resume`, e `experimentalWasmHistoricalAdapters` |

**Configuração.** O transporte (`bare` ou `envelope`), os perfis aceitos e o adaptador histórico
são obrigatórios; nenhum tem padrão.

- Eles são validados com tipos estritos quando o roteador é criado, antes de qualquer entrada.
- Uma configuração inválida é um erro de configuração (`POLICY_INVALID` ou `CONFIG_INVALID`), nunca uma
  rejeição dos dados.
- O roteador guarda um snapshot privado, então mudanças posteriores nos objetos de quem chama não mudam nada.

**Resultados.**

- **`reject`:** a classe (uma classe de transporte, uma classe do scanner, `PROFILE_UNKNOWN` ou `PROFILE_NOT_ACCEPTED`)
  e os seus deslocamentos. `offset` é relativo à unidade; `transport_offset` está na entrada.
- **`v1_path`:** a unidade, o aviso (D7) e o que o adaptador histórico devolveu.
  - O seu perfil é sempre `dcp-jcs-v1`: um manifesto sem o campo foi produzido sob `dcp-jcs-v1`.
  - `profile_source` diz por quê: `field`, `absent`, ou `historical` para uma unidade que o scanner não consegue percorrer.
- **`candidate`:** a unidade, o seu valor e os seus bytes canônicos. O wrapper de WASM devolve os bytes canônicos
  e o seu hash, mas não o valor, como na fase 1.

Os nomes são equivalentes entre os SDKs no estilo de cada linguagem: `profileSource`, `transportOffset` e
`canonicalSha256` em TypeScript e no wrapper de WASM; `profile_source`, `transport_offset` e
`canonical_sha256` em Python, Rust e nos bindings de WASM; `ProfileSource`, `TransportOffset` e
`CanonicalSHA256` em Go.

**Adaptadores históricos.** Um adaptador reproduz um decodificador real, e o roteador o consulta no máximo uma vez, apenas
onde §6.4 precisa dele:

- para decidir sobre uma unidade que o scanner não consegue percorrer;
- para produzir o valor de uma delegação.

A sua leitura nunca seleciona o candidato, e o seu resultado é o que o decodificador real devolveu, sem saneamento pelas
regras do candidato: NaN, infinitos e surrogates isolados são mantidos apenas onde esse decodificador os mantém.
`json.loads` aceita NaN e 1e999, `JSON.parse` dá Infinity para 1e999, e ambos mantêm surrogates isolados.
`encoding/json` e `serde_json` recusam 1e999. No caminho `w1` do WASM, `JSON.stringify` transforma Infinity em
`null` e escapa de novo os surrogates isolados, que o `serde_json` então recusa. Um adaptador que falha de outra forma
que não recusando os dados é um erro do adaptador, não uma rejeição.

O wrapper de WASM reproduz dois caminhos distintos, medidos separadamente e não assumidos como equivalentes:

- **`w1`:** um objeto, por meio de `JSON.stringify`, para o Rust;
- **`w2`:** um texto para o binding.

Os seus bindings não têm estado. `resume` recalcula o ponto de decisão a partir dos seus próprios argumentos e só pode terminar
em uma rejeição ou em uma delegação.

**Testes.** Cada SDK e o WASM executam estes casos:

- os 9 casos de configuração;
- os 28 casos de envelopes de documentos;
- os 58 casos de bundles percorríveis, onde `accept_v2` e `COMMITMENT_MISMATCH` são verificados apenas como `candidate`;
- o fixture público `tests/interop/candidate/phase2-adapter-expectations.json`. Para as 9 unidades que o scanner
  não consegue percorrer e 7 unidades sintéticas, ele registra o que cada decodificador real devolve, medido executando-o; o
  parâmetro `historical` do corpus não é usado como evidência.

Eles também verificam:

- uma paridade v1 sem diferenças: sem envelope, `["dcp-jcs-v1"]`, cada adaptador embutido, sobre os bundles
  assinados públicos e variantes geradas a partir deles;
- o percorredor da gramática em relação ao scanner da fase 1;
- a preguiça, o contrato do adaptador e a posse dos bytes.

**Portões.** Isto é evidência para os portões 1, 8 e 9 de §9, apenas para a seleção e a delegação. Nenhum dos dez
portões é cumprido por ele, e o candidato continua inativo.

<a id="17-experimental-sdk-verifier-phase-3"></a>

## 17. Verificador experimental nos SDKs (fase 3)

A fase 3 do plano de implementação nos SDKs adiciona a cada SDK um verificador experimental e de ativação explícita de bytes originais.
Ele roteia os bytes uma vez com o roteador de §16 e executa no máximo um verificador:

- nenhum para uma rejeição;
- para `v1_path`, o verificador V2 atual, sobre exatamente o que um chamador atual lhe entregaria;
- para `candidate`, o verificador V2 atual, aceitando exatamente `dcp-jcs-v2` no manifesto.

Não há uma segunda tentativa sob outro perfil. Ele não é normativo, e nenhum caminho existente ou padrão o
chama. `dcp-jcs-v1`, os verificadores existentes e os seus padrões não mudam, e as suas APIs de objetos e de texto
continuam rejeitando `dcp-jcs-v2`. Os produtores chegaram na fase 4 (§18); os vetores abaixo são assinados por um gerador
exclusivo de testes. Um bundle candidato verificado não concede confiança nem
admissão e não autoriza nada.

| SDK | API |
|---|---|
| TypeScript | `createExperimentalCandidateVerifier(config).verify(bytes, registry, policy?, options?)` |
| Python | `dcp_ai.v2.experimental_candidate_verify`: `create_verifier(...)` e `await verifier.verify(data, registry, policy=None, now_ms=None)` |
| Go | `NewExperimentalCandidateVerifier(ExperimentalCandidateVerifierConfig)` e `VerifyAt(registry, input, policy, now)` |
| Rust | `v2::experimental_candidate_verify`: `CandidateVerifier::new(config)` e `verify_at(input, policy, now_ms)` |
| WASM | `DcpWasm.createExperimentalCandidateVerifier(config).verify(bytes, policy?)`, sobre o binding `wasm_experimental_candidate_verify` |

**Configuração e parâmetros.** A configuração é a do roteador (§16): o transporte, os perfis
aceitos e o adaptador histórico, todos obrigatórios e nenhum com padrão.

- O Go nomeia o seu adaptador pelo nome fechado `encoding_json` e constrói ele mesmo esse decodificador, então mudar a
  `ExperimentalHistoricalEncodingJSON` exportada não muda nada.
- Os parâmetros de verificação são os do verificador V2 de cada SDK, com os mesmos padrões, incluindo a
  política criptográfica opcional.

**Resultado.** A rota, `entered` (`none`, `dcp-jcs-v1` ou `dcp-jcs-v2`) e o resultado do verificador como está, que
é `null` quando nenhum rodou. `entered` nomeia o caminho de verificação que foi iniciado, incluindo a sua validação de
política. Ele não mostra que alguma verificação criptográfica rodou: um verificador pode parar antes em uma verificação de política, estrutura,
hash ou sessão, e o seu resultado o diz.

**O caminho do candidato.** É o verificador atual com uma mudança, o perfil de manifesto que ele aceita; cada hash,
assinatura e auxiliar é o atual. Sobre os valores exatos que o candidato aceita, o canonicalizador de `dcp-jcs-v1`
dá os bytes do candidato (§3.4).

- TypeScript, Python e Rust verificam o valor exato.
- O Go verifica os bytes canônicos do candidato, então o seu parser nunca lê um literal que o candidato normalizou.

**Delegação.** Ela entrega ao verificador atual exatamente a entrada que um chamador atual lhe dá.

- **TypeScript, Python e Rust:** o valor que o adaptador decodificou.
  - Um `null` decodificado são dados, e é delegado.
  - Quando o decodificador recusou os dados não há valor, e nada roda (`entered: none`).
- **Go:** os bytes da unidade vão para `VerifySignedBundleV2At`, que os analisa ele mesmo.
- **WASM:** uma chamada a `wasm_experimental_candidate_verify`.
  - Quando ele precisa do decodificador, o decodificador é consultado uma vez, e `resume`, que nunca verifica, termina em uma
    rejeição ou em uma delegação.
  - Uma delegação entrega a string própria do decodificador a `wasm_verify_signed_bundle_v2`, com o JSON de política
    que `verifyBundle` envia: em `w1`, `JSON.stringify` do objeto decodificado; em `w2`, o texto.
  - Um decodificador que recusou não deixa nenhuma string.
  - O binding mantém o seu comportamento V1: um bundle V1 é verificado sem política e recusado com uma.

**Vetores.** [`tests/interop/candidate/phase3-signed-vectors.json`](../../../tests/interop/candidate/phase3-signed-vectors.json)
tem 18 bases congeladas e 57 casos.

- **Bases:** 16 bundles assinados, o bundle de conformidade V1 e `null`.
  - 15 são assinados por um gerador exclusivo de testes do SDK de TypeScript (não uma API de produção).
  - A 16ª é `B-reordered`: o mesmo bundle assinado que `B-v2`, com os seus membros em ordem inversa e
    espaços em branco.
- **Casos:** um caso é uma base mais edições de bytes.
- **Expectativas:** escritas à mão: a rota, as chamadas ao adaptador, `entered`, o veredito e as substrings de erro
  de cada SDK, com sobrescritas por adaptador onde os decodificadores diferem.

| Grupo | Casos |
|---|---|
| Positivos | 16: híbridos e apenas clássicos; inteiros escritos como `1.0`, `1e2`, `-0` e 1 seguido de 800, 801 ou 5000 zeros decimais; ±(2^53-1); escapes; ordem de membros e espaços em branco; profundidade 64; um perfil isca fora do manifesto; uma cadeia nova ao lado de uma referência v1; um checkpoint PQ; chaves chamadas `__proto__` |
| Rejeições antes de qualquer verificador | 17 |
| Falhas do candidato | 14, cada uma no passo que nomeia |
| Delegações | 10 |

O `--check` do gerador valida duas coisas: as bases congeladas (os seus hashes, os hashes das cargas úteis e do manifesto,
e o perfil declarado), e cada caso e cada expectativa. O teste de TypeScript verifica as 81 assinaturas das
16 bases assinadas com as primitivas compostas, incluindo as bases semanticamente inválidas.

**Testes.** Cada SDK e o WASM executam:

- antes de qualquer caso, uma verificação de que os vetores trazem exatamente os 57 IDs de casos aprovados, cada um uma vez; um ID
  ausente, repetido ou desconhecido a faz falhar;
- os 57 casos, com cada adaptador embutido;
- a paridade de cada delegação com uma chamada direta;
- uma verificação instrumentada de que no máximo um verificador roda. Ela usa uma sonda exclusiva de testes ou bindings contados; nenhuma
  API pública pula a verificação;
- os bytes canônicos de cada valor comprometido dos positivos: a unidade, o manifesto, as quatro cargas úteis,
  as entradas de auditoria e os checkpoints. O ingresso do candidato aceita os bytes canônicos de `dcp-jcs-v1` de
  cada um, com o mesmo valor exato e os mesmos bytes;
- a configuração;
- buffers mutados;
- as APIs atuais continuando a recusar `dcp-jcs-v2`.

**Em relação ao modelo de design.**

| Modelo de design | Fase 3 |
|---|---|
| `accept_v2` | Uma rota de candidato com `verified: true` e o hash real do manifesto |
| `COMMITMENT_MISMATCH` | `verified: false`, com os erros próprios do verificador. Ele pode informar vários, e a ordem deles não é normativa |
| Rejeições | As rotas de §16 |
| Uma delegação | Registra o veredito atual, que o modelo não calcula |
| — | Falhas criptográficas (assinaturas, política, validade das chaves, sessão e checkpoints): expectativas novas, sem equivalente no modelo |

**Portões.** Na fase 3, nenhum dos dez portões de §9 foi declarado cumprido; o registro é §18.4, e o candidato
continua inativo.

- **Evidência para:**
  - o portão 1: os casos de bundles sintéticos, reexpressos como bundles assinados reais;
  - o portão 3: sobre os valores comprometidos dos positivos;
  - o portão 7: defeitos injetados em um bundle candidato assinado são rejeitados antes de qualquer verificador, e em um
    bundle de `dcp-jcs-v1` o veredito delegado é o atual;
  - o portão 8: um verificador, instrumentado.
- **Não cumpridos:**
  - o portão 6, a matriz cruzada de assinatura, que precisa de produtores; todo bundle assinado aqui vem de um único gerador
    de testes;
  - os portões 2, 9 e 10, que precisam das suas próprias execuções.

<a id="18-experimental-sdk-producers-phase-4"></a>

## 18. Produtores experimentais nos SDKs (fase 4)

A fase 4 do plano de implementação nos SDKs adiciona produtores experimentais e de ativação explícita a cada SDK e ao WASM. Eles
geram evidência **nova**: artefatos assinados como os atuais, e bundles cujo novo manifesto assina
`canonicalization_profile: "dcp-jcs-v2"`. Não é normativo, e nenhum caminho existente ou padrão os chama.
`dcp-jcs-v1`, os seus construtores, assinadores e verificadores, e todos os padrões não mudam; o perfil continua
inativo e nenhum pacote é publicado. Um bundle que eles produzem não concede confiança nem admissão e não autoriza nada.

| SDK | API |
|---|---|
| TypeScript | `experimentalCandidateSignPayload(registry, context, input, keys)` e `experimentalCandidateSignBundle(registry, parts, signer, options)` |
| Python | `dcp_ai.v2.experimental_candidate_produce`: `sign_payload(registry, context, input, keys)` e `sign_bundle(registry, parts, signer, options)`, que verificam e copiam na chamada e devolvem um awaitable |
| Go | `ExperimentalCandidateSignPayload(registry, context, input, keys)` e `ExperimentalCandidateSignBundle(registry, parts, signer, options)`, com as entradas `ExperimentalCandidateBytes` e `ExperimentalCandidateHostValue` |
| Rust | `v2::experimental_candidate_produce`: `sign_payload(context, input, keys)` e `sign_bundle(parts, signer, options)`, com `CandidateInput::{Bytes, Value}` |
| WASM | `DcpWasm.experimentalCandidateSignPayload(context, input, keys)` e `experimentalCandidateSignBundle(parts, signer, options)`, sobre os bindings `wasm_experimental_candidate_sign_payload` e `wasm_experimental_candidate_sign_bundle`, que recebem apenas bytes |

**Entradas.** Cada peça é uma destas:

- **bytes:** os bytes originais, verificados pelo ingresso da fase 1 (§15) antes que algo os analise. Este é o
  caminho para o JSON recebido de outro lugar: apenas os bytes mantêm o que um parser repara ou perde;
- **um valor do host:** verificado por um percurso estrito sobre os tipos exatos da linguagem e codificado após a verificação.
  Um valor não pode mostrar o literal do qual foi analisado, então um valor já reparado por um parser não pode ser detectado.

Valores do host fora do domínio são recusados com `NUMBER_NOT_FINITE`, `NUMBER_NOT_INTEGER`,
`NUMBER_OUT_OF_RANGE`, `SURROGATE_UNPAIRED`, `UTF8_INVALID` (Go), `DEPTH_EXCEEDED`, `TYPE_UNSUPPORTED` ou
`KEY_NOT_STRING` (Python). Floats inteiros, `-0` e, em TypeScript e WASM, BigInt são normalizados para o
inteiro. Getters e `toJSON` nunca são invocados. Structs e tipos estrangeiros são recusados, nunca convertidos.

**`signPayload`** assina um artefato, `{payload, payload_hash, composite_sig}`, sob um contexto do DCP e sem
perfil. A carga útil tem no máximo 63 níveis, para que o artefato tenha no máximo 64. O ingresso aceita os
bytes de saída e os devolve sem alterações.

**`signBundle`** monta o bundle sobre valores exatos. As partes são artefatos, entradas de auditoria e checkpoints PQ
opcionais, cada um como bytes ou como valor.

- Os membros que ele não conhece são mantidos. Os que ficam fora de uma carga útil, uma entrada, um checkpoint ou o manifesto não são
  assinados, então a sua integridade não é afirmada.
- A evidência recebida nunca é rerrotulada nem recalculada. Um artefato cujo `payload_hash` não é o da sua carga útil
  é recusado (`COMMITMENT_MISMATCH`), e a cadeia deve começar em `GENESIS` e se encadear (`CHAIN_NOT_GENESIS`,
  `CHAIN_BREAK`).
- O assinador deve ser o principal responsável (`SIGNER_MISMATCH`).
- O início da sessão nunca é tirado do relógio. Com uma expiração, `session_issued_at` é obrigatório
  (`SESSION_ISSUED_AT_REQUIRED`), e as datas devem ser válidas (`SESSION_INVALID`).
- Uma trilha de auditoria vazia dá `audit_count: 0` e raízes de 64 zeros.
- `dualHash` (desativado por padrão) acrescenta a raiz SHA3-256 e `hash_alg: sha256+sha3-256`.
- `created_at` fica fora de todas as assinaturas e não é protegido.
- Verifica-se que a unidade inteira tem no máximo 64 níveis antes de qualquer assinatura.
- O roteador de §16 roteia a saída como `candidate`, com `canonical_sha256` igual ao SHA-256 dos
  bytes de saída.

**Erros.** Uma rejeição deste contrato traz a sua classe, a parte e um JSON Pointer ou deslocamento em bytes, e é
lançada antes que qualquer assinador seja chamado (os testes contam zero chamadas ao assinador). Um mau uso da API é um erro de uso:
`TypeError`, `ErrExperimentalCandidateUsage` ou `ProduceError::Usage`. Os erros da chave, do registro ou do
provedor continuam sendo os atuais.

**Em relação aos construtores atuais.** Estas são APIs novas, não opções dos construtores de `dcp-jcs-v1`, e diferem
de propósito: datas explícitas, o mesmo padrão de `dualHash` em todos os lugares (os construtores v1 de Go, Rust e WASM acrescentam a
raiz secundária por padrão) e montagem sobre valores exatos.

<a id="181-cross-matrix-testsinteropcandidatephase4"></a>

### 18.1 Matriz cruzada (`tests/interop/candidate/phase4/`)

Cinco produtores (TypeScript, Python, Go, Rust e WASM) assinam os mesmos bytes de entrada com as suas APIs públicas de ativação explícita.
Cada consumidor verifica cada saída com o verificador de §17. O executor e as suas especificações estão em
[`tests/interop/candidate/phase4/`](../../../tests/interop/candidate/phase4/); as chaves sintéticas são geradas a cada
execução e nunca são escritas fora do diretório da execução.

- **Positivos:** 12 especificações (`S01`–`S12`) nos modos bytes e value, mais um anel: `S01` montado a partir dos
  artefatos que o produtor seguinte assinou. Isso dá 115 unidades, cada uma verificada por 5 consumidores: 575 resultados.
  Eles cobrem:
  - assinatura híbrida e apenas clássica, um hash duplo, um checkpoint PQ;
  - ±(2^53−1);
  - chaves com U+E000 e U+1F600;
  - U+FEFF no início de uma string, U+FFFD, U+2028 e `\u0000`;
  - profundidade 64;
  - membros de extensão não assinados;
  - membros chamados `__proto__`, `constructor` e `toJSON`;
  - inteiros escritos com 800 e 5000 zeros decimais (bytes);
  - `1.0` e `-0.0` (valores).
- **Negativos:** 16 edições em nível de bytes da saída recém-gerada de cada produtor, verificadas por cada consumidor: 400 resultados.
  - Antes de qualquer verificador: um BOM, UTF-8 inválido, um erro de sintaxe, um surrogate isolado, um duplicado, uma fração, um
    número fora do intervalo, profundidade 65, erros de transporte, um perfil desconhecido e um perfil não aceito.
  - No caminho do candidato, falhando ali: uma carga útil alterada, um manifesto alterado e uma assinatura clássica ou
    PQ invertida.
- **Verificações do executor:**
  - o conjunto exato de 975 resultados, passos e campos;
  - a atualidade: ID da execução, datas e horários dos arquivos;
  - as chamadas ao decodificador que cada consumidor observou (1 para BOM, UTF-8 e sintaxe, 0 nos demais casos);
  - para cada especificação, o mesmo `manifest_hash` de todos os produtores, e a mesma unidade exceto os
    valores das assinaturas ML-DSA (aleatorizados), mascarados apenas nas suas posições conhecidas;
  - os mesmos IDs de chave derivados por todos os SDKs;
  - um prazo que encerra todo o grupo de processos;
  - `--self-test` verifica cada uma destas recusas.

<a id="182-host-values-gate-2"></a>

### 18.2 Valores do host (portão 2)

Cada ID do corpus é classificado por linguagem como:

- **R:** representado exatamente, com a classe dos bytes;
- **T:** representado apenas como um valor já transformado, cuja classe pode mudar;
- **P:** recusado antes pelo parser;
- **N:** não representável.

Cada célula R e T é testada no seu SDK; P e N são documentadas. A marcação `needs_original_bytes: false`
significa apenas que um parser já pode recusar o caso.

| ID | Bytes | TS / WASM | Python | Go | Rust |
|---|---|---|---|---|---|
| `n-two53`, `n-1e20`, `n-1e21`, `n-fraction`, `s-depth-65`, `s-depth-129` | como no corpus | R | R | R | R (profundidades construídas diretamente) |
| `n-two53-plus-one`, `n-neg-two53-plus-one`, `n-int64-max`, `n-sci-over` | `NUMBER_OUT_OF_RANGE` | R com BigInt; T com number (arredondado, ainda fora do intervalo) | R (int) | R (int64) | R (i64) |
| `n-overflow` (`1e400`) | `NUMBER_OUT_OF_RANGE` | R com BigInt; T com number (`Infinity`: `NUMBER_NOT_FINITE`) | R (int); T com float (`inf`) | N como inteiro; R como o literal `json.Number`; T com float64 (`+Inf`) | N |
| `n-huge-exponent` (um expoente de 5000 dígitos) | `NUMBER_OUT_OF_RANGE` | N como inteiro (não pode ser materializado); T (`Infinity`) | N; T (`inf`) | R como o literal `json.Number`, recusado sem construir o número; T (`+Inf`) | N |
| `n-nan`, `n-negative-infinity` | `SYNTAX` | T (`NUMBER_NOT_FINITE`) | T | T | N |
| 9 IDs de sintaxe (zero inicial, sinal de mais, ponto solto, controle sem escape, vírgula ou dados finais, dois valores, entrada vazia, NBSP) | `SYNTAX` | P | P | P | P |

As células T de `n-huge-exponent` usam um literal mais curto (`1e99999`) que um parser também transforma em um infinito.
Os 22 casos marcados `true` ficam fora do alcance dos valores; para eles, o caminho são os bytes.

<a id="183-cost-gate-10"></a>

### 18.3 Custo (portão 10)

O custo é medido sobre um par equivalente por plataforma. Os dois lados usam as mesmas chaves, cargas úteis, sessão e
entradas de auditoria, e o executor verifica isso nas saídas antes de medir: os mesmos quatro `payload_hash`, o
mesmo nonce e as mesmas datas de sessão, e as mesmas entradas. O bundle v1 vem do construtor e do assinador de cada SDK, o
candidato do produtor.

Cada operação roda 20 vezes após 3 de aquecimento, com no máximo 60 s por plataforma, e as compilações são cronometradas
à parte. Execute com `node tests/interop/candidate/phase4/run.mjs --cost`. Medianas em ms, de uma execução em uma
máquina (Apple M5 Pro; Node 22.15, Python 3.12, Go 1.26, Rust 1.93 release):

| Plataforma | Produzir v1 | Produzir candidato | Verificar hoje | Verificar v1 (`v1_path`) | Verificar candidato |
|---|---|---|---|---|---|
| TypeScript | 40.3 | 48.1 | 20.2 | 20.7 | 32.0 |
| Python | 22.8 | 27.6 | 3.5 | 7.7 | 7.7 |
| Go | 3.2 | 7.0 | 2.1 | 2.9 | 2.5 |
| Rust | 2.3 | 3.0 | 0.7 | 0.9 | 0.8 |
| WASM | 4.1 | 4.8 | 1.5 | 2.1 | 1.4 |

**Limites.** Estes tempos não são uma medida da canonicalização sozinha, e não mostram nem uma melhoria
nem uma regressão:

- **As saídas diferem.** Os bytes v1 são a serialização JSON de cada SDK (a do Python tem espaços), enquanto os do
  candidato são canônicos.
- **Os construtores diferem.** Os construtores v1 de Go, Rust e WASM acrescentam a raiz secundária, e o candidato aqui
  não.
- **As entradas do Go.** O construtor v1 recebe entradas tipadas, então o seu `AuditEvidenceV2` descarta os membros nulos. Os dois
  lados do par do Go assinam as mesmas entradas, reconstruídas por meio dele.
- **O que «Verificar hoje» inclui.** Inclui decodificar os bytes onde a API recebe um objeto ou um valor
  (`JSON.parse`, `json.loads`, `serde_json::from_slice`). A API do Go recebe bytes e os analisa ela mesma.
- **Variação.** As medianas variaram entre execuções na mesma máquina. Por exemplo, a verificação do candidato
  em TypeScript deu cerca de 22 ms em uma execução anterior.

Não há SLA, e nada foi relaxado para compensar.

<a id="184-ledger-of-the-ten-gates-9"></a>

### 18.4 Registro dos dez portões (§9)

Este registro reúne evidência; ele não ativa nada. Uma mudança de fase ou de padrão exige a sua própria decisão.

| # | Portão | Estado | Evidência | Limites |
|---|---|---|---|---|
| 1 | Paridade do corpus | Cumprido | §15: as 87 unidades de referência e os 81 casos de design sem envelope em quatro SDKs, e os mesmos 168 casos no WASM. §17: os casos de bundles sintéticos como bundles assinados reais. §16: leituras reais de decodificadores em vez do parâmetro `historical` | Os casos da regra de profundidade da v0.3 demonstram o modelo e não são requisitos |
| 2 | Escopo da API de objetos | Cumprido, com o escopo de §18.2 | §18.2: cada célula R e T testada por linguagem, cada uma recusada com a sua classe antes da assinatura. TypeScript, Python, Go e WASM contam zero chamadas ao assinador por célula. As células do Rust usam chaves que não podem assinar, então uma chamada ao assinador apareceria em vez disso como um erro do provedor; as suas zero chamadas contadas estão nos seus testes unitários específicos | Os 22 casos marcados `true` e as células P e N ficam fora do alcance dos valores |
| 3 | Equivalência de saída sobre valores | Cumprido, sobre amostras | §15: a comparação com `dcp-jcs-v1` sobre os valores aceitos. §17: os valores comprometidos dos positivos. §18.1: 115 unidades iguais entre cinco produtores. §18.3: os mesmos hashes de cargas úteis do assinador v1 e do produtor | Mostrado sobre o corpus, os vetores e a matriz, não provado sobre todo o domínio |
| 4 | Paridade do ingresso a partir de bytes | Cumprido | §15, em quatro SDKs e no WASM | Casos de unidades |
| 5 | Leituras históricas | Não é um portão | §16 as registra como diagnósticos | — |
| 6 | Matriz cruzada de assinatura | Cumprido | §18.1: 5 × 5 mais o anel, 975 de 975 resultados, com todas as cargas úteis de fronteira do portão. A matriz de interoperabilidade de `dcp-jcs-v1` (`tools/interop-matrix`, os dois cenários) passa no fechamento | Execuções locais em uma máquina; o workflow a executa de novo a cada mudança |
| 7 | Matriz negativa | Parcial | §18.1: todas as classes do corpus, e as classes de transporte e de perfil, rejeitadas antes de qualquer verificador, 5 × 5. Falhas do candidato no caminho do candidato. §17: as delegações de bundles de `dcp-jcs-v1` mantêm o veredito atual | O lado de `dcp-jcs-v1` se apoia nas delegações de §17 e nas leituras de §16; aqui não foi repetido por classe |
| 8 | Seleção, precedência e política | Cumprido | §16 e §17, com um verificador instrumentado | — |
| 9 | Histórico | Cumprido | No fechamento, com o código novo no lugar: conformidade (V1 e V2, com os casos de admissão), a suíte de testes completa de cada SDK, os testes do WASM (incluindo os vetores de bundles e a verificação V1) e as matrizes de interoperabilidade e de admissão de `dcp-jcs-v1`, tudo verde. Nenhuma campanha das fases 1 a 3 foi repetida | Execuções locais em uma máquina |
| 10 | Custo | Cumprido | §18.3 | Uma máquina, sem SLA, os limites de §18.3 |
