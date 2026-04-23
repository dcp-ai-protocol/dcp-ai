"""Smoke tests for DCP-07 (dispute), DCP-08 (rights), DCP-09 (delegation) Python ports."""

from __future__ import annotations

import pytest

from dcp_ai.providers.ed25519_provider import Ed25519Provider
from dcp_ai.providers.ml_dsa_65_provider import MlDsa65Provider
from dcp_ai.v2 import (
    AlgorithmRegistry,
    CompositeKeyInfo,
    # DCP-07 conflict resolution
    create_dispute,
    escalate_dispute,
    resolve_dispute,
    create_objection,
    # DCP-07 arbitration
    ArbitrationPanel,
    build_jurisprudence_bundle,
    create_arbitration_panel,
    lookup_precedent,
    submit_resolution,
    # DCP-08
    check_rights_compliance,
    declare_rights,
    record_obligation,
    report_violation,
    # DCP-09
    create_delegation_mandate,
    generate_interaction_record,
    revoke_delegation,
    verify_mandate_validity,
    create_advisory_declaration,
    create_awareness_threshold,
    evaluate_significance,
    should_notify_human,
    generate_mirror,
)


def _build_registry() -> AlgorithmRegistry:
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


@pytest.fixture
def registry() -> AlgorithmRegistry:
    return _build_registry()


# ── DCP-07 ──


@pytest.mark.asyncio
class TestDisputeLifecycle:
    async def test_create_escalate_resolve(self, registry):
        ck, pqk = await _fresh_keys(registry)
        dispute = await create_dispute(
            registry, ck, pqk,
            dispute_id="disp_001",
            session_nonce="a" * 64,
            initiator_agent_id="agent_A",
            respondent_agent_id="agent_B",
            dispute_type="authority_conflict",
            evidence_hashes=["sha256:" + "0" * 64],
        )
        assert dispute["escalation_level"] == "direct_negotiation"
        assert dispute["status"] == "open"

        escalated = await escalate_dispute(registry, ck, pqk, dispute, "b" * 64)
        assert escalated["escalation_level"] == "contextual_arbitration"
        assert escalated["status"] == "in_negotiation"

        final = await escalate_dispute(registry, ck, pqk, escalated, "c" * 64)
        assert final["escalation_level"] == "human_appeal"

        with pytest.raises(ValueError):
            await escalate_dispute(registry, ck, pqk, final, "d" * 64)

        resolved = await resolve_dispute(registry, ck, pqk, final, "e" * 64)
        assert resolved["status"] == "resolved"
        assert resolved["escalation_level"] == "human_appeal"

    async def test_create_objection(self, registry):
        ck, pqk = await _fresh_keys(registry)
        objection = await create_objection(
            registry, ck, pqk,
            objection_id="obj_001",
            session_nonce="a" * 64,
            agent_id="agent_A",
            directive_hash="sha256:" + "0" * 64,
            objection_type="ethical_concern",
            reasoning="Directive would cause disproportionate harm",
            proposed_alternative="Modify scope to exclude sensitive data",
            human_escalation_required=True,
        )
        assert objection["objection_type"] == "ethical_concern"
        assert objection["human_escalation_required"] is True


class TestArbitrationPanel:
    def test_valid_panel(self):
        panel = create_arbitration_panel(["arb_1", "arb_2", "arb_3"], 2)
        assert isinstance(panel, ArbitrationPanel)
        assert panel.threshold == 2

    def test_insufficient_arbitrators(self):
        with pytest.raises(ValueError):
            create_arbitration_panel(["arb_1"], 3)

    def test_invalid_threshold(self):
        with pytest.raises(ValueError):
            create_arbitration_panel(["arb_1", "arb_2"], 0)

    def test_lookup_precedent_filters(self):
        js = [
            {"category": "privacy", "applicable_contexts": ["healthcare", "finance"]},
            {"category": "privacy", "applicable_contexts": ["retail"]},
            {"category": "safety", "applicable_contexts": ["healthcare"]},
        ]
        assert len(lookup_precedent(js, "privacy")) == 2
        assert len(lookup_precedent(js, "privacy", context="healthcare")) == 1
        assert len(lookup_precedent(js, "nonexistent")) == 0


