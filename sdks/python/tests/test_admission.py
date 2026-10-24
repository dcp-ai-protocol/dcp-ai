"""
Admission (spec/profiles/admission): the shared vectors in
tests/interop/v2/admission_vectors.json, through the public API, and what the
vectors cannot express. Mirrors sdks/typescript/src/__tests__/admission.test.ts.
"""

from __future__ import annotations

import copy
import json
import time
from collections import defaultdict
from pathlib import Path

import pytest

from dcp_ai.providers import Ed25519Provider, MlDsa65Provider
from dcp_ai.v2 import (
    DEFAULT_VERIFIER_POLICY,
    AdmissionConfigError,
    AlgorithmRegistry,
    PrincipalTrustStore,
    StrictV1Profile,
    admit_signed_bundle_v2,
    create_principal_trust_store,
    evaluate_admission_v2,
    resolve_strict_v1_profile,
    revocation_subjects,
    verify_signed_bundle_v2,
)
from dcp_ai.v2.session_nonce import rfc3339_epoch_ms

VECTORS = json.loads(
    (Path(__file__).resolve().parents[3] / "tests" / "interop" / "v2" / "admission_vectors.json").read_text()
)
RESULT_KEYS = {
    "verified",
    "verification",
    "principal_trust",
    "profile",
    "profile_compliance",
    "admitted",
    "action_authorized",
    "recorded_decision",
    "trust_set_version",
    "errors",
}


@pytest.fixture(scope="module")
def registry() -> AlgorithmRegistry:
    r = AlgorithmRegistry()
    r.register_signer(Ed25519Provider())
    r.register_signer(MlDsa65Provider())
    return r


def _case(name: str) -> dict:
    return next(c for c in VECTORS["cases"] if c["name"] == name)


def _base() -> dict:
    return copy.deepcopy(VECTORS["signed_bundles"]["base"])


CASE_A = _case("A_known_principal_strict")
NOW = rfc3339_epoch_ms(CASE_A["now"])


# ── Vectors ──


@pytest.mark.asyncio
@pytest.mark.parametrize("case", VECTORS["cases"], ids=lambda c: c["name"])
async def test_admission_vector(registry, case):
    result = await admit_signed_bundle_v2(
        copy.deepcopy(VECTORS["signed_bundles"][case["bundle"]]),
        registry,
        profile=VECTORS["profiles"][case["profile"]] if case["profile"] else None,
        trust=VECTORS["trust_sets"][case["trust"]] if case["trust"] else None,
        revocation=copy.deepcopy(case.get("revocation")),
        now_ms=rfc3339_epoch_ms(case["now"]),
    )
    assert set(result) == RESULT_KEYS
    assert {
        "verified": result["verified"],
        "principal_trust": result["principal_trust"],
        "profile_compliance": result["profile_compliance"],
        "admitted": result["admitted"],
        "recorded_decision": result["recorded_decision"],
        "action_authorized": result["action_authorized"],
        "codes": sorted({e["code"] for e in result["errors"]}),
    } == case["expected"], (case["rule"], result["errors"])
    assert result["profile"] == ("strict-v1" if case["profile"] else None)
    assert result["trust_set_version"] == (
        VECTORS["trust_sets"][case["trust"]]["trust_set_version"] if case["trust"] else None
    )


@pytest.mark.parametrize("case", VECTORS["config_cases"], ids=lambda c: c["name"])
def test_config_vector_is_refused(case):
    load = create_principal_trust_store if case["kind"] == "trust_set" else resolve_strict_v1_profile
    with pytest.raises(AdmissionConfigError) as caught:
        load(copy.deepcopy(case["config"]))
    assert caught.value.code == case["expected_code"]
    assert str(caught.value).startswith(f"{case['expected_code']}: ")


@pytest.mark.parametrize("case", VECTORS["accepted_profiles"], ids=lambda c: c["name"])
def test_accepted_profile_vector(case):
    profile = resolve_strict_v1_profile(copy.deepcopy(case["config"]))
    assert profile.max_session_duration_seconds == case["expected_max_session_duration_seconds"]
    assert profile.max_revocation_age_seconds == case["expected_max_revocation_age_seconds"]
    assert profile.policy["max_session_duration_seconds"] == case["expected_max_session_duration_seconds"]


# ── Admission API ──


