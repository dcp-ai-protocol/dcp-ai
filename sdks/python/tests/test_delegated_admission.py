"""
Delegated admission (MP-02 F2): the shared vectors of tests/interop/v2/delegated_admission_vectors.json through
the public API, and what the vectors cannot express: the internal floor against the public verifier, the
snapshot of the inputs, JSON-only evidence, loaded and raw configuration, JSON Schema integers, and the
verifier policy and mandate preflight against their schemas. Mirrors
sdks/typescript/src/__tests__/delegated-admission.test.ts.
"""

from __future__ import annotations

import copy
import json
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path
from types import MappingProxyType

import pytest

from dcp_ai.providers import Ed25519Provider, MlDsa65Provider, SlhDsa192fProvider
from dcp_ai.v2 import (
    DEFAULT_VERIFIER_POLICY,
    PQ_ONLY_VERIFIER_POLICY,
    AdmissionConfigError,
    AlgorithmRegistry,
    admit_delegated_bundle_v2,
    admit_signed_bundle_v2,
    create_principal_trust_store,
    resolve_strict_v1_profile,
    verify_signed_bundle_v2,
)
from dcp_ai.v2.delegated_admission import (
    MANDATE_FIELDS,
    MANDATE_REQUIRED,
    POLICY_FIELDS,
    POLICY_REQUIRED,
    SCOPE_FIELDS,
    SCOPE_REQUIRED,
    SUB_DELEGATION_FIELDS,
)
from dcp_ai.v2.session_nonce import rfc3339_epoch_ms
from dcp_ai.v2.verify import _verify_signed_bundle_v2_with_profile

ROOT = Path(__file__).resolve().parents[3]
V = json.loads((ROOT / "tests" / "interop" / "v2" / "delegated_admission_vectors.json").read_text())
POLICY_SCHEMA = json.loads((ROOT / "schemas" / "v2" / "verifier_policy.schema.json").read_text())
MANDATE_SCHEMA = json.loads((ROOT / "schemas" / "v2" / "delegation_mandate.schema.json").read_text())
NOW = rfc3339_epoch_ms(V["now"])
CASES = {c["name"]: c for c in V["cases"]}


def new_registry(ed25519: Ed25519Provider | None = None) -> AlgorithmRegistry:
    r = AlgorithmRegistry()
    r.register_signer(ed25519 or Ed25519Provider())
    r.register_signer(MlDsa65Provider())
    r.register_signer(SlhDsa192fProvider())
    return r


REGISTRY = new_registry()


def operator_of(c: dict) -> dict:
    operator = {
        "trust": copy.deepcopy(V["trust_sets"][c["trust"]]),
        "revocation": copy.deepcopy(V["revocations"][c["revocation"]]) if c["revocation"] else None,
        "mandate_revocation": copy.deepcopy(V["mandate_revocations"][c["mandate_revocation"]]) if c["mandate_revocation"] else None,
        "now_ms": NOW,
    }
    if c["profile"]:
        operator["profile"] = copy.deepcopy(V["profiles"][c["profile"]])
    if c["policy"]:
        operator["policy"] = copy.deepcopy(V["policies"][c["policy"]])
    if c["max_revocation_age_seconds"] is not None:
        operator["max_revocation_age_seconds"] = c["max_revocation_age_seconds"]
    return operator


def evidence_of(c: dict) -> dict:
    return {
        "signed_bundle": copy.deepcopy(V["signed_bundles"][c["leaf"]]),
        "mandate_chain": [copy.deepcopy(V["mandates"][n]) for n in c["chain"]],
        "delegator_bundles": [copy.deepcopy(V["signed_bundles"][n]) for n in c["delegators"]],
    }


def codes(result: dict) -> list[str]:
    return sorted({e["code"] for e in result["errors"]})


def test_vectors_cover_every_group_but_ack():
    assert sorted({c["group"] for c in V["cases"]}) == ["ALG", "DELEG", "PISO", "POS", "PRIN", "REV", "ROT", "SIG", "TIME"]
    assert len(V["cases"]) == 71 and len(V["config_cases"]) == 6


