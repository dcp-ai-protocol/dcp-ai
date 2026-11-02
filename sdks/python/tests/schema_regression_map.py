"""The historical rejects that V2-2 now decides first (tests/interop/v2/schema_validation/regression_map.json): for
these rows a test asserts the exact schema diagnostics both oracles report, instead of the historical error_contains,
which belonged to a deeper check the row no longer reaches. Where that check stays reachable, the map names its
coverage (schema-valid rows, deep_negatives.json or a helper's direct test; see test_schema_v2.py)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from dcp_ai.v2._schema_v2 import SCHEMA_ERRORS_CAP, bounded_token

_ROOT = Path(__file__).resolve().parents[3]
REGRESSION_MAP = json.loads((_ROOT / "tests/interop/v2/schema_validation/regression_map.json").read_text("utf-8"))


def diagnostic(e: dict[str, Any]) -> str:
    """The verifier's wording of one schema error."""
    member = f" {bounded_token(e['member'])}" if "member" in e else ""
    return f"schema: {e['instance'] or '/'} {e['keyword']}{member}"


def schema_first_row(fixture: str, name: str) -> dict[str, Any] | None:
    """The row of `fixture` (path under tests/interop/v2/) named `name`, when V2-2 now decides it."""
    return next((r for r in REGRESSION_MAP["rows"] if r["fixture"] == f"tests/interop/v2/{fixture}" and r["name"] == name), None)


def expected_diagnostics(row: dict[str, Any]) -> list[str]:
    return [diagnostic(e) for e in row["schema_errors"]]


def assert_schema_rejection(result: dict[str, Any], row: dict[str, Any]) -> None:
    """A rejection by V2-2 with exactly the oracles' schema errors (the first 16 and the marker when there are more)."""
    assert result["verified"] is False, row["name"]
    want = expected_diagnostics(row)
    if len(want) <= SCHEMA_ERRORS_CAP:
        assert sorted(result["errors"]) == sorted(want), (row["name"], result["errors"], want)
    else:
        assert len(result["errors"]) == SCHEMA_ERRORS_CAP + 1, row["name"]
        assert result["errors"][-1] == "schema: further errors not listed"
        assert all(e in want for e in result["errors"][:-1]), (row["name"], result["errors"])
