"""
Bundle verification in the LangChain (DCPTool) and OpenAI (dcp_verify_bundle)
bridges: V2 bundles go through verify_signed_bundle_v2 under the caller's
verifier policy, V1 bundles only where the policy would accept a classical-only
bundle (VERIFICATION.md V2-10), from sync code with or without a running event
loop and from async code.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from dcp_ai.langchain import DCPTool
from dcp_ai.openai import averify_bundle_tool_call, handle_dcp_tool_call
from dcp_ai.v2.models import VerifierPolicy
from dcp_ai.v2.verify import DEFAULT_VERIFIER_POLICY

REPO_ROOT = Path(__file__).resolve().parents[3]
BUNDLE_VECTORS = json.loads((REPO_ROOT / "tests" / "interop" / "v2" / "bundle_vectors.json").read_text())
V1_SIGNED_BUNDLE = json.loads(
    (REPO_ROOT / "tests" / "conformance" / "examples" / "citizenship_bundle.signed.json").read_text()
)


def _langchain(signed_bundle, policy=None) -> tuple[bool, str]:
    out = DCPTool(verifier_policy=policy).run(json.dumps(signed_bundle))
    return out.startswith("Bundle VERIFIED"), out


def _openai(signed_bundle, policy=None) -> tuple[bool, str]:
    out = json.loads(
        handle_dcp_tool_call(
            "dcp_verify_bundle", {"signed_bundle_json": json.dumps(signed_bundle)}, verifier_policy=policy
        )
    )
    return out["verified"] is True, "\n".join(out["errors"])


BRIDGES = [pytest.param(_langchain, id="langchain"), pytest.param(_openai, id="openai")]


def _vector_cases():
    """Each shared bundle vector: (signed bundle, error_contains or None to accept, policy overrides)."""
    v = BUNDLE_VECTORS
    overrides = lambda c: c.get("verifier_policy_overrides")  # noqa: E731
    cases = [pytest.param(v["signed_bundle"], None, None, id="accept signed_bundle")]
    cases += [
        pytest.param(c["signed_bundle"], None, overrides(c), id=f"accept {c['name']}") for c in v["must_accept_bundles"]
    ]
    for c in v["must_reject"]:
        signed = copy.deepcopy(v["signed_bundle"])
        for mutation in c["mutations"]:
            node = signed
            for key in mutation["path"][:-1]:
                node = node[key]
            node[mutation["path"][-1]] = mutation["value"]
        cases.append(pytest.param(signed, c["error_contains"], None, id=f"reject {c['name']}"))
    cases += [
        pytest.param(c["signed_bundle"], c["error_contains"], overrides(c), id=f"reject {c['name']}")
        for c in v["must_reject_bundles"]
    ]
    return cases


@pytest.mark.parametrize("bridge", BRIDGES)
@pytest.mark.parametrize("signed_bundle,error_contains,policy_overrides", _vector_cases())
def test_shared_bundle_vectors(bridge, signed_bundle, error_contains, policy_overrides):
    # Without overrides the bridge's own default (DEFAULT_VERIFIER_POLICY); a case's
    # verifier_policy_overrides are merged over it, as the SDK harnesses do.
    policy = {**DEFAULT_VERIFIER_POLICY, **policy_overrides} if policy_overrides else None
    verified, detail = bridge(signed_bundle, policy)
    if error_contains is None:
        assert verified, detail
    else:
        assert not verified, detail
        assert error_contains in detail.lower(), detail


@pytest.mark.parametrize("bridge", BRIDGES)
def test_verifier_policy_is_applied(bridge):
    """The classical-only routine control verifies under the default policy only."""
    control = BUNDLE_VECTORS["classical_only_routine_bundle"]
    assert control["verified_by_mode"]["classical_only"] is True
    verified, detail = bridge(control["signed_bundle"])
    assert verified, detail
    for policy in ({"default_mode": "hybrid_required"}, VerifierPolicy(default_mode="pq_only", risk_overrides=None)):
        verified, detail = bridge(control["signed_bundle"], policy)
        assert not verified, detail


@pytest.mark.parametrize("bridge", BRIDGES)
def test_v1_follows_the_policy(bridge):
    verified, detail = bridge(V1_SIGNED_BUNDLE)
    assert verified, detail
    verified, detail = bridge(V1_SIGNED_BUNDLE, {"allow_v1_bundles": False})
    assert not verified
    assert "allow_v1_bundles is false" in detail
    verified, detail = bridge(V1_SIGNED_BUNDLE, {"default_mode": "hybrid_required"})
    assert not verified
    assert "requires hybrid_required" in detail


@pytest.mark.asyncio
async def test_sync_entry_points_inside_a_running_loop():
    """run() and handle_dcp_tool_call() verify on a worker thread when an event loop is running."""
    good = json.dumps(BUNDLE_VECTORS["signed_bundle"])
    forged = copy.deepcopy(BUNDLE_VECTORS["signed_bundle"])
    forged["bundle"]["intent"]["payload"]["action_type"] = "initiate_payment"
    bad = json.dumps(forged)
    assert DCPTool().run(good).startswith("Bundle VERIFIED (v2.0) for agent ")
    assert DCPTool().run(bad).startswith("Bundle INVALID: ")
    assert json.loads(handle_dcp_tool_call("dcp_verify_bundle", {"signed_bundle_json": good}))["verified"] is True
    assert json.loads(handle_dcp_tool_call("dcp_verify_bundle", {"signed_bundle_json": bad}))["verified"] is False


@pytest.mark.asyncio
async def test_async_entry_points():
    good = BUNDLE_VECTORS["signed_bundle"]
    assert (await DCPTool().arun(good)).startswith("Bundle VERIFIED (v2.0)")
    result = json.loads(await averify_bundle_tool_call({"signed_bundle_json": json.dumps(good)}))
    assert result["verified"] is True
    assert result["dcp_version"] == "2.0"
    assert result["details"]["signature_valid"] is True
    refused = json.loads(
        await averify_bundle_tool_call({"signed_bundle_json": json.dumps(V1_SIGNED_BUNDLE)}, {"allow_v1_bundles": False})
    )
    assert refused["verified"] is False


def test_unrecognized_and_malformed_input_is_rejected():
    for bridge in (_langchain, _openai):
        verified, detail = bridge({"bundle": {"dcp_bundle_version": "9"}, "signature": {}})
        assert not verified
        assert "Unrecognized DCP bundle version" in detail
    assert DCPTool().run("not-json").startswith("Verification error")
    out = json.loads(handle_dcp_tool_call("dcp_verify_bundle", {"signed_bundle_json": "not-json"}))
    assert out["verified"] is False


def test_invalid_verifier_policy_raises():
    with pytest.raises(ValidationError):
        DCPTool(verifier_policy={"require_audiance_binding": True})
    with pytest.raises(ValueError):
        handle_dcp_tool_call("dcp_verify_bundle", {"signed_bundle_json": "{}"}, verifier_policy={"default_mode": "strict"})
