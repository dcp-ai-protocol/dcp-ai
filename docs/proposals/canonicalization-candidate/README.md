# Canonicalization candidate `dcp-jcs-v2`

The experimental opt-in candidate APIs are included in the SDK versions listed in [Published versions](../../README.md#published-versions).

| | |
|---|---|
| **Date** | 29/10/2026 |
| **Version** | 1.2 |
| **Classification** | Public |
| **Status** | **Non-normative, experimental and inactive.** `dcp-jcs-v1` remains the only normative canonicalization profile and the default; the SDKs' candidate APIs (§15 to §18) are experimental and opt-in |
| **Corpus** | [`corpus.json`](corpus.json) (revision `design-2`, 187 cases) and [`baseline-corpus.json`](baseline-corpus.json) (87 cases, plus 10 selection and 3 policy cases) |
| **Lab tool** | [`tools/canonicalization-lab/`](../../../tools/canonicalization-lab/): design model, corpus generator and runner |

> **Notice.** This document proposes a candidate profile and records its design. It does not change
> `dcp-jcs-v1` or [`spec/CANONICALIZATION_PROFILE.md`](../../../spec/CANONICALIZATION_PROFILE.md), which
> remain the only normative reference. No existing verifier, signer, schema, conformance check or default
> uses the identifier `dcp-jcs-v2`. The experimental, opt-in APIs of §15 to §18 recognize it
> without activating it: no existing or default path calls them, only callers who opt in. Those of §15
> and §16 verify nothing; the verifier of §17 verifies candidate bundles from their original bytes, and
> a verified bundle grants no trust or admission. The producers of §18 make new candidate evidence for
> those callers only; the phase 3 vectors are signed by a test-only generator. The experimental opt-in APIs are available in npm SDK 2.2.0 and WASM 2.1.0; other ecosystems have separate releases. See [published npm packages](../../NPM_RELEASES.md). The lab tool's CI job runs
> the design model, the SDK test jobs run those APIs on the corpus, the phase 3 vectors and the gate 7 fixture, and the
> phase 4 matrix has its own workflow. The
> existing V2 verifiers, such as the TypeScript SDK's
> ([`verify-v2.ts`](../../../sdks/typescript/src/core/verify-v2.ts)), still reject the profile as
> unknown when given a parsed object or text, which is the intended behavior. Nothing here is a conformance requirement. The lab
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
| D6 | **The candidate name `dcp-jcs-v2` is reserved.** Only the experimental, opt-in producers of §18 emit it, when a caller asks them to; no default path does, including in published npm packages. It stays a candidate name until a normative document is approved. (Revised in phase 4: before §18 there was no opt-in SDK producer; the phase 3 vectors came from a test-only generator.) | A draft suffix on the wire would be another identifier to maintain. Verifiers enable it only through an explicit policy (§7) | Evidence emitted under the candidate is experimental. If the rules changed after an external publication, a new identifier would be needed (`dcp-jcs-v1` §5) |
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
resting on how parsers read the path; the lab's design model does not measure it. What the SDK phases
measured is in §16 to §18 (for example the decoder readings of §16 and the matrix of §18.1).

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

Nothing here is activated. Only the experimental unit ingress (§15), router (§16), bytes verifier (§17) and producers (§18) are implemented. Moving to a later phase needs an explicit decision, taken
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

**Gates before phase 2 or 3** (requirements; their status is in the ledger of §18.4):

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
| The total precedence, with offsets, on 54 multi-defect documents and 12 multi-defect envelopes | A change of phase or of default: the producers of §18 are experimental and opt-in |
| The unit, the transport and envelope independence | A bytes API in the integrations or the server |
| Selection, policy and no retry, on synthetic bundles | A proof of output equivalence over the whole domain (§18.4, gate 3, is shown on samples) |
| That the candidate path does not depend on parser repairs | Historical readings beyond the units measured: `tests/interop/candidate/phase2-adapter-expectations.json` records 160 readings of real decoders (16 units × 10 adapters) where the historical adapter decides; that is evidence for those units only |
| The synthetic bundle's hash checks | Proof that every defect in a `dcp-jcs-v1` bundle keeps its verdict: §18.5 samples the 8 unit classes at 18 positions on two bases, for the bare unit only |
| | That delegation preserves each SDK's `dcp-jcs-v1` verdict beyond the cases of §16, §17 and §18.5, or for envelopes and servers |

## 13. Open questions

- The preservation of `dcp-jcs-v1` verdicts depends on historical parsers reading the profile path with
  the last-duplicate rule; it must be measured on each actual verifier entry path before implementation.
  §16, §17 and §18.5 measure it for the bare unit with each SDK's built-in adapters.
  A typed construction decoder is not necessarily the decoder used by a verifier. For object APIs,
  the caller's or integration's bytes-to-object decoder is part of that path: it can discard a BOM,
  repair invalid UTF-8, lose duplicate members or reject the body before verification. An adapter must preserve that
  existing path explicitly; replacing it with one common decoder does not establish historical parity.
- The byte-level transport contract changes the result for ambiguous envelopes and needs its own
  compatibility note. §18.5 records three envelope boundary cases, without claiming equivalence with any server.
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
profile (the router of §16 does) and emits nothing; the producers came in phase 4 (§18).

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

## 17. Experimental SDK verifier (phase 3)

Phase 3 of the SDK implementation plan adds an experimental, opt-in verifier of original bytes to each SDK.
It routes the bytes once with the router of §16 and runs at most one verifier:

- none for a rejection;
- for `v1_path`, today's V2 verifier, on exactly what a current caller would hand it;
- for `candidate`, today's V2 verifier, accepting exactly `dcp-jcs-v2` in the manifest.

There is no second attempt under another profile. It is not normative, and no existing or default path calls
it. `dcp-jcs-v1`, the existing verifiers and their defaults are unchanged, and their object and text APIs
still reject `dcp-jcs-v2`. The producers came in phase 4 (§18); the vectors below are signed by a test-only
generator. A verified candidate bundle grants no trust or
admission and authorizes nothing.

| SDK | API |
|---|---|
| TypeScript | `createExperimentalCandidateVerifier(config).verify(bytes, registry, policy?, options?)` |
| Python | `dcp_ai.v2.experimental_candidate_verify`: `create_verifier(...)` and `await verifier.verify(data, registry, policy=None, now_ms=None)` |
| Go | `NewExperimentalCandidateVerifier(ExperimentalCandidateVerifierConfig)` and `VerifyAt(registry, input, policy, now)` |
| Rust | `v2::experimental_candidate_verify`: `CandidateVerifier::new(config)` and `verify_at(input, policy, now_ms)` |
| WASM | `DcpWasm.createExperimentalCandidateVerifier(config).verify(bytes, policy?)`, over the binding `wasm_experimental_candidate_verify` |

**Configuration and parameters.** The configuration is the router's (§16): the transport, the accepted
profiles and the historical adapter, all required and none with a default.

- Go names its adapter by the closed name `encoding_json` and builds that decoder itself, so changing the
  exported `ExperimentalHistoricalEncodingJSON` changes nothing.
- The verification parameters are those of each SDK's V2 verifier, with the same defaults, the optional
  cryptographic policy included.

**Result.** The route, `entered` (`none`, `dcp-jcs-v1` or `dcp-jcs-v2`) and the verifier's result as is, which
is `null` when none ran. `entered` names the verification path that was started, its policy validation
included. It does not show that any cryptographic check ran: a verifier can stop at a policy, structure,
hash or session check first, and its result says so.

**The candidate path.** It is today's verifier with one change, the manifest profile it accepts; every hash,
signature and helper is today's. On the exact values the candidate accepts, the `dcp-jcs-v1` canonicalizer
gives the candidate's bytes (§3.4).

- TypeScript, Python and Rust verify the exact value.
- Go verifies the candidate's canonical bytes, so its parser never reads a literal the candidate normalized.

**Delegation.** It hands today's verifier exactly the input a current caller gives it.

- **TypeScript, Python and Rust:** the value the adapter decoded.
  - A decoded `null` is data, and is delegated.
  - When the decoder refused the data there is no value, and nothing runs (`entered: none`).
- **Go:** the unit bytes go to `VerifySignedBundleV2At`, which parses them itself.
- **WASM:** one `wasm_experimental_candidate_verify` call.
  - When it needs the decoder, the decoder is consulted once, and `resume`, which never verifies, ends in a
    rejection or a delegation.
  - A delegation hands the decoder's own string to `wasm_verify_signed_bundle_v2`, with the policy JSON
    `verifyBundle` sends: on `w1`, `JSON.stringify` of the decoded object; on `w2`, the text.
  - A decoder that refused leaves no string.
  - The binding keeps its V1 behavior: a V1 bundle verifies without a policy and is refused with one.

**Vectors.** [`tests/interop/candidate/phase3-signed-vectors.json`](../../../tests/interop/candidate/phase3-signed-vectors.json)
has 18 frozen bases and 57 cases.

- **Bases:** 16 signed bundles, the V1 conformance bundle, and `null`.
  - 15 are signed by a test-only generator of the TypeScript SDK (not a producer API).
  - The 16th is `B-reordered`: the same signed bundle as `B-v2`, with its members in reverse order and
    whitespace.
- **Cases:** a case is a base plus byte edits.
- **Expectations:** written by hand: the route, the adapter calls, `entered`, the verdict and the error
  substrings of each SDK, with overrides per adapter where the decoders differ.

| Group | Cases |
|---|---|
| Positives | 16: hybrid and classical-only; integers written as `1.0`, `1e2`, `-0` and 1 followed by 800, 801 or 5000 decimal zeros; ±(2^53-1); escapes; member order and whitespace; depth 64; a decoy profile outside the manifest; a new chain beside a v1 reference; a PQ checkpoint; keys named `__proto__` |
| Rejections before any verifier | 17 |
| Failures of the candidate | 14, each at the step it names |
| Delegations | 10 |

The generator's `--check` validates two things: the frozen bases (their hashes, payload and manifest hashes,
and declared profile), and every case and expectation. The TypeScript test verifies the 81 signatures of the
16 signed bases with the composite primitives, semantically invalid bases included.

