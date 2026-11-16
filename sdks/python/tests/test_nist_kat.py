"""
NIST KAT (Known Answer Test) Compliance Tests (Python SDK)

Ed25519: RFC 8032 deterministic test vectors.
ML-DSA-65: FIPS 204 property-based compliance (size, round-trip, rejection).
ML-DSA-65: independent verification vectors (NIST ACVP tc39 + Wycheproof), empty context.
SLH-DSA-192f: FIPS 205 NIST ACVP signature verification + properties.
ML-KEM-768: FIPS 203 NIST ACVP decapsulation and key checks + properties.

Phase 1 gate: no SDK ships V2 without passing all KAT tests.
"""

from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path

import nacl.signing
import pytest
from pqcrypto.sign import slh_dsa_sha2_192f

from dcp_ai.providers import Ed25519Provider, MlDsa65Provider, MlKem768Provider, SlhDsa192fProvider
from dcp_ai.v2.crypto_provider import derive_kid

KAT_DIR = Path(__file__).resolve().parent.parent.parent.parent / "tests" / "nist-kat"
INTEROP_PATH = Path(__file__).resolve().parent.parent.parent.parent / "tests" / "interop" / "v2" / "interop_vectors.json"
CROSS_SDK_PATH = INTEROP_PATH.with_name("cross_sdk_vectors.json")


def load_kat(name: str) -> dict:
    with open(KAT_DIR / name / "vectors.json") as f:
        return json.load(f)


def load_cross_sdk(section: str) -> dict:
    with open(CROSS_SDK_PATH) as f:
        return json.load(f)[section]


def hex_to_b64(value: str) -> str:
    return base64.b64encode(bytes.fromhex(value)).decode("ascii")


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
        return MlDsa65Provider()

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


# ---------------------------------------------------------------------------
# SLH-DSA-SHA2-192f FIPS 205 KAT
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def slh_kat():
    return load_kat("slh-dsa-192f")


@pytest.fixture(scope="module")
def slh():
    return SlhDsa192fProvider()


class TestSlhDsa192fKAT:
    def test_sizes_match_fips205(self, slh, slh_kat):
        assert slh.alg == slh_kat["properties"]["algorithm"]
        assert slh.key_size == slh_kat["properties"]["public_key_size"]
        assert slh.sig_size == slh_kat["properties"]["signature_size"]

    def test_nist_signature_verification(self, slh_kat):
        """NIST ACVP external/pure sigVer cases (they carry a context, so call pqcrypto directly)."""
        for vec in slh_kat["signature_verification"]:
            try:
                slh_dsa_sha2_192f.verify(
                    bytes.fromhex(vec["pk"]),
                    bytes.fromhex(vec["message"]),
                    bytes.fromhex(vec["signature"]),
                    bytes.fromhex(vec["context"]),
                )
                valid = True
            except ValueError:
                valid = False
            assert valid is vec["testPassed"], f"tcId {vec['tcId']}: {vec['reason']}"

    @pytest.mark.asyncio
    async def test_keygen_sign_verify(self, slh, slh_kat):
        props = slh_kat["properties"]
        kp = await slh.generate_keypair()
        pk_bytes = base64.b64decode(kp["public_key_b64"])
        assert len(pk_bytes) == props["public_key_size"]
        assert len(base64.b64decode(kp["secret_key_b64"])) == props["secret_key_size"]
        assert kp["kid"] == derive_kid("slh-dsa-192f", pk_bytes)

        msg = b"SLH-DSA-192f KAT round-trip"
        sig = await slh.sign(msg, kp["secret_key_b64"])
        assert len(sig) == props["signature_size"]
        assert await slh.verify(msg, sig, kp["public_key_b64"]) is True
        assert await slh.verify(b"another message", sig, kp["public_key_b64"]) is False
        other = await slh.generate_keypair()
        assert await slh.verify(msg, sig, other["public_key_b64"]) is False
        assert await slh.verify(msg, sig[:-1], kp["public_key_b64"]) is False

    @pytest.mark.asyncio
    async def test_cross_sdk_verify(self, slh):
        """SLH-DSA-192f signature from the TypeScript SDK (@noble/post-quantum) verifies in Python."""
        vec = load_cross_sdk("typescript")["slh_dsa_192f"]
        msg = bytes.fromhex(vec["message_hex"])
        sig = base64.b64decode(vec["sig_b64"])
        assert derive_kid("slh-dsa-192f", base64.b64decode(vec["public_key_b64"])) == vec["kid"]
        assert await slh.verify(msg, sig, vec["public_key_b64"]) is True
        assert await slh.verify(msg + b"x", sig, vec["public_key_b64"]) is False


