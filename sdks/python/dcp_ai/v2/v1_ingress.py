"""
Admission from bytes (opt-in, MP-02 F3): a V2 signed bundle admitted from the bytes of one JSON text, under
``dcp-jcs-v1``. Python port of the TypeScript SDK's core/v1-ingress.ts; design:
docs/reviews/mp02-security-composition-design.md § 3.

One route, in this order:

1. a private copy of the caller's bytes (``bytes`` are immutable; a ``bytearray`` or ``memoryview`` is
   copied); nothing reads the caller's object again;
2. the candidate scanner, unchanged, over that copy: its rejections keep their class and offset;
3. the portable integer domain: every number literal outside strings is a plain integer, with no fraction,
   no exponent and no ``-0`` (``NUMBER_NOT_PORTABLE``, at the literal's first byte);
4. ``json.loads`` over the same copy, canonicalized with ``dcp-jcs-v1`` and compared byte for byte with the
   scanner's canonical bytes: a difference or a parser failure is a local fault, ``INGRESS_PARSER_MISMATCH``;
5. admit_signed_bundle_v2 over that parsed value, which nobody else holds.

Nothing else changes: ``dcp-jcs-v1``, the candidate ``dcp-jcs-v2``, the scanner, the profiles, the defaults
and admit_signed_bundle_v2 keep their behavior. A transport that rewrites ``100`` as ``100.0`` is rejected
here even when the signature still verifies over the parsed value.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Callable, Union

from dcp_ai.v2.admission import admit_signed_bundle_v2
from dcp_ai.v2.canonicalize import canonicalize_v2
from dcp_ai.v2.crypto_registry import AlgorithmRegistry
from dcp_ai.v2.experimental_candidate_ingress import CandidateIngressReject, experimental_candidate_ingress

__all__ = ["admit_signed_bundle_v2_from_bytes"]

_PORTABLE_INTEGER = re.compile(rb"-?(0|[1-9][0-9]*)")
_NUMBER_BYTES = frozenset(b"0123456789.eE+-")


def _first_non_portable_number(b: bytes) -> int:
    """The offset of the first number literal outside strings that is not a plain integer, or -1. Only for a
    unit the scanner accepted, so the text is well-formed JSON and every string is closed."""
    i, n, in_string = 0, len(b), False
    while i < n:
        c = b[i]
        if in_string:
            if c == 0x5C:
                i += 2  # the escaped byte cannot end the string
                continue
            if c == 0x22:
                in_string = False
            i += 1
        elif c == 0x22:
            in_string = True
            i += 1
        elif c == 0x2D or 0x30 <= c <= 0x39:
            j = i + 1
            while j < n and b[j] in _NUMBER_BYTES:
                j += 1
            literal = b[i:j]
            if not _PORTABLE_INTEGER.fullmatch(literal) or literal == b"-0":
                return i
            i = j
        else:
            i += 1
    return -1


def _parse_json(unit: Any) -> Any:
    return json.loads(str(unit, "utf-8"))


async def admit_signed_bundle_v2_from_bytes(
    data: Union[bytes, bytearray, memoryview],
    registry: AlgorithmRegistry,
    *,
    profile: Any = None,
    policy: Any = None,
    trust: Any = None,
    revocation: Any = None,
    now_ms: int | float | None = None,
) -> dict[str, Any]:
    """Admits a V2 signed bundle from the bytes of one JSON text (see the module docstring). Returns
    ``{"ingress": {...}, "admission": dict | None, "value": Any}``; a rejected ingress has ``admission`` and
    ``value`` None. Anything but ``bytes``, ``bytearray`` or a one-dimensional byte ``memoryview`` is a
    TypeError: nothing is converted."""
    return await _admit_from_bytes_with_parser(
        _parse_json, data, registry, profile=profile, policy=policy, trust=trust, revocation=revocation, now_ms=now_ms
    )


async def _admit_from_bytes_with_parser(
    parse: Callable[[bytes], Any], data: Any, registry: AlgorithmRegistry, **options: Any
) -> dict[str, Any]:
    """Tests only: the same route with another parser, to show that a parser fault is caught. It is private
    to this module (dcp_ai.v2 does not export it) and no request or option selects it."""
    if isinstance(data, memoryview):
        if data.format != "B" or data.ndim != 1:
            raise TypeError("admit_signed_bundle_v2_from_bytes: a memoryview must be one-dimensional bytes (format 'B')")
    elif not isinstance(data, (bytes, bytearray)):
        raise TypeError("admit_signed_bundle_v2_from_bytes: data must be bytes, bytearray or memoryview")
    unit = bytes(data)  # a copy: a bytearray or memoryview would share the caller's memory
    unit_sha256 = hashlib.sha256(unit).hexdigest()

    def reject(layer: str, cls: str, offset: int | None) -> dict[str, Any]:
        ingress = {"accepted": False, "layer": layer, "class": cls, "offset": offset,
                   "unit_sha256": unit_sha256, "canonical_sha256": None}
        return {"ingress": ingress, "admission": None, "value": None}

    scanned = experimental_candidate_ingress(unit)
    if isinstance(scanned, CandidateIngressReject):
        return reject("scanner", scanned.reject_class, scanned.offset)
    at = _first_non_portable_number(unit)
    if at >= 0:
        return reject("domain", "NUMBER_NOT_PORTABLE", at)

    same = False
    try:
        value = parse(unit)
        same = canonicalize_v2(value).encode("utf-8") == scanned.canonical
    except Exception:  # noqa: BLE001 — a parser that fails on a unit the scanner accepted is the same local fault
        pass
    if not same:
        return reject("parser", "INGRESS_PARSER_MISMATCH", None)

    admission = await admit_signed_bundle_v2(value, registry, **options)
    ingress = {"accepted": True, "layer": None, "class": None, "offset": None,
               "unit_sha256": unit_sha256, "canonical_sha256": scanned.canonical_sha256}
    return {"ingress": ingress, "admission": admission, "value": value}
