<sub>[English](README.md) · [中文](README.zh-CN.md) · **Español** · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="canonicalization-candidate-dcp-jcs-v2"></a>

# Candidato de canonicalización `dcp-jcs-v2`

> Traducción informativa de [la versión en inglés](README.md), actualizada el 26/10/2026. Propuesta experimental y no normativa; si difieren, prevalece la versión en inglés. Los identificadores y bloques de código se conservan sin traducir.

| | |
|---|---|
| **Fecha** | 25/10/2026 |
| **Versión** | 1.1 |
| **Clasificación** | Pública |
| **Estado** | **No normativo, experimental e inactivo.** `dcp-jcs-v1` sigue siendo el único perfil de canonicalización normativo y el predeterminado; las API candidatas de los SDK (§15 a §18) son experimentales y de activación explícita |
| **Corpus** | [`corpus.json`](corpus.json) (revisión `design-2`, 187 casos) y [`baseline-corpus.json`](baseline-corpus.json) (87 casos, más 10 de selección y 3 de política) |
| **Herramienta de laboratorio** | [`tools/canonicalization-lab/`](../../../tools/canonicalization-lab/): modelo de diseño, generador de corpus y ejecutor |

> **Aviso.** Este documento propone un perfil candidato y registra su diseño. No cambia
> `dcp-jcs-v1` ni [`spec/CANONICALIZATION_PROFILE.md`](../../../spec/CANONICALIZATION_PROFILE.md), que
> siguen siendo la única referencia normativa. Ningún verificador, firmante, esquema, comprobación de conformidad o valor predeterminado existente
> usa el identificador `dcp-jcs-v2`. Las API experimentales y de activación explícita de §15 a §18 lo reconocen
> sin activarlo: ninguna ruta existente o predeterminada las llama, solo quienes las activan explícitamente. Las de §15
> y §16 no verifican nada; el verificador de §17 verifica bundles candidatos a partir de sus bytes originales, y
> un bundle verificado no concede confianza ni admisión. Los productores de §18 generan nueva evidencia candidata
> solo para esos llamadores; los vectores de la fase 3 los firma un generador exclusivo de pruebas. Las API experimentales opt-in están disponibles en npm SDK 2.2.0 y WASM 2.1.0; los demás ecosistemas tienen publicaciones independientes. Véanse los [paquetes npm publicados](../../NPM_RELEASES.md). El job de CI de la herramienta de laboratorio ejecuta
> el modelo de diseño, los jobs de prueba de los SDK ejecutan esas API sobre el corpus y los vectores de la fase 3, y la
> matriz de la fase 4 tiene su propio workflow. Los
> verificadores V2 existentes, como el del SDK de TypeScript
> ([`verify-v2.ts`](../../../sdks/typescript/src/core/verify-v2.ts)), siguen rechazando el perfil como
> desconocido cuando reciben un objeto analizado o un texto, que es el comportamiento previsto. Nada de esto es un requisito de conformidad. La herramienta
> de laboratorio es un modelo ejecutable del diseño, no una implementación: calcula SHA-256 para sus
> compromisos sintéticos, pero no firma nada ni verifica ninguna firma.

<a id="1-why-a-candidate"></a>

## 1. Por qué un candidato

`dcp-jcs-v1` canonicaliza el valor que devuelve un analizador JSON. No todos los analizadores JSON devuelven el mismo
valor para el mismo texto: RFC 8259 deja a la implementación los nombres de miembro duplicados (§4), los surrogates aislados en escapes (§8.2)
y una marca de orden de bytes inicial (§8.1), y un analizador que lee los números como binary64
puede convertir literales distintos en el mismo valor. Dos lectores de un mismo texto pueden entonces calcular bytes
canónicos, hashes y entradas de firma distintos, y un valor que el firmante nunca vio (un miembro duplicado
anterior, por ejemplo) puede viajar con evidencia firmada.

El candidato mantiene las reglas de salida de `dcp-jcs-v1` y decide la aceptación sobre los bytes originales,
antes de que ningún analizador repare, redondee o pierda información.

<a id="2-principles"></a>

## 2. Principios

1. **Los mismos bytes que `dcp-jcs-v1` para los mismos valores.** El candidato no cambia ninguna regla de salida; solo
   restringe qué entradas se aceptan. Para cualquier valor exacto de su dominio, ambos canonicalizadores producen los
   mismos bytes.
2. **La aceptación se decide sobre los bytes originales.**
3. **El perfil se elige una sola vez, a partir del campo firmado del manifiesto.** Un perfil desconocido se rechaza; no
   se reintenta ningún otro perfil tras un fallo.
4. **No es JCS.** Las claves se ordenan por punto de código Unicode, como en `dcp-jcs-v1`; RFC 8785 §3.2.3 ordena por
   unidades de código UTF-16. El perfil no afirma compatibilidad con JCS.
5. **Sin degradación silenciosa.** Un verificador que no conoce el candidato lo rechaza.

<a id="3-rules"></a>

## 3. Reglas

<a id="31-ingress-bytes"></a>

### 3.1 Ingreso (bytes)

| Regla | Requisito | Clase |
|---|---|---|
| I1 | UTF-8 bien formado: sin bytes inválidos, sin formas sobrelargas, sin surrogates codificados (`ED A0 80`), nada por encima de U+10FFFF | `UTF8_INVALID` |
| I2 | Sin U+FEFF inicial (`EF BB BF`) | `BOM` |
| I3 | Exactamente un texto JSON RFC 8259: solo espacio, tabulador, LF y CR como espacio en blanco, nada después del valor, sin `NaN`, `Infinity`, `+1`, `01`, `1.` ni comas finales | `SYNTAX` |
| I4 | Como máximo 64 arrays y objetos anidados, contados desde la raíz de la unidad validada (§5) | `DEPTH_EXCEEDED` |

<a id="32-strings-and-keys"></a>

### 3.2 Cadenas y claves

- **S1. Valores escalares.** Toda cadena, claves incluidas, es una secuencia de valores escalares Unicode. Un
  escape `\uD800`–`\uDBFF` debe ir seguido inmediatamente de un escape `\uDC00`–`\uDFFF`, y el par
  representa un único valor escalar. Cualquier otro escape de surrogate es `SURROGATE_UNPAIRED`.
- **S2. Sin reparación.** U+FFFD es un carácter legítimo, escapado o literal. Lo que se rechaza son los datos que un
  analizador *convertiría en* U+FFFD.
- **S3. Se aceptan los no caracteres** (D2).
- **S4. Sin normalización.** Como en la regla 9 de `dcp-jcs-v1`, `"é"` (U+00E9) y `"e\u0301"` son cadenas y claves
  distintas.
- **S5. Claves únicas.** Dos miembros de un mismo objeto no pueden tener la misma clave tras deshacer los escapes
  (`DUPLICATE_KEY`), aunque sus valores sean iguales, a cualquier profundidad, sin casos especiales (`__proto__` es una clave
  como cualquier otra).

<a id="33-numbers"></a>

### 3.3 Números

- **N1. Valor exacto del literal.** La aceptación se decide sobre el valor decimal exacto del literal,
  no sobre su conversión a binary64. Un valor que no es entero es `NUMBER_NOT_INTEGER`; un entero
  fuera de `[-(2^53-1), 2^53-1]` es `NUMBER_OUT_OF_RANGE`.
- **N2. Formas admitidas.** Un literal cuyo valor decimal exacto es un entero dentro del rango se acepta, sea cual sea
  su forma: `1.0` es `1`, `1e2` y `1E+2` son `100`, `100e-2` es `1`, `1.5e1` es `15`, y `-0`, `-0.0`
  y `0e-400` son `0`. No son todos los literales que acepta `dcp-jcs-v1`: uno que un analizador binary64
  redondea a un entero, como `1.0000000000000001`, se rechaza (N3).
- **N3. Rechazados porque no son enteros exactos dentro del rango:** `0.5`, `2^53`, `1e-400`,
  `0.99999999999999999`, `1.0000000000000001`, `4503599627370497.5`, `9007199254740993`, `1e21`.
- **N4. Algoritmo sin aritmética grande.** Para un literal `-?E(.F)?(e[+-]?X)?`:
  1. `D` = los dígitos de `E` y `F` sin ceros a la izquierda, y `s = X − len(F)`. Un `D` vacío es `0`.
  2. Quita los ceros finales de `D` y suma su número a `s`.
  3. Si `s < 0`, el valor no es entero.
  4. Si `len(D) + s > 16`, el valor es al menos 10^16 y está fuera de rango.
  5. Si no, compara `D·10^s` con `2^53-1`.

  `X` se lee con saturación en `len(literal) + 17`; más allá de ese límite el resultado no puede cambiar. Un literal
  que es a la vez fraccionario y fuera de rango es `NUMBER_NOT_INTEGER` (el paso 3 va antes que el paso 4).
- **N5. Los enteros de aplicación grandes** van en cadenas decimales, declaradas como tales en su esquema.
- **N6. El valor sale del literal.** Bajo el candidato, el número que se canonicaliza es el
  que calcula N4, nunca el que devuelve un analizador binary64. La ruta de `dcp-jcs-v1` no cambia.

<a id="34-output"></a>