@pytest.mark.asyncio
async def test_verifier_reports_the_key_of_each_signature_component(registry):
    result = await verify_signed_bundle_v2(_base(), registry, DEFAULT_VERIFIER_POLICY, now_ms=NOW)
    assert result["verified"], result["errors"]
    keys = result["details"]["signer_keys"]
    rpr_keys = _base()["bundle"]["responsible_principal_record"]["payload"]["binding_keys"]
    for signature in ("bundle", "responsible_principal_record"):
        assert [(k["component"], k["kid"], k["verified"]) for k in keys if k["signature"] == signature] == [
            ("classical", rpr_keys[0]["kid"], True),
            ("pq", rpr_keys[1]["kid"], True),
        ]
    # In the verifier's order: the bundle signature, then the four artifacts.
    assert [k["signature"] for k in keys][::2] == [
        "bundle", "responsible_principal_record", "agent_passport", "intent", "policy_decision",
    ]
    first = keys[0]
    assert set(first) == {"signature", "component", "kid", "alg", "public_key_b64", "verified"}
    assert (first["alg"], first["public_key_b64"]) == (rpr_keys[0]["alg"], rpr_keys[0]["public_key_b64"])


@pytest.mark.asyncio
async def test_a_component_that_fails_is_reported_unverified(registry):
    vector = _case("12_pq_signature_present_and_invalid")
    signed = copy.deepcopy(VECTORS["signed_bundles"][vector["bundle"]])
    result = await verify_signed_bundle_v2(signed, registry, DEFAULT_VERIFIER_POLICY, now_ms=NOW)
    assert not result["verified"]
    assert any(not k["verified"] for k in result["details"]["signer_keys"])


@pytest.mark.asyncio
async def test_without_now_ms_verification_uses_the_system_clock(registry, monkeypatch):
    # The base bundle's session runs from 10:00 to 10:05 on 2 November 2026: on the
    # system clock outside it, it does not verify; at the vector's now it does.
    assert (await verify_signed_bundle_v2(_base(), registry, DEFAULT_VERIFIER_POLICY, now_ms=NOW))["verified"]
    wall_clock = await verify_signed_bundle_v2(_base(), registry, DEFAULT_VERIFIER_POLICY)
    t = time.time_ns() // 1_000_000
    inside = rfc3339_epoch_ms("2026-11-02T09:59:30Z") <= t <= rfc3339_epoch_ms("2026-11-02T10:05:00Z")
    assert wall_clock["verified"] is inside

    # With the system clock set inside the session, and then after it.
    monkeypatch.setattr(time, "time_ns", lambda: NOW * 1_000_000)
    assert (await verify_signed_bundle_v2(_base(), registry, DEFAULT_VERIFIER_POLICY))["verified"]
    admitted = await admit_signed_bundle_v2(
        _base(), registry, profile=VECTORS["profiles"]["strict"], trust=VECTORS["trust_sets"]["principal"],
        revocation=CASE_A["revocation"],
    )
    assert admitted["admitted"], admitted["errors"]
    monkeypatch.setattr(time, "time_ns", lambda: (NOW + 3_600_000) * 1_000_000)
    late = await verify_signed_bundle_v2(_base(), registry, DEFAULT_VERIFIER_POLICY)
    assert not late["verified"] and any("expired" in e for e in late["errors"])


@pytest.mark.asyncio
async def test_now_ms_must_be_a_finite_number(registry):
    for bad in (float("nan"), float("inf"), "1", True):
        with pytest.raises(TypeError):
            await verify_signed_bundle_v2(_base(), registry, now_ms=bad)
        with pytest.raises(AdmissionConfigError) as caught:
            evaluate_admission_v2(_base(), {"verified": False}, now_ms=bad)
        assert caught.value.code == "CONFIG_INVALID_VALUE"


@pytest.mark.asyncio
async def test_revocation_subjects_are_the_agent_and_every_verified_signer_kid_sorted(registry):
    verification = await verify_signed_bundle_v2(_base(), registry, DEFAULT_VERIFIER_POLICY, now_ms=NOW)
    subjects = revocation_subjects(_base(), verification)
    assert subjects["agent_ids"] == ["agent:acme-bot"]
    assert subjects["kids"] == sorted({k["kid"] for k in verification["details"]["signer_keys"]})
    assert len(subjects["kids"]) == 4


