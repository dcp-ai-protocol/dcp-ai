"""EXPERIMENTAL candidate dcp-jcs-v2, phase 3: the bytes verifier against the public signed vectors
(tests/interop/candidate/phase3-signed-vectors.json), with both built-in historical adapters, and the
controls of the contract: the verifiers entered (one at most, counted by replacing the module's
references), parity of the delegation, the canonical bytes of every committed value, the profile policy,
a decoder refusal versus a decoded None, buffers the caller mutates, and today's API still refusing v2.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from pathlib import Path

import pytest

import dcp_ai.v2 as v2
from dcp_ai.providers.ed25519_provider import Ed25519Provider
from dcp_ai.providers.ml_dsa_65_provider import MlDsa65Provider
from dcp_ai.v2 import experimental_candidate_verify as ecv
from dcp_ai.v2.canonicalize import canonicalize_v2
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
    RouteV1Path,
)
from dcp_ai.v2.experimental_candidate_verify import create_verifier
from dcp_ai.v2.verify import DEFAULT_VERIFIER_POLICY, verify_signed_bundle_v2

ROOT = Path(__file__).resolve().parents[3]
VECTORS = json.loads((ROOT / "tests" / "interop" / "candidate" / "phase3-signed-vectors.json").read_text())
CASES = VECTORS["cases"]

# The 57 case IDs approved for phase 3, written here: the vectors must carry exactly these, each once.
APPROVED_IDS = (
    "P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08",
    "P09", "P10", "P11", "P12", "P13-800", "P13-801", "P13-5000", "P14",
    "R01", "R02", "R03", "R04", "R05a", "R05b-v2", "R06", "R07",
    "R08", "R09", "R10", "R11", "R12", "R13", "R14", "R15",
    "R16", "F01", "F02", "F03", "F04", "F05", "F06", "F07",
    "F08", "F09", "F10", "F11", "F12", "F13", "F14", "D01",
    "D02", "D03", "D04", "R05b-both", "D05", "D06", "D07", "D08",
    "D09",
)


def id_problem(ids) -> str | None:
    """Why ``ids`` is not exactly the approved set, each once (repeated, missing, unknown), or None."""
    seen: list[str] = []
    repeated = [i for i in ids if i in seen or seen.append(i)]
    missing = [i for i in APPROVED_IDS if i not in seen]
    unknown = [i for i in seen if i not in APPROVED_IDS]
    return None if not (repeated or missing or unknown) else json.dumps({"repeated": repeated, "missing": missing, "unknown": unknown})


# Checked when the module loads, before any case runs: a missing, repeated or unknown ID fails collection.
_problem = id_problem([c["id"] for c in CASES])
if _problem is not None:
    raise AssertionError(f"phase 3 vectors: not the approved case IDs: {_problem}")
NOW = VECTORS["now_ms"]
ADAPTERS = {"py:json_loads_bytes": JSON_LOADS_BYTES, "py:json_loads_strict_decode": JSON_LOADS_STRICT_DECODE}

REGISTRY = AlgorithmRegistry()
REGISTRY.register_signer(Ed25519Provider())
REGISTRY.register_signer(MlDsa65Provider())


def test_exactly_the_approved_ids_and_a_missing_repeated_or_unknown_one_is_refused():
    ids = [c["id"] for c in CASES]
    assert id_problem(ids) is None and id_problem(APPROVED_IDS) is None
    assert json.loads(id_problem([i for i in ids if i != "F07"]))["missing"] == ["F07"]
    assert json.loads(id_problem([*ids, "D03"]))["repeated"] == ["D03"]
    assert json.loads(id_problem(["P99" if i == "P05" else i for i in ids])) == {"repeated": [], "missing": ["P05"], "unknown": ["P99"]}


def case(case_id: str) -> dict:
    return next(c for c in CASES if c["id"] == case_id)


def policy_of(c: dict):
    """The default by omission, as a caller of today's API; any other policy as written in the file."""
    return None if c["verifier_policy"] == "default" else VECTORS["verifier_policies"][c["verifier_policy"]]


