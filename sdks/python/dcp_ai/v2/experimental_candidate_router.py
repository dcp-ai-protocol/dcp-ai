"""EXPERIMENTAL and opt-in: phase 2 of the inactive candidate profile ``dcp-jcs-v2``
(docs/proposals/canonicalization-candidate, §5–§7): the unit from a transport, the profile it selects,
and the decision to reject it, to delegate it to ``dcp-jcs-v1`` through an explicit historical adapter,
or to hand it to the candidate path.

It is not normative and nothing calls it: ``dcp-jcs-v1``, its verifiers and every default are unchanged,
and ``dcp_ai.v2`` does not re-export it. It verifies, signs or admits nothing; ``candidate`` is never an
acceptance (phase 3 verifies it).

One byte-level grammar walker serves both the envelope extraction and the profile reader; the unit's own
diagnosis is the unchanged phase 1 ingress. The historical adapter is consulted lazily, at most once per
route, and its reading can never produce ``candidate``.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable, Literal, Optional, Tuple, Union

from dcp_ai.v2.experimental_candidate_ingress import (
    CandidateIngressAccept,
    ExperimentalCandidateInternalError,
    experimental_candidate_ingress,
)

__all__ = [
    "JSON_LOADS_BYTES",
    "JSON_LOADS_STRICT_DECODE",
    "ExperimentalCandidateAdapterError",
    "ExperimentalCandidateConfigError",
    "ExperimentalCandidateRouter",
    "HistoricalAdapter",
    "HistoricalDecodeFailure",
    "HistoricalOutcome",
    "RouteCandidate",
    "RouteReject",
    "RouteV1Path",
    "RouteWarning",
    "TransportReject",
    "UnitRange",
    "create_router",
    "extract_unit",
]

_PROFILES = ("dcp-jcs-v1", "dcp-jcs-v2")
_ENCODING_OR_GRAMMAR = ("BOM", "UTF8_INVALID", "SYNTAX")


class ExperimentalCandidateConfigError(Exception):
    """A configuration error, raised when the router is created and never for the data."""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(f"{code}: {detail}")
        self.code = code
        self.detail = detail


class ExperimentalCandidateAdapterError(Exception):
    """A historical adapter that failed otherwise than by refusing the data; never a rejection."""

    def __init__(self, adapter: str, message: str) -> None:
        super().__init__(f"historical adapter {adapter}: {message}")
        self.adapter = adapter


class HistoricalDecodeFailure(Exception):
    """Raised by an adapter's ``decode`` when its decoder refuses the data (the data path)."""


class HistoricalAdapter:
    """A historical decoder: ``name`` and ``decode(unit: bytes)``, which returns the decoder's value as
    is or raises HistoricalDecodeFailure when the decoder refuses the data. The router reads the profile
    from the value by the exact path, so the decoder must keep the last duplicate member, as the
    built-in ones measurably do; parity is only claimed for adapters that pass the parity tests."""

    def __init__(self, name: str, decode: Callable[[bytes], Any]) -> None:
        self.name = name
        self.decode = decode


def _json_loads_adapter(name: str, load: Callable[[bytes], Any]) -> HistoricalAdapter:
    def decode(unit: bytes) -> Any:
        try:
            return load(unit)
        except (ValueError, RecursionError) as e:  # what the real decoder does with these bytes
            raise HistoricalDecodeFailure(f"{type(e).__name__}: {e}") from e

    return HistoricalAdapter(name, decode)


JSON_LOADS_BYTES = _json_loads_adapter("json_loads_bytes", lambda b: json.loads(b))
JSON_LOADS_STRICT_DECODE = _json_loads_adapter("json_loads_strict_decode", lambda b: json.loads(b.decode("utf-8")))


@dataclass(frozen=True)
class UnitRange:
    start: int
    end: int


@dataclass(frozen=True)
class TransportReject:
    reject_class: str
    detail: str
    transport_offset: Optional[int]


