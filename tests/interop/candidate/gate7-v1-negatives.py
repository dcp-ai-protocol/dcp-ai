"""Strict checker of tests/interop/candidate/gate7-v1-negatives.json (gate 7, dcp-jcs-v1 side).

Python standard library only. It rebuilds every input from the frozen phase 3 bases and the edits, and checks the
fixture's shape, its exact case IDs and configurations, every hash and the consistency of every expectation. It
never writes expectations: those are reasoned by hand (see each shape's "why"), never taken from an output.

    python3 -I tests/interop/candidate/gate7-v1-negatives.py            # --check (default): exit 1 on any problem
    python3 -I tests/interop/candidate/gate7-v1-negatives.py --hashes   # print the rebuilt input hashes
"""

from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
FIXTURE = HERE / "gate7-v1-negatives.json"
PHASE3 = "tests/interop/candidate/phase3-signed-vectors.json"
SCHEMA = "dcp-ai.candidate.gate7-v1/1"

FAMILIES = {
    "ts": ["ts.textDecoderJsonParse", "ts.bufferUtf8JsonParse"],
    "py": ["py.json_loads_bytes", "py.json_loads_strict_decode"],
    "go": ["go.encoding_json"],
    "rust": ["rust.serde_json_from_slice"],
    "wasm": ["wasm.w1TextDecoderJsonParse", "wasm.w1BufferUtf8JsonParse", "wasm.w2TextDecoder", "wasm.w2BufferUtf8"],
}
CONFIGS = [c for cs in FAMILIES.values() for c in cs]
FAMILY = {c: f for f, cs in FAMILIES.items() for c in cs}
MUTATION_CLASS = {
    "M01": "BOM", "M02": "UTF8_INVALID", "M03": "UTF8_INVALID", "M04": "SYNTAX", "M05": "SYNTAX",
    "M06": "SURROGATE_UNPAIRED", "M07": "SURROGATE_UNPAIRED", "M08": "DUPLICATE_KEY", "M09": "DUPLICATE_KEY",
    "M10": "DUPLICATE_KEY", "M11": "NUMBER_NOT_INTEGER", "M12": "NUMBER_NOT_INTEGER", "M13": "NUMBER_NOT_INTEGER",
    "M14": "NUMBER_OUT_OF_RANGE", "M15": "NUMBER_OUT_OF_RANGE", "M16": "DEPTH_EXCEEDED", "M17": "DEPTH_EXCEEDED",
    "M18": "DEPTH_EXCEEDED",
}
# The approved scope, independent of the fixture: each mutation's position, and the SHA-256 of the canonical JSON
# of {class, position, edits}. Changing what a mutation does (for example swapping an unsigned and a signed edit)
# while keeping its ID and class and rehashing the cases fails here; a deliberate change updates these lines.
MUTATION_POSITION = {
    "M01": "prefix", "M02": "unsigned", "M03": "signed (intent)", "M04": "end", "M05": "end", "M06": "unsigned",
    "M07": "signed (intent)", "M08": "unsigned", "M09": "signed, the same value last", "M10": "signed, a different value last",
    "M11": "unsigned", "M12": "signed (policy decision)", "M13": "audit entry", "M14": "unsigned",
    "M15": "signed (policy decision)", "M16": "unsigned, level 65", "M17": "unsigned, level 200",
    "M18": "signed (policy decision), 64 nested arrays",
}
MUTATION_IDENTITY = {
    "M01": "8ded0ae35215d25b59fa75a680403aace2ab9379b26ddfe7a1dad5f14572ce0b",
    "M02": "caad7609bfaf62f43b0b4133f53bd61d0d1876ff3b8e7abefae2d02afcd4b3e0",
    "M03": "66f7a136f0cb7821b90b14847748acc207068d0563e4509b8628a1c1fdf7a2ce",
    "M04": "339cd282241a4a02ea8103b5c3e2d863967ce960483d9b6fdf42ebd6cb132235",
    "M05": "99c28ff367c6b04515e2533e60baf149d68219dc66f0cf2767dec59c0106d5e3",
    "M06": "3a03778365320b032e37ab4f3383f9fc07bf33f99319b7a26f11e7b0429a955a",
    "M07": "86c916c68b49eb50cc9cf2d8530698df8c7c6bb3eb090db40fb7857104265f7d",
    "M08": "804f95381c4578e36a8c1d923e552ae17d8c5826425bccb4df9ec6500fa72601",
    "M09": "bcecbf1a92089ed54f3b9cf1c277a11b06a18ea678e9d4333998f3b270067a2a",
    "M10": "3ad8c1e8780854071b7262892b2760b4564c628923c10ee15babd554116ed922",
    "M11": "59f933912ae9e561b0d5df2976b1944fe90ef043c76dcb330483a0062586d0be",
    "M12": "a2d05e1233d667937c715211f6e4635d716b2a48535b0915d6bf1f4e68745e9c",
    "M13": "a56334f4529e8eaa1a1ac56713b29361b18ef9704e0438fac1120d922759636d",
    "M14": "cc2cae3ac62c938c02347fbe7f4cd40138df2fbb3373eeb9f5e4969b17debfed",
    "M15": "2ec1bc0357beea6d4b0ae89ebf32636977e8844ab714ae3295258bfae16ec95f",
    "M16": "c3752b36faaf4821dd25e7237b755766a881894e690950c4b188c3f8fa3100dc",
    "M17": "9add28b6feac891a79f934d9b4bddd391f5793ce9802606db7e92fe0eac55322",
    "M18": "7a159a1b7915f8682a5f32a85cdc3ab4d11129eb72543886a835f295bd9638c7",
}
BOUNDARY_IDENTITY = {  # SHA-256 of the canonical JSON of {base, edits}
    "G7E-1": "c58fb781eafa9b3120ec5a359827e87e2321af9858f3807d0fc33db6d7603450",
    "G7E-2": "7f61f0e6615fec3aff3431bc338f7868cf366d9f58a1d05788618e656134c9ab",
    "G7E-3": "e8fd521af83c6be77636a78f1b8feff2bc95cfbe9b296d73c604de7e2dd671bd",
}
NOT_WALKABLE = {"BOM", "UTF8_INVALID", "SYNTAX"}  # encoding and grammar layers (§6.1): the scanner cannot walk the unit
BASES = {"V1": ("B-v1", "field"), "AB": ("B-absent", "absent")}
CASE_IDS = [f"G7-{t}-{s}" for t in BASES for s in ["C00", *MUTATION_CLASS]]
BOUNDARY_IDS = ["G7E-1", "G7E-2", "G7E-3"]
TODAY = {"verified_result", "host_decode_error", "in_band_parse_error"}
TRANSPORT = {"TRANSPORT_INVALID", "TRANSPORT_AMBIGUOUS"}
MODES = {"classical_only", "hybrid_preferred", "hybrid_required", "pq_only"}
TIERS = {"routine", "standard", "elevated", "maximum"}


