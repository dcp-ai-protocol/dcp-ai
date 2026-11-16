"""V2-2 in the Python SDK: the internal schema interpreter (dcp_ai/v2/_schema_v2.py) over the shared corpus of
tests/interop/v2/schema_validation/, and the gate in front of verify_signed_bundle_v2, admission and the experimental
candidate route, with the deeper checks the historical rows used to reach kept covered (regression_map.json)."""

from __future__ import annotations

import asyncio
import copy
import hashlib
import importlib.util
import json
import re
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from tests.schema_regression_map import REGRESSION_MAP
from dcp_ai.providers import Ed25519Provider, MlDsa65Provider
from dcp_ai.v2 import _schema_v2
from dcp_ai.v2._schema_v2 import (
    SCHEMA_ERRORS_CAP,
    is_schema_date_time,
    match_program,
    schema_diagnostics,
    validate_signed_bundle_v2_schema,
)
from dcp_ai.v2._schema_v2_generated import SCHEMA_V2_IR, SCHEMA_V2_IR_SHA256
from dcp_ai.v2.admission import admit_signed_bundle_v2
from dcp_ai.v2.crypto_registry import AlgorithmRegistry
from dcp_ai.v2.experimental_candidate_router import JSON_LOADS_BYTES, RouteReject, RouteV1Path
from dcp_ai.v2.experimental_candidate_verify import create_verifier
from dcp_ai.v2.security_tier import compute_security_tier
from dcp_ai.v2.session_nonce import rfc3339_epoch_ms
from dcp_ai.v2.verify import _verify_signed_bundle_v2_with_profile, verify_signed_bundle_v2

ROOT = Path(__file__).resolve().parents[3]
load = lambda rel: json.loads((ROOT / rel).read_text("utf-8"))  # noqa: E731
S = load("tests/interop/v2/schema_validation/schema_cases.json")
W = load("tests/interop/v2/schema_validation/wiring_cases.json")
D = load("tests/interop/v2/schema_validation/date_time_cases.json")
DEEP = load("tests/interop/v2/schema_validation/deep_negatives.json")
B = load("tests/interop/v2/bundle_vectors.json")
V = load("tests/interop/v2/secondary_sha3_vectors.json")
A = load("tests/interop/v2/admission_vectors.json")
P3 = load("tests/interop/candidate/phase3-signed-vectors.json")
NOW = rfc3339_epoch_ms(W["verification_time"])


def v1(doc: Any):
    return validate_signed_bundle_v2_schema(doc, "dcp-jcs-v1")


def attributed(result, a: dict) -> bool:
    return any(e["instance"] == a["instance"] and e["keyword"] == a["keyword"] for e in result.errors)


def dumps(v: Any) -> str:
    """The text JSON.stringify gives for these values (compact, members in order, non-ASCII as is)."""
    return json.dumps(v, separators=(",", ":"), ensure_ascii=False)


def case_doc(c: dict) -> Any:
    if "raw_replace" in c:
        text = dumps(S["instance"])
        frm, to = c["raw_replace"]
        assert text.count(frm) == 1, c["id"]
        return json.loads(text.replace(frm, to))
    d = copy.deepcopy(S["instance"])
    m = c.get("mutation")
    if not m:
        return d
    path = m["path"]
    if m["op"] == "set":
        if not path:
            return copy.deepcopy(m["value"])
        parent = d
        for t in path[:-1]:
            parent = parent[t]
        parent[path[-1]] = copy.deepcopy(m["value"])
    elif m["op"] == "delete":
        parent = d
        for t in path[:-1]:
            parent = parent[t]
        del parent[path[-1]]
    elif m["op"] == "many":
        for i in range(m["count"]):
            d[f"x_unknown_{i:02d}"] = i
    return d


class Counting:
    """A provider whose verify calls are counted, to show where a rejection happens."""

    def __init__(self, inner, calls: list[int]):
        self._inner, self._calls = inner, calls

    def __getattr__(self, name):
        return getattr(self._inner, name)

    async def verify(self, *args, **kwargs):
        self._calls[0] += 1
        return await self._inner.verify(*args, **kwargs)


def counting() -> tuple[AlgorithmRegistry, list[int]]:
    calls = [0]
    r = AlgorithmRegistry()
    r.register_signer(Counting(Ed25519Provider(), calls))
    r.register_signer(Counting(MlDsa65Provider(), calls))
    return r, calls


# ── The generated IR ──