@pytest.mark.asyncio
class TestArbitrationSigning:
    async def test_submit_resolution(self, registry):
        ck, pqk = await _fresh_keys(registry)
        res = await submit_resolution(
            registry, ck, pqk,
            dispute_id="disp_001",
            session_nonce="a" * 64,
            arbitrator_ids=["arb_1", "arb_2"],
            resolution="Respondent to cease action X",
            binding=True,
            precedent_references=["juris_prev_001"],
        )
        assert res["binding"] is True
        assert res["composite_sig"]["binding"] == "pq_over_classical"

    async def test_build_jurisprudence(self, registry):
        ck, pqk = await _fresh_keys(registry)
        jb = await build_jurisprudence_bundle(
            registry, ck, pqk,
            jurisprudence_id="juris_001",
            session_nonce="a" * 64,
            dispute_id="disp_001",
            resolution_id="res_001",
            category="privacy",
            precedent_summary="Agent may not disclose PII without explicit consent",
            applicable_contexts=["healthcare", "finance"],
            authority_level="advisory",
        )
        assert jb["category"] == "privacy"


# ── DCP-08 ──


@pytest.mark.asyncio
class TestRightsAndObligations:
    async def test_declare_rights(self, registry):
        ck, pqk = await _fresh_keys(registry)
        d = await declare_rights(
            registry, ck, pqk,
            declaration_id="decl_001",
            session_nonce="a" * 64,
            agent_id="agent_A",
            rights=[{"right_type": "data_access", "scope": "public"}],
            jurisdiction="US-CA",
        )
        assert d["jurisdiction"] == "US-CA"

    async def test_record_obligation(self, registry):
        ck, pqk = await _fresh_keys(registry)
        o = await record_obligation(
            registry, ck, pqk,
            obligation_id="obl_001",
            session_nonce="a" * 64,
            agent_id="agent_A",
            human_id="human_1",
            obligation_type="data_retention",
            compliance_status="compliant",
            evidence_hashes=["sha256:" + "0" * 64],
        )
        assert o["compliance_status"] == "compliant"

    async def test_report_violation(self, registry):
        ck, pqk = await _fresh_keys(registry)
        v = await report_violation(
            registry, ck, pqk,
            violation_id="viol_001",
            session_nonce="a" * 64,
            agent_id="agent_A",
            violated_right="privacy",
            evidence_hashes=["sha256:" + "0" * 64],
            dispute_id=None,
        )
        assert v["violated_right"] == "privacy"
        assert v["dispute_id"] is None

    def test_check_compliance(self):
        result = check_rights_compliance(
            {"rights": []},
            [
                {"obligation_id": "o1", "obligation_type": "retention", "compliance_status": "compliant"},
                {"obligation_id": "o2", "obligation_type": "deletion", "compliance_status": "non_compliant"},
            ],
        )
        assert result["compliant"] is False
        assert len(result["violations"]) == 1


# ── DCP-09 ──


