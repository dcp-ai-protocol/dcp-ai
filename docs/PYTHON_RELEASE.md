# Published Python package

Verified on 28/10/2026: [`dcp-ai` 2.10.1](https://pypi.org/project/dcp-ai/2.10.1/) is available on PyPI. This Python package version is independent of the DCP wire/specification version. The Python package is published independently of Go, Rust, npm packages and containers. The previous release, [2.10.0](https://pypi.org/project/dcp-ai/2.10.0/), was verified on 26/10/2026; its notes are kept below.

## Install

Python 3.10 or later is required. Update your environment or lockfile. Optional integration extras remain separate from the protocol core:

```bash
pip install --upgrade "dcp-ai>=2.10.1,<3"
pip install "dcp-ai[fastapi]>=2.10.1,<3"
pip install "dcp-ai[langchain]>=2.10.1,<3"
pip install "dcp-ai[openai]>=2.10.1,<3"
pip install "dcp-ai[crewai]>=2.10.1,<3"
pip install "dcp-ai[otlp]>=2.10.1,<3"
```

## What changed in 2.10.1

It verifies the secondary SHA3-256 fields of [VERIFICATION.md V2-11](../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) when they are present: `audit_merkle_root_secondary` (the SHA3-256 tree built like the primary one; `sha3-256:` followed by 64 zeros for an empty trail), each `prev_hash_secondary` (`"GENESIS"` on the first entry, then the SHA3-256 of the entry before it as carried) and each `intent_hash_secondary` (the SHA3-256 of the intent payload). Absent fields are not required, so a verified bundle may lack a complete secondary chain. A present field that is `null`, not a string or inconsistent is rejected: this is an acceptance change for evidence that carries such fields, which 2.10.0 accepted. APIs, result fields, `dcp-jcs-v1`, the experimental opt-in `dcp-jcs-v2` APIs and `hash_alg` handling are unchanged. Verification is still not principal trust, admission or authorization.

## What changed

The changes of 2.10.0 (26/10/2026), which 2.10.1 keeps:

This release includes the V2 verifier corrections, principal trust and `strict-v1`, opt-in source deadlines/capacity, FastAPI body budgets and disconnect handling, bridge verification fixes, and the experimental canonicalization APIs. It also corrects a Python 3.10 cancellation race in the deny-list worker wait: cancelling a request must not release a slot before its worker finishes.

FastAPI in 2.9.0 accepts structurally valid V2 bundles without verifying their signatures. Upgrade to 2.10.0 before using it for V2 verification. See [SECURITY](../SECURITY.md), [admission](ADMISSION.md) and the [Python SDK README](../sdks/python/README.md).

## Compatibility and verification

`dcp-jcs-v1` remains the only normative default. `dcp-jcs-v2` remains experimental, non-normative and explicitly opt-in. Verification, trust, admission and authorization are distinct; installing this release does not enable a trust policy for you. Stricter verification can reject evidence accepted by 2.9.0. Preserve historical evidence instead of rewriting it.

For 2.10.1, the wheel and source distribution published on PyPI by the release workflow are byte-identical to the artifacts reviewed before publication, and their registry checksums were confirmed. Before publication, those artifacts, installed in fresh environments outside the checkout, passed the shared secondary SHA3-256 vectors (103 tests each) and an independent consumer suite (86 tests each).

After publication, fresh PyPI installations of both the wheel and source distribution each passed the 86 independent checks; the registry wheel also passed the 103 shared-vector tests.

For 2.10.0 (26/10/2026), the installed wheel passed 1,866 tests on Python 3.12; the installed source distribution passed 1,863 tests on Python 3.10 with three expected skips for Python 3.12-only task factories. Both distributions passed metadata checks and matched all 59 Python source modules. CI covers Python 3.10 and 3.12.

The ML-DSA dependency can raise `ValueError` if its bounded signing attempts are exhausted. A CI fixture hit this failure while creating a signature; verification was not bypassed. Callers must handle signing failure as an error, never as signed evidence.

## Related releases

The current versions in every registry are listed in [Published versions](README.md#published-versions). Other release notes: [npm packages](NPM_RELEASES.md), [Go v2.11.1](GO_RELEASE.md) and [Rust 2.11.1](RUST_RELEASE.md).
