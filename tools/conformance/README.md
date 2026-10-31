# DCP-AI conformance kit

`tools/conformance.js` runs the suites declared in [`catalog.json`](catalog.json) against the committed
fixtures and vectors. The catalog is versioned (`kit_version`) and pins, for every suite, the exact case
ids it must produce. The kit reads fixtures only: it generates no keys or fixtures in the checkout, and it
does not change canonicalization, signatures, profiles, schemas or vectors.

## Commands

```bash
npm run conformance                                    # every suite (same as node tools/conformance.js)
node tools/conformance.js --list                       # suites, pinned case counts and inventory
node tools/conformance.js --suite v1.integrity --suite v2.hashes
node tools/conformance.js --report /tmp/conformance.json
node --test tools/conformance/conformance.test.mjs     # runner self-tests (temporary copies only)
```

Fixture, schema and catalog paths resolve from the script, not from the current directory. Run the
commands above from the repository root; from another directory, invoke the script by its absolute path
(`node /path/to/dcp-ai/tools/conformance.js`). `--root <dir>` points the kit at another copy of the
fixtures (the self-tests use it on temporary copies).

## Contract

| Exit | Meaning |
|------|---------|
| 0 | Every selected case passed |
| 1 | At least one discrepancy (a value or verdict differs from its expectation) |
| 2 | Usage error: unknown argument, unknown, duplicate or empty suite id, `--list` with `--report` |
| 3 | Infrastructure error: missing or malformed fixture, malformed expectation, unknown config kind, missing or malformed catalog, exception, a pinned case not produced or an unpinned one produced, or no check executed |

- A missing or extra case is an error, so removing one vector from a collection that still has others
  cannot silently reduce coverage. A suite that throws fails even after it produced every pinned case.
- With `--report`, an `incomplete` placeholder is written before the run and replaced by the final report;
  a usage or catalog error also replaces the file. This holds for errors the kit handles and a writable
  report path: if Node cannot start or the file cannot be written, an older file can remain, so a consumer
  checks the exit code and the report's `run.id` and `status` instead of trusting an existing file.
- The report carries `kit` (name, version, catalog SHA-256), `run` (uuid, timestamps, root, Node version),
  `selection`, `status`, `totals` (`cases`, `executed`, `pass`, `fail`, `error`), every suite with its
  claim, limits and cases (`status`, and `kind`: `discrepancy`, `fixture`, `expectation`, `exception` or
  `catalog`), the inventory and the global limits.

## Suites

| Suite | Cases | Spec | Schemas / vectors | What a pass proves |
|-------|-------|------|-------------------|--------------------|
| `v1.schema` | 7 | DCP-01, DCP-02, DCP-03, `BUNDLE.md` | `schemas/v1`, `tests/conformance/examples/*.json` | Schema validity only |
| `v1.integrity` | 9 | `VERIFICATION.md` (V1), DCP-03 | `citizenship_bundle.signed.json`, `keys/public_key.txt`, `golden_vectors.json#v1_bundle_verification` | Ed25519 signature, bundle hash, Merkle root, intent hash, entry hashes and `prev_hash` chain of one fixture, compared with the golden values; key metadata consistent |
| `v2.canonicalization` | 11 | `CANONICALIZATION_PROFILE.md` | `golden_vectors.json#canonicalization`, `#v2_canonicalization`, `interop_vectors.json#canonicalization` | `dcp-jcs-v1` bytes of the reference canonicalizer |
| `v2.hashes` | 9 | DCP-AI-v2.0 §2.3, §10.3 | `golden_vectors.json#hash_vectors`, `#dual_hash_vectors` | SHA-256 / SHA3-256 values, dual hashes and dual Merkle roots |
| `v2.signed_bundle` | 10 | `VERIFICATION.md` (V2) | `lib/verify.js`, bundle built in memory | Verdicts of the reference verifier for valid and tampered bundles; verified is not admission |
| `v2.secondary_sha3` | 51 | `VERIFICATION.md` V2-11 and its erratum | `secondary_sha3_vectors.json`, `lib/verify.js` | Verdicts of the reference verifier on the secondary SHA3-256 fields that are present, with a control per rejected case; not a complete secondary chain |
| `v2.schema` | 4 | DCP-AI-v2.0 | `schemas/v2`, `*_v2.json` examples | Schema validity only |
| `ext.dcp05_09.schema` | 18 | DCP-05 to DCP-09 | `schemas/v2`, `<record>_v2.json` examples | Schema validity only |
| `ext.dcp05_09.wire` | 28 | DCP-05, DCP-08, DCP-09, `V2-WIRE-COMPATIBILITY.md` | `schemas/v2`, records signed in memory, `interop_vectors.json#domain_separation_all_contexts` | Representation, schema validity and signature of these records as separate layers; not functional conformance |
| `admission.strict_v1` | 117 | `spec/profiles/admission` | `admission_vectors.json` | Expected admission outcome and error codes; `action_authorized` is always false |

## Limits

- Passing a subset certifies those checks on these fixtures only, not a complete DCP implementation,
  another SDK or a deployment. Schema suites prove schema validity only; the V2 schema suite does not
  make a V2 implementation without the canonicalization, hash and signature suites.
- `verified` and `admitted` never authorize an action.
- Adapters (Express, FastAPI, OpenClaw, the verification server) are not part of the kit.
- Protocol points, per `spec/V2-WIRE-COMPATIBILITY.md`: the DCP-09 expiry field (`valid_until`) and the
  signature contexts of DCP-05, DCP-08 and DCP-09 are corrected by errata and tested by `ext.dcp05_09.wire`.
  Still pending an explicit, versioned design, and not decided by the kit: fractional DCP-05
  `vitality_report` metrics (only 0 and 1 are representable under `dcp-jcs-v1`), DCP-08 §4.3 reverse-domain
  rights (refused by the `right_type` enum), and second signers or acknowledgments (DCP-05 §4.4, DCP-09 §3.3
  and §6.3). The DCP-04, DCP-06 and DCP-07 examples are outside these errata.