def today_kinds(cfg: str) -> dict[str, set[str]]:
    """The closed decoder-error identities of today's route, per configuration and layer."""
    family = FAMILY[cfg]
    if family == "ts" or cfg.startswith("wasm.w1"):
        host = {"SyntaxError", "RangeError"}  # JSON.parse
    elif family == "py":
        host = {"JSONDecodeError", "UnicodeDecodeError", "RecursionError"}  # json.loads, bytes.decode
    elif family == "rust":
        host = {"Syntax", "Eof", "Data", "Io"}  # serde_json::error::Category
    else:
        host = set()  # Go and the w2 path hand the bytes or the text to the verifier, which parses them itself
    in_band = {"JSON parse error"} if family in ("go", "wasm") else set()
    return {"host_decode_error": host, "in_band_parse_error": in_band}


def _int(v: Any) -> bool:
    return type(v) is int  # not bool, not float


class Problems(list):
    def need(self, cond: bool, msg: str) -> bool:
        if not cond:
            self.append(msg)
        return cond


def _no_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    keys = [k for k, _ in pairs]
    dup = sorted({k for k in keys if keys.count(k) > 1})
    if dup:
        raise ValueError(f"duplicate JSON key(s): {', '.join(dup)}")
    return dict(pairs)


def _identity(obj: Any) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()


