"""
DCP v2.0 canonicalization — profile `dcp-jcs-v1`.

Strict subset of RFC 8785 (JCS) with the cases JCS leaves
implementation-defined explicitly pinned. See
``spec/CANONICALIZATION_PROFILE.md`` for the normative reference.

Numeric rule: a number is valid iff its value, post-parse, is a finite
integer. ``1.0``, ``1.00``, ``1e2`` are accepted and normalised to
their integer form; ``0.1``, ``NaN``, ``±inf`` are rejected.
"""

from __future__ import annotations

import json
import math
from typing import Any


def assert_no_floats(value: Any, path: str = "$") -> None:
    """Reject any number whose value is not a finite integer.

    Accepts ``int`` and ``float`` instances whose value has no fractional
    part (``1.0``, ``100.0``). Rejects floats with fractional value
    (``0.1``), NaN, and infinities. Recurses into dicts and lists.

    The function preserves its historical name for API compatibility
    even though under profile ``dcp-jcs-v1`` it now accepts integer-
    valued floats. The wire format JSON parser cannot distinguish
    ``1`` from ``1.0`` after parse — pinning the rule post-parse is
    the only way the four DCP-AI SDKs converge byte-for-byte.
    """
    if isinstance(value, bool):  # bool subclasses int — skip the int branch
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            raise TypeError(f"Non-finite number at {path}: {value!r}")
        if not value.is_integer():
            raise TypeError(
                f"Non-integer number at {path}: {value!r}. "
                f"DCP v2 (dcp-jcs-v1) requires integer values."
            )
        return
    if isinstance(value, dict):
        for k, v in value.items():
            assert_no_floats(v, f"{path}.{k}")
    elif isinstance(value, (list, tuple)):
        for i, v in enumerate(value):
            assert_no_floats(v, f"{path}[{i}]")


def _normalize_integer_floats(value: Any) -> Any:
    """Convert integer-valued floats to ``int`` ahead of ``json.dumps``.

    ``json.dumps(1.0)`` produces ``"1.0"`` and would diverge from the
    other SDKs' output. Coercing to ``int`` first guarantees the
    profile's "no decimal point, no exponent" output for any number
    whose value is a finite integer.
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, float):
        # `assert_no_floats` already rejected the non-integer cases.
        return int(value)
    if isinstance(value, dict):
        return {k: _normalize_integer_floats(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_normalize_integer_floats(v) for v in value]
    return value


def canonicalize_v2(obj: Any) -> str:
    """Canonical JSON serialisation per profile ``dcp-jcs-v1``.

    - Object keys sorted lexicographically by Unicode code point.
    - Compact form (no whitespace).
    - Integer-only numbers, decided post-parse — integer-valued floats
      are normalised, fractional floats are rejected.
    - ``None`` preserved as JSON ``null``.

    Raises ``TypeError`` if the tree contains a non-integer or
    non-finite number.
    """
    assert_no_floats(obj)
    normalised = _normalize_integer_floats(obj)
    return json.dumps(normalised, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
