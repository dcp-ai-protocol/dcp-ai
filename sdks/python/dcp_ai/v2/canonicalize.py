"""
RFC 8785 JSON canonicalization with float prohibition for DCP v2.
"""

from __future__ import annotations

import json
from typing import Any


def assert_no_floats(value: Any, path: str = "$") -> None:
    """Raise TypeError if any float is found in the value tree."""
    if isinstance(value, float):
        raise TypeError(f"Float value found at {path}: {value!r}. Use int instead.")
    if isinstance(value, dict):
        for k, v in value.items():
            assert_no_floats(v, f"{path}.{k}")
    elif isinstance(value, (list, tuple)):
        for i, v in enumerate(value):
            assert_no_floats(v, f"{path}[{i}]")


def canonicalize_v2(obj: Any) -> str:
    """Canonical JSON serialization — sorted keys, compact separators, integers only.

    Raises TypeError if the object tree contains any float values.
    """
    assert_no_floats(obj)
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