**Tests.** Each SDK and WASM run:

- before any case, a check that the vectors carry exactly the 57 approved case IDs, each once; a missing,
  repeated or unknown ID fails it;
- the 57 cases, with each built-in adapter;
- the parity of each delegation with a direct call;
- an instrumented check that at most one verifier runs. It uses a test-only probe or counted bindings; no
  public API skips verification;
- the canonical bytes of every committed value of the positives: the unit, the manifest, the four payloads,
  the audit entries and the checkpoints. The candidate ingress accepts the `dcp-jcs-v1` canonical bytes of
  each, with the same exact value and the same bytes;
- the configuration;
- mutated buffers;
- today's APIs still refusing `dcp-jcs-v2`.

**Against the design model.**

| Design model | Phase 3 |
|---|---|
| `accept_v2` | A candidate route with `verified: true` and the real manifest hash |
| `COMMITMENT_MISMATCH` | `verified: false`, with the verifier's own errors. It may report several, and their order is not normative |
| Rejections | The routes of §16 |
| A delegation | Records today's verdict, which the model does not compute |
| — | Cryptographic failures (signatures, policy, key validity, session and checkpoints): new expectations, with no model equivalent |

**Gates.** At phase 3, none of the ten gates of §9 was declared met; the ledger is §18.4, and the candidate
stays inactive.