def _keys(obj: Any, required: set[str]) -> bool:
    return isinstance(obj, dict) and set(obj) == required


def _text(v: Any) -> bool:
    return isinstance(v, str) and v.strip() != ""


def apply_edits(base: bytes, edits: Any, where: str, p: Problems) -> bytes | None:
    """The edit grammar, in order. A replace_once anchor must occur exactly once; None on any defect."""
    if not p.need(isinstance(edits, list) and len(edits) > 0, f"{where}: edits must be a non-empty list"):
        return None
    out = base
    for i, e in enumerate(edits):
        at = f"{where} edit {i}"
        if not isinstance(e, dict):
            p.append(f"{at}: not an object")
            return None
        try:
            if set(e) == {"prefix"} and _text(e["prefix"]):
                out = e["prefix"].encode() + out
            elif set(e) == {"prefix_hex"}:
                out = bytes.fromhex(e["prefix_hex"]) + out
            elif set(e) == {"append"} and _text(e["append"]):
                out = out + e["append"].encode()
            elif set(e) == {"append_hex"}:
                out = out + bytes.fromhex(e["append_hex"])
            elif set(e) == {"drop_last"} and _int(e["drop_last"]) and 0 < e["drop_last"] < len(out):
                out = out[: len(out) - e["drop_last"]]
            elif set(e) in ({"replace_once", "with"}, {"replace_once", "with_hex"}) and _text(e["replace_once"]):
                find = e["replace_once"].encode()
                if out.count(find) != 1:
                    p.append(f"{at}: the anchor {e['replace_once'][:40]!r} occurs {out.count(find)} times, not exactly once")
                    return None
                out = out.replace(find, bytes.fromhex(e["with_hex"]) if "with_hex" in e else e["with"].encode())
            else:
                p.append(f"{at}: unknown or malformed edit {sorted(e)}")
                return None
        except (ValueError, TypeError) as exc:
            p.append(f"{at}: {exc}")
            return None
    if not p.need(out != base, f"{where}: the edits leave the base unchanged"):
        return None
    return out


def _check_route(route: Any, at: str, p: Problems) -> str | None:
    if isinstance(route, dict) and route.get("outcome") == "v1_path":
        if p.need(_keys(route, {"outcome", "profile_source", "warning_classes", "historical"}), f"{at}: v1_path route fields"):
            p.need(route["profile_source"] in ("field", "absent", "historical"), f"{at}: profile_source")
            p.need(isinstance(route["warning_classes"], list) and all(c in MUTATION_CLASS.values() for c in route["warning_classes"]), f"{at}: warning_classes")
            p.need(route["historical"] in ("decoded", "failed"), f"{at}: historical")
            return "v1_path"
    elif isinstance(route, dict) and route.get("outcome") == "reject":
        if "detail" in route:
            if p.need(_keys(route, {"outcome", "class", "detail"}) and route["class"] in TRANSPORT and _text(route["detail"]), f"{at}: transport reject fields"):
                return "reject"
        elif p.need(_keys(route, {"outcome", "class", "offset"}), f"{at}: reject route fields"):
            p.need(route["class"] in MUTATION_CLASS.values(), f"{at}: reject class")
            p.need(_int(route["offset"]) and route["offset"] >= 0, f"{at}: offset is a non-negative integer")
            return "reject"
    else:
        p.append(f"{at}: route outcome must be v1_path or reject")
    return None