def test_a_loaded_profile_cannot_be_mutated():
    profile = resolve_strict_v1_profile(VECTORS["profiles"]["strict"])
    assert isinstance(profile, StrictV1Profile)
    with pytest.raises(AttributeError):
        profile.max_session_duration_seconds = 3600  # type: ignore[misc]
    with pytest.raises(AttributeError):
        profile.policy = dict(DEFAULT_VERIFIER_POLICY)  # type: ignore[misc]
    with pytest.raises(TypeError):
        profile.policy["allow_v1_bundles"] = True  # type: ignore[index]
    with pytest.raises(TypeError):
        profile.policy["risk_overrides"]["low"] = "classical_only"  # type: ignore[index]
    with pytest.raises(AttributeError):
        profile.policy["accepted_pq_algs"].append("rsa")  # type: ignore[union-attr]
    expected = {
        "default_mode": "hybrid_required",
        "allow_v1_bundles": False,
        "require_session_binding": True,
        "require_session_expiry": True,
        "require_audience_binding": True,
        "verifier_id": VECTORS["verifier_id"],
        "max_session_duration_seconds": 300,
    }
    assert {k: profile.policy[k] for k in expected} == expected
    assert dict(profile.policy["risk_overrides"]) == dict.fromkeys(("low", "medium", "high"), "hybrid_required")
    # A loaded profile or trust store is taken as is; neither can be built around the loaders.
    assert resolve_strict_v1_profile(profile) is profile
    store = create_principal_trust_store(VECTORS["trust_sets"]["principal"])
    assert create_principal_trust_store(store) is store
    with pytest.raises(AttributeError):
        store.version = "other"  # type: ignore[misc]
    with pytest.raises(TypeError):
        PrincipalTrustStore(object(), "v", {})
    with pytest.raises(TypeError):
        StrictV1Profile(object(), "v", 300, 300, {})


def test_integer_limits_take_integral_floats_but_not_booleans():
    profile = resolve_strict_v1_profile({"profile": "strict-v1", "verifier_id": "v", "max_session_duration_seconds": 120.0})
    assert profile.max_session_duration_seconds == 120 and isinstance(profile.max_session_duration_seconds, int)
    for value in (True, 120.5, "120", None):
        with pytest.raises(AdmissionConfigError) as caught:
            resolve_strict_v1_profile({"profile": "strict-v1", "verifier_id": "v", "max_revocation_age_seconds": value})
        assert caught.value.code == "CONFIG_INVALID_VALUE"


@pytest.mark.asyncio
async def test_a_profile_without_a_trust_set_or_with_a_caller_policy_is_a_configuration_error(registry):
    verification = await verify_signed_bundle_v2(_base(), registry, DEFAULT_VERIFIER_POLICY, now_ms=NOW)
    with pytest.raises(AdmissionConfigError) as caught:
        evaluate_admission_v2(_base(), verification, profile=VECTORS["profiles"]["strict"], now_ms=NOW)
    assert caught.value.code == "CONFIG_PROFILE_CONTRADICTION"
    with pytest.raises(AdmissionConfigError) as caught:
        await admit_signed_bundle_v2(
            _base(), registry, profile=VECTORS["profiles"]["strict"], trust=VECTORS["trust_sets"]["principal"],
            policy=DEFAULT_VERIFIER_POLICY, now_ms=NOW,
        )
    assert caught.value.code == "CONFIG_PROFILE_CONTRADICTION"


@pytest.mark.asyncio
async def test_a_verification_under_a_permissive_policy_is_not_compliant_with_the_profile(registry):
    # The caller passed the result of a classical_only verification: the profile notices.
    permissive = {
        **DEFAULT_VERIFIER_POLICY,
        "default_mode": "classical_only",
        "risk_overrides": dict.fromkeys(("low", "medium", "high"), "classical_only"),
    }
    verification = await verify_signed_bundle_v2(_base(), registry, permissive, now_ms=NOW)
    result = evaluate_admission_v2(
        _base(),
        verification,
        profile=VECTORS["profiles"]["strict"],
        trust=VECTORS["trust_sets"]["principal"],
        revocation=CASE_A["revocation"],
        now_ms=NOW,
    )
    assert result["admitted"] is False
    assert "PROFILE_HYBRID_REQUIRED" in [e["code"] for e in result["errors"]]


@pytest.mark.asyncio
async def test_the_profile_policy_verifies_as_is(registry):
    profile = resolve_strict_v1_profile(VECTORS["profiles"]["strict"])
    verification = await verify_signed_bundle_v2(_base(), registry, profile.policy, now_ms=NOW)
    assert verification["verified"], verification["errors"]
    assert verification["details"]["verification_mode"] == "hybrid_required"


