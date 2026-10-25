# Canonicalization lab

An executable **design model** of the non-normative `dcp-jcs-v2` candidate, with its corpus generator and
runner. It is not an SDK, a verifier or part of CI: it computes SHA-256 for its synthetic commitments, but it
signs nothing and verifies no signature, and `dcp-jcs-v1` remains the only canonicalization profile. The design, the rules and what the model does and
does not show are in [`docs/proposals/canonicalization-candidate/README.md`](../../docs/proposals/canonicalization-candidate/README.md).

| File | Role |
|---|---|
| `model.py` | The design model (imported only by `run.py`). Its code is the approved model's; only its module docstring was adapted to public paths |
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
