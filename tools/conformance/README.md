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
| `v2.schema` | 4 | DCP-AI-v2.0 | `schemas/v2`, `*_v2.json` examples | Schema validity only |
| `ext.dcp05_09.schema` | 18 | DCP-05 to DCP-09 | `schemas/v2`, `<record>_v2.json` examples | Schema validity only |
| `admission.strict_v1` | 117 | `spec/profiles/admission` | `admission_vectors.json` | Expected admission outcome and error codes; `action_authorized` is always false |

## Limits

- Passing a subset certifies those checks on these fixtures only, not a complete DCP implementation,
  another SDK or a deployment. Schema suites prove schema validity only; the V2 schema suite does not
  make a V2 implementation without the canonicalization, hash and signature suites.
- `verified` and `admitted` never authorize an action.
- Adapters (Express, FastAPI, OpenClaw, the verification server) are not part of the kit.
- Unresolved protocol points, listed by `ext.dcp05_09.schema` and not decided by the kit:
  DCP-05 `vitality_report` metrics are numbers in [0, 1] while `dcp-jcs-v1` only canonicalizes integers;
  DCP-08 §4.3 reverse-domain rights are refused by the `right_type` enum; DCP-09 uses `effective_until`
  where the schema and SDKs use `valid_until`; DCP-04 to DCP-09 examples use signature tags and fields
  that differ from the schemas and SDK contexts.

## Inventory

Listed by `--list` and in the report, outside the totals: they are not executed by this kit, and their
presence is not a passed test. `interop_vectors.json` attack vectors, canonicalization edge cases and other
categories, and bundle and mandate vectors run in the SDK test suites. `tests/nist-kat/` holds
known-answer vectors and property tests, each with its own scope (see
[its README](../../tests/nist-kat/README.md)); they also run in the SDK test suites. The `dcp-jcs-v2`
candidate is experimental, outside `dcp-jcs-v1`, and has its own suite (`tests/interop/candidate/`).