- **Evidence toward:**
  - gate 1: the synthetic bundle cases, re-expressed as real signed bundles;
  - gate 3: on the committed values of the positives;
  - gate 7: defects injected into a signed candidate bundle are rejected before any verifier, and in a
    `dcp-jcs-v1` bundle the delegated verdict is today's;
  - gate 8: one verifier, instrumented.
- **Not met:**
  - gate 6, the cross signing matrix, which needs producers; every signed bundle here comes from one test
    generator;
  - gates 2, 9 and 10, which need their own runs.

## 18. Experimental SDK producers (phase 4)

Phase 4 of the SDK implementation plan adds experimental, opt-in producers to each SDK and to WASM. They
make **new** evidence: artifacts signed as today's, and bundles whose new manifest signs
`canonicalization_profile: "dcp-jcs-v2"`. It is not normative, and no existing or default path calls them.
`dcp-jcs-v1`, its builders, signers and verifiers, and every default are unchanged; the profile stays
experimental and opt-in, including in npm SDK 2.2.0 and WASM 2.1.0. A bundle they produce grants no trust or admission and authorizes nothing.

| SDK | API |
|---|---|
| TypeScript | `experimentalCandidateSignPayload(registry, context, input, keys)` and `experimentalCandidateSignBundle(registry, parts, signer, options)` |
| Python | `dcp_ai.v2.experimental_candidate_produce`: `sign_payload(registry, context, input, keys)` and `sign_bundle(registry, parts, signer, options)`, which check and copy at the call and return an awaitable |
| Go | `ExperimentalCandidateSignPayload(registry, context, input, keys)` and `ExperimentalCandidateSignBundle(registry, parts, signer, options)`, with inputs `ExperimentalCandidateBytes` and `ExperimentalCandidateHostValue` |
| Rust | `v2::experimental_candidate_produce`: `sign_payload(context, input, keys)` and `sign_bundle(parts, signer, options)`, with `CandidateInput::{Bytes, Value}` |
| WASM | `DcpWasm.experimentalCandidateSignPayload(context, input, keys)` and `experimentalCandidateSignBundle(parts, signer, options)`, over the bindings `wasm_experimental_candidate_sign_payload` and `wasm_experimental_candidate_sign_bundle`, which receive only bytes |

