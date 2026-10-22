"""
ML-DSA-65 signature provider using pqcrypto.

FIPS 204, NIST Level 3. Primary post-quantum signature algorithm.
Public key: 1952 B, Signature: 3309 B.
"""

from __future__ import annotations

import base64

from pqcrypto.sign.ml_dsa_65 import keygen, sign as pqc_sign, verify as pqc_verify

from dcp_ai.v2.crypto_provider import CryptoProvider, derive_kid


class MlDsa65Provider(CryptoProvider):
    alg = "ml-dsa-65"
    key_size = 1952
    sig_size = 3309
    is_constant_time = True

    async def generate_keypair(self) -> dict[str, str]:
        pk_bytes, sk_bytes = keygen()
        kid = derive_kid(self.alg, pk_bytes)
        return {
            "kid": kid,
            "public_key_b64": base64.b64encode(pk_bytes).decode("ascii"),
            "secret_key_b64": base64.b64encode(sk_bytes).decode("ascii"),
        }

    async def sign(self, message: bytes, secret_key_b64: str) -> bytes:
        return pqc_sign(base64.b64decode(secret_key_b64), bytes(message))

    async def verify(self, message: bytes, signature: bytes, public_key_b64: str) -> bool:
        pk_bytes = base64.b64decode(public_key_b64)
        try:
            pqc_verify(pk_bytes, bytes(message), bytes(signature))
            return True
        except ValueError:  # pqcrypto.InvalidSignatureError subclasses ValueError
            return False
