# Canonicalization candidate `dcp-jcs-v2`

| | |
|---|---|
| **Date** | 25/10/2026 |
| **Version** | 1.0 |
| **Classification** | Public |
| **Status** | **Non-normative, experimental and inactive.** `dcp-jcs-v1` remains the only canonicalization profile |
| **Corpus** | [`corpus.json`](corpus.json) (revision `design-2`, 187 cases) and [`baseline-corpus.json`](baseline-corpus.json) (87 cases, plus 10 selection and 3 policy cases) |
| **Lab tool** | [`tools/canonicalization-lab/`](../../../tools/canonicalization-lab/): design model, corpus generator and runner |

> **Notice.** This document proposes a candidate profile and records its design. It does not change
> `dcp-jcs-v1` or [`spec/CANONICALIZATION_PROFILE.md`](../../../spec/CANONICALIZATION_PROFILE.md), which
> remain the only normative reference. No existing verifier, signer, schema, conformance check or default
> uses the identifier `dcp-jcs-v2`. The experimental, opt-in APIs of §15 and §16 recognize it without
> activating it: no existing or default path calls them, only callers who opt in; they verify and sign
> nothing. The lab tool's CI job runs the design model, and the SDK test jobs run those APIs on the
> corpus. A V2 verifier that checks the manifest's `canonicalization_profile` field, such as the
> TypeScript SDK's ([`verify-v2.ts`](../../../sdks/typescript/src/core/verify-v2.ts)), rejects it as an
> unknown profile, which is the intended behavior. Nothing here is a conformance requirement. The lab
> tool is an executable model of the design, not an implementation: it computes SHA-256 for its
> synthetic commitments, but it signs nothing and verifies no signature.

## 1. Why a candidate

`dcp-jcs-v1` canonicalizes the value a JSON parser returns. JSON parsers do not all return the same
value for the same text: RFC 8259 leaves duplicate member names (§4), lone surrogates in escapes (§8.2)
and a leading byte order mark (§8.1) to the implementation, and a parser that reads numbers as binary64
can turn different literals into the same value. Two readers of one text can then compute different
canonical bytes, hashes and signature inputs, and a value a signer never saw (an earlier duplicate
member, for example) can travel with signed evidence.

The candidate keeps the output rules of `dcp-jcs-v1` and decides acceptance on the original bytes,
before any parser repairs, rounds or drops information.

## 2. Principles

1. **Same bytes as `dcp-jcs-v1` for the same values.** The candidate changes no output rule; it only
   narrows which inputs are accepted. For any exact value of its domain, both canonicalizers produce the
   same bytes.
2. **Acceptance is decided on the original bytes.**
3. **The profile is chosen once, from the signed manifest field.** An unknown profile is rejected; no
   other profile is retried after a failure.
4. **Not JCS.** Keys are sorted by Unicode code point, as in `dcp-jcs-v1`; RFC 8785 §3.2.3 sorts by
   UTF-16 code units. The profile does not claim JCS compatibility.
5. **No silent downgrade.** A verifier that does not know the candidate rejects it.

## 3. Rules

### 3.1 Ingress (bytes)

| Rule | Requirement | Class |
|---|---|---|
| I1 | Well-formed UTF-8: no invalid bytes, no overlong forms, no encoded surrogates (`ED A0 80`), nothing above U+10FFFF | `UTF8_INVALID` |
| I2 | No leading U+FEFF (`EF BB BF`) | `BOM` |
| I3 | Exactly one RFC 8259 JSON text: only space, tab, LF and CR as whitespace, nothing after the value, no `NaN`, `Infinity`, `+1`, `01`, `1.` or trailing commas | `SYNTAX` |
| I4 | At most 64 nested arrays and objects, counted from the root of the validated unit (§5) | `DEPTH_EXCEEDED` |

### 3.2 Strings and keys

- **S1. Scalar values.** Every string, keys included, is a sequence of Unicode scalar values. A
  `\uD800`–`\uDBFF` escape must be followed immediately by a `\uDC00`–`\uDFFF` escape, and the pair
  stands for one scalar value. Any other surrogate escape is `SURROGATE_UNPAIRED`.
- **S2. No repair.** U+FFFD is a legitimate character, escaped or literal. What is rejected is data a
  parser would *turn into* U+FFFD.
- **S3. Noncharacters are accepted** (D2).
- **S4. No normalization.** As in `dcp-jcs-v1` rule 9, `"é"` (U+00E9) and `"e\u0301"` are different
  strings and keys.
- **S5. Unique keys.** Two members of one object cannot have the same key after unescaping
  (`DUPLICATE_KEY`), even with equal values, at any depth, with no special cases (`__proto__` is a key
  like any other).

### 3.3 Numbers