### 3.4 Salida

Las reglas de salida de `dcp-jcs-v1` (reglas 1–3 y 5–8): claves ordenadas por punto de código a todos los niveles; forma
compacta; los escapes de RFC 8785 §3.2 (`\b \t \n \f \r`, `\u00xx` en minúsculas para el resto de C0, `\"` y
`\\`) y todo lo demás como UTF-8 literal, incluidos `/`, U+007F, U+2028 y U+2029; enteros sin
fracción ni exponente, `-0` como `0`; `null`, `true` y `false` literales; `{}` y `[]` conservados.

<a id="4-design-decisions"></a>

## 4. Decisiones de diseño

| # | Decisión | Justificación | Compatibilidad |
|---|---|---|---|
| D1 | **Rechazar un BOM inicial** en la unidad (`BOM`, desplazamiento 0). Un BOM antes de un sobre de transporte es un defecto del transporte | RFC 8259 §8.1 permite a los receptores ignorarlo, y los lectores difieren: unos lo quitan y otros lo rechazan. Rechazarlo elimina la diferencia. U+FEFF dentro de una cadena es contenido | La ruta de `dcp-jcs-v1` no cambia (§7) |
| D2 | **Aceptar los no caracteres** (U+FFFE, U+FFFF y los demás) | Son valores escalares con una única codificación UTF-8 y una única forma canónica. Rechazarlos sería una política de contenido, no una regla de canonicalización | El perfil no es I-JSON (RFC 7493 §2.1 los prohíbe) ni afirma serlo |
| D3 | **Como máximo 64 niveles de anidamiento, contados desde la raíz de la unidad validada** (los bytes del bundle firmado), **nunca sobre un sobre de transporte** (§5) | La validez no debe depender de que un transporte añada un sobre. 64 queda por debajo del límite de recursión predeterminado de `serde_json` (128). No es una garantía sobre otros analizadores, sobre los números u otros límites, ni sobre los presupuestos del operador, que pueden ser menores | Solo afecta a las unidades que seleccionan el candidato |
| D4 | **Valor exacto del literal** (N1–N6) | El criterio es un entero exacto en `[-(2^53-1), 2^53-1]`. Todo lo demás se rechaza: literales que binary64 representa exactamente pero que están fuera del dominio (`0.5`, `2^53`) y literales que binary64 leería como otro valor (`1e-400` como 0). El coste es lineal; la longitud de un literal es un presupuesto del transporte, no una regla del perfil | Solo afecta a las unidades que seleccionan el candidato |
| D5 | **Fuera del alcance de activación:** los artefactos sin manifiesto (revocaciones, rotaciones de claves, mandatos) y A2A | El perfil se declara en el campo firmado del manifiesto; esos artefactos no tienen ese campo. Un diseño posterior puede dar a cada tipo su propio campo firmado, y a A2A uno en la transcripción del handshake | Siguen en `dcp-jcs-v1`. Un verificador puede aplicarles el ingreso estricto por política, pero no puede afirmar que el productor se comprometió con el candidato |
| D6 | **El nombre candidato `dcp-jcs-v2` está reservado.** Solo lo emiten los productores experimentales y de activación explícita de §18, cuando un llamador se lo pide; ninguna ruta predeterminada lo hace, tampoco en los paquetes npm publicados. Sigue siendo un nombre candidato hasta que se apruebe un documento normativo. (Revisado en la fase 4: antes de §18 no había ningún productor de SDK de activación explícita; los vectores de la fase 3 venían de un generador exclusivo de pruebas.) | Un sufijo de borrador en el cable sería otro identificador que mantener. Los verificadores solo lo habilitan mediante una política explícita (§7) | La evidencia emitida bajo el candidato es experimental. Si las reglas cambiaran tras una publicación externa, haría falta un identificador nuevo (`dcp-jcs-v1` §5) |
| D7 | **Avisos opcionales de `dcp-jcs-v1`.** Con los bytes disponibles, un verificador puede añadir a un resultado de `dcp-jcs-v1` un aviso con la clase y el desplazamiento del defecto principal (§6) | Permite encontrar productores que corregir antes de migrar | Nunca cambia un veredicto de `dcp-jcs-v1`. Una API basada en objetos no puede emitirlo |

<a id="5-the-validated-unit-and-the-transport"></a>

## 5. La unidad validada y el transporte

**La unidad** son los bytes exactos del valor del bundle firmado (`{"bundle": …, "signature": …}`). Su raíz es la
profundidad 1; una carga útil empieza en la profundidad 4 (raíz, `bundle`, artefacto, `payload`), así que su propio anidamiento puede llegar a
61 niveles. Los desplazamientos son relativos al primer byte de la unidad.

**Los transportes** los fija la configuración del endpoint, nunca se infieren del contenido:

| Transporte | Unidad |
|---|---|
| `bare` | Toda la entrada: un cuerpo HTTP, un archivo o el valor de una cabecera tras su propia decodificación |
| `envelope` | El valor del único miembro `signed_bundle` de un objeto de nivel superior |

**Extracción sin volver a serializar.** El sobre se recorre con una gramática a nivel de bytes que delimita
las cadenas sin decodificarlas. El nombre del miembro se compara tras deshacer los escapes, así que `"signed\u005fbundle"`
nombra la unidad. La unidad es el tramo `[start, end)` del valor, que se pasa sin cambios: sus duplicados,
literales numéricos y escapes llegan intactos al escáner. Los demás miembros del sobre no se interpretan;
los presupuestos de tamaño y profundidad del transporte son aparte.

**Límite.** Dentro de un sobre, una unidad cuya gramática está rota no puede delimitarse y es
`TRANSPORT_INVALID`; la misma unidad enviada sin sobre es `SYNTAX`. Ambas se rechazan. Para los defectos dentro de cadenas,
los duplicados, los números y la profundidad, el sobre no cambia ni la clase ni el desplazamiento relativo a la unidad.

**Un contrato nuevo, de activación explícita.** La extracción a nivel de bytes rechaza sobres que el análisis actual basado en objetos
acepta (un miembro `signed_bundle` repetido, un BOM antes del sobre). Corresponde a una nueva API de bytes o
a una opción explícita, con su propia nota de compatibilidad, y no puede instalarse en silencio sobre la
ruta de `dcp-jcs-v1`.

**Por qué no contar el sobre.** Contar la profundidad sobre el documento de transporte hace que la validez dependa del
transporte: el mismo bundle de 64 niveles sería válido sin sobre e inválido dentro de `{"signed_bundle": …}`, y un
proxy que vuelve a envolver un cuerpo cambiaría el veredicto. La herramienta de laboratorio puede evaluar esa regla para comparar
(`depth_scope: "transport"`, casos `d-unit-64-envelope-v03-rule` y
`b-v2-unit-depth-64-envelope-v03-rule`).

<a id="6-precedence"></a>

## 6. Precedencia

<a id="61-the-scanners-diagnosis-by-layers"></a>

### 6.1 El diagnóstico del escáner, por capas

Dentro del diagnóstico del escáner de la unidad, una capa anterior siempre gana, sean cuales sean los desplazamientos. Las capas
eligen **qué violación es la principal**; si rechaza o no lo decide el pipeline (§6.4).

| Capa | Clases | Desplazamiento | Dentro de la capa |
|---|---|---|---|
| 1. Codificación | `BOM`, `UTF8_INVALID` | `BOM`: 0. `UTF8_INVALID`: primer byte de la primera subsecuencia mal formada | El BOM está en el desplazamiento 0 y gana |
| 2. Gramática | `SYNTAX` | El primer byte que no puede prolongar un prefijo de ningún texto JSON; la longitud de la entrada si termina antes de tiempo | Solo uno: el primero |
| 3. Valores | `SURROGATE_UNPAIRED`, `DUPLICATE_KEY`, `NUMBER_NOT_INTEGER`, `NUMBER_OUT_OF_RANGE`, `DEPTH_EXCEEDED` | §6.2 | **El desplazamiento más temprano** |

<a id="62-offsets-of-the-value-layer"></a>

### 6.2 Desplazamientos de la capa de valores

| Clase | Desplazamiento |
|---|---|
| `SURROGATE_UNPAIRED` | La barra invertida del escape que no forma parte de un par |
| `DUPLICATE_KEY` | La comilla de apertura de la **segunda** aparición de la clave |
| `NUMBER_NOT_INTEGER`, `NUMBER_OUT_OF_RANGE` | El primer byte del literal |
| `DEPTH_EXCEEDED` | El corchete o la llave que abre el nivel 65 |

Un defecto en una clave precede a un defecto en su valor, porque la clave va primero en los bytes. Las claves se
comparan tras deshacer los escapes como secuencias de unidades: un par válido es un valor escalar y un surrogate aislado
sigue siendo una unidad. En una sola pasada no hay dos violaciones con el mismo desplazamiento; para completar, desplazamientos iguales
seguirían el orden de la tabla. Más allá del nivel 64 el escáner sigue comprobando la gramática hasta el final
de la unidad; un defecto de la capa de valores allí ya no puede ganar, porque su desplazamiento va después del corchete
que abrió el nivel 65. El escáner es iterativo: veinte mil niveles dan `DEPTH_EXCEEDED` sin un
límite de recursión.