@dataclass(frozen=True)
class RouteWarning:
    reject_class: str
    offset: int
    transport_offset: int


@dataclass(frozen=True)
class HistoricalOutcome:
    adapter: str
    ok: bool
    decoded: Any = None
    failed: Optional[str] = None


@dataclass(frozen=True)
class RouteReject:
    reject_class: str
    detail: Optional[str]
    offset: Optional[int]
    transport_offset: Optional[int]
    unit: Optional[UnitRange]
    profile: Optional[str]
    attempts: Tuple[str, ...] = ()
    warnings: Tuple[RouteWarning, ...] = ()
    outcome: Literal["reject"] = "reject"


@dataclass(frozen=True)
class RouteV1Path:
    unit: UnitRange
    unit_bytes: bytes
    profile_source: str  # field, absent or historical
    warnings: Tuple[RouteWarning, ...]
    historical: HistoricalOutcome
    profile: str = "dcp-jcs-v1"
    attempts: Tuple[str, ...] = ("dcp-jcs-v1",)
    outcome: Literal["v1_path"] = "v1_path"


@dataclass(frozen=True)
class RouteCandidate:
    unit: UnitRange
    unit_bytes: bytes
    value: Any
    canonical: bytes
    canonical_sha256: str
    profile: str = "dcp-jcs-v2"
    attempts: Tuple[str, ...] = ("dcp-jcs-v2",)
    warnings: Tuple[RouteWarning, ...] = ()
    outcome: Literal["candidate"] = "candidate"


RouteResult = Union[RouteReject, RouteV1Path, RouteCandidate]


# ── The byte-level grammar walker ───────────────────────────────────────────

class _WalkStop(Exception):
    def __init__(self, offset: int) -> None:
        super().__init__(offset)
        self.offset = offset


_WS = b" \t\n\r"
_DIGITS = b"0123456789"
_HEX = b"0123456789abcdefABCDEF"
_SIMPLE = b'"\\/bfnrt'