def input_of(c: dict) -> bytes:
    """The input of a case: its base, then each edit in order on the bytes."""
    buf = VECTORS["bases"][c["input"]["base"]]["input_json"].encode("latin-1")
    for e in c["input"]["edits"]:
        if "find" in e:
            find = e["find"].encode("latin-1")
            assert buf.count(find) == 1, f"{c['id']}: find must occur exactly once"
            by = e["replace"].encode("latin-1") if "replace" in e else bytes.fromhex(e["replace_hex"])
            buf = buf.replace(find, by)
        elif "prefix" in e:
            buf = e["prefix"].encode("latin-1") + buf + e["suffix"].encode("latin-1")
        elif "prefix_hex" in e:
            buf = bytes.fromhex(e["prefix_hex"]) + buf
        elif "drop_last" in e:
            buf = buf[: len(buf) - e["drop_last"]]
        else:
            raise AssertionError(f"{c['id']}: unknown edit {e}")
    return buf


class Count:
    """Counts the adapter calls and the verifiers entered, through the module's own references."""

    def __init__(self, monkeypatch, adapter: HistoricalAdapter):
        self.calls = 0
        self.entries: list[str] = []
        original_v1, original_v2 = ecv.verify_signed_bundle_v2, ecv._verify_signed_bundle_v2_with_profile

        async def v1(*args, **kwargs):
            self.entries.append("dcp-jcs-v1")
            return await original_v1(*args, **kwargs)

        async def v2_(*args, **kwargs):
            self.entries.append(args[4])
            return await original_v2(*args, **kwargs)

        monkeypatch.setattr(ecv, "verify_signed_bundle_v2", v1)
        monkeypatch.setattr(ecv, "_verify_signed_bundle_v2_with_profile", v2_)

        def decode(unit: bytes):
            self.calls += 1
            return adapter.decode(unit)

        self.adapter = HistoricalAdapter(adapter.name, decode)


def check_route(route, exp: dict) -> None:
    r = exp["route"]
    assert route.outcome == r["outcome"]
    if "class" in r:
        assert route.reject_class == r["class"]
    for key in ("detail", "offset", "profile"):
        if key in r:
            assert getattr(route, key) == r[key], key
    if "profile_source" in r:
        assert route.profile_source == r["profile_source"]
    if "warning_classes" in r:
        assert [w.reject_class for w in route.warnings] == r["warning_classes"]
    if "historical" in r:
        assert ("decoded" if route.historical.ok else "failed") == r["historical"]


def check_verification(verification, exp: dict) -> None:
    if exp["verification"] is None:
        assert verification is None
        return
    assert verification is not None
    assert verification["verified"] is exp["verification"]["verified"], verification["errors"]
    if exp["verification"]["verified"]:
        assert verification["errors"] == []
    for s in exp["verification"]["errors_contain"]["py"]:
        assert any(s in e for e in verification["errors"]), f"{s} in {verification['errors']}"


@pytest.mark.parametrize("name", list(ADAPTERS))
@pytest.mark.parametrize("c", CASES, ids=[c["id"] for c in CASES])
def test_signed_vectors(c, name, monkeypatch):
    exp = c.get("by_adapter", {}).get(name, c["expected"])
    data = input_of(c)
    assert hashlib.sha256(data).hexdigest() == c["input_sha256"]
    count = Count(monkeypatch, ADAPTERS[name])
    verifier = create_verifier(transport=c["transport"], accepted_profiles=c["accepted_profiles"], historical=count.adapter)
    r = asyncio.run(verifier.verify(data, REGISTRY, policy_of(c), now_ms=NOW))

    check_route(r.route, exp)
    assert count.calls == exp["adapter_calls"]
    assert r.entered == exp["entered"]
    assert count.entries == ([] if exp["entered"] == "none" else [exp["entered"]])
    check_verification(r.verification, exp)

    if isinstance(r.route, RouteCandidate) and "manifest_sha256" in exp:
        unit = r.route.value
        assert r.route.canonical_sha256 == exp["canonical_sha256"]
        assert "sha256:" + hashlib.sha256(canonicalize_v2(unit["bundle"]["manifest"]).encode()).hexdigest() == exp["manifest_sha256"]
        assert unit["signature"]["manifest_hash"] == exp["manifest_sha256"]

    # Delegation: exactly what a current caller gets by decoding the unit with the same decoder.
    if r.entered == "dcp-jcs-v1":
        decoded = ADAPTERS[name].decode(r.route.unit_bytes)
        monkeypatch.undo()
        assert r.verification == asyncio.run(verify_signed_bundle_v2(decoded, REGISTRY, policy_of(c), now_ms=NOW))