- **N1. Exact value of the literal.** Acceptance is decided on the exact decimal value of the literal,
  not on its binary64 conversion. A value that is not an integer is `NUMBER_NOT_INTEGER`; an integer
  outside `[-(2^53-1), 2^53-1]` is `NUMBER_OUT_OF_RANGE`.
- **N2. Forms kept.** A literal whose exact decimal value is an integer in range is accepted, whatever
  its form: `1.0` is `1`, `1e2` and `1E+2` are `100`, `100e-2` is `1`, `1.5e1` is `15`, and `-0`, `-0.0`
  and `0e-400` are `0`. This is not every literal `dcp-jcs-v1` accepts: one that a binary64 parser
  rounds to an integer, such as `1.0000000000000001`, is rejected (N3).
- **N3. Rejected because they are not exact integers in range:** `0.5`, `2^53`, `1e-400`,
  `0.99999999999999999`, `1.0000000000000001`, `4503599627370497.5`, `9007199254740993`, `1e21`.
- **N4. Algorithm without big arithmetic.** For a literal `-?E(.F)?(e[+-]?X)?`:
  1. `D` = the digits of `E` and `F` without leading zeros, and `s = X − len(F)`. An empty `D` is `0`.
  2. Strip the trailing zeros of `D` and add their count to `s`.
  3. If `s < 0`, the value is not an integer.
  4. If `len(D) + s > 16`, the value is at least 10^16 and out of range.
  5. Otherwise compare `D·10^s` with `2^53-1`.

  `X` is read with saturation at `len(literal) + 17`; past that bound the outcome cannot change. A literal
  that is both fractional and out of range is `NUMBER_NOT_INTEGER` (step 3 comes before step 4).
- **N5. Large application integers** belong in decimal strings, declared as such in their schema.
- **N6. The value comes from the literal.** Under the candidate, the number that is canonicalized is the
  one N4 computes, never the one a binary64 parser returns. The `dcp-jcs-v1` path does not change.

### 3.4 Output

The output rules of `dcp-jcs-v1` (rules 1–3 and 5–8): keys sorted by code point at every depth; compact
form; the RFC 8785 §3.2 escapes (`\b \t \n \f \r`, `\u00xx` in lower case for the rest of C0, `\"` and
`\\`) and everything else as literal UTF-8, including `/`, U+007F, U+2028 and U+2029; integers without a
fraction or exponent, `-0` as `0`; literal `null`, `true` and `false`; `{}` and `[]` kept.

## 4. Design decisions

| # | Decision | Rationale | Compatibility |
|---|---|---|---|
| D1 | **Reject a leading BOM** in the unit (`BOM`, offset 0). A BOM before a transport envelope is a transport defect | RFC 8259 §8.1 lets receivers ignore it, and readers differ: some strip it, some reject it. Rejecting it removes the difference. U+FEFF inside a string is content | The `dcp-jcs-v1` path does not change (§7) |
| D2 | **Accept noncharacters** (U+FFFE, U+FFFF and the others) | They are scalar values with one UTF-8 encoding and one canonical form. Rejecting them would be a content policy, not a canonicalization rule | The profile is not I-JSON (RFC 7493 §2.1 forbids them) and does not claim to be |
| D3 | **At most 64 nesting levels, counted from the root of the validated unit** (the signed bundle bytes), **never over a transport envelope** (§5) | Validity must not depend on a transport adding an envelope. 64 stays below the default recursion limit of `serde_json` (128). That is not a guarantee about other parsers, about numbers or other limits, or about operator budgets, which may be lower | Only units that select the candidate are affected |
| D4 | **Exact value of the literal** (N1–N6) | The criterion is an exact integer in `[-(2^53-1), 2^53-1]`. Everything else is rejected: literals binary64 represents exactly but out of the domain (`0.5`, `2^53`) and literals binary64 would read as another value (`1e-400` as 0). The cost is linear; the length of a literal is a transport budget, not a profile rule | Only units that select the candidate are affected |
| D5 | **Out of the activation scope:** artifacts without a manifest (revocations, key rotations, mandates) and A2A | The profile is declared in the signed manifest field; those artifacts have no such field. A later design can give each type its own signed field, and A2A one in the handshake transcript | They stay on `dcp-jcs-v1`. A verifier may apply the strict ingress to them by policy, but cannot claim the producer committed to the candidate |
| D6 | **The candidate name `dcp-jcs-v2` is reserved.** No producer emits it until a normative document is approved | A draft suffix on the wire would be another identifier to maintain. Experimental tools enable it only through an explicit policy (§7), without emitting evidence | If the rules changed after an external publication, a new identifier would be needed (`dcp-jcs-v1` §5) |
| D7 | **Optional `dcp-jcs-v1` warnings.** With the bytes available, a verifier may add to a `dcp-jcs-v1` result a warning with the class and offset of the primary defect (§6) | It finds producers to fix before migrating | Never changes a `dcp-jcs-v1` verdict. An object-based API cannot emit it |

