"""P-ED-1 (MP-02 F5c): the frozen vectors of tests/interop/v2/ed25519_ped1_vectors.json through the public paths of
the Python SDK. Every expectation comes from the corpus, the predicates of an independent review model; none from the
SDK. Design: docs/reviews/mp02-ed25519-implementation-design.md v0.2.4, §§ 4–6.

- historical (26) and signatures (41): Ed25519Provider.verify, the V2 provider. A length case expects PyNaCl's
  exact error (§ 4), never False;
- encodings (52): the helper, is_canonical_encoding and is_small_order_encoding;
- objects (4): verify_object, the V1 path, after checking that canonicalize gives the corpus bytes;
- composite (2): composite_sign over the exact DSM, with a classical test provider that returns the corpus signature
  only for those bytes and a fresh ML-DSA-65 key, then composite_verify with the real providers.

The installed libsodium (the official PyNaCl 1.6.2 wheel) already rejects these inputs; the DCP checks are made
before it so that, within the guard's bytes domain, the criterion does not depend on its build. rejects() is
therefore tested on its own as well, and a spy shows that a rejected input never reaches libsodium.
"""

from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path

import nacl.exceptions
import pytest

from dcp_ai import _ed25519_ped1 as ped1
from dcp_ai.crypto import canonicalize, verify_object
from dcp_ai.providers import Ed25519Provider, MlDsa65Provider
from dcp_ai.v2.composite_ops import CompositeKeyInfo, composite_sign, composite_verify
from dcp_ai.v2.crypto_provider import CryptoProvider
from dcp_ai.v2.crypto_registry import AlgorithmRegistry
from dcp_ai.v2.domain_separation import domain_separated_message

ROOT = Path(__file__).resolve().parents[3]
RAW = (ROOT / "tests/interop/v2/ed25519_ped1_vectors.json").read_bytes()
FROZEN = "f5990f8fcc8709c2c3b52e775c8210f0dcb32219c3e7cd36c527e44f49d1e396"
V = json.loads(RAW)
L = 2**252 + 27742317777372353535851937790883648493
ED = Ed25519Provider()


def b64(b: bytes) -> str:
    return base64.b64encode(b).decode("ascii")


def parts(c: dict) -> tuple[bytes, bytes, bytes]:
    return bytes.fromhex(c["message_hex"]), bytes.fromhex(c["signature_hex"]), bytes.fromhex(c["public_key_hex"])


def named(cid: str) -> dict:
    every = V["historical"] + V["signatures"] + V["objects"]["cases"] + V["composite"]["cases"]
    return next(c for c in every if c["id"] == cid)


def with_scalar(sig: bytes, s: int) -> bytes:
    return sig[:32] + s.to_bytes(32, "little")


def test_the_frozen_corpus():
    assert hashlib.sha256(RAW).hexdigest() == FROZEN
    assert [len(V["historical"]), len(V["encodings"]), len(V["signatures"]), len(V["objects"]["cases"]),
            len(V["composite"]["cases"])] == [26, 52, 41, 4, 2]


PROVIDER_CASES = V["historical"] + V["signatures"]


@pytest.mark.asyncio
@pytest.mark.parametrize("c", PROVIDER_CASES, ids=[c["id"] for c in PROVIDER_CASES])
async def test_v2_provider(c):
    msg, sig, pk = parts(c)
    if c["kind"] == "length":
        # VerifyKey checks the key first, then verify checks the signature (§ 4): an error, not a rejection.
        assert c["accept"] is False
        match = "key must be exactly 32 bytes" if len(pk) != 32 else "signature must be exactly 64 bytes"
        with pytest.raises(nacl.exceptions.ValueError, match=match):
            await ED.verify(msg, sig, b64(pk))
    else:
        assert await ED.verify(msg, sig, b64(pk)) is c["accept"]


def test_provider_case_count():
    assert len(PROVIDER_CASES) == 67


@pytest.mark.asyncio
@pytest.mark.parametrize("cid", ["signature/public-key-mixed-order-k-multiple-of-8",
                                 "signature/ped1-mixed-a-and-r-cancel-reduced"])
async def test_mixed_order_points_are_accepted(cid):
    """P-ED-1 does not require torsion-free points."""
    c = named(cid)
    msg, sig, pk = parts(c)
    assert c["accept"] is True and await ED.verify(msg, sig, b64(pk)) is True


def test_helper_table_is_the_corpus_e8():
    assert list(ped1.SMALL_ORDER_ENCODINGS_HEX) == V["constants"]["small_order_encodings_hex"]