**Inputs.** Each piece is either:

- **bytes:** the original bytes, checked by the phase 1 ingress (§15) before anything parses them. This is the
  way for JSON received from elsewhere: only the bytes keep what a parser repairs or loses;
- **a host value:** checked by a strict walk over the exact types of the language and encoded after the check.
  A value cannot show the literal it was parsed from, so a value already repaired by a parser cannot be detected.

Host values outside the domain are refused with `NUMBER_NOT_FINITE`, `NUMBER_NOT_INTEGER`,
`NUMBER_OUT_OF_RANGE`, `SURROGATE_UNPAIRED`, `UTF8_INVALID` (Go), `DEPTH_EXCEEDED`, `TYPE_UNSUPPORTED` or
`KEY_NOT_STRING` (Python). Integral floats, `-0` and, in TypeScript and WASM, BigInt are normalized to the
integer. Getters and `toJSON` are never invoked. Structs and foreign types are refused, never converted.

**`signPayload`** signs one artifact, `{payload, payload_hash, composite_sig}`, under a DCP context and with no
profile. The payload has at most 63 levels, so that the artifact has at most 64. The ingress accepts the
output bytes and gives them back unchanged.

**`signBundle`** assembles the bundle over exact values. Parts are artifacts, audit entries and optional PQ
checkpoints, each as bytes or a value.

- Members it does not know are kept. Those outside a payload, an entry, a checkpoint or the manifest are not
  signed, so their integrity is not claimed.
- Received evidence is never relabeled or recomputed. An artifact whose `payload_hash` is not its payload's
  is refused (`COMMITMENT_MISMATCH`), and the chain must start at `GENESIS` and link (`CHAIN_NOT_GENESIS`,
  `CHAIN_BREAK`).
- The signer must be the responsible principal (`SIGNER_MISMATCH`).
- The session start is never stamped from the clock. With an expiry, `session_issued_at` is required
  (`SESSION_ISSUED_AT_REQUIRED`), and the dates must be valid (`SESSION_INVALID`).
- An empty audit trail gives `audit_count: 0` and roots of 64 zeros.
- `dualHash` (default off) adds the SHA3-256 root and `hash_alg: sha256+sha3-256`.
- `created_at` is outside every signature and is not protected.
- The whole unit is checked to have at most 64 levels before any signature.
- The router of §16 routes the output as `candidate`, with `canonical_sha256` equal to the SHA-256 of the
  output bytes.

**Errors.** A rejection of this contract carries its class, the part and a JSON Pointer or byte offset, and is
raised before any signer is called (the tests count zero signer calls). A misuse of the API is a usage error:
`TypeError`, `ErrExperimentalCandidateUsage` or `ProduceError::Usage`. Errors of the key, the registry or the
provider stay today's.

**Against today's builders.** These are new APIs, not options of the `dcp-jcs-v1` builders, and they differ
on purpose: explicit dates, the same `dualHash` default everywhere (the Go, Rust and WASM v1 builders add the
secondary root by default), and assembly over exact values.

### 18.1 Cross matrix (`tests/interop/candidate/phase4/`)

Five producers (TypeScript, Python, Go, Rust and WASM) sign the same input bytes with their public opt-in APIs.
Every consumer verifies every output with the verifier of §17. The runner and its specifications are in
[`tests/interop/candidate/phase4/`](../../../tests/interop/candidate/phase4/); the synthetic keys are made per
run and are never written outside the run directory.

