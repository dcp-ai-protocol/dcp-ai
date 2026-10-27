"""Secondary SHA3-256 fields (spec/VERIFICATION.md V2-11 and its erratum of 27/10/2026), through the shared vectors
tests/interop/v2/secondary_sha3_vectors.json: the default verifier, admission and the experimental candidate verifier
(v1 route)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from dcp_ai.providers import Ed25519Provider, MlDsa65Provider
from dcp_ai.v2.admission import admit_signed_bundle_v2
from dcp_ai.v2.crypto_registry import AlgorithmRegistry
from dcp_ai.v2.experimental_candidate_router import JSON_LOADS_BYTES
from dcp_ai.v2.experimental_candidate_verify import create_verifier
from dcp_ai.v2.session_nonce import rfc3339_epoch_ms
from dcp_ai.v2.verify import verify_signed_bundle_v2

VECTORS = json.loads(
    (Path(__file__).resolve().parents[3] / "tests" / "interop" / "v2" / "secondary_sha3_vectors.json").read_text()
)
NOW = rfc3339_epoch_ms(VECTORS["verification_time"])
CASES = VECTORS["cases"]


def _assemble(part: dict) -> dict:
    return {
        "bundle": {
            "dcp_bundle_version": "2.0",
            "manifest": part["manifest"],
            **VECTORS["base"]["artifacts"],
            "audit_entries": part["audit_entries"],
        },
        "signature": part["signature"],
    }


@pytest.fixture(scope="module")
def registry() -> AlgorithmRegistry:
    r = AlgorithmRegistry()
    r.register_signer(Ed25519Provider())
    r.register_signer(MlDsa65Provider())
    return r


def test_vectors_cover_every_group():
    assert len(CASES) == 51
    assert len({c["name"] for c in CASES}) == 51
    assert sum(c["expect"] == "accept" for c in CASES) == 22
    assert sum(c["expect"] == "reject" for c in CASES) == 29
    assert all(c["expect"] in ("accept", "reject") for c in CASES)
    assert {c["group"] for c in CASES} >= {"root", "chain", "intent", "mixed"}
    assert all(c.get("control") and c.get("error_contains") for c in CASES if c["expect"] == "reject")


@pytest.mark.asyncio
@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
async def test_verifier(case, registry):
    result = await verify_signed_bundle_v2(_assemble(case), registry, now_ms=NOW)
    if case["expect"] == "accept":
        assert result["errors"] == []
        assert result["verified"] is True
        return
    assert result["verified"] is False
    assert any(case["error_contains"] in e for e in result["errors"]), result["errors"]
    assert all("secondary" in e for e in result["errors"]), result["errors"]
    if case["group"] == "root":
        assert result["details"].get("manifest_valid") is False
    else:
        assert result["details"].get("hash_chain_valid") is False
    control = await verify_signed_bundle_v2(_assemble(case["control"]), registry, now_ms=NOW)
    assert control["errors"] == []
    assert control["verified"] is True


TRUST = {
    "trust_set_version": "2026-10-27.secondary",
    "principals": [{
        "human_id": VECTORS["base"]["artifacts"]["responsible_principal_record"]["payload"]["human_id"],
        "keys": [
            {"kid": k["kid"], "alg": k["alg"], "public_key_b64": k["public_key_b64"], "status": "active"}
            for k in VECTORS["base"]["principal_keys"]
        ],
    }],
}
# The vectors name dcp-jcs-v1 in the manifest, so the router must accept it to take the v1 route.
CANDIDATE = create_verifier(transport="bare", accepted_profiles=["dcp-jcs-v1", "dcp-jcs-v2"], historical=JSON_LOADS_BYTES)


@pytest.mark.asyncio
@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
async def test_admission_and_candidate_route(case, registry):
    ok = case["expect"] == "accept"
    admission = await admit_signed_bundle_v2(_assemble(case), registry, trust=TRUST, now_ms=NOW)
    assert admission["verified"] is ok
    assert admission["admitted"] is ok
    assert admission["action_authorized"] is False
    routed = await CANDIDATE.verify(json.dumps(_assemble(case)).encode(), registry, now_ms=NOW)
    assert routed.entered == "dcp-jcs-v1"
    assert routed.verification["verified"] is ok
