"""Contrast with the shared vectors tests/interop/v2/audit_entry_roundtrip_vectors.json (RawAuditEventV2 lives in the
Rust and Go SDKs; Python keeps JSON values as dicts). canonicalize_v2 must reproduce each hand-written dcp-jcs-v1 text,
and string_evidence_bundle must verify while each of its mutations is rejected."""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path

import pytest

from dcp_ai.providers import Ed25519Provider, MlDsa65Provider
from dcp_ai.v2.canonicalize import canonicalize_v2
from dcp_ai.v2.crypto_registry import AlgorithmRegistry
from dcp_ai.v2.session_nonce import rfc3339_epoch_ms
from dcp_ai.v2.verify import verify_signed_bundle_v2

VECTORS = json.loads(
    (Path(__file__).resolve().parents[3] / "tests" / "interop" / "v2" / "audit_entry_roundtrip_vectors.json").read_text(
        encoding="utf-8"
    )
)
ENTRIES = VECTORS["entries"]
BUNDLE = VECTORS["string_evidence_bundle"]


@pytest.fixture(scope="module")
def registry() -> AlgorithmRegistry:
    r = AlgorithmRegistry()
    r.register_signer(Ed25519Provider())
    r.register_signer(MlDsa65Provider())
    return r


@pytest.mark.parametrize("case", ENTRIES, ids=[c["name"] for c in ENTRIES])
def test_canonicalize_v2_reproduces_the_hand_written_text(case):
    value = case["entry"] if "entry" in case else json.loads(case["entry_json"])
    assert canonicalize_v2(value) == case["canonical"]
    assert hashlib.sha256(case["canonical"].encode("utf-8")).hexdigest() == case["canonical_sha256"]


def test_fourteen_entries():
    assert len(ENTRIES) == 14


@pytest.mark.asyncio
async def test_string_evidence_bundle_verifies_and_each_mutation_is_rejected(registry):
    now = rfc3339_epoch_ms(BUNDLE["verification_time"])
    base = await verify_signed_bundle_v2(BUNDLE["signed_bundle"], registry, BUNDLE["verifier_policy"], now_ms=now)
    assert base["errors"] == []
    assert base["verified"] is True
    assert len(BUNDLE["mutations"]) == 8
    for m in BUNDLE["mutations"]:
        mutated = copy.deepcopy(BUNDLE["signed_bundle"])
        node = mutated["bundle"]["audit_entries"][m["entry_index"]]
        for key in m["path"][:-1]:
            node = node[key]
        if m["op"] == "set":
            node[m["path"][-1]] = m["value"]
        else:
            del node[m["path"][-1]]
        result = await verify_signed_bundle_v2(mutated, registry, BUNDLE["verifier_policy"], now_ms=now)
        assert result["verified"] is False, m["name"]
        assert result["errors"], m["name"]
