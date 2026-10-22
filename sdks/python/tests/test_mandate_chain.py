"""DCP-09 §3.5 mandate chains (Python SDK): the shared vectors every SDK must
agree on (tests/interop/v2/mandate_chain_vectors.json), the builders, and the
tier floor a verified chain feeds into the security tier."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from dcp_ai.providers.ed25519_provider import Ed25519Provider
from dcp_ai.providers.ml_dsa_65_provider import MlDsa65Provider
from dcp_ai.v2 import (
    AlgorithmRegistry,
    CompositeKeyInfo,
    compute_security_tier,
    create_delegation_mandate,
    create_sub_mandate,
    generate_session_nonce,
    verify_mandate_chain,
)
from dcp_ai.v2.session_nonce import parse_rfc3339

VECTORS_PATH = Path(__file__).resolve().parent.parent.parent.parent / "tests" / "interop" / "v2" / "mandate_chain_vectors.json"


@pytest.fixture(scope="module")
def V():
    with open(VECTORS_PATH) as f:
        return json.load(f)


@pytest.fixture(scope="module")
def registry() -> AlgorithmRegistry:
    r = AlgorithmRegistry()
    r.register_signer(Ed25519Provider())
    r.register_signer(MlDsa65Provider())
    return r


async def _fresh_keys(registry: AlgorithmRegistry) -> tuple[CompositeKeyInfo, CompositeKeyInfo]:
    ed = await registry.get_signer("ed25519").generate_keypair()
    pq = await registry.get_signer("ml-dsa-65").generate_keypair()
    return (
        CompositeKeyInfo(kid=ed["kid"], alg="ed25519", secret_key_b64=ed["secret_key_b64"], public_key_b64=ed["public_key_b64"]),
        CompositeKeyInfo(kid=pq["kid"], alg="ml-dsa-65", secret_key_b64=pq["secret_key_b64"], public_key_b64=pq["public_key_b64"]),
    )


def _key_entries(*keys: CompositeKeyInfo, expires_at: str | None = None) -> list[dict]:
    return [
        {"kid": k.kid, "alg": k.alg, "public_key_b64": k.public_key_b64, "created_at": "2026-10-21T00:00:00Z", "expires_at": expires_at, "status": "active"}
        for k in keys
    ]


class TestMandateChainVectors:
    @pytest.mark.asyncio
    async def test_must_accept(self, V, registry):
        now = parse_rfc3339(V["verification_time"])
        assert V["must_accept"]
        for case in V["must_accept"]:
            result = await verify_mandate_chain(registry, case["chain"], set(case["revoked_mandate_ids"]), V["keys"], now=now)
            assert result["errors"] == [], case["name"]
            assert result["valid"], case["name"]
            assert {"depth": result["depth"], "effective_tier": result["effective_tier"]} == case["expected"], case["name"]

    @pytest.mark.asyncio
    async def test_must_reject(self, V, registry):
        assert len(V["must_reject"]) > 10
        for case in V["must_reject"]:
            now = parse_rfc3339(case.get("verification_time") or V["verification_time"])
            result = await verify_mandate_chain(registry, case["chain"], set(case.get("revoked_mandate_ids") or []), V["keys"], now=now)
            assert not result["valid"], case["name"]
            assert case["error_contains"] in "\n".join(result["errors"]).lower(), (case["name"], result["errors"])

    def test_tier_floor(self, V):
        assert V["tier_floor"]["cases"]
        for case in V["tier_floor"]["cases"]:
            assert compute_security_tier(case["intent"], case["policy_decision"], case["mandate_chain_tier"]) == case["expected"], case["name"]


SCOPE = [
    {"domain": "email", "actions_permitted": ["read", "draft", "send"], "data_classes": ["contact_info"], "limits": {"max_messages_per_day": 100, "region": "EU"}},
    {"domain": "calendar", "actions_permitted": ["read", "create_event"]},
]
WINDOW = {"valid_from": "2026-01-01T00:00:00Z", "valid_until": "2099-01-01T00:00:00Z", "revocable": True}


@pytest.mark.asyncio
class TestMandateChainBuilders:
    async def test_root_without_chain_fields_is_unchanged_on_the_wire(self, registry):
        ck, pqk = await _fresh_keys(registry)
        root = await create_delegation_mandate(
            registry, ck, pqk, mandate_id="mandate:root", session_nonce=generate_session_nonce(), human_id="human:alice",
            agent_id="agent:orchestrator", authority_scope=SCOPE, **WINDOW,
        )
        assert sorted(root) == [
            "agent_id", "authority_scope", "dcp_version", "human_composite_sig", "human_id", "mandate_id",
            "revocable", "session_nonce", "timestamp", "valid_from", "valid_until",
        ]

    async def test_chain_round_trip(self, registry):
        human, orchestrator, subagent, tool = [await _fresh_keys(registry) for _ in range(4)]
        root = await create_delegation_mandate(
            registry, *human, mandate_id="mandate:root", session_nonce=generate_session_nonce(), human_id="human:alice",
            agent_id="agent:orchestrator", authority_scope=SCOPE, **WINDOW,
            sub_delegation={"permitted": True, "max_depth": 2}, minimum_security_tier="standard",
        )
        sub1 = await create_sub_mandate(
            registry, *orchestrator, root, mandate_id="mandate:sub-1", session_nonce=generate_session_nonce(), agent_id="agent:subagent",
            authority_scope=[{"domain": "email", "actions_permitted": ["read", "draft"], "data_classes": ["contact_info"], "limits": {"max_messages_per_day": 20, "region": "EU", "approval": True}}],
            **WINDOW, sub_delegation={"permitted": True, "max_depth": 2}, minimum_security_tier="elevated",
        )
        sub2 = await create_sub_mandate(
            registry, *subagent, sub1, mandate_id="mandate:sub-2", session_nonce=generate_session_nonce(), agent_id="agent:tool",
            authority_scope=[{"domain": "email", "actions_permitted": ["read"], "data_classes": [], "limits": {"max_messages_per_day": 5, "region": "EU", "approval": True}}],
            **WINDOW, minimum_security_tier="maximum",
        )
        assert (sub1["parent_mandate_id"], sub1["delegation_depth"], sub1["human_id"]) == ("mandate:root", 1, "human:alice")
        assert (sub2["parent_mandate_id"], sub2["delegation_depth"]) == ("mandate:sub-1", 2)
        assert "human_composite_sig" not in sub1

        keys = {
            "human_keys": _key_entries(*human, expires_at="2099-12-31T23:59:59Z"),
            "agent_keys": {"agent:orchestrator": _key_entries(*orchestrator), "agent:subagent": _key_entries(*subagent), "agent:tool": _key_entries(*tool)},
        }
        ok = await verify_mandate_chain(registry, [root, sub1, sub2], set(), keys)
        assert ok == {"valid": True, "errors": [], "depth": 2, "effective_tier": "maximum"}
        root_only = await verify_mandate_chain(registry, [root], set(), keys)
        assert (root_only["valid"], root_only["depth"], root_only["effective_tier"]) == (True, 0, "standard")

        revoked = await verify_mandate_chain(registry, [root, sub1, sub2], {"mandate:root"}, keys)
        assert revoked["errors"] == ["mandate[0]: revoked"]

        # A key that is not active, or has expired at the verification time, cannot vouch for a hop.
        revoked_key = {**keys, "agent_keys": {**keys["agent_keys"], "agent:orchestrator": [{**k, "status": "revoked"} for k in _key_entries(*orchestrator)]}}
        assert "delegator_composite_sig" in ",".join((await verify_mandate_chain(registry, [root, sub1], set(), revoked_key))["errors"])
        late = await verify_mandate_chain(registry, [root, sub1], set(), keys, now=parse_rfc3339("2100-01-01T00:00:00Z"))
        assert "expired" in ",".join(late["errors"])

        # A chain out of order, or starting at a sub-mandate, never verifies.
        assert not (await verify_mandate_chain(registry, [sub1, root], set(), keys))["valid"]
        assert not (await verify_mandate_chain(registry, [sub1], set(), keys))["valid"]
        assert not (await verify_mandate_chain(registry, [], set(), keys))["valid"]
        assert (await verify_mandate_chain(registry, [None], set(), keys))["errors"] == ["mandate[0]: not an object"]  # type: ignore[list-item]


@pytest.mark.asyncio
async def test_malformed_input_is_rejected_not_raised(V, registry):
    """An unhashable tier, an integer too large for a float, or a non-dict key list reject the chain; nothing propagates."""
    now = parse_rfc3339(V["verification_time"])
    root, sub = V["must_accept"][0]["chain"]
    cases = {
        "unhashable_tier": [{**root, "minimum_security_tier": ["elevated"]}, sub],
        "huge_integer_limit": [root, {**sub, "authority_scope": [{**sub["authority_scope"][0], "limits": {**sub["authority_scope"][0]["limits"], "max_messages_per_day": 10**400}}]}],
        "list_as_mandate": [root, ["not", "a", "mandate"]],
    }
    for name, chain in cases.items():
        result = await verify_mandate_chain(registry, chain, set(), V["keys"], now=now)  # type: ignore[arg-type]
        assert result["valid"] is False, name
        assert result["errors"], name
    broken_keys = {"human_keys": V["keys"]["human_keys"], "agent_keys": ["not", "a", "dict"]}
    assert (await verify_mandate_chain(registry, [root, sub], set(), broken_keys, now=now))["valid"] is False  # type: ignore[arg-type]


def test_security_tier_floor_can_only_raise():
    routine = {"action_type": "browse", "data_classes": ["none"], "estimated_impact": "low"}
    assert compute_security_tier(routine, {"risk_score": 0}) == "routine"
    assert compute_security_tier(routine, {"risk_score": 0}, "elevated") == "elevated"
    assert compute_security_tier(routine, {"risk_score": 0}, None) == "routine"
    assert compute_security_tier({**routine, "data_classes": ["credentials"]}, {"risk_score": 0}, "routine") == "maximum"
    assert compute_security_tier(routine, {"risk_score": 0}, "bogus") == "elevated"
