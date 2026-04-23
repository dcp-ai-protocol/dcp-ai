"""Tests for DCP-05 (Agent Lifecycle) Python port."""

from __future__ import annotations

import pytest

from dcp_ai.providers.ed25519_provider import Ed25519Provider
from dcp_ai.providers.ml_dsa_65_provider import MlDsa65Provider
from dcp_ai.v2 import (
    AlgorithmRegistry,
    CompositeKeyInfo,
    compute_vitality_score,
    create_commissioning_certificate,
    create_decommissioning_record,
    create_vitality_report,
    hash_vitality_report,
    validate_state_transition,
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


class TestStateTransitions:
    def test_commissioned_to_active_is_allowed(self):
        assert validate_state_transition("commissioned", "active") is True

    def test_commissioned_to_decommissioned_is_allowed(self):
        assert validate_state_transition("commissioned", "decommissioned") is True

    def test_active_to_declining_is_allowed(self):
        assert validate_state_transition("active", "declining") is True

    def test_declining_to_active_is_allowed(self):
        assert validate_state_transition("declining", "active") is True

    def test_decommissioned_is_terminal(self):
        assert validate_state_transition("decommissioned", "active") is False
        assert validate_state_transition("decommissioned", "commissioned") is False

    def test_invalid_jump_is_rejected(self):
        assert validate_state_transition("commissioned", "declining") is False

    def test_unknown_source_state_is_rejected(self):
        assert validate_state_transition("bogus", "active") is False


class TestVitalityScore:
    def test_perfect_metrics_give_max_score(self):
        score = compute_vitality_score(
            {
                "task_completion_rate": 1.0,
                "error_rate": 0.0,
                "human_satisfaction": 1.0,
                "policy_alignment": 1.0,
            }
        )
        assert score == 1000

    def test_zero_metrics_with_perfect_error(self):
        score = compute_vitality_score(
            {
                "task_completion_rate": 0.0,
                "error_rate": 0.0,
                "human_satisfaction": 0.0,
                "policy_alignment": 0.0,
            }
        )
        # only the inverted error_rate contributes: 1.0 * 0.25
        assert score == 250

    def test_all_zero_with_error_one_gives_zero(self):
        score = compute_vitality_score(
            {
                "task_completion_rate": 0.0,
                "error_rate": 1.0,
                "human_satisfaction": 0.0,
                "policy_alignment": 0.0,
            }
        )
        assert score == 0

    def test_score_is_bounded_between_zero_and_thousand(self):
        score = compute_vitality_score(
            {
                "task_completion_rate": 2.0,  # over 1
                "error_rate": -1.0,  # negative
                "human_satisfaction": 0.5,
                "policy_alignment": 0.5,
            }
        )
        assert 0 <= score <= 1000


@pytest.mark.asyncio
class TestArtifactCreation:
    async def test_commissioning_certificate_shape(self, registry):
        classical, pq = await _fresh_keys(registry)
        cert = await create_commissioning_certificate(
            registry,
            classical,
            pq,
            agent_id="agent_123",
            session_nonce="a" * 64,
            human_id="human_456",
            commissioning_authority="org.example",
            purpose="Research assistant",
            initial_capabilities=["read_email", "draft_response"],
            risk_tier="medium",
            principal_binding_reference="rpr_hash_abc",
        )
        assert cert["dcp_version"] == "2.0"
        assert cert["agent_id"] == "agent_123"
        assert cert["risk_tier"] == "medium"
        assert cert["composite_sig"]["binding"] == "pq_over_classical"
        assert cert["composite_sig"]["classical"]["alg"] == "ed25519"
        assert cert["composite_sig"]["pq"]["alg"] == "ml-dsa-65"

    async def test_vitality_report_computes_score(self, registry):
        # DCP-AI v2.0 prohibits floats in canonicalization (cross-SDK determinism),
        # so on-the-wire metrics must be expressed at integer boundary values.
        # compute_vitality_score accepts floats; signed artifact metrics must be 0/1.
        classical, pq = await _fresh_keys(registry)
        report = await create_vitality_report(
            registry,
            classical,
            pq,
            agent_id="agent_123",
            session_nonce="a" * 64,
            state="active",
            metrics={
                "task_completion_rate": 1,
                "error_rate": 0,
                "human_satisfaction": 1,
                "policy_alignment": 1,
            },
            prev_report_hash="GENESIS",
        )
        assert report["state"] == "active"
        assert 0 <= report["vitality_score"] <= 1000
        assert report["prev_report_hash"] == "GENESIS"

    async def test_vitality_chain_hash_is_deterministic(self, registry):
        classical, pq = await _fresh_keys(registry)
        report = await create_vitality_report(
            registry,
            classical,
            pq,
            agent_id="agent_123",
            session_nonce="a" * 64,
            state="active",
            metrics={
                "task_completion_rate": 1,
                "error_rate": 0,
                "human_satisfaction": 1,
                "policy_alignment": 1,
            },
            prev_report_hash="GENESIS",
        )
        h1 = hash_vitality_report(report)
        h2 = hash_vitality_report(report)
        assert h1 == h2
        assert h1.startswith("sha256:")
        assert len(h1) == len("sha256:") + 64

    async def test_decommissioning_record_with_successor(self, registry):
        classical, pq = await _fresh_keys(registry)
        record = await create_decommissioning_record(
            registry,
            classical,
            pq,
            agent_id="agent_123",
            session_nonce="a" * 64,
            human_id="human_456",
            termination_mode="planned_retirement",
            reason="project_closure",
            final_vitality_score=842,
            successor_agent_id="agent_789",
            data_disposition="transferred",
        )
        assert record["successor_agent_id"] == "agent_789"
        assert record["final_vitality_score"] == 842
        assert record["composite_sig"]["binding"] == "pq_over_classical"

    async def test_decommissioning_record_without_successor(self, registry):
        classical, pq = await _fresh_keys(registry)
        record = await create_decommissioning_record(
            registry,
            classical,
            pq,
            agent_id="agent_123",
            session_nonce="a" * 64,
            human_id="human_456",
            termination_mode="termination_for_cause",
            reason="policy_violation",
            final_vitality_score=120,
            successor_agent_id=None,
            data_disposition="destroyed",
        )
        assert record["successor_agent_id"] is None
        assert record["data_disposition"] == "destroyed"