@pytest.mark.asyncio
async def test_action_authorized_is_false_even_for_an_admitted_approve_decision(registry):
    result = await admit_signed_bundle_v2(
        _base(),
        registry,
        profile=VECTORS["profiles"]["strict"],
        trust=VECTORS["trust_sets"]["principal"],
        revocation=CASE_A["revocation"],
        now_ms=NOW,
    )
    assert result["admitted"] is True
    assert result["recorded_decision"] == "approve"
    assert result["action_authorized"] is False


@pytest.mark.asyncio
async def test_error_messages_are_bounded_and_carry_no_key_material(registry):
    huge = _base()
    huge["bundle"]["responsible_principal_record"]["payload"]["human_id"] = "x" * 100_000
    result = await admit_signed_bundle_v2(huge, registry, trust=VECTORS["trust_sets"]["principal"], now_ms=NOW)
    assert result["errors"]
    for error in result["errors"]:
        assert len(error["message"]) <= 501
    text = json.dumps(result["errors"])
    for key in VECTORS["trust_sets"]["principal"]["principals"][0]["keys"]:
        assert key["public_key_b64"] not in text

    # The same with a verification that reports the long identifier as verified.
    verification = await verify_signed_bundle_v2(_base(), registry, DEFAULT_VERIFIER_POLICY, now_ms=NOW)
    result = evaluate_admission_v2(huge, verification, trust=VECTORS["trust_sets"]["principal"], now_ms=NOW)
    assert [e["code"] for e in result["errors"]] == ["TRUST_PRINCIPAL_UNKNOWN"]
    assert len(result["errors"][0]["message"]) <= 501
    text = json.dumps(result["errors"])
    for key in VECTORS["trust_sets"]["principal"]["principals"][0]["keys"]:
        assert key["public_key_b64"] not in text


@pytest.mark.asyncio
async def test_special_keys_do_not_fool_the_lookups(registry):
    verification = await verify_signed_bundle_v2(_base(), registry, DEFAULT_VERIFIER_POLICY, now_ms=NOW)
    trust = VECTORS["trust_sets"]["principal"]
    for human_id in ("__proto__", "constructor", "toString", "__class__", "__dict__", "get"):
        bundle = _base()
        bundle["bundle"]["responsible_principal_record"]["payload"]["human_id"] = human_id
        result = evaluate_admission_v2(bundle, verification, trust=trust, now_ms=NOW)
        assert result["principal_trust"] == "untrusted"
        assert [e["code"] for e in result["errors"]] == ["TRUST_PRINCIPAL_UNKNOWN"]

    # A snapshot map that answers not_revoked for any subject it does not hold still
    # leaves those subjects unknown.
    strict = resolve_strict_v1_profile(VECTORS["profiles"]["strict"])
    verification = await verify_signed_bundle_v2(_base(), registry, strict.policy, now_ms=NOW)
    snapshot = copy.deepcopy(CASE_A["revocation"])
    snapshot["agents"] = defaultdict(lambda: "not_revoked")
    result = evaluate_admission_v2(
        _base(), verification, profile=VECTORS["profiles"]["strict"], trust=trust, revocation=snapshot, now_ms=NOW,
    )
    assert "REVOCATION_UNKNOWN" in [e["code"] for e in result["errors"]]
    assert result["admitted"] is False

    # Subjects named like special keys are unknown unless listed.
    for subject in ("__proto__", "constructor", "hasOwnProperty"):
        snapshot = copy.deepcopy(CASE_A["revocation"])
        snapshot["agents"] = {subject: "not_revoked"}
        result = evaluate_admission_v2(
            _base(), verification, profile=VECTORS["profiles"]["strict"], trust=trust, revocation=snapshot,
            now_ms=NOW,
        )
        assert [e["code"] for e in result["errors"]] == ["REVOCATION_UNKNOWN"]


@pytest.mark.asyncio
async def test_a_trust_set_status_outranks_the_bundle(registry):
    # The bundle lists its keys as active; the trust set's revoked status decides.
    result = await admit_signed_bundle_v2(
        _base(), registry, trust=VECTORS["trust_sets"]["classical_revoked"], now_ms=NOW,
    )
    assert result["verified"] is True
    assert result["admitted"] is False
    # Once for each principal signature the revoked classical key verified.
    assert [e["code"] for e in result["errors"]] == ["TRUST_KEY_REVOKED", "TRUST_KEY_REVOKED"]