<a id="63-transport-phases"></a>

### 6.3 Fases del transporte

En un sobre decide la fase, no el desplazamiento:

| Fase | Comprueba | Clase / detalle | Desplazamiento (desde el inicio de la entrada) |
|---|---|---|---|
| T1 | BOM antes del sobre | `TRANSPORT_INVALID` / `BOM` | 0 |
| T2 | Gramática a nivel de bytes de **todo** el sobre, unidad incluida | `TRANSPORT_INVALID` / `SYNTAX` | Como en la capa 2 |
| T3 | La raíz es un objeto | `TRANSPORT_INVALID` / `NOT_AN_OBJECT` | El de la raíz |
| T4 | Exactamente un miembro `signed_bundle` | `TRANSPORT_INVALID` / `NO_SIGNED_BUNDLE`, o `TRANSPORT_AMBIGUOUS` / `SIGNED_BUNDLE_REPEATED` | Ninguno, o el nombre del segundo miembro |
| T5 | UTF-8 bien formado **fuera** de la unidad, primero antes de ella y después tras ella | `TRANSPORT_INVALID` / `UTF8_INVALID` | Primer byte de la subsecuencia mal formada |

La codificación del sobre solo puede juzgarse fuera de la unidad, que solo existe después de T2–T4; la unidad se
escanea después de las cinco fases. Por ejemplo, `{"bad":"<FF>","signed_bundle":{},"signed_bundle":{}}` es
`TRANSPORT_AMBIGUOUS` en el desplazamiento 30, aunque el UTF-8 inválido está en el desplazamiento 8.

<a id="64-the-complete-pipeline"></a>

### 6.4 El pipeline completo

1. **Configuración** (solo bundles): `POLICY_INVALID`, antes de leer la entrada.
2. **Transporte** (solo con sobre): fases T1–T5.
3. **Escáner de la unidad:** el diagnóstico principal, o ninguno.
4. **Documento:** un diagnóstico rechaza con su clase; si no, se producen los bytes canónicos.
5. **Bundle que el escáner puede recorrer** (sin diagnóstico de codificación ni de gramática):
   1. una lectura `unknown` es `PROFILE_UNKNOWN`, **incluso con un diagnóstico de la capa de valores**;
   2. un perfil fuera de la política es `PROFILE_NOT_ACCEPTED`, también con un diagnóstico;
   3. `absent` o `dcp-jcs-v1` se **delega a la ruta de `dcp-jcs-v1`**, y el diagnóstico es solo un aviso (D7);
   4. `dcp-jcs-v2` con un diagnóstico se rechaza con su clase;
   5. `dcp-jcs-v2` sin él pasa por las comprobaciones del bundle sintético, en este orden: su
      estructura, `payload_hash`, `intent_hash`, `audit_chain`, `manifest_hash`. El primer fallo es
      `COMMITMENT_MISMATCH` con ese detalle; si no, el bundle se acepta.
6. **Bundle que el escáner no puede recorrer** (un diagnóstico de codificación o de gramática):
   - si el analizador actual falla, o lee `dcp-jcs-v2` u otro valor, la clase del diagnóstico;
   - si lee `absent` o `dcp-jcs-v1`, la política (sin `dcp-jcs-v1`, `PROFILE_NOT_ACCEPTED`) y después la delegación con un aviso.

<a id="7-profile-selection-and-policy"></a>

## 7. Selección del perfil y política

**Lectura.**

- **Ruta exacta.** Solo `bundle.manifest.canonicalization_profile`, desde la raíz de la unidad, selecciona. El mismo
  campo en otro lugar son datos: en la raíz, en `bundle`, en `signature`, en una carga útil o en un manifiesto que es
  un array.
- **Duplicados.** Cuando una clave de la ruta se repite (`bundle`, `manifest`, el campo), se lee el **último**
  valor, como lo conservan los analizadores JSON habituales.
- **Comparación tras deshacer los escapes.** `"dcp-jcs-v\u0032"` y `"canonicalization\u005fprofile"` cuentan.
- **Resultado:** `absent`, `dcp-jcs-v1`, `dcp-jcs-v2` o `unknown` (cualquier otra cadena, variante de mayúsculas o
  espacios, `""`, `null`, un número, un array, un objeto o una cadena con un surrogate aislado).

**Solo para una unidad que el escáner no puede recorrer** se consulta el analizador actual, y solo para decidir si la
ruta de `dcp-jcs-v1` continúa. Una reparación del analizador nunca admite el candidato, y las clases de rechazo son las
mismas en todas partes.

**Delegación.** `v1_path` entrega la unidad, sin cambios, al verificador actual de `dcp-jcs-v1`. Para una unidad que el
escáner puede recorrer, el escáner lee el campo como lo hace un analizador que conserva el último duplicado; para una que
no puede recorrer, decide el analizador actual. Que se conserven los veredictos de `dcp-jcs-v1` es un **argumento de diseño**,
basado en cómo leen los analizadores la ruta; el modelo de diseño del laboratorio no lo mide. Lo que midieron las fases de los SDK
está en §16 a §18 (por ejemplo, las lecturas de decodificadores de §16 y la matriz de §18.1).

**Política.** `accepted_canonicalization_profiles` es una lista no vacía de identificadores conocidos sin
repeticiones. Cualquier otra cosa (una lista vacía, una cadena suelta, `null`, entradas que no son cadenas como `[[]]`, `[{}]`
o `[1]`, repeticiones, identificadores desconocidos) es `POLICY_INVALID`, un error de configuración, no un rechazo de
los datos. Una política solo restringe; nunca selecciona, y su orden no importa. La herramienta de laboratorio no tiene
política predeterminada: cada caso declara la suya, y el candidato solo se habilita explícitamente
(`["dcp-jcs-v1", "dcp-jcs-v2"]`). Un futuro valor predeterminado de producción sería `["dcp-jcs-v1"]`.

**Sin reintentos.** Un perfil, una ruta. Un fallo de la ruta del candidato es definitivo: nada se
vuelve a canonicalizar con `dcp-jcs-v1`, y el perfil nunca se infiere del contenido, de las cabeceras ni de los parámetros.

<a id="8-signed-profile-inner-signatures-audit-chain-and-migration"></a>

## 8. Perfil firmado, firmas internas, cadena de auditoría y migración

- **El campo está firmado.** Forma parte del manifiesto, que cubre la firma del bundle. Bajo el
  candidato no hay duplicados, así que el compromiso no es ambiguo. Bajo `dcp-jcs-v1` solo el último
  de los campos repetidos entra en los bytes canónicos firmados, así que un campo repetido colocado antes del firmado
  no rompe la firma; el candidato lo elimina, y D7 puede señalarlo.
- **Las firmas internas no llevan perfil.** Dentro del dominio, los bytes de los artefactos son los mismos bajo ambos
  perfiles, así que el compromiso con el candidato solo viene del manifiesto: una firma interna por sí sola
  no dice qué perfil la produjo. Los artefactos fuera de un bundle siguen en `dcp-jcs-v1` (D5).
- **La cadena de auditoría empieza en `GENESIS`.** El verificador actual exige `prev_hash == "GENESIS"` en la
  primera entrada ([`verify-v2.ts`](../../../sdks/typescript/src/core/verify-v2.ts)). Un hash de `dcp-jcs-v1`
  copiado como primer `prev_hash` de un bundle candidato no es un enlace verificable entre perfiles:
  rompe la cadena (caso `mig-copied-v1-hash`). La evidencia candidata empieza su propia cadena; una referencia a
  evidencia anterior dentro de una carga útil la identifica pero no la verifica (`mig-reference-is-data`).
  La continuidad de una cadena entre perfiles necesita un mecanismo que no se diseña aquí.
- **Reetiquetados.** `dcp-jcs-v1` reetiquetado como el candidato falla el hash del manifiesto y no se reintenta con
  `dcp-jcs-v1` (`mig-relabel-v1-to-v2`). El candidato reetiquetado como `dcp-jcs-v1`, o con el campo
  eliminado, se delega a `dcp-jcs-v1`, cuyo verificador resume entonces un manifiesto que el productor no firmó;
  la herramienta de laboratorio no calcula ese veredicto. Un literal fuera del dominio en un bundle candidato se
  rechaza en el ingreso, aunque un lector binary64 vería un valor coincidente: no hay alternativa.
- **Nada se reetiqueta ni se vuelve a firmar automáticamente.** La evidencia bajo el candidato es evidencia nueva con
  firmas nuevas; lo que hay que archivar son los bytes recibidos, no objetos vueltos a serializar.

<a id="9-phases-and-acceptance-gates"></a>

## 9. Fases y puertas de aceptación

Aquí no se activa nada. Solo están implementados el ingreso experimental de unidades (§15), el enrutador (§16), el verificador de bytes (§17) y los productores (§18). Pasar a una fase posterior necesita una decisión explícita, tomada
aparte de este documento, y un cambio de valor predeterminado necesita su propia decisión.

**Fases.**

1. Propuesta, corpus y modelo de diseño (este documento).
2. Verificadores capaces de verificar el candidato tras una opción explícita, con los productores todavía en
   `dcp-jcs-v1`.
