# Differential fuzzer for the V2 bundle verifiers

`run.mjs` feeds the same mutated V2 signed bundle to the four SDK verifiers
(`verifySignedBundleV2` in TypeScript, `verify_signed_bundle_v2` in Python,
`VerifySignedBundleV2At` in Go, `verify_signed_bundle_v2_at` in Rust), under one explicit policy and one
verification instant. A disagreement, a verdict that contradicts what the shared vectors declare, a key
reorder that changes a verdict, and any error, crash or timeout is a finding. The security round closed by
v2.10.0 was almost entirely disagreements between the four verifiers; this tool is how they are found
before a release. The driver is the module `fuzz.mjs`, which `run.mjs` and the self-tests share.

## Setup

Every SDK is run from this checkout, never from a published package:

```bash
(cd sdks/typescript && npm install && npm run build) # shims/ts imports sdks/typescript/dist
pip install -e sdks/python                            # dependencies of shims/py (pynacl, pqcrypto>=1.0)
```

Go (version from `sdks/go/go.mod`) and a stable Rust toolchain must be on `PATH`. The driver builds
`shims/go` (a module that `replace`s the SDK with `../../../../sdks/go`) with `-mod=readonly`, and
`shims/rust` (a path dependency on `../../../../sdks/rust`) with `--locked`, both into the run's own private
temporary directory (Cargo's `CARGO_TARGET_DIR` included), so concurrent runs never share a binary; the Rust
shim is therefore built from scratch on every run. Nothing changes a manifest or a lockfile. With
`--offline`, Go runs with `GOPROXY=off` and Cargo with `--offline`, so the module and crate caches must
already hold the dependencies. The build has its own deadline.

The report's `build.artifacts` records what the run measured, by content: the four shims, the two built
binaries (their hashes, never their ephemeral paths), the TypeScript `src` and `dist` trees, its
`package-lock.json` and the directory of each direct runtime dependency Node resolves for it, the Python SDK
source and the interpreter with five distribution versions, and the Go and Rust SDK sources and the Rust lock.
`inputs` records the driver (`fuzz.mjs`, `run.mjs`) and the fixtures. Both are checked again at the end of the
run; a change is exit 3. `provenance_limits` states what the hashes do not prove: that `dist` was built from
that `src`, and the transitive dependencies, are not verified.

## Usage

```bash
node tools/difffuzz/run.mjs                       # 200 iterations, seed 1
node tools/difffuzz/run.mjs --iterations 2000 --seed 7 --report /tmp/difffuzz.json
node tools/difffuzz/run.mjs --replay tools/difffuzz/findings/<file>.json
node --test tools/difffuzz/difffuzz.test.mjs      # self-tests of the harness (no SDK)
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--iterations N` | `200` | mutants to generate (0 to 1,000,000) |
| `--seed S` | `1` | PRNG seed; the same seed and fixtures give the same mutants |
| `--modes a,b` | `default,hybrid_required` | policies every seed and mutant runs under (see Policies) |
| `--timeout MS` | `60000` | deadline of one batch process (`--timeout-ms` is the same) |
| `--python PATH` | `$DIFFFUZZ_PYTHON` or `python3` | interpreter with the Python SDK's dependencies |
| `--out DIR` | `tools/difffuzz/findings` | where findings are written |
| `--report FILE` | none | the full run report (JSON): an `incomplete` report is written first and replaced on every path, a usage error included; a missing, option-like or repeated value writes nothing |
| `--offline` | off | build from local caches only |
| `--build-timeout-ms MS` | `600000` | one deadline for building the shims |
| `--batch-cases N`, `--batch-bytes B`, `--case-bytes B` | `64`, 16 MiB, 4 MiB | cases per batch, the exact UTF-8 size of a whole request, raw bytes of one input. A seed that does not fit is exit 3; a mutant that does not fit is skipped and counted |
| `--stdout-bytes B` | 8 MiB | output limit of one batch process |
| `--max-findings N` | `50` | findings recorded; once reached, no further batch runs (baseline included) and the run cannot pass |
| `--max-retries N` | `200` | single-case reruns that isolate failed batches; exhausting it is exit 3 |
| `--minimize-steps N`, `--minimize-total N` | `24`, `96` | minimization budget per finding and per run |

Every value is checked before anything is built: an unknown, repeated, missing or out-of-range argument is
exit 2. Exit codes: 0 no finding, no failed batch and a complete baseline; 1 at least one finding, a failed
batch or an incomplete baseline; 2 usage; 3 infrastructure or harness fault (a build failure, inputs that
changed during the run, a shim that cannot start or answers outside the protocol or as unsupported, in a batch
or alone, an exhausted retry budget, no seed declared valid in the first mode while there are iterations). The
commands are always exactly the four shims.

### Policies and time

Every request carries the policy and the instant explicitly: `now_ms` is 2026-10-22T00:00:00Z, the instant of
the external conformance kit, so a verdict never depends on the day it runs. `default` is the vectors'
`default_verifier_policy` (the TypeScript `DEFAULT_VERIFIER_POLICY`) for every SDK; any other mode name is
applied to `default_mode` and to every risk tier, as the vectors build each mode's policy. A seed's
`verifier_policy_overrides` replace those fields in every mode. (Before this protocol, `default` was each
SDK's own default policy and every shim read its own system clock.)

### Seeds and expectations

Seeds are the bundles of `tests/interop/v2/bundle_vectors.json`, with what its `_description` declares:
`signed_bundle` verifies; every `must_reject` mutation of it and every `must_reject_bundles` entry is
rejected whatever the mode; every `must_accept_bundles` entry verifies in every mode;
`classical_only_routine_bundle` gets `verified_by_mode` (it declares no verdict for `default`). The default
policy resolves to one of the four modes, so "every" and "any" mode cover it. A verdict that contradicts a
declared expectation is an `expectation` finding even when the four SDKs agree: agreement is never the
oracle. If such an expectation turns out to contradict the specification itself, keep the reproducer and stop
using that interpretation; do not replace it with the majority. The signed bundles of
`tests/interop/v2/cross_sdk_vectors.json` and `tests/conformance/examples/` declare nothing and are
differential-only.

Every odd iteration (so at least half of them, rounded up) starts from a seed declared valid in the first mode,
picked at random; the others start from any seed. With iterations and no such seed, the run stops with exit 3.

### Mutators

Each iteration applies one mutation (70%) or two (30%) at a random slot: delete a key, set a value to
`null`, swap a value's type, swap two sibling values, flip one character of a base64 string, replace an
enumerated string with a prototype key (`constructor`, `__proto__`, `toString`, `valueOf`, ...), rename a key
to a prototype key, add an unknown key, duplicate an artifact (or its `payload`, `payload_hash` or
`composite_sig`) into another slot, rewrite a number as `1.0`, `1e2`, `-0`, `0.1`, `2^64`, `1e400`, ...,
rewrite an RFC 3339 timestamp with another offset, malformed or far in the past or future, an oversized string
(64 KiB or 1 MiB), a 100-deep nested value, and a recursive key reorder, which must never change a verdict:
each SDK's result is compared with its own baseline for the seed. Numbers that JavaScript cannot represent are
spliced into the serialized text verbatim, so every parser sees the same bytes. The key reorder keeps an own
`__proto__` key (it used to drop it).

## Judgement

Each shim answers one of: `verdict` (`verified` and `errors`), `parse_rejected` (its JSON parser refused the
document), `error` (the SDK threw or panicked) or `unsupported`; the driver adds `crash` (an exit other than 0
or a signal), `timeout`, `output_limit` and `protocol` (an answer outside the protocol). The SDKs are compared
on acceptance: a verdict `true` accepts; a verdict `false` or a parser rejection rejects, as before; any other
category is never a vote. A batch whose process fails is recorded and each of its cases is rerun alone to find
the culprit; the failed batch keeps the run from passing whatever the reruns give, and a failure that no single
case reproduces is also a finding (`batch_failure_not_reproduced`). Every shim run of a batch is awaited, whichever
fails first, before the run ends.

## Findings

Every finding is written to `findings/<seed>-<iteration>-<mode>-<n>.json` (the directory is git-ignored
except for `.gitkeep`): its classes, the seed, the mode, the explicit policy and `now_ms`, the mutations,
every SDK's outcome, and the exact input bytes (`input_b64`, `input_sha256`). A finding is a lead, not yet a
bug. Replay it first with `--replay`: the recorded bytes (and the minimized input, when there is one) run through
the four shims at the finding's own `now_ms` and under its own policy, in one batch with the finding's own
recorded control: the original bytes of the unmutated seed (hash, policy, declared expectation and baseline
outcomes), never the current fixture of that name. The finding is checked first, fully typed: its kind, a set of
known classes equal to the classes its own outcomes give, four typed outcomes, its hashes and its control. The
current build, driver, fixtures and seed are compared with the recorded ones and every difference is reported as
a provenance difference. Replay exit codes: 0 the recorded decisions reproduce and the control reproduces its
baseline, 1 they do not reproduce, 3 the finding, the control or the infrastructure does not allow a judgement.

Disagreements and errors or crashes of a mutant are then minimized within a budget (an expectation finding is
an unmutated seed already), and only against a positive control: the unmutated seed passed its own baseline in
that mode, verified `true` by the four SDKs (a seed correctly rejected is no control). The differences from the
seed are reduced while every SDK keeps the same decision and the seed, run alongside, keeps its baseline. Raw tokens such as `1e400` are kept as bytes; the text is
never re-parsed. The result is minimal for that search and budget, not globally; key-order findings and
timeouts are not minimized.

Decide which SDK is right from the normative requirements (`spec/VERIFICATION.md`, the canonicalization
profile) and the shared fixtures (`tests/interop/v2/`). When they do not settle the case, it is an open
question for the specification, not a fix to pick: record it rather than adopting the fail-closed verdict by
default. Fix the wrong SDK test-first with a unit test in that SDK, and never weaken a verifier to reach
agreement.

## Shims

`--batch` is the driver's protocol (`dcp-difffuzz/2`), one finite process per batch, run through the external
conformance kit's process runner (`runProcess` in `tools/conformance/external.js`: one deadline, its own
process group, SIGTERM then SIGKILL, bounded output and cleanup). The request on stdin is
`{protocol, run_id, nonce, now_ms, cases: [{id, policy, bundle_b64}]}` with random ids and no expectation or
seed name; the response on stdout is one JSON document `{protocol, run_id, nonce, results}` with exactly one
result per case, then exit 0. A malformed request exits 2. The Go shim writes nil `errors` as `[]`; the Rust
shim decodes base64 with `std` only.

Without `--batch`, each shim keeps its earlier form for manual use: one document on stdin (or one per line
with `--loop`), `{"valid": bool, "errors": [string]}` per document, an optional mode as first argument, each
SDK's own default policy and the system clock.

## CI

`.github/workflows/difffuzz.yml` runs the self-tests, then 300 iterations on every pull request, 3000
nightly, and takes `iterations` and `seed` inputs on `workflow_dispatch`. Findings and the report are uploaded
as the `difffuzz-findings` artifact when the job fails.