- **Positives:** 12 specifications (`S01`–`S12`) in bytes and value modes, plus a ring: `S01` assembled from the
  artifacts the next producer signed. That makes 115 units, each verified by 5 consumers: 575 results.
  They cover:
  - hybrid and classical-only signing, a dual hash, a PQ checkpoint;
  - ±(2^53−1);
  - keys with U+E000 and U+1F600;
  - U+FEFF at the start of a string, U+FFFD, U+2028 and `\u0000`;
  - depth 64;
  - unsigned extension members;
  - members named `__proto__`, `constructor` and `toJSON`;
  - integers written with 800 and 5000 decimal zeros (bytes);
  - `1.0` and `-0.0` (values).
- **Negatives:** 16 byte-level edits of each producer's fresh output, verified by every consumer: 400 results.
  - Before any verifier: a BOM, invalid UTF-8, a syntax error, a lone surrogate, a duplicate, a fraction, a
    number out of range, depth 65, transport errors, an unknown profile and a profile not accepted.
  - On the candidate path, failing there: a changed payload, a changed manifest, and a flipped classical or
    PQ signature.
- **Checks of the runner:**
  - the exact set of 975 results, steps and fields;
  - freshness: run ID, dates and file times;
  - the decoder calls each consumer observed (1 for BOM, UTF-8 and syntax, 0 otherwise);
  - for each specification, the same `manifest_hash` from every producer, and the same unit except for the
    ML-DSA signature values (randomized), masked only at their known places;
  - the same key IDs derived by every SDK;
  - a deadline that kills the whole process group;
  - `--self-test` checks each of these refusals.

### 18.2 Host values (gate 2)

Each corpus ID is classified per language as:

- **R:** represented exactly, with the class of the bytes;
- **T:** represented only as an already transformed value, whose class may change;
- **P:** refused by the parser first;
- **N:** not representable.

Every R and T cell is tested in its SDK, P and N are documented. The marking `needs_original_bytes: false`
only means that a parser can already refuse the case.

| ID | Bytes | TS / WASM | Python | Go | Rust |
|---|---|---|---|---|---|
| `n-two53`, `n-1e20`, `n-1e21`, `n-fraction`, `s-depth-65`, `s-depth-129` | as in the corpus | R | R | R | R (depths built directly) |
| `n-two53-plus-one`, `n-neg-two53-plus-one`, `n-int64-max`, `n-sci-over` | `NUMBER_OUT_OF_RANGE` | R with BigInt; T with number (rounded, still out of range) | R (int) | R (int64) | R (i64) |
| `n-overflow` (`1e400`) | `NUMBER_OUT_OF_RANGE` | R with BigInt; T with number (`Infinity`: `NUMBER_NOT_FINITE`) | R (int); T with float (`inf`) | N as an integer; R as the `json.Number` literal; T with float64 (`+Inf`) | N |
| `n-huge-exponent` (a 5000-digit exponent) | `NUMBER_OUT_OF_RANGE` | N as an integer (it cannot be materialized); T (`Infinity`) | N; T (`inf`) | R as the `json.Number` literal, refused without building the number; T (`+Inf`) | N |
| `n-nan`, `n-negative-infinity` | `SYNTAX` | T (`NUMBER_NOT_FINITE`) | T | T | N |
| 9 syntax IDs (leading zero, plus sign, bare dot, raw control, trailing comma or data, two values, empty input, NBSP) | `SYNTAX` | P | P | P | P |

The T cells of `n-huge-exponent` use a shorter literal (`1e99999`) that a parser also turns into an infinity.
The 22 cases marked `true` stay outside the reach of values; for them, the bytes are the way.

### 18.3 Cost (gate 10)

The cost is measured on one equivalent pair per platform. Both sides use the same keys, payloads, session and
audit entries, and the runner checks this on the outputs before measuring: the same four `payload_hash`, the
same nonce and session dates, and the same entries. The v1 bundle comes from each SDK's builder and signer, the
candidate from the producer.

Each operation runs 20 times after 3 warm-ups, with at most 60 s per platform, and the builds are timed
apart. Run it with `node tests/interop/candidate/phase4/run.mjs --cost`. Medians in ms, from one run on one
machine (Apple M5 Pro; Node 22.15, Python 3.12, Go 1.26, Rust 1.93 release):

