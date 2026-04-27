# DCP-AI Canonicalization Profile

**Profile identifier:** `dcp-jcs-v1`
**Status:** Published — v2.0
**First shipped in:** Python 2.8.0, Rust 2.8.0, Go v2.8.0, TypeScript 2.1.0

This document is the normative reference for byte-exact JSON
canonicalization in DCP-AI. It supersedes the five-bullet summary that
appeared in `spec/DCP-AI-v2.0.md` § 15. Every signature, every hash,
every Merkle leaf in a DCP artifact is taken over the output of the
algorithm specified here.

The profile is a **strict subset of RFC 8785 (JCS)** with explicit
treatment of the cases JCS leaves implementation-defined. SDKs that
claim profile compliance MUST produce byte-identical output for the
edge-case table in §3.

---

## 1. Why a profile and not just "JCS"

RFC 8785 fixes the structural rules — sorted keys, compact form, string
escaping, number representation — but defers a few decisions to the
producer's host language: how `undefined` is treated, what happens to
floats that happen to have integer value, whether `1e2` is normalized,
how `null`-equivalent host types map to JSON `null`. Across four SDKs
(TypeScript, Python, Rust, Go) those defaults diverge and produce
different bytes for the same source object. `dcp-jcs-v1` pins each of
those decisions so all four SDKs produce identical output.

---

## 2. Normative rules

A producer that implements `dcp-jcs-v1` MUST honour rules 1 through 8.
A verifier that consumes `dcp-jcs-v1` SHOULD reject artifacts whose
output diverges from these rules.

### Rule 1 — Sorted keys

Object keys are sorted lexicographically by Unicode code point in
ascending order. Sorting is performed at every nesting depth.

```
input    → {"z": 1, "a": 2, "é": 3, "e": 4}
output   → {"a":2,"e":4,"z":1,"é":3}
```

### Rule 2 — Compact form

No whitespace anywhere outside string values. Pair separator is `,`,
key-value separator is `:`. No trailing commas.

### Rule 3 — String escaping