## 5. The validated unit and the transport

**The unit** is the exact bytes of the signed bundle value (`{"bundle": …, "signature": …}`). Its root is
depth 1; a payload starts at depth 4 (root, `bundle`, artifact, `payload`), so its own nesting may reach
61 levels. Offsets are relative to the first byte of the unit.

**Transports** are fixed by the endpoint's configuration, never inferred from the content:

| Transport | Unit |
|---|---|
| `bare` | The whole input: an HTTP body, a file, or a header value after its own decoding |
| `envelope` | The value of the one `signed_bundle` member of a top-level object |

**Extraction without re-serialization.** The envelope is walked with a byte-level grammar that delimits
strings without decoding them. The member name is compared after unescaping, so `"signed\u005fbundle"`
names the unit. The unit is the `[start, end)` slice of the value, passed unchanged: its duplicates,
number literals and escapes reach the scanner intact. Other envelope members are not interpreted;
transport size and depth budgets are separate.

**Limit.** Inside an envelope, a unit whose grammar is broken cannot be delimited and is
`TRANSPORT_INVALID`; the same unit sent bare is `SYNTAX`. Both are rejected. For defects inside strings,
duplicates, numbers and depth, the envelope changes neither the class nor the unit-relative offset.

**A new, opt-in contract.** Byte-level extraction rejects envelopes that today's object-based parsing
accepts (a repeated `signed_bundle` member, a BOM before the envelope). It belongs to a new bytes API or
an explicit option, with its own compatibility note, and cannot be installed silently over the
`dcp-jcs-v1` path.

**Why not count the envelope.** Counting depth over the transport document makes validity depend on the
transport: the same 64-level bundle would be valid bare and invalid inside `{"signed_bundle": …}`, and a
proxy that re-wraps a body would change the verdict. The lab tool can evaluate that rule for comparison
(`depth_scope: "transport"`, cases `d-unit-64-envelope-v03-rule` and
`b-v2-unit-depth-64-envelope-v03-rule`).

## 6. Precedence

### 6.1 The scanner's diagnosis, by layers

Within the diagnosis of the unit scanner, an earlier layer always wins, whatever the offsets. The layers
choose **which violation is primary**; whether it rejects is decided by the pipeline (§6.4).

| Layer | Classes | Offset | Within the layer |
|---|---|---|---|
| 1. Encoding | `BOM`, `UTF8_INVALID` | `BOM`: 0. `UTF8_INVALID`: first byte of the first ill-formed subsequence | The BOM is at offset 0 and wins |
| 2. Grammar | `SYNTAX` | The first byte that cannot extend a prefix of some JSON text; the input length if it ends early | Only one: the first |
| 3. Values | `SURROGATE_UNPAIRED`, `DUPLICATE_KEY`, `NUMBER_NOT_INTEGER`, `NUMBER_OUT_OF_RANGE`, `DEPTH_EXCEEDED` | §6.2 | **The earliest offset** |

### 6.2 Offsets of the value layer

| Class | Offset |
|---|---|
| `SURROGATE_UNPAIRED` | The backslash of the escape that is not part of a pair |
| `DUPLICATE_KEY` | The opening quote of the **second** occurrence of the key |
| `NUMBER_NOT_INTEGER`, `NUMBER_OUT_OF_RANGE` | The first byte of the literal |
| `DEPTH_EXCEEDED` | The bracket or brace that opens level 65 |

A defect in a key precedes a defect in its value, because the key comes first in the bytes. Keys are
compared after unescaping as sequences of units: a valid pair is one scalar value and a lone surrogate
stays one unit. In a single pass no two violations share an offset; for completeness, equal offsets
would follow the order of the table. Past level 64 the scanner keeps checking the grammar to the end
of the unit; a value-level defect there can no longer win, because its offset comes after the bracket
that opened level 65. The scanner is iterative: twenty thousand levels give `DEPTH_EXCEEDED` without a
recursion limit.

### 6.3 Transport phases

In an envelope the phase decides, not the offset:

| Phase | Checks | Class / detail | Offset (from the start of the input) |
|---|---|---|---|
| T1 | BOM before the envelope | `TRANSPORT_INVALID` / `BOM` | 0 |
| T2 | Byte-level grammar of the **whole** envelope, the unit included | `TRANSPORT_INVALID` / `SYNTAX` | As in layer 2 |
| T3 | The root is an object | `TRANSPORT_INVALID` / `NOT_AN_OBJECT` | The root's |
| T4 | Exactly one `signed_bundle` member | `TRANSPORT_INVALID` / `NO_SIGNED_BUNDLE`, or `TRANSPORT_AMBIGUOUS` / `SIGNED_BUNDLE_REPEATED` | None, or the name of the second member |
| T5 | Well-formed UTF-8 **outside** the unit, first before it, then after it | `TRANSPORT_INVALID` / `UTF8_INVALID` | First byte of the ill-formed subsequence |