| Platform | Produce v1 | Produce candidate | Verify today | Verify v1 (`v1_path`) | Verify candidate |
|---|---|---|---|---|---|
| TypeScript | 40.3 | 48.1 | 20.2 | 20.7 | 32.0 |
| Python | 22.8 | 27.6 | 3.5 | 7.7 | 7.7 |
| Go | 3.2 | 7.0 | 2.1 | 2.9 | 2.5 |
| Rust | 2.3 | 3.0 | 0.7 | 0.9 | 0.8 |
| WASM | 4.1 | 4.8 | 1.5 | 2.1 | 1.4 |

**Limits.** These times are not a measure of the canonicalization alone, and they show neither an improvement
nor a regression:

- **The outputs differ.** The v1 bytes are each SDK's JSON serialization (Python's has spaces), while the
  candidate's are canonical.
- **The builders differ.** The Go, Rust and WASM v1 builders add the secondary root, and the candidate here
  does not.
- **Go's entries.** The v1 builder takes typed entries, so its `AuditEvidenceV2` drops null members. Both
  sides of the Go pair sign the same entries, rebuilt through it.
- **What "Verify today" includes.** It includes decoding the bytes where the API takes an object or a value
  (`JSON.parse`, `json.loads`, `serde_json::from_slice`). Go's API takes bytes and parses them itself.
- **Variance.** Medians varied between runs on the same machine. For example, TypeScript's candidate
  verification gave about 22 ms in a previous run.

There is no SLA, and nothing was relaxed to compensate.

### 18.4 Ledger of the ten gates (§9)

This ledger records evidence; it activates nothing. A change of phase or default needs its own decision.

| # | Gate | Status | Evidence | Limits |
|---|---|---|---|---|
| 1 | Corpus parity | Met | §15: the 87 baseline units and 81 bare design cases in four SDKs, and the same 168 cases in WASM. §17: the synthetic bundle cases as real signed bundles. §16: real decoder readings instead of the `historical` parameter | The v0.3 depth-rule cases demonstrate the model and are not requirements |
| 2 | Object API scope | Met, with the scope of §18.2 | §18.2: every R and T cell tested per language, each refused with its class before signing. TypeScript, Python, Go and WASM count zero signer calls per cell. Rust's cells use keys that cannot sign, so a signer call would surface as a provider error instead; its counted zero calls are in its focused unit tests | The 22 cases marked `true` and the P and N cells are outside the reach of values |
| 3 | Output equivalence on values | Met, on samples | §15: the `dcp-jcs-v1` comparison on accepted values. §17: the committed values of the positives. §18.1: 115 units equal across five producers. §18.3: the same payload hashes from the v1 signer and the producer | Shown on the corpus, the vectors and the matrix, not proven over the whole domain |
| 4 | Ingress parity from bytes | Met | §15, in four SDKs and WASM | Unit cases |
| 5 | Historical readings | Not a gate | §16 records them as diagnostics | — |
| 6 | Cross signing matrix | Met | §18.1: 5 × 5 plus the ring, 975 of 975 results, with every boundary payload of the gate. The `dcp-jcs-v1` interop matrix (`tools/interop-matrix`, both scenarios) passes at closure | Local runs on one machine; the workflow runs it again on each change |
| 7 | Negative matrix | Met, on samples | Candidate side: §18.1, every class of the corpus, and the transport and profile classes, rejected before any verifier, 5 × 5, and candidate failures on the candidate path. `dcp-jcs-v1` side: §18.5, 38 cases (18 mutations of the 8 unit classes on two bases, plus 2 controls) × 10 configurations in four SDKs and WASM, 380 comparisons: the experimental verifier gives today's result, and both equal committed expectations | Sampled classes and positions, not a universal proof. The bare unit only: no equivalence is claimed for envelopes or servers. WASM is hosted in Node and measured at its binding boundary |
| 8 | Selection, precedence and policy | Met | §16 and §17, with one verifier instrumented | — |
| 9 | History | Met | At closure, with the new code in place: conformance (V1 and V2, with the admission cases), every SDK's full test suite, the WASM tests (bundle vectors and V1 verification included) and the `dcp-jcs-v1` interop and admission matrices, all green. No campaign of phases 1 to 3 was repeated | Local runs on one machine |
| 10 | Cost | Met | §18.3 | One machine, no SLA, the limits of §18.3 |