3. Productores con una opción explícita, una vez que pase la matriz cruzada de firma de abajo.
4. Un cambio de valor predeterminado, en un ciclo posterior, con notas de obsolescencia.

La verificación de `dcp-jcs-v1` se mantiene para la evidencia histórica en todo momento: introducir el candidato no
hace que ninguna evidencia de `dcp-jcs-v1` deje de verificarse ni empiece a verificarse. Las correcciones de seguridad de `dcp-jcs-v1` se
evalúan por separado.

**Puertas antes de la fase 2 o 3** (requisitos; su estado está en el registro de §18.4):

1. **Paridad del corpus.** Los casos que fijan el ingreso son los 87 casos brutos de referencia y los casos de diseño
   aplicables. Sobre ellos, todos los SDK y WASM, mediante una API de bytes, dan el mismo `canonical_sha256` en los casos de
   aceptación y la misma clase, con la precedencia y los desplazamientos de §6, en los casos de rechazo. Los casos que
   evalúan la regla de profundidad obsoleta de v0.3 (`depth_scope: "transport"`) demuestran el modelo y no son
   requisitos de aceptación. Los casos de bundles sintéticos deben convertirse en bundles firmados reales con expectativas
   explícitas, y su parámetro `historical` debe sustituirse por una observación real del analizador de cada SDK;
   nunca es evidencia.
2. **Alcance de la API de objetos.** Una API que recibe objetos analizados rechaza los casos de rechazo marcados
   `needs_original_bytes: false`, y documenta que los casos de rechazo marcados `true` quedan fuera de su alcance.
3. **Equivalencia de salida sobre valores.** Para cada valor exacto del dominio, construido directamente o mediante el
   ingreso del candidato (nunca mediante un analizador de `dcp-jcs-v1` a partir de un literal), ambos canonicalizadores dan los
   mismos bytes en todos los SDK.
4. **Paridad del ingreso desde bytes.** Todos los SDK materializan el mismo valor y los mismos bytes a partir de los casos de aceptación.
5. **Las lecturas históricas siguen siendo diagnósticos.** Un analizador histórico que lee un literal de forma distinta a
   su valor exacto es un asunto de `dcp-jcs-v1` con su propio análisis de compatibilidad, no una puerta.
6. **Matriz cruzada de firma.** Cada productor firma bundles candidatos con cargas útiles de frontera (`±(2^53-1)`,
   claves con U+E000 y U+1F600, U+FEFF al inicio de una cadena, U+FFFD, U+2028, `\u0000`, una unidad anidada
   hasta la profundidad 64), y todos los verificadores los aceptan; la matriz de interoperabilidad existente de `dcp-jcs-v1` sigue en verde.
7. **Matriz negativa.** Un defecto de cada clase, inyectado a nivel de bytes en un bundle candidato válido, se
   rechaza con esa clase antes de comprobar las firmas; el mismo defecto en un bundle de `dcp-jcs-v1`
   mantiene el veredicto actual.
8. **Selección, precedencia y política.** Las pruebas de §6 y §7 se ejecutan en todos los SDK, con una comprobación
   instrumentada de que cada verificación usa un perfil y una ruta.
9. **Historia.** Con el nuevo ingreso instalado, la ruta de `dcp-jcs-v1` da en cada SDK el veredicto actual sobre
   los vectores y las suites de conformidad existentes.
10. **Coste.** Medido antes y después, sin relajar nada para compensar.

<a id="10-corpus-and-lab-tool"></a>

## 10. Corpus y herramienta de laboratorio

| Archivo | Contenido |
|---|---|
| [`baseline-corpus.json`](baseline-corpus.json) | 87 casos de un solo defecto (42 de aceptación, 45 de rechazo, 6 de ellos con bytes que no son UTF-8), 10 casos de selección de perfil y 3 de política. Una copia de la revisión 2 aprobada: solo difieren `proposal` y un campo `provenance`. Su `domain.max_depth_scope` conserva la redacción histórica (profundidad sobre toda la entrada, sobre incluido); I4 la sustituye (profundidad desde la raíz de la unidad), como registra `corpus.json` en `scope_revisions`. Ningún caso cambia: todos los casos de referencia son unidades sin sobre |
| [`corpus.json`](corpus.json) | 187 casos de diseño: permutaciones con varios defectos (54), números exactos (20), profundidad con y sin sobre (12), transporte (19) y fases del transporte (12), selección (23), ingreso (3), analizadores históricos (8), política (5), configuración (9), migración (9), y los 10 + 3 casos de selección y política de referencia sobre bundles sintéticos. Hace referencia a los 87 casos de referencia por ID y hash de entrada |
| [`tools/canonicalization-lab/model.py`](../../../tools/canonicalization-lab/model.py) | El modelo de diseño: extracción del transporte, un escáner iterativo de bytes con la precedencia de §6, N4, las reglas de salida, la selección y la política, y una ruta de bundles sintéticos cuyas comprobaciones de hash sustituyen a los hashes de las cargas útiles, la cadena de auditoría y la firma del manifiesto. Su comportamiento ejecutable es el del modelo aprobado (SHA-256 del archivo aprobado `ab172c5f…`); sus docstrings aclaran las rutas públicas y la regla supuesta del último duplicado. Calcula SHA-256 para los compromisos sintéticos y no firma ni verifica nada |
| [`tools/canonicalization-lab/generate_corpus.py`](../../../tools/canonicalization-lab/generate_corpus.py) | Escribe `corpus.json`. Las expectativas se escriben a mano con la regla que aplica cada una (`why`); nunca importa el modelo |
| [`tools/canonicalization-lab/run.py`](../../../tools/canonicalization-lab/run.py) | Comprueba integridad, frescura, validez y cobertura, ejecuta el modelo sobre los 274 casos y ejecuta 24 controles negativos |

**Los casos de bundles** usan un esquema sintético mínimo (manifiesto, `intent`, `audit_entries` y
`signature.manifest_hash`), cuyo `manifest_hash` sustituye a la firma compuesta. Para las unidades que el
escáner no puede recorrer, lo que hace el analizador actual de un SDK es un parámetro de cada caso (`historical`), no una
medición.

**El ejecutor comprueba** el hash de referencia y sus 87 referencias de casos, el hash de entrada de cada caso, que
el corpus se regenera byte a byte, estados y clases válidos, ID únicos (también frente a la referencia),
que no haya entradas repetidas sin declarar, la cobertura de los 20 pares ordenados de la capa de valores, de cada clase y grupo, y
de cada caso de selección y política de referencia. Todo resultado real se valida (estado, clase, formato y
modo) en la ejecución del corpus y en cada control; un fallo del modelo se informa como `MODEL_ERROR`, nunca como un
rechazo.

**Controles negativos** (todos deben detectarse): tres expectativas alteradas; 14 corrupciones de datos, cada una detectada
por su propia regla; un corpus desactualizado; un modelo que falla en todos los casos; cuatro mutantes de diseño (orden de clases
en lugar de desplazamiento, capa de valores antes que la gramática, alternativa a `dcp-jcs-v1`, profundidad sobre el sobre), cada uno
rompiendo exactamente sus propios casos; dos fallos inyectados solo bajo mutación y un mutante que rompe
exactamente los casos esperados con una clase desconocida, que deben invalidar los tres la campaña en lugar
de contar como detectados.

<a id="11-reproduce"></a>

## 11. Reproducir

Python 3.9 o posterior en Linux o macOS (el ejecutor usa `signal.SIGALRM` y `pathlib.Path.is_relative_to`;
Windows no está admitido), solo con la biblioteca estándar. Los comandos se ejecutan desde la raíz de un checkout; desde
cualquier otro directorio, da a los scripts sus rutas absolutas. Las salidas van a un directorio temporal nuevo, así que
no se sobrescribe nada: el ejecutor también rechaza una ruta de salida existente, y el generador escribe
donde se le indique.

```bash
out=$(mktemp -d)
python3 -I tools/canonicalization-lab/generate_corpus.py "$out/corpus.json"
cmp "$out/corpus.json" docs/proposals/canonicalization-candidate/corpus.json
python3 tools/canonicalization-lab/run.py --out "$out/run.json"
python3 tools/canonicalization-lab/run.py --controls --out "$out/controls.json"
```

Resultado esperado: `274/274 cases as expected (87 r2 + 187 design)`, cada control `CAUGHT` y código de salida 0.
El código de salida 1 significa que un caso, un resultado o un control difiere; 2, que los datos son inválidos.

<a id="12-what-this-shows-and-what-it-does-not"></a>

## 12. Qué muestra esto y qué no

| Lo muestra el modelo de diseño | No se ha hecho |
|---|---|
| La precedencia total, con desplazamientos, sobre 54 documentos con varios defectos y 12 sobres con varios defectos | Un cambio de fase o de valor predeterminado: los productores de §18 son experimentales y de activación explícita |
| La unidad, el transporte y la independencia del sobre | Una API de bytes en las integraciones o en el servidor |
| La selección, la política y la ausencia de reintentos, sobre bundles sintéticos | Una prueba de equivalencia de salida sobre todo el dominio (§18.4, puerta 3, se muestra sobre muestras) |
| Que la ruta del candidato no depende de reparaciones del analizador | Lecturas históricas más allá de las unidades medidas: `tests/interop/candidate/phase2-adapter-expectations.json` registra 160 lecturas de decodificadores reales (16 unidades × 10 adaptadores) donde decide el adaptador histórico; es evidencia solo para esas unidades |
| Las comprobaciones de hash del bundle sintético | Una matriz negativa por clase de bundles de `dcp-jcs-v1` (§18.4, puerta 7) |
| | Que la delegación conserve el veredicto de `dcp-jcs-v1` de cada SDK más allá de los casos de §16 y §17 |