The envelope's encoding can only be judged outside the unit, which exists only after T2–T4; the unit is
scanned after the five phases. For example, `{"bad":"<FF>","signed_bundle":{},"signed_bundle":{}}` is
`TRANSPORT_AMBIGUOUS` at offset 30, although the invalid UTF-8 is at offset 8.

### 6.4 The complete pipeline

1. **Configuration** (bundles only): `POLICY_INVALID`, before the input is read.
2. **Transport** (envelope only): phases T1–T5.
3. **Unit scanner:** the primary diagnosis, or none.
4. **Document:** a diagnosis rejects with its class; otherwise the canonical bytes are produced.
5. **Bundle the scanner can walk** (no encoding or grammar diagnosis):
   1. an `unknown` reading is `PROFILE_UNKNOWN`, **even with a value-level diagnosis**;
   2. a profile outside the policy is `PROFILE_NOT_ACCEPTED`, also with a diagnosis;
   3. `absent` or `dcp-jcs-v1` is **delegated to the `dcp-jcs-v1` path**, the diagnosis only a warning (D7);
   4. `dcp-jcs-v2` with a diagnosis is rejected with its class;
   5. `dcp-jcs-v2` without one goes through the checks of the synthetic bundle, in this order: its
      structure, `payload_hash`, `intent_hash`, `audit_chain`, `manifest_hash`. The first failure is
      `COMMITMENT_MISMATCH` with that detail; otherwise the bundle is accepted.
6. **Bundle the scanner cannot walk** (an encoding or grammar diagnosis):
   - if today's parser fails, or reads `dcp-jcs-v2` or another value, the class of the diagnosis;
   - if it reads `absent` or `dcp-jcs-v1`, the policy (without `dcp-jcs-v1`, `PROFILE_NOT_ACCEPTED`), then delegation with a warning.

## 7. Profile selection and policy

**Reading.**
- **Exact path.** Only `bundle.manifest.canonicalization_profile`, from the unit root, selects. The same
  field elsewhere is data: at the root, in `bundle`, in `signature`, in a payload, or in a manifest that is
  an array.
- **Duplicates.** When a key on the path repeats (`bundle`, `manifest`, the field), the **last** value is
  read, as common JSON parsers keep it.
- **Comparison after unescaping.** `"dcp-jcs-v\u0032"` and `"canonicalization\u005fprofile"` count.
- **Result:** `absent`, `dcp-jcs-v1`, `dcp-jcs-v2`, or `unknown` (any other string, case or spacing
  variant, `""`, `null`, a number, an array, an object, or a string with a lone surrogate).

**Only for a unit the scanner cannot walk** is today's parser consulted, and only to decide whether the
`dcp-jcs-v1` path proceeds. A parser repair never admits the candidate, and rejection classes are the
same everywhere.

**Delegation.** `v1_path` hands the unit, unchanged, to today's `dcp-jcs-v1` verifier. For a unit the
scanner can walk, the scanner reads the field as a parser that keeps the last duplicate does; for one it
cannot walk, today's parser decides. That `dcp-jcs-v1` verdicts are preserved is a **design argument**,
resting on how parsers read the path; it is not measured in any SDK here.

**Policy.** `accepted_canonicalization_profiles` is a non-empty list of known identifiers without
repeats. Anything else (an empty list, a bare string, `null`, non-string entries such as `[[]]`, `[{}]`
or `[1]`, repeats, unknown identifiers) is `POLICY_INVALID`, a configuration error, not a rejection of
the data. A policy only restricts; it never selects, and its order does not matter. The lab tool has no
default policy: each case states its own, and the candidate is enabled only explicitly
(`["dcp-jcs-v1", "dcp-jcs-v2"]`). A future production default would be `["dcp-jcs-v1"]`.

**No retry.** One profile, one path. A failure of the candidate path is final: nothing is
re-canonicalized with `dcp-jcs-v1`, the profile is never inferred from content, headers or parameters.

## 8. Signed profile, inner signatures, audit chain and migration

- **The field is signed.** It is part of the manifest, which the bundle signature covers. Under the
  candidate there are no duplicates, so the commitment is unambiguous. Under `dcp-jcs-v1` only the last
  of repeated fields enters the signed canonical bytes, so a repeated field placed before the signed one
  does not break the signature; the candidate removes that, and D7 can flag it.
