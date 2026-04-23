"""Tests for DCP-04 A2A Python port."""

from __future__ import annotations

import pytest

from dcp_ai.v2 import (
    A2ASession,
    create_agent_directory,
    create_close_message,
    create_hello,
    create_session,
    create_welcome,
    decrypt_message,
    derive_session_id,
    encrypt_message,
    find_agent_by_capability,
    find_agent_by_id,
    generate_nonce,
    generate_resume_proof,
    needs_rekeying,
    validate_directory_entry,
    verify_resume_proof,
)


# ── Discovery ──


def _agent(agent_id: str, caps: list[str], status: str = "active") -> dict:
    return {
        "agent_id": agent_id,
        "agent_name": agent_id.replace("_", " ").title(),
        "capabilities": caps,
        "bundle_endpoint": f"https://example.com/{agent_id}/bundle",
        "a2a_endpoint": f"wss://example.com/{agent_id}/a2a",
        "a2a_transports": ["websocket"],
        "security_tier_minimum": "standard",
        "supported_algorithms": {"signing": ["ed25519"], "kem": ["x25519-ml-kem-768"]},
        "status": status,
        "updated_at": "2026-04-01T00:00:00Z",
    }


class TestDiscovery:
    def test_create_directory(self):
        d = create_agent_directory("Example Org", [_agent("a1", ["read"])])
        assert d["dcp_version"] == "2.0"
        assert d["organization"] == "Example Org"
        assert len(d["agents"]) == 1

    def test_find_by_capability(self):
        d = create_agent_directory("", [
            _agent("agent_A", ["read", "write"]),
            _agent("agent_B", ["admin"]),
        ])
        assert find_agent_by_capability(d, ["read"])["agent_id"] == "agent_A"
        assert find_agent_by_capability(d, ["admin"])["agent_id"] == "agent_B"
        assert find_agent_by_capability(d, ["nonexistent"]) is None

    def test_find_skips_non_active(self):
        d = create_agent_directory("", [_agent("agent_R", ["read"], status="revoked")])
        assert find_agent_by_capability(d, ["read"]) is None

    def test_find_by_id(self):
        d = create_agent_directory("", [_agent("agent_A", ["read"])])
        assert find_agent_by_id(d, "agent_A")["agent_id"] == "agent_A"
        assert find_agent_by_id(d, "missing") is None

    def test_validate_reports_missing_fields(self):
        errors = validate_directory_entry({"agent_id": "", "capabilities": [], "status": "bogus"})
        # at least: agent_id, capabilities, bundle_endpoint, a2a_endpoint, agent_name, status
        assert any("agent_id" in e for e in errors)
        assert any("capabilities" in e for e in errors)
        assert any("Invalid status" in e for e in errors)


# ── Handshake ──


class TestHandshake:
    def test_hello_shape(self):
        h = create_hello({"bundle": "stub"}, "base64pub", ["read"], "standard")
        assert h["type"] == "A2A_HELLO"
        assert h["protocol_version"] == "2.0"
        assert h["security_tier"] == "standard"
        assert h["ephemeral_kem_public_key"]["public_key_b64"] == "base64pub"
        assert len(h["nonce"]) == 64

    def test_welcome_shape(self):
        w = create_welcome({"bundle": "stub"}, "respkem", "ciphertextb64", "elevated")
        assert w["type"] == "A2A_WELCOME"
        assert w["resolved_security_tier"] == "elevated"
        assert w["kem_ciphertext"]["ciphertext_b64"] == "ciphertextb64"

    def test_derive_session_id_is_stable(self):
        key = b"\x01" * 32
        s1 = derive_session_id("a", "b", "a" * 64, "b" * 64, key)
        s2 = derive_session_id("a", "b", "a" * 64, "b" * 64, key)
        assert s1 == s2
        assert len(s1) == 64

    def test_close_message(self):
        c = create_close_message("sess_001", "complete", 42, "sha256:0")
        assert c["type"] == "A2A_CLOSE"
        assert c["reason"] == "complete"
        assert c["final_sequence"] == 42


# ── Session ──


def _pair_sessions(tier: str = "standard") -> tuple[A2ASession, A2ASession]:
    key = b"k" * 32  # any 32-byte key
    left = create_session("sess_x", key, "agent_L", "agent_R", tier)
    right = create_session("sess_x", key, "agent_R", "agent_L", tier)
    return left, right


class TestSession:
    def test_key_length_enforced(self):
        with pytest.raises(ValueError):
            create_session("x", b"short", "l", "r", "routine")

    def test_encrypt_decrypt_round_trip(self):
        left, right = _pair_sessions()
        msg = encrypt_message(left, {"hello": "world", "n": 42})
        got = decrypt_message(right, msg)
        assert got == {"hello": "world", "n": 42}
        assert left.message_counter_send == 1
        assert right.message_counter_recv == 1

    def test_tamper_ciphertext_rejected(self):
        import base64

        left, right = _pair_sessions()
        msg = encrypt_message(left, {"a": 1})
        tampered = dict(msg)
        ct = base64.b64decode(tampered["encrypted_payload"])
        tampered["encrypted_payload"] = base64.b64encode(b"\xff" + ct[1:]).decode()
        with pytest.raises(Exception):
            decrypt_message(right, tampered)

    def test_session_id_mismatch(self):
        left, _ = _pair_sessions()
        other = create_session("sess_other", b"k" * 32, "agent_R", "agent_L", "standard")
        msg = encrypt_message(left, {"a": 1})
        with pytest.raises(ValueError):
            decrypt_message(other, msg)

    def test_cannot_send_on_closed_session(self):
        left, _ = _pair_sessions()
        left.status = "closed"
        with pytest.raises(ValueError):
            encrypt_message(left, {"a": 1})

    def test_needs_rekeying(self):
        left, _ = _pair_sessions()
        left.message_counter_send = 999
        assert needs_rekeying(left) is False
        left.message_counter_send = 1000
        assert needs_rekeying(left) is True

    def test_resume_proof_round_trip(self):
        left, _ = _pair_sessions()
        p = generate_resume_proof(left, 10)
        assert verify_resume_proof(left, 10, p) is True
        assert verify_resume_proof(left, 11, p) is False


class TestNonce:
    def test_generate_hex(self):
        n = generate_nonce()
        assert len(n) == 64
        assert all(c in "0123456789abcdef" for c in n)