def _walk(b: bytes, start: int, end: int, record_depth: int):
    """The RFC 8259 grammar of b[start:end] as one JSON text, iteratively and at any depth, without
    decoding: strings are delimited and their escapes checked, bytes of 0x80 and above inside them are
    left to the encoding check. Records [container, name_start, name_end, value_start, value_end,
    value_object] for the members of the objects within ``record_depth`` levels. Returns (True, root
    start, root is an object, members) or (False, offset of the first byte that cannot extend a prefix
    of a JSON text, or ``end``)."""
    pos = start

    def need() -> int:
        if pos >= end:
            raise _WalkStop(end)
        return b[pos]

    def skip_ws() -> None:
        nonlocal pos
        while pos < end and b[pos] in _WS:
            pos += 1

    def string() -> None:
        nonlocal pos
        pos += 1
        while True:
            c = need()
            if c == 0x22:
                pos += 1
                return
            if c < 0x20:
                raise _WalkStop(pos)
            if c != 0x5C:
                pos += 1
                continue
            pos += 1
            e = need()
            if e == 0x75:
                for _ in range(4):
                    pos += 1
                    if need() not in _HEX:
                        raise _WalkStop(pos)
                pos += 1
            elif e in _SIMPLE:
                pos += 1
            else:
                raise _WalkStop(pos)

    def digits() -> None:
        nonlocal pos
        while pos < end and b[pos] in _DIGITS:
            pos += 1

    def number() -> None:
        nonlocal pos
        if b[pos] == 0x2D:
            pos += 1
        c = need()
        if c == 0x30:
            pos += 1
        elif c in _DIGITS:
            digits()
        else:
            raise _WalkStop(pos)
        if pos < end and b[pos] == 0x2E:
            pos += 1
            if need() not in _DIGITS:
                raise _WalkStop(pos)
            digits()
        if pos < end and b[pos] in b"eE":
            pos += 1
            if need() in b"+-":
                pos += 1
            if need() not in _DIGITS:
                raise _WalkStop(pos)
            digits()

    def literal(word: bytes) -> None:
        nonlocal pos
        for expected in word:
            if pos >= end:
                raise _WalkStop(end)
            if b[pos] != expected:
                raise _WalkStop(pos)
            pos += 1

    members: list = []
    stack: list = []  # [is_object, id, depth, pending member index]
    next_id = 0
    try:
        skip_ws()
        root_start = pos
        root_object = False
        state = "value"
        while True:
            if state == "value":
                c = need()
                if c == 0x7B or c == 0x5B:
                    is_object = c == 0x7B
                    if not stack:
                        root_object = is_object
                    elif stack[-1][3] >= 0 and is_object:
                        members[stack[-1][3]][5] = next_id
                    stack.append([is_object, next_id, len(stack) + 1, -1])
                    next_id += 1
                    pos += 1
                    skip_ws()
                    if pos < end and b[pos] == (0x7D if is_object else 0x5D):
                        pos += 1
                        stack.pop()
                        state = "after"
                    else:
                        state = "key" if is_object else "value"
                elif c == 0x22:
                    string()
                    state = "after"
                elif c == 0x2D or c in _DIGITS:
                    number()
                    state = "after"
                elif c == 0x74:
                    literal(b"true")
                    state = "after"
                elif c == 0x66:
                    literal(b"false")
                    state = "after"
                elif c == 0x6E:
                    literal(b"null")
                    state = "after"
                else:
                    raise _WalkStop(pos)
            elif state == "key":
                if need() != 0x22:
                    raise _WalkStop(pos)
                name_start = pos
                string()
                name_end = pos
                skip_ws()
                if need() != 0x3A:
                    raise _WalkStop(pos)
                pos += 1
                skip_ws()
                frame = stack[-1]
                if frame[2] <= record_depth:
                    frame[3] = len(members)
                    members.append([frame[1], name_start, name_end, pos, -1, -1])
                state = "value"
            else:
                if not stack:
                    skip_ws()
                    if pos != end:
                        raise _WalkStop(pos)
                    return True, root_start, root_object, members
                frame = stack[-1]
                if frame[3] >= 0:
                    members[frame[3]][4] = pos
                    frame[3] = -1
                skip_ws()
                c = need()
                if c == 0x2C:
                    pos += 1
                    skip_ws()
                    state = "key" if frame[0] else "value"
                elif c == (0x7D if frame[0] else 0x5D):
                    pos += 1
                    stack.pop()
                else:
                    raise _WalkStop(pos)
    except _WalkStop as e:
        return False, e.offset, False, []


_UNESCAPE = {0x22: 0x22, 0x5C: 0x5C, 0x2F: 0x2F, 0x62: 0x08, 0x66: 0x0C, 0x6E: 0x0A, 0x72: 0x0D, 0x74: 0x09}


def _string_equals(b: bytes, start: int, end: int, target: str) -> bool:
    """Whether the string b[start:end] (quotes included, grammar already checked) unescapes to the
    ASCII ``target``."""
    i, k = start + 1, 0
    while i < end - 1:
        if b[i] == 0x5C:
            if b[i + 1] == 0x75:
                unit = int(b[i + 2:i + 6], 16)
                i += 6
            else:
                unit = _UNESCAPE[b[i + 1]]
                i += 2
        else:
            if b[i] >= 0x80:
                return False  # the targets are ASCII
            unit = b[i]
            i += 1
        if k >= len(target) or unit != ord(target[k]):
            return False
        k += 1
    return k == len(target)


def _last_member(b: bytes, members: list, container: int, name: str):
    for m in reversed(members):
        if m[0] == container and _string_equals(b, m[1], m[2], name):
            return m
    return None


def _first_invalid_utf8(b: bytes) -> int:
    try:
        b.decode("utf-8")
        return -1
    except UnicodeDecodeError as e:
        return e.start


