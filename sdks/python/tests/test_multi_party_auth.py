"""
Multi-party authorization under the opt-in mpa-v1 profile (spec/profiles/multi-party): the
shared vectors in tests/interop/v2/multi_party_vectors.json through the public API, and what
the vectors cannot express. Mirrors sdks/typescript/src/__tests__/multi-party-auth.test.ts.
"""

from __future__ import annotations

import asyncio
import copy
import json
import re
import time
from pathlib import Path

import pytest

from dcp_ai.providers import Ed25519Provider, MlDsa65Provider
from dcp_ai.v2 import (
    MPA_V1,
    MPA_V1_MAX_AUTHORIZATIONS,
    AdmissionConfigError,
    AlgorithmRegistry,
    CompositeKeyInfo,
    MultiPartyAuthorization,
    MultiPartyConfigError,
    MultiPartyPolicy,
    MultiPartyPolicyStore,
    build_multi_party_authorization,
    check_multi_party_authorization_structure,
    create_multi_party_policy_store,
    create_multi_party_request,
    create_party_authorization,
    create_principal_trust_store,
    evaluate_multi_party_authorization,
    verify_multi_party_authorization,
)

V = json.loads((Path(__file__).resolve().parents[3] / "tests" / "interop" / "v2" / "multi_party_vectors.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def registry() -> AlgorithmRegistry:
    r = AlgorithmRegistry()
    r.register_signer(Ed25519Provider())
    r.register_signer(MlDsa65Provider())
    return r


def _case(name: str) -> dict:
    return next(c for c in V["cases"] if c["name"] == name)


def _codes(result: dict) -> list[str]:
    return sorted({e["code"] for e in result["errors"]})


async def _evaluate(case: dict, registry: AlgorithmRegistry, record=...) -> dict:
    return await evaluate_multi_party_authorization(
        copy.deepcopy(V["records"][case["record"]]) if record is ... else record,
        registry,
        policy=V["policy_sets"][case["policy_set"]],
        trust=V["trust_sets"][case["trust_set"]],
        expected=case["expected"],
        now_ms=case["now_ms"],
    )


class _Counting:
    """A provider that counts the signatures it is asked to verify."""

    def __init__(self, inner, count: list[int]) -> None:
        self._inner, self._count, self.alg = inner, count, inner.alg

    async def verify(self, message: bytes, signature: bytes, public_key_b64: str) -> bool:
        self._count[0] += 1
        return await self._inner.verify(message, signature, public_key_b64)

    def __getattr__(self, name: str):
        return getattr(self._inner, name)


def _counting_registry() -> tuple[AlgorithmRegistry, list[int]]:
    count = [0]
    r = AlgorithmRegistry()
    for provider in (Ed25519Provider(), MlDsa65Provider()):
        r.register_signer(_Counting(provider, count))
    return r, count


# ── Vectors ──


def test_vectors_are_there():
    assert V["profile"] == MPA_V1
    assert V["max_authorizations"] == MPA_V1_MAX_AUTHORIZATIONS
    assert len(V["cases"]) >= 62 and len(V["config_cases"]) >= 21


@pytest.mark.asyncio
@pytest.mark.parametrize("case", V["cases"], ids=lambda c: f"{c['group']}:{c['name']}")
async def test_multi_party_vector(registry, case):
    r = await _evaluate(case, registry)
    assert {k: r[k] for k in ("authorized", "structure", "verification", "parties_counted", "required_parties")} | {"codes": _codes(r)} == case["expect"], case["rule"]
    assert r["profile"] == "mpa-v1"
    assert r["policy_set_version"] == V["policy_sets"][case["policy_set"]]["policy_set_version"]
    assert r["trust_set_version"] == V["trust_sets"][case["trust_set"]]["trust_set_version"]
    rec = V["records"][case["record"]]
    if case["expect"]["structure"] == "valid":
        req = rec["operation_payload"]["request"]
        assert [r["operation"], r["target"], r["request_id"], r["expires_at"]] == [rec["operation"], req["target"], req["request_id"], req["expires_at"]]
        assert [[p["party_id"], p["role"]] for p in r["parties"]] == [[a["party_id"], a["role"]] for a in rec["authorizations"]]
        if case["expect"]["verification"] == "not_evaluated":
            assert all(p["verified"] is None for p in r["parties"])
        else:
            assert all(isinstance(p["verified"], bool) for p in r["parties"])
            assert sum(p["verified"] for p in r["parties"]) == case["expect"]["parties_counted"]
    else:
        assert [r["operation"], r["target"], r["request_id"], r["expires_at"], r["parties"]] == [None, None, None, None, []]
    assert set(r) == {
        "profile", "structure", "verification", "authorized", "operation", "target", "request_id", "expires_at",
        "parties", "parties_counted", "required_parties", "policy_set_version", "trust_set_version", "errors",
    }
    assert all(len(e["message"]) <= 300 for e in r["errors"])


@pytest.mark.parametrize("case", V["config_cases"], ids=lambda c: c["name"])
def test_policy_set_configuration(case):
    if case["expect_code"] is None:
        assert isinstance(create_multi_party_policy_store(copy.deepcopy(case["policy_set"])), MultiPartyPolicyStore)
        return
    with pytest.raises(MultiPartyConfigError) as e:
        create_multi_party_policy_store(copy.deepcopy(case["policy_set"]))
    assert e.value.code == case["expect_code"]


@pytest.mark.asyncio
@pytest.mark.parametrize("case", V["trust_config_cases"], ids=lambda c: c["name"])
async def test_a_key_under_two_parties_does_not_load(registry, case):
    with pytest.raises(AdmissionConfigError) as e:
        create_principal_trust_store(copy.deepcopy(case["trust_set"]))
    assert e.value.code == case["expect_code"]
    base = _case("two_of_three")
    with pytest.raises(AdmissionConfigError) as e:
        await evaluate_multi_party_authorization(
            copy.deepcopy(V["records"][base["record"]]), registry,
            policy=V["policy_sets"]["base"], trust=copy.deepcopy(case["trust_set"]), expected=base["expected"], now_ms=base["now_ms"],
        )
    assert e.value.code == case["expect_code"]


# ── What the vectors cannot express ──


@pytest.mark.asyncio
async def test_verifies_no_signature_of_a_request_refused_earlier():
    for name in ("seventeen_authorizations", "without_request", "another_audience", "expired", "target_the_operator_does_not_have", "same_party_twice", "self_assigned_role", "sixteen_authorizations"):
        r, count = _counting_registry()
        assert (await _evaluate(_case(name), r))["authorized"] is False
        assert count[0] == 0, name
    r, count = _counting_registry()
    assert (await _evaluate(_case("two_of_three"), r))["authorized"] is True
    assert count[0] == 4


@pytest.mark.asyncio
async def test_keeps_no_state(registry):
    c = _case("two_of_three")
    results = await asyncio.gather(_evaluate(c, registry), _evaluate(c, registry), _evaluate(c, registry))
    assert [r["authorized"] for r in results] == [True, True, True]
    assert (await _evaluate(c, registry))["authorized"] is True


@pytest.mark.asyncio
async def test_what_the_caller_changes_while_signatures_are_verified_is_not_read(registry):
    c = _case("signed_another_request")  # alice signs this request; bob, another one
    record = copy.deepcopy(V["records"][c["record"]])
    pending = asyncio.ensure_future(_evaluate(c, registry, record))
    await asyncio.sleep(0)  # the evaluation runs up to the first signature it verifies
    assert not pending.done()
    record["authorizations"][1] = copy.deepcopy(record["authorizations"][0])  # alice again, where bob was checked as a party
    r = await pending
    assert [r["authorized"], r["verification"], r["parties_counted"], _codes(r)] == [False, "failed", 1, ["MPA_SIGNATURE_INVALID"]]
    assert [(p["party_id"], p["verified"]) for p in r["parties"]] == [("human:alice", True), ("human:bob", False)]


@pytest.mark.asyncio
async def test_what_is_signed_is_what_was_compared_with_what_the_executor_expects(registry):
    c = _case("two_of_three")
    record = copy.deepcopy(V["records"][c["record"]])
    signed = record["operation_payload"]["parameters"]
    record["operation_payload"]["parameters"] = {"reason": "administrative"}  # what the executor is about to do; no one signed it
    pending = asyncio.ensure_future(_evaluate({**c, "expected": {**c["expected"], "parameters": {"reason": "administrative"}}}, registry, record))
    await asyncio.sleep(0)
    assert not pending.done()
    record["operation_payload"]["parameters"] = signed  # back to what the parties signed, once the parameters were compared
    r = await pending
    assert [r["authorized"], r["parties_counted"], _codes(r)] == [False, 0, ["MPA_SIGNATURE_INVALID"]]


@pytest.mark.asyncio
async def test_a_record_nested_too_deeply_to_copy_is_refused_as_before(registry):
    c = _case("two_of_three")
    record = copy.deepcopy(V["records"][c["record"]])
    deep: dict = {}
    record["operation_payload"]["parameters"] = deep
    for _ in range(100_000):
        deep["deeper"] = deep = {}
    r = await _evaluate(c, registry, record)
    assert [r["authorized"], r["structure"], _codes(r)] == [False, "invalid", ["MPA_NOT_REPRESENTABLE"]]


@pytest.mark.asyncio
async def test_accepts_loaded_stores_as_well_as_their_json(registry):
    c = _case("two_of_three")
    r = await evaluate_multi_party_authorization(
        copy.deepcopy(V["records"][c["record"]]), registry,
        policy=create_multi_party_policy_store(V["policy_sets"]["base"]),
        trust=create_principal_trust_store(V["trust_sets"]["base"]),
        expected=c["expected"], now_ms=c["now_ms"],
    )
    assert r == await _evaluate(c, registry)


@pytest.mark.asyncio
async def test_a_record_that_is_not_an_object_gets_a_result(registry):
    c = _case("two_of_three")
    for record in (None, [], "record", 7, True, 1.5):
        r = await _evaluate(c, registry, record)
        assert [r["authorized"], r["structure"], _codes(r)] == [False, "invalid", ["MPA_SCHEMA_INVALID"]]


@pytest.mark.asyncio
async def test_does_not_take_a_role_from_the_record(registry):
    c = _case("required_role_missing")
    promoted = copy.deepcopy(V["records"][c["record"]])
    promoted["authorizations"][0]["role"] = "owner"  # an unsigned change of role
    r = await _evaluate(c, registry, promoted)
    assert r["authorized"] is False and _codes(r) == ["MPA_ROLE_MISMATCH"]


@pytest.mark.asyncio
async def test_a_registry_without_one_of_the_algorithms_refuses():
    classical_only = AlgorithmRegistry()
    classical_only.register_signer(Ed25519Provider())
    r = await _evaluate(_case("two_of_three"), classical_only)
    assert [r["authorized"], r["verification"], _codes(r)] == [False, "failed", ["MPA_SIGNATURE_INVALID"]]


@pytest.mark.asyncio
async def test_what_the_executor_states_wrongly_is_an_error_not_a_decision(registry):
    c = _case("two_of_three")
    for expected in (
        None,
        {**c["expected"], "operation": "delete_everything"},
        {**c["expected"], "target": ""},
        {**c["expected"], "parameters": "none"},
        {**c["expected"], "parameters": {"ratio": 0.5}},
        {**c["expected"], "extra": 1},
    ):
        with pytest.raises(MultiPartyConfigError):
            await evaluate_multi_party_authorization(
                copy.deepcopy(V["records"][c["record"]]), registry,
                policy=V["policy_sets"]["base"], trust=V["trust_sets"]["base"], expected=expected, now_ms=c["now_ms"],
            )
    # A clock that is not a number of milliseconds is the caller's mistake too.
    for now_ms in ("2026-11-18T00:10:00Z", 1.5, True):
        with pytest.raises(MultiPartyConfigError):
            await evaluate_multi_party_authorization(
                copy.deepcopy(V["records"][c["record"]]), registry,
                policy=V["policy_sets"]["base"], trust=V["trust_sets"]["base"], expected=c["expected"], now_ms=now_ms,
            )


def test_a_policy_store_cannot_be_changed_after_it_is_loaded():
    store = create_multi_party_policy_store(copy.deepcopy(V["policy_sets"]["base"]))
    assert create_multi_party_policy_store(store) is store
    assert repr(store) == f"MultiPartyPolicyStore(version={store.version!r}, subjects={len(store.subjects)})"
    with pytest.raises(AttributeError):
        store.audience = "verifier:other"
    with pytest.raises(AttributeError):
        del store.audience
    with pytest.raises(TypeError):
        store.subjects["agent:acme-bot"] = None
    with pytest.raises(TypeError):
        MultiPartyPolicyStore(object(), "v", "a", 1, {})


# ── Signing ──


async def _party(party_id: str) -> dict:
    c, p = await Ed25519Provider().generate_keypair(), await MlDsa65Provider().generate_keypair()
    return {
        "id": party_id,
        "classical": CompositeKeyInfo(kid=c["kid"], alg="ed25519", secret_key_b64=c["secret_key_b64"], public_key_b64=c["public_key_b64"]),
        "pq": CompositeKeyInfo(kid=p["kid"], alg="ml-dsa-65", secret_key_b64=p["secret_key_b64"], public_key_b64=p["public_key_b64"]),
        "trusted": {
            "human_id": party_id,
            "keys": [
                {"kid": c["kid"], "alg": "ed25519", "public_key_b64": c["public_key_b64"], "status": "active"},
                {"kid": p["kid"], "alg": "ml-dsa-65", "public_key_b64": p["public_key_b64"], "status": "active"},
            ],
        },
    }


@pytest.mark.asyncio
async def test_what_the_sdk_signs_the_sdk_authorizes(registry):
    owner, admin = await _party("human:owner"), await _party("human:admin")
    now = 1795003200000  # 2026-11-18T12:00:00Z
    payload = create_multi_party_request(target="agent:signed-here", audience="verifier:here", parameters={"reason": "administrative"}, issued_at_ms=now, validity_seconds=600)
    assert payload["request"] | {"request_id": ""} == {
        "profile": "mpa-v1", "request_id": "", "target": "agent:signed-here", "audience": "verifier:here",
        "issued_at": "2026-11-18T12:00:00.000Z", "expires_at": "2026-11-18T12:10:00.000Z",
    }
    assert re.fullmatch(r"mpa:[0-9a-f]{32}", payload["request"]["request_id"])
    assert create_multi_party_request(target="a", audience="b", validity_seconds=1)["request"]["request_id"] != payload["request"]["request_id"]

    record = build_multi_party_authorization("revoke_agent", payload, [
        await create_party_authorization(registry, "revoke_agent", payload, owner["id"], "owner", owner["classical"], owner["pq"]),
        await create_party_authorization(registry, "revoke_agent", payload, admin["id"], "org_admin", admin["classical"], admin["pq"]),
    ])
    assert record["required_parties"] == 2
    r = await evaluate_multi_party_authorization(
        json.loads(json.dumps(record)), registry,
        policy={
            "policy_set_version": "here.1", "profile": "mpa-v1", "audience": "verifier:here", "max_validity_seconds": 600,
            "subjects": [{
                "target": "agent:signed-here",
                "parties": [{"party_id": owner["id"], "role": "owner"}, {"party_id": admin["id"], "role": "org_admin"}],
                "operations": {"revoke_agent": {"required_parties": 2, "allowed_roles": ["owner", "org_admin"], "required_roles": ["owner"]}},
            }],
        },
        trust={"trust_set_version": "here.1", "principals": [owner["trusted"], admin["trusted"]]},
        expected={"operation": "revoke_agent", "target": "agent:signed-here", "parameters": {"reason": "administrative"}},
        now_ms=now + 1000,
    )
    assert r["errors"] == []
    assert [r["authorized"], r["parties_counted"], r["request_id"]] == [True, 2, payload["request"]["request_id"]]
    # The structure of the same record says nothing about who signed.
    assert check_multi_party_authorization_structure(MultiPartyAuthorization(**record))["valid"] is True


@pytest.mark.asyncio
async def test_with_no_clock_given_the_system_clock_decides(registry):
    owner, admin = await _party("human:owner"), await _party("human:admin")
    configuration = {
        "policy": {
            "policy_set_version": "here.1", "profile": "mpa-v1", "audience": "verifier:here", "max_validity_seconds": 600,
            "subjects": [{
                "target": "agent:signed-here",
                "parties": [{"party_id": owner["id"], "role": "owner"}, {"party_id": admin["id"], "role": "org_admin"}],
                "operations": {"revoke_agent": {"required_parties": 2, "allowed_roles": ["owner", "org_admin"], "required_roles": ["owner"]}},
            }],
        },
        "trust": {"trust_set_version": "here.1", "principals": [owner["trusted"], admin["trusted"]]},
        "expected": {"operation": "revoke_agent", "target": "agent:signed-here", "parameters": {}},
    }

    async def evaluated(**issued) -> dict:
        payload = create_multi_party_request(target="agent:signed-here", audience="verifier:here", validity_seconds=60, **issued)
        record = build_multi_party_authorization("revoke_agent", payload, [
            await create_party_authorization(registry, "revoke_agent", payload, owner["id"], "owner", owner["classical"], owner["pq"]),
            await create_party_authorization(registry, "revoke_agent", payload, admin["id"], "org_admin", admin["classical"], admin["pq"]),
        ])
        return await evaluate_multi_party_authorization(json.loads(json.dumps(record)), registry, **configuration)

    # Issued by the builder's clock and read by the evaluator's: in force.
    fresh = await evaluated()
    assert [fresh["authorized"], _codes(fresh)] == [True, []]
    # Issued an hour ago for a minute: over.
    stale = await evaluated(issued_at_ms=int(time.time() * 1000) - 3_600_000)
    assert [stale["authorized"], _codes(stale)] == [False, ["MPA_EXPIRED"]]


@pytest.mark.asyncio
async def test_takes_the_integers_a_binary64_holds_exactly_and_no_other_number(registry):
    owner, admin = await _party("human:owner"), await _party("human:admin")
    now = 1795003200000  # 2026-11-18T12:00:00Z
    request = {"target": "agent:signed-here", "audience": "verifier:here", "issued_at_ms": now, "validity_seconds": 600}
    configuration = {
        "policy": {
            "policy_set_version": "here.1", "profile": "mpa-v1", "audience": "verifier:here", "max_validity_seconds": 600,
            "subjects": [{
                "target": "agent:signed-here",
                "parties": [{"party_id": owner["id"], "role": "owner"}, {"party_id": admin["id"], "role": "org_admin"}],
                "operations": {"revoke_agent": {"required_parties": 2, "allowed_roles": ["owner", "org_admin"], "required_roles": ["owner"]}},
            }],
        },
        "trust": {"trust_set_version": "here.1", "principals": [owner["trusted"], admin["trusted"]]},
        "now_ms": now + 1000,
    }

    def expected(parameters):
        return {"operation": "revoke_agent", "target": "agent:signed-here", "parameters": parameters}

    async def signed_over(payload):
        """A record whose two parties signed `payload`, whatever it holds: the signer signs what it is given."""
        return json.loads(json.dumps(build_multi_party_authorization("revoke_agent", payload, [
            await create_party_authorization(registry, "revoke_agent", payload, owner["id"], "owner", owner["classical"], owner["pq"]),
            await create_party_authorization(registry, "revoke_agent", payload, admin["id"], "org_admin", admin["classical"], admin["pq"]),
        ])))

    largest_integer = 2**53 - 1
    # The largest integers of the profile are built, signed, stated and authorized.
    largest = {"ceiling": largest_integer, "floor": -largest_integer}
    at_the_limit = create_multi_party_request(parameters=largest, **request)
    within = await evaluate_multi_party_authorization(await signed_over(at_the_limit), registry, expected=expected(largest), **configuration)
    assert [within["authorized"], _codes(within)] == [True, []]

    for parameters in (
        {"amount": largest_integer + 1}, {"amount": -largest_integer - 1}, {"amount": 10**21}, {"amount": 1e21},
        {"amount": 2.0**53}, {"limits": [1, {"amount": largest_integer + 1}]},
    ):
        # One more is not a request the SDK builds...
        with pytest.raises(MultiPartyConfigError) as built:
            create_multi_party_request(parameters=parameters, **request)
        assert built.value.code == "CONFIG_INVALID_VALUE", parameters
        # ...nor parameters an executor can state...
        with pytest.raises(MultiPartyConfigError) as stated:
            await evaluate_multi_party_authorization(await signed_over(at_the_limit), registry, expected=expected(parameters), **configuration)
        assert stated.value.code == "CONFIG_INVALID_VALUE", parameters
        # ...and a record that holds one decides nothing, whoever signed it: 2^53 and 2^53 + 1 are one number to
        # whoever reads JSON numbers as binary64, so a signature over one would stand for the other.
        over = await signed_over({"request": at_the_limit["request"], "parameters": parameters})
        refused = await evaluate_multi_party_authorization(over, registry, expected=expected(largest), **configuration)
        assert [refused["authorized"], refused["structure"], refused["verification"], _codes(refused)] == [
            False, "invalid", "not_evaluated", ["MPA_NOT_REPRESENTABLE"]], parameters


def test_refuses_to_build_a_request_the_profile_would_not_accept():
    base = {"target": "agent:x", "audience": "verifier:y", "validity_seconds": 60}
    for change in (
        {"target": ""},
        {"audience": "a" * 257},
        {"validity_seconds": 0},
        {"validity_seconds": 86_401},
        {"validity_seconds": 1.5},
        {"issued_at_ms": 1.5},
        {"request_id": ""},
        {"parameters": {"ratio": 0.5}},
    ):
        with pytest.raises(MultiPartyConfigError):
            create_multi_party_request(**{**base, **change})


# ── The structural check is not an authorization ──


def _unsigned(party_id: str, role: str) -> dict:
    return {"party_id": party_id, "role": role, "composite_sig": {"classical": {"alg": "ed25519", "kid": "0" * 32, "sig_b64": "AAAAAAAAAAA="}, "pq": None, "binding": "classical_only"}}


def _record(*authorizations: dict, operation: str = "revoke_agent") -> MultiPartyAuthorization:
    return MultiPartyAuthorization(operation=operation, operation_payload={}, required_parties=2, authorizations=list(authorizations))


def test_the_structural_check_accepts_a_record_signed_by_no_one():
    assert check_multi_party_authorization_structure(_record(_unsigned("anyone", "owner"), _unsigned("anyone", "owner"))) == {"valid": True, "errors": []}


def test_the_structural_check_reports_the_shape_problems():
    check = lambda r, policy=None: check_multi_party_authorization_structure(r, policy)["errors"]  # noqa: E731
    assert check(_record(_unsigned("a", "owner"))) == ["Insufficient authorizations: 1 < 2"]
    assert check(_record(_unsigned("a", "org_admin"), _unsigned("b", "org_admin"))) == ["Owner authorization required but not present"]
    assert check(_record(_unsigned("a", "owner"), _unsigned("b", "recovery_contact"), operation="rotate_org_key")) == ["Role recovery_contact not allowed for operation rotate_org_key"]
    assert check(_record(_unsigned("a", "org_admin"), _unsigned("b", "org_admin")), MultiPartyPolicy(required_parties=2, allowed_roles=["org_admin"], require_owner=False)) == []


def test_the_old_name_still_works_says_it_is_deprecated_and_gives_the_same_answer():
    record = _record(_unsigned("anyone", "owner"), _unsigned("anyone", "owner"))
    with pytest.warns(DeprecationWarning, match="check_multi_party_authorization_structure"):
        assert verify_multi_party_authorization(record) == check_multi_party_authorization_structure(record) == {"valid": True, "errors": []}
    with pytest.warns(DeprecationWarning):
        assert verify_multi_party_authorization(_record(_unsigned("a", "owner"))) == {"valid": False, "errors": ["Insufficient authorizations: 1 < 2"]}