@pytest.mark.asyncio
@pytest.mark.parametrize("case", V["cases"], ids=[f"{c['group']}-{c['name']}" for c in V["cases"]])
async def test_delegated_admission_vector(case):
    result = await admit_delegated_bundle_v2(evidence_of(case), REGISTRY, operator_of(case))
    expected = case["expected"]
    assert result["admitted"] is expected["admitted"]
    assert result["delegation_verified"] is expected["delegation_verified"]
    assert codes(result) == sorted(expected["codes"])
    assert result["activation"] == "not_evaluated"
    assert result["delegation_active"] is False
    assert result["action_authorized"] is False
    if "security_tier" in expected:
        assert result["security_tier"] == expected["security_tier"]
    if "verification_mode" in expected:
        assert result["verification_mode"] == expected["verification_mode"]
    if "effective_floor" in expected:
        assert (result["chain"] or {}).get("effective_floor") == expected["effective_floor"]
    if "control_public_admitted" in case:
        public = await admit_signed_bundle_v2(
            copy.deepcopy(V["signed_bundles"][case["leaf"]]),
            REGISTRY,
            policy=copy.deepcopy(V["policies"][case["policy"]]),
            trust=copy.deepcopy(V["trust_sets"][case["trust"]]),
            now_ms=NOW,
        )
        assert public["admitted"] is case["control_public_admitted"]


@pytest.mark.asyncio
@pytest.mark.parametrize("case", V["config_cases"], ids=[c["name"] for c in V["config_cases"]])
async def test_delegated_admission_config(case):
    o = case["operator"]
    operator = {
        "revocation": copy.deepcopy(V["revocations"]["all_not_revoked"]),
        "mandate_revocation": copy.deepcopy(V["mandate_revocations"]["all_not_revoked"]),
        "now_ms": NOW,
    }
    if "trust" in o:
        operator["trust"] = copy.deepcopy(V["trust_sets"][o["trust"]])
    if "profile" in o:
        operator["profile"] = copy.deepcopy(V["profiles"][o["profile"]])
    if "policy" in o:
        operator["policy"] = copy.deepcopy(V["policies"][o["policy"]])
    if "max_revocation_age_seconds" in o:
        operator["max_revocation_age_seconds"] = o["max_revocation_age_seconds"]
    with pytest.raises(AdmissionConfigError) as info:
        await admit_delegated_bundle_v2(
            {"signed_bundle": copy.deepcopy(V["signed_bundles"]["orch"]), "mandate_chain": [copy.deepcopy(V["mandates"]["root"])]},
            REGISTRY,
            operator,
        )
    assert info.value.code == case["expected_code"]


@pytest.mark.asyncio
async def test_inputs_are_left_unchanged():
    c = CASES["depth_two"]
    evidence, operator = evidence_of(c), operator_of(c)
    before = copy.deepcopy((evidence, operator))
    await admit_delegated_bundle_v2(evidence, REGISTRY, operator)
    assert (evidence, operator) == before


# ── The floor reaches the verification (design 1.4) ──


@pytest.mark.asyncio
async def test_internal_floor_rejects_what_the_public_verifier_accepts():
    weak = V["policies"]["weak_classical"]
    bundle = V["signed_bundles"]["orch_classical_only"]
    public = await verify_signed_bundle_v2(copy.deepcopy(bundle), REGISTRY, copy.deepcopy(weak), now_ms=NOW)
    assert public["verified"] is True
    assert public["details"]["verification_mode"] == "classical_only"
    floored = await _verify_signed_bundle_v2_with_profile(
        copy.deepcopy(bundle), REGISTRY, copy.deepcopy(weak), NOW, "dcp-jcs-v1", tier_floor="elevated"
    )
    assert floored["verified"] is False
    assert floored["details"]["verification_mode"] == "hybrid_required"
    assert floored["details"]["resolved_tier"] == "elevated"


@pytest.mark.asyncio
async def test_no_floor_gives_the_public_result_for_every_fixture():
    for name, bundle in V["signed_bundles"].items():
        for policy in (DEFAULT_VERIFIER_POLICY, V["policies"]["weak_classical"], PQ_ONLY_VERIFIER_POLICY):
            public = await verify_signed_bundle_v2(copy.deepcopy(bundle), REGISTRY, copy.deepcopy(policy), now_ms=NOW)
            internal = await _verify_signed_bundle_v2_with_profile(
                copy.deepcopy(bundle), REGISTRY, copy.deepcopy(policy), NOW, "dcp-jcs-v1", tier_floor=None
            )
            assert internal == public, name


