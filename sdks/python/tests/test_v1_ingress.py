"""
Admission from bytes (MP-02 F3): tests/interop/v2/v1_ingress_vectors.json with the two candidate corpora it pins,
the signed bundles of delegated_admission_vectors.json, the private copy of the caller's bytes, and a parser fault
injected by these tests only. Mirrors sdks/typescript/src/__tests__/v1-ingress.test.ts.
"""

from __future__ import annotations

import array
import copy
import hashlib
import json
from pathlib import Path

import pytest

import dcp_ai.v2
from dcp_ai.providers import Ed25519Provider, MlDsa65Provider, SlhDsa192fProvider
from dcp_ai.v2 import AlgorithmRegistry, admit_signed_bundle_v2, admit_signed_bundle_v2_from_bytes
from dcp_ai.v2.experimental_candidate_ingress import CandidateIngressReject, experimental_candidate_ingress
from dcp_ai.v2.session_nonce import rfc3339_epoch_ms
from dcp_ai.v2.v1_ingress import _admit_from_bytes_with_parser

ROOT = Path(__file__).resolve().parents[3]
I = json.loads((ROOT / "tests" / "interop" / "v2" / "v1_ingress_vectors.json").read_text())
V = json.loads((ROOT / "tests" / "interop" / "v2" / "delegated_admission_vectors.json").read_text())
NOW = rfc3339_epoch_ms(V["now"])
sha = lambda b: hashlib.sha256(bytes(b)).hexdigest()  # noqa: E731


def new_registry(ed25519: Ed25519Provider | None = None) -> AlgorithmRegistry:
    r = AlgorithmRegistry()
    r.register_signer(ed25519 or Ed25519Provider())
    r.register_signer(MlDsa65Provider())
    r.register_signer(SlhDsa192fProvider())
    return r


REGISTRY = new_registry()


def strict() -> dict:
    return {
        "profile": copy.deepcopy(V["profiles"]["strict"]),
        "trust": copy.deepcopy(V["trust_sets"]["base"]),
        "revocation": copy.deepcopy(V["revocations"]["all_not_revoked"]),
        "now_ms": NOW,
    }


def parse_json(unit) -> object:
    return json.loads(str(unit, "utf-8"))


def unit_of(c: dict) -> bytes:
    return bytes.fromhex(c["input_hex"]) if "input_hex" in c else c["input_json"].encode("utf-8")


SOURCES = []
for s in I["sources"]:
    raw = (ROOT / s["path"]).read_bytes()
    cases = json.loads(raw)["cases"]
    if not s["path"].endswith("baseline-corpus.json"):
        cases = [c for c in cases if c.get("mode") == "document" and c.get("transport") == "bare"]
    SOURCES.append({**s, "bytes": raw, "cases": cases})
DIFFERENCES = {d["id"]: d for d in I["domain_differences"]}
SOURCE_CASES = [c for s in SOURCES for c in s["cases"]]


def test_reads_the_pinned_corpora():
    for s in SOURCES:
        assert sha(s["bytes"]) == s["sha256"]
        assert len(s["cases"]) == s["count"]
    assert [len(s["cases"]) for s in SOURCES] == [87, 81]
    assert len(DIFFERENCES) == 30
    ids = {c["id"] for c in SOURCE_CASES}
    assert set(DIFFERENCES) <= ids


@pytest.mark.asyncio
@pytest.mark.parametrize("c", SOURCE_CASES, ids=[c["id"] for c in SOURCE_CASES])
async def test_source_case(c):
    unit = unit_of(c)
    assert sha(unit) == c["input_sha256"]
    r = await admit_signed_bundle_v2_from_bytes(unit, REGISTRY)
    assert r["ingress"]["unit_sha256"] == c["input_sha256"]
    e = c["expected"]
    accepted = e == "accept" if isinstance(e, str) else e["result"] == "accept"
    if c["id"] in DIFFERENCES:
        d = DIFFERENCES[c["id"]]
        assert accepted  # the scanner accepts it; only the domain rejects
        assert d["input_sha256"] == c["input_sha256"]
        assert r["ingress"] == {"accepted": False, **d["expected"], "unit_sha256": c["input_sha256"], "canonical_sha256": None}
        assert r["admission"] is None
    elif not accepted:
        scanned = experimental_candidate_ingress(unit)
        assert isinstance(scanned, CandidateIngressReject)
        cls = c["reject_class"] if isinstance(e, str) else e["class"]
        assert scanned.reject_class == cls
        if not isinstance(e, str):
            assert scanned.offset == e["offset"]
        assert r["ingress"] == {"accepted": False, "layer": "scanner", "class": cls, "offset": scanned.offset,
                                "unit_sha256": c["input_sha256"], "canonical_sha256": None}
        assert r["admission"] is None
    else:
        canonical = c["canonical_sha256"] if isinstance(e, str) else e["canonical_sha256"]
        assert r["ingress"] == {"accepted": True, "layer": None, "class": None, "offset": None,
                                "unit_sha256": c["input_sha256"], "canonical_sha256": canonical}
        assert r["admission"]["verified"] is False
        assert r["admission"]["admitted"] is False