def _extract(b: bytes, transport: str) -> Union[UnitRange, TransportReject]:
    n = len(b)
    if transport == "bare":
        return UnitRange(0, n)
    if b.startswith(b"\xef\xbb\xbf"):
        return TransportReject("TRANSPORT_INVALID", "BOM", 0)  # T1
    ok, where, root_object, members = _walk(b, 0, n, 1)  # T2
    if not ok:
        return TransportReject("TRANSPORT_INVALID", "SYNTAX", where)
    if not root_object:
        return TransportReject("TRANSPORT_INVALID", "NOT_AN_OBJECT", where)  # T3
    named = [m for m in members if m[0] == 0 and _string_equals(b, m[1], m[2], "signed_bundle")]
    if not named:
        return TransportReject("TRANSPORT_INVALID", "NO_SIGNED_BUNDLE", None)  # T4
    if len(named) > 1:
        return TransportReject("TRANSPORT_AMBIGUOUS", "SIGNED_BUNDLE_REPEATED", named[1][1])
    start, end = named[0][3], named[0][4]
    for base, part in ((0, b[:start]), (end, b[end:])):  # T5: before the unit, then after it
        bad = _first_invalid_utf8(part)
        if bad >= 0:
            return TransportReject("TRANSPORT_INVALID", "UTF8_INVALID", base + bad)
    return UnitRange(start, end)


def extract_unit(data: Union[bytes, bytearray, memoryview], transport: str) -> Union[UnitRange, TransportReject]:
    """EXPERIMENTAL, opt-in (candidate ``dcp-jcs-v2``, phase 2): the unit of a transport, by the phases
    T1–T5 of §6.3 for an envelope (the whole input for ``bare``), as offsets in the input."""
    if not isinstance(data, (bytes, bytearray, memoryview)):
        raise TypeError("extract_unit expects the original bytes (bytes, bytearray or memoryview)")
    if transport not in ("bare", "envelope"):
        raise TypeError("transport must be 'bare' or 'envelope'")
    return _extract(bytes(data), transport)


def _read_profile(b: bytes, start: int, end: int) -> Tuple[str, Optional[int]]:
    """The profile a walkable unit selects: the exact path, the last duplicate at each step (§7)."""
    ok, _, root_object, members = _walk(b, start, end, 3)
    if not ok:
        raise ExperimentalCandidateInternalError("the grammar walker refused a unit the ingress walked")
    if not root_object:
        return "absent", None
    bundle = _last_member(b, members, 0, "bundle")
    if bundle is None or bundle[5] < 0:
        return "absent", None
    manifest = _last_member(b, members, bundle[5], "manifest")
    if manifest is None or manifest[5] < 0:
        return "absent", None
    field = _last_member(b, members, manifest[5], "canonicalization_profile")
    if field is None:
        return "absent", None
    for known in _PROFILES:
        if b[field[3]] == 0x22 and _string_equals(b, field[3], field[4], known):
            return known, field[3] - start
    return "unknown", field[3] - start


def _read_decoded_profile(value: Any) -> str:
    """The profile a decoded value carries at the exact path."""
    node = value
    for key in ("bundle", "manifest", "canonicalization_profile"):
        if type(node) is not dict or key not in node:
            return "absent"
        node = node[key]
    return node if type(node) is str and node in _PROFILES else "unknown"


def _decoder_types(value: Any) -> bool:
    """Whether a returned value has only what a JSON decoder produces: None, bool, int, float (NaN and
    infinities included), str (lone surrogates included), plain lists and dicts with str keys, and no
    shared or cyclic references. Subclasses and other objects are not decoder output."""
    seen: set = set()
    stack = [value]
    while stack:
        v = stack.pop()
        if v is None or type(v) in (bool, int, float, str):
            continue
        if type(v) not in (dict, list) or id(v) in seen:
            return False
        seen.add(id(v))
        if type(v) is dict:
            for k, child in v.items():
                if type(k) is not str:
                    return False
                stack.append(child)
        else:
            stack.extend(v)
    return True


