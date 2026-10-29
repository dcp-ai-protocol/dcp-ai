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
