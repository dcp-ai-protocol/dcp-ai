# Canonicalization lab

**Python release (26/10/2026).** `dcp-ai` 2.10.0 is now available on PyPI, including the verifier fixes, admission and the experimental opt-in APIs. Go and Rust publication remains separate. See [Python 2.10.0](../../docs/PYTHON_RELEASE.md).

An executable **design model** of the non-normative `dcp-jcs-v2` candidate, with its corpus generator and
runner. It is not an SDK, a verifier or a conformance check: it computes SHA-256 for its synthetic commitments,
but it signs nothing and verifies no signature, and `dcp-jcs-v1` remains the only normative and default
canonicalization profile (the SDKs' candidate APIs are experimental and opt-in, see [CI](#ci)). The
design, the rules and what the model does and does not show are in [`docs/proposals/canonicalization-candidate/README.md`](../../docs/proposals/canonicalization-candidate/README.md).

| File | Role |
|---|---|
| `model.py` | The design model (imported only by `run.py`). Its executable behavior is the approved model's; docstrings clarify public paths and the assumed last-duplicate rule |
| `generate_corpus.py` | Writes `docs/proposals/canonicalization-candidate/corpus.json`; expectations are written by hand and it never imports the model |
| `run.py` | Integrity, freshness, validity and coverage checks, the 274 cases, and 24 negative controls |

Python 3.9 or later on Linux or macOS (Windows is not supported), standard library only. The commands run
from the root of a checkout; from any other directory, give the scripts their absolute paths. Outputs go to a
new temporary directory; the runner also refuses an existing output path.

```bash
out=$(mktemp -d)
python3 -I tools/canonicalization-lab/generate_corpus.py "$out/corpus.json"
cmp "$out/corpus.json" docs/proposals/canonicalization-candidate/corpus.json
python3 tools/canonicalization-lab/run.py --out "$out/run.json"
python3 tools/canonicalization-lab/run.py --controls --out "$out/controls.json"
```

## CI

[`.github/workflows/canonicalization-lab.yml`](../../.github/workflows/canonicalization-lab.yml) runs the same
commands on Ubuntu with Python 3.9 (the documented minimum) and 3.12, standard library only, on pushes to
`main` and pull requests that change the workflow, this directory or
`docs/proposals/canonicalization-candidate/`. Each job writes to a new temporary directory, regenerates the
corpus and compares it byte for byte, runs the 274 cases and the 24 negative controls, and checks both
counts; any failure fails the job.

It checks the **design model** only. It is not SDK conformance: the SDKs' opt-in candidate APIs
are tested by their own suites and by the [phase 4 matrix](../../tests/interop/candidate/phase4/README.md); no
profile and no default verifier runs the candidate, and `dcp-jcs-v1` does not change. A green run says the
model, the corpus and its expectations agree; it says nothing about any implementation.


The TypeScript and WASM opt-in APIs are available in `@dcp-ai/sdk` 2.2.0 and `@dcp-ai/wasm` 2.1.0; the other SDKs have separate releases.
