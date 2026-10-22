"""Blinded RPR: verify_blinded_rpr must compare every non-PII field."""

from dcp_ai.v2.blinded_rpr import blind_rpr, verify_blinded_rpr
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
    )


def test_matching_rpr_verifies():
    rpr = _rpr()
    assert verify_blinded_rpr(rpr, blind_rpr(rpr)) == {"valid": True, "errors": []}


def test_blinded_rpr_parsed_from_json_verifies():
    rpr = _rpr()
    blinded = BlindedResponsiblePrincipalRecordV2.model_validate_json(blind_rpr(rpr).model_dump_json())
    assert verify_blinded_rpr(rpr, blinded) == {"valid": True, "errors": []}


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