- **Inner signatures carry no profile.** Within the domain the artifacts' bytes are the same under both
  profiles, so the commitment to the candidate comes only from the manifest: an inner signature alone
  does not say which profile produced it. Artifacts outside a bundle stay on `dcp-jcs-v1` (D5).
- **The audit chain starts at `GENESIS`.** The current verifier requires `prev_hash == "GENESIS"` in the
  first entry ([`verify-v2.ts`](../../../sdks/typescript/src/core/verify-v2.ts)). A `dcp-jcs-v1` hash
  copied as the first `prev_hash` of a candidate bundle is not a verifiable link across profiles: it
  breaks the chain (case `mig-copied-v1-hash`). Candidate evidence starts its own chain; a reference to
  earlier evidence inside a payload identifies it but does not verify it (`mig-reference-is-data`).
  Continuity of one chain across profiles needs a mechanism not designed here.
- **Relabels.** `dcp-jcs-v1` relabeled as the candidate fails the manifest hash and is not retried with
  `dcp-jcs-v1` (`mig-relabel-v1-to-v2`). The candidate relabeled as `dcp-jcs-v1`, or with the field
  removed, is delegated to `dcp-jcs-v1`, whose verifier then hashes a manifest the producer did not sign;
  the lab tool does not compute that verdict. A literal outside the domain in a candidate bundle is
  rejected at ingress, even if a binary64 reader would see a matching value: there is no fallback.
- **Nothing is re-labeled or re-signed automatically.** Evidence under the candidate is new evidence with
  new signatures; the received bytes, not re-serialized objects, are what to archive.

## 9. Phases and acceptance gates

Nothing here is activated, and only the experimental unit ingress (§15) and router (§16) are implemented. Moving to a later phase needs an explicit decision, taken
apart from this document, and a change of default needs its own decision.

**Phases.**

1. Proposal, corpus and design model (this document).
2. Verifiers able to verify the candidate behind an explicit option, with producers still on
   `dcp-jcs-v1`.
3. Producers with an explicit option, once the cross signing matrix below passes.
4. A change of default, in a later cycle, with deprecation notes.

Verification of `dcp-jcs-v1` stays for historical evidence throughout: introducing the candidate does not
make any `dcp-jcs-v1` evidence stop verifying or start verifying. Security fixes to `dcp-jcs-v1` are
assessed on their own.

**Gates before phase 2 or 3** (requirements, none met yet):

1. **Corpus parity.** The cases that fix ingress are the 87 raw baseline cases and the applicable design
   cases. On them, every SDK and WASM, through a bytes API, give the same `canonical_sha256` on the accept
   cases and the same class, with the precedence and offsets of §6, on the reject cases. The cases that
   evaluate the obsolete v0.3 depth rule (`depth_scope: "transport"`) demonstrate the model and are not
   acceptance requirements. The synthetic bundle cases must become real signed bundles with explicit
   expectations, and their `historical` parameter must be replaced by a real observation of each SDK's
   parser; it is never evidence.
2. **Object API scope.** An API that receives parsed objects rejects the reject cases marked
   `needs_original_bytes: false`, and documents the reject cases marked `true` as out of its reach.
3. **Output equivalence on values.** For each exact value of the domain, built directly or through the
   candidate ingress (never through a `dcp-jcs-v1` parser from a literal), both canonicalizers give the
   same bytes in every SDK.
4. **Ingress parity from bytes.** Every SDK materializes the same value and bytes from the accept cases.
5. **Historical readings stay diagnostics.** A historical parser that reads a literal differently from
   its exact value is a `dcp-jcs-v1` matter with its own compatibility analysis, not a gate.
6. **Cross signing matrix.** Each producer signs candidate bundles with boundary payloads (`±(2^53-1)`,
   keys with U+E000 and U+1F600, U+FEFF at the start of a string, U+FFFD, U+2028, `\u0000`, a unit nested
   to depth 64), and every verifier accepts them; the existing `dcp-jcs-v1` interop matrix stays green.
7. **Negative matrix.** A defect of each class, injected at byte level into a valid candidate bundle, is
   rejected with that class before signatures are checked; the same defect in a `dcp-jcs-v1` bundle
   keeps today's verdict.
8. **Selection, precedence and policy.** The tests of §6 and §7 run in every SDK, with an instrumented
   check that each verification uses one profile and one path.
9. **History.** With the new ingress installed, the `dcp-jcs-v1` path gives each SDK today's verdict on
   the existing vectors and conformance suites.
10. **Cost.** Measured before and after, without relaxing anything to compensate.

## 10. Corpus and lab tool