def test_the_ir_is_the_staged_ir_with_its_sha256_and_the_ported_notice_is_kept():
    assert SCHEMA_V2_IR == (ROOT / "tools/schema-ir/staging/ir.json").read_text("utf-8").rstrip("\n")
    assert hashlib.sha256(SCHEMA_V2_IR.encode()).hexdigest() == SCHEMA_V2_IR_SHA256
    ir = json.loads(SCHEMA_V2_IR)
    assert ir["format"] == "dcp-ai.v2-schema-ir/1" and len(ir["sources"]) == 11
    for s in ir["sources"]:
        assert hashlib.sha256((ROOT / s["file"]).read_bytes()).hexdigest() == s["sha256"], s["file"]
    source = Path(_schema_v2.__file__).read_text("utf-8")
    assert "Copyright (c) 2020 Evgeny Poberezkin" in source and "MIT License" in source


# ── The interpreter over the shared corpus ──

def test_the_468_schema_cases_get_their_verdict_and_attribution_and_nothing_is_written():
    assert len(S["cases"]) == 468
    assert v1(copy.deepcopy(S["instance"])).valid
    for c in S["cases"]:
        doc = case_doc(c)
        before = dumps(doc)
        r = v1(doc)
        assert r.valid is c["expect"]["schema"]["valid"], (c["id"], r.errors[:3])
        if "attribution" in c["expect"]["schema"]:
            assert attributed(r, c["expect"]["schema"]["attribution"]), (c["id"], r.errors[:4])
        assert dumps(doc) == before, c["id"]


def test_payloads_are_closed_by_their_artifact_schema_and_open_objects_stay_open():
    d = copy.deepcopy(S["instance"])
    d["bundle"]["intent"]["payload"]["x_unknown"] = 1
    assert [(e["instance"], e["keyword"]) for e in v1(d).errors] == [("/bundle/intent/payload", "additionalProperties")]
    o = copy.deepcopy(S["instance"])
    o["bundle"]["x"] = {"deep": [1, [2, {"three": None}]]}
    o["bundle"]["intent"]["payload"]["target"]["x"] = "open"
    o["bundle"]["policy_decision"]["payload"]["required_confirmation"] = {"type": "human_approve", "x": "open"}
    o["bundle"]["audit_entries"][0]["evidence"]["x"] = "open"
    assert v1(o).valid


def at(f) -> Any:
    d = copy.deepcopy(S["instance"])
    f(d)
    return v1(d)


def set_count(v):
    return lambda d: d["bundle"]["manifest"].__setitem__("audit_count", v)


def test_the_native_boundary_of_numbers_strings_lists_and_keys():
    assert at(set_count(3.0)).valid  # a finite float with no fraction is an integer
    for bad in (3.5, True, False, "3", float("nan"), float("inf"), Decimal(3), None):
        assert not at(set_count(bad)).valid, bad
    assert at(set_count(2**70)).valid is True  # a big int is an integer (no maximum here)
    # absent and None differ
    assert at(lambda d: d["bundle"]["responsible_principal_record"]["payload"].__setitem__("expires_at", None)).valid
    r = at(lambda d: d["bundle"]["responsible_principal_record"]["payload"].pop("expires_at"))
    assert [(e["keyword"], e.get("member")) for e in r.errors] == [("required", "expires_at")]
    # a list is an array, a tuple is not
    r = at(lambda d: d["signature"]["signer"].__setitem__("kids", tuple(d["signature"]["signer"]["kids"])))
    assert [(e["instance"], e["keyword"]) for e in r.errors] == [("/signature/signer/kids", "type")]
    # a dict with a key that is not a str is not a JSON object, where a schema visits it
    r = at(lambda d: d["bundle"]["manifest"].__setitem__(1, "x"))
    assert [(e["instance"], e["keyword"]) for e in r.errors] == [("/bundle/manifest", "type")]
    # open members are not visited by V2-2 (bundle.x is unsigned: no later check may read it either)
    assert at(lambda d: d["bundle"].__setitem__("x", {"a": float("nan"), "f": object(), "d": Decimal(1), "t": (1, 2)})).valid
    # code points: an astral character counts one, a lone surrogate counts one
    jur = lambda v: at(lambda d: d["bundle"]["responsible_principal_record"]["payload"].__setitem__("jurisdiction", v)).valid  # noqa: E731
    assert jur("\U0001F600\U0001F600") and not jur("\U0001F600") and jur("\ud800\ud800")


def test_one_of_is_one_branch_reported_once():
    def pq(v):
        return at(lambda d: d["signature"]["composite_sig"].__setitem__("pq", v))
    assert pq(None).valid and pq(dict(S["instance"]["signature"]["composite_sig"]["pq"])).valid
    for v in ({}, False, "x", {**S["instance"]["signature"]["composite_sig"]["pq"], "x": 1}):
        assert [(e["instance"], e["keyword"]) for e in pq(v).errors] == [("/signature/composite_sig/pq", "oneOf")], v


