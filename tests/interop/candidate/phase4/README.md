# Phase 4 matrix: candidate producers × consumers

Experimental and inactive. These tests are evidence for
[§18 of the candidate README](../../../../docs/proposals/canonicalization-candidate/README.md#18-experimental-sdk-producers-phase-4).
They do not activate `dcp-jcs-v2` or change any default.

## Files

| File | Purpose |
|---|---|
| [`run.mjs`](run.mjs) | The runner: the matrix, `--cost` and `--self-test` |
| [`phase4-specs.json`](phase4-specs.json) | The 12 specifications, the 16 negatives and the expectations |
| `adapters/ts.mjs`, `adapters/wasm.mjs`, `adapters/py_adapter.py`, `adapters/common.mjs` | The TypeScript, WASM and Python adapters |
| `sdks/go/dcp/v2/experimental_candidate_phase4_matrix_test.go` | The Go adapter, a test that runs only under the runner |
| `sdks/rust/tests/experimental_candidate_phase4_matrix.rs` | The Rust adapter, a test that runs only under the runner |

## What a run does

1. The TypeScript adapter writes the run's inputs:
   - new synthetic keys;
   - the input pieces of each specification as JSON text, the same bytes for every producer.
2. Each producer signs every specification in the modes it lists (bytes and value for `S01` to `S10`, bytes
   only for `S11`, value only for `S12`) with its public opt-in API. It also
   derives the key IDs and writes them for comparison.
3. Each producer assembles the ring: `S01` from the artifacts the next producer signed (ts, py, go, rust,
   wasm, ts).
4. The runner writes 16 byte-level negatives of each producer's fresh output.
5. Each consumer verifies everything with the phase 3 verifier. For each item it reports the route, the
   class, the verifier entered, the verdict and the calls it observed to its historical decoder.

The verdict is all or nothing. It expects:

- exactly 975 results (115 units × 5 consumers, and 16 × 5 × 5 byte-level negatives): 525 positive and 450
  negative, the 400 byte-level ones and the 50 results of `S09` that V2-2 refuses (below). Before V2-2 every unit
  was positive: 575 and 400;
- every step, and each result fresh from this run;
- the same `manifest_hash` from every producer for each specification;
- the same unit from every producer, except for the ML-DSA signature values, which are masked only at their
  known places;
- the same key IDs from every SDK;
- the run finished before the deadline (`--deadline`, 1800 s by default). At the deadline the whole process group
  of the step is killed: each step starts detached in its own POSIX process group, so this is not promised on
  Windows.

### `S09` under V2-2

V2-2 is the schema validation in every SDK's verifier. On the candidate path it runs after the parser and the profile
policy, and before the verifier checks payload hashes and signatures. It closes the audit entry, the checkpoint, the
`SignedPayload` envelope and its `composite_sig`. `S09` puts a member the producer does not know in each of them,
so its 50 results (5 producers × 2 modes × 5 consumers) are refused on the candidate path. The specification and its
bytes are unchanged; the expectation is in the runner (`V2_2_CLOSED_MEMBERS` in `run.mjs`):

- route `candidate`, verifier `dcp-jcs-v2` entered, `verified` false, no class and no decoder call;
- these four diagnostics, in this order, which every SDK returns:
  - `schema: /bundle/audit_entries/1 additionalProperties x_entry_ext`
  - `schema: /bundle/intent additionalProperties x_artifact_ext`
  - `schema: /bundle/intent/composite_sig additionalProperties x_sig_ext`
  - `schema: /bundle/pq_checkpoints/0 additionalProperties x_checkpoint_ext`

  The adapters record only the first three errors of a result, so the matrix compares exactly those three. Each
  SDK's producer tests (bundle generation) assert all four;
- each refusal counts only when the `S04` unit (the checkpoint without those members) of the same producer and mode
  is verified by the same consumer.

The member `S09` adds to the intent target is open and raises no diagnostic. The run fails if any `S09` result is
accepted or refused in any other way, or if any other positive is refused.

## Running it

Build first: `sdks/typescript` (`npm run build`), and `sdks/wasm` (`npm run build:wasm` and `npm run build:ts`).
Python needs the SDK's dependencies; Go and Cargo are used as installed. From the root of a checkout:

```bash
node tests/interop/candidate/phase4/run.mjs --self-test
DCP_PHASE4_PYTHON=python3 node tests/interop/candidate/phase4/run.mjs --deadline 900
DCP_PHASE4_PYTHON=python3 node tests/interop/candidate/phase4/run.mjs --cost
```

Each run writes a new directory under the system temporary directory, or under `--out <dir>`. The directory
holds the keys, outputs, results, logs and `summary.json` (or `cost-summary.json`). It is private to whoever
runs it: the keys are synthetic, but nothing in it is meant to be published. Exit code 0 means every check
passed, 1 that something failed, 2 an invalid configuration (a `--deadline` that is not a positive number).

`--cost` measures gate 10 on one equivalent pair per platform. Both sides use the same keys, payloads, session
and audit entries, and this is checked on the outputs. Each operation runs 20 times after 3 warm-ups, with at
most 60 s per platform. The Go and Rust builds are timed apart, and Rust is measured on the release profile.
The limits of these numbers are in §18.3 of the candidate README.