| File | Content |
|---|---|
| [`baseline-corpus.json`](baseline-corpus.json) | 87 single-defect cases (42 accept, 45 reject, 6 of them non-UTF-8 bytes), 10 profile-selection and 3 policy cases. A copy of the approved revision 2: only `proposal` and a `provenance` field differ. Its `domain.max_depth_scope` keeps the historical wording (depth over the whole input, envelope included); I4 supersedes it (depth from the unit root), as `corpus.json` records in `scope_revisions`. No case changes: every baseline case is a bare unit |
| [`corpus.json`](corpus.json) | 187 design cases: multi-defect permutations (54), exact numbers (20), depth with and without an envelope (12), transport (19) and transport phases (12), selection (23), ingress (3), historical parsers (8), policy (5), configuration (9), migration (9), and the 10 + 3 baseline selection and policy cases on synthetic bundles. It references the 87 baseline cases by ID and input hash |
| [`tools/canonicalization-lab/model.py`](../../../tools/canonicalization-lab/model.py) | The design model: transport extraction, an iterative byte scanner with the precedence of §6, N4, the output rules, selection and policy, and a synthetic bundle path whose hash checks stand in for payload hashes, the audit chain and the manifest signature. Its executable behavior is the approved model's (approved file SHA-256 `ab172c5f…`); its docstrings clarify public paths and the assumed last-duplicate rule. It computes SHA-256 for the synthetic commitments and signs or verifies nothing |
| [`tools/canonicalization-lab/generate_corpus.py`](../../../tools/canonicalization-lab/generate_corpus.py) | Writes `corpus.json`. Expectations are written by hand with the rule each applies (`why`); it never imports the model |
| [`tools/canonicalization-lab/run.py`](../../../tools/canonicalization-lab/run.py) | Checks integrity, freshness, validity and coverage, runs the model on all 274 cases, and runs 24 negative controls |

**Bundle cases** use a minimal synthetic schema (manifest, `intent`, `audit_entries` and
`signature.manifest_hash`), whose `manifest_hash` stands in for the composite signature. For units the
scanner cannot walk, what today's parser of an SDK does is a parameter of each case (`historical`), not a
measurement.

**The runner checks** the baseline hash and its 87 case references, the input hash of every case, that
the corpus regenerates byte for byte, valid states and classes, unique IDs (also against the baseline),
no undeclared repeated input, coverage of the 20 ordered value-level pairs, of every class and group, and
of each baseline selection and policy case. Every actual result is validated (state, class, format and
mode) in the corpus run and in every control; a model failure is reported as `MODEL_ERROR`, never as a
rejection.

**Negative controls** (all must be caught): three altered expectations; 14 data corruptions, each caught
by its own rule; a stale corpus; a model that fails on every case; four design mutants (class order
instead of offset, value level before grammar, fallback to `dcp-jcs-v1`, depth over the envelope), each
breaking exactly its own cases; two injected failures only under mutation and one mutant that breaks
exactly the expected cases with an unknown class, all three of which must invalidate the campaign rather
than count as caught.

## 11. Reproduce

Python 3.9 or later on Linux or macOS (the runner uses `signal.SIGALRM` and `pathlib.Path.is_relative_to`;
Windows is not supported), standard library only. The commands run from the root of a checkout; from
any other directory, give the scripts their absolute paths. Outputs go to a new temporary directory, so
nothing is overwritten: the runner also refuses an existing output path, and the generator writes
wherever it is told.

```bash
out=$(mktemp -d)
python3 -I tools/canonicalization-lab/generate_corpus.py "$out/corpus.json"
cmp "$out/corpus.json" docs/proposals/canonicalization-candidate/corpus.json
python3 tools/canonicalization-lab/run.py --out "$out/run.json"
python3 tools/canonicalization-lab/run.py --controls --out "$out/controls.json"
```

Expected: `274/274 cases as expected (87 r2 + 187 design)`, every control `CAUGHT`, and exit code 0.
Exit code 1 means a case, a result or a control differs; 2 means the data is invalid.

## 12. What this shows and what it does not

| Shown by the design model | Not done |
|---|---|
| The total precedence, with offsets, on 54 multi-defect documents and 12 multi-defect envelopes | Verification or signing of the candidate in the TypeScript, Python, Go, Rust or WASM SDKs (only the unit ingress of §15 and the router of §16 exist) |
| The unit, the transport and envelope independence | A bytes API in the integrations or the server |
| Selection, policy and no retry, on synthetic bundles | Real bundles signed with the candidate, composite signatures verified |
| That the candidate path does not depend on parser repairs | The candidate matrices of §9 (cross signing, negative matrix, history over the conformance suites). Since phase 2, `tests/interop/candidate/phase2-adapter-expectations.json` records 160 readings of real decoders (16 units × 10 adapters) where the historical adapter decides; that is evidence for those units only |
| The synthetic bundle's hash checks | A cross-SDK signing matrix, a negative matrix and a performance benchmark |
| | That delegation preserves each SDK's `dcp-jcs-v1` verdict |

