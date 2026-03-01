"""
NIST KAT (Known Answer Test) Compliance Tests (Python SDK)

Ed25519: RFC 8032 deterministic test vectors.
ML-DSA-65: FIPS 204 property-based compliance (size, round-trip, rejection).

Phase 1 gate: no SDK ships V2 without passing all KAT tests.
"""

from __future__ import annotations

import base64
import json
from pathlib import Path

import nacl.signing
import pytest

from dcp_ai.providers.ed25519_provider import Ed25519Provider
from dcp_ai.v2.crypto_provider import derive_kid

KAT_DIR = Path(__file__).resolve().parent.parent.parent.parent / "tests" / "nist-kat"
INTEROP_PATH = Path(__file__).resolve().parent.parent.parent.parent / "tests" / "interop" / "v2" / "interop_vectors.json"


def load_kat(name: str) -> dict:
    with open(KAT_DIR / name / "vectors.json") as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Ed25519 RFC 8032 KAT
# ---------------------------------------------------------------------------


class TestEd25519KAT:
    """RFC 8032 Section 7.1 test vectors."""

    @pytest.fixture(scope="class")
    def kat(self):
        return load_kat("ed25519")

    def test_rfc8032_sign(self, kat):
        for vec in kat["test_vectors"]:
            sk_bytes = bytes.fromhex(vec["secret_key_hex"])
            pk_bytes = bytes.fromhex(vec["public_key_hex"])
            msg = bytes.fromhex(vec["message_hex"])
            expected_sig = bytes.fromhex(vec["signature_hex"])

            signing_key = nacl.signing.SigningKey(sk_bytes)
            signed = signing_key.sign(msg)
            assert signed.signature == expected_sig, f"sign mismatch for {vec['name']}"

    def test_rfc8032_verify(self, kat):
        for vec in kat["test_vectors"]:
            pk_bytes = bytes.fromhex(vec["public_key_hex"])
            msg = bytes.fromhex(vec["message_hex"])
            sig = bytes.fromhex(vec["signature_hex"])

            verify_key = nacl.signing.VerifyKey(pk_bytes)
            verify_key.verify(msg, sig)

    def test_rfc8032_tampered_fails(self, kat):
        for vec in kat["test_vectors"]:
            pk_bytes = bytes.fromhex(vec["public_key_hex"])
            msg = bytes.fromhex(vec["message_hex"])
            sig = bytearray(bytes.fromhex(vec["signature_hex"]))
            sig[0] ^= 0xFF

            verify_key = nacl.signing.VerifyKey(pk_bytes)
            with pytest.raises(Exception):
                verify_key.verify(msg, bytes(sig))


# ---------------------------------------------------------------------------
# Ed25519 Provider KAT
# ---------------------------------------------------------------------------


class TestEd25519ProviderKAT:
    @pytest.mark.asyncio
    async def test_key_sizes(self):
        p = Ed25519Provider()
        assert p.key_size == 32
        assert p.sig_size == 64

    @pytest.mark.asyncio
    async def test_kid_deterministic(self):
        p = Ed25519Provider()
        kp = await p.generate_keypair()
        pk_bytes = base64.b64decode(kp["public_key_b64"])
        assert derive_kid("ed25519", pk_bytes) == kp["kid"]
        assert len(kp["kid"]) == 32

    @pytest.mark.asyncio
    async def test_sign_verify_roundtrip(self):
        p = Ed25519Provider()
        kp = await p.generate_keypair()
        msg = b"KAT round-trip"
        sig = await p.sign(msg, kp["secret_key_b64"])
        assert len(sig) == 64
        assert await p.verify(msg, sig, kp["public_key_b64"]) is True

    @pytest.mark.asyncio
    async def test_wrong_key(self):
        p = Ed25519Provider()
        kp1 = await p.generate_keypair()
        kp2 = await p.generate_keypair()
        sig = await p.sign(b"test", kp1["secret_key_b64"])
        assert await p.verify(b"test", sig, kp2["public_key_b64"]) is False

    @pytest.mark.asyncio
    async def test_wrong_message(self):
        p = Ed25519Provider()
        kp = await p.generate_keypair()
        sig = await p.sign(b"A", kp["secret_key_b64"])
        assert await p.verify(b"B", sig, kp["public_key_b64"]) is False


