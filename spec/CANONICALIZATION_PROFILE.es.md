<sub>[English](CANONICALIZATION_PROFILE.md) · [中文](CANONICALIZATION_PROFILE.zh-CN.md) · **Español** · [日本語](CANONICALIZATION_PROFILE.ja.md) · [Português](CANONICALIZATION_PROFILE.pt-BR.md)</sub>

<a id="dcp-ai-canonicalization-profile"></a>

# Perfil de canonicalización de DCP-AI

> Traducción informativa de [la especificación en inglés](CANONICALIZATION_PROFILE.md), actualizada el 25/10/2026. **La versión normativa es la inglesa**: esta traducción no tiene valor normativo y, si difieren, prevalece el inglés. Los identificadores y bloques de código se conservan sin traducir.

**Identificador del perfil:** `dcp-jcs-v1`
**Estado:** Publicado — v2.0
**Incluido por primera vez en:** Python 2.8.0, Rust 2.8.0, Go v2.8.0, TypeScript 2.1.0

Este documento es la referencia normativa de la canonicalización JSON
exacta byte a byte en DCP-AI. Sustituye el resumen de cinco viñetas que
aparecía en `spec/DCP-AI-v2.0.md` § 15. Cada firma, cada hash y
cada hoja de Merkle de un artefacto de DCP se calculan sobre la salida del
algoritmo especificado aquí.

El perfil está **basado en RFC 8785 (JCS)**. Restringe los números a
enteros (regla 4) y da un tratamiento explícito a los casos que JCS deja
definidos por la implementación. No es un subconjunto estricto de JCS: la regla 1 ordena
las claves de los objetos por punto de código Unicode, mientras que RFC 8785 §3.2.3 las ordena por
unidades de código UTF-16. Los dos órdenes solo difieren cuando las claves de un objeto mezclan
caracteres del plano suplementario (U+10000 en adelante) con caracteres de
U+E000..U+FFFF. Los SDK que afirman cumplir el perfil deben (MUST) producir
una salida idéntica byte a byte para la tabla de casos límite de §3.

---

<a id="1-why-a-profile-and-not-just-jcs"></a>

## 1. Por qué un perfil y no simplemente «JCS»

RFC 8785 fija las reglas estructurales —claves ordenadas, forma compacta, escapado
de cadenas, representación de números— pero deja algunas decisiones al
lenguaje anfitrión del productor: cómo se trata `undefined`, qué ocurre con los
float que resultan tener valor entero, si se normaliza `1e2`,
cómo se asignan a JSON `null` los tipos del anfitrión equivalentes a `null`. En cuatro SDK
(TypeScript, Python, Rust, Go) esos valores predeterminados divergen y producen
bytes distintos para el mismo objeto de origen. `dcp-jcs-v1` fija cada una de
esas decisiones para que los cuatro SDK produzcan una salida idéntica.

---

<a id="2-normative-rules"></a>

## 2. Reglas normativas

Un productor que implementa `dcp-jcs-v1` debe (MUST) respetar las reglas 1 a 8.
Un verificador que consume `dcp-jcs-v1` debería (SHOULD) rechazar los artefactos cuya
salida se aparta de estas reglas.

<a id="rule-1--sorted-keys"></a>
<a id="rule-1-sorted-keys"></a>

### Regla 1 — Claves ordenadas

Las claves de los objetos se ordenan lexicográficamente por punto de código Unicode en
orden ascendente. El orden se aplica a todos los niveles de anidamiento.

```
input    → {"z": 1, "a": 2, "é": 3, "e": 4}
output   → {"a":2,"e":4,"z":1,"é":3}
```

<a id="rule-2--compact-form"></a>
<a id="rule-2-compact-form"></a>

### Regla 2 — Forma compacta

Sin espacios en blanco fuera de los valores de cadena. El separador de pares es `,`,
el separador entre clave y valor es `:`. Sin comas finales.