# ── Snapshot (design 1.3 step 0) ──


@pytest.mark.asyncio
async def test_changes_after_the_snapshot_are_ignored():
    c = CASES["principal_orchestrator_subagent"]
    baseline = await admit_delegated_bundle_v2(evidence_of(c), REGISTRY, operator_of(c))
    assert baseline["admitted"] is True

    evidence, operator = evidence_of(c), operator_of(c)
    calls = {"n": 0}

    class Tampering(Ed25519Provider):
        async def verify(self, message, signature, public_key_b64):
            if calls["n"] == 0:
                evidence["mandate_chain"][1]["agent_id"] = "agent:intruder"
                evidence["signed_bundle"]["bundle"] = None
                evidence["delegator_bundles"].clear()
                operator["trust"]["principals"] = []
                operator["profile"]["verifier_id"] = "verifier:other"
                operator["revocation"]["agents"]["agent:acme-subagent"] = "revoked"
                operator["mandate_revocation"]["mandates"]["mandate:acme-sub"] = "revoked"
            calls["n"] += 1
            return await super().verify(message, signature, public_key_b64)

    result = await admit_delegated_bundle_v2(evidence, new_registry(Tampering()), operator)
    assert calls["n"] > 0
    assert result["admitted"] is True
    assert codes(result) == []
    assert result["inputs"] == baseline["inputs"]


@pytest.mark.asyncio
async def test_loaded_configuration_is_used_as_is_and_raw_is_loaded():
    c = CASES["principal_orchestrator_subagent"]
    loaded = {
        **operator_of(c),
        "trust": create_principal_trust_store(copy.deepcopy(V["trust_sets"][c["trust"]])),
        "profile": resolve_strict_v1_profile(copy.deepcopy(V["profiles"][c["profile"]])),
    }
    from_loaded = await admit_delegated_bundle_v2(evidence_of(c), REGISTRY, loaded)
    from_raw = await admit_delegated_bundle_v2(evidence_of(c), REGISTRY, operator_of(c))
    assert from_loaded["admitted"] is True
    assert codes(from_loaded) == codes(from_raw)


# ── Evidence is JSON data only ──


class _Thing:
    pass