### 18.5 Gate 7 on the `dcp-jcs-v1` side (`tests/interop/candidate/gate7-v1-negatives.json`)

Gate 7 asks two things. The candidate side (a defect of each class, injected into a candidate bundle, is rejected
with that class before any verifier) is §18.1 and §17. This section is the other side: the same defect, injected at
byte level into a `dcp-jcs-v1` bundle, keeps today's verdict when the bytes go through the experimental verifier of
§17. It covers the bare unit only.

**Corpus.** The fixture reuses two frozen bases of the phase 3 vectors, by reference and hash: `B-v1` (the manifest
names `dcp-jcs-v1`) and `B-absent` (the field is absent). Nothing is signed again. The same 18 byte-level mutations
apply to both bases:

| ID | Class | Position |
|---|---|---|
| M01 | `BOM` | before the unit |
| M02, M03 | `UTF8_INVALID` | an unsigned member; the signed intent |
| M04, M05 | `SYNTAX` | a trailing comma; the unit cut short |
| M06, M07 | `SURROGATE_UNPAIRED` | an unsigned member; the signed intent |
| M08, M09, M10 | `DUPLICATE_KEY` | an unsigned member; the signed intent with the same value last; with another value last |
| M11, M12, M13 | `NUMBER_NOT_INTEGER` | an unsigned member; the signed policy decision; an audit entry |
| M14, M15 | `NUMBER_OUT_OF_RANGE` | `2^53+1` in an unsigned member; in the signed policy decision |
| M16, M17, M18 | `DEPTH_EXCEEDED` | 64 nested arrays in an unsigned member (level 65); 199 (level 200); 64 replacing the signed `risk_score` |

That gives 38 cases (18 mutations × 2 bases, plus the 2 bases as controls). Each case has an expectation for each of
10 configurations, in five implementations: the TypeScript, Python, Go and Rust SDKs, and the WASM package hosted
in Node (not in a browser).

| Implementation | Configurations (built-in adapters or paths) |
|---|---|
| TypeScript | `textDecoderJsonParse`, `bufferUtf8JsonParse` |
| Python | `json_loads_bytes`, `json_loads_strict_decode` |
| Go | `encoding_json` |
| Rust | `serde_json_from_slice` |
| WASM | `w1TextDecoderJsonParse`, `w1BufferUtf8JsonParse`, `w2TextDecoder`, `w2BufferUtf8` |

That is 380 bare comparisons. Three envelope cases (`G7E-1` to `G7E-3`) form a separate boundary section, 30 more
checks, with no equivalence claimed (below).

**The two routes.** For each case and configuration, two routes get the same bytes, clock and default verifier
policy:

- the experimental verifier of §17, bare, accepting `["dcp-jcs-v1"]`;
- today's route of the same implementation, written out in the test: the real decoder, then today's V2 verifier.
  It never goes through the adapter object or the router. In Go, the verifier parses the bytes itself; on WASM
  `w1`, `JSON.parse` and then `verifyBundle`; on `w2`, the text goes straight to the binding.

**Judgement.**

- The two results must be deeply equal on every declared field of the implementation's result; a new field makes
  the test fail until it is declared.
- Both must equal the committed expectation. It pins the route (outcome, class, profile source, warnings, whether
  the decoder succeeded), the decoder calls, the verifier entered, today's outcome and, through a named shared
  shape, `verified`, error substrings and the exact error count, warnings, the mode, the tier and `manifest_valid`.
- The expectations were reasoned from the parsers and verifiers, never generated from an output; each shape says
  why. One reasoned WASM error text was corrected after it was explained from `serde_json`'s code: a leading
  surrogate not followed by `\u` gives "unexpected end of hex escape". Both routes returned the same text.

**Outcomes of today's route.**

- `verified_result`: the verifier returned a result.
- `host_decode_error`: the host decoder that runs before any verifier refused the bytes (TypeScript and WASM `w1`:
  `SyntaxError`; Python: `JSONDecodeError` or `UnicodeDecodeError`; Rust: the serde category).
- `in_band_parse_error`: a verifier that parses the input itself returned the parse failure inside its result (Go,
  and the WASM binding on `w1` and `w2`). It counts only in its strict form and when the same parser refuses the same
  input; otherwise it is a verifier error.