## 13. Open questions

- The preservation of `dcp-jcs-v1` verdicts depends on historical parsers reading the profile path with
  the last-duplicate rule; it must be measured on each actual verifier entry path before implementation.
  A typed construction decoder is not necessarily the decoder used by a verifier. For object APIs,
  the caller's or integration's bytes-to-object decoder is part of that path: it can discard a BOM,
  repair invalid UTF-8, lose duplicate members or reject the body before verification. An adapter must preserve that
  existing path explicitly; replacing it with one common decoder does not establish historical parity.
- The byte-level transport contract changes the result for ambiguous envelopes and needs its own
  compatibility note.
- Audit-chain continuity across profiles, the profile of artifacts without a manifest, and A2A remain
  outside this design.

## 14. References

- [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259) §4 (unique names), §6 (interoperable number range), §8.1 (BOM), §8.2 (lone surrogates).
- [RFC 7493](https://www.rfc-editor.org/rfc/rfc7493) (I-JSON) §2.1–§2.3.
- [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) §3.1, §3.2.2 and §3.2.3 (UTF-16 key order, which this profile does not use).
- [`spec/CANONICALIZATION_PROFILE.md`](../../../spec/CANONICALIZATION_PROFILE.md) (`dcp-jcs-v1`, unchanged).

## 15. Experimental SDK ingress (phase 1)

Phase 1 of the SDK implementation plan (not a phase of §9) adds an experimental, opt-in ingress of one
unit to each SDK. It is not normative, and no existing or default path calls it: only callers who opt in do.
It changes no `dcp-jcs-v1` function, default, signer or verifier. The ingress itself does not read the
profile (the router of §16 does) and no SDK emits `dcp-jcs-v2`.

| SDK | API |
|---|---|
| TypeScript | `experimentalCandidateIngress(bytes: Uint8Array)`, exported by `@dcp-ai/sdk` |
| Python | `dcp_ai.v2.experimental_candidate_ingress.experimental_candidate_ingress(data)`, not re-exported by `dcp_ai.v2` |
| Go | `v2.ExperimentalCandidateIngress(input []byte)` |
| Rust | `dcp_ai::v2::experimental_candidate_ingress::experimental_candidate_ingress(&[u8])` |
| WASM | `wasm_experimental_candidate_ingress` in the Rust bindings, and `DcpWasm.experimentalCandidateIngress(bytes)` in `@dcp-ai/wasm` |

**What it does.** It takes the original bytes of one unit and applies §3.1–§3.3, with the precedence
and offsets of §6.1–§6.2. On acceptance it returns the exact value, its canonical bytes (§3.4) and their
SHA-256; the WASM wrapper returns the bytes and the hash, not the value. A rejection is a result, with
its class and byte offset. A wrong argument type and an internal error are reported apart, never as a
rejection.

**What it does not do:**
- extract a unit from a transport (§5, §6.3);
- select a profile or apply a policy (§6.4 steps 1, 5 and 6; §7);
- delegate to `dcp-jcs-v1`;
- verify, sign or admit anything.

**Tests.** Each of the four SDKs (TypeScript, Python, Go and Rust) runs these cases against the
stored expectations (the class and offset, or the canonical hash):
- the 87 baseline units;
- the 81 bare document cases of `corpus.json`.

Each of the four also checks that its `dcp-jcs-v1` canonicalizer gives the same bytes over every
accepted value, and adds focused examples: invalid UTF-8, BOM, duplicates through escapes,
`__proto__`, long and saturated number literals, surrogate pairs, and 20 000 levels with and without a
late grammar error.

The WASM test runs the real Rust binding through the `@dcp-ai/wasm` wrapper on the same 168 cases,
comparing class and offset or canonical bytes and hash; it gets no value, so it makes no `dcp-jcs-v1`
comparison. It also checks the JS/WASM boundary:
- bytes reach Rust unchanged (an invalid byte, a BOM, a NUL escape, a view of a larger buffer);
- a 20 000-level unit returns;
- an argument that is not a `Uint8Array` is a `TypeError`.

In every SDK, the 77 bundle cases and the 29 envelope cases, the obsolete depth rule among them, belong
to later phases: they are counted, not run.

**Gates.** This is evidence toward gates 1, 3 and 4 of §9 for unit cases only. None of the ten gates is
met by it, and the candidate stays inactive.

## 16. Experimental SDK router (phase 2)

Phase 2 of the SDK implementation plan adds an experimental, opt-in router to each SDK. It extracts the unit
(§5, §6.3), reads the profile (§7) and applies §6.4 up to the decision: reject, delegate to `dcp-jcs-v1`, or
select the candidate path. It is not normative, and no existing or default path calls it: only callers who
opt in do. `dcp-jcs-v1`, its verifiers and every default are unchanged. `candidate` is never an acceptance: phase 3 would verify it. Nothing verifies or signs
a candidate.

| SDK | API |
|---|---|
| TypeScript | `createExperimentalCandidateRouter(config).route(bytes)`, `experimentalCandidateExtractUnit`, `experimentalHistoricalAdapters` |
| Python | `dcp_ai.v2.experimental_candidate_router`: `create_router`, `extract_unit`, `JSON_LOADS_BYTES`, `JSON_LOADS_STRICT_DECODE` |
| Go | `NewExperimentalCandidateRouter(cfg)` and `Route`, `ExperimentalCandidateExtractUnit`, `ExperimentalHistoricalEncodingJSON` |
| Rust | `v2::experimental_candidate_router`: `CandidateRouter::new` and `route`, `extract_unit`, `HistoricalAdapter::serde_json_from_slice` |
| WASM | `DcpWasm.createExperimentalCandidateRouter` over the bindings `wasm_experimental_candidate_route` and `_resume`, and `experimentalWasmHistoricalAdapters` |

**Configuration.** The transport (`bare` or `envelope`), the accepted profiles and the historical adapter
are required; none has a default.
- They are validated with strict types when the router is created, before any input.
- An invalid configuration is a configuration error (`POLICY_INVALID` or `CONFIG_INVALID`), never a
  rejection of the data.
- The router keeps a private snapshot, so later changes to the caller's objects change nothing.

**Results.**
- **`reject`:** the class (a transport class, a scanner class, `PROFILE_UNKNOWN` or `PROFILE_NOT_ACCEPTED`)
  and its offsets. `offset` is relative to the unit; `transport_offset` is in the input.
- **`v1_path`:** the unit, the warning (D7) and what the historical adapter returned.
  - Its profile is always `dcp-jcs-v1`: a manifest without the field was produced under `dcp-jcs-v1`.
  - `profile_source` says why: `field`, `absent`, or `historical` for a unit the scanner cannot walk.
- **`candidate`:** the unit, its value and its canonical bytes. The WASM wrapper returns the canonical bytes
  and their hash but not the value, as in phase 1.

The names are equivalent across SDKs in each language's style: `profileSource`, `transportOffset` and
`canonicalSha256` in TypeScript and the WASM wrapper; `profile_source`, `transport_offset` and
`canonical_sha256` in Python, Rust and the WASM bindings; `ProfileSource`, `TransportOffset` and
`CanonicalSHA256` in Go.

**Historical adapters.** An adapter reproduces one real decoder, and the router consults it at most once, only
where §6.4 needs it:
- to decide on a unit the scanner cannot walk;
- to produce the value of a delegation.

Its reading never selects the candidate, and its result is what the real decoder returned, not sanitized by
the candidate rules: NaN, infinities and lone surrogates are kept only where that decoder keeps them.
`json.loads` accepts NaN and 1e999, `JSON.parse` gives Infinity for 1e999, and both keep lone surrogates.
`encoding/json` and `serde_json` refuse 1e999. On the WASM `w1` path `JSON.stringify` turns Infinity into
`null` and escapes lone surrogates again, which `serde_json` then refuses. An adapter that fails otherwise
than by refusing the data is an adapter error, not a rejection.

The WASM wrapper reproduces two distinct paths, measured separately and not assumed equivalent:
- **`w1`:** an object, through `JSON.stringify`, to Rust;
- **`w2`:** a text to the binding.

Its bindings are stateless. `resume` recomputes the decision point from its own arguments and can only end
in a rejection or a delegation.

**Tests.** Each SDK and WASM run these cases:
- the 9 configuration cases;
- the 28 document envelope cases;
- the 58 walkable bundle cases, where `accept_v2` and `COMMITMENT_MISMATCH` are checked only as `candidate`;
- the public fixture `tests/interop/candidate/phase2-adapter-expectations.json`. For the 9 units the scanner
  cannot walk and 7 synthetic units, it records what each real decoder returns, measured by running it; the
  corpus parameter `historical` is not used as evidence.

They also check:
- a v1 parity with no differences: bare, `["dcp-jcs-v1"]`, every built-in adapter, on the public signed
  bundles and variants generated from them;
- the grammar walker against the phase 1 scanner;
- laziness, the adapter contract and byte ownership.

**Gates.** This is evidence toward gates 1, 8 and 9 of §9, for selection and delegation only. None of the ten
gates is met by it, and the candidate stays inactive.