def _invalid_evidence():
    c = CASES["root_only"]

    def with_bundle(value):
        e = evidence_of(c)
        e["signed_bundle"] = value
        return e

    def with_mandate_field(field, value):
        e = evidence_of(c)
        e["mandate_chain"][0][field] = value
        return e

    e = evidence_of(c)
    cyclic = e["mandate_chain"][0]
    cyclic["self"] = cyclic
    return [
        ("a tuple", with_mandate_field("authority_scope", tuple(evidence_of(c)["mandate_chain"][0]["authority_scope"]))),
        ("a set", with_mandate_field("revocable", {True})),
        ("bytes", with_mandate_field("mandate_id", b"mandate:acme-root")),
        ("a MappingProxyType", with_bundle(MappingProxyType(evidence_of(c)["signed_bundle"]))),
        ("a dict subclass", with_bundle(OrderedDict(evidence_of(c)["signed_bundle"]))),
        ("a non-string key", with_mandate_field(1, "x")),
        ("NaN", with_mandate_field("delegation_depth", float("nan"))),
        ("a datetime", with_mandate_field("timestamp", datetime.now(timezone.utc))),
        ("an object", with_mandate_field("revocable", _Thing())),
        ("a cycle", e),
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("what,evidence", _invalid_evidence(), ids=[w for w, _ in _invalid_evidence()])
async def test_evidence_that_is_not_json_data_is_rejected(what, evidence):
    result = await admit_delegated_bundle_v2(evidence, REGISTRY, operator_of(CASES["root_only"]))
    assert result["admitted"] is False
    assert codes(result) == ["DELEGATION_INPUT_INVALID"], what


# ── JSON Schema integers: an integral float is one, a bool is not ──


@pytest.mark.asyncio
async def test_an_integral_float_depth_is_an_integer_and_a_bool_is_not():
    c = CASES["principal_orchestrator_subagent"]
    floats = evidence_of(c)
    floats["mandate_chain"][1]["delegation_depth"] = 1.0  # canonicalizes as 1: the signature still verifies
    floats["mandate_chain"][0]["sub_delegation"]["max_depth"] = 2.0
    assert (await admit_delegated_bundle_v2(floats, REGISTRY, operator_of(c)))["admitted"] is True
    for field, edit in (
        ("delegation_depth", lambda e: e["mandate_chain"][1].__setitem__("delegation_depth", True)),
        ("max_depth", lambda e: e["mandate_chain"][0]["sub_delegation"].__setitem__("max_depth", True)),
    ):
        e = evidence_of(c)
        edit(e)
        result = await admit_delegated_bundle_v2(e, REGISTRY, operator_of(c))
        assert codes(result) == ["DELEGATION_CHAIN_INVALID"], field


@pytest.mark.asyncio
async def test_max_revocation_age_follows_json_schema_integers():
    c = CASES["no_floor_weak_policy"]
    evidence = evidence_of(c)
    assert (await admit_delegated_bundle_v2(evidence, REGISTRY, {**operator_of(c), "max_revocation_age_seconds": 300.0}))["admitted"] is True
    for bad in (True, 300.5, "300"):
        with pytest.raises(AdmissionConfigError) as info:
            await admit_delegated_bundle_v2(evidence_of(c), REGISTRY, {**operator_of(c), "max_revocation_age_seconds": bad})
        assert info.value.code == "CONFIG_INVALID_VALUE"


# ── Verifier policy without a profile (schemas/v2/verifier_policy.schema.json) ──


def test_policy_checker_has_the_members_types_and_bounds_of_the_schema():
    props = POLICY_SCHEMA["properties"]
    assert POLICY_SCHEMA["additionalProperties"] is False
    assert sorted(POLICY_FIELDS) == sorted(props)
    assert sorted(POLICY_REQUIRED) == sorted(POLICY_SCHEMA["required"])
    modes = props["default_mode"]["enum"]
    for name, (kind, minimum, min_items) in POLICY_FIELDS.items():
        s = props[name]
        if kind == "mode":
            assert s == {"type": "string", "enum": modes}
        elif kind == "risk_overrides":
            assert s["additionalProperties"] is False
            assert s["required"] == ["low", "medium", "high"]
            assert all(s["properties"][t] == {"type": "string", "enum": modes} for t in ("low", "medium", "high"))
        elif kind == "string_array":
            assert s["type"] == "array" and s["items"] == {"type": "string"}
            assert s.get("minItems") == min_items
        else:
            assert s["type"] == kind
            assert s.get("minimum") == minimum


async def _with_policy(policy):
    c = CASES["no_floor_weak_policy"]
    return await admit_delegated_bundle_v2(evidence_of(c), REGISTRY, {**operator_of(c), "policy": policy})


@pytest.mark.asyncio
async def test_policy_presets_and_integral_floats_are_accepted():
    for preset in (DEFAULT_VERIFIER_POLICY, PQ_ONLY_VERIFIER_POLICY, V["policies"]["weak_classical"]):
        await _with_policy(copy.deepcopy(preset))
    result = await _with_policy({**copy.deepcopy(V["policies"]["weak_classical"]), "max_key_age_days": 365.0, "min_pq": 1.0})
    assert result["admitted"] is True


MALFORMED_POLICIES = [
    ("require_session_binding 0 (independent review R2)", {"require_session_binding": 0}, "CONFIG_INVALID_VALUE"),
    ("an unknown member (independent review R2)", {"unknown_setting": True}, "CONFIG_UNKNOWN_FIELD"),
    ('max_key_age_days "365" (independent review R2)', {"max_key_age_days": "365"}, "CONFIG_INVALID_VALUE"),
    ("max_key_age_days true: a bool is not an integer", {"max_key_age_days": True}, "CONFIG_INVALID_VALUE"),
    ("min_pq false: a bool is not an integer", {"min_pq": False}, "CONFIG_INVALID_VALUE"),
    ("an unknown mode", {"default_mode": "hybrid"}, "CONFIG_INVALID_VALUE"),
    ("a risk tier missing", {"risk_overrides": {"low": "classical_only", "medium": "classical_only"}}, "CONFIG_INVALID_VALUE"),
    (
        "an unknown risk tier",
        {"risk_overrides": {"low": "classical_only", "medium": "classical_only", "high": "classical_only", "extreme": "pq_only"}},
        "CONFIG_UNKNOWN_FIELD",
    ),
    ("a negative minimum", {"min_pq": -1}, "CONFIG_INVALID_VALUE"),
    ("an empty classical list", {"accepted_classical_algs": []}, "CONFIG_INVALID_VALUE"),
    ("a list with a non-string", {"accepted_pq_algs": ["ml-dsa-65", 1]}, "CONFIG_INVALID_VALUE"),
    ("a tuple instead of a list", {"accepted_pq_algs": ("ml-dsa-65",)}, "CONFIG_INVALID_VALUE"),
    ("max_key_age_days 0", {"max_key_age_days": 0}, "CONFIG_INVALID_VALUE"),
    ("a fractional integer", {"max_session_duration_seconds": 1.5}, "CONFIG_INVALID_VALUE"),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("what,change,code", MALFORMED_POLICIES, ids=[w for w, _, _ in MALFORMED_POLICIES])
async def test_malformed_policy_is_refused(what, change, code):
    with pytest.raises(AdmissionConfigError) as info:
        await _with_policy({**copy.deepcopy(V["policies"]["weak_classical"]), **change})
    assert info.value.code == code


# ── The policy contract (R4): no control the verifiers do not apply ──

_WEAK = V["policies"]["weak_classical"]

CONTRACT_ACCEPTED = [
    ("weak_classical with reversed hashes", "no_floor_weak_policy", {**_WEAK, "accepted_hash_algs": ["sha384", "sha256"]}),
    ("DEFAULT with reversed hashes", "no_floor_weak_policy", {**DEFAULT_VERIFIER_POLICY, "accepted_hash_algs": ["sha384", "sha256"]}),
    ("the PQ_ONLY preset with reversed hashes", "pq_only_stays_with_routine_floor", {**PQ_ONLY_VERIFIER_POLICY, "accepted_hash_algs": ["sha384", "sha256"]}),
    ("integral floats", "no_floor_weak_policy", {**_WEAK, "min_pq": 1.0, "min_classical": 1.0, "max_key_age_days": 365.0}),
    ("the PQ_ONLY preset with min_classical 0.0", "pq_only_stays_with_routine_floor", {**PQ_ONLY_VERIFIER_POLICY, "min_classical": 0.0}),
    ("max_session_duration_seconds 0", "no_floor_weak_policy", {**_WEAK, "max_session_duration_seconds": 0}),
    ("max_session_duration_seconds 2147483647", "no_floor_weak_policy", {**_WEAK, "max_session_duration_seconds": 2147483647}),
    ("max_session_duration_seconds 300.0", "no_floor_weak_policy", {**_WEAK, "max_session_duration_seconds": 300.0}),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("what,case,policy", CONTRACT_ACCEPTED, ids=[w for w, _, _ in CONTRACT_ACCEPTED])
async def test_policy_contract_admits(what, case, policy):
    c = CASES[case]
    result = await admit_delegated_bundle_v2(evidence_of(c), REGISTRY, {**operator_of(c), "policy": copy.deepcopy(policy)})
    assert result["admitted"] is True, what


CONTRACT_REFUSED = [
    ("min_pq 2 (R4)", {"min_pq": 2}),
    ("min_classical 2 (R4)", {"min_classical": 2}),
    ("accepted_hash_algs sha384 (R4)", {"accepted_hash_algs": ["sha384"]}),
    ("max_key_age_days 1 (R4)", {"max_key_age_days": 1}),
    ("max_key_age_days 364", {"max_key_age_days": 364}),
    ("min_pq 0", {"min_pq": 0}),
    ("min_classical 0 outside pq_only", {"min_classical": 0}),
    ("require_composite_binding false outside pq_only", {"require_composite_binding": False}),
    ("require_session_binding false", {"require_session_binding": False}),
    ("accepted_hash_algs sha256 twice", {"accepted_hash_algs": ["sha256", "sha256"]}),
    ("accepted_hash_algs with a third", {"accepted_hash_algs": ["sha256", "sha384", "sha512"]}),
    ("max_session_duration_seconds 2147483648", {"max_session_duration_seconds": 2147483648}),
    ("max_session_duration_seconds 2147483648.0", {"max_session_duration_seconds": 2147483648.0}),
    ("max_session_duration_seconds -1", {"max_session_duration_seconds": -1}),
    ("max_session_duration_seconds True", {"max_session_duration_seconds": True}),
    ("max_session_duration_seconds 1.5", {"max_session_duration_seconds": 1.5}),
    ("min_pq True: a bool is not 1", {"min_pq": True}),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("what,change", CONTRACT_REFUSED, ids=[w for w, _ in CONTRACT_REFUSED])
async def test_policy_contract_refuses(what, change):
    with pytest.raises(AdmissionConfigError) as info:
        await _with_policy({**copy.deepcopy(_WEAK), **change})
    assert info.value.code == "CONFIG_INVALID_VALUE", what


@pytest.mark.asyncio
async def test_policy_contract_refuses_binding_false_when_one_mode_is_not_pq_only():
    c = CASES["pq_only_stays_with_routine_floor"]
    policy = {**copy.deepcopy(PQ_ONLY_VERIFIER_POLICY), "risk_overrides": {"low": "pq_only", "medium": "pq_only", "high": "hybrid_required"}}
    with pytest.raises(AdmissionConfigError) as info:
        await admit_delegated_bundle_v2(evidence_of(c), REGISTRY, {**operator_of(c), "policy": policy})
    assert info.value.code == "CONFIG_INVALID_VALUE"


@pytest.mark.asyncio
async def test_policy_missing_a_required_member_is_refused():
    policy = copy.deepcopy(V["policies"]["weak_classical"])
    del policy["allow_v1_bundles"]
    with pytest.raises(AdmissionConfigError) as info:
        await _with_policy(policy)
    assert info.value.code == "CONFIG_INVALID_VALUE"


# ── Mandate preflight against schemas/v2/delegation_mandate.schema.json ──


def test_preflight_has_the_shape_of_the_mandate_schema():
    assert MANDATE_SCHEMA["additionalProperties"] is False
    assert sorted(MANDATE_FIELDS) == sorted(MANDATE_SCHEMA["properties"])
    assert sorted(MANDATE_REQUIRED) == sorted(MANDATE_SCHEMA["required"])
    scope = MANDATE_SCHEMA["properties"]["authority_scope"]
    assert scope["minItems"] == 1
    item = scope["items"]
    assert item["additionalProperties"] is False
    assert sorted(SCOPE_FIELDS) == sorted(item["properties"])
    assert sorted(SCOPE_REQUIRED) == sorted(item["required"])
    assert item["properties"]["domain"] == {"type": "string", "minLength": 1}
    for name in ("actions_permitted", "data_classes"):
        assert item["properties"][name] == {"type": "array", "items": {"type": "string", "minLength": 1}}
    assert item["properties"]["limits"] == {"type": "object"}  # open: no member is constrained
    sd = MANDATE_SCHEMA["properties"]["sub_delegation"]
    assert sd["additionalProperties"] is False
    assert sorted(SUB_DELEGATION_FIELDS) == sorted(sd["properties"]) == sorted(sd["required"])
    assert MANDATE_SCHEMA["properties"]["minimum_security_tier"]["enum"] == ["routine", "standard", "elevated", "maximum"]


ONE_OF = [
    ("a root with parent_mandate_id", lambda c: c[0].__setitem__("parent_mandate_id", "mandate:parent"), "a root mandate has no parent_mandate_id"),
    ("a root with delegation_depth 1", lambda c: c[0].__setitem__("delegation_depth", 1), "a root mandate has delegation_depth 0"),
    ("a sub-mandate without delegation_depth", lambda c: c[1].pop("delegation_depth"), "missing delegation_depth"),
    ("a sub-mandate without parent_mandate_id", lambda c: c[1].pop("parent_mandate_id"), "missing parent_mandate_id"),
    ("a scope entry without actions_permitted", lambda c: c[1]["authority_scope"][0].pop("actions_permitted"), "is missing actions_permitted"),
    ("limits that is not an object", lambda c: c[1]["authority_scope"][0].__setitem__("limits", []), "limits must be an object"),
    ("an unknown tier", lambda c: c[0].__setitem__("minimum_security_tier", "critical"), "minimum_security_tier is not"),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("what,edit,message", ONE_OF, ids=[w for w, _, _ in ONE_OF])
async def test_preflight_rejects(what, edit, message):
    c = CASES["principal_orchestrator_subagent"]
    e = evidence_of(c)
    edit(e["mandate_chain"])
    result = await admit_delegated_bundle_v2(e, REGISTRY, operator_of(c))
    assert codes(result) == ["DELEGATION_CHAIN_INVALID"]
    assert any(message in err["message"] for err in result["errors"])