def _check_expectation(e: Any, cfg: str, at: str, shapes: dict[str, Any], used: set[str], p: Problems, boundary: bool) -> None:
    fields = {"route", "adapter_calls", "entered", "verification"} | (set() if boundary else {"today"})
    if not p.need(_keys(e, fields), f"{at}: fields must be exactly {sorted(fields)}"):
        return
    outcome = _check_route(e["route"], at, p)
    p.need(_int(e["adapter_calls"]) and e["adapter_calls"] in (0, 1), f"{at}: adapter_calls must be the integer 0 or 1")
    p.need(e["entered"] in ("none", "dcp-jcs-v1"), f"{at}: entered")
    v = e["verification"]
    if v is not None:
        p.need(isinstance(v, str) and v in shapes, f"{at}: unknown verification shape {v!r}")
        p.need(isinstance(v, str) and v.split(".", 1)[0] == FAMILY[cfg], f"{at}: shape {v!r} is not of family {FAMILY[cfg]}")
        used.add(v)
    p.need((e["entered"] == "dcp-jcs-v1") == (v is not None), f"{at}: a verification exactly when a verifier was entered")
    if outcome == "reject":
        p.need(e["entered"] == "none", f"{at}: a rejection enters no verifier")
    if boundary:
        return
    t = e["today"]
    if not p.need(_keys(t, {"outcome", "kind"}) and t["outcome"] in TODAY, f"{at}: today must be {{outcome, kind}} with outcome in {sorted(TODAY)}"):
        return
    if t["outcome"] == "verified_result":
        p.need(t["kind"] is None, f"{at}: today.kind is null for verified_result")
    else:
        p.need(t["kind"] in today_kinds(cfg)[t["outcome"]], f"{at}: today.kind {t['kind']!r} is not a {t['outcome']} of {cfg}")
    if t["outcome"] == "host_decode_error":
        p.need(e["entered"] == "none", f"{at}: a host decoder refusal leaves nothing to verify on the experimental route")
    if t["outcome"] == "verified_result":
        p.need(e["entered"] == "dcp-jcs-v1", f"{at}: a verified_result today pairs with an entered verifier")
    if t["outcome"] == "in_band_parse_error":
        p.need(FAMILY[cfg] == "go" or cfg.startswith("wasm."), f"{at}: only Go and the WASM binding parse in band")
    if outcome == "v1_path" and e["route"]["historical"] == "failed" and e["entered"] == "none":
        p.need(t["outcome"] == "host_decode_error", f"{at}: a failed decoder with no verifier is a host_decode_error today")


def _check_shapes(shapes: Any, p: Problems) -> dict[str, Any]:
    if not p.need(isinstance(shapes, dict) and len(shapes) > 0, "verification_shapes must be a non-empty object"):
        return {}
    for name, s in shapes.items():
        at = f"shape {name}"
        p.need(isinstance(name, str) and name.split(".", 1)[0] in FAMILIES and "." in name, f"{at}: name must be <family>.<id>")
        if not p.need(_keys(s, {"verified", "errors_contain", "error_count", "warnings", "fields", "why"}), f"{at}: fields"):
            continue
        p.need(isinstance(s["verified"], bool), f"{at}: verified is a boolean")
        p.need(isinstance(s["errors_contain"], list) and all(_text(x) for x in s["errors_contain"]), f"{at}: errors_contain is a list of non-empty strings")
        p.need(_int(s["error_count"]) and s["error_count"] >= 0, f"{at}: error_count is a non-negative integer")
        p.need(s["warnings"] is None or (isinstance(s["warnings"], list) and all(isinstance(w, str) for w in s["warnings"])), f"{at}: warnings is a list or null")
        f = s["fields"]
        if p.need(_keys(f, {"manifest_valid", "verification_mode", "resolved_tier"}), f"{at}: stable fields"):
            p.need(f["manifest_valid"] is None or isinstance(f["manifest_valid"], bool), f"{at}: manifest_valid")
            p.need(f["verification_mode"] is None or f["verification_mode"] in MODES, f"{at}: verification_mode must be one of {sorted(MODES)} or null")
            p.need(f["resolved_tier"] is None or f["resolved_tier"] in TIERS, f"{at}: resolved_tier must be one of {sorted(TIERS)} or null")
        p.need(_text(s["why"]), f"{at}: why")
        if s["verified"] is True:
            p.need(s["error_count"] == 0 and s["errors_contain"] == [], f"{at}: a verified shape has no error")
        else:
            p.need(s["error_count"] >= 1 and len(s["errors_contain"]) >= 1, f"{at}: a failed shape names its errors")
    return shapes