## Inventory

Listed by `--list` and in the report, outside the totals: they are not executed by this kit, and their
presence is not a passed test. `interop_vectors.json` attack vectors, canonicalization edge cases and other
categories, and bundle and mandate vectors run in the SDK test suites. `tests/nist-kat/` holds
known-answer vectors and property tests, each with its own scope (see
[its README](../../tests/nist-kat/README.md)); they also run in the SDK test suites. The `dcp-jcs-v2`
candidate is experimental, outside `dcp-jcs-v1`, and has its own suite (`tests/interop/candidate/`).

## External implementations

`tools/conformance-external.js` runs a separate catalog, [`external-catalog.json`](external-catalog.json)
(contract `dcp-ai-conformance-external/1`), against an implementation you give as argv after `--`. The
implementation can be written in any language: it reads one JSON request on stdin and writes one JSON response
on stdout. The runner needs Node 20 or later and uses only built-in modules. The command, catalog and report above
are unchanged.

```bash
node tools/conformance-external.js --list
node tools/conformance-external.js --report /tmp/external.json -- node tools/conformance/wrappers/ts-sdk.mjs
node tools/conformance-external.js -- /path/to/python -I tools/conformance/wrappers/python_sdk.py
node tools/conformance-external.js --suite external.digest -- ./my-implementation --its-own-flag
node --test tools/conformance/external.test.mjs
DCP_EXTERNAL_PYTHON=/path/to/python DCP_EXTERNAL_REQUIRE_PYTHON=1 node --test tools/conformance/external.test.mjs
```

Without `DCP_EXTERNAL_PYTHON`, `node --test` skips the Python wrapper and says so; with
`DCP_EXTERNAL_REQUIRE_PYTHON=1`, a missing interpreter is a failure instead. The last command runs every test.

| Suite | Cases | Vectors |
|-------|-------|---------|
| `external.dcp-jcs-v1.canonicalize` | 30 | `golden_vectors.json#canonicalization`, `#v2_canonicalization`; `interop_vectors.json#canonicalization` and its 19 `edge_cases`, 3 of which must be rejected |
| `external.digest` | 8 | `golden_vectors.json#hash_vectors`; `#dual_hash_vectors` raw and intent, SHA-256 and SHA3-256 |

A minimal exchange, the SHA-256 of zero bytes, which you can run against the TypeScript wrapper:

```bash
printf '%s' '{"contract":"dcp-ai-conformance-external/1","run_id":"00000000-0000-4000-8000-000000000000","nonce":"00000000000000000000000000000000","cases":[{"id":"c1","op":"digest","alg":"sha256","input_b64":""}]}' | node tools/conformance/wrappers/ts-sdk.mjs
```

A valid response to that request (the wrapper also adds `resolved_from` and `runtime`):

```json
{"contract":"dcp-ai-conformance-external/1","run_id":"00000000-0000-4000-8000-000000000000","nonce":"00000000000000000000000000000000","implementation":{"name":"example","version":"0.0.1"},"results":[{"id":"c1","status":"ok","hex":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}]}
```

- **Envelopes:** the request and the response are UTF-8 JSON. The response is exactly one JSON document on stdout,
  and the process exits with code 0.
- **Request:** `contract`, `run_id`, `nonce` and `cases`, each with `id`, `op` (`canonicalize` with `profile`
  `dcp-jcs-v1`, or `digest` with `alg` `sha256` or `sha3-256`) and `input_b64`. Ids are random per run and no
  expectation is sent. A canonicalize input is JSON text: an `input_json` vector exactly as committed, an `input`
  value as `JSON.stringify` writes it.
- **Response:** the same `contract`, `run_id` and `nonce`; `implementation` (`name`, `version`, optional
  `resolved_from` and `runtime`, all self-declared); and `results`, an array with exactly one object per case, each
  carrying that case's `id` and a `status`: `ok` with `output_b64` (the canonical bytes) or `hex`, `rejected` with
  `code` `parse` or `profile`, `error` with `message`, or `unsupported`. No other field is accepted.
- **Encodings:** `input_b64` and `output_b64` are RFC 4648 base64 with the standard alphabet, padding and no line
  breaks, in canonical form; `hex` is exactly 64 lowercase hexadecimal characters.
