"""DCP-09 §3.5.2 rule 5, a domain that appears twice in one mandate (Python SDK): the shared
signed vectors every SDK must agree on (tests/interop/v2/mandate_domain_vectors.json), at every
depth, the root included, with domains compared as exact strings. The verdicts are the
protocol's; the exact error lists are this SDK's diagnostics, checked as a regression."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import pytest

from dcp_ai.providers.ed25519_provider import Ed25519Provider
from dcp_ai.providers.ml_dsa_65_provider import MlDsa65Provider
from dcp_ai.v2 import AlgorithmRegistry, verify_mandate_chain

VECTORS_PATH = Path(__file__).resolve().parent.parent.parent.parent / "tests" / "interop" / "v2" / "mandate_domain_vectors.json"


@pytest.fixture(scope="module")
def V():
    with open(VECTORS_PATH, encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def registry() -> AlgorithmRegistry:
    r = AlgorithmRegistry()
    r.register_signer(Ed25519Provider())
    r.register_signer(MlDsa65Provider())
    return r


def now_of(V) -> datetime:
    return datetime.fromisoformat(V["verification_time"].replace("Z", "+00:00"))


def test_names_are_unique(V):
    names = [c["name"] for c in V["must_accept"] + V["must_reject"]]
    assert len(set(names)) == len(names)


@pytest.mark.asyncio
async def test_must_accept(V, registry):
    assert len(V["must_accept"]) == 8
    for case in V["must_accept"]:
        result = await verify_mandate_chain(registry, case["chain"], set(case["revoked_mandate_ids"]), V["keys"], now=now_of(V))
        assert result["errors"] == [], case["name"]
        assert result["valid"] is True, case["name"]
        assert {"depth": result["depth"], "effective_tier": result["effective_tier"]} == case["expected"], case["name"]


@pytest.mark.asyncio
async def test_must_reject(V, registry):
    assert len(V["must_reject"]) == 15
    mismatches = []
    for case in V["must_reject"]:
        result = await verify_mandate_chain(registry, case["chain"], set(case["revoked_mandate_ids"]), V["keys"], now=now_of(V))
        if result != {"valid": False, "errors": case["errors"], "depth": 0, "effective_tier": None}:
            mismatches.append((case["name"], result))
    assert mismatches == []