# ---------------------------------------------------------------------------
# ML-KEM-768 FIPS 203 KAT
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def kem_kat():
    return load_kat("ml-kem-768")


@pytest.fixture(scope="module")
def kem():
    return MlKem768Provider()


class TestMlKem768KAT:
    def test_algorithm_id(self, kem, kem_kat):
        assert kem.alg == kem_kat["properties"]["algorithm"]

    @pytest.mark.asyncio
    async def test_nist_decapsulation(self, kem, kem_kat):
        """Valid ciphertexts and implicit rejection of modified ones."""
        for vec in kem_kat["decapsulation"]:
            shared_secret = await kem.decapsulate(hex_to_b64(vec["c"]), hex_to_b64(vec["dk"]))
            assert shared_secret == bytes.fromhex(vec["k"]), f"tcId {vec['tcId']}: {vec['reason']}"

    @pytest.mark.asyncio
    async def test_nist_encapsulation_key_check(self, kem, kem_kat):
        for vec in kem_kat["encapsulation_key_check"]:
            if vec["testPassed"]:
                result = await kem.encapsulate(hex_to_b64(vec["ek"]))
                assert len(result["shared_secret"]) == kem_kat["properties"]["shared_secret_size"]
            else:
                with pytest.raises(ValueError):
                    await kem.encapsulate(hex_to_b64(vec["ek"]))

    @pytest.mark.asyncio
    async def test_nist_decapsulation_key_check(self, kem, kem_kat):
        ciphertext_b64 = base64.b64encode(bytes(kem_kat["properties"]["ciphertext_size"])).decode("ascii")
        for vec in kem_kat["decapsulation_key_check"]:
            if vec["testPassed"]:
                assert len(await kem.decapsulate(ciphertext_b64, hex_to_b64(vec["dk"]))) == 32
            else:
                with pytest.raises(ValueError):
                    await kem.decapsulate(ciphertext_b64, hex_to_b64(vec["dk"]))

    @pytest.mark.asyncio
    async def test_round_trip(self, kem, kem_kat):
        props = kem_kat["properties"]
        kp = await kem.generate_keypair()
        pk_bytes = base64.b64decode(kp["public_key_b64"])
        assert len(pk_bytes) == props["public_key_size"]
        assert len(base64.b64decode(kp["secret_key_b64"])) == props["secret_key_size"]
        assert kp["kid"] == derive_kid("ml-kem-768", pk_bytes)

        result = await kem.encapsulate(kp["public_key_b64"])
        assert len(base64.b64decode(result["ciphertext_b64"])) == props["ciphertext_size"]
        assert len(result["shared_secret"]) == props["shared_secret_size"]
        assert await kem.decapsulate(result["ciphertext_b64"], kp["secret_key_b64"]) == result["shared_secret"]

        other = await kem.generate_keypair()
        assert await kem.decapsulate(result["ciphertext_b64"], other["secret_key_b64"]) != result["shared_secret"]

    @pytest.mark.asyncio
    async def test_invalid_lengths_raise(self, kem):
        kp = await kem.generate_keypair()
        short = base64.b64encode(b"short").decode("ascii")
        with pytest.raises(ValueError):
            await kem.encapsulate(short)
        with pytest.raises(ValueError):
            await kem.decapsulate(short, kp["secret_key_b64"])

    @pytest.mark.asyncio
    async def test_cross_sdk_decapsulate(self, kem):
        """ML-KEM-768 ciphertext from the TypeScript SDK decapsulates to the TS shared secret."""
        vec = load_cross_sdk("typescript")["ml_kem_768"]
        shared_secret = await kem.decapsulate(vec["ciphertext_b64"], vec["secret_key_b64"])
        assert shared_secret.hex() == vec["shared_secret_hex"]