- A verifier exception, panic or error envelope, and any harness failure, is never parity and never a rejection.

When a parse fails, the experimental route can end in three ways, and the fixture says which for each case:

- rejected, with no verifier (a unit the scanner cannot walk, refused by its decoder);
- delegated with the decoder's failure, with no verifier (Rust, for a lone surrogate or 200 levels);
- delegated, with the verifier still parsing and failing in band (Go, and WASM for M06, M07 and M17).

**Controls.**

- The verifiers really entered are observed, not read from the result: TypeScript's and Go's test probes, Python
  module references, Rust's `verify_routed` probe, and WASM bindings counted at the binding boundary (one verify,
  one resume per decoder call, one delegation exactly when `dcp-jcs-v1` is entered). Exactly none or one
  `dcp-jcs-v1` entry is accepted; a candidate entry or a second entry fails.
- In Go, Rust and WASM, the public verifier must give the instrumented route's result.
- The input buffer must be unchanged after each call.
- The two controls must verify; a failed or missing control invalidates every case of its base.
- Each test checks that every expected comparison ran, and fails when none did.
- Self-tests show the judgement can fail: a later clock, one changed error, a verifier exception on both sides, an
  extra or missing entry, and fakes in which both routes reject everything or accept everything.
- WASM's binding reads `Date.now`: each call on both routes runs with it fixed to the fixture's instant and restores
  it in `finally`, also after a throw.
- The checker [`gate7-v1-negatives.py`](../../../tests/interop/candidate/gate7-v1-negatives.py) rebuilds every input
  and checks the fixture strictly: exact IDs and configurations, every hash, an identity of each mutation's class,
  position and edits, closed decoder-error kinds per configuration, and the consistency of each expectation. Its
  negative controls are [`test_gate7_v1_negatives.py`](../../../tests/interop/candidate/test_gate7_v1_negatives.py).

**Boundary: envelopes, separate.** `G7E-1` puts `B-v1` in a valid envelope: it must verify with the same fields as
the bare control. `G7E-2` (a second `signed_bundle` member) and `G7E-3` (a BOM before the envelope) are rejected by
the transport, with no decoder call and no verifier entry. No historical SDK API reads an envelope; the reference
server keeps the last duplicate. No equivalence with a transport or a server is claimed. The configuration,
transport and profile classes stay on the boundary already set and tested by §16 and §17.

**Reproduce.** The test files are [TypeScript](../../../sdks/typescript/src/__tests__/experimental-candidate-gate7.test.ts),
[Python](../../../sdks/python/tests/test_experimental_candidate_gate7.py),
[Go](../../../sdks/go/dcp/v2/experimental_candidate_gate7_test.go),
[Rust](../../../sdks/rust/src/v2/experimental_candidate_gate7_tests.rs) and
[WASM](../../../sdks/wasm/test/experimental-candidate-gate7.mjs). The Python test needs the SDK installed with its
dev extras; the WASM test needs `npm run build` first.

```bash
python3 -I tests/interop/candidate/gate7-v1-negatives.py --check
python3 -I tests/interop/candidate/test_gate7_v1_negatives.py
(cd sdks/typescript && ./node_modules/.bin/vitest run src/__tests__/experimental-candidate-gate7.test.ts)
(cd sdks/python && python -m pytest tests/test_experimental_candidate_gate7.py)
(cd sdks/go && go test ./dcp/v2 -run TestGate7)
(cd sdks/rust && cargo test --all-features --lib gate7_tests)
(cd sdks/wasm && node test/experimental-candidate-gate7.mjs)
```

In CI, the conformance job runs the checker and its controls, and each SDK's job runs its file. At closure, the 380
comparisons and the 30 boundary checks pass, and no route diverged.

**Limits.**

- Sampled classes and positions: 8 classes at 18 positions on two bases. It is not a proof over every defect or
  bundle; gate 3 also stays on samples.
- The bare unit only. Envelopes, servers and the configuration, transport and profile classes are outside it.
- Today's verdicts are recorded, not judged; where implementations differ, that is a `dcp-jcs-v1` diagnostic
  (gate 5).
- WASM is hosted in Node, not in a browser, and is measured at its binding boundary; the cryptographic calls inside
  the module are not counted.
- The candidate stays experimental and opt-in; `dcp-jcs-v1` and every default are unchanged, and nothing is
  activated.