@pytest.mark.parametrize("e", V["encodings"], ids=[e["id"] for e in V["encodings"]])
def test_helper_encodings(e):
    # The corpus small_order is about the decoded point; the helper compares bytes after the canonical check, so a
    # non-canonical encoding of a point of E[8] is not in its table.
    b = bytes.fromhex(e["encoding_hex"])
    assert ped1.is_canonical_encoding(b) is e["canonical_rule"]
    assert ped1.is_small_order_encoding(b) is (e["canonical_rule"] is True and e["small_order"] is True)


def test_helper_other_lengths():
    for n in (0, 31, 33):
        assert ped1.is_canonical_encoding(bytes(n)) is False
        assert ped1.is_small_order_encoding(bytes(n)) is False


def test_s_below_l_alone():
    sig = lambda s: with_scalar(bytes(64), s)
    assert ped1.scalar_below_l(sig(0)) and ped1.scalar_below_l(sig(L - 1))
    for s in (L, L + 1, L + 2**248, 2**256 - 1):
        assert ped1.scalar_below_l(sig(s)) is False


@pytest.mark.parametrize("c", PROVIDER_CASES, ids=[c["id"] for c in PROVIDER_CASES])
def test_rejects_decides_conditions_1_to_3(c):
    """rejects() alone, independent of libsodium: True exactly when S, the byte rule of an encoding or E[8] fails.

    Whether a canonical encoding decodes is left to libsodium (design § 1), so public-key-not-on-curve, which fails
    a_encoding only by not decoding, is not rejected here; libsodium rejects it.
    """
    msg, sig, pk = parts(c)
    expected = c["kind"] != "length" and (not c["s_below_l"] or not c["a_canonical"] or not c["r_canonical"]
                                         or c["a_small_order"] or c["r_small_order"])
    assert ped1.rejects(msg, sig, pk) is expected


def test_v1_canonical_bytes():
    assert canonicalize(V["objects"]["object"]).encode("utf-8").hex() == V["objects"]["canonical_hex"]


@pytest.mark.parametrize("c", V["objects"]["cases"], ids=[c["id"] for c in V["objects"]["cases"]])
def test_v1_verify_object(c):
    assert c["message_hex"] == V["objects"]["canonical_hex"]
    msg, sig, pk = parts(c)
    assert verify_object(V["objects"]["object"], b64(sig), b64(pk)) is c["accept"]


class FixedClassical(CryptoProvider):
    """Returns the corpus signature, only for exactly the corpus DSM."""

    alg = "ed25519"
    key_size = 32
    sig_size = 64
    is_constant_time = True

    def __init__(self, signature: bytes):
        self.signature = signature
        self.calls: list[str] = []

    async def generate_keypair(self) -> dict[str, str]:
        raise AssertionError("not used")

    async def sign(self, message: bytes, secret_key_b64: str) -> bytes:
        self.calls.append(message.hex())
        if message.hex() != V["composite"]["dsm_hex"]:
            raise AssertionError("not the corpus DSM")
        return self.signature

    async def verify(self, message: bytes, signature: bytes, public_key_b64: str) -> bool:
        raise AssertionError("not used")


def test_composite_dsm():
    payload = V["composite"]["payload_canonical"].encode("utf-8")
    assert domain_separated_message(V["composite"]["context"], payload).hex() == V["composite"]["dsm_hex"]


@pytest.mark.asyncio
@pytest.mark.parametrize("c", V["composite"]["cases"], ids=[c["id"] for c in V["composite"]["cases"]])
async def test_composite_exact_dsm_real_ml_dsa(c):
    context, payload = V["composite"]["context"], V["composite"]["payload_canonical"].encode("utf-8")
    _, sig, pk = parts(c)
    fixed, mldsa = FixedClassical(sig), MlDsa65Provider()
    pq = await mldsa.generate_keypair()
    signing = AlgorithmRegistry()
    signing.register_signer(fixed)
    signing.register_signer(mldsa)
    cs = await composite_sign(signing, context, payload,
                              CompositeKeyInfo("ped1-corpus", "ed25519", "unused", b64(pk)),
                              CompositeKeyInfo(pq["kid"], "ml-dsa-65", pq["secret_key_b64"], pq["public_key_b64"]))
    assert fixed.calls == [V["composite"]["dsm_hex"]]
    assert base64.b64decode(cs["classical"]["sig_b64"]).hex() == c["signature_hex"]
    verifying = AlgorithmRegistry()
    verifying.register_signer(Ed25519Provider())
    verifying.register_signer(mldsa)
    r = await composite_verify(verifying, context, payload, cs, b64(pk), pq["public_key_b64"])
    # The PQ component is real and valid; the corpus says the equation and the byte comparison hold on this DSM, so
    # for the negative the only reason left is P-ED-1.
    assert (r.valid, r.classical_valid, r.pq_valid) == (c["accept"], c["accept"], True)


WEAK = named("signature/a-small-order/order-8-26e8958f-05")
NON_CANONICAL = named("signature/a-non-canonical-small-order/y-p")


