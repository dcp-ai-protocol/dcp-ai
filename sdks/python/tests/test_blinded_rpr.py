"""Blinded RPR: salted commitment, fail-closed blinding, and verify_blinded_rpr comparing every non-PII field."""

import re

import pytest

from dcp_ai.v2.blinded_rpr import blind_rpr, compute_pii_hash, generate_pii_salt, verify_blinded_rpr
from dcp_ai.v2.models import BlindedResponsiblePrincipalRecordV2, KeyEntryV2, ResponsiblePrincipalRecordV2


def _key(kid: str, alg: str) -> KeyEntryV2:
    return KeyEntryV2(kid=kid, alg=alg, public_key_b64="AAAA", created_at="2026-02-25T00:00:00Z")


def _rpr() -> ResponsiblePrincipalRecordV2:
    return ResponsiblePrincipalRecordV2(
        human_id="human-test",
        session_nonce="a" * 64,
        legal_name="Jane Doe",
        entity_type="natural_person",
        jurisdiction="US",
        liability_mode="owner_responsible",
        override_rights=True,
        issued_at="2026-02-25T00:00:00Z",
        expires_at="2027-02-25T00:00:00Z",
        contact="jane@example.com",
        binding_keys=[_key("k1", "ed25519"), _key("k2", "ml-dsa-65")],
        pii_salt=generate_pii_salt(),
    )


def test_matching_rpr_verifies():
    rpr = _rpr()
    assert verify_blinded_rpr(rpr, blind_rpr(rpr)) == {"valid": True, "errors": [], "warnings": []}


def test_blinded_rpr_parsed_from_json_verifies():
    rpr = _rpr()
    blinded = BlindedResponsiblePrincipalRecordV2.model_validate_json(blind_rpr(rpr).model_dump_json())
    assert verify_blinded_rpr(rpr, blinded) == {"valid": True, "errors": [], "warnings": []}


def test_different_binding_keys_fail():
    rpr = _rpr()
    blinded = blind_rpr(rpr).model_copy(update={"binding_keys": [_key("k2", "ml-dsa-65")]})
    result = verify_blinded_rpr(rpr, blinded)
    assert result["valid"] is False
    assert "binding_keys mismatch" in result["errors"]


def test_different_session_nonce_fails():
    rpr = _rpr()
    blinded = blind_rpr(rpr).model_copy(update={"session_nonce": "b" * 64})
    result = verify_blinded_rpr(rpr, blinded)
    assert result["valid"] is False
    assert "session_nonce mismatch" in result["errors"]


def test_blind_rpr_strips_pii_and_salt():
    blinded = blind_rpr(_rpr()).model_dump()
    assert not {"legal_name", "contact", "pii_salt"} & blinded.keys()


def test_blind_rpr_requires_pii_salt():
    with pytest.raises(ValueError, match=r"generate_pii_salt\(\)"):
        blind_rpr(_rpr().model_copy(update={"pii_salt": None}))


@pytest.mark.parametrize("salt", ["", "ab", "A" * 64, "g" * 64, "a" * 66, "a" * 64 + "\n", 42])
def test_blind_rpr_rejects_malformed_pii_salt(salt):
    with pytest.raises(ValueError, match=r"generate_pii_salt\(\)"):
        blind_rpr(_rpr().model_copy(update={"pii_salt": salt}))


@pytest.mark.parametrize("salt", ["", "ab", "A" * 64, 42])
def test_verify_rejects_malformed_pii_salt(salt):
    full = _rpr().model_copy(update={"pii_salt": salt})
    blinded = blind_rpr(_rpr()).model_copy(update={"pii_hash": compute_pii_hash(full)})
    result = verify_blinded_rpr(full, blinded)
    assert result["valid"] is False
    assert "pii_salt is not 32 random bytes as 64 lowercase hex" in result["errors"]


def test_unset_pii_salt_is_omitted_when_serialized():
    legacy = _rpr().model_copy(update={"pii_salt": None})
    assert "pii_salt" not in legacy.model_dump()
    assert '"pii_salt"' not in legacy.model_dump_json()
    assert re.fullmatch(r"[0-9a-f]{64}", _rpr().model_dump()["pii_salt"])


def test_generate_pii_salt_is_32_random_bytes_as_hex():
    salt = generate_pii_salt()
    assert re.fullmatch(r"[0-9a-f]{64}", salt)
    assert generate_pii_salt() != salt


def test_different_pii_salt_fails():
    rpr = _rpr()
    result = verify_blinded_rpr(rpr.model_copy(update={"pii_salt": generate_pii_salt()}), blind_rpr(rpr))
    assert result["valid"] is False
    assert any(e.startswith("pii_hash mismatch") for e in result["errors"])


def test_legacy_unsalted_record_verifies_with_warning():
    legacy = _rpr().model_copy(update={"pii_salt": None})
    blinded = blind_rpr(_rpr()).model_copy(update={"pii_hash": compute_pii_hash(legacy)})
    result = verify_blinded_rpr(legacy, blinded)
    assert result["valid"] is True
    assert result["errors"] == []
    assert len(result["warnings"]) == 1
    assert "legacy unsalted pii_hash" in result["warnings"][0]