# ---------------------------------------------------------------------------
# ML-DSA-65 FIPS 204 Property-Based KAT
# ---------------------------------------------------------------------------


class TestMlDsa65KAT:
    @pytest.fixture(scope="class")
    def kat(self):
        return load_kat("ml-dsa-65")

    @pytest.fixture(scope="class")
    def provider(self):
        try:
            from dcp_ai.providers.ml_dsa_65_provider import MlDsa65Provider
            return MlDsa65Provider()
        except ImportError:
            pytest.skip("pqcrypto not installed")

    def test_algorithm_id(self, provider):
        assert provider.alg == "ml-dsa-65"

    def test_key_size_matches_fips204(self, provider, kat):
        assert provider.key_size == kat["properties"]["public_key_size"]

    def test_sig_size_matches_fips204(self, provider, kat):
        assert provider.sig_size == kat["properties"]["signature_size"]

    @pytest.mark.asyncio
    async def test_generated_pk_size(self, provider):
        kp = await provider.generate_keypair()
        pk_bytes = base64.b64decode(kp["public_key_b64"])
        assert len(pk_bytes) == 1952

    @pytest.mark.asyncio
    async def test_kid_deterministic(self, provider):
        kp = await provider.generate_keypair()
        pk_bytes = base64.b64decode(kp["public_key_b64"])
        assert derive_kid("ml-dsa-65", pk_bytes) == kp["kid"]
        assert len(kp["kid"]) == 32

    @pytest.mark.asyncio
    async def test_sign_verify_roundtrip(self, provider):
        kp = await provider.generate_keypair()
        msg = b"ML-DSA-65 KAT round-trip"
        sig = await provider.sign(msg, kp["secret_key_b64"])
        assert len(sig) > 0
        assert await provider.verify(msg, sig, kp["public_key_b64"]) is True

    @pytest.mark.asyncio
    async def test_wrong_key(self, provider):
        kp1 = await provider.generate_keypair()
        kp2 = await provider.generate_keypair()
        sig = await provider.sign(b"test", kp1["secret_key_b64"])
        assert await provider.verify(b"test", sig, kp2["public_key_b64"]) is False

    @pytest.mark.asyncio
    async def test_wrong_message(self, provider):
        kp = await provider.generate_keypair()
        sig = await provider.sign(b"A", kp["secret_key_b64"])
        assert await provider.verify(b"B", sig, kp["public_key_b64"]) is False

    @pytest.mark.asyncio
    async def test_cross_sdk_verify(self, provider):
        """Verify that ML-DSA-65 signature from TS SDK verifies in Python."""
        with open(INTEROP_PATH) as f:
            V = json.load(f)
        entry = V["composite_signatures"]["passport_composite"]
        canonical = V["canonicalization"][entry["payload_key"]]["expected_canonical"]

        from dcp_ai.v2.domain_separation import domain_separated_message
        payload_bytes = canonical.encode("utf-8")
        dsm = domain_separated_message(entry["context"], payload_bytes)

        classical_sig = base64.b64decode(entry["composite_sig"]["classical"]["sig_b64"])
        composite_msg = dsm + classical_sig
        pq_sig = base64.b64decode(entry["composite_sig"]["pq"]["sig_b64"])
        pq_pk = V["test_keys"]["ml_dsa_65"]["public_key_b64"]

        valid = await provider.verify(composite_msg, pq_sig, pq_pk)
        assert valid is True, "Cross-SDK ML-DSA-65 verification failed"