def _describe(e: BaseException) -> str:
    try:
        return f"{type(e).__name__}: {e}"
    except Exception:  # noqa: BLE001
        return type(e).__name__


class ExperimentalCandidateRouter:
    """A router over a private snapshot of its configuration (create_router). The snapshot lives in the
    closures of ``create_router``; nothing here reads the caller's configuration again."""

    __slots__ = ("_route", "_configuration")

    def route(self, data: Union[bytes, bytearray, memoryview]) -> RouteResult:
        """EXPERIMENTAL, opt-in (candidate ``dcp-jcs-v2``, phase 2): reject, delegate to ``dcp-jcs-v1``,
        or select the candidate path (§6.4), from the original bytes, on a private copy."""
        return self._route(data)

    @property
    def configuration(self) -> dict:
        """A fresh copy of the effective configuration; changing it changes nothing."""
        return self._configuration()


def _snapshot_policy(policy: Any) -> Tuple[bool, bool]:
    if policy is None:
        raise ExperimentalCandidateConfigError("POLICY_INVALID", "MISSING")
    if type(policy) not in (list, tuple) or len(policy) == 0:
        raise ExperimentalCandidateConfigError("POLICY_INVALID", "NOT_A_NON_EMPTY_LIST")
    entries = list(policy)
    if not all(type(p) is str for p in entries):
        raise ExperimentalCandidateConfigError("POLICY_INVALID", "NOT_STRINGS")
    if len(set(entries)) != len(entries):
        raise ExperimentalCandidateConfigError("POLICY_INVALID", "REPEATED")
    if not all(p in _PROFILES for p in entries):
        raise ExperimentalCandidateConfigError("POLICY_INVALID", "UNKNOWN_PROFILE")
    return "dcp-jcs-v1" in entries, "dcp-jcs-v2" in entries


