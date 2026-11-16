"""Schema oracle 2: python-jsonschema, Draft 2020-12, over every file of schemas/v2 registered by $id (referencing).

It shares no code with the IR, its generator, its evaluator or oracle 1 (Ajv), except two TEST-ONLY adapters, disclosed:

- format "date-time": a Python port of the ajv-formats 3.0.1 rule (the boundary decision D2 adopts). jsonschema has no
  date-time checker without rfc3339-validator, and the rule wanted is ajv-formats' anyway, so for date-time this oracle
  is NOT independent of oracle 1's upstream rule; its agreement there only checks the two ports against each other.
- keyword "pattern": the anchored sources end in "$", which Python's re.search also matches before a final newline and
  ECMAScript does not; the adapter replaces that final "$" by "\\Z". The adapted validator class is registered for the
  2020-12 dialect in this process, so the referenced files (which declare "$schema") are validated by it too.

Usage (stdout is one JSON document):
    python3 tools/schema-ir/oracle_jsonschema.py <schemas/v2 dir> <cases.json>
cases.json: {"cases": [{"id": "...", "text": "<JSON text>"}]}; each text is parsed with json.loads.
"""

from __future__ import annotations

import importlib.metadata
import json
import re
import sys
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker, ValidationError, validators
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

PAYLOADS = [
    ("responsible_principal_record", "responsible_principal_record.schema.json"),
    ("agent_passport", "agent_passport.schema.json"),
    ("intent", "intent.schema.json"),
    ("policy_decision", "policy_decision.schema.json"),
]
BASE = "https://dcp-ai.org/schemas/v2/"

# ajv-formats 3.0.1 fullFormats["date-time"], ported (MIT License, Copyright (c) 2020 Evgeny Poberezkin; see
# tools/schema-ir/date-time.mjs for the full notice). ECMAScript \s and "t"/"T" separate the date from the time.
SEPARATORS = {0x74, 0x54, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, *range(0x2000, 0x200B), 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF}
DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]


def _digits(s: str, i: int, n: int) -> bool:
    return len(s) >= i + n and all("0" <= s[i + k] <= "9" for k in range(n))


def _is_date(s: str) -> bool:
    if len(s) != 10 or not _digits(s, 0, 4) or s[4] != "-" or not _digits(s, 5, 2) or s[7] != "-" or not _digits(s, 8, 2):
        return False
    year, month, day = int(s[0:4]), int(s[5:7]), int(s[8:10])
    leap = year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)
    return 1 <= month <= 12 and 1 <= day <= (29 if month == 2 and leap else DAYS[month])


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
    sec = float(s[6:i])
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


def is_date_time(s: str) -> bool:
    at = [i for i, ch in enumerate(s) if ord(ch) in SEPARATORS]
    return len(at) == 1 and _is_date(s[: at[0]]) and _is_time(s[at[0] + 1 :])


def _ecma_pattern(validator, patrn, instance, schema):
    if not validator.is_type(instance, "string"):
        return
    p = patrn[:-1] + r"\Z" if patrn.endswith("$") else patrn
    if re.search(p, instance) is None:
        yield ValidationError(f"does not match {patrn!r}")


Validator = validators.extend(Draft202012Validator, {"pattern": _ecma_pattern})
# A $ref into a file that declares "$schema" makes jsonschema pick the class registered for that dialect, which would
# drop the adapter inside every referenced schema; in this oracle process only, the adapted class is that class.
validators.validates("https://json-schema.org/draft/2020-12/schema")(Validator)


def _escape(token) -> str:
    return str(token).replace("~", "~0").replace("/", "~1")


def main(schema_dir: str, cases_file: str) -> None:
    schemas = [json.loads(p.read_text("utf-8")) for p in sorted(Path(schema_dir).glob("*.schema.json"))]
    registry = Registry().with_resources((s["$id"], Resource.from_contents(s, default_specification=DRAFT202012)) for s in schemas)
    checker = FormatChecker(formats=())
    checker.checks("date-time")(lambda s: not isinstance(s, str) or is_date_time(s))
    validators_by_file = {}

    def validator(file: str):
        if file not in validators_by_file:
            validators_by_file[file] = Validator(registry.contents(BASE + file), registry=registry, format_checker=checker)
        return validators_by_file[file]

    def run(file: str, value, base: str, out: set) -> None:
        for e in validator(file).iter_errors(value):
            pointer = base + "".join("/" + _escape(p) for p in e.absolute_path)
            if e.validator == "additionalProperties":
                names = e.schema.get("properties", {})
                for k in e.instance:
                    if k not in names:
                        out.add((pointer, "additionalProperties", k))
            elif e.validator == "required":
                for r in e.validator_value:
                    if r not in e.instance:
                        out.add((pointer, "required", r))
            else:
                out.add((pointer, e.validator, None))

    results = []
    for case in json.loads(Path(cases_file).read_text("utf-8"))["cases"]:
        doc = json.loads(case["text"])
        out: set = set()
        run("signed_bundle.schema.json", doc, "", out)
        bundle = doc.get("bundle") if isinstance(doc, dict) else None
        for member, file in PAYLOADS:
            env = bundle.get(member) if isinstance(bundle, dict) else None
            if isinstance(env, dict) and isinstance(env.get("payload"), dict):
                run(file, env["payload"], f"/bundle/{member}/payload", out)
        errors = [{"instance": p, "keyword": k, **({"member": m} if m is not None else {})} for p, k, m in sorted(out, key=lambda t: (t[0], t[1], t[2] or ""))]
        results.append({"id": case["id"], "valid": not errors, "errors": errors})
    versions = {d: importlib.metadata.version(d) for d in ("jsonschema", "referencing")}
    json.dump({"oracle": "python-jsonschema", "python": sys.version.split()[0], "versions": versions, "results": results}, sys.stdout)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