<a id="13-open-questions"></a>

## 13. Cuestiones abiertas

- La conservación de los veredictos de `dcp-jcs-v1` depende de que los analizadores históricos lean la ruta del perfil con
  la regla del último duplicado; debe medirse en cada ruta de entrada real del verificador antes de implementarla.
  Un decodificador de construcción tipado no es necesariamente el decodificador que usa un verificador. Para las API de objetos,
  el decodificador de bytes a objeto de quien llama o de la integración forma parte de esa ruta: puede descartar un BOM,
  reparar UTF-8 inválido, perder miembros duplicados o rechazar el cuerpo antes de la verificación. Un adaptador debe conservar esa
  ruta existente de forma explícita; sustituirla por un decodificador común no establece la paridad histórica.
- El contrato de transporte a nivel de bytes cambia el resultado para los sobres ambiguos y necesita su propia
  nota de compatibilidad.
- La continuidad de la cadena de auditoría entre perfiles, el perfil de los artefactos sin manifiesto y A2A quedan
  fuera de este diseño.

<a id="14-references"></a>

## 14. Referencias

- [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259) §4 (nombres únicos), §6 (rango numérico interoperable), §8.1 (BOM), §8.2 (surrogates aislados).
- [RFC 7493](https://www.rfc-editor.org/rfc/rfc7493) (I-JSON) §2.1–§2.3.
- [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) §3.1, §3.2.2 y §3.2.3 (orden de claves por UTF-16, que este perfil no usa).
- [`spec/CANONICALIZATION_PROFILE.md`](../../../spec/CANONICALIZATION_PROFILE.md) (`dcp-jcs-v1`, sin cambios).

<a id="15-experimental-sdk-ingress-phase-1"></a>

## 15. Ingreso experimental en los SDK (fase 1)

La fase 1 del plan de implementación en los SDK (no una fase de §9) añade a cada SDK un ingreso experimental y de activación explícita de una
unidad. No es normativo, y ninguna ruta existente o predeterminada lo llama: solo lo hacen quienes lo activan explícitamente.
No cambia ninguna función, valor predeterminado, firmante ni verificador de `dcp-jcs-v1`. El ingreso en sí no lee el
perfil (lo hace el enrutador de §16) y no emite nada; los productores llegaron en la fase 4 (§18).

| SDK | API |
|---|---|
| TypeScript | `experimentalCandidateIngress(bytes: Uint8Array)`, exportada por `@dcp-ai/sdk` |
| Python | `dcp_ai.v2.experimental_candidate_ingress.experimental_candidate_ingress(data)`, no reexportada por `dcp_ai.v2` |
| Go | `v2.ExperimentalCandidateIngress(input []byte)` |
| Rust | `dcp_ai::v2::experimental_candidate_ingress::experimental_candidate_ingress(&[u8])` |
| WASM | `wasm_experimental_candidate_ingress` en los bindings de Rust, y `DcpWasm.experimentalCandidateIngress(bytes)` en `@dcp-ai/wasm` |

**Qué hace.** Recibe los bytes originales de una unidad y aplica §3.1–§3.3, con la precedencia
y los desplazamientos de §6.1–§6.2. Si acepta, devuelve el valor exacto, sus bytes canónicos (§3.4) y su
SHA-256; el wrapper de WASM devuelve los bytes y el hash, no el valor. Un rechazo es un resultado, con
su clase y su desplazamiento en bytes. Un tipo de argumento erróneo y un error interno se informan aparte, nunca como un
rechazo.

**Qué no hace:**

- extraer una unidad de un transporte (§5, §6.3);
- seleccionar un perfil ni aplicar una política (§6.4 pasos 1, 5 y 6; §7);
- delegar en `dcp-jcs-v1`;
- verificar, firmar ni admitir nada.

**Pruebas.** Cada uno de los cuatro SDK (TypeScript, Python, Go y Rust) ejecuta estos casos contra las
expectativas almacenadas (la clase y el desplazamiento, o el hash canónico):

- las 87 unidades de referencia;
- los 81 casos de documentos sin sobre de `corpus.json`.

Cada uno de los cuatro comprueba además que su canonicalizador de `dcp-jcs-v1` da los mismos bytes sobre cada
valor aceptado, y añade ejemplos específicos: UTF-8 inválido, BOM, duplicados mediante escapes,
`__proto__`, literales numéricos largos y saturados, pares de surrogates, y 20 000 niveles con y sin un
error de gramática tardío.

La prueba de WASM ejecuta el binding real de Rust a través del wrapper `@dcp-ai/wasm` sobre los mismos 168 casos,
comparando clase y desplazamiento o bytes canónicos y hash; no obtiene ningún valor, así que no hace ninguna comparación con
`dcp-jcs-v1`. También comprueba la frontera JS/WASM:

- los bytes llegan a Rust sin cambios (un byte inválido, un BOM, un escape NUL, una vista de un búfer mayor);
- una unidad de 20 000 niveles devuelve resultado;
- un argumento que no es un `Uint8Array` es un `TypeError`.

En todos los SDK, los 77 casos de bundles y los 29 casos de sobres, entre ellos la regla de profundidad obsoleta, corresponden
a fases posteriores: se cuentan, no se ejecutan.

**Puertas.** Esto es evidencia hacia las puertas 1, 3 y 4 de §9 solo para los casos de unidades. No cumple ninguna de las diez
puertas, y el candidato sigue inactivo.

<a id="16-experimental-sdk-router-phase-2"></a>

## 16. Enrutador experimental en los SDK (fase 2)

La fase 2 del plan de implementación en los SDK añade a cada SDK un enrutador experimental y de activación explícita. Extrae la unidad
(§5, §6.3), lee el perfil (§7) y aplica §6.4 hasta la decisión: rechazar, delegar en `dcp-jcs-v1` o
seleccionar la ruta del candidato. No es normativo, y ninguna ruta existente o predeterminada lo llama: solo lo hacen quienes
lo activan explícitamente. `dcp-jcs-v1`, sus verificadores y todos los valores predeterminados no cambian. `candidate` nunca es una aceptación: la verificaría la fase 3. Nada verifica ni firma
un candidato.

| SDK | API |
|---|---|
| TypeScript | `createExperimentalCandidateRouter(config).route(bytes)`, `experimentalCandidateExtractUnit`, `experimentalHistoricalAdapters` |
| Python | `dcp_ai.v2.experimental_candidate_router`: `create_router`, `extract_unit`, `JSON_LOADS_BYTES`, `JSON_LOADS_STRICT_DECODE` |
| Go | `NewExperimentalCandidateRouter(cfg)` y `Route`, `ExperimentalCandidateExtractUnit`, `ExperimentalHistoricalEncodingJSON` |
| Rust | `v2::experimental_candidate_router`: `CandidateRouter::new` y `route`, `extract_unit`, `HistoricalAdapter::serde_json_from_slice` |
| WASM | `DcpWasm.createExperimentalCandidateRouter` sobre los bindings `wasm_experimental_candidate_route` y `_resume`, y `experimentalWasmHistoricalAdapters` |

**Configuración.** El transporte (`bare` o `envelope`), los perfiles aceptados y el adaptador histórico
son obligatorios; ninguno tiene valor predeterminado.

- Se validan con tipos estrictos cuando se crea el enrutador, antes de cualquier entrada.
- Una configuración inválida es un error de configuración (`POLICY_INVALID` o `CONFIG_INVALID`), nunca un
  rechazo de los datos.
- El enrutador guarda una instantánea privada, así que los cambios posteriores en los objetos de quien llama no cambian nada.

**Resultados.**

- **`reject`:** la clase (una clase de transporte, una clase del escáner, `PROFILE_UNKNOWN` o `PROFILE_NOT_ACCEPTED`)
  y sus desplazamientos. `offset` es relativo a la unidad; `transport_offset` está en la entrada.
- **`v1_path`:** la unidad, el aviso (D7) y lo que devolvió el adaptador histórico.
  - Su perfil es siempre `dcp-jcs-v1`: un manifiesto sin el campo se produjo bajo `dcp-jcs-v1`.
  - `profile_source` dice por qué: `field`, `absent` o `historical` para una unidad que el escáner no puede recorrer.
- **`candidate`:** la unidad, su valor y sus bytes canónicos. El wrapper de WASM devuelve los bytes canónicos
  y su hash pero no el valor, como en la fase 1.

Los nombres son equivalentes entre SDK en el estilo de cada lenguaje: `profileSource`, `transportOffset` y
`canonicalSha256` en TypeScript y en el wrapper de WASM; `profile_source`, `transport_offset` y
`canonical_sha256` en Python, Rust y los bindings de WASM; `ProfileSource`, `TransportOffset` y
`CanonicalSHA256` en Go.

**Adaptadores históricos.** Un adaptador reproduce un decodificador real, y el enrutador lo consulta como máximo una vez, solo
donde §6.4 lo necesita:

- para decidir sobre una unidad que el escáner no puede recorrer;
- para producir el valor de una delegación.

Su lectura nunca selecciona el candidato, y su resultado es lo que devolvió el decodificador real, sin sanear con
las reglas del candidato: NaN, los infinitos y los surrogates aislados se conservan solo donde ese decodificador los conserva.
`json.loads` acepta NaN y 1e999, `JSON.parse` da Infinity para 1e999, y ambos conservan los surrogates aislados.
`encoding/json` y `serde_json` rechazan 1e999. En la ruta `w1` de WASM, `JSON.stringify` convierte Infinity en
`null` y vuelve a escapar los surrogates aislados, que `serde_json` rechaza después. Un adaptador que falla de otra forma
que rechazando los datos es un error del adaptador, no un rechazo.

El wrapper de WASM reproduce dos rutas distintas, medidas por separado y sin suponerlas equivalentes:

- **`w1`:** un objeto, a través de `JSON.stringify`, hacia Rust;
- **`w2`:** un texto hacia el binding.

Sus bindings no tienen estado. `resume` recalcula el punto de decisión a partir de sus propios argumentos y solo puede terminar
en un rechazo o en una delegación.

**Pruebas.** Cada SDK y WASM ejecutan estos casos:

- los 9 casos de configuración;
- los 28 casos de sobres de documentos;
- los 58 casos de bundles recorribles, donde `accept_v2` y `COMMITMENT_MISMATCH` se comprueban solo como `candidate`;
- el fixture público `tests/interop/candidate/phase2-adapter-expectations.json`. Para las 9 unidades que el escáner
  no puede recorrer y 7 unidades sintéticas, registra lo que devuelve cada decodificador real, medido ejecutándolo; el
  parámetro `historical` del corpus no se usa como evidencia.

También comprueban:

- una paridad v1 sin diferencias: sin sobre, `["dcp-jcs-v1"]`, cada adaptador integrado, sobre los bundles
  firmados públicos y las variantes generadas a partir de ellos;
- el recorredor de la gramática frente al escáner de la fase 1;
- la pereza, el contrato del adaptador y la propiedad de los bytes.

**Puertas.** Esto es evidencia hacia las puertas 1, 8 y 9 de §9, solo para la selección y la delegación. No cumple ninguna de las diez
puertas, y el candidato sigue inactivo.

<a id="17-experimental-sdk-verifier-phase-3"></a>

## 17. Verificador experimental en los SDK (fase 3)

La fase 3 del plan de implementación en los SDK añade a cada SDK un verificador experimental y de activación explícita de bytes originales.
Enruta los bytes una vez con el enrutador de §16 y ejecuta como máximo un verificador:

- ninguno para un rechazo;
- para `v1_path`, el verificador V2 actual, sobre exactamente lo que le entregaría un llamador actual;
- para `candidate`, el verificador V2 actual, aceptando exactamente `dcp-jcs-v2` en el manifiesto.

No hay un segundo intento bajo otro perfil. No es normativo, y ninguna ruta existente o predeterminada lo
llama. `dcp-jcs-v1`, los verificadores existentes y sus valores predeterminados no cambian, y sus API de objetos y de texto
siguen rechazando `dcp-jcs-v2`. Los productores llegaron en la fase 4 (§18); los vectores de abajo los firma un generador
exclusivo de pruebas. Un bundle candidato verificado no concede confianza ni
admisión y no autoriza nada.

| SDK | API |
|---|---|
| TypeScript | `createExperimentalCandidateVerifier(config).verify(bytes, registry, policy?, options?)` |
| Python | `dcp_ai.v2.experimental_candidate_verify`: `create_verifier(...)` y `await verifier.verify(data, registry, policy=None, now_ms=None)` |
| Go | `NewExperimentalCandidateVerifier(ExperimentalCandidateVerifierConfig)` y `VerifyAt(registry, input, policy, now)` |
| Rust | `v2::experimental_candidate_verify`: `CandidateVerifier::new(config)` y `verify_at(input, policy, now_ms)` |
| WASM | `DcpWasm.createExperimentalCandidateVerifier(config).verify(bytes, policy?)`, sobre el binding `wasm_experimental_candidate_verify` |

**Configuración y parámetros.** La configuración es la del enrutador (§16): el transporte, los perfiles
aceptados y el adaptador histórico, todos obligatorios y ninguno con valor predeterminado.

- Go nombra su adaptador con el nombre cerrado `encoding_json` y construye él mismo ese decodificador, así que cambiar la
  `ExperimentalHistoricalEncodingJSON` exportada no cambia nada.
- Los parámetros de verificación son los del verificador V2 de cada SDK, con los mismos valores predeterminados, incluida la
  política criptográfica opcional.

**Resultado.** La ruta, `entered` (`none`, `dcp-jcs-v1` o `dcp-jcs-v2`) y el resultado del verificador tal cual, que
es `null` cuando no se ejecutó ninguno. `entered` nombra la ruta de verificación que se inició, incluida su validación de
política. No demuestra que se ejecutara ninguna comprobación criptográfica: un verificador puede detenerse antes en una comprobación de política, estructura,
hash o sesión, y su resultado lo indica.

**La ruta del candidato.** Es el verificador actual con un cambio, el perfil de manifiesto que acepta; cada hash,
firma y ayuda es la actual. Sobre los valores exactos que acepta el candidato, el canonicalizador de `dcp-jcs-v1`
da los bytes del candidato (§3.4).

- TypeScript, Python y Rust verifican el valor exacto.
- Go verifica los bytes canónicos del candidato, así que su analizador nunca lee un literal que el candidato normalizó.

**Delegación.** Entrega al verificador actual exactamente la entrada que le da un llamador actual.

- **TypeScript, Python y Rust:** el valor que decodificó el adaptador.
  - Un `null` decodificado son datos, y se delega.
  - Cuando el decodificador rechazó los datos no hay valor, y no se ejecuta nada (`entered: none`).
- **Go:** los bytes de la unidad van a `VerifySignedBundleV2At`, que los analiza él mismo.
- **WASM:** una llamada a `wasm_experimental_candidate_verify`.
  - Cuando necesita el decodificador, se le consulta una vez, y `resume`, que nunca verifica, termina en un
    rechazo o en una delegación.
  - Una delegación entrega la cadena propia del decodificador a `wasm_verify_signed_bundle_v2`, con el JSON de política
    que envía `verifyBundle`: en `w1`, `JSON.stringify` del objeto decodificado; en `w2`, el texto.
  - Un decodificador que rechazó no deja ninguna cadena.
  - El binding mantiene su comportamiento V1: un bundle V1 se verifica sin política y se rechaza con una.

**Vectores.** [`tests/interop/candidate/phase3-signed-vectors.json`](../../../tests/interop/candidate/phase3-signed-vectors.json)
tiene 18 bases congeladas y 57 casos.

- **Bases:** 16 bundles firmados, el bundle de conformidad V1 y `null`.
  - 15 los firma un generador exclusivo de pruebas del SDK de TypeScript (no una API de producción).
  - La 16.ª es `B-reordered`: el mismo bundle firmado que `B-v2`, con sus miembros en orden inverso y
    espacios en blanco.
- **Casos:** un caso es una base más ediciones de bytes.
- **Expectativas:** escritas a mano: la ruta, las llamadas al adaptador, `entered`, el veredicto y las subcadenas de error
  de cada SDK, con sobrescrituras por adaptador donde los decodificadores difieren.

| Grupo | Casos |
|---|---|
| Positivos | 16: híbridos y solo clásicos; enteros escritos como `1.0`, `1e2`, `-0` y 1 seguido de 800, 801 o 5000 ceros decimales; ±(2^53-1); escapes; orden de miembros y espacios en blanco; profundidad 64; un perfil señuelo fuera del manifiesto; una cadena nueva junto a una referencia v1; un checkpoint PQ; claves llamadas `__proto__` |
| Rechazos antes de cualquier verificador | 17 |
| Fallos del candidato | 14, cada uno en el paso que nombra |
| Delegaciones | 10 |

El `--check` del generador valida dos cosas: las bases congeladas (sus hashes, los hashes de las cargas útiles y del manifiesto,
y el perfil declarado), y cada caso y cada expectativa. La prueba de TypeScript verifica las 81 firmas de las
16 bases firmadas con las primitivas compuestas, incluidas las bases semánticamente inválidas.

**Pruebas.** Cada SDK y WASM ejecutan:

- antes de cualquier caso, una comprobación de que los vectores contienen exactamente los 57 ID de casos aprobados, cada uno una vez; un ID
  ausente, repetido o desconocido la hace fallar;
- los 57 casos, con cada adaptador integrado;
- la paridad de cada delegación con una llamada directa;
- una comprobación instrumentada de que se ejecuta como máximo un verificador. Usa una sonda exclusiva de pruebas o bindings contados; ninguna
  API pública omite la verificación;
- los bytes canónicos de cada valor comprometido de los positivos: la unidad, el manifiesto, las cuatro cargas útiles,
  las entradas de auditoría y los checkpoints. El ingreso del candidato acepta los bytes canónicos de `dcp-jcs-v1` de
  cada uno, con el mismo valor exacto y los mismos bytes;
- la configuración;
- búferes mutados;
- que las API actuales siguen rechazando `dcp-jcs-v2`.

**Frente al modelo de diseño.**

| Modelo de diseño | Fase 3 |
|---|---|
| `accept_v2` | Una ruta de candidato con `verified: true` y el hash real del manifiesto |
| `COMMITMENT_MISMATCH` | `verified: false`, con los errores propios del verificador. Puede informar de varios, y su orden no es normativo |
| Rechazos | Las rutas de §16 |
| Una delegación | Registra el veredicto actual, que el modelo no calcula |
| — | Fallos criptográficos (firmas, política, validez de las claves, sesión y checkpoints): expectativas nuevas, sin equivalente en el modelo |

**Puertas.** En la fase 3 no se declaró cumplida ninguna de las diez puertas de §9; el registro es §18.4, y el candidato
sigue inactivo.

- **Evidencia hacia:**
  - la puerta 1: los casos de bundles sintéticos, reexpresados como bundles firmados reales;
  - la puerta 3: sobre los valores comprometidos de los positivos;
  - la puerta 7: los defectos inyectados en un bundle candidato firmado se rechazan antes de cualquier verificador, y en un
    bundle de `dcp-jcs-v1` el veredicto delegado es el actual;
  - la puerta 8: un verificador, instrumentado.
- **No cumplidas:**
  - la puerta 6, la matriz cruzada de firma, que necesita productores; todos los bundles firmados aquí vienen de un único generador
    de pruebas;
  - las puertas 2, 9 y 10, que necesitan sus propias ejecuciones.

<a id="18-experimental-sdk-producers-phase-4"></a>

## 18. Productores experimentales en los SDK (fase 4)

La fase 4 del plan de implementación en los SDK añade productores experimentales y de activación explícita a cada SDK y a WASM.
Generan evidencia **nueva**: artefactos firmados como los actuales, y bundles cuyo manifiesto nuevo firma
`canonicalization_profile: "dcp-jcs-v2"`. No es normativo, y ninguna ruta existente o predeterminada los llama.
`dcp-jcs-v1`, sus constructores, firmantes y verificadores, y todos los valores predeterminados no cambian; el perfil sigue
experimental y opt-in, también en npm SDK 2.2.0 y WASM 2.1.0. Un bundle que producen no concede confianza ni admisión y no autoriza nada.

| SDK | API |
|---|---|
| TypeScript | `experimentalCandidateSignPayload(registry, context, input, keys)` y `experimentalCandidateSignBundle(registry, parts, signer, options)` |
| Python | `dcp_ai.v2.experimental_candidate_produce`: `sign_payload(registry, context, input, keys)` y `sign_bundle(registry, parts, signer, options)`, que comprueban y copian en la llamada y devuelven un awaitable |
| Go | `ExperimentalCandidateSignPayload(registry, context, input, keys)` y `ExperimentalCandidateSignBundle(registry, parts, signer, options)`, con las entradas `ExperimentalCandidateBytes` y `ExperimentalCandidateHostValue` |
| Rust | `v2::experimental_candidate_produce`: `sign_payload(context, input, keys)` y `sign_bundle(parts, signer, options)`, con `CandidateInput::{Bytes, Value}` |
| WASM | `DcpWasm.experimentalCandidateSignPayload(context, input, keys)` y `experimentalCandidateSignBundle(parts, signer, options)`, sobre los bindings `wasm_experimental_candidate_sign_payload` y `wasm_experimental_candidate_sign_bundle`, que solo reciben bytes |

**Entradas.** Cada pieza es una de estas:

- **bytes:** los bytes originales, comprobados por el ingreso de la fase 1 (§15) antes de que nada los analice. Es la
  vía para el JSON recibido de otra parte: solo los bytes conservan lo que un analizador repara o pierde;
- **un valor del anfitrión:** comprobado mediante un recorrido estricto sobre los tipos exactos del lenguaje y codificado tras la comprobación.
  Un valor no puede mostrar el literal del que se analizó, así que no se puede detectar un valor ya reparado por un analizador.

Los valores del anfitrión fuera del dominio se rechazan con `NUMBER_NOT_FINITE`, `NUMBER_NOT_INTEGER`,
`NUMBER_OUT_OF_RANGE`, `SURROGATE_UNPAIRED`, `UTF8_INVALID` (Go), `DEPTH_EXCEEDED`, `TYPE_UNSUPPORTED` o
`KEY_NOT_STRING` (Python). Los float enteros, `-0` y, en TypeScript y WASM, BigInt se normalizan al
entero. Los getters y `toJSON` nunca se invocan. Los structs y los tipos ajenos se rechazan, nunca se convierten.

**`signPayload`** firma un artefacto, `{payload, payload_hash, composite_sig}`, bajo un contexto de DCP y sin
perfil. La carga útil tiene como máximo 63 niveles, para que el artefacto tenga como máximo 64. El ingreso acepta los
bytes de salida y los devuelve sin cambios.

**`signBundle`** monta el bundle sobre valores exactos. Las partes son artefactos, entradas de auditoría y checkpoints PQ
opcionales, cada uno como bytes o como valor.

- Los miembros que no conoce se conservan. Los que están fuera de una carga útil, una entrada, un checkpoint o el manifiesto no se
  firman, así que no se afirma su integridad.
- La evidencia recibida nunca se reetiqueta ni se recalcula. Un artefacto cuyo `payload_hash` no es el de su carga útil
  se rechaza (`COMMITMENT_MISMATCH`), y la cadena debe empezar en `GENESIS` y enlazar (`CHAIN_NOT_GENESIS`,
  `CHAIN_BREAK`).
- El firmante debe ser el principal responsable (`SIGNER_MISMATCH`).
- El inicio de la sesión nunca se toma del reloj. Con una caducidad, `session_issued_at` es obligatorio
  (`SESSION_ISSUED_AT_REQUIRED`), y las fechas deben ser válidas (`SESSION_INVALID`).
- Un registro de auditoría vacío da `audit_count: 0` y raíces de 64 ceros.
- `dualHash` (desactivado por defecto) añade la raíz SHA3-256 y `hash_alg: sha256+sha3-256`.
- `created_at` está fuera de todas las firmas y no está protegido.
- Se comprueba que toda la unidad tiene como máximo 64 niveles antes de cualquier firma.
- El enrutador de §16 enruta la salida como `candidate`, con `canonical_sha256` igual al SHA-256 de los
  bytes de salida.

**Errores.** Un rechazo de este contrato lleva su clase, la parte y un JSON Pointer o un desplazamiento en bytes, y se
lanza antes de llamar a ningún firmante (las pruebas cuentan cero llamadas al firmante). Un mal uso de la API es un error de uso:
`TypeError`, `ErrExperimentalCandidateUsage` o `ProduceError::Usage`. Los errores de la clave, del registro o del
proveedor siguen siendo los actuales.

**Frente a los constructores actuales.** Son API nuevas, no opciones de los constructores de `dcp-jcs-v1`, y difieren
a propósito: fechas explícitas, el mismo valor predeterminado de `dualHash` en todas partes (los constructores v1 de Go, Rust y WASM añaden la
raíz secundaria por defecto) y montaje sobre valores exactos.

<a id="181-cross-matrix-testsinteropcandidatephase4"></a>

### 18.1 Matriz cruzada (`tests/interop/candidate/phase4/`)

Cinco productores (TypeScript, Python, Go, Rust y WASM) firman los mismos bytes de entrada con sus API públicas de activación explícita.
Cada consumidor verifica cada salida con el verificador de §17. El ejecutor y sus especificaciones están en
[`tests/interop/candidate/phase4/`](../../../tests/interop/candidate/phase4/); las claves sintéticas se generan en cada
ejecución y nunca se escriben fuera del directorio de la ejecución.

- **Positivos:** 12 especificaciones (`S01`–`S12`) en los modos bytes y value, más un anillo: `S01` montado a partir de los
  artefactos que firmó el productor siguiente. Eso hace 115 unidades, cada una verificada por 5 consumidores: 575 resultados.
  Cubren:
  - firma híbrida y solo clásica, un doble hash, un checkpoint PQ;
  - ±(2^53−1);
  - claves con U+E000 y U+1F600;
  - U+FEFF al inicio de una cadena, U+FFFD, U+2028 y `\u0000`;
  - profundidad 64;
  - miembros de extensión sin firmar;
  - miembros llamados `__proto__`, `constructor` y `toJSON`;
  - enteros escritos con 800 y 5000 ceros decimales (bytes);
  - `1.0` y `-0.0` (valores).
- **Negativos:** 16 ediciones a nivel de bytes de la salida recién generada de cada productor, verificadas por cada consumidor: 400 resultados.
  - Antes de cualquier verificador: un BOM, UTF-8 inválido, un error de sintaxis, un surrogate aislado, un duplicado, una fracción, un
    número fuera de rango, profundidad 65, errores de transporte, un perfil desconocido y un perfil no aceptado.
  - En la ruta del candidato, que falla allí: una carga útil cambiada, un manifiesto cambiado y una firma clásica o
    PQ invertida.
- **Comprobaciones del ejecutor:**
  - el conjunto exacto de 975 resultados, pasos y campos;
  - la frescura: ID de ejecución, fechas y horas de los archivos;
  - las llamadas al decodificador que observó cada consumidor (1 para BOM, UTF-8 y sintaxis, 0 en los demás casos);
  - para cada especificación, el mismo `manifest_hash` de todos los productores, y la misma unidad salvo los
    valores de las firmas ML-DSA (aleatorizados), enmascarados solo en sus posiciones conocidas;
  - los mismos ID de clave derivados por todos los SDK;
  - un plazo que mata todo el grupo de procesos;
  - `--self-test` comprueba cada uno de estos rechazos.

<a id="182-host-values-gate-2"></a>

### 18.2 Valores del anfitrión (puerta 2)

Cada ID del corpus se clasifica por lenguaje como:

- **R:** representado exactamente, con la clase de los bytes;
- **T:** representado solo como un valor ya transformado, cuya clase puede cambiar;
- **P:** rechazado antes por el analizador;
- **N:** no representable.

Cada celda R y T se prueba en su SDK; P y N se documentan. La marca `needs_original_bytes: false`
solo significa que un analizador ya puede rechazar el caso.

| ID | Bytes | TS / WASM | Python | Go | Rust |
|---|---|---|---|---|---|
| `n-two53`, `n-1e20`, `n-1e21`, `n-fraction`, `s-depth-65`, `s-depth-129` | como en el corpus | R | R | R | R (profundidades construidas directamente) |
| `n-two53-plus-one`, `n-neg-two53-plus-one`, `n-int64-max`, `n-sci-over` | `NUMBER_OUT_OF_RANGE` | R con BigInt; T con number (redondeado, sigue fuera de rango) | R (int) | R (int64) | R (i64) |
| `n-overflow` (`1e400`) | `NUMBER_OUT_OF_RANGE` | R con BigInt; T con number (`Infinity`: `NUMBER_NOT_FINITE`) | R (int); T con float (`inf`) | N como entero; R como el literal `json.Number`; T con float64 (`+Inf`) | N |
| `n-huge-exponent` (un exponente de 5000 dígitos) | `NUMBER_OUT_OF_RANGE` | N como entero (no puede materializarse); T (`Infinity`) | N; T (`inf`) | R como el literal `json.Number`, rechazado sin construir el número; T (`+Inf`) | N |
| `n-nan`, `n-negative-infinity` | `SYNTAX` | T (`NUMBER_NOT_FINITE`) | T | T | N |
| 9 ID de sintaxis (cero inicial, signo más, punto suelto, control sin escapar, coma o datos finales, dos valores, entrada vacía, NBSP) | `SYNTAX` | P | P | P | P |

Las celdas T de `n-huge-exponent` usan un literal más corto (`1e99999`) que un analizador también convierte en un infinito.
Los 22 casos marcados `true` quedan fuera del alcance de los valores; para ellos, la vía son los bytes.

<a id="183-cost-gate-10"></a>

### 18.3 Coste (puerta 10)

El coste se mide sobre un par equivalente por plataforma. Ambos lados usan las mismas claves, cargas útiles, sesión y
entradas de auditoría, y el ejecutor lo comprueba en las salidas antes de medir: los mismos cuatro `payload_hash`, el
mismo nonce y las mismas fechas de sesión, y las mismas entradas. El bundle v1 sale del constructor y del firmante de cada SDK, el
candidato del productor.

Cada operación se ejecuta 20 veces tras 3 de calentamiento, con como máximo 60 s por plataforma, y las compilaciones se cronometran
aparte. Ejecútalo con `node tests/interop/candidate/phase4/run.mjs --cost`. Medianas en ms, de una ejecución en una
máquina (Apple M5 Pro; Node 22.15, Python 3.12, Go 1.26, Rust 1.93 release):

| Plataforma | Producir v1 | Producir candidato | Verificar hoy | Verificar v1 (`v1_path`) | Verificar candidato |
|---|---|---|---|---|---|
| TypeScript | 40.3 | 48.1 | 20.2 | 20.7 | 32.0 |
| Python | 22.8 | 27.6 | 3.5 | 7.7 | 7.7 |
| Go | 3.2 | 7.0 | 2.1 | 2.9 | 2.5 |
| Rust | 2.3 | 3.0 | 0.7 | 0.9 | 0.8 |
| WASM | 4.1 | 4.8 | 1.5 | 2.1 | 1.4 |

**Límites.** Estos tiempos no son una medida de la canonicalización por sí sola, y no muestran ni una mejora
ni una regresión:

- **Las salidas difieren.** Los bytes v1 son la serialización JSON de cada SDK (la de Python lleva espacios), mientras que los del
  candidato son canónicos.
- **Los constructores difieren.** Los constructores v1 de Go, Rust y WASM añaden la raíz secundaria, y el candidato aquí
  no.
- **Las entradas de Go.** El constructor v1 recibe entradas tipadas, así que su `AuditEvidenceV2` descarta los miembros nulos. Ambos
  lados del par de Go firman las mismas entradas, reconstruidas a través de él.
- **Qué incluye «Verificar hoy».** Incluye decodificar los bytes donde la API recibe un objeto o un valor
  (`JSON.parse`, `json.loads`, `serde_json::from_slice`). La API de Go recibe bytes y los analiza ella misma.
- **Variabilidad.** Las medianas variaron entre ejecuciones en la misma máquina. Por ejemplo, la verificación del candidato
  en TypeScript dio unos 22 ms en una ejecución anterior.

No hay ningún SLA, y no se relajó nada para compensar.

<a id="184-ledger-of-the-ten-gates-9"></a>

### 18.4 Registro de las diez puertas (§9)

Este registro recoge evidencia; no activa nada. Un cambio de fase o de valor predeterminado necesita su propia decisión.

| # | Puerta | Estado | Evidencia | Límites |
|---|---|---|---|---|
| 1 | Paridad del corpus | Cumplida | §15: las 87 unidades de referencia y los 81 casos de diseño sin sobre en cuatro SDK, y los mismos 168 casos en WASM. §17: los casos de bundles sintéticos como bundles firmados reales. §16: lecturas reales de decodificadores en lugar del parámetro `historical` | Los casos de la regla de profundidad de v0.3 demuestran el modelo y no son requisitos |
| 2 | Alcance de la API de objetos | Cumplida, con el alcance de §18.2 | §18.2: cada celda R y T probada por lenguaje, cada una rechazada con su clase antes de firmar. TypeScript, Python, Go y WASM cuentan cero llamadas al firmante por celda. Las celdas de Rust usan claves que no pueden firmar, así que una llamada al firmante aparecería en su lugar como un error del proveedor; sus cero llamadas contadas están en sus pruebas unitarias específicas | Los 22 casos marcados `true` y las celdas P y N quedan fuera del alcance de los valores |
| 3 | Equivalencia de salida sobre valores | Cumplida, sobre muestras | §15: la comparación con `dcp-jcs-v1` sobre los valores aceptados. §17: los valores comprometidos de los positivos. §18.1: 115 unidades iguales entre cinco productores. §18.3: los mismos hashes de cargas útiles del firmante v1 y del productor | Mostrada sobre el corpus, los vectores y la matriz, no demostrada sobre todo el dominio |
| 4 | Paridad del ingreso desde bytes | Cumplida | §15, en cuatro SDK y WASM | Casos de unidades |
| 5 | Lecturas históricas | No es una puerta | §16 las registra como diagnósticos | — |
| 6 | Matriz cruzada de firma | Cumplida | §18.1: 5 × 5 más el anillo, 975 de 975 resultados, con todas las cargas útiles de frontera de la puerta. La matriz de interoperabilidad de `dcp-jcs-v1` (`tools/interop-matrix`, ambos escenarios) pasa al cierre | Ejecuciones locales en una máquina; el workflow la vuelve a ejecutar en cada cambio |
| 7 | Matriz negativa | Parcial | §18.1: todas las clases del corpus, y las clases de transporte y de perfil, rechazadas antes de cualquier verificador, 5 × 5. Fallos del candidato en la ruta del candidato. §17: las delegaciones de bundles de `dcp-jcs-v1` mantienen el veredicto actual | El lado de `dcp-jcs-v1` se apoya en las delegaciones de §17 y en las lecturas de §16; aquí no se repitió por clase |
| 8 | Selección, precedencia y política | Cumplida | §16 y §17, con un verificador instrumentado | — |
| 9 | Historia | Cumplida | Al cierre, con el código nuevo en su sitio: conformidad (V1 y V2, con los casos de admisión), la suite de pruebas completa de cada SDK, las pruebas de WASM (incluidos los vectores de bundles y la verificación V1) y las matrices de interoperabilidad y de admisión de `dcp-jcs-v1`, todo en verde. No se repitió ninguna campaña de las fases 1 a 3 | Ejecuciones locales en una máquina |
| 10 | Coste | Cumplida | §18.3 | Una máquina, sin SLA, los límites de §18.3 |