def same_exact(a, b) -> bool:
    """The same exact value: integers by value, never a bool for an integer."""
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(same_exact(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(same_exact(x, y) for x, y in zip(a, b))
    return type(a) is type(b) and a == b


def committed_values(unit: dict) -> list:
    """The unit, the manifest, the four payloads, the audit entries and the checkpoints without their
    signature, and every object or array inside them."""
    b = unit["bundle"]
    roots = [unit, b["manifest"], *(b[n]["payload"] for n in ("responsible_principal_record", "agent_passport", "intent", "policy_decision"))]
    roots += b["audit_entries"]
    roots += [{k: v for k, v in cp.items() if k != "composite_sig"} for cp in b.get("pq_checkpoints", [])]
    out: list = []

    def walk(v):
        if isinstance(v, dict):
            out.append(v)
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            out.append(v)
            for x in v:
                walk(x)

    for r in roots:
        walk(r)
    return out


POSITIVES = [c for c in CASES if "manifest_sha256" in c["expected"]]


def test_positives_cover_the_checkpoint():
    assert [c["id"] for c in POSITIVES] == [
        "P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P10", "P11", "P12",
        "P13-800", "P13-801", "P13-5000", "P14",
    ]


@pytest.mark.parametrize("c", POSITIVES, ids=[c["id"] for c in POSITIVES])
def test_canonical_bytes_of_every_committed_value(c):
    verifier = create_verifier(transport=c["transport"], accepted_profiles=c["accepted_profiles"], historical=JSON_LOADS_BYTES)
    r = asyncio.run(verifier.verify(input_of(c), REGISTRY, None, now_ms=NOW))
    assert isinstance(r.route, RouteCandidate)
    values = committed_values(r.route.value)
    if c["id"] == "P10":
        assert any(isinstance(v, dict) and "checkpoint_id" in v for v in values)
    for value in values:
        canonical = canonicalize_v2(value)
        again = experimental_candidate_ingress(canonical.encode("utf-8"))
        assert isinstance(again, CandidateIngressAccept)
        assert same_exact(again.value, value), canonical[:80]
        assert again.canonical.decode("utf-8") == canonical


def test_exact_integers_whatever_their_form():
    limits = {"exact_one": 1, "ten": 10, "hundred": 100, "zero": 0, "max_safe": 9007199254740991, "min_safe": -9007199254740991}
    for case_id in ("P04", "P13-800", "P13-801", "P13-5000", "P14"):
        c = case(case_id)
        verifier = create_verifier(transport="bare", accepted_profiles=c["accepted_profiles"], historical=JSON_LOADS_BYTES)
        r = asyncio.run(verifier.verify(input_of(c), REGISTRY, None, now_ms=NOW))
        assert same_exact(r.route.value["bundle"]["intent"]["payload"]["target"]["limits"], limits), case_id


@pytest.mark.parametrize("accepted", [None, [], ["dcp-jcs-v3"], ["dcp-jcs-v2", "dcp-jcs-v2"], "dcp-jcs-v2"])
def test_the_profile_policy_is_required_with_no_default(accepted):
    with pytest.raises(ExperimentalCandidateConfigError) as e:
        create_verifier(transport="bare", accepted_profiles=accepted, historical=JSON_LOADS_BYTES)
    assert e.value.code == "POLICY_INVALID"


def test_the_configuration_is_checked_before_any_input():
    with pytest.raises(ExperimentalCandidateConfigError):
        create_verifier(transport="bare", accepted_profiles=["dcp-jcs-v2"])
    with pytest.raises(ExperimentalCandidateConfigError):
        create_verifier(transport="framed", accepted_profiles=["dcp-jcs-v2"], historical=JSON_LOADS_BYTES)


def test_the_cryptographic_policy_keeps_todays_default():
    verifier = create_verifier(transport="bare", accepted_profiles=["dcp-jcs-v2"], historical=JSON_LOADS_BYTES)
    implicit = asyncio.run(verifier.verify(input_of(case("P01")), REGISTRY, None, now_ms=NOW))
    explicit = asyncio.run(verifier.verify(input_of(case("P01")), REGISTRY, DEFAULT_VERIFIER_POLICY, now_ms=NOW))
    assert implicit.verification == explicit.verification
    assert implicit.verification["verified"] is True


def test_a_decoder_refusal_is_not_delegated(monkeypatch):
    def refuse(_unit):
        raise HistoricalDecodeFailure("refused by the test")

    count = Count(monkeypatch, HistoricalAdapter("refuses", refuse))
    verifier = create_verifier(transport="bare", accepted_profiles=["dcp-jcs-v1"], historical=count.adapter)
    r = asyncio.run(verifier.verify(input_of(case("D01")), REGISTRY, None, now_ms=NOW))
    assert isinstance(r.route, RouteV1Path)
    assert not r.route.historical.ok and r.route.historical.failed == "refused by the test"
    assert (r.entered, r.verification, count.entries, count.calls) == ("none", None, [], 1)


def test_a_decoded_none_is_data_and_is_delegated(monkeypatch):
    count = Count(monkeypatch, HistoricalAdapter("decodes-none", lambda _unit: None))
    verifier = create_verifier(transport="bare", accepted_profiles=["dcp-jcs-v1"], historical=count.adapter)
    r = asyncio.run(verifier.verify(input_of(case("D01")), REGISTRY, None, now_ms=NOW))
    assert r.route.historical.ok and r.route.historical.decoded is None
    assert (r.entered, count.entries) == ("dcp-jcs-v1", ["dcp-jcs-v1"])
    assert r.verification["verified"] is False and "Malformed signed bundle" in " ".join(r.verification["errors"])
    monkeypatch.undo()
    assert r.verification == asyncio.run(verify_signed_bundle_v2(None, REGISTRY, None, now_ms=NOW))


def test_an_adapter_that_raises_is_an_adapter_error_and_no_verifier_runs(monkeypatch):
    def boom(_unit):
        raise RuntimeError("boom")

    count = Count(monkeypatch, HistoricalAdapter("raises", boom))
    verifier = create_verifier(transport="bare", accepted_profiles=["dcp-jcs-v1"], historical=count.adapter)
    with pytest.raises(ExperimentalCandidateAdapterError):
        verifier.verify(input_of(case("D01")), REGISTRY, None, now_ms=NOW)
    assert count.entries == []


def test_the_caller_mutating_its_buffer_after_the_call_changes_nothing():
    verifier = create_verifier(transport="bare", accepted_profiles=["dcp-jcs-v2"], historical=JSON_LOADS_BYTES)
    reference = asyncio.run(verifier.verify(input_of(case("P01")), REGISTRY, None, now_ms=NOW))
    data = bytearray(input_of(case("P01")))
    pending = verifier.verify(data, REGISTRY, None, now_ms=NOW)
    data[:] = b" " * len(data)
    r = asyncio.run(pending)
    assert r == reference and r.verification["verified"] is True
    assert hashlib.sha256(r.route.unit_bytes).hexdigest() == case("P01")["input_sha256"]


def test_todays_api_still_refuses_dcp_jcs_v2_also_given_the_exact_value():
    parsed = json.loads(input_of(case("P01")))
    r = asyncio.run(verify_signed_bundle_v2(parsed, REGISTRY, None, now_ms=NOW))
    assert r["verified"] is False and "Unknown canonicalization_profile: dcp-jcs-v2" in r["errors"]
    verifier = create_verifier(transport="bare", accepted_profiles=["dcp-jcs-v2"], historical=JSON_LOADS_BYTES)
    routed = asyncio.run(verifier.verify(input_of(case("P01")), REGISTRY, None, now_ms=NOW))
    exact = asyncio.run(verify_signed_bundle_v2(routed.route.value, REGISTRY, None, now_ms=NOW))
    assert exact["verified"] is False and "Unknown canonicalization_profile: dcp-jcs-v2" in exact["errors"]


def test_nothing_internal_is_exported():
    assert not hasattr(v2, "_verify_signed_bundle_v2_with_profile")
    assert "_verify_signed_bundle_v2_with_profile" not in getattr(v2, "__all__", [])