- **Judgement:** bytes are compared exactly, and a vector that must be rejected passes only when rejected. An
  `error` or `unsupported` result, a malformed, missing, duplicate or extra result, a stale `run_id` or `nonce`,
  invalid output, a non-zero exit or a signal, a timeout and stdout over 4 MiB are errors, never a pass. The exit
  codes are those of the [contract](#contract).
- **Process:** started without a shell, in its own process group on POSIX. One deadline (`--timeout-ms`, default
  30 000) is measured on a monotonic clock; then SIGTERM, SIGKILL 2 s later and a bounded 2 s wait for the pipes to
  close (`cleanup_incomplete` otherwise). stderr is kept up to 64 KiB and never parsed.
- **Catalog and fixtures** are validated first: unique ids, existing pointers, expectations consistent with the
  vectors, and every member of each collection pinned once per operation and algorithm. A defect is exit 3. The
  report records the catalog, fixture and request hashes, and the implementation's self-declared identity apart from
  what the runner observed.
- **Report:** a missing, option-like or repeated `--report` value is a usage error (exit 2) and no report is written,
  because the path is ambiguous. As with the command above, an older report can also remain if Node cannot start,
  the report cannot be written or the runner is killed. Always check the exit code, then the report's `run.id` and
  `status`.
- **Wrappers:** `wrappers/ts-sdk.mjs` (`@dcp-ai/sdk`; `--sdk <path>` is optional) and `wrappers/python_sdk.py` (the
  installed `dcp_ai`; run it with `-I`). Each calls the real canonicalizer once and reports `rejected`/`profile` only
  for the SDK's documented float rejection. The SDKs have no stable error codes, so it is recognised by its type and
  message: if those change, a correct rejection shows as an error, never as a pass. CI runs both wrappers.
- **Limits:** a pass shows that the argv that was run passes these 38 cases, through the parser it uses; it is not
  a complete `dcp-jcs-v1` implementation or DCP conformance, and the identity is self-declared. This is not a
  sandbox: the implementation runs with your privileges and environment, descendants that leave the process group
  (`setsid`) are not seen, and on Windows only the direct child is killed.

### Go, Rust and WASM wrappers

Three more wrappers run the same 38 cases and the same contract against the Go SDK, the Rust SDK and the
WASM build of the Rust SDK, all from this checkout. `build.mjs` compiles them into
`tools/conformance/wrappers/.build/` (ignored by Git); it needs Go 1.25 or later, Cargo, and `wasm-pack` with the
`wasm32-unknown-unknown` target. It installs or publishes no DCP package and changes no SDK manifest or
lockfile. Without `--offline`, Cargo and `wasm-pack` may download build tools and the pinned dependencies into their
caches; `--offline` sets `GOPROXY=off`, Cargo `--offline` and `wasm-pack --mode no-install`, and needs those caches
already filled.

```bash
node tools/conformance/wrappers/build.mjs all
node tools/conformance/wrappers/build.mjs --offline go rust wasm
node tools/conformance-external.js -- tools/conformance/wrappers/.build/go-wrapper
node tools/conformance-external.js -- tools/conformance/wrappers/.build/rust-target/debug/dcp-ai-conformance-wrapper
node tools/conformance-external.js -- node tools/conformance/wrappers/wasm.mjs
DCP_EXTERNAL_REQUIRE_NATIVE=1 node --test tools/conformance/external-native.test.mjs
```

- **Builds:** Go builds with `-mod=readonly` against the wrapper's `go.mod` and `go.sum`, whose versions are a
  subset of the SDK's own; Cargo builds with `--locked`, the native wrapper with its `Cargo.lock` (a copy of the
  SDK's lock, resolved offline, with the same pinned versions) and the WASM artifact with the SDK's `Cargo.lock`.
  `--offline` uses only the local caches. No SDK manifest or lockfile changes.
- **Go** (`wrappers/go`): the input must be UTF-8 (checked first, because `encoding/json` would replace invalid
  bytes), then `json.Unmarshal` into `interface{}`, as the SDK's own interop test does, then one call to
  `v2.CanonicalizeV2`; only its documented rejection (`non-integer float at`, `non-finite float at`) is
  `rejected`/`profile`. Digests: `v2.SHA256Hex`, `v2.SHA3256Hex`. The version is reported as the local checkout.
- **Rust** (`wrappers/rust`): fatal UTF-8 decoding, `serde_json::from_str`, then one call to
  `dcp_ai::v2::canonicalize::canonicalize_v2`; only its documented rejection (`Non-integer number in V2 canonical form:`, `Non-finite number in V2 canonical form:`, behind path prefixes) is `rejected`/`profile`. Digests:
  `sha256_hex`, `sha3_256_hex`. The version is `DCP_SDK_VERSION`.
- **WASM** (`wrappers/wasm.mjs`): it loads the real `.wasm` that `wasm-pack` compiled from `sdks/rust` with the
  `wasm` feature (`--target web`) and reports its SHA-256. The raw JSON text goes to one call of
  `wasm_canonicalize_v2`, with no `JSON.parse` or `JSON.stringify` in JavaScript before the call;
  afterwards the input and the output are only inspected to mark ambiguity, and no bytes are recomputed. That export reports errors in band
  as `{"error": "…"}`, which a valid input can also produce, so a single-key `{"error": string}` result is an
  ambiguous `error` when the input is itself a root object whose only key is `error` (whatever its value), and
  otherwise a rejection only for the documented messages. The digest exports take text: the 8 digest inputs are text, and bytes that are not UTF-8
  are an `error`, never substituted.
- **Errors:** in all three, a request with a wrong type (for example `input_b64` that is a number or `null`, or
  `cases` that is not an array) is invalid and the wrapper exits with 2; any error other than the documented rejection is `error`. In Rust and WASM, the documented number rejection is recognised in one
  linear pass, with no backtracking regular expression; a message over 1 MiB of UTF-8 is an `error`, never a
  rejection (the limit applies to that classifier, not to parse errors). Without `DCP_EXTERNAL_REQUIRE_NATIVE=1`, `node --test` skips what is not built and says so;
  with it, a missing toolchain or artifact fails. CI builds the three wrappers from the checkout and runs the 38
  cases through each, so the five wrappers are required there.
- **Limits:** the WASM wrapper calls the raw wasm-bindgen exports hosted in Node: it does not cover the
  `@dcp-ai/wasm` package's JavaScript API (such as `DcpClient`) or a browser. The classification of rejections depends on message text,
  since the SDKs have no stable error codes, and through WASM a root single-key `{"error": …}` input is an ambiguous
  error only when the export returns the `{"error": string}` envelope (`{"error":5}` stays `ok`). A pass shows these 38 cases pass through each wrapper, nothing more.

### Evidence catalog: Merkle and signature verification

`--catalog evidence` selects an opt-in catalog, [`external-evidence-catalog.json`](external-evidence-catalog.json)
(contract `dcp-ai-conformance-external/2`, 241 cases), run against the same kind of argv. The default catalog,
contract `/1` and its 38 cases do not change; the catalog's `contract` chooses how it is loaded and judged. The
five wrappers accept both contracts and answer with the contract of the request. Only committed public fixtures
are used: no key is generated and nothing is signed.

```bash
node tools/conformance-external.js --catalog evidence --list
node tools/conformance-external.js --catalog evidence --report /tmp/evidence-ts.json -- node tools/conformance/wrappers/ts-sdk.mjs --sdk sdks/typescript/dist/index.js
node tools/conformance-external.js --catalog evidence -- /path/to/python -I tools/conformance/wrappers/python_sdk.py
node tools/conformance-external.js --catalog evidence -- tools/conformance/wrappers/.build/go-wrapper
node tools/conformance-external.js --catalog evidence -- tools/conformance/wrappers/.build/rust-target/debug/dcp-ai-conformance-wrapper
node tools/conformance-external.js --catalog evidence -- node tools/conformance/wrappers/wasm.mjs
DCP_EXTERNAL_PYTHON=/path/to/python DCP_EXTERNAL_REQUIRE_PYTHON=1 DCP_EXTERNAL_REQUIRE_NATIVE=1 node --test tools/conformance/external-evidence.test.mjs
```

| Suite | Cases | Vectors |
|-------|-------|---------|
| `external.merkle.dual_root` | 6 | `tests/conformance/v2/merkle_vectors.json`: 1, 2, 3 and 5 leaves and reordered leaves (`spec/VERIFICATION.md` V2-11), generated offline with the Python standard library |
| `external.signature.composite` | 24 | `interop_vectors.json`: composite and classical-only signatures, their committed attacks and deterministic alterations of each positive |
| `external.v2.bundle_vectors` | 131 | `bundle_vectors.json`: the signed bundle, its 38 committed mutations, 9 accepted and 79 separately built rejected bundles, the classical-only routine bundle in 4 modes |
| `external.v2.secondary_sha3` | 80 | `secondary_sha3_vectors.json`: accepted and rejected cases and the committed control of each rejected case |

- **Operations:** `dual_merkle_root` takes `leaves`, a non-empty array of `{sha256, sha3_256}` lowercase 64-hex
  strings, and answers `ok` with `sha256` and `sha3_256` (64 lowercase hex). `composite_verify` takes `context`,
  `payload_b64` (the canonical payload bytes), `composite_sig` as committed, `classical_public_key_b64` and
  `pq_public_key_b64` (or `null`), and answers `ok` with `valid` and `classical_valid` (booleans) and `pq_valid`
  (a boolean or `null`). `verify_signed_bundle_v2` takes `bundle_b64` (the signed bundle JSON), `policy` (a
  verifier policy object) and `verification_time` (RFC 3339 with `Z` or an offset), and answers `ok` with
  `verified` (a boolean) and `errors` (an array of strings). A request of the wrong shape (an empty or uppercase
  leaf, a leaf that is not a string, a time without a zone, an unknown field) makes the wrapper exit with 2.
- **Judgement:** composite cases compare only the fields the fixture commits; a bundle verdict must match, and a
  rejection must contain the committed `error_contains` (case-insensitive, over the joined errors).
  `verified: true` with errors is a `contradictory_result` error. `rejected` with `code` `parse` fails, because
  every committed input parses; `error` and `unsupported` are never a pass.
- **Controls:** a negative case counts only if its control passed; otherwise it is `control_failed`, an error. The
  base signed bundle controls its 38 mutations; the positive of the same payload controls its alterations and the
  committed attacks; a valid mode of the classical-only bundle controls its rejecting modes; each rejected
  secondary case has its committed control. The 79 `must_reject_bundles` have no per-case control: they count only
  if the base and the 9 accepted bundles pass (a suite-level control, a weaker guarantee) and are judged on their
  committed `error_contains`. The report gives each case's `source`, `input_sha256` and `controls`.
- **Missing PQ signature:** for a `pq_over_classical` signature without a PQ part, Rust `composite_verify` returns
  an error and the WASM export the in-band error
  `Signature error: pq_over_classical binding requires PQ signature`. Those two wrappers report it as
  `rejected` with `code` `missing_pq_signature`, only for that exact error and only when the input has that binding and `pq: null`. The runner accepts it only where the fixture
  commits `valid: false` alone (`stripping_pq_removal`) and its positive control passed; the same code on a valid
  signature or on any other negative fails. TypeScript, Python and Go answer that case with booleans.
- **Payload alterations** change the last character of the first string value of the canonical payload, so the
  payload stays valid canonical JSON (the WASM export takes payload JSON) and a parser error is never counted as a
  cryptographic failure.
- **Time:** every bundle case sends `verification_time`: 2026-10-22T00:00:00Z, inside the validity window
  of the base bundle and of every bundle expected to verify (some negatives are intentionally expired or not yet
  valid at that instant), or the committed time of the secondary vectors. TypeScript passes `{ now }`, Python `now_ms`, Go
  `VerifySignedBundleV2At` and Rust `verify_signed_bundle_v2_at`. The WASM export reads `Date.now`, so the WASM
  wrapper replaces `Date.now` with that instant during the synchronous call only and restores it in `finally`,
  also when the call throws; its `runtime` says so. The self-tests show each wrapper rejecting the base bundle at
  2020-01-01, accepting it at 2026-10-22 and rejecting it at 2100-01-01, and the restoration after a throw.
- **Merkle through WASM:** the wrapper uses the `wasm_dual_merkle_root` built from this checkout, which delegates
  to the Rust core; the helper published in `@dcp-ai/wasm` 2.1.1 and earlier fails the multi-leaf cases (see
  the CHANGELOG).
- **Self-tests:** `external-evidence.test.mjs` runs the 241 cases through the five wrappers, the clock proof,
  malformed requests, and a fake implementation built from the TypeScript wrapper's real answers: verifying
  everything, rejecting everything, contradictory results, the wrong error text, an order-blind or hex-text Merkle
  reduction, a failing base, `missing_pq_signature` in and out of place, and errors or `unsupported` on negatives.
  Tampered fixtures and catalogs are infrastructure errors (exit 3). The default timeout of this catalog is
  300 000 ms (`--timeout-ms`). With the two `REQUIRE` variables a missing wrapper fails instead of being skipped;
  CI runs all five.
- **Limits:** a pass shows that the argv that was run passes these 241 cases, nothing more. The policy is
  `default_verifier_policy` with each case's committed `verifier_policy_overrides`, plus the 4 modes of the
  classical-only bundle; no other policy is tried. `composite_verify` is a primitive with
  the binding and keys given, and a bundle verdict is not admission, trust in the principal or authorization of an
  action. `stripping_pq_with_downgrade` is judged on `classical_valid` and `pq_valid`; rejecting it belongs to a
  `hybrid_required` policy. Secondary fields are checked where present, so a pass does not show a complete
  secondary chain. Through WASM, the time is the substituted host clock. The `error_contains` strings are the SDKs'
  diagnostic wording, not normative: `spec/VERIFICATION.md` defines no error codes. A pass of those 146 cases shows
  agreement with that wording; a verifier with the same verdicts and other messages fails them, and that failure alone
  does not show a wrong verdict. The [verdict assessment](#verdict-assessment) judges those cases on the verdict alone.

#### Verdict assessment

`spec/VERIFICATION.md` defines when a bundle does not verify, not the wording of its errors. `--assessment verdict`
judges this catalog on the verdicts alone, for implementations whose messages are their own. Without the option, or
with `--assessment legacy`, judgement, report and exit codes are exactly those above. The option applies to a `/2`
catalog only, the committed one or your own file; with the `/1` or `/3` catalog it is a usage error, `legacy`
included, because their codes are part of the contract or normative.

```bash
node tools/conformance-external.js --catalog evidence --assessment verdict --list
node tools/conformance-external.js --catalog evidence --assessment verdict --report /tmp/evidence-verdict.json -- ./my-implementation
DCP_EXTERNAL_PYTHON=/path/to/python DCP_EXTERNAL_REQUIRE_PYTHON=1 DCP_EXTERNAL_REQUIRE_NATIVE=1 node --test tools/conformance/external-evidence-assessment.test.mjs
```

- **What changes:** only the 146 rejections that carry an `error_contains` (38 mutations, 79 separately built
  bundles, 29 secondary cases). Each passes when its result is `ok`, well formed and not contradictory, says
  `verified: false`, and its controls passed in the same run; the messages are not judged. Every other rule is the
  legacy one, controls included. With the same answers, a case that passes under `legacy` passes under `verdict`,
  and every case outside those 146 gets the same status and kind.
- **Anchors and premises:** each of those cases names its step of `spec/VERIFICATION.md` (`anchor`): the
  `spec_step` of the bundle vectors (V2-1 to V2-14), or V2-11 and the erratum field of the secondary group
  (`audit_merkle_root_secondary`, `prev_hash_secondary` or `intent_hash_secondary`). Every control must be a plain
  positive: expected to verify (or be valid), with no `error_contains` and no controls of its own, so the assessment
  never changes a control's outcome. Both are checked before the run; a plan that fails them is exit 3 under
  `verdict` (it can still pass under `legacy`, for instance with your own `--root`), and the property above holds
  only for plans valid in both assessments.
- **Diagnostic:** the wording of a passing rejection is reported as `matched` (it contains the committed
  `error_contains`), `differs`, or `no_message` (`errors: []`). Any other result is `not_evaluated`, with its
  `reason`: `run_error`, `missing`, `duplicate`, `malformed_result`, `implementation`, `unsupported`, `rejected`,
  `contradictory_result`, `wrong_verdict` or `control_failed`. A wrong verdict never passes, whatever its message,
  and the wording never changes a status, a total or the exit code.
- **Report:** `kit.contract` stays `/2`; the report adds `assessment` (its `schema` is
  `dcp-ai-conformance-assessment/1`, apart from the wire contract) and `diagnostic_totals`. Its `claim` and
  `limits` state what this assessment checks, set by the runner for each suite whatever the catalog's prose; that
  prose is kept verbatim in `catalog_claim` and `catalog_limits` and is not a checked result. Each of the 146 cases
  shows `expect: {"verified": false}`, its `anchor` and its `diagnostic`. A legacy report has none of the new fields
  (`assessment`, `diagnostic_totals`, `catalog_claim`, `catalog_limits`, `anchor`, `diagnostic`), and its `claim`,
  `limits` and `expect` (with `error_contains`) stay as they were. `--list` with `--assessment` states the mode;
  without it, its output is unchanged.
- **Exit codes and freshness:** those of the [contract](#contract). Only status `pass` (exit 0) means the run
  passed: the diagnostics of a run with status `fail` or `error`, an extra result for instance, are partial detail,
  never conformance. Every `--assessment` error (an unknown, repeated or missing value, a `/1` or `/3` catalog, a
  missing anchor) comes after the placeholder, so it replaces an older report with a fresh error and a new
  `run.id`; only the exceptions described for the [command](#external-implementations) leave no report.
- **Self-tests:** `external-evidence-assessment.test.mjs` runs a fake built from the TypeScript wrapper's real
  answers in both assessments: right verdicts with the expected, a neutral or no message; wrong verdicts with the
  expected message; verifying or rejecting everything; errors, `unsupported`, missing, duplicate, malformed,
  rejected and extra results; failed controls, a failed run and a timeout; each suite selected alone; the property
  above on every mode, an order-blind Merkle, the old odd-node promotion and `missing_pq_signature` in and out of
  place included; anchors and premises; fresh reports over an older pass; report shapes and `--list`. It also runs
  the 241 cases through the five wrappers under `verdict`; CI runs it with every wrapper required.
- **Limits:** a verdict pass shows correct verdicts for these cases, with the argv that was run and under the same
  policies; it does not assess whether the messages are accurate or helpful. The `/2` wire contract, the catalog,
  the fixtures and the wrappers are unchanged.

#### Schema-boundary diagnostic (opt-in)

The separate [`external-schema-catalog.json`](external-schema-catalog.json) uses contract `/2` for 15 cases from the new schema-closure corpus. It preserves the normative V2-2 expectation: an unknown member in a closed object must be rejected even when its hashes and signatures remain valid. The base and permitted extensions are positive controls; a stale signed extension is a distinct integrity negative. This diagnostic does not change the default evidence catalog's 241 cases.

```bash
node tools/conformance-external.js --catalog tools/conformance/external-schema-catalog.json --assessment verdict --list
node tools/conformance-external.js --catalog tools/conformance/external-schema-catalog.json --assessment verdict --report /tmp/schema-diagnostic.json -- ./my-implementation
node --test tools/conformance/external-schema.test.mjs
```

Known SDK schema-validation gaps remain failed cases, not accepted exceptions. `schema-boundary.js` separately reports reference schema validation, an integrity check limited to this finite corpus, and schema-plus-TypeScript-SDK composition at the corpus time. A passing composition does not prove that the SDK alone performs V2-2; this is not the reference API running with an injected clock. The integrity helper is not a general normative verifier. The self-tests exercise the diagnostic, its controls and its expectations; their passing does not certify SDK conformance. See the [coverage map](../../docs/conformance/SECURITY_COVERAGE.md) and [implementer guide](../../docs/conformance/IMPLEMENTER_GUIDE.md).

#### Verifier-policy catalog (opt-in)

[`external-policy-catalog.json`](external-policy-catalog.json) uses contract `/2` for 74 fixed-time cases: 10 positive controls, 24 invalid-present-PQ cases across four requested modes, 14 algorithm-list/advisory cases and 26 tier cases. It leaves the default evidence catalog unchanged. Each negative requires its positive control to pass; diagnostic wording is not assessed.

```bash
node tools/conformance-external.js --catalog tools/conformance/external-policy-catalog.json --assessment verdict --list
node tools/conformance-external.js --catalog tools/conformance/external-policy-catalog.json --assessment verdict --report /tmp/policy-conformance.json -- ./my-implementation
node --test tools/conformance/external-policy.test.mjs
```

The routine hybrid positive reaches effective `classical_only`; the standard positive raises that request to `hybrid_preferred`. Recorded tier/mode derivation is explanatory, not an assessment of result fields. Tier cases use separately signed committed bundles, not single-change twins. Classical algorithm exclusions under `pq_only` remain omitted without an expected verdict pending clarification. See the corpus questions and the coverage map for the remaining scope. CI runs the corpus/runner self-tests and the catalog through all five SDK wrappers; a pass concerns these cases only.

#### Structural catalog (opt-in)

[`external-structural-catalog.json`](external-structural-catalog.json) runs 16 fixed-time cases under `/2` and effective `hybrid_preferred`: two positive controls and 14 structural negatives. Each negative depends on the base, and the reversed-session case also depends on its positive twin. The default catalogs remain unchanged.

```bash
node tools/conformance-external.js --catalog tools/conformance/external-structural-catalog.json --assessment verdict --list
node tools/conformance-external.js --catalog tools/conformance/external-structural-catalog.json --assessment verdict --report /tmp/structural-conformance.json -- ./my-implementation
node --test tools/conformance/external-structural.test.mjs
```

Only verdicts are assessed. The corpus records its signing provenance and isolation limits, especially stale evidence for a fractional payload and the nonexistent valid root of a backwards range. CI runs the corpus/runner self-tests and all five SDK wrappers. A pass applies to these cases and this policy; it is not complete V2 conformance.

### Admission catalog: strict-v1 admission

`--catalog admission` selects a second opt-in catalog, [`external-admission-catalog.json`](external-admission-catalog.json)
(contract `dcp-ai-conformance-external/3`, 140 cases), run against the same kind of argv. It judges the admission
decision of [`spec/profiles/admission`](../../spec/profiles/admission/README.md) on the committed
[`admission_vectors.json`](../../tests/interop/v2/admission_vectors.json), which the catalog pins by SHA-256 together with
`bundle_vectors.json`. Contracts `/1` and `/2` and their catalogs do not change. The TypeScript, Python, Go and Rust
wrappers answer `/3` through their SDK; the WASM build has no admission API, so its wrapper refuses `/3` (exit 2) and
nothing emulates it.

```bash
node tools/conformance-external.js --catalog admission --list
node tools/conformance-external.js --catalog admission --report /tmp/admission-ts.json -- node tools/conformance/wrappers/ts-sdk.mjs --sdk sdks/typescript/dist/index.js
node tools/conformance-external.js --catalog admission -- /path/to/python -I tools/conformance/wrappers/python_sdk.py
node tools/conformance-external.js --catalog admission -- tools/conformance/wrappers/.build/go-wrapper
node tools/conformance-external.js --catalog admission -- tools/conformance/wrappers/.build/rust-target/debug/dcp-ai-conformance-wrapper
node --test tools/conformance/external-admission.test.mjs
DCP_EXTERNAL_PYTHON=/path/to/python DCP_EXTERNAL_REQUIRE_PYTHON=1 DCP_EXTERNAL_REQUIRE_NATIVE=1 node --test tools/conformance/external-admission-wrappers.test.mjs
```

| Suite | Cases | Source |
|-------|-------|--------|
| `external.admission.outcomes` | 65 | The outcome vectors of `admission_vectors.json` |
| `external.admission.config` | 71 | Its 49 rejected configurations, its 2 accepted profiles with their maxima, and loading the 14 trust sets and 6 profiles the vectors use |
| `external.admission.composed` | 4 | Written in the catalog from the vectors' inputs: a profile without a trust set, a profile with a verifier policy of the caller's, and two compositions whose codes an alphabetical order would misplace |

- **Operations:** `admit_signed_bundle_v2` takes `bundle_b64`, `now`, `profile`, `trust_set`, `verifier_policy` and
  `revocation`, always all six; `load_admission_config` takes `kind` (`trust_set` or `profile`) and `config`.
  - `now` is exactly `YYYY-MM-DDTHH:mm:ss.sssZ`, a real date in the years 0001 to 9999. This is the range of this
    transport only: it changes no timestamp of the protocol.
  - `revocation` is `null` without a profile, `{"state": "unavailable"}` (no snapshot, R1) or
    `{"state": "snapshot", "snapshot": {…}}` with an object, complete or not, which the SDK judges. It is given exactly
    when there is a profile.
  - `profile`, `trust_set` and `verifier_policy` are objects or `null`. The trust set and the profile are the operator's
    configuration, given out of band in the request, never taken from the bundle. Without a profile the request carries
    a complete verifier policy: the 14 fields of `default_verifier_policy`, plus `require_session_expiry: false`,
    `require_audience_binding: false` and `max_session_duration_seconds: 0`. With a profile it carries none, except in
    the case that checks the refusal.
  - A request of another shape makes the wrapper exit with 2 before the SDK is called.
- **Answers:** `ok` with exactly `verified`, `principal_trust`, `profile`, `profile_compliance`, `admitted`,
  `action_authorized`, `recorded_decision`, `trust_set_version`, `codes` (the codes of `errors`, in the order emitted,
  repetitions kept) and `verification_verified`; for a configuration `accepted: true`, and for a profile its two maxima.
  `rejected` carries a `CONFIG_*` code, only when the SDK raised its typed configuration error. `error` and
  `unsupported` are never a pass.
- **Judgement**, in this order:
  - field types (`malformed_result`);
  - the rules spec/profiles/admission implies (`contradictory_result`): `action_authorized` is `false`; `admitted` holds
    exactly when no code was added; principal trust is evaluated only with a trust set and a verified bundle;
  - the exact fields and the set of codes;
  - the order of the raw sequence by the phases of §5.1 and §5.2, with the stops of P1, T1, R1 and R2 (`order`);
  - repetitions (`cardinality`): only P4, T2, R4 and R5, which apply to several components or subjects, may repeat
    their code.

  A rejected configuration passes with one of its `allowed_codes`: its own code, or either applicable code for the three
  trust sets with two problems (§2.2). Profiles are judged on their effective maxima (§4.1).
- **Controls:** a negative counts only if its controls passed, transitively; otherwise it is `control_failed`, an error.
  - 29 outcome negatives are controlled by the positive on their own bundle.
  - 19 have no positive on their bundle and are controlled at suite level, a weaker guarantee.
  - Configuration rejections are controlled by loading a valid trust set or profile.
  - Composed cases are controlled by the vectors they compose.

  `--suite` also runs the controls a selected case needs and reports them (`controls_included`, `included_for_controls`).
- **Process and errors:** as with `/1` and `/2` (run id, nonce, random case ids, process group and limits); the default
  timeout of this catalog is 300 000 ms. A failure to start, a non-zero exit, a signal, a timeout, stale ids, or a
  malformed, missing, duplicated or extra result is an error, never a rejection or "not admitted". The catalog and its
  fixtures are validated when they load (pinned hashes, exact keys and types, each expectation consistent with the text);
  a defect is exit 3.
- **Wrappers:** one call per case to the SDK's combined function or loaders, with the request's `now`, never the system
  clock: `admitSignedBundleV2`, `createPrincipalTrustStore` and `resolveStrictV1Profile` (TypeScript);
  `admit_signed_bundle_v2`, `create_principal_trust_store` and `resolve_strict_v1_profile` (Python);
  `AdmitSignedBundleV2`, `NewPrincipalTrustStore` and `ResolveStrictV1Profile` (Go); `admit_signed_bundle_v2`,
  `PrincipalTrustStore::from_json` and `resolve_strict_v1_profile` (Rust), with the Ed25519 and ML-DSA-65 providers.
  Only the typed error is a rejection: `AdmissionConfigError` (TypeScript, Python, Rust) or `*AdmissionConfigError`
  through `errors.As` (Go). `DCP_CONFORMANCE_WRAPPER_FAULT` is for the self-tests only and can only turn an answer into
  an error.
- **Self-tests:**
  - `external-admission.test.mjs` judges synthetic answers built from the catalog's own expectations, with no SDK: wrong
    decisions, order, cardinality, configuration codes, infrastructure failures, and tampered catalogs and fixtures.
  - `external-admission-wrappers.test.mjs` runs the four wrappers through their SDKs: the 140 cases each, the request's
    clock (one case at three instants), malformed requests, injected failures, an implementation that cannot load, the
    WASM refusal, and an SDK that takes trust from the bundle, through TypeScript.

  CI runs both, with the four wrappers required.
- **Limits:**
  - **What a pass shows.** The argv that was run passes these 140 cases, nothing more. Admission is never authorization:
    `action_authorized` is always `false`.
  - **A projection.** The answer is a projection of the admission result. The embedded verification (its errors,
    warnings, details, `signer_keys`, mode and tier) is not judged; `verification_verified` is reported by the
    implementation itself.
  - **Typed errors.** A rejection is judged by its code. Whether it came from the SDK's typed error is seen by the
    wrapper, not by the runner.
  - **Weaker guarantees.** The 19 suite-level controls, and the 4 composed expectations, which are written in the catalog
    and not in the vectors.
  - **Outside this catalog.** Adapters, trust and revocation sources, TLS, tenants, caching and single use. The corpus
    is the committed vectors and these four compositions, not every input.

## Performance baseline

`tools/conformance-perf.js` measures the normative V2 verifier of the five SDKs of this checkout on the same input
bytes, policy and verification instant (contract `dcp-ai-perf/1`). It is a small, reproducible local baseline, not a
benchmark of this harness, a security ranking or a speed requirement; CI never checks a speed.

```bash
node tools/conformance-perf.js --list
node tools/conformance-perf.js --offline --warmup 5 --samples 20 --rounds 1 --python /path/to/python --report /tmp/perf-sanity.json
node tools/conformance-perf.js --no-build --warmup 20 --samples 100 --rounds 3 --python /path/to/python --report /tmp/perf.json
DCP_PERF_PYTHON=/path/to/python DCP_EXTERNAL_REQUIRE_PYTHON=1 DCP_EXTERNAL_REQUIRE_NATIVE=1 node --test tools/conformance/perf.test.mjs
```

- **Workloads:** six committed bundles, read and never re-signed, under `default_verifier_policy` at
  2026-10-22T00:00:00Z: `hybrid_ok`, `classical_sig_invalid` (the Ed25519 signature of the RPR), `pq_sig_invalid` (the
  ML-DSA-65 signature of the bundle), `secondary_root_ok`, `secondary_root_wrong` and `secondary_all_ok`. The secondary
  pair shares the base artifacts and the entries, and differs in the manifest's `audit_merkle_root_secondary` and in
  the bundle signature that covers it (`manifest_hash`, both signature values, `signature.hash_alg`): it is not an
  experiment that isolates the cost of one field.
- **What is timed,** per call, in one process per SDK, with no process start per sample: TypeScript `JSON.parse` and
  `await verifySignedBundleV2` (the local `dist`, not a published package); Python `json.loads` and
  `await verify_signed_bundle_v2` in one persistent `asyncio` loop (the checkout's `dcp_ai`); Go
  `VerifySignedBundleV2At`, whose bytes API includes the parsing; Rust `serde_json::from_slice` and
  `verify_signed_bundle_v2_at` (a release example); WASM the decode, `wasm_verify_signed_bundle_v2` and `JSON.parse` of
  its result, with `Date.now` replaced by the verification instant during the call, public-boundary costs included and
  named. Registries and policies are set up once; no result is cached.
- **Checks:** warmup and timed calls run round-robin over the workloads, and every call is checked: the expected
  verdict, no errors on a positive, errors on a negative. A failed check stops that child: it answers `check_failed`
  with no timing and exits 0, and the runner reports the run as failed (its exit 1). The report keeps the other
  children's results and is then not a baseline (`baseline: false`); no timing of the failed child is ever presented.
  A child answers either a success with every sample or such a failure; the runner checks the contract, the run
  identity, the SDK and entry point, the counts, and that every sample is a positive safe integer of nanoseconds.
- **Statistics:** every sample is kept, in order; per SDK and workload, `n`, `min`, the median (the mean of the two
  middle values for an even `n`), p90 and p99 by nearest rank, `max` and the IQR. No ranking and no attributed
  percentage; a negative can stop at its first failed check, and its `errors_first` is a diagnostic only.
- **Provenance:** by default the tool builds what it measures (TypeScript `dist`, the Go child with `-o` under
  `.build`, the Rust example and WASM in release, WASM in its own folder) under one bounded build deadline. It then
  records, for each selected SDK, the source trees, manifests and locks, children, artifact hashes (the whole `dist`,
  the `.wasm` and its JS glue, the binaries), tool versions and build options, and measures nothing if any of them is
  missing. `--no-build` recomputes all of that for the requested SDKs and refuses any difference or gap; the time, the
  commit and the dirty flag are informational. Each child reports what it loaded (TypeScript: every import resolved
  from `dist`, with its package manifest and hash; Python: the checkout's `dcp_ai` and the modules actually imported).
  The record ties the artifacts to this checkout; it does not certify the supply chain.
- **Processes and report:** each child runs under the runner of the external kit (deadline, process group, output
  limits). The report gets an `incomplete` placeholder first and is replaced on every path; an ambiguous `--report`
  (missing, option-like or repeated) writes nothing. The runner's exit codes: 0 pass, 1 a failed check, 2 usage, 3 infrastructure,
  build or provenance. `--child-argv` replaces a child for testing the harness only; such a report is never a baseline.
- **Self-tests:** `perf.test.mjs` runs a mandatory smoke run of the five children (W=1, N=2, R=1); fake children
  (missing, duplicate or unknown results, wrong counts, malformed or unsafe samples, a wrong identity, contradictions,
  accept-all, failures in warmup and in samples, a malformed failure, valid output then a non-zero exit, a hang); a
  real child given a wrong expected positive; fresh reports over an older pass; forged, stale and incomplete
  provenance; a selection in a temporary tree; and a build step that ignores SIGTERM. CI runs them in the native job
  with every child required.
- **Limits:** one machine and a small sample: frequency, thermal and power state and background load are not
  controlled (the CPU and OS are recorded). Each SDK is measured as it is, with its own cryptographic libraries; the
  Rust profile is the default release one. Results stay local: this section documents the method, not numbers.
