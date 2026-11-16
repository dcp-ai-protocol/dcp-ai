"""One contender of the two-process ledger test (TEST ONLY).

    python -I python/ledger_race_child.py ROOT TENANT START_AT_MS KEYS_FILE

Sleeps until START_AT_MS, tries to reserve every key and prints {"pid", "attempted", "won"} as JSON.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from rehearsal_ledger import reserve  # noqa: E402


def main(root: str, tenant: str, start_at_ms: str, keys_file: str) -> None:
    keys = json.loads(Path(keys_file).read_text(encoding="utf-8"))
    time.sleep(max(0.0, (int(start_at_ms) - time.time() * 1000) / 1000))
    won = [k for k in keys if reserve(root, tenant, k)]
    print(json.dumps({"pid": os.getpid(), "attempted": len(keys), "won": won}))


if __name__ == "__main__":
    main(*sys.argv[1:5])
