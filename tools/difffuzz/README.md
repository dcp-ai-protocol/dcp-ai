# Differential fuzzer for the V2 bundle verifiers

`run.mjs` feeds the same mutated V2 signed bundle to the four SDK verifiers
(`verifySignedBundleV2` in TypeScript, `verify_signed_bundle_v2` in Python,
`VerifySignedBundleV2WithPolicy` in Go, `verify_signed_bundle_v2_with_policy` in
Rust) and treats any disagreement in the `valid` verdict, any crash and any
timeout as a finding. The security round closed by v2.10.0 was almost entirely
disagreements between the four verifiers; this tool is how they are found
before a release.

## Setup

Every SDK is run from this checkout, never from a published package:

```bash
(cd sdks/typescript && npm install && npm run build) # shims/ts imports sdks/typescript/dist
pip install -e sdks/python                            # dependencies of shims/py (pynacl, pqcrypto>=1.0)
```

Go (version from `sdks/go/go.mod`) and a stable Rust toolchain must be on
`PATH`; the driver builds `shims/go` (a module that `replace`s the SDK with
`../../../../sdks/go`) and `shims/rust` (a crate with a path dependency on
`../../../../sdks/rust`) itself.

## Usage

```bash
node tools/difffuzz/run.mjs                       # 200 iterations, seed 1
node tools/difffuzz/run.mjs --iterations 2000 --seed 7
```

| Option           | Default                         | Meaning                                                        |
| ---------------- | ------------------------------- | -------------------------------------------------------------- |
| `--iterations N` | `200`                           | mutants to generate                                            |
| `--seed S`       | `1`                             | PRNG seed; the same seed and seeds files give the same mutants |
| `--modes a,b`    | `default,hybrid_required`       | verifier policies to run every mutant under                    |
| `--timeout MS`   | `30000`                         | per-verdict timeout; exceeding it is a finding                 |
| `--python PATH`  | `$DIFFFUZZ_PYTHON` or `python3` | interpreter with the Python SDK installed                      |
| `--out DIR`      | `tools/difffuzz/findings`       | where findings are written                                     |

The exit code is 1 when there is at least one finding. The summary at the end
reports iterations, verdicts, agreements, findings and the mutator mix.

### Policies

`default` is each SDK's default verifier policy (`DEFAULT_VERIFIER_POLICY`,
`DefaultVerifierPolicy()`, `VerifierPolicy::default()`), which maps the
passport's risk tier to `classical_only` / `hybrid_preferred` /
`hybrid_required`. Any other mode name is applied to `default_mode` and to
every risk tier, as the SDK interop tests do, so `hybrid_required` runs every
bundle under the strict mode.

### Seeds

All V2 signed bundles found in `tests/interop/v2/bundle_vectors.json`
(`signed_bundle`, `must_accept_bundles`, `classical_only_routine_bundle`,
`must_reject_bundles`), in `tests/interop/v2/cross_sdk_vectors.json` and in
`tests/conformance/examples/*.json` (empty until V2 signed examples are
checked in there). Each seed is first verified unmutated under every mode (the
baseline); a baseline disagreement is a finding too. Most seeds are
`must_reject` bundles, which every SDK already rejects, so at least half of
the iterations start from a seed whose baseline verdict under the first mode
is valid; the summary line reports the split.

### Mutators

Each iteration applies one mutation (70%) or two (30%) at a random slot:
delete a key, set a value to `null`, swap a value's type, swap two sibling
values, flip one character of a base64 string, replace an enumerated string
with a prototype key (`constructor`, `__proto__`, `toString`, `valueOf`, ...),
rename a key to a prototype key, add an unknown key, duplicate an artifact (or
its `payload`, `payload_hash` or `composite_sig`) into another slot, rewrite a
number as `1.0`, `1e2`, `-0`, `0.1`, `2^64`, `1e400`, ..., rewrite an RFC 3339
timestamp with another offset, malformed or far in the past or future, an
oversized string (64 KiB or 1 MiB), a 100-deep nested value, and a recursive
key reorder, which must never change a verdict (it is compared with the seed's
baseline verdict). Numbers that JavaScript cannot represent are spliced into the
serialized text verbatim, so every parser sees the same bytes.

## Findings

Every finding is written to `findings/<seed>-<iteration>.json` (the directory
is git-ignored except for `.gitkeep`) with the seed name, the mutation path,
the exact mutant text and the four verdicts per mode that disagreed:

```json
{
  "seed": "1",
  "iteration": 42,
  "seed_name": "bundle_vectors.signed_bundle",
  "mutations": [{ "mutator": "set_null", "detail": "bundle.audit_entries" }],
  "verdicts": {
    "default": {
      "ts": { "valid": false, "errors": ["..."] },
      "py": { "crash": "exit 1: ..." },
      "go": { "valid": false, "errors": ["..."] },
      "rust": { "valid": false, "errors": ["..."] }
    }
  },
  "mutant_json": "{...}"
}
```

A finding is a lead, not yet a bug. First replay it: a disagreement or crash
that reproduces with the exact mutant is a divergence to resolve; a timeout, a
crash of the toolchain or the machine, or a result that does not reproduce is
an infrastructure problem until shown otherwise. Minimise the reproducer, and
decide which SDK is right from the normative requirements
(`spec/VERIFICATION.md`, the canonicalization profile) and the shared fixtures
(`tests/interop/v2/`). When they do not settle the case, it is an open question
for the specification, not a fix to pick: record it rather than adopting the
fail-closed verdict by default. Fix the wrong SDK test-first with a unit test in
that SDK, and never weaken a verifier to reach agreement. The exact mutant can be
replayed through one shim:

```bash
node -e 'console.log(require("./tools/difffuzz/findings/1-42.json").mutant_json)' | node tools/difffuzz/shims/ts/verify.mjs
```

## Shims

Each shim under `shims/` reads one JSON document on stdin and writes one JSON
line on stdout, `{"valid": bool, "errors": [string]}`, with exit code 0 for a
verdict and anything else for a crash. With `--loop` it reads one compact
document per line and answers each, which is how the driver runs them (one
long-lived process per SDK and mode, restarted after a crash or timeout). A
first positional argument selects the mode, as described under Policies. A
document the SDK's JSON parser rejects is a `valid: false` verdict.

## CI

`.github/workflows/difffuzz.yml` runs 300 iterations on every pull request,
3000 nightly, and takes `iterations` and `seed` inputs on `workflow_dispatch`.
Findings are uploaded as the `difffuzz-findings` artifact when the job fails.
