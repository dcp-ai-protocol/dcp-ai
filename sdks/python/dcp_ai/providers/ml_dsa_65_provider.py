"""
ML-DSA-65 signature provider using pqcrypto (PQClean bindings).

FIPS 204, NIST Level 3. Primary post-quantum signature algorithm.
Public key: 1952 B, Signature: 3309 B.
"""

from __future__ import annotations

import base64

from pqcrypto.sign.dilithium3 import (
    SIGNATURE_SIZE,
    generate_keypair,
    sign as pqc_sign,
    verify as pqc_verify,
)

from dcp_ai.v2.crypto_provider import CryptoProvider, derive_kid


class MlDsa65Provider(CryptoProvider):
    alg = "ml-dsa-65"
    key_size = 1952
    sig_size = 3309
    is_constant_time = True

    async def generate_keypair(self) -> dict[str, str]:
        pk, sk = generate_keypair()
        pk_bytes = bytes(pk)
        kid = derive_kid(self.alg, pk_bytes)
        return {
            "kid": kid,
            "public_key_b64": base64.b64encode(pk_bytes).decode("ascii"),
            "secret_key_b64": base64.b64encode(bytes(sk)).decode("ascii"),
        }

    async def sign(self, message: bytes, secret_key_b64: str) -> bytes:
        sk_bytes = base64.b64decode(secret_key_b64)
        signed_msg = pqc_sign(sk_bytes, message)
        return bytes(signed_msg[:SIGNATURE_SIZE])

    async def verify(self, message: bytes, signature: bytes, public_key_b64: str) -> bool:
        pk_bytes = base64.b64decode(public_key_b64)
        signed_msg = bytes(signature) + message
        try:
            pqc_verify(pk_bytes, signed_msg)
            return True
        except Exception:
            return False
