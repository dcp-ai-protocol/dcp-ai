# Published Python package

Verified on 26/10/2026: [`dcp-ai` 2.10.0](https://pypi.org/project/dcp-ai/2.10.0/) is available on PyPI. This Python package version is independent of the DCP wire/specification version. This release does not publish Go, Rust, npm packages or containers.

## Install

Python 3.10 or later is required. Update your environment or lockfile. Optional integration extras remain separate from the protocol core:

```bash
pip install --upgrade "dcp-ai>=2.10.0,<3"
pip install "dcp-ai[fastapi]>=2.10.0,<3"
pip install "dcp-ai[langchain]>=2.10.0,<3"
pip install "dcp-ai[openai]>=2.10.0,<3"
pip install "dcp-ai[crewai]>=2.10.0,<3"
pip install "dcp-ai[otlp]>=2.10.0,<3"
```

## What changed

This release includes the V2 verifier corrections, principal trust and `strict-v1`, opt-in source deadlines/capacity, FastAPI body budgets and disconnect handling, bridge verification fixes, and the experimental canonicalization APIs. It also corrects a Python 3.10 cancellation race in the deny-list worker wait: cancelling a request must not release a slot before its worker finishes.

FastAPI in 2.9.0 accepts structurally valid V2 bundles without verifying their signatures. Upgrade to 2.10.0 before using it for V2 verification. See [SECURITY](../SECURITY.md), [admission](ADMISSION.md) and the [Python SDK README](../sdks/python/README.md).

## Compatibility and verification

`dcp-jcs-v1` remains the only normative default. `dcp-jcs-v2` remains experimental, non-normative and explicitly opt-in. Verification, trust, admission and authorization are distinct; installing this release does not enable a trust policy for you. Stricter verification can reject evidence accepted by 2.9.0. Preserve historical evidence instead of rewriting it.

The installed wheel passed 1,866 tests on Python 3.12; the installed source distribution passed 1,863 tests on Python 3.10 with three expected skips for Python 3.12-only task factories. Both distributions passed metadata checks and matched all 59 Python source modules. CI covers Python 3.10 and 3.12.

The ML-DSA dependency can raise `ValueError` if its bounded signing attempts are exhausted. A CI fixture hit this failure while creating a signature; verification was not bypassed. Callers must handle signing failure as an error, never as signed evidence.

## Related releases

The current versions in every registry are listed in [Published versions](README.md#published-versions). Other release notes: [npm packages](NPM_RELEASES.md), [Go v2.11.0](GO_RELEASE.md) and [Rust 2.11.0](RUST_RELEASE.md).
