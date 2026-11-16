"""Experimental candidate router (phase 2), by phase: configuration, transport, selection and policy on
walkable units, the historical adapter on the units it decides (public fixture of measured decoders),
the grammar walker against the phase 1 scanner, v1 parity on really signed bundles, laziness, the
adapter contract and byte ownership. Candidate verification is phase 3: corpus expectations accept_v2
and COMMITMENT_MISMATCH are checked only as ``candidate``.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
from pathlib import Path

import pytest

from dcp_ai.providers.ed25519_provider import Ed25519Provider
from dcp_ai.providers.ml_dsa_65_provider import MlDsa65Provider
from dcp_ai.v2.crypto_registry import AlgorithmRegistry
from dcp_ai.v2.experimental_candidate_ingress import CandidateIngressAccept, experimental_candidate_ingress
from dcp_ai.v2.experimental_candidate_router import (
    JSON_LOADS_BYTES,
    JSON_LOADS_STRICT_DECODE,
    ExperimentalCandidateAdapterError,
    ExperimentalCandidateConfigError,
    HistoricalAdapter,
    HistoricalDecodeFailure,
    RouteCandidate,
    RouteReject,
    RouteV1Path,
    TransportReject,
    UnitRange,
    _walk_grammar_for_tests,
    create_router,
    extract_unit,
)
from dcp_ai.v2.session_nonce import rfc3339_epoch_ms
from dcp_ai.v2.verify import verify_signed_bundle_v2

ROOT = Path(__file__).resolve().parents[3]
CANDIDATE = ROOT / "docs" / "proposals" / "canonicalization-candidate"
BASELINE = json.loads((CANDIDATE / "baseline-corpus.json").read_text())["cases"]
DESIGN = json.loads((CANDIDATE / "corpus.json").read_text())["cases"]
FIXTURE = json.loads((ROOT / "tests" / "interop" / "candidate" / "phase2-adapter-expectations.json").read_text())
VECTORS = json.loads((ROOT / "tests" / "interop" / "v2" / "bundle_vectors.json").read_text())
ADMISSION = json.loads((ROOT / "tests" / "interop" / "v2" / "admission_vectors.json").read_text())

BOTH = ["dcp-jcs-v1", "dcp-jcs-v2"]
PY_ADAPTERS = {"py.json_loads_bytes": JSON_LOADS_BYTES, "py.json_loads_strict_decode": JSON_LOADS_STRICT_DECODE}
OBSOLETE = lambda c: (c.get("options") or {}).get("depth_scope") == "transport"  # noqa: E731
CONFIGURATION = [c for c in DESIGN if c["group"] == "configuration"]
ENVELOPE_DOCUMENTS = [c for c in DESIGN if c["mode"] == "document" and c["transport"] == "envelope" and not OBSOLETE(c)]
ROUTED = [c for c in DESIGN if c["mode"] == "bundle" and c["group"] != "configuration" and "historical" not in c and not OBSOLETE(c)]


def input_of(case: dict) -> bytes:
    data = bytes.fromhex(case["input_hex"]) if "input_hex" in case else case["input_json"].encode("utf-8")
    assert hashlib.sha256(data).hexdigest() == case["input_sha256"], case["id"]
    return data


def unit_with(profile: str, extra: str = "") -> bytes:
    return ('{"bundle":{"manifest":{"canonicalization_profile":%s}},"signature":{}%s}' % (profile, extra)).encode()


class Counting(HistoricalAdapter):
    def __init__(self, inner: HistoricalAdapter) -> None:
        self.calls = 0

        def decode(unit: bytes):
            self.calls += 1
            return inner.decode(unit)

        super().__init__(inner.name, decode)


def router(adapter=JSON_LOADS_BYTES, transport="bare", policy=BOTH):
    return create_router(transport=transport, accepted_profiles=policy, historical=adapter)


BOM_V1 = b"\xef\xbb\xbf" + unit_with('"dcp-jcs-v1"')


def test_counts_the_corpus_cases_of_each_phase():
    assert (len(CONFIGURATION), len(ENVELOPE_DOCUMENTS), len(ROUTED)) == (9, 28, 58)
    assert len([c for c in DESIGN if "historical" in c]) == 9
    assert len([c for c in DESIGN if OBSOLETE(c)]) == 2
    assert len(FIXTURE["cases"]) == 16


@pytest.mark.parametrize("case", CONFIGURATION, ids=[c["id"] for c in CONFIGURATION])
def test_configuration_errors_before_any_input(case):
    with pytest.raises(ExperimentalCandidateConfigError) as e:
        create_router(transport="bare", accepted_profiles=case.get("policy"), historical=JSON_LOADS_BYTES)
    assert (e.value.code, e.value.detail) == (case["expected"]["class"], case["expected"]["detail"])


def test_transport_and_adapter_configuration_errors():
    def detail(**kwargs):
        try:
            create_router(**{"transport": "bare", "accepted_profiles": BOTH, "historical": JSON_LOADS_BYTES, **kwargs})
        except ExperimentalCandidateConfigError as e:
            return e.detail
        return "created"

    assert detail(transport="header") == "TRANSPORT"
    assert detail(historical=None) == "HISTORICAL_ADAPTER"
    assert detail(historical=HistoricalAdapter("", JSON_LOADS_BYTES.decode)) == "HISTORICAL_ADAPTER"
    assert detail(historical=HistoricalAdapter("x", None)) == "HISTORICAL_ADAPTER"


def test_configuration_is_read_with_exact_types():
    class Text(str):
        pass

    class Listing(list):
        pass

    def detail(**kwargs):
        try:
            create_router(**{"transport": "bare", "accepted_profiles": ["dcp-jcs-v2"], "historical": JSON_LOADS_BYTES, **kwargs})
        except ExperimentalCandidateConfigError as e:
            return e.detail
        return "created"

    assert detail(accepted_profiles=[Text("dcp-jcs-v2")]) == "NOT_STRINGS"
    assert detail(accepted_profiles=Listing(["dcp-jcs-v2"])) == "NOT_A_NON_EMPTY_LIST"
    assert detail(transport=Text("bare")) == "TRANSPORT"
    assert detail(historical=HistoricalAdapter(Text("x"), JSON_LOADS_BYTES.decode)) == "HISTORICAL_ADAPTER"
    assert detail() == "created"


def test_private_snapshot_of_the_configuration():
    policy = ["dcp-jcs-v1"]
    adapter = Counting(JSON_LOADS_BYTES)
    r = create_router(transport="bare", accepted_profiles=policy, historical=adapter)
    replaced = []
    policy.append("dcp-jcs-v2")
    policy.pop(0)
    adapter.decode = lambda unit: replaced.append(1)
    adapter.name = "replaced"
    r.configuration["accepted_profiles"].append("dcp-jcs-v2")
    v2 = r.route(unit_with('"dcp-jcs-v2"'))
    assert (v2.outcome, v2.reject_class, v2.profile) == ("reject", "PROFILE_NOT_ACCEPTED", "dcp-jcs-v2")
    v1 = r.route(unit_with('"dcp-jcs-v1"'))
    assert v1.outcome == "v1_path" and v1.historical.adapter == "json_loads_bytes"
    assert (adapter.calls, replaced) == (1, [])
    assert r.configuration == {"transport": "bare", "accepted_profiles": ["dcp-jcs-v1"], "historical": "json_loads_bytes"}


@pytest.mark.parametrize("case", ENVELOPE_DOCUMENTS, ids=[c["id"] for c in ENVELOPE_DOCUMENTS])
def test_transport_document_cases(case):
    data, e = input_of(case), case["expected"]
    x = extract_unit(data, "envelope")
    if e.get("class") in ("TRANSPORT_INVALID", "TRANSPORT_AMBIGUOUS"):
        assert x == TransportReject(e["class"], e["detail"], e.get("transport_offset"))
        return
    assert isinstance(x, UnitRange)
    if "unit" in e:
        assert [x.start, x.end] == e["unit"]
    r = experimental_candidate_ingress(data[x.start:x.end])
    if e["result"] == "accept":
        assert isinstance(r, CandidateIngressAccept) and r.canonical_sha256 == e["canonical_sha256"]
    else:
        assert (r.reject_class, r.offset) == (e["class"], e["offset"])


@pytest.mark.parametrize("case", ROUTED, ids=[c["id"] for c in ROUTED])
def test_selection_and_policy_on_walkable_units(case):
    adapter = Counting(JSON_LOADS_BYTES)
    r = router(adapter, case["transport"], case["policy"]).route(input_of(case))
    e = case["expected"]
    if "unit" in e and r.outcome != "reject":
        assert [r.unit.start, r.unit.end] == e["unit"]
    if e["result"] == "accept_v2" or e.get("class") == "COMMITMENT_MISMATCH":
        assert isinstance(r, RouteCandidate) and r.attempts == ("dcp-jcs-v2",) and adapter.calls == 0
    elif e["result"] == "v1_path":
        assert isinstance(r, RouteV1Path) and list(r.attempts) == e["attempts"] and adapter.calls == 1
        assert [{"class": w.reject_class, "offset": w.offset} for w in r.warnings] == e["warnings"]
    else:
        assert isinstance(r, RouteReject) and adapter.calls == 0
        assert (r.reject_class, r.offset, r.profile, r.attempts) == (e["class"], e.get("offset"), e.get("profile"), ())


FIXTURE_ROWS = [(c, a) for c in FIXTURE["cases"] for a in PY_ADAPTERS]


@pytest.mark.parametrize("case,name", FIXTURE_ROWS, ids=[f"{c['id']}-{a}" for c, a in FIXTURE_ROWS])
def test_historical_adapter_fixture(case, name):
    data = bytes.fromhex(case["input_hex"])
    assert hashlib.sha256(data).hexdigest() == case["input_sha256"]
    row = case["adapters"][name]
    try:  # the fixture reading is the decoder's own, re-measured here
        value = PY_ADAPTERS[name].decode(data)
        node = value
        for key in ("bundle", "manifest", "canonicalization_profile"):
            node = node[key] if type(node) is dict and key in node else None
            if node is None and key != "canonicalization_profile":
                break
        field = node if type(value) is dict else None
        present = type(value) is dict and type(value.get("bundle")) is dict and type(value["bundle"].get("manifest")) is dict and "canonicalization_profile" in value["bundle"]["manifest"]
        reading = ("dcp-jcs-v1" if field == "dcp-jcs-v1" else "dcp-jcs-v2" if field == "dcp-jcs-v2" else "other") if present else "absent"
    except HistoricalDecodeFailure:
        reading = "fails"
    assert reading == row["decoder_reading"]
    adapter = Counting(PY_ADAPTERS[name])
    r = router(adapter, "bare", case["policy"]).route(data)
    e = row["expected"]
    assert adapter.calls == e["adapter_calls"]
    if e["outcome"] == "reject":
        assert isinstance(r, RouteReject)
        assert (r.reject_class, r.offset, r.profile) == (e["class"], e["offset"], e.get("profile"))
    else:
        assert isinstance(r, RouteV1Path) and r.profile_source == e["profile_source"]
        assert [{"class": w.reject_class, "offset": w.offset} for w in r.warnings] == e["warnings"]
        assert ("decoded" if r.historical.ok else "failed") == e["historical"]


def test_grammar_walker_matches_phase_1_on_utf8_inputs_without_a_bom():
    compared = 0
    for case in BASELINE + DESIGN:
        data = input_of(case)
        p1 = experimental_candidate_ingress(data)
        cls = getattr(p1, "reject_class", None)
        if cls in ("BOM", "UTF8_INVALID"):
            continue  # precedence, below
        expected = (False, p1.offset) if cls == "SYNTAX" else (True, None)
        assert _walk_grammar_for_tests(data) == expected, case["id"]
        compared += 1
    assert compared == 234  # 274 corpus inputs, 40 with a BOM or invalid UTF-8


def test_encoding_precedence_is_its_own():
    ff = b'[,"\xff"]'
    assert experimental_candidate_ingress(ff).reject_class == "UTF8_INVALID"
    assert _walk_grammar_for_tests(ff) == (False, 1)
    assert _walk_grammar_for_tests(b"\xef\xbb\xbf{}") == (False, 0)
    assert extract_unit(b'\xef\xbb\xbf{"signed_bundle":{},}', "envelope") == TransportReject("TRANSPORT_INVALID", "BOM", 0)
    assert extract_unit(b'{"x":"\xff","signed_bundle":{}}', "envelope") == TransportReject("TRANSPORT_INVALID", "UTF8_INVALID", 6)
    assert extract_unit(b'{"x":"\xff","signed_bundle":{},}', "envelope").detail == "SYNTAX"


def _parity_inputs():
    text = json.dumps(VECTORS["signed_bundle"], separators=(",", ":"), ensure_ascii=False).encode()
    profile = b'"canonicalization_profile":"dcp-jcs-v1"'
    assert text.count(profile) == 1
    action = text.index(b'"action_type":"') + len(b'"action_type":"')
    variants = {
        "bom": b"\xef\xbb\xbf" + text,
        "dup-profile-unknown-then-v1": text.replace(profile, b'"canonicalization_profile":"dcp-jcs-v9",' + profile),
        "dup-profile-v2-then-v1": text.replace(profile, b'"canonicalization_profile":"dcp-jcs-v2",' + profile),
        "dup-profile-v1-then-unknown": text.replace(profile, profile + b',"canonicalization_profile":"dcp-jcs-v9"'),
        "dup-manifest-empty-then-real": text.replace(b'"manifest":{', b'"manifest":{},"manifest":{', 1),
        "dup-bundle-empty-then-real": text.replace(b'{"bundle":{', b'{"bundle":{},"bundle":{', 1),
        "utf8-ff-in-intent": text[:action] + b"\xff" + text[action + 1:],
        "ufffd-literal-in-intent": text[:action] + b"\xef\xbf\xbd" + text[action + 1:],
        "trailing-comma": text[:-1] + b",}",
        "inf-unsigned": text[:-1] + b',"x":1e999}',
        "nan-unsigned": text[:-1] + b',"x":NaN}',
        "lone-surrogate-unsigned": text[:-1] + b',"x":"\\ud800"}',
        "inf-profile": text.replace(profile, b'"canonicalization_profile":1e999'),
        "nan-before-v1": text.replace(profile, b'"canonicalization_profile":NaN,' + profile),
        "inf-before-v1": text.replace(profile, b'"canonicalization_profile":1e999,' + profile),
    }
    dump = lambda o: json.dumps(o, separators=(",", ":"), ensure_ascii=False).encode()  # noqa: E731
    now_vectors = 1793491200000
    now_admission = rfc3339_epoch_ms(next(c for c in ADMISSION["cases"] if c["name"] == "A_known_principal_strict")["now"])
    inputs = [("signed_bundle", text, now_vectors), ("classical_only_routine_bundle", dump(VECTORS["classical_only_routine_bundle"]["signed_bundle"]), now_vectors)]
    inputs += [(f"accept {c['name']}", dump(c["signed_bundle"]), now_vectors) for c in VECTORS["must_accept_bundles"]]
    inputs += [(f"reject {c['name']}", dump(c["signed_bundle"]), now_vectors) for c in VECTORS["must_reject_bundles"]]
    inputs += [(f"admission {k}", dump(v), now_admission) for k, v in ADMISSION["signed_bundles"].items()]
    inputs += [(f"variant {k}", v, now_vectors) for k, v in variants.items()]
    return inputs


@pytest.mark.parametrize("name", list(PY_ADAPTERS))
def test_v1_parity_on_really_signed_bundles(name):
    adapter = PY_ADAPTERS[name]
    registry = AlgorithmRegistry()
    registry.register_signer(Ed25519Provider())
    registry.register_signer(MlDsa65Provider())
    r = router(adapter, "bare", ["dcp-jcs-v1"])
    inputs = _parity_inputs()

    async def verdict(value, now):
        try:
            return bool((await verify_signed_bundle_v2(value, registry, None, now_ms=now)).get("verified"))
        except Exception:  # noqa: BLE001 — the same object on both sides; an exception is not a verdict of acceptance
            return False

    async def run():
        differences, accepted = [], 0
        for label, data, now in inputs:
            try:
                today = adapter.decode(data)
                today_verdict = await verdict(today, now)
            except HistoricalDecodeFailure:
                today, today_verdict = None, False
            result = r.route(data)
            assert result.outcome != "candidate"
            routed = False
            if isinstance(result, RouteV1Path) and result.historical.ok:
                assert json.dumps(result.historical.decoded, sort_keys=True) == json.dumps(today, sort_keys=True)
                routed = await verdict(result.historical.decoded, now)
            if routed != today_verdict:
                differences.append(f"{label}: today {today_verdict}, routed {routed} ({result.outcome})")
            accepted += today_verdict
        return differences, accepted

    differences, accepted = asyncio.run(run())
    assert differences == []
    assert len(inputs) == 2 + len(VECTORS["must_accept_bundles"]) + len(VECTORS["must_reject_bundles"]) + 20 + 15
    assert accepted > 10


def test_a_historical_reading_never_selects_the_candidate():
    claims_v2 = HistoricalAdapter("claims-v2", lambda unit: {"bundle": {"manifest": {"canonicalization_profile": "dcp-jcs-v2"}}})
    r = router(claims_v2).route(b"\xef\xbb\xbf" + unit_with('"dcp-jcs-v2"'))
    assert (r.outcome, r.reject_class, r.offset) == ("reject", "BOM", 0)
    assert router(claims_v2).route(BOM_V1).reject_class == "BOM"


def test_the_adapter_is_consulted_only_when_needed():
    adapter = Counting(JSON_LOADS_BYTES)
    r = router(adapter)
    r.route(unit_with('"dcp-jcs-v2"'))
    r.route(unit_with('"DCP-JCS-V2"'))
    r.route(unit_with('"dcp-jcs-v2"', ',"x":1.5'))
    assert adapter.calls == 0
    r.route(unit_with('"dcp-jcs-v1"'))
    assert adapter.calls == 1
    r.route(BOM_V1)
    assert adapter.calls == 2


def test_adapter_failures_are_not_rejections_of_the_data():
    class NotDecoderOutput(dict):
        pass

    shared = {"a": 1}
    cyclic: list = []
    cyclic.append(cyclic)
    for bad in (object(), NotDecoderOutput(), {1: "x"}, {"a": shared, "b": shared}, cyclic, (1, 2), b"bytes"):
        with pytest.raises(ExperimentalCandidateAdapterError):
            router(HistoricalAdapter("custom", lambda unit, bad=bad: bad)).route(BOM_V1)

    def raises(unit):
        raise RuntimeError("synthetic")

    with pytest.raises(ExperimentalCandidateAdapterError):
        router(HistoricalAdapter("raises", raises)).route(BOM_V1)

    class Unprintable(HistoricalDecodeFailure):
        def __str__(self):
            raise RuntimeError("synthetic")

    def refuses_badly(unit):
        raise Unprintable()

    with pytest.raises(ExperimentalCandidateAdapterError):
        router(HistoricalAdapter("unprintable", refuses_badly)).route(BOM_V1)

    def refuses(unit):
        raise HistoricalDecodeFailure("no")

    assert router(HistoricalAdapter("refuses", refuses)).route(BOM_V1).reject_class == "BOM"
    odd = {"bundle": {"manifest": {}}, "x": [math.nan, math.inf, "\ud800"]}
    r = router(HistoricalAdapter("custom", lambda unit: odd)).route(BOM_V1)
    assert r.outcome == "v1_path" and r.profile_source == "historical" and r.historical.decoded is odd


def test_private_copies_of_the_bytes():
    original = BOM_V1
    data = bytearray(original)

    def mutating(unit):
        value = JSON_LOADS_BYTES.decode(unit)
        data[:] = b" " * len(data)  # the caller's buffer, mutated while the router decides
        return value

    r = router(HistoricalAdapter("mutating", mutating))
    first = r.route(data)
    assert first.outcome == "v1_path" and first.unit_bytes == original and isinstance(first.unit_bytes, bytes)
    second = r.route(original)
    assert second.outcome == "v1_path" and second.unit_bytes == original


def test_boundaries():
    env = router(JSON_LOADS_BYTES, "envelope")
    with pytest.raises(TypeError):
        env.route("{}")
    with pytest.raises(TypeError):
        extract_unit(b"{}", "header")
    r = env.route(b'{"signed_bundle":{"x":"\xff"}}')
    assert r.outcome == "reject" and (r.reject_class, r.offset, r.transport_offset) == ("UTF8_INVALID", 6, 23)  # json.loads refuses
    r = env.route(b'{"a":1,"signed_bundle":{"bundle":{"manifest":{"canonicalization_profile":"x"}}}}')
    assert (r.reject_class, r.offset, r.transport_offset, r.unit) == ("PROFILE_UNKNOWN", 50, 73, UnitRange(23, 79))
    r = env.route(b'{"signed_bundle":1,"signed_bundle":2}')
    assert (r.reject_class, r.offset, r.transport_offset, r.unit) == ("TRANSPORT_AMBIGUOUS", None, 19, None)
    assert env.route(b'{"other":1}').detail == "NO_SIGNED_BUNDLE"
    deep = b'{"signed_bundle":' + b"[" * 20000 + b"]" * 20000 + b"}"
    assert extract_unit(deep, "envelope") == UnitRange(17, 40017)
    r = env.route(deep)
    assert r.outcome == "v1_path" and r.profile_source == "absent"
    assert [(w.reject_class, w.offset, w.transport_offset) for w in r.warnings] == [("DEPTH_EXCEEDED", 64, 81)]
    assert not r.historical.ok  # json.loads hits the recursion limit: the real decoder refuses