@pytest.mark.asyncio
@pytest.mark.parametrize("c", I["cases"], ids=[c["id"] for c in I["cases"]])
async def test_new_case(c):
    unit = c["input_json"].encode("utf-8")
    assert sha(unit) == c["input_sha256"]
    r = await admit_signed_bundle_v2_from_bytes(unit, REGISTRY)
    e = c["expected"]
    if e["ingress"] == "accept":
        assert sha(e["canonical"].encode("utf-8")) == e["canonical_sha256"]
        assert r["ingress"] == {"accepted": True, "layer": None, "class": None, "offset": None,
                                "unit_sha256": c["input_sha256"], "canonical_sha256": e["canonical_sha256"]}
        assert r["value"] == json.loads(c["input_json"])
        # not a signed bundle: admission runs over the value and rejects it, with no parser fault
        assert r["admission"]["verified"] is False
        assert r["admission"]["admitted"] is False
    else:
        assert r == {"ingress": {"accepted": False, "layer": e["layer"], "class": e["class"], "offset": e["offset"],
                                 "unit_sha256": c["input_sha256"], "canonical_sha256": None},
                     "admission": None, "value": None}


NAMES = list(V["signed_bundles"])


@pytest.mark.asyncio
async def test_sixteen_signed_bundles_and_orch_is_admitted():
    assert len(NAMES) == 16
    assert (await admit_signed_bundle_v2(copy.deepcopy(V["signed_bundles"]["orch"]), REGISTRY, **strict()))["admitted"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize("name", NAMES)
async def test_signed_bundle_same_admission_as_the_object_api(name):
    bundle = V["signed_bundles"][name]
    expected = await admit_signed_bundle_v2(copy.deepcopy(bundle), REGISTRY, **strict())
    compact = await admit_signed_bundle_v2_from_bytes(json.dumps(bundle, separators=(",", ":"), ensure_ascii=False).encode(), REGISTRY, **strict())
    indented = await admit_signed_bundle_v2_from_bytes(json.dumps(bundle, indent=2).encode(), REGISTRY, **strict())
    for r in (compact, indented):
        assert r["ingress"]["accepted"] is True
        assert r["admission"] == expected
        assert r["value"] == bundle
    assert indented["ingress"]["canonical_sha256"] == compact["ingress"]["canonical_sha256"]


@pytest.mark.asyncio
async def test_rejects_a_transport_that_rewrites_100_as_100_0_which_the_object_api_admits():
    text = json.dumps(V["signed_bundles"]["orch"], separators=(",", ":"))
    assert text.count('"risk_score":100,') == 1
    rewritten = text.replace('"risk_score":100,', '"risk_score":100.0,')
    via_object = await admit_signed_bundle_v2(json.loads(rewritten), REGISTRY, **strict())
    assert via_object["admitted"] is True
    r = await admit_signed_bundle_v2_from_bytes(rewritten.encode(), REGISTRY, **strict())
    assert r["ingress"]["accepted"] is False
    assert (r["ingress"]["layer"], r["ingress"]["class"], r["ingress"]["offset"]) == ("domain", "NUMBER_NOT_PORTABLE", rewritten.index("100.0"))
    assert r["admission"] is None


# ── the private copy ──

TEXT = json.dumps(V["signed_bundles"]["orch"], separators=(",", ":")).encode()
ORIGINAL_SHA = sha(TEXT)


def caller_bytearray():
    """The caller's own bytearray: the argument is the caller's object itself."""
    b = bytearray(TEXT)
    return b, b


def caller_memoryview():
    """A memoryview at offset 8 of a larger bytearray, between bytes that are not JSON."""
    backing = bytearray(b"X" * 8 + TEXT + b"X" * 8)
    return memoryview(backing)[8:8 + len(TEXT)], backing


def mutate_risk_score(backing: bytearray) -> None:
    at = backing.index(b'"risk_score":100,')
    backing[at:at + 17] = b'"risk_score":999,'


CALLERS = {"bytearray": caller_bytearray, "memoryview at offset 8": caller_memoryview}


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", CALLERS)
async def test_hashes_the_view_only(kind):
    data, backing = CALLERS[kind]()
    assert len(backing) >= len(TEXT)
    r = await admit_signed_bundle_v2_from_bytes(data, REGISTRY, **strict())
    assert r["ingress"]["unit_sha256"] == ORIGINAL_SHA
    assert r["admission"]["admitted"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", CALLERS)
async def test_the_callers_bytes_changed_just_before_parsing_do_not_reach_the_value(kind):
    data, backing = CALLERS[kind]()
    expected_admission = await admit_signed_bundle_v2(copy.deepcopy(V["signed_bundles"]["orch"]), REGISTRY, **strict())
    canonical = (await admit_signed_bundle_v2_from_bytes(TEXT, REGISTRY, **strict()))["ingress"]["canonical_sha256"]
    calls = {"n": 0}

    def mutate_then_parse(unit):
        calls["n"] += 1
        mutate_risk_score(backing)  # the caller's original buffer, not the argument
        return parse_json(unit)

    r = await _admit_from_bytes_with_parser(mutate_then_parse, data, REGISTRY, **strict())
    assert calls["n"] == 1
    assert b'"risk_score":999,' in bytes(backing)
    assert r["ingress"] == {"accepted": True, "layer": None, "class": None, "offset": None,
                            "unit_sha256": ORIGINAL_SHA, "canonical_sha256": canonical}
    assert r["value"] == V["signed_bundles"]["orch"]
    assert r["admission"] == expected_admission


@pytest.mark.asyncio
async def test_the_caller_changing_its_bytes_during_verification_or_after_the_call_changes_nothing():
    data, backing = caller_memoryview()
    calls = {"n": 0}

    class Tampering(Ed25519Provider):
        async def verify(self, message, signature, public_key_b64):
            if calls["n"] == 0:
                mutate_risk_score(backing)
            calls["n"] += 1
            return await super().verify(message, signature, public_key_b64)

    r = await admit_signed_bundle_v2_from_bytes(data, new_registry(Tampering()), **strict())
    assert calls["n"] > 0
    assert b'"risk_score":999,' in bytes(backing)
    assert r["ingress"]["unit_sha256"] == ORIGINAL_SHA
    assert r["admission"]["admitted"] is True
    before = copy.deepcopy(r)
    backing[:] = b" " * len(backing)
    assert r == before
    assert r["value"] == V["signed_bundles"]["orch"]


# ── a parser fault (injected by these tests only) ──

FAULT = {"accepted": False, "layer": "parser", "class": "INGRESS_PARSER_MISMATCH", "offset": None,
         "unit_sha256": ORIGINAL_SHA, "canonical_sha256": None}


@pytest.mark.asyncio
async def test_the_correct_parser_through_the_same_route_admits():
    r = await _admit_from_bytes_with_parser(parse_json, TEXT, REGISTRY, **strict())
    assert r["ingress"]["accepted"] is True
    assert r["admission"]["admitted"] is True


@pytest.mark.asyncio
async def test_a_parser_that_returns_another_value_is_a_local_fault_before_admission():
    r = await _admit_from_bytes_with_parser(lambda u: {**parse_json(u), "extra": 1}, TEXT, REGISTRY, **strict())
    assert r == {"ingress": FAULT, "admission": None, "value": None}


@pytest.mark.asyncio
async def test_a_parser_that_changes_a_number_to_a_non_integer_is_the_same_fault():
    r = await _admit_from_bytes_with_parser(lambda u: {"n": 1.5}, b'{"n":1}', REGISTRY)
    assert (r["ingress"]["accepted"], r["ingress"]["layer"], r["ingress"]["class"], r["ingress"]["offset"]) == \
        (False, "parser", "INGRESS_PARSER_MISMATCH", None)


@pytest.mark.asyncio
async def test_a_parser_that_throws_is_the_same_fault():
    def throwing(_unit):
        raise ValueError("broken parser")

    r = await _admit_from_bytes_with_parser(throwing, TEXT, REGISTRY, **strict())
    assert r == {"ingress": FAULT, "admission": None, "value": None}


def test_the_parser_hook_is_not_part_of_the_package_api():
    assert "admit_signed_bundle_v2_from_bytes" in dcp_ai.v2.__all__
    assert dcp_ai.v2.admit_signed_bundle_v2_from_bytes is admit_signed_bundle_v2_from_bytes
    assert not hasattr(dcp_ai.v2, "_admit_from_bytes_with_parser")
    import dcp_ai.v2.v1_ingress as module

    assert module.__all__ == ["admit_signed_bundle_v2_from_bytes"]


# ── arguments: nothing is converted ──

@pytest.mark.asyncio
@pytest.mark.parametrize("arg", [
    '{"n":1}',
    [123, 125],
    None,
    123,
    memoryview(array.array("i", [1, 2])),
    memoryview(bytearray(b"{}" * 2)).cast("B", shape=[2, 2]),
], ids=["str", "list of ints", "None", "int", "memoryview of ints", "two-dimensional memoryview"])
async def test_a_wrong_type_is_a_type_error(arg):
    with pytest.raises(TypeError):
        await admit_signed_bundle_v2_from_bytes(arg, REGISTRY)