Strings are encoded UTF-8. Escaping follows RFC 8785 §3.2: only the
characters that JSON requires escaping (control characters U+0000
through U+001F, `"`, `\`) are escaped. Forward slash, non-ASCII
characters, emoji, kanji, etc. are emitted verbatim as their UTF-8
byte sequence.

```
input    → {"emoji": "🔑", "kanji": "鍵"}
output   → {"emoji":"🔑","kanji":"鍵"}
```

### Rule 4 — Numeric values: integer-only

The wire format accepts only numbers whose value is an exact integer.
"Exact integer" is decided **post-parse**:

- A JSON `Number` is valid iff (a) it is finite, and (b) its value has
  no fractional part (`floor(n) == n`).
- A `Number` whose source literal was `1.0`, `1.00`, `1e2`, `100`, or
  `-0` is valid because all those literals decode to an integer value
  after parsing.
- A `Number` whose value is `0.1`, `1.5`, `1e-1`, `NaN`, or `±Infinity`
  is invalid and the canonicalizer MUST raise an error before any
  output is produced.

Output normalization: every valid number is emitted in plain integer
form, no decimal point, no exponent, no leading zeros (except for
`0`), no trailing zeros.

```
{"n": 1.0}    → {"n":1}
{"n": 1e2}    → {"n":100}
{"n": -0}     → {"n":0}
{"n": 0.1}    → ERROR
{"n": NaN}    → ERROR
```

This rule is what makes the four SDKs converge: a JavaScript producer
can pass `1.0` as a literal (it has no integer type), a Python
producer can pass `int(100)`, a Go producer can pass `1e2` parsed from
JSON, and all four emit the same bytes.

### Rule 5 — Null preservation

A JSON `null` value MUST be preserved with its key:

```
input    → {"x": null, "y": 1}
output   → {"x":null,"y":1}
```

Null inside an array preserves its position:

```
input    → [1, null, 3]
output   → [1,null,3]
```

### Rule 6 — Null and undefined handling (cross-language)

JSON has one absent-value channel (`null`). Host languages have more.
TypeScript is the only host language that distinguishes `undefined`
from `null`; Python, Go, and Rust do not. The canonicalizer MUST treat
each host value as follows:

| Host language | Host value                                          | In an object key | In an array slot |
|---------------|-----------------------------------------------------|------------------|------------------|
| TypeScript    | `undefined`                                         | **omit the key** | emit `null`      |
| TypeScript    | `null`                                              | emit `null`      | emit `null`      |
| Python        | absent key                                          | **omit the key** | n/a              |
| Python        | `None`                                              | emit `null`      | emit `null`      |
| Go            | absent map entry                                    | **omit the key** | n/a              |
| Go            | `nil` interface / explicit JSON null                | emit `null`      | emit `null`      |
| Rust          | absent struct field with `skip_serializing_if=None` | **omit the key** | n/a              |
| Rust          | `Option::None` serialized without skip             | emit `null`      | emit `null`      |
| Rust          | `Value::Null`                                       | emit `null`      | emit `null`      |

```
input    → { a: 1, b: undefined, c: 3 }   (TS)
output   → {"a":1,"c":3}

input    → [1, undefined, 3]              (TS)
output   → [1,null,3]

input    → {"a": 1, "b": None, "c": 3}    (Python)
output   → {"a":1,"b":null,"c":3}
```

This is intentionally asymmetric: in TypeScript, an object with an
absent key and an object with `b: undefined` produce identical output,
matching JSON's inability to express "absent vs undefined-valued"
distinctly. Inside an array the position is meaningful, so
`undefined` materializes as `null`.

SDKs MUST NOT invent an `undefined` channel where the host language has
none. Python `None`, Go `nil` of an interface type that produced a JSON
null on parse, and Rust `Value::Null` all map to JSON `null`.

### Rule 7 — Booleans

Booleans are emitted as the literals `true` and `false`.

```
input    → {"t": true, "f": false}
output   → {"f":false,"t":true}
```

### Rule 8 — Empty containers

An empty object emits `{}`. An empty array emits `[]`. Neither is
omitted.

```
input    → {}
output   → {}

input    → []
output   → []
```

### Rule 9 — Unicode normalization is OUT OF SCOPE

Strings are emitted as their UTF-8 byte sequence with the escaping
rules of Rule 3, **without** any Unicode normalization (NFC, NFD,
NFKC, NFKD). A producer that supplies the precomposed string `"é"`
(U+00E9) and a producer that supplies the decomposed sequence
`"e"` + `U+0301` will produce **different bytes**, even though the
two strings render identically and compare equal under canonical
equivalence.

This is a deliberate non-decision: requiring a normalization form at
the canonicalization layer would force every SDK to ship an ICU- or
unicode-tables-equivalent dependency and would still leave open
which form (NFC vs NFKC) wins. Applications that care about
homograph resistance MUST normalize their strings **before** they
hand the value to the canonicalizer (NFC is the conventional choice
for JSON-on-the-wire interchange — RFC 8259 § 8.1).

A future profile (`dcp-jcs-v2` or later) MAY pin a normalization form;
that decision will live in its own profile document.

> Note on `NaN` / `±Infinity`: these values are not part of RFC 8259
> JSON wire format. Most JSON parsers reject them at parse time, so
> the canonicalizer never sees them. Where a parser does accept them
> (e.g. Python `json.loads(allow_nan=True)`, JavaScript hand-built
> values), Rule 4 still rejects them post-parse. The interop fixtures
> deliberately do not ship a NaN/Infinity vector because no portable
> JSON syntax can express them; rejection is verified by per-SDK unit
> tests (e.g. `sdks/rust/src/v2/canonicalize.rs` `test_rejects_non_finite`).

---

## 3. Edge-case acceptance table

These are the cases that diverged across SDKs before the profile was
formalized. A profile-compliant SDK MUST match every cell in this
table.

| Input (JSON literal) | Output | Notes |
|---|---|---|
| `null` | `null` | Rule 5 |
| `true` | `true` | Rule 7 |
| `false` | `false` | Rule 7 |
| `0` | `0` | Rule 4 |
| `-0` | `0` | Rule 4, sign normalised |
| `1` | `1` | Rule 4 |
| `1.0` | `1` | Rule 4, integer-valued float |
| `1.00` | `1` | Rule 4, trailing zeros |
| `1e2` | `100` | Rule 4, scientific notation with integer value |
| `100` | `100` | Rule 4 |
| `-42` | `-42` | Rule 4 |
| `0.1` | ERROR | Rule 4, fractional value |
| `1.5` | ERROR | Rule 4, fractional value |
| `1.0e-1` | ERROR | Rule 4, fractional value |
| `NaN` | ERROR | Rule 4, non-finite |
| `Infinity` | ERROR | Rule 4, non-finite |
| `{}` | `{}` | Rule 8 |
| `[]` | `[]` | Rule 8 |
| `{"x": null, "y": 1}` | `{"x":null,"y":1}` | Rule 5 |
| `[1, null, 3]` | `[1,null,3]` | Rule 5 |
| `{"é": 1, "e": 2, "z": 3}` | `{"e":2,"z":3,"é":1}` | Rule 1, code-point ordering |
| `{"a": {"b": {"c": 42}}}` | `{"a":{"b":{"c":42}}}` | Rule 1, recursive |

---

## 4. Bundle manifest declaration

Bundles produced under this profile SHOULD include a top-level
`canonicalization_profile` field on the manifest:

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

The field is optional for backward compatibility with bundles produced
before the profile shipped. Verifiers that encounter a bundle without
the field MUST assume `dcp-jcs-v1` (because no other profile exists
yet). When future profiles ship (`dcp-jcs-v2`, ...), the field will
become required to disambiguate.

The field is added to `schemas/v2/bundle_manifest.schema.json`:

```json
"canonicalization_profile": {
  "type": "string",
  "const": "dcp-jcs-v1",
  "description": "Identifier of the canonicalization profile under which this bundle was produced."
}
```

---

## 5. Versioning

This document defines profile `dcp-jcs-v1`, which is **frozen**: any
change to the rules above requires a new profile identifier. The
governance for adding a new profile:

- A change that admits new inputs or normalises differently → new
  profile (e.g. `dcp-jcs-v2`).
- A change that only tightens validation (rejecting inputs that were
  previously accepted) → consider whether downstream verifiers can
  upgrade in lockstep; if not, requires a new profile.
- A clarification that documents existing behaviour without changing
  it → in-place update, recorded in CHANGELOG with the same profile id.

When a future profile ships:

1. The new profile gets its own document in `spec/`
   (e.g. `CANONICALIZATION_PROFILE_V2.md`).
2. SDKs publish their support matrix in their READMEs.
3. The bundle manifest's `canonicalization_profile` becomes a required
   field, and verifiers route to the appropriate canonicalizer based
   on its value.

---

## 6. Conformance vectors

The shared `tests/interop/v2/interop_vectors.json` file contains a
`canonicalization.edge_cases` block that materialises §3 as a set of
test fixtures. All four SDKs (TypeScript, Python, Rust, Go) MUST pass
this block to claim profile compliance.

The vectors are consumed by the per-SDK interop tests:

- `sdks/typescript/src/__tests__/interop.test.ts`
- `sdks/python/tests/test_interop.py`
- `sdks/rust/tests/interop.rs`
- `sdks/go/dcp/interop_test.go`

CI runs all four in parallel on every PR. A divergence between SDKs is
a release blocker.

---

## 7. References

- RFC 8785 — JSON Canonicalization Scheme (JCS) — base spec.
- RFC 8259 — JSON Data Interchange Format — wire-level grammar.
- `spec/DCP-AI-v2.0.md` § 15 — protocol-level summary.
- `schemas/v2/bundle_manifest.schema.json` — manifest field declaration.
- `tests/interop/v2/interop_vectors.json#canonicalization.edge_cases` — test fixtures.