@pytest.mark.asyncio
async def test_combined_sizes_keep_pynacl_errors():
    msg, sig, pk = parts(WEAK)
    for bad in (sig[:63], sig + b"\x00"):
        with pytest.raises(nacl.exceptions.ValueError, match="signature must be exactly 64 bytes"):
            await ED.verify(msg, bad, b64(pk))
    with pytest.raises(nacl.exceptions.ValueError, match="key must be exactly 32 bytes"):
        await ED.verify(msg, sig, b64(pk + b"\x00"))
    nmsg, nsig, npk = parts(NON_CANONICAL)
    with pytest.raises(nacl.exceptions.ValueError, match="signature must be exactly 64 bytes"):
        await ED.verify(nmsg, nsig + b"\x00", b64(npk))


@pytest.mark.asyncio
async def test_combined_host_types_go_to_pynacl():
    """Outside the guard's domain the input goes to PyNaCl as before, with its errors or its verdict."""
    msg, sig, pk = parts(WEAK)
    with pytest.raises(TypeError):
        await ED.verify("not bytes", sig, b64(pk))  # type: ignore[arg-type]
    with pytest.raises(nacl.exceptions.TypeError):
        await ED.verify(msg, bytearray(sig), b64(pk))  # type: ignore[arg-type]
    assert ped1.rejects(bytearray(msg), sig, pk) is False  # not the guard's domain
    assert await ED.verify(bytearray(msg), sig, b64(pk)) is False  # PyNaCl's own verdict


@pytest.mark.asyncio
async def test_combined_s_plus_l_and_weak_a_is_a_rejection():
    msg, sig, pk = parts(WEAK)
    s = int.from_bytes(sig[32:], "little") + L
    assert await ED.verify(msg, with_scalar(sig, s), b64(pk)) is False


@pytest.mark.asyncio
async def test_inputs_are_only_read():
    c = named("signature/r-small-order/order-8-26e8958f-05")
    msg, sig, pk = parts(c)
    m = bytearray(msg)
    assert await ED.verify(m, sig, b64(pk)) is False
    assert bytes(m) == msg


# ── The guard runs before libsodium (review R1): a spy on VerifyKey.verify ──
# libsodium of the official wheel rejects the same inputs, so a bypass of the guard would not change the verdicts
# above. The spy records each call and calls the real method, without changing its result; monkeypatch restores it.
# It tests the contract "rejected before the library", not the cryptography (the real provider tests are above).


@pytest.fixture
def verify_calls(monkeypatch):
    import nacl.signing

    calls: list[int] = []
    real = nacl.signing.VerifyKey.verify

    def recording(self, *args, **kwargs):
        calls.append(1)
        return real(self, *args, **kwargs)

    monkeypatch.setattr(nacl.signing.VerifyKey, "verify", recording)
    return calls


@pytest.mark.asyncio
@pytest.mark.parametrize("cid, expected, calls", [
    ("signature/normal-key", True, 1),
    ("signature/ped1-mixed-a-and-r-cancel-reduced", True, 1),
    ("signature/normal-key/message-altered", False, 1),  # the guard passes; libsodium rejects the equation
    ("signature/normal-key-s-plus-l", False, 0),
    ("signature/a-small-order/order-8-26e8958f-05", False, 0),
    ("signature/r-small-order/order-8-26e8958f-05", False, 0),
    ("signature/a-non-canonical-small-order/y-p", False, 0),
    ("signature/r-non-canonical-small-order/y-p", False, 0),
])
async def test_v2_guard_before_libsodium(verify_calls, cid, expected, calls):
    msg, sig, pk = parts(named(cid))
    assert await ED.verify(msg, sig, b64(pk)) is expected
    assert len(verify_calls) == calls


def _object_case(cid: str) -> tuple[bytes, bytes]:
    c = named(cid)
    return bytes.fromhex(c["signature_hex"]), bytes.fromhex(c["public_key_hex"])


@pytest.mark.parametrize("cid, expected, calls", [
    ("object/normal-key", True, 1),
    ("object/a-small-order", False, 0),
    ("object/r-small-order", False, 0),
    ("object/r-identity", False, 0),
])
def test_v1_guard_before_libsodium(verify_calls, cid, expected, calls):
    sig, pk = _object_case(cid)
    assert verify_object(V["objects"]["object"], b64(sig), b64(pk)) is expected
    assert len(verify_calls) == calls


def test_v1_s_plus_l_before_libsodium(verify_calls):
    """object/normal-key with S + L (derived from the corpus control): rejected by the guard, 0 calls."""
    sig, pk = _object_case("object/normal-key")
    s_plus_l = with_scalar(sig, int.from_bytes(sig[32:], "little") + L)
    assert verify_object(V["objects"]["object"], b64(s_plus_l), b64(pk)) is False
    assert len(verify_calls) == 0
