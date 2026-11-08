"""P-ED-1, the Ed25519 acceptance criterion of DCP (docs/reviews/mp02-ed25519-implementation-design.md).

Internal: used by dcp_ai.crypto.verify_object (V1) and by the Ed25519 provider (V2), not exported. Before PyNaCl,
on input PyNaCl itself accepts, a signature is rejected when S >= L, when A or R is not a canonical encoding, or
when A or R is one of the 8 points of order dividing 8 (the identity included). PyNaCl (libsodium) then checks the
equation [S]B = R + [k]A with k = SHA-512(R || A || M) mod L, without cofactor. Within the guard's typed domain (a
bytes message, a 64-byte bytes signature and a 32-byte bytes key) these checks do not depend on how libsodium was
built; other argument types (bytearray, memoryview, ...) go to PyNaCl as before, with its own checks. They compare
bytes and integers, with no curve arithmetic. Mixed-order points are not rejected: P-ED-1 does not require
torsion-free points.
"""

from __future__ import annotations

_P = 2**255 - 19
_L = 2**252 + 27742317777372353535851937790883648493

# The canonical encodings of the 8 points of E[8], derived by the independent review model
# (.claude/mp02-20261107/claude-f5-design/small-order-points.json) and equal to the constants of
# tests/interop/v2/ed25519_ped1_vectors.json.
SMALL_ORDER_ENCODINGS_HEX = (
    "0000000000000000000000000000000000000000000000000000000000000000",  # order 4
    "0000000000000000000000000000000000000000000000000000000000000080",  # order 4
    "0100000000000000000000000000000000000000000000000000000000000000",  # order 1, the identity
    "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",  # order 8
    "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85",  # order 8
    "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",  # order 8
    "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa",  # order 8
    "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",  # order 2
)
_SMALL_ORDER = frozenset(bytes.fromhex(h) for h in SMALL_ORDER_ENCODINGS_HEX)


def scalar_below_l(signature: bytes) -> bool:
    """Whether S, the second half of a 64-byte signature, is below L (RFC 8032 § 5.1.7)."""
    return int.from_bytes(signature[32:64], "little") < _L


def is_canonical_encoding(b: bytes) -> bool:
    """32 bytes with y < p (y: little-endian, bit 255 cleared), and no sign bit when x = 0 (y = 1 or y = p - 1).

    Whether the point is on the curve is left to libsodium, which rejects a key that does not decode, and to its byte
    comparison of R.
    """
    if len(b) != 32:
        return False
    y = int.from_bytes(b, "little") & ((1 << 255) - 1)
    return y < _P and not (b[31] >> 7 and y in (1, _P - 1))


def is_small_order_encoding(b: bytes) -> bool:
    """Whether 32 bytes are one of the 8 encodings of E[8]; meant for an encoding already found canonical."""
    return bytes(b) in _SMALL_ORDER


def rejects(message: object, signature: object, public_key: object) -> bool:
    """True when P-ED-1 rejects the signature before libsodium.

    Only on input PyNaCl accepts: a bytes message, a bytes signature of 64 bytes and a bytes key of 32 bytes. Anything
    else returns False and goes to PyNaCl as before, so it keeps its errors and their order. The inputs are only read.
    """
    if not (
        isinstance(message, bytes)
        and isinstance(signature, bytes)
        and len(signature) == 64
        and isinstance(public_key, bytes)
        and len(public_key) == 32
    ):
        return False
    r = signature[:32]
    return (
        not scalar_below_l(signature)
        or not is_canonical_encoding(public_key)
        or is_small_order_encoding(public_key)
        or not is_canonical_encoding(r)
        or is_small_order_encoding(r)
    )
