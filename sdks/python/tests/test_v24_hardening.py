"""Tests for v2.4 production hardening primitives — Python."""

from __future__ import annotations

import hashlib

import pytest

from dcp_ai.providers.ed25519_provider import Ed25519Provider
from dcp_ai.providers.ml_dsa_65_provider import MlDsa65Provider
from dcp_ai.v2 import (
    AlgorithmRegistry,
    CompositeKeyInfo,
    PQCheckpointManager,
    audit_events_merkle_root,
    build_emergency_revocation,
    compute_security_tier,
    create_pq_checkpoint,
    generate_emergency_revocation_token,
    generate_session_expiry,
    generate_session_nonce,
    is_session_expired,
    is_valid_session_nonce,
    max_tier,
    tier_to_checkpoint_interval,
    tier_to_verification_mode,
    verify_emergency_revocation_secret,
    verify_session_binding,
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


# ── Session nonce ──


class TestSessionNonce:
    def test_generate_has_right_shape(self):
        n = generate_session_nonce()
        assert len(n) == 64
        assert all(c in "0123456789abcdef" for c in n)

    def test_validator(self):
        assert is_valid_session_nonce("a" * 64) is True
        assert is_valid_session_nonce("A" * 64) is False  # uppercase not allowed
        assert is_valid_session_nonce("a" * 63) is False
        assert is_valid_session_nonce(None) is False  # type: ignore[arg-type]

    def test_verify_binding_consistent(self):
        nonce = "a" * 64
        result = verify_session_binding([{"session_nonce": nonce}, {"session_nonce": nonce}])
        assert result["valid"] is True
        assert result["nonce"] == nonce

    def test_verify_binding_mismatch(self):
        result = verify_session_binding([{"session_nonce": "a" * 64}, {"session_nonce": "b" * 64}])
        assert result["valid"] is False
        assert "mismatch" in result["error"]

    def test_verify_binding_empty(self):
        assert verify_session_binding([])["valid"] is False

    def test_expiry_default_and_tier(self):
        default = generate_session_expiry()
        routine = generate_session_expiry(tier="routine")
        maximum = generate_session_expiry(tier="maximum")
        # routine > default > maximum in duration; just assert they're ISO strings
        for t in [default, routine, maximum]:
            assert t.endswith("Z")
        assert is_session_expired(generate_session_expiry(-1)) is True


# ── Security tier ──


class TestSecurityTier:
    def test_routine_default(self):
        assert compute_security_tier({}) == "routine"

    def test_standard_threshold(self):
        assert compute_security_tier({"risk_score": 200}) == "standard"
        assert compute_security_tier({"risk_score": 499}) == "standard"

    def test_elevated_on_sensitive_data(self):
        assert compute_security_tier({"data_classes": ["pii"]}) == "elevated"

    def test_elevated_on_payment(self):
        assert compute_security_tier({"action_type": "initiate_payment"}) == "elevated"

    def test_maximum_on_credentials(self):
        assert compute_security_tier({"data_classes": ["credentials"]}) == "maximum"

    def test_maximum_on_score_800(self):
        assert compute_security_tier({"risk_score": 800}) == "maximum"

    def test_max_tier_never_downgrades(self):
        assert max_tier("routine", "maximum") == "maximum"
        assert max_tier("elevated", "standard") == "elevated"

    def test_tier_to_mode_and_interval(self):
        assert tier_to_verification_mode("maximum") == "hybrid_required"
        assert tier_to_verification_mode("routine") == "classical_only"
        assert tier_to_checkpoint_interval("routine") == 50
        assert tier_to_checkpoint_interval("maximum") == 1


# ── Emergency revocation ──


class TestEmergencyRevocation:
    def test_round_trip(self):
        pair = generate_emergency_revocation_token()
        assert pair["emergency_revocation_token"].startswith("sha256:")
        assert len(pair["revocation_secret"]) == 64
        assert verify_emergency_revocation_secret(
            pair["revocation_secret"], pair["emergency_revocation_token"]
        ) is True

    def test_wrong_secret(self):
        pair = generate_emergency_revocation_token()
        assert verify_emergency_revocation_secret("f" * 64, pair["emergency_revocation_token"]) is False

    def test_bad_prefix(self):
        pair = generate_emergency_revocation_token()
        assert verify_emergency_revocation_secret(pair["revocation_secret"], "md5:0") is False

    def test_bad_length(self):
        pair = generate_emergency_revocation_token()
        assert verify_emergency_revocation_secret("ab", pair["emergency_revocation_token"]) is False

    def test_build_request(self):
        pair = generate_emergency_revocation_token()
        req = build_emergency_revocation(
            agent_id="agent_X",
            human_id="human_1",
            revocation_secret=pair["revocation_secret"],
        )
        assert req["type"] == "emergency_revocation"
        assert req["reason"] == "key_compromise_emergency"


# ── PQ checkpoint ──


def _make_event(i: int) -> dict:
    return {
        "audit_id": f"evt_{i:03d}",
        "session_nonce": "a" * 64,
        "event_type": "intent",
        "seq": i,
    }


@pytest.mark.asyncio
class TestPQCheckpoint:
    async def test_merkle_root_deterministic(self):
        events = [_make_event(i) for i in range(1, 5)]
        r1 = audit_events_merkle_root(events)
        r2 = audit_events_merkle_root(events)
        assert r1 == r2
        assert len(r1) == 64

    async def test_merkle_root_empty_raises(self):
        with pytest.raises(ValueError):
            audit_events_merkle_root([])

    async def test_create_checkpoint(self, registry):
        ck, pqk = await _fresh_keys(registry)
        events = [_make_event(i) for i in range(1, 6)]
        ckpt = await create_pq_checkpoint(registry, events, "a" * 64, ck, pqk)
        assert ckpt["event_range"]["count"] == 5
        assert ckpt["merkle_root"].startswith("sha256:")
        assert ckpt["composite_sig"]["binding"] == "pq_over_classical"

    async def test_manager_flush_interval(self, registry):
        ck, pqk = await _fresh_keys(registry)
        mgr = PQCheckpointManager(
            interval=3,
            registry=registry,
            session_nonce="a" * 64,
            classical_key=ck,
            pq_key=pqk,
        )
        assert mgr.interval == 3
        assert mgr.get_pending_count() == 0

        for i in range(1, 3):
            got = await mgr.record_event(_make_event(i))
            assert got is None  # not yet at interval
        got = await mgr.record_event(_make_event(3))
        assert got is not None
        assert got["event_range"]["count"] == 3

        # After auto-flush, pending is empty; flush returns None until new events arrive
        assert mgr.get_pending_count() == 0
        assert await mgr.flush() is None

        # Second batch: manual flush
        await mgr.record_event(_make_event(4))
        await mgr.record_event(_make_event(5))
        got = await mgr.flush()
        assert got is not None
        assert got["event_range"]["count"] == 2
        assert len(mgr.get_checkpoints()) == 2

    async def test_manager_tier_sets_interval(self, registry):
        ck, pqk = await _fresh_keys(registry)
        mgr = PQCheckpointManager(
            interval=1,
            registry=registry,
            session_nonce="a" * 64,
            classical_key=ck,
            pq_key=pqk,
            tier="routine",
        )
        assert mgr.tier == "routine"
        assert mgr.interval == 50  # routine interval
        mgr.set_tier("maximum")
        assert mgr.tier == "maximum"
        assert mgr.interval == 1