def test_each_pattern_program_answers_as_its_anchored_ascii_source():
    ir = json.loads(SCHEMA_V2_IR)
    import random
    rnd = random.Random(20261102)
    alphabet = ["0", "9", "a", "f", "g", "A", "G", ":", "=", "+", "/", " ", "\n", "\r", " ", "١", "\U0001F600", "s", "h", "E", "N"]
    for p in ir["patterns"]:
        inner = p["source"][1:-1]  # these sources are ASCII and anchored with ^ and $: full match is their reading
        samples = ["", "GENESIS", "GENESIS\n", "AAAA==", "AAAA===", "sha256:" + "a" * 64, "sha256:" + "a" * 64 + "\n", "a" * 32, "a" * 64]
        samples += ["".join(rnd.choice(alphabet) for _ in range(rnd.randrange(72))) for _ in range(2000)]
        for s in samples:
            assert match_program(p, s) == (re.fullmatch(inner, s) is not None), (p["source"], s)


def _oracle_date_time():
    spec = importlib.util.spec_from_file_location("oracle_jsonschema", ROOT / "tools/schema-ir/oracle_jsonschema.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.is_date_time


def test_date_time_is_the_ajv_formats_boundary_on_the_shared_cases_and_every_bmp_separator():
    oracle = _oracle_date_time()  # the test-only Python port of the phase-1 oracle, a contrast and not production
    for c in D["cases"]:
        assert is_schema_date_time(c["value"]) is c["accepted"], c["value"]
        assert oracle(c["value"]) is c["accepted"], c["value"]
    accepted = []
    for cp in range(0x10000):
        if 0xD800 <= cp <= 0xDFFF:
            continue
        v = f"2000-01-01{chr(cp)}00:00:00Z"
        assert is_schema_date_time(v) is oracle(v), hex(cp)
        if is_schema_date_time(v):
            accepted.append(f"U+{cp:04X}")
    assert accepted == D["separator_scalars"]


def test_the_error_budget_and_bounded_escaped_diagnostics():
    def many(n):
        d = copy.deepcopy(S["instance"])
        for i in range(n):
            d[f"x_{i}"] = i
        return v1(d)
    r16, r17 = many(16), many(17)
    assert (len(r16.errors), r16.truncated, r16.valid) == (16, False, False)
    assert (len(r17.errors), r17.truncated, r17.valid) == (SCHEMA_ERRORS_CAP, True, False)
    assert schema_diagnostics(r17)[-1] == "schema: further errors not listed"
    d = copy.deepcopy(S["instance"])
    d["x" * (1 << 20)] = "v" * (1 << 20)
    d["~/" * 100] = 1
    d["bundle"]["manifest"]["intended_verifier"] = "w" * 5000
    lines = schema_diagnostics(v1(d))
    assert "vvvv" not in "\n".join(lines) and "wwww" not in "\n".join(lines)
    assert all(len(line) < 200 for line in lines)
    assert any(line.startswith("schema: / additionalProperties ~0~1") and line.endswith("…[cut]") for line in lines)


def test_the_overlay_changes_one_const_in_both_directions():
    def errors(p, profile):
        d = copy.deepcopy(S["instance"])
        if p is None:
            del d["bundle"]["manifest"]["canonicalization_profile"]
        else:
            d["bundle"]["manifest"]["canonicalization_profile"] = p
        return [(e["instance"], e["keyword"]) for e in validate_signed_bundle_v2_schema(d, profile).errors]
    const = [("/bundle/manifest/canonicalization_profile", "const")]
    assert errors("dcp-jcs-v1", "dcp-jcs-v1") == [] and errors("dcp-jcs-v2", "dcp-jcs-v2") == []
    assert errors("dcp-jcs-v2", "dcp-jcs-v1") == const and errors("dcp-jcs-v1", "dcp-jcs-v2") == const
    assert errors(None, "dcp-jcs-v2") == []
    with pytest.raises(ValueError):
        validate_signed_bundle_v2_schema({}, "dcp-jcs-v3")


# ── The gate in front of the public verifier ──

def wiring_doc(c: dict) -> Any:
    return json.loads(c["signed_bundle_text"]) if "signed_bundle_text" in c else copy.deepcopy(c["signed_bundle"])


def test_the_57_signed_cases_through_verify_signed_bundle_v2_negatives_before_any_provider():
    assert len(W["cases"]) == 57
    positives = 0
    for c in W["cases"]:
        registry, calls = counting()
        doc = wiring_doc(c)
        before = dumps(doc)
        r = asyncio.run(verify_signed_bundle_v2(doc, registry, W["verifier_policy"], now_ms=NOW))
        assert dumps(doc) == before, c["name"]
        if c["expect"]["verified"]:
            positives += 1
            assert r["errors"] == [] and r["verified"] is True, (c["name"], r["errors"])
            assert calls[0] > 0, c["name"]
        else:
            assert r["verified"] is False, c["name"]
            assert all(e.startswith("schema: ") for e in r["errors"]), (c["name"], r["errors"])
            target = f"schema: {c['target']['instance'] or '/'} {c['target']['keyword']}"
            assert any(e == target or e.startswith(target + " ") for e in r["errors"]), (c["name"], r["errors"])
            assert r["details"] == {} and r["warnings"] == [], c["name"]
            assert calls[0] == 0, f"{c['name']}: no provider may run"
    assert positives == 13


def test_c4_null_session_times_fail_the_schema():
    for name in ("c4_session_expires_at_null", "c4_session_issued_at_null"):
        c = next(x for x in W["cases"] if x["name"] == name)
        r = asyncio.run(verify_signed_bundle_v2(wiring_doc(c), counting()[0], W["verifier_policy"], now_ms=NOW))
        assert r["errors"] == [f"schema: {c['target']['instance']} type"]


def test_the_configuration_and_clock_contracts_are_kept_before_v2_2():
    with pytest.raises(TypeError):
        asyncio.run(verify_signed_bundle_v2({}, counting()[0], None, now_ms=float("nan")))
    with pytest.raises(ValidationError):
        asyncio.run(verify_signed_bundle_v2({}, counting()[0], {"x_unknown_policy_field": 1}))


# ── Admission and the candidate route ──

def test_combined_admission_positive_and_its_schema_negative_before_any_provider():
    c = next(x for x in A["cases"] if x["name"] == "A_known_principal_strict")
    kwargs = dict(profile=A["profiles"][c["profile"]], trust=A["trust_sets"][c["trust"]], revocation=c["revocation"], now_ms=rfc3339_epoch_ms(c["now"]))
    ok = asyncio.run(admit_signed_bundle_v2(copy.deepcopy(A["signed_bundles"][c["bundle"]]), counting()[0], **kwargs))
    assert (ok["verified"], ok["admitted"]) == (True, True)
    bad = copy.deepcopy(A["signed_bundles"][c["bundle"]])
    bad["x_ext"] = 1
    registry, calls = counting()
    r = asyncio.run(admit_signed_bundle_v2(bad, registry, **kwargs))
    assert (r["verified"], r["admitted"]) == (False, False)
    assert r["verification"]["errors"] == ["schema: / additionalProperties x_ext"]
    assert calls[0] == 0


def test_candidate_positive_schema_negative_and_default_refusal():
    policy = P3["verifier_policies"]["default"]
    verifier = create_verifier(transport="bare", accepted_profiles=["dcp-jcs-v2"], historical=JSON_LOADS_BYTES)
    text = P3["bases"]["B-v2"]["input_json"]
    ok = asyncio.run(verifier.verify(text.encode(), counting()[0], policy, now_ms=P3["now_ms"]))
    assert (ok.entered, ok.verification["verified"]) == ("dcp-jcs-v2", True)
    registry, calls = counting()
    bad = asyncio.run(verifier.verify(('{"x_ext":1,' + text.lstrip()[1:]).encode(), registry, policy, now_ms=P3["now_ms"]))
    assert bad.entered == "dcp-jcs-v2" and bad.verification["errors"] == ["schema: / additionalProperties x_ext"]
    assert calls[0] == 0
    today = asyncio.run(verify_signed_bundle_v2(json.loads(text), counting()[0], policy, now_ms=P3["now_ms"]))
    assert today["errors"] == ["schema: /bundle/manifest/canonicalization_profile const"]


def test_profile_confusion_in_both_directions_and_absence_under_the_candidate_profile():
    data = json.dumps(W["cases"][0]["signed_bundle"]).encode()

    def route(profiles):
        r = asyncio.run(create_verifier(transport="bare", accepted_profiles=profiles, historical=JSON_LOADS_BYTES)
                        .verify(data, counting()[0], W["verifier_policy"], now_ms=NOW))
        return r
    refused = route(["dcp-jcs-v2"])
    assert isinstance(refused.route, RouteReject) and refused.route.reject_class == "PROFILE_NOT_ACCEPTED" and refused.entered == "none"
    accepted = route(["dcp-jcs-v1"])
    assert isinstance(accepted.route, RouteV1Path) and accepted.entered == "dcp-jcs-v1" and accepted.verification["verified"] is True
    absent = copy.deepcopy(W["cases"][0]["signed_bundle"])
    del absent["bundle"]["manifest"]["canonicalization_profile"]
    r = asyncio.run(_verify_signed_bundle_v2_with_profile(absent, counting()[0], W["verifier_policy"], NOW, "dcp-jcs-v2"))
    assert r["verified"] is False and any("canonicalization_profile" in e for e in r["errors"]), r["errors"]


# ── The deeper checks of the historical rows ──

def _historical_doc(fixture: str, name: str) -> Any:
    if fixture.endswith("secondary_sha3_vectors.json"):
        c = next(x for x in V["cases"] if x["name"] == name)
        return {"bundle": {"dcp_bundle_version": "2.0", "manifest": c["manifest"], **V["base"]["artifacts"], "audit_entries": c["audit_entries"]}, "signature": c["signature"]}
    b = next((x for x in B["must_reject_bundles"] if x["name"] == name), None)
    if b:
        return b["signed_bundle"]
    m = next(x for x in B["must_reject"] if x["name"] == name)
    d = copy.deepcopy(B["signed_bundle"])
    for mut in m["mutations"]:
        node = d
        for k in mut["path"][:-1]:
            node = node[k]
        node[mut["path"][-1]] = mut["value"]
    return d


def test_the_56_regression_rows_and_their_coverage():
    rows = REGRESSION_MAP["rows"]
    assert sum(r["fixture"].endswith("bundle_vectors.json") for r in rows) == 43
    assert sum(r["fixture"].endswith("secondary_sha3_vectors.json") for r in rows) == 13
    for r in rows:
        assert not v1(_historical_doc(r["fixture"], r["name"])).valid, r["name"]
        cov = r["deep_coverage"]
        assert cov["kind"] in ("schema_valid_rows", "deep_negatives", "helper", "structural")
        for c in [x for x in (cov, cov.get("also")) if x and x.get("kind") == "schema_valid_rows"]:
            for n in c["rows"]:
                assert v1(_historical_doc(c["fixture"], n)).valid, (r["name"], n)
        if cov["kind"] == "deep_negatives":
            assert all(any(d["name"] == n for d in DEEP["cases"]) for n in cov["cases"]), r["name"]


def test_the_deep_negatives_reach_the_temporal_parsers_and_the_canonicalizer_past_v2_2():
    now = rfc3339_epoch_ms(DEEP["verification_time"])
    for c in DEEP["cases"]:
        assert v1(c["signed_bundle"]).valid, c["name"]
        r = asyncio.run(verify_signed_bundle_v2(copy.deepcopy(c["signed_bundle"]), counting()[0], DEEP["verifier_policy"], now_ms=now))
        assert r["verified"] is False and not any(e.startswith("schema:") for e in r["errors"]), (c["name"], r["errors"])
        assert c["error_contains_by_sdk"]["py"].lower() in "\n".join(r["errors"]).lower(), (c["name"], r["errors"])


def test_a_lone_surrogate_in_a_committed_open_member_still_reaches_the_canonicalizer():
    """Python-only: json.loads keeps a lone surrogate, which the UTF-8 encoding of the canonical payload refuses."""
    doc = wiring_doc(W["cases"][0])
    doc["bundle"]["intent"]["payload"]["target"]["x_lone"] = "\ud800"
    assert v1(doc).valid
    r = asyncio.run(verify_signed_bundle_v2(doc, counting()[0], W["verifier_policy"], now_ms=NOW))
    assert r["verified"] is False and any("UnicodeEncodeError" in e for e in r["errors"]), r["errors"]


def test_the_tier_lookup_keeps_its_guard_for_names_outside_the_enums():
    """The historical V2-9 rows used names like constructor; V2-2 now refuses them, so the lookup is tested directly.
    The policy's mode lookup is an inline dict membership test in verify.py, with no helper to call."""
    intent = B["signed_bundle"]["bundle"]["intent"]["payload"]
    unknown = compute_security_tier({**intent, "action_type": "zz-unknown"}, {"risk_score": 0})
    for field in ("action_type", "estimated_impact", "security_tier"):
        for name in ("constructor", "__proto__", "toString", "hasOwnProperty", "__class__", "__dict__"):
            tier = compute_security_tier({**intent, field: name}, {"risk_score": 0})
            assert tier in ("routine", "standard", "elevated", "maximum"), (field, name)
            if field != "security_tier":
                assert tier == unknown, (field, name)
