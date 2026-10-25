"""EXPERIMENTAL and opt-in: the ingress of one unit under the inactive candidate profile
``dcp-jcs-v2`` (docs/proposals/canonicalization-candidate, §3–§6).

It is not normative and nothing calls it: ``dcp-jcs-v1`` (``canonicalize_v2``) is unchanged and
remains the only profile. Importing this module is the opt-in; ``dcp_ai.v2`` does not re-export it.

Phase 1 only. From the original bytes of one unit it decides acceptance (UTF-8, BOM, the whole
RFC 8259 grammar, scalar strings, unique keys, exact integers by N4, at most 64 levels) with the
precedence and byte offsets of §6, and on acceptance materializes the exact value and produces its
canonical bytes and SHA-256. It reads no transport envelope, selects no profile, and verifies, signs
or admits nothing.

A rejection of the data is a result (``CandidateIngressReject``). A wrong argument type is a
``TypeError`` and a broken invariant an ``ExperimentalCandidateInternalError``: neither is ever
reported as a rejection.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any, Literal, Optional, Union

__all__ = [
    "REJECT_CLASSES",
    "CandidateIngressAccept",
    "CandidateIngressReject",
    "ExperimentalCandidateInternalError",
    "experimental_candidate_ingress",
]

REJECT_CLASSES = (
    "BOM",
    "UTF8_INVALID",
    "SYNTAX",
    "SURROGATE_UNPAIRED",
    "DUPLICATE_KEY",
    "NUMBER_NOT_INTEGER",
    "NUMBER_OUT_OF_RANGE",
    "DEPTH_EXCEEDED",
)

_MAX_DEPTH = 64
_MAX_INTEGER = "9007199254740991"  # 2^53-1, 16 digits
_WS = b" \t\n\r"
_DIGITS = b"0123456789"
_HEX = {c: int(chr(c), 16) for c in b"0123456789abcdefABCDEF"}
_SIMPLE_ESCAPES = {ord('"'): '"', ord("\\"): "\\", ord("/"): "/", ord("b"): "\b", ord("f"): "\f",
                   ord("n"): "\n", ord("r"): "\r", ord("t"): "\t"}
_OUTPUT_ESCAPES = {'"': '\\"', "\\": "\\\\", "\b": "\\b", "\t": "\\t", "\n": "\\n", "\f": "\\f", "\r": "\\r"}


class ExperimentalCandidateInternalError(Exception):
    """An invariant of the experimental ingress broke; never a rejection of the data."""


@dataclass(frozen=True)
class CandidateIngressAccept:
    value: Any
    canonical: bytes
    canonical_sha256: str
    status: Literal["accept"] = "accept"


@dataclass(frozen=True)
class CandidateIngressReject:
    reject_class: str
    offset: int
    status: Literal["reject"] = "reject"


CandidateIngressResult = Union[CandidateIngressAccept, CandidateIngressReject]


class _GrammarStop(Exception):
    def __init__(self, offset: int) -> None:
        super().__init__(offset)
        self.offset = offset


class _Frame:
    __slots__ = ("is_object", "container", "keys", "key")

    def __init__(self, is_object: bool, container: Any, keys: Optional[set]) -> None:
        self.is_object = is_object
        self.container = container
        self.keys = keys  # only within 64 levels: deeper defects cannot be the earliest
        self.key = ""


class _Scanner:
    def __init__(self, data: bytes) -> None:
        self.b = data
        self.n = len(data)
        self.pos = 0
        self.best: Optional[tuple] = None  # (offset, class) of the earliest value-level defect

    def defect(self, cls: str, offset: int) -> None:
        if self.best is None or offset < self.best[0]:
            self.best = (offset, cls)

    def stop(self, offset: int) -> "_GrammarStop":
        return _GrammarStop(offset)

    def skip_ws(self) -> None:
        b, n, pos = self.b, self.n, self.pos
        while pos < n and b[pos] in _WS:
            pos += 1
        self.pos = pos

    def run(self) -> CandidateIngressResult:
        if self.b.startswith(b"\xef\xbb\xbf"):
            return CandidateIngressReject("BOM", 0)
        try:
            self.b.decode("utf-8")  # strict: overlong forms, encoded surrogates and > U+10FFFF fail
        except UnicodeDecodeError as e:
            return CandidateIngressReject("UTF8_INVALID", e.start)
        try:
            value = self.document()
        except _GrammarStop as e:
            return CandidateIngressReject("SYNTAX", e.offset)
        if self.best is not None:
            return CandidateIngressReject(self.best[1], self.best[0])
        canonical = _serialize(value).encode("utf-8")
        return CandidateIngressAccept(value, canonical, hashlib.sha256(canonical).hexdigest())

    def document(self) -> Any:
        """One JSON text, iteratively: the grammar is checked to the end at any depth."""
        b, n = self.b, self.n
        stack: list = []
        state = "value"
        current: Any = None
        self.skip_ws()
        while True:
            if state == "value":
                if self.pos >= n:
                    raise self.stop(n)
                c = b[self.pos]
                if c == 0x7B or c == 0x5B:
                    is_object = c == 0x7B
                    depth = len(stack) + 1
                    if depth > _MAX_DEPTH:
                        self.defect("DEPTH_EXCEEDED", self.pos)
                    container = None if self.best is not None else ({} if is_object else [])
                    stack.append(_Frame(is_object, container, set() if is_object and depth <= _MAX_DEPTH else None))
                    self.pos += 1
                    self.skip_ws()
                    if self.pos < n and b[self.pos] == (0x7D if is_object else 0x5D):
                        self.pos += 1
                        current = stack.pop().container
                        state = "after"
                    else:
                        state = "key" if is_object else "value"
                elif c == 0x22:
                    current = self.string()
                    state = "after"
                elif c == 0x2D or c in _DIGITS:
                    current = self.number()
                    state = "after"
                elif c == 0x74:
                    self.literal(b"true")
                    current, state = True, "after"
                elif c == 0x66:
                    self.literal(b"false")
                    current, state = False, "after"
                elif c == 0x6E:
                    self.literal(b"null")
                    current, state = None, "after"
                else:
                    raise self.stop(self.pos)
            elif state == "key":
                if self.pos >= n:
                    raise self.stop(n)
                if b[self.pos] != 0x22:
                    raise self.stop(self.pos)
                start = self.pos
                key = self.string()
                frame = stack[-1]
                if frame.keys is not None:
                    if key in frame.keys:
                        self.defect("DUPLICATE_KEY", start)
                    else:
                        frame.keys.add(key)
                frame.key = key
                self.skip_ws()
                if self.pos >= n:
                    raise self.stop(n)
                if b[self.pos] != 0x3A:
                    raise self.stop(self.pos)
                self.pos += 1
                self.skip_ws()
                state = "value"
            else:
                if not stack:
                    self.skip_ws()
                    if self.pos != n:
                        raise self.stop(self.pos)
                    return current
                frame = stack[-1]
                if self.best is None and frame.container is not None:
                    if frame.is_object:
                        frame.container[frame.key] = current
                    else:
                        frame.container.append(current)
                self.skip_ws()
                if self.pos >= n:
                    raise self.stop(n)
                c = b[self.pos]
                if c == 0x2C:
                    self.pos += 1
                    self.skip_ws()
                    state = "key" if frame.is_object else "value"
                elif c == (0x7D if frame.is_object else 0x5D):
                    self.pos += 1
                    current = stack.pop().container
                else:
                    raise self.stop(self.pos)

    def literal(self, word: bytes) -> None:
        for k, expected in enumerate(word):
            if self.pos + k >= self.n:
                raise self.stop(self.n)
            if self.b[self.pos + k] != expected:
                raise self.stop(self.pos + k)
        self.pos += len(word)

    def hex4(self, at: int) -> int:
        value = 0
        for k in range(4):
            if at + k >= self.n:
                raise self.stop(self.n)
            h = _HEX.get(self.b[at + k])
            if h is None:
                raise self.stop(at + k)
            value = value * 16 + h
        return value

    def low_surrogate_at(self, at: int) -> int:
        """A ``\\uDC00``–``\\uDFFF`` escape at ``at``, read without consuming it, or -1."""
        b = self.b
        if at + 6 > self.n or b[at] != 0x5C or b[at + 1] != 0x75:
            return -1
        value = 0
        for k in range(2, 6):
            h = _HEX.get(b[at + k])
            if h is None:
                return -1
            value = value * 16 + h
        return value if 0xDC00 <= value <= 0xDFFF else -1

    def string(self) -> str:
        """A string at its opening quote, unescaped; a lone surrogate stays one code point."""
        b, n = self.b, self.n
        self.pos += 1
        parts = []
        segment = self.pos
        while True:
            if self.pos >= n:
                raise self.stop(n)
            c = b[self.pos]
            if c == 0x22:
                parts.append(b[segment:self.pos].decode("utf-8"))
                self.pos += 1
                return "".join(parts)
            if c < 0x20:
                raise self.stop(self.pos)
            if c != 0x5C:
                self.pos += 1
                continue
            parts.append(b[segment:self.pos].decode("utf-8"))
            escape = self.pos
            if escape + 1 >= n:
                raise self.stop(n)
            e = b[escape + 1]
            if e in _SIMPLE_ESCAPES:
                parts.append(_SIMPLE_ESCAPES[e])
                self.pos = escape + 2
            elif e == 0x75:
                unit = self.hex4(escape + 2)
                self.pos = escape + 6
                if 0xD800 <= unit <= 0xDBFF:
                    low = self.low_surrogate_at(self.pos)
                    if low >= 0:
                        parts.append(chr(0x10000 + ((unit - 0xD800) << 10) + (low - 0xDC00)))
                        self.pos += 6
                    else:
                        self.defect("SURROGATE_UNPAIRED", escape)
                        parts.append(chr(unit))
                else:
                    if 0xDC00 <= unit <= 0xDFFF:
                        self.defect("SURROGATE_UNPAIRED", escape)
                    parts.append(chr(unit))
            else:
                raise self.stop(escape + 1)
            segment = self.pos

    def digits_from(self, at: int) -> int:
        b, n = self.b, self.n
        while at < n and b[at] in _DIGITS:
            at += 1
        return at

    def number(self) -> int:
        """A number literal: its grammar, then its exact value by N4 (§3.3)."""
        b, n = self.b, self.n
        start = self.pos
        negative = b[self.pos] == 0x2D
        if negative:
            self.pos += 1
        if self.pos >= n:
            raise self.stop(n)
        int_start = self.pos
        if b[self.pos] == 0x30:
            self.pos += 1
        elif b[self.pos] in _DIGITS:
            self.pos = self.digits_from(self.pos)
        else:
            raise self.stop(self.pos)
        int_end = frac_start = frac_end = self.pos
        if self.pos < n and b[self.pos] == 0x2E:
            self.pos += 1
            if self.pos >= n:
                raise self.stop(n)
            if b[self.pos] not in _DIGITS:
                raise self.stop(self.pos)
            frac_start = self.pos
            self.pos = frac_end = self.digits_from(self.pos)
        exp_negative = False
        exp_start = exp_end = self.pos
        if self.pos < n and b[self.pos] in b"eE":
            self.pos += 1
            if self.pos >= n:
                raise self.stop(n)
            if b[self.pos] in b"+-":
                exp_negative = b[self.pos] == 0x2D
                self.pos += 1
                if self.pos >= n:
                    raise self.stop(n)
            if b[self.pos] not in _DIGITS:
                raise self.stop(self.pos)
            exp_start = self.pos
            self.pos = exp_end = self.digits_from(self.pos)
        # N4. X saturates at len(literal) + 17: past it the outcome cannot change.
        cap = self.pos - start + 17
        x = 0
        for d in b[exp_start:exp_end]:
            x = min(cap, x * 10 + d - 0x30)
        digits = b[int_start:int_end] + b[frac_start:frac_end]
        significant = digits.lstrip(b"0")
        if not significant:
            return 0  # D is empty: the value is 0, whatever the exponent
        d = significant.rstrip(b"0")
        s = (-x if exp_negative else x) - (frac_end - frac_start) + (len(significant) - len(d))
        if s < 0:
            self.defect("NUMBER_NOT_INTEGER", start)
            return 0
        if len(d) + s > 16:
            self.defect("NUMBER_OUT_OF_RANGE", start)
            return 0
        full = d.decode("ascii") + "0" * s
        if len(full) == 16 and full > _MAX_INTEGER:
            self.defect("NUMBER_OUT_OF_RANGE", start)
            return 0
        value = int(full)
        return -value if negative else value


def _quote(s: str) -> str:
    out = ['"']
    for ch in s:
        short = _OUTPUT_ESCAPES.get(ch)
        if short is not None:
            out.append(short)
        elif ch < "\x20":
            out.append("\\u%04x" % ord(ch))
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def _serialize(value: Any) -> str:
    """The ``dcp-jcs-v1`` output rules (§3.4) over an accepted value, at most 64 levels deep."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, str):
        return _quote(value)
    if isinstance(value, list):
        return "[" + ",".join(_serialize(v) for v in value) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(_quote(k) + ":" + _serialize(value[k]) for k in sorted(value)) + "}"
    raise ExperimentalCandidateInternalError(f"unexpected materialized type {type(value).__name__}")


def experimental_candidate_ingress(data: Union[bytes, bytearray, memoryview]) -> CandidateIngressResult:
    """EXPERIMENTAL, opt-in (candidate ``dcp-jcs-v2``, phase 1): the ingress of one unit from its
    original bytes. Returns the rejection class and byte offset, or the exact value, its canonical bytes
    and their SHA-256. It never verifies, signs or admits anything, and it does not change ``dcp-jcs-v1``.
    """
    if not isinstance(data, (bytes, bytearray, memoryview)):
        raise TypeError("experimental_candidate_ingress expects the original bytes (bytes, bytearray or memoryview)")
    try:
        return _Scanner(bytes(data)).run()
    except ExperimentalCandidateInternalError:
        raise
    except Exception as e:  # noqa: BLE001 — anything else is a broken invariant, never a rejection
        raise ExperimentalCandidateInternalError(f"unexpected failure: {type(e).__name__}: {e}") from e
