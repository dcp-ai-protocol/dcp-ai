# Published Python package

Verified on 05/11/2026: [`dcp-ai` 2.10.2](https://pypi.org/project/dcp-ai/2.10.2/) is available on PyPI ([what changed](#what-changed-in-2102)). This Python package version is independent of the DCP wire/specification version. The Python package is published independently of Go, Rust, npm packages and containers. The previous releases, [2.10.1](https://pypi.org/project/dcp-ai/2.10.1/), verified on 28/10/2026, and [2.10.0](https://pypi.org/project/dcp-ai/2.10.0/), verified on 26/10/2026, keep their notes below.

## Install

Python 3.10 or later is required. Update your environment or lockfile. Optional integration extras remain separate from the protocol core:

```bash
pip install --upgrade "dcp-ai>=2.10.2,<3"
pip install "dcp-ai[fastapi]>=2.10.2,<3"
pip install "dcp-ai[langchain]>=2.10.2,<3"
pip install "dcp-ai[openai]>=2.10.2,<3"
pip install "dcp-ai[crewai]>=2.10.2,<3"
pip install "dcp-ai[otlp]>=2.10.2,<3"
```

## What changed in 2.10.1

It verifies the secondary SHA3-256 fields of [VERIFICATION.md V2-11](../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) when they are present: `audit_merkle_root_secondary` (the SHA3-256 tree built like the primary one; `sha3-256:` followed by 64 zeros for an empty trail), each `prev_hash_secondary` (`"GENESIS"` on the first entry, then the SHA3-256 of the entry before it as carried) and each `intent_hash_secondary` (the SHA3-256 of the intent payload). Absent fields are not required, so a verified bundle may lack a complete secondary chain. A present field that is `null`, not a string or inconsistent is rejected: this is an acceptance change for evidence that carries such fields, which 2.10.0 accepted. APIs, result fields, `dcp-jcs-v1`, the experimental opt-in `dcp-jcs-v2` APIs and `hash_alg` handling are unchanged. Verification is still not principal trust, admission or authorization.

## What changed

The changes of 2.10.0 (26/10/2026), which 2.10.1 keeps:

This release includes the V2 verifier corrections, principal trust and `strict-v1`, opt-in source deadlines/capacity, FastAPI body budgets and disconnect handling, bridge verification fixes, and the experimental canonicalization APIs. It also corrects a Python 3.10 cancellation race in the deny-list worker wait: cancelling a request must not release a slot before its worker finishes.

FastAPI in 2.9.0 accepts structurally valid V2 bundles without verifying their signatures. Upgrade to 2.10.0 before using it for V2 verification. See [SECURITY](../SECURITY.md), [admission](ADMISSION.md) and the [Python SDK README](../sdks/python/README.md).

## Compatibility and verification

For 2.10.2, the wheel and the source distribution published on PyPI by the release workflow, from `main` (`46b142bd`), contain the same files, byte for byte, as the artifacts tested before publication. Fresh installations from PyPI of the wheel and of the source distribution, outside the checkout, each passed the external conformance kit (697 cases in seven catalogs) and the 2.10.2 checks of the revoked-ID set and the verification time; the package files installed from the source distribution are, byte for byte, the files of the tested wheel.

`dcp-jcs-v1` remains the only normative default. `dcp-jcs-v2` remains experimental, non-normative and explicitly opt-in. Verification, trust, admission and authorization are distinct; installing this release does not enable a trust policy for you. Stricter verification can reject evidence accepted by 2.9.0. Preserve historical evidence instead of rewriting it.

For 2.10.1, the wheel and source distribution published on PyPI by the release workflow are byte-identical to the artifacts reviewed before publication, and their registry checksums were confirmed. Before publication, those artifacts, installed in fresh environments outside the checkout, passed the shared secondary SHA3-256 vectors (103 tests each) and an independent consumer suite (86 tests each).

After publication, fresh PyPI installations of both the wheel and source distribution each passed the 86 independent checks; the registry wheel also passed the 103 shared-vector tests.

For 2.10.0 (26/10/2026), the installed wheel passed 1,866 tests on Python 3.12; the installed source distribution passed 1,863 tests on Python 3.10 with three expected skips for Python 3.12-only task factories. Both distributions passed metadata checks and matched all 59 Python source modules. CI covers Python 3.10 and 3.12.

The ML-DSA dependency can raise `ValueError` if its bounded signing attempts are exhausted. A CI fixture hit this failure while creating a signature; verification was not bypassed. Callers must handle signing failure as an error, never as signed evidence.

## What changed in 2.10.2

2.10.2 was published on PyPI on 05/11/2026 by the release workflow, from `main` (`46b142bd`). Compared with 2.10.1, 2.10.2:

- **Runs V2-2 schema validation (acceptance change).** `verify_signed_bundle_v2` and the other V2 verification functions, and so the FastAPI middleware and the bridges, validate the signed bundle envelope and the four payloads against `schemas/v2` before any hash, key or signature check. Schema-invalid bundles accepted before now fail with `schema: <pointer> <keyword>` diagnostics.
- **Aligns the mandate checks.** `verify_mandate_validity` applies one contract and returns a result instead of raising; `now=` must be an aware `datetime`. The revoked IDs, annotated `set[str]`, are now checked as a `collections.abc.Set` (a `set`, a `frozenset` or a dict keys view): a list or a string, tolerated before, is refused. `verify_mandate_chain` reads every time the same way and rejects a root mandate that repeats a domain.

The wire format, the signatures, the profiles, `dcp-jcs-v1` as the normative default and the experimental opt-in `dcp-jcs-v2` APIs are unchanged, and the wheel and the sdist now include the Apache-2.0 `LICENSE`. Preserve historical evidence instead of rewriting it. The README inside the published wheel and sdist is the one prepared before publication and reads "prepared, not published"; published files cannot change. See the [SDK README](../sdks/python/README.md) and the [changelog](../CHANGELOG.md#unreleased).

## Prepared, not published: 2.11.0

Prepared on 08/11/2026 and not published; the installation commands above stay on 2.10.2 until 2.11.0 is published and checked.

- **Added (opt-in).** `admit_delegated_bundle_v2`, `admit_signed_bundle_v2_from_bytes`, `create_mandate_acknowledgment` and `evaluate_delegation_activation_v2` ([changelog](../CHANGELOG.md#unreleased)).
- **Acceptance change.** P-ED-1 in V1 object verification and the default V2 Ed25519 provider; the official PyNaCl build already rejected these signatures.
- The wire format, the signatures, the profiles and `dcp-jcs-v1` are unchanged.

## Related releases

The current versions in every registry are listed in [Published versions](README.md#published-versions). Other release notes: [npm packages](NPM_RELEASES.md), [Go v2.13.0](GO_RELEASE.md) and [Rust 2.13.0](RUST_RELEASE.md).