# ---------------------------------------------------------------------------
# ML-DSA-65 independent verification vectors (NIST ACVP tc39 + Wycheproof)
# ---------------------------------------------------------------------------
# The provider verifies with the empty FIPS 204 context, so only cases whose
# context is empty go through it; the others are checked as excluded. Values
# are copied verbatim from the pinned sources (tests/nist-kat/README.md).

ML_DSA_65_WYCHEPROOF = KAT_DIR / "ml-dsa-65" / "wycheproof_mldsa_65_verify_test.json"
ML_DSA_65_NIST_TG3 = KAT_DIR / "ml-dsa-65" / "acvp_sigver_tg3.json"
ML_DSA_65_VECTOR_PROVIDER = MlDsa65Provider()


def _mldsa65_vector_corpus():
    wy_bytes = ML_DSA_65_WYCHEPROOF.read_bytes()
    nist_bytes = ML_DSA_65_NIST_TG3.read_bytes()
    wy, nist = json.loads(wy_bytes), json.loads(nist_bytes)
    cases, excluded_wy, excluded_nist = [], [], []
    for g in wy["testGroups"]:
        for t in g["tests"]:
            if t.get("ctx"):
                excluded_wy.append(t["tcId"])
                continue
            cases.append(("wycheproof", t["tcId"], g["publicKey"], t["msg"], t["sig"], t["result"] == "valid"))
    for t in nist["testGroup"]["tests"]:
        if t.get("context"):
            excluded_nist.append(t["tcId"])
            continue
        cases.append(("nist", t["tcId"], t["pk"], t["message"], t["signature"], t["testPassed"] is True))
    return wy_bytes, nist_bytes, wy, nist, cases, excluded_wy, excluded_nist


class TestMlDsa65IndependentVectors:
    def test_corpus_integrity(self):
        wy_bytes, nist_bytes, wy, nist, cases, excluded_wy, excluded_nist = _mldsa65_vector_corpus()
        assert hashlib.sha256(wy_bytes).hexdigest() == "1ca235f61928421a173a171780beb00264ae9155dc33c52a11e1766cc7979034"
        assert hashlib.sha256(nist_bytes).hexdigest() == "bacf4ad8e55db0594d8bf2878ca3bd3cb80cfa680aaf05ca8e1788d896f63eb8"
        assert (wy["algorithm"], wy["numberOfTests"]) == ("ML-DSA-65", 210)
        g = nist["testGroup"]
        assert (g["tgId"], g["parameterSet"], g["signatureInterface"], g["preHash"], len(g["tests"])) == (
            3, "ML-DSA-65", "external", "pure", 15)
        assert len(cases) == 204
        assert sum(1 for c in cases if c[5]) == 77
        assert excluded_wy == [3, 4, 5, 153, 154, 155, 156]
        assert excluded_nist == [31, 32, 33, 34, 35, 36, 37, 38, 40, 41, 42, 43, 44, 45]
        assert [c[1] for c in cases if c[0] == "nist"] == [39]

    def test_provider_is_the_sdk_provider(self):
        import dcp_ai.providers.ml_dsa_65_provider as module

        assert type(ML_DSA_65_VECTOR_PROVIDER) is MlDsa65Provider
        assert MlDsa65Provider is module.MlDsa65Provider
        assert "verify" not in vars(ML_DSA_65_VECTOR_PROVIDER)
        # The module comes from this checkout, not from an installed copy.
        assert Path(module.__file__).resolve() == (Path(__file__).resolve().parent.parent / "dcp_ai" / "providers" / "ml_dsa_65_provider.py")

    @pytest.mark.asyncio
    async def test_verdicts_on_204_cases(self):
        cases = _mldsa65_vector_corpus()[4]
        mismatches, executed = [], 0
        for source, tc_id, pk, msg, sig, valid in cases:
            # No except: the Python provider returns a boolean, and any error fails the test.
            observed = await ML_DSA_65_VECTOR_PROVIDER.verify(
                bytes.fromhex(msg), bytes.fromhex(sig), base64.b64encode(bytes.fromhex(pk)).decode("ascii"))
            executed += 1
            if observed is not valid:
                mismatches.append(f"{source} {tc_id}: {valid} -> {observed}")
        assert mismatches == []
        assert executed == 204
