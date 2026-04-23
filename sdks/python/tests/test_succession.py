"""Tests for DCP-06 (Digital Succession) Python port."""

from __future__ import annotations

import pytest

from dcp_ai.providers.ed25519_provider import Ed25519Provider
from dcp_ai.providers.ml_dsa_65_provider import MlDsa65Provider
from dcp_ai.v2 import (
    AlgorithmRegistry,
    CompositeKeyInfo,
    classify_memory,
    create_digital_testament,
    create_memory_transfer_manifest,
    execute_succession,
    update_digital_testament,
)


def _build_registry() -> AlgorithmRegistry:
    r = AlgorithmRegistry()
    r.register_signer(Ed25519Provider())
    r.register_signer(MlDsa65Provider())
    return r


async def _fresh_keys(registry: AlgorithmRegistry) -> tuple[CompositeKeyInfo, CompositeKeyInfo]:
    ed = await registry.get_signer("ed25519").generate_keypair()
    pq = await registry.get_signer("ml-dsa-65").generate_keypair()
    classical = CompositeKeyInfo(
        kid=ed["kid"],
        alg="ed25519",
        secret_key_b64=ed["secret_key_b64"],
        public_key_b64=ed["public_key_b64"],
    )
    pq_k = CompositeKeyInfo(
        kid=pq["kid"],
        alg="ml-dsa-65",
        secret_key_b64=pq["secret_key_b64"],
        public_key_b64=pq["public_key_b64"],
    )
    return classical, pq_k


@pytest.fixture
def registry() -> AlgorithmRegistry:
    return _build_registry()


class TestClassifyMemory:
    def test_transfer_vs_destroy_partitioning(self):
        result = classify_memory(
            entries=[
                {"hash": "hA", "category": "operational", "size": 100},
                {"hash": "hB", "category": "relational", "size": 50},
                {"hash": "hC", "category": "secrets", "size": 30},
            ],
            classification={
                "operational": "transfer",
                "relational": "destroy",
                "secrets": "destroy",
            },
        )
        assert len(result["operational"]) == 1
        assert result["operational"][0]["hash"] == "hA"
        assert set(result["relational_destroyed"]) == {"hB", "hC"}

    def test_unknown_category_defaults_to_destroy(self):
        result = classify_memory(
            entries=[{"hash": "hX", "category": "unknown", "size": 1}],
            classification={},
        )
        assert result["operational"] == []
        assert result["relational_destroyed"] == ["hX"]

    def test_retain_is_neither_transferred_nor_destroyed(self):
        result = classify_memory(
            entries=[{"hash": "hR", "category": "local", "size": 10}],
            classification={"local": "retain"},
        )
        assert result["operational"] == []
        assert result["relational_destroyed"] == []


@pytest.mark.asyncio
class TestDigitalTestament:
    async def test_first_version_is_genesis(self, registry):
        classical, pq = await _fresh_keys(registry)
        testament = await create_digital_testament(
            registry,
            classical,
            pq,
            agent_id="agent_123",
            session_nonce="a" * 64,
            successor_preferences=[{"agent_id": "agent_succ", "priority": 1}],
            memory_classification={"operational": "transfer"},
            human_consent_required=True,
        )
        assert testament["testament_version"] == 1
        assert testament["prev_testament_hash"] == "GENESIS"
        assert testament["created_at"] == testament["last_updated"]

    async def test_update_increments_version_and_chains_hash(self, registry):
        classical, pq = await _fresh_keys(registry)
        v1 = await create_digital_testament(
            registry,
            classical,
            pq,
            agent_id="agent_123",
            session_nonce="a" * 64,
            successor_preferences=[{"agent_id": "agent_succ", "priority": 1}],
            memory_classification={"operational": "transfer"},
            human_consent_required=True,
        )
        v2 = await update_digital_testament(
            registry,
            classical,
            pq,
            v1,
            session_nonce="b" * 64,
            human_consent_required=False,
        )
        assert v2["testament_version"] == 2
        assert v2["prev_testament_hash"].startswith("sha256:")
        assert v2["created_at"] == v1["created_at"]  # created_at preserved
        assert v2["human_consent_required"] is False
        # fields we didn't override come from v1
        assert v2["successor_preferences"] == v1["successor_preferences"]
        assert v2["memory_classification"] == v1["memory_classification"]


@pytest.mark.asyncio
class TestMemoryTransferAndExecute:
    async def test_manifest_shape(self, registry):
        classical, pq = await _fresh_keys(registry)
        manifest = await create_memory_transfer_manifest(
            registry,
            classical,
            pq,
            session_nonce="a" * 64,
            predecessor_agent_id="agent_pred",
            successor_agent_id="agent_succ",
            operational_memory=[{"hash": "hA", "category": "operational", "size": 100}],
            relational_memory_destroyed=["hB"],
            transfer_hash={"sha256": "0" * 64, "sha3_256": "1" * 64},
        )
        assert manifest["predecessor_agent_id"] == "agent_pred"
        assert manifest["successor_agent_id"] == "agent_succ"
        assert manifest["composite_sig"]["binding"] == "pq_over_classical"

    async def test_execute_succession_requires_participants(self, registry):
        classical, pq = await _fresh_keys(registry)
        with pytest.raises(ValueError):
            await execute_succession(
                registry,
                classical,
                pq,
                predecessor_agent_id="agent_pred",
                successor_agent_id="agent_succ",
                session_nonce="a" * 64,
                transition_type="planned",
                human_consent=None,
                ceremony_participants=[],
                memory_transfer_manifest_hash="sha256:" + "0" * 64,
            )

    async def test_execute_succession_happy_path(self, registry):
        classical, pq = await _fresh_keys(registry)
        record = await execute_succession(
            registry,
            classical,
            pq,
            predecessor_agent_id="agent_pred",
            successor_agent_id="agent_succ",
            session_nonce="a" * 64,
            transition_type="planned",
            human_consent={"human_id": "h1", "decision": "approved"},
            ceremony_participants=["p1", "p2"],
            memory_transfer_manifest_hash="sha256:" + "0" * 64,
        )
        assert record["transition_type"] == "planned"
        assert len(record["ceremony_participants"]) == 2
        assert record["composite_sig"]["binding"] == "pq_over_classical"