<a id="rule-3--string-escaping"></a>
<a id="rule-3-string-escaping"></a>

### Regla 3 — Escapado de cadenas

Las cadenas se codifican en UTF-8. El escapado sigue RFC 8785 §3.2: solo se escapan los
caracteres que JSON exige escapar (caracteres de control U+0000
a U+001F, `"`, `\`). La barra, los caracteres
no ASCII, los emoji, los kanji, etc. se emiten tal cual como su secuencia de bytes
UTF-8.

```
input    → {"emoji": "🔑", "kanji": "鍵"}
output   → {"emoji":"🔑","kanji":"鍵"}
```

<a id="rule-4--numeric-values-integer-only"></a>
<a id="rule-4-numeric-values-integer-only"></a>

### Regla 4 — Valores numéricos: solo enteros

El formato de intercambio solo acepta números cuyo valor es un entero exacto.
«Entero exacto» se decide **después del análisis**:

- Un `Number` JSON es válido si y solo si (a) es finito y (b) su valor no tiene
  parte fraccionaria (`floor(n) == n`).
- Un `Number` cuyo literal de origen era `1.0`, `1.00`, `1e2`, `100` o
  `-0` es válido porque todos esos literales se decodifican a un valor entero
  tras el análisis.
- Un `Number` cuyo valor es `0.1`, `1.5`, `1e-1`, `NaN` o `±Infinity`
  no es válido y el canonicalizador debe (MUST) lanzar un error antes de producir ninguna
  salida.

Normalización de la salida: todo número válido se emite en forma de entero simple,
sin punto decimal, sin exponente, sin ceros a la izquierda (salvo
`0`) y sin ceros finales.

```
{"n": 1.0}    → {"n":1}
{"n": 1e2}    → {"n":100}
{"n": -0}     → {"n":0}
{"n": 0.1}    → ERROR
{"n": NaN}    → ERROR
```

Esta regla es lo que hace converger a los cuatro SDK: un productor de JavaScript
puede pasar `1.0` como literal (no tiene tipo entero), un productor de Python
puede pasar `int(100)`, un productor de Go puede pasar `1e2` analizado desde
JSON, y los cuatro emiten los mismos bytes.

<a id="rule-5--null-preservation"></a>
<a id="rule-5-null-preservation"></a>

### Regla 5 — Conservación de null

Un valor JSON `null` debe (MUST) conservarse con su clave:

```
input    → {"x": null, "y": 1}
output   → {"x":null,"y":1}
```

Un null dentro de un array conserva su posición:

```
input    → [1, null, 3]
output   → [1,null,3]
```

<a id="rule-6--null-and-undefined-handling-cross-language"></a>
<a id="rule-6-null-and-undefined-handling-cross-language"></a>

### Regla 6 — Tratamiento de null y undefined (entre lenguajes)

JSON tiene un único canal de valor ausente (`null`). Los lenguajes anfitriones tienen más.
TypeScript es el único lenguaje anfitrión que distingue `undefined`
de `null`; Python, Go y Rust no. El canonicalizador debe (MUST) tratar
cada valor del anfitrión así:

| Lenguaje anfitrión | Valor del anfitrión                                 | En una clave de objeto | En una posición de array |
|---------------|-----------------------------------------------------|------------------|------------------|
| TypeScript    | `undefined`                                         | **omitir la clave** | emitir `null`      |
| TypeScript    | `null`                                              | emitir `null`      | emitir `null`      |
| Python        | clave ausente                                       | **omitir la clave** | n/a              |
| Python        | `None`                                              | emitir `null`      | emitir `null`      |
| Go            | entrada de mapa ausente                             | **omitir la clave** | n/a              |
| Go            | interfaz `nil` / null JSON explícito                | emitir `null`      | emitir `null`      |
| Rust          | campo de struct ausente con `skip_serializing_if=None` | **omitir la clave** | n/a              |
| Rust          | `Option::None` serializado sin skip                 | emitir `null`      | emitir `null`      |
| Rust          | `Value::Null`                                       | emitir `null`      | emitir `null`      |

```
input    → { a: 1, b: undefined, c: 3 }   (TS)
output   → {"a":1,"c":3}

input    → [1, undefined, 3]              (TS)
output   → [1,null,3]

input    → {"a": 1, "b": None, "c": 3}    (Python)
output   → {"a":1,"b":null,"c":3}
```

Esto es asimétrico a propósito: en TypeScript, un objeto con una
clave ausente y un objeto con `b: undefined` producen la misma salida,
de acuerdo con la incapacidad de JSON para expresar por separado «ausente frente a valor
undefined». Dentro de un array la posición tiene significado, así que
`undefined` se materializa como `null`.

Los SDK no deben (MUST NOT) inventar un canal `undefined` donde el lenguaje anfitrión no tiene
ninguno. `None` de Python, `nil` de Go de un tipo interfaz que produjo un null JSON
al analizar, y `Value::Null` de Rust se asignan todos a JSON `null`.

<a id="rule-7--booleans"></a>
<a id="rule-7-booleans"></a>

### Regla 7 — Booleanos

Los booleanos se emiten como los literales `true` y `false`.

```
input    → {"t": true, "f": false}
output   → {"f":false,"t":true}
```

<a id="rule-8--empty-containers"></a>
<a id="rule-8-empty-containers"></a>

### Regla 8 — Contenedores vacíos

Un objeto vacío emite `{}`. Un array vacío emite `[]`. Ninguno de los dos se
omite.

```
input    → {}
output   → {}

input    → []
output   → []
```

<a id="rule-9--unicode-normalization-is-out-of-scope"></a>
<a id="rule-9-unicode-normalization-is-out-of-scope"></a>

### Regla 9 — La normalización Unicode queda FUERA DEL ALCANCE

Las cadenas se emiten como su secuencia de bytes UTF-8 con las reglas de
escapado de la regla 3, **sin** ninguna normalización Unicode (NFC, NFD,
NFKC, NFKD). Un productor que aporta la cadena precompuesta `"é"`
(U+00E9) y un productor que aporta la secuencia descompuesta
`"e"` + `U+0301` producirán **bytes distintos**, aunque las
dos cadenas se muestren igual y sean iguales bajo la equivalencia
canónica.

Es una no decisión deliberada: exigir una forma de normalización en
la capa de canonicalización obligaría a todos los SDK a incluir una dependencia equivalente a ICU o a
tablas Unicode, y seguiría sin decidir
qué forma (NFC o NFKC) gana. Las aplicaciones a las que les importa
la resistencia a los homógrafos deben (MUST) normalizar sus cadenas **antes** de
entregar el valor al canonicalizador (NFC es la elección convencional
para el intercambio de JSON en el cable — RFC 8259 § 8.1).

Un perfil futuro (`dcp-jcs-v2` o posterior) puede (MAY) fijar una forma de normalización;
esa decisión estará en su propio documento de perfil.

> Nota sobre `NaN` / `±Infinity`: estos valores no forman parte del formato
> de intercambio JSON de RFC 8259. La mayoría de los analizadores JSON los rechazan al analizar, así que
> el canonicalizador nunca los ve. Donde un analizador los acepta
> (p. ej., `json.loads("NaN")` de Python, que los acepta por defecto, o valores
> construidos a mano en JavaScript), la regla 4 los sigue rechazando tras el análisis. Los fixtures de
> interoperabilidad deliberadamente no incluyen un vector NaN/Infinity porque ninguna sintaxis JSON
> portable puede expresarlos; el rechazo se verifica con pruebas unitarias de cada SDK
> (p. ej., `sdks/rust/src/v2/canonicalize.rs` `test_rejects_non_finite`).

---

<a id="3-edge-case-acceptance-table"></a>

## 3. Tabla de aceptación de casos límite

Son los casos que divergían entre SDK antes de que se formalizara el perfil.
Un SDK que cumple el perfil debe (MUST) coincidir con cada celda de esta
tabla.

| Entrada (literal JSON) | Salida | Notas |
|---|---|---|
| `null` | `null` | Regla 5 |
| `true` | `true` | Regla 7 |
| `false` | `false` | Regla 7 |
| `0` | `0` | Regla 4 |
| `-0` | `0` | Regla 4, signo normalizado |
| `1` | `1` | Regla 4 |
| `1.0` | `1` | Regla 4, float de valor entero |
| `1.00` | `1` | Regla 4, ceros finales |
| `1e2` | `100` | Regla 4, notación científica con valor entero |
| `100` | `100` | Regla 4 |
| `-42` | `-42` | Regla 4 |
| `0.1` | ERROR | Regla 4, valor fraccionario |
| `1.5` | ERROR | Regla 4, valor fraccionario |
| `1.0e-1` | ERROR | Regla 4, valor fraccionario |
| `NaN` | ERROR | Regla 4, no finito |
| `Infinity` | ERROR | Regla 4, no finito |
| `{}` | `{}` | Regla 8 |
| `[]` | `[]` | Regla 8 |
| `{"x": null, "y": 1}` | `{"x":null,"y":1}` | Regla 5 |
| `[1, null, 3]` | `[1,null,3]` | Regla 5 |
| `{"é": 1, "e": 2, "z": 3}` | `{"e":2,"z":3,"é":1}` | Regla 1, orden por punto de código |
| `{"a": {"b": {"c": 42}}}` | `{"a":{"b":{"c":42}}}` | Regla 1, recursivo |
| `{"ﬁ": 1, "😀": 2, "a": 3}` | `{"a":3,"ﬁ":1,"😀":2}` | Regla 1, orden por punto de código: U+FB01 < U+1F600 (el orden por unidades de código UTF-16 pondría primero el emoji) |
| `{"s": "<a href='/x?y=1&z=2'>"}` | `{"s":"<a href='/x?y=1&z=2'>"}` | Regla 3, `<`, `>` y `&` no se escapan |
| `{"s": "a b c"}` | `{"s":"a` U+2028 `b` U+2029 `c"}` como UTF-8 sin escapar | Regla 3, los separadores de línea y de párrafo no se escapan |
| `{"s": "\u0000\u0008\t\n\u000b\f\r\u001f\"\\"}` | `{"s":"\u0000\b\t\n\u000b\f\r\u001f\"\\"}` | Regla 3, escapes cortos de RFC 8785 §3.2, `\u00xx` en minúsculas para los demás controles de C0 |

---

<a id="4-bundle-manifest-declaration"></a>

## 4. Declaración en el manifiesto del bundle

Los bundles producidos bajo este perfil deberían (SHOULD) incluir un campo de nivel superior
`canonicalization_profile` en el manifiesto:

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

El campo es opcional por compatibilidad con los bundles producidos
antes de que existiera el perfil. Los verificadores que encuentran un bundle sin
el campo deben (MUST) asumir `dcp-jcs-v1` (porque aún no existe ningún otro
perfil). Cuando se publiquen perfiles futuros (`dcp-jcs-v2`, ...), el campo pasará
a ser obligatorio para desambiguar.

El campo se añade a `schemas/v2/bundle_manifest.schema.json`:

```json
"canonicalization_profile": {
  "type": "string",
  "const": "dcp-jcs-v1",
  "description": "Identifier of the canonicalization profile under which this bundle was produced."
}
```

---

<a id="5-versioning"></a>

## 5. Versionado

Este documento define el perfil `dcp-jcs-v1`, que está **congelado**: cualquier
cambio en las reglas anteriores exige un nuevo identificador de perfil. La
gobernanza para añadir un perfil nuevo:

- Un cambio que admite entradas nuevas o normaliza de otra forma → perfil
  nuevo (p. ej., `dcp-jcs-v2`).
- Un cambio que solo endurece la validación (rechaza entradas que antes
  se aceptaban) → valora si los verificadores posteriores pueden
  actualizarse a la vez; si no, exige un perfil nuevo.
- Una aclaración que documenta el comportamiento existente sin cambiarlo
  → actualización in situ, registrada en el CHANGELOG con el mismo identificador de perfil.

Cuando se publique un perfil futuro:

1. El perfil nuevo tendrá su propio documento en `spec/`
   (p. ej., `CANONICALIZATION_PROFILE_V2.md`).
2. Los SDK publicarán su matriz de compatibilidad en sus README.
3. El `canonicalization_profile` del manifiesto del bundle pasará a ser un campo
   obligatorio, y los verificadores enrutarán al canonicalizador adecuado según
   su valor.

---

<a id="6-conformance-vectors"></a>

## 6. Vectores de conformidad

El archivo compartido `tests/interop/v2/interop_vectors.json` contiene un
bloque `canonicalization.edge_cases` que materializa §3 como un conjunto de
fixtures de prueba. Los cuatro SDK (TypeScript, Python, Rust, Go) deben (MUST) superar
este bloque para afirmar que cumplen el perfil.

Los vectores los consumen las pruebas de interoperabilidad de cada SDK:

- `sdks/typescript/src/__tests__/interop.test.ts`
- `sdks/python/tests/test_interop.py`
- `sdks/rust/tests/interop.rs`
- `sdks/go/dcp/interop_test.go`

La CI ejecuta los cuatro en paralelo en cada PR. Una divergencia entre SDK
bloquea una versión.

---

<a id="7-references"></a>

## 7. Referencias

- RFC 8785 — JSON Canonicalization Scheme (JCS) — especificación base.
- RFC 8259 — JSON Data Interchange Format — gramática a nivel de cable.
- `spec/DCP-AI-v2.0.md` § 15 — resumen a nivel de protocolo.
- `schemas/v2/bundle_manifest.schema.json` — declaración del campo del manifiesto.
- `tests/interop/v2/interop_vectors.json#canonicalization.edge_cases` — fixtures de prueba.

<a id="implementation-notes-informative"></a>

## Notas de implementación (informativas)

> **Añadidas el 25/10/2026. No normativas.** Estas notas no añaden ningún requisito ni cambian nada de lo anterior: describen cómo
> se relaciona el código de referencia de `main` con este texto. Donde difieren, prevalece el texto normativo anterior.

- `dcp-jcs-v1` sigue congelado (§5) y sigue siendo el único perfil de canonicalización normativo y el predeterminado. El
  identificador `dcp-jcs-v2` nombra un candidato no normativo, descrito en
  [docs/proposals/canonicalization-candidate](../docs/proposals/canonicalization-candidate/README.md), con
  API experimentales de activación explícita en los SDK a las que no llama ninguna ruta predeterminada. El esquema del manifiesto sigue fijando
  `canonicalization_profile` en `dcp-jcs-v1`, y los verificadores V2 existentes rechazan el identificador del candidato.
- La regla 4 se decide sobre el valor analizado, así que lo que canonicaliza un productor o un verificador depende de su analizador JSON.
  Los analizadores difieren en entradas que este perfil no fija: nombres de miembro repetidos, escapes de surrogates aislados, una marca
  de orden de bytes inicial y literales numéricos que un analizador binary64 redondea (por ejemplo, `1.0000000000000001` se lee como `1`).
  Por tanto, dos analizadores pueden canonicalizar el mismo texto de forma distinta; la propuesta del candidato registra estos casos.
- El ejemplo de la nota bajo la regla 9 se corrigió el 25/10/2026: `json.loads` no tiene ningún argumento `allow_nan` (acepta
  `NaN` por defecto); `allow_nan` pertenece a `json.dumps`. No cambió ninguna regla.