def check(fixture: Path = FIXTURE, repo: Path = REPO) -> list[str]:
    p = Problems()
    try:
        doc = json.loads(fixture.read_text(encoding="utf-8"), object_pairs_hook=_no_duplicates)
    except (OSError, ValueError) as exc:
        return [f"fixture unreadable: {exc}"]
    top = {"schema", "title", "status", "how_to_read", "bases_source", "bases", "now", "now_ms", "transport",
           "accepted_profiles", "policy", "configurations", "families", "mutations", "verification_shapes", "cases", "boundary"}
    if not p.need(_keys(doc, top), f"top-level fields must be exactly {sorted(top)}"):
        return p
    p.need(doc["schema"] == SCHEMA, "schema")
    p.need(all(_text(doc[k]) for k in ("title", "status")) and isinstance(doc["how_to_read"], dict), "title, status, how_to_read")
    p.need(doc["transport"] == "bare" and doc["accepted_profiles"] == ["dcp-jcs-v1"] and doc["policy"] == "default", "transport, accepted_profiles, policy")
    p.need(doc["configurations"] == CONFIGS, "configurations must be exactly the 10 approved, in order")
    p.need(doc["families"] == FAMILIES, "families")

    # The frozen bases, by reference and hash.
    src = doc["bases_source"]
    p3_path = repo / PHASE3
    try:
        p3_bytes = p3_path.read_bytes()
        p3 = json.loads(p3_bytes)
    except (OSError, ValueError) as exc:
        return [*p, f"{PHASE3} unreadable: {exc}"]
    p.need(_keys(src, {"file", "sha256"}) and src.get("file") == PHASE3, "bases_source.file")
    p.need(isinstance(src, dict) and src.get("sha256") == hashlib.sha256(p3_bytes).hexdigest(), f"bases_source.sha256 is stale: {PHASE3} changed")
    bases: dict[str, bytes] = {}
    if p.need(_keys(doc["bases"], {"B-v1", "B-absent"}), "bases must be exactly B-v1 and B-absent"):
        for name, b in doc["bases"].items():
            text = p3["bases"][name]["input_json"].encode()
            ok = _keys(b, {"input_sha256"}) and b["input_sha256"] == p3["bases"][name]["input_sha256"] == hashlib.sha256(text).hexdigest()
            if p.need(ok, f"base {name}: input_sha256 is stale"):
                bases[name] = text
    p.need(doc["now"] == p3["now"] and doc["now_ms"] == p3["now_ms"], "now and now_ms must be the phase 3 instant")
    try:
        parsed = datetime.fromisoformat(str(doc["now"]).replace("Z", "+00:00"))
        p.need(_int(doc["now_ms"]) and round(parsed.timestamp() * 1000) == doc["now_ms"], "now_ms is not now")
    except ValueError:
        p.append("now is not RFC 3339")

    # Mutations: exactly M01..M18, the approved class, applying to both bases.
    muts = doc["mutations"]
    if p.need(isinstance(muts, dict) and list(muts) == list(MUTATION_CLASS), "mutations must be exactly M01..M18, in order"):
        for m, spec in muts.items():
            if not p.need(_keys(spec, {"class", "position", "edits", "why"}), f"mutation {m}: fields"):
                continue
            p.need(spec["class"] == MUTATION_CLASS[m], f"mutation {m}: class must be {MUTATION_CLASS[m]}")
            p.need(spec["position"] == MUTATION_POSITION[m], f"mutation {m}: position must be {MUTATION_POSITION[m]!r}")
            p.need(_text(spec["why"]), f"mutation {m}: why")
            ident = _identity({"class": spec["class"], "position": spec["position"], "edits": spec["edits"]})
            p.need(ident == MUTATION_IDENTITY[m], f"mutation {m}: its class, position and edits are not the approved ones (identity {ident[:16]})")
            for name, text in bases.items():
                apply_edits(text, spec["edits"], f"mutation {m} on {name}", Problems()) or p.append(f"mutation {m} does not apply to {name}")

    shapes = _check_shapes(doc["verification_shapes"], p)
    used: set[str] = set()

    # Cases: exactly the 38 approved IDs, each once, each with the 10 configurations.
    cases = doc["cases"]
    if not p.need(isinstance(cases, list) and len(cases) > 0, "cases must be a non-empty list"):
        return p
    ids = [c.get("id") if isinstance(c, dict) else None for c in cases]
    p.need(sorted(i for i in ids if isinstance(i, str)) == sorted(CASE_IDS) and len(ids) == len(CASE_IDS),
           f"case IDs must be exactly the {len(CASE_IDS)} approved: missing {sorted(set(CASE_IDS) - set(ids))}, "
           f"unknown {sorted(set(i for i in ids if i not in CASE_IDS), key=str)}, duplicated {sorted({i for i in ids if ids.count(i) > 1}, key=str)}")
    for c in cases:
        cid = c.get("id") if isinstance(c, dict) else None
        if not p.need(_keys(c, {"id", "base", "mutation", "input_sha256", "why", "expected"}) and cid in CASE_IDS, f"case {cid}: fields"):
            continue
        tag, suffix = cid.split("-")[1:]
        base, source = BASES[tag]
        p.need(c["base"] == base, f"case {cid}: base must be {base}")
        mutation = None if suffix == "C00" else suffix
        p.need(c["mutation"] == mutation, f"case {cid}: mutation must be {mutation}")
        p.need(_text(c["why"]), f"case {cid}: why")
        if base in bases and (mutation is None or mutation in muts):
            data = bases[base] if mutation is None else apply_edits(bases[base], muts[mutation]["edits"], f"case {cid}", p)
            if data is not None:
                p.need(c["input_sha256"] == hashlib.sha256(data).hexdigest(), f"case {cid}: input_sha256 is stale")
        exp = c["expected"]
        if not p.need(isinstance(exp, dict) and list(exp) == CONFIGS, f"case {cid}: expected must have exactly the 10 configurations, in order"):
            continue
        cls = MUTATION_CLASS.get(mutation) if mutation else None
        for cfg, e in exp.items():
            at = f"case {cid} {cfg}"
            _check_expectation(e, cfg, at, shapes, used, p, boundary=False)
            route = e.get("route") if isinstance(e, dict) else None
            if not isinstance(route, dict):
                continue
            if cls is None:
                p.need(route == {"outcome": "v1_path", "profile_source": source, "warning_classes": [], "historical": "decoded"}, f"{at}: a control is a clean delegation")
            elif route.get("outcome") == "v1_path":
                p.need(route.get("warning_classes") == [cls], f"{at}: the warning must be the injected class {cls}")
                p.need(route.get("profile_source") == ("historical" if cls in NOT_WALKABLE else source), f"{at}: profile_source")
            elif route.get("outcome") == "reject":
                p.need(route.get("class") == cls, f"{at}: the rejection must be the injected class {cls}")
                p.need(cls in NOT_WALKABLE, f"{at}: a {cls} unit is walkable and a dcp-jcs-v1 unit is delegated, never rejected")

    # Boundary: G7E-1..3, separate from the 38, with no today and no equivalence.
    b = doc["boundary"]
    if p.need(_keys(b, {"transport", "accepted_profiles", "cases"}) and b["transport"] == "envelope" and b["accepted_profiles"] == ["dcp-jcs-v1"], "boundary fields"):
        bids = [x.get("id") if isinstance(x, dict) else None for x in b["cases"]] if isinstance(b["cases"], list) else []
        p.need(bids == BOUNDARY_IDS, f"boundary case IDs must be exactly {BOUNDARY_IDS}, in order")
        for x in b["cases"] if isinstance(b["cases"], list) else []:
            bid = x.get("id") if isinstance(x, dict) else None
            if not p.need(_keys(x, {"id", "base", "edits", "input_sha256", "why", "expected"}) and x["base"] == "B-v1", f"boundary {bid}: fields"):
                continue
            if bid in BOUNDARY_IDENTITY:
                p.need(_identity({"base": x["base"], "edits": x["edits"]}) == BOUNDARY_IDENTITY[bid], f"boundary {bid}: its edits are not the approved ones")
            data = apply_edits(bases.get("B-v1", b""), x["edits"], f"boundary {bid}", p) if "B-v1" in bases else None
            if data is not None:
                p.need(x["input_sha256"] == hashlib.sha256(data).hexdigest(), f"boundary {bid}: input_sha256 is stale")
            p.need(_text(x["why"]), f"boundary {bid}: why")
            if not p.need(isinstance(x["expected"], dict) and list(x["expected"]) == CONFIGS, f"boundary {bid}: expected must have exactly the 10 configurations"):
                continue
            for cfg, e in x["expected"].items():
                at = f"boundary {bid} {cfg}"
                _check_expectation(e, cfg, at, shapes, used, p, boundary=True)
                if bid == "G7E-1":
                    p.need(isinstance(e, dict) and e.get("entered") == "dcp-jcs-v1" and e.get("verification") == f"{FAMILY[cfg]}.ok", f"{at}: G7E-1 must verify")
                elif isinstance(e, dict):
                    p.need(e.get("entered") == "none" and e.get("adapter_calls") == 0 and (e.get("route") or {}).get("outcome") == "reject", f"{at}: {bid} must not reach a verifier or a decoder")

    unused = sorted(set(shapes) - used)
    p.need(not unused, f"unused verification shapes: {unused}")
    return p


