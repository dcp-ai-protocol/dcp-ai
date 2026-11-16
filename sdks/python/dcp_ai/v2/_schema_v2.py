"""spec/VERIFICATION.md V2-2: the signed bundle against signed_bundle.schema.json and each SignedPayload.payload
against its artifact schema (bound by bundle member name), from the IR that tools/schema-ir/generate.mjs compiles
out of schemas/v2 (_schema_v2_generated.py; no schema file or network access at verification time). Internal: the
package exposes no schema-only API; _verify_signed_bundle_v2_with_profile runs this before any other check.

The JSON data model is primary, and the native boundary is explicit (no value is coerced or rebuilt):
- an object is a dict whose keys are all str; a dict with another key is not a JSON object (a type error where a
  schema visits it); absent and None differ (None is null);
- an array is a list; a tuple is not (the canonicalizer would write one as an array, but signed JSON never holds one);
- integer is an int that is not a bool, or a finite float with no fraction (2 and 2.0 alike); bool is never a number;
  Decimal and other number types are not JSON numbers;
- members of an open object that no schema names are not visited: under a commitment (intent target, audit evidence)
  such a value reaches the canonicalizer, the later layer, while an unknown member of the unsigned bundle (bundle.x)
  may be read by no later check at all;
- lengths in code points (len of a str; a lone surrogate counts 1); enum and const by exact str equality; uniqueItems
  over str values with a set; patterns through the IR's deterministic programs (full-string match, as these anchored
  sources say); date-time as ajv-formats 3.0.1 asserts it (below), not datetime and not Python's \\s;
- oneOf: exactly one branch valid, reported once at the instance;
- at most 16 errors and then a truncation marker; the verdict never depends on the cap; diagnostics name the instance
  pointer (RFC 6901, each token escaped and then cut to 64 code points) and the keyword, never a value.
Nothing is written to the input.
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass, field
from typing import Any, Callable

from dcp_ai.v2._schema_v2_generated import SCHEMA_V2_IR, SCHEMA_V2_IR_SHA256

SCHEMA_ERRORS_CAP = 16
_TOKEN_CAP = 64


@dataclass
class SchemaResult:
    valid: bool
    errors: list[dict[str, str]] = field(default_factory=list)
    truncated: bool = False


_loaded: tuple[dict[str, Any], dict[int, dict[str, int]]] | None = None


def _load() -> tuple[dict[str, Any], dict[int, dict[str, int]]]:
    global _loaded
    if _loaded is None:
        if hashlib.sha256(SCHEMA_V2_IR.encode("utf-8")).hexdigest() != SCHEMA_V2_IR_SHA256:
            raise RuntimeError("the V2 schema IR does not match its sha256")
        ir = json.loads(SCHEMA_V2_IR)
        if ir.get("format") != "dcp-ai.v2-schema-ir/1":
            raise RuntimeError(f"unsupported V2 schema IR {ir.get('format')!r}")
        props = {i: dict(n["properties"]) for i, n in enumerate(ir["nodes"]) if "properties" in n}
        _loaded = (ir, props)
    return _loaded


def bounded_token(token: str) -> str:
    """An RFC 6901 token, escaped first and then cut to 64 code points with a marker."""
    t = token.replace("~", "~0").replace("/", "~1")
    return f"{t[:_TOKEN_CAP]}…[cut]" if len(t) > _TOKEN_CAP else t


def _is_object(v: Any) -> bool:
    return isinstance(v, dict) and all(isinstance(k, str) for k in v)


def _is_number(v: Any) -> bool:
    return (isinstance(v, int) and not isinstance(v, bool)) or (isinstance(v, float) and math.isfinite(v))


def _type_ok(t: str, v: Any) -> bool:
    if t == "null":
        return v is None
    if t == "boolean":
        return isinstance(v, bool)
    if t == "string":
        return isinstance(v, str)
    if t == "integer":
        if isinstance(v, bool):
            return False
        return isinstance(v, int) or (isinstance(v, float) and math.isfinite(v) and v.is_integer())
    if t == "array":
        return isinstance(v, list)
    if t == "object":
        return _is_object(v)
    return False


def match_program(program: dict[str, Any], s: str) -> bool:
    """Full-string match of a compiled program over the code points of s."""
    cps = [ord(ch) for ch in s]
    for items in program["alternatives"]:
        i = 0
        ok = True
        for it in items:
            n = 0
            while (it["max"] is None or n < it["max"]) and i < len(cps) and any(lo <= cps[i] <= hi for lo, hi in it["ranges"]):
                i += 1
                n += 1
            if n < it["min"]:
                ok = False
                break
        if ok and i == len(cps):
            return True
    return False


# date-time: ajv-formats 3.0.1 fullFormats["date-time"] (getDateTime(true)), the format lib/verify.js asserts. A
# compatibility boundary, quirks included, not a reading of RFC 3339; the V2-4, V2-13 and V2-14 temporal parsers are a
# later, different layer. Ported from ajv-formats (https://github.com/ajv-validator/ajv-formats), under its license:
#
# MIT License
#
# Copyright (c) 2020 Evgeny Poberezkin
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

# DATE_TIME_SEPARATOR = /t|\s/i: "t", "T" and ECMAScript white space and line terminators (not Python's \s).
_SEPARATORS = frozenset(
    {0x74, 0x54, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, *range(0x2000, 0x200B), 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF}
)
_DAYS = (0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)


def _digits(s: str, i: int, n: int) -> bool:
    return len(s) >= i + n and all("0" <= s[i + k] <= "9" for k in range(n))


def _is_date(s: str) -> bool:
    if len(s) != 10 or not _digits(s, 0, 4) or s[4] != "-" or not _digits(s, 5, 2) or s[7] != "-" or not _digits(s, 8, 2):
        return False
    year, month, day = int(s[0:4]), int(s[5:7]), int(s[8:10])
    leap = year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)
    return 1 <= month <= 12 and 1 <= day <= (29 if month == 2 and leap else _DAYS[month])


def _is_time(s: str) -> bool:
    if not _digits(s, 0, 2) or s[2:3] != ":" or not _digits(s, 3, 2) or s[5:6] != ":" or not _digits(s, 6, 2):
        return False
    i = 8
    if s[i : i + 1] == ".":
        j = i + 1
        while _digits(s, j, 1):
            j += 1
        if j == i + 1:
            return False
        i = j
    sec = float(s[6:i])  # binary64, as JavaScript's Number("59.99999999999999999") is 60
    tz, sign, tz_h, tz_m = False, 1, 0, 0
    if s[i : i + 1] in ("z", "Z"):
        tz, i = True, i + 1
    elif s[i : i + 1] in ("+", "-"):
        if not _digits(s, i + 1, 2):
            return False
        tz, sign, tz_h = True, (-1 if s[i] == "-" else 1), int(s[i + 1 : i + 3])
        i += 3
        if s[i : i + 1] == ":" and _digits(s, i + 1, 2):
            tz_m, i = int(s[i + 1 : i + 3]), i + 3
        elif _digits(s, i, 2):
            tz_m, i = int(s[i : i + 2]), i + 2
    if i != len(s):
        return False
    hr, mn = int(s[0:2]), int(s[3:5])
    if tz_h > 23 or tz_m > 59 or not tz:
        return False
    if hr <= 23 and mn <= 59 and sec < 60:
        return True
    utc_min = mn - tz_m * sign
    utc_hr = hr - tz_h * sign - (1 if utc_min < 0 else 0)
    return utc_hr in (23, -1) and utc_min in (59, -1) and sec < 61


def is_schema_date_time(s: str) -> bool:
    """True when the string is a date-time as ajv-formats 3.0.1 (full mode) accepts it."""
    at = -1
    for i, ch in enumerate(s):
        if ord(ch) in _SEPARATORS:
            if at >= 0:
                return False
            at = i
    return at >= 0 and _is_date(s[:at]) and _is_time(s[at + 1 :])


class _Stop(Exception):
    pass


Sink = Callable[[str, str, dict[str, Any], "str | None"], None]


def validate_signed_bundle_v2_schema(doc: Any, accepted_profile: str) -> SchemaResult:
    """V2-2 for `doc` under the accepted canonicalization profile: "dcp-jcs-v1" is the normative schema; "dcp-jcs-v2"
    (only the explicitly selected experimental route) replaces exactly one const, canonicalization_profile."""
    ir, props = _load()
    nodes = ir["nodes"]
    replaced: dict[tuple[int, str], str] = {}
    if accepted_profile == "dcp-jcs-v2":
        overlay = ir["overlays"].get("dcp-jcs-v2")
        if not overlay or len(overlay) != 1:
            raise RuntimeError("the V2 schema IR has no dcp-jcs-v2 overlay")
        for e in overlay:
            replaced[(e["node"], e["keyword"])] = e["value"]
    elif accepted_profile != "dcp-jcs-v1":
        raise ValueError(f"unknown canonicalization profile {accepted_profile!r}")

    def eval_node(nid: int, v: Any, ptr: str, sink: Sink) -> None:
        n = nodes[nid]
        if "ref" in n:
            eval_node(n["ref"], v, ptr, sink)
        if "types" in n and not any(_type_ok(t, v) for t in n["types"]):
            sink(ptr, "type", n, None)
        if "enum" in n and not (isinstance(v, str) and v in n["enum"]):
            sink(ptr, "enum", n, None)
        if "const" in n and not (isinstance(v, str) and v == replaced.get((nid, "const"), n["const"])):
            sink(ptr, "const", n, None)
        if isinstance(v, str):
            if "minLength" in n and len(v) < n["minLength"]:
                sink(ptr, "minLength", n, None)
            if "maxLength" in n and len(v) > n["maxLength"]:
                sink(ptr, "maxLength", n, None)
            if "pattern" in n and not match_program(ir["patterns"][n["pattern"]], v):
                sink(ptr, "pattern", n, None)
            if n.get("format") == "date-time" and not is_schema_date_time(v):
                sink(ptr, "format", n, None)
        if isinstance(v, list):
            if "minItems" in n and len(v) < n["minItems"]:
                sink(ptr, "minItems", n, None)
            if n.get("uniqueItems") and all(isinstance(x, str) for x in v) and len(set(v)) != len(v):
                sink(ptr, "uniqueItems", n, None)
            if "items" in n:
                for i, x in enumerate(v):
                    eval_node(n["items"], x, f"{ptr}/{i}", sink)
        if _is_object(v):
            for r in n.get("required", ()):
                if r not in v:
                    sink(ptr, "required", n, r)
            named = props.get(nid)
            if n.get("closed"):
                for k in v:
                    if named is None or k not in named:
                        sink(ptr, "additionalProperties", n, k)
            if named:
                for k, child in named.items():
                    if k in v:
                        eval_node(child, v[k], f"{ptr}/{bounded_token(k)}", sink)
        if _is_number(v):
            if "minimum" in n and v < n["minimum"]:
                sink(ptr, "minimum", n, None)
            if "maximum" in n and v > n["maximum"]:
                sink(ptr, "maximum", n, None)
        if "oneOf" in n:
            valid = 0
            for b in n["oneOf"]:
                failed = [False]

                def mark(_p: str, _k: str, _n: dict[str, Any], _m: "str | None", failed: list[bool] = failed) -> None:
                    failed[0] = True

                eval_node(b, v, ptr, mark)
                if not failed[0]:
                    valid += 1
            if valid != 1:
                sink(ptr, "oneOf", n, None)

    result = SchemaResult(valid=True)

    def top(ptr: str, keyword: str, node: dict[str, Any], member: "str | None") -> None:
        result.valid = False
        if len(result.errors) >= SCHEMA_ERRORS_CAP:
            result.truncated = True
            raise _Stop
        e = {"instance": ptr, "keyword": keyword, "site": f"{node['site']}/{keyword}"}
        if member is not None:
            e["member"] = bounded_token(member)
        result.errors.append(e)

    try:
        eval_node(ir["roots"]["signed_bundle"], doc, "", top)
        bundle = doc.get("bundle") if _is_object(doc) else None
        if _is_object(bundle):
            for member, root in ir["roots"]["payloads"]:
                env = bundle.get(member)
                if _is_object(env) and _is_object(env.get("payload")):
                    eval_node(root, env["payload"], f"/bundle/{member}/payload", top)
    except _Stop:
        pass
    return result


def schema_diagnostics(result: SchemaResult) -> list[str]:
    """The verifier's errors for a schema failure: one line per error, then the truncation marker. No input value."""
    lines = [f"schema: {e['instance'] or '/'} {e['keyword']}" + (f" {e['member']}" if "member" in e else "") for e in result.errors]
    if result.truncated:
        lines.append("schema: further errors not listed")
    return lines