def create_router(*, transport: Any = None, accepted_profiles: Any = None, historical: Any = None) -> ExperimentalCandidateRouter:
    """EXPERIMENTAL, opt-in (candidate ``dcp-jcs-v2``, phase 2): a router over a snapshot of the
    configuration, validated here, before any input: the transport, the accepted profiles (no default)
    and the historical adapter (no default; its name and its decode function are captured now)."""
    accepts_v1, accepts_v2 = _snapshot_policy(accepted_profiles)
    if type(transport) is not str or transport not in ("bare", "envelope"):
        raise ExperimentalCandidateConfigError("CONFIG_INVALID", "TRANSPORT")
    try:
        adapter_name, decode = historical.name, historical.decode
    except Exception:  # noqa: BLE001 — a missing or failing attribute is a configuration error
        raise ExperimentalCandidateConfigError("CONFIG_INVALID", "HISTORICAL_ADAPTER") from None
    if type(adapter_name) is not str or not adapter_name or not callable(decode):
        raise ExperimentalCandidateConfigError("CONFIG_INVALID", "HISTORICAL_ADAPTER")
    transport = str(transport)
    adapter_name = str(adapter_name)

    def consult(unit: bytes) -> HistoricalOutcome:
        """The adapter, once, on its own copy of the unit. Anything raised while calling it, inspecting
        what it returned or reading the profile from it is an adapter error, never a rejection."""
        try:
            value = decode(bytes(unit))
        except HistoricalDecodeFailure as e:
            try:
                return HistoricalOutcome(adapter_name, False, failed=str(e))
            except Exception as inner:  # noqa: BLE001
                raise ExperimentalCandidateAdapterError(adapter_name, f"describing its refusal raised {_describe(inner)}") from inner
        except Exception as e:  # noqa: BLE001
            raise ExperimentalCandidateAdapterError(adapter_name, f"decode raised {_describe(e)}") from e
        try:
            if not _decoder_types(value):
                raise ExperimentalCandidateAdapterError(adapter_name, "decode returned a value no JSON decoder produces")
        except ExperimentalCandidateAdapterError:
            raise
        except Exception as e:  # noqa: BLE001
            raise ExperimentalCandidateAdapterError(adapter_name, f"inspecting the result raised {_describe(e)}") from e
        return HistoricalOutcome(adapter_name, True, decoded=value)

    def route(data: Any) -> RouteResult:
        if not isinstance(data, (bytes, bytearray, memoryview)):
            raise TypeError("route expects the original bytes (bytes, bytearray or memoryview)")
        b = bytes(data)  # a private, immutable copy
        x = _extract(b, transport)
        if isinstance(x, TransportReject):
            return RouteReject(x.reject_class, x.detail, None, x.transport_offset, None, None)
        start, end = x.start, x.end
        unit = b[start:end]
        rng = UnitRange(start, end)
        scan = experimental_candidate_ingress(unit)
        diagnosis = None if isinstance(scan, CandidateIngressAccept) else RouteWarning(scan.reject_class, scan.offset, start + scan.offset)

        def reject(cls: str, offset: Optional[int], profile: Optional[str]) -> RouteReject:
            return RouteReject(cls, None, offset, None if offset is None else start + offset, rng, profile)

        def delegate(source: str, historical_outcome: HistoricalOutcome) -> RouteV1Path:
            return RouteV1Path(rng, unit, source, () if diagnosis is None else (diagnosis,), historical_outcome)

        if diagnosis is None or diagnosis.reject_class not in _ENCODING_OR_GRAMMAR:
            profile, offset = _read_profile(b, start, end)
            if profile == "unknown":
                return reject("PROFILE_UNKNOWN", offset, None)
            if profile in ("absent", "dcp-jcs-v1"):
                if not accepts_v1:
                    return reject("PROFILE_NOT_ACCEPTED", offset, "dcp-jcs-v1")
                return delegate("absent" if profile == "absent" else "field", consult(unit))
            if not accepts_v2:
                return reject("PROFILE_NOT_ACCEPTED", offset, "dcp-jcs-v2")
            if diagnosis is not None:
                return reject(diagnosis.reject_class, diagnosis.offset, "dcp-jcs-v2")
            if not isinstance(scan, CandidateIngressAccept):
                raise ExperimentalCandidateInternalError("no diagnosis without an accepted unit")
            return RouteCandidate(rng, unit, scan.value, scan.canonical, scan.canonical_sha256)
        # Not walkable: the historical adapter decides, once; its reading never selects the candidate.
        outcome = consult(unit)
        if not outcome.ok:
            return reject(diagnosis.reject_class, diagnosis.offset, None)
        try:
            profile = _read_decoded_profile(outcome.decoded)
        except Exception as e:  # noqa: BLE001
            raise ExperimentalCandidateAdapterError(adapter_name, f"reading the profile raised {_describe(e)}") from e
        if profile not in ("absent", "dcp-jcs-v1"):
            return reject(diagnosis.reject_class, diagnosis.offset, None)
        if not accepts_v1:
            return reject("PROFILE_NOT_ACCEPTED", None, "dcp-jcs-v1")
        return delegate("historical", outcome)

    def configuration() -> dict:
        return {
            "transport": transport,
            "accepted_profiles": [p for p, on in zip(_PROFILES, (accepts_v1, accepts_v2)) if on],
            "historical": adapter_name,
        }

    router = ExperimentalCandidateRouter()
    object.__setattr__(router, "_route", route)
    object.__setattr__(router, "_configuration", configuration)
    return router


def _walk_grammar_for_tests(data: bytes) -> Tuple[bool, Optional[int]]:
    """Internal, not part of the API: the grammar verdict of the walker over a whole input, for the
    differential tests against the phase 1 scanner."""
    ok, where, _, _ = _walk(bytes(data), 0, len(data), 0)
    return (True, None) if ok else (False, where)