def hashes(fixture: Path = FIXTURE, repo: Path = REPO) -> list[str]:
    doc = json.loads(fixture.read_text(encoding="utf-8"), object_pairs_hook=_no_duplicates)
    p3 = json.loads((repo / PHASE3).read_bytes())
    lines = []
    for c in doc["cases"]:
        base = p3["bases"][c["base"]]["input_json"].encode()
        data = base if c["mutation"] is None else apply_edits(base, doc["mutations"][c["mutation"]]["edits"], c["id"], Problems())
        lines.append(f"{c['id']} {hashlib.sha256(data or b'').hexdigest()}")
    for x in doc["boundary"]["cases"]:
        data = apply_edits(p3["bases"]["B-v1"]["input_json"].encode(), x["edits"], x["id"], Problems())
        lines.append(f"{x['id']} {hashlib.sha256(data or b'').hexdigest()}")
    return lines


def main(argv: list[str]) -> int:
    if argv == ["--hashes"]:
        print("\n".join(hashes()))
        return 0
    if argv not in ([], ["--check"]):
        print("usage: gate7-v1-negatives.py [--check | --hashes]", file=sys.stderr)
        return 2
    problems = check()
    if problems:
        print(f"{FIXTURE.name}: {len(problems)} problem(s)", file=sys.stderr)
        for line in problems:
            print(f"  {line}", file=sys.stderr)
        return 1
    print(f"{FIXTURE.name}: OK: {len(CASE_IDS)} cases x {len(CONFIGS)} configurations ({len(CASE_IDS) * len(CONFIGS)} expectations), "
          f"{len(BOUNDARY_IDS)} boundary cases")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