@pytest.mark.asyncio
class TestDelegationMandate:
    async def test_create_verify_revoke(self, registry):
        ck, pqk = await _fresh_keys(registry)
        from datetime import datetime, timedelta, timezone
        now = datetime.now(timezone.utc)
        mandate = await create_delegation_mandate(
            registry, ck, pqk,
            mandate_id="mand_001",
            session_nonce="a" * 64,
            human_id="human_1",
            agent_id="agent_A",
            authority_scope=[{"domain": "email", "actions": ["read"], "constraints": {}}],
            valid_from=(now - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
            valid_until=(now + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
            revocable=True,
        )
        # the special field name for the human principal signature
        assert "human_composite_sig" in mandate
        revoked: set[str] = set()
        result = verify_mandate_validity(mandate, revoked)
        assert result["valid"] is True

        rev = revoke_delegation(mandate, revoked)
        assert rev["revoked"] is True
        assert "mand_001" in revoked

        after = verify_mandate_validity(mandate, revoked)
        assert after["valid"] is False
        assert "revoked" in after["reason"].lower()

    async def test_non_revocable_mandate_cannot_be_revoked(self, registry):
        ck, pqk = await _fresh_keys(registry)
        from datetime import datetime, timedelta, timezone
        now = datetime.now(timezone.utc)
        mandate = await create_delegation_mandate(
            registry, ck, pqk,
            mandate_id="mand_fixed",
            session_nonce="a" * 64,
            human_id="human_1",
            agent_id="agent_A",
            authority_scope=[{"domain": "email", "actions": ["read"], "constraints": {}}],
            valid_from=(now - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
            valid_until=(now + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
            revocable=False,
        )
        revoked: set[str] = set()
        rev = revoke_delegation(mandate, revoked)
        assert rev["revoked"] is False

    async def test_generate_interaction_record(self, registry):
        ck, pqk = await _fresh_keys(registry)
        rec = await generate_interaction_record(
            registry, ck, pqk,
            interaction_id="int_001",
            session_nonce="a" * 64,
            agent_id="agent_A",
            counterparty_agent_id="agent_B",
            public_layer={"terms": "terms text", "decisions": "d", "commitments": "c"},
            private_layer_hash="sha256:" + "0" * 64,
            mandate_id="mand_001",
        )
        assert rec["composite_sig"]["binding"] == "pq_over_classical"


class TestAwarenessThresholdPure:
    def test_evaluate_significance_bounds(self):
        low = evaluate_significance({"financial_impact": 0.0})
        assert low == 0
        high = evaluate_significance(
            {
                "financial_impact": 1.0,
                "data_sensitivity": 1.0,
                "relationship_impact": 1.0,
                "irreversibility": 1.0,
                "precedent_setting": 1.0,
            }
        )
        assert high == 1000

    def test_should_notify_human_triggers(self):
        result = should_notify_human(
            600,
            [{"dimension": "significance", "operator": "gt", "value": 500, "action_if_triggered": "notify"}],
        )
        assert result["notify"] is True
        assert result["actions"] == ["notify"]

    def test_should_notify_human_below_threshold(self):
        result = should_notify_human(
            100,
            [{"dimension": "significance", "operator": "gt", "value": 500, "action_if_triggered": "notify"}],
        )
        assert result["notify"] is False


@pytest.mark.asyncio
class TestAwarenessThresholdSigning:
    async def test_create_threshold(self, registry):
        ck, pqk = await _fresh_keys(registry)
        th = await create_awareness_threshold(
            registry, ck, pqk,
            threshold_id="th_001",
            session_nonce="a" * 64,
            agent_id="agent_A",
            human_id="human_1",
            threshold_rules=[{"dimension": "significance", "operator": "gt", "value": 500, "action_if_triggered": "notify"}],
        )
        assert th["composite_sig"]["binding"] == "pq_over_classical"

    async def test_create_advisory(self, registry):
        ck, pqk = await _fresh_keys(registry)
        adv = await create_advisory_declaration(
            registry, ck, pqk,
            declaration_id="adv_001",
            session_nonce="a" * 64,
            agent_id="agent_A",
            human_id="human_1",
            significance_score=650,
            action_summary="Proposed outbound payment over threshold",
            recommended_response="Require explicit human confirmation",
            response_deadline="2026-04-30T00:00:00Z",
        )
        assert adv["significance_score"] == 650
        assert adv["human_response"] is None
        assert adv["proceeded_without_response"] is False


@pytest.mark.asyncio
class TestPrincipalMirror:
    async def test_generate_mirror(self, registry):
        ck, pqk = await _fresh_keys(registry)
        entries = [{"event": "start"}, {"event": "step"}, {"event": "end"}]
        mirror = await generate_mirror(
            registry, ck, pqk,
            mirror_id="mir_001",
            session_nonce="a" * 64,
            agent_id="agent_A",
            human_id="human_1",
            period={"from": "2026-04-01", "to": "2026-04-22"},
            audit_entries=entries,
            narrative="Agent completed 3 tasks.",
            decision_summary="All actions within policy.",
        )
        assert mirror["action_count"] == 3
        assert mirror["audit_chain_hash"].startswith("sha256:")
